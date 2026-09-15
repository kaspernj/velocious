// @ts-check

import {
  TestProfiler as PackageTestProfiler,
  roundProfileDuration
} from "@velocious/testing/node"

import restArgsError from "../utils/rest-args-error.js"
import { registerTestProfileContextReader } from "./test-profile-context.js"

/** @typedef {import("@velocious/testing/node").TestProfileAsyncContext} TestProfileAsyncContext */
/** @typedef {import("@velocious/testing/node").TestProfileAttemptHandle} TestProfileAttemptHandle */
/** @typedef {import("@velocious/testing/node").TestProfileAttemptStatus} TestProfileAttemptStatus */

export { roundProfileDuration }

/** Connects the package profiler to Velocious's environment-owned async context. */
class VelociousProfileContextAdapter {
  /**
   * Creates the environment context adapter.
   * @param {import("../environment-handlers/base.js").default} environmentHandler - Active environment handler.
   */
  constructor(environmentHandler) {
    this.environmentHandler = environmentHandler
  }

  /**
   * Gets the active framework profile context.
   * @returns {TestProfileAsyncContext | undefined} - Current profile attribution.
   */
  current() { return this.environmentHandler.getCurrentTestProfileContext() }

  /**
   * Runs work with framework profile attribution.
   * @template T
   * @param {TestProfileAsyncContext} context - Profile attribution to install.
   * @param {() => T} callback - Work to run.
   * @returns {T} - Callback result.
   */
  run(context, callback) {
    return this.environmentHandler.runWithTestProfileContext(context, callback)
  }
}

/** Velocious compatibility facade around the package-owned profiler. */
export default class TestProfiler extends PackageTestProfiler {
  /**
   * Creates the package profiler with Velocious environment context.
   * @param {object} args - Profiler options.
   * @param {import("../configuration.js").default} args.configuration - Test configuration.
   * @param {string} args.projectDirectory - Project root used for portable paths.
   * @param {Partial<import("@velocious/testing/node").TestProfileSelection>} [args.selection] - Selection metadata.
   */
  constructor({configuration, projectDirectory, selection, ...restArgs}) {
    restArgsError(restArgs)
    const contextAdapter = new VelociousProfileContextAdapter(configuration.getEnvironmentHandler())

    super({contextAdapter, projectDirectory, selection})
    registerTestProfileContextReader(configuration, () => contextAdapter.current())
  }
}
