import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { packBackup, readBackupHeader, safeRelativePath, unpackBackup, type BackupPayload } from '../src/main/backup-format'

const payload: BackupPayload = {
  accounts: [{ id: 'zalo:1', platform: 'zalo', displayName: 'Test', secret: { cookie: 'c', imei: 'i' } }],
  settings: { ...DEFAULT_SETTINGS, language: 'vi', pins: { 'zalo:1/2': true } } as never,
  files: [{ path: 'zalo/zalo-cache-1.json', data: Buffer.from('{"threads":[]}').toString('base64') }],
  cookies: { 'login-instagram': [{ name: 'sessionid', value: 'secret', domain: '.instagram.com', path: '/', secure: true }] }
}
const header = { createdAt: 1_790_000_000_000, appVersion: '0.1.0', includesSessions: true, accounts: 1 }

describe('backup file', () => {
  const file = packBackup(header, payload, 'correct horse battery')

  it('round-trips with the right password', () => {
    const { header: h, payload: p } = unpackBackup(file, 'correct horse battery')
    expect(h).toMatchObject(header)
    expect(p.accounts[0].secret).toEqual({ cookie: 'c', imei: 'i' })
    expect(p.cookies['login-instagram'][0].value).toBe('secret')
    expect(Buffer.from(p.files[0].data, 'base64').toString()).toBe('{"threads":[]}')
  })

  it('keeps secrets out of the readable part', () => {
    expect(readBackupHeader(file).includesSessions).toBe(true)
    const text = file.toString('latin1')
    expect(text).not.toContain('sessionid')
    expect(text).not.toContain('imei')
  })

  it('refuses a wrong password and any tampering', () => {
    expect(() => unpackBackup(file, 'wrong password!')).toThrow('BACKUP_PASSWORD')
    const tampered = Buffer.from(file)
    tampered[tampered.length - 5] ^= 0xff
    expect(() => unpackBackup(tampered, 'correct horse battery')).toThrow('BACKUP_PASSWORD')
    // the header is authenticated too
    const edited = Buffer.from(file.toString('latin1').replace('"includesSessions":true', '"includesSessions":fals'), 'latin1')
    expect(() => unpackBackup(edited, 'correct horse battery')).toThrow()
  })

  it('rejects other files and short passwords', () => {
    expect(() => readBackupHeader(Buffer.from('hello world, not a backup'))).toThrow('BACKUP_FORMAT')
    expect(() => packBackup(header, payload, 'short')).toThrow()
  })

  it('never writes outside the adapters folder', () => {
    expect(safeRelativePath('zalo/cache.json')).toBe('zalo/cache.json')
    expect(safeRelativePath('whatsapp\\auth\\creds.json')).toBe('whatsapp/auth/creds.json')
    for (const bad of ['../unison.json', 'zalo/../../x', '/etc/passwd', 'C:/Windows/x', 'a//b', '']) expect(safeRelativePath(bad)).toBeUndefined()
  })
})
