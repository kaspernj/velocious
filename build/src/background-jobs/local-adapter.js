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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtYWRhcHRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbG9jYWwtYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxxQkFBcUIsTUFBTSxjQUFjLENBQUE7QUFDaEQsT0FBTyw2QkFBNkIsTUFBTSx1QkFBdUIsQ0FBQTtBQUNqRSxPQUFPLDBCQUEwQixNQUFNLHlCQUF5QixDQUFBO0FBQ2hFLE9BQU8sd0JBQXdCLEVBQUUsRUFBQyx3QkFBd0IsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBRW5GLHdFQUF3RTtBQUN4RSxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEyQixTQUFRLHFCQUFxQjtJQUMzRTs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLEtBQUssR0FBRyx3QkFBd0IsRUFBRSxFQUFFLGtCQUFrQixFQUFDO1FBQ2pGLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLDBCQUEwQixDQUFDLEVBQUMsVUFBVSxFQUFFLGFBQWEsQ0FBQyx1QkFBdUIsRUFBRSxFQUFDLENBQUMsQ0FBQTtRQUNyRyxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksd0JBQXdCLENBQUM7WUFDeEMsS0FBSztZQUNMLGFBQWE7WUFDYixrQkFBa0I7WUFDbEIsa0JBQWtCLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUU7U0FDakQsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLDZCQUE2QixDQUFDLEVBQUMsS0FBSyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsSUFBSSxD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LENBQUMsSUFBSSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTdFOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsVUFBVSxDQUFDLElBQUksSUFBSSxPQUFPLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5FOzs7T0FHRztJQUNILElBQUksS0FBSyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxDQUFBLENBQUMsQ0FBQztJQUVqQzs7O09BR0c7SUFDSCxLQUFLLENBQUMsV0FBVyxLQUFLLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQSxDQUFDLENBQUM7Q0FDNUQiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi9hZGFwdGVyLmpzXCJcbmltcG9ydCBMb2NhbEJhY2tncm91bmRKb2JzRGlzcGF0Y2hlciBmcm9tIFwiLi9sb2NhbC1kaXNwYXRjaGVyLmpzXCJcbmltcG9ydCBMb2NhbEJhY2tncm91bmRKb2JSZWdpc3RyeSBmcm9tIFwiLi9sb2NhbC1qb2ItcmVnaXN0cnkuanNcIlxuaW1wb3J0IExvY2FsQmFja2dyb3VuZEpvYnNTdG9yZSwge2xvY2FsQmFja2dyb3VuZEpvYnNDbG9ja30gZnJvbSBcIi4vbG9jYWwtc3RvcmUuanNcIlxuXG4vKiogRHVyYWJsZSBsb2NhbCBTUUxpdGUgYWRhcHRlciB3aXRoIGFuIG93bmVkIGluLXByb2Nlc3MgZGlzcGF0Y2hlci4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIExvY2FsQmFja2dyb3VuZEpvYnNBZGFwdGVyIGV4dGVuZHMgQmFja2dyb3VuZEpvYnNBZGFwdGVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBsb2NhbCBhZGFwdGVyIGZvciBvbmUgY29uZmlndXJhdGlvbiBhbmQgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWRhcHRlciBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gT3duaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Mb2NhbEJhY2tncm91bmRKb2JzQ2xvY2t9IFthcmdzLmNsb2NrXSAtIEluamVjdGFibGUgY2xvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUlkZW50aWZpZXJdIC0gTG9jYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjbG9jayA9IGxvY2FsQmFja2dyb3VuZEpvYnNDbG9jaygpLCBkYXRhYmFzZUlkZW50aWZpZXJ9KSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuY2xvY2sgPSBjbG9ja1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLnJlZ2lzdHJ5ID0gbmV3IExvY2FsQmFja2dyb3VuZEpvYlJlZ2lzdHJ5KHtqb2JDbGFzc2VzOiBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JDbGFzc2VzKCl9KVxuICAgIHRoaXMuc3RvcmUgPSBuZXcgTG9jYWxCYWNrZ3JvdW5kSm9ic1N0b3JlKHtcbiAgICAgIGNsb2NrLFxuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIG9uQ29tbWl0dGVkRW5xdWV1ZTogKCkgPT4gdGhpcy5kaXNwYXRjaGVyLndha2UoKVxuICAgIH0pXG4gICAgdGhpcy5kaXNwYXRjaGVyID0gbmV3IExvY2FsQmFja2dyb3VuZEpvYnNEaXNwYXRjaGVyKHtjbG9jaywgY29uZmlndXJhdGlvbiwgcmVnaXN0cnk6IHRoaXMucmVnaXN0cnksIHN0b3JlOiB0aGlzLnN0b3JlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoYXQgbG9jYWwgcGVyc2lzdGVuY2UgYW5kIGRpc3BhdGNoIGFyZSByZWFkeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBsb2NhbCBkaXNwYXRjaCBpcyByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KCkgeyBhd2FpdCB0aGlzLmRpc3BhdGNoZXIuc3RhcnQoKSB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIGxvY2FsIGRpc3BhdGNoIGdyYWNlZnVsbHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGdyYWNlZnVsIGxvY2FsIHNodXRkb3duLlxuICAgKi9cbiAgYXN5bmMgY2xvc2UoKSB7XG4gICAgYXdhaXQgdGhpcy5kaXNwYXRjaGVyLnN0b3AoKVxuICAgIHRoaXMuc3RvcmUucmVzZXRSZWFkaW5lc3MoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgbG9jYWwgZGlzcGF0Y2hlciBoZWFsdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNIZWFsdGg+fSAtIExvY2FsIGFkYXB0ZXIgaGVhbHRoLlxuICAgKi9cbiAgYXN5bmMgaGVhbHRoKCkgeyByZXR1cm4ge3JlYWR5OiB0aGlzLmRpc3BhdGNoZXIuaXNSZWFkeSgpfSB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgY29uZmlndXJhdGlvbi1kZXJpdmVkIHF1ZXVlIGNvbmN1cnJlbmN5IGNhcHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHF1ZXVlIGNhcCByZWNvbmNpbGlhdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7IGF3YWl0IHRoaXMuc3RvcmUucmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSgpIH1cblxuICAvKipcbiAgICogRW5xdWV1ZXMgb25lIHN0YXRpY2FsbHkgcmVnaXN0ZXJlZCBsb2NhbCBqb2IuXG4gICAqIEBwYXJhbSB7e2pvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc319IGFyZ3MgLSBFbnF1ZXVlIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gRHVyYWJsZSBsb2NhbCBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKGFyZ3MpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICB0aGlzLnJlZ2lzdHJ5LnJlc29sdmUoYXJncy5qb2JOYW1lKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLmVucXVldWUoYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIHN0YWJsZS1rZXkgY2FuY2VsbGF0aW9uLCB3aGljaCBpcyBvdXRzaWRlIHRoZSBsb2NhbCBhZGFwdGVyIGNvbnRyYWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3NjaGVkdWxlS2V5IC0gVW5zdXBwb3J0ZWQgc3RhYmxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBOZXZlciByZXNvbHZlcy5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChfc2NoZWR1bGVLZXkpIHsgdGhyb3cgbmV3IEVycm9yKFwiY2FuY2VsU2NoZWR1bGVkIGlzIG5vdCBzdXBwb3J0ZWQgYnkgdGhlIGxvY2FsIGJhY2tncm91bmQtam9icyBhZGFwdGVyXCIpIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBzdGFibGUta2V5IHJlcGxhY2VtZW50LCB3aGljaCBpcyBvdXRzaWRlIHRoZSBsb2NhbCBhZGFwdGVyIGNvbnRyYWN0LlxuICAgKiBAcGFyYW0ge3tzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBfYXJncyAtIFVuc3VwcG9ydGVkIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBOZXZlciByZXNvbHZlcy5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwicmVwbGFjZVNjaGVkdWxlZCBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgYWRhcHRlclwiKSB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGVsaWdpYmxlIGxvY2FsIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBlbGlnaWJsZSBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iKCkgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5uZXh0QXZhaWxhYmxlSm9iKCkgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgbmV4dCBmdXR1cmUgbG9jYWwgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IGZ1dHVyZSBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5uZXh0U2NoZWR1bGVkSm9iKCkgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhIGxvY2FsIGpvYiBieSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBQZXJzaXN0ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKGpvYklkKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLmdldEpvYihqb2JJZCkgfVxuXG4gIC8qKlxuICAgKiBMaXN0cyBsb2NhbCBqb2JzIGluIGluc2VydGlvbiBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIExvY2FsIGpvYnMuXG4gICAqL1xuICBhc3luYyBsaXN0Sm9icygpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubGlzdEpvYnMoKSB9XG5cbiAgLyoqXG4gICAqIENsYWltcyBvbmUgcXVldWVkIGxvY2FsIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmUmVxdWVzdH0gYXJncyAtIENsYWltIHJlcXVlc3QuIEEgc3VwcGxpZWQgaGFuZG9mZiBpZCBpcyBwZXJzaXN0ZWQgZXhhY3RseS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiB8IG51bGw+fSAtIEhhbmRvZmYuXG4gICAqL1xuICBhc3luYyBtYXJrSGFuZGVkT2ZmKGFyZ3MpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubWFya0hhbmRlZE9mZihhcmdzKSB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFjdGl2ZSBsb2NhbCBoYW5kb2ZmcyBvd25lZCBieSBvbmUgd29ya2VyLlxuICAgKiBAcGFyYW0ge3t3b3JrZXJJZDogc3RyaW5nfX0gYXJncyAtIFdvcmtlciBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT4+fSAtIEFjdGl2ZSB3b3JrZXIgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKGFyZ3MpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUuaGFuZGVkT2ZmSm9ic0ZvcldvcmtlcihhcmdzKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gZXhhY3QgYWN0aXZlIGxvY2FsIGhhbmRvZmYgdG8gdGhlIHF1ZXVlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ319IGFyZ3MgLSBIYW5kb2ZmIHJlbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBmZW5jZWQgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXR1cm5lZFRvUXVldWUoYXJncykgeyBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXR1cm5lZFRvUXVldWUoYXJncykgfVxuXG4gIC8qKlxuICAgKiBBY2tub3dsZWRnZXMgc3VjY2Vzc2Z1bCBsb2NhbCBqb2IgY29tcGxldGlvbi5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nfX0gYXJncyAtIENvbXBsZXRpb24gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NvbXBsZXRlZChhcmdzKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm1hcmtDb21wbGV0ZWQoYXJncykgfVxuXG4gIC8qKlxuICAgKiBBY2tub3dsZWRnZXMgYW4gZXhwbGljaXQgbG9jYWwgcmVzY2hlZHVsZS5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgZGVsYXlNczogbnVtYmVyLCBoYW5kb2ZmSWQ/OiBzdHJpbmd9fSBhcmdzIC0gUmVzY2hlZHVsZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoYXJncykgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5tYXJrUmVzY2hlZHVsZWQoYXJncykgfVxuXG4gIC8qKlxuICAgKiBBY2tub3dsZWRnZXMgYSBmYWlsZWQgbG9jYWwgcGVyZm9ybWFuY2UuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGFuZG9mZklkPzogc3RyaW5nfX0gYXJncyAtIEZhaWx1cmUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBUcmFuc2l0aW9uLlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZChhcmdzKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm1hcmtGYWlsZWQoYXJncykgfVxuXG4gIC8qKlxuICAgKiBDb2FsZXNjZXMgYSBkaXNwYXRjaGVyIHdha2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHdha2UoKSB7IHRoaXMuZGlzcGF0Y2hlci53YWtlKCkgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyB1bnRpbCBjdXJyZW50IGxvY2FsIHdvcmsgaGFzIGJlZW4gYWNrbm93bGVkZ2VkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgY3VycmVudCB3b3JrIGlzIGFja25vd2xlZGdlZC5cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JJZGxlKCkgeyBhd2FpdCB0aGlzLmRpc3BhdGNoZXIud2FpdEZvcklkbGUoKSB9XG59XG4iXX0=