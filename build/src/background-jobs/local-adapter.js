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
     * Cancels or detaches the current owner of a stable schedule key.
     * @param {string} scheduleKey - Stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    async cancelScheduled(scheduleKey) {
        await this.ensureReady();
        return await this.store.cancelScheduled(scheduleKey);
    }
    /**
     * Replaces the current owner of a stable schedule key.
     * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Replacement request.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    async replaceScheduled(args) {
        await this.ensureReady();
        this.registry.resolve(args.jobName);
        return await this.store.replaceScheduled(args);
    }
    /**
     * Reads stable ownership and optional terminal history.
     * @param {string} scheduleKey - Stable schedule key.
     * @param {{includeLatestTerminal?: boolean}} [options] - Lookup options.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized local jobs.
     */
    async getScheduledJob(scheduleKey, options) {
        await this.ensureReady();
        return await this.store.getScheduledJob(scheduleKey, options);
    }
    /**
     * Makes a future queued stable owner due without replacing it.
     * @param {string} scheduleKey - Stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Exact wake result.
     */
    async wakeScheduled(scheduleKey) {
        await this.ensureReady();
        return await this.store.wakeScheduled(scheduleKey);
    }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtYWRhcHRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbG9jYWwtYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxxQkFBcUIsTUFBTSxjQUFjLENBQUE7QUFDaEQsT0FBTyw2QkFBNkIsTUFBTSx1QkFBdUIsQ0FBQTtBQUNqRSxPQUFPLDBCQUEwQixNQUFNLHlCQUF5QixDQUFBO0FBQ2hFLE9BQU8sd0JBQXdCLEVBQUUsRUFBQyx3QkFBd0IsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBRW5GLHdFQUF3RTtBQUN4RSxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEyQixTQUFRLHFCQUFxQjtJQUMzRTs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLEtBQUssR0FBRyx3QkFBd0IsRUFBRSxFQUFFLGtCQUFrQixFQUFDO1FBQ2pGLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLDBCQUEwQixDQUFDLEVBQUMsVUFBVSxFQUFFLGFBQWEsQ0FBQyx1QkFBdUIsRUFBRSxFQUFDLENBQUMsQ0FBQTtRQUNyRyxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksd0JBQXdCLENBQUM7WUFDeEMsS0FBSztZQUNMLGFBQWE7WUFDYixrQkFBa0I7WUFDbEIsa0JBQWtCLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUU7U0FDakQsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLDZCQUE2QixDQUFDLEVBQUMsS0FBSyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsSUFBSSxD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RUFBRSxDQUFBLENBQUMsQ0FBQztDQUM1RCIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGZyb20gXCIuL2FkYXB0ZXIuanNcIlxuaW1wb3J0IExvY2FsQmFja2dyb3VuZEpvYnNEaXNwYXRjaGVyIGZyb20gXCIuL2xvY2FsLWRpc3BhdGNoZXIuanNcIlxuaW1wb3J0IExvY2FsQmFja2dyb3VuZEpvYlJlZ2lzdHJ5IGZyb20gXCIuL2xvY2FsLWpvYi1yZWdpc3RyeS5qc1wiXG5pbXBvcnQgTG9jYWxCYWNrZ3JvdW5kSm9ic1N0b3JlLCB7bG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrfSBmcm9tIFwiLi9sb2NhbC1zdG9yZS5qc1wiXG5cbi8qKiBEdXJhYmxlIGxvY2FsIFNRTGl0ZSBhZGFwdGVyIHdpdGggYW4gb3duZWQgaW4tcHJvY2VzcyBkaXNwYXRjaGVyLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTG9jYWxCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZXh0ZW5kcyBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIGxvY2FsIGFkYXB0ZXIgZm9yIG9uZSBjb25maWd1cmF0aW9uIGFuZCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBZGFwdGVyIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBPd25pbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkxvY2FsQmFja2dyb3VuZEpvYnNDbG9ja30gW2FyZ3MuY2xvY2tdIC0gSW5qZWN0YWJsZSBjbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBMb2NhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGNsb2NrID0gbG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrKCksIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5jbG9jayA9IGNsb2NrXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMucmVnaXN0cnkgPSBuZXcgTG9jYWxCYWNrZ3JvdW5kSm9iUmVnaXN0cnkoe2pvYkNsYXNzZXM6IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYkNsYXNzZXMoKX0pXG4gICAgdGhpcy5zdG9yZSA9IG5ldyBMb2NhbEJhY2tncm91bmRKb2JzU3RvcmUoe1xuICAgICAgY2xvY2ssXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgb25Db21taXR0ZWRFbnF1ZXVlOiAoKSA9PiB0aGlzLmRpc3BhdGNoZXIud2FrZSgpXG4gICAgfSlcbiAgICB0aGlzLmRpc3BhdGNoZXIgPSBuZXcgTG9jYWxCYWNrZ3JvdW5kSm9ic0Rpc3BhdGNoZXIoe2Nsb2NrLCBjb25maWd1cmF0aW9uLCByZWdpc3RyeTogdGhpcy5yZWdpc3RyeSwgc3RvcmU6IHRoaXMuc3RvcmV9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhhdCBsb2NhbCBwZXJzaXN0ZW5jZSBhbmQgZGlzcGF0Y2ggYXJlIHJlYWR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGxvY2FsIGRpc3BhdGNoIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7IGF3YWl0IHRoaXMuZGlzcGF0Y2hlci5zdGFydCgpIH1cblxuICAvKipcbiAgICogU3RvcHMgbG9jYWwgZGlzcGF0Y2ggZ3JhY2VmdWxseS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZ3JhY2VmdWwgbG9jYWwgc2h1dGRvd24uXG4gICAqL1xuICBhc3luYyBjbG9zZSgpIHtcbiAgICBhd2FpdCB0aGlzLmRpc3BhdGNoZXIuc3RvcCgpXG4gICAgdGhpcy5zdG9yZS5yZXNldFJlYWRpbmVzcygpXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBsb2NhbCBkaXNwYXRjaGVyIGhlYWx0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0hlYWx0aD59IC0gTG9jYWwgYWRhcHRlciBoZWFsdGguXG4gICAqL1xuICBhc3luYyBoZWFsdGgoKSB7IHJldHVybiB7cmVhZHk6IHRoaXMuZGlzcGF0Y2hlci5pc1JlYWR5KCl9IH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBjb25maWd1cmF0aW9uLWRlcml2ZWQgcXVldWUgY29uY3VycmVuY3kgY2Fwcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcXVldWUgY2FwIHJlY29uY2lsaWF0aW9uLlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSgpIHsgYXdhaXQgdGhpcy5zdG9yZS5yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KCkgfVxuXG4gIC8qKlxuICAgKiBFbnF1ZXVlcyBvbmUgc3RhdGljYWxseSByZWdpc3RlcmVkIGxvY2FsIGpvYi5cbiAgICogQHBhcmFtIHt7am9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfX0gYXJncyAtIEVucXVldWUgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBEdXJhYmxlIGxvY2FsIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoYXJncykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHRoaXMucmVnaXN0cnkucmVzb2x2ZShhcmdzLmpvYk5hbWUpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUuZW5xdWV1ZShhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5jYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpXG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3tzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBhcmdzIC0gUmVwbGFjZW1lbnQgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoYXJncykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHRoaXMucmVnaXN0cnkucmVzb2x2ZShhcmdzLmpvYk5hbWUpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUucmVwbGFjZVNjaGVkdWxlZChhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHN0YWJsZSBvd25lcnNoaXAgYW5kIG9wdGlvbmFsIHRlcm1pbmFsIGhpc3RvcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7e2luY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBMb29rdXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gLSBOb3JtYWxpemVkIGxvY2FsIGpvYnMuXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRKb2Ioc2NoZWR1bGVLZXksIG9wdGlvbnMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5nZXRTY2hlZHVsZWRKb2Ioc2NoZWR1bGVLZXksIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogTWFrZXMgYSBmdXR1cmUgcXVldWVkIHN0YWJsZSBvd25lciBkdWUgd2l0aG91dCByZXBsYWNpbmcgaXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYldha2VSZXN1bHQ+fSAtIEV4YWN0IHdha2UgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2FrZVNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLndha2VTY2hlZHVsZWQoc2NoZWR1bGVLZXkpXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIG5leHQgZWxpZ2libGUgbG9jYWwgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IGVsaWdpYmxlIGpvYi5cbiAgICovXG4gIGFzeW5jIG5leHRBdmFpbGFibGVKb2IoKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm5leHRBdmFpbGFibGVKb2IoKSB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGZ1dHVyZSBsb2NhbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgZnV0dXJlIGpvYi5cbiAgICovXG4gIGFzeW5jIG5leHRTY2hlZHVsZWRKb2IoKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm5leHRTY2hlZHVsZWRKb2IoKSB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGEgbG9jYWwgam9iIGJ5IGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFBlcnNpc3RlZCBqb2IuXG4gICAqL1xuICBhc3luYyBnZXRKb2Ioam9iSWQpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUuZ2V0Sm9iKGpvYklkKSB9XG5cbiAgLyoqXG4gICAqIExpc3RzIGxvY2FsIGpvYnMgaW4gaW5zZXJ0aW9uIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gTG9jYWwgam9icy5cbiAgICovXG4gIGFzeW5jIGxpc3RKb2JzKCkgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5saXN0Sm9icygpIH1cblxuICAvKipcbiAgICogQ2xhaW1zIG9uZSBxdWV1ZWQgbG9jYWwgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0fSBhcmdzIC0gQ2xhaW0gcmVxdWVzdC4gQSBzdXBwbGllZCBoYW5kb2ZmIGlkIGlzIHBlcnNpc3RlZCBleGFjdGx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmIHwgbnVsbD59IC0gSGFuZG9mZi5cbiAgICovXG4gIGFzeW5jIG1hcmtIYW5kZWRPZmYoYXJncykgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5tYXJrSGFuZGVkT2ZmKGFyZ3MpIH1cblxuICAvKipcbiAgICogRmluZHMgYWN0aXZlIGxvY2FsIGhhbmRvZmZzIG93bmVkIGJ5IG9uZSB3b3JrZXIuXG4gICAqIEBwYXJhbSB7e3dvcmtlcklkOiBzdHJpbmd9fSBhcmdzIC0gV29ya2VyIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pj59IC0gQWN0aXZlIHdvcmtlciBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIGhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoYXJncykgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5oYW5kZWRPZmZKb2JzRm9yV29ya2VyKGFyZ3MpIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbiBleGFjdCBhY3RpdmUgbG9jYWwgaGFuZG9mZiB0byB0aGUgcXVldWUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfX0gYXJncyAtIEhhbmRvZmYgcmVsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGZlbmNlZCByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZShhcmdzKSB7IGF3YWl0IHRoaXMuc3RvcmUubWFya1JldHVybmVkVG9RdWV1ZShhcmdzKSB9XG5cbiAgLyoqXG4gICAqIEFja25vd2xlZGdlcyBzdWNjZXNzZnVsIGxvY2FsIGpvYiBjb21wbGV0aW9uLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmd9fSBhcmdzIC0gQ29tcGxldGlvbiByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKGFyZ3MpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubWFya0NvbXBsZXRlZChhcmdzKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgZm9yIGEgbG9jYWwgaGFuZG9mZi5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyfX0gYXJncyAtIEFjY2VwdGFuY2UgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NoaWxkQWNjZXB0ZWQoYXJncykgeyByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5tYXJrQ2hpbGRBY2NlcHRlZChhcmdzKSB9XG5cbiAgLyoqXG4gICAqIEFja25vd2xlZGdlcyBhbiBleHBsaWNpdCBsb2NhbCByZXNjaGVkdWxlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBkZWxheU1zOiBudW1iZXIsIGhhbmRvZmZJZD86IHN0cmluZ319IGFyZ3MgLSBSZXNjaGVkdWxlIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXNjaGVkdWxlZChhcmdzKSB7IHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXNjaGVkdWxlZChhcmdzKSB9XG5cbiAgLyoqXG4gICAqIEFja25vd2xlZGdlcyBhIGZhaWxlZCBsb2NhbCBwZXJmb3JtYW5jZS5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBoYW5kb2ZmSWQ/OiBzdHJpbmd9fSBhcmdzIC0gRmFpbHVyZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFRyYW5zaXRpb24uXG4gICAqL1xuICBhc3luYyBtYXJrRmFpbGVkKGFyZ3MpIHsgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubWFya0ZhaWxlZChhcmdzKSB9XG5cbiAgLyoqXG4gICAqIENvYWxlc2NlcyBhIGRpc3BhdGNoZXIgd2FrZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgd2FrZSgpIHsgdGhpcy5kaXNwYXRjaGVyLndha2UoKSB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIHVudGlsIGN1cnJlbnQgbG9jYWwgd29yayBoYXMgYmVlbiBhY2tub3dsZWRnZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFsbCBjdXJyZW50IHdvcmsgaXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgYXN5bmMgd2FpdEZvcklkbGUoKSB7IGF3YWl0IHRoaXMuZGlzcGF0Y2hlci53YWl0Rm9ySWRsZSgpIH1cbn1cbiJdfQ==