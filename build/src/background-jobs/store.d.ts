import BackgroundJobsAdapter from "./adapter.js";
import Logger from "../logger.js";
export type PreparedBackgroundJob = {
    /**
     * - Serialized arguments.
     */
    argsJson: string;
    /**
     * - Resolved concurrency.
     */
    concurrency: {
        concurrencyKey: string;
        maxConcurrency: number;
        queueDerived: boolean;
    } | null;
    /**
     * - Creation timestamp.
     */
    createdAtMs: number;
    /**
     * - Execution mode.
     */
    executionMode: import("./types.js").BackgroundJobExecutionMode;
    /**
     * - New job id.
     */
    jobId: string;
    /**
     * - Job name.
     */
    jobName: string;
    /**
     * - Retry cap.
     */
    maxRetries: number;
    /**
     * - Queue name.
     */
    queue: string;
    /**
     * - Eligibility timestamp.
     */
    scheduledAtMs: number;
    /**
     * - Per-job timeout override, or null when omitted.
     */
    timeoutMs: number | null;
};
export type BackgroundJobOrphanSelection = {
    /**
     * - Exact update fence.
     */
    conditions: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Selected active handoff.
     */
    job: import("./types.js").BackgroundJobRow;
};
export type BackgroundJobTransactionSerializationOptions = {
    /**
     * - Session lock held around the transaction.
     */
    advisoryLock?: {
        failureMessage: string;
        name: string;
    };
};
export type BackgroundJobConcurrencyCountRow = {
    /**
     * - Persisted or aggregated active count.
     */
    active_count: number | string;
    /**
     * - Durable cap identity.
     */
    concurrency_key: string;
};
export type BackgroundJobQueuedConcurrency = {
    /**
     * - Current concurrency key for queued work.
     */
    concurrencyKey: string | null;
    /**
     * - Current concurrency cap for queued work.
     */
    maxConcurrency: number | null;
};
export declare const BACKGROUND_JOB_COUNTS_CHANNEL = "velocious-background-job-counts";
export declare const BACKGROUND_JOB_COUNT_BUCKETS: string[];
export default class BackgroundJobsStore extends BackgroundJobsAdapter {
    configuration: import("../configuration.js").default;
    databaseIdentifier: string | undefined;
    logger: Logger;
    _readyPromise: Promise<void> | null;
    _queueConcurrencyReconciled: boolean;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     */
    constructor({ configuration, databaseIdentifier }: {
        configuration: import("../configuration.js").default;
        databaseIdentifier?: string;
    });
    /**
     * Runs get database identifier.
     * @returns {string} - Database identifier.
     */
    getDatabaseIdentifier(): string;
    /**
     * Runs ensure ready.
     * @returns {Promise<void>} - Resolves when ready.
     */
    ensureReady(): Promise<void>;
    /**
     * Ensures the background-jobs schema (tables + columns) exists on the configured
     * database, without initializing the runtime model. Lets `db:migrate` create the
     * framework's own schema deterministically alongside app migrations — and capture
     * it in the dumped structure SQL — instead of it only appearing once a store boots.
     * Idempotent: reuses the same `_ensureSchema` the runtime store uses, which skips
     * work already applied (tracked in `velocious_internal_migrations`).
     * @param {import("../database/drivers/base.js").default} [db] - Reuse an already
     *   checked-out connection (e.g. the one `db:migrate` holds) rather than opening a
     *   nested checkout that would deadlock a single-connection pool.
     * @returns {Promise<void>} - Resolves when the schema is present.
     */
    ensureSchema(db?: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Reconciles queue-derived concurrency with the current configuration: the
     * explicit lifecycle path that adopts/releases persisted queued jobs onto
     * queue concurrency keys when `queues[name].maxConcurrent` is added, removed,
     * or changed. Called by the background-jobs main process on startup — the
     * deploy-time moment queue configuration changes take effect. Schema/tenant
     * checks and routine connection initialization deliberately never run this:
     * they stay read-only regarding queued job rows, because the broad
     * adoption/release UPDATEs deadlock against active job processes under
     * concurrent tenant initialization. Serialized across processes with a
     * database advisory lock so concurrently started mains cannot interleave the
     * UPDATEs; the per-instance memo only skips repeat work within this process.
     * @returns {Promise<void>} - Resolves when reconciled.
     */
    reconcileQueueConcurrency(): Promise<void>;
    /**
     * Repairs durable active-count drift while a main process remains live. The
     * initial snapshot is read-only; only suspected mismatches take their
     * counter lock and re-count inside the serialized transaction path.
     * @returns {Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>} - Repair summary.
     */
    reconcileActiveConcurrency(): Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>;
    /**
     * Runs enqueue.
     * @param {object} args - Options.
     * @param {string} args.jobName - Job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Arguments.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Options.
     * @returns {Promise<string>} - Job id.
     */
    enqueue({ jobName, args, options }: {
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<string>;
    /**
     * Atomically owns one durable idempotency scope and creates its job exactly once.
     * @param {object} args - Enqueue input.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
     * @param {import("./types.js").BackgroundJobOptions} args.options - Job options.
     * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
     * @returns {Promise<string>} - Stable original job id.
     */
    _enqueueIdempotently({ args, options, preparedJob }: {
        args: Array<ReturnType<typeof JSON.parse>>;
        options: import("./types.js").BackgroundJobOptions;
        preparedJob: PreparedBackgroundJob;
    }): Promise<string>;
    /**
     * Serializes one physical connection locally without taking ownership away
     * from the database uniqueness constraint shared by all processes.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Transaction work.
     * @returns {Promise<T>} - Callback result.
     */
    _idempotentEnqueueTransaction<T>(callback: (db: import("../database/drivers/base.js").default) => Promise<T>): Promise<T>;
    /**
     * Inserts an ownership row, resolving only a database uniqueness race.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} ownership - Ownership row.
     * @returns {Promise<{created: boolean, row: Record<string, ReturnType<typeof JSON.parse>>}>} - Claim result.
     */
    _claimIdempotencyOwnership(db: import("../database/drivers/base.js").default, ownership: Record<string, ReturnType<typeof JSON.parse>>): Promise<{
        created: boolean;
        row: Record<string, ReturnType<typeof JSON.parse>>;
    }>;
    /**
     * Loads one durable enqueue owner.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scopeDigest - Fixed-size scope digest.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
     */
    _idempotencyOwnership(db: import("../database/drivers/base.js").default, scopeDigest: string): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Fails closed when a durable key is reused for a different canonical request.
     * @param {object} args - Validation input.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.existing - Stored owner.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.ownership - Requested owner.
     * @returns {void}
     */
    _validateIdempotencyOwnership({ existing, ownership }: {
        existing: Record<string, ReturnType<typeof JSON.parse>>;
        ownership: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
    /**
     * Persists the built-in mail operation in the same first-enqueue transaction.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @param {object} args - Operation input.
     * @param {number} args.createdAtMs - Creation timestamp.
     * @param {string} args.jobId - Native job id.
     * @param {{operation: import("../mailer/index.js").MailerDeliveryOperation, payload: import("../mailer/index.js").MailerDeliveryPayload} | null} args.mailOperationInput - Mail operation.
     * @returns {Promise<void>} - Resolves after persistence.
     */
    _persistMailDeliveryOperation(db: import("../database/drivers/base.js").default, { createdAtMs, jobId, mailOperationInput }: {
        createdAtMs: number;
        jobId: string;
        mailOperationInput: {
            operation: import("../mailer/index.js").MailerDeliveryOperation;
            payload: import("../mailer/index.js").MailerDeliveryPayload;
        } | null;
    }): Promise<void>;
    /**
     * Validates the durable mail row during an exact generic enqueue replay.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Validation input.
     * @param {string} args.jobId - Owned job id.
     * @param {{operation: import("../mailer/index.js").MailerDeliveryOperation, payload: import("../mailer/index.js").MailerDeliveryPayload} | null} args.mailOperationInput - Mail operation.
     * @returns {Promise<void>} - Resolves when exact.
     */
    _validateMailDeliveryOperation(db: import("../database/drivers/base.js").default, { jobId, mailOperationInput }: {
        jobId: string;
        mailOperationInput: {
            operation: import("../mailer/index.js").MailerDeliveryOperation;
            payload: import("../mailer/index.js").MailerDeliveryPayload;
        } | null;
    }): Promise<void>;
    /**
     * Loads a durable mail operation.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} operationKey - Fixed-size operation key.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
     */
    _mailDeliveryOperation(db: import("../database/drivers/base.js").default, operationKey: string): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Compares provider-relevant durable mail operation fields.
     * @param {object} args - Validation input.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.existing - Stored row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.requested - Requested row.
     * @returns {void}
     */
    _validateMailDeliveryOperationRow({ existing, requested }: {
        existing: Record<string, ReturnType<typeof JSON.parse>>;
        requested: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
    /**
     * Canonical request digest excluding generated ids and immediate enqueue time.
     * @param {object} args - Digest input.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
     * @param {import("./types.js").BackgroundJobOptions} args.options - Job options.
     * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
     * @returns {string} - SHA-256 digest.
     */
    _idempotencyRequestDigest({ args, options, preparedJob }: {
        args: Array<ReturnType<typeof JSON.parse>>;
        options: import("./types.js").BackgroundJobOptions;
        preparedJob: PreparedBackgroundJob;
    }): string;
    /**
     * Fixed-size globally indexed representation of the documented scope tuple.
     * @param {object} args - Scope input.
     * @param {string} args.idempotencyKey - Caller key.
     * @param {string} args.jobName - Job class name.
     * @param {string} args.queue - Queue name.
     * @returns {string} - SHA-256 scope digest.
     */
    _idempotencyScopeDigest({ idempotencyKey, jobName, queue }: {
        idempotencyKey: string;
        jobName: string;
        queue: string;
    }): string;
    /**
     * Validates one caller key.
     * @param {string | undefined} idempotencyKey - Caller key.
     * @returns {string} - Valid key.
     */
    _normalizeIdempotencyKey(idempotencyKey: string | undefined): string;
    /**
     * Replaces the queued owner of a stable schedule key with a new one-off job.
     * A handed-off owner is left running and reported truthfully.
     * @param {object} args - Options.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @param {string} args.jobName - Job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Arguments.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Options.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    replaceScheduled({ scheduleKey, jobName, args, options }: {
        scheduleKey: string;
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<import("./types.js").BackgroundJobReplacementResult>;
    /**
     * Cancels the queued owner of a stable schedule key. A handed-off owner is
     * detached but not marked stopped because execution may already be running.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    cancelScheduled(scheduleKey: string): Promise<import("./types.js").BackgroundJobCancellationResult>;
    /**
     * Runs next available job.
     * @param {object} [args] - Options.
     * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} [args.executionMode] - Execution mode or modes to match.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next job.
     */
    nextAvailableJob(args?: {
        executionMode?: import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[];
    }): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Returns the soonest future-scheduled queued job (one whose
     * `scheduled_at_ms` is in the future), or null when there are no
     * future-scheduled jobs. Used by the event-driven dispatcher to arm a
     * `setTimeout` for the exact moment the next scheduled job becomes
     * eligible, replacing the legacy 1-second polling loop.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Soonest future-scheduled job, or null.
     */
    nextScheduledJob(): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Runs next queued job.
     * @param {object} args - Options.
     * @param {import("../database/drivers/base.js").default} args.db - Database connection.
     * @param {"<=" | ">"} args.scheduledAtOperator - Scheduled timestamp operator.
     * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} [args.executionMode] - Execution mode or modes to match.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next matching queued job.
     */
    _nextQueuedJob({ db, scheduledAtOperator, executionMode }: {
        db: import("../database/drivers/base.js").default;
        scheduledAtOperator: "<=" | ">";
        executionMode?: import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[];
    }): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Builds a raw SQL ORDER BY expression ranking queued jobs by their queue's
     * configured priority (`backgroundJobs.queues[queue].priority`, default `0`),
     * so the dispatcher picks higher-priority queues first regardless of enqueue
     * order. Only applied to the dispatch path (`scheduledAtOperator === "<="`);
     * the future-scheduled lookup must stay strictly time-ordered. Composes with
     * the concurrency EXISTS filter: a higher-priority queue already at its cap is
     * filtered out, so dispatch falls through to the next eligible lower-priority
     * job. Returns null when no queue configures a non-zero priority so the plain
     * FIFO ordering is left untouched (and no needless filesort is introduced).
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {string | null} - Raw SQL CASE expression, or null when no queue is prioritized.
     */
    _queuePriorityOrderSql(db: import("../database/drivers/base.js").default): string | null;
    /**
     * Runs get job.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Job row.
     */
    getJob(jobId: string): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Counts jobs grouped by status. Used by the dashboard overview.
     * @returns {Promise<Record<string, number>>} - Counts keyed by status.
     */
    countsByStatus(): Promise<Record<string, number>>;
    /**
     * Returns the authoritative dashboard count snapshot and its matching durable
     * revision. Locking the revision row before counting prevents a writer from
     * committing between the count query and revision read.
     * @returns {Promise<{counts: Record<string, number>, revision: number, total: number}>} Snapshot.
     */
    countSnapshot(): Promise<{
        counts: Record<string, number>;
        revision: number;
        total: number;
    }>;
    /**
     * Counts jobs matching the given filters.
     * @param {object} [args] - Options.
     * @param {string} [args.status] - Filter by status.
     * @param {string} [args.jobName] - Filter by job name.
     * @returns {Promise<number>} - Matching job count.
     */
    countJobs({ status, jobName }?: {
        status?: string;
        jobName?: string;
    }): Promise<number>;
    /**
     * Lists jobs for the dashboard, filtered, sorted and paginated.
     * @param {object} [args] - Options.
     * @param {string} [args.status] - Filter by status.
     * @param {string} [args.jobName] - Filter by job name.
     * @param {number} [args.limit] - Maximum rows to return.
     * @param {number} [args.offset] - Rows to skip.
     * @param {string} [args.sortColumn] - Camel-cased column to sort by (see SORTABLE_COLUMNS).
     * @param {"ASC" | "DESC"} [args.sortDirection] - Sort direction.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Normalized job rows.
     */
    listJobs({ status, jobName, limit, offset, sortColumn, sortDirection }?: {
        status?: string;
        jobName?: string;
        limit?: number;
        offset?: number;
        sortColumn?: string;
        sortDirection?: "ASC" | "DESC";
    }): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Runs mark handed off.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Caller-selected exact lease id. Generated for legacy direct callers when omitted.
     * @param {string} [args.workerId] - Worker id.
     * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Claimed handoff lease, or null when no longer queued.
     */
    markHandedOff({ jobId, handoffId, workerId }: {
        jobId: string;
        handoffId?: string;
        workerId?: string;
    }): Promise<import("./types.js").BackgroundJobHandoff | null>;
    /**
     * Runs mark completed.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    markCompleted({ jobId, handoffId, workerId, handedOffAtMs }: {
        jobId: string;
        handoffId?: string;
        workerId?: string;
        handedOffAtMs?: number;
    }): Promise<boolean>;
    /**
     * Returns an active handoff to the queue at a caller-requested future time.
     * This is normal job control flow: it preserves failure attempts and metadata.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {number} args.delayMs - Delay from persistence time in milliseconds.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    markRescheduled({ jobId, delayMs, handoffId, workerId, handedOffAtMs }: {
        jobId: string;
        delayMs: number;
        handoffId?: string;
        workerId?: string;
        handedOffAtMs?: number;
    }): Promise<boolean>;
    /**
     * Runs mark returned to queue.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} args.handoffId - Handoff lease id.
     * @returns {Promise<void>} - Resolves when updated.
     */
    markReturnedToQueue({ jobId, handoffId }: {
        jobId: string;
        handoffId: string;
    }): Promise<void>;
    /**
     * Returns the active `handed_off` jobs (jobId + handoffId) held under a worker
     * id. Used on worker reconnect: after a main restart a worker reconnects with
     * its stable id, and the fresh main adopts these leases so they are tracked —
     * and released if the reconnected worker later disconnects — instead of
     * sitting stuck until the age-based orphan sweep. This never reclaims, so a
     * gracefully-draining worker that keeps running its in-flight jobs is left
     * untouched. Rows with a null handoff id (legacy) are skipped; the orphan
     * sweep reclaims those via its `handed_off_at_ms` fence.
     * @param {object} args - Options.
     * @param {string} args.workerId - Worker id.
     * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active handoffs.
     */
    handedOffJobsForWorker({ workerId }: {
        workerId: string;
    }): Promise<Array<{
        jobId: string;
        handoffId: string;
    }>>;
    /**
     * Snapshots exact, lease-aware active handoffs before a new main generation
     * starts accepting worker reconnects. Legacy rows without a complete worker,
     * lease, and timestamp identity stay owned by the age-based orphan sweep.
     * @returns {Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>} - Exact startup handoffs.
     */
    snapshotHandedOffJobs(): Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>;
    /**
     * Reclaims only unchanged exact handoffs selected by a main-generation startup
     * snapshot. The ordinary orphan failure path owns retries, terminal status,
     * count transitions, schedule ownership, and concurrency release.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobHandoffSnapshot[]} args.handoffs - Exact startup snapshots.
     * @param {ReturnType<typeof JSON.parse>} args.error - Orphan reason.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Accepted transitions.
     */
    markOrphanedHandoffs({ handoffs, error }: {
        handoffs: import("./types.js").BackgroundJobHandoffSnapshot[];
        error: ReturnType<typeof JSON.parse>;
    }): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Runs mark failed.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {ReturnType<typeof JSON.parse>} args.error - Error.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job row when the report was accepted.
     */
    markFailed({ jobId, error, handoffId, workerId, handedOffAtMs }: {
        jobId: string;
        error: ReturnType<typeof JSON.parse>;
        handoffId?: string;
        workerId?: string;
        handedOffAtMs?: number;
    }): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Runs mark orphaned jobs.
     * @param {object} [args] - Options.
     * @param {number} [args.orphanedAfterMs] - Mark jobs orphaned after this duration.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - The jobs this sweep marked orphaned.
     */
    markOrphanedJobs({ orphanedAfterMs }?: {
        orphanedAfterMs?: number;
    }): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Applies the common fenced orphan transition and records one aggregate count
     * delta for the accepted rows.
     * @param {object} args - Options.
     * @param {import("../database/drivers/base.js").default} args.db - Transaction connection.
     * @param {ReturnType<typeof JSON.parse>} args.error - Orphan reason.
     * @param {BackgroundJobOrphanSelection[]} args.selections - Selected handoffs and exact fences.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Accepted transitions.
     */
    _markOrphanSelections({ db, error, selections }: {
        db: import("../database/drivers/base.js").default;
        error: ReturnType<typeof JSON.parse>;
        selections: BackgroundJobOrphanSelection[];
    }): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Deletes terminal job rows past their retention window so the jobs table
     * does not grow unbounded (completed rows in particular accumulate forever
     * otherwise). Batched by id — SELECT a page of ids, then
     * `DELETE ... WHERE id IN (...)` — rather than `DELETE ... LIMIT`, which not
     * every driver supports; each batch runs on its own connection so the sweep
     * yields between batches instead of holding one long transaction.
     * @param {object} [args] - Options.
     * @param {number | null} [args.completedTtlMs] - Delete `completed` jobs whose `completed_at_ms` is older than this many ms. Falsy or `<= 0` disables completed pruning.
     * @param {number | null} [args.failedTtlMs] - Delete terminal `failed`/`orphaned` jobs older than this many ms (by `failed_at_ms`/`orphaned_at_ms`). Falsy or `<= 0` disables.
     * @param {number} [args.batchSize] - Max rows deleted per batch. Default `1000`.
     * @returns {Promise<number>} - Total rows deleted.
     */
    pruneTerminalJobs({ completedTtlMs, failedTtlMs, batchSize }?: {
        completedTtlMs?: number | null;
        failedTtlMs?: number | null;
        batchSize?: number;
    }): Promise<number>;
    /**
     * Deletes rows of one terminal status older than a cutoff, batch by batch,
     * until a page returns fewer than `batchSize` rows.
     * @param {object} args - Options.
     * @param {string} args.status - Terminal status to prune.
     * @param {string} args.column - Timestamp column compared against the cutoff.
     * @param {number} args.cutoff - Delete rows whose column value is `<= cutoff`.
     * @param {number} args.batchSize - Max rows per batch.
     * @returns {Promise<number>} - Rows deleted for this status.
     */
    _pruneStatusBatches({ status, column, cutoff, batchSize }: {
        status: string;
        column: string;
        cutoff: number;
        batchSize: number;
    }): Promise<number>;
    /**
     * Runs clear all.
     * @returns {Promise<void>} - Resolves when cleared.
     */
    clearAll(): Promise<void>;
    /**
     * Cancels a queued or handed-off job and releases any durable concurrency reservation.
     * @param {string} jobId - Job id.
     * @returns {Promise<boolean>} - Whether the job was cancelled.
     */
    cancel(jobId: string): Promise<boolean>;
    /**
     * Runs get retry delay ms.
     * @param {number} retryCount - Retry attempt count (1-based).
     * @returns {number} - Delay in milliseconds.
     */
    getRetryDelayMs(retryCount: number): number;
    /**
     * Normalizes one new job before entering its persistence transaction.
     * @param {object} args - Job input.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
     * @param {string} args.jobName - Job name.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {PreparedBackgroundJob} - Prepared job.
     */
    _prepareJob({ args, jobName, options }: {
        args: Array<ReturnType<typeof JSON.parse>>;
        jobName: string;
        options?: import("./types.js").BackgroundJobOptions;
    }): PreparedBackgroundJob;
    /**
     * Normalizes a per-job timeout while preserving omitted (worker fallback)
     * separately from explicitly disabled.
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @returns {number | null} - Positive timeout, zero for disabled, or null when omitted.
     */
    _normalizeJobTimeoutMs(options: import("./types.js").BackgroundJobOptions | undefined): number | null;
    /**
     * Inserts one prepared queued job, including its concurrency registration.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Insert input.
     * @param {PreparedBackgroundJob} args.preparedJob - Prepared job.
     * @param {string | null} args.scheduleKey - Historical stable key.
     * @returns {Promise<void>} - Resolves after insertion.
     */
    _insertPreparedJob(db: import("../database/drivers/base.js").default, { preparedJob, scheduleKey }: {
        preparedJob: PreparedBackgroundJob;
        scheduleKey: string | null;
    }): Promise<void>;
    /**
     * Runs normalize max retries.
     * @param {number | null | undefined} maxRetries - Input.
     * @returns {number} - Normalized max retries.
     */
    _normalizeMaxRetries(maxRetries: number | null | undefined): number;
    /**
     * Runs normalize scheduled at ms.
     * @param {number | undefined} scheduledAtMs - Requested dispatch timestamp.
     * @param {number} defaultScheduledAtMs - Default dispatch timestamp.
     * @returns {number} - Dispatch timestamp.
     */
    _normalizeScheduledAtMs(scheduledAtMs: number | undefined, defaultScheduledAtMs: number): number;
    /**
     * Resolves a reschedule delay against persistence time.
     * @param {number} delayMs - Delay in milliseconds.
     * @returns {number} - Future eligibility timestamp.
     */
    _rescheduledAtMs(delayMs: number): number;
    /**
     * Validates a public reschedule delay before persistence work begins.
     * @param {number} delayMs - Delay in milliseconds.
     * @returns {void}
     */
    _validateRescheduleDelayMs(delayMs: number): void;
    /**
     * Validates a stable schedule key at the public storage boundary.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {string} - Validated key.
     */
    _normalizeScheduleKey(scheduleKey: string): string;
    /**
     * Builds a bounded advisory-lock name for one stable schedule key.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {string} - Advisory-lock name.
     */
    _scheduleKeyLockName(scheduleKey: string): string;
    /**
     * Ensures the background-jobs schema exists, reusing a caller-held connection when
     * one is given rather than checking out its own.
     * @param {import("../database/drivers/base.js").default} [existingDb] - Reuse an
     *   already-checked-out connection (e.g. the one `db:migrate` holds) instead of
     *   checking out a nested one — the nested checkout would deadlock a database
     *   whose pool is capped at a single connection already held by the caller.
     * @returns {Promise<void>} - Resolves when the schema is present.
     */
    _ensureSchema(existingDb?: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Serializes creation or upgrade of the background-jobs schema, checking out a
     * connection only after earlier schema work has completed when one is not supplied.
     * @param {import("../database/drivers/base.js").default} [existingDb] - Caller-owned
     *   database connection.
     * @returns {Promise<void>} - Resolves when the schema is present.
     */
    _applySchema(existingDb?: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Creates or upgrades the background-jobs tables, columns and concurrency rows on
     * the given connection. Serialized per process by {@link BackgroundJobsStore#_applySchema}.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when the schema is present.
     */
    _applySchemaSteps(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Runs ensure migrations table.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _ensureMigrationsTable(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Runs has migration.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} [version] - Migration version.
     * @returns {Promise<boolean>} - Whether migration exists.
     */
    _hasMigration(db: import("../database/drivers/base.js").default, version?: string): Promise<boolean>;
    /**
     * Runs apply migrations.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _applyMigrations(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Runs ensure jobs table columns.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _ensureJobsTableColumns(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Repairs secondary indexes that older add-column upgrades declared but did
     * not create on every SQL driver. The migration ledger keeps routine store
     * readiness from repeatedly introspecting the full index set.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when all expected indexes exist.
     */
    _ensureJobsTableIndexesOnce(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Idempotently adds the per-job wall-clock timeout to existing job tables.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    _ensureJobTimeoutColumn(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Idempotently adds the historical stable schedule key to existing jobs.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    _ensureScheduleKeyColumn(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Idempotently adds the `queue` column to an existing jobs table. Existing
     * rows read back as the default queue (see {@link _normalizeJobRow}), so no
     * data backfill is required.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    _ensureQueueColumn(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Runs backfill execution modes once.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _backfillExecutionModesOnce(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Rewrites pre-existing pooled rows (persisted as `execution_mode = "forked"`
     * plus a `velocious-pooled:*` handoff marker) to `execution_mode = "pooled"`,
     * clears the queued marker, then drops the now-redundant `forked` column so
     * `execution_mode` is the single source of truth. Runs once, guarded by the
     * migration ledger and a per-key advisory lock; a fresh table (created without
     * the column) short-circuits.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _dropForkedColumnOnce(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Runs record migration.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} version - Migration version.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _recordMigration(db: import("../database/drivers/base.js").default, version: string): Promise<void>;
    _initializeModel(): Promise<void>;
    /**
     * Runs get job row by id.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Job row.
     */
    _getJobRowById(db: import("../database/drivers/base.js").default, jobId: string): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Releases ownership only when the key still points at the expected job.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Ownership identity.
     * @param {string} args.jobId - Expected owner job id.
     * @param {string} args.scheduleKey - Stable schedule key.
     * @returns {Promise<void>} - Resolves when deleted or already superseded.
     */
    _releaseScheduleOwnership(db: import("../database/drivers/base.js").default, { jobId, scheduleKey }: {
        jobId: string;
        scheduleKey: string;
    }): Promise<void>;
    /**
     * Releases a job's ownership when it has a historical schedule key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {import("./types.js").BackgroundJobRow} job - Terminal job.
     * @returns {Promise<void>} - Resolves when deleted or not applicable.
     */
    _releaseScheduleOwnershipForJob(db: import("../database/drivers/base.js").default, job: import("./types.js").BackgroundJobRow): Promise<void>;
    /**
     * Runs apply failure.
     * @param {object} args - Options.
     * @param {import("../database/drivers/base.js").default} args.db - Database connection.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
     * @param {ReturnType<typeof JSON.parse>} args.error - Error.
     * @param {boolean} args.markOrphaned - Whether marking orphaned.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.conditions] - Update fencing conditions. Defaults to the active-handoff lease match; the time-based orphan sweep overrides this with an id/status match so it can reclaim rows whose `handoff_id` is null (e.g. handed off by an older velocious before handoff-id fencing existed).
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job row when the lease transition won.
     */
    _applyFailure({ db, job, error, markOrphaned, conditions }: {
        db: import("../database/drivers/base.js").default;
        job: import("./types.js").BackgroundJobRow;
        error: ReturnType<typeof JSON.parse>;
        markOrphaned: boolean;
        conditions?: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Runs failure update.
     * @param {object} args - Options.
     * @param {string} args.failureMessage - Last failure message.
     * @param {boolean} args.markOrphaned - Whether marking orphaned.
     * @param {number} args.nextAttempt - Next attempt count.
     * @param {number} args.now - Current timestamp.
     * @param {BackgroundJobQueuedConcurrency | null} args.queuedConcurrency - Current queue policy for a retry.
     * @param {number | null} args.scheduledAt - Next scheduled timestamp.
     * @param {boolean} args.shouldRetry - Whether the job should retry.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Database update data.
     */
    _failureUpdate({ failureMessage, markOrphaned, nextAttempt, now, queuedConcurrency, scheduledAt, shouldRetry }: {
        failureMessage: string;
        markOrphaned: boolean;
        nextAttempt: number;
        now: number;
        queuedConcurrency: BackgroundJobQueuedConcurrency | null;
        scheduledAt: number | null;
        shouldRetry: boolean;
    }): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs apply orphaned failure update.
     * @param {object} args - Options.
     * @param {boolean} args.markOrphaned - Whether marking orphaned.
     * @param {number} args.now - Current timestamp.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.update - Database update data.
     * @returns {void}
     */
    _applyOrphanedFailureUpdate({ markOrphaned, now, update }: {
        markOrphaned: boolean;
        now: number;
        update: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
    /**
     * Runs apply failure status update.
     * @param {object} args - Options.
     * @param {boolean} args.markOrphaned - Whether marking orphaned.
     * @param {number} args.now - Current timestamp.
     * @param {number | null} args.scheduledAt - Next scheduled timestamp.
     * @param {boolean} args.shouldRetry - Whether the job should retry.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.update - Database update data.
     * @returns {void}
     */
    _applyFailureStatusUpdate({ markOrphaned, now, scheduledAt, shouldRetry, update }: {
        markOrphaned: boolean;
        now: number;
        scheduledAt: number | null;
        shouldRetry: boolean;
        update: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
    /**
     * Runs normalize job row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw database row.
     * @returns {import("./types.js").BackgroundJobRow} - Normalized job row.
     */
    _normalizeJobRow(row: Record<string, ReturnType<typeof JSON.parse>>): import("./types.js").BackgroundJobRow;
    /**
     * Normalizes a job's queue name, defaulting to "default".
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @returns {string} - Queue name.
     */
    _normalizeQueue(options: import("./types.js").BackgroundJobOptions | undefined): string;
    /**
     * Resolves a job's durable concurrency. An explicit concurrencyKey/maxConcurrency
     * pair always wins. Otherwise, when the job's queue has a configured cap
     * (`backgroundJobs.queues[queue].maxConcurrent`), derive a queue-scoped
     * concurrency key so the queue cap is enforced cluster-wide through the
     * existing durable concurrency mechanism.
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @param {string} queue - Normalized queue name.
     * @returns {{concurrencyKey: string, maxConcurrency: number, queueDerived: boolean} | null} - Resolved concurrency.
     */
    _resolveConcurrency(options: import("./types.js").BackgroundJobOptions | undefined, queue: string): {
        concurrencyKey: string;
        maxConcurrency: number;
        queueDerived: boolean;
    } | null;
    /**
     * Resolves the current concurrency policy for a transition back to queued.
     * Explicit concurrency remains owned by the enqueue request; queue-derived
     * concurrency adopts the queue's current cap or removal.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {import("./types.js").BackgroundJobRow} job - Active handoff snapshot.
     * @returns {Promise<BackgroundJobQueuedConcurrency>} - Current queued concurrency.
     */
    _requeuedJobConcurrency(db: import("../database/drivers/base.js").default, job: import("./types.js").BackgroundJobRow): Promise<BackgroundJobQueuedConcurrency>;
    /**
     * Reads the configured max concurrency for a queue from the background-jobs config.
     * @param {string} queue - Queue name.
     * @returns {number | null} - Positive integer cap, or null when the queue has no configured cap.
     */
    _queueMaxConcurrency(queue: string): number | null;
    /**
     * Like {@link _ensureConcurrencyKey}, but for queue-derived keys the configured
     * queue cap is the source of truth: if it changed, update the stored cap
     * instead of throwing on conflict (config-driven caps must be tunable).
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {{concurrencyKey: string, maxConcurrency: number}} concurrency - Concurrency configuration.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    _ensureQueueConcurrencyKey(db: import("../database/drivers/base.js").default, { concurrencyKey, maxConcurrency }: {
        concurrencyKey: string;
        maxConcurrency: number;
    }): Promise<void>;
    /**
     * Ensures the concurrency state table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ready.
     */
    _ensureConcurrencyTable(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Ensures the stable schedule-key ownership table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ready.
     */
    _ensureScheduleKeysTable(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Ensures durable generic enqueue ownership exists independently of job rows.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ready.
     */
    _ensureIdempotencyKeysTable(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Ensures durable provider-backed mail operation state exists independently of jobs.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ready.
     */
    _ensureMailDeliveryOperationsTable(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Ensures the singleton durable count-revision row exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} Resolves when ready.
     */
    _ensureCountRevisionTable(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Records one logical count mutation atomically and broadcasts it after commit.
     * Zero entries are omitted; a wholly zero-net mutation does not consume a revision.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @param {Record<string, number>} requestedDeltas - Signed bucket changes.
     * @returns {Promise<void>} Resolves when recorded.
     */
    _recordCountDelta(db: import("../database/drivers/base.js").default, requestedDeltas: Record<string, number>): Promise<void>;
    /**
     * Records a transition between persisted statuses.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @param {string} oldStatus - Previous status.
     * @param {string} newStatus - New status.
     * @returns {Promise<void>} Resolves when recorded.
     */
    _recordStatusTransition(db: import("../database/drivers/base.js").default, oldStatus: string, newStatus: string): Promise<void>;
    /**
     * Reads the locked revision.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<number>} Revision.
     */
    _countRevision(db: import("../database/drivers/base.js").default): Promise<number>;
    /**
     * Takes a portable write lock on the singleton revision row.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} Resolves when locked.
     */
    _lockCountRevision(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Builds zeroed canonical buckets.
     * @returns {Record<string, number>} Zeroed canonical buckets.
     */
    _emptyCountBuckets(): Record<string, number>;
    /**
     * Counts normalized rows by canonical status.
     * @param {import("./types.js").BackgroundJobRow[]} jobs - Jobs.
     * @returns {Record<string, number>} Counts.
     */
    _statusCounts(jobs: import("./types.js").BackgroundJobRow[]): Record<string, number>;
    /**
     * Reads a canonical snapshot after locking the revision row.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @returns {Promise<{counts: Record<string, number>, revision: number, total: number}>} Snapshot.
     */
    _countSnapshotOnLockedConnection(db: import("../database/drivers/base.js").default): Promise<{
        counts: Record<string, number>;
        revision: number;
        total: number;
    }>;
    /**
     * Registers or verifies a stable key configuration.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} concurrency - Concurrency configuration.
     * @param {string} concurrency.concurrencyKey - Concurrency key.
     * @param {number} concurrency.maxConcurrency - Stable cap.
     * @returns {Promise<void>} - Resolves when verified.
     */
    _ensureConcurrencyKey(db: import("../database/drivers/base.js").default, { concurrencyKey, maxConcurrency }: {
        concurrencyKey: string;
        maxConcurrency: number;
    }): Promise<void>;
    /**
     * Locks the concurrency counter row so a job-release transaction acquires it *before* the job
     * row. {@link markHandedOff} reserves capacity (locking the counter row) before it updates the
     * job, so it locks concurrency-then-job; the release paths update the job before releasing
     * capacity, which is job-then-concurrency. Those opposite orders on the same shared counter row
     * are what deadlock (AB-BA) under a draining worker. Taking this lock first gives every
     * transaction a single concurrency-then-job order and removes the cycle.
     *
     * Uses a value-preserving `UPDATE` rather than `SELECT ... FOR UPDATE` so it stays portable
     * across drivers without row-level locking reads (e.g. SQLite); on row-locking engines the
     * matched row is write-locked for the rest of the transaction even though its value is unchanged.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string | null} concurrencyKey - Concurrency key.
     * @returns {Promise<void>} - Resolves when the counter row is locked.
     */
    _lockConcurrencyRow(db: import("../database/drivers/base.js").default, concurrencyKey: string | null): Promise<void>;
    /**
     * Atomically reserves capacity for a key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} concurrencyKey - Concurrency key.
     * @returns {Promise<boolean>} - Whether capacity was reserved.
     */
    _reserveConcurrency(db: import("../database/drivers/base.js").default, concurrencyKey: string): Promise<boolean>;
    /**
     * Runs a portable update and returns its affected-row count.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {import("../database/drivers/base.js").UpdateSqlArgsType} args - Update options.
     * @returns {Promise<number>} - Affected row count.
     */
    _updateAffectedRows(db: import("../database/drivers/base.js").default, args: import("../database/drivers/base.js").UpdateSqlArgsType): Promise<number>;
    /**
     * Releases capacity for a key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string | null} concurrencyKey - Concurrency key.
     * @returns {Promise<void>} - Resolves when released.
     */
    _releaseConcurrency(db: import("../database/drivers/base.js").default, concurrencyKey: string | null): Promise<void>;
    /**
     * Rebuilds durable counts from active handoffs.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {{insideTransaction?: boolean}} [options] - Reuse an enclosing transaction.
     * @returns {Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>} - Repair summary.
     */
    _reconcileConcurrency(db: import("../database/drivers/base.js").default, { insideTransaction }?: {
        insideTransaction?: boolean;
    }): Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>;
    /**
     * Rebuilds one counter after locking it ahead of the job rows, matching the
     * lock order used by handoff and completion transitions.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} concurrencyKey - Counter key.
     * @returns {Promise<import("./types.js").BackgroundJobConcurrencyRepair | null>} - Applied repair.
     */
    _reconcileConcurrencyKey(db: import("../database/drivers/base.js").default, concurrencyKey: string): Promise<import("./types.js").BackgroundJobConcurrencyRepair | null>;
    /**
     * Validates a database count before it participates in reconciliation.
     * @param {number | string} value - Raw count.
     * @param {string} concurrencyKey - Counter key for diagnostics.
     * @returns {number} - Safe non-negative count.
     */
    _validatedConcurrencyCount(value: number | string, concurrencyKey: string): number;
    /**
     * Reconciles queue-derived concurrency with the current configuration. Only
     * invoked through {@link reconcileQueueConcurrency} — the explicit lifecycle
     * path run at main-process startup under a cross-process advisory lock —
     * never from schema/tenant checks or routine connection initialization,
     * which stay read-only regarding queued job rows. The per-process memo is
     * latched by {@link reconcileQueueConcurrency} only after the following
     * count rebuild also succeeds, so a failed rebuild re-enters here on retry
     * (the adoption UPDATEs below are idempotent). Enqueue only consults config for new jobs, so a cap added, removed, or changed
     * while a backlog exists otherwise leaves persisted rows stale: pre-cap jobs
     * keep a null key and bypass the cap, post-removal jobs stay capped under a
     * now-unconfigured key, and a changed numeric cap stays stale until the next
     * enqueue. Bring queued durable state in line with config: sync each configured
     * queue's stored cap, adopt not-yet-keyed queued jobs onto their queue key,
     * and release queued jobs from queue keys whose queue is no longer capped.
     * Existing handoffs retain the policy and reservation they started with, so
     * reconciliation cannot race their completion/retry transitions. Runs before
     * {@link _reconcileConcurrency} so any pre-existing active counts are exact.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when reconciled.
     */
    _reconcileQueueConcurrency(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Runs normalize number.
     * @param {ReturnType<typeof JSON.parse>} value - Input value.
     * @returns {number | null} - Normalized number.
     */
    _normalizeNumber(value: ReturnType<typeof JSON.parse>): number | null;
    /**
     * Runs normalize execution mode.
     * @param {import("./types.js").BackgroundJobOptions} [options] - Job options.
     * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
     */
    _normalizeExecutionMode(options?: import("./types.js").BackgroundJobOptions): import("./types.js").BackgroundJobExecutionMode;
    /**
     * Runs normalize execution mode name.
     * @param {string} executionMode - Execution mode name.
     * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
     */
    _normalizeExecutionModeName(executionMode: string): import("./types.js").BackgroundJobExecutionMode;
    /**
     * Filters queued jobs by one or more execution modes against the
     * `execution_mode` column (the single source of truth).
     * @param {object} args - Options.
     * @param {import("../database/drivers/base.js").default} args.db - Database connection.
     * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} args.executionMode - Runtime modes.
     * @param {import("../database/query/index.js").default} args.query - Query to filter.
     * @returns {import("../database/query/index.js").default} - Filtered query.
     */
    _whereExecutionMode({ db, executionMode, query }: {
        db: import("../database/drivers/base.js").default;
        executionMode: import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[];
        query: import("../database/query/index.js").default;
    }): import("../database/query/index.js").default;
    /**
     * Runs parse args.
     * @param {ReturnType<typeof JSON.parse>} value - Input value.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - Parsed args.
     */
    _parseArgs(value: ReturnType<typeof JSON.parse>): Array<ReturnType<typeof JSON.parse>>;
    /**
     * Runs with db.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    _withDb<T>(callback: (db: import("../database/drivers/base.js").default) => Promise<T>): Promise<T>;
    /**
     * Runs a value-returning callback inside the driver's void-typed transaction API.
     * @template T
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {() => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    _transactionResult<T>(db: import("../database/drivers/base.js").default, callback: () => Promise<T>): Promise<T>;
    /**
     * Serializes count-changing transactions before checking out their connection.
     * Database row locking still provides cross-process ordering; this guard
     * prevents concurrent callers on SQLite's shared connection from attempting
     * overlapping top-level transactions.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Transaction callback.
     * @param {BackgroundJobTransactionSerializationOptions} [options] - Serialization options.
     * @returns {Promise<T>} Callback result.
     */
    _serializedCountMutation<T>(callback: (db: import("../database/drivers/base.js").default) => Promise<T>, options?: BackgroundJobTransactionSerializationOptions): Promise<T>;
    /**
     * Admits transactions to the process-local FIFO before they check out a
     * connection. Cross-process ordering remains the responsibility of durable
     * row/advisory locks and unique constraints acquired around the callback.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Transaction callback.
     * @param {BackgroundJobTransactionSerializationOptions} [options] - Serialization options.
     * @returns {Promise<T>} Callback result.
     */
    _serializedTransactionMutation<T>(callback: (db: import("../database/drivers/base.js").default) => Promise<T>, options?: BackgroundJobTransactionSerializationOptions): Promise<T>;
    /**
     * Runs should accept report.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
     * @param {string | null | undefined} args.handoffId - Handoff lease id from report.
     * @param {string | null | undefined} args.workerId - Worker id from report.
     * @param {number | null | undefined} args.handedOffAtMs - Handed off timestamp from report.
     * @returns {boolean} - Whether to accept the report.
     */
    _shouldAcceptReport({ job, handoffId, workerId, handedOffAtMs }: {
        job: import("./types.js").BackgroundJobRow;
        handoffId: string | null | undefined;
        workerId: string | null | undefined;
        handedOffAtMs: number | null | undefined;
    }): boolean;
    /**
     * Runs active handoff conditions.
     * @param {import("./types.js").BackgroundJobRow} job - Job row.
     * @returns {Record<string, string | null>} - Conditional transition fence.
     */
    _activeHandoffConditions(job: import("./types.js").BackgroundJobRow): Record<string, string | null>;
    /**
     * Runs handoff id report matches.
     * @param {object} args - Options.
     * @param {string | null | undefined} args.handoffId - Handoff lease id from report.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
     * @returns {boolean} - Whether the handoff lease matches.
     */
    _handoffIdReportMatches({ handoffId, job }: {
        handoffId: string | null | undefined;
        job: import("./types.js").BackgroundJobRow;
    }): boolean;
    /**
     * Runs worker report matches.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
     * @param {string | null | undefined} args.workerId - Worker id from report.
     * @returns {boolean} - Whether the worker report matches.
     */
    _workerReportMatches({ job, workerId }: {
        job: import("./types.js").BackgroundJobRow;
        workerId: string | null | undefined;
    }): boolean;
    /**
     * Runs handoff report matches.
     * @param {object} args - Options.
     * @param {number | null | undefined} args.handedOffAtMs - Handed off timestamp from report.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
     * @returns {boolean} - Whether the handoff report matches.
     */
    _handoffReportMatches({ handedOffAtMs, job }: {
        handedOffAtMs: number | null | undefined;
        job: import("./types.js").BackgroundJobRow;
    }): boolean;
    /**
     * Runs migration key.
     * @param {string} [version] - Migration version.
     * @returns {string} - Migration key.
     */
    _migrationKey(version?: string): string;
}
//# sourceMappingURL=store.d.ts.map