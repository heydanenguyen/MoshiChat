import { describe, expect, it } from 'vitest'

import { commandExe, findUninstallKey, parseRegQuery, uninstallRepoint } from '../src/main/update-registry'

const ROOT = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
const SEARCH = [
  '',
  `${ROOT}\\1400c572-41f4-548d-8d23-1f67a0f8c3ea`,
  '    DisplayName    REG_SZ    Dynamic Island 1.8.3',
  '',
  `${ROOT}\\6f1b8e3f-4182-5e9f-acb2-0cbf9ff47fc0`,
  '    DisplayName    REG_SZ    Moshi',
  '',
  `${ROOT}\\Framer`,
  '    DisplayName    REG_SZ    Framer',
  '',
  'End of search: 3 match(es) found.',
  ''
].join('\r\n')

const ENTRY = [
  '',
  `${ROOT}\\6f1b8e3f-4182-5e9f-acb2-0cbf9ff47fc0`,
  '    DisplayName    REG_SZ    Moshi',
  '    DisplayVersion    REG_SZ    0.8.0',
  '    UninstallString    REG_SZ    "C:\\Users\\me\\AppData\\Local\\Programs\\Moshi\\Moshi Uninstall.exe" --uninstall',
  '    QuietUninstallString    REG_SZ    "C:\\Users\\me\\AppData\\Local\\Programs\\Moshi\\Uninstall Moshi.exe" /currentuser /S',
  '    MoshiCoreUninstall    REG_SZ    "C:\\Users\\me\\AppData\\Local\\Programs\\Moshi\\Uninstall Moshi.exe" /currentuser',
  '    NoRepair    REG_DWORD    0x1',
  ''
].join('\r\n')

describe('reg query parsing', () => {
  it('reads key lines and typed values', () => {
    const values = parseRegQuery(ENTRY)
    expect(values.map((v) => v.name)).toEqual(['DisplayName', 'DisplayVersion', 'UninstallString', 'QuietUninstallString', 'MoshiCoreUninstall', 'NoRepair'])
    expect(values[2].value).toBe('"C:\\Users\\me\\AppData\\Local\\Programs\\Moshi\\Moshi Uninstall.exe" --uninstall')
    expect(values[5]).toMatchObject({ type: 'REG_DWORD', value: '0x1', key: `${ROOT}\\6f1b8e3f-4182-5e9f-acb2-0cbf9ff47fc0` })
  })

  it('finds the entry named exactly Moshi (not Moshi-like names, not the "End of search" line)', () => {
    expect(findUninstallKey(SEARCH, 'Moshi')).toBe(`${ROOT}\\6f1b8e3f-4182-5e9f-acb2-0cbf9ff47fc0`)
    expect(findUninstallKey(SEARCH, 'MoshiChat')).toBeUndefined()
    expect(findUninstallKey('', 'Moshi')).toBeUndefined()
  })

  it('takes the executable out of a quoted or bare command', () => {
    expect(commandExe('"C:\\Program Files\\Moshi\\Uninstall Moshi.exe" /currentuser')).toBe('C:\\Program Files\\Moshi\\Uninstall Moshi.exe')
    expect(commandExe('C:\\x\\un.exe /S')).toBe('C:\\x\\un.exe')
  })
})

describe('uninstallRepoint', () => {
  const core = '"C:\\Users\\me\\AppData\\Local\\Programs\\Moshi\\Uninstall Moshi.exe" /currentuser'

  it('points at the NSIS uninstaller when the branded one is registered and the NSIS one exists', () => {
    expect(uninstallRepoint(parseRegQuery(ENTRY), () => true)).toEqual({ core })
  })

  it('leaves a plain electron-builder install alone', () => {
    const plain = ENTRY.replace('Moshi Uninstall.exe" --uninstall', 'Uninstall Moshi.exe" /currentuser')
    expect(uninstallRepoint(parseRegQuery(plain), () => true)).toEqual({ reason: 'the entry already names the NSIS uninstaller' })
  })

  it('refuses without a core command or when its file is gone', () => {
    const noCore = parseRegQuery(ENTRY).filter((v) => v.name !== 'MoshiCoreUninstall')
    expect(uninstallRepoint(noCore, () => true)).toEqual({ reason: 'no MoshiCoreUninstall value' })
    expect(uninstallRepoint(parseRegQuery(ENTRY), () => false)).toEqual({ reason: 'the NSIS uninstaller is not on disk' })
  })
})
