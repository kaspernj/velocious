export default class VelociousRunnerReporter {
    testRunner: import("./test-runner.js").default;
    /**
     * Creates the legacy event and result projection adapter.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }: {
        testRunner: import("./test-runner.js").default;
    });
    /**
     * Projects one completed attempt into legacy events and final result accounting.
     * Retry eligibility is decided by the caller before this method runs.
     * @param {object} args - Completed attempt and retry metadata.
     * @param {import("./test-runner.js").AttemptConsoleOutput[]} args.attemptConsoleOutputs - Captured output across attempts.
     * @param {number} args.attemptNumber - Current one-based attempt.
     * @param {string[]} args.descriptions - Parent description stack.
     * @param {ReturnType<typeof JSON.parse>} args.error - Raw thrown or rejected value.
     * @param {boolean} args.failed - Whether the attempt failed, independently of error truthiness.
     * @param {string} args.leftPadding - Console indentation.
     * @param {number} args.retriesUsed - Retry count consumed after this attempt.
     * @param {number} args.retryCount - Configured retry limit.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @param {string} args.testDescription - Test description.
     * @param {boolean} args.willRetry - Whether the legacy loop will run another attempt.
     * @returns {Promise<void>} - Resolves after all legacy listeners complete.
     */
    reportAttempt({ attemptConsoleOutputs, attemptNumber, descriptions, error, failed, leftPadding, retriesUsed, retryCount, testArgs, testData, testDescription, willRetry, ...restArgs }: {
        attemptConsoleOutputs: import("./test-runner.js").AttemptConsoleOutput[];
        attemptNumber: number;
        descriptions: string[];
        error: ReturnType<typeof JSON.parse>;
        failed: boolean;
        leftPadding: string;
        retriesUsed: number;
        retryCount: number;
        testArgs: import("./velocious-test-arguments.js").TestArgs;
        testData: import("./velocious-test-arguments.js").TestData;
        testDescription: string;
        willRetry: boolean;
    }): Promise<void>;
    /**
     * Records and emits one final failed test result.
     * @param {object} args - Final failure metadata.
     * @param {import("./test-runner.js").AttemptConsoleOutput[]} args.attemptConsoleOutputs - Captured output across attempts.
     * @param {string[]} args.descriptions - Parent description stack.
     * @param {ReturnType<typeof JSON.parse>} args.error - Raw final failure.
     * @param {string} args.leftPadding - Console indentation.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @param {string} args.testDescription - Test description.
     * @returns {Promise<void>} - Resolves after the final-failure listener completes.
     */
    reportFailedTest({ attemptConsoleOutputs, descriptions, error, leftPadding, testArgs, testData, testDescription }: {
        attemptConsoleOutputs: import("./test-runner.js").AttemptConsoleOutput[];
        descriptions: string[];
        error: ReturnType<typeof JSON.parse>;
        leftPadding: string;
        testArgs: import("./velocious-test-arguments.js").TestArgs;
        testData: import("./velocious-test-arguments.js").TestData;
        testDescription: string;
    }): Promise<void>;
    /**
     * Emits one legacy event and awaits listeners in registration order.
     * @param {string} eventName - Event name.
     * @param {object} payload - Event payload.
     * @returns {Promise<void>} - Resolves when all listeners complete.
     */
    emitEvent(eventName: string, payload: object): Promise<void>;
}
//# sourceMappingURL=velocious-runner-reporter.d.ts.map