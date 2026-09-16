import { afterAll, afterEach, arrayContaining, beforeAll, beforeEach, configureTests, defaultTestContext, describe, expect, fdescribe, fit, it, objectContaining, test, waitForEvent, xdescribe, xit, xtest } from "@velocious/testing";
export type PackageSuiteDeclaration = (typeof defaultTestContext.registry.suites)[number];
export type VelociousTestConfig = {
    /**
     * - Console output mode.
     */
    consoleOutput: "failure" | "live";
    /**
     * - Tags excluded by default.
     */
    excludeTags: string[];
    /**
     * - Default timeout in seconds.
     */
    defaultTimeoutSeconds: number;
    /**
     * - Maximum failed console lines to print inline.
     */
    failedConsoleOutputMaxLines: number;
};
/** @typedef {(typeof defaultTestContext.registry.suites)[number]} PackageSuiteDeclaration */
/**
 * VelociousTestConfig type.
 * @typedef {object} VelociousTestConfig
 * @property {"failure" | "live"} consoleOutput - Console output mode.
 * @property {string[]} excludeTags - Tags excluded by default.
 * @property {number} defaultTimeoutSeconds - Default timeout in seconds.
 * @property {number} failedConsoleOutputMaxLines - Maximum failed console lines to print inline.
 */
/** Velocious-owned awaited compatibility events. */
declare const testEvents: import("eventemitter3").EventEmitter<string | symbol, any>;
/**
 * Backward-compatible view of the package configuration.
 * @type {VelociousTestConfig}
 */
declare const testConfig: VelociousTestConfig;
/** @type {import("./test-runner.js").TestsArgument} */
declare const tests: import("./test-runner.js").TestsArgument;
export { afterAll, afterEach, beforeAll, beforeEach, configureTests, describe, expect, fdescribe, fit, it, test, xdescribe, xit, xtest, arrayContaining, objectContaining, testConfig, testEvents, tests, waitForEvent };
//# sourceMappingURL=test.d.ts.map