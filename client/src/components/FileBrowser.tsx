import { useState, useEffect, useRef } from 'react'

interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  mtime: number
}

interface Props {
  sessionId?: string | null
  onClose: () => void
}

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '5px 10px', cursor: 'pointer', borderRadius: 3,
  fontSize: 13,
}

const btn: React.CSSProperties = {
  background: 'none', border: '1px solid #333', borderRadius: 3,
  color: '#aaa', fontFamily: 'inherit', fontSize: 11,
  padding: '2px 8px', cursor: 'pointer',
}

const btnGreen: React.CSSProperties = {
  ...btn, border: '1px solid #2a4a2a', color: '#50fa7b', background: '#1a2a1a',
}

export function FileBrowser({ sessionId, onClose }: Props) {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editDirty, setEditDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  const load = (p: string) => {
    setError(null)
    fetch(`/api/files?path=${encodeURIComponent(p)}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error: string }) => { throw new Error(e.error) }))
      .then((data: { path: string; entries: FileEntry[] }) => {
        setPath(data.path)
        setEntries(data.entries)
      })
      .catch(e => setError(String(e.message ?? e)))
  }

  useEffect(() => {
    if (sessionId) {
      fetch(`/api/sessions/${sessionId}/cwd`)
        .then(r => r.json())
        .then(({ cwd }: { cwd: string }) => load(cwd))
        .catch(() => load(''))
    } else {
      load('')
    }
  }, [sessionId])

  const openDir = (p: string) => {
    setEditingPath(null)
    load(p)
  }

  const goUp = () => {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    load('/' + parts.join('/') || '/')
  }

  const openFile = async (p: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(p)}`)
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error)
      }
      const { content } = await res.json()
      setEditingPath(p)
      setEditContent(content)
      setEditDirty(false)
    } catch (e: unknown) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const saveFile = async () => {
    if (!editingPath) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editingPath, content: editContent }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error)
      }
      setEditDirty(false)
    } catch (e: unknown) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(`/api/files/upload?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error)
      }
      load(path)
    } catch (e: unknown) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setUploading(false)
    }
  }

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
    return `${(bytes / 1024 / 1024).toFixed(1)}M`
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: 300, borderLeft: '1px solid #2a2a2a',
      background: '#161616', flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 10px', height: 46, borderBottom: '1px solid #2a2a2a', flexShrink: 0,
      }}>
        <span style={{ color: '#ccc', fontSize: 13, fontWeight: 600 }}>Files</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => uploadRef.current?.click()} disabled={uploading} style={btn}>
            {uploading ? '…' : 'Upload'}
          </button>
          <input
            ref={uploadRef}
            type="file"
            style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <button onClick={onClose} style={{ ...btn, border: 'none', fontSize: 16, padding: '0 4px' }}>✕</button>
        </div>
      </div>

      {editingPath ? (
        /* Editor */
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
            borderBottom: '1px solid #222', flexShrink: 0,
          }}>
            <button onClick={() => setEditingPath(null)} style={btn}>← Back</button>
            <span style={{ flex: 1, color: '#666', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {editingPath.split('/').pop()}
            </span>
            <button onClick={saveFile} disabled={saving || !editDirty} style={editDirty ? btnGreen : btn}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {error && (
            <div style={{ color: '#ff5555', fontSize: 11, padding: '6px 10px', background: '#1a0000', flexShrink: 0 }}>{error}</div>
          )}
          <textarea
            value={editContent}
            onChange={e => { setEditContent(e.target.value); setEditDirty(true) }}
            spellCheck={false}
            style={{
              flex: 1, background: '#0d0d0d', color: '#e0e0e0',
              border: 'none', outline: 'none', resize: 'none',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 12, padding: '10px', lineHeight: 1.5,
              overflowY: 'auto',
            }}
          />
        </div>
      ) : (
        /* Directory listing */
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Path breadcrumb */}
          <div style={{
            padding: '7px 10px', borderBottom: '1px solid #222',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          }}>
            {path !== '/' && (
              <span onClick={goUp} title="Go up" style={{ cursor: 'pointer', color: '#50fa7b', flexShrink: 0, fontSize: 14, lineHeight: 1 }}>↑</span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}>
              <span style={{ color: '#555' }}>{path.slice(0, path.lastIndexOf('/') + 1)}</span>
              <span style={{ color: '#ddd', fontWeight: 500 }}>{path.split('/').filter(Boolean).pop() ?? '/'}</span>
            </span>
          </div>

          {error && (
            <div style={{ color: '#ff5555', fontSize: 11, padding: '6px 10px', background: '#1a0000' }}>{error}</div>
          )}

          {entries.map(e => (
            <div
              key={e.path}
              style={{ ...row, color: e.isDir ? '#8be9fd' : '#ccc' }}
              onClick={() => e.isDir ? openDir(e.path) : openFile(e.path)}
              onMouseEnter={ev => (ev.currentTarget as HTMLDivElement).style.background = '#1e1e1e'}
              onMouseLeave={ev => (ev.currentTarget as HTMLDivElement).style.background = 'transparent'}
            >
              <span style={{ flexShrink: 0, color: '#555', fontSize: 12 }}>{e.isDir ? '▸' : ' '}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}{e.isDir ? '/' : ''}
              </span>
              {!e.isDir && (
                <>
                  <span style={{ color: '#444', fontSize: 11, flexShrink: 0 }}>{fmtSize(e.size)}</span>
                  <a
                    href={`/api/files/download?path=${encodeURIComponent(e.path)}`}
                    download={e.name}
                    onClick={ev => ev.stopPropagation()}
                    style={{ color: '#555', fontSize: 11, textDecoration: 'none', flexShrink: 0 }}
                  >↓</a>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
