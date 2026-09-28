import { create } from 'zustand'
import type { UpdateState } from '@shared/types'

const DISMISS_KEY = 'moshi.updateDismissed'

interface UpdateStore {
  state: UpdateState
  version: string
  /** Version the person said "later" to: the card stays away until the next version. */
  dismissed?: string
  init(): Promise<void>
  check(): Promise<void>
  download(): Promise<void>
  install(): void
  dismiss(): void
  openPage(): void
}

function readDismissed(): string | undefined {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** In-app updates: what main knows about newer versions, plus the person's "later". */
export const useUpdate = create<UpdateStore>((set, get) => ({
  state: { phase: 'idle' },
  version: '',
  dismissed: readDismissed(),

  async init() {
    window.unison.onEvent((event) => {
      if (event.type === 'update:state') set({ state: event.state })
    })
    const [state, version] = await Promise.all([window.unison.update.state(), window.unison.app.version()])
    set({ state, version })
  },

  async check() {
    await window.unison.update.check()
  },

  async download() {
    await window.unison.update.download()
  },

  install() {
    window.unison.update.install()
  },

  dismiss() {
    const { state } = get()
    const version = 'version' in state ? state.version : undefined
    if (!version) return
    set({ dismissed: version })
    try {
      localStorage.setItem(DISMISS_KEY, version)
    } catch {
      /* storage unavailable */
    }
  },

  openPage() {
    const { state } = get()
    void window.unison.app.openExternal('url' in state && state.url ? state.url : 'https://github.com/heydanenguyen/MoshiChat/releases/latest')
  }
}))

/** The card in the sidebar shows for news the person has not waved away. */
export function useUpdateCardVisible(): boolean {
  return useUpdate((s) => {
    const { state, dismissed } = s
    if (state.phase === 'downloading' || state.phase === 'ready') return true
    if (state.phase === 'available') return dismissed !== state.version
    return false
  })
}
