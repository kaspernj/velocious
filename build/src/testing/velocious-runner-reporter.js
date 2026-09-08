// @ts-check
import { addTrackedStackToError } from "../utils/with-tracked-stack.js";
import picocolors from "picocolors";
import restArgsError from "../utils/rest-args-error.js";
import { testEvents } from "./test.js";
/** @typedef {import("@velocious/testing/runner").TestDeclaration} PackageTestDeclaration */
/** @typedef {import("@velocious/testing/runner").TestErrorRecord} PackageTestErrorRecord */
/**
 * Restores the Error shape serialized by the package runner.
 * @param {PackageTestErrorRecord} errorRecord - Serialized package failure.
 * @returns {Error} - Error compatible with Velocious's legacy reporter contract.
 */
function errorFromPackageRecord(errorRecord) {
    const error = errorRecord.errors
        ? new AggregateError(errorRecord.errors.map(errorFromPackageRecord), errorRecord.message)
        : new Error(errorRecord.message);
    error.name = errorRecord.name;
    if (errorRecord.stack)
        error.stack = errorRecord.stack;
    if (errorRecord.cause)
        error.cause = errorFromPackageRecord(errorRecord.cause);
    if (errorRecord.terminalResource)
        Object.assign(error, { terminalResource: errorRecord.terminalResource });
    return error;
}
/** Stops package traversal after framework-owned connection quarantine. */
export class AbortRemainingTestsError extends Error {
}
export default class VelociousRunnerReporter {
    /**
     * Creates the legacy event and result projection adapter.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }) {
        restArgsError(restArgs);
        this.testRunner = testRunner;
        /** @type {WeakMap<PackageTestDeclaration, import("./test-runner.js").AttemptConsoleOutput[]>} */
        this.attemptConsoleOutputs = new WeakMap();
        /** @type {PackageTestDeclaration | undefined} */
        this.activeTest = undefined;
    }
    /**
     * Translates one awaited package runner event into the legacy contract.
     * @param {import("@velocious/testing/runner").RunnerEvent} event - Structured package event.
     * @returns {Promise<void>} - Resolves after legacy listeners finish.
     */
    async onEvent(event) {
        if (event.type === "test:start") {
            this.activeTest = this.testRunner.findTestDeclaration(event.fullName);
            if (this.activeTest) {
                const metadata = this.testRunner.testMetadata(this.activeTest);
                console.log(`${" ".repeat(metadata.descriptions.length * 2)}it ${metadata.testDescription}`);
            }
            return;
        }
        if (event.type === "attempt:finish") {
            await this.reportAttemptEvent(event);
            return;
        }
        if (event.type === "test:finish") {
            await this.reportTestEvent(event);
            return;
        }
        if (event.type === "test:not-run") {
            const test = this.testRunner.findTestDeclaration(event.test.fullName);
            if (!test)
                throw new Error(`Package not-run result did not match a declaration: ${event.test.fullName}`);
            this.testRunner.recordNotRunTest(event.test);
            this.testRunner.completeTestDeclaration(test);
            console.error(`Not run: ${event.test.fullName} (terminal resource failure in ${event.test.reason.fullName})`);
            await this.emitEvent("testNotRun", {
                configuration: this.testRunner.getConfiguration(),
                test: event.test,
                testRunner: this.testRunner
            });
            return;
        }
        if (event.type === "run:finish") {
            this.testRunner.recordPackageResult(event.result);
            for (const failure of event.result.errors) {
                console.error(`Suite ${failure.phase} failed: ${failure.suite}`);
                this.printErrorCauses(errorFromPackageRecord(failure.error));
            }
        }
    }
    /**
     * Projects attempt failure/retry events while retaining the raw thrown value.
     * @param {import("@velocious/testing/runner").RunnerEvent} event - Attempt event.
     * @returns {Promise<void>} - Resolves after listeners finish.
     */
    async reportAttemptEvent(event) {
        const test = this.activeTest || this.testRunner.findTestDeclaration(event.fullName);
        if (!test)
            throw new Error(`Package runner attempt did not match a declaration: ${event.fullName}`);
        // Narrows the structured event payload for this event discriminator.
        const attempt = /** @type {import("@velocious/testing/runner").TestAttemptResult} */ (event.attempt);
        const outcome = this.testRunner.attemptOutcome(test, attempt.attemptNumber);
        const attemptConsoleOutputs = this.attemptConsoleOutputs.get(test) || [];
        if (attempt.consoleOutput) {
            attemptConsoleOutputs.push({ attemptNumber: attempt.attemptNumber, output: attempt.consoleOutput.trimEnd() });
            this.attemptConsoleOutputs.set(test, attemptConsoleOutputs);
        }
        const retryCount = this.testRunner.retryCount(test);
        const failed = outcome?.failed ?? Boolean(attempt.error);
        const error = outcome?.error;
        const retriesUsed = Math.min(attempt.attemptNumber, retryCount);
        const willRetry = failed && !event.terminalFailure && !outcome?.abortRemainingTests && attempt.attemptNumber <= retryCount;
        const { descriptions, testDescription } = this.testRunner.testMetadata(test);
        const compatibility = this.testRunner.testData(test);
        if (failed) {
            await this.emitEvent("testAttemptFailed", {
                configuration: this.testRunner.getConfiguration(),
                descriptions,
                error,
                attemptNumber: attempt.attemptNumber,
                nextAttempt: willRetry ? attempt.attemptNumber + 1 : undefined,
                retriesUsed,
                retryCount,
                testArgs: compatibility.testArgs,
                testData: compatibility.testData,
                testDescription,
                testRunner: this.testRunner,
                willRetry
            });
        }
        if (willRetry) {
            console.warn(picocolors.red(`${" ".repeat(descriptions.length * 2)}  Retrying (${retriesUsed}/${retryCount}) after error: ${error instanceof Error ? error.message : String(error)}`));
            await this.emitEvent("testRetrying", {
                configuration: this.testRunner.getConfiguration(),
                descriptions,
                error,
                nextAttempt: attempt.attemptNumber + 1,
                retriesUsed,
                retryCount,
                testArgs: compatibility.testArgs,
                testData: compatibility.testData,
                testDescription,
                testRunner: this.testRunner
            });
        }
        if (attempt.attemptNumber > 1) {
            await this.emitEvent("testRetried", {
                configuration: this.testRunner.getConfiguration(),
                descriptions,
                error,
                attemptNumber: attempt.attemptNumber,
                retriesUsed,
                retryCount,
                testArgs: compatibility.testArgs,
                testData: compatibility.testData,
                testDescription,
                testRunner: this.testRunner
            });
        }
        if (outcome?.abortRemainingTests) {
            const metadata = this.testRunner.testMetadata(test);
            this.testRunner.recordTestDuration({
                durationMs: attempt.durationMs,
                filePath: compatibility.testData.filePath ?? "<unknown>",
                fullDescription: metadata.fullDescription,
                line: compatibility.testData.line ?? 0
            });
            await this.reportFailedTest({
                attemptConsoleOutputs,
                descriptions,
                error,
                leftPadding: " ".repeat(descriptions.length * 2),
                testArgs: compatibility.testArgs,
                testData: compatibility.testData,
                testDescription
            });
            this.testRunner.completeTestDeclaration(test);
            this.activeTest = undefined;
            throw new AbortRemainingTestsError("Velocious quarantined an attempt-owned database connection");
        }
    }
    /**
     * Projects final package result accounting and failures.
     * @param {import("@velocious/testing/runner").RunnerEvent} event - Test result event.
     * @returns {Promise<void>} - Resolves after listeners finish.
     */
    async reportTestEvent(event) {
        // Narrows the structured event payload for this event discriminator.
        const packageTestResult = /** @type {import("@velocious/testing/runner").TestResult} */ (event.test);
        const test = this.activeTest || this.testRunner.findTestDeclaration(packageTestResult.fullName);
        if (!test)
            throw new Error(`Package runner result did not match a declaration: ${packageTestResult.fullName}`);
        const metadata = this.testRunner.testMetadata(test);
        const compatibility = this.testRunner.testData(test);
        const durationMs = packageTestResult.attempts.reduce((total, attempt) => total + attempt.durationMs, 0);
        if (packageTestResult.attempts.length > 0) {
            this.testRunner.recordTestDuration({
                durationMs,
                filePath: compatibility.testData.filePath ?? "<unknown>",
                fullDescription: metadata.fullDescription,
                line: compatibility.testData.line ?? 0
            });
        }
        if (packageTestResult.status === "passed") {
            this.testRunner.recordSuccessfulTest();
        }
        else {
            const finalAttempt = packageTestResult.attempts.at(-1);
            const outcome = finalAttempt
                ? this.testRunner.attemptOutcome(test, finalAttempt.attemptNumber)
                : undefined;
            const setupFailure = this.testRunner.setupFailureOutcomeFor(test);
            const error = outcome?.failed
                ? outcome.error
                : setupFailure.failed
                    ? setupFailure.error
                    : packageTestResult.error
                        ? errorFromPackageRecord(packageTestResult.error)
                        : undefined;
            await this.reportFailedTest({
                attemptConsoleOutputs: this.attemptConsoleOutputs.get(test) || [],
                descriptions: metadata.descriptions,
                error,
                leftPadding: " ".repeat(metadata.descriptions.length * 2),
                testArgs: compatibility.testArgs,
                testData: compatibility.testData,
                testDescription: metadata.testDescription
            });
        }
        this.testRunner.completeTestDeclaration(test);
        this.activeTest = undefined;
    }
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
    async reportFailedTest({ attemptConsoleOutputs, descriptions, error, leftPadding, testArgs, testData, testDescription }) {
        const testRunner = this.testRunner;
        const consoleOutput = testRunner.buildConsoleOutput(attemptConsoleOutputs);
        if (error instanceof Error) {
            console.error(picocolors.red(`${leftPadding}  Test failed: ${error.message}`));
            this.printErrorCauses(error);
        }
        else {
            console.error(picocolors.red(`${leftPadding}  Test failed with a ${typeof error}: ${String(error)}`));
        }
        testRunner.printFailedConsoleOutput({ consoleOutput, leftPadding });
        testRunner.recordFailedTest({ descriptions, error, consoleOutput, testData, testDescription });
        await this.emitEvent("testFailed", {
            configuration: testRunner.getConfiguration(),
            descriptions,
            error,
            testArgs,
            testData,
            testDescription,
            testRunner
        });
        testRunner.printRerunCommand({ descriptions, testDescription, testData, leftPadding });
    }
    /**
     * Prints complete primary and secondary stacks once, including cyclic cause graphs.
     * @param {unknown} error - Thrown value at the reporting boundary.
     * @param {Set<Error>} [reported] - Error identities already printed.
     * @returns {void}
     */
    printErrorCauses(error, reported = new Set()) {
        if (!(error instanceof Error)) {
            console.error(String(error));
            return;
        }
        if (reported.has(error))
            return;
        reported.add(error);
        addTrackedStackToError(error);
        console.error(error.stack || `${error.name}: ${error.message}`);
        if (error.cause !== undefined) {
            console.error("Caused by:");
            this.printErrorCauses(error.cause, reported);
        }
        if (error instanceof AggregateError) {
            for (const secondary of error.errors) {
                console.error("Related failure:");
                this.printErrorCauses(secondary, reported);
            }
        }
    }
    /**
     * Emits one legacy event and awaits listeners in registration order.
     * @param {string} eventName - Event name.
     * @param {object} payload - Event payload.
     * @returns {Promise<void>} - Resolves when all listeners complete.
     */
    async emitEvent(eventName, payload) {
        for (const listener of testEvents.listeners(eventName))
            await listener(payload);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXJ1bm5lci1yZXBvcnRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3ZlbG9jaW91cy1ydW5uZXItcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxNQUFNLGdDQUFnQyxDQUFBO0FBQ3ZFLE9BQU8sVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUNuQyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sV0FBVyxDQUFBO0FBRXRDLDRGQUE0RjtBQUM1Riw0RkFBNEY7QUFFNUY7Ozs7R0FJRztBQUNILFNBQVMsc0JBQXNCLENBQUMsV0FBVztJQUN6QyxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsTUFBTTtRQUM5QixDQUFDLENBQUMsSUFBSSxjQUFjLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLENBQUMsRUFBRSxXQUFXLENBQUMsT0FBTyxDQUFDO1FBQ3pGLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUE7SUFFbEMsS0FBSyxDQUFDLElBQUksR0FBRyxXQUFXLENBQUMsSUFBSSxDQUFBO0lBQzdCLElBQUksV0FBVyxDQUFDLEtBQUs7UUFBRSxLQUFLLENBQUMsS0FBSyxHQUFHLFdBQVcsQ0FBQyxLQUFLLENBQUE7SUFDdEQsSUFBSSxXQUFXLENBQUMsS0FBSztRQUFFLEtBQUssQ0FBQyxLQUFLLEdBQUcsc0JBQXNCLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzlFLElBQUksV0FBVyxDQUFDLGdCQUFnQjtRQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLEVBQUMsZ0JBQWdCLEVBQUUsV0FBVyxDQUFDLGdCQUFnQixFQUFDLENBQUMsQ0FBQTtJQUV4RyxPQUFPLEtB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LFVBQVUsQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDO1lBQUUsTUFBTSxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDakYsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IGFkZFRyYWNrZWRTdGFja1RvRXJyb3IgfSBmcm9tIFwiLi4vdXRpbHMvd2l0aC10cmFja2VkLXN0YWNrLmpzXCJcbmltcG9ydCBwaWNvY29sb3JzIGZyb20gXCJwaWNvY29sb3JzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHsgdGVzdEV2ZW50cyB9IGZyb20gXCIuL3Rlc3QuanNcIlxuXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuVGVzdERlY2xhcmF0aW9ufSBQYWNrYWdlVGVzdERlY2xhcmF0aW9uICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuVGVzdEVycm9yUmVjb3JkfSBQYWNrYWdlVGVzdEVycm9yUmVjb3JkICovXG5cbi8qKlxuICogUmVzdG9yZXMgdGhlIEVycm9yIHNoYXBlIHNlcmlhbGl6ZWQgYnkgdGhlIHBhY2thZ2UgcnVubmVyLlxuICogQHBhcmFtIHtQYWNrYWdlVGVzdEVycm9yUmVjb3JkfSBlcnJvclJlY29yZCAtIFNlcmlhbGl6ZWQgcGFja2FnZSBmYWlsdXJlLlxuICogQHJldHVybnMge0Vycm9yfSAtIEVycm9yIGNvbXBhdGlibGUgd2l0aCBWZWxvY2lvdXMncyBsZWdhY3kgcmVwb3J0ZXIgY29udHJhY3QuXG4gKi9cbmZ1bmN0aW9uIGVycm9yRnJvbVBhY2thZ2VSZWNvcmQoZXJyb3JSZWNvcmQpIHtcbiAgY29uc3QgZXJyb3IgPSBlcnJvclJlY29yZC5lcnJvcnNcbiAgICA/IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvclJlY29yZC5lcnJvcnMubWFwKGVycm9yRnJvbVBhY2thZ2VSZWNvcmQpLCBlcnJvclJlY29yZC5tZXNzYWdlKVxuICAgIDogbmV3IEVycm9yKGVycm9yUmVjb3JkLm1lc3NhZ2UpXG5cbiAgZXJyb3IubmFtZSA9IGVycm9yUmVjb3JkLm5hbWVcbiAgaWYgKGVycm9yUmVjb3JkLnN0YWNrKSBlcnJvci5zdGFjayA9IGVycm9yUmVjb3JkLnN0YWNrXG4gIGlmIChlcnJvclJlY29yZC5jYXVzZSkgZXJyb3IuY2F1c2UgPSBlcnJvckZyb21QYWNrYWdlUmVjb3JkKGVycm9yUmVjb3JkLmNhdXNlKVxuICBpZiAoZXJyb3JSZWNvcmQudGVybWluYWxSZXNvdXJjZSkgT2JqZWN0LmFzc2lnbihlcnJvciwge3Rlcm1pbmFsUmVzb3VyY2U6IGVycm9yUmVjb3JkLnRlcm1pbmFsUmVzb3VyY2V9KVxuXG4gIHJldHVybiBlcnJvclxufVxuXG4vKiogU3RvcHMgcGFja2FnZSB0cmF2ZXJzYWwgYWZ0ZXIgZnJhbWV3b3JrLW93bmVkIGNvbm5lY3Rpb24gcXVhcmFudGluZS4gKi9cbmV4cG9ydCBjbGFzcyBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBsZWdhY3kgZXZlbnQgYW5kIHJlc3VsdCBwcm9qZWN0aW9uIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuZGVmYXVsdH0gYXJncy50ZXN0UnVubmVyIC0gT3duaW5nIFZlbG9jaW91cyBydW5uZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGVzdFJ1bm5lciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB0aGlzLnRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIGltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQXR0ZW1wdENvbnNvbGVPdXRwdXRbXT59ICovXG4gICAgdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuYWN0aXZlVGVzdCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFRyYW5zbGF0ZXMgb25lIGF3YWl0ZWQgcGFja2FnZSBydW5uZXIgZXZlbnQgaW50byB0aGUgbGVnYWN5IGNvbnRyYWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuUnVubmVyRXZlbnR9IGV2ZW50IC0gU3RydWN0dXJlZCBwYWNrYWdlIGV2ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsZWdhY3kgbGlzdGVuZXJzIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIG9uRXZlbnQoZXZlbnQpIHtcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXN0OnN0YXJ0XCIpIHtcbiAgICAgIHRoaXMuYWN0aXZlVGVzdCA9IHRoaXMudGVzdFJ1bm5lci5maW5kVGVzdERlY2xhcmF0aW9uKGV2ZW50LmZ1bGxOYW1lKVxuICAgICAgaWYgKHRoaXMuYWN0aXZlVGVzdCkge1xuICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMudGVzdFJ1bm5lci50ZXN0TWV0YWRhdGEodGhpcy5hY3RpdmVUZXN0KVxuICAgICAgICBjb25zb2xlLmxvZyhgJHtcIiBcIi5yZXBlYXQobWV0YWRhdGEuZGVzY3JpcHRpb25zLmxlbmd0aCAqIDIpfWl0ICR7bWV0YWRhdGEudGVzdERlc2NyaXB0aW9ufWApXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJhdHRlbXB0OmZpbmlzaFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlcG9ydEF0dGVtcHRFdmVudChldmVudClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChldmVudC50eXBlID09PSBcInRlc3Q6ZmluaXNoXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVwb3J0VGVzdEV2ZW50KGV2ZW50KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwidGVzdDpub3QtcnVuXCIpIHtcbiAgICAgIGNvbnN0IHRlc3QgPSB0aGlzLnRlc3RSdW5uZXIuZmluZFRlc3REZWNsYXJhdGlvbihldmVudC50ZXN0LmZ1bGxOYW1lKVxuICAgICAgaWYgKCF0ZXN0KSB0aHJvdyBuZXcgRXJyb3IoYFBhY2thZ2Ugbm90LXJ1biByZXN1bHQgZGlkIG5vdCBtYXRjaCBhIGRlY2xhcmF0aW9uOiAke2V2ZW50LnRlc3QuZnVsbE5hbWV9YClcbiAgICAgIHRoaXMudGVzdFJ1bm5lci5yZWNvcmROb3RSdW5UZXN0KGV2ZW50LnRlc3QpXG4gICAgICB0aGlzLnRlc3RSdW5uZXIuY29tcGxldGVUZXN0RGVjbGFyYXRpb24odGVzdClcbiAgICAgIGNvbnNvbGUuZXJyb3IoYE5vdCBydW46ICR7ZXZlbnQudGVzdC5mdWxsTmFtZX0gKHRlcm1pbmFsIHJlc291cmNlIGZhaWx1cmUgaW4gJHtldmVudC50ZXN0LnJlYXNvbi5mdWxsTmFtZX0pYClcbiAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdE5vdFJ1blwiLCB7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMudGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIHRlc3Q6IGV2ZW50LnRlc3QsXG4gICAgICAgIHRlc3RSdW5uZXI6IHRoaXMudGVzdFJ1bm5lclxuICAgICAgfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChldmVudC50eXBlID09PSBcInJ1bjpmaW5pc2hcIikge1xuICAgICAgdGhpcy50ZXN0UnVubmVyLnJlY29yZFBhY2thZ2VSZXN1bHQoZXZlbnQucmVzdWx0KVxuICAgICAgZm9yIChjb25zdCBmYWlsdXJlIG9mIGV2ZW50LnJlc3VsdC5lcnJvcnMpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgU3VpdGUgJHtmYWlsdXJlLnBoYXNlfSBmYWlsZWQ6ICR7ZmFpbHVyZS5zdWl0ZX1gKVxuICAgICAgICB0aGlzLnByaW50RXJyb3JDYXVzZXMoZXJyb3JGcm9tUGFja2FnZVJlY29yZChmYWlsdXJlLmVycm9yKSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgYXR0ZW1wdCBmYWlsdXJlL3JldHJ5IGV2ZW50cyB3aGlsZSByZXRhaW5pbmcgdGhlIHJhdyB0aHJvd24gdmFsdWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5SdW5uZXJFdmVudH0gZXZlbnQgLSBBdHRlbXB0IGV2ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsaXN0ZW5lcnMgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0QXR0ZW1wdEV2ZW50KGV2ZW50KSB7XG4gICAgY29uc3QgdGVzdCA9IHRoaXMuYWN0aXZlVGVzdCB8fCB0aGlzLnRlc3RSdW5uZXIuZmluZFRlc3REZWNsYXJhdGlvbihldmVudC5mdWxsTmFtZSlcblxuICAgIGlmICghdGVzdCkgdGhyb3cgbmV3IEVycm9yKGBQYWNrYWdlIHJ1bm5lciBhdHRlbXB0IGRpZCBub3QgbWF0Y2ggYSBkZWNsYXJhdGlvbjogJHtldmVudC5mdWxsTmFtZX1gKVxuXG4gICAgLy8gTmFycm93cyB0aGUgc3RydWN0dXJlZCBldmVudCBwYXlsb2FkIGZvciB0aGlzIGV2ZW50IGRpc2NyaW1pbmF0b3IuXG4gICAgY29uc3QgYXR0ZW1wdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0QXR0ZW1wdFJlc3VsdH0gKi8gKGV2ZW50LmF0dGVtcHQpXG4gICAgY29uc3Qgb3V0Y29tZSA9IHRoaXMudGVzdFJ1bm5lci5hdHRlbXB0T3V0Y29tZSh0ZXN0LCBhdHRlbXB0LmF0dGVtcHROdW1iZXIpXG4gICAgY29uc3QgYXR0ZW1wdENvbnNvbGVPdXRwdXRzID0gdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMuZ2V0KHRlc3QpIHx8IFtdXG5cbiAgICBpZiAoYXR0ZW1wdC5jb25zb2xlT3V0cHV0KSB7XG4gICAgICBhdHRlbXB0Q29uc29sZU91dHB1dHMucHVzaCh7YXR0ZW1wdE51bWJlcjogYXR0ZW1wdC5hdHRlbXB0TnVtYmVyLCBvdXRwdXQ6IGF0dGVtcHQuY29uc29sZU91dHB1dC50cmltRW5kKCl9KVxuICAgICAgdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMuc2V0KHRlc3QsIGF0dGVtcHRDb25zb2xlT3V0cHV0cylcbiAgICB9XG5cbiAgICBjb25zdCByZXRyeUNvdW50ID0gdGhpcy50ZXN0UnVubmVyLnJldHJ5Q291bnQodGVzdClcbiAgICBjb25zdCBmYWlsZWQgPSBvdXRjb21lPy5mYWlsZWQgPz8gQm9vbGVhbihhdHRlbXB0LmVycm9yKVxuICAgIGNvbnN0IGVycm9yID0gb3V0Y29tZT8uZXJyb3JcbiAgICBjb25zdCByZXRyaWVzVXNlZCA9IE1hdGgubWluKGF0dGVtcHQuYXR0ZW1wdE51bWJlciwgcmV0cnlDb3VudClcbiAgICBjb25zdCB3aWxsUmV0cnkgPSBmYWlsZWQgJiYgIWV2ZW50LnRlcm1pbmFsRmFpbHVyZSAmJiAhb3V0Y29tZT8uYWJvcnRSZW1haW5pbmdUZXN0cyAmJiBhdHRlbXB0LmF0dGVtcHROdW1iZXIgPD0gcmV0cnlDb3VudFxuICAgIGNvbnN0IHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbn0gPSB0aGlzLnRlc3RSdW5uZXIudGVzdE1ldGFkYXRhKHRlc3QpXG4gICAgY29uc3QgY29tcGF0aWJpbGl0eSA9IHRoaXMudGVzdFJ1bm5lci50ZXN0RGF0YSh0ZXN0KVxuXG4gICAgaWYgKGZhaWxlZCkge1xuICAgICAgYXdhaXQgdGhpcy5lbWl0RXZlbnQoXCJ0ZXN0QXR0ZW1wdEZhaWxlZFwiLCB7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMudGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGF0dGVtcHROdW1iZXI6IGF0dGVtcHQuYXR0ZW1wdE51bWJlcixcbiAgICAgICAgbmV4dEF0dGVtcHQ6IHdpbGxSZXRyeSA/IGF0dGVtcHQuYXR0ZW1wdE51bWJlciArIDEgOiB1bmRlZmluZWQsXG4gICAgICAgIHJldHJpZXNVc2VkLFxuICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICB0ZXN0QXJnczogY29tcGF0aWJpbGl0eS50ZXN0QXJncyxcbiAgICAgICAgdGVzdERhdGE6IGNvbXBhdGliaWxpdHkudGVzdERhdGEsXG4gICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgdGVzdFJ1bm5lcjogdGhpcy50ZXN0UnVubmVyLFxuICAgICAgICB3aWxsUmV0cnlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHdpbGxSZXRyeSkge1xuICAgICAgY29uc29sZS53YXJuKHBpY29jb2xvcnMucmVkKGAke1wiIFwiLnJlcGVhdChkZXNjcmlwdGlvbnMubGVuZ3RoICogMil9ICBSZXRyeWluZyAoJHtyZXRyaWVzVXNlZH0vJHtyZXRyeUNvdW50fSkgYWZ0ZXIgZXJyb3I6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApKVxuICAgICAgYXdhaXQgdGhpcy5lbWl0RXZlbnQoXCJ0ZXN0UmV0cnlpbmdcIiwge1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLnRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBuZXh0QXR0ZW1wdDogYXR0ZW1wdC5hdHRlbXB0TnVtYmVyICsgMSxcbiAgICAgICAgcmV0cmllc1VzZWQsXG4gICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgIHRlc3RBcmdzOiBjb21wYXRpYmlsaXR5LnRlc3RBcmdzLFxuICAgICAgICB0ZXN0RGF0YTogY29tcGF0aWJpbGl0eS50ZXN0RGF0YSxcbiAgICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgICB0ZXN0UnVubmVyOiB0aGlzLnRlc3RSdW5uZXJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGF0dGVtcHQuYXR0ZW1wdE51bWJlciA+IDEpIHtcbiAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdFJldHJpZWRcIiwge1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLnRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBhdHRlbXB0TnVtYmVyOiBhdHRlbXB0LmF0dGVtcHROdW1iZXIsXG4gICAgICAgIHJldHJpZXNVc2VkLFxuICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICB0ZXN0QXJnczogY29tcGF0aWJpbGl0eS50ZXN0QXJncyxcbiAgICAgICAgdGVzdERhdGE6IGNvbXBhdGliaWxpdHkudGVzdERhdGEsXG4gICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgdGVzdFJ1bm5lcjogdGhpcy50ZXN0UnVubmVyXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChvdXRjb21lPy5hYm9ydFJlbWFpbmluZ1Rlc3RzKSB7XG4gICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMudGVzdFJ1bm5lci50ZXN0TWV0YWRhdGEodGVzdClcblxuICAgICAgdGhpcy50ZXN0UnVubmVyLnJlY29yZFRlc3REdXJhdGlvbih7XG4gICAgICAgIGR1cmF0aW9uTXM6IGF0dGVtcHQuZHVyYXRpb25NcyxcbiAgICAgICAgZmlsZVBhdGg6IGNvbXBhdGliaWxpdHkudGVzdERhdGEuZmlsZVBhdGggPz8gXCI8dW5rbm93bj5cIixcbiAgICAgICAgZnVsbERlc2NyaXB0aW9uOiBtZXRhZGF0YS5mdWxsRGVzY3JpcHRpb24sXG4gICAgICAgIGxpbmU6IGNvbXBhdGliaWxpdHkudGVzdERhdGEubGluZSA/PyAwXG4gICAgICB9KVxuICAgICAgYXdhaXQgdGhpcy5yZXBvcnRGYWlsZWRUZXN0KHtcbiAgICAgICAgYXR0ZW1wdENvbnNvbGVPdXRwdXRzLFxuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBsZWZ0UGFkZGluZzogXCIgXCIucmVwZWF0KGRlc2NyaXB0aW9ucy5sZW5ndGggKiAyKSxcbiAgICAgICAgdGVzdEFyZ3M6IGNvbXBhdGliaWxpdHkudGVzdEFyZ3MsXG4gICAgICAgIHRlc3REYXRhOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLFxuICAgICAgICB0ZXN0RGVzY3JpcHRpb25cbiAgICAgIH0pXG4gICAgICB0aGlzLnRlc3RSdW5uZXIuY29tcGxldGVUZXN0RGVjbGFyYXRpb24odGVzdClcbiAgICAgIHRoaXMuYWN0aXZlVGVzdCA9IHVuZGVmaW5lZFxuICAgICAgdGhyb3cgbmV3IEFib3J0UmVtYWluaW5nVGVzdHNFcnJvcihcIlZlbG9jaW91cyBxdWFyYW50aW5lZCBhbiBhdHRlbXB0LW93bmVkIGRhdGFiYXNlIGNvbm5lY3Rpb25cIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgZmluYWwgcGFja2FnZSByZXN1bHQgYWNjb3VudGluZyBhbmQgZmFpbHVyZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5SdW5uZXJFdmVudH0gZXZlbnQgLSBUZXN0IHJlc3VsdCBldmVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgbGlzdGVuZXJzIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIHJlcG9ydFRlc3RFdmVudChldmVudCkge1xuICAgIC8vIE5hcnJvd3MgdGhlIHN0cnVjdHVyZWQgZXZlbnQgcGF5bG9hZCBmb3IgdGhpcyBldmVudCBkaXNjcmltaW5hdG9yLlxuICAgIGNvbnN0IHBhY2thZ2VUZXN0UmVzdWx0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3RSZXN1bHR9ICovIChldmVudC50ZXN0KVxuICAgIGNvbnN0IHRlc3QgPSB0aGlzLmFjdGl2ZVRlc3QgfHwgdGhpcy50ZXN0UnVubmVyLmZpbmRUZXN0RGVjbGFyYXRpb24ocGFja2FnZVRlc3RSZXN1bHQuZnVsbE5hbWUpXG5cbiAgICBpZiAoIXRlc3QpIHRocm93IG5ldyBFcnJvcihgUGFja2FnZSBydW5uZXIgcmVzdWx0IGRpZCBub3QgbWF0Y2ggYSBkZWNsYXJhdGlvbjogJHtwYWNrYWdlVGVzdFJlc3VsdC5mdWxsTmFtZX1gKVxuXG4gICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnRlc3RSdW5uZXIudGVzdE1ldGFkYXRhKHRlc3QpXG4gICAgY29uc3QgY29tcGF0aWJpbGl0eSA9IHRoaXMudGVzdFJ1bm5lci50ZXN0RGF0YSh0ZXN0KVxuICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBwYWNrYWdlVGVzdFJlc3VsdC5hdHRlbXB0cy5yZWR1Y2UoKHRvdGFsLCBhdHRlbXB0KSA9PiB0b3RhbCArIGF0dGVtcHQuZHVyYXRpb25NcywgMClcblxuICAgIGlmIChwYWNrYWdlVGVzdFJlc3VsdC5hdHRlbXB0cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLnRlc3RSdW5uZXIucmVjb3JkVGVzdER1cmF0aW9uKHtcbiAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgZmlsZVBhdGg6IGNvbXBhdGliaWxpdHkudGVzdERhdGEuZmlsZVBhdGggPz8gXCI8dW5rbm93bj5cIixcbiAgICAgICAgZnVsbERlc2NyaXB0aW9uOiBtZXRhZGF0YS5mdWxsRGVzY3JpcHRpb24sXG4gICAgICAgIGxpbmU6IGNvbXBhdGliaWxpdHkudGVzdERhdGEubGluZSA/PyAwXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChwYWNrYWdlVGVzdFJlc3VsdC5zdGF0dXMgPT09IFwicGFzc2VkXCIpIHtcbiAgICAgIHRoaXMudGVzdFJ1bm5lci5yZWNvcmRTdWNjZXNzZnVsVGVzdCgpXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGZpbmFsQXR0ZW1wdCA9IHBhY2thZ2VUZXN0UmVzdWx0LmF0dGVtcHRzLmF0KC0xKVxuICAgICAgY29uc3Qgb3V0Y29tZSA9IGZpbmFsQXR0ZW1wdFxuICAgICAgICA/IHRoaXMudGVzdFJ1bm5lci5hdHRlbXB0T3V0Y29tZSh0ZXN0LCBmaW5hbEF0dGVtcHQuYXR0ZW1wdE51bWJlcilcbiAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgIGNvbnN0IHNldHVwRmFpbHVyZSA9IHRoaXMudGVzdFJ1bm5lci5zZXR1cEZhaWx1cmVPdXRjb21lRm9yKHRlc3QpXG4gICAgICBjb25zdCBlcnJvciA9IG91dGNvbWU/LmZhaWxlZFxuICAgICAgICA/IG91dGNvbWUuZXJyb3JcbiAgICAgICAgOiBzZXR1cEZhaWx1cmUuZmFpbGVkXG4gICAgICAgICAgPyBzZXR1cEZhaWx1cmUuZXJyb3JcbiAgICAgICAgICA6IHBhY2thZ2VUZXN0UmVzdWx0LmVycm9yXG4gICAgICAgICAgICA/IGVycm9yRnJvbVBhY2thZ2VSZWNvcmQocGFja2FnZVRlc3RSZXN1bHQuZXJyb3IpXG4gICAgICAgICAgICA6IHVuZGVmaW5lZFxuXG4gICAgICBhd2FpdCB0aGlzLnJlcG9ydEZhaWxlZFRlc3Qoe1xuICAgICAgICBhdHRlbXB0Q29uc29sZU91dHB1dHM6IHRoaXMuYXR0ZW1wdENvbnNvbGVPdXRwdXRzLmdldCh0ZXN0KSB8fCBbXSxcbiAgICAgICAgZGVzY3JpcHRpb25zOiBtZXRhZGF0YS5kZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBsZWZ0UGFkZGluZzogXCIgXCIucmVwZWF0KG1ldGFkYXRhLmRlc2NyaXB0aW9ucy5sZW5ndGggKiAyKSxcbiAgICAgICAgdGVzdEFyZ3M6IGNvbXBhdGliaWxpdHkudGVzdEFyZ3MsXG4gICAgICAgIHRlc3REYXRhOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLFxuICAgICAgICB0ZXN0RGVzY3JpcHRpb246IG1ldGFkYXRhLnRlc3REZXNjcmlwdGlvblxuICAgICAgfSlcbiAgICB9XG5cbiAgICB0aGlzLnRlc3RSdW5uZXIuY29tcGxldGVUZXN0RGVjbGFyYXRpb24odGVzdClcbiAgICB0aGlzLmFjdGl2ZVRlc3QgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuZCBlbWl0cyBvbmUgZmluYWwgZmFpbGVkIHRlc3QgcmVzdWx0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZpbmFsIGZhaWx1cmUgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5BdHRlbXB0Q29uc29sZU91dHB1dFtdfSBhcmdzLmF0dGVtcHRDb25zb2xlT3V0cHV0cyAtIENhcHR1cmVkIG91dHB1dCBhY3Jvc3MgYXR0ZW1wdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gUGFyZW50IGRlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gUmF3IGZpbmFsIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxlZnRQYWRkaW5nIC0gQ29uc29sZSBpbmRlbnRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3RBcmdzfSBhcmdzLnRlc3RBcmdzIC0gU3RhYmxlIHRlc3QgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IHJlZ2lzdHJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGZpbmFsLWZhaWx1cmUgbGlzdGVuZXIgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0RmFpbGVkVGVzdCh7YXR0ZW1wdENvbnNvbGVPdXRwdXRzLCBkZXNjcmlwdGlvbnMsIGVycm9yLCBsZWZ0UGFkZGluZywgdGVzdEFyZ3MsIHRlc3REYXRhLCB0ZXN0RGVzY3JpcHRpb259KSB7XG4gICAgY29uc3QgdGVzdFJ1bm5lciA9IHRoaXMudGVzdFJ1bm5lclxuICAgIGNvbnN0IGNvbnNvbGVPdXRwdXQgPSB0ZXN0UnVubmVyLmJ1aWxkQ29uc29sZU91dHB1dChhdHRlbXB0Q29uc29sZU91dHB1dHMpXG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIFRlc3QgZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCkpXG4gICAgICB0aGlzLnByaW50RXJyb3JDYXVzZXMoZXJyb3IpXG5cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIFRlc3QgZmFpbGVkIHdpdGggYSAke3R5cGVvZiBlcnJvcn06ICR7U3RyaW5nKGVycm9yKX1gKSlcbiAgICB9XG5cbiAgICB0ZXN0UnVubmVyLnByaW50RmFpbGVkQ29uc29sZU91dHB1dCh7Y29uc29sZU91dHB1dCwgbGVmdFBhZGRpbmd9KVxuICAgIHRlc3RSdW5uZXIucmVjb3JkRmFpbGVkVGVzdCh7ZGVzY3JpcHRpb25zLCBlcnJvciwgY29uc29sZU91dHB1dCwgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbn0pXG5cbiAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RGYWlsZWRcIiwge1xuICAgICAgY29uZmlndXJhdGlvbjogdGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICBlcnJvcixcbiAgICAgIHRlc3RBcmdzLFxuICAgICAgdGVzdERhdGEsXG4gICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICB0ZXN0UnVubmVyXG4gICAgfSlcblxuICAgIHRlc3RSdW5uZXIucHJpbnRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YSwgbGVmdFBhZGRpbmd9KVxuICB9XG5cbiAgLyoqXG4gICAqIFByaW50cyBjb21wbGV0ZSBwcmltYXJ5IGFuZCBzZWNvbmRhcnkgc3RhY2tzIG9uY2UsIGluY2x1ZGluZyBjeWNsaWMgY2F1c2UgZ3JhcGhzLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gVGhyb3duIHZhbHVlIGF0IHRoZSByZXBvcnRpbmcgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7U2V0PEVycm9yPn0gW3JlcG9ydGVkXSAtIEVycm9yIGlkZW50aXRpZXMgYWxyZWFkeSBwcmludGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHByaW50RXJyb3JDYXVzZXMoZXJyb3IsIHJlcG9ydGVkID0gbmV3IFNldCgpKSB7XG4gICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAocmVwb3J0ZWQuaGFzKGVycm9yKSkgcmV0dXJuXG4gICAgcmVwb3J0ZWQuYWRkKGVycm9yKVxuICAgIGFkZFRyYWNrZWRTdGFja1RvRXJyb3IoZXJyb3IpXG4gICAgY29uc29sZS5lcnJvcihlcnJvci5zdGFjayB8fCBgJHtlcnJvci5uYW1lfTogJHtlcnJvci5tZXNzYWdlfWApXG4gICAgaWYgKGVycm9yLmNhdXNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJDYXVzZWQgYnk6XCIpXG4gICAgICB0aGlzLnByaW50RXJyb3JDYXVzZXMoZXJyb3IuY2F1c2UsIHJlcG9ydGVkKVxuICAgIH1cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgICAgZm9yIChjb25zdCBzZWNvbmRhcnkgb2YgZXJyb3IuZXJyb3JzKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJSZWxhdGVkIGZhaWx1cmU6XCIpXG4gICAgICAgIHRoaXMucHJpbnRFcnJvckNhdXNlcyhzZWNvbmRhcnksIHJlcG9ydGVkKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBvbmUgbGVnYWN5IGV2ZW50IGFuZCBhd2FpdHMgbGlzdGVuZXJzIGluIHJlZ2lzdHJhdGlvbiBvcmRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgbGlzdGVuZXJzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGF5bG9hZCkge1xuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgdGVzdEV2ZW50cy5saXN0ZW5lcnMoZXZlbnROYW1lKSkgYXdhaXQgbGlzdGVuZXIocGF5bG9hZClcbiAgfVxufVxuIl19