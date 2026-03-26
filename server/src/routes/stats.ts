import type { FastifyInstance } from 'fastify'
import { cpus, totalmem, freemem, loadavg, uptime } from 'os'
import { execSync } from 'child_process'

let prevCpuTimes: { idle: number; total: number } | null = null

function getCpuPercent(): number {
  const cores = cpus()
  let idle = 0, total = 0
  for (const c of cores) {
    idle += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle
  }
  if (!prevCpuTimes) {
    prevCpuTimes = { idle, total }
    return 0
  }
  const dIdle = idle - prevCpuTimes.idle
  const dTotal = total - prevCpuTimes.total
  prevCpuTimes = { idle, total }
  return dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0
}

interface TmuxSession {
  name: string
  windows: number
  created: number
  attached: boolean
}

function listTmuxSessions(): TmuxSession[] {
  try {
    const out = execSync(
      'tmux list-sessions -F "#{session_name}\t#{session_windows}\t#{session_created}\t#{session_attached}"',
      { encoding: 'utf8', timeout: 5000 }
    ).trim()
    if (!out) return []
    return out.split('\n').map(line => {
      const [name, windows, created, attached] = line.split('\t')
      return {
        name,
        windows: parseInt(windows, 10) || 1,
        created: parseInt(created, 10) || 0,
        attached: attached === '1',
      }
    })
  } catch {
    return []
  }
}

export async function statsRoutes(app: FastifyInstance) {
  app.get('/api/stats', async () => {
    const totalMem = totalmem()
    const freeMem = freemem()
    const usedMem = totalMem - freeMem
    const tmuxSessions = listTmuxSessions()
    return {
      cpu: getCpuPercent(),
      mem: Math.round((usedMem / totalMem) * 100),
      memUsed: usedMem,
      memTotal: totalMem,
      load: loadavg(),
      uptime: Math.floor(uptime()),
      tmux: tmuxSessions,
    }
  })

  app.delete('/api/tmux/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    // Sanitize name to prevent command injection
    if (!/^[\w.-]+$/.test(name)) {
      return reply.code(400).send({ error: 'Invalid session name' })
    }
    try {
      execSync(`tmux kill-session -t ${name}`, { timeout: 5000 })
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
