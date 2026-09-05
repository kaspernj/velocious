// @ts-check

import restArgsError from "../utils/rest-args-error.js"

export default class VelociousSuiteHookExecutor {
  /**
   * Creates an executor for Velocious suite hooks.
   * @param {object} args - Constructor arguments.
   * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
   */
  constructor({testRunner, ...restArgs}) {
    restArgsError(restArgs)
    this.testRunner = testRunner
  }

  /**
   * Supplies the framework configuration while package traversal owns ordering,
   * timeout enforcement, aggregation, and active-scope cleanup.
   * @param {import("@velocious/testing/runner").SuiteHookExecutorInput} input - Package hook input.
   * @returns {Promise<void>} - Resolves after the hook completes.
   */
  async execute({context, defaultExecute, fullName, hook, phase, suite, timeoutMs, ...restArgs}) {
    restArgsError(restArgs)
    void context
    void fullName
    void timeoutMs
    const metadata = this.testRunner.hookMetadata(hook)

    try {
      await this.testRunner.runProfileSpan({
        phase,
        declarationIndex: metadata.declarationIndex,
        declarationScopeId: metadata.declarationScopeId,
        filePath: metadata.ownerFilePath
      }, async () => {
        await defaultExecute([{configuration: this.testRunner.getConfiguration()}])
      })
    } catch (error) {
      this.testRunner.recordSuiteHookFailure({suite, phase, error})
      throw error
    }
  }
}
