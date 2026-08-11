import { execFile } from 'node:child_process'
import { getActiveWindow } from '@nut-tree-fork/nut-js'

/**
 * The window that had focus when the shortcut was pressed.
 *
 * §6.2 requires capturing this BEFORE the widget appears — once the widget is
 * up, "what had focus" is no longer answerable.
 *
 * It is the HWND, not the title. spikes/README.md records why: Notepad
 * renames its title bar to the document's first line, so a *successful* paste
 * changes the title of the very window being checked. Anything title-based
 * produces false positives on every editor that shows a filename.
 */
export interface InsertTarget {
  hwnd: number | null
  title: string
  /** Resolves true when Windows UIPI will silently swallow our input (§6.4). */
  elevated: Promise<boolean>
}

/** `windowHandle` is private in the typings but assigned in the constructor. */
function handleOf(win: unknown): number | null {
  const raw = (win as { windowHandle?: unknown }).windowHandle
  return typeof raw === 'number' ? raw : null
}

export async function captureTarget(): Promise<InsertTarget> {
  let hwnd: number | null = null
  let title = ''

  try {
    const win = await getActiveWindow()
    hwnd = handleOf(win)
    title = await win.title
  } catch {
    // No focused window, or the provider failed. Insertion will still be
    // attempted — we just cannot pre-check it.
  }

  // Started here, awaited much later. By the time insertion happens the user
  // has spoken for seconds and Groq has round-tripped, so this costs nothing
  // in wall-clock terms even though the probe itself is slow.
  return { hwnd, title, elevated: probeElevated(hwnd) }
}

/* --------------------------------------------------------- elevation ---- */

const cache = new Map<number, boolean>()

/**
 * A non-elevated process cannot open an elevated process's main module. That
 * asymmetry is the only elevation signal available without shipping a native
 * addon, so the probe reads it: DENIED means the paste would be swallowed.
 *
 * Spawned per HWND and cached. Replace with a direct `GetWindowThreadProcessId`
 * call if a native helper ever lands — this is the slow way to learn one bit.
 */
function probeElevated(hwnd: number | null): Promise<boolean> {
  if (hwnd === null) return Promise.resolve(false)

  const hit = cache.get(hwnd)
  if (hit !== undefined) return Promise.resolve(hit)

  const script = `
$sig = @"
using System;
using System.Runtime.InteropServices;
public static class DictateFlowWin {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
}
"@
Add-Type -TypeDefinition $sig
$target = 0
[void][DictateFlowWin]::GetWindowThreadProcessId([IntPtr]${hwnd}, [ref]$target)
if ($target -eq 0) { 'UNKNOWN'; exit 0 }
$path = $null
try { $path = (Get-Process -Id $target -ErrorAction Stop).MainModule.FileName } catch { }
if ($path) { 'OPEN' } else { 'DENIED' }
`.trim()

  return new Promise<boolean>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        // Any failure of the probe itself must not block dictation. Assume
        // insertable and let the paste speak for itself.
        const elevated = !err && stdout.trim() === 'DENIED'
        cache.set(hwnd, elevated)
        resolve(elevated)
      },
    )
  })
}
