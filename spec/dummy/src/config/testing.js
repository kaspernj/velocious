import dummyConfiguration from "./configuration.js"

beforeEach(async ({testArgs}) => {
  const transaction = testArgs.databaseCleaning?.transaction

  if (transaction === undefined) {
    const dbs = dummyConfiguration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      const db = dbs[dbIdentifier]

      await db.startTransaction()
    }
  }
})

afterEach(async ({testArgs}) => {
  const transaction = testArgs.databaseCleaning?.transaction
  const truncate = testArgs.databaseCleaning?.truncate

  const dbs = dummyConfiguration.getCurrentConnections()

  for (const dbIdentifier in dbs) {
    const db = dbs[dbIdentifier]

    if (transaction === undefined || transaction) {
      await db.rollbackTransaction()
    }

    if (truncate) {
      await db.truncateAllTables()
    }
  }
})
