// @ts-check

import { randomUUID } from "node:crypto"

import configurationResolver from "../configuration-resolver.js"
import { currentBackgroundJobProducerProof } from "./execution-context.js"
import PlatformVelociousJob from "./platform-job.js"
import {
  cancelScheduledBackgroundJobForConfiguration,
  enqueueBackgroundJobForConfiguration,
  getScheduledBackgroundJobForConfiguration,
  replaceScheduledBackgroundJobForConfiguration,
  wakeScheduledBackgroundJobForConfiguration
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
    const producerProof = currentBackgroundJobProducerProof()

    return await enqueueBackgroundJobForConfiguration({
      configuration,
      JobClass: this,
      jobArgs,
      jobOptions,
      producerProof,
      producerInvocationId: producerProof ? randomUUID() : undefined
    })
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
    const producerProof = currentBackgroundJobProducerProof()

    return await enqueueBackgroundJobForConfiguration({
      configuration,
      JobClass: this,
      jobArgs: args,
      jobOptions: options,
      producerProof,
      producerInvocationId: producerProof ? randomUUID() : undefined
    })
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

  /**
   * Reads current ownership and optional terminal history for a stable key.
   * @param {string} scheduleKey - Stable logical schedule key.
   * @param {{includeLatestTerminal?: boolean}} [options] - Lookup options.
   * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized stable schedule jobs.
   */
  static async getScheduledJob(scheduleKey, options = {}) {
    const configuration = await configurationResolver()

    return await getScheduledBackgroundJobForConfiguration({configuration, scheduleKey, ...options})
  }

  /**
   * Expedites a future queued owner without creating another job.
   * @param {string} scheduleKey - Stable logical schedule key.
   * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Wake result.
   */
  static async wakeScheduled(scheduleKey) {
    const configuration = await configurationResolver()

    return await wakeScheduledBackgroundJobForConfiguration({configuration, scheduleKey})
  }
}
