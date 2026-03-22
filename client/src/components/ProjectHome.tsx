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
  onOpenSettings: () => void
}

const inp: React.CSSProperties = {
  padding: '10px 12px',
  background: '#0d0d0d',
  border: '1px solid #333',
  borderRadius: 6,
  color: '#e0e0e0',
  fontFamily: 'inherit',
  fontSize: 16,
  outline: 'none',
  width: '100%',
}

const btnPrimary: React.CSSProperties = {
  background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 6,
  color: '#50fa7b', fontFamily: 'inherit', fontSize: 14,
  padding: '10px 18px', cursor: 'pointer', whiteSpace: 'nowrap',
  minHeight: 44,
}

const btnGhost: React.CSSProperties = {
  background: 'none', border: '1px solid #333', borderRadius: 6,
  color: '#888', fontFamily: 'inherit', fontSize: 14,
  padding: '10px 14px', cursor: 'pointer',
  minHeight: 44,
}

const statusDot: Record<string, string> = {
  connected: '#50fa7b', detached: '#888', connecting: '#f1fa8c', pending: '#555',
}

export function ProjectHome({ projects, ungroupedSessions, onOpenProject, onOpenSession, onKillSession, onRefresh, onOpenSettings }: Props) {
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [quickName, setQuickName] = useState('')
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

  const toggleAutostart = async (id: string, current: boolean) => {
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autostart: !current }),
    })
    onRefresh()
  }

  const quickConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setConnecting(true)
    try {
      const res = await fetch('/api/sessions/adhoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authType: 'local', host: 'localhost', username: '', displayName: quickName.trim() || 'shell' }),
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
    <div style={{ height: 'var(--vh, 100%)', overflowY: 'auto', background: '#1a1a1a' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, background: '#1a1a1a', zIndex: 10, paddingBottom: 4, marginBottom: -4 }}>
          <h1 style={{ flex: 1, fontSize: 18, fontWeight: 600, color: '#e0e0e0' }}>WebTerminal</h1>
          <button onClick={onOpenSettings} style={{ ...btnGhost, padding: '10px 12px' }} title="Settings">⚙</button>
          <button onClick={() => setShowNewProject(v => !v)} style={btnPrimary}>+ Project</button>
        </div>

        {/* New project form */}
        {showNewProject && (
          <form onSubmit={createProject} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              autoFocus
              style={inp}
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder="Project name"
              required
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={{ ...btnPrimary, flex: 1 }}>Create</button>
              <button type="button" onClick={() => setShowNewProject(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
            </div>
          </form>
        )}

        {/* Projects */}
        {projects.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ color: '#555', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Projects</div>
            {projects.map(p => (
              <div key={p.id} style={{
                background: '#111', border: '1px solid #222', borderRadius: 8,
                padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                {/* Name + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#ddd', fontSize: 15, fontWeight: 500 }}>{p.name}</div>
                    {p.sessionDefs.length > 0 && (
                      <div style={{ color: '#555', fontSize: 12, marginTop: 2 }}>
                        {p.sessionDefs.map(d => d.name || d.host).join(' · ')}
                      </div>
                    )}
                  </div>
                  {p.totalCount > 0 && (
                    <span style={{ fontSize: 12, color: p.connectedCount > 0 ? '#50fa7b' : '#666', flexShrink: 0 }}>
                      {p.connectedCount}/{p.totalCount}
                    </span>
                  )}
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => onOpenProject(p.id, p.name)}
                    style={{ ...btnPrimary, flex: 1, padding: '9px 12px' }}
                  >Open</button>
                  <button
                    onClick={() => toggleAutostart(p.id, p.autostart)}
                    title={p.autostart ? 'Autostart on' : 'Autostart off'}
                    style={{
                      ...btnGhost,
                      padding: '9px 12px',
                      border: `1px solid ${p.autostart ? '#2a4a2a' : '#333'}`,
                      color: p.autostart ? '#50fa7b' : '#555',
                      background: p.autostart ? '#1a2a1a' : 'none',
                    }}
                  >Auto</button>
                  <button
                    onClick={() => deleteProject(p.id)}
                    style={{ ...btnGhost, padding: '9px 12px', color: '#444' }}
                  >✕</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Ungrouped sessions */}
        {ungroupedSessions.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ color: '#555', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Sessions</div>
            {ungroupedSessions.map(s => (
              <div key={s.id} style={{
                background: '#111', border: '1px solid #222', borderRadius: 8,
                padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, minHeight: 52,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot[s.status] ?? '#555', flexShrink: 0 }} />
                <span onClick={() => onOpenSession(s.id)} style={{ flex: 1, color: '#ccc', fontSize: 14, cursor: 'pointer' }}>
                  {s.config.displayName ?? s.config.host}
                </span>
                <span style={{ color: '#555', fontSize: 12, flexShrink: 0 }}>{s.status}</span>
                <button onClick={() => onKillSession(s.id)} style={{ ...btnGhost, border: 'none', padding: '8px', minHeight: 0, color: '#555' }}>✕</button>
              </div>
            ))}
          </section>
        )}

        {/* Quick connect */}
        <form onSubmit={quickConnect} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            style={inp}
            value={quickName}
            onChange={e => setQuickName(e.target.value)}
            placeholder="Session name (optional)"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" disabled={connecting} style={{ ...btnPrimary, width: '100%', textAlign: 'center' }}>
            {connecting ? 'Connecting…' : '+ New shell'}
          </button>
        </form>

        {error && (
          <div style={{ color: '#ff5555', fontSize: 13, padding: '10px 12px', background: '#1a0000', border: '1px solid #550000', borderRadius: 6 }}>
            {error}
          </div>
        )}

      </div>
    </div>
  )
}
