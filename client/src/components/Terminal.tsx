import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
  visible?: boolean
  onClose: () => void
  onError: (msg: string) => void
}

export function TerminalView({ sessionId, visible = true, onClose, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Re-fit when becoming visible (tab switch)
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      setTimeout(() => fitAddonRef.current?.fit(), 0)
    }
  }, [visible])

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        black: '#1a1a1a',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#6272a4',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#6272a4',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff',
      },
    })

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current!)
    fitAddon.fit()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal?sessionId=${sessionId}`)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
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
      if (e.code === 4001) {
        // Session ended naturally (e.g. user typed exit)
        term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
        setTimeout(() => onClose(), 1000)
      } else if (e.code !== 1000) {
        term.write(`\r\n\x1b[31m[disconnected: ${e.reason || 'connection closed'}]\x1b[0m\r\n`)
      }
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })
    observer.observe(containerRef.current!)

    return () => {
      fitAddonRef.current = null
      observer.disconnect()
      ws.close()
      term.dispose()
    }
  }, [sessionId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', visibility: visible ? 'visible' : 'hidden', position: visible ? 'relative' : 'absolute', width: '100%' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: '#111',
        borderBottom: '1px solid #333',
        flexShrink: 0,
      }}>
        <span style={{ color: '#888', fontSize: 12 }}>{sessionId.slice(0, 8)}</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 14,
            padding: '2px 8px',
          }}
        >
          ✕
        </button>
      </div>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}
