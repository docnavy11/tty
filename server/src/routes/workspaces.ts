import type { FastifyInstance } from 'fastify'
import { basename } from 'path'
import { sessionManager } from '../services/SessionManager.js'
import { scanWorkspaces, resolveWorkspacePath, WORKSPACE_ROOT } from '../services/WorkspaceScanner.js'
import type { Workspace } from '../services/WorkspaceScanner.js'

interface WorkspaceSession {
  id: string
  displayName: string
  status: string
}

interface WorkspaceView extends Workspace {
  sessions: WorkspaceSession[]
  // Newest of (file activity, activity of a session living here). A directory
  // you have a shell open in is recent by definition, whatever its mtimes say.
  recent: string | null
}

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/api/workspaces', async () => {
    const dirs = scanWorkspaces()
    const paths = sessionManager.currentPaths()

    // Longest matching workspace path wins, so a session in
    // acme/billing-api attaches there and not to acme.
    const byPath = [...dirs].sort((a, b) => b.path.length - a.path.length)

    const bucket = new Map<string, WorkspaceSession[]>()
    const unmatched: WorkspaceSession[] = []

    for (const session of sessionManager.list()) {
      const path = paths.get(session.id)
      const entry: WorkspaceSession = {
        id: session.id,
        displayName: session.config.displayName ?? session.config.host,
        status: session.status,
      }
      const hit = path
        ? byPath.find(w => path === w.path || path.startsWith(w.path + '/'))
        : undefined
      if (!hit) { unmatched.push(entry); continue }
      const list = bucket.get(hit.path)
      if (list) list.push(entry)
      else bucket.set(hit.path, [entry])
    }

    const views: WorkspaceView[] = dirs.map(w => {
      const sessions = bucket.get(w.path) ?? []
      // A live session outranks any mtime: it is happening now.
      const recent = sessions.length > 0
        ? new Date().toISOString()
        : w.mtime
      return { ...w, sessions, recent }
    })

    views.sort((a, b) => {
      // Workspaces with a session first, then everything else by recency.
      if ((a.sessions.length > 0) !== (b.sessions.length > 0)) {
        return a.sessions.length > 0 ? -1 : 1
      }
      return (b.recent ?? '').localeCompare(a.recent ?? '')
    })

    return { root: WORKSPACE_ROOT, workspaces: views, unmatchedSessions: unmatched }
  })

  // Open a shell in a workspace. Creating the record is all this does — the pty
  // is spawned when the browser opens the WebSocket, the same as every other
  // session, so a request that never gets attached to leaves nothing running.
  app.post('/api/workspaces/session', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const dir = resolveWorkspacePath(String(body.path ?? ''))
    if (!dir) {
      return reply.code(400).send({ error: `Not a directory under ${WORKSPACE_ROOT}` })
    }
    const sessionId = sessionManager.create({
      host: 'localhost',
      port: 22,
      username: '',
      authType: 'local',
      displayName: (typeof body.name === 'string' && body.name.trim()) || basename(dir),
      cwd: dir,
    })
    return { sessionId }
  })
}
