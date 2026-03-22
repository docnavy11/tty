import type { FastifyInstance } from 'fastify'
import { sessionManager } from '../services/SessionManager.js'

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
        await sessionManager.connect(sessionId, socket, msg.cols, msg.rows)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        socket.send(JSON.stringify({ type: 'error', message: errMsg }))
        socket.close(1011, 'connection failed')
      }
    })
  })
}
