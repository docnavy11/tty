import { useState, useEffect } from 'react'
import type { AppSettings } from '../hooks/useSettings'
import { THEME_LABELS, type ThemeName } from '../themes'

interface Props {
  open: boolean
  current: AppSettings
  onClose: () => void
  onSave: () => void
}

const field: React.CSSProperties = {
  background: '#0d0d0d', border: '1px solid #333', borderRadius: 4,
  color: '#e0e0e0', fontFamily: 'inherit', fontSize: 13,
  padding: '6px 10px', outline: 'none', width: '100%', boxSizing: 'border-box',
}

export function SettingsPanel({ open, current, onClose, onSave }: Props) {
  const [fontSize, setFontSize] = useState(String(current.fontSize))
  const [fontFamily, setFontFamily] = useState(current.fontFamily)
  const [theme, setTheme] = useState<ThemeName>(current.theme)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFontSize(String(current.fontSize))
    setFontFamily(current.fontFamily)
    setTheme(current.theme)
  }, [current, open])

  const save = async () => {
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontSize, fontFamily, theme }),
    })
    setSaving(false)
    onSave()
    onClose()
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, zIndex: 100,
        background: '#161616', borderLeft: '1px solid #2a2a2a',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
          <span style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 600 }}>Settings</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Font size</span>
            <input
              type="number" min={8} max={32} value={fontSize}
              onChange={e => setFontSize(e.target.value)}
              style={field}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Font family</span>
            <input
              type="text" value={fontFamily}
              onChange={e => setFontFamily(e.target.value)}
              style={field}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Theme</span>
            <select value={theme} onChange={e => setTheme(e.target.value as ThemeName)} style={{ ...field, cursor: 'pointer' }}>
              {(Object.entries(THEME_LABELS) as [ThemeName, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 18px', borderTop: '1px solid #2a2a2a', flexShrink: 0 }}>
          <button
            onClick={save} disabled={saving}
            style={{ width: '100%', background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 4, color: '#50fa7b', fontFamily: 'inherit', fontSize: 13, padding: '8px', cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}
