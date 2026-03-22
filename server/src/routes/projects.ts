import type { FastifyInstance } from 'fastify'
import { projectManager } from '../services/ProjectManager.js'
import { sessionManager } from '../services/SessionManager.js'

export async function projectRoutes(app: FastifyInstance) {
  // List projects with live status
  app.get('/api/projects', async () => {
    const projects = projectManager.listProjects()
    const activeSessions = sessionManager.list()
    return projects.map(p => {
      const ps = activeSessions.filter(s => s.config.projectId === p.id)
      return {
        ...p,
        sessionDefs: projectManager.listSessionDefs(p.id),
        activeSessionIds: ps.map(s => s.id),
        connectedCount: ps.filter(s => s.status === 'connected').length,
        totalCount: ps.length,
      }
    })
  })

  app.post('/api/projects', async (req) => {
    const { name, autostart } = req.body as Record<string, unknown>
    return projectManager.createProject(name as string, Boolean(autostart))
  })

  app.put('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string }
    projectManager.updateProject(id, req.body as Parameters<typeof projectManager.updateProject>[1])
    return projectManager.getProject(id)
  })

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    sessionManager.stopProject(id)
    projectManager.deleteProject(id)
    reply.code(204).send()
  })

  // Session definitions
  app.get('/api/projects/:id/sessions', async (req) => {
    const { id } = req.params as { id: string }
    return projectManager.listSessionDefs(id)
  })

  app.post('/api/projects/:id/sessions', async (req) => {
    const { id } = req.params as { id: string }
    return projectManager.addSessionDef(id, req.body as Parameters<typeof projectManager.addSessionDef>[1])
  })

  app.put('/api/projects/:pid/sessions/:sid', async (req) => {
    const { sid } = req.params as { pid: string; sid: string }
    projectManager.updateSessionDef(sid, req.body as Parameters<typeof projectManager.updateSessionDef>[1])
    return projectManager.getSessionDef(sid)
  })

  app.delete('/api/projects/:pid/sessions/:sid', async (req, reply) => {
    const { sid } = req.params as { pid: string; sid: string }
    projectManager.deleteSessionDef(sid)
    reply.code(204).send()
  })

  // Launch / stop
  app.post('/api/projects/:id/launch', async (req) => {
    const { id } = req.params as { id: string }
    const sessionIds = sessionManager.launchProject(id)
    return { sessionIds }
  })

  app.delete('/api/projects/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string }
    sessionManager.stopProject(id)
    reply.code(204).send()
  })
}
