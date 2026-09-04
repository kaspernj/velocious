export default class VelociousSuiteHookExecutor {
    testRunner: import("./test-runner.js").default;
    /**
     * Creates an executor for Velocious suite hooks.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }: {
        testRunner: import("./test-runner.js").default;
    });
    /**
     * Supplies the framework configuration while package traversal owns ordering,
     * timeout enforcement, aggregation, and active-scope cleanup.
     * @param {import("@velocious/testing/runner").SuiteHookExecutorInput} input - Package hook input.
     * @returns {Promise<void>} - Resolves after the hook completes.
     */
    execute({ context, defaultExecute, fullName, hook, phase, suite, timeoutMs, ...restArgs }: import("@velocious/testing/runner").SuiteHookExecutorInput): Promise<void>;
}
//# sourceMappingURL=velocious-suite-hook-executor.d.ts.map