// @ts-check
import { TestDatabaseAccessRevokedError } from "../environment-handlers/base.js";
import { clearDeliveries } from "../mailer.js";
import restArgsError from "../utils/rest-args-error.js";
import { clearTimeout as realClearTimeout, setTimeout as realSetTimeout } from "node:timers";
/** @typedef {import("@velocious/testing/runner").AttemptExecutorInput["beforeEach"][number]} PackageHookDeclaration */
/**
 * Marks one whole-lifecycle timeout while its underlying promise keeps running.
 * @typedef {Error & {velociousTestTimeout?: true}} TestTimeoutError
 */
/**
 * Runs one promise with a lifecycle timeout.
 * @param {Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} promise - Promise or value.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @param {string} testDescription - Test description.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Lifecycle result.
 */
function runWithTimeout(promise, timeoutMs, testDescription) {
    const timeoutSeconds = (timeoutMs / 1000).toFixed(3).replace(/\.?0+$/, "");
    /** @type {TestTimeoutError} */
    const timeoutError = new Error(`Timed out after ${timeoutSeconds}s: ${testDescription}`);
    timeoutError.velociousTestTimeout = true;
    return new Promise((resolve, reject) => {
        const timeout = realSetTimeout(() => reject(timeoutError), timeoutMs);
        Promise.resolve(promise).then((result) => {
            realClearTimeout(timeout);
            resolve(result);
        }).catch((error) => {
            realClearTimeout(timeout);
            reject(error);
        });
    });
}
/**
 * Waits for detached lifecycle cleanup up to the timeout grace period.
 * @param {Promise<ReturnType<typeof JSON.parse>>} lifecycle - Detached lifecycle promise.
 * @param {number} graceMs - Maximum wait.
 * @returns {Promise<{settled: false} | {settled: true, status: "fulfilled"} | {settled: true, status: "rejected", reason: ReturnType<typeof JSON.parse>}>} - Settlement outcome.
 */
function awaitSettledOrGrace(lifecycle, graceMs) {
    return new Promise((resolve) => {
        let settled = false;
        const graceTimer = realSetTimeout(() => {
            if (settled)
                return;
            settled = true;
            resolve({ settled: false });
        }, graceMs);
        Promise.resolve(lifecycle).then(() => {
            if (settled)
                return;
            settled = true;
            realClearTimeout(graceTimer);
            resolve({ settled: true, status: "fulfilled" });
        }, (reason) => {
            if (settled)
                return;
            settled = true;
            realClearTimeout(graceTimer);
            resolve({ settled: true, status: "rejected", reason });
        });
    });
}
/**
 * Checks whether a late lifecycle stopped only because its attempt access was revoked.
 * @param {ReturnType<typeof JSON.parse>} error - Lifecycle rejection.
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
export default class VelociousAttemptExecutor {
    /**
     * Creates an executor for framework-owned attempt lifecycle work.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }) {
        restArgsError(restArgs);
        this.testRunner = testRunner;
    }
    /**
     * Normalizes the legacy timeout contract at the framework adapter boundary.
     * @param {number | undefined} timeoutMs - Declared package timeout.
     * @returns {number | undefined} - Positive finite timeout, or no timeout.
     */
    normalizeTimeoutMs(timeoutMs) {
        return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined;
    }
    /**
     * Executes exactly one complete Velocious-owned test attempt.
     * @param {import("@velocious/testing/runner").AttemptExecutorInput} input - Package attempt.
     * @returns {Promise<void>} - Resolves after one complete framework attempt.
     */
    async execute({ afterEach, args, attemptNumber, beforeEach, context, defaultExecute, fullName, suite, test, timeoutMs, ...restArgs }) {
        restArgsError(restArgs);
        void context;
        void defaultExecute;
        void suite;
        const testRunner = this.testRunner;
        const effectiveTimeoutMs = this.normalizeTimeoutMs(timeoutMs);
        const compatibility = await testRunner.testCompatibility(test);
        const { testArgs, testData } = compatibility;
        const metadata = testRunner.testMetadata(test);
        const { descriptions, testDescription } = metadata;
        /** @type {ReturnType<typeof JSON.parse>} */
        let caughtError;
        let failed = false;
        /** @type {Promise<ReturnType<typeof JSON.parse>> | undefined} */
        let testLifecycle;
        /** @type {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} */
        let testSharedConnectionRegistrations = [];
        let testSharedConnectionsActive = false;
        /** @type {import("./test-runner.js").SharedTransactionBrokerRegistration | undefined} */
        let sharedTransactionBrokerRegistration;
        /** @type {import("./test-runner.js").SharedTransactionBrokerRegistration | undefined} */
        let sharedTransactionBrokerPreparation;
        /** @type {import("./test-runner.js").TransactionalTenantRegistration[]} */
        const transactionalTenantRegistrations = [];
        /** @type {import("./test-runner.js").BrowserDummyConnectionRegistration[]} */
        const browserDummyConnectionRegistrations = [];
        const testDatabaseAccessScope = { revoked: false };
        /** @type {Set<Error>} */
        const recordedTimeoutCleanupErrors = new Set();
        let abortRemainingTests = false;
        let attemptTimedOut = false;
        testArgs.registerTransactionalTenant = async (args) => {
            await testRunner.registerTransactionalTenant(args, transactionalTenantRegistrations);
        };
        const profiler = testRunner._profiler;
        const profileTestData = {
            ...test,
            filePath: testData.filePath,
            line: testData.line,
            ownerFilePath: testData.ownerFilePath ?? metadata.ownerFilePath
        };
        const profileAttempt = profiler?.startAttempt({
            descriptions,
            attemptNumber,
            testData: profileTestData,
            testDescription
        });
        try {
            const runLifecycleCallback = async () => await testRunner.runWithDummyIfNeeded(testArgs, async () => {
                const useTransaction = testArgs.databaseCleaning?.transaction === true;
                const shouldTruncate = testArgs.databaseCleaning?.truncate ?? !useTransaction;
                const useSharedTestConnections = useTransaction || testArgs.type == "request";
                const useTestConnections = useSharedTestConnections || shouldTruncate;
                const runTestAttempt = async () => {
                    if (useSharedTestConnections) {
                        testSharedConnectionRegistrations = testRunner.activateTestSharedConnections();
                        testSharedConnectionsActive = true;
                    }
                    /** @type {ReturnType<typeof JSON.parse>[]} */
                    const lifecycleErrors = [];
                    let runCleanupHooks = false;
                    try {
                        if (useSharedTestConnections) {
                            sharedTransactionBrokerPreparation = await testRunner.prepareSharedTransactionBroker();
                        }
                        runCleanupHooks = true;
                        clearDeliveries();
                        await this.runBeforeEaches({ beforeEaches: beforeEach, testArgs, testData });
                        if (useSharedTestConnections) {
                            const activeConnections = testRunner.sharedTransactionConnections({ transactionsOnly: true });
                            if (sharedTransactionBrokerPreparation && !testRunner.sharedTransactionBrokerMatchesConnections(sharedTransactionBrokerPreparation, activeConnections)) {
                                testRunner.clearTestSharedConnections(testSharedConnectionRegistrations);
                                testSharedConnectionRegistrations = [];
                                testSharedConnectionsActive = false;
                            }
                            sharedTransactionBrokerRegistration = await testRunner.startSharedTransactionBroker(sharedTransactionBrokerPreparation, activeConnections);
                            sharedTransactionBrokerPreparation = undefined;
                            if (sharedTransactionBrokerRegistration && !testSharedConnectionsActive) {
                                testSharedConnectionRegistrations = testRunner.activateTestSharedConnections();
                                testSharedConnectionsActive = true;
                            }
                        }
                        testRunner._lastTestContext = {
                            fullDescription: fullName,
                            filePath: testData.filePath ?? "<unknown>",
                            line: testData.line ?? 0
                        };
                        await testRunner.runProfileSpan({ phase: "test body", filePath: testData.ownerFilePath ?? testData.filePath }, async () => {
                            await test.callback(...args);
                        });
                    }
                    catch (error) {
                        lifecycleErrors.push(error);
                    }
                    if (runCleanupHooks) {
                        try {
                            await testRunner.getConfiguration().awaitPendingBroadcasts();
                        }
                        catch (error) {
                            lifecycleErrors.push(error);
                        }
                        try {
                            if (testSharedConnectionsActive) {
                                testRunner.clearTestSharedConnections(testSharedConnectionRegistrations);
                                testSharedConnectionRegistrations = [];
                                testSharedConnectionsActive = false;
                            }
                        }
                        catch (error) {
                            lifecycleErrors.push(error);
                        }
                        try {
                            await testRunner.stopSharedTransactionBroker(sharedTransactionBrokerRegistration || sharedTransactionBrokerPreparation);
                            sharedTransactionBrokerRegistration = undefined;
                            sharedTransactionBrokerPreparation = undefined;
                        }
                        catch (error) {
                            lifecycleErrors.push(error);
                        }
                        try {
                            await this.runAfterEaches({ afterEaches: [...afterEach].reverse(), testArgs, testData });
                        }
                        catch (error) {
                            lifecycleErrors.push(error);
                        }
                        try {
                            await testRunner.cleanupTransactionalTenants(transactionalTenantRegistrations);
                        }
                        catch (error) {
                            lifecycleErrors.push(error);
                        }
                    }
                    if (testSharedConnectionsActive) {
                        try {
                            testRunner.clearTestSharedConnections(testSharedConnectionRegistrations);
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
                    await testRunner.getConfiguration().ensureConnections({ name: `Test: ${testDescription}` }, runTestAttempt);
                }
                else {
                    await runTestAttempt();
                }
            }, browserDummyConnectionRegistrations);
            const lifecycleCallback = async () => await testRunner.getConfiguration().runWithTestDatabaseAccessScope(testDatabaseAccessScope, runLifecycleCallback);
            testLifecycle = profileAttempt && profiler
                ? profiler.runAttempt(profileAttempt, lifecycleCallback)
                : lifecycleCallback();
            if (effectiveTimeoutMs !== undefined) {
                await runWithTimeout(testLifecycle, effectiveTimeoutMs, testDescription);
            }
            else {
                await testLifecycle;
            }
        }
        catch (error) {
            failed = true;
            caughtError = error;
            const timedOut = Boolean(/** @type {TestTimeoutError} */ (error)?.velociousTestTimeout);
            attemptTimedOut = timedOut;
            if (timedOut && testLifecycle) {
                const emergencyCleanupErrors = [];
                if (profileAttempt && profiler)
                    profiler.finishAttempt(profileAttempt, "timed-out");
                const lifecycleOutcome = await awaitSettledOrGrace(testLifecycle, effectiveTimeoutMs ?? 60000);
                if (lifecycleOutcome.settled && lifecycleOutcome.status === "rejected") {
                    emergencyCleanupErrors.push(lifecycleOutcome.reason);
                }
                if (!lifecycleOutcome.settled) {
                    testDatabaseAccessScope.revoked = true;
                    void testLifecycle.catch((cleanupError) => {
                        if (isTestDatabaseAccessRevocation(cleanupError))
                            return;
                        testRunner.recordTimeoutCleanupFailure(cleanupError, "test lifecycle", recordedTimeoutCleanupErrors);
                    });
                    const quarantine = testRunner.quarantineBrowserDummyConnections(browserDummyConnectionRegistrations);
                    const quarantineOutcome = await awaitSettledOrGrace(quarantine, effectiveTimeoutMs ?? 60000);
                    const usesBrowserTransactions = testArgs.databaseCleaning?.transaction === true;
                    const usesBrowserTruncation = testArgs.databaseCleaning?.truncate ?? !usesBrowserTransactions;
                    abortRemainingTests = testRunner.isBrowserTestMode()
                        && testRunner.hasTag(testArgs, "dummy")
                        && (usesBrowserTransactions || usesBrowserTruncation);
                    if (quarantineOutcome.settled && quarantineOutcome.status === "rejected") {
                        emergencyCleanupErrors.push(quarantineOutcome.reason);
                    }
                    else if (!quarantineOutcome.settled) {
                        void quarantine.catch((cleanupError) => {
                            testRunner.recordTimeoutCleanupFailure(cleanupError, "browser dummy connection quarantine", recordedTimeoutCleanupErrors);
                        });
                    }
                }
                try {
                    if (testSharedConnectionsActive) {
                        testRunner.clearTestSharedConnections(testSharedConnectionRegistrations);
                        testSharedConnectionRegistrations = [];
                        testSharedConnectionsActive = false;
                    }
                }
                catch (cleanupError) {
                    emergencyCleanupErrors.push(cleanupError);
                }
                const brokerCleanup = testRunner.stopSharedTransactionBroker(sharedTransactionBrokerRegistration || sharedTransactionBrokerPreparation);
                const brokerCleanupOutcome = await awaitSettledOrGrace(brokerCleanup, effectiveTimeoutMs ?? 60000);
                if (brokerCleanupOutcome.settled && brokerCleanupOutcome.status === "rejected") {
                    emergencyCleanupErrors.push(brokerCleanupOutcome.reason);
                }
                else if (!brokerCleanupOutcome.settled) {
                    void brokerCleanup.catch((cleanupError) => {
                        testRunner.recordTimeoutCleanupFailure(cleanupError, "shared transaction broker", recordedTimeoutCleanupErrors);
                    });
                }
                sharedTransactionBrokerRegistration = undefined;
                sharedTransactionBrokerPreparation = undefined;
                const emergencyCleanup = testRunner.cleanupTransactionalTenants(transactionalTenantRegistrations, { discard: true });
                const emergencyCleanupOutcome = await awaitSettledOrGrace(emergencyCleanup, effectiveTimeoutMs ?? 60000);
                if (emergencyCleanupOutcome.settled && emergencyCleanupOutcome.status === "rejected") {
                    emergencyCleanupErrors.push(emergencyCleanupOutcome.reason);
                }
                else if (!emergencyCleanupOutcome.settled) {
                    void emergencyCleanup.catch((cleanupError) => {
                        testRunner.recordTimeoutCleanupFailure(cleanupError, "transactional tenant", recordedTimeoutCleanupErrors);
                    });
                }
                if (emergencyCleanupErrors.length > 0) {
                    caughtError = new AggregateError([caughtError, ...emergencyCleanupErrors], "Test timeout and emergency cleanup failed", { cause: caughtError });
                }
            }
            if (browserDummyConnectionRegistrations.some((registration) => registration.quarantined)) {
                testDatabaseAccessScope.revoked = true;
                abortRemainingTests = true;
            }
        }
        finally {
            testDatabaseAccessScope.revoked = true;
            if (profileAttempt && profiler) {
                profiler.finishAttempt(profileAttempt, failed
                    ? (attemptTimedOut ? "timed-out" : "failed")
                    : "passed");
            }
        }
        testRunner.recordAttemptOutcome(test, attemptNumber, {
            abortRemainingTests,
            error: caughtError,
            failed
        });
        if (failed)
            throw caughtError;
    }
    /**
     * Runs before-each hooks in inherited declaration order.
     * @param {object} args - Hook arguments.
     * @param {PackageHookDeclaration[]} args.beforeEaches - Setup hooks.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @returns {Promise<void>} - Resolves after all setup hooks complete.
     */
    async runBeforeEaches({ beforeEaches, testArgs, testData }) {
        for (const hook of beforeEaches) {
            const metadata = this.testRunner.hookMetadata(hook);
            await this.testRunner.runProfileSpan({
                phase: "beforeEach",
                declarationIndex: metadata.declarationIndex,
                declarationScopeId: metadata.declarationScopeId,
                filePath: metadata.ownerFilePath
            }, async () => {
                await hook.callback({ configuration: this.testRunner.getConfiguration(), testArgs, testData });
            });
        }
    }
    /**
     * Runs every after-each hook while preserving all failures.
     * @param {object} args - Hook arguments.
     * @param {PackageHookDeclaration[]} args.afterEaches - Cleanup hooks.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @returns {Promise<void>} - Resolves after every cleanup hook settles.
     */
    async runAfterEaches({ afterEaches, testArgs, testData }) {
        /** @type {ReturnType<typeof JSON.parse>[]} */
        const errors = [];
        for (const hook of afterEaches) {
            const metadata = this.testRunner.hookMetadata(hook);
            try {
                await this.testRunner.runProfileSpan({
                    phase: "afterEach",
                    declarationIndex: metadata.declarationIndex,
                    declarationScopeId: metadata.declarationScopeId,
                    filePath: metadata.ownerFilePath
                }, async () => {
                    await hook.callback({ configuration: this.testRunner.getConfiguration(), testArgs, testData });
                });
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length == 1)
            throw errors[0];
        if (errors.length > 1) {
            throw new AggregateError(errors, "Multiple afterEach hooks failed", { cause: errors[0] });
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLWF0dGVtcHQtZXhlY3V0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy92ZWxvY2lvdXMtYXR0ZW1wdC1leGVjdXRvci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLDhCQUE4QixFQUFFLE1BQU0saUNBQWlDLENBQUE7QUFDaEYsT0FBTyxFQUFFLGVBQWUsRUFBRSxNQUFNLGNBQWMsQ0FBQTtBQUM5QyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLEVBQUMsWUFBWSxJQUFJLGdCQUFnQixFQUFFLFVBQVUsSUFBSSxjQUFjLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFFMUYsdUhBQXVIO0FBRXZIOzs7R0FHRztBQUVIOzs7Ozs7R0FNRztBQUNILFNBQVMsY0FBYyxDQUFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsZUFBZTtJQUN6RCxNQUFNLGNBQWMsR0FBRyxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUMxRSwrQkFBK0I7SUFDL0IsTUFBTSxZQUFZLEdBQUcsSUFBSSxLQUFLLENBQUMsbUJBQW1CLGNBQWMsTUFBTSxlQUFlLEVBQUUsQ0FBQyxDQUFBO0lBQ3hGLFlBQVksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLENBQUE7SUFFeEMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUNyQyxNQUFNLE9BQU8sR0FBRyxjQUFjLENBQUMsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFBO1FBRXJFLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUU7WUFDdkMsZ0JBQWdCLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDekIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ2pCLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQ2pCLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3pCLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUNmLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLG1CQUFtQixDQUFDLFNBQVMsRUFBRSxPQUFPO0lBQzdDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRTtRQUM3QixJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUE7UUFDbkIsTUFBTSxVQUFVLEdBQUcsY0FBYyxDQUFDLEdBQUcsRUFBRTtZQUNyQyxJQUFJLE9BQU87Z0JBQUUsT0FBTTtZQUVuQixPQUFPLEdBQUcsSUFBSSxDQUFBO1lBQ2QsT0FBTyxDQUFDLEVBQUMsT0FBTyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDM0IsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBRVgsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQzdCLEdBQUcsRUFBRTtZQUNILElBQUksT0FBTztnQkFBRSxPQUFNO1lBRW5CLE9BQU8sR0FBRyxJQUFJLENBQUE7WUFDZCxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUM1QixPQUFPLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQy9DLENBQUMsRUFDRCxDQUFDLE1BQU0sRUFBRSxFQUFFO1lBQ1QsSUFBSSxPQUFPO2dCQUFFLE9BQU07WUFFbkIsT0FBTyxHQUFHLElBQUksQ0FBQTtZQUNkLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQzVCLE9BQU8sQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBQ3RELENBQUMsQ0FDRixDQUFBO0lBQ0gsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsOEJBQThCLENBQUMsS0FBSztJQUMzQyxJQUFJLEtBQUssWUFBWSw4QkFBOEI7UUFBRSxPQUFPLElBQUksQ0FBQTtJQUNoRSxJQUFJLEtBQUssWUFBWSxjQUFjLEVBQUUsQ0FBQztRQUNwQyxPQUFPLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUMsOEJBQThCLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQTtJQUNwSCxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUE7QUFDZCxDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyx3QkFBd0I7SUFDM0M7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxVQUFVLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDbkMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsa0JBQWtCLENBQUMsU0FBUztRQUMxQixPQUFPLE9BQU8sU0FBUyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO0lBQzdHLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUNoSSxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDdkIsS0FBSyxPQUFPLENBQUE7UUFDWixLQUFLLGNBQWMsQ0FBQTtRQUNuQixLQUFLLEtBQUssQ0FBQTtRQUNWLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUE7UUFDbEMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDN0QsTUFBTSxhQUFhLEdBQUcsTUFBTSxVQUFVLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDOUQsTUFBTSxFQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUMsR0FBRyxhQUFhLENBQUE7UUFDMUMsTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5QyxNQUFNLEVBQUMsWUFBWSxFQUFFLGVBQWUsRUFBQyxHQUFHLFFBQVEsQ0FBQTtRQUNoRCw0Q0FBNEM7UUFDNUMsSUFBSSxXQUFXLENBQUE7UUFDZixJQUFJLE1BQU0sR0FBRyxLQUFLLENBQUE7UUFDbEIsaUVBQWlFO1FBQ2pFLElBQUksYUFBYSxDQUFBO1FBQ2pCLHNKQUFzSjtRQUN0SixJQUFJLGlDQUFpQyxHQUFHLEVBQUUsQ0FBQTtRQUMxQyxJQUFJLDJCQUEyQixHQUFHLEtBQUssQ0FBQTtRQUN2Qyx5RkFBeUY7UUFDekYsSUFBSSxtQ0FBbUMsQ0FBQTtRQUN2Qyx5RkFBeUY7UUFDekYsSUFBSSxrQ0FBa0MsQ0FBQTtRQUN0QywyRUFBMkU7UUFDM0UsTUFBTSxnQ0FBZ0MsR0FBRyxFQUFFLENBQUE7UUFDM0MsOEVBQThFO1FBQzlFLE1BQU0sbUNBQW1DLEdBQUcsRUFBRSxDQUFBO1FBQzlDLE1BQU0sdUJBQXVCLEdBQUcsRUFBQyxPQUFPLEVBQUUsS0FBSyxFQUFDLENBQUE7UUFDaEQseUJBQXlCO1FBQ3pCLE1BQU0sNEJBQTRCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUM5QyxJQUFJLG1CQUFtQixHQUFHLEtBQUssQ0FBQTtRQUMvQixJQUFJLGVBQWUsR0FBRyxLQUFLLENBQUE7UUFDM0IsUUFBUSxDQUFDLDJCQUEyQixHQUFHLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRTtZQUNwRCxNQUFNLFVBQVUsQ0FBQywyQkFBMkIsQ0FBQyxJQUFJLEVBQUUsZ0NBQWdDLENBQUMsQ0FBQTtRQUN0RixDQUFDLENBQUE7UUFDRCxNQUFNLFFBQVEsR0FBRyxVQUFVLENBQUMsU0FBUyxDQUFBO1FBQ3JDLE1BQU0sZUFBZSxHQUFHO1lBQ3RCLEdBQUcsSUFBSTtZQUNQLFFBQVEsRUFBRSxRQUFRLENBQUMsUUFBUTtZQUMzQixJQUFJLEVBQUUsUUFBUSxDQUFDLElBQUk7WUFDbkIsYUFBYSxFQUFFLFFBQVEsQ0FBQyxhQUFhLElBQUksUUFBUSxDQUFDLGFBQWE7U0FDaEUsQ0FBQTtRQUNELE1BQU0sY0FBYyxHQUFHLFFBQVEsRUFBRSxZQUFZLENBQUM7WUFDNUMsWUFBWTtZQUNaLGFBQWE7WUFDYixRQUFRLEVBQUUsZUFBZTtZQUN6QixlQUFlO1NBQ2hCLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQztZQUNILE1BQU0sb0JBQW9CLEdBQUcsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ2xHLE1BQU0sY0FBYyxHQUFHLFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxXQUFXLEtBQUssSUFBSSxDQUFBO2dCQUN0RSxNQUFNLGNBQWMsR0FBRyxRQUFRLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxJQUFJLENBQUMsY0FBYyxDQUFBO2dCQUM3RSxNQUFNLHdCQUF3QixHQUFHLGNBQWMsSUFBSSxRQUFRLENBQUMsSUFBSSxJQUFJLFNBQVMsQ0FBQTtnQkFDN0UsTUFBTSxrQkFBa0IsR0FBRyx3QkFBd0IsSUFBSSxjQUFjLENBQUE7Z0JBQ3JFLE1BQU0sY0FBYyxHQUFHLEtBQUssSUFBSSxFQUFFO29CQUNoQyxJQUFJLHdCQUF3QixFQUFFLENBQUM7d0JBQzdCLGlDQUFpQyxHQUFHLFVBQVUsQ0FBQyw2QkFBNkIsRUFBRSxDQUFBO3dCQUM5RSwyQkFBMkIsR0FBRyxJQUFJLENBQUE7b0JBQ3BDLENBQUM7b0JBQ0QsOENBQThDO29CQUM5QyxNQUFNLGVBQWUsR0FBRyxFQUFFLENBQUE7b0JBQzFCLElBQUksZUFBZSxHQUFHLEtBQUssQ0FBQTtvQkFFM0IsSUFBSSxDQUFDO3dCQUNILElBQUksd0JBQXdCLEVBQUUsQ0FBQzs0QkFDN0Isa0NBQWtDLEdBQUcsTUFBTSxVQUFVLENBQUMsOEJBQThCLEVBQUUsQ0FBQTt3QkFDeEYsQ0FBQzt3QkFDRCxlQUFlLEdBQUcsSUFBSSxDQUFBO3dCQUV0QixlQUFlLEVBQUUsQ0FBQTt3QkFDakIsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLEVBQUMsWUFBWSxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTt3QkFFMUUsSUFBSSx3QkFBd0IsRUFBRSxDQUFDOzRCQUM3QixNQUFNLGlCQUFpQixHQUFHLFVBQVUsQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLGdCQUFnQixFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7NEJBQzNGLElBQUksa0NBQWtDLElBQUksQ0FBQyxVQUFVLENBQUMseUNBQXlDLENBQUMsa0NBQWtDLEVBQUUsaUJBQWlCLENBQUMsRUFBRSxDQUFDO2dDQUN2SixVQUFVLENBQUMsMEJBQTBCLENBQUMsaUNBQWlDLENBQUMsQ0FBQTtnQ0FDeEUsaUNBQWlDLEdBQUcsRUFBRSxDQUFBO2dDQUN0QywyQkFBMkIsR0FBRyxLQUFLLENBQUE7NEJBQ3JDLENBQUM7NEJBRUQsbUNBQW1DLEdBQUcsTUFBTSxVQUFVLENBQUMsNEJBQTRCLENBQUMsa0NBQWtDLEVBQUUsaUJBQWlCLENBQUMsQ0FBQTs0QkFDMUksa0NBQWtDLEdBQUcsU0FBUyxDQUFBOzRCQUM5QyxJQUFJLG1DQUFtQyxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQztnQ0FDeEUsaUNBQWlDLEdBQUcsVUFBVSxDQUFDLDZCQUE2QixFQUFFLENBQUE7Z0NBQzlFLDJCQUEyQixHQUFHLElBQUksQ0FBQTs0QkFDcEMsQ0FBQzt3QkFDSCxDQUFDO3dCQUVELFVBQVUsQ0FBQyxnQkFBZ0IsR0FBRzs0QkFDNUIsZUFBZSxFQUFFLFFBQVE7NEJBQ3pCLFFBQVEsRUFBRSxRQUFRLENBQUMsUUFBUSxJQUFJLFdBQVc7NEJBQzFDLElBQUksRUFBRSxRQUFRLENBQUMsSUFBSSxJQUFJLENBQUM7eUJBQ3pCLENBQUE7d0JBQ0QsTUFBTSxVQUFVLENBQUMsY0FBYyxDQUFDLEVBQUMsS0FBSyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLGFBQWEsSUFBSSxRQUFRLENBQUMsUUFBUSxFQUFDLEVBQUUsS0FBSyxJQUFJLEVBQUU7NEJBQ3RILE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFBO3dCQUM5QixDQUFDLENBQUMsQ0FBQTtvQkFDSixDQUFDO29CQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7d0JBQ2YsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtvQkFDN0IsQ0FBQztvQkFFRCxJQUFJLGVBQWUsRUFBRSxDQUFDO3dCQUNwQixJQUFJLENBQUM7NEJBQ0gsTUFBTSxVQUFVLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO3dCQUM5RCxDQUFDO3dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7NEJBQ2YsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTt3QkFDN0IsQ0FBQzt3QkFFRCxJQUFJLENBQUM7NEJBQ0gsSUFBSSwyQkFBMkIsRUFBRSxDQUFDO2dDQUNoQyxVQUFVLENBQUMsMEJBQTBCLENBQUMsaUNBQWlDLENBQUMsQ0FBQTtnQ0FDeEUsaUNBQWlDLEdBQUcsRUFBRSxDQUFBO2dDQUN0QywyQkFBMkIsR0FBRyxLQUFLLENBQUE7NEJBQ3JDLENBQUM7d0JBQ0gsQ0FBQzt3QkFBQyxPQUFPLEtBQUssRUFBRSxDQUFDOzRCQUNmLGVBQWUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7d0JBQzdCLENBQUM7d0JBRUQsSUFBSSxDQUFDOzRCQUNILE1BQU0sVUFBVSxDQUFDLDJCQUEyQixDQUFDLG1DQUFtQyxJQUFJLGtDQUFrQyxDQUFDLENBQUE7NEJBQ3ZILG1DQUFtQyxHQUFHLFNBQVMsQ0FBQTs0QkFDL0Msa0NBQWtDLEdBQUcsU0FBUyxDQUFBO3dCQUNoRCxDQUFDO3dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7NEJBQ2YsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTt3QkFDN0IsQ0FBQzt3QkFFRCxJQUFJLENBQUM7NEJBQ0gsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsV0FBVyxFQUFFLENBQUMsR0FBRyxTQUFTLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTt3QkFDeEYsQ0FBQzt3QkFBQyxPQUFPLEtBQUssRUFBRSxDQUFDOzRCQUNmLGVBQWUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7d0JBQzdCLENBQUM7d0JBRUQsSUFBSSxDQUFDOzRCQUNILE1BQU0sVUFBVSxDQUFDLDJCQUEyQixDQUFDLGdDQUFnQyxDQUFDLENBQUE7d0JBQ2hGLENBQUM7d0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQzs0QkFDZixlQUFlLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO3dCQUM3QixDQUFDO29CQUNILENBQUM7b0JBRUQsSUFBSSwyQkFBMkIsRUFBRSxDQUFDO3dCQUNoQyxJQUFJLENBQUM7NEJBQ0gsVUFBVSxDQUFDLDBCQUEwQixDQUFDLGlDQUFpQyxDQUFDLENBQUE7d0JBQzFFLENBQUM7d0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQzs0QkFDZixlQUFlLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO3dCQUM3QixDQUFDO3dCQUNELDJCQUEyQixHQUFHLEtBQUssQ0FBQTtvQkFDckMsQ0FBQztvQkFFRCxJQUFJLGVBQWUsQ0FBQyxNQUFNLElBQUksQ0FBQzt3QkFBRSxNQUFNLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtvQkFDekQsSUFBSSxlQUFlLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO3dCQUMvQixNQUFNLElBQUksY0FBYyxDQUFDLGVBQWUsRUFBRSxtQ0FBbUMsRUFBRSxFQUFDLEtBQUssRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFBO29CQUM3RyxDQUFDO2dCQUNILENBQUMsQ0FBQTtnQkFFRCxJQUFJLGtCQUFrQixFQUFFLENBQUM7b0JBQ3ZCLE1BQU0sVUFBVSxDQUFDLGdCQUFnQixFQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsU0FBUyxlQUFlLEVBQUUsRUFBQyxFQUFFLGNBQWMsQ0FBQyxDQUFBO2dCQUMzRyxDQUFDO3FCQUFNLENBQUM7b0JBQ04sTUFBTSxjQUFjLEVBQUUsQ0FBQTtnQkFDeEIsQ0FBQztZQUNILENBQUMsRUFBRSxtQ0FBbUMsQ0FBQyxDQUFBO1lBQ3ZDLE1BQU0saUJBQWlCLEdBQUcsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLDhCQUE4QixDQUFDLHVCQUF1QixFQUFFLG9CQUFvQixDQUFDLENBQUE7WUFDdkosYUFBYSxHQUFHLGNBQWMsSUFBSSxRQUFRO2dCQUN4QyxDQUFDLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxjQUFjLEVBQUUsaUJBQWlCLENBQUM7Z0JBQ3hELENBQUMsQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBRXZCLElBQUksa0JBQWtCLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQ3JDLE1BQU0sY0FBYyxDQUFDLGFBQWEsRUFBRSxrQkFBa0IsRUFBRSxlQUFlLENBQUMsQ0FBQTtZQUMxRSxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sTUFBTSxhQUFhLENBQUE7WUFDckIsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxHQUFHLElBQUksQ0FBQTtZQUNiLFdBQVcsR0FBRyxLQUFLLENBQUE7WUFDbkIsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLCtCQUErQixDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsb0JBQW9CLENBQUMsQ0FBQTtZQUN2RixlQUFlLEdBQUcsUUFBUSxDQUFBO1lBRTFCLElBQUksUUFBUSxJQUFJLGFBQWEsRUFBRSxDQUFDO2dCQUM5QixNQUFNLHNCQUFzQixHQUFHLEVBQUUsQ0FBQTtnQkFFakMsSUFBSSxjQUFjLElBQUksUUFBUTtvQkFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxXQUFXLENBQUMsQ0FBQTtnQkFDbkYsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLG1CQUFtQixDQUFDLGFBQWEsRUFBRSxrQkFBa0IsSUFBSSxLQUFLLENBQUMsQ0FBQTtnQkFFOUYsSUFBSSxnQkFBZ0IsQ0FBQyxPQUFPLElBQUksZ0JBQWdCLENBQUMsTUFBTSxLQUFLLFVBQVUsRUFBRSxDQUFDO29CQUN2RSxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQ3RELENBQUM7Z0JBRUQsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxDQUFDO29CQUM5Qix1QkFBdUIsQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFBO29CQUN0QyxLQUFLLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRTt3QkFDeEMsSUFBSSw4QkFBOEIsQ0FBQyxZQUFZLENBQUM7NEJBQUUsT0FBTTt3QkFDeEQsVUFBVSxDQUFDLDJCQUEyQixDQUFDLFlBQVksRUFBRSxnQkFBZ0IsRUFBRSw0QkFBNEIsQ0FBQyxDQUFBO29CQUN0RyxDQUFDLENBQUMsQ0FBQTtvQkFDRixNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsaUNBQWlDLENBQUMsbUNBQW1DLENBQUMsQ0FBQTtvQkFDcEcsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLG1CQUFtQixDQUFDLFVBQVUsRUFBRSxrQkFBa0IsSUFBSSxLQUFLLENBQUMsQ0FBQTtvQkFDNUYsTUFBTSx1QkFBdUIsR0FBRyxRQUFRLENBQUMsZ0JBQWdCLEVBQUUsV0FBVyxLQUFLLElBQUksQ0FBQTtvQkFDL0UsTUFBTSxxQkFBcUIsR0FBRyxRQUFRLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxJQUFJLENBQUMsdUJBQXVCLENBQUE7b0JBRTdGLG1CQUFtQixHQUFHLFVBQVUsQ0FBQyxpQkFBaUIsRUFBRTsyQkFDL0MsVUFBVSxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDOzJCQUNwQyxDQUFDLHVCQUF1QixJQUFJLHFCQUFxQixDQUFDLENBQUE7b0JBRXZELElBQUksaUJBQWlCLENBQUMsT0FBTyxJQUFJLGlCQUFpQixDQUFDLE1BQU0sS0FBSyxVQUFVLEVBQUUsQ0FBQzt3QkFDekUsc0JBQXNCLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFBO29CQUN2RCxDQUFDO3lCQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLEVBQUUsQ0FBQzt3QkFDdEMsS0FBSyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsWUFBWSxFQUFFLEVBQUU7NEJBQ3JDLFVBQVUsQ0FBQywyQkFBMkIsQ0FBQyxZQUFZLEVBQUUscUNBQXFDLEVBQUUsNEJBQTRCLENBQUMsQ0FBQTt3QkFDM0gsQ0FBQyxDQUFDLENBQUE7b0JBQ0osQ0FBQztnQkFDSCxDQUFDO2dCQUVELElBQUksQ0FBQztvQkFDSCxJQUFJLDJCQUEyQixFQUFFLENBQUM7d0JBQ2hDLFVBQVUsQ0FBQywwQkFBMEIsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO3dCQUN4RSxpQ0FBaUMsR0FBRyxFQUFFLENBQUE7d0JBQ3RDLDJCQUEyQixHQUFHLEtBQUssQ0FBQTtvQkFDckMsQ0FBQztnQkFDSCxDQUFDO2dCQUFDLE9BQU8sWUFBWSxFQUFFLENBQUM7b0JBQ3RCLHNCQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQTtnQkFDM0MsQ0FBQztnQkFFRCxNQUFNLGFBQWEsR0FBRyxVQUFVLENBQUMsMkJBQTJCLENBQUMsbUNBQW1DLElBQUksa0NBQWtDLENBQUMsQ0FBQTtnQkFDdkksTUFBTSxvQkFBb0IsR0FBRyxNQUFNLG1CQUFtQixDQUFDLGFBQWEsRUFBRSxrQkFBa0IsSUFBSSxLQUFLLENBQUMsQ0FBQTtnQkFFbEcsSUFBSSxvQkFBb0IsQ0FBQyxPQUFPLElBQUksb0JBQW9CLENBQUMsTUFBTSxLQUFLLFVBQVUsRUFBRSxDQUFDO29CQUMvRSxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQzFELENBQUM7cUJBQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLE9BQU8sRUFBRSxDQUFDO29CQUN6QyxLQUFLLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRTt3QkFDeEMsVUFBVSxDQUFDLDJCQUEyQixDQUFDLFlBQVksRUFBRSwyQkFBMkIsRUFBRSw0QkFBNEIsQ0FBQyxDQUFBO29CQUNqSCxDQUFDLENBQUMsQ0FBQTtnQkFDSixDQUFDO2dCQUNELG1DQUFtQyxHQUFHLFNBQVMsQ0FBQTtnQkFDL0Msa0NBQWtDLEdBQUcsU0FBUyxDQUFBO2dCQUM5QyxNQUFNLGdCQUFnQixHQUFHLFVBQVUsQ0FBQywyQkFBMkIsQ0FBQyxnQ0FBZ0MsRUFBRSxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUNsSCxNQUFNLHVCQUF1QixHQUFHLE1BQU0sbUJBQW1CLENBQUMsZ0JBQWdCLEVBQUUsa0JBQWtCLElBQUksS0FBSyxDQUFDLENBQUE7Z0JBRXhHLElBQUksdUJBQXVCLENBQUMsT0FBTyxJQUFJLHVCQUF1QixDQUFDLE1BQU0sS0FBSyxVQUFVLEVBQUUsQ0FBQztvQkFDckYsc0JBQXNCLENBQUMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLE1BQU0sQ0FBQyxDQUFBO2dCQUM3RCxDQUFDO3FCQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFDNUMsS0FBSyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRTt3QkFDM0MsVUFBVSxDQUFDLDJCQUEyQixDQUFDLFlBQVksRUFBRSxzQkFBc0IsRUFBRSw0QkFBNEIsQ0FBQyxDQUFBO29CQUM1RyxDQUFDLENBQUMsQ0FBQTtnQkFDSixDQUFDO2dCQUVELElBQUksc0JBQXNCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUN0QyxXQUFXLEdBQUcsSUFBSSxjQUFjLENBQzlCLENBQUMsV0FBVyxFQUFFLEdBQUcsc0JBQXNCLENBQUMsRUFDeEMsMkNBQTJDLEVBQzNDLEVBQUMsS0FBSyxFQUFFLFdBQVcsRUFBQyxDQUNyQixDQUFBO2dCQUNILENBQUM7WUFDSCxDQUFDO1lBRUQsSUFBSSxtQ0FBbUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRSxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO2dCQUN6Rix1QkFBdUIsQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFBO2dCQUN0QyxtQkFBbUIsR0FBRyxJQUFJLENBQUE7WUFDNUIsQ0FBQztRQUNILENBQUM7Z0JBQVMsQ0FBQztZQUNULHVCQUF1QixDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUE7WUFFdEMsSUFBSSxjQUFjLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQy9CLFFBQVEsQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLE1BQU07b0JBQzNDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7b0JBQzVDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNmLENBQUM7UUFDSCxDQUFDO1FBRUQsVUFBVSxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDbkQsbUJBQW1CO1lBQ25CLEtBQUssRUFBRSxXQUFXO1lBQ2xCLE1BQU07U0FDUCxDQUFDLENBQUE7UUFFRixJQUFJLE1BQU07WUFBRSxNQUFNLFdBQVcsQ0FBQTtJQUMvQixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsRUFBQyxZQUFZLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBQztRQUN0RCxLQUFLLE1BQU0sSUFBSSxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2hDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFBO1lBRW5ELE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUM7Z0JBQ25DLEtBQUssRUFBRSxZQUFZO2dCQUNuQixnQkFBZ0IsRUFBRSxRQUFRLENBQUMsZ0JBQWdCO2dCQUMzQyxrQkFBa0IsRUFBRSxRQUFRLENBQUMsa0JBQWtCO2dCQUMvQyxRQUFRLEVBQUUsUUFBUSxDQUFDLGFBQWE7YUFDakMsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDWixNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO1lBQzlGLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFDO1FBQ3BELDhDQUE4QztRQUM5QyxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7UUFFakIsS0FBSyxNQUFNLElBQUksSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUMvQixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUVuRCxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLGNBQWMsQ0FBQztvQkFDbkMsS0FBSyxFQUFFLFdBQVc7b0JBQ2xCLGdCQUFnQixFQUFFLFFBQVEsQ0FBQyxnQkFBZ0I7b0JBQzNDLGtCQUFrQixFQUFFLFFBQVEsQ0FBQyxrQkFBa0I7b0JBQy9DLFFBQVEsRUFBRSxRQUFRLENBQUMsYUFBYTtpQkFDakMsRUFBRSxLQUFLLElBQUksRUFBRTtvQkFDWixNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO2dCQUM5RixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDcEIsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQztZQUFFLE1BQU0sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3ZDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN0QixNQUFNLElBQUksY0FBYyxDQUFDLE1BQU0sRUFBRSxpQ0FBaUMsRUFBRSxFQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFBO1FBQ3pGLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgVGVzdERhdGFiYXNlQWNjZXNzUmV2b2tlZEVycm9yIH0gZnJvbSBcIi4uL2Vudmlyb25tZW50LWhhbmRsZXJzL2Jhc2UuanNcIlxuaW1wb3J0IHsgY2xlYXJEZWxpdmVyaWVzIH0gZnJvbSBcIi4uL21haWxlci5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7Y2xlYXJUaW1lb3V0IGFzIHJlYWxDbGVhclRpbWVvdXQsIHNldFRpbWVvdXQgYXMgcmVhbFNldFRpbWVvdXR9IGZyb20gXCJub2RlOnRpbWVyc1wiXG5cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5BdHRlbXB0RXhlY3V0b3JJbnB1dFtcImJlZm9yZUVhY2hcIl1bbnVtYmVyXX0gUGFja2FnZUhvb2tEZWNsYXJhdGlvbiAqL1xuXG4vKipcbiAqIE1hcmtzIG9uZSB3aG9sZS1saWZlY3ljbGUgdGltZW91dCB3aGlsZSBpdHMgdW5kZXJseWluZyBwcm9taXNlIGtlZXBzIHJ1bm5pbmcuXG4gKiBAdHlwZWRlZiB7RXJyb3IgJiB7dmVsb2Npb3VzVGVzdFRpbWVvdXQ/OiB0cnVlfX0gVGVzdFRpbWVvdXRFcnJvclxuICovXG5cbi8qKlxuICogUnVucyBvbmUgcHJvbWlzZSB3aXRoIGEgbGlmZWN5Y2xlIHRpbWVvdXQuXG4gKiBAcGFyYW0ge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHByb21pc2UgLSBQcm9taXNlIG9yIHZhbHVlLlxuICogQHBhcmFtIHtudW1iZXJ9IHRpbWVvdXRNcyAtIFRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLlxuICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTGlmZWN5Y2xlIHJlc3VsdC5cbiAqL1xuZnVuY3Rpb24gcnVuV2l0aFRpbWVvdXQocHJvbWlzZSwgdGltZW91dE1zLCB0ZXN0RGVzY3JpcHRpb24pIHtcbiAgY29uc3QgdGltZW91dFNlY29uZHMgPSAodGltZW91dE1zIC8gMTAwMCkudG9GaXhlZCgzKS5yZXBsYWNlKC9cXC4/MCskLywgXCJcIilcbiAgLyoqIEB0eXBlIHtUZXN0VGltZW91dEVycm9yfSAqL1xuICBjb25zdCB0aW1lb3V0RXJyb3IgPSBuZXcgRXJyb3IoYFRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRTZWNvbmRzfXM6ICR7dGVzdERlc2NyaXB0aW9ufWApXG4gIHRpbWVvdXRFcnJvci52ZWxvY2lvdXNUZXN0VGltZW91dCA9IHRydWVcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHRpbWVvdXQgPSByZWFsU2V0VGltZW91dCgoKSA9PiByZWplY3QodGltZW91dEVycm9yKSwgdGltZW91dE1zKVxuXG4gICAgUHJvbWlzZS5yZXNvbHZlKHByb21pc2UpLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgcmVhbENsZWFyVGltZW91dCh0aW1lb3V0KVxuICAgICAgcmVzb2x2ZShyZXN1bHQpXG4gICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICByZWFsQ2xlYXJUaW1lb3V0KHRpbWVvdXQpXG4gICAgICByZWplY3QoZXJyb3IpXG4gICAgfSlcbiAgfSlcbn1cblxuLyoqXG4gKiBXYWl0cyBmb3IgZGV0YWNoZWQgbGlmZWN5Y2xlIGNsZWFudXAgdXAgdG8gdGhlIHRpbWVvdXQgZ3JhY2UgcGVyaW9kLlxuICogQHBhcmFtIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbGlmZWN5Y2xlIC0gRGV0YWNoZWQgbGlmZWN5Y2xlIHByb21pc2UuXG4gKiBAcGFyYW0ge251bWJlcn0gZ3JhY2VNcyAtIE1heGltdW0gd2FpdC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHtzZXR0bGVkOiBmYWxzZX0gfCB7c2V0dGxlZDogdHJ1ZSwgc3RhdHVzOiBcImZ1bGZpbGxlZFwifSB8IHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwicmVqZWN0ZWRcIiwgcmVhc29uOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAtIFNldHRsZW1lbnQgb3V0Y29tZS5cbiAqL1xuZnVuY3Rpb24gYXdhaXRTZXR0bGVkT3JHcmFjZShsaWZlY3ljbGUsIGdyYWNlTXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgbGV0IHNldHRsZWQgPSBmYWxzZVxuICAgIGNvbnN0IGdyYWNlVGltZXIgPSByZWFsU2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuXG5cbiAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICByZXNvbHZlKHtzZXR0bGVkOiBmYWxzZX0pXG4gICAgfSwgZ3JhY2VNcylcblxuICAgIFByb21pc2UucmVzb2x2ZShsaWZlY3ljbGUpLnRoZW4oXG4gICAgICAoKSA9PiB7XG4gICAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cblxuICAgICAgICBzZXR0bGVkID0gdHJ1ZVxuICAgICAgICByZWFsQ2xlYXJUaW1lb3V0KGdyYWNlVGltZXIpXG4gICAgICAgIHJlc29sdmUoe3NldHRsZWQ6IHRydWUsIHN0YXR1czogXCJmdWxmaWxsZWRcIn0pXG4gICAgICB9LFxuICAgICAgKHJlYXNvbikgPT4ge1xuICAgICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuXG5cbiAgICAgICAgc2V0dGxlZCA9IHRydWVcbiAgICAgICAgcmVhbENsZWFyVGltZW91dChncmFjZVRpbWVyKVxuICAgICAgICByZXNvbHZlKHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwicmVqZWN0ZWRcIiwgcmVhc29ufSlcbiAgICAgIH1cbiAgICApXG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYSBsYXRlIGxpZmVjeWNsZSBzdG9wcGVkIG9ubHkgYmVjYXVzZSBpdHMgYXR0ZW1wdCBhY2Nlc3Mgd2FzIHJldm9rZWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIExpZmVjeWNsZSByZWplY3Rpb24uXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGV2ZXJ5IGNvbnRhaW5lZCBlcnJvciBpcyBleHBlY3RlZCByZXZvY2F0aW9uLlxuICovXG5mdW5jdGlvbiBpc1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9jYXRpb24oZXJyb3IpIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVGVzdERhdGFiYXNlQWNjZXNzUmV2b2tlZEVycm9yKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgIHJldHVybiBlcnJvci5lcnJvcnMubGVuZ3RoID4gMCAmJiBlcnJvci5lcnJvcnMuZXZlcnkoKG5lc3RlZEVycm9yKSA9PiBpc1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9jYXRpb24obmVzdGVkRXJyb3IpKVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0F0dGVtcHRFeGVjdXRvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIGV4ZWN1dG9yIGZvciBmcmFtZXdvcmstb3duZWQgYXR0ZW1wdCBsaWZlY3ljbGUgd29yay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb25zdHJ1Y3RvciBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5kZWZhdWx0fSBhcmdzLnRlc3RSdW5uZXIgLSBPd25pbmcgVmVsb2Npb3VzIHJ1bm5lci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHt0ZXN0UnVubmVyLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIHRoaXMudGVzdFJ1bm5lciA9IHRlc3RSdW5uZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHRoZSBsZWdhY3kgdGltZW91dCBjb250cmFjdCBhdCB0aGUgZnJhbWV3b3JrIGFkYXB0ZXIgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB0aW1lb3V0TXMgLSBEZWNsYXJlZCBwYWNrYWdlIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gUG9zaXRpdmUgZmluaXRlIHRpbWVvdXQsIG9yIG5vIHRpbWVvdXQuXG4gICAqL1xuICBub3JtYWxpemVUaW1lb3V0TXModGltZW91dE1zKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHRpbWVvdXRNcykgJiYgdGltZW91dE1zID4gMCA/IHRpbWVvdXRNcyA6IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGV4YWN0bHkgb25lIGNvbXBsZXRlIFZlbG9jaW91cy1vd25lZCB0ZXN0IGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5BdHRlbXB0RXhlY3V0b3JJbnB1dH0gaW5wdXQgLSBQYWNrYWdlIGF0dGVtcHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIG9uZSBjb21wbGV0ZSBmcmFtZXdvcmsgYXR0ZW1wdC5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoe2FmdGVyRWFjaCwgYXJncywgYXR0ZW1wdE51bWJlciwgYmVmb3JlRWFjaCwgY29udGV4dCwgZGVmYXVsdEV4ZWN1dGUsIGZ1bGxOYW1lLCBzdWl0ZSwgdGVzdCwgdGltZW91dE1zLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIHZvaWQgY29udGV4dFxuICAgIHZvaWQgZGVmYXVsdEV4ZWN1dGVcbiAgICB2b2lkIHN1aXRlXG4gICAgY29uc3QgdGVzdFJ1bm5lciA9IHRoaXMudGVzdFJ1bm5lclxuICAgIGNvbnN0IGVmZmVjdGl2ZVRpbWVvdXRNcyA9IHRoaXMubm9ybWFsaXplVGltZW91dE1zKHRpbWVvdXRNcylcbiAgICBjb25zdCBjb21wYXRpYmlsaXR5ID0gYXdhaXQgdGVzdFJ1bm5lci50ZXN0Q29tcGF0aWJpbGl0eSh0ZXN0KVxuICAgIGNvbnN0IHt0ZXN0QXJncywgdGVzdERhdGF9ID0gY29tcGF0aWJpbGl0eVxuICAgIGNvbnN0IG1ldGFkYXRhID0gdGVzdFJ1bm5lci50ZXN0TWV0YWRhdGEodGVzdClcbiAgICBjb25zdCB7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb259ID0gbWV0YWRhdGFcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGxldCBjYXVnaHRFcnJvclxuICAgIGxldCBmYWlsZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRlc3RMaWZlY3ljbGVcbiAgICAvKiogQHR5cGUge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119ICovXG4gICAgbGV0IHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdXG4gICAgbGV0IHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5TaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119ICovXG4gICAgY29uc3QgdHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5Ccm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119ICovXG4gICAgY29uc3QgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgIGNvbnN0IHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlID0ge3Jldm9rZWQ6IGZhbHNlfVxuICAgIC8qKiBAdHlwZSB7U2V0PEVycm9yPn0gKi9cbiAgICBjb25zdCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzID0gbmV3IFNldCgpXG4gICAgbGV0IGFib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuICAgIGxldCBhdHRlbXB0VGltZWRPdXQgPSBmYWxzZVxuICAgIHRlc3RBcmdzLnJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCA9IGFzeW5jIChhcmdzKSA9PiB7XG4gICAgICBhd2FpdCB0ZXN0UnVubmVyLnJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudChhcmdzLCB0cmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ucylcbiAgICB9XG4gICAgY29uc3QgcHJvZmlsZXIgPSB0ZXN0UnVubmVyLl9wcm9maWxlclxuICAgIGNvbnN0IHByb2ZpbGVUZXN0RGF0YSA9IHtcbiAgICAgIC4uLnRlc3QsXG4gICAgICBmaWxlUGF0aDogdGVzdERhdGEuZmlsZVBhdGgsXG4gICAgICBsaW5lOiB0ZXN0RGF0YS5saW5lLFxuICAgICAgb3duZXJGaWxlUGF0aDogdGVzdERhdGEub3duZXJGaWxlUGF0aCA/PyBtZXRhZGF0YS5vd25lckZpbGVQYXRoXG4gICAgfVxuICAgIGNvbnN0IHByb2ZpbGVBdHRlbXB0ID0gcHJvZmlsZXI/LnN0YXJ0QXR0ZW1wdCh7XG4gICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICBhdHRlbXB0TnVtYmVyLFxuICAgICAgdGVzdERhdGE6IHByb2ZpbGVUZXN0RGF0YSxcbiAgICAgIHRlc3REZXNjcmlwdGlvblxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcnVuTGlmZWN5Y2xlQ2FsbGJhY2sgPSBhc3luYyAoKSA9PiBhd2FpdCB0ZXN0UnVubmVyLnJ1bldpdGhEdW1teUlmTmVlZGVkKHRlc3RBcmdzLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHVzZVRyYW5zYWN0aW9uID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJhbnNhY3Rpb24gPT09IHRydWVcbiAgICAgICAgY29uc3Qgc2hvdWxkVHJ1bmNhdGUgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZSA/PyAhdXNlVHJhbnNhY3Rpb25cbiAgICAgICAgY29uc3QgdXNlU2hhcmVkVGVzdENvbm5lY3Rpb25zID0gdXNlVHJhbnNhY3Rpb24gfHwgdGVzdEFyZ3MudHlwZSA9PSBcInJlcXVlc3RcIlxuICAgICAgICBjb25zdCB1c2VUZXN0Q29ubmVjdGlvbnMgPSB1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMgfHwgc2hvdWxkVHJ1bmNhdGVcbiAgICAgICAgY29uc3QgcnVuVGVzdEF0dGVtcHQgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gdGVzdFJ1bm5lci5hY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9ucygpXG4gICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT5bXX0gKi9cbiAgICAgICAgICBjb25zdCBsaWZlY3ljbGVFcnJvcnMgPSBbXVxuICAgICAgICAgIGxldCBydW5DbGVhbnVwSG9va3MgPSBmYWxzZVxuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IGF3YWl0IHRlc3RSdW5uZXIucHJlcGFyZVNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJ1bkNsZWFudXBIb29rcyA9IHRydWVcblxuICAgICAgICAgICAgY2xlYXJEZWxpdmVyaWVzKClcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucnVuQmVmb3JlRWFjaGVzKHtiZWZvcmVFYWNoZXM6IGJlZm9yZUVhY2gsIHRlc3RBcmdzLCB0ZXN0RGF0YX0pXG5cbiAgICAgICAgICAgIGlmICh1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgICAgY29uc3QgYWN0aXZlQ29ubmVjdGlvbnMgPSB0ZXN0UnVubmVyLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IHRydWV9KVxuICAgICAgICAgICAgICBpZiAoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiAmJiAhdGVzdFJ1bm5lci5zaGFyZWRUcmFuc2FjdGlvbkJyb2tlck1hdGNoZXNDb25uZWN0aW9ucyhzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uLCBhY3RpdmVDb25uZWN0aW9ucykpIHtcbiAgICAgICAgICAgICAgICB0ZXN0UnVubmVyLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IGZhbHNlXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiA9IGF3YWl0IHRlc3RSdW5uZXIuc3RhcnRTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uLCBhY3RpdmVDb25uZWN0aW9ucylcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgICBpZiAoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gJiYgIXRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IHRlc3RSdW5uZXIuYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnMoKVxuICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IHRydWVcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0ZXN0UnVubmVyLl9sYXN0VGVzdENvbnRleHQgPSB7XG4gICAgICAgICAgICAgIGZ1bGxEZXNjcmlwdGlvbjogZnVsbE5hbWUsXG4gICAgICAgICAgICAgIGZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCA/PyBcIjx1bmtub3duPlwiLFxuICAgICAgICAgICAgICBsaW5lOiB0ZXN0RGF0YS5saW5lID8/IDBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IHRlc3RSdW5uZXIucnVuUHJvZmlsZVNwYW4oe3BoYXNlOiBcInRlc3QgYm9keVwiLCBmaWxlUGF0aDogdGVzdERhdGEub3duZXJGaWxlUGF0aCA/PyB0ZXN0RGF0YS5maWxlUGF0aH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGVzdC5jYWxsYmFjayguLi5hcmdzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHJ1bkNsZWFudXBIb29rcykge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCkuYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgaWYgKHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHRlc3RSdW5uZXIuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnModGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdXG4gICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gZmFsc2VcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IHRlc3RSdW5uZXIuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHx8IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24pXG4gICAgICAgICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnJ1bkFmdGVyRWFjaGVzKHthZnRlckVhY2hlczogWy4uLmFmdGVyRWFjaF0ucmV2ZXJzZSgpLCB0ZXN0QXJncywgdGVzdERhdGF9KVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IHRlc3RSdW5uZXIuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKHRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgdGVzdFJ1bm5lci5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyh0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IGZhbHNlXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgbGlmZWN5Y2xlRXJyb3JzWzBdXG4gICAgICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IobGlmZWN5Y2xlRXJyb3JzLCBcIlRlc3QgbGlmZWN5Y2xlIGFuZCBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGxpZmVjeWNsZUVycm9yc1swXX0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHVzZVRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgIGF3YWl0IHRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgVGVzdDogJHt0ZXN0RGVzY3JpcHRpb259YH0sIHJ1blRlc3RBdHRlbXB0KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGF3YWl0IHJ1blRlc3RBdHRlbXB0KClcbiAgICAgICAgfVxuICAgICAgfSwgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICBjb25zdCBsaWZlY3ljbGVDYWxsYmFjayA9IGFzeW5jICgpID0+IGF3YWl0IHRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLnJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSwgcnVuTGlmZWN5Y2xlQ2FsbGJhY2spXG4gICAgICB0ZXN0TGlmZWN5Y2xlID0gcHJvZmlsZUF0dGVtcHQgJiYgcHJvZmlsZXJcbiAgICAgICAgPyBwcm9maWxlci5ydW5BdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBsaWZlY3ljbGVDYWxsYmFjaylcbiAgICAgICAgOiBsaWZlY3ljbGVDYWxsYmFjaygpXG5cbiAgICAgIGlmIChlZmZlY3RpdmVUaW1lb3V0TXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCBydW5XaXRoVGltZW91dCh0ZXN0TGlmZWN5Y2xlLCBlZmZlY3RpdmVUaW1lb3V0TXMsIHRlc3REZXNjcmlwdGlvbilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRlc3RMaWZlY3ljbGVcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZmFpbGVkID0gdHJ1ZVxuICAgICAgY2F1Z2h0RXJyb3IgPSBlcnJvclxuICAgICAgY29uc3QgdGltZWRPdXQgPSBCb29sZWFuKC8qKiBAdHlwZSB7VGVzdFRpbWVvdXRFcnJvcn0gKi8gKGVycm9yKT8udmVsb2Npb3VzVGVzdFRpbWVvdXQpXG4gICAgICBhdHRlbXB0VGltZWRPdXQgPSB0aW1lZE91dFxuXG4gICAgICBpZiAodGltZWRPdXQgJiYgdGVzdExpZmVjeWNsZSkge1xuICAgICAgICBjb25zdCBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzID0gW11cblxuICAgICAgICBpZiAocHJvZmlsZUF0dGVtcHQgJiYgcHJvZmlsZXIpIHByb2ZpbGVyLmZpbmlzaEF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIFwidGltZWQtb3V0XCIpXG4gICAgICAgIGNvbnN0IGxpZmVjeWNsZU91dGNvbWUgPSBhd2FpdCBhd2FpdFNldHRsZWRPckdyYWNlKHRlc3RMaWZlY3ljbGUsIGVmZmVjdGl2ZVRpbWVvdXRNcyA/PyA2MDAwMClcblxuICAgICAgICBpZiAobGlmZWN5Y2xlT3V0Y29tZS5zZXR0bGVkICYmIGxpZmVjeWNsZU91dGNvbWUuc3RhdHVzID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLnB1c2gobGlmZWN5Y2xlT3V0Y29tZS5yZWFzb24pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWxpZmVjeWNsZU91dGNvbWUuc2V0dGxlZCkge1xuICAgICAgICAgIHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLnJldm9rZWQgPSB0cnVlXG4gICAgICAgICAgdm9pZCB0ZXN0TGlmZWN5Y2xlLmNhdGNoKChjbGVhbnVwRXJyb3IpID0+IHtcbiAgICAgICAgICAgIGlmIChpc1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9jYXRpb24oY2xlYW51cEVycm9yKSkgcmV0dXJuXG4gICAgICAgICAgICB0ZXN0UnVubmVyLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShjbGVhbnVwRXJyb3IsIFwidGVzdCBsaWZlY3ljbGVcIiwgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycylcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnN0IHF1YXJhbnRpbmUgPSB0ZXN0UnVubmVyLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9ucyhicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICBjb25zdCBxdWFyYW50aW5lT3V0Y29tZSA9IGF3YWl0IGF3YWl0U2V0dGxlZE9yR3JhY2UocXVhcmFudGluZSwgZWZmZWN0aXZlVGltZW91dE1zID8/IDYwMDAwKVxuICAgICAgICAgIGNvbnN0IHVzZXNCcm93c2VyVHJhbnNhY3Rpb25zID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJhbnNhY3Rpb24gPT09IHRydWVcbiAgICAgICAgICBjb25zdCB1c2VzQnJvd3NlclRydW5jYXRpb24gPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZSA/PyAhdXNlc0Jyb3dzZXJUcmFuc2FjdGlvbnNcblxuICAgICAgICAgIGFib3J0UmVtYWluaW5nVGVzdHMgPSB0ZXN0UnVubmVyLmlzQnJvd3NlclRlc3RNb2RlKClcbiAgICAgICAgICAgICYmIHRlc3RSdW5uZXIuaGFzVGFnKHRlc3RBcmdzLCBcImR1bW15XCIpXG4gICAgICAgICAgICAmJiAodXNlc0Jyb3dzZXJUcmFuc2FjdGlvbnMgfHwgdXNlc0Jyb3dzZXJUcnVuY2F0aW9uKVxuXG4gICAgICAgICAgaWYgKHF1YXJhbnRpbmVPdXRjb21lLnNldHRsZWQgJiYgcXVhcmFudGluZU91dGNvbWUuc3RhdHVzID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChxdWFyYW50aW5lT3V0Y29tZS5yZWFzb24pXG4gICAgICAgICAgfSBlbHNlIGlmICghcXVhcmFudGluZU91dGNvbWUuc2V0dGxlZCkge1xuICAgICAgICAgICAgdm9pZCBxdWFyYW50aW5lLmNhdGNoKChjbGVhbnVwRXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgdGVzdFJ1bm5lci5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoY2xlYW51cEVycm9yLCBcImJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiBxdWFyYW50aW5lXCIsIHJlY29yZGVkVGltZW91dENsZWFudXBFcnJvcnMpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgdGVzdFJ1bm5lci5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyh0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gZmFsc2VcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChjbGVhbnVwRXJyb3IpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBicm9rZXJDbGVhbnVwID0gdGVzdFJ1bm5lci5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfHwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbilcbiAgICAgICAgY29uc3QgYnJva2VyQ2xlYW51cE91dGNvbWUgPSBhd2FpdCBhd2FpdFNldHRsZWRPckdyYWNlKGJyb2tlckNsZWFudXAsIGVmZmVjdGl2ZVRpbWVvdXRNcyA/PyA2MDAwMClcblxuICAgICAgICBpZiAoYnJva2VyQ2xlYW51cE91dGNvbWUuc2V0dGxlZCAmJiBicm9rZXJDbGVhbnVwT3V0Y29tZS5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChicm9rZXJDbGVhbnVwT3V0Y29tZS5yZWFzb24pXG4gICAgICAgIH0gZWxzZSBpZiAoIWJyb2tlckNsZWFudXBPdXRjb21lLnNldHRsZWQpIHtcbiAgICAgICAgICB2b2lkIGJyb2tlckNsZWFudXAuY2F0Y2goKGNsZWFudXBFcnJvcikgPT4ge1xuICAgICAgICAgICAgdGVzdFJ1bm5lci5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoY2xlYW51cEVycm9yLCBcInNoYXJlZCB0cmFuc2FjdGlvbiBicm9rZXJcIiwgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycylcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgY29uc3QgZW1lcmdlbmN5Q2xlYW51cCA9IHRlc3RSdW5uZXIuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKHRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25zLCB7ZGlzY2FyZDogdHJ1ZX0pXG4gICAgICAgIGNvbnN0IGVtZXJnZW5jeUNsZWFudXBPdXRjb21lID0gYXdhaXQgYXdhaXRTZXR0bGVkT3JHcmFjZShlbWVyZ2VuY3lDbGVhbnVwLCBlZmZlY3RpdmVUaW1lb3V0TXMgPz8gNjAwMDApXG5cbiAgICAgICAgaWYgKGVtZXJnZW5jeUNsZWFudXBPdXRjb21lLnNldHRsZWQgJiYgZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUuc3RhdHVzID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLnB1c2goZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUucmVhc29uKVxuICAgICAgICB9IGVsc2UgaWYgKCFlbWVyZ2VuY3lDbGVhbnVwT3V0Y29tZS5zZXR0bGVkKSB7XG4gICAgICAgICAgdm9pZCBlbWVyZ2VuY3lDbGVhbnVwLmNhdGNoKChjbGVhbnVwRXJyb3IpID0+IHtcbiAgICAgICAgICAgIHRlc3RSdW5uZXIucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGNsZWFudXBFcnJvciwgXCJ0cmFuc2FjdGlvbmFsIHRlbmFudFwiLCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzKVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY2F1Z2h0RXJyb3IgPSBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbY2F1Z2h0RXJyb3IsIC4uLmVtZXJnZW5jeUNsZWFudXBFcnJvcnNdLFxuICAgICAgICAgICAgXCJUZXN0IHRpbWVvdXQgYW5kIGVtZXJnZW5jeSBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgICAge2NhdXNlOiBjYXVnaHRFcnJvcn1cbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zLnNvbWUoKHJlZ2lzdHJhdGlvbikgPT4gcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkKSkge1xuICAgICAgICB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZS5yZXZva2VkID0gdHJ1ZVxuICAgICAgICBhYm9ydFJlbWFpbmluZ1Rlc3RzID0gdHJ1ZVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZS5yZXZva2VkID0gdHJ1ZVxuXG4gICAgICBpZiAocHJvZmlsZUF0dGVtcHQgJiYgcHJvZmlsZXIpIHtcbiAgICAgICAgcHJvZmlsZXIuZmluaXNoQXR0ZW1wdChwcm9maWxlQXR0ZW1wdCwgZmFpbGVkXG4gICAgICAgICAgPyAoYXR0ZW1wdFRpbWVkT3V0ID8gXCJ0aW1lZC1vdXRcIiA6IFwiZmFpbGVkXCIpXG4gICAgICAgICAgOiBcInBhc3NlZFwiKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRlc3RSdW5uZXIucmVjb3JkQXR0ZW1wdE91dGNvbWUodGVzdCwgYXR0ZW1wdE51bWJlciwge1xuICAgICAgYWJvcnRSZW1haW5pbmdUZXN0cyxcbiAgICAgIGVycm9yOiBjYXVnaHRFcnJvcixcbiAgICAgIGZhaWxlZFxuICAgIH0pXG5cbiAgICBpZiAoZmFpbGVkKSB0aHJvdyBjYXVnaHRFcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlLWVhY2ggaG9va3MgaW4gaW5oZXJpdGVkIGRlY2xhcmF0aW9uIG9yZGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEhvb2sgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VIb29rRGVjbGFyYXRpb25bXX0gYXJncy5iZWZvcmVFYWNoZXMgLSBTZXR1cCBob29rcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiKS5UZXN0QXJnc30gYXJncy50ZXN0QXJncyAtIFN0YWJsZSB0ZXN0IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiKS5UZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgc2V0dXAgaG9va3MgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5CZWZvcmVFYWNoZXMoe2JlZm9yZUVhY2hlcywgdGVzdEFyZ3MsIHRlc3REYXRhfSkge1xuICAgIGZvciAoY29uc3QgaG9vayBvZiBiZWZvcmVFYWNoZXMpIHtcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy50ZXN0UnVubmVyLmhvb2tNZXRhZGF0YShob29rKVxuXG4gICAgICBhd2FpdCB0aGlzLnRlc3RSdW5uZXIucnVuUHJvZmlsZVNwYW4oe1xuICAgICAgICBwaGFzZTogXCJiZWZvcmVFYWNoXCIsXG4gICAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IG1ldGFkYXRhLmRlY2xhcmF0aW9uSW5kZXgsXG4gICAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogbWV0YWRhdGEuZGVjbGFyYXRpb25TY29wZUlkLFxuICAgICAgICBmaWxlUGF0aDogbWV0YWRhdGEub3duZXJGaWxlUGF0aFxuICAgICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBob29rLmNhbGxiYWNrKHtjb25maWd1cmF0aW9uOiB0aGlzLnRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLCB0ZXN0QXJncywgdGVzdERhdGF9KVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVyeSBhZnRlci1lYWNoIGhvb2sgd2hpbGUgcHJlc2VydmluZyBhbGwgZmFpbHVyZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSG9vayBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7UGFja2FnZUhvb2tEZWNsYXJhdGlvbltdfSBhcmdzLmFmdGVyRWFjaGVzIC0gQ2xlYW51cCBob29rcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiKS5UZXN0QXJnc30gYXJncy50ZXN0QXJncyAtIFN0YWJsZSB0ZXN0IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiKS5UZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBjbGVhbnVwIGhvb2sgc2V0dGxlcy5cbiAgICovXG4gIGFzeW5jIHJ1bkFmdGVyRWFjaGVzKHthZnRlckVhY2hlcywgdGVzdEFyZ3MsIHRlc3REYXRhfSkge1xuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT5bXX0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBob29rIG9mIGFmdGVyRWFjaGVzKSB7XG4gICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMudGVzdFJ1bm5lci5ob29rTWV0YWRhdGEoaG9vaylcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy50ZXN0UnVubmVyLnJ1blByb2ZpbGVTcGFuKHtcbiAgICAgICAgICBwaGFzZTogXCJhZnRlckVhY2hcIixcbiAgICAgICAgICBkZWNsYXJhdGlvbkluZGV4OiBtZXRhZGF0YS5kZWNsYXJhdGlvbkluZGV4LFxuICAgICAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogbWV0YWRhdGEuZGVjbGFyYXRpb25TY29wZUlkLFxuICAgICAgICAgIGZpbGVQYXRoOiBtZXRhZGF0YS5vd25lckZpbGVQYXRoXG4gICAgICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBob29rLmNhbGxiYWNrKHtjb25maWd1cmF0aW9uOiB0aGlzLnRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLCB0ZXN0QXJncywgdGVzdERhdGF9KVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIk11bHRpcGxlIGFmdGVyRWFjaCBob29rcyBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICAgIH1cbiAgfVxufVxuIl19