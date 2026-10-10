import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { ZaloRelayOwner } from '@shared/bridge'
import type { RelayMeta, RelayState } from '@shared/zalo-relay'
import { decrypt, encrypt } from '../zalo-share'

/** Folder under the sync folder that holds one directory per Zalo owner (see main/zalo-relay.ts for the layout). */
export const RELAY_DIR = 'zalo-relay'

export const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | undefined)?.code

/** A file of the relay folder as bytes. Only the encrypted envelope is accepted (decrypt throws otherwise): a plain file could be forged by anyone who can write to the sync folder. */
export async function readRelayFile(key: Buffer, path: string): Promise<Buffer> {
  return decrypt(key, await fs.readFile(path))
}

/** Encrypted, tmp + rename, so the cloud client never uploads half a file. */
export async function writeRelayFile(key: Buffer, path: string, bytes: Buffer): Promise<void> {
  await fs.writeFile(path + '.tmp', encrypt(key, bytes))
  await fs.rename(path + '.tmp', path)
}

export async function readRelayState(key: Buffer, dir: string): Promise<RelayState> {
  const state = JSON.parse(gunzipSync(await readRelayFile(key, join(dir, 'state.zrs'))).toString('utf8')) as RelayState
  if (!state || state.version !== 1 || !state.me || !Array.isArray(state.threads) || typeof state.messages !== 'object') throw new Error('not a relay state')
  return state
}

/** The sidecar; undefined when it is not there (ENOENT) or cannot be understood. */
export async function readRelayMeta(dir: string): Promise<RelayMeta | undefined> {
  try {
    const m = JSON.parse(await fs.readFile(join(dir, 'state.meta.json'), 'utf8')) as Partial<RelayMeta> | null
    return m && typeof m.relayDeviceId === 'string' && Number.isFinite(m.writtenAt) && Number.isFinite(m.stateAt) ? (m as RelayMeta) : undefined
  } catch {
    return undefined
  }
}

/** The Zalo accounts other computers relay: one entry per owner folder whose state this computer's key can read. */
export async function listRelayOwners(folder: string, key: Buffer): Promise<ZaloRelayOwner[]> {
  const root = join(folder, RELAY_DIR)
  const out: ZaloRelayOwner[] = []
  for (const ownerId of await fs.readdir(root).catch(() => [] as string[])) {
    const dir = join(root, ownerId)
    try {
      const state = await readRelayState(key, dir)
      const meta = await readRelayMeta(dir)
      out.push({ ownerId, name: state.me.name || ownerId, relayDeviceName: meta?.relayDeviceName ?? state.relayDeviceName, writtenAt: meta?.writtenAt ?? state.writtenAt })
    } catch {
      /* no state yet, half-synced, or written with another passphrase: not offered */
    }
  }
  return out.sort((a, b) => b.writtenAt - a.writtenAt)
}
