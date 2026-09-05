import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { WebSocket } from 'ws'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { createLog } from './wsDebugLog.js'
import type { WsDebugLog } from './wsDebugLog.js'

export interface LocalSession {
  id: string
  tmuxName: string
  proc: IPty
  ws: WebSocket | null
  status: 'connected' | 'detached'
  hadClient: boolean
  _disposeProc?: () => void
}

const sessions = new Map<string, LocalSession>()

// The server's own configuration must not leak into the terminals it spawns.
// pty.spawn used to receive process.env verbatim, so every pane inherited
// DATA_DIR, TTY_DEBUG, PORT and (once set) AUTH_TOKEN — the web terminal's
// password readable by anything running in any pane. It also caused real
// confusion: a shell in a pane sees tty's DATA_DIR as its own.
//
// This is a denylist rather than an allowlist on purpose. These panes are
// general-purpose shells and an allowlist would silently break whatever the
// user relies on; the harm here is specifically tty's own config, so that is
// what gets removed. Extend with TTY_ENV_BLOCK=FOO,BAR.
const BLOCKED_ENV = new Set(
  [
    'PORT', 'HOST', 'DATA_DIR', 'CLIENT_DIST', 'AUTH_TOKEN',
    ...(process.env.TTY_ENV_BLOCK ?? '').split(',').map(k => k.trim()).filter(Boolean),
  ].map(k => k.toUpperCase())
)

function terminalEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    // Drop the server's config plus every TTY_* knob (TTY_DEBUG, thresholds...).
    if (BLOCKED_ENV.has(key.toUpperCase()) || key.toUpperCase().startsWith('TTY_')) continue
    out[key] = value
  }
  return out
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Where the tmux CLIENT process runs. Distinct from -c below, which sets the
// directory of the new session's first pane; both are pointed at the workspace
// so the shell and anything it inherits agree on where they are.
function startDir(cwd?: string): string {
  if (cwd && existsSync(cwd)) return cwd
  return process.env.HOME ?? '/'
}

// `new-session -A` attaches to an existing session and IGNORES -c. That is the
// behaviour we want: a workspace's directory decides where a session starts,
// never where an already-running one has been cd'd to since.
function tmuxArgs(tmuxName: string, cols: number, rows: number, cwd?: string): string[] {
  const args = ['new-session', '-A', '-s', tmuxName, '-x', String(cols), '-y', String(rows)]
  if (cwd && existsSync(cwd)) args.push('-c', cwd)
  return args
}

function sendHistory(tmuxName: string, ws: WebSocket, log: WsDebugLog): void {
  try {
    const history = execSync(
      `tmux capture-pane -e -p -S -5000 -t ${tmuxName}`,
      { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024, timeout: 10000 }
    )
    if (ws.readyState === 1 && history.length > 0) {
      const normalized = Buffer.from(
        history.toString('binary')
          .replace(/\r\n/g, '\n')
          .replace(/^\n+/, '')
          .replace(/\n/g, '\r\n'),
        'binary'
      )
      log.data('HISTORY', normalized)
      ws.send(normalized)
    }
  } catch (err) {
    log.event('HISTORY_FAIL', { err: err instanceof Error ? err.message : String(err) })
  }
}

// Spawn a local session headlessly (no WS yet). Used by autostart.
export function spawnLocal(id: string, tmuxName: string, onSessionEnd?: () => void, cols = 80, rows = 24, cwd?: string): void {
  if (sessions.has(id)) return

  const proc = pty.spawn('tmux', tmuxArgs(tmuxName, cols, rows, cwd), {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: startDir(cwd),
    env: terminalEnv(),
  })

  const session: LocalSession = { id, tmuxName, proc, ws: null, status: 'detached', hadClient: false }
  sessions.set(id, session)

  const onExit = proc.onExit(() => {
    sessions.delete(id)
    onSessionEnd?.()
  })

  session._disposeProc = () => onExit.dispose()
}

export async function createLocal(id: string, tmuxName: string, cols: number, rows: number, ws: WebSocket, noHistory: boolean, onSessionEnd?: () => void, cwd?: string): Promise<void> {
  const log = createLog(id)
  const existing = sessions.get(id)
  if (existing) {
    log.event('CONNECT', { branch: 'steal', cols, rows, noHistory, hadClient: existing.hadClient, ptyCols: existing.proc.cols, ptyRows: existing.proc.rows })
    existing._disposeProc?.()
    existing._disposeProc = undefined
    if (existing.ws?.readyState === 1) existing.ws.close(1000, 'stolen')
    existing.ws = ws

    if (cols !== existing.proc.cols || rows !== existing.proc.rows) {
      log.event('RESIZE_AT_CONNECT', { cols, rows })
      existing.proc.resize(cols, rows)
      await delay(100)
    }

    if (existing.hadClient && !noHistory) {
      log.event('HISTORY_SEND')
      sendHistory(tmuxName, ws, log)
    } else {
      log.event('HISTORY_SKIP', { reason: !existing.hadClient ? 'no-prior-client' : 'noHistory-flag' })
    }
    existing.hadClient = true

    pipe(existing, ws, onSessionEnd, log)
    return
  }

  log.event('CONNECT', { branch: 'spawn', cols, rows, noHistory })
  const proc = pty.spawn('tmux', tmuxArgs(tmuxName, cols, rows, cwd), {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: startDir(cwd),
    env: terminalEnv(),
  })

  const session: LocalSession = { id, tmuxName, proc, ws, status: 'connected', hadClient: true }
  sessions.set(id, session)

  pipe(session, ws, onSessionEnd, log)
}

function pipe(session: LocalSession, ws: WebSocket, onSessionEnd: (() => void) | undefined, log: WsDebugLog) {
  const onData = session.proc.onData((data) => {
    if (ws.readyState === 1) {
      const buf = Buffer.from(data)
      log.data('PTY', buf)
      ws.send(buf)
    }
  })

  const onExit = session.proc.onExit(() => {
    log.event('PTY_EXIT')
    sessions.delete(session.id)
    if (ws.readyState === 1) ws.close(4001, 'session ended')
    onSessionEnd?.()
  })

  session._disposeProc = () => { onData.dispose(); onExit.dispose() }

  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  let pendingCols = 0
  let pendingRows = 0

  ws.on('message', (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'input') {
        session.proc.write(msg.data)
      } else if (msg.type === 'resize') {
        pendingCols = Math.max(1, Math.min(500, Math.trunc(Number(msg.cols)))) || 80
        pendingRows = Math.max(1, Math.min(200, Math.trunc(Number(msg.rows)))) || 24
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          resizeTimer = null
          if (pendingCols !== session.proc.cols || pendingRows !== session.proc.rows) {
            log.event('RESIZE_APPLY', { cols: pendingCols, rows: pendingRows, prevCols: session.proc.cols, prevRows: session.proc.rows })
            session.proc.resize(pendingCols, pendingRows)
          } else {
            log.event('RESIZE_NOOP', { cols: pendingCols, rows: pendingRows })
          }
        }, 100)
      }
    } catch { /* ignore malformed messages */ }
  })

  ws.once('close', () => {
    log.event('WS_CLOSE', { stillActive: session.ws === ws })
    log.close()
    if (resizeTimer) clearTimeout(resizeTimer)
    onData.dispose()
    onExit.dispose()
    if (session.ws === ws) {
      session._disposeProc = undefined
      session.ws = null
      session.status = 'detached'
    }
  })
}

export function killLocal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session._disposeProc?.()
  session._disposeProc = undefined
  try {
    session.proc.kill()
  } catch { /* already dead */ }
  session.ws?.close()
  sessions.delete(id)
}

// Graceful-shutdown counterpart to killLocal(): give up our side of the
// connection without touching the pty.
//
// killLocal() is a user asking for the session to end, so it kills. Shutdown is
// not that — the tmux SERVER outlives this process, so tearing down its clients
// on the way out actively works against the thing that makes sessions durable.
// The tmux client exits on its own when this process does and the pty master
// closes; the server, the session and everything running in it survive.
//
// Listeners are disposed first so the pty's exit during shutdown does not fire
// onSessionEnd and count a miss against a session that is perfectly healthy.
export function detachLocal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session._disposeProc?.()
  session._disposeProc = undefined
  try { session.ws?.close(1001, 'server shutting down') } catch { /* already gone */ }
  session.ws = null
  session.status = 'detached'
  sessions.delete(id)
}

export function getLocal(id: string): LocalSession | undefined {
  return sessions.get(id)
}
