// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerBrowser from "../../src/environment-handlers/browser.js"
import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

class BrowserDummyCleaningTestRunner extends TestRunner {
  /**
   * Runs constructor.
   * @param {object} [args] - Options.
   * @param {boolean} [args.brokerCleanupFailure] - Whether broker cleanup should fail.
   * @param {string[]} [args.databaseIdentifiers] - Observed database identifiers.
   * @param {string[]} [args.delayedStartIdentifiers] - Transaction starts to delay.
   * @param {string[]} [args.discardFailureIdentifiers] - Discards that should fail.
   * @param {string[]} [args.rollbackFailureIdentifiers] - Rollbacks that should fail.
   * @param {string[]} [args.startFailureIdentifiers] - Transaction starts that should fail.
   */
  constructor({brokerCleanupFailure = false, databaseIdentifiers = ["default"], delayedStartIdentifiers = [], discardFailureIdentifiers = [], rollbackFailureIdentifiers = [], startFailureIdentifiers = []} = {}) {
    const databaseLifecycle = {discards: [], rollbacks: [], starts: []}
    /** @type {Map<string, () => void>} */
    const discardResolvers = new Map()
    /** @type {Map<string, () => void>} */
    const startResolvers = new Map()
    /** @type {Record<string, import("../../src/database/drivers/base.js").default>} */
    const dbs = {}

    for (const databaseIdentifier of databaseIdentifiers) {
      dbs[databaseIdentifier] = /** @type {import("../../src/database/drivers/base.js").default} */ ({
        rollbackTransaction: async () => {
          databaseLifecycle.rollbacks.push(databaseIdentifier)
          if (rollbackFailureIdentifiers.includes(databaseIdentifier)) {
            throw new Error(`expected ${databaseIdentifier} rollback failure`)
          }
        },
        startTransaction: async () => {
          databaseLifecycle.starts.push(databaseIdentifier)
          if (startFailureIdentifiers.includes(databaseIdentifier)) {
            throw new Error(`expected ${databaseIdentifier} start failure`)
          }

          if (delayedStartIdentifiers.includes(databaseIdentifier)) {
            await new Promise((resolve) => startResolvers.set(databaseIdentifier, resolve))
          }
        }
      })
    }
    class BrowserDummyConfiguration extends Configuration {
      async ensureConnections(_args, callback) {
        this.assertDatabaseAccessAllowed()
        return await callback(dbs)
      }
    }
    const configuration = new BrowserDummyConfiguration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerBrowser(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    super({configuration, testFiles: []})
    this.afterAllCalls = 0
    this.afterAllDatabaseCalls = 0
    this.brokerCleanupFailure = brokerCleanupFailure
    this.databaseLifecycle = databaseLifecycle
    this.discardFailureIdentifiers = discardFailureIdentifiers
    this.discardResolvers = discardResolvers
    this.startResolvers = startResolvers
    this.stopSharedTransactionBrokerCalls = 0
    this.successorTestCalls = 0
    this.timedOutBodyCalls = 0
    this.transactionalTenantCleanupCalls = 0
    this.truncateCalls = 0
  }

  async cleanupTransactionalTenants() {
    this.transactionalTenantCleanupCalls++
  }

  async discardBrowserDummyConnection(databaseIdentifier, _db) {
    this.databaseLifecycle.discards.push(databaseIdentifier)
    const resolveDiscard = this.discardResolvers.get(databaseIdentifier)

    if (resolveDiscard) resolveDiscard()
    if (this.discardFailureIdentifiers.includes(databaseIdentifier)) {
      throw new Error(`expected ${databaseIdentifier} discard failure`)
    }
  }

  async stopSharedTransactionBroker(_registration) {
    this.stopSharedTransactionBrokerCalls++
    if (this.brokerCleanupFailure && this.stopSharedTransactionBrokerCalls > 1) {
      throw new Error("expected broker cleanup failure")
    }
  }

  /** @param {string} identifier - Database identifier. */
  resolveStart(identifier) {
    const resolve = this.startResolvers.get(identifier)

    if (!resolve) throw new Error(`No delayed start for ${identifier}`)
    resolve()
  }

  /** @param {string} identifier - Database identifier. @returns {Promise<void>} - Resolves after discard. */
  async waitForDiscard(identifier) {
    if (this.databaseLifecycle.discards.includes(identifier)) return
    await new Promise((resolve) => this.discardResolvers.set(identifier, resolve))
  }

  /**
   * Runs a callback through the browser test-runner mode.
   * @param {() => Promise<void>} callback - Browser-mode callback.
   * @returns {Promise<void>} - Resolves after the callback.
   */
  async runAsBrowser(callback) {
    const previousBrowserTests = process.env.VELOCIOUS_BROWSER_TESTS

    process.env.VELOCIOUS_BROWSER_TESTS = "true"

    try {
      await callback()
    } finally {
      if (previousBrowserTests === undefined) {
        delete process.env.VELOCIOUS_BROWSER_TESTS
      } else {
        process.env.VELOCIOUS_BROWSER_TESTS = previousBrowserTests
      }
    }
  }

  async truncateDatabases(_dbs) {
    this.truncateCalls++
  }

  /**
   * Runs a dummy-tagged lifecycle through the browser path.
   * @param {{transaction: boolean, truncate?: boolean}} databaseCleaning - Cleaning metadata.
   * @param {() => Promise<void>} callback - Test lifecycle callback.
   * @returns {Promise<void>} - Resolves after the lifecycle.
   */
  async runBrowserLifecycle(databaseCleaning, callback) {
    await this.runAsBrowser(async () => {
      await this.runWithDummyIfNeeded({databaseCleaning, tags: ["dummy"]}, callback)
    })
  }

  /**
   * Runs one timed-out browser test followed by a successor.
   * @param {object} [args] - Options.
   * @param {boolean} [args.afterAllFailure] - Whether afterAll should fail.
   * @param {{transaction: boolean, truncate?: boolean}} [args.databaseCleaning] - Cleaning metadata.
   * @param {() => Promise<void>} [args.testFunction] - Timed-out test body.
   * @returns {Promise<void>} - Resolves after the timed-out attempt is handled.
   */
  async runTimedOutBrowserTest({afterAllFailure = false, databaseCleaning = {transaction: true}, testFunction} = {}) {
    const tests = {
      args: {},
      afterAlls: [{callback: async ({configuration}) => {
        this.afterAllCalls++
        await configuration.ensureConnections({name: "Browser dummy cleaning afterAll"}, async () => {
          this.afterAllDatabaseCalls++
        })
        if (afterAllFailure) throw new Error("expected afterAll failure")
      }}],
      afterEaches: [],
      beforeAlls: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "times out": {
          args: {databaseCleaning, tags: ["dummy"], timeoutSeconds: 0.01},
          function: testFunction || (async () => {
            this.timedOutBodyCalls++
            await new Promise(() => {})
          })
        },
        "would run afterward": {
          args: {},
          function: async () => { this.successorTestCalls++ }
        }
      }
    }

    await this.runAsBrowser(async () => {
      await this.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})
    })
  }
}

describe("TestRunner browser dummy cleaning", () => {
  it("leaves database cleanup to transaction rollback", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()
    let callbackRuns = 0

    await testRunner.runBrowserLifecycle({transaction: true}, async () => { callbackRuns++ })

    expect(callbackRuns).toEqual(1)
    expect(testRunner.databaseLifecycle.rollbacks).toEqual(["default"])
    expect(testRunner.databaseLifecycle.starts).toEqual(["default"])
    expect(testRunner.truncateCalls).toEqual(0)
  })

  it("honors explicit no-cleaning metadata", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()

    await testRunner.runBrowserLifecycle({transaction: false, truncate: false}, async () => {})

    expect(testRunner.truncateCalls).toEqual(0)
    expect(testRunner.databaseLifecycle.rollbacks).toEqual([])
    expect(testRunner.databaseLifecycle.starts).toEqual([])
  })

  it("truncates around transaction-incompatible tests", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()

    await testRunner.runBrowserLifecycle({transaction: false, truncate: true}, async () => {})

    expect(testRunner.truncateCalls).toEqual(2)
    expect(testRunner.databaseLifecycle.rollbacks).toEqual([])
    expect(testRunner.databaseLifecycle.starts).toEqual([])
  })

  it("rolls back transaction cleaning when the callback fails", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()
    let caughtError

    try {
      await testRunner.runBrowserLifecycle({transaction: true}, async () => {
        throw new Error("expected callback failure")
      })
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(Error)
    expect(caughtError.message).toEqual("expected callback failure")
    expect(testRunner.databaseLifecycle.rollbacks).toEqual(["default"])
    expect(testRunner.databaseLifecycle.starts).toEqual(["default"])
  })

  it("preserves callback failures while continuing every rollback", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner({
      databaseIdentifiers: ["default", "secondary"],
      rollbackFailureIdentifiers: ["secondary"]
    })
    let caughtError

    try {
      await testRunner.runBrowserLifecycle({transaction: true}, async () => {
        throw new Error("expected callback failure")
      })
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(AggregateError)
    expect(caughtError.cause.message).toEqual("expected callback failure")
    expect(caughtError.errors.map((error) => error.message)).toEqual([
      "expected callback failure",
      "expected secondary rollback failure"
    ])
    expect(testRunner.databaseLifecycle.rollbacks).toEqual(["secondary", "default"])
  })

  it("quarantines browser transactions after timeout grace expires", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()

    await testRunner.runTimedOutBrowserTest()

    expect(testRunner.databaseLifecycle.discards).toEqual(["default"])
    expect(testRunner.databaseLifecycle.rollbacks).toEqual([])
    expect(testRunner.getFailedTests()).toEqual(1)
    expect(testRunner.afterAllCalls).toEqual(1)
    expect(testRunner.afterAllDatabaseCalls).toEqual(1)
    expect(testRunner.successorTestCalls).toEqual(0)
    expect(testRunner.transactionalTenantCleanupCalls).toEqual(1)
  })

  it("quarantines truncation-owned browser connections after timeout grace expires", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()

    await testRunner.runTimedOutBrowserTest({databaseCleaning: {transaction: false, truncate: true}})

    expect(testRunner.databaseLifecycle.discards).toEqual(["default"])
    expect(testRunner.databaseLifecycle.rollbacks).toEqual([])
    expect(testRunner.truncateCalls).toEqual(1)
    expect(testRunner.getFailedTests()).toEqual(1)
    expect(testRunner.successorTestCalls).toEqual(0)
  })

  it("tracks every transaction startup before awaiting any of them", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner({
      databaseIdentifiers: ["default", "secondary"],
      delayedStartIdentifiers: ["default"]
    })

    await testRunner.runTimedOutBrowserTest()

    const discardPromise = testRunner.waitForDiscard("default")

    testRunner.resolveStart("default")
    await discardPromise
    await new Promise((resolve) => setImmediate(resolve))

    expect(testRunner.databaseLifecycle.starts).toEqual(["default", "secondary"])
    expect(testRunner.databaseLifecycle.discards.sort()).toEqual(["default", "secondary"])
    expect(testRunner.databaseLifecycle.rollbacks).toEqual([])
    expect(testRunner.successorTestCalls).toEqual(0)
    expect(testRunner.timedOutBodyCalls).toEqual(0)
    expect(testRunner.getFailedTests()).toEqual(1)
  })

  it("rejects replacement connection checkouts from a resumed timed-out callback", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()
    /** @type {() => void} */
    let resumeBody = () => {}
    const bodyBarrier = new Promise((resolve) => { resumeBody = resolve })
    /** @type {() => void} */
    let finishBody = () => {}
    const bodyFinished = new Promise((resolve) => { finishBody = resolve })
    let lateDatabaseCallbackCalls = 0
    let lateDatabaseError

    await testRunner.runTimedOutBrowserTest({
      testFunction: async () => {
        testRunner.timedOutBodyCalls++
        await bodyBarrier

        try {
          await testRunner.getConfiguration().ensureConnections(async () => { lateDatabaseCallbackCalls++ })
        } catch (error) {
          lateDatabaseError = error
        } finally {
          finishBody()
        }
      }
    })

    expect(testRunner.timedOutBodyCalls).toEqual(1)
    resumeBody()
    await bodyFinished

    expect(lateDatabaseCallbackCalls).toEqual(0)
    expect(lateDatabaseError).toBeInstanceOf(Error)
    expect(lateDatabaseError.message).toEqual("Database access is no longer allowed for this test attempt")
  })

  it("records a lifecycle rejection that arrives after timeout grace", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()
    /** @type {() => void} */
    let resumeBody = () => {}
    const bodyBarrier = new Promise((resolve) => { resumeBody = resolve })
    /** @type {() => void} */
    let finishBody = () => {}
    const bodyFinished = new Promise((resolve) => { finishBody = resolve })

    await testRunner.runTimedOutBrowserTest({
      testFunction: async () => {
        await bodyBarrier
        finishBody()
        throw new AggregateError([], "expected late lifecycle failure")
      }
    })

    resumeBody()
    await bodyFinished
    await new Promise((resolve) => setImmediate(resolve))

    expect(testRunner.getFailedTests()).toEqual(2)
    expect(testRunner.getFailedTestDetails()[1].error.message).toEqual("expected late lifecycle failure")
  })

  it("continues emergency cleanup after a prompt browser quarantine failure", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner({discardFailureIdentifiers: ["default"]})

    await testRunner.runTimedOutBrowserTest()

    const failedError = testRunner.getFailedTestDetails()[0].error

    expect(failedError).toBeInstanceOf(AggregateError)
    expect(failedError.message).toEqual("Test timeout and emergency cleanup failed")
    expect(testRunner.databaseLifecycle.discards).toEqual(["default"])
    expect(testRunner.getFailedTests()).toEqual(1)
    expect(testRunner.transactionalTenantCleanupCalls).toEqual(1)
  })

  it("continues emergency cleanup after broker shutdown fails", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner({brokerCleanupFailure: true})

    await testRunner.runTimedOutBrowserTest()

    const failedError = testRunner.getFailedTestDetails()[0].error

    expect(failedError).toBeInstanceOf(AggregateError)
    expect(failedError.message).toEqual("Test timeout and emergency cleanup failed")
    expect(testRunner.databaseLifecycle.discards).toEqual(["default"])
    expect(testRunner.transactionalTenantCleanupCalls).toEqual(1)
  })

  it("records afterAll failure while preserving standard failed-test reporting", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner()

    await testRunner.runTimedOutBrowserTest({afterAllFailure: true})

    expect(testRunner.getFailedTests()).toEqual(2)
    expect(testRunner.getFailedTestDetails()[1].error.message).toEqual("expected afterAll failure")
    expect(testRunner.afterAllCalls).toEqual(1)
  })

  it("quarantines rollback failures without running a successor test", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner({rollbackFailureIdentifiers: ["default"]})
    const tests = {
      args: {},
      afterAlls: [],
      afterEaches: [],
      beforeAlls: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "fails rollback": {
          args: {databaseCleaning: {transaction: true}, tags: ["dummy"]},
          function: async () => {}
        },
        "would run afterward": {
          args: {},
          function: async () => { testRunner.successorTestCalls++ }
        }
      }
    }

    await testRunner.runAsBrowser(async () => {
      await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})
    })

    expect(testRunner.databaseLifecycle.discards).toEqual(["default"])
    expect(testRunner.databaseLifecycle.rollbacks).toEqual(["default"])
    expect(testRunner.getFailedTests()).toEqual(1)
    expect(testRunner.successorTestCalls).toEqual(0)
  })

  it("quarantines transaction startup failures without running a successor test", async () => {
    const testRunner = new BrowserDummyCleaningTestRunner({
      databaseIdentifiers: ["default", "secondary"],
      startFailureIdentifiers: ["default", "secondary"]
    })
    const tests = {
      args: {},
      afterAlls: [],
      afterEaches: [],
      beforeAlls: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "fails transaction startup": {
          args: {databaseCleaning: {transaction: true}, tags: ["dummy"]},
          function: async () => {}
        },
        "would run afterward": {
          args: {},
          function: async () => { testRunner.successorTestCalls++ }
        }
      }
    }

    await testRunner.runAsBrowser(async () => {
      await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})
    })

    const failedError = testRunner.getFailedTestDetails()[0].error

    expect(failedError).toBeInstanceOf(AggregateError)
    expect(failedError.errors.map((error) => error.message)).toEqual([
      "expected default start failure",
      "expected secondary start failure"
    ])
    expect(testRunner.databaseLifecycle.discards).toEqual(["secondary", "default"])
    expect(testRunner.databaseLifecycle.rollbacks).toEqual([])
    expect(testRunner.getFailedTests()).toEqual(1)
    expect(testRunner.successorTestCalls).toEqual(0)
  })
})
