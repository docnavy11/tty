import type { FastifyInstance } from 'fastify'
import { execSync } from 'child_process'
import { sessionManager } from '../services/SessionManager.js'

export async function sessionRoutes(app: FastifyInstance) {
  app.post('/api/sessions/adhoc', async (req, reply) => {
    const body = req.body as Record<string, unknown>
    const sessionId = sessionManager.create({
      host: body.host as string,
      port: (body.port as number) ?? 22,
      username: body.username as string,
      authType: (body.authType as 'key' | 'password') ?? 'key',
      keyPath: body.keyPath as string | undefined,
      password: body.password as string | undefined,
      displayName: (body.displayName as string | undefined) ?? `${body.username}@${body.host}`,
    })
    return { sessionId }
  })

  app.get('/api/active-sessions', async () => {
    return sessionManager.list()
  })

  app.delete('/api/active-sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    sessionManager.kill(id)
    reply.code(204).send()
  })

  app.get('/api/sessions/:id/cwd', async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = sessionManager.get(id)
    if (!session) return reply.code(404).send({ error: 'Session not found' })
    try {
      const cwd = execSync(
        `tmux display-message -p -t ${session.tmuxName} '#{pane_current_path}'`,
        { encoding: 'utf8' }
      ).trim()
      return { cwd }
    } catch {
      return { cwd: process.env.HOME ?? '/' }
    }
  })
}
