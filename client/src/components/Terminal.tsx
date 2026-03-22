import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { THEMES } from '../themes'
import type { AppSettings } from '../hooks/useSettings'

interface Props {
  sessionId: string
  visible?: boolean
  showHeader?: boolean
  settings?: AppSettings
  onClose: () => void
  onError: (msg: string) => void
}

export function TerminalView({ sessionId, visible = true, showHeader = true, settings, onClose, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

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
    let reconnectDelay = 1000

    function clearTimers() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    }

    // Register onData once — always writes to the current wsRef
    const onDataDispose = term.onData((data) => {
      if (wsRef?.readyState === WebSocket.OPEN) {
        wsRef.send(JSON.stringify({ type: 'input', data }))
      }
    })

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
        } else {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'error') onError(msg.message)
          } catch {
            term.write(e.data)
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
    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })

    return () => {
      destroyed = true
      clearTimers()
      onDataDispose.dispose()
      fitAddonRef.current = null
      termRef.current = null
      observer.disconnect()
      stopMomentum()
      el.removeEventListener('touchstart', onTouchStart, { capture: true })
      el.removeEventListener('touchmove', onTouchMove, { capture: true })
      el.removeEventListener('touchend', onTouchEnd, { capture: true })
      wsRef?.close()
      term.dispose()
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
