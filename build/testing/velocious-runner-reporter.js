// @ts-check

import { addTrackedStackToError } from "../utils/with-tracked-stack.js"
import picocolors from "picocolors"
import restArgsError from "../utils/rest-args-error.js"
import { testEvents } from "./test.js"

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
    : new Error(errorRecord.message)

  error.name = errorRecord.name
  if (errorRecord.stack) error.stack = errorRecord.stack
  if (errorRecord.cause) error.cause = errorFromPackageRecord(errorRecord.cause)
  if (errorRecord.terminalResource) Object.assign(error, {terminalResource: errorRecord.terminalResource})

  return error
}

/** Stops package traversal after framework-owned connection quarantine. */
export class AbortRemainingTestsError extends Error {}

export default class VelociousRunnerReporter {
  /**
   * Creates the legacy event and result projection adapter.
   * @param {object} args - Constructor arguments.
   * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
   */
  constructor({testRunner, ...restArgs}) {
    restArgsError(restArgs)
    this.testRunner = testRunner
    /** @type {WeakMap<PackageTestDeclaration, import("./test-runner.js").AttemptConsoleOutput[]>} */
    this.attemptConsoleOutputs = new WeakMap()
    /** @type {PackageTestDeclaration | undefined} */
    this.activeTest = undefined
  }

  /**
   * Translates one awaited package runner event into the legacy contract.
   * @param {import("@velocious/testing/runner").RunnerEvent} event - Structured package event.
   * @returns {Promise<void>} - Resolves after legacy listeners finish.
   */
  async onEvent(event) {
    if (event.type === "test:start") {
      this.activeTest = this.testRunner.findTestDeclaration(event.fullName)
      if (this.activeTest) {
        const metadata = this.testRunner.testMetadata(this.activeTest)
        console.log(`${" ".repeat(metadata.descriptions.length * 2)}it ${metadata.testDescription}`)
      }
      return
    }

    if (event.type === "attempt:finish") {
      await this.reportAttemptEvent(event)
      return
    }

    if (event.type === "test:finish") {
      await this.reportTestEvent(event)
      return
    }

    if (event.type === "test:not-run") {
      const test = this.testRunner.findTestDeclaration(event.test.fullName)
      if (!test) throw new Error(`Package not-run result did not match a declaration: ${event.test.fullName}`)
      this.testRunner.recordNotRunTest(event.test)
      this.testRunner.completeTestDeclaration(test)
      console.error(`Not run: ${event.test.fullName} (terminal resource failure in ${event.test.reason.fullName})`)
      await this.emitEvent("testNotRun", {
        configuration: this.testRunner.getConfiguration(),
        test: event.test,
        testRunner: this.testRunner
      })
      return
    }

    if (event.type === "run:finish") {
      this.testRunner.recordPackageResult(event.result)
      for (const failure of event.result.errors) {
        console.error(`Suite ${failure.phase} failed: ${failure.suite}`)
        this.printErrorCauses(errorFromPackageRecord(failure.error))
      }
    }
  }

  /**
   * Projects attempt failure/retry events while retaining the raw thrown value.
   * @param {import("@velocious/testing/runner").RunnerEvent} event - Attempt event.
   * @returns {Promise<void>} - Resolves after listeners finish.
   */
  async reportAttemptEvent(event) {
    const test = this.activeTest || this.testRunner.findTestDeclaration(event.fullName)

    if (!test) throw new Error(`Package runner attempt did not match a declaration: ${event.fullName}`)

    // Narrows the structured event payload for this event discriminator.
    const attempt = /** @type {import("@velocious/testing/runner").TestAttemptResult} */ (event.attempt)
    const outcome = this.testRunner.attemptOutcome(test, attempt.attemptNumber)
    const attemptConsoleOutputs = this.attemptConsoleOutputs.get(test) || []

    if (attempt.consoleOutput) {
      attemptConsoleOutputs.push({attemptNumber: attempt.attemptNumber, output: attempt.consoleOutput.trimEnd()})
      this.attemptConsoleOutputs.set(test, attemptConsoleOutputs)
    }

    const retryCount = this.testRunner.retryCount(test)
    const failed = outcome?.failed ?? Boolean(attempt.error)
    const error = outcome?.error
    const retriesUsed = Math.min(attempt.attemptNumber, retryCount)
    const willRetry = failed && !event.terminalFailure && !outcome?.abortRemainingTests && attempt.attemptNumber <= retryCount
    const {descriptions, testDescription} = this.testRunner.testMetadata(test)
    const compatibility = this.testRunner.testData(test)

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
      })
    }

    if (willRetry) {
      console.warn(picocolors.red(`${" ".repeat(descriptions.length * 2)}  Retrying (${retriesUsed}/${retryCount}) after error: ${error instanceof Error ? error.message : String(error)}`))
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
      })
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
      })
    }

    if (outcome?.abortRemainingTests) {
      const metadata = this.testRunner.testMetadata(test)

      this.testRunner.recordTestDuration({
        durationMs: attempt.durationMs,
        filePath: compatibility.testData.filePath ?? "<unknown>",
        fullDescription: metadata.fullDescription,
        line: compatibility.testData.line ?? 0
      })
      await this.reportFailedTest({
        attemptConsoleOutputs,
        descriptions,
        error,
        leftPadding: " ".repeat(descriptions.length * 2),
        testArgs: compatibility.testArgs,
        testData: compatibility.testData,
        testDescription
      })
      this.testRunner.completeTestDeclaration(test)
      this.activeTest = undefined
      throw new AbortRemainingTestsError("Velocious quarantined an attempt-owned database connection")
    }
  }

  /**
   * Projects final package result accounting and failures.
   * @param {import("@velocious/testing/runner").RunnerEvent} event - Test result event.
   * @returns {Promise<void>} - Resolves after listeners finish.
   */
  async reportTestEvent(event) {
    // Narrows the structured event payload for this event discriminator.
    const packageTestResult = /** @type {import("@velocious/testing/runner").TestResult} */ (event.test)
    const test = this.activeTest || this.testRunner.findTestDeclaration(packageTestResult.fullName)

    if (!test) throw new Error(`Package runner result did not match a declaration: ${packageTestResult.fullName}`)

    const metadata = this.testRunner.testMetadata(test)
    const compatibility = this.testRunner.testData(test)
    const durationMs = packageTestResult.attempts.reduce((total, attempt) => total + attempt.durationMs, 0)

    if (packageTestResult.attempts.length > 0) {
      this.testRunner.recordTestDuration({
        durationMs,
        filePath: compatibility.testData.filePath ?? "<unknown>",
        fullDescription: metadata.fullDescription,
        line: compatibility.testData.line ?? 0
      })
    }

    if (packageTestResult.status === "passed") {
      this.testRunner.recordSuccessfulTest()
    } else {
      const finalAttempt = packageTestResult.attempts.at(-1)
      const outcome = finalAttempt
        ? this.testRunner.attemptOutcome(test, finalAttempt.attemptNumber)
        : undefined
      const setupFailure = this.testRunner.setupFailureOutcomeFor(test)
      const error = outcome?.failed
        ? outcome.error
        : setupFailure.failed
          ? setupFailure.error
          : packageTestResult.error
            ? errorFromPackageRecord(packageTestResult.error)
            : undefined

      await this.reportFailedTest({
        attemptConsoleOutputs: this.attemptConsoleOutputs.get(test) || [],
        descriptions: metadata.descriptions,
        error,
        leftPadding: " ".repeat(metadata.descriptions.length * 2),
        testArgs: compatibility.testArgs,
        testData: compatibility.testData,
        testDescription: metadata.testDescription
      })
    }

    this.testRunner.completeTestDeclaration(test)
    this.activeTest = undefined
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
  async reportFailedTest({attemptConsoleOutputs, descriptions, error, leftPadding, testArgs, testData, testDescription}) {
    const testRunner = this.testRunner
    const consoleOutput = testRunner.buildConsoleOutput(attemptConsoleOutputs)

    if (error instanceof Error) {
      console.error(picocolors.red(`${leftPadding}  Test failed: ${error.message}`))
      this.printErrorCauses(error)

    } else {
      console.error(picocolors.red(`${leftPadding}  Test failed with a ${typeof error}: ${String(error)}`))
    }

    testRunner.printFailedConsoleOutput({consoleOutput, leftPadding})
    testRunner.recordFailedTest({descriptions, error, consoleOutput, testData, testDescription})

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
   * Prints complete primary and secondary stacks once, including cyclic cause graphs.
   * @param {unknown} error - Thrown value at the reporting boundary.
   * @param {Set<Error>} [reported] - Error identities already printed.
   * @returns {void}
   */
  printErrorCauses(error, reported = new Set()) {
    if (!(error instanceof Error)) {
      console.error(String(error))
      return
    }
    if (reported.has(error)) return
    reported.add(error)
    addTrackedStackToError(error)
    console.error(error.stack || `${error.name}: ${error.message}`)
    if (error.cause !== undefined) {
      console.error("Caused by:")
      this.printErrorCauses(error.cause, reported)
    }
    if (error instanceof AggregateError) {
      for (const secondary of error.errors) {
        console.error("Related failure:")
        this.printErrorCauses(secondary, reported)
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
    for (const listener of testEvents.listeners(eventName)) await listener(payload)
  }
}
