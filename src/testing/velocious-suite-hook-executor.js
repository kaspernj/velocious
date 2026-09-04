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
   * Runs suite setup hooks in declaration order.
   * @param {object} args - Hook execution arguments.
   * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} args.hooks - Profiled setup hooks.
   * @returns {Promise<void>} - Resolves after every setup hook completes.
   */
  async runBeforeAlls({hooks, ...restArgs}) {
    restArgsError(restArgs)

    for (const hook of hooks) {
      await this.runHook(hook, "beforeAll")
    }
  }

  /**
   * Runs every suite teardown hook in reverse declaration order.
   * @param {object} args - Hook execution arguments.
   * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} args.hooks - Profiled teardown hooks.
   * @returns {Promise<void>} - Resolves after every teardown hook settles.
   */
  async runAfterAlls({hooks, ...restArgs}) {
    restArgsError(restArgs)
    /** @type {ReturnType<typeof JSON.parse>[]} */
    const errors = []

    for (const hook of [...hooks].reverse()) {
      try {
        await this.runHook(hook, "afterAll")
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length == 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, "Multiple afterAll hooks failed", {cause: errors[0]})
    }
  }

  /**
   * Runs one suite hook with its Velocious profiler attribution.
   * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType} hook - Hook registration.
   * @param {"beforeAll" | "afterAll"} phase - Profiler phase.
   * @returns {Promise<void>} - Resolves when the hook completes.
   */
  async runHook(hook, phase) {
    await this.testRunner.runProfileSpan({
      phase,
      declarationIndex: hook.declarationIndex,
      declarationScopeId: hook.declarationScopeId,
      filePath: hook.ownerFilePath
    }, async () => {
      await hook.callback({configuration: this.testRunner.getConfiguration()})
    })
  }
}
