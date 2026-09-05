export type PackageTestDeclaration = import("@velocious/testing/runner").TestDeclaration;
/** @typedef {import("@velocious/testing/runner").TestDeclaration} PackageTestDeclaration */
/** Stops package traversal after framework-owned connection quarantine. */
export declare class AbortRemainingTestsError extends Error {
}
export default class VelociousRunnerReporter {
    testRunner: import("./test-runner.js").default;
    /** @type {WeakMap<PackageTestDeclaration, import("./test-runner.js").AttemptConsoleOutput[]>} */
    attemptConsoleOutputs: WeakMap<PackageTestDeclaration, import("./test-runner.js").AttemptConsoleOutput[]>;
    /** @type {PackageTestDeclaration | undefined} */
    activeTest: PackageTestDeclaration | undefined;
    /**
     * Creates the legacy event and result projection adapter.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }: {
        testRunner: import("./test-runner.js").default;
    });
    /**
     * Translates one awaited package runner event into the legacy contract.
     * @param {import("@velocious/testing/runner").RunnerEvent} event - Structured package event.
     * @returns {Promise<void>} - Resolves after legacy listeners finish.
     */
    onEvent(event: import("@velocious/testing/runner").RunnerEvent): Promise<void>;
    /**
     * Projects attempt failure/retry events while retaining the raw thrown value.
     * @param {import("@velocious/testing/runner").RunnerEvent} event - Attempt event.
     * @returns {Promise<void>} - Resolves after listeners finish.
     */
    reportAttemptEvent(event: import("@velocious/testing/runner").RunnerEvent): Promise<void>;
    /**
     * Projects final package result accounting and failures.
     * @param {import("@velocious/testing/runner").RunnerEvent} event - Test result event.
     * @returns {Promise<void>} - Resolves after listeners finish.
     */
    reportTestEvent(event: import("@velocious/testing/runner").RunnerEvent): Promise<void>;
    /**
     * Records and emits one final failed test result.
     * @param {object} args - Final failure metadata.
     * @param {import("./test-runner.js").AttemptConsoleOutput[]} args.attemptConsoleOutputs - Captured output across attempts.
     * @param {string[]} args.descriptions - Parent description stack.
     * @param {ReturnType<typeof JSON.parse>} args.error - Raw final failure.
     * @param {string} args.leftPadding - Console indentation.
     * @param {import("./test-runner.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./test-runner.js").TestData} args.testData - Test registration.
     * @param {string} args.testDescription - Test description.
     * @returns {Promise<void>} - Resolves after the final-failure listener completes.
     */
    reportFailedTest({ attemptConsoleOutputs, descriptions, error, leftPadding, testArgs, testData, testDescription }: {
        attemptConsoleOutputs: import("./test-runner.js").AttemptConsoleOutput[];
        descriptions: string[];
        error: ReturnType<typeof JSON.parse>;
        leftPadding: string;
        testArgs: import("./test-runner.js").TestArgs;
        testData: import("./test-runner.js").TestData;
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