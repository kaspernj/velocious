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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sRUFBQyxpQkFBaUIsRUFBRSxrQkFBa0IsRUFBQyxNQUFNLG9CQUFvQixDQUFBO0FBQ3hFLE9BQU8sRUFBQyxVQUFVLElBQUksaUJBQWlCLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RSxPQUFPLFdBQVcsTUFBTSwwQkFBMEIsQ0FBQTtBQUNsRCxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFDLFVBQVUsRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUNwQyxPQUFPLEVBQUMsYUFBYSxFQUFFLGFBQWEsRUFBQyxNQUFNLEtBQUssQ0FBQTtBQUNoRCxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3BGLE9BQU8sd0JBQXdCLE1BQU0saUNBQWlDLENBQUE7QUFDdEUsT0FBTyx1QkFBdUIsRUFBRSxFQUFDLHdCQUF3QixFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFDaEcsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLHNCQUFzQixNQUFNLCtCQUErQixDQUFBO0FBRWxFLDhEQUE4RDtBQUM5RCw2RkFBNkY7QUFDN0YsaUZBQWlGO0FBQ2pGLDhGQUE4RjtBQUM5RiwrR0FBK0c7QUFDL0csOElBQThJO0FB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NUMsTUFBTSxNQUFNLEdBQUcsWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUE7UUFFNUMsT0FBTztZQUNMLE9BQU8sWUFBWSx1QkFBdUIsTUFBTSxjQUFjO1lBQzlELEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLFFBQVEsQ0FBQztTQUMxQixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHdCQUF3QixDQUFDLEVBQUMsYUFBYSxFQUFFLFdBQVcsRUFBQztRQUNuRCxJQUFJLFVBQVUsQ0FBQyxhQUFhLEtBQUssU0FBUztZQUFFLE9BQU07UUFDbEQsSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFNO1FBRTFCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUVsRSxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU07UUFFOUIsT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsV0FBVyxtQkFBbUIsQ0FBQyxDQUFDLENBQUE7UUFFaEUsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUN6QixPQUFPLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsR0FBRyxXQUFXLE9BQU8sSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFBO1FBQzVELENBQUM7SUFDSCxDQUFDO0NBRUYiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCJcbmltcG9ydCB7QXN5bmNMb2NhbFN0b3JhZ2V9IGZyb20gXCJub2RlOmFzeW5jX2hvb2tzXCJcbmltcG9ydCB7Y3JlYXRlVGVzdENvbnRleHQsIGRlZmF1bHRUZXN0Q29udGV4dH0gZnJvbSBcIkB2ZWxvY2lvdXMvdGVzdGluZ1wiXG5pbXBvcnQge1Rlc3RSdW5uZXIgYXMgUGFja2FnZVRlc3RSdW5uZXJ9IGZyb20gXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCJcbmltcG9ydCBBcHBsaWNhdGlvbiBmcm9tIFwiLi4vLi4vc3JjL2FwcGxpY2F0aW9uLmpzXCJcbmltcG9ydCBSZXF1ZXN0Q2xpZW50IGZyb20gXCIuL3JlcXVlc3QtY2xpZW50LmpzXCJcbmltcG9ydCBwaWNvY29sb3JzIGZyb20gXCJwaWNvY29sb3JzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHt0ZXN0Q29uZmlnfSBmcm9tIFwiLi90ZXN0LmpzXCJcbmltcG9ydCB7ZmlsZVVSTFRvUGF0aCwgcGF0aFRvRmlsZVVSTH0gZnJvbSBcInVybFwiXG5pbXBvcnQgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIgZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLWJyb2tlci5qc1wiXG5pbXBvcnQgeyBTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOViB9IGZyb20gXCIuL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c0F0dGVtcHRFeGVjdXRvciBmcm9tIFwiLi92ZWxvY2lvdXMtYXR0ZW1wdC1leGVjdXRvci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzUnVubmVyUmVwb3J0ZXIsIHtBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3J9IGZyb20gXCIuL3ZlbG9jaW91cy1ydW5uZXItcmVwb3J0ZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c1N1aXRlSG9va0V4ZWN1dG9yIGZyb20gXCIuL3ZlbG9jaW91cy1zdWl0ZS1ob29rLWV4ZWN1dG9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNUZXN0QXJndW1lbnRzIGZyb20gXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7dHlwZW9mIGRlZmF1bHRUZXN0Q29udGV4dH0gUGFja2FnZVRlc3RDb250ZXh0ICovXG4vKiogQHR5cGVkZWYgeyh0eXBlb2YgZGVmYXVsdFRlc3RDb250ZXh0LnJlZ2lzdHJ5LnN1aXRlcylbbnVtYmVyXX0gUGFja2FnZVN1aXRlRGVjbGFyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXCJ0ZXN0c1wiXVtudW1iZXJdfSBQYWNrYWdlVGVzdERlY2xhcmF0aW9uICovXG4vKiogQHR5cGVkZWYge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW1wiaG9va3NcIl1bXCJiZWZvcmVBbGxcIl1bbnVtYmVyXX0gUGFja2FnZUhvb2tEZWNsYXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbiB8IFBhY2thZ2VUZXN0RGVjbGFyYXRpb24gfCBQYWNrYWdlSG9va0RlY2xhcmF0aW9ufSBQYWNrYWdlUmVnaXN0cmF0aW9uICovXG4vKiogQHR5cGVkZWYge3toYWRSZXRyaWVzOiBib29sZWFuLCBvcHRpb25zOiBQYWNrYWdlVGVzdERlY2xhcmF0aW9uW1wib3B0aW9uc1wiXSwgcmV0cmllczogbnVtYmVyIHwgdW5kZWZpbmVkfX0gUGFja2FnZVJldHJ5T3B0aW9uUmVzdG9yYXRpb24gKi9cblxuLyoqXG4gKiBBdHRlbXB0Q29uc29sZU91dHB1dCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQXR0ZW1wdENvbnNvbGVPdXRwdXRcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gQXR0ZW1wdCBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gb3V0cHV0IC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQuXG4gKi9cbi8qKlxuICogVGVzdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RBcmdzXG4gKiBAcHJvcGVydHkge0FwcGxpY2F0aW9ufSBbYXBwbGljYXRpb25dIC0gQXBwbGljYXRpb24gaW5zdGFuY2UgZm9yIGludGVncmF0aW9uIHRlc3RzLlxuICogQHByb3BlcnR5IHtSZXF1ZXN0Q2xpZW50fSBbY2xpZW50XSAtIEhUVFAgY2xpZW50IGZvciByZXF1ZXN0IHRlc3RzLlxuICogQHByb3BlcnR5IHtvYmplY3R9IFtkYXRhYmFzZUNsZWFuaW5nXSAtIERhdGFiYXNlIGNsZWFudXAgb3B0aW9ucyBmb3IgdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRyYW5zYWN0aW9uXSAtIFVzZSB0cmFuc2FjdGlvbnMgdG8gcm9sbGJhY2sgYmV0d2VlbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJ1bmNhdGVdIC0gVHJ1bmNhdGUgdGFibGVzIGJldHdlZW4gdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRydW5jYXRlQmVmb3JlXSAtIFRydW5jYXRlIHRhYmxlcyBiZWZvcmUgZWFjaCB0ZXN0LCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdCBjbGVhbnVwLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZm9jdXNdIC0gV2hldGhlciB0aGlzIHRlc3QgaXMgZm9jdXNlZC5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IFtmdW5jdGlvbl0gLSBUZXN0IGNhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtyZXRyeV0gLSBOdW1iZXIgb2YgcmV0cmllcyB3aGVuIGEgdGVzdCBmYWlscy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW10gfCBzdHJpbmd9IFt0YWdzXSAtIFRhZ3MgZm9yIGZpbHRlcmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dFNlY29uZHNdIC0gVGltZW91dCBpbiBzZWNvbmRzIGZvciB0aGUgdGVzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBUZXN0IHR5cGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgdGVuYW50OiBvYmplY3R9KSA9PiBQcm9taXNlPHZvaWQ+fSBbcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50XSAtIFJlZ2lzdGVycyBvbmUgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIHRyYW5zYWN0aW9uIGZvciB0aGlzIGF0dGVtcHQuXG4gKi9cbi8qKlxuICogQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBBdHRlbXB0LW93bmVkIGNvbm5lY3Rpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gQ29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcXVhcmFudGluZVByb21pc2VdIC0gU2hhcmVkIGNvbm5lY3Rpb24tZGlzY2FyZCBwcm9taXNlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBxdWFyYW50aW5lZCAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaXMgdW5zYWZlIHRvIHJldXNlLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcm9sbGJhY2tQcm9taXNlXSAtIFNoYXJlZCByb2xsYmFjayBwcm9taXNlLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbc3RhcnRQcm9taXNlXSAtIFRyYW5zYWN0aW9uIHN0YXJ0dXAgcHJvbWlzZSB3aGVuIHRyYW5zYWN0aW9uIGNsZWFuaW5nIGlzIGVuYWJsZWQuXG4gKi9cbi8qKlxuICogVGVzdERhdGEgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3REYXRhXG4gKiBAcHJvcGVydHkge1Rlc3RBcmdzfSBhcmdzIC0gQXJndW1lbnRzIHBhc3NlZCB0byB0aGUgdGVzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZmlsZVBhdGhdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbGluZV0gLSBTb3VyY2UgbGluZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICogQHByb3BlcnR5IHsoYXJnOiBUZXN0QXJncykgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IGZ1bmN0aW9uIC0gVGVzdCBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSBbZGVjbGFyYXRpb25dIC0gUGFja2FnZSBkZWNsYXJhdGlvbi5cbiAqL1xuLyoqXG4gKiBGYWlsZWRUZXN0RGV0YWlsIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGYWlsZWRUZXN0RGV0YWlsXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZnVsbERlc2NyaXB0aW9uIC0gRnVsbCB0ZXN0IGRlc2NyaXB0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRmFpbHVyZSBlcnJvci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uc29sZU91dHB1dF0gLSBDYXB0dXJlZCBjb25zb2xlIG91dHB1dCB3aGlsZSB0ZXN0IHJhbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uc29sZUxvZ1BhdGhdIC0gU2F2ZWQgY29uc29sZSBsb2cgcGF0aC5cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHsoYXJnczoge2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgdGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9KSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVcbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIEhvb2sgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGluZGV4IHdpdGhpbiBpdHMgZGVjbGFyYXRpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RlY2xhcmF0aW9uU2NvcGVJZF0gLSBPcGFxdWUgcHJvZmlsZSBzY29wZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHsoYXJnczoge2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0pID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBCZWZvcmVBZnRlckFsbENhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBIb29rIGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2RlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBpbmRleCB3aXRoaW4gaXRzIGRlY2xhcmF0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkZWNsYXJhdGlvblNjb3BlSWRdIC0gT3BhcXVlIHByb2ZpbGUgc2NvcGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKi9cbi8qKlxuICogVGVzdHNBcmd1bWVudCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdHNBcmd1bWVudFxuICogQHByb3BlcnR5IHtUZXN0QXJnc30gYXJncyAtIEFyZ3VtZW50cyBpbmhlcml0ZWQgYnkgdGVzdHMgaW4gdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2FueVRlc3RzRm9jdXNzZWRdIC0gV2hldGhlciBhbnkgdGVzdHMgaW4gdGhlIHRyZWUgYXJlIGZvY3VzZWQuXG4gKiBAcHJvcGVydHkge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVtdfSBhZnRlckVhY2hlcyAtIEFmdGVyLWVhY2ggaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlW119IGFmdGVyQWxscyAtIEFmdGVyLWFsbCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVbXX0gYmVmb3JlQWxscyAtIEJlZm9yZS1hbGwgaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVtdfSBiZWZvcmVFYWNoZXMgLSBCZWZvcmUtZWFjaCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZmlsZVBhdGhdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbGluZV0gLSBTb3VyY2UgbGluZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBUZXN0RGF0YT59IHRlc3RzIC0gQSB1bmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIG5vZGUuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFRlc3RzQXJndW1lbnQ+fSBzdWJzIC0gT3B0aW9uYWwgY2hpbGQgbm9kZXMuIEVhY2ggaXRlbSBpcyBhbm90aGVyIGBOb2RlYCwgYWxsb3dpbmcgcmVjdXJzaW9uLlxuICovXG4vKipcbiAqIE1hcmtzIHRoZSBlcnJvciB0aHJvd24gYnkgdGhlIGF0dGVtcHQgdGltZW91dCBzbyB0aGUgcnVubmVyIGNhbiBkaXN0aW5ndWlzaFxuICogZGV0YWNoZWQgbGlmZWN5Y2xlIGNsZWFudXAgZnJvbSBhbiBvcmRpbmFyeSB0ZXN0IGZhaWx1cmUuXG4gKiBAdHlwZWRlZiB7RXJyb3IgJiB7dmVsb2Npb3VzVGVzdFRpbWVvdXQ/OiB0cnVlfX0gVGVzdFRpbWVvdXRFcnJvclxuICovXG4vKipcbiAqIFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcn0gYnJva2VyIC0gQXR0ZW1wdCBicm9rZXIgYW5kIGNvbm5lY3Rpb24gY29vcmRpbmF0b3IuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGVudmlyb25tZW50UHVibGlzaGVkIC0gV2hldGhlciBjaGlsZC1wcm9jZXNzIGNvb3JkaW5hdGVzIHdlcmUgcHVibGlzaGVkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IHByZXZpb3VzRW52aXJvbm1lbnQgLSBFbnZpcm9ubWVudCB2YWx1ZSB0byByZXN0b3JlIGFmdGVyIHB1YmxpY2F0aW9uLlxuICovXG4vKipcbiAqIFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIGVycm9yOiBFcnJvciB8IHVuZGVmaW5lZH0+IHwgdW5kZWZpbmVkfSBbY2hlY2tvdXRQcm9taXNlXSAtIEF0dGVtcHQtb3duZWQgcGh5c2ljYWwgY2hlY2tvdXQgb3V0Y29tZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGNvbm5lY3Rpb24gLSBBdHRlbXB0LW93bmVkIHBoeXNpY2FsIGNvbm5lY3Rpb24gb25jZSBjaGVja291dCByZXNvbHZlcy5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gW2NsZWFudXBQcm9taXNlXSAtIFNpbmdsZSBjbGVhbnVwIG9wZXJhdGlvbiBzaGFyZWQgYnkgZW1lcmdlbmN5IGFuZCBldmVudHVhbCBsaWZlY3ljbGUgY2xlYW51cC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbiB8IHVuZGVmaW5lZH0gW2Rpc2NhcmRPbkNsZWFudXBdIC0gV2hldGhlciB0aW1lb3V0IGVtZXJnZW5jeSBjbGVhbnVwIG11c3QgcXVhcmFudGluZSB0aGlzIGNvbm5lY3Rpb24uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSBwb29sIC0gT3duaW5nIGxvZ2ljYWwgcG9vbC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmV2b2tlZCAtIFdoZXRoZXIgdGhpcyBhdHRlbXB0IG1heSBzdGlsbCBwdWJsaXNoIHRoZSBwaHlzaWNhbCByZWdpc3RyYXRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmV1c2VLZXkgLSBSZXNvbHZlZCBwaHlzaWNhbCBjb25maWd1cmF0aW9uIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHNoYXJlZFJlZ2lzdHJhdGlvbiAtIFBoeXNpY2FsLWtleSBzaGFyZWQgcmVnaXN0cmF0aW9uIG9uY2UgcHVibGlzaGVkLlxuICovXG5cbmNvbnN0IHRlc3RpbmdQYWNrYWdlRGlyZWN0b3J5ID0gcGF0aC5kaXJuYW1lKGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEucmVzb2x2ZShcIkB2ZWxvY2lvdXMvdGVzdGluZy9wYWNrYWdlLmpzb25cIikpKVxuXG4vKipcbiAqIFJ1bnMgdG8gZmlsZSBzbHVnLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gc2FuaXRpemUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNsdWctc2FmZSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gdG9GaWxlU2x1Zyh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWVcbiAgICAudG9Mb3dlckNhc2UoKVxuICAgIC5yZXBsYWNlKC9bXmEtejAtOV0rL2csIFwiLVwiKVxuICAgIC5yZXBsYWNlKC9eLSt8LSskL2csIFwiXCIpXG4gICAgLnNsaWNlKDAsIDgwKSB8fCBcImZhaWxlZC10ZXN0XCJcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVzdFJ1bm5lciB7XG4gIC8qKiBAdHlwZSB7UGFja2FnZVRlc3RDb250ZXh0fSAqL1xuICBfY29udGV4dFxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtGYWlsZWRUZXN0RGV0YWlsW119ICovXG4gIF9mYWlsZWRUZXN0RGV0YWlsc1xuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdENvbnRleHR9IFthcmdzLmNvbnRleHRdIC0gRGVjbGFyYXRpb24gY29udGV4dC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuZXhjbHVkZVRhZ3NdIC0gVGFncyB0byBleGNsdWRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nfSBbYXJncy5pbmNsdWRlVGFnc10gLSBUYWdzIHRvIGluY2x1ZGUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gYXJncy50ZXN0RmlsZXMgLSBUZXN0IGZpbGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gW2FyZ3MubGluZUZpbHRlcnNdIC0gTGluZSBmaWx0ZXJzIGJ5IGZpbGUuXG4gICAqIEBwYXJhbSB7UmVnRXhwW119IFthcmdzLmV4YW1wbGVQYXR0ZXJuc10gLSBFeGFtcGxlIHBhdHRlcm5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1wcm9maWxlci5qc1wiKS5kZWZhdWx0fSBbYXJncy5wcm9maWxlcl0gLSBPcHQtaW4gcHJvZmlsZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY29udGV4dCA9IGRlZmF1bHRUZXN0Q29udGV4dCwgZXhjbHVkZVRhZ3MsIGluY2x1ZGVUYWdzLCB0ZXN0RmlsZXMsIGxpbmVGaWx0ZXJzLCBleGFtcGxlUGF0dGVybnMsIHByb2ZpbGVyLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkXCIpXG5cbiAgICB0aGlzLl9jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuX2NvbnRleHQgPSBjb250ZXh0XG4gICAgdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG4gICAgdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlKClcbiAgICB0aGlzLl9leGNsdWRlVGFncyA9IHRoaXMubm9ybWFsaXplVGFncyhleGNsdWRlVGFncylcbiAgICB0aGlzLl9pbmNsdWRlVGFncyA9IHRoaXMubm9ybWFsaXplVGFncyhpbmNsdWRlVGFncylcbiAgICB0aGlzLl90ZXN0RmlsZXMgPSB0ZXN0RmlsZXNcbiAgICB0aGlzLl9saW5lRmlsdGVycyA9IGxpbmVGaWx0ZXJzIHx8IHt9XG4gICAgdGhpcy5fZXhhbXBsZVBhdHRlcm5zID0gZXhhbXBsZVBhdHRlcm5zIHx8IFtdXG4gICAgdGhpcy5fcHJvZmlsZXIgPSBwcm9maWxlclxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAwXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzID0gMFxuICAgIHRoaXMuX3Rlc3RzQ291bnQgPSAwXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMgPSBbXVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5Ob25SdW5UZXN0UmVzdWx0W119ICovXG4gICAgdGhpcy5fbm90UnVuVGVzdERldGFpbHMgPSBbXVxuICAgIC8qKiBAdHlwZSB7e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXJ9IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sYXN0VGVzdENvbnRleHQgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlciwgZHVyYXRpb25NczogbnVtYmVyfT59ICovXG4gICAgdGhpcy5fdGVzdER1cmF0aW9ucyA9IFtdXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIHt0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0+fSAqL1xuICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5ID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uPn0gKi9cbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uPn0gKi9cbiAgICB0aGlzLl9jb21wbGV0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZVRlc3REZWNsYXJhdGlvbiwge2Rlc2NyaXB0aW9uczogc3RyaW5nW10sIHRlc3REZXNjcmlwdGlvbjogc3RyaW5nLCBmdWxsRGVzY3JpcHRpb246IHN0cmluZywgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkLCBzdWl0ZXM6IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW119Pn0gKi9cbiAgICB0aGlzLl90ZXN0TWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VIb29rRGVjbGFyYXRpb24sIHtkZWNsYXJhdGlvbkluZGV4OiBudW1iZXIsIGRlY2xhcmF0aW9uU2NvcGVJZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9Pn0gKi9cbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIE1hcDxudW1iZXIsIHthYm9ydFJlbWFpbmluZ1Rlc3RzOiBib29sZWFuLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGZhaWxlZDogYm9vbGVhbn0+Pn0gKi9cbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7c3VpdGU6IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uLCBwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59ICovXG4gICAgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMgPSBbXVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUGFja2FnZVRlc3REZWNsYXJhdGlvbltdPn0gKi9cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZVJlZ2lzdHJhdGlvbiwgc3RyaW5nPn0gKi9cbiAgICB0aGlzLl9kZWNsYXJhdGlvbk93bmVycyA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1BhY2thZ2VUZXN0UnVubmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3BhY2thZ2VSdW5uZXIgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuVGVzdFJ1blJlc3VsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBUZXN0RGF0YT4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHt7ZmlsZVBhdGg/OiBzdHJpbmcsIGxpbmU/OiBudW1iZXJ9fSAqL1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbiA9IHt9XG4gICAgdGhpcy5fYXR0ZW1wdEV4ZWN1dG9yID0gbmV3IFZlbG9jaW91c0F0dGVtcHRFeGVjdXRvcih7dGVzdFJ1bm5lcjogdGhpc30pXG4gICAgdGhpcy5fcnVubmVyUmVwb3J0ZXIgPSBuZXcgVmVsb2Npb3VzUnVubmVyUmVwb3J0ZXIoe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICAgIHRoaXMuX3N1aXRlSG9va0V4ZWN1dG9yID0gbmV3IFZlbG9jaW91c1N1aXRlSG9va0V4ZWN1dG9yKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgICB0aGlzLl90ZXN0QXJndW1lbnRzID0gbmV3IFZlbG9jaW91c1Rlc3RBcmd1bWVudHMoe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHBhY2thZ2UgZGVjbGFyYXRpb24gY29udGV4dC5cbiAgICogQHJldHVybnMge1BhY2thZ2VUZXN0Q29udGV4dH0gLSBQYWNrYWdlIGRlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqL1xuICBnZXRUZXN0Q29udGV4dCgpIHsgcmV0dXJuIHRoaXMuX2NvbnRleHQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0Q29uZmlndXJhdGlvbigpIHsgcmV0dXJuIHRoaXMuX2NvbmZpZ3VyYXRpb24gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIHRlc3QgZmlsZXMuXG4gICAqL1xuICBnZXRUZXN0RmlsZXMoKSB7IHJldHVybiB0aGlzLl90ZXN0RmlsZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsaW5lIGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT59IC0gTGluZSBmaWx0ZXJzLlxuICAgKi9cbiAgZ2V0TGluZUZpbHRlcnMoKSB7IHJldHVybiB0aGlzLl9saW5lRmlsdGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4YW1wbGUgcGF0dGVybnMuXG4gICAqIEByZXR1cm5zIHtSZWdFeHBbXX0gLSBFeGFtcGxlIHBhdHRlcm5zLlxuICAgKi9cbiAgZ2V0RXhhbXBsZVBhdHRlcm5zKCkgeyByZXR1cm4gdGhpcy5fZXhhbXBsZVBhdHRlcm5zIH1cblxuICAvKipcbiAgICogUnVucyBhIHByb2ZpbGVyIHNwYW4gb25seSB3aGVuIHByb2ZpbGluZyB3YXMgZXhwbGljaXRseSBlbmFibGVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gbWV0YWRhdGEgLSBTcGFuIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGEucGhhc2UgLSBQaGFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW21ldGFkYXRhLmRlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBkZWNsYXJhdGlvbiBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXRhZGF0YS5kZWNsYXJhdGlvblNjb3BlSWRdIC0gSG9vayBkZWNsYXJhdGlvbiBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXRhZGF0YS5maWxlUGF0aF0gLSBTb3VyY2Ugb3duZXJzaGlwLlxuICAgKiBAcGFyYW0geygpID0+IChUIHwgUHJvbWlzZTxUPil9IGNhbGxiYWNrIC0gVGltZWQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1blByb2ZpbGVTcGFuKG1ldGFkYXRhLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fcHJvZmlsZXIpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcHJvZmlsZXIucnVuU3BhbihtZXRhZGF0YSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgdGFncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZyB8IHVuZGVmaW5lZH0gdGFncyAtIFRhZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBOb3JtYWxpemVkIHRhZ3MuXG4gICAqL1xuICBub3JtYWxpemVUYWdzKHRhZ3MpIHtcbiAgICBpZiAoIXRhZ3MpIHJldHVybiBbXVxuXG4gICAgY29uc3QgdmFsdWVzID0gW11cbiAgICBjb25zdCByYXdUYWdzID0gQXJyYXkuaXNBcnJheSh0YWdzKSA/IHRhZ3MgOiBbdGFnc11cblxuICAgIGZvciAoY29uc3QgcmF3VGFnIG9mIHJhd1RhZ3MpIHtcbiAgICAgIGlmIChyYXdUYWcgPT09IHVuZGVmaW5lZCB8fCByYXdUYWcgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHBhcnRzID0gU3RyaW5nKHJhd1RhZykuc3BsaXQoXCIsXCIpXG5cbiAgICAgIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gcGFydC50cmltKClcblxuICAgICAgICBpZiAodHJpbW1lZCkgdmFsdWVzLnB1c2godHJpbW1lZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShuZXcgU2V0KHZhbHVlcykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdGFnLlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhZyAtIFRhZyB0byBjaGVjayBmb3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGFnIGlzIHByZXNlbnQuXG4gICAqL1xuICBoYXNUYWcodGVzdEFyZ3MsIHRhZykge1xuICAgIHJldHVybiB0aGlzLm5vcm1hbGl6ZVRhZ3ModGVzdEFyZ3M/LnRhZ3MpLmluY2x1ZGVzKHRhZylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGJyb3dzZXIgdGVzdCBtb2RlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJ1bm5pbmcgYnJvd3NlciB0ZXN0cy5cbiAgICovXG4gIGlzQnJvd3NlclRlc3RNb2RlKCkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQlJPV1NFUl9URVNUUyA9PT0gXCJ0cnVlXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIGR1bW15IGlmIG5lZWRlZC5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSBbYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnNdIC0gQXR0ZW1wdC1vd25lZCBicm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aER1bW15SWZOZWVkZWQodGVzdEFyZ3MsIGNhbGxiYWNrLCBicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdKSB7XG4gICAgaWYgKCF0aGlzLmhhc1RhZyh0ZXN0QXJncywgXCJkdW1teVwiKSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNCcm93c2VyVGVzdE1vZGUoKSkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5Ccm93c2VyRHVtbXkodGVzdEFyZ3MsIGNhbGxiYWNrLCBicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuTm9kZUR1bW15KGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIG5vZGUgZHVtbXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5Ob2RlRHVtbXkoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkdW1teVBhdGggPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRFVNTVlfUEFUSCB8fCB0aGlzLmRlZmF1bHREdW1teVBhdGgoKVxuICAgIGNvbnN0IGR1bW15SW1wb3J0ID0gYXdhaXQgaW1wb3J0KHBhdGhUb0ZpbGVVUkwoZHVtbXlQYXRoKS5ocmVmKVxuICAgIGNvbnN0IER1bW15ID0gZHVtbXlJbXBvcnQuZGVmYXVsdFxuXG4gICAgaWYgKCFEdW1teT8ucnVuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYER1bW15IGhlbHBlciBub3QgZm91bmQgYXQgJHtkdW1teVBhdGh9YClcbiAgICB9XG5cbiAgICAvLyBQZXJzaXN0ZW50IHNlcnZlciByZXNvdXJjZXMgbXVzdCBub3QgaW5oZXJpdCBhbiBhdHRlbXB0IHNjb3BlIHRoYXQgd2lsbCBiZSByZXZva2VkLlxuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHVuZGVmaW5lZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgRHVtbXkucnVuKGFzeW5jICgpID0+IHt9KVxuICAgIH0pXG4gICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBhd2FpdCBjYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWZhdWx0IGR1bW15IHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVmYXVsdCBkdW1teSBoZWxwZXIgcGF0aC5cbiAgICovXG4gIGRlZmF1bHREdW1teVBhdGgoKSB7XG4gICAgY29uc3QgY3dkID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCkpXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGN3ZC5zcGxpdChwYXRoLnNlcCkuam9pbihcIi9cIilcblxuICAgIGlmIChub3JtYWxpemVkLmVuZHNXaXRoKFwiL3NwZWMvZHVtbXlcIikpIHtcbiAgICAgIHJldHVybiBwYXRoLmpvaW4oY3dkLCBcImluZGV4LmpzXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhdGguam9pbihjd2QsIFwic3BlYy9kdW1teS9pbmRleC5qc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGJyb3dzZXIgZHVtbXkuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgLSBBdHRlbXB0LW93bmVkIGJyb3dzZXIgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5Ccm93c2VyRHVtbXkodGVzdEFyZ3MsIGNhbGxiYWNrLCBjb25uZWN0aW9uUmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHVzZVRyYW5zYWN0aW9uID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJhbnNhY3Rpb24gPT09IHRydWVcbiAgICBjb25zdCB0cnVuY2F0ZSA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRydW5jYXRlXG4gICAgY29uc3Qgc2hvdWxkVHJ1bmNhdGUgPSB0cnVuY2F0ZSA9PT0gdW5kZWZpbmVkID8gIXVzZVRyYW5zYWN0aW9uIDogdHJ1bmNhdGVcblxuICAgIGlmICghdXNlVHJhbnNhY3Rpb24gJiYgIXNob3VsZFRydW5jYXRlKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJUZXN0IHJ1bm5lciBicm93c2VyIGR1bW15XCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICBjb25zdCBuZXdSZWdpc3RyYXRpb25zID0gT2JqZWN0LmVudHJpZXMoZGJzKS5tYXAoKFtkYXRhYmFzZUlkZW50aWZpZXIsIGRiXSkgPT4ge1xuICAgICAgICAvKiogQHR5cGUge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb259ICovXG4gICAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtcbiAgICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgcXVhcmFudGluZWQ6IGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBjb25uZWN0aW9uUmVnaXN0cmF0aW9ucy5wdXNoKHJlZ2lzdHJhdGlvbilcblxuICAgICAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gICAgICB9KVxuXG4gICAgICBpZiAoc2hvdWxkVHJ1bmNhdGUpIHtcbiAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgYXdhaXQgdGhpcy50cnVuY2F0ZURhdGFiYXNlcyhkYnMpXG4gICAgICB9XG4gICAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICAgIGNvbnN0IGxpZmVjeWNsZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICh1c2VUcmFuc2FjdGlvbikge1xuICAgICAgICAgIGNvbnN0IHN0YXJ0UHJvbWlzZXMgPSBuZXdSZWdpc3RyYXRpb25zLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdGFydFByb21pc2UgPSByZWdpc3RyYXRpb24uZGIuc3RhcnRUcmFuc2FjdGlvbigpXG5cbiAgICAgICAgICAgIHJlZ2lzdHJhdGlvbi5zdGFydFByb21pc2UgPSBzdGFydFByb21pc2VcbiAgICAgICAgICAgIHJldHVybiBzdGFydFByb21pc2VcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnN0IHN0YXJ0UmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChzdGFydFByb21pc2VzKVxuICAgICAgICAgIGNvbnN0IHN0YXJ0RXJyb3JzID0gc3RhcnRSZXN1bHRzXG4gICAgICAgICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgICAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgICAgICAgIGlmIChzdGFydEVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgc3RhcnRFcnJvcnNbMF1cbiAgICAgICAgICBpZiAoc3RhcnRFcnJvcnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKHN0YXJ0RXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgdHJhbnNhY3Rpb24gc3RhcnR1cCBmYWlsZWRcIiwge2NhdXNlOiBzdGFydEVycm9yc1swXX0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucm9sbGJhY2tCcm93c2VyRHVtbXlUcmFuc2FjdGlvbnMoY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKC4uLmVycm9yLmVycm9ycylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAoc2hvdWxkVHJ1bmNhdGUpIHtcbiAgICAgICAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVEYXRhYmFzZXMoZGJzKVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cblxuICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgbGlmZWN5Y2xlRXJyb3JzWzBdXG4gICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGxpZmVjeWNsZUVycm9ycywgXCJCcm93c2VyIGR1bW15IGxpZmVjeWNsZSBhbmQgY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBsaWZlY3ljbGVFcnJvcnNbMF19KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayBldmVyeSBhdHRlbXB0LW93bmVkIGJyb3dzZXIgdHJhbnNhY3Rpb24gZXhhY3RseSBvbmNlLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEJyb3dzZXIgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFsbCByb2xsYmFja3Mgc2V0dGxlLlxuICAgKi9cbiAgYXN5bmMgcm9sbGJhY2tCcm93c2VyRHVtbXlUcmFuc2FjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHJvbGxiYWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4ucmVnaXN0cmF0aW9uc10ucmV2ZXJzZSgpLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICBjb25zdCBzdGFydFByb21pc2UgPSByZWdpc3RyYXRpb24uc3RhcnRQcm9taXNlXG5cbiAgICAgIGlmICghc3RhcnRQcm9taXNlKSByZXR1cm5cblxuICAgICAgcmVnaXN0cmF0aW9uLnJvbGxiYWNrUHJvbWlzZSA/Pz0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBzdGFydFByb21pc2VcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgICAgICAgIH0gY2F0Y2ggKHF1YXJhbnRpbmVFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcXVhcmFudGluZSBicm93c2VyIGR1bW15IGRhdGFiYXNlIGFmdGVyIHRyYW5zYWN0aW9uIHN0YXJ0dXAgZmFpbGVkOiAke3JlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXJ9YCwge2NhdXNlOiBxdWFyYW50aW5lRXJyb3J9KVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBpZiAocmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkKSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5kYi5yb2xsYmFja1RyYW5zYWN0aW9uKClcbiAgICAgICAgfSBjYXRjaCAocm9sbGJhY2tFcnJvcikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgICAgICB9IGNhdGNoIChxdWFyYW50aW5lRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgICAgW3JvbGxiYWNrRXJyb3IsIHF1YXJhbnRpbmVFcnJvcl0sXG4gICAgICAgICAgICAgIGBGYWlsZWQgdG8gcm9sbCBiYWNrIGFuZCBxdWFyYW50aW5lIGJyb3dzZXIgZHVtbXkgZGF0YWJhc2U6ICR7cmVnaXN0cmF0aW9uLmRhdGFiYXNlSWRlbnRpZmllcn1gLFxuICAgICAgICAgICAgICB7Y2F1c2U6IHF1YXJhbnRpbmVFcnJvcn1cbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgcm9sbGJhY2tFcnJvclxuICAgICAgICB9XG4gICAgICB9KSgpXG5cbiAgICAgIHJldHVybiByZWdpc3RyYXRpb24ucm9sbGJhY2tQcm9taXNlXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gcm9sbGJhY2tSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJCcm93c2VyIGR1bW15IHRyYW5zYWN0aW9uIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3JzWzBdfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJtYW5lbnRseSByZW1vdmVzIG9uZSBicm93c2VyIGNvbm5lY3Rpb24gdGhhdCBjYW5ub3QgYmUgc2hhcmVkIHNhZmVseS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSByZWdpc3RyYXRpb24gLSBCcm93c2VyIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgY29ubmVjdGlvbiBpcyBkaXNjYXJkZWQuXG4gICAqL1xuICBhc3luYyBxdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pIHtcbiAgICByZWdpc3RyYXRpb24ucXVhcmFudGluZWQgPSB0cnVlXG4gICAgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVQcm9taXNlID8/PSB0aGlzLmRpc2NhcmRCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXIsIHJlZ2lzdHJhdGlvbi5kYilcbiAgICBhd2FpdCByZWdpc3RyYXRpb24ucXVhcmFudGluZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjYXJkcyBvbmUgYnJvd3NlciBkdW1teSBjb25uZWN0aW9uIHRocm91Z2ggaXRzIG93bmluZyBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gQ29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFVuc2FmZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkaXNjYXJkLlxuICAgKi9cbiAgYXN5bmMgZGlzY2FyZEJyb3dzZXJEdW1teUNvbm5lY3Rpb24oZGF0YWJhc2VJZGVudGlmaWVyLCBkYikge1xuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpLmRpc2NhcmQoZGIpXG4gIH1cblxuICAvKipcbiAgICogUXVhcmFudGluZXMgYWxsIGJyb3dzZXIgY29ubmVjdGlvbnMgY29uY3VycmVudGx5LlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEJyb3dzZXIgY29ubmVjdGlvbiByZWdpc3RyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBjb25uZWN0aW9uIGlzIGRpc2NhcmRlZC5cbiAgICovXG4gIGFzeW5jIHF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9ucyhyZWdpc3RyYXRpb25zKSB7XG4gICAgY29uc3QgcXVhcmFudGluZVJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocmVnaXN0cmF0aW9ucy5tYXAoYXN5bmMgKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gcXVhcmFudGluZVJlc3VsdHNcbiAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiBxdWFyYW50aW5lIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnVuY2F0ZSBkYXRhYmFzZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBkYnMgLSBEYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlRGF0YWJhc2VzKGRicykge1xuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhkYnMpKSB7XG4gICAgICBhd2FpdCBkYnNbaWRlbnRpZmllcl0udHJ1bmNhdGVBbGxUYWJsZXMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGNsdWRlIHRhZyBzZXQuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBFeGNsdWRlIHRhZyBzZXQuXG4gICAqL1xuICBnZXRFeGNsdWRlVGFnU2V0KCkge1xuICAgIC8qKlxuICAgICAqIENvbmZpZyB0YWdzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBjb25maWdUYWdzID0gQXJyYXkuaXNBcnJheSh0ZXN0Q29uZmlnLmV4Y2x1ZGVUYWdzKSA/IHRlc3RDb25maWcuZXhjbHVkZVRhZ3MgOiBbXVxuXG4gICAgcmV0dXJuIG5ldyBTZXQoWy4uLnRoaXMuX2V4Y2x1ZGVUYWdzLCAuLi5jb25maWdUYWdzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIGZ1bGwgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGdWxsIGRlc2NyaXB0aW9uLlxuICAgKi9cbiAgYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pIHtcbiAgICBjb25zdCBwYXJ0cyA9IGRlc2NyaXB0aW9ucy5jb25jYXQoW3Rlc3REZXNjcmlwdGlvbl0pXG5cbiAgICByZXR1cm4gcGFydHMuam9pbihcIiBcIikudHJpbSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBsaWNhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXBwbGljYXRpb24+fSAtIFJlc29sdmVzIHdpdGggdGhlIGFwcGxpY2F0aW9uLlxuICAgKi9cbiAgYXN5bmMgYXBwbGljYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLl9hcHBsaWNhdGlvbikge1xuICAgICAgdGhpcy5fYXBwbGljYXRpb24gPSBuZXcgQXBwbGljYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgLy8gUnVuIHJlcXVlc3QgaGFuZGxlcnMgaW4gdGhlIG1haW4gdGhyZWFkIChub3Qgd29ya2VyIHRocmVhZHMpIHNvIHRoZXlcbiAgICAgICAgLy8gcmVzb2x2ZSBEQiB3b3JrIHRvIHRoZSBwZXItdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBzZXQgYnlcbiAgICAgICAgLy8ge0BsaW5rIGFjdGl2YXRlVGVzdFNoYXJlZENvbm5lY3Rpb25zfS4gVGhpcyBsZXRzIHJlcXVlc3QtdHlwZSBzcGVjcyB1c2VcbiAgICAgICAgLy8gdHJhbnNhY3Rpb24tYmFzZWQgY2xlYW5pbmcgKHRoZWlyIHdyaXRlcyBsYW5kIGluc2lkZSB0aGUgdGVzdCdzXG4gICAgICAgIC8vIHRyYW5zYWN0aW9uIGFuZCByb2xsIGJhY2spIGluc3RlYWQgb2YgdHJ1bmNhdGluZyBldmVyeSB0YWJsZS5cbiAgICAgICAgaHR0cFNlcnZlcjoge2luUHJvY2VzczogdHJ1ZSwgcG9ydDogMzEwMDZ9LFxuICAgICAgICB0eXBlOiBcInRlc3QtcnVubmVyXCJcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRoaXMuX2FwcGxpY2F0aW9uLmluaXRpYWxpemUoKVxuICAgICAgYXdhaXQgdGhpcy5fYXBwbGljYXRpb24uc3RhcnRIdHRwU2VydmVyKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXBwbGljYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgZWFjaCBub24tdGVuYW50IHBlci10ZXN0IGNvbm5lY3Rpb24gYXMgYSBkeW5hbWljIGNhbmRpZGF0ZSBmb3IgaW4tcHJvY2Vzc1xuICAgKiByZXF1ZXN0IHNoYXJpbmcuIFRoZSBwb29sIGV2YWx1YXRlcyB0cmFuc2FjdGlvbiBzdGF0ZSB3aGVuIGVhY2ggcmVxdWVzdCBpcyBkaXNwYXRjaGVkLFxuICAgKiBzbyBhIHRyYW5zYWN0aW9uIHN0YXJ0ZWQgb3IgZW5kZWQgZHVyaW5nIGEgaG9vayBjYWxsYmFjayB0YWtlcyBlZmZlY3QgaW1tZWRpYXRlbHkuXG4gICAqIEluYWN0aXZlIGFuZCB0ZW5hbnQtb25seSBjb25uZWN0aW9ucyByZW1haW4gaW5kZXBlbmRlbnRseSBwb29sZWQuIFBhaXIgd2l0aFxuICAgKiB7QGxpbmsgY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnN9IGluIGEgZmluYWxseS5cbiAgICogQHJldHVybnMge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119IC0gTGlmZWN5Y2xlLW93bmVkIHJlZ2lzdHJhdGlvbnMuXG4gICAqL1xuICBhY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9ucygpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbnMgPSBjb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG4gICAgLyoqIEB0eXBlIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAqL1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKGN1cnJlbnRDb25uZWN0aW9ucykpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICAvLyBUZW5hbnQtc2NvcGVkIHBvb2xzIHJlc29sdmUgYSBkaWZmZXJlbnQgY29ubmVjdGlvbiBwZXIgcmVxdWVzdCB0ZW5hbnRcbiAgICAgIC8vICh2aWEgcnVuV2l0aFRlbmFudCksIHNvIGZvcmNpbmcgYSBzaW5nbGUgc2hhcmVkIGNvbm5lY3Rpb24gd291bGQgYnJlYWtcbiAgICAgIC8vIHBlci1yZXF1ZXN0IHRlbmFudCByZXNvbHV0aW9uLiBPbmx5IHNoYXJlIG5vbi10ZW5hbnQgcG9vbHM7IHRoZSB0ZW5hbnRcbiAgICAgIC8vIHBvb2wga2VlcHMgcmVzb2x2aW5nIGl0cyBvd24gY29ubmVjdGlvbiBwZXIgcmVxdWVzdC5cbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb24oKS50ZW5hbnRPbmx5KSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBjdXJyZW50Q29ubmVjdGlvbnNbaWRlbnRpZmllcl1cblxuICAgICAgY29uc3QgcmVnaXN0cmF0aW9uID0gcG9vbC5zZXRUZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGNvbm5lY3Rpb24gOiB1bmRlZmluZWRcbiAgICAgIH0pXG5cbiAgICAgIGlmIChyZWdpc3RyYXRpb24pIHJlZ2lzdHJhdGlvbnMucHVzaCh7cG9vbCwgcmVnaXN0cmF0aW9ufSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgaW4tcHJvY2VzcyB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIG9uIGV2ZXJ5IGNvbmZpZ3VyZWQgcG9vbC4gSWRlbXBvdGVudCBhbmRcbiAgICogc2FmZSB0byBjYWxsIHdoZW4gbm9uZSB3YXMgc2V0LlxuICAgKiBAcGFyYW0ge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119IFtyZWdpc3RyYXRpb25zXSAtIExpZmVjeWNsZS1vd25lZCByZWdpc3RyYXRpb25zIHRvIGNsZWFyIGNvbmRpdGlvbmFsbHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGlmIChyZWdpc3RyYXRpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IHtwb29sLCByZWdpc3RyYXRpb259IG9mIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgICAgcG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgICBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIG91dCBhbmQgcmVnaXN0ZXJzIG9uZSBwaHlzaWNhbCB0ZW5hbnQgdHJhbnNhY3Rpb24gZm9yIHRoZSBjdXJyZW50IGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ6IG9iamVjdH19IGFyZ3MgLSBMb2dpY2FsIGlkZW50aWZpZXIgYW5kIHRlbmFudCBkZXNjcmlwdG9yLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEN1cnJlbnQgYXR0ZW1wdCByZWdpc3RyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCh7ZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQsIC4uLnJlc3RBcmdzfSwgcmVnaXN0cmF0aW9ucykge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcInJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICghdGVuYW50KSB0aHJvdyBuZXcgRXJyb3IoXCJyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSB0ZW5hbnRcIilcblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbi5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50KVxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLnRlbmFudE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgdGVuYW50T25seSBkYXRhYmFzZTogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG4gICAgY29uc3QgcmV1c2VLZXkgPSBwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgaWYgKHJlZ2lzdHJhdGlvbnMuc29tZSgocmVnaXN0cmF0aW9uKSA9PiByZWdpc3RyYXRpb24ucG9vbCA9PT0gcG9vbCAmJiByZWdpc3RyYXRpb24ucmV1c2VLZXkgPT09IHJldXNlS2V5KSkgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb259ICovXG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge1xuICAgICAgY29ubmVjdGlvbjogdW5kZWZpbmVkLFxuICAgICAgcG9vbCxcbiAgICAgIHJldXNlS2V5LFxuICAgICAgcmV2b2tlZDogZmFsc2UsXG4gICAgICBzaGFyZWRSZWdpc3RyYXRpb246IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHJlZ2lzdHJhdGlvbnMucHVzaChyZWdpc3RyYXRpb24pXG4gICAgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZSA9IHBvb2xcbiAgICAgIC5jaGVja291dEZvckNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZTogXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvblwifSlcbiAgICAgIC50aGVuKFxuICAgICAgICAoY29ubmVjdGlvbikgPT4gKHtjb25uZWN0aW9uLCBlcnJvcjogdW5kZWZpbmVkfSksXG4gICAgICAgIChlcnJvcikgPT4gKHtcbiAgICAgICAgICBjb25uZWN0aW9uOiB1bmRlZmluZWQsXG4gICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IGNvbm5lY3Rpb24gY2hlY2tvdXQgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgICB9KVxuICAgICAgKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNoZWNrb3V0T3V0Y29tZSA9IGF3YWl0IHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2VcblxuICAgICAgaWYgKGNoZWNrb3V0T3V0Y29tZS5lcnJvcikgdGhyb3cgY2hlY2tvdXRPdXRjb21lLmVycm9yXG4gICAgICBpZiAoIWNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCBjb25uZWN0aW9uIGNoZWNrb3V0IHJldHVybmVkIG5vIGNvbm5lY3Rpb25cIilcbiAgICAgIHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uID0gY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb25cbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG5cbiAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uLnN0YXJ0VHJhbnNhY3Rpb24oKVxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcblxuICAgICAgY29uc3Qgc2hhcmVkUmVnaXN0cmF0aW9uID0gcG9vbC5zZXRUZXN0U2hhcmVkQ29ubmVjdGlvbkZvckNvbmZpZ3VyYXRpb24ocmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24sIHJldXNlS2V5KVxuICAgICAgaWYgKCFzaGFyZWRSZWdpc3RyYXRpb24pIHRocm93IG5ldyBFcnJvcihgRGF0YWJhc2UgcG9vbCBkb2VzIG5vdCBzdXBwb3J0IHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvbnM6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgICByZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uID0gc2hhcmVkUmVnaXN0cmF0aW9uXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHtcbiAgICAgICAgcG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHNoYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5yZXZva2VkID0gdHJ1ZVxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHMoW3JlZ2lzdHJhdGlvbl0sIHtkaXNjYXJkOiByZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCA9PT0gdHJ1ZX0pXG4gICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFtlcnJvciwgY2xlYW51cEVycm9yXSwgXCJGYWlsZWQgdG8gcmVnaXN0ZXIgYW5kIGNsZWFuIHVwIGEgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uXCIsIHtjYXVzZTogY2xlYW51cEVycm9yfSlcbiAgICAgIH1cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldm9rZXMgYXR0ZW1wdCByZWdpc3RyYXRpb25zIGJlZm9yZSByb2xsaW5nIGJhY2sgYW5kIHJlbGVhc2luZyB0aGVpciBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbnMuXG4gICAqIEBwYXJhbSB7e2Rpc2NhcmQ/OiBib29sZWFufX0gW29wdGlvbnNdIC0gV2hldGhlciBjb25uZWN0aW9ucyBtdXN0IGJlIGRpc2NhcmRlZCBpbnN0ZWFkIG9mIHJldHVybmVkIHRvIHRoZSBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50cyhyZWdpc3RyYXRpb25zLCB7ZGlzY2FyZCA9IGZhbHNlfSA9IHt9KSB7XG4gICAgZm9yIChjb25zdCByZWdpc3RyYXRpb24gb2YgcmVnaXN0cmF0aW9ucykge1xuICAgICAgcmVnaXN0cmF0aW9uLnJldm9rZWQgPSB0cnVlXG4gICAgICBpZiAoZGlzY2FyZCkgcmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXAgPSB0cnVlXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbikgcmVnaXN0cmF0aW9uLnBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihyZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uKVxuICAgIH1cbiAgICBjb25zdCBjbGVhbnVwUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4ucmVnaXN0cmF0aW9uc10ucmV2ZXJzZSgpLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICByZWdpc3RyYXRpb24uY2xlYW51cFByb21pc2UgPz89IHRoaXMuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24ocmVnaXN0cmF0aW9uKVxuXG4gICAgICByZXR1cm4gcmVnaXN0cmF0aW9uLmNsZWFudXBQcm9taXNlXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gY2xlYW51cFJlc3VsdHNcbiAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gY2xlYW4gdXAgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFucyBvbmUgYXR0ZW1wdCByZWdpc3RyYXRpb24gZXhhY3RseSBvbmNlLCBpbmNsdWRpbmcgYSBjaGVja291dCB0aGF0IHdhcyBzdGlsbCBwZW5kaW5nIGF0IHJldm9jYXRpb24uXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbn0gcmVnaXN0cmF0aW9uIC0gQXR0ZW1wdC1vd25lZCByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJvbGxiYWNrIGFuZCByZWxlYXNlIG9yIHF1YXJhbnRpbmUuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbihyZWdpc3RyYXRpb24pIHtcbiAgICBsZXQgY29ubmVjdGlvbiA9IHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24gJiYgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZSkge1xuICAgICAgY29uc3QgY2hlY2tvdXRPdXRjb21lID0gYXdhaXQgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZVxuXG4gICAgICBpZiAoY2hlY2tvdXRPdXRjb21lLmVycm9yKSByZXR1cm5cbiAgICAgIGNvbm5lY3Rpb24gPSBjaGVja291dE91dGNvbWUuY29ubmVjdGlvblxuICAgICAgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24gPSBjb25uZWN0aW9uXG4gICAgfVxuICAgIGlmICghY29ubmVjdGlvbikgcmV0dXJuXG5cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkpIGF3YWl0IGNvbm5lY3Rpb24ucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAocmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXApIHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24ucG9vbC5kaXNjYXJkKGNvbm5lY3Rpb24pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLnBvb2wuY2hlY2tpbihjb25uZWN0aW9uKVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gY2xlYW4gdXAgYSB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RzIHRoZSBjdXJyZW50IG5vbi10ZW5hbnQgY29ubmVjdGlvbnMgZWxpZ2libGUgZm9yIHNoYXJlZCB0cmFuc2FjdGlvbiB3b3JrLlxuICAgKiBAcGFyYW0ge3t0cmFuc2FjdGlvbnNPbmx5OiBib29sZWFufX0gYXJncyAtIFNlbGVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIEVsaWdpYmxlIGNvbm5lY3Rpb25zIGJ5IGlkZW50aWZpZXIuXG4gICAqL1xuICBzaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9ucyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBjb25uZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyhjdXJyZW50Q29ubmVjdGlvbnMpKSB7XG4gICAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgaWYgKHBvb2wuZ2V0Q29uZmlndXJhdGlvbigpLnRlbmFudE9ubHkpIGNvbnRpbnVlXG4gICAgICBpZiAodHJhbnNhY3Rpb25zT25seSAmJiAhY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBjb250aW51ZVxuICAgICAgY29ubmVjdGlvbnNbaWRlbnRpZmllcl0gPSBjb25uZWN0aW9uXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25zXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgcGh5c2ljYWwtY29ubmVjdGlvbiBjb29yZGluYXRpb24gYmVmb3JlIGEgdHJhbnNhY3Rpb24tb3BlbmluZyBob29rXG4gICAqIGNhbiBleHBvc2UgdGhlIHNoYXJlZCBjb25uZWN0aW9uIHRvIGEgbG9uZy1saXZlZCBpbi1wcm9jZXNzIHNlcnZpY2UuXG4gICAqIENoaWxkLXByb2Nlc3MgY29vcmRpbmF0ZXMgcmVtYWluIHVucHVibGlzaGVkIHVudGlsIHRoZSB0cmFuc2FjdGlvbiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBQcmVwYXJlZCBjb29yZGluYXRvci5cbiAgICovXG4gIGFzeW5jIHByZXBhcmVTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcigpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seTogZmFsc2V9KVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKS5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7XG4gICAgICBicm9rZXI6IGF3YWl0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLnN0YXJ0KHtjb25uZWN0aW9uc30pLFxuICAgICAgZW52aXJvbm1lbnRQdWJsaXNoZWQ6IGZhbHNlLFxuICAgICAgcHJldmlvdXNFbnZpcm9ubWVudDogdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgcHJlcGFyZWQgYnJva2VyIGNvb3JkaW5hdGVzIGV4YWN0bHkgdGhlIHNlbGVjdGVkIHBoeXNpY2FsIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSByZWdpc3RyYXRpb24gLSBQcmVwYXJlZCBjb29yZGluYXRvci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGNvbm5lY3Rpb25zIC0gU2VsZWN0ZWQgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGlkZW50aWZpZXIgc2V0IGFuZCBwaHlzaWNhbCBjb25uZWN0aW9ucyBtYXRjaCBleGFjdGx5LlxuICAgKi9cbiAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJNYXRjaGVzQ29ubmVjdGlvbnMocmVnaXN0cmF0aW9uLCBjb25uZWN0aW9ucykge1xuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpXG5cbiAgICBpZiAoIXJlZ2lzdHJhdGlvbiB8fCBpZGVudGlmaWVycy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuICAgIGlmIChPYmplY3Qua2V5cyhyZWdpc3RyYXRpb24uYnJva2VyLmNvbm5lY3Rpb25zKS5sZW5ndGggIT09IGlkZW50aWZpZXJzLmxlbmd0aCkgcmV0dXJuIGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBjb25uZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyhjb25uZWN0aW9ucykpIHtcbiAgICAgIGlmIChyZWdpc3RyYXRpb24uYnJva2VyLmNvbm5lY3Rpb25zW2lkZW50aWZpZXJdICE9PSBjb25uZWN0aW9uKSByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhIGNhcGFiaWxpdHktc2NvcGVkIGJyb2tlciBmb3IgdGhlIGFjdGl2ZSBub24tdGVuYW50IHBoeXNpY2FsXG4gICAqIHRyYW5zYWN0aW9uIGNvbm5lY3Rpb25zLiBObyBicm9rZXIvZW52IGlzIGluc3RhbGxlZCBmb3IgdHJ1bmNhdGlvbi1vbmx5IG9yXG4gICAqIG90aGVyIHRyYW5zYWN0aW9uLWRpc2FibGVkIGF0dGVtcHRzLlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9ufSBbcHJlcGFyZWRSZWdpc3RyYXRpb25dIC0gQ29vcmRpbmF0b3IgcHJlcGFyZWQgYmVmb3JlIGhvb2tzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gW3NlbGVjdGVkQ29ubmVjdGlvbnNdIC0gUG9zdC1ob29rIGFjdGl2ZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWQ+fSAtIEF0dGVtcHQgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbiwgc2VsZWN0ZWRDb25uZWN0aW9ucykge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gc2VsZWN0ZWRDb25uZWN0aW9ucyB8fCB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IHRydWV9KVxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKVxuICAgIGlmIChkYXRhYmFzZUlkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgbGV0IGJyb2tlclxuXG4gICAgaWYgKHByZXBhcmVkUmVnaXN0cmF0aW9uICYmIHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJNYXRjaGVzQ29ubmVjdGlvbnMocHJlcGFyZWRSZWdpc3RyYXRpb24sIGNvbm5lY3Rpb25zKSkge1xuICAgICAgYnJva2VyID0gcHJlcGFyZWRSZWdpc3RyYXRpb24uYnJva2VyXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgYnJva2VyID0gYXdhaXQgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIuc3RhcnQoe2Nvbm5lY3Rpb25zfSlcbiAgICB9XG5cbiAgICBjb25zdCBwcmV2aW91c0Vudmlyb25tZW50ID0gcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdXG4gICAgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgYWRkcmVzczogYnJva2VyLmFkZHJlc3MoKSxcbiAgICAgIGNhcGFiaWxpdHk6IGJyb2tlci5jYXBhYmlsaXR5KCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgZXhwZWN0ZWQ6IHRydWVcbiAgICB9KSkudG9TdHJpbmcoXCJiYXNlNjR1cmxcIilcblxuICAgIHJldHVybiB7YnJva2VyLCBlbnZpcm9ubWVudFB1Ymxpc2hlZDogdHJ1ZSwgcHJldmlvdXNFbnZpcm9ubWVudH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXZva2VzIGFuIGF0dGVtcHQgYnJva2VyIGJlZm9yZSBkYXRhYmFzZSByb2xsYmFjayBob29rcyBydW4gYW5kIHJlc3RvcmVzXG4gICAqIHRoZSBjYWxsZXIncyBlbnZpcm9ubWVudCBzbyBsYXRlciBwb29sZWQvc3Bhd25lZCBjaGlsZHJlbiBjYW5ub3QgaW5oZXJpdCBpdC5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gcmVnaXN0cmF0aW9uIC0gQXR0ZW1wdCByZWdpc3RyYXRpb24uXG4gICAqL1xuICBhc3luYyBzdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocmVnaXN0cmF0aW9uKSB7XG4gICAgaWYgKCFyZWdpc3RyYXRpb24pIHJldHVyblxuXG4gICAgaWYgKHJlZ2lzdHJhdGlvbi5lbnZpcm9ubWVudFB1Ymxpc2hlZCkge1xuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5wcmV2aW91c0Vudmlyb25tZW50ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdID0gcmVnaXN0cmF0aW9uLnByZXZpb3VzRW52aXJvbm1lbnRcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgcmVnaXN0cmF0aW9uLmJyb2tlci5jbG9zZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1ZXN0IGNsaWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVxdWVzdENsaWVudD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcmVxdWVzdCBjbGllbnQuXG4gICAqL1xuICBhc3luYyByZXF1ZXN0Q2xpZW50KCkge1xuICAgIGlmICghdGhpcy5fcmVxdWVzdENsaWVudCkge1xuICAgICAgdGhpcy5fcmVxdWVzdENsaWVudCA9IG5ldyBSZXF1ZXN0Q2xpZW50KClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fcmVxdWVzdENsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IHRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbXBvcnRUZXN0RmlsZXMoKSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmICghdGhpcy5fcHJvZmlsZXIpIHtcbiAgICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5pbXBvcnRUZXN0RmlsZXModGhpcy5nZXRUZXN0RmlsZXMoKSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGZvciAoY29uc3QgdGVzdEZpbGUgb2YgdGhpcy5nZXRUZXN0RmlsZXMoKSkge1xuICAgICAgY29uc3QgZXhpc3RpbmdSZWdpc3RyYXRpb25zID0gdGhpcy50ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cygpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICB9LCB7ZmlsZVBhdGg6IHRlc3RGaWxlfSlcbiAgICAgIHRoaXMuYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcChleGlzdGluZ1JlZ2lzdHJhdGlvbnMsIHRlc3RGaWxlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsZWN0cyBwYWNrYWdlIGRlY2xhcmF0aW9uIG9iamVjdHMgYnkgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7U2V0PFBhY2thZ2VSZWdpc3RyYXRpb24+fSBbcmVnaXN0cmF0aW9uc10gLSBBY2N1bXVsYXRlZCBpZGVudGl0aWVzLlxuICAgKiBAcmV0dXJucyB7U2V0PFBhY2thZ2VSZWdpc3RyYXRpb24+fSAtIFJlZ2lzdHJhdGlvbiBpZGVudGl0aWVzLlxuICAgKi9cbiAgdGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMocmVnaXN0cmF0aW9ucyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IHZpc2l0ID0gKC8qKiBAdHlwZSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259ICovIHN1aXRlKSA9PiB7XG4gICAgICByZWdpc3RyYXRpb25zLmFkZChzdWl0ZSlcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBbLi4uc3VpdGUuaG9va3MuYmVmb3JlQWxsLCAuLi5zdWl0ZS5ob29rcy5iZWZvcmVFYWNoLCAuLi5zdWl0ZS5ob29rcy5hZnRlckVhY2gsIC4uLnN1aXRlLmhvb2tzLmFmdGVyQWxsXSkge1xuICAgICAgICByZWdpc3RyYXRpb25zLmFkZChob29rKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCB0ZXN0RGVjbGFyYXRpb24gb2Ygc3VpdGUudGVzdHMpIHJlZ2lzdHJhdGlvbnMuYWRkKHRlc3REZWNsYXJhdGlvbilcbiAgICAgIGZvciAoY29uc3QgY2hpbGRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIHZpc2l0KGNoaWxkU3VpdGUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWl0ZSBvZiB0aGlzLmdldFRlc3RDb250ZXh0KCkucmVnaXN0cnkuc3VpdGVzKSB2aXNpdChzdWl0ZSlcblxuICAgIHJldHVybiByZWdpc3RyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBkZXRlcm1pbmlzdGljIG93bmVyc2hpcCB0byBwYWNrYWdlIGRlY2xhcmF0aW9ucyBhZGRlZCBieSBvbmUgZW50cnkgZmlsZS5cbiAgICogQHBhcmFtIHtTZXQ8UGFja2FnZVJlZ2lzdHJhdGlvbj59IHByZXZpb3VzUmVnaXN0cmF0aW9ucyAtIElkZW50aXRpZXMgcHJlc2VudCBiZWZvcmUgaW1wb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3duZXJGaWxlUGF0aCAtIEltcG9ydGluZyBlbnRyeSBmaWxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAocHJldmlvdXNSZWdpc3RyYXRpb25zLCBvd25lckZpbGVQYXRoKSB7XG4gICAgZm9yIChjb25zdCByZWdpc3RyYXRpb24gb2YgdGhpcy50ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cygpKSB7XG4gICAgICBpZiAoIXByZXZpb3VzUmVnaXN0cmF0aW9ucy5oYXMocmVnaXN0cmF0aW9uKSkgdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuc2V0KHJlZ2lzdHJhdGlvbiwgb3duZXJGaWxlUGF0aClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZmFpbGVkLlxuICAgKi9cbiAgaXNGYWlsZWQoKSB7IHJldHVybiB0aGlzLl9mYWlsZWRUZXN0cyAhPT0gdW5kZWZpbmVkICYmICh0aGlzLl9mYWlsZWRUZXN0cyA+IDAgfHwgdGhpcy5fcGFja2FnZVJlc3VsdD8uc3RhdHVzID09PSBcImZhaWxlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZhaWxlZCB0ZXN0cy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZmFpbGVkIHRlc3RzLlxuICAgKi9cbiAgZ2V0RmFpbGVkVGVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX2ZhaWxlZFRlc3RzID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIlRlc3RzIGhhc24ndCBiZWVuIHJ1biB5ZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9mYWlsZWRUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBzZWxlY3RlZCB0ZXN0cyBibG9ja2VkIGJ5IGEgdGVybWluYWwgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gU2VsZWN0ZWQgdGVzdHMgbm90IGV4ZWN1dGVkIGJlY2F1c2UgYSBzaGFyZWQgcmVzb3VyY2UgZmFpbGVkLlxuICAgKi9cbiAgZ2V0Tm90UnVuVGVzdHMoKSB7IHJldHVybiB0aGlzLl9ub3RSdW5UZXN0RGV0YWlscy5sZW5ndGggfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHJ1bnRpbWUgbm9uLXJ1biBhdHRyaWJ1dGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuTm9uUnVuVGVzdFJlc3VsdFtdfSAtIFJ1bnRpbWUgbm9uLXJ1biBkZXRhaWxzIHdpdGggdGhlIG9yaWdpbmF0aW5nIGZhaWx1cmUuXG4gICAqL1xuICBnZXROb3RSdW5UZXN0RGV0YWlscygpIHsgcmV0dXJuIHRoaXMuX25vdFJ1blRlc3REZXRhaWxzIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHNlbGVjdGVkIHRlc3QgdGhhdCBkaWQgbm90IGV4ZWN1dGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5Ob25SdW5UZXN0UmVzdWx0fSByZXN1bHQgLSBUZXJtaW5hbC1yZXNvdXJjZSBub24tcnVuIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmROb3RSdW5UZXN0KHJlc3VsdCkgeyB0aGlzLl9ub3RSdW5UZXN0RGV0YWlscy5wdXNoKHJlc3VsdCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdCBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7RmFpbGVkVGVzdERldGFpbFtdfSAtIEZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0RGV0YWlscygpIHtcbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdERldGFpbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3QgZmFpbGVkIHRlc3QgY29uc29sZSBvdXRwdXRzIHRvIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYXNzZXRzUGF0aF0gLSBBc3NldHMgZGlyZWN0b3J5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBXcml0dGVuIGxvZyBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdEZhaWxlZFRlc3RDb25zb2xlT3V0cHV0c1RvQXNzZXRzKHthc3NldHNQYXRoID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksIFwidG1wL3NjcmVlbnNob3RzXCIpfSA9IHt9KSB7XG4gICAgY29uc3QgZmFpbGVkVGVzdERldGFpbHMgPSB0aGlzLmdldEZhaWxlZFRlc3REZXRhaWxzKClcbiAgICBjb25zdCB3cml0dGVuTG9nUGF0aHMgPSBbXVxuICAgIGxldCBjcmVhdGVkRGlyZWN0b3J5ID0gZmFsc2VcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBmYWlsZWRUZXN0RGV0YWlscy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGNvbnN0IGZhaWxlZFRlc3REZXRhaWwgPSBmYWlsZWRUZXN0RGV0YWlsc1tpbmRleF1cbiAgICAgIGNvbnN0IGNvbnNvbGVPdXRwdXQgPSBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVPdXRwdXRcblxuICAgICAgaWYgKCFjb25zb2xlT3V0cHV0KSBjb250aW51ZVxuXG4gICAgICBpZiAoIWNyZWF0ZWREaXJlY3RvcnkpIHtcbiAgICAgICAgYXdhaXQgZnMubWtkaXIoYXNzZXRzUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgICAgIGNyZWF0ZWREaXJlY3RvcnkgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IFtcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRGdWxsWWVhcigpKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldERhdGUoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldEhvdXJzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaW51dGVzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRTZWNvbmRzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaWxsaXNlY29uZHMoKSkucGFkU3RhcnQoMywgXCIwXCIpXG4gICAgICBdLmpvaW4oXCJcIilcbiAgICAgIGNvbnN0IHNsdWcgPSB0b0ZpbGVTbHVnKGZhaWxlZFRlc3REZXRhaWwuZnVsbERlc2NyaXB0aW9uKVxuICAgICAgY29uc3QgZmlsZU5hbWUgPSBgJHt0aW1lc3RhbXB9LSR7U3RyaW5nKGluZGV4ICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpfS0ke3NsdWd9LmNvbnNvbGUubG9nYFxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oYXNzZXRzUGF0aCwgZmlsZU5hbWUpXG5cbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgY29uc29sZU91dHB1dCwgXCJ1dGY4XCIpXG4gICAgICBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVMb2dQYXRoID0gZmlsZVBhdGhcbiAgICAgIHdyaXR0ZW5Mb2dQYXRocy5wdXNoKGZpbGVQYXRoKVxuICAgIH1cblxuICAgIHJldHVybiB3cml0dGVuTG9nUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKi9cbiAgZ2V0U3VjY2Vzc2Z1bFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldFRlc3RzQ291bnQoKSB7XG4gICAgaWYgKHRoaXMuX3Rlc3RzQ291bnQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RzQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZXhlY3V0ZWQgdGVzdHMgY291bnQuXG4gICAqL1xuICBnZXRFeGVjdXRlZFRlc3RzQ291bnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3BhY2thZ2VSZXN1bHQ/LnRlc3RzLmxlbmd0aCA/PyB0aGlzLl90ZXN0RHVyYXRpb25zLmxlbmd0aFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHRlc3RzIHJlY29yZGVkIGR1cmluZyB0aGUgcnVuLCBzbG93ZXN0IGZpcnN0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2xpbWl0XSAtIE1heGltdW0gbnVtYmVyIG9mIHRlc3RzIHRvIHJldHVybiAoMCByZXR1cm5zIGFsbCkuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlciwgZHVyYXRpb25NczogbnVtYmVyfT59IC0gU2xvd2VzdCB0ZXN0cywgc2xvd2VzdCBmaXJzdC5cbiAgICovXG4gIGdldFNsb3dlc3RUZXN0cyhsaW1pdCA9IDEwKSB7XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnRoaXMuX3Rlc3REdXJhdGlvbnNdLnNvcnQoKHRlc3RBLCB0ZXN0QikgPT4gdGVzdEIuZHVyYXRpb25NcyAtIHRlc3RBLmR1cmF0aW9uTXMpXG5cbiAgICByZXR1cm4gbGltaXQgPiAwID8gc29ydGVkLnNsaWNlKDAsIGxpbWl0KSA6IHNvcnRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlcGFyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHByZXBhcmUoKSB7XG4gICAgdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID0gZmFsc2VcbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9IDBcbiAgICB0aGlzLl9ub3RSdW5UZXN0RGV0YWlscyA9IFtdXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzID0gMFxuICAgIHRoaXMuX3Rlc3RzQ291bnQgPSAwXG4gICAgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IGZhbHNlXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMgPSBbXVxuICAgIHRoaXMuX3Rlc3REdXJhdGlvbnMgPSBbXVxuICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5ID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2luamVjdGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fY29tcGxldGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fdGVzdE1ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2hvb2tNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMgPSBbXVxuICAgIHRoaXMuX3Rlc3RzQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX3BhY2thZ2VSZXN1bHQgPSB1bmRlZmluZWRcbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5nZXRUZXN0Q29udGV4dCgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IG93bmVyRmlsZVBhdGhcblxuICAgIGNvbnRleHQucmVzZXQoe2NvbmZpZzogdHJ1ZX0pXG4gICAgY29udGV4dC5zZXREZWNsYXJhdGlvbkxvY2F0b3IoKCkgPT4gdGhpcy5jYXB0dXJlVGVzdERlY2xhcmF0aW9uTG9jYXRpb24ob3duZXJGaWxlUGF0aCkpXG4gICAgY29uc3QgdGVzdGluZ0NvbmZpZ1BhdGggPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRUZXN0aW5nKClcblxuICAgIGF3YWl0IGNvbnRleHQuZGVzY3JpYmUoXCJcIiwge2RhdGFiYXNlQ2xlYW5pbmc6IHt0cmFuc2FjdGlvbjogdHJ1ZX19LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGVzdGluZ0NvbmZpZ1BhdGgpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5Qcm9maWxlU3Bhbih7cGhhc2U6IFwidGVzdGluZyBjb25maWcvZ2xvYmFsIHNldHVwXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW1wb3J0VGVzdGluZ0NvbmZpZ1BhdGgoKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuaW1wb3J0VGVzdEZpbGVzKClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAoY29uc3QgdGVzdEZpbGUgb2YgdGhpcy5nZXRUZXN0RmlsZXMoKSkge1xuICAgICAgICAgIG93bmVyRmlsZVBhdGggPSB0ZXN0RmlsZVxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUmVnaXN0cmF0aW9ucyA9IHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMoKVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcHJvZmlsZXIubWVhc3VyZVBoYXNlKFwiaW1wb3J0c1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbXBvcnRUZXN0RmlsZXMoW3Rlc3RGaWxlXSlcbiAgICAgICAgICB9LCB7ZmlsZVBhdGg6IHRlc3RGaWxlfSlcbiAgICAgICAgICB0aGlzLmFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAoZXhpc3RpbmdSZWdpc3RyYXRpb25zLCB0ZXN0RmlsZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gICAgb3duZXJGaWxlUGF0aCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuYW5hbHl6ZURlY2xhcmF0aW9ucygpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYSB0ZXN0IHNvdXJjZSBsb2NhdGlvbiB3aXRob3V0IGF0dHJpYnV0aW5nIHBhY2thZ2UvZmFjYWRlIGZyYW1lcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG93bmVyRmlsZVBhdGggLSBJbXBvcnRpbmcgZW50cnkgZmlsZSBmYWxsYmFjay5cbiAgICogQHJldHVybnMge3tmaWxlUGF0aD86IHN0cmluZywgbGluZT86IG51bWJlcn19IC0gRGVjbGFyYXRpb24gbG9jYXRpb24uXG4gICAqL1xuICBjYXB0dXJlVGVzdERlY2xhcmF0aW9uTG9jYXRpb24ob3duZXJGaWxlUGF0aCkge1xuICAgIGNvbnN0IHN0YWNrID0gbmV3IEVycm9yKCkuc3RhY2s/LnNwbGl0KFwiXFxuXCIpIHx8IFtdXG5cbiAgICBmb3IgKGNvbnN0IHN0YWNrTGluZSBvZiBzdGFjaykge1xuICAgICAgY29uc3QgbWF0Y2ggPSBzdGFja0xpbmUubWF0Y2goLyg/OlxcKHxcXHMpKGZpbGU6XFwvXFwvLio/fFxcL1teXCJdKj8pOihcXGQrKTooXFxkKylcXCk/JC91KVxuICAgICAgaWYgKCFtYXRjaCkgY29udGludWVcblxuICAgICAgbGV0IGZpbGVQYXRoID0gbWF0Y2hbMV1cbiAgICAgIGlmIChmaWxlUGF0aC5zdGFydHNXaXRoKFwiZmlsZTovL1wiKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGZpbGVQYXRoID0gZmlsZVVSTFRvUGF0aChmaWxlUGF0aClcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3QgcmVzb2x2ZWRGaWxlUGF0aCA9IHBhdGgucmVzb2x2ZShmaWxlUGF0aClcbiAgICAgIGNvbnN0IHBvcnRhYmxlUGF0aCA9IHJlc29sdmVkRmlsZVBhdGgucmVwbGFjZUFsbChwYXRoLnNlcCwgXCIvXCIpXG5cbiAgICAgIGlmIChwb3J0YWJsZVBhdGguZW5kc1dpdGgoXCIvc3JjL3Rlc3RpbmcvdGVzdC1ydW5uZXIuanNcIikpIGNvbnRpbnVlXG4gICAgICBpZiAocG9ydGFibGVQYXRoLmVuZHNXaXRoKFwiL3NyYy90ZXN0aW5nL3Rlc3QuanNcIikpIGNvbnRpbnVlXG4gICAgICBpZiAocmVzb2x2ZWRGaWxlUGF0aC5zdGFydHNXaXRoKGAke3Rlc3RpbmdQYWNrYWdlRGlyZWN0b3J5fSR7cGF0aC5zZXB9YCkpIGNvbnRpbnVlXG5cbiAgICAgIHJldHVybiB7ZmlsZVBhdGg6IHJlc29sdmVkRmlsZVBhdGgsIGxpbmU6IE51bWJlcihtYXRjaFsyXSl9XG4gICAgfVxuXG4gICAgcmV0dXJuIG93bmVyRmlsZVBhdGggPyB7ZmlsZVBhdGg6IG93bmVyRmlsZVBhdGh9IDoge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFyZSBhbnkgdGVzdHMgZm9jdXNzZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IHRlc3RzIGZvY3Vzc2VkLlxuICAgKi9cbiAgYXJlQW55VGVzdHNGb2N1c3NlZCgpIHtcbiAgICBpZiAodGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkhhc24ndCBiZWVuIGRldGVjdGVkIHlldFwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFueVRlc3RzRm9jdXNzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGFzeW5jaHJvbm91cyBjcmFzaCAoYW4gdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uIGRldGFjaGVkIGZyb21cbiAgICogYW55IGF3YWl0LCBlLmcuIGEgYHZvaWQgY29ubmVjdGlvbi5hZnRlckNvbW1pdChhc3luYyAoKSA9PiBicm9hZGNhc3QoLi4uKSlgXG4gICAqIGZyb250ZW5kLW1vZGVsIHB1Ymxpc2gg4oCUIG9yIGEgc3luY2hyb25vdXMgdGhyb3cgaW5zaWRlIGEgZGV0YWNoZWQgY2FsbGJhY2tcbiAgICogc3VjaCBhcyBhIGRyaXZlciBzb2NrZXQgb3IgdGltZXIgY2FsbGJhY2spIGFzIGEgcmVhbCwgdmlzaWJsZSwgYXR0cmlidXRlZFxuICAgKiB0ZXN0IGZhaWx1cmUuXG4gICAqXG4gICAqIFdpdGhvdXQgdGhpcywgc3VjaCBhIHJlamVjdGlvbi9leGNlcHRpb24gaGFzIG5vIGhhbmRsZXIsIHNvIG9uIG1vZGVybiBOb2RlXG4gICAqIHRoZSBwcm9jZXNzIGlzIFRFUk1JTkFURUQg4oCUIHRoZSBydW4gZW5kcyB3aXRoIG5vIHJlcG9ydGVkIGZhaWx1cmVzIGFuZCBDSVxuICAgKiBqdXN0IHNlZXMgYSBjcmFzaGVkL3JldHJpZWQgc2hhcmQgd2l0aCBhbiBlbXB0eSByZXN1bHQgKHRoZSByZWN1cnJpbmdcbiAgICogXCJzaWxlbnQgdGVzdC1ydW5uZXIgZGVhdGhcIjogaW52aXNpYmxlIGFuZCBpbXBvc3NpYmxlIHRvIGRpYWdub3NlKS4gVHVybmluZ1xuICAgKiBpdCBpbnRvIGEgZmFpbHVyZSBtYWtlcyB0aGUgcnVuIGdvIHJlZCB3aXRoIHNvbWV0aGluZyBkZWJ1Z2dhYmxlIGluc3RlYWQgb2ZcbiAgICogdmFuaXNoaW5nLlxuICAgKiBAcGFyYW0ge1widW5jYXVnaHRFeGNlcHRpb25cIiB8IFwidW5oYW5kbGVkUmVqZWN0aW9uXCJ9IGtpbmQgLSBBc3luYy1jcmFzaCBraW5kLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIFJlamVjdGlvbiByZWFzb24gb3IgdGhyb3duIGVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEFzeW5jQ3Jhc2goa2luZCwgcmVhc29uKSB7XG4gICAgY29uc3QgZXJyb3IgPSByZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHJlYXNvbiA6IG5ldyBFcnJvcihgJHtraW5kfTogJHtTdHJpbmcocmVhc29uKX1gKVxuICAgIGNvbnN0IG5lYXIgPSB0aGlzLl9sYXN0VGVzdENvbnRleHRcbiAgICBjb25zdCBhdHRyaWJ1dGlvbiA9IG5lYXIgPyBgLCBuZWFyIHRlc3Q6ICR7bmVhci5mdWxsRGVzY3JpcHRpb259ICgke25lYXIuZmlsZVBhdGh9OiR7bmVhci5saW5lfSlgIDogXCJcIlxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAodGhpcy5fZmFpbGVkVGVzdHMgfHwgMCkgKyAxXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IGA8JHtraW5kfSBkdXJpbmcgdGVzdCBydW4ke2F0dHJpYnV0aW9ufT5gLFxuICAgICAgZmlsZVBhdGg6IG5lYXIgPyBuZWFyLmZpbGVQYXRoIDogXCI8dGVzdCBydW5uZXI+XCIsXG4gICAgICBsaW5lOiBuZWFyID8gbmVhci5saW5lIDogMCxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYFxcblt0ZXN0LXJ1bm5lcl0gJHtraW5kfSBkdXJpbmcgdGhlIHRlc3QgcnVuIOKAlCB0aGlzIHdvdWxkIG90aGVyd2lzZSB0ZXJtaW5hdGUgdGhlIHByb2Nlc3Mgc2lsZW50bHkgYW5kIHN1cmZhY2Ugb25seSBhcyBhIGNyYXNoZWQvcmV0cmllZCBzaGFyZCB3aXRoIHplcm8gcmVwb3J0ZWQgZmFpbHVyZXMuJHthdHRyaWJ1dGlvbn1gKSlcbiAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBjbGVhbnVwIGZhaWx1cmUgYWZ0ZXIgdGltZW91dCBoYW5kbGluZyBoYXMgYmVndW4uXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gRGV0YWNoZWQgY2xlYW51cCByZWplY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjbGVhbnVwTmFtZSAtIENsZWFudXAgb3BlcmF0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7U2V0PEVycm9yPn0gW3JlY29yZGVkRXJyb3JzXSAtIEF0dGVtcHQtb3duZWQgY2xlYW51cCBlcnJvcnMgYWxyZWFkeSByZXBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUocmVhc29uLCBjbGVhbnVwTmFtZSwgcmVjb3JkZWRFcnJvcnMpIHtcbiAgICBjb25zdCBlcnJvciA9IHJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gcmVhc29uIDogbmV3IEVycm9yKGAke2NsZWFudXBOYW1lfSBjbGVhbnVwIGZhaWxlZDogJHtTdHJpbmcocmVhc29uKX1gKVxuXG4gICAgaWYgKHJlY29yZGVkRXJyb3JzKSB7XG4gICAgICAvLyBNdWx0aXBsZSBib3VuZGVkIG9ic2VydmVycyBjYW4gcmVjZWl2ZSB0aGUgc2FtZSBkZXRhY2hlZCBjbGVhbnVwIHJlamVjdGlvbi5cbiAgICAgIGlmIChyZWNvcmRlZEVycm9ycy5oYXMoZXJyb3IpKSByZXR1cm5cbiAgICAgIHJlY29yZGVkRXJyb3JzLmFkZChlcnJvcilcbiAgICB9XG5cbiAgICBjb25zdCBuZWFyID0gdGhpcy5fbGFzdFRlc3RDb250ZXh0XG4gICAgY29uc3QgYXR0cmlidXRpb24gPSBuZWFyID8gYCwgbmVhciB0ZXN0OiAke25lYXIuZnVsbERlc2NyaXB0aW9ufSAoJHtuZWFyLmZpbGVQYXRofToke25lYXIubGluZX0pYCA6IFwiXCJcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gKHRoaXMuX2ZhaWxlZFRlc3RzIHx8IDApICsgMVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiBgPCR7Y2xlYW51cE5hbWV9IGVtZXJnZW5jeSBjbGVhbnVwIGZhaWx1cmUke2F0dHJpYnV0aW9ufT5gLFxuICAgICAgZmlsZVBhdGg6IG5lYXIgPyBuZWFyLmZpbGVQYXRoIDogXCI8dGVzdCBydW5uZXI+XCIsXG4gICAgICBsaW5lOiBuZWFyID8gbmVhci5saW5lIDogMCxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYFxcblt0ZXN0LXJ1bm5lcl0gJHtjbGVhbnVwTmFtZX0gY2xlYW51cCBmYWlsZWQgYWZ0ZXIgdGltZW91dCBoYW5kbGluZyBiZWdhbi4ke2F0dHJpYnV0aW9ufWApKVxuICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gIH1cblxuICBhc3luYyBydW4oKSB7XG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIHByb2Nlc3MtbGV2ZWwgdW5oYW5kbGVkIHJlamVjdGlvbiBkdXJpbmcgdGhlIHJ1bi5cbiAgICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIFJlamVjdGlvbiByZWFzb24uXG4gICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICovXG4gICAgY29uc3Qgb25VbmhhbmRsZWRSZWplY3Rpb24gPSAocmVhc29uKSA9PiB7XG4gICAgICAvLyBJZiBhIHRlc3QgYXR0YWNoZWQgaXRzIE9XTiB1bmhhbmRsZWRSZWplY3Rpb24gbGlzdGVuZXIsIGl0IGlzXG4gICAgICAvLyBpbnRlbnRpb25hbGx5IG9ic2VydmluZy90cmlnZ2VyaW5nIHRoZSByZWplY3Rpb24gKGUuZy4gYmVhY29uXG4gICAgICAvLyBlcnJvci1yZXBvcnRpbmctc3BlYy5qcykg4oCUIE5vZGUgZGlzcGF0Y2hlcyB0byBFVkVSWSBsaXN0ZW5lciwgc28gYWxzb1xuICAgICAgLy8gZmFpbGluZyB0aGUgc3VpdGUgaGVyZSB3b3VsZCBicmVhayB0aG9zZSB0ZXN0cy4gRGVmZXIgdG8gdGhlIHRlc3Qnc1xuICAgICAgLy8gaGFuZGxlcjsgb25seSB0cmVhdCBhIHJlamVjdGlvbiBhcyBhIHNpbGVudC1kZWF0aCBjcmFzaCB3aGVuIG91cnMgaXMgdGhlXG4gICAgICAvLyBzb2xlIGxpc3RlbmVyIChubyBwZXJzaXN0ZW50IGZyYW1ld29yayBsaXN0ZW5lciBleGlzdHMgdG8gbWFzayB0aGlzKS5cbiAgICAgIGlmIChwcm9jZXNzLmxpc3RlbmVyQ291bnQoXCJ1bmhhbmRsZWRSZWplY3Rpb25cIikgPiAxKSByZXR1cm5cblxuICAgICAgdGhpcy5yZWNvcmRBc3luY0NyYXNoKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIHJlYXNvbilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgcHJvY2Vzcy1sZXZlbCB1bmNhdWdodCBleGNlcHRpb24gZHVyaW5nIHRoZSBydW4g4oCUIGFcbiAgICAgKiBzeW5jaHJvbm91cyB0aHJvdyBpbnNpZGUgYSBkZXRhY2hlZCBjYWxsYmFjayAoZHJpdmVyIHNvY2tldCwgdGltZXIsXG4gICAgICogZXZlbnQgZW1pdHRlcikgdGhhdCBubyB0ZXN0IGF3YWl0IG9ic2VydmVzLiBTYW1lIHNpbGVudC1kZWF0aCBtb2RlIGFzXG4gICAgICogdW5oYW5kbGVkIHJlamVjdGlvbnM6IHdpdGhvdXQgYSBoYW5kbGVyIHRoZSBwcm9jZXNzIGRpZXMgbWlkLXJ1biBhbmQgQ0lcbiAgICAgKiBzZWVzIGEgY3Jhc2hlZCBzaGFyZCB3aXRoIHplcm8gcmVwb3J0ZWQgZmFpbHVyZXMuXG4gICAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIFRocm93biBlcnJvci5cbiAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgKi9cbiAgICBjb25zdCBvblVuY2F1Z2h0RXhjZXB0aW9uID0gKGVycm9yKSA9PiB7XG4gICAgICAvLyBNaXJyb3IgdGhlIHVuaGFuZGxlZFJlamVjdGlvbiBkZWZlcnJhbDogYSB0ZXN0IG9ic2VydmluZy90cmlnZ2VyaW5nXG4gICAgICAvLyB1bmNhdWdodCBleGNlcHRpb25zIHdpdGggaXRzIG93biBsaXN0ZW5lciBvd25zIHRoZW0uXG4gICAgICBpZiAocHJvY2Vzcy5saXN0ZW5lckNvdW50KFwidW5jYXVnaHRFeGNlcHRpb25cIikgPiAxKSByZXR1cm5cblxuICAgICAgdGhpcy5yZWNvcmRBc3luY0NyYXNoKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgZXJyb3IpXG4gICAgfVxuXG4gICAgcHJvY2Vzcy5vbihcInVuaGFuZGxlZFJlamVjdGlvblwiLCBvblVuaGFuZGxlZFJlamVjdGlvbilcbiAgICBwcm9jZXNzLm9uKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgb25VbmNhdWdodEV4Y2VwdGlvbilcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blBhY2thZ2VUZXN0cygpXG5cbiAgICAgIC8vIEEgcmVqZWN0aW9uIHNjaGVkdWxlZCBieSB0aGUgZmluYWwgdGVzdCAoYSBkZXRhY2hlZCByZWplY3RlZCBwcm9taXNlLFxuICAgICAgLy8gb3IgYW4gYWZ0ZXJDb21taXQgY2FsbGJhY2sgcmVqZWN0aW5nIGFzIHRoZSBzdWl0ZSBkcmFpbnMpIGlzIHJlcG9ydGVkXG4gICAgICAvLyBieSBOb2RlIG9uIGEgTEFURVIgdHVybi4gRHJhaW4gYSBmZXcgdHVybnMgd2hpbGUgdGhlIGhhbmRsZXIgaXMgc3RpbGxcbiAgICAgIC8vIGF0dGFjaGVkIHNvIHRob3NlIGxhdGUgcmVqZWN0aW9ucyBhcmUgcmVjb3JkZWQgaW5zdGVhZCBvZiBlc2NhcGluZyB0b1xuICAgICAgLy8gdGhlIGRlZmF1bHQgY3Jhc2ggcGF0aCBhZnRlciBjbGVhbnVwLlxuICAgICAgZm9yIChsZXQgZHJhaW5UdXJuID0gMDsgZHJhaW5UdXJuIDwgMzsgZHJhaW5UdXJuKyspIHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldEltbWVkaWF0ZShyZXNvbHZlKSlcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgcHJvY2Vzcy5vZmYoXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgb25VbmhhbmRsZWRSZWplY3Rpb24pXG4gICAgICBwcm9jZXNzLm9mZihcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIG9uVW5jYXVnaHRFeGNlcHRpb24pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGFmdGVyIGFsbHMgZm9yIGFjdGl2ZSBzY29wZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYW51cCBob29rcyBmaW5pc2guXG4gICAqL1xuICBhc3luYyBydW5BZnRlckFsbHNGb3JBY3RpdmVTY29wZXMoKSB7XG4gICAgY29uc3QgZmFpbHVyZVN0YXJ0ID0gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMubGVuZ3RoXG5cbiAgICBhd2FpdCB0aGlzLl9wYWNrYWdlUnVubmVyPy5jbGVhbnVwQWN0aXZlU3VpdGVzKClcbiAgICB0aGlzLnRocm93QWZ0ZXJBbGxGYWlsdXJlcyh0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5zbGljZShmYWlsdXJlU3RhcnQpKVxuICB9XG5cbiAgLyoqIEJ1aWxkcyBkZWNsYXJhdGlvbiBtZXRhZGF0YSB1c2VkIG9ubHkgYnkgZnJhbWV3b3JrIGFkYXB0ZXJzIGFuZCBwcm9qZWN0aW9ucy4gKi9cbiAgYW5hbHl6ZURlY2xhcmF0aW9ucygpIHtcbiAgICBjb25zdCB2aXNpdCA9ICgvKiogQHR5cGUge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSAqLyBzdWl0ZSwgLyoqIEB0eXBlIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltdfSAqLyBhbmNlc3RvcnMsIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqLyBwYXJlbnRQcm9maWxlU2NvcGVJZCkgPT4ge1xuICAgICAgY29uc3Qgc3VpdGVzID0gWy4uLmFuY2VzdG9ycywgc3VpdGVdXG4gICAgICBjb25zdCBkZXNjcmlwdGlvbnMgPSBzdWl0ZXMubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSkuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcIlwiKVxuICAgICAgY29uc3Qgb3duZXJGaWxlUGF0aCA9IHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLmdldChzdWl0ZSkgPz8gc3VpdGUubG9jYXRpb24uZmlsZVBhdGhcbiAgICAgIGNvbnN0IHByb2ZpbGVTY29wZUlkID0gdGhpcy5fcHJvZmlsZXI/LnNjb3BlSWQoc3VpdGUsIHtcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBmaWxlUGF0aDogb3duZXJGaWxlUGF0aCxcbiAgICAgICAgbGluZTogc3VpdGUubG9jYXRpb24ubGluZSxcbiAgICAgICAgcGFyZW50SWQ6IHBhcmVudFByb2ZpbGVTY29wZUlkXG4gICAgICB9KVxuXG4gICAgICBmb3IgKGNvbnN0IGhvb2tzIG9mIE9iamVjdC52YWx1ZXMoc3VpdGUuaG9va3MpKSB7XG4gICAgICAgIGhvb2tzLmZvckVhY2goKGhvb2ssIGRlY2xhcmF0aW9uSW5kZXgpID0+IHtcbiAgICAgICAgICB0aGlzLl9ob29rTWV0YWRhdGEuc2V0KGhvb2ssIHtcbiAgICAgICAgICAgIGRlY2xhcmF0aW9uSW5kZXgsXG4gICAgICAgICAgICBkZWNsYXJhdGlvblNjb3BlSWQ6IHByb2ZpbGVTY29wZUlkLFxuICAgICAgICAgICAgb3duZXJGaWxlUGF0aDogdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuZ2V0KGhvb2spID8/IGhvb2subG9jYXRpb24uZmlsZVBhdGggPz8gb3duZXJGaWxlUGF0aFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgdGVzdERlY2xhcmF0aW9uIG9mIHN1aXRlLnRlc3RzKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxEZXNjcmlwdGlvbiA9IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVjbGFyYXRpb24ubmFtZSlcbiAgICAgICAgY29uc3QgZGVjbGFyYXRpb25zID0gdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLmdldChmdWxsRGVzY3JpcHRpb24pIHx8IFtdXG5cbiAgICAgICAgZGVjbGFyYXRpb25zLnB1c2godGVzdERlY2xhcmF0aW9uKVxuICAgICAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUuc2V0KGZ1bGxEZXNjcmlwdGlvbiwgZGVjbGFyYXRpb25zKVxuICAgICAgICB0aGlzLl90ZXN0TWV0YWRhdGEuc2V0KHRlc3REZWNsYXJhdGlvbiwge1xuICAgICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgICB0ZXN0RGVzY3JpcHRpb246IHRlc3REZWNsYXJhdGlvbi5uYW1lLFxuICAgICAgICAgIGZ1bGxEZXNjcmlwdGlvbixcbiAgICAgICAgICBvd25lckZpbGVQYXRoOiB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5nZXQodGVzdERlY2xhcmF0aW9uKSA/PyB0ZXN0RGVjbGFyYXRpb24ubG9jYXRpb24uZmlsZVBhdGggPz8gb3duZXJGaWxlUGF0aCxcbiAgICAgICAgICBzdWl0ZXNcbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgbGVnYWN5VGVzdERhdGEgPSB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWU/LmdldChmdWxsRGVzY3JpcHRpb24pXG4gICAgICAgIGlmIChsZWdhY3lUZXN0RGF0YSkge1xuICAgICAgICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5LnNldCh0ZXN0RGVjbGFyYXRpb24sIHtcbiAgICAgICAgICAgIHRlc3RBcmdzOiB0aGlzLl90ZXN0QXJndW1lbnRzLmNvcHkodGVzdERlY2xhcmF0aW9uKSxcbiAgICAgICAgICAgIHRlc3REYXRhOiBsZWdhY3lUZXN0RGF0YVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdGVzdHNDb3VudCsrXG4gICAgICAgIGlmICh0ZXN0RGVjbGFyYXRpb24uc3RhdGUgPT09IFwicnVuXCIgJiYgKHRlc3REZWNsYXJhdGlvbi5mb2N1cyB8fCBzdWl0ZXMuc29tZSgoZW50cnkpID0+IGVudHJ5LmZvY3VzKSkpIHtcbiAgICAgICAgICB0aGlzLmFueVRlc3RzRm9jdXNzZWQgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjaGlsZFN1aXRlIG9mIHN1aXRlLnN1aXRlcykgdmlzaXQoY2hpbGRTdWl0ZSwgc3VpdGVzLCBwcm9maWxlU2NvcGVJZClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHN1aXRlIG9mIHRoaXMuZ2V0VGVzdENvbnRleHQoKS5yZWdpc3RyeS5zdWl0ZXMpIHZpc2l0KHN1aXRlLCBbXSwgdW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGFja2FnZSBob29rIGNvbXBhdGliaWxpdHkgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7UGFja2FnZUhvb2tEZWNsYXJhdGlvbn0gaG9vayAtIFBhY2thZ2UgaG9vayBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3tkZWNsYXJhdGlvbkluZGV4OiBudW1iZXIsIGRlY2xhcmF0aW9uU2NvcGVJZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIEhvb2sgbWV0YWRhdGEuXG4gICAqL1xuICBob29rTWV0YWRhdGEoaG9vaykge1xuICAgIHJldHVybiB0aGlzLl9ob29rTWV0YWRhdGEuZ2V0KGhvb2spIHx8IHtkZWNsYXJhdGlvbkluZGV4OiAwLCBkZWNsYXJhdGlvblNjb3BlSWQ6IHVuZGVmaW5lZCwgb3duZXJGaWxlUGF0aDogaG9vay5sb2NhdGlvbi5maWxlUGF0aH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBhY2thZ2UgdGVzdCBjb21wYXRpYmlsaXR5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZGVzY3JpcHRpb25zOiBzdHJpbmdbXSwgdGVzdERlc2NyaXB0aW9uOiBzdHJpbmcsIGZ1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsIHN1aXRlczogUGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXX19IC0gRGVjbGFyYXRpb24gbWV0YWRhdGEuXG4gICAqL1xuICB0ZXN0TWV0YWRhdGEodGVzdCkge1xuICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy5fdGVzdE1ldGFkYXRhLmdldCh0ZXN0KVxuICAgIGlmICghbWV0YWRhdGEpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwYWNrYWdlIHRlc3QgbWV0YWRhdGE6ICR7dGVzdC5uYW1lfWApXG4gICAgcmV0dXJuIG1ldGFkYXRhXG4gIH1cblxuICAvKipcbiAgICogR2V0cyBzdGFibGUgY29tcGF0aWJpbGl0eSBkYXRhIGZvciBhIHBhY2thZ2UgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3t0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX19IC0gU3RhYmxlIGNvbXBhdGliaWxpdHkgZGF0YS5cbiAgICovXG4gIHRlc3REYXRhKHRlc3QpIHtcbiAgICBsZXQgY29tcGF0aWJpbGl0eSA9IHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5LmdldCh0ZXN0KVxuXG4gICAgaWYgKCFjb21wYXRpYmlsaXR5KSB7XG4gICAgICBjb25zdCB0ZXN0QXJncyA9IHRoaXMuX3Rlc3RBcmd1bWVudHMuY29weSh0ZXN0KVxuICAgICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnRlc3RNZXRhZGF0YSh0ZXN0KVxuICAgICAgY29uc3QgdGVzdERhdGEgPSB7XG4gICAgICAgIGFyZ3M6IHRlc3RBcmdzLFxuICAgICAgICBkZWNsYXJhdGlvbjogdGVzdCxcbiAgICAgICAgZmlsZVBhdGg6IHRlc3QubG9jYXRpb24uZmlsZVBhdGgsXG4gICAgICAgIGZ1bmN0aW9uOiB0ZXN0LmNhbGxiYWNrLFxuICAgICAgICBsaW5lOiB0ZXN0LmxvY2F0aW9uLmxpbmUsXG4gICAgICAgIG93bmVyRmlsZVBhdGg6IG1ldGFkYXRhLm93bmVyRmlsZVBhdGhcbiAgICAgIH1cbiAgICAgIGNvbXBhdGliaWxpdHkgPSB7dGVzdEFyZ3MsIHRlc3REYXRhfVxuICAgICAgdGhpcy5fdGVzdENvbXBhdGliaWxpdHkuc2V0KHRlc3QsIGNvbXBhdGliaWxpdHkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBhdGliaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbmplY3RzIGZyYW1ld29yayBjb2xsYWJvcmF0b3JzIGludG8gc3RhYmxlIGNvbXBhdGliaWxpdHkgZGF0YSBvbmNlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHt0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0+fSAtIEluamVjdGVkIGNvbXBhdGliaWxpdHkgZGF0YS5cbiAgICovXG4gIGFzeW5jIHRlc3RDb21wYXRpYmlsaXR5KHRlc3QpIHtcbiAgICBjb25zdCBjb21wYXRpYmlsaXR5ID0gdGhpcy50ZXN0RGF0YSh0ZXN0KVxuXG4gICAgaWYgKCF0aGlzLl9pbmplY3RlZFRlc3RzLmhhcyh0ZXN0KSkge1xuICAgICAgYXdhaXQgdGhpcy5fdGVzdEFyZ3VtZW50cy5pbmplY3QoY29tcGF0aWJpbGl0eS50ZXN0QXJncylcbiAgICAgIHRoaXMuX2luamVjdGVkVGVzdHMuYWRkKHRlc3QpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBhdGliaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgcmF3IGZyYW1ld29yayBhdHRlbXB0IG91dGNvbWUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHROdW1iZXIgLSBPbmUtYmFzZWQgYXR0ZW1wdCBudW1iZXIuXG4gICAqIEBwYXJhbSB7e2Fib3J0UmVtYWluaW5nVGVzdHM6IGJvb2xlYW4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZmFpbGVkOiBib29sZWFufX0gb3V0Y29tZSAtIFJhdyBhdHRlbXB0IG91dGNvbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQXR0ZW1wdE91dGNvbWUodGVzdCwgYXR0ZW1wdE51bWJlciwgb3V0Y29tZSkge1xuICAgIGNvbnN0IG91dGNvbWVzID0gdGhpcy5fYXR0ZW1wdE91dGNvbWVzLmdldCh0ZXN0KSB8fCBuZXcgTWFwKClcbiAgICBvdXRjb21lcy5zZXQoYXR0ZW1wdE51bWJlciwgb3V0Y29tZSlcbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMuc2V0KHRlc3QsIG91dGNvbWVzKVxuICAgIGlmIChvdXRjb21lLmFib3J0UmVtYWluaW5nVGVzdHMpIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogR2V0cyBhIHJhdyBmcmFtZXdvcmsgYXR0ZW1wdCBvdXRjb21lLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7e2Fib3J0UmVtYWluaW5nVGVzdHM6IGJvb2xlYW4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZmFpbGVkOiBib29sZWFufSB8IHVuZGVmaW5lZH0gLSBSYXcgYXR0ZW1wdCBvdXRjb21lLlxuICAgKi9cbiAgYXR0ZW1wdE91dGNvbWUodGVzdCwgYXR0ZW1wdE51bWJlcikgeyByZXR1cm4gdGhpcy5fYXR0ZW1wdE91dGNvbWVzLmdldCh0ZXN0KT8uZ2V0KGF0dGVtcHROdW1iZXIpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHJhdyBzdWl0ZS1ob29rIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBmYWlsdXJlIC0gU3VpdGUtaG9vayBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSBmYWlsdXJlLnN1aXRlIC0gT3duaW5nIHBhY2thZ2Ugc3VpdGUuXG4gICAqIEBwYXJhbSB7XCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIn0gZmFpbHVyZS5waGFzZSAtIEhvb2sgcGhhc2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGZhaWx1cmUuZXJyb3IgLSBSYXcgaG9vayBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFN1aXRlSG9va0ZhaWx1cmUoZmFpbHVyZSkgeyB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5wdXNoKGZhaWx1cmUpIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgcmF3IGFuY2VzdG9yIHNldHVwIGZhaWx1cmUgb3V0Y29tZSBmb3IgYSBwYWNrYWdlIHRlc3QuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3tmYWlsZWQ6IGZhbHNlfSB8IHtmYWlsZWQ6IHRydWUsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IC0gUmF3IHNldHVwIGZhaWx1cmUgb3V0Y29tZS5cbiAgICovXG4gIHNldHVwRmFpbHVyZU91dGNvbWVGb3IodGVzdCkge1xuICAgIGNvbnN0IHN1aXRlcyA9IHRoaXMudGVzdE1ldGFkYXRhKHRlc3QpLnN1aXRlc1xuICAgIGNvbnN0IGZhaWx1cmUgPSB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5maW5kKChlbnRyeSkgPT4gZW50cnkucGhhc2UgPT09IFwiYmVmb3JlQWxsXCIgJiYgc3VpdGVzLmluY2x1ZGVzKGVudHJ5LnN1aXRlKSlcblxuICAgIHJldHVybiBmYWlsdXJlID8ge2ZhaWxlZDogdHJ1ZSwgZXJyb3I6IGZhaWx1cmUuZXJyb3J9IDoge2ZhaWxlZDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIG5leHQgaW5jb21wbGV0ZSBkZWNsYXJhdGlvbiB3aXRoIGEgcGFja2FnZSBmdWxsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmdWxsTmFtZSAtIFBhY2thZ2UgZnVsbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UGFja2FnZVRlc3REZWNsYXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOZXh0IG1hdGNoaW5nIGRlY2xhcmF0aW9uLlxuICAgKi9cbiAgZmluZFRlc3REZWNsYXJhdGlvbihmdWxsTmFtZSkge1xuICAgIHJldHVybiB0aGlzLl90ZXN0c0J5RnVsbE5hbWUuZ2V0KGZ1bGxOYW1lKT8uZmluZCgodGVzdCkgPT4gIXRoaXMuX2NvbXBsZXRlZFRlc3RzLmhhcyh0ZXN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBhIHBhY2thZ2UgZGVjbGFyYXRpb24gY29tcGxldGUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIENvbXBsZXRlZCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb21wbGV0ZVRlc3REZWNsYXJhdGlvbih0ZXN0KSB7IHRoaXMuX2NvbXBsZXRlZFRlc3RzLmFkZCh0ZXN0KSB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGVmZmVjdGl2ZSBwYWNrYWdlIHJldHJ5IGNvdW50LlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRWZmZWN0aXZlIHJldHJ5IGNvdW50LlxuICAgKi9cbiAgcmV0cnlDb3VudCh0ZXN0KSB7XG4gICAgY29uc3QgdmFsdWUgPSB0ZXN0Lm9wdGlvbnMucmV0cmllcyA/PyB0ZXN0Lm9wdGlvbnMucmV0cnkgPz8gdGhpcy5nZXRUZXN0Q29udGV4dCgpLmNvbmZpZy5yZXRyaWVzXG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpID8gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcih2YWx1ZSkpIDogMFxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgcmV0cnkgaW5wdXRzIGZvciB0aGUgcGFja2FnZSBleGVjdXRpb24gYm91bmRhcnkgd2hpbGUgcmV0YWluaW5nXG4gICAqIHRoZSBkZWNsYXJhdGlvbnMnIG9yaWdpbmFsIHB1YmxpYyBvcHRpb25zIGFmdGVyIHRoZSBydW4uXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIFJlc3RvcmVzIG9yaWdpbmFsIGRlY2xhcmF0aW9uIG9wdGlvbnMuXG4gICAqL1xuICBub3JtYWxpemVQYWNrYWdlUmV0cmllc0ZvckV4ZWN1dGlvbigpIHtcbiAgICAvKiogQHR5cGUge1BhY2thZ2VSZXRyeU9wdGlvblJlc3RvcmF0aW9uW119ICovXG4gICAgY29uc3QgcmVzdG9yYXRpb25zID0gW11cbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemVzIGRlY2xhcmF0aW9ucyBpbiBvbmUgc3VpdGUuXG4gICAgICogQHBhcmFtIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gc3VpdGUgLSBTdWl0ZSB3aG9zZSB0ZXN0cyBhcmUgbm9ybWFsaXplZC5cbiAgICAgKi9cbiAgICBjb25zdCB2aXNpdCA9IChzdWl0ZSkgPT4ge1xuICAgICAgZm9yIChjb25zdCB0ZXN0IG9mIHN1aXRlLnRlc3RzKSB7XG4gICAgICAgIC8vIENhcHR1cmUgY29tcGF0aWJpbGl0eSBhcmd1bWVudHMgYmVmb3JlIHRlbXBvcmFyaWx5IGFkYXB0aW5nIHBhY2thZ2VcbiAgICAgICAgLy8gZXhlY3V0aW9uIG9wdGlvbnMgc28gY2FsbGJhY2tzIHJldGFpbiB0aGVpciBkZWNsYXJlZCB2YWx1ZXMvaWRlbnRpdHkuXG4gICAgICAgIHRoaXMudGVzdERhdGEodGVzdClcbiAgICAgICAgcmVzdG9yYXRpb25zLnB1c2goe1xuICAgICAgICAgIGhhZFJldHJpZXM6IE9iamVjdC5oYXNPd24odGVzdC5vcHRpb25zLCBcInJldHJpZXNcIiksXG4gICAgICAgICAgb3B0aW9uczogdGVzdC5vcHRpb25zLFxuICAgICAgICAgIHJldHJpZXM6IHRlc3Qub3B0aW9ucy5yZXRyaWVzXG4gICAgICAgIH0pXG4gICAgICAgIHRlc3Qub3B0aW9ucy5yZXRyaWVzID0gdGhpcy5yZXRyeUNvdW50KHRlc3QpXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgY2hpbGRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIHZpc2l0KGNoaWxkU3VpdGUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWl0ZSBvZiB0aGlzLmdldFRlc3RDb250ZXh0KCkucmVnaXN0cnkuc3VpdGVzKSB2aXNpdChzdWl0ZSlcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IHJlc3RvcmF0aW9uIG9mIHJlc3RvcmF0aW9ucykge1xuICAgICAgICBpZiAocmVzdG9yYXRpb24uaGFkUmV0cmllcykgcmVzdG9yYXRpb24ub3B0aW9ucy5yZXRyaWVzID0gcmVzdG9yYXRpb24ucmV0cmllc1xuICAgICAgICBlbHNlIGRlbGV0ZSByZXN0b3JhdGlvbi5vcHRpb25zLnJldHJpZXNcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgY29tcGxldGVkIHRlc3QgZHVyYXRpb24uXG4gICAqIEBwYXJhbSB7e2R1cmF0aW9uTXM6IG51bWJlciwgZmlsZVBhdGg6IHN0cmluZywgZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGxpbmU6IG51bWJlcn19IGR1cmF0aW9uIC0gQ29tcGxldGVkIHRlc3QgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkVGVzdER1cmF0aW9uKGR1cmF0aW9uKSB7IHRoaXMuX3Rlc3REdXJhdGlvbnMucHVzaChkdXJhdGlvbikgfVxuXG4gIC8qKiBSZWNvcmRzIG9uZSBzdWNjZXNzZnVsIHBhY2thZ2UgcmVzdWx0LiAqL1xuICByZWNvcmRTdWNjZXNzZnVsVGVzdCgpIHsgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzKysgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBmYWlsZWQgcGFja2FnZSB0ZXN0IGluIHRoZSBsZWdhY3kgcmVzdWx0IHByb2plY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbGVkIHRlc3QgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gUGFyZW50IGRlc2NyaXB0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJhdyBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb25zb2xlT3V0cHV0IC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBDb21wYXRpYmlsaXR5IHRlc3QgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRGYWlsZWRUZXN0KHtkZXNjcmlwdGlvbnMsIGVycm9yLCBjb25zb2xlT3V0cHV0LCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9ufSkge1xuICAgIHRoaXMuX2ZhaWxlZFRlc3RzKytcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiksXG4gICAgICBmaWxlUGF0aDogdGVzdERhdGEuZmlsZVBhdGgsXG4gICAgICBsaW5lOiB0ZXN0RGF0YS5saW5lLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiBjb25zb2xlT3V0cHV0IHx8IHVuZGVmaW5lZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3RvcmVzIHRoZSBjb21wbGV0ZWQgcGFja2FnZSByZXN1bHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0UnVuUmVzdWx0fSByZXN1bHQgLSBQYWNrYWdlIHJlc3VsdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRQYWNrYWdlUmVzdWx0KHJlc3VsdCkgeyB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gcmVzdWx0IH1cblxuICAvKipcbiAgICogUnVucyB0aGUgcGFja2FnZSBrZXJuZWwgd2l0aCBWZWxvY2lvdXMgZnJhbWV3b3JrIGFkYXB0ZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBleGVjdXRpb24gYW5kIHRlYXJkb3duLlxuICAgKi9cbiAgYXN5bmMgcnVuUGFja2FnZVRlc3RzKCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG4gICAgZW52aXJvbm1lbnRIYW5kbGVyLmluc3RhbGxTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlKHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UpXG4gICAgZW52aXJvbm1lbnRIYW5kbGVyLmluc3RhbGxUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UodGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKVxuICAgIHRoaXMuX3BhY2thZ2VSdW5uZXIgPSBuZXcgUGFja2FnZVRlc3RSdW5uZXIoe1xuICAgICAgY29udGV4dDogdGhpcy5nZXRUZXN0Q29udGV4dCgpLFxuICAgICAgaW5jbHVkZVRhZ3M6IHRoaXMuX2luY2x1ZGVUYWdzLFxuICAgICAgZXhjbHVkZVRhZ3M6IFsuLi50aGlzLmdldEV4Y2x1ZGVUYWdTZXQoKSwgLi4uKHRoaXMuaXNCcm93c2VyVGVzdE1vZGUoKSA/IFtdIDogW1wiYnJvd3Nlci1vbmx5XCJdKV0sXG4gICAgICBleGFtcGxlczogdGhpcy5nZXRFeGFtcGxlUGF0dGVybnMoKSxcbiAgICAgIGxpbmVGaWx0ZXJzOiB0aGlzLmdldExpbmVGaWx0ZXJzKCksXG4gICAgICBpbmNsdWRlVGFnTW9kZTogXCJhbnlcIixcbiAgICAgIGZvY3VzZWRUZXN0c0J5cGFzc0luY2x1ZGVUYWdzOiB0cnVlLFxuICAgICAgb21pdEVtcHR5U3VpdGVOYW1lczogdHJ1ZSxcbiAgICAgIGF0dGVtcHRFeGVjdXRvck93bnNUaW1lb3V0OiB0cnVlLFxuICAgICAgYXR0ZW1wdEV4ZWN1dG9yOiAoaW5wdXQpID0+IHRoaXMuX2F0dGVtcHRFeGVjdXRvci5leGVjdXRlKGlucHV0KSxcbiAgICAgIHRlc3RBcmd1bWVudFJlc29sdmVyOiAoaW5wdXQpID0+IHRoaXMuX3Rlc3RBcmd1bWVudHMucmVzb2x2ZShpbnB1dCksXG4gICAgICBzdWl0ZUhvb2tFeGVjdXRvcjogKGlucHV0KSA9PiB0aGlzLl9zdWl0ZUhvb2tFeGVjdXRvci5leGVjdXRlKGlucHV0KSxcbiAgICAgIHJlcG9ydGVyOiB0aGlzLl9ydW5uZXJSZXBvcnRlclxuICAgIH0pXG4gICAgY29uc3QgZmFpbHVyZVN0YXJ0ID0gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMubGVuZ3RoXG4gICAgY29uc3QgcmVzdG9yZVJldHJ5T3B0aW9ucyA9IHRoaXMubm9ybWFsaXplUGFja2FnZVJldHJpZXNGb3JFeGVjdXRpb24oKVxuICAgIGxldCByZXN1bHRcblxuICAgIHRyeSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLl9wYWNrYWdlUnVubmVyLnJ1bigpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEFib3J0UmVtYWluaW5nVGVzdHNFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgICAgY29uc3QgYWZ0ZXJBbGwgPSB0aGlzLmFmdGVyQWxsT3V0Y29tZSh0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5zbGljZShmYWlsdXJlU3RhcnQpKVxuICAgICAgICBpZiAoYWZ0ZXJBbGwuZmFpbGVkKSB0aGlzLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShhZnRlckFsbC5lcnJvciwgXCJhZnRlckFsbFwiKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5yZWNvcmRQYWNrYWdlUmVzdWx0KHJlc3VsdClcbiAgICAgIHRoaXMudGhyb3dBZnRlckFsbEZhaWx1cmVzKHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnNsaWNlKGZhaWx1cmVTdGFydCkpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlc3RvcmVSZXRyeU9wdGlvbnMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZ2dyZWdhdGVzIHJhdyBhZnRlci1hbGwgZmFpbHVyZXMgd2l0aG91dCB1c2luZyBlcnJvciB0cnV0aGluZXNzLlxuICAgKiBAcGFyYW0ge0FycmF5PHtwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59IGZhaWx1cmVzIC0gSG9vayBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge3tmYWlsZWQ6IGZhbHNlfSB8IHtmYWlsZWQ6IHRydWUsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IC0gRXhwbGljaXQgYWZ0ZXJBbGwgb3V0Y29tZS5cbiAgICovXG4gIGFmdGVyQWxsT3V0Y29tZShmYWlsdXJlcykge1xuICAgIGNvbnN0IGFmdGVyQWxsRXJyb3JzID0gZmFpbHVyZXMuZmlsdGVyKChmYWlsdXJlKSA9PiBmYWlsdXJlLnBoYXNlID09PSBcImFmdGVyQWxsXCIpLm1hcCgoZmFpbHVyZSkgPT4gZmFpbHVyZS5lcnJvcilcblxuICAgIGlmIChhZnRlckFsbEVycm9ycy5sZW5ndGggPT09IDApIHJldHVybiB7ZmFpbGVkOiBmYWxzZX1cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID09PSAxKSByZXR1cm4ge2ZhaWxlZDogdHJ1ZSwgZXJyb3I6IGFmdGVyQWxsRXJyb3JzWzBdfVxuICAgIHJldHVybiB7XG4gICAgICBmYWlsZWQ6IHRydWUsXG4gICAgICBlcnJvcjogbmV3IEFnZ3JlZ2F0ZUVycm9yKGFmdGVyQWxsRXJyb3JzLCBcIk11bHRpcGxlIGFjdGl2ZSBhZnRlckFsbCBzY29wZXMgZmFpbGVkXCIsIHtjYXVzZTogYWZ0ZXJBbGxFcnJvcnNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaHJvd3Mgb25lIHJhdyBvciBhZ2dyZWdhdGVkIGFmdGVyLWFsbCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge0FycmF5PHtwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59IGZhaWx1cmVzIC0gSG9vayBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB0aHJvd0FmdGVyQWxsRmFpbHVyZXMoZmFpbHVyZXMpIHtcbiAgICBjb25zdCBhZnRlckFsbCA9IHRoaXMuYWZ0ZXJBbGxPdXRjb21lKGZhaWx1cmVzKVxuXG4gICAgaWYgKGFmdGVyQWxsLmZhaWxlZCkgdGhyb3cgYWZ0ZXJBbGwuZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXRpYmlsaXR5IGhlbHBlciBmb3IgZm9jdXNlZCBmcmFtZXdvcmsgbGlmZWN5Y2xlIHNwZWNzLiBJdCBjb252ZXJ0cyBhblxuICAgKiBleHBsaWNpdCBsZWdhY3kgZml4dHVyZSBpbnRvIGlzb2xhdGVkIHBhY2thZ2UgZGVjbGFyYXRpb25zOyB0aGUgcGFja2FnZVxuICAgKiBydW5uZXIgcmVtYWlucyB0aGUgc29sZSBleGVjdXRpb24gZW5naW5lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExlZ2FjeSBmaXh0dXJlIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBhcmdzLnRlc3RzIC0gRml4dHVyZSB0cmVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwYWNrYWdlIGV4ZWN1dGlvbi5cbiAgICovXG4gIGFzeW5jIHJ1blRlc3RzKHt0ZXN0c30pIHtcbiAgICBjb25zdCBjb250ZXh0ID0gY3JlYXRlVGVzdENvbnRleHQoKVxuICAgIGNvbnN0IG9yaWdpbmFsQ29udGV4dCA9IHRoaXMuX2NvbnRleHRcbiAgICBjb250ZXh0LmNvbmZpZ3VyZVRlc3RzKHtcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IG9yaWdpbmFsQ29udGV4dC5jb25maWcuY29uc29sZU91dHB1dCxcbiAgICAgIGRlZmF1bHRUaW1lb3V0TXM6IG9yaWdpbmFsQ29udGV4dC5jb25maWcuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICAgIGV4Y2x1ZGVUYWdzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmV4Y2x1ZGVUYWdzLFxuICAgICAgZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcyxcbiAgICAgIHJldHJpZXM6IG9yaWdpbmFsQ29udGV4dC5jb25maWcucmV0cmllc1xuICAgIH0pXG4gICAgdGhpcy5fY29udGV4dCA9IGNvbnRleHRcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5ID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2luamVjdGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fY29tcGxldGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fdGVzdE1ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2hvb2tNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMgPSBbXVxuICAgIHRoaXMuX3Rlc3RzQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIGNvbnRleHQuc2V0RGVjbGFyYXRpb25Mb2NhdG9yKCgpID0+IHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbilcbiAgICB0aGlzLmRlY2xhcmVMZWdhY3lGaXh0dXJlKGNvbnRleHQsIFwiXCIsIHRlc3RzLCBbXSlcbiAgICB0aGlzLmFuYWx5emVEZWNsYXJhdGlvbnMoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuUGFja2FnZVRlc3RzKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fY29udGV4dCA9IG9yaWdpbmFsQ29udGV4dFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhbiBpc29sYXRlZCBsZWdhY3ktc2hhcGVkIHRlc3QgZml4dHVyZSBpbnRvIGEgcGFja2FnZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0Q29udGV4dH0gY29udGV4dCAtIElzb2xhdGVkIHBhY2thZ2UgY29udGV4dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBTdWl0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1Rlc3RzQXJndW1lbnR9IHNjb3BlIC0gTGVnYWN5IGZpeHR1cmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRlc2NyaXB0aW9ucyAtIEFuY2VzdG9yIGRlc2NyaXB0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBkZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBuYW1lLCBzY29wZSwgZGVzY3JpcHRpb25zKSB7XG4gICAgdGhpcy5fbGVnYWN5Rml4dHVyZUxvY2F0aW9uID0ge2ZpbGVQYXRoOiBzY29wZS5maWxlUGF0aCwgbGluZTogc2NvcGUubGluZX1cbiAgICBjb250ZXh0LmRlc2NyaWJlKG5hbWUsIHNjb3BlLmFyZ3MgfHwge30sICgpID0+IHtcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBzY29wZS5iZWZvcmVBbGxzIHx8IFtdKSBjb250ZXh0LmJlZm9yZUFsbChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmJlZm9yZUVhY2hlcyB8fCBbXSkgY29udGV4dC5iZWZvcmVFYWNoKGhvb2suY2FsbGJhY2spXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYWZ0ZXJFYWNoZXMgfHwgW10pIGNvbnRleHQuYWZ0ZXJFYWNoKGhvb2suY2FsbGJhY2spXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYWZ0ZXJBbGxzIHx8IFtdKSBjb250ZXh0LmFmdGVyQWxsKGhvb2suY2FsbGJhY2spXG4gICAgICBjb25zdCBuZXh0RGVzY3JpcHRpb25zID0gbmFtZSA9PT0gXCJcIiA/IGRlc2NyaXB0aW9ucyA6IFsuLi5kZXNjcmlwdGlvbnMsIG5hbWVdXG4gICAgICBmb3IgKGNvbnN0IFt0ZXN0TmFtZSwgdGVzdERhdGFdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlLnRlc3RzIHx8IHt9KSkge1xuICAgICAgICB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24gPSB7ZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoLCBsaW5lOiB0ZXN0RGF0YS5saW5lfVxuICAgICAgICB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWU/LnNldCh0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKG5leHREZXNjcmlwdGlvbnMsIHRlc3ROYW1lKSwgdGVzdERhdGEpXG4gICAgICAgIGNvbnRleHQuaXQodGVzdE5hbWUsIHRlc3REYXRhLmFyZ3MsIHRlc3REYXRhLmZ1bmN0aW9uKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBbc3VpdGVOYW1lLCBjaGlsZFNjb3BlXSBvZiBPYmplY3QuZW50cmllcyhzY29wZS5zdWJzIHx8IHt9KSkge1xuICAgICAgICB0aGlzLmRlY2xhcmVMZWdhY3lGaXh0dXJlKGNvbnRleHQsIHN1aXRlTmFtZSwgY2hpbGRTY29wZSwgbmV4dERlc2NyaXB0aW9ucylcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW1pdCBldmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgbGlzdGVuZXJzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGF5bG9hZCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bm5lclJlcG9ydGVyLmVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCByZXJ1biBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIExlZnQgcGFkZGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHJpbnRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YSwgbGVmdFBhZGRpbmd9KSB7XG4gICAgY29uc3QgcmVydW4gPSB0aGlzLmJ1aWxkUmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGF9KVxuXG4gICAgaWYgKHJlcnVuKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGAke2xlZnRQYWRkaW5nfSAgUmUtcnVuOiAke3JlcnVufWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgcmVydW4gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXJ1biBjb21tYW5kLlxuICAgKi9cbiAgYnVpbGRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YX0pIHtcbiAgICBjb25zdCBiYXNlQ29tbWFuZCA9IFwibnB4IHZlbG9jaW91cyB0ZXN0XCJcbiAgICBjb25zdCBmaWxlUGF0aCA9IHRlc3REYXRhLmZpbGVQYXRoXG4gICAgY29uc3QgbGluZSA9IHRlc3REYXRhLmxpbmVcblxuICAgIGlmIChmaWxlUGF0aCAmJiBsaW5lKSB7XG4gICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHByb2Nlc3MuY3dkKCksIGZpbGVQYXRoKVxuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAke3JlbGF0aXZlUGF0aH06JHtsaW5lfWBcbiAgICB9XG5cbiAgICBjb25zdCBmdWxsRGVzY3JpcHRpb24gPSB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKVxuXG4gICAgaWYgKGZ1bGxEZXNjcmlwdGlvbikge1xuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAtLWV4YW1wbGUgJHtKU09OLnN0cmluZ2lmeShmdWxsRGVzY3JpcHRpb24pfWBcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtBdHRlbXB0Q29uc29sZU91dHB1dFtdfSBhdHRlbXB0Q29uc29sZU91dHB1dHMgLSBBdHRlbXB0IG91dHB1dCBlbnRyaWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbWJpbmVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKi9cbiAgYnVpbGRDb25zb2xlT3V0cHV0KGF0dGVtcHRDb25zb2xlT3V0cHV0cykge1xuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIlxuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAxKSByZXR1cm4gYXR0ZW1wdENvbnNvbGVPdXRwdXRzWzBdLm91dHB1dFxuXG4gICAgcmV0dXJuIGF0dGVtcHRDb25zb2xlT3V0cHV0cy5tYXAoKGF0dGVtcHRDb25zb2xlT3V0cHV0KSA9PiB7XG4gICAgICByZXR1cm4gYC0tLSBBdHRlbXB0ICR7YXR0ZW1wdENvbnNvbGVPdXRwdXQuYXR0ZW1wdE51bWJlcn0gLS0tXFxuJHthdHRlbXB0Q29uc29sZU91dHB1dC5vdXRwdXR9YFxuICAgIH0pLmpvaW4oXCJcXG5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgY29uc29sZSBvdXRwdXQgbWF4IGxpbmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gZmFpbGVkIGNvbnNvbGUgbGluZXMuXG4gICAqL1xuICBnZXRGYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMoKSB7XG4gICAgY29uc3QgbWF4TGluZXMgPSB0ZXN0Q29uZmlnLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lc1xuXG4gICAgaWYgKHR5cGVvZiBtYXhMaW5lcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKG1heExpbmVzKSkgcmV0dXJuIDIwMFxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGguZmxvb3IobWF4TGluZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZmFpbGVkIGNvbnNvbGUgb3V0cHV0IGxpbmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uc29sZU91dHB1dCAtIENvbnNvbGUgb3V0cHV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTGluZXMgZm9yIGlubGluZSBvdXRwdXQuXG4gICAqL1xuICB0cnVuY2F0ZUZhaWxlZENvbnNvbGVPdXRwdXRMaW5lcyhjb25zb2xlT3V0cHV0KSB7XG4gICAgY29uc3QgbGluZXMgPSBjb25zb2xlT3V0cHV0LnNwbGl0KFwiXFxuXCIpXG4gICAgY29uc3QgbWF4TGluZXMgPSB0aGlzLmdldEZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcygpXG5cbiAgICBpZiAobWF4TGluZXMgPT09IDApIHJldHVybiBbXVxuICAgIGlmIChsaW5lcy5sZW5ndGggPD0gbWF4TGluZXMpIHJldHVybiBsaW5lc1xuXG4gICAgY29uc3Qgb21pdHRlZExpbmVzID0gbGluZXMubGVuZ3RoIC0gbWF4TGluZXNcbiAgICBjb25zdCBwbHVyYWwgPSBvbWl0dGVkTGluZXMgPT09IDEgPyBcIlwiIDogXCJzXCJcblxuICAgIHJldHVybiBbXG4gICAgICBgLi4uICR7b21pdHRlZExpbmVzfSBjb25zb2xlIG91dHB1dCBsaW5lJHtwbHVyYWx9IG9taXR0ZWQgLi4uYCxcbiAgICAgIC4uLmxpbmVzLnNsaWNlKC1tYXhMaW5lcylcbiAgICBdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCBmYWlsZWQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBMZWZ0IHBhZGRpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHByaW50RmFpbGVkQ29uc29sZU91dHB1dCh7Y29uc29sZU91dHB1dCwgbGVmdFBhZGRpbmd9KSB7XG4gICAgaWYgKHRlc3RDb25maWcuY29uc29sZU91dHB1dCAhPT0gXCJmYWlsdXJlXCIpIHJldHVyblxuICAgIGlmICghY29uc29sZU91dHB1dCkgcmV0dXJuXG5cbiAgICBjb25zdCBsaW5lcyA9IHRoaXMudHJ1bmNhdGVGYWlsZWRDb25zb2xlT3V0cHV0TGluZXMoY29uc29sZU91dHB1dClcblxuICAgIGlmIChsaW5lcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIENvbnNvbGUgb3V0cHV0OmApKVxuXG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgICAke2xpbmV9YCkpXG4gICAgfVxuICB9XG5cbn1cbiJdfQ==