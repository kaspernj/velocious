// @ts-check
import { addTrackedStackToError } from "../utils/with-tracked-stack.js";
import BacktraceCleaner from "../utils/backtrace-cleaner-node.js";
import picocolors from "picocolors";
import restArgsError from "../utils/rest-args-error.js";
import { testEvents } from "./test.js";
export default class VelociousRunnerReporter {
    /**
     * Creates the legacy event and result projection adapter.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }) {
        restArgsError(restArgs);
        this.testRunner = testRunner;
    }
    /**
     * Projects one completed attempt into legacy events and final result accounting.
     * Retry eligibility is decided by the caller before this method runs.
     * @param {object} args - Completed attempt and retry metadata.
     * @param {import("./test-runner.js").AttemptConsoleOutput[]} args.attemptConsoleOutputs - Captured output across attempts.
     * @param {number} args.attemptNumber - Current one-based attempt.
     * @param {string[]} args.descriptions - Parent description stack.
     * @param {ReturnType<typeof JSON.parse>} args.error - Raw thrown or rejected value.
     * @param {boolean} args.failed - Whether the attempt failed, independently of error truthiness.
     * @param {string} args.leftPadding - Console indentation.
     * @param {number} args.retriesUsed - Retry count consumed after this attempt.
     * @param {number} args.retryCount - Configured retry limit.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
     * @param {string} args.testDescription - Test description.
     * @param {boolean} args.willRetry - Whether the legacy loop will run another attempt.
     * @returns {Promise<void>} - Resolves after all legacy listeners complete.
     */
    async reportAttempt({ attemptConsoleOutputs, attemptNumber, descriptions, error, failed, leftPadding, retriesUsed, retryCount, testArgs, testData, testDescription, willRetry, ...restArgs }) {
        restArgsError(restArgs);
        const testRunner = this.testRunner;
        if (!failed)
            testRunner._successfulTests++;
        if (failed) {
            await this.emitEvent("testAttemptFailed", {
                configuration: testRunner.getConfiguration(),
                descriptions,
                error,
                attemptNumber,
                nextAttempt: willRetry ? attemptNumber + 1 : undefined,
                retriesUsed,
                retryCount,
                testArgs,
                testData,
                testDescription,
                testRunner,
                willRetry
            });
        }
        if (willRetry) {
            console.warn(picocolors.red(`${leftPadding}  Retrying (${retriesUsed}/${retryCount}) after error: ${error instanceof Error ? error.message : String(error)}`));
            await this.emitEvent("testRetrying", {
                configuration: testRunner.getConfiguration(),
                descriptions,
                error,
                nextAttempt: attemptNumber + 1,
                retriesUsed,
                retryCount,
                testArgs,
                testData,
                testDescription,
                testRunner
            });
        }
        if (attemptNumber > 1) {
            await this.emitEvent("testRetried", {
                configuration: testRunner.getConfiguration(),
                descriptions,
                error,
                attemptNumber,
                retriesUsed,
                retryCount,
                testArgs,
                testData,
                testDescription,
                testRunner
            });
        }
        if (failed && !willRetry) {
            await this.reportFailedTest({ attemptConsoleOutputs, descriptions, error, leftPadding, testArgs, testData, testDescription });
        }
    }
    /**
     * Records and emits one final failed test result.
     * @param {object} args - Final failure metadata.
     * @param {import("./test-runner.js").AttemptConsoleOutput[]} args.attemptConsoleOutputs - Captured output across attempts.
     * @param {string[]} args.descriptions - Parent description stack.
     * @param {ReturnType<typeof JSON.parse>} args.error - Raw final failure.
     * @param {string} args.leftPadding - Console indentation.
     * @param {import("./velocious-test-arguments.js").TestArgs} args.testArgs - Stable test arguments.
     * @param {import("./velocious-test-arguments.js").TestData} args.testData - Test registration.
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
                for (const stackLine of stackLines) {
                    console.error(picocolors.red(`${leftPadding}  ${stackLine}`));
                }
            }
        }
        else {
            console.error(picocolors.red(`${leftPadding}  Test failed with a ${typeof error}: ${String(error)}`));
        }
        testRunner.printFailedConsoleOutput({ consoleOutput, leftPadding });
        testRunner._failedTests++;
        testRunner._failedTestDetails.push({
            fullDescription: testRunner.buildFullDescription(descriptions, testDescription),
            filePath: testData.filePath,
            line: testData.line,
            error,
            consoleOutput: consoleOutput || undefined
        });
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
        const listeners = testEvents.listeners(eventName);
        for (const listener of listeners) {
            await listener(payload);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXJ1bm5lci1yZXBvcnRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3ZlbG9jaW91cy1ydW5uZXItcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxNQUFNLGdDQUFnQyxDQUFBO0FBQ3ZFLE9BQU8sZ0JBQWdCLE1BQU0sb0NBQW9DLENBQUE7QUFDakUsT0FBTyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ25DLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxXQUFXLENBQUE7QUFFdEMsTUFBTSxDQUFDLE9BQU8sT0FBTyx1QkFBdUI7SUFDMUM7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxVQUFVLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDbkMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FpQkc7SUFDSCxLQUFLLENBQUMsYUFBYSxDQUFDLEVBQUMscUJBQXFCLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUN4TCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDdkIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQTtRQUVsQyxJQUFJLENBQUMsTUFBTTtZQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRTFDLElBQUksTUFBTSxFQUFFLENBQUM7WUFDWCxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEVBQUU7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QUMsT0FBTyxDQUFDLENBQUE7UUFDekIsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBhZGRUcmFja2VkU3RhY2tUb0Vycm9yIH0gZnJvbSBcIi4uL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay5qc1wiXG5pbXBvcnQgQmFja3RyYWNlQ2xlYW5lciBmcm9tIFwiLi4vdXRpbHMvYmFja3RyYWNlLWNsZWFuZXItbm9kZS5qc1wiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IHRlc3RFdmVudHMgfSBmcm9tIFwiLi90ZXN0LmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzUnVubmVyUmVwb3J0ZXIge1xuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgbGVnYWN5IGV2ZW50IGFuZCByZXN1bHQgcHJvamVjdGlvbiBhZGFwdGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvbnN0cnVjdG9yIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLmRlZmF1bHR9IGFyZ3MudGVzdFJ1bm5lciAtIE93bmluZyBWZWxvY2lvdXMgcnVubmVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe3Rlc3RSdW5uZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgdGhpcy50ZXN0UnVubmVyID0gdGVzdFJ1bm5lclxuICB9XG5cbiAgLyoqXG4gICAqIFByb2plY3RzIG9uZSBjb21wbGV0ZWQgYXR0ZW1wdCBpbnRvIGxlZ2FjeSBldmVudHMgYW5kIGZpbmFsIHJlc3VsdCBhY2NvdW50aW5nLlxuICAgKiBSZXRyeSBlbGlnaWJpbGl0eSBpcyBkZWNpZGVkIGJ5IHRoZSBjYWxsZXIgYmVmb3JlIHRoaXMgbWV0aG9kIHJ1bnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29tcGxldGVkIGF0dGVtcHQgYW5kIHJldHJ5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQXR0ZW1wdENvbnNvbGVPdXRwdXRbXX0gYXJncy5hdHRlbXB0Q29uc29sZU91dHB1dHMgLSBDYXB0dXJlZCBvdXRwdXQgYWNyb3NzIGF0dGVtcHRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5hdHRlbXB0TnVtYmVyIC0gQ3VycmVudCBvbmUtYmFzZWQgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBQYXJlbnQgZGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBSYXcgdGhyb3duIG9yIHJlamVjdGVkIHZhbHVlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuZmFpbGVkIC0gV2hldGhlciB0aGUgYXR0ZW1wdCBmYWlsZWQsIGluZGVwZW5kZW50bHkgb2YgZXJyb3IgdHJ1dGhpbmVzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBDb25zb2xlIGluZGVudGF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZXRyaWVzVXNlZCAtIFJldHJ5IGNvdW50IGNvbnN1bWVkIGFmdGVyIHRoaXMgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucmV0cnlDb3VudCAtIENvbmZpZ3VyZWQgcmV0cnkgbGltaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIikuVGVzdEFyZ3N9IGFyZ3MudGVzdEFyZ3MgLSBTdGFibGUgdGVzdCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIikuVGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IHJlZ2lzdHJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLndpbGxSZXRyeSAtIFdoZXRoZXIgdGhlIGxlZ2FjeSBsb29wIHdpbGwgcnVuIGFub3RoZXIgYXR0ZW1wdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIGxlZ2FjeSBsaXN0ZW5lcnMgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZXBvcnRBdHRlbXB0KHthdHRlbXB0Q29uc29sZU91dHB1dHMsIGF0dGVtcHROdW1iZXIsIGRlc2NyaXB0aW9ucywgZXJyb3IsIGZhaWxlZCwgbGVmdFBhZGRpbmcsIHJldHJpZXNVc2VkLCByZXRyeUNvdW50LCB0ZXN0QXJncywgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbiwgd2lsbFJldHJ5LCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGNvbnN0IHRlc3RSdW5uZXIgPSB0aGlzLnRlc3RSdW5uZXJcblxuICAgIGlmICghZmFpbGVkKSB0ZXN0UnVubmVyLl9zdWNjZXNzZnVsVGVzdHMrK1xuXG4gICAgaWYgKGZhaWxlZCkge1xuICAgICAgYXdhaXQgdGhpcy5lbWl0RXZlbnQoXCJ0ZXN0QXR0ZW1wdEZhaWxlZFwiLCB7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBhdHRlbXB0TnVtYmVyLFxuICAgICAgICBuZXh0QXR0ZW1wdDogd2lsbFJldHJ5ID8gYXR0ZW1wdE51bWJlciArIDEgOiB1bmRlZmluZWQsXG4gICAgICAgIHJldHJpZXNVc2VkLFxuICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICB0ZXN0QXJncyxcbiAgICAgICAgdGVzdERhdGEsXG4gICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgdGVzdFJ1bm5lcixcbiAgICAgICAgd2lsbFJldHJ5XG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh3aWxsUmV0cnkpIHtcbiAgICAgIGNvbnNvbGUud2FybihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIFJldHJ5aW5nICgke3JldHJpZXNVc2VkfS8ke3JldHJ5Q291bnR9KSBhZnRlciBlcnJvcjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCkpXG4gICAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RSZXRyeWluZ1wiLCB7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBuZXh0QXR0ZW1wdDogYXR0ZW1wdE51bWJlciArIDEsXG4gICAgICAgIHJldHJpZXNVc2VkLFxuICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICB0ZXN0QXJncyxcbiAgICAgICAgdGVzdERhdGEsXG4gICAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgICAgdGVzdFJ1bm5lclxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAoYXR0ZW1wdE51bWJlciA+IDEpIHtcbiAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdFJldHJpZWRcIiwge1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgICAgcmV0cmllc1VzZWQsXG4gICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgIHRlc3RBcmdzLFxuICAgICAgICB0ZXN0RGF0YSxcbiAgICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgICB0ZXN0UnVubmVyXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChmYWlsZWQgJiYgIXdpbGxSZXRyeSkge1xuICAgICAgYXdhaXQgdGhpcy5yZXBvcnRGYWlsZWRUZXN0KHthdHRlbXB0Q29uc29sZU91dHB1dHMsIGRlc2NyaXB0aW9ucywgZXJyb3IsIGxlZnRQYWRkaW5nLCB0ZXN0QXJncywgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYW5kIGVtaXRzIG9uZSBmaW5hbCBmYWlsZWQgdGVzdCByZXN1bHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmluYWwgZmFpbHVyZSBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLkF0dGVtcHRDb25zb2xlT3V0cHV0W119IGFyZ3MuYXR0ZW1wdENvbnNvbGVPdXRwdXRzIC0gQ2FwdHVyZWQgb3V0cHV0IGFjcm9zcyBhdHRlbXB0cy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBQYXJlbnQgZGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBSYXcgZmluYWwgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBDb25zb2xlIGluZGVudGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCIpLlRlc3RBcmdzfSBhcmdzLnRlc3RBcmdzIC0gU3RhYmxlIHRlc3QgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCIpLlRlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCByZWdpc3RyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBmaW5hbC1mYWlsdXJlIGxpc3RlbmVyIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHJlcG9ydEZhaWxlZFRlc3Qoe2F0dGVtcHRDb25zb2xlT3V0cHV0cywgZGVzY3JpcHRpb25zLCBlcnJvciwgbGVmdFBhZGRpbmcsIHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9ufSkge1xuICAgIGNvbnN0IHRlc3RSdW5uZXIgPSB0aGlzLnRlc3RSdW5uZXJcbiAgICBjb25zdCBjb25zb2xlT3V0cHV0ID0gdGVzdFJ1bm5lci5idWlsZENvbnNvbGVPdXRwdXQoYXR0ZW1wdENvbnNvbGVPdXRwdXRzKVxuXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICBUZXN0IGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApKVxuICAgICAgYWRkVHJhY2tlZFN0YWNrVG9FcnJvcihlcnJvcilcblxuICAgICAgY29uc3QgYmFja3RyYWNlQ2xlYW5lciA9IG5ldyBCYWNrdHJhY2VDbGVhbmVyKGVycm9yKVxuICAgICAgY29uc3QgY2xlYW5lZFN0YWNrID0gYmFja3RyYWNlQ2xlYW5lci5nZXRDbGVhbmVkU3RhY2soKVxuICAgICAgY29uc3Qgc3RhY2tMaW5lcyA9IGNsZWFuZWRTdGFjaz8uc3BsaXQoXCJcXG5cIilcblxuICAgICAgaWYgKHN0YWNrTGluZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBzdGFja0xpbmUgb2Ygc3RhY2tMaW5lcykge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICAke3N0YWNrTGluZX1gKSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgVGVzdCBmYWlsZWQgd2l0aCBhICR7dHlwZW9mIGVycm9yfTogJHtTdHJpbmcoZXJyb3IpfWApKVxuICAgIH1cblxuICAgIHRlc3RSdW5uZXIucHJpbnRGYWlsZWRDb25zb2xlT3V0cHV0KHtjb25zb2xlT3V0cHV0LCBsZWZ0UGFkZGluZ30pXG4gICAgdGVzdFJ1bm5lci5fZmFpbGVkVGVzdHMrK1xuICAgIHRlc3RSdW5uZXIuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiB0ZXN0UnVubmVyLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSxcbiAgICAgIGZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCxcbiAgICAgIGxpbmU6IHRlc3REYXRhLmxpbmUsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IGNvbnNvbGVPdXRwdXQgfHwgdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdEZhaWxlZFwiLCB7XG4gICAgICBjb25maWd1cmF0aW9uOiB0ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgIGVycm9yLFxuICAgICAgdGVzdEFyZ3MsXG4gICAgICB0ZXN0RGF0YSxcbiAgICAgIHRlc3REZXNjcmlwdGlvbixcbiAgICAgIHRlc3RSdW5uZXJcbiAgICB9KVxuXG4gICAgdGVzdFJ1bm5lci5wcmludFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhLCBsZWZ0UGFkZGluZ30pXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgb25lIGxlZ2FjeSBldmVudCBhbmQgYXdhaXRzIGxpc3RlbmVycyBpbiByZWdpc3RyYXRpb24gb3JkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudE5hbWUgLSBFdmVudCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gcGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGxpc3RlbmVycyBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpIHtcbiAgICBjb25zdCBsaXN0ZW5lcnMgPSB0ZXN0RXZlbnRzLmxpc3RlbmVycyhldmVudE5hbWUpXG5cbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIGxpc3RlbmVycykge1xuICAgICAgYXdhaXQgbGlzdGVuZXIocGF5bG9hZClcbiAgICB9XG4gIH1cbn1cbiJdfQ==