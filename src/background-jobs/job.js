// @ts-check

import BackgroundJobsClient from "./client.js"

/**
 * Base class for background jobs.
 *
 * `TArgs` is the tuple of arguments the subclass's `perform` accepts, so a job that
 * needs arguments declares them as required and typed — for example
 * `class RunBuildJob extends VelociousJob<[string]>` with `async perform(buildId)`.
 * The default empty tuple keeps argument-less jobs (`extends VelociousJob`,
 * `async perform()`) working unchanged.
 * @template {Array<?>} [TArgs=[]]
 */
export default class VelociousJob {
  /**
   * Queue this job class runs on. Subclasses set e.g. `static queue = "builds"`
   * to route onto a queue with its own cluster-wide concurrency cap (configured
   * via `backgroundJobs.queues`). The `{queue}` enqueue option overrides it.
   * Left undefined, jobs run on the `"default"` queue.
   * @type {string | undefined}
   */
  static queue = undefined

  /**
   * Optional process title shown for the runner while this job executes.
   * Velocious sets `process.title` to this for the duration of the job — so
   * `ps`/`top`/`htop` identify what a runner is doing — and restores the
   * runner's base title when the job finishes. Left undefined, the runner falls
   * back to `velocious job-runner: <JobName>`. Set e.g.
   * `static processTitle = "velocious media transcoder"` to give a job a
   * custom, human-readable title.
   * @type {string | undefined}
   */
  static processTitle = undefined

  /**
   * Runs job name.
   * @returns {string} - Job name.
   */
  static jobName() {
    return this.name
  }

  /**
   * Folds this job class's static `queue` into the enqueue options unless the
   * caller already specified one.
   * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
   * @returns {import("./types.js").BackgroundJobOptions} - Options including the resolved queue.
   */
  static _withQueue(options) {
    const merged = options ? {...options} : {}

    if (merged.queue === undefined && typeof this.queue === "string" && this.queue.length > 0) {
      merged.queue = this.queue
    }

    return merged
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
      options: this._withQueue(jobOptions)
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
      options: this._withQueue(options)
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
      const {jobOptions} = /** @type {{jobOptions: import("./types.js").BackgroundJobOptions}} */ (lastArg)
      return {jobArgs: args.slice(0, -1), jobOptions: jobOptions || {}}
    }

    return {jobArgs: args, jobOptions: {}}
  }

  /**
   * Override in subclasses.
   * @param {TArgs} _args - Job args (the tuple this job class was parameterized with).
   * @returns {Promise<void>} - Resolves when complete.
   */
  async perform(..._args) {
    throw new Error("perform not implemented")
  }
}
