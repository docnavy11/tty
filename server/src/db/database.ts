import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function initDb(dbPath: string): void {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  db.exec(schema)
  migrate(db)
}

// Additive migrations for databases created before a column existed.
// SQLite has no ADD COLUMN IF NOT EXISTS, so check table_info first.
function migrate(database: Database.Database): void {
  const addColumn = (table: string, column: string, definition: string) => {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (cols.some(c => c.name === column)) return
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    console.log(`[migrate] added ${table}.${column}`)
  }

  addColumn('active_sessions', 'missing_probes', 'INTEGER DEFAULT 0')
  addColumn('active_sessions', 'orphaned_at', 'DATETIME')
  addColumn('active_sessions', 'cwd', 'TEXT')
}

// Flush the WAL back into the main database file. Without this the WAL grows
// unbounded (it reached 4 MB against a 45 KB db here) and a naive file copy of
// db.sqlite captures stale data.
export function checkpoint(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (err) {
    console.warn('[db] checkpoint failed:', err instanceof Error ? err.message : err)
  }
}
