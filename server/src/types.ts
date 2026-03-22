export interface SessionConfig {
  host: string
  port: number
  username: string
  authType: 'key' | 'password'
  keyPath?: string
  password?: string
  displayName?: string
  projectId?: string
  projectSessionId?: string
}

export type SessionStatus = 'pending' | 'connecting' | 'connected' | 'detached'

export interface StoredSession {
  id: string
  config: SessionConfig
  tmuxName: string
  status: SessionStatus
  createdAt: Date
  lastActivity: Date
}
