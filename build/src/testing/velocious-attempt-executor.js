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
        const profileAttempt = profiler?.startAttempt({
            descriptions,
            attemptNumber,
            testData,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLWF0dGVtcHQtZXhlY3V0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy92ZWxvY2lvdXMtYXR0ZW1wdC1leGVjdXRvci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLDhCQUE4QixFQUFFLE1BQU0saUNBQWlDLENBQUE7QUFDaEYsT0FBTyxFQUFFLGVBQWUsRUFBRSxNQUFNLGNBQWMsQ0FBQTtBQUM5QyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLEVBQUMsWUFBWSxJQUFJLGdCQUFnQixFQUFFLFVBQVUsSUFBSSxjQUFjLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFFMUYsdUhBQXVIO0FBRXZIOzs7R0FHRztBQUVIOzs7Ozs7R0FNRztBQUNILFNBQVMsY0FBYyxDQUFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsZUFBZTtJQUN6RCxNQUFNLGNBQWMsR0FBRyxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUMxRSwrQkFBK0I7SUFDL0IsTUFBTSxZQUFZLEdBQUcsSUFBSSxLQUFLLENBQUMsbUJBQW1CLGNBQWMsTUFBTSxlQUFlLEVBQUUsQ0FBQyxDQUFBO0lBQ3hGLFlBQVksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLENBQUE7SUFFeEMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUNyQyxNQUFNLE9BQU8sR0FBRyxjQUFjLENBQUMsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFBO1FBRXJFLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUU7WUFDdkMsZ0JB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QUE7WUFDSixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3BCLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsTUFBTSxJQUFJLENBQUM7WUFBRSxNQUFNLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUN2QyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDdEIsTUFBTSxJQUFJLGNBQWMsQ0FBQyxNQUFNLEVBQUUsaUNBQWlDLEVBQUUsRUFBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQTtRQUN6RixDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IFRlc3REYXRhYmFzZUFjY2Vzc1Jldm9rZWRFcnJvciB9IGZyb20gXCIuLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCJcbmltcG9ydCB7IGNsZWFyRGVsaXZlcmllcyB9IGZyb20gXCIuLi9tYWlsZXIuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQge2NsZWFyVGltZW91dCBhcyByZWFsQ2xlYXJUaW1lb3V0LCBzZXRUaW1lb3V0IGFzIHJlYWxTZXRUaW1lb3V0fSBmcm9tIFwibm9kZTp0aW1lcnNcIlxuXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuQXR0ZW1wdEV4ZWN1dG9ySW5wdXRbXCJiZWZvcmVFYWNoXCJdW251bWJlcl19IFBhY2thZ2VIb29rRGVjbGFyYXRpb24gKi9cblxuLyoqXG4gKiBNYXJrcyBvbmUgd2hvbGUtbGlmZWN5Y2xlIHRpbWVvdXQgd2hpbGUgaXRzIHVuZGVybHlpbmcgcHJvbWlzZSBrZWVwcyBydW5uaW5nLlxuICogQHR5cGVkZWYge0Vycm9yICYge3ZlbG9jaW91c1Rlc3RUaW1lb3V0PzogdHJ1ZX19IFRlc3RUaW1lb3V0RXJyb3JcbiAqL1xuXG4vKipcbiAqIFJ1bnMgb25lIHByb21pc2Ugd2l0aCBhIGxpZmVjeWNsZSB0aW1lb3V0LlxuICogQHBhcmFtIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBwcm9taXNlIC0gUHJvbWlzZSBvciB2YWx1ZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0TXMgLSBUaW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIExpZmVjeWNsZSByZXN1bHQuXG4gKi9cbmZ1bmN0aW9uIHJ1bldpdGhUaW1lb3V0KHByb21pc2UsIHRpbWVvdXRNcywgdGVzdERlc2NyaXB0aW9uKSB7XG4gIGNvbnN0IHRpbWVvdXRTZWNvbmRzID0gKHRpbWVvdXRNcyAvIDEwMDApLnRvRml4ZWQoMykucmVwbGFjZSgvXFwuPzArJC8sIFwiXCIpXG4gIC8qKiBAdHlwZSB7VGVzdFRpbWVvdXRFcnJvcn0gKi9cbiAgY29uc3QgdGltZW91dEVycm9yID0gbmV3IEVycm9yKGBUaW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U2Vjb25kc31zOiAke3Rlc3REZXNjcmlwdGlvbn1gKVxuICB0aW1lb3V0RXJyb3IudmVsb2Npb3VzVGVzdFRpbWVvdXQgPSB0cnVlXG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCB0aW1lb3V0ID0gcmVhbFNldFRpbWVvdXQoKCkgPT4gcmVqZWN0KHRpbWVvdXRFcnJvciksIHRpbWVvdXRNcylcblxuICAgIFByb21pc2UucmVzb2x2ZShwcm9taXNlKS50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgIHJlYWxDbGVhclRpbWVvdXQodGltZW91dClcbiAgICAgIHJlc29sdmUocmVzdWx0KVxuICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgcmVhbENsZWFyVGltZW91dCh0aW1lb3V0KVxuICAgICAgcmVqZWN0KGVycm9yKVxuICAgIH0pXG4gIH0pXG59XG5cbi8qKlxuICogV2FpdHMgZm9yIGRldGFjaGVkIGxpZmVjeWNsZSBjbGVhbnVwIHVwIHRvIHRoZSB0aW1lb3V0IGdyYWNlIHBlcmlvZC5cbiAqIEBwYXJhbSB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGxpZmVjeWNsZSAtIERldGFjaGVkIGxpZmVjeWNsZSBwcm9taXNlLlxuICogQHBhcmFtIHtudW1iZXJ9IGdyYWNlTXMgLSBNYXhpbXVtIHdhaXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx7c2V0dGxlZDogZmFsc2V9IHwge3NldHRsZWQ6IHRydWUsIHN0YXR1czogXCJmdWxmaWxsZWRcIn0gfCB7c2V0dGxlZDogdHJ1ZSwgc3RhdHVzOiBcInJlamVjdGVkXCIsIHJlYXNvbjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gLSBTZXR0bGVtZW50IG91dGNvbWUuXG4gKi9cbmZ1bmN0aW9uIGF3YWl0U2V0dGxlZE9yR3JhY2UobGlmZWN5Y2xlLCBncmFjZU1zKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGxldCBzZXR0bGVkID0gZmFsc2VcbiAgICBjb25zdCBncmFjZVRpbWVyID0gcmVhbFNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuXG4gICAgICBzZXR0bGVkID0gdHJ1ZVxuICAgICAgcmVzb2x2ZSh7c2V0dGxlZDogZmFsc2V9KVxuICAgIH0sIGdyYWNlTXMpXG5cbiAgICBQcm9taXNlLnJlc29sdmUobGlmZWN5Y2xlKS50aGVuKFxuICAgICAgKCkgPT4ge1xuICAgICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuXG5cbiAgICAgICAgc2V0dGxlZCA9IHRydWVcbiAgICAgICAgcmVhbENsZWFyVGltZW91dChncmFjZVRpbWVyKVxuICAgICAgICByZXNvbHZlKHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwiZnVsZmlsbGVkXCJ9KVxuICAgICAgfSxcbiAgICAgIChyZWFzb24pID0+IHtcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuXG4gICAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICAgIHJlYWxDbGVhclRpbWVvdXQoZ3JhY2VUaW1lcilcbiAgICAgICAgcmVzb2x2ZSh7c2V0dGxlZDogdHJ1ZSwgc3RhdHVzOiBcInJlamVjdGVkXCIsIHJlYXNvbn0pXG4gICAgICB9XG4gICAgKVxuICB9KVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGEgbGF0ZSBsaWZlY3ljbGUgc3RvcHBlZCBvbmx5IGJlY2F1c2UgaXRzIGF0dGVtcHQgYWNjZXNzIHdhcyByZXZva2VkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBMaWZlY3ljbGUgcmVqZWN0aW9uLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBldmVyeSBjb250YWluZWQgZXJyb3IgaXMgZXhwZWN0ZWQgcmV2b2NhdGlvbi5cbiAqL1xuZnVuY3Rpb24gaXNUZXN0RGF0YWJhc2VBY2Nlc3NSZXZvY2F0aW9uKGVycm9yKSB7XG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFRlc3REYXRhYmFzZUFjY2Vzc1Jldm9rZWRFcnJvcikgcmV0dXJuIHRydWVcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3IuZXJyb3JzLmxlbmd0aCA+IDAgJiYgZXJyb3IuZXJyb3JzLmV2ZXJ5KChuZXN0ZWRFcnJvcikgPT4gaXNUZXN0RGF0YWJhc2VBY2Nlc3NSZXZvY2F0aW9uKG5lc3RlZEVycm9yKSlcbiAgfVxuXG4gIHJldHVybiBmYWxzZVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNBdHRlbXB0RXhlY3V0b3Ige1xuICAvKipcbiAgICogQ3JlYXRlcyBhbiBleGVjdXRvciBmb3IgZnJhbWV3b3JrLW93bmVkIGF0dGVtcHQgbGlmZWN5Y2xlIHdvcmsuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuZGVmYXVsdH0gYXJncy50ZXN0UnVubmVyIC0gT3duaW5nIFZlbG9jaW91cyBydW5uZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGVzdFJ1bm5lciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB0aGlzLnRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyB0aGUgbGVnYWN5IHRpbWVvdXQgY29udHJhY3QgYXQgdGhlIGZyYW1ld29yayBhZGFwdGVyIGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gdGltZW91dE1zIC0gRGVjbGFyZWQgcGFja2FnZSB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFBvc2l0aXZlIGZpbml0ZSB0aW1lb3V0LCBvciBubyB0aW1lb3V0LlxuICAgKi9cbiAgbm9ybWFsaXplVGltZW91dE1zKHRpbWVvdXRNcykge1xuICAgIHJldHVybiB0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh0aW1lb3V0TXMpICYmIHRpbWVvdXRNcyA+IDAgPyB0aW1lb3V0TXMgOiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBleGFjdGx5IG9uZSBjb21wbGV0ZSBWZWxvY2lvdXMtb3duZWQgdGVzdCBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuQXR0ZW1wdEV4ZWN1dG9ySW5wdXR9IGlucHV0IC0gUGFja2FnZSBhdHRlbXB0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBvbmUgY29tcGxldGUgZnJhbWV3b3JrIGF0dGVtcHQuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKHthZnRlckVhY2gsIGFyZ3MsIGF0dGVtcHROdW1iZXIsIGJlZm9yZUVhY2gsIGNvbnRleHQsIGRlZmF1bHRFeGVjdXRlLCBmdWxsTmFtZSwgc3VpdGUsIHRlc3QsIHRpbWVvdXRNcywgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB2b2lkIGNvbnRleHRcbiAgICB2b2lkIGRlZmF1bHRFeGVjdXRlXG4gICAgdm9pZCBzdWl0ZVxuICAgIGNvbnN0IHRlc3RSdW5uZXIgPSB0aGlzLnRlc3RSdW5uZXJcbiAgICBjb25zdCBlZmZlY3RpdmVUaW1lb3V0TXMgPSB0aGlzLm5vcm1hbGl6ZVRpbWVvdXRNcyh0aW1lb3V0TXMpXG4gICAgY29uc3QgY29tcGF0aWJpbGl0eSA9IGF3YWl0IHRlc3RSdW5uZXIudGVzdENvbXBhdGliaWxpdHkodGVzdClcbiAgICBjb25zdCB7dGVzdEFyZ3MsIHRlc3REYXRhfSA9IGNvbXBhdGliaWxpdHlcbiAgICBjb25zdCBtZXRhZGF0YSA9IHRlc3RSdW5uZXIudGVzdE1ldGFkYXRhKHRlc3QpXG4gICAgY29uc3Qge2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9ufSA9IG1ldGFkYXRhXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBsZXQgY2F1Z2h0RXJyb3JcbiAgICBsZXQgZmFpbGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0ZXN0TGlmZWN5Y2xlXG4gICAgLyoqIEB0eXBlIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAqL1xuICAgIGxldCB0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgIGxldCB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5TaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb25cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb25cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSAqL1xuICAgIGNvbnN0IHRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25zID0gW11cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSAqL1xuICAgIGNvbnN0IGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICBjb25zdCB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSA9IHtyZXZva2VkOiBmYWxzZX1cbiAgICAvKiogQHR5cGUge1NldDxFcnJvcj59ICovXG4gICAgY29uc3QgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycyA9IG5ldyBTZXQoKVxuICAgIGxldCBhYm9ydFJlbWFpbmluZ1Rlc3RzID0gZmFsc2VcbiAgICBsZXQgYXR0ZW1wdFRpbWVkT3V0ID0gZmFsc2VcbiAgICB0ZXN0QXJncy5yZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgPSBhc3luYyAoYXJncykgPT4ge1xuICAgICAgYXdhaXQgdGVzdFJ1bm5lci5yZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQoYXJncywgdHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbnMpXG4gICAgfVxuICAgIGNvbnN0IHByb2ZpbGVyID0gdGVzdFJ1bm5lci5fcHJvZmlsZXJcbiAgICBjb25zdCBwcm9maWxlQXR0ZW1wdCA9IHByb2ZpbGVyPy5zdGFydEF0dGVtcHQoe1xuICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgIHRlc3REYXRhLFxuICAgICAgdGVzdERlc2NyaXB0aW9uXG4gICAgfSlcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBydW5MaWZlY3ljbGVDYWxsYmFjayA9IGFzeW5jICgpID0+IGF3YWl0IHRlc3RSdW5uZXIucnVuV2l0aER1bW15SWZOZWVkZWQodGVzdEFyZ3MsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgdXNlVHJhbnNhY3Rpb24gPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cmFuc2FjdGlvbiA9PT0gdHJ1ZVxuICAgICAgICBjb25zdCBzaG91bGRUcnVuY2F0ZSA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRydW5jYXRlID8/ICF1c2VUcmFuc2FjdGlvblxuICAgICAgICBjb25zdCB1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMgPSB1c2VUcmFuc2FjdGlvbiB8fCB0ZXN0QXJncy50eXBlID09IFwicmVxdWVzdFwiXG4gICAgICAgIGNvbnN0IHVzZVRlc3RDb25uZWN0aW9ucyA9IHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucyB8fCBzaG91bGRUcnVuY2F0ZVxuICAgICAgICBjb25zdCBydW5UZXN0QXR0ZW1wdCA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAodXNlU2hhcmVkVGVzdENvbm5lY3Rpb25zKSB7XG4gICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSB0ZXN0UnVubmVyLmFjdGl2YXRlVGVzdFNoYXJlZENvbm5lY3Rpb25zKClcbiAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPltdfSAqL1xuICAgICAgICAgIGNvbnN0IGxpZmVjeWNsZUVycm9ycyA9IFtdXG4gICAgICAgICAgbGV0IHJ1bkNsZWFudXBIb29rcyA9IGZhbHNlXG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uID0gYXdhaXQgdGVzdFJ1bm5lci5wcmVwYXJlU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcnVuQ2xlYW51cEhvb2tzID0gdHJ1ZVxuXG4gICAgICAgICAgICBjbGVhckRlbGl2ZXJpZXMoKVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5ydW5CZWZvcmVFYWNoZXMoe2JlZm9yZUVhY2hlczogYmVmb3JlRWFjaCwgdGVzdEFyZ3MsIHRlc3REYXRhfSlcblxuICAgICAgICAgICAgaWYgKHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgICAgICBjb25zdCBhY3RpdmVDb25uZWN0aW9ucyA9IHRlc3RSdW5uZXIuc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seTogdHJ1ZX0pXG4gICAgICAgICAgICAgIGlmIChzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uICYmICF0ZXN0UnVubmVyLnNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24sIGFjdGl2ZUNvbm5lY3Rpb25zKSkge1xuICAgICAgICAgICAgICAgIHRlc3RSdW5uZXIuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnModGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdXG4gICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gZmFsc2VcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uID0gYXdhaXQgdGVzdFJ1bm5lci5zdGFydFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24sIGFjdGl2ZUNvbm5lY3Rpb25zKVxuICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgIGlmIChzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiAmJiAhdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gdGVzdFJ1bm5lci5hY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9ucygpXG4gICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gdHJ1ZVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRlc3RSdW5uZXIuX2xhc3RUZXN0Q29udGV4dCA9IHtcbiAgICAgICAgICAgICAgZnVsbERlc2NyaXB0aW9uOiBmdWxsTmFtZSxcbiAgICAgICAgICAgICAgZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoID8/IFwiPHVua25vd24+XCIsXG4gICAgICAgICAgICAgIGxpbmU6IHRlc3REYXRhLmxpbmUgPz8gMFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYXdhaXQgdGVzdFJ1bm5lci5ydW5Qcm9maWxlU3Bhbih7cGhhc2U6IFwidGVzdCBib2R5XCIsIGZpbGVQYXRoOiB0ZXN0RGF0YS5vd25lckZpbGVQYXRoID8/IHRlc3REYXRhLmZpbGVQYXRofSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCB0ZXN0LmNhbGxiYWNrKC4uLmFyZ3MpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAocnVuQ2xlYW51cEhvb2tzKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCB0ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKS5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBpZiAodGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgdGVzdFJ1bm5lci5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyh0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGVzdFJ1bm5lci5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfHwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbilcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucnVuQWZ0ZXJFYWNoZXMoe2FmdGVyRWFjaGVzOiBbLi4uYWZ0ZXJFYWNoXS5yZXZlcnNlKCksIHRlc3RBcmdzLCB0ZXN0RGF0YX0pXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGVzdFJ1bm5lci5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHModHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICB0ZXN0UnVubmVyLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gZmFsc2VcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBsaWZlY3ljbGVFcnJvcnNbMF1cbiAgICAgICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihsaWZlY3ljbGVFcnJvcnMsIFwiVGVzdCBsaWZlY3ljbGUgYW5kIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogbGlmZWN5Y2xlRXJyb3JzWzBdfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodXNlVGVzdENvbm5lY3Rpb25zKSB7XG4gICAgICAgICAgYXdhaXQgdGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGBUZXN0OiAke3Rlc3REZXNjcmlwdGlvbn1gfSwgcnVuVGVzdEF0dGVtcHQpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXdhaXQgcnVuVGVzdEF0dGVtcHQoKVxuICAgICAgICB9XG4gICAgICB9LCBicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgIGNvbnN0IGxpZmVjeWNsZUNhbGxiYWNrID0gYXN5bmMgKCkgPT4gYXdhaXQgdGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCkucnVuV2l0aFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLCBydW5MaWZlY3ljbGVDYWxsYmFjaylcbiAgICAgIHRlc3RMaWZlY3ljbGUgPSBwcm9maWxlQXR0ZW1wdCAmJiBwcm9maWxlclxuICAgICAgICA/IHByb2ZpbGVyLnJ1bkF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGxpZmVjeWNsZUNhbGxiYWNrKVxuICAgICAgICA6IGxpZmVjeWNsZUNhbGxiYWNrKClcblxuICAgICAgaWYgKGVmZmVjdGl2ZVRpbWVvdXRNcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGF3YWl0IHJ1bldpdGhUaW1lb3V0KHRlc3RMaWZlY3ljbGUsIGVmZmVjdGl2ZVRpbWVvdXRNcywgdGVzdERlc2NyaXB0aW9uKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGVzdExpZmVjeWNsZVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBmYWlsZWQgPSB0cnVlXG4gICAgICBjYXVnaHRFcnJvciA9IGVycm9yXG4gICAgICBjb25zdCB0aW1lZE91dCA9IEJvb2xlYW4oLyoqIEB0eXBlIHtUZXN0VGltZW91dEVycm9yfSAqLyAoZXJyb3IpPy52ZWxvY2lvdXNUZXN0VGltZW91dClcbiAgICAgIGF0dGVtcHRUaW1lZE91dCA9IHRpbWVkT3V0XG5cbiAgICAgIGlmICh0aW1lZE91dCAmJiB0ZXN0TGlmZWN5Y2xlKSB7XG4gICAgICAgIGNvbnN0IGVtZXJnZW5jeUNsZWFudXBFcnJvcnMgPSBbXVxuXG4gICAgICAgIGlmIChwcm9maWxlQXR0ZW1wdCAmJiBwcm9maWxlcikgcHJvZmlsZXIuZmluaXNoQXR0ZW1wdChwcm9maWxlQXR0ZW1wdCwgXCJ0aW1lZC1vdXRcIilcbiAgICAgICAgY29uc3QgbGlmZWN5Y2xlT3V0Y29tZSA9IGF3YWl0IGF3YWl0U2V0dGxlZE9yR3JhY2UodGVzdExpZmVjeWNsZSwgZWZmZWN0aXZlVGltZW91dE1zID8/IDYwMDAwKVxuXG4gICAgICAgIGlmIChsaWZlY3ljbGVPdXRjb21lLnNldHRsZWQgJiYgbGlmZWN5Y2xlT3V0Y29tZS5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChsaWZlY3ljbGVPdXRjb21lLnJlYXNvbilcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghbGlmZWN5Y2xlT3V0Y29tZS5zZXR0bGVkKSB7XG4gICAgICAgICAgdGVzdERhdGFiYXNlQWNjZXNzU2NvcGUucmV2b2tlZCA9IHRydWVcbiAgICAgICAgICB2b2lkIHRlc3RMaWZlY3ljbGUuY2F0Y2goKGNsZWFudXBFcnJvcikgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVGVzdERhdGFiYXNlQWNjZXNzUmV2b2NhdGlvbihjbGVhbnVwRXJyb3IpKSByZXR1cm5cbiAgICAgICAgICAgIHRlc3RSdW5uZXIucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGNsZWFudXBFcnJvciwgXCJ0ZXN0IGxpZmVjeWNsZVwiLCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzKVxuICAgICAgICAgIH0pXG4gICAgICAgICAgY29uc3QgcXVhcmFudGluZSA9IHRlc3RSdW5uZXIucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb25zKGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgICAgIGNvbnN0IHF1YXJhbnRpbmVPdXRjb21lID0gYXdhaXQgYXdhaXRTZXR0bGVkT3JHcmFjZShxdWFyYW50aW5lLCBlZmZlY3RpdmVUaW1lb3V0TXMgPz8gNjAwMDApXG4gICAgICAgICAgY29uc3QgdXNlc0Jyb3dzZXJUcmFuc2FjdGlvbnMgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cmFuc2FjdGlvbiA9PT0gdHJ1ZVxuICAgICAgICAgIGNvbnN0IHVzZXNCcm93c2VyVHJ1bmNhdGlvbiA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRydW5jYXRlID8/ICF1c2VzQnJvd3NlclRyYW5zYWN0aW9uc1xuXG4gICAgICAgICAgYWJvcnRSZW1haW5pbmdUZXN0cyA9IHRlc3RSdW5uZXIuaXNCcm93c2VyVGVzdE1vZGUoKVxuICAgICAgICAgICAgJiYgdGVzdFJ1bm5lci5oYXNUYWcodGVzdEFyZ3MsIFwiZHVtbXlcIilcbiAgICAgICAgICAgICYmICh1c2VzQnJvd3NlclRyYW5zYWN0aW9ucyB8fCB1c2VzQnJvd3NlclRydW5jYXRpb24pXG5cbiAgICAgICAgICBpZiAocXVhcmFudGluZU91dGNvbWUuc2V0dGxlZCAmJiBxdWFyYW50aW5lT3V0Y29tZS5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgICAgZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5wdXNoKHF1YXJhbnRpbmVPdXRjb21lLnJlYXNvbilcbiAgICAgICAgICB9IGVsc2UgaWYgKCFxdWFyYW50aW5lT3V0Y29tZS5zZXR0bGVkKSB7XG4gICAgICAgICAgICB2b2lkIHF1YXJhbnRpbmUuY2F0Y2goKGNsZWFudXBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICB0ZXN0UnVubmVyLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShjbGVhbnVwRXJyb3IsIFwiYnJvd3NlciBkdW1teSBjb25uZWN0aW9uIHF1YXJhbnRpbmVcIiwgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycylcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAodGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICB0ZXN0UnVubmVyLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdXG4gICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgICAgZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5wdXNoKGNsZWFudXBFcnJvcilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJyb2tlckNsZWFudXAgPSB0ZXN0UnVubmVyLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8fCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uKVxuICAgICAgICBjb25zdCBicm9rZXJDbGVhbnVwT3V0Y29tZSA9IGF3YWl0IGF3YWl0U2V0dGxlZE9yR3JhY2UoYnJva2VyQ2xlYW51cCwgZWZmZWN0aXZlVGltZW91dE1zID8/IDYwMDAwKVxuXG4gICAgICAgIGlmIChicm9rZXJDbGVhbnVwT3V0Y29tZS5zZXR0bGVkICYmIGJyb2tlckNsZWFudXBPdXRjb21lLnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKSB7XG4gICAgICAgICAgZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5wdXNoKGJyb2tlckNsZWFudXBPdXRjb21lLnJlYXNvbilcbiAgICAgICAgfSBlbHNlIGlmICghYnJva2VyQ2xlYW51cE91dGNvbWUuc2V0dGxlZCkge1xuICAgICAgICAgIHZvaWQgYnJva2VyQ2xlYW51cC5jYXRjaCgoY2xlYW51cEVycm9yKSA9PiB7XG4gICAgICAgICAgICB0ZXN0UnVubmVyLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShjbGVhbnVwRXJyb3IsIFwic2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlclwiLCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzKVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICBjb25zdCBlbWVyZ2VuY3lDbGVhbnVwID0gdGVzdFJ1bm5lci5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHModHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbnMsIHtkaXNjYXJkOiB0cnVlfSlcbiAgICAgICAgY29uc3QgZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUgPSBhd2FpdCBhd2FpdFNldHRsZWRPckdyYWNlKGVtZXJnZW5jeUNsZWFudXAsIGVmZmVjdGl2ZVRpbWVvdXRNcyA/PyA2MDAwMClcblxuICAgICAgICBpZiAoZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUuc2V0dGxlZCAmJiBlbWVyZ2VuY3lDbGVhbnVwT3V0Y29tZS5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChlbWVyZ2VuY3lDbGVhbnVwT3V0Y29tZS5yZWFzb24pXG4gICAgICAgIH0gZWxzZSBpZiAoIWVtZXJnZW5jeUNsZWFudXBPdXRjb21lLnNldHRsZWQpIHtcbiAgICAgICAgICB2b2lkIGVtZXJnZW5jeUNsZWFudXAuY2F0Y2goKGNsZWFudXBFcnJvcikgPT4ge1xuICAgICAgICAgICAgdGVzdFJ1bm5lci5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoY2xlYW51cEVycm9yLCBcInRyYW5zYWN0aW9uYWwgdGVuYW50XCIsIHJlY29yZGVkVGltZW91dENsZWFudXBFcnJvcnMpXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjYXVnaHRFcnJvciA9IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtjYXVnaHRFcnJvciwgLi4uZW1lcmdlbmN5Q2xlYW51cEVycm9yc10sXG4gICAgICAgICAgICBcIlRlc3QgdGltZW91dCBhbmQgZW1lcmdlbmN5IGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAgICB7Y2F1c2U6IGNhdWdodEVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMuc29tZSgocmVnaXN0cmF0aW9uKSA9PiByZWdpc3RyYXRpb24ucXVhcmFudGluZWQpKSB7XG4gICAgICAgIHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLnJldm9rZWQgPSB0cnVlXG4gICAgICAgIGFib3J0UmVtYWluaW5nVGVzdHMgPSB0cnVlXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLnJldm9rZWQgPSB0cnVlXG5cbiAgICAgIGlmIChwcm9maWxlQXR0ZW1wdCAmJiBwcm9maWxlcikge1xuICAgICAgICBwcm9maWxlci5maW5pc2hBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWRcbiAgICAgICAgICA/IChhdHRlbXB0VGltZWRPdXQgPyBcInRpbWVkLW91dFwiIDogXCJmYWlsZWRcIilcbiAgICAgICAgICA6IFwicGFzc2VkXCIpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGVzdFJ1bm5lci5yZWNvcmRBdHRlbXB0T3V0Y29tZSh0ZXN0LCBhdHRlbXB0TnVtYmVyLCB7XG4gICAgICBhYm9ydFJlbWFpbmluZ1Rlc3RzLFxuICAgICAgZXJyb3I6IGNhdWdodEVycm9yLFxuICAgICAgZmFpbGVkXG4gICAgfSlcblxuICAgIGlmIChmYWlsZWQpIHRocm93IGNhdWdodEVycm9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUtZWFjaCBob29rcyBpbiBpbmhlcml0ZWQgZGVjbGFyYXRpb24gb3JkZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSG9vayBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7UGFja2FnZUhvb2tEZWNsYXJhdGlvbltdfSBhcmdzLmJlZm9yZUVhY2hlcyAtIFNldHVwIGhvb2tzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCIpLlRlc3RBcmdzfSBhcmdzLnRlc3RBcmdzIC0gU3RhYmxlIHRlc3QgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCIpLlRlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFsbCBzZXR1cCBob29rcyBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bkJlZm9yZUVhY2hlcyh7YmVmb3JlRWFjaGVzLCB0ZXN0QXJncywgdGVzdERhdGF9KSB7XG4gICAgZm9yIChjb25zdCBob29rIG9mIGJlZm9yZUVhY2hlcykge1xuICAgICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnRlc3RSdW5uZXIuaG9va01ldGFkYXRhKGhvb2spXG5cbiAgICAgIGF3YWl0IHRoaXMudGVzdFJ1bm5lci5ydW5Qcm9maWxlU3Bhbih7XG4gICAgICAgIHBoYXNlOiBcImJlZm9yZUVhY2hcIixcbiAgICAgICAgZGVjbGFyYXRpb25JbmRleDogbWV0YWRhdGEuZGVjbGFyYXRpb25JbmRleCxcbiAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBtZXRhZGF0YS5kZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICAgIGZpbGVQYXRoOiBtZXRhZGF0YS5vd25lckZpbGVQYXRoXG4gICAgICB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGhvb2suY2FsbGJhY2soe2NvbmZpZ3VyYXRpb246IHRoaXMudGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCksIHRlc3RBcmdzLCB0ZXN0RGF0YX0pXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZXJ5IGFmdGVyLWVhY2ggaG9vayB3aGlsZSBwcmVzZXJ2aW5nIGFsbCBmYWlsdXJlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBIb29rIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtQYWNrYWdlSG9va0RlY2xhcmF0aW9uW119IGFyZ3MuYWZ0ZXJFYWNoZXMgLSBDbGVhbnVwIGhvb2tzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCIpLlRlc3RBcmdzfSBhcmdzLnRlc3RBcmdzIC0gU3RhYmxlIHRlc3QgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCIpLlRlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGNsZWFudXAgaG9vayBzZXR0bGVzLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJFYWNoZXMoe2FmdGVyRWFjaGVzLCB0ZXN0QXJncywgdGVzdERhdGF9KSB7XG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPltdfSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGhvb2sgb2YgYWZ0ZXJFYWNoZXMpIHtcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy50ZXN0UnVubmVyLmhvb2tNZXRhZGF0YShob29rKVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnRlc3RSdW5uZXIucnVuUHJvZmlsZVNwYW4oe1xuICAgICAgICAgIHBoYXNlOiBcImFmdGVyRWFjaFwiLFxuICAgICAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IG1ldGFkYXRhLmRlY2xhcmF0aW9uSW5kZXgsXG4gICAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBtZXRhZGF0YS5kZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICAgICAgZmlsZVBhdGg6IG1ldGFkYXRhLm93bmVyRmlsZVBhdGhcbiAgICAgICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGhvb2suY2FsbGJhY2soe2NvbmZpZ3VyYXRpb246IHRoaXMudGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCksIHRlc3RBcmdzLCB0ZXN0RGF0YX0pXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiTXVsdGlwbGUgYWZ0ZXJFYWNoIGhvb2tzIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gICAgfVxuICB9XG59XG4iXX0=