export type ApplicationProcessContext = {
    /**
     * - Generic process type supplied to `configuration.initialize()`.
     */
    type: string;
    /**
     * - Opaque identity unique to this lifecycle.
     */
    instanceId: string;
};
export type CorsType = (args: {
    request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default;
    response: import("./http-server/client/response.js").default;
}) => Promise<void>;
export type WebsocketChannelResolverType = (args: {
    request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined;
    subscription?: {
        channel: string;
        params?: Record<string, ReturnType<typeof JSON.parse>>;
    };
    client: import("./http-server/client/index.js").default;
    websocketSession: import("./http-server/client/websocket-session.js").default;
    configuration: import("./configuration.js").default;
}) => typeof import("./http-server/websocket-channel.js").default | import("./http-server/websocket-channel.js").default | void | Promise<typeof import("./http-server/websocket-channel.js").default | import("./http-server/websocket-channel.js").default | void>;
export type WebsocketMessageHandler = {
    /**
     * - Handler for incoming websocket messages.
     */
    onMessage?: (args: {
        message: ReturnType<typeof JSON.parse>;
        session: import("./http-server/client/websocket-session.js").default;
    }) => Promise<void> | void;
    /**
     * - Handler when the websocket session opens.
     */
    onOpen?: (args: {
        session: import("./http-server/client/websocket-session.js").default;
    }) => Promise<void> | void;
    /**
     * - Handler when the websocket session closes.
     */
    onClose?: (args: {
        session: import("./http-server/client/websocket-session.js").default;
    }) => Promise<void> | void;
    /**
     * - Handler when a websocket message errors.
     */
    onError?: (args: {
        error: Error;
        session: import("./http-server/client/websocket-session.js").default;
    }) => Promise<void> | void;
};
export type WebsocketMessageHandlerResolverType = (args: {
    request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined;
    client: import("./http-server/client/index.js").default;
    configuration: import("./configuration.js").default;
}) => WebsocketMessageHandler | void | Promise<WebsocketMessageHandler | void>;
export type InitializersRequireContextType = (id: string) => {
    default: typeof import("./initializer.js").default;
};
export type WebpackRequireContext = InitializersRequireContextType & {
    keys: () => string[];
    id: string;
};
export type InitializersExportType = {
    requireContext: WebpackRequireContext;
};
export type InitializersType = (args: {
    configuration: import("./configuration.js").default;
}) => Promise<InitializersExportType>;
export type SqlConfig = {
    /**
     * - Database name for the SQL driver.
     */
    database?: string;
    /**
     * - Driver-specific connection options.
     */
    options?: {
        encrypt?: boolean;
        schema?: string;
        serverName?: string;
        trustServerCertificate?: boolean;
    };
    /**
     * - Password for the SQL user.
     */
    password?: string;
    /**
     * - Connection pool configuration.
     */
    pool?: {
        max?: number | null;
        min?: number;
        idleTimeoutMillis?: number;
        checkoutTimeoutMillis?: number | null;
    };
    /**
     * - SQL server hostname.
     */
    server?: string;
    /**
     * - SQL username.
     */
    user?: string;
};
export type DatabasePoolConfiguration = {
    /**
     * - Timeout while a checkout waits for an available async-tracked connection after the max live connection cap is reached. Set null to wait indefinitely. Default: 10000.
     */
    checkoutTimeoutMillis?: number | null;
    /**
     * - Idle timeout before closing a checked-in async-tracked connection. Set null to disable idle reaping. Default: 5000.
     */
    idleTimeoutMillis?: number | null;
    /**
     * - Maximum live async-tracked connections for this pool. Defaults to 10. Extra checkouts wait until a matching connection is checked in or capacity is freed. Set null to disable the cap.
     */
    max?: number | null;
};
export type DatabaseConfigurationType = {
    /**
     * - Default character set applied by `db:create` via mysql/mariadb `CREATE DATABASE ... CHARACTER SET`. Distinct from `charset`, which is the client connection charset forwarded to the mysql2 driver.
     */
    databaseCharset?: string;
    /**
     * - Default collation applied by `db:create` via mysql/mariadb `CREATE DATABASE ... COLLATE`.
     */
    databaseCollation?: string;
    /**
     * - Database name for this connection.
     */
    database?: string;
    /**
     * - Maximum attempts for the outermost transaction when it keeps hitting deadlocks. Defaults to 8.
     */
    deadlockMaxRetries?: number;
    /**
     * - Base delay (ms) for the deadlock retry backoff; the per-attempt ceiling doubles from here. Defaults to 50.
     */
    deadlockBaseWaitMs?: number;
    /**
     * - Cap (ms) on the deadlock retry backoff ceiling so the jittered wait stays bounded. Defaults to 1000.
     */
    deadlockMaxWaitMs?: number;
    /**
     * - Driver class to use for this database.
     */
    driver?: typeof import("./database/drivers/base.js").default;
    /**
     * - Pool class to use for this database.
     */
    poolType?: typeof import("./database/pool/base.js").default;
    /**
     * - Custom connection factory override.
     */
    getConnection?: () => ReturnType<typeof JSON.parse>;
    /**
     * - Database host.
     */
    host?: string;
    /**
     * - Whether migrations are enabled for this database.
     */
    migrations?: boolean;
    /**
     * - (MySQL) Opt in to multi-statement queries so structure SQL loads and all-table cleanup can batch into one round-trip. Off by default; ordinary queries otherwise reject stacked statements.
     */
    multipleStatements?: boolean;
    /**
     * - Maximum rows per `INSERT ... VALUES (...), (...), ...` statement generated by `Record.insertMultiple`. Defaults to 500.
     */
    maxRowsPerInsert?: number;
    /**
     * - Maximum serialized SQL size, in bytes, for a single `INSERT ... VALUES (...), (...), ...` statement. Defaults to 1 MiB (1048576).
     */
    maxInsertSqlBytes?: number;
    /**
     * - Maximum values in a single `IN (...)` cohort used by preloads, association counts, and queryData aggregates. Defaults to 999.
     */
    maxInClauseValues?: number;
    /**
     * - Maximum serialized SQL size, in bytes, for a single cohort query used by preloads, association counts, and queryData aggregates. Defaults to 1 MiB (1048576).
     */
    maxQuerySqlBytes?: number;
    /**
     * - Password for the database user.
     */
    password?: string;
    /**
     * - Database port.
     */
    port?: number;
    /**
     * - Default type for implicit migration primary keys and references. Defaults to `uuid`.
     */
    primaryKeyType?: string;
    /**
     * - Velocious database pool lifecycle configuration.
     */
    pool?: DatabasePoolConfiguration;
    /**
     * - Friendly name for the configuration.
     */
    name?: string;
    /**
     * - Optional sqlite-web sql.js wasm resolver (`initSqlJs({locateFile})`).
     */
    locateFile?: (file: string) => string;
    /**
     * - Whether writes should be blocked for this database.
     */
    readOnly?: boolean;
    /**
     * - Default schema for unqualified table lookups (MSSQL).
     */
    schema?: string;
    /**
     * - Whether schema metadata should be cached on the driver. Defaults to true.
     */
    schemaCache?: boolean;
    /**
     * - Record-level configuration.
     */
    record?: {
        transactions?: boolean;
    };
    /**
     * - Whether to reset the database on startup.
     */
    reset?: boolean;
    /**
     * - Driver-specific SQL config.
     */
    sqlConfig?: SqlConfig;
    /**
     * - Whether this database identifier is only active inside a resolved tenant context.
     */
    tenantOnly?: boolean;
    /**
     * - Database type identifier.
     */
    type?: "mssql" | "mysql" | "pgsql" | "sqlite";
    /**
     * - Database to switch to after connecting.
     */
    useDatabase?: string;
    /**
     * - Username for database authentication.
     */
    username?: string;
};
export type LogLevel = "debug-low-level" | "debug" | "info" | "warn" | "error";
export type LoggingOutputPayload = {
    /**
     * - Log level.
     */
    level: LogLevel;
    /**
     * - Formatted message.
     */
    message: string;
    /**
     * - Log subject.
     */
    subject: string;
    /**
     * - Timestamp.
     */
    timestamp: Date;
};
export type LoggingOutput = {
    /**
     * - Write a log entry.
     */
    write: (arg: LoggingOutputPayload) => Promise<void> | void;
    /**
     * - Default levels for this output.
     */
    levels?: LogLevel[];
};
export type LoggingOutputConfig = {
    /**
     * - Output instance.
     */
    output: LoggingOutput;
    /**
     * - Levels enabled for this output.
     */
    levels?: Array<LogLevel>;
};
export type LoggerConfig = LoggingOutputConfig | LoggingOutput | import("./logger/base-logger.js").default;
export type LoggingConfiguration = {
    /**
     * - Enable/disable console logging for request logging. Defaults to true outside of "test" and for HTTP server logs.
     */
    console?: boolean;
    /**
     * - Enable/disable writing logs to a file. Defaults to true.
     */
    file?: boolean;
    /**
     * - Directory where log files are stored. Defaults to "<project>/log".
     */
    directory?: string;
    /**
     * - Explicit path for the log file. Defaults to "<directory>/<environment>.log".
     */
    filePath?: string;
    /**
     * - Override which log levels are emitted.
     */
    levels?: Array<"debug-low-level" | "debug" | "info" | "warn" | "error">;
    /**
     * - Convenience flag to include very low-level debug logs.
     */
    debugLowLevel?: boolean;
    /**
     * - Enable/disable database query logging. Defaults to true outside test and false in test.
     */
    queryLogging?: boolean;
    /**
     * - Additional case-insensitive sensitive header/parameter names to redact from logging.
     */
    sensitiveNames?: string[];
    /**
     * - Logger instances (converted to outputs when configured).
     */
    loggers?: LoggerConfig[];
    /**
     * - Explicit logger outputs (overrides console/file defaults when provided).
     */
    outputs?: LoggingOutputConfig[];
};
export type StructureSqlConfiguration = {
    /**
     * - Environments allowed to write structure sql files during automatic migration dumps.
     */
    enabledEnvironments?: string[];
    /**
     * - Environments that should skip writing structure sql files.
     */
    disabledEnvironments?: string[];
};
export type BackgroundJobsDispatchStrategy = "beacon" | "polling";
export type BackgroundJobsMode = "background" | "inline";
export type BackgroundJobsGenerationInitialState = "candidate" | "active" | "retired";
export type BackgroundJobsAdapterFactory = (args: {
    configuration: import("./configuration.js").default;
}) => import("./background-jobs/adapter.js").default;
export type BackgroundJobClass = typeof import("./background-jobs/platform-job.js").default;
export type BackgroundJobsConfiguration = {
    /**
     * - Adapter instance or synchronous factory. A factory creates one adapter per configuration lifecycle; the framework closes adapters it resolves.
     */
    adapter?: import("./background-jobs/adapter.js").default | BackgroundJobsAdapterFactory;
    /**
     * - Static portable job classes available to Browser/Expo local dispatch. Defaults to `[]`; Node keeps its filesystem registry.
     */
    jobClasses?: BackgroundJobClass[];
    /**
     * - `"background"` uses the configured adapter/transport and durable queue semantics; `"inline"` performs immediately without durable queue state. Defaults to `"background"`.
     */
    mode?: BackgroundJobsMode;
    /**
     * - Opt-in release generation identity. Must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and agree with environment/API/CLI sources.
     */
    generationId?: string;
    /**
     * - Generation-aware boot state. Defaults to `"candidate"`; invalid without `generationId`.
     */
    initialGenerationState?: BackgroundJobsGenerationInitialState;
    /**
     * - Absolute release-local Unix socket used by acknowledged activation and retirement commands.
     */
    lifecycleSocketPath?: string;
    /**
     * - Hostname for the background jobs main process.
     */
    host?: string;
    /**
     * - Port for the background jobs main process.
     */
    port?: number;
    /**
     * - Database identifier used to store background jobs. Browser/Expo local dispatch uses this existing SQLite database and defaults to `"default"`.
     */
    databaseIdentifier?: string;
    /**
     * - How many `forked: false` jobs a single
     * `background-jobs-worker` process is allowed to run in parallel. Concurrency
     * is at the JS event-loop level: every concurrent job shares the worker's
     * process and DB connection pool, so this should fit the pool size, not the
     * CPU count. Forking remains the right tool for memory isolation across
     * long-running jobs and for using more cores. Default: `4`.
     */
    maxConcurrentInlineJobs?: number;
    /**
     * - How many out-of-process
     * `"forked"` or `"spawned"` jobs a single `background-jobs-worker` is
     * allowed to keep in flight. Default: `4`. This is a per-worker safety cap;
     * for workload-shaped limits use per-queue caps (`queues`) instead, which are
     * enforced cluster-wide and are immune to duplicate worker processes.
     */
    maxConcurrentForkedJobs?: number;
    /**
     * - Number of warm, reusable child runners owned by each worker. Pooled capacity is separate from inline and forked/spawned capacity. Default: `4`.
     */
    pooledRunnerCount?: number;
    /**
     * - Number of jobs each pooled child runs concurrently on its own event loop. Total per-worker pooled capacity is `pooledRunnerCount × pooledRunnerConcurrency`. `1` (default) keeps each child serial; raise it for I/O-bound jobs so a bounded set of isolated processes handles high concurrency (like the inline lane) without one process per concurrent job. Default: `1`.
     */
    pooledRunnerConcurrency?: number;
    /**
     * - Number of sequential jobs a pooled child runs before it is replaced, bounding process-level resource accumulation. Default: `100`.
     */
    pooledRunnerMaxJobs?: number;
    /**
     * - RSS bytes after an acknowledged job at which a pooled child is replaced. Default: `536870912` (512 MiB).
     */
    pooledRunnerMaxRssBytes?: number;
    /**
     * - Age after an acknowledged job at which a pooled child is replaced. Default: `3600000` (one hour).
     */
    pooledRunnerMaxLifetimeMs?: number;
    /**
     * - Per-queue
     * concurrency caps and dispatch priorities, Sidekiq-style. A job declares its queue (static
     * `queue` on the job class, or the `queue` enqueue option; defaults to `"default"`), and
     * `queues[name].maxConcurrent` bounds how many jobs from that queue may be
     * in flight across the whole cluster (enforced via durable per-key
     * concurrency, so it holds regardless of how many worker processes run).
     * Size each queue to its workload: I/O-bound queues (e.g. build runners
     * waiting on remote Docker servers) can run far above the core count, while
     * CPU-bound queues should stay near it. `queues[name].priority` (default `0`)
     * makes the main process dispatch higher-priority queues before lower-priority
     * ones regardless of enqueue order, so a small time-critical queue can never be
     * starved by a flood of low-priority work sharing a worker pool. Unlike
     * Sidekiq's strict queue ordering, priority composes with the per-queue caps:
     * a higher-priority queue that is already at its `maxConcurrent` is skipped and
     * dispatch falls through to the next eligible lower-priority job, so a busy
     * high-priority queue does not block everything else. This fallthrough is a
     * property of the queue-derived cap; a job that supplies its own explicit
     * `concurrencyKey`/`maxConcurrency` bypasses the queue cap entirely (an
     * explicit key always wins — see above) and is bounded only by that key, so it
     * is not held back by the queue's cap and priority simply orders it normally.
     * Priorities may be any number, including negative to sink a queue below the
     * default. Jobs within the same priority keep FIFO (`scheduled_at`, then
     * `created_at`) order. Default: `{}` (no queue caps, all queues priority `0`).
     */
    queues?: Record<string, {
        maxConcurrent?: number;
        priority?: number;
    }>;
    /**
     * - How the main process
     * detects new work. Defaults to `"beacon"` (event-driven). Set to `"polling"`
     * to restore the legacy fixed-interval poll.
     */
    dispatchStrategy?: BackgroundJobsDispatchStrategy;
    /**
     * - Poll interval in milliseconds. Only used
     * when `dispatchStrategy === "polling"`. Default: `1000`.
     */
    pollIntervalMs?: number;
    /**
     * - Wall-clock backstop, in ms, for a
     * `"forked"` job runner. A forked job still running after this is terminated
     * (SIGTERM, then SIGKILL after the reaping grace) and reported failed, so a
     * single genuinely-hung runner can't pin a draining worker — and its full-app
     * boot and DB connections — indefinitely (e.g. across a deploy where a retired
     * worker drains in-flight jobs). This is a coarse safety net, not per-job
     * tuning: set it well above the longest legitimate forked job (build runners,
     * long imports) so only genuinely-stuck runners are killed. Omit, `null`, or
     * `<= 0` to disable (default), which preserves the prior unbounded behavior.
     */
    jobTimeoutMs?: number | null;
    /**
     * - Retention/pruning
     * of terminal job rows. Without pruning the jobs table grows unbounded
     * (completed rows accumulate forever), which bloats storage and indexes and
     * eventually slows dispatch. The main process sweeps terminal rows past their
     * window on an interval.
     */
    retention?: BackgroundJobsRetentionConfiguration;
};
export type BackgroundJobsRetentionConfiguration = {
    /**
     * - Delete `completed` jobs whose
     * `completed_at_ms` is older than this many ms. `null` or `<= 0` disables
     * completed pruning. Default: `604800000` (7 days).
     */
    completedTtlMs?: number | null;
    /**
     * - Delete terminal `failed`/`orphaned`
     * jobs older than this many ms. `null` or `<= 0` disables (keeps them for
     * debugging). Default: `2592000000` (30 days).
     */
    failedTtlMs?: number | null;
    /**
     * - Rows deleted per batch. Default: `1000`.
     */
    batchSize?: number;
    /**
     * - How often the retention sweep runs.
     * Default: `3600000` (1 hour).
     */
    sweepIntervalMs?: number;
};
export type ResolvedBackgroundJobsRetentionConfiguration = {
    /**
     * - Resolved completed-job TTL in ms (`null` disables).
     */
    completedTtlMs: number | null;
    /**
     * - Resolved failed/orphaned TTL in ms (`null` disables).
     */
    failedTtlMs: number | null;
    /**
     * - Resolved delete batch size.
     */
    batchSize: number;
    /**
     * - Resolved sweep interval in ms.
     */
    sweepIntervalMs: number;
};
export type BeaconConfiguration = {
    /**
     * - Whether to connect to a Beacon broker. Defaults to false unless `host`/`port` or `inProcess: true` are set, or env vars are present. Explicit `false` disables Beacon even when env vars are set.
     */
    enabled?: boolean;
    /**
     * - When true, use a module-level in-process broker singleton instead of connecting over TCP. Mutually exclusive with `host`/`port`. Useful for tests and single-process deployments.
     */
    inProcess?: boolean;
    /**
     * - Hostname of the Beacon broker daemon.
     */
    host?: string;
    /**
     * - Port of the Beacon broker daemon.
     */
    port?: number;
    /**
     * - Optional human-readable label for this peer (e.g. "server", "background-jobs-worker").
     */
    peerType?: string;
    /**
     * - Grace window (ms) a beacon connect/disconnect blip must persist before it is reported as a framework-error. Transient outages that recover within this window (e.g. a deploy restarting the broker) are not reported. Defaults to 30000.
     */
    unreachableReportMs?: number;
};
export type HttpCompressionConfiguration = {
    /**
     * - Whether buffered response compression is enabled. Defaults to true; set false to disable globally.
     */
    enabled?: boolean;
    /**
     * - Minimum buffered body size in bytes before compression is applied. Defaults to 1024.
     */
    threshold?: number;
    /**
     * - Brotli encoder quality (0-11). Defaults to 4.
     */
    brotliQuality?: number;
    /**
     * - Gzip compression level (0-9). Defaults to 6.
     */
    gzipLevel?: number;
};
export type NormalizedHttpCompressionConfiguration = {
    /**
     * - Whether buffered HTTP response compression is enabled.
     */
    enabled: boolean;
    /**
     * - Minimum buffered body size in bytes before compression is applied.
     */
    threshold: number;
    /**
     * - Brotli encoder quality (0-11).
     */
    brotliQuality: number;
    /**
     * - Gzip compression level (0-9).
     */
    gzipLevel: number;
};
export type HttpServerConfiguration = {
    /**
     * - Buffered response compression. Enabled with documented defaults when absent; false or {enabled: false} disables it globally.
     */
    compression?: boolean | HttpCompressionConfiguration;
    /**
     * - Hostname to bind the HTTP server to.
     */
    host?: string;
    /**
     * - Run HTTP handlers in the main thread instead of worker threads.
     */
    inProcess?: boolean;
    /**
     * - Backward-compatible alias for workers.
     */
    maxWorkers?: number;
    /**
     * - Port to bind the HTTP server to.
     */
    port?: number;
    /**
     * - Per-session retained inbound WebSocket message limits.
     */
    websocketInboundQueue?: {
        maxPendingBytes?: number;
        maxPendingMessages?: number;
    };
    /**
     * - Per-client retained outbound WebSocket frame limits.
     */
    websocketOutboundQueue?: {
        maxPendingBytes?: number;
        maxPendingFrames?: number;
    };
    /**
     * - Worker handlers to start for the HTTP server.
     */
    workers?: number;
};
export type ScheduledBackgroundJobEveryOptions = {
    /**
     * - Delay before the first enqueue.
     */
    firstIn?: number | string;
};
export type ScheduledBackgroundJobConfiguration = {
    /**
     * - Arguments passed to the job when enqueued.
     */
    args?: Array<ReturnType<typeof JSON.parse>>;
    /**
     * - Job class to enqueue.
     */
    class: typeof import("./background-jobs/job.js").default;
    /**
     * - Crontab expression (5-field POSIX, plus `@hourly`/`@daily`/`@weekly`/`@monthly`/`@yearly`/`@midnight`). Mutually exclusive with `every`.
     */
    cron?: string;
    /**
     * - Whether the schedule is enabled.
     */
    enabled?: boolean;
    /**
     * - Repeat interval. Either `every` or `cron` must be set.
     */
    every?: number | string | [number | string, ScheduledBackgroundJobEveryOptions];
    /**
     * - Job options.
     */
    options?: import("./background-jobs/types.js").BackgroundJobOptions;
};
export type VelociousParams = Record<string, string>;
export type ClientErrorPayloadReporterPayload = Record<string, import("./frontend-models/query.js").FrontendModelTransportValue>;
export type ErrorRequestDetails = {
    /**
     * - Sanitized parsed request body, when available.
     */
    body?: ReturnType<typeof JSON.parse>;
    /**
     * - Request HTTP method.
     */
    httpMethod: string;
    /**
     * - Request path.
     */
    path: string;
};
export type ClientErrorPayloadContext = {
    /**
     * - Controller class name.
     */
    controller: string;
    /**
     * - Controller action or endpoint label.
     */
    action?: string;
    /**
     * - Frontend-model command type.
     */
    commandType?: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url" | "custom-command";
    /**
     * - Server-generated identifier shared by an unexpected client error and framework reports.
     */
    correlationId?: string;
    /**
     * - Whether the error is an expected user-flow failure.
     */
    expectedError?: boolean;
    /**
     * - Whether the error came from the frontend-model endpoint.
     */
    frontendModelEndpoint?: boolean;
    /**
     * - Frontend-model name from the failed request.
     */
    model?: string;
    /**
     * - Shared frontend-model request id.
     */
    requestId?: string;
};
export type ClientErrorPayloadReporterType = (args: {
    context: ClientErrorPayloadContext;
    error: Error;
    request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined;
    requestDetails: ErrorRequestDetails | null;
}) => Promise<ClientErrorPayloadReporterPayload | void> | ClientErrorPayloadReporterPayload | void;
export type VelociousLooseObject = Record<string, unknown> & {
    configuration?: import("./configuration.js").default;
    currentDevice?: unknown;
    currentUser?: unknown;
    modelRegistry?: Record<string, unknown> | {
        model: (name: string) => unknown;
    };
    now?: Date | (() => Date);
    offlineGrant?: unknown;
    params?: VelociousParams;
    request?: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default;
    resourceRuntime?: "backend" | "frontend" | "offline";
};
export type AttachmentDriverConstructor = new (args: {
    attachmentName?: string;
    configuration: import("./configuration.js").default;
    modelClass?: typeof import("./database/record/index.js").default;
    name?: string;
    options?: Record<string, ReturnType<typeof JSON.parse>>;
}) => object;
export type ScheduledBackgroundJobsConfiguration = {
    /**
     * - Scheduled jobs keyed by name.
     */
    jobs: Record<string, ScheduledBackgroundJobConfiguration>;
};
export type ScheduledBackgroundJobsLoaderType = (args: {
    configuration: import("./configuration.js").default;
}) => ScheduledBackgroundJobsConfiguration | Promise<ScheduledBackgroundJobsConfiguration>;
export type AttachmentDriverConfiguration = {
    /**
     * - Optional factory for a custom attachment driver instance.
     */
    create?: (args: {
        configuration: import("./configuration.js").default;
        name: string;
        options: Record<string, ReturnType<typeof JSON.parse>>;
    }) => Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Optional custom attachment driver class.
     */
    driverClass?: AttachmentDriverConstructor;
    /**
     * - Optional custom attachment driver instance.
     */
    instance?: Record<string, ReturnType<typeof JSON.parse>>;
};
export type AttachmentSyncConfiguration = {
    /**
     * - Whether clients prefetch the attachment or wait until it is requested.
     */
    fetch: "eager" | "on-demand";
    /**
     * - Whether an offline-ready scope requires the attachment bytes.
     */
    offlineRequirement: "optional" | "required";
    /**
     * - Whether clients may evict the attachment under storage pressure.
     */
    retention: "durable" | "evictable";
};
export type RecordAttachmentConfiguration = {
    /**
     * - Attachment driver name, class, or instance.
     */
    driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Client-safe synchronized asset policy.
     */
    sync?: AttachmentSyncConfiguration;
    /**
     * - Attachment cardinality.
     */
    type: "hasOne" | "hasMany";
};
export type AttachmentsConfiguration = {
    /**
     * - Default attachment storage driver name.
     */
    defaultDriver?: string;
    /**
     * - Named attachment driver configurations.
     */
    drivers?: Record<string, AttachmentDriverConfiguration & Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * - Whether `{path: ...}` attachment input is allowed.
     */
    allowPathInput?: boolean;
    /**
     * - Optional allowlist of directories for `{path: ...}` input.
     */
    allowedPathPrefixes?: string[];
};
export type MailerBackend = {
    /**
     * - Deliver a mailer payload.
     */
    deliver: (args: {
        payload: import("./mailer.js").MailerDeliveryPayload;
        configuration: import("./configuration.js").default;
    }) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>;
    /**
     * - Explicit provider-backed duplicate-suppression capability. Generic SMTP omits this and remains at-least-once.
     */
    deliveryIdempotencyCapability?: () => import("./mailer.js").MailerDeliveryIdempotencyCapability;
    /**
     * - Resolves provider defaults into the immutable payload before required-operation hashing and enqueue.
     */
    prepareDeliveryOperationPayload?: (args: {
        payload: import("./mailer.js").MailerDeliveryPayload;
    }) => import("./mailer.js").MailerDeliveryPayload;
    /**
     * - Provider-specific operation and payload validation performed before enqueue and every network attempt.
     */
    validateDeliveryOperation?: (args: {
        deliveryOperation: import("./mailer.js").MailerDeliveryOperationRequest | import("./mailer.js").MailerDeliveryOperation;
        payload: import("./mailer.js").MailerDeliveryPayload;
    }) => void;
};
export type LocaleFallbacksType = Record<string, string[]>;
export type FrontendModelRelationshipConfiguration = {
    /**
     * - Relationship type.
     */
    type: "belongsTo" | "hasOne" | "hasMany";
    /**
     * - Target model class name.
     */
    model?: string;
    /**
     * - Alias of target model class name.
     */
    className?: string;
    /**
     * - Explicit target model class name.
     */
    modelClassName?: string;
};
export type FrontendModelAttributeConfiguration = {
    /**
     * - Column type name.
     */
    type?: string;
    /**
     * - Alias for column type name.
     */
    columnType?: string;
    /**
     * - Alias for column type name.
     */
    sqlType?: string;
    /**
     * - Alias for column type name.
     */
    dataType?: string;
    /**
     * - Exact generated JSDoc type for non-column attributes.
     */
    jsDocType?: string;
    /**
     * - Attribute name when configured as an array entry.
     */
    name?: string;
    /**
     * - Whether value can be null.
     */
    null?: boolean;
    /**
     * - Whether included in default serialization. Defaults to true.
     */
    selectedByDefault?: boolean;
};
export type FrontendModelAttachmentConfiguration = {
    /**
     * - Client-side synchronized asset policy.
     */
    sync?: AttachmentSyncConfiguration;
    /**
     * - Attachment cardinality.
     */
    type: "hasOne" | "hasMany";
};
export type FrontendModelResourceConfiguration = {
    /**
     * - Attributes to expose on the frontend model.
     */
    attributes: Array<string | FrontendModelAttributeConfiguration> | Record<string, FrontendModelAttributeConfiguration | import("./database/drivers/base-column.js").default | boolean>;
    /**
     * - Additional camelCase ability action names to expose for per-record `record.can(action)` reads. Base CRUD actions (`read`, `create`, `update`, `destroy`) are always included and must not be listed here.
     */
    abilities?: string[];
    /**
     * - Attachment helpers keyed by attachment name.
     */
    attachments?: Record<string, FrontendModelAttachmentConfiguration>;
    /**
     * - Legacy built-in command names (`index`, `find`, `create`, `update`, `destroy`, `attach`, `download`, `url`).
     */
    commands?: string[];
    /**
     * - Custom collection commands. Each entry is a camelCase method name, or a `{name, args?, returnType?}` object declaring typed arguments and/or a response type. The runtime derives the kebab-case command slug from the name.
     */
    collectionCommands?: Array<FrontendModelResourceCustomCommand>;
    /**
     * - Custom member commands. Each entry is a camelCase method name, or a `{name, args?, returnType?}` object declaring typed arguments and/or a response type. The runtime derives the kebab-case command slug from the name.
     */
    memberCommands?: Array<FrontendModelResourceCustomCommand>;
    /**
     * - Built-in collection command names (`index`, `create`).
     */
    builtInCollectionCommands?: string[];
    /**
     * - Built-in member command names (`find`, `update`, `destroy`, `attach`, `download`, `url`).
     */
    builtInMemberCommands?: string[];
    /**
     * - Frontend model name override.
     */
    modelName?: string;
    /**
     * - Relationship names to expose in frontend models. Type and target model are inferred from the backend model's registered relationships.
     */
    relationships?: string[];
    /**
     * - Primary key attribute name.
     */
    primaryKey?: string;
    /**
     * - Optional legacy backend behavior overrides for built-in frontend actions.
     */
    server?: FrontendModelResourceServerConfiguration;
    /**
     * - Optional safe local/offline sync policy metadata. `policy` participates in the hash but is not exposed to generated frontend config/manifest.
     */
    sync?: FrontendModelResourceSyncConfiguration | boolean;
};
export type FrontendModelResourceCustomCommandObject = {
    /**
     * - camelCase command method name.
     */
    name: string;
    /**
     * - Typed command arguments; each generates a named, typed method parameter mapped positionally into the command payload. `type` is a JSDoc type string.
     */
    args?: Array<{
        name: string;
        type: string;
    }>;
    /**
     * - JSDoc type for the command response. When set, the generated method is typed `Promise<returnType>` instead of `Promise<Record<string, ReturnType<typeof JSON.parse>>>`. Emitted verbatim into the generated frontend model, so it must resolve there.
     */
    returnType?: string;
};
export type FrontendModelResourceCustomCommand = string | FrontendModelResourceCustomCommandObject;
export type FrontendModelSyncJsonValue = null | string | number | boolean | unknown[] | Record<string, unknown>;
export type FrontendModelResourceSyncConfiguration = {
    /**
     * - Strategy used when replay detects server/client divergence. Defaults to `optimisticVersion`.
     */
    conflictStrategy?: "optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly";
    /**
     * - Whether the resource is sync-enabled. Defaults to true when `sync` is configured.
     */
    enabled?: boolean;
    /**
     * - Sync operation names such as `index`, `find`, `create`, `update`, custom domain commands, etc.
     */
    operations?: string[];
    /**
     * - App-controlled policy version used as a stable change signal.
     */
    policyVersion?: string | number;
    /**
     * - Safe frontend-visible metadata.
     */
    metadata?: Record<string, FrontendModelSyncJsonValue>;
    /**
     * - Deterministic non-secret policy inputs included in the policy hash only.
     */
    policy?: Record<string, FrontendModelSyncJsonValue>;
};
export type VelociousSyncApiConfiguration = {
    /**
     * - Mount path for the sync endpoints. Defaults to "/velocious/sync".
     */
    mountPath?: string;
    /**
     * - App sync resource class served by the auto-mounted sync endpoints.
     */
    resourceClass: FrontendModelResourceClassType;
};
export type VelociousSyncClientTransport = {
    /**
     * - Posts one request and resolves a response with a json accessor.
     */
    post: (path: string, body?: ReturnType<typeof JSON.parse>, options?: {
        headers?: Record<string, string>;
    }) => Promise<{
        json: () => ReturnType<typeof JSON.parse>;
    }>;
};
export type VelociousSyncRealtimeWebsocketClient = {
    /**
     * - Connects the websocket.
     */
    connect: () => Promise<ReturnType<typeof JSON.parse>>;
    /**
     * - Opens one channel subscription.
     */
    subscribeChannel: (channelType: string, options?: {
        params?: Record<string, ReturnType<typeof JSON.parse>>;
        onMessage?: (body: ReturnType<typeof JSON.parse>) => void;
        onResume?: () => void;
        onClose?: (reason: string) => void;
    }) => VelociousSyncRealtimeSubscription;
    /**
     * - Closes the socket and stops auto-reconnect.
     */
    disconnectAndStopReconnect: () => Promise<void>;
};
export type VelociousSyncRealtimeSubscription = {
    /**
     * - Closes the subscription.
     */
    close: () => void;
    /**
     * - Whether the subscription is acknowledged and ready.
     */
    isReady: () => boolean;
    /**
     * - Resolves once the server acknowledges the subscription.
     */
    waitForReady: (params?: {
        timeoutMs?: number;
    }) => Promise<void>;
};
export type VelociousSyncRealtimeChannelDescriptor = {
    /**
     * - Server channel name to subscribe.
     */
    channel: string;
    /**
     * - Subscribe params (runtime scope values). The framework injects `authenticationToken` automatically.
     */
    params?: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Default resource/model name for pushed changes that do not carry their own resourceType.
     */
    resourceType?: string;
};
export type VelociousSyncClientRealtimeConfiguration = {
    /**
     * - Builds the (unconnected) websocket client; the framework owns connect/disconnect.
     */
    createClient: () => VelociousSyncRealtimeWebsocketClient | Promise<VelociousSyncRealtimeWebsocketClient>;
    /**
     * - Deprecated legacy escape hatch: resolves extra app-channel descriptors from the `subscribeRealtime(context)` context. Declared pull scopes subscribe the framework sync channel automatically.
     */
    channels?: (context: ReturnType<typeof JSON.parse>) => Array<VelociousSyncRealtimeChannelDescriptor> | Promise<Array<VelociousSyncRealtimeChannelDescriptor>>;
    /**
     * - Resolves this device's echo origin; pushed messages with a matching `echoOrigin` are dropped.
     */
    localOrigin?: () => string | Promise<string>;
    /**
     * - Fire a coalesced `pull()` when subscriptions become ready or resume after a drop, closing offline gaps. Defaults to true.
     */
    pullOnReconnect?: boolean;
};
export type VelociousSyncClientConfiguration = {
    /**
     * - Resolves the auth token sent with sync requests.
     */
    authenticationToken: () => string | Promise<string>;
    /**
     * - Max syncs per request.
     */
    batchSize?: number;
    /**
     * - Connectivity gate for pulls and replays. Defaults to always online.
     */
    isOnline?: () => boolean | Promise<boolean>;
    /**
     * - Mount path the server serves the sync endpoints under (match the server's `sync.api.mountPath`). Defaults to "/velocious/sync"; normalization strips trailing slashes and always fills in the default.
     */
    mountPath?: string;
    /**
     * - Reports background replay/pull failures. Defaults to rethrowing.
     */
    onError?: (error: Error) => void;
    /**
     * - Realtime push configuration consumed by `subscribeRealtime(...)`.
     */
    realtime?: VelociousSyncClientRealtimeConfiguration;
    /**
     * - Transport posting to the framework sync endpoints (e.g. the frontend-model websocket client).
     */
    transport: VelociousSyncClientTransport;
    /**
     * - Shared app-lifetime websocket client (the low-level form) that all sync traffic rides. Provide the same instance the frontend-model transport uses so one connection carries everything. When set, the realtime bridge subscribes channels on it and never owns its lifecycle: unsubscribing closes only channel subscriptions, leaving the socket connected.
     */
    websocketClient?: VelociousSyncRealtimeWebsocketClient;
    /**
     * - Shared app-lifetime websocket URL. When set (and no `websocketClient` is given), the framework builds and owns one reconnecting `VelociousWebsocketClient` for all sync traffic, connected on first use.
     */
    websocketUrl?: string | (() => string | null | undefined);
};
export type VelociousSyncConfiguration = {
    /**
     * - Auto-mounts the Velocious sync changes/replay endpoints for this resource class.
     */
    api?: VelociousSyncApiConfiguration;
    /**
     * - Client-side sync configuration consumed by `SyncClient.fromConfiguration(...)`.
     */
    client?: VelociousSyncClientConfiguration;
    /**
     * - Public backend key used to verify offline device certificates for sync replay.
     */
    deviceCertificateBackendPublicKey?: import("./sync/device-identity.js").SyncJsonWebKey | null;
    /**
     * - Number of accepted server changes retained before clients must refresh from snapshot.
     */
    changeFeedRetentionSize?: number;
    /**
     * - Signing keys used to issue and verify offline grants. Secrets must never be exposed to clients.
     */
    offlineGrantSigningKeys: Array<import("./sync/offline-grant.js").OfflineGrantSigningKey>;
    /**
     * - Default offline grant TTL in milliseconds. Defaults to 24 hours.
     */
    offlineGrantTtlMs?: number;
};
export type NormalizedFrontendModelResourceSyncConfiguration = {
    /**
     * - Normalized replay conflict strategy.
     */
    conflictStrategy: "optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly";
    /**
     * - Whether the resource is sync-enabled.
     */
    enabled: boolean;
    /**
     * - Sorted, duplicate-free sync operation names.
     */
    operations: string[];
    /**
     * - App-controlled policy version, or null.
     */
    policyVersion: string | null;
    /**
     * - Deterministic sha256 hash of safe policy inputs.
     */
    policyHash: string;
    /**
     * - Safe frontend-visible metadata.
     */
    metadata?: Record<string, FrontendModelSyncJsonValue>;
};
export type NormalizedFrontendModelResourceConfiguration = Omit<FrontendModelResourceConfiguration, "abilities" | "builtInCollectionCommands" | "builtInMemberCommands" | "collectionCommands" | "commands" | "memberCommands" | "sync"> & {
    abilities: FrontendModelResourceAbilitiesConfiguration;
    builtInCollectionCommands: Record<string, string>;
    builtInMemberCommands: Record<string, string>;
    collectionCommands: Record<string, string>;
    commandMetadata: Record<string, {
        args: Array<{
            name: string;
            type: string;
        }>;
        returnType: string | null;
    }>;
    memberCommands: Record<string, string>;
    sync?: NormalizedFrontendModelResourceSyncConfiguration;
};
export type UnboundFrontendModelResourceClassType = Omit<typeof import("./frontend-model-resource/base-resource.js").default, "modelClass"> & {
    modelClass: () => typeof import("./database/record/index.js").default;
    new (args: never): import("./frontend-model-resource/base-resource.js").default<typeof import("./database/record/index.js").default>;
};
export type BoundFrontendModelResourceClassType<TModelClass extends import("./frontend-model-resource/base-resource.js").FrontendModelResourceModelClass, TDatabaseModelClass extends typeof import("./database/record/index.js").default> = Omit<typeof import("./frontend-model-resource/base-resource.js").default, "ModelClass" | "modelClass"> & {
    ModelClass: TModelClass | undefined;
    modelClass: () => TModelClass;
    new (args: import("./frontend-model-resource/base-resource.js").FrontendModelResourceAbilityArgs<TModelClass> | import("./frontend-model-resource/base-resource.js").FrontendModelResourceControllerArgs<TDatabaseModelClass>): import("./frontend-model-resource/base-resource.js").default<TModelClass, TDatabaseModelClass>;
};
export type FrontendModelResourceClassType<TModelClass extends import("./frontend-model-resource/base-resource.js").FrontendModelResourceModelClass = never, TDatabaseModelClass extends typeof import("./database/record/index.js").default = Extract<TModelClass, typeof import("./database/record/index.js").default>> = [TModelClass] extends [never] ? UnboundFrontendModelResourceClassType : BoundFrontendModelResourceClassType<TModelClass, TDatabaseModelClass>;
export type FrontendModelResourceDefinition<TModelClass extends import("./frontend-model-resource/base-resource.js").FrontendModelResourceModelClass = never> = FrontendModelResourceClassType<TModelClass>;
export type FrontendModelResourceAbilitiesConfiguration = {
    /**
     * - Ability action for frontend index.
     */
    index?: string;
    /**
     * - Ability action for frontend find.
     */
    find?: string;
    /**
     * - Ability action for frontend create.
     */
    create?: string;
    /**
     * - Ability action for frontend update.
     */
    update?: string;
    /**
     * - Ability action for frontend destroy.
     */
    destroy?: string;
};
export type FrontendModelResourceServerConfiguration = {
    /**
     * - Optional callback run before built-in frontend actions.
     */
    beforeAction?: (args: {
        action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url";
        controller: import("./controller.js").default;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        modelClass: typeof import("./database/record/index.js").default;
    }) => (boolean | void | Promise<boolean | void>);
    /**
     * - Records loader for frontendIndex.
     */
    records?: (args: {
        action: "index";
        controller: import("./controller.js").default;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        modelClass: typeof import("./database/record/index.js").default;
    }) => Promise<import("./database/record/index.js").default[]>;
    /**
     * - Record serializer for response payloads.
     */
    serialize?: (args: {
        action: "index" | "find" | "create" | "update";
        controller: import("./controller.js").default;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        modelClass: typeof import("./database/record/index.js").default;
        model: import("./database/record/index.js").default;
    }) => Record<string, ReturnType<typeof JSON.parse>> | Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * - Record loader for find/update/destroy/attach/download/url actions.
     */
    find?: (args: {
        action: "find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url";
        controller: import("./controller.js").default;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        modelClass: typeof import("./database/record/index.js").default;
        id: string | number;
    }) => Promise<import("./database/record/index.js").default | null>;
    /**
     * - Custom create callback.
     */
    create?: (args: {
        action: "create";
        controller: import("./controller.js").default;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        modelClass: typeof import("./database/record/index.js").default;
        attributes: Record<string, ReturnType<typeof JSON.parse>>;
    }) => Promise<import("./database/record/index.js").default>;
    /**
     * - Custom update callback.
     */
    update?: (args: {
        action: "update";
        controller: import("./controller.js").default;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        modelClass: typeof import("./database/record/index.js").default;
        model: import("./database/record/index.js").default;
        attributes: Record<string, ReturnType<typeof JSON.parse>>;
    }) => Promise<import("./database/record/index.js").default | void>;
    /**
     * - Custom destroy callback.
     */
    destroy?: (args: {
        action: "destroy";
        controller: import("./controller.js").default;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        modelClass: typeof import("./database/record/index.js").default;
        model: import("./database/record/index.js").default;
    }) => Promise<void>;
};
export type BackendProjectConfiguration = {
    /**
     * - Path to the backend project. May be an app root or a contributing package root (package entries are appended internally from `packages`).
     */
    path: string;
    /**
     * - Optional output project path where `src/frontend-models` should be generated.
     */
    frontendModelsOutputPath?: string;
    /**
     * - Optional override for the resources directory to auto-discover; defaults to `<path>/src/resources`. Set internally for package entries.
     */
    resourcesPath?: string;
    /**
     * - Auto-discovered frontend model definitions keyed by model class name. Set internally by the environment handler — do not set manually.
     */
    frontendModels?: Record<string, FrontendModelResourceDefinition>;
    /**
     * - Auto-discovered ability resource classes (frontend-model and authorization) from this project's resources directory. Set internally by the environment handler — do not set manually.
     */
    abilityResources?: AbilityResourceClassType[];
};
export type VelociousPackageDescriptor = {
    /**
     * - The package name.
     */
    name: string;
    /**
     * - The descriptor module's `import.meta.url`; the package root is derived from it when `path` is omitted.
     */
    url?: string;
    /**
     * - The package root directory (the one containing `src`). Derived from `url` when omitted.
     */
    path?: string;
    /**
     * - Override for the package's models directory (default `<path>/src/models`).
     */
    modelsPath?: string;
    /**
     * - Override for the package's frontend-model resources directory (default `<path>/src/resources`).
     */
    resourcesPath?: string;
    /**
     * - Override for the package's migrations directory (default `<path>/src/database/migrations`).
     */
    migrationsPath?: string;
};
export type VelociousPackageConfiguration = import("./packages/velocious-package.js").default | VelociousPackageDescriptor;
export type RouteResolverHookArgs = {
    /**
     * - Configuration instance.
     */
    configuration: import("./configuration.js").default;
    /**
     * - Mutable request params object.
     */
    params: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Request path without query.
     */
    currentPath: string;
    /**
     * - True when matching a configured custom route.
     */
    hasMatchingCustomRoute?: boolean;
    /**
     * - Request object.
     */
    request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default;
    /**
     * - Response object.
     */
    response: import("./http-server/client/response.js").default;
    /**
     * - Resolver instance.
     */
    resolver: import("./routes/resolver.js").default;
};
export type RouteResolverHookResult = {
    /**
     * - Dasherized action name (for example `frontend-index`).
     */
    action: string;
    /**
     * - Controller path (for example `accounts`).
     */
    controller: string;
    /**
     * - Optional controller class override.
     */
    controllerClass?: typeof import("./controller.js").default;
    /**
     * - Optional absolute/relative controller file path override.
     */
    controllerPath?: string;
    /**
     * - Extra params to merge for controller/action.
     */
    params?: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Whether to run the controller action without resolving request ability.
     */
    skipAbilityResolution?: boolean;
    /**
     * - Whether to run the controller action without the automatic database checkout wrapper.
     */
    skipControllerConnections?: boolean;
    /**
     * - Whether to run the controller action without resolving request tenant.
     */
    skipTenantResolution?: boolean;
    /**
     * - Optional view path override used by controller render lookups.
     */
    viewPath?: string;
};
export type RouteResolverHookType = (arg: RouteResolverHookArgs) => RouteResolverHookResult | null | Promise<RouteResolverHookResult | null>;
export type AbilityResourceClassType = typeof import("./authorization/base-resource.js").default;
export type AbilityResolverType = (args: {
    configuration: import("./configuration.js").default;
    params: Record<string, ReturnType<typeof JSON.parse>>;
    request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined;
    response: import("./http-server/client/response.js").default | undefined;
}) => import("./authorization/ability.js").default | void | Promise<import("./authorization/ability.js").default | void>;
export type TenantResolverType = (args: {
    configuration: import("./configuration.js").default;
    params: Record<string, ReturnType<typeof JSON.parse>>;
    request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined;
    response: import("./http-server/client/response.js").default | undefined;
    subscription?: {
        channel: string;
        params?: Record<string, ReturnType<typeof JSON.parse>>;
    };
}) => ReturnType<typeof JSON.parse> | void | Promise<ReturnType<typeof JSON.parse> | void>;
export type TenantDatabaseResolverType = (args: {
    configuration: import("./configuration.js").default;
    databaseConfiguration: DatabaseConfigurationType;
    identifier: string;
    tenant: ReturnType<typeof JSON.parse>;
}) => DatabaseConfigurationType | Partial<DatabaseConfigurationType> | void;
export type ApiManifestConfiguration = {
    /**
     * - HTTP path for the built-in API manifest endpoint. Defaults to `/api/manifest`.
     */
    path?: string;
    /**
     * - Bearer token required in the `Authorization: Bearer <token>` header. When set, requests without a matching token are not routed (404), so the endpoint stays hidden.
     */
    token?: string;
};
export type DebugEndpointConfiguration = {
    /**
     * - HTTP path for the built-in debug endpoint. Defaults to `/velocious/debug`.
     */
    path?: string;
    /**
     * - Bearer token required in the `Authorization: Bearer <token>` header. When set, requests without a matching token are not routed (404), so the endpoint stays hidden.
     */
    token?: string;
};
export type TenantDatabaseProviderType = {
    /**
     * - Lists tenants that should be created, checked, or migrated for this database identifier.
     */
    listTenants: (args: {
        configuration: import("./configuration.js").default;
        identifier: string;
    }) => Array<ReturnType<typeof JSON.parse>> | Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * - Resolves one explicit tenant descriptor for schema/base-model generation without enumerating lifecycle tenants.
     */
    resolveGenerationTenant?: (args: {
        configuration: import("./configuration.js").default;
        identifier: string;
    }) => ReturnType<typeof JSON.parse> | void | Promise<ReturnType<typeof JSON.parse> | void>;
    /**
     * - Lists existing tenants that should be checked for dependent restrict destroys. Defaults to listTenants.
     */
    listRestrictTenants?: (args: {
        configuration: import("./configuration.js").default;
        identifier: string;
    }) => Array<ReturnType<typeof JSON.parse>> | Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * - Creates the tenant database/schema for one tenant.
     */
    createDatabase?: (args: {
        configuration: import("./configuration.js").default;
        databaseConfiguration: DatabaseConfigurationType;
        identifier: string;
        tenant: ReturnType<typeof JSON.parse>;
    }) => void | Promise<void>;
    /**
     * - Drops the tenant database/schema for one tenant.
     */
    dropDatabase?: (args: {
        configuration: import("./configuration.js").default;
        databaseConfiguration: DatabaseConfigurationType;
        identifier: string;
        tenant: ReturnType<typeof JSON.parse>;
    }) => void | Promise<void>;
    /**
     * - Checks one tenant database before generic connection validation.
     */
    checkTenant?: (args: {
        configuration: import("./configuration.js").default;
        databaseConfiguration: DatabaseConfigurationType;
        identifier: string;
        tenant: ReturnType<typeof JSON.parse>;
    }) => void | Promise<void>;
    /**
     * - Runs app-owned tenant work after generic migrations for one tenant. `migrationsApplied` is how many migrations actually ran (0 when the tenant was already up to date), so the app can skip expensive per-tenant work on no-op deploys.
     */
    afterMigrateTenant?: (args: {
        configuration: import("./configuration.js").default;
        databaseConfiguration: DatabaseConfigurationType;
        identifier: string;
        migrationsApplied: number;
        tenant: ReturnType<typeof JSON.parse>;
    }) => void | Promise<void>;
};
export type ConfigurationArgsType = {
    /**
     * - Globally enable auto-batch-preload of relationships on lazy access. Default true.
     */
    autoload?: boolean;
    /**
     * - CORS configuration for the HTTP server.
     */
    cors?: CorsType;
    /**
     * - Secret for encrypting cookies.
     */
    cookieSecret?: string;
    /**
     * - Resource classes used to define abilities per model.
     */
    abilityResources?: AbilityResourceClassType[];
    /**
     * - Resolver for creating request-scoped ability instances.
     */
    abilityResolver?: AbilityResolverType;
    /**
     * - Attachment storage configuration.
     */
    attachments?: AttachmentsConfiguration;
    /**
     * - Backend project definitions used for frontend model generation.
     */
    backendProjects?: BackendProjectConfiguration[];
    /**
     * - External Velocious packages that contribute models, frontend-model resources and migrations.
     */
    packages?: VelociousPackageConfiguration[];
    /**
     * - Database configurations keyed by environment and identifier.
     */
    database: {
        [key: string]: {
            [key: string]: DatabaseConfigurationType;
        };
    };
    /**
     * - Enable debug logging.
     */
    debug?: boolean;
    /**
     * - Enable the built-in debug endpoint. Defaults to false.
     */
    debugEndpoint?: boolean | DebugEndpointConfiguration;
    /**
     * - Enable the built-in API manifest endpoint. Defaults to false.
     */
    apiManifest?: boolean | ApiManifestConfiguration;
    /**
     * - Base directory for the project.
     */
    directory?: string;
    /**
     * - Require tenant-switched model queries to resolve a tenant database identifier. Defaults to true.
     */
    enforceTenantDatabaseScopes?: boolean;
    /**
     * - Current environment name.
     */
    environment?: string;
    /**
     * - Environment handler instance.
     */
    environmentHandler: import("./environment-handlers/base.js").default;
    /**
     * - Return unexpected internal error messages and stack traces in frontend-model client payloads in every environment. Defaults to true.
     */
    exposeInternalErrorsToClients?: boolean;
    /**
     * - Bounded frontend tenant SQLite lifecycle configuration.
     */
    frontendTenantSqlite?: {
        maxOpenHandles?: number;
    };
    /**
     * - Deprecated compatibility alias for `exposeInternalErrorsToClients: false` when the authoritative option is omitted.
     */
    secureFrontendModelErrors?: boolean;
    /**
     * - Default HTTP server configuration for applications started from this configuration.
     */
    httpServer?: HttpServerConfiguration;
    /**
     * - Logging configuration.
     */
    logging?: LoggingConfiguration;
    /**
     * - Background jobs configuration.
     */
    backgroundJobs?: BackgroundJobsConfiguration;
    /**
     * - Beacon broadcast bus configuration.
     */
    beacon?: BeaconConfiguration;
    /**
     * - Scheduled background jobs configuration.
     */
    scheduledBackgroundJobs?: ScheduledBackgroundJobsConfiguration | ScheduledBackgroundJobsLoaderType;
    /**
     * - Mail delivery backend.
     */
    mailerBackend?: MailerBackend;
    /**
     * - Hook to register models for a given initialization type.
     */
    initializeModels: (args: {
        configuration: import("./configuration.js").default;
        type: string;
    }) => void;
    /**
     * - Initializer loader for environment bootstrapping.
     */
    initializers?: InitializersType;
    /**
     * - Default locale or locale resolver.
     */
    locale: string | (() => string);
    /**
     * - Supported locales.
     */
    locales: string[];
    /**
     * - Locale fallback map.
     */
    localeFallbacks: LocaleFallbacksType;
    /**
     * - Structure SQL generation configuration.
     */
    structureSql?: StructureSqlConfiguration;
    /**
     * - Local/offline sync framework configuration.
     */
    sync?: VelociousSyncConfiguration;
    /**
     * - Resolver for creating request-scoped tenant context objects.
     */
    tenantResolver?: TenantResolverType;
    /**
     * - Resolver for deriving tenant-specific database config overrides.
     */
    tenantDatabaseResolver?: TenantDatabaseResolverType;
    /**
     * - Tenant database lifecycle providers keyed by database identifier.
     */
    tenantDatabaseProviders?: Record<string, TenantDatabaseProviderType>;
    /**
     * - Path to the testing configuration file.
     */
    testing?: string;
    /**
     * - Default timezone for timezone-less datetime strings.
     */
    timeZone?: string | (() => string | undefined);
    /**
     * - Default timezone offset in minutes.
     */
    timezoneOffsetMinutes?: number | (() => number);
    /**
     * - Trusted reverse proxy address ranges used to resolve request remote addresses from forwarding headers.
     */
    trustedProxies?: string | string[];
    /**
     * - Timeout in seconds for completing a HTTP request.
     */
    requestTimeoutMs?: number | (() => number);
    /**
     * - Hook callbacks that can hijack unresolved routes.
     */
    routeResolverHooks?: RouteResolverHookType[];
    /**
     * - Resolve a websocket channel class/instance for each connection.
     */
    websocketChannelResolver?: WebsocketChannelResolverType;
    /**
     * - Resolve a raw websocket message handler for each connection.
     */
    websocketMessageHandlerResolver?: WebsocketMessageHandlerResolverType;
};
/**
 * @module types
 */
/**
 * Immutable identity shared by application initializers for one process lifecycle.
 * @typedef {object} ApplicationProcessContext
 * @property {string} type - Generic process type supplied to `configuration.initialize()`.
 * @property {string} instanceId - Opaque identity unique to this lifecycle.
 */
/**
 * @typedef {(args: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default}) => Promise<void>} CorsType
 */
/**
 * @typedef {(args: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, subscription?: {channel: string, params?: Record<string, ReturnType<typeof JSON.parse>>}, client: import("./http-server/client/index.js").default, websocketSession: import("./http-server/client/websocket-session.js").default, configuration: import("./configuration.js").default}) => typeof import("./http-server/websocket-channel.js").default | import("./http-server/websocket-channel.js").default | void | Promise<typeof import("./http-server/websocket-channel.js").default | import("./http-server/websocket-channel.js").default | void>} WebsocketChannelResolverType
 */
/**
 * @typedef {object} WebsocketMessageHandler
 * @property {(args: {message: ReturnType<typeof JSON.parse>, session: import("./http-server/client/websocket-session.js").default}) => Promise<void> | void} [onMessage] - Handler for incoming websocket messages.
 * @property {(args: {session: import("./http-server/client/websocket-session.js").default}) => Promise<void> | void} [onOpen] - Handler when the websocket session opens.
 * @property {(args: {session: import("./http-server/client/websocket-session.js").default}) => Promise<void> | void} [onClose] - Handler when the websocket session closes.
 * @property {(args: {error: Error, session: import("./http-server/client/websocket-session.js").default}) => Promise<void> | void} [onError] - Handler when a websocket message errors.
 */
/**
 * @typedef {(args: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, client: import("./http-server/client/index.js").default, configuration: import("./configuration.js").default}) => WebsocketMessageHandler | void | Promise<WebsocketMessageHandler | void>} WebsocketMessageHandlerResolverType
 */
/**
 * @typedef {(id: string) => {default: typeof import("./initializer.js").default}} InitializersRequireContextType
 * @typedef {InitializersRequireContextType & {
 *   keys: () => string[],
 *   id: string
 * }} WebpackRequireContext
 * @typedef {{requireContext: WebpackRequireContext}} InitializersExportType
 * @typedef {(args: {configuration: import("./configuration.js").default}) => Promise<InitializersExportType>} InitializersType
 */
/**
 * @typedef {object} SqlConfig
 * @property {string} [database] - Database name for the SQL driver.
 * @property {object} [options] - Driver-specific connection options.
 * @property {boolean} [options.encrypt] - Whether to encrypt the connection (MSSQL).
 * @property {string} [options.schema] - Default schema for unqualified table lookups (MSSQL).
 * @property {string} [options.serverName] - TLS SNI server name override for MSSQL (empty string disables SNI).
 * @property {boolean} [options.trustServerCertificate] - Whether to trust the server certificate (MSSQL).
 * @property {string} [password] - Password for the SQL user.
 * @property {object} [pool] - Connection pool configuration.
 * @property {number | null} [pool.max] - Maximum number of connections. Set null to disable the cap.
 * @property {number} [pool.min] - Minimum number of connections.
 * @property {number} [pool.idleTimeoutMillis] - Idle timeout before releasing a connection.
 * @property {number | null} [pool.checkoutTimeoutMillis] - Timeout while waiting for an available connection after the max connection cap is reached. Set null to wait indefinitely.
 * @property {string} [server] - SQL server hostname.
 * @property {string} [user] - SQL username.
 */
/**
 * @typedef {object} DatabasePoolConfiguration
 * @property {number | null} [checkoutTimeoutMillis] - Timeout while a checkout waits for an available async-tracked connection after the max live connection cap is reached. Set null to wait indefinitely. Default: 10000.
 * @property {number | null} [idleTimeoutMillis] - Idle timeout before closing a checked-in async-tracked connection. Set null to disable idle reaping. Default: 5000.
 * @property {number | null} [max] - Maximum live async-tracked connections for this pool. Defaults to 10. Extra checkouts wait until a matching connection is checked in or capacity is freed. Set null to disable the cap.
 */
/**
 * @typedef {object} DatabaseConfigurationType
 * @property {string} [databaseCharset] - Default character set applied by `db:create` via mysql/mariadb `CREATE DATABASE ... CHARACTER SET`. Distinct from `charset`, which is the client connection charset forwarded to the mysql2 driver.
 * @property {string} [databaseCollation] - Default collation applied by `db:create` via mysql/mariadb `CREATE DATABASE ... COLLATE`.
 * @property {string} [database] - Database name for this connection.
 * @property {number} [deadlockMaxRetries] - Maximum attempts for the outermost transaction when it keeps hitting deadlocks. Defaults to 8.
 * @property {number} [deadlockBaseWaitMs] - Base delay (ms) for the deadlock retry backoff; the per-attempt ceiling doubles from here. Defaults to 50.
 * @property {number} [deadlockMaxWaitMs] - Cap (ms) on the deadlock retry backoff ceiling so the jittered wait stays bounded. Defaults to 1000.
 * @property {typeof import("./database/drivers/base.js").default} [driver] - Driver class to use for this database.
 * @property {typeof import("./database/pool/base.js").default} [poolType] - Pool class to use for this database.
 * @property {() => ReturnType<typeof JSON.parse>} [getConnection] - Custom connection factory override.
 * @property {string} [host] - Database host.
 * @property {boolean} [migrations] - Whether migrations are enabled for this database.
 * @property {boolean} [multipleStatements] - (MySQL) Opt in to multi-statement queries so structure SQL loads and all-table cleanup can batch into one round-trip. Off by default; ordinary queries otherwise reject stacked statements.
 * @property {number} [maxRowsPerInsert] - Maximum rows per `INSERT ... VALUES (...), (...), ...` statement generated by `Record.insertMultiple`. Defaults to 500.
 * @property {number} [maxInsertSqlBytes] - Maximum serialized SQL size, in bytes, for a single `INSERT ... VALUES (...), (...), ...` statement. Defaults to 1 MiB (1048576).
 * @property {number} [maxInClauseValues] - Maximum values in a single `IN (...)` cohort used by preloads, association counts, and queryData aggregates. Defaults to 999.
 * @property {number} [maxQuerySqlBytes] - Maximum serialized SQL size, in bytes, for a single cohort query used by preloads, association counts, and queryData aggregates. Defaults to 1 MiB (1048576).
 * @property {string} [password] - Password for the database user.
 * @property {number} [port] - Database port.
 * @property {string} [primaryKeyType] - Default type for implicit migration primary keys and references. Defaults to `uuid`.
 * @property {DatabasePoolConfiguration} [pool] - Velocious database pool lifecycle configuration.
 * @property {string} [name] - Friendly name for the configuration.
 * @property {(file: string) => string} [locateFile] - Optional sqlite-web sql.js wasm resolver (`initSqlJs({locateFile})`).
 * @property {boolean} [readOnly] - Whether writes should be blocked for this database.
 * @property {string} [schema] - Default schema for unqualified table lookups (MSSQL).
 * @property {boolean} [schemaCache] - Whether schema metadata should be cached on the driver. Defaults to true.
 * @property {object} [record] - Record-level configuration.
 * @property {boolean} [record.transactions] - Whether record operations should use transactions.
 * @property {boolean} [reset] - Whether to reset the database on startup.
 * @property {SqlConfig} [sqlConfig] - Driver-specific SQL config.
 * @property {boolean} [tenantOnly] - Whether this database identifier is only active inside a resolved tenant context.
 * @property {"mssql" | "mysql" | "pgsql" | "sqlite"} [type] - Database type identifier.
 * @property {string} [useDatabase] - Database to switch to after connecting.
 * @property {string} [username] - Username for database authentication.
 */
/**
 * @typedef {"debug-low-level" | "debug" | "info" | "warn" | "error"} LogLevel
 */
/**
 * @typedef {object} LoggingOutputPayload
 * @property {LogLevel} level - Log level.
 * @property {string} message - Formatted message.
 * @property {string} subject - Log subject.
 * @property {Date} timestamp - Timestamp.
 */
/**
 * @typedef {object} LoggingOutput
 * @property {(arg: LoggingOutputPayload) => Promise<void> | void} write - Write a log entry.
 * @property {LogLevel[]} [levels] - Default levels for this output.
 */
/**
 * @typedef {object} LoggingOutputConfig
 * @property {LoggingOutput} output - Output instance.
 * @property {Array<LogLevel>} [levels] - Levels enabled for this output.
 */
/**
 * @typedef {LoggingOutputConfig | LoggingOutput | import("./logger/base-logger.js").default} LoggerConfig
 */
/**
 * @typedef {object} LoggingConfiguration
 * @property {boolean} [console] - Enable/disable console logging for request logging. Defaults to true outside of "test" and for HTTP server logs.
 * @property {boolean} [file] - Enable/disable writing logs to a file. Defaults to true.
 * @property {string} [directory] - Directory where log files are stored. Defaults to "<project>/log".
 * @property {string} [filePath] - Explicit path for the log file. Defaults to "<directory>/<environment>.log".
 * @property {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [levels] - Override which log levels are emitted.
 * @property {boolean} [debugLowLevel] - Convenience flag to include very low-level debug logs.
 * @property {boolean} [queryLogging] - Enable/disable database query logging. Defaults to true outside test and false in test.
 * @property {string[]} [sensitiveNames] - Additional case-insensitive sensitive header/parameter names to redact from logging.
 * @property {LoggerConfig[]} [loggers] - Logger instances (converted to outputs when configured).
 * @property {LoggingOutputConfig[]} [outputs] - Explicit logger outputs (overrides console/file defaults when provided).
 */
/**
 * @typedef {object} StructureSqlConfiguration
 * @property {string[]} [enabledEnvironments] - Environments allowed to write structure sql files during automatic migration dumps.
 * @property {string[]} [disabledEnvironments] - Environments that should skip writing structure sql files.
 */
/**
 * @typedef {"beacon" | "polling"} BackgroundJobsDispatchStrategy
 *
 * - `"beacon"` (default): event-driven dispatch. The
 *   `background-jobs-main` process drains the queue on enqueue, on
 *   worker readiness, on Beacon broadcasts (so cross-process enqueues
 *   wake it), and arms a `setTimeout` for the soonest future-scheduled
 *   job. Falls back gracefully to direct in-process triggering when
 *   Beacon is not configured.
 * - `"polling"`: legacy mode, runs a fixed-interval poll over the
 *   `background_jobs` table (see `pollIntervalMs`).
 */
/** @typedef {"background" | "inline"} BackgroundJobsMode */
/** @typedef {"candidate" | "active" | "retired"} BackgroundJobsGenerationInitialState */
/** @typedef {(args: {configuration: import("./configuration.js").default}) => import("./background-jobs/adapter.js").default} BackgroundJobsAdapterFactory */
/** @typedef {typeof import("./background-jobs/platform-job.js").default} BackgroundJobClass */
/**
 * @typedef {object} BackgroundJobsConfiguration
 * @property {import("./background-jobs/adapter.js").default | BackgroundJobsAdapterFactory} [adapter] - Adapter instance or synchronous factory. A factory creates one adapter per configuration lifecycle; the framework closes adapters it resolves.
 * @property {BackgroundJobClass[]} [jobClasses] - Static portable job classes available to Browser/Expo local dispatch. Defaults to `[]`; Node keeps its filesystem registry.
 * @property {BackgroundJobsMode} [mode] - `"background"` uses the configured adapter/transport and durable queue semantics; `"inline"` performs immediately without durable queue state. Defaults to `"background"`.
 * @property {string} [generationId] - Opt-in release generation identity. Must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and agree with environment/API/CLI sources.
 * @property {BackgroundJobsGenerationInitialState} [initialGenerationState] - Generation-aware boot state. Defaults to `"candidate"`; invalid without `generationId`.
 * @property {string} [lifecycleSocketPath] - Absolute release-local Unix socket used by acknowledged activation and retirement commands.
 * @property {string} [host] - Hostname for the background jobs main process.
 * @property {number} [port] - Port for the background jobs main process.
 * @property {string} [databaseIdentifier] - Database identifier used to store background jobs. Browser/Expo local dispatch uses this existing SQLite database and defaults to `"default"`.
 * @property {number} [maxConcurrentInlineJobs] - How many `forked: false` jobs a single
 *   `background-jobs-worker` process is allowed to run in parallel. Concurrency
 *   is at the JS event-loop level: every concurrent job shares the worker's
 *   process and DB connection pool, so this should fit the pool size, not the
 *   CPU count. Forking remains the right tool for memory isolation across
 *   long-running jobs and for using more cores. Default: `4`.
 * @property {number} [maxConcurrentForkedJobs] - How many out-of-process
 *   `"forked"` or `"spawned"` jobs a single `background-jobs-worker` is
 *   allowed to keep in flight. Default: `4`. This is a per-worker safety cap;
 *   for workload-shaped limits use per-queue caps (`queues`) instead, which are
 *   enforced cluster-wide and are immune to duplicate worker processes.
 * @property {number} [pooledRunnerCount] - Number of warm, reusable child runners owned by each worker. Pooled capacity is separate from inline and forked/spawned capacity. Default: `4`.
 * @property {number} [pooledRunnerConcurrency] - Number of jobs each pooled child runs concurrently on its own event loop. Total per-worker pooled capacity is `pooledRunnerCount × pooledRunnerConcurrency`. `1` (default) keeps each child serial; raise it for I/O-bound jobs so a bounded set of isolated processes handles high concurrency (like the inline lane) without one process per concurrent job. Default: `1`.
 * @property {number} [pooledRunnerMaxJobs] - Number of sequential jobs a pooled child runs before it is replaced, bounding process-level resource accumulation. Default: `100`.
 * @property {number} [pooledRunnerMaxRssBytes] - RSS bytes after an acknowledged job at which a pooled child is replaced. Default: `536870912` (512 MiB).
 * @property {number} [pooledRunnerMaxLifetimeMs] - Age after an acknowledged job at which a pooled child is replaced. Default: `3600000` (one hour).
 * @property {Record<string, {maxConcurrent?: number, priority?: number}>} [queues] - Per-queue
 *   concurrency caps and dispatch priorities, Sidekiq-style. A job declares its queue (static
 *   `queue` on the job class, or the `queue` enqueue option; defaults to `"default"`), and
 *   `queues[name].maxConcurrent` bounds how many jobs from that queue may be
 *   in flight across the whole cluster (enforced via durable per-key
 *   concurrency, so it holds regardless of how many worker processes run).
 *   Size each queue to its workload: I/O-bound queues (e.g. build runners
 *   waiting on remote Docker servers) can run far above the core count, while
 *   CPU-bound queues should stay near it. `queues[name].priority` (default `0`)
 *   makes the main process dispatch higher-priority queues before lower-priority
 *   ones regardless of enqueue order, so a small time-critical queue can never be
 *   starved by a flood of low-priority work sharing a worker pool. Unlike
 *   Sidekiq's strict queue ordering, priority composes with the per-queue caps:
 *   a higher-priority queue that is already at its `maxConcurrent` is skipped and
 *   dispatch falls through to the next eligible lower-priority job, so a busy
 *   high-priority queue does not block everything else. This fallthrough is a
 *   property of the queue-derived cap; a job that supplies its own explicit
 *   `concurrencyKey`/`maxConcurrency` bypasses the queue cap entirely (an
 *   explicit key always wins — see above) and is bounded only by that key, so it
 *   is not held back by the queue's cap and priority simply orders it normally.
 *   Priorities may be any number, including negative to sink a queue below the
 *   default. Jobs within the same priority keep FIFO (`scheduled_at`, then
 *   `created_at`) order. Default: `{}` (no queue caps, all queues priority `0`).
 * @property {BackgroundJobsDispatchStrategy} [dispatchStrategy] - How the main process
 *   detects new work. Defaults to `"beacon"` (event-driven). Set to `"polling"`
 *   to restore the legacy fixed-interval poll.
 * @property {number} [pollIntervalMs] - Poll interval in milliseconds. Only used
 *   when `dispatchStrategy === "polling"`. Default: `1000`.
 * @property {number | null} [jobTimeoutMs] - Wall-clock backstop, in ms, for a
 *   `"forked"` job runner. A forked job still running after this is terminated
 *   (SIGTERM, then SIGKILL after the reaping grace) and reported failed, so a
 *   single genuinely-hung runner can't pin a draining worker — and its full-app
 *   boot and DB connections — indefinitely (e.g. across a deploy where a retired
 *   worker drains in-flight jobs). This is a coarse safety net, not per-job
 *   tuning: set it well above the longest legitimate forked job (build runners,
 *   long imports) so only genuinely-stuck runners are killed. Omit, `null`, or
 *   `<= 0` to disable (default), which preserves the prior unbounded behavior.
 * @property {BackgroundJobsRetentionConfiguration} [retention] - Retention/pruning
 *   of terminal job rows. Without pruning the jobs table grows unbounded
 *   (completed rows accumulate forever), which bloats storage and indexes and
 *   eventually slows dispatch. The main process sweeps terminal rows past their
 *   window on an interval.
 */
/**
 * @typedef {object} BackgroundJobsRetentionConfiguration
 * @property {number | null} [completedTtlMs] - Delete `completed` jobs whose
 *   `completed_at_ms` is older than this many ms. `null` or `<= 0` disables
 *   completed pruning. Default: `604800000` (7 days).
 * @property {number | null} [failedTtlMs] - Delete terminal `failed`/`orphaned`
 *   jobs older than this many ms. `null` or `<= 0` disables (keeps them for
 *   debugging). Default: `2592000000` (30 days).
 * @property {number} [batchSize] - Rows deleted per batch. Default: `1000`.
 * @property {number} [sweepIntervalMs] - How often the retention sweep runs.
 *   Default: `3600000` (1 hour).
 */
/**
 * Fully-resolved retention config as returned by `getBackgroundJobsConfig()`
 * (every field defaulted), as opposed to the partial user-provided input.
 * @typedef {object} ResolvedBackgroundJobsRetentionConfiguration
 * @property {number | null} completedTtlMs - Resolved completed-job TTL in ms (`null` disables).
 * @property {number | null} failedTtlMs - Resolved failed/orphaned TTL in ms (`null` disables).
 * @property {number} batchSize - Resolved delete batch size.
 * @property {number} sweepIntervalMs - Resolved sweep interval in ms.
 */
/**
 * @typedef {object} BeaconConfiguration
 * @property {boolean} [enabled] - Whether to connect to a Beacon broker. Defaults to false unless `host`/`port` or `inProcess: true` are set, or env vars are present. Explicit `false` disables Beacon even when env vars are set.
 * @property {boolean} [inProcess] - When true, use a module-level in-process broker singleton instead of connecting over TCP. Mutually exclusive with `host`/`port`. Useful for tests and single-process deployments.
 * @property {string} [host] - Hostname of the Beacon broker daemon.
 * @property {number} [port] - Port of the Beacon broker daemon.
 * @property {string} [peerType] - Optional human-readable label for this peer (e.g. "server", "background-jobs-worker").
 * @property {number} [unreachableReportMs] - Grace window (ms) a beacon connect/disconnect blip must persist before it is reported as a framework-error. Transient outages that recover within this window (e.g. a deploy restarting the broker) are not reported. Defaults to 30000.
 */
/**
 * @typedef {object} HttpCompressionConfiguration
 * @property {boolean} [enabled] - Whether buffered response compression is enabled. Defaults to true; set false to disable globally.
 * @property {number} [threshold] - Minimum buffered body size in bytes before compression is applied. Defaults to 1024.
 * @property {number} [brotliQuality] - Brotli encoder quality (0-11). Defaults to 4.
 * @property {number} [gzipLevel] - Gzip compression level (0-9). Defaults to 6.
 */
/**
 * @typedef {object} NormalizedHttpCompressionConfiguration
 * @property {boolean} enabled - Whether buffered HTTP response compression is enabled.
 * @property {number} threshold - Minimum buffered body size in bytes before compression is applied.
 * @property {number} brotliQuality - Brotli encoder quality (0-11).
 * @property {number} gzipLevel - Gzip compression level (0-9).
 */
/**
 * @typedef {object} HttpServerConfiguration
 * @property {boolean | HttpCompressionConfiguration} [compression] - Buffered response compression. Enabled with documented defaults when absent; false or {enabled: false} disables it globally.
 * @property {string} [host] - Hostname to bind the HTTP server to.
 * @property {boolean} [inProcess] - Run HTTP handlers in the main thread instead of worker threads.
 * @property {number} [maxWorkers] - Backward-compatible alias for workers.
 * @property {number} [port] - Port to bind the HTTP server to.
 * @property {{maxPendingBytes?: number, maxPendingMessages?: number}} [websocketInboundQueue] - Per-session retained inbound WebSocket message limits.
 * @property {{maxPendingBytes?: number, maxPendingFrames?: number}} [websocketOutboundQueue] - Per-client retained outbound WebSocket frame limits.
 * @property {number} [workers] - Worker handlers to start for the HTTP server.
 */
/**
 * @typedef {object} ScheduledBackgroundJobEveryOptions
 * @property {number | string} [firstIn] - Delay before the first enqueue.
 */
/**
 * @typedef {object} ScheduledBackgroundJobConfiguration
 * @property {Array<ReturnType<typeof JSON.parse>>} [args] - Arguments passed to the job when enqueued.
 * @property {typeof import("./background-jobs/job.js").default} class - Job class to enqueue.
 * @property {string} [cron] - Crontab expression (5-field POSIX, plus `@hourly`/`@daily`/`@weekly`/`@monthly`/`@yearly`/`@midnight`). Mutually exclusive with `every`.
 * @property {boolean} [enabled] - Whether the schedule is enabled.
 * @property {number | string | [number | string, ScheduledBackgroundJobEveryOptions]} [every] - Repeat interval. Either `every` or `cron` must be set.
 * @property {import("./background-jobs/types.js").BackgroundJobOptions} [options] - Job options.
 */
/**
 * @typedef {Record<string, string>} VelociousParams
 */
/**
 * @typedef {Record<string, import("./frontend-models/query.js").FrontendModelTransportValue>} ClientErrorPayloadReporterPayload
 */
/**
 * @typedef {object} ErrorRequestDetails
 * @property {ReturnType<typeof JSON.parse>} [body] - Sanitized parsed request body, when available.
 * @property {string} httpMethod - Request HTTP method.
 * @property {string} path - Request path.
 */
/**
 * @typedef {object} ClientErrorPayloadContext
 * @property {string} controller - Controller class name.
 * @property {string} [action] - Controller action or endpoint label.
 * @property {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url" | "custom-command"} [commandType] - Frontend-model command type.
 * @property {string} [correlationId] - Server-generated identifier shared by an unexpected client error and framework reports.
 * @property {boolean} [expectedError] - Whether the error is an expected user-flow failure.
 * @property {boolean} [frontendModelEndpoint] - Whether the error came from the frontend-model endpoint.
 * @property {string} [model] - Frontend-model name from the failed request.
 * @property {string} [requestId] - Shared frontend-model request id.
 */
/**
 * @typedef {(args: {
 *   context: ClientErrorPayloadContext,
 *   error: Error,
 *   request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined,
 *   requestDetails: ErrorRequestDetails | null
 * }) => Promise<ClientErrorPayloadReporterPayload | void> | ClientErrorPayloadReporterPayload | void} ClientErrorPayloadReporterType
 */
/**
 * @typedef {Record<string, unknown> & {configuration?: import("./configuration.js").default, currentDevice?: unknown, currentUser?: unknown, modelRegistry?: Record<string, unknown> | {model: (name: string) => unknown}, now?: Date | (() => Date), offlineGrant?: unknown, params?: VelociousParams, request?: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, resourceRuntime?: "backend" | "frontend" | "offline"}} VelociousLooseObject
 */
/**
 * @typedef {new (args: {attachmentName?: string, configuration: import("./configuration.js").default, modelClass?: typeof import("./database/record/index.js").default, name?: string, options?: Record<string, ReturnType<typeof JSON.parse>>}) => object} AttachmentDriverConstructor
 */
/**
 * @typedef {object} ScheduledBackgroundJobsConfiguration
 * @property {Record<string, ScheduledBackgroundJobConfiguration>} jobs - Scheduled jobs keyed by name.
 */
/**
 * @typedef {(args: {configuration: import("./configuration.js").default}) => ScheduledBackgroundJobsConfiguration | Promise<ScheduledBackgroundJobsConfiguration>} ScheduledBackgroundJobsLoaderType
 */
/**
 * @typedef {object} AttachmentDriverConfiguration
 * @property {(args: {configuration: import("./configuration.js").default, name: string, options: Record<string, ReturnType<typeof JSON.parse>>}) => Record<string, ReturnType<typeof JSON.parse>>} [create] - Optional factory for a custom attachment driver instance.
 * @property {AttachmentDriverConstructor} [driverClass] - Optional custom attachment driver class.
 * @property {Record<string, ReturnType<typeof JSON.parse>>} [instance] - Optional custom attachment driver instance.
 */
/**
 * Client-safe synchronization policy declared with a model attachment.
 * @typedef {object} AttachmentSyncConfiguration
 * @property {"eager" | "on-demand"} fetch - Whether clients prefetch the attachment or wait until it is requested.
 * @property {"optional" | "required"} offlineRequirement - Whether an offline-ready scope requires the attachment bytes.
 * @property {"durable" | "evictable"} retention - Whether clients may evict the attachment under storage pressure.
 */
/**
 * Model attachment declaration retained by the record class.
 * @typedef {object} RecordAttachmentConfiguration
 * @property {string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>} [driver] - Attachment driver name, class, or instance.
 * @property {AttachmentSyncConfiguration} [sync] - Client-safe synchronized asset policy.
 * @property {"hasOne" | "hasMany"} type - Attachment cardinality.
 */
/**
 * @typedef {object} AttachmentsConfiguration
 * @property {string} [defaultDriver] - Default attachment storage driver name.
 * @property {Record<string, AttachmentDriverConfiguration & Record<string, ReturnType<typeof JSON.parse>>>} [drivers] - Named attachment driver configurations.
 * @property {boolean} [allowPathInput] - Whether `{path: ...}` attachment input is allowed.
 * @property {string[]} [allowedPathPrefixes] - Optional allowlist of directories for `{path: ...}` input.
 */
/**
 * @typedef {object} MailerBackend
 * @property {(args: {payload: import("./mailer.js").MailerDeliveryPayload, configuration: import("./configuration.js").default}) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} deliver - Deliver a mailer payload.
 * @property {() => import("./mailer.js").MailerDeliveryIdempotencyCapability} [deliveryIdempotencyCapability] - Explicit provider-backed duplicate-suppression capability. Generic SMTP omits this and remains at-least-once.
 * @property {(args: {payload: import("./mailer.js").MailerDeliveryPayload}) => import("./mailer.js").MailerDeliveryPayload} [prepareDeliveryOperationPayload] - Resolves provider defaults into the immutable payload before required-operation hashing and enqueue.
 * @property {(args: {deliveryOperation: import("./mailer.js").MailerDeliveryOperationRequest | import("./mailer.js").MailerDeliveryOperation, payload: import("./mailer.js").MailerDeliveryPayload}) => void} [validateDeliveryOperation] - Provider-specific operation and payload validation performed before enqueue and every network attempt.
 */
/**
 * @typedef {Record<string, string[]>} LocaleFallbacksType
 */
/**
 * @typedef {object} FrontendModelRelationshipConfiguration
 * @property {"belongsTo" | "hasOne" | "hasMany"} type - Relationship type.
 * @property {string} [model] - Target model class name.
 * @property {string} [className] - Alias of target model class name.
 * @property {string} [modelClassName] - Explicit target model class name.
 */
/**
 * @typedef {object} FrontendModelAttributeConfiguration
 * @property {string} [type] - Column type name.
 * @property {string} [columnType] - Alias for column type name.
 * @property {string} [sqlType] - Alias for column type name.
 * @property {string} [dataType] - Alias for column type name.
 * @property {string} [jsDocType] - Exact generated JSDoc type for non-column attributes.
 * @property {string} [name] - Attribute name when configured as an array entry.
 * @property {boolean} [null] - Whether value can be null.
 * @property {boolean} [selectedByDefault] - Whether included in default serialization. Defaults to true.
 */
/**
 * @typedef {object} FrontendModelAttachmentConfiguration
 * @property {AttachmentSyncConfiguration} [sync] - Client-side synchronized asset policy.
 * @property {"hasOne" | "hasMany"} type - Attachment cardinality.
 */
/**
 * @typedef {object} FrontendModelResourceConfiguration
 * @property {Array<string | FrontendModelAttributeConfiguration> | Record<string, FrontendModelAttributeConfiguration | import("./database/drivers/base-column.js").default | boolean>} attributes - Attributes to expose on the frontend model.
 * @property {string[]} [abilities] - Additional camelCase ability action names to expose for per-record `record.can(action)` reads. Base CRUD actions (`read`, `create`, `update`, `destroy`) are always included and must not be listed here.
 * @property {Record<string, FrontendModelAttachmentConfiguration>} [attachments] - Attachment helpers keyed by attachment name.
 * @property {string[]} [commands] - Legacy built-in command names (`index`, `find`, `create`, `update`, `destroy`, `attach`, `download`, `url`).
 * @property {Array<FrontendModelResourceCustomCommand>} [collectionCommands] - Custom collection commands. Each entry is a camelCase method name, or a `{name, args?, returnType?}` object declaring typed arguments and/or a response type. The runtime derives the kebab-case command slug from the name.
 * @property {Array<FrontendModelResourceCustomCommand>} [memberCommands] - Custom member commands. Each entry is a camelCase method name, or a `{name, args?, returnType?}` object declaring typed arguments and/or a response type. The runtime derives the kebab-case command slug from the name.
 * @property {string[]} [builtInCollectionCommands] - Built-in collection command names (`index`, `create`).
 * @property {string[]} [builtInMemberCommands] - Built-in member command names (`find`, `update`, `destroy`, `attach`, `download`, `url`).
 * @property {string} [modelName] - Frontend model name override.
 * @property {string[]} [relationships] - Relationship names to expose in frontend models. Type and target model are inferred from the backend model's registered relationships.
 * @property {string} [primaryKey] - Primary key attribute name.
 * @property {FrontendModelResourceServerConfiguration} [server] - Optional legacy backend behavior overrides for built-in frontend actions.
 * @property {FrontendModelResourceSyncConfiguration | boolean} [sync] - Optional safe local/offline sync policy metadata. `policy` participates in the hash but is not exposed to generated frontend config/manifest.
 */
/**
 * Object form of a custom command entry, declaring its typed arguments and/or
 * response type alongside the command name.
 * @typedef {object} FrontendModelResourceCustomCommandObject
 * @property {string} name - camelCase command method name.
 * @property {Array<{name: string, type: string}>} [args] - Typed command arguments; each generates a named, typed method parameter mapped positionally into the command payload. `type` is a JSDoc type string.
 * @property {string} [returnType] - JSDoc type for the command response. When set, the generated method is typed `Promise<returnType>` instead of `Promise<Record<string, ReturnType<typeof JSON.parse>>>`. Emitted verbatim into the generated frontend model, so it must resolve there.
 */
/**
 * A custom command entry: a plain camelCase method name, or an object declaring
 * typed args and/or a response type.
 * @typedef {string | FrontendModelResourceCustomCommandObject} FrontendModelResourceCustomCommand
 */
/**
 * JSON value accepted by sync policy metadata/hash inputs.
 * @typedef {null | string | number | boolean | unknown[] | Record<string, unknown>} FrontendModelSyncJsonValue
 */
/**
 * Frontend-model local/offline sync policy config. `metadata` is exposed to
 * frontends and peers; `policy` is hashed but intentionally omitted from
 * frontend-safe manifests.
 * @typedef {object} FrontendModelResourceSyncConfiguration
 * @property {"optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly"} [conflictStrategy] - Strategy used when replay detects server/client divergence. Defaults to `optimisticVersion`.
 * @property {boolean} [enabled] - Whether the resource is sync-enabled. Defaults to true when `sync` is configured.
 * @property {string[]} [operations] - Sync operation names such as `index`, `find`, `create`, `update`, custom domain commands, etc.
 * @property {string | number} [policyVersion] - App-controlled policy version used as a stable change signal.
 * @property {Record<string, FrontendModelSyncJsonValue>} [metadata] - Safe frontend-visible metadata.
 * @property {Record<string, FrontendModelSyncJsonValue>} [policy] - Deterministic non-secret policy inputs included in the policy hash only.
 */
/**
 * Velocious sync API endpoint configuration.
 * @typedef {object} VelociousSyncApiConfiguration
 * @property {string} [mountPath] - Mount path for the sync endpoints. Defaults to "/velocious/sync".
 * @property {FrontendModelResourceClassType} resourceClass - App sync resource class served by the auto-mounted sync endpoints.
 */
/**
 * Client-side sync transport owning HTTP POSTs to the framework sync endpoints,
 * matching the frontend-model websocket client post contract.
 * @typedef {object} VelociousSyncClientTransport
 * @property {(path: string, body?: ReturnType<typeof JSON.parse>, options?: {headers?: Record<string, string>}) => Promise<{json: () => ReturnType<typeof JSON.parse>}>} post - Posts one request and resolves a response with a json accessor.
 */
/**
 * Websocket client contract required from `sync.client.realtime.createClient`,
 * matching `VelociousWebsocketClient` / snapreq's websocket client.
 * @typedef {object} VelociousSyncRealtimeWebsocketClient
 * @property {() => Promise<ReturnType<typeof JSON.parse>>} connect - Connects the websocket.
 * @property {(channelType: string, options?: {params?: Record<string, ReturnType<typeof JSON.parse>>, onMessage?: (body: ReturnType<typeof JSON.parse>) => void, onResume?: () => void, onClose?: (reason: string) => void}) => VelociousSyncRealtimeSubscription} subscribeChannel - Opens one channel subscription.
 * @property {() => Promise<void>} disconnectAndStopReconnect - Closes the socket and stops auto-reconnect.
 */
/**
 * Channel subscription handle returned by `subscribeChannel`.
 * @typedef {object} VelociousSyncRealtimeSubscription
 * @property {() => void} close - Closes the subscription.
 * @property {() => boolean} isReady - Whether the subscription is acknowledged and ready.
 * @property {(params?: {timeoutMs?: number}) => Promise<void>} waitForReady - Resolves once the server acknowledges the subscription.
 */
/**
 * One realtime channel subscription descriptor.
 * @typedef {object} VelociousSyncRealtimeChannelDescriptor
 * @property {string} channel - Server channel name to subscribe.
 * @property {Record<string, ReturnType<typeof JSON.parse>>} [params] - Subscribe params (runtime scope values). The framework injects `authenticationToken` automatically.
 * @property {string} [resourceType] - Default resource/model name for pushed changes that do not carry their own resourceType.
 */
/**
 * Realtime push configuration for the sync client. Only the genuinely
 * app-owned callback lives here: how to build the websocket client.
 * Everything else - deriving the framework sync channel subscriptions from
 * the declared pull scopes, subscribing, applying pushes through the derived
 * resource applier, echo suppression, and pull-on-reconnect - is derived.
 * @typedef {object} VelociousSyncClientRealtimeConfiguration
 * @property {() => VelociousSyncRealtimeWebsocketClient | Promise<VelociousSyncRealtimeWebsocketClient>} createClient - Builds the (unconnected) websocket client; the framework owns connect/disconnect.
 * @property {(context: ReturnType<typeof JSON.parse>) => Array<VelociousSyncRealtimeChannelDescriptor> | Promise<Array<VelociousSyncRealtimeChannelDescriptor>>} [channels] - Deprecated legacy escape hatch: resolves extra app-channel descriptors from the `subscribeRealtime(context)` context. Declared pull scopes subscribe the framework sync channel automatically.
 * @property {() => string | Promise<string>} [localOrigin] - Resolves this device's echo origin; pushed messages with a matching `echoOrigin` are dropped.
 * @property {boolean} [pullOnReconnect] - Fire a coalesced `pull()` when subscriptions become ready or resume after a drop, closing offline gaps. Defaults to true.
 */
/**
 * Client-side sync configuration consumed by `SyncClient.fromConfiguration(...)`.
 * The framework owns the `${mountPath}/changes` and `${mountPath}/replay`
 * POSTers over the given transport.
 * @typedef {object} VelociousSyncClientConfiguration
 * @property {() => string | Promise<string>} authenticationToken - Resolves the auth token sent with sync requests.
 * @property {number} [batchSize] - Max syncs per request.
 * @property {() => boolean | Promise<boolean>} [isOnline] - Connectivity gate for pulls and replays. Defaults to always online.
 * @property {string} [mountPath] - Mount path the server serves the sync endpoints under (match the server's `sync.api.mountPath`). Defaults to "/velocious/sync"; normalization strips trailing slashes and always fills in the default.
 * @property {(error: Error) => void} [onError] - Reports background replay/pull failures. Defaults to rethrowing.
 * @property {VelociousSyncClientRealtimeConfiguration} [realtime] - Realtime push configuration consumed by `subscribeRealtime(...)`.
 * @property {VelociousSyncClientTransport} transport - Transport posting to the framework sync endpoints (e.g. the frontend-model websocket client).
 * @property {VelociousSyncRealtimeWebsocketClient} [websocketClient] - Shared app-lifetime websocket client (the low-level form) that all sync traffic rides. Provide the same instance the frontend-model transport uses so one connection carries everything. When set, the realtime bridge subscribes channels on it and never owns its lifecycle: unsubscribing closes only channel subscriptions, leaving the socket connected.
 * @property {string | (() => string | null | undefined)} [websocketUrl] - Shared app-lifetime websocket URL. When set (and no `websocketClient` is given), the framework builds and owns one reconnecting `VelociousWebsocketClient` for all sync traffic, connected on first use.
 */
/**
 * Velocious sync configuration.
 * @typedef {object} VelociousSyncConfiguration
 * @property {VelociousSyncApiConfiguration} [api] - Auto-mounts the Velocious sync changes/replay endpoints for this resource class.
 * @property {VelociousSyncClientConfiguration} [client] - Client-side sync configuration consumed by `SyncClient.fromConfiguration(...)`.
 * @property {import("./sync/device-identity.js").SyncJsonWebKey | null} [deviceCertificateBackendPublicKey] - Public backend key used to verify offline device certificates for sync replay.
 * @property {number} [changeFeedRetentionSize] - Number of accepted server changes retained before clients must refresh from snapshot.
 * @property {Array<import("./sync/offline-grant.js").OfflineGrantSigningKey>} offlineGrantSigningKeys - Signing keys used to issue and verify offline grants. Secrets must never be exposed to clients.
 * @property {number} [offlineGrantTtlMs] - Default offline grant TTL in milliseconds. Defaults to 24 hours.
 */
/**
 * Frontend-safe normalized sync metadata.
 * @typedef {object} NormalizedFrontendModelResourceSyncConfiguration
 * @property {"optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly"} conflictStrategy - Normalized replay conflict strategy.
 * @property {boolean} enabled - Whether the resource is sync-enabled.
 * @property {string[]} operations - Sorted, duplicate-free sync operation names.
 * @property {string | null} policyVersion - App-controlled policy version, or null.
 * @property {string} policyHash - Deterministic sha256 hash of safe policy inputs.
 * @property {Record<string, FrontendModelSyncJsonValue>} [metadata] - Safe frontend-visible metadata.
 */
/**
 * @typedef {Omit<FrontendModelResourceConfiguration, "abilities" | "builtInCollectionCommands" | "builtInMemberCommands" | "collectionCommands" | "commands" | "memberCommands" | "sync"> & {
 *   abilities: FrontendModelResourceAbilitiesConfiguration
 *   builtInCollectionCommands: Record<string, string>
 *   builtInMemberCommands: Record<string, string>
 *   collectionCommands: Record<string, string>
 *   commandMetadata: Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>
 *   memberCommands: Record<string, string>
 *   sync?: NormalizedFrontendModelResourceSyncConfiguration
 * }} NormalizedFrontendModelResourceConfiguration
 */
/**
 * Unbound resource class used by model-agnostic registries.
 * @typedef {Omit<typeof import("./frontend-model-resource/base-resource.js").default, "modelClass"> & {modelClass: () => typeof import("./database/record/index.js").default, new (args: never): import("./frontend-model-resource/base-resource.js").default<typeof import("./database/record/index.js").default>}} UnboundFrontendModelResourceClassType
 */
/**
 * Resource class bound to a specific model class.
 * @template {import("./frontend-model-resource/base-resource.js").FrontendModelResourceModelClass} TModelClass
 * @template {typeof import("./database/record/index.js").default} TDatabaseModelClass
 * @typedef {Omit<typeof import("./frontend-model-resource/base-resource.js").default, "ModelClass" | "modelClass"> & {ModelClass: TModelClass | undefined, modelClass: () => TModelClass, new (args: import("./frontend-model-resource/base-resource.js").FrontendModelResourceAbilityArgs<TModelClass> | import("./frontend-model-resource/base-resource.js").FrontendModelResourceControllerArgs<TDatabaseModelClass>): import("./frontend-model-resource/base-resource.js").default<TModelClass, TDatabaseModelClass>}} BoundFrontendModelResourceClassType
 */
/**
 * @template {import("./frontend-model-resource/base-resource.js").FrontendModelResourceModelClass} [TModelClass=never]
 * @template {typeof import("./database/record/index.js").default} [TDatabaseModelClass=Extract<TModelClass, typeof import("./database/record/index.js").default>]
 * @typedef {[TModelClass] extends [never] ? UnboundFrontendModelResourceClassType : BoundFrontendModelResourceClassType<TModelClass, TDatabaseModelClass>} FrontendModelResourceClassType
 */
/**
 * @template {import("./frontend-model-resource/base-resource.js").FrontendModelResourceModelClass} [TModelClass=never]
 * @typedef {FrontendModelResourceClassType<TModelClass>} FrontendModelResourceDefinition
 */
/**
 * @typedef {object} FrontendModelResourceAbilitiesConfiguration
 * @property {string} [index] - Ability action for frontend index.
 * @property {string} [find] - Ability action for frontend find.
 * @property {string} [create] - Ability action for frontend create.
 * @property {string} [update] - Ability action for frontend update.
 * @property {string} [destroy] - Ability action for frontend destroy.
 */
/**
 * @typedef {object} FrontendModelResourceServerConfiguration
 * @property {(args: {action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url", controller: import("./controller.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, modelClass: typeof import("./database/record/index.js").default}) => (boolean | void | Promise<boolean | void>)} [beforeAction] - Optional callback run before built-in frontend actions.
 * @property {(args: {action: "index", controller: import("./controller.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, modelClass: typeof import("./database/record/index.js").default}) => Promise<import("./database/record/index.js").default[]>} [records] - Records loader for frontendIndex.
 * @property {(args: {action: "index" | "find" | "create" | "update", controller: import("./controller.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default}) => Record<string, ReturnType<typeof JSON.parse>> | Promise<Record<string, ReturnType<typeof JSON.parse>>>} [serialize] - Record serializer for response payloads.
 * @property {(args: {action: "find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url", controller: import("./controller.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, modelClass: typeof import("./database/record/index.js").default, id: string | number}) => Promise<import("./database/record/index.js").default | null>} [find] - Record loader for find/update/destroy/attach/download/url actions.
 * @property {(args: {action: "create", controller: import("./controller.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, modelClass: typeof import("./database/record/index.js").default, attributes: Record<string, ReturnType<typeof JSON.parse>>}) => Promise<import("./database/record/index.js").default>} [create] - Custom create callback.
 * @property {(args: {action: "update", controller: import("./controller.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default, attributes: Record<string, ReturnType<typeof JSON.parse>>}) => Promise<import("./database/record/index.js").default | void>} [update] - Custom update callback.
 * @property {(args: {action: "destroy", controller: import("./controller.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default}) => Promise<void>} [destroy] - Custom destroy callback.
 */
/**
 * @typedef {object} BackendProjectConfiguration
 * @property {string} path - Path to the backend project. May be an app root or a contributing package root (package entries are appended internally from `packages`).
 * @property {string} [frontendModelsOutputPath] - Optional output project path where `src/frontend-models` should be generated.
 * @property {string} [resourcesPath] - Optional override for the resources directory to auto-discover; defaults to `<path>/src/resources`. Set internally for package entries.
 * @property {Record<string, FrontendModelResourceDefinition>} [frontendModels] - Auto-discovered frontend model definitions keyed by model class name. Set internally by the environment handler — do not set manually.
 * @property {AbilityResourceClassType[]} [abilityResources] - Auto-discovered ability resource classes (frontend-model and authorization) from this project's resources directory. Set internally by the environment handler — do not set manually.
 */
/**
 * A descriptor for an external Velocious package (engine) that contributes models,
 * resources and migrations. A package usually exports `new VelociousPackage({name, url: import.meta.url})`.
 * @typedef {object} VelociousPackageDescriptor
 * @property {string} name - The package name.
 * @property {string} [url] - The descriptor module's `import.meta.url`; the package root is derived from it when `path` is omitted.
 * @property {string} [path] - The package root directory (the one containing `src`). Derived from `url` when omitted.
 * @property {string} [modelsPath] - Override for the package's models directory (default `<path>/src/models`).
 * @property {string} [resourcesPath] - Override for the package's frontend-model resources directory (default `<path>/src/resources`).
 * @property {string} [migrationsPath] - Override for the package's migrations directory (default `<path>/src/database/migrations`).
 */
/**
 * @typedef {import("./packages/velocious-package.js").default | VelociousPackageDescriptor} VelociousPackageConfiguration
 */
/**
 * @typedef {object} RouteResolverHookArgs
 * @property {import("./configuration.js").default} configuration - Configuration instance.
 * @property {Record<string, ReturnType<typeof JSON.parse>>} params - Mutable request params object.
 * @property {string} currentPath - Request path without query.
 * @property {boolean} [hasMatchingCustomRoute] - True when matching a configured custom route.
 * @property {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default} request - Request object.
 * @property {import("./http-server/client/response.js").default} response - Response object.
 * @property {import("./routes/resolver.js").default} resolver - Resolver instance.
 */
/**
 * @typedef {object} RouteResolverHookResult
 * @property {string} action - Dasherized action name (for example `frontend-index`).
 * @property {string} controller - Controller path (for example `accounts`).
 * @property {typeof import("./controller.js").default} [controllerClass] - Optional controller class override.
 * @property {string} [controllerPath] - Optional absolute/relative controller file path override.
 * @property {Record<string, ReturnType<typeof JSON.parse>>} [params] - Extra params to merge for controller/action.
 * @property {boolean} [skipAbilityResolution] - Whether to run the controller action without resolving request ability.
 * @property {boolean} [skipControllerConnections] - Whether to run the controller action without the automatic database checkout wrapper.
 * @property {boolean} [skipTenantResolution] - Whether to run the controller action without resolving request tenant.
 * @property {string} [viewPath] - Optional view path override used by controller render lookups.
 */
/**
 * @typedef {(arg: RouteResolverHookArgs) => RouteResolverHookResult | null | Promise<RouteResolverHookResult | null>} RouteResolverHookType
 */
/**
 * @typedef {typeof import("./authorization/base-resource.js").default} AbilityResourceClassType
 */
/**
 * @typedef {(args: {configuration: import("./configuration.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, response: import("./http-server/client/response.js").default | undefined}) => import("./authorization/ability.js").default | void | Promise<import("./authorization/ability.js").default | void>} AbilityResolverType
 */
/**
 * @typedef {(args: {configuration: import("./configuration.js").default, params: Record<string, ReturnType<typeof JSON.parse>>, request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, response: import("./http-server/client/response.js").default | undefined, subscription?: {channel: string, params?: Record<string, ReturnType<typeof JSON.parse>>}}) => ReturnType<typeof JSON.parse> | void | Promise<ReturnType<typeof JSON.parse> | void>} TenantResolverType
 */
/**
 * @typedef {(args: {configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, tenant: ReturnType<typeof JSON.parse>}) => DatabaseConfigurationType | Partial<DatabaseConfigurationType> | void} TenantDatabaseResolverType
 */
/**
 * @typedef {object} ApiManifestConfiguration
 * @property {string} [path] - HTTP path for the built-in API manifest endpoint. Defaults to `/api/manifest`.
 * @property {string} [token] - Bearer token required in the `Authorization: Bearer <token>` header. When set, requests without a matching token are not routed (404), so the endpoint stays hidden.
 */
/**
 * @typedef {object} DebugEndpointConfiguration
 * @property {string} [path] - HTTP path for the built-in debug endpoint. Defaults to `/velocious/debug`.
 * @property {string} [token] - Bearer token required in the `Authorization: Bearer <token>` header. When set, requests without a matching token are not routed (404), so the endpoint stays hidden.
 */
/**
 * @typedef {object} TenantDatabaseProviderType
 * @property {(args: {configuration: import("./configuration.js").default, identifier: string}) => Array<ReturnType<typeof JSON.parse>> | Promise<Array<ReturnType<typeof JSON.parse>>>} listTenants - Lists tenants that should be created, checked, or migrated for this database identifier.
 * @property {(args: {configuration: import("./configuration.js").default, identifier: string}) => ReturnType<typeof JSON.parse> | void | Promise<ReturnType<typeof JSON.parse> | void>} [resolveGenerationTenant] - Resolves one explicit tenant descriptor for schema/base-model generation without enumerating lifecycle tenants.
 * @property {(args: {configuration: import("./configuration.js").default, identifier: string}) => Array<ReturnType<typeof JSON.parse>> | Promise<Array<ReturnType<typeof JSON.parse>>>} [listRestrictTenants] - Lists existing tenants that should be checked for dependent restrict destroys. Defaults to listTenants.
 * @property {(args: {configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, tenant: ReturnType<typeof JSON.parse>}) => void | Promise<void>} [createDatabase] - Creates the tenant database/schema for one tenant.
 * @property {(args: {configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, tenant: ReturnType<typeof JSON.parse>}) => void | Promise<void>} [dropDatabase] - Drops the tenant database/schema for one tenant.
 * @property {(args: {configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, tenant: ReturnType<typeof JSON.parse>}) => void | Promise<void>} [checkTenant] - Checks one tenant database before generic connection validation.
 * @property {(args: {configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, migrationsApplied: number, tenant: ReturnType<typeof JSON.parse>}) => void | Promise<void>} [afterMigrateTenant] - Runs app-owned tenant work after generic migrations for one tenant. `migrationsApplied` is how many migrations actually ran (0 when the tenant was already up to date), so the app can skip expensive per-tenant work on no-op deploys.
 */
/**
 * @typedef {object} ConfigurationArgsType
 * @property {boolean} [autoload] - Globally enable auto-batch-preload of relationships on lazy access. Default true.
 * @property {CorsType} [cors] - CORS configuration for the HTTP server.
 * @property {string} [cookieSecret] - Secret for encrypting cookies.
 * @property {AbilityResourceClassType[]} [abilityResources] - Resource classes used to define abilities per model.
 * @property {AbilityResolverType} [abilityResolver] - Resolver for creating request-scoped ability instances.
 * @property {AttachmentsConfiguration} [attachments] - Attachment storage configuration.
 * @property {BackendProjectConfiguration[]} [backendProjects] - Backend project definitions used for frontend model generation.
 * @property {VelociousPackageConfiguration[]} [packages] - External Velocious packages that contribute models, frontend-model resources and migrations.
 * @property {{[key: string]: {[key: string]: DatabaseConfigurationType}}} database - Database configurations keyed by environment and identifier.
 * @property {boolean} [debug] - Enable debug logging.
 * @property {boolean | DebugEndpointConfiguration} [debugEndpoint] - Enable the built-in debug endpoint. Defaults to false.
 * @property {boolean | ApiManifestConfiguration} [apiManifest] - Enable the built-in API manifest endpoint. Defaults to false.
 * @property {string} [directory] - Base directory for the project.
 * @property {boolean} [enforceTenantDatabaseScopes] - Require tenant-switched model queries to resolve a tenant database identifier. Defaults to true.
 * @property {string} [environment] - Current environment name.
 * @property {import("./environment-handlers/base.js").default} environmentHandler - Environment handler instance.
 * @property {boolean} [exposeInternalErrorsToClients] - Return unexpected internal error messages and stack traces in frontend-model client payloads in every environment. Defaults to true.
 * @property {{maxOpenHandles?: number}} [frontendTenantSqlite] - Bounded frontend tenant SQLite lifecycle configuration.
 * @property {boolean} [secureFrontendModelErrors] - Deprecated compatibility alias for `exposeInternalErrorsToClients: false` when the authoritative option is omitted.
 * @property {HttpServerConfiguration} [httpServer] - Default HTTP server configuration for applications started from this configuration.
 * @property {LoggingConfiguration} [logging] - Logging configuration.
 * @property {BackgroundJobsConfiguration} [backgroundJobs] - Background jobs configuration.
 * @property {BeaconConfiguration} [beacon] - Beacon broadcast bus configuration.
 * @property {ScheduledBackgroundJobsConfiguration | ScheduledBackgroundJobsLoaderType} [scheduledBackgroundJobs] - Scheduled background jobs configuration.
 * @property {MailerBackend} [mailerBackend] - Mail delivery backend.
 * @property {(args: {configuration: import("./configuration.js").default, type: string}) => void} initializeModels - Hook to register models for a given initialization type.
 * @property {InitializersType} [initializers] - Initializer loader for environment bootstrapping.
 * @property {string | (() => string)} locale - Default locale or locale resolver.
 * @property {string[]} locales - Supported locales.
 * @property {LocaleFallbacksType} localeFallbacks - Locale fallback map.
 * @property {StructureSqlConfiguration} [structureSql] - Structure SQL generation configuration.
 * @property {VelociousSyncConfiguration} [sync] - Local/offline sync framework configuration.
 * @property {TenantResolverType} [tenantResolver] - Resolver for creating request-scoped tenant context objects.
 * @property {TenantDatabaseResolverType} [tenantDatabaseResolver] - Resolver for deriving tenant-specific database config overrides.
 * @property {Record<string, TenantDatabaseProviderType>} [tenantDatabaseProviders] - Tenant database lifecycle providers keyed by database identifier.
 * @property {string} [testing] - Path to the testing configuration file.
 * @property {string | (() => string | undefined)} [timeZone] - Default timezone for timezone-less datetime strings.
 * @property {number | (() => number)} [timezoneOffsetMinutes] - Default timezone offset in minutes.
 * @property {string | string[]} [trustedProxies] - Trusted reverse proxy address ranges used to resolve request remote addresses from forwarding headers.
 * @property {number | (() => number)} [requestTimeoutMs] - Timeout in seconds for completing a HTTP request.
 * @property {RouteResolverHookType[]} [routeResolverHooks] - Hook callbacks that can hijack unresolved routes.
 * @property {WebsocketChannelResolverType} [websocketChannelResolver] - Resolve a websocket channel class/instance for each connection.
 * @property {WebsocketMessageHandlerResolverType} [websocketMessageHandlerResolver] - Resolve a raw websocket message handler for each connection.
 */
export declare const nothing: {};
//# sourceMappingURL=configuration-types.d.ts.map