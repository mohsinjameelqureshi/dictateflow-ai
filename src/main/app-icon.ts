import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The app icon, resolved once.
 *
 * Two different consumers with two different needs:
 *
 * - electron-builder reads `build/icon.png` on its own (it is `buildResources`)
 *   and generates the .ico for the installer and the .exe. Nothing here is
 *   involved in that.
 * - The tray and the BrowserWindows need the icon at *runtime*. It cannot be
 *   loaded from inside the asar reliably, so electron-builder copies it out to
 *   `resources/icon.png` via `extraResources` — see electron-builder.yml.
 *
 * In dev there is no packaged resources dir, so we read it straight out of
 * `build/`.
 */

const CANDIDATES = app.isPackaged
  ? [join(process.resourcesPath, 'icon.png')]
  : [join(app.getAppPath(), 'build', 'icon.png')]

let cached: NativeImage | null = null

/**
 * Full-resolution icon. Empty rather than throwing if the file is missing —
 * a fresh checkout that has not generated the icon should still start.
 */
export function appIcon(): NativeImage {
  if (cached) return cached
  for (const path of CANDIDATES) {
    if (!existsSync(path)) continue
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return (cached = image)
  }
  return (cached = nativeImage.createEmpty())
}

/**
 * Tray-sized icon. Windows asks for 16px at 100% scaling and 24px at 150%, so
 * a 2x representation is attached rather than letting the shell upscale a
 * 16px bitmap into a blurry one at the DPI settings we target (§14).
 */
export function trayIcon(): NativeImage {
  const source = appIcon()
  if (source.isEmpty()) return source

  const small = source.resize({ width: 16, height: 16, quality: 'best' })
  small.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: 32, height: 32, quality: 'best' }).toPNG(),
  })
  return small
}
