// @ts-check

import {addTrackedStackToError} from "../utils/with-tracked-stack.js"
import BacktraceCleaner from "../utils/backtrace-cleaner-node.js"
import picocolors from "picocolors"
import restArgsError from "../utils/rest-args-error.js"
import {testEvents} from "./test.js"

export default class VelociousRunnerReporter {
  /**
   * Creates the legacy event and result projection adapter.
   * @param {object} args - Constructor arguments.
   * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
   */
  constructor({testRunner, ...restArgs}) {
    restArgsError(restArgs)
    this.testRunner = testRunner
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
  async reportAttempt({attemptConsoleOutputs, attemptNumber, descriptions, error, failed, leftPadding, retriesUsed, retryCount, testArgs, testData, testDescription, willRetry, ...restArgs}) {
    restArgsError(restArgs)
    const testRunner = this.testRunner

    if (!failed) testRunner._successfulTests++

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
      })
    }

    if (willRetry) {
      console.warn(picocolors.red(`${leftPadding}  Retrying (${retriesUsed}/${retryCount}) after error: ${error instanceof Error ? error.message : String(error)}`))
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
      })
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
      })
    }

    if (failed && !willRetry) {
      await this.reportFailedTest({attemptConsoleOutputs, descriptions, error, leftPadding, testArgs, testData, testDescription})
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
  async reportFailedTest({attemptConsoleOutputs, descriptions, error, leftPadding, testArgs, testData, testDescription}) {
    const testRunner = this.testRunner
    const consoleOutput = testRunner.buildConsoleOutput(attemptConsoleOutputs)

    if (error instanceof Error) {
      console.error(picocolors.red(`${leftPadding}  Test failed: ${error.message}`))
      addTrackedStackToError(error)

      const backtraceCleaner = new BacktraceCleaner(error)
      const cleanedStack = backtraceCleaner.getCleanedStack()
      const stackLines = cleanedStack?.split("\n")

      if (stackLines) {
        for (const stackLine of stackLines) {
          console.error(picocolors.red(`${leftPadding}  ${stackLine}`))
        }
      }
    } else {
      console.error(picocolors.red(`${leftPadding}  Test failed with a ${typeof error}: ${String(error)}`))
    }

    testRunner.printFailedConsoleOutput({consoleOutput, leftPadding})
    testRunner._failedTests++
    testRunner._failedTestDetails.push({
      fullDescription: testRunner.buildFullDescription(descriptions, testDescription),
      filePath: testData.filePath,
      line: testData.line,
      error,
      consoleOutput: consoleOutput || undefined
    })

    await this.emitEvent("testFailed", {
      configuration: testRunner.getConfiguration(),
      descriptions,
      error,
      testArgs,
      testData,
      testDescription,
      testRunner
    })

    testRunner.printRerunCommand({descriptions, testDescription, testData, leftPadding})
  }

  /**
   * Emits one legacy event and awaits listeners in registration order.
   * @param {string} eventName - Event name.
   * @param {object} payload - Event payload.
   * @returns {Promise<void>} - Resolves when all listeners complete.
   */
  async emitEvent(eventName, payload) {
    const listeners = testEvents.listeners(eventName)

    for (const listener of listeners) {
      await listener(payload)
    }
  }
}
