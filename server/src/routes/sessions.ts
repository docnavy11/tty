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
    // One tmux probe for the whole list. Asking per session would be a
    // subprocess each, and `display-message -t=NAME` is the call that silently
    // returns an empty string for a session name rather than failing — see the
    // note on tmuxProbe().
    const paths = sessionManager.currentPaths()
    return sessionManager.list().map(s => ({ ...s, cwd: paths.get(s.id) }))
  })

  app.patch('/api/active-sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { displayName } = (req.body ?? {}) as { displayName?: unknown }
    if (typeof displayName !== 'string') {
      return reply.code(400).send({ error: 'displayName must be a string' })
    }
    if (!sessionManager.rename(id, displayName)) {
      return reply.code(404).send({ error: 'Session not found' })
    }
    return { ok: true }
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
