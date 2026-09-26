import type { UnisonBridge } from '@shared/bridge'

declare global {
  interface Window {
    unison: UnisonBridge
  }
}

export {}
