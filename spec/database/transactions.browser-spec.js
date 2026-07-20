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

  it("retries the whole transaction when an attempt hits a deadlock", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const project = await Project.create()
      const originalRetryable = db.retryableDatabaseError.bind(db)

      // Flag a marker error as a deadlock so the outermost transaction re-runs the callback.
      db.retryableDatabaseError = (/** @type {Error} */ error) => {
        if (error instanceof Error && error.message.includes("SIMULATED_DEADLOCK")) {
          return {retry: false, reconnect: false, deadlock: true, waitMs: 1}
        }

        return originalRetryable(error)
      }

      let attempts = 0

      try {
        await db.transaction(async () => {
          attempts++
          await Task.create({name: `Deadlock attempt ${attempts}`, project})

          if (attempts == 1) throw new Error("SIMULATED_DEADLOCK")
        })
      } finally {
        db.retryableDatabaseError = originalRetryable
      }

      const names = (await Task.where({projectId: project.id()}).toArray()).map((task) => task.name())

      expect(attempts).toEqual(2)
      // The first (deadlocked) attempt rolled back, so only the retry's row persisted.
      expect(names).toEqual(["Deadlock attempt 2"])
    })
  })

  it("gives up and rethrows after exhausting the configured deadlock retries", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const originalRetryable = db.retryableDatabaseError.bind(db)
      const originalGetArgs = db.getArgs.bind(db)
      const originalWaitMs = db._waitMs.bind(db)

      db.retryableDatabaseError = () => ({retry: false, reconnect: false, deadlock: true})
      // Pin the retry budget so the assertion is against a controlled value, not the default.
      db.getArgs = () => ({...originalGetArgs(), deadlockMaxRetries: 3})
      db._waitMs = async () => {}

      let attempts = 0
      /** @type {unknown} */
      let caught = null

      try {
        await db.transaction(async () => {
          attempts++

          throw new Error("ALWAYS_DEADLOCK")
        })
      } catch (error) {
        caught = error
      } finally {
        db.retryableDatabaseError = originalRetryable
        db.getArgs = originalGetArgs
        db._waitMs = originalWaitMs
      }

      expect(attempts).toEqual(3)
      expect(caught instanceof Error && caught.message).toEqual("ALWAYS_DEADLOCK")
    })
  })

  it("backs off with capped full-jitter exponential delays between deadlock retries", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const originalRetryable = db.retryableDatabaseError.bind(db)
      const originalGetArgs = db.getArgs.bind(db)
      const originalWaitMs = db._waitMs.bind(db)
      const originalRandom = Math.random
      /** @type {number[]} */
      const waits = []

      db.retryableDatabaseError = (/** @type {Error} */ error) =>
        error instanceof Error && error.message.includes("SIMULATED_DEADLOCK")
          ? {retry: false, reconnect: false, deadlock: true}
          : originalRetryable(error)
      db.getArgs = () => ({...originalGetArgs(), deadlockBaseWaitMs: 100, deadlockMaxWaitMs: 1000, deadlockMaxRetries: 8})
      db._waitMs = async (/** @type {number} */ ms) => { waits.push(ms) }
      // Fix the jitter fraction so the delays are deterministic; full jitter picks in [0, ceiling].
      Math.random = () => 0.5

      let attempts = 0

      try {
        await db.transaction(async () => {
          attempts++
          if (attempts <= 5) throw new Error("SIMULATED_DEADLOCK")
        })
      } finally {
        db.retryableDatabaseError = originalRetryable
        db.getArgs = originalGetArgs
        db._waitMs = originalWaitMs
        Math.random = originalRandom
      }

      expect(attempts).toEqual(6)
      // Ceilings double until the cap: min(100 * 2^(n-1), 1000) = 100,200,400,800,1000 for
      // attempts 1..5. Full jitter with Math.random()==0.5 yields floor(0.5 * (ceiling + 1)).
      // The old linear `base * attempt` would have been [100,200,300,400,500] with no jitter.
      expect(waits).toEqual([50, 100, 200, 400, 500])
    })
  })

  it("can back off with zero delay when the jitter resolves to its lower bound", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const originalRetryable = db.retryableDatabaseError.bind(db)
      const originalGetArgs = db.getArgs.bind(db)
      const originalWaitMs = db._waitMs.bind(db)
      const originalRandom = Math.random
      /** @type {number[]} */
      const waits = []

      db.retryableDatabaseError = (/** @type {Error} */ error) =>
        error instanceof Error && error.message.includes("SIMULATED_DEADLOCK")
          ? {retry: false, reconnect: false, deadlock: true}
          : originalRetryable(error)
      db.getArgs = () => ({...originalGetArgs(), deadlockBaseWaitMs: 100, deadlockMaxWaitMs: 1000, deadlockMaxRetries: 8})
      db._waitMs = async (/** @type {number} */ ms) => { waits.push(ms) }
      Math.random = () => 0

      let attempts = 0

      try {
        await db.transaction(async () => {
          attempts++
          if (attempts <= 3) throw new Error("SIMULATED_DEADLOCK")
        })
      } finally {
        db.retryableDatabaseError = originalRetryable
        db.getArgs = originalGetArgs
        db._waitMs = originalWaitMs
        Math.random = originalRandom
      }

      expect(attempts).toEqual(4)
      expect(waits).toEqual([0, 0, 0])
    })
  })

  it("retries when a deadlock rolls back a nested savepoint via the full-rollback fallback", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const project = await Project.create()
      const originalRetryable = db.retryableDatabaseError.bind(db)
      const originalRollbackSavePoint = db.rollbackSavePoint.bind(db)

      let outerAttempts = 0

      db.retryableDatabaseError = (/** @type {Error} */ error) => {
        if (error instanceof Error && error.message.includes("NESTED_DEADLOCK")) {
          return {retry: false, reconnect: false, deadlock: true, waitMs: 1}
        }

        return originalRetryable(error)
      }

      // Force the inner savepoint rollback to fail on the first attempt, exercising the
      // full-transaction rollback fallback that the outer catch must not double-roll-back.
      db.rollbackSavePoint = async (/** @type {string} */ name) => {
        if (outerAttempts == 1) throw new Error("ER_SP_DOES_NOT_EXIST: SAVEPOINT does not exist")

        return originalRollbackSavePoint(name)
      }

      try {
        await db.transaction(async () => {
          outerAttempts++
          await Task.create({name: `Outer ${outerAttempts}`, project})

          await db.transaction(async () => {
            if (outerAttempts == 1) throw new Error("NESTED_DEADLOCK")

            await Task.create({name: `Inner ${outerAttempts}`, project})
          })
        })
      } finally {
        db.retryableDatabaseError = originalRetryable
        db.rollbackSavePoint = originalRollbackSavePoint
      }

      const names = (await Task.where({projectId: project.id()}).toArray()).map((task) => task.name()).sort()

      expect(outerAttempts).toEqual(2)
      expect(db._transactionsCount).toBe(0)
      // The first (deadlocked) attempt rolled back entirely; only the retry's rows persisted.
      expect(names).toEqual(["Inner 2", "Outer 2"])
    })
  })
})
