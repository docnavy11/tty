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
  _disposeProc?: () => void  // current onData + onExit disposables
}

const sessions = new Map<string, LocalSession>()

function sendHistory(tmuxName: string, ws: WebSocket): void {
  try {
    const history = execSync(
      `tmux capture-pane -e -p -S -5000 -t ${tmuxName}`,
      { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }
    )
    if (ws.readyState === 1 && history.length > 0) ws.send(history)
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

  const session: LocalSession = { id, tmuxName, proc, ws: null, status: 'detached' }
  sessions.set(id, session)

  const onExit = proc.onExit(() => {
    sessions.delete(id)
    onSessionEnd?.()
  })

  session._disposeProc = () => onExit.dispose()
}

export function createLocal(id: string, tmuxName: string, cols: number, rows: number, ws: WebSocket, onSessionEnd?: () => void): void {
  // Steal existing if alive
  const existing = sessions.get(id)
  if (existing) {
    // Explicitly dispose previous proc listeners before registering new ones
    existing._disposeProc?.()
    existing._disposeProc = undefined
    if (existing.ws?.readyState === 1) existing.ws.close(1000, 'stolen')
    existing.ws = ws
    sendHistory(tmuxName, ws)
    pipe(existing, ws, onSessionEnd)
    // Bounce resize to force SIGWINCH even when dimensions haven't changed.
    existing.proc.resize(cols, rows + 1)
    existing.proc.resize(cols, rows)
    return
  }

  const proc = pty.spawn('tmux', ['new-session', '-A', '-s', tmuxName, '-x', String(cols), '-y', String(rows)], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME ?? '/',
    env: process.env as Record<string, string>,
  })

  const session: LocalSession = { id, tmuxName, proc, ws, status: 'connected' }
  sessions.set(id, session)

  sendHistory(tmuxName, ws)
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

  ws.on('message', (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'input') {
        session.proc.write(msg.data)
      } else if (msg.type === 'resize') {
        session.proc.resize(msg.cols, msg.rows)
      }
      // 'ping' and other types are silently ignored
    } catch { /* ignore malformed messages */ }
  })

  ws.once('close', () => {
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
