// Drops the attachments table so the concurrency spec starts from a clean slate.
// Run in its own process before the workers, so no worker can win the drop race.
//
// Use the connection handed to the callback rather than getCurrentConnections(): the latter
// only resolves inside an ambient request/transaction scope, and is undefined when this runs
// as a standalone child process (which is how CI failed).
import configuration from "../../dummy/src/config/configuration.js"

const ATTACHMENTS_TABLE = "velocious_attachments"

try {
  await configuration.initializeDatabasePool()
  await configuration.ensureConnections(async (dbs) => {
    const db = dbs.default

    if (!db) throw new Error(`no default database connection; available: ${Object.keys(dbs).join(", ")}`)

    let existed = false

    if (await db.tableExists(ATTACHMENTS_TABLE)) {
      await db.query(`DROP TABLE ${ATTACHMENTS_TABLE}`)
      existed = true
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