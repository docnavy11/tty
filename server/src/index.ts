import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import websocketPlugin from '@fastify/websocket'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'
import { initDb } from './db/database.js'
import { sessionRoutes } from './routes/sessions.js'
import { terminalRoutes } from './routes/terminal.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA_DIR = process.env.DATA_DIR ?? join(__dirname, '../../data')
const CLIENT_DIST = process.env.CLIENT_DIST ?? join(__dirname, '../../client/dist')

mkdirSync(DATA_DIR, { recursive: true })

initDb(join(DATA_DIR, 'db.sqlite'))

const app = Fastify({ logger: true })

await app.register(websocketPlugin)

await app.register(staticPlugin, {
  root: CLIENT_DIST,
  prefix: '/',
})

app.get('/api/health', async () => ({ ok: true }))

await app.register(sessionRoutes)
await app.register(terminalRoutes)

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
