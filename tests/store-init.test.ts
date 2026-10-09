import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, AuthPrompt, BridgeEvent } from '../src/shared/types'
import { DEFAULT_SETTINGS } from '../src/shared/types'

// Headless store, like store-send.test.ts: the bridge is a hand-made object whose lists we resolve by hand.
let listener: ((event: BridgeEvent) => void) | undefined
const resolvers: { accounts?: (a: Account[]) => void } = {}
const pending = vi.fn()
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
  useStore.setState({ ready: false, accounts: {}, conversations: {}, authPrompts: [] })
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
