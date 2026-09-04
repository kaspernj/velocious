import { AsyncLocalStorage } from "node:async_hooks";
import { defaultTestContext } from "@velocious/testing";
import { TestRunner as PackageTestRunner } from "@velocious/testing/runner";
import Application from "../../src/application.js";
import RequestClient from "./request-client.js";
import SharedTransactionBroker from "./shared-transaction-broker.js";
import VelociousAttemptExecutor from "./velocious-attempt-executor.js";
import VelociousRunnerReporter from "./velocious-runner-reporter.js";
import VelociousSuiteHookExecutor from "./velocious-suite-hook-executor.js";
import VelociousTestArguments from "./velocious-test-arguments.js";
export type PackageTestContext = typeof defaultTestContext;
export type PackageSuiteDeclaration = (typeof defaultTestContext.registry.suites)[number];
export type PackageTestDeclaration = PackageSuiteDeclaration["tests"][number];
export type PackageHookDeclaration = PackageSuiteDeclaration["hooks"]["beforeAll"][number];
export type PackageRegistration = PackageSuiteDeclaration | PackageTestDeclaration | PackageHookDeclaration;
export type PackageRetryOptionRestoration = {
    hadRetries: boolean;
    options: PackageTestDeclaration["options"];
    retries: number | undefined;
};
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
    /**
     * - Package declaration.
     */
    declaration?: PackageTestDeclaration;
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
    _includeTags: string[];
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
    /** @type {WeakMap<PackageTestDeclaration, {testArgs: TestArgs, testData: TestData}>} */
    _testCompatibility: WeakMap<PackageTestDeclaration, {
        testArgs: TestArgs;
        testData: TestData;
    }>;
    /** @type {WeakSet<PackageTestDeclaration>} */
    _injectedTests: WeakSet<PackageTestDeclaration>;
    /** @type {WeakSet<PackageTestDeclaration>} */
    _completedTests: WeakSet<PackageTestDeclaration>;
    /** @type {WeakMap<PackageTestDeclaration, {descriptions: string[], testDescription: string, fullDescription: string, ownerFilePath: string | undefined, suites: PackageSuiteDeclaration[]}>} */
    _testMetadata: WeakMap<PackageTestDeclaration, {
        descriptions: string[];
        testDescription: string;
        fullDescription: string;
        ownerFilePath: string | undefined;
        suites: PackageSuiteDeclaration[];
    }>;
    /** @type {WeakMap<PackageHookDeclaration, {declarationIndex: number, declarationScopeId: string | undefined, ownerFilePath: string | undefined}>} */
    _hookMetadata: WeakMap<PackageHookDeclaration, {
        declarationIndex: number;
        declarationScopeId: string | undefined;
        ownerFilePath: string | undefined;
    }>;
    /** @type {WeakMap<PackageTestDeclaration, Map<number, {abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean}>>} */
    _attemptOutcomes: WeakMap<PackageTestDeclaration, Map<number, {
        abortRemainingTests: boolean;
        error: ReturnType<typeof JSON.parse>;
        failed: boolean;
    }>>;
    /** @type {Array<{suite: PackageSuiteDeclaration, phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} */
    _suiteHookFailures: Array<{
        suite: PackageSuiteDeclaration;
        phase: "beforeAll" | "afterAll";
        error: ReturnType<typeof JSON.parse>;
    }>;
    /** @type {Map<string, PackageTestDeclaration[]>} */
    _testsByFullName: Map<string, PackageTestDeclaration[]>;
    /** @type {WeakMap<PackageRegistration, string>} */
    _declarationOwners: WeakMap<PackageRegistration, string>;
    /** @type {PackageTestRunner | undefined} */
    _packageRunner: PackageTestRunner | undefined;
    /** @type {import("@velocious/testing/runner").TestRunResult | undefined} */
    _packageResult: import("@velocious/testing/runner").TestRunResult | undefined;
    /** @type {Map<string, TestData> | undefined} */
    _legacyFixtureDataByFullName: Map<string, TestData> | undefined;
    /** @type {{filePath?: string, line?: number}} */
    _legacyFixtureLocation: {
        filePath?: string;
        line?: number;
    };
    _attemptExecutor: VelociousAttemptExecutor;
    _runnerReporter: VelociousRunnerReporter;
    _suiteHookExecutor: VelociousSuiteHookExecutor;
    _testArguments: VelociousTestArguments;
    _application: Application | undefined;
    _requestClient: RequestClient | undefined;
    anyTestsFocussed: boolean | undefined;
    /** @type {PackageTestContext} */
    _context: PackageTestContext;
    /**
     * Narrows the runtime value to the documented type.
     * @type {FailedTestDetail[]} */
    _failedTestDetails: FailedTestDetail[];
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
    constructor({ configuration, context, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, profiler, ...restArgs }: {
        configuration: import("../configuration.js").default;
        context?: PackageTestContext;
        excludeTags?: string[] | string;
        includeTags?: string[] | string;
        testFiles: Array<string>;
        lineFilters?: Record<string, number[]>;
        examplePatterns?: RegExp[];
        profiler?: import("./test-profiler.js").default;
    });
    /**
     * Gets the package declaration context.
     * @returns {PackageTestContext} - Package declaration context.
     */
    getTestContext(): PackageTestContext;
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
     * Collects package declaration objects by identity.
     * @param {Set<PackageRegistration>} [registrations] - Accumulated identities.
     * @returns {Set<PackageRegistration>} - Registration identities.
     */
    testRegistrationObjects(registrations?: Set<PackageRegistration>): Set<PackageRegistration>;
    /**
     * Assigns deterministic ownership to package declarations added by one entry file.
     * @param {Set<PackageRegistration>} previousRegistrations - Identities present before import.
     * @param {string} ownerFilePath - Importing entry file.
     * @returns {void}
     */
    assignTestRegistrationOwnership(previousRegistrations: Set<PackageRegistration>, ownerFilePath: string): void;
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
     * Captures a test source location without attributing package/facade frames.
     * @param {string | undefined} ownerFilePath - Importing entry file fallback.
     * @returns {{filePath?: string, line?: number}} - Declaration location.
     */
    captureTestDeclarationLocation(ownerFilePath: string | undefined): {
        filePath?: string;
        line?: number;
    };
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
    /** Builds declaration metadata used only by framework adapters and projections. */
    analyzeDeclarations(): void;
    /**
     * Gets package hook compatibility metadata.
     * @param {PackageHookDeclaration} hook - Package hook declaration.
     * @returns {{declarationIndex: number, declarationScopeId: string | undefined, ownerFilePath: string | undefined}} - Hook metadata.
     */
    hookMetadata(hook: PackageHookDeclaration): {
        declarationIndex: number;
        declarationScopeId: string | undefined;
        ownerFilePath: string | undefined;
    };
    /**
     * Gets package test compatibility metadata.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {{descriptions: string[], testDescription: string, fullDescription: string, ownerFilePath: string | undefined, suites: PackageSuiteDeclaration[]}} - Declaration metadata.
     */
    testMetadata(test: PackageTestDeclaration): {
        descriptions: string[];
        testDescription: string;
        fullDescription: string;
        ownerFilePath: string | undefined;
        suites: PackageSuiteDeclaration[];
    };
    /**
     * Gets stable compatibility data for a package declaration.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {{testArgs: TestArgs, testData: TestData}} - Stable compatibility data.
     */
    testData(test: PackageTestDeclaration): {
        testArgs: TestArgs;
        testData: TestData;
    };
    /**
     * Injects framework collaborators into stable compatibility data once.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {Promise<{testArgs: TestArgs, testData: TestData}>} - Injected compatibility data.
     */
    testCompatibility(test: PackageTestDeclaration): Promise<{
        testArgs: TestArgs;
        testData: TestData;
    }>;
    /**
     * Records a raw framework attempt outcome.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @param {number} attemptNumber - One-based attempt number.
     * @param {{abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean}} outcome - Raw attempt outcome.
     * @returns {void}
     */
    recordAttemptOutcome(test: PackageTestDeclaration, attemptNumber: number, outcome: {
        abortRemainingTests: boolean;
        error: ReturnType<typeof JSON.parse>;
        failed: boolean;
    }): void;
    /**
     * Gets a raw framework attempt outcome.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @param {number} attemptNumber - One-based attempt number.
     * @returns {{abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean} | undefined} - Raw attempt outcome.
     */
    attemptOutcome(test: PackageTestDeclaration, attemptNumber: number): {
        abortRemainingTests: boolean;
        error: ReturnType<typeof JSON.parse>;
        failed: boolean;
    } | undefined;
    /**
     * Records a raw suite-hook failure.
     * @param {object} failure - Suite-hook failure.
     * @param {PackageSuiteDeclaration} failure.suite - Owning package suite.
     * @param {"beforeAll" | "afterAll"} failure.phase - Hook phase.
     * @param {ReturnType<typeof JSON.parse>} failure.error - Raw hook failure.
     * @returns {void}
     */
    recordSuiteHookFailure(failure: {
        suite: PackageSuiteDeclaration;
        phase: "beforeAll" | "afterAll";
        error: ReturnType<typeof JSON.parse>;
    }): void;
    /**
     * Gets the raw ancestor setup failure for a package test.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {ReturnType<typeof JSON.parse>} - Raw setup failure.
     */
    setupFailureFor(test: PackageTestDeclaration): ReturnType<typeof JSON.parse>;
    /**
     * Finds the next incomplete declaration with a package full name.
     * @param {string} fullName - Package full name.
     * @returns {PackageTestDeclaration | undefined} - Next matching declaration.
     */
    findTestDeclaration(fullName: string): PackageTestDeclaration | undefined;
    /**
     * Marks a package declaration complete.
     * @param {PackageTestDeclaration} test - Completed declaration.
     * @returns {void}
     */
    completeTestDeclaration(test: PackageTestDeclaration): void;
    /**
     * Gets the effective package retry count.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {number} - Effective retry count.
     */
    retryCount(test: PackageTestDeclaration): number;
    /**
     * Normalizes retry inputs for the package execution boundary while retaining
     * the declarations' original public options after the run.
     * @returns {() => void} - Restores original declaration options.
     */
    normalizePackageRetriesForExecution(): () => void;
    /**
     * Records one completed test duration.
     * @param {{durationMs: number, filePath: string, fullDescription: string, line: number}} duration - Completed test duration.
     * @returns {void}
     */
    recordTestDuration(duration: {
        durationMs: number;
        filePath: string;
        fullDescription: string;
        line: number;
    }): void;
    /** Records one successful package result. */
    recordSuccessfulTest(): void;
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
    recordFailedTest({ descriptions, error, consoleOutput, testData, testDescription }: {
        descriptions: string[];
        error: ReturnType<typeof JSON.parse>;
        consoleOutput: string;
        testData: TestData;
        testDescription: string;
    }): void;
    /**
     * Stores the completed package result.
     * @param {import("@velocious/testing/runner").TestRunResult} result - Package result.
     * @returns {void}
     */
    recordPackageResult(result: import("@velocious/testing/runner").TestRunResult): void;
    /**
     * Runs the package kernel with Velocious framework adapters.
     * @returns {Promise<void>} - Resolves after execution and teardown.
     */
    runPackageTests(): Promise<void>;
    /**
     * Aggregates raw after-all failures without using error truthiness.
     * @param {Array<{phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} failures - Hook failures.
     * @returns {{failed: false} | {failed: true, error: ReturnType<typeof JSON.parse>}} - Explicit afterAll outcome.
     */
    afterAllOutcome(failures: Array<{
        phase: "beforeAll" | "afterAll";
        error: ReturnType<typeof JSON.parse>;
    }>): {
        failed: false;
    } | {
        failed: true;
        error: ReturnType<typeof JSON.parse>;
    };
    /**
     * Throws one raw or aggregated after-all failure.
     * @param {Array<{phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} failures - Hook failures.
     * @returns {void}
     */
    throwAfterAllFailures(failures: Array<{
        phase: "beforeAll" | "afterAll";
        error: ReturnType<typeof JSON.parse>;
    }>): void;
    /**
     * Compatibility helper for focused framework lifecycle specs. It converts an
     * explicit legacy fixture into isolated package declarations; the package
     * runner remains the sole execution engine.
     * @param {object} args - Legacy fixture arguments.
     * @param {TestsArgument} args.tests - Fixture tree.
     * @returns {Promise<void>} - Resolves after package execution.
     */
    runTests({ tests }: {
        tests: TestsArgument;
    }): Promise<void>;
    /**
     * Declares an isolated legacy-shaped test fixture into a package context.
     * @param {PackageTestContext} context - Isolated package context.
     * @param {string} name - Suite name.
     * @param {TestsArgument} scope - Legacy fixture scope.
     * @param {string[]} descriptions - Ancestor descriptions.
     * @returns {void}
     */
    declareLegacyFixture(context: PackageTestContext, name: string, scope: TestsArgument, descriptions: string[]): void;
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
}
//# sourceMappingURL=test-runner.d.ts.map