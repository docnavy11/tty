import { useState } from 'react'

export interface ProjectWithStatus {
  id: string
  name: string
  autostart: boolean
  sessionDefs: { id: string; name: string; host: string; authType: string }[]
  activeSessionIds: string[]
  connectedCount: number
  totalCount: number
}

interface Props {
  projects: ProjectWithStatus[]
  ungroupedSessions: { id: string; config: { displayName?: string; host: string; authType: string }; status: string }[]
  onOpenProject: (id: string, name: string) => void
  onOpenSession: (id: string) => void
  onKillSession: (id: string) => void
  onRefresh: () => void
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  background: '#0d0d0d',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#e0e0e0',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
}

const statusDot: Record<string, string> = {
  connected: '#50fa7b', detached: '#888', connecting: '#f1fa8c', pending: '#555',
}

export function ProjectHome({ projects, ungroupedSessions, onOpenProject, onOpenSession, onKillSession, onRefresh }: Props) {
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [quickTarget, setQuickTarget] = useState('local')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProjectName.trim()) return
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newProjectName.trim() }),
    })
    setNewProjectName('')
    setShowNewProject(false)
    onRefresh()
  }

  const deleteProject = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    onRefresh()
  }

  const quickConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setConnecting(true)
    try {
      const target = quickTarget.trim()
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
      const { sessionId } = await res.json()
      onRefresh()
      onOpenSession(sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#1a1a1a', padding: '32px 24px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', margin: 0 }}>WebTerminal</h1>
          <button
            onClick={() => setShowNewProject(v => !v)}
            style={{ background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 4, color: '#50fa7b', fontFamily: 'inherit', fontSize: 12, padding: '5px 12px', cursor: 'pointer' }}
          >
            + New project
          </button>
        </div>

        {/* New project form */}
        {showNewProject && (
          <form onSubmit={createProject} style={{ display: 'flex', gap: 8 }}>
            <input
              autoFocus
              style={{ ...inputStyle, flex: 1 }}
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder="Project name"
              required
            />
            <button type="submit" style={{ ...inputStyle, cursor: 'pointer', color: '#50fa7b', whiteSpace: 'nowrap' }}>Create</button>
            <button type="button" onClick={() => setShowNewProject(false)} style={{ ...inputStyle, cursor: 'pointer', color: '#555' }}>Cancel</button>
          </form>
        )}

        {/* Projects */}
        {projects.length > 0 && (
          <section>
            <div style={{ color: '#444', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Projects</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {projects.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px',
                  background: '#111', border: '1px solid #222', borderRadius: 6,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#ccc', fontSize: 13 }}>{p.name}</div>
                    {p.sessionDefs.length > 0 && (
                      <div style={{ color: '#444', fontSize: 11, marginTop: 2 }}>
                        {p.sessionDefs.map(d => d.name || d.host).join(' · ')}
                      </div>
                    )}
                  </div>

                  {p.totalCount > 0 && (
                    <span style={{ fontSize: 11, color: p.connectedCount > 0 ? '#50fa7b' : '#888' }}>
                      {p.connectedCount}/{p.totalCount}
                    </span>
                  )}

                  <button
                    onClick={() => onOpenProject(p.id, p.name)}
                    style={{ background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 4, color: '#50fa7b', fontFamily: 'inherit', fontSize: 12, padding: '4px 12px', cursor: 'pointer' }}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => deleteProject(p.id)}
                    style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13 }}
                  >✕</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Ungrouped sessions */}
        {ungroupedSessions.length > 0 && (
          <section>
            <div style={{ color: '#444', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Sessions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {ungroupedSessions.map(s => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 14px',
                  background: '#111', border: '1px solid #222', borderRadius: 6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot[s.status] ?? '#555', flexShrink: 0 }} />
                  <span onClick={() => onOpenSession(s.id)} style={{ flex: 1, color: '#ccc', fontSize: 13, cursor: 'pointer' }}>
                    {s.config.displayName ?? s.config.host}
                  </span>
                  <span style={{ color: '#444', fontSize: 11 }}>{s.status}</span>
                  <button onClick={() => onKillSession(s.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Quick connect */}
        <form onSubmit={quickConnect} style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={quickTarget}
            onChange={e => setQuickTarget(e.target.value)}
            placeholder="user@host  or  local"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={connecting}
            style={{ ...inputStyle, cursor: connecting ? 'not-allowed' : 'pointer', color: connecting ? '#555' : '#50fa7b', whiteSpace: 'nowrap' }}
          >
            {connecting ? '…' : 'Connect'}
          </button>
        </form>

        {error && (
          <div style={{ color: '#ff5555', fontSize: 12, padding: '8px 10px', background: '#1a0000', border: '1px solid #550000', borderRadius: 4 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
