import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import websocketPlugin from '@fastify/websocket'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'
import { initDb } from './db/database.js'
import { authRoutes } from './routes/auth.js'
import { sessionRoutes } from './routes/sessions.js'
import { terminalRoutes } from './routes/terminal.js'
import { projectRoutes } from './routes/projects.js'
import { settingsRoutes } from './routes/settings.js'
import { fileRoutes } from './routes/files.js'
import { sessionManager } from './services/SessionManager.js'
import { projectManager } from './services/ProjectManager.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA_DIR = process.env.DATA_DIR ?? join(__dirname, '../../data')
const CLIENT_DIST = process.env.CLIENT_DIST ?? join(__dirname, '../../client/dist')
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? ''

mkdirSync(DATA_DIR, { recursive: true })

initDb(join(DATA_DIR, 'db.sqlite'))
sessionManager.recover()

// Autostart projects — actually spawn the pty processes, not just DB records
for (const p of projectManager.listProjects()) {
  if (p.autostart) {
    const ids = sessionManager.launchProject(p.id)
    for (const id of ids) sessionManager.spawn(id)
  }
}

const app = Fastify({ logger: true })

await app.register(cookie, { secret: AUTH_TOKEN || 'dev-secret-change-me' })
await app.register(websocketPlugin)
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

// SPA fallback
app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
    reply.code(404).send({ error: 'Not found' })
    return
  }
  reply.sendFile('index.html')
})

await app.listen({ port: PORT, host: HOST })
console.log(`Server listening on http://${HOST}:${PORT}`)

const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down gracefully`)
  await app.close()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
