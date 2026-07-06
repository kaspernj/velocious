// @ts-check

/**
 * @module types
 */

/**
 * @typedef {function({request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default}): Promise<void>} CorsType
 */

/**
 * @typedef {function({request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, subscription?: {channel: string, params?: Record<string, ?>}, client: import("./http-server/client/index.js").default, websocketSession: import("./http-server/client/websocket-session.js").default, configuration: import("./configuration.js").default}): typeof import("./http-server/websocket-channel.js").default | import("./http-server/websocket-channel.js").default | void | Promise<typeof import("./http-server/websocket-channel.js").default | import("./http-server/websocket-channel.js").default | void>} WebsocketChannelResolverType
 */

/**
 * @typedef {object} WebsocketMessageHandler
 * @property {function({message: ?, session: import("./http-server/client/websocket-session.js").default}) : Promise<void> | void} [onMessage] - Handler for incoming websocket messages.
 * @property {function({session: import("./http-server/client/websocket-session.js").default}) : Promise<void> | void} [onOpen] - Handler when the websocket session opens.
 * @property {function({session: import("./http-server/client/websocket-session.js").default}) : Promise<void> | void} [onClose] - Handler when the websocket session closes.
 * @property {function({error: Error, session: import("./http-server/client/websocket-session.js").default}) : Promise<void> | void} [onError] - Handler when a websocket message errors.
 */

/**
 * @typedef {function({request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, client: import("./http-server/client/index.js").default, configuration: import("./configuration.js").default}): WebsocketMessageHandler | void | Promise<WebsocketMessageHandler | void>} WebsocketMessageHandlerResolverType
 */

/**
 * @typedef {(id: string) => {default: typeof import("./initializer.js").default}} InitializersRequireContextType
 * @typedef {InitializersRequireContextType & {
 *   keys: () => string[],
 *   id: string
 * }} WebpackRequireContext
 * @typedef {{requireContext: WebpackRequireContext}} InitializersExportType
 * @typedef {function({configuration: import("./configuration.js").default}) : Promise<InitializersExportType>} InitializersType
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
 * @property {typeof import("./database/drivers/base.js").default} [driver] - Driver class to use for this database.
 * @property {typeof import("./database/pool/base.js").default} [poolType] - Pool class to use for this database.
 * @property {function() : ?} [getConnection] - Custom connection factory override.
 * @property {string} [host] - Database host.
 * @property {boolean} [migrations] - Whether migrations are enabled for this database.
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
 * @property {function(LoggingOutputPayload): Promise<void> | void} write - Write a log entry.
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

/**
 * @typedef {object} BackgroundJobsConfiguration
 * @property {string} [host] - Hostname for the background jobs main process.
 * @property {number} [port] - Port for the background jobs main process.
 * @property {string} [databaseIdentifier] - Database identifier used to store background jobs.
 * @property {number} [maxConcurrentInlineJobs] - How many `forked: false` jobs a single
 *   `background-jobs-worker` process is allowed to run in parallel. Concurrency
 *   is at the JS event-loop level: every concurrent job shares the worker's
 *   process and DB connection pool, so this should fit the pool size, not the
 *   CPU count. Forking remains the right tool for memory isolation across
 *   long-running jobs and for using more cores. Default: `4`.
 * @property {number} [maxConcurrentForkedJobs] - How many out-of-process
 *   `"forked"` or `"spawned"` jobs a single `background-jobs-worker` is
 *   allowed to keep in flight. Default: `4`.
 * @property {BackgroundJobsDispatchStrategy} [dispatchStrategy] - How the main process
 *   detects new work. Defaults to `"beacon"` (event-driven). Set to `"polling"`
 *   to restore the legacy fixed-interval poll.
 * @property {number} [pollIntervalMs] - Poll interval in milliseconds. Only used
 *   when `dispatchStrategy === "polling"`. Default: `1000`.
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
 * @typedef {object} HttpServerConfiguration
 * @property {string} [host] - Hostname to bind the HTTP server to.
 * @property {boolean} [inProcess] - Run HTTP handlers in the main thread instead of worker threads.
 * @property {number} [maxWorkers] - Backward-compatible alias for workers.
 * @property {number} [port] - Port to bind the HTTP server to.
 * @property {number} [workers] - Worker handlers to start for the HTTP server.
 */

/**
 * @typedef {object} ScheduledBackgroundJobEveryOptions
 * @property {number | string} [firstIn] - Delay before the first enqueue.
 */

/**
 * @typedef {object} ScheduledBackgroundJobConfiguration
 * @property {Array<?>} [args] - Arguments passed to the job when enqueued.
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
 * @property {?} [body] - Sanitized parsed request body, when available.
 * @property {string} httpMethod - Request HTTP method.
 * @property {string} path - Request path.
 */

/**
 * @typedef {object} ClientErrorPayloadContext
 * @property {string} controller - Controller class name.
 * @property {string} [action] - Controller action or endpoint label.
 * @property {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url" | "custom-command"} [commandType] - Frontend-model command type.
 * @property {boolean} [expectedError] - Whether the error is an expected user-flow failure.
 * @property {boolean} [frontendModelEndpoint] - Whether the error came from the frontend-model endpoint.
 * @property {string} [model] - Frontend-model name from the failed request.
 * @property {string} [requestId] - Shared frontend-model request id.
 */

/**
 * @typedef {function({
 *   context: ClientErrorPayloadContext,
 *   error: Error,
 *   request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined,
 *   requestDetails: ErrorRequestDetails | null
 * }): Promise<ClientErrorPayloadReporterPayload | void> | ClientErrorPayloadReporterPayload | void} ClientErrorPayloadReporterType
 */

/**
 * @typedef {Record<string, unknown> & {configuration?: import("./configuration.js").default, currentDevice?: unknown, currentUser?: unknown, modelRegistry?: Record<string, unknown> | {model: (name: string) => unknown}, now?: Date | (() => Date), offlineGrant?: unknown, params?: VelociousParams, request?: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, resourceRuntime?: "backend" | "frontend" | "offline"}} VelociousLooseObject
 */

/**
 * @typedef {new (args: {attachmentName?: string, configuration: import("./configuration.js").default, modelClass?: typeof import("./database/record/index.js").default, name?: string, options?: Record<string, ?>}) => object} AttachmentDriverConstructor
 */

/**
 * @typedef {object} ScheduledBackgroundJobsConfiguration
 * @property {Record<string, ScheduledBackgroundJobConfiguration>} jobs - Scheduled jobs keyed by name.
 */

/**
 * @typedef {function({configuration: import("./configuration.js").default}) : ScheduledBackgroundJobsConfiguration | Promise<ScheduledBackgroundJobsConfiguration>} ScheduledBackgroundJobsLoaderType
 */

/**
 * @typedef {object} AttachmentDriverConfiguration
 * @property {function({configuration: import("./configuration.js").default, name: string, options: Record<string, ?>}) : Record<string, ?>} [create] - Optional factory for a custom attachment driver instance.
 * @property {AttachmentDriverConstructor} [driverClass] - Optional custom attachment driver class.
 * @property {Record<string, ?>} [instance] - Optional custom attachment driver instance.
 */

/**
 * @typedef {object} AttachmentsConfiguration
 * @property {string} [defaultDriver] - Default attachment storage driver name.
 * @property {Record<string, AttachmentDriverConfiguration & Record<string, ?>>} [drivers] - Named attachment driver configurations.
 * @property {boolean} [allowPathInput] - Whether `{path: ...}` attachment input is allowed.
 * @property {string[]} [allowedPathPrefixes] - Optional allowlist of directories for `{path: ...}` input.
 */

/**
 * @typedef {object} MailerBackend
 * @property {function({payload: import("./mailer.js").MailerDeliveryPayload, configuration: import("./configuration.js").default}) : Promise<?> | ?} deliver - Deliver a mailer payload.
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
 * @property {string} [returnType] - JSDoc type for the command response. When set, the generated method is typed `Promise<returnType>` instead of `Promise<Record<string, ?>>`. Emitted verbatim into the generated frontend model, so it must resolve there.
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
 * @property {(path: string, body?: ?, options?: {headers?: Record<string, string>}) => Promise<{json: () => ?}>} post - Posts one request and resolves a response with a json accessor.
 */

/**
 * Websocket client contract required from `sync.client.realtime.createClient`,
 * matching `VelociousWebsocketClient` / snapreq's websocket client.
 * @typedef {object} VelociousSyncRealtimeWebsocketClient
 * @property {() => Promise<?>} connect - Connects the websocket.
 * @property {(channelType: string, options?: {params?: Record<string, ?>, onMessage?: (body: ?) => void, onResume?: () => void, onClose?: (reason: string) => void}) => VelociousSyncRealtimeSubscription} subscribeChannel - Opens one channel subscription.
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
 * @property {Record<string, ?>} [params] - Subscribe params (runtime scope values). The framework injects `authenticationToken` automatically.
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
 * @property {(context: ?) => Array<VelociousSyncRealtimeChannelDescriptor> | Promise<Array<VelociousSyncRealtimeChannelDescriptor>>} [channels] - Deprecated legacy escape hatch: resolves extra app-channel descriptors from the `subscribeRealtime(context)` context. Declared pull scopes subscribe the framework sync channel automatically.
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
 * @typedef {Omit<typeof import("./frontend-model-resource/base-resource.js").default, never> & {new (args: import("./frontend-model-resource/base-resource.js").FrontendModelResourceAbilityArgs | import("./frontend-model-resource/base-resource.js").FrontendModelResourceControllerArgs): import("./frontend-model-resource/base-resource.js").default<typeof import("./database/record/index.js").default>}} FrontendModelResourceClassType
 */

/**
 * @typedef {FrontendModelResourceClassType} FrontendModelResourceDefinition
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
 * @property {function({action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url", controller: import("./controller.js").default, params: Record<string, ?>, modelClass: typeof import("./database/record/index.js").default}) : (boolean | void | Promise<boolean | void>)} [beforeAction] - Optional callback run before built-in frontend actions.
 * @property {function({action: "index", controller: import("./controller.js").default, params: Record<string, ?>, modelClass: typeof import("./database/record/index.js").default}) : Promise<import("./database/record/index.js").default[]>} [records] - Records loader for frontendIndex.
 * @property {function({action: "index" | "find" | "create" | "update", controller: import("./controller.js").default, params: Record<string, ?>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default}) : Record<string, ?> | Promise<Record<string, ?>>} [serialize] - Record serializer for response payloads.
 * @property {function({action: "find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url", controller: import("./controller.js").default, params: Record<string, ?>, modelClass: typeof import("./database/record/index.js").default, id: string | number}) : Promise<import("./database/record/index.js").default | null>} [find] - Record loader for find/update/destroy/attach/download/url actions.
 * @property {function({action: "create", controller: import("./controller.js").default, params: Record<string, ?>, modelClass: typeof import("./database/record/index.js").default, attributes: Record<string, ?>}) : Promise<import("./database/record/index.js").default>} [create] - Custom create callback.
 * @property {function({action: "update", controller: import("./controller.js").default, params: Record<string, ?>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default, attributes: Record<string, ?>}) : Promise<import("./database/record/index.js").default | void>} [update] - Custom update callback.
 * @property {function({action: "destroy", controller: import("./controller.js").default, params: Record<string, ?>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default}) : Promise<void>} [destroy] - Custom destroy callback.
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
 * @property {Record<string, ?>} params - Mutable request params object.
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
 * @property {Record<string, ?>} [params] - Extra params to merge for controller/action.
 * @property {boolean} [skipAbilityResolution] - Whether to run the controller action without resolving request ability.
 * @property {boolean} [skipControllerConnections] - Whether to run the controller action without the automatic database checkout wrapper.
 * @property {boolean} [skipTenantResolution] - Whether to run the controller action without resolving request tenant.
 * @property {string} [viewPath] - Optional view path override used by controller render lookups.
 */

/**
 * @typedef {function(RouteResolverHookArgs) : RouteResolverHookResult | null | Promise<RouteResolverHookResult | null>} RouteResolverHookType
 */

/**
 * @typedef {typeof import("./authorization/base-resource.js").default} AbilityResourceClassType
 */

/**
 * @typedef {function({configuration: import("./configuration.js").default, params: Record<string, ?>, request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, response: import("./http-server/client/response.js").default | undefined}) : import("./authorization/ability.js").default | void | Promise<import("./authorization/ability.js").default | void>} AbilityResolverType
 */

/**
 * @typedef {function({configuration: import("./configuration.js").default, params: Record<string, ?>, request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, response: import("./http-server/client/response.js").default | undefined, subscription?: {channel: string, params?: Record<string, ?>}}) : ? | void | Promise<? | void>} TenantResolverType
 */

/**
 * @typedef {function({configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, tenant: ?}) : DatabaseConfigurationType | Partial<DatabaseConfigurationType> | void} TenantDatabaseResolverType
 */

/**
 * @typedef {object} DebugEndpointConfiguration
 * @property {string} [path] - HTTP path for the built-in debug endpoint. Defaults to `/velocious/debug`.
 * @property {string} [token] - Bearer token required in the `Authorization: Bearer <token>` header. When set, requests without a matching token are not routed (404), so the endpoint stays hidden.
 */

/**
 * @typedef {object} TenantDatabaseProviderType
 * @property {function({configuration: import("./configuration.js").default, identifier: string}) : Array<?> | Promise<Array<?>>} listTenants - Lists tenants that should be created, checked, or migrated for this database identifier.
 * @property {function({configuration: import("./configuration.js").default, identifier: string}) : Array<?> | Promise<Array<?>>} [listRestrictTenants] - Lists existing tenants that should be checked for dependent restrict destroys. Defaults to listTenants.
 * @property {function({configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, tenant: ?}) : void | Promise<void>} [createDatabase] - Creates the tenant database/schema for one tenant.
 * @property {function({configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, tenant: ?}) : void | Promise<void>} [dropDatabase] - Drops the tenant database/schema for one tenant.
 * @property {function({configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, tenant: ?}) : void | Promise<void>} [checkTenant] - Checks one tenant database before generic connection validation.
 * @property {function({configuration: import("./configuration.js").default, databaseConfiguration: DatabaseConfigurationType, identifier: string, migrationsApplied: number, tenant: ?}) : void | Promise<void>} [afterMigrateTenant] - Runs app-owned tenant work after generic migrations for one tenant. `migrationsApplied` is how many migrations actually ran (0 when the tenant was already up to date), so the app can skip expensive per-tenant work on no-op deploys.
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
 * @property {string} [directory] - Base directory for the project.
 * @property {boolean} [enforceTenantDatabaseScopes] - Require tenant-switched model queries to resolve a tenant database identifier. Defaults to true.
 * @property {string} [environment] - Current environment name.
 * @property {import("./environment-handlers/base.js").default} environmentHandler - Environment handler instance.
 * @property {boolean} [exposeInternalErrorsToClients] - Return unexpected internal error details in client API payloads outside production. Defaults to false.
 * @property {HttpServerConfiguration} [httpServer] - Default HTTP server configuration for applications started from this configuration.
 * @property {LoggingConfiguration} [logging] - Logging configuration.
 * @property {BackgroundJobsConfiguration} [backgroundJobs] - Background jobs configuration.
 * @property {BeaconConfiguration} [beacon] - Beacon broadcast bus configuration.
 * @property {ScheduledBackgroundJobsConfiguration | ScheduledBackgroundJobsLoaderType} [scheduledBackgroundJobs] - Scheduled background jobs configuration.
 * @property {MailerBackend} [mailerBackend] - Mail delivery backend.
 * @property {function({configuration: import("./configuration.js").default, type: string}) : void} initializeModels - Hook to register models for a given initialization type.
 * @property {InitializersType} [initializers] - Initializer loader for environment bootstrapping.
 * @property {string | function() : string} locale - Default locale or locale resolver.
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

export const nothing = {}
