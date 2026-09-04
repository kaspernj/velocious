// @ts-check

import fs from "node:fs/promises"
import path from "path"
import {AsyncLocalStorage} from "node:async_hooks"
import {createTestContext, defaultTestContext} from "@velocious/testing"
import {TestRunner as PackageTestRunner} from "@velocious/testing/runner"
import Application from "../../src/application.js"
import RequestClient from "./request-client.js"
import picocolors from "picocolors"
import restArgsError from "../utils/rest-args-error.js"
import {testConfig} from "./test.js"
import {fileURLToPath, pathToFileURL} from "url"
import SharedTransactionBroker from "./shared-transaction-broker.js"
import { SHARED_TRANSACTION_BROKER_ENV } from "./shared-transaction-proxy-driver.js"
import VelociousAttemptExecutor from "./velocious-attempt-executor.js"
import VelociousRunnerReporter, {AbortRemainingTestsError} from "./velocious-runner-reporter.js"
import VelociousSuiteHookExecutor from "./velocious-suite-hook-executor.js"
import VelociousTestArguments from "./velocious-test-arguments.js"

/** @typedef {typeof defaultTestContext} PackageTestContext */
/** @typedef {(typeof defaultTestContext.registry.suites)[number]} PackageSuiteDeclaration */
/** @typedef {PackageSuiteDeclaration["tests"][number]} PackageTestDeclaration */
/** @typedef {PackageSuiteDeclaration["hooks"]["beforeAll"][number]} PackageHookDeclaration */
/** @typedef {PackageSuiteDeclaration | PackageTestDeclaration | PackageHookDeclaration} PackageRegistration */
/** @typedef {{hadRetries: boolean, options: PackageTestDeclaration["options"], retries: number | undefined}} PackageRetryOptionRestoration */

/**
 * AttemptConsoleOutput type.
 * @typedef {object} AttemptConsoleOutput
 * @property {number} attemptNumber - Attempt number.
 * @property {string} output - Captured console output.
 */
/**
 * TestArgs type.
 * @typedef {object} TestArgs
 * @property {Application} [application] - Application instance for integration tests.
 * @property {RequestClient} [client] - HTTP client for request tests.
 * @property {object} [databaseCleaning] - Database cleanup options for tests.
 * @property {boolean} [databaseCleaning.transaction] - Use transactions to rollback between tests.
 * @property {boolean} [databaseCleaning.truncate] - Truncate tables between tests.
 * @property {boolean} [databaseCleaning.truncateBefore] - Truncate tables before each test, in addition to the default cleanup.
 * @property {boolean} [focus] - Whether this test is focused.
 * @property {() => (void|Promise<void>)} [function] - Test callback function.
 * @property {number} [retry] - Number of retries when a test fails.
 * @property {string[] | string} [tags] - Tags for filtering.
 * @property {number} [timeoutSeconds] - Timeout in seconds for the test.
 * @property {string} [type] - Test type identifier.
 * @property {(args: {databaseIdentifier: string, tenant: object}) => Promise<void>} [registerTransactionalTenant] - Registers one resolved tenant database transaction for this attempt.
 */
/**
 * BrowserDummyConnectionRegistration type.
 * @typedef {object} BrowserDummyConnectionRegistration
 * @property {import("../database/drivers/base.js").default} db - Attempt-owned connection.
 * @property {string} databaseIdentifier - Configured database identifier.
 * @property {Promise<void>} [quarantinePromise] - Shared connection-discard promise.
 * @property {boolean} quarantined - Whether the connection is unsafe to reuse.
 * @property {Promise<void>} [rollbackPromise] - Shared rollback promise.
 * @property {Promise<void>} [startPromise] - Transaction startup promise when transaction cleaning is enabled.
 */
/**
 * TestData type.
 * @typedef {object} TestData
 * @property {TestArgs} args - Arguments passed to the test.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {string} [ownerFilePath] - Deterministic importing test file.
 * @property {(arg: TestArgs) => (void|Promise<void>)} function - Test callback to execute.
 * @property {PackageTestDeclaration} [declaration] - Package declaration.
 */
/**
 * FailedTestDetail type.
 * @typedef {object} FailedTestDetail
 * @property {string} fullDescription - Full test description.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {ReturnType<typeof JSON.parse>} error - Failure error.
 * @property {string} [consoleOutput] - Captured console output while test ran.
 * @property {string} [consoleLogPath] - Saved console log path.
 */
/**
 * Defines this typedef.
 * @typedef {(args: {configuration: import("../configuration.js").default, testArgs: TestArgs, testData: TestData}) => (void|Promise<void>)} AfterBeforeEachCallbackType
 */
/**
 * AfterBeforeEachCallbackObjectType type.
 * @typedef {object} AfterBeforeEachCallbackObjectType
 * @property {AfterBeforeEachCallbackType} callback - Hook callback to execute.
 * @property {number} [declarationIndex] - Hook index within its declaration scope.
 * @property {string} [declarationScopeId] - Opaque profile scope identifier.
 * @property {string} [ownerFilePath] - Deterministic importing test file.
 */
/**
 * Defines this typedef.
 * @typedef {(args: {configuration: import("../configuration.js").default}) => (void|Promise<void>)} BeforeAfterAllCallbackType
 */
/**
 * BeforeAfterAllCallbackObjectType type.
 * @typedef {object} BeforeAfterAllCallbackObjectType
 * @property {BeforeAfterAllCallbackType} callback - Hook callback to execute.
 * @property {number} [declarationIndex] - Hook index within its declaration scope.
 * @property {string} [declarationScopeId] - Opaque profile scope identifier.
 * @property {string} [ownerFilePath] - Deterministic importing test file.
 */
/**
 * TestsArgument type.
 * @typedef {object} TestsArgument
 * @property {TestArgs} args - Arguments inherited by tests in this scope.
 * @property {boolean} [anyTestsFocussed] - Whether any tests in the tree are focused.
 * @property {AfterBeforeEachCallbackObjectType[]} afterEaches - After-each hooks for this scope.
 * @property {BeforeAfterAllCallbackObjectType[]} afterAlls - After-all hooks for this scope.
 * @property {BeforeAfterAllCallbackObjectType[]} beforeAlls - Before-all hooks for this scope.
 * @property {AfterBeforeEachCallbackObjectType[]} beforeEaches - Before-each hooks for this scope.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {string} [ownerFilePath] - Deterministic importing test file.
 * @property {Record<string, TestData>} tests - A unique identifier for the node.
 * @property {Record<string, TestsArgument>} subs - Optional child nodes. Each item is another `Node`, allowing recursion.
 */
/**
 * Marks the error thrown by the attempt timeout so the runner can distinguish
 * detached lifecycle cleanup from an ordinary test failure.
 * @typedef {Error & {velociousTestTimeout?: true}} TestTimeoutError
 */
/**
 * SharedTransactionBrokerRegistration type.
 * @typedef {object} SharedTransactionBrokerRegistration
 * @property {SharedTransactionBroker} broker - Attempt broker and connection coordinator.
 * @property {boolean} environmentPublished - Whether child-process coordinates were published.
 * @property {string | undefined} previousEnvironment - Environment value to restore after publication.
 */
/**
 * TransactionalTenantRegistration type.
 * @typedef {object} TransactionalTenantRegistration
 * @property {Promise<{connection: import("../database/drivers/base.js").default | undefined, error: Error | undefined}> | undefined} [checkoutPromise] - Attempt-owned physical checkout outcome.
 * @property {import("../database/drivers/base.js").default | undefined} connection - Attempt-owned physical connection once checkout resolves.
 * @property {Promise<void> | undefined} [cleanupPromise] - Single cleanup operation shared by emergency and eventual lifecycle cleanup.
 * @property {boolean | undefined} [discardOnCleanup] - Whether timeout emergency cleanup must quarantine this connection.
 * @property {import("../database/pool/base.js").default} pool - Owning logical pool.
 * @property {boolean} revoked - Whether this attempt may still publish the physical registration.
 * @property {string} reuseKey - Resolved physical configuration identity.
 * @property {import("../database/pool/base.js").TestSharedConnectionRegistration | undefined} sharedRegistration - Physical-key shared registration once published.
 */

/**
 * Runs to file slug.
 * @param {string} value - Value to sanitize.
 * @returns {string} - Slug-safe value.
 */
function toFileSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "failed-test"
}

export default class TestRunner {
  /** @type {PackageTestContext} */
  _context

  /**
   * Narrows the runtime value to the documented type.
   * @type {FailedTestDetail[]} */
  _failedTestDetails

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {PackageTestContext} [args.context] - Declaration context.
   * @param {string[] | string} [args.excludeTags] - Tags to exclude.
   * @param {string[] | string} [args.includeTags] - Tags to include.
   * @param {Array<string>} args.testFiles - Test files.
   * @param {Record<string, number[]>} [args.lineFilters] - Line filters by file.
   * @param {RegExp[]} [args.examplePatterns] - Example patterns.
   * @param {import("./test-profiler.js").default} [args.profiler] - Opt-in profiler.
   */
  constructor({configuration, context = defaultTestContext, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, profiler, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error("configuration is required")

    this._configuration = configuration
    this._context = context
    this._sharedTransactionCoordinatorOwnerStorage = new AsyncLocalStorage()
    this._testDatabaseAccessScopeStorage = new AsyncLocalStorage()
    this._excludeTags = this.normalizeTags(excludeTags)
    this._includeTags = this.normalizeTags(includeTags)
    this._testFiles = testFiles
    this._lineFilters = lineFilters || {}
    this._examplePatterns = examplePatterns || []
    this._profiler = profiler
    this._abortRemainingTests = false

    this._failedTests = 0
    this._successfulTests = 0
    this._testsCount = 0
    this._failedTestDetails = []
    /** @type {{fullDescription: string, filePath: string, line: number} | null} */
    this._lastTestContext = null
    /** @type {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} */
    this._testDurations = []
    /** @type {WeakMap<PackageTestDeclaration, {testArgs: TestArgs, testData: TestData}>} */
    this._testCompatibility = new WeakMap()
    /** @type {WeakSet<PackageTestDeclaration>} */
    this._injectedTests = new WeakSet()
    /** @type {WeakSet<PackageTestDeclaration>} */
    this._completedTests = new WeakSet()
    /** @type {WeakMap<PackageTestDeclaration, {descriptions: string[], testDescription: string, fullDescription: string, ownerFilePath: string | undefined, suites: PackageSuiteDeclaration[]}>} */
    this._testMetadata = new WeakMap()
    /** @type {WeakMap<PackageHookDeclaration, {declarationIndex: number, declarationScopeId: string | undefined, ownerFilePath: string | undefined}>} */
    this._hookMetadata = new WeakMap()
    /** @type {WeakMap<PackageTestDeclaration, Map<number, {abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean}>>} */
    this._attemptOutcomes = new WeakMap()
    /** @type {Array<{suite: PackageSuiteDeclaration, phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} */
    this._suiteHookFailures = []
    /** @type {Map<string, PackageTestDeclaration[]>} */
    this._testsByFullName = new Map()
    /** @type {WeakMap<PackageRegistration, string>} */
    this._declarationOwners = new WeakMap()
    /** @type {PackageTestRunner | undefined} */
    this._packageRunner = undefined
    /** @type {import("@velocious/testing/runner").TestRunResult | undefined} */
    this._packageResult = undefined
    /** @type {Map<string, TestData> | undefined} */
    this._legacyFixtureDataByFullName = undefined
    /** @type {{filePath?: string, line?: number}} */
    this._legacyFixtureLocation = {}
    this._attemptExecutor = new VelociousAttemptExecutor({testRunner: this})
    this._runnerReporter = new VelociousRunnerReporter({testRunner: this})
    this._suiteHookExecutor = new VelociousSuiteHookExecutor({testRunner: this})
    this._testArguments = new VelociousTestArguments({testRunner: this})
  }

  /**
   * Gets the package declaration context.
   * @returns {PackageTestContext} - Package declaration context.
   */
  getTestContext() { return this._context }

  /**
   * Runs get configuration.
   * @returns {import("../configuration.js").default} - The configuration.
   */
  getConfiguration() { return this._configuration }

  /**
   * Runs get test files.
   * @returns {string[]} - The test files.
   */
  getTestFiles() { return this._testFiles }

  /**
   * Runs get line filters.
   * @returns {Record<string, number[]>} - Line filters.
   */
  getLineFilters() { return this._lineFilters }

  /**
   * Runs get example patterns.
   * @returns {RegExp[]} - Example patterns.
   */
  getExamplePatterns() { return this._examplePatterns }

  /**
   * Runs a profiler span only when profiling was explicitly enabled.
   * @template T
   * @param {object} metadata - Span metadata.
   * @param {string} metadata.phase - Phase name.
   * @param {number} [metadata.declarationIndex] - Hook declaration index.
   * @param {string} [metadata.declarationScopeId] - Hook declaration scope.
   * @param {string} [metadata.filePath] - Source ownership.
   * @param {() => (T | Promise<T>)} callback - Timed callback.
   * @returns {Promise<T>} - Callback result.
   */
  async runProfileSpan(metadata, callback) {
    if (!this._profiler) return await callback()

    return await this._profiler.runSpan(metadata, callback)
  }

  /**
   * Runs normalize tags.
   * @param {string[] | string | undefined} tags - Tags.
   * @returns {string[]} - Normalized tags.
   */
  normalizeTags(tags) {
    if (!tags) return []

    const values = []
    const rawTags = Array.isArray(tags) ? tags : [tags]

    for (const rawTag of rawTags) {
      if (rawTag === undefined || rawTag === null) continue

      const parts = String(rawTag).split(",")

      for (const part of parts) {
        const trimmed = part.trim()

        if (trimmed) values.push(trimmed)
      }
    }

    return Array.from(new Set(values))
  }

  /**
   * Runs has tag.
   * @param {TestArgs} testArgs - Test args.
   * @param {string} tag - Tag to check for.
   * @returns {boolean} - Whether tag is present.
   */
  hasTag(testArgs, tag) {
    return this.normalizeTags(testArgs?.tags).includes(tag)
  }

  /**
   * Runs is browser test mode.
   * @returns {boolean} - Whether running browser tests.
   */
  isBrowserTestMode() {
    return process.env.VELOCIOUS_BROWSER_TESTS === "true"
  }

  /**
   * Runs run with dummy if needed.
   * @param {TestArgs} testArgs - Test args.
   * @param {() => Promise<void>} callback - Callback to run.
   * @param {BrowserDummyConnectionRegistration[]} [browserDummyConnectionRegistrations] - Attempt-owned browser connections.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runWithDummyIfNeeded(testArgs, callback, browserDummyConnectionRegistrations = []) {
    if (!this.hasTag(testArgs, "dummy")) {
      await callback()
      return
    }

    if (this.isBrowserTestMode()) {
      await this.runBrowserDummy(testArgs, callback, browserDummyConnectionRegistrations)
      return
    }

    await this.runNodeDummy(callback)
  }

  /**
   * Runs run node dummy.
   * @param {() => Promise<void>} callback - Callback to run.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runNodeDummy(callback) {
    const dummyPath = process.env.VELOCIOUS_DUMMY_PATH || this.defaultDummyPath()
    const dummyImport = await import(pathToFileURL(dummyPath).href)
    const Dummy = dummyImport.default

    if (!Dummy?.run) {
      throw new Error(`Dummy helper not found at ${dummyPath}`)
    }

    // Persistent server resources must not inherit an attempt scope that will be revoked.
    await this.getConfiguration().getEnvironmentHandler().runWithCapturedTestDatabaseAccessScope(undefined, async () => {
      await Dummy.run(async () => {})
    })
    this.getConfiguration().assertDatabaseAccessAllowed()
    await callback()
  }

  /**
   * Runs default dummy path.
   * @returns {string} - Default dummy helper path.
   */
  defaultDummyPath() {
    const cwd = path.resolve(process.cwd())
    const normalized = cwd.split(path.sep).join("/")

    if (normalized.endsWith("/spec/dummy")) {
      return path.join(cwd, "index.js")
    }

    return path.join(cwd, "spec/dummy/index.js")
  }

  /**
   * Runs run browser dummy.
   * @param {TestArgs} testArgs - Test args.
   * @param {() => Promise<void>} callback - Callback to run.
   * @param {BrowserDummyConnectionRegistration[]} connectionRegistrations - Attempt-owned browser connections.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runBrowserDummy(testArgs, callback, connectionRegistrations) {
    const useTransaction = testArgs.databaseCleaning?.transaction === true
    const truncate = testArgs.databaseCleaning?.truncate
    const shouldTruncate = truncate === undefined ? !useTransaction : truncate

    if (!useTransaction && !shouldTruncate) {
      await callback()
      return
    }

    await this.getConfiguration().ensureConnections({name: "Test runner browser dummy"}, async (dbs) => {
      const newRegistrations = Object.entries(dbs).map(([databaseIdentifier, db]) => {
        /** @type {BrowserDummyConnectionRegistration} */
        const registration = {
          databaseIdentifier,
          db,
          quarantined: false
        }

        connectionRegistrations.push(registration)

        return registration
      })

      if (shouldTruncate) {
        this.getConfiguration().assertDatabaseAccessAllowed()
        await this.truncateDatabases(dbs)
      }
      /** @type {unknown[]} */
      const lifecycleErrors = []

      try {
        if (useTransaction) {
          const startPromises = newRegistrations.map((registration) => {
            const startPromise = registration.db.startTransaction()

            registration.startPromise = startPromise
            return startPromise
          })
          const startResults = await Promise.allSettled(startPromises)
          const startErrors = startResults
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason)

          if (startErrors.length == 1) throw startErrors[0]
          if (startErrors.length > 1) {
            throw new AggregateError(startErrors, "Browser dummy transaction startup failed", {cause: startErrors[0]})
          }
        }

        this.getConfiguration().assertDatabaseAccessAllowed()
        await callback()
      } catch (error) {
        lifecycleErrors.push(error)
      }

      try {
        await this.rollbackBrowserDummyTransactions(connectionRegistrations)
      } catch (error) {
        if (error instanceof AggregateError) {
          lifecycleErrors.push(...error.errors)
        } else {
          lifecycleErrors.push(error)
        }
      }

      try {
        if (shouldTruncate) {
          this.getConfiguration().assertDatabaseAccessAllowed()
          await this.truncateDatabases(dbs)
        }
      } catch (error) {
        lifecycleErrors.push(error)
      }

      if (lifecycleErrors.length == 1) throw lifecycleErrors[0]
      if (lifecycleErrors.length > 1) {
        throw new AggregateError(lifecycleErrors, "Browser dummy lifecycle and cleanup failed", {cause: lifecycleErrors[0]})
      }
    })
  }

  /**
   * Rolls back every attempt-owned browser transaction exactly once.
   * @param {BrowserDummyConnectionRegistration[]} registrations - Browser connections.
   * @returns {Promise<void>} - Resolves after all rollbacks settle.
   */
  async rollbackBrowserDummyTransactions(registrations) {
    const rollbackResults = await Promise.allSettled([...registrations].reverse().map((registration) => {
      const startPromise = registration.startPromise

      if (!startPromise) return

      registration.rollbackPromise ??= (async () => {
        if (registration.quarantined) return

        try {
          await startPromise
        } catch {
          try {
            await this.quarantineBrowserDummyConnection(registration)
          } catch (quarantineError) {
            throw new Error(`Failed to quarantine browser dummy database after transaction startup failed: ${registration.databaseIdentifier}`, {cause: quarantineError})
          }
          return
        }
        if (registration.quarantined) return

        try {
          await registration.db.rollbackTransaction()
        } catch (rollbackError) {
          try {
            await this.quarantineBrowserDummyConnection(registration)
          } catch (quarantineError) {
            throw new AggregateError(
              [rollbackError, quarantineError],
              `Failed to roll back and quarantine browser dummy database: ${registration.databaseIdentifier}`,
              {cause: quarantineError}
            )
          }
          throw rollbackError
        }
      })()

      return registration.rollbackPromise
    }))
    const errors = rollbackResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason)

    if (errors.length == 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Browser dummy transaction cleanup failed", {cause: errors[0]})
  }

  /**
   * Permanently removes one browser connection that cannot be shared safely.
   * @param {BrowserDummyConnectionRegistration} registration - Browser connection registration.
   * @returns {Promise<void>} - Resolves after the connection is discarded.
   */
  async quarantineBrowserDummyConnection(registration) {
    registration.quarantined = true
    registration.quarantinePromise ??= this.discardBrowserDummyConnection(registration.databaseIdentifier, registration.db)
    await registration.quarantinePromise
  }

  /**
   * Discards one browser dummy connection through its owning pool.
   * @param {string} databaseIdentifier - Configured database identifier.
   * @param {import("../database/drivers/base.js").default} db - Unsafe connection.
   * @returns {Promise<void>} - Resolves after discard.
   */
  async discardBrowserDummyConnection(databaseIdentifier, db) {
    await this.getConfiguration().getDatabasePool(databaseIdentifier).discard(db)
  }

  /**
   * Quarantines all browser connections concurrently.
   * @param {BrowserDummyConnectionRegistration[]} registrations - Browser connection registrations.
   * @returns {Promise<void>} - Resolves after every connection is discarded.
   */
  async quarantineBrowserDummyConnections(registrations) {
    const quarantineResults = await Promise.allSettled(registrations.map(async (registration) => {
      await this.quarantineBrowserDummyConnection(registration)
    }))
    const errors = quarantineResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason)

    if (errors.length == 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Browser dummy connection quarantine failed", {cause: errors[0]})
  }

  /**
   * Runs truncate databases.
   * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Database connections.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async truncateDatabases(dbs) {
    for (const identifier of Object.keys(dbs)) {
      await dbs[identifier].truncateAllTables()
    }
  }

  /**
   * Runs get exclude tag set.
   * @returns {Set<string>} - Exclude tag set.
   */
  getExcludeTagSet() {
    /**
     * Config tags.
     * @type {string[]} */
    const configTags = Array.isArray(testConfig.excludeTags) ? testConfig.excludeTags : []

    return new Set([...this._excludeTags, ...configTags])
  }

  /**
   * Runs build full description.
   * @param {string[]} descriptions - Description stack.
   * @param {string} testDescription - Test description.
   * @returns {string} - Full description.
   */
  buildFullDescription(descriptions, testDescription) {
    const parts = descriptions.concat([testDescription])

    return parts.join(" ").trim()
  }

  /**
   * Runs application.
   * @returns {Promise<Application>} - Resolves with the application.
   */
  async application() {
    if (!this._application) {
      this._application = new Application({
        configuration: this.getConfiguration(),
        // Run request handlers in the main thread (not worker threads) so they
        // resolve DB work to the per-test shared connection set by
        // {@link activateTestSharedConnections}. This lets request-type specs use
        // transaction-based cleaning (their writes land inside the test's
        // transaction and roll back) instead of truncating every table.
        httpServer: {inProcess: true, port: 31006},
        type: "test-runner"
      })

      await this._application.initialize()
      await this._application.startHttpServer()
    }

    return this._application
  }

  /**
   * Registers each non-tenant per-test connection as a dynamic candidate for in-process
   * request sharing. The pool evaluates transaction state when each request is dispatched,
   * so a transaction started or ended during a hook callback takes effect immediately.
   * Inactive and tenant-only connections remain independently pooled. Pair with
   * {@link clearTestSharedConnections} in a finally.
   * @returns {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} - Lifecycle-owned registrations.
   */
  activateTestSharedConnections() {
    const configuration = this.getConfiguration()
    const currentConnections = configuration.getCurrentConnections()
    /** @type {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} */
    const registrations = []

    for (const identifier of Object.keys(currentConnections)) {
      const pool = configuration.getDatabasePool(identifier)

      // Tenant-scoped pools resolve a different connection per request tenant
      // (via runWithTenant), so forcing a single shared connection would break
      // per-request tenant resolution. Only share non-tenant pools; the tenant
      // pool keeps resolving its own connection per request.
      if (pool.getConfiguration().tenantOnly) {
        continue
      }

      const connection = currentConnections[identifier]

      const registration = pool.setTestSharedConnectionProvider(() => {
        return connection.insideTransaction() ? connection : undefined
      })

      if (registration) registrations.push({pool, registration})
    }

    return registrations
  }

  /**
   * Clears the in-process test shared connection on every configured pool. Idempotent and
   * safe to call when none was set.
   * @param {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} [registrations] - Lifecycle-owned registrations to clear conditionally.
   * @returns {void}
   */
  clearTestSharedConnections(registrations) {
    if (registrations) {
      for (const {pool, registration} of registrations) {
        pool.clearTestSharedConnection(registration)
      }
      return
    }

    const configuration = this.getConfiguration()

    for (const identifier of configuration.getDatabaseIdentifiers()) {
      configuration.getDatabasePool(identifier).clearTestSharedConnection()
    }
  }

  /**
   * Checks out and registers one physical tenant transaction for the current attempt.
   * @param {{databaseIdentifier: string, tenant: object}} args - Logical identifier and tenant descriptor.
   * @param {TransactionalTenantRegistration[]} registrations - Current attempt registrations.
   * @returns {Promise<void>}
   */
  async registerTransactionalTenant({databaseIdentifier, tenant, ...restArgs}, registrations) {
    restArgsError(restArgs)
    if (!databaseIdentifier) throw new Error("registerTransactionalTenant requires a databaseIdentifier")
    if (!tenant) throw new Error("registerTransactionalTenant requires a tenant")

    const configuration = this.getConfiguration()
    const pool = configuration.getDatabasePool(databaseIdentifier)
    const databaseConfiguration = configuration.resolveDatabaseConfiguration(databaseIdentifier, tenant)
    if (!databaseConfiguration.tenantOnly) {
      throw new Error(`registerTransactionalTenant requires a tenantOnly database: ${databaseIdentifier}`)
    }
    const reuseKey = pool.getConfigurationReuseKey(databaseConfiguration)
    if (registrations.some((registration) => registration.pool === pool && registration.reuseKey === reuseKey)) return

    /** @type {TransactionalTenantRegistration} */
    const registration = {
      connection: undefined,
      pool,
      reuseKey,
      revoked: false,
      sharedRegistration: undefined
    }

    registrations.push(registration)
    registration.checkoutPromise = pool
      .checkoutForConfiguration(databaseConfiguration, {name: "Transactional tenant test registration"})
      .then(
        (connection) => ({connection, error: undefined}),
        (error) => ({
          connection: undefined,
          error: error instanceof Error ? error : new Error("Transactional tenant connection checkout failed", {cause: error})
        })
      )

    try {
      const checkoutOutcome = await registration.checkoutPromise

      if (checkoutOutcome.error) throw checkoutOutcome.error
      if (!checkoutOutcome.connection) throw new Error("Transactional tenant connection checkout returned no connection")
      registration.connection = checkoutOutcome.connection
      if (registration.revoked) throw new Error("Transactional tenant test registration attempt is no longer active")

      await registration.connection.startTransaction()
      if (registration.revoked) throw new Error("Transactional tenant test registration attempt is no longer active")

      const sharedRegistration = pool.setTestSharedConnectionForConfiguration(registration.connection, reuseKey)
      if (!sharedRegistration) throw new Error(`Database pool does not support transactional tenant test connections: ${databaseIdentifier}`)
      registration.sharedRegistration = sharedRegistration
      if (registration.revoked) {
        pool.clearTestSharedConnection(sharedRegistration)
        throw new Error("Transactional tenant test registration attempt is no longer active")
      }
    } catch (error) {
      registration.revoked = true
      try {
        await this.cleanupTransactionalTenants([registration], {discard: registration.discardOnCleanup === true})
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Failed to register and clean up a transactional tenant test connection", {cause: cleanupError})
      }
      throw error
    }
  }

  /**
   * Revokes attempt registrations before rolling back and releasing their connections.
   * @param {TransactionalTenantRegistration[]} registrations - Attempt registrations.
   * @param {{discard?: boolean}} [options] - Whether connections must be discarded instead of returned to the pool.
   * @returns {Promise<void>}
   */
  async cleanupTransactionalTenants(registrations, {discard = false} = {}) {
    for (const registration of registrations) {
      registration.revoked = true
      if (discard) registration.discardOnCleanup = true
      if (registration.sharedRegistration) registration.pool.clearTestSharedConnection(registration.sharedRegistration)
    }
    const cleanupResults = await Promise.allSettled([...registrations].reverse().map((registration) => {
      registration.cleanupPromise ??= this.cleanupTransactionalTenantRegistration(registration)

      return registration.cleanupPromise
    }))
    const errors = cleanupResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason)

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Failed to clean up transactional tenant test connections")
  }

  /**
   * Cleans one attempt registration exactly once, including a checkout that was still pending at revocation.
   * @param {TransactionalTenantRegistration} registration - Attempt-owned registration.
   * @returns {Promise<void>} - Resolves after rollback and release or quarantine.
   */
  async cleanupTransactionalTenantRegistration(registration) {
    let connection = registration.connection

    if (!connection && registration.checkoutPromise) {
      const checkoutOutcome = await registration.checkoutPromise

      if (checkoutOutcome.error) return
      connection = checkoutOutcome.connection
      registration.connection = connection
    }
    if (!connection) return

    const errors = []

    try {
      if (connection.insideTransaction()) await connection.rollbackTransaction()
    } catch (error) {
      errors.push(error)
    } finally {
      try {
        if (registration.discardOnCleanup) {
          await registration.pool.discard(connection)
        } else {
          await registration.pool.checkin(connection)
        }
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Failed to clean up a transactional tenant test connection")
  }

  /**
   * Selects the current non-tenant connections eligible for shared transaction work.
   * @param {{transactionsOnly: boolean}} args - Selection options.
   * @returns {Record<string, import("../database/drivers/base.js").default>} - Eligible connections by identifier.
   */
  sharedTransactionConnections({transactionsOnly}) {
    const configuration = this.getConfiguration()
    const currentConnections = configuration.getCurrentConnections()
    /** @type {Record<string, import("../database/drivers/base.js").default>} */
    const connections = {}

    for (const [identifier, connection] of Object.entries(currentConnections)) {
      const pool = configuration.getDatabasePool(identifier)

      if (pool.getConfiguration().tenantOnly) continue
      if (transactionsOnly && !connection.insideTransaction()) continue
      connections[identifier] = connection
    }

    return connections
  }

  /**
   * Installs physical-connection coordination before a transaction-opening hook
   * can expose the shared connection to a long-lived in-process service.
   * Child-process coordinates remain unpublished until the transaction exists.
   * @returns {Promise<SharedTransactionBrokerRegistration | undefined>} - Prepared coordinator.
   */
  async prepareSharedTransactionBroker() {
    const connections = this.sharedTransactionConnections({transactionsOnly: false})

    if (Object.keys(connections).length === 0) return undefined

    return {
      broker: await SharedTransactionBroker.start({connections}),
      environmentPublished: false,
      previousEnvironment: undefined
    }
  }

  /**
   * Checks whether a prepared broker coordinates exactly the selected physical connections.
   * @param {SharedTransactionBrokerRegistration | undefined} registration - Prepared coordinator.
   * @param {Record<string, import("../database/drivers/base.js").default>} connections - Selected connections.
   * @returns {boolean} - Whether the identifier set and physical connections match exactly.
   */
  sharedTransactionBrokerMatchesConnections(registration, connections) {
    const identifiers = Object.keys(connections)

    if (!registration || identifiers.length === 0) return false
    if (Object.keys(registration.broker.connections).length !== identifiers.length) return false

    for (const [identifier, connection] of Object.entries(connections)) {
      if (registration.broker.connections[identifier] !== connection) return false
    }

    return true
  }

  /**
   * Starts a capability-scoped broker for the active non-tenant physical
   * transaction connections. No broker/env is installed for truncation-only or
   * other transaction-disabled attempts.
   * @param {SharedTransactionBrokerRegistration} [preparedRegistration] - Coordinator prepared before hooks.
   * @param {Record<string, import("../database/drivers/base.js").default>} [selectedConnections] - Post-hook active connections.
   * @returns {Promise<SharedTransactionBrokerRegistration | undefined>} - Attempt registration.
   */
  async startSharedTransactionBroker(preparedRegistration, selectedConnections) {
    const connections = selectedConnections || this.sharedTransactionConnections({transactionsOnly: true})

    const databaseIdentifiers = Object.keys(connections)
    if (databaseIdentifiers.length === 0) {
      await this.stopSharedTransactionBroker(preparedRegistration)
      return undefined
    }

    let broker

    if (preparedRegistration && this.sharedTransactionBrokerMatchesConnections(preparedRegistration, connections)) {
      broker = preparedRegistration.broker
    } else {
      await this.stopSharedTransactionBroker(preparedRegistration)
      broker = await SharedTransactionBroker.start({connections})
    }

    const previousEnvironment = process.env[SHARED_TRANSACTION_BROKER_ENV]
    process.env[SHARED_TRANSACTION_BROKER_ENV] = Buffer.from(JSON.stringify({
      address: broker.address(),
      capability: broker.capability(),
      databaseIdentifiers,
      expected: true
    })).toString("base64url")

    return {broker, environmentPublished: true, previousEnvironment}
  }

  /**
   * Revokes an attempt broker before database rollback hooks run and restores
   * the caller's environment so later pooled/spawned children cannot inherit it.
   * @param {SharedTransactionBrokerRegistration | undefined} registration - Attempt registration.
   */
  async stopSharedTransactionBroker(registration) {
    if (!registration) return

    if (registration.environmentPublished) {
      if (registration.previousEnvironment === undefined) {
        delete process.env[SHARED_TRANSACTION_BROKER_ENV]
      } else {
        process.env[SHARED_TRANSACTION_BROKER_ENV] = registration.previousEnvironment
      }
    }
    await registration.broker.close()
  }

  /**
   * Runs request client.
   * @returns {Promise<RequestClient>} - Resolves with the request client.
   */
  async requestClient() {
    if (!this._requestClient) {
      this._requestClient = new RequestClient()
    }

    return this._requestClient
  }

  /**
   * Runs import test files.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async importTestFiles() {
    const environmentHandler = this.getConfiguration().getEnvironmentHandler()

    if (!this._profiler) {
      await environmentHandler.importTestFiles(this.getTestFiles())
      return
    }

    for (const testFile of this.getTestFiles()) {
      const existingRegistrations = this.testRegistrationObjects()

      await this._profiler.measurePhase("imports", async () => {
        await environmentHandler.importTestFiles([testFile])
      }, {filePath: testFile})
      this.assignTestRegistrationOwnership(existingRegistrations, testFile)
    }
  }

  /**
   * Collects package declaration objects by identity.
   * @param {Set<PackageRegistration>} [registrations] - Accumulated identities.
   * @returns {Set<PackageRegistration>} - Registration identities.
   */
  testRegistrationObjects(registrations = new Set()) {
    const visit = (/** @type {PackageSuiteDeclaration} */ suite) => {
      registrations.add(suite)
      for (const hook of [...suite.hooks.beforeAll, ...suite.hooks.beforeEach, ...suite.hooks.afterEach, ...suite.hooks.afterAll]) {
        registrations.add(hook)
      }
      for (const testDeclaration of suite.tests) registrations.add(testDeclaration)
      for (const childSuite of suite.suites) visit(childSuite)
    }

    for (const suite of this.getTestContext().registry.suites) visit(suite)

    return registrations
  }

  /**
   * Assigns deterministic ownership to package declarations added by one entry file.
   * @param {Set<PackageRegistration>} previousRegistrations - Identities present before import.
   * @param {string} ownerFilePath - Importing entry file.
   * @returns {void}
   */
  assignTestRegistrationOwnership(previousRegistrations, ownerFilePath) {
    for (const registration of this.testRegistrationObjects()) {
      if (!previousRegistrations.has(registration)) this._declarationOwners.set(registration, ownerFilePath)
    }
  }

  /**
   * Runs is failed.
   * @returns {boolean} - Whether failed.
   */
  isFailed() { return this._failedTests !== undefined && (this._failedTests > 0 || this._packageResult?.status === "failed") }

  /**
   * Runs get failed tests.
   * @returns {number} - The failed tests.
   */
  getFailedTests() {
    if (this._failedTests === undefined) throw new Error("Tests hasn't been run yet")

    return this._failedTests
  }

  /**
   * Runs get failed test details.
   * @returns {FailedTestDetail[]} - Failed test details.
   */
  getFailedTestDetails() {
    return this._failedTestDetails
  }

  /**
   * Runs persist failed test console outputs to assets.
   * @param {object} [args] - Options object.
   * @param {string} [args.assetsPath] - Assets directory path.
   * @returns {Promise<string[]>} - Written log file paths.
   */
  async persistFailedTestConsoleOutputsToAssets({assetsPath = path.join(process.cwd(), "tmp/screenshots")} = {}) {
    const failedTestDetails = this.getFailedTestDetails()
    const writtenLogPaths = []
    let createdDirectory = false

    for (let index = 0; index < failedTestDetails.length; index++) {
      const failedTestDetail = failedTestDetails[index]
      const consoleOutput = failedTestDetail.consoleOutput

      if (!consoleOutput) continue

      if (!createdDirectory) {
        await fs.mkdir(assetsPath, {recursive: true})
        createdDirectory = true
      }

      const now = new Date()
      const timestamp = [
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
        String(now.getMilliseconds()).padStart(3, "0")
      ].join("")
      const slug = toFileSlug(failedTestDetail.fullDescription)
      const fileName = `${timestamp}-${String(index + 1).padStart(2, "0")}-${slug}.console.log`
      const filePath = path.join(assetsPath, fileName)

      await fs.writeFile(filePath, consoleOutput, "utf8")
      failedTestDetail.consoleLogPath = filePath
      writtenLogPaths.push(filePath)
    }

    return writtenLogPaths
  }

  /**
   * Runs get successful tests.
   * @returns {number} - The successful tests.
   */
  getSuccessfulTests() {
    if (this._successfulTests === undefined) throw new Error("Tests hasn't been run yet")

    return this._successfulTests
  }

  /**
   * Runs get tests count.
   * @returns {number} - The tests count.
   */
  getTestsCount() {
    if (this._testsCount === undefined) throw new Error("Tests hasn't been run yet")

    return this._testsCount
  }

  /**
   * Runs get executed tests count.
   * @returns {number} - The executed tests count.
   */
  getExecutedTestsCount() {
    return this._packageResult?.tests.length ?? this._testDurations.length
  }

  /**
   * Returns the tests recorded during the run, slowest first.
   * @param {number} [limit] - Maximum number of tests to return (0 returns all).
   * @returns {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} - Slowest tests, slowest first.
   */
  getSlowestTests(limit = 10) {
    const sorted = [...this._testDurations].sort((testA, testB) => testB.durationMs - testA.durationMs)

    return limit > 0 ? sorted.slice(0, limit) : sorted
  }

  /**
   * Runs prepare.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async prepare() {
    this.anyTestsFocussed = false
    this._failedTests = 0
    this._successfulTests = 0
    this._testsCount = 0
    this._abortRemainingTests = false
    this._failedTestDetails = []
    this._testDurations = []
    this._testCompatibility = new WeakMap()
    this._injectedTests = new WeakSet()
    this._completedTests = new WeakSet()
    this._testMetadata = new WeakMap()
    this._hookMetadata = new WeakMap()
    this._attemptOutcomes = new WeakMap()
    this._suiteHookFailures = []
    this._testsByFullName = new Map()
    this._packageResult = undefined
    const context = this.getTestContext()
    /** @type {string | undefined} */
    let ownerFilePath

    context.reset({config: true})
    context.setDeclarationLocator(() => this.captureTestDeclarationLocation(ownerFilePath))
    const testingConfigPath = this.getConfiguration().getTesting()

    await context.describe("", {databaseCleaning: {transaction: true}}, async () => {
      if (testingConfigPath) {
        await this.runProfileSpan({phase: "testing config/global setup"}, async () => {
          await this.getConfiguration().getEnvironmentHandler().importTestingConfigPath()
        })
      }

      if (!this._profiler) {
        await this.importTestFiles()
      } else {
        for (const testFile of this.getTestFiles()) {
          ownerFilePath = testFile
          const existingRegistrations = this.testRegistrationObjects()

          await this._profiler.measurePhase("imports", async () => {
            await this.getConfiguration().getEnvironmentHandler().importTestFiles([testFile])
          }, {filePath: testFile})
          this.assignTestRegistrationOwnership(existingRegistrations, testFile)
        }
      }
    })
    ownerFilePath = undefined
    this.analyzeDeclarations()
  }

  /**
   * Captures a test source location without attributing package/facade frames.
   * @param {string | undefined} ownerFilePath - Importing entry file fallback.
   * @returns {{filePath?: string, line?: number}} - Declaration location.
   */
  captureTestDeclarationLocation(ownerFilePath) {
    const stack = new Error().stack?.split("\n") || []

    for (const stackLine of stack) {
      const match = stackLine.match(/(?:\(|\s)(file:\/\/.*?|\/[^"]*?):(\d+):(\d+)\)?$/u)
      if (!match) continue

      let filePath = match[1]
      if (filePath.startsWith("file://")) {
        try {
          filePath = fileURLToPath(filePath)
        } catch {
          continue
        }
      }
      const resolvedFilePath = path.resolve(filePath)
      const portablePath = resolvedFilePath.replaceAll(path.sep, "/")

      if (portablePath.endsWith("/src/testing/test-runner.js")) continue
      if (portablePath.endsWith("/src/testing/test.js")) continue
      if (portablePath.includes("/node_modules/@velocious/testing/")) continue

      return {filePath: resolvedFilePath, line: Number(match[2])}
    }

    return ownerFilePath ? {filePath: ownerFilePath} : {}
  }

  /**
   * Runs are any tests focussed.
   * @returns {boolean} - Whether any tests focussed.
   */
  areAnyTestsFocussed() {
    if (this.anyTestsFocussed === undefined) {
      throw new Error("Hasn't been detected yet")
    }

    return this.anyTestsFocussed
  }

  /**
   * Runs run.
   * @returns {Promise<void>} - Resolves when complete.
   */
  /**
   * Records an asynchronous crash (an unhandled promise rejection detached from
   * any await, e.g. a `void connection.afterCommit(async () => broadcast(...))`
   * frontend-model publish — or a synchronous throw inside a detached callback
   * such as a driver socket or timer callback) as a real, visible, attributed
   * test failure.
   *
   * Without this, such a rejection/exception has no handler, so on modern Node
   * the process is TERMINATED — the run ends with no reported failures and CI
   * just sees a crashed/retried shard with an empty result (the recurring
   * "silent test-runner death": invisible and impossible to diagnose). Turning
   * it into a failure makes the run go red with something debuggable instead of
   * vanishing.
   * @param {"uncaughtException" | "unhandledRejection"} kind - Async-crash kind.
   * @param {unknown} reason - Rejection reason or thrown error.
   * @returns {void}
   */
  recordAsyncCrash(kind, reason) {
    const error = reason instanceof Error ? reason : new Error(`${kind}: ${String(reason)}`)
    const near = this._lastTestContext
    const attribution = near ? `, near test: ${near.fullDescription} (${near.filePath}:${near.line})` : ""

    this._failedTests = (this._failedTests || 0) + 1
    this._failedTestDetails.push({
      fullDescription: `<${kind} during test run${attribution}>`,
      filePath: near ? near.filePath : "<test runner>",
      line: near ? near.line : 0,
      error,
      consoleOutput: undefined
    })

    console.error(picocolors.red(`\n[test-runner] ${kind} during the test run — this would otherwise terminate the process silently and surface only as a crashed/retried shard with zero reported failures.${attribution}`))
    console.error(error)
  }

  /**
   * Records a cleanup failure after timeout handling has begun.
   * @param {unknown} reason - Detached cleanup rejection.
   * @param {string} cleanupName - Cleanup operation name.
   * @param {Set<Error>} [recordedErrors] - Attempt-owned cleanup errors already reported.
   * @returns {void}
   */
  recordTimeoutCleanupFailure(reason, cleanupName, recordedErrors) {
    const error = reason instanceof Error ? reason : new Error(`${cleanupName} cleanup failed: ${String(reason)}`)

    if (recordedErrors) {
      // Multiple bounded observers can receive the same detached cleanup rejection.
      if (recordedErrors.has(error)) return
      recordedErrors.add(error)
    }

    const near = this._lastTestContext
    const attribution = near ? `, near test: ${near.fullDescription} (${near.filePath}:${near.line})` : ""

    this._failedTests = (this._failedTests || 0) + 1
    this._failedTestDetails.push({
      fullDescription: `<${cleanupName} emergency cleanup failure${attribution}>`,
      filePath: near ? near.filePath : "<test runner>",
      line: near ? near.line : 0,
      error,
      consoleOutput: undefined
    })

    console.error(picocolors.red(`\n[test-runner] ${cleanupName} cleanup failed after timeout handling began.${attribution}`))
    console.error(error)
  }

  async run() {
    /**
     * Handles a process-level unhandled rejection during the run.
     * @param {unknown} reason - Rejection reason.
     * @returns {void}
     */
    const onUnhandledRejection = (reason) => {
      // If a test attached its OWN unhandledRejection listener, it is
      // intentionally observing/triggering the rejection (e.g. beacon
      // error-reporting-spec.js) — Node dispatches to EVERY listener, so also
      // failing the suite here would break those tests. Defer to the test's
      // handler; only treat a rejection as a silent-death crash when ours is the
      // sole listener (no persistent framework listener exists to mask this).
      if (process.listenerCount("unhandledRejection") > 1) return

      this.recordAsyncCrash("unhandledRejection", reason)
    }

    /**
     * Handles a process-level uncaught exception during the run — a
     * synchronous throw inside a detached callback (driver socket, timer,
     * event emitter) that no test await observes. Same silent-death mode as
     * unhandled rejections: without a handler the process dies mid-run and CI
     * sees a crashed shard with zero reported failures.
     * @param {unknown} error - Thrown error.
     * @returns {void}
     */
    const onUncaughtException = (error) => {
      // Mirror the unhandledRejection deferral: a test observing/triggering
      // uncaught exceptions with its own listener owns them.
      if (process.listenerCount("uncaughtException") > 1) return

      this.recordAsyncCrash("uncaughtException", error)
    }

    process.on("unhandledRejection", onUnhandledRejection)
    process.on("uncaughtException", onUncaughtException)

    try {
      await this.runPackageTests()

      // A rejection scheduled by the final test (a detached rejected promise,
      // or an afterCommit callback rejecting as the suite drains) is reported
      // by Node on a LATER turn. Drain a few turns while the handler is still
      // attached so those late rejections are recorded instead of escaping to
      // the default crash path after cleanup.
      for (let drainTurn = 0; drainTurn < 3; drainTurn++) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    } finally {
      process.off("unhandledRejection", onUnhandledRejection)
      process.off("uncaughtException", onUncaughtException)
    }
  }

  /**
   * Runs run after alls for active scopes.
   * @returns {Promise<void>} - Resolves when cleanup hooks finish.
   */
  async runAfterAllsForActiveScopes() {
    const failureStart = this._suiteHookFailures.length

    await this._packageRunner?.cleanupActiveSuites()
    this.throwAfterAllFailures(this._suiteHookFailures.slice(failureStart))
  }

  /** Builds declaration metadata used only by framework adapters and projections. */
  analyzeDeclarations() {
    const visit = (/** @type {PackageSuiteDeclaration} */ suite, /** @type {PackageSuiteDeclaration[]} */ ancestors, /** @type {string | undefined} */ parentProfileScopeId) => {
      const suites = [...ancestors, suite]
      const descriptions = suites.map((entry) => entry.name).filter((name) => name !== "")
      const ownerFilePath = this._declarationOwners.get(suite) ?? suite.location.filePath
      const profileScopeId = this._profiler?.scopeId(suite, {
        descriptions,
        filePath: ownerFilePath,
        line: suite.location.line,
        parentId: parentProfileScopeId
      })

      for (const hooks of Object.values(suite.hooks)) {
        hooks.forEach((hook, declarationIndex) => {
          this._hookMetadata.set(hook, {
            declarationIndex,
            declarationScopeId: profileScopeId,
            ownerFilePath: this._declarationOwners.get(hook) ?? hook.location.filePath ?? ownerFilePath
          })
        })
      }

      for (const testDeclaration of suite.tests) {
        const fullDescription = this.buildFullDescription(descriptions, testDeclaration.name)
        const declarations = this._testsByFullName.get(fullDescription) || []

        declarations.push(testDeclaration)
        this._testsByFullName.set(fullDescription, declarations)
        this._testMetadata.set(testDeclaration, {
          descriptions,
          testDescription: testDeclaration.name,
          fullDescription,
          ownerFilePath: this._declarationOwners.get(testDeclaration) ?? testDeclaration.location.filePath ?? ownerFilePath,
          suites
        })
        const legacyTestData = this._legacyFixtureDataByFullName?.get(fullDescription)
        if (legacyTestData) {
          this._testCompatibility.set(testDeclaration, {
            testArgs: this._testArguments.copy(testDeclaration),
            testData: legacyTestData
          })
        }
        this._testsCount++
        if (testDeclaration.state === "run" && (testDeclaration.focus || suites.some((entry) => entry.focus))) {
          this.anyTestsFocussed = true
        }
      }

      for (const childSuite of suite.suites) visit(childSuite, suites, profileScopeId)
    }

    for (const suite of this.getTestContext().registry.suites) visit(suite, [], undefined)
  }

  /**
   * Gets package hook compatibility metadata.
   * @param {PackageHookDeclaration} hook - Package hook declaration.
   * @returns {{declarationIndex: number, declarationScopeId: string | undefined, ownerFilePath: string | undefined}} - Hook metadata.
   */
  hookMetadata(hook) {
    return this._hookMetadata.get(hook) || {declarationIndex: 0, declarationScopeId: undefined, ownerFilePath: hook.location.filePath}
  }

  /**
   * Gets package test compatibility metadata.
   * @param {PackageTestDeclaration} test - Package test declaration.
   * @returns {{descriptions: string[], testDescription: string, fullDescription: string, ownerFilePath: string | undefined, suites: PackageSuiteDeclaration[]}} - Declaration metadata.
   */
  testMetadata(test) {
    const metadata = this._testMetadata.get(test)
    if (!metadata) throw new Error(`Missing package test metadata: ${test.name}`)
    return metadata
  }

  /**
   * Gets stable compatibility data for a package declaration.
   * @param {PackageTestDeclaration} test - Package test declaration.
   * @returns {{testArgs: TestArgs, testData: TestData}} - Stable compatibility data.
   */
  testData(test) {
    let compatibility = this._testCompatibility.get(test)

    if (!compatibility) {
      const testArgs = this._testArguments.copy(test)
      const metadata = this.testMetadata(test)
      const testData = {
        args: testArgs,
        declaration: test,
        filePath: test.location.filePath,
        function: test.callback,
        line: test.location.line,
        ownerFilePath: metadata.ownerFilePath
      }
      compatibility = {testArgs, testData}
      this._testCompatibility.set(test, compatibility)
    }

    return compatibility
  }

  /**
   * Injects framework collaborators into stable compatibility data once.
   * @param {PackageTestDeclaration} test - Package test declaration.
   * @returns {Promise<{testArgs: TestArgs, testData: TestData}>} - Injected compatibility data.
   */
  async testCompatibility(test) {
    const compatibility = this.testData(test)

    if (!this._injectedTests.has(test)) {
      await this._testArguments.inject(compatibility.testArgs)
      this._injectedTests.add(test)
    }

    return compatibility
  }

  /**
   * Records a raw framework attempt outcome.
   * @param {PackageTestDeclaration} test - Package test declaration.
   * @param {number} attemptNumber - One-based attempt number.
   * @param {{abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean}} outcome - Raw attempt outcome.
   * @returns {void}
   */
  recordAttemptOutcome(test, attemptNumber, outcome) {
    const outcomes = this._attemptOutcomes.get(test) || new Map()
    outcomes.set(attemptNumber, outcome)
    this._attemptOutcomes.set(test, outcomes)
    if (outcome.abortRemainingTests) this._abortRemainingTests = true
  }

  /**
   * Gets a raw framework attempt outcome.
   * @param {PackageTestDeclaration} test - Package test declaration.
   * @param {number} attemptNumber - One-based attempt number.
   * @returns {{abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean} | undefined} - Raw attempt outcome.
   */
  attemptOutcome(test, attemptNumber) { return this._attemptOutcomes.get(test)?.get(attemptNumber) }

  /**
   * Records a raw suite-hook failure.
   * @param {object} failure - Suite-hook failure.
   * @param {PackageSuiteDeclaration} failure.suite - Owning package suite.
   * @param {"beforeAll" | "afterAll"} failure.phase - Hook phase.
   * @param {ReturnType<typeof JSON.parse>} failure.error - Raw hook failure.
   * @returns {void}
   */
  recordSuiteHookFailure(failure) { this._suiteHookFailures.push(failure) }

  /**
   * Gets the raw ancestor setup failure for a package test.
   * @param {PackageTestDeclaration} test - Package test declaration.
   * @returns {ReturnType<typeof JSON.parse>} - Raw setup failure.
   */
  setupFailureFor(test) {
    const suites = this.testMetadata(test).suites
    return this._suiteHookFailures.find((failure) => failure.phase === "beforeAll" && suites.includes(failure.suite))?.error
  }

  /**
   * Finds the next incomplete declaration with a package full name.
   * @param {string} fullName - Package full name.
   * @returns {PackageTestDeclaration | undefined} - Next matching declaration.
   */
  findTestDeclaration(fullName) {
    return this._testsByFullName.get(fullName)?.find((test) => !this._completedTests.has(test))
  }

  /**
   * Marks a package declaration complete.
   * @param {PackageTestDeclaration} test - Completed declaration.
   * @returns {void}
   */
  completeTestDeclaration(test) { this._completedTests.add(test) }

  /**
   * Gets the effective package retry count.
   * @param {PackageTestDeclaration} test - Package test declaration.
   * @returns {number} - Effective retry count.
   */
  retryCount(test) {
    const value = test.options.retries ?? test.options.retry ?? this.getTestContext().config.retries
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }

  /**
   * Normalizes retry inputs for the package execution boundary while retaining
   * the declarations' original public options after the run.
   * @returns {() => void} - Restores original declaration options.
   */
  normalizePackageRetriesForExecution() {
    /** @type {PackageRetryOptionRestoration[]} */
    const restorations = []
    /**
     * Normalizes declarations in one suite.
     * @param {PackageSuiteDeclaration} suite - Suite whose tests are normalized.
     */
    const visit = (suite) => {
      for (const test of suite.tests) {
        // Capture compatibility arguments before temporarily adapting package
        // execution options so callbacks retain their declared values/identity.
        this.testData(test)
        restorations.push({
          hadRetries: Object.hasOwn(test.options, "retries"),
          options: test.options,
          retries: test.options.retries
        })
        test.options.retries = this.retryCount(test)
      }

      for (const childSuite of suite.suites) visit(childSuite)
    }

    for (const suite of this.getTestContext().registry.suites) visit(suite)

    return () => {
      for (const restoration of restorations) {
        if (restoration.hadRetries) restoration.options.retries = restoration.retries
        else delete restoration.options.retries
      }
    }
  }

  /**
   * Records one completed test duration.
   * @param {{durationMs: number, filePath: string, fullDescription: string, line: number}} duration - Completed test duration.
   * @returns {void}
   */
  recordTestDuration(duration) { this._testDurations.push(duration) }

  /** Records one successful package result. */
  recordSuccessfulTest() { this._successfulTests++ }

  /**
   * Records one failed package test in the legacy result projection.
   * @param {object} args - Failed test metadata.
   * @param {string[]} args.descriptions - Parent descriptions.
   * @param {ReturnType<typeof JSON.parse>} args.error - Raw failure.
   * @param {string} args.consoleOutput - Captured console output.
   * @param {TestData} args.testData - Compatibility test data.
   * @param {string} args.testDescription - Test description.
   * @returns {void}
   */
  recordFailedTest({descriptions, error, consoleOutput, testData, testDescription}) {
    this._failedTests++
    this._failedTestDetails.push({
      fullDescription: this.buildFullDescription(descriptions, testDescription),
      filePath: testData.filePath,
      line: testData.line,
      error,
      consoleOutput: consoleOutput || undefined
    })
  }

  /**
   * Stores the completed package result.
   * @param {import("@velocious/testing/runner").TestRunResult} result - Package result.
   * @returns {void}
   */
  recordPackageResult(result) { this._packageResult = result }

  /**
   * Runs the package kernel with Velocious framework adapters.
   * @returns {Promise<void>} - Resolves after execution and teardown.
   */
  async runPackageTests() {
    const environmentHandler = this.getConfiguration().getEnvironmentHandler()
    environmentHandler.installSharedTransactionCoordinatorOwnerStorage(this._sharedTransactionCoordinatorOwnerStorage)
    environmentHandler.installTestDatabaseAccessScopeStorage(this._testDatabaseAccessScopeStorage)
    this._packageRunner = new PackageTestRunner({
      context: this.getTestContext(),
      includeTags: this._includeTags,
      excludeTags: [...this.getExcludeTagSet(), ...(this.isBrowserTestMode() ? [] : ["browser-only"])],
      examples: this.getExamplePatterns(),
      lineFilters: this.getLineFilters(),
      includeTagMode: "any",
      focusedTestsBypassIncludeTags: true,
      omitEmptySuiteNames: true,
      attemptExecutorOwnsTimeout: true,
      attemptExecutor: (input) => this._attemptExecutor.execute(input),
      testArgumentResolver: (input) => this._testArguments.resolve(input),
      suiteHookExecutor: (input) => this._suiteHookExecutor.execute(input),
      reporter: this._runnerReporter
    })
    const failureStart = this._suiteHookFailures.length
    const restoreRetryOptions = this.normalizePackageRetriesForExecution()
    let result

    try {
      try {
        result = await this._packageRunner.run()
      } catch (error) {
        if (!(error instanceof AbortRemainingTestsError)) throw error

        const afterAll = this.afterAllOutcome(this._suiteHookFailures.slice(failureStart))
        if (afterAll.failed) this.recordTimeoutCleanupFailure(afterAll.error, "afterAll")
        return
      }

      this.recordPackageResult(result)
      this.throwAfterAllFailures(this._suiteHookFailures.slice(failureStart))
    } finally {
      restoreRetryOptions()
    }
  }

  /**
   * Aggregates raw after-all failures without using error truthiness.
   * @param {Array<{phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} failures - Hook failures.
   * @returns {{failed: false} | {failed: true, error: ReturnType<typeof JSON.parse>}} - Explicit afterAll outcome.
   */
  afterAllOutcome(failures) {
    const afterAllErrors = failures.filter((failure) => failure.phase === "afterAll").map((failure) => failure.error)

    if (afterAllErrors.length === 0) return {failed: false}
    if (afterAllErrors.length === 1) return {failed: true, error: afterAllErrors[0]}
    return {
      failed: true,
      error: new AggregateError(afterAllErrors, "Multiple active afterAll scopes failed", {cause: afterAllErrors[0]})
    }
  }

  /**
   * Throws one raw or aggregated after-all failure.
   * @param {Array<{phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} failures - Hook failures.
   * @returns {void}
   */
  throwAfterAllFailures(failures) {
    const afterAll = this.afterAllOutcome(failures)

    if (afterAll.failed) throw afterAll.error
  }

  /**
   * Compatibility helper for focused framework lifecycle specs. It converts an
   * explicit legacy fixture into isolated package declarations; the package
   * runner remains the sole execution engine.
   * @param {object} args - Legacy fixture arguments.
   * @param {TestsArgument} args.tests - Fixture tree.
   * @returns {Promise<void>} - Resolves after package execution.
   */
  async runTests({tests}) {
    const context = createTestContext()
    const originalContext = this._context
    context.configureTests({
      consoleOutput: originalContext.config.consoleOutput,
      defaultTimeoutMs: originalContext.config.defaultTimeoutMs,
      excludeTags: originalContext.config.excludeTags,
      failedConsoleOutputMaxLines: originalContext.config.failedConsoleOutputMaxLines,
      retries: originalContext.config.retries
    })
    this._context = context
    this._testsCount = 0
    this._testCompatibility = new WeakMap()
    this._injectedTests = new WeakSet()
    this._completedTests = new WeakSet()
    this._testMetadata = new WeakMap()
    this._hookMetadata = new WeakMap()
    this._attemptOutcomes = new WeakMap()
    this._suiteHookFailures = []
    this._testsByFullName = new Map()
    this._legacyFixtureDataByFullName = new Map()
    context.setDeclarationLocator(() => this._legacyFixtureLocation)
    this.declareLegacyFixture(context, "", tests, [])
    this.analyzeDeclarations()

    try {
      await this.runPackageTests()
    } finally {
      this._context = originalContext
    }
  }

  /**
   * Declares an isolated legacy-shaped test fixture into a package context.
   * @param {PackageTestContext} context - Isolated package context.
   * @param {string} name - Suite name.
   * @param {TestsArgument} scope - Legacy fixture scope.
   * @param {string[]} descriptions - Ancestor descriptions.
   * @returns {void}
   */
  declareLegacyFixture(context, name, scope, descriptions) {
    this._legacyFixtureLocation = {filePath: scope.filePath, line: scope.line}
    context.describe(name, scope.args || {}, () => {
      for (const hook of scope.beforeAlls || []) context.beforeAll(hook.callback)
      for (const hook of scope.beforeEaches || []) context.beforeEach(hook.callback)
      for (const hook of scope.afterEaches || []) context.afterEach(hook.callback)
      for (const hook of scope.afterAlls || []) context.afterAll(hook.callback)
      const nextDescriptions = name === "" ? descriptions : [...descriptions, name]
      for (const [testName, testData] of Object.entries(scope.tests || {})) {
        this._legacyFixtureLocation = {filePath: testData.filePath, line: testData.line}
        this._legacyFixtureDataByFullName?.set(this.buildFullDescription(nextDescriptions, testName), testData)
        context.it(testName, testData.args, testData.function)
      }
      for (const [suiteName, childScope] of Object.entries(scope.subs || {})) {
        this.declareLegacyFixture(context, suiteName, childScope, nextDescriptions)
      }
    })
  }

  /**
   * Runs emit event.
   * @param {string} eventName - Event name.
   * @param {object} payload - Event payload.
   * @returns {Promise<void>} - Resolves when all listeners complete.
   */
  async emitEvent(eventName, payload) {
    await this._runnerReporter.emitEvent(eventName, payload)
  }

  /**
   * Runs print rerun command.
   * @param {object} args - Options object.
   * @param {string[]} args.descriptions - Description stack.
   * @param {string} args.testDescription - Test description.
   * @param {TestData} args.testData - Test data.
   * @param {string} args.leftPadding - Left padding.
   * @returns {void} - No return value.
   */
  printRerunCommand({descriptions, testDescription, testData, leftPadding}) {
    const rerun = this.buildRerunCommand({descriptions, testDescription, testData})

    if (rerun) {
      console.error(`${leftPadding}  Re-run: ${rerun}`)
    }
  }

  /**
   * Runs build rerun command.
   * @param {object} args - Options object.
   * @param {string[]} args.descriptions - Description stack.
   * @param {string} args.testDescription - Test description.
   * @param {TestData} args.testData - Test data.
   * @returns {string | undefined} - Rerun command.
   */
  buildRerunCommand({descriptions, testDescription, testData}) {
    const baseCommand = "npx velocious test"
    const filePath = testData.filePath
    const line = testData.line

    if (filePath && line) {
      const relativePath = path.relative(process.cwd(), filePath)
      return `${baseCommand} ${relativePath}:${line}`
    }

    const fullDescription = this.buildFullDescription(descriptions, testDescription)

    if (fullDescription) {
      return `${baseCommand} --example ${JSON.stringify(fullDescription)}`
    }

    return undefined
  }

  /**
   * Runs build console output.
   * @param {AttemptConsoleOutput[]} attemptConsoleOutputs - Attempt output entries.
   * @returns {string} - Combined console output.
   */
  buildConsoleOutput(attemptConsoleOutputs) {
    if (attemptConsoleOutputs.length === 0) return ""
    if (attemptConsoleOutputs.length === 1) return attemptConsoleOutputs[0].output

    return attemptConsoleOutputs.map((attemptConsoleOutput) => {
      return `--- Attempt ${attemptConsoleOutput.attemptNumber} ---\n${attemptConsoleOutput.output}`
    }).join("\n")
  }

  /**
   * Runs get failed console output max lines.
   * @returns {number} - Maximum failed console lines.
   */
  getFailedConsoleOutputMaxLines() {
    const maxLines = testConfig.failedConsoleOutputMaxLines

    if (typeof maxLines !== "number" || !Number.isFinite(maxLines)) return 200

    return Math.max(0, Math.floor(maxLines))
  }

  /**
   * Runs truncate failed console output lines.
   * @param {string} consoleOutput - Console output.
   * @returns {string[]} - Lines for inline output.
   */
  truncateFailedConsoleOutputLines(consoleOutput) {
    const lines = consoleOutput.split("\n")
    const maxLines = this.getFailedConsoleOutputMaxLines()

    if (maxLines === 0) return []
    if (lines.length <= maxLines) return lines

    const omittedLines = lines.length - maxLines
    const plural = omittedLines === 1 ? "" : "s"

    return [
      `... ${omittedLines} console output line${plural} omitted ...`,
      ...lines.slice(-maxLines)
    ]
  }

  /**
   * Runs print failed console output.
   * @param {object} args - Options object.
   * @param {string} args.consoleOutput - Console output.
   * @param {string} args.leftPadding - Left padding.
   * @returns {void} - No return value.
   */
  printFailedConsoleOutput({consoleOutput, leftPadding}) {
    if (testConfig.consoleOutput !== "failure") return
    if (!consoleOutput) return

    const lines = this.truncateFailedConsoleOutputLines(consoleOutput)

    if (lines.length === 0) return

    console.error(picocolors.red(`${leftPadding}  Console output:`))

    for (const line of lines) {
      console.error(picocolors.red(`${leftPadding}    ${line}`))
    }
  }

}
