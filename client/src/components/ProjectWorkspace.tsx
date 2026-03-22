import { useState, useEffect } from 'react'
import { TerminalView } from './Terminal'

interface Session {
  id: string
  config: { displayName?: string; host: string; authType: string }
  status: string
}

interface Props {
  projectId: string
  projectName: string
  onBack: () => void
}

const statusDot: Record<string, string> = {
  connected: '#50fa7b',
  detached: '#888',
  connecting: '#f1fa8c',
  pending: '#555',
}

const inputSm: React.CSSProperties = {
  background: '#0d0d0d', border: '1px solid #333', borderRadius: 3,
  color: '#e0e0e0', fontFamily: 'inherit', fontSize: 12,
  padding: '3px 8px', outline: 'none',
}

export function ProjectWorkspace({ projectId, projectName, onBack }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [quickConnect, setQuickConnect] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Launch project sessions on mount
  useEffect(() => {
    fetch(`/api/projects/${projectId}/launch`, { method: 'POST' })
      .then(r => r.json())
      .then(({ sessionIds }: { sessionIds: string[] }) => {
        if (sessionIds.length === 0) return
        return fetch('/api/active-sessions')
          .then(r => r.json())
          .then((all: Session[]) => {
            const mine = all.filter(s => sessionIds.includes(s.id))
            setSessions(mine)
            setActiveId(mine[0]?.id ?? null)
          })
      })
      .catch(err => setError(String(err)))
  }, [projectId])

  // Add a session: saves as project session definition AND launches it
  const addSession = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = quickConnect.trim()
    if (!target) return
    setError(null)
    let defId: string | null = null
    try {
      let defBody: Record<string, unknown>
      if (target === 'local') {
        defBody = { name: 'local', host: 'localhost', username: '', authType: 'local', port: 22 }
      } else {
        const [username, host] = target.includes('@') ? target.split('@') : ['root', target]
        defBody = { name: target, host, username, authType: 'key', port: 22 }
      }

      // Save as session definition
      const defRes = await fetch(`/api/projects/${projectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defBody),
      })
      if (!defRes.ok) throw new Error(await defRes.text())
      const def = await defRes.json()
      defId = def.id

      // Re-launch project (picks up new definition)
      const launchRes = await fetch(`/api/projects/${projectId}/launch`, { method: 'POST' })
      if (!launchRes.ok) throw new Error(await launchRes.text())
      const { sessionIds } = await launchRes.json()

      const allRes = await fetch('/api/active-sessions')
      const all: Session[] = await allRes.json()
      const mine = all.filter(s => sessionIds.includes(s.id))
      setSessions(mine)
      setActiveId(sessionIds[sessionIds.length - 1] ?? mine[0]?.id ?? null)
      setQuickConnect('')
      setShowInput(false)
    } catch (err) {
      // Roll back the session definition if launch failed
      if (defId) {
        await fetch(`/api/projects/${projectId}/sessions/${defId}`, { method: 'DELETE' }).catch(() => {})
      }
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const removeTab = async (id: string) => {
    await fetch(`/api/active-sessions/${id}`, { method: 'DELETE' })
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      if (activeId === id) setActiveId(next[0]?.id ?? null)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1a1a1a' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 12px', height: 38,
        background: '#111', borderBottom: '1px solid #222',
        flexShrink: 0,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>‹</button>
        <span style={{ color: '#ccc', fontSize: 13, fontWeight: 500 }}>{projectName}</span>
        {error && <span style={{ color: '#ff5555', fontSize: 11, marginLeft: 8 }}>{error}</span>}
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: '#111', borderBottom: '1px solid #222',
        flexShrink: 0, overflowX: 'auto',
        height: 34, minHeight: 34,
      }}>
        {sessions.map(s => (
          <div
            key={s.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 10px 0 12px', height: '100%', flexShrink: 0,
              cursor: 'pointer', borderRight: '1px solid #1a1a1a',
              background: activeId === s.id ? '#1a1a1a' : 'transparent',
              color: activeId === s.id ? '#e0e0e0' : '#666',
              fontSize: 12,
            }}
            onClick={() => setActiveId(s.id)}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot[s.status] ?? '#555', flexShrink: 0 }} />
            <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.config.displayName ?? s.config.host}
            </span>
            <span
              onClick={e => { e.stopPropagation(); removeTab(s.id) }}
              style={{ color: '#444', fontSize: 11, marginLeft: 2, cursor: 'pointer', lineHeight: 1 }}
            >✕</span>
          </div>
        ))}

        {/* Quick-connect "+" */}
        {showInput ? (
          <form onSubmit={addSession} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px' }}>
            <input
              autoFocus
              value={quickConnect}
              onChange={e => setQuickConnect(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setShowInput(false)}
              placeholder="user@host or local"
              style={{ ...inputSm, width: 160 }}
            />
            <button type="submit" style={{ ...inputSm, cursor: 'pointer', color: '#50fa7b' }}>Add</button>
          </form>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16, padding: '0 12px', height: '100%', lineHeight: 1 }}
          >+</button>
        )}
      </div>

      {/* Terminals — all mounted, only active one visible */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {sessions.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: 16, color: '#444',
          }}>
            <span style={{ fontSize: 13 }}>No sessions in this project.</span>
            <button
              onClick={() => setShowInput(true)}
              style={{
                background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 4,
                color: '#50fa7b', fontFamily: 'inherit', fontSize: 13,
                padding: '7px 16px', cursor: 'pointer',
              }}
            >
              + Add session
            </button>
          </div>
        ) : (
          sessions.map(s => (
            <div key={s.id} style={{
              position: 'absolute', inset: 0,
              visibility: s.id === activeId ? 'visible' : 'hidden',
              zIndex: s.id === activeId ? 1 : 0,
            }}>
              <TerminalView
                sessionId={s.id}
                visible={s.id === activeId}
                onClose={() => removeTab(s.id)}
                onError={setError}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
