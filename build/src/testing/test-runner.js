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
            return;
        }
        for (const testFile of this.getTestFiles()) {
            const existingRegistrations = this.testRegistrationObjects(tests);
            await this._profiler.measurePhase("imports", async () => {
                await environmentHandler.importTestFiles([testFile]);
            }, { filePath: testFile });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFDckUsT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDaEMsT0FBTyxFQUFDLGlCQUFpQixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDbEQsT0FBTyxXQUFXLE1BQU0sMEJBQTBCLENBQUE7QUFDbEQsT0FBTyxnQkFBZ0IsTUFBTSxvQ0FBb0MsQ0FBQTtBQUNqRSxPQUFPLEVBQUMsOEJBQThCLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUM5RSxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQ3ZELE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxLQUFLLENBQUE7QUFDakMsT0FBTyxFQUFDLGVBQWUsRUFBQyxNQUFNLGNBQWMsQ0FBQTtBQUM1QyxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBRXBGOzs4RUFFOEU7QUFDOUU7Ozs7O0dBS0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNIOzs7Ozs7Ozs7R0FTRztBQUNIOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7OztHQUdHO0FB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QixJQUFJLEVBQUUsYUFBYSxDQUFDLElBQUk7U0FDekIsQ0FBQTtRQUNELElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQTtRQUNuQixJQUFJLFVBQVUsR0FBRyxFQUFFLENBQUE7UUFFbkIsS0FBSyxNQUFNLFVBQVUsSUFBSSx3QkFBd0IsRUFBRSxDQUFDO1lBQ2xELGFBQWEsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLEVBQUU7Z0JBQ3RDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxNQUFNLFVBQVUsS0FBSyxNQUFNLENBQUMsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBRTlFLElBQUksV0FBVyxFQUFFLENBQUM7b0JBQ2hCLHNCQUFzQixDQUFDLFVBQVUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLENBQUE7Z0JBQy9ELENBQUM7WUFDSCxDQUFDLENBQUE7UUFDSCxDQUFDO1FBRUQsT0FBTyxHQUFHLEVBQUU7WUFDVixJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ2IsT0FBTyxHQUFHLElBQUksQ0FBQTtnQkFFZCxLQUFLLE1BQU0sVUFBVSxJQUFJLHdCQUF3QixFQUFFLENBQUM7b0JBQ2xELGFBQWEsQ0FBQyxVQUFVLENBQUMsR0FBRyxzQkFBc0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtnQkFDaEUsQ0FBQztnQkFFRCxVQUFVLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUMvQixDQUFDO1lBRUQsT0FBTyxVQUFVLENBQUE7UUFDbkIsQ0FBQyxDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7YWRkVHJhY2tlZFN0YWNrVG9FcnJvcn0gZnJvbSBcIi4uL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay5qc1wiXG5pbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHtmb3JtYXR9IGZyb20gXCJub2RlOnV0aWxcIlxuaW1wb3J0IHtBc3luY0xvY2FsU3RvcmFnZX0gZnJvbSBcIm5vZGU6YXN5bmNfaG9va3NcIlxuaW1wb3J0IEFwcGxpY2F0aW9uIGZyb20gXCIuLi8uLi9zcmMvYXBwbGljYXRpb24uanNcIlxuaW1wb3J0IEJhY2t0cmFjZUNsZWFuZXIgZnJvbSBcIi4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLW5vZGUuanNcIlxuaW1wb3J0IHtUZXN0RGF0YWJhc2VBY2Nlc3NSZXZva2VkRXJyb3J9IGZyb20gXCIuLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCJcbmltcG9ydCBSZXF1ZXN0Q2xpZW50IGZyb20gXCIuL3JlcXVlc3QtY2xpZW50LmpzXCJcbmltcG9ydCBwaWNvY29sb3JzIGZyb20gXCJwaWNvY29sb3JzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHt0ZXN0Q29uZmlnLCB0ZXN0RXZlbnRzLCB0ZXN0c30gZnJvbSBcIi4vdGVzdC5qc1wiXG5pbXBvcnQge3BhdGhUb0ZpbGVVUkx9IGZyb20gXCJ1cmxcIlxuaW1wb3J0IHtjbGVhckRlbGl2ZXJpZXN9IGZyb20gXCIuLi9tYWlsZXIuanNcIlxuaW1wb3J0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyIGZyb20gXCIuL3NoYXJlZC10cmFuc2FjdGlvbi1icm9rZXIuanNcIlxuaW1wb3J0IHsgU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlYgfSBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCJcblxuLyoqXG4gKiBDb25zb2xlTWV0aG9kTmFtZSB0eXBlLlxuICogQHR5cGVkZWYge1wibG9nXCIgfCBcImluZm9cIiB8IFwid2FyblwiIHwgXCJlcnJvclwiIHwgXCJkZWJ1Z1wifSBDb25zb2xlTWV0aG9kTmFtZSAqL1xuLyoqXG4gKiBBdHRlbXB0Q29uc29sZU91dHB1dCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQXR0ZW1wdENvbnNvbGVPdXRwdXRcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gQXR0ZW1wdCBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gb3V0cHV0IC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQuXG4gKi9cbi8qKlxuICogVGVzdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RBcmdzXG4gKiBAcHJvcGVydHkge0FwcGxpY2F0aW9ufSBbYXBwbGljYXRpb25dIC0gQXBwbGljYXRpb24gaW5zdGFuY2UgZm9yIGludGVncmF0aW9uIHRlc3RzLlxuICogQHByb3BlcnR5IHtSZXF1ZXN0Q2xpZW50fSBbY2xpZW50XSAtIEhUVFAgY2xpZW50IGZvciByZXF1ZXN0IHRlc3RzLlxuICogQHByb3BlcnR5IHtvYmplY3R9IFtkYXRhYmFzZUNsZWFuaW5nXSAtIERhdGFiYXNlIGNsZWFudXAgb3B0aW9ucyBmb3IgdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRyYW5zYWN0aW9uXSAtIFVzZSB0cmFuc2FjdGlvbnMgdG8gcm9sbGJhY2sgYmV0d2VlbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJ1bmNhdGVdIC0gVHJ1bmNhdGUgdGFibGVzIGJldHdlZW4gdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRydW5jYXRlQmVmb3JlXSAtIFRydW5jYXRlIHRhYmxlcyBiZWZvcmUgZWFjaCB0ZXN0LCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdCBjbGVhbnVwLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZm9jdXNdIC0gV2hldGhlciB0aGlzIHRlc3QgaXMgZm9jdXNlZC5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IFtmdW5jdGlvbl0gLSBUZXN0IGNhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtyZXRyeV0gLSBOdW1iZXIgb2YgcmV0cmllcyB3aGVuIGEgdGVzdCBmYWlscy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW10gfCBzdHJpbmd9IFt0YWdzXSAtIFRhZ3MgZm9yIGZpbHRlcmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dFNlY29uZHNdIC0gVGltZW91dCBpbiBzZWNvbmRzIGZvciB0aGUgdGVzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBUZXN0IHR5cGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgdGVuYW50OiBvYmplY3R9KSA9PiBQcm9taXNlPHZvaWQ+fSBbcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50XSAtIFJlZ2lzdGVycyBvbmUgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIHRyYW5zYWN0aW9uIGZvciB0aGlzIGF0dGVtcHQuXG4gKi9cbi8qKlxuICogQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBBdHRlbXB0LW93bmVkIGNvbm5lY3Rpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gQ29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcXVhcmFudGluZVByb21pc2VdIC0gU2hhcmVkIGNvbm5lY3Rpb24tZGlzY2FyZCBwcm9taXNlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBxdWFyYW50aW5lZCAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaXMgdW5zYWZlIHRvIHJldXNlLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcm9sbGJhY2tQcm9taXNlXSAtIFNoYXJlZCByb2xsYmFjayBwcm9taXNlLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbc3RhcnRQcm9taXNlXSAtIFRyYW5zYWN0aW9uIHN0YXJ0dXAgcHJvbWlzZSB3aGVuIHRyYW5zYWN0aW9uIGNsZWFuaW5nIGlzIGVuYWJsZWQuXG4gKi9cbi8qKlxuICogVGVzdERhdGEgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3REYXRhXG4gKiBAcHJvcGVydHkge1Rlc3RBcmdzfSBhcmdzIC0gQXJndW1lbnRzIHBhc3NlZCB0byB0aGUgdGVzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZmlsZVBhdGhdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbGluZV0gLSBTb3VyY2UgbGluZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICogQHByb3BlcnR5IHsoYXJnOiBUZXN0QXJncykgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IGZ1bmN0aW9uIC0gVGVzdCBjYWxsYmFjayB0byBleGVjdXRlLlxuICovXG4vKipcbiAqIEZhaWxlZFRlc3REZXRhaWwgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZhaWxlZFRlc3REZXRhaWxcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmdWxsRGVzY3JpcHRpb24gLSBGdWxsIHRlc3QgZGVzY3JpcHRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlT3V0cHV0XSAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0IHdoaWxlIHRlc3QgcmFuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlTG9nUGF0aF0gLSBTYXZlZCBjb25zb2xlIGxvZyBwYXRoLlxuICovXG4vKipcbiAqIEFjdGl2ZUFmdGVyQWxsU2NvcGVFbnRyeSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWN0aXZlQWZ0ZXJBbGxTY29wZUVudHJ5XG4gKiBAcHJvcGVydHkge1Rlc3RzQXJndW1lbnR9IHRlc3RzIC0gU2NvcGUgdGVzdCB0cmVlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBhZnRlckFsbHNSdW4gLSBXaGV0aGVyIGNsZWFudXAgaG9va3MgaGF2ZSBydW4uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3Byb2ZpbGVTY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIHRlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfSkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBIb29rIGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2RlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBpbmRleCB3aXRoaW4gaXRzIGRlY2xhcmF0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkZWNsYXJhdGlvblNjb3BlSWRdIC0gT3BhcXVlIHByb2ZpbGUgc2NvcGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9KSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVcbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gSG9vayBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICovXG4vKipcbiAqIFRlc3RzQXJndW1lbnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RzQXJndW1lbnRcbiAqIEBwcm9wZXJ0eSB7VGVzdEFyZ3N9IGFyZ3MgLSBBcmd1bWVudHMgaW5oZXJpdGVkIGJ5IHRlc3RzIGluIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFthbnlUZXN0c0ZvY3Vzc2VkXSAtIFdoZXRoZXIgYW55IHRlc3RzIGluIHRoZSB0cmVlIGFyZSBmb2N1c2VkLlxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYWZ0ZXJFYWNoZXMgLSBBZnRlci1lYWNoIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBhZnRlckFsbHMgLSBBZnRlci1hbGwgaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlW119IGJlZm9yZUFsbHMgLSBCZWZvcmUtYWxsIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYmVmb3JlRWFjaGVzIC0gQmVmb3JlLWVhY2ggaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgVGVzdERhdGE+fSB0ZXN0cyAtIEEgdW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBub2RlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBUZXN0c0FyZ3VtZW50Pn0gc3VicyAtIE9wdGlvbmFsIGNoaWxkIG5vZGVzLiBFYWNoIGl0ZW0gaXMgYW5vdGhlciBgTm9kZWAsIGFsbG93aW5nIHJlY3Vyc2lvbi5cbiAqL1xuLyoqXG4gKiBNYXJrcyB0aGUgZXJyb3IgdGhyb3duIGJ5IHtAbGluayBydW5XaXRoVGltZW91dH0gc28gdGhlIGNhbGxlciBjYW4gdGVsbCBhXG4gKiBsaWZlY3ljbGUgdGltZW91dCAodGhlIHByb21pc2UgaXMgc3RpbGwgcnVubmluZyBkZXRhY2hlZCkgYXBhcnQgZnJvbSBhblxuICogb3JkaW5hcnkgdGVzdCBmYWlsdXJlICh0aGUgcHJvbWlzZSBhbHJlYWR5IHNldHRsZWQpLlxuICogQHR5cGVkZWYge0Vycm9yICYge3ZlbG9jaW91c1Rlc3RUaW1lb3V0PzogdHJ1ZX19IFRlc3RUaW1lb3V0RXJyb3JcbiAqL1xuLyoqXG4gKiBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJ9IGJyb2tlciAtIEF0dGVtcHQgYnJva2VyIGFuZCBjb25uZWN0aW9uIGNvb3JkaW5hdG9yLlxuICogQHByb3BlcnR5IHtib29sZWFufSBlbnZpcm9ubWVudFB1Ymxpc2hlZCAtIFdoZXRoZXIgY2hpbGQtcHJvY2VzcyBjb29yZGluYXRlcyB3ZXJlIHB1Ymxpc2hlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBwcmV2aW91c0Vudmlyb25tZW50IC0gRW52aXJvbm1lbnQgdmFsdWUgdG8gcmVzdG9yZSBhZnRlciBwdWJsaWNhdGlvbi5cbiAqL1xuLyoqXG4gKiBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge1Byb21pc2U8e2Nvbm5lY3Rpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBlcnJvcjogRXJyb3IgfCB1bmRlZmluZWR9PiB8IHVuZGVmaW5lZH0gW2NoZWNrb3V0UHJvbWlzZV0gLSBBdHRlbXB0LW93bmVkIHBoeXNpY2FsIGNoZWNrb3V0IG91dGNvbWUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25uZWN0aW9uIC0gQXR0ZW1wdC1vd25lZCBwaHlzaWNhbCBjb25uZWN0aW9uIG9uY2UgY2hlY2tvdXQgcmVzb2x2ZXMuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IFtjbGVhbnVwUHJvbWlzZV0gLSBTaW5nbGUgY2xlYW51cCBvcGVyYXRpb24gc2hhcmVkIGJ5IGVtZXJnZW5jeSBhbmQgZXZlbnR1YWwgbGlmZWN5Y2xlIGNsZWFudXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW4gfCB1bmRlZmluZWR9IFtkaXNjYXJkT25DbGVhbnVwXSAtIFdoZXRoZXIgdGltZW91dCBlbWVyZ2VuY3kgY2xlYW51cCBtdXN0IHF1YXJhbnRpbmUgdGhpcyBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gcG9vbCAtIE93bmluZyBsb2dpY2FsIHBvb2wuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldm9rZWQgLSBXaGV0aGVyIHRoaXMgYXR0ZW1wdCBtYXkgc3RpbGwgcHVibGlzaCB0aGUgcGh5c2ljYWwgcmVnaXN0cmF0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJldXNlS2V5IC0gUmVzb2x2ZWQgcGh5c2ljYWwgY29uZmlndXJhdGlvbiBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSBzaGFyZWRSZWdpc3RyYXRpb24gLSBQaHlzaWNhbC1rZXkgc2hhcmVkIHJlZ2lzdHJhdGlvbiBvbmNlIHB1Ymxpc2hlZC5cbiAqL1xuXG4vKipcbiAqIFJ1bnMgcnVuIHdpdGggdGltZW91dC5cbiAqXG4gKiBPbiB0aW1lb3V0IHRoZSB3cmFwcGVkIGBwcm9taXNlYCBpcyBOT1QgY2FuY2VsbGVkIOKAlCBpdCBrZWVwcyBydW5uaW5nIGRldGFjaGVkLlxuICogVGhlIHJlamVjdGVkIGVycm9yIGlzIHRhZ2dlZCB3aXRoIGB2ZWxvY2lvdXNUZXN0VGltZW91dGAgc28gdGhlIHJ1bm5lciBrbm93c1xuICogdGhlIGxpZmVjeWNsZSAoYW5kIGl0cyBhZnRlckVhY2ggZGF0YWJhc2UgY2xlYW51cCkgaXMgc3RpbGwgaW4gZmxpZ2h0IGFuZCBjYW5cbiAqIHdhaXQgZm9yIGl0IHRvIHNldHRsZSBiZWZvcmUgdGhlIG5leHQgdGVzdCByZXVzZXMgdGhlIHNoYXJlZCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBwcm9taXNlIC0gUHJvbWlzZSBvciB2YWx1ZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0TXMgLSBUaW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIG9yIHJlamVjdHMgYmFzZWQgb24gdGltZW91dCBvciBwcm9taXNlIHJlc3VsdC5cbiAqL1xuZnVuY3Rpb24gcnVuV2l0aFRpbWVvdXQocHJvbWlzZSwgdGltZW91dE1zLCB0ZXN0RGVzY3JpcHRpb24pIHtcbiAgY29uc3QgdGltZW91dFNlY29uZHMgPSAodGltZW91dE1zIC8gMTAwMCkudG9GaXhlZCgzKS5yZXBsYWNlKC9cXC4/MCskLywgXCJcIilcbiAgLyoqIEB0eXBlIHtUZXN0VGltZW91dEVycm9yfSAqL1xuICBjb25zdCB0aW1lb3V0RXJyb3IgPSBuZXcgRXJyb3IoYFRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRTZWNvbmRzfXM6ICR7dGVzdERlc2NyaXB0aW9ufWApXG4gIHRpbWVvdXRFcnJvci52ZWxvY2lvdXNUZXN0VGltZW91dCA9IHRydWVcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHJlamVjdCh0aW1lb3V0RXJyb3IpLCB0aW1lb3V0TXMpXG5cbiAgICBQcm9taXNlLnJlc29sdmUocHJvbWlzZSkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dClcbiAgICAgIHJlc29sdmUocmVzdWx0KVxuICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpXG4gICAgICByZWplY3QoZXJyb3IpXG4gICAgfSlcbiAgfSlcbn1cblxuLyoqXG4gKiBXYWl0cyBmb3IgYW4gYWJhbmRvbmVkICh0aW1lZC1vdXQpIHRlc3QgbGlmZWN5Y2xlIHRvIHNldHRsZSwgYm91bmRlZCBieSBhXG4gKiBncmFjZSBwZXJpb2QsIHNvIGl0cyBhZnRlckVhY2ggZGF0YWJhc2UgY2xlYW51cCBydW5zIG9uIHRoZSBzaGFyZWQgY29ubmVjdGlvblxuICogYmVmb3JlIHRoZSBuZXh0IHRlc3QgcmV1c2VzIGl0LiBSZXR1cm5zIHRoZSBmdWxmaWxsbWVudC9yZWplY3Rpb24gb3V0Y29tZSBpZlxuICogdGhlIGxpZmVjeWNsZSBzZXR0bGVzLCBvciBhIHBlbmRpbmcgb3V0Y29tZSBvbmNlIHRoZSBncmFjZSBlbGFwc2VzLlxuICpcbiAqIFRoZSBncmFjZSB0aW1lciBpcyBrZXB0IHJlZidkIHNvIGl0IGNhbm5vdCBsZXQgTm9kZSBleGl0IHdpdGggYW4gdW5zZXR0bGVkXG4gKiB0b3AtbGV2ZWwgYXdhaXQgd2hlbiB0aGUgdGltZWQtb3V0IGxpZmVjeWNsZSBoYXMgbm8gcmVmJ2QgaGFuZGxlcyBvZiBpdHMgb3duXG4gKiAoZm9yIGV4YW1wbGUgYSBzdGFsbGVkIG1vY2tlZCBhc3luYyBBUEkpLiBPbmNlIHRoZSBjYWxsZXIgY29udGludWVzIHBhc3QgdGhpc1xuICogYXdhaXQsIHRoZSB0aW1lciBoYXMgYWxyZWFkeSByZXNvbHZlZCBhbmQgbm8gbG9uZ2VyIGFuY2hvcnMgdGhlIGV2ZW50IGxvb3AuXG4gKiBAcGFyYW0ge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBsaWZlY3ljbGUgLSBUaGUgYWJhbmRvbmVkIHBlci10ZXN0IGxpZmVjeWNsZSBwcm9taXNlLlxuICogQHBhcmFtIHtudW1iZXJ9IGdyYWNlTXMgLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgdGhlIGxpZmVjeWNsZSB0byBzZXR0bGUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx7c2V0dGxlZDogZmFsc2V9IHwge3NldHRsZWQ6IHRydWUsIHN0YXR1czogXCJmdWxmaWxsZWRcIn0gfCB7c2V0dGxlZDogdHJ1ZSwgc3RhdHVzOiBcInJlamVjdGVkXCIsIHJlYXNvbjogdW5rbm93bn0+fSAtIFNldHRsZW1lbnQgb3V0Y29tZS5cbiAqL1xuZnVuY3Rpb24gYXdhaXRTZXR0bGVkT3JHcmFjZShsaWZlY3ljbGUsIGdyYWNlTXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgbGV0IHNldHRsZWQgPSBmYWxzZVxuICAgIGNvbnN0IGdyYWNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cblxuICAgICAgc2V0dGxlZCA9IHRydWVcbiAgICAgIHJlc29sdmUoe3NldHRsZWQ6IGZhbHNlfSlcbiAgICB9LCBncmFjZU1zKVxuXG4gICAgUHJvbWlzZS5yZXNvbHZlKGxpZmVjeWNsZSkudGhlbihcbiAgICAgICgpID0+IHtcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuXG4gICAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICAgIGNsZWFyVGltZW91dChncmFjZVRpbWVyKVxuICAgICAgICByZXNvbHZlKHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwiZnVsZmlsbGVkXCJ9KVxuICAgICAgfSxcbiAgICAgIChyZWFzb24pID0+IHtcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuXG4gICAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICAgIGNsZWFyVGltZW91dChncmFjZVRpbWVyKVxuICAgICAgICByZXNvbHZlKHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwicmVqZWN0ZWRcIiwgcmVhc29ufSlcbiAgICAgIH1cbiAgICApXG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYSBsYXRlIGxpZmVjeWNsZSBzdG9wcGVkIG9ubHkgYmVjYXVzZSBpdHMgdGVzdCBhY2Nlc3Mgd2FzIHJldm9rZWQuXG4gKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gTGlmZWN5Y2xlIHJlamVjdGlvbi5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZXZlcnkgY29udGFpbmVkIGVycm9yIGlzIGV4cGVjdGVkIHJldm9jYXRpb24uXG4gKi9cbmZ1bmN0aW9uIGlzVGVzdERhdGFiYXNlQWNjZXNzUmV2b2NhdGlvbihlcnJvcikge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBUZXN0RGF0YWJhc2VBY2Nlc3NSZXZva2VkRXJyb3IpIHJldHVybiB0cnVlXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIEFnZ3JlZ2F0ZUVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yLmVycm9ycy5sZW5ndGggPiAwICYmIGVycm9yLmVycm9ycy5ldmVyeSgobmVzdGVkRXJyb3IpID0+IGlzVGVzdERhdGFiYXNlQWNjZXNzUmV2b2NhdGlvbihuZXN0ZWRFcnJvcikpXG4gIH1cblxuICByZXR1cm4gZmFsc2Vcbn1cblxuLyoqXG4gKiBDYXB0dXJlZCBjb25zb2xlIG1ldGhvZHMuXG4gKiBAdHlwZSB7Q29uc29sZU1ldGhvZE5hbWVbXX0gKi9cbmNvbnN0IENBUFRVUkVEX0NPTlNPTEVfTUVUSE9EUyA9IFtcImxvZ1wiLCBcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIiwgXCJkZWJ1Z1wiXVxuXG4vKipcbiAqIFJ1bnMgdG8gZmlsZSBzbHVnLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gc2FuaXRpemUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNsdWctc2FmZSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gdG9GaWxlU2x1Zyh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWVcbiAgICAudG9Mb3dlckNhc2UoKVxuICAgIC5yZXBsYWNlKC9bXmEtejAtOV0rL2csIFwiLVwiKVxuICAgIC5yZXBsYWNlKC9eLSt8LSskL2csIFwiXCIpXG4gICAgLnNsaWNlKDAsIDgwKSB8fCBcImZhaWxlZC10ZXN0XCJcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVzdFJ1bm5lciB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtBY3RpdmVBZnRlckFsbFNjb3BlRW50cnlbXX0gKi9cbiAgX2FjdGl2ZUFmdGVyQWxsU2NvcGVzXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0ZhaWxlZFRlc3REZXRhaWxbXX0gKi9cbiAgX2ZhaWxlZFRlc3REZXRhaWxzXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nfSBbYXJncy5leGNsdWRlVGFnc10gLSBUYWdzIHRvIGV4Y2x1ZGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmd9IFthcmdzLmluY2x1ZGVUYWdzXSAtIFRhZ3MgdG8gaW5jbHVkZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBhcmdzLnRlc3RGaWxlcyAtIFRlc3QgZmlsZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgbnVtYmVyW10+fSBbYXJncy5saW5lRmlsdGVyc10gLSBMaW5lIGZpbHRlcnMgYnkgZmlsZS5cbiAgICogQHBhcmFtIHtSZWdFeHBbXX0gW2FyZ3MuZXhhbXBsZVBhdHRlcm5zXSAtIEV4YW1wbGUgcGF0dGVybnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXByb2ZpbGVyLmpzXCIpLmRlZmF1bHR9IFthcmdzLnByb2ZpbGVyXSAtIE9wdC1pbiBwcm9maWxlci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBleGNsdWRlVGFncywgaW5jbHVkZVRhZ3MsIHRlc3RGaWxlcywgbGluZUZpbHRlcnMsIGV4YW1wbGVQYXR0ZXJucywgcHJvZmlsZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcImNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG4gICAgdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlKClcbiAgICB0aGlzLl9leGNsdWRlVGFncyA9IHRoaXMubm9ybWFsaXplVGFncyhleGNsdWRlVGFncylcbiAgICB0aGlzLl9leGNsdWRlVGFnU2V0ID0gbmV3IFNldCh0aGlzLl9leGNsdWRlVGFncylcbiAgICB0aGlzLl9pbmNsdWRlVGFncyA9IHRoaXMubm9ybWFsaXplVGFncyhpbmNsdWRlVGFncylcbiAgICB0aGlzLl9pbmNsdWRlVGFnU2V0ID0gbmV3IFNldCh0aGlzLl9pbmNsdWRlVGFncylcbiAgICB0aGlzLl90ZXN0RmlsZXMgPSB0ZXN0RmlsZXNcbiAgICB0aGlzLl9saW5lRmlsdGVycyA9IGxpbmVGaWx0ZXJzIHx8IHt9XG4gICAgdGhpcy5fZXhhbXBsZVBhdHRlcm5zID0gZXhhbXBsZVBhdHRlcm5zIHx8IFtdXG4gICAgdGhpcy5fcHJvZmlsZXIgPSBwcm9maWxlclxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAwXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzID0gMFxuICAgIHRoaXMuX3Rlc3RzQ291bnQgPSAwXG4gICAgdGhpcy5fYWN0aXZlQWZ0ZXJBbGxTY29wZXMgPSBbXVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICAvKiogQHR5cGUge3tmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyfSB8IG51bGx9ICovXG4gICAgdGhpcy5fbGFzdFRlc3RDb250ZXh0ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXIsIGR1cmF0aW9uTXM6IG51bWJlcn0+fSAqL1xuICAgIHRoaXMuX3Rlc3REdXJhdGlvbnMgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fY29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgdGVzdCBmaWxlcy5cbiAgICovXG4gIGdldFRlc3RGaWxlcygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RGaWxlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxpbmUgZmlsdGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gLSBMaW5lIGZpbHRlcnMuXG4gICAqL1xuICBnZXRMaW5lRmlsdGVycygpIHsgcmV0dXJuIHRoaXMuX2xpbmVGaWx0ZXJzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhhbXBsZSBwYXR0ZXJucy5cbiAgICogQHJldHVybnMge1JlZ0V4cFtdfSAtIEV4YW1wbGUgcGF0dGVybnMuXG4gICAqL1xuICBnZXRFeGFtcGxlUGF0dGVybnMoKSB7IHJldHVybiB0aGlzLl9leGFtcGxlUGF0dGVybnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcHJvZmlsZXIgc3BhbiBvbmx5IHdoZW4gcHJvZmlsaW5nIHdhcyBleHBsaWNpdGx5IGVuYWJsZWQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBtZXRhZGF0YSAtIFNwYW4gbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YS5waGFzZSAtIFBoYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbWV0YWRhdGEuZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGRlY2xhcmF0aW9uIGluZGV4LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW21ldGFkYXRhLmRlY2xhcmF0aW9uU2NvcGVJZF0gLSBIb29rIGRlY2xhcmF0aW9uIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW21ldGFkYXRhLmZpbGVQYXRoXSAtIFNvdXJjZSBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7KCkgPT4gKFQgfCBQcm9taXNlPFQ+KX0gY2FsbGJhY2sgLSBUaW1lZCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuUHJvZmlsZVNwYW4obWV0YWRhdGEsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9maWxlcikgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9wcm9maWxlci5ydW5TcGFuKG1ldGFkYXRhLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGRlY2xhcmF0aW9uIG1ldGFkYXRhIHRvIGhvb2tzIG9ubHkgZm9yIGFuIGFjdGl2ZSBwcm9maWxlLlxuICAgKiBAdGVtcGxhdGUge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZSB8IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlfSBUXG4gICAqIEBwYXJhbSB7VFtdfSBob29rcyAtIEhvb2tzIGRlY2xhcmVkIGluIG9uZSBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGRlY2xhcmF0aW9uU2NvcGVJZCAtIFByb2ZpbGUgc2NvcGUgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG93bmVyRmlsZVBhdGggLSBTY29wZSBvd25lciBmaWxlLlxuICAgKiBAcmV0dXJucyB7VFtdfSAtIFByb2ZpbGUtYXdhcmUgaG9vayBlbnRyaWVzLlxuICAgKi9cbiAgcHJvZmlsZUhvb2tFbnRyaWVzKGhvb2tzLCBkZWNsYXJhdGlvblNjb3BlSWQsIG93bmVyRmlsZVBhdGgpIHtcbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSByZXR1cm4gaG9va3NcblxuICAgIHJldHVybiBob29rcy5tYXAoKGhvb2ssIGRlY2xhcmF0aW9uSW5kZXgpID0+IE9iamVjdC5hc3NpZ24oe30sIGhvb2ssIHtcbiAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IGhvb2suZGVjbGFyYXRpb25JbmRleCA/PyBkZWNsYXJhdGlvbkluZGV4LFxuICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBob29rLmRlY2xhcmF0aW9uU2NvcGVJZCA/PyBkZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICBvd25lckZpbGVQYXRoOiBob29rLm93bmVyRmlsZVBhdGggPz8gb3duZXJGaWxlUGF0aFxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHRhZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmcgfCB1bmRlZmluZWR9IHRhZ3MgLSBUYWdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTm9ybWFsaXplZCB0YWdzLlxuICAgKi9cbiAgbm9ybWFsaXplVGFncyh0YWdzKSB7XG4gICAgaWYgKCF0YWdzKSByZXR1cm4gW11cblxuICAgIGNvbnN0IHZhbHVlcyA9IFtdXG4gICAgY29uc3QgcmF3VGFncyA9IEFycmF5LmlzQXJyYXkodGFncykgPyB0YWdzIDogW3RhZ3NdXG5cbiAgICBmb3IgKGNvbnN0IHJhd1RhZyBvZiByYXdUYWdzKSB7XG4gICAgICBpZiAocmF3VGFnID09PSB1bmRlZmluZWQgfHwgcmF3VGFnID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyhyYXdUYWcpLnNwbGl0KFwiLFwiKVxuXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IHBhcnQudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIHZhbHVlcy5wdXNoKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldCh2YWx1ZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRhZy5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWcgLSBUYWcgdG8gY2hlY2sgZm9yLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRhZyBpcyBwcmVzZW50LlxuICAgKi9cbiAgaGFzVGFnKHRlc3RBcmdzLCB0YWcpIHtcbiAgICByZXR1cm4gdGhpcy5ub3JtYWxpemVUYWdzKHRlc3RBcmdzPy50YWdzKS5pbmNsdWRlcyh0YWcpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBicm93c2VyIHRlc3QgbW9kZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBydW5uaW5nIGJyb3dzZXIgdGVzdHMuXG4gICAqL1xuICBpc0Jyb3dzZXJUZXN0TW9kZSgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCBkdW1teSBpZiBuZWVkZWQuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gW2Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zXSAtIEF0dGVtcHQtb3duZWQgYnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhEdW1teUlmTmVlZGVkKHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXSkge1xuICAgIGlmICghdGhpcy5oYXNUYWcodGVzdEFyZ3MsIFwiZHVtbXlcIikpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLmlzQnJvd3NlclRlc3RNb2RlKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bk5vZGVEdW1teShjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBub2RlIGR1bW15LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuTm9kZUR1bW15KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZHVtbXlQYXRoID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RVTU1ZX1BBVEggfHwgdGhpcy5kZWZhdWx0RHVtbXlQYXRoKClcbiAgICBjb25zdCBkdW1teUltcG9ydCA9IGF3YWl0IGltcG9ydChwYXRoVG9GaWxlVVJMKGR1bW15UGF0aCkuaHJlZilcbiAgICBjb25zdCBEdW1teSA9IGR1bW15SW1wb3J0LmRlZmF1bHRcblxuICAgIGlmICghRHVtbXk/LnJ1bikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEdW1teSBoZWxwZXIgbm90IGZvdW5kIGF0ICR7ZHVtbXlQYXRofWApXG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzZXJ2ZXIgcmVzb3VyY2VzIG11c3Qgbm90IGluaGVyaXQgYW4gYXR0ZW1wdCBzY29wZSB0aGF0IHdpbGwgYmUgcmV2b2tlZC5cbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IER1bW15LnJ1bihhc3luYyAoKSA9PiB7fSlcbiAgICB9KVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgYXdhaXQgY2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCBkdW1teSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlZmF1bHQgZHVtbXkgaGVscGVyIHBhdGguXG4gICAqL1xuICBkZWZhdWx0RHVtbXlQYXRoKCkge1xuICAgIGNvbnN0IGN3ZCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBjd2Quc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpXG5cbiAgICBpZiAobm9ybWFsaXplZC5lbmRzV2l0aChcIi9zcGVjL2R1bW15XCIpKSB7XG4gICAgICByZXR1cm4gcGF0aC5qb2luKGN3ZCwgXCJpbmRleC5qc1wiKVxuICAgIH1cblxuICAgIHJldHVybiBwYXRoLmpvaW4oY3dkLCBcInNwZWMvZHVtbXkvaW5kZXguanNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBicm93c2VyIGR1bW15LlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zIC0gQXR0ZW1wdC1vd25lZCBicm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCB1c2VUcmFuc2FjdGlvbiA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRyYW5zYWN0aW9uID09PSB0cnVlXG4gICAgY29uc3QgdHJ1bmNhdGUgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZVxuICAgIGNvbnN0IHNob3VsZFRydW5jYXRlID0gdHJ1bmNhdGUgPT09IHVuZGVmaW5lZCA/ICF1c2VUcmFuc2FjdGlvbiA6IHRydW5jYXRlXG5cbiAgICBpZiAoIXVzZVRyYW5zYWN0aW9uICYmICFzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiVGVzdCBydW5uZXIgYnJvd3NlciBkdW1teVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgbmV3UmVnaXN0cmF0aW9ucyA9IE9iamVjdC5lbnRyaWVzKGRicykubWFwKChbZGF0YWJhc2VJZGVudGlmaWVyLCBkYl0pID0+IHtcbiAgICAgICAgLyoqIEB0eXBlIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSAqL1xuICAgICAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGRiLFxuICAgICAgICAgIHF1YXJhbnRpbmVkOiBmYWxzZVxuICAgICAgICB9XG5cbiAgICAgICAgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMucHVzaChyZWdpc3RyYXRpb24pXG5cbiAgICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICAgICAgfSlcblxuICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVEYXRhYmFzZXMoZGJzKVxuICAgICAgfVxuICAgICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgICBjb25zdCBsaWZlY3ljbGVFcnJvcnMgPSBbXVxuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAodXNlVHJhbnNhY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBzdGFydFByb21pc2VzID0gbmV3UmVnaXN0cmF0aW9ucy5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLmRiLnN0YXJ0VHJhbnNhY3Rpb24oKVxuXG4gICAgICAgICAgICByZWdpc3RyYXRpb24uc3RhcnRQcm9taXNlID0gc3RhcnRQcm9taXNlXG4gICAgICAgICAgICByZXR1cm4gc3RhcnRQcm9taXNlXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb25zdCBzdGFydFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc3RhcnRQcm9taXNlcylcbiAgICAgICAgICBjb25zdCBzdGFydEVycm9ycyA9IHN0YXJ0UmVzdWx0c1xuICAgICAgICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAgICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICAgICAgICBpZiAoc3RhcnRFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IHN0YXJ0RXJyb3JzWzBdXG4gICAgICAgICAgaWYgKHN0YXJ0RXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihzdGFydEVycm9ycywgXCJCcm93c2VyIGR1bW15IHRyYW5zYWN0aW9uIHN0YXJ0dXAgZmFpbGVkXCIsIHtjYXVzZTogc3RhcnRFcnJvcnNbMF19KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IpIHtcbiAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaCguLi5lcnJvci5lcnJvcnMpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICBhd2FpdCB0aGlzLnRydW5jYXRlRGF0YWJhc2VzKGRicylcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGxpZmVjeWNsZUVycm9yc1swXVxuICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihsaWZlY3ljbGVFcnJvcnMsIFwiQnJvd3NlciBkdW1teSBsaWZlY3ljbGUgYW5kIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogbGlmZWN5Y2xlRXJyb3JzWzBdfSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgZXZlcnkgYXR0ZW1wdC1vd25lZCBicm93c2VyIHRyYW5zYWN0aW9uIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgcm9sbGJhY2tzIHNldHRsZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCByb2xsYmFja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLnN0YXJ0UHJvbWlzZVxuXG4gICAgICBpZiAoIXN0YXJ0UHJvbWlzZSkgcmV0dXJuXG5cbiAgICAgIHJlZ2lzdHJhdGlvbi5yb2xsYmFja1Byb21pc2UgPz89IChhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24ucXVhcmFudGluZWQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgc3RhcnRQcm9taXNlXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgICAgICB9IGNhdGNoIChxdWFyYW50aW5lRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHF1YXJhbnRpbmUgYnJvd3NlciBkdW1teSBkYXRhYmFzZSBhZnRlciB0cmFuc2FjdGlvbiBzdGFydHVwIGZhaWxlZDogJHtyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyfWAsIHtjYXVzZTogcXVhcmFudGluZUVycm9yfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24uZGIucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgICAgIH0gY2F0Y2ggKHJvbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICAgICAgfSBjYXRjaCAocXVhcmFudGluZUVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICAgIFtyb2xsYmFja0Vycm9yLCBxdWFyYW50aW5lRXJyb3JdLFxuICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJvbGwgYmFjayBhbmQgcXVhcmFudGluZSBicm93c2VyIGR1bW15IGRhdGFiYXNlOiAke3JlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXJ9YCxcbiAgICAgICAgICAgICAge2NhdXNlOiBxdWFyYW50aW5lRXJyb3J9XG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IHJvbGxiYWNrRXJyb3JcbiAgICAgICAgfVxuICAgICAgfSkoKVxuXG4gICAgICByZXR1cm4gcmVnaXN0cmF0aW9uLnJvbGxiYWNrUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHJvbGxiYWNrUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiQnJvd3NlciBkdW1teSB0cmFuc2FjdGlvbiBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUGVybWFuZW50bHkgcmVtb3ZlcyBvbmUgYnJvd3NlciBjb25uZWN0aW9uIHRoYXQgY2Fubm90IGJlIHNoYXJlZCBzYWZlbHkuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gcmVnaXN0cmF0aW9uIC0gQnJvd3NlciBjb25uZWN0aW9uIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGNvbm5lY3Rpb24gaXMgZGlzY2FyZGVkLlxuICAgKi9cbiAgYXN5bmMgcXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkID0gdHJ1ZVxuICAgIHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lUHJvbWlzZSA/Pz0gdGhpcy5kaXNjYXJkQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyLCByZWdpc3RyYXRpb24uZGIpXG4gICAgYXdhaXQgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRGlzY2FyZHMgb25lIGJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiB0aHJvdWdoIGl0cyBvd25pbmcgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIENvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBVbnNhZmUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZGlzY2FyZC5cbiAgICovXG4gIGFzeW5jIGRpc2NhcmRCcm93c2VyRHVtbXlDb25uZWN0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgZGIpIHtcbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKS5kaXNjYXJkKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFF1YXJhbnRpbmVzIGFsbCBicm93c2VyIGNvbm5lY3Rpb25zIGNvbmN1cnJlbnRseS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgY29ubmVjdGlvbiBpcyBkaXNjYXJkZWQuXG4gICAqL1xuICBhc3luYyBxdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHF1YXJhbnRpbmVSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHJlZ2lzdHJhdGlvbnMubWFwKGFzeW5jIChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHF1YXJhbnRpbmVSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJCcm93c2VyIGR1bW15IGNvbm5lY3Rpb24gcXVhcmFudGluZSBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZGF0YWJhc2VzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gZGJzIC0gRGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZURhdGFiYXNlcyhkYnMpIHtcbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoZGJzKSkge1xuICAgICAgYXdhaXQgZGJzW2lkZW50aWZpZXJdLnRydW5jYXRlQWxsVGFibGVzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhjbHVkZSB0YWcgc2V0LlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRXhjbHVkZSB0YWcgc2V0LlxuICAgKi9cbiAgZ2V0RXhjbHVkZVRhZ1NldCgpIHtcbiAgICAvKipcbiAgICAgKiBDb25maWcgdGFncy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgY29uZmlnVGFncyA9IEFycmF5LmlzQXJyYXkodGVzdENvbmZpZy5leGNsdWRlVGFncykgPyB0ZXN0Q29uZmlnLmV4Y2x1ZGVUYWdzIDogW11cblxuICAgIHJldHVybiBuZXcgU2V0KFsuLi50aGlzLl9leGNsdWRlVGFncywgLi4uY29uZmlnVGFnc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgbWF0Y2hpbmcgdGFnLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nIHwgdW5kZWZpbmVkfSB0ZXN0VGFncyAtIFRlc3QgdGFncy5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gdGFnU2V0IC0gVGFnIHNldC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdGFncyBtYXRjaC5cbiAgICovXG4gIGhhc01hdGNoaW5nVGFnKHRlc3RUYWdzLCB0YWdTZXQpIHtcbiAgICBpZiAoIXRhZ1NldC5zaXplKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB0aGlzLm5vcm1hbGl6ZVRhZ3ModGVzdFRhZ3MpXG5cbiAgICBmb3IgKGNvbnN0IHRhZyBvZiBub3JtYWxpemVkKSB7XG4gICAgICBpZiAodGFnU2V0Lmhhcyh0YWcpKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHJ1bm5hYmxlIHRlc3RzLlxuICAgKiBAcGFyYW0ge1Rlc3RzQXJndW1lbnR9IHRlc3RzIC0gVGVzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFtkZXNjcmlwdGlvbnNdIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2xpbmVNYXRjaGVkSW5TY29wZV0gLSBXaGV0aGVyIGxpbmUgbWF0Y2hlZCBpbiBzY29wZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdGVzdHMgaW4gdGhpcyBzY29wZSB3aWxsIHJ1bi5cbiAgICovXG4gIGhhc1J1bm5hYmxlVGVzdHModGVzdHMsIGRlc2NyaXB0aW9ucyA9IFtdLCBsaW5lTWF0Y2hlZEluU2NvcGUgPSBmYWxzZSkge1xuICAgIGZvciAoY29uc3QgdGVzdERlc2NyaXB0aW9uIGluIHRlc3RzLnRlc3RzKSB7XG4gICAgICBjb25zdCB0ZXN0RGF0YSA9IHRlc3RzLnRlc3RzW3Rlc3REZXNjcmlwdGlvbl1cbiAgICAgIGNvbnN0IHRlc3RBcmdzID0gLyoqIEB0eXBlIHtUZXN0QXJnc30gKi8gKE9iamVjdC5hc3NpZ24oe30sIHRlc3REYXRhLmFyZ3MpKVxuICAgICAgY29uc3QgaW5jbHVkZUJ5TGluZSA9IGxpbmVNYXRjaGVkSW5TY29wZSB8fCB0aGlzLm1hdGNoZXNMaW5lRmlsdGVyKHRlc3REYXRhKVxuXG4gICAgICBpZiAodGhpcy5fb25seUZvY3Vzc2VkICYmICF0ZXN0QXJncy5mb2N1cykgY29udGludWVcbiAgICAgIGlmICh0aGlzLnNob3VsZFNraXBUZXN0KHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9uLCBkZXNjcmlwdGlvbnMsIGluY2x1ZGVCeUxpbmUpKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3ViRGVzY3JpcHRpb24gaW4gdGVzdHMuc3Vicykge1xuICAgICAgY29uc3Qgc3ViVGVzdCA9IHRlc3RzLnN1YnNbc3ViRGVzY3JpcHRpb25dXG4gICAgICBjb25zdCBzY29wZUxpbmVNYXRjaCA9IGxpbmVNYXRjaGVkSW5TY29wZSB8fCB0aGlzLm1hdGNoZXNMaW5lRmlsdGVyKHN1YlRlc3QpXG4gICAgICBjb25zdCBuZXh0RGVzY3JpcHRpb25zID0gZGVzY3JpcHRpb25zLmNvbmNhdChbc3ViRGVzY3JpcHRpb25dKVxuXG4gICAgICBpZiAodGhpcy5fb25seUZvY3Vzc2VkICYmICFzdWJUZXN0LmFueVRlc3RzRm9jdXNzZWQpIGNvbnRpbnVlXG4gICAgICBpZiAodGhpcy5oYXNSdW5uYWJsZVRlc3RzKHN1YlRlc3QsIG5leHREZXNjcmlwdGlvbnMsIHNjb3BlTGluZU1hdGNoKSkgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBza2lwIHRlc3QuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSB0ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGxpbmVNYXRjaGVkSW5TY29wZSAtIFdoZXRoZXIgbGluZSBtYXRjaGVkIGluIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB0ZXN0IHNob3VsZCBiZSBza2lwcGVkLlxuICAgKi9cbiAgc2hvdWxkU2tpcFRlc3QodGVzdEFyZ3MsIHRlc3REYXRhLCB0ZXN0RGVzY3JpcHRpb24sIGRlc2NyaXB0aW9ucywgbGluZU1hdGNoZWRJblNjb3BlKSB7XG4gICAgaWYgKHRoaXMuaGFzVGFnKHRlc3RBcmdzLCBcImJyb3dzZXItb25seVwiKSAmJiAhdGhpcy5pc0Jyb3dzZXJUZXN0TW9kZSgpKSByZXR1cm4gdHJ1ZVxuICAgIGlmICh0aGlzLmhhc01hdGNoaW5nVGFnKHRlc3RBcmdzLnRhZ3MsIHRoaXMuZ2V0RXhjbHVkZVRhZ1NldCgpKSkgcmV0dXJuIHRydWVcblxuICAgIGlmICh0aGlzLl9pbmNsdWRlVGFnU2V0LnNpemUgPiAwICYmICF0ZXN0QXJncy5mb2N1cykge1xuICAgICAgaWYgKCF0aGlzLmhhc01hdGNoaW5nVGFnKHRlc3RBcmdzLnRhZ3MsIHRoaXMuX2luY2x1ZGVUYWdTZXQpKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldEV4YW1wbGVQYXR0ZXJucygpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGZ1bGxEZXNjcmlwdGlvbiA9IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pXG4gICAgICBjb25zdCBtYXRjaGVzID0gdGhpcy5nZXRFeGFtcGxlUGF0dGVybnMoKS5zb21lKChwYXR0ZXJuKSA9PiB7XG4gICAgICAgIHBhdHRlcm4ubGFzdEluZGV4ID0gMFxuICAgICAgICByZXR1cm4gcGF0dGVybi50ZXN0KGZ1bGxEZXNjcmlwdGlvbilcbiAgICAgIH0pXG5cbiAgICAgIGlmICghbWF0Y2hlcykgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBsaW5lRmlsdGVycyA9IHRoaXMuZ2V0TGluZUZpbHRlcnMoKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGxpbmVGaWx0ZXJzKS5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAoIWxpbmVNYXRjaGVkSW5TY29wZSAmJiAhdGhpcy5tYXRjaGVzTGluZUZpbHRlcih0ZXN0RGF0YSkpIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVzIGxpbmUgZmlsdGVyLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhIHwgVGVzdHNBcmd1bWVudH0gZW50cnkgLSBUZXN0IGVudHJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGxpbmUgZmlsdGVyIG1hdGNoZXMgZW50cnkuXG4gICAqL1xuICBtYXRjaGVzTGluZUZpbHRlcihlbnRyeSkge1xuICAgIGlmICghZW50cnkgfHwgIWVudHJ5LmZpbGVQYXRoIHx8ICFlbnRyeS5saW5lKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKGVudHJ5LmZpbGVQYXRoKVxuICAgIGNvbnN0IGxpbmVzID0gdGhpcy5nZXRMaW5lRmlsdGVycygpW2ZpbGVQYXRoXVxuXG4gICAgaWYgKCFsaW5lcyB8fCBsaW5lcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGxpbmVzLmluY2x1ZGVzKGVudHJ5LmxpbmUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBmdWxsIGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnVsbCBkZXNjcmlwdGlvbi5cbiAgICovXG4gIGJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSB7XG4gICAgY29uc3QgcGFydHMgPSBkZXNjcmlwdGlvbnMuY29uY2F0KFt0ZXN0RGVzY3JpcHRpb25dKVxuXG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oXCIgXCIpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbGljYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFwcGxpY2F0aW9uPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcHBsaWNhdGlvbi5cbiAgICovXG4gIGFzeW5jIGFwcGxpY2F0aW9uKCkge1xuICAgIGlmICghdGhpcy5fYXBwbGljYXRpb24pIHtcbiAgICAgIHRoaXMuX2FwcGxpY2F0aW9uID0gbmV3IEFwcGxpY2F0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIC8vIFJ1biByZXF1ZXN0IGhhbmRsZXJzIGluIHRoZSBtYWluIHRocmVhZCAobm90IHdvcmtlciB0aHJlYWRzKSBzbyB0aGV5XG4gICAgICAgIC8vIHJlc29sdmUgREIgd29yayB0byB0aGUgcGVyLXRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gc2V0IGJ5XG4gICAgICAgIC8vIHtAbGluayBhY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9uc30uIFRoaXMgbGV0cyByZXF1ZXN0LXR5cGUgc3BlY3MgdXNlXG4gICAgICAgIC8vIHRyYW5zYWN0aW9uLWJhc2VkIGNsZWFuaW5nICh0aGVpciB3cml0ZXMgbGFuZCBpbnNpZGUgdGhlIHRlc3Qnc1xuICAgICAgICAvLyB0cmFuc2FjdGlvbiBhbmQgcm9sbCBiYWNrKSBpbnN0ZWFkIG9mIHRydW5jYXRpbmcgZXZlcnkgdGFibGUuXG4gICAgICAgIGh0dHBTZXJ2ZXI6IHtpblByb2Nlc3M6IHRydWUsIHBvcnQ6IDMxMDA2fSxcbiAgICAgICAgdHlwZTogXCJ0ZXN0LXJ1bm5lclwiXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLl9hcHBsaWNhdGlvbi5pbml0aWFsaXplKClcbiAgICAgIGF3YWl0IHRoaXMuX2FwcGxpY2F0aW9uLnN0YXJ0SHR0cFNlcnZlcigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGxpY2F0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGVhY2ggbm9uLXRlbmFudCBwZXItdGVzdCBjb25uZWN0aW9uIGFzIGEgZHluYW1pYyBjYW5kaWRhdGUgZm9yIGluLXByb2Nlc3NcbiAgICogcmVxdWVzdCBzaGFyaW5nLiBUaGUgcG9vbCBldmFsdWF0ZXMgdHJhbnNhY3Rpb24gc3RhdGUgd2hlbiBlYWNoIHJlcXVlc3QgaXMgZGlzcGF0Y2hlZCxcbiAgICogc28gYSB0cmFuc2FjdGlvbiBzdGFydGVkIG9yIGVuZGVkIGR1cmluZyBhIGhvb2sgY2FsbGJhY2sgdGFrZXMgZWZmZWN0IGltbWVkaWF0ZWx5LlxuICAgKiBJbmFjdGl2ZSBhbmQgdGVuYW50LW9ubHkgY29ubmVjdGlvbnMgcmVtYWluIGluZGVwZW5kZW50bHkgcG9vbGVkLiBQYWlyIHdpdGhcbiAgICoge0BsaW5rIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zfSBpbiBhIGZpbmFsbHkuXG4gICAqIEByZXR1cm5zIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAtIExpZmVjeWNsZS1vd25lZCByZWdpc3RyYXRpb25zLlxuICAgKi9cbiAgYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnMoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb25zID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICAgIC8qKiBAdHlwZSB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gKi9cbiAgICBjb25zdCByZWdpc3RyYXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhjdXJyZW50Q29ubmVjdGlvbnMpKSB7XG4gICAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgLy8gVGVuYW50LXNjb3BlZCBwb29scyByZXNvbHZlIGEgZGlmZmVyZW50IGNvbm5lY3Rpb24gcGVyIHJlcXVlc3QgdGVuYW50XG4gICAgICAvLyAodmlhIHJ1bldpdGhUZW5hbnQpLCBzbyBmb3JjaW5nIGEgc2luZ2xlIHNoYXJlZCBjb25uZWN0aW9uIHdvdWxkIGJyZWFrXG4gICAgICAvLyBwZXItcmVxdWVzdCB0ZW5hbnQgcmVzb2x1dGlvbi4gT25seSBzaGFyZSBub24tdGVuYW50IHBvb2xzOyB0aGUgdGVuYW50XG4gICAgICAvLyBwb29sIGtlZXBzIHJlc29sdmluZyBpdHMgb3duIGNvbm5lY3Rpb24gcGVyIHJlcXVlc3QuXG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uKCkudGVuYW50T25seSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gY3VycmVudENvbm5lY3Rpb25zW2lkZW50aWZpZXJdXG5cbiAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHBvb2wuc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcigoKSA9PiB7XG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkgPyBjb25uZWN0aW9uIDogdW5kZWZpbmVkXG4gICAgICB9KVxuXG4gICAgICBpZiAocmVnaXN0cmF0aW9uKSByZWdpc3RyYXRpb25zLnB1c2goe3Bvb2wsIHJlZ2lzdHJhdGlvbn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIGluLXByb2Nlc3MgdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBvbiBldmVyeSBjb25maWd1cmVkIHBvb2wuIElkZW1wb3RlbnQgYW5kXG4gICAqIHNhZmUgdG8gY2FsbCB3aGVuIG5vbmUgd2FzIHNldC5cbiAgICogQHBhcmFtIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSBbcmVnaXN0cmF0aW9uc10gLSBMaWZlY3ljbGUtb3duZWQgcmVnaXN0cmF0aW9ucyB0byBjbGVhciBjb25kaXRpb25hbGx5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBpZiAocmVnaXN0cmF0aW9ucykge1xuICAgICAgZm9yIChjb25zdCB7cG9vbCwgcmVnaXN0cmF0aW9ufSBvZiByZWdpc3RyYXRpb25zKSB7XG4gICAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBvdXQgYW5kIHJlZ2lzdGVycyBvbmUgcGh5c2ljYWwgdGVuYW50IHRyYW5zYWN0aW9uIGZvciB0aGUgY3VycmVudCBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgdGVuYW50OiBvYmplY3R9fSBhcmdzIC0gTG9naWNhbCBpZGVudGlmaWVyIGFuZCB0ZW5hbnQgZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBDdXJyZW50IGF0dGVtcHQgcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQoe2RhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50LCAuLi5yZXN0QXJnc30sIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIXRlbmFudCkgdGhyb3cgbmV3IEVycm9yKFwicmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgdGVuYW50XCIpXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi50ZW5hbnRPbmx5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIHRlbmFudE9ubHkgZGF0YWJhc2U6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuICAgIGNvbnN0IHJldXNlS2V5ID0gcG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGlmIChyZWdpc3RyYXRpb25zLnNvbWUoKHJlZ2lzdHJhdGlvbikgPT4gcmVnaXN0cmF0aW9uLnBvb2wgPT09IHBvb2wgJiYgcmVnaXN0cmF0aW9uLnJldXNlS2V5ID09PSByZXVzZUtleSkpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ufSAqL1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtcbiAgICAgIGNvbm5lY3Rpb246IHVuZGVmaW5lZCxcbiAgICAgIHBvb2wsXG4gICAgICByZXVzZUtleSxcbiAgICAgIHJldm9rZWQ6IGZhbHNlLFxuICAgICAgc2hhcmVkUmVnaXN0cmF0aW9uOiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZWdpc3RyYXRpb25zLnB1c2gocmVnaXN0cmF0aW9uKVxuICAgIHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2UgPSBwb29sXG4gICAgICAuY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwge25hbWU6IFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb25cIn0pXG4gICAgICAudGhlbihcbiAgICAgICAgKGNvbm5lY3Rpb24pID0+ICh7Y29ubmVjdGlvbiwgZXJyb3I6IHVuZGVmaW5lZH0pLFxuICAgICAgICAoZXJyb3IpID0+ICh7XG4gICAgICAgICAgY29ubmVjdGlvbjogdW5kZWZpbmVkLFxuICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCBjb25uZWN0aW9uIGNoZWNrb3V0IGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgfSlcbiAgICAgIClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjaGVja291dE91dGNvbWUgPSBhd2FpdCByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlXG5cbiAgICAgIGlmIChjaGVja291dE91dGNvbWUuZXJyb3IpIHRocm93IGNoZWNrb3V0T3V0Y29tZS5lcnJvclxuICAgICAgaWYgKCFjaGVja291dE91dGNvbWUuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgY29ubmVjdGlvbiBjaGVja291dCByZXR1cm5lZCBubyBjb25uZWN0aW9uXCIpXG4gICAgICByZWdpc3RyYXRpb24uY29ubmVjdGlvbiA9IGNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuXG4gICAgICBhd2FpdCByZWdpc3RyYXRpb24uY29ubmVjdGlvbi5zdGFydFRyYW5zYWN0aW9uKClcbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG5cbiAgICAgIGNvbnN0IHNoYXJlZFJlZ2lzdHJhdGlvbiA9IHBvb2wuc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Gb3JDb25maWd1cmF0aW9uKHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uLCByZXVzZUtleSlcbiAgICAgIGlmICghc2hhcmVkUmVnaXN0cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYERhdGFiYXNlIHBvb2wgZG9lcyBub3Qgc3VwcG9ydCB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25zOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgICAgcmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbiA9IHNoYXJlZFJlZ2lzdHJhdGlvblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB7XG4gICAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihzaGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZWdpc3RyYXRpb24ucmV2b2tlZCA9IHRydWVcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKFtyZWdpc3RyYXRpb25dLCB7ZGlzY2FyZDogcmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXAgPT09IHRydWV9KVxuICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbZXJyb3IsIGNsZWFudXBFcnJvcl0sIFwiRmFpbGVkIHRvIHJlZ2lzdGVyIGFuZCBjbGVhbiB1cCBhIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvblwiLCB7Y2F1c2U6IGNsZWFudXBFcnJvcn0pXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXZva2VzIGF0dGVtcHQgcmVnaXN0cmF0aW9ucyBiZWZvcmUgcm9sbGluZyBiYWNrIGFuZCByZWxlYXNpbmcgdGhlaXIgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQXR0ZW1wdCByZWdpc3RyYXRpb25zLlxuICAgKiBAcGFyYW0ge3tkaXNjYXJkPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIFdoZXRoZXIgY29ubmVjdGlvbnMgbXVzdCBiZSBkaXNjYXJkZWQgaW5zdGVhZCBvZiByZXR1cm5lZCB0byB0aGUgcG9vbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHMocmVnaXN0cmF0aW9ucywge2Rpc2NhcmQgPSBmYWxzZX0gPSB7fSkge1xuICAgIGZvciAoY29uc3QgcmVnaXN0cmF0aW9uIG9mIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5yZXZva2VkID0gdHJ1ZVxuICAgICAgaWYgKGRpc2NhcmQpIHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwID0gdHJ1ZVxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24pIHJlZ2lzdHJhdGlvbi5wb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbilcbiAgICB9XG4gICAgY29uc3QgY2xlYW51cFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgcmVnaXN0cmF0aW9uLmNsZWFudXBQcm9taXNlID8/PSB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbilcblxuICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvbi5jbGVhbnVwUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IGNsZWFudXBSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsZWFuIHVwIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvbnNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhbnMgb25lIGF0dGVtcHQgcmVnaXN0cmF0aW9uIGV4YWN0bHkgb25jZSwgaW5jbHVkaW5nIGEgY2hlY2tvdXQgdGhhdCB3YXMgc3RpbGwgcGVuZGluZyBhdCByZXZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb259IHJlZ2lzdHJhdGlvbiAtIEF0dGVtcHQtb3duZWQgcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByb2xsYmFjayBhbmQgcmVsZWFzZSBvciBxdWFyYW50aW5lLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgbGV0IGNvbm5lY3Rpb24gPSByZWdpc3RyYXRpb24uY29ubmVjdGlvblxuXG4gICAgaWYgKCFjb25uZWN0aW9uICYmIHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2UpIHtcbiAgICAgIGNvbnN0IGNoZWNrb3V0T3V0Y29tZSA9IGF3YWl0IHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2VcblxuICAgICAgaWYgKGNoZWNrb3V0T3V0Y29tZS5lcnJvcikgcmV0dXJuXG4gICAgICBjb25uZWN0aW9uID0gY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb25cbiAgICAgIHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uID0gY29ubmVjdGlvblxuICAgIH1cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIHRyeSB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBhd2FpdCBjb25uZWN0aW9uLnJvbGxiYWNrVHJhbnNhY3Rpb24oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwKSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLnBvb2wuZGlzY2FyZChjb25uZWN0aW9uKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5wb29sLmNoZWNraW4oY29ubmVjdGlvbilcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsZWFuIHVwIGEgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyB0aGUgY3VycmVudCBub24tdGVuYW50IGNvbm5lY3Rpb25zIGVsaWdpYmxlIGZvciBzaGFyZWQgdHJhbnNhY3Rpb24gd29yay5cbiAgICogQHBhcmFtIHt7dHJhbnNhY3Rpb25zT25seTogYm9vbGVhbn19IGFyZ3MgLSBTZWxlY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBFbGlnaWJsZSBjb25uZWN0aW9ucyBieSBpZGVudGlmaWVyLlxuICAgKi9cbiAgc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seX0pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbnMgPSBjb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoY3VycmVudENvbm5lY3Rpb25zKSkge1xuICAgICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb24oKS50ZW5hbnRPbmx5KSBjb250aW51ZVxuICAgICAgaWYgKHRyYW5zYWN0aW9uc09ubHkgJiYgIWNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSkgY29udGludWVcbiAgICAgIGNvbm5lY3Rpb25zW2lkZW50aWZpZXJdID0gY29ubmVjdGlvblxuICAgIH1cblxuICAgIHJldHVybiBjb25uZWN0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIHBoeXNpY2FsLWNvbm5lY3Rpb24gY29vcmRpbmF0aW9uIGJlZm9yZSBhIHRyYW5zYWN0aW9uLW9wZW5pbmcgaG9va1xuICAgKiBjYW4gZXhwb3NlIHRoZSBzaGFyZWQgY29ubmVjdGlvbiB0byBhIGxvbmctbGl2ZWQgaW4tcHJvY2VzcyBzZXJ2aWNlLlxuICAgKiBDaGlsZC1wcm9jZXNzIGNvb3JkaW5hdGVzIHJlbWFpbiB1bnB1Ymxpc2hlZCB1bnRpbCB0aGUgdHJhbnNhY3Rpb24gZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZD59IC0gUHJlcGFyZWQgY29vcmRpbmF0b3IuXG4gICAqL1xuICBhc3luYyBwcmVwYXJlU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IGZhbHNlfSlcblxuICAgIGlmIChPYmplY3Qua2V5cyhjb25uZWN0aW9ucykubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4ge1xuICAgICAgYnJva2VyOiBhd2FpdCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlci5zdGFydCh7Y29ubmVjdGlvbnN9KSxcbiAgICAgIGVudmlyb25tZW50UHVibGlzaGVkOiBmYWxzZSxcbiAgICAgIHByZXZpb3VzRW52aXJvbm1lbnQ6IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHByZXBhcmVkIGJyb2tlciBjb29yZGluYXRlcyBleGFjdGx5IHRoZSBzZWxlY3RlZCBwaHlzaWNhbCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gcmVnaXN0cmF0aW9uIC0gUHJlcGFyZWQgY29vcmRpbmF0b3IuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBjb25uZWN0aW9ucyAtIFNlbGVjdGVkIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBpZGVudGlmaWVyIHNldCBhbmQgcGh5c2ljYWwgY29ubmVjdGlvbnMgbWF0Y2ggZXhhY3RseS5cbiAgICovXG4gIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbiwgY29ubmVjdGlvbnMpIHtcbiAgICBjb25zdCBpZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKVxuXG4gICAgaWYgKCFyZWdpc3RyYXRpb24gfHwgaWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoT2JqZWN0LmtleXMocmVnaXN0cmF0aW9uLmJyb2tlci5jb25uZWN0aW9ucykubGVuZ3RoICE9PSBpZGVudGlmaWVycy5sZW5ndGgpIHJldHVybiBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoY29ubmVjdGlvbnMpKSB7XG4gICAgICBpZiAocmVnaXN0cmF0aW9uLmJyb2tlci5jb25uZWN0aW9uc1tpZGVudGlmaWVyXSAhPT0gY29ubmVjdGlvbikgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYSBjYXBhYmlsaXR5LXNjb3BlZCBicm9rZXIgZm9yIHRoZSBhY3RpdmUgbm9uLXRlbmFudCBwaHlzaWNhbFxuICAgKiB0cmFuc2FjdGlvbiBjb25uZWN0aW9ucy4gTm8gYnJva2VyL2VudiBpcyBpbnN0YWxsZWQgZm9yIHRydW5jYXRpb24tb25seSBvclxuICAgKiBvdGhlciB0cmFuc2FjdGlvbi1kaXNhYmxlZCBhdHRlbXB0cy5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbn0gW3ByZXBhcmVkUmVnaXN0cmF0aW9uXSAtIENvb3JkaW5hdG9yIHByZXBhcmVkIGJlZm9yZSBob29rcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IFtzZWxlY3RlZENvbm5lY3Rpb25zXSAtIFBvc3QtaG9vayBhY3RpdmUgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGFzeW5jIHN0YXJ0U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24sIHNlbGVjdGVkQ29ubmVjdGlvbnMpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHNlbGVjdGVkQ29ubmVjdGlvbnMgfHwgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5OiB0cnVlfSlcblxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyhjb25uZWN0aW9ucylcbiAgICBpZiAoZGF0YWJhc2VJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgcmV0dXJuIHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGxldCBicm9rZXJcblxuICAgIGlmIChwcmVwYXJlZFJlZ2lzdHJhdGlvbiAmJiB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHByZXBhcmVkUmVnaXN0cmF0aW9uLCBjb25uZWN0aW9ucykpIHtcbiAgICAgIGJyb2tlciA9IHByZXBhcmVkUmVnaXN0cmF0aW9uLmJyb2tlclxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgIGJyb2tlciA9IGF3YWl0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLnN0YXJ0KHtjb25uZWN0aW9uc30pXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNFbnZpcm9ubWVudCA9IHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXVxuICAgIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXSA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGFkZHJlc3M6IGJyb2tlci5hZGRyZXNzKCksXG4gICAgICBjYXBhYmlsaXR5OiBicm9rZXIuY2FwYWJpbGl0eSgpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIGV4cGVjdGVkOiB0cnVlXG4gICAgfSkpLnRvU3RyaW5nKFwiYmFzZTY0dXJsXCIpXG5cbiAgICByZXR1cm4ge2Jyb2tlciwgZW52aXJvbm1lbnRQdWJsaXNoZWQ6IHRydWUsIHByZXZpb3VzRW52aXJvbm1lbnR9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlcyBhbiBhdHRlbXB0IGJyb2tlciBiZWZvcmUgZGF0YWJhc2Ugcm9sbGJhY2sgaG9va3MgcnVuIGFuZCByZXN0b3Jlc1xuICAgKiB0aGUgY2FsbGVyJ3MgZW52aXJvbm1lbnQgc28gbGF0ZXIgcG9vbGVkL3NwYXduZWQgY2hpbGRyZW4gY2Fubm90IGluaGVyaXQgaXQuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHJlZ2lzdHJhdGlvbiAtIEF0dGVtcHQgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHJlZ2lzdHJhdGlvbikge1xuICAgIGlmICghcmVnaXN0cmF0aW9uKSByZXR1cm5cblxuICAgIGlmIChyZWdpc3RyYXRpb24uZW52aXJvbm1lbnRQdWJsaXNoZWQpIHtcbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucHJldmlvdXNFbnZpcm9ubWVudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXSA9IHJlZ2lzdHJhdGlvbi5wcmV2aW91c0Vudmlyb25tZW50XG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5icm9rZXIuY2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWVzdCBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlcXVlc3RDbGllbnQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlcXVlc3QgY2xpZW50LlxuICAgKi9cbiAgYXN5bmMgcmVxdWVzdENsaWVudCgpIHtcbiAgICBpZiAoIXRoaXMuX3JlcXVlc3RDbGllbnQpIHtcbiAgICAgIHRoaXMuX3JlcXVlc3RDbGllbnQgPSBuZXcgUmVxdWVzdENsaWVudCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlcXVlc3RDbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGltcG9ydCB0ZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW1wb3J0VGVzdEZpbGVzKCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSB7XG4gICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKHRoaXMuZ2V0VGVzdEZpbGVzKCkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRoaXMuZ2V0VGVzdEZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmVnaXN0cmF0aW9ucyA9IHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHModGVzdHMpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICB9LCB7ZmlsZVBhdGg6IHRlc3RGaWxlfSlcbiAgICAgIHRoaXMuYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcCh0ZXN0cywgZXhpc3RpbmdSZWdpc3RyYXRpb25zLCB0ZXN0RmlsZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29sbGVjdHMgcmVnaXN0ZXJlZCBzY29wZSwgaG9vaywgYW5kIHRlc3Qgb2JqZWN0cyBieSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBzY29wZSAtIFRlc3Qgc2NvcGUuXG4gICAqIEBwYXJhbSB7U2V0PG9iamVjdD59IFtyZWdpc3RyYXRpb25zXSAtIEFjY3VtdWxhdGVkIGlkZW50aXRpZXMuXG4gICAqIEByZXR1cm5zIHtTZXQ8b2JqZWN0Pn0gLSBSZWdpc3RyYXRpb24gaWRlbnRpdGllcy5cbiAgICovXG4gIHRlc3RSZWdpc3RyYXRpb25PYmplY3RzKHNjb3BlLCByZWdpc3RyYXRpb25zID0gbmV3IFNldCgpKSB7XG4gICAgcmVnaXN0cmF0aW9ucy5hZGQoc2NvcGUpXG5cbiAgICBmb3IgKGNvbnN0IGhvb2sgb2YgWy4uLnNjb3BlLmJlZm9yZUFsbHMsIC4uLnNjb3BlLmJlZm9yZUVhY2hlcywgLi4uc2NvcGUuYWZ0ZXJFYWNoZXMsIC4uLnNjb3BlLmFmdGVyQWxsc10pIHtcbiAgICAgIHJlZ2lzdHJhdGlvbnMuYWRkKGhvb2spXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0ZXN0RGF0YSBvZiBPYmplY3QudmFsdWVzKHNjb3BlLnRlc3RzKSkgcmVnaXN0cmF0aW9ucy5hZGQodGVzdERhdGEpXG4gICAgZm9yIChjb25zdCBjaGlsZFNjb3BlIG9mIE9iamVjdC52YWx1ZXMoc2NvcGUuc3VicykpIHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMoY2hpbGRTY29wZSwgcmVnaXN0cmF0aW9ucylcblxuICAgIHJldHVybiByZWdpc3RyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBkZXRlcm1pbmlzdGljIG93bmVyc2hpcCB0byByZWdpc3RyYXRpb25zIGFkZGVkIGJ5IG9uZSBlbnRyeSBmaWxlLFxuICAgKiBpbmNsdWRpbmcgZGVjbGFyYXRpb25zIG9yaWdpbmF0aW5nIGluIGEgaGVscGVyIGltcG9ydGVkIGJ5IHRoYXQgZW50cnkgZmlsZS5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBzY29wZSAtIFRlc3Qgc2NvcGUuXG4gICAqIEBwYXJhbSB7U2V0PG9iamVjdD59IHByZXZpb3VzUmVnaXN0cmF0aW9ucyAtIElkZW50aXRpZXMgcHJlc2VudCBiZWZvcmUgaW1wb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3duZXJGaWxlUGF0aCAtIEltcG9ydGluZyBlbnRyeSBmaWxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAoc2NvcGUsIHByZXZpb3VzUmVnaXN0cmF0aW9ucywgb3duZXJGaWxlUGF0aCkge1xuICAgIGlmICghcHJldmlvdXNSZWdpc3RyYXRpb25zLmhhcyhzY29wZSkpIHNjb3BlLm93bmVyRmlsZVBhdGggPz89IG93bmVyRmlsZVBhdGhcblxuICAgIGZvciAoY29uc3QgaG9vayBvZiBbLi4uc2NvcGUuYmVmb3JlQWxscywgLi4uc2NvcGUuYmVmb3JlRWFjaGVzLCAuLi5zY29wZS5hZnRlckVhY2hlcywgLi4uc2NvcGUuYWZ0ZXJBbGxzXSkge1xuICAgICAgaWYgKCFwcmV2aW91c1JlZ2lzdHJhdGlvbnMuaGFzKGhvb2spKSBob29rLm93bmVyRmlsZVBhdGggPz89IG93bmVyRmlsZVBhdGhcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHRlc3REYXRhIG9mIE9iamVjdC52YWx1ZXMoc2NvcGUudGVzdHMpKSB7XG4gICAgICBpZiAoIXByZXZpb3VzUmVnaXN0cmF0aW9ucy5oYXModGVzdERhdGEpKSB0ZXN0RGF0YS5vd25lckZpbGVQYXRoID8/PSBvd25lckZpbGVQYXRoXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjaGlsZFNjb3BlIG9mIE9iamVjdC52YWx1ZXMoc2NvcGUuc3VicykpIHtcbiAgICAgIHRoaXMuYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcChjaGlsZFNjb3BlLCBwcmV2aW91c1JlZ2lzdHJhdGlvbnMsIG93bmVyRmlsZVBhdGgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZmFpbGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGZhaWxlZC5cbiAgICovXG4gIGlzRmFpbGVkKCkgeyByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdHMgIT09IHVuZGVmaW5lZCAmJiB0aGlzLl9mYWlsZWRUZXN0cyA+IDAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGZhaWxlZCB0ZXN0cy5cbiAgICovXG4gIGdldEZhaWxlZFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9mYWlsZWRUZXN0cyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdCBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7RmFpbGVkVGVzdERldGFpbFtdfSAtIEZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0RGV0YWlscygpIHtcbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdERldGFpbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3QgZmFpbGVkIHRlc3QgY29uc29sZSBvdXRwdXRzIHRvIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYXNzZXRzUGF0aF0gLSBBc3NldHMgZGlyZWN0b3J5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBXcml0dGVuIGxvZyBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdEZhaWxlZFRlc3RDb25zb2xlT3V0cHV0c1RvQXNzZXRzKHthc3NldHNQYXRoID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksIFwidG1wL3NjcmVlbnNob3RzXCIpfSA9IHt9KSB7XG4gICAgY29uc3QgZmFpbGVkVGVzdERldGFpbHMgPSB0aGlzLmdldEZhaWxlZFRlc3REZXRhaWxzKClcbiAgICBjb25zdCB3cml0dGVuTG9nUGF0aHMgPSBbXVxuICAgIGxldCBjcmVhdGVkRGlyZWN0b3J5ID0gZmFsc2VcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBmYWlsZWRUZXN0RGV0YWlscy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGNvbnN0IGZhaWxlZFRlc3REZXRhaWwgPSBmYWlsZWRUZXN0RGV0YWlsc1tpbmRleF1cbiAgICAgIGNvbnN0IGNvbnNvbGVPdXRwdXQgPSBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVPdXRwdXRcblxuICAgICAgaWYgKCFjb25zb2xlT3V0cHV0KSBjb250aW51ZVxuXG4gICAgICBpZiAoIWNyZWF0ZWREaXJlY3RvcnkpIHtcbiAgICAgICAgYXdhaXQgZnMubWtkaXIoYXNzZXRzUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgICAgIGNyZWF0ZWREaXJlY3RvcnkgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IFtcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRGdWxsWWVhcigpKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldERhdGUoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldEhvdXJzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaW51dGVzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRTZWNvbmRzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaWxsaXNlY29uZHMoKSkucGFkU3RhcnQoMywgXCIwXCIpXG4gICAgICBdLmpvaW4oXCJcIilcbiAgICAgIGNvbnN0IHNsdWcgPSB0b0ZpbGVTbHVnKGZhaWxlZFRlc3REZXRhaWwuZnVsbERlc2NyaXB0aW9uKVxuICAgICAgY29uc3QgZmlsZU5hbWUgPSBgJHt0aW1lc3RhbXB9LSR7U3RyaW5nKGluZGV4ICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpfS0ke3NsdWd9LmNvbnNvbGUubG9nYFxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oYXNzZXRzUGF0aCwgZmlsZU5hbWUpXG5cbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgY29uc29sZU91dHB1dCwgXCJ1dGY4XCIpXG4gICAgICBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVMb2dQYXRoID0gZmlsZVBhdGhcbiAgICAgIHdyaXR0ZW5Mb2dQYXRocy5wdXNoKGZpbGVQYXRoKVxuICAgIH1cblxuICAgIHJldHVybiB3cml0dGVuTG9nUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKi9cbiAgZ2V0U3VjY2Vzc2Z1bFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldFRlc3RzQ291bnQoKSB7XG4gICAgaWYgKHRoaXMuX3Rlc3RzQ291bnQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RzQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZXhlY3V0ZWQgdGVzdHMgY291bnQuXG4gICAqL1xuICBnZXRFeGVjdXRlZFRlc3RzQ291bnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3Rlc3REdXJhdGlvbnMubGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdGVzdHMgcmVjb3JkZWQgZHVyaW5nIHRoZSBydW4sIHNsb3dlc3QgZmlyc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbGltaXRdIC0gTWF4aW11bSBudW1iZXIgb2YgdGVzdHMgdG8gcmV0dXJuICgwIHJldHVybnMgYWxsKS5cbiAgICogQHJldHVybnMge0FycmF5PHtmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyLCBkdXJhdGlvbk1zOiBudW1iZXJ9Pn0gLSBTbG93ZXN0IHRlc3RzLCBzbG93ZXN0IGZpcnN0LlxuICAgKi9cbiAgZ2V0U2xvd2VzdFRlc3RzKGxpbWl0ID0gMTApIHtcbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4udGhpcy5fdGVzdER1cmF0aW9uc10uc29ydCgodGVzdEEsIHRlc3RCKSA9PiB0ZXN0Qi5kdXJhdGlvbk1zIC0gdGVzdEEuZHVyYXRpb25NcylcblxuICAgIHJldHVybiBsaW1pdCA+IDAgPyBzb3J0ZWQuc2xpY2UoMCwgbGltaXQpIDogc29ydGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZSgpIHtcbiAgICB0aGlzLmFueVRlc3RzRm9jdXNzZWQgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gMFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICB0aGlzLl90ZXN0RHVyYXRpb25zID0gW11cbiAgICBjb25zdCB0ZXN0aW5nQ29uZmlnUGF0aCA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldFRlc3RpbmcoKVxuXG4gICAgaWYgKHRlc3RpbmdDb25maWdQYXRoKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blByb2ZpbGVTcGFuKHtwaGFzZTogXCJ0ZXN0aW5nIGNvbmZpZy9nbG9iYWwgc2V0dXBcIn0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW1wb3J0VGVzdGluZ0NvbmZpZ1BhdGgoKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmltcG9ydFRlc3RGaWxlcygpXG4gICAgYXdhaXQgdGhpcy5hbmFseXplVGVzdHModGVzdHMpXG4gICAgdGhpcy5fb25seUZvY3Vzc2VkID0gdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcmUgYW55IHRlc3RzIGZvY3Vzc2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFueSB0ZXN0cyBmb2N1c3NlZC5cbiAgICovXG4gIGFyZUFueVRlc3RzRm9jdXNzZWQoKSB7XG4gICAgaWYgKHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJIYXNuJ3QgYmVlbiBkZXRlY3RlZCB5ZXRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICAvKipcbiAgICogUmVjb3JkcyBhbiBhc3luY2hyb25vdXMgY3Jhc2ggKGFuIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbiBkZXRhY2hlZCBmcm9tXG4gICAqIGFueSBhd2FpdCwgZS5nLiBhIGB2b2lkIGNvbm5lY3Rpb24uYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4gYnJvYWRjYXN0KC4uLikpYFxuICAgKiBmcm9udGVuZC1tb2RlbCBwdWJsaXNoIOKAlCBvciBhIHN5bmNocm9ub3VzIHRocm93IGluc2lkZSBhIGRldGFjaGVkIGNhbGxiYWNrXG4gICAqIHN1Y2ggYXMgYSBkcml2ZXIgc29ja2V0IG9yIHRpbWVyIGNhbGxiYWNrKSBhcyBhIHJlYWwsIHZpc2libGUsIGF0dHJpYnV0ZWRcbiAgICogdGVzdCBmYWlsdXJlLlxuICAgKlxuICAgKiBXaXRob3V0IHRoaXMsIHN1Y2ggYSByZWplY3Rpb24vZXhjZXB0aW9uIGhhcyBubyBoYW5kbGVyLCBzbyBvbiBtb2Rlcm4gTm9kZVxuICAgKiB0aGUgcHJvY2VzcyBpcyBURVJNSU5BVEVEIOKAlCB0aGUgcnVuIGVuZHMgd2l0aCBubyByZXBvcnRlZCBmYWlsdXJlcyBhbmQgQ0lcbiAgICoganVzdCBzZWVzIGEgY3Jhc2hlZC9yZXRyaWVkIHNoYXJkIHdpdGggYW4gZW1wdHkgcmVzdWx0ICh0aGUgcmVjdXJyaW5nXG4gICAqIFwic2lsZW50IHRlc3QtcnVubmVyIGRlYXRoXCI6IGludmlzaWJsZSBhbmQgaW1wb3NzaWJsZSB0byBkaWFnbm9zZSkuIFR1cm5pbmdcbiAgICogaXQgaW50byBhIGZhaWx1cmUgbWFrZXMgdGhlIHJ1biBnbyByZWQgd2l0aCBzb21ldGhpbmcgZGVidWdnYWJsZSBpbnN0ZWFkIG9mXG4gICAqIHZhbmlzaGluZy5cbiAgICogQHBhcmFtIHtcInVuY2F1Z2h0RXhjZXB0aW9uXCIgfCBcInVuaGFuZGxlZFJlamVjdGlvblwifSBraW5kIC0gQXN5bmMtY3Jhc2gga2luZC5cbiAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBSZWplY3Rpb24gcmVhc29uIG9yIHRocm93biBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRBc3luY0NyYXNoKGtpbmQsIHJlYXNvbikge1xuICAgIGNvbnN0IGVycm9yID0gcmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyByZWFzb24gOiBuZXcgRXJyb3IoYCR7a2luZH06ICR7U3RyaW5nKHJlYXNvbil9YClcbiAgICBjb25zdCBuZWFyID0gdGhpcy5fbGFzdFRlc3RDb250ZXh0XG4gICAgY29uc3QgYXR0cmlidXRpb24gPSBuZWFyID8gYCwgbmVhciB0ZXN0OiAke25lYXIuZnVsbERlc2NyaXB0aW9ufSAoJHtuZWFyLmZpbGVQYXRofToke25lYXIubGluZX0pYCA6IFwiXCJcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gKHRoaXMuX2ZhaWxlZFRlc3RzIHx8IDApICsgMVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiBgPCR7a2luZH0gZHVyaW5nIHRlc3QgcnVuJHthdHRyaWJ1dGlvbn0+YCxcbiAgICAgIGZpbGVQYXRoOiBuZWFyID8gbmVhci5maWxlUGF0aCA6IFwiPHRlc3QgcnVubmVyPlwiLFxuICAgICAgbGluZTogbmVhciA/IG5lYXIubGluZSA6IDAsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5bdGVzdC1ydW5uZXJdICR7a2luZH0gZHVyaW5nIHRoZSB0ZXN0IHJ1biDigJQgdGhpcyB3b3VsZCBvdGhlcndpc2UgdGVybWluYXRlIHRoZSBwcm9jZXNzIHNpbGVudGx5IGFuZCBzdXJmYWNlIG9ubHkgYXMgYSBjcmFzaGVkL3JldHJpZWQgc2hhcmQgd2l0aCB6ZXJvIHJlcG9ydGVkIGZhaWx1cmVzLiR7YXR0cmlidXRpb259YCkpXG4gICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgY2xlYW51cCBmYWlsdXJlIGFmdGVyIHRpbWVvdXQgaGFuZGxpbmcgaGFzIGJlZ3VuLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIERldGFjaGVkIGNsZWFudXAgcmVqZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2xlYW51cE5hbWUgLSBDbGVhbnVwIG9wZXJhdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge1NldDxFcnJvcj59IFtyZWNvcmRlZEVycm9yc10gLSBBdHRlbXB0LW93bmVkIGNsZWFudXAgZXJyb3JzIGFscmVhZHkgcmVwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKHJlYXNvbiwgY2xlYW51cE5hbWUsIHJlY29yZGVkRXJyb3JzKSB7XG4gICAgY29uc3QgZXJyb3IgPSByZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHJlYXNvbiA6IG5ldyBFcnJvcihgJHtjbGVhbnVwTmFtZX0gY2xlYW51cCBmYWlsZWQ6ICR7U3RyaW5nKHJlYXNvbil9YClcblxuICAgIGlmIChyZWNvcmRlZEVycm9ycykge1xuICAgICAgLy8gTXVsdGlwbGUgYm91bmRlZCBvYnNlcnZlcnMgY2FuIHJlY2VpdmUgdGhlIHNhbWUgZGV0YWNoZWQgY2xlYW51cCByZWplY3Rpb24uXG4gICAgICBpZiAocmVjb3JkZWRFcnJvcnMuaGFzKGVycm9yKSkgcmV0dXJuXG4gICAgICByZWNvcmRlZEVycm9ycy5hZGQoZXJyb3IpXG4gICAgfVxuXG4gICAgY29uc3QgbmVhciA9IHRoaXMuX2xhc3RUZXN0Q29udGV4dFxuICAgIGNvbnN0IGF0dHJpYnV0aW9uID0gbmVhciA/IGAsIG5lYXIgdGVzdDogJHtuZWFyLmZ1bGxEZXNjcmlwdGlvbn0gKCR7bmVhci5maWxlUGF0aH06JHtuZWFyLmxpbmV9KWAgOiBcIlwiXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9ICh0aGlzLl9mYWlsZWRUZXN0cyB8fCAwKSArIDFcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogYDwke2NsZWFudXBOYW1lfSBlbWVyZ2VuY3kgY2xlYW51cCBmYWlsdXJlJHthdHRyaWJ1dGlvbn0+YCxcbiAgICAgIGZpbGVQYXRoOiBuZWFyID8gbmVhci5maWxlUGF0aCA6IFwiPHRlc3QgcnVubmVyPlwiLFxuICAgICAgbGluZTogbmVhciA/IG5lYXIubGluZSA6IDAsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5bdGVzdC1ydW5uZXJdICR7Y2xlYW51cE5hbWV9IGNsZWFudXAgZmFpbGVkIGFmdGVyIHRpbWVvdXQgaGFuZGxpbmcgYmVnYW4uJHthdHRyaWJ1dGlvbn1gKSlcbiAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICB9XG5cbiAgYXN5bmMgcnVuKCkge1xuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBwcm9jZXNzLWxldmVsIHVuaGFuZGxlZCByZWplY3Rpb24gZHVyaW5nIHRoZSBydW4uXG4gICAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBSZWplY3Rpb24gcmVhc29uLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIGNvbnN0IG9uVW5oYW5kbGVkUmVqZWN0aW9uID0gKHJlYXNvbikgPT4ge1xuICAgICAgLy8gSWYgYSB0ZXN0IGF0dGFjaGVkIGl0cyBPV04gdW5oYW5kbGVkUmVqZWN0aW9uIGxpc3RlbmVyLCBpdCBpc1xuICAgICAgLy8gaW50ZW50aW9uYWxseSBvYnNlcnZpbmcvdHJpZ2dlcmluZyB0aGUgcmVqZWN0aW9uIChlLmcuIGJlYWNvblxuICAgICAgLy8gZXJyb3ItcmVwb3J0aW5nLXNwZWMuanMpIOKAlCBOb2RlIGRpc3BhdGNoZXMgdG8gRVZFUlkgbGlzdGVuZXIsIHNvIGFsc29cbiAgICAgIC8vIGZhaWxpbmcgdGhlIHN1aXRlIGhlcmUgd291bGQgYnJlYWsgdGhvc2UgdGVzdHMuIERlZmVyIHRvIHRoZSB0ZXN0J3NcbiAgICAgIC8vIGhhbmRsZXI7IG9ubHkgdHJlYXQgYSByZWplY3Rpb24gYXMgYSBzaWxlbnQtZGVhdGggY3Jhc2ggd2hlbiBvdXJzIGlzIHRoZVxuICAgICAgLy8gc29sZSBsaXN0ZW5lciAobm8gcGVyc2lzdGVudCBmcmFtZXdvcmsgbGlzdGVuZXIgZXhpc3RzIHRvIG1hc2sgdGhpcykuXG4gICAgICBpZiAocHJvY2Vzcy5saXN0ZW5lckNvdW50KFwidW5oYW5kbGVkUmVqZWN0aW9uXCIpID4gMSkgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVjb3JkQXN5bmNDcmFzaChcInVuaGFuZGxlZFJlamVjdGlvblwiLCByZWFzb24pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIHByb2Nlc3MtbGV2ZWwgdW5jYXVnaHQgZXhjZXB0aW9uIGR1cmluZyB0aGUgcnVuIOKAlCBhXG4gICAgICogc3luY2hyb25vdXMgdGhyb3cgaW5zaWRlIGEgZGV0YWNoZWQgY2FsbGJhY2sgKGRyaXZlciBzb2NrZXQsIHRpbWVyLFxuICAgICAqIGV2ZW50IGVtaXR0ZXIpIHRoYXQgbm8gdGVzdCBhd2FpdCBvYnNlcnZlcy4gU2FtZSBzaWxlbnQtZGVhdGggbW9kZSBhc1xuICAgICAqIHVuaGFuZGxlZCByZWplY3Rpb25zOiB3aXRob3V0IGEgaGFuZGxlciB0aGUgcHJvY2VzcyBkaWVzIG1pZC1ydW4gYW5kIENJXG4gICAgICogc2VlcyBhIGNyYXNoZWQgc2hhcmQgd2l0aCB6ZXJvIHJlcG9ydGVkIGZhaWx1cmVzLlxuICAgICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBUaHJvd24gZXJyb3IuXG4gICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICovXG4gICAgY29uc3Qgb25VbmNhdWdodEV4Y2VwdGlvbiA9IChlcnJvcikgPT4ge1xuICAgICAgLy8gTWlycm9yIHRoZSB1bmhhbmRsZWRSZWplY3Rpb24gZGVmZXJyYWw6IGEgdGVzdCBvYnNlcnZpbmcvdHJpZ2dlcmluZ1xuICAgICAgLy8gdW5jYXVnaHQgZXhjZXB0aW9ucyB3aXRoIGl0cyBvd24gbGlzdGVuZXIgb3ducyB0aGVtLlxuICAgICAgaWYgKHByb2Nlc3MubGlzdGVuZXJDb3VudChcInVuY2F1Z2h0RXhjZXB0aW9uXCIpID4gMSkgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVjb3JkQXN5bmNDcmFzaChcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIGVycm9yKVxuICAgIH1cblxuICAgIHByb2Nlc3Mub24oXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgb25VbmhhbmRsZWRSZWplY3Rpb24pXG4gICAgcHJvY2Vzcy5vbihcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIG9uVW5jYXVnaHRFeGNlcHRpb24pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5UZXN0cyh7XG4gICAgICAgIGFmdGVyRWFjaGVzOiBbXSxcbiAgICAgICAgYmVmb3JlRWFjaGVzOiBbXSxcbiAgICAgICAgdGVzdHMsXG4gICAgICAgIGRlc2NyaXB0aW9uczogW10sXG4gICAgICAgIGluZGVudExldmVsOiAwXG4gICAgICB9KVxuXG4gICAgICAvLyBBIHJlamVjdGlvbiBzY2hlZHVsZWQgYnkgdGhlIGZpbmFsIHRlc3QgKGEgZGV0YWNoZWQgcmVqZWN0ZWQgcHJvbWlzZSxcbiAgICAgIC8vIG9yIGFuIGFmdGVyQ29tbWl0IGNhbGxiYWNrIHJlamVjdGluZyBhcyB0aGUgc3VpdGUgZHJhaW5zKSBpcyByZXBvcnRlZFxuICAgICAgLy8gYnkgTm9kZSBvbiBhIExBVEVSIHR1cm4uIERyYWluIGEgZmV3IHR1cm5zIHdoaWxlIHRoZSBoYW5kbGVyIGlzIHN0aWxsXG4gICAgICAvLyBhdHRhY2hlZCBzbyB0aG9zZSBsYXRlIHJlamVjdGlvbnMgYXJlIHJlY29yZGVkIGluc3RlYWQgb2YgZXNjYXBpbmcgdG9cbiAgICAgIC8vIHRoZSBkZWZhdWx0IGNyYXNoIHBhdGggYWZ0ZXIgY2xlYW51cC5cbiAgICAgIGZvciAobGV0IGRyYWluVHVybiA9IDA7IGRyYWluVHVybiA8IDM7IGRyYWluVHVybisrKSB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRJbW1lZGlhdGUocmVzb2x2ZSkpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHByb2Nlc3Mub2ZmKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIG9uVW5oYW5kbGVkUmVqZWN0aW9uKVxuICAgICAgcHJvY2Vzcy5vZmYoXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBvblVuY2F1Z2h0RXhjZXB0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBhZnRlciBhbGxzIGZvciBhY3RpdmUgc2NvcGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgaG9va3MgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJBbGxzRm9yQWN0aXZlU2NvcGVzKCkge1xuICAgIGNvbnN0IHNjb3BlcyA9IFsuLi50aGlzLl9hY3RpdmVBZnRlckFsbFNjb3Blc10ucmV2ZXJzZSgpXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgYWZ0ZXJBbGxFcnJvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzY29wZSBvZiBzY29wZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuQWZ0ZXJBbGxzRm9yU2NvcGUoc2NvcGUpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBhZnRlckFsbEVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2FjdGl2ZUFmdGVyQWxsU2NvcGVzID0gW11cblxuICAgIGlmIChhZnRlckFsbEVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgYWZ0ZXJBbGxFcnJvcnNbMF1cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGFmdGVyQWxsRXJyb3JzLCBcIk11bHRpcGxlIGFjdGl2ZSBhZnRlckFsbCBzY29wZXMgZmFpbGVkXCIsIHtjYXVzZTogYWZ0ZXJBbGxFcnJvcnNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuYWx5emUgdGVzdHMuXG4gICAqIEBwYXJhbSB7VGVzdHNBcmd1bWVudH0gdGVzdHMgLSBUZXN0cy5cbiAgICogQHJldHVybnMge3thbnlUZXN0c0ZvY3Vzc2VkOiBib29sZWFufX0gLSBXaGV0aGVyIGFueSB0ZXN0cyBpbiB0aGUgdHJlZSBhcmUgZm9jdXNlZC5cbiAgICovXG4gIGFuYWx5emVUZXN0cyh0ZXN0cykge1xuICAgIGxldCBhbnlUZXN0c0ZvY3Vzc2VkRm91bmQgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCB0ZXN0RGVzY3JpcHRpb24gaW4gdGVzdHMudGVzdHMpIHtcbiAgICAgIGNvbnN0IHRlc3REYXRhID0gdGVzdHMudGVzdHNbdGVzdERlc2NyaXB0aW9uXVxuICAgICAgY29uc3QgdGVzdEFyZ3MgPSBPYmplY3QuYXNzaWduKHt9LCB0ZXN0RGF0YS5hcmdzKVxuXG4gICAgICB0aGlzLl90ZXN0c0NvdW50KytcblxuICAgICAgaWYgKHRlc3RBcmdzLmZvY3VzKSB7XG4gICAgICAgIGFueVRlc3RzRm9jdXNzZWRGb3VuZCA9IHRydWVcbiAgICAgICAgdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3ViRGVzY3JpcHRpb24gaW4gdGVzdHMuc3Vicykge1xuICAgICAgY29uc3Qgc3ViVGVzdCA9IHRlc3RzLnN1YnNbc3ViRGVzY3JpcHRpb25dXG4gICAgICBjb25zdCB7YW55VGVzdHNGb2N1c3NlZH0gPSB0aGlzLmFuYWx5emVUZXN0cyhzdWJUZXN0KVxuXG4gICAgICBpZiAoYW55VGVzdHNGb2N1c3NlZCkge1xuICAgICAgICBhbnlUZXN0c0ZvY3Vzc2VkRm91bmQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIHN1YlRlc3QuYW55VGVzdHNGb2N1c3NlZCA9IGFueVRlc3RzRm9jdXNzZWRcbiAgICB9XG5cbiAgICByZXR1cm4ge2FueVRlc3RzRm9jdXNzZWQ6IGFueVRlc3RzRm9jdXNzZWRGb3VuZH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZXJ5IGFmdGVyLWVhY2ggaG9vayB3aGlsZSBwcmVzZXJ2aW5nIHRoZSBmaXJzdCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEhvb2sgZXhlY3V0aW9uIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYXJncy5hZnRlckVhY2hlcyAtIEhvb2tzIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gYXJncy50ZXN0QXJncyAtIEN1cnJlbnQgdGVzdCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBDdXJyZW50IHRlc3QgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgaG9vayBydW5zLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJFYWNoZXMoe2FmdGVyRWFjaGVzLCB0ZXN0QXJncywgdGVzdERhdGF9KSB7XG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgYWZ0ZXJFYWNoRXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgYWZ0ZXJFYWNoRGF0YSBvZiBhZnRlckVhY2hlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5Qcm9maWxlU3Bhbih7XG4gICAgICAgICAgcGhhc2U6IFwiYWZ0ZXJFYWNoXCIsXG4gICAgICAgICAgZGVjbGFyYXRpb25JbmRleDogYWZ0ZXJFYWNoRGF0YS5kZWNsYXJhdGlvbkluZGV4LFxuICAgICAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogYWZ0ZXJFYWNoRGF0YS5kZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICAgICAgZmlsZVBhdGg6IGFmdGVyRWFjaERhdGEub3duZXJGaWxlUGF0aFxuICAgICAgICB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgYWZ0ZXJFYWNoRGF0YS5jYWxsYmFjayh7Y29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksIHRlc3RBcmdzLCB0ZXN0RGF0YX0pXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBhZnRlckVhY2hFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYWZ0ZXJFYWNoRXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBhZnRlckVhY2hFcnJvcnNbMF1cbiAgICBpZiAoYWZ0ZXJFYWNoRXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihhZnRlckVhY2hFcnJvcnMsIFwiTXVsdGlwbGUgYWZ0ZXJFYWNoIGhvb2tzIGZhaWxlZFwiLCB7Y2F1c2U6IGFmdGVyRWFjaEVycm9yc1swXX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHRlc3RzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge0FycmF5PEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZT59IGFyZ3MuYWZ0ZXJFYWNoZXMgLSBBZnRlciBlYWNoZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlPn0gYXJncy5iZWZvcmVFYWNoZXMgLSBCZWZvcmUgZWFjaGVzLlxuICAgKiBAcGFyYW0ge1Rlc3RzQXJndW1lbnR9IGFyZ3MudGVzdHMgLSBUZXN0cy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmluZGVudExldmVsIC0gSW5kZW50IGxldmVsLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmxpbmVNYXRjaGVkSW5TY29wZV0gLSBXaGV0aGVyIGxpbmUgbWF0Y2hlZCBpbiBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnBhcmVudFByb2ZpbGVTY29wZUlkXSAtIFBhcmVudCBwcm9maWxlIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuVGVzdHMoe2FmdGVyRWFjaGVzLCBiZWZvcmVFYWNoZXMsIHRlc3RzLCBkZXNjcmlwdGlvbnMsIGluZGVudExldmVsLCBsaW5lTWF0Y2hlZEluU2NvcGUgPSBmYWxzZSwgcGFyZW50UHJvZmlsZVNjb3BlSWR9KSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGVudmlyb25tZW50SGFuZGxlci5pbnN0YWxsU2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSh0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlKVxuICAgIGVudmlyb25tZW50SGFuZGxlci5pbnN0YWxsVGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSlcbiAgICBjb25zdCBsZWZ0UGFkZGluZyA9IFwiIFwiLnJlcGVhdChpbmRlbnRMZXZlbCAqIDIpXG4gICAgY29uc3Qgc2NvcGVPd25lckZpbGVQYXRoID0gdGVzdHMub3duZXJGaWxlUGF0aCA/PyB0ZXN0cy5maWxlUGF0aFxuICAgIGNvbnN0IHByb2ZpbGVTY29wZUlkID0gdGhpcy5fcHJvZmlsZXI/LnNjb3BlSWQodGVzdHMsIHtcbiAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgIGZpbGVQYXRoOiBzY29wZU93bmVyRmlsZVBhdGgsXG4gICAgICBsaW5lOiB0ZXN0cy5saW5lLFxuICAgICAgcGFyZW50SWQ6IHBhcmVudFByb2ZpbGVTY29wZUlkXG4gICAgfSlcbiAgICBjb25zdCBvd25BZnRlckVhY2hlcyA9IFsuLi50aGlzLnByb2ZpbGVIb29rRW50cmllcyh0ZXN0cy5hZnRlckVhY2hlcywgcHJvZmlsZVNjb3BlSWQsIHNjb3BlT3duZXJGaWxlUGF0aCldLnJldmVyc2UoKVxuICAgIGNvbnN0IG93bkJlZm9yZUVhY2hlcyA9IHRoaXMucHJvZmlsZUhvb2tFbnRyaWVzKHRlc3RzLmJlZm9yZUVhY2hlcywgcHJvZmlsZVNjb3BlSWQsIHNjb3BlT3duZXJGaWxlUGF0aClcbiAgICBjb25zdCBuZXdBZnRlckVhY2hlcyA9IFsuLi5vd25BZnRlckVhY2hlcywgLi4uYWZ0ZXJFYWNoZXNdXG4gICAgY29uc3QgbmV3QmVmb3JlRWFjaGVzID0gWy4uLmJlZm9yZUVhY2hlcywgLi4ub3duQmVmb3JlRWFjaGVzXVxuICAgIGNvbnN0IHNjb3BlTGluZU1hdGNoID0gbGluZU1hdGNoZWRJblNjb3BlIHx8IHRoaXMubWF0Y2hlc0xpbmVGaWx0ZXIodGVzdHMpXG4gICAgY29uc3Qgc2hvdWxkUnVuQW55VGVzdHMgPSB0aGlzLmhhc1J1bm5hYmxlVGVzdHModGVzdHMsIGRlc2NyaXB0aW9ucywgc2NvcGVMaW5lTWF0Y2gpXG5cbiAgICBpZiAoIXNob3VsZFJ1bkFueVRlc3RzKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7QWN0aXZlQWZ0ZXJBbGxTY29wZUVudHJ5fSAqL1xuICAgIGNvbnN0IHNjb3BlRW50cnkgPSB7dGVzdHMsIGFmdGVyQWxsc1J1bjogZmFsc2UsIHByb2ZpbGVTY29wZUlkfVxuICAgIHRoaXMuX2FjdGl2ZUFmdGVyQWxsU2NvcGVzLnB1c2goc2NvcGVFbnRyeSlcbiAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICBjb25zdCBzY29wZUVycm9ycyA9IFtdXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgYmVmb3JlQWxscyA9IHRoaXMucHJvZmlsZUhvb2tFbnRyaWVzKHRlc3RzLmJlZm9yZUFsbHMgfHwgW10sIHByb2ZpbGVTY29wZUlkLCBzY29wZU93bmVyRmlsZVBhdGgpXG5cbiAgICAgIGZvciAoY29uc3QgYmVmb3JlQWxsRGF0YSBvZiBiZWZvcmVBbGxzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuUHJvZmlsZVNwYW4oe1xuICAgICAgICAgIHBoYXNlOiBcImJlZm9yZUFsbFwiLFxuICAgICAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IGJlZm9yZUFsbERhdGEuZGVjbGFyYXRpb25JbmRleCxcbiAgICAgICAgICBkZWNsYXJhdGlvblNjb3BlSWQ6IGJlZm9yZUFsbERhdGEuZGVjbGFyYXRpb25TY29wZUlkLFxuICAgICAgICAgIGZpbGVQYXRoOiBiZWZvcmVBbGxEYXRhLm93bmVyRmlsZVBhdGhcbiAgICAgICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGJlZm9yZUFsbERhdGEuY2FsbGJhY2soe2NvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpfSlcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCB0ZXN0RGVzY3JpcHRpb24gaW4gdGVzdHMudGVzdHMpIHtcbiAgICAgICAgY29uc3QgdGVzdERhdGEgPSB0ZXN0cy50ZXN0c1t0ZXN0RGVzY3JpcHRpb25dXG4gICAgICAgIGNvbnN0IHRlc3RBcmdzID0gLyoqIEB0eXBlIHtUZXN0QXJnc30gKi8gKE9iamVjdC5hc3NpZ24oe30sIHRlc3REYXRhLmFyZ3MpKVxuICAgICAgICBjb25zdCBpbmNsdWRlQnlMaW5lID0gc2NvcGVMaW5lTWF0Y2ggfHwgdGhpcy5tYXRjaGVzTGluZUZpbHRlcih0ZXN0RGF0YSlcblxuICAgICAgICBpZiAodGhpcy5fb25seUZvY3Vzc2VkICYmICF0ZXN0QXJncy5mb2N1cykgY29udGludWVcbiAgICAgICAgaWYgKHRoaXMuc2hvdWxkU2tpcFRlc3QodGVzdEFyZ3MsIHRlc3REYXRhLCB0ZXN0RGVzY3JpcHRpb24sIGRlc2NyaXB0aW9ucywgaW5jbHVkZUJ5TGluZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgaWYgKHRlc3RBcmdzLnR5cGUgPT0gXCJtb2RlbFwiIHx8IHRlc3RBcmdzLnR5cGUgPT0gXCJyZXF1ZXN0XCIpIHtcbiAgICAgICAgICB0ZXN0QXJncy5hcHBsaWNhdGlvbiA9IGF3YWl0IHRoaXMuYXBwbGljYXRpb24oKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlc3RBcmdzLnR5cGUgPT0gXCJyZXF1ZXN0XCIpIHtcbiAgICAgICAgICB0ZXN0QXJncy5jbGllbnQgPSBhd2FpdCB0aGlzLnJlcXVlc3RDbGllbnQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmV0cnlDb3VudCA9IHR5cGVvZiB0ZXN0QXJncy5yZXRyeSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodGVzdEFyZ3MucmV0cnkpXG4gICAgICAgICAgPyBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHRlc3RBcmdzLnJldHJ5KSlcbiAgICAgICAgICA6IDBcbiAgICAgICAgY29uc3QgY29uZmlnVGltZW91dFNlY29uZHMgPSB0eXBlb2YgdGVzdENvbmZpZy5kZWZhdWx0VGltZW91dFNlY29uZHMgPT09IFwibnVtYmVyXCIgPyB0ZXN0Q29uZmlnLmRlZmF1bHRUaW1lb3V0U2Vjb25kcyA6IHVuZGVmaW5lZFxuICAgICAgICBjb25zdCB0aW1lb3V0U2Vjb25kcyA9IHR5cGVvZiB0ZXN0QXJncy50aW1lb3V0U2Vjb25kcyA9PT0gXCJudW1iZXJcIiA/IHRlc3RBcmdzLnRpbWVvdXRTZWNvbmRzIDogY29uZmlnVGltZW91dFNlY29uZHNcbiAgICAgICAgY29uc3QgdXNlVGltZW91dCA9IHR5cGVvZiB0aW1lb3V0U2Vjb25kcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodGltZW91dFNlY29uZHMpICYmIHRpbWVvdXRTZWNvbmRzID4gMFxuICAgICAgICBjb25zdCB0aW1lb3V0TXMgPSB1c2VUaW1lb3V0ID8gdGltZW91dFNlY29uZHMgKiAxMDAwIDogdW5kZWZpbmVkXG4gICAgICAgIGxldCByZXRyaWVzVXNlZCA9IDBcbiAgICAgICAgbGV0IGF0dGVtcHROdW1iZXIgPSAxXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBBdHRlbXB0IGNvbnNvbGUgb3V0cHV0cy5cbiAgICAgICAgICogQHR5cGUge0F0dGVtcHRDb25zb2xlT3V0cHV0W119ICovXG4gICAgICAgIGNvbnN0IGF0dGVtcHRDb25zb2xlT3V0cHV0cyA9IFtdXG5cbiAgICAgICAgY29uc29sZS5sb2coYCR7bGVmdFBhZGRpbmd9aXQgJHt0ZXN0RGVzY3JpcHRpb259YClcblxuICAgICAgICBjb25zdCB0ZXN0U3RhcnRNcyA9IERhdGUubm93KClcblxuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgIGxldCBzaG91bGRSZXRyeSA9IGZhbHNlXG4gICAgICAgICAgLyoqXG4gICAgICAgICAgICogRGVmaW5lcyBjYXVnaHRFcnJvci5cbiAgICAgICAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgICAgICAgbGV0IGNhdWdodEVycm9yXG4gICAgICAgICAgLyoqXG4gICAgICAgICAgICogRGVmaW5lcyBmYWlsZWRFcnJvci5cbiAgICAgICAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgICAgICAgbGV0IGZhaWxlZEVycm9yXG4gICAgICAgICAgLyoqXG4gICAgICAgICAgICogRGVmaW5lcyBsYXN0RXJyb3IuXG4gICAgICAgICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgICAgICAgIGxldCBsYXN0RXJyb3JcbiAgICAgICAgICBsZXQgd2lsbFJldHJ5ID0gZmFsc2VcbiAgICAgICAgICAvKipcbiAgICAgICAgICAgKiBUaGUgcGVyLXRlc3QgbGlmZWN5Y2xlIHByb21pc2UsIGhvaXN0ZWQgc28gdGhlIHRpbWVvdXQgYnJhbmNoIGNhblxuICAgICAgICAgICAqIHN0aWxsIHdhaXQgZm9yIGl0IHRvIHNldHRsZSBhZnRlciBydW5XaXRoVGltZW91dCBoYXMgYWJhbmRvbmVkIGl0LlxuICAgICAgICAgICAqIEB0eXBlIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi9cbiAgICAgICAgICBsZXQgdGVzdExpZmVjeWNsZVxuICAgICAgICAgIC8qKiBAdHlwZSB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gKi9cbiAgICAgICAgICBsZXQgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICAgICAgICBsZXQgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gZmFsc2VcbiAgICAgICAgICAvKiogQHR5cGUge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICAgIGxldCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvblxuICAgICAgICAgIC8qKiBAdHlwZSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gICAgICAgICAgbGV0IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb25cbiAgICAgICAgICAvKiogQHR5cGUge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25bXX0gKi9cbiAgICAgICAgICBjb25zdCB0cmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ucyA9IFtdXG4gICAgICAgICAgLyoqIEB0eXBlIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119ICovXG4gICAgICAgICAgY29uc3QgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgICAgICAgIGNvbnN0IHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlID0ge3Jldm9rZWQ6IGZhbHNlfVxuICAgICAgICAgIC8qKiBAdHlwZSB7U2V0PEVycm9yPn0gKi9cbiAgICAgICAgICBjb25zdCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzID0gbmV3IFNldCgpXG4gICAgICAgICAgdGVzdEFyZ3MucmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50ID0gYXN5bmMgKGFyZ3MpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50KGFyZ3MsIHRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25zKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBzdG9wQ29uc29sZUNhcHR1cmUgPSB0aGlzLnN0YXJ0Q29uc29sZUNhcHR1cmUoe1xuICAgICAgICAgICAgcGFzc3Rocm91Z2g6IHRlc3RDb25maWcuY29uc29sZU91dHB1dCA9PT0gXCJsaXZlXCJcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnN0IHByb2ZpbGVyID0gdGhpcy5fcHJvZmlsZXJcbiAgICAgICAgICBjb25zdCBwcm9maWxlQXR0ZW1wdCA9IHByb2ZpbGVyPy5zdGFydEF0dGVtcHQoe1xuICAgICAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgICAgICAgIHRlc3REYXRhLFxuICAgICAgICAgICAgdGVzdERlc2NyaXB0aW9uXG4gICAgICAgICAgfSlcbiAgICAgICAgICBsZXQgYXR0ZW1wdFRpbWVkT3V0ID0gZmFsc2VcblxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBSdW4gdGhlIHdob2xlIHBlci10ZXN0IGxpZmVjeWNsZSAoZHVtbXkvc2VydmVyIHN0YXJ0dXAsIGNvbm5lY3Rpb25cbiAgICAgICAgICAgIC8vIGFjcXVpc2l0aW9uLCBiZWZvcmVFYWNoIGhvb2tzLCB0aGUgdGVzdCBib2R5IGFuZCBhZnRlckVhY2ggaG9va3MpIGFzXG4gICAgICAgICAgICAvLyBvbmUgcHJvbWlzZSBzbyB0aGUgdGltZW91dCBiZWxvdyBjYW4gY292ZXIgYWxsIG9mIGl0LlxuICAgICAgICAgICAgY29uc3QgcnVuTGlmZWN5Y2xlQ2FsbGJhY2sgPSBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnJ1bldpdGhEdW1teUlmTmVlZGVkKHRlc3RBcmdzLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHVzZVRyYW5zYWN0aW9uID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJhbnNhY3Rpb24gPT09IHRydWVcbiAgICAgICAgICAgICAgY29uc3Qgc2hvdWxkVHJ1bmNhdGUgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZSA/PyAhdXNlVHJhbnNhY3Rpb25cbiAgICAgICAgICAgICAgY29uc3QgdXNlU2hhcmVkVGVzdENvbm5lY3Rpb25zID0gdXNlVHJhbnNhY3Rpb24gfHwgdGVzdEFyZ3MudHlwZSA9PSBcInJlcXVlc3RcIlxuICAgICAgICAgICAgICBjb25zdCB1c2VUZXN0Q29ubmVjdGlvbnMgPSB1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMgfHwgc2hvdWxkVHJ1bmNhdGVcbiAgICAgICAgICAgICAgY29uc3QgcnVuVGVzdEF0dGVtcHQgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gUmVnaXN0ZXIgZHluYW1pYyBjYW5kaWRhdGVzIGJlZm9yZSBob29rcyBzbyB0cmFuc2FjdGlvbiBzdGF0ZSBjaGFuZ2VzXG4gICAgICAgICAgICAgICAgLy8gbWFkZSBkdXJpbmcgYSBob29rIGFyZSBpbW1lZGlhdGVseSB2aXNpYmxlIHRvIGFueSBpbi1wcm9jZXNzIHdvcmsuXG4gICAgICAgICAgICAgICAgLy8gUHJlcGFyZSB0cmFuc2FjdGlvbiBzaGFyaW5nIGJlZm9yZSBob29rcyBzbyBsb25nLWxpdmVkIHNlcnZpY2VzIGNhbm5vdFxuICAgICAgICAgICAgICAgIC8vIHVzZSB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gd2hpbGUgaXRzIGNvb3JkaW5hdG9yIGlzIHN0aWxsIG1pc3NpbmcuXG4gICAgICAgICAgICAgICAgaWYgKHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gdGhpcy5hY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9ucygpXG4gICAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgICAgICAgICAgICAgIGNvbnN0IGxpZmVjeWNsZUVycm9ycyA9IFtdXG4gICAgICAgICAgICAgICAgbGV0IHJ1bkNsZWFudXBIb29rcyA9IGZhbHNlXG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgaWYgKHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uID0gYXdhaXQgdGhpcy5wcmVwYXJlU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoKVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgcnVuQ2xlYW51cEhvb2tzID0gdHJ1ZVxuXG4gICAgICAgICAgICAgICAgICBjbGVhckRlbGl2ZXJpZXMoKVxuICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBiZWZvcmVFYWNoRGF0YSBvZiBuZXdCZWZvcmVFYWNoZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5ydW5Qcm9maWxlU3Bhbih7XG4gICAgICAgICAgICAgICAgICAgICAgcGhhc2U6IFwiYmVmb3JlRWFjaFwiLFxuICAgICAgICAgICAgICAgICAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IGJlZm9yZUVhY2hEYXRhLmRlY2xhcmF0aW9uSW5kZXgsXG4gICAgICAgICAgICAgICAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBiZWZvcmVFYWNoRGF0YS5kZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGg6IGJlZm9yZUVhY2hEYXRhLm93bmVyRmlsZVBhdGhcbiAgICAgICAgICAgICAgICAgICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGJlZm9yZUVhY2hEYXRhLmNhbGxiYWNrKHtjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSwgdGVzdEFyZ3MsIHRlc3REYXRhfSlcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgaWYgKHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zID0gdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5OiB0cnVlfSlcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24gJiYgIXRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJNYXRjaGVzQ29ubmVjdGlvbnMoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiwgYWN0aXZlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucykpIHtcbiAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgICAgICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IGZhbHNlXG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiA9IGF3YWl0IHRoaXMuc3RhcnRTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uLCBhY3RpdmVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKVxuICAgICAgICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgICAgICAgIGlmIChzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiAmJiAhdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gdGhpcy5hY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9ucygpXG4gICAgICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgIC8vIFJlY29yZCB3aGljaCB0ZXN0IGlzIHJ1bm5pbmcgc28gYW4gYXN5bmMgY3Jhc2ggKGFuIHVuaGFuZGxlZFxuICAgICAgICAgICAgICAgICAgLy8gcmVqZWN0aW9uIGRldGFjaGVkIGZyb20gYW55IGF3YWl0KSB0aGF0IGZpcmVzIGR1cmluZyBvciBzaG9ydGx5XG4gICAgICAgICAgICAgICAgICAvLyBhZnRlciB0aGlzIHRlc3QgY2FuIGJlIGF0dHJpYnV0ZWQgdG8gaXQgaW4gcnVuKCkncyBoYW5kbGVyLlxuICAgICAgICAgICAgICAgICAgdGhpcy5fbGFzdFRlc3RDb250ZXh0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmdWxsRGVzY3JpcHRpb246IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pLFxuICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aDogdGVzdERhdGEuZmlsZVBhdGggPz8gXCI8dW5rbm93bj5cIixcbiAgICAgICAgICAgICAgICAgICAgbGluZTogdGVzdERhdGEubGluZSA/PyAwXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnJ1blByb2ZpbGVTcGFuKHtwaGFzZTogXCJ0ZXN0IGJvZHlcIiwgZmlsZVBhdGg6IHRlc3REYXRhLm93bmVyRmlsZVBhdGggPz8gdGVzdERhdGEuZmlsZVBhdGh9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRlc3REYXRhLmZ1bmN0aW9uKHRlc3RBcmdzKVxuICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKHJ1bkNsZWFudXBIb29rcykge1xuICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gRnJhbWV3b3JrLW93bmVkIHBvc3QtY29tbWl0IGJyb2FkY2FzdHMgYXJlIGludGVudGlvbmFsbHlcbiAgICAgICAgICAgICAgICAgICAgLy8gZGV0YWNoZWQ7IGRyYWluIHRoZW0gYmVmb3JlIHRlc3QgY2xlYW51cCBzbyB0aGVpciBEQlxuICAgICAgICAgICAgICAgICAgICAvLyBjaGVja291dHMgY2Fubm90IGxlYWsgaW50byB0aGUgbmV4dCB0ZXN0J3MgbGlmZWN5Y2xlLlxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyh0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICAgICAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfHwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbilcbiAgICAgICAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucnVuQWZ0ZXJFYWNoZXMoe2FmdGVyRWFjaGVzOiBuZXdBZnRlckVhY2hlcywgdGVzdEFyZ3MsIHRlc3REYXRhfSlcbiAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50cyh0cmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICh0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUpIHtcbiAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnModGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGxpZmVjeWNsZUVycm9yc1swXVxuICAgICAgICAgICAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGxpZmVjeWNsZUVycm9ycywgXCJUZXN0IGxpZmVjeWNsZSBhbmQgY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBsaWZlY3ljbGVFcnJvcnNbMF19KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGlmICh1c2VUZXN0Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAvLyBEYXRhYmFzZSBjbGVhbmluZyByZXF1aXJlcyBvbmUgY29ubmVjdGlvbiBmb3IgYmVmb3JlRWFjaCwgdGhlIHRlc3RcbiAgICAgICAgICAgICAgICAvLyBib2R5IGFuZCBhZnRlckVhY2g7IG9ubHkgdHJhbnNhY3Rpb25zIGFuZCByZXF1ZXN0cyBzaGFyZSBpdCBkeW5hbWljYWxseS5cbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogYFRlc3Q6ICR7dGVzdERlc2NyaXB0aW9ufWB9LCBydW5UZXN0QXR0ZW1wdClcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBhd2FpdCBydW5UZXN0QXR0ZW1wdCgpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgY29uc3QgbGlmZWN5Y2xlQ2FsbGJhY2sgPSBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5ydW5XaXRoVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUodGVzdERhdGFiYXNlQWNjZXNzU2NvcGUsIHJ1bkxpZmVjeWNsZUNhbGxiYWNrKVxuICAgICAgICAgICAgdGVzdExpZmVjeWNsZSA9IHByb2ZpbGVBdHRlbXB0ICYmIHByb2ZpbGVyXG4gICAgICAgICAgICAgID8gcHJvZmlsZXIucnVuQXR0ZW1wdChwcm9maWxlQXR0ZW1wdCwgbGlmZWN5Y2xlQ2FsbGJhY2spXG4gICAgICAgICAgICAgIDogbGlmZWN5Y2xlQ2FsbGJhY2soKVxuXG4gICAgICAgICAgICAvLyBUaW1lIG91dCB0aGUgRU5USVJFIGxpZmVjeWNsZSwgbm90IGp1c3QgdGhlIHRlc3QgYm9keS4gQSBoYW5nIGluIGFueVxuICAgICAgICAgICAgLy8gcGhhc2Ug4oCUIGEgY29ubmVjdGlvbiBjaGVja291dCB0aGF0IG5ldmVyIHJlc29sdmVzLCBhIGJlZm9yZUVhY2gvYWZ0ZXJFYWNoXG4gICAgICAgICAgICAvLyB3YWl0aW5nIG9uIGEgbG9jaywgb3IgZHVtbXkgc2VydmVyIHN0YXJ0dXAg4oCUIHdvdWxkIG90aGVyd2lzZSBzdGFsbCB0aGVcbiAgICAgICAgICAgIC8vIHdob2xlIHJ1biBpbmRlZmluaXRlbHkgKHVudGlsIENJIGtpbGxzIHRoZSBidWlsZCkgaW5zdGVhZCBvZiBmYWlsaW5nIHRoZVxuICAgICAgICAgICAgLy8gc2luZ2xlIG9mZmVuZGluZyB0ZXN0LlxuICAgICAgICAgICAgaWYgKHVzZVRpbWVvdXQgJiYgdGltZW91dE1zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgYXdhaXQgcnVuV2l0aFRpbWVvdXQodGVzdExpZmVjeWNsZSwgdGltZW91dE1zLCB0ZXN0RGVzY3JpcHRpb24pXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBhd2FpdCB0ZXN0TGlmZWN5Y2xlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEEgdGVzdCBpcyBzdWNjZXNzZnVsIG9ubHkgYWZ0ZXIgaXRzIGNvbXBsZXRlIGxpZmVjeWNsZSBzZXR0bGVzLlxuICAgICAgICAgICAgLy8gQ2xlYW51cCBmYWlsdXJlcyBhbmQgdGltZWQtb3V0IGRldGFjaGVkIHdvcmsgbXVzdCBub3Qgb3ZlcmxhcCB0aGVcbiAgICAgICAgICAgIC8vIGZpbmFsIHN1Y2Nlc3NmdWwgYW5kIGZhaWxlZCBjb3VudGVycyB1c2VkIGZvciBleGVjdXRlZC10ZXN0IHRvdGFscy5cbiAgICAgICAgICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cysrXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNhdWdodEVycm9yID0gZXJyb3JcbiAgICAgICAgICAgIGxhc3RFcnJvciA9IGVycm9yXG5cbiAgICAgICAgICAgIC8vIEEgdGltZW91dCBSRUpFQ1RTIHdoaWxlIHRoZSBsaWZlY3ljbGUga2VlcHMgcnVubmluZyBkZXRhY2hlZCBvbiB0aGVcbiAgICAgICAgICAgIC8vIHNoYXJlZCBwZXItc3VpdGUgY29ubmVjdGlvbiDigJQgaW5jbHVkaW5nIGl0cyBhZnRlckVhY2ggZGF0YWJhc2VcbiAgICAgICAgICAgIC8vIGNsZWFudXAgKGUuZy4gdHJhbnNhY3Rpb24gcm9sbGJhY2spLiBJZiB0aGUgbmV4dCB0ZXN0IHN0YXJ0cyBiZWZvcmVcbiAgICAgICAgICAgIC8vIHRoYXQgcm9sbGJhY2sgcnVucywgaXRzIG93biBzdGFydFRyYW5zYWN0aW9uKCkgaW1wbGljaXRseSBDT01NSVRTXG4gICAgICAgICAgICAvLyB0aGUgdGltZWQtb3V0IHRlc3QncyByb3dzIG9uIHRoZSBzaGFyZWQgY29ubmVjdGlvbiwgcG9pc29uaW5nIGV2ZXJ5XG4gICAgICAgICAgICAvLyBsYXRlciB0ZXN0IGluIHRoZSBzaGFyZCAoZHVwbGljYXRlLWtleSAvIGZvcmVpZ24ta2V5IGNhc2NhZGVzIGZyb21cbiAgICAgICAgICAgIC8vIGxlYWtlZCBmaXh0dXJlcykuIFdhaXQg4oCUIGJvdW5kZWQg4oCUIGZvciB0aGUgYWJhbmRvbmVkIGxpZmVjeWNsZSB0b1xuICAgICAgICAgICAgLy8gc2V0dGxlIHNvIGl0cyBjbGVhbnVwIGxhbmRzIGZpcnN0LiBJZiBpdCByZW1haW5zIGFjdGl2ZSBhZnRlciB0aGVcbiAgICAgICAgICAgIC8vIGJvdW5kZWQgZ3JhY2UsIHF1YXJhbnRpbmUgaXRzIGJyb3dzZXIgY29ubmVjdGlvbnMgYW5kIHN0b3AgcnVubmluZ1xuICAgICAgICAgICAgLy8gdGVzdHMgcmF0aGVyIHRoYW4gc2hhcmluZyB1bnNhZmUgc3RhdGUuXG4gICAgICAgICAgICBjb25zdCB0aW1lZE91dCA9IEJvb2xlYW4oLyoqIEB0eXBlIHtUZXN0VGltZW91dEVycm9yfSAqLyAoZXJyb3IpPy52ZWxvY2lvdXNUZXN0VGltZW91dClcbiAgICAgICAgICAgIGF0dGVtcHRUaW1lZE91dCA9IHRpbWVkT3V0XG5cbiAgICAgICAgICAgIGlmICh0aW1lZE91dCAmJiB0ZXN0TGlmZWN5Y2xlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGVtZXJnZW5jeUNsZWFudXBFcnJvcnMgPSBbXVxuXG4gICAgICAgICAgICAgIGlmIChwcm9maWxlQXR0ZW1wdCAmJiBwcm9maWxlcikgcHJvZmlsZXIuZmluaXNoQXR0ZW1wdChwcm9maWxlQXR0ZW1wdCwgXCJ0aW1lZC1vdXRcIilcbiAgICAgICAgICAgICAgY29uc3QgbGlmZWN5Y2xlT3V0Y29tZSA9IGF3YWl0IGF3YWl0U2V0dGxlZE9yR3JhY2UodGVzdExpZmVjeWNsZSwgdGltZW91dE1zID8/IDYwMDAwKVxuXG4gICAgICAgICAgICAgIGlmIChsaWZlY3ljbGVPdXRjb21lLnNldHRsZWQgJiYgbGlmZWN5Y2xlT3V0Y29tZS5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChsaWZlY3ljbGVPdXRjb21lLnJlYXNvbilcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIElmIHRoZSBhYmFuZG9uZWQgbGlmZWN5Y2xlIG5ldmVyIHNldHRsZWQgd2l0aGluIHRoZSBncmFjZSwgaXRzXG4gICAgICAgICAgICAgIC8vIGNsZWFudXAgaGFzIG5vdCBjb21wbGV0ZWQuIFF1YXJhbnRpbmUgYnJvd3Nlci1vd25lZCBjb25uZWN0aW9uc1xuICAgICAgICAgICAgICAvLyBiZWZvcmUgYW55IHNjb3BlIGNsZWFudXAgY2FuIHJhY2UgdGhlIGFiYW5kb25lZCBjYWxsYmFjay5cbiAgICAgICAgICAgICAgaWYgKCFsaWZlY3ljbGVPdXRjb21lLnNldHRsZWQpIHtcbiAgICAgICAgICAgICAgICB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZS5yZXZva2VkID0gdHJ1ZVxuICAgICAgICAgICAgICAgIHZvaWQgdGVzdExpZmVjeWNsZS5jYXRjaCgoY2xlYW51cEVycm9yKSA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoaXNUZXN0RGF0YWJhc2VBY2Nlc3NSZXZvY2F0aW9uKGNsZWFudXBFcnJvcikpIHJldHVyblxuICAgICAgICAgICAgICAgICAgdGhpcy5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoY2xlYW51cEVycm9yLCBcInRlc3QgbGlmZWN5Y2xlXCIsIHJlY29yZGVkVGltZW91dENsZWFudXBFcnJvcnMpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICBjb25zdCBxdWFyYW50aW5lID0gdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbnMoYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICAgICAgY29uc3QgcXVhcmFudGluZU91dGNvbWUgPSBhd2FpdCBhd2FpdFNldHRsZWRPckdyYWNlKHF1YXJhbnRpbmUsIHRpbWVvdXRNcyA/PyA2MDAwMClcbiAgICAgICAgICAgICAgICBjb25zdCB1c2VzQnJvd3NlclRyYW5zYWN0aW9ucyA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRyYW5zYWN0aW9uID09PSB0cnVlXG4gICAgICAgICAgICAgICAgY29uc3QgdXNlc0Jyb3dzZXJUcnVuY2F0aW9uID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJ1bmNhdGUgPz8gIXVzZXNCcm93c2VyVHJhbnNhY3Rpb25zXG5cbiAgICAgICAgICAgICAgICB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gdGhpcy5pc0Jyb3dzZXJUZXN0TW9kZSgpXG4gICAgICAgICAgICAgICAgICAmJiB0aGlzLmhhc1RhZyh0ZXN0QXJncywgXCJkdW1teVwiKVxuICAgICAgICAgICAgICAgICAgJiYgKHVzZXNCcm93c2VyVHJhbnNhY3Rpb25zIHx8IHVzZXNCcm93c2VyVHJ1bmNhdGlvbilcblxuICAgICAgICAgICAgICAgIGlmIChxdWFyYW50aW5lT3V0Y29tZS5zZXR0bGVkICYmIHF1YXJhbnRpbmVPdXRjb21lLnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKSB7XG4gICAgICAgICAgICAgICAgICBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLnB1c2gocXVhcmFudGluZU91dGNvbWUucmVhc29uKVxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoIXF1YXJhbnRpbmVPdXRjb21lLnNldHRsZWQpIHtcbiAgICAgICAgICAgICAgICAgIHZvaWQgcXVhcmFudGluZS5jYXRjaCgoY2xlYW51cEVycm9yKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGNsZWFudXBFcnJvciwgXCJicm93c2VyIGR1bW15IGNvbm5lY3Rpb24gcXVhcmFudGluZVwiLCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzKVxuICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGlmICh0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnModGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IGZhbHNlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgICAgICAgICBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLnB1c2goY2xlYW51cEVycm9yKVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgYnJva2VyQ2xlYW51cCA9IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHx8IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24pXG4gICAgICAgICAgICAgIGNvbnN0IGJyb2tlckNsZWFudXBPdXRjb21lID0gYXdhaXQgYXdhaXRTZXR0bGVkT3JHcmFjZShicm9rZXJDbGVhbnVwLCB0aW1lb3V0TXMgPz8gNjAwMDApXG5cbiAgICAgICAgICAgICAgaWYgKGJyb2tlckNsZWFudXBPdXRjb21lLnNldHRsZWQgJiYgYnJva2VyQ2xlYW51cE91dGNvbWUuc3RhdHVzID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICAgICAgICBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLnB1c2goYnJva2VyQ2xlYW51cE91dGNvbWUucmVhc29uKVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKCFicm9rZXJDbGVhbnVwT3V0Y29tZS5zZXR0bGVkKSB7XG4gICAgICAgICAgICAgICAgdm9pZCBicm9rZXJDbGVhbnVwLmNhdGNoKChjbGVhbnVwRXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgICAgIHRoaXMucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGNsZWFudXBFcnJvciwgXCJzaGFyZWQgdHJhbnNhY3Rpb24gYnJva2VyXCIsIHJlY29yZGVkVGltZW91dENsZWFudXBFcnJvcnMpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgIGNvbnN0IGVtZXJnZW5jeUNsZWFudXAgPSB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50cyh0cmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ucywge2Rpc2NhcmQ6IHRydWV9KVxuICAgICAgICAgICAgICBjb25zdCBlbWVyZ2VuY3lDbGVhbnVwT3V0Y29tZSA9IGF3YWl0IGF3YWl0U2V0dGxlZE9yR3JhY2UoZW1lcmdlbmN5Q2xlYW51cCwgdGltZW91dE1zID8/IDYwMDAwKVxuXG4gICAgICAgICAgICAgIGlmIChlbWVyZ2VuY3lDbGVhbnVwT3V0Y29tZS5zZXR0bGVkICYmIGVtZXJnZW5jeUNsZWFudXBPdXRjb21lLnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKSB7XG4gICAgICAgICAgICAgICAgZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5wdXNoKGVtZXJnZW5jeUNsZWFudXBPdXRjb21lLnJlYXNvbilcbiAgICAgICAgICAgICAgfSBlbHNlIGlmICghZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUuc2V0dGxlZCkge1xuICAgICAgICAgICAgICAgIC8vIFRoZSB0aW1lZC1vdXQgYXR0ZW1wdCBtdXN0IG5vdCBibG9jayB0aGUgcnVubmVyIGluZGVmaW5pdGVseSwgYnV0IGFcbiAgICAgICAgICAgICAgICAvLyBsYXRlciByb2xsYmFjay9kaXNjYXJkIGZhaWx1cmUgc3RpbGwgYmVjb21lcyBhIHZpc2libGUgdGVzdCBmYWlsdXJlLlxuICAgICAgICAgICAgICAgIHZvaWQgZW1lcmdlbmN5Q2xlYW51cC5jYXRjaCgoY2xlYW51cEVycm9yKSA9PiB7XG4gICAgICAgICAgICAgICAgICB0aGlzLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShjbGVhbnVwRXJyb3IsIFwidHJhbnNhY3Rpb25hbCB0ZW5hbnRcIiwgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgaWYgKGVtZXJnZW5jeUNsZWFudXBFcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIGNhdWdodEVycm9yID0gbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgICAgICAgW2NhdWdodEVycm9yLCAuLi5lbWVyZ2VuY3lDbGVhbnVwRXJyb3JzXSxcbiAgICAgICAgICAgICAgICAgIFwiVGVzdCB0aW1lb3V0IGFuZCBlbWVyZ2VuY3kgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgICAgICAgIHtjYXVzZTogY2F1Z2h0RXJyb3J9XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIGxhc3RFcnJvciA9IGNhdWdodEVycm9yXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zLnNvbWUoKHJlZ2lzdHJhdGlvbikgPT4gcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkKSkge1xuICAgICAgICAgICAgICB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZS5yZXZva2VkID0gdHJ1ZVxuICAgICAgICAgICAgICB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gdHJ1ZVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB3aWxsUmV0cnkgPSAhdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyAmJiByZXRyaWVzVXNlZCA8IHJldHJ5Q291bnRcblxuICAgICAgICAgICAgaWYgKHdpbGxSZXRyeSkge1xuICAgICAgICAgICAgICByZXRyaWVzVXNlZCsrXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh3aWxsUmV0cnkpIHtcbiAgICAgICAgICAgICAgc2hvdWxkUmV0cnkgPSB0cnVlXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBmYWlsZWRFcnJvciA9IGNhdWdodEVycm9yXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLnJldm9rZWQgPSB0cnVlXG4gICAgICAgICAgICBjb25zdCBjb25zb2xlT3V0cHV0ID0gc3RvcENvbnNvbGVDYXB0dXJlKClcblxuICAgICAgICAgICAgaWYgKHByb2ZpbGVBdHRlbXB0ICYmIHByb2ZpbGVyKSB7XG4gICAgICAgICAgICAgIHByb2ZpbGVyLmZpbmlzaEF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGNhdWdodEVycm9yID09PSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgICA/IFwicGFzc2VkXCJcbiAgICAgICAgICAgICAgICA6IChhdHRlbXB0VGltZWRPdXQgPyBcInRpbWVkLW91dFwiIDogXCJmYWlsZWRcIikpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjb25zb2xlT3V0cHV0KSB7XG4gICAgICAgICAgICAgIGF0dGVtcHRDb25zb2xlT3V0cHV0cy5wdXNoKHthdHRlbXB0TnVtYmVyLCBvdXRwdXQ6IGNvbnNvbGVPdXRwdXR9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChjYXVnaHRFcnJvciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RBdHRlbXB0RmFpbGVkXCIsIHtcbiAgICAgICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgICAgICAgZXJyb3I6IGNhdWdodEVycm9yLFxuICAgICAgICAgICAgICBhdHRlbXB0TnVtYmVyLFxuICAgICAgICAgICAgICBuZXh0QXR0ZW1wdDogd2lsbFJldHJ5ID8gYXR0ZW1wdE51bWJlciArIDEgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHJldHJpZXNVc2VkLFxuICAgICAgICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICAgICAgICB0ZXN0QXJncyxcbiAgICAgICAgICAgICAgdGVzdERhdGEsXG4gICAgICAgICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgdGVzdFJ1bm5lcjogdGhpcyxcbiAgICAgICAgICAgICAgd2lsbFJldHJ5XG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgUmV0cnlpbmcgKCR7cmV0cmllc1VzZWR9LyR7cmV0cnlDb3VudH0pIGFmdGVyIGVycm9yOiAke2xhc3RFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gbGFzdEVycm9yLm1lc3NhZ2UgOiBTdHJpbmcobGFzdEVycm9yKX1gKSlcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdFJldHJ5aW5nXCIsIHtcbiAgICAgICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgICAgICAgZXJyb3I6IGxhc3RFcnJvcixcbiAgICAgICAgICAgICAgbmV4dEF0dGVtcHQ6IGF0dGVtcHROdW1iZXIgKyAxLFxuICAgICAgICAgICAgICByZXRyaWVzVXNlZCxcbiAgICAgICAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgICAgICAgdGVzdEFyZ3MsXG4gICAgICAgICAgICAgIHRlc3REYXRhLFxuICAgICAgICAgICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICAgICAgICAgIHRlc3RSdW5uZXI6IHRoaXNcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGF0dGVtcHROdW1iZXIgPiAxKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RSZXRyaWVkXCIsIHtcbiAgICAgICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgICAgICAgZXJyb3I6IGxhc3RFcnJvcixcbiAgICAgICAgICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgICAgICAgICAgcmV0cmllc1VzZWQsXG4gICAgICAgICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgICAgICAgIHRlc3RBcmdzLFxuICAgICAgICAgICAgICB0ZXN0RGF0YSxcbiAgICAgICAgICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgICAgICAgICB0ZXN0UnVubmVyOiB0aGlzXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF0dGVtcHROdW1iZXIrK1xuXG4gICAgICAgICAgaWYgKHNob3VsZFJldHJ5KSBjb250aW51ZVxuXG4gICAgICAgICAgaWYgKGZhaWxlZEVycm9yKSB7XG4gICAgICAgICAgICBjb25zdCBjb25zb2xlT3V0cHV0ID0gdGhpcy5idWlsZENvbnNvbGVPdXRwdXQoYXR0ZW1wdENvbnNvbGVPdXRwdXRzKVxuXG4gICAgICAgICAgICBpZiAoZmFpbGVkRXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgVGVzdCBmYWlsZWQ6ICR7ZmFpbGVkRXJyb3IubWVzc2FnZX1gKSlcbiAgICAgICAgICAgICAgYWRkVHJhY2tlZFN0YWNrVG9FcnJvcihmYWlsZWRFcnJvcilcblxuICAgICAgICAgICAgICBjb25zdCBiYWNrdHJhY2VDbGVhbmVyID0gbmV3IEJhY2t0cmFjZUNsZWFuZXIoZmFpbGVkRXJyb3IpXG4gICAgICAgICAgICAgIGNvbnN0IGNsZWFuZWRTdGFjayA9IGJhY2t0cmFjZUNsZWFuZXIuZ2V0Q2xlYW5lZFN0YWNrKClcbiAgICAgICAgICAgICAgY29uc3Qgc3RhY2tMaW5lcyA9IGNsZWFuZWRTdGFjaz8uc3BsaXQoXCJcXG5cIilcblxuICAgICAgICAgICAgICBpZiAoc3RhY2tMaW5lcykge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3Qgc3RhY2tMaW5lIG9mIHN0YWNrTGluZXMpIHtcbiAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICAke3N0YWNrTGluZX1gKSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICBUZXN0IGZhaWxlZCB3aXRoIGEgJHt0eXBlb2YgZmFpbGVkRXJyb3J9OiAke1N0cmluZyhmYWlsZWRFcnJvcil9YCkpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMucHJpbnRGYWlsZWRDb25zb2xlT3V0cHV0KHtjb25zb2xlT3V0cHV0LCBsZWZ0UGFkZGluZ30pXG4gICAgICAgICAgICB0aGlzLl9mYWlsZWRUZXN0cysrXG4gICAgICAgICAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgICAgICAgICAgZnVsbERlc2NyaXB0aW9uOiB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSxcbiAgICAgICAgICAgICAgZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoLFxuICAgICAgICAgICAgICBsaW5lOiB0ZXN0RGF0YS5saW5lLFxuICAgICAgICAgICAgICBlcnJvcjogZmFpbGVkRXJyb3IsXG4gICAgICAgICAgICAgIGNvbnNvbGVPdXRwdXQ6IGNvbnNvbGVPdXRwdXQgfHwgdW5kZWZpbmVkXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RGYWlsZWRcIiwge1xuICAgICAgICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICAgICAgICBlcnJvcjogZmFpbGVkRXJyb3IsXG4gICAgICAgICAgICAgIHRlc3RBcmdzLFxuICAgICAgICAgICAgICB0ZXN0RGF0YSxcbiAgICAgICAgICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgICAgICAgICB0ZXN0UnVubmVyOiB0aGlzXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB0aGlzLnByaW50UmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGEsIGxlZnRQYWRkaW5nfSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fdGVzdER1cmF0aW9ucy5wdXNoKHtcbiAgICAgICAgICBmdWxsRGVzY3JpcHRpb246IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pLFxuICAgICAgICAgIGZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCA/PyBcIjx1bmtub3duPlwiLFxuICAgICAgICAgIGxpbmU6IHRlc3REYXRhLmxpbmUgPz8gMCxcbiAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gdGVzdFN0YXJ0TXNcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAodGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cykgYnJlYWtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBzdWJEZXNjcmlwdGlvbiBpbiB0ZXN0cy5zdWJzKSB7XG4gICAgICAgIGlmICh0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzKSBicmVha1xuXG4gICAgICAgIGNvbnN0IHN1YlRlc3QgPSB0ZXN0cy5zdWJzW3N1YkRlc2NyaXB0aW9uXVxuICAgICAgICBjb25zdCBuZXdEZWNyaXB0aW9ucyA9IGRlc2NyaXB0aW9ucy5jb25jYXQoW3N1YkRlc2NyaXB0aW9uXSlcbiAgICAgICAgY29uc3QgY2hpbGRTY29wZUxpbmVNYXRjaCA9IHNjb3BlTGluZU1hdGNoIHx8IHRoaXMubWF0Y2hlc0xpbmVGaWx0ZXIoc3ViVGVzdClcblxuICAgICAgICBpZiAoIXRoaXMuX29ubHlGb2N1c3NlZCB8fCBzdWJUZXN0LmFueVRlc3RzRm9jdXNzZWQpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgJHtsZWZ0UGFkZGluZ30ke3N1YkRlc2NyaXB0aW9ufWApXG4gICAgICAgICAgYXdhaXQgdGhpcy5ydW5UZXN0cyh7XG4gICAgICAgICAgICBhZnRlckVhY2hlczogbmV3QWZ0ZXJFYWNoZXMsXG4gICAgICAgICAgICBiZWZvcmVFYWNoZXM6IG5ld0JlZm9yZUVhY2hlcyxcbiAgICAgICAgICAgIHRlc3RzOiBzdWJUZXN0LFxuICAgICAgICAgICAgZGVzY3JpcHRpb25zOiBuZXdEZWNyaXB0aW9ucyxcbiAgICAgICAgICAgIGluZGVudExldmVsOiBpbmRlbnRMZXZlbCArIDEsXG4gICAgICAgICAgICBsaW5lTWF0Y2hlZEluU2NvcGU6IGNoaWxkU2NvcGVMaW5lTWF0Y2gsXG4gICAgICAgICAgICBwYXJlbnRQcm9maWxlU2NvcGVJZDogcHJvZmlsZVNjb3BlSWRcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHNjb3BlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQWZ0ZXJBbGxzRm9yU2NvcGUoc2NvcGVFbnRyeSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgc2NvcGVFcnJvcnMucHVzaChlcnJvcilcbiAgICB9XG4gICAgY29uc3Qgc2NvcGVJbmRleCA9IHRoaXMuX2FjdGl2ZUFmdGVyQWxsU2NvcGVzLmluZGV4T2Yoc2NvcGVFbnRyeSlcblxuICAgIGlmIChzY29wZUluZGV4ID49IDApIHtcbiAgICAgIHRoaXMuX2FjdGl2ZUFmdGVyQWxsU2NvcGVzLnNwbGljZShzY29wZUluZGV4LCAxKVxuICAgIH1cblxuICAgIGlmIChzY29wZUVycm9ycy5sZW5ndGggPiAwICYmIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gc2NvcGVFcnJvcnMubGVuZ3RoID09IDFcbiAgICAgICAgPyBzY29wZUVycm9yc1swXVxuICAgICAgICA6IG5ldyBBZ2dyZWdhdGVFcnJvcihzY29wZUVycm9ycywgXCJUZXN0IHNjb3BlIGFuZCBhZnRlckFsbCBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IHNjb3BlRXJyb3JzWzBdfSlcblxuICAgICAgdGhpcy5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoZXJyb3IsIFwiYWZ0ZXJBbGxcIilcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoc2NvcGVFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IHNjb3BlRXJyb3JzWzBdXG4gICAgaWYgKHNjb3BlRXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihzY29wZUVycm9ycywgXCJUZXN0IHNjb3BlIGFuZCBhZnRlckFsbCBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IHNjb3BlRXJyb3JzWzBdfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBhZnRlciBhbGxzIGZvciBzY29wZS5cbiAgICogQHBhcmFtIHtBY3RpdmVBZnRlckFsbFNjb3BlRW50cnl9IHNjb3BlRW50cnkgLSBTY29wZSBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzY29wZSBjbGVhbnVwIGZpbmlzaGVzLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJBbGxzRm9yU2NvcGUoc2NvcGVFbnRyeSkge1xuICAgIGlmIChzY29wZUVudHJ5LmFmdGVyQWxsc1J1bikgcmV0dXJuXG5cbiAgICBzY29wZUVudHJ5LmFmdGVyQWxsc1J1biA9IHRydWVcblxuICAgIGNvbnN0IHNjb3BlT3duZXJGaWxlUGF0aCA9IHNjb3BlRW50cnkudGVzdHMub3duZXJGaWxlUGF0aCA/PyBzY29wZUVudHJ5LnRlc3RzLmZpbGVQYXRoXG4gICAgY29uc3QgYWZ0ZXJBbGxzID0gWy4uLnRoaXMucHJvZmlsZUhvb2tFbnRyaWVzKFxuICAgICAgc2NvcGVFbnRyeS50ZXN0cy5hZnRlckFsbHMgfHwgW10sXG4gICAgICBzY29wZUVudHJ5LnByb2ZpbGVTY29wZUlkLFxuICAgICAgc2NvcGVPd25lckZpbGVQYXRoXG4gICAgKV0ucmV2ZXJzZSgpXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgYWZ0ZXJBbGxFcnJvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBhZnRlckFsbERhdGEgb2YgYWZ0ZXJBbGxzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1blByb2ZpbGVTcGFuKHtcbiAgICAgICAgICBwaGFzZTogXCJhZnRlckFsbFwiLFxuICAgICAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IGFmdGVyQWxsRGF0YS5kZWNsYXJhdGlvbkluZGV4LFxuICAgICAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogYWZ0ZXJBbGxEYXRhLmRlY2xhcmF0aW9uU2NvcGVJZCxcbiAgICAgICAgICBmaWxlUGF0aDogYWZ0ZXJBbGxEYXRhLm93bmVyRmlsZVBhdGhcbiAgICAgICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGFmdGVyQWxsRGF0YS5jYWxsYmFjayh7Y29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCl9KVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgYWZ0ZXJBbGxFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGFmdGVyQWxsRXJyb3JzWzBdXG4gICAgaWYgKGFmdGVyQWxsRXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihhZnRlckFsbEVycm9ycywgXCJNdWx0aXBsZSBhZnRlckFsbCBob29rcyBmYWlsZWRcIiwge2NhdXNlOiBhZnRlckFsbEVycm9yc1swXX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW1pdCBldmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgbGlzdGVuZXJzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGF5bG9hZCkge1xuICAgIGNvbnN0IGxpc3RlbmVycyA9IHRlc3RFdmVudHMubGlzdGVuZXJzKGV2ZW50TmFtZSlcblxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgbGlzdGVuZXJzKSB7XG4gICAgICBhd2FpdCBsaXN0ZW5lcihwYXlsb2FkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW50IHJlcnVuIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxlZnRQYWRkaW5nIC0gTGVmdCBwYWRkaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwcmludFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhLCBsZWZ0UGFkZGluZ30pIHtcbiAgICBjb25zdCByZXJ1biA9IHRoaXMuYnVpbGRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YX0pXG5cbiAgICBpZiAocmVydW4pIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYCR7bGVmdFBhZGRpbmd9ICBSZS1ydW46ICR7cmVydW59YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCByZXJ1biBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCBkYXRhLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFJlcnVuIGNvbW1hbmQuXG4gICAqL1xuICBidWlsZFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhfSkge1xuICAgIGNvbnN0IGJhc2VDb21tYW5kID0gXCJucHggdmVsb2Npb3VzIHRlc3RcIlxuICAgIGNvbnN0IGZpbGVQYXRoID0gdGVzdERhdGEuZmlsZVBhdGhcbiAgICBjb25zdCBsaW5lID0gdGVzdERhdGEubGluZVxuXG4gICAgaWYgKGZpbGVQYXRoICYmIGxpbmUpIHtcbiAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHBhdGgucmVsYXRpdmUocHJvY2Vzcy5jd2QoKSwgZmlsZVBhdGgpXG4gICAgICByZXR1cm4gYCR7YmFzZUNvbW1hbmR9ICR7cmVsYXRpdmVQYXRofToke2xpbmV9YFxuICAgIH1cblxuICAgIGNvbnN0IGZ1bGxEZXNjcmlwdGlvbiA9IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pXG5cbiAgICBpZiAoZnVsbERlc2NyaXB0aW9uKSB7XG4gICAgICByZXR1cm4gYCR7YmFzZUNvbW1hbmR9IC0tZXhhbXBsZSAke0pTT04uc3RyaW5naWZ5KGZ1bGxEZXNjcmlwdGlvbil9YFxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIGNvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge0F0dGVtcHRDb25zb2xlT3V0cHV0W119IGF0dGVtcHRDb25zb2xlT3V0cHV0cyAtIEF0dGVtcHQgb3V0cHV0IGVudHJpZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ29tYmluZWQgY29uc29sZSBvdXRwdXQuXG4gICAqL1xuICBidWlsZENvbnNvbGVPdXRwdXQoYXR0ZW1wdENvbnNvbGVPdXRwdXRzKSB7XG4gICAgaWYgKGF0dGVtcHRDb25zb2xlT3V0cHV0cy5sZW5ndGggPT09IDApIHJldHVybiBcIlwiXG4gICAgaWYgKGF0dGVtcHRDb25zb2xlT3V0cHV0cy5sZW5ndGggPT09IDEpIHJldHVybiBhdHRlbXB0Q29uc29sZU91dHB1dHNbMF0ub3V0cHV0XG5cbiAgICByZXR1cm4gYXR0ZW1wdENvbnNvbGVPdXRwdXRzLm1hcCgoYXR0ZW1wdENvbnNvbGVPdXRwdXQpID0+IHtcbiAgICAgIHJldHVybiBgLS0tIEF0dGVtcHQgJHthdHRlbXB0Q29uc29sZU91dHB1dC5hdHRlbXB0TnVtYmVyfSAtLS1cXG4ke2F0dGVtcHRDb25zb2xlT3V0cHV0Lm91dHB1dH1gXG4gICAgfSkuam9pbihcIlxcblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZhaWxlZCBjb25zb2xlIG91dHB1dCBtYXggbGluZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTWF4aW11bSBmYWlsZWQgY29uc29sZSBsaW5lcy5cbiAgICovXG4gIGdldEZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcygpIHtcbiAgICBjb25zdCBtYXhMaW5lcyA9IHRlc3RDb25maWcuZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzXG5cbiAgICBpZiAodHlwZW9mIG1heExpbmVzICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUobWF4TGluZXMpKSByZXR1cm4gMjAwXG5cbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihtYXhMaW5lcykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnVuY2F0ZSBmYWlsZWQgY29uc29sZSBvdXRwdXQgbGluZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25zb2xlT3V0cHV0IC0gQ29uc29sZSBvdXRwdXQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBMaW5lcyBmb3IgaW5saW5lIG91dHB1dC5cbiAgICovXG4gIHRydW5jYXRlRmFpbGVkQ29uc29sZU91dHB1dExpbmVzKGNvbnNvbGVPdXRwdXQpIHtcbiAgICBjb25zdCBsaW5lcyA9IGNvbnNvbGVPdXRwdXQuc3BsaXQoXCJcXG5cIilcbiAgICBjb25zdCBtYXhMaW5lcyA9IHRoaXMuZ2V0RmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzKClcblxuICAgIGlmIChtYXhMaW5lcyA9PT0gMCkgcmV0dXJuIFtdXG4gICAgaWYgKGxpbmVzLmxlbmd0aCA8PSBtYXhMaW5lcykgcmV0dXJuIGxpbmVzXG5cbiAgICBjb25zdCBvbWl0dGVkTGluZXMgPSBsaW5lcy5sZW5ndGggLSBtYXhMaW5lc1xuICAgIGNvbnN0IHBsdXJhbCA9IG9taXR0ZWRMaW5lcyA9PT0gMSA/IFwiXCIgOiBcInNcIlxuXG4gICAgcmV0dXJuIFtcbiAgICAgIGAuLi4gJHtvbWl0dGVkTGluZXN9IGNvbnNvbGUgb3V0cHV0IGxpbmUke3BsdXJhbH0gb21pdHRlZCAuLi5gLFxuICAgICAgLi4ubGluZXMuc2xpY2UoLW1heExpbmVzKVxuICAgIF1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW50IGZhaWxlZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29uc29sZU91dHB1dCAtIENvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIExlZnQgcGFkZGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHJpbnRGYWlsZWRDb25zb2xlT3V0cHV0KHtjb25zb2xlT3V0cHV0LCBsZWZ0UGFkZGluZ30pIHtcbiAgICBpZiAodGVzdENvbmZpZy5jb25zb2xlT3V0cHV0ICE9PSBcImZhaWx1cmVcIikgcmV0dXJuXG4gICAgaWYgKCFjb25zb2xlT3V0cHV0KSByZXR1cm5cblxuICAgIGNvbnN0IGxpbmVzID0gdGhpcy50cnVuY2F0ZUZhaWxlZENvbnNvbGVPdXRwdXRMaW5lcyhjb25zb2xlT3V0cHV0KVxuXG4gICAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgQ29uc29sZSBvdXRwdXQ6YCkpXG5cbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICAgICR7bGluZX1gKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBjb25zb2xlIGNhcHR1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5wYXNzdGhyb3VnaF0gLSBXaGV0aGVyIHRvIHBhc3MgdGhyb3VnaCB0byB0aGUgb3JpZ2luYWwgY29uc29sZS5cbiAgICogQHJldHVybnMgeygpID0+IHN0cmluZ30gLSBTdG9wcyB0aGUgY2FwdHVyZSBhbmQgcmV0dXJucyBjYXB0dXJlZCB0ZXh0LlxuICAgKi9cbiAgc3RhcnRDb25zb2xlQ2FwdHVyZSh7cGFzc3Rocm91Z2ggPSBmYWxzZX0gPSB7fSkge1xuICAgIC8qKlxuICAgICAqIExpbmVzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBsaW5lcyA9IFtdXG4gICAgLyoqXG4gICAgICogQ29uc29sZSBvYmplY3QuXG4gICAgICogQHR5cGUge1JlY29yZDxDb25zb2xlTWV0aG9kTmFtZSwgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZD59ICovXG4gICAgY29uc3QgY29uc29sZU9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPENvbnNvbGVNZXRob2ROYW1lLCAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiB2b2lkPn0gKi8gKGNvbnNvbGUpXG4gICAgLyoqXG4gICAgICogT3JpZ2luYWwgY29uc29sZSBtZXRob2RzIGNhcHR1cmVkIGFzIGRpcmVjdCByZWZlcmVuY2VzIHNvIHN0b3BwaW5nIHJlc3RvcmVzXG4gICAgICogdGhlIGV4YWN0IG1ldGhvZCB0aGF0IHdhcyBpbnN0YWxsZWQgYXQgY2FwdHVyZSBzdGFydC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPENvbnNvbGVNZXRob2ROYW1lLCAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiB2b2lkPn0gKi9cbiAgICBjb25zdCBvcmlnaW5hbENvbnNvbGVNZXRob2RzID0ge1xuICAgICAgZGVidWc6IGNvbnNvbGVPYmplY3QuZGVidWcsXG4gICAgICBlcnJvcjogY29uc29sZU9iamVjdC5lcnJvcixcbiAgICAgIGluZm86IGNvbnNvbGVPYmplY3QuaW5mbyxcbiAgICAgIGxvZzogY29uc29sZU9iamVjdC5sb2csXG4gICAgICB3YXJuOiBjb25zb2xlT2JqZWN0Lndhcm5cbiAgICB9XG4gICAgbGV0IHN0b3BwZWQgPSBmYWxzZVxuICAgIGxldCBvdXRwdXRUZXh0ID0gXCJcIlxuXG4gICAgZm9yIChjb25zdCBtZXRob2ROYW1lIG9mIENBUFRVUkVEX0NPTlNPTEVfTUVUSE9EUykge1xuICAgICAgY29uc29sZU9iamVjdFttZXRob2ROYW1lXSA9ICguLi5hcmdzKSA9PiB7XG4gICAgICAgIGxpbmVzLnB1c2goYFske25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1dIFske21ldGhvZE5hbWV9XSAke2Zvcm1hdCguLi5hcmdzKX1gKVxuXG4gICAgICAgIGlmIChwYXNzdGhyb3VnaCkge1xuICAgICAgICAgIG9yaWdpbmFsQ29uc29sZU1ldGhvZHNbbWV0aG9kTmFtZV0uYXBwbHkoY29uc29sZU9iamVjdCwgYXJncylcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBpZiAoIXN0b3BwZWQpIHtcbiAgICAgICAgc3RvcHBlZCA9IHRydWVcblxuICAgICAgICBmb3IgKGNvbnN0IG1ldGhvZE5hbWUgb2YgQ0FQVFVSRURfQ09OU09MRV9NRVRIT0RTKSB7XG4gICAgICAgICAgY29uc29sZU9iamVjdFttZXRob2ROYW1lXSA9IG9yaWdpbmFsQ29uc29sZU1ldGhvZHNbbWV0aG9kTmFtZV1cbiAgICAgICAgfVxuXG4gICAgICAgIG91dHB1dFRleHQgPSBsaW5lcy5qb2luKFwiXFxuXCIpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBvdXRwdXRUZXh0XG4gICAgfVxuICB9XG59XG4iXX0=