import { useState, useEffect, useCallback } from 'react'
import { ProjectHome, type ProjectWithStatus } from './components/ProjectHome'
import { ProjectWorkspace } from './components/ProjectWorkspace'
import { TerminalView } from './components/Terminal'
import { SettingsPanel } from './components/SettingsPanel'
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

export default function App() {
  const [view, setView] = useState<View>({ type: 'home' })
  const [projects, setProjects] = useState<ProjectWithStatus[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const { settings, reload: reloadSettings } = useSettings()

  const refresh = useCallback(async () => {
    const [pRes, sRes] = await Promise.all([
      fetch('/api/projects'),
      fetch('/api/active-sessions'),
    ])
    setProjects(await pRes.json())
    setSessions(await sRes.json())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const ungrouped = sessions.filter(s => !s.config.projectId)

  if (view.type === 'workspace') {
    return (
      <>
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
      <ProjectHome
        projects={projects}
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
