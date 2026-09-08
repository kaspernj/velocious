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
const testingPackageDirectory = path.dirname(fileURLToPath(import.meta.resolve("@velocious/testing/package.json")));
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
        /** @type {import("@velocious/testing/runner").NonRunTestResult[]} */
        this._notRunTestDetails = [];
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
     * Counts selected tests blocked by a terminal resource.
     * @returns {number} - Selected tests not executed because a shared resource failed.
     */
    getNotRunTests() { return this._notRunTestDetails.length; }
    /**
     * Returns runtime non-run attribution.
     * @returns {import("@velocious/testing/runner").NonRunTestResult[]} - Runtime non-run details with the originating failure.
     */
    getNotRunTestDetails() { return this._notRunTestDetails; }
    /**
     * Records a selected test that did not execute.
     * @param {import("@velocious/testing/runner").NonRunTestResult} result - Terminal-resource non-run record.
     * @returns {void}
     */
    recordNotRunTest(result) { this._notRunTestDetails.push(result); }
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
        return this._packageResult?.tests.length ?? this._testDurations.length;
    }
    /**
     * Distinguishes an empty selection from a failure before selected cases execute.
     * @returns {boolean} - Whether selection matched no declarations.
     */
    hasNoMatches() {
        return this._packageResult?.noMatches === true;
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
        this._notRunTestDetails = [];
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
            if (resolvedFilePath.startsWith(`${testingPackageDirectory}${path.sep}`))
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
     * Gets the raw ancestor setup failure outcome for a package test.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {{failed: false} | {failed: true, error: ReturnType<typeof JSON.parse>}} - Raw setup failure outcome.
     */
    setupFailureOutcomeFor(test) {
        const suites = this.testMetadata(test).suites;
        const failure = this._suiteHookFailures.find((entry) => entry.phase === "beforeAll" && suites.includes(entry.suite));
        return failure ? { failed: true, error: failure.error } : { failed: false };
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
     * Normalizes retry inputs for the package execution boundary while retaining
     * the declarations' original public options after the run.
     * @returns {() => void} - Restores original declaration options.
     */
    normalizePackageRetriesForExecution() {
        /** @type {PackageRetryOptionRestoration[]} */
        const restorations = [];
        /**
         * Normalizes declarations in one suite.
         * @param {PackageSuiteDeclaration} suite - Suite whose tests are normalized.
         */
        const visit = (suite) => {
            for (const test of suite.tests) {
                // Capture compatibility arguments before temporarily adapting package
                // execution options so callbacks retain their declared values/identity.
                this.testData(test);
                restorations.push({
                    hadRetries: Object.hasOwn(test.options, "retries"),
                    options: test.options,
                    retries: test.options.retries
                });
                test.options.retries = this.retryCount(test);
            }
            for (const childSuite of suite.suites)
                visit(childSuite);
        };
        for (const suite of this.getTestContext().registry.suites)
            visit(suite);
        return () => {
            for (const restoration of restorations) {
                if (restoration.hadRetries)
                    restoration.options.retries = restoration.retries;
                else
                    delete restoration.options.retries;
            }
        };
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
        const restoreRetryOptions = this.normalizePackageRetriesForExecution();
        let result;
        try {
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
        finally {
            restoreRetryOptions();
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sRUFBQyxpQkFBaUIsRUFBRSxrQkFBa0IsRUFBQyxNQUFNLG9CQUFvQixDQUFBO0FBQ3hFLE9BQU8sRUFBQyxVQUFVLElBQUksaUJBQWlCLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RSxPQUFPLFdBQVcsTUFBTSwwQkFBMEIsQ0FBQTtBQUNsRCxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFDLFVBQVUsRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUNwQyxPQUFPLEVBQUMsYUFBYSxFQUFFLGFBQWEsRUFBQyxNQUFNLEtBQUssQ0FBQTtBQUNoRCxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3BGLE9BQU8sd0JBQXdCLE1BQU0saUNBQWlDLENBQUE7QUFDdEUsT0FBTyx1QkFBdUIsRUFBRSxFQUFDLHdCQUF3QixFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFDaEcsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLHNCQUFzQixNQUFNLCtCQUErQixDQUFBO0FBRWxFLDhEQUE4RDtBQUM5RCw2RkFBNkY7QUFDN0YsaUZBQWlGO0FBQ2pGLDhGQUE4RjtBQUM5RiwrR0FBK0c7QUFDL0csOElBQThJO0FB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QUFJLFFBQVE7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUUxQyxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQTtRQUM1QyxNQUFNLE1BQU0sR0FBRyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQTtRQUU1QyxPQUFPO1lBQ0wsT0FBTyxZQUFZLHVCQUF1QixNQUFNLGNBQWM7WUFDOUQsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDO1NBQzFCLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsd0JBQXdCLENBQUMsRUFBQyxhQUFhLEVBQUUsV0FBVyxFQUFDO1FBQ25ELElBQUksVUFBVSxDQUFDLGFBQWEsS0FBSyxTQUFTO1lBQUUsT0FBTTtRQUNsRCxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU07UUFFMUIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGdDQUFnQyxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRWxFLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUU5QixPQUFPLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsR0FBRyxXQUFXLG1CQUFtQixDQUFDLENBQUMsQ0FBQTtRQUVoRSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ3pCLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFdBQVcsT0FBTyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDNUQsQ0FBQztJQUNILENBQUM7Q0FFRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHtBc3luY0xvY2FsU3RvcmFnZX0gZnJvbSBcIm5vZGU6YXN5bmNfaG9va3NcIlxuaW1wb3J0IHtjcmVhdGVUZXN0Q29udGV4dCwgZGVmYXVsdFRlc3RDb250ZXh0fSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nXCJcbmltcG9ydCB7VGVzdFJ1bm5lciBhcyBQYWNrYWdlVGVzdFJ1bm5lcn0gZnJvbSBcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIlxuaW1wb3J0IEFwcGxpY2F0aW9uIGZyb20gXCIuLi8uLi9zcmMvYXBwbGljYXRpb24uanNcIlxuaW1wb3J0IFJlcXVlc3RDbGllbnQgZnJvbSBcIi4vcmVxdWVzdC1jbGllbnQuanNcIlxuaW1wb3J0IHBpY29jb2xvcnMgZnJvbSBcInBpY29jb2xvcnNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQge3Rlc3RDb25maWd9IGZyb20gXCIuL3Rlc3QuanNcIlxuaW1wb3J0IHtmaWxlVVJMVG9QYXRoLCBwYXRoVG9GaWxlVVJMfSBmcm9tIFwidXJsXCJcbmltcG9ydCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlciBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tYnJva2VyLmpzXCJcbmltcG9ydCB7IFNIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WIH0gZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzQXR0ZW1wdEV4ZWN1dG9yIGZyb20gXCIuL3ZlbG9jaW91cy1hdHRlbXB0LWV4ZWN1dG9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlciwge0Fib3J0UmVtYWluaW5nVGVzdHNFcnJvcn0gZnJvbSBcIi4vdmVsb2Npb3VzLXJ1bm5lci1yZXBvcnRlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzU3VpdGVIb29rRXhlY3V0b3IgZnJvbSBcIi4vdmVsb2Npb3VzLXN1aXRlLWhvb2stZXhlY3V0b3IuanNcIlxuaW1wb3J0IFZlbG9jaW91c1Rlc3RBcmd1bWVudHMgZnJvbSBcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCJcblxuLyoqIEB0eXBlZGVmIHt0eXBlb2YgZGVmYXVsdFRlc3RDb250ZXh0fSBQYWNrYWdlVGVzdENvbnRleHQgKi9cbi8qKiBAdHlwZWRlZiB7KHR5cGVvZiBkZWZhdWx0VGVzdENvbnRleHQucmVnaXN0cnkuc3VpdGVzKVtudW1iZXJdfSBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltcInRlc3RzXCJdW251bWJlcl19IFBhY2thZ2VUZXN0RGVjbGFyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXCJob29rc1wiXVtcImJlZm9yZUFsbFwiXVtudW1iZXJdfSBQYWNrYWdlSG9va0RlY2xhcmF0aW9uICovXG4vKiogQHR5cGVkZWYge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uIHwgUGFja2FnZVRlc3REZWNsYXJhdGlvbiB8IFBhY2thZ2VIb29rRGVjbGFyYXRpb259IFBhY2thZ2VSZWdpc3RyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7e2hhZFJldHJpZXM6IGJvb2xlYW4sIG9wdGlvbnM6IFBhY2thZ2VUZXN0RGVjbGFyYXRpb25bXCJvcHRpb25zXCJdLCByZXRyaWVzOiBudW1iZXIgfCB1bmRlZmluZWR9fSBQYWNrYWdlUmV0cnlPcHRpb25SZXN0b3JhdGlvbiAqL1xuXG4vKipcbiAqIEF0dGVtcHRDb25zb2xlT3V0cHV0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBdHRlbXB0Q29uc29sZU91dHB1dFxuICogQHByb3BlcnR5IHtudW1iZXJ9IGF0dGVtcHROdW1iZXIgLSBBdHRlbXB0IG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBvdXRwdXQgLSBDYXB0dXJlZCBjb25zb2xlIG91dHB1dC5cbiAqL1xuLyoqXG4gKiBUZXN0QXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdEFyZ3NcbiAqIEBwcm9wZXJ0eSB7QXBwbGljYXRpb259IFthcHBsaWNhdGlvbl0gLSBBcHBsaWNhdGlvbiBpbnN0YW5jZSBmb3IgaW50ZWdyYXRpb24gdGVzdHMuXG4gKiBAcHJvcGVydHkge1JlcXVlc3RDbGllbnR9IFtjbGllbnRdIC0gSFRUUCBjbGllbnQgZm9yIHJlcXVlc3QgdGVzdHMuXG4gKiBAcHJvcGVydHkge29iamVjdH0gW2RhdGFiYXNlQ2xlYW5pbmddIC0gRGF0YWJhc2UgY2xlYW51cCBvcHRpb25zIGZvciB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJhbnNhY3Rpb25dIC0gVXNlIHRyYW5zYWN0aW9ucyB0byByb2xsYmFjayBiZXR3ZWVuIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cnVuY2F0ZV0gLSBUcnVuY2F0ZSB0YWJsZXMgYmV0d2VlbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJ1bmNhdGVCZWZvcmVdIC0gVHJ1bmNhdGUgdGFibGVzIGJlZm9yZSBlYWNoIHRlc3QsIGluIGFkZGl0aW9uIHRvIHRoZSBkZWZhdWx0IGNsZWFudXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtmb2N1c10gLSBXaGV0aGVyIHRoaXMgdGVzdCBpcyBmb2N1c2VkLlxuICogQHByb3BlcnR5IHsoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gW2Z1bmN0aW9uXSAtIFRlc3QgY2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3JldHJ5XSAtIE51bWJlciBvZiByZXRyaWVzIHdoZW4gYSB0ZXN0IGZhaWxzLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXSB8IHN0cmluZ30gW3RhZ3NdIC0gVGFncyBmb3IgZmlsdGVyaW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0U2Vjb25kc10gLSBUaW1lb3V0IGluIHNlY29uZHMgZm9yIHRoZSB0ZXN0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0eXBlXSAtIFRlc3QgdHlwZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHsoYXJnczoge2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ6IG9iamVjdH0pID0+IFByb21pc2U8dm9pZD59IFtyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnRdIC0gUmVnaXN0ZXJzIG9uZSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgdHJhbnNhY3Rpb24gZm9yIHRoaXMgYXR0ZW1wdC5cbiAqL1xuLyoqXG4gKiBCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIEF0dGVtcHQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBDb25maWd1cmVkIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtxdWFyYW50aW5lUHJvbWlzZV0gLSBTaGFyZWQgY29ubmVjdGlvbi1kaXNjYXJkIHByb21pc2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHF1YXJhbnRpbmVkIC0gV2hldGhlciB0aGUgY29ubmVjdGlvbiBpcyB1bnNhZmUgdG8gcmV1c2UuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtyb2xsYmFja1Byb21pc2VdIC0gU2hhcmVkIHJvbGxiYWNrIHByb21pc2UuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtzdGFydFByb21pc2VdIC0gVHJhbnNhY3Rpb24gc3RhcnR1cCBwcm9taXNlIHdoZW4gdHJhbnNhY3Rpb24gY2xlYW5pbmcgaXMgZW5hYmxlZC5cbiAqL1xuLyoqXG4gKiBUZXN0RGF0YSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdERhdGFcbiAqIEBwcm9wZXJ0eSB7VGVzdEFyZ3N9IGFyZ3MgLSBBcmd1bWVudHMgcGFzc2VkIHRvIHRoZSB0ZXN0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKiBAcHJvcGVydHkgeyhhcmc6IFRlc3RBcmdzKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gZnVuY3Rpb24gLSBUZXN0IGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IFtkZWNsYXJhdGlvbl0gLSBQYWNrYWdlIGRlY2xhcmF0aW9uLlxuICovXG4vKipcbiAqIEZhaWxlZFRlc3REZXRhaWwgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZhaWxlZFRlc3REZXRhaWxcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmdWxsRGVzY3JpcHRpb24gLSBGdWxsIHRlc3QgZGVzY3JpcHRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlT3V0cHV0XSAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0IHdoaWxlIHRlc3QgcmFuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlTG9nUGF0aF0gLSBTYXZlZCBjb25zb2xlIGxvZyBwYXRoLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCB0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0pID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBBZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gSG9vayBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIEhvb2sgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGluZGV4IHdpdGhpbiBpdHMgZGVjbGFyYXRpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RlY2xhcmF0aW9uU2NvcGVJZF0gLSBPcGFxdWUgcHJvZmlsZSBzY29wZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqL1xuLyoqXG4gKiBUZXN0c0FyZ3VtZW50IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0c0FyZ3VtZW50XG4gKiBAcHJvcGVydHkge1Rlc3RBcmdzfSBhcmdzIC0gQXJndW1lbnRzIGluaGVyaXRlZCBieSB0ZXN0cyBpbiB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbYW55VGVzdHNGb2N1c3NlZF0gLSBXaGV0aGVyIGFueSB0ZXN0cyBpbiB0aGUgdHJlZSBhcmUgZm9jdXNlZC5cbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGFmdGVyRWFjaGVzIC0gQWZ0ZXItZWFjaCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVbXX0gYWZ0ZXJBbGxzIC0gQWZ0ZXItYWxsIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBiZWZvcmVBbGxzIC0gQmVmb3JlLWFsbCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGJlZm9yZUVhY2hlcyAtIEJlZm9yZS1lYWNoIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFRlc3REYXRhPn0gdGVzdHMgLSBBIHVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgbm9kZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgVGVzdHNBcmd1bWVudD59IHN1YnMgLSBPcHRpb25hbCBjaGlsZCBub2Rlcy4gRWFjaCBpdGVtIGlzIGFub3RoZXIgYE5vZGVgLCBhbGxvd2luZyByZWN1cnNpb24uXG4gKi9cbi8qKlxuICogTWFya3MgdGhlIGVycm9yIHRocm93biBieSB0aGUgYXR0ZW1wdCB0aW1lb3V0IHNvIHRoZSBydW5uZXIgY2FuIGRpc3Rpbmd1aXNoXG4gKiBkZXRhY2hlZCBsaWZlY3ljbGUgY2xlYW51cCBmcm9tIGFuIG9yZGluYXJ5IHRlc3QgZmFpbHVyZS5cbiAqIEB0eXBlZGVmIHtFcnJvciAmIHt2ZWxvY2lvdXNUZXN0VGltZW91dD86IHRydWV9fSBUZXN0VGltZW91dEVycm9yXG4gKi9cbi8qKlxuICogU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyfSBicm9rZXIgLSBBdHRlbXB0IGJyb2tlciBhbmQgY29ubmVjdGlvbiBjb29yZGluYXRvci5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gZW52aXJvbm1lbnRQdWJsaXNoZWQgLSBXaGV0aGVyIGNoaWxkLXByb2Nlc3MgY29vcmRpbmF0ZXMgd2VyZSBwdWJsaXNoZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gcHJldmlvdXNFbnZpcm9ubWVudCAtIEVudmlyb25tZW50IHZhbHVlIHRvIHJlc3RvcmUgYWZ0ZXIgcHVibGljYXRpb24uXG4gKi9cbi8qKlxuICogVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtQcm9taXNlPHtjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgZXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkfT4gfCB1bmRlZmluZWR9IFtjaGVja291dFByb21pc2VdIC0gQXR0ZW1wdC1vd25lZCBwaHlzaWNhbCBjaGVja291dCBvdXRjb21lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29ubmVjdGlvbiAtIEF0dGVtcHQtb3duZWQgcGh5c2ljYWwgY29ubmVjdGlvbiBvbmNlIGNoZWNrb3V0IHJlc29sdmVzLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSBbY2xlYW51cFByb21pc2VdIC0gU2luZ2xlIGNsZWFudXAgb3BlcmF0aW9uIHNoYXJlZCBieSBlbWVyZ2VuY3kgYW5kIGV2ZW50dWFsIGxpZmVjeWNsZSBjbGVhbnVwLlxuICogQHByb3BlcnR5IHtib29sZWFuIHwgdW5kZWZpbmVkfSBbZGlzY2FyZE9uQ2xlYW51cF0gLSBXaGV0aGVyIHRpbWVvdXQgZW1lcmdlbmN5IGNsZWFudXAgbXVzdCBxdWFyYW50aW5lIHRoaXMgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IHBvb2wgLSBPd25pbmcgbG9naWNhbCBwb29sLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZXZva2VkIC0gV2hldGhlciB0aGlzIGF0dGVtcHQgbWF5IHN0aWxsIHB1Ymxpc2ggdGhlIHBoeXNpY2FsIHJlZ2lzdHJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXVzZUtleSAtIFJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24gaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gc2hhcmVkUmVnaXN0cmF0aW9uIC0gUGh5c2ljYWwta2V5IHNoYXJlZCByZWdpc3RyYXRpb24gb25jZSBwdWJsaXNoZWQuXG4gKi9cblxuY29uc3QgdGVzdGluZ1BhY2thZ2VEaXJlY3RvcnkgPSBwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS5yZXNvbHZlKFwiQHZlbG9jaW91cy90ZXN0aW5nL3BhY2thZ2UuanNvblwiKSkpXG5cbi8qKlxuICogUnVucyB0byBmaWxlIHNsdWcuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBWYWx1ZSB0byBzYW5pdGl6ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2x1Zy1zYWZlIHZhbHVlLlxuICovXG5mdW5jdGlvbiB0b0ZpbGVTbHVnKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnJlcGxhY2UoL1teYS16MC05XSsvZywgXCItXCIpXG4gICAgLnJlcGxhY2UoL14tK3wtKyQvZywgXCJcIilcbiAgICAuc2xpY2UoMCwgODApIHx8IFwiZmFpbGVkLXRlc3RcIlxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBUZXN0UnVubmVyIHtcbiAgLyoqIEB0eXBlIHtQYWNrYWdlVGVzdENvbnRleHR9ICovXG4gIF9jb250ZXh0XG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0ZhaWxlZFRlc3REZXRhaWxbXX0gKi9cbiAgX2ZhaWxlZFRlc3REZXRhaWxzXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0Q29udGV4dH0gW2FyZ3MuY29udGV4dF0gLSBEZWNsYXJhdGlvbiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nfSBbYXJncy5leGNsdWRlVGFnc10gLSBUYWdzIHRvIGV4Y2x1ZGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmd9IFthcmdzLmluY2x1ZGVUYWdzXSAtIFRhZ3MgdG8gaW5jbHVkZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBhcmdzLnRlc3RGaWxlcyAtIFRlc3QgZmlsZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgbnVtYmVyW10+fSBbYXJncy5saW5lRmlsdGVyc10gLSBMaW5lIGZpbHRlcnMgYnkgZmlsZS5cbiAgICogQHBhcmFtIHtSZWdFeHBbXX0gW2FyZ3MuZXhhbXBsZVBhdHRlcm5zXSAtIEV4YW1wbGUgcGF0dGVybnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXByb2ZpbGVyLmpzXCIpLmRlZmF1bHR9IFthcmdzLnByb2ZpbGVyXSAtIE9wdC1pbiBwcm9maWxlci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjb250ZXh0ID0gZGVmYXVsdFRlc3RDb250ZXh0LCBleGNsdWRlVGFncywgaW5jbHVkZVRhZ3MsIHRlc3RGaWxlcywgbGluZUZpbHRlcnMsIGV4YW1wbGVQYXR0ZXJucywgcHJvZmlsZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcImNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5fY29udGV4dCA9IGNvbnRleHRcbiAgICB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlKClcbiAgICB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2UoKVxuICAgIHRoaXMuX2V4Y2x1ZGVUYWdzID0gdGhpcy5ub3JtYWxpemVUYWdzKGV4Y2x1ZGVUYWdzKVxuICAgIHRoaXMuX2luY2x1ZGVUYWdzID0gdGhpcy5ub3JtYWxpemVUYWdzKGluY2x1ZGVUYWdzKVxuICAgIHRoaXMuX3Rlc3RGaWxlcyA9IHRlc3RGaWxlc1xuICAgIHRoaXMuX2xpbmVGaWx0ZXJzID0gbGluZUZpbHRlcnMgfHwge31cbiAgICB0aGlzLl9leGFtcGxlUGF0dGVybnMgPSBleGFtcGxlUGF0dGVybnMgfHwgW11cbiAgICB0aGlzLl9wcm9maWxlciA9IHByb2ZpbGVyXG4gICAgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IGZhbHNlXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9IDBcbiAgICB0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPSAwXG4gICAgdGhpcy5fdGVzdHNDb3VudCA9IDBcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscyA9IFtdXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLk5vblJ1blRlc3RSZXN1bHRbXX0gKi9cbiAgICB0aGlzLl9ub3RSdW5UZXN0RGV0YWlscyA9IFtdXG4gICAgLyoqIEB0eXBlIHt7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlcn0gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xhc3RUZXN0Q29udGV4dCA9IG51bGxcbiAgICAvKiogQHR5cGUge0FycmF5PHtmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyLCBkdXJhdGlvbk1zOiBudW1iZXJ9Pn0gKi9cbiAgICB0aGlzLl90ZXN0RHVyYXRpb25zID0gW11cbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZVRlc3REZWNsYXJhdGlvbiwge3Rlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfT59ICovXG4gICAgdGhpcy5fdGVzdENvbXBhdGliaWxpdHkgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrU2V0PFBhY2thZ2VUZXN0RGVjbGFyYXRpb24+fSAqL1xuICAgIHRoaXMuX2luamVjdGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrU2V0PFBhY2thZ2VUZXN0RGVjbGFyYXRpb24+fSAqL1xuICAgIHRoaXMuX2NvbXBsZXRlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uLCB7ZGVzY3JpcHRpb25zOiBzdHJpbmdbXSwgdGVzdERlc2NyaXB0aW9uOiBzdHJpbmcsIGZ1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsIHN1aXRlczogUGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXX0+fSAqL1xuICAgIHRoaXMuX3Rlc3RNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZUhvb2tEZWNsYXJhdGlvbiwge2RlY2xhcmF0aW9uSW5kZXg6IG51bWJlciwgZGVjbGFyYXRpb25TY29wZUlkOiBzdHJpbmcgfCB1bmRlZmluZWQsIG93bmVyRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZH0+fSAqL1xuICAgIHRoaXMuX2hvb2tNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZVRlc3REZWNsYXJhdGlvbiwgTWFwPG51bWJlciwge2Fib3J0UmVtYWluaW5nVGVzdHM6IGJvb2xlYW4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZmFpbGVkOiBib29sZWFufT4+fSAqL1xuICAgIHRoaXMuX2F0dGVtcHRPdXRjb21lcyA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge0FycmF5PHtzdWl0ZTogUGFja2FnZVN1aXRlRGVjbGFyYXRpb24sIHBoYXNlOiBcImJlZm9yZUFsbFwiIHwgXCJhZnRlckFsbFwiLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQYWNrYWdlVGVzdERlY2xhcmF0aW9uW10+fSAqL1xuICAgIHRoaXMuX3Rlc3RzQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlUmVnaXN0cmF0aW9uLCBzdHJpbmc+fSAqL1xuICAgIHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7UGFja2FnZVRlc3RSdW5uZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcGFja2FnZVJ1bm5lciA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0UnVuUmVzdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3BhY2thZ2VSZXN1bHQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFRlc3REYXRhPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWUgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge3tmaWxlUGF0aD86IHN0cmluZywgbGluZT86IG51bWJlcn19ICovXG4gICAgdGhpcy5fbGVnYWN5Rml4dHVyZUxvY2F0aW9uID0ge31cbiAgICB0aGlzLl9hdHRlbXB0RXhlY3V0b3IgPSBuZXcgVmVsb2Npb3VzQXR0ZW1wdEV4ZWN1dG9yKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgICB0aGlzLl9ydW5uZXJSZXBvcnRlciA9IG5ldyBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlcih7dGVzdFJ1bm5lcjogdGhpc30pXG4gICAgdGhpcy5fc3VpdGVIb29rRXhlY3V0b3IgPSBuZXcgVmVsb2Npb3VzU3VpdGVIb29rRXhlY3V0b3Ioe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICAgIHRoaXMuX3Rlc3RBcmd1bWVudHMgPSBuZXcgVmVsb2Npb3VzVGVzdEFyZ3VtZW50cyh7dGVzdFJ1bm5lcjogdGhpc30pXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgcGFja2FnZSBkZWNsYXJhdGlvbiBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UGFja2FnZVRlc3RDb250ZXh0fSAtIFBhY2thZ2UgZGVjbGFyYXRpb24gY29udGV4dC5cbiAgICovXG4gIGdldFRlc3RDb250ZXh0KCkgeyByZXR1cm4gdGhpcy5fY29udGV4dCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fY29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgdGVzdCBmaWxlcy5cbiAgICovXG4gIGdldFRlc3RGaWxlcygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RGaWxlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxpbmUgZmlsdGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gLSBMaW5lIGZpbHRlcnMuXG4gICAqL1xuICBnZXRMaW5lRmlsdGVycygpIHsgcmV0dXJuIHRoaXMuX2xpbmVGaWx0ZXJzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhhbXBsZSBwYXR0ZXJucy5cbiAgICogQHJldHVybnMge1JlZ0V4cFtdfSAtIEV4YW1wbGUgcGF0dGVybnMuXG4gICAqL1xuICBnZXRFeGFtcGxlUGF0dGVybnMoKSB7IHJldHVybiB0aGlzLl9leGFtcGxlUGF0dGVybnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcHJvZmlsZXIgc3BhbiBvbmx5IHdoZW4gcHJvZmlsaW5nIHdhcyBleHBsaWNpdGx5IGVuYWJsZWQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBtZXRhZGF0YSAtIFNwYW4gbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YS5waGFzZSAtIFBoYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbWV0YWRhdGEuZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGRlY2xhcmF0aW9uIGluZGV4LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW21ldGFkYXRhLmRlY2xhcmF0aW9uU2NvcGVJZF0gLSBIb29rIGRlY2xhcmF0aW9uIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW21ldGFkYXRhLmZpbGVQYXRoXSAtIFNvdXJjZSBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7KCkgPT4gKFQgfCBQcm9taXNlPFQ+KX0gY2FsbGJhY2sgLSBUaW1lZCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuUHJvZmlsZVNwYW4obWV0YWRhdGEsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9maWxlcikgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9wcm9maWxlci5ydW5TcGFuKG1ldGFkYXRhLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSB0YWdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nIHwgdW5kZWZpbmVkfSB0YWdzIC0gVGFncy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vcm1hbGl6ZWQgdGFncy5cbiAgICovXG4gIG5vcm1hbGl6ZVRhZ3ModGFncykge1xuICAgIGlmICghdGFncykgcmV0dXJuIFtdXG5cbiAgICBjb25zdCB2YWx1ZXMgPSBbXVxuICAgIGNvbnN0IHJhd1RhZ3MgPSBBcnJheS5pc0FycmF5KHRhZ3MpID8gdGFncyA6IFt0YWdzXVxuXG4gICAgZm9yIChjb25zdCByYXdUYWcgb2YgcmF3VGFncykge1xuICAgICAgaWYgKHJhd1RhZyA9PT0gdW5kZWZpbmVkIHx8IHJhd1RhZyA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY29uc3QgcGFydHMgPSBTdHJpbmcocmF3VGFnKS5zcGxpdChcIixcIilcblxuICAgICAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgICAgIGNvbnN0IHRyaW1tZWQgPSBwYXJ0LnRyaW0oKVxuXG4gICAgICAgIGlmICh0cmltbWVkKSB2YWx1ZXMucHVzaCh0cmltbWVkKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5mcm9tKG5ldyBTZXQodmFsdWVzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyB0YWcuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFnIC0gVGFnIHRvIGNoZWNrIGZvci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0YWcgaXMgcHJlc2VudC5cbiAgICovXG4gIGhhc1RhZyh0ZXN0QXJncywgdGFnKSB7XG4gICAgcmV0dXJuIHRoaXMubm9ybWFsaXplVGFncyh0ZXN0QXJncz8udGFncykuaW5jbHVkZXModGFnKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgYnJvd3NlciB0ZXN0IG1vZGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcnVubmluZyBicm93c2VyIHRlc3RzLlxuICAgKi9cbiAgaXNCcm93c2VyVGVzdE1vZGUoKSB7XG4gICAgcmV0dXJuIHByb2Nlc3MuZW52LlZFTE9DSU9VU19CUk9XU0VSX1RFU1RTID09PSBcInRydWVcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggZHVtbXkgaWYgbmVlZGVkLlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IFticm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uc10gLSBBdHRlbXB0LW93bmVkIGJyb3dzZXIgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5XaXRoRHVtbXlJZk5lZWRlZCh0ZXN0QXJncywgY2FsbGJhY2ssIGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW10pIHtcbiAgICBpZiAoIXRoaXMuaGFzVGFnKHRlc3RBcmdzLCBcImR1bW15XCIpKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc0Jyb3dzZXJUZXN0TW9kZSgpKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJyb3dzZXJEdW1teSh0ZXN0QXJncywgY2FsbGJhY2ssIGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW5Ob2RlRHVtbXkoY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gbm9kZSBkdW1teS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bk5vZGVEdW1teShjYWxsYmFjaykge1xuICAgIGNvbnN0IGR1bW15UGF0aCA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19EVU1NWV9QQVRIIHx8IHRoaXMuZGVmYXVsdER1bW15UGF0aCgpXG4gICAgY29uc3QgZHVtbXlJbXBvcnQgPSBhd2FpdCBpbXBvcnQocGF0aFRvRmlsZVVSTChkdW1teVBhdGgpLmhyZWYpXG4gICAgY29uc3QgRHVtbXkgPSBkdW1teUltcG9ydC5kZWZhdWx0XG5cbiAgICBpZiAoIUR1bW15Py5ydW4pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRHVtbXkgaGVscGVyIG5vdCBmb3VuZCBhdCAke2R1bW15UGF0aH1gKVxuICAgIH1cblxuICAgIC8vIFBlcnNpc3RlbnQgc2VydmVyIHJlc291cmNlcyBtdXN0IG5vdCBpbmhlcml0IGFuIGF0dGVtcHQgc2NvcGUgdGhhdCB3aWxsIGJlIHJldm9rZWQuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aENhcHR1cmVkVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUodW5kZWZpbmVkLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBEdW1teS5ydW4oYXN5bmMgKCkgPT4ge30pXG4gICAgfSlcbiAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmF1bHQgZHVtbXkgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZWZhdWx0IGR1bW15IGhlbHBlciBwYXRoLlxuICAgKi9cbiAgZGVmYXVsdER1bW15UGF0aCgpIHtcbiAgICBjb25zdCBjd2QgPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSlcbiAgICBjb25zdCBub3JtYWxpemVkID0gY3dkLnNwbGl0KHBhdGguc2VwKS5qb2luKFwiL1wiKVxuXG4gICAgaWYgKG5vcm1hbGl6ZWQuZW5kc1dpdGgoXCIvc3BlYy9kdW1teVwiKSkge1xuICAgICAgcmV0dXJuIHBhdGguam9pbihjd2QsIFwiaW5kZXguanNcIilcbiAgICB9XG5cbiAgICByZXR1cm4gcGF0aC5qb2luKGN3ZCwgXCJzcGVjL2R1bW15L2luZGV4LmpzXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gYnJvd3NlciBkdW1teS5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSBjb25uZWN0aW9uUmVnaXN0cmF0aW9ucyAtIEF0dGVtcHQtb3duZWQgYnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bkJyb3dzZXJEdW1teSh0ZXN0QXJncywgY2FsbGJhY2ssIGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKSB7XG4gICAgY29uc3QgdXNlVHJhbnNhY3Rpb24gPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cmFuc2FjdGlvbiA9PT0gdHJ1ZVxuICAgIGNvbnN0IHRydW5jYXRlID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJ1bmNhdGVcbiAgICBjb25zdCBzaG91bGRUcnVuY2F0ZSA9IHRydW5jYXRlID09PSB1bmRlZmluZWQgPyAhdXNlVHJhbnNhY3Rpb24gOiB0cnVuY2F0ZVxuXG4gICAgaWYgKCF1c2VUcmFuc2FjdGlvbiAmJiAhc2hvdWxkVHJ1bmNhdGUpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIlRlc3QgcnVubmVyIGJyb3dzZXIgZHVtbXlcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IG5ld1JlZ2lzdHJhdGlvbnMgPSBPYmplY3QuZW50cmllcyhkYnMpLm1hcCgoW2RhdGFiYXNlSWRlbnRpZmllciwgZGJdKSA9PiB7XG4gICAgICAgIC8qKiBAdHlwZSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gKi9cbiAgICAgICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge1xuICAgICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgICBkYixcbiAgICAgICAgICBxdWFyYW50aW5lZDogZmFsc2VcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zLnB1c2gocmVnaXN0cmF0aW9uKVxuXG4gICAgICAgIHJldHVybiByZWdpc3RyYXRpb25cbiAgICAgIH0pXG5cbiAgICAgIGlmIChzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICBhd2FpdCB0aGlzLnRydW5jYXRlRGF0YWJhc2VzKGRicylcbiAgICAgIH1cbiAgICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgICAgY29uc3QgbGlmZWN5Y2xlRXJyb3JzID0gW11cblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHVzZVRyYW5zYWN0aW9uKSB7XG4gICAgICAgICAgY29uc3Qgc3RhcnRQcm9taXNlcyA9IG5ld1JlZ2lzdHJhdGlvbnMubWFwKChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0UHJvbWlzZSA9IHJlZ2lzdHJhdGlvbi5kYi5zdGFydFRyYW5zYWN0aW9uKClcblxuICAgICAgICAgICAgcmVnaXN0cmF0aW9uLnN0YXJ0UHJvbWlzZSA9IHN0YXJ0UHJvbWlzZVxuICAgICAgICAgICAgcmV0dXJuIHN0YXJ0UHJvbWlzZVxuICAgICAgICAgIH0pXG4gICAgICAgICAgY29uc3Qgc3RhcnRSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHN0YXJ0UHJvbWlzZXMpXG4gICAgICAgICAgY29uc3Qgc3RhcnRFcnJvcnMgPSBzdGFydFJlc3VsdHNcbiAgICAgICAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgICAgICAgaWYgKHN0YXJ0RXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBzdGFydEVycm9yc1swXVxuICAgICAgICAgIGlmIChzdGFydEVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3Ioc3RhcnRFcnJvcnMsIFwiQnJvd3NlciBkdW1teSB0cmFuc2FjdGlvbiBzdGFydHVwIGZhaWxlZFwiLCB7Y2F1c2U6IHN0YXJ0RXJyb3JzWzBdfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja0Jyb3dzZXJEdW1teVRyYW5zYWN0aW9ucyhjb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEFnZ3JlZ2F0ZUVycm9yKSB7XG4gICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goLi4uZXJyb3IuZXJyb3JzKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgICAgYXdhaXQgdGhpcy50cnVuY2F0ZURhdGFiYXNlcyhkYnMpXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBsaWZlY3ljbGVFcnJvcnNbMF1cbiAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID4gMSkge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IobGlmZWN5Y2xlRXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgbGlmZWN5Y2xlIGFuZCBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGxpZmVjeWNsZUVycm9yc1swXX0pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSb2xscyBiYWNrIGV2ZXJ5IGF0dGVtcHQtb3duZWQgYnJvd3NlciB0cmFuc2FjdGlvbiBleGFjdGx5IG9uY2UuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIHJvbGxiYWNrcyBzZXR0bGUuXG4gICAqL1xuICBhc3luYyByb2xsYmFja0Jyb3dzZXJEdW1teVRyYW5zYWN0aW9ucyhyZWdpc3RyYXRpb25zKSB7XG4gICAgY29uc3Qgcm9sbGJhY2tSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5yZWdpc3RyYXRpb25zXS5yZXZlcnNlKCkubWFwKChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHN0YXJ0UHJvbWlzZSA9IHJlZ2lzdHJhdGlvbi5zdGFydFByb21pc2VcblxuICAgICAgaWYgKCFzdGFydFByb21pc2UpIHJldHVyblxuXG4gICAgICByZWdpc3RyYXRpb24ucm9sbGJhY2tQcm9taXNlID8/PSAoYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAocmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkKSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHN0YXJ0UHJvbWlzZVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICAgICAgfSBjYXRjaCAocXVhcmFudGluZUVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBxdWFyYW50aW5lIGJyb3dzZXIgZHVtbXkgZGF0YWJhc2UgYWZ0ZXIgdHJhbnNhY3Rpb24gc3RhcnR1cCBmYWlsZWQ6ICR7cmVnaXN0cmF0aW9uLmRhdGFiYXNlSWRlbnRpZmllcn1gLCB7Y2F1c2U6IHF1YXJhbnRpbmVFcnJvcn0pXG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24ucXVhcmFudGluZWQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLmRiLnJvbGxiYWNrVHJhbnNhY3Rpb24oKVxuICAgICAgICB9IGNhdGNoIChyb2xsYmFja0Vycm9yKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgICAgICAgIH0gY2F0Y2ggKHF1YXJhbnRpbmVFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgICBbcm9sbGJhY2tFcnJvciwgcXVhcmFudGluZUVycm9yXSxcbiAgICAgICAgICAgICAgYEZhaWxlZCB0byByb2xsIGJhY2sgYW5kIHF1YXJhbnRpbmUgYnJvd3NlciBkdW1teSBkYXRhYmFzZTogJHtyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyfWAsXG4gICAgICAgICAgICAgIHtjYXVzZTogcXVhcmFudGluZUVycm9yfVxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyByb2xsYmFja0Vycm9yXG4gICAgICAgIH1cbiAgICAgIH0pKClcblxuICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvbi5yb2xsYmFja1Byb21pc2VcbiAgICB9KSlcbiAgICBjb25zdCBlcnJvcnMgPSByb2xsYmFja1Jlc3VsdHNcbiAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgdHJhbnNhY3Rpb24gY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcm1hbmVudGx5IHJlbW92ZXMgb25lIGJyb3dzZXIgY29ubmVjdGlvbiB0aGF0IGNhbm5vdCBiZSBzaGFyZWQgc2FmZWx5LlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb259IHJlZ2lzdHJhdGlvbiAtIEJyb3dzZXIgY29ubmVjdGlvbiByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBjb25uZWN0aW9uIGlzIGRpc2NhcmRlZC5cbiAgICovXG4gIGFzeW5jIHF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbikge1xuICAgIHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCA9IHRydWVcbiAgICByZWdpc3RyYXRpb24ucXVhcmFudGluZVByb21pc2UgPz89IHRoaXMuZGlzY2FyZEJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uLmRhdGFiYXNlSWRlbnRpZmllciwgcmVnaXN0cmF0aW9uLmRiKVxuICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIERpc2NhcmRzIG9uZSBicm93c2VyIGR1bW15IGNvbm5lY3Rpb24gdGhyb3VnaCBpdHMgb3duaW5nIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBDb25maWd1cmVkIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVW5zYWZlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGRpc2NhcmQuXG4gICAqL1xuICBhc3luYyBkaXNjYXJkQnJvd3NlckR1bW15Q29ubmVjdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIGRiKSB7XG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcikuZGlzY2FyZChkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWFyYW50aW5lcyBhbGwgYnJvd3NlciBjb25uZWN0aW9ucyBjb25jdXJyZW50bHkuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQnJvd3NlciBjb25uZWN0aW9uIHJlZ2lzdHJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGNvbm5lY3Rpb24gaXMgZGlzY2FyZGVkLlxuICAgKi9cbiAgYXN5bmMgcXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCBxdWFyYW50aW5lUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChyZWdpc3RyYXRpb25zLm1hcChhc3luYyAocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICB9KSlcbiAgICBjb25zdCBlcnJvcnMgPSBxdWFyYW50aW5lUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiQnJvd3NlciBkdW1teSBjb25uZWN0aW9uIHF1YXJhbnRpbmUgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3JzWzBdfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRydW5jYXRlIGRhdGFiYXNlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGRicyAtIERhdGFiYXNlIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVEYXRhYmFzZXMoZGJzKSB7XG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKGRicykpIHtcbiAgICAgIGF3YWl0IGRic1tpZGVudGlmaWVyXS50cnVuY2F0ZUFsbFRhYmxlcygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4Y2x1ZGUgdGFnIHNldC5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIEV4Y2x1ZGUgdGFnIHNldC5cbiAgICovXG4gIGdldEV4Y2x1ZGVUYWdTZXQoKSB7XG4gICAgLyoqXG4gICAgICogQ29uZmlnIHRhZ3MuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGNvbmZpZ1RhZ3MgPSBBcnJheS5pc0FycmF5KHRlc3RDb25maWcuZXhjbHVkZVRhZ3MpID8gdGVzdENvbmZpZy5leGNsdWRlVGFncyA6IFtdXG5cbiAgICByZXR1cm4gbmV3IFNldChbLi4udGhpcy5fZXhjbHVkZVRhZ3MsIC4uLmNvbmZpZ1RhZ3NdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgZnVsbCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZ1bGwgZGVzY3JpcHRpb24uXG4gICAqL1xuICBidWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbikge1xuICAgIGNvbnN0IHBhcnRzID0gZGVzY3JpcHRpb25zLmNvbmNhdChbdGVzdERlc2NyaXB0aW9uXSlcblxuICAgIHJldHVybiBwYXJ0cy5qb2luKFwiIFwiKS50cmltKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGxpY2F0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcHBsaWNhdGlvbj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXBwbGljYXRpb24uXG4gICAqL1xuICBhc3luYyBhcHBsaWNhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuX2FwcGxpY2F0aW9uKSB7XG4gICAgICB0aGlzLl9hcHBsaWNhdGlvbiA9IG5ldyBBcHBsaWNhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICAvLyBSdW4gcmVxdWVzdCBoYW5kbGVycyBpbiB0aGUgbWFpbiB0aHJlYWQgKG5vdCB3b3JrZXIgdGhyZWFkcykgc28gdGhleVxuICAgICAgICAvLyByZXNvbHZlIERCIHdvcmsgdG8gdGhlIHBlci10ZXN0IHNoYXJlZCBjb25uZWN0aW9uIHNldCBieVxuICAgICAgICAvLyB7QGxpbmsgYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnN9LiBUaGlzIGxldHMgcmVxdWVzdC10eXBlIHNwZWNzIHVzZVxuICAgICAgICAvLyB0cmFuc2FjdGlvbi1iYXNlZCBjbGVhbmluZyAodGhlaXIgd3JpdGVzIGxhbmQgaW5zaWRlIHRoZSB0ZXN0J3NcbiAgICAgICAgLy8gdHJhbnNhY3Rpb24gYW5kIHJvbGwgYmFjaykgaW5zdGVhZCBvZiB0cnVuY2F0aW5nIGV2ZXJ5IHRhYmxlLlxuICAgICAgICBodHRwU2VydmVyOiB7aW5Qcm9jZXNzOiB0cnVlLCBwb3J0OiAzMTAwNn0sXG4gICAgICAgIHR5cGU6IFwidGVzdC1ydW5uZXJcIlxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGhpcy5fYXBwbGljYXRpb24uaW5pdGlhbGl6ZSgpXG4gICAgICBhd2FpdCB0aGlzLl9hcHBsaWNhdGlvbi5zdGFydEh0dHBTZXJ2ZXIoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hcHBsaWNhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBlYWNoIG5vbi10ZW5hbnQgcGVyLXRlc3QgY29ubmVjdGlvbiBhcyBhIGR5bmFtaWMgY2FuZGlkYXRlIGZvciBpbi1wcm9jZXNzXG4gICAqIHJlcXVlc3Qgc2hhcmluZy4gVGhlIHBvb2wgZXZhbHVhdGVzIHRyYW5zYWN0aW9uIHN0YXRlIHdoZW4gZWFjaCByZXF1ZXN0IGlzIGRpc3BhdGNoZWQsXG4gICAqIHNvIGEgdHJhbnNhY3Rpb24gc3RhcnRlZCBvciBlbmRlZCBkdXJpbmcgYSBob29rIGNhbGxiYWNrIHRha2VzIGVmZmVjdCBpbW1lZGlhdGVseS5cbiAgICogSW5hY3RpdmUgYW5kIHRlbmFudC1vbmx5IGNvbm5lY3Rpb25zIHJlbWFpbiBpbmRlcGVuZGVudGx5IHBvb2xlZC4gUGFpciB3aXRoXG4gICAqIHtAbGluayBjbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uc30gaW4gYSBmaW5hbGx5LlxuICAgKiBAcmV0dXJucyB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gLSBMaWZlY3ljbGUtb3duZWQgcmVnaXN0cmF0aW9ucy5cbiAgICovXG4gIGFjdGl2YXRlVGVzdFNoYXJlZENvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9ucyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICAvKiogQHR5cGUge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119ICovXG4gICAgY29uc3QgcmVnaXN0cmF0aW9ucyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoY3VycmVudENvbm5lY3Rpb25zKSkge1xuICAgICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIC8vIFRlbmFudC1zY29wZWQgcG9vbHMgcmVzb2x2ZSBhIGRpZmZlcmVudCBjb25uZWN0aW9uIHBlciByZXF1ZXN0IHRlbmFudFxuICAgICAgLy8gKHZpYSBydW5XaXRoVGVuYW50KSwgc28gZm9yY2luZyBhIHNpbmdsZSBzaGFyZWQgY29ubmVjdGlvbiB3b3VsZCBicmVha1xuICAgICAgLy8gcGVyLXJlcXVlc3QgdGVuYW50IHJlc29sdXRpb24uIE9ubHkgc2hhcmUgbm9uLXRlbmFudCBwb29sczsgdGhlIHRlbmFudFxuICAgICAgLy8gcG9vbCBrZWVwcyByZXNvbHZpbmcgaXRzIG93biBjb25uZWN0aW9uIHBlciByZXF1ZXN0LlxuICAgICAgaWYgKHBvb2wuZ2V0Q29uZmlndXJhdGlvbigpLnRlbmFudE9ubHkpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGN1cnJlbnRDb25uZWN0aW9uc1tpZGVudGlmaWVyXVxuXG4gICAgICBjb25zdCByZWdpc3RyYXRpb24gPSBwb29sLnNldFRlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIoKCkgPT4ge1xuICAgICAgICByZXR1cm4gY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpID8gY29ubmVjdGlvbiA6IHVuZGVmaW5lZFxuICAgICAgfSlcblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbikgcmVnaXN0cmF0aW9ucy5wdXNoKHtwb29sLCByZWdpc3RyYXRpb259KVxuICAgIH1cblxuICAgIHJldHVybiByZWdpc3RyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBpbi1wcm9jZXNzIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gb24gZXZlcnkgY29uZmlndXJlZCBwb29sLiBJZGVtcG90ZW50IGFuZFxuICAgKiBzYWZlIHRvIGNhbGwgd2hlbiBub25lIHdhcyBzZXQuXG4gICAqIEBwYXJhbSB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gW3JlZ2lzdHJhdGlvbnNdIC0gTGlmZWN5Y2xlLW93bmVkIHJlZ2lzdHJhdGlvbnMgdG8gY2xlYXIgY29uZGl0aW9uYWxseS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyhyZWdpc3RyYXRpb25zKSB7XG4gICAgaWYgKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIGZvciAoY29uc3Qge3Bvb2wsIHJlZ2lzdHJhdGlvbn0gb2YgcmVnaXN0cmF0aW9ucykge1xuICAgICAgICBwb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICAgIGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgb3V0IGFuZCByZWdpc3RlcnMgb25lIHBoeXNpY2FsIHRlbmFudCB0cmFuc2FjdGlvbiBmb3IgdGhlIGN1cnJlbnQgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHRlbmFudDogb2JqZWN0fX0gYXJncyAtIExvZ2ljYWwgaWRlbnRpZmllciBhbmQgdGVuYW50IGRlc2NyaXB0b3IuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQ3VycmVudCBhdHRlbXB0IHJlZ2lzdHJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50KHtkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudCwgLi4ucmVzdEFyZ3N9LCByZWdpc3RyYXRpb25zKSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwicmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgZGF0YWJhc2VJZGVudGlmaWVyXCIpXG4gICAgaWYgKCF0ZW5hbnQpIHRocm93IG5ldyBFcnJvcihcInJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIHRlbmFudFwiKVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGByZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSB0ZW5hbnRPbmx5IGRhdGFiYXNlOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgIH1cbiAgICBjb25zdCByZXVzZUtleSA9IHBvb2wuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBpZiAocmVnaXN0cmF0aW9ucy5zb21lKChyZWdpc3RyYXRpb24pID0+IHJlZ2lzdHJhdGlvbi5wb29sID09PSBwb29sICYmIHJlZ2lzdHJhdGlvbi5yZXVzZUtleSA9PT0gcmV1c2VLZXkpKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbn0gKi9cbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7XG4gICAgICBjb25uZWN0aW9uOiB1bmRlZmluZWQsXG4gICAgICBwb29sLFxuICAgICAgcmV1c2VLZXksXG4gICAgICByZXZva2VkOiBmYWxzZSxcbiAgICAgIHNoYXJlZFJlZ2lzdHJhdGlvbjogdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgcmVnaXN0cmF0aW9ucy5wdXNoKHJlZ2lzdHJhdGlvbilcbiAgICByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlID0gcG9vbFxuICAgICAgLmNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHtuYW1lOiBcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uXCJ9KVxuICAgICAgLnRoZW4oXG4gICAgICAgIChjb25uZWN0aW9uKSA9PiAoe2Nvbm5lY3Rpb24sIGVycm9yOiB1bmRlZmluZWR9KSxcbiAgICAgICAgKGVycm9yKSA9PiAoe1xuICAgICAgICAgIGNvbm5lY3Rpb246IHVuZGVmaW5lZCxcbiAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgY29ubmVjdGlvbiBjaGVja291dCBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH0pXG4gICAgICApXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2hlY2tvdXRPdXRjb21lID0gYXdhaXQgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZVxuXG4gICAgICBpZiAoY2hlY2tvdXRPdXRjb21lLmVycm9yKSB0aHJvdyBjaGVja291dE91dGNvbWUuZXJyb3JcbiAgICAgIGlmICghY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IGNvbm5lY3Rpb24gY2hlY2tvdXQgcmV0dXJuZWQgbm8gY29ubmVjdGlvblwiKVxuICAgICAgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24gPSBjaGVja291dE91dGNvbWUuY29ubmVjdGlvblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcblxuICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24uc3RhcnRUcmFuc2FjdGlvbigpXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuXG4gICAgICBjb25zdCBzaGFyZWRSZWdpc3RyYXRpb24gPSBwb29sLnNldFRlc3RTaGFyZWRDb25uZWN0aW9uRm9yQ29uZmlndXJhdGlvbihyZWdpc3RyYXRpb24uY29ubmVjdGlvbiwgcmV1c2VLZXkpXG4gICAgICBpZiAoIXNoYXJlZFJlZ2lzdHJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBEYXRhYmFzZSBwb29sIGRvZXMgbm90IHN1cHBvcnQgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uczogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICAgIHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24gPSBzaGFyZWRSZWdpc3RyYXRpb25cbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkge1xuICAgICAgICBwb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24oc2hhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVnaXN0cmF0aW9uLnJldm9rZWQgPSB0cnVlXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50cyhbcmVnaXN0cmF0aW9uXSwge2Rpc2NhcmQ6IHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwID09PSB0cnVlfSlcbiAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCBjbGVhbnVwRXJyb3JdLCBcIkZhaWxlZCB0byByZWdpc3RlciBhbmQgY2xlYW4gdXAgYSB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25cIiwge2NhdXNlOiBjbGVhbnVwRXJyb3J9KVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlcyBhdHRlbXB0IHJlZ2lzdHJhdGlvbnMgYmVmb3JlIHJvbGxpbmcgYmFjayBhbmQgcmVsZWFzaW5nIHRoZWlyIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEF0dGVtcHQgcmVnaXN0cmF0aW9ucy5cbiAgICogQHBhcmFtIHt7ZGlzY2FyZD86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBXaGV0aGVyIGNvbm5lY3Rpb25zIG11c3QgYmUgZGlzY2FyZGVkIGluc3RlYWQgb2YgcmV0dXJuZWQgdG8gdGhlIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKHJlZ2lzdHJhdGlvbnMsIHtkaXNjYXJkID0gZmFsc2V9ID0ge30pIHtcbiAgICBmb3IgKGNvbnN0IHJlZ2lzdHJhdGlvbiBvZiByZWdpc3RyYXRpb25zKSB7XG4gICAgICByZWdpc3RyYXRpb24ucmV2b2tlZCA9IHRydWVcbiAgICAgIGlmIChkaXNjYXJkKSByZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCA9IHRydWVcbiAgICAgIGlmIChyZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uKSByZWdpc3RyYXRpb24ucG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24pXG4gICAgfVxuICAgIGNvbnN0IGNsZWFudXBSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5yZWdpc3RyYXRpb25zXS5yZXZlcnNlKCkubWFwKChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5jbGVhbnVwUHJvbWlzZSA/Pz0gdGhpcy5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbihyZWdpc3RyYXRpb24pXG5cbiAgICAgIHJldHVybiByZWdpc3RyYXRpb24uY2xlYW51cFByb21pc2VcbiAgICB9KSlcbiAgICBjb25zdCBlcnJvcnMgPSBjbGVhbnVwUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBjbGVhbiB1cCB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYW5zIG9uZSBhdHRlbXB0IHJlZ2lzdHJhdGlvbiBleGFjdGx5IG9uY2UsIGluY2x1ZGluZyBhIGNoZWNrb3V0IHRoYXQgd2FzIHN0aWxsIHBlbmRpbmcgYXQgcmV2b2NhdGlvbi5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ufSByZWdpc3RyYXRpb24gLSBBdHRlbXB0LW93bmVkIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcm9sbGJhY2sgYW5kIHJlbGVhc2Ugb3IgcXVhcmFudGluZS5cbiAgICovXG4gIGFzeW5jIGNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbikge1xuICAgIGxldCBjb25uZWN0aW9uID0gcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb25cblxuICAgIGlmICghY29ubmVjdGlvbiAmJiByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlKSB7XG4gICAgICBjb25zdCBjaGVja291dE91dGNvbWUgPSBhd2FpdCByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlXG5cbiAgICAgIGlmIChjaGVja291dE91dGNvbWUuZXJyb3IpIHJldHVyblxuICAgICAgY29ubmVjdGlvbiA9IGNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uXG4gICAgICByZWdpc3RyYXRpb24uY29ubmVjdGlvbiA9IGNvbm5lY3Rpb25cbiAgICB9XG4gICAgaWYgKCFjb25uZWN0aW9uKSByZXR1cm5cblxuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSkgYXdhaXQgY29ubmVjdGlvbi5yb2xsYmFja1RyYW5zYWN0aW9uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCkge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5wb29sLmRpc2NhcmQoY29ubmVjdGlvbilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24ucG9vbC5jaGVja2luKGNvbm5lY3Rpb24pXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBjbGVhbiB1cCBhIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbGVjdHMgdGhlIGN1cnJlbnQgbm9uLXRlbmFudCBjb25uZWN0aW9ucyBlbGlnaWJsZSBmb3Igc2hhcmVkIHRyYW5zYWN0aW9uIHdvcmsuXG4gICAqIEBwYXJhbSB7e3RyYW5zYWN0aW9uc09ubHk6IGJvb2xlYW59fSBhcmdzIC0gU2VsZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gRWxpZ2libGUgY29ubmVjdGlvbnMgYnkgaWRlbnRpZmllci5cbiAgICovXG4gIHNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHl9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb25zID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0ge31cblxuICAgIGZvciAoY29uc3QgW2lkZW50aWZpZXIsIGNvbm5lY3Rpb25dIG9mIE9iamVjdC5lbnRyaWVzKGN1cnJlbnRDb25uZWN0aW9ucykpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uKCkudGVuYW50T25seSkgY29udGludWVcbiAgICAgIGlmICh0cmFuc2FjdGlvbnNPbmx5ICYmICFjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkpIGNvbnRpbnVlXG4gICAgICBjb25uZWN0aW9uc1tpZGVudGlmaWVyXSA9IGNvbm5lY3Rpb25cbiAgICB9XG5cbiAgICByZXR1cm4gY29ubmVjdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBwaHlzaWNhbC1jb25uZWN0aW9uIGNvb3JkaW5hdGlvbiBiZWZvcmUgYSB0cmFuc2FjdGlvbi1vcGVuaW5nIGhvb2tcbiAgICogY2FuIGV4cG9zZSB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gdG8gYSBsb25nLWxpdmVkIGluLXByb2Nlc3Mgc2VydmljZS5cbiAgICogQ2hpbGQtcHJvY2VzcyBjb29yZGluYXRlcyByZW1haW4gdW5wdWJsaXNoZWQgdW50aWwgdGhlIHRyYW5zYWN0aW9uIGV4aXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWQ+fSAtIFByZXBhcmVkIGNvb3JkaW5hdG9yLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZVNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5OiBmYWxzZX0pXG5cbiAgICBpZiAoT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJyb2tlcjogYXdhaXQgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIuc3RhcnQoe2Nvbm5lY3Rpb25zfSksXG4gICAgICBlbnZpcm9ubWVudFB1Ymxpc2hlZDogZmFsc2UsXG4gICAgICBwcmV2aW91c0Vudmlyb25tZW50OiB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBwcmVwYXJlZCBicm9rZXIgY29vcmRpbmF0ZXMgZXhhY3RseSB0aGUgc2VsZWN0ZWQgcGh5c2ljYWwgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHJlZ2lzdHJhdGlvbiAtIFByZXBhcmVkIGNvb3JkaW5hdG9yLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gY29ubmVjdGlvbnMgLSBTZWxlY3RlZCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaWRlbnRpZmllciBzZXQgYW5kIHBoeXNpY2FsIGNvbm5lY3Rpb25zIG1hdGNoIGV4YWN0bHkuXG4gICAqL1xuICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlck1hdGNoZXNDb25uZWN0aW9ucyhyZWdpc3RyYXRpb24sIGNvbm5lY3Rpb25zKSB7XG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyhjb25uZWN0aW9ucylcblxuICAgIGlmICghcmVnaXN0cmF0aW9uIHx8IGlkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlZ2lzdHJhdGlvbi5icm9rZXIuY29ubmVjdGlvbnMpLmxlbmd0aCAhPT0gaWRlbnRpZmllcnMubGVuZ3RoKSByZXR1cm4gZmFsc2VcblxuICAgIGZvciAoY29uc3QgW2lkZW50aWZpZXIsIGNvbm5lY3Rpb25dIG9mIE9iamVjdC5lbnRyaWVzKGNvbm5lY3Rpb25zKSkge1xuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5icm9rZXIuY29ubmVjdGlvbnNbaWRlbnRpZmllcl0gIT09IGNvbm5lY3Rpb24pIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIGEgY2FwYWJpbGl0eS1zY29wZWQgYnJva2VyIGZvciB0aGUgYWN0aXZlIG5vbi10ZW5hbnQgcGh5c2ljYWxcbiAgICogdHJhbnNhY3Rpb24gY29ubmVjdGlvbnMuIE5vIGJyb2tlci9lbnYgaXMgaW5zdGFsbGVkIGZvciB0cnVuY2F0aW9uLW9ubHkgb3JcbiAgICogb3RoZXIgdHJhbnNhY3Rpb24tZGlzYWJsZWQgYXR0ZW1wdHMuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb259IFtwcmVwYXJlZFJlZ2lzdHJhdGlvbl0gLSBDb29yZGluYXRvciBwcmVwYXJlZCBiZWZvcmUgaG9va3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBbc2VsZWN0ZWRDb25uZWN0aW9uc10gLSBQb3N0LWhvb2sgYWN0aXZlIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZD59IC0gQXR0ZW1wdCByZWdpc3RyYXRpb24uXG4gICAqL1xuICBhc3luYyBzdGFydFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uLCBzZWxlY3RlZENvbm5lY3Rpb25zKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBzZWxlY3RlZENvbm5lY3Rpb25zIHx8IHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seTogdHJ1ZX0pXG5cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXJzID0gT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpXG4gICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBsZXQgYnJva2VyXG5cbiAgICBpZiAocHJlcGFyZWRSZWdpc3RyYXRpb24gJiYgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkJyb2tlck1hdGNoZXNDb25uZWN0aW9ucyhwcmVwYXJlZFJlZ2lzdHJhdGlvbiwgY29ubmVjdGlvbnMpKSB7XG4gICAgICBicm9rZXIgPSBwcmVwYXJlZFJlZ2lzdHJhdGlvbi5icm9rZXJcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICBicm9rZXIgPSBhd2FpdCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlci5zdGFydCh7Y29ubmVjdGlvbnN9KVxuICAgIH1cblxuICAgIGNvbnN0IHByZXZpb3VzRW52aXJvbm1lbnQgPSBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl1cbiAgICBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl0gPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeSh7XG4gICAgICBhZGRyZXNzOiBicm9rZXIuYWRkcmVzcygpLFxuICAgICAgY2FwYWJpbGl0eTogYnJva2VyLmNhcGFiaWxpdHkoKSxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBleHBlY3RlZDogdHJ1ZVxuICAgIH0pKS50b1N0cmluZyhcImJhc2U2NHVybFwiKVxuXG4gICAgcmV0dXJuIHticm9rZXIsIGVudmlyb25tZW50UHVibGlzaGVkOiB0cnVlLCBwcmV2aW91c0Vudmlyb25tZW50fVxuICB9XG5cbiAgLyoqXG4gICAqIFJldm9rZXMgYW4gYXR0ZW1wdCBicm9rZXIgYmVmb3JlIGRhdGFiYXNlIHJvbGxiYWNrIGhvb2tzIHJ1biBhbmQgcmVzdG9yZXNcbiAgICogdGhlIGNhbGxlcidzIGVudmlyb25tZW50IHNvIGxhdGVyIHBvb2xlZC9zcGF3bmVkIGNoaWxkcmVuIGNhbm5vdCBpbmhlcml0IGl0LlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSByZWdpc3RyYXRpb24gLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGFzeW5jIHN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihyZWdpc3RyYXRpb24pIHtcbiAgICBpZiAoIXJlZ2lzdHJhdGlvbikgcmV0dXJuXG5cbiAgICBpZiAocmVnaXN0cmF0aW9uLmVudmlyb25tZW50UHVibGlzaGVkKSB7XG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnByZXZpb3VzRW52aXJvbm1lbnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkZWxldGUgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl0gPSByZWdpc3RyYXRpb24ucHJldmlvdXNFbnZpcm9ubWVudFxuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCByZWdpc3RyYXRpb24uYnJva2VyLmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVlc3QgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXF1ZXN0Q2xpZW50Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZXF1ZXN0IGNsaWVudC5cbiAgICovXG4gIGFzeW5jIHJlcXVlc3RDbGllbnQoKSB7XG4gICAgaWYgKCF0aGlzLl9yZXF1ZXN0Q2xpZW50KSB7XG4gICAgICB0aGlzLl9yZXF1ZXN0Q2xpZW50ID0gbmV3IFJlcXVlc3RDbGllbnQoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0Q2xpZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgdGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGltcG9ydFRlc3RGaWxlcygpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuXG4gICAgaWYgKCF0aGlzLl9wcm9maWxlcikge1xuICAgICAgYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLmltcG9ydFRlc3RGaWxlcyh0aGlzLmdldFRlc3RGaWxlcygpKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0ZXN0RmlsZSBvZiB0aGlzLmdldFRlc3RGaWxlcygpKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1JlZ2lzdHJhdGlvbnMgPSB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKClcblxuICAgICAgYXdhaXQgdGhpcy5fcHJvZmlsZXIubWVhc3VyZVBoYXNlKFwiaW1wb3J0c1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5pbXBvcnRUZXN0RmlsZXMoW3Rlc3RGaWxlXSlcbiAgICAgIH0sIHtmaWxlUGF0aDogdGVzdEZpbGV9KVxuICAgICAgdGhpcy5hc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKGV4aXN0aW5nUmVnaXN0cmF0aW9ucywgdGVzdEZpbGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbGxlY3RzIHBhY2thZ2UgZGVjbGFyYXRpb24gb2JqZWN0cyBieSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtTZXQ8UGFja2FnZVJlZ2lzdHJhdGlvbj59IFtyZWdpc3RyYXRpb25zXSAtIEFjY3VtdWxhdGVkIGlkZW50aXRpZXMuXG4gICAqIEByZXR1cm5zIHtTZXQ8UGFja2FnZVJlZ2lzdHJhdGlvbj59IC0gUmVnaXN0cmF0aW9uIGlkZW50aXRpZXMuXG4gICAqL1xuICB0ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cyhyZWdpc3RyYXRpb25zID0gbmV3IFNldCgpKSB7XG4gICAgY29uc3QgdmlzaXQgPSAoLyoqIEB0eXBlIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gKi8gc3VpdGUpID0+IHtcbiAgICAgIHJlZ2lzdHJhdGlvbnMuYWRkKHN1aXRlKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIFsuLi5zdWl0ZS5ob29rcy5iZWZvcmVBbGwsIC4uLnN1aXRlLmhvb2tzLmJlZm9yZUVhY2gsIC4uLnN1aXRlLmhvb2tzLmFmdGVyRWFjaCwgLi4uc3VpdGUuaG9va3MuYWZ0ZXJBbGxdKSB7XG4gICAgICAgIHJlZ2lzdHJhdGlvbnMuYWRkKGhvb2spXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHRlc3REZWNsYXJhdGlvbiBvZiBzdWl0ZS50ZXN0cykgcmVnaXN0cmF0aW9ucy5hZGQodGVzdERlY2xhcmF0aW9uKVxuICAgICAgZm9yIChjb25zdCBjaGlsZFN1aXRlIG9mIHN1aXRlLnN1aXRlcykgdmlzaXQoY2hpbGRTdWl0ZSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHN1aXRlIG9mIHRoaXMuZ2V0VGVzdENvbnRleHQoKS5yZWdpc3RyeS5zdWl0ZXMpIHZpc2l0KHN1aXRlKVxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIGRldGVybWluaXN0aWMgb3duZXJzaGlwIHRvIHBhY2thZ2UgZGVjbGFyYXRpb25zIGFkZGVkIGJ5IG9uZSBlbnRyeSBmaWxlLlxuICAgKiBAcGFyYW0ge1NldDxQYWNrYWdlUmVnaXN0cmF0aW9uPn0gcHJldmlvdXNSZWdpc3RyYXRpb25zIC0gSWRlbnRpdGllcyBwcmVzZW50IGJlZm9yZSBpbXBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvd25lckZpbGVQYXRoIC0gSW1wb3J0aW5nIGVudHJ5IGZpbGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcChwcmV2aW91c1JlZ2lzdHJhdGlvbnMsIG93bmVyRmlsZVBhdGgpIHtcbiAgICBmb3IgKGNvbnN0IHJlZ2lzdHJhdGlvbiBvZiB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKCkpIHtcbiAgICAgIGlmICghcHJldmlvdXNSZWdpc3RyYXRpb25zLmhhcyhyZWdpc3RyYXRpb24pKSB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5zZXQocmVnaXN0cmF0aW9uLCBvd25lckZpbGVQYXRoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGZhaWxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBmYWlsZWQuXG4gICAqL1xuICBpc0ZhaWxlZCgpIHsgcmV0dXJuIHRoaXMuX2ZhaWxlZFRlc3RzICE9PSB1bmRlZmluZWQgJiYgKHRoaXMuX2ZhaWxlZFRlc3RzID4gMCB8fCB0aGlzLl9wYWNrYWdlUmVzdWx0Py5zdGF0dXMgPT09IFwiZmFpbGVkXCIpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmFpbGVkIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBmYWlsZWQgdGVzdHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0cygpIHtcbiAgICBpZiAodGhpcy5fZmFpbGVkVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2ZhaWxlZFRlc3RzXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIHNlbGVjdGVkIHRlc3RzIGJsb2NrZWQgYnkgYSB0ZXJtaW5hbCByZXNvdXJjZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBTZWxlY3RlZCB0ZXN0cyBub3QgZXhlY3V0ZWQgYmVjYXVzZSBhIHNoYXJlZCByZXNvdXJjZSBmYWlsZWQuXG4gICAqL1xuICBnZXROb3RSdW5UZXN0cygpIHsgcmV0dXJuIHRoaXMuX25vdFJ1blRlc3REZXRhaWxzLmxlbmd0aCB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgcnVudGltZSBub24tcnVuIGF0dHJpYnV0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5Ob25SdW5UZXN0UmVzdWx0W119IC0gUnVudGltZSBub24tcnVuIGRldGFpbHMgd2l0aCB0aGUgb3JpZ2luYXRpbmcgZmFpbHVyZS5cbiAgICovXG4gIGdldE5vdFJ1blRlc3REZXRhaWxzKCkgeyByZXR1cm4gdGhpcy5fbm90UnVuVGVzdERldGFpbHMgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgc2VsZWN0ZWQgdGVzdCB0aGF0IGRpZCBub3QgZXhlY3V0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLk5vblJ1blRlc3RSZXN1bHR9IHJlc3VsdCAtIFRlcm1pbmFsLXJlc291cmNlIG5vbi1ydW4gcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZE5vdFJ1blRlc3QocmVzdWx0KSB7IHRoaXMuX25vdFJ1blRlc3REZXRhaWxzLnB1c2gocmVzdWx0KSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtGYWlsZWRUZXN0RGV0YWlsW119IC0gRmFpbGVkIHRlc3QgZGV0YWlscy5cbiAgICovXG4gIGdldEZhaWxlZFRlc3REZXRhaWxzKCkge1xuICAgIHJldHVybiB0aGlzLl9mYWlsZWRUZXN0RGV0YWlsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdCBmYWlsZWQgdGVzdCBjb25zb2xlIG91dHB1dHMgdG8gYXNzZXRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5hc3NldHNQYXRoXSAtIEFzc2V0cyBkaXJlY3RvcnkgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFdyaXR0ZW4gbG9nIGZpbGUgcGF0aHMuXG4gICAqL1xuICBhc3luYyBwZXJzaXN0RmFpbGVkVGVzdENvbnNvbGVPdXRwdXRzVG9Bc3NldHMoe2Fzc2V0c1BhdGggPSBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgXCJ0bXAvc2NyZWVuc2hvdHNcIil9ID0ge30pIHtcbiAgICBjb25zdCBmYWlsZWRUZXN0RGV0YWlscyA9IHRoaXMuZ2V0RmFpbGVkVGVzdERldGFpbHMoKVxuICAgIGNvbnN0IHdyaXR0ZW5Mb2dQYXRocyA9IFtdXG4gICAgbGV0IGNyZWF0ZWREaXJlY3RvcnkgPSBmYWxzZVxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGZhaWxlZFRlc3REZXRhaWxzLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgY29uc3QgZmFpbGVkVGVzdERldGFpbCA9IGZhaWxlZFRlc3REZXRhaWxzW2luZGV4XVxuICAgICAgY29uc3QgY29uc29sZU91dHB1dCA9IGZhaWxlZFRlc3REZXRhaWwuY29uc29sZU91dHB1dFxuXG4gICAgICBpZiAoIWNvbnNvbGVPdXRwdXQpIGNvbnRpbnVlXG5cbiAgICAgIGlmICghY3JlYXRlZERpcmVjdG9yeSkge1xuICAgICAgICBhd2FpdCBmcy5ta2Rpcihhc3NldHNQYXRoLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgICAgICAgY3JlYXRlZERpcmVjdG9yeSA9IHRydWVcbiAgICAgIH1cblxuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKVxuICAgICAgY29uc3QgdGltZXN0YW1wID0gW1xuICAgICAgICBTdHJpbmcobm93LmdldEZ1bGxZZWFyKCkpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0SG91cnMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1pbnV0ZXMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldFNlY29uZHMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1pbGxpc2Vjb25kcygpKS5wYWRTdGFydCgzLCBcIjBcIilcbiAgICAgIF0uam9pbihcIlwiKVxuICAgICAgY29uc3Qgc2x1ZyA9IHRvRmlsZVNsdWcoZmFpbGVkVGVzdERldGFpbC5mdWxsRGVzY3JpcHRpb24pXG4gICAgICBjb25zdCBmaWxlTmFtZSA9IGAke3RpbWVzdGFtcH0tJHtTdHJpbmcoaW5kZXggKyAxKS5wYWRTdGFydCgyLCBcIjBcIil9LSR7c2x1Z30uY29uc29sZS5sb2dgXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbihhc3NldHNQYXRoLCBmaWxlTmFtZSlcblxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGZpbGVQYXRoLCBjb25zb2xlT3V0cHV0LCBcInV0ZjhcIilcbiAgICAgIGZhaWxlZFRlc3REZXRhaWwuY29uc29sZUxvZ1BhdGggPSBmaWxlUGF0aFxuICAgICAgd3JpdHRlbkxvZ1BhdGhzLnB1c2goZmlsZVBhdGgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHdyaXR0ZW5Mb2dQYXRoc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN1Y2Nlc3NmdWwgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHN1Y2Nlc3NmdWwgdGVzdHMuXG4gICAqL1xuICBnZXRTdWNjZXNzZnVsVGVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdHMgY291bnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHRlc3RzIGNvdW50LlxuICAgKi9cbiAgZ2V0VGVzdHNDb3VudCgpIHtcbiAgICBpZiAodGhpcy5fdGVzdHNDb3VudCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fdGVzdHNDb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4ZWN1dGVkIHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldEV4ZWN1dGVkVGVzdHNDb3VudCgpIHtcbiAgICByZXR1cm4gdGhpcy5fcGFja2FnZVJlc3VsdD8udGVzdHMubGVuZ3RoID8/IHRoaXMuX3Rlc3REdXJhdGlvbnMubGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogRGlzdGluZ3Vpc2hlcyBhbiBlbXB0eSBzZWxlY3Rpb24gZnJvbSBhIGZhaWx1cmUgYmVmb3JlIHNlbGVjdGVkIGNhc2VzIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc2VsZWN0aW9uIG1hdGNoZWQgbm8gZGVjbGFyYXRpb25zLlxuICAgKi9cbiAgaGFzTm9NYXRjaGVzKCkge1xuICAgIHJldHVybiB0aGlzLl9wYWNrYWdlUmVzdWx0Py5ub01hdGNoZXMgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSB0ZXN0cyByZWNvcmRlZCBkdXJpbmcgdGhlIHJ1biwgc2xvd2VzdCBmaXJzdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtsaW1pdF0gLSBNYXhpbXVtIG51bWJlciBvZiB0ZXN0cyB0byByZXR1cm4gKDAgcmV0dXJucyBhbGwpLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXIsIGR1cmF0aW9uTXM6IG51bWJlcn0+fSAtIFNsb3dlc3QgdGVzdHMsIHNsb3dlc3QgZmlyc3QuXG4gICAqL1xuICBnZXRTbG93ZXN0VGVzdHMobGltaXQgPSAxMCkge1xuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi50aGlzLl90ZXN0RHVyYXRpb25zXS5zb3J0KCh0ZXN0QSwgdGVzdEIpID0+IHRlc3RCLmR1cmF0aW9uTXMgLSB0ZXN0QS5kdXJhdGlvbk1zKVxuXG4gICAgcmV0dXJuIGxpbWl0ID4gMCA/IHNvcnRlZC5zbGljZSgwLCBsaW1pdCkgOiBzb3J0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZXBhcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBwcmVwYXJlKCkge1xuICAgIHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9IGZhbHNlXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAwXG4gICAgdGhpcy5fbm90UnVuVGVzdERldGFpbHMgPSBbXVxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICB0aGlzLl90ZXN0RHVyYXRpb25zID0gW11cbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2NvbXBsZXRlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX3Rlc3RNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gdW5kZWZpbmVkXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0VGVzdENvbnRleHQoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBvd25lckZpbGVQYXRoXG5cbiAgICBjb250ZXh0LnJlc2V0KHtjb25maWc6IHRydWV9KVxuICAgIGNvbnRleHQuc2V0RGVjbGFyYXRpb25Mb2NhdG9yKCgpID0+IHRoaXMuY2FwdHVyZVRlc3REZWNsYXJhdGlvbkxvY2F0aW9uKG93bmVyRmlsZVBhdGgpKVxuICAgIGNvbnN0IHRlc3RpbmdDb25maWdQYXRoID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0VGVzdGluZygpXG5cbiAgICBhd2FpdCBjb250ZXh0LmRlc2NyaWJlKFwiXCIsIHtkYXRhYmFzZUNsZWFuaW5nOiB7dHJhbnNhY3Rpb246IHRydWV9fSwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRlc3RpbmdDb25maWdQYXRoKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuUHJvZmlsZVNwYW4oe3BoYXNlOiBcInRlc3RpbmcgY29uZmlnL2dsb2JhbCBzZXR1cFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmltcG9ydFRlc3RpbmdDb25maWdQYXRoKClcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9wcm9maWxlcikge1xuICAgICAgICBhd2FpdCB0aGlzLmltcG9ydFRlc3RGaWxlcygpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRoaXMuZ2V0VGVzdEZpbGVzKCkpIHtcbiAgICAgICAgICBvd25lckZpbGVQYXRoID0gdGVzdEZpbGVcbiAgICAgICAgICBjb25zdCBleGlzdGluZ1JlZ2lzdHJhdGlvbnMgPSB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKClcblxuICAgICAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICAgICAgfSwge2ZpbGVQYXRoOiB0ZXN0RmlsZX0pXG4gICAgICAgICAgdGhpcy5hc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKGV4aXN0aW5nUmVnaXN0cmF0aW9ucywgdGVzdEZpbGUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICAgIG93bmVyRmlsZVBhdGggPSB1bmRlZmluZWRcbiAgICB0aGlzLmFuYWx5emVEZWNsYXJhdGlvbnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGEgdGVzdCBzb3VyY2UgbG9jYXRpb24gd2l0aG91dCBhdHRyaWJ1dGluZyBwYWNrYWdlL2ZhY2FkZSBmcmFtZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBvd25lckZpbGVQYXRoIC0gSW1wb3J0aW5nIGVudHJ5IGZpbGUgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHt7ZmlsZVBhdGg/OiBzdHJpbmcsIGxpbmU/OiBudW1iZXJ9fSAtIERlY2xhcmF0aW9uIGxvY2F0aW9uLlxuICAgKi9cbiAgY2FwdHVyZVRlc3REZWNsYXJhdGlvbkxvY2F0aW9uKG93bmVyRmlsZVBhdGgpIHtcbiAgICBjb25zdCBzdGFjayA9IG5ldyBFcnJvcigpLnN0YWNrPy5zcGxpdChcIlxcblwiKSB8fCBbXVxuXG4gICAgZm9yIChjb25zdCBzdGFja0xpbmUgb2Ygc3RhY2spIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gc3RhY2tMaW5lLm1hdGNoKC8oPzpcXCh8XFxzKShmaWxlOlxcL1xcLy4qP3xcXC9bXlwiXSo/KTooXFxkKyk6KFxcZCspXFwpPyQvdSlcbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGxldCBmaWxlUGF0aCA9IG1hdGNoWzFdXG4gICAgICBpZiAoZmlsZVBhdGguc3RhcnRzV2l0aChcImZpbGU6Ly9cIikpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmaWxlUGF0aCA9IGZpbGVVUkxUb1BhdGgoZmlsZVBhdGgpXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc29sdmVkRmlsZVBhdGggPSBwYXRoLnJlc29sdmUoZmlsZVBhdGgpXG4gICAgICBjb25zdCBwb3J0YWJsZVBhdGggPSByZXNvbHZlZEZpbGVQYXRoLnJlcGxhY2VBbGwocGF0aC5zZXAsIFwiL1wiKVxuXG4gICAgICBpZiAocG9ydGFibGVQYXRoLmVuZHNXaXRoKFwiL3NyYy90ZXN0aW5nL3Rlc3QtcnVubmVyLmpzXCIpKSBjb250aW51ZVxuICAgICAgaWYgKHBvcnRhYmxlUGF0aC5lbmRzV2l0aChcIi9zcmMvdGVzdGluZy90ZXN0LmpzXCIpKSBjb250aW51ZVxuICAgICAgaWYgKHJlc29sdmVkRmlsZVBhdGguc3RhcnRzV2l0aChgJHt0ZXN0aW5nUGFja2FnZURpcmVjdG9yeX0ke3BhdGguc2VwfWApKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4ge2ZpbGVQYXRoOiByZXNvbHZlZEZpbGVQYXRoLCBsaW5lOiBOdW1iZXIobWF0Y2hbMl0pfVxuICAgIH1cblxuICAgIHJldHVybiBvd25lckZpbGVQYXRoID8ge2ZpbGVQYXRoOiBvd25lckZpbGVQYXRofSA6IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcmUgYW55IHRlc3RzIGZvY3Vzc2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFueSB0ZXN0cyBmb2N1c3NlZC5cbiAgICovXG4gIGFyZUFueVRlc3RzRm9jdXNzZWQoKSB7XG4gICAgaWYgKHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJIYXNuJ3QgYmVlbiBkZXRlY3RlZCB5ZXRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICAvKipcbiAgICogUmVjb3JkcyBhbiBhc3luY2hyb25vdXMgY3Jhc2ggKGFuIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbiBkZXRhY2hlZCBmcm9tXG4gICAqIGFueSBhd2FpdCwgZS5nLiBhIGB2b2lkIGNvbm5lY3Rpb24uYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4gYnJvYWRjYXN0KC4uLikpYFxuICAgKiBmcm9udGVuZC1tb2RlbCBwdWJsaXNoIOKAlCBvciBhIHN5bmNocm9ub3VzIHRocm93IGluc2lkZSBhIGRldGFjaGVkIGNhbGxiYWNrXG4gICAqIHN1Y2ggYXMgYSBkcml2ZXIgc29ja2V0IG9yIHRpbWVyIGNhbGxiYWNrKSBhcyBhIHJlYWwsIHZpc2libGUsIGF0dHJpYnV0ZWRcbiAgICogdGVzdCBmYWlsdXJlLlxuICAgKlxuICAgKiBXaXRob3V0IHRoaXMsIHN1Y2ggYSByZWplY3Rpb24vZXhjZXB0aW9uIGhhcyBubyBoYW5kbGVyLCBzbyBvbiBtb2Rlcm4gTm9kZVxuICAgKiB0aGUgcHJvY2VzcyBpcyBURVJNSU5BVEVEIOKAlCB0aGUgcnVuIGVuZHMgd2l0aCBubyByZXBvcnRlZCBmYWlsdXJlcyBhbmQgQ0lcbiAgICoganVzdCBzZWVzIGEgY3Jhc2hlZC9yZXRyaWVkIHNoYXJkIHdpdGggYW4gZW1wdHkgcmVzdWx0ICh0aGUgcmVjdXJyaW5nXG4gICAqIFwic2lsZW50IHRlc3QtcnVubmVyIGRlYXRoXCI6IGludmlzaWJsZSBhbmQgaW1wb3NzaWJsZSB0byBkaWFnbm9zZSkuIFR1cm5pbmdcbiAgICogaXQgaW50byBhIGZhaWx1cmUgbWFrZXMgdGhlIHJ1biBnbyByZWQgd2l0aCBzb21ldGhpbmcgZGVidWdnYWJsZSBpbnN0ZWFkIG9mXG4gICAqIHZhbmlzaGluZy5cbiAgICogQHBhcmFtIHtcInVuY2F1Z2h0RXhjZXB0aW9uXCIgfCBcInVuaGFuZGxlZFJlamVjdGlvblwifSBraW5kIC0gQXN5bmMtY3Jhc2gga2luZC5cbiAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBSZWplY3Rpb24gcmVhc29uIG9yIHRocm93biBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRBc3luY0NyYXNoKGtpbmQsIHJlYXNvbikge1xuICAgIGNvbnN0IGVycm9yID0gcmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyByZWFzb24gOiBuZXcgRXJyb3IoYCR7a2luZH06ICR7U3RyaW5nKHJlYXNvbil9YClcbiAgICBjb25zdCBuZWFyID0gdGhpcy5fbGFzdFRlc3RDb250ZXh0XG4gICAgY29uc3QgYXR0cmlidXRpb24gPSBuZWFyID8gYCwgbmVhciB0ZXN0OiAke25lYXIuZnVsbERlc2NyaXB0aW9ufSAoJHtuZWFyLmZpbGVQYXRofToke25lYXIubGluZX0pYCA6IFwiXCJcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gKHRoaXMuX2ZhaWxlZFRlc3RzIHx8IDApICsgMVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiBgPCR7a2luZH0gZHVyaW5nIHRlc3QgcnVuJHthdHRyaWJ1dGlvbn0+YCxcbiAgICAgIGZpbGVQYXRoOiBuZWFyID8gbmVhci5maWxlUGF0aCA6IFwiPHRlc3QgcnVubmVyPlwiLFxuICAgICAgbGluZTogbmVhciA/IG5lYXIubGluZSA6IDAsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5bdGVzdC1ydW5uZXJdICR7a2luZH0gZHVyaW5nIHRoZSB0ZXN0IHJ1biDigJQgdGhpcyB3b3VsZCBvdGhlcndpc2UgdGVybWluYXRlIHRoZSBwcm9jZXNzIHNpbGVudGx5IGFuZCBzdXJmYWNlIG9ubHkgYXMgYSBjcmFzaGVkL3JldHJpZWQgc2hhcmQgd2l0aCB6ZXJvIHJlcG9ydGVkIGZhaWx1cmVzLiR7YXR0cmlidXRpb259YCkpXG4gICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgY2xlYW51cCBmYWlsdXJlIGFmdGVyIHRpbWVvdXQgaGFuZGxpbmcgaGFzIGJlZ3VuLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIERldGFjaGVkIGNsZWFudXAgcmVqZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2xlYW51cE5hbWUgLSBDbGVhbnVwIG9wZXJhdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge1NldDxFcnJvcj59IFtyZWNvcmRlZEVycm9yc10gLSBBdHRlbXB0LW93bmVkIGNsZWFudXAgZXJyb3JzIGFscmVhZHkgcmVwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKHJlYXNvbiwgY2xlYW51cE5hbWUsIHJlY29yZGVkRXJyb3JzKSB7XG4gICAgY29uc3QgZXJyb3IgPSByZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHJlYXNvbiA6IG5ldyBFcnJvcihgJHtjbGVhbnVwTmFtZX0gY2xlYW51cCBmYWlsZWQ6ICR7U3RyaW5nKHJlYXNvbil9YClcblxuICAgIGlmIChyZWNvcmRlZEVycm9ycykge1xuICAgICAgLy8gTXVsdGlwbGUgYm91bmRlZCBvYnNlcnZlcnMgY2FuIHJlY2VpdmUgdGhlIHNhbWUgZGV0YWNoZWQgY2xlYW51cCByZWplY3Rpb24uXG4gICAgICBpZiAocmVjb3JkZWRFcnJvcnMuaGFzKGVycm9yKSkgcmV0dXJuXG4gICAgICByZWNvcmRlZEVycm9ycy5hZGQoZXJyb3IpXG4gICAgfVxuXG4gICAgY29uc3QgbmVhciA9IHRoaXMuX2xhc3RUZXN0Q29udGV4dFxuICAgIGNvbnN0IGF0dHJpYnV0aW9uID0gbmVhciA/IGAsIG5lYXIgdGVzdDogJHtuZWFyLmZ1bGxEZXNjcmlwdGlvbn0gKCR7bmVhci5maWxlUGF0aH06JHtuZWFyLmxpbmV9KWAgOiBcIlwiXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9ICh0aGlzLl9mYWlsZWRUZXN0cyB8fCAwKSArIDFcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogYDwke2NsZWFudXBOYW1lfSBlbWVyZ2VuY3kgY2xlYW51cCBmYWlsdXJlJHthdHRyaWJ1dGlvbn0+YCxcbiAgICAgIGZpbGVQYXRoOiBuZWFyID8gbmVhci5maWxlUGF0aCA6IFwiPHRlc3QgcnVubmVyPlwiLFxuICAgICAgbGluZTogbmVhciA/IG5lYXIubGluZSA6IDAsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5bdGVzdC1ydW5uZXJdICR7Y2xlYW51cE5hbWV9IGNsZWFudXAgZmFpbGVkIGFmdGVyIHRpbWVvdXQgaGFuZGxpbmcgYmVnYW4uJHthdHRyaWJ1dGlvbn1gKSlcbiAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICB9XG5cbiAgYXN5bmMgcnVuKCkge1xuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBwcm9jZXNzLWxldmVsIHVuaGFuZGxlZCByZWplY3Rpb24gZHVyaW5nIHRoZSBydW4uXG4gICAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBSZWplY3Rpb24gcmVhc29uLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIGNvbnN0IG9uVW5oYW5kbGVkUmVqZWN0aW9uID0gKHJlYXNvbikgPT4ge1xuICAgICAgLy8gSWYgYSB0ZXN0IGF0dGFjaGVkIGl0cyBPV04gdW5oYW5kbGVkUmVqZWN0aW9uIGxpc3RlbmVyLCBpdCBpc1xuICAgICAgLy8gaW50ZW50aW9uYWxseSBvYnNlcnZpbmcvdHJpZ2dlcmluZyB0aGUgcmVqZWN0aW9uIChlLmcuIGJlYWNvblxuICAgICAgLy8gZXJyb3ItcmVwb3J0aW5nLXNwZWMuanMpIOKAlCBOb2RlIGRpc3BhdGNoZXMgdG8gRVZFUlkgbGlzdGVuZXIsIHNvIGFsc29cbiAgICAgIC8vIGZhaWxpbmcgdGhlIHN1aXRlIGhlcmUgd291bGQgYnJlYWsgdGhvc2UgdGVzdHMuIERlZmVyIHRvIHRoZSB0ZXN0J3NcbiAgICAgIC8vIGhhbmRsZXI7IG9ubHkgdHJlYXQgYSByZWplY3Rpb24gYXMgYSBzaWxlbnQtZGVhdGggY3Jhc2ggd2hlbiBvdXJzIGlzIHRoZVxuICAgICAgLy8gc29sZSBsaXN0ZW5lciAobm8gcGVyc2lzdGVudCBmcmFtZXdvcmsgbGlzdGVuZXIgZXhpc3RzIHRvIG1hc2sgdGhpcykuXG4gICAgICBpZiAocHJvY2Vzcy5saXN0ZW5lckNvdW50KFwidW5oYW5kbGVkUmVqZWN0aW9uXCIpID4gMSkgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVjb3JkQXN5bmNDcmFzaChcInVuaGFuZGxlZFJlamVjdGlvblwiLCByZWFzb24pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIHByb2Nlc3MtbGV2ZWwgdW5jYXVnaHQgZXhjZXB0aW9uIGR1cmluZyB0aGUgcnVuIOKAlCBhXG4gICAgICogc3luY2hyb25vdXMgdGhyb3cgaW5zaWRlIGEgZGV0YWNoZWQgY2FsbGJhY2sgKGRyaXZlciBzb2NrZXQsIHRpbWVyLFxuICAgICAqIGV2ZW50IGVtaXR0ZXIpIHRoYXQgbm8gdGVzdCBhd2FpdCBvYnNlcnZlcy4gU2FtZSBzaWxlbnQtZGVhdGggbW9kZSBhc1xuICAgICAqIHVuaGFuZGxlZCByZWplY3Rpb25zOiB3aXRob3V0IGEgaGFuZGxlciB0aGUgcHJvY2VzcyBkaWVzIG1pZC1ydW4gYW5kIENJXG4gICAgICogc2VlcyBhIGNyYXNoZWQgc2hhcmQgd2l0aCB6ZXJvIHJlcG9ydGVkIGZhaWx1cmVzLlxuICAgICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBUaHJvd24gZXJyb3IuXG4gICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICovXG4gICAgY29uc3Qgb25VbmNhdWdodEV4Y2VwdGlvbiA9IChlcnJvcikgPT4ge1xuICAgICAgLy8gTWlycm9yIHRoZSB1bmhhbmRsZWRSZWplY3Rpb24gZGVmZXJyYWw6IGEgdGVzdCBvYnNlcnZpbmcvdHJpZ2dlcmluZ1xuICAgICAgLy8gdW5jYXVnaHQgZXhjZXB0aW9ucyB3aXRoIGl0cyBvd24gbGlzdGVuZXIgb3ducyB0aGVtLlxuICAgICAgaWYgKHByb2Nlc3MubGlzdGVuZXJDb3VudChcInVuY2F1Z2h0RXhjZXB0aW9uXCIpID4gMSkgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVjb3JkQXN5bmNDcmFzaChcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIGVycm9yKVxuICAgIH1cblxuICAgIHByb2Nlc3Mub24oXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgb25VbmhhbmRsZWRSZWplY3Rpb24pXG4gICAgcHJvY2Vzcy5vbihcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIG9uVW5jYXVnaHRFeGNlcHRpb24pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5QYWNrYWdlVGVzdHMoKVxuXG4gICAgICAvLyBBIHJlamVjdGlvbiBzY2hlZHVsZWQgYnkgdGhlIGZpbmFsIHRlc3QgKGEgZGV0YWNoZWQgcmVqZWN0ZWQgcHJvbWlzZSxcbiAgICAgIC8vIG9yIGFuIGFmdGVyQ29tbWl0IGNhbGxiYWNrIHJlamVjdGluZyBhcyB0aGUgc3VpdGUgZHJhaW5zKSBpcyByZXBvcnRlZFxuICAgICAgLy8gYnkgTm9kZSBvbiBhIExBVEVSIHR1cm4uIERyYWluIGEgZmV3IHR1cm5zIHdoaWxlIHRoZSBoYW5kbGVyIGlzIHN0aWxsXG4gICAgICAvLyBhdHRhY2hlZCBzbyB0aG9zZSBsYXRlIHJlamVjdGlvbnMgYXJlIHJlY29yZGVkIGluc3RlYWQgb2YgZXNjYXBpbmcgdG9cbiAgICAgIC8vIHRoZSBkZWZhdWx0IGNyYXNoIHBhdGggYWZ0ZXIgY2xlYW51cC5cbiAgICAgIGZvciAobGV0IGRyYWluVHVybiA9IDA7IGRyYWluVHVybiA8IDM7IGRyYWluVHVybisrKSB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRJbW1lZGlhdGUocmVzb2x2ZSkpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHByb2Nlc3Mub2ZmKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIG9uVW5oYW5kbGVkUmVqZWN0aW9uKVxuICAgICAgcHJvY2Vzcy5vZmYoXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBvblVuY2F1Z2h0RXhjZXB0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBhZnRlciBhbGxzIGZvciBhY3RpdmUgc2NvcGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgaG9va3MgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJBbGxzRm9yQWN0aXZlU2NvcGVzKCkge1xuICAgIGNvbnN0IGZhaWx1cmVTdGFydCA9IHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLmxlbmd0aFxuXG4gICAgYXdhaXQgdGhpcy5fcGFja2FnZVJ1bm5lcj8uY2xlYW51cEFjdGl2ZVN1aXRlcygpXG4gICAgdGhpcy50aHJvd0FmdGVyQWxsRmFpbHVyZXModGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuc2xpY2UoZmFpbHVyZVN0YXJ0KSlcbiAgfVxuXG4gIC8qKiBCdWlsZHMgZGVjbGFyYXRpb24gbWV0YWRhdGEgdXNlZCBvbmx5IGJ5IGZyYW1ld29yayBhZGFwdGVycyBhbmQgcHJvamVjdGlvbnMuICovXG4gIGFuYWx5emVEZWNsYXJhdGlvbnMoKSB7XG4gICAgY29uc3QgdmlzaXQgPSAoLyoqIEB0eXBlIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gKi8gc3VpdGUsIC8qKiBAdHlwZSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXX0gKi8gYW5jZXN0b3JzLCAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi8gcGFyZW50UHJvZmlsZVNjb3BlSWQpID0+IHtcbiAgICAgIGNvbnN0IHN1aXRlcyA9IFsuLi5hbmNlc3RvcnMsIHN1aXRlXVxuICAgICAgY29uc3QgZGVzY3JpcHRpb25zID0gc3VpdGVzLm1hcCgoZW50cnkpID0+IGVudHJ5Lm5hbWUpLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJcIilcbiAgICAgIGNvbnN0IG93bmVyRmlsZVBhdGggPSB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5nZXQoc3VpdGUpID8/IHN1aXRlLmxvY2F0aW9uLmZpbGVQYXRoXG4gICAgICBjb25zdCBwcm9maWxlU2NvcGVJZCA9IHRoaXMuX3Byb2ZpbGVyPy5zY29wZUlkKHN1aXRlLCB7XG4gICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgZmlsZVBhdGg6IG93bmVyRmlsZVBhdGgsXG4gICAgICAgIGxpbmU6IHN1aXRlLmxvY2F0aW9uLmxpbmUsXG4gICAgICAgIHBhcmVudElkOiBwYXJlbnRQcm9maWxlU2NvcGVJZFxuICAgICAgfSlcblxuICAgICAgZm9yIChjb25zdCBob29rcyBvZiBPYmplY3QudmFsdWVzKHN1aXRlLmhvb2tzKSkge1xuICAgICAgICBob29rcy5mb3JFYWNoKChob29rLCBkZWNsYXJhdGlvbkluZGV4KSA9PiB7XG4gICAgICAgICAgdGhpcy5faG9va01ldGFkYXRhLnNldChob29rLCB7XG4gICAgICAgICAgICBkZWNsYXJhdGlvbkluZGV4LFxuICAgICAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBwcm9maWxlU2NvcGVJZCxcbiAgICAgICAgICAgIG93bmVyRmlsZVBhdGg6IHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLmdldChob29rKSA/PyBob29rLmxvY2F0aW9uLmZpbGVQYXRoID8/IG93bmVyRmlsZVBhdGhcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHRlc3REZWNsYXJhdGlvbiBvZiBzdWl0ZS50ZXN0cykge1xuICAgICAgICBjb25zdCBmdWxsRGVzY3JpcHRpb24gPSB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlY2xhcmF0aW9uLm5hbWUpXG4gICAgICAgIGNvbnN0IGRlY2xhcmF0aW9ucyA9IHRoaXMuX3Rlc3RzQnlGdWxsTmFtZS5nZXQoZnVsbERlc2NyaXB0aW9uKSB8fCBbXVxuXG4gICAgICAgIGRlY2xhcmF0aW9ucy5wdXNoKHRlc3REZWNsYXJhdGlvbilcbiAgICAgICAgdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLnNldChmdWxsRGVzY3JpcHRpb24sIGRlY2xhcmF0aW9ucylcbiAgICAgICAgdGhpcy5fdGVzdE1ldGFkYXRhLnNldCh0ZXN0RGVjbGFyYXRpb24sIHtcbiAgICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgICAgdGVzdERlc2NyaXB0aW9uOiB0ZXN0RGVjbGFyYXRpb24ubmFtZSxcbiAgICAgICAgICBmdWxsRGVzY3JpcHRpb24sXG4gICAgICAgICAgb3duZXJGaWxlUGF0aDogdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuZ2V0KHRlc3REZWNsYXJhdGlvbikgPz8gdGVzdERlY2xhcmF0aW9uLmxvY2F0aW9uLmZpbGVQYXRoID8/IG93bmVyRmlsZVBhdGgsXG4gICAgICAgICAgc3VpdGVzXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IGxlZ2FjeVRlc3REYXRhID0gdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lPy5nZXQoZnVsbERlc2NyaXB0aW9uKVxuICAgICAgICBpZiAobGVnYWN5VGVzdERhdGEpIHtcbiAgICAgICAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eS5zZXQodGVzdERlY2xhcmF0aW9uLCB7XG4gICAgICAgICAgICB0ZXN0QXJnczogdGhpcy5fdGVzdEFyZ3VtZW50cy5jb3B5KHRlc3REZWNsYXJhdGlvbiksXG4gICAgICAgICAgICB0ZXN0RGF0YTogbGVnYWN5VGVzdERhdGFcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3Rlc3RzQ291bnQrK1xuICAgICAgICBpZiAodGVzdERlY2xhcmF0aW9uLnN0YXRlID09PSBcInJ1blwiICYmICh0ZXN0RGVjbGFyYXRpb24uZm9jdXMgfHwgc3VpdGVzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5mb2N1cykpKSB7XG4gICAgICAgICAgdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgY2hpbGRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIHZpc2l0KGNoaWxkU3VpdGUsIHN1aXRlcywgcHJvZmlsZVNjb3BlSWQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWl0ZSBvZiB0aGlzLmdldFRlc3RDb250ZXh0KCkucmVnaXN0cnkuc3VpdGVzKSB2aXNpdChzdWl0ZSwgW10sIHVuZGVmaW5lZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBhY2thZ2UgaG9vayBjb21wYXRpYmlsaXR5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VIb29rRGVjbGFyYXRpb259IGhvb2sgLSBQYWNrYWdlIGhvb2sgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZGVjbGFyYXRpb25JbmRleDogbnVtYmVyLCBkZWNsYXJhdGlvblNjb3BlSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCwgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBIb29rIG1ldGFkYXRhLlxuICAgKi9cbiAgaG9va01ldGFkYXRhKGhvb2spIHtcbiAgICByZXR1cm4gdGhpcy5faG9va01ldGFkYXRhLmdldChob29rKSB8fCB7ZGVjbGFyYXRpb25JbmRleDogMCwgZGVjbGFyYXRpb25TY29wZUlkOiB1bmRlZmluZWQsIG93bmVyRmlsZVBhdGg6IGhvb2subG9jYXRpb24uZmlsZVBhdGh9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBwYWNrYWdlIHRlc3QgY29tcGF0aWJpbGl0eSBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2Rlc2NyaXB0aW9uczogc3RyaW5nW10sIHRlc3REZXNjcmlwdGlvbjogc3RyaW5nLCBmdWxsRGVzY3JpcHRpb246IHN0cmluZywgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkLCBzdWl0ZXM6IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW119fSAtIERlY2xhcmF0aW9uIG1ldGFkYXRhLlxuICAgKi9cbiAgdGVzdE1ldGFkYXRhKHRlc3QpIHtcbiAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMuX3Rlc3RNZXRhZGF0YS5nZXQodGVzdClcbiAgICBpZiAoIW1ldGFkYXRhKSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcGFja2FnZSB0ZXN0IG1ldGFkYXRhOiAke3Rlc3QubmFtZX1gKVxuICAgIHJldHVybiBtZXRhZGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgc3RhYmxlIGNvbXBhdGliaWxpdHkgZGF0YSBmb3IgYSBwYWNrYWdlIGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7dGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9fSAtIFN0YWJsZSBjb21wYXRpYmlsaXR5IGRhdGEuXG4gICAqL1xuICB0ZXN0RGF0YSh0ZXN0KSB7XG4gICAgbGV0IGNvbXBhdGliaWxpdHkgPSB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eS5nZXQodGVzdClcblxuICAgIGlmICghY29tcGF0aWJpbGl0eSkge1xuICAgICAgY29uc3QgdGVzdEFyZ3MgPSB0aGlzLl90ZXN0QXJndW1lbnRzLmNvcHkodGVzdClcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy50ZXN0TWV0YWRhdGEodGVzdClcbiAgICAgIGNvbnN0IHRlc3REYXRhID0ge1xuICAgICAgICBhcmdzOiB0ZXN0QXJncyxcbiAgICAgICAgZGVjbGFyYXRpb246IHRlc3QsXG4gICAgICAgIGZpbGVQYXRoOiB0ZXN0LmxvY2F0aW9uLmZpbGVQYXRoLFxuICAgICAgICBmdW5jdGlvbjogdGVzdC5jYWxsYmFjayxcbiAgICAgICAgbGluZTogdGVzdC5sb2NhdGlvbi5saW5lLFxuICAgICAgICBvd25lckZpbGVQYXRoOiBtZXRhZGF0YS5vd25lckZpbGVQYXRoXG4gICAgICB9XG4gICAgICBjb21wYXRpYmlsaXR5ID0ge3Rlc3RBcmdzLCB0ZXN0RGF0YX1cbiAgICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5LnNldCh0ZXN0LCBjb21wYXRpYmlsaXR5KVxuICAgIH1cblxuICAgIHJldHVybiBjb21wYXRpYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogSW5qZWN0cyBmcmFtZXdvcmsgY29sbGFib3JhdG9ycyBpbnRvIHN0YWJsZSBjb21wYXRpYmlsaXR5IGRhdGEgb25jZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7dGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9Pn0gLSBJbmplY3RlZCBjb21wYXRpYmlsaXR5IGRhdGEuXG4gICAqL1xuICBhc3luYyB0ZXN0Q29tcGF0aWJpbGl0eSh0ZXN0KSB7XG4gICAgY29uc3QgY29tcGF0aWJpbGl0eSA9IHRoaXMudGVzdERhdGEodGVzdClcblxuICAgIGlmICghdGhpcy5faW5qZWN0ZWRUZXN0cy5oYXModGVzdCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3Rlc3RBcmd1bWVudHMuaW5qZWN0KGNvbXBhdGliaWxpdHkudGVzdEFyZ3MpXG4gICAgICB0aGlzLl9pbmplY3RlZFRlc3RzLmFkZCh0ZXN0KVxuICAgIH1cblxuICAgIHJldHVybiBjb21wYXRpYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHJhdyBmcmFtZXdvcmsgYXR0ZW1wdCBvdXRjb21lLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgKiBAcGFyYW0ge3thYm9ydFJlbWFpbmluZ1Rlc3RzOiBib29sZWFuLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGZhaWxlZDogYm9vbGVhbn19IG91dGNvbWUgLSBSYXcgYXR0ZW1wdCBvdXRjb21lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEF0dGVtcHRPdXRjb21lKHRlc3QsIGF0dGVtcHROdW1iZXIsIG91dGNvbWUpIHtcbiAgICBjb25zdCBvdXRjb21lcyA9IHRoaXMuX2F0dGVtcHRPdXRjb21lcy5nZXQodGVzdCkgfHwgbmV3IE1hcCgpXG4gICAgb3V0Y29tZXMuc2V0KGF0dGVtcHROdW1iZXIsIG91dGNvbWUpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzLnNldCh0ZXN0LCBvdXRjb21lcylcbiAgICBpZiAob3V0Y29tZS5hYm9ydFJlbWFpbmluZ1Rlc3RzKSB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgYSByYXcgZnJhbWV3b3JrIGF0dGVtcHQgb3V0Y29tZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXR0ZW1wdE51bWJlciAtIE9uZS1iYXNlZCBhdHRlbXB0IG51bWJlci5cbiAgICogQHJldHVybnMge3thYm9ydFJlbWFpbmluZ1Rlc3RzOiBib29sZWFuLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGZhaWxlZDogYm9vbGVhbn0gfCB1bmRlZmluZWR9IC0gUmF3IGF0dGVtcHQgb3V0Y29tZS5cbiAgICovXG4gIGF0dGVtcHRPdXRjb21lKHRlc3QsIGF0dGVtcHROdW1iZXIpIHsgcmV0dXJuIHRoaXMuX2F0dGVtcHRPdXRjb21lcy5nZXQodGVzdCk/LmdldChhdHRlbXB0TnVtYmVyKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSByYXcgc3VpdGUtaG9vayBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gZmFpbHVyZSAtIFN1aXRlLWhvb2sgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gZmFpbHVyZS5zdWl0ZSAtIE93bmluZyBwYWNrYWdlIHN1aXRlLlxuICAgKiBAcGFyYW0ge1wiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCJ9IGZhaWx1cmUucGhhc2UgLSBIb29rIHBoYXNlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBmYWlsdXJlLmVycm9yIC0gUmF3IGhvb2sgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRTdWl0ZUhvb2tGYWlsdXJlKGZhaWx1cmUpIHsgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMucHVzaChmYWlsdXJlKSB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHJhdyBhbmNlc3RvciBzZXR1cCBmYWlsdXJlIG91dGNvbWUgZm9yIGEgcGFja2FnZSB0ZXN0LlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZmFpbGVkOiBmYWxzZX0gfCB7ZmFpbGVkOiB0cnVlLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAtIFJhdyBzZXR1cCBmYWlsdXJlIG91dGNvbWUuXG4gICAqL1xuICBzZXR1cEZhaWx1cmVPdXRjb21lRm9yKHRlc3QpIHtcbiAgICBjb25zdCBzdWl0ZXMgPSB0aGlzLnRlc3RNZXRhZGF0YSh0ZXN0KS5zdWl0ZXNcbiAgICBjb25zdCBmYWlsdXJlID0gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuZmluZCgoZW50cnkpID0+IGVudHJ5LnBoYXNlID09PSBcImJlZm9yZUFsbFwiICYmIHN1aXRlcy5pbmNsdWRlcyhlbnRyeS5zdWl0ZSkpXG5cbiAgICByZXR1cm4gZmFpbHVyZSA/IHtmYWlsZWQ6IHRydWUsIGVycm9yOiBmYWlsdXJlLmVycm9yfSA6IHtmYWlsZWQ6IGZhbHNlfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGluY29tcGxldGUgZGVjbGFyYXRpb24gd2l0aCBhIHBhY2thZ2UgZnVsbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZnVsbE5hbWUgLSBQYWNrYWdlIGZ1bGwgbmFtZS5cbiAgICogQHJldHVybnMge1BhY2thZ2VUZXN0RGVjbGFyYXRpb24gfCB1bmRlZmluZWR9IC0gTmV4dCBtYXRjaGluZyBkZWNsYXJhdGlvbi5cbiAgICovXG4gIGZpbmRUZXN0RGVjbGFyYXRpb24oZnVsbE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLmdldChmdWxsTmFtZSk/LmZpbmQoKHRlc3QpID0+ICF0aGlzLl9jb21wbGV0ZWRUZXN0cy5oYXModGVzdCkpXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwYWNrYWdlIGRlY2xhcmF0aW9uIGNvbXBsZXRlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBDb21wbGV0ZWQgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29tcGxldGVUZXN0RGVjbGFyYXRpb24odGVzdCkgeyB0aGlzLl9jb21wbGV0ZWRUZXN0cy5hZGQodGVzdCkgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBlZmZlY3RpdmUgcGFja2FnZSByZXRyeSBjb3VudC5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEVmZmVjdGl2ZSByZXRyeSBjb3VudC5cbiAgICovXG4gIHJldHJ5Q291bnQodGVzdCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGVzdC5vcHRpb25zLnJldHJpZXMgPz8gdGVzdC5vcHRpb25zLnJldHJ5ID8/IHRoaXMuZ2V0VGVzdENvbnRleHQoKS5jb25maWcucmV0cmllc1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSA/IE1hdGgubWF4KDAsIE1hdGguZmxvb3IodmFsdWUpKSA6IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHJldHJ5IGlucHV0cyBmb3IgdGhlIHBhY2thZ2UgZXhlY3V0aW9uIGJvdW5kYXJ5IHdoaWxlIHJldGFpbmluZ1xuICAgKiB0aGUgZGVjbGFyYXRpb25zJyBvcmlnaW5hbCBwdWJsaWMgb3B0aW9ucyBhZnRlciB0aGUgcnVuLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBSZXN0b3JlcyBvcmlnaW5hbCBkZWNsYXJhdGlvbiBvcHRpb25zLlxuICAgKi9cbiAgbm9ybWFsaXplUGFja2FnZVJldHJpZXNGb3JFeGVjdXRpb24oKSB7XG4gICAgLyoqIEB0eXBlIHtQYWNrYWdlUmV0cnlPcHRpb25SZXN0b3JhdGlvbltdfSAqL1xuICAgIGNvbnN0IHJlc3RvcmF0aW9ucyA9IFtdXG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplcyBkZWNsYXJhdGlvbnMgaW4gb25lIHN1aXRlLlxuICAgICAqIEBwYXJhbSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259IHN1aXRlIC0gU3VpdGUgd2hvc2UgdGVzdHMgYXJlIG5vcm1hbGl6ZWQuXG4gICAgICovXG4gICAgY29uc3QgdmlzaXQgPSAoc3VpdGUpID0+IHtcbiAgICAgIGZvciAoY29uc3QgdGVzdCBvZiBzdWl0ZS50ZXN0cykge1xuICAgICAgICAvLyBDYXB0dXJlIGNvbXBhdGliaWxpdHkgYXJndW1lbnRzIGJlZm9yZSB0ZW1wb3JhcmlseSBhZGFwdGluZyBwYWNrYWdlXG4gICAgICAgIC8vIGV4ZWN1dGlvbiBvcHRpb25zIHNvIGNhbGxiYWNrcyByZXRhaW4gdGhlaXIgZGVjbGFyZWQgdmFsdWVzL2lkZW50aXR5LlxuICAgICAgICB0aGlzLnRlc3REYXRhKHRlc3QpXG4gICAgICAgIHJlc3RvcmF0aW9ucy5wdXNoKHtcbiAgICAgICAgICBoYWRSZXRyaWVzOiBPYmplY3QuaGFzT3duKHRlc3Qub3B0aW9ucywgXCJyZXRyaWVzXCIpLFxuICAgICAgICAgIG9wdGlvbnM6IHRlc3Qub3B0aW9ucyxcbiAgICAgICAgICByZXRyaWVzOiB0ZXN0Lm9wdGlvbnMucmV0cmllc1xuICAgICAgICB9KVxuICAgICAgICB0ZXN0Lm9wdGlvbnMucmV0cmllcyA9IHRoaXMucmV0cnlDb3VudCh0ZXN0KVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGNoaWxkU3VpdGUgb2Ygc3VpdGUuc3VpdGVzKSB2aXNpdChjaGlsZFN1aXRlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3VpdGUgb2YgdGhpcy5nZXRUZXN0Q29udGV4dCgpLnJlZ2lzdHJ5LnN1aXRlcykgdmlzaXQoc3VpdGUpXG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCByZXN0b3JhdGlvbiBvZiByZXN0b3JhdGlvbnMpIHtcbiAgICAgICAgaWYgKHJlc3RvcmF0aW9uLmhhZFJldHJpZXMpIHJlc3RvcmF0aW9uLm9wdGlvbnMucmV0cmllcyA9IHJlc3RvcmF0aW9uLnJldHJpZXNcbiAgICAgICAgZWxzZSBkZWxldGUgcmVzdG9yYXRpb24ub3B0aW9ucy5yZXRyaWVzXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGNvbXBsZXRlZCB0ZXN0IGR1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3tkdXJhdGlvbk1zOiBudW1iZXIsIGZpbGVQYXRoOiBzdHJpbmcsIGZ1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBsaW5lOiBudW1iZXJ9fSBkdXJhdGlvbiAtIENvbXBsZXRlZCB0ZXN0IGR1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFRlc3REdXJhdGlvbihkdXJhdGlvbikgeyB0aGlzLl90ZXN0RHVyYXRpb25zLnB1c2goZHVyYXRpb24pIH1cblxuICAvKiogUmVjb3JkcyBvbmUgc3VjY2Vzc2Z1bCBwYWNrYWdlIHJlc3VsdC4gKi9cbiAgcmVjb3JkU3VjY2Vzc2Z1bFRlc3QoKSB7IHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cysrIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgZmFpbGVkIHBhY2thZ2UgdGVzdCBpbiB0aGUgbGVnYWN5IHJlc3VsdCBwcm9qZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWxlZCB0ZXN0IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIFBhcmVudCBkZXNjcmlwdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBSYXcgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29uc29sZU91dHB1dCAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gQ29tcGF0aWJpbGl0eSB0ZXN0IGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkRmFpbGVkVGVzdCh7ZGVzY3JpcHRpb25zLCBlcnJvciwgY29uc29sZU91dHB1dCwgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbn0pIHtcbiAgICB0aGlzLl9mYWlsZWRUZXN0cysrXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pLFxuICAgICAgZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoLFxuICAgICAgbGluZTogdGVzdERhdGEubGluZSxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogY29uc29sZU91dHB1dCB8fCB1bmRlZmluZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3JlcyB0aGUgY29tcGxldGVkIHBhY2thZ2UgcmVzdWx0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuVGVzdFJ1blJlc3VsdH0gcmVzdWx0IC0gUGFja2FnZSByZXN1bHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkUGFja2FnZVJlc3VsdChyZXN1bHQpIHsgdGhpcy5fcGFja2FnZVJlc3VsdCA9IHJlc3VsdCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHBhY2thZ2Uga2VybmVsIHdpdGggVmVsb2Npb3VzIGZyYW1ld29yayBhZGFwdGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXhlY3V0aW9uIGFuZCB0ZWFyZG93bi5cbiAgICovXG4gIGFzeW5jIHJ1blBhY2thZ2VUZXN0cygpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIGVudmlyb25tZW50SGFuZGxlci5pbnN0YWxsU2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSh0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlKVxuICAgIGVudmlyb25tZW50SGFuZGxlci5pbnN0YWxsVGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSlcbiAgICB0aGlzLl9wYWNrYWdlUnVubmVyID0gbmV3IFBhY2thZ2VUZXN0UnVubmVyKHtcbiAgICAgIGNvbnRleHQ6IHRoaXMuZ2V0VGVzdENvbnRleHQoKSxcbiAgICAgIGluY2x1ZGVUYWdzOiB0aGlzLl9pbmNsdWRlVGFncyxcbiAgICAgIGV4Y2x1ZGVUYWdzOiBbLi4udGhpcy5nZXRFeGNsdWRlVGFnU2V0KCksIC4uLih0aGlzLmlzQnJvd3NlclRlc3RNb2RlKCkgPyBbXSA6IFtcImJyb3dzZXItb25seVwiXSldLFxuICAgICAgZXhhbXBsZXM6IHRoaXMuZ2V0RXhhbXBsZVBhdHRlcm5zKCksXG4gICAgICBsaW5lRmlsdGVyczogdGhpcy5nZXRMaW5lRmlsdGVycygpLFxuICAgICAgaW5jbHVkZVRhZ01vZGU6IFwiYW55XCIsXG4gICAgICBmb2N1c2VkVGVzdHNCeXBhc3NJbmNsdWRlVGFnczogdHJ1ZSxcbiAgICAgIG9taXRFbXB0eVN1aXRlTmFtZXM6IHRydWUsXG4gICAgICBhdHRlbXB0RXhlY3V0b3JPd25zVGltZW91dDogdHJ1ZSxcbiAgICAgIGF0dGVtcHRFeGVjdXRvcjogKGlucHV0KSA9PiB0aGlzLl9hdHRlbXB0RXhlY3V0b3IuZXhlY3V0ZShpbnB1dCksXG4gICAgICB0ZXN0QXJndW1lbnRSZXNvbHZlcjogKGlucHV0KSA9PiB0aGlzLl90ZXN0QXJndW1lbnRzLnJlc29sdmUoaW5wdXQpLFxuICAgICAgc3VpdGVIb29rRXhlY3V0b3I6IChpbnB1dCkgPT4gdGhpcy5fc3VpdGVIb29rRXhlY3V0b3IuZXhlY3V0ZShpbnB1dCksXG4gICAgICByZXBvcnRlcjogdGhpcy5fcnVubmVyUmVwb3J0ZXJcbiAgICB9KVxuICAgIGNvbnN0IGZhaWx1cmVTdGFydCA9IHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLmxlbmd0aFxuICAgIGNvbnN0IHJlc3RvcmVSZXRyeU9wdGlvbnMgPSB0aGlzLm5vcm1hbGl6ZVBhY2thZ2VSZXRyaWVzRm9yRXhlY3V0aW9uKClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICB0cnkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5fcGFja2FnZVJ1bm5lci5ydW4oKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IpKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIGNvbnN0IGFmdGVyQWxsID0gdGhpcy5hZnRlckFsbE91dGNvbWUodGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuc2xpY2UoZmFpbHVyZVN0YXJ0KSlcbiAgICAgICAgaWYgKGFmdGVyQWxsLmZhaWxlZCkgdGhpcy5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoYWZ0ZXJBbGwuZXJyb3IsIFwiYWZ0ZXJBbGxcIilcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRoaXMucmVjb3JkUGFja2FnZVJlc3VsdChyZXN1bHQpXG4gICAgICB0aGlzLnRocm93QWZ0ZXJBbGxGYWlsdXJlcyh0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5zbGljZShmYWlsdXJlU3RhcnQpKVxuICAgIH0gZmluYWxseSB7XG4gICAgICByZXN0b3JlUmV0cnlPcHRpb25zKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWdncmVnYXRlcyByYXcgYWZ0ZXItYWxsIGZhaWx1cmVzIHdpdGhvdXQgdXNpbmcgZXJyb3IgdHJ1dGhpbmVzcy5cbiAgICogQHBhcmFtIHtBcnJheTx7cGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSBmYWlsdXJlcyAtIEhvb2sgZmFpbHVyZXMuXG4gICAqIEByZXR1cm5zIHt7ZmFpbGVkOiBmYWxzZX0gfCB7ZmFpbGVkOiB0cnVlLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAtIEV4cGxpY2l0IGFmdGVyQWxsIG91dGNvbWUuXG4gICAqL1xuICBhZnRlckFsbE91dGNvbWUoZmFpbHVyZXMpIHtcbiAgICBjb25zdCBhZnRlckFsbEVycm9ycyA9IGZhaWx1cmVzLmZpbHRlcigoZmFpbHVyZSkgPT4gZmFpbHVyZS5waGFzZSA9PT0gXCJhZnRlckFsbFwiKS5tYXAoKGZhaWx1cmUpID0+IGZhaWx1cmUuZXJyb3IpXG5cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID09PSAwKSByZXR1cm4ge2ZhaWxlZDogZmFsc2V9XG4gICAgaWYgKGFmdGVyQWxsRXJyb3JzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHtmYWlsZWQ6IHRydWUsIGVycm9yOiBhZnRlckFsbEVycm9yc1swXX1cbiAgICByZXR1cm4ge1xuICAgICAgZmFpbGVkOiB0cnVlLFxuICAgICAgZXJyb3I6IG5ldyBBZ2dyZWdhdGVFcnJvcihhZnRlckFsbEVycm9ycywgXCJNdWx0aXBsZSBhY3RpdmUgYWZ0ZXJBbGwgc2NvcGVzIGZhaWxlZFwiLCB7Y2F1c2U6IGFmdGVyQWxsRXJyb3JzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhyb3dzIG9uZSByYXcgb3IgYWdncmVnYXRlZCBhZnRlci1hbGwgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtBcnJheTx7cGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSBmYWlsdXJlcyAtIEhvb2sgZmFpbHVyZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgdGhyb3dBZnRlckFsbEZhaWx1cmVzKGZhaWx1cmVzKSB7XG4gICAgY29uc3QgYWZ0ZXJBbGwgPSB0aGlzLmFmdGVyQWxsT3V0Y29tZShmYWlsdXJlcylcblxuICAgIGlmIChhZnRlckFsbC5mYWlsZWQpIHRocm93IGFmdGVyQWxsLmVycm9yXG4gIH1cblxuICAvKipcbiAgICogQ29tcGF0aWJpbGl0eSBoZWxwZXIgZm9yIGZvY3VzZWQgZnJhbWV3b3JrIGxpZmVjeWNsZSBzcGVjcy4gSXQgY29udmVydHMgYW5cbiAgICogZXhwbGljaXQgbGVnYWN5IGZpeHR1cmUgaW50byBpc29sYXRlZCBwYWNrYWdlIGRlY2xhcmF0aW9uczsgdGhlIHBhY2thZ2VcbiAgICogcnVubmVyIHJlbWFpbnMgdGhlIHNvbGUgZXhlY3V0aW9uIGVuZ2luZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMZWdhY3kgZml4dHVyZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7VGVzdHNBcmd1bWVudH0gYXJncy50ZXN0cyAtIEZpeHR1cmUgdHJlZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGFja2FnZSBleGVjdXRpb24uXG4gICAqL1xuICBhc3luYyBydW5UZXN0cyh7dGVzdHN9KSB7XG4gICAgY29uc3QgY29udGV4dCA9IGNyZWF0ZVRlc3RDb250ZXh0KClcbiAgICBjb25zdCBvcmlnaW5hbENvbnRleHQgPSB0aGlzLl9jb250ZXh0XG4gICAgY29udGV4dC5jb25maWd1cmVUZXN0cyh7XG4gICAgICBjb25zb2xlT3V0cHV0OiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmNvbnNvbGVPdXRwdXQsXG4gICAgICBkZWZhdWx0VGltZW91dE1zOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgICBleGNsdWRlVGFnczogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5leGNsdWRlVGFncyxcbiAgICAgIGZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lczogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5mYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMsXG4gICAgICByZXRyaWVzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLnJldHJpZXNcbiAgICB9KVxuICAgIHRoaXMuX2NvbnRleHQgPSBjb250ZXh0XG4gICAgdGhpcy5fdGVzdHNDb3VudCA9IDBcbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2NvbXBsZXRlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX3Rlc3RNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICBjb250ZXh0LnNldERlY2xhcmF0aW9uTG9jYXRvcigoKSA9PiB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24pXG4gICAgdGhpcy5kZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBcIlwiLCB0ZXN0cywgW10pXG4gICAgdGhpcy5hbmFseXplRGVjbGFyYXRpb25zKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blBhY2thZ2VUZXN0cygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2NvbnRleHQgPSBvcmlnaW5hbENvbnRleHRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYW4gaXNvbGF0ZWQgbGVnYWN5LXNoYXBlZCB0ZXN0IGZpeHR1cmUgaW50byBhIHBhY2thZ2UgY29udGV4dC5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdENvbnRleHR9IGNvbnRleHQgLSBJc29sYXRlZCBwYWNrYWdlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gU3VpdGUgbmFtZS5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBzY29wZSAtIExlZ2FjeSBmaXh0dXJlIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBBbmNlc3RvciBkZXNjcmlwdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZGVjbGFyZUxlZ2FjeUZpeHR1cmUoY29udGV4dCwgbmFtZSwgc2NvcGUsIGRlc2NyaXB0aW9ucykge1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbiA9IHtmaWxlUGF0aDogc2NvcGUuZmlsZVBhdGgsIGxpbmU6IHNjb3BlLmxpbmV9XG4gICAgY29udGV4dC5kZXNjcmliZShuYW1lLCBzY29wZS5hcmdzIHx8IHt9LCAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYmVmb3JlQWxscyB8fCBbXSkgY29udGV4dC5iZWZvcmVBbGwoaG9vay5jYWxsYmFjaylcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBzY29wZS5iZWZvcmVFYWNoZXMgfHwgW10pIGNvbnRleHQuYmVmb3JlRWFjaChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmFmdGVyRWFjaGVzIHx8IFtdKSBjb250ZXh0LmFmdGVyRWFjaChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmFmdGVyQWxscyB8fCBbXSkgY29udGV4dC5hZnRlckFsbChob29rLmNhbGxiYWNrKVxuICAgICAgY29uc3QgbmV4dERlc2NyaXB0aW9ucyA9IG5hbWUgPT09IFwiXCIgPyBkZXNjcmlwdGlvbnMgOiBbLi4uZGVzY3JpcHRpb25zLCBuYW1lXVxuICAgICAgZm9yIChjb25zdCBbdGVzdE5hbWUsIHRlc3REYXRhXSBvZiBPYmplY3QuZW50cmllcyhzY29wZS50ZXN0cyB8fCB7fSkpIHtcbiAgICAgICAgdGhpcy5fbGVnYWN5Rml4dHVyZUxvY2F0aW9uID0ge2ZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCwgbGluZTogdGVzdERhdGEubGluZX1cbiAgICAgICAgdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lPy5zZXQodGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihuZXh0RGVzY3JpcHRpb25zLCB0ZXN0TmFtZSksIHRlc3REYXRhKVxuICAgICAgICBjb250ZXh0Lml0KHRlc3ROYW1lLCB0ZXN0RGF0YS5hcmdzLCB0ZXN0RGF0YS5mdW5jdGlvbilcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgW3N1aXRlTmFtZSwgY2hpbGRTY29wZV0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGUuc3VicyB8fCB7fSkpIHtcbiAgICAgICAgdGhpcy5kZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBzdWl0ZU5hbWUsIGNoaWxkU2NvcGUsIG5leHREZXNjcmlwdGlvbnMpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVtaXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudE5hbWUgLSBFdmVudCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gcGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGxpc3RlbmVycyBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5uZXJSZXBvcnRlci5lbWl0RXZlbnQoZXZlbnROYW1lLCBwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbnQgcmVydW4gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBMZWZ0IHBhZGRpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHByaW50UmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGEsIGxlZnRQYWRkaW5nfSkge1xuICAgIGNvbnN0IHJlcnVuID0gdGhpcy5idWlsZFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhfSlcblxuICAgIGlmIChyZXJ1bikge1xuICAgICAgY29uc29sZS5lcnJvcihgJHtsZWZ0UGFkZGluZ30gIFJlLXJ1bjogJHtyZXJ1bn1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIHJlcnVuIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IGRhdGEuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gUmVydW4gY29tbWFuZC5cbiAgICovXG4gIGJ1aWxkUmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGF9KSB7XG4gICAgY29uc3QgYmFzZUNvbW1hbmQgPSBcIm5weCB2ZWxvY2lvdXMgdGVzdFwiXG4gICAgY29uc3QgZmlsZVBhdGggPSB0ZXN0RGF0YS5maWxlUGF0aFxuICAgIGNvbnN0IGxpbmUgPSB0ZXN0RGF0YS5saW5lXG5cbiAgICBpZiAoZmlsZVBhdGggJiYgbGluZSkge1xuICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcGF0aC5yZWxhdGl2ZShwcm9jZXNzLmN3ZCgpLCBmaWxlUGF0aClcbiAgICAgIHJldHVybiBgJHtiYXNlQ29tbWFuZH0gJHtyZWxhdGl2ZVBhdGh9OiR7bGluZX1gXG4gICAgfVxuXG4gICAgY29uc3QgZnVsbERlc2NyaXB0aW9uID0gdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbilcblxuICAgIGlmIChmdWxsRGVzY3JpcHRpb24pIHtcbiAgICAgIHJldHVybiBgJHtiYXNlQ29tbWFuZH0gLS1leGFtcGxlICR7SlNPTi5zdHJpbmdpZnkoZnVsbERlc2NyaXB0aW9uKX1gXG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7QXR0ZW1wdENvbnNvbGVPdXRwdXRbXX0gYXR0ZW1wdENvbnNvbGVPdXRwdXRzIC0gQXR0ZW1wdCBvdXRwdXQgZW50cmllcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb21iaW5lZCBjb25zb2xlIG91dHB1dC5cbiAgICovXG4gIGJ1aWxkQ29uc29sZU91dHB1dChhdHRlbXB0Q29uc29sZU91dHB1dHMpIHtcbiAgICBpZiAoYXR0ZW1wdENvbnNvbGVPdXRwdXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCJcbiAgICBpZiAoYXR0ZW1wdENvbnNvbGVPdXRwdXRzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIGF0dGVtcHRDb25zb2xlT3V0cHV0c1swXS5vdXRwdXRcblxuICAgIHJldHVybiBhdHRlbXB0Q29uc29sZU91dHB1dHMubWFwKChhdHRlbXB0Q29uc29sZU91dHB1dCkgPT4ge1xuICAgICAgcmV0dXJuIGAtLS0gQXR0ZW1wdCAke2F0dGVtcHRDb25zb2xlT3V0cHV0LmF0dGVtcHROdW1iZXJ9IC0tLVxcbiR7YXR0ZW1wdENvbnNvbGVPdXRwdXQub3V0cHV0fWBcbiAgICB9KS5qb2luKFwiXFxuXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmFpbGVkIGNvbnNvbGUgb3V0cHV0IG1heCBsaW5lcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIGZhaWxlZCBjb25zb2xlIGxpbmVzLlxuICAgKi9cbiAgZ2V0RmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzKCkge1xuICAgIGNvbnN0IG1heExpbmVzID0gdGVzdENvbmZpZy5mYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXNcblxuICAgIGlmICh0eXBlb2YgbWF4TGluZXMgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZShtYXhMaW5lcykpIHJldHVybiAyMDBcblxuICAgIHJldHVybiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKG1heExpbmVzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRydW5jYXRlIGZhaWxlZCBjb25zb2xlIG91dHB1dCBsaW5lcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIExpbmVzIGZvciBpbmxpbmUgb3V0cHV0LlxuICAgKi9cbiAgdHJ1bmNhdGVGYWlsZWRDb25zb2xlT3V0cHV0TGluZXMoY29uc29sZU91dHB1dCkge1xuICAgIGNvbnN0IGxpbmVzID0gY29uc29sZU91dHB1dC5zcGxpdChcIlxcblwiKVxuICAgIGNvbnN0IG1heExpbmVzID0gdGhpcy5nZXRGYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMoKVxuXG4gICAgaWYgKG1heExpbmVzID09PSAwKSByZXR1cm4gW11cbiAgICBpZiAobGluZXMubGVuZ3RoIDw9IG1heExpbmVzKSByZXR1cm4gbGluZXNcblxuICAgIGNvbnN0IG9taXR0ZWRMaW5lcyA9IGxpbmVzLmxlbmd0aCAtIG1heExpbmVzXG4gICAgY29uc3QgcGx1cmFsID0gb21pdHRlZExpbmVzID09PSAxID8gXCJcIiA6IFwic1wiXG5cbiAgICByZXR1cm4gW1xuICAgICAgYC4uLiAke29taXR0ZWRMaW5lc30gY29uc29sZSBvdXRwdXQgbGluZSR7cGx1cmFsfSBvbWl0dGVkIC4uLmAsXG4gICAgICAuLi5saW5lcy5zbGljZSgtbWF4TGluZXMpXG4gICAgXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbnQgZmFpbGVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb25zb2xlT3V0cHV0IC0gQ29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxlZnRQYWRkaW5nIC0gTGVmdCBwYWRkaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwcmludEZhaWxlZENvbnNvbGVPdXRwdXQoe2NvbnNvbGVPdXRwdXQsIGxlZnRQYWRkaW5nfSkge1xuICAgIGlmICh0ZXN0Q29uZmlnLmNvbnNvbGVPdXRwdXQgIT09IFwiZmFpbHVyZVwiKSByZXR1cm5cbiAgICBpZiAoIWNvbnNvbGVPdXRwdXQpIHJldHVyblxuXG4gICAgY29uc3QgbGluZXMgPSB0aGlzLnRydW5jYXRlRmFpbGVkQ29uc29sZU91dHB1dExpbmVzKGNvbnNvbGVPdXRwdXQpXG5cbiAgICBpZiAobGluZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICBDb25zb2xlIG91dHB1dDpgKSlcblxuICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gICAgJHtsaW5lfWApKVxuICAgIH1cbiAgfVxuXG59XG4iXX0=