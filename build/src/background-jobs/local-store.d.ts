import TableData from "../database/table-data/index.js";
export declare const LOCAL_BACKGROUND_JOBS_TABLE = "velocious_local_background_jobs";
export declare const LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE = "velocious_local_background_job_concurrency";
export declare const LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE = "velocious_local_background_job_schedule_keys";
export declare const LOCAL_BACKGROUND_JOBS_INDEX_NAMES: string[];
export declare const LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_INDEX_NAMES: string[];
/**
 * Creates the production clock used by local dispatch.
 * @returns {import("./types.js").LocalBackgroundJobsClock} - Production clock.
 */
export declare function localBackgroundJobsClock(): import("./types.js").LocalBackgroundJobsClock;
/** Namespaced portable SQLite persistence for local background jobs. */
export default class LocalBackgroundJobsStore {
    clock: import("./types.js").LocalBackgroundJobsClock;
    configuration: import("../configuration.js").default;
    databaseIdentifier: string | undefined;
    onCommittedEnqueue: (() => void) | undefined;
    _isReady: boolean;
    /** @type {Promise<void> | null} */
    _readyPromise: Promise<void> | null;
    /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
    _transactionReadyPromises: WeakMap<import("../database/drivers/base.js").default, {
        completion: Promise<void>;
        promise: Promise<void>;
    }>;
    /**
     * Creates a store for one configuration and local database.
     * @param {object} args - Store options.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {import("./types.js").LocalBackgroundJobsClock} [args.clock] - Persistence clock.
     * @param {string} [args.databaseIdentifier] - Configured local database identifier.
     * @param {() => void} [args.onCommittedEnqueue] - Commit-aware dispatcher wake.
     */
    constructor({ configuration, clock, databaseIdentifier, onCommittedEnqueue }: {
        configuration: import("../configuration.js").default;
        clock?: import("./types.js").LocalBackgroundJobsClock;
        databaseIdentifier?: string;
        onCommittedEnqueue?: () => void;
    });
    /**
     * Resolves the configured local database identifier.
     * @returns {string} - Database identifier.
     */
    getDatabaseIdentifier(): string;
    /**
     * Ensures the versioned physical schema exists.
     * @returns {Promise<void>} - Resolves when ready.
     */
    ensureReady(): Promise<void>;
    /**
     * Clears the per-instance readiness latch for a deliberate adapter reopen.
     * @returns {void} - No return value.
     */
    resetReadiness(): void;
    /**
     * Coordinates physical and transaction-local schema readiness.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @returns {Promise<void>} - Resolves when this caller can use the schema.
     */
    _ensureReadyWithDb(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Creates or upgrades the versioned local tables and indexes without
     * rebuilding persisted queue data.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @returns {Promise<boolean>} - Whether schema state changed.
     */
    _applySchema(db: import("../database/drivers/base.js").default): Promise<boolean>;
    /**
     * Idempotently adds columns from the current jobs table definition that an
     * existing local table is missing, so an upgraded framework finds a
     * compatible schema instead of failing the column assertion.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @returns {Promise<boolean>} - Whether a column was added.
     */
    _ensureJobColumns(db: import("../database/drivers/base.js").default): Promise<boolean>;
    /**
     * Builds the migration ledger table definition.
     * @returns {TableData} - Migration ledger table.
     */
    _migrationsTableData(): TableData;
    /**
     * Builds the local jobs table definition.
     * @returns {TableData} - Local jobs table definition.
     */
    _jobsTableData(): TableData;
    /**
     * Builds the local concurrency counter table definition.
     * @returns {TableData} - Concurrency counter table definition.
     */
    _concurrencyTableData(): TableData;
    /**
     * Builds the stable schedule-owner table definition.
     * @returns {TableData} - Stable owner table definition.
     */
    _scheduleKeysTableData(): TableData;
    /**
     * Rejects an incompatible current-version table rather than rebuilding data.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {string} tableName - Table name.
     * @param {string[]} expectedColumns - Required columns.
     * @returns {Promise<void>} - Resolves when compatible.
     */
    _assertColumns(db: import("../database/drivers/base.js").default, tableName: string, expectedColumns: string[]): Promise<void>;
    /**
     * Recreates missing indexes declared by the current schema.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @returns {Promise<boolean>} - Whether an index was created.
     */
    _ensureIndexes(db: import("../database/drivers/base.js").default): Promise<boolean>;
    /**
     * Checks whether the current local schema version is recorded.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string} version - Local schema version.
     * @returns {Promise<boolean>} - Whether the version is recorded.
     */
    _hasMigration(db: import("../database/drivers/base.js").default, version: string): Promise<boolean>;
    /**
     * Records one local schema version after its additive changes are present.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string} version - Local schema version.
     * @returns {Promise<void>} - Resolves after recording.
     */
    _recordMigration(db: import("../database/drivers/base.js").default, version: string): Promise<void>;
    /**
     * Builds the scoped migration key.
     * @param {string} version - Local schema version.
     * @returns {string} - Scoped migration key.
     */
    _migrationKey(version: string): string;
    /**
     * Enqueues a local job in the caller's active transaction when present.
     * @param {object} args - Enqueue request.
     * @param {string} args.jobName - Registered job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Serialized job arguments.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<string>} - Durable job id.
     */
    enqueue({ jobName, args, options }: {
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<string>;
    /**
     * Replaces the queued owner of a stable schedule key with a new local job.
     * A handed-off owner remains runnable but is detached from future ownership.
     * @param {object} args - Replacement request.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @param {string} args.jobName - Registered job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Serialized job arguments.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    replaceScheduled({ scheduleKey, jobName, args, options }: {
        scheduleKey: string;
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<import("./types.js").BackgroundJobReplacementResult>;
    /**
     * Cancels a queued stable owner or detaches an active handoff truthfully.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    cancelScheduled(scheduleKey: string): Promise<import("./types.js").BackgroundJobCancellationResult>;
    /**
     * Reads stable ownership and optional latest terminal history in one transaction.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @param {{includeLatestTerminal?: boolean}} [options] - Lookup options.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized local jobs.
     */
    getScheduledJob(scheduleKey: string, { includeLatestTerminal }?: {
        includeLatestTerminal?: boolean;
    }): Promise<import("./types.js").BackgroundJobScheduledLookupResult>;
    /**
     * Moves only a future queued stable owner to the current time.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Exact wake outcome.
     */
    wakeScheduled(scheduleKey: string): Promise<import("./types.js").BackgroundJobWakeResult>;
    /**
     * Serializes matching in-process deduplication checks through commit while
     * leaving unrelated job identities independent.
     * @template T
     * @param {import("./types.js").PreparedLocalBackgroundJob} preparedJob - Prepared job identity.
     * @param {(holdUntil: (completion: Promise<void>) => void) => Promise<T>} callback - Deduplication mutation.
     * @returns {Promise<T>} - Mutation result.
     */
    _serializeDeduplicatedEnqueue<T>(preparedJob: import("./types.js").PreparedLocalBackgroundJob, callback: (holdUntil: (completion: Promise<void>) => void) => Promise<T>): Promise<T>;
    /**
     * Prepares validated local job data for insertion.
     * @param {{args: Array<ReturnType<typeof JSON.parse>>, jobName: string, options: import("./types.js").BackgroundJobOptions}} args - Job request.
     * @returns {import("./types.js").PreparedLocalBackgroundJob} - Prepared row data.
     */
    _prepareJob({ args, jobName, options }: {
        args: Array<ReturnType<typeof JSON.parse>>;
        jobName: string;
        options: import("./types.js").BackgroundJobOptions;
    }): import("./types.js").PreparedLocalBackgroundJob;
    /**
     * Inserts one prepared local job row and its concurrency metadata.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {import("./types.js").PreparedLocalBackgroundJob} preparedJob - Prepared row data.
     * @param {string | null} [scheduleKey] - Stable schedule history key.
     * @param {number | null} [scheduleOrder] - Monotonic stable ownership order.
     * @returns {Promise<void>} - Resolves after insertion.
     */
    _insertPreparedJob(db: import("../database/drivers/base.js").default, preparedJob: import("./types.js").PreparedLocalBackgroundJob, scheduleKey?: string | null, scheduleOrder?: number | null): Promise<void>;
    /**
     * Reconciles configured queue-derived caps and durable counters.
     * @returns {Promise<void>} - Resolves after reconciliation.
     */
    reconcileQueueConcurrency(): Promise<void>;
    /**
     * Applies current queue-derived concurrency policy to one queued row.
     * Explicit concurrency keys remain owned by the enqueue contract.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {import("./types.js").BackgroundJobRow} job - Queued job snapshot.
     * @param {Record<string, {maxConcurrent?: number, priority?: number}>} queues - Current queue policy snapshot.
     * @returns {Promise<import("./types.js").BackgroundJobRow>} - Reconciled snapshot.
     */
    _reconcileQueuedJobConcurrency(db: import("../database/drivers/base.js").default, job: import("./types.js").BackgroundJobRow, queues: Record<string, {
        maxConcurrent?: number;
        priority?: number;
    }>): Promise<import("./types.js").BackgroundJobRow>;
    /**
     * Finds the next eligible local job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible local job.
     */
    nextAvailableJob(): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Finds the soonest future queued job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Soonest future queued job.
     */
    nextScheduledJob(): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Finds a persisted local job by id.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted job.
     */
    getJob(jobId: string): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Lists local jobs in creation order.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - All local jobs in creation order.
     */
    listJobs(): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Atomically reserves concurrency and claims one queued job.
     * @param {import("./types.js").BackgroundJobHandoffRequest} args - Claim request. A supplied handoff id is persisted exactly.
     * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Fenced claim.
     */
    markHandedOff({ jobId, handoffId, workerId }: import("./types.js").BackgroundJobHandoffRequest): Promise<import("./types.js").BackgroundJobHandoff | null>;
    /**
     * Finds active local handoffs owned by one worker.
     * @param {{workerId: string}} args - Worker identity.
     * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active worker handoffs.
     */
    handedOffJobsForWorker({ workerId }: {
        workerId: string;
    }): Promise<Array<{
        jobId: string;
        handoffId: string;
    }>>;
    /**
     * Returns an exact active handoff to the queue.
     * @param {{jobId: string, handoffId: string}} args - Handoff release.
     * @returns {Promise<void>} - Resolves after the fenced release.
     */
    markReturnedToQueue({ jobId, handoffId }: {
        jobId: string;
        handoffId: string;
    }): Promise<void>;
    /**
     * Applies a fenced successful acknowledgement.
     * @param {{jobId: string, handoffId?: string}} args - Completion report.
     * @returns {Promise<boolean>} - Whether the lease won.
     */
    markCompleted({ jobId, handoffId }: {
        jobId: string;
        handoffId?: string;
    }): Promise<boolean>;
    /**
     * Records pooled-child acceptance evidence for an active handoff. Only the
     * fields supplied are written, fenced by the exact active handoff lease.
     * @param {object} args - Acceptance report.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
     * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
     * @param {string} [args.childInstanceId] - Stable pooled child identity.
     * @param {number} [args.childPid] - Pooled child OS pid.
     * @returns {Promise<boolean>} - Whether the lease won.
     */
    markChildAccepted({ jobId, handoffId, receivedAtMs, startedAtMs, childInstanceId, childPid }: {
        jobId: string;
        handoffId?: string;
        receivedAtMs?: number;
        startedAtMs?: number;
        childInstanceId?: string;
        childPid?: number;
    }): Promise<boolean>;
    /**
     * Applies a fenced reschedule without consuming an attempt.
     * @param {{jobId: string, handoffId?: string, delayMs: number}} args - Reschedule report.
     * @returns {Promise<boolean>} - Whether the lease won.
     */
    markRescheduled({ jobId, handoffId, delayMs }: {
        jobId: string;
        handoffId?: string;
        delayMs: number;
    }): Promise<boolean>;
    /**
     * Applies a fenced failure, retry, or terminal transition.
     * @param {{jobId: string, handoffId?: string, error: ReturnType<typeof JSON.parse>}} args - Failure report.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Accepted transition snapshot.
     */
    markFailed({ jobId, handoffId, error }: {
        jobId: string;
        handoffId?: string;
        error: ReturnType<typeof JSON.parse>;
    }): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Turns every abandoned local handoff into the normal failure/retry path.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Recovered transitions.
     */
    recoverHandedOffJobs(): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Deletes local queue state for focused tests.
     * @returns {Promise<void>} - Resolves after deletion.
     */
    clearAll(): Promise<void>;
    /**
     * Applies the common retry or exhausted failure transition.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {import("./types.js").BackgroundJobRow} job - Active handoff.
     * @param {ReturnType<typeof JSON.parse>} error - Performance error.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Transition snapshot.
     */
    _applyFailure(db: import("../database/drivers/base.js").default, job: import("./types.js").BackgroundJobRow, error: ReturnType<typeof JSON.parse>): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Returns the database data that clears pooled-child acceptance evidence.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Cleared acceptance columns.
     */
    _clearedChildAcceptanceData(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Returns the row-shape counterpart of the cleared acceptance columns.
     * @returns {Pick<import("./types.js").BackgroundJobRow, "childInstanceId" | "childPid" | "childReceivedAtMs" | "childStartedAtMs">} - Cleared acceptance fields.
     */
    _clearedChildAcceptanceRow(): Pick<import("./types.js").BackgroundJobRow, "childInstanceId" | "childPid" | "childReceivedAtMs" | "childStartedAtMs">;
    /**
     * Ensures that a durable concurrency counter exists with the required cap.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {import("./types.js").ResolvedBackgroundJobConcurrency} concurrency - Desired counter.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    _ensureConcurrency(db: import("../database/drivers/base.js").default, concurrency: import("./types.js").ResolvedBackgroundJobConcurrency): Promise<void>;
    /**
     * Atomically reserves one slot for a concurrency key.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string} concurrencyKey - Concurrency key.
     * @returns {Promise<boolean>} - Whether a slot was reserved.
     */
    _reserveConcurrency(db: import("../database/drivers/base.js").default, concurrencyKey: string): Promise<boolean>;
    /**
     * Releases one slot for a concurrency key.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string | null} concurrencyKey - Concurrency key.
     * @returns {Promise<void>} - Resolves after release.
     */
    _releaseConcurrency(db: import("../database/drivers/base.js").default, concurrencyKey: string | null): Promise<void>;
    /**
     * Acquires the transaction's write lock for a concurrency counter row.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string | null} concurrencyKey - Concurrency key.
     * @returns {Promise<void>} - Resolves after locking.
     */
    _lockConcurrencyRow(db: import("../database/drivers/base.js").default, concurrencyKey: string | null): Promise<void>;
    /**
     * Rebuilds active counters from durable handed-off jobs.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @returns {Promise<void>} - Resolves after counter rebuild.
     */
    _rebuildConcurrencyCounts(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Builds the configured queue-priority ordering expression.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @returns {string | null} - Queue priority expression.
     */
    _queuePriorityOrderSql(db: import("../database/drivers/base.js").default): string | null;
    /**
     * Checks whether a persisted handoff owns the supplied acknowledgement fence.
     * @param {import("./types.js").BackgroundJobRow | null} job - Persisted job.
     * @param {string | undefined} handoffId - Handoff fence.
     * @returns {job is import("./types.js").BackgroundJobRow} - Whether accepted.
     */
    _acceptsHandoff(job: import("./types.js").BackgroundJobRow | null, handoffId: string | undefined): job is import("./types.js").BackgroundJobRow;
    /**
     * Finds a persisted local job using the current connection.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted row.
     */
    _getJob(db: import("../database/drivers/base.js").default, jobId: string): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Reads the job currently named by one stable owner row.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Normalized owner job.
     */
    _scheduledOwnerJob(db: import("../database/drivers/base.js").default, scheduleKey: string): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Assigns the next ownership order after SQLite write serialization is held.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<number>} - Next monotonic ownership order.
     */
    _nextScheduleOrder(db: import("../database/drivers/base.js").default, scheduleKey: string): Promise<number>;
    /**
     * Builds a stable-schedule lookup exclusively from normalized local jobs.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Lookup options.
     * @param {boolean} args.includeLatestTerminal - Whether terminal history is requested.
     * @param {string} args.scheduleKey - Validated stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized local jobs.
     */
    _scheduledJobLookup(db: import("../database/drivers/base.js").default, { includeLatestTerminal, scheduleKey }: {
        includeLatestTerminal: boolean;
        scheduleKey: string;
    }): Promise<import("./types.js").BackgroundJobScheduledLookupResult>;
    /**
     * Releases ownership only when the key still points at the expected job.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Ownership identity.
     * @param {string | null} args.jobId - Expected owner job id, or null for a dangling owner.
     * @param {string} args.scheduleKey - Stable schedule key.
     * @returns {Promise<void>} - Resolves when deleted or already superseded.
     */
    _releaseScheduleOwnership(db: import("../database/drivers/base.js").default, { jobId, scheduleKey }: {
        jobId: string | null;
        scheduleKey: string;
    }): Promise<void>;
    /**
     * Releases a terminal job's stable ownership when still current.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {import("./types.js").BackgroundJobRow} job - Terminal job.
     * @returns {Promise<void>} - Resolves when deleted or not applicable.
     */
    _releaseScheduleOwnershipForJob(db: import("../database/drivers/base.js").default, job: import("./types.js").BackgroundJobRow): Promise<void>;
    /**
     * Acquires SQLite's transaction write serialization before reading a stable
     * owner. A zero-row update still establishes the write boundary for a new key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<void>} - Resolves after write serialization is acquired.
     */
    _lockScheduleKey(db: import("../database/drivers/base.js").default, scheduleKey: string): Promise<void>;
    /**
     * Registers the local dispatch poke on the surrounding transaction commit.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @returns {Promise<void>} - Resolves after registration.
     */
    _wakeDispatcherAfterCommit(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Normalizes one raw local database row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw row.
     * @returns {import("./types.js").BackgroundJobRow} - Normalized row.
     */
    _normalizeRow(row: Record<string, ReturnType<typeof JSON.parse>>): import("./types.js").BackgroundJobRow;
    /**
     * Normalizes one nullable database number.
     * @param {ReturnType<typeof JSON.parse>} value - Database number.
     * @returns {number | null} - Normalized number.
     */
    _numberOrNull(value: ReturnType<typeof JSON.parse>): number | null;
    /**
     * Executes a structured update and reports its affected-row count.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {import("../database/drivers/base.js").UpdateSqlArgsType} args - Update arguments.
     * @returns {Promise<number>} - Affected rows.
     */
    _updateAffectedRows(db: import("../database/drivers/base.js").default, args: import("../database/drivers/base.js").UpdateSqlArgsType): Promise<number>;
    /**
     * Joins an ambient app transaction or uses the database's scoped operation lease.
     * @template T
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Mutation.
     * @returns {Promise<T>} - Mutation result.
     */
    _mutate<T>(db: import("../database/drivers/base.js").default, callback: (db: import("../database/drivers/base.js").default) => Promise<T>): Promise<T>;
    /**
     * Runs a callback in a transaction and returns its captured result.
     * @template T
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {() => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    _transactionResult<T>(db: import("../database/drivers/base.js").default, callback: () => Promise<T>): Promise<T>;
    /**
     * Runs a callback with the configured local database connection.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Connection callback.
     * @returns {Promise<T>} - Callback result.
     */
    _withDb<T>(callback: (db: import("../database/drivers/base.js").default) => Promise<T>): Promise<T>;
    /**
     * Reports an unexpected local-store failure through framework channels.
     * @param {{error: Error, stage: string}} args - Error report.
     * @returns {void} - No return value.
     */
    _reportFrameworkError({ error, stage }: {
        error: Error;
        stage: string;
    }): void;
}
//# sourceMappingURL=local-store.d.ts.map