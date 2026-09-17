import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import websocketPlugin from '@fastify/websocket'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'
import { initDb, checkpoint } from './db/database.js'
import { authRoutes } from './routes/auth.js'
import { sessionRoutes } from './routes/sessions.js'
import { terminalRoutes } from './routes/terminal.js'
import { projectRoutes } from './routes/projects.js'
import { settingsRoutes } from './routes/settings.js'
import { fileRoutes } from './routes/files.js'
import { statsRoutes } from './routes/stats.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { sessionManager } from './services/SessionManager.js'
import { projectManager } from './services/ProjectManager.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? '127.0.0.1'
const DATA_DIR = process.env.DATA_DIR ?? join(__dirname, '../../data')
const CLIENT_DIST = process.env.CLIENT_DIST ?? join(__dirname, '../../client/dist')
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? ''

mkdirSync(DATA_DIR, { recursive: true })

initDb(join(DATA_DIR, 'db.sqlite'))
sessionManager.recover()

// Fold the WAL back into db.sqlite periodically. It had grown to 4 MB against a
// 45 KB database because nothing ever checkpointed it.
const CHECKPOINT_INTERVAL_MS = Math.max(
  60_000,
  parseInt(process.env.TTY_CHECKPOINT_INTERVAL_MS ?? '', 10) || 15 * 60_000,
)
setInterval(checkpoint, CHECKPOINT_INTERVAL_MS).unref()

// Autostart projects — actually spawn the pty processes, not just DB records
for (const p of projectManager.listProjects()) {
  if (p.autostart) {
    const ids = sessionManager.launchProject(p.id)
    for (const id of ids) sessionManager.spawn(id)
  }
}

const app = Fastify({ logger: { redact: ['req.body.password'] } })

await app.register(cookie, { secret: AUTH_TOKEN || 'dev-secret-change-me' })
await app.register(websocketPlugin, { options: { maxPayload: 64 * 1024 } })
await app.register(multipart)

await app.register(staticPlugin, {
  root: CLIENT_DIST,
  prefix: '/',
})

// Auth guard — runs before every route except the auth endpoints themselves
if (AUTH_TOKEN) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/auth/')) return
    const r = req as any
    const raw = r.cookies?.['tty_auth']
    const valid = raw ? r.unsignCookie(raw).valid : false
    if (!valid) reply.code(401).send({ error: 'Unauthorized' })
  })
}

app.get('/api/health', async () => ({ ok: true }))

await app.register(authRoutes, { token: AUTH_TOKEN })
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
  reply.sendFile('index.html')
})

// Startup safety checks, before anything is served. Binding a non-loopback
// address with no password is an unauthenticated remote shell, so it is refused
// rather than warned about: a warning scrolls past, a refusal does not.
const isPublic = HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1'
const uid = process.getuid?.()

if (isPublic && !AUTH_TOKEN && !process.env.TTY_ALLOW_PUBLIC_NO_AUTH) {
  console.error('')
  console.error('Refusing to start.')
  console.error('')
  console.error(`  HOST is ${HOST} (reachable from the network) and AUTH_TOKEN is unset.`)
  console.error('  That serves a shell on this machine to anyone who can reach the port.')
  console.error('')
  console.error('  Pick one:')
  console.error('    HOST=127.0.0.1                 serve this machine only (the default)')
  console.error('    AUTH_TOKEN=<long random value> require a password, behind HTTPS')
  console.error('')
  console.error('  TTY_ALLOW_PUBLIC_NO_AUTH=1 overrides this if you genuinely mean it —')
  console.error('  a trusted private network with no other way in. See the README.')
  console.error('')
  process.exit(1)
}

await app.listen({ port: PORT, host: HOST })
console.log(`Server listening on http://${HOST}:${PORT}`)

if (isPublic && !AUTH_TOKEN) {
  console.warn('')
  console.warn('╔══════════════════════════════════════════════════════════╗')
  console.warn('║  WARNING: NO PASSWORD SET AND SERVER IS PUBLICLY BOUND   ║')
  console.warn('║  Anyone who can reach this address has full terminal      ║')
  console.warn('║  access. TTY_ALLOW_PUBLIC_NO_AUTH is set, so this ran.   ║')
  console.warn('╚══════════════════════════════════════════════════════════╝')
  console.warn('')
}

if (AUTH_TOKEN && AUTH_TOKEN.length < 12) {
  console.warn(`⚠️  AUTH_TOKEN is only ${AUTH_TOKEN.length} characters — use a longer password (12+ chars recommended)`)
}

if (uid === 0) {
  console.warn('⚠️  Running as root — the file browser exposes the entire filesystem. Run as a dedicated low-privilege user instead.')
}

const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down gracefully`)
  sessionManager.shutdownAll()
  await app.close()
  checkpoint()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
