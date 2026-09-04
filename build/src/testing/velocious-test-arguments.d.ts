export type TestArgs = import("./test-runner.js").TestArgs;
export type TestData = import("./test-runner.js").TestData;
/** @typedef {import("./test-runner.js").TestArgs} TestArgs */
/** @typedef {import("./test-runner.js").TestData} TestData */
export default class VelociousTestArguments {
    testRunner: import("./test-runner.js").default;
    /**
     * Creates the framework-owned test argument adapter.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }: {
        testRunner: import("./test-runner.js").default;
    });
    /**
     * Builds the stable framework-owned argument object for one selected test.
     * @param {TestData} testData - Selected test registration.
     * @returns {Promise<TestArgs>} - Attempt-shared callback arguments.
     */
    build(testData: TestData): Promise<TestArgs>;
    /**
     * Copies declaration metadata before selection can inspect it.
     * @param {TestData} testData - Test registration.
     * @returns {TestArgs} - Independent test arguments.
     */
    copy(testData: TestData): TestArgs;
    /**
     * Injects type-specific framework collaborators after selection.
     * @param {TestArgs} testArgs - Selected test arguments.
     * @returns {Promise<void>} - Resolves after required collaborators are ready.
     */
    inject(testArgs: TestArgs): Promise<void>;
}
//# sourceMappingURL=velocious-test-arguments.d.ts.map