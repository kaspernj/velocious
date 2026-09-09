export type PackageHookDeclaration = import("@velocious/testing/runner").AttemptExecutorInput["beforeEach"][number];
export type TestTimeoutError = Error & {
    velociousTestTimeout?: true;
};
export default class VelociousAttemptExecutor {
    testRunner: import("./test-runner.js").default;
    /**
     * Creates an executor for framework-owned attempt lifecycle work.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }: {
        testRunner: import("./test-runner.js").default;
    });
    /**
     * Normalizes the legacy timeout contract at the framework adapter boundary.
     * @param {number | undefined} timeoutMs - Declared package timeout.
     * @returns {number | undefined} - Positive finite timeout, or no timeout.
     */
    normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined;
    /**
     * Executes exactly one complete Velocious-owned test attempt.
     * @param {import("@velocious/testing/runner").AttemptExecutorInput} input - Package attempt.
     * @returns {Promise<void>} - Resolves after one complete framework attempt.
     */
    execute({ afterEach, args, attemptNumber, beforeEach, context, defaultExecute, fullName, suite, test, timeoutMs, ...restArgs }: import("@velocious/testing/runner").AttemptExecutorInput): Promise<void>;
    /**
     * Runs before-each hooks in inherited declaration order.
     * @param {object} args - Hook arguments.
     * @param {PackageHookDeclaration[]} args.beforeEaches - Setup hooks.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @returns {Promise<void>} - Resolves after all setup hooks complete.
     */
    runBeforeEaches({ beforeEaches, testArgs, testData }: {
        beforeEaches: PackageHookDeclaration[];
        testArgs: import("./velocious-test-arguments.js").TestArgs;
        testData: import("./velocious-test-arguments.js").TestData;
    }): Promise<void>;
    /**
     * Runs every after-each hook while preserving all failures.
     * @param {object} args - Hook arguments.
     * @param {PackageHookDeclaration[]} args.afterEaches - Cleanup hooks.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @returns {Promise<void>} - Resolves after every cleanup hook settles.
     */
    runAfterEaches({ afterEaches, testArgs, testData }: {
        afterEaches: PackageHookDeclaration[];
        testArgs: import("./velocious-test-arguments.js").TestArgs;
        testData: import("./velocious-test-arguments.js").TestData;
    }): Promise<void>;
}
//# sourceMappingURL=velocious-attempt-executor.d.ts.map