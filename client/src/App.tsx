import { useState } from 'react'
import { TerminalView } from './components/Terminal'

interface ConnectForm {
  target: string  // user@host or "local"
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#111',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#e0e0e0',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
}

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [form, setForm] = useState<ConnectForm>({ target: '' })

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
      setSessionId(data.sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  if (sessionId) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
        <TerminalView
          sessionId={sessionId}
          onClose={() => setSessionId(null)}
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
      <form onSubmit={connect} style={{
        width: 320,
        background: '#111',
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        padding: '28px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', margin: 0 }}>WebTerminal</h1>

        <input
          style={inputStyle}
          value={form.target}
          onChange={e => setForm({ target: e.target.value })}
          placeholder="user@host  or  local"
          required
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />

        {error && (
          <div style={{ color: '#ff5555', fontSize: 12, padding: '8px 10px', background: '#1a0000', border: '1px solid #550000', borderRadius: 4 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={connecting}
          style={{
            padding: '9px',
            background: connecting ? '#222' : '#2a4a2a',
            border: '1px solid #3a6a3a',
            borderRadius: 4,
            color: connecting ? '#555' : '#50fa7b',
            fontFamily: 'inherit',
            fontSize: 13,
            cursor: connecting ? 'not-allowed' : 'pointer',
          }}
        >
          {connecting ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  )
}
