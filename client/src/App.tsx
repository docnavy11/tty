import { useEffect, useState } from 'react'

export default function App() {
  const [healthy, setHealthy] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setHealthy(d.ok))
      .catch(() => setHealthy(false))
  }, [])

  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>WebTerminal</h1>
      <p>
        API:{' '}
        {healthy === null ? 'checking…' : healthy ? '✓ connected' : '✗ unreachable'}
      </p>
    </div>
  )
}
