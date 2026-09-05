import { useState, useEffect, useCallback, useMemo } from 'react'

interface WorkspaceSession {
  id: string
  displayName: string
  status: string
}

interface Workspace {
  name: string
  path: string
  mtime: string | null
  recent: string | null
  git: boolean
  branch?: string
  sessions: WorkspaceSession[]
}

interface Props {
  onOpenSession: (id: string) => void
  onRefresh: () => void
  // Changes whenever the parent's session set changes, so the list re-fetches
  // and a session killed elsewhere stops being offered here.
  revision: string
}

const statusDot: Record<string, string> = {
  connected: '#50fa7b', detached: '#888', connecting: '#f1fa8c',
  pending: '#555', orphaned: '#ffb86c',
}

// How many rows before the list collapses. There are ~80 directories under the
// root; showing all of them by default buries the recent ones, which are the
// entire point of sorting by recency.
const COLLAPSED = 12

function ago(iso: string | null): string {
  if (!iso) return ''
  const secs = (Date.now() - new Date(iso).getTime()) / 1000
  if (secs < 90) return 'just now'
  const mins = secs / 60
  if (mins < 60) return `${Math.round(mins)}m`
  const hours = mins / 60
  if (hours < 24) return `${Math.round(hours)}h`
  const days = hours / 24
  if (days < 30) return `${Math.round(days)}d`
  const months = days / 30
  if (months < 12) return `${Math.round(months)}mo`
  return `${Math.round(days / 365)}y`
}

const inp: React.CSSProperties = {
  padding: '10px 12px', background: '#0d0d0d', border: '1px solid #333',
  borderRadius: 6, color: '#e0e0e0', fontFamily: 'inherit', fontSize: 16,
  outline: 'none', width: '100%',
}

const btnGhost: React.CSSProperties = {
  background: 'none', border: '1px solid #333', borderRadius: 6,
  color: '#888', fontFamily: 'inherit', fontSize: 14,
  padding: '10px 14px', cursor: 'pointer', minHeight: 44,
}

export function WorkspaceList({ onOpenSession, onRefresh, revision }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [root, setRoot] = useState('')
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/workspaces')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(({ root, workspaces }) => { setRoot(root); setWorkspaces(workspaces) })
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load, revision])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matched = q ? workspaces.filter(w => w.name.toLowerCase().includes(q)) : workspaces
    // A filter is an explicit request to see everything that matches.
    return (expanded || q) ? matched : matched.slice(0, COLLAPSED)
  }, [workspaces, filter, expanded])

  const withSessions = workspaces.filter(w => w.sessions.length > 0).length

  const newSession = async (w: Workspace) => {
    setBusy(w.path)
    setError(null)
    try {
      const res = await fetch('/api/workspaces/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: w.path, name: w.name }),
      })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? await res.text())
      const { sessionId } = await res.json()
      onRefresh()
      onOpenSession(sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (workspaces.length === 0) return null

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <div style={{ color: '#555', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Projects ({workspaces.length})
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#444', fontSize: 10 }} title={root}>
          {withSessions > 0 ? `${withSessions} with a session` : root}
        </span>
      </div>

      <input
        style={{ ...inp, marginBottom: 4 }}
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filter projects…"
        autoComplete="off"
        spellCheck={false}
      />

      {shown.map(w => (
        <div key={w.path} style={{
          background: '#111', border: '1px solid #222', borderRadius: 8,
          padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ color: '#ddd', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {w.name}
              </div>
              <div style={{ color: '#444', fontSize: 10, marginTop: 2 }}>
                {w.branch && <span style={{ color: '#6272a4' }}>{w.branch}</span>}
                {w.branch && w.mtime && ' · '}
                {w.mtime && ago(w.mtime)}
                {!w.git && <span style={{ color: '#553' }}>{(w.branch || w.mtime) ? ' · ' : ''}no git</span>}
              </div>
            </div>
            <button
              onClick={() => newSession(w)}
              disabled={busy === w.path}
              title={`New shell in ${w.path}`}
              style={{
                ...btnGhost, padding: '8px 12px', minHeight: 0, flexShrink: 0,
                background: '#1a2a1a', border: '1px solid #2a4a2a', color: '#50fa7b',
                opacity: busy === w.path ? 0.5 : 1,
              }}
            >{busy === w.path ? '…' : '+ shell'}</button>
          </div>

          {w.sessions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {w.sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => onOpenSession(s.id)}
                  title={`Open ${s.displayName} (${s.status})`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 999,
                    color: '#bbb', fontFamily: 'inherit', fontSize: 12,
                    padding: '5px 11px', cursor: 'pointer',
                  }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: statusDot[s.status] ?? '#555', flexShrink: 0,
                  }} />
                  {s.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {!filter.trim() && workspaces.length > COLLAPSED && (
        <button onClick={() => setExpanded(v => !v)} style={{ ...btnGhost, minHeight: 0, padding: '8px 12px', fontSize: 12 }}>
          {expanded ? 'Show less' : `Show all ${workspaces.length}`}
        </button>
      )}

      {filter.trim() && shown.length === 0 && (
        <div style={{ color: '#555', fontSize: 12, padding: '8px 2px' }}>No project matches “{filter.trim()}”.</div>
      )}

      {error && (
        <div style={{ color: '#ff5555', fontSize: 13, padding: '10px 12px', background: '#1a0000', border: '1px solid #550000', borderRadius: 6 }}>
          {error}
        </div>
      )}
    </section>
  )
}
