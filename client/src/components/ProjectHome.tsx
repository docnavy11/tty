import { useState, useEffect, useCallback } from 'react'
import { ServerStats } from './ServerStats'
import { WorkspaceList } from './WorkspaceList'

interface TmuxStats {
  name: string
  cpu: number
  mem: number
  pid: number
}

export interface ProjectWithStatus {
  id: string
  name: string
  autostart: boolean
  sessionDefs: { id: string; name: string; host: string; authType: string }[]
  activeSessionIds: string[]
  connectedCount: number
  totalCount: number
}

interface SessionInfo {
  id: string
  config: { displayName?: string; host: string; authType: string; projectId?: string }
  status: string
  cwd?: string
}

interface Props {
  projects: ProjectWithStatus[]
  allSessions: SessionInfo[]
  ungroupedSessions: SessionInfo[]
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
  // Record kept, but its tmux session could not be found. Never auto-deleted —
  // dismiss with the ✕ button once you are sure it is really gone.
  orphaned: '#ffb86c',
}

function shortPath(path: string): string {
  return path.replace(/^\/(?:home\/[^/]+|root|Users\/[^/]+)(?=\/|$)/, '~')
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)}M`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`
}

export function ProjectHome({ projects, allSessions, onOpenProject, onOpenSession, onKillSession, onRefresh, onOpenSettings }: Props) {
  const [tmuxStats, setTmuxStats] = useState<Map<string, TmuxStats>>(new Map())

  // Fetch stats once on mount + when sessions change (server caches this, so it's cheap)
  const fetchTmuxStats = useCallback(() => {
    fetch('/api/stats?tmux=1')
      .then(r => r.json())
      .then(data => {
        const map = new Map<string, TmuxStats>()
        for (const t of data.tmux ?? []) {
          map.set(t.name, t)
        }
        setTmuxStats(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchTmuxStats() }, [allSessions.length])

  // Match session ID to tmux name: "wt_" + id without dashes
  const getSessionStats = (sessionId: string): TmuxStats | undefined => {
    const tmuxName = 'wt_' + sessionId.replace(/-/g, '').slice(0, 16)
    return tmuxStats.get(tmuxName)
  }

  // Which session row is in edit mode, and the in-progress name.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

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

  const commitRename = async (id: string) => {
    const name = draftName.trim()
    setRenamingId(null)
    const current = allSessions.find(s => s.id === id)
    if (!current || name === (current.config.displayName ?? '')) return
    await fetch(`/api/active-sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name }),
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
          <ServerStats />
          <button onClick={onOpenSettings} style={{ ...btnGhost, padding: '10px 12px' }} title="Settings">⚙</button>
          <button onClick={() => setShowNewProject(v => !v)} style={btnPrimary}>+ Group</button>
        </div>

        {/* New project form */}
        {showNewProject && (
          <form onSubmit={createProject} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              autoFocus
              style={inp}
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder="Session group name"
              required
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={{ ...btnPrimary, flex: 1 }}>Create</button>
              <button type="button" onClick={() => setShowNewProject(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
            </div>
          </form>
        )}

        {/* Active sessions first: what is already running is what you most
            often came here to get back to. The project list below is for
            starting something new. */}
        {allSessions.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ color: '#555', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Active Sessions ({allSessions.length})
              </div>
              <div style={{ flex: 1 }} />
              <span style={{ color: '#444', fontSize: 10 }}>
                {allSessions.filter(s => s.status === 'connected').length} connected
                {' / '}
                {allSessions.filter(s => s.status === 'detached').length} detached
                {allSessions.some(s => s.status === 'orphaned') && (
                  <span style={{ color: '#ffb86c' }}>
                    {' / '}
                    {allSessions.filter(s => s.status === 'orphaned').length} orphaned
                  </span>
                )}
              </span>
            </div>
            {allSessions.map(s => {
              const projectName = s.config.projectId
                ? projects.find(p => p.activeSessionIds.includes(s.id))?.name
                : undefined
              const st = getSessionStats(s.id)
              return (
                <div key={s.id} style={{
                  background: '#111', border: '1px solid #222', borderRadius: 8,
                  padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot[s.status] ?? '#555', flexShrink: 0 }} />
                    <div
                      onClick={() => { if (renamingId !== s.id) onOpenSession(s.id) }}
                      style={{ flex: 1, cursor: renamingId === s.id ? 'default' : 'pointer', overflow: 'hidden' }}
                    >
                      {renamingId === s.id ? (
                        <input
                          autoFocus
                          value={draftName}
                          onChange={e => setDraftName(e.target.value)}
                          onBlur={() => commitRename(s.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commitRename(s.id) }
                            // Escape must abandon the draft, so clear the row
                            // first — onBlur fires next and would otherwise
                            // save what Escape just rejected.
                            if (e.key === 'Escape') { setRenamingId(null) }
                          }}
                          onClick={e => e.stopPropagation()}
                          maxLength={80}
                          spellCheck={false}
                          style={{
                            width: '100%', background: '#0d0d0d', border: '1px solid #2a4a2a',
                            borderRadius: 4, color: '#e0e0e0', fontFamily: 'inherit',
                            fontSize: 13, padding: '2px 6px', outline: 'none',
                          }}
                        />
                      ) : (
                        <div style={{ color: '#ccc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.config.displayName ?? s.config.host}
                        </div>
                      )}
                      {(projectName || s.cwd) && (
                        <div
                          title={s.cwd}
                          style={{
                            color: '#444', fontSize: 10, marginTop: 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >
                          {projectName}
                          {projectName && s.cwd && ' · '}
                          {s.cwd && shortPath(s.cwd)}
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                      background: s.status === 'connected' ? '#1a2a1a'
                        : s.status === 'detached' ? '#2a2a1a'
                        : s.status === 'orphaned' ? '#2a1f12' : '#1a1a2a',
                      color: statusDot[s.status] ?? '#555',
                      border: `1px solid ${s.status === 'connected' ? '#2a4a2a' : s.status === 'orphaned' ? '#5a3a1a' : '#333'}`,
                    }}
                    title={s.status === 'orphaned'
                      ? 'tmux session not found. The record is kept so you do not lose the name — open it to recreate, or ✕ to discard.'
                      : undefined}>
                      {s.status}
                    </span>
                    <button
                      onClick={() => {
                        setDraftName(s.config.displayName ?? '')
                        setRenamingId(s.id)
                      }}
                      title="Rename session"
                      style={{ ...btnGhost, border: 'none', padding: '6px', minHeight: 0, color: '#555', fontSize: 12 }}
                    >{'\u270e'}</button>
                    <button
                      onClick={() => onKillSession(s.id)}
                      title="Kill session"
                      style={{ ...btnGhost, border: 'none', padding: '6px', minHeight: 0, color: '#555', fontSize: 13 }}
                    >{'\u2715'}</button>
                  </div>
                  {/* Per-session stats */}
                  {st && (
                    <div style={{ display: 'flex', gap: 12, paddingLeft: 18, fontSize: 10 }}>
                      <span style={{ color: '#50fa7b' }}>CPU {st.cpu}%</span>
                      <span style={{ color: '#8be9fd' }}>MEM {fmtBytes(st.mem)}</span>
                      {st.pid > 0 && <span style={{ color: '#333' }}>pid {st.pid}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {/* Project directories on disk. Distinct from the session groups below:
            this is the filesystem, sorted by what was touched most recently. */}
        <WorkspaceList
          onOpenSession={onOpenSession}
          onRefresh={onRefresh}
          revision={allSessions.map(s => `${s.id}:${s.status}`).join(',')}
        />

        {/* Session groups */}
        {projects.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ color: '#555', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Session groups</div>
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
