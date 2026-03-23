import type { FastifyInstance } from 'fastify'

const COOKIE = 'tty_auth'
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
}

export async function authRoutes(app: FastifyInstance, { token }: { token: string }) {
  // Public: lets the frontend know whether auth is enabled and if the user is logged in
  app.get('/api/auth/status', async (req) => {
    if (!token) return { authEnabled: false, authenticated: true }
    const r = req as any
    const raw = r.cookies?.[COOKIE]
    const authenticated = raw ? r.unsignCookie(raw).valid : false
    return { authEnabled: true, authenticated }
  })

  app.post('/api/auth/login', async (req, reply) => {
    const { password } = req.body as { password?: string }
    if (!token || password !== token) {
      reply.code(401).send({ error: 'Invalid password' })
      return
    }
    ;(reply as any).setCookie(COOKIE, 'ok', { signed: true, ...COOKIE_OPTS })
    reply.send({ ok: true })
  })

  app.post('/api/auth/logout', async (req, reply) => {
    ;(reply as any).clearCookie(COOKIE, { path: '/' })
    reply.send({ ok: true })
  })
}
