// @ts-check

import Configuration from "../../src/configuration.js"
import DatabaseDriverBase from "../../src/database/drivers/base.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"

class TransactionLifecycleDriver extends DatabaseDriverBase {
  /** @type {string[]} */
  actions = []
  /** @type {Error | undefined} */
  commitError = undefined
  /** @type {Error | undefined} */
  rollbackError = undefined

  /** @returns {string} - Deterministic savepoint name. */
  generateSavePointName() {
    return "before_commit_savepoint"
  }

  /** @returns {Promise<void>} - Records transaction start. */
  async _startTransactionAction() {
    this.actions.push("begin")
  }

  /** @returns {Promise<void>} - Records transaction commit. */
  async _commitTransactionAction() {
    this.actions.push("commit")

    const commitError = this.commitError

    this.commitError = undefined
    if (commitError) throw commitError
  }

  /** @returns {Promise<void>} - Records transaction rollback. */
  async _rollbackTransactionAction() {
    this.actions.push("rollback")

    const rollbackError = this.rollbackError

    this.rollbackError = undefined
    if (rollbackError) throw rollbackError
  }

  /**
   * Records savepoint start.
   * @param {string} savePointName - Savepoint name.
   * @returns {Promise<void>}
   */
  async _startSavePointAction(savePointName) {
    this.actions.push(`savepoint ${savePointName}`)
  }

  /**
   * Records savepoint release.
   * @param {string} savePointName - Savepoint name.
   * @returns {Promise<void>}
   */
  async _releaseSavePointAction(savePointName) {
    this.actions.push(`release ${savePointName}`)
  }

  /**
   * Records savepoint rollback.
   * @param {string} savePointName - Savepoint name.
   * @returns {Promise<void>}
   */
  async _rollbackSavePointAction(savePointName) {
    this.actions.push(`rollback ${savePointName}`)
  }
}

describe("database - operation-scoped transactions - beforeCommit guards", {tags: ["dummy"], databaseCleaning: {transaction: false}}, () => {
  it("runs an outer guard with its operation after callback success and before commit", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Before-commit order project"})
    /** @type {string[]} */
    const events = []
    let lateGuardRuns = 0

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      await operation.forModel(Task).create({name: "Before-commit order task", project})
      await operation.beforeCommit(async ({operation: guardedOperation}) => {
        events.push("guard")
        expect(guardedOperation).toBe(operation)
        expect(await guardedOperation.forModel(Task).findBy({name: "Before-commit order task"})).toBeDefined()
      })
      await operation.afterCommit(async () => {
        await expect(async () => {
          await operation.beforeCommit(() => {
            lateGuardRuns++
          })
        }).toThrowError("beforeCommit requires an active transaction")
        events.push("afterCommit")
      })
      events.push("callback")
    })

    events.push("resolved")
    expect(events).toEqual(["callback", "guard", "afterCommit", "resolved"])
    expect(lateGuardRuns).toEqual(0)
  })

  it("rolls back a rejected outer guard, discards afterCommit, and preserves error identity", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Before-commit rejection project"})
    const guardError = new Error("BEFORE_COMMIT_REJECTED")
    let afterCommitRuns = 0
    let rejected = false

    try {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        await operation.forModel(Task).create({name: "Rejected before-commit task", project})
        await operation.afterCommit(() => {
          afterCommitRuns++
        })
        await operation.beforeCommit(async () => {
          await Promise.resolve()
          throw guardError
        })
      })
    } catch (error) {
      rejected = true
      expect(error).toBe(guardError)
    }

    expect(rejected).toBeTrue()
    expect(await Task.findBy({name: "Rejected before-commit task"})).toBeNull()
    expect(afterCommitRuns).toEqual(0)
  })

  it("keeps unrelated shared-connection work outside the operation until guard rollback releases the lease", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Before-commit lease project"})
    const guardError = new Error("BEFORE_COMMIT_LEASE_ROLLBACK")
    let unrelatedFinished = false
    /** @type {Promise<Task> | undefined} */
    let unrelatedWrite

    try {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        await operation.forModel(Task).create({name: "Owned before-commit lease task", project})

        unrelatedWrite = Task
          .create({name: "Unrelated before-commit lease task", project})
          .then((task) => {
            unrelatedFinished = true
            return task
          })

        await operation.beforeCommit(async () => {
          await Promise.resolve()
          expect(unrelatedFinished).toBeFalse()
          throw guardError
        })
      })
    } catch (error) {
      expect(error).toBe(guardError)
    }

    if (!unrelatedWrite) throw new Error("Unrelated write was not started")

    await unrelatedWrite

    expect(await Task.findBy({name: "Owned before-commit lease task"})).toBeNull()
    expect(await Task.findBy({name: "Unrelated before-commit lease task"})).toBeDefined()
  })

  it("runs nested guards before release and rolls back only a rejected nested frame", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Nested before-commit project"})
    const nestedGuardError = new Error("NESTED_BEFORE_COMMIT_REJECTED")
    /** @type {string[]} */
    const events = []
    let nestedRejectedAfterCommitRuns = 0

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      const Tasks = operation.forModel(Task)

      await Tasks.create({name: "Outer before-commit survivor", project})
      await operation.afterCommit(() => {
        events.push("outer afterCommit")
      })

      await operation.transaction(async () => {
        await Tasks.create({name: "Nested before-commit survivor", project})
        await operation.beforeCommit(() => {
          events.push("nested success guard")
        })
        await operation.afterCommit(() => {
          events.push("nested success afterCommit")
        })
        events.push("nested success callback")
      })
      events.push("nested success returned")

      try {
        await operation.transaction(async () => {
          await Tasks.create({name: "Nested before-commit rollback", project})
          await operation.afterCommit(() => {
            nestedRejectedAfterCommitRuns++
          })
          await operation.beforeCommit(() => {
            events.push("nested rejected guard")
            throw nestedGuardError
          })
          events.push("nested rejected callback")
        })
      } catch (error) {
        expect(error).toBe(nestedGuardError)
        events.push("nested rejection caught")
      }

      await Tasks.create({name: "Outer after nested rejection", project})
      await operation.beforeCommit(() => {
        events.push("outer guard")
      })
    })

    expect(events).toEqual([
      "nested success callback",
      "nested success guard",
      "nested success returned",
      "nested rejected callback",
      "nested rejected guard",
      "nested rejection caught",
      "outer guard",
      "outer afterCommit",
      "nested success afterCommit"
    ])
    expect(await Task.findBy({name: "Outer before-commit survivor"})).toBeDefined()
    expect(await Task.findBy({name: "Nested before-commit survivor"})).toBeDefined()
    expect(await Task.findBy({name: "Nested before-commit rollback"})).toBeNull()
    expect(await Task.findBy({name: "Outer after nested rejection"})).toBeDefined()
    expect(nestedRejectedAfterCommitRuns).toEqual(0)
  })

  it("does not run a guard or mask the exact transaction callback error on callback failure", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Before-commit callback failure project"})
    const callbackError = new Error("TRANSACTION_CALLBACK_REJECTED")
    let guardRuns = 0
    let rejected = false

    try {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        await operation.forModel(Task).create({name: "Before-commit callback rollback", project})
        await operation.beforeCommit(() => {
          guardRuns++
        })

        throw callbackError
      })
    } catch (error) {
      rejected = true
      expect(error).toBe(callbackError)
    }

    expect(rejected).toBeTrue()
    expect(guardRuns).toEqual(0)
    expect(await Task.findBy({name: "Before-commit callback rollback"})).toBeNull()
  })

  it("shares one guard path for outer commits and nested releases while preserving completion errors", async () => {
    const driver = new TransactionLifecycleDriver({deadlockMaxRetries: 1}, Configuration.current())

    await driver.transaction(async () => {
      driver.actions.push("outer callback")
      await driver.beforeCommit(() => {
        driver.actions.push("outer guard")
      })

      await driver.transaction(async () => {
        driver.actions.push("nested callback")
        await driver.beforeCommit(() => {
          driver.actions.push("nested guard")
        })
      })
      driver.actions.push("nested returned")
    })

    expect(driver.actions).toEqual([
      "begin",
      "outer callback",
      "savepoint before_commit_savepoint",
      "nested callback",
      "nested guard",
      "release before_commit_savepoint",
      "nested returned",
      "outer guard",
      "commit"
    ])

    const commitError = new Error("COMMIT_FAILED")
    let commitGuardRuns = 0

    driver.actions = []
    driver.commitError = commitError

    try {
      await driver.transaction(async () => {
        await driver.beforeCommit(() => {
          commitGuardRuns++
          driver.actions.push("commit guard")
        })
      })
    } catch (error) {
      expect(error).toBe(commitError)
    }

    expect(commitGuardRuns).toEqual(1)
    expect(driver.actions).toEqual(["begin", "commit guard", "commit", "rollback"])

    const callbackError = new Error("CALLBACK_BEFORE_ROLLBACK_FAILED")
    const rollbackError = new Error("ROLLBACK_FAILED")
    let discardedGuardRuns = 0

    driver.actions = []
    driver.rollbackError = rollbackError

    try {
      await driver.transaction(async () => {
        await driver.beforeCommit(() => {
          discardedGuardRuns++
        })
        throw callbackError
      })
    } catch (error) {
      expect(error).toBe(rollbackError)
    }

    expect(discardedGuardRuns).toEqual(0)
    expect(driver.actions).toEqual(["begin", "rollback"])

    driver.actions = []

    await driver.transaction(async () => {
      await driver.beforeCommit(() => {
        driver.actions.push("fresh guard")
      })
    })

    expect(driver.actions).toEqual(["begin", "fresh guard", "commit"])
  })

  it("rejects beforeCommit registration through an expired operation handle", async () => {
    const configuration = Configuration.current()
    /** @type {import("../../src/database/operation.js").default | undefined} */
    let expiredOperation

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      expiredOperation = operation
    })

    if (!expiredOperation) throw new Error("Operation handle was not captured")

    await expect(async () => {
      await expiredOperation.beforeCommit(() => {})
    }).toThrowError("Database operation has completed")
  })
})
