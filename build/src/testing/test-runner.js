// @ts-check
import fs from "node:fs/promises";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createTestContext, defaultTestContext } from "@velocious/testing";
import { slowestTestResults } from "@velocious/testing/reporters";
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
     * @param {number} [args.retries] - Default retry count.
     * @param {string[]} [args.setupFiles] - Setup files imported before test files.
     * @param {number} [args.timeoutMs] - Default lifecycle timeout.
     */
    constructor({ configuration, context = defaultTestContext, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, profiler, retries, setupFiles, timeoutMs, ...restArgs }) {
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
        this._retries = retries;
        this._setupFiles = setupFiles || [];
        this._timeoutMs = timeoutMs;
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
        if (this._packageResult) {
            return slowestTestResults(this._packageResult, { limit }).map((result) => ({
                fullDescription: result.fullName,
                filePath: result.filePath ?? "<unknown>",
                line: result.line ?? 0,
                durationMs: result.durationMs
            }));
        }
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
            if (this._setupFiles.length > 0) {
                await this.runProfileSpan({ phase: "testing config/global setup" }, async () => {
                    await this.getConfiguration().getEnvironmentHandler().importTestFiles(this._setupFiles);
                });
            }
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
        const value = test.options.retries ?? test.options.retry ?? this._retries ?? this.getTestContext().config.retries;
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
            reporter: this._runnerReporter,
            retries: this._retries,
            timeoutMs: this._timeoutMs
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ3BELE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxrQkFBa0IsRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQzFFLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLDhCQUE4QixDQUFBO0FBQ2pFLE9BQU8sRUFBRSxVQUFVLElBQUksaUJBQWlCLEVBQUUsTUFBTSwyQkFBMkIsQ0FBQTtBQUMzRSxPQUFPLFdBQVcsTUFBTSwwQkFBMEIsQ0FBQTtBQUNsRCxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUN0QyxPQUFPLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBRSxNQUFNLEtBQUssQ0FBQTtBQUNsRCxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3BGLE9BQU8sd0JBQXdCLE1BQU0saUNBQWlDLENBQUE7QUFDdEUsT0FBTyx1QkFBdUIsRUFBRSxFQUFFLHdCQUF3QixFQUFFLE1BQU0sZ0NBQWdDLENBQUE7QUFDbEcsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLHNCQUFzQixNQUFNLCtCQUErQixDQUFBO0FBRWxFLDhEQUE4RDtBQUM5RCw2RkFBNkY7QUFDN0YsaUZB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WSxHQUFHLEtBQUssQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFBO1FBQzVDLE1BQU0sTUFBTSxHQUFHLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFBO1FBRTVDLE9BQU87WUFDTCxPQUFPLFlBQVksdUJBQXVCLE1BQU0sY0FBYztZQUM5RCxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQUM7U0FDMUIsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx3QkFBd0IsQ0FBQyxFQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUM7UUFDbkQsSUFBSSxVQUFVLENBQUMsYUFBYSxLQUFLLFNBQVM7WUFBRSxPQUFNO1FBQ2xELElBQUksQ0FBQyxhQUFhO1lBQUUsT0FBTTtRQUUxQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFbEUsSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRTlCLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFdBQVcsbUJBQW1CLENBQUMsQ0FBQyxDQUFBO1FBRWhFLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7WUFDekIsT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsV0FBVyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUM1RCxDQUFDO0lBQ0gsQ0FBQztDQUVGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmcy9wcm9taXNlc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gXCJub2RlOmFzeW5jX2hvb2tzXCJcbmltcG9ydCB7IGNyZWF0ZVRlc3RDb250ZXh0LCBkZWZhdWx0VGVzdENvbnRleHQgfSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nXCJcbmltcG9ydCB7IHNsb3dlc3RUZXN0UmVzdWx0cyB9IGZyb20gXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcmVwb3J0ZXJzXCJcbmltcG9ydCB7IFRlc3RSdW5uZXIgYXMgUGFja2FnZVRlc3RSdW5uZXIgfSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiXG5pbXBvcnQgQXBwbGljYXRpb24gZnJvbSBcIi4uLy4uL3NyYy9hcHBsaWNhdGlvbi5qc1wiXG5pbXBvcnQgUmVxdWVzdENsaWVudCBmcm9tIFwiLi9yZXF1ZXN0LWNsaWVudC5qc1wiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IHRlc3RDb25maWcgfSBmcm9tIFwiLi90ZXN0LmpzXCJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGgsIHBhdGhUb0ZpbGVVUkwgfSBmcm9tIFwidXJsXCJcbmltcG9ydCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlciBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tYnJva2VyLmpzXCJcbmltcG9ydCB7IFNIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WIH0gZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzQXR0ZW1wdEV4ZWN1dG9yIGZyb20gXCIuL3ZlbG9jaW91cy1hdHRlbXB0LWV4ZWN1dG9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlciwgeyBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IgfSBmcm9tIFwiLi92ZWxvY2lvdXMtcnVubmVyLXJlcG9ydGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvciBmcm9tIFwiLi92ZWxvY2lvdXMtc3VpdGUtaG9vay1leGVjdXRvci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzVGVzdEFyZ3VtZW50cyBmcm9tIFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIlxuXG4vKiogQHR5cGVkZWYge3R5cGVvZiBkZWZhdWx0VGVzdENvbnRleHR9IFBhY2thZ2VUZXN0Q29udGV4dCAqL1xuLyoqIEB0eXBlZGVmIHsodHlwZW9mIGRlZmF1bHRUZXN0Q29udGV4dC5yZWdpc3RyeS5zdWl0ZXMpW251bWJlcl19IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uICovXG4vKiogQHR5cGVkZWYge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW1widGVzdHNcIl1bbnVtYmVyXX0gUGFja2FnZVRlc3REZWNsYXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltcImhvb2tzXCJdW1wiYmVmb3JlQWxsXCJdW251bWJlcl19IFBhY2thZ2VIb29rRGVjbGFyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb24gfCBQYWNrYWdlVGVzdERlY2xhcmF0aW9uIHwgUGFja2FnZUhvb2tEZWNsYXJhdGlvbn0gUGFja2FnZVJlZ2lzdHJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHt7aGFkUmV0cmllczogYm9vbGVhbiwgb3B0aW9uczogUGFja2FnZVRlc3REZWNsYXJhdGlvbltcIm9wdGlvbnNcIl0sIHJldHJpZXM6IG51bWJlciB8IHVuZGVmaW5lZH19IFBhY2thZ2VSZXRyeU9wdGlvblJlc3RvcmF0aW9uICovXG5cbi8qKlxuICogQXR0ZW1wdENvbnNvbGVPdXRwdXQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF0dGVtcHRDb25zb2xlT3V0cHV0XG4gKiBAcHJvcGVydHkge251bWJlcn0gYXR0ZW1wdE51bWJlciAtIEF0dGVtcHQgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG91dHB1dCAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0LlxuICovXG4vKipcbiAqIFRlc3RBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0QXJnc1xuICogQHByb3BlcnR5IHtBcHBsaWNhdGlvbn0gW2FwcGxpY2F0aW9uXSAtIEFwcGxpY2F0aW9uIGluc3RhbmNlIGZvciBpbnRlZ3JhdGlvbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7UmVxdWVzdENsaWVudH0gW2NsaWVudF0gLSBIVFRQIGNsaWVudCBmb3IgcmVxdWVzdCB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBbZGF0YWJhc2VDbGVhbmluZ10gLSBEYXRhYmFzZSBjbGVhbnVwIG9wdGlvbnMgZm9yIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cmFuc2FjdGlvbl0gLSBVc2UgdHJhbnNhY3Rpb25zIHRvIHJvbGxiYWNrIGJldHdlZW4gdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRydW5jYXRlXSAtIFRydW5jYXRlIHRhYmxlcyBiZXR3ZWVuIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cnVuY2F0ZUJlZm9yZV0gLSBUcnVuY2F0ZSB0YWJsZXMgYmVmb3JlIGVhY2ggdGVzdCwgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHQgY2xlYW51cC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2ZvY3VzXSAtIFdoZXRoZXIgdGhpcyB0ZXN0IGlzIGZvY3VzZWQuXG4gKiBAcHJvcGVydHkgeygpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBbZnVuY3Rpb25dIC0gVGVzdCBjYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbcmV0cnldIC0gTnVtYmVyIG9mIHJldHJpZXMgd2hlbiBhIHRlc3QgZmFpbHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdIHwgc3RyaW5nfSBbdGFnc10gLSBUYWdzIGZvciBmaWx0ZXJpbmcuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3RpbWVvdXRTZWNvbmRzXSAtIFRpbWVvdXQgaW4gc2Vjb25kcyBmb3IgdGhlIHRlc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3R5cGVdIC0gVGVzdCB0eXBlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHRlbmFudDogb2JqZWN0fSkgPT4gUHJvbWlzZTx2b2lkPn0gW3JlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudF0gLSBSZWdpc3RlcnMgb25lIHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSB0cmFuc2FjdGlvbiBmb3IgdGhpcyBhdHRlbXB0LlxuICovXG4vKipcbiAqIEJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQXR0ZW1wdC1vd25lZCBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIENvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3F1YXJhbnRpbmVQcm9taXNlXSAtIFNoYXJlZCBjb25uZWN0aW9uLWRpc2NhcmQgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcXVhcmFudGluZWQgLSBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIGlzIHVuc2FmZSB0byByZXVzZS5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3JvbGxiYWNrUHJvbWlzZV0gLSBTaGFyZWQgcm9sbGJhY2sgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3N0YXJ0UHJvbWlzZV0gLSBUcmFuc2FjdGlvbiBzdGFydHVwIHByb21pc2Ugd2hlbiB0cmFuc2FjdGlvbiBjbGVhbmluZyBpcyBlbmFibGVkLlxuICovXG4vKipcbiAqIFRlc3REYXRhIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0RGF0YVxuICogQHByb3BlcnR5IHtUZXN0QXJnc30gYXJncyAtIEFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlIHRlc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7KGFyZzogVGVzdEFyZ3MpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBmdW5jdGlvbiAtIFRlc3QgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqIEBwcm9wZXJ0eSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gW2RlY2xhcmF0aW9uXSAtIFBhY2thZ2UgZGVjbGFyYXRpb24uXG4gKi9cbi8qKlxuICogRmFpbGVkVGVzdERldGFpbCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRmFpbGVkVGVzdERldGFpbFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZ1bGxEZXNjcmlwdGlvbiAtIEZ1bGwgdGVzdCBkZXNjcmlwdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZmlsZVBhdGhdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbGluZV0gLSBTb3VyY2UgbGluZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEZhaWx1cmUgZXJyb3IuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbnNvbGVPdXRwdXRdIC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQgd2hpbGUgdGVzdCByYW4uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbnNvbGVMb2dQYXRoXSAtIFNhdmVkIGNvbnNvbGUgbG9nIHBhdGguXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIHRlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfSkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBIb29rIGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2RlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBpbmRleCB3aXRoaW4gaXRzIGRlY2xhcmF0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkZWNsYXJhdGlvblNjb3BlSWRdIC0gT3BhcXVlIHByb2ZpbGUgc2NvcGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9KSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVcbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gSG9vayBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICovXG4vKipcbiAqIFRlc3RzQXJndW1lbnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RzQXJndW1lbnRcbiAqIEBwcm9wZXJ0eSB7VGVzdEFyZ3N9IGFyZ3MgLSBBcmd1bWVudHMgaW5oZXJpdGVkIGJ5IHRlc3RzIGluIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFthbnlUZXN0c0ZvY3Vzc2VkXSAtIFdoZXRoZXIgYW55IHRlc3RzIGluIHRoZSB0cmVlIGFyZSBmb2N1c2VkLlxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYWZ0ZXJFYWNoZXMgLSBBZnRlci1lYWNoIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBhZnRlckFsbHMgLSBBZnRlci1hbGwgaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlW119IGJlZm9yZUFsbHMgLSBCZWZvcmUtYWxsIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYmVmb3JlRWFjaGVzIC0gQmVmb3JlLWVhY2ggaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgVGVzdERhdGE+fSB0ZXN0cyAtIEEgdW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBub2RlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBUZXN0c0FyZ3VtZW50Pn0gc3VicyAtIE9wdGlvbmFsIGNoaWxkIG5vZGVzLiBFYWNoIGl0ZW0gaXMgYW5vdGhlciBgTm9kZWAsIGFsbG93aW5nIHJlY3Vyc2lvbi5cbiAqL1xuLyoqXG4gKiBNYXJrcyB0aGUgZXJyb3IgdGhyb3duIGJ5IHRoZSBhdHRlbXB0IHRpbWVvdXQgc28gdGhlIHJ1bm5lciBjYW4gZGlzdGluZ3Vpc2hcbiAqIGRldGFjaGVkIGxpZmVjeWNsZSBjbGVhbnVwIGZyb20gYW4gb3JkaW5hcnkgdGVzdCBmYWlsdXJlLlxuICogQHR5cGVkZWYge0Vycm9yICYge3ZlbG9jaW91c1Rlc3RUaW1lb3V0PzogdHJ1ZX19IFRlc3RUaW1lb3V0RXJyb3JcbiAqL1xuLyoqXG4gKiBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJ9IGJyb2tlciAtIEF0dGVtcHQgYnJva2VyIGFuZCBjb25uZWN0aW9uIGNvb3JkaW5hdG9yLlxuICogQHByb3BlcnR5IHtib29sZWFufSBlbnZpcm9ubWVudFB1Ymxpc2hlZCAtIFdoZXRoZXIgY2hpbGQtcHJvY2VzcyBjb29yZGluYXRlcyB3ZXJlIHB1Ymxpc2hlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBwcmV2aW91c0Vudmlyb25tZW50IC0gRW52aXJvbm1lbnQgdmFsdWUgdG8gcmVzdG9yZSBhZnRlciBwdWJsaWNhdGlvbi5cbiAqL1xuLyoqXG4gKiBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge1Byb21pc2U8e2Nvbm5lY3Rpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBlcnJvcjogRXJyb3IgfCB1bmRlZmluZWR9PiB8IHVuZGVmaW5lZH0gW2NoZWNrb3V0UHJvbWlzZV0gLSBBdHRlbXB0LW93bmVkIHBoeXNpY2FsIGNoZWNrb3V0IG91dGNvbWUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25uZWN0aW9uIC0gQXR0ZW1wdC1vd25lZCBwaHlzaWNhbCBjb25uZWN0aW9uIG9uY2UgY2hlY2tvdXQgcmVzb2x2ZXMuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IFtjbGVhbnVwUHJvbWlzZV0gLSBTaW5nbGUgY2xlYW51cCBvcGVyYXRpb24gc2hhcmVkIGJ5IGVtZXJnZW5jeSBhbmQgZXZlbnR1YWwgbGlmZWN5Y2xlIGNsZWFudXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW4gfCB1bmRlZmluZWR9IFtkaXNjYXJkT25DbGVhbnVwXSAtIFdoZXRoZXIgdGltZW91dCBlbWVyZ2VuY3kgY2xlYW51cCBtdXN0IHF1YXJhbnRpbmUgdGhpcyBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gcG9vbCAtIE93bmluZyBsb2dpY2FsIHBvb2wuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldm9rZWQgLSBXaGV0aGVyIHRoaXMgYXR0ZW1wdCBtYXkgc3RpbGwgcHVibGlzaCB0aGUgcGh5c2ljYWwgcmVnaXN0cmF0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJldXNlS2V5IC0gUmVzb2x2ZWQgcGh5c2ljYWwgY29uZmlndXJhdGlvbiBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSBzaGFyZWRSZWdpc3RyYXRpb24gLSBQaHlzaWNhbC1rZXkgc2hhcmVkIHJlZ2lzdHJhdGlvbiBvbmNlIHB1Ymxpc2hlZC5cbiAqL1xuXG5jb25zdCB0ZXN0aW5nUGFja2FnZURpcmVjdG9yeSA9IHBhdGguZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnJlc29sdmUoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcGFja2FnZS5qc29uXCIpKSlcblxuLyoqXG4gKiBSdW5zIHRvIGZpbGUgc2x1Zy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIHNhbml0aXplLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTbHVnLXNhZmUgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHRvRmlsZVNsdWcodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAucmVwbGFjZSgvW15hLXowLTldKy9nLCBcIi1cIilcbiAgICAucmVwbGFjZSgvXi0rfC0rJC9nLCBcIlwiKVxuICAgIC5zbGljZSgwLCA4MCkgfHwgXCJmYWlsZWQtdGVzdFwiXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RSdW5uZXIge1xuICAvKiogQHR5cGUge1BhY2thZ2VUZXN0Q29udGV4dH0gKi9cbiAgX2NvbnRleHRcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7RmFpbGVkVGVzdERldGFpbFtdfSAqL1xuICBfZmFpbGVkVGVzdERldGFpbHNcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3RDb250ZXh0fSBbYXJncy5jb250ZXh0XSAtIERlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmd9IFthcmdzLmV4Y2x1ZGVUYWdzXSAtIFRhZ3MgdG8gZXhjbHVkZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuaW5jbHVkZVRhZ3NdIC0gVGFncyB0byBpbmNsdWRlLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGFyZ3MudGVzdEZpbGVzIC0gVGVzdCBmaWxlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT59IFthcmdzLmxpbmVGaWx0ZXJzXSAtIExpbmUgZmlsdGVycyBieSBmaWxlLlxuICAgKiBAcGFyYW0ge1JlZ0V4cFtdfSBbYXJncy5leGFtcGxlUGF0dGVybnNdIC0gRXhhbXBsZSBwYXR0ZXJucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcHJvZmlsZXIuanNcIikuZGVmYXVsdH0gW2FyZ3MucHJvZmlsZXJdIC0gT3B0LWluIHByb2ZpbGVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cmllc10gLSBEZWZhdWx0IHJldHJ5IGNvdW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5zZXR1cEZpbGVzXSAtIFNldHVwIGZpbGVzIGltcG9ydGVkIGJlZm9yZSB0ZXN0IGZpbGVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGltZW91dE1zXSAtIERlZmF1bHQgbGlmZWN5Y2xlIHRpbWVvdXQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY29udGV4dCA9IGRlZmF1bHRUZXN0Q29udGV4dCwgZXhjbHVkZVRhZ3MsIGluY2x1ZGVUYWdzLCB0ZXN0RmlsZXMsIGxpbmVGaWx0ZXJzLCBleGFtcGxlUGF0dGVybnMsIHByb2ZpbGVyLCByZXRyaWVzLCBzZXR1cEZpbGVzLCB0aW1lb3V0TXMsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcImNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5fY29udGV4dCA9IGNvbnRleHRcbiAgICB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlKClcbiAgICB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2UoKVxuICAgIHRoaXMuX2V4Y2x1ZGVUYWdzID0gdGhpcy5ub3JtYWxpemVUYWdzKGV4Y2x1ZGVUYWdzKVxuICAgIHRoaXMuX2luY2x1ZGVUYWdzID0gdGhpcy5ub3JtYWxpemVUYWdzKGluY2x1ZGVUYWdzKVxuICAgIHRoaXMuX3Rlc3RGaWxlcyA9IHRlc3RGaWxlc1xuICAgIHRoaXMuX2xpbmVGaWx0ZXJzID0gbGluZUZpbHRlcnMgfHwge31cbiAgICB0aGlzLl9leGFtcGxlUGF0dGVybnMgPSBleGFtcGxlUGF0dGVybnMgfHwgW11cbiAgICB0aGlzLl9wcm9maWxlciA9IHByb2ZpbGVyXG4gICAgdGhpcy5fcmV0cmllcyA9IHJldHJpZXNcbiAgICB0aGlzLl9zZXR1cEZpbGVzID0gc2V0dXBGaWxlcyB8fCBbXVxuICAgIHRoaXMuX3RpbWVvdXRNcyA9IHRpbWVvdXRNc1xuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAwXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzID0gMFxuICAgIHRoaXMuX3Rlc3RzQ291bnQgPSAwXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMgPSBbXVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5Ob25SdW5UZXN0UmVzdWx0W119ICovXG4gICAgdGhpcy5fbm90UnVuVGVzdERldGFpbHMgPSBbXVxuICAgIC8qKiBAdHlwZSB7e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXJ9IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sYXN0VGVzdENvbnRleHQgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlciwgZHVyYXRpb25NczogbnVtYmVyfT59ICovXG4gICAgdGhpcy5fdGVzdER1cmF0aW9ucyA9IFtdXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIHt0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0+fSAqL1xuICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5ID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uPn0gKi9cbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uPn0gKi9cbiAgICB0aGlzLl9jb21wbGV0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZVRlc3REZWNsYXJhdGlvbiwge2Rlc2NyaXB0aW9uczogc3RyaW5nW10sIHRlc3REZXNjcmlwdGlvbjogc3RyaW5nLCBmdWxsRGVzY3JpcHRpb246IHN0cmluZywgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkLCBzdWl0ZXM6IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW119Pn0gKi9cbiAgICB0aGlzLl90ZXN0TWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VIb29rRGVjbGFyYXRpb24sIHtkZWNsYXJhdGlvbkluZGV4OiBudW1iZXIsIGRlY2xhcmF0aW9uU2NvcGVJZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9Pn0gKi9cbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIE1hcDxudW1iZXIsIHthYm9ydFJlbWFpbmluZ1Rlc3RzOiBib29sZWFuLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGZhaWxlZDogYm9vbGVhbn0+Pn0gKi9cbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7c3VpdGU6IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uLCBwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59ICovXG4gICAgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMgPSBbXVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUGFja2FnZVRlc3REZWNsYXJhdGlvbltdPn0gKi9cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZVJlZ2lzdHJhdGlvbiwgc3RyaW5nPn0gKi9cbiAgICB0aGlzLl9kZWNsYXJhdGlvbk93bmVycyA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1BhY2thZ2VUZXN0UnVubmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3BhY2thZ2VSdW5uZXIgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuVGVzdFJ1blJlc3VsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBUZXN0RGF0YT4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHt7ZmlsZVBhdGg/OiBzdHJpbmcsIGxpbmU/OiBudW1iZXJ9fSAqL1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbiA9IHt9XG4gICAgdGhpcy5fYXR0ZW1wdEV4ZWN1dG9yID0gbmV3IFZlbG9jaW91c0F0dGVtcHRFeGVjdXRvcih7dGVzdFJ1bm5lcjogdGhpc30pXG4gICAgdGhpcy5fcnVubmVyUmVwb3J0ZXIgPSBuZXcgVmVsb2Npb3VzUnVubmVyUmVwb3J0ZXIoe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICAgIHRoaXMuX3N1aXRlSG9va0V4ZWN1dG9yID0gbmV3IFZlbG9jaW91c1N1aXRlSG9va0V4ZWN1dG9yKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgICB0aGlzLl90ZXN0QXJndW1lbnRzID0gbmV3IFZlbG9jaW91c1Rlc3RBcmd1bWVudHMoe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHBhY2thZ2UgZGVjbGFyYXRpb24gY29udGV4dC5cbiAgICogQHJldHVybnMge1BhY2thZ2VUZXN0Q29udGV4dH0gLSBQYWNrYWdlIGRlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqL1xuICBnZXRUZXN0Q29udGV4dCgpIHsgcmV0dXJuIHRoaXMuX2NvbnRleHQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0Q29uZmlndXJhdGlvbigpIHsgcmV0dXJuIHRoaXMuX2NvbmZpZ3VyYXRpb24gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIHRlc3QgZmlsZXMuXG4gICAqL1xuICBnZXRUZXN0RmlsZXMoKSB7IHJldHVybiB0aGlzLl90ZXN0RmlsZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsaW5lIGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT59IC0gTGluZSBmaWx0ZXJzLlxuICAgKi9cbiAgZ2V0TGluZUZpbHRlcnMoKSB7IHJldHVybiB0aGlzLl9saW5lRmlsdGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4YW1wbGUgcGF0dGVybnMuXG4gICAqIEByZXR1cm5zIHtSZWdFeHBbXX0gLSBFeGFtcGxlIHBhdHRlcm5zLlxuICAgKi9cbiAgZ2V0RXhhbXBsZVBhdHRlcm5zKCkgeyByZXR1cm4gdGhpcy5fZXhhbXBsZVBhdHRlcm5zIH1cblxuICAvKipcbiAgICogUnVucyBhIHByb2ZpbGVyIHNwYW4gb25seSB3aGVuIHByb2ZpbGluZyB3YXMgZXhwbGljaXRseSBlbmFibGVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gbWV0YWRhdGEgLSBTcGFuIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGEucGhhc2UgLSBQaGFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW21ldGFkYXRhLmRlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBkZWNsYXJhdGlvbiBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXRhZGF0YS5kZWNsYXJhdGlvblNjb3BlSWRdIC0gSG9vayBkZWNsYXJhdGlvbiBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXRhZGF0YS5maWxlUGF0aF0gLSBTb3VyY2Ugb3duZXJzaGlwLlxuICAgKiBAcGFyYW0geygpID0+IChUIHwgUHJvbWlzZTxUPil9IGNhbGxiYWNrIC0gVGltZWQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1blByb2ZpbGVTcGFuKG1ldGFkYXRhLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fcHJvZmlsZXIpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcHJvZmlsZXIucnVuU3BhbihtZXRhZGF0YSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgdGFncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZyB8IHVuZGVmaW5lZH0gdGFncyAtIFRhZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBOb3JtYWxpemVkIHRhZ3MuXG4gICAqL1xuICBub3JtYWxpemVUYWdzKHRhZ3MpIHtcbiAgICBpZiAoIXRhZ3MpIHJldHVybiBbXVxuXG4gICAgY29uc3QgdmFsdWVzID0gW11cbiAgICBjb25zdCByYXdUYWdzID0gQXJyYXkuaXNBcnJheSh0YWdzKSA/IHRhZ3MgOiBbdGFnc11cblxuICAgIGZvciAoY29uc3QgcmF3VGFnIG9mIHJhd1RhZ3MpIHtcbiAgICAgIGlmIChyYXdUYWcgPT09IHVuZGVmaW5lZCB8fCByYXdUYWcgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHBhcnRzID0gU3RyaW5nKHJhd1RhZykuc3BsaXQoXCIsXCIpXG5cbiAgICAgIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gcGFydC50cmltKClcblxuICAgICAgICBpZiAodHJpbW1lZCkgdmFsdWVzLnB1c2godHJpbW1lZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShuZXcgU2V0KHZhbHVlcykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdGFnLlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhZyAtIFRhZyB0byBjaGVjayBmb3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGFnIGlzIHByZXNlbnQuXG4gICAqL1xuICBoYXNUYWcodGVzdEFyZ3MsIHRhZykge1xuICAgIHJldHVybiB0aGlzLm5vcm1hbGl6ZVRhZ3ModGVzdEFyZ3M/LnRhZ3MpLmluY2x1ZGVzKHRhZylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGJyb3dzZXIgdGVzdCBtb2RlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJ1bm5pbmcgYnJvd3NlciB0ZXN0cy5cbiAgICovXG4gIGlzQnJvd3NlclRlc3RNb2RlKCkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQlJPV1NFUl9URVNUUyA9PT0gXCJ0cnVlXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIGR1bW15IGlmIG5lZWRlZC5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSBbYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnNdIC0gQXR0ZW1wdC1vd25lZCBicm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aER1bW15SWZOZWVkZWQodGVzdEFyZ3MsIGNhbGxiYWNrLCBicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdKSB7XG4gICAgaWYgKCF0aGlzLmhhc1RhZyh0ZXN0QXJncywgXCJkdW1teVwiKSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNCcm93c2VyVGVzdE1vZGUoKSkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5Ccm93c2VyRHVtbXkodGVzdEFyZ3MsIGNhbGxiYWNrLCBicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuTm9kZUR1bW15KGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIG5vZGUgZHVtbXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5Ob2RlRHVtbXkoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkdW1teVBhdGggPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRFVNTVlfUEFUSCB8fCB0aGlzLmRlZmF1bHREdW1teVBhdGgoKVxuICAgIGNvbnN0IGR1bW15SW1wb3J0ID0gYXdhaXQgaW1wb3J0KHBhdGhUb0ZpbGVVUkwoZHVtbXlQYXRoKS5ocmVmKVxuICAgIGNvbnN0IER1bW15ID0gZHVtbXlJbXBvcnQuZGVmYXVsdFxuXG4gICAgaWYgKCFEdW1teT8ucnVuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYER1bW15IGhlbHBlciBub3QgZm91bmQgYXQgJHtkdW1teVBhdGh9YClcbiAgICB9XG5cbiAgICAvLyBQZXJzaXN0ZW50IHNlcnZlciByZXNvdXJjZXMgbXVzdCBub3QgaW5oZXJpdCBhbiBhdHRlbXB0IHNjb3BlIHRoYXQgd2lsbCBiZSByZXZva2VkLlxuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHVuZGVmaW5lZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgRHVtbXkucnVuKGFzeW5jICgpID0+IHt9KVxuICAgIH0pXG4gICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBhd2FpdCBjYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWZhdWx0IGR1bW15IHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVmYXVsdCBkdW1teSBoZWxwZXIgcGF0aC5cbiAgICovXG4gIGRlZmF1bHREdW1teVBhdGgoKSB7XG4gICAgY29uc3QgY3dkID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCkpXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGN3ZC5zcGxpdChwYXRoLnNlcCkuam9pbihcIi9cIilcblxuICAgIGlmIChub3JtYWxpemVkLmVuZHNXaXRoKFwiL3NwZWMvZHVtbXlcIikpIHtcbiAgICAgIHJldHVybiBwYXRoLmpvaW4oY3dkLCBcImluZGV4LmpzXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhdGguam9pbihjd2QsIFwic3BlYy9kdW1teS9pbmRleC5qc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGJyb3dzZXIgZHVtbXkuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgLSBBdHRlbXB0LW93bmVkIGJyb3dzZXIgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5Ccm93c2VyRHVtbXkodGVzdEFyZ3MsIGNhbGxiYWNrLCBjb25uZWN0aW9uUmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHVzZVRyYW5zYWN0aW9uID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJhbnNhY3Rpb24gPT09IHRydWVcbiAgICBjb25zdCB0cnVuY2F0ZSA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRydW5jYXRlXG4gICAgY29uc3Qgc2hvdWxkVHJ1bmNhdGUgPSB0cnVuY2F0ZSA9PT0gdW5kZWZpbmVkID8gIXVzZVRyYW5zYWN0aW9uIDogdHJ1bmNhdGVcblxuICAgIGlmICghdXNlVHJhbnNhY3Rpb24gJiYgIXNob3VsZFRydW5jYXRlKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJUZXN0IHJ1bm5lciBicm93c2VyIGR1bW15XCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICBjb25zdCBuZXdSZWdpc3RyYXRpb25zID0gT2JqZWN0LmVudHJpZXMoZGJzKS5tYXAoKFtkYXRhYmFzZUlkZW50aWZpZXIsIGRiXSkgPT4ge1xuICAgICAgICAvKiogQHR5cGUge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb259ICovXG4gICAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtcbiAgICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgcXVhcmFudGluZWQ6IGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBjb25uZWN0aW9uUmVnaXN0cmF0aW9ucy5wdXNoKHJlZ2lzdHJhdGlvbilcblxuICAgICAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gICAgICB9KVxuXG4gICAgICBpZiAoc2hvdWxkVHJ1bmNhdGUpIHtcbiAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgYXdhaXQgdGhpcy50cnVuY2F0ZURhdGFiYXNlcyhkYnMpXG4gICAgICB9XG4gICAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICAgIGNvbnN0IGxpZmVjeWNsZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICh1c2VUcmFuc2FjdGlvbikge1xuICAgICAgICAgIGNvbnN0IHN0YXJ0UHJvbWlzZXMgPSBuZXdSZWdpc3RyYXRpb25zLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdGFydFByb21pc2UgPSByZWdpc3RyYXRpb24uZGIuc3RhcnRUcmFuc2FjdGlvbigpXG5cbiAgICAgICAgICAgIHJlZ2lzdHJhdGlvbi5zdGFydFByb21pc2UgPSBzdGFydFByb21pc2VcbiAgICAgICAgICAgIHJldHVybiBzdGFydFByb21pc2VcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnN0IHN0YXJ0UmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChzdGFydFByb21pc2VzKVxuICAgICAgICAgIGNvbnN0IHN0YXJ0RXJyb3JzID0gc3RhcnRSZXN1bHRzXG4gICAgICAgICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgICAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgICAgICAgIGlmIChzdGFydEVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgc3RhcnRFcnJvcnNbMF1cbiAgICAgICAgICBpZiAoc3RhcnRFcnJvcnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKHN0YXJ0RXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgdHJhbnNhY3Rpb24gc3RhcnR1cCBmYWlsZWRcIiwge2NhdXNlOiBzdGFydEVycm9yc1swXX0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucm9sbGJhY2tCcm93c2VyRHVtbXlUcmFuc2FjdGlvbnMoY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKC4uLmVycm9yLmVycm9ycylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAoc2hvdWxkVHJ1bmNhdGUpIHtcbiAgICAgICAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVEYXRhYmFzZXMoZGJzKVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cblxuICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgbGlmZWN5Y2xlRXJyb3JzWzBdXG4gICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGxpZmVjeWNsZUVycm9ycywgXCJCcm93c2VyIGR1bW15IGxpZmVjeWNsZSBhbmQgY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBsaWZlY3ljbGVFcnJvcnNbMF19KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayBldmVyeSBhdHRlbXB0LW93bmVkIGJyb3dzZXIgdHJhbnNhY3Rpb24gZXhhY3RseSBvbmNlLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEJyb3dzZXIgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFsbCByb2xsYmFja3Mgc2V0dGxlLlxuICAgKi9cbiAgYXN5bmMgcm9sbGJhY2tCcm93c2VyRHVtbXlUcmFuc2FjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHJvbGxiYWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4ucmVnaXN0cmF0aW9uc10ucmV2ZXJzZSgpLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICBjb25zdCBzdGFydFByb21pc2UgPSByZWdpc3RyYXRpb24uc3RhcnRQcm9taXNlXG5cbiAgICAgIGlmICghc3RhcnRQcm9taXNlKSByZXR1cm5cblxuICAgICAgcmVnaXN0cmF0aW9uLnJvbGxiYWNrUHJvbWlzZSA/Pz0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBzdGFydFByb21pc2VcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgICAgICAgIH0gY2F0Y2ggKHF1YXJhbnRpbmVFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcXVhcmFudGluZSBicm93c2VyIGR1bW15IGRhdGFiYXNlIGFmdGVyIHRyYW5zYWN0aW9uIHN0YXJ0dXAgZmFpbGVkOiAke3JlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXJ9YCwge2NhdXNlOiBxdWFyYW50aW5lRXJyb3J9KVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBpZiAocmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkKSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5kYi5yb2xsYmFja1RyYW5zYWN0aW9uKClcbiAgICAgICAgfSBjYXRjaCAocm9sbGJhY2tFcnJvcikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgICAgICB9IGNhdGNoIChxdWFyYW50aW5lRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgICAgW3JvbGxiYWNrRXJyb3IsIHF1YXJhbnRpbmVFcnJvcl0sXG4gICAgICAgICAgICAgIGBGYWlsZWQgdG8gcm9sbCBiYWNrIGFuZCBxdWFyYW50aW5lIGJyb3dzZXIgZHVtbXkgZGF0YWJhc2U6ICR7cmVnaXN0cmF0aW9uLmRhdGFiYXNlSWRlbnRpZmllcn1gLFxuICAgICAgICAgICAgICB7Y2F1c2U6IHF1YXJhbnRpbmVFcnJvcn1cbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgcm9sbGJhY2tFcnJvclxuICAgICAgICB9XG4gICAgICB9KSgpXG5cbiAgICAgIHJldHVybiByZWdpc3RyYXRpb24ucm9sbGJhY2tQcm9taXNlXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gcm9sbGJhY2tSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJCcm93c2VyIGR1bW15IHRyYW5zYWN0aW9uIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3JzWzBdfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJtYW5lbnRseSByZW1vdmVzIG9uZSBicm93c2VyIGNvbm5lY3Rpb24gdGhhdCBjYW5ub3QgYmUgc2hhcmVkIHNhZmVseS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSByZWdpc3RyYXRpb24gLSBCcm93c2VyIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgY29ubmVjdGlvbiBpcyBkaXNjYXJkZWQuXG4gICAqL1xuICBhc3luYyBxdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pIHtcbiAgICByZWdpc3RyYXRpb24ucXVhcmFudGluZWQgPSB0cnVlXG4gICAgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVQcm9taXNlID8/PSB0aGlzLmRpc2NhcmRCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXIsIHJlZ2lzdHJhdGlvbi5kYilcbiAgICBhd2FpdCByZWdpc3RyYXRpb24ucXVhcmFudGluZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjYXJkcyBvbmUgYnJvd3NlciBkdW1teSBjb25uZWN0aW9uIHRocm91Z2ggaXRzIG93bmluZyBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gQ29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFVuc2FmZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkaXNjYXJkLlxuICAgKi9cbiAgYXN5bmMgZGlzY2FyZEJyb3dzZXJEdW1teUNvbm5lY3Rpb24oZGF0YWJhc2VJZGVudGlmaWVyLCBkYikge1xuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpLmRpc2NhcmQoZGIpXG4gIH1cblxuICAvKipcbiAgICogUXVhcmFudGluZXMgYWxsIGJyb3dzZXIgY29ubmVjdGlvbnMgY29uY3VycmVudGx5LlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEJyb3dzZXIgY29ubmVjdGlvbiByZWdpc3RyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBjb25uZWN0aW9uIGlzIGRpc2NhcmRlZC5cbiAgICovXG4gIGFzeW5jIHF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9ucyhyZWdpc3RyYXRpb25zKSB7XG4gICAgY29uc3QgcXVhcmFudGluZVJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocmVnaXN0cmF0aW9ucy5tYXAoYXN5bmMgKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gcXVhcmFudGluZVJlc3VsdHNcbiAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiBxdWFyYW50aW5lIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnVuY2F0ZSBkYXRhYmFzZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBkYnMgLSBEYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlRGF0YWJhc2VzKGRicykge1xuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhkYnMpKSB7XG4gICAgICBhd2FpdCBkYnNbaWRlbnRpZmllcl0udHJ1bmNhdGVBbGxUYWJsZXMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGNsdWRlIHRhZyBzZXQuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBFeGNsdWRlIHRhZyBzZXQuXG4gICAqL1xuICBnZXRFeGNsdWRlVGFnU2V0KCkge1xuICAgIC8qKlxuICAgICAqIENvbmZpZyB0YWdzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBjb25maWdUYWdzID0gQXJyYXkuaXNBcnJheSh0ZXN0Q29uZmlnLmV4Y2x1ZGVUYWdzKSA/IHRlc3RDb25maWcuZXhjbHVkZVRhZ3MgOiBbXVxuXG4gICAgcmV0dXJuIG5ldyBTZXQoWy4uLnRoaXMuX2V4Y2x1ZGVUYWdzLCAuLi5jb25maWdUYWdzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIGZ1bGwgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGdWxsIGRlc2NyaXB0aW9uLlxuICAgKi9cbiAgYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pIHtcbiAgICBjb25zdCBwYXJ0cyA9IGRlc2NyaXB0aW9ucy5jb25jYXQoW3Rlc3REZXNjcmlwdGlvbl0pXG5cbiAgICByZXR1cm4gcGFydHMuam9pbihcIiBcIikudHJpbSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBsaWNhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXBwbGljYXRpb24+fSAtIFJlc29sdmVzIHdpdGggdGhlIGFwcGxpY2F0aW9uLlxuICAgKi9cbiAgYXN5bmMgYXBwbGljYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLl9hcHBsaWNhdGlvbikge1xuICAgICAgdGhpcy5fYXBwbGljYXRpb24gPSBuZXcgQXBwbGljYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgLy8gUnVuIHJlcXVlc3QgaGFuZGxlcnMgaW4gdGhlIG1haW4gdGhyZWFkIChub3Qgd29ya2VyIHRocmVhZHMpIHNvIHRoZXlcbiAgICAgICAgLy8gcmVzb2x2ZSBEQiB3b3JrIHRvIHRoZSBwZXItdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBzZXQgYnlcbiAgICAgICAgLy8ge0BsaW5rIGFjdGl2YXRlVGVzdFNoYXJlZENvbm5lY3Rpb25zfS4gVGhpcyBsZXRzIHJlcXVlc3QtdHlwZSBzcGVjcyB1c2VcbiAgICAgICAgLy8gdHJhbnNhY3Rpb24tYmFzZWQgY2xlYW5pbmcgKHRoZWlyIHdyaXRlcyBsYW5kIGluc2lkZSB0aGUgdGVzdCdzXG4gICAgICAgIC8vIHRyYW5zYWN0aW9uIGFuZCByb2xsIGJhY2spIGluc3RlYWQgb2YgdHJ1bmNhdGluZyBldmVyeSB0YWJsZS5cbiAgICAgICAgaHR0cFNlcnZlcjoge2luUHJvY2VzczogdHJ1ZSwgcG9ydDogMzEwMDZ9LFxuICAgICAgICB0eXBlOiBcInRlc3QtcnVubmVyXCJcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRoaXMuX2FwcGxpY2F0aW9uLmluaXRpYWxpemUoKVxuICAgICAgYXdhaXQgdGhpcy5fYXBwbGljYXRpb24uc3RhcnRIdHRwU2VydmVyKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXBwbGljYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgZWFjaCBub24tdGVuYW50IHBlci10ZXN0IGNvbm5lY3Rpb24gYXMgYSBkeW5hbWljIGNhbmRpZGF0ZSBmb3IgaW4tcHJvY2Vzc1xuICAgKiByZXF1ZXN0IHNoYXJpbmcuIFRoZSBwb29sIGV2YWx1YXRlcyB0cmFuc2FjdGlvbiBzdGF0ZSB3aGVuIGVhY2ggcmVxdWVzdCBpcyBkaXNwYXRjaGVkLFxuICAgKiBzbyBhIHRyYW5zYWN0aW9uIHN0YXJ0ZWQgb3IgZW5kZWQgZHVyaW5nIGEgaG9vayBjYWxsYmFjayB0YWtlcyBlZmZlY3QgaW1tZWRpYXRlbHkuXG4gICAqIEluYWN0aXZlIGFuZCB0ZW5hbnQtb25seSBjb25uZWN0aW9ucyByZW1haW4gaW5kZXBlbmRlbnRseSBwb29sZWQuIFBhaXIgd2l0aFxuICAgKiB7QGxpbmsgY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnN9IGluIGEgZmluYWxseS5cbiAgICogQHJldHVybnMge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119IC0gTGlmZWN5Y2xlLW93bmVkIHJlZ2lzdHJhdGlvbnMuXG4gICAqL1xuICBhY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9ucygpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbnMgPSBjb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG4gICAgLyoqIEB0eXBlIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAqL1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKGN1cnJlbnRDb25uZWN0aW9ucykpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICAvLyBUZW5hbnQtc2NvcGVkIHBvb2xzIHJlc29sdmUgYSBkaWZmZXJlbnQgY29ubmVjdGlvbiBwZXIgcmVxdWVzdCB0ZW5hbnRcbiAgICAgIC8vICh2aWEgcnVuV2l0aFRlbmFudCksIHNvIGZvcmNpbmcgYSBzaW5nbGUgc2hhcmVkIGNvbm5lY3Rpb24gd291bGQgYnJlYWtcbiAgICAgIC8vIHBlci1yZXF1ZXN0IHRlbmFudCByZXNvbHV0aW9uLiBPbmx5IHNoYXJlIG5vbi10ZW5hbnQgcG9vbHM7IHRoZSB0ZW5hbnRcbiAgICAgIC8vIHBvb2wga2VlcHMgcmVzb2x2aW5nIGl0cyBvd24gY29ubmVjdGlvbiBwZXIgcmVxdWVzdC5cbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb24oKS50ZW5hbnRPbmx5KSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBjdXJyZW50Q29ubmVjdGlvbnNbaWRlbnRpZmllcl1cblxuICAgICAgY29uc3QgcmVnaXN0cmF0aW9uID0gcG9vbC5zZXRUZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGNvbm5lY3Rpb24gOiB1bmRlZmluZWRcbiAgICAgIH0pXG5cbiAgICAgIGlmIChyZWdpc3RyYXRpb24pIHJlZ2lzdHJhdGlvbnMucHVzaCh7cG9vbCwgcmVnaXN0cmF0aW9ufSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgaW4tcHJvY2VzcyB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIG9uIGV2ZXJ5IGNvbmZpZ3VyZWQgcG9vbC4gSWRlbXBvdGVudCBhbmRcbiAgICogc2FmZSB0byBjYWxsIHdoZW4gbm9uZSB3YXMgc2V0LlxuICAgKiBAcGFyYW0ge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119IFtyZWdpc3RyYXRpb25zXSAtIExpZmVjeWNsZS1vd25lZCByZWdpc3RyYXRpb25zIHRvIGNsZWFyIGNvbmRpdGlvbmFsbHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGlmIChyZWdpc3RyYXRpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IHtwb29sLCByZWdpc3RyYXRpb259IG9mIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgICAgcG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgICBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIG91dCBhbmQgcmVnaXN0ZXJzIG9uZSBwaHlzaWNhbCB0ZW5hbnQgdHJhbnNhY3Rpb24gZm9yIHRoZSBjdXJyZW50IGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ6IG9iamVjdH19IGFyZ3MgLSBMb2dpY2FsIGlkZW50aWZpZXIgYW5kIHRlbmFudCBkZXNjcmlwdG9yLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEN1cnJlbnQgYXR0ZW1wdCByZWdpc3RyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCh7ZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQsIC4uLnJlc3RBcmdzfSwgcmVnaXN0cmF0aW9ucykge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcInJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICghdGVuYW50KSB0aHJvdyBuZXcgRXJyb3IoXCJyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSB0ZW5hbnRcIilcblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbi5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50KVxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLnRlbmFudE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgdGVuYW50T25seSBkYXRhYmFzZTogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG4gICAgY29uc3QgcmV1c2VLZXkgPSBwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgaWYgKHJlZ2lzdHJhdGlvbnMuc29tZSgocmVnaXN0cmF0aW9uKSA9PiByZWdpc3RyYXRpb24ucG9vbCA9PT0gcG9vbCAmJiByZWdpc3RyYXRpb24ucmV1c2VLZXkgPT09IHJldXNlS2V5KSkgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb259ICovXG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge1xuICAgICAgY29ubmVjdGlvbjogdW5kZWZpbmVkLFxuICAgICAgcG9vbCxcbiAgICAgIHJldXNlS2V5LFxuICAgICAgcmV2b2tlZDogZmFsc2UsXG4gICAgICBzaGFyZWRSZWdpc3RyYXRpb246IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHJlZ2lzdHJhdGlvbnMucHVzaChyZWdpc3RyYXRpb24pXG4gICAgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZSA9IHBvb2xcbiAgICAgIC5jaGVja291dEZvckNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZTogXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvblwifSlcbiAgICAgIC50aGVuKFxuICAgICAgICAoY29ubmVjdGlvbikgPT4gKHtjb25uZWN0aW9uLCBlcnJvcjogdW5kZWZpbmVkfSksXG4gICAgICAgIChlcnJvcikgPT4gKHtcbiAgICAgICAgICBjb25uZWN0aW9uOiB1bmRlZmluZWQsXG4gICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IGNvbm5lY3Rpb24gY2hlY2tvdXQgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgICB9KVxuICAgICAgKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNoZWNrb3V0T3V0Y29tZSA9IGF3YWl0IHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2VcblxuICAgICAgaWYgKGNoZWNrb3V0T3V0Y29tZS5lcnJvcikgdGhyb3cgY2hlY2tvdXRPdXRjb21lLmVycm9yXG4gICAgICBpZiAoIWNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCBjb25uZWN0aW9uIGNoZWNrb3V0IHJldHVybmVkIG5vIGNvbm5lY3Rpb25cIilcbiAgICAgIHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uID0gY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb25cbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG5cbiAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uLnN0YXJ0VHJhbnNhY3Rpb24oKVxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcblxuICAgICAgY29uc3Qgc2hhcmVkUmVnaXN0cmF0aW9uID0gcG9vbC5zZXRUZXN0U2hhcmVkQ29ubmVjdGlvbkZvckNvbmZpZ3VyYXRpb24ocmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24sIHJldXNlS2V5KVxuICAgICAgaWYgKCFzaGFyZWRSZWdpc3RyYXRpb24pIHRocm93IG5ldyBFcnJvcihgRGF0YWJhc2UgcG9vbCBkb2VzIG5vdCBzdXBwb3J0IHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvbnM6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgICByZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uID0gc2hhcmVkUmVnaXN0cmF0aW9uXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHtcbiAgICAgICAgcG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHNoYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5yZXZva2VkID0gdHJ1ZVxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHMoW3JlZ2lzdHJhdGlvbl0sIHtkaXNjYXJkOiByZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCA9PT0gdHJ1ZX0pXG4gICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFtlcnJvciwgY2xlYW51cEVycm9yXSwgXCJGYWlsZWQgdG8gcmVnaXN0ZXIgYW5kIGNsZWFuIHVwIGEgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uXCIsIHtjYXVzZTogY2xlYW51cEVycm9yfSlcbiAgICAgIH1cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldm9rZXMgYXR0ZW1wdCByZWdpc3RyYXRpb25zIGJlZm9yZSByb2xsaW5nIGJhY2sgYW5kIHJlbGVhc2luZyB0aGVpciBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbnMuXG4gICAqIEBwYXJhbSB7e2Rpc2NhcmQ/OiBib29sZWFufX0gW29wdGlvbnNdIC0gV2hldGhlciBjb25uZWN0aW9ucyBtdXN0IGJlIGRpc2NhcmRlZCBpbnN0ZWFkIG9mIHJldHVybmVkIHRvIHRoZSBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50cyhyZWdpc3RyYXRpb25zLCB7ZGlzY2FyZCA9IGZhbHNlfSA9IHt9KSB7XG4gICAgZm9yIChjb25zdCByZWdpc3RyYXRpb24gb2YgcmVnaXN0cmF0aW9ucykge1xuICAgICAgcmVnaXN0cmF0aW9uLnJldm9rZWQgPSB0cnVlXG4gICAgICBpZiAoZGlzY2FyZCkgcmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXAgPSB0cnVlXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbikgcmVnaXN0cmF0aW9uLnBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihyZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uKVxuICAgIH1cbiAgICBjb25zdCBjbGVhbnVwUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4ucmVnaXN0cmF0aW9uc10ucmV2ZXJzZSgpLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICByZWdpc3RyYXRpb24uY2xlYW51cFByb21pc2UgPz89IHRoaXMuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24ocmVnaXN0cmF0aW9uKVxuXG4gICAgICByZXR1cm4gcmVnaXN0cmF0aW9uLmNsZWFudXBQcm9taXNlXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gY2xlYW51cFJlc3VsdHNcbiAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gY2xlYW4gdXAgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFucyBvbmUgYXR0ZW1wdCByZWdpc3RyYXRpb24gZXhhY3RseSBvbmNlLCBpbmNsdWRpbmcgYSBjaGVja291dCB0aGF0IHdhcyBzdGlsbCBwZW5kaW5nIGF0IHJldm9jYXRpb24uXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbn0gcmVnaXN0cmF0aW9uIC0gQXR0ZW1wdC1vd25lZCByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJvbGxiYWNrIGFuZCByZWxlYXNlIG9yIHF1YXJhbnRpbmUuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbihyZWdpc3RyYXRpb24pIHtcbiAgICBsZXQgY29ubmVjdGlvbiA9IHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24gJiYgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZSkge1xuICAgICAgY29uc3QgY2hlY2tvdXRPdXRjb21lID0gYXdhaXQgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZVxuXG4gICAgICBpZiAoY2hlY2tvdXRPdXRjb21lLmVycm9yKSByZXR1cm5cbiAgICAgIGNvbm5lY3Rpb24gPSBjaGVja291dE91dGNvbWUuY29ubmVjdGlvblxuICAgICAgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24gPSBjb25uZWN0aW9uXG4gICAgfVxuICAgIGlmICghY29ubmVjdGlvbikgcmV0dXJuXG5cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkpIGF3YWl0IGNvbm5lY3Rpb24ucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAocmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXApIHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24ucG9vbC5kaXNjYXJkKGNvbm5lY3Rpb24pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLnBvb2wuY2hlY2tpbihjb25uZWN0aW9uKVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gY2xlYW4gdXAgYSB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RzIHRoZSBjdXJyZW50IG5vbi10ZW5hbnQgY29ubmVjdGlvbnMgZWxpZ2libGUgZm9yIHNoYXJlZCB0cmFuc2FjdGlvbiB3b3JrLlxuICAgKiBAcGFyYW0ge3t0cmFuc2FjdGlvbnNPbmx5OiBib29sZWFufX0gYXJncyAtIFNlbGVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIEVsaWdpYmxlIGNvbm5lY3Rpb25zIGJ5IGlkZW50aWZpZXIuXG4gICAqL1xuICBzaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9ucyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBjb25uZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyhjdXJyZW50Q29ubmVjdGlvbnMpKSB7XG4gICAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgaWYgKHBvb2wuZ2V0Q29uZmlndXJhdGlvbigpLnRlbmFudE9ubHkpIGNvbnRpbnVlXG4gICAgICBpZiAodHJhbnNhY3Rpb25zT25seSAmJiAhY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBjb250aW51ZVxuICAgICAgY29ubmVjdGlvbnNbaWRlbnRpZmllcl0gPSBjb25uZWN0aW9uXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25zXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgcGh5c2ljYWwtY29ubmVjdGlvbiBjb29yZGluYXRpb24gYmVmb3JlIGEgdHJhbnNhY3Rpb24tb3BlbmluZyBob29rXG4gICAqIGNhbiBleHBvc2UgdGhlIHNoYXJlZCBjb25uZWN0aW9uIHRvIGEgbG9uZy1saXZlZCBpbi1wcm9jZXNzIHNlcnZpY2UuXG4gICAqIENoaWxkLXByb2Nlc3MgY29vcmRpbmF0ZXMgcmVtYWluIHVucHVibGlzaGVkIHVudGlsIHRoZSB0cmFuc2FjdGlvbiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBQcmVwYXJlZCBjb29yZGluYXRvci5cbiAgICovXG4gIGFzeW5jIHByZXBhcmVTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcigpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seTogZmFsc2V9KVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKS5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7XG4gICAgICBicm9rZXI6IGF3YWl0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLnN0YXJ0KHtjb25uZWN0aW9uc30pLFxuICAgICAgZW52aXJvbm1lbnRQdWJsaXNoZWQ6IGZhbHNlLFxuICAgICAgcHJldmlvdXNFbnZpcm9ubWVudDogdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgcHJlcGFyZWQgYnJva2VyIGNvb3JkaW5hdGVzIGV4YWN0bHkgdGhlIHNlbGVjdGVkIHBoeXNpY2FsIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSByZWdpc3RyYXRpb24gLSBQcmVwYXJlZCBjb29yZGluYXRvci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGNvbm5lY3Rpb25zIC0gU2VsZWN0ZWQgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGlkZW50aWZpZXIgc2V0IGFuZCBwaHlzaWNhbCBjb25uZWN0aW9ucyBtYXRjaCBleGFjdGx5LlxuICAgKi9cbiAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJNYXRjaGVzQ29ubmVjdGlvbnMocmVnaXN0cmF0aW9uLCBjb25uZWN0aW9ucykge1xuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpXG5cbiAgICBpZiAoIXJlZ2lzdHJhdGlvbiB8fCBpZGVudGlmaWVycy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuICAgIGlmIChPYmplY3Qua2V5cyhyZWdpc3RyYXRpb24uYnJva2VyLmNvbm5lY3Rpb25zKS5sZW5ndGggIT09IGlkZW50aWZpZXJzLmxlbmd0aCkgcmV0dXJuIGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBjb25uZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyhjb25uZWN0aW9ucykpIHtcbiAgICAgIGlmIChyZWdpc3RyYXRpb24uYnJva2VyLmNvbm5lY3Rpb25zW2lkZW50aWZpZXJdICE9PSBjb25uZWN0aW9uKSByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhIGNhcGFiaWxpdHktc2NvcGVkIGJyb2tlciBmb3IgdGhlIGFjdGl2ZSBub24tdGVuYW50IHBoeXNpY2FsXG4gICAqIHRyYW5zYWN0aW9uIGNvbm5lY3Rpb25zLiBObyBicm9rZXIvZW52IGlzIGluc3RhbGxlZCBmb3IgdHJ1bmNhdGlvbi1vbmx5IG9yXG4gICAqIG90aGVyIHRyYW5zYWN0aW9uLWRpc2FibGVkIGF0dGVtcHRzLlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9ufSBbcHJlcGFyZWRSZWdpc3RyYXRpb25dIC0gQ29vcmRpbmF0b3IgcHJlcGFyZWQgYmVmb3JlIGhvb2tzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gW3NlbGVjdGVkQ29ubmVjdGlvbnNdIC0gUG9zdC1ob29rIGFjdGl2ZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWQ+fSAtIEF0dGVtcHQgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbiwgc2VsZWN0ZWRDb25uZWN0aW9ucykge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gc2VsZWN0ZWRDb25uZWN0aW9ucyB8fCB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IHRydWV9KVxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKVxuICAgIGlmIChkYXRhYmFzZUlkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgbGV0IGJyb2tlclxuXG4gICAgaWYgKHByZXBhcmVkUmVnaXN0cmF0aW9uICYmIHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJNYXRjaGVzQ29ubmVjdGlvbnMocHJlcGFyZWRSZWdpc3RyYXRpb24sIGNvbm5lY3Rpb25zKSkge1xuICAgICAgYnJva2VyID0gcHJlcGFyZWRSZWdpc3RyYXRpb24uYnJva2VyXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgYnJva2VyID0gYXdhaXQgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIuc3RhcnQoe2Nvbm5lY3Rpb25zfSlcbiAgICB9XG5cbiAgICBjb25zdCBwcmV2aW91c0Vudmlyb25tZW50ID0gcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdXG4gICAgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgYWRkcmVzczogYnJva2VyLmFkZHJlc3MoKSxcbiAgICAgIGNhcGFiaWxpdHk6IGJyb2tlci5jYXBhYmlsaXR5KCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgZXhwZWN0ZWQ6IHRydWVcbiAgICB9KSkudG9TdHJpbmcoXCJiYXNlNjR1cmxcIilcblxuICAgIHJldHVybiB7YnJva2VyLCBlbnZpcm9ubWVudFB1Ymxpc2hlZDogdHJ1ZSwgcHJldmlvdXNFbnZpcm9ubWVudH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXZva2VzIGFuIGF0dGVtcHQgYnJva2VyIGJlZm9yZSBkYXRhYmFzZSByb2xsYmFjayBob29rcyBydW4gYW5kIHJlc3RvcmVzXG4gICAqIHRoZSBjYWxsZXIncyBlbnZpcm9ubWVudCBzbyBsYXRlciBwb29sZWQvc3Bhd25lZCBjaGlsZHJlbiBjYW5ub3QgaW5oZXJpdCBpdC5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gcmVnaXN0cmF0aW9uIC0gQXR0ZW1wdCByZWdpc3RyYXRpb24uXG4gICAqL1xuICBhc3luYyBzdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocmVnaXN0cmF0aW9uKSB7XG4gICAgaWYgKCFyZWdpc3RyYXRpb24pIHJldHVyblxuXG4gICAgaWYgKHJlZ2lzdHJhdGlvbi5lbnZpcm9ubWVudFB1Ymxpc2hlZCkge1xuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5wcmV2aW91c0Vudmlyb25tZW50ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdID0gcmVnaXN0cmF0aW9uLnByZXZpb3VzRW52aXJvbm1lbnRcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgcmVnaXN0cmF0aW9uLmJyb2tlci5jbG9zZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1ZXN0IGNsaWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVxdWVzdENsaWVudD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcmVxdWVzdCBjbGllbnQuXG4gICAqL1xuICBhc3luYyByZXF1ZXN0Q2xpZW50KCkge1xuICAgIGlmICghdGhpcy5fcmVxdWVzdENsaWVudCkge1xuICAgICAgdGhpcy5fcmVxdWVzdENsaWVudCA9IG5ldyBSZXF1ZXN0Q2xpZW50KClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fcmVxdWVzdENsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IHRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbXBvcnRUZXN0RmlsZXMoKSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmICghdGhpcy5fcHJvZmlsZXIpIHtcbiAgICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5pbXBvcnRUZXN0RmlsZXModGhpcy5nZXRUZXN0RmlsZXMoKSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGZvciAoY29uc3QgdGVzdEZpbGUgb2YgdGhpcy5nZXRUZXN0RmlsZXMoKSkge1xuICAgICAgY29uc3QgZXhpc3RpbmdSZWdpc3RyYXRpb25zID0gdGhpcy50ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cygpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICB9LCB7ZmlsZVBhdGg6IHRlc3RGaWxlfSlcbiAgICAgIHRoaXMuYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcChleGlzdGluZ1JlZ2lzdHJhdGlvbnMsIHRlc3RGaWxlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsZWN0cyBwYWNrYWdlIGRlY2xhcmF0aW9uIG9iamVjdHMgYnkgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7U2V0PFBhY2thZ2VSZWdpc3RyYXRpb24+fSBbcmVnaXN0cmF0aW9uc10gLSBBY2N1bXVsYXRlZCBpZGVudGl0aWVzLlxuICAgKiBAcmV0dXJucyB7U2V0PFBhY2thZ2VSZWdpc3RyYXRpb24+fSAtIFJlZ2lzdHJhdGlvbiBpZGVudGl0aWVzLlxuICAgKi9cbiAgdGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMocmVnaXN0cmF0aW9ucyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IHZpc2l0ID0gKC8qKiBAdHlwZSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259ICovIHN1aXRlKSA9PiB7XG4gICAgICByZWdpc3RyYXRpb25zLmFkZChzdWl0ZSlcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBbLi4uc3VpdGUuaG9va3MuYmVmb3JlQWxsLCAuLi5zdWl0ZS5ob29rcy5iZWZvcmVFYWNoLCAuLi5zdWl0ZS5ob29rcy5hZnRlckVhY2gsIC4uLnN1aXRlLmhvb2tzLmFmdGVyQWxsXSkge1xuICAgICAgICByZWdpc3RyYXRpb25zLmFkZChob29rKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCB0ZXN0RGVjbGFyYXRpb24gb2Ygc3VpdGUudGVzdHMpIHJlZ2lzdHJhdGlvbnMuYWRkKHRlc3REZWNsYXJhdGlvbilcbiAgICAgIGZvciAoY29uc3QgY2hpbGRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIHZpc2l0KGNoaWxkU3VpdGUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWl0ZSBvZiB0aGlzLmdldFRlc3RDb250ZXh0KCkucmVnaXN0cnkuc3VpdGVzKSB2aXNpdChzdWl0ZSlcblxuICAgIHJldHVybiByZWdpc3RyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBkZXRlcm1pbmlzdGljIG93bmVyc2hpcCB0byBwYWNrYWdlIGRlY2xhcmF0aW9ucyBhZGRlZCBieSBvbmUgZW50cnkgZmlsZS5cbiAgICogQHBhcmFtIHtTZXQ8UGFja2FnZVJlZ2lzdHJhdGlvbj59IHByZXZpb3VzUmVnaXN0cmF0aW9ucyAtIElkZW50aXRpZXMgcHJlc2VudCBiZWZvcmUgaW1wb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3duZXJGaWxlUGF0aCAtIEltcG9ydGluZyBlbnRyeSBmaWxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAocHJldmlvdXNSZWdpc3RyYXRpb25zLCBvd25lckZpbGVQYXRoKSB7XG4gICAgZm9yIChjb25zdCByZWdpc3RyYXRpb24gb2YgdGhpcy50ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cygpKSB7XG4gICAgICBpZiAoIXByZXZpb3VzUmVnaXN0cmF0aW9ucy5oYXMocmVnaXN0cmF0aW9uKSkgdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuc2V0KHJlZ2lzdHJhdGlvbiwgb3duZXJGaWxlUGF0aClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZmFpbGVkLlxuICAgKi9cbiAgaXNGYWlsZWQoKSB7IHJldHVybiB0aGlzLl9mYWlsZWRUZXN0cyAhPT0gdW5kZWZpbmVkICYmICh0aGlzLl9mYWlsZWRUZXN0cyA+IDAgfHwgdGhpcy5fcGFja2FnZVJlc3VsdD8uc3RhdHVzID09PSBcImZhaWxlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZhaWxlZCB0ZXN0cy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZmFpbGVkIHRlc3RzLlxuICAgKi9cbiAgZ2V0RmFpbGVkVGVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX2ZhaWxlZFRlc3RzID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIlRlc3RzIGhhc24ndCBiZWVuIHJ1biB5ZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9mYWlsZWRUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBzZWxlY3RlZCB0ZXN0cyBibG9ja2VkIGJ5IGEgdGVybWluYWwgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gU2VsZWN0ZWQgdGVzdHMgbm90IGV4ZWN1dGVkIGJlY2F1c2UgYSBzaGFyZWQgcmVzb3VyY2UgZmFpbGVkLlxuICAgKi9cbiAgZ2V0Tm90UnVuVGVzdHMoKSB7IHJldHVybiB0aGlzLl9ub3RSdW5UZXN0RGV0YWlscy5sZW5ndGggfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHJ1bnRpbWUgbm9uLXJ1biBhdHRyaWJ1dGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuTm9uUnVuVGVzdFJlc3VsdFtdfSAtIFJ1bnRpbWUgbm9uLXJ1biBkZXRhaWxzIHdpdGggdGhlIG9yaWdpbmF0aW5nIGZhaWx1cmUuXG4gICAqL1xuICBnZXROb3RSdW5UZXN0RGV0YWlscygpIHsgcmV0dXJuIHRoaXMuX25vdFJ1blRlc3REZXRhaWxzIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHNlbGVjdGVkIHRlc3QgdGhhdCBkaWQgbm90IGV4ZWN1dGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5Ob25SdW5UZXN0UmVzdWx0fSByZXN1bHQgLSBUZXJtaW5hbC1yZXNvdXJjZSBub24tcnVuIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmROb3RSdW5UZXN0KHJlc3VsdCkgeyB0aGlzLl9ub3RSdW5UZXN0RGV0YWlscy5wdXNoKHJlc3VsdCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdCBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7RmFpbGVkVGVzdERldGFpbFtdfSAtIEZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0RGV0YWlscygpIHtcbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdERldGFpbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3QgZmFpbGVkIHRlc3QgY29uc29sZSBvdXRwdXRzIHRvIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYXNzZXRzUGF0aF0gLSBBc3NldHMgZGlyZWN0b3J5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBXcml0dGVuIGxvZyBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdEZhaWxlZFRlc3RDb25zb2xlT3V0cHV0c1RvQXNzZXRzKHthc3NldHNQYXRoID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksIFwidG1wL3NjcmVlbnNob3RzXCIpfSA9IHt9KSB7XG4gICAgY29uc3QgZmFpbGVkVGVzdERldGFpbHMgPSB0aGlzLmdldEZhaWxlZFRlc3REZXRhaWxzKClcbiAgICBjb25zdCB3cml0dGVuTG9nUGF0aHMgPSBbXVxuICAgIGxldCBjcmVhdGVkRGlyZWN0b3J5ID0gZmFsc2VcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBmYWlsZWRUZXN0RGV0YWlscy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGNvbnN0IGZhaWxlZFRlc3REZXRhaWwgPSBmYWlsZWRUZXN0RGV0YWlsc1tpbmRleF1cbiAgICAgIGNvbnN0IGNvbnNvbGVPdXRwdXQgPSBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVPdXRwdXRcblxuICAgICAgaWYgKCFjb25zb2xlT3V0cHV0KSBjb250aW51ZVxuXG4gICAgICBpZiAoIWNyZWF0ZWREaXJlY3RvcnkpIHtcbiAgICAgICAgYXdhaXQgZnMubWtkaXIoYXNzZXRzUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgICAgIGNyZWF0ZWREaXJlY3RvcnkgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IFtcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRGdWxsWWVhcigpKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldERhdGUoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldEhvdXJzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaW51dGVzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRTZWNvbmRzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaWxsaXNlY29uZHMoKSkucGFkU3RhcnQoMywgXCIwXCIpXG4gICAgICBdLmpvaW4oXCJcIilcbiAgICAgIGNvbnN0IHNsdWcgPSB0b0ZpbGVTbHVnKGZhaWxlZFRlc3REZXRhaWwuZnVsbERlc2NyaXB0aW9uKVxuICAgICAgY29uc3QgZmlsZU5hbWUgPSBgJHt0aW1lc3RhbXB9LSR7U3RyaW5nKGluZGV4ICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpfS0ke3NsdWd9LmNvbnNvbGUubG9nYFxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oYXNzZXRzUGF0aCwgZmlsZU5hbWUpXG5cbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgY29uc29sZU91dHB1dCwgXCJ1dGY4XCIpXG4gICAgICBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVMb2dQYXRoID0gZmlsZVBhdGhcbiAgICAgIHdyaXR0ZW5Mb2dQYXRocy5wdXNoKGZpbGVQYXRoKVxuICAgIH1cblxuICAgIHJldHVybiB3cml0dGVuTG9nUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKi9cbiAgZ2V0U3VjY2Vzc2Z1bFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldFRlc3RzQ291bnQoKSB7XG4gICAgaWYgKHRoaXMuX3Rlc3RzQ291bnQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RzQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZXhlY3V0ZWQgdGVzdHMgY291bnQuXG4gICAqL1xuICBnZXRFeGVjdXRlZFRlc3RzQ291bnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3BhY2thZ2VSZXN1bHQ/LnRlc3RzLmxlbmd0aCA/PyB0aGlzLl90ZXN0RHVyYXRpb25zLmxlbmd0aFxuICB9XG5cbiAgLyoqXG4gICAqIERpc3Rpbmd1aXNoZXMgYW4gZW1wdHkgc2VsZWN0aW9uIGZyb20gYSBmYWlsdXJlIGJlZm9yZSBzZWxlY3RlZCBjYXNlcyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHNlbGVjdGlvbiBtYXRjaGVkIG5vIGRlY2xhcmF0aW9ucy5cbiAgICovXG4gIGhhc05vTWF0Y2hlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fcGFja2FnZVJlc3VsdD8ubm9NYXRjaGVzID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdGVzdHMgcmVjb3JkZWQgZHVyaW5nIHRoZSBydW4sIHNsb3dlc3QgZmlyc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbGltaXRdIC0gTWF4aW11bSBudW1iZXIgb2YgdGVzdHMgdG8gcmV0dXJuICgwIHJldHVybnMgYWxsKS5cbiAgICogQHJldHVybnMge0FycmF5PHtmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyLCBkdXJhdGlvbk1zOiBudW1iZXJ9Pn0gLSBTbG93ZXN0IHRlc3RzLCBzbG93ZXN0IGZpcnN0LlxuICAgKi9cbiAgZ2V0U2xvd2VzdFRlc3RzKGxpbWl0ID0gMTApIHtcbiAgICBpZiAodGhpcy5fcGFja2FnZVJlc3VsdCkge1xuICAgICAgcmV0dXJuIHNsb3dlc3RUZXN0UmVzdWx0cyh0aGlzLl9wYWNrYWdlUmVzdWx0LCB7bGltaXR9KS5tYXAoKHJlc3VsdCkgPT4gKHtcbiAgICAgICAgZnVsbERlc2NyaXB0aW9uOiByZXN1bHQuZnVsbE5hbWUsXG4gICAgICAgIGZpbGVQYXRoOiByZXN1bHQuZmlsZVBhdGggPz8gXCI8dW5rbm93bj5cIixcbiAgICAgICAgbGluZTogcmVzdWx0LmxpbmUgPz8gMCxcbiAgICAgICAgZHVyYXRpb25NczogcmVzdWx0LmR1cmF0aW9uTXNcbiAgICAgIH0pKVxuICAgIH1cblxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi50aGlzLl90ZXN0RHVyYXRpb25zXS5zb3J0KCh0ZXN0QSwgdGVzdEIpID0+IHRlc3RCLmR1cmF0aW9uTXMgLSB0ZXN0QS5kdXJhdGlvbk1zKVxuXG4gICAgcmV0dXJuIGxpbWl0ID4gMCA/IHNvcnRlZC5zbGljZSgwLCBsaW1pdCkgOiBzb3J0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZXBhcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBwcmVwYXJlKCkge1xuICAgIHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9IGZhbHNlXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAwXG4gICAgdGhpcy5fbm90UnVuVGVzdERldGFpbHMgPSBbXVxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICB0aGlzLl90ZXN0RHVyYXRpb25zID0gW11cbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2NvbXBsZXRlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX3Rlc3RNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gdW5kZWZpbmVkXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0VGVzdENvbnRleHQoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBvd25lckZpbGVQYXRoXG5cbiAgICBjb250ZXh0LnJlc2V0KHtjb25maWc6IHRydWV9KVxuICAgIGNvbnRleHQuc2V0RGVjbGFyYXRpb25Mb2NhdG9yKCgpID0+IHRoaXMuY2FwdHVyZVRlc3REZWNsYXJhdGlvbkxvY2F0aW9uKG93bmVyRmlsZVBhdGgpKVxuICAgIGNvbnN0IHRlc3RpbmdDb25maWdQYXRoID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0VGVzdGluZygpXG5cbiAgICBhd2FpdCBjb250ZXh0LmRlc2NyaWJlKFwiXCIsIHtkYXRhYmFzZUNsZWFuaW5nOiB7dHJhbnNhY3Rpb246IHRydWV9fSwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX3NldHVwRmlsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1blByb2ZpbGVTcGFuKHtwaGFzZTogXCJ0ZXN0aW5nIGNvbmZpZy9nbG9iYWwgc2V0dXBcIn0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbXBvcnRUZXN0RmlsZXModGhpcy5fc2V0dXBGaWxlcylcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgaWYgKHRlc3RpbmdDb25maWdQYXRoKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuUHJvZmlsZVNwYW4oe3BoYXNlOiBcInRlc3RpbmcgY29uZmlnL2dsb2JhbCBzZXR1cFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmltcG9ydFRlc3RpbmdDb25maWdQYXRoKClcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9wcm9maWxlcikge1xuICAgICAgICBhd2FpdCB0aGlzLmltcG9ydFRlc3RGaWxlcygpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRoaXMuZ2V0VGVzdEZpbGVzKCkpIHtcbiAgICAgICAgICBvd25lckZpbGVQYXRoID0gdGVzdEZpbGVcbiAgICAgICAgICBjb25zdCBleGlzdGluZ1JlZ2lzdHJhdGlvbnMgPSB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKClcblxuICAgICAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICAgICAgfSwge2ZpbGVQYXRoOiB0ZXN0RmlsZX0pXG4gICAgICAgICAgdGhpcy5hc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKGV4aXN0aW5nUmVnaXN0cmF0aW9ucywgdGVzdEZpbGUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICAgIG93bmVyRmlsZVBhdGggPSB1bmRlZmluZWRcbiAgICB0aGlzLmFuYWx5emVEZWNsYXJhdGlvbnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGEgdGVzdCBzb3VyY2UgbG9jYXRpb24gd2l0aG91dCBhdHRyaWJ1dGluZyBwYWNrYWdlL2ZhY2FkZSBmcmFtZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBvd25lckZpbGVQYXRoIC0gSW1wb3J0aW5nIGVudHJ5IGZpbGUgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHt7ZmlsZVBhdGg/OiBzdHJpbmcsIGxpbmU/OiBudW1iZXJ9fSAtIERlY2xhcmF0aW9uIGxvY2F0aW9uLlxuICAgKi9cbiAgY2FwdHVyZVRlc3REZWNsYXJhdGlvbkxvY2F0aW9uKG93bmVyRmlsZVBhdGgpIHtcbiAgICBjb25zdCBzdGFjayA9IG5ldyBFcnJvcigpLnN0YWNrPy5zcGxpdChcIlxcblwiKSB8fCBbXVxuXG4gICAgZm9yIChjb25zdCBzdGFja0xpbmUgb2Ygc3RhY2spIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gc3RhY2tMaW5lLm1hdGNoKC8oPzpcXCh8XFxzKShmaWxlOlxcL1xcLy4qP3xcXC9bXlwiXSo/KTooXFxkKyk6KFxcZCspXFwpPyQvdSlcbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGxldCBmaWxlUGF0aCA9IG1hdGNoWzFdXG4gICAgICBpZiAoZmlsZVBhdGguc3RhcnRzV2l0aChcImZpbGU6Ly9cIikpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmaWxlUGF0aCA9IGZpbGVVUkxUb1BhdGgoZmlsZVBhdGgpXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc29sdmVkRmlsZVBhdGggPSBwYXRoLnJlc29sdmUoZmlsZVBhdGgpXG4gICAgICBjb25zdCBwb3J0YWJsZVBhdGggPSByZXNvbHZlZEZpbGVQYXRoLnJlcGxhY2VBbGwocGF0aC5zZXAsIFwiL1wiKVxuXG4gICAgICBpZiAocG9ydGFibGVQYXRoLmVuZHNXaXRoKFwiL3NyYy90ZXN0aW5nL3Rlc3QtcnVubmVyLmpzXCIpKSBjb250aW51ZVxuICAgICAgaWYgKHBvcnRhYmxlUGF0aC5lbmRzV2l0aChcIi9zcmMvdGVzdGluZy90ZXN0LmpzXCIpKSBjb250aW51ZVxuICAgICAgaWYgKHJlc29sdmVkRmlsZVBhdGguc3RhcnRzV2l0aChgJHt0ZXN0aW5nUGFja2FnZURpcmVjdG9yeX0ke3BhdGguc2VwfWApKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4ge2ZpbGVQYXRoOiByZXNvbHZlZEZpbGVQYXRoLCBsaW5lOiBOdW1iZXIobWF0Y2hbMl0pfVxuICAgIH1cblxuICAgIHJldHVybiBvd25lckZpbGVQYXRoID8ge2ZpbGVQYXRoOiBvd25lckZpbGVQYXRofSA6IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcmUgYW55IHRlc3RzIGZvY3Vzc2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFueSB0ZXN0cyBmb2N1c3NlZC5cbiAgICovXG4gIGFyZUFueVRlc3RzRm9jdXNzZWQoKSB7XG4gICAgaWYgKHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJIYXNuJ3QgYmVlbiBkZXRlY3RlZCB5ZXRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICAvKipcbiAgICogUmVjb3JkcyBhbiBhc3luY2hyb25vdXMgY3Jhc2ggKGFuIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbiBkZXRhY2hlZCBmcm9tXG4gICAqIGFueSBhd2FpdCwgZS5nLiBhIGB2b2lkIGNvbm5lY3Rpb24uYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4gYnJvYWRjYXN0KC4uLikpYFxuICAgKiBmcm9udGVuZC1tb2RlbCBwdWJsaXNoIOKAlCBvciBhIHN5bmNocm9ub3VzIHRocm93IGluc2lkZSBhIGRldGFjaGVkIGNhbGxiYWNrXG4gICAqIHN1Y2ggYXMgYSBkcml2ZXIgc29ja2V0IG9yIHRpbWVyIGNhbGxiYWNrKSBhcyBhIHJlYWwsIHZpc2libGUsIGF0dHJpYnV0ZWRcbiAgICogdGVzdCBmYWlsdXJlLlxuICAgKlxuICAgKiBXaXRob3V0IHRoaXMsIHN1Y2ggYSByZWplY3Rpb24vZXhjZXB0aW9uIGhhcyBubyBoYW5kbGVyLCBzbyBvbiBtb2Rlcm4gTm9kZVxuICAgKiB0aGUgcHJvY2VzcyBpcyBURVJNSU5BVEVEIOKAlCB0aGUgcnVuIGVuZHMgd2l0aCBubyByZXBvcnRlZCBmYWlsdXJlcyBhbmQgQ0lcbiAgICoganVzdCBzZWVzIGEgY3Jhc2hlZC9yZXRyaWVkIHNoYXJkIHdpdGggYW4gZW1wdHkgcmVzdWx0ICh0aGUgcmVjdXJyaW5nXG4gICAqIFwic2lsZW50IHRlc3QtcnVubmVyIGRlYXRoXCI6IGludmlzaWJsZSBhbmQgaW1wb3NzaWJsZSB0byBkaWFnbm9zZSkuIFR1cm5pbmdcbiAgICogaXQgaW50byBhIGZhaWx1cmUgbWFrZXMgdGhlIHJ1biBnbyByZWQgd2l0aCBzb21ldGhpbmcgZGVidWdnYWJsZSBpbnN0ZWFkIG9mXG4gICAqIHZhbmlzaGluZy5cbiAgICogQHBhcmFtIHtcInVuY2F1Z2h0RXhjZXB0aW9uXCIgfCBcInVuaGFuZGxlZFJlamVjdGlvblwifSBraW5kIC0gQXN5bmMtY3Jhc2gga2luZC5cbiAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBSZWplY3Rpb24gcmVhc29uIG9yIHRocm93biBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRBc3luY0NyYXNoKGtpbmQsIHJlYXNvbikge1xuICAgIGNvbnN0IGVycm9yID0gcmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyByZWFzb24gOiBuZXcgRXJyb3IoYCR7a2luZH06ICR7U3RyaW5nKHJlYXNvbil9YClcbiAgICBjb25zdCBuZWFyID0gdGhpcy5fbGFzdFRlc3RDb250ZXh0XG4gICAgY29uc3QgYXR0cmlidXRpb24gPSBuZWFyID8gYCwgbmVhciB0ZXN0OiAke25lYXIuZnVsbERlc2NyaXB0aW9ufSAoJHtuZWFyLmZpbGVQYXRofToke25lYXIubGluZX0pYCA6IFwiXCJcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gKHRoaXMuX2ZhaWxlZFRlc3RzIHx8IDApICsgMVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiBgPCR7a2luZH0gZHVyaW5nIHRlc3QgcnVuJHthdHRyaWJ1dGlvbn0+YCxcbiAgICAgIGZpbGVQYXRoOiBuZWFyID8gbmVhci5maWxlUGF0aCA6IFwiPHRlc3QgcnVubmVyPlwiLFxuICAgICAgbGluZTogbmVhciA/IG5lYXIubGluZSA6IDAsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5bdGVzdC1ydW5uZXJdICR7a2luZH0gZHVyaW5nIHRoZSB0ZXN0IHJ1biDigJQgdGhpcyB3b3VsZCBvdGhlcndpc2UgdGVybWluYXRlIHRoZSBwcm9jZXNzIHNpbGVudGx5IGFuZCBzdXJmYWNlIG9ubHkgYXMgYSBjcmFzaGVkL3JldHJpZWQgc2hhcmQgd2l0aCB6ZXJvIHJlcG9ydGVkIGZhaWx1cmVzLiR7YXR0cmlidXRpb259YCkpXG4gICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgY2xlYW51cCBmYWlsdXJlIGFmdGVyIHRpbWVvdXQgaGFuZGxpbmcgaGFzIGJlZ3VuLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIERldGFjaGVkIGNsZWFudXAgcmVqZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2xlYW51cE5hbWUgLSBDbGVhbnVwIG9wZXJhdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge1NldDxFcnJvcj59IFtyZWNvcmRlZEVycm9yc10gLSBBdHRlbXB0LW93bmVkIGNsZWFudXAgZXJyb3JzIGFscmVhZHkgcmVwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKHJlYXNvbiwgY2xlYW51cE5hbWUsIHJlY29yZGVkRXJyb3JzKSB7XG4gICAgY29uc3QgZXJyb3IgPSByZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHJlYXNvbiA6IG5ldyBFcnJvcihgJHtjbGVhbnVwTmFtZX0gY2xlYW51cCBmYWlsZWQ6ICR7U3RyaW5nKHJlYXNvbil9YClcblxuICAgIGlmIChyZWNvcmRlZEVycm9ycykge1xuICAgICAgLy8gTXVsdGlwbGUgYm91bmRlZCBvYnNlcnZlcnMgY2FuIHJlY2VpdmUgdGhlIHNhbWUgZGV0YWNoZWQgY2xlYW51cCByZWplY3Rpb24uXG4gICAgICBpZiAocmVjb3JkZWRFcnJvcnMuaGFzKGVycm9yKSkgcmV0dXJuXG4gICAgICByZWNvcmRlZEVycm9ycy5hZGQoZXJyb3IpXG4gICAgfVxuXG4gICAgY29uc3QgbmVhciA9IHRoaXMuX2xhc3RUZXN0Q29udGV4dFxuICAgIGNvbnN0IGF0dHJpYnV0aW9uID0gbmVhciA/IGAsIG5lYXIgdGVzdDogJHtuZWFyLmZ1bGxEZXNjcmlwdGlvbn0gKCR7bmVhci5maWxlUGF0aH06JHtuZWFyLmxpbmV9KWAgOiBcIlwiXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9ICh0aGlzLl9mYWlsZWRUZXN0cyB8fCAwKSArIDFcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogYDwke2NsZWFudXBOYW1lfSBlbWVyZ2VuY3kgY2xlYW51cCBmYWlsdXJlJHthdHRyaWJ1dGlvbn0+YCxcbiAgICAgIGZpbGVQYXRoOiBuZWFyID8gbmVhci5maWxlUGF0aCA6IFwiPHRlc3QgcnVubmVyPlwiLFxuICAgICAgbGluZTogbmVhciA/IG5lYXIubGluZSA6IDAsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5bdGVzdC1ydW5uZXJdICR7Y2xlYW51cE5hbWV9IGNsZWFudXAgZmFpbGVkIGFmdGVyIHRpbWVvdXQgaGFuZGxpbmcgYmVnYW4uJHthdHRyaWJ1dGlvbn1gKSlcbiAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICB9XG5cbiAgYXN5bmMgcnVuKCkge1xuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBwcm9jZXNzLWxldmVsIHVuaGFuZGxlZCByZWplY3Rpb24gZHVyaW5nIHRoZSBydW4uXG4gICAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBSZWplY3Rpb24gcmVhc29uLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIGNvbnN0IG9uVW5oYW5kbGVkUmVqZWN0aW9uID0gKHJlYXNvbikgPT4ge1xuICAgICAgLy8gSWYgYSB0ZXN0IGF0dGFjaGVkIGl0cyBPV04gdW5oYW5kbGVkUmVqZWN0aW9uIGxpc3RlbmVyLCBpdCBpc1xuICAgICAgLy8gaW50ZW50aW9uYWxseSBvYnNlcnZpbmcvdHJpZ2dlcmluZyB0aGUgcmVqZWN0aW9uIChlLmcuIGJlYWNvblxuICAgICAgLy8gZXJyb3ItcmVwb3J0aW5nLXNwZWMuanMpIOKAlCBOb2RlIGRpc3BhdGNoZXMgdG8gRVZFUlkgbGlzdGVuZXIsIHNvIGFsc29cbiAgICAgIC8vIGZhaWxpbmcgdGhlIHN1aXRlIGhlcmUgd291bGQgYnJlYWsgdGhvc2UgdGVzdHMuIERlZmVyIHRvIHRoZSB0ZXN0J3NcbiAgICAgIC8vIGhhbmRsZXI7IG9ubHkgdHJlYXQgYSByZWplY3Rpb24gYXMgYSBzaWxlbnQtZGVhdGggY3Jhc2ggd2hlbiBvdXJzIGlzIHRoZVxuICAgICAgLy8gc29sZSBsaXN0ZW5lciAobm8gcGVyc2lzdGVudCBmcmFtZXdvcmsgbGlzdGVuZXIgZXhpc3RzIHRvIG1hc2sgdGhpcykuXG4gICAgICBpZiAocHJvY2Vzcy5saXN0ZW5lckNvdW50KFwidW5oYW5kbGVkUmVqZWN0aW9uXCIpID4gMSkgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVjb3JkQXN5bmNDcmFzaChcInVuaGFuZGxlZFJlamVjdGlvblwiLCByZWFzb24pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIHByb2Nlc3MtbGV2ZWwgdW5jYXVnaHQgZXhjZXB0aW9uIGR1cmluZyB0aGUgcnVuIOKAlCBhXG4gICAgICogc3luY2hyb25vdXMgdGhyb3cgaW5zaWRlIGEgZGV0YWNoZWQgY2FsbGJhY2sgKGRyaXZlciBzb2NrZXQsIHRpbWVyLFxuICAgICAqIGV2ZW50IGVtaXR0ZXIpIHRoYXQgbm8gdGVzdCBhd2FpdCBvYnNlcnZlcy4gU2FtZSBzaWxlbnQtZGVhdGggbW9kZSBhc1xuICAgICAqIHVuaGFuZGxlZCByZWplY3Rpb25zOiB3aXRob3V0IGEgaGFuZGxlciB0aGUgcHJvY2VzcyBkaWVzIG1pZC1ydW4gYW5kIENJXG4gICAgICogc2VlcyBhIGNyYXNoZWQgc2hhcmQgd2l0aCB6ZXJvIHJlcG9ydGVkIGZhaWx1cmVzLlxuICAgICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBUaHJvd24gZXJyb3IuXG4gICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICovXG4gICAgY29uc3Qgb25VbmNhdWdodEV4Y2VwdGlvbiA9IChlcnJvcikgPT4ge1xuICAgICAgLy8gTWlycm9yIHRoZSB1bmhhbmRsZWRSZWplY3Rpb24gZGVmZXJyYWw6IGEgdGVzdCBvYnNlcnZpbmcvdHJpZ2dlcmluZ1xuICAgICAgLy8gdW5jYXVnaHQgZXhjZXB0aW9ucyB3aXRoIGl0cyBvd24gbGlzdGVuZXIgb3ducyB0aGVtLlxuICAgICAgaWYgKHByb2Nlc3MubGlzdGVuZXJDb3VudChcInVuY2F1Z2h0RXhjZXB0aW9uXCIpID4gMSkgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVjb3JkQXN5bmNDcmFzaChcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIGVycm9yKVxuICAgIH1cblxuICAgIHByb2Nlc3Mub24oXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgb25VbmhhbmRsZWRSZWplY3Rpb24pXG4gICAgcHJvY2Vzcy5vbihcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIG9uVW5jYXVnaHRFeGNlcHRpb24pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5QYWNrYWdlVGVzdHMoKVxuXG4gICAgICAvLyBBIHJlamVjdGlvbiBzY2hlZHVsZWQgYnkgdGhlIGZpbmFsIHRlc3QgKGEgZGV0YWNoZWQgcmVqZWN0ZWQgcHJvbWlzZSxcbiAgICAgIC8vIG9yIGFuIGFmdGVyQ29tbWl0IGNhbGxiYWNrIHJlamVjdGluZyBhcyB0aGUgc3VpdGUgZHJhaW5zKSBpcyByZXBvcnRlZFxuICAgICAgLy8gYnkgTm9kZSBvbiBhIExBVEVSIHR1cm4uIERyYWluIGEgZmV3IHR1cm5zIHdoaWxlIHRoZSBoYW5kbGVyIGlzIHN0aWxsXG4gICAgICAvLyBhdHRhY2hlZCBzbyB0aG9zZSBsYXRlIHJlamVjdGlvbnMgYXJlIHJlY29yZGVkIGluc3RlYWQgb2YgZXNjYXBpbmcgdG9cbiAgICAgIC8vIHRoZSBkZWZhdWx0IGNyYXNoIHBhdGggYWZ0ZXIgY2xlYW51cC5cbiAgICAgIGZvciAobGV0IGRyYWluVHVybiA9IDA7IGRyYWluVHVybiA8IDM7IGRyYWluVHVybisrKSB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRJbW1lZGlhdGUocmVzb2x2ZSkpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHByb2Nlc3Mub2ZmKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIG9uVW5oYW5kbGVkUmVqZWN0aW9uKVxuICAgICAgcHJvY2Vzcy5vZmYoXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBvblVuY2F1Z2h0RXhjZXB0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBhZnRlciBhbGxzIGZvciBhY3RpdmUgc2NvcGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgaG9va3MgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJBbGxzRm9yQWN0aXZlU2NvcGVzKCkge1xuICAgIGNvbnN0IGZhaWx1cmVTdGFydCA9IHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLmxlbmd0aFxuXG4gICAgYXdhaXQgdGhpcy5fcGFja2FnZVJ1bm5lcj8uY2xlYW51cEFjdGl2ZVN1aXRlcygpXG4gICAgdGhpcy50aHJvd0FmdGVyQWxsRmFpbHVyZXModGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuc2xpY2UoZmFpbHVyZVN0YXJ0KSlcbiAgfVxuXG4gIC8qKiBCdWlsZHMgZGVjbGFyYXRpb24gbWV0YWRhdGEgdXNlZCBvbmx5IGJ5IGZyYW1ld29yayBhZGFwdGVycyBhbmQgcHJvamVjdGlvbnMuICovXG4gIGFuYWx5emVEZWNsYXJhdGlvbnMoKSB7XG4gICAgY29uc3QgdmlzaXQgPSAoLyoqIEB0eXBlIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gKi8gc3VpdGUsIC8qKiBAdHlwZSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXX0gKi8gYW5jZXN0b3JzLCAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi8gcGFyZW50UHJvZmlsZVNjb3BlSWQpID0+IHtcbiAgICAgIGNvbnN0IHN1aXRlcyA9IFsuLi5hbmNlc3RvcnMsIHN1aXRlXVxuICAgICAgY29uc3QgZGVzY3JpcHRpb25zID0gc3VpdGVzLm1hcCgoZW50cnkpID0+IGVudHJ5Lm5hbWUpLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJcIilcbiAgICAgIGNvbnN0IG93bmVyRmlsZVBhdGggPSB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5nZXQoc3VpdGUpID8/IHN1aXRlLmxvY2F0aW9uLmZpbGVQYXRoXG4gICAgICBjb25zdCBwcm9maWxlU2NvcGVJZCA9IHRoaXMuX3Byb2ZpbGVyPy5zY29wZUlkKHN1aXRlLCB7XG4gICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgZmlsZVBhdGg6IG93bmVyRmlsZVBhdGgsXG4gICAgICAgIGxpbmU6IHN1aXRlLmxvY2F0aW9uLmxpbmUsXG4gICAgICAgIHBhcmVudElkOiBwYXJlbnRQcm9maWxlU2NvcGVJZFxuICAgICAgfSlcblxuICAgICAgZm9yIChjb25zdCBob29rcyBvZiBPYmplY3QudmFsdWVzKHN1aXRlLmhvb2tzKSkge1xuICAgICAgICBob29rcy5mb3JFYWNoKChob29rLCBkZWNsYXJhdGlvbkluZGV4KSA9PiB7XG4gICAgICAgICAgdGhpcy5faG9va01ldGFkYXRhLnNldChob29rLCB7XG4gICAgICAgICAgICBkZWNsYXJhdGlvbkluZGV4LFxuICAgICAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBwcm9maWxlU2NvcGVJZCxcbiAgICAgICAgICAgIG93bmVyRmlsZVBhdGg6IHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLmdldChob29rKSA/PyBob29rLmxvY2F0aW9uLmZpbGVQYXRoID8/IG93bmVyRmlsZVBhdGhcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHRlc3REZWNsYXJhdGlvbiBvZiBzdWl0ZS50ZXN0cykge1xuICAgICAgICBjb25zdCBmdWxsRGVzY3JpcHRpb24gPSB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlY2xhcmF0aW9uLm5hbWUpXG4gICAgICAgIGNvbnN0IGRlY2xhcmF0aW9ucyA9IHRoaXMuX3Rlc3RzQnlGdWxsTmFtZS5nZXQoZnVsbERlc2NyaXB0aW9uKSB8fCBbXVxuXG4gICAgICAgIGRlY2xhcmF0aW9ucy5wdXNoKHRlc3REZWNsYXJhdGlvbilcbiAgICAgICAgdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLnNldChmdWxsRGVzY3JpcHRpb24sIGRlY2xhcmF0aW9ucylcbiAgICAgICAgdGhpcy5fdGVzdE1ldGFkYXRhLnNldCh0ZXN0RGVjbGFyYXRpb24sIHtcbiAgICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgICAgdGVzdERlc2NyaXB0aW9uOiB0ZXN0RGVjbGFyYXRpb24ubmFtZSxcbiAgICAgICAgICBmdWxsRGVzY3JpcHRpb24sXG4gICAgICAgICAgb3duZXJGaWxlUGF0aDogdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuZ2V0KHRlc3REZWNsYXJhdGlvbikgPz8gdGVzdERlY2xhcmF0aW9uLmxvY2F0aW9uLmZpbGVQYXRoID8/IG93bmVyRmlsZVBhdGgsXG4gICAgICAgICAgc3VpdGVzXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IGxlZ2FjeVRlc3REYXRhID0gdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lPy5nZXQoZnVsbERlc2NyaXB0aW9uKVxuICAgICAgICBpZiAobGVnYWN5VGVzdERhdGEpIHtcbiAgICAgICAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eS5zZXQodGVzdERlY2xhcmF0aW9uLCB7XG4gICAgICAgICAgICB0ZXN0QXJnczogdGhpcy5fdGVzdEFyZ3VtZW50cy5jb3B5KHRlc3REZWNsYXJhdGlvbiksXG4gICAgICAgICAgICB0ZXN0RGF0YTogbGVnYWN5VGVzdERhdGFcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3Rlc3RzQ291bnQrK1xuICAgICAgICBpZiAodGVzdERlY2xhcmF0aW9uLnN0YXRlID09PSBcInJ1blwiICYmICh0ZXN0RGVjbGFyYXRpb24uZm9jdXMgfHwgc3VpdGVzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5mb2N1cykpKSB7XG4gICAgICAgICAgdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgY2hpbGRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIHZpc2l0KGNoaWxkU3VpdGUsIHN1aXRlcywgcHJvZmlsZVNjb3BlSWQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWl0ZSBvZiB0aGlzLmdldFRlc3RDb250ZXh0KCkucmVnaXN0cnkuc3VpdGVzKSB2aXNpdChzdWl0ZSwgW10sIHVuZGVmaW5lZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBhY2thZ2UgaG9vayBjb21wYXRpYmlsaXR5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VIb29rRGVjbGFyYXRpb259IGhvb2sgLSBQYWNrYWdlIGhvb2sgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZGVjbGFyYXRpb25JbmRleDogbnVtYmVyLCBkZWNsYXJhdGlvblNjb3BlSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCwgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBIb29rIG1ldGFkYXRhLlxuICAgKi9cbiAgaG9va01ldGFkYXRhKGhvb2spIHtcbiAgICByZXR1cm4gdGhpcy5faG9va01ldGFkYXRhLmdldChob29rKSB8fCB7ZGVjbGFyYXRpb25JbmRleDogMCwgZGVjbGFyYXRpb25TY29wZUlkOiB1bmRlZmluZWQsIG93bmVyRmlsZVBhdGg6IGhvb2subG9jYXRpb24uZmlsZVBhdGh9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBwYWNrYWdlIHRlc3QgY29tcGF0aWJpbGl0eSBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2Rlc2NyaXB0aW9uczogc3RyaW5nW10sIHRlc3REZXNjcmlwdGlvbjogc3RyaW5nLCBmdWxsRGVzY3JpcHRpb246IHN0cmluZywgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkLCBzdWl0ZXM6IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW119fSAtIERlY2xhcmF0aW9uIG1ldGFkYXRhLlxuICAgKi9cbiAgdGVzdE1ldGFkYXRhKHRlc3QpIHtcbiAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMuX3Rlc3RNZXRhZGF0YS5nZXQodGVzdClcbiAgICBpZiAoIW1ldGFkYXRhKSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcGFja2FnZSB0ZXN0IG1ldGFkYXRhOiAke3Rlc3QubmFtZX1gKVxuICAgIHJldHVybiBtZXRhZGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgc3RhYmxlIGNvbXBhdGliaWxpdHkgZGF0YSBmb3IgYSBwYWNrYWdlIGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7dGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9fSAtIFN0YWJsZSBjb21wYXRpYmlsaXR5IGRhdGEuXG4gICAqL1xuICB0ZXN0RGF0YSh0ZXN0KSB7XG4gICAgbGV0IGNvbXBhdGliaWxpdHkgPSB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eS5nZXQodGVzdClcblxuICAgIGlmICghY29tcGF0aWJpbGl0eSkge1xuICAgICAgY29uc3QgdGVzdEFyZ3MgPSB0aGlzLl90ZXN0QXJndW1lbnRzLmNvcHkodGVzdClcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy50ZXN0TWV0YWRhdGEodGVzdClcbiAgICAgIGNvbnN0IHRlc3REYXRhID0ge1xuICAgICAgICBhcmdzOiB0ZXN0QXJncyxcbiAgICAgICAgZGVjbGFyYXRpb246IHRlc3QsXG4gICAgICAgIGZpbGVQYXRoOiB0ZXN0LmxvY2F0aW9uLmZpbGVQYXRoLFxuICAgICAgICBmdW5jdGlvbjogdGVzdC5jYWxsYmFjayxcbiAgICAgICAgbGluZTogdGVzdC5sb2NhdGlvbi5saW5lLFxuICAgICAgICBvd25lckZpbGVQYXRoOiBtZXRhZGF0YS5vd25lckZpbGVQYXRoXG4gICAgICB9XG4gICAgICBjb21wYXRpYmlsaXR5ID0ge3Rlc3RBcmdzLCB0ZXN0RGF0YX1cbiAgICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5LnNldCh0ZXN0LCBjb21wYXRpYmlsaXR5KVxuICAgIH1cblxuICAgIHJldHVybiBjb21wYXRpYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogSW5qZWN0cyBmcmFtZXdvcmsgY29sbGFib3JhdG9ycyBpbnRvIHN0YWJsZSBjb21wYXRpYmlsaXR5IGRhdGEgb25jZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7dGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9Pn0gLSBJbmplY3RlZCBjb21wYXRpYmlsaXR5IGRhdGEuXG4gICAqL1xuICBhc3luYyB0ZXN0Q29tcGF0aWJpbGl0eSh0ZXN0KSB7XG4gICAgY29uc3QgY29tcGF0aWJpbGl0eSA9IHRoaXMudGVzdERhdGEodGVzdClcblxuICAgIGlmICghdGhpcy5faW5qZWN0ZWRUZXN0cy5oYXModGVzdCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3Rlc3RBcmd1bWVudHMuaW5qZWN0KGNvbXBhdGliaWxpdHkudGVzdEFyZ3MpXG4gICAgICB0aGlzLl9pbmplY3RlZFRlc3RzLmFkZCh0ZXN0KVxuICAgIH1cblxuICAgIHJldHVybiBjb21wYXRpYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHJhdyBmcmFtZXdvcmsgYXR0ZW1wdCBvdXRjb21lLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgKiBAcGFyYW0ge3thYm9ydFJlbWFpbmluZ1Rlc3RzOiBib29sZWFuLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGZhaWxlZDogYm9vbGVhbn19IG91dGNvbWUgLSBSYXcgYXR0ZW1wdCBvdXRjb21lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEF0dGVtcHRPdXRjb21lKHRlc3QsIGF0dGVtcHROdW1iZXIsIG91dGNvbWUpIHtcbiAgICBjb25zdCBvdXRjb21lcyA9IHRoaXMuX2F0dGVtcHRPdXRjb21lcy5nZXQodGVzdCkgfHwgbmV3IE1hcCgpXG4gICAgb3V0Y29tZXMuc2V0KGF0dGVtcHROdW1iZXIsIG91dGNvbWUpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzLnNldCh0ZXN0LCBvdXRjb21lcylcbiAgICBpZiAob3V0Y29tZS5hYm9ydFJlbWFpbmluZ1Rlc3RzKSB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgYSByYXcgZnJhbWV3b3JrIGF0dGVtcHQgb3V0Y29tZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXR0ZW1wdE51bWJlciAtIE9uZS1iYXNlZCBhdHRlbXB0IG51bWJlci5cbiAgICogQHJldHVybnMge3thYm9ydFJlbWFpbmluZ1Rlc3RzOiBib29sZWFuLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGZhaWxlZDogYm9vbGVhbn0gfCB1bmRlZmluZWR9IC0gUmF3IGF0dGVtcHQgb3V0Y29tZS5cbiAgICovXG4gIGF0dGVtcHRPdXRjb21lKHRlc3QsIGF0dGVtcHROdW1iZXIpIHsgcmV0dXJuIHRoaXMuX2F0dGVtcHRPdXRjb21lcy5nZXQodGVzdCk/LmdldChhdHRlbXB0TnVtYmVyKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSByYXcgc3VpdGUtaG9vayBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gZmFpbHVyZSAtIFN1aXRlLWhvb2sgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gZmFpbHVyZS5zdWl0ZSAtIE93bmluZyBwYWNrYWdlIHN1aXRlLlxuICAgKiBAcGFyYW0ge1wiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCJ9IGZhaWx1cmUucGhhc2UgLSBIb29rIHBoYXNlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBmYWlsdXJlLmVycm9yIC0gUmF3IGhvb2sgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRTdWl0ZUhvb2tGYWlsdXJlKGZhaWx1cmUpIHsgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMucHVzaChmYWlsdXJlKSB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHJhdyBhbmNlc3RvciBzZXR1cCBmYWlsdXJlIG91dGNvbWUgZm9yIGEgcGFja2FnZSB0ZXN0LlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZmFpbGVkOiBmYWxzZX0gfCB7ZmFpbGVkOiB0cnVlLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAtIFJhdyBzZXR1cCBmYWlsdXJlIG91dGNvbWUuXG4gICAqL1xuICBzZXR1cEZhaWx1cmVPdXRjb21lRm9yKHRlc3QpIHtcbiAgICBjb25zdCBzdWl0ZXMgPSB0aGlzLnRlc3RNZXRhZGF0YSh0ZXN0KS5zdWl0ZXNcbiAgICBjb25zdCBmYWlsdXJlID0gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuZmluZCgoZW50cnkpID0+IGVudHJ5LnBoYXNlID09PSBcImJlZm9yZUFsbFwiICYmIHN1aXRlcy5pbmNsdWRlcyhlbnRyeS5zdWl0ZSkpXG5cbiAgICByZXR1cm4gZmFpbHVyZSA/IHtmYWlsZWQ6IHRydWUsIGVycm9yOiBmYWlsdXJlLmVycm9yfSA6IHtmYWlsZWQ6IGZhbHNlfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGluY29tcGxldGUgZGVjbGFyYXRpb24gd2l0aCBhIHBhY2thZ2UgZnVsbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZnVsbE5hbWUgLSBQYWNrYWdlIGZ1bGwgbmFtZS5cbiAgICogQHJldHVybnMge1BhY2thZ2VUZXN0RGVjbGFyYXRpb24gfCB1bmRlZmluZWR9IC0gTmV4dCBtYXRjaGluZyBkZWNsYXJhdGlvbi5cbiAgICovXG4gIGZpbmRUZXN0RGVjbGFyYXRpb24oZnVsbE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLmdldChmdWxsTmFtZSk/LmZpbmQoKHRlc3QpID0+ICF0aGlzLl9jb21wbGV0ZWRUZXN0cy5oYXModGVzdCkpXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwYWNrYWdlIGRlY2xhcmF0aW9uIGNvbXBsZXRlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBDb21wbGV0ZWQgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29tcGxldGVUZXN0RGVjbGFyYXRpb24odGVzdCkgeyB0aGlzLl9jb21wbGV0ZWRUZXN0cy5hZGQodGVzdCkgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBlZmZlY3RpdmUgcGFja2FnZSByZXRyeSBjb3VudC5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEVmZmVjdGl2ZSByZXRyeSBjb3VudC5cbiAgICovXG4gIHJldHJ5Q291bnQodGVzdCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGVzdC5vcHRpb25zLnJldHJpZXMgPz8gdGVzdC5vcHRpb25zLnJldHJ5ID8/IHRoaXMuX3JldHJpZXMgPz8gdGhpcy5nZXRUZXN0Q29udGV4dCgpLmNvbmZpZy5yZXRyaWVzXG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpID8gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcih2YWx1ZSkpIDogMFxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgcmV0cnkgaW5wdXRzIGZvciB0aGUgcGFja2FnZSBleGVjdXRpb24gYm91bmRhcnkgd2hpbGUgcmV0YWluaW5nXG4gICAqIHRoZSBkZWNsYXJhdGlvbnMnIG9yaWdpbmFsIHB1YmxpYyBvcHRpb25zIGFmdGVyIHRoZSBydW4uXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIFJlc3RvcmVzIG9yaWdpbmFsIGRlY2xhcmF0aW9uIG9wdGlvbnMuXG4gICAqL1xuICBub3JtYWxpemVQYWNrYWdlUmV0cmllc0ZvckV4ZWN1dGlvbigpIHtcbiAgICAvKiogQHR5cGUge1BhY2thZ2VSZXRyeU9wdGlvblJlc3RvcmF0aW9uW119ICovXG4gICAgY29uc3QgcmVzdG9yYXRpb25zID0gW11cbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemVzIGRlY2xhcmF0aW9ucyBpbiBvbmUgc3VpdGUuXG4gICAgICogQHBhcmFtIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gc3VpdGUgLSBTdWl0ZSB3aG9zZSB0ZXN0cyBhcmUgbm9ybWFsaXplZC5cbiAgICAgKi9cbiAgICBjb25zdCB2aXNpdCA9IChzdWl0ZSkgPT4ge1xuICAgICAgZm9yIChjb25zdCB0ZXN0IG9mIHN1aXRlLnRlc3RzKSB7XG4gICAgICAgIC8vIENhcHR1cmUgY29tcGF0aWJpbGl0eSBhcmd1bWVudHMgYmVmb3JlIHRlbXBvcmFyaWx5IGFkYXB0aW5nIHBhY2thZ2VcbiAgICAgICAgLy8gZXhlY3V0aW9uIG9wdGlvbnMgc28gY2FsbGJhY2tzIHJldGFpbiB0aGVpciBkZWNsYXJlZCB2YWx1ZXMvaWRlbnRpdHkuXG4gICAgICAgIHRoaXMudGVzdERhdGEodGVzdClcbiAgICAgICAgcmVzdG9yYXRpb25zLnB1c2goe1xuICAgICAgICAgIGhhZFJldHJpZXM6IE9iamVjdC5oYXNPd24odGVzdC5vcHRpb25zLCBcInJldHJpZXNcIiksXG4gICAgICAgICAgb3B0aW9uczogdGVzdC5vcHRpb25zLFxuICAgICAgICAgIHJldHJpZXM6IHRlc3Qub3B0aW9ucy5yZXRyaWVzXG4gICAgICAgIH0pXG4gICAgICAgIHRlc3Qub3B0aW9ucy5yZXRyaWVzID0gdGhpcy5yZXRyeUNvdW50KHRlc3QpXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgY2hpbGRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIHZpc2l0KGNoaWxkU3VpdGUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWl0ZSBvZiB0aGlzLmdldFRlc3RDb250ZXh0KCkucmVnaXN0cnkuc3VpdGVzKSB2aXNpdChzdWl0ZSlcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IHJlc3RvcmF0aW9uIG9mIHJlc3RvcmF0aW9ucykge1xuICAgICAgICBpZiAocmVzdG9yYXRpb24uaGFkUmV0cmllcykgcmVzdG9yYXRpb24ub3B0aW9ucy5yZXRyaWVzID0gcmVzdG9yYXRpb24ucmV0cmllc1xuICAgICAgICBlbHNlIGRlbGV0ZSByZXN0b3JhdGlvbi5vcHRpb25zLnJldHJpZXNcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgY29tcGxldGVkIHRlc3QgZHVyYXRpb24uXG4gICAqIEBwYXJhbSB7e2R1cmF0aW9uTXM6IG51bWJlciwgZmlsZVBhdGg6IHN0cmluZywgZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGxpbmU6IG51bWJlcn19IGR1cmF0aW9uIC0gQ29tcGxldGVkIHRlc3QgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkVGVzdER1cmF0aW9uKGR1cmF0aW9uKSB7IHRoaXMuX3Rlc3REdXJhdGlvbnMucHVzaChkdXJhdGlvbikgfVxuXG4gIC8qKiBSZWNvcmRzIG9uZSBzdWNjZXNzZnVsIHBhY2thZ2UgcmVzdWx0LiAqL1xuICByZWNvcmRTdWNjZXNzZnVsVGVzdCgpIHsgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzKysgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBmYWlsZWQgcGFja2FnZSB0ZXN0IGluIHRoZSBsZWdhY3kgcmVzdWx0IHByb2plY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbGVkIHRlc3QgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gUGFyZW50IGRlc2NyaXB0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJhdyBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb25zb2xlT3V0cHV0IC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBDb21wYXRpYmlsaXR5IHRlc3QgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRGYWlsZWRUZXN0KHtkZXNjcmlwdGlvbnMsIGVycm9yLCBjb25zb2xlT3V0cHV0LCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9ufSkge1xuICAgIHRoaXMuX2ZhaWxlZFRlc3RzKytcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiksXG4gICAgICBmaWxlUGF0aDogdGVzdERhdGEuZmlsZVBhdGgsXG4gICAgICBsaW5lOiB0ZXN0RGF0YS5saW5lLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiBjb25zb2xlT3V0cHV0IHx8IHVuZGVmaW5lZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3RvcmVzIHRoZSBjb21wbGV0ZWQgcGFja2FnZSByZXN1bHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0UnVuUmVzdWx0fSByZXN1bHQgLSBQYWNrYWdlIHJlc3VsdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRQYWNrYWdlUmVzdWx0KHJlc3VsdCkgeyB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gcmVzdWx0IH1cblxuICAvKipcbiAgICogUnVucyB0aGUgcGFja2FnZSBrZXJuZWwgd2l0aCBWZWxvY2lvdXMgZnJhbWV3b3JrIGFkYXB0ZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBleGVjdXRpb24gYW5kIHRlYXJkb3duLlxuICAgKi9cbiAgYXN5bmMgcnVuUGFja2FnZVRlc3RzKCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG4gICAgZW52aXJvbm1lbnRIYW5kbGVyLmluc3RhbGxTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlKHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UpXG4gICAgZW52aXJvbm1lbnRIYW5kbGVyLmluc3RhbGxUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UodGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKVxuICAgIHRoaXMuX3BhY2thZ2VSdW5uZXIgPSBuZXcgUGFja2FnZVRlc3RSdW5uZXIoe1xuICAgICAgY29udGV4dDogdGhpcy5nZXRUZXN0Q29udGV4dCgpLFxuICAgICAgaW5jbHVkZVRhZ3M6IHRoaXMuX2luY2x1ZGVUYWdzLFxuICAgICAgZXhjbHVkZVRhZ3M6IFsuLi50aGlzLmdldEV4Y2x1ZGVUYWdTZXQoKSwgLi4uKHRoaXMuaXNCcm93c2VyVGVzdE1vZGUoKSA/IFtdIDogW1wiYnJvd3Nlci1vbmx5XCJdKV0sXG4gICAgICBleGFtcGxlczogdGhpcy5nZXRFeGFtcGxlUGF0dGVybnMoKSxcbiAgICAgIGxpbmVGaWx0ZXJzOiB0aGlzLmdldExpbmVGaWx0ZXJzKCksXG4gICAgICBpbmNsdWRlVGFnTW9kZTogXCJhbnlcIixcbiAgICAgIGZvY3VzZWRUZXN0c0J5cGFzc0luY2x1ZGVUYWdzOiB0cnVlLFxuICAgICAgb21pdEVtcHR5U3VpdGVOYW1lczogdHJ1ZSxcbiAgICAgIGF0dGVtcHRFeGVjdXRvck93bnNUaW1lb3V0OiB0cnVlLFxuICAgICAgYXR0ZW1wdEV4ZWN1dG9yOiAoaW5wdXQpID0+IHRoaXMuX2F0dGVtcHRFeGVjdXRvci5leGVjdXRlKGlucHV0KSxcbiAgICAgIHRlc3RBcmd1bWVudFJlc29sdmVyOiAoaW5wdXQpID0+IHRoaXMuX3Rlc3RBcmd1bWVudHMucmVzb2x2ZShpbnB1dCksXG4gICAgICBzdWl0ZUhvb2tFeGVjdXRvcjogKGlucHV0KSA9PiB0aGlzLl9zdWl0ZUhvb2tFeGVjdXRvci5leGVjdXRlKGlucHV0KSxcbiAgICAgIHJlcG9ydGVyOiB0aGlzLl9ydW5uZXJSZXBvcnRlcixcbiAgICAgIHJldHJpZXM6IHRoaXMuX3JldHJpZXMsXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX3RpbWVvdXRNc1xuICAgIH0pXG4gICAgY29uc3QgZmFpbHVyZVN0YXJ0ID0gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMubGVuZ3RoXG4gICAgY29uc3QgcmVzdG9yZVJldHJ5T3B0aW9ucyA9IHRoaXMubm9ybWFsaXplUGFja2FnZVJldHJpZXNGb3JFeGVjdXRpb24oKVxuICAgIGxldCByZXN1bHRcblxuICAgIHRyeSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLl9wYWNrYWdlUnVubmVyLnJ1bigpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEFib3J0UmVtYWluaW5nVGVzdHNFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgICAgY29uc3QgYWZ0ZXJBbGwgPSB0aGlzLmFmdGVyQWxsT3V0Y29tZSh0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5zbGljZShmYWlsdXJlU3RhcnQpKVxuICAgICAgICBpZiAoYWZ0ZXJBbGwuZmFpbGVkKSB0aGlzLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShhZnRlckFsbC5lcnJvciwgXCJhZnRlckFsbFwiKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5yZWNvcmRQYWNrYWdlUmVzdWx0KHJlc3VsdClcbiAgICAgIHRoaXMudGhyb3dBZnRlckFsbEZhaWx1cmVzKHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnNsaWNlKGZhaWx1cmVTdGFydCkpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlc3RvcmVSZXRyeU9wdGlvbnMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZ2dyZWdhdGVzIHJhdyBhZnRlci1hbGwgZmFpbHVyZXMgd2l0aG91dCB1c2luZyBlcnJvciB0cnV0aGluZXNzLlxuICAgKiBAcGFyYW0ge0FycmF5PHtwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59IGZhaWx1cmVzIC0gSG9vayBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge3tmYWlsZWQ6IGZhbHNlfSB8IHtmYWlsZWQ6IHRydWUsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IC0gRXhwbGljaXQgYWZ0ZXJBbGwgb3V0Y29tZS5cbiAgICovXG4gIGFmdGVyQWxsT3V0Y29tZShmYWlsdXJlcykge1xuICAgIGNvbnN0IGFmdGVyQWxsRXJyb3JzID0gZmFpbHVyZXMuZmlsdGVyKChmYWlsdXJlKSA9PiBmYWlsdXJlLnBoYXNlID09PSBcImFmdGVyQWxsXCIpLm1hcCgoZmFpbHVyZSkgPT4gZmFpbHVyZS5lcnJvcilcblxuICAgIGlmIChhZnRlckFsbEVycm9ycy5sZW5ndGggPT09IDApIHJldHVybiB7ZmFpbGVkOiBmYWxzZX1cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID09PSAxKSByZXR1cm4ge2ZhaWxlZDogdHJ1ZSwgZXJyb3I6IGFmdGVyQWxsRXJyb3JzWzBdfVxuICAgIHJldHVybiB7XG4gICAgICBmYWlsZWQ6IHRydWUsXG4gICAgICBlcnJvcjogbmV3IEFnZ3JlZ2F0ZUVycm9yKGFmdGVyQWxsRXJyb3JzLCBcIk11bHRpcGxlIGFjdGl2ZSBhZnRlckFsbCBzY29wZXMgZmFpbGVkXCIsIHtjYXVzZTogYWZ0ZXJBbGxFcnJvcnNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaHJvd3Mgb25lIHJhdyBvciBhZ2dyZWdhdGVkIGFmdGVyLWFsbCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge0FycmF5PHtwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59IGZhaWx1cmVzIC0gSG9vayBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB0aHJvd0FmdGVyQWxsRmFpbHVyZXMoZmFpbHVyZXMpIHtcbiAgICBjb25zdCBhZnRlckFsbCA9IHRoaXMuYWZ0ZXJBbGxPdXRjb21lKGZhaWx1cmVzKVxuXG4gICAgaWYgKGFmdGVyQWxsLmZhaWxlZCkgdGhyb3cgYWZ0ZXJBbGwuZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXRpYmlsaXR5IGhlbHBlciBmb3IgZm9jdXNlZCBmcmFtZXdvcmsgbGlmZWN5Y2xlIHNwZWNzLiBJdCBjb252ZXJ0cyBhblxuICAgKiBleHBsaWNpdCBsZWdhY3kgZml4dHVyZSBpbnRvIGlzb2xhdGVkIHBhY2thZ2UgZGVjbGFyYXRpb25zOyB0aGUgcGFja2FnZVxuICAgKiBydW5uZXIgcmVtYWlucyB0aGUgc29sZSBleGVjdXRpb24gZW5naW5lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExlZ2FjeSBmaXh0dXJlIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBhcmdzLnRlc3RzIC0gRml4dHVyZSB0cmVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwYWNrYWdlIGV4ZWN1dGlvbi5cbiAgICovXG4gIGFzeW5jIHJ1blRlc3RzKHt0ZXN0c30pIHtcbiAgICBjb25zdCBjb250ZXh0ID0gY3JlYXRlVGVzdENvbnRleHQoKVxuICAgIGNvbnN0IG9yaWdpbmFsQ29udGV4dCA9IHRoaXMuX2NvbnRleHRcbiAgICBjb250ZXh0LmNvbmZpZ3VyZVRlc3RzKHtcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IG9yaWdpbmFsQ29udGV4dC5jb25maWcuY29uc29sZU91dHB1dCxcbiAgICAgIGRlZmF1bHRUaW1lb3V0TXM6IG9yaWdpbmFsQ29udGV4dC5jb25maWcuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICAgIGV4Y2x1ZGVUYWdzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmV4Y2x1ZGVUYWdzLFxuICAgICAgZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcyxcbiAgICAgIHJldHJpZXM6IG9yaWdpbmFsQ29udGV4dC5jb25maWcucmV0cmllc1xuICAgIH0pXG4gICAgdGhpcy5fY29udGV4dCA9IGNvbnRleHRcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5ID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2luamVjdGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fY29tcGxldGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fdGVzdE1ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2hvb2tNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMgPSBbXVxuICAgIHRoaXMuX3Rlc3RzQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIGNvbnRleHQuc2V0RGVjbGFyYXRpb25Mb2NhdG9yKCgpID0+IHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbilcbiAgICB0aGlzLmRlY2xhcmVMZWdhY3lGaXh0dXJlKGNvbnRleHQsIFwiXCIsIHRlc3RzLCBbXSlcbiAgICB0aGlzLmFuYWx5emVEZWNsYXJhdGlvbnMoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuUGFja2FnZVRlc3RzKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fY29udGV4dCA9IG9yaWdpbmFsQ29udGV4dFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhbiBpc29sYXRlZCBsZWdhY3ktc2hhcGVkIHRlc3QgZml4dHVyZSBpbnRvIGEgcGFja2FnZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0Q29udGV4dH0gY29udGV4dCAtIElzb2xhdGVkIHBhY2thZ2UgY29udGV4dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBTdWl0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1Rlc3RzQXJndW1lbnR9IHNjb3BlIC0gTGVnYWN5IGZpeHR1cmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRlc2NyaXB0aW9ucyAtIEFuY2VzdG9yIGRlc2NyaXB0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBkZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBuYW1lLCBzY29wZSwgZGVzY3JpcHRpb25zKSB7XG4gICAgdGhpcy5fbGVnYWN5Rml4dHVyZUxvY2F0aW9uID0ge2ZpbGVQYXRoOiBzY29wZS5maWxlUGF0aCwgbGluZTogc2NvcGUubGluZX1cbiAgICBjb250ZXh0LmRlc2NyaWJlKG5hbWUsIHNjb3BlLmFyZ3MgfHwge30sICgpID0+IHtcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBzY29wZS5iZWZvcmVBbGxzIHx8IFtdKSBjb250ZXh0LmJlZm9yZUFsbChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmJlZm9yZUVhY2hlcyB8fCBbXSkgY29udGV4dC5iZWZvcmVFYWNoKGhvb2suY2FsbGJhY2spXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYWZ0ZXJFYWNoZXMgfHwgW10pIGNvbnRleHQuYWZ0ZXJFYWNoKGhvb2suY2FsbGJhY2spXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYWZ0ZXJBbGxzIHx8IFtdKSBjb250ZXh0LmFmdGVyQWxsKGhvb2suY2FsbGJhY2spXG4gICAgICBjb25zdCBuZXh0RGVzY3JpcHRpb25zID0gbmFtZSA9PT0gXCJcIiA/IGRlc2NyaXB0aW9ucyA6IFsuLi5kZXNjcmlwdGlvbnMsIG5hbWVdXG4gICAgICBmb3IgKGNvbnN0IFt0ZXN0TmFtZSwgdGVzdERhdGFdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlLnRlc3RzIHx8IHt9KSkge1xuICAgICAgICB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24gPSB7ZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoLCBsaW5lOiB0ZXN0RGF0YS5saW5lfVxuICAgICAgICB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWU/LnNldCh0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKG5leHREZXNjcmlwdGlvbnMsIHRlc3ROYW1lKSwgdGVzdERhdGEpXG4gICAgICAgIGNvbnRleHQuaXQodGVzdE5hbWUsIHRlc3REYXRhLmFyZ3MsIHRlc3REYXRhLmZ1bmN0aW9uKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBbc3VpdGVOYW1lLCBjaGlsZFNjb3BlXSBvZiBPYmplY3QuZW50cmllcyhzY29wZS5zdWJzIHx8IHt9KSkge1xuICAgICAgICB0aGlzLmRlY2xhcmVMZWdhY3lGaXh0dXJlKGNvbnRleHQsIHN1aXRlTmFtZSwgY2hpbGRTY29wZSwgbmV4dERlc2NyaXB0aW9ucylcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW1pdCBldmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgbGlzdGVuZXJzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGF5bG9hZCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bm5lclJlcG9ydGVyLmVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCByZXJ1biBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIExlZnQgcGFkZGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHJpbnRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YSwgbGVmdFBhZGRpbmd9KSB7XG4gICAgY29uc3QgcmVydW4gPSB0aGlzLmJ1aWxkUmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGF9KVxuXG4gICAgaWYgKHJlcnVuKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGAke2xlZnRQYWRkaW5nfSAgUmUtcnVuOiAke3JlcnVufWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgcmVydW4gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXJ1biBjb21tYW5kLlxuICAgKi9cbiAgYnVpbGRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YX0pIHtcbiAgICBjb25zdCBiYXNlQ29tbWFuZCA9IFwibnB4IHZlbG9jaW91cyB0ZXN0XCJcbiAgICBjb25zdCBmaWxlUGF0aCA9IHRlc3REYXRhLmZpbGVQYXRoXG4gICAgY29uc3QgbGluZSA9IHRlc3REYXRhLmxpbmVcblxuICAgIGlmIChmaWxlUGF0aCAmJiBsaW5lKSB7XG4gICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHByb2Nlc3MuY3dkKCksIGZpbGVQYXRoKVxuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAke3JlbGF0aXZlUGF0aH06JHtsaW5lfWBcbiAgICB9XG5cbiAgICBjb25zdCBmdWxsRGVzY3JpcHRpb24gPSB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKVxuXG4gICAgaWYgKGZ1bGxEZXNjcmlwdGlvbikge1xuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAtLWV4YW1wbGUgJHtKU09OLnN0cmluZ2lmeShmdWxsRGVzY3JpcHRpb24pfWBcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtBdHRlbXB0Q29uc29sZU91dHB1dFtdfSBhdHRlbXB0Q29uc29sZU91dHB1dHMgLSBBdHRlbXB0IG91dHB1dCBlbnRyaWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbWJpbmVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKi9cbiAgYnVpbGRDb25zb2xlT3V0cHV0KGF0dGVtcHRDb25zb2xlT3V0cHV0cykge1xuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIlxuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAxKSByZXR1cm4gYXR0ZW1wdENvbnNvbGVPdXRwdXRzWzBdLm91dHB1dFxuXG4gICAgcmV0dXJuIGF0dGVtcHRDb25zb2xlT3V0cHV0cy5tYXAoKGF0dGVtcHRDb25zb2xlT3V0cHV0KSA9PiB7XG4gICAgICByZXR1cm4gYC0tLSBBdHRlbXB0ICR7YXR0ZW1wdENvbnNvbGVPdXRwdXQuYXR0ZW1wdE51bWJlcn0gLS0tXFxuJHthdHRlbXB0Q29uc29sZU91dHB1dC5vdXRwdXR9YFxuICAgIH0pLmpvaW4oXCJcXG5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgY29uc29sZSBvdXRwdXQgbWF4IGxpbmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gZmFpbGVkIGNvbnNvbGUgbGluZXMuXG4gICAqL1xuICBnZXRGYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMoKSB7XG4gICAgY29uc3QgbWF4TGluZXMgPSB0ZXN0Q29uZmlnLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lc1xuXG4gICAgaWYgKHR5cGVvZiBtYXhMaW5lcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKG1heExpbmVzKSkgcmV0dXJuIDIwMFxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGguZmxvb3IobWF4TGluZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZmFpbGVkIGNvbnNvbGUgb3V0cHV0IGxpbmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uc29sZU91dHB1dCAtIENvbnNvbGUgb3V0cHV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTGluZXMgZm9yIGlubGluZSBvdXRwdXQuXG4gICAqL1xuICB0cnVuY2F0ZUZhaWxlZENvbnNvbGVPdXRwdXRMaW5lcyhjb25zb2xlT3V0cHV0KSB7XG4gICAgY29uc3QgbGluZXMgPSBjb25zb2xlT3V0cHV0LnNwbGl0KFwiXFxuXCIpXG4gICAgY29uc3QgbWF4TGluZXMgPSB0aGlzLmdldEZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcygpXG5cbiAgICBpZiAobWF4TGluZXMgPT09IDApIHJldHVybiBbXVxuICAgIGlmIChsaW5lcy5sZW5ndGggPD0gbWF4TGluZXMpIHJldHVybiBsaW5lc1xuXG4gICAgY29uc3Qgb21pdHRlZExpbmVzID0gbGluZXMubGVuZ3RoIC0gbWF4TGluZXNcbiAgICBjb25zdCBwbHVyYWwgPSBvbWl0dGVkTGluZXMgPT09IDEgPyBcIlwiIDogXCJzXCJcblxuICAgIHJldHVybiBbXG4gICAgICBgLi4uICR7b21pdHRlZExpbmVzfSBjb25zb2xlIG91dHB1dCBsaW5lJHtwbHVyYWx9IG9taXR0ZWQgLi4uYCxcbiAgICAgIC4uLmxpbmVzLnNsaWNlKC1tYXhMaW5lcylcbiAgICBdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCBmYWlsZWQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBMZWZ0IHBhZGRpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHByaW50RmFpbGVkQ29uc29sZU91dHB1dCh7Y29uc29sZU91dHB1dCwgbGVmdFBhZGRpbmd9KSB7XG4gICAgaWYgKHRlc3RDb25maWcuY29uc29sZU91dHB1dCAhPT0gXCJmYWlsdXJlXCIpIHJldHVyblxuICAgIGlmICghY29uc29sZU91dHB1dCkgcmV0dXJuXG5cbiAgICBjb25zdCBsaW5lcyA9IHRoaXMudHJ1bmNhdGVGYWlsZWRDb25zb2xlT3V0cHV0TGluZXMoY29uc29sZU91dHB1dClcblxuICAgIGlmIChsaW5lcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIENvbnNvbGUgb3V0cHV0OmApKVxuXG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgICAke2xpbmV9YCkpXG4gICAgfVxuICB9XG5cbn1cbiJdfQ==