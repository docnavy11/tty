import { useState, useEffect, useRef, useCallback } from 'react'

interface TmuxSession {
  name: string
  windows: number
  created: number
  attached: boolean
}

interface Stats {
  cpu: number
  mem: number
  memUsed: number
  memTotal: number
  load: number[]
  uptime: number
  tmux: TmuxSession[]
}

function Sparkline({ data, color, max = 100, width = 48, height = 18 }: {
  data: number[]
  color: string
  max?: number
  width?: number
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    // Fill area
    ctx.beginPath()
    ctx.moveTo(0, height)
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * width
      const y = height - (Math.min(data[i], max) / max) * height
      ctx.lineTo(x, y)
    }
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fillStyle = color + '20'
    ctx.fill()

    // Line
    ctx.beginPath()
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * width
      const y = height - (Math.min(data[i], max) / max) * height
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()
  }, [data, color, max, width, height])

  return <canvas ref={canvasRef} style={{ width, height, display: 'block' }} />
}

const HISTORY_LEN = 30

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)}M`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtTimestamp(epoch: number): string {
  const d = new Date(epoch * 1000)
  const now = Date.now()
  const diff = Math.floor((now - d.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 24,
}

export function ServerStats() {
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  const [memHistory, setMemHistory] = useState<number[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [expanded, setExpanded] = useState(false)

  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null)

  const fetchStats = useCallback(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then((s: Stats) => {
        setStats(s)
        setCpuHistory(prev => [...prev.slice(-(HISTORY_LEN - 1)), s.cpu])
        setMemHistory(prev => [...prev.slice(-(HISTORY_LEN - 1)), s.mem])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 3000)
    return () => clearInterval(interval)
  }, [fetchStats])

  const toggleExpanded = () => {
    if (expanded) {
      setExpanded(false)
    } else {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        setDropdownPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
      }
      setExpanded(true)
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setExpanded(false)
      }
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [expanded])

  const killTmuxSession = async (name: string) => {
    if (!confirm(`Kill tmux session "${name}"?`)) return
    try {
      await fetch(`/api/tmux/${encodeURIComponent(name)}`, { method: 'DELETE' })
      fetchStats()
    } catch { /* ignore */ }
  }

  if (!stats) return null

  const detachedCount = stats.tmux.filter(s => !s.attached).length

  return (
    <>
      <div
        ref={triggerRef}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', cursor: 'pointer' }}
        onClick={toggleExpanded}
        title="Server stats"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#666', fontSize: 10 }}>CPU</span>
          <Sparkline data={cpuHistory} color="#50fa7b" />
          <span style={{ color: '#50fa7b', fontSize: 10, minWidth: 28, textAlign: 'right' }}>{stats.cpu}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#666', fontSize: 10 }}>MEM</span>
          <Sparkline data={memHistory} color="#8be9fd" />
          <span style={{ color: '#8be9fd', fontSize: 10, minWidth: 28, textAlign: 'right' }}>{stats.mem}%</span>
        </div>
        {/* Detached sessions badge */}
        {detachedCount > 0 && (
          <span style={{
            background: '#ff5555', color: '#fff', fontSize: 9, fontWeight: 700,
            borderRadius: 8, padding: '1px 5px', minWidth: 16, textAlign: 'center',
            lineHeight: '14px',
          }}>{detachedCount}</span>
        )}
      </div>

      {/* Expanded dropdown */}
      {expanded && dropdownPos && (
        <div ref={dropdownRef} style={{
          position: 'fixed', top: dropdownPos.top, right: dropdownPos.right,
          background: '#1e1e1e', border: '1px solid #333', borderRadius: 6,
          padding: '12px 16px', zIndex: 10000, minWidth: 280, maxWidth: 400,
          boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
          fontSize: 12, color: '#ccc',
          maxHeight: '70vh', overflowY: 'auto',
        }}>
          {/* System stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            <div style={{ color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>System</div>
            <div style={rowStyle}>
              <span style={{ color: '#888' }}>CPU</span>
              <span style={{ color: '#50fa7b' }}>{stats.cpu}%</span>
            </div>
            <div style={rowStyle}>
              <span style={{ color: '#888' }}>Memory</span>
              <span style={{ color: '#8be9fd' }}>{fmtBytes(stats.memUsed)} / {fmtBytes(stats.memTotal)}</span>
            </div>
            <div style={rowStyle}>
              <span style={{ color: '#888' }}>Load</span>
              <span>{stats.load.map(l => l.toFixed(2)).join('  ')}</span>
            </div>
            <div style={rowStyle}>
              <span style={{ color: '#888' }}>Uptime</span>
              <span>{fmtUptime(stats.uptime)}</span>
            </div>
          </div>

          {/* Tmux sessions */}
          <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              tmux sessions ({stats.tmux.length})
            </div>
            {stats.tmux.length === 0 ? (
              <div style={{ color: '#444', fontSize: 11 }}>No tmux sessions</div>
            ) : (
              stats.tmux.map(s => (
                <div key={s.name} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 0', borderBottom: '1px solid #222',
                }}>
                  {/* Status dot */}
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: s.attached ? '#50fa7b' : '#888',
                  }} />
                  {/* Name */}
                  <span style={{
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: s.attached ? '#ccc' : '#888',
                  }}>{s.name}</span>
                  {/* Info */}
                  <span style={{ color: '#444', fontSize: 10, flexShrink: 0 }}>
                    {s.windows}w
                  </span>
                  <span style={{ color: '#444', fontSize: 10, flexShrink: 0 }}>
                    {fmtTimestamp(s.created)}
                  </span>
                  {/* Status label */}
                  <span style={{
                    fontSize: 9, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
                    background: s.attached ? '#1a2a1a' : '#2a1a1a',
                    color: s.attached ? '#50fa7b' : '#ff5555',
                    border: `1px solid ${s.attached ? '#2a4a2a' : '#4a2a2a'}`,
                  }}>
                    {s.attached ? 'attached' : 'detached'}
                  </span>
                  {/* Kill button */}
                  {!s.attached && (
                    <button
                      onClick={() => killTmuxSession(s.name)}
                      title={`Kill session "${s.name}"`}
                      style={{
                        background: 'none', border: '1px solid #4a2a2a', borderRadius: 3,
                        color: '#ff5555', cursor: 'pointer', fontSize: 10,
                        padding: '1px 6px', flexShrink: 0,
                      }}
                    >kill</button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}
