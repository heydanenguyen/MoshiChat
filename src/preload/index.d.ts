import type { MoshiBridge } from '@shared/bridge'

declare global {
  interface Window {
    unison: MoshiBridge
  }
}

export {}
