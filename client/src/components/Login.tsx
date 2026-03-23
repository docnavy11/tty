import { useState } from 'react'

export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setLoading(false)
    if (res.ok) {
      onLogin()
    } else {
      setError('Invalid password')
      setPassword('')
    }
  }

  return (
    <div style={{
      height: 'var(--vh, 100dvh)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#1a1a1a',
    }}>
      <form onSubmit={submit} style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        width: 280, padding: 32,
        background: '#222', border: '1px solid #333', borderRadius: 8,
      }}>
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 600, textAlign: 'center' }}>tty</div>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            background: '#111', border: '1px solid #444', borderRadius: 4,
            color: '#e0e0e0', fontSize: 14, padding: '8px 12px', outline: 'none',
          }}
        />
        {error && <div style={{ color: '#ff5555', fontSize: 13, textAlign: 'center' }}>{error}</div>}
        <button
          type="submit"
          disabled={loading || !password}
          style={{
            background: '#50fa7b', border: 'none', borderRadius: 4,
            color: '#1a1a1a', cursor: loading || !password ? 'default' : 'pointer',
            fontSize: 14, fontWeight: 600, padding: '8px 0',
            opacity: loading || !password ? 0.5 : 1,
          }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
