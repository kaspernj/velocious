// @ts-check

import Configuration from "../../../src/configuration.js"
import DatabaseDriverBase from "../../../src/database/drivers/base.js"

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

describe("database driver base - beforeCommit lifecycle", () => {
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
})
