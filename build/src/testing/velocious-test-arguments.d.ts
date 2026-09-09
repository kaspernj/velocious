export type TestArgs = import("./test-runner.js").TestArgs;
export type TestData = import("./test-runner.js").TestData;
export type PackageTestDeclaration = import("@velocious/testing/runner").TestDeclaration;
/** @typedef {import("./test-runner.js").TestArgs} TestArgs */
/** @typedef {import("./test-runner.js").TestData} TestData */
/** @typedef {import("@velocious/testing/runner").TestDeclaration} PackageTestDeclaration */
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
     * Resolves stable Velocious arguments after package-owned table arguments.
     * @param {object} input - Package resolver input.
     * @param {PackageTestDeclaration} input.test - Selected declaration.
     * @returns {Promise<ReturnType<typeof JSON.parse>[]>} - Callback arguments.
     */
    resolve({ test }: {
        test: PackageTestDeclaration;
    }): Promise<ReturnType<typeof JSON.parse>[]>;
    /**
     * Copies declaration metadata before selection can inspect it.
     * @param {PackageTestDeclaration} testData - Test registration.
     * @returns {TestArgs} - Independent test arguments.
     */
    copy(testData: PackageTestDeclaration): TestArgs;
    /**
     * Injects type-specific framework collaborators after selection.
     * @param {TestArgs} testArgs - Selected test arguments.
     * @returns {Promise<void>} - Resolves after required collaborators are ready.
     */
    inject(testArgs: TestArgs): Promise<void>;
}
//# sourceMappingURL=velocious-test-arguments.d.ts.map