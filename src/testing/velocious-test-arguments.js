// @ts-check

import restArgsError from "../utils/rest-args-error.js"

/** @typedef {import("./test-runner.js").TestArgs} TestArgs */
/** @typedef {import("./test-runner.js").TestData} TestData */
/** @typedef {import("@velocious/testing/runner").TestDeclaration} PackageTestDeclaration */

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
   * Resolves stable Velocious arguments after package-owned table arguments.
   * @param {object} input - Package resolver input.
   * @param {PackageTestDeclaration} input.test - Selected declaration.
   * @returns {Promise<ReturnType<typeof JSON.parse>[]>} - Callback arguments.
   */
  async resolve({test}) {
    const compatibility = await this.testRunner.testCompatibility(test)

    return [...test.rowArguments, compatibility.testArgs]
  }

  /**
   * Copies declaration metadata before selection can inspect it.
   * @param {PackageTestDeclaration} testData - Test registration.
   * @returns {TestArgs} - Independent test arguments.
   */
  copy(testData) {
    const testArgs = /** @type {TestArgs} */ (Object.assign({}, testData.options))

    if (testArgs.retry === undefined && typeof testData.options.retries === "number") {
      testArgs.retry = testData.options.retries
    }
    if (testArgs.timeoutSeconds === undefined && typeof testData.options.timeoutMs === "number") {
      testArgs.timeoutSeconds = testData.options.timeoutMs / 1000
    }

    return testArgs
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
