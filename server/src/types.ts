export interface SessionConfig {
  host: string
  port: number
  username: string
  authType: 'key' | 'password' | 'local'
  keyPath?: string
  password?: string
  displayName?: string
  projectId?: string
  projectSessionId?: string
  // Directory the session was started in. Only meaningful for authType 'local',
  // and only honoured when the tmux session is created — reattaching to an
  // existing one keeps whatever directory it is already in.
  cwd?: string
}

export type SessionStatus = 'pending' | 'connecting' | 'connected' | 'detached' | 'orphaned'

export interface StoredSession {
  id: string
  config: SessionConfig
  tmuxName: string
  status: SessionStatus
  createdAt: Date
  lastActivity: Date
  // Consecutive authoritative probes that failed to find the tmux session.
  missingProbes?: number
  orphanedAt?: Date
}
