// @ts-check
import BackgroundJobsAdapter from "./adapter.js";
import LocalBackgroundJobsDispatcher from "./local-dispatcher.js";
import LocalBackgroundJobRegistry from "./local-job-registry.js";
import LocalBackgroundJobsStore, { localBackgroundJobsClock } from "./local-store.js";
/** Durable local SQLite adapter with an owned in-process dispatcher. */
export default class LocalBackgroundJobsAdapter extends BackgroundJobsAdapter {
    /**
     * Creates a local adapter for one configuration and database.
     * @param {object} args - Adapter options.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {import("./types.js").LocalBackgroundJobsClock} [args.clock] - Injectable clock.
     * @param {string} [args.databaseIdentifier] - Local database identifier.
     */
    constructor({ configuration, clock = localBackgroundJobsClock(), databaseIdentifier }) {
        super();
        this.clock = clock;
        this.configuration = configuration;
        this.registry = new LocalBackgroundJobRegistry({ jobClasses: configuration.getBackgroundJobClasses() });
        this.store = new LocalBackgroundJobsStore({
            clock,
            configuration,
            databaseIdentifier,
            onCommittedEnqueue: () => this.dispatcher.wake()
        });
        this.dispatcher = new LocalBackgroundJobsDispatcher({ clock, configuration, registry: this.registry, store: this.store });
    }
    /**
     * Ensures that local persistence and dispatch are ready.
     * @returns {Promise<void>} - Resolves when local dispatch is ready.
     */
    async ensureReady() { await this.dispatcher.start(); }
    /**
     * Stops local dispatch gracefully.
     * @returns {Promise<void>} - Resolves after graceful local shutdown.
     */
    async close() {
        await this.dispatcher.stop();
        this.store.resetReadiness();
    }
    /**
     * Reports local dispatcher health.
     * @returns {Promise<import("./types.js").BackgroundJobsHealth>} - Local adapter health.
     */
    async health() { return { ready: this.dispatcher.isReady() }; }
    /**
     * Reconciles configuration-derived queue concurrency caps.
     * @returns {Promise<void>} - Resolves after queue cap reconciliation.
     */
    async reconcileQueueConcurrency() { await this.store.reconcileQueueConcurrency(); }
    /**
     * Enqueues one statically registered local job.
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Enqueue request.
     * @returns {Promise<string>} - Durable local job id.
     */
    async enqueue(args) {
        await this.ensureReady();
        this.registry.resolve(args.jobName);
        return await this.store.enqueue(args);
    }
    /**
     * Rejects stable-key cancellation, which is outside the local adapter contract.
     * @param {string} _scheduleKey - Unsupported stable key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Never resolves.
     */
    async cancelScheduled(_scheduleKey) { throw new Error("cancelScheduled is not supported by the local background-jobs adapter"); }
    /**
     * Rejects stable-key replacement, which is outside the local adapter contract.
     * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Unsupported request.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Never resolves.
     */
    async replaceScheduled(_args) { throw new Error("replaceScheduled is not supported by the local background-jobs adapter"); }
    /**
     * Finds the next eligible local job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible job.
     */
    async nextAvailableJob() { return await this.store.nextAvailableJob(); }
    /**
     * Finds the next future local job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next future job.
     */
    async nextScheduledJob() { return await this.store.nextScheduledJob(); }
    /**
     * Finds a local job by id.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted job.
     */
    async getJob(jobId) { return await this.store.getJob(jobId); }
    /**
     * Lists local jobs in insertion order.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Local jobs.
     */
    async listJobs() { return await this.store.listJobs(); }
    /**
     * Claims one queued local job.
     * @param {import("./types.js").BackgroundJobHandoffRequest} args - Claim request. A supplied handoff id is persisted exactly.
     * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Handoff.
     */
    async markHandedOff(args) { return await this.store.markHandedOff(args); }
    /**
     * Finds active local handoffs owned by one worker.
     * @param {{workerId: string}} args - Worker identity.
     * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active worker handoffs.
     */
    async handedOffJobsForWorker(args) { return await this.store.handedOffJobsForWorker(args); }
    /**
     * Returns an exact active local handoff to the queue.
     * @param {{jobId: string, handoffId: string}} args - Handoff release.
     * @returns {Promise<void>} - Resolves after the fenced release.
     */
    async markReturnedToQueue(args) { await this.store.markReturnedToQueue(args); }
    /**
     * Acknowledges successful local job completion.
     * @param {{jobId: string, handoffId?: string}} args - Completion report.
     * @returns {Promise<boolean>} - Whether accepted.
     */
    async markCompleted(args) { return await this.store.markCompleted(args); }
    /**
     * Records pooled-child acceptance evidence for a local handoff.
     * @param {{jobId: string, handoffId?: string, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number}} args - Acceptance report.
     * @returns {Promise<boolean>} - Whether accepted.
     */
    async markChildAccepted(args) { return await this.store.markChildAccepted(args); }
    /**
     * Acknowledges an explicit local reschedule.
     * @param {{jobId: string, delayMs: number, handoffId?: string}} args - Reschedule report.
     * @returns {Promise<boolean>} - Whether accepted.
     */
    async markRescheduled(args) { return await this.store.markRescheduled(args); }
    /**
     * Acknowledges a failed local performance.
     * @param {{jobId: string, error: ReturnType<typeof JSON.parse>, handoffId?: string}} args - Failure report.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Transition.
     */
    async markFailed(args) { return await this.store.markFailed(args); }
    /**
     * Coalesces a dispatcher wake.
     * @returns {void} - No return value.
     */
    wake() { this.dispatcher.wake(); }
    /**
     * Waits until current local work has been acknowledged.
     * @returns {Promise<void>} - Resolves after all current work is acknowledged.
     */
    async waitForIdle() { await this.dispatcher.waitForIdle(); }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtYWRhcHRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbG9jYWwtYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxxQkFBcUIsTUFBTSxjQUFjLENBQUE7QUFDaEQsT0FBTyw2QkFBNkIsTUFBTSx1QkFBdUIsQ0FBQTtBQUNqRSxPQUFPLDBCQUEwQixNQUFNLHlCQUF5QixDQUFBO0FBQ2hFLE9BQU8sd0JBQXdCLEVBQUUsRUFBQyx3QkFBd0IsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBRW5GLHdFQUF3RTtBQUN4RSxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEyQixTQUFRLHFCQUFxQjtJQUMzRTs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLEtBQUssR0FBRyx3QkFBd0IsRUFBRSxFQUFFLGtCQUFrQixFQUFDO1FBQ2pGLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLDBCQUEwQixDQUFDLEVBQUMsVUFBVSxFQUFFLGFBQWEsQ0FBQyx1QkFBdUIsRUFBRSxFQUFDLENBQUMsQ0FBQTtRQUNyRyxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksd0JBQXdCLENBQUM7WUFDeEMsS0FBSztZQUNMLGFBQWE7WUFDYixrQkFBa0I7WUFDbEIsa0JBQWtCLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUU7U0FDakQsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLDZCQUE2QixDQUFDLEVBQUMsS0FBSyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsSUFBSSxD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QUFpQixDQUFDLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVqRjs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxJQUFJLElBQUksT0FBTyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUU3RTs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJLElBQUksT0FBTyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVuRTs7O09BR0c7SUFDSCxJQUFJLEtBQUssSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFFakM7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsS0FBSyxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxFQUFFLENBQUEsQ0FBQyxDQUFDO0NBQzVEIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZnJvbSBcIi4vYWRhcHRlci5qc1wiXG5pbXBvcnQgTG9jYWxCYWNrZ3JvdW5kSm9ic0Rpc3BhdGNoZXIgZnJvbSBcIi4vbG9jYWwtZGlzcGF0Y2hlci5qc1wiXG5pbXBvcnQgTG9jYWxCYWNrZ3JvdW5kSm9iUmVnaXN0cnkgZnJvbSBcIi4vbG9jYWwtam9iLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBMb2NhbEJhY2tncm91bmRKb2JzU3RvcmUsIHtsb2NhbEJhY2tncm91bmRKb2JzQ2xvY2t9IGZyb20gXCIuL2xvY2FsLXN0b3JlLmpzXCJcblxuLyoqIER1cmFibGUgbG9jYWwgU1FMaXRlIGFkYXB0ZXIgd2l0aCBhbiBvd25lZCBpbi1wcm9jZXNzIGRpc3BhdGNoZXIuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2NhbEJhY2tncm91bmRKb2JzQWRhcHRlciBleHRlbmRzIEJhY2tncm91bmRKb2JzQWRhcHRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbG9jYWwgYWRhcHRlciBmb3Igb25lIGNvbmZpZ3VyYXRpb24gYW5kIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkYXB0ZXIgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuTG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrfSBbYXJncy5jbG9ja10gLSBJbmplY3RhYmxlIGNsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyXSAtIExvY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY2xvY2sgPSBsb2NhbEJhY2tncm91bmRKb2JzQ2xvY2soKSwgZGF0YWJhc2VJZGVudGlmaWVyfSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmNsb2NrID0gY2xvY2tcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5yZWdpc3RyeSA9IG5ldyBMb2NhbEJhY2tncm91bmRKb2JSZWdpc3RyeSh7am9iQ2xhc3NlczogY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpfSlcbiAgICB0aGlzLnN0b3JlID0gbmV3IExvY2FsQmFja2dyb3VuZEpvYnNTdG9yZSh7XG4gICAgICBjbG9jayxcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBvbkNvbW1pdHRlZEVucXVldWU6ICgpID0+IHRoaXMuZGlzcGF0Y2hlci53YWtlKClcbiAgICB9KVxuICAgIHRoaXMuZGlzcGF0Y2hlciA9IG5ldyBMb2NhbEJhY2tncm91bmRKb2JzRGlzcGF0Y2hlcih7Y2xvY2ssIGNvbmZpZ3VyYXRpb24sIHJlZ2lzdHJ5OiB0aGlzLnJlZ2lzdHJ5LCBzdG9yZTogdGhpcy5zdG9yZX0pXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGF0IGxvY2FsIHBlcnNpc3RlbmNlIGFuZCBkaXNwYXRjaCBhcmUgcmVhZHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gbG9jYWwgZGlzcGF0Y2ggaXMgcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHsgYXdhaXQgdGhpcy5kaXNwYXRjaGVyLnN0YXJ0KCkgfVxuXG4gIC8qKlxuICAgKiBTdG9wcyBsb2NhbCBkaXNwYXRjaCBncmFjZWZ1bGx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBncmFjZWZ1bCBsb2NhbCBzaHV0ZG93bi5cbiAgICovXG4gIGFzeW5jIGNsb3NlKCkge1xuICAgIGF3YWl0IHRoaXMuZGlzcGF0Y2hlci5zdG9wKClcbiAgICB0aGlzLnN0b3JlLnJlc2V0UmVhZGluZXNzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGxvY2FsIGRpc3BhdGNoZXIgaGVhbHRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzSGVhbHRoPn0gLSBMb2NhbCBhZGFwdGVyIGhlYWx0aC5cbiAgICovXG4gIGFzeW5jIGhlYWx0aCgpIHsgcmV0dXJuIHtyZWFkeTogdGhpcy5kaXNwYXRjaGVyLmlzUmVhZHkoKX0gfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIGNvbmZpZ3VyYXRpb24tZGVyaXZlZCBxdWV1ZSBjb25jdXJyZW5jeSBjYXBzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBxdWV1ZSBjYXAgcmVjb25jaWxpYXRpb24uXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KCkgeyBhd2FpdCB0aGlzLnN0b3JlLnJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB9XG5cbiAgLyoqXG4gICAqIEVucXVldWVzIG9uZSBzdGF0aWNhbGx5IHJlZ2lzdGVyZWQgbG9jYWwgam9iLlxuICAgKiBAcGFyYW0ge3tqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBhcmdzIC0gRW5xdWV1ZSByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIER1cmFibGUgbG9jYWwgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZShhcmdzKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgdGhpcy5yZWdpc3RyeS5yZXNvbHZlKGFyZ3Muam9iTmFtZSlcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5lbnF1ZXVlKGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBzdGFibGUta2V5IGNhbmNlbGxhdGlvbiwgd2hpY2ggaXMgb3V0c2lkZSB0aGUgbG9jYWwgYWRhcHRlciBjb250cmFjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zY2hlZHVsZUtleSAtIFVuc3VwcG9ydGVkIHN0YWJsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gTmV2ZXIgcmVzb2x2ZXMuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoX3NjaGVkdWxlS2V5KSB7IHRocm93IG5ldyBFcnJvcihcImNhbmNlbFNjaGVkdWxlZCBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgYWRhcHRlclwiKSB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgc3RhYmxlLWtleSByZXBsYWNlbWVudCwgd2hpY2ggaXMgb3V0c2lkZSB0aGUgbG9jYWwgYWRhcHRlciBjb250cmFjdC5cbiAgICogQHBhcmFtIHt7c2NoZWR1bGVLZXk6IHN0cmluZywgam9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfX0gX2FyZ3MgLSBVbnN1cHBvcnRlZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IC0gTmV2ZXIgcmVzb2x2ZXMuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcInJlcGxhY2VTY2hlZHVsZWQgaXMgbm90IHN1cHBvcnRlZCBieSB0aGUgbG9jYWwgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXJcIikgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgbmV4dCBlbGlnaWJsZSBsb2NhbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgZWxpZ2libGUgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYigpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubmV4dEF2YWlsYWJsZUpvYigpIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIG5leHQgZnV0dXJlIGxvY2FsIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBmdXR1cmUgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dFNjaGVkdWxlZEpvYigpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubmV4dFNjaGVkdWxlZEpvYigpIH1cblxuICAvKipcbiAgICogRmluZHMgYSBsb2NhbCBqb2IgYnkgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gUGVyc2lzdGVkIGpvYi5cbiAgICovXG4gIGFzeW5jIGdldEpvYihqb2JJZCkgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5nZXRKb2Ioam9iSWQpIH1cblxuICAvKipcbiAgICogTGlzdHMgbG9jYWwgam9icyBpbiBpbnNlcnRpb24gb3JkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBMb2NhbCBqb2JzLlxuICAgKi9cbiAgYXN5bmMgbGlzdEpvYnMoKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLmxpc3RKb2JzKCkgfVxuXG4gIC8qKlxuICAgKiBDbGFpbXMgb25lIHF1ZXVlZCBsb2NhbCBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlJlcXVlc3R9IGFyZ3MgLSBDbGFpbSByZXF1ZXN0LiBBIHN1cHBsaWVkIGhhbmRvZmYgaWQgaXMgcGVyc2lzdGVkIGV4YWN0bHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYgfCBudWxsPn0gLSBIYW5kb2ZmLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZihhcmdzKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm1hcmtIYW5kZWRPZmYoYXJncykgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhY3RpdmUgbG9jYWwgaGFuZG9mZnMgb3duZWQgYnkgb25lIHdvcmtlci5cbiAgICogQHBhcmFtIHt7d29ya2VySWQ6IHN0cmluZ319IGFyZ3MgLSBXb3JrZXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgd29ya2VyIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGVkT2ZmSm9ic0ZvcldvcmtlcihhcmdzKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLmhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoYXJncykgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGV4YWN0IGFjdGl2ZSBsb2NhbCBoYW5kb2ZmIHRvIHRoZSBxdWV1ZS5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9fSBhcmdzIC0gSGFuZG9mZiByZWxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZmVuY2VkIHJlbGVhc2UuXG4gICAqL1xuICBhc3luYyBtYXJrUmV0dXJuZWRUb1F1ZXVlKGFyZ3MpIHsgYXdhaXQgdGhpcy5zdG9yZS5tYXJrUmV0dXJuZWRUb1F1ZXVlKGFyZ3MpIH1cblxuICAvKipcbiAgICogQWNrbm93bGVkZ2VzIHN1Y2Nlc3NmdWwgbG9jYWwgam9iIGNvbXBsZXRpb24uXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZ319IGFyZ3MgLSBDb21wbGV0aW9uIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtDb21wbGV0ZWQoYXJncykgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5tYXJrQ29tcGxldGVkKGFyZ3MpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZSBmb3IgYSBsb2NhbCBoYW5kb2ZmLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHJlY2VpdmVkQXRNcz86IG51bWJlciwgc3RhcnRlZEF0TXM/OiBudW1iZXIsIGNoaWxkSW5zdGFuY2VJZD86IHN0cmluZywgY2hpbGRQaWQ/OiBudW1iZXJ9fSBhcmdzIC0gQWNjZXB0YW5jZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ2hpbGRBY2NlcHRlZChhcmdzKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm1hcmtDaGlsZEFjY2VwdGVkKGFyZ3MpIH1cblxuICAvKipcbiAgICogQWNrbm93bGVkZ2VzIGFuIGV4cGxpY2l0IGxvY2FsIHJlc2NoZWR1bGUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGRlbGF5TXM6IG51bWJlciwgaGFuZG9mZklkPzogc3RyaW5nfX0gYXJncyAtIFJlc2NoZWR1bGUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKGFyZ3MpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubWFya1Jlc2NoZWR1bGVkKGFyZ3MpIH1cblxuICAvKipcbiAgICogQWNrbm93bGVkZ2VzIGEgZmFpbGVkIGxvY2FsIHBlcmZvcm1hbmNlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhhbmRvZmZJZD86IHN0cmluZ319IGFyZ3MgLSBGYWlsdXJlIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gVHJhbnNpdGlvbi5cbiAgICovXG4gIGFzeW5jIG1hcmtGYWlsZWQoYXJncykgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5tYXJrRmFpbGVkKGFyZ3MpIH1cblxuICAvKipcbiAgICogQ29hbGVzY2VzIGEgZGlzcGF0Y2hlciB3YWtlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB3YWtlKCkgeyB0aGlzLmRpc3BhdGNoZXIud2FrZSgpIH1cblxuICAvKipcbiAgICogV2FpdHMgdW50aWwgY3VycmVudCBsb2NhbCB3b3JrIGhhcyBiZWVuIGFja25vd2xlZGdlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIGN1cnJlbnQgd29yayBpcyBhY2tub3dsZWRnZWQuXG4gICAqL1xuICBhc3luYyB3YWl0Rm9ySWRsZSgpIHsgYXdhaXQgdGhpcy5kaXNwYXRjaGVyLndhaXRGb3JJZGxlKCkgfVxufVxuIl19