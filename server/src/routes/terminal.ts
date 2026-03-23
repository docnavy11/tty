import type { FastifyInstance } from 'fastify'
import { sessionManager } from '../services/SessionManager.js'

function clampDim(value: unknown, min: number, max: number): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min
}

export async function terminalRoutes(app: FastifyInstance) {
  app.get('/ws/terminal', { websocket: true }, (socket, req) => {
    const query = req.query as Record<string, string>
    const sessionId = query.sessionId

    if (!sessionId) {
      socket.close(1008, 'sessionId required')
      return
    }

    const session = sessionManager.get(sessionId)
    if (!session) {
      socket.close(1008, 'session not found')
      return
    }

    // First message must be resize — used to size the tmux session
    socket.once('message', async (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type !== 'resize') {
          socket.close(1008, 'first message must be resize')
          return
        }
        const cols = clampDim(msg.cols, 1, 500)
        const rows = clampDim(msg.rows, 1, 200)
        await sessionManager.connect(sessionId, socket, cols, rows)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        socket.send(JSON.stringify({ type: 'error', message: errMsg }))
        socket.close(1011, 'connection failed')
      }
    })
  })
}
