// src/server.js
import 'dotenv/config'
import { buildApp } from './app.js'
import { getDb, closeDb } from './db.js'
import { startSyncScheduler, stopSyncScheduler } from './services/arcgis-sync.js'
import { startWorkers } from './workers/boss.js'

const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '0.0.0.0'

let appInstance = null

async function main() {
  const app = await buildApp()
  appInstance = app

  try {
    // Test DB connectivity on startup
    const sql = getDb()
    await sql`SELECT 1`
    app.log.info('✅ Database connected')

    // Start background workers and job queue
    await startWorkers(app)
    app.log.info('✅ Job queue started')

    // Start ArcGIS sync scheduler
    startSyncScheduler(app)

    // Start listening
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`🚀 Revenue API running on http://${HOST}:${PORT}`)
    app.log.info(`📚 API docs at http://${HOST}:${PORT}/docs`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Graceful shutdown
async function shutdown(signal) {
  try {
    if (appInstance) {
      appInstance.log.info(`${signal} received — shutting down`)
      await appInstance.close()
    }
    stopSyncScheduler()
    await closeDb()
  } catch (err) {
    console.error('Error during shutdown:', err)
  } finally {
    process.exit(0)
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

main()
