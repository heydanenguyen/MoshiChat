import { app } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { hostname } from 'os'
import { basename, join } from 'path'
import type { BridgeEvent, Settings, SyncStatus } from '@shared/types'
import { deviceEntries, mergeRemote, seedStamps, stampChanges, type DeviceFile, type Stamp } from '@shared/sync-merge'
import type { SettingsOrigin, Storage } from './storage'

/** Folder created inside the one the user picks (unless they picked it already). */
const SYNC_DIR = 'Moshi Sync'
const PULL_MS = 20_000
const PUSH_DELAY_MS = 1_500

interface SyncState {
  deviceId: string
  folder?: string
  stamps: Record<string, Stamp>
  lastSyncAt?: number
}

/**
 * Keeps tags, pins, nicknames, saved messages, to-dos, quick replies and the look in step between
 * computers through a folder a cloud drive already syncs. See shared/sync-merge for how entries merge.
 */
export class SyncService {
  private state: SyncState = { deviceId: randomUUID(), stamps: {} }
  private file = join(app.getPath('userData'), 'sync-state.json')
  private timer?: ReturnType<typeof setInterval>
  private pushTimer?: ReturnType<typeof setTimeout>
  /** This computer has changes the folder does not have yet. */
  private dirty = true
  private error?: string
  private devices: SyncStatus['devices'] = []
  private running: Promise<void> = Promise.resolve()

  constructor(
    private storage: Storage,
    private emit: (event: BridgeEvent) => void,
    private log: (...args: unknown[]) => void
  ) {}

  async start(): Promise<void> {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<SyncState>
      if (saved.deviceId) this.state = { deviceId: saved.deviceId, folder: saved.folder, stamps: saved.stamps ?? {}, lastSyncAt: saved.lastSyncAt }
    } catch {
      /* never set up */
    }
    this.storage.onSettingsChanged((before, after, origin) => this.localChange(before, after, origin))
    if (this.state.folder) this.schedule()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  status(): SyncStatus {
    return { enabled: !!this.state.folder, folder: this.state.folder, deviceName: hostname(), lastSyncAt: this.state.lastSyncAt, error: this.error, devices: this.devices }
  }

  /** Start syncing through `picked` (its "Moshi Sync" folder). What this computer has is merged with what is already there. */
  async enable(picked: string): Promise<SyncStatus> {
    const folder = basename(picked) === SYNC_DIR ? picked : join(picked, SYNC_DIR)
    await fs.mkdir(folder, { recursive: true })
    this.state.folder = folder
    this.state.stamps = {}
    seedStamps(this.storage.settings, this.state.stamps, this.state.deviceId)
    await this.saveState()
    this.dirty = true
    this.schedule()
    await this.syncNow()
    return this.status()
  }

  /** Stop syncing. This computer's file is removed from the folder; its settings stay as they are. */
  async disable(): Promise<SyncStatus> {
    const folder = this.state.folder
    this.stop()
    this.state.folder = undefined
    this.state.stamps = {}
    this.devices = []
    this.error = undefined
    await this.saveState()
    if (folder) await fs.rm(join(folder, `${this.state.deviceId}.json`), { force: true }).catch(() => undefined)
    return this.status()
  }

  /** Pull the other computers' changes, then write ours. Runs one at a time. */
  syncNow(): Promise<void> {
    this.running = this.running.then(() => this.pullAndPush()).catch((err) => this.fail(err))
    return this.running
  }

  private schedule(): void {
    this.stop()
    this.timer = setInterval(() => void this.syncNow(), PULL_MS)
  }

  private localChange(before: Settings, after: Settings, origin: SettingsOrigin): void {
    if (!this.state.folder || origin === 'sync') return
    if (!stampChanges(before, after, this.state.stamps, Date.now(), this.state.deviceId, origin === 'tidy')) return
    this.dirty = true
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.running = this.running.then(() => this.push()).catch((err) => this.fail(err))
    }, PUSH_DELAY_MS)
  }

  private async pullAndPush(): Promise<void> {
    const folder = this.state.folder
    if (!folder) return
    const remotes: DeviceFile[] = []
    const devices: SyncStatus['devices'] = []
    for (const name of await fs.readdir(folder)) {
      if (!name.endsWith('.json') || name === `${this.state.deviceId}.json`) continue
      try {
        const remote = JSON.parse(await fs.readFile(join(folder, name), 'utf8')) as DeviceFile
        if (remote.version !== 1 || !remote.deviceId || remote.deviceId === this.state.deviceId) continue
        remotes.push(remote)
        devices.push({ name: remote.deviceName || 'Moshi', updatedAt: remote.updatedAt })
      } catch {
        // Half-written by the cloud client, or a conflict copy it made; the next round reads it again.
      }
    }
    this.devices = devices.sort((a, b) => b.updatedAt - a.updatedAt)
    const merged = mergeRemote(this.storage.settings, this.state.stamps, remotes)
    if (merged) {
      this.state.stamps = merged.stamps
      this.dirty = true
      if (Object.keys(merged.patch).length) {
        const settings = await this.storage.setSettings(merged.patch, 'sync')
        this.emit({ type: 'settings:updated', settings })
        this.log('sync: took', Object.keys(merged.patch).join(', '), 'from', remotes.length, 'other computer(s)')
      }
    }
    // Rewriting an unchanged file every round would keep the cloud client uploading for nothing.
    if (this.dirty) await this.push()
  }

  /** Write this computer's entries (atomically, so a cloud client never uploads half a file). */
  private async push(): Promise<void> {
    const folder = this.state.folder
    if (!folder) return
    const file: DeviceFile = { version: 1, deviceId: this.state.deviceId, deviceName: hostname(), updatedAt: Date.now(), entries: deviceEntries(this.storage.settings, this.state.stamps) }
    const target = join(folder, `${this.state.deviceId}.json`)
    await fs.writeFile(target + '.tmp', JSON.stringify(file), 'utf8')
    await fs.rename(target + '.tmp', target)
    this.state.lastSyncAt = file.updatedAt
    this.dirty = false
    this.error = undefined
    await this.saveState()
  }

  private fail(err: unknown): void {
    this.error = (err as Error).message
    this.log('sync failed:', this.error)
  }

  private async saveState(): Promise<void> {
    await fs.writeFile(this.file + '.tmp', JSON.stringify(this.state), 'utf8')
    await fs.rename(this.file + '.tmp', this.file)
  }
}
