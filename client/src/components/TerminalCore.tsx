import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
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

export function buildColoredHTML(term: Terminal, theme: ITheme): string {
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
export function applySearchHighlights(root: Element, query: string, activeIdx: number): number {
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

export interface TerminalCoreHandle {
  focus: () => void
  getTerminal: () => Terminal | null
  send: (data: string) => void
}

export interface TerminalCoreProps {
  sessionId: string
  visible?: boolean
  settings?: AppSettings
  onClose: () => void
  onError: (msg: string) => void
  onActivity?: (status: 'busy' | 'done' | 'idle') => void
  /** Optional transform applied to terminal input before sending over WebSocket */
  onBeforeInput?: (data: string) => string
}

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

export const TerminalCore = forwardRef<TerminalCoreHandle, TerminalCoreProps>(
  function TerminalCore({ sessionId, visible = true, settings, onClose, onError, onActivity, onBeforeInput }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const termRef = useRef<Terminal | null>(null)
    const visibleRef = useRef(visible)
    const sendRef = useRef<(data: string) => void>(() => {})
    const onBeforeInputRef = useRef(onBeforeInput)

    useEffect(() => { visibleRef.current = visible }, [visible])
    useEffect(() => { onBeforeInputRef.current = onBeforeInput }, [onBeforeInput])

    useImperativeHandle(ref, () => ({
      focus: () => termRef.current?.focus(),
      getTerminal: () => termRef.current,
      send: (data: string) => sendRef.current(data),
    }))

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

      // Block mouse tracking escape sequences at the parser level.
      // tmux enables mouse tracking (e.g. \e[?1000h) which makes xterm
      // forward all mouse events to the PTY. By intercepting the DEC
      // private mode set/reset sequences, we keep mouse handling local.
      const mouseTrackingModes = new Set([1000, 1002, 1003, 1004, 1006, 1015, 1016])
      const blockMouseTracking = (params: { length: number; forEach: (cb: (v: number | number[]) => void) => void }) => {
        let dominated = false
        params.forEach((p) => {
          const v = Array.isArray(p) ? p[0] : p
          if (mouseTrackingModes.has(v)) dominated = true
        })
        return dominated  // true = handled (swallowed), false = let xterm process
      }
      const disposeH = term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, blockMouseTracking)
      const disposeL = term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, blockMouseTracking)

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

      // Toolbar send bridge — captures wsRef by variable (stays current across reconnects)
      sendRef.current = (data: string) => {
        if (wsRef?.readyState === WebSocket.OPEN)
          wsRef.send(JSON.stringify({ type: 'input', data }))
      }

      // Register onData once — always writes to the current wsRef.
      // When an onBeforeInput transform is provided, apply it before sending.
      const onDataDispose = term.onData((data) => {
        const toSend = onBeforeInputRef.current ? onBeforeInputRef.current(data) : data
        if (wsRef?.readyState === WebSocket.OPEN)
          wsRef.send(JSON.stringify({ type: 'input', data: toSend }))
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
        searchInput.placeholder = 'Search\u2026'
        searchInput.style.cssText = 'flex:1;background:#111;color:#ccc;border:1px solid #333;border-radius:4px;padding:6px 10px;font-size:13px;font-family:monospace;outline:none'
        const matchCount = document.createElement('span')
        matchCount.style.cssText = 'color:#666;font-size:12px;font-family:sans-serif;white-space:nowrap;min-width:80px;text-align:right'
        const bStyle = 'padding:4px 10px;background:#333;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:13px'
        const prevBtn = document.createElement('button')
        prevBtn.textContent = '\u2191'
        prevBtn.style.cssText = bStyle
        prevBtn.onclick = () => navigate(-1)
        const nextBtn = document.createElement('button')
        nextBtn.textContent = '\u2193'
        nextBtn.style.cssText = bStyle
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

        const addItem = (itemLabel: string, shortcut: string, disabled: boolean, onClick: () => void) => {
          const item = document.createElement('div')
          item.style.cssText = `display:flex;justify-content:space-between;gap:16px;padding:6px 14px;cursor:${disabled ? 'default' : 'pointer'};color:${disabled ? '#555' : '#ccc'}`
          item.innerHTML = `<span>${itemLabel}</span><span style="color:#666;font-size:11px">${shortcut}</span>`
          if (!disabled) {
            item.onmouseenter = () => { item.style.background = '#2a2a2a' }
            item.onmouseleave = () => { item.style.background = '' }
            item.onmousedown = (ev) => { ev.preventDefault(); onClick(); menu.remove() }
          }
          menu.appendChild(item)
        }

        addItem('Copy', '\u2303\u21e7C', !sel, copySelection)
        addItem('Copy screen\u2026', '', false, () => openCopyModal())
        addItem('Paste', '\u2303\u21e7V', false, pasteFromClipboard)

        document.body.appendChild(menu)
        const dismiss = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('mousedown', dismiss) } }
        setTimeout(() => document.addEventListener('mousedown', dismiss), 0)
      }

      let hasConnected = false

      function connect() {
        if (destroyed) return
        clearTimers()

        const protocol = window.location.protocol === 'https:' ? 'wss:'  : 'ws:'
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal?sessionId=${sessionId}`)
        ws.binaryType = 'arraybuffer'
        wsRef = ws

        ws.onopen = () => {
          reconnectDelay = 1000
          // Tell server to skip history replay if xterm already has content
          // (reconnecting after a WS drop — the terminal buffer is intact)
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows, noHistory: hasConnected }))
          hasConnected = true
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

      // Track last sent dimensions to avoid redundant resize messages to server
      let lastCols = term.cols
      let lastRows = term.rows
      let resizeTimer: ReturnType<typeof setTimeout> | null = null

      const observer = new ResizeObserver(() => {
        // Debounce: in a grid, one cell resizing can reflow the grid and trigger
        // all other cells' observers, causing a cascade. Batch into one frame.
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          const buf = term.buffer.active
          const atBottom = buf.viewportY >= buf.baseY
          const savedY = buf.viewportY
          fitAddon.fit()
          // fitAddon.fit() → terminal.resize() resets viewport to cursor — restore if user was scrolled up
          if (!atBottom) term.scrollToLine(savedY)
          // Only notify server if dimensions actually changed — prevents tmux redraw loops
          if (wsRef?.readyState === WebSocket.OPEN && (term.cols !== lastCols || term.rows !== lastRows)) {
            lastCols = term.cols
            lastRows = term.rows
            wsRef.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
          }
        }, 50)
      })
      observer.observe(containerRef.current!)

      const el = containerRef.current!

      // (Mouse tracking is blocked at the parser level above — no data stream modification needed)

      // Mouse wheel scrolling — intercept before xterm forwards to tmux.
      // Without this, wheel events go through the PTY to tmux, which enters
      // copy mode and redraws the entire screen from its scrollback (server roundtrip).
      // Instead, scroll xterm's local buffer directly — instant, no server traffic.
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const lineHeight = (term.options.fontSize ?? 14) * (term.options.lineHeight ?? 1.2)
        const lines = Math.round(e.deltaY / lineHeight) || (e.deltaY > 0 ? 1 : -1)
        term.scrollLines(lines)
      }
      el.addEventListener('wheel', onWheel, { passive: false, capture: true })

      // Touch scrolling — capture phase fires before xterm's own handlers
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

      // Paste image from clipboard — upload to server, type the path into the terminal
      const onPaste = (e: ClipboardEvent) => {
        // Only handle paste in the focused terminal (el.contains checks if this instance's xterm has focus)
        if (!visibleRef.current || !el.contains(document.activeElement)) return
        if (!e.clipboardData) return
        const imageItem = Array.from(e.clipboardData.items).find(
          item => item.kind === 'file' && item.type.startsWith('image/')
        )
        if (!imageItem) return
        e.preventDefault()
        e.stopPropagation()

        const file = imageItem.getAsFile()
        if (!file) return

        // Generate a timestamped filename from the MIME type (e.g. paste-20240101-120000.png)
        const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
        const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
        const filename = `paste-${ts}.${ext}`
        const renamed = new File([file], filename, { type: file.type })

        const form = new FormData()
        form.append('file', renamed)

        term.write(`\x1b[33m[uploading ${filename}\u2026]\x1b[0m`)

        fetch('/api/files/upload', { method: 'POST', body: form })
          .then(r => r.json())
          .then((res: { path?: string; error?: string }) => {
            if (res.path) {
              // Erase the status message and type the path as if the user typed it
              term.write('\r\x1b[K')
              if (wsRef?.readyState === WebSocket.OPEN)
                wsRef.send(JSON.stringify({ type: 'input', data: res.path }))
            } else {
              term.write(`\r\x1b[K\x1b[31m[upload failed: ${res.error ?? 'unknown error'}]\x1b[0m\r\n`)
            }
          })
          .catch(() => {
            term.write('\r\x1b[K\x1b[31m[upload failed]\x1b[0m\r\n')
          })
      }

      document.addEventListener('paste', onPaste, true)  // capture phase — fires before xterm consumes it
      el.addEventListener('contextmenu', onContextMenu)
      if (isTouchDevice) {
        el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
        el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
        el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
      }

      return () => {
        destroyed = true
        clearTimers()
        if (activityTimer) clearTimeout(activityTimer)
        if (resizeTimer) clearTimeout(resizeTimer)
        onSelectionDispose.dispose()
        onDataDispose.dispose()
        disposeH.dispose()
        disposeL.dispose()
        fitAddonRef.current = null
        termRef.current = null
        observer.disconnect()
        stopMomentum()
        if (isTouchDevice) {
          el.removeEventListener('touchstart', onTouchStart, { capture: true })
          el.removeEventListener('touchmove', onTouchMove, { capture: true })
          el.removeEventListener('touchend', onTouchEnd, { capture: true })
        }
        document.removeEventListener('paste', onPaste, true)
        el.removeEventListener('contextmenu', onContextMenu)
        el.removeEventListener('wheel', onWheel, { capture: true })
        wsRef?.close()
        term.dispose()
        // Clear container so no ghost canvas elements linger if xterm.dispose() misses any
        if (containerRef.current) containerRef.current.innerHTML = ''
      }
    }, [sessionId])

    return <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
  }
)
