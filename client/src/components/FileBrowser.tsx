import { useState, useEffect, useRef, useCallback } from 'react'

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

// Detect binary content (contains null bytes or high ratio of non-printable chars)
function isBinary(content: string): boolean {
  if (content.includes('\0')) return true
  let nonPrintable = 0
  const sample = content.slice(0, 1024)
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i)
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) nonPrintable++
  }
  return nonPrintable / sample.length > 0.1
}

// Get language hint from file extension for basic syntax context
function extLabel(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'JavaScript', ts: 'TypeScript', tsx: 'TSX', jsx: 'JSX',
    py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
    json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    md: 'Markdown', html: 'HTML', css: 'CSS', sql: 'SQL',
    sh: 'Shell', bash: 'Shell', zsh: 'Shell',
    xml: 'XML', svg: 'SVG', txt: 'Text',
    c: 'C', cpp: 'C++', h: 'C Header',
    dockerfile: 'Dockerfile', makefile: 'Makefile',
  }
  return map[ext] ?? ext.toUpperCase()
}

function FileEditor({ filePath, onClose }: { filePath: string; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [lineCount, setLineCount] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const dirty = content !== originalContent

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error: string }) => { throw new Error(e.error) }))
      .then(({ content: c }: { content: string }) => {
        if (isBinary(c)) {
          setBinary(true)
          setContent('')
          setOriginalContent('')
        } else {
          setContent(c)
          setOriginalContent(c)
          setLineCount(c.split('\n').length)
        }
      })
      .catch(e => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }, [filePath])

  // Focus textarea on load
  useEffect(() => {
    if (!loading && !binary && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [loading, binary])

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (dirty) save()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, content])

  // Escape to close (if not dirty)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dirty) {
          if (confirm('Unsaved changes. Close anyway?')) onClose()
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, onClose])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error)
      }
      setOriginalContent(content)
    } catch (e: unknown) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }

  const handleTab = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const val = ta.value
      const newVal = val.substring(0, start) + '  ' + val.substring(end)
      setContent(newVal)
      // Restore cursor after React re-render
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }, [])

  const fileName = filePath.split('/').pop() ?? filePath
  const dirPath = filePath.slice(0, filePath.lastIndexOf('/') + 1)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { dirty ? (confirm('Unsaved changes. Close anyway?') && onClose()) : onClose() } }}
    >
      <div style={{
        background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
        display: 'flex', flexDirection: 'column',
        width: '85vw', maxWidth: 1000, height: '80vh',
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
      }}>
        {/* Title bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderBottom: '1px solid #2a2a2a', flexShrink: 0,
        }}>
          <span style={{ color: '#555', fontSize: 12 }}>{dirPath}</span>
          <span style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>{fileName}</span>
          {dirty && <span style={{ color: '#f1fa8c', fontSize: 11 }}>modified</span>}
          <span style={{ color: '#555', fontSize: 11 }}>{extLabel(filePath)}</span>
          <div style={{ flex: 1 }} />
          {error && <span style={{ color: '#ff5555', fontSize: 11 }}>{error}</span>}
          <span style={{ color: '#444', fontSize: 11 }}>{lineCount} lines</span>
          <button onClick={save} disabled={saving || !dirty} style={dirty ? btnGreen : btn}>
            {saving ? 'Saving\u2026' : 'Save'}
          </button>
          <span style={{ color: '#555', fontSize: 10 }}>\u2318S</span>
          <button
            onClick={() => { dirty ? (confirm('Unsaved changes. Close anyway?') && onClose()) : onClose() }}
            style={{ ...btn, border: 'none', fontSize: 16, padding: '0 4px', color: '#888' }}
          >\u2715</button>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
            Loading\u2026
          </div>
        ) : binary ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 32 }}>Binary file</span>
            <span style={{ fontSize: 13 }}>This file cannot be displayed as text</span>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Line numbers */}
            <div style={{
              padding: '10px 0', background: '#141414', borderRight: '1px solid #222',
              overflowY: 'hidden', flexShrink: 0, userSelect: 'none', pointerEvents: 'none',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 12, lineHeight: 1.5,
              color: '#333', textAlign: 'right', minWidth: 40,
            }}>
              {content.split('\n').map((_, i) => (
                <div key={i} style={{ padding: '0 8px' }}>{i + 1}</div>
              ))}
            </div>
            {/* Editor */}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => { setContent(e.target.value); setLineCount(e.target.value.split('\n').length) }}
              onKeyDown={handleTab}
              spellCheck={false}
              style={{
                flex: 1, background: '#0d0d0d', color: '#e0e0e0',
                border: 'none', outline: 'none', resize: 'none',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 12, padding: '10px', lineHeight: 1.5,
                overflowY: 'auto', tabSize: 2, whiteSpace: 'pre',
                overflowWrap: 'normal', overflowX: 'auto',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export function FileBrowser({ sessionId, onClose }: Props) {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [editingPath, setEditingPath] = useState<string | null>(null)
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

  const openDir = (p: string) => load(p)

  const goUp = () => {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    load('/' + parts.join('/') || '/')
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
    <>
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
              {uploading ? '\u2026' : 'Upload'}
            </button>
            <input
              ref={uploadRef}
              type="file"
              style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <button onClick={onClose} style={{ ...btn, border: 'none', fontSize: 16, padding: '0 4px' }}>\u2715</button>
          </div>
        </div>

        {/* Directory listing */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Path breadcrumb */}
          <div style={{
            padding: '7px 10px', borderBottom: '1px solid #222',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          }}>
            {path !== '/' && (
              <span onClick={goUp} title="Go up" style={{ cursor: 'pointer', color: '#50fa7b', flexShrink: 0, fontSize: 14, lineHeight: 1 }}>\u2191</span>
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
              onClick={() => e.isDir ? openDir(e.path) : setEditingPath(e.path)}
              onMouseEnter={ev => (ev.currentTarget as HTMLDivElement).style.background = '#1e1e1e'}
              onMouseLeave={ev => (ev.currentTarget as HTMLDivElement).style.background = 'transparent'}
            >
              <span style={{ flexShrink: 0, color: '#555', fontSize: 12 }}>{e.isDir ? '\u25b8' : ' '}</span>
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
                  >\u2193</a>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* File editor dialog */}
      {editingPath && (
        <FileEditor filePath={editingPath} onClose={() => { setEditingPath(null); load(path) }} />
      )}
    </>
  )
}
