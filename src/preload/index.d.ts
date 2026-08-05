import type { WisprApi } from './main-api.js'
import type { WidgetApi } from './widget-api.js'

declare global {
  interface Window {
    wispr: WisprApi
    /** Only exposed in the widget renderer — the main window does not get it. */
    wisprWidget: WidgetApi
  }
}

export {}
