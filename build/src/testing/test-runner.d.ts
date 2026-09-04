import { AsyncLocalStorage } from "node:async_hooks";
import Application from "../../src/application.js";
import RequestClient from "./request-client.js";
import SharedTransactionBroker from "./shared-transaction-broker.js";
import VelociousAttemptExecutor from "./velocious-attempt-executor.js";
import VelociousRunnerReporter from "./velocious-runner-reporter.js";
import VelociousSuiteHookExecutor from "./velocious-suite-hook-executor.js";
import VelociousTestArguments from "./velocious-test-arguments.js";
export type ConsoleMethodName = "log" | "info" | "warn" | "error" | "debug";
export type AttemptConsoleOutput = {
    /**
     * - Attempt number.
     */
    attemptNumber: number;
    /**
     * - Captured console output.
     */
    output: string;
};
export type TestArgs = {
    /**
     * - Application instance for integration tests.
     */
    application?: Application;
    /**
     * - HTTP client for request tests.
     */
    client?: RequestClient;
    /**
     * - Database cleanup options for tests.
     */
    databaseCleaning?: {
        transaction?: boolean;
        truncate?: boolean;
        truncateBefore?: boolean;
    };
    /**
     * - Whether this test is focused.
     */
    focus?: boolean;
    /**
     * - Test callback function.
     */
    function?: () => (void | Promise<void>);
    /**
     * - Number of retries when a test fails.
     */
    retry?: number;
    /**
     * - Tags for filtering.
     */
    tags?: string[] | string;
    /**
     * - Timeout in seconds for the test.
     */
    timeoutSeconds?: number;
    /**
     * - Test type identifier.
     */
    type?: string;
    /**
     * - Registers one resolved tenant database transaction for this attempt.
     */
    registerTransactionalTenant?: (args: {
        databaseIdentifier: string;
        tenant: object;
    }) => Promise<void>;
};
export type BrowserDummyConnectionRegistration = {
    /**
     * - Attempt-owned connection.
     */
    db: import("../database/drivers/base.js").default;
    /**
     * - Configured database identifier.
     */
    databaseIdentifier: string;
    /**
     * - Shared connection-discard promise.
     */
    quarantinePromise?: Promise<void>;
    /**
     * - Whether the connection is unsafe to reuse.
     */
    quarantined: boolean;
    /**
     * - Shared rollback promise.
     */
    rollbackPromise?: Promise<void>;
    /**
     * - Transaction startup promise when transaction cleaning is enabled.
     */
    startPromise?: Promise<void>;
};
export type TestData = {
    /**
     * - Arguments passed to the test.
     */
    args: TestArgs;
    /**
     * - Source file path.
     */
    filePath?: string;
    /**
     * - Source line number.
     */
    line?: number;
    /**
     * - Deterministic importing test file.
     */
    ownerFilePath?: string;
    /**
     * - Test callback to execute.
     */
    function: (arg: TestArgs) => (void | Promise<void>);
};
export type FailedTestDetail = {
    /**
     * - Full test description.
     */
    fullDescription: string;
    /**
     * - Source file path.
     */
    filePath?: string;
    /**
     * - Source line number.
     */
    line?: number;
    /**
     * - Failure error.
     */
    error: ReturnType<typeof JSON.parse>;
    /**
     * - Captured console output while test ran.
     */
    consoleOutput?: string;
    /**
     * - Saved console log path.
     */
    consoleLogPath?: string;
};
export type ActiveAfterAllScopeEntry = {
    /**
     * - Scope test tree.
     */
    tests: TestsArgument;
    /**
     * - Whether cleanup hooks have run.
     */
    afterAllsRun: boolean;
    /**
     * - Opaque profile scope identifier.
     */
    profileScopeId?: string;
};
export type AfterBeforeEachCallbackType = (args: {
    configuration: import("../configuration.js").default;
    testArgs: TestArgs;
    testData: TestData;
}) => (void | Promise<void>);
export type AfterBeforeEachCallbackObjectType = {
    /**
     * - Hook callback to execute.
     */
    callback: AfterBeforeEachCallbackType;
    /**
     * - Hook index within its declaration scope.
     */
    declarationIndex?: number;
    /**
     * - Opaque profile scope identifier.
     */
    declarationScopeId?: string;
    /**
     * - Deterministic importing test file.
     */
    ownerFilePath?: string;
};
export type BeforeAfterAllCallbackType = (args: {
    configuration: import("../configuration.js").default;
}) => (void | Promise<void>);
export type BeforeAfterAllCallbackObjectType = {
    /**
     * - Hook callback to execute.
     */
    callback: BeforeAfterAllCallbackType;
    /**
     * - Hook index within its declaration scope.
     */
    declarationIndex?: number;
    /**
     * - Opaque profile scope identifier.
     */
    declarationScopeId?: string;
    /**
     * - Deterministic importing test file.
     */
    ownerFilePath?: string;
};
export type TestsArgument = {
    /**
     * - Arguments inherited by tests in this scope.
     */
    args: TestArgs;
    /**
     * - Whether any tests in the tree are focused.
     */
    anyTestsFocussed?: boolean;
    /**
     * - After-each hooks for this scope.
     */
    afterEaches: AfterBeforeEachCallbackObjectType[];
    /**
     * - After-all hooks for this scope.
     */
    afterAlls: BeforeAfterAllCallbackObjectType[];
    /**
     * - Before-all hooks for this scope.
     */
    beforeAlls: BeforeAfterAllCallbackObjectType[];
    /**
     * - Before-each hooks for this scope.
     */
    beforeEaches: AfterBeforeEachCallbackObjectType[];
    /**
     * - Source file path.
     */
    filePath?: string;
    /**
     * - Source line number.
     */
    line?: number;
    /**
     * - Deterministic importing test file.
     */
    ownerFilePath?: string;
    /**
     * - A unique identifier for the node.
     */
    tests: Record<string, TestData>;
    /**
     * - Optional child nodes. Each item is another `Node`, allowing recursion.
     */
    subs: Record<string, TestsArgument>;
};
export type TestTimeoutError = Error & {
    velociousTestTimeout?: true;
};
export type SharedTransactionBrokerRegistration = {
    /**
     * - Attempt broker and connection coordinator.
     */
    broker: SharedTransactionBroker;
    /**
     * - Whether child-process coordinates were published.
     */
    environmentPublished: boolean;
    /**
     * - Environment value to restore after publication.
     */
    previousEnvironment: string | undefined;
};
export type TransactionalTenantRegistration = {
    /**
     * - Attempt-owned physical checkout outcome.
     */
    checkoutPromise?: Promise<{
        connection: import("../database/drivers/base.js").default | undefined;
        error: Error | undefined;
    }> | undefined;
    /**
     * - Attempt-owned physical connection once checkout resolves.
     */
    connection: import("../database/drivers/base.js").default | undefined;
    /**
     * - Single cleanup operation shared by emergency and eventual lifecycle cleanup.
     */
    cleanupPromise?: Promise<void> | undefined;
    /**
     * - Whether timeout emergency cleanup must quarantine this connection.
     */
    discardOnCleanup?: boolean | undefined;
    /**
     * - Owning logical pool.
     */
    pool: import("../database/pool/base.js").default;
    /**
     * - Whether this attempt may still publish the physical registration.
     */
    revoked: boolean;
    /**
     * - Resolved physical configuration identity.
     */
    reuseKey: string;
    /**
     * - Physical-key shared registration once published.
     */
    sharedRegistration: import("../database/pool/base.js").TestSharedConnectionRegistration | undefined;
};
export default class TestRunner {
    _configuration: import("../configuration.js").default;
    _sharedTransactionCoordinatorOwnerStorage: AsyncLocalStorage<any>;
    _testDatabaseAccessScopeStorage: AsyncLocalStorage<any>;
    _excludeTags: string[];
    _excludeTagSet: Set<string>;
    _includeTags: string[];
    _includeTagSet: Set<string>;
    _testFiles: string[];
    _lineFilters: Record<string, number[]>;
    _examplePatterns: RegExp[];
    _profiler: import("./test-profiler.js").default | undefined;
    _abortRemainingTests: boolean;
    _failedTests: number;
    _successfulTests: number;
    _testsCount: number;
    /** @type {{fullDescription: string, filePath: string, line: number} | null} */
    _lastTestContext: {
        fullDescription: string;
        filePath: string;
        line: number;
    } | null;
    /** @type {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} */
    _testDurations: Array<{
        fullDescription: string;
        filePath: string;
        line: number;
        durationMs: number;
    }>;
    _attemptExecutor: VelociousAttemptExecutor;
    _runnerReporter: VelociousRunnerReporter;
    _suiteHookExecutor: VelociousSuiteHookExecutor;
    _testArguments: VelociousTestArguments;
    _application: Application | undefined;
    _requestClient: RequestClient | undefined;
    anyTestsFocussed: boolean | undefined;
    _onlyFocussed: boolean | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ActiveAfterAllScopeEntry[]} */
    _activeAfterAllScopes: ActiveAfterAllScopeEntry[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {FailedTestDetail[]} */
    _failedTestDetails: FailedTestDetail[];
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
    constructor({ configuration, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, profiler, ...restArgs }: {
        configuration: import("../configuration.js").default;
        excludeTags?: string[] | string;
        includeTags?: string[] | string;
        testFiles: Array<string>;
        lineFilters?: Record<string, number[]>;
        examplePatterns?: RegExp[];
        profiler?: import("./test-profiler.js").default;
    });
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} - The configuration.
     */
    getConfiguration(): import("../configuration.js").default;
    /**
     * Runs get test files.
     * @returns {string[]} - The test files.
     */
    getTestFiles(): string[];
    /**
     * Runs get line filters.
     * @returns {Record<string, number[]>} - Line filters.
     */
    getLineFilters(): Record<string, number[]>;
    /**
     * Runs get example patterns.
     * @returns {RegExp[]} - Example patterns.
     */
    getExamplePatterns(): RegExp[];
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
    runProfileSpan<T>(metadata: {
        phase: string;
        declarationIndex?: number;
        declarationScopeId?: string;
        filePath?: string;
    }, callback: () => (T | Promise<T>)): Promise<T>;
    /**
     * Adds declaration metadata to hooks only for an active profile.
     * @template {AfterBeforeEachCallbackObjectType | BeforeAfterAllCallbackObjectType} T
     * @param {T[]} hooks - Hooks declared in one scope.
     * @param {string | undefined} declarationScopeId - Profile scope identifier.
     * @param {string | undefined} ownerFilePath - Scope owner file.
     * @returns {T[]} - Profile-aware hook entries.
     */
    profileHookEntries<T extends AfterBeforeEachCallbackObjectType | BeforeAfterAllCallbackObjectType>(hooks: T[], declarationScopeId: string | undefined, ownerFilePath: string | undefined): T[];
    /**
     * Runs normalize tags.
     * @param {string[] | string | undefined} tags - Tags.
     * @returns {string[]} - Normalized tags.
     */
    normalizeTags(tags: string[] | string | undefined): string[];
    /**
     * Runs has tag.
     * @param {TestArgs} testArgs - Test args.
     * @param {string} tag - Tag to check for.
     * @returns {boolean} - Whether tag is present.
     */
    hasTag(testArgs: TestArgs, tag: string): boolean;
    /**
     * Runs is browser test mode.
     * @returns {boolean} - Whether running browser tests.
     */
    isBrowserTestMode(): boolean;
    /**
     * Runs run with dummy if needed.
     * @param {TestArgs} testArgs - Test args.
     * @param {() => Promise<void>} callback - Callback to run.
     * @param {BrowserDummyConnectionRegistration[]} [browserDummyConnectionRegistrations] - Attempt-owned browser connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    runWithDummyIfNeeded(testArgs: TestArgs, callback: () => Promise<void>, browserDummyConnectionRegistrations?: BrowserDummyConnectionRegistration[]): Promise<void>;
    /**
     * Runs run node dummy.
     * @param {() => Promise<void>} callback - Callback to run.
     * @returns {Promise<void>} - Resolves when complete.
     */
    runNodeDummy(callback: () => Promise<void>): Promise<void>;
    /**
     * Runs default dummy path.
     * @returns {string} - Default dummy helper path.
     */
    defaultDummyPath(): string;
    /**
     * Runs run browser dummy.
     * @param {TestArgs} testArgs - Test args.
     * @param {() => Promise<void>} callback - Callback to run.
     * @param {BrowserDummyConnectionRegistration[]} connectionRegistrations - Attempt-owned browser connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    runBrowserDummy(testArgs: TestArgs, callback: () => Promise<void>, connectionRegistrations: BrowserDummyConnectionRegistration[]): Promise<void>;
    /**
     * Rolls back every attempt-owned browser transaction exactly once.
     * @param {BrowserDummyConnectionRegistration[]} registrations - Browser connections.
     * @returns {Promise<void>} - Resolves after all rollbacks settle.
     */
    rollbackBrowserDummyTransactions(registrations: BrowserDummyConnectionRegistration[]): Promise<void>;
    /**
     * Permanently removes one browser connection that cannot be shared safely.
     * @param {BrowserDummyConnectionRegistration} registration - Browser connection registration.
     * @returns {Promise<void>} - Resolves after the connection is discarded.
     */
    quarantineBrowserDummyConnection(registration: BrowserDummyConnectionRegistration): Promise<void>;
    /**
     * Discards one browser dummy connection through its owning pool.
     * @param {string} databaseIdentifier - Configured database identifier.
     * @param {import("../database/drivers/base.js").default} db - Unsafe connection.
     * @returns {Promise<void>} - Resolves after discard.
     */
    discardBrowserDummyConnection(databaseIdentifier: string, db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Quarantines all browser connections concurrently.
     * @param {BrowserDummyConnectionRegistration[]} registrations - Browser connection registrations.
     * @returns {Promise<void>} - Resolves after every connection is discarded.
     */
    quarantineBrowserDummyConnections(registrations: BrowserDummyConnectionRegistration[]): Promise<void>;
    /**
     * Runs truncate databases.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Database connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    truncateDatabases(dbs: Record<string, import("../database/drivers/base.js").default>): Promise<void>;
    /**
     * Runs get exclude tag set.
     * @returns {Set<string>} - Exclude tag set.
     */
    getExcludeTagSet(): Set<string>;
    /**
     * Runs has matching tag.
     * @param {string[] | string | undefined} testTags - Test tags.
     * @param {Set<string>} tagSet - Tag set.
     * @returns {boolean} - Whether any tags match.
     */
    hasMatchingTag(testTags: string[] | string | undefined, tagSet: Set<string>): boolean;
    /**
     * Runs has runnable tests.
     * @param {TestsArgument} tests - Tests.
     * @param {string[]} [descriptions] - Description stack.
     * @param {boolean} [lineMatchedInScope] - Whether line matched in scope.
     * @returns {boolean} - Whether any tests in this scope will run.
     */
    hasRunnableTests(tests: TestsArgument, descriptions?: string[], lineMatchedInScope?: boolean): boolean;
    /**
     * Runs should skip test.
     * @param {TestArgs} testArgs - Test args.
     * @param {TestData} testData - Test data.
     * @param {string} testDescription - Test description.
     * @param {string[]} descriptions - Description stack.
     * @param {boolean} lineMatchedInScope - Whether line matched in scope.
     * @returns {boolean} - Whether the test should be skipped.
     */
    shouldSkipTest(testArgs: TestArgs, testData: TestData, testDescription: string, descriptions: string[], lineMatchedInScope: boolean): boolean;
    /**
     * Runs matches line filter.
     * @param {TestData | TestsArgument} entry - Test entry.
     * @returns {boolean} - Whether line filter matches entry.
     */
    matchesLineFilter(entry: TestData | TestsArgument): boolean;
    /**
     * Runs build full description.
     * @param {string[]} descriptions - Description stack.
     * @param {string} testDescription - Test description.
     * @returns {string} - Full description.
     */
    buildFullDescription(descriptions: string[], testDescription: string): string;
    /**
     * Runs application.
     * @returns {Promise<Application>} - Resolves with the application.
     */
    application(): Promise<Application>;
    /**
     * Registers each non-tenant per-test connection as a dynamic candidate for in-process
     * request sharing. The pool evaluates transaction state when each request is dispatched,
     * so a transaction started or ended during a hook callback takes effect immediately.
     * Inactive and tenant-only connections remain independently pooled. Pair with
     * {@link clearTestSharedConnections} in a finally.
     * @returns {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} - Lifecycle-owned registrations.
     */
    activateTestSharedConnections(): {
        pool: import("../database/pool/base.js").default;
        registration: import("../database/pool/base.js").TestSharedConnectionRegistration;
    }[];
    /**
     * Clears the in-process test shared connection on every configured pool. Idempotent and
     * safe to call when none was set.
     * @param {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} [registrations] - Lifecycle-owned registrations to clear conditionally.
     * @returns {void}
     */
    clearTestSharedConnections(registrations?: {
        pool: import("../database/pool/base.js").default;
        registration: import("../database/pool/base.js").TestSharedConnectionRegistration;
    }[]): void;
    /**
     * Checks out and registers one physical tenant transaction for the current attempt.
     * @param {{databaseIdentifier: string, tenant: object}} args - Logical identifier and tenant descriptor.
     * @param {TransactionalTenantRegistration[]} registrations - Current attempt registrations.
     * @returns {Promise<void>}
     */
    registerTransactionalTenant({ databaseIdentifier, tenant, ...restArgs }: {
        databaseIdentifier: string;
        tenant: object;
    }, registrations: TransactionalTenantRegistration[]): Promise<void>;
    /**
     * Revokes attempt registrations before rolling back and releasing their connections.
     * @param {TransactionalTenantRegistration[]} registrations - Attempt registrations.
     * @param {{discard?: boolean}} [options] - Whether connections must be discarded instead of returned to the pool.
     * @returns {Promise<void>}
     */
    cleanupTransactionalTenants(registrations: TransactionalTenantRegistration[], { discard }?: {
        discard?: boolean;
    }): Promise<void>;
    /**
     * Cleans one attempt registration exactly once, including a checkout that was still pending at revocation.
     * @param {TransactionalTenantRegistration} registration - Attempt-owned registration.
     * @returns {Promise<void>} - Resolves after rollback and release or quarantine.
     */
    cleanupTransactionalTenantRegistration(registration: TransactionalTenantRegistration): Promise<void>;
    /**
     * Selects the current non-tenant connections eligible for shared transaction work.
     * @param {{transactionsOnly: boolean}} args - Selection options.
     * @returns {Record<string, import("../database/drivers/base.js").default>} - Eligible connections by identifier.
     */
    sharedTransactionConnections({ transactionsOnly }: {
        transactionsOnly: boolean;
    }): Record<string, import("../database/drivers/base.js").default>;
    /**
     * Installs physical-connection coordination before a transaction-opening hook
     * can expose the shared connection to a long-lived in-process service.
     * Child-process coordinates remain unpublished until the transaction exists.
     * @returns {Promise<SharedTransactionBrokerRegistration | undefined>} - Prepared coordinator.
     */
    prepareSharedTransactionBroker(): Promise<SharedTransactionBrokerRegistration | undefined>;
    /**
     * Checks whether a prepared broker coordinates exactly the selected physical connections.
     * @param {SharedTransactionBrokerRegistration | undefined} registration - Prepared coordinator.
     * @param {Record<string, import("../database/drivers/base.js").default>} connections - Selected connections.
     * @returns {boolean} - Whether the identifier set and physical connections match exactly.
     */
    sharedTransactionBrokerMatchesConnections(registration: SharedTransactionBrokerRegistration | undefined, connections: Record<string, import("../database/drivers/base.js").default>): boolean;
    /**
     * Starts a capability-scoped broker for the active non-tenant physical
     * transaction connections. No broker/env is installed for truncation-only or
     * other transaction-disabled attempts.
     * @param {SharedTransactionBrokerRegistration} [preparedRegistration] - Coordinator prepared before hooks.
     * @param {Record<string, import("../database/drivers/base.js").default>} [selectedConnections] - Post-hook active connections.
     * @returns {Promise<SharedTransactionBrokerRegistration | undefined>} - Attempt registration.
     */
    startSharedTransactionBroker(preparedRegistration?: SharedTransactionBrokerRegistration, selectedConnections?: Record<string, import("../database/drivers/base.js").default>): Promise<SharedTransactionBrokerRegistration | undefined>;
    /**
     * Revokes an attempt broker before database rollback hooks run and restores
     * the caller's environment so later pooled/spawned children cannot inherit it.
     * @param {SharedTransactionBrokerRegistration | undefined} registration - Attempt registration.
     */
    stopSharedTransactionBroker(registration: SharedTransactionBrokerRegistration | undefined): Promise<void>;
    /**
     * Runs request client.
     * @returns {Promise<RequestClient>} - Resolves with the request client.
     */
    requestClient(): Promise<RequestClient>;
    /**
     * Runs import test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    importTestFiles(): Promise<void>;
    /**
     * Collects registered scope, hook, and test objects by identity.
     * @param {TestsArgument} scope - Test scope.
     * @param {Set<object>} [registrations] - Accumulated identities.
     * @returns {Set<object>} - Registration identities.
     */
    testRegistrationObjects(scope: TestsArgument, registrations?: Set<object>): Set<object>;
    /**
     * Assigns deterministic ownership to registrations added by one entry file,
     * including declarations originating in a helper imported by that entry file.
     * @param {TestsArgument} scope - Test scope.
     * @param {Set<object>} previousRegistrations - Identities present before import.
     * @param {string} ownerFilePath - Importing entry file.
     * @returns {void}
     */
    assignTestRegistrationOwnership(scope: TestsArgument, previousRegistrations: Set<object>, ownerFilePath: string): void;
    /**
     * Runs is failed.
     * @returns {boolean} - Whether failed.
     */
    isFailed(): boolean;
    /**
     * Runs get failed tests.
     * @returns {number} - The failed tests.
     */
    getFailedTests(): number;
    /**
     * Runs get failed test details.
     * @returns {FailedTestDetail[]} - Failed test details.
     */
    getFailedTestDetails(): FailedTestDetail[];
    /**
     * Runs persist failed test console outputs to assets.
     * @param {object} [args] - Options object.
     * @param {string} [args.assetsPath] - Assets directory path.
     * @returns {Promise<string[]>} - Written log file paths.
     */
    persistFailedTestConsoleOutputsToAssets({ assetsPath }?: {
        assetsPath?: string;
    }): Promise<string[]>;
    /**
     * Runs get successful tests.
     * @returns {number} - The successful tests.
     */
    getSuccessfulTests(): number;
    /**
     * Runs get tests count.
     * @returns {number} - The tests count.
     */
    getTestsCount(): number;
    /**
     * Runs get executed tests count.
     * @returns {number} - The executed tests count.
     */
    getExecutedTestsCount(): number;
    /**
     * Returns the tests recorded during the run, slowest first.
     * @param {number} [limit] - Maximum number of tests to return (0 returns all).
     * @returns {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} - Slowest tests, slowest first.
     */
    getSlowestTests(limit?: number): Array<{
        fullDescription: string;
        filePath: string;
        line: number;
        durationMs: number;
    }>;
    /**
     * Runs prepare.
     * @returns {Promise<void>} - Resolves when complete.
     */
    prepare(): Promise<void>;
    /**
     * Runs are any tests focussed.
     * @returns {boolean} - Whether any tests focussed.
     */
    areAnyTestsFocussed(): boolean;
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
    recordAsyncCrash(kind: "uncaughtException" | "unhandledRejection", reason: unknown): void;
    /**
     * Records a cleanup failure after timeout handling has begun.
     * @param {unknown} reason - Detached cleanup rejection.
     * @param {string} cleanupName - Cleanup operation name.
     * @param {Set<Error>} [recordedErrors] - Attempt-owned cleanup errors already reported.
     * @returns {void}
     */
    recordTimeoutCleanupFailure(reason: unknown, cleanupName: string, recordedErrors?: Set<Error>): void;
    run(): Promise<void>;
    /**
     * Runs run after alls for active scopes.
     * @returns {Promise<void>} - Resolves when cleanup hooks finish.
     */
    runAfterAllsForActiveScopes(): Promise<void>;
    /**
     * Runs analyze tests.
     * @param {TestsArgument} tests - Tests.
     * @returns {{anyTestsFocussed: boolean}} - Whether any tests in the tree are focused.
     */
    analyzeTests(tests: TestsArgument): {
        anyTestsFocussed: boolean;
    };
    /**
     * Runs every after-each hook while preserving the first failure.
     * @param {object} args - Hook execution arguments.
     * @param {AfterBeforeEachCallbackObjectType[]} args.afterEaches - Hooks to run.
     * @param {TestArgs} args.testArgs - Current test arguments.
     * @param {TestData} args.testData - Current test data.
     * @returns {Promise<void>} - Resolves after every hook runs.
     */
    runAfterEaches({ afterEaches, testArgs, testData }: {
        afterEaches: AfterBeforeEachCallbackObjectType[];
        testArgs: TestArgs;
        testData: TestData;
    }): Promise<void>;
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
    runTests({ afterEaches, beforeEaches, tests, descriptions, indentLevel, lineMatchedInScope, parentProfileScopeId }: {
        afterEaches: Array<AfterBeforeEachCallbackObjectType>;
        beforeEaches: Array<AfterBeforeEachCallbackObjectType>;
        tests: TestsArgument;
        descriptions: string[];
        indentLevel: number;
        lineMatchedInScope?: boolean;
        parentProfileScopeId?: string;
    }): Promise<void>;
    /**
     * Runs run after alls for scope.
     * @param {ActiveAfterAllScopeEntry} scopeEntry - Scope entry.
     * @returns {Promise<void>} - Resolves when scope cleanup finishes.
     */
    runAfterAllsForScope(scopeEntry: ActiveAfterAllScopeEntry): Promise<void>;
    /**
     * Runs emit event.
     * @param {string} eventName - Event name.
     * @param {object} payload - Event payload.
     * @returns {Promise<void>} - Resolves when all listeners complete.
     */
    emitEvent(eventName: string, payload: object): Promise<void>;
    /**
     * Runs print rerun command.
     * @param {object} args - Options object.
     * @param {string[]} args.descriptions - Description stack.
     * @param {string} args.testDescription - Test description.
     * @param {TestData} args.testData - Test data.
     * @param {string} args.leftPadding - Left padding.
     * @returns {void} - No return value.
     */
    printRerunCommand({ descriptions, testDescription, testData, leftPadding }: {
        descriptions: string[];
        testDescription: string;
        testData: TestData;
        leftPadding: string;
    }): void;
    /**
     * Runs build rerun command.
     * @param {object} args - Options object.
     * @param {string[]} args.descriptions - Description stack.
     * @param {string} args.testDescription - Test description.
     * @param {TestData} args.testData - Test data.
     * @returns {string | undefined} - Rerun command.
     */
    buildRerunCommand({ descriptions, testDescription, testData }: {
        descriptions: string[];
        testDescription: string;
        testData: TestData;
    }): string | undefined;
    /**
     * Runs build console output.
     * @param {AttemptConsoleOutput[]} attemptConsoleOutputs - Attempt output entries.
     * @returns {string} - Combined console output.
     */
    buildConsoleOutput(attemptConsoleOutputs: AttemptConsoleOutput[]): string;
    /**
     * Runs get failed console output max lines.
     * @returns {number} - Maximum failed console lines.
     */
    getFailedConsoleOutputMaxLines(): number;
    /**
     * Runs truncate failed console output lines.
     * @param {string} consoleOutput - Console output.
     * @returns {string[]} - Lines for inline output.
     */
    truncateFailedConsoleOutputLines(consoleOutput: string): string[];
    /**
     * Runs print failed console output.
     * @param {object} args - Options object.
     * @param {string} args.consoleOutput - Console output.
     * @param {string} args.leftPadding - Left padding.
     * @returns {void} - No return value.
     */
    printFailedConsoleOutput({ consoleOutput, leftPadding }: {
        consoleOutput: string;
        leftPadding: string;
    }): void;
    /**
     * Runs start console capture.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.passthrough] - Whether to pass through to the original console.
     * @returns {() => string} - Stops the capture and returns captured text.
     */
    startConsoleCapture({ passthrough }?: {
        passthrough?: boolean;
    }): () => string;
}
//# sourceMappingURL=test-runner.d.ts.map