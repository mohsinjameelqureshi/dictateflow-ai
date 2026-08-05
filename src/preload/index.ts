import { contextBridge } from 'electron'
import { WIDGET_ROLE_ARG } from '../shared/ipc-channels.js'
import { mainApi } from './main-api.js'
import { widgetApi } from './widget-api.js'

/**
 * One preload, two surfaces.
 *
 * §6.7 fixes `sandbox: true`, and a sandboxed preload "runs as plain
 * JavaScript without an ESM context" and cannot load a second file — so the
 * build has to emit a single self-contained CommonJS bundle. Two entry points
 * would make Rollup hoist the shared IPC channel constants into a chunk that
 * the sandbox then refuses to require.
 *
 * The window therefore identifies itself through `additionalArguments`, and
 * each renderer still receives ONLY its own surface: the widget never gets
 * database or API-key access, which is the property that mattered about
 * having two bridges in the first place.
 */
const isWidget = process.argv.includes(WIDGET_ROLE_ARG)

if (isWidget) contextBridge.exposeInMainWorld('wisprWidget', widgetApi)
else contextBridge.exposeInMainWorld('wispr', mainApi)

export type { WisprApi } from './main-api.js'
export type { WidgetApi } from './widget-api.js'
