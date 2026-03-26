import { useRef, useState, useCallback } from 'react'
import { TerminalCore } from './TerminalCore'
import type { TerminalCoreHandle } from './TerminalCore'
import type { AppSettings } from '../hooks/useSettings'

interface Props {
  sessionId: string
  visible?: boolean
  showHeader?: boolean
  settings?: AppSettings
  onClose: () => void
  onError: (msg: string) => void
  onActivity?: (status: 'busy' | 'done' | 'idle') => void
}

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

const btnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#999', cursor: 'pointer',
  fontSize: 13, padding: '8px 14px', flexShrink: 0, userSelect: 'none',
}

export function TerminalView({ sessionId, visible = true, showHeader = true, settings, onClose, onError, onActivity }: Props) {
  const coreRef = useRef<TerminalCoreHandle>(null)
  const [ctrlActive, setCtrlActive] = useState(false)
  const ctrlActiveRef = useRef(false)

  const onBeforeInput = useCallback((data: string): string => {
    if (ctrlActiveRef.current && data.length === 1) {
      const code = data.toUpperCase().charCodeAt(0) - 64
      if (code >= 1 && code <= 26) {
        ctrlActiveRef.current = false
        setCtrlActive(false)
        return String.fromCharCode(code)
      }
    }
    return data
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', visibility: visible ? 'visible' : 'hidden', position: visible ? 'relative' : 'absolute', width: '100%' }}>
      {showHeader && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px', background: '#111', borderBottom: '1px solid #333', flexShrink: 0,
        }}>
          <span style={{ color: '#888', fontSize: 12 }}>{sessionId.slice(0, 8)}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, padding: '2px 8px' }}>✕</button>
        </div>
      )}
      {isTouchDevice && (
        <div style={{
          display: 'flex', flexShrink: 0, background: '#111', borderTop: '1px solid #2a2a2a',
          overflowX: 'auto', overflowY: 'hidden',
        }}>
          {[
            { label: 'Esc',  seq: '\x1b' },
            { label: 'Tab',  seq: '\t' },
            { label: '\u2191',    seq: '\x1b[A' },
            { label: '\u2193',    seq: '\x1b[B' },
            { label: '\u2190',    seq: '\x1b[D' },
            { label: '\u2192',    seq: '\x1b[C' },
          ].map(({ label, seq }) => (
            <button
              key={label}
              onPointerDown={(e) => { e.preventDefault(); coreRef.current?.send(seq) }}
              style={btnStyle}
            >{label}</button>
          ))}
          <button
            onPointerDown={(e) => {
              e.preventDefault()
              const next = !ctrlActiveRef.current
              ctrlActiveRef.current = next
              setCtrlActive(next)
            }}
            style={{ ...btnStyle, color: ctrlActive ? '#50fa7b' : '#999', fontWeight: ctrlActive ? 700 : 400 }}
          >Ctrl</button>
        </div>
      )}
      <TerminalCore
        ref={coreRef}
        sessionId={sessionId}
        visible={visible}
        settings={settings}
        onClose={onClose}
        onError={onError}
        onActivity={onActivity}
        onBeforeInput={isTouchDevice ? onBeforeInput : undefined}
      />
    </div>
  )
}
