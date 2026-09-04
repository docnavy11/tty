// Diagnostic logger for terminal scrambling investigation.
// Enable with TTY_DEBUG=1. Writes per-connect logs to <DATA_DIR>/debug/.
import * as fs from 'fs'
import * as path from 'path'

const ENABLED = process.env.TTY_DEBUG === '1'
const DATA_DIR = process.env.DATA_DIR ?? './data'
const DEBUG_DIR = path.join(DATA_DIR, 'debug')

const num = (name: string, fallback: number) => {
  const v = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// Per-connection stream cap. Without one, a single busy terminal writes its
// entire output to disk forever — this directory reached 1.8 GB.
const MAX_STREAM_BYTES = num('TTY_DEBUG_MAX_STREAM_BYTES', 8 * 1024 * 1024)
// Total budget for the debug directory, enforced at startup by dropping the
// oldest session directories first.
const MAX_TOTAL_BYTES = num('TTY_DEBUG_MAX_TOTAL_BYTES', 512 * 1024 * 1024)

if (ENABLED) {
  try { fs.mkdirSync(DEBUG_DIR, { recursive: true }) } catch { /* ignore */ }
  pruneDebugDir()
}

function dirSize(dir: string): number {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    try {
      total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size
    } catch { /* vanished mid-walk */ }
  }
  return total
}

// Drop whole session directories, oldest first, until the tree fits the budget.
export function pruneDebugDir(): void {
  if (!ENABLED) return
  try {
    const dirs = fs.readdirSync(DEBUG_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const full = path.join(DEBUG_DIR, e.name)
        return { full, size: dirSize(full), mtime: fs.statSync(full).mtimeMs }
      })
      .sort((a, b) => a.mtime - b.mtime)

    let total = dirs.reduce((sum, d) => sum + d.size, 0)
    let removed = 0
    for (const d of dirs) {
      if (total <= MAX_TOTAL_BYTES) break
      fs.rmSync(d.full, { recursive: true, force: true })
      total -= d.size
      removed++
    }
    if (removed > 0) {
      console.log(`[wsDebugLog] pruned ${removed} old session dir(s); debug tree now ~${(total / 1e6).toFixed(0)} MB`)
    }
  } catch (err) {
    console.warn('[wsDebugLog] prune failed:', err instanceof Error ? err.message : err)
  }
}

export interface WsDebugLog {
  event(type: string, info?: Record<string, unknown>): void
  data(source: 'HISTORY' | 'PTY', bytes: Buffer): void
  close(): void
}

const noop: WsDebugLog = {
  event() {},
  data() {},
  close() {},
}

export function createLog(sessionId: string): WsDebugLog {
  if (!ENABLED) return noop

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const sessionDir = path.join(DEBUG_DIR, sessionId)
  try { fs.mkdirSync(sessionDir, { recursive: true }) } catch { /* ignore */ }

  const eventsPath = path.join(sessionDir, `${ts}.events.ndjson`)
  const streamPath = path.join(sessionDir, `${ts}.stream.bin`)

  let events: fs.WriteStream | null
  let stream: fs.WriteStream | null
  let offset = 0
  let capped = false

  try {
    events = fs.createWriteStream(eventsPath, { flags: 'a' })
    stream = fs.createWriteStream(streamPath, { flags: 'a' })
  } catch (err) {
    console.error('[wsDebugLog] failed to open files', err)
    return noop
  }

  const writeEvent = (type: string, info?: Record<string, unknown>) => {
    const line = JSON.stringify({ t: Date.now(), type, ...info }) + '\n'
    events?.write(line)
  }

  writeEvent('OPEN', { sessionId })

  return {
    event: writeEvent,
    data(source, bytes) {
      if (!stream) return
      if (offset >= MAX_STREAM_BYTES) {
        if (!capped) {
          capped = true
          writeEvent('STREAM_CAPPED', { limit: MAX_STREAM_BYTES, offset })
          stream.end()
          stream = null
        }
        return
      }
      stream.write(bytes)
      writeEvent(source, { bytes: bytes.length, offset })
      offset += bytes.length
    },
    close() {
      writeEvent('CLOSE', { totalBytes: offset })
      events?.end()
      stream?.end()
      events = null
      stream = null
    },
  }
}
