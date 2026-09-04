// @ts-check

import { TestDatabaseAccessRevokedError } from "../environment-handlers/base.js"
import { clearDeliveries } from "../mailer.js"
import restArgsError from "../utils/rest-args-error.js"
import { testConfig } from "./test.js"

/**
 * Marks one whole-lifecycle timeout while its underlying promise keeps running.
 * @typedef {Error & {velociousTestTimeout?: true}} TestTimeoutError
 */

/**
 * Runs one promise with a lifecycle timeout.
 * @param {Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} promise - Promise or value.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @param {string} testDescription - Test description.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Lifecycle result.
 */
function runWithTimeout(promise, timeoutMs, testDescription) {
  const timeoutSeconds = (timeoutMs / 1000).toFixed(3).replace(/\.?0+$/, "")
  /** @type {TestTimeoutError} */
  const timeoutError = new Error(`Timed out after ${timeoutSeconds}s: ${testDescription}`)
  timeoutError.velociousTestTimeout = true

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(timeoutError), timeoutMs)

    Promise.resolve(promise).then((result) => {
      clearTimeout(timeout)
      resolve(result)
    }).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

/**
 * Waits for detached lifecycle cleanup up to the timeout grace period.
 * @param {Promise<ReturnType<typeof JSON.parse>>} lifecycle - Detached lifecycle promise.
 * @param {number} graceMs - Maximum wait.
 * @returns {Promise<{settled: false} | {settled: true, status: "fulfilled"} | {settled: true, status: "rejected", reason: ReturnType<typeof JSON.parse>}>} - Settlement outcome.
 */
function awaitSettledOrGrace(lifecycle, graceMs) {
  return new Promise((resolve) => {
    let settled = false
    const graceTimer = setTimeout(() => {
      if (settled) return

      settled = true
      resolve({settled: false})
    }, graceMs)

    Promise.resolve(lifecycle).then(
      () => {
        if (settled) return

        settled = true
        clearTimeout(graceTimer)
        resolve({settled: true, status: "fulfilled"})
      },
      (reason) => {
        if (settled) return

        settled = true
        clearTimeout(graceTimer)
        resolve({settled: true, status: "rejected", reason})
      }
    )
  })
}

/**
 * Checks whether a late lifecycle stopped only because its attempt access was revoked.
 * @param {ReturnType<typeof JSON.parse>} error - Lifecycle rejection.
 * @returns {boolean} - Whether every contained error is expected revocation.
 */
function isTestDatabaseAccessRevocation(error) {
  if (error instanceof TestDatabaseAccessRevokedError) return true
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every((nestedError) => isTestDatabaseAccessRevocation(nestedError))
  }

  return false
}

export default class VelociousAttemptExecutor {
  /**
   * Creates an executor for framework-owned attempt lifecycle work.
   * @param {object} args - Constructor arguments.
   * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
   */
  constructor({testRunner, ...restArgs}) {
    restArgsError(restArgs)
    this.testRunner = testRunner
  }

  /**
   * Executes exactly one complete Velocious-owned test attempt.
   * @param {object} args - Attempt arguments.
   * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.afterEaches - Cleanup hooks.
   * @param {number} args.attemptNumber - One-based attempt number.
   * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.beforeEaches - Setup hooks.
   * @param {string[]} args.descriptions - Parent descriptions.
   * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
   * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
   * @param {string} args.testDescription - Test description.
   * @param {number} [args.timeoutMs] - Whole-lifecycle timeout.
   * @returns {Promise<{abortRemainingTests: boolean, consoleOutput: string, error: ReturnType<typeof JSON.parse>, failed: boolean}>} - Attempt outcome.
   */
  async execute({afterEaches, attemptNumber, beforeEaches, descriptions, testArgs, testData, testDescription, timeoutMs, ...restArgs}) {
    restArgsError(restArgs)
    const testRunner = this.testRunner
    /** @type {ReturnType<typeof JSON.parse>} */
    let caughtError
    let failed = false
    /** @type {Promise<ReturnType<typeof JSON.parse>> | undefined} */
    let testLifecycle
    /** @type {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} */
    let testSharedConnectionRegistrations = []
    let testSharedConnectionsActive = false
    /** @type {import("./test-runner.js").SharedTransactionBrokerRegistration | undefined} */
    let sharedTransactionBrokerRegistration
    /** @type {import("./test-runner.js").SharedTransactionBrokerRegistration | undefined} */
    let sharedTransactionBrokerPreparation
    /** @type {import("./test-runner.js").TransactionalTenantRegistration[]} */
    const transactionalTenantRegistrations = []
    /** @type {import("./test-runner.js").BrowserDummyConnectionRegistration[]} */
    const browserDummyConnectionRegistrations = []
    const testDatabaseAccessScope = {revoked: false}
    /** @type {Set<Error>} */
    const recordedTimeoutCleanupErrors = new Set()
    let abortRemainingTests = false
    let attemptTimedOut = false
    /** @type {string} */
    let consoleOutput
    testArgs.registerTransactionalTenant = async (args) => {
      await testRunner.registerTransactionalTenant(args, transactionalTenantRegistrations)
    }
    const stopConsoleCapture = testRunner.startConsoleCapture({
      passthrough: testConfig.consoleOutput === "live"
    })
    const profiler = testRunner._profiler
    const profileAttempt = profiler?.startAttempt({
      descriptions,
      attemptNumber,
      testData,
      testDescription
    })

    try {
      const runLifecycleCallback = async () => await testRunner.runWithDummyIfNeeded(testArgs, async () => {
        const useTransaction = testArgs.databaseCleaning?.transaction === true
        const shouldTruncate = testArgs.databaseCleaning?.truncate ?? !useTransaction
        const useSharedTestConnections = useTransaction || testArgs.type == "request"
        const useTestConnections = useSharedTestConnections || shouldTruncate
        const runTestAttempt = async () => {
          if (useSharedTestConnections) {
            testSharedConnectionRegistrations = testRunner.activateTestSharedConnections()
            testSharedConnectionsActive = true
          }
          /** @type {ReturnType<typeof JSON.parse>[]} */
          const lifecycleErrors = []
          let runCleanupHooks = false

          try {
            if (useSharedTestConnections) {
              sharedTransactionBrokerPreparation = await testRunner.prepareSharedTransactionBroker()
            }
            runCleanupHooks = true

            clearDeliveries()
            await this.runBeforeEaches({beforeEaches, testArgs, testData})

            if (useSharedTestConnections) {
              const activeConnections = testRunner.sharedTransactionConnections({transactionsOnly: true})
              if (sharedTransactionBrokerPreparation && !testRunner.sharedTransactionBrokerMatchesConnections(sharedTransactionBrokerPreparation, activeConnections)) {
                testRunner.clearTestSharedConnections(testSharedConnectionRegistrations)
                testSharedConnectionRegistrations = []
                testSharedConnectionsActive = false
              }

              sharedTransactionBrokerRegistration = await testRunner.startSharedTransactionBroker(sharedTransactionBrokerPreparation, activeConnections)
              sharedTransactionBrokerPreparation = undefined
              if (sharedTransactionBrokerRegistration && !testSharedConnectionsActive) {
                testSharedConnectionRegistrations = testRunner.activateTestSharedConnections()
                testSharedConnectionsActive = true
              }
            }

            testRunner._lastTestContext = {
              fullDescription: testRunner.buildFullDescription(descriptions, testDescription),
              filePath: testData.filePath ?? "<unknown>",
              line: testData.line ?? 0
            }
            await testRunner.runProfileSpan({phase: "test body", filePath: testData.ownerFilePath ?? testData.filePath}, async () => {
              await testData.function(testArgs)
            })
          } catch (error) {
            lifecycleErrors.push(error)
          }

          if (runCleanupHooks) {
            try {
              await testRunner.getConfiguration().awaitPendingBroadcasts()
            } catch (error) {
              lifecycleErrors.push(error)
            }

            try {
              if (testSharedConnectionsActive) {
                testRunner.clearTestSharedConnections(testSharedConnectionRegistrations)
                testSharedConnectionRegistrations = []
                testSharedConnectionsActive = false
              }
            } catch (error) {
              lifecycleErrors.push(error)
            }

            try {
              await testRunner.stopSharedTransactionBroker(sharedTransactionBrokerRegistration || sharedTransactionBrokerPreparation)
              sharedTransactionBrokerRegistration = undefined
              sharedTransactionBrokerPreparation = undefined
            } catch (error) {
              lifecycleErrors.push(error)
            }

            try {
              await this.runAfterEaches({afterEaches, testArgs, testData})
            } catch (error) {
              lifecycleErrors.push(error)
            }

            try {
              await testRunner.cleanupTransactionalTenants(transactionalTenantRegistrations)
            } catch (error) {
              lifecycleErrors.push(error)
            }
          }

          if (testSharedConnectionsActive) {
            try {
              testRunner.clearTestSharedConnections(testSharedConnectionRegistrations)
            } catch (error) {
              lifecycleErrors.push(error)
            }
            testSharedConnectionsActive = false
          }

          if (lifecycleErrors.length == 1) throw lifecycleErrors[0]
          if (lifecycleErrors.length > 1) {
            throw new AggregateError(lifecycleErrors, "Test lifecycle and cleanup failed", {cause: lifecycleErrors[0]})
          }
        }

        if (useTestConnections) {
          await testRunner.getConfiguration().ensureConnections({name: `Test: ${testDescription}`}, runTestAttempt)
        } else {
          await runTestAttempt()
        }
      }, browserDummyConnectionRegistrations)
      const lifecycleCallback = async () => await testRunner.getConfiguration().runWithTestDatabaseAccessScope(testDatabaseAccessScope, runLifecycleCallback)
      testLifecycle = profileAttempt && profiler
        ? profiler.runAttempt(profileAttempt, lifecycleCallback)
        : lifecycleCallback()

      if (timeoutMs !== undefined) {
        await runWithTimeout(testLifecycle, timeoutMs, testDescription)
      } else {
        await testLifecycle
      }
    } catch (error) {
      failed = true
      caughtError = error
      const timedOut = Boolean(/** @type {TestTimeoutError} */ (error)?.velociousTestTimeout)
      attemptTimedOut = timedOut

      if (timedOut && testLifecycle) {
        const emergencyCleanupErrors = []

        if (profileAttempt && profiler) profiler.finishAttempt(profileAttempt, "timed-out")
        const lifecycleOutcome = await awaitSettledOrGrace(testLifecycle, timeoutMs ?? 60000)

        if (lifecycleOutcome.settled && lifecycleOutcome.status === "rejected") {
          emergencyCleanupErrors.push(lifecycleOutcome.reason)
        }

        if (!lifecycleOutcome.settled) {
          testDatabaseAccessScope.revoked = true
          void testLifecycle.catch((cleanupError) => {
            if (isTestDatabaseAccessRevocation(cleanupError)) return
            testRunner.recordTimeoutCleanupFailure(cleanupError, "test lifecycle", recordedTimeoutCleanupErrors)
          })
          const quarantine = testRunner.quarantineBrowserDummyConnections(browserDummyConnectionRegistrations)
          const quarantineOutcome = await awaitSettledOrGrace(quarantine, timeoutMs ?? 60000)
          const usesBrowserTransactions = testArgs.databaseCleaning?.transaction === true
          const usesBrowserTruncation = testArgs.databaseCleaning?.truncate ?? !usesBrowserTransactions

          abortRemainingTests = testRunner.isBrowserTestMode()
            && testRunner.hasTag(testArgs, "dummy")
            && (usesBrowserTransactions || usesBrowserTruncation)

          if (quarantineOutcome.settled && quarantineOutcome.status === "rejected") {
            emergencyCleanupErrors.push(quarantineOutcome.reason)
          } else if (!quarantineOutcome.settled) {
            void quarantine.catch((cleanupError) => {
              testRunner.recordTimeoutCleanupFailure(cleanupError, "browser dummy connection quarantine", recordedTimeoutCleanupErrors)
            })
          }
        }

        try {
          if (testSharedConnectionsActive) {
            testRunner.clearTestSharedConnections(testSharedConnectionRegistrations)
            testSharedConnectionRegistrations = []
            testSharedConnectionsActive = false
          }
        } catch (cleanupError) {
          emergencyCleanupErrors.push(cleanupError)
        }

        const brokerCleanup = testRunner.stopSharedTransactionBroker(sharedTransactionBrokerRegistration || sharedTransactionBrokerPreparation)
        const brokerCleanupOutcome = await awaitSettledOrGrace(brokerCleanup, timeoutMs ?? 60000)

        if (brokerCleanupOutcome.settled && brokerCleanupOutcome.status === "rejected") {
          emergencyCleanupErrors.push(brokerCleanupOutcome.reason)
        } else if (!brokerCleanupOutcome.settled) {
          void brokerCleanup.catch((cleanupError) => {
            testRunner.recordTimeoutCleanupFailure(cleanupError, "shared transaction broker", recordedTimeoutCleanupErrors)
          })
        }
        sharedTransactionBrokerRegistration = undefined
        sharedTransactionBrokerPreparation = undefined
        const emergencyCleanup = testRunner.cleanupTransactionalTenants(transactionalTenantRegistrations, {discard: true})
        const emergencyCleanupOutcome = await awaitSettledOrGrace(emergencyCleanup, timeoutMs ?? 60000)

        if (emergencyCleanupOutcome.settled && emergencyCleanupOutcome.status === "rejected") {
          emergencyCleanupErrors.push(emergencyCleanupOutcome.reason)
        } else if (!emergencyCleanupOutcome.settled) {
          void emergencyCleanup.catch((cleanupError) => {
            testRunner.recordTimeoutCleanupFailure(cleanupError, "transactional tenant", recordedTimeoutCleanupErrors)
          })
        }

        if (emergencyCleanupErrors.length > 0) {
          caughtError = new AggregateError(
            [caughtError, ...emergencyCleanupErrors],
            "Test timeout and emergency cleanup failed",
            {cause: caughtError}
          )
        }
      }

      if (browserDummyConnectionRegistrations.some((registration) => registration.quarantined)) {
        testDatabaseAccessScope.revoked = true
        abortRemainingTests = true
      }
    } finally {
      testDatabaseAccessScope.revoked = true
      consoleOutput = stopConsoleCapture()

      if (profileAttempt && profiler) {
        profiler.finishAttempt(profileAttempt, failed
          ? (attemptTimedOut ? "timed-out" : "failed")
          : "passed")
      }
    }

    return {
      abortRemainingTests,
      consoleOutput,
      error: caughtError,
      failed
    }
  }

  /**
   * Runs before-each hooks in inherited declaration order.
   * @param {object} args - Hook arguments.
   * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.beforeEaches - Setup hooks.
   * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
   * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
   * @returns {Promise<void>} - Resolves after all setup hooks complete.
   */
  async runBeforeEaches({beforeEaches, testArgs, testData}) {
    for (const hook of beforeEaches) {
      await this.testRunner.runProfileSpan({
        phase: "beforeEach",
        declarationIndex: hook.declarationIndex,
        declarationScopeId: hook.declarationScopeId,
        filePath: hook.ownerFilePath
      }, async () => {
        await hook.callback({configuration: this.testRunner.getConfiguration(), testArgs, testData})
      })
    }
  }

  /**
   * Runs every after-each hook while preserving all failures.
   * @param {object} args - Hook arguments.
   * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.afterEaches - Cleanup hooks.
   * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
   * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
   * @returns {Promise<void>} - Resolves after every cleanup hook settles.
   */
  async runAfterEaches({afterEaches, testArgs, testData}) {
    /** @type {ReturnType<typeof JSON.parse>[]} */
    const errors = []

    for (const hook of afterEaches) {
      try {
        await this.testRunner.runProfileSpan({
          phase: "afterEach",
          declarationIndex: hook.declarationIndex,
          declarationScopeId: hook.declarationScopeId,
          filePath: hook.ownerFilePath
        }, async () => {
          await hook.callback({configuration: this.testRunner.getConfiguration(), testArgs, testData})
        })
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length == 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, "Multiple afterEach hooks failed", {cause: errors[0]})
    }
  }
}
