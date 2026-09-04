// @ts-check
import { addTrackedStackToError } from "../utils/with-tracked-stack.js";
import BacktraceCleaner from "../utils/backtrace-cleaner-node.js";
import picocolors from "picocolors";
import restArgsError from "../utils/rest-args-error.js";
import { testEvents } from "./test.js";
/** @typedef {import("@velocious/testing/runner").TestDeclaration} PackageTestDeclaration */
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
            const error = outcome?.failed
                ? outcome.error
                : this.testRunner.setupFailureFor(test);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXJ1bm5lci1yZXBvcnRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3ZlbG9jaW91cy1ydW5uZXItcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxNQUFNLGdDQUFnQyxDQUFBO0FBQ3ZFLE9BQU8sZ0JBQWdCLE1BQU0sb0NBQW9DLENBQUE7QUFDakUsT0FBTyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ25DLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxXQUFXLENBQUE7QUFFdEMsNEZBQTRGO0FBRTVGLDJFQUEyRTtBQUMzRSxNQUFNLE9BQU8sd0JBQXlCLFNBQVEsS0FBSztDQUFHO0FBRXRELE1BQU0sQ0FBQyxPQUFPLE9BQU8sdUJBQXVCO0lBQzFDOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsVUFBVSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ25DLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN2QixJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtRQUM1QixpR0FBaUc7UUFDakcsSUFBSSxDQUFDLHFCQUFxQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7UUFDMUMsaURBQWlEO1FBQ2pELElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLO1FBQ2pCLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxZQUFZLEVBQUUsQ0FBQztZQUNoQyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsbUJBQW1CLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQ3JFLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUNw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QUF3QixPQUFPLEtBQUssS0FBSyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDdkcsQ0FBQztRQUVELFVBQVUsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQ2pFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLFlBQVksRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO1FBRTVGLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLEVBQUU7WUFDakMsYUFBYSxFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRTtZQUM1QyxZQUFZO1lBQ1osS0FBSztZQUNMLFFBQVE7WUFDUixRQUFRO1lBQ1IsZUFBZTtZQUNmLFVBQVU7U0FDWCxDQUFDLENBQUE7UUFFRixVQUFVLENBQUMsaUJBQWlCLENBQUMsRUFBQyxZQUFZLEVBQUUsZUFBZSxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO0lBQ3RGLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsU0FBUyxFQUFFLE9BQU87UUFDaEMsS0FBSyxNQUFNLFFBQVEsSUFBSSxVQUFVLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQztZQUFFLE1BQU0sUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQ2pGLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBhZGRUcmFja2VkU3RhY2tUb0Vycm9yIH0gZnJvbSBcIi4uL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay5qc1wiXG5pbXBvcnQgQmFja3RyYWNlQ2xlYW5lciBmcm9tIFwiLi4vdXRpbHMvYmFja3RyYWNlLWNsZWFuZXItbm9kZS5qc1wiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IHRlc3RFdmVudHMgfSBmcm9tIFwiLi90ZXN0LmpzXCJcblxuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3REZWNsYXJhdGlvbn0gUGFja2FnZVRlc3REZWNsYXJhdGlvbiAqL1xuXG4vKiogU3RvcHMgcGFja2FnZSB0cmF2ZXJzYWwgYWZ0ZXIgZnJhbWV3b3JrLW93bmVkIGNvbm5lY3Rpb24gcXVhcmFudGluZS4gKi9cbmV4cG9ydCBjbGFzcyBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBsZWdhY3kgZXZlbnQgYW5kIHJlc3VsdCBwcm9qZWN0aW9uIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuZGVmYXVsdH0gYXJncy50ZXN0UnVubmVyIC0gT3duaW5nIFZlbG9jaW91cyBydW5uZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGVzdFJ1bm5lciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB0aGlzLnRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIGltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQXR0ZW1wdENvbnNvbGVPdXRwdXRbXT59ICovXG4gICAgdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuYWN0aXZlVGVzdCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFRyYW5zbGF0ZXMgb25lIGF3YWl0ZWQgcGFja2FnZSBydW5uZXIgZXZlbnQgaW50byB0aGUgbGVnYWN5IGNvbnRyYWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuUnVubmVyRXZlbnR9IGV2ZW50IC0gU3RydWN0dXJlZCBwYWNrYWdlIGV2ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsZWdhY3kgbGlzdGVuZXJzIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIG9uRXZlbnQoZXZlbnQpIHtcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXN0OnN0YXJ0XCIpIHtcbiAgICAgIHRoaXMuYWN0aXZlVGVzdCA9IHRoaXMudGVzdFJ1bm5lci5maW5kVGVzdERlY2xhcmF0aW9uKGV2ZW50LmZ1bGxOYW1lKVxuICAgICAgaWYgKHRoaXMuYWN0aXZlVGVzdCkge1xuICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMudGVzdFJ1bm5lci50ZXN0TWV0YWRhdGEodGhpcy5hY3RpdmVUZXN0KVxuICAgICAgICBjb25zb2xlLmxvZyhgJHtcIiBcIi5yZXBlYXQobWV0YWRhdGEuZGVzY3JpcHRpb25zLmxlbmd0aCAqIDIpfWl0ICR7bWV0YWRhdGEudGVzdERlc2NyaXB0aW9ufWApXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJhdHRlbXB0OmZpbmlzaFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlcG9ydEF0dGVtcHRFdmVudChldmVudClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChldmVudC50eXBlID09PSBcInRlc3Q6ZmluaXNoXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVwb3J0VGVzdEV2ZW50KGV2ZW50KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicnVuOmZpbmlzaFwiKSB0aGlzLnRlc3RSdW5uZXIucmVjb3JkUGFja2FnZVJlc3VsdChldmVudC5yZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgYXR0ZW1wdCBmYWlsdXJlL3JldHJ5IGV2ZW50cyB3aGlsZSByZXRhaW5pbmcgdGhlIHJhdyB0aHJvd24gdmFsdWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5SdW5uZXJFdmVudH0gZXZlbnQgLSBBdHRlbXB0IGV2ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsaXN0ZW5lcnMgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0QXR0ZW1wdEV2ZW50KGV2ZW50KSB7XG4gICAgY29uc3QgdGVzdCA9IHRoaXMuYWN0aXZlVGVzdCB8fCB0aGlzLnRlc3RSdW5uZXIuZmluZFRlc3REZWNsYXJhdGlvbihldmVudC5mdWxsTmFtZSlcblxuICAgIGlmICghdGVzdCkgdGhyb3cgbmV3IEVycm9yKGBQYWNrYWdlIHJ1bm5lciBhdHRlbXB0IGRpZCBub3QgbWF0Y2ggYSBkZWNsYXJhdGlvbjogJHtldmVudC5mdWxsTmFtZX1gKVxuXG4gICAgLy8gTmFycm93cyB0aGUgc3RydWN0dXJlZCBldmVudCBwYXlsb2FkIGZvciB0aGlzIGV2ZW50IGRpc2NyaW1pbmF0b3IuXG4gICAgY29uc3QgYXR0ZW1wdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0QXR0ZW1wdFJlc3VsdH0gKi8gKGV2ZW50LmF0dGVtcHQpXG4gICAgY29uc3Qgb3V0Y29tZSA9IHRoaXMudGVzdFJ1bm5lci5hdHRlbXB0T3V0Y29tZSh0ZXN0LCBhdHRlbXB0LmF0dGVtcHROdW1iZXIpXG4gICAgY29uc3QgYXR0ZW1wdENvbnNvbGVPdXRwdXRzID0gdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMuZ2V0KHRlc3QpIHx8IFtdXG5cbiAgICBpZiAoYXR0ZW1wdC5jb25zb2xlT3V0cHV0KSB7XG4gICAgICBhdHRlbXB0Q29uc29sZU91dHB1dHMucHVzaCh7YXR0ZW1wdE51bWJlcjogYXR0ZW1wdC5hdHRlbXB0TnVtYmVyLCBvdXRwdXQ6IGF0dGVtcHQuY29uc29sZU91dHB1dC50cmltRW5kKCl9KVxuICAgICAgdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMuc2V0KHRlc3QsIGF0dGVtcHRDb25zb2xlT3V0cHV0cylcbiAgICB9XG5cbiAgICBjb25zdCByZXRyeUNvdW50ID0gdGhpcy50ZXN0UnVubmVyLnJldHJ5Q291bnQodGVzdClcbiAgICBjb25zdCBmYWlsZWQgPSBvdXRjb21lPy5mYWlsZWQgPz8gQm9vbGVhbihhdHRlbXB0LmVycm9yKVxuICAgIGNvbnN0IGVycm9yID0gb3V0Y29tZT8uZXJyb3JcbiAgICBjb25zdCByZXRyaWVzVXNlZCA9IE1hdGgubWluKGF0dGVtcHQuYXR0ZW1wdE51bWJlciwgcmV0cnlDb3VudClcbiAgICBjb25zdCB3aWxsUmV0cnkgPSBmYWlsZWQgJiYgIW91dGNvbWU/LmFib3J0UmVtYWluaW5nVGVzdHMgJiYgYXR0ZW1wdC5hdHRlbXB0TnVtYmVyIDw9IHJldHJ5Q291bnRcbiAgICBjb25zdCB7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb259ID0gdGhpcy50ZXN0UnVubmVyLnRlc3RNZXRhZGF0YSh0ZXN0KVxuICAgIGNvbnN0IGNvbXBhdGliaWxpdHkgPSB0aGlzLnRlc3RSdW5uZXIudGVzdERhdGEodGVzdClcblxuICAgIGlmIChmYWlsZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdEF0dGVtcHRGYWlsZWRcIiwge1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLnRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBhdHRlbXB0TnVtYmVyOiBhdHRlbXB0LmF0dGVtcHROdW1iZXIsXG4gICAgICAgIG5leHRBdHRlbXB0OiB3aWxsUmV0cnkgPyBhdHRlbXB0LmF0dGVtcHROdW1iZXIgKyAxIDogdW5kZWZpbmVkLFxuICAgICAgICByZXRyaWVzVXNlZCxcbiAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgdGVzdEFyZ3M6IGNvbXBhdGliaWxpdHkudGVzdEFyZ3MsXG4gICAgICAgIHRlc3REYXRhOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLFxuICAgICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICAgIHRlc3RSdW5uZXI6IHRoaXMudGVzdFJ1bm5lcixcbiAgICAgICAgd2lsbFJldHJ5XG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh3aWxsUmV0cnkpIHtcbiAgICAgIGNvbnNvbGUud2FybihwaWNvY29sb3JzLnJlZChgJHtcIiBcIi5yZXBlYXQoZGVzY3JpcHRpb25zLmxlbmd0aCAqIDIpfSAgUmV0cnlpbmcgKCR7cmV0cmllc1VzZWR9LyR7cmV0cnlDb3VudH0pIGFmdGVyIGVycm9yOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKSlcbiAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdFJldHJ5aW5nXCIsIHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy50ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbmV4dEF0dGVtcHQ6IGF0dGVtcHQuYXR0ZW1wdE51bWJlciArIDEsXG4gICAgICAgIHJldHJpZXNVc2VkLFxuICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICB0ZXN0QXJnczogY29tcGF0aWJpbGl0eS50ZXN0QXJncyxcbiAgICAgICAgdGVzdERhdGE6IGNvbXBhdGliaWxpdHkudGVzdERhdGEsXG4gICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgdGVzdFJ1bm5lcjogdGhpcy50ZXN0UnVubmVyXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChhdHRlbXB0LmF0dGVtcHROdW1iZXIgPiAxKSB7XG4gICAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RSZXRyaWVkXCIsIHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy50ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgYXR0ZW1wdE51bWJlcjogYXR0ZW1wdC5hdHRlbXB0TnVtYmVyLFxuICAgICAgICByZXRyaWVzVXNlZCxcbiAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgdGVzdEFyZ3M6IGNvbXBhdGliaWxpdHkudGVzdEFyZ3MsXG4gICAgICAgIHRlc3REYXRhOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLFxuICAgICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICAgIHRlc3RSdW5uZXI6IHRoaXMudGVzdFJ1bm5lclxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAob3V0Y29tZT8uYWJvcnRSZW1haW5pbmdUZXN0cykge1xuICAgICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnRlc3RSdW5uZXIudGVzdE1ldGFkYXRhKHRlc3QpXG5cbiAgICAgIHRoaXMudGVzdFJ1bm5lci5yZWNvcmRUZXN0RHVyYXRpb24oe1xuICAgICAgICBkdXJhdGlvbk1zOiBhdHRlbXB0LmR1cmF0aW9uTXMsXG4gICAgICAgIGZpbGVQYXRoOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLmZpbGVQYXRoID8/IFwiPHVua25vd24+XCIsXG4gICAgICAgIGZ1bGxEZXNjcmlwdGlvbjogbWV0YWRhdGEuZnVsbERlc2NyaXB0aW9uLFxuICAgICAgICBsaW5lOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLmxpbmUgPz8gMFxuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMucmVwb3J0RmFpbGVkVGVzdCh7XG4gICAgICAgIGF0dGVtcHRDb25zb2xlT3V0cHV0cyxcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbGVmdFBhZGRpbmc6IFwiIFwiLnJlcGVhdChkZXNjcmlwdGlvbnMubGVuZ3RoICogMiksXG4gICAgICAgIHRlc3RBcmdzOiBjb21wYXRpYmlsaXR5LnRlc3RBcmdzLFxuICAgICAgICB0ZXN0RGF0YTogY29tcGF0aWJpbGl0eS50ZXN0RGF0YSxcbiAgICAgICAgdGVzdERlc2NyaXB0aW9uXG4gICAgICB9KVxuICAgICAgdGhpcy50ZXN0UnVubmVyLmNvbXBsZXRlVGVzdERlY2xhcmF0aW9uKHRlc3QpXG4gICAgICB0aGlzLmFjdGl2ZVRlc3QgPSB1bmRlZmluZWRcbiAgICAgIHRocm93IG5ldyBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IoXCJWZWxvY2lvdXMgcXVhcmFudGluZWQgYW4gYXR0ZW1wdC1vd25lZCBkYXRhYmFzZSBjb25uZWN0aW9uXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2plY3RzIGZpbmFsIHBhY2thZ2UgcmVzdWx0IGFjY291bnRpbmcgYW5kIGZhaWx1cmVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuUnVubmVyRXZlbnR9IGV2ZW50IC0gVGVzdCByZXN1bHQgZXZlbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGxpc3RlbmVycyBmaW5pc2guXG4gICAqL1xuICBhc3luYyByZXBvcnRUZXN0RXZlbnQoZXZlbnQpIHtcbiAgICAvLyBOYXJyb3dzIHRoZSBzdHJ1Y3R1cmVkIGV2ZW50IHBheWxvYWQgZm9yIHRoaXMgZXZlbnQgZGlzY3JpbWluYXRvci5cbiAgICBjb25zdCBwYWNrYWdlVGVzdFJlc3VsdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0UmVzdWx0fSAqLyAoZXZlbnQudGVzdClcbiAgICBjb25zdCB0ZXN0ID0gdGhpcy5hY3RpdmVUZXN0IHx8IHRoaXMudGVzdFJ1bm5lci5maW5kVGVzdERlY2xhcmF0aW9uKHBhY2thZ2VUZXN0UmVzdWx0LmZ1bGxOYW1lKVxuXG4gICAgaWYgKCF0ZXN0KSB0aHJvdyBuZXcgRXJyb3IoYFBhY2thZ2UgcnVubmVyIHJlc3VsdCBkaWQgbm90IG1hdGNoIGEgZGVjbGFyYXRpb246ICR7cGFja2FnZVRlc3RSZXN1bHQuZnVsbE5hbWV9YClcblxuICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy50ZXN0UnVubmVyLnRlc3RNZXRhZGF0YSh0ZXN0KVxuICAgIGNvbnN0IGNvbXBhdGliaWxpdHkgPSB0aGlzLnRlc3RSdW5uZXIudGVzdERhdGEodGVzdClcbiAgICBjb25zdCBkdXJhdGlvbk1zID0gcGFja2FnZVRlc3RSZXN1bHQuYXR0ZW1wdHMucmVkdWNlKCh0b3RhbCwgYXR0ZW1wdCkgPT4gdG90YWwgKyBhdHRlbXB0LmR1cmF0aW9uTXMsIDApXG5cbiAgICBpZiAocGFja2FnZVRlc3RSZXN1bHQuYXR0ZW1wdHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy50ZXN0UnVubmVyLnJlY29yZFRlc3REdXJhdGlvbih7XG4gICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgIGZpbGVQYXRoOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLmZpbGVQYXRoID8/IFwiPHVua25vd24+XCIsXG4gICAgICAgIGZ1bGxEZXNjcmlwdGlvbjogbWV0YWRhdGEuZnVsbERlc2NyaXB0aW9uLFxuICAgICAgICBsaW5lOiBjb21wYXRpYmlsaXR5LnRlc3REYXRhLmxpbmUgPz8gMFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAocGFja2FnZVRlc3RSZXN1bHQuc3RhdHVzID09PSBcInBhc3NlZFwiKSB7XG4gICAgICB0aGlzLnRlc3RSdW5uZXIucmVjb3JkU3VjY2Vzc2Z1bFRlc3QoKVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBmaW5hbEF0dGVtcHQgPSBwYWNrYWdlVGVzdFJlc3VsdC5hdHRlbXB0cy5hdCgtMSlcbiAgICAgIGNvbnN0IG91dGNvbWUgPSBmaW5hbEF0dGVtcHRcbiAgICAgICAgPyB0aGlzLnRlc3RSdW5uZXIuYXR0ZW1wdE91dGNvbWUodGVzdCwgZmluYWxBdHRlbXB0LmF0dGVtcHROdW1iZXIpXG4gICAgICAgIDogdW5kZWZpbmVkXG4gICAgICBjb25zdCBlcnJvciA9IG91dGNvbWU/LmZhaWxlZFxuICAgICAgICA/IG91dGNvbWUuZXJyb3JcbiAgICAgICAgOiB0aGlzLnRlc3RSdW5uZXIuc2V0dXBGYWlsdXJlRm9yKHRlc3QpXG5cbiAgICAgIGF3YWl0IHRoaXMucmVwb3J0RmFpbGVkVGVzdCh7XG4gICAgICAgIGF0dGVtcHRDb25zb2xlT3V0cHV0czogdGhpcy5hdHRlbXB0Q29uc29sZU91dHB1dHMuZ2V0KHRlc3QpIHx8IFtdLFxuICAgICAgICBkZXNjcmlwdGlvbnM6IG1ldGFkYXRhLmRlc2NyaXB0aW9ucyxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGxlZnRQYWRkaW5nOiBcIiBcIi5yZXBlYXQobWV0YWRhdGEuZGVzY3JpcHRpb25zLmxlbmd0aCAqIDIpLFxuICAgICAgICB0ZXN0QXJnczogY29tcGF0aWJpbGl0eS50ZXN0QXJncyxcbiAgICAgICAgdGVzdERhdGE6IGNvbXBhdGliaWxpdHkudGVzdERhdGEsXG4gICAgICAgIHRlc3REZXNjcmlwdGlvbjogbWV0YWRhdGEudGVzdERlc2NyaXB0aW9uXG4gICAgICB9KVxuICAgIH1cblxuICAgIHRoaXMudGVzdFJ1bm5lci5jb21wbGV0ZVRlc3REZWNsYXJhdGlvbih0ZXN0KVxuICAgIHRoaXMuYWN0aXZlVGVzdCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYW5kIGVtaXRzIG9uZSBmaW5hbCBmYWlsZWQgdGVzdCByZXN1bHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmluYWwgZmFpbHVyZSBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkF0dGVtcHRDb25zb2xlT3V0cHV0W119IGFyZ3MuYXR0ZW1wdENvbnNvbGVPdXRwdXRzIC0gQ2FwdHVyZWQgb3V0cHV0IGFjcm9zcyBhdHRlbXB0cy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBQYXJlbnQgZGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBSYXcgZmluYWwgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBDb25zb2xlIGluZGVudGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuVGVzdEFyZ3N9IGFyZ3MudGVzdEFyZ3MgLSBTdGFibGUgdGVzdCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgcmVnaXN0cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZmluYWwtZmFpbHVyZSBsaXN0ZW5lciBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyByZXBvcnRGYWlsZWRUZXN0KHthdHRlbXB0Q29uc29sZU91dHB1dHMsIGRlc2NyaXB0aW9ucywgZXJyb3IsIGxlZnRQYWRkaW5nLCB0ZXN0QXJncywgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbn0pIHtcbiAgICBjb25zdCB0ZXN0UnVubmVyID0gdGhpcy50ZXN0UnVubmVyXG4gICAgY29uc3QgY29uc29sZU91dHB1dCA9IHRlc3RSdW5uZXIuYnVpbGRDb25zb2xlT3V0cHV0KGF0dGVtcHRDb25zb2xlT3V0cHV0cylcblxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgVGVzdCBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKSlcbiAgICAgIGFkZFRyYWNrZWRTdGFja1RvRXJyb3IoZXJyb3IpXG5cbiAgICAgIGNvbnN0IGJhY2t0cmFjZUNsZWFuZXIgPSBuZXcgQmFja3RyYWNlQ2xlYW5lcihlcnJvcilcbiAgICAgIGNvbnN0IGNsZWFuZWRTdGFjayA9IGJhY2t0cmFjZUNsZWFuZXIuZ2V0Q2xlYW5lZFN0YWNrKClcbiAgICAgIGNvbnN0IHN0YWNrTGluZXMgPSBjbGVhbmVkU3RhY2s/LnNwbGl0KFwiXFxuXCIpXG5cbiAgICAgIGlmIChzdGFja0xpbmVzKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc3RhY2tMaW5lIG9mIHN0YWNrTGluZXMpIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICAke3N0YWNrTGluZX1gKSlcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIFRlc3QgZmFpbGVkIHdpdGggYSAke3R5cGVvZiBlcnJvcn06ICR7U3RyaW5nKGVycm9yKX1gKSlcbiAgICB9XG5cbiAgICB0ZXN0UnVubmVyLnByaW50RmFpbGVkQ29uc29sZU91dHB1dCh7Y29uc29sZU91dHB1dCwgbGVmdFBhZGRpbmd9KVxuICAgIHRlc3RSdW5uZXIucmVjb3JkRmFpbGVkVGVzdCh7ZGVzY3JpcHRpb25zLCBlcnJvciwgY29uc29sZU91dHB1dCwgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbn0pXG5cbiAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RGYWlsZWRcIiwge1xuICAgICAgY29uZmlndXJhdGlvbjogdGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICBlcnJvcixcbiAgICAgIHRlc3RBcmdzLFxuICAgICAgdGVzdERhdGEsXG4gICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICB0ZXN0UnVubmVyXG4gICAgfSlcblxuICAgIHRlc3RSdW5uZXIucHJpbnRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YSwgbGVmdFBhZGRpbmd9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIG9uZSBsZWdhY3kgZXZlbnQgYW5kIGF3YWl0cyBsaXN0ZW5lcnMgaW4gcmVnaXN0cmF0aW9uIG9yZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnROYW1lIC0gRXZlbnQgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IHBheWxvYWQgLSBFdmVudCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGFsbCBsaXN0ZW5lcnMgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlbWl0RXZlbnQoZXZlbnROYW1lLCBwYXlsb2FkKSB7XG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiB0ZXN0RXZlbnRzLmxpc3RlbmVycyhldmVudE5hbWUpKSBhd2FpdCBsaXN0ZW5lcihwYXlsb2FkKVxuICB9XG59XG4iXX0=