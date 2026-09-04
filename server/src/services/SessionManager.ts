import { Client } from 'ssh2'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'
import type { SessionConfig, StoredSession } from '../types.js'
import { createLocal, spawnLocal, killLocal, detachLocal } from './LocalBridge.js'
import {
  saveSession, removeSession, loadAllSessions, updateSessionStatus,
  markSessionFound, bumpMissingProbes, markSessionOrphaned,
} from '../db/sessions.js'
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

  // Called on proxy boot — restore sessions from SQLite.
  //
  // This method never deletes. A session row is the only record of a terminal's
  // name and project binding, and the probe below can report "not found" for
  // reasons that have nothing to do with the session being gone (tmux not yet
  // on PATH under systemd, the server not started, a fork failure under memory
  // pressure, the 5s timeout). Deleting on a single negative is how a restart
  // used to wipe every session. Rows are marked instead; only an explicit
  // kill() removes one.
  recover(): void {
    const rows = loadAllSessions()
    const probe = tmuxProbe()
    let restored = 0
    let orphaned = 0

    if (!probe.ok) {
      // Probe itself failed — we know nothing. Restore every session as
      // detached and touch no counters.
      for (const session of rows) {
        this.sessions.set(session.id, { ...session, status: 'detached' })
      }
      console.warn(
        `[recover] tmux probe failed (${probe.reason}) — restored ${rows.length} session(s) ` +
        'as detached without pruning. No sessions were deleted.'
      )
      return
    }

    for (const session of rows) {
      if (session.config.authType !== 'local') {
        // SSH sessions: restore as detached, reconnect when browser attaches.
        // Liveness lives on the remote host, so the local probe says nothing.
        this.sessions.set(session.id, { ...session, status: 'detached' })
        updateSessionStatus(session.id, 'detached')
        restored++
        continue
      }

      if (probe.sessions.has(session.tmuxName)) {
        this.sessions.set(session.id, { ...session, status: 'detached', missingProbes: 0 })
        updateSessionStatus(session.id, 'detached')
        markSessionFound(session.id)
        restored++
        continue
      }

      const misses = bumpMissingProbes(session.id)
      if (misses >= MISSING_PROBE_THRESHOLD) {
        markSessionOrphaned(session.id)
        this.sessions.set(session.id, { ...session, status: 'orphaned', missingProbes: misses })
        orphaned++
      } else {
        // Below the threshold — keep it looking normal, it may come back.
        this.sessions.set(session.id, { ...session, status: 'detached', missingProbes: misses })
        updateSessionStatus(session.id, 'detached')
        restored++
      }
    }

    // Sessions can exist in tmux with no row backing them: kill() deletes the
    // row but never runs `tmux kill-session`, so the UI's ✕ forgets a session
    // rather than ending it. Adopt those back instead of leaving them running
    // invisibly.
    this.reconcileTmux(probe.sessions)

    if (restored > 0) console.log(`Recovered ${restored} session(s) from previous run`)
    if (orphaned > 0) {
      console.warn(
        `[recover] ${orphaned} session(s) marked orphaned after ${MISSING_PROBE_THRESHOLD} ` +
        'consecutive misses. Records kept — delete them from the UI if they are truly gone.'
      )
    }
  }

  // Re-adopt live tmux sessions that tty created but has no record of.
  //
  // Only sessions matching tty's own naming scheme are touched — a tmux session
  // the user started by hand is theirs, not ours to claim. The original session
  // id cannot be recovered (the tmux name carries only half the UUID), so a new
  // one is minted; the tmux name is what actually matters for reattaching.
  // Project binding is genuinely unrecoverable and is left unset.
  private reconcileTmux(live: Map<string, TmuxSessionInfo>): void {
    if (process.env.TTY_RECONCILE === '0') return

    const known = new Set(Array.from(this.sessions.values()).map(s => s.tmuxName))
    let adopted = 0

    for (const [name, info] of live) {
      if (known.has(name) || !TTY_TMUX_NAME.test(name)) continue

      const id = randomUUID()
      const session: StoredSession = {
        id,
        config: {
          host: 'localhost',
          port: 22,
          username: '',
          authType: 'local',
          displayName: labelFor(name, info),
        },
        tmuxName: name,
        status: 'detached',
        createdAt: info.createdAt,
        lastActivity: new Date(),
      }
      this.sessions.set(id, session)
      saveSession(session)
      adopted++
    }

    if (adopted > 0) {
      console.log(`[recover] adopted ${adopted} live tmux session(s) that had no database record`)
    }
  }

  // A PTY exiting means the tmux *client* died. That does not imply the tmux
  // session is gone (a cgroup kill, an OOM, or a crashed client all land here),
  // so probe before concluding anything, and never delete.
  private handleSessionEnd(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return

    const probe = tmuxProbe()
    if (!probe.ok) {
      this.sessions.set(id, { ...session, status: 'detached' })
      updateSessionStatus(id, 'detached')
      console.warn(`[session ${id}] pty exited; tmux probe failed (${probe.reason}) — kept as detached`)
      return
    }

    if (probe.sessions.has(session.tmuxName)) {
      // tmux session outlived its client — exactly the case worth preserving.
      this.sessions.set(id, { ...session, status: 'detached', missingProbes: 0 })
      updateSessionStatus(id, 'detached')
      markSessionFound(id)
      return
    }

    const misses = bumpMissingProbes(id)
    if (misses >= MISSING_PROBE_THRESHOLD) {
      markSessionOrphaned(id)
      this.sessions.set(id, { ...session, status: 'orphaned', missingProbes: misses })
    } else {
      this.sessions.set(id, { ...session, status: 'detached', missingProbes: misses })
      updateSessionStatus(id, 'detached')
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
        this.handleSessionEnd(id)
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
      this.handleSessionEnd(id)
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

  // Called on graceful shutdown. Detaches; it does not kill.
  //
  // This used to call killLocal(), tearing down every pty on the way out. That
  // is the opposite of what shutdown should do here: tmux sessions are the
  // durable thing, this process is the disposable one. Sessions are also left
  // marked 'detached' rather than a stale 'connected', so the next recover()
  // reads accurate state instead of inferring it.
  shutdownAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      const session = this.sessions.get(id)
      if (!session) continue

      if (session.config.authType === 'local') {
        detachLocal(id)
      }

      const live = this.live.get(id)
      if (live) {
        live.ws?.close(1001, 'server shutting down')
        live.conn.end()
        this.live.delete(id)
      }

      if (session.status !== 'orphaned') {
        this.sessions.set(id, { ...session, status: 'detached' })
        updateSessionStatus(id, 'detached')
      }
    }
  }
}

// Number of consecutive authoritative misses before a session is marked
// orphaned. Override with TTY_MISSING_PROBE_THRESHOLD.
const MISSING_PROBE_THRESHOLD = Math.max(
  1,
  parseInt(process.env.TTY_MISSING_PROBE_THRESHOLD ?? '3', 10) || 3,
)

// tty's own session names: `wt_` + 16 hex chars (see create()). Anything else
// in the tmux server belongs to the user and must be left alone.
const TTY_TMUX_NAME = /^wt_[0-9a-f]{16}$/

export interface TmuxSessionInfo {
  createdAt: Date
  cwd: string
}

type TmuxProbe =
  | { ok: true; sessions: Map<string, TmuxSessionInfo> }
  | { ok: false; reason: string }

// List every live tmux session in one call, so a miss is a real absence from a
// known-good listing rather than the failure of a per-session command.
//
// The distinction that matters: "tmux answered and this name is not in the
// list" (authoritative) versus "we could not ask" (tells us nothing). The old
// `tmux has-session` check collapsed both into false and deleted the row.
//
// Creation time and cwd come from the same call. Fetching them per-session with
// `display-message -t=NAME` does not work: there `-t` is a target-PANE, and an
// `=`-prefixed session name expands to an empty string with exit code 0 rather
// than erroring — a silent wrong answer.
function tmuxProbe(): TmuxProbe {
  try {
    const out = execSync(
      "tmux list-sessions -F '#{session_name}|#{session_created}|#{pane_current_path}'",
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const sessions = new Map<string, TmuxSessionInfo>()
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const parts = line.split('|')
      const name = parts[0]?.trim()
      if (!name) continue
      const epoch = parseInt(parts[1] ?? '', 10)
      sessions.set(name, {
        createdAt: Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date(),
        // Rejoin the remainder: a path may legitimately contain the separator.
        cwd: parts.slice(2).join('|').trim(),
      })
    }
    return { ok: true, sessions }
  } catch (err) {
    const e = err as { stderr?: Buffer | string; code?: string; signal?: string }
    const stderr = (e.stderr ? e.stderr.toString() : '').toLowerCase()

    // "no server running on ..." is tmux answering clearly: there are zero
    // sessions. That is authoritative, and yields an empty map.
    if (stderr.includes('no server running') || stderr.includes('no sessions')) {
      return { ok: true, sessions: new Map() }
    }
    if (e.code === 'ENOENT') return { ok: false, reason: 'tmux not found on PATH' }
    if (e.signal) return { ok: false, reason: `killed by ${e.signal}` }
    return { ok: false, reason: stderr.trim() || (err instanceof Error ? err.message : 'unknown') }
  }
}

// Label an adopted session after its working directory so it comes back looking
// like itself rather than an anonymous UUID.
function labelFor(name: string, info: TmuxSessionInfo): string {
  const base = info.cwd.split('/').filter(Boolean).pop()
  return base ? `${base} (recovered)` : `${name} (recovered)`
}

export const sessionManager = new SessionManager()
