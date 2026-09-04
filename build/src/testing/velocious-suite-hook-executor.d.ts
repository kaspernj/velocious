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
     * Runs suite setup hooks in declaration order.
     * @param {object} args - Hook execution arguments.
     * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} args.hooks - Profiled setup hooks.
     * @returns {Promise<void>} - Resolves after every setup hook completes.
     */
    runBeforeAlls({ hooks, ...restArgs }: {
        hooks: import("./test-runner.js").BeforeAfterAllCallbackObjectType[];
    }): Promise<void>;
    /**
     * Runs every suite teardown hook in reverse declaration order.
     * @param {object} args - Hook execution arguments.
     * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} args.hooks - Profiled teardown hooks.
     * @returns {Promise<void>} - Resolves after every teardown hook settles.
     */
    runAfterAlls({ hooks, ...restArgs }: {
        hooks: import("./test-runner.js").BeforeAfterAllCallbackObjectType[];
    }): Promise<void>;
    /**
     * Runs one suite hook with its Velocious profiler attribution.
     * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType} hook - Hook registration.
     * @param {"beforeAll" | "afterAll"} phase - Profiler phase.
     * @returns {Promise<void>} - Resolves when the hook completes.
     */
    runHook(hook: import("./test-runner.js").BeforeAfterAllCallbackObjectType, phase: "beforeAll" | "afterAll"): Promise<void>;
}
//# sourceMappingURL=velocious-suite-hook-executor.d.ts.map