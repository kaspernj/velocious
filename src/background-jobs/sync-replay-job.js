// @ts-check

import Logger from "../logger.js"
import VelociousJob from "./platform-job.js"
import {currentSyncClientOrNull} from "../sync/sync-client-registry.js"

const logger = new Logger("SyncReplayJob")

/**
 * Durable, deduplicated replay of the device's pending sync queue.
 *
 * Offline-capable apps write local mutations with `syncClient.queue()`, which
 * schedules an in-process replay attempt. That attempt lives only as long as the
 * JavaScript runtime, so a scan (or any other mutation) that happens while the app
 * is closing, backgrounding, or briefly online can leave rows pending. Enqueueing
 * this job after such a mutation makes the replay durable: the local background-jobs
 * adapter stores the trigger in SQLite, runs it in process as soon as the app is
 * active, and collapses overlapping triggers onto one queued job.
 *
 * `perform()` is deliberately best-effort. Pending rows are only deleted after the
 * backend acknowledges them, so a failed or offline replay leaves the queue intact
 * for the next enqueue (next mutation, focus, or foreground trigger) instead of
 * consuming the job's retries on a device that may stay offline for hours.
 *
 * Apps register it next to their other jobs and enqueue it after local mutations:
 *
 * ```js
 * backgroundJobs: {mode: "background", jobClasses: [SyncReplayJob]}
 *
 * await SyncReplayJob.enqueue()
 * ```
 * @augments {VelociousJob}
 */
export default class SyncReplayJob extends VelociousJob {
  /**
   * Returns the stable job name used by the persisted queue.
   * @returns {string} - Job name.
   */
  static jobName() { return "syncReplay" }

  /**
   * Enqueues one deduplicated replay. Resolves after the durable enqueue, not after
   * the replay finishes, so callers can stay on the synchronous local path.
   * @returns {Promise<string>} - Queued job id.
   */
  static async enqueue() {
    return await this.performLaterWithOptions({
      args: [],
      options: {
        concurrencyKey: "sync-replay",
        deduplicateWhileQueued: true,
        maxConcurrency: 1
      }
    })
  }

  /**
   * Drains the pending sync queue through the app's current sync client.
   * @returns {Promise<void>}
   */
  async perform() {
    const syncClient = currentSyncClientOrNull()

    if (!syncClient) {
      void logger.debug("sync replay skipped because no sync client is registered")

      return
    }

    try {
      await syncClient.replayPending()
    } catch (error) {
      // Pending rows survive a failed or offline replay, so the next enqueue retries
      // them. Re-throwing would make the adapter retry a device that may be offline
      // for hours and mark healthy offline periods as job failures.
      void logger.error(() => ["sync replay failed (pending rows stay queued)", error])
    }
  }
}
