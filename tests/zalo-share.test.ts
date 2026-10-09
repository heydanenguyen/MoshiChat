import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from('k:' + s), decryptString: (b: Buffer) => b.toString().slice(2) }
}))

const { ZaloShare } = await import('../src/main/zalo-share')
type Entry = [string, 0 | 1, { msgId: string; ts: string; content: string }]

/** A Zalo account's cache on one computer. */
function fakeZalo(messages: Entry[]): { shareOwner: string; shareVersion: number; shareSnapshot(): Entry[]; importShared(e: Entry[]): number; ids(): string[] } {
  const have = new Map(messages.map((m) => [m[2].msgId, m]))
  return {
    shareOwner: '2143928518677422522',
    shareVersion: 1,
    shareSnapshot: () => [...have.values()],
    importShared(entries) {
      let added = 0
      for (const e of entries) {
        if (have.has(e[2].msgId)) continue
        have.set(e[2].msgId, e)
        added++
      }
      if (added) this.shareVersion++
      return added
    },
    ids: () => [...have.keys()].sort()
  }
}

const computer = (folder: string, id: string, source: ReturnType<typeof fakeZalo>): InstanceType<typeof ZaloShare> => {
  userData = mkdtempSync(join(tmpdir(), `moshi-${id}-`))
  return new ZaloShare(() => folder, () => ({ id, name: id }), () => [source as never], () => undefined)
}

describe('Zalo messages shared between computers', () => {
  it('fills one computer’s gap from the other, encrypted, behind one passphrase', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'moshi-sync-'))
    const now = String(Date.now())
    const office = fakeZalo([['t1', 0, { msgId: 'a', ts: now, content: 'chúc mừng sinh nhật' }], ['t1', 0, { msgId: 'b', ts: now, content: 'cảm ơn nhé' }]])
    const home = fakeZalo([['t1', 0, { msgId: 'a', ts: now, content: 'chúc mừng sinh nhật' }]])
    const a = computer(folder, 'office', office)
    await a.enable('một cụm mật khẩu dài')
    const b = computer(folder, 'home', home)
    await expect(b.enable('sai mật khẩu rồi')).rejects.toThrow(/does not match/)
    const status = await b.enable('một cụm mật khẩu dài')
    expect(status.enabled).toBe(true)
    // home took what only office had; office's file on the drive is ciphertext
    expect(home.ids()).toEqual(['a', 'b'])
    const shared = join(folder, 'zalo-share', office.shareOwner)
    expect(readdirSync(shared).sort()).toEqual(['home.zmsg', 'office.zmsg'])
    expect(readFileSync(join(shared, 'office.zmsg')).includes(Buffer.from('cảm ơn'))).toBe(false)
    // turning it off removes this computer's copy only
    await b.disable()
    expect(readdirSync(shared)).toEqual(['office.zmsg'])
  })
})
