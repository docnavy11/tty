import type { FastifyInstance } from 'fastify'
import { getSettings, setSettings } from '../db/settings.js'

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => getSettings())

  app.put('/api/settings', async (req) => {
    const patch = req.body as Record<string, string>
    setSettings(patch)
    return getSettings()
  })
}
