// @ts-check

import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"
import { deferred } from "awaitery"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import {configureTests, describe, expect, it, testConfig} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"
import timeout from "awaitery/build/timeout.js"

/**
 * ControlledDriverOperation type.
 * @typedef {object} ControlledDriverOperation
 * @property {import("awaitery/build/deferred.js").Deferred<void>} entered - Signals entry into the controlled operation.
 * @property {Error} [error] - Error raised after the operation is released.
 * @property {import("awaitery/build/deferred.js").Deferred<void>} proceed - Allows the controlled operation to continue.
 */

/** @type {ControlledDriverOperation | undefined} */
let controlledTransactionStart
/** @type {ControlledDriverOperation | undefined} */
let controlledTransactionRollback

class ControlledTransactionalTenantDriver extends SqliteDriver {
  async startTransaction(options = {}) {
    const control = controlledTransactionStart

    controlledTransactionStart = undefined
    if (control) {
      control.entered.resolve(undefined)
      await control.proceed.promise
      if (control.error) throw control.error
    }
    await super.startTransaction(options)
  }

  async rollbackTransaction(options = {}) {
    const control = controlledTransactionRollback

    controlledTransactionRollback = undefined
    if (control) {
      control.entered.resolve(undefined)
      await control.proceed.promise
      if (control.error) throw control.error
    }
    await super.rollbackTransaction(options)
  }
}

describe("TestRunner transactional tenant corrections", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("registers physical tenant transactions with SingleMultiUsePool", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-single-transactional-tenant")

    configuration.getDatabaseConfiguration().projectTenant.poolType = SingleMultiUsePool

    try {
      expect(configuration.getDatabasePool("projectTenant") instanceof SingleMultiUsePool).toBe(true)
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE attempt_rows(value varchar(255) NOT NULL)")
        })
      })

      const runner = new TestRunner({configuration, testFiles: []})
      let firstConnection
      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "writes through the registered physical connection": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  firstConnection = dbs.projectTenant
                  expect(dbs.projectTenant.insideTransaction()).toBe(true)
                  await dbs.projectTenant.query("INSERT INTO attempt_rows(value) VALUES ('first-attempt')")
                })
              })
            }
          },
          "rolls the physical connection back for the next attempt": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  expect(dbs.projectTenant).toBe(firstConnection)
                  expect(dbs.projectTenant.insideTransaction()).toBe(true)
                  expect(await dbs.projectTenant.query("SELECT value FROM attempt_rows")).toEqual([])
                })
              })
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})

      expect(runner._failedTests).toBe(0)
    } finally {
      await cleanup()
    }
  })

  it("does not publish an in-flight registration after its attempt times out", async () => {
    const previousTimeoutSeconds = testConfig.defaultTimeoutSeconds
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-in-flight-transactional-tenant")
    const transactionStartEntered = deferred()
    const allowTransactionStart = deferred()
    const timedOutRegistrationSettled = deferred()
    let timedOutRegistrationError
    let successorConnection
    let sharedConnectionAfterTimedOutRegistration

    configuration.getDatabaseConfiguration().projectTenant.driver = ControlledTransactionalTenantDriver
    controlledTransactionStart = {entered: transactionStartEntered, proceed: allowTransactionStart}

    try {
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE attempt_rows(value varchar(255) NOT NULL)")
        })
      })
      configureTests({defaultTimeoutSeconds: 1})

      const pool = configuration.getDatabasePool("projectTenant")
      const runner = new TestRunner({configuration, testFiles: []})
      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "times out while starting the tenant transaction": {
            args: {databaseCleaning: {transaction: true}, timeoutSeconds: 0.01},
            function: async (testArgs) => {
              try {
                await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              } catch (error) {
                timedOutRegistrationError = error
              } finally {
                timedOutRegistrationSettled.resolve(undefined)
              }
            }
          },
          "keeps the successor registration owned by the successor": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  successorConnection = dbs.projectTenant
                })
              })
              allowTransactionStart.resolve(undefined)
              await timedOutRegistrationSettled.promise
              sharedConnectionAfterTimedOutRegistration = await configuration.runWithTenant({slug: "alpha"}, async () => pool.testSharedConnection())
            }
          }
        }
      }

      const runPromise = runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})

      await transactionStartEntered.promise
      await runPromise

      expect(timedOutRegistrationError).toBeDefined()
      expect(sharedConnectionAfterTimedOutRegistration).toBe(successorConnection)
      expect(runner._failedTests).toBe(1)
    } finally {
      allowTransactionStart.resolve(undefined)
      controlledTransactionStart = undefined
      configureTests({defaultTimeoutSeconds: previousTimeoutSeconds})
      await cleanup()
    }
  })

  it("bounds emergency cleanup when tenant rollback remains pending", async () => {
    const previousTimeoutSeconds = testConfig.defaultTimeoutSeconds
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-bounded-transactional-tenant-cleanup")
    const rollbackEntered = deferred()
    const allowRollback = deferred()
    const resumeTimedOutBody = deferred()
    const successorStarted = deferred()
    const allowSuccessorFinish = deferred()
    let successorProgressError

    configuration.getDatabaseConfiguration().projectTenant.driver = ControlledTransactionalTenantDriver
    controlledTransactionRollback = {
      entered: rollbackEntered,
      error: new Error("controlled emergency rollback failure"),
      proceed: allowRollback
    }

    try {
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE attempt_rows(value varchar(255) NOT NULL)")
        })
      })
      configureTests({defaultTimeoutSeconds: 1})

      const runner = new TestRunner({configuration, testFiles: []})
      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "times out before its tenant rollback can finish": {
            args: {databaseCleaning: {transaction: true}, timeoutSeconds: 0.01},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await resumeTimedOutBody.promise
            }
          },
          "starts after the bounded emergency cleanup deadline": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              successorStarted.resolve(undefined)
              await allowSuccessorFinish.promise
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
            }
          }
        }
      }
      const runPromise = runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})

      await rollbackEntered.promise
      try {
        await timeout({timeout: 1000}, async () => await successorStarted.promise)
      } catch (error) {
        successorProgressError = error
      } finally {
        allowRollback.resolve(undefined)
        resumeTimedOutBody.resolve(undefined)
        allowSuccessorFinish.resolve(undefined)
      }
      await runPromise

      expect(successorProgressError).toBeUndefined()
      expect(runner._failedTests).toBe(2)
      expect(runner._failedTestDetails.some((failure) => failure.error.message === "controlled emergency rollback failure")).toBe(true)
      expect(runner._failedTestDetails.some((failure) => failure.fullDescription.startsWith("<transactional tenant emergency cleanup failure"))).toBe(true)
      expect(configuration.getDatabasePool("projectTenant").getDebugSnapshot().inUseCount).toBe(0)
    } finally {
      allowRollback.resolve(undefined)
      resumeTimedOutBody.resolve(undefined)
      allowSuccessorFinish.resolve(undefined)
      controlledTransactionRollback = undefined
      configureTests({defaultTimeoutSeconds: previousTimeoutSeconds})
      await cleanup()
    }
  })
})
