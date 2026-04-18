import Dummy from "../../index.js"
import dummyConfiguration from "./configuration.js"

export default async function configureTesting() {
  beforeEach(async ({testArgs}) => {
    const transaction = testArgs.databaseCleaning?.transaction
    const useTransaction = transaction === undefined ? false : transaction
    const truncate = testArgs.databaseCleaning?.truncate
    const shouldTruncate = truncate === undefined ? !useTransaction : truncate

    if (shouldTruncate) {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        for (const dbIdentifier in dbs) {
          const db = dbs[dbIdentifier]
          await db.truncateAllTables()
        }
      })
    }

    if (useTransaction) {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        for (const dbIdentifier in dbs) {
          const db = dbs[dbIdentifier]

          await db.startTransaction()
        }
      })
    }
  })

  afterEach(async ({testArgs}) => {
    const transaction = testArgs.databaseCleaning?.transaction
    const truncate = testArgs.databaseCleaning?.truncate
    const useTransaction = transaction === undefined ? false : transaction
    const shouldTruncate = truncate === undefined ? !useTransaction : truncate
    await dummyConfiguration.ensureConnections(async (dbs) => {
      for (const dbIdentifier in dbs) {
        const db = dbs[dbIdentifier]

        if (useTransaction) {
          await db.rollbackTransaction()
        }

        if (shouldTruncate) {
          await db.truncateAllTables()
        }
      }
    })
  })

  // Tear the shared Dummy down once at suite end so the HTTP server stops
  // and DB pools close cleanly. Dummy.teardown is a no-op when nothing was started.
  afterAll(async () => {
    await Dummy.teardown()
  })
}
