import { execFile } from 'child_process'
import { existsSync } from 'fs'

/**
 * Windows only. The branded setup (setup/MoshiSetup.cs) points the "Apps & features" entry at its own
 * "Moshi Uninstall.exe" (the goodbye window) and keeps the NSIS uninstaller's command in `MoshiCoreUninstall`.
 * An in-app update runs electron-builder's NSIS package, which copies whatever `UninstallString` names to a
 * temp folder and runs it to remove the old version. Through the branded uninstaller that ran the real NSIS
 * uninstaller IN PLACE, and an in-place NSIS uninstaller cannot move its own file out of the install folder,
 * so the update's "move everything out, then install" step failed every time ("uninstall error code 2"). The
 * branded setup itself avoids this by pointing the entry at the NSIS uninstaller for the duration of an
 * update; this does the same before the in-app installer starts.
 */

const UNINSTALL_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
const BRANDED_UNINSTALLER = 'Moshi Uninstall.exe'

export interface RegValue {
  key: string
  name: string
  type: string
  value: string
}

/** The key lines and `    Name    REG_TYPE    data` lines of `reg query` output. */
export function parseRegQuery(output: string): RegValue[] {
  const values: RegValue[] = []
  let key = ''
  for (const raw of output.split(/\r?\n/)) {
    if (/^HKEY_/.test(raw)) {
      key = raw.trim()
      continue
    }
    const m = /^\s+(\S+)\s+(REG_[A-Z_]+)\s*(.*)$/.exec(raw)
    if (m && key) values.push({ key, name: m[1], type: m[2], value: m[3].trim() })
  }
  return values
}

/** The uninstall entry whose DisplayName is exactly `displayName`, from a `reg query <root> /s /v DisplayName`. */
export function findUninstallKey(output: string, displayName: string): string | undefined {
  return parseRegQuery(output).find((v) => v.name === 'DisplayName' && v.value === displayName)?.key
}

/** The executable a quoted or bare command line starts with. */
export function commandExe(command: string): string {
  const trimmed = command.trim()
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1)
    return end > 0 ? trimmed.slice(1, end) : trimmed.slice(1)
  }
  return trimmed.split(' ')[0]
}

/**
 * What to do with an entry's values: the NSIS command to point `UninstallString` at, or why not.
 * `exists` says whether a path is on disk (injected for tests).
 */
export function uninstallRepoint(values: RegValue[], exists: (path: string) => boolean = existsSync): { core: string } | { reason: string } {
  const current = values.find((v) => v.name === 'UninstallString')?.value ?? ''
  const core = values.find((v) => v.name === 'MoshiCoreUninstall')?.value ?? ''
  if (!current.includes(BRANDED_UNINSTALLER)) return { reason: 'the entry already names the NSIS uninstaller' }
  if (!core) return { reason: 'no MoshiCoreUninstall value' }
  if (!exists(commandExe(core))) return { reason: 'the NSIS uninstaller is not on disk' }
  return { core }
}

const reg = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('reg', args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 5_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })

/**
 * Before the in-app installer runs: point the Windows uninstall entry at the NSIS uninstaller so the update's
 * old-version removal runs it from a temp copy. The installer writes its own `UninstallString` afterwards, and
 * the next branded setup puts "Moshi Uninstall.exe" back.
 */
export async function pointUninstallEntryAtCore(log: (...args: unknown[]) => void): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const key = findUninstallKey(await reg(['query', UNINSTALL_ROOT, '/s', '/v', 'DisplayName']), 'Moshi')
    if (!key) {
      log('[update] no Moshi uninstall entry in the registry (left as is)')
      return
    }
    const decision = uninstallRepoint(parseRegQuery(await reg(['query', key])))
    if ('reason' in decision) {
      log('[update] uninstall entry left as is:', decision.reason)
      return
    }
    await reg(['add', key, '/v', 'UninstallString', '/t', 'REG_SZ', '/d', decision.core, '/f'])
    log('[update] uninstall entry points at the NSIS uninstaller for the update')
  } catch (err) {
    log('[update] could not adjust the uninstall entry:', (err as Error).message)
  }
}
