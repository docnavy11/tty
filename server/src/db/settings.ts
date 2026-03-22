import { getDb } from './database.js'

const DEFAULTS: Record<string, string> = {
  fontSize: '14',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  theme: 'dracula',
}

export function getSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return { ...DEFAULTS, ...stored }
}

export function setSettings(patch: Record<string, string>): void {
  const stmt = getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const tx = getDb().transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) stmt.run(key, value)
  })
  tx(Object.entries(patch))
}
