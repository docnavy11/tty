import { useState, useEffect, useCallback } from 'react'
import { ProjectHome, type ProjectWithStatus } from './components/ProjectHome'
import { ProjectWorkspace } from './components/ProjectWorkspace'
import { TerminalView } from './components/Terminal'
import { SettingsPanel } from './components/SettingsPanel'
import { Login } from './components/Login'
import { useSettings } from './hooks/useSettings'

interface Session {
  id: string
  config: { displayName?: string; host: string; authType: string; projectId?: string }
  status: string
}

type View =
  | { type: 'home' }
  | { type: 'workspace'; projectId: string; projectName: string }
  | { type: 'terminal'; sessionId: string }

const DISMISSED_KEY = 'tty_dismissed_warnings'

function useSecurityWarnings(authEnabled: boolean | null) {
  const [dismissed, setDismissed] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'))
  )
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const isSecure = window.location.protocol === 'https:'

  const warnings: { id: string; text: string }[] = []
  if (!isLocal && !isSecure)
    warnings.push({ id: 'http', text: 'Connection is not encrypted — your terminal I/O and password are visible on the network. Set up HTTPS.' })
  if (!isLocal && authEnabled === false)
    warnings.push({ id: 'noauth', text: 'No password is set — anyone who can reach this address has full terminal access. Set AUTH_TOKEN and restart.' })

  const visible = warnings.filter(w => !dismissed.has(w.id))
  const dismiss = (id: string) => setDismissed(prev => {
    const next = new Set([...prev, id])
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]))
    return next
  })
  return { visible, dismiss }
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null) // null = loading
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null)
  const [view, setView] = useState<View>({ type: 'home' })
  const [projects, setProjects] = useState<ProjectWithStatus[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const { settings, reload: reloadSettings } = useSettings()
  const { visible: warnings, dismiss: dismissWarning } = useSecurityWarnings(authEnabled)

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(({ authEnabled, authenticated }: { authEnabled: boolean; authenticated: boolean }) => {
        setAuthEnabled(authEnabled)
        setAuthed(!authEnabled || authenticated)
      })
  }, [])

  const refresh = useCallback(async () => {
    const [pRes, sRes] = await Promise.all([
      fetch('/api/projects'),
      fetch('/api/active-sessions'),
    ])
    if (pRes.status === 401) { setAuthed(false); return }
    setProjects(await pRes.json())
    setSessions(await sRes.json())
  }, [])

  useEffect(() => { if (authed) refresh() }, [authed, refresh])

  if (authed === null) return null // loading

  if (!authed) return <Login onLogin={() => setAuthed(true)} />

  const warningBanner = warnings.length > 0 && (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 20000, display: 'flex', flexDirection: 'column' }}>
      {warnings.map(w => (
        <div key={w.id} style={{
          background: '#7d2d00', color: '#ffd', fontSize: 13, padding: '8px 14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          borderBottom: '1px solid #a33',
        }}>
          <span>⚠️ {w.text}</span>
          <button onClick={() => dismissWarning(w.id)} style={{
            background: 'none', border: 'none', color: '#ffd', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 4px', flexShrink: 0,
          }}>✕</button>
        </div>
      ))}
    </div>
  )

  const ungrouped = sessions.filter(s => !s.config.projectId)

  if (view.type === 'workspace') {
    return (
      <>
        {warningBanner}
        <ProjectWorkspace
          projectId={view.projectId}
          projectName={view.projectName}
          settings={settings}
          onBack={() => { setView({ type: 'home' }); refresh() }}
          onOpenSettings={() => setShowSettings(true)}
        />
        <SettingsPanel
          open={showSettings}
          current={settings}
          onClose={() => setShowSettings(false)}
          onSave={reloadSettings}
        />
      </>
    )
  }

  if (view.type === 'terminal') {
    return (
      <div style={{ height: 'var(--vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1a1a1a' }}>
        {warningBanner}
        <TerminalView
          sessionId={view.sessionId}
          settings={settings}
          onClose={() => { setView({ type: 'home' }); refresh() }}
          onError={() => {}}
        />
      </div>
    )
  }

  return (
    <>
      {warningBanner}
      <ProjectHome
        projects={projects}
        allSessions={sessions}
        ungroupedSessions={ungrouped}
        onOpenProject={(id, name) => setView({ type: 'workspace', projectId: id, projectName: name })}
        onOpenSession={(id) => setView({ type: 'terminal', sessionId: id })}
        onKillSession={async (id) => {
          await fetch(`/api/active-sessions/${id}`, { method: 'DELETE' })
          refresh()
        }}
        onRefresh={refresh}
        onOpenSettings={() => setShowSettings(true)}
      />
      <SettingsPanel
        open={showSettings}
        current={settings}
        onClose={() => setShowSettings(false)}
        onSave={reloadSettings}
      />
    </>
  )
}
