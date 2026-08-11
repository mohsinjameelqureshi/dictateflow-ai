import type { DictateFlowApi } from './main-api.js'
import type { WidgetApi } from './widget-api.js'

declare global {
  interface Window {
    dictateflow: DictateFlowApi
    /** Only exposed in the widget renderer — the main window does not get it. */
    dictateflowWidget: WidgetApi
  }
}

export {}
