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
      await db.withDisabledForeignKeys(async () => {
        let tries = 0

        while(true) {
          tries++

          const tables = await db.getTables()
          const truncateErrors = []

          for (const table of tables) {
            if (table.getName() != "schema_migrations") {
              try {
                await table.truncate({cascade: true})
              } catch (error) {
                truncateErrors.push(error)
              }
            }
          }

          if (truncateErrors.length == 0) {
            break
          } else if (tries <= 5) {
            // Retry
          } else {
            throw truncateErrors[0]
          }
        }
      })
    }
  }
})
