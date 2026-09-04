// @ts-check
import fs from "node:fs/promises";
import path from "path";
import { format } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import Application from "../../src/application.js";
import RequestClient from "./request-client.js";
import picocolors from "picocolors";
import restArgsError from "../utils/rest-args-error.js";
import { testConfig, tests } from "./test.js";
import { pathToFileURL } from "url";
import SharedTransactionBroker from "./shared-transaction-broker.js";
import { SHARED_TRANSACTION_BROKER_ENV } from "./shared-transaction-proxy-driver.js";
import { synchronizeTestingPackageTests } from "./testing-package-adapter.js";
import VelociousAttemptExecutor from "./velocious-attempt-executor.js";
import VelociousRunnerReporter from "./velocious-runner-reporter.js";
import VelociousSuiteHookExecutor from "./velocious-suite-hook-executor.js";
import VelociousTestArguments from "./velocious-test-arguments.js";
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
        this._attemptExecutor = new VelociousAttemptExecutor({ testRunner: this });
        this._runnerReporter = new VelociousRunnerReporter({ testRunner: this });
        this._suiteHookExecutor = new VelociousSuiteHookExecutor({ testRunner: this });
        this._testArguments = new VelociousTestArguments({ testRunner: this });
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
        await this._attemptExecutor.runAfterEaches({ afterEaches, testArgs, testData });
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
            await this._suiteHookExecutor.runBeforeAlls({ hooks: beforeAlls });
            for (const testDescription in tests.tests) {
                const testData = tests.tests[testDescription];
                const testArgs = this._testArguments.copy(testData);
                const includeByLine = scopeLineMatch || this.matchesLineFilter(testData);
                if (this._onlyFocussed && !testArgs.focus)
                    continue;
                if (this.shouldSkipTest(testArgs, testData, testDescription, descriptions, includeByLine))
                    continue;
                await this._testArguments.inject(testArgs);
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
                    const attemptResult = await this._attemptExecutor.execute({
                        afterEaches: newAfterEaches,
                        attemptNumber,
                        beforeEaches: newBeforeEaches,
                        descriptions,
                        testArgs,
                        testData,
                        testDescription,
                        timeoutMs
                    });
                    if (attemptResult.consoleOutput) {
                        attemptConsoleOutputs.push({ attemptNumber, output: attemptResult.consoleOutput });
                    }
                    if (attemptResult.abortRemainingTests)
                        this._abortRemainingTests = true;
                    const willRetry = attemptResult.failed && !this._abortRemainingTests && retriesUsed < retryCount;
                    if (willRetry)
                        retriesUsed++;
                    await this._runnerReporter.reportAttempt({
                        attemptConsoleOutputs,
                        attemptNumber,
                        descriptions,
                        error: attemptResult.error,
                        failed: attemptResult.failed,
                        leftPadding,
                        retriesUsed,
                        retryCount,
                        testArgs,
                        testData,
                        testDescription,
                        willRetry
                    });
                    attemptNumber++;
                    if (!willRetry)
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
        const afterAlls = this.profileHookEntries(scopeEntry.tests.afterAlls || [], scopeEntry.profileScopeId, scopeOwnerFilePath);
        await this._suiteHookExecutor.runAfterAlls({ hooks: afterAlls });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDaEMsT0FBTyxFQUFDLGlCQUFpQixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDbEQsT0FBTyxXQUFXLE1BQU0sMEJBQTBCLENBQUE7QUFDbEQsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ25DLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzNDLE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxLQUFLLENBQUE7QUFDakMsT0FBTyx1QkFBdUIsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRSxPQUFPLEVBQUUsNkJBQTZCLEVBQUUsTUFBTSxzQ0FBc0MsQ0FBQTtBQUNwRixPQUFPLEVBQUMsOEJBQThCLEVBQUMsTUFBTSw4QkFBOEIsQ0FBQTtBQUMzRSxPQUFPLHdCQUF3QixNQUFNLGlDQUFpQyxDQUFBO0FBQ3RFLE9BQU8sdUJBQXVCLE1BQU0sZ0NBQWdDLENBQUE7QUFDcEUsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLHNCQUFzQixNQUFNLCtCQUErQixDQUFBO0FBRWxFOzs4RUFFOEU7QUFDOUU7Ozs7O0dBS0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNIOzs7Ozs7Ozs7R0FTRztBQUNIOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7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QUFDLFVBQVUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLENBQUE7Z0JBQy9ELENBQUM7WUFDSCxDQUFDLENBQUE7UUFDSCxDQUFDO1FBRUQsT0FBTyxHQUFHLEVBQUU7WUFDVixJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ2IsT0FBTyxHQUFHLElBQUksQ0FBQTtnQkFFZCxLQUFLLE1BQU0sVUFBVSxJQUFJLHdCQUF3QixFQUFFLENBQUM7b0JBQ2xELGFBQWEsQ0FBQyxVQUFVLENBQUMsR0FBRyxzQkFBc0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtnQkFDaEUsQ0FBQztnQkFFRCxVQUFVLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUMvQixDQUFDO1lBRUQsT0FBTyxVQUFVLENBQUE7UUFDbkIsQ0FBQyxDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmcy9wcm9taXNlc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQge2Zvcm1hdH0gZnJvbSBcIm5vZGU6dXRpbFwiXG5pbXBvcnQge0FzeW5jTG9jYWxTdG9yYWdlfSBmcm9tIFwibm9kZTphc3luY19ob29rc1wiXG5pbXBvcnQgQXBwbGljYXRpb24gZnJvbSBcIi4uLy4uL3NyYy9hcHBsaWNhdGlvbi5qc1wiXG5pbXBvcnQgUmVxdWVzdENsaWVudCBmcm9tIFwiLi9yZXF1ZXN0LWNsaWVudC5qc1wiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7dGVzdENvbmZpZywgdGVzdHN9IGZyb20gXCIuL3Rlc3QuanNcIlxuaW1wb3J0IHtwYXRoVG9GaWxlVVJMfSBmcm9tIFwidXJsXCJcbmltcG9ydCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlciBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tYnJva2VyLmpzXCJcbmltcG9ydCB7IFNIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WIH0gZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5pbXBvcnQge3N5bmNocm9uaXplVGVzdGluZ1BhY2thZ2VUZXN0c30gZnJvbSBcIi4vdGVzdGluZy1wYWNrYWdlLWFkYXB0ZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c0F0dGVtcHRFeGVjdXRvciBmcm9tIFwiLi92ZWxvY2lvdXMtYXR0ZW1wdC1leGVjdXRvci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzUnVubmVyUmVwb3J0ZXIgZnJvbSBcIi4vdmVsb2Npb3VzLXJ1bm5lci1yZXBvcnRlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzU3VpdGVIb29rRXhlY3V0b3IgZnJvbSBcIi4vdmVsb2Npb3VzLXN1aXRlLWhvb2stZXhlY3V0b3IuanNcIlxuaW1wb3J0IFZlbG9jaW91c1Rlc3RBcmd1bWVudHMgZnJvbSBcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCJcblxuLyoqXG4gKiBDb25zb2xlTWV0aG9kTmFtZSB0eXBlLlxuICogQHR5cGVkZWYge1wibG9nXCIgfCBcImluZm9cIiB8IFwid2FyblwiIHwgXCJlcnJvclwiIHwgXCJkZWJ1Z1wifSBDb25zb2xlTWV0aG9kTmFtZSAqL1xuLyoqXG4gKiBBdHRlbXB0Q29uc29sZU91dHB1dCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQXR0ZW1wdENvbnNvbGVPdXRwdXRcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gQXR0ZW1wdCBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gb3V0cHV0IC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQuXG4gKi9cbi8qKlxuICogVGVzdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RBcmdzXG4gKiBAcHJvcGVydHkge0FwcGxpY2F0aW9ufSBbYXBwbGljYXRpb25dIC0gQXBwbGljYXRpb24gaW5zdGFuY2UgZm9yIGludGVncmF0aW9uIHRlc3RzLlxuICogQHByb3BlcnR5IHtSZXF1ZXN0Q2xpZW50fSBbY2xpZW50XSAtIEhUVFAgY2xpZW50IGZvciByZXF1ZXN0IHRlc3RzLlxuICogQHByb3BlcnR5IHtvYmplY3R9IFtkYXRhYmFzZUNsZWFuaW5nXSAtIERhdGFiYXNlIGNsZWFudXAgb3B0aW9ucyBmb3IgdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRyYW5zYWN0aW9uXSAtIFVzZSB0cmFuc2FjdGlvbnMgdG8gcm9sbGJhY2sgYmV0d2VlbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJ1bmNhdGVdIC0gVHJ1bmNhdGUgdGFibGVzIGJldHdlZW4gdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRydW5jYXRlQmVmb3JlXSAtIFRydW5jYXRlIHRhYmxlcyBiZWZvcmUgZWFjaCB0ZXN0LCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdCBjbGVhbnVwLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZm9jdXNdIC0gV2hldGhlciB0aGlzIHRlc3QgaXMgZm9jdXNlZC5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IFtmdW5jdGlvbl0gLSBUZXN0IGNhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtyZXRyeV0gLSBOdW1iZXIgb2YgcmV0cmllcyB3aGVuIGEgdGVzdCBmYWlscy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW10gfCBzdHJpbmd9IFt0YWdzXSAtIFRhZ3MgZm9yIGZpbHRlcmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dFNlY29uZHNdIC0gVGltZW91dCBpbiBzZWNvbmRzIGZvciB0aGUgdGVzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBUZXN0IHR5cGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgdGVuYW50OiBvYmplY3R9KSA9PiBQcm9taXNlPHZvaWQ+fSBbcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50XSAtIFJlZ2lzdGVycyBvbmUgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIHRyYW5zYWN0aW9uIGZvciB0aGlzIGF0dGVtcHQuXG4gKi9cbi8qKlxuICogQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBBdHRlbXB0LW93bmVkIGNvbm5lY3Rpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gQ29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcXVhcmFudGluZVByb21pc2VdIC0gU2hhcmVkIGNvbm5lY3Rpb24tZGlzY2FyZCBwcm9taXNlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBxdWFyYW50aW5lZCAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaXMgdW5zYWZlIHRvIHJldXNlLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcm9sbGJhY2tQcm9taXNlXSAtIFNoYXJlZCByb2xsYmFjayBwcm9taXNlLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbc3RhcnRQcm9taXNlXSAtIFRyYW5zYWN0aW9uIHN0YXJ0dXAgcHJvbWlzZSB3aGVuIHRyYW5zYWN0aW9uIGNsZWFuaW5nIGlzIGVuYWJsZWQuXG4gKi9cbi8qKlxuICogVGVzdERhdGEgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3REYXRhXG4gKiBAcHJvcGVydHkge1Rlc3RBcmdzfSBhcmdzIC0gQXJndW1lbnRzIHBhc3NlZCB0byB0aGUgdGVzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZmlsZVBhdGhdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbGluZV0gLSBTb3VyY2UgbGluZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICogQHByb3BlcnR5IHsoYXJnOiBUZXN0QXJncykgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IGZ1bmN0aW9uIC0gVGVzdCBjYWxsYmFjayB0byBleGVjdXRlLlxuICovXG4vKipcbiAqIEZhaWxlZFRlc3REZXRhaWwgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZhaWxlZFRlc3REZXRhaWxcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmdWxsRGVzY3JpcHRpb24gLSBGdWxsIHRlc3QgZGVzY3JpcHRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlT3V0cHV0XSAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0IHdoaWxlIHRlc3QgcmFuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlTG9nUGF0aF0gLSBTYXZlZCBjb25zb2xlIGxvZyBwYXRoLlxuICovXG4vKipcbiAqIEFjdGl2ZUFmdGVyQWxsU2NvcGVFbnRyeSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWN0aXZlQWZ0ZXJBbGxTY29wZUVudHJ5XG4gKiBAcHJvcGVydHkge1Rlc3RzQXJndW1lbnR9IHRlc3RzIC0gU2NvcGUgdGVzdCB0cmVlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBhZnRlckFsbHNSdW4gLSBXaGV0aGVyIGNsZWFudXAgaG9va3MgaGF2ZSBydW4uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3Byb2ZpbGVTY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIHRlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfSkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBIb29rIGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2RlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBpbmRleCB3aXRoaW4gaXRzIGRlY2xhcmF0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkZWNsYXJhdGlvblNjb3BlSWRdIC0gT3BhcXVlIHByb2ZpbGUgc2NvcGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9KSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVcbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gSG9vayBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICovXG4vKipcbiAqIFRlc3RzQXJndW1lbnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RzQXJndW1lbnRcbiAqIEBwcm9wZXJ0eSB7VGVzdEFyZ3N9IGFyZ3MgLSBBcmd1bWVudHMgaW5oZXJpdGVkIGJ5IHRlc3RzIGluIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFthbnlUZXN0c0ZvY3Vzc2VkXSAtIFdoZXRoZXIgYW55IHRlc3RzIGluIHRoZSB0cmVlIGFyZSBmb2N1c2VkLlxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYWZ0ZXJFYWNoZXMgLSBBZnRlci1lYWNoIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBhZnRlckFsbHMgLSBBZnRlci1hbGwgaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlW119IGJlZm9yZUFsbHMgLSBCZWZvcmUtYWxsIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYmVmb3JlRWFjaGVzIC0gQmVmb3JlLWVhY2ggaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgVGVzdERhdGE+fSB0ZXN0cyAtIEEgdW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBub2RlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBUZXN0c0FyZ3VtZW50Pn0gc3VicyAtIE9wdGlvbmFsIGNoaWxkIG5vZGVzLiBFYWNoIGl0ZW0gaXMgYW5vdGhlciBgTm9kZWAsIGFsbG93aW5nIHJlY3Vyc2lvbi5cbiAqL1xuLyoqXG4gKiBNYXJrcyB0aGUgZXJyb3IgdGhyb3duIGJ5IHRoZSBhdHRlbXB0IHRpbWVvdXQgc28gdGhlIHJ1bm5lciBjYW4gZGlzdGluZ3Vpc2hcbiAqIGRldGFjaGVkIGxpZmVjeWNsZSBjbGVhbnVwIGZyb20gYW4gb3JkaW5hcnkgdGVzdCBmYWlsdXJlLlxuICogQHR5cGVkZWYge0Vycm9yICYge3ZlbG9jaW91c1Rlc3RUaW1lb3V0PzogdHJ1ZX19IFRlc3RUaW1lb3V0RXJyb3JcbiAqL1xuLyoqXG4gKiBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJ9IGJyb2tlciAtIEF0dGVtcHQgYnJva2VyIGFuZCBjb25uZWN0aW9uIGNvb3JkaW5hdG9yLlxuICogQHByb3BlcnR5IHtib29sZWFufSBlbnZpcm9ubWVudFB1Ymxpc2hlZCAtIFdoZXRoZXIgY2hpbGQtcHJvY2VzcyBjb29yZGluYXRlcyB3ZXJlIHB1Ymxpc2hlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBwcmV2aW91c0Vudmlyb25tZW50IC0gRW52aXJvbm1lbnQgdmFsdWUgdG8gcmVzdG9yZSBhZnRlciBwdWJsaWNhdGlvbi5cbiAqL1xuLyoqXG4gKiBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge1Byb21pc2U8e2Nvbm5lY3Rpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBlcnJvcjogRXJyb3IgfCB1bmRlZmluZWR9PiB8IHVuZGVmaW5lZH0gW2NoZWNrb3V0UHJvbWlzZV0gLSBBdHRlbXB0LW93bmVkIHBoeXNpY2FsIGNoZWNrb3V0IG91dGNvbWUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25uZWN0aW9uIC0gQXR0ZW1wdC1vd25lZCBwaHlzaWNhbCBjb25uZWN0aW9uIG9uY2UgY2hlY2tvdXQgcmVzb2x2ZXMuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IFtjbGVhbnVwUHJvbWlzZV0gLSBTaW5nbGUgY2xlYW51cCBvcGVyYXRpb24gc2hhcmVkIGJ5IGVtZXJnZW5jeSBhbmQgZXZlbnR1YWwgbGlmZWN5Y2xlIGNsZWFudXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW4gfCB1bmRlZmluZWR9IFtkaXNjYXJkT25DbGVhbnVwXSAtIFdoZXRoZXIgdGltZW91dCBlbWVyZ2VuY3kgY2xlYW51cCBtdXN0IHF1YXJhbnRpbmUgdGhpcyBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gcG9vbCAtIE93bmluZyBsb2dpY2FsIHBvb2wuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldm9rZWQgLSBXaGV0aGVyIHRoaXMgYXR0ZW1wdCBtYXkgc3RpbGwgcHVibGlzaCB0aGUgcGh5c2ljYWwgcmVnaXN0cmF0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJldXNlS2V5IC0gUmVzb2x2ZWQgcGh5c2ljYWwgY29uZmlndXJhdGlvbiBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSBzaGFyZWRSZWdpc3RyYXRpb24gLSBQaHlzaWNhbC1rZXkgc2hhcmVkIHJlZ2lzdHJhdGlvbiBvbmNlIHB1Ymxpc2hlZC5cbiAqL1xuXG4vKipcbiAqIENhcHR1cmVkIGNvbnNvbGUgbWV0aG9kcy5cbiAqIEB0eXBlIHtDb25zb2xlTWV0aG9kTmFtZVtdfSAqL1xuY29uc3QgQ0FQVFVSRURfQ09OU09MRV9NRVRIT0RTID0gW1wibG9nXCIsIFwiaW5mb1wiLCBcIndhcm5cIiwgXCJlcnJvclwiLCBcImRlYnVnXCJdXG5cbi8qKlxuICogUnVucyB0byBmaWxlIHNsdWcuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBWYWx1ZSB0byBzYW5pdGl6ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2x1Zy1zYWZlIHZhbHVlLlxuICovXG5mdW5jdGlvbiB0b0ZpbGVTbHVnKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnJlcGxhY2UoL1teYS16MC05XSsvZywgXCItXCIpXG4gICAgLnJlcGxhY2UoL14tK3wtKyQvZywgXCJcIilcbiAgICAuc2xpY2UoMCwgODApIHx8IFwiZmFpbGVkLXRlc3RcIlxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBUZXN0UnVubmVyIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0FjdGl2ZUFmdGVyQWxsU2NvcGVFbnRyeVtdfSAqL1xuICBfYWN0aXZlQWZ0ZXJBbGxTY29wZXNcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7RmFpbGVkVGVzdERldGFpbFtdfSAqL1xuICBfZmFpbGVkVGVzdERldGFpbHNcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmd9IFthcmdzLmV4Y2x1ZGVUYWdzXSAtIFRhZ3MgdG8gZXhjbHVkZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuaW5jbHVkZVRhZ3NdIC0gVGFncyB0byBpbmNsdWRlLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGFyZ3MudGVzdEZpbGVzIC0gVGVzdCBmaWxlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT59IFthcmdzLmxpbmVGaWx0ZXJzXSAtIExpbmUgZmlsdGVycyBieSBmaWxlLlxuICAgKiBAcGFyYW0ge1JlZ0V4cFtdfSBbYXJncy5leGFtcGxlUGF0dGVybnNdIC0gRXhhbXBsZSBwYXR0ZXJucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcHJvZmlsZXIuanNcIikuZGVmYXVsdH0gW2FyZ3MucHJvZmlsZXJdIC0gT3B0LWluIHByb2ZpbGVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGV4Y2x1ZGVUYWdzLCBpbmNsdWRlVGFncywgdGVzdEZpbGVzLCBsaW5lRmlsdGVycywgZXhhbXBsZVBhdHRlcm5zLCBwcm9maWxlciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5fY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlKClcbiAgICB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2UoKVxuICAgIHRoaXMuX2V4Y2x1ZGVUYWdzID0gdGhpcy5ub3JtYWxpemVUYWdzKGV4Y2x1ZGVUYWdzKVxuICAgIHRoaXMuX2V4Y2x1ZGVUYWdTZXQgPSBuZXcgU2V0KHRoaXMuX2V4Y2x1ZGVUYWdzKVxuICAgIHRoaXMuX2luY2x1ZGVUYWdzID0gdGhpcy5ub3JtYWxpemVUYWdzKGluY2x1ZGVUYWdzKVxuICAgIHRoaXMuX2luY2x1ZGVUYWdTZXQgPSBuZXcgU2V0KHRoaXMuX2luY2x1ZGVUYWdzKVxuICAgIHRoaXMuX3Rlc3RGaWxlcyA9IHRlc3RGaWxlc1xuICAgIHRoaXMuX2xpbmVGaWx0ZXJzID0gbGluZUZpbHRlcnMgfHwge31cbiAgICB0aGlzLl9leGFtcGxlUGF0dGVybnMgPSBleGFtcGxlUGF0dGVybnMgfHwgW11cbiAgICB0aGlzLl9wcm9maWxlciA9IHByb2ZpbGVyXG4gICAgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IGZhbHNlXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9IDBcbiAgICB0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPSAwXG4gICAgdGhpcy5fdGVzdHNDb3VudCA9IDBcbiAgICB0aGlzLl9hY3RpdmVBZnRlckFsbFNjb3BlcyA9IFtdXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMgPSBbXVxuICAgIC8qKiBAdHlwZSB7e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXJ9IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sYXN0VGVzdENvbnRleHQgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlciwgZHVyYXRpb25NczogbnVtYmVyfT59ICovXG4gICAgdGhpcy5fdGVzdER1cmF0aW9ucyA9IFtdXG4gICAgdGhpcy5fYXR0ZW1wdEV4ZWN1dG9yID0gbmV3IFZlbG9jaW91c0F0dGVtcHRFeGVjdXRvcih7dGVzdFJ1bm5lcjogdGhpc30pXG4gICAgdGhpcy5fcnVubmVyUmVwb3J0ZXIgPSBuZXcgVmVsb2Npb3VzUnVubmVyUmVwb3J0ZXIoe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICAgIHRoaXMuX3N1aXRlSG9va0V4ZWN1dG9yID0gbmV3IFZlbG9jaW91c1N1aXRlSG9va0V4ZWN1dG9yKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgICB0aGlzLl90ZXN0QXJndW1lbnRzID0gbmV3IFZlbG9jaW91c1Rlc3RBcmd1bWVudHMoe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fY29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgdGVzdCBmaWxlcy5cbiAgICovXG4gIGdldFRlc3RGaWxlcygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RGaWxlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxpbmUgZmlsdGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gLSBMaW5lIGZpbHRlcnMuXG4gICAqL1xuICBnZXRMaW5lRmlsdGVycygpIHsgcmV0dXJuIHRoaXMuX2xpbmVGaWx0ZXJzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhhbXBsZSBwYXR0ZXJucy5cbiAgICogQHJldHVybnMge1JlZ0V4cFtdfSAtIEV4YW1wbGUgcGF0dGVybnMuXG4gICAqL1xuICBnZXRFeGFtcGxlUGF0dGVybnMoKSB7IHJldHVybiB0aGlzLl9leGFtcGxlUGF0dGVybnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcHJvZmlsZXIgc3BhbiBvbmx5IHdoZW4gcHJvZmlsaW5nIHdhcyBleHBsaWNpdGx5IGVuYWJsZWQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBtZXRhZGF0YSAtIFNwYW4gbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YS5waGFzZSAtIFBoYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbWV0YWRhdGEuZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGRlY2xhcmF0aW9uIGluZGV4LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW21ldGFkYXRhLmRlY2xhcmF0aW9uU2NvcGVJZF0gLSBIb29rIGRlY2xhcmF0aW9uIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW21ldGFkYXRhLmZpbGVQYXRoXSAtIFNvdXJjZSBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7KCkgPT4gKFQgfCBQcm9taXNlPFQ+KX0gY2FsbGJhY2sgLSBUaW1lZCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuUHJvZmlsZVNwYW4obWV0YWRhdGEsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9maWxlcikgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9wcm9maWxlci5ydW5TcGFuKG1ldGFkYXRhLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGRlY2xhcmF0aW9uIG1ldGFkYXRhIHRvIGhvb2tzIG9ubHkgZm9yIGFuIGFjdGl2ZSBwcm9maWxlLlxuICAgKiBAdGVtcGxhdGUge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZSB8IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlfSBUXG4gICAqIEBwYXJhbSB7VFtdfSBob29rcyAtIEhvb2tzIGRlY2xhcmVkIGluIG9uZSBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGRlY2xhcmF0aW9uU2NvcGVJZCAtIFByb2ZpbGUgc2NvcGUgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG93bmVyRmlsZVBhdGggLSBTY29wZSBvd25lciBmaWxlLlxuICAgKiBAcmV0dXJucyB7VFtdfSAtIFByb2ZpbGUtYXdhcmUgaG9vayBlbnRyaWVzLlxuICAgKi9cbiAgcHJvZmlsZUhvb2tFbnRyaWVzKGhvb2tzLCBkZWNsYXJhdGlvblNjb3BlSWQsIG93bmVyRmlsZVBhdGgpIHtcbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSByZXR1cm4gaG9va3NcblxuICAgIHJldHVybiBob29rcy5tYXAoKGhvb2ssIGRlY2xhcmF0aW9uSW5kZXgpID0+IE9iamVjdC5hc3NpZ24oe30sIGhvb2ssIHtcbiAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IGhvb2suZGVjbGFyYXRpb25JbmRleCA/PyBkZWNsYXJhdGlvbkluZGV4LFxuICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBob29rLmRlY2xhcmF0aW9uU2NvcGVJZCA/PyBkZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICBvd25lckZpbGVQYXRoOiBob29rLm93bmVyRmlsZVBhdGggPz8gb3duZXJGaWxlUGF0aFxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHRhZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmcgfCB1bmRlZmluZWR9IHRhZ3MgLSBUYWdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTm9ybWFsaXplZCB0YWdzLlxuICAgKi9cbiAgbm9ybWFsaXplVGFncyh0YWdzKSB7XG4gICAgaWYgKCF0YWdzKSByZXR1cm4gW11cblxuICAgIGNvbnN0IHZhbHVlcyA9IFtdXG4gICAgY29uc3QgcmF3VGFncyA9IEFycmF5LmlzQXJyYXkodGFncykgPyB0YWdzIDogW3RhZ3NdXG5cbiAgICBmb3IgKGNvbnN0IHJhd1RhZyBvZiByYXdUYWdzKSB7XG4gICAgICBpZiAocmF3VGFnID09PSB1bmRlZmluZWQgfHwgcmF3VGFnID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyhyYXdUYWcpLnNwbGl0KFwiLFwiKVxuXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IHBhcnQudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIHZhbHVlcy5wdXNoKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldCh2YWx1ZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRhZy5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWcgLSBUYWcgdG8gY2hlY2sgZm9yLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRhZyBpcyBwcmVzZW50LlxuICAgKi9cbiAgaGFzVGFnKHRlc3RBcmdzLCB0YWcpIHtcbiAgICByZXR1cm4gdGhpcy5ub3JtYWxpemVUYWdzKHRlc3RBcmdzPy50YWdzKS5pbmNsdWRlcyh0YWcpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBicm93c2VyIHRlc3QgbW9kZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBydW5uaW5nIGJyb3dzZXIgdGVzdHMuXG4gICAqL1xuICBpc0Jyb3dzZXJUZXN0TW9kZSgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCBkdW1teSBpZiBuZWVkZWQuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gW2Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zXSAtIEF0dGVtcHQtb3duZWQgYnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhEdW1teUlmTmVlZGVkKHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXSkge1xuICAgIGlmICghdGhpcy5oYXNUYWcodGVzdEFyZ3MsIFwiZHVtbXlcIikpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLmlzQnJvd3NlclRlc3RNb2RlKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bk5vZGVEdW1teShjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBub2RlIGR1bW15LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuTm9kZUR1bW15KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZHVtbXlQYXRoID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RVTU1ZX1BBVEggfHwgdGhpcy5kZWZhdWx0RHVtbXlQYXRoKClcbiAgICBjb25zdCBkdW1teUltcG9ydCA9IGF3YWl0IGltcG9ydChwYXRoVG9GaWxlVVJMKGR1bW15UGF0aCkuaHJlZilcbiAgICBjb25zdCBEdW1teSA9IGR1bW15SW1wb3J0LmRlZmF1bHRcblxuICAgIGlmICghRHVtbXk/LnJ1bikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEdW1teSBoZWxwZXIgbm90IGZvdW5kIGF0ICR7ZHVtbXlQYXRofWApXG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzZXJ2ZXIgcmVzb3VyY2VzIG11c3Qgbm90IGluaGVyaXQgYW4gYXR0ZW1wdCBzY29wZSB0aGF0IHdpbGwgYmUgcmV2b2tlZC5cbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IER1bW15LnJ1bihhc3luYyAoKSA9PiB7fSlcbiAgICB9KVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgYXdhaXQgY2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCBkdW1teSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlZmF1bHQgZHVtbXkgaGVscGVyIHBhdGguXG4gICAqL1xuICBkZWZhdWx0RHVtbXlQYXRoKCkge1xuICAgIGNvbnN0IGN3ZCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBjd2Quc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpXG5cbiAgICBpZiAobm9ybWFsaXplZC5lbmRzV2l0aChcIi9zcGVjL2R1bW15XCIpKSB7XG4gICAgICByZXR1cm4gcGF0aC5qb2luKGN3ZCwgXCJpbmRleC5qc1wiKVxuICAgIH1cblxuICAgIHJldHVybiBwYXRoLmpvaW4oY3dkLCBcInNwZWMvZHVtbXkvaW5kZXguanNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBicm93c2VyIGR1bW15LlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zIC0gQXR0ZW1wdC1vd25lZCBicm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCB1c2VUcmFuc2FjdGlvbiA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRyYW5zYWN0aW9uID09PSB0cnVlXG4gICAgY29uc3QgdHJ1bmNhdGUgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZVxuICAgIGNvbnN0IHNob3VsZFRydW5jYXRlID0gdHJ1bmNhdGUgPT09IHVuZGVmaW5lZCA/ICF1c2VUcmFuc2FjdGlvbiA6IHRydW5jYXRlXG5cbiAgICBpZiAoIXVzZVRyYW5zYWN0aW9uICYmICFzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiVGVzdCBydW5uZXIgYnJvd3NlciBkdW1teVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgbmV3UmVnaXN0cmF0aW9ucyA9IE9iamVjdC5lbnRyaWVzKGRicykubWFwKChbZGF0YWJhc2VJZGVudGlmaWVyLCBkYl0pID0+IHtcbiAgICAgICAgLyoqIEB0eXBlIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSAqL1xuICAgICAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGRiLFxuICAgICAgICAgIHF1YXJhbnRpbmVkOiBmYWxzZVxuICAgICAgICB9XG5cbiAgICAgICAgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMucHVzaChyZWdpc3RyYXRpb24pXG5cbiAgICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICAgICAgfSlcblxuICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVEYXRhYmFzZXMoZGJzKVxuICAgICAgfVxuICAgICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgICBjb25zdCBsaWZlY3ljbGVFcnJvcnMgPSBbXVxuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAodXNlVHJhbnNhY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBzdGFydFByb21pc2VzID0gbmV3UmVnaXN0cmF0aW9ucy5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLmRiLnN0YXJ0VHJhbnNhY3Rpb24oKVxuXG4gICAgICAgICAgICByZWdpc3RyYXRpb24uc3RhcnRQcm9taXNlID0gc3RhcnRQcm9taXNlXG4gICAgICAgICAgICByZXR1cm4gc3RhcnRQcm9taXNlXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb25zdCBzdGFydFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc3RhcnRQcm9taXNlcylcbiAgICAgICAgICBjb25zdCBzdGFydEVycm9ycyA9IHN0YXJ0UmVzdWx0c1xuICAgICAgICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAgICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICAgICAgICBpZiAoc3RhcnRFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IHN0YXJ0RXJyb3JzWzBdXG4gICAgICAgICAgaWYgKHN0YXJ0RXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihzdGFydEVycm9ycywgXCJCcm93c2VyIGR1bW15IHRyYW5zYWN0aW9uIHN0YXJ0dXAgZmFpbGVkXCIsIHtjYXVzZTogc3RhcnRFcnJvcnNbMF19KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IpIHtcbiAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaCguLi5lcnJvci5lcnJvcnMpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICBhd2FpdCB0aGlzLnRydW5jYXRlRGF0YWJhc2VzKGRicylcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGxpZmVjeWNsZUVycm9yc1swXVxuICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihsaWZlY3ljbGVFcnJvcnMsIFwiQnJvd3NlciBkdW1teSBsaWZlY3ljbGUgYW5kIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogbGlmZWN5Y2xlRXJyb3JzWzBdfSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgZXZlcnkgYXR0ZW1wdC1vd25lZCBicm93c2VyIHRyYW5zYWN0aW9uIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgcm9sbGJhY2tzIHNldHRsZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCByb2xsYmFja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLnN0YXJ0UHJvbWlzZVxuXG4gICAgICBpZiAoIXN0YXJ0UHJvbWlzZSkgcmV0dXJuXG5cbiAgICAgIHJlZ2lzdHJhdGlvbi5yb2xsYmFja1Byb21pc2UgPz89IChhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24ucXVhcmFudGluZWQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgc3RhcnRQcm9taXNlXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgICAgICB9IGNhdGNoIChxdWFyYW50aW5lRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHF1YXJhbnRpbmUgYnJvd3NlciBkdW1teSBkYXRhYmFzZSBhZnRlciB0cmFuc2FjdGlvbiBzdGFydHVwIGZhaWxlZDogJHtyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyfWAsIHtjYXVzZTogcXVhcmFudGluZUVycm9yfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24uZGIucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgICAgIH0gY2F0Y2ggKHJvbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICAgICAgfSBjYXRjaCAocXVhcmFudGluZUVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICAgIFtyb2xsYmFja0Vycm9yLCBxdWFyYW50aW5lRXJyb3JdLFxuICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJvbGwgYmFjayBhbmQgcXVhcmFudGluZSBicm93c2VyIGR1bW15IGRhdGFiYXNlOiAke3JlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXJ9YCxcbiAgICAgICAgICAgICAge2NhdXNlOiBxdWFyYW50aW5lRXJyb3J9XG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IHJvbGxiYWNrRXJyb3JcbiAgICAgICAgfVxuICAgICAgfSkoKVxuXG4gICAgICByZXR1cm4gcmVnaXN0cmF0aW9uLnJvbGxiYWNrUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHJvbGxiYWNrUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiQnJvd3NlciBkdW1teSB0cmFuc2FjdGlvbiBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUGVybWFuZW50bHkgcmVtb3ZlcyBvbmUgYnJvd3NlciBjb25uZWN0aW9uIHRoYXQgY2Fubm90IGJlIHNoYXJlZCBzYWZlbHkuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gcmVnaXN0cmF0aW9uIC0gQnJvd3NlciBjb25uZWN0aW9uIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGNvbm5lY3Rpb24gaXMgZGlzY2FyZGVkLlxuICAgKi9cbiAgYXN5bmMgcXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkID0gdHJ1ZVxuICAgIHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lUHJvbWlzZSA/Pz0gdGhpcy5kaXNjYXJkQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyLCByZWdpc3RyYXRpb24uZGIpXG4gICAgYXdhaXQgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRGlzY2FyZHMgb25lIGJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiB0aHJvdWdoIGl0cyBvd25pbmcgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIENvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBVbnNhZmUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZGlzY2FyZC5cbiAgICovXG4gIGFzeW5jIGRpc2NhcmRCcm93c2VyRHVtbXlDb25uZWN0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgZGIpIHtcbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKS5kaXNjYXJkKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFF1YXJhbnRpbmVzIGFsbCBicm93c2VyIGNvbm5lY3Rpb25zIGNvbmN1cnJlbnRseS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgY29ubmVjdGlvbiBpcyBkaXNjYXJkZWQuXG4gICAqL1xuICBhc3luYyBxdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHF1YXJhbnRpbmVSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHJlZ2lzdHJhdGlvbnMubWFwKGFzeW5jIChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHF1YXJhbnRpbmVSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJCcm93c2VyIGR1bW15IGNvbm5lY3Rpb24gcXVhcmFudGluZSBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZGF0YWJhc2VzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gZGJzIC0gRGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZURhdGFiYXNlcyhkYnMpIHtcbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoZGJzKSkge1xuICAgICAgYXdhaXQgZGJzW2lkZW50aWZpZXJdLnRydW5jYXRlQWxsVGFibGVzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhjbHVkZSB0YWcgc2V0LlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRXhjbHVkZSB0YWcgc2V0LlxuICAgKi9cbiAgZ2V0RXhjbHVkZVRhZ1NldCgpIHtcbiAgICAvKipcbiAgICAgKiBDb25maWcgdGFncy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgY29uZmlnVGFncyA9IEFycmF5LmlzQXJyYXkodGVzdENvbmZpZy5leGNsdWRlVGFncykgPyB0ZXN0Q29uZmlnLmV4Y2x1ZGVUYWdzIDogW11cblxuICAgIHJldHVybiBuZXcgU2V0KFsuLi50aGlzLl9leGNsdWRlVGFncywgLi4uY29uZmlnVGFnc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgbWF0Y2hpbmcgdGFnLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nIHwgdW5kZWZpbmVkfSB0ZXN0VGFncyAtIFRlc3QgdGFncy5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gdGFnU2V0IC0gVGFnIHNldC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdGFncyBtYXRjaC5cbiAgICovXG4gIGhhc01hdGNoaW5nVGFnKHRlc3RUYWdzLCB0YWdTZXQpIHtcbiAgICBpZiAoIXRhZ1NldC5zaXplKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB0aGlzLm5vcm1hbGl6ZVRhZ3ModGVzdFRhZ3MpXG5cbiAgICBmb3IgKGNvbnN0IHRhZyBvZiBub3JtYWxpemVkKSB7XG4gICAgICBpZiAodGFnU2V0Lmhhcyh0YWcpKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHJ1bm5hYmxlIHRlc3RzLlxuICAgKiBAcGFyYW0ge1Rlc3RzQXJndW1lbnR9IHRlc3RzIC0gVGVzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFtkZXNjcmlwdGlvbnNdIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2xpbmVNYXRjaGVkSW5TY29wZV0gLSBXaGV0aGVyIGxpbmUgbWF0Y2hlZCBpbiBzY29wZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdGVzdHMgaW4gdGhpcyBzY29wZSB3aWxsIHJ1bi5cbiAgICovXG4gIGhhc1J1bm5hYmxlVGVzdHModGVzdHMsIGRlc2NyaXB0aW9ucyA9IFtdLCBsaW5lTWF0Y2hlZEluU2NvcGUgPSBmYWxzZSkge1xuICAgIGZvciAoY29uc3QgdGVzdERlc2NyaXB0aW9uIGluIHRlc3RzLnRlc3RzKSB7XG4gICAgICBjb25zdCB0ZXN0RGF0YSA9IHRlc3RzLnRlc3RzW3Rlc3REZXNjcmlwdGlvbl1cbiAgICAgIGNvbnN0IHRlc3RBcmdzID0gLyoqIEB0eXBlIHtUZXN0QXJnc30gKi8gKE9iamVjdC5hc3NpZ24oe30sIHRlc3REYXRhLmFyZ3MpKVxuICAgICAgY29uc3QgaW5jbHVkZUJ5TGluZSA9IGxpbmVNYXRjaGVkSW5TY29wZSB8fCB0aGlzLm1hdGNoZXNMaW5lRmlsdGVyKHRlc3REYXRhKVxuXG4gICAgICBpZiAodGhpcy5fb25seUZvY3Vzc2VkICYmICF0ZXN0QXJncy5mb2N1cykgY29udGludWVcbiAgICAgIGlmICh0aGlzLnNob3VsZFNraXBUZXN0KHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9uLCBkZXNjcmlwdGlvbnMsIGluY2x1ZGVCeUxpbmUpKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3ViRGVzY3JpcHRpb24gaW4gdGVzdHMuc3Vicykge1xuICAgICAgY29uc3Qgc3ViVGVzdCA9IHRlc3RzLnN1YnNbc3ViRGVzY3JpcHRpb25dXG4gICAgICBjb25zdCBzY29wZUxpbmVNYXRjaCA9IGxpbmVNYXRjaGVkSW5TY29wZSB8fCB0aGlzLm1hdGNoZXNMaW5lRmlsdGVyKHN1YlRlc3QpXG4gICAgICBjb25zdCBuZXh0RGVzY3JpcHRpb25zID0gZGVzY3JpcHRpb25zLmNvbmNhdChbc3ViRGVzY3JpcHRpb25dKVxuXG4gICAgICBpZiAodGhpcy5fb25seUZvY3Vzc2VkICYmICFzdWJUZXN0LmFueVRlc3RzRm9jdXNzZWQpIGNvbnRpbnVlXG4gICAgICBpZiAodGhpcy5oYXNSdW5uYWJsZVRlc3RzKHN1YlRlc3QsIG5leHREZXNjcmlwdGlvbnMsIHNjb3BlTGluZU1hdGNoKSkgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBza2lwIHRlc3QuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSB0ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGxpbmVNYXRjaGVkSW5TY29wZSAtIFdoZXRoZXIgbGluZSBtYXRjaGVkIGluIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB0ZXN0IHNob3VsZCBiZSBza2lwcGVkLlxuICAgKi9cbiAgc2hvdWxkU2tpcFRlc3QodGVzdEFyZ3MsIHRlc3REYXRhLCB0ZXN0RGVzY3JpcHRpb24sIGRlc2NyaXB0aW9ucywgbGluZU1hdGNoZWRJblNjb3BlKSB7XG4gICAgaWYgKHRoaXMuaGFzVGFnKHRlc3RBcmdzLCBcImJyb3dzZXItb25seVwiKSAmJiAhdGhpcy5pc0Jyb3dzZXJUZXN0TW9kZSgpKSByZXR1cm4gdHJ1ZVxuICAgIGlmICh0aGlzLmhhc01hdGNoaW5nVGFnKHRlc3RBcmdzLnRhZ3MsIHRoaXMuZ2V0RXhjbHVkZVRhZ1NldCgpKSkgcmV0dXJuIHRydWVcblxuICAgIGlmICh0aGlzLl9pbmNsdWRlVGFnU2V0LnNpemUgPiAwICYmICF0ZXN0QXJncy5mb2N1cykge1xuICAgICAgaWYgKCF0aGlzLmhhc01hdGNoaW5nVGFnKHRlc3RBcmdzLnRhZ3MsIHRoaXMuX2luY2x1ZGVUYWdTZXQpKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldEV4YW1wbGVQYXR0ZXJucygpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGZ1bGxEZXNjcmlwdGlvbiA9IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pXG4gICAgICBjb25zdCBtYXRjaGVzID0gdGhpcy5nZXRFeGFtcGxlUGF0dGVybnMoKS5zb21lKChwYXR0ZXJuKSA9PiB7XG4gICAgICAgIHBhdHRlcm4ubGFzdEluZGV4ID0gMFxuICAgICAgICByZXR1cm4gcGF0dGVybi50ZXN0KGZ1bGxEZXNjcmlwdGlvbilcbiAgICAgIH0pXG5cbiAgICAgIGlmICghbWF0Y2hlcykgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBsaW5lRmlsdGVycyA9IHRoaXMuZ2V0TGluZUZpbHRlcnMoKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGxpbmVGaWx0ZXJzKS5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAoIWxpbmVNYXRjaGVkSW5TY29wZSAmJiAhdGhpcy5tYXRjaGVzTGluZUZpbHRlcih0ZXN0RGF0YSkpIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVzIGxpbmUgZmlsdGVyLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhIHwgVGVzdHNBcmd1bWVudH0gZW50cnkgLSBUZXN0IGVudHJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGxpbmUgZmlsdGVyIG1hdGNoZXMgZW50cnkuXG4gICAqL1xuICBtYXRjaGVzTGluZUZpbHRlcihlbnRyeSkge1xuICAgIGlmICghZW50cnkgfHwgIWVudHJ5LmZpbGVQYXRoIHx8ICFlbnRyeS5saW5lKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKGVudHJ5LmZpbGVQYXRoKVxuICAgIGNvbnN0IGxpbmVzID0gdGhpcy5nZXRMaW5lRmlsdGVycygpW2ZpbGVQYXRoXVxuXG4gICAgaWYgKCFsaW5lcyB8fCBsaW5lcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGxpbmVzLmluY2x1ZGVzKGVudHJ5LmxpbmUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBmdWxsIGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnVsbCBkZXNjcmlwdGlvbi5cbiAgICovXG4gIGJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSB7XG4gICAgY29uc3QgcGFydHMgPSBkZXNjcmlwdGlvbnMuY29uY2F0KFt0ZXN0RGVzY3JpcHRpb25dKVxuXG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oXCIgXCIpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbGljYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFwcGxpY2F0aW9uPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcHBsaWNhdGlvbi5cbiAgICovXG4gIGFzeW5jIGFwcGxpY2F0aW9uKCkge1xuICAgIGlmICghdGhpcy5fYXBwbGljYXRpb24pIHtcbiAgICAgIHRoaXMuX2FwcGxpY2F0aW9uID0gbmV3IEFwcGxpY2F0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIC8vIFJ1biByZXF1ZXN0IGhhbmRsZXJzIGluIHRoZSBtYWluIHRocmVhZCAobm90IHdvcmtlciB0aHJlYWRzKSBzbyB0aGV5XG4gICAgICAgIC8vIHJlc29sdmUgREIgd29yayB0byB0aGUgcGVyLXRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gc2V0IGJ5XG4gICAgICAgIC8vIHtAbGluayBhY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9uc30uIFRoaXMgbGV0cyByZXF1ZXN0LXR5cGUgc3BlY3MgdXNlXG4gICAgICAgIC8vIHRyYW5zYWN0aW9uLWJhc2VkIGNsZWFuaW5nICh0aGVpciB3cml0ZXMgbGFuZCBpbnNpZGUgdGhlIHRlc3Qnc1xuICAgICAgICAvLyB0cmFuc2FjdGlvbiBhbmQgcm9sbCBiYWNrKSBpbnN0ZWFkIG9mIHRydW5jYXRpbmcgZXZlcnkgdGFibGUuXG4gICAgICAgIGh0dHBTZXJ2ZXI6IHtpblByb2Nlc3M6IHRydWUsIHBvcnQ6IDMxMDA2fSxcbiAgICAgICAgdHlwZTogXCJ0ZXN0LXJ1bm5lclwiXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLl9hcHBsaWNhdGlvbi5pbml0aWFsaXplKClcbiAgICAgIGF3YWl0IHRoaXMuX2FwcGxpY2F0aW9uLnN0YXJ0SHR0cFNlcnZlcigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGxpY2F0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGVhY2ggbm9uLXRlbmFudCBwZXItdGVzdCBjb25uZWN0aW9uIGFzIGEgZHluYW1pYyBjYW5kaWRhdGUgZm9yIGluLXByb2Nlc3NcbiAgICogcmVxdWVzdCBzaGFyaW5nLiBUaGUgcG9vbCBldmFsdWF0ZXMgdHJhbnNhY3Rpb24gc3RhdGUgd2hlbiBlYWNoIHJlcXVlc3QgaXMgZGlzcGF0Y2hlZCxcbiAgICogc28gYSB0cmFuc2FjdGlvbiBzdGFydGVkIG9yIGVuZGVkIGR1cmluZyBhIGhvb2sgY2FsbGJhY2sgdGFrZXMgZWZmZWN0IGltbWVkaWF0ZWx5LlxuICAgKiBJbmFjdGl2ZSBhbmQgdGVuYW50LW9ubHkgY29ubmVjdGlvbnMgcmVtYWluIGluZGVwZW5kZW50bHkgcG9vbGVkLiBQYWlyIHdpdGhcbiAgICoge0BsaW5rIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zfSBpbiBhIGZpbmFsbHkuXG4gICAqIEByZXR1cm5zIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAtIExpZmVjeWNsZS1vd25lZCByZWdpc3RyYXRpb25zLlxuICAgKi9cbiAgYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnMoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb25zID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICAgIC8qKiBAdHlwZSB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gKi9cbiAgICBjb25zdCByZWdpc3RyYXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhjdXJyZW50Q29ubmVjdGlvbnMpKSB7XG4gICAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgLy8gVGVuYW50LXNjb3BlZCBwb29scyByZXNvbHZlIGEgZGlmZmVyZW50IGNvbm5lY3Rpb24gcGVyIHJlcXVlc3QgdGVuYW50XG4gICAgICAvLyAodmlhIHJ1bldpdGhUZW5hbnQpLCBzbyBmb3JjaW5nIGEgc2luZ2xlIHNoYXJlZCBjb25uZWN0aW9uIHdvdWxkIGJyZWFrXG4gICAgICAvLyBwZXItcmVxdWVzdCB0ZW5hbnQgcmVzb2x1dGlvbi4gT25seSBzaGFyZSBub24tdGVuYW50IHBvb2xzOyB0aGUgdGVuYW50XG4gICAgICAvLyBwb29sIGtlZXBzIHJlc29sdmluZyBpdHMgb3duIGNvbm5lY3Rpb24gcGVyIHJlcXVlc3QuXG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uKCkudGVuYW50T25seSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gY3VycmVudENvbm5lY3Rpb25zW2lkZW50aWZpZXJdXG5cbiAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHBvb2wuc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcigoKSA9PiB7XG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkgPyBjb25uZWN0aW9uIDogdW5kZWZpbmVkXG4gICAgICB9KVxuXG4gICAgICBpZiAocmVnaXN0cmF0aW9uKSByZWdpc3RyYXRpb25zLnB1c2goe3Bvb2wsIHJlZ2lzdHJhdGlvbn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIGluLXByb2Nlc3MgdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBvbiBldmVyeSBjb25maWd1cmVkIHBvb2wuIElkZW1wb3RlbnQgYW5kXG4gICAqIHNhZmUgdG8gY2FsbCB3aGVuIG5vbmUgd2FzIHNldC5cbiAgICogQHBhcmFtIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSBbcmVnaXN0cmF0aW9uc10gLSBMaWZlY3ljbGUtb3duZWQgcmVnaXN0cmF0aW9ucyB0byBjbGVhciBjb25kaXRpb25hbGx5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBpZiAocmVnaXN0cmF0aW9ucykge1xuICAgICAgZm9yIChjb25zdCB7cG9vbCwgcmVnaXN0cmF0aW9ufSBvZiByZWdpc3RyYXRpb25zKSB7XG4gICAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBvdXQgYW5kIHJlZ2lzdGVycyBvbmUgcGh5c2ljYWwgdGVuYW50IHRyYW5zYWN0aW9uIGZvciB0aGUgY3VycmVudCBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgdGVuYW50OiBvYmplY3R9fSBhcmdzIC0gTG9naWNhbCBpZGVudGlmaWVyIGFuZCB0ZW5hbnQgZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBDdXJyZW50IGF0dGVtcHQgcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQoe2RhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50LCAuLi5yZXN0QXJnc30sIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIXRlbmFudCkgdGhyb3cgbmV3IEVycm9yKFwicmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgdGVuYW50XCIpXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi50ZW5hbnRPbmx5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIHRlbmFudE9ubHkgZGF0YWJhc2U6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuICAgIGNvbnN0IHJldXNlS2V5ID0gcG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGlmIChyZWdpc3RyYXRpb25zLnNvbWUoKHJlZ2lzdHJhdGlvbikgPT4gcmVnaXN0cmF0aW9uLnBvb2wgPT09IHBvb2wgJiYgcmVnaXN0cmF0aW9uLnJldXNlS2V5ID09PSByZXVzZUtleSkpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ufSAqL1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtcbiAgICAgIGNvbm5lY3Rpb246IHVuZGVmaW5lZCxcbiAgICAgIHBvb2wsXG4gICAgICByZXVzZUtleSxcbiAgICAgIHJldm9rZWQ6IGZhbHNlLFxuICAgICAgc2hhcmVkUmVnaXN0cmF0aW9uOiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZWdpc3RyYXRpb25zLnB1c2gocmVnaXN0cmF0aW9uKVxuICAgIHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2UgPSBwb29sXG4gICAgICAuY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwge25hbWU6IFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb25cIn0pXG4gICAgICAudGhlbihcbiAgICAgICAgKGNvbm5lY3Rpb24pID0+ICh7Y29ubmVjdGlvbiwgZXJyb3I6IHVuZGVmaW5lZH0pLFxuICAgICAgICAoZXJyb3IpID0+ICh7XG4gICAgICAgICAgY29ubmVjdGlvbjogdW5kZWZpbmVkLFxuICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCBjb25uZWN0aW9uIGNoZWNrb3V0IGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgfSlcbiAgICAgIClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjaGVja291dE91dGNvbWUgPSBhd2FpdCByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlXG5cbiAgICAgIGlmIChjaGVja291dE91dGNvbWUuZXJyb3IpIHRocm93IGNoZWNrb3V0T3V0Y29tZS5lcnJvclxuICAgICAgaWYgKCFjaGVja291dE91dGNvbWUuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgY29ubmVjdGlvbiBjaGVja291dCByZXR1cm5lZCBubyBjb25uZWN0aW9uXCIpXG4gICAgICByZWdpc3RyYXRpb24uY29ubmVjdGlvbiA9IGNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuXG4gICAgICBhd2FpdCByZWdpc3RyYXRpb24uY29ubmVjdGlvbi5zdGFydFRyYW5zYWN0aW9uKClcbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG5cbiAgICAgIGNvbnN0IHNoYXJlZFJlZ2lzdHJhdGlvbiA9IHBvb2wuc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Gb3JDb25maWd1cmF0aW9uKHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uLCByZXVzZUtleSlcbiAgICAgIGlmICghc2hhcmVkUmVnaXN0cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYERhdGFiYXNlIHBvb2wgZG9lcyBub3Qgc3VwcG9ydCB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25zOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgICAgcmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbiA9IHNoYXJlZFJlZ2lzdHJhdGlvblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB7XG4gICAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihzaGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZWdpc3RyYXRpb24ucmV2b2tlZCA9IHRydWVcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKFtyZWdpc3RyYXRpb25dLCB7ZGlzY2FyZDogcmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXAgPT09IHRydWV9KVxuICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbZXJyb3IsIGNsZWFudXBFcnJvcl0sIFwiRmFpbGVkIHRvIHJlZ2lzdGVyIGFuZCBjbGVhbiB1cCBhIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvblwiLCB7Y2F1c2U6IGNsZWFudXBFcnJvcn0pXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXZva2VzIGF0dGVtcHQgcmVnaXN0cmF0aW9ucyBiZWZvcmUgcm9sbGluZyBiYWNrIGFuZCByZWxlYXNpbmcgdGhlaXIgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQXR0ZW1wdCByZWdpc3RyYXRpb25zLlxuICAgKiBAcGFyYW0ge3tkaXNjYXJkPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIFdoZXRoZXIgY29ubmVjdGlvbnMgbXVzdCBiZSBkaXNjYXJkZWQgaW5zdGVhZCBvZiByZXR1cm5lZCB0byB0aGUgcG9vbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHMocmVnaXN0cmF0aW9ucywge2Rpc2NhcmQgPSBmYWxzZX0gPSB7fSkge1xuICAgIGZvciAoY29uc3QgcmVnaXN0cmF0aW9uIG9mIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5yZXZva2VkID0gdHJ1ZVxuICAgICAgaWYgKGRpc2NhcmQpIHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwID0gdHJ1ZVxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24pIHJlZ2lzdHJhdGlvbi5wb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbilcbiAgICB9XG4gICAgY29uc3QgY2xlYW51cFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgcmVnaXN0cmF0aW9uLmNsZWFudXBQcm9taXNlID8/PSB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbilcblxuICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvbi5jbGVhbnVwUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IGNsZWFudXBSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsZWFuIHVwIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvbnNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhbnMgb25lIGF0dGVtcHQgcmVnaXN0cmF0aW9uIGV4YWN0bHkgb25jZSwgaW5jbHVkaW5nIGEgY2hlY2tvdXQgdGhhdCB3YXMgc3RpbGwgcGVuZGluZyBhdCByZXZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb259IHJlZ2lzdHJhdGlvbiAtIEF0dGVtcHQtb3duZWQgcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByb2xsYmFjayBhbmQgcmVsZWFzZSBvciBxdWFyYW50aW5lLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgbGV0IGNvbm5lY3Rpb24gPSByZWdpc3RyYXRpb24uY29ubmVjdGlvblxuXG4gICAgaWYgKCFjb25uZWN0aW9uICYmIHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2UpIHtcbiAgICAgIGNvbnN0IGNoZWNrb3V0T3V0Y29tZSA9IGF3YWl0IHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2VcblxuICAgICAgaWYgKGNoZWNrb3V0T3V0Y29tZS5lcnJvcikgcmV0dXJuXG4gICAgICBjb25uZWN0aW9uID0gY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb25cbiAgICAgIHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uID0gY29ubmVjdGlvblxuICAgIH1cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIHRyeSB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBhd2FpdCBjb25uZWN0aW9uLnJvbGxiYWNrVHJhbnNhY3Rpb24oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwKSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLnBvb2wuZGlzY2FyZChjb25uZWN0aW9uKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5wb29sLmNoZWNraW4oY29ubmVjdGlvbilcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsZWFuIHVwIGEgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyB0aGUgY3VycmVudCBub24tdGVuYW50IGNvbm5lY3Rpb25zIGVsaWdpYmxlIGZvciBzaGFyZWQgdHJhbnNhY3Rpb24gd29yay5cbiAgICogQHBhcmFtIHt7dHJhbnNhY3Rpb25zT25seTogYm9vbGVhbn19IGFyZ3MgLSBTZWxlY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBFbGlnaWJsZSBjb25uZWN0aW9ucyBieSBpZGVudGlmaWVyLlxuICAgKi9cbiAgc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seX0pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbnMgPSBjb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoY3VycmVudENvbm5lY3Rpb25zKSkge1xuICAgICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb24oKS50ZW5hbnRPbmx5KSBjb250aW51ZVxuICAgICAgaWYgKHRyYW5zYWN0aW9uc09ubHkgJiYgIWNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSkgY29udGludWVcbiAgICAgIGNvbm5lY3Rpb25zW2lkZW50aWZpZXJdID0gY29ubmVjdGlvblxuICAgIH1cblxuICAgIHJldHVybiBjb25uZWN0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIHBoeXNpY2FsLWNvbm5lY3Rpb24gY29vcmRpbmF0aW9uIGJlZm9yZSBhIHRyYW5zYWN0aW9uLW9wZW5pbmcgaG9va1xuICAgKiBjYW4gZXhwb3NlIHRoZSBzaGFyZWQgY29ubmVjdGlvbiB0byBhIGxvbmctbGl2ZWQgaW4tcHJvY2VzcyBzZXJ2aWNlLlxuICAgKiBDaGlsZC1wcm9jZXNzIGNvb3JkaW5hdGVzIHJlbWFpbiB1bnB1Ymxpc2hlZCB1bnRpbCB0aGUgdHJhbnNhY3Rpb24gZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZD59IC0gUHJlcGFyZWQgY29vcmRpbmF0b3IuXG4gICAqL1xuICBhc3luYyBwcmVwYXJlU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IGZhbHNlfSlcblxuICAgIGlmIChPYmplY3Qua2V5cyhjb25uZWN0aW9ucykubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4ge1xuICAgICAgYnJva2VyOiBhd2FpdCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlci5zdGFydCh7Y29ubmVjdGlvbnN9KSxcbiAgICAgIGVudmlyb25tZW50UHVibGlzaGVkOiBmYWxzZSxcbiAgICAgIHByZXZpb3VzRW52aXJvbm1lbnQ6IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHByZXBhcmVkIGJyb2tlciBjb29yZGluYXRlcyBleGFjdGx5IHRoZSBzZWxlY3RlZCBwaHlzaWNhbCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gcmVnaXN0cmF0aW9uIC0gUHJlcGFyZWQgY29vcmRpbmF0b3IuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBjb25uZWN0aW9ucyAtIFNlbGVjdGVkIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBpZGVudGlmaWVyIHNldCBhbmQgcGh5c2ljYWwgY29ubmVjdGlvbnMgbWF0Y2ggZXhhY3RseS5cbiAgICovXG4gIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbiwgY29ubmVjdGlvbnMpIHtcbiAgICBjb25zdCBpZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKVxuXG4gICAgaWYgKCFyZWdpc3RyYXRpb24gfHwgaWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoT2JqZWN0LmtleXMocmVnaXN0cmF0aW9uLmJyb2tlci5jb25uZWN0aW9ucykubGVuZ3RoICE9PSBpZGVudGlmaWVycy5sZW5ndGgpIHJldHVybiBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoY29ubmVjdGlvbnMpKSB7XG4gICAgICBpZiAocmVnaXN0cmF0aW9uLmJyb2tlci5jb25uZWN0aW9uc1tpZGVudGlmaWVyXSAhPT0gY29ubmVjdGlvbikgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYSBjYXBhYmlsaXR5LXNjb3BlZCBicm9rZXIgZm9yIHRoZSBhY3RpdmUgbm9uLXRlbmFudCBwaHlzaWNhbFxuICAgKiB0cmFuc2FjdGlvbiBjb25uZWN0aW9ucy4gTm8gYnJva2VyL2VudiBpcyBpbnN0YWxsZWQgZm9yIHRydW5jYXRpb24tb25seSBvclxuICAgKiBvdGhlciB0cmFuc2FjdGlvbi1kaXNhYmxlZCBhdHRlbXB0cy5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbn0gW3ByZXBhcmVkUmVnaXN0cmF0aW9uXSAtIENvb3JkaW5hdG9yIHByZXBhcmVkIGJlZm9yZSBob29rcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IFtzZWxlY3RlZENvbm5lY3Rpb25zXSAtIFBvc3QtaG9vayBhY3RpdmUgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGFzeW5jIHN0YXJ0U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24sIHNlbGVjdGVkQ29ubmVjdGlvbnMpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHNlbGVjdGVkQ29ubmVjdGlvbnMgfHwgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5OiB0cnVlfSlcblxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyhjb25uZWN0aW9ucylcbiAgICBpZiAoZGF0YWJhc2VJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgcmV0dXJuIHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGxldCBicm9rZXJcblxuICAgIGlmIChwcmVwYXJlZFJlZ2lzdHJhdGlvbiAmJiB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHByZXBhcmVkUmVnaXN0cmF0aW9uLCBjb25uZWN0aW9ucykpIHtcbiAgICAgIGJyb2tlciA9IHByZXBhcmVkUmVnaXN0cmF0aW9uLmJyb2tlclxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgIGJyb2tlciA9IGF3YWl0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLnN0YXJ0KHtjb25uZWN0aW9uc30pXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNFbnZpcm9ubWVudCA9IHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXVxuICAgIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXSA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGFkZHJlc3M6IGJyb2tlci5hZGRyZXNzKCksXG4gICAgICBjYXBhYmlsaXR5OiBicm9rZXIuY2FwYWJpbGl0eSgpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIGV4cGVjdGVkOiB0cnVlXG4gICAgfSkpLnRvU3RyaW5nKFwiYmFzZTY0dXJsXCIpXG5cbiAgICByZXR1cm4ge2Jyb2tlciwgZW52aXJvbm1lbnRQdWJsaXNoZWQ6IHRydWUsIHByZXZpb3VzRW52aXJvbm1lbnR9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlcyBhbiBhdHRlbXB0IGJyb2tlciBiZWZvcmUgZGF0YWJhc2Ugcm9sbGJhY2sgaG9va3MgcnVuIGFuZCByZXN0b3Jlc1xuICAgKiB0aGUgY2FsbGVyJ3MgZW52aXJvbm1lbnQgc28gbGF0ZXIgcG9vbGVkL3NwYXduZWQgY2hpbGRyZW4gY2Fubm90IGluaGVyaXQgaXQuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHJlZ2lzdHJhdGlvbiAtIEF0dGVtcHQgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHJlZ2lzdHJhdGlvbikge1xuICAgIGlmICghcmVnaXN0cmF0aW9uKSByZXR1cm5cblxuICAgIGlmIChyZWdpc3RyYXRpb24uZW52aXJvbm1lbnRQdWJsaXNoZWQpIHtcbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucHJldmlvdXNFbnZpcm9ubWVudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXSA9IHJlZ2lzdHJhdGlvbi5wcmV2aW91c0Vudmlyb25tZW50XG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5icm9rZXIuY2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWVzdCBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlcXVlc3RDbGllbnQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlcXVlc3QgY2xpZW50LlxuICAgKi9cbiAgYXN5bmMgcmVxdWVzdENsaWVudCgpIHtcbiAgICBpZiAoIXRoaXMuX3JlcXVlc3RDbGllbnQpIHtcbiAgICAgIHRoaXMuX3JlcXVlc3RDbGllbnQgPSBuZXcgUmVxdWVzdENsaWVudCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlcXVlc3RDbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGltcG9ydCB0ZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW1wb3J0VGVzdEZpbGVzKCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSB7XG4gICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKHRoaXMuZ2V0VGVzdEZpbGVzKCkpXG4gICAgICBzeW5jaHJvbml6ZVRlc3RpbmdQYWNrYWdlVGVzdHModGVzdHMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRoaXMuZ2V0VGVzdEZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmVnaXN0cmF0aW9ucyA9IHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHModGVzdHMpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICB9LCB7ZmlsZVBhdGg6IHRlc3RGaWxlfSlcbiAgICAgIHN5bmNocm9uaXplVGVzdGluZ1BhY2thZ2VUZXN0cyh0ZXN0cylcbiAgICAgIHRoaXMuYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcCh0ZXN0cywgZXhpc3RpbmdSZWdpc3RyYXRpb25zLCB0ZXN0RmlsZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29sbGVjdHMgcmVnaXN0ZXJlZCBzY29wZSwgaG9vaywgYW5kIHRlc3Qgb2JqZWN0cyBieSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBzY29wZSAtIFRlc3Qgc2NvcGUuXG4gICAqIEBwYXJhbSB7U2V0PG9iamVjdD59IFtyZWdpc3RyYXRpb25zXSAtIEFjY3VtdWxhdGVkIGlkZW50aXRpZXMuXG4gICAqIEByZXR1cm5zIHtTZXQ8b2JqZWN0Pn0gLSBSZWdpc3RyYXRpb24gaWRlbnRpdGllcy5cbiAgICovXG4gIHRlc3RSZWdpc3RyYXRpb25PYmplY3RzKHNjb3BlLCByZWdpc3RyYXRpb25zID0gbmV3IFNldCgpKSB7XG4gICAgcmVnaXN0cmF0aW9ucy5hZGQoc2NvcGUpXG5cbiAgICBmb3IgKGNvbnN0IGhvb2sgb2YgWy4uLnNjb3BlLmJlZm9yZUFsbHMsIC4uLnNjb3BlLmJlZm9yZUVhY2hlcywgLi4uc2NvcGUuYWZ0ZXJFYWNoZXMsIC4uLnNjb3BlLmFmdGVyQWxsc10pIHtcbiAgICAgIHJlZ2lzdHJhdGlvbnMuYWRkKGhvb2spXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0ZXN0RGF0YSBvZiBPYmplY3QudmFsdWVzKHNjb3BlLnRlc3RzKSkgcmVnaXN0cmF0aW9ucy5hZGQodGVzdERhdGEpXG4gICAgZm9yIChjb25zdCBjaGlsZFNjb3BlIG9mIE9iamVjdC52YWx1ZXMoc2NvcGUuc3VicykpIHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMoY2hpbGRTY29wZSwgcmVnaXN0cmF0aW9ucylcblxuICAgIHJldHVybiByZWdpc3RyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBkZXRlcm1pbmlzdGljIG93bmVyc2hpcCB0byByZWdpc3RyYXRpb25zIGFkZGVkIGJ5IG9uZSBlbnRyeSBmaWxlLFxuICAgKiBpbmNsdWRpbmcgZGVjbGFyYXRpb25zIG9yaWdpbmF0aW5nIGluIGEgaGVscGVyIGltcG9ydGVkIGJ5IHRoYXQgZW50cnkgZmlsZS5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBzY29wZSAtIFRlc3Qgc2NvcGUuXG4gICAqIEBwYXJhbSB7U2V0PG9iamVjdD59IHByZXZpb3VzUmVnaXN0cmF0aW9ucyAtIElkZW50aXRpZXMgcHJlc2VudCBiZWZvcmUgaW1wb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3duZXJGaWxlUGF0aCAtIEltcG9ydGluZyBlbnRyeSBmaWxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAoc2NvcGUsIHByZXZpb3VzUmVnaXN0cmF0aW9ucywgb3duZXJGaWxlUGF0aCkge1xuICAgIGlmICghcHJldmlvdXNSZWdpc3RyYXRpb25zLmhhcyhzY29wZSkpIHNjb3BlLm93bmVyRmlsZVBhdGggPz89IG93bmVyRmlsZVBhdGhcblxuICAgIGZvciAoY29uc3QgaG9vayBvZiBbLi4uc2NvcGUuYmVmb3JlQWxscywgLi4uc2NvcGUuYmVmb3JlRWFjaGVzLCAuLi5zY29wZS5hZnRlckVhY2hlcywgLi4uc2NvcGUuYWZ0ZXJBbGxzXSkge1xuICAgICAgaWYgKCFwcmV2aW91c1JlZ2lzdHJhdGlvbnMuaGFzKGhvb2spKSBob29rLm93bmVyRmlsZVBhdGggPz89IG93bmVyRmlsZVBhdGhcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHRlc3REYXRhIG9mIE9iamVjdC52YWx1ZXMoc2NvcGUudGVzdHMpKSB7XG4gICAgICBpZiAoIXByZXZpb3VzUmVnaXN0cmF0aW9ucy5oYXModGVzdERhdGEpKSB0ZXN0RGF0YS5vd25lckZpbGVQYXRoID8/PSBvd25lckZpbGVQYXRoXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjaGlsZFNjb3BlIG9mIE9iamVjdC52YWx1ZXMoc2NvcGUuc3VicykpIHtcbiAgICAgIHRoaXMuYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcChjaGlsZFNjb3BlLCBwcmV2aW91c1JlZ2lzdHJhdGlvbnMsIG93bmVyRmlsZVBhdGgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZmFpbGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGZhaWxlZC5cbiAgICovXG4gIGlzRmFpbGVkKCkgeyByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdHMgIT09IHVuZGVmaW5lZCAmJiB0aGlzLl9mYWlsZWRUZXN0cyA+IDAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGZhaWxlZCB0ZXN0cy5cbiAgICovXG4gIGdldEZhaWxlZFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9mYWlsZWRUZXN0cyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdCBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7RmFpbGVkVGVzdERldGFpbFtdfSAtIEZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0RGV0YWlscygpIHtcbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdERldGFpbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3QgZmFpbGVkIHRlc3QgY29uc29sZSBvdXRwdXRzIHRvIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYXNzZXRzUGF0aF0gLSBBc3NldHMgZGlyZWN0b3J5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBXcml0dGVuIGxvZyBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdEZhaWxlZFRlc3RDb25zb2xlT3V0cHV0c1RvQXNzZXRzKHthc3NldHNQYXRoID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksIFwidG1wL3NjcmVlbnNob3RzXCIpfSA9IHt9KSB7XG4gICAgY29uc3QgZmFpbGVkVGVzdERldGFpbHMgPSB0aGlzLmdldEZhaWxlZFRlc3REZXRhaWxzKClcbiAgICBjb25zdCB3cml0dGVuTG9nUGF0aHMgPSBbXVxuICAgIGxldCBjcmVhdGVkRGlyZWN0b3J5ID0gZmFsc2VcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBmYWlsZWRUZXN0RGV0YWlscy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGNvbnN0IGZhaWxlZFRlc3REZXRhaWwgPSBmYWlsZWRUZXN0RGV0YWlsc1tpbmRleF1cbiAgICAgIGNvbnN0IGNvbnNvbGVPdXRwdXQgPSBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVPdXRwdXRcblxuICAgICAgaWYgKCFjb25zb2xlT3V0cHV0KSBjb250aW51ZVxuXG4gICAgICBpZiAoIWNyZWF0ZWREaXJlY3RvcnkpIHtcbiAgICAgICAgYXdhaXQgZnMubWtkaXIoYXNzZXRzUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgICAgIGNyZWF0ZWREaXJlY3RvcnkgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IFtcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRGdWxsWWVhcigpKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldERhdGUoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldEhvdXJzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaW51dGVzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRTZWNvbmRzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaWxsaXNlY29uZHMoKSkucGFkU3RhcnQoMywgXCIwXCIpXG4gICAgICBdLmpvaW4oXCJcIilcbiAgICAgIGNvbnN0IHNsdWcgPSB0b0ZpbGVTbHVnKGZhaWxlZFRlc3REZXRhaWwuZnVsbERlc2NyaXB0aW9uKVxuICAgICAgY29uc3QgZmlsZU5hbWUgPSBgJHt0aW1lc3RhbXB9LSR7U3RyaW5nKGluZGV4ICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpfS0ke3NsdWd9LmNvbnNvbGUubG9nYFxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oYXNzZXRzUGF0aCwgZmlsZU5hbWUpXG5cbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgY29uc29sZU91dHB1dCwgXCJ1dGY4XCIpXG4gICAgICBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVMb2dQYXRoID0gZmlsZVBhdGhcbiAgICAgIHdyaXR0ZW5Mb2dQYXRocy5wdXNoKGZpbGVQYXRoKVxuICAgIH1cblxuICAgIHJldHVybiB3cml0dGVuTG9nUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKi9cbiAgZ2V0U3VjY2Vzc2Z1bFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldFRlc3RzQ291bnQoKSB7XG4gICAgaWYgKHRoaXMuX3Rlc3RzQ291bnQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RzQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZXhlY3V0ZWQgdGVzdHMgY291bnQuXG4gICAqL1xuICBnZXRFeGVjdXRlZFRlc3RzQ291bnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3Rlc3REdXJhdGlvbnMubGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdGVzdHMgcmVjb3JkZWQgZHVyaW5nIHRoZSBydW4sIHNsb3dlc3QgZmlyc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbGltaXRdIC0gTWF4aW11bSBudW1iZXIgb2YgdGVzdHMgdG8gcmV0dXJuICgwIHJldHVybnMgYWxsKS5cbiAgICogQHJldHVybnMge0FycmF5PHtmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyLCBkdXJhdGlvbk1zOiBudW1iZXJ9Pn0gLSBTbG93ZXN0IHRlc3RzLCBzbG93ZXN0IGZpcnN0LlxuICAgKi9cbiAgZ2V0U2xvd2VzdFRlc3RzKGxpbWl0ID0gMTApIHtcbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4udGhpcy5fdGVzdER1cmF0aW9uc10uc29ydCgodGVzdEEsIHRlc3RCKSA9PiB0ZXN0Qi5kdXJhdGlvbk1zIC0gdGVzdEEuZHVyYXRpb25NcylcblxuICAgIHJldHVybiBsaW1pdCA+IDAgPyBzb3J0ZWQuc2xpY2UoMCwgbGltaXQpIDogc29ydGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZSgpIHtcbiAgICB0aGlzLmFueVRlc3RzRm9jdXNzZWQgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gMFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICB0aGlzLl90ZXN0RHVyYXRpb25zID0gW11cbiAgICBjb25zdCB0ZXN0aW5nQ29uZmlnUGF0aCA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldFRlc3RpbmcoKVxuXG4gICAgaWYgKHRlc3RpbmdDb25maWdQYXRoKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blByb2ZpbGVTcGFuKHtwaGFzZTogXCJ0ZXN0aW5nIGNvbmZpZy9nbG9iYWwgc2V0dXBcIn0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW1wb3J0VGVzdGluZ0NvbmZpZ1BhdGgoKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmltcG9ydFRlc3RGaWxlcygpXG4gICAgYXdhaXQgdGhpcy5hbmFseXplVGVzdHModGVzdHMpXG4gICAgdGhpcy5fb25seUZvY3Vzc2VkID0gdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcmUgYW55IHRlc3RzIGZvY3Vzc2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFueSB0ZXN0cyBmb2N1c3NlZC5cbiAgICovXG4gIGFyZUFueVRlc3RzRm9jdXNzZWQoKSB7XG4gICAgaWYgKHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJIYXNuJ3QgYmVlbiBkZXRlY3RlZCB5ZXRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICAvKipcbiAgICogUmVjb3JkcyBhbiBhc3luY2hyb25vdXMgY3Jhc2ggKGFuIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbiBkZXRhY2hlZCBmcm9tXG4gICAqIGFueSBhd2FpdCwgZS5nLiBhIGB2b2lkIGNvbm5lY3Rpb24uYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4gYnJvYWRjYXN0KC4uLikpYFxuICAgKiBmcm9udGVuZC1tb2RlbCBwdWJsaXNoIOKAlCBvciBhIHN5bmNocm9ub3VzIHRocm93IGluc2lkZSBhIGRldGFjaGVkIGNhbGxiYWNrXG4gICAqIHN1Y2ggYXMgYSBkcml2ZXIgc29ja2V0IG9yIHRpbWVyIGNhbGxiYWNrKSBhcyBhIHJlYWwsIHZpc2libGUsIGF0dHJpYnV0ZWRcbiAgICogdGVzdCBmYWlsdXJlLlxuICAgKlxuICAgKiBXaXRob3V0IHRoaXMsIHN1Y2ggYSByZWplY3Rpb24vZXhjZXB0aW9uIGhhcyBubyBoYW5kbGVyLCBzbyBvbiBtb2Rlcm4gTm9kZVxuICAgKiB0aGUgcHJvY2VzcyBpcyBURVJNSU5BVEVEIOKAlCB0aGUgcnVuIGVuZHMgd2l0aCBubyByZXBvcnRlZCBmYWlsdXJlcyBhbmQgQ0lcbiAgICoganVzdCBzZWVzIGEgY3Jhc2hlZC9yZXRyaWVkIHNoYXJkIHdpdGggYW4gZW1wdHkgcmVzdWx0ICh0aGUgcmVjdXJyaW5nXG4gICAqIFwic2lsZW50IHRlc3QtcnVubmVyIGRlYXRoXCI6IGludmlzaWJsZSBhbmQgaW1wb3NzaWJsZSB0byBkaWFnbm9zZSkuIFR1cm5pbmdcbiAgICogaXQgaW50byBhIGZhaWx1cmUgbWFrZXMgdGhlIHJ1biBnbyByZWQgd2l0aCBzb21ldGhpbmcgZGVidWdnYWJsZSBpbnN0ZWFkIG9mXG4gICAqIHZhbmlzaGluZy5cbiAgICogQHBhcmFtIHtcInVuY2F1Z2h0RXhjZXB0aW9uXCIgfCBcInVuaGFuZGxlZFJlamVjdGlvblwifSBraW5kIC0gQXN5bmMtY3Jhc2gga2luZC5cbiAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBSZWplY3Rpb24gcmVhc29uIG9yIHRocm93biBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRBc3luY0NyYXNoKGtpbmQsIHJlYXNvbikge1xuICAgIGNvbnN0IGVycm9yID0gcmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyByZWFzb24gOiBuZXcgRXJyb3IoYCR7a2luZH06ICR7U3RyaW5nKHJlYXNvbil9YClcbiAgICBjb25zdCBuZWFyID0gdGhpcy5fbGFzdFRlc3RDb250ZXh0XG4gICAgY29uc3QgYXR0cmlidXRpb24gPSBuZWFyID8gYCwgbmVhciB0ZXN0OiAke25lYXIuZnVsbERlc2NyaXB0aW9ufSAoJHtuZWFyLmZpbGVQYXRofToke25lYXIubGluZX0pYCA6IFwiXCJcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gKHRoaXMuX2ZhaWxlZFRlc3RzIHx8IDApICsgMVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiBgPCR7a2luZH0gZHVyaW5nIHRlc3QgcnVuJHthdHRyaWJ1dGlvbn0+YCxcbiAgICAgIGZpbGVQYXRoOiBuZWFyID8gbmVhci5maWxlUGF0aCA6IFwiPHRlc3QgcnVubmVyPlwiLFxuICAgICAgbGluZTogbmVhciA/IG5lYXIubGluZSA6IDAsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5bdGVzdC1ydW5uZXJdICR7a2luZH0gZHVyaW5nIHRoZSB0ZXN0IHJ1biDigJQgdGhpcyB3b3VsZCBvdGhlcndpc2UgdGVybWluYXRlIHRoZSBwcm9jZXNzIHNpbGVudGx5IGFuZCBzdXJmYWNlIG9ubHkgYXMgYSBjcmFzaGVkL3JldHJpZWQgc2hhcmQgd2l0aCB6ZXJvIHJlcG9ydGVkIGZhaWx1cmVzLiR7YXR0cmlidXRpb259YCkpXG4gICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgY2xlYW51cCBmYWlsdXJlIGFmdGVyIHRpbWVvdXQgaGFuZGxpbmcgaGFzIGJlZ3VuLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIERldGFjaGVkIGNsZWFudXAgcmVqZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2xlYW51cE5hbWUgLSBDbGVhbnVwIG9wZXJhdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge1NldDxFcnJvcj59IFtyZWNvcmRlZEVycm9yc10gLSBBdHRlbXB0LW93bmVkIGNsZWFudXAgZXJyb3JzIGFscmVhZHkgcmVwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKHJlYXNvbiwgY2xlYW51cE5hbWUsIHJlY29yZGVkRXJyb3JzKSB7XG4gICAgY29uc3QgZXJyb3IgPSByZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHJlYXNvbiA6IG5ldyBFcnJvcihgJHtjbGVhbnVwTmFtZX0gY2xlYW51cCBmYWlsZWQ6ICR7U3RyaW5nKHJlYXNvbil9YClcblxuICAgIGlmIChyZWNvcmRlZEVycm9ycykge1xuICAgICAgLy8gTXVsdGlwbGUgYm91bmRlZCBvYnNlcnZlcnMgY2FuIHJlY2VpdmUgdGhlIHNhbWUgZGV0YWNoZWQgY2xlYW51cCByZWplY3Rpb24uXG4gICAgICBpZiAocmVjb3JkZWRFcnJvcnMuaGFzKGVycm9yKSkgcmV0dXJuXG4gICAgICByZWNvcmRlZEVycm9ycy5hZGQoZXJyb3IpXG4gICAgfVxuXG4gICAgY29uc3QgbmVhciA9IHRoaXMuX2xhc3RUZXN0Q29udGV4dFxuICAgIGNvbnN0IGF0dHJpYnV0aW9uID0gbmVhciA/IGAsIG5lYXIgdGVzdDogJHtuZWFyLmZ1bGxEZXNjcmlwdGlvbn0gKCR7bmVhci5maWxlUGF0aH06JHtuZWFyLmxpbmV9KWAgOiBcIlwiXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9ICh0aGlzLl9mYWlsZWRUZXN0cyB8fCAwKSArIDFcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogYDwke2NsZWFudXBOYW1lfSBlbWVyZ2VuY3kgY2xlYW51cCBmYWlsdXJlJHthdHRyaWJ1dGlvbn0+YCxcbiAgICAgIGZpbGVQYXRoOiBuZWFyID8gbmVhci5maWxlUGF0aCA6IFwiPHRlc3QgcnVubmVyPlwiLFxuICAgICAgbGluZTogbmVhciA/IG5lYXIubGluZSA6IDAsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGBcXG5bdGVzdC1ydW5uZXJdICR7Y2xlYW51cE5hbWV9IGNsZWFudXAgZmFpbGVkIGFmdGVyIHRpbWVvdXQgaGFuZGxpbmcgYmVnYW4uJHthdHRyaWJ1dGlvbn1gKSlcbiAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICB9XG5cbiAgYXN5bmMgcnVuKCkge1xuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBwcm9jZXNzLWxldmVsIHVuaGFuZGxlZCByZWplY3Rpb24gZHVyaW5nIHRoZSBydW4uXG4gICAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBSZWplY3Rpb24gcmVhc29uLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIGNvbnN0IG9uVW5oYW5kbGVkUmVqZWN0aW9uID0gKHJlYXNvbikgPT4ge1xuICAgICAgLy8gSWYgYSB0ZXN0IGF0dGFjaGVkIGl0cyBPV04gdW5oYW5kbGVkUmVqZWN0aW9uIGxpc3RlbmVyLCBpdCBpc1xuICAgICAgLy8gaW50ZW50aW9uYWxseSBvYnNlcnZpbmcvdHJpZ2dlcmluZyB0aGUgcmVqZWN0aW9uIChlLmcuIGJlYWNvblxuICAgICAgLy8gZXJyb3ItcmVwb3J0aW5nLXNwZWMuanMpIOKAlCBOb2RlIGRpc3BhdGNoZXMgdG8gRVZFUlkgbGlzdGVuZXIsIHNvIGFsc29cbiAgICAgIC8vIGZhaWxpbmcgdGhlIHN1aXRlIGhlcmUgd291bGQgYnJlYWsgdGhvc2UgdGVzdHMuIERlZmVyIHRvIHRoZSB0ZXN0J3NcbiAgICAgIC8vIGhhbmRsZXI7IG9ubHkgdHJlYXQgYSByZWplY3Rpb24gYXMgYSBzaWxlbnQtZGVhdGggY3Jhc2ggd2hlbiBvdXJzIGlzIHRoZVxuICAgICAgLy8gc29sZSBsaXN0ZW5lciAobm8gcGVyc2lzdGVudCBmcmFtZXdvcmsgbGlzdGVuZXIgZXhpc3RzIHRvIG1hc2sgdGhpcykuXG4gICAgICBpZiAocHJvY2Vzcy5saXN0ZW5lckNvdW50KFwidW5oYW5kbGVkUmVqZWN0aW9uXCIpID4gMSkgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVjb3JkQXN5bmNDcmFzaChcInVuaGFuZGxlZFJlamVjdGlvblwiLCByZWFzb24pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIHByb2Nlc3MtbGV2ZWwgdW5jYXVnaHQgZXhjZXB0aW9uIGR1cmluZyB0aGUgcnVuIOKAlCBhXG4gICAgICogc3luY2hyb25vdXMgdGhyb3cgaW5zaWRlIGEgZGV0YWNoZWQgY2FsbGJhY2sgKGRyaXZlciBzb2NrZXQsIHRpbWVyLFxuICAgICAqIGV2ZW50IGVtaXR0ZXIpIHRoYXQgbm8gdGVzdCBhd2FpdCBvYnNlcnZlcy4gU2FtZSBzaWxlbnQtZGVhdGggbW9kZSBhc1xuICAgICAqIHVuaGFuZGxlZCByZWplY3Rpb25zOiB3aXRob3V0IGEgaGFuZGxlciB0aGUgcHJvY2VzcyBkaWVzIG1pZC1ydW4gYW5kIENJXG4gICAgICogc2VlcyBhIGNyYXNoZWQgc2hhcmQgd2l0aCB6ZXJvIHJlcG9ydGVkIGZhaWx1cmVzLlxuICAgICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBUaHJvd24gZXJyb3IuXG4gICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICovXG4gICAgY29uc3Qgb25VbmNhdWdodEV4Y2VwdGlvbiA9IChlcnJvcikgPT4ge1xuICAgICAgLy8gTWlycm9yIHRoZSB1bmhhbmRsZWRSZWplY3Rpb24gZGVmZXJyYWw6IGEgdGVzdCBvYnNlcnZpbmcvdHJpZ2dlcmluZ1xuICAgICAgLy8gdW5jYXVnaHQgZXhjZXB0aW9ucyB3aXRoIGl0cyBvd24gbGlzdGVuZXIgb3ducyB0aGVtLlxuICAgICAgaWYgKHByb2Nlc3MubGlzdGVuZXJDb3VudChcInVuY2F1Z2h0RXhjZXB0aW9uXCIpID4gMSkgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVjb3JkQXN5bmNDcmFzaChcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIGVycm9yKVxuICAgIH1cblxuICAgIHByb2Nlc3Mub24oXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgb25VbmhhbmRsZWRSZWplY3Rpb24pXG4gICAgcHJvY2Vzcy5vbihcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIG9uVW5jYXVnaHRFeGNlcHRpb24pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5UZXN0cyh7XG4gICAgICAgIGFmdGVyRWFjaGVzOiBbXSxcbiAgICAgICAgYmVmb3JlRWFjaGVzOiBbXSxcbiAgICAgICAgdGVzdHMsXG4gICAgICAgIGRlc2NyaXB0aW9uczogW10sXG4gICAgICAgIGluZGVudExldmVsOiAwXG4gICAgICB9KVxuXG4gICAgICAvLyBBIHJlamVjdGlvbiBzY2hlZHVsZWQgYnkgdGhlIGZpbmFsIHRlc3QgKGEgZGV0YWNoZWQgcmVqZWN0ZWQgcHJvbWlzZSxcbiAgICAgIC8vIG9yIGFuIGFmdGVyQ29tbWl0IGNhbGxiYWNrIHJlamVjdGluZyBhcyB0aGUgc3VpdGUgZHJhaW5zKSBpcyByZXBvcnRlZFxuICAgICAgLy8gYnkgTm9kZSBvbiBhIExBVEVSIHR1cm4uIERyYWluIGEgZmV3IHR1cm5zIHdoaWxlIHRoZSBoYW5kbGVyIGlzIHN0aWxsXG4gICAgICAvLyBhdHRhY2hlZCBzbyB0aG9zZSBsYXRlIHJlamVjdGlvbnMgYXJlIHJlY29yZGVkIGluc3RlYWQgb2YgZXNjYXBpbmcgdG9cbiAgICAgIC8vIHRoZSBkZWZhdWx0IGNyYXNoIHBhdGggYWZ0ZXIgY2xlYW51cC5cbiAgICAgIGZvciAobGV0IGRyYWluVHVybiA9IDA7IGRyYWluVHVybiA8IDM7IGRyYWluVHVybisrKSB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRJbW1lZGlhdGUocmVzb2x2ZSkpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHByb2Nlc3Mub2ZmKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIG9uVW5oYW5kbGVkUmVqZWN0aW9uKVxuICAgICAgcHJvY2Vzcy5vZmYoXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBvblVuY2F1Z2h0RXhjZXB0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBhZnRlciBhbGxzIGZvciBhY3RpdmUgc2NvcGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgaG9va3MgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJBbGxzRm9yQWN0aXZlU2NvcGVzKCkge1xuICAgIGNvbnN0IHNjb3BlcyA9IFsuLi50aGlzLl9hY3RpdmVBZnRlckFsbFNjb3Blc10ucmV2ZXJzZSgpXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgYWZ0ZXJBbGxFcnJvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzY29wZSBvZiBzY29wZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuQWZ0ZXJBbGxzRm9yU2NvcGUoc2NvcGUpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBhZnRlckFsbEVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2FjdGl2ZUFmdGVyQWxsU2NvcGVzID0gW11cblxuICAgIGlmIChhZnRlckFsbEVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgYWZ0ZXJBbGxFcnJvcnNbMF1cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGFmdGVyQWxsRXJyb3JzLCBcIk11bHRpcGxlIGFjdGl2ZSBhZnRlckFsbCBzY29wZXMgZmFpbGVkXCIsIHtjYXVzZTogYWZ0ZXJBbGxFcnJvcnNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuYWx5emUgdGVzdHMuXG4gICAqIEBwYXJhbSB7VGVzdHNBcmd1bWVudH0gdGVzdHMgLSBUZXN0cy5cbiAgICogQHJldHVybnMge3thbnlUZXN0c0ZvY3Vzc2VkOiBib29sZWFufX0gLSBXaGV0aGVyIGFueSB0ZXN0cyBpbiB0aGUgdHJlZSBhcmUgZm9jdXNlZC5cbiAgICovXG4gIGFuYWx5emVUZXN0cyh0ZXN0cykge1xuICAgIGxldCBhbnlUZXN0c0ZvY3Vzc2VkRm91bmQgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCB0ZXN0RGVzY3JpcHRpb24gaW4gdGVzdHMudGVzdHMpIHtcbiAgICAgIGNvbnN0IHRlc3REYXRhID0gdGVzdHMudGVzdHNbdGVzdERlc2NyaXB0aW9uXVxuICAgICAgY29uc3QgdGVzdEFyZ3MgPSBPYmplY3QuYXNzaWduKHt9LCB0ZXN0RGF0YS5hcmdzKVxuXG4gICAgICB0aGlzLl90ZXN0c0NvdW50KytcblxuICAgICAgaWYgKHRlc3RBcmdzLmZvY3VzKSB7XG4gICAgICAgIGFueVRlc3RzRm9jdXNzZWRGb3VuZCA9IHRydWVcbiAgICAgICAgdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3ViRGVzY3JpcHRpb24gaW4gdGVzdHMuc3Vicykge1xuICAgICAgY29uc3Qgc3ViVGVzdCA9IHRlc3RzLnN1YnNbc3ViRGVzY3JpcHRpb25dXG4gICAgICBjb25zdCB7YW55VGVzdHNGb2N1c3NlZH0gPSB0aGlzLmFuYWx5emVUZXN0cyhzdWJUZXN0KVxuXG4gICAgICBpZiAoYW55VGVzdHNGb2N1c3NlZCkge1xuICAgICAgICBhbnlUZXN0c0ZvY3Vzc2VkRm91bmQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIHN1YlRlc3QuYW55VGVzdHNGb2N1c3NlZCA9IGFueVRlc3RzRm9jdXNzZWRcbiAgICB9XG5cbiAgICByZXR1cm4ge2FueVRlc3RzRm9jdXNzZWQ6IGFueVRlc3RzRm9jdXNzZWRGb3VuZH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZXJ5IGFmdGVyLWVhY2ggaG9vayB3aGlsZSBwcmVzZXJ2aW5nIHRoZSBmaXJzdCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEhvb2sgZXhlY3V0aW9uIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYXJncy5hZnRlckVhY2hlcyAtIEhvb2tzIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gYXJncy50ZXN0QXJncyAtIEN1cnJlbnQgdGVzdCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBDdXJyZW50IHRlc3QgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgaG9vayBydW5zLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJFYWNoZXMoe2FmdGVyRWFjaGVzLCB0ZXN0QXJncywgdGVzdERhdGF9KSB7XG4gICAgYXdhaXQgdGhpcy5fYXR0ZW1wdEV4ZWN1dG9yLnJ1bkFmdGVyRWFjaGVzKHthZnRlckVhY2hlcywgdGVzdEFyZ3MsIHRlc3REYXRhfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB0ZXN0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtBcnJheTxBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGU+fSBhcmdzLmFmdGVyRWFjaGVzIC0gQWZ0ZXIgZWFjaGVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZT59IGFyZ3MuYmVmb3JlRWFjaGVzIC0gQmVmb3JlIGVhY2hlcy5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBhcmdzLnRlc3RzIC0gVGVzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5pbmRlbnRMZXZlbCAtIEluZGVudCBsZXZlbC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5saW5lTWF0Y2hlZEluU2NvcGVdIC0gV2hldGhlciBsaW5lIG1hdGNoZWQgaW4gc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wYXJlbnRQcm9maWxlU2NvcGVJZF0gLSBQYXJlbnQgcHJvZmlsZSBzY29wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1blRlc3RzKHthZnRlckVhY2hlcywgYmVmb3JlRWFjaGVzLCB0ZXN0cywgZGVzY3JpcHRpb25zLCBpbmRlbnRMZXZlbCwgbGluZU1hdGNoZWRJblNjb3BlID0gZmFsc2UsIHBhcmVudFByb2ZpbGVTY29wZUlkfSkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBlbnZpcm9ubWVudEhhbmRsZXIuaW5zdGFsbFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UodGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSlcbiAgICBlbnZpcm9ubWVudEhhbmRsZXIuaW5zdGFsbFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSh0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UpXG4gICAgY29uc3QgbGVmdFBhZGRpbmcgPSBcIiBcIi5yZXBlYXQoaW5kZW50TGV2ZWwgKiAyKVxuICAgIGNvbnN0IHNjb3BlT3duZXJGaWxlUGF0aCA9IHRlc3RzLm93bmVyRmlsZVBhdGggPz8gdGVzdHMuZmlsZVBhdGhcbiAgICBjb25zdCBwcm9maWxlU2NvcGVJZCA9IHRoaXMuX3Byb2ZpbGVyPy5zY29wZUlkKHRlc3RzLCB7XG4gICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICBmaWxlUGF0aDogc2NvcGVPd25lckZpbGVQYXRoLFxuICAgICAgbGluZTogdGVzdHMubGluZSxcbiAgICAgIHBhcmVudElkOiBwYXJlbnRQcm9maWxlU2NvcGVJZFxuICAgIH0pXG4gICAgY29uc3Qgb3duQWZ0ZXJFYWNoZXMgPSBbLi4udGhpcy5wcm9maWxlSG9va0VudHJpZXModGVzdHMuYWZ0ZXJFYWNoZXMsIHByb2ZpbGVTY29wZUlkLCBzY29wZU93bmVyRmlsZVBhdGgpXS5yZXZlcnNlKClcbiAgICBjb25zdCBvd25CZWZvcmVFYWNoZXMgPSB0aGlzLnByb2ZpbGVIb29rRW50cmllcyh0ZXN0cy5iZWZvcmVFYWNoZXMsIHByb2ZpbGVTY29wZUlkLCBzY29wZU93bmVyRmlsZVBhdGgpXG4gICAgY29uc3QgbmV3QWZ0ZXJFYWNoZXMgPSBbLi4ub3duQWZ0ZXJFYWNoZXMsIC4uLmFmdGVyRWFjaGVzXVxuICAgIGNvbnN0IG5ld0JlZm9yZUVhY2hlcyA9IFsuLi5iZWZvcmVFYWNoZXMsIC4uLm93bkJlZm9yZUVhY2hlc11cbiAgICBjb25zdCBzY29wZUxpbmVNYXRjaCA9IGxpbmVNYXRjaGVkSW5TY29wZSB8fCB0aGlzLm1hdGNoZXNMaW5lRmlsdGVyKHRlc3RzKVxuICAgIGNvbnN0IHNob3VsZFJ1bkFueVRlc3RzID0gdGhpcy5oYXNSdW5uYWJsZVRlc3RzKHRlc3RzLCBkZXNjcmlwdGlvbnMsIHNjb3BlTGluZU1hdGNoKVxuXG4gICAgaWYgKCFzaG91bGRSdW5BbnlUZXN0cykgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge0FjdGl2ZUFmdGVyQWxsU2NvcGVFbnRyeX0gKi9cbiAgICBjb25zdCBzY29wZUVudHJ5ID0ge3Rlc3RzLCBhZnRlckFsbHNSdW46IGZhbHNlLCBwcm9maWxlU2NvcGVJZH1cbiAgICB0aGlzLl9hY3RpdmVBZnRlckFsbFNjb3Blcy5wdXNoKHNjb3BlRW50cnkpXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3Qgc2NvcGVFcnJvcnMgPSBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJlZm9yZUFsbHMgPSB0aGlzLnByb2ZpbGVIb29rRW50cmllcyh0ZXN0cy5iZWZvcmVBbGxzIHx8IFtdLCBwcm9maWxlU2NvcGVJZCwgc2NvcGVPd25lckZpbGVQYXRoKVxuXG4gICAgICBhd2FpdCB0aGlzLl9zdWl0ZUhvb2tFeGVjdXRvci5ydW5CZWZvcmVBbGxzKHtob29rczogYmVmb3JlQWxsc30pXG5cbiAgICAgIGZvciAoY29uc3QgdGVzdERlc2NyaXB0aW9uIGluIHRlc3RzLnRlc3RzKSB7XG4gICAgICAgIGNvbnN0IHRlc3REYXRhID0gdGVzdHMudGVzdHNbdGVzdERlc2NyaXB0aW9uXVxuICAgICAgICBjb25zdCB0ZXN0QXJncyA9IHRoaXMuX3Rlc3RBcmd1bWVudHMuY29weSh0ZXN0RGF0YSlcbiAgICAgICAgY29uc3QgaW5jbHVkZUJ5TGluZSA9IHNjb3BlTGluZU1hdGNoIHx8IHRoaXMubWF0Y2hlc0xpbmVGaWx0ZXIodGVzdERhdGEpXG5cbiAgICAgICAgaWYgKHRoaXMuX29ubHlGb2N1c3NlZCAmJiAhdGVzdEFyZ3MuZm9jdXMpIGNvbnRpbnVlXG4gICAgICAgIGlmICh0aGlzLnNob3VsZFNraXBUZXN0KHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9uLCBkZXNjcmlwdGlvbnMsIGluY2x1ZGVCeUxpbmUpKSBjb250aW51ZVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX3Rlc3RBcmd1bWVudHMuaW5qZWN0KHRlc3RBcmdzKVxuXG4gICAgICAgIGNvbnN0IHJldHJ5Q291bnQgPSB0eXBlb2YgdGVzdEFyZ3MucmV0cnkgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHRlc3RBcmdzLnJldHJ5KVxuICAgICAgICAgID8gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcih0ZXN0QXJncy5yZXRyeSkpXG4gICAgICAgICAgOiAwXG4gICAgICAgIGNvbnN0IGNvbmZpZ1RpbWVvdXRTZWNvbmRzID0gdHlwZW9mIHRlc3RDb25maWcuZGVmYXVsdFRpbWVvdXRTZWNvbmRzID09PSBcIm51bWJlclwiID8gdGVzdENvbmZpZy5kZWZhdWx0VGltZW91dFNlY29uZHMgOiB1bmRlZmluZWRcbiAgICAgICAgY29uc3QgdGltZW91dFNlY29uZHMgPSB0eXBlb2YgdGVzdEFyZ3MudGltZW91dFNlY29uZHMgPT09IFwibnVtYmVyXCIgPyB0ZXN0QXJncy50aW1lb3V0U2Vjb25kcyA6IGNvbmZpZ1RpbWVvdXRTZWNvbmRzXG4gICAgICAgIGNvbnN0IHVzZVRpbWVvdXQgPSB0eXBlb2YgdGltZW91dFNlY29uZHMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHRpbWVvdXRTZWNvbmRzKSAmJiB0aW1lb3V0U2Vjb25kcyA+IDBcbiAgICAgICAgY29uc3QgdGltZW91dE1zID0gdXNlVGltZW91dCA/IHRpbWVvdXRTZWNvbmRzICogMTAwMCA6IHVuZGVmaW5lZFxuICAgICAgICBsZXQgcmV0cmllc1VzZWQgPSAwXG4gICAgICAgIGxldCBhdHRlbXB0TnVtYmVyID0gMVxuICAgICAgICAvKipcbiAgICAgICAgICogQXR0ZW1wdCBjb25zb2xlIG91dHB1dHMuXG4gICAgICAgICAqIEB0eXBlIHtBdHRlbXB0Q29uc29sZU91dHB1dFtdfSAqL1xuICAgICAgICBjb25zdCBhdHRlbXB0Q29uc29sZU91dHB1dHMgPSBbXVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGAke2xlZnRQYWRkaW5nfWl0ICR7dGVzdERlc2NyaXB0aW9ufWApXG5cbiAgICAgICAgY29uc3QgdGVzdFN0YXJ0TXMgPSBEYXRlLm5vdygpXG5cbiAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICBjb25zdCBhdHRlbXB0UmVzdWx0ID0gYXdhaXQgdGhpcy5fYXR0ZW1wdEV4ZWN1dG9yLmV4ZWN1dGUoe1xuICAgICAgICAgICAgYWZ0ZXJFYWNoZXM6IG5ld0FmdGVyRWFjaGVzLFxuICAgICAgICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgICAgICAgIGJlZm9yZUVhY2hlczogbmV3QmVmb3JlRWFjaGVzLFxuICAgICAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICAgICAgdGVzdEFyZ3MsXG4gICAgICAgICAgICB0ZXN0RGF0YSxcbiAgICAgICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgICAgIHRpbWVvdXRNc1xuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBpZiAoYXR0ZW1wdFJlc3VsdC5jb25zb2xlT3V0cHV0KSB7XG4gICAgICAgICAgICBhdHRlbXB0Q29uc29sZU91dHB1dHMucHVzaCh7YXR0ZW1wdE51bWJlciwgb3V0cHV0OiBhdHRlbXB0UmVzdWx0LmNvbnNvbGVPdXRwdXR9KVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoYXR0ZW1wdFJlc3VsdC5hYm9ydFJlbWFpbmluZ1Rlc3RzKSB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gdHJ1ZVxuXG4gICAgICAgICAgY29uc3Qgd2lsbFJldHJ5ID0gYXR0ZW1wdFJlc3VsdC5mYWlsZWQgJiYgIXRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgJiYgcmV0cmllc1VzZWQgPCByZXRyeUNvdW50XG4gICAgICAgICAgaWYgKHdpbGxSZXRyeSkgcmV0cmllc1VzZWQrK1xuXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVubmVyUmVwb3J0ZXIucmVwb3J0QXR0ZW1wdCh7XG4gICAgICAgICAgICBhdHRlbXB0Q29uc29sZU91dHB1dHMsXG4gICAgICAgICAgICBhdHRlbXB0TnVtYmVyLFxuICAgICAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICAgICAgZXJyb3I6IGF0dGVtcHRSZXN1bHQuZXJyb3IsXG4gICAgICAgICAgICBmYWlsZWQ6IGF0dGVtcHRSZXN1bHQuZmFpbGVkLFxuICAgICAgICAgICAgbGVmdFBhZGRpbmcsXG4gICAgICAgICAgICByZXRyaWVzVXNlZCxcbiAgICAgICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgICAgICB0ZXN0QXJncyxcbiAgICAgICAgICAgIHRlc3REYXRhLFxuICAgICAgICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgICAgICAgd2lsbFJldHJ5XG4gICAgICAgICAgfSlcbiAgICAgICAgICBhdHRlbXB0TnVtYmVyKytcblxuICAgICAgICAgIGlmICghd2lsbFJldHJ5KSBicmVha1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fdGVzdER1cmF0aW9ucy5wdXNoKHtcbiAgICAgICAgICBmdWxsRGVzY3JpcHRpb246IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pLFxuICAgICAgICAgIGZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCA/PyBcIjx1bmtub3duPlwiLFxuICAgICAgICAgIGxpbmU6IHRlc3REYXRhLmxpbmUgPz8gMCxcbiAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gdGVzdFN0YXJ0TXNcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAodGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cykgYnJlYWtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBzdWJEZXNjcmlwdGlvbiBpbiB0ZXN0cy5zdWJzKSB7XG4gICAgICAgIGlmICh0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzKSBicmVha1xuXG4gICAgICAgIGNvbnN0IHN1YlRlc3QgPSB0ZXN0cy5zdWJzW3N1YkRlc2NyaXB0aW9uXVxuICAgICAgICBjb25zdCBuZXdEZWNyaXB0aW9ucyA9IGRlc2NyaXB0aW9ucy5jb25jYXQoW3N1YkRlc2NyaXB0aW9uXSlcbiAgICAgICAgY29uc3QgY2hpbGRTY29wZUxpbmVNYXRjaCA9IHNjb3BlTGluZU1hdGNoIHx8IHRoaXMubWF0Y2hlc0xpbmVGaWx0ZXIoc3ViVGVzdClcblxuICAgICAgICBpZiAoIXRoaXMuX29ubHlGb2N1c3NlZCB8fCBzdWJUZXN0LmFueVRlc3RzRm9jdXNzZWQpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgJHtsZWZ0UGFkZGluZ30ke3N1YkRlc2NyaXB0aW9ufWApXG4gICAgICAgICAgYXdhaXQgdGhpcy5ydW5UZXN0cyh7XG4gICAgICAgICAgICBhZnRlckVhY2hlczogbmV3QWZ0ZXJFYWNoZXMsXG4gICAgICAgICAgICBiZWZvcmVFYWNoZXM6IG5ld0JlZm9yZUVhY2hlcyxcbiAgICAgICAgICAgIHRlc3RzOiBzdWJUZXN0LFxuICAgICAgICAgICAgZGVzY3JpcHRpb25zOiBuZXdEZWNyaXB0aW9ucyxcbiAgICAgICAgICAgIGluZGVudExldmVsOiBpbmRlbnRMZXZlbCArIDEsXG4gICAgICAgICAgICBsaW5lTWF0Y2hlZEluU2NvcGU6IGNoaWxkU2NvcGVMaW5lTWF0Y2gsXG4gICAgICAgICAgICBwYXJlbnRQcm9maWxlU2NvcGVJZDogcHJvZmlsZVNjb3BlSWRcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHNjb3BlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQWZ0ZXJBbGxzRm9yU2NvcGUoc2NvcGVFbnRyeSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgc2NvcGVFcnJvcnMucHVzaChlcnJvcilcbiAgICB9XG4gICAgY29uc3Qgc2NvcGVJbmRleCA9IHRoaXMuX2FjdGl2ZUFmdGVyQWxsU2NvcGVzLmluZGV4T2Yoc2NvcGVFbnRyeSlcblxuICAgIGlmIChzY29wZUluZGV4ID49IDApIHtcbiAgICAgIHRoaXMuX2FjdGl2ZUFmdGVyQWxsU2NvcGVzLnNwbGljZShzY29wZUluZGV4LCAxKVxuICAgIH1cblxuICAgIGlmIChzY29wZUVycm9ycy5sZW5ndGggPiAwICYmIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gc2NvcGVFcnJvcnMubGVuZ3RoID09IDFcbiAgICAgICAgPyBzY29wZUVycm9yc1swXVxuICAgICAgICA6IG5ldyBBZ2dyZWdhdGVFcnJvcihzY29wZUVycm9ycywgXCJUZXN0IHNjb3BlIGFuZCBhZnRlckFsbCBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IHNjb3BlRXJyb3JzWzBdfSlcblxuICAgICAgdGhpcy5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoZXJyb3IsIFwiYWZ0ZXJBbGxcIilcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoc2NvcGVFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IHNjb3BlRXJyb3JzWzBdXG4gICAgaWYgKHNjb3BlRXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihzY29wZUVycm9ycywgXCJUZXN0IHNjb3BlIGFuZCBhZnRlckFsbCBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IHNjb3BlRXJyb3JzWzBdfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBhZnRlciBhbGxzIGZvciBzY29wZS5cbiAgICogQHBhcmFtIHtBY3RpdmVBZnRlckFsbFNjb3BlRW50cnl9IHNjb3BlRW50cnkgLSBTY29wZSBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzY29wZSBjbGVhbnVwIGZpbmlzaGVzLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJBbGxzRm9yU2NvcGUoc2NvcGVFbnRyeSkge1xuICAgIGlmIChzY29wZUVudHJ5LmFmdGVyQWxsc1J1bikgcmV0dXJuXG5cbiAgICBzY29wZUVudHJ5LmFmdGVyQWxsc1J1biA9IHRydWVcblxuICAgIGNvbnN0IHNjb3BlT3duZXJGaWxlUGF0aCA9IHNjb3BlRW50cnkudGVzdHMub3duZXJGaWxlUGF0aCA/PyBzY29wZUVudHJ5LnRlc3RzLmZpbGVQYXRoXG4gICAgY29uc3QgYWZ0ZXJBbGxzID0gdGhpcy5wcm9maWxlSG9va0VudHJpZXMoXG4gICAgICBzY29wZUVudHJ5LnRlc3RzLmFmdGVyQWxscyB8fCBbXSxcbiAgICAgIHNjb3BlRW50cnkucHJvZmlsZVNjb3BlSWQsXG4gICAgICBzY29wZU93bmVyRmlsZVBhdGhcbiAgICApXG5cbiAgICBhd2FpdCB0aGlzLl9zdWl0ZUhvb2tFeGVjdXRvci5ydW5BZnRlckFsbHMoe2hvb2tzOiBhZnRlckFsbHN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW1pdCBldmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgbGlzdGVuZXJzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGF5bG9hZCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bm5lclJlcG9ydGVyLmVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCByZXJ1biBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIExlZnQgcGFkZGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHJpbnRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YSwgbGVmdFBhZGRpbmd9KSB7XG4gICAgY29uc3QgcmVydW4gPSB0aGlzLmJ1aWxkUmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGF9KVxuXG4gICAgaWYgKHJlcnVuKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGAke2xlZnRQYWRkaW5nfSAgUmUtcnVuOiAke3JlcnVufWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgcmVydW4gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXJ1biBjb21tYW5kLlxuICAgKi9cbiAgYnVpbGRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YX0pIHtcbiAgICBjb25zdCBiYXNlQ29tbWFuZCA9IFwibnB4IHZlbG9jaW91cyB0ZXN0XCJcbiAgICBjb25zdCBmaWxlUGF0aCA9IHRlc3REYXRhLmZpbGVQYXRoXG4gICAgY29uc3QgbGluZSA9IHRlc3REYXRhLmxpbmVcblxuICAgIGlmIChmaWxlUGF0aCAmJiBsaW5lKSB7XG4gICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHByb2Nlc3MuY3dkKCksIGZpbGVQYXRoKVxuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAke3JlbGF0aXZlUGF0aH06JHtsaW5lfWBcbiAgICB9XG5cbiAgICBjb25zdCBmdWxsRGVzY3JpcHRpb24gPSB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKVxuXG4gICAgaWYgKGZ1bGxEZXNjcmlwdGlvbikge1xuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAtLWV4YW1wbGUgJHtKU09OLnN0cmluZ2lmeShmdWxsRGVzY3JpcHRpb24pfWBcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtBdHRlbXB0Q29uc29sZU91dHB1dFtdfSBhdHRlbXB0Q29uc29sZU91dHB1dHMgLSBBdHRlbXB0IG91dHB1dCBlbnRyaWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbWJpbmVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKi9cbiAgYnVpbGRDb25zb2xlT3V0cHV0KGF0dGVtcHRDb25zb2xlT3V0cHV0cykge1xuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIlxuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAxKSByZXR1cm4gYXR0ZW1wdENvbnNvbGVPdXRwdXRzWzBdLm91dHB1dFxuXG4gICAgcmV0dXJuIGF0dGVtcHRDb25zb2xlT3V0cHV0cy5tYXAoKGF0dGVtcHRDb25zb2xlT3V0cHV0KSA9PiB7XG4gICAgICByZXR1cm4gYC0tLSBBdHRlbXB0ICR7YXR0ZW1wdENvbnNvbGVPdXRwdXQuYXR0ZW1wdE51bWJlcn0gLS0tXFxuJHthdHRlbXB0Q29uc29sZU91dHB1dC5vdXRwdXR9YFxuICAgIH0pLmpvaW4oXCJcXG5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgY29uc29sZSBvdXRwdXQgbWF4IGxpbmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gZmFpbGVkIGNvbnNvbGUgbGluZXMuXG4gICAqL1xuICBnZXRGYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMoKSB7XG4gICAgY29uc3QgbWF4TGluZXMgPSB0ZXN0Q29uZmlnLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lc1xuXG4gICAgaWYgKHR5cGVvZiBtYXhMaW5lcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKG1heExpbmVzKSkgcmV0dXJuIDIwMFxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGguZmxvb3IobWF4TGluZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZmFpbGVkIGNvbnNvbGUgb3V0cHV0IGxpbmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uc29sZU91dHB1dCAtIENvbnNvbGUgb3V0cHV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTGluZXMgZm9yIGlubGluZSBvdXRwdXQuXG4gICAqL1xuICB0cnVuY2F0ZUZhaWxlZENvbnNvbGVPdXRwdXRMaW5lcyhjb25zb2xlT3V0cHV0KSB7XG4gICAgY29uc3QgbGluZXMgPSBjb25zb2xlT3V0cHV0LnNwbGl0KFwiXFxuXCIpXG4gICAgY29uc3QgbWF4TGluZXMgPSB0aGlzLmdldEZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcygpXG5cbiAgICBpZiAobWF4TGluZXMgPT09IDApIHJldHVybiBbXVxuICAgIGlmIChsaW5lcy5sZW5ndGggPD0gbWF4TGluZXMpIHJldHVybiBsaW5lc1xuXG4gICAgY29uc3Qgb21pdHRlZExpbmVzID0gbGluZXMubGVuZ3RoIC0gbWF4TGluZXNcbiAgICBjb25zdCBwbHVyYWwgPSBvbWl0dGVkTGluZXMgPT09IDEgPyBcIlwiIDogXCJzXCJcblxuICAgIHJldHVybiBbXG4gICAgICBgLi4uICR7b21pdHRlZExpbmVzfSBjb25zb2xlIG91dHB1dCBsaW5lJHtwbHVyYWx9IG9taXR0ZWQgLi4uYCxcbiAgICAgIC4uLmxpbmVzLnNsaWNlKC1tYXhMaW5lcylcbiAgICBdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCBmYWlsZWQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBMZWZ0IHBhZGRpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHByaW50RmFpbGVkQ29uc29sZU91dHB1dCh7Y29uc29sZU91dHB1dCwgbGVmdFBhZGRpbmd9KSB7XG4gICAgaWYgKHRlc3RDb25maWcuY29uc29sZU91dHB1dCAhPT0gXCJmYWlsdXJlXCIpIHJldHVyblxuICAgIGlmICghY29uc29sZU91dHB1dCkgcmV0dXJuXG5cbiAgICBjb25zdCBsaW5lcyA9IHRoaXMudHJ1bmNhdGVGYWlsZWRDb25zb2xlT3V0cHV0TGluZXMoY29uc29sZU91dHB1dClcblxuICAgIGlmIChsaW5lcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIENvbnNvbGUgb3V0cHV0OmApKVxuXG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgICAke2xpbmV9YCkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgY29uc29sZSBjYXB0dXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucGFzc3Rocm91Z2hdIC0gV2hldGhlciB0byBwYXNzIHRocm91Z2ggdG8gdGhlIG9yaWdpbmFsIGNvbnNvbGUuXG4gICAqIEByZXR1cm5zIHsoKSA9PiBzdHJpbmd9IC0gU3RvcHMgdGhlIGNhcHR1cmUgYW5kIHJldHVybnMgY2FwdHVyZWQgdGV4dC5cbiAgICovXG4gIHN0YXJ0Q29uc29sZUNhcHR1cmUoe3Bhc3N0aHJvdWdoID0gZmFsc2V9ID0ge30pIHtcbiAgICAvKipcbiAgICAgKiBMaW5lcy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbGluZXMgPSBbXVxuICAgIC8qKlxuICAgICAqIENvbnNvbGUgb2JqZWN0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8Q29uc29sZU1ldGhvZE5hbWUsICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHZvaWQ+fSAqL1xuICAgIGNvbnN0IGNvbnNvbGVPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxDb25zb2xlTWV0aG9kTmFtZSwgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZD59ICovIChjb25zb2xlKVxuICAgIC8qKlxuICAgICAqIE9yaWdpbmFsIGNvbnNvbGUgbWV0aG9kcyBjYXB0dXJlZCBhcyBkaXJlY3QgcmVmZXJlbmNlcyBzbyBzdG9wcGluZyByZXN0b3Jlc1xuICAgICAqIHRoZSBleGFjdCBtZXRob2QgdGhhdCB3YXMgaW5zdGFsbGVkIGF0IGNhcHR1cmUgc3RhcnQuXG4gICAgICogQHR5cGUge1JlY29yZDxDb25zb2xlTWV0aG9kTmFtZSwgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZD59ICovXG4gICAgY29uc3Qgb3JpZ2luYWxDb25zb2xlTWV0aG9kcyA9IHtcbiAgICAgIGRlYnVnOiBjb25zb2xlT2JqZWN0LmRlYnVnLFxuICAgICAgZXJyb3I6IGNvbnNvbGVPYmplY3QuZXJyb3IsXG4gICAgICBpbmZvOiBjb25zb2xlT2JqZWN0LmluZm8sXG4gICAgICBsb2c6IGNvbnNvbGVPYmplY3QubG9nLFxuICAgICAgd2FybjogY29uc29sZU9iamVjdC53YXJuXG4gICAgfVxuICAgIGxldCBzdG9wcGVkID0gZmFsc2VcbiAgICBsZXQgb3V0cHV0VGV4dCA9IFwiXCJcblxuICAgIGZvciAoY29uc3QgbWV0aG9kTmFtZSBvZiBDQVBUVVJFRF9DT05TT0xFX01FVEhPRFMpIHtcbiAgICAgIGNvbnNvbGVPYmplY3RbbWV0aG9kTmFtZV0gPSAoLi4uYXJncykgPT4ge1xuICAgICAgICBsaW5lcy5wdXNoKGBbJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9XSBbJHttZXRob2ROYW1lfV0gJHtmb3JtYXQoLi4uYXJncyl9YClcblxuICAgICAgICBpZiAocGFzc3Rocm91Z2gpIHtcbiAgICAgICAgICBvcmlnaW5hbENvbnNvbGVNZXRob2RzW21ldGhvZE5hbWVdLmFwcGx5KGNvbnNvbGVPYmplY3QsIGFyZ3MpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgaWYgKCFzdG9wcGVkKSB7XG4gICAgICAgIHN0b3BwZWQgPSB0cnVlXG5cbiAgICAgICAgZm9yIChjb25zdCBtZXRob2ROYW1lIG9mIENBUFRVUkVEX0NPTlNPTEVfTUVUSE9EUykge1xuICAgICAgICAgIGNvbnNvbGVPYmplY3RbbWV0aG9kTmFtZV0gPSBvcmlnaW5hbENvbnNvbGVNZXRob2RzW21ldGhvZE5hbWVdXG4gICAgICAgIH1cblxuICAgICAgICBvdXRwdXRUZXh0ID0gbGluZXMuam9pbihcIlxcblwiKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gb3V0cHV0VGV4dFxuICAgIH1cbiAgfVxufVxuIl19