// @ts-check

import BackgroundJobsClient from "./client.js"

export default class VelociousJob {
  /**
 * Runs job name.
   * @returns {string} - Job name.
   */
  static jobName() {
    return this.name
  }

  /**
 * Runs perform later.
   * @param {...?} args - Job args.
   * @returns {Promise<string>} - Job id.
   */
  static async performLater(...args) {
    const {jobArgs, jobOptions} = this._splitArgsAndOptions(args)
    const client = new BackgroundJobsClient()

    return await client.enqueue({
      jobName: this.jobName(),
      args: jobArgs,
      options: jobOptions
    })
  }

  /**
 * Runs perform later with options.
   * @param {object} args - Options.
   * @param {Array<?>} args.args - Job args.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {Promise<string>} - Job id.
   */
  static async performLaterWithOptions({args, options}) {
    const client = new BackgroundJobsClient()

    return await client.enqueue({
      jobName: this.jobName(),
      args,
      options
    })
  }

  /**
 * Runs split args and options.
   * @param {Array<?>} args - Job args.
   * @returns {{jobArgs: Array<?>, jobOptions: import("./types.js").BackgroundJobOptions}} - Split args and options.
   */
  static _splitArgsAndOptions(args) {
    if (args.length === 0) {
      return {jobArgs: [], jobOptions: {}}
    }

    const lastArg = args[args.length - 1]
    const isOptionsArg = lastArg && typeof lastArg === "object" && !Array.isArray(lastArg) && "jobOptions" in lastArg

    if (isOptionsArg) {
      const {jobOptions} = /**
 * Documents this API.
 * @type {{jobOptions: import("./types.js").BackgroundJobOptions}} */ (lastArg)
      return {jobArgs: args.slice(0, -1), jobOptions: jobOptions || {}}
    }

    return {jobArgs: args, jobOptions: {}}
  }

  /**
   * Override in subclasses.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async perform() {
    throw new Error("perform not implemented")
  }
}
