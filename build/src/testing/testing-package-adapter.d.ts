import { defaultTestContext } from "@velocious/testing";
export type TestingPackageSuite = (typeof defaultTestContext.registry.suites)[number];
/**
 * Makes newly imported public-package suites visible to the Velocious runner.
 * @param {import("./test-runner.js").TestsArgument} tests - Velocious root test tree.
 * @returns {void}
 */
export declare function synchronizeTestingPackageTests(tests: import("./test-runner.js").TestsArgument): void;
//# sourceMappingURL=testing-package-adapter.d.ts.map