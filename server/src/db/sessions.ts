import { getDb } from './database.js'
import type { SessionConfig, StoredSession } from '../types.js'

interface SessionRow {
  id: string
  project_id: string | null
  project_session_id: string | null
  host: string
  port: number
  username: string
  auth_type: string
  key_path: string | null
  tmux_name: string
  display_name: string | null
  status: string
  created_at: string
  last_activity: string
  missing_probes: number | null
  orphaned_at: string | null
}

export function saveSession(session: StoredSession): void {
  const db = getDb()
  db.prepare(`
    INSERT OR REPLACE INTO active_sessions
      (id, project_id, project_session_id, host, port, username, auth_type, key_path,
       tmux_name, display_name, status, created_at, last_activity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.config.projectId ?? null,
    session.config.projectSessionId ?? null,
    session.config.host,
    session.config.port,
    session.config.username,
    session.config.authType,
    session.config.keyPath ?? null,
    session.tmuxName,
    session.config.displayName ?? null,
    session.status,
    session.createdAt.toISOString(),
    session.lastActivity.toISOString(),
  )
}

export function removeSession(id: string): void {
  getDb().prepare('DELETE FROM active_sessions WHERE id = ?').run(id)
}

export function updateSessionStatus(id: string, status: string): void {
  getDb().prepare('UPDATE active_sessions SET status = ? WHERE id = ?').run(status, id)
}

// Session was found alive — clear the miss counter and any orphan marking.
export function markSessionFound(id: string): void {
  getDb().prepare(
    `UPDATE active_sessions
        SET missing_probes = 0, orphaned_at = NULL, last_activity = ?
      WHERE id = ?`
  ).run(new Date().toISOString(), id)
}

// Session was not found by an *authoritative* probe. Returns the new count.
// Deliberately does not delete: rows are only ever marked, so a transient
// probe failure can no longer erase session history.
export function bumpMissingProbes(id: string): number {
  const db = getDb()
  db.prepare('UPDATE active_sessions SET missing_probes = COALESCE(missing_probes, 0) + 1 WHERE id = ?').run(id)
  const row = db.prepare('SELECT missing_probes FROM active_sessions WHERE id = ?').get(id) as
    { missing_probes: number | null } | undefined
  return row?.missing_probes ?? 0
}

export function markSessionOrphaned(id: string): void {
  getDb().prepare(
    `UPDATE active_sessions
        SET status = 'orphaned', orphaned_at = COALESCE(orphaned_at, ?)
      WHERE id = ?`
  ).run(new Date().toISOString(), id)
}

export function loadAllSessions(): StoredSession[] {
  const rows = getDb().prepare('SELECT * FROM active_sessions').all() as SessionRow[]
  return rows.map(rowToSession)
}

function rowToSession(row: SessionRow): StoredSession {
  const config: SessionConfig = {
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type as SessionConfig['authType'],
    keyPath: row.key_path ?? undefined,
    displayName: row.display_name ?? undefined,
    projectId: row.project_id ?? undefined,
    projectSessionId: row.project_session_id ?? undefined,
  }
  return {
    id: row.id,
    config,
    tmuxName: row.tmux_name,
    status: row.status as StoredSession['status'],
    createdAt: new Date(row.created_at),
    lastActivity: new Date(row.last_activity),
    missingProbes: row.missing_probes ?? 0,
    orphanedAt: row.orphaned_at ? new Date(row.orphaned_at) : undefined,
  }
}
