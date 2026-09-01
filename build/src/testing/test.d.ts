import { waitForEvent } from "@velocious/testing";
import Expect from "./expect.js";
import { arrayContaining, objectContaining } from "./expect-utils.js";
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
/**
 * VelociousTestConfig type.
 * @typedef {object} VelociousTestConfig
 * @property {"failure" | "live"} consoleOutput - Console output mode.
 * @property {string[]} excludeTags - Tags excluded by default.
 * @property {number} defaultTimeoutSeconds - Default timeout in seconds.
 * @property {number} failedConsoleOutputMaxLines - Maximum failed console lines to print inline.
 */
/**
 * Tests.
 * @type {import("./test-runner.js").TestsArgument} */
declare const tests: import("./test-runner.js").TestsArgument;
declare const testEvents: import("eventemitter3").EventEmitter<string | symbol, any>;
/**
 * Test config.
 * @type {VelociousTestConfig} */
declare const testConfig: VelociousTestConfig;
/**
 * Runs configure tests.
 * @param {object} args - Options.
 * @param {"failure" | "live"} [args.consoleOutput] - Console output mode.
 * @param {string[] | string} [args.excludeTags] - Tags to exclude.
 * @param {number} [args.defaultTimeoutSeconds] - Default timeout in seconds.
 * @param {number} [args.failedConsoleOutputMaxLines] - Maximum failed console lines to print inline.
 * @returns {void}
 */
declare function configureTests({ consoleOutput, excludeTags, defaultTimeoutSeconds, failedConsoleOutputMaxLines }?: {
    consoleOutput?: "failure" | "live";
    excludeTags?: string[] | string;
    defaultTimeoutSeconds?: number;
    failedConsoleOutputMaxLines?: number;
}): void;
/**
 * Runs before each.
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
declare function beforeEach(callback: import("./test-runner.js").AfterBeforeEachCallbackType): void;
/**
 * Runs before all.
 * @param {import("./test-runner.js").BeforeAfterAllCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
declare function beforeAll(callback: import("./test-runner.js").BeforeAfterAllCallbackType): void;
/**
 * Runs after each.
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
declare function afterEach(callback: import("./test-runner.js").AfterBeforeEachCallbackType): void;
/**
 * Runs after all.
 * @param {import("./test-runner.js").BeforeAfterAllCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
declare function afterAll(callback: import("./test-runner.js").BeforeAfterAllCallbackType): void;
/**
 * Runs describe.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {Promise<void>} - Resolves when complete.
 */
declare function describe(description: string, arg1: object | (() => (void | Promise<void>)), arg2?: undefined | (() => (void | Promise<void>))): Promise<void>;
/**
 * Runs expect.
 * @param {ReturnType<typeof JSON.parse>} arg - Arg.
 * @returns {Expect} - The expect.
 */
declare function expect(arg: ReturnType<typeof JSON.parse>): Expect;
declare namespace expect {
    export { objectContaining };
    export { arrayContaining };
}
/**
 * Runs it.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {void} - No return value.
 */
declare function it(description: string, arg1: object | (() => (void | Promise<void>)), arg2?: undefined | (() => (void | Promise<void>))): void;
/**
 * Runs fit.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {void} - No return value.
 */
declare function fit(description: string, arg1: object | (() => (void | Promise<void>)), arg2?: undefined | (() => (void | Promise<void>))): void;
export { afterAll, afterEach, beforeAll, beforeEach, configureTests, describe, expect, fit, it, arrayContaining, objectContaining, testConfig, testEvents, tests, waitForEvent };
//# sourceMappingURL=test.d.ts.map