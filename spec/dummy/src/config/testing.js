import dummyConfiguration from "./configuration.js"
import Task from "../models/task.js"

beforeEach(async () => {
  const dbs = dummyConfiguration.getCurrentConnections()

  // console.log("beforeEach transaction", {dbs: Object.keys(dbs)})

  for (const dbIdentifier in dbs) {
    const db = dbs[dbIdentifier]

    // console.log(`Starting transaction for ${dbIdentifier}`)

    await db.startTransaction()
  }
})

afterEach(async () => {
  const dbs = dummyConfiguration.getCurrentConnections()

  // console.log("afterEach transaction", {dbs: Object.keys(dbs)})

  for (const dbIdentifier in dbs) {
    const db = dbs[dbIdentifier]

    // console.log(`Rolling back transaction for ${dbIdentifier}`)

    await db.rollbackTransaction()
  }

  /*
    const tasksCount = await Task.count()

    if (tasksCount !== 0) {
      throw new Error(`Expected zero tasks but it was ${tasksCount}`)
    }
  */
})
