import { useState } from 'react'
import { TerminalView } from './components/Terminal'

type AuthType = 'key' | 'password'

interface ConnectForm {
  host: string
  username: string
  authType: AuthType
  keyPath: string
  password: string
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

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  color: '#888',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [form, setForm] = useState<ConnectForm>({
    host: '',
    username: '',
    authType: 'key',
    keyPath: '~/.ssh/id_ed25519',
    password: '',
  })

  const set = (k: keyof ConnectForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setConnecting(true)
    try {
      const res = await fetch('/api/sessions/adhoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.host,
          username: form.username,
          authType: form.authType,
          keyPath: form.authType === 'key' ? form.keyPath : undefined,
          password: form.authType === 'password' ? form.password : undefined,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text)
      }
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
        width: 340,
        background: '#111',
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        padding: '28px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{ marginBottom: 4 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', margin: 0 }}>WebTerminal</h1>
          <p style={{ fontSize: 12, color: '#555', marginTop: 4 }}>Connect to a remote server</p>
        </div>

        <div>
          <label style={labelStyle}>Host</label>
          <input style={inputStyle} value={form.host} onChange={set('host')} placeholder="server.example.com" required autoFocus />
        </div>

        <div>
          <label style={labelStyle}>Username</label>
          <input style={inputStyle} value={form.username} onChange={set('username')} placeholder="root" required />
        </div>

        <div>
          <label style={labelStyle}>Auth</label>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.authType} onChange={set('authType')}>
            <option value="key">SSH Key</option>
            <option value="password">Password</option>
          </select>
        </div>

        {form.authType === 'key' ? (
          <div>
            <label style={labelStyle}>Key path</label>
            <input style={inputStyle} value={form.keyPath} onChange={set('keyPath')} placeholder="~/.ssh/id_ed25519" />
          </div>
        ) : (
          <div>
            <label style={labelStyle}>Password</label>
            <input style={inputStyle} type="password" value={form.password} onChange={set('password')} />
          </div>
        )}

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
