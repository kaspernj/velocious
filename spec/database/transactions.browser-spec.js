// @ts-check

import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import Configuration from "../../src/configuration.js"
import {ValidationError} from "../../src/database/record/index.js"

describe("database - transactions", {tags: ["dummy"]}, () => {
  it("supports transactions and savepoints", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const project = await Project.create()

      await db.transaction(async () => {
        await Task.create({name: "Task 1", project})

        await db.transaction(async () => {
          await Task.create({name: "Task 2", project})

          try {
            await db.transaction(async () => {
              await Task.create({name: "Task 3", project})
              await Task.create({name: "    ", project})

              throw new Error("Didn't expect to succeed")
            })
          } catch (error) {
            expect(error).toBeInstanceOf(ValidationError)

            if (error instanceof Error) {
              expect(error.message).toEqual("Name can't be blank")
            } else {
              throw new Error(`'error' wasn't an 'Error': ${typeof error}`, {cause: error})
            }
          }
        })
      })
    })

    const tasksCount = await Task.count()

    expect(tasksCount).toEqual(2)
  })

  it("rolls back a nested transaction without affecting the outer", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const project = await Project.create()

      await db.transaction(async () => {
        await Task.create({name: "Survives", project})

        try {
          await db.transaction(async () => {
            await Task.create({name: "Rolled back", project})
            throw new Error("Intentional inner rollback")
          })
        } catch {
          // Expected.
        }
      })

      const tasks = await Task.where({projectId: project.id()}).toArray()
      const names = tasks.map((task) => task.name())

      expect(names).toContain("Survives")
      expect(names).not.toContain("Rolled back")
    })
  })

  it("recovers from an error in the transaction() helper and allows a new transaction", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default

      try {
        await db.transaction(async () => {
          throw new Error("Intentional failure")
        })
      } catch {
        // Expected.
      }

      expect(db._transactionsCount).toBe(0)

      // A new transaction should work on the same connection.
      const project = await Project.create()

      await db.transaction(async () => {
        await Task.create({name: "After recovery", project})
      })

      const tasks = await Task.where({projectId: project.id()}).toArray()

      expect(tasks.length).toBe(1)
      expect(tasks[0].name()).toEqual("After recovery")
    })
  })

  it("cleans up _transactionsCount after nested transaction errors", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default

      try {
        await db.transaction(async () => {
          await db.transaction(async () => {
            throw new Error("Nested failure")
          })
        })
      } catch {
        // Expected.
      }

      expect(db._transactionsCount).toBe(0)
    })
  })
})
