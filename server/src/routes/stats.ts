import type { FastifyInstance } from 'fastify'
import { cpus, totalmem, freemem, loadavg, uptime } from 'os'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

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
  pid: number
  cpu: number   // % across process tree
  mem: number   // RSS in bytes across process tree
}

function getDescendantPids(pid: number): number[] {
  try {
    const out = execSync(`pgrep -P ${pid}`, { encoding: 'utf8', timeout: 3000 }).trim()
    if (!out) return []
    const children = out.split('\n').map(Number).filter(n => n > 0)
    const all = [...children]
    for (const child of children) {
      all.push(...getDescendantPids(child))
    }
    return all
  } catch {
    return []
  }
}

function getProcessStats(pids: number[]): { cpu: number; mem: number } {
  if (pids.length === 0) return { cpu: 0, mem: 0 }
  try {
    const pidList = pids.join(',')
    const out = execSync(`ps -p ${pidList} -o pcpu=,rss= --no-headers 2>/dev/null`, {
      encoding: 'utf8', timeout: 3000,
    }).trim()
    if (!out) return { cpu: 0, mem: 0 }
    let cpu = 0, mem = 0
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        cpu += parseFloat(parts[0]) || 0
        mem += (parseInt(parts[1], 10) || 0) * 1024 // RSS is in KB, convert to bytes
      }
    }
    return { cpu: Math.round(cpu * 10) / 10, mem }
  } catch {
    return { cpu: 0, mem: 0 }
  }
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
      // Get the pane PID for this session's first pane
      let pid = 0
      try {
        pid = parseInt(
          execSync(`tmux list-panes -t ${name} -F "#{pane_pid}"`, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0],
          10
        ) || 0
      } catch { /* ignore */ }
      // Get process tree stats
      const allPids = pid > 0 ? [pid, ...getDescendantPids(pid)] : []
      const stats = getProcessStats(allPids)
      return {
        name,
        windows: parseInt(windows, 10) || 1,
        created: parseInt(created, 10) || 0,
        attached: attached === '1',
        pid,
        cpu: stats.cpu,
        mem: stats.mem,
      }
    })
  } catch {
    return []
  }
}

// Tmux session list is expensive (execSync per session). Cache it and only
// compute when explicitly requested via ?tmux=1 (the dashboard page).
let cachedTmux: TmuxSession[] = []
let tmuxCacheTime = 0
const TMUX_CACHE_TTL = 5000

export async function statsRoutes(app: FastifyInstance) {
  // Lightweight stats — only os module, no shell commands. Safe to poll frequently.
  app.get('/api/stats', async (req) => {
    const totalMem = totalmem()
    const freeMem = freemem()
    const usedMem = totalMem - freeMem
    const query = req.query as Record<string, string>
    const wantTmux = query.tmux === '1'

    // Only run expensive tmux/process lookups when dashboard requests it
    let tmux: TmuxSession[] | undefined
    if (wantTmux) {
      const now = Date.now()
      if (now - tmuxCacheTime > TMUX_CACHE_TTL) {
        cachedTmux = listTmuxSessions()
        tmuxCacheTime = now
      }
      tmux = cachedTmux
    }

    return {
      cpu: getCpuPercent(),
      mem: Math.round((usedMem / totalMem) * 100),
      memUsed: usedMem,
      memTotal: totalMem,
      load: loadavg(),
      uptime: Math.floor(uptime()),
      ...(tmux ? { tmux } : {}),
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
