import { getDb } from '../db/database.js'
import { randomUUID } from 'crypto'

export interface Project {
  id: string
  name: string
  autostart: boolean
  idleTtl: number
  tabOrder: number
  createdAt: string
}

export interface SessionDef {
  id: string
  projectId: string
  name: string
  host: string
  port: number
  username: string
  authType: string
  keyPath?: string
  autoCommands: string[]
  agentForward: boolean
  tabOrder: number
}

class ProjectManager {
  createProject(name: string, autostart = false): Project {
    const id = randomUUID()
    getDb().prepare(
      'INSERT INTO projects (id, name, autostart) VALUES (?, ?, ?)'
    ).run(id, name, autostart ? 1 : 0)
    return this.getProject(id)!
  }

  getProject(id: string): Project | undefined {
    const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id)
    if (!row) return undefined
    return rowToProject(row as Record<string, unknown>)
  }

  listProjects(): Project[] {
    const rows = getDb().prepare('SELECT * FROM projects ORDER BY tab_order, created_at').all()
    return rows.map(r => rowToProject(r as Record<string, unknown>))
  }

  updateProject(id: string, updates: Partial<{ name: string; autostart: boolean; idleTtl: number; tabOrder: number }>): void {
    const fields: string[] = []
    const values: unknown[] = []
    if (updates.name !== undefined)      { fields.push('name = ?');      values.push(updates.name) }
    if (updates.autostart !== undefined) { fields.push('autostart = ?'); values.push(updates.autostart ? 1 : 0) }
    if (updates.idleTtl !== undefined)   { fields.push('idle_ttl = ?');  values.push(updates.idleTtl) }
    if (updates.tabOrder !== undefined)  { fields.push('tab_order = ?'); values.push(updates.tabOrder) }
    if (fields.length > 0) {
      values.push(id)
      getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }
  }

  deleteProject(id: string): void {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  addSessionDef(projectId: string, config: {
    name: string
    host: string
    port?: number
    username: string
    authType: string
    keyPath?: string
    autoCommands?: string[]
    agentForward?: boolean
    tabOrder?: number
  }): SessionDef {
    const id = randomUUID()
    getDb().prepare(`
      INSERT INTO project_sessions
        (id, project_id, name, host, port, username, auth_type, key_path, auto_commands, agent_forward, tab_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, projectId, config.name, config.host, config.port ?? 22,
      config.username, config.authType, config.keyPath ?? null,
      JSON.stringify(config.autoCommands ?? []),
      config.agentForward !== false ? 1 : 0,
      config.tabOrder ?? 0
    )
    return this.getSessionDef(id)!
  }

  getSessionDef(id: string): SessionDef | undefined {
    const row = getDb().prepare('SELECT * FROM project_sessions WHERE id = ?').get(id)
    if (!row) return undefined
    return rowToSessionDef(row as Record<string, unknown>)
  }

  listSessionDefs(projectId: string): SessionDef[] {
    const rows = getDb().prepare(
      'SELECT * FROM project_sessions WHERE project_id = ? ORDER BY tab_order, created_at'
    ).all(projectId)
    return rows.map(r => rowToSessionDef(r as Record<string, unknown>))
  }

  updateSessionDef(id: string, updates: Partial<{
    name: string; host: string; port: number; username: string
    authType: string; keyPath: string | null; autoCommands: string[]
    agentForward: boolean; tabOrder: number
  }>): void {
    const fields: string[] = []
    const values: unknown[] = []
    if (updates.name !== undefined)         { fields.push('name = ?');          values.push(updates.name) }
    if (updates.host !== undefined)         { fields.push('host = ?');          values.push(updates.host) }
    if (updates.port !== undefined)         { fields.push('port = ?');          values.push(updates.port) }
    if (updates.username !== undefined)     { fields.push('username = ?');      values.push(updates.username) }
    if (updates.authType !== undefined)     { fields.push('auth_type = ?');     values.push(updates.authType) }
    if ('keyPath' in updates)               { fields.push('key_path = ?');      values.push(updates.keyPath ?? null) }
    if (updates.autoCommands !== undefined) { fields.push('auto_commands = ?'); values.push(JSON.stringify(updates.autoCommands)) }
    if (updates.agentForward !== undefined) { fields.push('agent_forward = ?'); values.push(updates.agentForward ? 1 : 0) }
    if (updates.tabOrder !== undefined)     { fields.push('tab_order = ?');     values.push(updates.tabOrder) }
    if (fields.length > 0) {
      values.push(id)
      getDb().prepare(`UPDATE project_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }
  }

  deleteSessionDef(id: string): void {
    getDb().prepare('DELETE FROM project_sessions WHERE id = ?').run(id)
  }
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    autostart: Boolean(row.autostart),
    idleTtl: row.idle_ttl as number,
    tabOrder: row.tab_order as number,
    createdAt: row.created_at as string,
  }
}

function rowToSessionDef(row: Record<string, unknown>): SessionDef {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    host: row.host as string,
    port: row.port as number,
    username: row.username as string,
    authType: row.auth_type as string,
    keyPath: row.key_path as string | undefined,
    autoCommands: JSON.parse((row.auto_commands as string) ?? '[]'),
    agentForward: Boolean(row.agent_forward),
    tabOrder: row.tab_order as number,
  }
}

export const projectManager = new ProjectManager()
