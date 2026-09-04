// @ts-check

import restArgsError from "../utils/rest-args-error.js"

/** @typedef {import("./test-runner.js").TestArgs} TestArgs */
/** @typedef {import("./test-runner.js").TestData} TestData */

export default class VelociousTestArguments {
  /**
   * Creates the framework-owned test argument adapter.
   * @param {object} args - Constructor arguments.
   * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
   */
  constructor({testRunner, ...restArgs}) {
    restArgsError(restArgs)
    this.testRunner = testRunner
  }

  /**
   * Builds the stable framework-owned argument object for one selected test.
   * @param {TestData} testData - Selected test registration.
   * @returns {Promise<TestArgs>} - Attempt-shared callback arguments.
   */
  async build(testData) {
    const testArgs = this.copy(testData)

    await this.inject(testArgs)

    return testArgs
  }

  /**
   * Copies declaration metadata before selection can inspect it.
   * @param {TestData} testData - Test registration.
   * @returns {TestArgs} - Independent test arguments.
   */
  copy(testData) {
    return /** @type {TestArgs} */ (Object.assign({}, testData.args))
  }

  /**
   * Injects type-specific framework collaborators after selection.
   * @param {TestArgs} testArgs - Selected test arguments.
   * @returns {Promise<void>} - Resolves after required collaborators are ready.
   */
  async inject(testArgs) {
    if (testArgs.type == "model" || testArgs.type == "request") {
      testArgs.application = await this.testRunner.application()
    }

    if (testArgs.type == "request") {
      testArgs.client = await this.testRunner.requestClient()
    }
  }
}
