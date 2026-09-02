// @ts-check
import path from "path";
import { fileURLToPath } from "url";
import { defaultTestContext, waitForEvent } from "@velocious/testing";
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
        if (trimmed.includes("/@velocious/testing/"))
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
defaultTestContext.setDeclarationLocator(captureLocation);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3Rlc3QuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sSUFBSSxNQUFNLE1BQU0sQ0FBQTtBQUN2QixPQUFPLEVBQUMsYUFBYSxFQUFDLE1BQU0sS0FBSyxDQUFBO0FBQ2pDLE9BQU8sRUFBQyxrQkFBa0IsRUFBRSxZQUFZLEVBQUMsTUFBTSxvQkFBb0IsQ0FBQTtBQUNuRSxPQUFPLFlBQVksTUFBTSwyQkFBMkIsQ0FBQTtBQUNwRCxPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFDaEMsT0FBTyxFQUFDLGVBQWUsRUFBRSxnQkFBZ0IsRUFBQyxNQUFNLG1CQUFtQixDQUFBO0FBRW5FOzs7Ozs7O0dBT0c7QUFDSDs7c0RBRXNEO0FBQ3RELE1BQU0sS0FBSyxHQUFHO0lBQ1o7O2dGQUU0RTtJQUM1RSxXQUFXLEVBQUUsRUFBRTtJQUNmOzsrRUFFMkU7SUFDM0UsU0FBUyxFQUFFLEVBQUU7SUFDYixJQUFJLEVBQUUsRUFBQyxnQkFBZ0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsRUFBQztJQUU3Qzs7K0VBRTJFO0lBQzNFLFVBQVUsRUFBRSxFQUFFO0lBQ2Q7O2dGQUU0RTtJQUM1RSxZQUFZLEVBQUUsRUFBRTtJQUNoQixRQUFRLEVBQUUsU0FBUztJQUNuQixJQUFJLEVBQUUsU0FBUztJQUNmLElBQUksRUFBRSxFQUFFO0lBQ1IsS0FBSyxFQUFFLEVBQUU7Q0FDVixDQUFBO0FBRUQsTUFBTSxVQUFVLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtBQUVyQyxJQUFJLFdBQVcsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBRXpCOzs7R0FHRztBQUNILFNBQVMsZUFBZTtJQUN0QixNQUFNLEtBQUssR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFBO0lBQ3pCLE1BQU0sS0FBSyxHQUFHLE9BQU8sS0FBSyxDQUFDLEtBQUss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UyxFQUFFLFVBQVUsRUFBRSxjQUFjLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFFLGVBQWUsRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQge2ZpbGVVUkxUb1BhdGh9IGZyb20gXCJ1cmxcIlxuaW1wb3J0IHtkZWZhdWx0VGVzdENvbnRleHQsIHdhaXRGb3JFdmVudH0gZnJvbSBcIkB2ZWxvY2lvdXMvdGVzdGluZ1wiXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCBFeHBlY3QgZnJvbSBcIi4vZXhwZWN0LmpzXCJcbmltcG9ydCB7YXJyYXlDb250YWluaW5nLCBvYmplY3RDb250YWluaW5nfSBmcm9tIFwiLi9leHBlY3QtdXRpbHMuanNcIlxuXG4vKipcbiAqIFZlbG9jaW91c1Rlc3RDb25maWcgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFZlbG9jaW91c1Rlc3RDb25maWdcbiAqIEBwcm9wZXJ0eSB7XCJmYWlsdXJlXCIgfCBcImxpdmVcIn0gY29uc29sZU91dHB1dCAtIENvbnNvbGUgb3V0cHV0IG1vZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBleGNsdWRlVGFncyAtIFRhZ3MgZXhjbHVkZWQgYnkgZGVmYXVsdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBkZWZhdWx0VGltZW91dFNlY29uZHMgLSBEZWZhdWx0IHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBmYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMgLSBNYXhpbXVtIGZhaWxlZCBjb25zb2xlIGxpbmVzIHRvIHByaW50IGlubGluZS5cbiAqL1xuLyoqXG4gKiBUZXN0cy5cbiAqIEB0eXBlIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3RzQXJndW1lbnR9ICovXG5jb25zdCB0ZXN0cyA9IHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119ICovXG4gIGFmdGVyRWFjaGVzOiBbXSxcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVbXX0gKi9cbiAgYWZ0ZXJBbGxzOiBbXSxcbiAgYXJnczoge2RhdGFiYXNlQ2xlYW5pbmc6IHt0cmFuc2FjdGlvbjogdHJ1ZX19LFxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlW119ICovXG4gIGJlZm9yZUFsbHM6IFtdLFxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5BZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gKi9cbiAgYmVmb3JlRWFjaGVzOiBbXSxcbiAgZmlsZVBhdGg6IHVuZGVmaW5lZCxcbiAgbGluZTogdW5kZWZpbmVkLFxuICBzdWJzOiB7fSxcbiAgdGVzdHM6IHt9XG59XG5cbmNvbnN0IHRlc3RFdmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcblxubGV0IGN1cnJlbnRQYXRoID0gW3Rlc3RzXVxuXG4vKipcbiAqIFJ1bnMgY2FwdHVyZSBsb2NhdGlvbi5cbiAqIEByZXR1cm5zIHt7ZmlsZVBhdGg/OiBzdHJpbmcsIGxpbmU/OiBudW1iZXJ9fSAtIExvY2F0aW9uLlxuICovXG5mdW5jdGlvbiBjYXB0dXJlTG9jYXRpb24oKSB7XG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKClcbiAgY29uc3Qgc3RhY2sgPSB0eXBlb2YgZXJyb3Iuc3RhY2sgPT09IFwic3RyaW5nXCIgPyBlcnJvci5zdGFjay5zcGxpdChcIlxcblwiKSA6IFtdXG5cbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0YWNrKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpXG5cbiAgICBpZiAoIXRyaW1tZWQuaW5jbHVkZXMoXCJhdFwiKSkgY29udGludWVcbiAgICBpZiAodHJpbW1lZC5pbmNsdWRlcyhcIi9zcmMvdGVzdGluZy90ZXN0LmpzXCIpKSBjb250aW51ZVxuICAgIGlmICh0cmltbWVkLmluY2x1ZGVzKFwiL0B2ZWxvY2lvdXMvdGVzdGluZy9cIikpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBtYXRjaCA9IHRyaW1tZWQubWF0Y2goLyg/OlxcKHxcXHMpKGZpbGU6XFwvXFwvLio/fFxcLy4qPyk6KFxcZCspOihcXGQrKVxcKT8kLylcblxuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICBjb25zdCByYXdQYXRoID0gbWF0Y2hbMV1cbiAgICBjb25zdCBsaW5lTnVtYmVyID0gTnVtYmVyKG1hdGNoWzJdKVxuICAgIGNvbnN0IGZpbGVQYXRoID0gcmF3UGF0aC5zdGFydHNXaXRoKFwiZmlsZTovL1wiKVxuICAgICAgPyBmaWxlVVJMVG9QYXRoKHJhd1BhdGgpXG4gICAgICA6IHJhd1BhdGhcblxuICAgIHJldHVybiB7XG4gICAgICBmaWxlUGF0aDogcGF0aC5yZXNvbHZlKGZpbGVQYXRoKSxcbiAgICAgIGxpbmU6IE51bWJlci5pc0Zpbml0ZShsaW5lTnVtYmVyKSA/IGxpbmVOdW1iZXIgOiB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge31cbn1cblxuZGVmYXVsdFRlc3RDb250ZXh0LnNldERlY2xhcmF0aW9uTG9jYXRvcihjYXB0dXJlTG9jYXRpb24pXG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgdGFncy5cbiAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmcgfCB1bmRlZmluZWR9IHRhZ3MgLSBUYWdzLlxuICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vcm1hbGl6ZWQgdGFncy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplVGFncyh0YWdzKSB7XG4gIGlmICghdGFncykgcmV0dXJuIFtdXG5cbiAgY29uc3QgdmFsdWVzID0gW11cbiAgY29uc3QgcmF3VGFncyA9IEFycmF5LmlzQXJyYXkodGFncykgPyB0YWdzIDogW3RhZ3NdXG5cbiAgZm9yIChjb25zdCByYXdUYWcgb2YgcmF3VGFncykge1xuICAgIGlmIChyYXdUYWcgPT09IHVuZGVmaW5lZCB8fCByYXdUYWcgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyhyYXdUYWcpLnNwbGl0KFwiLFwiKVxuXG4gICAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgICBjb25zdCB0cmltbWVkID0gcGFydC50cmltKClcblxuICAgICAgaWYgKHRyaW1tZWQpIHZhbHVlcy5wdXNoKHRyaW1tZWQpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldCh2YWx1ZXMpKVxufVxuXG4vKipcbiAqIFRlc3QgY29uZmlnLlxuICogQHR5cGUge1ZlbG9jaW91c1Rlc3RDb25maWd9ICovXG5jb25zdCB0ZXN0Q29uZmlnID0ge1xuICBjb25zb2xlT3V0cHV0OiBcImZhaWx1cmVcIixcbiAgZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzOiAyMDAsXG4gIGV4Y2x1ZGVUYWdzOiBbXSxcbiAgZGVmYXVsdFRpbWVvdXRTZWNvbmRzOiA2MFxufVxuXG4vKipcbiAqIFJ1bnMgY29uZmlndXJlIHRlc3RzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtcImZhaWx1cmVcIiB8IFwibGl2ZVwifSBbYXJncy5jb25zb2xlT3V0cHV0XSAtIENvbnNvbGUgb3V0cHV0IG1vZGUuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nfSBbYXJncy5leGNsdWRlVGFnc10gLSBUYWdzIHRvIGV4Y2x1ZGUuXG4gKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVmYXVsdFRpbWVvdXRTZWNvbmRzXSAtIERlZmF1bHQgdGltZW91dCBpbiBzZWNvbmRzLlxuICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lc10gLSBNYXhpbXVtIGZhaWxlZCBjb25zb2xlIGxpbmVzIHRvIHByaW50IGlubGluZS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBjb25maWd1cmVUZXN0cyh7Y29uc29sZU91dHB1dCwgZXhjbHVkZVRhZ3MsIGRlZmF1bHRUaW1lb3V0U2Vjb25kcywgZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzfSA9IHt9KSB7XG4gIGlmIChleGNsdWRlVGFncyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgdGVzdENvbmZpZy5leGNsdWRlVGFncyA9IG5vcm1hbGl6ZVRhZ3MoZXhjbHVkZVRhZ3MpXG4gIH1cblxuICBpZiAoY29uc29sZU91dHB1dCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGNvbnNvbGVPdXRwdXQgIT09IFwiZmFpbHVyZVwiICYmIGNvbnNvbGVPdXRwdXQgIT09IFwibGl2ZVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29uc29sZU91dHB1dCBjb25maWc6ICR7Y29uc29sZU91dHB1dH1gKVxuICAgIH1cblxuICAgIHRlc3RDb25maWcuY29uc29sZU91dHB1dCA9IGNvbnNvbGVPdXRwdXRcbiAgfVxuXG4gIGlmICh0eXBlb2YgZGVmYXVsdFRpbWVvdXRTZWNvbmRzID09PSBcIm51bWJlclwiKSB7XG4gICAgdGVzdENvbmZpZy5kZWZhdWx0VGltZW91dFNlY29uZHMgPSBkZWZhdWx0VGltZW91dFNlY29uZHNcbiAgfVxuXG4gIGlmICh0eXBlb2YgZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzID09PSBcIm51bWJlclwiKSB7XG4gICAgdGVzdENvbmZpZy5mYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMgPSBmYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXNcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgdGVzdCBhcmdzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJhc2VBcmdzIC0gQmFzZSBhcmdzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGV4dHJhQXJncyAtIEV4dHJhIGFyZ3MuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIE1lcmdlZCBhcmdzLlxuICovXG5mdW5jdGlvbiBtZXJnZVRlc3RBcmdzKGJhc2VBcmdzLCBleHRyYUFyZ3MpIHtcbiAgY29uc3QgbWVyZ2VkID0gT2JqZWN0LmFzc2lnbih7fSwgYmFzZUFyZ3MsIGV4dHJhQXJncylcbiAgY29uc3QgbWVyZ2VkVGFncyA9IFsuLi5ub3JtYWxpemVUYWdzKGJhc2VBcmdzPy50YWdzKSwgLi4ubm9ybWFsaXplVGFncyhleHRyYUFyZ3M/LnRhZ3MpXVxuXG4gIGlmIChtZXJnZWRUYWdzLmxlbmd0aCA+IDApIHtcbiAgICBtZXJnZWQudGFncyA9IEFycmF5LmZyb20obmV3IFNldChtZXJnZWRUYWdzKSlcbiAgfSBlbHNlIGlmIChcInRhZ3NcIiBpbiBtZXJnZWQpIHtcbiAgICBkZWxldGUgbWVyZ2VkLnRhZ3NcbiAgfVxuXG4gIHJldHVybiBtZXJnZWRcbn1cblxuLyoqXG4gKiBSdW5zIGJlZm9yZSBlYWNoLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkFmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gYmVmb3JlRWFjaChjYWxsYmFjaykge1xuICBjb25zdCBjdXJyZW50VGVzdCA9IGN1cnJlbnRQYXRoW2N1cnJlbnRQYXRoLmxlbmd0aCAtIDFdXG5cbiAgY3VycmVudFRlc3QuYmVmb3JlRWFjaGVzLnB1c2goe2NhbGxiYWNrfSlcbn1cblxuLyoqXG4gKiBSdW5zIGJlZm9yZSBhbGwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGJlZm9yZUFsbChjYWxsYmFjaykge1xuICBjb25zdCBjdXJyZW50VGVzdCA9IGN1cnJlbnRQYXRoW2N1cnJlbnRQYXRoLmxlbmd0aCAtIDFdXG5cbiAgY3VycmVudFRlc3QuYmVmb3JlQWxscy5wdXNoKHtjYWxsYmFja30pXG59XG5cbi8qKlxuICogUnVucyBhZnRlciBlYWNoLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkFmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gYWZ0ZXJFYWNoKGNhbGxiYWNrKSB7XG4gIGNvbnN0IGN1cnJlbnRUZXN0ID0gY3VycmVudFBhdGhbY3VycmVudFBhdGgubGVuZ3RoIC0gMV1cblxuICBjdXJyZW50VGVzdC5hZnRlckVhY2hlcy5wdXNoKHtjYWxsYmFja30pXG59XG5cbi8qKlxuICogUnVucyBhZnRlciBhbGwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGFmdGVyQWxsKGNhbGxiYWNrKSB7XG4gIGNvbnN0IGN1cnJlbnRUZXN0ID0gY3VycmVudFBhdGhbY3VycmVudFBhdGgubGVuZ3RoIC0gMV1cblxuICBjdXJyZW50VGVzdC5hZnRlckFsbHMucHVzaCh7Y2FsbGJhY2t9KVxufVxuXG4vKipcbiAqIFJ1bnMgZGVzY3JpYmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gZGVzY3JpcHRpb24gLSBEZXNjcmlwdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fCgoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KSl9IGFyZzEgLSBBcmcxLlxuICogQHBhcmFtIHt1bmRlZmluZWR8KCgpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pKX0gW2FyZzJdIC0gQXJnMi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGRlc2NyaWJlKGRlc2NyaXB0aW9uLCBhcmcxLCBhcmcyKSB7XG4gIC8qKlxuICAgKiBEZWZpbmVzIHRlc3RBcmdzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgdGVzdEFyZ3MsIHRlc3RGdW5jdGlvblxuXG4gIGlmICh0eXBlb2YgYXJnMiA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0ZXN0RnVuY3Rpb24gPSBhcmcyXG4gICAgdGVzdEFyZ3MgPSBhcmcxXG4gIH0gZWxzZSBpZiAodHlwZW9mIGFyZzEgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGVzdEZ1bmN0aW9uID0gYXJnMVxuICAgIHRlc3RBcmdzID0ge31cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYXJndW1lbnRzIGZvciBkZXNjcmliZTogJHthcmcxfSwgJHthcmcyfWApXG4gIH1cblxuICBjb25zdCBjdXJyZW50VGVzdCA9IGN1cnJlbnRQYXRoW2N1cnJlbnRQYXRoLmxlbmd0aCAtIDFdXG4gIGNvbnN0IG5ld1Rlc3RBcmdzID0gbWVyZ2VUZXN0QXJncyhjdXJyZW50VGVzdC5hcmdzLCB0ZXN0QXJncylcblxuICBpZiAoZGVzY3JpcHRpb24gaW4gY3VycmVudFRlc3Quc3Vicykge1xuICAgIHRocm93IG5ldyBFcnJvcihgRHVwbGljYXRlIHRlc3QgZGVzY3JpcHRpb246ICR7ZGVzY3JpcHRpb259YClcbiAgfVxuXG4gIGNvbnN0IGxvY2F0aW9uID0gY2FwdHVyZUxvY2F0aW9uKClcbiAgY29uc3QgbmV3VGVzdERhdGEgPSB7XG4gICAgYWZ0ZXJFYWNoZXM6IFtdLFxuICAgIGFmdGVyQWxsczogW10sXG4gICAgYXJnczogbmV3VGVzdEFyZ3MsXG4gICAgYmVmb3JlQWxsczogW10sXG4gICAgYmVmb3JlRWFjaGVzOiBbXSxcbiAgICBmaWxlUGF0aDogbG9jYXRpb24uZmlsZVBhdGgsXG4gICAgbGluZTogbG9jYXRpb24ubGluZSxcbiAgICBzdWJzOiB7fSxcbiAgICB0ZXN0czoge31cbiAgfVxuXG4gIGN1cnJlbnRUZXN0LnN1YnNbZGVzY3JpcHRpb25dID0gbmV3VGVzdERhdGFcbiAgY3VycmVudFBhdGgucHVzaChuZXdUZXN0RGF0YSlcblxuICB0cnkge1xuICAgIGF3YWl0IHRlc3RGdW5jdGlvbigpXG4gIH0gZmluYWxseSB7XG4gICAgY3VycmVudFBhdGgucG9wKClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZXhwZWN0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJnIC0gQXJnLlxuICogQHJldHVybnMge0V4cGVjdH0gLSBUaGUgZXhwZWN0LlxuICovXG5mdW5jdGlvbiBleHBlY3QoYXJnKSB7XG4gIHJldHVybiBuZXcgRXhwZWN0KGFyZylcbn1cblxuZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcgPSBvYmplY3RDb250YWluaW5nXG5leHBlY3QuYXJyYXlDb250YWluaW5nID0gYXJyYXlDb250YWluaW5nXG5cbi8qKlxuICogUnVucyBpdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkZXNjcmlwdGlvbiAtIERlc2NyaXB0aW9uLlxuICogQHBhcmFtIHtvYmplY3R8KCgpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pKX0gYXJnMSAtIEFyZzEuXG4gKiBAcGFyYW0ge3VuZGVmaW5lZHwoKCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPikpfSBbYXJnMl0gLSBBcmcyLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5mdW5jdGlvbiBpdChkZXNjcmlwdGlvbiwgYXJnMSwgYXJnMikge1xuICBjb25zdCBjdXJyZW50VGVzdCA9IGN1cnJlbnRQYXRoW2N1cnJlbnRQYXRoLmxlbmd0aCAtIDFdXG4gIC8qKlxuICAgKiBEZWZpbmVzIHRlc3RBcmdzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgdGVzdEFyZ3NcblxuICAvKipcbiAgICogRGVmaW5lcyB0ZXN0RnVuY3Rpb24uXG4gICAqIEB0eXBlIHsoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gKi9cbiAgbGV0IHRlc3RGdW5jdGlvblxuXG4gIGlmICh0eXBlb2YgYXJnMSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0ZXN0RnVuY3Rpb24gPSAvKiogQHR5cGUgeygpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSAqLyAoYXJnMSlcbiAgICB0ZXN0QXJncyA9IHt9XG4gIH0gZWxzZSBpZiAodHlwZW9mIGFyZzIgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGVzdEZ1bmN0aW9uID0gLyoqIEB0eXBlIHsoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gKi8gKGFyZzIpXG4gICAgdGVzdEFyZ3MgPSBhcmcxXG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGFyZ3VtZW50cyBmb3IgaXQ6ICR7ZGVzY3JpcHRpb259LCAke2FyZzF9YClcbiAgfVxuXG4gIGNvbnN0IG5ld1Rlc3RBcmdzID0gbWVyZ2VUZXN0QXJncyhjdXJyZW50VGVzdC5hcmdzLCB0ZXN0QXJncylcblxuICBjb25zdCBsb2NhdGlvbiA9IGNhcHR1cmVMb2NhdGlvbigpXG5cbiAgY3VycmVudFRlc3QudGVzdHNbZGVzY3JpcHRpb25dID0ge1xuICAgIGFyZ3M6IG5ld1Rlc3RBcmdzLFxuICAgIGZ1bmN0aW9uOiB0ZXN0RnVuY3Rpb24sXG4gICAgZmlsZVBhdGg6IGxvY2F0aW9uLmZpbGVQYXRoLFxuICAgIGxpbmU6IGxvY2F0aW9uLmxpbmVcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZml0LlxuICogQHBhcmFtIHtzdHJpbmd9IGRlc2NyaXB0aW9uIC0gRGVzY3JpcHRpb24uXG4gKiBAcGFyYW0ge29iamVjdHwoKCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPikpfSBhcmcxIC0gQXJnMS5cbiAqIEBwYXJhbSB7dW5kZWZpbmVkfCgoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KSl9IFthcmcyXSAtIEFyZzIuXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGZpdChkZXNjcmlwdGlvbiwgYXJnMSwgYXJnMikge1xuICAvKipcbiAgICogRGVmaW5lcyB0ZXN0QXJncy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgbGV0IHRlc3RBcmdzXG5cbiAgLyoqXG4gICAqIERlZmluZXMgdGVzdEZ1bmN0aW9uLlxuICAgKiBAdHlwZSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9ICovXG4gIGxldCB0ZXN0RnVuY3Rpb25cblxuICBpZiAodHlwZW9mIGFyZzEgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGVzdEZ1bmN0aW9uID0gLyoqIEB0eXBlIHsoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gKi8gKGFyZzEpXG4gICAgdGVzdEFyZ3MgPSB7Zm9jdXM6IHRydWV9XG4gIH0gZWxzZSBpZiAodHlwZW9mIGFyZzIgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGVzdEZ1bmN0aW9uID0gLyoqIEB0eXBlIHsoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gKi8gKGFyZzIpXG4gICAgdGVzdEFyZ3MgPSBPYmplY3QuYXNzaWduKHtmb2N1czogdHJ1ZX0sIGFyZzEpXG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGFyZ3VtZW50cyBmb3IgaXQ6ICR7ZGVzY3JpcHRpb259LCAke2FyZzF9YClcbiAgfVxuXG4gIHJldHVybiBpdChkZXNjcmlwdGlvbiwgdGVzdEFyZ3MsIHRlc3RGdW5jdGlvbilcbn1cblxuLy8gTWFrZSB0aGUgbWV0aG9kcyBnbG9iYWwgc28gdGhleSBjYW4gYmUgdXNlZCBpbiB0ZXN0IGZpbGVzXG5PYmplY3QuYXNzaWduKGdsb2JhbFRoaXMsIHtcbiAgYWZ0ZXJBbGwsXG4gIGFmdGVyRWFjaCxcbiAgYmVmb3JlQWxsLFxuICBiZWZvcmVFYWNoLFxuICBjb25maWd1cmVUZXN0cyxcbiAgZGVzY3JpYmUsXG4gIGV4cGVjdCxcbiAgZml0LFxuICBpdCxcbiAgdGVzdEV2ZW50c1xufSlcblxuZXhwb3J0IHthZnRlckFsbCwgYWZ0ZXJFYWNoLCBiZWZvcmVBbGwsIGJlZm9yZUVhY2gsIGNvbmZpZ3VyZVRlc3RzLCBkZXNjcmliZSwgZXhwZWN0LCBmaXQsIGl0LCBhcnJheUNvbnRhaW5pbmcsIG9iamVjdENvbnRhaW5pbmcsIHRlc3RDb25maWcsIHRlc3RFdmVudHMsIHRlc3RzLCB3YWl0Rm9yRXZlbnR9XG4iXX0=