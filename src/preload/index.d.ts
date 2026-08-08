import type { TypeFlowApi } from './main-api.js'
import type { WidgetApi } from './widget-api.js'

declare global {
  interface Window {
    typeflow: TypeFlowApi
    /** Only exposed in the widget renderer — the main window does not get it. */
    typeflowWidget: WidgetApi
  }
}

export {}
