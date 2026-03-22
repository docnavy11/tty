import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { WebSocket } from 'ws'

export interface LocalSession {
  id: string
  tmuxName: string
  proc: IPty
  ws: WebSocket | null
  status: 'connected' | 'detached'
}

const sessions = new Map<string, LocalSession>()

export function createLocal(id: string, tmuxName: string, cols: number, rows: number, ws: WebSocket, onSessionEnd?: () => void): void {
  // Steal existing if alive
  const existing = sessions.get(id)
  if (existing) {
    if (existing.ws?.readyState === 1) existing.ws.close(1000, 'stolen')
    existing.ws = ws
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

  const session: LocalSession = { id, tmuxName, proc, ws, status: 'connected' }
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

  ws.on('message', (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'input') {
        session.proc.write(msg.data)
      } else if (msg.type === 'resize') {
        session.proc.resize(msg.cols, msg.rows)
      }
    } catch { /* ignore */ }
  })

  ws.once('close', () => {
    onData.dispose()
    onExit.dispose()
    session.ws = null
    session.status = 'detached'
  })
}

export function killLocal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  try {
    session.proc.kill()
  } catch { /* already dead */ }
  session.ws?.close()
  sessions.delete(id)
}

export function getLocal(id: string): LocalSession | undefined {
  return sessions.get(id)
}
