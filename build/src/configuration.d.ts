export type WithConnectionsCallbackType<T> = (arg: Record<string, import("./database/drivers/base.js").default>) => Promise<T>;
export type WithConnectionsOptionsType = {
    /**
     * - Database identifiers to include in the connection scope.
     */
    databaseIdentifiers?: string[];
    /**
     * - Human-readable name for the checked-out database connections.
     */
    name?: string;
};
export type BackgroundJobsAdapterGeneration = {
    /**
     * - Adapter owned by this generation.
     */
    adapter: import("./background-jobs/adapter.js").default;
    /**
     * - Whether close has claimed this generation.
     */
    closing: boolean;
    /**
     * - Shared readiness attempt.
     */
    readyPromise: Promise<void> | undefined;
    /**
     * - Shared close operation.
     */
    closePromise: Promise<void> | undefined;
};
import BackgroundJobsAdapter from "./background-jobs/adapter.js";
import DatabaseOperation from "./database/operation.js";
import VelociousWebsocketChannelSubscribers from "./http-server/websocket-channel-subscribers.js";
import { CurrentConfigurationNotSetError } from "./current-configuration.js";
import LogRedactor from "./log-redactor.js";
import VelociousPackage from "./packages/velocious-package.js";
import FrontendTenantSqliteLifecycle from "./tenants/frontend-tenant-sqlite-lifecycle.js";
export { CurrentConfigurationNotSetError };
export default class VelociousConfiguration {
    _abilityResolver: import("./configuration-types.js").AbilityResolverType | undefined;
    _abilityResources: typeof import("./authorization/base-resource.js").default[];
    _autoload: boolean;
    _backgroundJobs: import("./configuration-types.js").BackgroundJobsConfiguration | undefined;
    _beacon: import("./configuration-types.js").BeaconConfiguration | undefined;
    /**
     * Stores the beacon client value.
     * @type {import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined} */
    _beaconClient: import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined;
    /**
     * Stores the beacon connect promise value.
     * @type {Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined> | undefined} */
    _beaconConnectPromise: Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined> | undefined;
    /**
     * Stores the beacon report timer value.
     * @type {ReturnType<typeof setTimeout> | undefined} - Pending "beacon still unreachable" report timer.
     */
    _beaconReportTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Stores the beacon outage reported value.
     * @type {boolean} - Whether the current beacon outage has already been reported.
     */
    _beaconOutageReported: boolean;
    /**
     * Stores the beacon last down error value.
     * @type {{stage: "beacon-connect" | "beacon-disconnect", error: Error} | undefined} - Latest beacon-down details, reported only if the outage is sustained.
     */
    _beaconLastDownError: {
        stage: "beacon-connect" | "beacon-disconnect";
        error: Error;
    } | undefined;
    _scheduledBackgroundJobs: import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | import("./configuration-types.js").ScheduledBackgroundJobsLoaderType | undefined;
    _attachments: import("./configuration-types.js").AttachmentsConfiguration;
    _backendProjects: import("./configuration-types.js").BackendProjectConfiguration[];
    /** @type {import("./configuration-types.js").ClientErrorPayloadReporterType[]} */
    _clientErrorPayloadReporters: import("./configuration-types.js").ClientErrorPayloadReporterType[];
    cors: import("./configuration-types.js").CorsType | undefined;
    _cookieSecret: string | undefined;
    database: {
        [key: string]: {
            [key: string]: import("./configuration-types.js").DatabaseConfigurationType;
        };
    };
    debug: boolean;
    _debugEndpoint: {
        enabled: boolean;
        path: string;
        token: string | null;
    };
    _apiManifest: {
        enabled: boolean;
        path: string;
        token: string | null;
    };
    _environment: string;
    _environmentHandler: import("./environment-handlers/base.js").default;
    _enforceTenantDatabaseScopes: boolean;
    _exposeInternalErrorsToClients: boolean;
    _directory: string | undefined;
    _initializeModels: (args: {
        configuration: import("./configuration.js").default;
        type: string;
    }) => void;
    /** @type {VelociousPackage[]} */
    _packages: VelociousPackage[];
    _isInitialized: boolean;
    /** @type {import("./configuration-types.js").ApplicationProcessContext | undefined} */
    _applicationProcessContext: import("./configuration-types.js").ApplicationProcessContext | undefined;
    /** @type {import("./initializer.js").default[]} */
    _successfulInitializers: import("./initializer.js").default[];
    /** @type {boolean} */
    _applicationLifecycleInitialized: boolean;
    /** @type {Promise<void> | undefined} */
    _shutdownPromise: Promise<void> | undefined;
    /** @type {Promise<void> | undefined} */
    _queuedInitializePromise: Promise<void> | undefined;
    _modelsInitialized: boolean;
    /**
     * Invalidates model phases that started before database connections closed.
     * @type {number}
     */
    _modelInitializationGeneration: number;
    /**
     * In-progress `initializeModels()` promise. Model initialization is an
     * atomic bootstrap phase: concurrent callers share it, and a rejection
     * leaves the phase eligible for a later complete attempt.
     * @type {Promise<void> | undefined}
     */
    _initializeModelsPromise: Promise<void> | undefined;
    /**
     * Current `initialize()` promise, memoized so concurrent callers await the
     * same bootstrap. Retained across a connection close until stale bootstrap
     * work settles, then cleared by identity before the new generation retries.
     * @type {Promise<void> | undefined}
     */
    _initializePromise: Promise<void> | undefined;
    /** @type {number | undefined} */
    _initializePromiseGeneration: number | undefined;
    httpServer: {
        host?: string;
        inProcess?: boolean;
        maxWorkers?: number;
        port?: number;
        workers?: number;
        compression: import("./configuration-types.js").NormalizedHttpCompressionConfiguration;
        websocketInboundQueue: {
            maxPendingBytes: number;
            maxPendingMessages: number;
        };
        websocketOutboundQueue: {
            maxPendingBytes: number;
            maxPendingFrames: number;
        };
    };
    /**
     * Stores the http server instance value.
     * @type {{getDebugSnapshot: () => Promise<Record<string, ReturnType<typeof JSON.parse>>>} | undefined} */
    _httpServerInstance: {
        getDebugSnapshot: () => Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    } | undefined;
    locale: string | (() => string);
    localeFallbacks: import("./configuration-types.js").LocaleFallbacksType;
    locales: string[];
    _initializers: import("./configuration-types.js").InitializersType | undefined;
    _testing: string | undefined;
    _timeZone: string | (() => string | undefined) | undefined;
    _timezoneOffsetMinutes: number | (() => number) | undefined;
    _trustedProxies: string | string[] | undefined;
    _requestTimeoutMs: number | (() => number) | undefined;
    _structureSql: import("./configuration-types.js").StructureSqlConfiguration | undefined;
    _sync: import("./configuration-types.js").VelociousSyncConfiguration;
    _tenantDatabaseProviders: Record<string, import("./configuration-types.js").TenantDatabaseProviderType>;
    _tenantDatabaseResolver: import("./configuration-types.js").TenantDatabaseResolverType | undefined;
    _tenantResolver: import("./configuration-types.js").TenantResolverType | undefined;
    _websocketEvents: import("./http-server/websocket-events.js").default | undefined;
    /**
     * Stores the websocket channel subscribers value.
     * @type {VelociousWebsocketChannelSubscribers | undefined} */
    _websocketChannelSubscribers: VelociousWebsocketChannelSubscribers | undefined;
    _websocketChannelResolver: import("./configuration-types.js").WebsocketChannelResolverType | undefined;
    _websocketMessageHandlerResolver: import("./configuration-types.js").WebsocketMessageHandlerResolverType | undefined;
    /**
     * Stores the websocket connection classes value.
     * @type {Map<string, typeof import("./http-server/websocket-connection.js").default>} */
    _websocketConnectionClasses: Map<string, typeof import("./http-server/websocket-connection.js").default>;
    /**
     * Stores the websocket channel classes value.
     * @type {Map<string, typeof import("./http-server/websocket-channel.js").default>} */
    _websocketChannelClasses: Map<string, typeof import("./http-server/websocket-channel.js").default>;
    /**
     * Stores the websocket channel subscriptions value.
     * @type {Map<string, Set<import("./http-server/websocket-channel.js").default>>} - channelType → live subscriptions across all sessions.
     */
    _websocketChannelSubscriptions: Map<string, Set<import("./http-server/websocket-channel.js").default>>;
    /**
     * In-flight local (per-process) websocket channel broadcast deliveries,
     * launched fire-and-forget from `_broadcastToChannelLocal` so one slow
     * subscriber never blocks another. Tracked here so
     * `awaitPendingBroadcasts` can snapshot and drain them before settling.
     * Settled deliveries are removed by the tracking-level cleanup.
     * @type {Set<Promise<void>>} */
    _localBroadcastDeliveries: Set<Promise<void>>;
    /**
     * Latest local broadcast delivery per subscription. Chaining subsequent
     * deliveries preserves lifecycle event order without coupling separate
     * subscribers to one another.
     * @type {WeakMap<import("./http-server/websocket-channel.js").default, Promise<void>>} */
    _localBroadcastDeliveryTails: WeakMap<import("./http-server/websocket-channel.js").default, Promise<void>>;
    /**
     * Stores the websocket sessions value.
     * @type {Set<import("./http-server/client/websocket-session.js").default>} - Live websocket sessions, including paused sessions within the grace window.
     */
    _websocketSessions: Set<import("./http-server/client/websocket-session.js").default>;
    /**
     * Stores the paused websocket sessions value.
     * @type {Map<string, {session: import("./http-server/client/websocket-session.js").default, graceTimer: ReturnType<typeof setTimeout>, pausedAt: number}>} - sessionId → paused session awaiting resume.
     */
    _pausedWebsocketSessions: Map<string, {
        session: import("./http-server/client/websocket-session.js").default;
        graceTimer: ReturnType<typeof setTimeout>;
        pausedAt: number;
    }>;
    /** Grace period for paused WebSocket sessions before permanent teardown. */
    _websocketSessionGraceSeconds: number;
    /** Interval (seconds) between server→client heartbeat pings; 0 disables reaping of silent sockets. */
    _websocketSessionHeartbeatSeconds: number;
    /**
     * Optional wrapper called around every WebSocket-borne request /
     * connection message / channel dispatch. Apps register it here
     * to set up per-request context (e.g. AsyncLocalStorage for
     * locale, tenant, tracing) that downstream handlers read.
     * @type {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null}
     */
    _websocketAroundRequest: ((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null;
    /**
     * Stores the around action value.
     * @type {((context: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default, next: () => Promise<void>}) => Promise<void>) | null} */
    _aroundAction: ((context: {
        request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default;
        response: import("./http-server/client/response.js").default;
        next: () => Promise<void>;
    }) => Promise<void>) | null;
    /**
     * Stores the websocket session identity resolver value.
     * @type {((session: import("./http-server/client/websocket-session.js").default) => ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>) | null} */
    _websocketSessionIdentityResolver: ((session: import("./http-server/client/websocket-session.js").default) => ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>) | null;
    _logging: import("./configuration-types.js").LoggingConfiguration | undefined;
    _logRedactor: LogRedactor;
    _mailerBackend: import("./configuration-types.js").MailerBackend | undefined;
    _routeResolverHooks: import("./configuration-types.js").RouteResolverHookType[];
    /**
     * Stores the applied route mounts value.
     * @type {WeakSet<object>} */
    _appliedRouteMounts: WeakSet<object>;
    _errorEvents: import("eventemitter3").EventEmitter<string | symbol, any>;
    /**
     * Stores the database pools value.
     * @type {{[key: string]: import("./database/pool/base.js").default}} */
    databasePools: {
        [key: string]: import("./database/pool/base.js").default;
    };
    _frontendTenantSqliteLifecycle: FrontendTenantSqliteLifecycle;
    /**
     * Stores the model classes value.
     * @type {{[key: string]: typeof import("./database/record/index.js").default}} */
    modelClasses: {
        [key: string]: typeof import("./database/record/index.js").default;
    };
    _routes: import("./routes/index.js").default | undefined;
    _translator: ((arg1: string, arg2: Record<string, ReturnType<typeof JSON.parse>> | undefined) => string) | undefined;
    _defaultTranslatorBound: ((msgID: string, args?: Record<string, ReturnType<typeof JSON.parse>>) => string) | undefined;
    /**
     * Close database connections promise.
     * @type {Promise<void> | null} */
    _closeDatabaseConnectionsPromise: Promise<void> | null;
    /** @type {BackgroundJobsAdapterGeneration | undefined} */
    _backgroundJobsAdapterGeneration: BackgroundJobsAdapterGeneration | undefined;
    /**
     * Dedicated advisory-lock connections currently holding a lock. These are spawned
     * outside the pools' tracked sets (so a hold-timeout lock survives pool checkouts),
     * so `closeDatabaseConnections` would otherwise walk past them; tracking them here
     * lets a shutdown close them and release the lock instead of orphaning it.
     * @type {Set<import("./database/drivers/base.js").default>} */
    _advisoryLockConnections: Set<import("./database/drivers/base.js").default>;
    /**
     * Runs current.
     * @returns {VelociousConfiguration} - The current.
     */
    static current(): VelociousConfiguration;
    /**
     * Runs constructor.
     * @param {import("./configuration-types.js").ConfigurationArgsType} args - Configuration arguments.
     */
    constructor({ abilityResolver, abilityResources, attachments, autoload, backgroundJobs, backendProjects, beacon, cookieSecret, cors, database, debug, debugEndpoint, apiManifest, directory, enforceTenantDatabaseScopes, environment, environmentHandler, exposeInternalErrorsToClients, frontendTenantSqlite, httpServer, initializeModels, initializers, locale, localeFallbacks, locales, logging, mailerBackend, packages, requestTimeoutMs, routeResolverHooks, scheduledBackgroundJobs, secureFrontendModelErrors, structureSql, sync, tenantDatabaseProviders, tenantDatabaseResolver, tenantResolver, testing, timeZone, timezoneOffsetMinutes, trustedProxies, websocketChannelResolver, websocketMessageHandlerResolver, ...restArgs }: import("./configuration-types.js").ConfigurationArgsType);
    /**
     * Runs get autoload.
     * @returns {boolean} Whether auto-batch-preload of relationships on lazy access is enabled globally.
     */
    getAutoload(): boolean;
    /**
     * Runs get expose internal errors to clients.
     * @returns {boolean} Whether unexpected internal error details may be returned to API clients.
     */
    getExposeInternalErrorsToClients(): boolean;
    /**
     * Returns whether frontend-model errors expose only explicitly safe messages.
     * @deprecated Use `getExposeInternalErrorsToClients()`.
     * @returns {boolean} Whether frontend-model internal error exposure is disabled.
     */
    getSecureFrontendModelErrors(): boolean;
    /**
     * Runs get debug endpoint.
     * @returns {{enabled: boolean, path: string, token: string | null}} - Debug endpoint configuration.
     */
    getDebugEndpoint(): {
        enabled: boolean;
        path: string;
        token: string | null;
    };
    /**
     * Runs debug endpoint snapshot.
     * @returns {{enabled: boolean, path: string, tokenConfigured: boolean}} - Debug endpoint config for the snapshot, with the token redacted.
     */
    _debugEndpointSnapshot(): {
        enabled: boolean;
        path: string;
        tokenConfigured: boolean;
    };
    /**
     * Runs normalize debug endpoint.
     * @param {boolean | {path?: string, token?: string}} value - Debug endpoint configuration.
     * @returns {{enabled: boolean, path: string, token: string | null}} - Normalized debug endpoint configuration.
     */
    _normalizeDebugEndpoint(value: boolean | {
        path?: string;
        token?: string;
    }): {
        enabled: boolean;
        path: string;
        token: string | null;
    };
    /**
     * Runs normalize api manifest.
     * @param {boolean | {path?: string, token?: string}} value - API manifest configuration.
     * @returns {{enabled: boolean, path: string, token: string | null}} - Normalized API manifest configuration.
     */
    _normalizeApiManifest(value: boolean | {
        path?: string;
        token?: string;
    }): {
        enabled: boolean;
        path: string;
        token: string | null;
    };
    /**
     * Runs add api manifest route hook.
     * @returns {void} - No return value.
     */
    _addApiManifestRouteHook(): void;
    /**
     * Runs add debug endpoint route hook.
     * @returns {void} - No return value.
     */
    _addDebugEndpointRouteHook(): void;
    /**
     * Runs set autoload.
     * @param {boolean} newValue - Whether auto-batch-preload of relationships is enabled.
     * @returns {void}
     */
    setAutoload(newValue: boolean): void;
    /**
     * Runs get cors.
     * @returns {import("./configuration-types.js").CorsType | undefined} - The cors.
     */
    getCors(): import("./configuration-types.js").CorsType | undefined;
    /**
     * Runs get http server compression.
     * @returns {import("./configuration-types.js").NormalizedHttpCompressionConfiguration} - Normalized buffered response compression configuration.
     */
    getHttpServerCompression(): import("./configuration-types.js").NormalizedHttpCompressionConfiguration;
    /**
     * Runs get cookie secret.
     * @returns {string | undefined} - Cookie secret.
     */
    getCookieSecret(): string | undefined;
    /**
     * Runs get sync configuration.
     * @returns {import("./configuration-types.js").VelociousSyncConfiguration} - Sync configuration.
     */
    getSyncConfiguration(): import("./configuration-types.js").VelociousSyncConfiguration;
    /**
     * Runs current offline grant signing key.
     * @returns {import("./sync/offline-grant.js").OfflineGrantSigningKey} - Current signing key.
     */
    currentOfflineGrantSigningKey(): import("./sync/offline-grant.js").OfflineGrantSigningKey;
    /**
     * Normalizes sync configuration.
     * @param {import("./configuration-types.js").VelociousSyncConfiguration | undefined} sync - Sync configuration.
     * @returns {import("./configuration-types.js").VelociousSyncConfiguration} - Normalized sync configuration.
     */
    _normalizeSyncConfiguration(sync: import("./configuration-types.js").VelociousSyncConfiguration | undefined): import("./configuration-types.js").VelociousSyncConfiguration;
    /**
     * Normalizes client-side sync configuration consumed by `SyncClient.fromConfiguration(...)`.
     * @param {import("./configuration-types.js").VelociousSyncClientConfiguration | undefined} client - Client-side sync configuration.
     * @returns {import("./configuration-types.js").VelociousSyncClientConfiguration | undefined} - Normalized client-side sync configuration.
     */
    _normalizeSyncClientConfiguration(client: import("./configuration-types.js").VelociousSyncClientConfiguration | undefined): import("./configuration-types.js").VelociousSyncClientConfiguration | undefined;
    /**
     * Normalizes sync API endpoint configuration.
     * @param {import("./configuration-types.js").VelociousSyncApiConfiguration | undefined} api - Sync API configuration.
     * @returns {import("./configuration-types.js").VelociousSyncApiConfiguration | undefined} - Normalized sync API configuration.
     */
    _normalizeSyncApiConfiguration(api: import("./configuration-types.js").VelociousSyncApiConfiguration | undefined): import("./configuration-types.js").VelociousSyncApiConfiguration | undefined;
    /**
     * Runs get database configuration.
     * @returns {Record<string, import("./configuration-types.js").DatabaseConfigurationType>} - The database configuration.
     */
    getDatabaseConfiguration(): Record<string, import("./configuration-types.js").DatabaseConfigurationType>;
    /**
     * Runs resolve database configuration.
     * @param {string} identifier - Identifier.
     * @param {ReturnType<typeof JSON.parse>} [tenant] - Tenant override.
     * @returns {import("./configuration-types.js").DatabaseConfigurationType} - Resolved database configuration for the identifier.
     */
    resolveDatabaseConfiguration(identifier: string, tenant?: ReturnType<typeof JSON.parse>): import("./configuration-types.js").DatabaseConfigurationType;
    /**
     * Runs get disabled database identifiers.
     * @returns {Set<string>} - Disabled database identifiers from env flags.
     */
    getDisabledDatabaseIdentifiers(): Set<string>;
    /**
     * Runs is database identifier active.
     * @param {string} identifier - Database identifier.
     * @param {ReturnType<typeof JSON.parse>} [tenant] - Tenant override.
     * @returns {boolean} - Whether this database identifier is active in the current tenant context.
     */
    isDatabaseIdentifierActive(identifier: string, tenant?: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Runs get database identifiers.
     * @returns {Array<string>} - The database identifiers.
     */
    getDatabaseIdentifiers(): Array<string>;
    /**
     * Runs get debug snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Human-readable server diagnostics.
     */
    getDebugSnapshot(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs get local debug snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Human-readable diagnostics for this process only.
     */
    getLocalDebugSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs debug http server snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - HTTP server worker diagnostics.
     */
    _debugHttpServerSnapshot(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs debug server snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Server runtime diagnostics.
     */
    _debugServerSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs debug configuration snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Configuration diagnostics.
     */
    _debugConfigurationSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs debug background jobs snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Background job diagnostics.
     */
    _debugBackgroundJobsSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs debug database snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Database diagnostics.
     */
    _debugDatabaseSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs debug websocket snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - WebSocket diagnostics.
     */
    _debugWebsocketSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs get database pool.
     * @param {string} identifier - Identifier.
     * @returns {import("./database/pool/base.js").default} - The database pool.
     */
    getDatabasePool(identifier?: string): import("./database/pool/base.js").default;
    /**
     * Returns the framework-owned frontend tenant SQLite lifecycle.
     * @returns {FrontendTenantSqliteLifecycle} - Lifecycle owner.
     */
    getFrontendTenantSqliteLifecycle(): FrontendTenantSqliteLifecycle;
    /**
     * Returns safe frontend tenant SQLite diagnostics.
     * @returns {ReturnType<FrontendTenantSqliteLifecycle["inspectAll"]>} - Lifecycle diagnostics.
     */
    inspectFrontendTenantSqliteHandles(): ReturnType<FrontendTenantSqliteLifecycle["inspectAll"]>;
    /**
     * Runs get database identifier.
     * @param {string} identifier - Identifier.
     * @returns {import("./configuration-types.js").DatabaseConfigurationType})
     */
    getDatabaseIdentifier(identifier: string): import("./configuration-types.js").DatabaseConfigurationType;
    /**
     * Clears the schema metadata cached by every initialized pool that targets the
     * same physical database (matched by connection reuse key). Separate pools that
     * point at one database keep independent schema caches, so DDL run through one
     * pool would otherwise leave the others reporting stale tables/columns.
     * @param {string} reuseKey - Connection reuse key identifying the shared database.
     * @returns {void} - No return value.
     */
    clearSchemaCachesForReuseKey(reuseKey: string): void;
    /**
     * Invalidates record metadata owned by one closed/deleted physical tenant
     * database while preserving every other tenant generation.
     * @param {string} databaseIdentity - Logical identifier plus pool reuse key.
     * @returns {void}
     */
    clearRecordMetadataForDatabaseIdentity(databaseIdentity: string): void;
    /**
     * Runs get database pool type.
     * @param {string} identifier - Identifier.
     * @returns {typeof import("./database/pool/base.js").default} - The database pool type.
     */
    getDatabasePoolType(identifier?: string): typeof import("./database/pool/base.js").default;
    getDatabaseType(identifier?: string): "mssql" | "mysql" | "pgsql" | "sqlite";
    /**
     * Runs get directory.
     * @returns {string} - The directory.
     */
    getDirectory(): string;
    /**
     * Runs get directory if available.
     * @returns {string | undefined} - The directory when the runtime can resolve one.
     */
    getDirectoryIfAvailable(): string | undefined;
    /**
     * Runs get backend projects.
     * @returns {import("./configuration-types.js").BackendProjectConfiguration[]} - Backend projects.
     */
    getBackendProjects(): import("./configuration-types.js").BackendProjectConfiguration[];
    /**
     * Runs get packages.
     * @returns {VelociousPackage[]} - Registered Velocious packages.
     */
    getPackages(): VelociousPackage[];
    /**
     * Runs get ability resources.
     * @returns {import("./configuration-types.js").AbilityResourceClassType[]} - Ability resource classes.
     */
    getAbilityResources(): import("./configuration-types.js").AbilityResourceClassType[];
    /**
     * Runs set ability resources.
     * @param {import("./configuration-types.js").AbilityResourceClassType[]} resources - Ability resource classes.
     * @returns {void} - No return value.
     */
    setAbilityResources(resources: import("./configuration-types.js").AbilityResourceClassType[]): void;
    /**
     * Merges resource classes discovered from the app and every registered package
     * into the ability-resources list. `autoDiscoverResources` populates each backend
     * project's `frontendModels` (including package projects), so this makes a
     * package-contributed model's abilities reach subscription and per-record
     * authorization automatically — consuming apps do not have to hand-register
     * package resources. Already-present classes (e.g. an app's explicitly-set
     * resources) are left untouched.
     * @returns {void} - No return value.
     */
    _mergeDiscoveredAbilityResources(): void;
    /**
     * Runs get ability resolver.
     * @returns {import("./configuration-types.js").AbilityResolverType | undefined} - Ability resolver.
     */
    getAbilityResolver(): import("./configuration-types.js").AbilityResolverType | undefined;
    /**
     * Runs get tenant resolver.
     * @returns {import("./configuration-types.js").TenantResolverType | undefined} - Tenant resolver.
     */
    getTenantResolver(): import("./configuration-types.js").TenantResolverType | undefined;
    /**
     * Runs get tenant database resolver.
     * @returns {import("./configuration-types.js").TenantDatabaseResolverType | undefined} - Tenant database resolver.
     */
    getTenantDatabaseResolver(): import("./configuration-types.js").TenantDatabaseResolverType | undefined;
    /**
     * Runs get enforce tenant database scopes.
     * @returns {boolean} - Whether tenant-switched models require a resolved tenant database identifier.
     */
    getEnforceTenantDatabaseScopes(): boolean;
    /**
     * Runs get tenant database providers.
     * @returns {Record<string, import("./configuration-types.js").TenantDatabaseProviderType>} - Tenant database lifecycle providers.
     */
    getTenantDatabaseProviders(): Record<string, import("./configuration-types.js").TenantDatabaseProviderType>;
    /**
     * Runs get tenant database provider.
     * @param {string} identifier - Database identifier.
     * @returns {import("./configuration-types.js").TenantDatabaseProviderType} - Tenant database lifecycle provider.
     */
    getTenantDatabaseProvider(identifier: string): import("./configuration-types.js").TenantDatabaseProviderType;
    /**
     * Runs get attachments configuration.
     * @returns {import("./configuration-types.js").AttachmentsConfiguration} - Attachments configuration.
     */
    getAttachmentsConfiguration(): import("./configuration-types.js").AttachmentsConfiguration;
    /**
     * Runs get route resolver hooks.
     * @returns {import("./configuration-types.js").RouteResolverHookType[]} - Route resolver hooks.
     */
    getRouteResolverHooks(): import("./configuration-types.js").RouteResolverHookType[];
    /**
     * Runs add route resolver hook.
     * @param {import("./configuration-types.js").RouteResolverHookType} hook - Route resolver hook.
     * @returns {void} - No return value.
     */
    addRouteResolverHook(hook: import("./configuration-types.js").RouteResolverHookType): void;
    /**
     * Runs set ability resolver.
     * @param {import("./configuration-types.js").AbilityResolverType | undefined} resolver - Ability resolver.
     * @returns {void} - No return value.
     */
    setAbilityResolver(resolver: import("./configuration-types.js").AbilityResolverType | undefined): void;
    /**
     * Runs set tenant resolver.
     * @param {import("./configuration-types.js").TenantResolverType | undefined} resolver - Tenant resolver.
     * @returns {void} - No return value.
     */
    setTenantResolver(resolver: import("./configuration-types.js").TenantResolverType | undefined): void;
    /**
     * Runs set tenant database resolver.
     * @param {import("./configuration-types.js").TenantDatabaseResolverType | undefined} resolver - Tenant database resolver.
     * @returns {void} - No return value.
     */
    setTenantDatabaseResolver(resolver: import("./configuration-types.js").TenantDatabaseResolverType | undefined): void;
    /**
     * Runs set enforce tenant database scopes.
     * @param {boolean} newValue - Whether tenant-switched models require a resolved tenant database identifier.
     * @returns {void} - No return value.
     */
    setEnforceTenantDatabaseScopes(newValue: boolean): void;
    /**
     * Runs set tenant database providers.
     * @param {Record<string, import("./configuration-types.js").TenantDatabaseProviderType>} providers - Tenant database lifecycle providers.
     * @returns {void} - No return value.
     */
    setTenantDatabaseProviders(providers: Record<string, import("./configuration-types.js").TenantDatabaseProviderType>): void;
    /**
     * Runs get environment.
     * @returns {string} - The environment.
     */
    getEnvironment(): string;
    /**
     * Runs get request timeout ms.
     * @returns {number} - Request timeout in seconds.
     */
    getRequestTimeoutMs(): number;
    /**
     * Runs parse request timeout seconds.
     * @param {string | undefined} rawValue - Env value.
     * @returns {number | undefined} - Timeout in seconds.
     */
    _parseRequestTimeoutSeconds(rawValue: string | undefined): number | undefined;
    /**
     * Runs set environment.
     * @param {string} newEnvironment - New environment.
     * @returns {void} - No return value.
     */
    setEnvironment(newEnvironment: string): void;
    /**
     * Runs get logging configuration.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.defaultConsole] - Whether default console.
     * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Pick<import("./configuration-types.js").LoggingConfiguration, "directory" | "filePath"> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>} - The logging configuration.
     */
    getLoggingConfiguration({ defaultConsole }?: {
        defaultConsole?: boolean;
    }): Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Pick<import("./configuration-types.js").LoggingConfiguration, "directory" | "filePath"> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>;
    /**
     * Gets the configuration-owned structured logging redactor.
     * @returns {LogRedactor} - Structured logging redactor.
     */
    getLogRedactor(): LogRedactor;
    /**
     * Runs get query logging enabled.
     * @returns {boolean} - Whether database query logging is enabled.
     */
    getQueryLoggingEnabled(): boolean;
    /**
     * Resolves generation lifecycle values from their raw config, environment,
     * and API sources before applying defaults. Derived defaults are deliberately
     * absent from the source list, so an API recovery state can override an
     * ID-only configuration without creating a false conflict.
     * @param {object} [args] - Explicit API values.
     * @param {string} [args.generationId] - Explicit generation identity.
     * @param {import("./background-jobs/types.js").BackgroundJobsGenerationInitialState} [args.initialGenerationState] - Explicit boot state.
     * @param {string} [args.lifecycleSocketPath] - Explicit lifecycle socket path.
     * @param {string} [args.sourceName] - Human-readable API owner.
     * @returns {{generationId: string | undefined, initialGenerationState: import("./background-jobs/types.js").BackgroundJobsGenerationInitialState | "active", lifecycleSocketPath: string | undefined}} - Resolved lifecycle configuration.
     */
    resolveBackgroundJobsGenerationConfig({ generationId: explicitGenerationId, initialGenerationState: explicitInitialGenerationState, lifecycleSocketPath: explicitLifecycleSocketPath, sourceName }?: {
        generationId?: string;
        initialGenerationState?: import("./background-jobs/types.js").BackgroundJobsGenerationInitialState;
        lifecycleSocketPath?: string;
        sourceName?: string;
    }): {
        generationId: string | undefined;
        initialGenerationState: import("./background-jobs/types.js").BackgroundJobsGenerationInitialState | "active";
        lifecycleSocketPath: string | undefined;
    };
    /**
     * Runs get background jobs config.
     * @returns {Omit<Required<import("./configuration-types.js").BackgroundJobsConfiguration>, "adapter" | "retention" | "generationId" | "lifecycleSocketPath"> & {generationId?: string, lifecycleSocketPath?: string, retention: import("./configuration-types.js").ResolvedBackgroundJobsRetentionConfiguration}} - Background jobs configuration.
     */
    getBackgroundJobsConfig(): Omit<Required<import("./configuration-types.js").BackgroundJobsConfiguration>, "adapter" | "retention" | "generationId" | "lifecycleSocketPath"> & {
        generationId?: string;
        lifecycleSocketPath?: string;
        retention: import("./configuration-types.js").ResolvedBackgroundJobsRetentionConfiguration;
    };
    /**
     * Returns statically registered portable background jobs.
     * @returns {import("./configuration-types.js").BackgroundJobClass[]} - Configured job classes.
     */
    getBackgroundJobClasses(): import("./configuration-types.js").BackgroundJobClass[];
    /**
     * Resolves and memoizes one background-jobs adapter for this configuration lifecycle.
     * @returns {BackgroundJobsAdapter} - Active adapter.
     */
    getBackgroundJobsAdapter(): BackgroundJobsAdapter;
    /**
     * Atomically acquires the exact ready adapter for the active lifecycle.
     * A close that claims the generation while readiness is pending wins: this
     * operation waits for that close, creates the next generation, readies it,
     * and returns only that live instance.
     * @returns {Promise<BackgroundJobsAdapter>} - Exact ready adapter generation.
     */
    acquireReadyBackgroundJobsAdapter(): Promise<BackgroundJobsAdapter>;
    /**
     * Readies the active adapter once per lifecycle. A failed attempt remains retryable.
     * @returns {Promise<void>} - Resolves when ready.
     */
    ensureBackgroundJobsAdapterReady(): Promise<void>;
    /**
     * Returns health without resolving persistence in non-durable inline mode.
     * @returns {Promise<import("./background-jobs/types.js").BackgroundJobsHealth>} - Current health.
     */
    backgroundJobsHealth(): Promise<import("./background-jobs/types.js").BackgroundJobsHealth>;
    /**
     * Closes the resolved adapter once and clears lifecycle caches.
     * @returns {Promise<void>} - Resolves after close.
     */
    closeBackgroundJobsAdapter(): Promise<void>;
    /**
     * Runs set background jobs config.
     * @param {import("./configuration-types.js").BackgroundJobsConfiguration} backgroundJobs - Background jobs config.
     * @returns {void}
     */
    setBackgroundJobsConfig(backgroundJobs: import("./configuration-types.js").BackgroundJobsConfiguration): void;
    /**
     * Resolves the active Beacon configuration. Beacon is opt-in: it
     * stays disabled unless the app passes `beacon: {host, port}` /
     * `beacon: {inProcess: true}`, calls `setBeaconConfig({...})`, or
     * sets the `VELOCIOUS_BEACON_HOST` / `VELOCIOUS_BEACON_PORT` env vars.
     * Setting `enabled: false` explicitly disables it even when env vars
     * are present (useful for tests). When `inProcess: true` is set,
     * env-var host/port are ignored — code-level config wins.
     * @returns {{enabled: boolean, host: string, port: number, peerType?: string, inProcess: boolean, unreachableReportMs: number}} - Beacon configuration with defaults applied.
     */
    getBeaconConfig(): {
        enabled: boolean;
        host: string;
        port: number;
        peerType?: string;
        inProcess: boolean;
        unreachableReportMs: number;
    };
    /**
     * Runs set beacon config.
     * @param {import("./configuration-types.js").BeaconConfiguration} beacon - Beacon config.
     * @returns {void}
     */
    setBeaconConfig(beacon: import("./configuration-types.js").BeaconConfiguration): void;
    /**
     * Runs get beacon client.
     * @returns {import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined} - The active Beacon client, if connected.
     */
    getBeaconClient(): import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined;
    /**
     * Connects this configuration's Beacon client to the configured
     * broker, wiring incoming broadcasts to the local delivery path so
     * any websocket subscribers in this process receive them. Idempotent
     * — repeat calls return the same in-flight or resolved promise.
     *
     * Returns immediately with `undefined` if Beacon is not enabled.
     *
     * **Non-blocking by design (TCP mode).** For broker-backed Beacon, the
     * returned promise resolves as soon as the client is constructed and
     * the TCP connect is launched — it does **not** wait for the connect
     * handshake to complete. A broker that silently drops SYNs
     * (firewall/NACL DROP rules) would otherwise block startup on the OS
     * TCP connect timeout (tens of seconds), which contradicts the
     * documented "fall back to local-only and reconnect in the
     * background" contract. Initial-connect failures surface
     * asynchronously on the framework-error channel via the
     * `connect-error` listener registered here. Callers that need a
     * deterministic publish-readiness boundary should call
     * `getBeaconClient()?.waitForReady({timeoutMs})`.
     *
     * **In-process mode** awaits `connect()` — that path is synchronous,
     * cannot fail, and gives callers predictable readiness.
     * @param {object} [args] - Options.
     * @param {string} [args.peerType] - Override peerType for this connect call (e.g. `"server"`, `"background-jobs-worker"`).
     * @returns {Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined>} - Resolves with the registered client (TCP mode: connect may still be in flight), or undefined when Beacon is disabled.
     */
    connectBeacon({ peerType }?: {
        peerType?: string;
    }): Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined>;
    /**
     * Builds a Beacon client matching the configured mode. Split out so
     * `connectBeacon` stays focused on lifecycle and error wiring.
     * @param {object} args - Options.
     * @param {ReturnType<VelociousConfiguration["getBeaconConfig"]>} args.config - Resolved Beacon config.
     * @param {string} [args.peerType] - Resolved peer type.
     * @returns {Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default>} - Beacon client.
     */
    _createBeaconClient({ config, peerType }: {
        config: ReturnType<VelociousConfiguration["getBeaconConfig"]>;
        peerType?: string;
    }): Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default>;
    /**
     * Records a Beacon connect/disconnect failure without reporting it immediately.
     * The BeaconClient auto-reconnects, so brief outages (e.g. a deploy restarting
     * the broker) are expected; only if the beacon is still unreachable after
     * `reportAfterMs` is a single framework-error surfaced via `_reportBeaconError`.
     * A subsequent `connect` (see `_handleBeaconUp`) cancels the pending report.
     * @param {object} args - Options.
     * @param {"beacon-connect" | "beacon-disconnect"} args.stage - Failure stage.
     * @param {Error} args.error - Error instance.
     * @param {number} args.reportAfterMs - Grace window before a sustained outage is reported.
     * @returns {void}
     */
    _handleBeaconDown({ stage, error, reportAfterMs }: {
        stage: "beacon-connect" | "beacon-disconnect";
        error: Error;
        reportAfterMs: number;
    }): void;
    /**
     * Clears beacon-down state on a (re)connect. A blip that recovers within the
     * grace window is never reported; if a sustained outage had already been
     * reported, the state resets so a future outage can report again.
     * @returns {void}
     */
    _handleBeaconUp(): void;
    /**
     * Surfaces a Beacon failure on the framework error channel. Mirrors
     * the pattern used by `request-runner.js` for HTTP errors. When no
     * listener is attached to either `framework-error` or `all-error`,
     * also schedules an unhandled promise rejection so process-level bug
     * reporters (which subscribe to `unhandledRejection` by default) pick
     * the failure up — and ALSO writes a one-line summary to `stderr` so
     * the failure isn't completely silent on Node 24+ where the default
     * behavior of `unhandledRejection` is to terminate the process. An
     * app that sees its server suddenly exit needs at least one
     * breadcrumb in the logs to know Beacon was the cause; the previous
     * behavior left a stack-only crash with no context tying it back to
     * the broker.
     * @param {object} args - Options.
     * @param {"beacon-connect" | "beacon-disconnect"} args.stage - Failure stage.
     * @param {Error} args.error - Error instance.
     * @returns {void}
     */
    _reportBeaconError({ stage, error }: {
        stage: "beacon-connect" | "beacon-disconnect";
        error: Error;
    }): void;
    /**
     * Closes the active Beacon client (if any). Safe to call multiple
     * times.
     * @returns {Promise<void>}
     */
    disconnectBeacon(): Promise<void>;
    /**
     * Routes a Beacon-sourced broadcast through the same delivery code
     * path as a locally-originated one. Prefers the workerthread-aware
     * `broadcastV2` when an HTTP server is hosting workers, and falls
     * back to the per-process subscription dispatch otherwise.
     * @param {import("./beacon/types.js").BeaconBroadcastMessage} message - Broadcast message.
     * @returns {void}
     */
    _deliverBroadcastFromBeacon(message: import("./beacon/types.js").BeaconBroadcastMessage): void;
    /**
     * Runs get scheduled background jobs config.
     * @returns {Promise<import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | undefined>} - Scheduled background jobs configuration.
     */
    getScheduledBackgroundJobsConfig(): Promise<import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | undefined>;
    /**
     * Runs set scheduled background jobs config.
     * @param {import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | import("./configuration-types.js").ScheduledBackgroundJobsLoaderType | undefined} scheduledBackgroundJobs - Scheduled background jobs configuration.
     * @returns {void}
     */
    setScheduledBackgroundJobsConfig(scheduledBackgroundJobs: import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | import("./configuration-types.js").ScheduledBackgroundJobsLoaderType | undefined): void;
    /**
     * Runs get mailer backend.
     * @returns {import("./configuration-types.js").MailerBackend | undefined} - Mailer backend.
     */
    getMailerBackend(): import("./configuration-types.js").MailerBackend | undefined;
    /**
     * Runs set mailer backend.
     * @param {import("./configuration-types.js").MailerBackend | undefined} mailerBackend - Mailer backend, or undefined to remove it.
     * @returns {void} - No return value.
     */
    setMailerBackend(mailerBackend: import("./configuration-types.js").MailerBackend | undefined): void;
    /**
     * Logging configuration tailored for HTTP request logging. Defaults console logging to true and applies the user `logging.console` flag only for request logging.
     * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Pick<import("./configuration-types.js").LoggingConfiguration, "directory" | "filePath"> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>} - The http logging configuration.
     */
    getHttpLoggingConfiguration(): Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Pick<import("./configuration-types.js").LoggingConfiguration, "directory" | "filePath"> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>;
    /**
     * Runs get environment handler.
     * @returns {import("./environment-handlers/base.js").default} - The environment handler.
     */
    getEnvironmentHandler(): import("./environment-handlers/base.js").default;
    /**
     * Runs get locale fallbacks.
     * @returns {import("./configuration-types.js").LocaleFallbacksType | undefined} - The locale fallbacks.
     */
    getLocaleFallbacks(): import("./configuration-types.js").LocaleFallbacksType | undefined;
    /**
     * Runs set locale fallbacks.
     * @param {import("./configuration-types.js").LocaleFallbacksType} newLocaleFallbacks - New locale fallbacks.
     * @returns {void} - No return value.
     */
    setLocaleFallbacks(newLocaleFallbacks: import("./configuration-types.js").LocaleFallbacksType): void;
    /**
     * Runs get structure sql config.
     * @returns {import("./configuration-types.js").StructureSqlConfiguration | undefined} - Structure SQL config.
     */
    getStructureSqlConfig(): import("./configuration-types.js").StructureSqlConfiguration | undefined;
    /**
     * Runs should write structure sql.
     * @param {{reason?: "migration" | "schemaDump"}} [args] - Call context for the structure sql write decision.
     * @returns {boolean} - Whether structure SQL files should be generated for the current environment.
     */
    shouldWriteStructureSql(args?: {
        reason?: "migration" | "schemaDump";
    }): boolean;
    /**
     * Runs set structure sql config.
     * @param {import("./configuration-types.js").StructureSqlConfiguration} structureSql - Structure SQL config.
     * @returns {void} - No return value.
     */
    setStructureSqlConfig(structureSql: import("./configuration-types.js").StructureSqlConfiguration): void;
    /**
     * Runs get locale.
     * @returns {string} - The locale.
     */
    getLocale(): string;
    /**
     * Runs get locales.
     * @returns {Array<string>} - The locales.
     */
    getLocales(): Array<string>;
    /**
     * Runs get model class.
     * @param {string} name - Name.
     * @returns {typeof import("./database/record/index.js").default} - The model class.
     */
    getModelClass(name: string): typeof import("./database/record/index.js").default;
    /**
     * Runs get model classes.
     * @returns {Record<string, typeof import("./database/record/index.js").default>} A hash of all model classes, keyed by model name, as they were defined in the configuration. This is a direct reference to the model classes, not a copy.
     */
    getModelClasses(): Record<string, typeof import("./database/record/index.js").default>;
    /**
     * Runs get testing.
     * @returns {string | undefined} The path to a config file that should be used for testing.
     */
    getTesting(): string | undefined;
    /**
     * Runs get trusted proxies.
     * @returns {string | string[] | undefined} Trusted reverse proxy address ranges.
     */
    getTrustedProxies(): string | string[] | undefined;
    /**
     * Runs set trusted proxies.
     * @param {string | string[] | undefined} trustedProxies - Trusted reverse proxy address ranges.
     * @returns {void}
     */
    setTrustedProxies(trustedProxies: string | string[] | undefined): void;
    /**
     * Runs initialize database pool.
     * @param {string} [identifier] - Database identifier to initialize.
     * @returns {void} - No return value.
     */
    initializeDatabasePool(identifier?: string): void;
    /**
     * Runs is database pool initialized.
     * @param {string} [identifier] - Database identifier to check.
     * @returns {boolean} - Whether database pool initialized.
     */
    isDatabasePoolInitialized(identifier?: string): boolean;
    /**
     * Runs is initialized.
     * @returns {boolean} - Whether initialized.
     */
    isInitialized(): boolean;
    /**
     * Runs initialize models.
     * @param {object} args - Options object.
     * @param {string} args.type - Type identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initializeModels(args?: {
        type: string;
    }): Promise<void>;
    /**
     * Ensures each configured database pool has a global connection available.
     * Useful when `getCurrentConnection` might be called without an async context.
     * @returns {Promise<void>} - Resolves when complete.
     */
    ensureGlobalConnections(): Promise<void>;
    /**
     * Runs initialize.
     * @param {object} args - Options object.
     * @param {string} args.type - Type identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initialize({ type }?: {
        type: string;
    }): Promise<void>;
    /**
     * Starts or joins initialization after lifecycle blockers have settled.
     * @param {object} args - Startup options.
     * @param {string} args.type - Generic application process type.
     * @returns {Promise<void>} - Shared startup promise.
     */
    _beginInitialize({ type }: {
        type: string;
    }): Promise<void>;
    /**
     * Queues one shared initialization behind an incompatible lifecycle phase.
     * @param {object} args - Queue options.
     * @param {boolean} args.continueAfterWaitFailure - Whether a completed failed shutdown still permits replacement startup.
     * @param {string} args.type - Replacement process type.
     * @param {Promise<void>} args.waitFor - Lifecycle phase that must settle first.
     * @returns {Promise<void>} - Shared queued startup promise.
     */
    _queueInitialize({ continueAfterWaitFailure, type, waitFor }: {
        continueAfterWaitFailure: boolean;
        type: string;
        waitFor: Promise<void>;
    }): Promise<void>;
    /**
     * Waits for a lifecycle phase before queued initialization proceeds.
     * @param {object} args - Wait policy.
     * @param {boolean} args.continueAfterWaitFailure - Whether replacement startup remains available after a failed phase.
     * @param {Promise<void>} args.waitFor - Lifecycle phase that must settle first.
     * @returns {Promise<void>} - Resolves when queued initialization may continue.
     */
    _waitForInitializeBlocker({ continueAfterWaitFailure, waitFor }: {
        continueAfterWaitFailure: boolean;
        waitFor: Promise<void>;
    }): Promise<void>;
    /**
     * Runs one atomic framework and application initialization attempt.
     * @param {object} args - Initialization identity.
     * @param {number} args.initializationGeneration - Framework model generation.
     * @param {string} args.type - Generic application process type.
     * @returns {Promise<void>} - Resolves when initialized.
     */
    _runInitialize({ initializationGeneration, type }: {
        initializationGeneration: number;
        type: string;
    }): Promise<void>;
    /**
     * Tears down every successfully started initializer in reverse order.
     * @returns {Promise<void>} - Resolves when every teardown succeeds.
     */
    _teardownSuccessfulInitializers(): Promise<void>;
    /** Clears application-owned lifecycle state after every teardown attempt. */
    _resetApplicationLifecycle(): void;
    /**
     * Tears down the current application lifecycle once.
     * @returns {Promise<void>} - Exact shared shutdown promise.
     */
    shutdown(): Promise<void>;
    /**
     * Validates that resource-defined relationships are also defined on the corresponding model classes.
     * Throws an error if a relationship is defined on a resource but missing from the model.
     * @returns {void}
     */
    _validateResourceRelationshipsOnModels(): void;
    /**
     * Runs register model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {void} - No return value.
     */
    registerModelClass(modelClass: typeof import("./database/record/index.js").default): void;
    /**
     * Runs set current.
     * @returns {void} - No return value.
     */
    setCurrent(): void;
    /**
     * Runs get routes.
     * @returns {import("./routes/index.js").default | undefined} - The routes.
     */
    getRoutes(): import("./routes/index.js").default | undefined;
    /**
     * Runs set routes.
     * @param {import("./routes/index.js").default} newRoutes - New routes.
     * @returns {void} - No return value.
     */
    setRoutes(newRoutes: import("./routes/index.js").default): void;
    /**
     * Applies any `route.mount(...)` registrations from the routes file by letting
     * each mountable register its routes (typically route-resolver hooks) against
     * this configuration. Guarded so repeated setRoutes calls with the same routes
     * don't register a mount more than once.
     * @param {import("./routes/index.js").default} newRoutes - Routes instance.
     * @returns {void} - No return value.
     */
    _applyRouteMounts(newRoutes: import("./routes/index.js").default): void;
    /**
     * Adds plugin/library routes using a lightweight route DSL backed by route resolver hooks.
     * @param {(routes: import("./routes/plugin-routes.js").default) => void} callback - Routes callback.
     * @returns {void} - No return value.
     */
    routes(callback: (routes: import("./routes/plugin-routes.js").default) => void): void;
    /**
     * Runs set translator.
     * @param {(arg1: string, arg2: Record<string, ReturnType<typeof JSON.parse>> | undefined) => string} callback - Translator callback.
     * @returns {void} - No return value.
     */
    setTranslator(callback: (arg1: string, arg2: Record<string, ReturnType<typeof JSON.parse>> | undefined) => string): void;
    /**
     * Runs default translator.
     * @param {string} msgID - Msg id.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args] - Translator options and variables.
     * @returns {string} - The default translator.
     */
    _defaultTranslator(msgID: string, args?: Record<string, ReturnType<typeof JSON.parse>>): string;
    /**
     * Runs get translator.
     * @returns {(msgID: string, args?: Record<string, ReturnType<typeof JSON.parse>>) => string} - The configured translator.
     */
    getTranslator(): (msgID: string, args?: Record<string, ReturnType<typeof JSON.parse>>) => string;
    /**
     * Runs configure default translator.
     * @returns {void} - Configure gettext defaults for this configuration.
     */
    _configureDefaultTranslator(): void;
    /**
     * Runs get timezone offset minutes.
     * @returns {number | undefined} - The timezone offset in minutes.
     */
    getTimezoneOffsetMinutes(): number | undefined;
    /**
     * Runs get time zone.
     * @returns {string | undefined} - Configured timezone identifier.
     */
    getTimeZone(): string | undefined;
    /**
     * Runs get websocket events.
     * @returns {import("./http-server/websocket-events.js").default | undefined} - The websocket events.
     */
    getWebsocketEvents(): import("./http-server/websocket-events.js").default | undefined;
    /**
     * Runs set websocket events.
     * @param {import("./http-server/websocket-events.js").default} websocketEvents - Websocket events.
     * @returns {void} - No return value.
     */
    setWebsocketEvents(websocketEvents: import("./http-server/websocket-events.js").default): void;
    /**
     * Per-process registry of channel subscribers used by worker code that
     * needs to react to events broadcast via `websocketEventsHost.publish(...)`
     * without holding an actual websocket session.
     * @returns {import("./http-server/websocket-channel-subscribers.js").default} - The channel subscribers registry.
     */
    getWebsocketChannelSubscribers(): import("./http-server/websocket-channel-subscribers.js").default;
    /**
     * Runs get websocket channel resolver.
     * @returns {import("./configuration-types.js").WebsocketChannelResolverType | undefined} - The websocket channel resolver.
     */
    getWebsocketChannelResolver(): import("./configuration-types.js").WebsocketChannelResolverType | undefined;
    /**
     * Registers a `VelociousWebsocketConnection` subclass under a name.
     * Clients that send `{type: "connection-open", connectionType: name}`
     * will have this class instantiated for their connection.
     * @param {string} name - Client-facing connection type name.
     * @param {typeof import("./http-server/websocket-connection.js").default} ConnectionClass - Websocket connection class.
     * @returns {void}
     */
    registerWebsocketConnection(name: string, ConnectionClass: typeof import("./http-server/websocket-connection.js").default): void;
    /**
     * Runs get websocket connection class.
     * @param {string} name - Connection type name to look up.
     * @returns {typeof import("./http-server/websocket-connection.js").default | undefined} - Registered websocket connection class.
     */
    getWebsocketConnectionClass(name: string): typeof import("./http-server/websocket-connection.js").default | undefined;
    /**
     * Registers a `VelociousWebsocketChannel` subclass under a name.
     * Clients subscribe via `{type: "channel-subscribe", channelType: name, ...}`.
     * @param {string} name - Client-facing channel type name.
     * @param {typeof import("./http-server/websocket-channel.js").default} ChannelClass - Websocket channel class.
     * @returns {void}
     */
    registerWebsocketChannel(name: string, ChannelClass: typeof import("./http-server/websocket-channel.js").default): void;
    /**
     * Runs get websocket channel class.
     * @param {string} name - Channel type name to look up.
     * @returns {typeof import("./http-server/websocket-channel.js").default | undefined} - Registered websocket channel class.
     */
    getWebsocketChannelClass(name: string): typeof import("./http-server/websocket-channel.js").default | undefined;
    /**
     * Tracks a live channel subscription in the global routing registry.
     * Called by the session when `canSubscribe()` resolves truthy; the
     * session calls `_unregisterWebsocketChannelSubscription` on unsubscribe.
     * @param {string} name - Channel type used as the routing key.
     * @param {import("./http-server/websocket-channel.js").default} subscription - Live channel subscription to register.
     * @returns {void}
     */
    _registerWebsocketChannelSubscription(name: string, subscription: import("./http-server/websocket-channel.js").default): void;
    /**
     * Runs unregister websocket channel subscription.
     * @param {string} name - Channel type used as the routing key.
     * @param {import("./http-server/websocket-channel.js").default} subscription - Live channel subscription to remove.
     * @returns {void}
     */
    _unregisterWebsocketChannelSubscription(name: string, subscription: import("./http-server/websocket-channel.js").default): void;
    /**
     * Delivers `body` to every live subscriber of `name` whose
     * `matches(broadcastParams)` returns true. Pure routing — no auth
     * re-check, no persistence. Subscribers who were admitted by
     * `canSubscribe()` continue to receive broadcasts until they
     * unsubscribe or the session ends.
     * @param {string} name
     * @param {Record<string, ReturnType<typeof JSON.parse>>} broadcastParams
     * @param {ReturnType<typeof JSON.parse>} body
     * @returns {void}
     */
    /**
     * Runs get websocket session grace seconds.
     * @returns {number} - Grace period (seconds) before a paused WS session is torn down.
     */
    getWebsocketSessionGraceSeconds(): number;
    /**
     * Runs get websocket session heartbeat seconds.
     * @returns {number} - Interval (seconds) between server→client heartbeat pings; 0 disables reaping.
     */
    getWebsocketSessionHeartbeatSeconds(): number;
    /**
     * Gets per-session WebSocket inbound message queue limits.
     * @returns {{maxBytes: number, maxMessages: number}} - Per-session inbound queue high-water marks.
     */
    getWebsocketInboundQueueLimits(): {
        maxBytes: number;
        maxMessages: number;
    };
    /**
     * Gets per-client WebSocket outbound queue limits.
     * @returns {{maxBytes: number, maxFrames: number}} - Per-client outbound queue high-water marks.
     */
    getWebsocketOutboundQueueLimits(): {
        maxBytes: number;
        maxFrames: number;
    };
    /**
     * Registers a wrapper invoked around every WS-borne request /
     * connection message / channel dispatch. The wrapper receives the
     * session and a `next` callback; it must call `next()` to run the
     * handler. Use it to set up AsyncLocalStorage per request.
     * @param {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null} wrapper - Per-message session-context wrapper, or null to disable it.
     * @returns {void}
     */
    setWebsocketAroundRequest(wrapper: ((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null): void;
    /**
     * Runs get websocket around request.
     * @returns {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null} - Websocket session wrapper.
     */
    getWebsocketAroundRequest(): ((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null;
    /**
     * Registers a wrapper invoked around every controller action — both
     * HTTP and WS-borne. Receives `{request, response, next}` and must
     * call `next()` to run the action. Use it for per-request context
     * like AsyncLocalStorage-scoped locale or tracing.
     * @param {((context: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default, next: () => Promise<void>}) => Promise<void>) | null} wrapper - Per-action request-context wrapper, or null to disable it.
     * @returns {void}
     */
    setAroundAction(wrapper: ((context: {
        request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default;
        response: import("./http-server/client/response.js").default;
        next: () => Promise<void>;
    }) => Promise<void>) | null): void;
    /**
     * Runs get around action.
     * @returns {((context: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default, next: () => Promise<void>}) => Promise<void>) | null} - HTTP request wrapper.
     */
    getAroundAction(): ((context: {
        request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default;
        response: import("./http-server/client/response.js").default;
        next: () => Promise<void>;
    }) => Promise<void>) | null;
    /**
     * Registers an identity resolver called once at pause time and once
     * at resume time. The resolver receives the session and returns any
     * value that identifies the authenticated caller — typically a
     * `userId` read from the session's upgrade-request cookie. Velocious
     * captures the pause-time value on the paused session and compares
     * it via `===` (or deep-equality for plain objects) to the fresh
     * resume-time value. If they differ, the resume is rejected with
     * `session-gone` and the paused session is destroyed so a signed-out
     * or re-authenticated client cannot reclaim another user's state.
     *
     * Return `null`/`undefined` to mean "no identity" — resumes still
     * succeed if pause and resume both resolve to a nullish value.
     * @param {((session: import("./http-server/client/websocket-session.js").default) => ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>) | null} resolver - Authenticated-caller identity resolver, or null to disable identity checks.
     * @returns {void}
     */
    setWebsocketSessionIdentityResolver(resolver: ((session: import("./http-server/client/websocket-session.js").default) => ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>) | null): void;
    /**
     * Runs get websocket session identity resolver.
     * @returns {((session: import("./http-server/client/websocket-session.js").default) => ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>) | null} - The configured identity resolver.
     */
    getWebsocketSessionIdentityResolver(): ((session: import("./http-server/client/websocket-session.js").default) => ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>) | null;
    /**
     * Runs set websocket session grace seconds.
     * @param {number} seconds - Grace period before a paused session expires.
     * @returns {void}
     */
    setWebsocketSessionGraceSeconds(seconds: number): void;
    /**
     * Runs set websocket session heartbeat seconds.
     * @param {number} seconds - Heartbeat interval, with zero disabling reaping.
     * @returns {void}
     */
    setWebsocketSessionHeartbeatSeconds(seconds: number): void;
    /**
     * Moves a session into the paused registry and starts the grace
     * timer. When the timer fires, the session's permanent teardown
     * hook is invoked. Called by the session itself from `_handleClose`
     * when there is resumable state (live Connections / Channel subs).
     * @param {import("./http-server/client/websocket-session.js").default} session - Resumable session to retain during its grace period.
     * @returns {void}
     */
    _pauseWebsocketSession(session: import("./http-server/client/websocket-session.js").default): void;
    /**
     * Looks up a paused session by id (does NOT remove it — caller is
     * expected to call `_resumeWebsocketSession` to complete the handoff).
     * @param {string} sessionId - Paused session identifier to look up.
     * @returns {import("./http-server/client/websocket-session.js").default | null} - Paused session with the requested identifier, if present.
     */
    _findPausedWebsocketSession(sessionId: string): import("./http-server/client/websocket-session.js").default | null;
    /**
     * Removes a paused session from the registry and cancels its grace
     * timer. Called on successful resume handoff and on explicit
     * expiry.
     * @param {string} sessionId - Paused session identifier to remove and cancel.
     * @returns {void}
     */
    _clearPausedWebsocketSession(sessionId: string): void;
    /**
     * Grace-timer callback. Calls the session's permanent-teardown
     * hook and drops it from the registry.
     * @param {string} sessionId - Paused session identifier whose grace period expired.
     * @returns {void}
     */
    _expireWebsocketSession(sessionId: string): void;
    /**
     * Runs broadcast to channel.
     * @param {string} name - Channel type receiving the broadcast.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} broadcastParams - Values used to match eligible subscriptions.
     * @param {ReturnType<typeof JSON.parse>} body - Broadcast payload delivered to matching subscriptions.
     * @returns {void}
     */
    broadcastToChannel(name: string, broadcastParams: Record<string, ReturnType<typeof JSON.parse>>, body: ReturnType<typeof JSON.parse>): void;
    /**
     * Awaits all pending broadcast operations (including event-log
     * persistence). Call this after `broadcastToChannel` when you need
     * the event to be persisted before continuing (e.g. before
     * responding to an HTTP request).
     * @returns {Promise<void>}
     */
    awaitPendingBroadcasts(): Promise<void>;
    /**
     * Local (per-worker) channel broadcast dispatch. Called either
     * directly (in-process mode) or by the worker thread after the
     * main-process fan-out.
     * @param {string} name - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} broadcastParams - Params passed to each subscription's `matches()`.
     * @param {ReturnType<typeof JSON.parse>} body - Message body delivered via `sendMessage()`.
     * @param {import("./http-server/websocket-channel.js").WebsocketBroadcastMetadata} [meta] - Optional event metadata for replay tracking.
     * @returns {void}
     */
    _broadcastToChannelLocal(name: string, broadcastParams: Record<string, ReturnType<typeof JSON.parse>>, body: ReturnType<typeof JSON.parse>, meta?: import("./http-server/websocket-channel.js").WebsocketBroadcastMetadata): void;
    /**
     * Awaits a snapshot of the in-flight local (per-process) websocket channel
     * broadcast deliveries. Called from `awaitPendingBroadcasts` after the host
     * publish queues drain, so every delivery those queues launched is captured.
     * New deliveries enqueued after the snapshot are not awaited. Individual
     * delivery errors are isolated per subscriber — the delivery chain already
     * logs them and resolves — so a snapshotted rejection never fails this barrier.
     * @returns {Promise<void>}
     */
    _awaitLocalBroadcastDeliveries(): Promise<void>;
    /**
     * Runs deliver websocket channel broadcast.
     * @param {import("./http-server/websocket-channel.js").default} subscription - Channel subscription.
     * @param {import("./http-server/websocket-channel.js").WebsocketJsonValue} body - Broadcast body.
     * @param {import("./http-server/websocket-channel.js").WebsocketBroadcastMetadata} meta - Broadcast metadata.
     * @returns {void | Promise<void>} Broadcast delivery result.
     */
    _deliverWebsocketChannelBroadcast(subscription: import("./http-server/websocket-channel.js").default, body: import("./http-server/websocket-channel.js").WebsocketJsonValue, meta: import("./http-server/websocket-channel.js").WebsocketBroadcastMetadata): void | Promise<void>;
    /**
     * Runs get websocket message handler resolver.
     * @returns {import("./configuration-types.js").WebsocketMessageHandlerResolverType | undefined} - The websocket message handler resolver.
     */
    getWebsocketMessageHandlerResolver(): import("./configuration-types.js").WebsocketMessageHandlerResolverType | undefined;
    /**
     * Runs set websocket channel resolver.
     * @param {import("./configuration-types.js").WebsocketChannelResolverType} resolver - Resolver.
     * @returns {void} - No return value.
     */
    setWebsocketChannelResolver(resolver: import("./configuration-types.js").WebsocketChannelResolverType): void;
    /**
     * Runs set websocket message handler resolver.
     * @param {import("./configuration-types.js").WebsocketMessageHandlerResolverType} resolver - Resolver.
     * @returns {void} - No return value.
     */
    setWebsocketMessageHandlerResolver(resolver: import("./configuration-types.js").WebsocketMessageHandlerResolverType): void;
    /**
     * Runs resolve ability.
     * @param {object} args - Ability resolver args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Request params.
     * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default} [args.request] - Request object. Absent for websocket channel subscriptions resolved from subscribe params.
     * @param {import("./http-server/client/response.js").default} [args.response] - Response object. Absent outside HTTP request handling.
     * @returns {Promise<import("./authorization/ability.js").default | undefined>} - Resolved ability.
     */
    resolveAbility({ params, request, response }: {
        params: Record<string, ReturnType<typeof JSON.parse>>;
        request?: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default;
        response?: import("./http-server/client/response.js").default;
    }): Promise<import("./authorization/ability.js").default | undefined>;
    /**
     * Runs run with ability.
     * @param {import("./authorization/ability.js").default | undefined} ability - Ability instance.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    runWithAbility(ability: import("./authorization/ability.js").default | undefined, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs run with request timing.
     * @param {import("./http-server/client/request-timing.js").default | undefined} requestTiming - Request timing collector.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    runWithRequestTiming(requestTiming: import("./http-server/client/request-timing.js").default | undefined, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Profiles an application-defined test activity when an opt-in test profile
     * context is active. The callback always runs, including outside profiling.
     * @template T
     * @param {string} name - Low-cardinality activity identifier.
     * @param {() => (T | Promise<T>)} callback - Activity callback.
     * @returns {Promise<T>} - Callback result.
     */
    profileTestActivity<T>(name: string, callback: () => (T | Promise<T>)): Promise<T>;
    /**
     * Runs run with timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    runWithTimezone(timeZone: string, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs get current ability.
     * @returns {import("./authorization/ability.js").default | undefined} - Current ability from context.
     */
    getCurrentAbility(): import("./authorization/ability.js").default | undefined;
    /**
     * Runs get current request timing.
     * @returns {import("./http-server/client/request-timing.js").default | undefined} - Current request timing collector.
     */
    getCurrentRequestTiming(): import("./http-server/client/request-timing.js").default | undefined;
    /**
     * Runs get current tenant.
     * @returns {ReturnType<typeof JSON.parse>} - Current tenant from context.
     */
    getCurrentTenant(): ReturnType<typeof JSON.parse>;
    /**
     * Runs run with tenant.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    runWithTenant(tenant: ReturnType<typeof JSON.parse>, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs resolve tenant.
     * @param {object} args - Tenant resolver args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Request params.
     * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined} args.request - Request object.
     * @param {import("./http-server/client/response.js").default | undefined} args.response - Response object.
     * @param {{channel: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} [args.subscription] - Subscription metadata.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolved tenant.
     */
    resolveTenant({ params, request, response, subscription }: {
        params: Record<string, ReturnType<typeof JSON.parse>>;
        request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined;
        response: import("./http-server/client/response.js").default | undefined;
        subscription?: {
            channel: string;
            params?: Record<string, ReturnType<typeof JSON.parse>>;
        };
    }): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs get error events.
     * @returns {import("eventemitter3").EventEmitter} - Framework error events emitter.
     */
    getErrorEvents(): import("eventemitter3").EventEmitter;
    /**
     * Registers a reporter that can add client-safe metadata to frontend-model error payloads.
     * @param {import("./configuration-types.js").ClientErrorPayloadReporterType} reporter - Reporter callback.
     * @returns {void}
     */
    addClientErrorPayloadReporter(reporter: import("./configuration-types.js").ClientErrorPayloadReporterType): void;
    /**
     * Runs registered client error payload reporters.
     * @param {{context: import("./configuration-types.js").ClientErrorPayloadContext, error: Error, request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined}} args - Reporter args.
     * @returns {Promise<import("./configuration-types.js").ClientErrorPayloadReporterPayload>} - Merged client-safe reporter payload.
     */
    clientErrorPayloadForError(args: {
        context: import("./configuration-types.js").ClientErrorPayloadContext;
        error: Error;
        request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined;
    }): Promise<import("./configuration-types.js").ClientErrorPayloadReporterPayload>;
    /**
     * Runs one test attempt in a revocable database-access context.
     * @template T
     * @param {{revoked: boolean}} scope - Attempt-owned access scope.
     * @param {() => T | Promise<T>} callback - Attempt work.
     * @returns {T | Promise<T>} - Callback result.
     */
    runWithTestDatabaseAccessScope<T>(scope: {
        revoked: boolean;
    }, callback: () => T | Promise<T>): T | Promise<T>;
    /**
     * Runs persistent framework work without inheriting a test attempt's revocable database-access scope.
     * @template T
     * @param {() => T | Promise<T>} callback - Persistent work to run.
     * @returns {Promise<T>} - Callback result.
     */
    withoutCurrentTestDatabaseAccessScope<T>(callback: () => T | Promise<T>): Promise<T>;
    /** Throws when a timed-out test attempt tries to start more database work. */
    assertDatabaseAccessAllowed(): void;
    /**
     * Runs with connections.
     * @template T
     * @param {WithConnectionsOptionsType | WithConnectionsCallbackType<T>} optionsOrCallback - Checkout options or callback function.
     * @param {WithConnectionsCallbackType<T>} [callback] - Callback function.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withConnections<T>(optionsOrCallback: WithConnectionsOptionsType | WithConnectionsCallbackType<T>, callback?: WithConnectionsCallbackType<T>): Promise<T>;
    /**
     * Runs explicit model work in a transaction pinned to one database connection.
     * @template T
     * @param {{databaseIdentifier: string, name?: string}} options - Operation options.
     * @param {(operation: DatabaseOperation) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withTransaction<T>({ databaseIdentifier, name, ...restArgs }: {
        databaseIdentifier: string;
        name?: string;
    }, callback: (operation: DatabaseOperation) => Promise<T>): Promise<T>;
    /**
     * Runs explicit model work on one connection selected from a captured physical
     * database configuration. No ambient tenant value is read during checkout or
     * execution.
     * @template T
     * @param {{databaseConfiguration: import("./configuration-types.js").DatabaseConfigurationType, databaseIdentifier: string, name?: string, schemaGeneration?: string, tenant?: object}} options - Captured operation options.
     * @param {(operation: DatabaseOperation) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Callback result.
     */
    withDatabaseOperation<T>({ databaseConfiguration, databaseIdentifier, name, schemaGeneration, tenant, ...restArgs }: {
        databaseConfiguration: import("./configuration-types.js").DatabaseConfigurationType;
        databaseIdentifier: string;
        name?: string;
        schemaGeneration?: string;
        tenant?: object;
    }, callback: (operation: DatabaseOperation) => Promise<T>): Promise<T>;
    /**
     * Runs callback with database connections for the requested identifiers.
     * @template T
     * @param {{callback: WithConnectionsCallbackType<T>, dbs: Record<string, import("./database/drivers/base.js").default>, identifiers: string[], name: string, stackLabel: string}} args - Connection scope details.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withDatabaseIdentifierConnections<T>({ callback, dbs, identifiers, name, stackLabel }: {
        callback: WithConnectionsCallbackType<T>;
        dbs: Record<string, import("./database/drivers/base.js").default>;
        identifiers: string[];
        name: string;
        stackLabel: string;
    }): Promise<T>;
    /**
     * Runs get current connections.
     * @param {string[]} [databaseIdentifiers] - Database identifiers to include.
     * @returns {Record<string, import("./database/drivers/base.js").default>} A map of database connections with identifier as key
     */
    getCurrentConnections(databaseIdentifiers?: string[]): Record<string, import("./database/drivers/base.js").default>;
    /**
     * Runs without current connection contexts.
     * @template T
     * @param {() => T} callback - Callback to run without inherited DB connection contexts.
     * @returns {T} - Callback result.
     */
    withoutCurrentConnectionContexts<T>(callback: () => T): T;
    /**
     * Runs a callback inside every pool's test shared connection context (a no-op for
     * pools without one). In-process request handling is wrapped in this so a request
     * runs on the same connection — and open transaction — as the test that issued it,
     * letting request specs clean up by rolling back instead of truncating. Outside
     * tests no shared connection is set, so this just runs the callback.
     * @template T
     * @param {() => T} callback - Callback to run inside the shared connection contexts.
     * @returns {T} - Callback result.
     */
    runWithTestSharedConnectionContexts<T>(callback: () => T): T;
    /**
     * Runs is missing current connection error.
     * @param {ReturnType<typeof JSON.parse>} error - Error thrown while looking up the current connection.
     * @returns {boolean} - Whether the error means no current connection is available.
     */
    isMissingCurrentConnectionError(error: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Runs ensure connections.
     * @template T
     * @param {WithConnectionsOptionsType | WithConnectionsCallbackType<T>} optionsOrCallback - Checkout options or callback function.
     * @param {WithConnectionsCallbackType<T>} [callback] - Callback function.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    ensureConnections<T>(optionsOrCallback: WithConnectionsOptionsType | WithConnectionsCallbackType<T>, callback?: WithConnectionsCallbackType<T>): Promise<T>;
    /**
     * Registers a dedicated connection that currently holds an advisory lock, so a
     * shutdown can close it and release the lock. See `_advisoryLockConnections`.
     * @param {import("./database/drivers/base.js").default} connection - The dedicated lock connection.
     * @returns {void}
     */
    registerAdvisoryLockConnection(connection: import("./database/drivers/base.js").default): void;
    /**
     * Unregisters a dedicated advisory-lock connection once its lock scope ends and the
     * connection has been (or is about to be) closed by its owner.
     * @param {import("./database/drivers/base.js").default} connection - The dedicated lock connection.
     * @returns {void}
     */
    unregisterAdvisoryLockConnection(connection: import("./database/drivers/base.js").default): void;
    /**
     * Closes every registered dedicated advisory-lock connection, ending its session so
     * the DB server releases the lock. Every connection is attempted before any failure
     * is surfaced, so one stuck close does not leave the others' locks held; a failure is
     * then thrown (never swallowed), aggregated when more than one connection failed.
     * @returns {Promise<void>} - Resolves once all have been closed; rejects if any failed.
     */
    _closeAdvisoryLockConnections(): Promise<void>;
    /**
     * Closes active database connections and clears global connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    closeDatabaseConnections(): Promise<void>;
    /**
     * Runs debug endpoint request authorized.
     * @param {{header: (name: string) => string | null | undefined}} request - Incoming request.
     * @param {string} expectedToken - Configured debug-endpoint token.
     * @returns {boolean} - Whether the request carries the expected bearer token.
     */
    debugEndpointRequestAuthorized(request: {
        header: (name: string) => string | null | undefined;
    }, expectedToken: string): boolean;
    /**
     * Runs get api manifest.
     * @returns {Promise<Record<string, unknown>>} - API manifest for all registered frontend-model resources.
     */
    getApiManifest(): Promise<Record<string, unknown>>;
    /**
     * Runs whether API manifest is enabled.
     * @returns {boolean} - Whether the API manifest endpoint is enabled.
     */
    _apiManifestEnabled(): boolean;
}
//# sourceMappingURL=configuration.d.ts.map