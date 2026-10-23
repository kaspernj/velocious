// @ts-check
import Logger from "../logger.js";
import VelociousJob from "./platform-job.js";
import { currentSyncClientOrNull } from "../sync/sync-client-registry.js";
const logger = new Logger("SyncReplayJob");
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
    static jobName() { return "syncReplay"; }
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
        });
    }
    /**
     * Drains the pending sync queue through the app's current sync client.
     * @returns {Promise<void>}
     */
    async perform() {
        const syncClient = currentSyncClientOrNull();
        if (!syncClient) {
            void logger.debug("sync replay skipped because no sync client is registered");
            return;
        }
        try {
            await syncClient.replayPending();
        }
        catch (error) {
            // Pending rows survive a failed or offline replay, so the next enqueue retries
            // them. Re-throwing would make the adapter retry a device that may be offline
            // for hours and mark healthy offline periods as job failures.
            void logger.error(() => ["sync replay failed (pending rows stay queued)", error]);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1yZXBsYXktam9iLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9zeW5jLXJlcGxheS1qb2IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLFlBQVksTUFBTSxtQkFBbUIsQ0FBQTtBQUM1QyxPQUFPLEVBQUMsdUJBQXVCLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV2RSxNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxlQUFlLENBQUMsQ0FBQTtBQUUxQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFjLFNBQVEsWUFBWTtJQUNyRDs7O09BR0c7SUFDSCxNQUFNLENBQUMsT0FBTyxLQUFLLE9BQU8sWUFBWSxDQUFBLENBQUMsQ0FBQztJQUV4Qzs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPO1FBQ2xCLE9BQU8sTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUM7WUFDeEMsSUFBSSxFQUFFLEVBQUU7WUFDUixPQUFPLEVBQUU7Z0JBQ1AsY0FBYyxFQUFFLGFBQWE7Z0JBQzdCLHNCQUFzQixFQUFFLElBQUk7Z0JBQzVCLGNBQWMsRUFBRSxDQUFDO2FBQ2xCO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxVQUFVLEdBQUcsdUJBQXVCLEVBQUUsQ0FBQTtRQUU1QyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsS0FBSyxNQUFNLENBQUMsS0FBSyxDQUFDLDBEQUEwRCxDQUFDLENBQUE7WUFFN0UsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxNQUFNLFVBQVUsQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUNsQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLCtFQUErRTtZQUMvRSw4RUFBOEU7WUFDOUUsOERBQThEO1lBQzlELEtBQUssTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLCtDQUErQyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFDbkYsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c0pvYiBmcm9tIFwiLi9wbGF0Zm9ybS1qb2IuanNcIlxuaW1wb3J0IHtjdXJyZW50U3luY0NsaWVudE9yTnVsbH0gZnJvbSBcIi4uL3N5bmMvc3luYy1jbGllbnQtcmVnaXN0cnkuanNcIlxuXG5jb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKFwiU3luY1JlcGxheUpvYlwiKVxuXG4vKipcbiAqIER1cmFibGUsIGRlZHVwbGljYXRlZCByZXBsYXkgb2YgdGhlIGRldmljZSdzIHBlbmRpbmcgc3luYyBxdWV1ZS5cbiAqXG4gKiBPZmZsaW5lLWNhcGFibGUgYXBwcyB3cml0ZSBsb2NhbCBtdXRhdGlvbnMgd2l0aCBgc3luY0NsaWVudC5xdWV1ZSgpYCwgd2hpY2hcbiAqIHNjaGVkdWxlcyBhbiBpbi1wcm9jZXNzIHJlcGxheSBhdHRlbXB0LiBUaGF0IGF0dGVtcHQgbGl2ZXMgb25seSBhcyBsb25nIGFzIHRoZVxuICogSmF2YVNjcmlwdCBydW50aW1lLCBzbyBhIHNjYW4gKG9yIGFueSBvdGhlciBtdXRhdGlvbikgdGhhdCBoYXBwZW5zIHdoaWxlIHRoZSBhcHBcbiAqIGlzIGNsb3NpbmcsIGJhY2tncm91bmRpbmcsIG9yIGJyaWVmbHkgb25saW5lIGNhbiBsZWF2ZSByb3dzIHBlbmRpbmcuIEVucXVldWVpbmdcbiAqIHRoaXMgam9iIGFmdGVyIHN1Y2ggYSBtdXRhdGlvbiBtYWtlcyB0aGUgcmVwbGF5IGR1cmFibGU6IHRoZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnNcbiAqIGFkYXB0ZXIgc3RvcmVzIHRoZSB0cmlnZ2VyIGluIFNRTGl0ZSwgcnVucyBpdCBpbiBwcm9jZXNzIGFzIHNvb24gYXMgdGhlIGFwcCBpc1xuICogYWN0aXZlLCBhbmQgY29sbGFwc2VzIG92ZXJsYXBwaW5nIHRyaWdnZXJzIG9udG8gb25lIHF1ZXVlZCBqb2IuXG4gKlxuICogYHBlcmZvcm0oKWAgaXMgZGVsaWJlcmF0ZWx5IGJlc3QtZWZmb3J0LiBQZW5kaW5nIHJvd3MgYXJlIG9ubHkgZGVsZXRlZCBhZnRlciB0aGVcbiAqIGJhY2tlbmQgYWNrbm93bGVkZ2VzIHRoZW0sIHNvIGEgZmFpbGVkIG9yIG9mZmxpbmUgcmVwbGF5IGxlYXZlcyB0aGUgcXVldWUgaW50YWN0XG4gKiBmb3IgdGhlIG5leHQgZW5xdWV1ZSAobmV4dCBtdXRhdGlvbiwgZm9jdXMsIG9yIGZvcmVncm91bmQgdHJpZ2dlcikgaW5zdGVhZCBvZlxuICogY29uc3VtaW5nIHRoZSBqb2IncyByZXRyaWVzIG9uIGEgZGV2aWNlIHRoYXQgbWF5IHN0YXkgb2ZmbGluZSBmb3IgaG91cnMuXG4gKlxuICogQXBwcyByZWdpc3RlciBpdCBuZXh0IHRvIHRoZWlyIG90aGVyIGpvYnMgYW5kIGVucXVldWUgaXQgYWZ0ZXIgbG9jYWwgbXV0YXRpb25zOlxuICpcbiAqIGBgYGpzXG4gKiBiYWNrZ3JvdW5kSm9iczoge21vZGU6IFwiYmFja2dyb3VuZFwiLCBqb2JDbGFzc2VzOiBbU3luY1JlcGxheUpvYl19XG4gKlxuICogYXdhaXQgU3luY1JlcGxheUpvYi5lbnF1ZXVlKClcbiAqIGBgYFxuICogQGF1Z21lbnRzIHtWZWxvY2lvdXNKb2J9XG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNSZXBsYXlKb2IgZXh0ZW5kcyBWZWxvY2lvdXNKb2Ige1xuICAvKipcbiAgICogUmV0dXJucyB0aGUgc3RhYmxlIGpvYiBuYW1lIHVzZWQgYnkgdGhlIHBlcnNpc3RlZCBxdWV1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBKb2IgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBqb2JOYW1lKCkgeyByZXR1cm4gXCJzeW5jUmVwbGF5XCIgfVxuXG4gIC8qKlxuICAgKiBFbnF1ZXVlcyBvbmUgZGVkdXBsaWNhdGVkIHJlcGxheS4gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGR1cmFibGUgZW5xdWV1ZSwgbm90IGFmdGVyXG4gICAqIHRoZSByZXBsYXkgZmluaXNoZXMsIHNvIGNhbGxlcnMgY2FuIHN0YXkgb24gdGhlIHN5bmNocm9ub3VzIGxvY2FsIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gUXVldWVkIGpvYiBpZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBlbnF1ZXVlKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnBlcmZvcm1MYXRlcldpdGhPcHRpb25zKHtcbiAgICAgIGFyZ3M6IFtdLFxuICAgICAgb3B0aW9uczoge1xuICAgICAgICBjb25jdXJyZW5jeUtleTogXCJzeW5jLXJlcGxheVwiLFxuICAgICAgICBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkOiB0cnVlLFxuICAgICAgICBtYXhDb25jdXJyZW5jeTogMVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIHRoZSBwZW5kaW5nIHN5bmMgcXVldWUgdGhyb3VnaCB0aGUgYXBwJ3MgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBwZXJmb3JtKCkge1xuICAgIGNvbnN0IHN5bmNDbGllbnQgPSBjdXJyZW50U3luY0NsaWVudE9yTnVsbCgpXG5cbiAgICBpZiAoIXN5bmNDbGllbnQpIHtcbiAgICAgIHZvaWQgbG9nZ2VyLmRlYnVnKFwic3luYyByZXBsYXkgc2tpcHBlZCBiZWNhdXNlIG5vIHN5bmMgY2xpZW50IGlzIHJlZ2lzdGVyZWRcIilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNDbGllbnQucmVwbGF5UGVuZGluZygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFBlbmRpbmcgcm93cyBzdXJ2aXZlIGEgZmFpbGVkIG9yIG9mZmxpbmUgcmVwbGF5LCBzbyB0aGUgbmV4dCBlbnF1ZXVlIHJldHJpZXNcbiAgICAgIC8vIHRoZW0uIFJlLXRocm93aW5nIHdvdWxkIG1ha2UgdGhlIGFkYXB0ZXIgcmV0cnkgYSBkZXZpY2UgdGhhdCBtYXkgYmUgb2ZmbGluZVxuICAgICAgLy8gZm9yIGhvdXJzIGFuZCBtYXJrIGhlYWx0aHkgb2ZmbGluZSBwZXJpb2RzIGFzIGpvYiBmYWlsdXJlcy5cbiAgICAgIHZvaWQgbG9nZ2VyLmVycm9yKCgpID0+IFtcInN5bmMgcmVwbGF5IGZhaWxlZCAocGVuZGluZyByb3dzIHN0YXkgcXVldWVkKVwiLCBlcnJvcl0pXG4gICAgfVxuICB9XG59XG4iXX0=