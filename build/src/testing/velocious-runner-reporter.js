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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXJ1bm5lci1yZXBvcnRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3ZlbG9jaW91cy1ydW5uZXItcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxzQkFBc0IsRUFBQyxNQUFNLGdDQUFnQyxDQUFBO0FBQ3JFLE9BQU8sZ0JBQWdCLE1BQU0sb0NBQW9DLENBQUE7QUFDakUsT0FBTyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ25DLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFFcEMsTUFBTSxDQUFDLE9BQU8sT0FBTyx1QkFBdUI7SUFDMUM7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxVQUFVLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDbkMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FpQkc7SUFDSCxLQUFLLENBQUMsYUFBYSxDQUFDLEVBQUMscUJBQXFCLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUN4TCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDdkIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQTtRQUVsQyxJQUFJLENBQUMsTUFBTTtZQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRTFDLElBQUksTUFBTSxFQUFFLENBQUM7WUFDWCxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEVBQUU7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QUMsT0FBTyxDQUFDLENBQUE7UUFDekIsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2FkZFRyYWNrZWRTdGFja1RvRXJyb3J9IGZyb20gXCIuLi91dGlscy93aXRoLXRyYWNrZWQtc3RhY2suanNcIlxuaW1wb3J0IEJhY2t0cmFjZUNsZWFuZXIgZnJvbSBcIi4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLW5vZGUuanNcIlxuaW1wb3J0IHBpY29jb2xvcnMgZnJvbSBcInBpY29jb2xvcnNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQge3Rlc3RFdmVudHN9IGZyb20gXCIuL3Rlc3QuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBsZWdhY3kgZXZlbnQgYW5kIHJlc3VsdCBwcm9qZWN0aW9uIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuZGVmYXVsdH0gYXJncy50ZXN0UnVubmVyIC0gT3duaW5nIFZlbG9jaW91cyBydW5uZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGVzdFJ1bm5lciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB0aGlzLnRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgb25lIGNvbXBsZXRlZCBhdHRlbXB0IGludG8gbGVnYWN5IGV2ZW50cyBhbmQgZmluYWwgcmVzdWx0IGFjY291bnRpbmcuXG4gICAqIFJldHJ5IGVsaWdpYmlsaXR5IGlzIGRlY2lkZWQgYnkgdGhlIGNhbGxlciBiZWZvcmUgdGhpcyBtZXRob2QgcnVucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb21wbGV0ZWQgYXR0ZW1wdCBhbmQgcmV0cnkgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5BdHRlbXB0Q29uc29sZU91dHB1dFtdfSBhcmdzLmF0dGVtcHRDb25zb2xlT3V0cHV0cyAtIENhcHR1cmVkIG91dHB1dCBhY3Jvc3MgYXR0ZW1wdHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmF0dGVtcHROdW1iZXIgLSBDdXJyZW50IG9uZS1iYXNlZCBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIFBhcmVudCBkZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJhdyB0aHJvd24gb3IgcmVqZWN0ZWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5mYWlsZWQgLSBXaGV0aGVyIHRoZSBhdHRlbXB0IGZhaWxlZCwgaW5kZXBlbmRlbnRseSBvZiBlcnJvciB0cnV0aGluZXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIENvbnNvbGUgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnJldHJpZXNVc2VkIC0gUmV0cnkgY291bnQgY29uc3VtZWQgYWZ0ZXIgdGhpcyBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZXRyeUNvdW50IC0gQ29uZmlndXJlZCByZXRyeSBsaW1pdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiKS5UZXN0QXJnc30gYXJncy50ZXN0QXJncyAtIFN0YWJsZSB0ZXN0IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiKS5UZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgcmVnaXN0cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Mud2lsbFJldHJ5IC0gV2hldGhlciB0aGUgbGVnYWN5IGxvb3Agd2lsbCBydW4gYW5vdGhlciBhdHRlbXB0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgbGVnYWN5IGxpc3RlbmVycyBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlcG9ydEF0dGVtcHQoe2F0dGVtcHRDb25zb2xlT3V0cHV0cywgYXR0ZW1wdE51bWJlciwgZGVzY3JpcHRpb25zLCBlcnJvciwgZmFpbGVkLCBsZWZ0UGFkZGluZywgcmV0cmllc1VzZWQsIHJldHJ5Q291bnQsIHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9uLCB3aWxsUmV0cnksIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgY29uc3QgdGVzdFJ1bm5lciA9IHRoaXMudGVzdFJ1bm5lclxuXG4gICAgaWYgKCFmYWlsZWQpIHRlc3RSdW5uZXIuX3N1Y2Nlc3NmdWxUZXN0cysrXG5cbiAgICBpZiAoZmFpbGVkKSB7XG4gICAgICBhd2FpdCB0aGlzLmVtaXRFdmVudChcInRlc3RBdHRlbXB0RmFpbGVkXCIsIHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGF0dGVtcHROdW1iZXIsXG4gICAgICAgIG5leHRBdHRlbXB0OiB3aWxsUmV0cnkgPyBhdHRlbXB0TnVtYmVyICsgMSA6IHVuZGVmaW5lZCxcbiAgICAgICAgcmV0cmllc1VzZWQsXG4gICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgIHRlc3RBcmdzLFxuICAgICAgICB0ZXN0RGF0YSxcbiAgICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgICB0ZXN0UnVubmVyLFxuICAgICAgICB3aWxsUmV0cnlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHdpbGxSZXRyeSkge1xuICAgICAgY29uc29sZS53YXJuKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgUmV0cnlpbmcgKCR7cmV0cmllc1VzZWR9LyR7cmV0cnlDb3VudH0pIGFmdGVyIGVycm9yOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKSlcbiAgICAgIGF3YWl0IHRoaXMuZW1pdEV2ZW50KFwidGVzdFJldHJ5aW5nXCIsIHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGVzdFJ1bm5lci5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIG5leHRBdHRlbXB0OiBhdHRlbXB0TnVtYmVyICsgMSxcbiAgICAgICAgcmV0cmllc1VzZWQsXG4gICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgIHRlc3RBcmdzLFxuICAgICAgICB0ZXN0RGF0YSxcbiAgICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgICB0ZXN0UnVubmVyXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChhdHRlbXB0TnVtYmVyID4gMSkge1xuICAgICAgYXdhaXQgdGhpcy5lbWl0RXZlbnQoXCJ0ZXN0UmV0cmllZFwiLCB7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBhdHRlbXB0TnVtYmVyLFxuICAgICAgICByZXRyaWVzVXNlZCxcbiAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgdGVzdEFyZ3MsXG4gICAgICAgIHRlc3REYXRhLFxuICAgICAgICB0ZXN0RGVzY3JpcHRpb24sXG4gICAgICAgIHRlc3RSdW5uZXJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGZhaWxlZCAmJiAhd2lsbFJldHJ5KSB7XG4gICAgICBhd2FpdCB0aGlzLnJlcG9ydEZhaWxlZFRlc3Qoe2F0dGVtcHRDb25zb2xlT3V0cHV0cywgZGVzY3JpcHRpb25zLCBlcnJvciwgbGVmdFBhZGRpbmcsIHRlc3RBcmdzLCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9ufSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbmQgZW1pdHMgb25lIGZpbmFsIGZhaWxlZCB0ZXN0IHJlc3VsdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGaW5hbCBmYWlsdXJlIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuQXR0ZW1wdENvbnNvbGVPdXRwdXRbXX0gYXJncy5hdHRlbXB0Q29uc29sZU91dHB1dHMgLSBDYXB0dXJlZCBvdXRwdXQgYWNyb3NzIGF0dGVtcHRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIFBhcmVudCBkZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJhdyBmaW5hbCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIENvbnNvbGUgaW5kZW50YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIikuVGVzdEFyZ3N9IGFyZ3MudGVzdEFyZ3MgLSBTdGFibGUgdGVzdCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIikuVGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IHJlZ2lzdHJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGZpbmFsLWZhaWx1cmUgbGlzdGVuZXIgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0RmFpbGVkVGVzdCh7YXR0ZW1wdENvbnNvbGVPdXRwdXRzLCBkZXNjcmlwdGlvbnMsIGVycm9yLCBsZWZ0UGFkZGluZywgdGVzdEFyZ3MsIHRlc3REYXRhLCB0ZXN0RGVzY3JpcHRpb259KSB7XG4gICAgY29uc3QgdGVzdFJ1bm5lciA9IHRoaXMudGVzdFJ1bm5lclxuICAgIGNvbnN0IGNvbnNvbGVPdXRwdXQgPSB0ZXN0UnVubmVyLmJ1aWxkQ29uc29sZU91dHB1dChhdHRlbXB0Q29uc29sZU91dHB1dHMpXG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIFRlc3QgZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCkpXG4gICAgICBhZGRUcmFja2VkU3RhY2tUb0Vycm9yKGVycm9yKVxuXG4gICAgICBjb25zdCBiYWNrdHJhY2VDbGVhbmVyID0gbmV3IEJhY2t0cmFjZUNsZWFuZXIoZXJyb3IpXG4gICAgICBjb25zdCBjbGVhbmVkU3RhY2sgPSBiYWNrdHJhY2VDbGVhbmVyLmdldENsZWFuZWRTdGFjaygpXG4gICAgICBjb25zdCBzdGFja0xpbmVzID0gY2xlYW5lZFN0YWNrPy5zcGxpdChcIlxcblwiKVxuXG4gICAgICBpZiAoc3RhY2tMaW5lcykge1xuICAgICAgICBmb3IgKGNvbnN0IHN0YWNrTGluZSBvZiBzdGFja0xpbmVzKSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gICR7c3RhY2tMaW5lfWApKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICBUZXN0IGZhaWxlZCB3aXRoIGEgJHt0eXBlb2YgZXJyb3J9OiAke1N0cmluZyhlcnJvcil9YCkpXG4gICAgfVxuXG4gICAgdGVzdFJ1bm5lci5wcmludEZhaWxlZENvbnNvbGVPdXRwdXQoe2NvbnNvbGVPdXRwdXQsIGxlZnRQYWRkaW5nfSlcbiAgICB0ZXN0UnVubmVyLl9mYWlsZWRUZXN0cysrXG4gICAgdGVzdFJ1bm5lci5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IHRlc3RSdW5uZXIuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pLFxuICAgICAgZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoLFxuICAgICAgbGluZTogdGVzdERhdGEubGluZSxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogY29uc29sZU91dHB1dCB8fCB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5lbWl0RXZlbnQoXCJ0ZXN0RmFpbGVkXCIsIHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRlc3RSdW5uZXIuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgZXJyb3IsXG4gICAgICB0ZXN0QXJncyxcbiAgICAgIHRlc3REYXRhLFxuICAgICAgdGVzdERlc2NyaXB0aW9uLFxuICAgICAgdGVzdFJ1bm5lclxuICAgIH0pXG5cbiAgICB0ZXN0UnVubmVyLnByaW50UmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGEsIGxlZnRQYWRkaW5nfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBvbmUgbGVnYWN5IGV2ZW50IGFuZCBhd2FpdHMgbGlzdGVuZXJzIGluIHJlZ2lzdHJhdGlvbiBvcmRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgbGlzdGVuZXJzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGF5bG9hZCkge1xuICAgIGNvbnN0IGxpc3RlbmVycyA9IHRlc3RFdmVudHMubGlzdGVuZXJzKGV2ZW50TmFtZSlcblxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgbGlzdGVuZXJzKSB7XG4gICAgICBhd2FpdCBsaXN0ZW5lcihwYXlsb2FkKVxuICAgIH1cbiAgfVxufVxuIl19