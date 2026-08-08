import { app } from 'electron'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import * as schema from './schema.js'

export type Db = BetterSQLite3Database<typeof schema>

let db: Db | null = null
let sqlite: Database.Database | null = null

/**
 * Migrations are generated at build time into src/db/migrations and copied
 * into the bundle. In dev they sit in the repo; packaged, they live next to
 * the compiled main process inside the asar.
 */
function migrationsFolder(): string {
  const candidates = [
    join(app.getAppPath(), 'out', 'main', 'migrations'),
    join(app.getAppPath(), 'src', 'db', 'migrations'),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    throw new Error(
      `No migrations folder found. Looked in:\n  ${candidates.join('\n  ')}\n` +
        `Run \`npm run db:generate\`.`,
    )
  }
  return found
}

export function initDb(): Db {
  if (db) return db

  const file = join(app.getPath('userData'), 'typeflow.db')
  sqlite = new Database(file)

  // WAL keeps reads from blocking the write that happens right after every
  // dictation. FK enforcement is off by default in SQLite.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })

  return db
}

export function getDb(): Db {
  if (!db) throw new Error('initDb() must be called before getDb()')
  return db
}

export function closeDb(): void {
  sqlite?.close()
  sqlite = null
  db = null
}

export { schema }
