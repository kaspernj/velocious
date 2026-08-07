// @ts-check

import Configuration from "../../../src/configuration.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/**
 * Cross-driver regression coverage for bounding `Record.insertMultiple` by the
 * serialized size of each generated SQL statement. The dummy app is normally
 * configured for sqlite locally, but the `.browser-spec.js` suffix means CI runs
 * this same file against mariadb, pgsql, and mssql as well.
 */
describe("Record - insertMultiple byte bound", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
  it("splits text/JSON-heavy batches by serialized SQL bytes", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const originalArgsMaxInsertSqlBytes = driver.getArgs().maxInsertSqlBytes
      const originalQuery = driver.query.bind(driver)
      const insertQueries = []

      driver.query = async (sql, options) => {
        if (typeof sql === "string" && /^INSERT INTO\s+[`"']?tasks[`"']?/i.test(sql)) {
          insertQueries.push(sql)
        }

        return originalQuery(sql, options)
      }

      try {
        driver.getArgs().maxInsertSqlBytes = 4096

        const project = await Project.create({name: "Byte-bound project"})
        const createdAtIso = "2025-12-26T16:18:50.641Z"
        const rows = []

        for (let index = 0; index < 20; index++) {
          const description = JSON.stringify({
            index,
            payload: "x".repeat(2000)
          })

          rows.push([String(project.id()), `byte-task-${String(index).padStart(2, "0")}`, createdAtIso, createdAtIso, description])
        }

        await Task.insertMultiple(
          ["project_id", "name", "created_at", "updated_at", "description"],
          rows,
          {cast: true}
        )

        expect(insertQueries.length).toBeGreaterThan(1)

        const tasks = await Task.where({projectId: project.id()}).order("name").toArray()

        expect(tasks.length).toEqual(20)
        expect(tasks[0].name()).toEqual("byte-task-00")
        expect(tasks[19].name()).toEqual("byte-task-19")
      } finally {
        driver.query = originalQuery

        if (originalArgsMaxInsertSqlBytes === undefined) {
          delete driver.getArgs().maxInsertSqlBytes
        } else {
          driver.getArgs().maxInsertSqlBytes = originalArgsMaxInsertSqlBytes
        }
      }
    })
  })

  it("rolls back every byte-limited chunk when the caller is inside a transaction and one chunk fails", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const originalArgsMaxInsertSqlBytes = driver.getArgs().maxInsertSqlBytes
      const originalQuery = driver.query.bind(driver)
      const insertQueries = []

      driver.query = async (sql, options) => {
        if (typeof sql === "string" && /^INSERT INTO\s+[`"']?tasks[`"']?/i.test(sql)) {
          insertQueries.push(sql)
        }

        return originalQuery(sql, options)
      }

      try {
        driver.getArgs().maxInsertSqlBytes = 4096

        const project = await Project.create({name: "Byte-bound rollback project"})
        const createdAtIso = "2025-12-26T16:18:50.641Z"
        const rows = []

        for (let index = 0; index < 20; index++) {
          const description = JSON.stringify({
            index,
            payload: "x".repeat(2000)
          })

          rows.push([String(project.id()), `rollback-byte-task-${String(index).padStart(2, "0")}`, createdAtIso, createdAtIso, description])
        }

        // Force a failure in a later chunk so the test would leak earlier chunks
        // if the driver committed them outside the caller's transaction.
        rows[15][0] = null

        let error

        try {
          await Task.transaction(async () => {
            await Task.insertMultiple(
              ["project_id", "name", "created_at", "updated_at", "description"],
              rows,
              {cast: true}
            )
          })
        } catch (caughtError) {
          error = caughtError
        }

        expect(error).toBeInstanceOf(Error)
        expect(insertQueries.length).toBeGreaterThan(1)

        const tasks = await Task.where({projectId: project.id()}).toArray()

        expect(tasks.length).toEqual(0)
      } finally {
        driver.query = originalQuery

        if (originalArgsMaxInsertSqlBytes === undefined) {
          delete driver.getArgs().maxInsertSqlBytes
        } else {
          driver.getArgs().maxInsertSqlBytes = originalArgsMaxInsertSqlBytes
        }
      }
    })
  })
})
