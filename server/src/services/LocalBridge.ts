import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { WebSocket } from 'ws'
import { execSync } from 'child_process'

export interface LocalSession {
  id: string
  tmuxName: string
  proc: IPty
  ws: WebSocket | null
  status: 'connected' | 'detached'
  hadClient: boolean           // true after first WS connection — used to gate history replay
  _disposeProc?: () => void    // current onData + onExit disposables
}

const sessions = new Map<string, LocalSession>()

function sendHistory(tmuxName: string, ws: WebSocket): void {
  try {
    const history = execSync(
      `tmux capture-pane -e -p -S -5000 -t ${tmuxName}`,
      { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024, timeout: 10000 }
    )
    if (ws.readyState === 1 && history.length > 0) {
      // capture-pane outputs \n but xterm.js needs \r\n — without the \r,
      // each line starts where the previous ended instead of at column 0.
      const normalized = Buffer.from(
        history.toString('binary')
          .replace(/\r\n/g, '\n')
          .replace(/^\n+/, '')   // strip leading blank lines (tmux -S padding when scrollback < 5000)
          .replace(/\n/g, '\r\n'),
        'binary'
      )
      ws.send(normalized)
    }
  } catch { /* tmux session may not exist yet */ }
}

// Spawn a local session headlessly (no WS yet). Used by autostart.
export function spawnLocal(id: string, tmuxName: string, onSessionEnd?: () => void, cols = 220, rows = 50): void {
  if (sessions.has(id)) return

  const proc = pty.spawn('tmux', ['new-session', '-A', '-s', tmuxName, '-x', String(cols), '-y', String(rows)], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME ?? '/',
    env: process.env as Record<string, string>,
  })

  const session: LocalSession = { id, tmuxName, proc, ws: null, status: 'detached', hadClient: false }
  sessions.set(id, session)

  const onExit = proc.onExit(() => {
    sessions.delete(id)
    onSessionEnd?.()
  })

  session._disposeProc = () => onExit.dispose()
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function createLocal(id: string, tmuxName: string, cols: number, rows: number, ws: WebSocket, noHistory: boolean, onSessionEnd?: () => void): Promise<void> {
  // Steal existing if alive
  const existing = sessions.get(id)
  if (existing) {
    // Explicitly dispose previous proc listeners before registering new ones
    existing._disposeProc?.()
    existing._disposeProc = undefined
    if (existing.ws?.readyState === 1) existing.ws.close(1000, 'stolen')
    existing.ws = ws
    // Resize FIRST so tmux reflows content to the client's dimensions.
    if (cols !== existing.proc.cols || rows !== existing.proc.rows) {
      existing.proc.resize(cols, rows)
      // Wait for tmux to process SIGWINCH and reflow content.
      // The resize is synchronous (node-pty) but tmux handles the signal
      // asynchronously — capturing immediately gets stale layout.
      await delay(100)
    }
    // Send history only when the client requests it (noHistory=false).
    // On WebSocket reconnect the xterm buffer is still intact, so the client
    // sets noHistory=true to avoid a redundant 5000-line replay ("rescroll").
    if (existing.hadClient && !noHistory) {
      sendHistory(tmuxName, ws)
    }
    existing.hadClient = true
    pipe(existing, ws, onSessionEnd)
    return
  }

  const proc = pty.spawn('tmux', ['new-session', '-A', '-s', tmuxName, '-x', String(cols), '-y', String(rows)], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME ?? '/',
    env: process.env as Record<string, string>,
  })

  const session: LocalSession = { id, tmuxName, proc, ws, status: 'connected', hadClient: true }
  sessions.set(id, session)

  pipe(session, ws, onSessionEnd)
}

function pipe(session: LocalSession, ws: WebSocket, onSessionEnd?: () => void) {
  const onData = session.proc.onData((data) => {
    if (ws.readyState === 1) ws.send(Buffer.from(data))
  })

  const onExit = session.proc.onExit(() => {
    sessions.delete(session.id)
    // 4001 = session ended naturally — client uses this to navigate back
    if (ws.readyState === 1) ws.close(4001, 'session ended')
    onSessionEnd?.()
  })

  session._disposeProc = () => { onData.dispose(); onExit.dispose() }

  // Debounce resize on the server side to coalesce rapid resize messages.
  // Each resize triggers SIGWINCH → tmux redraws the full screen. Without
  // debouncing, rapid resizes from grid layout cause repeated redraws.
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
            session.proc.resize(pendingCols, pendingRows)
          }
        }, 100)
      }
      // 'ping' and other types are silently ignored
    } catch { /* ignore malformed messages */ }
  })

  ws.once('close', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    onData.dispose()
    onExit.dispose()
    session._disposeProc = undefined
    session.ws = null
    session.status = 'detached'
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

export function getLocal(id: string): LocalSession | undefined {
  return sessions.get(id)
}
