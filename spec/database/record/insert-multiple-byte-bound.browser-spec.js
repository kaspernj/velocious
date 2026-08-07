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
  /**
   * Builds a batch of task rows with a text/JSON-heavy description.
   * @param {Project} project - Parent project.
   * @param {string} namePrefix - Prefix for generated task names.
   * @param {number} count - Number of rows to build.
   * @returns {Array<Array<ReturnType<typeof JSON.parse>>>} - Rows ready for insertMultiple.
   */
  function buildRows(project, namePrefix, count) {
    const createdAtIso = "2025-12-26T16:18:50.641Z"
    const rows = []

    for (let index = 0; index < count; index++) {
      const description = JSON.stringify({
        index,
        payload: "x".repeat(2000)
      })

      rows.push([String(project.id()), `${namePrefix}-${String(index).padStart(2, "0")}`, createdAtIso, createdAtIso, description])
    }

    return rows
  }

  it("splits text/JSON-heavy batches by serialized SQL bytes and persists every row", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async () => {
      const driver = Task.connection()
      const originalArgsMaxInsertSqlBytes = driver.getArgs().maxInsertSqlBytes
      const maxInsertSqlBytes = 4096
      const columns = ["project_id", "name", "created_at", "updated_at", "description"]
      const tableName = Task.tableName()

      try {
        driver.getArgs().maxInsertSqlBytes = maxInsertSqlBytes

        const project = await Project.create({name: "Byte-bound project"})
        const rows = buildRows(project, "byte-task", 20)
        const buildSql = (chunkRows) => driver.insertSql({columns, tableName, rows: chunkRows})
        const chunks = driver._insertMultipleChunks(rows, buildSql)

        expect(chunks.length).toBeGreaterThan(1)

        for (const chunk of chunks) {
          const sql = buildSql(chunk)
          const byteLength = Buffer.byteLength(sql, "utf8")

          // A single oversized row is allowed to overflow on its own; the
          // chunker only guarantees that multi-row chunks fit.
          if (chunk.length > 1) {
            expect(byteLength).toBeLessThanOrEqual(maxInsertSqlBytes)
          }
        }

        await Task.insertMultiple(columns, rows, {cast: true})

        const tasks = await Task.where({projectId: project.id()}).order("name").toArray()

        expect(tasks.length).toEqual(20)
        expect(tasks[0].name()).toEqual("byte-task-00")
        expect(tasks[19].name()).toEqual("byte-task-19")
      } finally {
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

    await configuration.ensureConnections(async () => {
      const driver = Task.connection()
      const originalArgsMaxInsertSqlBytes = driver.getArgs().maxInsertSqlBytes
      const maxInsertSqlBytes = 4096
      const columns = ["project_id", "name", "created_at", "updated_at", "description"]
      const tableName = Task.tableName()

      try {
        driver.getArgs().maxInsertSqlBytes = maxInsertSqlBytes

        const project = await Project.create({name: "Byte-bound rollback project"})
        const rows = buildRows(project, "rollback-byte-task", 20)
        const buildSql = (chunkRows) => driver.insertSql({columns, tableName, rows: chunkRows})
        const chunks = driver._insertMultipleChunks(rows, buildSql)

        expect(chunks.length).toBeGreaterThan(1)

        // Force a failure in a later chunk so the test would leak earlier chunks
        // if the driver committed them outside the caller's transaction.
        rows[15][0] = null

        let error

        try {
          await Task.transaction(async () => {
            await Task.insertMultiple(columns, rows, {cast: true})
          })
        } catch (caughtError) {
          error = caughtError
        }

        expect(error).toBeInstanceOf(Error)

        const tasks = await Task.where({projectId: project.id()}).toArray()

        expect(tasks.length).toEqual(0)
      } finally {
        if (originalArgsMaxInsertSqlBytes === undefined) {
          delete driver.getArgs().maxInsertSqlBytes
        } else {
          driver.getArgs().maxInsertSqlBytes = originalArgsMaxInsertSqlBytes
        }
      }
    })
  })
})
