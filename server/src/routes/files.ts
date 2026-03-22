import type { FastifyInstance } from 'fastify'
import { readdirSync, statSync, readFileSync, writeFileSync, createReadStream, createWriteStream } from 'fs'
import { join, resolve, basename } from 'path'
import { pipeline } from 'stream/promises'

const HOME = process.env.HOME ?? '/root'

function safePath(input: string): string {
  const abs = resolve(input.startsWith('/') ? input : join(HOME, input))
  if (!abs.startsWith(HOME)) throw Object.assign(new Error('Access denied'), { statusCode: 400 })
  return abs
}

export async function fileRoutes(app: FastifyInstance) {
  // List directory
  app.get('/api/files', async (req, reply) => {
    const { path: p } = req.query as { path?: string }
    try {
      const dir = safePath(p ?? HOME)
      const entries = readdirSync(dir, { withFileTypes: true }).map(e => {
        const fullPath = join(dir, e.name)
        let size = 0
        let mtime = 0
        try { const s = statSync(fullPath); size = s.size; mtime = s.mtimeMs } catch { /* skip */ }
        return { name: e.name, path: fullPath, isDir: e.isDirectory(), size, mtime }
      }).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
      return { path: dir, entries }
    } catch (err: any) {
      reply.code(err.statusCode ?? 500).send({ error: err.message })
    }
  })

  // Read file
  app.get('/api/files/read', async (req, reply) => {
    const { path: p } = req.query as { path: string }
    try {
      const file = safePath(p)
      const stat = statSync(file)
      if (stat.size > 2 * 1024 * 1024) return reply.code(413).send({ error: 'File too large (>2MB)' })
      const content = readFileSync(file, 'utf8')
      return { path: file, content }
    } catch (err: any) {
      reply.code(err.statusCode ?? 500).send({ error: err.message })
    }
  })

  // Write file
  app.put('/api/files/write', async (req, reply) => {
    const { path: p, content } = req.body as { path: string; content: string }
    try {
      const file = safePath(p)
      writeFileSync(file, content, 'utf8')
      return { ok: true }
    } catch (err: any) {
      reply.code(err.statusCode ?? 500).send({ error: err.message })
    }
  })

  // Upload file (multipart)
  app.post('/api/files/upload', async (req, reply) => {
    const { path: p } = req.query as { path: string }
    try {
      const dir = safePath(p ?? HOME)
      const data = await req.file()
      if (!data) return reply.code(400).send({ error: 'No file' })
      const dest = safePath(join(dir, basename(data.filename)))
      await pipeline(data.file, createWriteStream(dest))
      return { ok: true, path: dest }
    } catch (err: any) {
      reply.code(err.statusCode ?? 500).send({ error: err.message })
    }
  })

  // Download file
  app.get('/api/files/download', async (req, reply) => {
    const { path: p } = req.query as { path: string }
    try {
      const file = safePath(p)
      reply.header('Content-Disposition', `attachment; filename="${basename(file)}"`)
      return reply.send(createReadStream(file))
    } catch (err: any) {
      reply.code(err.statusCode ?? 500).send({ error: err.message })
    }
  })
}
