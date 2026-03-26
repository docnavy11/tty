import { useState, useEffect, useRef, useCallback } from 'react'
import { TerminalView } from './Terminal'
import { GridCell } from './GridCell'
import { FileBrowser } from './FileBrowser'
import type { AppSettings } from '../hooks/useSettings'

interface Session {
  id: string
  config: { displayName?: string; host: string; authType: string; projectSessionId?: string }
  status: string
}

interface Props {
  projectId: string
  projectName: string
  settings?: AppSettings
  onBack: () => void
  onOpenSettings: () => void
}

const statusDot: Record<string, string> = {
  connected: '#50fa7b', detached: '#888', connecting: '#f1fa8c', pending: '#555',
}

const inputSm: React.CSSProperties = {
  background: '#0d0d0d', border: '1px solid #333', borderRadius: 3,
  color: '#e0e0e0', fontFamily: 'inherit', fontSize: 12,
  padding: '3px 8px', outline: 'none',
}

type LayoutMode = 'tabs' | 'grid'

export function ProjectWorkspace({ projectId, projectName, settings, onBack, onOpenSettings }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [leftId, setLeftId] = useState<string | null>(null)
  const [rightId, setRightId] = useState<string | null>(null)
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left')
  const [splitActive, setSplitActive] = useState(false)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => (localStorage.getItem('tty_layout_mode') as LayoutMode) || 'tabs')
  const [gridFocusId, setGridFocusId] = useState<string | null>(null)
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [showInput, setShowInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showFiles, setShowFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activityMap, setActivityMap] = useState<Record<string, 'busy' | 'done' | 'idle'>>({})

  const handleActivity = useCallback((id: string, status: 'busy' | 'done' | 'idle') => {
    setActivityMap(prev => prev[id] === status ? prev : { ...prev, [id]: status })
  }, [])
  const panesRef = useRef<HTMLDivElement>(null)

  // The "primary" active id (for file browser, tab highlight, etc.)
  const activeId = layoutMode === 'grid' ? gridFocusId : (focusedPane === 'left' ? leftId : rightId)

  // Responsive: track desktop breakpoint, auto-switch to tabs if too narrow
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches)
      if (!e.matches) setLayoutMode('tabs')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Persist layout preference
  useEffect(() => { localStorage.setItem('tty_layout_mode', layoutMode) }, [layoutMode])

  const toggleLayoutMode = () => {
    setLayoutMode(prev => {
      const next = prev === 'tabs' ? 'grid' : 'tabs'
      if (next === 'grid') {
        setSplitActive(false)
        setGridFocusId(leftId)
      }
      return next
    })
  }

  const gridCols = Math.ceil(Math.sqrt(sessions.length))

  // Grid keyboard shortcuts: Escape to un-maximize
  useEffect(() => {
    if (layoutMode !== 'grid') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && maximizedId) {
        setMaximizedId(null)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [layoutMode, maximizedId])

  // Inject pulse animation once
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = '@keyframes tab-pulse{0%,100%{opacity:1}50%{opacity:0.35}}'
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

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
            setLeftId(mine[0]?.id ?? null)
            setRightId(mine[1]?.id ?? mine[0]?.id ?? null)
          })
      })
      .catch(err => setError(String(err)))
  }, [projectId])

  const addSession = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim() || 'shell'
    setError(null)
    let defId: string | null = null
    try {
      const defRes = await fetch(`/api/projects/${projectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, host: 'localhost', username: '', authType: 'local', port: 22 }),
      })
      if (!defRes.ok) throw new Error(await defRes.text())
      const def = await defRes.json()
      defId = def.id

      const launchRes = await fetch(`/api/projects/${projectId}/launch`, { method: 'POST' })
      if (!launchRes.ok) throw new Error(await launchRes.text())
      const { sessionIds } = await launchRes.json()

      const all: Session[] = await fetch('/api/active-sessions').then(r => r.json())
      const mine = all.filter(s => sessionIds.includes(s.id))
      setSessions(mine)
      const newId = sessionIds[sessionIds.length - 1] ?? mine[0]?.id ?? null
      if (focusedPane === 'left') setLeftId(newId)
      else setRightId(newId)
      setNewName('')
      setShowInput(false)
    } catch (err) {
      if (defId) await fetch(`/api/projects/${projectId}/sessions/${defId}`, { method: 'DELETE' }).catch(() => {})
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const startRename = (s: Session) => {
    setRenamingId(s.id)
    setRenameValue(s.config.displayName ?? s.config.host)
  }

  const commitRename = async (id: string) => {
    const name = renameValue.trim()
    setRenamingId(null)
    if (!name) return
    const session = sessions.find(s => s.id === id)
    if (!session?.config.projectSessionId) return
    await fetch(`/api/projects/${projectId}/sessions/${session.config.projectSessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setSessions(prev => prev.map(s => s.id === id ? { ...s, config: { ...s.config, displayName: name } } : s))
  }

  const removeTab = async (id: string) => {
    const session = sessions.find(s => s.id === id)
    await fetch(`/api/active-sessions/${id}`, { method: 'DELETE' })
    if (session?.config.projectSessionId) {
      await fetch(`/api/projects/${projectId}/sessions/${session.config.projectSessionId}`, { method: 'DELETE' })
    }
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      const fallback = next[0]?.id ?? null
      if (leftId === id) setLeftId(fallback)
      if (rightId === id) setRightId(fallback)
      return next
    })
  }

  const handleTabClick = (id: string) => {
    if (!splitActive) {
      setLeftId(id)
      setFocusedPane('left')
    } else if (focusedPane === 'left') {
      setLeftId(id)
    } else {
      setRightId(id)
    }
    setActivityMap(prev => prev[id] === 'done' ? { ...prev, [id]: 'idle' } : prev)
  }

  const toggleSplit = () => {
    setSplitActive(v => {
      if (!v) {
        // Activate: right pane gets next session, or same
        const ids = sessions.map(s => s.id)
        const nextIdx = (ids.indexOf(leftId ?? '') + 1) % Math.max(ids.length, 1)
        setRightId(ids[nextIdx] ?? leftId)
        setFocusedPane('left')
      }
      return !v
    })
  }

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = panesRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()

    const onMove = (ev: MouseEvent) => {
      const ratio = (ev.clientX - rect.left) / rect.width
      setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Tab top-border color: green = in left pane, cyan = in right pane
  const tabBorderColor = (id: string) => {
    if (!splitActive) return id === leftId ? '#50fa7b' : 'transparent'
    if (id === leftId && id === rightId) return '#50fa7b'
    if (id === leftId) return '#50fa7b'
    if (id === rightId) return '#8be9fd'
    return 'transparent'
  }

  const tabActive = (id: string) => id === leftId || (splitActive && id === rightId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'var(--vh, 100dvh)', overflow: 'hidden', background: '#1a1a1a' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: '#161616', borderBottom: '1px solid #2a2a2a',
        flexShrink: 0, height: 46, minHeight: 46, overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 10px 0 14px', flexShrink: 0 }}>‹</button>
        <span style={{ color: '#ccc', fontSize: 14, fontWeight: 600, paddingRight: 14, borderRight: '1px solid #2a2a2a', flexShrink: 0 }}>{projectName}</span>
        {error && <span style={{ color: '#ff5555', fontSize: 11, marginLeft: 8, flexShrink: 0 }}>{error}</span>}

        {sessions.map(s => (
          <div
            key={s.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '0 12px 0 16px', height: '100%', flexShrink: 0,
              cursor: 'pointer', borderRight: '1px solid #333',
              background: tabActive(s.id) ? '#252525' : '#1a1a1a',
              color: tabActive(s.id) ? '#ffffff' : '#aaa',
              fontSize: 13, fontWeight: tabActive(s.id) ? 500 : 400,
              borderTop: `2px solid ${tabBorderColor(s.id)}`,
            }}
            onClick={() => handleTabClick(s.id)}
            onDoubleClick={() => startRename(s)}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: activityMap[s.id] === 'busy' ? '#f1fa8c' : activityMap[s.id] === 'done' ? '#ffb86c' : (statusDot[s.status] ?? '#555'),
              animation: activityMap[s.id] === 'busy' ? 'tab-pulse 1s ease-in-out infinite' : 'none',
            }} />
            {renamingId === s.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => commitRename(s.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(s.id)
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                onClick={e => e.stopPropagation()}
                style={{ ...inputSm, width: 100, padding: '1px 6px' }}
              />
            ) : (
              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.config.displayName ?? s.config.host}
              </span>
            )}
            <span
              onClick={e => { e.stopPropagation(); removeTab(s.id) }}
              style={{ color: tabActive(s.id) ? '#aaa' : '#666', fontSize: 13, marginLeft: 2, cursor: 'pointer', lineHeight: 1 }}
            >✕</span>
          </div>
        ))}

        {showInput ? (
          <form onSubmit={addSession} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px' }}>
            <input
              autoFocus value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setShowInput(false)}
              placeholder="Session name"
              style={{ ...inputSm, width: 130 }}
            />
            <button type="submit" style={{ ...inputSm, cursor: 'pointer', color: '#50fa7b' }}>Add</button>
          </form>
        ) : (
          <button onClick={() => setShowInput(true)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18, padding: '0 14px', height: '100%', lineHeight: 1 }}>+</button>
        )}

        <div style={{ flex: 1 }} />

        {/* Split toggle — hidden in grid mode */}
        {layoutMode === 'tabs' && (
          <button
            onClick={toggleSplit}
            title={splitActive ? 'Close split' : 'Split pane'}
            style={{
              background: splitActive ? '#1a2a2a' : 'none',
              border: splitActive ? '1px solid #2a4a4a' : '1px solid transparent',
              borderRadius: 3, color: splitActive ? '#8be9fd' : '#666',
              cursor: 'pointer', fontSize: 13, padding: '0 10px', height: 28,
              fontFamily: 'inherit',
            }}
          >&#x229F;</button>
        )}

        {/* Grid toggle — desktop only */}
        {isDesktop && (
          <button
            onClick={toggleLayoutMode}
            title={layoutMode === 'grid' ? 'Switch to tabs' : 'Switch to grid'}
            style={{
              background: layoutMode === 'grid' ? '#1a2a1a' : 'none',
              border: layoutMode === 'grid' ? '1px solid #2a4a2a' : '1px solid transparent',
              borderRadius: 3, color: layoutMode === 'grid' ? '#50fa7b' : '#666',
              cursor: 'pointer', fontSize: 13, padding: '0 10px', height: 28,
              fontFamily: 'inherit', marginLeft: 4,
            }}
          >&#x2395;</button>
        )}

        {/* File browser toggle */}
        <button
          onClick={() => setShowFiles(v => !v)}
          title="Toggle file browser"
          style={{
            background: showFiles ? '#1a2a1a' : 'none',
            border: showFiles ? '1px solid #2a4a2a' : '1px solid transparent',
            borderRadius: 3, color: showFiles ? '#50fa7b' : '#666',
            cursor: 'pointer', fontSize: 13, padding: '0 10px', height: 28,
            fontFamily: 'inherit', marginLeft: 4,
          }}
        >Files</button>

        <button onClick={onOpenSettings} title="Settings" style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 15, padding: '0 12px', height: '100%' }}>⚙</button>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Terminal panes — tabs mode */}
        {layoutMode === 'tabs' && (
          <div ref={panesRef} style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
            {sessions.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16, color: '#444' }}>
                <span style={{ fontSize: 13 }}>No sessions in this project.</span>
                <button
                  onClick={() => setShowInput(true)}
                  style={{ background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 4, color: '#50fa7b', fontFamily: 'inherit', fontSize: 13, padding: '7px 16px', cursor: 'pointer' }}
                >+ Add session</button>
              </div>
            ) : (
              <>
                {/* All terminals in one layer — each positioned to its pane slot */}
                {sessions.map(s => {
                  const isLeft = s.id === leftId
                  const isRight = splitActive && s.id === rightId && s.id !== leftId
                  const visible = isLeft || isRight
                  let style: React.CSSProperties
                  if (!splitActive) {
                    style = { position: 'absolute', inset: 0, visibility: isLeft ? 'visible' : 'hidden', zIndex: isLeft ? 1 : 0 }
                  } else if (isLeft) {
                    style = { position: 'absolute', top: 0, bottom: 0, left: 0, width: `calc(${splitRatio * 100}% - 2px)`, visibility: 'visible', zIndex: 1 }
                  } else if (isRight) {
                    style = { position: 'absolute', top: 0, bottom: 0, right: 0, width: `${(1 - splitRatio) * 100}%`, visibility: 'visible', zIndex: 1 }
                  } else {
                    style = { position: 'absolute', inset: 0, visibility: 'hidden', zIndex: 0 }
                  }
                  return (
                    <div key={s.id} style={style} onClick={() => { if (splitActive) setFocusedPane(isLeft ? 'left' : 'right') }}>
                      <TerminalView sessionId={s.id} visible={visible} showHeader={false} settings={settings} onClose={() => removeTab(s.id)} onError={setError} onActivity={status => handleActivity(s.id, status)} />
                    </div>
                  )
                })}

                {/* Divider */}
                {splitActive && (
                  <div
                    onMouseDown={onDividerMouseDown}
                    style={{
                      position: 'absolute', top: 0, bottom: 0, zIndex: 20,
                      left: `calc(${splitRatio * 100}% - 3px)`, width: 6,
                      background: '#444', cursor: 'col-resize',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#8be9fd')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#444')}
                  >
                    <div style={{ width: 2, height: 40, borderRadius: 1, background: '#666', pointerEvents: 'none' }} />
                  </div>
                )}

                {/* Focused-pane indicator: 2px colored top bar */}
                {splitActive && (
                  <>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: `calc(${splitRatio * 100}% - 2px)`, height: 2, zIndex: 19, pointerEvents: 'none', background: focusedPane === 'left' ? '#50fa7b' : '#333' }} />
                    <div style={{ position: 'absolute', top: 0, right: 0, width: `${(1 - splitRatio) * 100}%`, height: 2, zIndex: 19, pointerEvents: 'none', background: focusedPane === 'right' ? '#8be9fd' : '#333' }} />
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Terminal panes — grid mode */}
        {layoutMode === 'grid' && (
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {sessions.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: '#444' }}>
                <span style={{ fontSize: 13 }}>No sessions in this project.</span>
                <button
                  onClick={() => setShowInput(true)}
                  style={{ background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 4, color: '#50fa7b', fontFamily: 'inherit', fontSize: 13, padding: '7px 16px', cursor: 'pointer' }}
                >+ Add session</button>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                gridAutoRows: '1fr',
                gap: 4,
                padding: 4,
                height: '100%',
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}>
                {sessions.map(s => {
                  const isMaximized = s.id === maximizedId
                  return (
                    <div
                      key={s.id}
                      style={isMaximized
                        ? { position: 'fixed', inset: 0, zIndex: 10, background: '#1a1a1a', padding: 0, display: 'flex', flexDirection: 'column' }
                        : { display: maximizedId ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }
                      }
                    >
                      <GridCell
                        sessionId={s.id}
                        label={s.config.displayName ?? s.config.host}
                        focused={isMaximized || s.id === gridFocusId}
                        activity={activityMap[s.id]}
                        settings={settings}
                        onFocus={() => setGridFocusId(s.id)}
                        onMaximize={() => { isMaximized ? setMaximizedId(null) : setMaximizedId(s.id); setGridFocusId(s.id) }}
                        onClose={() => { if (isMaximized) setMaximizedId(null); removeTab(s.id) }}
                        onError={msg => setError(msg)}
                        onActivity={status => handleActivity(s.id, status)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {showFiles && <FileBrowser sessionId={activeId} onClose={() => setShowFiles(false)} />}
      </div>
    </div>
  )
}
