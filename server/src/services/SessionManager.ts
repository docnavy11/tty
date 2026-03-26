import { Client } from 'ssh2'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'
import type { SessionConfig, StoredSession } from '../types.js'
import { createLocal, spawnLocal, killLocal } from './LocalBridge.js'
import { saveSession, removeSession, loadAllSessions, updateSessionStatus } from '../db/sessions.js'
import { projectManager } from './ProjectManager.js'

interface LiveSession extends StoredSession {
  conn: Client
  channel: ClientChannel
  ws: WebSocket | null
}

class SessionManager {
  private sessions = new Map<string, StoredSession>()
  private live = new Map<string, LiveSession>()
  private launching = new Set<string>()

  create(config: SessionConfig): string {
    const id = randomUUID()
    const session: StoredSession = {
      id,
      config,
      tmuxName: `wt_${id.replace(/-/g, '').slice(0, 16)}`,
      status: 'pending',
      createdAt: new Date(),
      lastActivity: new Date(),
    }
    this.sessions.set(id, session)
    saveSession(session)
    return id
  }

  get(id: string): StoredSession | undefined {
    return this.sessions.get(id)
  }

  list(): StoredSession[] {
    return Array.from(this.sessions.values())
  }

  // Called on proxy boot — restore sessions from SQLite
  recover(): void {
    const rows = loadAllSessions()
    let restored = 0

    for (const session of rows) {
      if (session.config.authType === 'local') {
        // Check if tmux session is still alive
        const alive = tmuxSessionExists(session.tmuxName)
        if (alive) {
          this.sessions.set(session.id, { ...session, status: 'detached' })
          updateSessionStatus(session.id, 'detached')
          restored++
        } else {
          // tmux died while proxy was down — clean up
          removeSession(session.id)
        }
      } else {
        // SSH sessions: restore as detached, reconnect when browser attaches
        this.sessions.set(session.id, { ...session, status: 'detached' })
        updateSessionStatus(session.id, 'detached')
        restored++
      }
    }

    if (restored > 0) {
      console.log(`Recovered ${restored} session(s) from previous run`)
    }
  }

  async connect(id: string, ws: WebSocket, cols: number, rows: number, noHistory = false): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Session ${id} not found`)

    // Local session — no SSH, spawn tmux directly
    if (session.config.authType === 'local') {
      const updated = { ...session, status: 'connected' as const }
      this.sessions.set(id, updated)
      updateSessionStatus(id, 'connected')
      await createLocal(id, session.tmuxName, cols, rows, ws, noHistory, () => {
        this.sessions.delete(id)
        removeSession(id)
      })
      return
    }

    // Steal existing SSH connection if alive
    const existing = this.live.get(id)
    if (existing) {
      if (existing.ws && existing.ws.readyState === 1) {
        existing.ws.close(1000, 'stolen by new connection')
      }
      existing.ws = ws
      this.pipeChannelToWs(existing.channel, ws, id)
      this.pipeWsToChannel(ws, existing.conn, existing.channel, existing.tmuxName)
      return
    }

    session.status = 'connecting'

    const conn = new Client()

    await new Promise<void>((resolve, reject) => {
      conn.on('ready', () => {
        conn.shell(
          { rows, cols, term: 'xterm-256color' },
          (err, channel) => {
            if (err) { reject(err); return }

            channel.write(`tmux new-session -A -s ${session.tmuxName} -x ${cols} -y ${rows}\n`)

            const liveSession: LiveSession = {
              ...session,
              status: 'connected',
              conn,
              channel,
              ws,
            }
            this.live.set(id, liveSession)
            const updated = { ...session, status: 'connected' as const }
            this.sessions.set(id, updated)
            updateSessionStatus(id, 'connected')

            this.pipeChannelToWs(channel, ws, id)
            this.pipeWsToChannel(ws, conn, channel, session.tmuxName)

            resolve()
          }
        )
      })

      conn.on('error', reject)

      const connectConfig: ConnectConfig = {
        host: session.config.host,
        port: session.config.port,
        username: session.config.username,
        keepaliveInterval: 10000,
        readyTimeout: 15000,
      }

      if (session.config.authType === 'key') {
        const home = process.env.HOME ?? '/root'
        const candidates = session.config.keyPath
          ? [session.config.keyPath.replace(/^~/, home)]
          : [`${home}/.ssh/id_ed25519`, `${home}/.ssh/id_rsa`, `${home}/.ssh/id_ecdsa`]
        for (const keyPath of candidates) {
          try { connectConfig.privateKey = readFileSync(keyPath); break } catch { /* try next */ }
        }
        if (!connectConfig.privateKey) {
          throw new Error('No SSH key found on proxy server.')
        }
      } else if (session.config.authType === 'password') {
        connectConfig.password = session.config.password
      }

      conn.connect(connectConfig)
    })
  }

  private pipeChannelToWs(channel: ClientChannel, ws: WebSocket, sessionId: string) {
    const onData = (data: Buffer) => {
      if (ws.readyState === 1) ws.send(data)
    }
    const onClose = () => {
      const live = this.live.get(sessionId)
      if (live) {
        this.live.delete(sessionId)
        const updated = { ...live, status: 'detached' as const }
        this.sessions.set(sessionId, updated)
        updateSessionStatus(sessionId, 'detached')
      }
      if (ws.readyState === 1) ws.close()
    }
    channel.on('data', onData)
    channel.once('close', onClose)
  }

  private pipeWsToChannel(ws: WebSocket, conn: Client, channel: ClientChannel, tmuxName: string) {
    ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'input') {
          channel.write(msg.data)
        } else if (msg.type === 'resize') {
          const cols = Math.max(1, Math.min(500, Math.trunc(Number(msg.cols)))) || 80
          const rows = Math.max(1, Math.min(200, Math.trunc(Number(msg.rows)))) || 24
          channel.setWindow(rows, cols, 0, 0)
          conn.exec(
            `tmux resize-window -t ${tmuxName} -x ${cols} -y ${rows}`,
            (err, ch) => { if (!err) ch.resume() }
          )
        }
      } catch { /* ignore malformed messages */ }
    })
  }

  launchProject(projectId: string): string[] {
    if (this.launching.has(projectId)) {
      return Array.from(this.sessions.values())
        .filter(s => s.config.projectId === projectId)
        .map(s => s.id)
    }
    this.launching.add(projectId)
    try {
      return this._launchProject(projectId)
    } finally {
      this.launching.delete(projectId)
    }
  }

  private _launchProject(projectId: string): string[] {
    const defs = projectManager.listSessionDefs(projectId)
    const existing = Array.from(this.sessions.values()).filter(s => s.config.projectId === projectId)
    const launchedDefIds = new Set(existing.map(s => s.config.projectSessionId))

    // Sync displayName from latest session def (picks up renames)
    for (const session of existing) {
      const def = defs.find(d => d.id === session.config.projectSessionId)
      if (def) session.config.displayName = def.name
    }

    // Launch any definitions not yet running
    const newIds = defs
      .filter(def => !launchedDefIds.has(def.id))
      .map(def => this.create({
        host: def.host,
        port: def.port,
        username: def.username,
        authType: def.authType as 'key' | 'password' | 'local',
        keyPath: def.keyPath,
        displayName: def.name,
        projectId,
        projectSessionId: def.id,
      }))

    return [...existing.map(s => s.id), ...newIds]
  }

  // Spawn a local session's pty immediately without waiting for a browser WS.
  // Used by autostart so processes are actually running on boot.
  spawn(id: string): void {
    const session = this.sessions.get(id)
    if (!session || session.config.authType !== 'local') return
    spawnLocal(id, session.tmuxName, () => {
      this.sessions.delete(id)
      removeSession(id)
    })
    const updated = { ...session, status: 'detached' as const }
    this.sessions.set(id, updated)
    updateSessionStatus(id, 'detached')
  }

  stopProject(projectId: string): void {
    const sessions = Array.from(this.sessions.values()).filter(s => s.config.projectId === projectId)
    for (const s of sessions) this.kill(s.id)
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (session?.config.authType === 'local') {
      killLocal(id)
      this.sessions.delete(id)
      removeSession(id)
      return
    }

    const live = this.live.get(id)
    if (live) {
      live.conn.exec(`tmux kill-session -t ${live.tmuxName}`, (err, ch) => {
        if (!err) ch.resume()
      })
      setTimeout(() => { live.ws?.close(); live.conn.end() }, 300)
      this.live.delete(id)
    }
    this.sessions.delete(id)
    removeSession(id)
  }

  // Called on graceful shutdown: kill PTY processes and close SSH connections.
  // DB records are kept so local sessions can be recovered on next boot.
  shutdownAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      const session = this.sessions.get(id)
      if (session?.config.authType === 'local') {
        killLocal(id) // kills pty proc + closes ws; DB record untouched
      }
      const live = this.live.get(id)
      if (live) {
        live.ws?.close()
        live.conn.end()
        this.live.delete(id)
      }
    }
  }
}

function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export const sessionManager = new SessionManager()
