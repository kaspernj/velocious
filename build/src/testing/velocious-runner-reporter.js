// @ts-check
import { addTrackedStackToError } from "../utils/with-tracked-stack.js";
import BacktraceCleaner from "../utils/backtrace-cleaner-node.js";
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
        if (event.type === "run:finish")
            this.testRunner.recordPackageResult(event.result);
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
        const willRetry = failed && !outcome?.abortRemainingTests && attempt.attemptNumber <= retryCount;
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
            addTrackedStackToError(error);
            const backtraceCleaner = new BacktraceCleaner(error);
            const cleanedStack = backtraceCleaner.getCleanedStack();
            const stackLines = cleanedStack?.split("\n");
            if (stackLines) {
                for (const stackLine of stackLines)
                    console.error(picocolors.red(`${leftPadding}  ${stackLine}`));
            }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXJ1bm5lci1yZXBvcnRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3ZlbG9jaW91cy1ydW5uZXItcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxNQUFNLGdDQUFnQyxDQUFBO0FBQ3ZFLE9BQU8sZ0JBQWdCLE1BQU0sb0NBQW9DLENBQUE7QUFDakUsT0FBTyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ25DLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxXQUFXLENBQUE7QUFFdEMsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUU1Rjs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxXQUFXO0lBQ3pDLE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxNQUFNO1FBQzlCLENBQUMsQ0FBQyxJQUFJLGNBQWMsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxPQUFPLENBQUM7UUFDekYsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUVsQyxLQUFLLENBQUMsSUFBSSxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUE7SUFDN0IsSUFBSSxXQUFXLENBQUMsS0FBSztRQUFFLEtBQUssQ0FBQyxLQUFLLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQTtJQUV0RCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRCwyRUFBMkU7QUFDM0UsTUFBTSxPQUFPLHdCQUF5QixTQUFRLEtBQUs7Q0FBRztBQUV0RCxNQUFNLENBQUMsT0FBTyxPQUFPLHVCQUF1QjtJQUMxQzs7OztPQUlHO0lBQ0gsWUFBWSxFQUFDLFVBQVUsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUNuQyxhQUFh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QUNMLFFBQVE7WUFDUixRQUFRO1lBQ1IsZUFBZTtZQUNmLFVBQVU7U0FDWCxDQUFDLENBQUE7UUFFRixVQUFVLENBQUMsaUJBQWlCLENBQUMsRUFBQyxZQUFZLEVBQUUsZUFBZSxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO0lBQ3RGLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsU0FBUyxFQUFFLE9BQU87UUFDaEMsS0FBSyxNQUFNLFFBQVEsSUFBSSxVQUFVLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQztZQUFFLE1BQU0sUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQ2pGLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBhZGRUcmFja2VkU3RhY2tUb0Vycm9yIH0gZnJvbSBcIi4uL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay5qc1wiXG5pbXBvcnQgQmFja3RyYWNlQ2xlYW5lciBmcm9tIFwiLi4vdXRpbHMvYmFja3RyYWNlLWNsZWFuZXItbm9kZS5qc1wiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IHRlc3RFdmVudHMgfSBmcm9tIFwiLi90ZXN0LmpzXCJcblxuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3REZWNsYXJhdGlvbn0gUGFja2FnZVRlc3REZWNsYXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3RFcnJvclJlY29yZH0gUGFja2FnZVRlc3RFcnJvclJlY29yZCAqL1xuXG4vKipcbiAqIFJlc3RvcmVzIHRoZSBFcnJvciBzaGFwZSBzZXJpYWxpemVkIGJ5IHRoZSBwYWNrYWdlIHJ1bm5lci5cbiAqIEBwYXJhbSB7UGFja2FnZVRlc3RFcnJvclJlY29yZH0gZXJyb3JSZWNvcmQgLSBTZXJpYWxpemVkIHBhY2thZ2UgZmFpbHVyZS5cbiAqIEByZXR1cm5zIHtFcnJvcn0gLSBFcnJvciBjb21wYXRpYmxlIHdpdGggVmVsb2Npb3VzJ3MgbGVnYWN5IHJlcG9ydGVyIGNvbnRyYWN0LlxuICovXG5mdW5jdGlvbiBlcnJvckZyb21QYWNrYWdlUmVjb3JkKGVycm9yUmVjb3JkKSB7XG4gIGNvbnN0IGVycm9yID0gZXJyb3JSZWNvcmQuZXJyb3JzXG4gICAgPyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JSZWNvcmQuZXJyb3JzLm1hcChlcnJvckZyb21QYWNrYWdlUmVjb3JkKSwgZXJyb3JSZWNvcmQubWVzc2FnZSlcbiAgICA6IG5ldyBFcnJvcihlcnJvclJlY29yZC5tZXNzYWdlKVxuXG4gIGVycm9yLm5hbWUgPSBlcnJvclJlY29yZC5uYW1lXG4gIGlmIChlcnJvclJlY29yZC5zdGFjaykgZXJyb3Iuc3RhY2sgPSBlcnJvclJlY29yZC5zdGFja1xuXG4gIHJldHVybiBlcnJvclxufVxuXG4vKiogU3RvcHMgcGFja2FnZSB0cmF2ZXJzYWwgYWZ0ZXIgZnJhbWV3b3JrLW93bmVkIGNvbm5lY3Rpb24gcXVhcmFudGluZS4gKi9cbmV4cG9ydCBjbGFzcyBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBsZWdhY3kgZXZlbnQgYW5kIHJlc3VsdCBwcm9qZWN0aW9uIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuZGVmYXVsdH0gYXJncy50ZXN0UnVubmVyIC0gT3duaW5nIFZlbG9jaW91cyBydW5uZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGVzdFJ1bm5lciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB0aGlzLnRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIGltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQXR0ZW1wdENvbnNvbGVPdXRwdXRbXT59ICovXG4gICAgdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuYWN0aXZlVGVzdCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFRyYW5zbGF0ZXMgb25lIGF3YWl0ZWQgcGFja2FnZSBydW5uZXIgZXZlbnQgaW50byB0aGUgbGVnYWN5IGNvbnRyYWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuUnVubmVyRXZlbnR9IGV2ZW50IC0gU3RydWN0dXJlZCBwYWNrYWdlIGV2ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsZWdhY3kgbGlzdGVuZXJzIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIG9uRXZlbnQoZXZlbnQpIHtcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXN0OnN0YXJ0XCIpIHtcbiAgICAgIHRoaXMuYWN0aXZlVGVzdCA9IHRoaXMudGVzdFJ1bm5lci5maW5kVGVzdERlY2xhcmF0aW9uKGV2ZW50LmZ1bGxOYW1lKVxuICAgICAgaWYgKHRoaXMuYWN0aXZlVGVzdCkge1xuICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMudGVzdFJ1bm5lci50ZXN0TWV0YWRhdGEodGhpcy5hY3RpdmVUZXN0KVxuICAgICAgICBjb25zb2xlLmxvZyhgJHtcIiBcIi5yZXBlYXQobWV0YWRhdGEuZGVzY3JpcHRpb25zLmxlbmd0aCAqIDIpfWl0ICR7bWV0YWRhdGEudGVzdERlc2NyaXB0aW9ufWApXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJhdHRlbXB0OmZpbmlzaFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlcG9ydEF0dGVtcHRFdmVudChldmVudClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChldmVudC50eXBlID09PSBcInRlc3Q6ZmluaXNoXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVwb3J0VGVzdEV2ZW50KGV2ZW50KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicnVuOmZpbmlzaFwiKSB0aGlzLnRlc3RSdW5uZXIucmVjb3JkUGFja2FnZVJlc3VsdChldmVudC5yZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgYXR0ZW1wdCBmYWlsdXJlL3JldHJ5IGV2ZW50cyB3aGlsZSByZXRhaW5pbmcgdGhlIHJhdyB0aHJvd24gdmFsdWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5SdW5uZXJFdmVudH0gZXZlbnQgLSBBdHRlbXB0IGV2ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsaXN0ZW5lcnMgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0QXR0ZW1wdEV2ZW50KGV2ZW50KSB7XG4gICAgY29uc3QgdGVzdCA9IHRoaXMuYWN0aXZlVGVzdCB8fCB0aGlzLnRlc3RSdW5uZXIuZmluZFRlc3REZWNsYXJhdGlvbihldmVudC5mdWxsTmFtZSlcblxuICAgIGlmICghdGVzdCkgdGhyb3cgbmV3IEVycm9yKGBQYWNrYWdlIHJ1bm5lciBhdHRlbXB0IGRpZCBub3QgbWF0Y2ggYSBkZWNsYXJhdGlvbjogJHtldmVudC5mdWxsTmFtZX1gKVxuXG4gICAgLy8gTmFycm93cyB0aGUgc3RydWN0dXJlZCBldmVudCBwYXlsb2FkIGZvciB0aGlzIGV2ZW50IGRpc2NyaW1pbmF0b3IuXG4gICAgY29uc3QgYXR0ZW1wdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0QXR0ZW1wdFJlc3VsdH0gKi8gKGV2ZW50LmF0dGVtcHQpXG4gICAgY29uc3Qgb3V0Y29tZSA9IHRoaXMudGVzdFJ1bm5lci5hdHRlbXB0T3V0Y29tZSh0ZXN0LCBhdHRlbXB0LmF0dGVtcHROdW1iZXIpXG4gICAgY29uc3QgYXR0ZW1wdENvbnNvbGVPdXRwdXRzID0gdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMuZ2V0KHRlc3QpIHx8IFtdXG5cbiAgICBpZiAoYXR0ZW1wdC5jb25zb2xlT3V0cHV0KSB7XG4gICAgICBhdHRlbXB0Q29uc29sZU91dHB1dHMucHVzaCh7YXR0ZW1wdE51bWJlcjogYXR0ZW1wdC5hdHRlbXB0TnVtYmVyLCBvdXRwdXQ6IGF0dGVtcHQuY29uc29sZU91dHB1dC50cmltRW5kKCl9KVxuICAgICAgdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMuc2V0KHRlc3QsIGF0dGVtcHRDb25zb2xlT3V0cHV0cylcbiAgICB9XG5cbiAgICBjb25zdCByZXRyeUNvdW50ID0gdGhpcy50ZXN0UnVubmVyLnJldHJ5Q291bnQodGVzdClcbiAgICBjb25zdCBmYWlsZWQgPSBvdXRjb21lPy5mYWlsZWQgPz8gQm9vbGVhbihhdHRlbXB0LmVycm9yKVxuICAgIGNvbnN0IGVycm9yID0gb3V0Y29tZT8uZXJyb3JcbiAgICBjb25zdCByZXRyaWVzVXNlZCA9IE1hdGgubWluKGF0dGVtcHQuYXR0ZW1wdE51bWJlciwgcmV0cnlDb3VudClcbiAgICBjb25zdCB3aWxsUmV0cnkgPSBmYWlsZWQgJiYgIW91dGNvbWU/LmFib3J0UmVtYWluaW5nVGVzdHMgJiYgYXR0ZW1wdC5hdHRlbXB0TnVtYmVyIDw9IHJldHJ5Q291bnRcbiAgICBjb25zdCB7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb259ID0gdGhpcy50ZXN0UnVubmVyLnRlc3RNZXRhZGF0YSh0ZXN0KVxuICAgIGNvbnN0IGNvbXBhdGliaWxpdHkgPSB0aGlzLnRlc3RSdW5uZXIudGVzdERhdGEodGVzdClcblxuICAgIGlmIChmYWlsZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdEF0dGVtcHRGYWlsZWRcIiwge1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLnRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBhdHRlbXB0TnVtYmVyOiBhdHRlbXB0LmF0dGVtcHROdW1iZXIsXG4gICAgICAgIG5leHRBdHRlbXB0OiB3aWxsUmV0cnkgPyBhdHRlbXB0LmF0dGVtcHROdW1iZXIgKyAxIDogdW5kZWZpbmVkLFxuICAgICAgICByZXRyaWVzVXNlZCxcbiAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgdGVzdEFyZ3M6IGNvbXBhdGliaWxpdHkudGVzdEFyZ3MsXG4gICAgICAgIHRlc3REYXRhOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLFxuICAgICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICAgIHRlc3RSdW5uZXI6IHRoaXMudGVzdFJ1bm5lcixcbiAgICAgICAgd2lsbFJldHJ5XG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh3aWxsUmV0cnkpIHtcbiAgICAgIGNvbnNvbGUud2FybihwaWNvY29sb3JzLnJlZChgJHtcIiBcIi5yZXBlYXQoZGVzY3JpcHRpb25zLmxlbmd0aCAqIDIpfSAgUmV0cnlpbmcgKCR7cmV0cmllc1VzZWR9LyR7cmV0cnlDb3VudH0pIGFmdGVyIGVycm9yOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKSlcbiAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdFJldHJ5aW5nXCIsIHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy50ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbmV4dEF0dGVtcHQ6IGF0dGVtcHQuYXR0ZW1wdE51bWJlciArIDEsXG4gICAgICAgIHJldHJpZXNVc2VkLFxuICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICB0ZXN0QXJnczogY29tcGF0aWJpbGl0eS50ZXN0QXJncyxcbiAgICAgICAgdGVzdERhdGE6IGNvbXBhdGliaWxpdHkudGVzdERhdGEsXG4gICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgdGVzdFJ1bm5lcjogdGhpcy50ZXN0UnVubmVyXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChhdHRlbXB0LmF0dGVtcHROdW1iZXIgPiAxKSB7XG4gICAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RSZXRyaWVkXCIsIHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy50ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgYXR0ZW1wdE51bWJlcjogYXR0ZW1wdC5hdHRlbXB0TnVtYmVyLFxuICAgICAgICByZXRyaWVzVXNlZCxcbiAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgdGVzdEFyZ3M6IGNvbXBhdGliaWxpdHkudGVzdEFyZ3MsXG4gICAgICAgIHRlc3REYXRhOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLFxuICAgICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICAgIHRlc3RSdW5uZXI6IHRoaXMudGVzdFJ1bm5lclxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAob3V0Y29tZT8uYWJvcnRSZW1haW5pbmdUZXN0cykge1xuICAgICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnRlc3RSdW5uZXIudGVzdE1ldGFkYXRhKHRlc3QpXG5cbiAgICAgIHRoaXMudGVzdFJ1bm5lci5yZWNvcmRUZXN0RHVyYXRpb24oe1xuICAgICAgICBkdXJhdGlvbk1zOiBhdHRlbXB0LmR1cmF0aW9uTXMsXG4gICAgICAgIGZpbGVQYXRoOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLmZpbGVQYXRoID8/IFwiPHVua25vd24+XCIsXG4gICAgICAgIGZ1bGxEZXNjcmlwdGlvbjogbWV0YWRhdGEuZnVsbERlc2NyaXB0aW9uLFxuICAgICAgICBsaW5lOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLmxpbmUgPz8gMFxuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMucmVwb3J0RmFpbGVkVGVzdCh7XG4gICAgICAgIGF0dGVtcHRDb25zb2xlT3V0cHV0cyxcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbGVmdFBhZGRpbmc6IFwiIFwiLnJlcGVhdChkZXNjcmlwdGlvbnMubGVuZ3RoICogMiksXG4gICAgICAgIHRlc3RBcmdzOiBjb21wYXRpYmlsaXR5LnRlc3RBcmdzLFxuICAgICAgICB0ZXN0RGF0YTogY29tcGF0aWJpbGl0eS50ZXN0RGF0YSxcbiAgICAgICAgdGVzdERlc2NyaXB0aW9uXG4gICAgICB9KVxuICAgICAgdGhpcy50ZXN0UnVubmVyLmNvbXBsZXRlVGVzdERlY2xhcmF0aW9uKHRlc3QpXG4gICAgICB0aGlzLmFjdGl2ZVRlc3QgPSB1bmRlZmluZWRcbiAgICAgIHRocm93IG5ldyBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IoXCJWZWxvY2lvdXMgcXVhcmFudGluZWQgYW4gYXR0ZW1wdC1vd25lZCBkYXRhYmFzZSBjb25uZWN0aW9uXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2plY3RzIGZpbmFsIHBhY2thZ2UgcmVzdWx0IGFjY291bnRpbmcgYW5kIGZhaWx1cmVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuUnVubmVyRXZlbnR9IGV2ZW50IC0gVGVzdCByZXN1bHQgZXZlbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGxpc3RlbmVycyBmaW5pc2guXG4gICAqL1xuICBhc3luYyByZXBvcnRUZXN0RXZlbnQoZXZlbnQpIHtcbiAgICAvLyBOYXJyb3dzIHRoZSBzdHJ1Y3R1cmVkIGV2ZW50IHBheWxvYWQgZm9yIHRoaXMgZXZlbnQgZGlzY3JpbWluYXRvci5cbiAgICBjb25zdCBwYWNrYWdlVGVzdFJlc3VsdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0UmVzdWx0fSAqLyAoZXZlbnQudGVzdClcbiAgICBjb25zdCB0ZXN0ID0gdGhpcy5hY3RpdmVUZXN0IHx8IHRoaXMudGVzdFJ1bm5lci5maW5kVGVzdERlY2xhcmF0aW9uKHBhY2thZ2VUZXN0UmVzdWx0LmZ1bGxOYW1lKVxuXG4gICAgaWYgKCF0ZXN0KSB0aHJvdyBuZXcgRXJyb3IoYFBhY2thZ2UgcnVubmVyIHJlc3VsdCBkaWQgbm90IG1hdGNoIGEgZGVjbGFyYXRpb246ICR7cGFja2FnZVRlc3RSZXN1bHQuZnVsbE5hbWV9YClcblxuICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy50ZXN0UnVubmVyLnRlc3RNZXRhZGF0YSh0ZXN0KVxuICAgIGNvbnN0IGNvbXBhdGliaWxpdHkgPSB0aGlzLnRlc3RSdW5uZXIudGVzdERhdGEodGVzdClcbiAgICBjb25zdCBkdXJhdGlvbk1zID0gcGFja2FnZVRlc3RSZXN1bHQuYXR0ZW1wdHMucmVkdWNlKCh0b3RhbCwgYXR0ZW1wdCkgPT4gdG90YWwgKyBhdHRlbXB0LmR1cmF0aW9uTXMsIDApXG5cbiAgICBpZiAocGFja2FnZVRlc3RSZXN1bHQuYXR0ZW1wdHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy50ZXN0UnVubmVyLnJlY29yZFRlc3REdXJhdGlvbih7XG4gICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgIGZpbGVQYXRoOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLmZpbGVQYXRoID8/IFwiPHVua25vd24+XCIsXG4gICAgICAgIGZ1bGxEZXNjcmlwdGlvbjogbWV0YWRhdGEuZnVsbERlc2NyaXB0aW9uLFxuICAgICAgICBsaW5lOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLmxpbmUgPz8gMFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAocGFja2FnZVRlc3RSZXN1bHQuc3RhdHVzID09PSBcInBhc3NlZFwiKSB7XG4gICAgICB0aGlzLnRlc3RSdW5uZXIucmVjb3JkU3VjY2Vzc2Z1bFRlc3QoKVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBmaW5hbEF0dGVtcHQgPSBwYWNrYWdlVGVzdFJlc3VsdC5hdHRlbXB0cy5hdCgtMSlcbiAgICAgIGNvbnN0IG91dGNvbWUgPSBmaW5hbEF0dGVtcHRcbiAgICAgICAgPyB0aGlzLnRlc3RSdW5uZXIuYXR0ZW1wdE91dGNvbWUodGVzdCwgZmluYWxBdHRlbXB0LmF0dGVtcHROdW1iZXIpXG4gICAgICAgIDogdW5kZWZpbmVkXG4gICAgICBjb25zdCBzZXR1cEZhaWx1cmUgPSB0aGlzLnRlc3RSdW5uZXIuc2V0dXBGYWlsdXJlT3V0Y29tZUZvcih0ZXN0KVxuICAgICAgY29uc3QgZXJyb3IgPSBvdXRjb21lPy5mYWlsZWRcbiAgICAgICAgPyBvdXRjb21lLmVycm9yXG4gICAgICAgIDogc2V0dXBGYWlsdXJlLmZhaWxlZFxuICAgICAgICAgID8gc2V0dXBGYWlsdXJlLmVycm9yXG4gICAgICAgICAgOiBwYWNrYWdlVGVzdFJlc3VsdC5lcnJvclxuICAgICAgICAgICAgPyBlcnJvckZyb21QYWNrYWdlUmVjb3JkKHBhY2thZ2VUZXN0UmVzdWx0LmVycm9yKVxuICAgICAgICAgICAgOiB1bmRlZmluZWRcblxuICAgICAgYXdhaXQgdGhpcy5yZXBvcnRGYWlsZWRUZXN0KHtcbiAgICAgICAgYXR0ZW1wdENvbnNvbGVPdXRwdXRzOiB0aGlzLmF0dGVtcHRDb25zb2xlT3V0cHV0cy5nZXQodGVzdCkgfHwgW10sXG4gICAgICAgIGRlc2NyaXB0aW9uczogbWV0YWRhdGEuZGVzY3JpcHRpb25zLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbGVmdFBhZGRpbmc6IFwiIFwiLnJlcGVhdChtZXRhZGF0YS5kZXNjcmlwdGlvbnMubGVuZ3RoICogMiksXG4gICAgICAgIHRlc3RBcmdzOiBjb21wYXRpYmlsaXR5LnRlc3RBcmdzLFxuICAgICAgICB0ZXN0RGF0YTogY29tcGF0aWJpbGl0eS50ZXN0RGF0YSxcbiAgICAgICAgdGVzdERlc2NyaXB0aW9uOiBtZXRhZGF0YS50ZXN0RGVzY3JpcHRpb25cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgdGhpcy50ZXN0UnVubmVyLmNvbXBsZXRlVGVzdERlY2xhcmF0aW9uKHRlc3QpXG4gICAgdGhpcy5hY3RpdmVUZXN0ID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbmQgZW1pdHMgb25lIGZpbmFsIGZhaWxlZCB0ZXN0IHJlc3VsdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGaW5hbCBmYWlsdXJlIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQXR0ZW1wdENvbnNvbGVPdXRwdXRbXX0gYXJncy5hdHRlbXB0Q29uc29sZU91dHB1dHMgLSBDYXB0dXJlZCBvdXRwdXQgYWNyb3NzIGF0dGVtcHRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIFBhcmVudCBkZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJhdyBmaW5hbCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIENvbnNvbGUgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UZXN0QXJnc30gYXJncy50ZXN0QXJncyAtIFN0YWJsZSB0ZXN0IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCByZWdpc3RyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBmaW5hbC1mYWlsdXJlIGxpc3RlbmVyIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHJlcG9ydEZhaWxlZFRlc3Qoe2F0dGVtcHRDb25zb2xlT3V0cHV0cywgZGVzY3JpcHRpb25zLCBlcnJvciwgbGVmdFBhZGRpbmcsIHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9ufSkge1xuICAgIGNvbnN0IHRlc3RSdW5uZXIgPSB0aGlzLnRlc3RSdW5uZXJcbiAgICBjb25zdCBjb25zb2xlT3V0cHV0ID0gdGVzdFJ1bm5lci5idWlsZENvbnNvbGVPdXRwdXQoYXR0ZW1wdENvbnNvbGVPdXRwdXRzKVxuXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICBUZXN0IGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApKVxuICAgICAgYWRkVHJhY2tlZFN0YWNrVG9FcnJvcihlcnJvcilcblxuICAgICAgY29uc3QgYmFja3RyYWNlQ2xlYW5lciA9IG5ldyBCYWNrdHJhY2VDbGVhbmVyKGVycm9yKVxuICAgICAgY29uc3QgY2xlYW5lZFN0YWNrID0gYmFja3RyYWNlQ2xlYW5lci5nZXRDbGVhbmVkU3RhY2soKVxuICAgICAgY29uc3Qgc3RhY2tMaW5lcyA9IGNsZWFuZWRTdGFjaz8uc3BsaXQoXCJcXG5cIilcblxuICAgICAgaWYgKHN0YWNrTGluZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBzdGFja0xpbmUgb2Ygc3RhY2tMaW5lcykgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gICR7c3RhY2tMaW5lfWApKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgVGVzdCBmYWlsZWQgd2l0aCBhICR7dHlwZW9mIGVycm9yfTogJHtTdHJpbmcoZXJyb3IpfWApKVxuICAgIH1cblxuICAgIHRlc3RSdW5uZXIucHJpbnRGYWlsZWRDb25zb2xlT3V0cHV0KHtjb25zb2xlT3V0cHV0LCBsZWZ0UGFkZGluZ30pXG4gICAgdGVzdFJ1bm5lci5yZWNvcmRGYWlsZWRUZXN0KHtkZXNjcmlwdGlvbnMsIGVycm9yLCBjb25zb2xlT3V0cHV0LCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9ufSlcblxuICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdEZhaWxlZFwiLCB7XG4gICAgICBjb25maWd1cmF0aW9uOiB0ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgIGVycm9yLFxuICAgICAgdGVzdEFyZ3MsXG4gICAgICB0ZXN0RGF0YSxcbiAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgIHRlc3RSdW5uZXJcbiAgICB9KVxuXG4gICAgdGVzdFJ1bm5lci5wcmludFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhLCBsZWZ0UGFkZGluZ30pXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgb25lIGxlZ2FjeSBldmVudCBhbmQgYXdhaXRzIGxpc3RlbmVycyBpbiByZWdpc3RyYXRpb24gb3JkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudE5hbWUgLSBFdmVudCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gcGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGxpc3RlbmVycyBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpIHtcbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIHRlc3RFdmVudHMubGlzdGVuZXJzKGV2ZW50TmFtZSkpIGF3YWl0IGxpc3RlbmVyKHBheWxvYWQpXG4gIH1cbn1cbiJdfQ==