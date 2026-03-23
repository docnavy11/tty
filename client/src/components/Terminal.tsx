import { useEffect, useRef } from 'react'
import type { ITheme } from '@xterm/xterm'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { THEMES } from '../themes'
import type { AppSettings } from '../hooks/useSettings'

// Convert xterm.js color mode+value to a CSS color string.
// Modes: 0=default, 1=16-color palette, 2=256-color palette, 3=RGB true color
function cellColor(mode: number, color: number, palette: (string | undefined)[]): string | undefined {
  if (mode === 1) return palette[color]
  if (mode === 2) {
    if (color < 16) return palette[color]
    if (color < 232) {
      const n = color - 16
      const r = Math.floor(n / 36), g = Math.floor((n % 36) / 6), b = n % 6
      const c = (x: number) => x ? x * 40 + 55 : 0
      return `rgb(${c(r)},${c(g)},${c(b)})`
    }
    const v = (color - 232) * 10 + 8
    return `rgb(${v},${v},${v})`
  }
  if (mode === 3) return `rgb(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff})`
}

function buildColoredHTML(term: Terminal, theme: ITheme): string {
  const palette = [
    theme.black, theme.red, theme.green, theme.yellow,
    theme.blue, theme.magenta, theme.cyan, theme.white,
    theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow,
    theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite,
  ]
  const buf = term.buffer.active
  const htmlLines: string[] = []

  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) { htmlLines.push(''); continue }

    let html = '', lastStyle = '', spanOpen = false
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x)
      if (!cell || cell.getWidth() === 0) continue

      let fg = cellColor(cell.getFgColorMode(), cell.getFgColor(), palette)
      let bg = cellColor(cell.getBgColorMode(), cell.getBgColor(), palette)
      if (cell.isInverse()) [fg, bg] = [bg ?? theme.foreground, fg ?? theme.background]

      const parts: string[] = []
      if (fg) parts.push(`color:${fg}`)
      if (bg) parts.push(`background:${bg}`)
      if (cell.isBold()) parts.push('font-weight:bold')
      if (cell.isItalic()) parts.push('font-style:italic')
      if (cell.isUnderline()) parts.push('text-decoration:underline')
      if (cell.isDim()) parts.push('opacity:0.5')
      const style = parts.join(';')

      const ch = (cell.getChars() || ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      if (style !== lastStyle) {
        if (spanOpen) html += '</span>'
        html += style ? `<span style="${style}">` : ''
        spanOpen = !!style
        lastStyle = style
      }
      html += ch
    }
    if (spanOpen) html += '</span>'
    htmlLines.push(html)
  }

  while (htmlLines.length && !htmlLines[htmlLines.length - 1].replace(/<[^>]*>/g, '').trim()) htmlLines.pop()
  return htmlLines.join('\n')
}

// Highlight search matches inside a DOM element using TreeWalker (works across spans).
function applySearchHighlights(root: Element, query: string, activeIdx: number): number {
  // Remove previous marks by restoring text nodes
  root.querySelectorAll('mark[data-search]').forEach(m => m.replaceWith(...Array.from(m.childNodes)))
  root.normalize()
  if (!query) return 0

  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) textNodes.push(n as Text)

  let total = 0
  for (const textNode of textNodes) {
    const t = textNode.textContent ?? ''
    re.lastIndex = 0
    const nodeMatches = [...t.matchAll(re)]
    if (!nodeMatches.length) continue

    const frag = document.createDocumentFragment()
    let last = 0
    for (const m of nodeMatches) {
      frag.appendChild(document.createTextNode(t.slice(last, m.index)))
      const mark = document.createElement('mark')
      mark.dataset.search = ''
      const isCurrent = total++ === activeIdx
      mark.style.cssText = `background:${isCurrent ? '#f80' : '#ff6'};color:#000;border-radius:2px`
      mark.textContent = m[0]
      frag.appendChild(mark)
      last = (m.index ?? 0) + m[0].length
    }
    frag.appendChild(document.createTextNode(t.slice(last)))
    textNode.replaceWith(frag)
  }
  root.querySelectorAll('mark[data-search]')[activeIdx]?.scrollIntoView({ block: 'nearest' })
  return total
}

interface Props {
  sessionId: string
  visible?: boolean
  showHeader?: boolean
  settings?: AppSettings
  onClose: () => void
  onError: (msg: string) => void
  onActivity?: (status: 'busy' | 'done' | 'idle') => void
}

export function TerminalView({ sessionId, visible = true, showHeader = true, settings, onClose, onError, onActivity }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const visibleRef = useRef(visible)
  useEffect(() => { visibleRef.current = visible }, [visible])

  // Re-fit and focus when becoming visible (tab switch or initial open)
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit()
        termRef.current?.focus()
      }, 0)
    }
  }, [visible])

  // Apply settings changes without tearing down the session
  useEffect(() => {
    const term = termRef.current
    if (!term || !settings) return
    term.options.fontSize = settings.fontSize
    term.options.fontFamily = settings.fontFamily
    term.options.theme = THEMES[settings.theme] ?? THEMES.dracula
    fitAddonRef.current?.fit()
  }, [settings])

  useEffect(() => {
    const theme = settings ? (THEMES[settings.theme] ?? THEMES.dracula) : THEMES.dracula
    const term = new Terminal({
      cursorBlink: true,
      fontSize: settings?.fontSize ?? 14,
      fontFamily: settings?.fontFamily ?? "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme,
      scrollback: 5000,
    })

    termRef.current = term

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current!)
    if (visible) term.focus()
    fitAddon.fit()

    // --- connection state ---
    let destroyed = false
    let wsRef: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let activityTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectDelay = 1000

    function clearTimers() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    }

    function signalActivity() {
      onActivity?.('busy')
      if (activityTimer) clearTimeout(activityTimer)
      activityTimer = setTimeout(() => onActivity?.(visibleRef.current ? 'idle' : 'done'), 2000)
    }

    // Copy on select (replaces the removed copyOnSelect option in xterm v6)
    const onSelectionDispose = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) navigator.clipboard?.writeText(sel).catch(() => {})
    })

    // Register onData once — always writes to the current wsRef
    const onDataDispose = term.onData((data) => {
      if (wsRef?.readyState === WebSocket.OPEN) {
        wsRef.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Ctrl+Shift+C/V → copy/paste
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.key === 'c' || e.key === 'C') {
        copySelection()
        return false
      }
      if (e.key === 'v' || e.key === 'V') {
        pasteFromClipboard()
        return false
      }
      return true
    })

    function copySelection() {
      const sel = term.getSelection()
      if (!sel) return
      navigator.clipboard?.writeText(sel).catch(() => {
        const ta = document.createElement('textarea')
        ta.value = sel
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      })
    }

    function pasteFromClipboard() {
      navigator.clipboard?.readText().then((text) => {
        if (text && wsRef?.readyState === WebSocket.OPEN)
          wsRef.send(JSON.stringify({ type: 'input', data: text }))
      }).catch(() => {})
    }

    function openCopyModal() {
      const theme = settings ? (THEMES[settings.theme] ?? THEMES.dracula) : THEMES.dracula
      const coloredHTML = buildColoredHTML(term, theme)

      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center'

      const box = document.createElement('div')
      box.style.cssText = 'background:#1e1e1e;border:1px solid #444;border-radius:8px;padding:16px;width:80vw;max-width:800px;display:flex;flex-direction:column;gap:10px'

      // Search row
      const searchRow = document.createElement('div')
      searchRow.style.cssText = 'display:flex;gap:8px;align-items:center'
      const searchInput = document.createElement('input')
      searchInput.placeholder = 'Search…'
      searchInput.style.cssText = 'flex:1;background:#111;color:#ccc;border:1px solid #333;border-radius:4px;padding:6px 10px;font-size:13px;font-family:monospace;outline:none'
      const matchCount = document.createElement('span')
      matchCount.style.cssText = 'color:#666;font-size:12px;font-family:sans-serif;white-space:nowrap;min-width:80px;text-align:right'
      const btnStyle = 'padding:4px 10px;background:#333;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:13px'
      const prevBtn = document.createElement('button')
      prevBtn.textContent = '↑'
      prevBtn.style.cssText = btnStyle
      prevBtn.onclick = () => navigate(-1)
      const nextBtn = document.createElement('button')
      nextBtn.textContent = '↓'
      nextBtn.style.cssText = btnStyle
      nextBtn.onclick = () => navigate(1)
      searchRow.append(searchInput, prevBtn, nextBtn, matchCount)

      const label = document.createElement('div')
      label.textContent = 'Select text to copy, then press Ctrl+C'
      label.style.cssText = 'color:#888;font-size:12px;font-family:sans-serif'

      const content = document.createElement('div')
      const font = settings?.fontFamily ?? "'JetBrains Mono', 'Fira Code', monospace"
      const fontSize = settings?.fontSize ?? 14
      content.style.cssText = `width:100%;height:50vh;background:${theme.background};color:${theme.foreground};border:1px solid #333;border-radius:4px;padding:8px;font-family:${font};font-size:${fontSize}px;overflow:auto;white-space:pre;user-select:text;box-sizing:border-box`
      content.innerHTML = coloredHTML

      let currentMatch = 0

      function updateSearch(q: string) {
        content.innerHTML = coloredHTML
        const total = applySearchHighlights(content, q, currentMatch)
        if (!q) { matchCount.textContent = ''; return }
        if (!total) { matchCount.textContent = 'no matches'; return }
        if (currentMatch >= total) currentMatch = 0
        matchCount.textContent = `${currentMatch + 1}/${total}`
      }

      function navigate(dir: 1 | -1) {
        const total = content.querySelectorAll('mark[data-search]').length
        if (!total) return
        currentMatch = (currentMatch + dir + total) % total
        updateSearch(searchInput.value)
      }

      searchInput.addEventListener('input', () => { currentMatch = 0; updateSearch(searchInput.value) })
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); navigate(e.shiftKey ? -1 : 1) }
      })

      const close = document.createElement('button')
      close.textContent = 'Close'
      close.style.cssText = 'align-self:flex-end;padding:6px 16px;background:#333;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:13px'

      box.append(searchRow, label, content, close)
      overlay.appendChild(box)

      const closeModal = () => { overlay.remove(); document.removeEventListener('keydown', onKey) }
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal() }
      document.addEventListener('keydown', onKey)
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal() })
      close.onclick = closeModal

      document.body.appendChild(overlay)
      searchInput.focus()
    }

    // Right-click context menu
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      const sel = term.getSelection()
      const menu = document.createElement('div')
      menu.style.cssText = 'position:fixed;background:#1e1e1e;border:1px solid #444;border-radius:6px;padding:4px 0;z-index:9999;min-width:130px;box-shadow:0 4px 12px rgba(0,0,0,0.6);font-family:sans-serif;font-size:13px'
      menu.style.left = `${e.clientX}px`
      menu.style.top = `${e.clientY}px`

      const addItem = (label: string, shortcut: string, disabled: boolean, onClick: () => void) => {
        const item = document.createElement('div')
        item.style.cssText = `display:flex;justify-content:space-between;gap:16px;padding:6px 14px;cursor:${disabled ? 'default' : 'pointer'};color:${disabled ? '#555' : '#ccc'}`
        item.innerHTML = `<span>${label}</span><span style="color:#666;font-size:11px">${shortcut}</span>`
        if (!disabled) {
          item.onmouseenter = () => { item.style.background = '#2a2a2a' }
          item.onmouseleave = () => { item.style.background = '' }
          item.onmousedown = (ev) => { ev.preventDefault(); onClick(); menu.remove() }
        }
        menu.appendChild(item)
      }

      addItem('Copy', '⌃⇧C', !sel, copySelection)
      addItem('Copy screen…', '', false, () => openCopyModal())
      addItem('Paste', '⌃⇧V', false, pasteFromClipboard)

      document.body.appendChild(menu)
      const dismiss = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('mousedown', dismiss) } }
      setTimeout(() => document.addEventListener('mousedown', dismiss), 0)
    }
    function connect() {
      if (destroyed) return
      clearTimers()

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal?sessionId=${sessionId}`)
      ws.binaryType = 'arraybuffer'
      wsRef = ws

      ws.onopen = () => {
        reconnectDelay = 1000
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        // Keepalive ping every 30s to prevent proxy idle-timeout drops
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
        }, 30_000)
      }

      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(e.data))
          signalActivity()
        } else {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'error') onError(msg.message)
          } catch {
            term.write(e.data)
            signalActivity()
          }
        }
      }

      ws.onclose = (e) => {
        clearTimers()
        if (e.code === 4001) {
          // Session ended naturally
          term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
          setTimeout(() => onClose(), 1000)
        } else if (e.code === 1000 || destroyed) {
          // Intentional close (component unmounting or stolen connection)
        } else if (e.code === 1008) {
          // Session not found — stale ID, navigate back rather than loop forever
          term.write('\r\n\x1b[31m[session not found]\x1b[0m\r\n')
          setTimeout(() => onClose(), 1000)
        } else {
          // Network error — reconnect with exponential backoff (max 30s)
          term.write(`\r\n\x1b[33m[disconnected — reconnecting in ${reconnectDelay / 1000}s]\x1b[0m\r\n`)
          reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
            connect()
          }, reconnectDelay)
        }
      }
    }

    connect()

    const observer = new ResizeObserver(() => {
      const buf = term.buffer.active
      const atBottom = buf.viewportY >= buf.baseY
      const savedY = buf.viewportY
      fitAddon.fit()
      // fitAddon.fit() → terminal.resize() resets viewport to cursor — restore if user was scrolled up
      if (!atBottom) term.scrollToLine(savedY)
      if (wsRef?.readyState === WebSocket.OPEN) {
        wsRef.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })
    observer.observe(containerRef.current!)

    // Touch scrolling — capture phase fires before xterm's own handlers
    const el = containerRef.current!
    const lh = () => (term.options.fontSize ?? 14) * (term.options.lineHeight ?? 1.2)
    // Keep a 100ms history of touch points to measure true gesture velocity
    type Point = { y: number; t: number }
    let history: Point[] = []
    let remainder = 0
    let raf: number | null = null
    const stopMomentum = () => { if (raf !== null) { cancelAnimationFrame(raf); raf = null } }

    const getVelocity = (): number => {
      const now = Date.now()
      const recent = history.filter(p => now - p.t < 100)
      if (recent.length < 2) return 0
      const dt = recent[recent.length - 1].t - recent[0].t
      if (dt < 1) return 0
      return (recent[0].y - recent[recent.length - 1].y) / dt // px/ms, positive = swiping up
    }

    const onTouchStart = (e: TouchEvent) => {
      stopMomentum()
      history = [{ y: e.touches[0].clientY, t: Date.now() }]
      remainder = 0
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const y = e.touches[0].clientY
      const t = Date.now()
      const prev = history[history.length - 1]
      if (prev) {
        remainder += prev.y - y
        const lineCount = Math.trunc(remainder / lh())
        if (lineCount !== 0) { remainder -= lineCount * lh(); term.scrollLines(lineCount) }
      }
      history.push({ y, t })
      if (history.length > 30) history.shift()
    }
    const onTouchEnd = () => {
      const v = getVelocity() // px/ms, positive = swiping up (toward older content)
      if (Math.abs(v) < 0.1) return
      // Fast fling → jump to top/bottom instantly
      // v < 0 = swiping down = wants older content (top of scrollback)
      // v > 0 = swiping up   = wants newer content (bottom)
      if (v < -1.5) { term.scrollToTop(); return }
      if (v > 1.5)  { term.scrollToBottom(); return }
      // Slow fling → momentum
      let mv = v * 10
      let rem = 0
      const step = () => {
        mv *= 0.95
        if (Math.abs(mv) < 0.05) return
        rem += mv * 16
        const lines = Math.trunc(rem / lh())
        if (lines !== 0) { rem -= lines * lh(); term.scrollLines(lines) }
        raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })

    return () => {
      destroyed = true
      clearTimers()
      if (activityTimer) clearTimeout(activityTimer)
      onSelectionDispose.dispose()
      onDataDispose.dispose()
      fitAddonRef.current = null
      termRef.current = null
      observer.disconnect()
      stopMomentum()
      el.removeEventListener('touchstart', onTouchStart, { capture: true })
      el.removeEventListener('touchmove', onTouchMove, { capture: true })
      el.removeEventListener('touchend', onTouchEnd, { capture: true })
      el.removeEventListener('contextmenu', onContextMenu)
      wsRef?.close()
      term.dispose()
      // Clear container so no ghost canvas elements linger if xterm.dispose() misses any
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [sessionId])

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
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}
