import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // better-sqlite3 is a native module — it must stay external and be
    // require()'d at runtime, never bundled.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // A second entry, not a chunk of the first. It is forked as its own
          // utilityProcess so that a batch pass — roughly 0.5x real time, so
          // seconds of solid CPU — cannot stall the global hook or the tray.
          'moonshine-worker': resolve('src/main/moonshine/worker.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@db': resolve('src/db'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // A single entry, on purpose. §6.7 fixes `sandbox: true`, and a
        // sandboxed preload runs as plain CommonJS with no ESM and no ability
        // to require a second file. Both window surfaces are bundled into one
        // self-contained file and selected at runtime — see preload/index.ts.
        input: { index: resolve('src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          inlineDynamicImports: true,
        },
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          // The widget is a separate entry point (§7) — a different window
          // with different rules, not a route inside the main one. Settings is
          // not: it is a dialog in the main window.
          widget: resolve('src/renderer/widget.html'),
        },
      },
    },
  },
})
