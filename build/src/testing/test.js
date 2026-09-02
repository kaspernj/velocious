// @ts-check
import path from "path";
import { fileURLToPath } from "url";
import { waitForEvent } from "@velocious/testing";
import EventEmitter from "../utils/event-emitter.js";
import Expect from "./expect.js";
import { arrayContaining, objectContaining } from "./expect-utils.js";
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
const tests = {
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
    afterEaches: [],
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} */
    afterAlls: [],
    args: { databaseCleaning: { transaction: true } },
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} */
    beforeAlls: [],
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
    beforeEaches: [],
    filePath: undefined,
    line: undefined,
    subs: {},
    tests: {}
};
const testEvents = new EventEmitter();
let currentPath = [tests];
/**
 * Runs capture location.
 * @returns {{filePath?: string, line?: number}} - Location.
 */
function captureLocation() {
    const error = new Error();
    const stack = typeof error.stack === "string" ? error.stack.split("\n") : [];
    for (const line of stack) {
        const trimmed = line.trim();
        if (!trimmed.includes("at"))
            continue;
        if (trimmed.includes("/src/testing/test.js"))
            continue;
        const match = trimmed.match(/(?:\(|\s)(file:\/\/.*?|\/.*?):(\d+):(\d+)\)?$/);
        if (!match)
            continue;
        const rawPath = match[1];
        const lineNumber = Number(match[2]);
        const filePath = rawPath.startsWith("file://")
            ? fileURLToPath(rawPath)
            : rawPath;
        return {
            filePath: path.resolve(filePath),
            line: Number.isFinite(lineNumber) ? lineNumber : undefined
        };
    }
    return {};
}
/**
 * Runs normalize tags.
 * @param {string[] | string | undefined} tags - Tags.
 * @returns {string[]} - Normalized tags.
 */
function normalizeTags(tags) {
    if (!tags)
        return [];
    const values = [];
    const rawTags = Array.isArray(tags) ? tags : [tags];
    for (const rawTag of rawTags) {
        if (rawTag === undefined || rawTag === null)
            continue;
        const parts = String(rawTag).split(",");
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed)
                values.push(trimmed);
        }
    }
    return Array.from(new Set(values));
}
/**
 * Test config.
 * @type {VelociousTestConfig} */
const testConfig = {
    consoleOutput: "failure",
    failedConsoleOutputMaxLines: 200,
    excludeTags: [],
    defaultTimeoutSeconds: 60
};
/**
 * Runs configure tests.
 * @param {object} args - Options.
 * @param {"failure" | "live"} [args.consoleOutput] - Console output mode.
 * @param {string[] | string} [args.excludeTags] - Tags to exclude.
 * @param {number} [args.defaultTimeoutSeconds] - Default timeout in seconds.
 * @param {number} [args.failedConsoleOutputMaxLines] - Maximum failed console lines to print inline.
 * @returns {void}
 */
function configureTests({ consoleOutput, excludeTags, defaultTimeoutSeconds, failedConsoleOutputMaxLines } = {}) {
    if (excludeTags !== undefined) {
        testConfig.excludeTags = normalizeTags(excludeTags);
    }
    if (consoleOutput !== undefined) {
        if (consoleOutput !== "failure" && consoleOutput !== "live") {
            throw new Error(`Invalid consoleOutput config: ${consoleOutput}`);
        }
        testConfig.consoleOutput = consoleOutput;
    }
    if (typeof defaultTimeoutSeconds === "number") {
        testConfig.defaultTimeoutSeconds = defaultTimeoutSeconds;
    }
    if (typeof failedConsoleOutputMaxLines === "number") {
        testConfig.failedConsoleOutputMaxLines = failedConsoleOutputMaxLines;
    }
}
/**
 * Runs merge test args.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} baseArgs - Base args.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} extraArgs - Extra args.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Merged args.
 */
function mergeTestArgs(baseArgs, extraArgs) {
    const merged = Object.assign({}, baseArgs, extraArgs);
    const mergedTags = [...normalizeTags(baseArgs?.tags), ...normalizeTags(extraArgs?.tags)];
    if (mergedTags.length > 0) {
        merged.tags = Array.from(new Set(mergedTags));
    }
    else if ("tags" in merged) {
        delete merged.tags;
    }
    return merged;
}
/**
 * Runs before each.
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function beforeEach(callback) {
    const currentTest = currentPath[currentPath.length - 1];
    currentTest.beforeEaches.push({ callback });
}
/**
 * Runs before all.
 * @param {import("./test-runner.js").BeforeAfterAllCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function beforeAll(callback) {
    const currentTest = currentPath[currentPath.length - 1];
    currentTest.beforeAlls.push({ callback });
}
/**
 * Runs after each.
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function afterEach(callback) {
    const currentTest = currentPath[currentPath.length - 1];
    currentTest.afterEaches.push({ callback });
}
/**
 * Runs after all.
 * @param {import("./test-runner.js").BeforeAfterAllCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function afterAll(callback) {
    const currentTest = currentPath[currentPath.length - 1];
    currentTest.afterAlls.push({ callback });
}
/**
 * Runs describe.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function describe(description, arg1, arg2) {
    /**
     * Defines testArgs.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    let testArgs, testFunction;
    if (typeof arg2 == "function") {
        testFunction = arg2;
        testArgs = arg1;
    }
    else if (typeof arg1 == "function") {
        testFunction = arg1;
        testArgs = {};
    }
    else {
        throw new Error(`Invalid arguments for describe: ${arg1}, ${arg2}`);
    }
    const currentTest = currentPath[currentPath.length - 1];
    const newTestArgs = mergeTestArgs(currentTest.args, testArgs);
    if (description in currentTest.subs) {
        throw new Error(`Duplicate test description: ${description}`);
    }
    const location = captureLocation();
    const newTestData = {
        afterEaches: [],
        afterAlls: [],
        args: newTestArgs,
        beforeAlls: [],
        beforeEaches: [],
        filePath: location.filePath,
        line: location.line,
        subs: {},
        tests: {}
    };
    currentTest.subs[description] = newTestData;
    currentPath.push(newTestData);
    try {
        await testFunction();
    }
    finally {
        currentPath.pop();
    }
}
/**
 * Runs expect.
 * @param {ReturnType<typeof JSON.parse>} arg - Arg.
 * @returns {Expect} - The expect.
 */
function expect(arg) {
    return new Expect(arg);
}
expect.objectContaining = objectContaining;
expect.arrayContaining = arrayContaining;
/**
 * Runs it.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {void} - No return value.
 */
function it(description, arg1, arg2) {
    const currentTest = currentPath[currentPath.length - 1];
    /**
     * Defines testArgs.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    let testArgs;
    /**
     * Defines testFunction.
     * @type {() => (void|Promise<void>)} */
    let testFunction;
    if (typeof arg1 == "function") {
        testFunction = /** @type {() => (void|Promise<void>)} */ (arg1);
        testArgs = {};
    }
    else if (typeof arg2 == "function") {
        testFunction = /** @type {() => (void|Promise<void>)} */ (arg2);
        testArgs = arg1;
    }
    else {
        throw new Error(`Invalid arguments for it: ${description}, ${arg1}`);
    }
    const newTestArgs = mergeTestArgs(currentTest.args, testArgs);
    const location = captureLocation();
    currentTest.tests[description] = {
        args: newTestArgs,
        function: testFunction,
        filePath: location.filePath,
        line: location.line
    };
}
/**
 * Runs fit.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {void} - No return value.
 */
function fit(description, arg1, arg2) {
    /**
     * Defines testArgs.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    let testArgs;
    /**
     * Defines testFunction.
     * @type {() => (void|Promise<void>)} */
    let testFunction;
    if (typeof arg1 == "function") {
        testFunction = /** @type {() => (void|Promise<void>)} */ (arg1);
        testArgs = { focus: true };
    }
    else if (typeof arg2 == "function") {
        testFunction = /** @type {() => (void|Promise<void>)} */ (arg2);
        testArgs = Object.assign({ focus: true }, arg1);
    }
    else {
        throw new Error(`Invalid arguments for it: ${description}, ${arg1}`);
    }
    return it(description, testArgs, testFunction);
}
// Make the methods global so they can be used in test files
Object.assign(globalThis, {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    configureTests,
    describe,
    expect,
    fit,
    it,
    testEvents
});
export { afterAll, afterEach, beforeAll, beforeEach, configureTests, describe, expect, fit, it, arrayContaining, objectContaining, testConfig, testEvents, tests, waitForEvent };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3Rlc3QuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sSUFBSSxNQUFNLE1BQU0sQ0FBQTtBQUN2QixPQUFPLEVBQUMsYUFBYSxFQUFDLE1BQU0sS0FBSyxDQUFBO0FBQ2pDLE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxvQkFBb0IsQ0FBQTtBQUNqRCxPQUFPLFlBQVksTUFBTSwyQkFBMkIsQ0FBQTtBQUNwRCxPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFDaEMsT0FBTyxFQUFDLGVBQWUsRUFBRSxnQkFBZ0IsRUFBQyxNQUFNLG1CQUFtQixDQUFBO0FBRW5FOzs7Ozs7O0dBT0c7QUFDSDs7c0RBRXNEO0FBQ3RELE1BQU0sS0FBSyxHQUFHO0lBQ1o7O2dGQUU0RTtJQUM1RSxXQUFXLEVBQUUsRUFBRTtJQUNmOzsrRUFFMkU7SUFDM0UsU0FBUyxFQUFFLEVBQUU7SUFDYixJQUFJLEVBQUUsRUFBQyxnQkFBZ0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsRUFBQztJQUU3Qzs7K0VBRTJFO0lBQzNFLFVBQVUsRUFBRSxFQUFFO0lBQ2Q7O2dGQUU0RTtJQUM1RSxZQUFZLEVBQUUsRUFBRTtJQUNoQixRQUFRLEVBQUUsU0FBUztJQUNuQixJQUFJLEVBQUUsU0FBUztJQUNmLElBQUksRUFBRSxFQUFFO0lBQ1IsS0FBSyxFQUFFLEVBQUU7Q0FDVixDQUFBO0FBRUQsTUFBTSxVQUFVLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtBQUVyQyxJQUFJLFdBQVcsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBRXpCOzs7R0FHRztBQUNILFNBQVMsZUFBZTtJQUN0QixNQUFNLEtBQUssR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFBO0lBQ3pCLE1BQU0sS0FBSyxHQUFHLE9BQU8sS0FBSyxDQUFDLEtBQUssS0FBSyxRQUFRLENB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QUFLLEVBQUUsWUFBWSxFQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHtmaWxlVVJMVG9QYXRofSBmcm9tIFwidXJsXCJcbmltcG9ydCB7IHdhaXRGb3JFdmVudCB9IGZyb20gXCJAdmVsb2Npb3VzL3Rlc3RpbmdcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQgRXhwZWN0IGZyb20gXCIuL2V4cGVjdC5qc1wiXG5pbXBvcnQge2FycmF5Q29udGFpbmluZywgb2JqZWN0Q29udGFpbmluZ30gZnJvbSBcIi4vZXhwZWN0LXV0aWxzLmpzXCJcblxuLyoqXG4gKiBWZWxvY2lvdXNUZXN0Q29uZmlnIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBWZWxvY2lvdXNUZXN0Q29uZmlnXG4gKiBAcHJvcGVydHkge1wiZmFpbHVyZVwiIHwgXCJsaXZlXCJ9IGNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dCBtb2RlLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gZXhjbHVkZVRhZ3MgLSBUYWdzIGV4Y2x1ZGVkIGJ5IGRlZmF1bHQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gZGVmYXVsdFRpbWVvdXRTZWNvbmRzIC0gRGVmYXVsdCB0aW1lb3V0IGluIHNlY29uZHMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzIC0gTWF4aW11bSBmYWlsZWQgY29uc29sZSBsaW5lcyB0byBwcmludCBpbmxpbmUuXG4gKi9cbi8qKlxuICogVGVzdHMuXG4gKiBAdHlwZSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UZXN0c0FyZ3VtZW50fSAqL1xuY29uc3QgdGVzdHMgPSB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVtdfSAqL1xuICBhZnRlckVhY2hlczogW10sXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlW119ICovXG4gIGFmdGVyQWxsczogW10sXG4gIGFyZ3M6IHtkYXRhYmFzZUNsZWFuaW5nOiB7dHJhbnNhY3Rpb246IHRydWV9fSxcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5CZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSAqL1xuICBiZWZvcmVBbGxzOiBbXSxcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119ICovXG4gIGJlZm9yZUVhY2hlczogW10sXG4gIGZpbGVQYXRoOiB1bmRlZmluZWQsXG4gIGxpbmU6IHVuZGVmaW5lZCxcbiAgc3Viczoge30sXG4gIHRlc3RzOiB7fVxufVxuXG5jb25zdCB0ZXN0RXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG5cbmxldCBjdXJyZW50UGF0aCA9IFt0ZXN0c11cblxuLyoqXG4gKiBSdW5zIGNhcHR1cmUgbG9jYXRpb24uXG4gKiBAcmV0dXJucyB7e2ZpbGVQYXRoPzogc3RyaW5nLCBsaW5lPzogbnVtYmVyfX0gLSBMb2NhdGlvbi5cbiAqL1xuZnVuY3Rpb24gY2FwdHVyZUxvY2F0aW9uKCkge1xuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcigpXG4gIGNvbnN0IHN0YWNrID0gdHlwZW9mIGVycm9yLnN0YWNrID09PSBcInN0cmluZ1wiID8gZXJyb3Iuc3RhY2suc3BsaXQoXCJcXG5cIikgOiBbXVxuXG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGFjaykge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKVxuXG4gICAgaWYgKCF0cmltbWVkLmluY2x1ZGVzKFwiYXRcIikpIGNvbnRpbnVlXG4gICAgaWYgKHRyaW1tZWQuaW5jbHVkZXMoXCIvc3JjL3Rlc3RpbmcvdGVzdC5qc1wiKSkgY29udGludWVcblxuICAgIGNvbnN0IG1hdGNoID0gdHJpbW1lZC5tYXRjaCgvKD86XFwofFxccykoZmlsZTpcXC9cXC8uKj98XFwvLio/KTooXFxkKyk6KFxcZCspXFwpPyQvKVxuXG4gICAgaWYgKCFtYXRjaCkgY29udGludWVcblxuICAgIGNvbnN0IHJhd1BhdGggPSBtYXRjaFsxXVxuICAgIGNvbnN0IGxpbmVOdW1iZXIgPSBOdW1iZXIobWF0Y2hbMl0pXG4gICAgY29uc3QgZmlsZVBhdGggPSByYXdQYXRoLnN0YXJ0c1dpdGgoXCJmaWxlOi8vXCIpXG4gICAgICA/IGZpbGVVUkxUb1BhdGgocmF3UGF0aClcbiAgICAgIDogcmF3UGF0aFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZpbGVQYXRoOiBwYXRoLnJlc29sdmUoZmlsZVBhdGgpLFxuICAgICAgbGluZTogTnVtYmVyLmlzRmluaXRlKGxpbmVOdW1iZXIpID8gbGluZU51bWJlciA6IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7fVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHRhZ3MuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nIHwgdW5kZWZpbmVkfSB0YWdzIC0gVGFncy5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBOb3JtYWxpemVkIHRhZ3MuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRhZ3ModGFncykge1xuICBpZiAoIXRhZ3MpIHJldHVybiBbXVxuXG4gIGNvbnN0IHZhbHVlcyA9IFtdXG4gIGNvbnN0IHJhd1RhZ3MgPSBBcnJheS5pc0FycmF5KHRhZ3MpID8gdGFncyA6IFt0YWdzXVxuXG4gIGZvciAoY29uc3QgcmF3VGFnIG9mIHJhd1RhZ3MpIHtcbiAgICBpZiAocmF3VGFnID09PSB1bmRlZmluZWQgfHwgcmF3VGFnID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgY29uc3QgcGFydHMgPSBTdHJpbmcocmF3VGFnKS5zcGxpdChcIixcIilcblxuICAgIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgICAgY29uc3QgdHJpbW1lZCA9IHBhcnQudHJpbSgpXG5cbiAgICAgIGlmICh0cmltbWVkKSB2YWx1ZXMucHVzaCh0cmltbWVkKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBBcnJheS5mcm9tKG5ldyBTZXQodmFsdWVzKSlcbn1cblxuLyoqXG4gKiBUZXN0IGNvbmZpZy5cbiAqIEB0eXBlIHtWZWxvY2lvdXNUZXN0Q29uZmlnfSAqL1xuY29uc3QgdGVzdENvbmZpZyA9IHtcbiAgY29uc29sZU91dHB1dDogXCJmYWlsdXJlXCIsXG4gIGZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lczogMjAwLFxuICBleGNsdWRlVGFnczogW10sXG4gIGRlZmF1bHRUaW1lb3V0U2Vjb25kczogNjBcbn1cblxuLyoqXG4gKiBSdW5zIGNvbmZpZ3VyZSB0ZXN0cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7XCJmYWlsdXJlXCIgfCBcImxpdmVcIn0gW2FyZ3MuY29uc29sZU91dHB1dF0gLSBDb25zb2xlIG91dHB1dCBtb2RlLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuZXhjbHVkZVRhZ3NdIC0gVGFncyB0byBleGNsdWRlLlxuICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlZmF1bHRUaW1lb3V0U2Vjb25kc10gLSBEZWZhdWx0IHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5mYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXNdIC0gTWF4aW11bSBmYWlsZWQgY29uc29sZSBsaW5lcyB0byBwcmludCBpbmxpbmUuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gY29uZmlndXJlVGVzdHMoe2NvbnNvbGVPdXRwdXQsIGV4Y2x1ZGVUYWdzLCBkZWZhdWx0VGltZW91dFNlY29uZHMsIGZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lc30gPSB7fSkge1xuICBpZiAoZXhjbHVkZVRhZ3MgIT09IHVuZGVmaW5lZCkge1xuICAgIHRlc3RDb25maWcuZXhjbHVkZVRhZ3MgPSBub3JtYWxpemVUYWdzKGV4Y2x1ZGVUYWdzKVxuICB9XG5cbiAgaWYgKGNvbnNvbGVPdXRwdXQgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChjb25zb2xlT3V0cHV0ICE9PSBcImZhaWx1cmVcIiAmJiBjb25zb2xlT3V0cHV0ICE9PSBcImxpdmVcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNvbnNvbGVPdXRwdXQgY29uZmlnOiAke2NvbnNvbGVPdXRwdXR9YClcbiAgICB9XG5cbiAgICB0ZXN0Q29uZmlnLmNvbnNvbGVPdXRwdXQgPSBjb25zb2xlT3V0cHV0XG4gIH1cblxuICBpZiAodHlwZW9mIGRlZmF1bHRUaW1lb3V0U2Vjb25kcyA9PT0gXCJudW1iZXJcIikge1xuICAgIHRlc3RDb25maWcuZGVmYXVsdFRpbWVvdXRTZWNvbmRzID0gZGVmYXVsdFRpbWVvdXRTZWNvbmRzXG4gIH1cblxuICBpZiAodHlwZW9mIGZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcyA9PT0gXCJudW1iZXJcIikge1xuICAgIHRlc3RDb25maWcuZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzID0gZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIHRlc3QgYXJncy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBiYXNlQXJncyAtIEJhc2UgYXJncy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBleHRyYUFyZ3MgLSBFeHRyYSBhcmdzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBNZXJnZWQgYXJncy5cbiAqL1xuZnVuY3Rpb24gbWVyZ2VUZXN0QXJncyhiYXNlQXJncywgZXh0cmFBcmdzKSB7XG4gIGNvbnN0IG1lcmdlZCA9IE9iamVjdC5hc3NpZ24oe30sIGJhc2VBcmdzLCBleHRyYUFyZ3MpXG4gIGNvbnN0IG1lcmdlZFRhZ3MgPSBbLi4ubm9ybWFsaXplVGFncyhiYXNlQXJncz8udGFncyksIC4uLm5vcm1hbGl6ZVRhZ3MoZXh0cmFBcmdzPy50YWdzKV1cblxuICBpZiAobWVyZ2VkVGFncy5sZW5ndGggPiAwKSB7XG4gICAgbWVyZ2VkLnRhZ3MgPSBBcnJheS5mcm9tKG5ldyBTZXQobWVyZ2VkVGFncykpXG4gIH0gZWxzZSBpZiAoXCJ0YWdzXCIgaW4gbWVyZ2VkKSB7XG4gICAgZGVsZXRlIG1lcmdlZC50YWdzXG4gIH1cblxuICByZXR1cm4gbWVyZ2VkXG59XG5cbi8qKlxuICogUnVucyBiZWZvcmUgZWFjaC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5BZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGJlZm9yZUVhY2goY2FsbGJhY2spIHtcbiAgY29uc3QgY3VycmVudFRlc3QgPSBjdXJyZW50UGF0aFtjdXJyZW50UGF0aC5sZW5ndGggLSAxXVxuXG4gIGN1cnJlbnRUZXN0LmJlZm9yZUVhY2hlcy5wdXNoKHtjYWxsYmFja30pXG59XG5cbi8qKlxuICogUnVucyBiZWZvcmUgYWxsLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5mdW5jdGlvbiBiZWZvcmVBbGwoY2FsbGJhY2spIHtcbiAgY29uc3QgY3VycmVudFRlc3QgPSBjdXJyZW50UGF0aFtjdXJyZW50UGF0aC5sZW5ndGggLSAxXVxuXG4gIGN1cnJlbnRUZXN0LmJlZm9yZUFsbHMucHVzaCh7Y2FsbGJhY2t9KVxufVxuXG4vKipcbiAqIFJ1bnMgYWZ0ZXIgZWFjaC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5BZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGFmdGVyRWFjaChjYWxsYmFjaykge1xuICBjb25zdCBjdXJyZW50VGVzdCA9IGN1cnJlbnRQYXRoW2N1cnJlbnRQYXRoLmxlbmd0aCAtIDFdXG5cbiAgY3VycmVudFRlc3QuYWZ0ZXJFYWNoZXMucHVzaCh7Y2FsbGJhY2t9KVxufVxuXG4vKipcbiAqIFJ1bnMgYWZ0ZXIgYWxsLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5mdW5jdGlvbiBhZnRlckFsbChjYWxsYmFjaykge1xuICBjb25zdCBjdXJyZW50VGVzdCA9IGN1cnJlbnRQYXRoW2N1cnJlbnRQYXRoLmxlbmd0aCAtIDFdXG5cbiAgY3VycmVudFRlc3QuYWZ0ZXJBbGxzLnB1c2goe2NhbGxiYWNrfSlcbn1cblxuLyoqXG4gKiBSdW5zIGRlc2NyaWJlLlxuICogQHBhcmFtIHtzdHJpbmd9IGRlc2NyaXB0aW9uIC0gRGVzY3JpcHRpb24uXG4gKiBAcGFyYW0ge29iamVjdHwoKCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPikpfSBhcmcxIC0gQXJnMS5cbiAqIEBwYXJhbSB7dW5kZWZpbmVkfCgoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KSl9IFthcmcyXSAtIEFyZzIuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICovXG5hc3luYyBmdW5jdGlvbiBkZXNjcmliZShkZXNjcmlwdGlvbiwgYXJnMSwgYXJnMikge1xuICAvKipcbiAgICogRGVmaW5lcyB0ZXN0QXJncy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgbGV0IHRlc3RBcmdzLCB0ZXN0RnVuY3Rpb25cblxuICBpZiAodHlwZW9mIGFyZzIgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGVzdEZ1bmN0aW9uID0gYXJnMlxuICAgIHRlc3RBcmdzID0gYXJnMVxuICB9IGVsc2UgaWYgKHR5cGVvZiBhcmcxID09IFwiZnVuY3Rpb25cIikge1xuICAgIHRlc3RGdW5jdGlvbiA9IGFyZzFcbiAgICB0ZXN0QXJncyA9IHt9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGFyZ3VtZW50cyBmb3IgZGVzY3JpYmU6ICR7YXJnMX0sICR7YXJnMn1gKVxuICB9XG5cbiAgY29uc3QgY3VycmVudFRlc3QgPSBjdXJyZW50UGF0aFtjdXJyZW50UGF0aC5sZW5ndGggLSAxXVxuICBjb25zdCBuZXdUZXN0QXJncyA9IG1lcmdlVGVzdEFyZ3MoY3VycmVudFRlc3QuYXJncywgdGVzdEFyZ3MpXG5cbiAgaWYgKGRlc2NyaXB0aW9uIGluIGN1cnJlbnRUZXN0LnN1YnMpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYER1cGxpY2F0ZSB0ZXN0IGRlc2NyaXB0aW9uOiAke2Rlc2NyaXB0aW9ufWApXG4gIH1cblxuICBjb25zdCBsb2NhdGlvbiA9IGNhcHR1cmVMb2NhdGlvbigpXG4gIGNvbnN0IG5ld1Rlc3REYXRhID0ge1xuICAgIGFmdGVyRWFjaGVzOiBbXSxcbiAgICBhZnRlckFsbHM6IFtdLFxuICAgIGFyZ3M6IG5ld1Rlc3RBcmdzLFxuICAgIGJlZm9yZUFsbHM6IFtdLFxuICAgIGJlZm9yZUVhY2hlczogW10sXG4gICAgZmlsZVBhdGg6IGxvY2F0aW9uLmZpbGVQYXRoLFxuICAgIGxpbmU6IGxvY2F0aW9uLmxpbmUsXG4gICAgc3Viczoge30sXG4gICAgdGVzdHM6IHt9XG4gIH1cblxuICBjdXJyZW50VGVzdC5zdWJzW2Rlc2NyaXB0aW9uXSA9IG5ld1Rlc3REYXRhXG4gIGN1cnJlbnRQYXRoLnB1c2gobmV3VGVzdERhdGEpXG5cbiAgdHJ5IHtcbiAgICBhd2FpdCB0ZXN0RnVuY3Rpb24oKVxuICB9IGZpbmFsbHkge1xuICAgIGN1cnJlbnRQYXRoLnBvcCgpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGV4cGVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZyAtIEFyZy5cbiAqIEByZXR1cm5zIHtFeHBlY3R9IC0gVGhlIGV4cGVjdC5cbiAqL1xuZnVuY3Rpb24gZXhwZWN0KGFyZykge1xuICByZXR1cm4gbmV3IEV4cGVjdChhcmcpXG59XG5cbmV4cGVjdC5vYmplY3RDb250YWluaW5nID0gb2JqZWN0Q29udGFpbmluZ1xuZXhwZWN0LmFycmF5Q29udGFpbmluZyA9IGFycmF5Q29udGFpbmluZ1xuXG4vKipcbiAqIFJ1bnMgaXQuXG4gKiBAcGFyYW0ge3N0cmluZ30gZGVzY3JpcHRpb24gLSBEZXNjcmlwdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fCgoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KSl9IGFyZzEgLSBBcmcxLlxuICogQHBhcmFtIHt1bmRlZmluZWR8KCgpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pKX0gW2FyZzJdIC0gQXJnMi5cbiAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gaXQoZGVzY3JpcHRpb24sIGFyZzEsIGFyZzIpIHtcbiAgY29uc3QgY3VycmVudFRlc3QgPSBjdXJyZW50UGF0aFtjdXJyZW50UGF0aC5sZW5ndGggLSAxXVxuICAvKipcbiAgICogRGVmaW5lcyB0ZXN0QXJncy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgbGV0IHRlc3RBcmdzXG5cbiAgLyoqXG4gICAqIERlZmluZXMgdGVzdEZ1bmN0aW9uLlxuICAgKiBAdHlwZSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9ICovXG4gIGxldCB0ZXN0RnVuY3Rpb25cblxuICBpZiAodHlwZW9mIGFyZzEgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGVzdEZ1bmN0aW9uID0gLyoqIEB0eXBlIHsoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gKi8gKGFyZzEpXG4gICAgdGVzdEFyZ3MgPSB7fVxuICB9IGVsc2UgaWYgKHR5cGVvZiBhcmcyID09IFwiZnVuY3Rpb25cIikge1xuICAgIHRlc3RGdW5jdGlvbiA9IC8qKiBAdHlwZSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9ICovIChhcmcyKVxuICAgIHRlc3RBcmdzID0gYXJnMVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBhcmd1bWVudHMgZm9yIGl0OiAke2Rlc2NyaXB0aW9ufSwgJHthcmcxfWApXG4gIH1cblxuICBjb25zdCBuZXdUZXN0QXJncyA9IG1lcmdlVGVzdEFyZ3MoY3VycmVudFRlc3QuYXJncywgdGVzdEFyZ3MpXG5cbiAgY29uc3QgbG9jYXRpb24gPSBjYXB0dXJlTG9jYXRpb24oKVxuXG4gIGN1cnJlbnRUZXN0LnRlc3RzW2Rlc2NyaXB0aW9uXSA9IHtcbiAgICBhcmdzOiBuZXdUZXN0QXJncyxcbiAgICBmdW5jdGlvbjogdGVzdEZ1bmN0aW9uLFxuICAgIGZpbGVQYXRoOiBsb2NhdGlvbi5maWxlUGF0aCxcbiAgICBsaW5lOiBsb2NhdGlvbi5saW5lXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZpdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkZXNjcmlwdGlvbiAtIERlc2NyaXB0aW9uLlxuICogQHBhcmFtIHtvYmplY3R8KCgpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pKX0gYXJnMSAtIEFyZzEuXG4gKiBAcGFyYW0ge3VuZGVmaW5lZHwoKCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPikpfSBbYXJnMl0gLSBBcmcyLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5mdW5jdGlvbiBmaXQoZGVzY3JpcHRpb24sIGFyZzEsIGFyZzIpIHtcbiAgLyoqXG4gICAqIERlZmluZXMgdGVzdEFyZ3MuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGxldCB0ZXN0QXJnc1xuXG4gIC8qKlxuICAgKiBEZWZpbmVzIHRlc3RGdW5jdGlvbi5cbiAgICogQHR5cGUgeygpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSAqL1xuICBsZXQgdGVzdEZ1bmN0aW9uXG5cbiAgaWYgKHR5cGVvZiBhcmcxID09IFwiZnVuY3Rpb25cIikge1xuICAgIHRlc3RGdW5jdGlvbiA9IC8qKiBAdHlwZSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9ICovIChhcmcxKVxuICAgIHRlc3RBcmdzID0ge2ZvY3VzOiB0cnVlfVxuICB9IGVsc2UgaWYgKHR5cGVvZiBhcmcyID09IFwiZnVuY3Rpb25cIikge1xuICAgIHRlc3RGdW5jdGlvbiA9IC8qKiBAdHlwZSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9ICovIChhcmcyKVxuICAgIHRlc3RBcmdzID0gT2JqZWN0LmFzc2lnbih7Zm9jdXM6IHRydWV9LCBhcmcxKVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBhcmd1bWVudHMgZm9yIGl0OiAke2Rlc2NyaXB0aW9ufSwgJHthcmcxfWApXG4gIH1cblxuICByZXR1cm4gaXQoZGVzY3JpcHRpb24sIHRlc3RBcmdzLCB0ZXN0RnVuY3Rpb24pXG59XG5cbi8vIE1ha2UgdGhlIG1ldGhvZHMgZ2xvYmFsIHNvIHRoZXkgY2FuIGJlIHVzZWQgaW4gdGVzdCBmaWxlc1xuT2JqZWN0LmFzc2lnbihnbG9iYWxUaGlzLCB7XG4gIGFmdGVyQWxsLFxuICBhZnRlckVhY2gsXG4gIGJlZm9yZUFsbCxcbiAgYmVmb3JlRWFjaCxcbiAgY29uZmlndXJlVGVzdHMsXG4gIGRlc2NyaWJlLFxuICBleHBlY3QsXG4gIGZpdCxcbiAgaXQsXG4gIHRlc3RFdmVudHNcbn0pXG5cbmV4cG9ydCB7YWZ0ZXJBbGwsIGFmdGVyRWFjaCwgYmVmb3JlQWxsLCBiZWZvcmVFYWNoLCBjb25maWd1cmVUZXN0cywgZGVzY3JpYmUsIGV4cGVjdCwgZml0LCBpdCwgYXJyYXlDb250YWluaW5nLCBvYmplY3RDb250YWluaW5nLCB0ZXN0Q29uZmlnLCB0ZXN0RXZlbnRzLCB0ZXN0cywgd2FpdEZvckV2ZW50fVxuIl19