// @ts-check
import fs from "node:fs/promises";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createTestContext, defaultTestContext } from "@velocious/testing";
import { TestRunner as PackageTestRunner } from "@velocious/testing/runner";
import Application from "../../src/application.js";
import RequestClient from "./request-client.js";
import picocolors from "picocolors";
import restArgsError from "../utils/rest-args-error.js";
import { testConfig } from "./test.js";
import { fileURLToPath, pathToFileURL } from "url";
import SharedTransactionBroker from "./shared-transaction-broker.js";
import { SHARED_TRANSACTION_BROKER_ENV } from "./shared-transaction-proxy-driver.js";
import VelociousAttemptExecutor from "./velocious-attempt-executor.js";
import VelociousRunnerReporter, { AbortRemainingTestsError } from "./velocious-runner-reporter.js";
import VelociousSuiteHookExecutor from "./velocious-suite-hook-executor.js";
import VelociousTestArguments from "./velocious-test-arguments.js";
/** @typedef {typeof defaultTestContext} PackageTestContext */
/** @typedef {(typeof defaultTestContext.registry.suites)[number]} PackageSuiteDeclaration */
/** @typedef {PackageSuiteDeclaration["tests"][number]} PackageTestDeclaration */
/** @typedef {PackageSuiteDeclaration["hooks"]["beforeAll"][number]} PackageHookDeclaration */
/** @typedef {PackageSuiteDeclaration | PackageTestDeclaration | PackageHookDeclaration} PackageRegistration */
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
        .slice(0, 80) || "failed-test";
}
export default class TestRunner {
    /** @type {PackageTestContext} */
    _context;
    /**
     * Narrows the runtime value to the documented type.
     * @type {FailedTestDetail[]} */
    _failedTestDetails;
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
    constructor({ configuration, context = defaultTestContext, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, profiler, ...restArgs }) {
        restArgsError(restArgs);
        if (!configuration)
            throw new Error("configuration is required");
        this._configuration = configuration;
        this._context = context;
        this._sharedTransactionCoordinatorOwnerStorage = new AsyncLocalStorage();
        this._testDatabaseAccessScopeStorage = new AsyncLocalStorage();
        this._excludeTags = this.normalizeTags(excludeTags);
        this._includeTags = this.normalizeTags(includeTags);
        this._testFiles = testFiles;
        this._lineFilters = lineFilters || {};
        this._examplePatterns = examplePatterns || [];
        this._profiler = profiler;
        this._abortRemainingTests = false;
        this._failedTests = 0;
        this._successfulTests = 0;
        this._testsCount = 0;
        this._failedTestDetails = [];
        /** @type {{fullDescription: string, filePath: string, line: number} | null} */
        this._lastTestContext = null;
        /** @type {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} */
        this._testDurations = [];
        /** @type {WeakMap<PackageTestDeclaration, {testArgs: TestArgs, testData: TestData}>} */
        this._testCompatibility = new WeakMap();
        /** @type {WeakSet<PackageTestDeclaration>} */
        this._injectedTests = new WeakSet();
        /** @type {WeakSet<PackageTestDeclaration>} */
        this._completedTests = new WeakSet();
        /** @type {WeakMap<PackageTestDeclaration, {descriptions: string[], testDescription: string, fullDescription: string, ownerFilePath: string | undefined, suites: PackageSuiteDeclaration[]}>} */
        this._testMetadata = new WeakMap();
        /** @type {WeakMap<PackageHookDeclaration, {declarationIndex: number, declarationScopeId: string | undefined, ownerFilePath: string | undefined}>} */
        this._hookMetadata = new WeakMap();
        /** @type {WeakMap<PackageTestDeclaration, Map<number, {abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean}>>} */
        this._attemptOutcomes = new WeakMap();
        /** @type {Array<{suite: PackageSuiteDeclaration, phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} */
        this._suiteHookFailures = [];
        /** @type {Map<string, PackageTestDeclaration[]>} */
        this._testsByFullName = new Map();
        /** @type {WeakMap<PackageRegistration, string>} */
        this._declarationOwners = new WeakMap();
        /** @type {PackageTestRunner | undefined} */
        this._packageRunner = undefined;
        /** @type {import("@velocious/testing/runner").TestRunResult | undefined} */
        this._packageResult = undefined;
        /** @type {Map<string, TestData> | undefined} */
        this._legacyFixtureDataByFullName = undefined;
        /** @type {{filePath?: string, line?: number}} */
        this._legacyFixtureLocation = {};
        this._attemptExecutor = new VelociousAttemptExecutor({ testRunner: this });
        this._runnerReporter = new VelociousRunnerReporter({ testRunner: this });
        this._suiteHookExecutor = new VelociousSuiteHookExecutor({ testRunner: this });
        this._testArguments = new VelociousTestArguments({ testRunner: this });
    }
    /**
     * Gets the package declaration context.
     * @returns {PackageTestContext} - Package declaration context.
     */
    getTestContext() { return this._context; }
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} - The configuration.
     */
    getConfiguration() { return this._configuration; }
    /**
     * Runs get test files.
     * @returns {string[]} - The test files.
     */
    getTestFiles() { return this._testFiles; }
    /**
     * Runs get line filters.
     * @returns {Record<string, number[]>} - Line filters.
     */
    getLineFilters() { return this._lineFilters; }
    /**
     * Runs get example patterns.
     * @returns {RegExp[]} - Example patterns.
     */
    getExamplePatterns() { return this._examplePatterns; }
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
        if (!this._profiler)
            return await callback();
        return await this._profiler.runSpan(metadata, callback);
    }
    /**
     * Runs normalize tags.
     * @param {string[] | string | undefined} tags - Tags.
     * @returns {string[]} - Normalized tags.
     */
    normalizeTags(tags) {
        if (!tags)
            return [];
        const values = [];
        const rawTags = Array.isArray(tags) ? tags : [tags];
        for (const rawTag of rawTags) {
            if (rawTag === undefined || rawTag === null)
                continue;
            const parts = String(rawTag).split(",");
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed)
                    values.push(trimmed);
            }
        }
        return Array.from(new Set(values));
    }
    /**
     * Runs has tag.
     * @param {TestArgs} testArgs - Test args.
     * @param {string} tag - Tag to check for.
     * @returns {boolean} - Whether tag is present.
     */
    hasTag(testArgs, tag) {
        return this.normalizeTags(testArgs?.tags).includes(tag);
    }
    /**
     * Runs is browser test mode.
     * @returns {boolean} - Whether running browser tests.
     */
    isBrowserTestMode() {
        return process.env.VELOCIOUS_BROWSER_TESTS === "true";
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
            await callback();
            return;
        }
        if (this.isBrowserTestMode()) {
            await this.runBrowserDummy(testArgs, callback, browserDummyConnectionRegistrations);
            return;
        }
        await this.runNodeDummy(callback);
    }
    /**
     * Runs run node dummy.
     * @param {() => Promise<void>} callback - Callback to run.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async runNodeDummy(callback) {
        const dummyPath = process.env.VELOCIOUS_DUMMY_PATH || this.defaultDummyPath();
        const dummyImport = await import(pathToFileURL(dummyPath).href);
        const Dummy = dummyImport.default;
        if (!Dummy?.run) {
            throw new Error(`Dummy helper not found at ${dummyPath}`);
        }
        // Persistent server resources must not inherit an attempt scope that will be revoked.
        await this.getConfiguration().getEnvironmentHandler().runWithCapturedTestDatabaseAccessScope(undefined, async () => {
            await Dummy.run(async () => { });
        });
        this.getConfiguration().assertDatabaseAccessAllowed();
        await callback();
    }
    /**
     * Runs default dummy path.
     * @returns {string} - Default dummy helper path.
     */
    defaultDummyPath() {
        const cwd = path.resolve(process.cwd());
        const normalized = cwd.split(path.sep).join("/");
        if (normalized.endsWith("/spec/dummy")) {
            return path.join(cwd, "index.js");
        }
        return path.join(cwd, "spec/dummy/index.js");
    }
    /**
     * Runs run browser dummy.
     * @param {TestArgs} testArgs - Test args.
     * @param {() => Promise<void>} callback - Callback to run.
     * @param {BrowserDummyConnectionRegistration[]} connectionRegistrations - Attempt-owned browser connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async runBrowserDummy(testArgs, callback, connectionRegistrations) {
        const useTransaction = testArgs.databaseCleaning?.transaction === true;
        const truncate = testArgs.databaseCleaning?.truncate;
        const shouldTruncate = truncate === undefined ? !useTransaction : truncate;
        if (!useTransaction && !shouldTruncate) {
            await callback();
            return;
        }
        await this.getConfiguration().ensureConnections({ name: "Test runner browser dummy" }, async (dbs) => {
            const newRegistrations = Object.entries(dbs).map(([databaseIdentifier, db]) => {
                /** @type {BrowserDummyConnectionRegistration} */
                const registration = {
                    databaseIdentifier,
                    db,
                    quarantined: false
                };
                connectionRegistrations.push(registration);
                return registration;
            });
            if (shouldTruncate) {
                this.getConfiguration().assertDatabaseAccessAllowed();
                await this.truncateDatabases(dbs);
            }
            /** @type {unknown[]} */
            const lifecycleErrors = [];
            try {
                if (useTransaction) {
                    const startPromises = newRegistrations.map((registration) => {
                        const startPromise = registration.db.startTransaction();
                        registration.startPromise = startPromise;
                        return startPromise;
                    });
                    const startResults = await Promise.allSettled(startPromises);
                    const startErrors = startResults
                        .filter((result) => result.status === "rejected")
                        .map((result) => result.reason);
                    if (startErrors.length == 1)
                        throw startErrors[0];
                    if (startErrors.length > 1) {
                        throw new AggregateError(startErrors, "Browser dummy transaction startup failed", { cause: startErrors[0] });
                    }
                }
                this.getConfiguration().assertDatabaseAccessAllowed();
                await callback();
            }
            catch (error) {
                lifecycleErrors.push(error);
            }
            try {
                await this.rollbackBrowserDummyTransactions(connectionRegistrations);
            }
            catch (error) {
                if (error instanceof AggregateError) {
                    lifecycleErrors.push(...error.errors);
                }
                else {
                    lifecycleErrors.push(error);
                }
            }
            try {
                if (shouldTruncate) {
                    this.getConfiguration().assertDatabaseAccessAllowed();
                    await this.truncateDatabases(dbs);
                }
            }
            catch (error) {
                lifecycleErrors.push(error);
            }
            if (lifecycleErrors.length == 1)
                throw lifecycleErrors[0];
            if (lifecycleErrors.length > 1) {
                throw new AggregateError(lifecycleErrors, "Browser dummy lifecycle and cleanup failed", { cause: lifecycleErrors[0] });
            }
        });
    }
    /**
     * Rolls back every attempt-owned browser transaction exactly once.
     * @param {BrowserDummyConnectionRegistration[]} registrations - Browser connections.
     * @returns {Promise<void>} - Resolves after all rollbacks settle.
     */
    async rollbackBrowserDummyTransactions(registrations) {
        const rollbackResults = await Promise.allSettled([...registrations].reverse().map((registration) => {
            const startPromise = registration.startPromise;
            if (!startPromise)
                return;
            registration.rollbackPromise ??= (async () => {
                if (registration.quarantined)
                    return;
                try {
                    await startPromise;
                }
                catch {
                    try {
                        await this.quarantineBrowserDummyConnection(registration);
                    }
                    catch (quarantineError) {
                        throw new Error(`Failed to quarantine browser dummy database after transaction startup failed: ${registration.databaseIdentifier}`, { cause: quarantineError });
                    }
                    return;
                }
                if (registration.quarantined)
                    return;
                try {
                    await registration.db.rollbackTransaction();
                }
                catch (rollbackError) {
                    try {
                        await this.quarantineBrowserDummyConnection(registration);
                    }
                    catch (quarantineError) {
                        throw new AggregateError([rollbackError, quarantineError], `Failed to roll back and quarantine browser dummy database: ${registration.databaseIdentifier}`, { cause: quarantineError });
                    }
                    throw rollbackError;
                }
            })();
            return registration.rollbackPromise;
        }));
        const errors = rollbackResults
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
        if (errors.length == 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Browser dummy transaction cleanup failed", { cause: errors[0] });
    }
    /**
     * Permanently removes one browser connection that cannot be shared safely.
     * @param {BrowserDummyConnectionRegistration} registration - Browser connection registration.
     * @returns {Promise<void>} - Resolves after the connection is discarded.
     */
    async quarantineBrowserDummyConnection(registration) {
        registration.quarantined = true;
        registration.quarantinePromise ??= this.discardBrowserDummyConnection(registration.databaseIdentifier, registration.db);
        await registration.quarantinePromise;
    }
    /**
     * Discards one browser dummy connection through its owning pool.
     * @param {string} databaseIdentifier - Configured database identifier.
     * @param {import("../database/drivers/base.js").default} db - Unsafe connection.
     * @returns {Promise<void>} - Resolves after discard.
     */
    async discardBrowserDummyConnection(databaseIdentifier, db) {
        await this.getConfiguration().getDatabasePool(databaseIdentifier).discard(db);
    }
    /**
     * Quarantines all browser connections concurrently.
     * @param {BrowserDummyConnectionRegistration[]} registrations - Browser connection registrations.
     * @returns {Promise<void>} - Resolves after every connection is discarded.
     */
    async quarantineBrowserDummyConnections(registrations) {
        const quarantineResults = await Promise.allSettled(registrations.map(async (registration) => {
            await this.quarantineBrowserDummyConnection(registration);
        }));
        const errors = quarantineResults
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
        if (errors.length == 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Browser dummy connection quarantine failed", { cause: errors[0] });
    }
    /**
     * Runs truncate databases.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Database connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async truncateDatabases(dbs) {
        for (const identifier of Object.keys(dbs)) {
            await dbs[identifier].truncateAllTables();
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
        const configTags = Array.isArray(testConfig.excludeTags) ? testConfig.excludeTags : [];
        return new Set([...this._excludeTags, ...configTags]);
    }
    /**
     * Runs build full description.
     * @param {string[]} descriptions - Description stack.
     * @param {string} testDescription - Test description.
     * @returns {string} - Full description.
     */
    buildFullDescription(descriptions, testDescription) {
        const parts = descriptions.concat([testDescription]);
        return parts.join(" ").trim();
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
                httpServer: { inProcess: true, port: 31006 },
                type: "test-runner"
            });
            await this._application.initialize();
            await this._application.startHttpServer();
        }
        return this._application;
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
        const configuration = this.getConfiguration();
        const currentConnections = configuration.getCurrentConnections();
        /** @type {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} */
        const registrations = [];
        for (const identifier of Object.keys(currentConnections)) {
            const pool = configuration.getDatabasePool(identifier);
            // Tenant-scoped pools resolve a different connection per request tenant
            // (via runWithTenant), so forcing a single shared connection would break
            // per-request tenant resolution. Only share non-tenant pools; the tenant
            // pool keeps resolving its own connection per request.
            if (pool.getConfiguration().tenantOnly) {
                continue;
            }
            const connection = currentConnections[identifier];
            const registration = pool.setTestSharedConnectionProvider(() => {
                return connection.insideTransaction() ? connection : undefined;
            });
            if (registration)
                registrations.push({ pool, registration });
        }
        return registrations;
    }
    /**
     * Clears the in-process test shared connection on every configured pool. Idempotent and
     * safe to call when none was set.
     * @param {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} [registrations] - Lifecycle-owned registrations to clear conditionally.
     * @returns {void}
     */
    clearTestSharedConnections(registrations) {
        if (registrations) {
            for (const { pool, registration } of registrations) {
                pool.clearTestSharedConnection(registration);
            }
            return;
        }
        const configuration = this.getConfiguration();
        for (const identifier of configuration.getDatabaseIdentifiers()) {
            configuration.getDatabasePool(identifier).clearTestSharedConnection();
        }
    }
    /**
     * Checks out and registers one physical tenant transaction for the current attempt.
     * @param {{databaseIdentifier: string, tenant: object}} args - Logical identifier and tenant descriptor.
     * @param {TransactionalTenantRegistration[]} registrations - Current attempt registrations.
     * @returns {Promise<void>}
     */
    async registerTransactionalTenant({ databaseIdentifier, tenant, ...restArgs }, registrations) {
        restArgsError(restArgs);
        if (!databaseIdentifier)
            throw new Error("registerTransactionalTenant requires a databaseIdentifier");
        if (!tenant)
            throw new Error("registerTransactionalTenant requires a tenant");
        const configuration = this.getConfiguration();
        const pool = configuration.getDatabasePool(databaseIdentifier);
        const databaseConfiguration = configuration.resolveDatabaseConfiguration(databaseIdentifier, tenant);
        if (!databaseConfiguration.tenantOnly) {
            throw new Error(`registerTransactionalTenant requires a tenantOnly database: ${databaseIdentifier}`);
        }
        const reuseKey = pool.getConfigurationReuseKey(databaseConfiguration);
        if (registrations.some((registration) => registration.pool === pool && registration.reuseKey === reuseKey))
            return;
        /** @type {TransactionalTenantRegistration} */
        const registration = {
            connection: undefined,
            pool,
            reuseKey,
            revoked: false,
            sharedRegistration: undefined
        };
        registrations.push(registration);
        registration.checkoutPromise = pool
            .checkoutForConfiguration(databaseConfiguration, { name: "Transactional tenant test registration" })
            .then((connection) => ({ connection, error: undefined }), (error) => ({
            connection: undefined,
            error: error instanceof Error ? error : new Error("Transactional tenant connection checkout failed", { cause: error })
        }));
        try {
            const checkoutOutcome = await registration.checkoutPromise;
            if (checkoutOutcome.error)
                throw checkoutOutcome.error;
            if (!checkoutOutcome.connection)
                throw new Error("Transactional tenant connection checkout returned no connection");
            registration.connection = checkoutOutcome.connection;
            if (registration.revoked)
                throw new Error("Transactional tenant test registration attempt is no longer active");
            await registration.connection.startTransaction();
            if (registration.revoked)
                throw new Error("Transactional tenant test registration attempt is no longer active");
            const sharedRegistration = pool.setTestSharedConnectionForConfiguration(registration.connection, reuseKey);
            if (!sharedRegistration)
                throw new Error(`Database pool does not support transactional tenant test connections: ${databaseIdentifier}`);
            registration.sharedRegistration = sharedRegistration;
            if (registration.revoked) {
                pool.clearTestSharedConnection(sharedRegistration);
                throw new Error("Transactional tenant test registration attempt is no longer active");
            }
        }
        catch (error) {
            registration.revoked = true;
            try {
                await this.cleanupTransactionalTenants([registration], { discard: registration.discardOnCleanup === true });
            }
            catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "Failed to register and clean up a transactional tenant test connection", { cause: cleanupError });
            }
            throw error;
        }
    }
    /**
     * Revokes attempt registrations before rolling back and releasing their connections.
     * @param {TransactionalTenantRegistration[]} registrations - Attempt registrations.
     * @param {{discard?: boolean}} [options] - Whether connections must be discarded instead of returned to the pool.
     * @returns {Promise<void>}
     */
    async cleanupTransactionalTenants(registrations, { discard = false } = {}) {
        for (const registration of registrations) {
            registration.revoked = true;
            if (discard)
                registration.discardOnCleanup = true;
            if (registration.sharedRegistration)
                registration.pool.clearTestSharedConnection(registration.sharedRegistration);
        }
        const cleanupResults = await Promise.allSettled([...registrations].reverse().map((registration) => {
            registration.cleanupPromise ??= this.cleanupTransactionalTenantRegistration(registration);
            return registration.cleanupPromise;
        }));
        const errors = cleanupResults
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Failed to clean up transactional tenant test connections");
    }
    /**
     * Cleans one attempt registration exactly once, including a checkout that was still pending at revocation.
     * @param {TransactionalTenantRegistration} registration - Attempt-owned registration.
     * @returns {Promise<void>} - Resolves after rollback and release or quarantine.
     */
    async cleanupTransactionalTenantRegistration(registration) {
        let connection = registration.connection;
        if (!connection && registration.checkoutPromise) {
            const checkoutOutcome = await registration.checkoutPromise;
            if (checkoutOutcome.error)
                return;
            connection = checkoutOutcome.connection;
            registration.connection = connection;
        }
        if (!connection)
            return;
        const errors = [];
        try {
            if (connection.insideTransaction())
                await connection.rollbackTransaction();
        }
        catch (error) {
            errors.push(error);
        }
        finally {
            try {
                if (registration.discardOnCleanup) {
                    await registration.pool.discard(connection);
                }
                else {
                    await registration.pool.checkin(connection);
                }
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Failed to clean up a transactional tenant test connection");
    }
    /**
     * Selects the current non-tenant connections eligible for shared transaction work.
     * @param {{transactionsOnly: boolean}} args - Selection options.
     * @returns {Record<string, import("../database/drivers/base.js").default>} - Eligible connections by identifier.
     */
    sharedTransactionConnections({ transactionsOnly }) {
        const configuration = this.getConfiguration();
        const currentConnections = configuration.getCurrentConnections();
        /** @type {Record<string, import("../database/drivers/base.js").default>} */
        const connections = {};
        for (const [identifier, connection] of Object.entries(currentConnections)) {
            const pool = configuration.getDatabasePool(identifier);
            if (pool.getConfiguration().tenantOnly)
                continue;
            if (transactionsOnly && !connection.insideTransaction())
                continue;
            connections[identifier] = connection;
        }
        return connections;
    }
    /**
     * Installs physical-connection coordination before a transaction-opening hook
     * can expose the shared connection to a long-lived in-process service.
     * Child-process coordinates remain unpublished until the transaction exists.
     * @returns {Promise<SharedTransactionBrokerRegistration | undefined>} - Prepared coordinator.
     */
    async prepareSharedTransactionBroker() {
        const connections = this.sharedTransactionConnections({ transactionsOnly: false });
        if (Object.keys(connections).length === 0)
            return undefined;
        return {
            broker: await SharedTransactionBroker.start({ connections }),
            environmentPublished: false,
            previousEnvironment: undefined
        };
    }
    /**
     * Checks whether a prepared broker coordinates exactly the selected physical connections.
     * @param {SharedTransactionBrokerRegistration | undefined} registration - Prepared coordinator.
     * @param {Record<string, import("../database/drivers/base.js").default>} connections - Selected connections.
     * @returns {boolean} - Whether the identifier set and physical connections match exactly.
     */
    sharedTransactionBrokerMatchesConnections(registration, connections) {
        const identifiers = Object.keys(connections);
        if (!registration || identifiers.length === 0)
            return false;
        if (Object.keys(registration.broker.connections).length !== identifiers.length)
            return false;
        for (const [identifier, connection] of Object.entries(connections)) {
            if (registration.broker.connections[identifier] !== connection)
                return false;
        }
        return true;
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
        const connections = selectedConnections || this.sharedTransactionConnections({ transactionsOnly: true });
        const databaseIdentifiers = Object.keys(connections);
        if (databaseIdentifiers.length === 0) {
            await this.stopSharedTransactionBroker(preparedRegistration);
            return undefined;
        }
        let broker;
        if (preparedRegistration && this.sharedTransactionBrokerMatchesConnections(preparedRegistration, connections)) {
            broker = preparedRegistration.broker;
        }
        else {
            await this.stopSharedTransactionBroker(preparedRegistration);
            broker = await SharedTransactionBroker.start({ connections });
        }
        const previousEnvironment = process.env[SHARED_TRANSACTION_BROKER_ENV];
        process.env[SHARED_TRANSACTION_BROKER_ENV] = Buffer.from(JSON.stringify({
            address: broker.address(),
            capability: broker.capability(),
            databaseIdentifiers,
            expected: true
        })).toString("base64url");
        return { broker, environmentPublished: true, previousEnvironment };
    }
    /**
     * Revokes an attempt broker before database rollback hooks run and restores
     * the caller's environment so later pooled/spawned children cannot inherit it.
     * @param {SharedTransactionBrokerRegistration | undefined} registration - Attempt registration.
     */
    async stopSharedTransactionBroker(registration) {
        if (!registration)
            return;
        if (registration.environmentPublished) {
            if (registration.previousEnvironment === undefined) {
                delete process.env[SHARED_TRANSACTION_BROKER_ENV];
            }
            else {
                process.env[SHARED_TRANSACTION_BROKER_ENV] = registration.previousEnvironment;
            }
        }
        await registration.broker.close();
    }
    /**
     * Runs request client.
     * @returns {Promise<RequestClient>} - Resolves with the request client.
     */
    async requestClient() {
        if (!this._requestClient) {
            this._requestClient = new RequestClient();
        }
        return this._requestClient;
    }
    /**
     * Runs import test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async importTestFiles() {
        const environmentHandler = this.getConfiguration().getEnvironmentHandler();
        if (!this._profiler) {
            await environmentHandler.importTestFiles(this.getTestFiles());
            return;
        }
        for (const testFile of this.getTestFiles()) {
            const existingRegistrations = this.testRegistrationObjects();
            await this._profiler.measurePhase("imports", async () => {
                await environmentHandler.importTestFiles([testFile]);
            }, { filePath: testFile });
            this.assignTestRegistrationOwnership(existingRegistrations, testFile);
        }
    }
    /**
     * Collects package declaration objects by identity.
     * @param {Set<PackageRegistration>} [registrations] - Accumulated identities.
     * @returns {Set<PackageRegistration>} - Registration identities.
     */
    testRegistrationObjects(registrations = new Set()) {
        const visit = (/** @type {PackageSuiteDeclaration} */ suite) => {
            registrations.add(suite);
            for (const hook of [...suite.hooks.beforeAll, ...suite.hooks.beforeEach, ...suite.hooks.afterEach, ...suite.hooks.afterAll]) {
                registrations.add(hook);
            }
            for (const testDeclaration of suite.tests)
                registrations.add(testDeclaration);
            for (const childSuite of suite.suites)
                visit(childSuite);
        };
        for (const suite of this.getTestContext().registry.suites)
            visit(suite);
        return registrations;
    }
    /**
     * Assigns deterministic ownership to package declarations added by one entry file.
     * @param {Set<PackageRegistration>} previousRegistrations - Identities present before import.
     * @param {string} ownerFilePath - Importing entry file.
     * @returns {void}
     */
    assignTestRegistrationOwnership(previousRegistrations, ownerFilePath) {
        for (const registration of this.testRegistrationObjects()) {
            if (!previousRegistrations.has(registration))
                this._declarationOwners.set(registration, ownerFilePath);
        }
    }
    /**
     * Runs is failed.
     * @returns {boolean} - Whether failed.
     */
    isFailed() { return this._failedTests !== undefined && (this._failedTests > 0 || this._packageResult?.status === "failed"); }
    /**
     * Runs get failed tests.
     * @returns {number} - The failed tests.
     */
    getFailedTests() {
        if (this._failedTests === undefined)
            throw new Error("Tests hasn't been run yet");
        return this._failedTests;
    }
    /**
     * Runs get failed test details.
     * @returns {FailedTestDetail[]} - Failed test details.
     */
    getFailedTestDetails() {
        return this._failedTestDetails;
    }
    /**
     * Runs persist failed test console outputs to assets.
     * @param {object} [args] - Options object.
     * @param {string} [args.assetsPath] - Assets directory path.
     * @returns {Promise<string[]>} - Written log file paths.
     */
    async persistFailedTestConsoleOutputsToAssets({ assetsPath = path.join(process.cwd(), "tmp/screenshots") } = {}) {
        const failedTestDetails = this.getFailedTestDetails();
        const writtenLogPaths = [];
        let createdDirectory = false;
        for (let index = 0; index < failedTestDetails.length; index++) {
            const failedTestDetail = failedTestDetails[index];
            const consoleOutput = failedTestDetail.consoleOutput;
            if (!consoleOutput)
                continue;
            if (!createdDirectory) {
                await fs.mkdir(assetsPath, { recursive: true });
                createdDirectory = true;
            }
            const now = new Date();
            const timestamp = [
                String(now.getFullYear()),
                String(now.getMonth() + 1).padStart(2, "0"),
                String(now.getDate()).padStart(2, "0"),
                String(now.getHours()).padStart(2, "0"),
                String(now.getMinutes()).padStart(2, "0"),
                String(now.getSeconds()).padStart(2, "0"),
                String(now.getMilliseconds()).padStart(3, "0")
            ].join("");
            const slug = toFileSlug(failedTestDetail.fullDescription);
            const fileName = `${timestamp}-${String(index + 1).padStart(2, "0")}-${slug}.console.log`;
            const filePath = path.join(assetsPath, fileName);
            await fs.writeFile(filePath, consoleOutput, "utf8");
            failedTestDetail.consoleLogPath = filePath;
            writtenLogPaths.push(filePath);
        }
        return writtenLogPaths;
    }
    /**
     * Runs get successful tests.
     * @returns {number} - The successful tests.
     */
    getSuccessfulTests() {
        if (this._successfulTests === undefined)
            throw new Error("Tests hasn't been run yet");
        return this._successfulTests;
    }
    /**
     * Runs get tests count.
     * @returns {number} - The tests count.
     */
    getTestsCount() {
        if (this._testsCount === undefined)
            throw new Error("Tests hasn't been run yet");
        return this._testsCount;
    }
    /**
     * Runs get executed tests count.
     * @returns {number} - The executed tests count.
     */
    getExecutedTestsCount() {
        return this._testDurations.length;
    }
    /**
     * Returns the tests recorded during the run, slowest first.
     * @param {number} [limit] - Maximum number of tests to return (0 returns all).
     * @returns {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} - Slowest tests, slowest first.
     */
    getSlowestTests(limit = 10) {
        const sorted = [...this._testDurations].sort((testA, testB) => testB.durationMs - testA.durationMs);
        return limit > 0 ? sorted.slice(0, limit) : sorted;
    }
    /**
     * Runs prepare.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async prepare() {
        this.anyTestsFocussed = false;
        this._failedTests = 0;
        this._successfulTests = 0;
        this._testsCount = 0;
        this._abortRemainingTests = false;
        this._failedTestDetails = [];
        this._testDurations = [];
        this._testCompatibility = new WeakMap();
        this._injectedTests = new WeakSet();
        this._completedTests = new WeakSet();
        this._testMetadata = new WeakMap();
        this._hookMetadata = new WeakMap();
        this._attemptOutcomes = new WeakMap();
        this._suiteHookFailures = [];
        this._testsByFullName = new Map();
        this._packageResult = undefined;
        const context = this.getTestContext();
        /** @type {string | undefined} */
        let ownerFilePath;
        context.reset({ config: true });
        context.setDeclarationLocator(() => this.captureTestDeclarationLocation(ownerFilePath));
        const testingConfigPath = this.getConfiguration().getTesting();
        await context.describe("", { databaseCleaning: { transaction: true } }, async () => {
            if (testingConfigPath) {
                await this.runProfileSpan({ phase: "testing config/global setup" }, async () => {
                    await this.getConfiguration().getEnvironmentHandler().importTestingConfigPath();
                });
            }
            if (!this._profiler) {
                await this.importTestFiles();
            }
            else {
                for (const testFile of this.getTestFiles()) {
                    ownerFilePath = testFile;
                    const existingRegistrations = this.testRegistrationObjects();
                    await this._profiler.measurePhase("imports", async () => {
                        await this.getConfiguration().getEnvironmentHandler().importTestFiles([testFile]);
                    }, { filePath: testFile });
                    this.assignTestRegistrationOwnership(existingRegistrations, testFile);
                }
            }
        });
        ownerFilePath = undefined;
        this.analyzeDeclarations();
    }
    /**
     * Captures a test source location without attributing package/facade frames.
     * @param {string | undefined} ownerFilePath - Importing entry file fallback.
     * @returns {{filePath?: string, line?: number}} - Declaration location.
     */
    captureTestDeclarationLocation(ownerFilePath) {
        const stack = new Error().stack?.split("\n") || [];
        for (const stackLine of stack) {
            const match = stackLine.match(/(?:\(|\s)(file:\/\/.*?|\/[^"]*?):(\d+):(\d+)\)?$/u);
            if (!match)
                continue;
            let filePath = match[1];
            if (filePath.startsWith("file://")) {
                try {
                    filePath = fileURLToPath(filePath);
                }
                catch {
                    continue;
                }
            }
            const resolvedFilePath = path.resolve(filePath);
            const portablePath = resolvedFilePath.replaceAll(path.sep, "/");
            if (portablePath.endsWith("/src/testing/test-runner.js"))
                continue;
            if (portablePath.endsWith("/src/testing/test.js"))
                continue;
            if (portablePath.includes("/node_modules/@velocious/testing/"))
                continue;
            return { filePath: resolvedFilePath, line: Number(match[2]) };
        }
        return ownerFilePath ? { filePath: ownerFilePath } : {};
    }
    /**
     * Runs are any tests focussed.
     * @returns {boolean} - Whether any tests focussed.
     */
    areAnyTestsFocussed() {
        if (this.anyTestsFocussed === undefined) {
            throw new Error("Hasn't been detected yet");
        }
        return this.anyTestsFocussed;
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
        const error = reason instanceof Error ? reason : new Error(`${kind}: ${String(reason)}`);
        const near = this._lastTestContext;
        const attribution = near ? `, near test: ${near.fullDescription} (${near.filePath}:${near.line})` : "";
        this._failedTests = (this._failedTests || 0) + 1;
        this._failedTestDetails.push({
            fullDescription: `<${kind} during test run${attribution}>`,
            filePath: near ? near.filePath : "<test runner>",
            line: near ? near.line : 0,
            error,
            consoleOutput: undefined
        });
        console.error(picocolors.red(`\n[test-runner] ${kind} during the test run — this would otherwise terminate the process silently and surface only as a crashed/retried shard with zero reported failures.${attribution}`));
        console.error(error);
    }
    /**
     * Records a cleanup failure after timeout handling has begun.
     * @param {unknown} reason - Detached cleanup rejection.
     * @param {string} cleanupName - Cleanup operation name.
     * @param {Set<Error>} [recordedErrors] - Attempt-owned cleanup errors already reported.
     * @returns {void}
     */
    recordTimeoutCleanupFailure(reason, cleanupName, recordedErrors) {
        const error = reason instanceof Error ? reason : new Error(`${cleanupName} cleanup failed: ${String(reason)}`);
        if (recordedErrors) {
            // Multiple bounded observers can receive the same detached cleanup rejection.
            if (recordedErrors.has(error))
                return;
            recordedErrors.add(error);
        }
        const near = this._lastTestContext;
        const attribution = near ? `, near test: ${near.fullDescription} (${near.filePath}:${near.line})` : "";
        this._failedTests = (this._failedTests || 0) + 1;
        this._failedTestDetails.push({
            fullDescription: `<${cleanupName} emergency cleanup failure${attribution}>`,
            filePath: near ? near.filePath : "<test runner>",
            line: near ? near.line : 0,
            error,
            consoleOutput: undefined
        });
        console.error(picocolors.red(`\n[test-runner] ${cleanupName} cleanup failed after timeout handling began.${attribution}`));
        console.error(error);
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
            if (process.listenerCount("unhandledRejection") > 1)
                return;
            this.recordAsyncCrash("unhandledRejection", reason);
        };
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
            if (process.listenerCount("uncaughtException") > 1)
                return;
            this.recordAsyncCrash("uncaughtException", error);
        };
        process.on("unhandledRejection", onUnhandledRejection);
        process.on("uncaughtException", onUncaughtException);
        try {
            await this.runPackageTests();
            // A rejection scheduled by the final test (a detached rejected promise,
            // or an afterCommit callback rejecting as the suite drains) is reported
            // by Node on a LATER turn. Drain a few turns while the handler is still
            // attached so those late rejections are recorded instead of escaping to
            // the default crash path after cleanup.
            for (let drainTurn = 0; drainTurn < 3; drainTurn++) {
                await new Promise((resolve) => setImmediate(resolve));
            }
        }
        finally {
            process.off("unhandledRejection", onUnhandledRejection);
            process.off("uncaughtException", onUncaughtException);
        }
    }
    /**
     * Runs run after alls for active scopes.
     * @returns {Promise<void>} - Resolves when cleanup hooks finish.
     */
    async runAfterAllsForActiveScopes() {
        const failureStart = this._suiteHookFailures.length;
        await this._packageRunner?.cleanupActiveSuites();
        this.throwAfterAllFailures(this._suiteHookFailures.slice(failureStart));
    }
    /** Builds declaration metadata used only by framework adapters and projections. */
    analyzeDeclarations() {
        const visit = (/** @type {PackageSuiteDeclaration} */ suite, /** @type {PackageSuiteDeclaration[]} */ ancestors, /** @type {string | undefined} */ parentProfileScopeId) => {
            const suites = [...ancestors, suite];
            const descriptions = suites.map((entry) => entry.name).filter((name) => name !== "");
            const ownerFilePath = this._declarationOwners.get(suite) ?? suite.location.filePath;
            const profileScopeId = this._profiler?.scopeId(suite, {
                descriptions,
                filePath: ownerFilePath,
                line: suite.location.line,
                parentId: parentProfileScopeId
            });
            for (const hooks of Object.values(suite.hooks)) {
                hooks.forEach((hook, declarationIndex) => {
                    this._hookMetadata.set(hook, {
                        declarationIndex,
                        declarationScopeId: profileScopeId,
                        ownerFilePath: this._declarationOwners.get(hook) ?? hook.location.filePath ?? ownerFilePath
                    });
                });
            }
            for (const testDeclaration of suite.tests) {
                const fullDescription = this.buildFullDescription(descriptions, testDeclaration.name);
                const declarations = this._testsByFullName.get(fullDescription) || [];
                declarations.push(testDeclaration);
                this._testsByFullName.set(fullDescription, declarations);
                this._testMetadata.set(testDeclaration, {
                    descriptions,
                    testDescription: testDeclaration.name,
                    fullDescription,
                    ownerFilePath: this._declarationOwners.get(testDeclaration) ?? testDeclaration.location.filePath ?? ownerFilePath,
                    suites
                });
                const legacyTestData = this._legacyFixtureDataByFullName?.get(fullDescription);
                if (legacyTestData) {
                    this._testCompatibility.set(testDeclaration, {
                        testArgs: this._testArguments.copy(testDeclaration),
                        testData: legacyTestData
                    });
                }
                this._testsCount++;
                if (testDeclaration.state === "run" && (testDeclaration.focus || suites.some((entry) => entry.focus))) {
                    this.anyTestsFocussed = true;
                }
            }
            for (const childSuite of suite.suites)
                visit(childSuite, suites, profileScopeId);
        };
        for (const suite of this.getTestContext().registry.suites)
            visit(suite, [], undefined);
    }
    /**
     * Gets package hook compatibility metadata.
     * @param {PackageHookDeclaration} hook - Package hook declaration.
     * @returns {{declarationIndex: number, declarationScopeId: string | undefined, ownerFilePath: string | undefined}} - Hook metadata.
     */
    hookMetadata(hook) {
        return this._hookMetadata.get(hook) || { declarationIndex: 0, declarationScopeId: undefined, ownerFilePath: hook.location.filePath };
    }
    /**
     * Gets package test compatibility metadata.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {{descriptions: string[], testDescription: string, fullDescription: string, ownerFilePath: string | undefined, suites: PackageSuiteDeclaration[]}} - Declaration metadata.
     */
    testMetadata(test) {
        const metadata = this._testMetadata.get(test);
        if (!metadata)
            throw new Error(`Missing package test metadata: ${test.name}`);
        return metadata;
    }
    /**
     * Gets stable compatibility data for a package declaration.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {{testArgs: TestArgs, testData: TestData}} - Stable compatibility data.
     */
    testData(test) {
        let compatibility = this._testCompatibility.get(test);
        if (!compatibility) {
            const testArgs = this._testArguments.copy(test);
            const metadata = this.testMetadata(test);
            const testData = {
                args: testArgs,
                declaration: test,
                filePath: test.location.filePath,
                function: test.callback,
                line: test.location.line,
                ownerFilePath: metadata.ownerFilePath
            };
            compatibility = { testArgs, testData };
            this._testCompatibility.set(test, compatibility);
        }
        return compatibility;
    }
    /**
     * Injects framework collaborators into stable compatibility data once.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {Promise<{testArgs: TestArgs, testData: TestData}>} - Injected compatibility data.
     */
    async testCompatibility(test) {
        const compatibility = this.testData(test);
        if (!this._injectedTests.has(test)) {
            await this._testArguments.inject(compatibility.testArgs);
            this._injectedTests.add(test);
        }
        return compatibility;
    }
    /**
     * Records a raw framework attempt outcome.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @param {number} attemptNumber - One-based attempt number.
     * @param {{abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean}} outcome - Raw attempt outcome.
     * @returns {void}
     */
    recordAttemptOutcome(test, attemptNumber, outcome) {
        const outcomes = this._attemptOutcomes.get(test) || new Map();
        outcomes.set(attemptNumber, outcome);
        this._attemptOutcomes.set(test, outcomes);
        if (outcome.abortRemainingTests)
            this._abortRemainingTests = true;
    }
    /**
     * Gets a raw framework attempt outcome.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @param {number} attemptNumber - One-based attempt number.
     * @returns {{abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean} | undefined} - Raw attempt outcome.
     */
    attemptOutcome(test, attemptNumber) { return this._attemptOutcomes.get(test)?.get(attemptNumber); }
    /**
     * Records a raw suite-hook failure.
     * @param {object} failure - Suite-hook failure.
     * @param {PackageSuiteDeclaration} failure.suite - Owning package suite.
     * @param {"beforeAll" | "afterAll"} failure.phase - Hook phase.
     * @param {ReturnType<typeof JSON.parse>} failure.error - Raw hook failure.
     * @returns {void}
     */
    recordSuiteHookFailure(failure) { this._suiteHookFailures.push(failure); }
    /**
     * Gets the raw ancestor setup failure for a package test.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {ReturnType<typeof JSON.parse>} - Raw setup failure.
     */
    setupFailureFor(test) {
        const suites = this.testMetadata(test).suites;
        return this._suiteHookFailures.find((failure) => failure.phase === "beforeAll" && suites.includes(failure.suite))?.error;
    }
    /**
     * Finds the next incomplete declaration with a package full name.
     * @param {string} fullName - Package full name.
     * @returns {PackageTestDeclaration | undefined} - Next matching declaration.
     */
    findTestDeclaration(fullName) {
        return this._testsByFullName.get(fullName)?.find((test) => !this._completedTests.has(test));
    }
    /**
     * Marks a package declaration complete.
     * @param {PackageTestDeclaration} test - Completed declaration.
     * @returns {void}
     */
    completeTestDeclaration(test) { this._completedTests.add(test); }
    /**
     * Gets the effective package retry count.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {number} - Effective retry count.
     */
    retryCount(test) {
        const value = test.options.retries ?? test.options.retry ?? this.getTestContext().config.retries;
        return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    }
    /**
     * Records one completed test duration.
     * @param {{durationMs: number, filePath: string, fullDescription: string, line: number}} duration - Completed test duration.
     * @returns {void}
     */
    recordTestDuration(duration) { this._testDurations.push(duration); }
    /** Records one successful package result. */
    recordSuccessfulTest() { this._successfulTests++; }
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
    recordFailedTest({ descriptions, error, consoleOutput, testData, testDescription }) {
        this._failedTests++;
        this._failedTestDetails.push({
            fullDescription: this.buildFullDescription(descriptions, testDescription),
            filePath: testData.filePath,
            line: testData.line,
            error,
            consoleOutput: consoleOutput || undefined
        });
    }
    /**
     * Stores the completed package result.
     * @param {import("@velocious/testing/runner").TestRunResult} result - Package result.
     * @returns {void}
     */
    recordPackageResult(result) { this._packageResult = result; }
    /**
     * Runs the package kernel with Velocious framework adapters.
     * @returns {Promise<void>} - Resolves after execution and teardown.
     */
    async runPackageTests() {
        const environmentHandler = this.getConfiguration().getEnvironmentHandler();
        environmentHandler.installSharedTransactionCoordinatorOwnerStorage(this._sharedTransactionCoordinatorOwnerStorage);
        environmentHandler.installTestDatabaseAccessScopeStorage(this._testDatabaseAccessScopeStorage);
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
        });
        const failureStart = this._suiteHookFailures.length;
        let result;
        try {
            result = await this._packageRunner.run();
        }
        catch (error) {
            if (!(error instanceof AbortRemainingTestsError))
                throw error;
            const afterAll = this.afterAllOutcome(this._suiteHookFailures.slice(failureStart));
            if (afterAll.failed)
                this.recordTimeoutCleanupFailure(afterAll.error, "afterAll");
            return;
        }
        this.recordPackageResult(result);
        this.throwAfterAllFailures(this._suiteHookFailures.slice(failureStart));
    }
    /**
     * Aggregates raw after-all failures without using error truthiness.
     * @param {Array<{phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} failures - Hook failures.
     * @returns {{failed: false} | {failed: true, error: ReturnType<typeof JSON.parse>}} - Explicit afterAll outcome.
     */
    afterAllOutcome(failures) {
        const afterAllErrors = failures.filter((failure) => failure.phase === "afterAll").map((failure) => failure.error);
        if (afterAllErrors.length === 0)
            return { failed: false };
        if (afterAllErrors.length === 1)
            return { failed: true, error: afterAllErrors[0] };
        return {
            failed: true,
            error: new AggregateError(afterAllErrors, "Multiple active afterAll scopes failed", { cause: afterAllErrors[0] })
        };
    }
    /**
     * Throws one raw or aggregated after-all failure.
     * @param {Array<{phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} failures - Hook failures.
     * @returns {void}
     */
    throwAfterAllFailures(failures) {
        const afterAll = this.afterAllOutcome(failures);
        if (afterAll.failed)
            throw afterAll.error;
    }
    /**
     * Compatibility helper for focused framework lifecycle specs. It converts an
     * explicit legacy fixture into isolated package declarations; the package
     * runner remains the sole execution engine.
     * @param {object} args - Legacy fixture arguments.
     * @param {TestsArgument} args.tests - Fixture tree.
     * @returns {Promise<void>} - Resolves after package execution.
     */
    async runTests({ tests }) {
        const context = createTestContext();
        const originalContext = this._context;
        context.configureTests({
            consoleOutput: originalContext.config.consoleOutput,
            defaultTimeoutMs: originalContext.config.defaultTimeoutMs,
            excludeTags: originalContext.config.excludeTags,
            failedConsoleOutputMaxLines: originalContext.config.failedConsoleOutputMaxLines,
            retries: originalContext.config.retries
        });
        this._context = context;
        this._testsCount = 0;
        this._testCompatibility = new WeakMap();
        this._injectedTests = new WeakSet();
        this._completedTests = new WeakSet();
        this._testMetadata = new WeakMap();
        this._hookMetadata = new WeakMap();
        this._attemptOutcomes = new WeakMap();
        this._suiteHookFailures = [];
        this._testsByFullName = new Map();
        this._legacyFixtureDataByFullName = new Map();
        context.setDeclarationLocator(() => this._legacyFixtureLocation);
        this.declareLegacyFixture(context, "", tests, []);
        this.analyzeDeclarations();
        try {
            await this.runPackageTests();
        }
        finally {
            this._context = originalContext;
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
        this._legacyFixtureLocation = { filePath: scope.filePath, line: scope.line };
        context.describe(name, scope.args || {}, () => {
            for (const hook of scope.beforeAlls || [])
                context.beforeAll(hook.callback);
            for (const hook of scope.beforeEaches || [])
                context.beforeEach(hook.callback);
            for (const hook of scope.afterEaches || [])
                context.afterEach(hook.callback);
            for (const hook of scope.afterAlls || [])
                context.afterAll(hook.callback);
            const nextDescriptions = name === "" ? descriptions : [...descriptions, name];
            for (const [testName, testData] of Object.entries(scope.tests || {})) {
                this._legacyFixtureLocation = { filePath: testData.filePath, line: testData.line };
                this._legacyFixtureDataByFullName?.set(this.buildFullDescription(nextDescriptions, testName), testData);
                context.it(testName, testData.args, testData.function);
            }
            for (const [suiteName, childScope] of Object.entries(scope.subs || {})) {
                this.declareLegacyFixture(context, suiteName, childScope, nextDescriptions);
            }
        });
    }
    /**
     * Runs emit event.
     * @param {string} eventName - Event name.
     * @param {object} payload - Event payload.
     * @returns {Promise<void>} - Resolves when all listeners complete.
     */
    async emitEvent(eventName, payload) {
        await this._runnerReporter.emitEvent(eventName, payload);
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
    printRerunCommand({ descriptions, testDescription, testData, leftPadding }) {
        const rerun = this.buildRerunCommand({ descriptions, testDescription, testData });
        if (rerun) {
            console.error(`${leftPadding}  Re-run: ${rerun}`);
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
    buildRerunCommand({ descriptions, testDescription, testData }) {
        const baseCommand = "npx velocious test";
        const filePath = testData.filePath;
        const line = testData.line;
        if (filePath && line) {
            const relativePath = path.relative(process.cwd(), filePath);
            return `${baseCommand} ${relativePath}:${line}`;
        }
        const fullDescription = this.buildFullDescription(descriptions, testDescription);
        if (fullDescription) {
            return `${baseCommand} --example ${JSON.stringify(fullDescription)}`;
        }
        return undefined;
    }
    /**
     * Runs build console output.
     * @param {AttemptConsoleOutput[]} attemptConsoleOutputs - Attempt output entries.
     * @returns {string} - Combined console output.
     */
    buildConsoleOutput(attemptConsoleOutputs) {
        if (attemptConsoleOutputs.length === 0)
            return "";
        if (attemptConsoleOutputs.length === 1)
            return attemptConsoleOutputs[0].output;
        return attemptConsoleOutputs.map((attemptConsoleOutput) => {
            return `--- Attempt ${attemptConsoleOutput.attemptNumber} ---\n${attemptConsoleOutput.output}`;
        }).join("\n");
    }
    /**
     * Runs get failed console output max lines.
     * @returns {number} - Maximum failed console lines.
     */
    getFailedConsoleOutputMaxLines() {
        const maxLines = testConfig.failedConsoleOutputMaxLines;
        if (typeof maxLines !== "number" || !Number.isFinite(maxLines))
            return 200;
        return Math.max(0, Math.floor(maxLines));
    }
    /**
     * Runs truncate failed console output lines.
     * @param {string} consoleOutput - Console output.
     * @returns {string[]} - Lines for inline output.
     */
    truncateFailedConsoleOutputLines(consoleOutput) {
        const lines = consoleOutput.split("\n");
        const maxLines = this.getFailedConsoleOutputMaxLines();
        if (maxLines === 0)
            return [];
        if (lines.length <= maxLines)
            return lines;
        const omittedLines = lines.length - maxLines;
        const plural = omittedLines === 1 ? "" : "s";
        return [
            `... ${omittedLines} console output line${plural} omitted ...`,
            ...lines.slice(-maxLines)
        ];
    }
    /**
     * Runs print failed console output.
     * @param {object} args - Options object.
     * @param {string} args.consoleOutput - Console output.
     * @param {string} args.leftPadding - Left padding.
     * @returns {void} - No return value.
     */
    printFailedConsoleOutput({ consoleOutput, leftPadding }) {
        if (testConfig.consoleOutput !== "failure")
            return;
        if (!consoleOutput)
            return;
        const lines = this.truncateFailedConsoleOutputLines(consoleOutput);
        if (lines.length === 0)
            return;
        console.error(picocolors.red(`${leftPadding}  Console output:`));
        for (const line of lines) {
            console.error(picocolors.red(`${leftPadding}    ${line}`));
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sRUFBQyxpQkFBaUIsRUFBRSxrQkFBa0IsRUFBQyxNQUFNLG9CQUFvQixDQUFBO0FBQ3hFLE9BQU8sRUFBQyxVQUFVLElBQUksaUJBQWlCLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RSxPQUFPLFdBQVcsTUFBTSwwQkFBMEIsQ0FBQTtBQUNsRCxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFDLFVBQVUsRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUNwQyxPQUFPLEVBQUMsYUFBYSxFQUFFLGFBQWEsRUFBQyxNQUFNLEtBQUssQ0FBQTtBQUNoRCxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3BGLE9BQU8sd0JBQXdCLE1BQU0saUNBQWlDLENBQUE7QUFDdEUsT0FBTyx1QkFBdUIsRUFBRSxFQUFDLHdCQUF3QixFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFDaEcsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLHNCQUFzQixNQUFNLCtCQUErQixDQUFBO0FBRWxFLDhEQUE4RDtBQUM5RCw2RkFBNkY7QUFDN0YsaUZBQWlGO0FBQ2pGLDhGQUE4RjtBQUM5RiwrR0FBK0c7QUFFL0c7Ozs7O0dBS0c7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QUM3QixJQUFJLEtBQUssQ0FBQyxNQUFNLElBQUksUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTFDLE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFBO1FBQzVDLE1BQU0sTUFBTSxHQUFHLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFBO1FBRTVDLE9BQU87WUFDTCxPQUFPLFlBQVksdUJBQXVCLE1BQU0sY0FBYztZQUM5RCxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQUM7U0FDMUIsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx3QkFBd0IsQ0FBQyxFQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUM7UUFDbkQsSUFBSSxVQUFVLENBQUMsYUFBYSxLQUFLLFNBQVM7WUFBRSxPQUFNO1FBQ2xELElBQUksQ0FBQyxhQUFhO1lBQUUsT0FBTTtRQUUxQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFbEUsSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRTlCLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFdBQVcsbUJBQW1CLENBQUMsQ0FBQyxDQUFBO1FBRWhFLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7WUFDekIsT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsV0FBVyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUM1RCxDQUFDO0lBQ0gsQ0FBQztDQUVGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmcy9wcm9taXNlc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQge0FzeW5jTG9jYWxTdG9yYWdlfSBmcm9tIFwibm9kZTphc3luY19ob29rc1wiXG5pbXBvcnQge2NyZWF0ZVRlc3RDb250ZXh0LCBkZWZhdWx0VGVzdENvbnRleHR9IGZyb20gXCJAdmVsb2Npb3VzL3Rlc3RpbmdcIlxuaW1wb3J0IHtUZXN0UnVubmVyIGFzIFBhY2thZ2VUZXN0UnVubmVyfSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiXG5pbXBvcnQgQXBwbGljYXRpb24gZnJvbSBcIi4uLy4uL3NyYy9hcHBsaWNhdGlvbi5qc1wiXG5pbXBvcnQgUmVxdWVzdENsaWVudCBmcm9tIFwiLi9yZXF1ZXN0LWNsaWVudC5qc1wiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7dGVzdENvbmZpZ30gZnJvbSBcIi4vdGVzdC5qc1wiXG5pbXBvcnQge2ZpbGVVUkxUb1BhdGgsIHBhdGhUb0ZpbGVVUkx9IGZyb20gXCJ1cmxcIlxuaW1wb3J0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyIGZyb20gXCIuL3NoYXJlZC10cmFuc2FjdGlvbi1icm9rZXIuanNcIlxuaW1wb3J0IHsgU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlYgfSBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNBdHRlbXB0RXhlY3V0b3IgZnJvbSBcIi4vdmVsb2Npb3VzLWF0dGVtcHQtZXhlY3V0b3IuanNcIlxuaW1wb3J0IFZlbG9jaW91c1J1bm5lclJlcG9ydGVyLCB7QWJvcnRSZW1haW5pbmdUZXN0c0Vycm9yfSBmcm9tIFwiLi92ZWxvY2lvdXMtcnVubmVyLXJlcG9ydGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvciBmcm9tIFwiLi92ZWxvY2lvdXMtc3VpdGUtaG9vay1leGVjdXRvci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzVGVzdEFyZ3VtZW50cyBmcm9tIFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIlxuXG4vKiogQHR5cGVkZWYge3R5cGVvZiBkZWZhdWx0VGVzdENvbnRleHR9IFBhY2thZ2VUZXN0Q29udGV4dCAqL1xuLyoqIEB0eXBlZGVmIHsodHlwZW9mIGRlZmF1bHRUZXN0Q29udGV4dC5yZWdpc3RyeS5zdWl0ZXMpW251bWJlcl19IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uICovXG4vKiogQHR5cGVkZWYge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW1widGVzdHNcIl1bbnVtYmVyXX0gUGFja2FnZVRlc3REZWNsYXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltcImhvb2tzXCJdW1wiYmVmb3JlQWxsXCJdW251bWJlcl19IFBhY2thZ2VIb29rRGVjbGFyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb24gfCBQYWNrYWdlVGVzdERlY2xhcmF0aW9uIHwgUGFja2FnZUhvb2tEZWNsYXJhdGlvbn0gUGFja2FnZVJlZ2lzdHJhdGlvbiAqL1xuXG4vKipcbiAqIEF0dGVtcHRDb25zb2xlT3V0cHV0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBdHRlbXB0Q29uc29sZU91dHB1dFxuICogQHByb3BlcnR5IHtudW1iZXJ9IGF0dGVtcHROdW1iZXIgLSBBdHRlbXB0IG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBvdXRwdXQgLSBDYXB0dXJlZCBjb25zb2xlIG91dHB1dC5cbiAqL1xuLyoqXG4gKiBUZXN0QXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdEFyZ3NcbiAqIEBwcm9wZXJ0eSB7QXBwbGljYXRpb259IFthcHBsaWNhdGlvbl0gLSBBcHBsaWNhdGlvbiBpbnN0YW5jZSBmb3IgaW50ZWdyYXRpb24gdGVzdHMuXG4gKiBAcHJvcGVydHkge1JlcXVlc3RDbGllbnR9IFtjbGllbnRdIC0gSFRUUCBjbGllbnQgZm9yIHJlcXVlc3QgdGVzdHMuXG4gKiBAcHJvcGVydHkge29iamVjdH0gW2RhdGFiYXNlQ2xlYW5pbmddIC0gRGF0YWJhc2UgY2xlYW51cCBvcHRpb25zIGZvciB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJhbnNhY3Rpb25dIC0gVXNlIHRyYW5zYWN0aW9ucyB0byByb2xsYmFjayBiZXR3ZWVuIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cnVuY2F0ZV0gLSBUcnVuY2F0ZSB0YWJsZXMgYmV0d2VlbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJ1bmNhdGVCZWZvcmVdIC0gVHJ1bmNhdGUgdGFibGVzIGJlZm9yZSBlYWNoIHRlc3QsIGluIGFkZGl0aW9uIHRvIHRoZSBkZWZhdWx0IGNsZWFudXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtmb2N1c10gLSBXaGV0aGVyIHRoaXMgdGVzdCBpcyBmb2N1c2VkLlxuICogQHByb3BlcnR5IHsoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gW2Z1bmN0aW9uXSAtIFRlc3QgY2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3JldHJ5XSAtIE51bWJlciBvZiByZXRyaWVzIHdoZW4gYSB0ZXN0IGZhaWxzLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXSB8IHN0cmluZ30gW3RhZ3NdIC0gVGFncyBmb3IgZmlsdGVyaW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0U2Vjb25kc10gLSBUaW1lb3V0IGluIHNlY29uZHMgZm9yIHRoZSB0ZXN0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0eXBlXSAtIFRlc3QgdHlwZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHsoYXJnczoge2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ6IG9iamVjdH0pID0+IFByb21pc2U8dm9pZD59IFtyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnRdIC0gUmVnaXN0ZXJzIG9uZSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgdHJhbnNhY3Rpb24gZm9yIHRoaXMgYXR0ZW1wdC5cbiAqL1xuLyoqXG4gKiBCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIEF0dGVtcHQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBDb25maWd1cmVkIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtxdWFyYW50aW5lUHJvbWlzZV0gLSBTaGFyZWQgY29ubmVjdGlvbi1kaXNjYXJkIHByb21pc2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHF1YXJhbnRpbmVkIC0gV2hldGhlciB0aGUgY29ubmVjdGlvbiBpcyB1bnNhZmUgdG8gcmV1c2UuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtyb2xsYmFja1Byb21pc2VdIC0gU2hhcmVkIHJvbGxiYWNrIHByb21pc2UuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtzdGFydFByb21pc2VdIC0gVHJhbnNhY3Rpb24gc3RhcnR1cCBwcm9taXNlIHdoZW4gdHJhbnNhY3Rpb24gY2xlYW5pbmcgaXMgZW5hYmxlZC5cbiAqL1xuLyoqXG4gKiBUZXN0RGF0YSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdERhdGFcbiAqIEBwcm9wZXJ0eSB7VGVzdEFyZ3N9IGFyZ3MgLSBBcmd1bWVudHMgcGFzc2VkIHRvIHRoZSB0ZXN0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKiBAcHJvcGVydHkgeyhhcmc6IFRlc3RBcmdzKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gZnVuY3Rpb24gLSBUZXN0IGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IFtkZWNsYXJhdGlvbl0gLSBQYWNrYWdlIGRlY2xhcmF0aW9uLlxuICovXG4vKipcbiAqIEZhaWxlZFRlc3REZXRhaWwgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZhaWxlZFRlc3REZXRhaWxcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmdWxsRGVzY3JpcHRpb24gLSBGdWxsIHRlc3QgZGVzY3JpcHRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlT3V0cHV0XSAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0IHdoaWxlIHRlc3QgcmFuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlTG9nUGF0aF0gLSBTYXZlZCBjb25zb2xlIGxvZyBwYXRoLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCB0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0pID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBBZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gSG9vayBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIEhvb2sgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGluZGV4IHdpdGhpbiBpdHMgZGVjbGFyYXRpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RlY2xhcmF0aW9uU2NvcGVJZF0gLSBPcGFxdWUgcHJvZmlsZSBzY29wZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqL1xuLyoqXG4gKiBUZXN0c0FyZ3VtZW50IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0c0FyZ3VtZW50XG4gKiBAcHJvcGVydHkge1Rlc3RBcmdzfSBhcmdzIC0gQXJndW1lbnRzIGluaGVyaXRlZCBieSB0ZXN0cyBpbiB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbYW55VGVzdHNGb2N1c3NlZF0gLSBXaGV0aGVyIGFueSB0ZXN0cyBpbiB0aGUgdHJlZSBhcmUgZm9jdXNlZC5cbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGFmdGVyRWFjaGVzIC0gQWZ0ZXItZWFjaCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVbXX0gYWZ0ZXJBbGxzIC0gQWZ0ZXItYWxsIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBiZWZvcmVBbGxzIC0gQmVmb3JlLWFsbCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGJlZm9yZUVhY2hlcyAtIEJlZm9yZS1lYWNoIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFRlc3REYXRhPn0gdGVzdHMgLSBBIHVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgbm9kZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgVGVzdHNBcmd1bWVudD59IHN1YnMgLSBPcHRpb25hbCBjaGlsZCBub2Rlcy4gRWFjaCBpdGVtIGlzIGFub3RoZXIgYE5vZGVgLCBhbGxvd2luZyByZWN1cnNpb24uXG4gKi9cbi8qKlxuICogTWFya3MgdGhlIGVycm9yIHRocm93biBieSB0aGUgYXR0ZW1wdCB0aW1lb3V0IHNvIHRoZSBydW5uZXIgY2FuIGRpc3Rpbmd1aXNoXG4gKiBkZXRhY2hlZCBsaWZlY3ljbGUgY2xlYW51cCBmcm9tIGFuIG9yZGluYXJ5IHRlc3QgZmFpbHVyZS5cbiAqIEB0eXBlZGVmIHtFcnJvciAmIHt2ZWxvY2lvdXNUZXN0VGltZW91dD86IHRydWV9fSBUZXN0VGltZW91dEVycm9yXG4gKi9cbi8qKlxuICogU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyfSBicm9rZXIgLSBBdHRlbXB0IGJyb2tlciBhbmQgY29ubmVjdGlvbiBjb29yZGluYXRvci5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gZW52aXJvbm1lbnRQdWJsaXNoZWQgLSBXaGV0aGVyIGNoaWxkLXByb2Nlc3MgY29vcmRpbmF0ZXMgd2VyZSBwdWJsaXNoZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gcHJldmlvdXNFbnZpcm9ubWVudCAtIEVudmlyb25tZW50IHZhbHVlIHRvIHJlc3RvcmUgYWZ0ZXIgcHVibGljYXRpb24uXG4gKi9cbi8qKlxuICogVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtQcm9taXNlPHtjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgZXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkfT4gfCB1bmRlZmluZWR9IFtjaGVja291dFByb21pc2VdIC0gQXR0ZW1wdC1vd25lZCBwaHlzaWNhbCBjaGVja291dCBvdXRjb21lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29ubmVjdGlvbiAtIEF0dGVtcHQtb3duZWQgcGh5c2ljYWwgY29ubmVjdGlvbiBvbmNlIGNoZWNrb3V0IHJlc29sdmVzLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSBbY2xlYW51cFByb21pc2VdIC0gU2luZ2xlIGNsZWFudXAgb3BlcmF0aW9uIHNoYXJlZCBieSBlbWVyZ2VuY3kgYW5kIGV2ZW50dWFsIGxpZmVjeWNsZSBjbGVhbnVwLlxuICogQHByb3BlcnR5IHtib29sZWFuIHwgdW5kZWZpbmVkfSBbZGlzY2FyZE9uQ2xlYW51cF0gLSBXaGV0aGVyIHRpbWVvdXQgZW1lcmdlbmN5IGNsZWFudXAgbXVzdCBxdWFyYW50aW5lIHRoaXMgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IHBvb2wgLSBPd25pbmcgbG9naWNhbCBwb29sLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZXZva2VkIC0gV2hldGhlciB0aGlzIGF0dGVtcHQgbWF5IHN0aWxsIHB1Ymxpc2ggdGhlIHBoeXNpY2FsIHJlZ2lzdHJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXVzZUtleSAtIFJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24gaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gc2hhcmVkUmVnaXN0cmF0aW9uIC0gUGh5c2ljYWwta2V5IHNoYXJlZCByZWdpc3RyYXRpb24gb25jZSBwdWJsaXNoZWQuXG4gKi9cblxuLyoqXG4gKiBSdW5zIHRvIGZpbGUgc2x1Zy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIHNhbml0aXplLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTbHVnLXNhZmUgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHRvRmlsZVNsdWcodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAucmVwbGFjZSgvW15hLXowLTldKy9nLCBcIi1cIilcbiAgICAucmVwbGFjZSgvXi0rfC0rJC9nLCBcIlwiKVxuICAgIC5zbGljZSgwLCA4MCkgfHwgXCJmYWlsZWQtdGVzdFwiXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RSdW5uZXIge1xuICAvKiogQHR5cGUge1BhY2thZ2VUZXN0Q29udGV4dH0gKi9cbiAgX2NvbnRleHRcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7RmFpbGVkVGVzdERldGFpbFtdfSAqL1xuICBfZmFpbGVkVGVzdERldGFpbHNcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3RDb250ZXh0fSBbYXJncy5jb250ZXh0XSAtIERlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmd9IFthcmdzLmV4Y2x1ZGVUYWdzXSAtIFRhZ3MgdG8gZXhjbHVkZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuaW5jbHVkZVRhZ3NdIC0gVGFncyB0byBpbmNsdWRlLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGFyZ3MudGVzdEZpbGVzIC0gVGVzdCBmaWxlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT59IFthcmdzLmxpbmVGaWx0ZXJzXSAtIExpbmUgZmlsdGVycyBieSBmaWxlLlxuICAgKiBAcGFyYW0ge1JlZ0V4cFtdfSBbYXJncy5leGFtcGxlUGF0dGVybnNdIC0gRXhhbXBsZSBwYXR0ZXJucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcHJvZmlsZXIuanNcIikuZGVmYXVsdH0gW2FyZ3MucHJvZmlsZXJdIC0gT3B0LWluIHByb2ZpbGVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGNvbnRleHQgPSBkZWZhdWx0VGVzdENvbnRleHQsIGV4Y2x1ZGVUYWdzLCBpbmNsdWRlVGFncywgdGVzdEZpbGVzLCBsaW5lRmlsdGVycywgZXhhbXBsZVBhdHRlcm5zLCBwcm9maWxlciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5fY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLl9jb250ZXh0ID0gY29udGV4dFxuICAgIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2UoKVxuICAgIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG4gICAgdGhpcy5fZXhjbHVkZVRhZ3MgPSB0aGlzLm5vcm1hbGl6ZVRhZ3MoZXhjbHVkZVRhZ3MpXG4gICAgdGhpcy5faW5jbHVkZVRhZ3MgPSB0aGlzLm5vcm1hbGl6ZVRhZ3MoaW5jbHVkZVRhZ3MpXG4gICAgdGhpcy5fdGVzdEZpbGVzID0gdGVzdEZpbGVzXG4gICAgdGhpcy5fbGluZUZpbHRlcnMgPSBsaW5lRmlsdGVycyB8fCB7fVxuICAgIHRoaXMuX2V4YW1wbGVQYXR0ZXJucyA9IGV4YW1wbGVQYXR0ZXJucyB8fCBbXVxuICAgIHRoaXMuX3Byb2ZpbGVyID0gcHJvZmlsZXJcbiAgICB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gZmFsc2VcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gMFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICAvKiogQHR5cGUge3tmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyfSB8IG51bGx9ICovXG4gICAgdGhpcy5fbGFzdFRlc3RDb250ZXh0ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXIsIGR1cmF0aW9uTXM6IG51bWJlcn0+fSAqL1xuICAgIHRoaXMuX3Rlc3REdXJhdGlvbnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uLCB7dGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9Pn0gKi9cbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8UGFja2FnZVRlc3REZWNsYXJhdGlvbj59ICovXG4gICAgdGhpcy5faW5qZWN0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8UGFja2FnZVRlc3REZWNsYXJhdGlvbj59ICovXG4gICAgdGhpcy5fY29tcGxldGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIHtkZXNjcmlwdGlvbnM6IHN0cmluZ1tdLCB0ZXN0RGVzY3JpcHRpb246IHN0cmluZywgZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIG93bmVyRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCwgc3VpdGVzOiBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltdfT59ICovXG4gICAgdGhpcy5fdGVzdE1ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlSG9va0RlY2xhcmF0aW9uLCB7ZGVjbGFyYXRpb25JbmRleDogbnVtYmVyLCBkZWNsYXJhdGlvblNjb3BlSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCwgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfT59ICovXG4gICAgdGhpcy5faG9va01ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uLCBNYXA8bnVtYmVyLCB7YWJvcnRSZW1haW5pbmdUZXN0czogYm9vbGVhbiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBmYWlsZWQ6IGJvb2xlYW59Pj59ICovXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e3N1aXRlOiBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbiwgcGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFBhY2thZ2VUZXN0RGVjbGFyYXRpb25bXT59ICovXG4gICAgdGhpcy5fdGVzdHNCeUZ1bGxOYW1lID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VSZWdpc3RyYXRpb24sIHN0cmluZz59ICovXG4gICAgdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtQYWNrYWdlVGVzdFJ1bm5lciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9wYWNrYWdlUnVubmVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3RSdW5SZXN1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcGFja2FnZVJlc3VsdCA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgVGVzdERhdGE+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7e2ZpbGVQYXRoPzogc3RyaW5nLCBsaW5lPzogbnVtYmVyfX0gKi9cbiAgICB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24gPSB7fVxuICAgIHRoaXMuX2F0dGVtcHRFeGVjdXRvciA9IG5ldyBWZWxvY2lvdXNBdHRlbXB0RXhlY3V0b3Ioe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICAgIHRoaXMuX3J1bm5lclJlcG9ydGVyID0gbmV3IFZlbG9jaW91c1J1bm5lclJlcG9ydGVyKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgICB0aGlzLl9zdWl0ZUhvb2tFeGVjdXRvciA9IG5ldyBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvcih7dGVzdFJ1bm5lcjogdGhpc30pXG4gICAgdGhpcy5fdGVzdEFyZ3VtZW50cyA9IG5ldyBWZWxvY2lvdXNUZXN0QXJndW1lbnRzKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBwYWNrYWdlIGRlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQYWNrYWdlVGVzdENvbnRleHR9IC0gUGFja2FnZSBkZWNsYXJhdGlvbiBjb250ZXh0LlxuICAgKi9cbiAgZ2V0VGVzdENvbnRleHQoKSB7IHJldHVybiB0aGlzLl9jb250ZXh0IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7IHJldHVybiB0aGlzLl9jb25maWd1cmF0aW9uIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSB0ZXN0IGZpbGVzLlxuICAgKi9cbiAgZ2V0VGVzdEZpbGVzKCkgeyByZXR1cm4gdGhpcy5fdGVzdEZpbGVzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbGluZSBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyW10+fSAtIExpbmUgZmlsdGVycy5cbiAgICovXG4gIGdldExpbmVGaWx0ZXJzKCkgeyByZXR1cm4gdGhpcy5fbGluZUZpbHRlcnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGFtcGxlIHBhdHRlcm5zLlxuICAgKiBAcmV0dXJucyB7UmVnRXhwW119IC0gRXhhbXBsZSBwYXR0ZXJucy5cbiAgICovXG4gIGdldEV4YW1wbGVQYXR0ZXJucygpIHsgcmV0dXJuIHRoaXMuX2V4YW1wbGVQYXR0ZXJucyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwcm9maWxlciBzcGFuIG9ubHkgd2hlbiBwcm9maWxpbmcgd2FzIGV4cGxpY2l0bHkgZW5hYmxlZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtvYmplY3R9IG1ldGFkYXRhIC0gU3BhbiBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhLnBoYXNlIC0gUGhhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFttZXRhZGF0YS5kZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgZGVjbGFyYXRpb24gaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbbWV0YWRhdGEuZGVjbGFyYXRpb25TY29wZUlkXSAtIEhvb2sgZGVjbGFyYXRpb24gc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbbWV0YWRhdGEuZmlsZVBhdGhdIC0gU291cmNlIG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIFRpbWVkIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5Qcm9maWxlU3BhbihtZXRhZGF0YSwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLnJ1blNwYW4obWV0YWRhdGEsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHRhZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmcgfCB1bmRlZmluZWR9IHRhZ3MgLSBUYWdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTm9ybWFsaXplZCB0YWdzLlxuICAgKi9cbiAgbm9ybWFsaXplVGFncyh0YWdzKSB7XG4gICAgaWYgKCF0YWdzKSByZXR1cm4gW11cblxuICAgIGNvbnN0IHZhbHVlcyA9IFtdXG4gICAgY29uc3QgcmF3VGFncyA9IEFycmF5LmlzQXJyYXkodGFncykgPyB0YWdzIDogW3RhZ3NdXG5cbiAgICBmb3IgKGNvbnN0IHJhd1RhZyBvZiByYXdUYWdzKSB7XG4gICAgICBpZiAocmF3VGFnID09PSB1bmRlZmluZWQgfHwgcmF3VGFnID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyhyYXdUYWcpLnNwbGl0KFwiLFwiKVxuXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IHBhcnQudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIHZhbHVlcy5wdXNoKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldCh2YWx1ZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRhZy5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWcgLSBUYWcgdG8gY2hlY2sgZm9yLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRhZyBpcyBwcmVzZW50LlxuICAgKi9cbiAgaGFzVGFnKHRlc3RBcmdzLCB0YWcpIHtcbiAgICByZXR1cm4gdGhpcy5ub3JtYWxpemVUYWdzKHRlc3RBcmdzPy50YWdzKS5pbmNsdWRlcyh0YWcpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBicm93c2VyIHRlc3QgbW9kZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBydW5uaW5nIGJyb3dzZXIgdGVzdHMuXG4gICAqL1xuICBpc0Jyb3dzZXJUZXN0TW9kZSgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCBkdW1teSBpZiBuZWVkZWQuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gW2Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zXSAtIEF0dGVtcHQtb3duZWQgYnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhEdW1teUlmTmVlZGVkKHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXSkge1xuICAgIGlmICghdGhpcy5oYXNUYWcodGVzdEFyZ3MsIFwiZHVtbXlcIikpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLmlzQnJvd3NlclRlc3RNb2RlKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bk5vZGVEdW1teShjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBub2RlIGR1bW15LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuTm9kZUR1bW15KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZHVtbXlQYXRoID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RVTU1ZX1BBVEggfHwgdGhpcy5kZWZhdWx0RHVtbXlQYXRoKClcbiAgICBjb25zdCBkdW1teUltcG9ydCA9IGF3YWl0IGltcG9ydChwYXRoVG9GaWxlVVJMKGR1bW15UGF0aCkuaHJlZilcbiAgICBjb25zdCBEdW1teSA9IGR1bW15SW1wb3J0LmRlZmF1bHRcblxuICAgIGlmICghRHVtbXk/LnJ1bikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEdW1teSBoZWxwZXIgbm90IGZvdW5kIGF0ICR7ZHVtbXlQYXRofWApXG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzZXJ2ZXIgcmVzb3VyY2VzIG11c3Qgbm90IGluaGVyaXQgYW4gYXR0ZW1wdCBzY29wZSB0aGF0IHdpbGwgYmUgcmV2b2tlZC5cbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IER1bW15LnJ1bihhc3luYyAoKSA9PiB7fSlcbiAgICB9KVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgYXdhaXQgY2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCBkdW1teSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlZmF1bHQgZHVtbXkgaGVscGVyIHBhdGguXG4gICAqL1xuICBkZWZhdWx0RHVtbXlQYXRoKCkge1xuICAgIGNvbnN0IGN3ZCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBjd2Quc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpXG5cbiAgICBpZiAobm9ybWFsaXplZC5lbmRzV2l0aChcIi9zcGVjL2R1bW15XCIpKSB7XG4gICAgICByZXR1cm4gcGF0aC5qb2luKGN3ZCwgXCJpbmRleC5qc1wiKVxuICAgIH1cblxuICAgIHJldHVybiBwYXRoLmpvaW4oY3dkLCBcInNwZWMvZHVtbXkvaW5kZXguanNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBicm93c2VyIGR1bW15LlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zIC0gQXR0ZW1wdC1vd25lZCBicm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCB1c2VUcmFuc2FjdGlvbiA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRyYW5zYWN0aW9uID09PSB0cnVlXG4gICAgY29uc3QgdHJ1bmNhdGUgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZVxuICAgIGNvbnN0IHNob3VsZFRydW5jYXRlID0gdHJ1bmNhdGUgPT09IHVuZGVmaW5lZCA/ICF1c2VUcmFuc2FjdGlvbiA6IHRydW5jYXRlXG5cbiAgICBpZiAoIXVzZVRyYW5zYWN0aW9uICYmICFzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiVGVzdCBydW5uZXIgYnJvd3NlciBkdW1teVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgbmV3UmVnaXN0cmF0aW9ucyA9IE9iamVjdC5lbnRyaWVzKGRicykubWFwKChbZGF0YWJhc2VJZGVudGlmaWVyLCBkYl0pID0+IHtcbiAgICAgICAgLyoqIEB0eXBlIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSAqL1xuICAgICAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGRiLFxuICAgICAgICAgIHF1YXJhbnRpbmVkOiBmYWxzZVxuICAgICAgICB9XG5cbiAgICAgICAgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMucHVzaChyZWdpc3RyYXRpb24pXG5cbiAgICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICAgICAgfSlcblxuICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVEYXRhYmFzZXMoZGJzKVxuICAgICAgfVxuICAgICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgICBjb25zdCBsaWZlY3ljbGVFcnJvcnMgPSBbXVxuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAodXNlVHJhbnNhY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBzdGFydFByb21pc2VzID0gbmV3UmVnaXN0cmF0aW9ucy5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLmRiLnN0YXJ0VHJhbnNhY3Rpb24oKVxuXG4gICAgICAgICAgICByZWdpc3RyYXRpb24uc3RhcnRQcm9taXNlID0gc3RhcnRQcm9taXNlXG4gICAgICAgICAgICByZXR1cm4gc3RhcnRQcm9taXNlXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb25zdCBzdGFydFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc3RhcnRQcm9taXNlcylcbiAgICAgICAgICBjb25zdCBzdGFydEVycm9ycyA9IHN0YXJ0UmVzdWx0c1xuICAgICAgICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAgICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICAgICAgICBpZiAoc3RhcnRFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IHN0YXJ0RXJyb3JzWzBdXG4gICAgICAgICAgaWYgKHN0YXJ0RXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihzdGFydEVycm9ycywgXCJCcm93c2VyIGR1bW15IHRyYW5zYWN0aW9uIHN0YXJ0dXAgZmFpbGVkXCIsIHtjYXVzZTogc3RhcnRFcnJvcnNbMF19KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IpIHtcbiAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaCguLi5lcnJvci5lcnJvcnMpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICBhd2FpdCB0aGlzLnRydW5jYXRlRGF0YWJhc2VzKGRicylcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGxpZmVjeWNsZUVycm9yc1swXVxuICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihsaWZlY3ljbGVFcnJvcnMsIFwiQnJvd3NlciBkdW1teSBsaWZlY3ljbGUgYW5kIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogbGlmZWN5Y2xlRXJyb3JzWzBdfSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgZXZlcnkgYXR0ZW1wdC1vd25lZCBicm93c2VyIHRyYW5zYWN0aW9uIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgcm9sbGJhY2tzIHNldHRsZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCByb2xsYmFja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLnN0YXJ0UHJvbWlzZVxuXG4gICAgICBpZiAoIXN0YXJ0UHJvbWlzZSkgcmV0dXJuXG5cbiAgICAgIHJlZ2lzdHJhdGlvbi5yb2xsYmFja1Byb21pc2UgPz89IChhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24ucXVhcmFudGluZWQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgc3RhcnRQcm9taXNlXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgICAgICB9IGNhdGNoIChxdWFyYW50aW5lRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHF1YXJhbnRpbmUgYnJvd3NlciBkdW1teSBkYXRhYmFzZSBhZnRlciB0cmFuc2FjdGlvbiBzdGFydHVwIGZhaWxlZDogJHtyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyfWAsIHtjYXVzZTogcXVhcmFudGluZUVycm9yfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24uZGIucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgICAgIH0gY2F0Y2ggKHJvbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICAgICAgfSBjYXRjaCAocXVhcmFudGluZUVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICAgIFtyb2xsYmFja0Vycm9yLCBxdWFyYW50aW5lRXJyb3JdLFxuICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJvbGwgYmFjayBhbmQgcXVhcmFudGluZSBicm93c2VyIGR1bW15IGRhdGFiYXNlOiAke3JlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXJ9YCxcbiAgICAgICAgICAgICAge2NhdXNlOiBxdWFyYW50aW5lRXJyb3J9XG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IHJvbGxiYWNrRXJyb3JcbiAgICAgICAgfVxuICAgICAgfSkoKVxuXG4gICAgICByZXR1cm4gcmVnaXN0cmF0aW9uLnJvbGxiYWNrUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHJvbGxiYWNrUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiQnJvd3NlciBkdW1teSB0cmFuc2FjdGlvbiBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUGVybWFuZW50bHkgcmVtb3ZlcyBvbmUgYnJvd3NlciBjb25uZWN0aW9uIHRoYXQgY2Fubm90IGJlIHNoYXJlZCBzYWZlbHkuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gcmVnaXN0cmF0aW9uIC0gQnJvd3NlciBjb25uZWN0aW9uIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGNvbm5lY3Rpb24gaXMgZGlzY2FyZGVkLlxuICAgKi9cbiAgYXN5bmMgcXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkID0gdHJ1ZVxuICAgIHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lUHJvbWlzZSA/Pz0gdGhpcy5kaXNjYXJkQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyLCByZWdpc3RyYXRpb24uZGIpXG4gICAgYXdhaXQgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRGlzY2FyZHMgb25lIGJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiB0aHJvdWdoIGl0cyBvd25pbmcgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIENvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBVbnNhZmUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZGlzY2FyZC5cbiAgICovXG4gIGFzeW5jIGRpc2NhcmRCcm93c2VyRHVtbXlDb25uZWN0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgZGIpIHtcbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKS5kaXNjYXJkKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFF1YXJhbnRpbmVzIGFsbCBicm93c2VyIGNvbm5lY3Rpb25zIGNvbmN1cnJlbnRseS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgY29ubmVjdGlvbiBpcyBkaXNjYXJkZWQuXG4gICAqL1xuICBhc3luYyBxdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHF1YXJhbnRpbmVSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHJlZ2lzdHJhdGlvbnMubWFwKGFzeW5jIChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHF1YXJhbnRpbmVSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJCcm93c2VyIGR1bW15IGNvbm5lY3Rpb24gcXVhcmFudGluZSBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZGF0YWJhc2VzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gZGJzIC0gRGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZURhdGFiYXNlcyhkYnMpIHtcbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoZGJzKSkge1xuICAgICAgYXdhaXQgZGJzW2lkZW50aWZpZXJdLnRydW5jYXRlQWxsVGFibGVzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhjbHVkZSB0YWcgc2V0LlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRXhjbHVkZSB0YWcgc2V0LlxuICAgKi9cbiAgZ2V0RXhjbHVkZVRhZ1NldCgpIHtcbiAgICAvKipcbiAgICAgKiBDb25maWcgdGFncy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgY29uZmlnVGFncyA9IEFycmF5LmlzQXJyYXkodGVzdENvbmZpZy5leGNsdWRlVGFncykgPyB0ZXN0Q29uZmlnLmV4Y2x1ZGVUYWdzIDogW11cblxuICAgIHJldHVybiBuZXcgU2V0KFsuLi50aGlzLl9leGNsdWRlVGFncywgLi4uY29uZmlnVGFnc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBmdWxsIGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnVsbCBkZXNjcmlwdGlvbi5cbiAgICovXG4gIGJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSB7XG4gICAgY29uc3QgcGFydHMgPSBkZXNjcmlwdGlvbnMuY29uY2F0KFt0ZXN0RGVzY3JpcHRpb25dKVxuXG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oXCIgXCIpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbGljYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFwcGxpY2F0aW9uPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcHBsaWNhdGlvbi5cbiAgICovXG4gIGFzeW5jIGFwcGxpY2F0aW9uKCkge1xuICAgIGlmICghdGhpcy5fYXBwbGljYXRpb24pIHtcbiAgICAgIHRoaXMuX2FwcGxpY2F0aW9uID0gbmV3IEFwcGxpY2F0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIC8vIFJ1biByZXF1ZXN0IGhhbmRsZXJzIGluIHRoZSBtYWluIHRocmVhZCAobm90IHdvcmtlciB0aHJlYWRzKSBzbyB0aGV5XG4gICAgICAgIC8vIHJlc29sdmUgREIgd29yayB0byB0aGUgcGVyLXRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gc2V0IGJ5XG4gICAgICAgIC8vIHtAbGluayBhY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9uc30uIFRoaXMgbGV0cyByZXF1ZXN0LXR5cGUgc3BlY3MgdXNlXG4gICAgICAgIC8vIHRyYW5zYWN0aW9uLWJhc2VkIGNsZWFuaW5nICh0aGVpciB3cml0ZXMgbGFuZCBpbnNpZGUgdGhlIHRlc3Qnc1xuICAgICAgICAvLyB0cmFuc2FjdGlvbiBhbmQgcm9sbCBiYWNrKSBpbnN0ZWFkIG9mIHRydW5jYXRpbmcgZXZlcnkgdGFibGUuXG4gICAgICAgIGh0dHBTZXJ2ZXI6IHtpblByb2Nlc3M6IHRydWUsIHBvcnQ6IDMxMDA2fSxcbiAgICAgICAgdHlwZTogXCJ0ZXN0LXJ1bm5lclwiXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLl9hcHBsaWNhdGlvbi5pbml0aWFsaXplKClcbiAgICAgIGF3YWl0IHRoaXMuX2FwcGxpY2F0aW9uLnN0YXJ0SHR0cFNlcnZlcigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGxpY2F0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGVhY2ggbm9uLXRlbmFudCBwZXItdGVzdCBjb25uZWN0aW9uIGFzIGEgZHluYW1pYyBjYW5kaWRhdGUgZm9yIGluLXByb2Nlc3NcbiAgICogcmVxdWVzdCBzaGFyaW5nLiBUaGUgcG9vbCBldmFsdWF0ZXMgdHJhbnNhY3Rpb24gc3RhdGUgd2hlbiBlYWNoIHJlcXVlc3QgaXMgZGlzcGF0Y2hlZCxcbiAgICogc28gYSB0cmFuc2FjdGlvbiBzdGFydGVkIG9yIGVuZGVkIGR1cmluZyBhIGhvb2sgY2FsbGJhY2sgdGFrZXMgZWZmZWN0IGltbWVkaWF0ZWx5LlxuICAgKiBJbmFjdGl2ZSBhbmQgdGVuYW50LW9ubHkgY29ubmVjdGlvbnMgcmVtYWluIGluZGVwZW5kZW50bHkgcG9vbGVkLiBQYWlyIHdpdGhcbiAgICoge0BsaW5rIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zfSBpbiBhIGZpbmFsbHkuXG4gICAqIEByZXR1cm5zIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAtIExpZmVjeWNsZS1vd25lZCByZWdpc3RyYXRpb25zLlxuICAgKi9cbiAgYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnMoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb25zID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICAgIC8qKiBAdHlwZSB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gKi9cbiAgICBjb25zdCByZWdpc3RyYXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhjdXJyZW50Q29ubmVjdGlvbnMpKSB7XG4gICAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgLy8gVGVuYW50LXNjb3BlZCBwb29scyByZXNvbHZlIGEgZGlmZmVyZW50IGNvbm5lY3Rpb24gcGVyIHJlcXVlc3QgdGVuYW50XG4gICAgICAvLyAodmlhIHJ1bldpdGhUZW5hbnQpLCBzbyBmb3JjaW5nIGEgc2luZ2xlIHNoYXJlZCBjb25uZWN0aW9uIHdvdWxkIGJyZWFrXG4gICAgICAvLyBwZXItcmVxdWVzdCB0ZW5hbnQgcmVzb2x1dGlvbi4gT25seSBzaGFyZSBub24tdGVuYW50IHBvb2xzOyB0aGUgdGVuYW50XG4gICAgICAvLyBwb29sIGtlZXBzIHJlc29sdmluZyBpdHMgb3duIGNvbm5lY3Rpb24gcGVyIHJlcXVlc3QuXG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uKCkudGVuYW50T25seSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gY3VycmVudENvbm5lY3Rpb25zW2lkZW50aWZpZXJdXG5cbiAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHBvb2wuc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcigoKSA9PiB7XG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkgPyBjb25uZWN0aW9uIDogdW5kZWZpbmVkXG4gICAgICB9KVxuXG4gICAgICBpZiAocmVnaXN0cmF0aW9uKSByZWdpc3RyYXRpb25zLnB1c2goe3Bvb2wsIHJlZ2lzdHJhdGlvbn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIGluLXByb2Nlc3MgdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBvbiBldmVyeSBjb25maWd1cmVkIHBvb2wuIElkZW1wb3RlbnQgYW5kXG4gICAqIHNhZmUgdG8gY2FsbCB3aGVuIG5vbmUgd2FzIHNldC5cbiAgICogQHBhcmFtIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSBbcmVnaXN0cmF0aW9uc10gLSBMaWZlY3ljbGUtb3duZWQgcmVnaXN0cmF0aW9ucyB0byBjbGVhciBjb25kaXRpb25hbGx5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBpZiAocmVnaXN0cmF0aW9ucykge1xuICAgICAgZm9yIChjb25zdCB7cG9vbCwgcmVnaXN0cmF0aW9ufSBvZiByZWdpc3RyYXRpb25zKSB7XG4gICAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBvdXQgYW5kIHJlZ2lzdGVycyBvbmUgcGh5c2ljYWwgdGVuYW50IHRyYW5zYWN0aW9uIGZvciB0aGUgY3VycmVudCBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgdGVuYW50OiBvYmplY3R9fSBhcmdzIC0gTG9naWNhbCBpZGVudGlmaWVyIGFuZCB0ZW5hbnQgZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBDdXJyZW50IGF0dGVtcHQgcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQoe2RhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50LCAuLi5yZXN0QXJnc30sIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIXRlbmFudCkgdGhyb3cgbmV3IEVycm9yKFwicmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgdGVuYW50XCIpXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi50ZW5hbnRPbmx5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIHRlbmFudE9ubHkgZGF0YWJhc2U6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuICAgIGNvbnN0IHJldXNlS2V5ID0gcG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGlmIChyZWdpc3RyYXRpb25zLnNvbWUoKHJlZ2lzdHJhdGlvbikgPT4gcmVnaXN0cmF0aW9uLnBvb2wgPT09IHBvb2wgJiYgcmVnaXN0cmF0aW9uLnJldXNlS2V5ID09PSByZXVzZUtleSkpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ufSAqL1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtcbiAgICAgIGNvbm5lY3Rpb246IHVuZGVmaW5lZCxcbiAgICAgIHBvb2wsXG4gICAgICByZXVzZUtleSxcbiAgICAgIHJldm9rZWQ6IGZhbHNlLFxuICAgICAgc2hhcmVkUmVnaXN0cmF0aW9uOiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZWdpc3RyYXRpb25zLnB1c2gocmVnaXN0cmF0aW9uKVxuICAgIHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2UgPSBwb29sXG4gICAgICAuY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwge25hbWU6IFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb25cIn0pXG4gICAgICAudGhlbihcbiAgICAgICAgKGNvbm5lY3Rpb24pID0+ICh7Y29ubmVjdGlvbiwgZXJyb3I6IHVuZGVmaW5lZH0pLFxuICAgICAgICAoZXJyb3IpID0+ICh7XG4gICAgICAgICAgY29ubmVjdGlvbjogdW5kZWZpbmVkLFxuICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCBjb25uZWN0aW9uIGNoZWNrb3V0IGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgfSlcbiAgICAgIClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjaGVja291dE91dGNvbWUgPSBhd2FpdCByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlXG5cbiAgICAgIGlmIChjaGVja291dE91dGNvbWUuZXJyb3IpIHRocm93IGNoZWNrb3V0T3V0Y29tZS5lcnJvclxuICAgICAgaWYgKCFjaGVja291dE91dGNvbWUuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgY29ubmVjdGlvbiBjaGVja291dCByZXR1cm5lZCBubyBjb25uZWN0aW9uXCIpXG4gICAgICByZWdpc3RyYXRpb24uY29ubmVjdGlvbiA9IGNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuXG4gICAgICBhd2FpdCByZWdpc3RyYXRpb24uY29ubmVjdGlvbi5zdGFydFRyYW5zYWN0aW9uKClcbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG5cbiAgICAgIGNvbnN0IHNoYXJlZFJlZ2lzdHJhdGlvbiA9IHBvb2wuc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Gb3JDb25maWd1cmF0aW9uKHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uLCByZXVzZUtleSlcbiAgICAgIGlmICghc2hhcmVkUmVnaXN0cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYERhdGFiYXNlIHBvb2wgZG9lcyBub3Qgc3VwcG9ydCB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25zOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgICAgcmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbiA9IHNoYXJlZFJlZ2lzdHJhdGlvblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB7XG4gICAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihzaGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZWdpc3RyYXRpb24ucmV2b2tlZCA9IHRydWVcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKFtyZWdpc3RyYXRpb25dLCB7ZGlzY2FyZDogcmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXAgPT09IHRydWV9KVxuICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbZXJyb3IsIGNsZWFudXBFcnJvcl0sIFwiRmFpbGVkIHRvIHJlZ2lzdGVyIGFuZCBjbGVhbiB1cCBhIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvblwiLCB7Y2F1c2U6IGNsZWFudXBFcnJvcn0pXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXZva2VzIGF0dGVtcHQgcmVnaXN0cmF0aW9ucyBiZWZvcmUgcm9sbGluZyBiYWNrIGFuZCByZWxlYXNpbmcgdGhlaXIgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQXR0ZW1wdCByZWdpc3RyYXRpb25zLlxuICAgKiBAcGFyYW0ge3tkaXNjYXJkPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIFdoZXRoZXIgY29ubmVjdGlvbnMgbXVzdCBiZSBkaXNjYXJkZWQgaW5zdGVhZCBvZiByZXR1cm5lZCB0byB0aGUgcG9vbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHMocmVnaXN0cmF0aW9ucywge2Rpc2NhcmQgPSBmYWxzZX0gPSB7fSkge1xuICAgIGZvciAoY29uc3QgcmVnaXN0cmF0aW9uIG9mIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5yZXZva2VkID0gdHJ1ZVxuICAgICAgaWYgKGRpc2NhcmQpIHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwID0gdHJ1ZVxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24pIHJlZ2lzdHJhdGlvbi5wb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbilcbiAgICB9XG4gICAgY29uc3QgY2xlYW51cFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgcmVnaXN0cmF0aW9uLmNsZWFudXBQcm9taXNlID8/PSB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbilcblxuICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvbi5jbGVhbnVwUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IGNsZWFudXBSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsZWFuIHVwIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvbnNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhbnMgb25lIGF0dGVtcHQgcmVnaXN0cmF0aW9uIGV4YWN0bHkgb25jZSwgaW5jbHVkaW5nIGEgY2hlY2tvdXQgdGhhdCB3YXMgc3RpbGwgcGVuZGluZyBhdCByZXZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb259IHJlZ2lzdHJhdGlvbiAtIEF0dGVtcHQtb3duZWQgcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByb2xsYmFjayBhbmQgcmVsZWFzZSBvciBxdWFyYW50aW5lLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgbGV0IGNvbm5lY3Rpb24gPSByZWdpc3RyYXRpb24uY29ubmVjdGlvblxuXG4gICAgaWYgKCFjb25uZWN0aW9uICYmIHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2UpIHtcbiAgICAgIGNvbnN0IGNoZWNrb3V0T3V0Y29tZSA9IGF3YWl0IHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2VcblxuICAgICAgaWYgKGNoZWNrb3V0T3V0Y29tZS5lcnJvcikgcmV0dXJuXG4gICAgICBjb25uZWN0aW9uID0gY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb25cbiAgICAgIHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uID0gY29ubmVjdGlvblxuICAgIH1cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIHRyeSB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBhd2FpdCBjb25uZWN0aW9uLnJvbGxiYWNrVHJhbnNhY3Rpb24oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwKSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLnBvb2wuZGlzY2FyZChjb25uZWN0aW9uKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5wb29sLmNoZWNraW4oY29ubmVjdGlvbilcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsZWFuIHVwIGEgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyB0aGUgY3VycmVudCBub24tdGVuYW50IGNvbm5lY3Rpb25zIGVsaWdpYmxlIGZvciBzaGFyZWQgdHJhbnNhY3Rpb24gd29yay5cbiAgICogQHBhcmFtIHt7dHJhbnNhY3Rpb25zT25seTogYm9vbGVhbn19IGFyZ3MgLSBTZWxlY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBFbGlnaWJsZSBjb25uZWN0aW9ucyBieSBpZGVudGlmaWVyLlxuICAgKi9cbiAgc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seX0pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbnMgPSBjb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoY3VycmVudENvbm5lY3Rpb25zKSkge1xuICAgICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb24oKS50ZW5hbnRPbmx5KSBjb250aW51ZVxuICAgICAgaWYgKHRyYW5zYWN0aW9uc09ubHkgJiYgIWNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSkgY29udGludWVcbiAgICAgIGNvbm5lY3Rpb25zW2lkZW50aWZpZXJdID0gY29ubmVjdGlvblxuICAgIH1cblxuICAgIHJldHVybiBjb25uZWN0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIHBoeXNpY2FsLWNvbm5lY3Rpb24gY29vcmRpbmF0aW9uIGJlZm9yZSBhIHRyYW5zYWN0aW9uLW9wZW5pbmcgaG9va1xuICAgKiBjYW4gZXhwb3NlIHRoZSBzaGFyZWQgY29ubmVjdGlvbiB0byBhIGxvbmctbGl2ZWQgaW4tcHJvY2VzcyBzZXJ2aWNlLlxuICAgKiBDaGlsZC1wcm9jZXNzIGNvb3JkaW5hdGVzIHJlbWFpbiB1bnB1Ymxpc2hlZCB1bnRpbCB0aGUgdHJhbnNhY3Rpb24gZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZD59IC0gUHJlcGFyZWQgY29vcmRpbmF0b3IuXG4gICAqL1xuICBhc3luYyBwcmVwYXJlU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IGZhbHNlfSlcblxuICAgIGlmIChPYmplY3Qua2V5cyhjb25uZWN0aW9ucykubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4ge1xuICAgICAgYnJva2VyOiBhd2FpdCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlci5zdGFydCh7Y29ubmVjdGlvbnN9KSxcbiAgICAgIGVudmlyb25tZW50UHVibGlzaGVkOiBmYWxzZSxcbiAgICAgIHByZXZpb3VzRW52aXJvbm1lbnQ6IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHByZXBhcmVkIGJyb2tlciBjb29yZGluYXRlcyBleGFjdGx5IHRoZSBzZWxlY3RlZCBwaHlzaWNhbCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gcmVnaXN0cmF0aW9uIC0gUHJlcGFyZWQgY29vcmRpbmF0b3IuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBjb25uZWN0aW9ucyAtIFNlbGVjdGVkIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBpZGVudGlmaWVyIHNldCBhbmQgcGh5c2ljYWwgY29ubmVjdGlvbnMgbWF0Y2ggZXhhY3RseS5cbiAgICovXG4gIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbiwgY29ubmVjdGlvbnMpIHtcbiAgICBjb25zdCBpZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKVxuXG4gICAgaWYgKCFyZWdpc3RyYXRpb24gfHwgaWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoT2JqZWN0LmtleXMocmVnaXN0cmF0aW9uLmJyb2tlci5jb25uZWN0aW9ucykubGVuZ3RoICE9PSBpZGVudGlmaWVycy5sZW5ndGgpIHJldHVybiBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoY29ubmVjdGlvbnMpKSB7XG4gICAgICBpZiAocmVnaXN0cmF0aW9uLmJyb2tlci5jb25uZWN0aW9uc1tpZGVudGlmaWVyXSAhPT0gY29ubmVjdGlvbikgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYSBjYXBhYmlsaXR5LXNjb3BlZCBicm9rZXIgZm9yIHRoZSBhY3RpdmUgbm9uLXRlbmFudCBwaHlzaWNhbFxuICAgKiB0cmFuc2FjdGlvbiBjb25uZWN0aW9ucy4gTm8gYnJva2VyL2VudiBpcyBpbnN0YWxsZWQgZm9yIHRydW5jYXRpb24tb25seSBvclxuICAgKiBvdGhlciB0cmFuc2FjdGlvbi1kaXNhYmxlZCBhdHRlbXB0cy5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbn0gW3ByZXBhcmVkUmVnaXN0cmF0aW9uXSAtIENvb3JkaW5hdG9yIHByZXBhcmVkIGJlZm9yZSBob29rcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IFtzZWxlY3RlZENvbm5lY3Rpb25zXSAtIFBvc3QtaG9vayBhY3RpdmUgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGFzeW5jIHN0YXJ0U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24sIHNlbGVjdGVkQ29ubmVjdGlvbnMpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHNlbGVjdGVkQ29ubmVjdGlvbnMgfHwgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5OiB0cnVlfSlcblxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyhjb25uZWN0aW9ucylcbiAgICBpZiAoZGF0YWJhc2VJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgcmV0dXJuIHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGxldCBicm9rZXJcblxuICAgIGlmIChwcmVwYXJlZFJlZ2lzdHJhdGlvbiAmJiB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHByZXBhcmVkUmVnaXN0cmF0aW9uLCBjb25uZWN0aW9ucykpIHtcbiAgICAgIGJyb2tlciA9IHByZXBhcmVkUmVnaXN0cmF0aW9uLmJyb2tlclxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgIGJyb2tlciA9IGF3YWl0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLnN0YXJ0KHtjb25uZWN0aW9uc30pXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNFbnZpcm9ubWVudCA9IHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXVxuICAgIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXSA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGFkZHJlc3M6IGJyb2tlci5hZGRyZXNzKCksXG4gICAgICBjYXBhYmlsaXR5OiBicm9rZXIuY2FwYWJpbGl0eSgpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIGV4cGVjdGVkOiB0cnVlXG4gICAgfSkpLnRvU3RyaW5nKFwiYmFzZTY0dXJsXCIpXG5cbiAgICByZXR1cm4ge2Jyb2tlciwgZW52aXJvbm1lbnRQdWJsaXNoZWQ6IHRydWUsIHByZXZpb3VzRW52aXJvbm1lbnR9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlcyBhbiBhdHRlbXB0IGJyb2tlciBiZWZvcmUgZGF0YWJhc2Ugcm9sbGJhY2sgaG9va3MgcnVuIGFuZCByZXN0b3Jlc1xuICAgKiB0aGUgY2FsbGVyJ3MgZW52aXJvbm1lbnQgc28gbGF0ZXIgcG9vbGVkL3NwYXduZWQgY2hpbGRyZW4gY2Fubm90IGluaGVyaXQgaXQuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHJlZ2lzdHJhdGlvbiAtIEF0dGVtcHQgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHJlZ2lzdHJhdGlvbikge1xuICAgIGlmICghcmVnaXN0cmF0aW9uKSByZXR1cm5cblxuICAgIGlmIChyZWdpc3RyYXRpb24uZW52aXJvbm1lbnRQdWJsaXNoZWQpIHtcbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucHJldmlvdXNFbnZpcm9ubWVudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXSA9IHJlZ2lzdHJhdGlvbi5wcmV2aW91c0Vudmlyb25tZW50XG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5icm9rZXIuY2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWVzdCBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlcXVlc3RDbGllbnQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlcXVlc3QgY2xpZW50LlxuICAgKi9cbiAgYXN5bmMgcmVxdWVzdENsaWVudCgpIHtcbiAgICBpZiAoIXRoaXMuX3JlcXVlc3RDbGllbnQpIHtcbiAgICAgIHRoaXMuX3JlcXVlc3RDbGllbnQgPSBuZXcgUmVxdWVzdENsaWVudCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlcXVlc3RDbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGltcG9ydCB0ZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW1wb3J0VGVzdEZpbGVzKCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSB7XG4gICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKHRoaXMuZ2V0VGVzdEZpbGVzKCkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRoaXMuZ2V0VGVzdEZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmVnaXN0cmF0aW9ucyA9IHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMoKVxuXG4gICAgICBhd2FpdCB0aGlzLl9wcm9maWxlci5tZWFzdXJlUGhhc2UoXCJpbXBvcnRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLmltcG9ydFRlc3RGaWxlcyhbdGVzdEZpbGVdKVxuICAgICAgfSwge2ZpbGVQYXRoOiB0ZXN0RmlsZX0pXG4gICAgICB0aGlzLmFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAoZXhpc3RpbmdSZWdpc3RyYXRpb25zLCB0ZXN0RmlsZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29sbGVjdHMgcGFja2FnZSBkZWNsYXJhdGlvbiBvYmplY3RzIGJ5IGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge1NldDxQYWNrYWdlUmVnaXN0cmF0aW9uPn0gW3JlZ2lzdHJhdGlvbnNdIC0gQWNjdW11bGF0ZWQgaWRlbnRpdGllcy5cbiAgICogQHJldHVybnMge1NldDxQYWNrYWdlUmVnaXN0cmF0aW9uPn0gLSBSZWdpc3RyYXRpb24gaWRlbnRpdGllcy5cbiAgICovXG4gIHRlc3RSZWdpc3RyYXRpb25PYmplY3RzKHJlZ2lzdHJhdGlvbnMgPSBuZXcgU2V0KCkpIHtcbiAgICBjb25zdCB2aXNpdCA9ICgvKiogQHR5cGUge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSAqLyBzdWl0ZSkgPT4ge1xuICAgICAgcmVnaXN0cmF0aW9ucy5hZGQoc3VpdGUpXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2YgWy4uLnN1aXRlLmhvb2tzLmJlZm9yZUFsbCwgLi4uc3VpdGUuaG9va3MuYmVmb3JlRWFjaCwgLi4uc3VpdGUuaG9va3MuYWZ0ZXJFYWNoLCAuLi5zdWl0ZS5ob29rcy5hZnRlckFsbF0pIHtcbiAgICAgICAgcmVnaXN0cmF0aW9ucy5hZGQoaG9vaylcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgdGVzdERlY2xhcmF0aW9uIG9mIHN1aXRlLnRlc3RzKSByZWdpc3RyYXRpb25zLmFkZCh0ZXN0RGVjbGFyYXRpb24pXG4gICAgICBmb3IgKGNvbnN0IGNoaWxkU3VpdGUgb2Ygc3VpdGUuc3VpdGVzKSB2aXNpdChjaGlsZFN1aXRlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3VpdGUgb2YgdGhpcy5nZXRUZXN0Q29udGV4dCgpLnJlZ2lzdHJ5LnN1aXRlcykgdmlzaXQoc3VpdGUpXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgZGV0ZXJtaW5pc3RpYyBvd25lcnNoaXAgdG8gcGFja2FnZSBkZWNsYXJhdGlvbnMgYWRkZWQgYnkgb25lIGVudHJ5IGZpbGUuXG4gICAqIEBwYXJhbSB7U2V0PFBhY2thZ2VSZWdpc3RyYXRpb24+fSBwcmV2aW91c1JlZ2lzdHJhdGlvbnMgLSBJZGVudGl0aWVzIHByZXNlbnQgYmVmb3JlIGltcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG93bmVyRmlsZVBhdGggLSBJbXBvcnRpbmcgZW50cnkgZmlsZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKHByZXZpb3VzUmVnaXN0cmF0aW9ucywgb3duZXJGaWxlUGF0aCkge1xuICAgIGZvciAoY29uc3QgcmVnaXN0cmF0aW9uIG9mIHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMoKSkge1xuICAgICAgaWYgKCFwcmV2aW91c1JlZ2lzdHJhdGlvbnMuaGFzKHJlZ2lzdHJhdGlvbikpIHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLnNldChyZWdpc3RyYXRpb24sIG93bmVyRmlsZVBhdGgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZmFpbGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGZhaWxlZC5cbiAgICovXG4gIGlzRmFpbGVkKCkgeyByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdHMgIT09IHVuZGVmaW5lZCAmJiAodGhpcy5fZmFpbGVkVGVzdHMgPiAwIHx8IHRoaXMuX3BhY2thZ2VSZXN1bHQ/LnN0YXR1cyA9PT0gXCJmYWlsZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGZhaWxlZCB0ZXN0cy5cbiAgICovXG4gIGdldEZhaWxlZFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9mYWlsZWRUZXN0cyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdCBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7RmFpbGVkVGVzdERldGFpbFtdfSAtIEZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0RGV0YWlscygpIHtcbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdERldGFpbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3QgZmFpbGVkIHRlc3QgY29uc29sZSBvdXRwdXRzIHRvIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYXNzZXRzUGF0aF0gLSBBc3NldHMgZGlyZWN0b3J5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBXcml0dGVuIGxvZyBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdEZhaWxlZFRlc3RDb25zb2xlT3V0cHV0c1RvQXNzZXRzKHthc3NldHNQYXRoID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksIFwidG1wL3NjcmVlbnNob3RzXCIpfSA9IHt9KSB7XG4gICAgY29uc3QgZmFpbGVkVGVzdERldGFpbHMgPSB0aGlzLmdldEZhaWxlZFRlc3REZXRhaWxzKClcbiAgICBjb25zdCB3cml0dGVuTG9nUGF0aHMgPSBbXVxuICAgIGxldCBjcmVhdGVkRGlyZWN0b3J5ID0gZmFsc2VcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBmYWlsZWRUZXN0RGV0YWlscy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGNvbnN0IGZhaWxlZFRlc3REZXRhaWwgPSBmYWlsZWRUZXN0RGV0YWlsc1tpbmRleF1cbiAgICAgIGNvbnN0IGNvbnNvbGVPdXRwdXQgPSBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVPdXRwdXRcblxuICAgICAgaWYgKCFjb25zb2xlT3V0cHV0KSBjb250aW51ZVxuXG4gICAgICBpZiAoIWNyZWF0ZWREaXJlY3RvcnkpIHtcbiAgICAgICAgYXdhaXQgZnMubWtkaXIoYXNzZXRzUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgICAgIGNyZWF0ZWREaXJlY3RvcnkgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IFtcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRGdWxsWWVhcigpKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldERhdGUoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldEhvdXJzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaW51dGVzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRTZWNvbmRzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaWxsaXNlY29uZHMoKSkucGFkU3RhcnQoMywgXCIwXCIpXG4gICAgICBdLmpvaW4oXCJcIilcbiAgICAgIGNvbnN0IHNsdWcgPSB0b0ZpbGVTbHVnKGZhaWxlZFRlc3REZXRhaWwuZnVsbERlc2NyaXB0aW9uKVxuICAgICAgY29uc3QgZmlsZU5hbWUgPSBgJHt0aW1lc3RhbXB9LSR7U3RyaW5nKGluZGV4ICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpfS0ke3NsdWd9LmNvbnNvbGUubG9nYFxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oYXNzZXRzUGF0aCwgZmlsZU5hbWUpXG5cbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgY29uc29sZU91dHB1dCwgXCJ1dGY4XCIpXG4gICAgICBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVMb2dQYXRoID0gZmlsZVBhdGhcbiAgICAgIHdyaXR0ZW5Mb2dQYXRocy5wdXNoKGZpbGVQYXRoKVxuICAgIH1cblxuICAgIHJldHVybiB3cml0dGVuTG9nUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKi9cbiAgZ2V0U3VjY2Vzc2Z1bFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldFRlc3RzQ291bnQoKSB7XG4gICAgaWYgKHRoaXMuX3Rlc3RzQ291bnQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RzQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZXhlY3V0ZWQgdGVzdHMgY291bnQuXG4gICAqL1xuICBnZXRFeGVjdXRlZFRlc3RzQ291bnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3Rlc3REdXJhdGlvbnMubGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdGVzdHMgcmVjb3JkZWQgZHVyaW5nIHRoZSBydW4sIHNsb3dlc3QgZmlyc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbGltaXRdIC0gTWF4aW11bSBudW1iZXIgb2YgdGVzdHMgdG8gcmV0dXJuICgwIHJldHVybnMgYWxsKS5cbiAgICogQHJldHVybnMge0FycmF5PHtmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyLCBkdXJhdGlvbk1zOiBudW1iZXJ9Pn0gLSBTbG93ZXN0IHRlc3RzLCBzbG93ZXN0IGZpcnN0LlxuICAgKi9cbiAgZ2V0U2xvd2VzdFRlc3RzKGxpbWl0ID0gMTApIHtcbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4udGhpcy5fdGVzdER1cmF0aW9uc10uc29ydCgodGVzdEEsIHRlc3RCKSA9PiB0ZXN0Qi5kdXJhdGlvbk1zIC0gdGVzdEEuZHVyYXRpb25NcylcblxuICAgIHJldHVybiBsaW1pdCA+IDAgPyBzb3J0ZWQuc2xpY2UoMCwgbGltaXQpIDogc29ydGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZSgpIHtcbiAgICB0aGlzLmFueVRlc3RzRm9jdXNzZWQgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gMFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICB0aGlzLl90ZXN0RHVyYXRpb25zID0gW11cbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2NvbXBsZXRlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX3Rlc3RNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gdW5kZWZpbmVkXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0VGVzdENvbnRleHQoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBvd25lckZpbGVQYXRoXG5cbiAgICBjb250ZXh0LnJlc2V0KHtjb25maWc6IHRydWV9KVxuICAgIGNvbnRleHQuc2V0RGVjbGFyYXRpb25Mb2NhdG9yKCgpID0+IHRoaXMuY2FwdHVyZVRlc3REZWNsYXJhdGlvbkxvY2F0aW9uKG93bmVyRmlsZVBhdGgpKVxuICAgIGNvbnN0IHRlc3RpbmdDb25maWdQYXRoID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0VGVzdGluZygpXG5cbiAgICBhd2FpdCBjb250ZXh0LmRlc2NyaWJlKFwiXCIsIHtkYXRhYmFzZUNsZWFuaW5nOiB7dHJhbnNhY3Rpb246IHRydWV9fSwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRlc3RpbmdDb25maWdQYXRoKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuUHJvZmlsZVNwYW4oe3BoYXNlOiBcInRlc3RpbmcgY29uZmlnL2dsb2JhbCBzZXR1cFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmltcG9ydFRlc3RpbmdDb25maWdQYXRoKClcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9wcm9maWxlcikge1xuICAgICAgICBhd2FpdCB0aGlzLmltcG9ydFRlc3RGaWxlcygpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRoaXMuZ2V0VGVzdEZpbGVzKCkpIHtcbiAgICAgICAgICBvd25lckZpbGVQYXRoID0gdGVzdEZpbGVcbiAgICAgICAgICBjb25zdCBleGlzdGluZ1JlZ2lzdHJhdGlvbnMgPSB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKClcblxuICAgICAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICAgICAgfSwge2ZpbGVQYXRoOiB0ZXN0RmlsZX0pXG4gICAgICAgICAgdGhpcy5hc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKGV4aXN0aW5nUmVnaXN0cmF0aW9ucywgdGVzdEZpbGUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICAgIG93bmVyRmlsZVBhdGggPSB1bmRlZmluZWRcbiAgICB0aGlzLmFuYWx5emVEZWNsYXJhdGlvbnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGEgdGVzdCBzb3VyY2UgbG9jYXRpb24gd2l0aG91dCBhdHRyaWJ1dGluZyBwYWNrYWdlL2ZhY2FkZSBmcmFtZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBvd25lckZpbGVQYXRoIC0gSW1wb3J0aW5nIGVudHJ5IGZpbGUgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHt7ZmlsZVBhdGg/OiBzdHJpbmcsIGxpbmU/OiBudW1iZXJ9fSAtIERlY2xhcmF0aW9uIGxvY2F0aW9uLlxuICAgKi9cbiAgY2FwdHVyZVRlc3REZWNsYXJhdGlvbkxvY2F0aW9uKG93bmVyRmlsZVBhdGgpIHtcbiAgICBjb25zdCBzdGFjayA9IG5ldyBFcnJvcigpLnN0YWNrPy5zcGxpdChcIlxcblwiKSB8fCBbXVxuXG4gICAgZm9yIChjb25zdCBzdGFja0xpbmUgb2Ygc3RhY2spIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gc3RhY2tMaW5lLm1hdGNoKC8oPzpcXCh8XFxzKShmaWxlOlxcL1xcLy4qP3xcXC9bXlwiXSo/KTooXFxkKyk6KFxcZCspXFwpPyQvdSlcbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGxldCBmaWxlUGF0aCA9IG1hdGNoWzFdXG4gICAgICBpZiAoZmlsZVBhdGguc3RhcnRzV2l0aChcImZpbGU6Ly9cIikpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmaWxlUGF0aCA9IGZpbGVVUkxUb1BhdGgoZmlsZVBhdGgpXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc29sdmVkRmlsZVBhdGggPSBwYXRoLnJlc29sdmUoZmlsZVBhdGgpXG4gICAgICBjb25zdCBwb3J0YWJsZVBhdGggPSByZXNvbHZlZEZpbGVQYXRoLnJlcGxhY2VBbGwocGF0aC5zZXAsIFwiL1wiKVxuXG4gICAgICBpZiAocG9ydGFibGVQYXRoLmVuZHNXaXRoKFwiL3NyYy90ZXN0aW5nL3Rlc3QtcnVubmVyLmpzXCIpKSBjb250aW51ZVxuICAgICAgaWYgKHBvcnRhYmxlUGF0aC5lbmRzV2l0aChcIi9zcmMvdGVzdGluZy90ZXN0LmpzXCIpKSBjb250aW51ZVxuICAgICAgaWYgKHBvcnRhYmxlUGF0aC5pbmNsdWRlcyhcIi9ub2RlX21vZHVsZXMvQHZlbG9jaW91cy90ZXN0aW5nL1wiKSkgY29udGludWVcblxuICAgICAgcmV0dXJuIHtmaWxlUGF0aDogcmVzb2x2ZWRGaWxlUGF0aCwgbGluZTogTnVtYmVyKG1hdGNoWzJdKX1cbiAgICB9XG5cbiAgICByZXR1cm4gb3duZXJGaWxlUGF0aCA/IHtmaWxlUGF0aDogb3duZXJGaWxlUGF0aH0gOiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXJlIGFueSB0ZXN0cyBmb2N1c3NlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdGVzdHMgZm9jdXNzZWQuXG4gICAqL1xuICBhcmVBbnlUZXN0c0ZvY3Vzc2VkKCkge1xuICAgIGlmICh0aGlzLmFueVRlc3RzRm9jdXNzZWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSGFzbid0IGJlZW4gZGV0ZWN0ZWQgeWV0XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYW55VGVzdHNGb2N1c3NlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgLyoqXG4gICAqIFJlY29yZHMgYW4gYXN5bmNocm9ub3VzIGNyYXNoIChhbiB1bmhhbmRsZWQgcHJvbWlzZSByZWplY3Rpb24gZGV0YWNoZWQgZnJvbVxuICAgKiBhbnkgYXdhaXQsIGUuZy4gYSBgdm9pZCBjb25uZWN0aW9uLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IGJyb2FkY2FzdCguLi4pKWBcbiAgICogZnJvbnRlbmQtbW9kZWwgcHVibGlzaCDigJQgb3IgYSBzeW5jaHJvbm91cyB0aHJvdyBpbnNpZGUgYSBkZXRhY2hlZCBjYWxsYmFja1xuICAgKiBzdWNoIGFzIGEgZHJpdmVyIHNvY2tldCBvciB0aW1lciBjYWxsYmFjaykgYXMgYSByZWFsLCB2aXNpYmxlLCBhdHRyaWJ1dGVkXG4gICAqIHRlc3QgZmFpbHVyZS5cbiAgICpcbiAgICogV2l0aG91dCB0aGlzLCBzdWNoIGEgcmVqZWN0aW9uL2V4Y2VwdGlvbiBoYXMgbm8gaGFuZGxlciwgc28gb24gbW9kZXJuIE5vZGVcbiAgICogdGhlIHByb2Nlc3MgaXMgVEVSTUlOQVRFRCDigJQgdGhlIHJ1biBlbmRzIHdpdGggbm8gcmVwb3J0ZWQgZmFpbHVyZXMgYW5kIENJXG4gICAqIGp1c3Qgc2VlcyBhIGNyYXNoZWQvcmV0cmllZCBzaGFyZCB3aXRoIGFuIGVtcHR5IHJlc3VsdCAodGhlIHJlY3VycmluZ1xuICAgKiBcInNpbGVudCB0ZXN0LXJ1bm5lciBkZWF0aFwiOiBpbnZpc2libGUgYW5kIGltcG9zc2libGUgdG8gZGlhZ25vc2UpLiBUdXJuaW5nXG4gICAqIGl0IGludG8gYSBmYWlsdXJlIG1ha2VzIHRoZSBydW4gZ28gcmVkIHdpdGggc29tZXRoaW5nIGRlYnVnZ2FibGUgaW5zdGVhZCBvZlxuICAgKiB2YW5pc2hpbmcuXG4gICAqIEBwYXJhbSB7XCJ1bmNhdWdodEV4Y2VwdGlvblwiIHwgXCJ1bmhhbmRsZWRSZWplY3Rpb25cIn0ga2luZCAtIEFzeW5jLWNyYXNoIGtpbmQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gUmVqZWN0aW9uIHJlYXNvbiBvciB0aHJvd24gZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQXN5bmNDcmFzaChraW5kLCByZWFzb24pIHtcbiAgICBjb25zdCBlcnJvciA9IHJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gcmVhc29uIDogbmV3IEVycm9yKGAke2tpbmR9OiAke1N0cmluZyhyZWFzb24pfWApXG4gICAgY29uc3QgbmVhciA9IHRoaXMuX2xhc3RUZXN0Q29udGV4dFxuICAgIGNvbnN0IGF0dHJpYnV0aW9uID0gbmVhciA/IGAsIG5lYXIgdGVzdDogJHtuZWFyLmZ1bGxEZXNjcmlwdGlvbn0gKCR7bmVhci5maWxlUGF0aH06JHtuZWFyLmxpbmV9KWAgOiBcIlwiXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9ICh0aGlzLl9mYWlsZWRUZXN0cyB8fCAwKSArIDFcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogYDwke2tpbmR9IGR1cmluZyB0ZXN0IHJ1biR7YXR0cmlidXRpb259PmAsXG4gICAgICBmaWxlUGF0aDogbmVhciA/IG5lYXIuZmlsZVBhdGggOiBcIjx0ZXN0IHJ1bm5lcj5cIixcbiAgICAgIGxpbmU6IG5lYXIgPyBuZWFyLmxpbmUgOiAwLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuW3Rlc3QtcnVubmVyXSAke2tpbmR9IGR1cmluZyB0aGUgdGVzdCBydW4g4oCUIHRoaXMgd291bGQgb3RoZXJ3aXNlIHRlcm1pbmF0ZSB0aGUgcHJvY2VzcyBzaWxlbnRseSBhbmQgc3VyZmFjZSBvbmx5IGFzIGEgY3Jhc2hlZC9yZXRyaWVkIHNoYXJkIHdpdGggemVybyByZXBvcnRlZCBmYWlsdXJlcy4ke2F0dHJpYnV0aW9ufWApKVxuICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGNsZWFudXAgZmFpbHVyZSBhZnRlciB0aW1lb3V0IGhhbmRsaW5nIGhhcyBiZWd1bi5cbiAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBEZXRhY2hlZCBjbGVhbnVwIHJlamVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNsZWFudXBOYW1lIC0gQ2xlYW51cCBvcGVyYXRpb24gbmFtZS5cbiAgICogQHBhcmFtIHtTZXQ8RXJyb3I+fSBbcmVjb3JkZWRFcnJvcnNdIC0gQXR0ZW1wdC1vd25lZCBjbGVhbnVwIGVycm9ycyBhbHJlYWR5IHJlcG9ydGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShyZWFzb24sIGNsZWFudXBOYW1lLCByZWNvcmRlZEVycm9ycykge1xuICAgIGNvbnN0IGVycm9yID0gcmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyByZWFzb24gOiBuZXcgRXJyb3IoYCR7Y2xlYW51cE5hbWV9IGNsZWFudXAgZmFpbGVkOiAke1N0cmluZyhyZWFzb24pfWApXG5cbiAgICBpZiAocmVjb3JkZWRFcnJvcnMpIHtcbiAgICAgIC8vIE11bHRpcGxlIGJvdW5kZWQgb2JzZXJ2ZXJzIGNhbiByZWNlaXZlIHRoZSBzYW1lIGRldGFjaGVkIGNsZWFudXAgcmVqZWN0aW9uLlxuICAgICAgaWYgKHJlY29yZGVkRXJyb3JzLmhhcyhlcnJvcikpIHJldHVyblxuICAgICAgcmVjb3JkZWRFcnJvcnMuYWRkKGVycm9yKVxuICAgIH1cblxuICAgIGNvbnN0IG5lYXIgPSB0aGlzLl9sYXN0VGVzdENvbnRleHRcbiAgICBjb25zdCBhdHRyaWJ1dGlvbiA9IG5lYXIgPyBgLCBuZWFyIHRlc3Q6ICR7bmVhci5mdWxsRGVzY3JpcHRpb259ICgke25lYXIuZmlsZVBhdGh9OiR7bmVhci5saW5lfSlgIDogXCJcIlxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAodGhpcy5fZmFpbGVkVGVzdHMgfHwgMCkgKyAxXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IGA8JHtjbGVhbnVwTmFtZX0gZW1lcmdlbmN5IGNsZWFudXAgZmFpbHVyZSR7YXR0cmlidXRpb259PmAsXG4gICAgICBmaWxlUGF0aDogbmVhciA/IG5lYXIuZmlsZVBhdGggOiBcIjx0ZXN0IHJ1bm5lcj5cIixcbiAgICAgIGxpbmU6IG5lYXIgPyBuZWFyLmxpbmUgOiAwLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuW3Rlc3QtcnVubmVyXSAke2NsZWFudXBOYW1lfSBjbGVhbnVwIGZhaWxlZCBhZnRlciB0aW1lb3V0IGhhbmRsaW5nIGJlZ2FuLiR7YXR0cmlidXRpb259YCkpXG4gICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgfVxuXG4gIGFzeW5jIHJ1bigpIHtcbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgcHJvY2Vzcy1sZXZlbCB1bmhhbmRsZWQgcmVqZWN0aW9uIGR1cmluZyB0aGUgcnVuLlxuICAgICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gUmVqZWN0aW9uIHJlYXNvbi5cbiAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgKi9cbiAgICBjb25zdCBvblVuaGFuZGxlZFJlamVjdGlvbiA9IChyZWFzb24pID0+IHtcbiAgICAgIC8vIElmIGEgdGVzdCBhdHRhY2hlZCBpdHMgT1dOIHVuaGFuZGxlZFJlamVjdGlvbiBsaXN0ZW5lciwgaXQgaXNcbiAgICAgIC8vIGludGVudGlvbmFsbHkgb2JzZXJ2aW5nL3RyaWdnZXJpbmcgdGhlIHJlamVjdGlvbiAoZS5nLiBiZWFjb25cbiAgICAgIC8vIGVycm9yLXJlcG9ydGluZy1zcGVjLmpzKSDigJQgTm9kZSBkaXNwYXRjaGVzIHRvIEVWRVJZIGxpc3RlbmVyLCBzbyBhbHNvXG4gICAgICAvLyBmYWlsaW5nIHRoZSBzdWl0ZSBoZXJlIHdvdWxkIGJyZWFrIHRob3NlIHRlc3RzLiBEZWZlciB0byB0aGUgdGVzdCdzXG4gICAgICAvLyBoYW5kbGVyOyBvbmx5IHRyZWF0IGEgcmVqZWN0aW9uIGFzIGEgc2lsZW50LWRlYXRoIGNyYXNoIHdoZW4gb3VycyBpcyB0aGVcbiAgICAgIC8vIHNvbGUgbGlzdGVuZXIgKG5vIHBlcnNpc3RlbnQgZnJhbWV3b3JrIGxpc3RlbmVyIGV4aXN0cyB0byBtYXNrIHRoaXMpLlxuICAgICAgaWYgKHByb2Nlc3MubGlzdGVuZXJDb3VudChcInVuaGFuZGxlZFJlamVjdGlvblwiKSA+IDEpIHJldHVyblxuXG4gICAgICB0aGlzLnJlY29yZEFzeW5jQ3Jhc2goXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgcmVhc29uKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBwcm9jZXNzLWxldmVsIHVuY2F1Z2h0IGV4Y2VwdGlvbiBkdXJpbmcgdGhlIHJ1biDigJQgYVxuICAgICAqIHN5bmNocm9ub3VzIHRocm93IGluc2lkZSBhIGRldGFjaGVkIGNhbGxiYWNrIChkcml2ZXIgc29ja2V0LCB0aW1lcixcbiAgICAgKiBldmVudCBlbWl0dGVyKSB0aGF0IG5vIHRlc3QgYXdhaXQgb2JzZXJ2ZXMuIFNhbWUgc2lsZW50LWRlYXRoIG1vZGUgYXNcbiAgICAgKiB1bmhhbmRsZWQgcmVqZWN0aW9uczogd2l0aG91dCBhIGhhbmRsZXIgdGhlIHByb2Nlc3MgZGllcyBtaWQtcnVuIGFuZCBDSVxuICAgICAqIHNlZXMgYSBjcmFzaGVkIHNoYXJkIHdpdGggemVybyByZXBvcnRlZCBmYWlsdXJlcy5cbiAgICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gVGhyb3duIGVycm9yLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIGNvbnN0IG9uVW5jYXVnaHRFeGNlcHRpb24gPSAoZXJyb3IpID0+IHtcbiAgICAgIC8vIE1pcnJvciB0aGUgdW5oYW5kbGVkUmVqZWN0aW9uIGRlZmVycmFsOiBhIHRlc3Qgb2JzZXJ2aW5nL3RyaWdnZXJpbmdcbiAgICAgIC8vIHVuY2F1Z2h0IGV4Y2VwdGlvbnMgd2l0aCBpdHMgb3duIGxpc3RlbmVyIG93bnMgdGhlbS5cbiAgICAgIGlmIChwcm9jZXNzLmxpc3RlbmVyQ291bnQoXCJ1bmNhdWdodEV4Y2VwdGlvblwiKSA+IDEpIHJldHVyblxuXG4gICAgICB0aGlzLnJlY29yZEFzeW5jQ3Jhc2goXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBlcnJvcilcbiAgICB9XG5cbiAgICBwcm9jZXNzLm9uKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIG9uVW5oYW5kbGVkUmVqZWN0aW9uKVxuICAgIHByb2Nlc3Mub24oXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBvblVuY2F1Z2h0RXhjZXB0aW9uKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuUGFja2FnZVRlc3RzKClcblxuICAgICAgLy8gQSByZWplY3Rpb24gc2NoZWR1bGVkIGJ5IHRoZSBmaW5hbCB0ZXN0IChhIGRldGFjaGVkIHJlamVjdGVkIHByb21pc2UsXG4gICAgICAvLyBvciBhbiBhZnRlckNvbW1pdCBjYWxsYmFjayByZWplY3RpbmcgYXMgdGhlIHN1aXRlIGRyYWlucykgaXMgcmVwb3J0ZWRcbiAgICAgIC8vIGJ5IE5vZGUgb24gYSBMQVRFUiB0dXJuLiBEcmFpbiBhIGZldyB0dXJucyB3aGlsZSB0aGUgaGFuZGxlciBpcyBzdGlsbFxuICAgICAgLy8gYXR0YWNoZWQgc28gdGhvc2UgbGF0ZSByZWplY3Rpb25zIGFyZSByZWNvcmRlZCBpbnN0ZWFkIG9mIGVzY2FwaW5nIHRvXG4gICAgICAvLyB0aGUgZGVmYXVsdCBjcmFzaCBwYXRoIGFmdGVyIGNsZWFudXAuXG4gICAgICBmb3IgKGxldCBkcmFpblR1cm4gPSAwOyBkcmFpblR1cm4gPCAzOyBkcmFpblR1cm4rKykge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0SW1tZWRpYXRlKHJlc29sdmUpKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBwcm9jZXNzLm9mZihcInVuaGFuZGxlZFJlamVjdGlvblwiLCBvblVuaGFuZGxlZFJlamVjdGlvbilcbiAgICAgIHByb2Nlc3Mub2ZmKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgb25VbmNhdWdodEV4Y2VwdGlvbilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gYWZ0ZXIgYWxscyBmb3IgYWN0aXZlIHNjb3Blcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhbnVwIGhvb2tzIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIHJ1bkFmdGVyQWxsc0ZvckFjdGl2ZVNjb3BlcygpIHtcbiAgICBjb25zdCBmYWlsdXJlU3RhcnQgPSB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5sZW5ndGhcblxuICAgIGF3YWl0IHRoaXMuX3BhY2thZ2VSdW5uZXI/LmNsZWFudXBBY3RpdmVTdWl0ZXMoKVxuICAgIHRoaXMudGhyb3dBZnRlckFsbEZhaWx1cmVzKHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnNsaWNlKGZhaWx1cmVTdGFydCkpXG4gIH1cblxuICAvKiogQnVpbGRzIGRlY2xhcmF0aW9uIG1ldGFkYXRhIHVzZWQgb25seSBieSBmcmFtZXdvcmsgYWRhcHRlcnMgYW5kIHByb2plY3Rpb25zLiAqL1xuICBhbmFseXplRGVjbGFyYXRpb25zKCkge1xuICAgIGNvbnN0IHZpc2l0ID0gKC8qKiBAdHlwZSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259ICovIHN1aXRlLCAvKiogQHR5cGUge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW119ICovIGFuY2VzdG9ycywgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovIHBhcmVudFByb2ZpbGVTY29wZUlkKSA9PiB7XG4gICAgICBjb25zdCBzdWl0ZXMgPSBbLi4uYW5jZXN0b3JzLCBzdWl0ZV1cbiAgICAgIGNvbnN0IGRlc2NyaXB0aW9ucyA9IHN1aXRlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5uYW1lKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiXCIpXG4gICAgICBjb25zdCBvd25lckZpbGVQYXRoID0gdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuZ2V0KHN1aXRlKSA/PyBzdWl0ZS5sb2NhdGlvbi5maWxlUGF0aFxuICAgICAgY29uc3QgcHJvZmlsZVNjb3BlSWQgPSB0aGlzLl9wcm9maWxlcj8uc2NvcGVJZChzdWl0ZSwge1xuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGZpbGVQYXRoOiBvd25lckZpbGVQYXRoLFxuICAgICAgICBsaW5lOiBzdWl0ZS5sb2NhdGlvbi5saW5lLFxuICAgICAgICBwYXJlbnRJZDogcGFyZW50UHJvZmlsZVNjb3BlSWRcbiAgICAgIH0pXG5cbiAgICAgIGZvciAoY29uc3QgaG9va3Mgb2YgT2JqZWN0LnZhbHVlcyhzdWl0ZS5ob29rcykpIHtcbiAgICAgICAgaG9va3MuZm9yRWFjaCgoaG9vaywgZGVjbGFyYXRpb25JbmRleCkgPT4ge1xuICAgICAgICAgIHRoaXMuX2hvb2tNZXRhZGF0YS5zZXQoaG9vaywge1xuICAgICAgICAgICAgZGVjbGFyYXRpb25JbmRleCxcbiAgICAgICAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogcHJvZmlsZVNjb3BlSWQsXG4gICAgICAgICAgICBvd25lckZpbGVQYXRoOiB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5nZXQoaG9vaykgPz8gaG9vay5sb2NhdGlvbi5maWxlUGF0aCA/PyBvd25lckZpbGVQYXRoXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCB0ZXN0RGVjbGFyYXRpb24gb2Ygc3VpdGUudGVzdHMpIHtcbiAgICAgICAgY29uc3QgZnVsbERlc2NyaXB0aW9uID0gdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZWNsYXJhdGlvbi5uYW1lKVxuICAgICAgICBjb25zdCBkZWNsYXJhdGlvbnMgPSB0aGlzLl90ZXN0c0J5RnVsbE5hbWUuZ2V0KGZ1bGxEZXNjcmlwdGlvbikgfHwgW11cblxuICAgICAgICBkZWNsYXJhdGlvbnMucHVzaCh0ZXN0RGVjbGFyYXRpb24pXG4gICAgICAgIHRoaXMuX3Rlc3RzQnlGdWxsTmFtZS5zZXQoZnVsbERlc2NyaXB0aW9uLCBkZWNsYXJhdGlvbnMpXG4gICAgICAgIHRoaXMuX3Rlc3RNZXRhZGF0YS5zZXQodGVzdERlY2xhcmF0aW9uLCB7XG4gICAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICAgIHRlc3REZXNjcmlwdGlvbjogdGVzdERlY2xhcmF0aW9uLm5hbWUsXG4gICAgICAgICAgZnVsbERlc2NyaXB0aW9uLFxuICAgICAgICAgIG93bmVyRmlsZVBhdGg6IHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLmdldCh0ZXN0RGVjbGFyYXRpb24pID8/IHRlc3REZWNsYXJhdGlvbi5sb2NhdGlvbi5maWxlUGF0aCA/PyBvd25lckZpbGVQYXRoLFxuICAgICAgICAgIHN1aXRlc1xuICAgICAgICB9KVxuICAgICAgICBjb25zdCBsZWdhY3lUZXN0RGF0YSA9IHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZT8uZ2V0KGZ1bGxEZXNjcmlwdGlvbilcbiAgICAgICAgaWYgKGxlZ2FjeVRlc3REYXRhKSB7XG4gICAgICAgICAgdGhpcy5fdGVzdENvbXBhdGliaWxpdHkuc2V0KHRlc3REZWNsYXJhdGlvbiwge1xuICAgICAgICAgICAgdGVzdEFyZ3M6IHRoaXMuX3Rlc3RBcmd1bWVudHMuY29weSh0ZXN0RGVjbGFyYXRpb24pLFxuICAgICAgICAgICAgdGVzdERhdGE6IGxlZ2FjeVRlc3REYXRhXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl90ZXN0c0NvdW50KytcbiAgICAgICAgaWYgKHRlc3REZWNsYXJhdGlvbi5zdGF0ZSA9PT0gXCJydW5cIiAmJiAodGVzdERlY2xhcmF0aW9uLmZvY3VzIHx8IHN1aXRlcy5zb21lKChlbnRyeSkgPT4gZW50cnkuZm9jdXMpKSkge1xuICAgICAgICAgIHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGNoaWxkU3VpdGUgb2Ygc3VpdGUuc3VpdGVzKSB2aXNpdChjaGlsZFN1aXRlLCBzdWl0ZXMsIHByb2ZpbGVTY29wZUlkKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3VpdGUgb2YgdGhpcy5nZXRUZXN0Q29udGV4dCgpLnJlZ2lzdHJ5LnN1aXRlcykgdmlzaXQoc3VpdGUsIFtdLCB1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogR2V0cyBwYWNrYWdlIGhvb2sgY29tcGF0aWJpbGl0eSBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtQYWNrYWdlSG9va0RlY2xhcmF0aW9ufSBob29rIC0gUGFja2FnZSBob29rIGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2RlY2xhcmF0aW9uSW5kZXg6IG51bWJlciwgZGVjbGFyYXRpb25TY29wZUlkOiBzdHJpbmcgfCB1bmRlZmluZWQsIG93bmVyRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZH19IC0gSG9vayBtZXRhZGF0YS5cbiAgICovXG4gIGhvb2tNZXRhZGF0YShob29rKSB7XG4gICAgcmV0dXJuIHRoaXMuX2hvb2tNZXRhZGF0YS5nZXQoaG9vaykgfHwge2RlY2xhcmF0aW9uSW5kZXg6IDAsIGRlY2xhcmF0aW9uU2NvcGVJZDogdW5kZWZpbmVkLCBvd25lckZpbGVQYXRoOiBob29rLmxvY2F0aW9uLmZpbGVQYXRofVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGFja2FnZSB0ZXN0IGNvbXBhdGliaWxpdHkgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3tkZXNjcmlwdGlvbnM6IHN0cmluZ1tdLCB0ZXN0RGVzY3JpcHRpb246IHN0cmluZywgZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIG93bmVyRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCwgc3VpdGVzOiBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltdfX0gLSBEZWNsYXJhdGlvbiBtZXRhZGF0YS5cbiAgICovXG4gIHRlc3RNZXRhZGF0YSh0ZXN0KSB7XG4gICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLl90ZXN0TWV0YWRhdGEuZ2V0KHRlc3QpXG4gICAgaWYgKCFtZXRhZGF0YSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHBhY2thZ2UgdGVzdCBtZXRhZGF0YTogJHt0ZXN0Lm5hbWV9YClcbiAgICByZXR1cm4gbWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHN0YWJsZSBjb21wYXRpYmlsaXR5IGRhdGEgZm9yIGEgcGFja2FnZSBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e3Rlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfX0gLSBTdGFibGUgY29tcGF0aWJpbGl0eSBkYXRhLlxuICAgKi9cbiAgdGVzdERhdGEodGVzdCkge1xuICAgIGxldCBjb21wYXRpYmlsaXR5ID0gdGhpcy5fdGVzdENvbXBhdGliaWxpdHkuZ2V0KHRlc3QpXG5cbiAgICBpZiAoIWNvbXBhdGliaWxpdHkpIHtcbiAgICAgIGNvbnN0IHRlc3RBcmdzID0gdGhpcy5fdGVzdEFyZ3VtZW50cy5jb3B5KHRlc3QpXG4gICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMudGVzdE1ldGFkYXRhKHRlc3QpXG4gICAgICBjb25zdCB0ZXN0RGF0YSA9IHtcbiAgICAgICAgYXJnczogdGVzdEFyZ3MsXG4gICAgICAgIGRlY2xhcmF0aW9uOiB0ZXN0LFxuICAgICAgICBmaWxlUGF0aDogdGVzdC5sb2NhdGlvbi5maWxlUGF0aCxcbiAgICAgICAgZnVuY3Rpb246IHRlc3QuY2FsbGJhY2ssXG4gICAgICAgIGxpbmU6IHRlc3QubG9jYXRpb24ubGluZSxcbiAgICAgICAgb3duZXJGaWxlUGF0aDogbWV0YWRhdGEub3duZXJGaWxlUGF0aFxuICAgICAgfVxuICAgICAgY29tcGF0aWJpbGl0eSA9IHt0ZXN0QXJncywgdGVzdERhdGF9XG4gICAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eS5zZXQodGVzdCwgY29tcGF0aWJpbGl0eSlcbiAgICB9XG5cbiAgICByZXR1cm4gY29tcGF0aWJpbGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIEluamVjdHMgZnJhbWV3b3JrIGNvbGxhYm9yYXRvcnMgaW50byBzdGFibGUgY29tcGF0aWJpbGl0eSBkYXRhIG9uY2UuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3Rlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfT59IC0gSW5qZWN0ZWQgY29tcGF0aWJpbGl0eSBkYXRhLlxuICAgKi9cbiAgYXN5bmMgdGVzdENvbXBhdGliaWxpdHkodGVzdCkge1xuICAgIGNvbnN0IGNvbXBhdGliaWxpdHkgPSB0aGlzLnRlc3REYXRhKHRlc3QpXG5cbiAgICBpZiAoIXRoaXMuX2luamVjdGVkVGVzdHMuaGFzKHRlc3QpKSB7XG4gICAgICBhd2FpdCB0aGlzLl90ZXN0QXJndW1lbnRzLmluamVjdChjb21wYXRpYmlsaXR5LnRlc3RBcmdzKVxuICAgICAgdGhpcy5faW5qZWN0ZWRUZXN0cy5hZGQodGVzdClcbiAgICB9XG5cbiAgICByZXR1cm4gY29tcGF0aWJpbGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSByYXcgZnJhbWV3b3JrIGF0dGVtcHQgb3V0Y29tZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXR0ZW1wdE51bWJlciAtIE9uZS1iYXNlZCBhdHRlbXB0IG51bWJlci5cbiAgICogQHBhcmFtIHt7YWJvcnRSZW1haW5pbmdUZXN0czogYm9vbGVhbiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBmYWlsZWQ6IGJvb2xlYW59fSBvdXRjb21lIC0gUmF3IGF0dGVtcHQgb3V0Y29tZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRBdHRlbXB0T3V0Y29tZSh0ZXN0LCBhdHRlbXB0TnVtYmVyLCBvdXRjb21lKSB7XG4gICAgY29uc3Qgb3V0Y29tZXMgPSB0aGlzLl9hdHRlbXB0T3V0Y29tZXMuZ2V0KHRlc3QpIHx8IG5ldyBNYXAoKVxuICAgIG91dGNvbWVzLnNldChhdHRlbXB0TnVtYmVyLCBvdXRjb21lKVxuICAgIHRoaXMuX2F0dGVtcHRPdXRjb21lcy5zZXQodGVzdCwgb3V0Y29tZXMpXG4gICAgaWYgKG91dGNvbWUuYWJvcnRSZW1haW5pbmdUZXN0cykgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmF3IGZyYW1ld29yayBhdHRlbXB0IG91dGNvbWUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHROdW1iZXIgLSBPbmUtYmFzZWQgYXR0ZW1wdCBudW1iZXIuXG4gICAqIEByZXR1cm5zIHt7YWJvcnRSZW1haW5pbmdUZXN0czogYm9vbGVhbiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBmYWlsZWQ6IGJvb2xlYW59IHwgdW5kZWZpbmVkfSAtIFJhdyBhdHRlbXB0IG91dGNvbWUuXG4gICAqL1xuICBhdHRlbXB0T3V0Y29tZSh0ZXN0LCBhdHRlbXB0TnVtYmVyKSB7IHJldHVybiB0aGlzLl9hdHRlbXB0T3V0Y29tZXMuZ2V0KHRlc3QpPy5nZXQoYXR0ZW1wdE51bWJlcikgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgcmF3IHN1aXRlLWhvb2sgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGZhaWx1cmUgLSBTdWl0ZS1ob29rIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259IGZhaWx1cmUuc3VpdGUgLSBPd25pbmcgcGFja2FnZSBzdWl0ZS5cbiAgICogQHBhcmFtIHtcImJlZm9yZUFsbFwiIHwgXCJhZnRlckFsbFwifSBmYWlsdXJlLnBoYXNlIC0gSG9vayBwaGFzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZmFpbHVyZS5lcnJvciAtIFJhdyBob29rIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkU3VpdGVIb29rRmFpbHVyZShmYWlsdXJlKSB7IHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnB1c2goZmFpbHVyZSkgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSByYXcgYW5jZXN0b3Igc2V0dXAgZmFpbHVyZSBmb3IgYSBwYWNrYWdlIHRlc3QuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFJhdyBzZXR1cCBmYWlsdXJlLlxuICAgKi9cbiAgc2V0dXBGYWlsdXJlRm9yKHRlc3QpIHtcbiAgICBjb25zdCBzdWl0ZXMgPSB0aGlzLnRlc3RNZXRhZGF0YSh0ZXN0KS5zdWl0ZXNcbiAgICByZXR1cm4gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuZmluZCgoZmFpbHVyZSkgPT4gZmFpbHVyZS5waGFzZSA9PT0gXCJiZWZvcmVBbGxcIiAmJiBzdWl0ZXMuaW5jbHVkZXMoZmFpbHVyZS5zdWl0ZSkpPy5lcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGluY29tcGxldGUgZGVjbGFyYXRpb24gd2l0aCBhIHBhY2thZ2UgZnVsbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZnVsbE5hbWUgLSBQYWNrYWdlIGZ1bGwgbmFtZS5cbiAgICogQHJldHVybnMge1BhY2thZ2VUZXN0RGVjbGFyYXRpb24gfCB1bmRlZmluZWR9IC0gTmV4dCBtYXRjaGluZyBkZWNsYXJhdGlvbi5cbiAgICovXG4gIGZpbmRUZXN0RGVjbGFyYXRpb24oZnVsbE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLmdldChmdWxsTmFtZSk/LmZpbmQoKHRlc3QpID0+ICF0aGlzLl9jb21wbGV0ZWRUZXN0cy5oYXModGVzdCkpXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwYWNrYWdlIGRlY2xhcmF0aW9uIGNvbXBsZXRlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBDb21wbGV0ZWQgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29tcGxldGVUZXN0RGVjbGFyYXRpb24odGVzdCkgeyB0aGlzLl9jb21wbGV0ZWRUZXN0cy5hZGQodGVzdCkgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBlZmZlY3RpdmUgcGFja2FnZSByZXRyeSBjb3VudC5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEVmZmVjdGl2ZSByZXRyeSBjb3VudC5cbiAgICovXG4gIHJldHJ5Q291bnQodGVzdCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGVzdC5vcHRpb25zLnJldHJpZXMgPz8gdGVzdC5vcHRpb25zLnJldHJ5ID8/IHRoaXMuZ2V0VGVzdENvbnRleHQoKS5jb25maWcucmV0cmllc1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSA/IE1hdGgubWF4KDAsIE1hdGguZmxvb3IodmFsdWUpKSA6IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBjb21wbGV0ZWQgdGVzdCBkdXJhdGlvbi5cbiAgICogQHBhcmFtIHt7ZHVyYXRpb25NczogbnVtYmVyLCBmaWxlUGF0aDogc3RyaW5nLCBmdWxsRGVzY3JpcHRpb246IHN0cmluZywgbGluZTogbnVtYmVyfX0gZHVyYXRpb24gLSBDb21wbGV0ZWQgdGVzdCBkdXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRUZXN0RHVyYXRpb24oZHVyYXRpb24pIHsgdGhpcy5fdGVzdER1cmF0aW9ucy5wdXNoKGR1cmF0aW9uKSB9XG5cbiAgLyoqIFJlY29yZHMgb25lIHN1Y2Nlc3NmdWwgcGFja2FnZSByZXN1bHQuICovXG4gIHJlY29yZFN1Y2Nlc3NmdWxUZXN0KCkgeyB0aGlzLl9zdWNjZXNzZnVsVGVzdHMrKyB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGZhaWxlZCBwYWNrYWdlIHRlc3QgaW4gdGhlIGxlZ2FjeSByZXN1bHQgcHJvamVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsZWQgdGVzdCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBQYXJlbnQgZGVzY3JpcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gUmF3IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnNvbGVPdXRwdXQgLSBDYXB0dXJlZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIENvbXBhdGliaWxpdHkgdGVzdCBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEZhaWxlZFRlc3Qoe2Rlc2NyaXB0aW9ucywgZXJyb3IsIGNvbnNvbGVPdXRwdXQsIHRlc3REYXRhLCB0ZXN0RGVzY3JpcHRpb259KSB7XG4gICAgdGhpcy5fZmFpbGVkVGVzdHMrK1xuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSxcbiAgICAgIGZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCxcbiAgICAgIGxpbmU6IHRlc3REYXRhLmxpbmUsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IGNvbnNvbGVPdXRwdXQgfHwgdW5kZWZpbmVkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9yZXMgdGhlIGNvbXBsZXRlZCBwYWNrYWdlIHJlc3VsdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3RSdW5SZXN1bHR9IHJlc3VsdCAtIFBhY2thZ2UgcmVzdWx0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFBhY2thZ2VSZXN1bHQocmVzdWx0KSB7IHRoaXMuX3BhY2thZ2VSZXN1bHQgPSByZXN1bHQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBwYWNrYWdlIGtlcm5lbCB3aXRoIFZlbG9jaW91cyBmcmFtZXdvcmsgYWRhcHRlcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV4ZWN1dGlvbiBhbmQgdGVhcmRvd24uXG4gICAqL1xuICBhc3luYyBydW5QYWNrYWdlVGVzdHMoKSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICBlbnZpcm9ubWVudEhhbmRsZXIuaW5zdGFsbFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UodGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSlcbiAgICBlbnZpcm9ubWVudEhhbmRsZXIuaW5zdGFsbFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSh0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UpXG4gICAgdGhpcy5fcGFja2FnZVJ1bm5lciA9IG5ldyBQYWNrYWdlVGVzdFJ1bm5lcih7XG4gICAgICBjb250ZXh0OiB0aGlzLmdldFRlc3RDb250ZXh0KCksXG4gICAgICBpbmNsdWRlVGFnczogdGhpcy5faW5jbHVkZVRhZ3MsXG4gICAgICBleGNsdWRlVGFnczogWy4uLnRoaXMuZ2V0RXhjbHVkZVRhZ1NldCgpLCAuLi4odGhpcy5pc0Jyb3dzZXJUZXN0TW9kZSgpID8gW10gOiBbXCJicm93c2VyLW9ubHlcIl0pXSxcbiAgICAgIGV4YW1wbGVzOiB0aGlzLmdldEV4YW1wbGVQYXR0ZXJucygpLFxuICAgICAgbGluZUZpbHRlcnM6IHRoaXMuZ2V0TGluZUZpbHRlcnMoKSxcbiAgICAgIGluY2x1ZGVUYWdNb2RlOiBcImFueVwiLFxuICAgICAgZm9jdXNlZFRlc3RzQnlwYXNzSW5jbHVkZVRhZ3M6IHRydWUsXG4gICAgICBvbWl0RW1wdHlTdWl0ZU5hbWVzOiB0cnVlLFxuICAgICAgYXR0ZW1wdEV4ZWN1dG9yT3duc1RpbWVvdXQ6IHRydWUsXG4gICAgICBhdHRlbXB0RXhlY3V0b3I6IChpbnB1dCkgPT4gdGhpcy5fYXR0ZW1wdEV4ZWN1dG9yLmV4ZWN1dGUoaW5wdXQpLFxuICAgICAgdGVzdEFyZ3VtZW50UmVzb2x2ZXI6IChpbnB1dCkgPT4gdGhpcy5fdGVzdEFyZ3VtZW50cy5yZXNvbHZlKGlucHV0KSxcbiAgICAgIHN1aXRlSG9va0V4ZWN1dG9yOiAoaW5wdXQpID0+IHRoaXMuX3N1aXRlSG9va0V4ZWN1dG9yLmV4ZWN1dGUoaW5wdXQpLFxuICAgICAgcmVwb3J0ZXI6IHRoaXMuX3J1bm5lclJlcG9ydGVyXG4gICAgfSlcbiAgICBjb25zdCBmYWlsdXJlU3RhcnQgPSB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5sZW5ndGhcbiAgICBsZXQgcmVzdWx0XG5cbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5fcGFja2FnZVJ1bm5lci5ydW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEFib3J0UmVtYWluaW5nVGVzdHNFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgIGNvbnN0IGFmdGVyQWxsID0gdGhpcy5hZnRlckFsbE91dGNvbWUodGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuc2xpY2UoZmFpbHVyZVN0YXJ0KSlcbiAgICAgIGlmIChhZnRlckFsbC5mYWlsZWQpIHRoaXMucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGFmdGVyQWxsLmVycm9yLCBcImFmdGVyQWxsXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLnJlY29yZFBhY2thZ2VSZXN1bHQocmVzdWx0KVxuICAgIHRoaXMudGhyb3dBZnRlckFsbEZhaWx1cmVzKHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnNsaWNlKGZhaWx1cmVTdGFydCkpXG4gIH1cblxuICAvKipcbiAgICogQWdncmVnYXRlcyByYXcgYWZ0ZXItYWxsIGZhaWx1cmVzIHdpdGhvdXQgdXNpbmcgZXJyb3IgdHJ1dGhpbmVzcy5cbiAgICogQHBhcmFtIHtBcnJheTx7cGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSBmYWlsdXJlcyAtIEhvb2sgZmFpbHVyZXMuXG4gICAqIEByZXR1cm5zIHt7ZmFpbGVkOiBmYWxzZX0gfCB7ZmFpbGVkOiB0cnVlLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAtIEV4cGxpY2l0IGFmdGVyQWxsIG91dGNvbWUuXG4gICAqL1xuICBhZnRlckFsbE91dGNvbWUoZmFpbHVyZXMpIHtcbiAgICBjb25zdCBhZnRlckFsbEVycm9ycyA9IGZhaWx1cmVzLmZpbHRlcigoZmFpbHVyZSkgPT4gZmFpbHVyZS5waGFzZSA9PT0gXCJhZnRlckFsbFwiKS5tYXAoKGZhaWx1cmUpID0+IGZhaWx1cmUuZXJyb3IpXG5cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID09PSAwKSByZXR1cm4ge2ZhaWxlZDogZmFsc2V9XG4gICAgaWYgKGFmdGVyQWxsRXJyb3JzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHtmYWlsZWQ6IHRydWUsIGVycm9yOiBhZnRlckFsbEVycm9yc1swXX1cbiAgICByZXR1cm4ge1xuICAgICAgZmFpbGVkOiB0cnVlLFxuICAgICAgZXJyb3I6IG5ldyBBZ2dyZWdhdGVFcnJvcihhZnRlckFsbEVycm9ycywgXCJNdWx0aXBsZSBhY3RpdmUgYWZ0ZXJBbGwgc2NvcGVzIGZhaWxlZFwiLCB7Y2F1c2U6IGFmdGVyQWxsRXJyb3JzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhyb3dzIG9uZSByYXcgb3IgYWdncmVnYXRlZCBhZnRlci1hbGwgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtBcnJheTx7cGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSBmYWlsdXJlcyAtIEhvb2sgZmFpbHVyZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgdGhyb3dBZnRlckFsbEZhaWx1cmVzKGZhaWx1cmVzKSB7XG4gICAgY29uc3QgYWZ0ZXJBbGwgPSB0aGlzLmFmdGVyQWxsT3V0Y29tZShmYWlsdXJlcylcblxuICAgIGlmIChhZnRlckFsbC5mYWlsZWQpIHRocm93IGFmdGVyQWxsLmVycm9yXG4gIH1cblxuICAvKipcbiAgICogQ29tcGF0aWJpbGl0eSBoZWxwZXIgZm9yIGZvY3VzZWQgZnJhbWV3b3JrIGxpZmVjeWNsZSBzcGVjcy4gSXQgY29udmVydHMgYW5cbiAgICogZXhwbGljaXQgbGVnYWN5IGZpeHR1cmUgaW50byBpc29sYXRlZCBwYWNrYWdlIGRlY2xhcmF0aW9uczsgdGhlIHBhY2thZ2VcbiAgICogcnVubmVyIHJlbWFpbnMgdGhlIHNvbGUgZXhlY3V0aW9uIGVuZ2luZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMZWdhY3kgZml4dHVyZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7VGVzdHNBcmd1bWVudH0gYXJncy50ZXN0cyAtIEZpeHR1cmUgdHJlZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGFja2FnZSBleGVjdXRpb24uXG4gICAqL1xuICBhc3luYyBydW5UZXN0cyh7dGVzdHN9KSB7XG4gICAgY29uc3QgY29udGV4dCA9IGNyZWF0ZVRlc3RDb250ZXh0KClcbiAgICBjb25zdCBvcmlnaW5hbENvbnRleHQgPSB0aGlzLl9jb250ZXh0XG4gICAgY29udGV4dC5jb25maWd1cmVUZXN0cyh7XG4gICAgICBjb25zb2xlT3V0cHV0OiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmNvbnNvbGVPdXRwdXQsXG4gICAgICBkZWZhdWx0VGltZW91dE1zOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgICBleGNsdWRlVGFnczogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5leGNsdWRlVGFncyxcbiAgICAgIGZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lczogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5mYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMsXG4gICAgICByZXRyaWVzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLnJldHJpZXNcbiAgICB9KVxuICAgIHRoaXMuX2NvbnRleHQgPSBjb250ZXh0XG4gICAgdGhpcy5fdGVzdHNDb3VudCA9IDBcbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2NvbXBsZXRlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX3Rlc3RNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICBjb250ZXh0LnNldERlY2xhcmF0aW9uTG9jYXRvcigoKSA9PiB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24pXG4gICAgdGhpcy5kZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBcIlwiLCB0ZXN0cywgW10pXG4gICAgdGhpcy5hbmFseXplRGVjbGFyYXRpb25zKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blBhY2thZ2VUZXN0cygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2NvbnRleHQgPSBvcmlnaW5hbENvbnRleHRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYW4gaXNvbGF0ZWQgbGVnYWN5LXNoYXBlZCB0ZXN0IGZpeHR1cmUgaW50byBhIHBhY2thZ2UgY29udGV4dC5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdENvbnRleHR9IGNvbnRleHQgLSBJc29sYXRlZCBwYWNrYWdlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gU3VpdGUgbmFtZS5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBzY29wZSAtIExlZ2FjeSBmaXh0dXJlIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBBbmNlc3RvciBkZXNjcmlwdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZGVjbGFyZUxlZ2FjeUZpeHR1cmUoY29udGV4dCwgbmFtZSwgc2NvcGUsIGRlc2NyaXB0aW9ucykge1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbiA9IHtmaWxlUGF0aDogc2NvcGUuZmlsZVBhdGgsIGxpbmU6IHNjb3BlLmxpbmV9XG4gICAgY29udGV4dC5kZXNjcmliZShuYW1lLCBzY29wZS5hcmdzIHx8IHt9LCAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYmVmb3JlQWxscyB8fCBbXSkgY29udGV4dC5iZWZvcmVBbGwoaG9vay5jYWxsYmFjaylcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBzY29wZS5iZWZvcmVFYWNoZXMgfHwgW10pIGNvbnRleHQuYmVmb3JlRWFjaChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmFmdGVyRWFjaGVzIHx8IFtdKSBjb250ZXh0LmFmdGVyRWFjaChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmFmdGVyQWxscyB8fCBbXSkgY29udGV4dC5hZnRlckFsbChob29rLmNhbGxiYWNrKVxuICAgICAgY29uc3QgbmV4dERlc2NyaXB0aW9ucyA9IG5hbWUgPT09IFwiXCIgPyBkZXNjcmlwdGlvbnMgOiBbLi4uZGVzY3JpcHRpb25zLCBuYW1lXVxuICAgICAgZm9yIChjb25zdCBbdGVzdE5hbWUsIHRlc3REYXRhXSBvZiBPYmplY3QuZW50cmllcyhzY29wZS50ZXN0cyB8fCB7fSkpIHtcbiAgICAgICAgdGhpcy5fbGVnYWN5Rml4dHVyZUxvY2F0aW9uID0ge2ZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCwgbGluZTogdGVzdERhdGEubGluZX1cbiAgICAgICAgdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lPy5zZXQodGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihuZXh0RGVzY3JpcHRpb25zLCB0ZXN0TmFtZSksIHRlc3REYXRhKVxuICAgICAgICBjb250ZXh0Lml0KHRlc3ROYW1lLCB0ZXN0RGF0YS5hcmdzLCB0ZXN0RGF0YS5mdW5jdGlvbilcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgW3N1aXRlTmFtZSwgY2hpbGRTY29wZV0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGUuc3VicyB8fCB7fSkpIHtcbiAgICAgICAgdGhpcy5kZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBzdWl0ZU5hbWUsIGNoaWxkU2NvcGUsIG5leHREZXNjcmlwdGlvbnMpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVtaXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudE5hbWUgLSBFdmVudCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gcGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGxpc3RlbmVycyBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5uZXJSZXBvcnRlci5lbWl0RXZlbnQoZXZlbnROYW1lLCBwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbnQgcmVydW4gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBMZWZ0IHBhZGRpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHByaW50UmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGEsIGxlZnRQYWRkaW5nfSkge1xuICAgIGNvbnN0IHJlcnVuID0gdGhpcy5idWlsZFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhfSlcblxuICAgIGlmIChyZXJ1bikge1xuICAgICAgY29uc29sZS5lcnJvcihgJHtsZWZ0UGFkZGluZ30gIFJlLXJ1bjogJHtyZXJ1bn1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIHJlcnVuIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IGRhdGEuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gUmVydW4gY29tbWFuZC5cbiAgICovXG4gIGJ1aWxkUmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGF9KSB7XG4gICAgY29uc3QgYmFzZUNvbW1hbmQgPSBcIm5weCB2ZWxvY2lvdXMgdGVzdFwiXG4gICAgY29uc3QgZmlsZVBhdGggPSB0ZXN0RGF0YS5maWxlUGF0aFxuICAgIGNvbnN0IGxpbmUgPSB0ZXN0RGF0YS5saW5lXG5cbiAgICBpZiAoZmlsZVBhdGggJiYgbGluZSkge1xuICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcGF0aC5yZWxhdGl2ZShwcm9jZXNzLmN3ZCgpLCBmaWxlUGF0aClcbiAgICAgIHJldHVybiBgJHtiYXNlQ29tbWFuZH0gJHtyZWxhdGl2ZVBhdGh9OiR7bGluZX1gXG4gICAgfVxuXG4gICAgY29uc3QgZnVsbERlc2NyaXB0aW9uID0gdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbilcblxuICAgIGlmIChmdWxsRGVzY3JpcHRpb24pIHtcbiAgICAgIHJldHVybiBgJHtiYXNlQ29tbWFuZH0gLS1leGFtcGxlICR7SlNPTi5zdHJpbmdpZnkoZnVsbERlc2NyaXB0aW9uKX1gXG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7QXR0ZW1wdENvbnNvbGVPdXRwdXRbXX0gYXR0ZW1wdENvbnNvbGVPdXRwdXRzIC0gQXR0ZW1wdCBvdXRwdXQgZW50cmllcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb21iaW5lZCBjb25zb2xlIG91dHB1dC5cbiAgICovXG4gIGJ1aWxkQ29uc29sZU91dHB1dChhdHRlbXB0Q29uc29sZU91dHB1dHMpIHtcbiAgICBpZiAoYXR0ZW1wdENvbnNvbGVPdXRwdXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCJcbiAgICBpZiAoYXR0ZW1wdENvbnNvbGVPdXRwdXRzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIGF0dGVtcHRDb25zb2xlT3V0cHV0c1swXS5vdXRwdXRcblxuICAgIHJldHVybiBhdHRlbXB0Q29uc29sZU91dHB1dHMubWFwKChhdHRlbXB0Q29uc29sZU91dHB1dCkgPT4ge1xuICAgICAgcmV0dXJuIGAtLS0gQXR0ZW1wdCAke2F0dGVtcHRDb25zb2xlT3V0cHV0LmF0dGVtcHROdW1iZXJ9IC0tLVxcbiR7YXR0ZW1wdENvbnNvbGVPdXRwdXQub3V0cHV0fWBcbiAgICB9KS5qb2luKFwiXFxuXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmFpbGVkIGNvbnNvbGUgb3V0cHV0IG1heCBsaW5lcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIGZhaWxlZCBjb25zb2xlIGxpbmVzLlxuICAgKi9cbiAgZ2V0RmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzKCkge1xuICAgIGNvbnN0IG1heExpbmVzID0gdGVzdENvbmZpZy5mYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXNcblxuICAgIGlmICh0eXBlb2YgbWF4TGluZXMgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZShtYXhMaW5lcykpIHJldHVybiAyMDBcblxuICAgIHJldHVybiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKG1heExpbmVzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRydW5jYXRlIGZhaWxlZCBjb25zb2xlIG91dHB1dCBsaW5lcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIExpbmVzIGZvciBpbmxpbmUgb3V0cHV0LlxuICAgKi9cbiAgdHJ1bmNhdGVGYWlsZWRDb25zb2xlT3V0cHV0TGluZXMoY29uc29sZU91dHB1dCkge1xuICAgIGNvbnN0IGxpbmVzID0gY29uc29sZU91dHB1dC5zcGxpdChcIlxcblwiKVxuICAgIGNvbnN0IG1heExpbmVzID0gdGhpcy5nZXRGYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMoKVxuXG4gICAgaWYgKG1heExpbmVzID09PSAwKSByZXR1cm4gW11cbiAgICBpZiAobGluZXMubGVuZ3RoIDw9IG1heExpbmVzKSByZXR1cm4gbGluZXNcblxuICAgIGNvbnN0IG9taXR0ZWRMaW5lcyA9IGxpbmVzLmxlbmd0aCAtIG1heExpbmVzXG4gICAgY29uc3QgcGx1cmFsID0gb21pdHRlZExpbmVzID09PSAxID8gXCJcIiA6IFwic1wiXG5cbiAgICByZXR1cm4gW1xuICAgICAgYC4uLiAke29taXR0ZWRMaW5lc30gY29uc29sZSBvdXRwdXQgbGluZSR7cGx1cmFsfSBvbWl0dGVkIC4uLmAsXG4gICAgICAuLi5saW5lcy5zbGljZSgtbWF4TGluZXMpXG4gICAgXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbnQgZmFpbGVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb25zb2xlT3V0cHV0IC0gQ29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxlZnRQYWRkaW5nIC0gTGVmdCBwYWRkaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwcmludEZhaWxlZENvbnNvbGVPdXRwdXQoe2NvbnNvbGVPdXRwdXQsIGxlZnRQYWRkaW5nfSkge1xuICAgIGlmICh0ZXN0Q29uZmlnLmNvbnNvbGVPdXRwdXQgIT09IFwiZmFpbHVyZVwiKSByZXR1cm5cbiAgICBpZiAoIWNvbnNvbGVPdXRwdXQpIHJldHVyblxuXG4gICAgY29uc3QgbGluZXMgPSB0aGlzLnRydW5jYXRlRmFpbGVkQ29uc29sZU91dHB1dExpbmVzKGNvbnNvbGVPdXRwdXQpXG5cbiAgICBpZiAobGluZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICBDb25zb2xlIG91dHB1dDpgKSlcblxuICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gICAgJHtsaW5lfWApKVxuICAgIH1cbiAgfVxuXG59XG4iXX0=