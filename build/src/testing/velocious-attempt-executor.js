// @ts-check
import { TestDatabaseAccessRevokedError } from "../environment-handlers/base.js";
import { clearDeliveries } from "../mailer.js";
import restArgsError from "../utils/rest-args-error.js";
import { testConfig } from "./test.js";
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
 * Waits for detached lifecycle cleanup up to the timeout grace period.
 * @param {Promise<ReturnType<typeof JSON.parse>>} lifecycle - Detached lifecycle promise.
 * @param {number} graceMs - Maximum wait.
 * @returns {Promise<{settled: false} | {settled: true, status: "fulfilled"} | {settled: true, status: "rejected", reason: ReturnType<typeof JSON.parse>}>} - Settlement outcome.
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
     * Executes exactly one complete Velocious-owned test attempt.
     * @param {object} args - Attempt arguments.
     * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.afterEaches - Cleanup hooks.
     * @param {number} args.attemptNumber - One-based attempt number.
     * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.beforeEaches - Setup hooks.
     * @param {string[]} args.descriptions - Parent descriptions.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @param {string} args.testDescription - Test description.
     * @param {number} [args.timeoutMs] - Whole-lifecycle timeout.
     * @returns {Promise<{abortRemainingTests: boolean, consoleOutput: string, error: ReturnType<typeof JSON.parse>, failed: boolean}>} - Attempt outcome.
     */
    async execute({ afterEaches, attemptNumber, beforeEaches, descriptions, testArgs, testData, testDescription, timeoutMs, ...restArgs }) {
        restArgsError(restArgs);
        const testRunner = this.testRunner;
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
        /** @type {string} */
        let consoleOutput;
        testArgs.registerTransactionalTenant = async (args) => {
            await testRunner.registerTransactionalTenant(args, transactionalTenantRegistrations);
        };
        const stopConsoleCapture = testRunner.startConsoleCapture({
            passthrough: testConfig.consoleOutput === "live"
        });
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
                        await this.runBeforeEaches({ beforeEaches, testArgs, testData });
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
                            fullDescription: testRunner.buildFullDescription(descriptions, testDescription),
                            filePath: testData.filePath ?? "<unknown>",
                            line: testData.line ?? 0
                        };
                        await testRunner.runProfileSpan({ phase: "test body", filePath: testData.ownerFilePath ?? testData.filePath }, async () => {
                            await testData.function(testArgs);
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
                            await this.runAfterEaches({ afterEaches, testArgs, testData });
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
            if (timeoutMs !== undefined) {
                await runWithTimeout(testLifecycle, timeoutMs, testDescription);
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
                const lifecycleOutcome = await awaitSettledOrGrace(testLifecycle, timeoutMs ?? 60000);
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
                    const quarantineOutcome = await awaitSettledOrGrace(quarantine, timeoutMs ?? 60000);
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
                const brokerCleanupOutcome = await awaitSettledOrGrace(brokerCleanup, timeoutMs ?? 60000);
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
                const emergencyCleanupOutcome = await awaitSettledOrGrace(emergencyCleanup, timeoutMs ?? 60000);
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
            consoleOutput = stopConsoleCapture();
            if (profileAttempt && profiler) {
                profiler.finishAttempt(profileAttempt, failed
                    ? (attemptTimedOut ? "timed-out" : "failed")
                    : "passed");
            }
        }
        return {
            abortRemainingTests,
            consoleOutput,
            error: caughtError,
            failed
        };
    }
    /**
     * Runs before-each hooks in inherited declaration order.
     * @param {object} args - Hook arguments.
     * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.beforeEaches - Setup hooks.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @returns {Promise<void>} - Resolves after all setup hooks complete.
     */
    async runBeforeEaches({ beforeEaches, testArgs, testData }) {
        for (const hook of beforeEaches) {
            await this.testRunner.runProfileSpan({
                phase: "beforeEach",
                declarationIndex: hook.declarationIndex,
                declarationScopeId: hook.declarationScopeId,
                filePath: hook.ownerFilePath
            }, async () => {
                await hook.callback({ configuration: this.testRunner.getConfiguration(), testArgs, testData });
            });
        }
    }
    /**
     * Runs every after-each hook while preserving all failures.
     * @param {object} args - Hook arguments.
     * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.afterEaches - Cleanup hooks.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @returns {Promise<void>} - Resolves after every cleanup hook settles.
     */
    async runAfterEaches({ afterEaches, testArgs, testData }) {
        /** @type {ReturnType<typeof JSON.parse>[]} */
        const errors = [];
        for (const hook of afterEaches) {
            try {
                await this.testRunner.runProfileSpan({
                    phase: "afterEach",
                    declarationIndex: hook.declarationIndex,
                    declarationScopeId: hook.declarationScopeId,
                    filePath: hook.ownerFilePath
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLWF0dGVtcHQtZXhlY3V0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy92ZWxvY2lvdXMtYXR0ZW1wdC1leGVjdXRvci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLDhCQUE4QixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDOUUsT0FBTyxFQUFDLGVBQWUsRUFBQyxNQUFNLGNBQWMsQ0FBQTtBQUM1QyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBRXBDOzs7R0FHRztBQUVIOzs7Ozs7R0FNRztBQUNILFNBQVMsY0FBYyxDQUFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsZUFBZTtJQUN6RCxNQUFNLGNBQWMsR0FBRyxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUMxRSwrQkFBK0I7SUFDL0IsTUFBTSxZQUFZLEdBQUcsSUFBSSxLQUFLLENBQUMsbUJBQW1CLGNBQWMsTUFBTSxlQUFlLEVBQUUsQ0FBQyxDQUFBO0lBQ3hGLFlBQVksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLENBQUE7SUFFeEMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUNyQyxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFBO1FBRWpFLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUU7WUFDdkMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3JCLE9BQU8sQ0FBQyxNQUFNLENB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QWdCLEVBQUUsSUFBSSxDQUFDLGdCQUFnQjtvQkFDdkMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLGtCQUFrQjtvQkFDM0MsUUFBUSxFQUFFLElBQUksQ0FBQyxhQUFhO2lCQUM3QixFQUFFLEtBQUssSUFBSSxFQUFFO29CQUNaLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUE7Z0JBQzlGLENBQUMsQ0FBQyxDQUFBO1lBQ0osQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNwQixDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDO1lBQUUsTUFBTSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdkMsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sSUFBSSxjQUFjLENBQUMsTUFBTSxFQUFFLGlDQUFpQyxFQUFFLEVBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUE7UUFDekYsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9rZWRFcnJvcn0gZnJvbSBcIi4uL2Vudmlyb25tZW50LWhhbmRsZXJzL2Jhc2UuanNcIlxuaW1wb3J0IHtjbGVhckRlbGl2ZXJpZXN9IGZyb20gXCIuLi9tYWlsZXIuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQge3Rlc3RDb25maWd9IGZyb20gXCIuL3Rlc3QuanNcIlxuXG4vKipcbiAqIE1hcmtzIG9uZSB3aG9sZS1saWZlY3ljbGUgdGltZW91dCB3aGlsZSBpdHMgdW5kZXJseWluZyBwcm9taXNlIGtlZXBzIHJ1bm5pbmcuXG4gKiBAdHlwZWRlZiB7RXJyb3IgJiB7dmVsb2Npb3VzVGVzdFRpbWVvdXQ/OiB0cnVlfX0gVGVzdFRpbWVvdXRFcnJvclxuICovXG5cbi8qKlxuICogUnVucyBvbmUgcHJvbWlzZSB3aXRoIGEgbGlmZWN5Y2xlIHRpbWVvdXQuXG4gKiBAcGFyYW0ge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHByb21pc2UgLSBQcm9taXNlIG9yIHZhbHVlLlxuICogQHBhcmFtIHtudW1iZXJ9IHRpbWVvdXRNcyAtIFRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLlxuICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTGlmZWN5Y2xlIHJlc3VsdC5cbiAqL1xuZnVuY3Rpb24gcnVuV2l0aFRpbWVvdXQocHJvbWlzZSwgdGltZW91dE1zLCB0ZXN0RGVzY3JpcHRpb24pIHtcbiAgY29uc3QgdGltZW91dFNlY29uZHMgPSAodGltZW91dE1zIC8gMTAwMCkudG9GaXhlZCgzKS5yZXBsYWNlKC9cXC4/MCskLywgXCJcIilcbiAgLyoqIEB0eXBlIHtUZXN0VGltZW91dEVycm9yfSAqL1xuICBjb25zdCB0aW1lb3V0RXJyb3IgPSBuZXcgRXJyb3IoYFRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRTZWNvbmRzfXM6ICR7dGVzdERlc2NyaXB0aW9ufWApXG4gIHRpbWVvdXRFcnJvci52ZWxvY2lvdXNUZXN0VGltZW91dCA9IHRydWVcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHJlamVjdCh0aW1lb3V0RXJyb3IpLCB0aW1lb3V0TXMpXG5cbiAgICBQcm9taXNlLnJlc29sdmUocHJvbWlzZSkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dClcbiAgICAgIHJlc29sdmUocmVzdWx0KVxuICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpXG4gICAgICByZWplY3QoZXJyb3IpXG4gICAgfSlcbiAgfSlcbn1cblxuLyoqXG4gKiBXYWl0cyBmb3IgZGV0YWNoZWQgbGlmZWN5Y2xlIGNsZWFudXAgdXAgdG8gdGhlIHRpbWVvdXQgZ3JhY2UgcGVyaW9kLlxuICogQHBhcmFtIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbGlmZWN5Y2xlIC0gRGV0YWNoZWQgbGlmZWN5Y2xlIHByb21pc2UuXG4gKiBAcGFyYW0ge251bWJlcn0gZ3JhY2VNcyAtIE1heGltdW0gd2FpdC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHtzZXR0bGVkOiBmYWxzZX0gfCB7c2V0dGxlZDogdHJ1ZSwgc3RhdHVzOiBcImZ1bGZpbGxlZFwifSB8IHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwicmVqZWN0ZWRcIiwgcmVhc29uOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAtIFNldHRsZW1lbnQgb3V0Y29tZS5cbiAqL1xuZnVuY3Rpb24gYXdhaXRTZXR0bGVkT3JHcmFjZShsaWZlY3ljbGUsIGdyYWNlTXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgbGV0IHNldHRsZWQgPSBmYWxzZVxuICAgIGNvbnN0IGdyYWNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cblxuICAgICAgc2V0dGxlZCA9IHRydWVcbiAgICAgIHJlc29sdmUoe3NldHRsZWQ6IGZhbHNlfSlcbiAgICB9LCBncmFjZU1zKVxuXG4gICAgUHJvbWlzZS5yZXNvbHZlKGxpZmVjeWNsZSkudGhlbihcbiAgICAgICgpID0+IHtcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuXG4gICAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICAgIGNsZWFyVGltZW91dChncmFjZVRpbWVyKVxuICAgICAgICByZXNvbHZlKHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwiZnVsZmlsbGVkXCJ9KVxuICAgICAgfSxcbiAgICAgIChyZWFzb24pID0+IHtcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuXG4gICAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICAgIGNsZWFyVGltZW91dChncmFjZVRpbWVyKVxuICAgICAgICByZXNvbHZlKHtzZXR0bGVkOiB0cnVlLCBzdGF0dXM6IFwicmVqZWN0ZWRcIiwgcmVhc29ufSlcbiAgICAgIH1cbiAgICApXG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYSBsYXRlIGxpZmVjeWNsZSBzdG9wcGVkIG9ubHkgYmVjYXVzZSBpdHMgYXR0ZW1wdCBhY2Nlc3Mgd2FzIHJldm9rZWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIExpZmVjeWNsZSByZWplY3Rpb24uXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGV2ZXJ5IGNvbnRhaW5lZCBlcnJvciBpcyBleHBlY3RlZCByZXZvY2F0aW9uLlxuICovXG5mdW5jdGlvbiBpc1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9jYXRpb24oZXJyb3IpIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVGVzdERhdGFiYXNlQWNjZXNzUmV2b2tlZEVycm9yKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgIHJldHVybiBlcnJvci5lcnJvcnMubGVuZ3RoID4gMCAmJiBlcnJvci5lcnJvcnMuZXZlcnkoKG5lc3RlZEVycm9yKSA9PiBpc1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9jYXRpb24obmVzdGVkRXJyb3IpKVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0F0dGVtcHRFeGVjdXRvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIGV4ZWN1dG9yIGZvciBmcmFtZXdvcmstb3duZWQgYXR0ZW1wdCBsaWZlY3ljbGUgd29yay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb25zdHJ1Y3RvciBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5kZWZhdWx0fSBhcmdzLnRlc3RSdW5uZXIgLSBPd25pbmcgVmVsb2Npb3VzIHJ1bm5lci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHt0ZXN0UnVubmVyLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIHRoaXMudGVzdFJ1bm5lciA9IHRlc3RSdW5uZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBleGFjdGx5IG9uZSBjb21wbGV0ZSBWZWxvY2lvdXMtb3duZWQgdGVzdCBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEF0dGVtcHQgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGFyZ3MuYWZ0ZXJFYWNoZXMgLSBDbGVhbnVwIGhvb2tzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5hdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGFyZ3MuYmVmb3JlRWFjaGVzIC0gU2V0dXAgaG9va3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gUGFyZW50IGRlc2NyaXB0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiKS5UZXN0QXJnc30gYXJncy50ZXN0QXJncyAtIFN0YWJsZSB0ZXN0IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiKS5UZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgcmVnaXN0cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGltZW91dE1zXSAtIFdob2xlLWxpZmVjeWNsZSB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YWJvcnRSZW1haW5pbmdUZXN0czogYm9vbGVhbiwgY29uc29sZU91dHB1dDogc3RyaW5nLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGZhaWxlZDogYm9vbGVhbn0+fSAtIEF0dGVtcHQgb3V0Y29tZS5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoe2FmdGVyRWFjaGVzLCBhdHRlbXB0TnVtYmVyLCBiZWZvcmVFYWNoZXMsIGRlc2NyaXB0aW9ucywgdGVzdEFyZ3MsIHRlc3REYXRhLCB0ZXN0RGVzY3JpcHRpb24sIHRpbWVvdXRNcywgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICBjb25zdCB0ZXN0UnVubmVyID0gdGhpcy50ZXN0UnVubmVyXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBsZXQgY2F1Z2h0RXJyb3JcbiAgICBsZXQgZmFpbGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0ZXN0TGlmZWN5Y2xlXG4gICAgLyoqIEB0eXBlIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAqL1xuICAgIGxldCB0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgIGxldCB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5TaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb25cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb25cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSAqL1xuICAgIGNvbnN0IHRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25zID0gW11cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSAqL1xuICAgIGNvbnN0IGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICBjb25zdCB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSA9IHtyZXZva2VkOiBmYWxzZX1cbiAgICAvKiogQHR5cGUge1NldDxFcnJvcj59ICovXG4gICAgY29uc3QgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycyA9IG5ldyBTZXQoKVxuICAgIGxldCBhYm9ydFJlbWFpbmluZ1Rlc3RzID0gZmFsc2VcbiAgICBsZXQgYXR0ZW1wdFRpbWVkT3V0ID0gZmFsc2VcbiAgICAvKiogQHR5cGUge3N0cmluZ30gKi9cbiAgICBsZXQgY29uc29sZU91dHB1dFxuICAgIHRlc3RBcmdzLnJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCA9IGFzeW5jIChhcmdzKSA9PiB7XG4gICAgICBhd2FpdCB0ZXN0UnVubmVyLnJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudChhcmdzLCB0cmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ucylcbiAgICB9XG4gICAgY29uc3Qgc3RvcENvbnNvbGVDYXB0dXJlID0gdGVzdFJ1bm5lci5zdGFydENvbnNvbGVDYXB0dXJlKHtcbiAgICAgIHBhc3N0aHJvdWdoOiB0ZXN0Q29uZmlnLmNvbnNvbGVPdXRwdXQgPT09IFwibGl2ZVwiXG4gICAgfSlcbiAgICBjb25zdCBwcm9maWxlciA9IHRlc3RSdW5uZXIuX3Byb2ZpbGVyXG4gICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSBwcm9maWxlcj8uc3RhcnRBdHRlbXB0KHtcbiAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgIGF0dGVtcHROdW1iZXIsXG4gICAgICB0ZXN0RGF0YSxcbiAgICAgIHRlc3REZXNjcmlwdGlvblxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcnVuTGlmZWN5Y2xlQ2FsbGJhY2sgPSBhc3luYyAoKSA9PiBhd2FpdCB0ZXN0UnVubmVyLnJ1bldpdGhEdW1teUlmTmVlZGVkKHRlc3RBcmdzLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHVzZVRyYW5zYWN0aW9uID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJhbnNhY3Rpb24gPT09IHRydWVcbiAgICAgICAgY29uc3Qgc2hvdWxkVHJ1bmNhdGUgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZSA/PyAhdXNlVHJhbnNhY3Rpb25cbiAgICAgICAgY29uc3QgdXNlU2hhcmVkVGVzdENvbm5lY3Rpb25zID0gdXNlVHJhbnNhY3Rpb24gfHwgdGVzdEFyZ3MudHlwZSA9PSBcInJlcXVlc3RcIlxuICAgICAgICBjb25zdCB1c2VUZXN0Q29ubmVjdGlvbnMgPSB1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMgfHwgc2hvdWxkVHJ1bmNhdGVcbiAgICAgICAgY29uc3QgcnVuVGVzdEF0dGVtcHQgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKHVzZVNoYXJlZFRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gdGVzdFJ1bm5lci5hY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9ucygpXG4gICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT5bXX0gKi9cbiAgICAgICAgICBjb25zdCBsaWZlY3ljbGVFcnJvcnMgPSBbXVxuICAgICAgICAgIGxldCBydW5DbGVhbnVwSG9va3MgPSBmYWxzZVxuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IGF3YWl0IHRlc3RSdW5uZXIucHJlcGFyZVNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJ1bkNsZWFudXBIb29rcyA9IHRydWVcblxuICAgICAgICAgICAgY2xlYXJEZWxpdmVyaWVzKClcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucnVuQmVmb3JlRWFjaGVzKHtiZWZvcmVFYWNoZXMsIHRlc3RBcmdzLCB0ZXN0RGF0YX0pXG5cbiAgICAgICAgICAgIGlmICh1c2VTaGFyZWRUZXN0Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgICAgY29uc3QgYWN0aXZlQ29ubmVjdGlvbnMgPSB0ZXN0UnVubmVyLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IHRydWV9KVxuICAgICAgICAgICAgICBpZiAoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiAmJiAhdGVzdFJ1bm5lci5zaGFyZWRUcmFuc2FjdGlvbkJyb2tlck1hdGNoZXNDb25uZWN0aW9ucyhzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uLCBhY3RpdmVDb25uZWN0aW9ucykpIHtcbiAgICAgICAgICAgICAgICB0ZXN0UnVubmVyLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IGZhbHNlXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiA9IGF3YWl0IHRlc3RSdW5uZXIuc3RhcnRTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihzaGFyZWRUcmFuc2FjdGlvbkJyb2tlclByZXBhcmF0aW9uLCBhY3RpdmVDb25uZWN0aW9ucylcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgICBpZiAoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gJiYgIXRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IHRlc3RSdW5uZXIuYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnMoKVxuICAgICAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IHRydWVcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0ZXN0UnVubmVyLl9sYXN0VGVzdENvbnRleHQgPSB7XG4gICAgICAgICAgICAgIGZ1bGxEZXNjcmlwdGlvbjogdGVzdFJ1bm5lci5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiksXG4gICAgICAgICAgICAgIGZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCA/PyBcIjx1bmtub3duPlwiLFxuICAgICAgICAgICAgICBsaW5lOiB0ZXN0RGF0YS5saW5lID8/IDBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IHRlc3RSdW5uZXIucnVuUHJvZmlsZVNwYW4oe3BoYXNlOiBcInRlc3QgYm9keVwiLCBmaWxlUGF0aDogdGVzdERhdGEub3duZXJGaWxlUGF0aCA/PyB0ZXN0RGF0YS5maWxlUGF0aH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGVzdERhdGEuZnVuY3Rpb24odGVzdEFyZ3MpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAocnVuQ2xlYW51cEhvb2tzKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCB0ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKS5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBpZiAodGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgdGVzdFJ1bm5lci5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyh0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gW11cbiAgICAgICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNBY3RpdmUgPSBmYWxzZVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGVzdFJ1bm5lci5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfHwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbilcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucnVuQWZ0ZXJFYWNoZXMoe2FmdGVyRWFjaGVzLCB0ZXN0QXJncywgdGVzdERhdGF9KVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IHRlc3RSdW5uZXIuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKHRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25zKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgdGVzdFJ1bm5lci5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyh0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSA9IGZhbHNlXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgbGlmZWN5Y2xlRXJyb3JzWzBdXG4gICAgICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IobGlmZWN5Y2xlRXJyb3JzLCBcIlRlc3QgbGlmZWN5Y2xlIGFuZCBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGxpZmVjeWNsZUVycm9yc1swXX0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHVzZVRlc3RDb25uZWN0aW9ucykge1xuICAgICAgICAgIGF3YWl0IHRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgVGVzdDogJHt0ZXN0RGVzY3JpcHRpb259YH0sIHJ1blRlc3RBdHRlbXB0KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGF3YWl0IHJ1blRlc3RBdHRlbXB0KClcbiAgICAgICAgfVxuICAgICAgfSwgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICBjb25zdCBsaWZlY3ljbGVDYWxsYmFjayA9IGFzeW5jICgpID0+IGF3YWl0IHRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLnJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSwgcnVuTGlmZWN5Y2xlQ2FsbGJhY2spXG4gICAgICB0ZXN0TGlmZWN5Y2xlID0gcHJvZmlsZUF0dGVtcHQgJiYgcHJvZmlsZXJcbiAgICAgICAgPyBwcm9maWxlci5ydW5BdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBsaWZlY3ljbGVDYWxsYmFjaylcbiAgICAgICAgOiBsaWZlY3ljbGVDYWxsYmFjaygpXG5cbiAgICAgIGlmICh0aW1lb3V0TXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCBydW5XaXRoVGltZW91dCh0ZXN0TGlmZWN5Y2xlLCB0aW1lb3V0TXMsIHRlc3REZXNjcmlwdGlvbilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRlc3RMaWZlY3ljbGVcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZmFpbGVkID0gdHJ1ZVxuICAgICAgY2F1Z2h0RXJyb3IgPSBlcnJvclxuICAgICAgY29uc3QgdGltZWRPdXQgPSBCb29sZWFuKC8qKiBAdHlwZSB7VGVzdFRpbWVvdXRFcnJvcn0gKi8gKGVycm9yKT8udmVsb2Npb3VzVGVzdFRpbWVvdXQpXG4gICAgICBhdHRlbXB0VGltZWRPdXQgPSB0aW1lZE91dFxuXG4gICAgICBpZiAodGltZWRPdXQgJiYgdGVzdExpZmVjeWNsZSkge1xuICAgICAgICBjb25zdCBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzID0gW11cblxuICAgICAgICBpZiAocHJvZmlsZUF0dGVtcHQgJiYgcHJvZmlsZXIpIHByb2ZpbGVyLmZpbmlzaEF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIFwidGltZWQtb3V0XCIpXG4gICAgICAgIGNvbnN0IGxpZmVjeWNsZU91dGNvbWUgPSBhd2FpdCBhd2FpdFNldHRsZWRPckdyYWNlKHRlc3RMaWZlY3ljbGUsIHRpbWVvdXRNcyA/PyA2MDAwMClcblxuICAgICAgICBpZiAobGlmZWN5Y2xlT3V0Y29tZS5zZXR0bGVkICYmIGxpZmVjeWNsZU91dGNvbWUuc3RhdHVzID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLnB1c2gobGlmZWN5Y2xlT3V0Y29tZS5yZWFzb24pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWxpZmVjeWNsZU91dGNvbWUuc2V0dGxlZCkge1xuICAgICAgICAgIHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLnJldm9rZWQgPSB0cnVlXG4gICAgICAgICAgdm9pZCB0ZXN0TGlmZWN5Y2xlLmNhdGNoKChjbGVhbnVwRXJyb3IpID0+IHtcbiAgICAgICAgICAgIGlmIChpc1Rlc3REYXRhYmFzZUFjY2Vzc1Jldm9jYXRpb24oY2xlYW51cEVycm9yKSkgcmV0dXJuXG4gICAgICAgICAgICB0ZXN0UnVubmVyLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShjbGVhbnVwRXJyb3IsIFwidGVzdCBsaWZlY3ljbGVcIiwgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycylcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnN0IHF1YXJhbnRpbmUgPSB0ZXN0UnVubmVyLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9ucyhicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgICAgICBjb25zdCBxdWFyYW50aW5lT3V0Y29tZSA9IGF3YWl0IGF3YWl0U2V0dGxlZE9yR3JhY2UocXVhcmFudGluZSwgdGltZW91dE1zID8/IDYwMDAwKVxuICAgICAgICAgIGNvbnN0IHVzZXNCcm93c2VyVHJhbnNhY3Rpb25zID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJhbnNhY3Rpb24gPT09IHRydWVcbiAgICAgICAgICBjb25zdCB1c2VzQnJvd3NlclRydW5jYXRpb24gPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZSA/PyAhdXNlc0Jyb3dzZXJUcmFuc2FjdGlvbnNcblxuICAgICAgICAgIGFib3J0UmVtYWluaW5nVGVzdHMgPSB0ZXN0UnVubmVyLmlzQnJvd3NlclRlc3RNb2RlKClcbiAgICAgICAgICAgICYmIHRlc3RSdW5uZXIuaGFzVGFnKHRlc3RBcmdzLCBcImR1bW15XCIpXG4gICAgICAgICAgICAmJiAodXNlc0Jyb3dzZXJUcmFuc2FjdGlvbnMgfHwgdXNlc0Jyb3dzZXJUcnVuY2F0aW9uKVxuXG4gICAgICAgICAgaWYgKHF1YXJhbnRpbmVPdXRjb21lLnNldHRsZWQgJiYgcXVhcmFudGluZU91dGNvbWUuc3RhdHVzID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChxdWFyYW50aW5lT3V0Y29tZS5yZWFzb24pXG4gICAgICAgICAgfSBlbHNlIGlmICghcXVhcmFudGluZU91dGNvbWUuc2V0dGxlZCkge1xuICAgICAgICAgICAgdm9pZCBxdWFyYW50aW5lLmNhdGNoKChjbGVhbnVwRXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgdGVzdFJ1bm5lci5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoY2xlYW51cEVycm9yLCBcImJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiBxdWFyYW50aW5lXCIsIHJlY29yZGVkVGltZW91dENsZWFudXBFcnJvcnMpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKHRlc3RTaGFyZWRDb25uZWN0aW9uc0FjdGl2ZSkge1xuICAgICAgICAgICAgdGVzdFJ1bm5lci5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyh0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICAgICAgICB0ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXVxuICAgICAgICAgICAgdGVzdFNoYXJlZENvbm5lY3Rpb25zQWN0aXZlID0gZmFsc2VcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChjbGVhbnVwRXJyb3IpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBicm9rZXJDbGVhbnVwID0gdGVzdFJ1bm5lci5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfHwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJQcmVwYXJhdGlvbilcbiAgICAgICAgY29uc3QgYnJva2VyQ2xlYW51cE91dGNvbWUgPSBhd2FpdCBhd2FpdFNldHRsZWRPckdyYWNlKGJyb2tlckNsZWFudXAsIHRpbWVvdXRNcyA/PyA2MDAwMClcblxuICAgICAgICBpZiAoYnJva2VyQ2xlYW51cE91dGNvbWUuc2V0dGxlZCAmJiBicm9rZXJDbGVhbnVwT3V0Y29tZS5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgIGVtZXJnZW5jeUNsZWFudXBFcnJvcnMucHVzaChicm9rZXJDbGVhbnVwT3V0Y29tZS5yZWFzb24pXG4gICAgICAgIH0gZWxzZSBpZiAoIWJyb2tlckNsZWFudXBPdXRjb21lLnNldHRsZWQpIHtcbiAgICAgICAgICB2b2lkIGJyb2tlckNsZWFudXAuY2F0Y2goKGNsZWFudXBFcnJvcikgPT4ge1xuICAgICAgICAgICAgdGVzdFJ1bm5lci5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoY2xlYW51cEVycm9yLCBcInNoYXJlZCB0cmFuc2FjdGlvbiBicm9rZXJcIiwgcmVjb3JkZWRUaW1lb3V0Q2xlYW51cEVycm9ycylcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUHJlcGFyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgY29uc3QgZW1lcmdlbmN5Q2xlYW51cCA9IHRlc3RSdW5uZXIuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKHRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25zLCB7ZGlzY2FyZDogdHJ1ZX0pXG4gICAgICAgIGNvbnN0IGVtZXJnZW5jeUNsZWFudXBPdXRjb21lID0gYXdhaXQgYXdhaXRTZXR0bGVkT3JHcmFjZShlbWVyZ2VuY3lDbGVhbnVwLCB0aW1lb3V0TXMgPz8gNjAwMDApXG5cbiAgICAgICAgaWYgKGVtZXJnZW5jeUNsZWFudXBPdXRjb21lLnNldHRsZWQgJiYgZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUuc3RhdHVzID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICBlbWVyZ2VuY3lDbGVhbnVwRXJyb3JzLnB1c2goZW1lcmdlbmN5Q2xlYW51cE91dGNvbWUucmVhc29uKVxuICAgICAgICB9IGVsc2UgaWYgKCFlbWVyZ2VuY3lDbGVhbnVwT3V0Y29tZS5zZXR0bGVkKSB7XG4gICAgICAgICAgdm9pZCBlbWVyZ2VuY3lDbGVhbnVwLmNhdGNoKChjbGVhbnVwRXJyb3IpID0+IHtcbiAgICAgICAgICAgIHRlc3RSdW5uZXIucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGNsZWFudXBFcnJvciwgXCJ0cmFuc2FjdGlvbmFsIHRlbmFudFwiLCByZWNvcmRlZFRpbWVvdXRDbGVhbnVwRXJyb3JzKVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZW1lcmdlbmN5Q2xlYW51cEVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY2F1Z2h0RXJyb3IgPSBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbY2F1Z2h0RXJyb3IsIC4uLmVtZXJnZW5jeUNsZWFudXBFcnJvcnNdLFxuICAgICAgICAgICAgXCJUZXN0IHRpbWVvdXQgYW5kIGVtZXJnZW5jeSBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgICAge2NhdXNlOiBjYXVnaHRFcnJvcn1cbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zLnNvbWUoKHJlZ2lzdHJhdGlvbikgPT4gcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkKSkge1xuICAgICAgICB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZS5yZXZva2VkID0gdHJ1ZVxuICAgICAgICBhYm9ydFJlbWFpbmluZ1Rlc3RzID0gdHJ1ZVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZS5yZXZva2VkID0gdHJ1ZVxuICAgICAgY29uc29sZU91dHB1dCA9IHN0b3BDb25zb2xlQ2FwdHVyZSgpXG5cbiAgICAgIGlmIChwcm9maWxlQXR0ZW1wdCAmJiBwcm9maWxlcikge1xuICAgICAgICBwcm9maWxlci5maW5pc2hBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWRcbiAgICAgICAgICA/IChhdHRlbXB0VGltZWRPdXQgPyBcInRpbWVkLW91dFwiIDogXCJmYWlsZWRcIilcbiAgICAgICAgICA6IFwicGFzc2VkXCIpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFib3J0UmVtYWluaW5nVGVzdHMsXG4gICAgICBjb25zb2xlT3V0cHV0LFxuICAgICAgZXJyb3I6IGNhdWdodEVycm9yLFxuICAgICAgZmFpbGVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlLWVhY2ggaG9va3MgaW4gaW5oZXJpdGVkIGRlY2xhcmF0aW9uIG9yZGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEhvb2sgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGFyZ3MuYmVmb3JlRWFjaGVzIC0gU2V0dXAgaG9va3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIikuVGVzdEFyZ3N9IGFyZ3MudGVzdEFyZ3MgLSBTdGFibGUgdGVzdCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIikuVGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIHNldHVwIGhvb2tzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuQmVmb3JlRWFjaGVzKHtiZWZvcmVFYWNoZXMsIHRlc3RBcmdzLCB0ZXN0RGF0YX0pIHtcbiAgICBmb3IgKGNvbnN0IGhvb2sgb2YgYmVmb3JlRWFjaGVzKSB7XG4gICAgICBhd2FpdCB0aGlzLnRlc3RSdW5uZXIucnVuUHJvZmlsZVNwYW4oe1xuICAgICAgICBwaGFzZTogXCJiZWZvcmVFYWNoXCIsXG4gICAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IGhvb2suZGVjbGFyYXRpb25JbmRleCxcbiAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBob29rLmRlY2xhcmF0aW9uU2NvcGVJZCxcbiAgICAgICAgZmlsZVBhdGg6IGhvb2sub3duZXJGaWxlUGF0aFxuICAgICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBob29rLmNhbGxiYWNrKHtjb25maWd1cmF0aW9uOiB0aGlzLnRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLCB0ZXN0QXJncywgdGVzdERhdGF9KVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVyeSBhZnRlci1lYWNoIGhvb2sgd2hpbGUgcHJlc2VydmluZyBhbGwgZmFpbHVyZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSG9vayBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5BZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYXJncy5hZnRlckVhY2hlcyAtIENsZWFudXAgaG9va3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIikuVGVzdEFyZ3N9IGFyZ3MudGVzdEFyZ3MgLSBTdGFibGUgdGVzdCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIikuVGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgY2xlYW51cCBob29rIHNldHRsZXMuXG4gICAqL1xuICBhc3luYyBydW5BZnRlckVhY2hlcyh7YWZ0ZXJFYWNoZXMsIHRlc3RBcmdzLCB0ZXN0RGF0YX0pIHtcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+W119ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgaG9vayBvZiBhZnRlckVhY2hlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy50ZXN0UnVubmVyLnJ1blByb2ZpbGVTcGFuKHtcbiAgICAgICAgICBwaGFzZTogXCJhZnRlckVhY2hcIixcbiAgICAgICAgICBkZWNsYXJhdGlvbkluZGV4OiBob29rLmRlY2xhcmF0aW9uSW5kZXgsXG4gICAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBob29rLmRlY2xhcmF0aW9uU2NvcGVJZCxcbiAgICAgICAgICBmaWxlUGF0aDogaG9vay5vd25lckZpbGVQYXRoXG4gICAgICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBob29rLmNhbGxiYWNrKHtjb25maWd1cmF0aW9uOiB0aGlzLnRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLCB0ZXN0QXJncywgdGVzdERhdGF9KVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIk11bHRpcGxlIGFmdGVyRWFjaCBob29rcyBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICAgIH1cbiAgfVxufVxuIl19