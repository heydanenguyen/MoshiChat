import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, AuthPrompt, BridgeEvent, CallState, IncomingCall } from '../src/shared/types'
import { DEFAULT_SETTINGS } from '../src/shared/types'

// Headless store, like store-send.test.ts: the bridge is a hand-made object whose lists we resolve by hand.
let listener: ((event: BridgeEvent) => void) | undefined
const resolvers: { accounts?: (a: Account[]) => void } = {}
const pending = vi.fn()
const callsState = vi.fn()
const unison = {
  app: { platform: 'win32' },
  onEvent: (fn: (event: BridgeEvent) => void) => {
    listener = fn
    return () => {
      listener = undefined
    }
  },
  settings: { get: async () => DEFAULT_SETTINGS },
  accounts: { list: () => new Promise<Account[]>((resolve) => (resolvers.accounts = resolve)) },
  conversations: { list: async () => [] },
  lock: { state: async () => undefined },
  calls: { state: callsState },
  auth: { pending }
}
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined, unison })
const { useStore } = await import('../src/renderer/src/store')

const account = (id: string, status: Account['status']): Account => ({ id, platform: 'telegram', displayName: id, status }) as Account
const prompt = (requestId: string): AuthPrompt => ({ requestId, accountId: 'a1', platform: 'telegram', kind: 'qr', qrDataUrl: 'data:image/png;base64,AA==' })

beforeEach(() => {
  listener = undefined
  pending.mockReset()
  pending.mockResolvedValue([])
  callsState.mockReset()
  callsState.mockResolvedValue({ incoming: [] })
  useStore.setState({ ready: false, accounts: {}, conversations: {}, authPrompts: [], calls: { incoming: [] } })
})

describe('init', () => {
  it('listens before the lists resolve, so an account update in between is not lost', async () => {
    const done = useStore.getState().init()
    // Registered synchronously, before the account list is answered.
    expect(listener).toBeDefined()
    await Promise.resolve()
    listener!({ type: 'account:updated', account: account('a1', 'connected') })
    resolvers.accounts!([account('a1', 'connecting')])
    await done
    expect(useStore.getState().accounts.a1.status).toBe('connected')
  })

  it('shows sign-in prompts that were waiting before the window listened', async () => {
    pending.mockResolvedValue([prompt('r1')])
    const done = useStore.getState().init()
    await Promise.resolve()
    resolvers.accounts!([])
    await done
    expect(useStore.getState().authPrompts.map((p) => p.requestId)).toEqual(['r1'])
  })

  it('does not show a prompt twice when it also arrived as an event', async () => {
    pending.mockResolvedValue([prompt('r1')])
    const done = useStore.getState().init()
    await Promise.resolve()
    listener!({ type: 'auth:prompt', prompt: prompt('r1') })
    resolvers.accounts!([])
    await done
    expect(useStore.getState().authPrompts).toHaveLength(1)
  })
})

describe('app notices', () => {
  const noticeText = async (event: BridgeEvent): Promise<string | undefined> => {
    useStore.setState({ toasts: [], settings: { ...DEFAULT_SETTINGS, language: 'en' } })
    const done = useStore.getState().init()
    await Promise.resolve()
    resolvers.accounts!([])
    await done
    listener!(event)
    return useStore.getState().toasts[0]?.text
  }

  it('says a restore from the backup happened', async () => {
    expect(await noticeText({ type: 'app:notice', notice: 'settings-restored' })).toBe('Your settings were restored from the last backup.')
  })

  it('says a reset happened and names the file that was kept', async () => {
    const text = await noticeText({ type: 'app:notice', notice: 'settings-reset', detail: 'unison.json.corrupt-2026-10-09T10-00-00.000Z' })
    expect(text).toBe('Your settings file was damaged and has been reset; the old file is kept as unison.json.corrupt-2026-10-09T10-00-00.000Z.')
  })

  it('still shows the keyring warning for insecure-secrets', async () => {
    expect(await noticeText({ type: 'app:notice', notice: 'insecure-secrets' })).toContain('no keyring')
  })
})

describe('toggleSidebar', () => {
  it('applies the change at once and saves after, and puts it back if saving fails', async () => {
    let fail: (err: Error) => void = () => undefined
    ;(unison as Record<string, unknown>).settings = {
      get: async () => DEFAULT_SETTINGS,
      set: () => new Promise((_, reject) => (fail = reject))
    }
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, sidebarCollapsed: false } })
    const saving = useStore.getState().toggleSidebar()
    // Before the save has answered (a slow main process): already collapsed.
    expect(useStore.getState().settings.sidebarCollapsed).toBe(true)
    fail(new Error('offline'))
    await saving
    expect(useStore.getState().settings.sidebarCollapsed).toBe(false)
    expect(useStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
  })
})

describe('calls', () => {
  const ringing = (id: string): IncomingCall => ({ id, accountId: 'a1', platform: 'messenger', peerName: 'Lan', kind: 'video', at: 1 })
  const ready = async (): Promise<void> => {
    const done = useStore.getState().init()
    await Promise.resolve()
    resolvers.accounts!([])
    await done
  }

  it('lists a call that starts ringing', async () => {
    await ready()
    listener!({ type: 'call:incoming', call: ringing('c1') })
    expect(useStore.getState().calls.incoming.map((c) => c.id)).toEqual(['c1'])
  })

  it('takes call:state as the whole picture: the active call, and ringing calls that are gone are removed', async () => {
    await ready()
    listener!({ type: 'call:incoming', call: ringing('c1') })
    const state: CallState = { active: { id: 'c1', accountId: 'a1', platform: 'messenger', kind: 'video', startedAt: 9 }, incoming: [] }
    listener!({ type: 'call:state', state })
    expect(useStore.getState().calls.active?.id).toBe('c1')
    expect(useStore.getState().calls.incoming).toEqual([])
  })

  it('shows a call that was already ringing before the window listened, and keeps one that arrives meanwhile', async () => {
    callsState.mockResolvedValue({ incoming: [ringing('c0')] })
    const done = useStore.getState().init()
    await Promise.resolve()
    listener!({ type: 'call:incoming', call: ringing('c1') })
    resolvers.accounts!([])
    await done
    expect(useStore.getState().calls.incoming.map((c) => c.id)).toEqual(['c0', 'c1'])
  })
})
