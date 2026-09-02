// @ts-check
import { addTrackedStackToError } from "../utils/with-tracked-stack.js";
import fs from "node:fs/promises";
import path from "path";
import { format } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import Application from "../../src/application.js";
import BacktraceCleaner from "../utils/backtrace-cleaner-node.js";
import { TestDatabaseAccessRevokedError } from "../environment-handlers/base.js";
import RequestClient from "./request-client.js";
import picocolors from "picocolors";
import restArgsError from "../utils/rest-args-error.js";
import { testConfig, testEvents, tests } from "./test.js";
import { pathToFileURL } from "url";
import { clearDeliveries } from "../mailer.js";
import SharedTransactionBroker from "./shared-transaction-broker.js";
import { SHARED_TRANSACTION_BROKER_ENV } from "./shared-transaction-proxy-driver.js";
import { synchronizeTestingPackageTests } from "./testing-package-adapter.js";
/**
 * ConsoleMethodName type.
 * @typedef {"log" | "info" | "warn" | "error" | "debug"} ConsoleMethodName */
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
 * ActiveAfterAllScopeEntry type.
 * @typedef {object} ActiveAfterAllScopeEntry
 * @property {TestsArgument} tests - Scope test tree.
 * @property {boolean} afterAllsRun - Whether cleanup hooks have run.
 * @property {string} [profileScopeId] - Opaque profile scope identifier.
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
 * Marks the error thrown by {@link runWithTimeout} so the caller can tell a
 * lifecycle timeout (the promise is still running detached) apart from an
 * ordinary test failure (the promise already settled).
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
 * Runs run with timeout.
 *
 * On timeout the wrapped `promise` is NOT cancelled — it keeps running detached.
 * The rejected error is tagged with `velociousTestTimeout` so the runner knows
 * the lifecycle (and its afterEach database cleanup) is still in flight and can
 * wait for it to settle before the next test reuses the shared connection.
 * @param {Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} promise - Promise or value.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @param {string} testDescription - Test description.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves or rejects based on timeout or promise result.
 */
function runWithTimeout(promise, timeoutMs, testDescription) {
    const timeoutSeconds = (timeoutMs / 1000).toFixed(3).replace(/\.?0+$/, "");
    /** @type {TestTimeoutError} */
    const timeoutError = new Error(`Timed out after ${timeoutSeconds}s: ${testDescription}`);
    timeoutError.velociousTestTimeout = true;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(timeoutError), timeoutMs);
        Promise.resolve(promise).then((result) => {
            clearTimeout(timeout);
            resolve(result);
        }).catch((error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}
/**
 * Waits for an abandoned (timed-out) test lifecycle to settle, bounded by a
 * grace period, so its afterEach database cleanup runs on the shared connection
 * before the next test reuses it. Returns the fulfillment/rejection outcome if
 * the lifecycle settles, or a pending outcome once the grace elapses.
 *
 * The grace timer is kept ref'd so it cannot let Node exit with an unsettled
 * top-level await when the timed-out lifecycle has no ref'd handles of its own
 * (for example a stalled mocked async API). Once the caller continues past this
 * await, the timer has already resolved and no longer anchors the event loop.
 * @param {Promise<ReturnType<typeof JSON.parse>>} lifecycle - The abandoned per-test lifecycle promise.
 * @param {number} graceMs - Maximum time to wait for the lifecycle to settle.
 * @returns {Promise<{settled: false} | {settled: true, status: "fulfilled"} | {settled: true, status: "rejected", reason: unknown}>} - Settlement outcome.
 */
function awaitSettledOrGrace(lifecycle, graceMs) {
    return new Promise((resolve) => {
        let settled = false;
        const graceTimer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            resolve({ settled: false });
        }, graceMs);
        Promise.resolve(lifecycle).then(() => {
            if (settled)
                return;
            settled = true;
            clearTimeout(graceTimer);
            resolve({ settled: true, status: "fulfilled" });
        }, (reason) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(graceTimer);
            resolve({ settled: true, status: "rejected", reason });
        });
    });
}
/**
 * Checks whether a late lifecycle stopped only because its test access was revoked.
 * @param {unknown} error - Lifecycle rejection.
 * @returns {boolean} - Whether every contained error is expected revocation.
 */
function isTestDatabaseAccessRevocation(error) {
    if (error instanceof TestDatabaseAccessRevokedError)
        return true;
    if (error instanceof AggregateError) {
        return error.errors.length > 0 && error.errors.every((nestedError) => isTestDatabaseAccessRevocation(nestedError));
    }
    return false;
}
/**
 * Captured console methods.
 * @type {ConsoleMethodName[]} */
const CAPTURED_CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"];
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
    /**
     * Narrows the runtime value to the documented type.
     * @type {ActiveAfterAllScopeEntry[]} */
    _activeAfterAllScopes;
    /**
     * Narrows the runtime value to the documented type.
     * @type {FailedTestDetail[]} */
    _failedTestDetails;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {string[] | string} [args.excludeTags] - Tags to exclude.
     * @param {string[] | string} [args.includeTags] - Tags to include.
     * @param {Array<string>} args.testFiles - Test files.
     * @param {Record<string, number[]>} [args.lineFilters] - Line filters by file.
     * @param {RegExp[]} [args.examplePatterns] - Example patterns.
     * @param {import("./test-profiler.js").default} [args.profiler] - Opt-in profiler.
     */
    constructor({ configuration, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, profiler, ...restArgs }) {
        restArgsError(restArgs);
        if (!configuration)
            throw new Error("configuration is required");
        this._configuration = configuration;
        this._sharedTransactionCoordinatorOwnerStorage = new AsyncLocalStorage();
        this._testDatabaseAccessScopeStorage = new AsyncLocalStorage();
        this._excludeTags = this.normalizeTags(excludeTags);
        this._excludeTagSet = new Set(this._excludeTags);
        this._includeTags = this.normalizeTags(includeTags);
        this._includeTagSet = new Set(this._includeTags);
        this._testFiles = testFiles;
        this._lineFilters = lineFilters || {};
        this._examplePatterns = examplePatterns || [];
        this._profiler = profiler;
        this._abortRemainingTests = false;
        this._failedTests = 0;
        this._successfulTests = 0;
        this._testsCount = 0;
        this._activeAfterAllScopes = [];
        this._failedTestDetails = [];
        /** @type {{fullDescription: string, filePath: string, line: number} | null} */
        this._lastTestContext = null;
        /** @type {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} */
        this._testDurations = [];
    }
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
     * Adds declaration metadata to hooks only for an active profile.
     * @template {AfterBeforeEachCallbackObjectType | BeforeAfterAllCallbackObjectType} T
     * @param {T[]} hooks - Hooks declared in one scope.
     * @param {string | undefined} declarationScopeId - Profile scope identifier.
     * @param {string | undefined} ownerFilePath - Scope owner file.
     * @returns {T[]} - Profile-aware hook entries.
     */
    profileHookEntries(hooks, declarationScopeId, ownerFilePath) {
        if (!this._profiler)
            return hooks;
        return hooks.map((hook, declarationIndex) => Object.assign({}, hook, {
            declarationIndex: hook.declarationIndex ?? declarationIndex,
            declarationScopeId: hook.declarationScopeId ?? declarationScopeId,
            ownerFilePath: hook.ownerFilePath ?? ownerFilePath
        }));
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
     * Runs has matching tag.
     * @param {string[] | string | undefined} testTags - Test tags.
     * @param {Set<string>} tagSet - Tag set.
     * @returns {boolean} - Whether any tags match.
     */
    hasMatchingTag(testTags, tagSet) {
        if (!tagSet.size)
            return false;
        const normalized = this.normalizeTags(testTags);
        for (const tag of normalized) {
            if (tagSet.has(tag))
                return true;
        }
        return false;
    }
    /**
     * Runs has runnable tests.
     * @param {TestsArgument} tests - Tests.
     * @param {string[]} [descriptions] - Description stack.
     * @param {boolean} [lineMatchedInScope] - Whether line matched in scope.
     * @returns {boolean} - Whether any tests in this scope will run.
     */
    hasRunnableTests(tests, descriptions = [], lineMatchedInScope = false) {
        for (const testDescription in tests.tests) {
            const testData = tests.tests[testDescription];
            const testArgs = /** @type {TestArgs} */ (Object.assign({}, testData.args));
            const includeByLine = lineMatchedInScope || this.matchesLineFilter(testData);
            if (this._onlyFocussed && !testArgs.focus)
                continue;
            if (this.shouldSkipTest(testArgs, testData, testDescription, descriptions, includeByLine))
                continue;
            return true;
        }
        for (const subDescription in tests.subs) {
            const subTest = tests.subs[subDescription];
            const scopeLineMatch = lineMatchedInScope || this.matchesLineFilter(subTest);
            const nextDescriptions = descriptions.concat([subDescription]);
            if (this._onlyFocussed && !subTest.anyTestsFocussed)
                continue;
            if (this.hasRunnableTests(subTest, nextDescriptions, scopeLineMatch))
                return true;
        }
        return false;
    }
    /**
     * Runs should skip test.
     * @param {TestArgs} testArgs - Test args.
     * @param {TestData} testData - Test data.
     * @param {string} testDescription - Test description.
     * @param {string[]} descriptions - Description stack.
     * @param {boolean} lineMatchedInScope - Whether line matched in scope.
     * @returns {boolean} - Whether the test should be skipped.
     */
    shouldSkipTest(testArgs, testData, testDescription, descriptions, lineMatchedInScope) {
        if (this.hasTag(testArgs, "browser-only") && !this.isBrowserTestMode())
            return true;
        if (this.hasMatchingTag(testArgs.tags, this.getExcludeTagSet()))
            return true;
        if (this._includeTagSet.size > 0 && !testArgs.focus) {
            if (!this.hasMatchingTag(testArgs.tags, this._includeTagSet))
                return true;
        }
        if (this.getExamplePatterns().length > 0) {
            const fullDescription = this.buildFullDescription(descriptions, testDescription);
            const matches = this.getExamplePatterns().some((pattern) => {
                pattern.lastIndex = 0;
                return pattern.test(fullDescription);
            });
            if (!matches)
                return true;
        }
        const lineFilters = this.getLineFilters();
        if (Object.keys(lineFilters).length > 0) {
            if (!lineMatchedInScope && !this.matchesLineFilter(testData))
                return true;
        }
        return false;
    }
    /**
     * Runs matches line filter.
     * @param {TestData | TestsArgument} entry - Test entry.
     * @returns {boolean} - Whether line filter matches entry.
     */
    matchesLineFilter(entry) {
        if (!entry || !entry.filePath || !entry.line)
            return false;
        const filePath = path.resolve(entry.filePath);
        const lines = this.getLineFilters()[filePath];
        if (!lines || lines.length === 0)
            return false;
        return lines.includes(entry.line);
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
            synchronizeTestingPackageTests(tests);
            return;
        }
        for (const testFile of this.getTestFiles()) {
            const existingRegistrations = this.testRegistrationObjects(tests);
            await this._profiler.measurePhase("imports", async () => {
                await environmentHandler.importTestFiles([testFile]);
            }, { filePath: testFile });
            synchronizeTestingPackageTests(tests);
            this.assignTestRegistrationOwnership(tests, existingRegistrations, testFile);
        }
    }
    /**
     * Collects registered scope, hook, and test objects by identity.
     * @param {TestsArgument} scope - Test scope.
     * @param {Set<object>} [registrations] - Accumulated identities.
     * @returns {Set<object>} - Registration identities.
     */
    testRegistrationObjects(scope, registrations = new Set()) {
        registrations.add(scope);
        for (const hook of [...scope.beforeAlls, ...scope.beforeEaches, ...scope.afterEaches, ...scope.afterAlls]) {
            registrations.add(hook);
        }
        for (const testData of Object.values(scope.tests))
            registrations.add(testData);
        for (const childScope of Object.values(scope.subs))
            this.testRegistrationObjects(childScope, registrations);
        return registrations;
    }
    /**
     * Assigns deterministic ownership to registrations added by one entry file,
     * including declarations originating in a helper imported by that entry file.
     * @param {TestsArgument} scope - Test scope.
     * @param {Set<object>} previousRegistrations - Identities present before import.
     * @param {string} ownerFilePath - Importing entry file.
     * @returns {void}
     */
    assignTestRegistrationOwnership(scope, previousRegistrations, ownerFilePath) {
        if (!previousRegistrations.has(scope))
            scope.ownerFilePath ??= ownerFilePath;
        for (const hook of [...scope.beforeAlls, ...scope.beforeEaches, ...scope.afterEaches, ...scope.afterAlls]) {
            if (!previousRegistrations.has(hook))
                hook.ownerFilePath ??= ownerFilePath;
        }
        for (const testData of Object.values(scope.tests)) {
            if (!previousRegistrations.has(testData))
                testData.ownerFilePath ??= ownerFilePath;
        }
        for (const childScope of Object.values(scope.subs)) {
            this.assignTestRegistrationOwnership(childScope, previousRegistrations, ownerFilePath);
        }
    }
    /**
     * Runs is failed.
     * @returns {boolean} - Whether failed.
     */
    isFailed() { return this._failedTests !== undefined && this._failedTests > 0; }
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
        const testingConfigPath = this.getConfiguration().getTesting();
        if (testingConfigPath) {
            await this.runProfileSpan({ phase: "testing config/global setup" }, async () => {
                await this.getConfiguration().getEnvironmentHandler().importTestingConfigPath();
            });
        }
        await this.importTestFiles();
        await this.analyzeTests(tests);
        this._onlyFocussed = this.anyTestsFocussed;
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
            await this.runTests({
                afterEaches: [],
                beforeEaches: [],
                tests,
                descriptions: [],
                indentLevel: 0
            });
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
        const scopes = [...this._activeAfterAllScopes].reverse();
        /** @type {unknown[]} */
        const afterAllErrors = [];
        for (const scope of scopes) {
            try {
                await this.runAfterAllsForScope(scope);
            }
            catch (error) {
                afterAllErrors.push(error);
            }
        }
        this._activeAfterAllScopes = [];
        if (afterAllErrors.length == 1)
            throw afterAllErrors[0];
        if (afterAllErrors.length > 1) {
            throw new AggregateError(afterAllErrors, "Multiple active afterAll scopes failed", { cause: afterAllErrors[0] });
        }
    }
    /**
     * Runs analyze tests.
     * @param {TestsArgument} tests - Tests.
     * @returns {{anyTestsFocussed: boolean}} - Whether any tests in the tree are focused.
     */
    analyzeTests(tests) {
        let anyTestsFocussedFound = false;
        for (const testDescription in tests.tests) {
            const testData = tests.tests[testDescription];
            const testArgs = Object.assign({}, testData.args);
            this._testsCount++;
            if (testArgs.focus) {
                anyTestsFocussedFound = true;
                this.anyTestsFocussed = true;
            }
        }
        for (const subDescription in tests.subs) {
            const subTest = tests.subs[subDescription];
            const { anyTestsFocussed } = this.analyzeTests(subTest);
            if (anyTestsFocussed) {
                anyTestsFocussedFound = true;
            }
            subTest.anyTestsFocussed = anyTestsFocussed;
        }
        return { anyTestsFocussed: anyTestsFocussedFound };
    }
    /**
     * Runs every after-each hook while preserving the first failure.
     * @param {object} args - Hook execution arguments.
     * @param {AfterBeforeEachCallbackObjectType[]} args.afterEaches - Hooks to run.
     * @param {TestArgs} args.testArgs - Current test arguments.
     * @param {TestData} args.testData - Current test data.
     * @returns {Promise<void>} - Resolves after every hook runs.
     */
    async runAfterEaches({ afterEaches, testArgs, testData }) {
        /** @type {unknown[]} */
        const afterEachErrors = [];
        for (const afterEachData of afterEaches) {
            try {
                await this.runProfileSpan({
                    phase: "afterEach",
                    declarationIndex: afterEachData.declarationIndex,
                    declarationScopeId: afterEachData.declarationScopeId,
                    filePath: afterEachData.ownerFilePath
                }, async () => {
                    await afterEachData.callback({ configuration: this.getConfiguration(), testArgs, testData });
                });
            }
            catch (error) {
                afterEachErrors.push(error);
            }
        }
        if (afterEachErrors.length == 1)
            throw afterEachErrors[0];
        if (afterEachErrors.length > 1) {
            throw new AggregateError(afterEachErrors, "Multiple afterEach hooks failed", { cause: afterEachErrors[0] });
        }
    }
    /**
     * Runs run tests.
     * @param {object} args - Options object.
     * @param {Array<AfterBeforeEachCallbackObjectType>} args.afterEaches - After eaches.
     * @param {Array<AfterBeforeEachCallbackObjectType>} args.beforeEaches - Before eaches.
     * @param {TestsArgument} args.tests - Tests.
     * @param {string[]} args.descriptions - Descriptions.
     * @param {number} args.indentLevel - Indent level.
     * @param {boolean} [args.lineMatchedInScope] - Whether line matched in scope.
     * @param {string} [args.parentProfileScopeId] - Parent profile scope.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async runTests({ afterEaches, beforeEaches, tests, descriptions, indentLevel, lineMatchedInScope = false, parentProfileScopeId }) {
        const environmentHandler = this.getConfiguration().getEnvironmentHandler();
        environmentHandler.installSharedTransactionCoordinatorOwnerStorage(this._sharedTransactionCoordinatorOwnerStorage);
        environmentHandler.installTestDatabaseAccessScopeStorage(this._testDatabaseAccessScopeStorage);
        const leftPadding = " ".repeat(indentLevel * 2);
        const scopeOwnerFilePath = tests.ownerFilePath ?? tests.filePath;
        const profileScopeId = this._profiler?.scopeId(tests, {
            descriptions,
            filePath: scopeOwnerFilePath,
            line: tests.line,
            parentId: parentProfileScopeId
        });
        const ownAfterEaches = [...this.profileHookEntries(tests.afterEaches, profileScopeId, scopeOwnerFilePath)].reverse();
        const ownBeforeEaches = this.profileHookEntries(tests.beforeEaches, profileScopeId, scopeOwnerFilePath);
        const newAfterEaches = [...ownAfterEaches, ...afterEaches];
        const newBeforeEaches = [...beforeEaches, ...ownBeforeEaches];
        const scopeLineMatch = lineMatchedInScope || this.matchesLineFilter(tests);
        const shouldRunAnyTests = this.hasRunnableTests(tests, descriptions, scopeLineMatch);
        if (!shouldRunAnyTests)
            return;
        /** @type {ActiveAfterAllScopeEntry} */
        const scopeEntry = { tests, afterAllsRun: false, profileScopeId };
        this._activeAfterAllScopes.push(scopeEntry);
        /** @type {unknown[]} */
        const scopeErrors = [];
        try {
            const beforeAlls = this.profileHookEntries(tests.beforeAlls || [], profileScopeId, scopeOwnerFilePath);
            for (const beforeAllData of beforeAlls) {
                await this.runProfileSpan({
                    phase: "beforeAll",
                    declarationIndex: beforeAllData.declarationIndex,
                    declarationScopeId: beforeAllData.declarationScopeId,
                    filePath: beforeAllData.ownerFilePath
                }, async () => {
                    await beforeAllData.callback({ configuration: this.getConfiguration() });
                });
            }
            for (const testDescription in tests.tests) {
                const testData = tests.tests[testDescription];
                const testArgs = /** @type {TestArgs} */ (Object.assign({}, testData.args));
                const includeByLine = scopeLineMatch || this.matchesLineFilter(testData);
                if (this._onlyFocussed && !testArgs.focus)
                    continue;
                if (this.shouldSkipTest(testArgs, testData, testDescription, descriptions, includeByLine))
                    continue;
                if (testArgs.type == "model" || testArgs.type == "request") {
                    testArgs.application = await this.application();
                }
                if (testArgs.type == "request") {
                    testArgs.client = await this.requestClient();
                }
                const retryCount = typeof testArgs.retry === "number" && Number.isFinite(testArgs.retry)
                    ? Math.max(0, Math.floor(testArgs.retry))
                    : 0;
                const configTimeoutSeconds = typeof testConfig.defaultTimeoutSeconds === "number" ? testConfig.defaultTimeoutSeconds : undefined;
                const timeoutSeconds = typeof testArgs.timeoutSeconds === "number" ? testArgs.timeoutSeconds : configTimeoutSeconds;
                const useTimeout = typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0;
                const timeoutMs = useTimeout ? timeoutSeconds * 1000 : undefined;
                let retriesUsed = 0;
                let attemptNumber = 1;
                /**
                 * Attempt console outputs.
                 * @type {AttemptConsoleOutput[]} */
                const attemptConsoleOutputs = [];
                console.log(`${leftPadding}it ${testDescription}`);
                const testStartMs = Date.now();
                while (true) {
                    let shouldRetry = false;
                    /**
                     * Defines caughtError.
                     * @type {ReturnType<typeof JSON.parse>} */
                    let caughtError;
                    /**
                     * Defines failedError.
                     * @type {ReturnType<typeof JSON.parse>} */
                    let failedError;
                    /**
                     * Defines lastError.
                     * @type {ReturnType<typeof JSON.parse>} */
                    let lastError;
                    let willRetry = false;
                    /**
                     * The per-test lifecycle promise, hoisted so the timeout branch can
                     * still wait for it to settle after runWithTimeout has abandoned it.
                     * @type {Promise<ReturnType<typeof JSON.parse>> | undefined} */
                    let testLifecycle;
                    /** @type {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} */
                    let testSharedConnectionRegistrations = [];
                    let testSharedConnectionsActive = false;
                    /** @type {SharedTransactionBrokerRegistration | undefined} */
                    let sharedTransactionBrokerRegistration;
                    /** @type {SharedTransactionBrokerRegistration | undefined} */
                    let sharedTransactionBrokerPreparation;
                    /** @type {TransactionalTenantRegistration[]} */
                    const transactionalTenantRegistrations = [];
                    /** @type {BrowserDummyConnectionRegistration[]} */
                    const browserDummyConnectionRegistrations = [];
                    const testDatabaseAccessScope = { revoked: false };
                    /** @type {Set<Error>} */
                    const recordedTimeoutCleanupErrors = new Set();
                    testArgs.registerTransactionalTenant = async (args) => {
                        await this.registerTransactionalTenant(args, transactionalTenantRegistrations);
                    };
                    const stopConsoleCapture = this.startConsoleCapture({
                        passthrough: testConfig.consoleOutput === "live"
                    });
                    const profiler = this._profiler;
                    const profileAttempt = profiler?.startAttempt({
                        descriptions,
                        attemptNumber,
                        testData,
                        testDescription
                    });
                    let attemptTimedOut = false;
                    try {
                        // Run the whole per-test lifecycle (dummy/server startup, connection
                        // acquisition, beforeEach hooks, the test body and afterEach hooks) as
                        // one promise so the timeout below can cover all of it.
                        const runLifecycleCallback = async () => await this.runWithDummyIfNeeded(testArgs, async () => {
                            const useTransaction = testArgs.databaseCleaning?.transaction === true;
                            const shouldTruncate = testArgs.databaseCleaning?.truncate ?? !useTransaction;
                            const useSharedTestConnections = useTransaction || testArgs.type == "request";
                            const useTestConnections = useSharedTestConnections || shouldTruncate;
                            const runTestAttempt = async () => {
                                // Register dynamic candidates before hooks so transaction state changes
                                // made during a hook are immediately visible to any in-process work.
                                // Prepare transaction sharing before hooks so long-lived services cannot
                                // use the shared connection while its coordinator is still missing.
                                if (useSharedTestConnections) {
                                    testSharedConnectionRegistrations = this.activateTestSharedConnections();
                                    testSharedConnectionsActive = true;
                                }
                                /** @type {unknown[]} */
                                const lifecycleErrors = [];
                                let runCleanupHooks = false;
                                try {
                                    if (useSharedTestConnections) {
                                        sharedTransactionBrokerPreparation = await this.prepareSharedTransactionBroker();
                                    }
                                    runCleanupHooks = true;
                                    clearDeliveries();
                                    for (const beforeEachData of newBeforeEaches) {
                                        await this.runProfileSpan({
                                            phase: "beforeEach",
                                            declarationIndex: beforeEachData.declarationIndex,
                                            declarationScopeId: beforeEachData.declarationScopeId,
                                            filePath: beforeEachData.ownerFilePath
                                        }, async () => {
                                            await beforeEachData.callback({ configuration: this.getConfiguration(), testArgs, testData });
                                        });
                                    }
                                    if (useSharedTestConnections) {
                                        const activeSharedTransactionConnections = this.sharedTransactionConnections({ transactionsOnly: true });
                                        if (sharedTransactionBrokerPreparation && !this.sharedTransactionBrokerMatchesConnections(sharedTransactionBrokerPreparation, activeSharedTransactionConnections)) {
                                            this.clearTestSharedConnections(testSharedConnectionRegistrations);
                                            testSharedConnectionRegistrations = [];
                                            testSharedConnectionsActive = false;
                                        }
                                        sharedTransactionBrokerRegistration = await this.startSharedTransactionBroker(sharedTransactionBrokerPreparation, activeSharedTransactionConnections);
                                        sharedTransactionBrokerPreparation = undefined;
                                        if (sharedTransactionBrokerRegistration && !testSharedConnectionsActive) {
                                            testSharedConnectionRegistrations = this.activateTestSharedConnections();
                                            testSharedConnectionsActive = true;
                                        }
                                    }
                                    // Record which test is running so an async crash (an unhandled
                                    // rejection detached from any await) that fires during or shortly
                                    // after this test can be attributed to it in run()'s handler.
                                    this._lastTestContext = {
                                        fullDescription: this.buildFullDescription(descriptions, testDescription),
                                        filePath: testData.filePath ?? "<unknown>",
                                        line: testData.line ?? 0
                                    };
                                    await this.runProfileSpan({ phase: "test body", filePath: testData.ownerFilePath ?? testData.filePath }, async () => {
                                        await testData.function(testArgs);
                                    });
                                }
                                catch (error) {
                                    lifecycleErrors.push(error);
                                }
                                if (runCleanupHooks) {
                                    try {
                                        // Framework-owned post-commit broadcasts are intentionally
                                        // detached; drain them before test cleanup so their DB
                                        // checkouts cannot leak into the next test's lifecycle.
                                        await this.getConfiguration().awaitPendingBroadcasts();
                                    }
                                    catch (error) {
                                        lifecycleErrors.push(error);
                                    }
                                    try {
                                        if (testSharedConnectionsActive) {
                                            this.clearTestSharedConnections(testSharedConnectionRegistrations);
                                            testSharedConnectionRegistrations = [];
                                            testSharedConnectionsActive = false;
                                        }
                                    }
                                    catch (error) {
                                        lifecycleErrors.push(error);
                                    }
                                    try {
                                        await this.stopSharedTransactionBroker(sharedTransactionBrokerRegistration || sharedTransactionBrokerPreparation);
                                        sharedTransactionBrokerRegistration = undefined;
                                        sharedTransactionBrokerPreparation = undefined;
                                    }
                                    catch (error) {
                                        lifecycleErrors.push(error);
                                    }
                                    try {
                                        await this.runAfterEaches({ afterEaches: newAfterEaches, testArgs, testData });
                                    }
                                    catch (error) {
                                        lifecycleErrors.push(error);
                                    }
                                    try {
                                        await this.cleanupTransactionalTenants(transactionalTenantRegistrations);
                                    }
                                    catch (error) {
                                        lifecycleErrors.push(error);
                                    }
                                }
                                if (testSharedConnectionsActive) {
                                    try {
                                        this.clearTestSharedConnections(testSharedConnectionRegistrations);
                                    }
                                    catch (error) {
                                        lifecycleErrors.push(error);
                                    }
                                    testSharedConnectionsActive = false;
                                }
                                if (lifecycleErrors.length == 1)
                                    throw lifecycleErrors[0];
                                if (lifecycleErrors.length > 1) {
                                    throw new AggregateError(lifecycleErrors, "Test lifecycle and cleanup failed", { cause: lifecycleErrors[0] });
                                }
                            };
                            if (useTestConnections) {
                                // Database cleaning requires one connection for beforeEach, the test
                                // body and afterEach; only transactions and requests share it dynamically.
                                await this.getConfiguration().ensureConnections({ name: `Test: ${testDescription}` }, runTestAttempt);
                            }
                            else {
                                await runTestAttempt();
                            }
                        }, browserDummyConnectionRegistrations);
                        const lifecycleCallback = async () => await this.getConfiguration().runWithTestDatabaseAccessScope(testDatabaseAccessScope, runLifecycleCallback);
                        testLifecycle = profileAttempt && profiler
                            ? profiler.runAttempt(profileAttempt, lifecycleCallback)
                            : lifecycleCallback();
                        // Time out the ENTIRE lifecycle, not just the test body. A hang in any
                        // phase — a connection checkout that never resolves, a beforeEach/afterEach
                        // waiting on a lock, or dummy server startup — would otherwise stall the
                        // whole run indefinitely (until CI kills the build) instead of failing the
                        // single offending test.
                        if (useTimeout && timeoutMs !== undefined) {
                            await runWithTimeout(testLifecycle, timeoutMs, testDescription);
                        }
                        else {
                            await testLifecycle;
                        }
                        // A test is successful only after its complete lifecycle settles.
                        // Cleanup failures and timed-out detached work must not overlap the
                        // final successful and failed counters used for executed-test totals.
                        this._successfulTests++;
                    }
                    catch (error) {
                        caughtError = error;
                        lastError = error;
                        // A timeout REJECTS while the lifecycle keeps running detached on the
                        // shared per-suite connection — including its afterEach database
                        // cleanup (e.g. transaction rollback). If the next test starts before
                        // that rollback runs, its own startTransaction() implicitly COMMITS
                        // the timed-out test's rows on the shared connection, poisoning every
                        // later test in the shard (duplicate-key / foreign-key cascades from
                        // leaked fixtures). Wait — bounded — for the abandoned lifecycle to
                        // settle so its cleanup lands first. If it remains active after the
                        // bounded grace, quarantine its browser connections and stop running
                        // tests rather than sharing unsafe state.
                        const timedOut = Boolean(/** @type {TestTimeoutError} */ (error)?.velociousTestTimeout);
                        attemptTimedOut = timedOut;
                        if (timedOut && testLifecycle) {
                            const emergencyCleanupErrors = [];
                            if (profileAttempt && profiler)
                                profiler.finishAttempt(profileAttempt, "timed-out");
                            const lifecycleOutcome = await awaitSettledOrGrace(testLifecycle, timeoutMs ?? 60000);
                            if (lifecycleOutcome.settled && lifecycleOutcome.status === "rejected") {
                                emergencyCleanupErrors.push(lifecycleOutcome.reason);
                            }
                            // If the abandoned lifecycle never settled within the grace, its
                            // cleanup has not completed. Quarantine browser-owned connections
                            // before any scope cleanup can race the abandoned callback.
                            if (!lifecycleOutcome.settled) {
                                testDatabaseAccessScope.revoked = true;
                                void testLifecycle.catch((cleanupError) => {
                                    if (isTestDatabaseAccessRevocation(cleanupError))
                                        return;
                                    this.recordTimeoutCleanupFailure(cleanupError, "test lifecycle", recordedTimeoutCleanupErrors);
                                });
                                const quarantine = this.quarantineBrowserDummyConnections(browserDummyConnectionRegistrations);
                                const quarantineOutcome = await awaitSettledOrGrace(quarantine, timeoutMs ?? 60000);
                                const usesBrowserTransactions = testArgs.databaseCleaning?.transaction === true;
                                const usesBrowserTruncation = testArgs.databaseCleaning?.truncate ?? !usesBrowserTransactions;
                                this._abortRemainingTests = this.isBrowserTestMode()
                                    && this.hasTag(testArgs, "dummy")
                                    && (usesBrowserTransactions || usesBrowserTruncation);
                                if (quarantineOutcome.settled && quarantineOutcome.status === "rejected") {
                                    emergencyCleanupErrors.push(quarantineOutcome.reason);
                                }
                                else if (!quarantineOutcome.settled) {
                                    void quarantine.catch((cleanupError) => {
                                        this.recordTimeoutCleanupFailure(cleanupError, "browser dummy connection quarantine", recordedTimeoutCleanupErrors);
                                    });
                                }
                            }
                            try {
                                if (testSharedConnectionsActive) {
                                    this.clearTestSharedConnections(testSharedConnectionRegistrations);
                                    testSharedConnectionRegistrations = [];
                                    testSharedConnectionsActive = false;
                                }
                            }
                            catch (cleanupError) {
                                emergencyCleanupErrors.push(cleanupError);
                            }
                            const brokerCleanup = this.stopSharedTransactionBroker(sharedTransactionBrokerRegistration || sharedTransactionBrokerPreparation);
                            const brokerCleanupOutcome = await awaitSettledOrGrace(brokerCleanup, timeoutMs ?? 60000);
                            if (brokerCleanupOutcome.settled && brokerCleanupOutcome.status === "rejected") {
                                emergencyCleanupErrors.push(brokerCleanupOutcome.reason);
                            }
                            else if (!brokerCleanupOutcome.settled) {
                                void brokerCleanup.catch((cleanupError) => {
                                    this.recordTimeoutCleanupFailure(cleanupError, "shared transaction broker", recordedTimeoutCleanupErrors);
                                });
                            }
                            sharedTransactionBrokerRegistration = undefined;
                            sharedTransactionBrokerPreparation = undefined;
                            const emergencyCleanup = this.cleanupTransactionalTenants(transactionalTenantRegistrations, { discard: true });
                            const emergencyCleanupOutcome = await awaitSettledOrGrace(emergencyCleanup, timeoutMs ?? 60000);
                            if (emergencyCleanupOutcome.settled && emergencyCleanupOutcome.status === "rejected") {
                                emergencyCleanupErrors.push(emergencyCleanupOutcome.reason);
                            }
                            else if (!emergencyCleanupOutcome.settled) {
                                // The timed-out attempt must not block the runner indefinitely, but a
                                // later rollback/discard failure still becomes a visible test failure.
                                void emergencyCleanup.catch((cleanupError) => {
                                    this.recordTimeoutCleanupFailure(cleanupError, "transactional tenant", recordedTimeoutCleanupErrors);
                                });
                            }
                            if (emergencyCleanupErrors.length > 0) {
                                caughtError = new AggregateError([caughtError, ...emergencyCleanupErrors], "Test timeout and emergency cleanup failed", { cause: caughtError });
                                lastError = caughtError;
                            }
                        }
                        if (browserDummyConnectionRegistrations.some((registration) => registration.quarantined)) {
                            testDatabaseAccessScope.revoked = true;
                            this._abortRemainingTests = true;
                        }
                        willRetry = !this._abortRemainingTests && retriesUsed < retryCount;
                        if (willRetry) {
                            retriesUsed++;
                        }
                        if (willRetry) {
                            shouldRetry = true;
                        }
                        else {
                            failedError = caughtError;
                        }
                    }
                    finally {
                        testDatabaseAccessScope.revoked = true;
                        const consoleOutput = stopConsoleCapture();
                        if (profileAttempt && profiler) {
                            profiler.finishAttempt(profileAttempt, caughtError === undefined
                                ? "passed"
                                : (attemptTimedOut ? "timed-out" : "failed"));
                        }
                        if (consoleOutput) {
                            attemptConsoleOutputs.push({ attemptNumber, output: consoleOutput });
                        }
                    }
                    if (caughtError !== undefined) {
                        await this.emitEvent("testAttemptFailed", {
                            configuration: this.getConfiguration(),
                            descriptions,
                            error: caughtError,
                            attemptNumber,
                            nextAttempt: willRetry ? attemptNumber + 1 : undefined,
                            retriesUsed,
                            retryCount,
                            testArgs,
                            testData,
                            testDescription,
                            testRunner: this,
                            willRetry
                        });
                    }
                    if (shouldRetry) {
                        console.warn(picocolors.red(`${leftPadding}  Retrying (${retriesUsed}/${retryCount}) after error: ${lastError instanceof Error ? lastError.message : String(lastError)}`));
                        await this.emitEvent("testRetrying", {
                            configuration: this.getConfiguration(),
                            descriptions,
                            error: lastError,
                            nextAttempt: attemptNumber + 1,
                            retriesUsed,
                            retryCount,
                            testArgs,
                            testData,
                            testDescription,
                            testRunner: this
                        });
                    }
                    if (attemptNumber > 1) {
                        await this.emitEvent("testRetried", {
                            configuration: this.getConfiguration(),
                            descriptions,
                            error: lastError,
                            attemptNumber,
                            retriesUsed,
                            retryCount,
                            testArgs,
                            testData,
                            testDescription,
                            testRunner: this
                        });
                    }
                    attemptNumber++;
                    if (shouldRetry)
                        continue;
                    if (failedError) {
                        const consoleOutput = this.buildConsoleOutput(attemptConsoleOutputs);
                        if (failedError instanceof Error) {
                            console.error(picocolors.red(`${leftPadding}  Test failed: ${failedError.message}`));
                            addTrackedStackToError(failedError);
                            const backtraceCleaner = new BacktraceCleaner(failedError);
                            const cleanedStack = backtraceCleaner.getCleanedStack();
                            const stackLines = cleanedStack?.split("\n");
                            if (stackLines) {
                                for (const stackLine of stackLines) {
                                    console.error(picocolors.red(`${leftPadding}  ${stackLine}`));
                                }
                            }
                        }
                        else {
                            console.error(picocolors.red(`${leftPadding}  Test failed with a ${typeof failedError}: ${String(failedError)}`));
                        }
                        this.printFailedConsoleOutput({ consoleOutput, leftPadding });
                        this._failedTests++;
                        this._failedTestDetails.push({
                            fullDescription: this.buildFullDescription(descriptions, testDescription),
                            filePath: testData.filePath,
                            line: testData.line,
                            error: failedError,
                            consoleOutput: consoleOutput || undefined
                        });
                        await this.emitEvent("testFailed", {
                            configuration: this.getConfiguration(),
                            descriptions,
                            error: failedError,
                            testArgs,
                            testData,
                            testDescription,
                            testRunner: this
                        });
                        this.printRerunCommand({ descriptions, testDescription, testData, leftPadding });
                    }
                    break;
                }
                this._testDurations.push({
                    fullDescription: this.buildFullDescription(descriptions, testDescription),
                    filePath: testData.filePath ?? "<unknown>",
                    line: testData.line ?? 0,
                    durationMs: Date.now() - testStartMs
                });
                if (this._abortRemainingTests)
                    break;
            }
            for (const subDescription in tests.subs) {
                if (this._abortRemainingTests)
                    break;
                const subTest = tests.subs[subDescription];
                const newDecriptions = descriptions.concat([subDescription]);
                const childScopeLineMatch = scopeLineMatch || this.matchesLineFilter(subTest);
                if (!this._onlyFocussed || subTest.anyTestsFocussed) {
                    console.log(`${leftPadding}${subDescription}`);
                    await this.runTests({
                        afterEaches: newAfterEaches,
                        beforeEaches: newBeforeEaches,
                        tests: subTest,
                        descriptions: newDecriptions,
                        indentLevel: indentLevel + 1,
                        lineMatchedInScope: childScopeLineMatch,
                        parentProfileScopeId: profileScopeId
                    });
                }
            }
        }
        catch (error) {
            scopeErrors.push(error);
        }
        try {
            await this.runAfterAllsForScope(scopeEntry);
        }
        catch (error) {
            scopeErrors.push(error);
        }
        const scopeIndex = this._activeAfterAllScopes.indexOf(scopeEntry);
        if (scopeIndex >= 0) {
            this._activeAfterAllScopes.splice(scopeIndex, 1);
        }
        if (scopeErrors.length > 0 && this._abortRemainingTests) {
            const error = scopeErrors.length == 1
                ? scopeErrors[0]
                : new AggregateError(scopeErrors, "Test scope and afterAll cleanup failed", { cause: scopeErrors[0] });
            this.recordTimeoutCleanupFailure(error, "afterAll");
            return;
        }
        if (scopeErrors.length == 1)
            throw scopeErrors[0];
        if (scopeErrors.length > 1)
            throw new AggregateError(scopeErrors, "Test scope and afterAll cleanup failed", { cause: scopeErrors[0] });
    }
    /**
     * Runs run after alls for scope.
     * @param {ActiveAfterAllScopeEntry} scopeEntry - Scope entry.
     * @returns {Promise<void>} - Resolves when scope cleanup finishes.
     */
    async runAfterAllsForScope(scopeEntry) {
        if (scopeEntry.afterAllsRun)
            return;
        scopeEntry.afterAllsRun = true;
        const scopeOwnerFilePath = scopeEntry.tests.ownerFilePath ?? scopeEntry.tests.filePath;
        const afterAlls = [...this.profileHookEntries(scopeEntry.tests.afterAlls || [], scopeEntry.profileScopeId, scopeOwnerFilePath)].reverse();
        /** @type {unknown[]} */
        const afterAllErrors = [];
        for (const afterAllData of afterAlls) {
            try {
                await this.runProfileSpan({
                    phase: "afterAll",
                    declarationIndex: afterAllData.declarationIndex,
                    declarationScopeId: afterAllData.declarationScopeId,
                    filePath: afterAllData.ownerFilePath
                }, async () => {
                    await afterAllData.callback({ configuration: this.getConfiguration() });
                });
            }
            catch (error) {
                afterAllErrors.push(error);
            }
        }
        if (afterAllErrors.length == 1)
            throw afterAllErrors[0];
        if (afterAllErrors.length > 1) {
            throw new AggregateError(afterAllErrors, "Multiple afterAll hooks failed", { cause: afterAllErrors[0] });
        }
    }
    /**
     * Runs emit event.
     * @param {string} eventName - Event name.
     * @param {object} payload - Event payload.
     * @returns {Promise<void>} - Resolves when all listeners complete.
     */
    async emitEvent(eventName, payload) {
        const listeners = testEvents.listeners(eventName);
        for (const listener of listeners) {
            await listener(payload);
        }
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
    /**
     * Runs start console capture.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.passthrough] - Whether to pass through to the original console.
     * @returns {() => string} - Stops the capture and returns captured text.
     */
    startConsoleCapture({ passthrough = false } = {}) {
        /**
         * Lines.
         * @type {string[]} */
        const lines = [];
        /**
         * Console object.
         * @type {Record<ConsoleMethodName, (...args: Array<ReturnType<typeof JSON.parse>>) => void>} */
        const consoleObject = /** @type {Record<ConsoleMethodName, (...args: Array<ReturnType<typeof JSON.parse>>) => void>} */ (console);
        /**
         * Original console methods captured as direct references so stopping restores
         * the exact method that was installed at capture start.
         * @type {Record<ConsoleMethodName, (...args: Array<ReturnType<typeof JSON.parse>>) => void>} */
        const originalConsoleMethods = {
            debug: consoleObject.debug,
            error: consoleObject.error,
            info: consoleObject.info,
            log: consoleObject.log,
            warn: consoleObject.warn
        };
        let stopped = false;
        let outputText = "";
        for (const methodName of CAPTURED_CONSOLE_METHODS) {
            consoleObject[methodName] = (...args) => {
                lines.push(`[${new Date().toISOString()}] [${methodName}] ${format(...args)}`);
                if (passthrough) {
                    originalConsoleMethods[methodName].apply(consoleObject, args);
                }
            };
        }
        return () => {
            if (!stopped) {
                stopped = true;
                for (const methodName of CAPTURED_CONSOLE_METHODS) {
                    consoleObject[methodName] = originalConsoleMethods[methodName];
                }
                outputText = lines.join("\n");
            }
            return outputText;
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFDckUsT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDaEMsT0FBTyxFQUFDLGlCQUFpQixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDbEQsT0FBTyxXQUFXLE1BQU0sMEJBQTBCLENBQUE7QUFDbEQsT0FBTyxnQkFBZ0IsTUFBTSxvQ0FBb0MsQ0FBQTtBQUNqRSxPQUFPLEVBQUMsOEJBQThCLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUM5RSxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQ3ZELE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxLQUFLLENBQUE7QUFDakMsT0FBTyxFQUFDLGVBQWUsRUFBQyxNQUFNLGNBQWMsQ0FBQTtBQUM1QyxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3BGLE9BQU8sRUFBQyw4QkFBOEIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBRTNFOzs4RUFFOEU7QUFDOUU7Ozs7O0dBS0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNIOzs7Ozs7Ozs7R0FTRztBQUNIOzs7Ozs7OztHQVFHO0FB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cG9ydCB7YWRkVHJhY2tlZFN0YWNrVG9FcnJvcn0gZnJvbSBcIi4uL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHtmb3JtYXR9IGZyb20gXCJub2RlOnV0aWxcIlxuaW1wb3J0IHtBc3luY0xvY2FsU3RvcmFnZX0gZnJvbSBcIm5vZGU6YXN5bmNfaG9va3NcIlxuaW1wb3J0IEFwcGxpY2F0aW9uIGZyb20gXCIuLi8uLi9zcmMvYXBwbGljYXRpb24uanNcIlxuaW1wb3J0IEJhY2t0cmFjZUNsZWFuZXIgZnJvbSBcIi4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLW5vZGUuanNcIlxuaW1wb3J0IHtUZXN0RGF0YWJhc2VBY2Nlc3NSZXZva2VkRXJyb3J9IGZyb20gXCIuLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCJcbmltcG9ydCBSZXF1ZXN0Q2xpZW50IGZyb20gXCIuL3JlcXVlc3QtY2xpZW50LmpzXCJcbmltcG9ydCBwaWNvY29sb3JzIGZyb20gXCJwaWNvY29sb3JzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHt0ZXN0Q29uZmlnLCB0ZXN0RXZlbnRzLCB0ZXN0c30gZnJvbSBcIi4vdGVzdC5qc1wiXG5pbXBvcnQge3BhdGhUb0ZpbGVVUkx9IGZyb20gXCJ1cmxcIlxuaW1wb3J0IHtjbGVhckRlbGl2ZXJpZXN9IGZyb20gXCIuLi9tYWlsZXIuanNcIlxuaW1wb3J0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyIGZyb20gXCIuL3NoYXJlZC10cmFuc2FjdGlvbi1icm9rZXIuanNcIlxuaW1wb3J0IHsgU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlYgfSBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCJcbmltcG9ydCB7c3luY2hyb25pemVUZXN0aW5nUGFja2FnZVRlc3RzfSBmcm9tIFwiLi90ZXN0aW5nLXBhY2thZ2UtYWRhcHRlci5qc1wiXG5cbi8qKlxuICogQ29uc29sZU1ldGhvZE5hbWUgdHlwZS5cbiAqIEB0eXBlZGVmIHtcImxvZ1wiIHwgXCJpbmZvXCIgfCBcIndhcm5cIiB8IFwiZXJyb3JcIiB8IFwiZGVidWdcIn0gQ29uc29sZU1ldGhvZE5hbWUgKi9cbi8qKlxuICogQXR0ZW1wdENvbnNvbGVPdXRwdXQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF0dGVtcHRDb25zb2xlT3V0cHV0XG4gKiBAcHJvcGVydHkge251bWJlcn0gYXR0ZW1wdE51bWJlciAtIEF0dGVtcHQgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG91dHB1dCAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0LlxuICovXG4vKipcbiAqIFRlc3RBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0QXJnc1xuICogQHByb3BlcnR5IHtBcHBsaWNhdGlvbn0gW2FwcGxpY2F0aW9uXSAtIEFwcGxpY2F0aW9uIGluc3RhbmNlIGZvciBpbnRlZ3JhdGlvbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7UmVxdWVzdENsaWVudH0gW2NsaWVudF0gLSBIVFRQIGNsaWVudCBmb3IgcmVxdWVzdCB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBbZGF0YWJhc2VDbGVhbmluZ10gLSBEYXRhYmFzZSBjbGVhbnVwIG9wdGlvbnMgZm9yIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cmFuc2FjdGlvbl0gLSBVc2UgdHJhbnNhY3Rpb25zIHRvIHJvbGxiYWNrIGJldHdlZW4gdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRydW5jYXRlXSAtIFRydW5jYXRlIHRhYmxlcyBiZXR3ZWVuIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cnVuY2F0ZUJlZm9yZV0gLSBUcnVuY2F0ZSB0YWJsZXMgYmVmb3JlIGVhY2ggdGVzdCwgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHQgY2xlYW51cC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2ZvY3VzXSAtIFdoZXRoZXIgdGhpcyB0ZXN0IGlzIGZvY3VzZWQuXG4gKiBAcHJvcGVydHkgeygpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBbZnVuY3Rpb25dIC0gVGVzdCBjYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbcmV0cnldIC0gTnVtYmVyIG9mIHJldHJpZXMgd2hlbiBhIHRlc3QgZmFpbHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdIHwgc3RyaW5nfSBbdGFnc10gLSBUYWdzIGZvciBmaWx0ZXJpbmcuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3RpbWVvdXRTZWNvbmRzXSAtIFRpbWVvdXQgaW4gc2Vjb25kcyBmb3IgdGhlIHRlc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3R5cGVdIC0gVGVzdCB0eXBlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHRlbmFudDogb2JqZWN0fSkgPT4gUHJvbWlzZTx2b2lkPn0gW3JlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudF0gLSBSZWdpc3RlcnMgb25lIHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSB0cmFuc2FjdGlvbiBmb3IgdGhpcyBhdHRlbXB0LlxuICovXG4vKipcbiAqIEJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQXR0ZW1wdC1vd25lZCBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIENvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3F1YXJhbnRpbmVQcm9taXNlXSAtIFNoYXJlZCBjb25uZWN0aW9uLWRpc2NhcmQgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcXVhcmFudGluZWQgLSBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIGlzIHVuc2FmZSB0byByZXVzZS5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3JvbGxiYWNrUHJvbWlzZV0gLSBTaGFyZWQgcm9sbGJhY2sgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3N0YXJ0UHJvbWlzZV0gLSBUcmFuc2FjdGlvbiBzdGFydHVwIHByb21pc2Ugd2hlbiB0cmFuc2FjdGlvbiBjbGVhbmluZyBpcyBlbmFibGVkLlxuICovXG4vKipcbiAqIFRlc3REYXRhIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0RGF0YVxuICogQHByb3BlcnR5IHtUZXN0QXJnc30gYXJncyAtIEFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlIHRlc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7KGFyZzogVGVzdEFyZ3MpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBmdW5jdGlvbiAtIFRlc3QgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqL1xuLyoqXG4gKiBGYWlsZWRUZXN0RGV0YWlsIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGYWlsZWRUZXN0RGV0YWlsXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZnVsbERlc2NyaXB0aW9uIC0gRnVsbCB0ZXN0IGRlc2NyaXB0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRmFpbHVyZSBlcnJvci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uc29sZU91dHB1dF0gLSBDYXB0dXJlZCBjb25zb2xlIG91dHB1dCB3aGlsZSB0ZXN0IHJhbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uc29sZUxvZ1BhdGhdIC0gU2F2ZWQgY29uc29sZSBsb2cgcGF0aC5cbiAqL1xuLyoqXG4gKiBBY3RpdmVBZnRlckFsbFNjb3BlRW50cnkgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFjdGl2ZUFmdGVyQWxsU2NvcGVFbnRyeVxuICogQHByb3BlcnR5IHtUZXN0c0FyZ3VtZW50fSB0ZXN0cyAtIFNjb3BlIHRlc3QgdHJlZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gYWZ0ZXJBbGxzUnVuIC0gV2hldGhlciBjbGVhbnVwIGhvb2tzIGhhdmUgcnVuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtwcm9maWxlU2NvcGVJZF0gLSBPcGFxdWUgcHJvZmlsZSBzY29wZSBpZGVudGlmaWVyLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCB0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0pID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBBZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gSG9vayBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIEhvb2sgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGluZGV4IHdpdGhpbiBpdHMgZGVjbGFyYXRpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RlY2xhcmF0aW9uU2NvcGVJZF0gLSBPcGFxdWUgcHJvZmlsZSBzY29wZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqL1xuLyoqXG4gKiBUZXN0c0FyZ3VtZW50IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0c0FyZ3VtZW50XG4gKiBAcHJvcGVydHkge1Rlc3RBcmdzfSBhcmdzIC0gQXJndW1lbnRzIGluaGVyaXRlZCBieSB0ZXN0cyBpbiB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbYW55VGVzdHNGb2N1c3NlZF0gLSBXaGV0aGVyIGFueSB0ZXN0cyBpbiB0aGUgdHJlZSBhcmUgZm9jdXNlZC5cbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGFmdGVyRWFjaGVzIC0gQWZ0ZXItZWFjaCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVbXX0gYWZ0ZXJBbGxzIC0gQWZ0ZXItYWxsIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBiZWZvcmVBbGxzIC0gQmVmb3JlLWFsbCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGJlZm9yZUVhY2hlcyAtIEJlZm9yZS1lYWNoIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFRlc3REYXRhPn0gdGVzdHMgLSBBIHVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgbm9kZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgVGVzdHNBcmd1bWVudD59IHN1YnMgLSBPcHRpb25hbCBjaGlsZCBub2Rlcy4gRWFjaCBpdGVtIGlzIGFub3RoZXIgYE5vZGVgLCBhbGxvd2luZyByZWN1cnNpb24uXG4gKi9cbi8qKlxuICogTWFya3MgdGhlIGVycm9yIHRocm93biBieSB7QGxpbmsgcnVuV2l0aFRpbWVvdXR9IHNvIHRoZSBjYWxsZXIgY2FuIHRlbGwgYVxuICogbGlmZWN5Y2xlIHRpbWVvdXQgKHRoZSBwcm9taXNlIGlzIHN0aWxsIHJ1bm5pbmcgZGV0YWNoZWQpIGFwYXJ0IGZyb20gYW5cbiAqIG9yZGluYXJ5IHRlc3QgZmFpbHVyZSAodGhlIHByb21pc2UgYWxyZWFkeSBzZXR0bGVkKS5cbiAqIEB0eXBlZGVmIHtFcnJvciAmIHt2ZWxvY2lvdXNUZXN0VGltZW91dD86IHRydWV9fSBUZXN0VGltZW91dEVycm9yXG4gKi9cbi8qKlxuICogU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyfSBicm9rZXIgLSBBdHRlbXB0IGJyb2tlciBhbmQgY29ubmVjdGlvbiBjb29yZGluYXRvci5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gZW52aXJvbm1lbnRQdWJsaXNoZWQgLSBXaGV0aGVyIGNoaWxkLXByb2Nlc3MgY29vcmRpbmF0ZXMgd2VyZSBwdWJsaXNoZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gcHJldmlvdXNFbnZpcm9ubWVudCAtIEVudmlyb25tZW50IHZhbHVlIHRvIHJlc3RvcmUgYWZ0ZXIgcHVibGljYXRpb24uXG4gKi9cbi8qKlxuICogVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtQcm9taXNlPHtjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgZXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkfT4gfCB1bmRlZmluZWR9IFtjaGVja291dFByb21pc2VdIC0gQXR0ZW1wdC1vd25lZCBwaHlzaWNhbCBjaGVja291dCBvdXRjb21lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29ubmVjdGlvbiAtIEF0dGVtcHQtb3duZWQgcGh5c2ljYWwgY29ubmVjdGlvbiBvbmNlIGNoZWNrb3V0IHJlc29sdmVzLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSBbY2xlYW51cFByb21pc2VdIC0gU2luZ2xlIGNsZWFudXAgb3BlcmF0aW9uIHNoYXJlZCBieSBlbWVyZ2VuY3kgYW5kIGV2ZW50dWFsIGxpZmVjeWNsZSBjbGVhbnVwLlxuICogQHByb3BlcnR5IHtib29sZWFuIHwgdW5kZWZpbmVkfSBbZGlzY2FyZE9uQ2xlYW51cF0gLSBXaGV0aGVyIHRpbWVvdXQgZW1lcmdlbmN5IGNsZWFudXAgbXVzdCBxdWFyYW50aW5lIHRoaXMgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IHBvb2wgLSBPd25pbmcgbG9naWNhbCBwb29sLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZXZva2VkIC0gV2hldGhlciB0aGlzIGF0dGVtcHQgbWF5IHN0aWxsIHB1Ymxpc2ggdGhlIHBoeXNpY2FsIHJlZ2lzdHJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXVzZUtleSAtIFJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24gaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gc2hhcmVkUmVnaXN0cmF0aW9uIC0gUGh5c2ljYWwta2V5IHNoYXJlZCByZWdpc3RyYXRpb24gb25jZSBwdWJsaXNoZWQuXG4gKi9cblxuLyoqXG4gKiBSdW5zIHJ1biB3aXRoIHRpbWVvdXQuXG4gKlxuICogT24gdGltZW91dCB0aGUgd3JhcHBlZCBgcHJvbWlzZWAgaXMgTk9UIGNhbmNlbGxlZCDigJQgaXQga2VlcHMgcnVubmluZyBkZXRhY2hlZC5cbiAqIFRoZSByZWplY3RlZCBlcnJvciBpcyB0YWdnZWQgd2l0aCBgdmVsb2Npb3VzVGVzdFRpbWVvdXRgIHNvIHRoZSBydW5uZXIga25vd3NcbiAqIHRoZSBsaWZlY3ljbGUgKGFuZCBpdHMgYWZ0ZXJFYWNoIGRhdGFiYXNlIGNsZWFudXApIGlzIHN0aWxsIGluIGZsaWdodCBhbmQgY2FuXG4gKiB3YWl0IGZvciBpdCB0byBzZXR0bGUgYmVmb3JlIHRoZSBuZXh0IHRlc3QgcmV1c2VzIHRoZSBzaGFyZWQgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcHJvbWlzZSAtIFByb21pc2Ugb3IgdmFsdWUuXG4gKiBAcGFyYW0ge251bWJlcn0gdGltZW91dE1zIC0gVGltZW91dCBpbiBtaWxsaXNlY29uZHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gdGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyBvciByZWplY3RzIGJhc2VkIG9uIHRpbWVvdXQgb3IgcHJvbWlzZSByZXN1bHQuXG4gKi9cbmZ1bmN0aW9uIHJ1bldpdGhUaW1lb3V0KHByb21pc2UsIHRpbWVvdXRNcywgdGVzdERlc2NyaXB0aW9uKSB7XG4gIGNvbnN0IHRpbWVvdXRTZWNvbmRzID0gKHRpbWVvdXRNcyAvIDEwMDApLnRvRml4ZWQoMykucmVwbGFjZSgvXFwuPzArJC8sIFwiXCIpXG4gIC8qKiBAdHlwZSB7VGVzdFRpbWVvdXRFcnJvcn0gKi9cbiAgY29uc3QgdGltZW91dEVycm9yID0gbmV3IEVycm9yKGBUaW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U2Vjb25kc31zOiAke3Rlc3REZXNjcmlwdGlvbn1gKVxuICB0aW1lb3V0RXJyb3IudmVsb2Npb3VzVGVzdFRpbWVvdXQgPSB0cnVlXG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiByZWplY3QodGltZW91dEVycm9yKSwgdGltZW91dE1zKVxuXG4gICAgUHJvbWlzZS5yZXNvbHZlKHByb21pc2UpLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpXG4gICAgICByZXNvbHZlKHJlc3VsdClcbiAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KVxuICAgICAgcmVqZWN0KGVycm9yKVxuICAgIH0pXG4gIH0pXG59XG5cbi8qKlxuICogV2FpdHMgZm9yIGFuIGFiYW5kb25lZCAodGltZWQtb3V0KSB0ZXN0IGxpZmVjeWNsZSB0byBzZXR0bGUsIGJvdW5kZWQgYnkgYVxuICogZ3JhY2UgcGVyaW9kLCBzbyBpdHMgYWZ0ZXJFYWNoIGRhdGFiYXNlIGNsZWFudXAgcnVucyBvbiB0aGUgc2hhcmVkIGNvbm5lY3Rpb25cbiAqIGJlZm9yZSB0aGUgbmV4dCB0ZXN0IHJldXNlcyBpdC4gUmV0dXJucyB0aGUgZnVsZmlsbG1lbnQvcmVqZWN0aW9uIG91dGNvbWUgaWZcbiAqIHRoZSBsaWZlY3ljbGUgc2V0dGxlcywgb3IgYSBwZW5kaW5nIG91dGNvbWUgb25jZSB0aGUgZ3JhY2UgZWxhcHNlcy5cbiAqXG4gKiBUaGUgZ3JhY2UgdGltZXIgaXMga2VwdCByZWYnZCBzbyBpdCBjYW5ub3QgbGV0IE5vZGUgZXhpdCB3aXRoIGFuIHVuc2V0dGxlZFxuICogdG9wLWxldmVsIGF3YWl0IHdoZW4gdGhlIHRpbWVkLW91dCBsaWZlY3ljbGUgaGFzIG5vIHJlZidkIGhhbmRsZXMgb2YgaXRzIG93blxuICogKGZvciBleGFtcGxlIGEgc3RhbGxlZCBtb2NrZWQgYXN5bmMgQVBJKS4gT25jZSB0aGUgY2FsbGVyIGNvbnRpbnVlcyBwYXN0IHRoaXNcbiAqIGF3YWl0LCB0aGUgdGltZXIgaGFzIGFscmVhZHkgcmVzb2x2ZWQgYW5kIG5vIGxvbmdlciBhbmNob3JzIHRoZSBldmVudCBsb29wLlxuICogQHBhcmFtIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbGlmZWN5Y2xlIC0gVGhlIGFiYW5kb25lZCBwZXItdGVzdCBsaWZlY3ljbGUgcHJvbWlzZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBncmFjZU1zIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIHRoZSBsaWZlY3ljbGUgdG8gc2V0dGxlLlxuICogQHJldHVybnMge1Byb21pc2U8e3NldHRsZWQ6IGZhbHNlfSB8IHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwiZnVsZmlsbGVkXCJ9IHwge3NldHRsZWQ6IHRydWUsIHN0YXR1czogXCJyZWplY3RlZFwiLCByZWFzb246IHVua25vd259Pn0gLSBTZXR0bGVtZW50IG91dGNvbWUuXG4gKi9cbmZ1bmN0aW9uIGF3YWl0U2V0dGxlZE9yR3JhY2UobGlmZWN5Y2xlLCBncmFjZU1zKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGxldCBzZXR0bGVkID0gZmFsc2VcbiAgICBjb25zdCBncmFjZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuXG5cbiAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICByZXNvbHZlKHtzZXR0bGVkOiBmYWxzZX0pXG4gICAgfSwgZ3JhY2VNcylcblxuICAgIFByb21pc2UucmVzb2x2ZShsaWZlY3ljbGUpLnRoZW4oXG4gICAgICAoKSA9PiB7XG4gICAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cblxuICAgICAgICBzZXR0bGVkID0gdHJ1ZVxuICAgICAgICBjbGVhclRpbWVvdXQoZ3JhY2VUaW1lcilcbiAgICAgICAgcmVzb2x2ZSh7c2V0dGxlZDogdHJ1ZSwgc3RhdHVzOiBcImZ1bGZpbGxlZFwifSlcbiAgICAgIH0sXG4gICAgICAocmVhc29uKSA9PiB7XG4gICAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cblxuICAgICAgICBzZXR0bGVkID0gdHJ1ZVxuICAgICAgICBjbGVhclRpbWVvdXQoZ3JhY2VUaW1lcilcbiAgICAgICAgcmVzb2x2ZSh7c2V0dGxlZDogdHJ1ZSwgc3RhdHVzOiBcInJlamVjdGVkXCIsIHJlYXNvbn0pXG4gICAgICB9XG4gICAgKVxuICB9KVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGEgbGF0ZSBsaWZlY3ljbGUgc3RvcHBlZCBvbmx5IGJlY2F1c2UgaXRzIHRlc3QgYWNjZXNzIHdhcyByZXZva2VkLlxuICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIExpZmVjeWNsZSByZWplY3Rpb24uXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGV2ZXJ5IGNvbnRhaW5lZCBlcnJvciBpcyBleHBlY3RlZCByZXZvY2F0aW9uLlxuICovXG5mdW5jdGlvbiBpc1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9jYXRpb24oZXJyb3IpIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVGVzdERhdGFiYXNlQWNjZXNzUmV2b2tlZEVycm9yKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgIHJldHVybiBlcnJvci5lcnJvcnMubGVuZ3RoID4gMCAmJiBlcnJvci5lcnJvcnMuZXZlcnkoKG5lc3RlZEVycm9yKSA9PiBpc1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9jYXRpb24obmVzdGVkRXJyb3IpKVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogQ2FwdHVyZWQgY29uc29sZSBtZXRob2RzLlxuICogQHR5cGUge0NvbnNvbGVNZXRob2ROYW1lW119ICovXG5jb25zdCBDQVBUVVJFRF9DT05TT0xFX01FVEhPRFMgPSBbXCJsb2dcIiwgXCJpbmZvXCIsIFwid2FyblwiLCBcImVycm9yXCIsIFwiZGVidWdcIl1cblxuLyoqXG4gKiBSdW5zIHRvIGZpbGUgc2x1Zy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIHNhbml0aXplLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTbHVnLXNhZmUgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHRvRmlsZVNsdWcodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAucmVwbGFjZSgvW15hLXowLTldKy9nLCBcIi1cIilcbiAgICAucmVwbGFjZSgvXi0rfC0rJC9nLCBcIlwiKVxuICAgIC5zbGljZSgwLCA4MCkgfHwgXCJmYWlsZWQtdGVzdFwiXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RSdW5uZXIge1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7QWN0aXZlQWZ0ZXJBbGxTY29wZUVudHJ5W119ICovXG4gIF9hY3RpdmVBZnRlckFsbFNjb3Blc1xuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtGYWlsZWRUZXN0RGV0YWlsW119ICovXG4gIF9mYWlsZWRUZXN0RGV0YWlsc1xuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuZXhjbHVkZVRhZ3NdIC0gVGFncyB0byBleGNsdWRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nfSBbYXJncy5pbmNsdWRlVGFnc10gLSBUYWdzIHRvIGluY2x1ZGUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gYXJncy50ZXN0RmlsZXMgLSBUZXN0IGZpbGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gW2FyZ3MubGluZUZpbHRlcnNdIC0gTGluZSBmaWx0ZXJzIGJ5IGZpbGUuXG4gICAqIEBwYXJhbSB7UmVnRXhwW119IFthcmdzLmV4YW1wbGVQYXR0ZXJuc10gLSBFeGFtcGxlIHBhdHRlcm5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1wcm9maWxlci5qc1wiKS5kZWZhdWx0fSBbYXJncy5wcm9maWxlcl0gLSBPcHQtaW4gcHJvZmlsZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZXhjbHVkZVRhZ3MsIGluY2x1ZGVUYWdzLCB0ZXN0RmlsZXMsIGxpbmVGaWx0ZXJzLCBleGFtcGxlUGF0dGVybnMsIHByb2ZpbGVyLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkXCIpXG5cbiAgICB0aGlzLl9jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2UoKVxuICAgIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG4gICAgdGhpcy5fZXhjbHVkZVRhZ3MgPSB0aGlzLm5vcm1hbGl6ZVRhZ3MoZXhjbHVkZVRhZ3MpXG4gICAgdGhpcy5fZXhjbHVkZVRhZ1NldCA9IG5ldyBTZXQodGhpcy5fZXhjbHVkZVRhZ3MpXG4gICAgdGhpcy5faW5jbHVkZVRhZ3MgPSB0aGlzLm5vcm1hbGl6ZVRhZ3MoaW5jbHVkZVRhZ3MpXG4gICAgdGhpcy5faW5jbHVkZVRhZ1NldCA9IG5ldyBTZXQodGhpcy5faW5jbHVkZVRhZ3MpXG4gICAgdGhpcy5fdGVzdEZpbGVzID0gdGVzdEZpbGVzXG4gICAgdGhpcy5fbGluZUZpbHRlcnMgPSBsaW5lRmlsdGVycyB8fCB7fVxuICAgIHRoaXMuX2V4YW1wbGVQYXR0ZXJucyA9IGV4YW1wbGVQYXR0ZXJucyB8fCBbXVxuICAgIHRoaXMuX3Byb2ZpbGVyID0gcHJvZmlsZXJcbiAgICB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gZmFsc2VcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gMFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2FjdGl2ZUFmdGVyQWxsU2NvcGVzID0gW11cbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscyA9IFtdXG4gICAgLyoqIEB0eXBlIHt7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlcn0gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xhc3RUZXN0Q29udGV4dCA9IG51bGxcbiAgICAvKiogQHR5cGUge0FycmF5PHtmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyLCBkdXJhdGlvbk1zOiBudW1iZXJ9Pn0gKi9cbiAgICB0aGlzLl90ZXN0RHVyYXRpb25zID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0Q29uZmlndXJhdGlvbigpIHsgcmV0dXJuIHRoaXMuX2NvbmZpZ3VyYXRpb24gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIHRlc3QgZmlsZXMuXG4gICAqL1xuICBnZXRUZXN0RmlsZXMoKSB7IHJldHVybiB0aGlzLl90ZXN0RmlsZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsaW5lIGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT59IC0gTGluZSBmaWx0ZXJzLlxuICAgKi9cbiAgZ2V0TGluZUZpbHRlcnMoKSB7IHJldHVybiB0aGlzLl9saW5lRmlsdGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4YW1wbGUgcGF0dGVybnMuXG4gICAqIEByZXR1cm5zIHtSZWdFeHBbXX0gLSBFeGFtcGxlIHBhdHRlcm5zLlxuICAgKi9cbiAgZ2V0RXhhbXBsZVBhdHRlcm5zKCkgeyByZXR1cm4gdGhpcy5fZXhhbXBsZVBhdHRlcm5zIH1cblxuICAvKipcbiAgICogUnVucyBhIHByb2ZpbGVyIHNwYW4gb25seSB3aGVuIHByb2ZpbGluZyB3YXMgZXhwbGljaXRseSBlbmFibGVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gbWV0YWRhdGEgLSBTcGFuIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGEucGhhc2UgLSBQaGFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW21ldGFkYXRhLmRlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBkZWNsYXJhdGlvbiBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXRhZGF0YS5kZWNsYXJhdGlvblNjb3BlSWRdIC0gSG9vayBkZWNsYXJhdGlvbiBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXRhZGF0YS5maWxlUGF0aF0gLSBTb3VyY2Ugb3duZXJzaGlwLlxuICAgKiBAcGFyYW0geygpID0+IChUIHwgUHJvbWlzZTxUPil9IGNhbGxiYWNrIC0gVGltZWQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1blByb2ZpbGVTcGFuKG1ldGFkYXRhLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fcHJvZmlsZXIpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcHJvZmlsZXIucnVuU3BhbihtZXRhZGF0YSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBkZWNsYXJhdGlvbiBtZXRhZGF0YSB0byBob29rcyBvbmx5IGZvciBhbiBhY3RpdmUgcHJvZmlsZS5cbiAgICogQHRlbXBsYXRlIHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGUgfCBCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZX0gVFxuICAgKiBAcGFyYW0ge1RbXX0gaG9va3MgLSBIb29rcyBkZWNsYXJlZCBpbiBvbmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBkZWNsYXJhdGlvblNjb3BlSWQgLSBQcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBvd25lckZpbGVQYXRoIC0gU2NvcGUgb3duZXIgZmlsZS5cbiAgICogQHJldHVybnMge1RbXX0gLSBQcm9maWxlLWF3YXJlIGhvb2sgZW50cmllcy5cbiAgICovXG4gIHByb2ZpbGVIb29rRW50cmllcyhob29rcywgZGVjbGFyYXRpb25TY29wZUlkLCBvd25lckZpbGVQYXRoKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9maWxlcikgcmV0dXJuIGhvb2tzXG5cbiAgICByZXR1cm4gaG9va3MubWFwKChob29rLCBkZWNsYXJhdGlvbkluZGV4KSA9PiBPYmplY3QuYXNzaWduKHt9LCBob29rLCB7XG4gICAgICBkZWNsYXJhdGlvbkluZGV4OiBob29rLmRlY2xhcmF0aW9uSW5kZXggPz8gZGVjbGFyYXRpb25JbmRleCxcbiAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogaG9vay5kZWNsYXJhdGlvblNjb3BlSWQgPz8gZGVjbGFyYXRpb25TY29wZUlkLFxuICAgICAgb3duZXJGaWxlUGF0aDogaG9vay5vd25lckZpbGVQYXRoID8/IG93bmVyRmlsZVBhdGhcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSB0YWdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nIHwgdW5kZWZpbmVkfSB0YWdzIC0gVGFncy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vcm1hbGl6ZWQgdGFncy5cbiAgICovXG4gIG5vcm1hbGl6ZVRhZ3ModGFncykge1xuICAgIGlmICghdGFncykgcmV0dXJuIFtdXG5cbiAgICBjb25zdCB2YWx1ZXMgPSBbXVxuICAgIGNvbnN0IHJhd1RhZ3MgPSBBcnJheS5pc0FycmF5KHRhZ3MpID8gdGFncyA6IFt0YWdzXVxuXG4gICAgZm9yIChjb25zdCByYXdUYWcgb2YgcmF3VGFncykge1xuICAgICAgaWYgKHJhd1RhZyA9PT0gdW5kZWZpbmVkIHx8IHJhd1RhZyA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY29uc3QgcGFydHMgPSBTdHJpbmcocmF3VGFnKS5zcGxpdChcIixcIilcblxuICAgICAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgICAgIGNvbnN0IHRyaW1tZWQgPSBwYXJ0LnRyaW0oKVxuXG4gICAgICAgIGlmICh0cmltbWVkKSB2YWx1ZXMucHVzaCh0cmltbWVkKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5mcm9tKG5ldyBTZXQodmFsdWVzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyB0YWcuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFnIC0gVGFnIHRvIGNoZWNrIGZvci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0YWcgaXMgcHJlc2VudC5cbiAgICovXG4gIGhhc1RhZyh0ZXN0QXJncywgdGFnKSB7XG4gICAgcmV0dXJuIHRoaXMubm9ybWFsaXplVGFncyh0ZXN0QXJncz8udGFncykuaW5jbHVkZXModGFnKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgYnJvd3NlciB0ZXN0IG1vZGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcnVubmluZyBicm93c2VyIHRlc3RzLlxuICAgKi9cbiAgaXNCcm93c2VyVGVzdE1vZGUoKSB7XG4gICAgcmV0dXJuIHByb2Nlc3MuZW52LlZFTE9DSU9VU19CUk9XU0VSX1RFU1RTID09PSBcInRydWVcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggZHVtbXkgaWYgbmVlZGVkLlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IFticm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uc10gLSBBdHRlbXB0LW93bmVkIGJyb3dzZXIgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5XaXRoRHVtbXlJZk5lZWRlZCh0ZXN0QXJncywgY2FsbGJhY2ssIGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW10pIHtcbiAgICBpZiAoIXRoaXMuaGFzVGFnKHRlc3RBcmdzLCBcImR1bW15XCIpKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc0Jyb3dzZXJUZXN0TW9kZSgpKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJyb3dzZXJEdW1teSh0ZXN0QXJncywgY2FsbGJhY2ssIGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW5Ob2RlRHVtbXkoY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gbm9kZSBkdW1teS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bk5vZGVEdW1teShjYWxsYmFjaykge1xuICAgIGNvbnN0IGR1bW15UGF0aCA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19EVU1NWV9QQVRIIHx8IHRoaXMuZGVmYXVsdER1bW15UGF0aCgpXG4gICAgY29uc3QgZHVtbXlJbXBvcnQgPSBhd2FpdCBpbXBvcnQocGF0aFRvRmlsZVVSTChkdW1teVBhdGgpLmhyZWYpXG4gICAgY29uc3QgRHVtbXkgPSBkdW1teUltcG9ydC5kZWZhdWx0XG5cbiAgICBpZiAoIUR1bW15Py5ydW4pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRHVtbXkgaGVscGVyIG5vdCBmb3VuZCBhdCAke2R1bW15UGF0aH1gKVxuICAgIH1cblxuICAgIC8vIFBlcnNpc3RlbnQgc2VydmVyIHJlc291cmNlcyBtdXN0IG5vdCBpbmhlcml0IGFuIGF0dGVtcHQgc2NvcGUgdGhhdCB3aWxsIGJlIHJldm9rZWQuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aENhcHR1cmVkVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUodW5kZWZpbmVkLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBEdW1teS5ydW4oYXN5bmMgKCkgPT4ge30pXG4gICAgfSlcbiAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmF1bHQgZHVtbXkgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZWZhdWx0IGR1bW15IGhlbHBlciBwYXRoLlxuICAgKi9cbiAgZGVmYXVsdER1bW15UGF0aCgpIHtcbiAgICBjb25zdCBjd2QgPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSlcbiAgICBjb25zdCBub3JtYWxpemVkID0gY3dkLnNwbGl0KHBhdGguc2VwKS5qb2luKFwiL1wiKVxuXG4gICAgaWYgKG5vcm1hbGl6ZWQuZW5kc1dpdGgoXCIvc3BlYy9kdW1teVwiKSkge1xuICAgICAgcmV0dXJuIHBhdGguam9pbihjd2QsIFwiaW5kZXguanNcIilcbiAgICB9XG5cbiAgICByZXR1cm4gcGF0aC5qb2luKGN3ZCwgXCJzcGVjL2R1bW15L2luZGV4LmpzXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gYnJvd3NlciBkdW1teS5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSBjb25uZWN0aW9uUmVnaXN0cmF0aW9ucyAtIEF0dGVtcHQtb3duZWQgYnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bkJyb3dzZXJEdW1teSh0ZXN0QXJncywgY2FsbGJhY2ssIGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKSB7XG4gICAgY29uc3QgdXNlVHJhbnNhY3Rpb24gPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cmFuc2FjdGlvbiA9PT0gdHJ1ZVxuICAgIGNvbnN0IHRydW5jYXRlID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJ1bmNhdGVcbiAgICBjb25zdCBzaG91bGRUcnVuY2F0ZSA9IHRydW5jYXRlID09PSB1bmRlZmluZWQgPyAhdXNlVHJhbnNhY3Rpb24gOiB0cnVuY2F0ZVxuXG4gICAgaWYgKCF1c2VUcmFuc2FjdGlvbiAmJiAhc2hvdWxkVHJ1bmNhdGUpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIlRlc3QgcnVubmVyIGJyb3dzZXIgZHVtbXlcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IG5ld1JlZ2lzdHJhdGlvbnMgPSBPYmplY3QuZW50cmllcyhkYnMpLm1hcCgoW2RhdGFiYXNlSWRlbnRpZmllciwgZGJdKSA9PiB7XG4gICAgICAgIC8qKiBAdHlwZSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gKi9cbiAgICAgICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge1xuICAgICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgICBkYixcbiAgICAgICAgICBxdWFyYW50aW5lZDogZmFsc2VcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zLnB1c2gocmVnaXN0cmF0aW9uKVxuXG4gICAgICAgIHJldHVybiByZWdpc3RyYXRpb25cbiAgICAgIH0pXG5cbiAgICAgIGlmIChzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICBhd2FpdCB0aGlzLnRydW5jYXRlRGF0YWJhc2VzKGRicylcbiAgICAgIH1cbiAgICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgICAgY29uc3QgbGlmZWN5Y2xlRXJyb3JzID0gW11cblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHVzZVRyYW5zYWN0aW9uKSB7XG4gICAgICAgICAgY29uc3Qgc3RhcnRQcm9taXNlcyA9IG5ld1JlZ2lzdHJhdGlvbnMubWFwKChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0UHJvbWlzZSA9IHJlZ2lzdHJhdGlvbi5kYi5zdGFydFRyYW5zYWN0aW9uKClcblxuICAgICAgICAgICAgcmVnaXN0cmF0aW9uLnN0YXJ0UHJvbWlzZSA9IHN0YXJ0UHJvbWlzZVxuICAgICAgICAgICAgcmV0dXJuIHN0YXJ0UHJvbWlzZVxuICAgICAgICAgIH0pXG4gICAgICAgICAgY29uc3Qgc3RhcnRSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHN0YXJ0UHJvbWlzZXMpXG4gICAgICAgICAgY29uc3Qgc3RhcnRFcnJvcnMgPSBzdGFydFJlc3VsdHNcbiAgICAgICAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgICAgICAgaWYgKHN0YXJ0RXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBzdGFydEVycm9yc1swXVxuICAgICAgICAgIGlmIChzdGFydEVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3Ioc3RhcnRFcnJvcnMsIFwiQnJvd3NlciBkdW1teSB0cmFuc2FjdGlvbiBzdGFydHVwIGZhaWxlZFwiLCB7Y2F1c2U6IHN0YXJ0RXJyb3JzWzBdfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja0Jyb3dzZXJEdW1teVRyYW5zYWN0aW9ucyhjb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEFnZ3JlZ2F0ZUVycm9yKSB7XG4gICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goLi4uZXJyb3IuZXJyb3JzKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgICAgYXdhaXQgdGhpcy50cnVuY2F0ZURhdGFiYXNlcyhkYnMpXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBsaWZlY3ljbGVFcnJvcnNbMF1cbiAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID4gMSkge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IobGlmZWN5Y2xlRXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgbGlmZWN5Y2xlIGFuZCBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGxpZmVjeWNsZUVycm9yc1swXX0pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSb2xscyBiYWNrIGV2ZXJ5IGF0dGVtcHQtb3duZWQgYnJvd3NlciB0cmFuc2FjdGlvbiBleGFjdGx5IG9uY2UuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIHJvbGxiYWNrcyBzZXR0bGUuXG4gICAqL1xuICBhc3luYyByb2xsYmFja0Jyb3dzZXJEdW1teVRyYW5zYWN0aW9ucyhyZWdpc3RyYXRpb25zKSB7XG4gICAgY29uc3Qgcm9sbGJhY2tSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5yZWdpc3RyYXRpb25zXS5yZXZlcnNlKCkubWFwKChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHN0YXJ0UHJvbWlzZSA9IHJlZ2lzdHJhdGlvbi5zdGFydFByb21pc2VcblxuICAgICAgaWYgKCFzdGFydFByb21pc2UpIHJldHVyblxuXG4gICAgICByZWdpc3RyYXRpb24ucm9sbGJhY2tQcm9taXNlID8/PSAoYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAocmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkKSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHN0YXJ0UHJvbWlzZVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICAgICAgfSBjYXRjaCAocXVhcmFudGluZUVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBxdWFyYW50aW5lIGJyb3dzZXIgZHVtbXkgZGF0YWJhc2UgYWZ0ZXIgdHJhbnNhY3Rpb24gc3RhcnR1cCBmYWlsZWQ6ICR7cmVnaXN0cmF0aW9uLmRhdGFiYXNlSWRlbnRpZmllcn1gLCB7Y2F1c2U6IHF1YXJhbnRpbmVFcnJvcn0pXG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24ucXVhcmFudGluZWQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLmRiLnJvbGxiYWNrVHJhbnNhY3Rpb24oKVxuICAgICAgICB9IGNhdGNoIChyb2xsYmFja0Vycm9yKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgICAgICAgIH0gY2F0Y2ggKHF1YXJhbnRpbmVFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgICBbcm9sbGJhY2tFcnJvciwgcXVhcmFudGluZUVycm9yXSxcbiAgICAgICAgICAgICAgYEZhaWxlZCB0byByb2xsIGJhY2sgYW5kIHF1YXJhbnRpbmUgYnJvd3NlciBkdW1teSBkYXRhYmFzZTogJHtyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyfWAsXG4gICAgICAgICAgICAgIHtjYXVzZTogcXVhcmFudGluZUVycm9yfVxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyByb2xsYmFja0Vycm9yXG4gICAgICAgIH1cbiAgICAgIH0pKClcblxuICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvbi5yb2xsYmFja1Byb21pc2VcbiAgICB9KSlcbiAgICBjb25zdCBlcnJvcnMgPSByb2xsYmFja1Jlc3VsdHNcbiAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgdHJhbnNhY3Rpb24gY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcm1hbmVudGx5IHJlbW92ZXMgb25lIGJyb3dzZXIgY29ubmVjdGlvbiB0aGF0IGNhbm5vdCBiZSBzaGFyZWQgc2FmZWx5LlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb259IHJlZ2lzdHJhdGlvbiAtIEJyb3dzZXIgY29ubmVjdGlvbiByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBjb25uZWN0aW9uIGlzIGRpc2NhcmRlZC5cbiAgICovXG4gIGFzeW5jIHF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbikge1xuICAgIHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCA9IHRydWVcbiAgICByZWdpc3RyYXRpb24ucXVhcmFudGluZVByb21pc2UgPz89IHRoaXMuZGlzY2FyZEJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uLmRhdGFiYXNlSWRlbnRpZmllciwgcmVnaXN0cmF0aW9uLmRiKVxuICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIERpc2NhcmRzIG9uZSBicm93c2VyIGR1bW15IGNvbm5lY3Rpb24gdGhyb3VnaCBpdHMgb3duaW5nIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBDb25maWd1cmVkIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVW5zYWZlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGRpc2NhcmQuXG4gICAqL1xuICBhc3luYyBkaXNjYXJkQnJvd3NlckR1bW15Q29ubmVjdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIGRiKSB7XG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcikuZGlzY2FyZChkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWFyYW50aW5lcyBhbGwgYnJvd3NlciBjb25uZWN0aW9ucyBjb25jdXJyZW50bHkuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQnJvd3NlciBjb25uZWN0aW9uIHJlZ2lzdHJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGNvbm5lY3Rpb24gaXMgZGlzY2FyZGVkLlxuICAgKi9cbiAgYXN5bmMgcXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCBxdWFyYW50aW5lUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChyZWdpc3RyYXRpb25zLm1hcChhc3luYyAocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICB9KSlcbiAgICBjb25zdCBlcnJvcnMgPSBxdWFyYW50aW5lUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiQnJvd3NlciBkdW1teSBjb25uZWN0aW9uIHF1YXJhbnRpbmUgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3JzWzBdfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRydW5jYXRlIGRhdGFiYXNlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGRicyAtIERhdGFiYXNlIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVEYXRhYmFzZXMoZGJzKSB7XG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKGRicykpIHtcbiAgICAgIGF3YWl0IGRic1tpZGVudGlmaWVyXS50cnVuY2F0ZUFsbFRhYmxlcygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4Y2x1ZGUgdGFnIHNldC5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIEV4Y2x1ZGUgdGFnIHNldC5cbiAgICovXG4gIGdldEV4Y2x1ZGVUYWdTZXQoKSB7XG4gICAgLyoqXG4gICAgICogQ29uZmlnIHRhZ3MuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGNvbmZpZ1RhZ3MgPSBBcnJheS5pc0FycmF5KHRlc3RDb25maWcuZXhjbHVkZVRhZ3MpID8gdGVzdENvbmZpZy5leGNsdWRlVGFncyA6IFtdXG5cbiAgICByZXR1cm4gbmV3IFNldChbLi4udGhpcy5fZXhjbHVkZVRhZ3MsIC4uLmNvbmZpZ1RhZ3NdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIG1hdGNoaW5nIHRhZy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZyB8IHVuZGVmaW5lZH0gdGVzdFRhZ3MgLSBUZXN0IHRhZ3MuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IHRhZ1NldCAtIFRhZyBzZXQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IHRhZ3MgbWF0Y2guXG4gICAqL1xuICBoYXNNYXRjaGluZ1RhZyh0ZXN0VGFncywgdGFnU2V0KSB7XG4gICAgaWYgKCF0YWdTZXQuc2l6ZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBub3JtYWxpemVkID0gdGhpcy5ub3JtYWxpemVUYWdzKHRlc3RUYWdzKVxuXG4gICAgZm9yIChjb25zdCB0YWcgb2Ygbm9ybWFsaXplZCkge1xuICAgICAgaWYgKHRhZ1NldC5oYXModGFnKSkgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBydW5uYWJsZSB0ZXN0cy5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSB0ZXN0cyAtIFRlc3RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbZGVzY3JpcHRpb25zXSAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtsaW5lTWF0Y2hlZEluU2NvcGVdIC0gV2hldGhlciBsaW5lIG1hdGNoZWQgaW4gc2NvcGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IHRlc3RzIGluIHRoaXMgc2NvcGUgd2lsbCBydW4uXG4gICAqL1xuICBoYXNSdW5uYWJsZVRlc3RzKHRlc3RzLCBkZXNjcmlwdGlvbnMgPSBbXSwgbGluZU1hdGNoZWRJblNjb3BlID0gZmFsc2UpIHtcbiAgICBmb3IgKGNvbnN0IHRlc3REZXNjcmlwdGlvbiBpbiB0ZXN0cy50ZXN0cykge1xuICAgICAgY29uc3QgdGVzdERhdGEgPSB0ZXN0cy50ZXN0c1t0ZXN0RGVzY3JpcHRpb25dXG4gICAgICBjb25zdCB0ZXN0QXJncyA9IC8qKiBAdHlwZSB7VGVzdEFyZ3N9ICovIChPYmplY3QuYXNzaWduKHt9LCB0ZXN0RGF0YS5hcmdzKSlcbiAgICAgIGNvbnN0IGluY2x1ZGVCeUxpbmUgPSBsaW5lTWF0Y2hlZEluU2NvcGUgfHwgdGhpcy5tYXRjaGVzTGluZUZpbHRlcih0ZXN0RGF0YSlcblxuICAgICAgaWYgKHRoaXMuX29ubHlGb2N1c3NlZCAmJiAhdGVzdEFyZ3MuZm9jdXMpIGNvbnRpbnVlXG4gICAgICBpZiAodGhpcy5zaG91bGRTa2lwVGVzdCh0ZXN0QXJncywgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbiwgZGVzY3JpcHRpb25zLCBpbmNsdWRlQnlMaW5lKSkgY29udGludWVcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHN1YkRlc2NyaXB0aW9uIGluIHRlc3RzLnN1YnMpIHtcbiAgICAgIGNvbnN0IHN1YlRlc3QgPSB0ZXN0cy5zdWJzW3N1YkRlc2NyaXB0aW9uXVxuICAgICAgY29uc3Qgc2NvcGVMaW5lTWF0Y2ggPSBsaW5lTWF0Y2hlZEluU2NvcGUgfHwgdGhpcy5tYXRjaGVzTGluZUZpbHRlcihzdWJUZXN0KVxuICAgICAgY29uc3QgbmV4dERlc2NyaXB0aW9ucyA9IGRlc2NyaXB0aW9ucy5jb25jYXQoW3N1YkRlc2NyaXB0aW9uXSlcblxuICAgICAgaWYgKHRoaXMuX29ubHlGb2N1c3NlZCAmJiAhc3ViVGVzdC5hbnlUZXN0c0ZvY3Vzc2VkKSBjb250aW51ZVxuICAgICAgaWYgKHRoaXMuaGFzUnVubmFibGVUZXN0cyhzdWJUZXN0LCBuZXh0RGVzY3JpcHRpb25zLCBzY29wZUxpbmVNYXRjaCkpIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgc2tpcCB0ZXN0LlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gdGVzdERhdGEgLSBUZXN0IGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtib29sZWFufSBsaW5lTWF0Y2hlZEluU2NvcGUgLSBXaGV0aGVyIGxpbmUgbWF0Y2hlZCBpbiBzY29wZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgdGVzdCBzaG91bGQgYmUgc2tpcHBlZC5cbiAgICovXG4gIHNob3VsZFNraXBUZXN0KHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9uLCBkZXNjcmlwdGlvbnMsIGxpbmVNYXRjaGVkSW5TY29wZSkge1xuICAgIGlmICh0aGlzLmhhc1RhZyh0ZXN0QXJncywgXCJicm93c2VyLW9ubHlcIikgJiYgIXRoaXMuaXNCcm93c2VyVGVzdE1vZGUoKSkgcmV0dXJuIHRydWVcbiAgICBpZiAodGhpcy5oYXNNYXRjaGluZ1RhZyh0ZXN0QXJncy50YWdzLCB0aGlzLmdldEV4Y2x1ZGVUYWdTZXQoKSkpIHJldHVybiB0cnVlXG5cbiAgICBpZiAodGhpcy5faW5jbHVkZVRhZ1NldC5zaXplID4gMCAmJiAhdGVzdEFyZ3MuZm9jdXMpIHtcbiAgICAgIGlmICghdGhpcy5oYXNNYXRjaGluZ1RhZyh0ZXN0QXJncy50YWdzLCB0aGlzLl9pbmNsdWRlVGFnU2V0KSkgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRFeGFtcGxlUGF0dGVybnMoKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBmdWxsRGVzY3JpcHRpb24gPSB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKVxuICAgICAgY29uc3QgbWF0Y2hlcyA9IHRoaXMuZ2V0RXhhbXBsZVBhdHRlcm5zKCkuc29tZSgocGF0dGVybikgPT4ge1xuICAgICAgICBwYXR0ZXJuLmxhc3RJbmRleCA9IDBcbiAgICAgICAgcmV0dXJuIHBhdHRlcm4udGVzdChmdWxsRGVzY3JpcHRpb24pXG4gICAgICB9KVxuXG4gICAgICBpZiAoIW1hdGNoZXMpIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgY29uc3QgbGluZUZpbHRlcnMgPSB0aGlzLmdldExpbmVGaWx0ZXJzKClcblxuICAgIGlmIChPYmplY3Qua2V5cyhsaW5lRmlsdGVycykubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKCFsaW5lTWF0Y2hlZEluU2NvcGUgJiYgIXRoaXMubWF0Y2hlc0xpbmVGaWx0ZXIodGVzdERhdGEpKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlcyBsaW5lIGZpbHRlci5cbiAgICogQHBhcmFtIHtUZXN0RGF0YSB8IFRlc3RzQXJndW1lbnR9IGVudHJ5IC0gVGVzdCBlbnRyeS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBsaW5lIGZpbHRlciBtYXRjaGVzIGVudHJ5LlxuICAgKi9cbiAgbWF0Y2hlc0xpbmVGaWx0ZXIoZW50cnkpIHtcbiAgICBpZiAoIWVudHJ5IHx8ICFlbnRyeS5maWxlUGF0aCB8fCAhZW50cnkubGluZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGgucmVzb2x2ZShlbnRyeS5maWxlUGF0aClcbiAgICBjb25zdCBsaW5lcyA9IHRoaXMuZ2V0TGluZUZpbHRlcnMoKVtmaWxlUGF0aF1cblxuICAgIGlmICghbGluZXMgfHwgbGluZXMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBsaW5lcy5pbmNsdWRlcyhlbnRyeS5saW5lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgZnVsbCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZ1bGwgZGVzY3JpcHRpb24uXG4gICAqL1xuICBidWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbikge1xuICAgIGNvbnN0IHBhcnRzID0gZGVzY3JpcHRpb25zLmNvbmNhdChbdGVzdERlc2NyaXB0aW9uXSlcblxuICAgIHJldHVybiBwYXJ0cy5qb2luKFwiIFwiKS50cmltKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGxpY2F0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcHBsaWNhdGlvbj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXBwbGljYXRpb24uXG4gICAqL1xuICBhc3luYyBhcHBsaWNhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuX2FwcGxpY2F0aW9uKSB7XG4gICAgICB0aGlzLl9hcHBsaWNhdGlvbiA9IG5ldyBBcHBsaWNhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICAvLyBSdW4gcmVxdWVzdCBoYW5kbGVycyBpbiB0aGUgbWFpbiB0aHJlYWQgKG5vdCB3b3JrZXIgdGhyZWFkcykgc28gdGhleVxuICAgICAgICAvLyByZXNvbHZlIERCIHdvcmsgdG8gdGhlIHBlci10ZXN0IHNoYXJlZCBjb25uZWN0aW9uIHNldCBieVxuICAgICAgICAvLyB7QGxpbmsgYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnN9LiBUaGlzIGxldHMgcmVxdWVzdC10eXBlIHNwZWNzIHVzZVxuICAgICAgICAvLyB0cmFuc2FjdGlvbi1iYXNlZCBjbGVhbmluZyAodGhlaXIgd3JpdGVzIGxhbmQgaW5zaWRlIHRoZSB0ZXN0J3NcbiAgICAgICAgLy8gdHJhbnNhY3Rpb24gYW5kIHJvbGwgYmFjaykgaW5zdGVhZCBvZiB0cnVuY2F0aW5nIGV2ZXJ5IHRhYmxlLlxuICAgICAgICBodHRwU2VydmVyOiB7aW5Qcm9jZXNzOiB0cnVlLCBwb3J0OiAzMTAwNn0sXG4gICAgICAgIHR5cGU6IFwidGVzdC1ydW5uZXJcIlxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGhpcy5fYXBwbGljYXRpb24uaW5pdGlhbGl6ZSgpXG4gICAgICBhd2FpdCB0aGlzLl9hcHBsaWNhdGlvbi5zdGFydEh0dHBTZXJ2ZXIoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hcHBsaWNhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBlYWNoIG5vbi10ZW5hbnQgcGVyLXRlc3QgY29ubmVjdGlvbiBhcyBhIGR5bmFtaWMgY2FuZGlkYXRlIGZvciBpbi1wcm9jZXNzXG4gICAqIHJlcXVlc3Qgc2hhcmluZy4gVGhlIHBvb2wgZXZhbHVhdGVzIHRyYW5zYWN0aW9uIHN0YXRlIHdoZW4gZWFjaCByZXF1ZXN0IGlzIGRpc3BhdGNoZWQsXG4gICAqIHNvIGEgdHJhbnNhY3Rpb24gc3RhcnRlZCBvciBlbmRlZCBkdXJpbmcgYSBob29rIGNhbGxiYWNrIHRha2VzIGVmZmVjdCBpbW1lZGlhdGVseS5cbiAgICogSW5hY3RpdmUgYW5kIHRlbmFudC1vbmx5IGNvbm5lY3Rpb25zIHJlbWFpbiBpbmRlcGVuZGVudGx5IHBvb2xlZC4gUGFpciB3aXRoXG4gICAqIHtAbGluayBjbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uc30gaW4gYSBmaW5hbGx5LlxuICAgKiBAcmV0dXJucyB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gLSBMaWZlY3ljbGUtb3duZWQgcmVnaXN0cmF0aW9ucy5cbiAgICovXG4gIGFjdGl2YXRlVGVzdFNoYXJlZENvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9ucyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICAvKiogQHR5cGUge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119ICovXG4gICAgY29uc3QgcmVnaXN0cmF0aW9ucyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoY3VycmVudENvbm5lY3Rpb25zKSkge1xuICAgICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIC8vIFRlbmFudC1zY29wZWQgcG9vbHMgcmVzb2x2ZSBhIGRpZmZlcmVudCBjb25uZWN0aW9uIHBlciByZXF1ZXN0IHRlbmFudFxuICAgICAgLy8gKHZpYSBydW5XaXRoVGVuYW50KSwgc28gZm9yY2luZyBhIHNpbmdsZSBzaGFyZWQgY29ubmVjdGlvbiB3b3VsZCBicmVha1xuICAgICAgLy8gcGVyLXJlcXVlc3QgdGVuYW50IHJlc29sdXRpb24uIE9ubHkgc2hhcmUgbm9uLXRlbmFudCBwb29sczsgdGhlIHRlbmFudFxuICAgICAgLy8gcG9vbCBrZWVwcyByZXNvbHZpbmcgaXRzIG93biBjb25uZWN0aW9uIHBlciByZXF1ZXN0LlxuICAgICAgaWYgKHBvb2wuZ2V0Q29uZmlndXJhdGlvbigpLnRlbmFudE9ubHkpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGN1cnJlbnRDb25uZWN0aW9uc1tpZGVudGlmaWVyXVxuXG4gICAgICBjb25zdCByZWdpc3RyYXRpb24gPSBwb29sLnNldFRlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIoKCkgPT4ge1xuICAgICAgICByZXR1cm4gY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpID8gY29ubmVjdGlvbiA6IHVuZGVmaW5lZFxuICAgICAgfSlcblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbikgcmVnaXN0cmF0aW9ucy5wdXNoKHtwb29sLCByZWdpc3RyYXRpb259KVxuICAgIH1cblxuICAgIHJldHVybiByZWdpc3RyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBpbi1wcm9jZXNzIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gb24gZXZlcnkgY29uZmlndXJlZCBwb29sLiBJZGVtcG90ZW50IGFuZFxuICAgKiBzYWZlIHRvIGNhbGwgd2hlbiBub25lIHdhcyBzZXQuXG4gICAqIEBwYXJhbSB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gW3JlZ2lzdHJhdGlvbnNdIC0gTGlmZWN5Y2xlLW93bmVkIHJlZ2lzdHJhdGlvbnMgdG8gY2xlYXIgY29uZGl0aW9uYWxseS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyhyZWdpc3RyYXRpb25zKSB7XG4gICAgaWYgKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIGZvciAoY29uc3Qge3Bvb2wsIHJlZ2lzdHJhdGlvbn0gb2YgcmVnaXN0cmF0aW9ucykge1xuICAgICAgICBwb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICAgIGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgb3V0IGFuZCByZWdpc3RlcnMgb25lIHBoeXNpY2FsIHRlbmFudCB0cmFuc2FjdGlvbiBmb3IgdGhlIGN1cnJlbnQgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHRlbmFudDogb2JqZWN0fX0gYXJncyAtIExvZ2ljYWwgaWRlbnRpZmllciBhbmQgdGVuYW50IGRlc2NyaXB0b3IuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQ3VycmVudCBhdHRlbXB0IHJlZ2lzdHJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50KHtkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudCwgLi4ucmVzdEFyZ3N9LCByZWdpc3RyYXRpb25zKSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwicmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgZGF0YWJhc2VJZGVudGlmaWVyXCIpXG4gICAgaWYgKCF0ZW5hbnQpIHRocm93IG5ldyBFcnJvcihcInJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIHRlbmFudFwiKVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGByZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSB0ZW5hbnRPbmx5IGRhdGFiYXNlOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgIH1cbiAgICBjb25zdCByZXVzZUtleSA9IHBvb2wuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBpZiAocmVnaXN0cmF0aW9ucy5zb21lKChyZWdpc3RyYXRpb24pID0+IHJlZ2lzdHJhdGlvbi5wb29sID09PSBwb29sICYmIHJlZ2lzdHJhdGlvbi5yZXVzZUtleSA9PT0gcmV1c2VLZXkpKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbn0gKi9cbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7XG4gICAgICBjb25uZWN0aW9uOiB1bmRlZmluZWQsXG4gICAgICBwb29sLFxuICAgICAgcmV1c2VLZXksXG4gICAgICByZXZva2VkOiBmYWxzZSxcbiAgICAgIHNoYXJlZFJlZ2lzdHJhdGlvbjogdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgcmVnaXN0cmF0aW9ucy5wdXNoKHJlZ2lzdHJhdGlvbilcbiAgICByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlID0gcG9vbFxuICAgICAgLmNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHtuYW1lOiBcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uXCJ9KVxuICAgICAgLnRoZW4oXG4gICAgICAgIChjb25uZWN0aW9uKSA9PiAoe2Nvbm5lY3Rpb24sIGVycm9yOiB1bmRlZmluZWR9KSxcbiAgICAgICAgKGVycm9yKSA9PiAoe1xuICAgICAgICAgIGNvbm5lY3Rpb246IHVuZGVmaW5lZCxcbiAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgY29ubmVjdGlvbiBjaGVja291dCBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH0pXG4gICAgICApXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2hlY2tvdXRPdXRjb21lID0gYXdhaXQgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZVxuXG4gICAgICBpZiAoY2hlY2tvdXRPdXRjb21lLmVycm9yKSB0aHJvdyBjaGVja291dE91dGNvbWUuZXJyb3JcbiAgICAgIGlmICghY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IGNvbm5lY3Rpb24gY2hlY2tvdXQgcmV0dXJuZWQgbm8gY29ubmVjdGlvblwiKVxuICAgICAgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24gPSBjaGVja291dE91dGNvbWUuY29ubmVjdGlvblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcblxuICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24uc3RhcnRUcmFuc2FjdGlvbigpXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuXG4gICAgICBjb25zdCBzaGFyZWRSZWdpc3RyYXRpb24gPSBwb29sLnNldFRlc3RTaGFyZWRDb25uZWN0aW9uRm9yQ29uZmlndXJhdGlvbihyZWdpc3RyYXRpb24uY29ubmVjdGlvbiwgcmV1c2VLZXkpXG4gICAgICBpZiAoIXNoYXJlZFJlZ2lzdHJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBEYXRhYmFzZSBwb29sIGRvZXMgbm90IHN1cHBvcnQgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uczogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICAgIHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24gPSBzaGFyZWRSZWdpc3RyYXRpb25cbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkge1xuICAgICAgICBwb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24oc2hhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVnaXN0cmF0aW9uLnJldm9rZWQgPSB0cnVlXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50cyhbcmVnaXN0cmF0aW9uXSwge2Rpc2NhcmQ6IHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwID09PSB0cnVlfSlcbiAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCBjbGVhbnVwRXJyb3JdLCBcIkZhaWxlZCB0byByZWdpc3RlciBhbmQgY2xlYW4gdXAgYSB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25cIiwge2NhdXNlOiBjbGVhbnVwRXJyb3J9KVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlcyBhdHRlbXB0IHJlZ2lzdHJhdGlvbnMgYmVmb3JlIHJvbGxpbmcgYmFjayBhbmQgcmVsZWFzaW5nIHRoZWlyIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEF0dGVtcHQgcmVnaXN0cmF0aW9ucy5cbiAgICogQHBhcmFtIHt7ZGlzY2FyZD86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBXaGV0aGVyIGNvbm5lY3Rpb25zIG11c3QgYmUgZGlzY2FyZGVkIGluc3RlYWQgb2YgcmV0dXJuZWQgdG8gdGhlIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKHJlZ2lzdHJhdGlvbnMsIHtkaXNjYXJkID0gZmFsc2V9ID0ge30pIHtcbiAgICBmb3IgKGNvbnN0IHJlZ2lzdHJhdGlvbiBvZiByZWdpc3RyYXRpb25zKSB7XG4gICAgICByZWdpc3RyYXRpb24ucmV2b2tlZCA9IHRydWVcbiAgICAgIGlmIChkaXNjYXJkKSByZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCA9IHRydWVcbiAgICAgIGlmIChyZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uKSByZWdpc3RyYXRpb24ucG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24pXG4gICAgfVxuICAgIGNvbnN0IGNsZWFudXBSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5yZWdpc3RyYXRpb25zXS5yZXZlcnNlKCkubWFwKChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5jbGVhbnVwUHJvbWlzZSA/Pz0gdGhpcy5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbihyZWdpc3RyYXRpb24pXG5cbiAgICAgIHJldHVybiByZWdpc3RyYXRpb24uY2xlYW51cFByb21pc2VcbiAgICB9KSlcbiAgICBjb25zdCBlcnJvcnMgPSBjbGVhbnVwUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBjbGVhbiB1cCB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYW5zIG9uZSBhdHRlbXB0IHJlZ2lzdHJhdGlvbiBleGFjdGx5IG9uY2UsIGluY2x1ZGluZyBhIGNoZWNrb3V0IHRoYXQgd2FzIHN0aWxsIHBlbmRpbmcgYXQgcmV2b2NhdGlvbi5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ufSByZWdpc3RyYXRpb24gLSBBdHRlbXB0LW93bmVkIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcm9sbGJhY2sgYW5kIHJlbGVhc2Ugb3IgcXVhcmFudGluZS5cbiAgICovXG4gIGFzeW5jIGNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbikge1xuICAgIGxldCBjb25uZWN0aW9uID0gcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb25cblxuICAgIGlmICghY29ubmVjdGlvbiAmJiByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlKSB7XG4gICAgICBjb25zdCBjaGVja291dE91dGNvbWUgPSBhd2FpdCByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlXG5cbiAgICAgIGlmIChjaGVja291dE91dGNvbWUuZXJyb3IpIHJldHVyblxuICAgICAgY29ubmVjdGlvbiA9IGNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uXG4gICAgICByZWdpc3RyYXRpb24uY29ubmVjdGlvbiA9IGNvbm5lY3Rpb25cbiAgICB9XG4gICAgaWYgKCFjb25uZWN0aW9uKSByZXR1cm5cblxuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSkgYXdhaXQgY29ubmVjdGlvbi5yb2xsYmFja1RyYW5zYWN0aW9uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCkge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5wb29sLmRpc2NhcmQoY29ubmVjdGlvbilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24ucG9vbC5jaGVja2luKGNvbm5lY3Rpb24pXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBjbGVhbiB1cCBhIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbGVjdHMgdGhlIGN1cnJlbnQgbm9uLXRlbmFudCBjb25uZWN0aW9ucyBlbGlnaWJsZSBmb3Igc2hhcmVkIHRyYW5zYWN0aW9uIHdvcmsuXG4gICAqIEBwYXJhbSB7e3RyYW5zYWN0aW9uc09ubHk6IGJvb2xlYW59fSBhcmdzIC0gU2VsZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gRWxpZ2libGUgY29ubmVjdGlvbnMgYnkgaWRlbnRpZmllci5cbiAgICovXG4gIHNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHl9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb25zID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0ge31cblxuICAgIGZvciAoY29uc3QgW2lkZW50aWZpZXIsIGNvbm5lY3Rpb25dIG9mIE9iamVjdC5lbnRyaWVzKGN1cnJlbnRDb25uZWN0aW9ucykpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uKCkudGVuYW50T25seSkgY29udGludWVcbiAgICAgIGlmICh0cmFuc2FjdGlvbnNPbmx5ICYmICFjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkpIGNvbnRpbnVlXG4gICAgICBjb25uZWN0aW9uc1tpZGVudGlmaWVyXSA9IGNvbm5lY3Rpb25cbiAgICB9XG5cbiAgICByZXR1cm4gY29ubmVjdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBwaHlzaWNhbC1jb25uZWN0aW9uIGNvb3JkaW5hdGlvbiBiZWZvcmUgYSB0cmFuc2FjdGlvbi1vcGVuaW5nIGhvb2tcbiAgICogY2FuIGV4cG9zZSB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gdG8gYSBsb25nLWxpdmVkIGluLXByb2Nlc3Mgc2VydmljZS5cbiAgICogQ2hpbGQtcHJvY2VzcyBjb29yZGluYXRlcyByZW1haW4gdW5wdWJsaXNoZWQgdW50aWwgdGhlIHRyYW5zYWN0aW9uIGV4aXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWQ+fSAtIFByZXBhcmVkIGNvb3JkaW5hdG9yLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZVNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5OiBmYWxzZX0pXG5cbiAgICBpZiAoT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJyb2tlcjogYXdhaXQgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIuc3RhcnQoe2Nvbm5lY3Rpb25zfSksXG4gICAgICBlbnZpcm9ubWVudFB1Ymxpc2hlZDogZmFsc2UsXG4gICAgICBwcmV2aW91c0Vudmlyb25tZW50OiB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBwcmVwYXJlZCBicm9rZXIgY29vcmRpbmF0ZXMgZXhhY3RseSB0aGUgc2VsZWN0ZWQgcGh5c2ljYWwgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHJlZ2lzdHJhdGlvbiAtIFByZXBhcmVkIGNvb3JkaW5hdG9yLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gY29ubmVjdGlvbnMgLSBTZWxlY3RlZCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaWRlbnRpZmllciBzZXQgYW5kIHBoeXNpY2FsIGNvbm5lY3Rpb25zIG1hdGNoIGV4YWN0bHkuXG4gICAqL1xuICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlck1hdGNoZXNDb25uZWN0aW9ucyhyZWdpc3RyYXRpb24sIGNvbm5lY3Rpb25zKSB7XG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyhjb25uZWN0aW9ucylcblxuICAgIGlmICghcmVnaXN0cmF0aW9uIHx8IGlkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlZ2lzdHJhdGlvbi5icm9rZXIuY29ubmVjdGlvbnMpLmxlbmd0aCAhPT0gaWRlbnRpZmllcnMubGVuZ3RoKSByZXR1cm4gZmFsc2VcblxuICAgIGZvciAoY29uc3QgW2lkZW50aWZpZXIsIGNvbm5lY3Rpb25dIG9mIE9iamVjdC5lbnRyaWVzKGNvbm5lY3Rpb25zKSkge1xuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5icm9rZXIuY29ubmVjdGlvbnNbaWRlbnRpZmllcl0gIT09IGNvbm5lY3Rpb24pIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIGEgY2FwYWJpbGl0eS1zY29wZWQgYnJva2VyIGZvciB0aGUgYWN0aXZlIG5vbi10ZW5hbnQgcGh5c2ljYWxcbiAgICogdHJhbnNhY3Rpb24gY29ubmVjdGlvbnMuIE5vIGJyb2tlci9lbnYgaXMgaW5zdGFsbGVkIGZvciB0cnVuY2F0aW9uLW9ubHkgb3JcbiAgICogb3RoZXIgdHJhbnNhY3Rpb24tZGlzYWJsZWQgYXR0ZW1wdHMuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb259IFtwcmVwYXJlZFJlZ2lzdHJhdGlvbl0gLSBDb29yZGluYXRvciBwcmVwYXJlZCBiZWZvcmUgaG9va3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBbc2VsZWN0ZWRDb25uZWN0aW9uc10gLSBQb3N0LWhvb2sgYWN0aXZlIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZD59IC0gQXR0ZW1wdCByZWdpc3RyYXRpb24uXG4gICAqL1xuICBhc3luYyBzdGFydFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uLCBzZWxlY3RlZENvbm5lY3Rpb25zKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBzZWxlY3RlZENvbm5lY3Rpb25zIHx8IHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seTogdHJ1ZX0pXG5cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXJzID0gT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpXG4gICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBsZXQgYnJva2VyXG5cbiAgICBpZiAocHJlcGFyZWRSZWdpc3RyYXRpb24gJiYgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkJyb2tlck1hdGNoZXNDb25uZWN0aW9ucyhwcmVwYXJlZFJlZ2lzdHJhdGlvbiwgY29ubmVjdGlvbnMpKSB7XG4gICAgICBicm9rZXIgPSBwcmVwYXJlZFJlZ2lzdHJhdGlvbi5icm9rZXJcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICBicm9rZXIgPSBhd2FpdCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlci5zdGFydCh7Y29ubmVjdGlvbnN9KVxuICAgIH1cblxuICAgIGNvbnN0IHByZXZpb3VzRW52aXJvbm1lbnQgPSBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl1cbiAgICBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl0gPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeSh7XG4gICAgICBhZGRyZXNzOiBicm9rZXIuYWRkcmVzcygpLFxuICAgICAgY2FwYWJpbGl0eTogYnJva2VyLmNhcGFiaWxpdHkoKSxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBleHBlY3RlZDogdHJ1ZVxuICAgIH0pKS50b1N0cmluZyhcImJhc2U2NHVybFwiKVxuXG4gICAgcmV0dXJuIHticm9rZXIsIGVudmlyb25tZW50UHVibGlzaGVkOiB0cnVlLCBwcmV2aW91c0Vudmlyb25tZW50fVxuICB9XG5cbiAgLyoqXG4gICAqIFJldm9rZXMgYW4gYXR0ZW1wdCBicm9rZXIgYmVmb3JlIGRhdGFiYXNlIHJvbGxiYWNrIGhvb2tzIHJ1biBhbmQgcmVzdG9yZXNcbiAgICogdGhlIGNhbGxlcidzIGVudmlyb25tZW50IHNvIGxhdGVyIHBvb2xlZC9zcGF3bmVkIGNoaWxkcmVuIGNhbm5vdCBpbmhlcml0IGl0LlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSByZWdpc3RyYXRpb24gLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGFzeW5jIHN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihyZWdpc3RyYXRpb24pIHtcbiAgICBpZiAoIXJlZ2lzdHJhdGlvbikgcmV0dXJuXG5cbiAgICBpZiAocmVnaXN0cmF0aW9uLmVudmlyb25tZW50UHVibGlzaGVkKSB7XG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnByZXZpb3VzRW52aXJvbm1lbnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkZWxldGUgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl0gPSByZWdpc3RyYXRpb24ucHJldmlvdXNFbnZpcm9ubWVudFxuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCByZWdpc3RyYXRpb24uYnJva2VyLmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVlc3QgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXF1ZXN0Q2xpZW50Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZXF1ZXN0IGNsaWVudC5cbiAgICovXG4gIGFzeW5jIHJlcXVlc3RDbGllbnQoKSB7XG4gICAgaWYgKCF0aGlzLl9yZXF1ZXN0Q2xpZW50KSB7XG4gICAgICB0aGlzLl9yZXF1ZXN0Q2xpZW50ID0gbmV3IFJlcXVlc3RDbGllbnQoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0Q2xpZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgdGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGltcG9ydFRlc3RGaWxlcygpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuXG4gICAgaWYgKCF0aGlzLl9wcm9maWxlcikge1xuICAgICAgYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLmltcG9ydFRlc3RGaWxlcyh0aGlzLmdldFRlc3RGaWxlcygpKVxuICAgICAgc3luY2hyb25pemVUZXN0aW5nUGFja2FnZVRlc3RzKHRlc3RzKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0ZXN0RmlsZSBvZiB0aGlzLmdldFRlc3RGaWxlcygpKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1JlZ2lzdHJhdGlvbnMgPSB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKHRlc3RzKVxuXG4gICAgICBhd2FpdCB0aGlzLl9wcm9maWxlci5tZWFzdXJlUGhhc2UoXCJpbXBvcnRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLmltcG9ydFRlc3RGaWxlcyhbdGVzdEZpbGVdKVxuICAgICAgfSwge2ZpbGVQYXRoOiB0ZXN0RmlsZX0pXG4gICAgICBzeW5jaHJvbml6ZVRlc3RpbmdQYWNrYWdlVGVzdHModGVzdHMpXG4gICAgICB0aGlzLmFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAodGVzdHMsIGV4aXN0aW5nUmVnaXN0cmF0aW9ucywgdGVzdEZpbGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbGxlY3RzIHJlZ2lzdGVyZWQgc2NvcGUsIGhvb2ssIGFuZCB0ZXN0IG9iamVjdHMgYnkgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7VGVzdHNBcmd1bWVudH0gc2NvcGUgLSBUZXN0IHNjb3BlLlxuICAgKiBAcGFyYW0ge1NldDxvYmplY3Q+fSBbcmVnaXN0cmF0aW9uc10gLSBBY2N1bXVsYXRlZCBpZGVudGl0aWVzLlxuICAgKiBAcmV0dXJucyB7U2V0PG9iamVjdD59IC0gUmVnaXN0cmF0aW9uIGlkZW50aXRpZXMuXG4gICAqL1xuICB0ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cyhzY29wZSwgcmVnaXN0cmF0aW9ucyA9IG5ldyBTZXQoKSkge1xuICAgIHJlZ2lzdHJhdGlvbnMuYWRkKHNjb3BlKVxuXG4gICAgZm9yIChjb25zdCBob29rIG9mIFsuLi5zY29wZS5iZWZvcmVBbGxzLCAuLi5zY29wZS5iZWZvcmVFYWNoZXMsIC4uLnNjb3BlLmFmdGVyRWFjaGVzLCAuLi5zY29wZS5hZnRlckFsbHNdKSB7XG4gICAgICByZWdpc3RyYXRpb25zLmFkZChob29rKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgdGVzdERhdGEgb2YgT2JqZWN0LnZhbHVlcyhzY29wZS50ZXN0cykpIHJlZ2lzdHJhdGlvbnMuYWRkKHRlc3REYXRhKVxuICAgIGZvciAoY29uc3QgY2hpbGRTY29wZSBvZiBPYmplY3QudmFsdWVzKHNjb3BlLnN1YnMpKSB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKGNoaWxkU2NvcGUsIHJlZ2lzdHJhdGlvbnMpXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgZGV0ZXJtaW5pc3RpYyBvd25lcnNoaXAgdG8gcmVnaXN0cmF0aW9ucyBhZGRlZCBieSBvbmUgZW50cnkgZmlsZSxcbiAgICogaW5jbHVkaW5nIGRlY2xhcmF0aW9ucyBvcmlnaW5hdGluZyBpbiBhIGhlbHBlciBpbXBvcnRlZCBieSB0aGF0IGVudHJ5IGZpbGUuXG4gICAqIEBwYXJhbSB7VGVzdHNBcmd1bWVudH0gc2NvcGUgLSBUZXN0IHNjb3BlLlxuICAgKiBAcGFyYW0ge1NldDxvYmplY3Q+fSBwcmV2aW91c1JlZ2lzdHJhdGlvbnMgLSBJZGVudGl0aWVzIHByZXNlbnQgYmVmb3JlIGltcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG93bmVyRmlsZVBhdGggLSBJbXBvcnRpbmcgZW50cnkgZmlsZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKHNjb3BlLCBwcmV2aW91c1JlZ2lzdHJhdGlvbnMsIG93bmVyRmlsZVBhdGgpIHtcbiAgICBpZiAoIXByZXZpb3VzUmVnaXN0cmF0aW9ucy5oYXMoc2NvcGUpKSBzY29wZS5vd25lckZpbGVQYXRoID8/PSBvd25lckZpbGVQYXRoXG5cbiAgICBmb3IgKGNvbnN0IGhvb2sgb2YgWy4uLnNjb3BlLmJlZm9yZUFsbHMsIC4uLnNjb3BlLmJlZm9yZUVhY2hlcywgLi4uc2NvcGUuYWZ0ZXJFYWNoZXMsIC4uLnNjb3BlLmFmdGVyQWxsc10pIHtcbiAgICAgIGlmICghcHJldmlvdXNSZWdpc3RyYXRpb25zLmhhcyhob29rKSkgaG9vay5vd25lckZpbGVQYXRoID8/PSBvd25lckZpbGVQYXRoXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0ZXN0RGF0YSBvZiBPYmplY3QudmFsdWVzKHNjb3BlLnRlc3RzKSkge1xuICAgICAgaWYgKCFwcmV2aW91c1JlZ2lzdHJhdGlvbnMuaGFzKHRlc3REYXRhKSkgdGVzdERhdGEub3duZXJGaWxlUGF0aCA/Pz0gb3duZXJGaWxlUGF0aFxuICAgIH1cblxuICAgIGZvciAoY29uc3QgY2hpbGRTY29wZSBvZiBPYmplY3QudmFsdWVzKHNjb3BlLnN1YnMpKSB7XG4gICAgICB0aGlzLmFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAoY2hpbGRTY29wZSwgcHJldmlvdXNSZWdpc3RyYXRpb25zLCBvd25lckZpbGVQYXRoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGZhaWxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBmYWlsZWQuXG4gICAqL1xuICBpc0ZhaWxlZCgpIHsgcmV0dXJuIHRoaXMuX2ZhaWxlZFRlc3RzICE9PSB1bmRlZmluZWQgJiYgdGhpcy5fZmFpbGVkVGVzdHMgPiAwIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmFpbGVkIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBmYWlsZWQgdGVzdHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0cygpIHtcbiAgICBpZiAodGhpcy5fZmFpbGVkVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2ZhaWxlZFRlc3RzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmFpbGVkIHRlc3QgZGV0YWlscy5cbiAgICogQHJldHVybnMge0ZhaWxlZFRlc3REZXRhaWxbXX0gLSBGYWlsZWQgdGVzdCBkZXRhaWxzLlxuICAgKi9cbiAgZ2V0RmFpbGVkVGVzdERldGFpbHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJzaXN0IGZhaWxlZCB0ZXN0IGNvbnNvbGUgb3V0cHV0cyB0byBhc3NldHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmFzc2V0c1BhdGhdIC0gQXNzZXRzIGRpcmVjdG9yeSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gV3JpdHRlbiBsb2cgZmlsZSBwYXRocy5cbiAgICovXG4gIGFzeW5jIHBlcnNpc3RGYWlsZWRUZXN0Q29uc29sZU91dHB1dHNUb0Fzc2V0cyh7YXNzZXRzUGF0aCA9IHBhdGguam9pbihwcm9jZXNzLmN3ZCgpLCBcInRtcC9zY3JlZW5zaG90c1wiKX0gPSB7fSkge1xuICAgIGNvbnN0IGZhaWxlZFRlc3REZXRhaWxzID0gdGhpcy5nZXRGYWlsZWRUZXN0RGV0YWlscygpXG4gICAgY29uc3Qgd3JpdHRlbkxvZ1BhdGhzID0gW11cbiAgICBsZXQgY3JlYXRlZERpcmVjdG9yeSA9IGZhbHNlXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgZmFpbGVkVGVzdERldGFpbHMubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICBjb25zdCBmYWlsZWRUZXN0RGV0YWlsID0gZmFpbGVkVGVzdERldGFpbHNbaW5kZXhdXG4gICAgICBjb25zdCBjb25zb2xlT3V0cHV0ID0gZmFpbGVkVGVzdERldGFpbC5jb25zb2xlT3V0cHV0XG5cbiAgICAgIGlmICghY29uc29sZU91dHB1dCkgY29udGludWVcblxuICAgICAgaWYgKCFjcmVhdGVkRGlyZWN0b3J5KSB7XG4gICAgICAgIGF3YWl0IGZzLm1rZGlyKGFzc2V0c1BhdGgsIHtyZWN1cnNpdmU6IHRydWV9KVxuICAgICAgICBjcmVhdGVkRGlyZWN0b3J5ID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpXG4gICAgICBjb25zdCB0aW1lc3RhbXAgPSBbXG4gICAgICAgIFN0cmluZyhub3cuZ2V0RnVsbFllYXIoKSksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRIb3VycygpKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0TWludXRlcygpKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0U2Vjb25kcygpKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0TWlsbGlzZWNvbmRzKCkpLnBhZFN0YXJ0KDMsIFwiMFwiKVxuICAgICAgXS5qb2luKFwiXCIpXG4gICAgICBjb25zdCBzbHVnID0gdG9GaWxlU2x1ZyhmYWlsZWRUZXN0RGV0YWlsLmZ1bGxEZXNjcmlwdGlvbilcbiAgICAgIGNvbnN0IGZpbGVOYW1lID0gYCR7dGltZXN0YW1wfS0ke1N0cmluZyhpbmRleCArIDEpLnBhZFN0YXJ0KDIsIFwiMFwiKX0tJHtzbHVnfS5jb25zb2xlLmxvZ2BcbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5qb2luKGFzc2V0c1BhdGgsIGZpbGVOYW1lKVxuXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIGNvbnNvbGVPdXRwdXQsIFwidXRmOFwiKVxuICAgICAgZmFpbGVkVGVzdERldGFpbC5jb25zb2xlTG9nUGF0aCA9IGZpbGVQYXRoXG4gICAgICB3cml0dGVuTG9nUGF0aHMucHVzaChmaWxlUGF0aClcbiAgICB9XG5cbiAgICByZXR1cm4gd3JpdHRlbkxvZ1BhdGhzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3VjY2Vzc2Z1bCB0ZXN0cy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgc3VjY2Vzc2Z1bCB0ZXN0cy5cbiAgICovXG4gIGdldFN1Y2Nlc3NmdWxUZXN0cygpIHtcbiAgICBpZiAodGhpcy5fc3VjY2Vzc2Z1bFRlc3RzID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIlRlc3RzIGhhc24ndCBiZWVuIHJ1biB5ZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9zdWNjZXNzZnVsVGVzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0cyBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgdGVzdHMgY291bnQuXG4gICAqL1xuICBnZXRUZXN0c0NvdW50KCkge1xuICAgIGlmICh0aGlzLl90ZXN0c0NvdW50ID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIlRlc3RzIGhhc24ndCBiZWVuIHJ1biB5ZXRcIilcblxuICAgIHJldHVybiB0aGlzLl90ZXN0c0NvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhlY3V0ZWQgdGVzdHMgY291bnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGV4ZWN1dGVkIHRlc3RzIGNvdW50LlxuICAgKi9cbiAgZ2V0RXhlY3V0ZWRUZXN0c0NvdW50KCkge1xuICAgIHJldHVybiB0aGlzLl90ZXN0RHVyYXRpb25zLmxlbmd0aFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHRlc3RzIHJlY29yZGVkIGR1cmluZyB0aGUgcnVuLCBzbG93ZXN0IGZpcnN0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2xpbWl0XSAtIE1heGltdW0gbnVtYmVyIG9mIHRlc3RzIHRvIHJldHVybiAoMCByZXR1cm5zIGFsbCkuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlciwgZHVyYXRpb25NczogbnVtYmVyfT59IC0gU2xvd2VzdCB0ZXN0cywgc2xvd2VzdCBmaXJzdC5cbiAgICovXG4gIGdldFNsb3dlc3RUZXN0cyhsaW1pdCA9IDEwKSB7XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnRoaXMuX3Rlc3REdXJhdGlvbnNdLnNvcnQoKHRlc3RBLCB0ZXN0QikgPT4gdGVzdEIuZHVyYXRpb25NcyAtIHRlc3RBLmR1cmF0aW9uTXMpXG5cbiAgICByZXR1cm4gbGltaXQgPiAwID8gc29ydGVkLnNsaWNlKDAsIGxpbWl0KSA6IHNvcnRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlcGFyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHByZXBhcmUoKSB7XG4gICAgdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID0gZmFsc2VcbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9IDBcbiAgICB0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPSAwXG4gICAgdGhpcy5fdGVzdHNDb3VudCA9IDBcbiAgICB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gZmFsc2VcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscyA9IFtdXG4gICAgdGhpcy5fdGVzdER1cmF0aW9ucyA9IFtdXG4gICAgY29uc3QgdGVzdGluZ0NvbmZpZ1BhdGggPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRUZXN0aW5nKClcblxuICAgIGlmICh0ZXN0aW5nQ29uZmlnUGF0aCkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5Qcm9maWxlU3Bhbih7cGhhc2U6IFwidGVzdGluZyBjb25maWcvZ2xvYmFsIHNldHVwXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmltcG9ydFRlc3RpbmdDb25maWdQYXRoKClcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5pbXBvcnRUZXN0RmlsZXMoKVxuICAgIGF3YWl0IHRoaXMuYW5hbHl6ZVRlc3RzKHRlc3RzKVxuICAgIHRoaXMuX29ubHlGb2N1c3NlZCA9IHRoaXMuYW55VGVzdHNGb2N1c3NlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXJlIGFueSB0ZXN0cyBmb2N1c3NlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdGVzdHMgZm9jdXNzZWQuXG4gICAqL1xuICBhcmVBbnlUZXN0c0ZvY3Vzc2VkKCkge1xuICAgIGlmICh0aGlzLmFueVRlc3RzRm9jdXNzZWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSGFzbid0IGJlZW4gZGV0ZWN0ZWQgeWV0XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYW55VGVzdHNGb2N1c3NlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgLyoqXG4gICAqIFJlY29yZHMgYW4gYXN5bmNocm9ub3VzIGNyYXNoIChhbiB1bmhhbmRsZWQgcHJvbWlzZSByZWplY3Rpb24gZGV0YWNoZWQgZnJvbVxuICAgKiBhbnkgYXdhaXQsIGUuZy4gYSBgdm9pZCBjb25uZWN0aW9uLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IGJyb2FkY2FzdCguLi4pKWBcbiAgICogZnJvbnRlbmQtbW9kZWwgcHVibGlzaCDigJQgb3IgYSBzeW5jaHJvbm91cyB0aHJvdyBpbnNpZGUgYSBkZXRhY2hlZCBjYWxsYmFja1xuICAgKiBzdWNoIGFzIGEgZHJpdmVyIHNvY2tldCBvciB0aW1lciBjYWxsYmFjaykgYXMgYSByZWFsLCB2aXNpYmxlLCBhdHRyaWJ1dGVkXG4gICAqIHRlc3QgZmFpbHVyZS5cbiAgICpcbiAgICogV2l0aG91dCB0aGlzLCBzdWNoIGEgcmVqZWN0aW9uL2V4Y2VwdGlvbiBoYXMgbm8gaGFuZGxlciwgc28gb24gbW9kZXJuIE5vZGVcbiAgICogdGhlIHByb2Nlc3MgaXMgVEVSTUlOQVRFRCDigJQgdGhlIHJ1biBlbmRzIHdpdGggbm8gcmVwb3J0ZWQgZmFpbHVyZXMgYW5kIENJXG4gICAqIGp1c3Qgc2VlcyBhIGNyYXNoZWQvcmV0cmllZCBzaGFyZCB3aXRoIGFuIGVtcHR5IHJlc3VsdCAodGhlIHJlY3VycmluZ1xuICAgKiBcInNpbGVudCB0ZXN0LXJ1bm5lciBkZWF0aFwiOiBpbnZpc2libGUgYW5kIGltcG9zc2libGUgdG8gZGlhZ25vc2UpLiBUdXJuaW5nXG4gICAqIGl0IGludG8gYSBmYWlsdXJlIG1ha2VzIHRoZSBydW4gZ28gcmVkIHdpdGggc29tZXRoaW5nIGRlYnVnZ2FibGUgaW5zdGVhZCBvZlxuICAgKiB2YW5pc2hpbmcuXG4gICAqIEBwYXJhbSB7XCJ1bmNhdWdodEV4Y2VwdGlvblwiIHwgXCJ1bmhhbmRsZWRSZWplY3Rpb25cIn0ga2luZCAtIEFzeW5jLWNyYXNoIGtpbmQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gUmVqZWN0aW9uIHJlYXNvbiBvciB0aHJvd24gZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQXN5bmNDcmFzaChraW5kLCByZWFzb24pIHtcbiAgICBjb25zdCBlcnJvciA9IHJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gcmVhc29uIDogbmV3IEVycm9yKGAke2tpbmR9OiAke1N0cmluZyhyZWFzb24pfWApXG4gICAgY29uc3QgbmVhciA9IHRoaXMuX2xhc3RUZXN0Q29udGV4dFxuICAgIGNvbnN0IGF0dHJpYnV0aW9uID0gbmVhciA/IGAsIG5lYXIgdGVzdDogJHtuZWFyLmZ1bGxEZXNjcmlwdGlvbn0gKCR7bmVhci5maWxlUGF0aH06JHtuZWFyLmxpbmV9KWAgOiBcIlwiXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9ICh0aGlzLl9mYWlsZWRUZXN0cyB8fCAwKSArIDFcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogYDwke2tpbmR9IGR1cmluZyB0ZXN0IHJ1biR7YXR0cmlidXRpb259PmAsXG4gICAgICBmaWxlUGF0aDogbmVhciA/IG5lYXIuZmlsZVBhdGggOiBcIjx0ZXN0IHJ1bm5lcj5cIixcbiAgICAgIGxpbmU6IG5lYXIgPyBuZWFyLmxpbmUgOiAwLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuW3Rlc3QtcnVubmVyXSAke2tpbmR9IGR1cmluZyB0aGUgdGVzdCBydW4g4oCUIHRoaXMgd291bGQgb3RoZXJ3aXNlIHRlcm1pbmF0ZSB0aGUgcHJvY2VzcyBzaWxlbnRseSBhbmQgc3VyZmFjZSBvbmx5IGFzIGEgY3Jhc2hlZC9yZXRyaWVkIHNoYXJkIHdpdGggemVybyByZXBvcnRlZCBmYWlsdXJlcy4ke2F0dHJpYnV0aW9ufWApKVxuICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGNsZWFudXAgZmFpbHVyZSBhZnRlciB0aW1lb3V0IGhhbmRsaW5nIGhhcyBiZWd1bi5cbiAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBEZXRhY2hlZCBjbGVhbnVwIHJlamVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNsZWFudXBOYW1lIC0gQ2xlYW51cCBvcGVyYXRpb24gbmFtZS5cbiAgICogQHBhcmFtIHtTZXQ8RXJyb3I+fSBbcmVjb3JkZWRFcnJvcnNdIC0gQXR0ZW1wdC1vd25lZCBjbGVhbnVwIGVycm9ycyBhbHJlYWR5IHJlcG9ydGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShyZWFzb24sIGNsZWFudXBOYW1lLCByZWNvcmRlZEVycm9ycykge1xuICAgIGNvbnN0IGVycm9yID0gcmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyByZWFzb24gOiBuZXcgRXJyb3IoYCR7Y2xlYW51cE5hbWV9IGNsZWFudXAgZmFpbGVkOiAke1N0cmluZyhyZWFzb24pfWApXG5cbiAgICBpZiAocmVjb3JkZWRFcnJvcnMpIHtcbiAgICAgIC8vIE11bHRpcGxlIGJvdW5kZWQgb2JzZXJ2ZXJzIGNhbiByZWNlaXZlIHRoZSBzYW1lIGRldGFjaGVkIGNsZWFudXAgcmVqZWN0aW9uLlxuICAgICAgaWYgKHJlY29yZGVkRXJyb3JzLmhhcyhlcnJvcikpIHJldHVyblxuICAgICAgcmVjb3JkZWRFcnJvcnMuYWRkKGVycm9yKVxuICAgIH1cblxuICAgIGNvbnN0IG5lYXIgPSB0aGlzLl9sYXN0VGVzdENvbnRleHRcbiAgICBjb25zdCBhdHRyaWJ1dGlvbiA9IG5lYXIgPyBgLCBuZWFyIHRlc3Q6ICR7bmVhci5mdWxsRGVzY3JpcHRpb259ICgke25lYXIuZmlsZVBhdGh9OiR7bmVhci5saW5lfSlgIDogXCJcIlxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAodGhpcy5fZmFpbGVkVGVzdHMgfHwgMCkgKyAxXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IGA8JHtjbGVhbnVwTmFtZX0gZW1lcmdlbmN5IGNsZWFudXAgZmFpbHVyZSR7YXR0cmlidXRpb259PmAsXG4gICAgICBmaWxlUGF0aDogbmVhciA/IG5lYXIuZmlsZVBhdGggOiBcIjx0ZXN0IHJ1bm5lcj5cIixcbiAgICAgIGxpbmU6IG5lYXIgPyBuZWFyLmxpbmUgOiAwLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuW3Rlc3QtcnVubmVyXSAke2NsZWFudXBOYW1lfSBjbGVhbnVwIGZhaWxlZCBhZnRlciB0aW1lb3V0IGhhbmRsaW5nIGJlZ2FuLiR7YXR0cmlidXRpb259YCkpXG4gICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgfVxuXG4gIGFzeW5jIHJ1bigpIHtcbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgcHJvY2Vzcy1sZXZlbCB1bmhhbmRsZWQgcmVqZWN0aW9uIGR1cmluZyB0aGUgcnVuLlxuICAgICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gUmVqZWN0aW9uIHJlYXNvbi5cbiAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgKi9cbiAgICBjb25zdCBvblVuaGFuZGxlZFJlamVjdGlvbiA9IChyZWFzb24pID0+IHtcbiAgICAgIC8vIElmIGEgdGVzdCBhdHRhY2hlZCBpdHMgT1dOIHVuaGFuZGxlZFJlamVjdGlvbiBsaXN0ZW5lciwgaXQgaXNcbiAgICAgIC8vIGludGVudGlvbmFsbHkgb2JzZXJ2aW5nL3RyaWdnZXJpbmcgdGhlIHJlamVjdGlvbiAoZS5nLiBiZWFjb25cbiAgICAgIC8vIGVycm9yLXJlcG9ydGluZy1zcGVjLmpzKSDigJQgTm9kZSBkaXNwYXRjaGVzIHRvIEVWRVJZIGxpc3RlbmVyLCBzbyBhbHNvXG4gICAgICAvLyBmYWlsaW5nIHRoZSBzdWl0ZSBoZXJlIHdvdWxkIGJyZWFrIHRob3NlIHRlc3RzLiBEZWZlciB0byB0aGUgdGVzdCdzXG4gICAgICAvLyBoYW5kbGVyOyBvbmx5IHRyZWF0IGEgcmVqZWN0aW9uIGFzIGEgc2lsZW50LWRlYXRoIGNyYXNoIHdoZW4gb3VycyBpcyB0aGVcbiAgICAgIC8vIHNvbGUgbGlzdGVuZXIgKG5vIHBlcnNpc3RlbnQgZnJhbWV3b3JrIGxpc3RlbmVyIGV4aXN0cyB0byBtYXNrIHRoaXMpLlxuICAgICAgaWYgKHByb2Nlc3MubGlzdGVuZXJDb3VudChcInVuaGFuZGxlZFJlamVjdGlvblwiKSA+IDEpIHJldHVyblxuXG4gICAgICB0aGlzLnJlY29yZEFzeW5jQ3Jhc2goXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgcmVhc29uKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBwcm9jZXNzLWxldmVsIHVuY2F1Z2h0IGV4Y2VwdGlvbiBkdXJpbmcgdGhlIHJ1biDigJQgYVxuICAgICAqIHN5bmNocm9ub3VzIHRocm93IGluc2lkZSBhIGRldGFjaGVkIGNhbGxiYWNrIChkcml2ZXIgc29ja2V0LCB0aW1lcixcbiAgICAgKiBldmVudCBlbWl0dGVyKSB0aGF0IG5vIHRlc3QgYXdhaXQgb2JzZXJ2ZXMuIFNhbWUgc2lsZW50LWRlYXRoIG1vZGUgYXNcbiAgICAgKiB1bmhhbmRsZWQgcmVqZWN0aW9uczogd2l0aG91dCBhIGhhbmRsZXIgdGhlIHByb2Nlc3MgZGllcyBtaWQtcnVuIGFuZCBDSVxuICAgICAqIHNlZXMgYSBjcmFzaGVkIHNoYXJkIHdpdGggemVybyByZXBvcnRlZCBmYWlsdXJlcy5cbiAgICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gVGhyb3duIGVycm9yLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIGNvbnN0IG9uVW5jYXVnaHRFeGNlcHRpb24gPSAoZXJyb3IpID0+IHtcbiAgICAgIC8vIE1pcnJvciB0aGUgdW5oYW5kbGVkUmVqZWN0aW9uIGRlZmVycmFsOiBhIHRlc3Qgb2JzZXJ2aW5nL3RyaWdnZXJpbmdcbiAgICAgIC8vIHVuY2F1Z2h0IGV4Y2VwdGlvbnMgd2l0aCBpdHMgb3duIGxpc3RlbmVyIG93bnMgdGhlbS5cbiAgICAgIGlmIChwcm9jZXNzLmxpc3RlbmVyQ291bnQoXCJ1bmNhdWdodEV4Y2VwdGlvblwiKSA+IDEpIHJldHVyblxuXG4gICAgICB0aGlzLnJlY29yZEFzeW5jQ3Jhc2goXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBlcnJvcilcbiAgICB9XG5cbiAgICBwcm9jZXNzLm9uKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIG9uVW5oYW5kbGVkUmVqZWN0aW9uKVxuICAgIHByb2Nlc3Mub24oXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBvblVuY2F1Z2h0RXhjZXB0aW9uKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuVGVzdHMoe1xuICAgICAgICBhZnRlckVhY2hlczogW10sXG4gICAgICAgIGJlZm9yZUVhY2hlczogW10sXG4gICAgICAgIHRlc3RzLFxuICAgICAgICBkZXNjcmlwdGlvbnM6IFtdLFxuICAgICAgICBpbmRlbnRMZXZlbDogMFxuICAgICAgfSlcblxuICAgICAgLy8gQSByZWplY3Rpb24gc2NoZWR1bGVkIGJ5IHRoZSBmaW5hbCB0ZXN0IChhIGRldGFjaGVkIHJlamVjdGVkIHByb21pc2UsXG4gICAgICAvLyBvciBhbiBhZnRlckNvbW1pdCBjYWxsYmFjayByZWplY3RpbmcgYXMgdGhlIHN1aXRlIGRyYWlucykgaXMgcmVwb3J0ZWRcbiAgICAgIC8vIGJ5IE5vZGUgb24gYSBMQVRFUiB0dXJuLiBEcmFpbiBhIGZldyB0dXJucyB3aGlsZSB0aGUgaGFuZGxlciBpcyBzdGlsbFxuICAgICAgLy8gYXR0YWNoZWQgc28gdGhvc2UgbGF0ZSByZWplY3Rpb25zIGFyZSByZWNvcmRlZCBpbnN0ZWFkIG9mIGVzY2FwaW5nIHRvXG4gICAgICAvLyB0aGUgZGVmYXVsdCBjcmFzaCBwYXRoIGFmdGVyIGNsZWFudXAuXG4gICAgICBmb3IgKGxldCBkcmFpblR1cm4gPSAwOyBkcmFpblR1cm4gPCAzOyBkcmFpblR1cm4rKykge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0SW1tZWRpYXRlKHJlc29sdmUpKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBwcm9jZXNzLm9mZihcInVuaGFuZGxlZFJlamVjdGlvblwiLCBvblVuaGFuZGxlZFJlamVjdGlvbilcbiAgICAgIHByb2Nlc3Mub2ZmKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgb25VbmNhdWdodEV4Y2VwdGlvbilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gYWZ0ZXIgYWxscyBmb3IgYWN0aXZlIHNjb3Blcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhbnVwIGhvb2tzIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIHJ1bkFmdGVyQWxsc0ZvckFjdGl2ZVNjb3BlcygpIHtcbiAgICBjb25zdCBzY29wZXMgPSBbLi4udGhpcy5fYWN0aXZlQWZ0ZXJBbGxTY29wZXNdLnJldmVyc2UoKVxuICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgIGNvbnN0IGFmdGVyQWxsRXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3Qgc2NvcGUgb2Ygc2NvcGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bkFmdGVyQWxsc0ZvclNjb3BlKHNjb3BlKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgYWZ0ZXJBbGxFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9hY3RpdmVBZnRlckFsbFNjb3BlcyA9IFtdXG5cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGFmdGVyQWxsRXJyb3JzWzBdXG4gICAgaWYgKGFmdGVyQWxsRXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihhZnRlckFsbEVycm9ycywgXCJNdWx0aXBsZSBhY3RpdmUgYWZ0ZXJBbGwgc2NvcGVzIGZhaWxlZFwiLCB7Y2F1c2U6IGFmdGVyQWxsRXJyb3JzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbmFseXplIHRlc3RzLlxuICAgKiBAcGFyYW0ge1Rlc3RzQXJndW1lbnR9IHRlc3RzIC0gVGVzdHMuXG4gICAqIEByZXR1cm5zIHt7YW55VGVzdHNGb2N1c3NlZDogYm9vbGVhbn19IC0gV2hldGhlciBhbnkgdGVzdHMgaW4gdGhlIHRyZWUgYXJlIGZvY3VzZWQuXG4gICAqL1xuICBhbmFseXplVGVzdHModGVzdHMpIHtcbiAgICBsZXQgYW55VGVzdHNGb2N1c3NlZEZvdW5kID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgdGVzdERlc2NyaXB0aW9uIGluIHRlc3RzLnRlc3RzKSB7XG4gICAgICBjb25zdCB0ZXN0RGF0YSA9IHRlc3RzLnRlc3RzW3Rlc3REZXNjcmlwdGlvbl1cbiAgICAgIGNvbnN0IHRlc3RBcmdzID0gT2JqZWN0LmFzc2lnbih7fSwgdGVzdERhdGEuYXJncylcblxuICAgICAgdGhpcy5fdGVzdHNDb3VudCsrXG5cbiAgICAgIGlmICh0ZXN0QXJncy5mb2N1cykge1xuICAgICAgICBhbnlUZXN0c0ZvY3Vzc2VkRm91bmQgPSB0cnVlXG4gICAgICAgIHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9IHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHN1YkRlc2NyaXB0aW9uIGluIHRlc3RzLnN1YnMpIHtcbiAgICAgIGNvbnN0IHN1YlRlc3QgPSB0ZXN0cy5zdWJzW3N1YkRlc2NyaXB0aW9uXVxuICAgICAgY29uc3Qge2FueVRlc3RzRm9jdXNzZWR9ID0gdGhpcy5hbmFseXplVGVzdHMoc3ViVGVzdClcblxuICAgICAgaWYgKGFueVRlc3RzRm9jdXNzZWQpIHtcbiAgICAgICAgYW55VGVzdHNGb2N1c3NlZEZvdW5kID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBzdWJUZXN0LmFueVRlc3RzRm9jdXNzZWQgPSBhbnlUZXN0c0ZvY3Vzc2VkXG4gICAgfVxuXG4gICAgcmV0dXJuIHthbnlUZXN0c0ZvY3Vzc2VkOiBhbnlUZXN0c0ZvY3Vzc2VkRm91bmR9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVyeSBhZnRlci1lYWNoIGhvb2sgd2hpbGUgcHJlc2VydmluZyB0aGUgZmlyc3QgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBIb29rIGV4ZWN1dGlvbiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGFyZ3MuYWZ0ZXJFYWNoZXMgLSBIb29rcyB0byBydW4uXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IGFyZ3MudGVzdEFyZ3MgLSBDdXJyZW50IHRlc3QgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gQ3VycmVudCB0ZXN0IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGhvb2sgcnVucy5cbiAgICovXG4gIGFzeW5jIHJ1bkFmdGVyRWFjaGVzKHthZnRlckVhY2hlcywgdGVzdEFyZ3MsIHRlc3REYXRhfSkge1xuICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgIGNvbnN0IGFmdGVyRWFjaEVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGFmdGVyRWFjaERhdGEgb2YgYWZ0ZXJFYWNoZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuUHJvZmlsZVNwYW4oe1xuICAgICAgICAgIHBoYXNlOiBcImFmdGVyRWFjaFwiLFxuICAgICAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IGFmdGVyRWFjaERhdGEuZGVjbGFyYXRpb25JbmRleCxcbiAgICAgICAgICBkZWNsYXJhdGlvblNjb3BlSWQ6IGFmdGVyRWFjaERhdGEuZGVjbGFyYXRpb25TY29wZUlkLFxuICAgICAgICAgIGZpbGVQYXRoOiBhZnRlckVhY2hEYXRhLm93bmVyRmlsZVBhdGhcbiAgICAgICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGFmdGVyRWFjaERhdGEuY2FsbGJhY2soe2NvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLCB0ZXN0QXJncywgdGVzdERhdGF9KVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgYWZ0ZXJFYWNoRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFmdGVyRWFjaEVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgYWZ0ZXJFYWNoRXJyb3JzWzBdXG4gICAgaWYgKGFmdGVyRWFjaEVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoYWZ0ZXJFYWNoRXJyb3JzLCBcIk11bHRpcGxlIGFmdGVyRWFjaCBob29rcyBmYWlsZWRcIiwge2NhdXNlOiBhZnRlckVhY2hFcnJvcnNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB0ZXN0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtBcnJheTxBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGU+fSBhcmdzLmFmdGVyRWFjaGVzIC0gQWZ0ZXIgZWFjaGVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZT59IGFyZ3MuYmVmb3JlRWFjaGVzIC0gQmVmb3JlIGVhY2hlcy5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBhcmdzLnRlc3RzIC0gVGVzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5pbmRlbnRMZXZlbCAtIEluZGVudCBsZXZlbC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5saW5lTWF0Y2hlZEluU2NvcGVdIC0gV2hldGhlciBsaW5lIG1hdGNoZWQgaW4gc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wYXJlbnRQcm9maWxlU2NvcGVJZF0gLSBQYXJlbnQgcHJvZmlsZSBzY29wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1blRlc3RzKHthZnRlckVhY2hlcywgYmVmb3JlRWFjaGVzLCB0ZXN0cywgZGVzY3JpcHRpb25zLCBpbmRlbnRMZXZlbCwgbGluZU1hdGNoZWRJblNjb3BlID0gZmFsc2UsIHBhcmVudFByb2ZpbGVTY29wZUlkfSkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBlbnZpcm9ubWVudEhhbmRsZXIuaW5zdGFsbFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UodGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSlcbiAgICBlbnZpcm9ubWVudEhhbmRsZXIuaW5zdGFsbFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSh0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UpXG4gICAgY29uc3QgbGVmdFBhZGRpbmcgPSBcIiBcIi5yZXBlYXQoaW5kZW50TGV2ZWwgKiAyKVxuICAgIGNvbnN0IHNjb3BlT3duZXJGaWxlUGF0aCA9IHRlc3RzLm93bmVyRmlsZVBhdGggPz8gdGVzdHMuZmlsZVBhdGhcbiAgICBjb25zdCBwcm9maWxlU2NvcGVJZCA9IHRoaXMuX3Byb2ZpbGVyPy5zY29wZUlkKHRlc3RzLCB7XG4gICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICBmaWxlUGF0aDogc2NvcGVPd25lckZpbGVQYXRoLFxuICAgICAgbGluZTogdGVzdHMubGluZSxcbiAgICAgIHBhcmVudElkOiBwYXJlbnRQcm9maWxlU2NvcGVJZFxuICAgIH0pXG4gICAgY29uc3Qgb3duQWZ0ZXJFYWNoZXMgPSBbLi4udGhpcy5wcm9maWxlSG9va0VudHJpZXModGVzdHMuYWZ0ZXJFYWNoZXMsIHByb2ZpbGVTY29wZUlkLCBzY29wZU93bmVyRmlsZVBhdGgpXS5yZXZlcnNlKClcbiAgICBjb25zdCBvd25CZWZvcmVFYWNoZXMgPSB0aGlzLnByb2ZpbGVIb29rRW50cmllcyh0ZXN0cy5iZWZvcmVFYWNoZXMsIHByb2ZpbGVTY29wZUlkLCBzY29wZU93bmVyRmlsZVBhdGgpXG4gICAgY29uc3QgbmV3QWZ0ZXJFYWNoZXMgPSBbLi4ub3duQWZ0ZXJFYWNoZXMsIC4uLmFmdGVyRWFjaGVzXVxuICAgIGNvbnN0IG5ld0JlZm9yZUVhY2hlcyA9IFsuLi5iZWZvcmVFYWNoZXMsIC4uLm93bkJlZm9yZUVhY2hlc11cbiAgICBjb25zdCBzY29wZUxpbmVNYXRjaCA9IGxpbmVNYXRjaGVkSW5TY29wZSB8fCB0aGlzLm1hdGNoZXNMaW5lRmlsdGVyKHRlc3RzKVxuICAgIGNvbnN0IHNob3VsZFJ1bkFueVRlc3RzID0gdGhpcy5oYXNSdW5uYWJsZVRlc3RzKHRlc3RzLCBkZXNjcmlwdGlvbnMsIHNjb3BlTGluZU1hdGNoKVxuXG4gICAgaWYgKCFzaG91bGRSdW5BbnlUZXN0cykgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge0FjdGl2ZUFmdGVyQWxsU2NvcGVFbnRyeX0gKi9cbiAgICBjb25zdCBzY29wZUVudHJ5ID0ge3Rlc3RzLCBhZnRlckFsbHNSdW46IGZhbHNlLCBwcm9maWxlU2NvcGVJZH1cbiAgICB0aGlzLl9hY3RpdmVBZnRlckFsbFNjb3Blcy5wdXNoKHNjb3BlRW50cnkpXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3Qgc2NvcGVFcnJvcnMgPSBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJlZm9yZUFsbHMgPSB0aGlzLnByb2ZpbGVIb29rRW50cmllcyh0ZXN0cy5iZWZvcmVBbGxzIHx8IFtdLCBwcm9maWxlU2NvcGVJZCwgc2NvcGVPd25lckZpbGVQYXRoKVxuXG4gICAgICBmb3IgKGNvbnN0IGJlZm9yZUFsbERhdGEgb2YgYmVmb3JlQWxscykge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1blByb2ZpbGVTcGFuKHtcbiAgICAgICAgICBwaGFzZTogXCJiZWZvcmVBbGxcIixcbiAgICAgICAgICBkZWNsYXJhdGlvbkluZGV4OiBiZWZvcmVBbGxEYXRhLmRlY2xhcmF0aW9uSW5kZXgsXG4gICAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBiZWZvcmVBbGxEYXRhLmRlY2xhcmF0aW9uU2NvcGVJZCxcbiAgICAgICAgICBmaWxlUGF0aDogYmVmb3JlQWxsRGF0YS5vd25lckZpbGVQYXRoXG4gICAgICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBiZWZvcmVBbGxEYXRhLmNhbGxiYWNrKHtjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKX0pXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgdGVzdERlc2NyaXB0aW9uIGluIHRlc3RzLnRlc3RzKSB7XG4gICAgICAgIGNvbnN0IHRlc3REYXRhID0gdGVzdHMudGVzdHNbdGVzdERlc2NyaXB0aW9uXVxuICAgICAgICBjb25zdCB0ZXN0QXJncyA9IC8qKiBAdHlwZSB7VGVzdEFyZ3N9ICovIChPYmplY3QuYXNzaWduKHt9LCB0ZXN0RGF0YS5hcmdzKSlcbiAgICAgICAgY29uc3QgaW5jbHVkZUJ5TGluZSA9IHNjb3BlTGluZU1hdGNoIHx8IHRoaXMubWF0Y2hlc0xpbmVGaWx0ZXIodGVzdERhdGEpXG5cbiAgICAgICAgaWYgKHRoaXMuX29ubHlGb2N1c3NlZCAmJiAhdGVzdEFyZ3MuZm9jdXMpIGNvbnRpbnVlXG4gICAgICAgIGlmICh0aGlzLnNob3VsZFNraXBUZXN0KHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9uLCBkZXNjcmlwdGlvbnMsIGluY2x1ZGVCeUxpbmUpKSBjb250aW51ZVxuXG4gICAgICAgIGlmICh0ZXN0QXJncy50eXBlID09IFwibW9kZWxcIiB8fCB0ZXN0QXJncy50eXBlID09IFwicmVxdWVzdFwiKSB7XG4gICAgICAgICAgdGVzdEFyZ3MuYXBwbGljYXRpb24gPSBhd2FpdCB0aGlzLmFwcGxpY2F0aW9uKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0ZXN0QXJncy50eXBlID09IFwicmVxdWVzdFwiKSB7XG4gICAgICAgICAgdGVzdEFyZ3MuY2xpZW50ID0gYXdhaXQgdGhpcy5yZXF1ZXN0Q2xpZW50KClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJldHJ5Q291bnQgPSB0eXBlb2YgdGVzdEFyZ3MucmV0cnkgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHRlc3RBcmdzLnJldHJ5KVxuICAgICAgICAgID8gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcih0ZXN0QXJncy5yZXRyeSkpXG4gICAgICAgICAgOiAwXG4gICAgICAgIGNvbnN0IGNvbmZpZ1RpbWVvdXRTZWNvbmRzID0gdHlwZW9mIHRlc3RDb25maWcuZGVmYXVsdFRpbWVvdXRTZWNvbmRzID09PSBcIm51bWJlclwiID8gdGVzdENvbmZpZy5kZWZhdWx0VGltZW91dFNlY29uZHMgOiB1bmRlZmluZWRcbiAgICAgICAgY29uc3QgdGltZW91dFNlY29uZHMgPSB0eXBlb2YgdGVzdEFyZ3MudGltZW91dFNlY29uZHMgPT09IFwibnVtYmVyXCIgPyB0ZXN0QXJncy50aW1lb3V0U2Vjb25kcyA6IGNvbmZpZ1RpbWVvdXRTZWNvbmRzXG4gICAgICAgIGNvbnN0IHVzZVRpbWVvdXQgPSB0eXBlb2YgdGltZW91dFNlY29uZHMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHRpbWVvdXRTZWNvbmRzKSAmJiB0aW1lb3V0U2Vjb25kcyA+IDBcbiAgICAgICAgY29uc3QgdGltZW91dE1zID0gdXNlVGltZW91dCA/IHRpbWVvdXRTZWNvbmRzICogMTAwMCA6IHVuZGVmaW5lZFxuICAgICAgICBsZXQgcmV0cmllc1VzZWQgPSAwXG4gICAgICAgIGxldCBhdHRlbXB0TnVtYmVyID0gMVxuICAgICAgICAvKipcbiAgICAgICAgICogQXR0ZW1wdCBjb25zb2xlIG91dHB1dHMuXG4gICAgICAgICAqIEB0eXBlIHtBdHRlbXB0Q29uc29sZU91dHB1dFtdfSAqL1xuICAgICAgICBjb25zdCBhdHRlbXB0Q29uc29sZU91dHB1dHMgPSBbXVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGAke2xlZnRQYWRkaW5nfWl0ICR7dGVzdERlc2NyaXB0aW9ufWApXG5cbiAgICAgICAgY29uc3QgdGVzdFN0YXJ0TXMgPSBEYXRlLm5vdygpXG5cbiAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICBsZXQgc2hvdWxkUmV0cnkgPSBmYWxzZVxuICAgICAgICAgIC8qKlxuICAgICAgICAgICAqIERlZmluZXMgY2F1Z2h0RXJyb3IuXG4gICAgICAgICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgICAgICAgIGxldCBjYXVnaHRFcnJvclxuICAgICAgICAgIC8qKlxuICAgICAgICAgICAqIERlZmluZXMgZmFpbGVkRXJyb3IuXG4gICAgICAgICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgICAgICAgIGxldCBmYWlsZWRFcnJvclxuICAgICAgICAgIC8qKlxuICAgICAgICAgICAqIERlZmluZXMgbGFzdEVycm9yLlxuICAgICAgICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICAgICAgICBsZXQgbGFzdEVycm9yXG4gICAgICAgICAgbGV0IHdpbGxSZXRyeSA9IGZhbHNlXG4gICAgICAgICAgLyoqXG4gICAgICAgICAgICogVGhlIHBlci10ZXN0IGxpZmVjeWNsZSBwcm9taXNlLCBob2lzdGVkIHNvIHRoZSB0aW1lb3V0IGJyYW5jaCBjYW5cbiAgICAgICAgICAgKiBzdGlsbCB3YWl0IGZvciBpdCB0byBzZXR0bGUgYWZ0ZXIgcnVuV2l0aFRpbWVvdXQgaGFzIGFiYW5kb25lZCBpdC5cbiAgICAgICAgICAgKiBAdHlwZSB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gICAgICAgICAgbGV0IHRlc3RMaWZlY3ljbGVcbiAgICAgICAgICAvKiogQHR5cGUge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119ICovXG4gICAgICAgICAgbGV0IHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdXG4gICAgICAgICAgbGV0IHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IGZhbHNlXG4gICAgICAgICAgLyoqIEB0eXBlIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgICAgICAgICBsZXQgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb25cbiAgICAgICAgICAvKiogQHR5cGUge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICAgIGxldCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uXG4gICAgICAgICAgLyoqIEB0eXBlIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119ICovXG4gICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgICAgICAgIC8qKiBAdHlwZSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSAqL1xuICAgICAgICAgIGNvbnN0IGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICAgICAgICBjb25zdCB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSA9IHtyZXZva2VkOiBmYWxzZX1cbiAgICAgICAgICAvKiogQHR5cGUge1NldDxFcnJvcj59ICovXG4gICAgICAgICAgY29uc3QgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycyA9IG5ldyBTZXQoKVxuICAgICAgICAgIHRlc3RBcmdzLnJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCA9IGFzeW5jIChhcmdzKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudChhcmdzLCB0cmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ucylcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3Qgc3RvcENvbnNvbGVDYXB0dXJlID0gdGhpcy5zdGFydENvbnNvbGVDYXB0dXJlKHtcbiAgICAgICAgICAgIHBhc3N0aHJvdWdoOiB0ZXN0Q29uZmlnLmNvbnNvbGVPdXRwdXQgPT09IFwibGl2ZVwiXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb25zdCBwcm9maWxlciA9IHRoaXMuX3Byb2ZpbGVyXG4gICAgICAgICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSBwcm9maWxlcj8uc3RhcnRBdHRlbXB0KHtcbiAgICAgICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgICAgIGF0dGVtcHROdW1iZXIsXG4gICAgICAgICAgICB0ZXN0RGF0YSxcbiAgICAgICAgICAgIHRlc3REZXNjcmlwdGlvblxuICAgICAgICAgIH0pXG4gICAgICAgICAgbGV0IGF0dGVtcHRUaW1lZE91dCA9IGZhbHNlXG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gUnVuIHRoZSB3aG9sZSBwZXItdGVzdCBsaWZlY3ljbGUgKGR1bW15L3NlcnZlciBzdGFydHVwLCBjb25uZWN0aW9uXG4gICAgICAgICAgICAvLyBhY3F1aXNpdGlvbiwgYmVmb3JlRWFjaCBob29rcywgdGhlIHRlc3QgYm9keSBhbmQgYWZ0ZXJFYWNoIGhvb2tzKSBhc1xuICAgICAgICAgICAgLy8gb25lIHByb21pc2Ugc28gdGhlIHRpbWVvdXQgYmVsb3cgY2FuIGNvdmVyIGFsbCBvZiBpdC5cbiAgICAgICAgICAgIGNvbnN0IHJ1bkxpZmVjeWNsZUNhbGxiYWNrID0gYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5ydW5XaXRoRHVtbXlJZk5lZWRlZCh0ZXN0QXJncywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCB1c2VUcmFuc2FjdGlvbiA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRyYW5zYWN0aW9uID09PSB0cnVlXG4gICAgICAgICAgICAgIGNvbnN0IHNob3VsZFRydW5jYXRlID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJ1bmNhdGUgPz8gIXVzZVRyYW5zYWN0aW9uXG4gICAgICAgICAgICAgIGNvbnN0IHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucyA9IHVzZVRyYW5zYWN0aW9uIHx8IHRlc3RBcmdzLnR5cGUgPT0gXCJyZXF1ZXN0XCJcbiAgICAgICAgICAgICAgY29uc3QgdXNlVGVzdENvbm5lY3Rpb25zID0gdXNlU2hhcmVkVGVzdENvbm5lY3Rpb25zIHx8IHNob3VsZFRydW5jYXRlXG4gICAgICAgICAgICAgIGNvbnN0IHJ1blRlc3RBdHRlbXB0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIFJlZ2lzdGVyIGR5bmFtaWMgY2FuZGlkYXRlcyBiZWZvcmUgaG9va3Mgc28gdHJhbnNhY3Rpb24gc3RhdGUgY2hhbmdlc1xuICAgICAgICAgICAgICAgIC8vIG1hZGUgZHVyaW5nIGEgaG9vayBhcmUgaW1tZWRpYXRlbHkgdmlzaWJsZSB0byBhbnkgaW4tcHJvY2VzcyB3b3JrLlxuICAgICAgICAgICAgICAgIC8vIFByZXBhcmUgdHJhbnNhY3Rpb24gc2hhcmluZyBiZWZvcmUgaG9va3Mgc28gbG9uZy1saXZlZCBzZXJ2aWNlcyBjYW5ub3RcbiAgICAgICAgICAgICAgICAvLyB1c2UgdGhlIHNoYXJlZCBjb25uZWN0aW9uIHdoaWxlIGl0cyBjb29yZGluYXRvciBpcyBzdGlsbCBtaXNzaW5nLlxuICAgICAgICAgICAgICAgIGlmICh1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IHRoaXMuYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnMoKVxuICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICAgICAgICAgICAgICBjb25zdCBsaWZlY3ljbGVFcnJvcnMgPSBbXVxuICAgICAgICAgICAgICAgIGxldCBydW5DbGVhbnVwSG9va3MgPSBmYWxzZVxuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGlmICh1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IGF3YWl0IHRoaXMucHJlcGFyZVNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKClcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIHJ1bkNsZWFudXBIb29rcyA9IHRydWVcblxuICAgICAgICAgICAgICAgICAgY2xlYXJEZWxpdmVyaWVzKClcbiAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYmVmb3JlRWFjaERhdGEgb2YgbmV3QmVmb3JlRWFjaGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucnVuUHJvZmlsZVNwYW4oe1xuICAgICAgICAgICAgICAgICAgICAgIHBoYXNlOiBcImJlZm9yZUVhY2hcIixcbiAgICAgICAgICAgICAgICAgICAgICBkZWNsYXJhdGlvbkluZGV4OiBiZWZvcmVFYWNoRGF0YS5kZWNsYXJhdGlvbkluZGV4LFxuICAgICAgICAgICAgICAgICAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogYmVmb3JlRWFjaERhdGEuZGVjbGFyYXRpb25TY29wZUlkLFxuICAgICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoOiBiZWZvcmVFYWNoRGF0YS5vd25lckZpbGVQYXRoXG4gICAgICAgICAgICAgICAgICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBiZWZvcmVFYWNoRGF0YS5jYWxsYmFjayh7Y29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksIHRlc3RBcmdzLCB0ZXN0RGF0YX0pXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgIGlmICh1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyA9IHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seTogdHJ1ZX0pXG4gICAgICAgICAgICAgICAgICAgIGlmIChzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uICYmICF0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24sIGFjdGl2ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyh0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICAgICAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gPSBhd2FpdCB0aGlzLnN0YXJ0U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiwgYWN0aXZlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucylcbiAgICAgICAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgICAgICAgICBpZiAoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gJiYgIXRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IHRoaXMuYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnMoKVxuICAgICAgICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAvLyBSZWNvcmQgd2hpY2ggdGVzdCBpcyBydW5uaW5nIHNvIGFuIGFzeW5jIGNyYXNoIChhbiB1bmhhbmRsZWRcbiAgICAgICAgICAgICAgICAgIC8vIHJlamVjdGlvbiBkZXRhY2hlZCBmcm9tIGFueSBhd2FpdCkgdGhhdCBmaXJlcyBkdXJpbmcgb3Igc2hvcnRseVxuICAgICAgICAgICAgICAgICAgLy8gYWZ0ZXIgdGhpcyB0ZXN0IGNhbiBiZSBhdHRyaWJ1dGVkIHRvIGl0IGluIHJ1bigpJ3MgaGFuZGxlci5cbiAgICAgICAgICAgICAgICAgIHRoaXMuX2xhc3RUZXN0Q29udGV4dCA9IHtcbiAgICAgICAgICAgICAgICAgICAgZnVsbERlc2NyaXB0aW9uOiB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSxcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoID8/IFwiPHVua25vd24+XCIsXG4gICAgICAgICAgICAgICAgICAgIGxpbmU6IHRlc3REYXRhLmxpbmUgPz8gMFxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5ydW5Qcm9maWxlU3Bhbih7cGhhc2U6IFwidGVzdCBib2R5XCIsIGZpbGVQYXRoOiB0ZXN0RGF0YS5vd25lckZpbGVQYXRoID8/IHRlc3REYXRhLmZpbGVQYXRofSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0ZXN0RGF0YS5mdW5jdGlvbih0ZXN0QXJncylcbiAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChydW5DbGVhbnVwSG9va3MpIHtcbiAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEZyYW1ld29yay1vd25lZCBwb3N0LWNvbW1pdCBicm9hZGNhc3RzIGFyZSBpbnRlbnRpb25hbGx5XG4gICAgICAgICAgICAgICAgICAgIC8vIGRldGFjaGVkOyBkcmFpbiB0aGVtIGJlZm9yZSB0ZXN0IGNsZWFudXAgc28gdGhlaXIgREJcbiAgICAgICAgICAgICAgICAgICAgLy8gY2hlY2tvdXRzIGNhbm5vdCBsZWFrIGludG8gdGhlIG5leHQgdGVzdCdzIGxpZmVjeWNsZS5cbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG4gICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnModGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdXG4gICAgICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gZmFsc2VcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHx8IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24pXG4gICAgICAgICAgICAgICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnJ1bkFmdGVyRWFjaGVzKHthZnRlckVhY2hlczogbmV3QWZ0ZXJFYWNoZXMsIHRlc3RBcmdzLCB0ZXN0RGF0YX0pXG4gICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHModHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAodGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gZmFsc2VcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBsaWZlY3ljbGVFcnJvcnNbMF1cbiAgICAgICAgICAgICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihsaWZlY3ljbGVFcnJvcnMsIFwiVGVzdCBsaWZlY3ljbGUgYW5kIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogbGlmZWN5Y2xlRXJyb3JzWzBdfSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBpZiAodXNlVGVzdENvbm5lY3Rpb25zKSB7XG4gICAgICAgICAgICAgICAgLy8gRGF0YWJhc2UgY2xlYW5pbmcgcmVxdWlyZXMgb25lIGNvbm5lY3Rpb24gZm9yIGJlZm9yZUVhY2gsIHRoZSB0ZXN0XG4gICAgICAgICAgICAgICAgLy8gYm9keSBhbmQgYWZ0ZXJFYWNoOyBvbmx5IHRyYW5zYWN0aW9ucyBhbmQgcmVxdWVzdHMgc2hhcmUgaXQgZHluYW1pY2FsbHkuXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGBUZXN0OiAke3Rlc3REZXNjcmlwdGlvbn1gfSwgcnVuVGVzdEF0dGVtcHQpXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgcnVuVGVzdEF0dGVtcHQoKVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgIGNvbnN0IGxpZmVjeWNsZUNhbGxiYWNrID0gYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkucnVuV2l0aFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLCBydW5MaWZlY3ljbGVDYWxsYmFjaylcbiAgICAgICAgICAgIHRlc3RMaWZlY3ljbGUgPSBwcm9maWxlQXR0ZW1wdCAmJiBwcm9maWxlclxuICAgICAgICAgICAgICA/IHByb2ZpbGVyLnJ1bkF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGxpZmVjeWNsZUNhbGxiYWNrKVxuICAgICAgICAgICAgICA6IGxpZmVjeWNsZUNhbGxiYWNrKClcblxuICAgICAgICAgICAgLy8gVGltZSBvdXQgdGhlIEVOVElSRSBsaWZlY3ljbGUsIG5vdCBqdXN0IHRoZSB0ZXN0IGJvZHkuIEEgaGFuZyBpbiBhbnlcbiAgICAgICAgICAgIC8vIHBoYXNlIOKAlCBhIGNvbm5lY3Rpb24gY2hlY2tvdXQgdGhhdCBuZXZlciByZXNvbHZlcywgYSBiZWZvcmVFYWNoL2FmdGVyRWFjaFxuICAgICAgICAgICAgLy8gd2FpdGluZyBvbiBhIGxvY2ssIG9yIGR1bW15IHNlcnZlciBzdGFydHVwIOKAlCB3b3VsZCBvdGhlcndpc2Ugc3RhbGwgdGhlXG4gICAgICAgICAgICAvLyB3aG9sZSBydW4gaW5kZWZpbml0ZWx5ICh1bnRpbCBDSSBraWxscyB0aGUgYnVpbGQpIGluc3RlYWQgb2YgZmFpbGluZyB0aGVcbiAgICAgICAgICAgIC8vIHNpbmdsZSBvZmZlbmRpbmcgdGVzdC5cbiAgICAgICAgICAgIGlmICh1c2VUaW1lb3V0ICYmIHRpbWVvdXRNcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIGF3YWl0IHJ1bldpdGhUaW1lb3V0KHRlc3RMaWZlY3ljbGUsIHRpbWVvdXRNcywgdGVzdERlc2NyaXB0aW9uKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgYXdhaXQgdGVzdExpZmVjeWNsZVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBBIHRlc3QgaXMgc3VjY2Vzc2Z1bCBvbmx5IGFmdGVyIGl0cyBjb21wbGV0ZSBsaWZlY3ljbGUgc2V0dGxlcy5cbiAgICAgICAgICAgIC8vIENsZWFudXAgZmFpbHVyZXMgYW5kIHRpbWVkLW91dCBkZXRhY2hlZCB3b3JrIG11c3Qgbm90IG92ZXJsYXAgdGhlXG4gICAgICAgICAgICAvLyBmaW5hbCBzdWNjZXNzZnVsIGFuZCBmYWlsZWQgY291bnRlcnMgdXNlZCBmb3IgZXhlY3V0ZWQtdGVzdCB0b3RhbHMuXG4gICAgICAgICAgICB0aGlzLl9zdWNjZXNzZnVsVGVzdHMrK1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjYXVnaHRFcnJvciA9IGVycm9yXG4gICAgICAgICAgICBsYXN0RXJyb3IgPSBlcnJvclxuXG4gICAgICAgICAgICAvLyBBIHRpbWVvdXQgUkVKRUNUUyB3aGlsZSB0aGUgbGlmZWN5Y2xlIGtlZXBzIHJ1bm5pbmcgZGV0YWNoZWQgb24gdGhlXG4gICAgICAgICAgICAvLyBzaGFyZWQgcGVyLXN1aXRlIGNvbm5lY3Rpb24g4oCUIGluY2x1ZGluZyBpdHMgYWZ0ZXJFYWNoIGRhdGFiYXNlXG4gICAgICAgICAgICAvLyBjbGVhbnVwIChlLmcuIHRyYW5zYWN0aW9uIHJvbGxiYWNrKS4gSWYgdGhlIG5leHQgdGVzdCBzdGFydHMgYmVmb3JlXG4gICAgICAgICAgICAvLyB0aGF0IHJvbGxiYWNrIHJ1bnMsIGl0cyBvd24gc3RhcnRUcmFuc2FjdGlvbigpIGltcGxpY2l0bHkgQ09NTUlUU1xuICAgICAgICAgICAgLy8gdGhlIHRpbWVkLW91dCB0ZXN0J3Mgcm93cyBvbiB0aGUgc2hhcmVkIGNvbm5lY3Rpb24sIHBvaXNvbmluZyBldmVyeVxuICAgICAgICAgICAgLy8gbGF0ZXIgdGVzdCBpbiB0aGUgc2hhcmQgKGR1cGxpY2F0ZS1rZXkgLyBmb3JlaWduLWtleSBjYXNjYWRlcyBmcm9tXG4gICAgICAgICAgICAvLyBsZWFrZWQgZml4dHVyZXMpLiBXYWl0IOKAlCBib3VuZGVkIOKAlCBmb3IgdGhlIGFiYW5kb25lZCBsaWZlY3ljbGUgdG9cbiAgICAgICAgICAgIC8vIHNldHRsZSBzbyBpdHMgY2xlYW51cCBsYW5kcyBmaXJzdC4gSWYgaXQgcmVtYWlucyBhY3RpdmUgYWZ0ZXIgdGhlXG4gICAgICAgICAgICAvLyBib3VuZGVkIGdyYWNlLCBxdWFyYW50aW5lIGl0cyBicm93c2VyIGNvbm5lY3Rpb25zIGFuZCBzdG9wIHJ1bm5pbmdcbiAgICAgICAgICAgIC8vIHRlc3RzIHJhdGhlciB0aGFuIHNoYXJpbmcgdW5zYWZlIHN0YXRlLlxuICAgICAgICAgICAgY29uc3QgdGltZWRPdXQgPSBCb29sZWFuKC8qKiBAdHlwZSB7VGVzdFRpbWVvdXRFcnJvcn0gKi8gKGVycm9yKT8udmVsb2Npb3VzVGVzdFRpbWVvdXQpXG4gICAgICAgICAgICBhdHRlbXB0VGltZWRPdXQgPSB0aW1lZE91dFxuXG4gICAgICAgICAgICBpZiAodGltZWRPdXQgJiYgdGVzdExpZmVjeWNsZSkge1xuICAgICAgICAgICAgICBjb25zdCBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzID0gW11cblxuICAgICAgICAgICAgICBpZiAocHJvZmlsZUF0dGVtcHQgJiYgcHJvZmlsZXIpIHByb2ZpbGVyLmZpbmlzaEF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIFwidGltZWQtb3V0XCIpXG4gICAgICAgICAgICAgIGNvbnN0IGxpZmVjeWNsZU91dGNvbWUgPSBhd2FpdCBhd2FpdFNldHRsZWRPckdyYWNlKHRlc3RMaWZlY3ljbGUsIHRpbWVvdXRNcyA/PyA2MDAwMClcblxuICAgICAgICAgICAgICBpZiAobGlmZWN5Y2xlT3V0Y29tZS5zZXR0bGVkICYmIGxpZmVjeWNsZU91dGNvbWUuc3RhdHVzID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICAgICAgICBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLnB1c2gobGlmZWN5Y2xlT3V0Y29tZS5yZWFzb24pXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAvLyBJZiB0aGUgYWJhbmRvbmVkIGxpZmVjeWNsZSBuZXZlciBzZXR0bGVkIHdpdGhpbiB0aGUgZ3JhY2UsIGl0c1xuICAgICAgICAgICAgICAvLyBjbGVhbnVwIGhhcyBub3QgY29tcGxldGVkLiBRdWFyYW50aW5lIGJyb3dzZXItb3duZWQgY29ubmVjdGlvbnNcbiAgICAgICAgICAgICAgLy8gYmVmb3JlIGFueSBzY29wZSBjbGVhbnVwIGNhbiByYWNlIHRoZSBhYmFuZG9uZWQgY2FsbGJhY2suXG4gICAgICAgICAgICAgIGlmICghbGlmZWN5Y2xlT3V0Y29tZS5zZXR0bGVkKSB7XG4gICAgICAgICAgICAgICAgdGVzdERhdGFiYXNlQWNjZXNzU2NvcGUucmV2b2tlZCA9IHRydWVcbiAgICAgICAgICAgICAgICB2b2lkIHRlc3RMaWZlY3ljbGUuY2F0Y2goKGNsZWFudXBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGlzVGVzdERhdGFiYXNlQWNjZXNzUmV2b2NhdGlvbihjbGVhbnVwRXJyb3IpKSByZXR1cm5cbiAgICAgICAgICAgICAgICAgIHRoaXMucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGNsZWFudXBFcnJvciwgXCJ0ZXN0IGxpZmVjeWNsZVwiLCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgY29uc3QgcXVhcmFudGluZSA9IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb25zKGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgICAgIGNvbnN0IHF1YXJhbnRpbmVPdXRjb21lID0gYXdhaXQgYXdhaXRTZXR0bGVkT3JHcmFjZShxdWFyYW50aW5lLCB0aW1lb3V0TXMgPz8gNjAwMDApXG4gICAgICAgICAgICAgICAgY29uc3QgdXNlc0Jyb3dzZXJUcmFuc2FjdGlvbnMgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cmFuc2FjdGlvbiA9PT0gdHJ1ZVxuICAgICAgICAgICAgICAgIGNvbnN0IHVzZXNCcm93c2VyVHJ1bmNhdGlvbiA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRydW5jYXRlID8/ICF1c2VzQnJvd3NlclRyYW5zYWN0aW9uc1xuXG4gICAgICAgICAgICAgICAgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IHRoaXMuaXNCcm93c2VyVGVzdE1vZGUoKVxuICAgICAgICAgICAgICAgICAgJiYgdGhpcy5oYXNUYWcodGVzdEFyZ3MsIFwiZHVtbXlcIilcbiAgICAgICAgICAgICAgICAgICYmICh1c2VzQnJvd3NlclRyYW5zYWN0aW9ucyB8fCB1c2VzQnJvd3NlclRydW5jYXRpb24pXG5cbiAgICAgICAgICAgICAgICBpZiAocXVhcmFudGluZU91dGNvbWUuc2V0dGxlZCAmJiBxdWFyYW50aW5lT3V0Y29tZS5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgICAgICAgICAgZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5wdXNoKHF1YXJhbnRpbmVPdXRjb21lLnJlYXNvbilcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCFxdWFyYW50aW5lT3V0Y29tZS5zZXR0bGVkKSB7XG4gICAgICAgICAgICAgICAgICB2b2lkIHF1YXJhbnRpbmUuY2F0Y2goKGNsZWFudXBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShjbGVhbnVwRXJyb3IsIFwiYnJvd3NlciBkdW1teSBjb25uZWN0aW9uIHF1YXJhbnRpbmVcIiwgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycylcbiAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBpZiAodGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdXG4gICAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgICAgICAgICAgZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5wdXNoKGNsZWFudXBFcnJvcilcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IGJyb2tlckNsZWFudXAgPSB0aGlzLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8fCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uKVxuICAgICAgICAgICAgICBjb25zdCBicm9rZXJDbGVhbnVwT3V0Y29tZSA9IGF3YWl0IGF3YWl0U2V0dGxlZE9yR3JhY2UoYnJva2VyQ2xlYW51cCwgdGltZW91dE1zID8/IDYwMDAwKVxuXG4gICAgICAgICAgICAgIGlmIChicm9rZXJDbGVhbnVwT3V0Y29tZS5zZXR0bGVkICYmIGJyb2tlckNsZWFudXBPdXRjb21lLnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKSB7XG4gICAgICAgICAgICAgICAgZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5wdXNoKGJyb2tlckNsZWFudXBPdXRjb21lLnJlYXNvbilcbiAgICAgICAgICAgICAgfSBlbHNlIGlmICghYnJva2VyQ2xlYW51cE91dGNvbWUuc2V0dGxlZCkge1xuICAgICAgICAgICAgICAgIHZvaWQgYnJva2VyQ2xlYW51cC5jYXRjaCgoY2xlYW51cEVycm9yKSA9PiB7XG4gICAgICAgICAgICAgICAgICB0aGlzLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShjbGVhbnVwRXJyb3IsIFwic2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlclwiLCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgICBjb25zdCBlbWVyZ2VuY3lDbGVhbnVwID0gdGhpcy5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHModHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbnMsIHtkaXNjYXJkOiB0cnVlfSlcbiAgICAgICAgICAgICAgY29uc3QgZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUgPSBhd2FpdCBhd2FpdFNldHRsZWRPckdyYWNlKGVtZXJnZW5jeUNsZWFudXAsIHRpbWVvdXRNcyA/PyA2MDAwMClcblxuICAgICAgICAgICAgICBpZiAoZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUuc2V0dGxlZCAmJiBlbWVyZ2VuY3lDbGVhbnVwT3V0Y29tZS5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChlbWVyZ2VuY3lDbGVhbnVwT3V0Y29tZS5yZWFzb24pXG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAoIWVtZXJnZW5jeUNsZWFudXBPdXRjb21lLnNldHRsZWQpIHtcbiAgICAgICAgICAgICAgICAvLyBUaGUgdGltZWQtb3V0IGF0dGVtcHQgbXVzdCBub3QgYmxvY2sgdGhlIHJ1bm5lciBpbmRlZmluaXRlbHksIGJ1dCBhXG4gICAgICAgICAgICAgICAgLy8gbGF0ZXIgcm9sbGJhY2svZGlzY2FyZCBmYWlsdXJlIHN0aWxsIGJlY29tZXMgYSB2aXNpYmxlIHRlc3QgZmFpbHVyZS5cbiAgICAgICAgICAgICAgICB2b2lkIGVtZXJnZW5jeUNsZWFudXAuY2F0Y2goKGNsZWFudXBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgICAgdGhpcy5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoY2xlYW51cEVycm9yLCBcInRyYW5zYWN0aW9uYWwgdGVuYW50XCIsIHJlY29yZGVkVGltZW91dENsZWFudXBFcnJvcnMpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGlmIChlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBjYXVnaHRFcnJvciA9IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgICAgICAgIFtjYXVnaHRFcnJvciwgLi4uZW1lcmdlbmN5Q2xlYW51cEVycm9yc10sXG4gICAgICAgICAgICAgICAgICBcIlRlc3QgdGltZW91dCBhbmQgZW1lcmdlbmN5IGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAgICAgICAgICB7Y2F1c2U6IGNhdWdodEVycm9yfVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICBsYXN0RXJyb3IgPSBjYXVnaHRFcnJvclxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucy5zb21lKChyZWdpc3RyYXRpb24pID0+IHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkpIHtcbiAgICAgICAgICAgICAgdGVzdERhdGFiYXNlQWNjZXNzU2NvcGUucmV2b2tlZCA9IHRydWVcbiAgICAgICAgICAgICAgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IHRydWVcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgd2lsbFJldHJ5ID0gIXRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgJiYgcmV0cmllc1VzZWQgPCByZXRyeUNvdW50XG5cbiAgICAgICAgICAgIGlmICh3aWxsUmV0cnkpIHtcbiAgICAgICAgICAgICAgcmV0cmllc1VzZWQrK1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAod2lsbFJldHJ5KSB7XG4gICAgICAgICAgICAgIHNob3VsZFJldHJ5ID0gdHJ1ZVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgZmFpbGVkRXJyb3IgPSBjYXVnaHRFcnJvclxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZS5yZXZva2VkID0gdHJ1ZVxuICAgICAgICAgICAgY29uc3QgY29uc29sZU91dHB1dCA9IHN0b3BDb25zb2xlQ2FwdHVyZSgpXG5cbiAgICAgICAgICAgIGlmIChwcm9maWxlQXR0ZW1wdCAmJiBwcm9maWxlcikge1xuICAgICAgICAgICAgICBwcm9maWxlci5maW5pc2hBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBjYXVnaHRFcnJvciA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgICAgPyBcInBhc3NlZFwiXG4gICAgICAgICAgICAgICAgOiAoYXR0ZW1wdFRpbWVkT3V0ID8gXCJ0aW1lZC1vdXRcIiA6IFwiZmFpbGVkXCIpKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY29uc29sZU91dHB1dCkge1xuICAgICAgICAgICAgICBhdHRlbXB0Q29uc29sZU91dHB1dHMucHVzaCh7YXR0ZW1wdE51bWJlciwgb3V0cHV0OiBjb25zb2xlT3V0cHV0fSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoY2F1Z2h0RXJyb3IgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5lbWl0RXZlbnQoXCJ0ZXN0QXR0ZW1wdEZhaWxlZFwiLCB7XG4gICAgICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgICAgICAgIGVycm9yOiBjYXVnaHRFcnJvcixcbiAgICAgICAgICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgICAgICAgICAgbmV4dEF0dGVtcHQ6IHdpbGxSZXRyeSA/IGF0dGVtcHROdW1iZXIgKyAxIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICByZXRyaWVzVXNlZCxcbiAgICAgICAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgICAgICAgdGVzdEFyZ3MsXG4gICAgICAgICAgICAgIHRlc3REYXRhLFxuICAgICAgICAgICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICAgICAgICAgIHRlc3RSdW5uZXI6IHRoaXMsXG4gICAgICAgICAgICAgIHdpbGxSZXRyeVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoc2hvdWxkUmV0cnkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIFJldHJ5aW5nICgke3JldHJpZXNVc2VkfS8ke3JldHJ5Q291bnR9KSBhZnRlciBlcnJvcjogJHtsYXN0RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGxhc3RFcnJvci5tZXNzYWdlIDogU3RyaW5nKGxhc3RFcnJvcil9YCkpXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RSZXRyeWluZ1wiLCB7XG4gICAgICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgICAgICAgIGVycm9yOiBsYXN0RXJyb3IsXG4gICAgICAgICAgICAgIG5leHRBdHRlbXB0OiBhdHRlbXB0TnVtYmVyICsgMSxcbiAgICAgICAgICAgICAgcmV0cmllc1VzZWQsXG4gICAgICAgICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgICAgICAgIHRlc3RBcmdzLFxuICAgICAgICAgICAgICB0ZXN0RGF0YSxcbiAgICAgICAgICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgICAgICAgICB0ZXN0UnVubmVyOiB0aGlzXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChhdHRlbXB0TnVtYmVyID4gMSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5lbWl0RXZlbnQoXCJ0ZXN0UmV0cmllZFwiLCB7XG4gICAgICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgICAgICAgIGVycm9yOiBsYXN0RXJyb3IsXG4gICAgICAgICAgICAgIGF0dGVtcHROdW1iZXIsXG4gICAgICAgICAgICAgIHJldHJpZXNVc2VkLFxuICAgICAgICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICAgICAgICB0ZXN0QXJncyxcbiAgICAgICAgICAgICAgdGVzdERhdGEsXG4gICAgICAgICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgdGVzdFJ1bm5lcjogdGhpc1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhdHRlbXB0TnVtYmVyKytcblxuICAgICAgICAgIGlmIChzaG91bGRSZXRyeSkgY29udGludWVcblxuICAgICAgICAgIGlmIChmYWlsZWRFcnJvcikge1xuICAgICAgICAgICAgY29uc3QgY29uc29sZU91dHB1dCA9IHRoaXMuYnVpbGRDb25zb2xlT3V0cHV0KGF0dGVtcHRDb25zb2xlT3V0cHV0cylcblxuICAgICAgICAgICAgaWYgKGZhaWxlZEVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIFRlc3QgZmFpbGVkOiAke2ZhaWxlZEVycm9yLm1lc3NhZ2V9YCkpXG4gICAgICAgICAgICAgIGFkZFRyYWNrZWRTdGFja1RvRXJyb3IoZmFpbGVkRXJyb3IpXG5cbiAgICAgICAgICAgICAgY29uc3QgYmFja3RyYWNlQ2xlYW5lciA9IG5ldyBCYWNrdHJhY2VDbGVhbmVyKGZhaWxlZEVycm9yKVxuICAgICAgICAgICAgICBjb25zdCBjbGVhbmVkU3RhY2sgPSBiYWNrdHJhY2VDbGVhbmVyLmdldENsZWFuZWRTdGFjaygpXG4gICAgICAgICAgICAgIGNvbnN0IHN0YWNrTGluZXMgPSBjbGVhbmVkU3RhY2s/LnNwbGl0KFwiXFxuXCIpXG5cbiAgICAgICAgICAgICAgaWYgKHN0YWNrTGluZXMpIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHN0YWNrTGluZSBvZiBzdGFja0xpbmVzKSB7XG4gICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgJHtzdGFja0xpbmV9YCkpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgVGVzdCBmYWlsZWQgd2l0aCBhICR7dHlwZW9mIGZhaWxlZEVycm9yfTogJHtTdHJpbmcoZmFpbGVkRXJyb3IpfWApKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLnByaW50RmFpbGVkQ29uc29sZU91dHB1dCh7Y29uc29sZU91dHB1dCwgbGVmdFBhZGRpbmd9KVxuICAgICAgICAgICAgdGhpcy5fZmFpbGVkVGVzdHMrK1xuICAgICAgICAgICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICAgICAgICAgIGZ1bGxEZXNjcmlwdGlvbjogdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiksXG4gICAgICAgICAgICAgIGZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCxcbiAgICAgICAgICAgICAgbGluZTogdGVzdERhdGEubGluZSxcbiAgICAgICAgICAgICAgZXJyb3I6IGZhaWxlZEVycm9yLFxuICAgICAgICAgICAgICBjb25zb2xlT3V0cHV0OiBjb25zb2xlT3V0cHV0IHx8IHVuZGVmaW5lZFxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5lbWl0RXZlbnQoXCJ0ZXN0RmFpbGVkXCIsIHtcbiAgICAgICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgICAgICAgZXJyb3I6IGZhaWxlZEVycm9yLFxuICAgICAgICAgICAgICB0ZXN0QXJncyxcbiAgICAgICAgICAgICAgdGVzdERhdGEsXG4gICAgICAgICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgdGVzdFJ1bm5lcjogdGhpc1xuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgdGhpcy5wcmludFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhLCBsZWZ0UGFkZGluZ30pXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX3Rlc3REdXJhdGlvbnMucHVzaCh7XG4gICAgICAgICAgZnVsbERlc2NyaXB0aW9uOiB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSxcbiAgICAgICAgICBmaWxlUGF0aDogdGVzdERhdGEuZmlsZVBhdGggPz8gXCI8dW5rbm93bj5cIixcbiAgICAgICAgICBsaW5lOiB0ZXN0RGF0YS5saW5lID8/IDAsXG4gICAgICAgICAgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHRlc3RTdGFydE1zXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMpIGJyZWFrXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgc3ViRGVzY3JpcHRpb24gaW4gdGVzdHMuc3Vicykge1xuICAgICAgICBpZiAodGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cykgYnJlYWtcblxuICAgICAgICBjb25zdCBzdWJUZXN0ID0gdGVzdHMuc3Vic1tzdWJEZXNjcmlwdGlvbl1cbiAgICAgICAgY29uc3QgbmV3RGVjcmlwdGlvbnMgPSBkZXNjcmlwdGlvbnMuY29uY2F0KFtzdWJEZXNjcmlwdGlvbl0pXG4gICAgICAgIGNvbnN0IGNoaWxkU2NvcGVMaW5lTWF0Y2ggPSBzY29wZUxpbmVNYXRjaCB8fCB0aGlzLm1hdGNoZXNMaW5lRmlsdGVyKHN1YlRlc3QpXG5cbiAgICAgICAgaWYgKCF0aGlzLl9vbmx5Rm9jdXNzZWQgfHwgc3ViVGVzdC5hbnlUZXN0c0ZvY3Vzc2VkKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYCR7bGVmdFBhZGRpbmd9JHtzdWJEZXNjcmlwdGlvbn1gKVxuICAgICAgICAgIGF3YWl0IHRoaXMucnVuVGVzdHMoe1xuICAgICAgICAgICAgYWZ0ZXJFYWNoZXM6IG5ld0FmdGVyRWFjaGVzLFxuICAgICAgICAgICAgYmVmb3JlRWFjaGVzOiBuZXdCZWZvcmVFYWNoZXMsXG4gICAgICAgICAgICB0ZXN0czogc3ViVGVzdCxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uczogbmV3RGVjcmlwdGlvbnMsXG4gICAgICAgICAgICBpbmRlbnRMZXZlbDogaW5kZW50TGV2ZWwgKyAxLFxuICAgICAgICAgICAgbGluZU1hdGNoZWRJblNjb3BlOiBjaGlsZFNjb3BlTGluZU1hdGNoLFxuICAgICAgICAgICAgcGFyZW50UHJvZmlsZVNjb3BlSWQ6IHByb2ZpbGVTY29wZUlkXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBzY29wZUVycm9ycy5wdXNoKGVycm9yKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkFmdGVyQWxsc0ZvclNjb3BlKHNjb3BlRW50cnkpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHNjb3BlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfVxuICAgIGNvbnN0IHNjb3BlSW5kZXggPSB0aGlzLl9hY3RpdmVBZnRlckFsbFNjb3Blcy5pbmRleE9mKHNjb3BlRW50cnkpXG5cbiAgICBpZiAoc2NvcGVJbmRleCA+PSAwKSB7XG4gICAgICB0aGlzLl9hY3RpdmVBZnRlckFsbFNjb3Blcy5zcGxpY2Uoc2NvcGVJbmRleCwgMSlcbiAgICB9XG5cbiAgICBpZiAoc2NvcGVFcnJvcnMubGVuZ3RoID4gMCAmJiB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzKSB7XG4gICAgICBjb25zdCBlcnJvciA9IHNjb3BlRXJyb3JzLmxlbmd0aCA9PSAxXG4gICAgICAgID8gc2NvcGVFcnJvcnNbMF1cbiAgICAgICAgOiBuZXcgQWdncmVnYXRlRXJyb3Ioc2NvcGVFcnJvcnMsIFwiVGVzdCBzY29wZSBhbmQgYWZ0ZXJBbGwgY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBzY29wZUVycm9yc1swXX0pXG5cbiAgICAgIHRoaXMucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGVycm9yLCBcImFmdGVyQWxsXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHNjb3BlRXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBzY29wZUVycm9yc1swXVxuICAgIGlmIChzY29wZUVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3Ioc2NvcGVFcnJvcnMsIFwiVGVzdCBzY29wZSBhbmQgYWZ0ZXJBbGwgY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBzY29wZUVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gYWZ0ZXIgYWxscyBmb3Igc2NvcGUuXG4gICAqIEBwYXJhbSB7QWN0aXZlQWZ0ZXJBbGxTY29wZUVudHJ5fSBzY29wZUVudHJ5IC0gU2NvcGUgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2NvcGUgY2xlYW51cCBmaW5pc2hlcy5cbiAgICovXG4gIGFzeW5jIHJ1bkFmdGVyQWxsc0ZvclNjb3BlKHNjb3BlRW50cnkpIHtcbiAgICBpZiAoc2NvcGVFbnRyeS5hZnRlckFsbHNSdW4pIHJldHVyblxuXG4gICAgc2NvcGVFbnRyeS5hZnRlckFsbHNSdW4gPSB0cnVlXG5cbiAgICBjb25zdCBzY29wZU93bmVyRmlsZVBhdGggPSBzY29wZUVudHJ5LnRlc3RzLm93bmVyRmlsZVBhdGggPz8gc2NvcGVFbnRyeS50ZXN0cy5maWxlUGF0aFxuICAgIGNvbnN0IGFmdGVyQWxscyA9IFsuLi50aGlzLnByb2ZpbGVIb29rRW50cmllcyhcbiAgICAgIHNjb3BlRW50cnkudGVzdHMuYWZ0ZXJBbGxzIHx8IFtdLFxuICAgICAgc2NvcGVFbnRyeS5wcm9maWxlU2NvcGVJZCxcbiAgICAgIHNjb3BlT3duZXJGaWxlUGF0aFxuICAgICldLnJldmVyc2UoKVxuICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgIGNvbnN0IGFmdGVyQWxsRXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgYWZ0ZXJBbGxEYXRhIG9mIGFmdGVyQWxscykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5Qcm9maWxlU3Bhbih7XG4gICAgICAgICAgcGhhc2U6IFwiYWZ0ZXJBbGxcIixcbiAgICAgICAgICBkZWNsYXJhdGlvbkluZGV4OiBhZnRlckFsbERhdGEuZGVjbGFyYXRpb25JbmRleCxcbiAgICAgICAgICBkZWNsYXJhdGlvblNjb3BlSWQ6IGFmdGVyQWxsRGF0YS5kZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICAgICAgZmlsZVBhdGg6IGFmdGVyQWxsRGF0YS5vd25lckZpbGVQYXRoXG4gICAgICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBhZnRlckFsbERhdGEuY2FsbGJhY2soe2NvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpfSlcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGFmdGVyQWxsRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFmdGVyQWxsRXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBhZnRlckFsbEVycm9yc1swXVxuICAgIGlmIChhZnRlckFsbEVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoYWZ0ZXJBbGxFcnJvcnMsIFwiTXVsdGlwbGUgYWZ0ZXJBbGwgaG9va3MgZmFpbGVkXCIsIHtjYXVzZTogYWZ0ZXJBbGxFcnJvcnNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVtaXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudE5hbWUgLSBFdmVudCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gcGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGxpc3RlbmVycyBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpIHtcbiAgICBjb25zdCBsaXN0ZW5lcnMgPSB0ZXN0RXZlbnRzLmxpc3RlbmVycyhldmVudE5hbWUpXG5cbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIGxpc3RlbmVycykge1xuICAgICAgYXdhaXQgbGlzdGVuZXIocGF5bG9hZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCByZXJ1biBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIExlZnQgcGFkZGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHJpbnRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YSwgbGVmdFBhZGRpbmd9KSB7XG4gICAgY29uc3QgcmVydW4gPSB0aGlzLmJ1aWxkUmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGF9KVxuXG4gICAgaWYgKHJlcnVuKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGAke2xlZnRQYWRkaW5nfSAgUmUtcnVuOiAke3JlcnVufWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgcmVydW4gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXJ1biBjb21tYW5kLlxuICAgKi9cbiAgYnVpbGRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YX0pIHtcbiAgICBjb25zdCBiYXNlQ29tbWFuZCA9IFwibnB4IHZlbG9jaW91cyB0ZXN0XCJcbiAgICBjb25zdCBmaWxlUGF0aCA9IHRlc3REYXRhLmZpbGVQYXRoXG4gICAgY29uc3QgbGluZSA9IHRlc3REYXRhLmxpbmVcblxuICAgIGlmIChmaWxlUGF0aCAmJiBsaW5lKSB7XG4gICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHByb2Nlc3MuY3dkKCksIGZpbGVQYXRoKVxuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAke3JlbGF0aXZlUGF0aH06JHtsaW5lfWBcbiAgICB9XG5cbiAgICBjb25zdCBmdWxsRGVzY3JpcHRpb24gPSB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKVxuXG4gICAgaWYgKGZ1bGxEZXNjcmlwdGlvbikge1xuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAtLWV4YW1wbGUgJHtKU09OLnN0cmluZ2lmeShmdWxsRGVzY3JpcHRpb24pfWBcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtBdHRlbXB0Q29uc29sZU91dHB1dFtdfSBhdHRlbXB0Q29uc29sZU91dHB1dHMgLSBBdHRlbXB0IG91dHB1dCBlbnRyaWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbWJpbmVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKi9cbiAgYnVpbGRDb25zb2xlT3V0cHV0KGF0dGVtcHRDb25zb2xlT3V0cHV0cykge1xuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIlxuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAxKSByZXR1cm4gYXR0ZW1wdENvbnNvbGVPdXRwdXRzWzBdLm91dHB1dFxuXG4gICAgcmV0dXJuIGF0dGVtcHRDb25zb2xlT3V0cHV0cy5tYXAoKGF0dGVtcHRDb25zb2xlT3V0cHV0KSA9PiB7XG4gICAgICByZXR1cm4gYC0tLSBBdHRlbXB0ICR7YXR0ZW1wdENvbnNvbGVPdXRwdXQuYXR0ZW1wdE51bWJlcn0gLS0tXFxuJHthdHRlbXB0Q29uc29sZU91dHB1dC5vdXRwdXR9YFxuICAgIH0pLmpvaW4oXCJcXG5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgY29uc29sZSBvdXRwdXQgbWF4IGxpbmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gZmFpbGVkIGNvbnNvbGUgbGluZXMuXG4gICAqL1xuICBnZXRGYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMoKSB7XG4gICAgY29uc3QgbWF4TGluZXMgPSB0ZXN0Q29uZmlnLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lc1xuXG4gICAgaWYgKHR5cGVvZiBtYXhMaW5lcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKG1heExpbmVzKSkgcmV0dXJuIDIwMFxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGguZmxvb3IobWF4TGluZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZmFpbGVkIGNvbnNvbGUgb3V0cHV0IGxpbmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uc29sZU91dHB1dCAtIENvbnNvbGUgb3V0cHV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTGluZXMgZm9yIGlubGluZSBvdXRwdXQuXG4gICAqL1xuICB0cnVuY2F0ZUZhaWxlZENvbnNvbGVPdXRwdXRMaW5lcyhjb25zb2xlT3V0cHV0KSB7XG4gICAgY29uc3QgbGluZXMgPSBjb25zb2xlT3V0cHV0LnNwbGl0KFwiXFxuXCIpXG4gICAgY29uc3QgbWF4TGluZXMgPSB0aGlzLmdldEZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcygpXG5cbiAgICBpZiAobWF4TGluZXMgPT09IDApIHJldHVybiBbXVxuICAgIGlmIChsaW5lcy5sZW5ndGggPD0gbWF4TGluZXMpIHJldHVybiBsaW5lc1xuXG4gICAgY29uc3Qgb21pdHRlZExpbmVzID0gbGluZXMubGVuZ3RoIC0gbWF4TGluZXNcbiAgICBjb25zdCBwbHVyYWwgPSBvbWl0dGVkTGluZXMgPT09IDEgPyBcIlwiIDogXCJzXCJcblxuICAgIHJldHVybiBbXG4gICAgICBgLi4uICR7b21pdHRlZExpbmVzfSBjb25zb2xlIG91dHB1dCBsaW5lJHtwbHVyYWx9IG9taXR0ZWQgLi4uYCxcbiAgICAgIC4uLmxpbmVzLnNsaWNlKC1tYXhMaW5lcylcbiAgICBdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCBmYWlsZWQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBMZWZ0IHBhZGRpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHByaW50RmFpbGVkQ29uc29sZU91dHB1dCh7Y29uc29sZU91dHB1dCwgbGVmdFBhZGRpbmd9KSB7XG4gICAgaWYgKHRlc3RDb25maWcuY29uc29sZU91dHB1dCAhPT0gXCJmYWlsdXJlXCIpIHJldHVyblxuICAgIGlmICghY29uc29sZU91dHB1dCkgcmV0dXJuXG5cbiAgICBjb25zdCBsaW5lcyA9IHRoaXMudHJ1bmNhdGVGYWlsZWRDb25zb2xlT3V0cHV0TGluZXMoY29uc29sZU91dHB1dClcblxuICAgIGlmIChsaW5lcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIENvbnNvbGUgb3V0cHV0OmApKVxuXG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgICAke2xpbmV9YCkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgY29uc29sZSBjYXB0dXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucGFzc3Rocm91Z2hdIC0gV2hldGhlciB0byBwYXNzIHRocm91Z2ggdG8gdGhlIG9yaWdpbmFsIGNvbnNvbGUuXG4gICAqIEByZXR1cm5zIHsoKSA9PiBzdHJpbmd9IC0gU3RvcHMgdGhlIGNhcHR1cmUgYW5kIHJldHVybnMgY2FwdHVyZWQgdGV4dC5cbiAgICovXG4gIHN0YXJ0Q29uc29sZUNhcHR1cmUoe3Bhc3N0aHJvdWdoID0gZmFsc2V9ID0ge30pIHtcbiAgICAvKipcbiAgICAgKiBMaW5lcy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbGluZXMgPSBbXVxuICAgIC8qKlxuICAgICAqIENvbnNvbGUgb2JqZWN0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8Q29uc29sZU1ldGhvZE5hbWUsICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHZvaWQ+fSAqL1xuICAgIGNvbnN0IGNvbnNvbGVPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxDb25zb2xlTWV0aG9kTmFtZSwgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZD59ICovIChjb25zb2xlKVxuICAgIC8qKlxuICAgICAqIE9yaWdpbmFsIGNvbnNvbGUgbWV0aG9kcyBjYXB0dXJlZCBhcyBkaXJlY3QgcmVmZXJlbmNlcyBzbyBzdG9wcGluZyByZXN0b3Jlc1xuICAgICAqIHRoZSBleGFjdCBtZXRob2QgdGhhdCB3YXMgaW5zdGFsbGVkIGF0IGNhcHR1cmUgc3RhcnQuXG4gICAgICogQHR5cGUge1JlY29yZDxDb25zb2xlTWV0aG9kTmFtZSwgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZD59ICovXG4gICAgY29uc3Qgb3JpZ2luYWxDb25zb2xlTWV0aG9kcyA9IHtcbiAgICAgIGRlYnVnOiBjb25zb2xlT2JqZWN0LmRlYnVnLFxuICAgICAgZXJyb3I6IGNvbnNvbGVPYmplY3QuZXJyb3IsXG4gICAgICBpbmZvOiBjb25zb2xlT2JqZWN0LmluZm8sXG4gICAgICBsb2c6IGNvbnNvbGVPYmplY3QubG9nLFxuICAgICAgd2FybjogY29uc29sZU9iamVjdC53YXJuXG4gICAgfVxuICAgIGxldCBzdG9wcGVkID0gZmFsc2VcbiAgICBsZXQgb3V0cHV0VGV4dCA9IFwiXCJcblxuICAgIGZvciAoY29uc3QgbWV0aG9kTmFtZSBvZiBDQVBUVVJFRF9DT05TT0xFX01FVEhPRFMpIHtcbiAgICAgIGNvbnNvbGVPYmplY3RbbWV0aG9kTmFtZV0gPSAoLi4uYXJncykgPT4ge1xuICAgICAgICBsaW5lcy5wdXNoKGBbJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9XSBbJHttZXRob2ROYW1lfV0gJHtmb3JtYXQoLi4uYXJncyl9YClcblxuICAgICAgICBpZiAocGFzc3Rocm91Z2gpIHtcbiAgICAgICAgICBvcmlnaW5hbENvbnNvbGVNZXRob2RzW21ldGhvZE5hbWVdLmFwcGx5KGNvbnNvbGVPYmplY3QsIGFyZ3MpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgaWYgKCFzdG9wcGVkKSB7XG4gICAgICAgIHN0b3BwZWQgPSB0cnVlXG5cbiAgICAgICAgZm9yIChjb25zdCBtZXRob2ROYW1lIG9mIENBUFRVUkVEX0NPTlNPTEVfTUVUSE9EUykge1xuICAgICAgICAgIGNvbnNvbGVPYmplY3RbbWV0aG9kTmFtZV0gPSBvcmlnaW5hbENvbnNvbGVNZXRob2RzW21ldGhvZE5hbWVdXG4gICAgICAgIH1cblxuICAgICAgICBvdXRwdXRUZXh0ID0gbGluZXMuam9pbihcIlxcblwiKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gb3V0cHV0VGV4dFxuICAgIH1cbiAgfVxufVxuIl19