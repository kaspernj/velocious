// Drops the attachments table so the concurrency spec starts from a clean slate.
// Run in its own process before the workers, so no worker can win the drop race.
import configuration from "../../dummy/src/config/configuration.js"

const ATTACHMENTS_TABLE = "velocious_attachments"

try {
  await configuration.initializeDatabasePool()
  await configuration.ensureConnections(async () => {
    const db = configuration.getCurrentConnections().default

    let existed = false

    for (const tableName of [ATTACHMENTS_TABLE]) {
      if (await db.tableExists(tableName)) {
        await db.query(`DROP TABLE ${tableName}`)
        existed = true
      }
    }

    db.clearSchemaCache()
    console.error(`[drop] existed=${existed} now=${await db.tableExists(ATTACHMENTS_TABLE)}`)
  })
  await configuration.closeDatabaseConnections()
  process.exit(0)
} catch (error) {
  console.error(`[drop] FAILED: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}