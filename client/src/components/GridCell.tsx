import { useRef, useCallback } from 'react'
import { TerminalCore } from './TerminalCore'
import type { TerminalCoreHandle } from './TerminalCore'
import type { AppSettings } from '../hooks/useSettings'

interface GridCellProps {
  sessionId: string
  label: string
  focused: boolean
  activity: 'busy' | 'done' | 'idle' | undefined
  settings?: AppSettings
  onFocus: () => void
  onMaximize: () => void
  onClose: () => void
  onError: (msg: string) => void
  onActivity: (status: 'busy' | 'done' | 'idle') => void
}

const cellBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#666', cursor: 'pointer',
  fontSize: 11, padding: '0 4px', lineHeight: 1,
}

const activityColor: Record<string, string> = {
  busy: '#f1fa8c',
  done: '#ffb86c',
  idle: '#50fa7b',
}

export function GridCell({ sessionId, label, focused, activity, settings, onFocus, onMaximize, onClose, onError, onActivity }: GridCellProps) {
  const coreRef = useRef<TerminalCoreHandle>(null)

  const handleClick = useCallback(() => {
    onFocus()
    coreRef.current?.focus()
  }, [onFocus])

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        height: '100%', minHeight: 0,
        border: focused ? '2px solid #50fa7b' : '1px solid #333',
        borderRadius: 4,
        // Compensate for border width difference so grid doesn't shift on focus change
        margin: focused ? 0 : 1,
      }}
    >
      {/* Compact header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 8px', background: focused ? '#1a2a1a' : '#161616',
        borderBottom: '1px solid #2a2a2a', flexShrink: 0, minHeight: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: activityColor[activity ?? ''] ?? '#555',
            animation: activity === 'busy' ? 'tab-pulse 1s ease-in-out infinite' : 'none',
          }} />
          <span style={{
            color: focused ? '#ccc' : '#888', fontSize: 11, fontWeight: focused ? 500 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onMaximize() }}
            title="Maximize"
            style={cellBtnStyle}
          >&#x26F6;</button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose() }}
            title="Close"
            style={cellBtnStyle}
          >&#x2715;</button>
        </div>
      </div>
      <TerminalCore
        ref={coreRef}
        sessionId={sessionId}
        visible={true}
        settings={settings}
        onClose={onClose}
        onError={onError}
        onActivity={onActivity}
      />
    </div>
  )
}
