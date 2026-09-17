import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import staticPlugin from '@fastify/static'
import websocketPlugin from '@fastify/websocket'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import { authRoutes } from './routes/auth.js'
import { sessionRoutes } from './routes/sessions.js'
import { terminalRoutes } from './routes/terminal.js'
import { projectRoutes } from './routes/projects.js'
import { settingsRoutes } from './routes/settings.js'
import { fileRoutes } from './routes/files.js'
import { statsRoutes } from './routes/stats.js'
import { workspaceRoutes } from './routes/workspaces.js'

export interface AppOptions {
  /** Shared password. Empty string means no authentication at all. */
  authToken: string
  /** Directory the built client is served from. */
  clientDist: string
  /** Quiet in tests. */
  logger?: boolean
}

/**
 * Build the HTTP app without starting it, opening a database or touching a pty.
 * `index.ts` owns all of that; this function owns routing and the auth guard,
 * so both can be exercised with `app.inject()`.
 */
export async function buildApp({ authToken, clientDist, logger = true }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { redact: ['req.body.password'] } : false })

  await app.register(cookie, { secret: authToken || 'dev-secret-change-me' })
  await app.register(websocketPlugin, { options: { maxPayload: 64 * 1024 } })
  await app.register(multipart)

  await app.register(staticPlugin, { root: clientDist, prefix: '/' })

  // Auth guard — runs before every route except the auth endpoints themselves.
  if (authToken) {
    app.addHook('preHandler', async (req, reply) => {
      if (req.url.startsWith('/api/auth/')) return
      const r = req as any
      const raw = r.cookies?.['tty_auth']
      const valid = raw ? r.unsignCookie(raw).valid : false
      if (!valid) reply.code(401).send({ error: 'Unauthorized' })
    })
  }

  app.get('/api/health', async () => ({ ok: true }))

  await app.register(authRoutes, { token: authToken })
  await app.register(sessionRoutes)
  await app.register(terminalRoutes)
  await app.register(projectRoutes)
  await app.register(settingsRoutes)
  await app.register(fileRoutes)
  await app.register(statsRoutes)
  await app.register(workspaceRoutes)

  // SPA fallback
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      reply.code(404).send({ error: 'Not found' })
      return
    }
    // `return` matters: without it the async handler resolves undefined and
    // Fastify ends the reply before sendFile has streamed anything, so every
    // deep link answers 200 with an empty body.
    return reply.sendFile('index.html')
  })

  return app
}

/** Loopback addresses the safety check treats as "this machine only". */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host)
}

/**
 * Whether serving must be refused. Binding a network address with no password
 * is an unauthenticated remote shell; the override exists for the case where
 * something else is the boundary (a port mapped to loopback, a tailnet-only
 * interface).
 */
export function mustRefuseToServe(
  { host, authToken, allowPublicNoAuth }: { host: string; authToken: string; allowPublicNoAuth: boolean },
): boolean {
  return !isLoopbackHost(host) && !authToken && !allowPublicNoAuth
}
