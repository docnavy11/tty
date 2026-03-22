import { useState, useEffect } from 'react'
import { TerminalView } from './components/Terminal'

interface Session {
  id: string
  tmuxName: string
  status: string
  config: { displayName?: string; host: string; authType: string }
  createdAt: string
}

interface ConnectForm {
  target: string
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#0d0d0d',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#e0e0e0',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
}

const statusColor: Record<string, string> = {
  connected: '#50fa7b',
  detached: '#888',
  connecting: '#f1fa8c',
  pending: '#888',
}

export default function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [form, setForm] = useState<ConnectForm>({ target: 'local' })
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/active-sessions')
      const data = await res.json()
      setSessions(data)
    } catch { /* server may be starting */ }
  }

  useEffect(() => {
    fetchSessions()
  }, [])

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setConnecting(true)
    try {
      const target = form.target.trim()
      let body: Record<string, unknown>

      if (target === 'local') {
        body = { authType: 'local', host: 'localhost', username: '' }
      } else {
        const [username, host] = target.includes('@') ? target.split('@') : ['root', target]
        body = { host, username, authType: 'key' }
      }

      const res = await fetch('/api/sessions/adhoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      await fetchSessions()
      setActiveSessionId(data.sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  const killSession = async (id: string) => {
    await fetch(`/api/active-sessions/${id}`, { method: 'DELETE' })
    setSessions(s => s.filter(x => x.id !== id))
    if (activeSessionId === id) setActiveSessionId(null)
  }

  if (activeSessionId) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
        <TerminalView
          sessionId={activeSessionId}
          onClose={() => { setActiveSessionId(null); fetchSessions() }}
          onError={(msg) => setError(msg)}
        />
      </div>
    )
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#1a1a1a',
    }}>
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Existing sessions */}
        {sessions.length > 0 && (
          <div style={{
            background: '#111',
            border: '1px solid #2a2a2a',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a2a', color: '#555', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Sessions
            </div>
            {sessions.map(s => (
              <div key={s.id} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 14px',
                borderBottom: '1px solid #1a1a1a',
                gap: 10,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor[s.status] ?? '#555', flexShrink: 0 }} />
                <span
                  onClick={() => setActiveSessionId(s.id)}
                  style={{ flex: 1, color: '#ccc', fontSize: 13, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {s.config.displayName ?? s.config.host}
                </span>
                <span style={{ color: '#444', fontSize: 11 }}>{s.status}</span>
                <button
                  onClick={() => killSession(s.id)}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* New session */}
        <form onSubmit={connect} style={{
          background: '#111',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {sessions.length === 0 && (
            <h1 style={{ fontSize: 15, fontWeight: 600, color: '#e0e0e0', margin: 0 }}>WebTerminal</h1>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={form.target}
              onChange={e => setForm({ target: e.target.value })}
              placeholder="user@host  or  local"
              required
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={connecting}
              style={{
                padding: '8px 14px',
                background: connecting ? '#222' : '#2a4a2a',
                border: '1px solid #3a6a3a',
                borderRadius: 4,
                color: connecting ? '#555' : '#50fa7b',
                fontFamily: 'inherit',
                fontSize: 13,
                cursor: connecting ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {connecting ? '…' : 'Connect'}
            </button>
          </div>

          {error && (
            <div style={{ color: '#ff5555', fontSize: 12, padding: '8px 10px', background: '#1a0000', border: '1px solid #550000', borderRadius: 4 }}>
              {error}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
