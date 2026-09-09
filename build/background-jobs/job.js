// @ts-check

import configurationResolver from "../configuration-resolver.js"
import PlatformVelociousJob from "./platform-job.js"
import {
  cancelScheduledBackgroundJobForConfiguration,
  enqueueBackgroundJobForConfiguration,
  replaceScheduledBackgroundJobForConfiguration
} from "./runtime.js"

/**
 * Node background-job entry. It preserves lazy configuration discovery for
 * fresh producer processes while the explicit platform entry stays free of
 * Node-only configuration resolution.
 * @template {Array<ReturnType<typeof JSON.parse>>} [TArgs=[]]
 * @augments {PlatformVelociousJob<TArgs>}
 */
export default class VelociousJob extends PlatformVelociousJob {
  /**
   * Runs perform later.
   * @param {...ReturnType<typeof JSON.parse>} args - Job args.
   * @returns {Promise<string>} - Job id.
   */
  static async performLater(...args) {
    const configuration = await configurationResolver()
    const {jobArgs, jobOptions} = this._splitArgsAndOptions(args)

    return await enqueueBackgroundJobForConfiguration({configuration, JobClass: this, jobArgs, jobOptions})
  }

  /**
   * Runs perform later with options.
   * @param {object} args - Options.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {Promise<string>} - Job id.
   */
  static async performLaterWithOptions({args, options}) {
    const configuration = await configurationResolver()

    return await enqueueBackgroundJobForConfiguration({configuration, JobClass: this, jobArgs: args, jobOptions: options})
  }

  /**
   * Atomically replaces this job class's queued owner for a stable schedule key.
   * @param {object} args - Options.
   * @param {string} args.scheduleKey - Stable logical schedule key.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
   */
  static async replaceScheduled({scheduleKey, args, options}) {
    const configuration = await configurationResolver()

    return await replaceScheduledBackgroundJobForConfiguration({configuration, JobClass: this, scheduleKey, jobArgs: args, jobOptions: options})
  }

  /**
   * Cancels or detaches the current owner of a stable schedule key.
   * @param {string} scheduleKey - Stable logical schedule key.
   * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
   */
  static async cancelScheduled(scheduleKey) {
    const configuration = await configurationResolver()

    return await cancelScheduledBackgroundJobForConfiguration({configuration, scheduleKey})
  }
}
