// @ts-check
import BackgroundJobRescheduleSignal from "./reschedule-signal.js";
import performBackgroundJob from "./perform-job.js";
/** @typedef {{type: "completed"} | {type: "failed", error: ReturnType<typeof JSON.parse>} | {type: "rescheduled", delayMs: number}} LocalBackgroundJobAcknowledgement */
/**
 * @typedef {object} PendingLocalBackgroundJobAcknowledgement
 * @property {LocalBackgroundJobAcknowledgement} acknowledgement - Durable transition still owned by this dispatcher.
 * @property {import("./types.js").BackgroundJobHandoff} handoff - Fenced handoff being acknowledged.
 * @property {import("./types.js").BackgroundJobRow} job - Claimed job snapshot.
 */
const MAX_TIMER_MS = 2_147_483_647;
const ERROR_RECOVERY_DELAY_MS = 1_000;
/** Configuration-owned, event-driven in-process local dispatcher. */
export default class LocalBackgroundJobsDispatcher {
    /**
     * Creates a dispatcher owned by one configuration and local store.
     * @param {object} args - Dispatcher options.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {import("./types.js").LocalBackgroundJobsClock} args.clock - Dispatcher clock.
     * @param {import("./local-job-registry.js").default} args.registry - Static job registry.
     * @param {import("./local-store.js").default} args.store - Durable local store.
     */
    constructor({ configuration, clock, registry, store }) {
        this.clock = clock;
        this.configuration = configuration;
        this.registry = registry;
        this.store = store;
        this._accepting = false;
        this._started = false;
        /** @type {Promise<void> | null} */
        this._startPromise = null;
        /** @type {Promise<void> | null} */
        this._drainPromise = null;
        this._redrain = false;
        this._wakeQueued = false;
        /** @type {Set<Promise<void>>} */
        this._inFlight = new Set();
        /** @type {Map<string, PendingLocalBackgroundJobAcknowledgement>} */
        this._pendingAcknowledgements = new Map();
        /** @type {Set<() => void>} */
        this._idleWaiters = new Set();
        /** @type {ReturnType<typeof setTimeout> | number | undefined} */
        this._scheduledTimer = undefined;
        /** @type {ReturnType<typeof setTimeout> | number | undefined} */
        this._recoveryTimer = undefined;
    }
    /**
     * Starts, recovers, and catches up the local dispatcher.
     * @returns {Promise<void>} - Resolves after admission starts.
     */
    async start() {
        if (this._started)
            return;
        if (this._startPromise)
            return await this._startPromise;
        this._startPromise = (async () => {
            this.configuration.setCurrent();
            this.registry.ensureReady();
            await this.configuration.initialize({ type: "local-background-jobs" });
            await this.store.ensureReady();
            await this.store.reconcileQueueConcurrency();
            const recoveredJobs = await this.store.recoverHandedOffJobs();
            for (const job of recoveredJobs) {
                this._emitBackgroundJobFailed({
                    error: new Error(job.lastError || "Local background job recovered after an interrupted dispatcher"),
                    job
                });
            }
            this._accepting = true;
            this._started = true;
            this.wake();
        })();
        try {
            await this._startPromise;
        }
        catch (error) {
            this._reportFrameworkError({ error, stage: "local-background-jobs-start" });
            throw error;
        }
        finally {
            this._startPromise = null;
        }
    }
    /**
     * Coalesces a dispatcher wake onto one tracked microtask.
     * @returns {void} - No return value.
     */
    wake() {
        if (!this._accepting)
            return;
        if (this._drainPromise || this._wakeQueued) {
            this._redrain = true;
            return;
        }
        this._wakeQueued = true;
        /** @type {Promise<void>} */
        let drainPromise;
        drainPromise = this.configuration.withoutCurrentTestDatabaseAccessScope(() => {
            return this.configuration.withoutCurrentConnectionContexts(() => {
                return Promise
                    .resolve()
                    .then(async () => {
                    this._wakeQueued = false;
                    await this._drain();
                })
                    .catch((error) => {
                    try {
                        this._reportFrameworkError({ error, stage: "local-background-jobs-drain" });
                    }
                    finally {
                        this._armRecoveryTimer();
                    }
                })
                    .finally(() => {
                    if (this._drainPromise === drainPromise)
                        this._drainPromise = null;
                    if (this._redrain && this._accepting) {
                        this._redrain = false;
                        this.wake();
                    }
                    else {
                        this._resolveIdleWaiters();
                    }
                });
            });
        });
        this._drainPromise = drainPromise;
    }
    /**
     * Fills local capacity with short durable claims.
     * @returns {Promise<void>} - Resolves after one stable drain pass.
     */
    async _drain() {
        await this._retryPendingAcknowledgements();
        while (this._accepting && this._ownedPerformanceCount() < this._maxConcurrentJobs()) {
            const job = await this.store.nextAvailableJob();
            if (!job)
                break;
            const handoff = await this.store.markHandedOff({ jobId: job.id });
            if (!handoff) {
                this._redrain = true;
                break;
            }
            this._startPerformance({ handoff, job });
        }
        await this._armScheduledTimer();
    }
    /**
     * Runs one claimed performance without retaining its claim transaction connection.
     * @param {{handoff: import("./types.js").BackgroundJobHandoff, job: import("./types.js").BackgroundJobRow}} args - Claimed job.
     * @returns {void} - No return value.
     */
    _startPerformance({ handoff, job }) {
        const performance = this._perform({ handoff, job });
        this._inFlight.add(performance);
        void performance
            .catch((error) => this._reportFrameworkError({ error, stage: "local-background-jobs-performance" }))
            .finally(() => {
            this._inFlight.delete(performance);
            if (this._accepting)
                this.wake();
            this._resolveIdleWaiters();
        });
    }
    /**
     * Performs and acknowledges one durable handoff.
     * @param {{handoff: import("./types.js").BackgroundJobHandoff, job: import("./types.js").BackgroundJobRow}} args - Claimed job.
     * @returns {Promise<void>} - Resolves after acknowledgement.
     */
    async _perform({ handoff, job }) {
        /** @type {LocalBackgroundJobAcknowledgement} */
        let acknowledgement = { type: "completed" };
        try {
            const JobClass = this.registry.resolve(job.jobName);
            await performBackgroundJob({
                configuration: this.configuration,
                JobClass,
                jobArgs: job.args,
                jobOptions: {
                    concurrencyKey: job.concurrencyKey || undefined,
                    executionMode: job.executionMode,
                    maxConcurrency: job.maxConcurrency ?? undefined,
                    maxRetries: job.maxRetries ?? undefined,
                    queue: job.queue,
                    scheduledAtMs: job.scheduledAtMs ?? undefined,
                    timeoutMs: job.timeoutMs ?? undefined
                },
                name: `Local background job: ${job.jobName}`,
                payload: {
                    args: job.args,
                    handedOffAtMs: handoff.handedOffAtMs,
                    handoffId: handoff.handoffId,
                    id: job.id,
                    jobName: job.jobName,
                    options: {
                        concurrencyKey: job.concurrencyKey || undefined,
                        executionMode: job.executionMode,
                        maxConcurrency: job.maxConcurrency ?? undefined,
                        queue: job.queue
                    }
                }
            });
        }
        catch (error) {
            if (error instanceof BackgroundJobRescheduleSignal) {
                acknowledgement = { delayMs: error.delayMs, type: "rescheduled" };
            }
            else {
                acknowledgement = { error, type: "failed" };
            }
        }
        try {
            await this._acknowledge({ acknowledgement, handoff, job });
        }
        catch (error) {
            this._pendingAcknowledgements.set(job.id, { acknowledgement, handoff, job });
            this._reportAcknowledgementError({ acknowledgement, error, handoff, job });
        }
    }
    /**
     * Applies one fenced durable acknowledgement.
     * @param {PendingLocalBackgroundJobAcknowledgement} args - Owned acknowledgement.
     * @returns {Promise<void>} - Resolves after the durable transition is settled.
     */
    async _acknowledge({ acknowledgement, handoff, job }) {
        if (acknowledgement.type === "rescheduled") {
            await this.store.markRescheduled({ delayMs: acknowledgement.delayMs, handoffId: handoff.handoffId, jobId: job.id });
            return;
        }
        if (acknowledgement.type === "failed") {
            const updatedJob = await this.store.markFailed({ error: acknowledgement.error, handoffId: handoff.handoffId, jobId: job.id });
            if (updatedJob)
                this._emitBackgroundJobFailed({ error: acknowledgement.error, job: updatedJob });
            return;
        }
        await this.store.markCompleted({ handoffId: handoff.handoffId, jobId: job.id });
    }
    /**
     * Replays each retained acknowledgement once at an event-driven wake boundary.
     * @param {{throwOnError?: boolean}} [args] - Recovery behavior.
     * @returns {Promise<void>} - Resolves after one bounded recovery pass.
     */
    async _retryPendingAcknowledgements({ throwOnError = false } = {}) {
        for (const [jobId, pendingAcknowledgement] of [...this._pendingAcknowledgements]) {
            try {
                await this._acknowledge(pendingAcknowledgement);
                this._pendingAcknowledgements.delete(jobId);
            }
            catch (error) {
                this._reportAcknowledgementError({ ...pendingAcknowledgement, error });
                if (throwOnError)
                    throw error;
                this._armRecoveryTimer();
            }
        }
    }
    /**
     * Arms the exact next future job timer, chunking platform-sized delays.
     * @returns {Promise<void>} - Resolves after timer reconciliation.
     */
    async _armScheduledTimer() {
        if (this._scheduledTimer !== undefined) {
            this.clock.clearTimeout(this._scheduledTimer);
            this._scheduledTimer = undefined;
        }
        if (!this._accepting)
            return;
        const nextJob = await this.store.nextScheduledJob();
        if (!nextJob || nextJob.scheduledAtMs === null)
            return;
        const delayMs = Math.max(0, Math.min(nextJob.scheduledAtMs - this.clock.now(), MAX_TIMER_MS));
        this._scheduledTimer = this.clock.setTimeout(() => {
            this._scheduledTimer = undefined;
            this.wake();
        }, delayMs);
    }
    /**
     * Arms one bounded retry after an unexpected drain failure.
     * @returns {void} - No return value.
     */
    _armRecoveryTimer() {
        if (!this._accepting || this._recoveryTimer !== undefined)
            return;
        this._recoveryTimer = this.clock.setTimeout(() => {
            this._recoveryTimer = undefined;
            this.wake();
        }, ERROR_RECOVERY_DELAY_MS);
    }
    /**
     * Waits for admission and every in-flight acknowledgement without polling.
     * @returns {Promise<void>} - Resolves when idle.
     */
    async waitForIdle() {
        if (this._isIdle())
            return;
        await new Promise((resolve) => this._idleWaiters.add(() => resolve(undefined)));
    }
    /**
     * Stops claims and waits for in-flight acknowledgement.
     * @returns {Promise<void>} - Resolves after a graceful stop.
     */
    async stop() {
        this._accepting = false;
        this._redrain = false;
        if (this._scheduledTimer !== undefined) {
            this.clock.clearTimeout(this._scheduledTimer);
            this._scheduledTimer = undefined;
        }
        if (this._recoveryTimer !== undefined) {
            this.clock.clearTimeout(this._recoveryTimer);
            this._recoveryTimer = undefined;
        }
        if (this._drainPromise)
            await this._drainPromise;
        if (this._inFlight.size > 0)
            await Promise.all([...this._inFlight]);
        await this._retryPendingAcknowledgements({ throwOnError: true });
        this._wakeQueued = false;
        this._started = false;
        this._resolveIdleWaiters();
    }
    /**
     * Reports whether dispatcher admission has started.
     * @returns {boolean} - Whether dispatcher admission has started.
     */
    isReady() { return this._started && this._accepting; }
    /**
     * Reads the configuration-owned in-process performance cap.
     * @returns {number} - Configuration-owned in-process performance cap.
     */
    _maxConcurrentJobs() { return this.configuration.getBackgroundJobsConfig().maxConcurrentInlineJobs; }
    /**
     * Counts performances whose durable acknowledgement is still owned locally.
     * @returns {number} - Active or pending-acknowledgement performances.
     */
    _ownedPerformanceCount() { return this._inFlight.size + this._pendingAcknowledgements.size; }
    /**
     * Reports whether no admission or acknowledgement work remains.
     * @returns {boolean} - Whether the dispatcher is idle.
     */
    _isIdle() {
        return !this._wakeQueued && !this._drainPromise && this._inFlight.size === 0 && this._pendingAcknowledgements.size === 0;
    }
    /**
     * Resolves event-based idle waiters at a stable idle boundary.
     * @returns {void} - No return value.
     */
    _resolveIdleWaiters() {
        if (!this._isIdle())
            return;
        const waiters = [...this._idleWaiters];
        this._idleWaiters.clear();
        for (const resolve of waiters)
            resolve();
    }
    /**
     * Emits an expected job failure through the standard job/all-error channels.
     * @param {{error: ReturnType<typeof JSON.parse>, job: import("./types.js").BackgroundJobRow}} args - Failure transition.
     * @returns {void} - No return value.
     */
    _emitBackgroundJobFailed({ error, job }) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = {
            context: {
                attempts: job.attempts,
                jobArgs: job.args,
                jobId: job.id,
                jobName: job.jobName,
                maxRetries: job.maxRetries,
                stage: "background-job-failed",
                status: job.status,
                terminal: job.status === "failed",
                willRetry: job.status === "queued",
                workerId: "local"
            },
            error: normalizedError
        };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("background-job-failed", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "background-job-failed" });
    }
    /**
     * Reports one failed durable acknowledgement attempt with its fence context.
     * @param {PendingLocalBackgroundJobAcknowledgement & {error: ReturnType<typeof JSON.parse>}} args - Failed acknowledgement.
     * @returns {void} - No return value.
     */
    _reportAcknowledgementError({ acknowledgement, error, handoff, job }) {
        this._reportFrameworkError({
            context: {
                acknowledgementType: acknowledgement.type,
                handoffId: handoff.handoffId,
                jobId: job.id,
                jobName: job.jobName,
                workerId: "local"
            },
            error,
            stage: "local-background-jobs-acknowledgement"
        });
    }
    /**
     * Reports an unexpected dispatcher failure through framework channels.
     * @param {object} args - Unexpected failure.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.context] - Additional failure context.
     * @param {ReturnType<typeof JSON.parse>} args.error - Unexpected error.
     * @param {string} args.stage - Dispatcher stage.
     * @returns {void} - No return value.
     */
    _reportFrameworkError({ context = {}, error, stage }) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = { context: { ...context, stage }, error: normalizedError };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtZGlzcGF0Y2hlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbG9jYWwtZGlzcGF0Y2hlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyw2QkFBNkIsTUFBTSx3QkFBd0IsQ0FBQTtBQUNsRSxPQUFPLG9CQUFvQixNQUFNLGtCQUFrQixDQUFBO0FBRW5ELHlLQUF5SztBQUV6Szs7Ozs7R0FLRztBQUVILE1BQU0sWUFBWSxHQUFHLGFBQWEsQ0FBQTtBQUNsQyxNQUFNLHVCQUF1QixHQUFHLEtBQUssQ0FBQTtBQUVyQyxxRUFBcUU7QUFDckUsTUFBTSxDQUFDLE9BQU8sT0FBTyw2QkFBNkI7SUFDaEQ7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUM7UUFDakQsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUE7UUFDeEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUE7UUFDdkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUE7UUFDckIsbUNBQW1DO1FBQ25DLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFBO1FBQ3pCLG1DQUFtQztRQUNuQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQTtRQUN6QixJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUNyQixJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQTtRQUN4QixpQ0FBaUM7UUFDakMsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQzFCLG9FQUFvRTtRQUNwRSxJQUFJLENBQUMsd0JBQXdCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUN6Qyw4QkFBOEI7UUFDOUIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQzdCLGlFQUFpRTtRQUNqRSxJQUFJLENBQUMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtRQUNoQyxpRUFBaUU7UUFDakUsSUFBSSxDQUFDLGNBQWMsR0FBRyxTQUFTLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFDekIsSUFBSSxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFBO1FBRXZELElBQUksQ0FBQyxhQUFhLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUMvQixJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsRUFBRSxDQUFBO1lBQy9CLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUE7WUFDM0IsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxFQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBQyxDQUFDLENBQUE7WUFDcEUsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO1lBQzlCLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsRUFBRSxDQUFBO1lBRTVDLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO1lBRTdELEtBQUssTUFBTSxHQUFHLElBQUksYUFBYSxFQUFFLENBQUM7Z0JBQ2hDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQztvQkFDNUIsS0FBSyxFQUFFLElBQUksS0FBSyxDQUFDLEdBQUcsQ0FBQyxTQUFTLElBQUksZ0VBQWdFLENBQUM7b0JBQ25HLEdBQUc7aUJBQ0osQ0FBQyxDQUFBO1lBQ0osQ0FBQztZQUVELElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFBO1lBQ3RCLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFBO1lBQ3BCLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUNiLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFFSixJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUE7UUFDMUIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMscUJBQXFCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLDZCQUE2QixFQUFDLENBQUMsQ0FBQTtZQUN6RSxNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFBO1FBQzNCLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsSUFBSTtRQUNGLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVTtZQUFFLE9BQU07UUFFNUIsSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUMzQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtZQUNwQixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFBO1FBQ3ZCLDRCQUE0QjtRQUM1QixJQUFJLFlBQVksQ0FBQTtRQUVoQixZQUFZLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxxQ0FBcUMsQ0FBQyxHQUFHLEVBQUU7WUFDM0UsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLGdDQUFnQyxDQUFDLEdBQUcsRUFBRTtnQkFDOUQsT0FBTyxPQUFPO3FCQUNYLE9BQU8sRUFBRTtxQkFDVCxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7b0JBQ2YsSUFBSSxDQUFDLFdBQVcsR0FBRyxLQUFLLENBQUE7b0JBQ3hCLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO2dCQUNyQixDQUFDLENBQUM7cUJBQ0QsS0FBSyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7b0JBQ2YsSUFBSSxDQUFDO3dCQUNILElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsNkJBQTZCLEVBQUMsQ0FBQyxDQUFBO29CQUMzRSxDQUFDOzRCQUFTLENBQUM7d0JBQ1QsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7b0JBQzFCLENBQUM7Z0JBQ0gsQ0FBQyxDQUFDO3FCQUNELE9BQU8sQ0FBQyxHQUFHLEVBQUU7b0JBQ1osSUFBSSxJQUFJLENBQUMsYUFBYSxLQUFLLFlBQVk7d0JBQUUsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUE7b0JBRWxFLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7d0JBQ3JDLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFBO3dCQUNyQixJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7b0JBQ2IsQ0FBQzt5QkFBTSxDQUFDO3dCQUNOLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO29CQUM1QixDQUFDO2dCQUNILENBQUMsQ0FBQyxDQUFBO1lBQ04sQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxhQUFhLEdBQUcsWUFBWSxDQUFBO0lBQ25DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsTUFBTTtRQUNWLE1BQU0sSUFBSSxDQUFDLDZCQUE2QixFQUFFLENBQUE7UUFFMUMsT0FBTyxJQUFJLENBQUMsVUFBVSxJQUFJLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUM7WUFDcEYsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFFL0MsSUFBSSxDQUFDLEdBQUc7Z0JBQUUsTUFBSztZQUVmLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsRUFBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBQyxDQUFDLENBQUE7WUFFL0QsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNiLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFBO2dCQUNwQixNQUFLO1lBQ1AsQ0FBQztZQUVELElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFBO1FBQ3hDLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO0lBQ2pDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsaUJBQWlCLENBQUMsRUFBQyxPQUFPLEVBQUUsR0FBRyxFQUFDO1FBQzlCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxPQUFPLEVBQUUsR0FBRyxFQUFDLENBQUMsQ0FBQTtRQUVqRCxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUMvQixLQUFLLFdBQVc7YUFDYixLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsbUNBQW1DLEVBQUMsQ0FBQyxDQUFDO2FBQ2pHLE9BQU8sQ0FBQyxHQUFHLEVBQUU7WUFDWixJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQTtZQUNsQyxJQUFJLElBQUksQ0FBQyxVQUFVO2dCQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUNoQyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUM1QixDQUFDLENBQUMsQ0FBQTtJQUNOLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUM7UUFDM0IsZ0RBQWdEO1FBQ2hELElBQUksZUFBZSxHQUFHLEVBQUMsSUFBSSxFQUFFLFdBQVcsRUFBQyxDQUFBO1FBRXpDLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUVuRCxNQUFNLG9CQUFvQixDQUFDO2dCQUN6QixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7Z0JBQ2pDLFFBQVE7Z0JBQ1IsT0FBTyxFQUFFLEdBQUcsQ0FBQyxJQUFJO2dCQUNqQixVQUFVLEVBQUU7b0JBQ1YsY0FBYyxFQUFFLEdBQUcsQ0FBQyxjQUFjLElBQUksU0FBUztvQkFDL0MsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhO29CQUNoQyxjQUFjLEVBQUUsR0FBRyxDQUFDLGNBQWMsSUFBSSxTQUFTO29CQUMvQyxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsSUFBSSxTQUFTO29CQUN2QyxLQUFLLEVBQUUsR0FBRyxDQUFDLEtBQUs7b0JBQ2hCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxJQUFJLFNBQVM7b0JBQzdDLFNBQVMsRUFBRSxHQUFHLENBQUMsU0FBUyxJQUFJLFNBQVM7aUJBQ3RDO2dCQUNELElBQUksRUFBRSx5QkFBeUIsR0FBRyxDQUFDLE9BQU8sRUFBRTtnQkFDNUMsT0FBTyxFQUFFO29CQUNQLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSTtvQkFDZCxhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7b0JBQ3BDLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUztvQkFDNUIsRUFBRSxFQUFFLEdBQUcsQ0FBQyxFQUFFO29CQUNWLE9BQU8sRUFBRSxHQUFHLENBQUMsT0FBTztvQkFDcEIsT0FBTyxFQUFFO3dCQUNQLGNBQWMsRUFBRSxHQUFHLENBQUMsY0FBYyxJQUFJLFNBQVM7d0JBQy9DLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYTt3QkFDaEMsY0FBYyxFQUFFLEdBQUcsQ0FBQyxjQUFjLElBQUksU0FBUzt3QkFDL0MsS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLO3FCQUNqQjtpQkFDRjthQUNGLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxLQUFLLFlBQVksNkJBQTZCLEVBQUUsQ0FBQztnQkFDbkQsZUFBZSxHQUFHLEVBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBQyxDQUFBO1lBQ2pFLENBQUM7aUJBQU0sQ0FBQztnQkFDTixlQUFlLEdBQUcsRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBQyxDQUFBO1lBQzNDLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLEVBQUMsZUFBZSxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFBO1FBQzFELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEVBQUMsZUFBZSxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFBO1lBQzFFLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxFQUFDLGVBQWUsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBQyxDQUFDLENBQUE7UUFDMUUsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxFQUFDLGVBQWUsRUFBRSxPQUFPLEVBQUUsR0FBRyxFQUFDO1FBQ2hELElBQUksZUFBZSxDQUFDLElBQUksS0FBSyxhQUFhLEVBQUUsQ0FBQztZQUMzQyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLEVBQUMsT0FBTyxFQUFFLGVBQWUsQ0FBQyxPQUFPLEVBQUUsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUMsQ0FBQyxDQUFBO1lBQ2pILE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxlQUFlLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3RDLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBQyxLQUFLLEVBQUUsZUFBZSxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBQyxDQUFDLENBQUE7WUFFM0gsSUFBSSxVQUFVO2dCQUFFLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxlQUFlLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO1lBQzlGLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxFQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQTtJQUMvRSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxFQUFDLFlBQVksR0FBRyxLQUFLLEVBQUMsR0FBRyxFQUFFO1FBQzdELEtBQUssTUFBTSxDQUFDLEtBQUssRUFBRSxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDO1lBQ2pGLElBQUksQ0FBQztnQkFDSCxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtnQkFDL0MsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUM3QyxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixJQUFJLENBQUMsMkJBQTJCLENBQUMsRUFBQyxHQUFHLHNCQUFzQixFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7Z0JBQ3BFLElBQUksWUFBWTtvQkFBRSxNQUFNLEtBQUssQ0FBQTtnQkFDN0IsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFDMUIsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQjtRQUN0QixJQUFJLElBQUksQ0FBQyxlQUFlLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO1lBQzdDLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1FBQ2xDLENBQUM7UUFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFNO1FBRTVCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRW5ELElBQUksQ0FBQyxPQUFPLElBQUksT0FBTyxDQUFDLGFBQWEsS0FBSyxJQUFJO1lBQUUsT0FBTTtRQUV0RCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFBO1FBRTdGLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFO1lBQ2hELElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1lBQ2hDLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUNiLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQTtJQUNiLENBQUM7SUFFRDs7O09BR0c7SUFDSCxpQkFBaUI7UUFDZixJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVM7WUFBRSxPQUFNO1FBRWpFLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFO1lBQy9DLElBQUksQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFBO1lBQy9CLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUNiLENBQUMsRUFBRSx1QkFBdUIsQ0FBQyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsV0FBVztRQUNmLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRTtZQUFFLE9BQU07UUFFMUIsTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNqRixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLElBQUk7UUFDUixJQUFJLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQTtRQUN2QixJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUVyQixJQUFJLElBQUksQ0FBQyxlQUFlLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO1lBQzdDLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1FBQ2xDLENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDdEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQzVDLElBQUksQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFBO1FBQ2pDLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFBO1FBQ2hELElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEdBQUcsQ0FBQztZQUFFLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7UUFDbkUsTUFBTSxJQUFJLENBQUMsNkJBQTZCLENBQUMsRUFBQyxZQUFZLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUU5RCxJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQTtRQUN4QixJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUNyQixJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtJQUM1QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTyxLQUFLLE9BQU8sSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFBLENBQUMsQ0FBQztJQUVyRDs7O09BR0c7SUFDSCxrQkFBa0IsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQyx1QkFBdUIsQ0FBQSxDQUFDLENBQUM7SUFFcEc7OztPQUdHO0lBQ0gsc0JBQXNCLEtBQUssT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsSUFBSSxDQUFBLENBQUMsQ0FBQztJQUU1Rjs7O09BR0c7SUFDSCxPQUFPO1FBQ0wsT0FBTyxDQUFDLElBQUksQ0FBQyxXQUFXLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxJQUFJLENBQUMsd0JBQXdCLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQTtJQUMxSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsbUJBQW1CO1FBQ2pCLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFO1lBQUUsT0FBTTtRQUUzQixNQUFNLE9BQU8sR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRXRDLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDekIsS0FBSyxNQUFNLE9BQU8sSUFBSSxPQUFPO1lBQUUsT0FBTyxFQUFFLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxHQUFHLEVBQUM7UUFDbkMsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUNqRixNQUFNLE9BQU8sR0FBRztZQUNkLE9BQU8sRUFBRTtnQkFDUCxRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVE7Z0JBQ3RCLE9BQU8sRUFBRSxHQUFHLENBQUMsSUFBSTtnQkFDakIsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFFO2dCQUNiLE9BQU8sRUFBRSxHQUFHLENBQUMsT0FBTztnQkFDcEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVO2dCQUMxQixLQUFLLEVBQUUsdUJBQXVCO2dCQUM5QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU07Z0JBQ2xCLFFBQVEsRUFBRSxHQUFHLENBQUMsTUFBTSxLQUFLLFFBQVE7Z0JBQ2pDLFNBQVMsRUFBRSxHQUFHLENBQUMsTUFBTSxLQUFLLFFBQVE7Z0JBQ2xDLFFBQVEsRUFBRSxPQUFPO2FBQ2xCO1lBQ0QsS0FBSyxFQUFFLGVBQWU7U0FDdkIsQ0FBQTtRQUNELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsV0FBVyxDQUFDLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUNsRCxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSx1QkFBdUIsRUFBQyxDQUFDLENBQUE7SUFDakYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwyQkFBMkIsQ0FBQyxFQUFDLGVBQWUsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBQztRQUNoRSxJQUFJLENBQUMscUJBQXFCLENBQUM7WUFDekIsT0FBTyxFQUFFO2dCQUNQLG1CQUFtQixFQUFFLGVBQWUsQ0FBQyxJQUFJO2dCQUN6QyxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVM7Z0JBQzVCLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRTtnQkFDYixPQUFPLEVBQUUsR0FBRyxDQUFDLE9BQU87Z0JBQ3BCLFFBQVEsRUFBRSxPQUFPO2FBQ2xCO1lBQ0QsS0FBSztZQUNMLEtBQUssRUFBRSx1Q0FBdUM7U0FDL0MsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxxQkFBcUIsQ0FBQyxFQUFDLE9BQU8sR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBQztRQUNoRCxNQUFNLGVBQWUsR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ2pGLE1BQU0sT0FBTyxHQUFHLEVBQUMsT0FBTyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsS0FBSyxFQUFDLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBQyxDQUFBO1FBQ3RFLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7SUFDM0UsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCBmcm9tIFwiLi9yZXNjaGVkdWxlLXNpZ25hbC5qc1wiXG5pbXBvcnQgcGVyZm9ybUJhY2tncm91bmRKb2IgZnJvbSBcIi4vcGVyZm9ybS1qb2IuanNcIlxuXG4vKiogQHR5cGVkZWYge3t0eXBlOiBcImNvbXBsZXRlZFwifSB8IHt0eXBlOiBcImZhaWxlZFwiLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHwge3R5cGU6IFwicmVzY2hlZHVsZWRcIiwgZGVsYXlNczogbnVtYmVyfX0gTG9jYWxCYWNrZ3JvdW5kSm9iQWNrbm93bGVkZ2VtZW50ICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUGVuZGluZ0xvY2FsQmFja2dyb3VuZEpvYkFja25vd2xlZGdlbWVudFxuICogQHByb3BlcnR5IHtMb2NhbEJhY2tncm91bmRKb2JBY2tub3dsZWRnZW1lbnR9IGFja25vd2xlZGdlbWVudCAtIER1cmFibGUgdHJhbnNpdGlvbiBzdGlsbCBvd25lZCBieSB0aGlzIGRpc3BhdGNoZXIuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZ9IGhhbmRvZmYgLSBGZW5jZWQgaGFuZG9mZiBiZWluZyBhY2tub3dsZWRnZWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gQ2xhaW1lZCBqb2Igc25hcHNob3QuXG4gKi9cblxuY29uc3QgTUFYX1RJTUVSX01TID0gMl8xNDdfNDgzXzY0N1xuY29uc3QgRVJST1JfUkVDT1ZFUllfREVMQVlfTVMgPSAxXzAwMFxuXG4vKiogQ29uZmlndXJhdGlvbi1vd25lZCwgZXZlbnQtZHJpdmVuIGluLXByb2Nlc3MgbG9jYWwgZGlzcGF0Y2hlci4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIExvY2FsQmFja2dyb3VuZEpvYnNEaXNwYXRjaGVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBkaXNwYXRjaGVyIG93bmVkIGJ5IG9uZSBjb25maWd1cmF0aW9uIGFuZCBsb2NhbCBzdG9yZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBEaXNwYXRjaGVyIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBPd25pbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkxvY2FsQmFja2dyb3VuZEpvYnNDbG9ja30gYXJncy5jbG9jayAtIERpc3BhdGNoZXIgY2xvY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1qb2ItcmVnaXN0cnkuanNcIikuZGVmYXVsdH0gYXJncy5yZWdpc3RyeSAtIFN0YXRpYyBqb2IgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1zdG9yZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnN0b3JlIC0gRHVyYWJsZSBsb2NhbCBzdG9yZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjbG9jaywgcmVnaXN0cnksIHN0b3JlfSkge1xuICAgIHRoaXMuY2xvY2sgPSBjbG9ja1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLnJlZ2lzdHJ5ID0gcmVnaXN0cnlcbiAgICB0aGlzLnN0b3JlID0gc3RvcmVcbiAgICB0aGlzLl9hY2NlcHRpbmcgPSBmYWxzZVxuICAgIHRoaXMuX3N0YXJ0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc3RhcnRQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX3JlZHJhaW4gPSBmYWxzZVxuICAgIHRoaXMuX3dha2VRdWV1ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX2luRmxpZ2h0ID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQZW5kaW5nTG9jYWxCYWNrZ3JvdW5kSm9iQWNrbm93bGVkZ2VtZW50Pn0gKi9cbiAgICB0aGlzLl9wZW5kaW5nQWNrbm93bGVkZ2VtZW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7U2V0PCgpID0+IHZvaWQ+fSAqL1xuICAgIHRoaXMuX2lkbGVXYWl0ZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcmVjb3ZlcnlUaW1lciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cywgcmVjb3ZlcnMsIGFuZCBjYXRjaGVzIHVwIHRoZSBsb2NhbCBkaXNwYXRjaGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhZG1pc3Npb24gc3RhcnRzLlxuICAgKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgaWYgKHRoaXMuX3N0YXJ0ZWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9zdGFydFByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9zdGFydFByb21pc2VcblxuICAgIHRoaXMuX3N0YXJ0UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgICB0aGlzLnJlZ2lzdHJ5LmVuc3VyZVJlYWR5KClcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBcImxvY2FsLWJhY2tncm91bmQtam9ic1wifSlcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmUuZW5zdXJlUmVhZHkoKVxuICAgICAgYXdhaXQgdGhpcy5zdG9yZS5yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KClcblxuICAgICAgY29uc3QgcmVjb3ZlcmVkSm9icyA9IGF3YWl0IHRoaXMuc3RvcmUucmVjb3ZlckhhbmRlZE9mZkpvYnMoKVxuXG4gICAgICBmb3IgKGNvbnN0IGpvYiBvZiByZWNvdmVyZWRKb2JzKSB7XG4gICAgICAgIHRoaXMuX2VtaXRCYWNrZ3JvdW5kSm9iRmFpbGVkKHtcbiAgICAgICAgICBlcnJvcjogbmV3IEVycm9yKGpvYi5sYXN0RXJyb3IgfHwgXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYiByZWNvdmVyZWQgYWZ0ZXIgYW4gaW50ZXJydXB0ZWQgZGlzcGF0Y2hlclwiKSxcbiAgICAgICAgICBqb2JcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5fYWNjZXB0aW5nID0gdHJ1ZVxuICAgICAgdGhpcy5fc3RhcnRlZCA9IHRydWVcbiAgICAgIHRoaXMud2FrZSgpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0UHJvbWlzZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRGcmFtZXdvcmtFcnJvcih7ZXJyb3IsIHN0YWdlOiBcImxvY2FsLWJhY2tncm91bmQtam9icy1zdGFydFwifSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3N0YXJ0UHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29hbGVzY2VzIGEgZGlzcGF0Y2hlciB3YWtlIG9udG8gb25lIHRyYWNrZWQgbWljcm90YXNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB3YWtlKCkge1xuICAgIGlmICghdGhpcy5fYWNjZXB0aW5nKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UgfHwgdGhpcy5fd2FrZVF1ZXVlZCkge1xuICAgICAgdGhpcy5fcmVkcmFpbiA9IHRydWVcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3dha2VRdWV1ZWQgPSB0cnVlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBkcmFpblByb21pc2VcblxuICAgIGRyYWluUHJvbWlzZSA9IHRoaXMuY29uZmlndXJhdGlvbi53aXRob3V0Q3VycmVudFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24ud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICByZXR1cm4gUHJvbWlzZVxuICAgICAgICAgIC5yZXNvbHZlKClcbiAgICAgICAgICAudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLl93YWtlUXVldWVkID0gZmFsc2VcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIHRoaXMuX3JlcG9ydEZyYW1ld29ya0Vycm9yKHtlcnJvciwgc3RhZ2U6IFwibG9jYWwtYmFja2dyb3VuZC1qb2JzLWRyYWluXCJ9KVxuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgdGhpcy5fYXJtUmVjb3ZlcnlUaW1lcigpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuZmluYWxseSgoKSA9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5fZHJhaW5Qcm9taXNlID09PSBkcmFpblByb21pc2UpIHRoaXMuX2RyYWluUHJvbWlzZSA9IG51bGxcblxuICAgICAgICAgICAgaWYgKHRoaXMuX3JlZHJhaW4gJiYgdGhpcy5fYWNjZXB0aW5nKSB7XG4gICAgICAgICAgICAgIHRoaXMuX3JlZHJhaW4gPSBmYWxzZVxuICAgICAgICAgICAgICB0aGlzLndha2UoKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhpcy5fcmVzb2x2ZUlkbGVXYWl0ZXJzKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gZHJhaW5Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRmlsbHMgbG9jYWwgY2FwYWNpdHkgd2l0aCBzaG9ydCBkdXJhYmxlIGNsYWltcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgb25lIHN0YWJsZSBkcmFpbiBwYXNzLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluKCkge1xuICAgIGF3YWl0IHRoaXMuX3JldHJ5UGVuZGluZ0Fja25vd2xlZGdlbWVudHMoKVxuXG4gICAgd2hpbGUgKHRoaXMuX2FjY2VwdGluZyAmJiB0aGlzLl9vd25lZFBlcmZvcm1hbmNlQ291bnQoKSA8IHRoaXMuX21heENvbmN1cnJlbnRKb2JzKCkpIHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuc3RvcmUubmV4dEF2YWlsYWJsZUpvYigpXG5cbiAgICAgIGlmICgham9iKSBicmVha1xuXG4gICAgICBjb25zdCBoYW5kb2ZmID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrSGFuZGVkT2ZmKHtqb2JJZDogam9iLmlkfSlcblxuICAgICAgaWYgKCFoYW5kb2ZmKSB7XG4gICAgICAgIHRoaXMuX3JlZHJhaW4gPSB0cnVlXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3N0YXJ0UGVyZm9ybWFuY2Uoe2hhbmRvZmYsIGpvYn0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYXJtU2NoZWR1bGVkVGltZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGNsYWltZWQgcGVyZm9ybWFuY2Ugd2l0aG91dCByZXRhaW5pbmcgaXRzIGNsYWltIHRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7e2hhbmRvZmY6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYsIGpvYjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fX0gYXJncyAtIENsYWltZWQgam9iLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc3RhcnRQZXJmb3JtYW5jZSh7aGFuZG9mZiwgam9ifSkge1xuICAgIGNvbnN0IHBlcmZvcm1hbmNlID0gdGhpcy5fcGVyZm9ybSh7aGFuZG9mZiwgam9ifSlcblxuICAgIHRoaXMuX2luRmxpZ2h0LmFkZChwZXJmb3JtYW5jZSlcbiAgICB2b2lkIHBlcmZvcm1hbmNlXG4gICAgICAuY2F0Y2goKGVycm9yKSA9PiB0aGlzLl9yZXBvcnRGcmFtZXdvcmtFcnJvcih7ZXJyb3IsIHN0YWdlOiBcImxvY2FsLWJhY2tncm91bmQtam9icy1wZXJmb3JtYW5jZVwifSkpXG4gICAgICAuZmluYWxseSgoKSA9PiB7XG4gICAgICAgIHRoaXMuX2luRmxpZ2h0LmRlbGV0ZShwZXJmb3JtYW5jZSlcbiAgICAgICAgaWYgKHRoaXMuX2FjY2VwdGluZykgdGhpcy53YWtlKClcbiAgICAgICAgdGhpcy5fcmVzb2x2ZUlkbGVXYWl0ZXJzKClcbiAgICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybXMgYW5kIGFja25vd2xlZGdlcyBvbmUgZHVyYWJsZSBoYW5kb2ZmLlxuICAgKiBAcGFyYW0ge3toYW5kb2ZmOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmLCBqb2I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd319IGFyZ3MgLSBDbGFpbWVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWNrbm93bGVkZ2VtZW50LlxuICAgKi9cbiAgYXN5bmMgX3BlcmZvcm0oe2hhbmRvZmYsIGpvYn0pIHtcbiAgICAvKiogQHR5cGUge0xvY2FsQmFja2dyb3VuZEpvYkFja25vd2xlZGdlbWVudH0gKi9cbiAgICBsZXQgYWNrbm93bGVkZ2VtZW50ID0ge3R5cGU6IFwiY29tcGxldGVkXCJ9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgSm9iQ2xhc3MgPSB0aGlzLnJlZ2lzdHJ5LnJlc29sdmUoam9iLmpvYk5hbWUpXG5cbiAgICAgIGF3YWl0IHBlcmZvcm1CYWNrZ3JvdW5kSm9iKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBKb2JDbGFzcyxcbiAgICAgICAgam9iQXJnczogam9iLmFyZ3MsXG4gICAgICAgIGpvYk9wdGlvbnM6IHtcbiAgICAgICAgICBjb25jdXJyZW5jeUtleTogam9iLmNvbmN1cnJlbmN5S2V5IHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICBleGVjdXRpb25Nb2RlOiBqb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgICBtYXhDb25jdXJyZW5jeTogam9iLm1heENvbmN1cnJlbmN5ID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICBtYXhSZXRyaWVzOiBqb2IubWF4UmV0cmllcyA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgcXVldWU6IGpvYi5xdWV1ZSxcbiAgICAgICAgICBzY2hlZHVsZWRBdE1zOiBqb2Iuc2NoZWR1bGVkQXRNcyA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgdGltZW91dE1zOiBqb2IudGltZW91dE1zID8/IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBuYW1lOiBgTG9jYWwgYmFja2dyb3VuZCBqb2I6ICR7am9iLmpvYk5hbWV9YCxcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIGFyZ3M6IGpvYi5hcmdzLFxuICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICBoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLFxuICAgICAgICAgIGlkOiBqb2IuaWQsXG4gICAgICAgICAgam9iTmFtZTogam9iLmpvYk5hbWUsXG4gICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgY29uY3VycmVuY3lLZXk6IGpvYi5jb25jdXJyZW5jeUtleSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICBleGVjdXRpb25Nb2RlOiBqb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgICAgIG1heENvbmN1cnJlbmN5OiBqb2IubWF4Q29uY3VycmVuY3kgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgICAgcXVldWU6IGpvYi5xdWV1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVTaWduYWwpIHtcbiAgICAgICAgYWNrbm93bGVkZ2VtZW50ID0ge2RlbGF5TXM6IGVycm9yLmRlbGF5TXMsIHR5cGU6IFwicmVzY2hlZHVsZWRcIn1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFja25vd2xlZGdlbWVudCA9IHtlcnJvciwgdHlwZTogXCJmYWlsZWRcIn1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fYWNrbm93bGVkZ2Uoe2Fja25vd2xlZGdlbWVudCwgaGFuZG9mZiwgam9ifSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcGVuZGluZ0Fja25vd2xlZGdlbWVudHMuc2V0KGpvYi5pZCwge2Fja25vd2xlZGdlbWVudCwgaGFuZG9mZiwgam9ifSlcbiAgICAgIHRoaXMuX3JlcG9ydEFja25vd2xlZGdlbWVudEVycm9yKHthY2tub3dsZWRnZW1lbnQsIGVycm9yLCBoYW5kb2ZmLCBqb2J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBmZW5jZWQgZHVyYWJsZSBhY2tub3dsZWRnZW1lbnQuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0xvY2FsQmFja2dyb3VuZEpvYkFja25vd2xlZGdlbWVudH0gYXJncyAtIE93bmVkIGFja25vd2xlZGdlbWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGR1cmFibGUgdHJhbnNpdGlvbiBpcyBzZXR0bGVkLlxuICAgKi9cbiAgYXN5bmMgX2Fja25vd2xlZGdlKHthY2tub3dsZWRnZW1lbnQsIGhhbmRvZmYsIGpvYn0pIHtcbiAgICBpZiAoYWNrbm93bGVkZ2VtZW50LnR5cGUgPT09IFwicmVzY2hlZHVsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5zdG9yZS5tYXJrUmVzY2hlZHVsZWQoe2RlbGF5TXM6IGFja25vd2xlZGdlbWVudC5kZWxheU1zLCBoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChhY2tub3dsZWRnZW1lbnQudHlwZSA9PT0gXCJmYWlsZWRcIikge1xuICAgICAgY29uc3QgdXBkYXRlZEpvYiA9IGF3YWl0IHRoaXMuc3RvcmUubWFya0ZhaWxlZCh7ZXJyb3I6IGFja25vd2xlZGdlbWVudC5lcnJvciwgaGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG5cbiAgICAgIGlmICh1cGRhdGVkSm9iKSB0aGlzLl9lbWl0QmFja2dyb3VuZEpvYkZhaWxlZCh7ZXJyb3I6IGFja25vd2xlZGdlbWVudC5lcnJvciwgam9iOiB1cGRhdGVkSm9ifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc3RvcmUubWFya0NvbXBsZXRlZCh7aGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gIH1cblxuICAvKipcbiAgICogUmVwbGF5cyBlYWNoIHJldGFpbmVkIGFja25vd2xlZGdlbWVudCBvbmNlIGF0IGFuIGV2ZW50LWRyaXZlbiB3YWtlIGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0ge3t0aHJvd09uRXJyb3I/OiBib29sZWFufX0gW2FyZ3NdIC0gUmVjb3ZlcnkgYmVoYXZpb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIG9uZSBib3VuZGVkIHJlY292ZXJ5IHBhc3MuXG4gICAqL1xuICBhc3luYyBfcmV0cnlQZW5kaW5nQWNrbm93bGVkZ2VtZW50cyh7dGhyb3dPbkVycm9yID0gZmFsc2V9ID0ge30pIHtcbiAgICBmb3IgKGNvbnN0IFtqb2JJZCwgcGVuZGluZ0Fja25vd2xlZGdlbWVudF0gb2YgWy4uLnRoaXMuX3BlbmRpbmdBY2tub3dsZWRnZW1lbnRzXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYWNrbm93bGVkZ2UocGVuZGluZ0Fja25vd2xlZGdlbWVudClcbiAgICAgICAgdGhpcy5fcGVuZGluZ0Fja25vd2xlZGdlbWVudHMuZGVsZXRlKGpvYklkKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5fcmVwb3J0QWNrbm93bGVkZ2VtZW50RXJyb3Ioey4uLnBlbmRpbmdBY2tub3dsZWRnZW1lbnQsIGVycm9yfSlcbiAgICAgICAgaWYgKHRocm93T25FcnJvcikgdGhyb3cgZXJyb3JcbiAgICAgICAgdGhpcy5fYXJtUmVjb3ZlcnlUaW1lcigpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgdGhlIGV4YWN0IG5leHQgZnV0dXJlIGpvYiB0aW1lciwgY2h1bmtpbmcgcGxhdGZvcm0tc2l6ZWQgZGVsYXlzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aW1lciByZWNvbmNpbGlhdGlvbi5cbiAgICovXG4gIGFzeW5jIF9hcm1TY2hlZHVsZWRUaW1lcigpIHtcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGhpcy5fc2NoZWR1bGVkVGltZXIpXG4gICAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgICBpZiAoIXRoaXMuX2FjY2VwdGluZykgcmV0dXJuXG5cbiAgICBjb25zdCBuZXh0Sm9iID0gYXdhaXQgdGhpcy5zdG9yZS5uZXh0U2NoZWR1bGVkSm9iKClcblxuICAgIGlmICghbmV4dEpvYiB8fCBuZXh0Sm9iLnNjaGVkdWxlZEF0TXMgPT09IG51bGwpIHJldHVyblxuXG4gICAgY29uc3QgZGVsYXlNcyA9IE1hdGgubWF4KDAsIE1hdGgubWluKG5leHRKb2Iuc2NoZWR1bGVkQXRNcyAtIHRoaXMuY2xvY2subm93KCksIE1BWF9USU1FUl9NUykpXG5cbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy53YWtlKClcbiAgICB9LCBkZWxheU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgb25lIGJvdW5kZWQgcmV0cnkgYWZ0ZXIgYW4gdW5leHBlY3RlZCBkcmFpbiBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYXJtUmVjb3ZlcnlUaW1lcigpIHtcbiAgICBpZiAoIXRoaXMuX2FjY2VwdGluZyB8fCB0aGlzLl9yZWNvdmVyeVRpbWVyICE9PSB1bmRlZmluZWQpIHJldHVyblxuXG4gICAgdGhpcy5fcmVjb3ZlcnlUaW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9yZWNvdmVyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB0aGlzLndha2UoKVxuICAgIH0sIEVSUk9SX1JFQ09WRVJZX0RFTEFZX01TKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhZG1pc3Npb24gYW5kIGV2ZXJ5IGluLWZsaWdodCBhY2tub3dsZWRnZW1lbnQgd2l0aG91dCBwb2xsaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGlkbGUuXG4gICAqL1xuICBhc3luYyB3YWl0Rm9ySWRsZSgpIHtcbiAgICBpZiAodGhpcy5faXNJZGxlKCkpIHJldHVyblxuXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHRoaXMuX2lkbGVXYWl0ZXJzLmFkZCgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIGNsYWltcyBhbmQgd2FpdHMgZm9yIGluLWZsaWdodCBhY2tub3dsZWRnZW1lbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGEgZ3JhY2VmdWwgc3RvcC5cbiAgICovXG4gIGFzeW5jIHN0b3AoKSB7XG4gICAgdGhpcy5fYWNjZXB0aW5nID0gZmFsc2VcbiAgICB0aGlzLl9yZWRyYWluID0gZmFsc2VcblxuICAgIGlmICh0aGlzLl9zY2hlZHVsZWRUaW1lciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aGlzLl9zY2hlZHVsZWRUaW1lcilcbiAgICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICAgIGlmICh0aGlzLl9yZWNvdmVyeVRpbWVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRoaXMuX3JlY292ZXJ5VGltZXIpXG4gICAgICB0aGlzLl9yZWNvdmVyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSkgYXdhaXQgdGhpcy5fZHJhaW5Qcm9taXNlXG4gICAgaWYgKHRoaXMuX2luRmxpZ2h0LnNpemUgPiAwKSBhd2FpdCBQcm9taXNlLmFsbChbLi4udGhpcy5faW5GbGlnaHRdKVxuICAgIGF3YWl0IHRoaXMuX3JldHJ5UGVuZGluZ0Fja25vd2xlZGdlbWVudHMoe3Rocm93T25FcnJvcjogdHJ1ZX0pXG5cbiAgICB0aGlzLl93YWtlUXVldWVkID0gZmFsc2VcbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgICB0aGlzLl9yZXNvbHZlSWRsZVdhaXRlcnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgd2hldGhlciBkaXNwYXRjaGVyIGFkbWlzc2lvbiBoYXMgc3RhcnRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkaXNwYXRjaGVyIGFkbWlzc2lvbiBoYXMgc3RhcnRlZC5cbiAgICovXG4gIGlzUmVhZHkoKSB7IHJldHVybiB0aGlzLl9zdGFydGVkICYmIHRoaXMuX2FjY2VwdGluZyB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBjb25maWd1cmF0aW9uLW93bmVkIGluLXByb2Nlc3MgcGVyZm9ybWFuY2UgY2FwLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIENvbmZpZ3VyYXRpb24tb3duZWQgaW4tcHJvY2VzcyBwZXJmb3JtYW5jZSBjYXAuXG4gICAqL1xuICBfbWF4Q29uY3VycmVudEpvYnMoKSB7IHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5tYXhDb25jdXJyZW50SW5saW5lSm9icyB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBwZXJmb3JtYW5jZXMgd2hvc2UgZHVyYWJsZSBhY2tub3dsZWRnZW1lbnQgaXMgc3RpbGwgb3duZWQgbG9jYWxseS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBY3RpdmUgb3IgcGVuZGluZy1hY2tub3dsZWRnZW1lbnQgcGVyZm9ybWFuY2VzLlxuICAgKi9cbiAgX293bmVkUGVyZm9ybWFuY2VDb3VudCgpIHsgcmV0dXJuIHRoaXMuX2luRmxpZ2h0LnNpemUgKyB0aGlzLl9wZW5kaW5nQWNrbm93bGVkZ2VtZW50cy5zaXplIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB3aGV0aGVyIG5vIGFkbWlzc2lvbiBvciBhY2tub3dsZWRnZW1lbnQgd29yayByZW1haW5zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBkaXNwYXRjaGVyIGlzIGlkbGUuXG4gICAqL1xuICBfaXNJZGxlKCkge1xuICAgIHJldHVybiAhdGhpcy5fd2FrZVF1ZXVlZCAmJiAhdGhpcy5fZHJhaW5Qcm9taXNlICYmIHRoaXMuX2luRmxpZ2h0LnNpemUgPT09IDAgJiYgdGhpcy5fcGVuZGluZ0Fja25vd2xlZGdlbWVudHMuc2l6ZSA9PT0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGV2ZW50LWJhc2VkIGlkbGUgd2FpdGVycyBhdCBhIHN0YWJsZSBpZGxlIGJvdW5kYXJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfcmVzb2x2ZUlkbGVXYWl0ZXJzKCkge1xuICAgIGlmICghdGhpcy5faXNJZGxlKCkpIHJldHVyblxuXG4gICAgY29uc3Qgd2FpdGVycyA9IFsuLi50aGlzLl9pZGxlV2FpdGVyc11cblxuICAgIHRoaXMuX2lkbGVXYWl0ZXJzLmNsZWFyKClcbiAgICBmb3IgKGNvbnN0IHJlc29sdmUgb2Ygd2FpdGVycykgcmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYW4gZXhwZWN0ZWQgam9iIGZhaWx1cmUgdGhyb3VnaCB0aGUgc3RhbmRhcmQgam9iL2FsbC1lcnJvciBjaGFubmVscy5cbiAgICogQHBhcmFtIHt7ZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBqb2I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd319IGFyZ3MgLSBGYWlsdXJlIHRyYW5zaXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9lbWl0QmFja2dyb3VuZEpvYkZhaWxlZCh7ZXJyb3IsIGpvYn0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge1xuICAgICAgICBhdHRlbXB0czogam9iLmF0dGVtcHRzLFxuICAgICAgICBqb2JBcmdzOiBqb2IuYXJncyxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgam9iTmFtZTogam9iLmpvYk5hbWUsXG4gICAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1mYWlsZWRcIixcbiAgICAgICAgc3RhdHVzOiBqb2Iuc3RhdHVzLFxuICAgICAgICB0ZXJtaW5hbDogam9iLnN0YXR1cyA9PT0gXCJmYWlsZWRcIixcbiAgICAgICAgd2lsbFJldHJ5OiBqb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiLFxuICAgICAgICB3b3JrZXJJZDogXCJsb2NhbFwiXG4gICAgICB9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImJhY2tncm91bmQtam9iLWZhaWxlZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIG9uZSBmYWlsZWQgZHVyYWJsZSBhY2tub3dsZWRnZW1lbnQgYXR0ZW1wdCB3aXRoIGl0cyBmZW5jZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdMb2NhbEJhY2tncm91bmRKb2JBY2tub3dsZWRnZW1lbnQgJiB7ZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIEZhaWxlZCBhY2tub3dsZWRnZW1lbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9yZXBvcnRBY2tub3dsZWRnZW1lbnRFcnJvcih7YWNrbm93bGVkZ2VtZW50LCBlcnJvciwgaGFuZG9mZiwgam9ifSkge1xuICAgIHRoaXMuX3JlcG9ydEZyYW1ld29ya0Vycm9yKHtcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgYWNrbm93bGVkZ2VtZW50VHlwZTogYWNrbm93bGVkZ2VtZW50LnR5cGUsXG4gICAgICAgIGhhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIGpvYk5hbWU6IGpvYi5qb2JOYW1lLFxuICAgICAgICB3b3JrZXJJZDogXCJsb2NhbFwiXG4gICAgICB9LFxuICAgICAgZXJyb3IsXG4gICAgICBzdGFnZTogXCJsb2NhbC1iYWNrZ3JvdW5kLWpvYnMtYWNrbm93bGVkZ2VtZW50XCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYW4gdW5leHBlY3RlZCBkaXNwYXRjaGVyIGZhaWx1cmUgdGhyb3VnaCBmcmFtZXdvcmsgY2hhbm5lbHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVW5leHBlY3RlZCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuY29udGV4dF0gLSBBZGRpdGlvbmFsIGZhaWx1cmUgY29udGV4dC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFVuZXhwZWN0ZWQgZXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN0YWdlIC0gRGlzcGF0Y2hlciBzdGFnZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3JlcG9ydEZyYW1ld29ya0Vycm9yKHtjb250ZXh0ID0ge30sIGVycm9yLCBzdGFnZX0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHsuLi5jb250ZXh0LCBzdGFnZX0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cbn1cbiJdfQ==