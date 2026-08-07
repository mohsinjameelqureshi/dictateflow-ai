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
        input: { index: resolve('src/main/index.ts') },
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
          // The widget and settings are separate entry points (§7) — different
          // windows with different rules, not routes inside the main one.
          widget: resolve('src/renderer/widget.html'),
          settings: resolve('src/renderer/settings.html'),
        },
      },
    },
  },
})
