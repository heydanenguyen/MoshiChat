import { describe, expect, it, vi } from 'vitest'

const cleared: string[] = []
// Who each session is signed in to: c_user / ds_user_id cookies by partition.
const signedIn: Record<string, string> = { 'persist:login-messenger': '111' }
vi.mock('electron', () => ({
  session: {
    fromPartition: (name: string) => ({
      clearStorageData: async () => void cleared.push(name),
      cookies: { get: async ({ name: cookie }: { name: string }) => (signedIn[name] && cookie === 'c_user' ? [{ value: signedIn[name] }] : []) }
    })
  }
}))

const { forgetPartition, freshPartition, legacyPartition, newPartition, partitionFor, rememberPartition, sessionUser, wipePartition } = await import('../src/main/web-partitions')

describe('a browser session per Facebook / Instagram account', () => {
  it('gives the first account the shared session and every further one its own', async () => {
    expect(freshPartition('instagram')).toBe('persist:login-instagram')
    rememberPartition('instagram:ig-1', 'instagram', legacyPartition('instagram'))
    const second = freshPartition('instagram')
    expect(second).toMatch(/^persist:login-instagram-[0-9a-f]{8}$/)
    rememberPartition('instagram:ig-2', 'instagram', second)
    // Facebook is counted on its own.
    expect(freshPartition('messenger')).toBe('persist:login-messenger')
    expect(partitionFor('instagram')).toBe('persist:login-instagram')

    // Removing the second account wipes its session; the shared one is never wiped.
    forgetPartition('instagram:ig-2')
    await wipePartition('instagram', second)
    await wipePartition('instagram', legacyPartition('instagram'))
    expect(cleared).toEqual([second])
    // With the first account gone too, the next one signs in with the shared session again.
    forgetPartition('instagram:ig-1')
    expect(freshPartition('instagram')).toBe('persist:login-instagram')
  })

  it('knows who a session is signed in to, so signing in again never lands in another account’s session', async () => {
    expect(await sessionUser('messenger', 'persist:login-messenger')).toBe('111')
    expect(await sessionUser('messenger', 'persist:login-messenger-abcd1234')).toBeUndefined()
    expect(newPartition('messenger')).toMatch(/^persist:login-messenger-[0-9a-f]{8}$/)
    expect(newPartition('messenger')).not.toBe(newPartition('messenger'))
  })
})
