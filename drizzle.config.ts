import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are generated into src/db/migrations and shipped with the app,
 * then applied at startup against the real DB in userData. drizzle-kit never
 * touches the user's database — `dbCredentials` points at a throwaway file
 * used only for generation.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: { url: './.drizzle-scratch.db' },
  strict: true,
  verbose: true,
})
