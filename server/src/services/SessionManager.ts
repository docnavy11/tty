import { Client } from 'ssh2'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'
import type { SessionConfig, StoredSession } from '../types.js'

interface LiveSession extends StoredSession {
  conn: Client
  channel: ClientChannel
  ws: WebSocket | null
}

class SessionManager {
  private sessions = new Map<string, StoredSession>()
  private live = new Map<string, LiveSession>()

  create(config: SessionConfig): string {
    const id = randomUUID()
    const session: StoredSession = {
      id,
      config,
      tmuxName: `wt_${id.replace(/-/g, '').slice(0, 16)}`,
      status: 'pending',
      createdAt: new Date(),
      lastActivity: new Date(),
    }
    this.sessions.set(id, session)
    return id
  }

  get(id: string): StoredSession | undefined {
    return this.sessions.get(id)
  }

  list(): StoredSession[] {
    return Array.from(this.sessions.values())
  }

  async connect(id: string, ws: WebSocket, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Session ${id} not found`)

    // Steal existing connection if alive
    const existing = this.live.get(id)
    if (existing) {
      if (existing.ws && existing.ws.readyState === 1) {
        existing.ws.close(1000, 'stolen by new connection')
      }
      existing.ws = ws
      this.pipeChannelToWs(existing.channel, ws, id)
      this.pipeWsToChannel(ws, existing.conn, existing.channel, existing.tmuxName)
      return
    }

    session.status = 'connecting'

    const conn = new Client()

    await new Promise<void>((resolve, reject) => {
      conn.on('ready', () => {
        conn.shell(
          { rows, cols, term: 'xterm-256color' },
          (err, channel) => {
            if (err) { reject(err); return }

            // Attach to existing tmux session or create new one
            channel.write(`tmux new-session -A -s ${session.tmuxName} -x ${cols} -y ${rows}\n`)

            const liveSession: LiveSession = {
              ...session,
              status: 'connected',
              conn,
              channel,
              ws,
            }
            this.live.set(id, liveSession)
            this.sessions.set(id, { ...session, status: 'connected' })

            this.pipeChannelToWs(channel, ws, id)
            this.pipeWsToChannel(ws, conn, channel, session.tmuxName)

            resolve()
          }
        )
      })

      conn.on('error', reject)

      const connectConfig: ConnectConfig = {
        host: session.config.host,
        port: session.config.port,
        username: session.config.username,
        keepaliveInterval: 10000,
        readyTimeout: 15000,
      }

      if (session.config.authType === 'key') {
        // Use specified key or fall back to default keys on the server
        const home = process.env.HOME ?? '/root'
        const candidates = session.config.keyPath
          ? [session.config.keyPath.replace(/^~/, home)]
          : [
              `${home}/.ssh/id_ed25519`,
              `${home}/.ssh/id_rsa`,
              `${home}/.ssh/id_ecdsa`,
            ]
        for (const keyPath of candidates) {
          try {
            connectConfig.privateKey = readFileSync(keyPath)
            break
          } catch { /* try next */ }
        }
        if (!connectConfig.privateKey) {
          throw new Error('No SSH key found. Add a key to ~/.ssh/ on the proxy server.')
        }
      } else if (session.config.authType === 'password') {
        connectConfig.password = session.config.password
      }

      conn.connect(connectConfig)
    })
  }

  private pipeChannelToWs(channel: ClientChannel, ws: WebSocket, sessionId: string) {
    const onData = (data: Buffer) => {
      if (ws.readyState === 1) ws.send(data)
    }
    const onClose = () => {
      const live = this.live.get(sessionId)
      if (live) {
        this.live.delete(sessionId)
        this.sessions.set(sessionId, { ...live, status: 'detached' })
      }
      if (ws.readyState === 1) ws.close()
    }

    channel.on('data', onData)
    channel.once('close', onClose)
  }

  private pipeWsToChannel(ws: WebSocket, conn: Client, channel: ClientChannel, tmuxName: string) {
    ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'input') {
          channel.write(msg.data)
        } else if (msg.type === 'resize') {
          channel.setWindow(msg.rows, msg.cols, 0, 0)
          conn.exec(
            `tmux resize-window -t ${tmuxName} -x ${msg.cols} -y ${msg.rows}`,
            (err, ch) => { if (!err) ch.resume() }
          )
        }
      } catch {
        // ignore malformed messages
      }
    })
  }

  kill(id: string): void {
    const live = this.live.get(id)
    if (live) {
      live.conn.exec(`tmux kill-session -t ${live.tmuxName}`, (err, ch) => {
        if (!err) ch.resume()
      })
      setTimeout(() => {
        live.ws?.close()
        live.conn.end()
      }, 300)
      this.live.delete(id)
    }
    this.sessions.delete(id)
  }
}

export const sessionManager = new SessionManager()
