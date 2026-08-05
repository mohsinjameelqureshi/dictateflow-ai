import type { WisprApi } from './index.js'

declare global {
  interface Window {
    wispr: WisprApi
  }
}

export {}
