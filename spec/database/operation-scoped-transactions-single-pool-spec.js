// @ts-check

import Configuration from "../../src/configuration.js"
import DatabaseOperation from "../../src/database/operation.js"
import Project from "../dummy/src/models/project.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import Task from "../dummy/src/models/task.js"

/**
 * Runs one operation through an explicit SingleMultiUsePool without replacing
 * the configured pool held by the test runner.
 * @template Result
 * @param {object} args - Operation arguments.
 * @param {Configuration} args.configuration - Dummy configuration.
 * @param {string} args.name - Checkout name.
 * @param {SingleMultiUsePool} args.pool - Isolated Single pool.
 * @param {(operation: DatabaseOperation) => Promise<Result>} callback - Operation callback.
 * @returns {Promise<Result>} - Callback result.
 */
async function withSinglePoolOperation({configuration, name, pool}, callback) {
  return await pool.withOperationConnection({name}, async (connection, owner) => {
    const operation = new DatabaseOperation({
      configuration,
      configurationReuseKey: pool.getConnectionConfigurationReuseKey(connection),
      connection,
      databaseIdentifier: "default",
      owner
    })

    try {
      return await operation.transaction(async () => await callback(operation))
    } finally {
      operation.complete()
    }
  })
}

describe("database - operation-scoped transactions - explicit SingleMultiUsePool", {tags: ["dummy"], databaseCleaning: {transaction: false}}, () => {
  it("holds an unrelated write behind the lease and commits it after rollback", async () => {
    const configuration = Configuration.current()
    const pool = new SingleMultiUsePool({configuration, identifier: "default"})
    const project = await Project.create({name: "Operation barrier project"})
    const rolledBackTask = await Task.create({name: "Before operation rollback", project})
    const survivingTask = await Task.create({name: "Before unrelated write", project})
    let survivorFinished = false
    /** @type {Promise<void> | undefined} */
    let survivorPromise

    try {
      await expect(async () => {
        await withSinglePoolOperation({configuration, name: "rollback with unrelated write", pool}, async (operation) => {
          const ownedTask = await operation.forModel(Task).find(rolledBackTask.id())

          ownedTask.assign({name: "Must roll back"})
          await ownedTask.save()

          const unrelatedConnection = pool.getCurrentConnection()

          survivorPromise = unrelatedConnection
            .query(
              `UPDATE ${unrelatedConnection.quoteTable(Task.tableName())} ` +
              `SET ${unrelatedConnection.quoteColumn("name")} = ${unrelatedConnection.quote("Must survive")} ` +
              `WHERE ${unrelatedConnection.quoteColumn(Task.primaryKey())} = ${unrelatedConnection.quote(survivingTask.id())}`
            )
            .then(() => {
              survivorFinished = true
            })

          await Promise.resolve()
          await Promise.resolve()

          expect(survivorFinished).toBeFalse()
          throw new Error("ROLLBACK_WITH_SURVIVOR")
        })
      }).toThrowError("ROLLBACK_WITH_SURVIVOR")

      if (!survivorPromise) throw new Error("Survivor write was not started")

      await survivorPromise

      expect((await Task.find(rolledBackTask.id())).name()).toEqual("Before operation rollback")
      expect((await Task.find(survivingTask.id())).name()).toEqual("Must survive")
    } finally {
      await pool.closeAll()
    }
  })

  it("discards owned afterCommit callbacks and runs an unrelated registration once", async () => {
    const configuration = Configuration.current()
    const pool = new SingleMultiUsePool({configuration, identifier: "default"})
    let ownedRuns = 0
    let unrelatedRuns = 0
    /** @type {Promise<void> | undefined} */
    let unrelatedPromise

    try {
      await expect(async () => {
        await withSinglePoolOperation({configuration, name: "rollback with afterCommit callbacks", pool}, async (operation) => {
          await operation.afterCommit(() => {
            ownedRuns++
          })

          unrelatedPromise = pool
            .getCurrentConnection()
            .afterCommit(() => {
              unrelatedRuns++
            })

          await Promise.resolve()
          expect(unrelatedRuns).toEqual(0)

          throw new Error("ROLLBACK_AFTER_COMMIT")
        })
      }).toThrowError("ROLLBACK_AFTER_COMMIT")

      if (!unrelatedPromise) throw new Error("Unrelated afterCommit registration was not started")

      await unrelatedPromise

      expect(ownedRuns).toEqual(0)
      expect(unrelatedRuns).toEqual(1)
    } finally {
      await pool.closeAll()
    }
  })

  it("supports nested success, nested rollback, and outer rollback", async () => {
    const configuration = Configuration.current()
    const pool = new SingleMultiUsePool({configuration, identifier: "default"})
    const project = await Project.create({name: "Nested operation project"})
    let nestedAfterCommitRuns = 0

    try {
      await withSinglePoolOperation({configuration, name: "nested success and rollback", pool}, async (operation) => {
        const Tasks = operation.forModel(Task)

        await Tasks.create({name: "Outer success", project})
        await operation.transaction(async () => {
          await Tasks.create({name: "Nested success", project})
          await operation.afterCommit(() => {
            nestedAfterCommitRuns++
          })
        })
        expect(nestedAfterCommitRuns).toEqual(0)

        await expect(async () => {
          await operation.transaction(async () => {
            await Tasks.create({name: "Nested rollback", project})
            throw new Error("ROLLBACK_NESTED")
          })
        }).toThrowError("ROLLBACK_NESTED")
      })

      expect(await Task.findBy({name: "Outer success"})).toBeDefined()
      expect(await Task.findBy({name: "Nested success"})).toBeDefined()
      expect(await Task.findBy({name: "Nested rollback"})).toBeNull()
      expect(nestedAfterCommitRuns).toEqual(1)

      await expect(async () => {
        await withSinglePoolOperation({configuration, name: "outer rollback", pool}, async (operation) => {
          const Tasks = operation.forModel(Task)

          await Tasks.create({name: "Outer rollback root", project})
          await operation.transaction(async () => {
            await Tasks.create({name: "Outer rollback nested", project})
          })

          throw new Error("ROLLBACK_OUTER")
        })
      }).toThrowError("ROLLBACK_OUTER")

      expect(await Task.findBy({name: "Outer rollback root"})).toBeNull()
      expect(await Task.findBy({name: "Outer rollback nested"})).toBeNull()
    } finally {
      await pool.closeAll()
    }
  })

  it("keeps one physical connection throughout the operation", async () => {
    const configuration = Configuration.current()
    const pool = new SingleMultiUsePool({configuration, identifier: "default"})

    try {
      await withSinglePoolOperation({configuration, name: "single physical connection", pool}, async (operation) => {
        expect(pool.getDebugSnapshot().connections.length).toEqual(1)
        expect(await operation.connection().query("SELECT 1 AS operation_connection")).toEqual([{operation_connection: 1}])
        expect(pool.getDebugSnapshot().connections.length).toEqual(1)
      })
    } finally {
      await pool.closeAll()
    }
  })
})
