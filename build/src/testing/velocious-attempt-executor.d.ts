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
    execute({ afterEaches, attemptNumber, beforeEaches, descriptions, testArgs, testData, testDescription, timeoutMs, ...restArgs }: {
        afterEaches: import("./test-runner.js").AfterBeforeEachCallbackObjectType[];
        attemptNumber: number;
        beforeEaches: import("./test-runner.js").AfterBeforeEachCallbackObjectType[];
        descriptions: string[];
        testArgs: import("./velocious-test-arguments.js").TestArgs;
        testData: import("./velocious-test-arguments.js").TestData;
        testDescription: string;
        timeoutMs?: number;
    }): Promise<{
        abortRemainingTests: boolean;
        consoleOutput: string;
        error: ReturnType<typeof JSON.parse>;
        failed: boolean;
    }>;
    /**
     * Runs before-each hooks in inherited declaration order.
     * @param {object} args - Hook arguments.
     * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.beforeEaches - Setup hooks.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @returns {Promise<void>} - Resolves after all setup hooks complete.
     */
    runBeforeEaches({ beforeEaches, testArgs, testData }: {
        beforeEaches: import("./test-runner.js").AfterBeforeEachCallbackObjectType[];
        testArgs: import("./velocious-test-arguments.js").TestArgs;
        testData: import("./velocious-test-arguments.js").TestData;
    }): Promise<void>;
    /**
     * Runs every after-each hook while preserving all failures.
     * @param {object} args - Hook arguments.
     * @param {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} args.afterEaches - Cleanup hooks.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @returns {Promise<void>} - Resolves after every cleanup hook settles.
     */
    runAfterEaches({ afterEaches, testArgs, testData }: {
        afterEaches: import("./test-runner.js").AfterBeforeEachCallbackObjectType[];
        testArgs: import("./velocious-test-arguments.js").TestArgs;
        testData: import("./velocious-test-arguments.js").TestData;
    }): Promise<void>;
}
//# sourceMappingURL=velocious-attempt-executor.d.ts.map