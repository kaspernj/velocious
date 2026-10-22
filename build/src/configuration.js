// @ts-check
/**
 * WithConnectionsCallbackType type.
 * @template T
 * @typedef {(arg: Record<string, import("./database/drivers/base.js").default>) => Promise<T>} WithConnectionsCallbackType
 */
/**
 * WithConnectionsOptionsType type.
 * @typedef {object} WithConnectionsOptionsType
 * @property {string[]} [databaseIdentifiers] - Database identifiers to include in the connection scope.
 * @property {string} [name] - Human-readable name for the checked-out database connections.
 */
/**
 * One adapter instance and its serialized ready/close lifecycle.
 * @typedef {object} BackgroundJobsAdapterGeneration
 * @property {import("./background-jobs/adapter.js").default} adapter - Adapter owned by this generation.
 * @property {boolean} closing - Whether close has claimed this generation.
 * @property {Promise<void> | undefined} readyPromise - Shared readiness attempt.
 * @property {Promise<void> | undefined} closePromise - Shared close operation.
 */
import { digg } from "diggerize";
import gettextConfig from "gettext-universal/build/src/config.js";
import UUID from "pure-uuid";
import translate from "gettext-universal/build/src/translate.js";
import Ability from "./authorization/ability.js";
import BackgroundJobsAdapter from "./background-jobs/adapter.js";
import { DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS } from "./background-jobs/scheduled-enqueue-bound.js";
import DatabaseOperation from "./database/operation.js";
import { initializeAuditedModelRelationships } from "./database/record/auditing.js";
import EventEmitter from "./utils/event-emitter.js";
import VelociousWebsocketChannelSubscribers from "./http-server/websocket-channel-subscribers.js";
import { CurrentConfigurationNotSetError, currentConfiguration, setCurrentConfiguration } from "./current-configuration.js";
import { requestDetails } from "./error-reporting/request-details.js";
import LogRedactor from "./log-redactor.js";
import { frontendModelApiManifest, frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition, frontendModelResourcesForBackendProject } from "./frontend-models/resource-definition.js";
import { currentOfflineGrantSigningKey, normalizeOfflineGrantSigningKey } from "./sync/offline-grant.js";
import PluginRoutes from "./routes/plugin-routes.js";
import restArgsError from "./utils/rest-args-error.js";
import { validateTestActivityName } from "./testing/test-profile-activity.js";
import { validateTimeZone } from "./time-zone.js";
import { withTrackedStack } from "./utils/with-tracked-stack.js";
import VelociousPackage from "./packages/velocious-package.js";
import FrontendTenantSqliteLifecycle from "./tenants/frontend-tenant-sqlite-lifecycle.js";
import { resolveGenerationId, resolveInitialGenerationState, resolveLifecycleSocketPath } from "./background-jobs/generation-identity.js";
import { runShutdownSteps } from "./utils/shutdown-lifecycle.js";
import { resolveAdvisoryLockBackendPolicy } from "./database/advisory-lock-backend-policy.js";
export { CurrentConfigurationNotSetError };
/**
 * Runs current working directory.
 * @returns {string | undefined} - Current working directory when the runtime exposes one.
 */
function currentWorkingDirectory() {
    const processObject = /** @type {{cwd?: ReturnType<typeof JSON.parse>} | undefined} */ (globalThis.process);
    if (typeof processObject?.cwd !== "function")
        return undefined;
    return processObject.cwd();
}
/**
 * Resolves the overloaded with/ensure connections arguments.
 * @template T
 * @param {WithConnectionsOptionsType | WithConnectionsCallbackType<T>} optionsOrCallback - Checkout options or callback function.
 * @param {WithConnectionsCallbackType<T> | undefined} callback - Callback function.
 * @param {string} defaultName - Default checkout name.
 * @returns {{databaseIdentifiers: string[] | undefined, name: string, callback: WithConnectionsCallbackType<T> | undefined}} Resolved checkout options and callback.
 */
function resolveWithConnectionsArgs(optionsOrCallback, callback, defaultName) {
    if (typeof optionsOrCallback == "function") {
        const actualCallback = /** @type {WithConnectionsCallbackType<T>} */ (optionsOrCallback);
        return { databaseIdentifiers: undefined, name: defaultName, callback: actualCallback };
    }
    return {
        databaseIdentifiers: optionsOrCallback.databaseIdentifiers,
        name: optionsOrCallback.name || defaultName,
        callback
    };
}
/**
 * Runs canonical debug snapshot value.
 * @param {ReturnType<typeof JSON.parse>} value - Snapshot value to canonicalize.
 * @returns {ReturnType<typeof JSON.parse>} Snapshot value with object keys sorted recursively.
 */
function canonicalDebugSnapshotValue(value) {
    if (!value || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map((entry) => canonicalDebugSnapshotValue(entry));
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = canonicalDebugSnapshotValue(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value)[key]);
        return result;
    }, /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({}));
}
/**
 * Runs merge database configuration.
 * @param {import("./configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Base database configuration.
 * @param {import("./configuration-types.js").DatabaseConfigurationType | Partial<import("./configuration-types.js").DatabaseConfigurationType> | void} overrideConfiguration - Tenant override configuration.
 * @returns {import("./configuration-types.js").DatabaseConfigurationType} - Merged database configuration.
 */
function mergeDatabaseConfiguration(databaseConfiguration, overrideConfiguration) {
    if (!overrideConfiguration)
        return databaseConfiguration;
    return {
        ...databaseConfiguration,
        ...overrideConfiguration,
        record: {
            ...(databaseConfiguration.record || {}),
            ...(overrideConfiguration.record || {})
        },
        sqlConfig: {
            ...(databaseConfiguration.sqlConfig || {}),
            ...(overrideConfiguration.sqlConfig || {})
        }
    };
}
/**
 * Resolves the grace window (ms) before a sustained beacon outage is reported.
 * @param {ReturnType<typeof JSON.parse>} value - Configured `unreachableReportMs`, if any.
 * @returns {number} - The configured value when it's a finite number, otherwise the 30s default.
 */
function resolveBeaconUnreachableReportMs(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    return 30_000;
}
const DEFAULT_WEBSOCKET_INBOUND_MAX_PENDING_BYTES = 16 * 1024 * 1024;
const DEFAULT_WEBSOCKET_INBOUND_MAX_PENDING_MESSAGES = 256;
const DEFAULT_WEBSOCKET_OUTBOUND_MAX_PENDING_BYTES = 16 * 1024 * 1024;
const DEFAULT_WEBSOCKET_OUTBOUND_MAX_PENDING_FRAMES = 256;
const DEFAULT_COMPRESSION_THRESHOLD = 1024;
const DEFAULT_COMPRESSION_BROTLI_QUALITY = 4;
const DEFAULT_COMPRESSION_GZIP_LEVEL = 6;
/**
 * Validates a positive safe integer configuration value.
 * @param {ReturnType<typeof JSON.parse>} value - Configured positive safe integer.
 * @param {string} name - Configuration key.
 * @param {number} defaultValue - Default value.
 * @returns {number} - Validated configured or default value.
 */
function positiveSafeInteger(value, name, defaultValue) {
    if (value === undefined)
        return defaultValue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive safe integer`);
    }
    return value;
}
/**
 * Validates an optional positive safe integer configuration value.
 * @param {ReturnType<typeof JSON.parse>} value - Configured positive safe integer.
 * @param {string} name - Configuration key.
 * @returns {number | undefined} - Validated configured value.
 */
function optionalPositiveSafeInteger(value, name) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive safe integer`);
    }
    return value;
}
/**
 * Validates an integer configuration value inside an inclusive range.
 * @param {ReturnType<typeof JSON.parse>} value - Configured integer.
 * @param {string} name - Configuration key.
 * @param {number} min - Minimum accepted value (inclusive).
 * @param {number} max - Maximum accepted value (inclusive).
 * @param {number} defaultValue - Default value.
 * @returns {number} - Validated configured or default value.
 */
function integerInRange(value, name, min, max, defaultValue) {
    if (value === undefined)
        return defaultValue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}
/**
 * Normalizes the buffered HTTP response compression configuration. Compression is
 * enabled by default when the setting is absent; `false` or `{enabled: false}`
 * disables it globally.
 * @param {boolean | import("./configuration-types.js").HttpCompressionConfiguration | undefined} value - Configured compression value.
 * @returns {import("./configuration-types.js").NormalizedHttpCompressionConfiguration} - Normalized compression configuration.
 */
function normalizeHttpCompression(value) {
    if (value === undefined || value === true) {
        return { enabled: true, threshold: DEFAULT_COMPRESSION_THRESHOLD, brotliQuality: DEFAULT_COMPRESSION_BROTLI_QUALITY, gzipLevel: DEFAULT_COMPRESSION_GZIP_LEVEL };
    }
    if (value === false) {
        return { enabled: false, threshold: DEFAULT_COMPRESSION_THRESHOLD, brotliQuality: DEFAULT_COMPRESSION_BROTLI_QUALITY, gzipLevel: DEFAULT_COMPRESSION_GZIP_LEVEL };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`httpServer.compression must be a boolean or an object, got: ${String(value)}`);
    }
    const { brotliQuality, enabled, gzipLevel, threshold, ...restCompression } = value;
    const restCompressionKeys = Object.keys(restCompression);
    if (restCompressionKeys.length > 0) {
        throw new TypeError(`httpServer.compression received unknown keys: ${restCompressionKeys.join(", ")} (supported: brotliQuality, enabled, gzipLevel, threshold)`);
    }
    if (enabled !== undefined && typeof enabled !== "boolean") {
        throw new TypeError(`httpServer.compression.enabled must be a boolean, got: ${String(enabled)}`);
    }
    return {
        enabled: enabled ?? true,
        threshold: positiveSafeInteger(threshold, "httpServer.compression.threshold", DEFAULT_COMPRESSION_THRESHOLD),
        brotliQuality: integerInRange(brotliQuality, "httpServer.compression.brotliQuality", 0, 11, DEFAULT_COMPRESSION_BROTLI_QUALITY),
        gzipLevel: integerInRange(gzipLevel, "httpServer.compression.gzipLevel", 0, 9, DEFAULT_COMPRESSION_GZIP_LEVEL)
    };
}
/**
 * Default request-body limit for the built-in MCP endpoint. JSON-RPC messages are small,
 * so the framework caps them instead of making every app that enables `mcp: true` restate
 * a request-body policy. Explicit `httpServer.maxRequestBodyBytes` or a resolver limit wins.
 * @type {number}
 */
const DEFAULT_MCP_MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export default class VelociousConfiguration {
    /**
     * Close database connections promise.
     * @type {Promise<void> | null} */
    _closeDatabaseConnectionsPromise = null;
    /** @type {BackgroundJobsAdapterGeneration | undefined} */
    _backgroundJobsAdapterGeneration = undefined;
    /**
     * Dedicated advisory-lock connections currently holding a lock. These are spawned
     * outside the pools' tracked sets (so a hold-timeout lock survives pool checkouts),
     * so `closeDatabaseConnections` would otherwise walk past them; tracking them here
     * lets a shutdown close them and release the lock instead of orphaning it.
     * @type {Set<import("./database/drivers/base.js").default>} */
    _advisoryLockConnections = new Set();
    /**
     * Lazily created file-tier advisory-lock backend (STC-213). Stays `undefined`
     * unless `advisoryLocks.backends.file.enabled: true` is explicitly configured —
     * the file tier is never auto-enabled, and a non-Node environment handler
     * (browser/Expo, no `fs`) cannot create one at all.
     * @type {import("./database/advisory-lock-file-backend.js").default | undefined} */
    _advisoryLockFileBackend = undefined;
    /**
     * Lazily created lock-server (tier (b)) backend; undefined when the tier is
     * not configured.
     * @type {import("./database/advisory-lock-lock-server-backend.js").default | undefined}
     */
    _advisoryLockLockServerBackend = undefined;
    /**
     * Most recent advisory-lock acquisition per lock name — the "which backend
     * served this lock" surface (design §3).
     * @type {Map<string, {backend: import("./database/advisory-lock-backend-policy.js").AdvisoryLockTier, fencingSupported: boolean, servedAt: string}>} */
    _advisoryLockAcquisitions = new Map();
    /** @type {Map<string, number>} */
    _schemaCacheGenerationsByReuseKey = new Map();
    /**
     * Runs current.
     * @returns {VelociousConfiguration} - The current.
     */
    static current() {
        return currentConfiguration();
    }
    /**
     * Runs constructor.
     * @param {import("./configuration-types.js").ConfigurationArgsType} args - Configuration arguments.
     */
    constructor({ abilityResolver, abilityResources, advisoryLocks, attachments, autoload = true, backgroundJobs, backendProjects, beacon, cookieSecret, cors, database, debug = false, debugEndpoint = false, apiManifest = false, directory, enforceTenantDatabaseScopes = true, environment, environmentHandler, exposeInternalErrorsToClients, frontendTenantSqlite, httpServer, initializeModels, initializers, locale, localeFallbacks, locales, logging, mailerBackend, mcp = false, packages, requestTimeoutMs, routeResolverHooks, scheduledBackgroundJobs, secureFrontendModelErrors, structureSql, sync, tenantDatabaseProviders, tenantDatabaseResolver, tenantResolver, testTenantPools, testing, timeZone, timezoneOffsetMinutes, trustedProxies, websocketChannelResolver, websocketMessageHandlerResolver, ...restArgs }) {
        restArgsError(restArgs);
        this._abilityResolver = abilityResolver;
        this._abilityResources = abilityResources || [];
        this._advisoryLocks = advisoryLocks;
        this._autoload = autoload;
        this._backgroundJobs = backgroundJobs;
        this._beacon = beacon;
        /**
         * Stores the beacon client value.
         * @type {import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined} */
        this._beaconClient = undefined;
        /**
         * Stores the beacon connect promise value.
         * @type {Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined> | undefined} */
        this._beaconConnectPromise = undefined;
        /**
         * Stores the beacon report timer value.
         * @type {ReturnType<typeof setTimeout> | undefined} - Pending "beacon still unreachable" report timer.
         */
        this._beaconReportTimer = undefined;
        /**
         * Stores the beacon outage reported value.
         * @type {boolean} - Whether the current beacon outage has already been reported.
         */
        this._beaconOutageReported = false;
        /**
         * Stores the beacon last down error value.
         * @type {{stage: "beacon-connect" | "beacon-disconnect", error: Error} | undefined} - Latest beacon-down details, reported only if the outage is sustained.
         */
        this._beaconLastDownError = undefined;
        this._scheduledBackgroundJobs = scheduledBackgroundJobs;
        this._attachments = attachments || {};
        // Copy so appending package-derived entries below never mutates a caller's
        // shared array (config modules commonly export a reused backendProjects array).
        this._backendProjects = backendProjects ? [...backendProjects] : [];
        /** @type {import("./configuration-types.js").ClientErrorPayloadReporterType[]} */
        this._clientErrorPayloadReporters = [];
        this.cors = cors;
        this._cookieSecret = cookieSecret;
        this.database = database;
        this.debug = debug;
        this._debugEndpoint = this._normalizeDebugEndpoint(debugEndpoint);
        this._apiManifest = this._normalizeApiManifest(apiManifest);
        this._mcp = this._normalizeMcp(mcp);
        this._environment = environment || globalThis.process?.env.VELOCIOUS_ENV || globalThis.process?.env.NODE_ENV || "development";
        this._environmentHandler = environmentHandler;
        this._enforceTenantDatabaseScopes = enforceTenantDatabaseScopes;
        this._exposeInternalErrorsToClients = exposeInternalErrorsToClients === undefined
            ? secureFrontendModelErrors !== true
            : exposeInternalErrorsToClients;
        this._directory = directory;
        this._initializeModels = initializeModels;
        /** @type {VelociousPackage[]} */
        this._packages = (packages || []).map((entry) => VelociousPackage.from(entry));
        // Append a derived backend-project per package so the existing resource
        // discovery + frontend-model generation machinery includes it. Package
        // frontend models are generated into the app's frontend-models output.
        const appFrontendModelsOutputPath = this._backendProjects[0]?.frontendModelsOutputPath;
        for (const velociousPackage of this._packages) {
            this._backendProjects.push(velociousPackage.toBackendProjectConfiguration({ frontendModelsOutputPath: appFrontendModelsOutputPath }));
        }
        this._isInitialized = false;
        /** @type {import("./configuration-types.js").ApplicationProcessContext | undefined} */
        this._applicationProcessContext = undefined;
        /** @type {import("./initializer.js").default[]} */
        this._successfulInitializers = [];
        /** @type {boolean} */
        this._applicationLifecycleInitialized = false;
        /** @type {Promise<void> | undefined} */
        this._shutdownPromise = undefined;
        /** @type {Promise<void> | undefined} */
        this._queuedInitializePromise = undefined;
        this._modelsInitialized = false;
        /**
         * Invalidates model phases that started before database connections closed.
         * @type {number}
         */
        this._modelInitializationGeneration = 0;
        /**
         * In-progress `initializeModels()` promise. Model initialization is an
         * atomic bootstrap phase: concurrent callers share it, and a rejection
         * leaves the phase eligible for a later complete attempt.
         * @type {Promise<void> | undefined}
         */
        this._initializeModelsPromise = undefined;
        /**
         * Current `initialize()` promise, memoized so concurrent callers await the
         * same bootstrap. Retained across a connection close until stale bootstrap
         * work settles, then cleared by identity before the new generation retries.
         * @type {Promise<void> | undefined}
         */
        this._initializePromise = undefined;
        /** @type {number | undefined} */
        this._initializePromiseGeneration = undefined;
        const requestBodyPolicyResolver = httpServer?.requestBodyPolicyResolver;
        const websocketInboundQueue = httpServer?.websocketInboundQueue;
        const websocketOutboundQueue = httpServer?.websocketOutboundQueue;
        if (requestBodyPolicyResolver !== undefined && typeof requestBodyPolicyResolver !== "function") {
            throw new TypeError("httpServer.requestBodyPolicyResolver must be a function");
        }
        this.httpServer = {
            ...(httpServer || {}),
            compression: normalizeHttpCompression(httpServer?.compression),
            maxBufferedResponseBodyBytes: optionalPositiveSafeInteger(httpServer?.maxBufferedResponseBodyBytes, "httpServer.maxBufferedResponseBodyBytes"),
            maxRequestBodyBytes: optionalPositiveSafeInteger(httpServer?.maxRequestBodyBytes, "httpServer.maxRequestBodyBytes"),
            requestBodyPolicyResolver,
            websocketInboundQueue: {
                maxPendingBytes: positiveSafeInteger(websocketInboundQueue?.maxPendingBytes, "httpServer.websocketInboundQueue.maxPendingBytes", DEFAULT_WEBSOCKET_INBOUND_MAX_PENDING_BYTES),
                maxPendingMessages: positiveSafeInteger(websocketInboundQueue?.maxPendingMessages, "httpServer.websocketInboundQueue.maxPendingMessages", DEFAULT_WEBSOCKET_INBOUND_MAX_PENDING_MESSAGES)
            },
            websocketOutboundQueue: {
                maxPendingBytes: positiveSafeInteger(websocketOutboundQueue?.maxPendingBytes, "httpServer.websocketOutboundQueue.maxPendingBytes", DEFAULT_WEBSOCKET_OUTBOUND_MAX_PENDING_BYTES),
                maxPendingFrames: positiveSafeInteger(websocketOutboundQueue?.maxPendingFrames, "httpServer.websocketOutboundQueue.maxPendingFrames", DEFAULT_WEBSOCKET_OUTBOUND_MAX_PENDING_FRAMES)
            }
        };
        /**
         * Stores the http server instance value.
         * @type {{getDebugSnapshot: () => Promise<Record<string, ReturnType<typeof JSON.parse>>>} | undefined} */
        this._httpServerInstance = undefined;
        this.locale = locale;
        this.localeFallbacks = localeFallbacks;
        this.locales = locales;
        this._initializers = initializers;
        this._testing = testing;
        this._timeZone = timeZone;
        this._timezoneOffsetMinutes = timezoneOffsetMinutes;
        this._trustedProxies = trustedProxies;
        this._requestTimeoutMs = requestTimeoutMs;
        this._structureSql = structureSql;
        this._sync = this._normalizeSyncConfiguration(sync);
        this._tenantDatabaseProviders = tenantDatabaseProviders || {};
        this._tenantDatabaseResolver = tenantDatabaseResolver;
        this._tenantResolver = tenantResolver;
        this._testTenantPools = testTenantPools;
        this._websocketEvents = undefined;
        /**
         * Stores the websocket channel subscribers value.
         * @type {VelociousWebsocketChannelSubscribers | undefined} */
        this._websocketChannelSubscribers = undefined;
        this._websocketChannelResolver = websocketChannelResolver;
        this._websocketMessageHandlerResolver = websocketMessageHandlerResolver;
        /**
         * Stores the websocket connection classes value.
         * @type {Map<string, typeof import("./http-server/websocket-connection.js").default>} */
        this._websocketConnectionClasses = new Map();
        /**
         * Stores the websocket channel classes value.
         * @type {Map<string, typeof import("./http-server/websocket-channel.js").default>} */
        this._websocketChannelClasses = new Map();
        /**
         * Channel types registered with `{liveOnly: true}`: their traffic is
         * never persisted for replay, and `markChannelInterested` rejects the
         * name.
         * @type {Set<string>} */
        this._liveOnlyWebsocketChannels = new Set();
        /**
         * Stores the websocket channel subscriptions value.
         * @type {Map<string, Set<import("./http-server/websocket-channel.js").default>>} - channelType → live subscriptions across all sessions.
         */
        this._websocketChannelSubscriptions = new Map();
        /**
         * In-flight local (per-process) websocket channel broadcast deliveries,
         * launched fire-and-forget from `_broadcastToChannelLocal` so one slow
         * subscriber never blocks another. Tracked here so
         * `awaitPendingBroadcasts` can snapshot and drain them before settling.
         * Settled deliveries are removed by the tracking-level cleanup.
         * @type {Set<Promise<void>>} */
        this._localBroadcastDeliveries = new Set();
        /**
         * Latest local broadcast delivery per subscription. Chaining subsequent
         * deliveries preserves lifecycle event order without coupling separate
         * subscribers to one another.
         * @type {WeakMap<import("./http-server/websocket-channel.js").default, Promise<void>>} */
        this._localBroadcastDeliveryTails = new WeakMap();
        /**
         * Stores the websocket sessions value.
         * @type {Set<import("./http-server/client/websocket-session.js").default>} - Live websocket sessions, including paused sessions within the grace window.
         */
        this._websocketSessions = new Set();
        /**
         * Stores the paused websocket sessions value.
         * @type {Map<string, {session: import("./http-server/client/websocket-session.js").default, graceTimer: ReturnType<typeof setTimeout>, pausedAt: number}>} - sessionId → paused session awaiting resume.
         */
        this._pausedWebsocketSessions = new Map();
        /** Grace period for paused WebSocket sessions before permanent teardown. */
        this._websocketSessionGraceSeconds = 300;
        /** Interval (seconds) between server→client heartbeat pings; 0 disables reaping of silent sockets. */
        this._websocketSessionHeartbeatSeconds = 30;
        /**
         * Optional wrapper called around every WebSocket-borne request /
         * connection message / channel dispatch. Apps register it here
         * to set up per-request context (e.g. AsyncLocalStorage for
         * locale, tenant, tracing) that downstream handlers read.
         * @type {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null}
         */
        this._websocketAroundRequest = null;
        /**
         * Stores the around action value.
         * @type {((context: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default, next: () => Promise<void>}) => Promise<void>) | null} */
        this._aroundAction = null;
        /**
         * Stores the websocket session identity resolver value.
         * @type {((session: import("./http-server/client/websocket-session.js").default) => ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>) | null} */
        this._websocketSessionIdentityResolver = null;
        this._logging = logging;
        this._logRedactor = new LogRedactor({ sensitiveNames: logging?.sensitiveNames });
        this._mailerBackend = mailerBackend;
        this._routeResolverHooks = [...(routeResolverHooks || [])];
        this._addDebugEndpointRouteHook();
        this._addApiManifestRouteHook();
        this._addMcpRouteHook();
        /**
         * Stores the applied route mounts value.
         * @type {WeakSet<object>} */
        this._appliedRouteMounts = new WeakSet();
        this._errorEvents = new EventEmitter();
        this._telemetryEvents = new EventEmitter();
        /**
         * Stores the database pools value.
         * @type {{[key: string]: import("./database/pool/base.js").default}} */
        this.databasePools = {};
        this._frontendTenantSqliteLifecycle = new FrontendTenantSqliteLifecycle({ configuration: this, maxOpenHandles: frontendTenantSqlite?.maxOpenHandles });
        /**
         * Stores the model classes value.
         * @type {{[key: string]: typeof import("./database/record/index.js").default}} */
        this.modelClasses = {};
        this.getEnvironmentHandler().setConfiguration(this);
    }
    /**
     * Runs get autoload.
     * @returns {boolean} Whether auto-batch-preload of relationships on lazy access is enabled globally.
     */
    getAutoload() { return this._autoload; }
    /**
     * Runs get expose internal errors to clients.
     * @returns {boolean} Whether unexpected internal error details may be returned to API clients.
     */
    getExposeInternalErrorsToClients() { return this._exposeInternalErrorsToClients === true; }
    /**
     * Returns whether frontend-model errors expose only explicitly safe messages.
     * @deprecated Use `getExposeInternalErrorsToClients()`.
     * @returns {boolean} Whether frontend-model internal error exposure is disabled.
     */
    getSecureFrontendModelErrors() { return !this.getExposeInternalErrorsToClients(); }
    /**
     * Runs get debug endpoint.
     * @returns {{enabled: boolean, path: string, token: string | null}} - Debug endpoint configuration.
     */
    getDebugEndpoint() { return this._debugEndpoint; }
    /**
     * Runs debug endpoint snapshot.
     * @returns {{enabled: boolean, path: string, tokenConfigured: boolean}} - Debug endpoint config for the snapshot, with the token redacted.
     */
    _debugEndpointSnapshot() {
        return {
            enabled: this._debugEndpoint.enabled,
            path: this._debugEndpoint.path,
            tokenConfigured: Boolean(this._debugEndpoint.token)
        };
    }
    /**
     * Runs normalize debug endpoint.
     * @param {boolean | {path?: string, token?: string}} value - Debug endpoint configuration.
     * @returns {{enabled: boolean, path: string, token: string | null}} - Normalized debug endpoint configuration.
     */
    _normalizeDebugEndpoint(value) {
        if (value === false || value === undefined)
            return { enabled: false, path: "/velocious/debug", token: null };
        if (value === true)
            return { enabled: true, path: "/velocious/debug", token: null };
        if (typeof value !== "object" || value === null) {
            throw new Error(`Expected debugEndpoint to be a boolean or object, got: ${String(value)}`);
        }
        const path = value.path || "/velocious/debug";
        if (typeof path !== "string" || !path.startsWith("/")) {
            throw new Error(`Expected debugEndpoint.path to be a string starting with '/', got: ${String(path)}`);
        }
        const token = value.token === undefined || value.token === null ? null : value.token;
        if (token !== null && (typeof token !== "string" || !token.trim())) {
            throw new Error(`Expected debugEndpoint.token to be a non-empty string, got: ${String(token)}`);
        }
        return { enabled: true, path, token: token === null ? null : token.trim() };
    }
    /**
     * Runs normalize api manifest.
     * @param {boolean | {path?: string, token?: string}} value - API manifest configuration.
     * @returns {{enabled: boolean, path: string, token: string | null}} - Normalized API manifest configuration.
     */
    _normalizeApiManifest(value) {
        if (value === false || value === undefined)
            return { enabled: false, path: "/api/manifest", token: null };
        if (value === true)
            return { enabled: true, path: "/api/manifest", token: null };
        if (typeof value !== "object" || value === null) {
            throw new Error(`Expected apiManifest to be a boolean or object, got: ${String(value)}`);
        }
        const path = value.path || "/api/manifest";
        if (typeof path !== "string" || !path.startsWith("/")) {
            throw new Error(`Expected apiManifest.path to be a string starting with '/', got: ${String(path)}`);
        }
        const token = value.token === undefined || value.token === null ? null : value.token;
        if (token !== null && (typeof token !== "string" || !token.trim())) {
            throw new Error(`Expected apiManifest.token to be a non-empty string, got: ${String(token)}`);
        }
        return { enabled: true, path, token: token === null ? null : token.trim() };
    }
    /**
     * Runs add api manifest route hook.
     * @returns {void} - No return value.
     */
    _addApiManifestRouteHook() {
        if (!this._apiManifest.enabled)
            return;
        this.addRouteResolverHook(({ currentPath, request }) => {
            if (request.httpMethod() !== "GET")
                return null;
            if (currentPath !== this._apiManifest.path)
                return null;
            if (this._apiManifest.token && !this.debugEndpointRequestAuthorized(request, this._apiManifest.token))
                return null;
            return {
                action: "show",
                controller: "velociousApiManifest",
                controllerPath: "./built-in/api-manifest/controller.js",
                skipControllerConnections: true,
                skipAbilityResolution: true,
                skipTenantResolution: true,
                viewPath: "./built-in/api-manifest"
            };
        });
    }
    /**
     * Runs normalize mcp.
     * @param {boolean | {path?: string, token?: string}} value - MCP endpoint configuration.
     * @returns {{enabled: boolean, path: string, token: string | null}} - Normalized MCP endpoint configuration.
     */
    _normalizeMcp(value) {
        if (value === false || value === undefined)
            return { enabled: false, path: "/mcp", token: null };
        if (value === true)
            return { enabled: true, path: "/mcp", token: null };
        if (typeof value !== "object" || value === null) {
            throw new Error(`Expected mcp to be a boolean or object, got: ${String(value)}`);
        }
        const path = value.path || "/mcp";
        if (typeof path !== "string" || !path.startsWith("/")) {
            throw new Error(`Expected mcp.path to be a string starting with '/', got: ${String(path)}`);
        }
        const token = value.token === undefined || value.token === null ? null : value.token;
        if (token !== null && (typeof token !== "string" || !token.trim())) {
            throw new Error(`Expected mcp.token to be a non-empty string, got: ${String(token)}`);
        }
        return { enabled: true, path, token: token === null ? null : token.trim() };
    }
    /**
     * Runs add mcp route hook.
     * @returns {void} - No return value.
     */
    _addMcpRouteHook() {
        if (!this._mcp.enabled)
            return;
        this.addRouteResolverHook(({ currentPath, request }) => {
            if (request.httpMethod() !== "POST")
                return null;
            if (currentPath !== this._mcp.path)
                return null;
            // When a token is configured, an unauthenticated request gets no route at
            // all (404) rather than a 401, so the endpoint's existence stays hidden.
            if (this._mcp.token && !this.debugEndpointRequestAuthorized(request, this._mcp.token))
                return null;
            return {
                action: "handle",
                controller: "velociousMcp",
                controllerPath: "./built-in/mcp/controller.js",
                // Tenant and ability resolution belong to the frontend-model dispatcher
                // per command (withFrontendModelRequestContext), exactly like the regular
                // /frontend-models route — the MCP transport never bypasses them.
                skipAbilityResolution: true,
                skipTenantResolution: true,
                viewPath: "./built-in/mcp"
            };
        });
    }
    /**
     * Runs add debug endpoint route hook.
     * @returns {void} - No return value.
     */
    _addDebugEndpointRouteHook() {
        if (!this._debugEndpoint.enabled)
            return;
        this.addRouteResolverHook(({ currentPath, request }) => {
            if (request.httpMethod() !== "GET")
                return null;
            if (currentPath !== this._debugEndpoint.path)
                return null;
            // When a token is configured, an unauthenticated request gets no route at
            // all (404) rather than a 401, so the endpoint's existence stays hidden.
            if (this._debugEndpoint.token && !this.debugEndpointRequestAuthorized(request, this._debugEndpoint.token))
                return null;
            return {
                action: "show",
                controller: "velociousDebug",
                controllerPath: "./built-in/debug/controller.js",
                skipControllerConnections: true,
                skipAbilityResolution: true,
                skipTenantResolution: true,
                viewPath: "./built-in/debug"
            };
        });
    }
    /**
     * Runs set autoload.
     * @param {boolean} newValue - Whether auto-batch-preload of relationships is enabled.
     * @returns {void}
     */
    setAutoload(newValue) { this._autoload = newValue; }
    /**
     * Runs get cors.
     * @returns {import("./configuration-types.js").CorsType | undefined} - The cors.
     */
    getCors() {
        return this.cors;
    }
    /**
     * Runs get http server compression.
     * @returns {import("./configuration-types.js").NormalizedHttpCompressionConfiguration} - Normalized buffered response compression configuration.
     */
    getHttpServerCompression() {
        return this.httpServer.compression;
    }
    /**
     * Runs get maximum buffered response body bytes.
     * @returns {number | undefined} - Configured byte limit, or undefined when unbounded.
     */
    getHttpServerMaxBufferedResponseBodyBytes() {
        return this.httpServer.maxBufferedResponseBodyBytes;
    }
    /**
     * Runs get maximum request body bytes.
     * @returns {number | undefined} - Configured byte limit, or undefined when unbounded.
     */
    getHttpServerMaxRequestBodyBytes() {
        return this.httpServer.maxRequestBodyBytes;
    }
    /**
     * Resolves request-body handling after the request line and headers are complete,
     * before body bytes are retained or decoded.
     * @param {import("./configuration-types.js").HttpRequestBodyPolicyResolverArgs} args - Parsed request head.
     * @returns {import("./configuration-types.js").ResolvedHttpRequestBodyPolicy} - Effective request policy.
     */
    resolveHttpRequestBodyPolicy(args) {
        const resolver = this.httpServer.requestBodyPolicyResolver;
        const configuredPolicy = resolver ? resolver(args) : undefined;
        /** @type {import("./configuration-types.js").ResolvedHttpRequestBodyPolicy} */
        let resolvedPolicy;
        if (configuredPolicy === undefined) {
            resolvedPolicy = { maxRequestBodyBytes: this.httpServer.maxRequestBodyBytes, mode: "parsed" };
        }
        else {
            if (!configuredPolicy || typeof configuredPolicy !== "object" || Array.isArray(configuredPolicy)) {
                throw new TypeError("httpServer.requestBodyPolicyResolver must return an object or undefined");
            }
            const { maxRequestBodyBytes, mode = "parsed", ...restPolicy } = configuredPolicy;
            const unknownKeys = Object.keys(restPolicy);
            if (unknownKeys.length > 0) {
                throw new TypeError(`httpServer.requestBodyPolicyResolver returned unknown keys: ${unknownKeys.join(", ")} (supported: maxRequestBodyBytes, mode)`);
            }
            if (mode !== "parsed" && mode !== "raw") {
                throw new TypeError(`httpServer.requestBodyPolicyResolver mode must be "parsed" or "raw", got: ${String(mode)}`);
            }
            resolvedPolicy = {
                maxRequestBodyBytes: maxRequestBodyBytes === undefined
                    ? this.httpServer.maxRequestBodyBytes
                    : optionalPositiveSafeInteger(maxRequestBodyBytes, "httpServer.requestBodyPolicyResolver maxRequestBodyBytes"),
                mode
            };
        }
        return this._applyMcpRequestBodyPolicyDefaults({ args, policy: resolvedPolicy });
    }
    /**
     * Enforces the built-in MCP endpoint's body contract without per-app plumbing: the
     * JSON-RPC envelope is read from parsed params, so raw mode is rejected with an
     * actionable error, and a framework default byte cap applies when the app configured none.
     * @param {{args: import("./configuration-types.js").HttpRequestBodyPolicyResolverArgs, policy: import("./configuration-types.js").ResolvedHttpRequestBodyPolicy}} options - Resolution inputs.
     * @returns {import("./configuration-types.js").ResolvedHttpRequestBodyPolicy} - Effective request policy.
     */
    _applyMcpRequestBodyPolicyDefaults({ args, policy }) {
        if (!this._mcp.enabled)
            return policy;
        if (args.httpMethod !== "POST")
            return policy;
        if (args.path.split("?")[0] !== this._mcp.path)
            return policy;
        if (policy.mode === "raw") {
            throw new TypeError(`The built-in MCP endpoint at ${this._mcp.path} requires parsed request bodies because its JSON-RPC envelope is read from params. Remove the raw-mode httpServer.requestBodyPolicyResolver entry for this path.`);
        }
        if (policy.maxRequestBodyBytes !== undefined)
            return policy;
        return { maxRequestBodyBytes: DEFAULT_MCP_MAX_REQUEST_BODY_BYTES, mode: policy.mode };
    }
    /**
     * Runs get cookie secret.
     * @returns {string | undefined} - Cookie secret.
     */
    getCookieSecret() {
        return this._cookieSecret;
    }
    /**
     * Runs get sync configuration.
     * @returns {import("./configuration-types.js").NormalizedVelociousSyncConfiguration} - Sync configuration.
     */
    getSyncConfiguration() {
        return this._sync;
    }
    /**
     * Runs current offline grant signing key.
     * @returns {import("./sync/offline-grant.js").OfflineGrantSigningKey} - Current signing key.
     */
    currentOfflineGrantSigningKey() {
        const signingKeys = this.getSyncConfiguration().offlineGrantSigningKeys;
        return currentOfflineGrantSigningKey(signingKeys);
    }
    /**
     * Normalizes sync configuration.
     * @param {import("./configuration-types.js").VelociousSyncConfiguration | undefined} sync - Sync configuration.
     * @returns {import("./configuration-types.js").NormalizedVelociousSyncConfiguration} - Normalized sync configuration.
     */
    _normalizeSyncConfiguration(sync) {
        const api = sync?.api;
        const deviceCertificateBackendPublicKey = sync?.deviceCertificateBackendPublicKey || null;
        const changeFeedRetentionSize = sync?.changeFeedRetentionSize;
        const offlineGrantSigningKeys = sync?.offlineGrantSigningKeys || [];
        const offlineGrantTtlMs = sync?.offlineGrantTtlMs;
        if (deviceCertificateBackendPublicKey !== null && (typeof deviceCertificateBackendPublicKey !== "object" || Array.isArray(deviceCertificateBackendPublicKey))) {
            throw new Error("sync.deviceCertificateBackendPublicKey must be a public JSON Web Key object");
        }
        if (changeFeedRetentionSize !== undefined && (!Number.isInteger(changeFeedRetentionSize) || changeFeedRetentionSize <= 0)) {
            throw new Error("sync.changeFeedRetentionSize must be a positive integer");
        }
        if (!Array.isArray(offlineGrantSigningKeys))
            throw new Error("sync.offlineGrantSigningKeys must be an array");
        if (offlineGrantTtlMs !== undefined && (!Number.isInteger(offlineGrantTtlMs) || offlineGrantTtlMs <= 0)) {
            throw new Error("sync.offlineGrantTtlMs must be a positive integer number of milliseconds");
        }
        return {
            api: this._normalizeSyncApiConfiguration(api),
            changeFeedRetentionSize: changeFeedRetentionSize || 10000,
            client: this._normalizeSyncClientConfiguration(sync?.client),
            deviceCertificateBackendPublicKey,
            offlineGrantSigningKeys: offlineGrantSigningKeys.map((key) => normalizeOfflineGrantSigningKey(key)),
            offlineGrantTtlMs: offlineGrantTtlMs || 24 * 60 * 60 * 1000
        };
    }
    /**
     * Normalizes client-side sync configuration consumed by `SyncClient.fromConfiguration(...)`.
     * @param {import("./configuration-types.js").VelociousSyncClientConfiguration | undefined} client - Client-side sync configuration.
     * @returns {import("./configuration-types.js").NormalizedVelociousSyncClientConfiguration | undefined} - Normalized client-side sync configuration.
     */
    _normalizeSyncClientConfiguration(client) {
        if (client === undefined || client === null)
            return undefined;
        if (typeof client !== "object" || Array.isArray(client)) {
            throw new Error("sync.client must be an object with transport and authenticationToken");
        }
        const { authenticationToken, batchSize, isOnline, mountPath, onError, offline, realtime, transport, websocketClient, websocketUrl, ...restClient } = client;
        const restClientKeys = Object.keys(restClient);
        if (restClientKeys.length > 0) {
            throw new Error(`sync.client received unknown keys: ${restClientKeys.join(", ")} (supported: authenticationToken, batchSize, isOnline, mountPath, onError, offline, realtime, transport, websocketClient, websocketUrl)`);
        }
        if (!transport || typeof transport !== "object" || typeof transport.post !== "function") {
            throw new Error("sync.client.transport must be an object with a post(path, body) method (like the frontend-model websocket client)");
        }
        if (typeof authenticationToken !== "function") {
            throw new Error("sync.client.authenticationToken must be a function resolving the auth token sent with sync requests");
        }
        if (isOnline !== undefined && typeof isOnline !== "function") {
            throw new Error("sync.client.isOnline must be a function resolving connectivity");
        }
        if (onError !== undefined && typeof onError !== "function") {
            throw new Error("sync.client.onError must be a function reporting background sync failures");
        }
        if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize <= 0)) {
            throw new Error("sync.client.batchSize must be a positive integer");
        }
        if (mountPath !== undefined && (typeof mountPath !== "string" || !mountPath.startsWith("/"))) {
            throw new Error(`sync.client.mountPath must start with '/', got: ${String(mountPath)}`);
        }
        if (websocketClient !== undefined && (typeof websocketClient !== "object" || websocketClient === null || typeof websocketClient.subscribeChannel !== "function")) {
            throw new Error("sync.client.websocketClient must be a websocket client with a subscribeChannel method (like VelociousWebsocketClient)");
        }
        if (websocketUrl !== undefined && typeof websocketUrl !== "string" && typeof websocketUrl !== "function") {
            throw new Error(`sync.client.websocketUrl must be a URL string or a function resolving one, got: ${String(websocketUrl)}`);
        }
        return {
            authenticationToken,
            batchSize,
            isOnline,
            mountPath: (mountPath || "/velocious/sync").replace(/\/+$/u, "") || "/",
            offline: this._normalizeSyncClientOfflineConfiguration(offline),
            onError,
            realtime,
            transport,
            websocketClient,
            websocketUrl
        };
    }
    /**
     * Normalizes the client-side long-offline session configuration consumed by
     * `SyncClient.startOfflineSession()`. The framework owns the session
     * lifecycle; the app provides durable identity storage, the enrollment hook,
     * and the grant scopes callback.
     * @param {import("./configuration-types.js").VelociousSyncClientOfflineConfiguration | undefined} offline - Offline configuration block.
     * @returns {import("./configuration-types.js").NormalizedVelociousSyncClientOfflineConfiguration | undefined} - Normalized offline configuration.
     */
    _normalizeSyncClientOfflineConfiguration(offline) {
        if (offline === undefined || offline === null)
            return undefined;
        if (typeof offline !== "object" || Array.isArray(offline)) {
            throw new Error("sync.client.offline must be an object with deviceIdentityStorage, enrollDevice, and grantScopes");
        }
        const { backendPublicKey, bootstrapPath, deviceIdentityStorage, enrollDevice, grantScopes, grantStorage, mutationLog, now, replayPath, ...restOffline } = offline;
        const restOfflineKeys = Object.keys(restOffline);
        if (restOfflineKeys.length > 0) {
            throw new Error(`sync.client.offline received unknown keys: ${restOfflineKeys.join(", ")} (supported: backendPublicKey, bootstrapPath, deviceIdentityStorage, enrollDevice, grantScopes, grantStorage, mutationLog, now, replayPath)`);
        }
        if (!deviceIdentityStorage || typeof deviceIdentityStorage !== "object" || Array.isArray(deviceIdentityStorage) || typeof deviceIdentityStorage.load !== "function" || typeof deviceIdentityStorage.save !== "function") {
            throw new Error("sync.client.offline.deviceIdentityStorage must be an object with load() and save(identity) methods");
        }
        if (typeof enrollDevice !== "function")
            throw new Error("sync.client.offline.enrollDevice must be a function resolving the backend-signed device certificate");
        if (typeof grantScopes !== "function")
            throw new Error("sync.client.offline.grantScopes must be a function resolving the bootstrap grant scopes");
        if (backendPublicKey !== undefined && (typeof backendPublicKey !== "object" || backendPublicKey === null || Array.isArray(backendPublicKey))) {
            throw new Error("sync.client.offline.backendPublicKey must be a public JSON Web Key object");
        }
        if (bootstrapPath !== undefined && (typeof bootstrapPath !== "string" || !bootstrapPath.startsWith("/"))) {
            throw new Error(`sync.client.offline.bootstrapPath must start with '/', got: ${String(bootstrapPath)}`);
        }
        if (replayPath !== undefined && (typeof replayPath !== "string" || !replayPath.startsWith("/"))) {
            throw new Error(`sync.client.offline.replayPath must start with '/', got: ${String(replayPath)}`);
        }
        if (grantStorage !== undefined && (typeof grantStorage !== "object" || grantStorage === null || Array.isArray(grantStorage) || typeof grantStorage.load !== "function" || typeof grantStorage.save !== "function")) {
            throw new Error("sync.client.offline.grantStorage must be an object with load() and save(grants) methods");
        }
        if (mutationLog !== undefined && (typeof mutationLog !== "object" || mutationLog === null || typeof mutationLog.append !== "function")) {
            throw new Error("sync.client.offline.mutationLog must be a LocalMutationLog");
        }
        if (now !== undefined && typeof now !== "function")
            throw new Error("sync.client.offline.now must be a function resolving the session clock");
        return {
            backendPublicKey,
            bootstrapPath: (bootstrapPath || "/frontend-models/sync/bootstrap").replace(/\/+$/u, "") || "/",
            configuration: this,
            deviceIdentityStorage,
            enrollDevice,
            grantScopes,
            grantStorage,
            mutationLog,
            now: now || (() => new Date()),
            replayPath: (replayPath || "/frontend-models/sync/replay").replace(/\/+$/u, "") || "/"
        };
    }
    /**
     * Normalizes sync API endpoint configuration.
     * @param {import("./configuration-types.js").VelociousSyncApiConfiguration | undefined} api - Sync API configuration.
     * @returns {import("./configuration-types.js").VelociousSyncApiConfiguration | undefined} - Normalized sync API configuration.
     */
    _normalizeSyncApiConfiguration(api) {
        if (api === undefined || api === null)
            return undefined;
        if (typeof api !== "object" || Array.isArray(api)) {
            throw new Error("sync.api must be an object with a resourceClass");
        }
        const { mountPath, resourceClass } = api;
        if (typeof resourceClass !== "function") {
            throw new Error(`sync.api.resourceClass must be a resource class, got: ${String(resourceClass)}`);
        }
        if (!resourceClass.ModelClass) {
            throw new Error(`sync.api.resourceClass ${resourceClass.name} must define static ModelClass`);
        }
        if (mountPath !== undefined && (typeof mountPath !== "string" || !mountPath.startsWith("/"))) {
            throw new Error(`sync.api.mountPath must start with '/', got: ${String(mountPath)}`);
        }
        return { mountPath, resourceClass };
    }
    /**
     * Runs get database configuration.
     * @returns {Record<string, import("./configuration-types.js").DatabaseConfigurationType>} - The database configuration.
     */
    getDatabaseConfiguration() {
        if (!this.database)
            throw new Error("No database configuration");
        if (!this.database[this.getEnvironment()]) {
            throw new Error(`No database configuration for environment: ${this.getEnvironment()} - ${Object.keys(this.database).join(", ")}`);
        }
        return digg(this, "database", this.getEnvironment());
    }
    /**
     * Runs resolve database configuration.
     * @param {string} identifier - Identifier.
     * @param {ReturnType<typeof JSON.parse>} [tenant] - Tenant override.
     * @returns {import("./configuration-types.js").DatabaseConfigurationType} - Resolved database configuration for the identifier.
     */
    resolveDatabaseConfiguration(identifier, tenant = this.getCurrentTenant()) {
        const databaseConfiguration = this.getDatabaseConfiguration()[identifier];
        if (!databaseConfiguration) {
            throw new Error(`No such database identifier configured: ${identifier}`);
        }
        if (tenant === undefined || !this._tenantDatabaseResolver) {
            return databaseConfiguration;
        }
        const overrideConfiguration = this._tenantDatabaseResolver({
            configuration: this,
            databaseConfiguration,
            identifier,
            tenant
        });
        return mergeDatabaseConfiguration(databaseConfiguration, overrideConfiguration);
    }
    /**
     * Runs get disabled database identifiers.
     * @returns {Set<string>} - Disabled database identifiers from env flags.
     */
    getDisabledDatabaseIdentifiers() {
        const disabledIdentifiers = new Set();
        const disabledIdentifiersRaw = process.env.VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS;
        if (disabledIdentifiersRaw) {
            for (const identifier of disabledIdentifiersRaw.split(",")) {
                const trimmed = identifier.trim();
                if (trimmed)
                    disabledIdentifiers.add(trimmed);
            }
        }
        if (process.env.VELOCIOUS_DISABLE_MSSQL === "1") {
            disabledIdentifiers.add("mssql");
        }
        return disabledIdentifiers;
    }
    /**
     * Runs is database identifier active.
     * @param {string} identifier - Database identifier.
     * @param {ReturnType<typeof JSON.parse>} [tenant] - Tenant override.
     * @returns {boolean} - Whether this database identifier is active in the current tenant context.
     */
    isDatabaseIdentifierActive(identifier, tenant = this.getCurrentTenant()) {
        const databaseConfiguration = this.getDatabaseConfiguration()[identifier];
        if (!databaseConfiguration) {
            throw new Error(`No such database identifier configured: ${identifier}`);
        }
        if (!databaseConfiguration.tenantOnly)
            return true;
        if (tenant === undefined || !this._tenantDatabaseResolver)
            return false;
        const overrideConfiguration = this._tenantDatabaseResolver({
            configuration: this,
            databaseConfiguration,
            identifier,
            tenant
        });
        return Boolean(overrideConfiguration);
    }
    /**
     * Runs get database identifiers.
     * @returns {Array<string>} - The database identifiers.
     */
    getDatabaseIdentifiers() {
        const identifiers = Object.keys(this.getDatabaseConfiguration());
        const disabledIdentifiers = this.getDisabledDatabaseIdentifiers();
        return identifiers.filter((identifier) => !disabledIdentifiers.has(identifier) && this.isDatabaseIdentifierActive(identifier));
    }
    /**
     * Runs get debug snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Human-readable server diagnostics.
     */
    async getDebugSnapshot() {
        const localSnapshot = this.getLocalDebugSnapshot();
        return {
            ...localSnapshot,
            httpServer: await this._debugHttpServerSnapshot()
        };
    }
    /**
     * Runs get local debug snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Human-readable diagnostics for this process only.
     */
    getLocalDebugSnapshot() {
        return {
            backgroundJobs: this._debugBackgroundJobsSnapshot(),
            configuration: this._debugConfigurationSnapshot(),
            database: this._debugDatabaseSnapshot(),
            generatedAt: new Date().toISOString(),
            server: this._debugServerSnapshot(),
            websockets: this._debugWebsocketSnapshot()
        };
    }
    /**
     * Runs debug http server snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - HTTP server worker diagnostics.
     */
    async _debugHttpServerSnapshot() {
        const httpServer = /** @type {{getDebugSnapshot?: () => Promise<Record<string, ReturnType<typeof JSON.parse>>>} | undefined} */ (this._httpServerInstance);
        if (!httpServer?.getDebugSnapshot) {
            return { configured: Boolean(this.httpServer), active: false };
        }
        return await httpServer.getDebugSnapshot();
    }
    /**
     * Runs debug server snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Server runtime diagnostics.
     */
    _debugServerSnapshot() {
        const nodeProcess = typeof process === "undefined" ? undefined : process;
        return {
            environment: this.getEnvironment(),
            memoryUsage: nodeProcess ? nodeProcess.memoryUsage() : undefined,
            nodeVersion: nodeProcess?.versions?.node,
            pid: nodeProcess?.pid,
            platform: nodeProcess?.platform,
            uptimeSeconds: nodeProcess ? nodeProcess.uptime() : undefined
        };
    }
    /**
     * Runs debug configuration snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Configuration diagnostics.
     */
    _debugConfigurationSnapshot() {
        return {
            apiManifest: this._apiManifestEnabled() ? { enabled: true, path: this._apiManifest.path, tokenConfigured: Boolean(this._apiManifest.token) } : { enabled: false },
            autoload: this.getAutoload(),
            debug: this.debug === true,
            debugEndpoint: this._debugEndpointSnapshot(),
            enforceTenantDatabaseScopes: this.getEnforceTenantDatabaseScopes(),
            exposeInternalErrorsToClients: this.getExposeInternalErrorsToClients(),
            initialized: this._isInitialized,
            mcp: this._mcp.enabled ? { enabled: true, path: this._mcp.path, tokenConfigured: Boolean(this._mcp.token) } : { enabled: false },
            logging: {
                debugLowLevel: this._logging?.debugLowLevel === true,
                outputs: this._logging ? Object.keys(this._logging) : []
            }
        };
    }
    /**
     * Runs debug background jobs snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Background job diagnostics.
     */
    _debugBackgroundJobsSnapshot() {
        return {
            configured: Boolean(this._backgroundJobs),
            scheduledConfigured: Boolean(this._scheduledBackgroundJobs)
        };
    }
    /**
     * Runs debug database snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Database diagnostics.
     */
    _debugDatabaseSnapshot() {
        /**
         * Database pools.
         * @type {Record<string, import("./database/pool/base.js").DatabasePoolDebugSnapshot>} */
        const databasePools = {};
        const activeIdentifiers = this.getDatabaseIdentifiers();
        for (const identifier of activeIdentifiers) {
            databasePools[identifier] = this.getDatabasePool(identifier).getDebugSnapshot();
        }
        return {
            activeIdentifiers,
            disabledIdentifiers: Array.from(this.getDisabledDatabaseIdentifiers()),
            initializedPools: Object.keys(this.databasePools),
            pools: databasePools
        };
    }
    /**
     * Runs debug websocket snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - WebSocket diagnostics.
     */
    _debugWebsocketSnapshot() {
        /**
         * Session buckets.
         * @type {Map<string, {count: number, details: {channelSubscriptionCount: number, channelSubscriptions: {channelType: string, count: number, model: string | null}[], connectionCount: number, paused: boolean, subscriptionCount: number}}>} */
        const sessionBuckets = new Map();
        /**
         * Session details.
         * @type {{channelSubscriptionCount: number, channelSubscriptions: {channelType: string, count: number, model: string | null}[], connectionCount: number, paused: boolean, queuedMessageCount: number, subscriptionCount: number}[]} */
        const sessionDetails = [];
        const subscriptions = Array.from(this._websocketChannelSubscriptions.entries()).map(([channel, channelSubscriptions]) => {
            /**
             * Details buckets.
             * @type {Map<string, {count: number, details: Record<string, ReturnType<typeof JSON.parse>>}>} */
            const detailsBuckets = new Map();
            for (const subscription of channelSubscriptions) {
                const details = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (canonicalDebugSnapshotValue(subscription.debugSnapshot()));
                const key = JSON.stringify(details);
                const existingBucket = detailsBuckets.get(key);
                if (existingBucket) {
                    existingBucket.count += 1;
                }
                else {
                    detailsBuckets.set(key, { count: 1, details });
                }
            }
            return {
                channel,
                count: channelSubscriptions.size,
                details: Array.from(detailsBuckets.values()).sort((a, b) => b.count - a.count)
            };
        });
        for (const session of this._websocketSessions) {
            /**
             * Channel subscription buckets.
             * @type {Map<string, {channelType: string, count: number, model: string | null}>} */
            const channelSubscriptionBuckets = new Map();
            for (const { channelType, subscription } of session._channelSubscriptions.values()) {
                const details = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (subscription.debugSnapshot());
                const model = typeof details.model === "string" ? details.model : null;
                const key = JSON.stringify({ channelType, model });
                const existingBucket = channelSubscriptionBuckets.get(key);
                if (existingBucket) {
                    existingBucket.count += 1;
                }
                else {
                    channelSubscriptionBuckets.set(key, { channelType, count: 1, model });
                }
            }
            const channelSubscriptions = Array.from(channelSubscriptionBuckets.values()).sort((a, b) => b.count - a.count);
            const snapshot = {
                channelSubscriptionCount: session._channelSubscriptions.size,
                channelSubscriptions,
                connectionCount: session._connections.size,
                paused: session._paused,
                queuedMessageCount: session._outboundQueue.length,
                subscriptionCount: session.subscriptions.size
            };
            const bucketKey = JSON.stringify({
                channelSubscriptionCount: snapshot.channelSubscriptionCount,
                channelSubscriptions: snapshot.channelSubscriptions,
                connectionCount: snapshot.connectionCount,
                paused: snapshot.paused,
                subscriptionCount: snapshot.subscriptionCount
            });
            const existingBucket = sessionBuckets.get(bucketKey);
            if (existingBucket) {
                existingBucket.count += 1;
            }
            else {
                sessionBuckets.set(bucketKey, {
                    count: 1,
                    details: {
                        channelSubscriptionCount: snapshot.channelSubscriptionCount,
                        channelSubscriptions: snapshot.channelSubscriptions,
                        connectionCount: snapshot.connectionCount,
                        paused: snapshot.paused,
                        subscriptionCount: snapshot.subscriptionCount
                    }
                });
            }
            sessionDetails.push(snapshot);
        }
        return {
            liveOnlyChannels: Array.from(this._liveOnlyWebsocketChannels),
            pausedSessions: this._pausedWebsocketSessions.size,
            registeredChannels: Array.from(this._websocketChannelClasses.keys()),
            registeredConnections: Array.from(this._websocketConnectionClasses.keys()),
            sessionBuckets: Array.from(sessionBuckets.values()).sort((a, b) => b.count - a.count),
            sessionCount: this._websocketSessions.size,
            sessions: sessionDetails.sort((a, b) => b.channelSubscriptionCount - a.channelSubscriptionCount),
            subscriptionGroups: this._websocketChannelSubscriptions.size,
            subscriptions
        };
    }
    /**
     * Runs get database pool.
     * @param {string} identifier - Identifier.
     * @returns {import("./database/pool/base.js").default} - The database pool.
     */
    getDatabasePool(identifier = "default") {
        if (!this.isDatabasePoolInitialized(identifier)) {
            this.initializeDatabasePool(identifier);
        }
        return digg(this, "databasePools", identifier);
    }
    /**
     * Returns the framework-owned frontend tenant SQLite lifecycle.
     * @returns {FrontendTenantSqliteLifecycle} - Lifecycle owner.
     */
    getFrontendTenantSqliteLifecycle() { return this._frontendTenantSqliteLifecycle; }
    /**
     * Returns safe frontend tenant SQLite diagnostics.
     * @returns {ReturnType<FrontendTenantSqliteLifecycle["inspectAll"]>} - Lifecycle diagnostics.
     */
    inspectFrontendTenantSqliteHandles() { return this._frontendTenantSqliteLifecycle.inspectAll(); }
    /**
     * Runs get database identifier.
     * @param {string} identifier - Identifier.
     * @returns {import("./configuration-types.js").DatabaseConfigurationType})
     */
    getDatabaseIdentifier(identifier) {
        return this.resolveDatabaseConfiguration(identifier);
    }
    /**
     * Clears the schema metadata cached by every initialized pool that targets the
     * same physical database (matched by connection reuse key). Separate pools that
     * point at one database keep independent schema caches, so DDL run through one
     * pool would otherwise leave the others reporting stale tables/columns.
     * @param {string} reuseKey - Connection reuse key identifying the shared database.
     * @returns {void} - No return value.
     */
    clearSchemaCachesForReuseKey(reuseKey) {
        this._schemaCacheGenerationsByReuseKey.set(reuseKey, this.schemaCacheGenerationForReuseKey(reuseKey) + 1);
        for (const pool of Object.values(this.databasePools)) {
            if (pool.getConfigurationReuseKey() === reuseKey) {
                pool.clearSchemaCache();
            }
        }
    }
    /**
     * Returns the current schema-cache generation for one physical database.
     * @param {string} reuseKey - Connection reuse key identifying the shared database.
     * @returns {number} - Current schema-cache generation.
     */
    schemaCacheGenerationForReuseKey(reuseKey) {
        return this._schemaCacheGenerationsByReuseKey.get(reuseKey) || 0;
    }
    /**
     * Invalidates record metadata owned by one closed/deleted physical tenant
     * database while preserving every other tenant generation.
     * @param {string} databaseIdentity - Logical identifier plus pool reuse key.
     * @returns {void}
     */
    clearRecordMetadataForDatabaseIdentity(databaseIdentity) {
        for (const modelClass of Object.values(this.modelClasses)) {
            modelClass.clearRecordMetadataValuesForDatabaseIdentity(databaseIdentity);
        }
    }
    /**
     * Runs get database pool type.
     * @param {string} identifier - Identifier.
     * @returns {typeof import("./database/pool/base.js").default} - The database pool type.
     */
    getDatabasePoolType(identifier = "default") {
        const poolTypeClass = digg(this.getDatabaseIdentifier(identifier), "poolType");
        if (!poolTypeClass) {
            throw new Error("No poolType given in database configuration");
        }
        return this.getEnvironmentHandler().resolveTestSharedTransactionPoolType({
            configuredPoolType: poolTypeClass,
            databaseIdentifier: identifier
        });
    }
    getDatabaseType(identifier = "default") {
        const databaseType = this.getDatabaseIdentifier(identifier).type;
        if (!databaseType)
            throw new Error("No database type given in database configuration");
        return databaseType;
    }
    /**
     * Runs get directory.
     * @returns {string} - The directory.
     */
    getDirectory() {
        const directory = this.getDirectoryIfAvailable();
        if (!directory)
            throw new Error("No directory configured and process.cwd is unavailable");
        return directory;
    }
    /**
     * Runs get directory if available.
     * @returns {string | undefined} - The directory when the runtime can resolve one.
     */
    getDirectoryIfAvailable() {
        if (!this._directory) {
            this._directory = currentWorkingDirectory();
        }
        return this._directory;
    }
    /**
     * Runs get backend projects.
     * @returns {import("./configuration-types.js").BackendProjectConfiguration[]} - Backend projects.
     */
    getBackendProjects() { return this._backendProjects; }
    /**
     * Runs get packages.
     * @returns {VelociousPackage[]} - Registered Velocious packages.
     */
    getPackages() { return this._packages; }
    /**
     * Runs get ability resources.
     * @returns {import("./configuration-types.js").AbilityResourceClassType[]} - Ability resource classes.
     */
    getAbilityResources() { return this._abilityResources; }
    /**
     * Runs set ability resources.
     * @param {import("./configuration-types.js").AbilityResourceClassType[]} resources - Ability resource classes.
     * @returns {void} - No return value.
     */
    setAbilityResources(resources) { this._abilityResources = resources; }
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
    _mergeDiscoveredAbilityResources() {
        const merged = [...this._abilityResources];
        const seen = new Set(merged);
        for (const backendProject of this._backendProjects) {
            if (!backendProject.abilityResources)
                continue;
            for (const ResourceClass of backendProject.abilityResources) {
                if (seen.has(ResourceClass))
                    continue;
                seen.add(ResourceClass);
                merged.push(ResourceClass);
            }
        }
        this._abilityResources = merged;
    }
    /**
     * Runs get ability resolver.
     * @returns {import("./configuration-types.js").AbilityResolverType | undefined} - Ability resolver.
     */
    getAbilityResolver() { return this._abilityResolver; }
    /**
     * Runs get tenant resolver.
     * @returns {import("./configuration-types.js").TenantResolverType | undefined} - Tenant resolver.
     */
    getTenantResolver() { return this._tenantResolver; }
    /**
     * Runs get tenant database resolver.
     * @returns {import("./configuration-types.js").TenantDatabaseResolverType | undefined} - Tenant database resolver.
     */
    getTenantDatabaseResolver() { return this._tenantDatabaseResolver; }
    /**
     * Runs get test tenant pool configurations.
     * @returns {import("./configuration-types.js").TestTenantPoolsConfiguration | undefined} - Opt-in test tenant database pools keyed by database identifier.
     */
    getTestTenantPools() { return this._testTenantPools; }
    /**
     * Runs get enforce tenant database scopes.
     * @returns {boolean} - Whether tenant-switched models require a resolved tenant database identifier.
     */
    getEnforceTenantDatabaseScopes() { return this._enforceTenantDatabaseScopes; }
    /**
     * Runs get tenant database providers.
     * @returns {Record<string, import("./configuration-types.js").TenantDatabaseProviderType>} - Tenant database lifecycle providers.
     */
    getTenantDatabaseProviders() { return this._tenantDatabaseProviders; }
    /**
     * Runs get tenant database provider.
     * @param {string} identifier - Database identifier.
     * @returns {import("./configuration-types.js").TenantDatabaseProviderType} - Tenant database lifecycle provider.
     */
    getTenantDatabaseProvider(identifier) {
        const provider = this._tenantDatabaseProviders[identifier];
        if (!provider) {
            throw new Error(`No tenant database provider configured for database identifier: ${identifier}`);
        }
        return provider;
    }
    /**
     * Runs get attachments configuration.
     * @returns {import("./configuration-types.js").AttachmentsConfiguration} - Attachments configuration.
     */
    getAttachmentsConfiguration() { return this._attachments || {}; }
    /**
     * Runs get route resolver hooks.
     * @returns {import("./configuration-types.js").RouteResolverHookType[]} - Route resolver hooks.
     */
    getRouteResolverHooks() { return this._routeResolverHooks; }
    /**
     * Runs add route resolver hook.
     * @param {import("./configuration-types.js").RouteResolverHookType} hook - Route resolver hook.
     * @returns {void} - No return value.
     */
    addRouteResolverHook(hook) {
        this._routeResolverHooks.push(hook);
    }
    /**
     * Runs set ability resolver.
     * @param {import("./configuration-types.js").AbilityResolverType | undefined} resolver - Ability resolver.
     * @returns {void} - No return value.
     */
    setAbilityResolver(resolver) { this._abilityResolver = resolver; }
    /**
     * Runs set tenant resolver.
     * @param {import("./configuration-types.js").TenantResolverType | undefined} resolver - Tenant resolver.
     * @returns {void} - No return value.
     */
    setTenantResolver(resolver) { this._tenantResolver = resolver; }
    /**
     * Runs set tenant database resolver.
     * @param {import("./configuration-types.js").TenantDatabaseResolverType | undefined} resolver - Tenant database resolver.
     * @returns {void} - No return value.
     */
    setTenantDatabaseResolver(resolver) { this._tenantDatabaseResolver = resolver; }
    /**
     * Runs set test tenant pool configurations.
     * @param {import("./configuration-types.js").TestTenantPoolsConfiguration | undefined} pools - Opt-in test tenant database pools.
     * @returns {void} - No return value.
     */
    setTestTenantPools(pools) { this._testTenantPools = pools; }
    /**
     * Runs set enforce tenant database scopes.
     * @param {boolean} newValue - Whether tenant-switched models require a resolved tenant database identifier.
     * @returns {void} - No return value.
     */
    setEnforceTenantDatabaseScopes(newValue) { this._enforceTenantDatabaseScopes = newValue; }
    /**
     * Runs set tenant database providers.
     * @param {Record<string, import("./configuration-types.js").TenantDatabaseProviderType>} providers - Tenant database lifecycle providers.
     * @returns {void} - No return value.
     */
    setTenantDatabaseProviders(providers) { this._tenantDatabaseProviders = providers; }
    /**
     * Runs get environment.
     * @returns {string} - The environment.
     */
    getEnvironment() { return digg(this, "_environment"); }
    /**
     * Runs get request timeout ms.
     * @returns {number} - Request timeout in seconds.
     */
    getRequestTimeoutMs() {
        const envTimeout = this._parseRequestTimeoutSeconds(process.env.VELOCIOUS_REQUEST_TIMEOUT_MS);
        const value = typeof this._requestTimeoutMs === "function"
            ? this._requestTimeoutMs()
            : this._requestTimeoutMs;
        if (typeof value === "number")
            return value;
        if (typeof envTimeout === "number" && Number.isFinite(envTimeout))
            return envTimeout;
        return 60;
    }
    /**
     * Runs parse request timeout seconds.
     * @param {string | undefined} rawValue - Env value.
     * @returns {number | undefined} - Timeout in seconds.
     */
    _parseRequestTimeoutSeconds(rawValue) {
        if (rawValue === undefined)
            return undefined;
        const trimmed = rawValue.trim().toLowerCase();
        if (!trimmed)
            return undefined;
        const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s)?$/);
        if (!match)
            return undefined;
        const numeric = Number(match[1]);
        if (!Number.isFinite(numeric))
            return undefined;
        const unit = match[2];
        if (unit === "ms")
            return numeric / 1000;
        if (unit === "s")
            return numeric;
        if (trimmed.includes("."))
            return numeric;
        if (numeric >= 1000)
            return numeric / 1000;
        return numeric;
    }
    /**
     * Runs set environment.
     * @param {string} newEnvironment - New environment.
     * @returns {void} - No return value.
     */
    setEnvironment(newEnvironment) { this._environment = newEnvironment; }
    /**
     * Runs get logging configuration.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.defaultConsole] - Whether default console.
     * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Pick<import("./configuration-types.js").LoggingConfiguration, "directory" | "filePath"> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>} - The logging configuration.
     */
    getLoggingConfiguration({ defaultConsole } = {}) {
        const environment = this.getEnvironment();
        const environmentHandler = this.getEnvironmentHandler();
        const directory = this._logging?.directory || environmentHandler.getDefaultLogDirectory({ configuration: this });
        const filePath = this._logging?.filePath || environmentHandler.getLogFilePath({ configuration: this, directory, environment });
        const consoleOverride = this._logging?.console;
        const hasLoggingConfig = Boolean(this._logging);
        const fileLogging = hasLoggingConfig ? (this._logging?.file ?? Boolean(filePath)) : false;
        const configuredLevels = this._logging?.levels;
        const includeLowLevelDebug = this._logging?.debugLowLevel === true;
        const loggers = this._logging?.loggers;
        const consoleDefault = defaultConsole !== undefined ? defaultConsole : true;
        const consoleLogging = consoleOverride !== undefined ? consoleOverride : consoleDefault;
        /**
         * Default levels.
         * @type {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} */
        const defaultLevels = ["info", "warn", "error"];
        if (includeLowLevelDebug)
            defaultLevels.unshift("debug-low-level");
        const levels = configuredLevels || defaultLevels;
        return {
            console: consoleLogging,
            directory,
            file: fileLogging ?? false,
            filePath,
            loggers,
            levels,
            outputs: this._logging?.outputs
        };
    }
    /**
     * Gets the configuration-owned structured logging redactor.
     * @returns {LogRedactor} - Structured logging redactor.
     */
    getLogRedactor() {
        return this._logRedactor;
    }
    /**
     * Runs get query logging enabled.
     * @returns {boolean} - Whether database query logging is enabled.
     */
    getQueryLoggingEnabled() {
        if (this._logging?.queryLogging !== undefined)
            return this._logging.queryLogging;
        return this.getEnvironment() !== "test";
    }
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
    resolveBackgroundJobsGenerationConfig({ generationId: explicitGenerationId, initialGenerationState: explicitInitialGenerationState, lifecycleSocketPath: explicitLifecycleSocketPath, sourceName = "background jobs API" } = {}) {
        const configured = this._backgroundJobs || {};
        const generationEnvironment = globalThis.process?.env || {};
        const generationId = resolveGenerationId([
            { name: "backgroundJobs.generationId", present: Object.hasOwn(configured, "generationId") && configured.generationId !== undefined, value: configured.generationId },
            { name: "VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID", present: Object.hasOwn(generationEnvironment, "VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID"), value: generationEnvironment.VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID },
            { name: `${sourceName} generationId`, present: explicitGenerationId !== undefined, value: explicitGenerationId }
        ]);
        const initialGenerationState = resolveInitialGenerationState([
            { name: "backgroundJobs.initialGenerationState", present: Object.hasOwn(configured, "initialGenerationState") && configured.initialGenerationState !== undefined, value: configured.initialGenerationState },
            { name: "VELOCIOUS_BACKGROUND_JOBS_INITIAL_GENERATION_STATE", present: Object.hasOwn(generationEnvironment, "VELOCIOUS_BACKGROUND_JOBS_INITIAL_GENERATION_STATE"), value: generationEnvironment.VELOCIOUS_BACKGROUND_JOBS_INITIAL_GENERATION_STATE },
            { name: `${sourceName} initialGenerationState`, present: explicitInitialGenerationState !== undefined, value: explicitInitialGenerationState }
        ], generationId);
        const lifecycleSocketPath = resolveLifecycleSocketPath([
            { name: "backgroundJobs.lifecycleSocketPath", present: Object.hasOwn(configured, "lifecycleSocketPath") && configured.lifecycleSocketPath !== undefined, value: configured.lifecycleSocketPath },
            { name: "VELOCIOUS_BACKGROUND_JOBS_LIFECYCLE_SOCKET_PATH", present: Object.hasOwn(generationEnvironment, "VELOCIOUS_BACKGROUND_JOBS_LIFECYCLE_SOCKET_PATH"), value: generationEnvironment.VELOCIOUS_BACKGROUND_JOBS_LIFECYCLE_SOCKET_PATH },
            { name: `${sourceName} lifecycleSocketPath`, present: explicitLifecycleSocketPath !== undefined, value: explicitLifecycleSocketPath }
        ], generationId);
        return { generationId, initialGenerationState, lifecycleSocketPath };
    }
    /**
     * Runs get background jobs config.
     * @returns {Omit<Required<import("./configuration-types.js").BackgroundJobsConfiguration>, "adapter" | "retention" | "generationId" | "lifecycleSocketPath"> & {generationId?: string, lifecycleSocketPath?: string, retention: import("./configuration-types.js").ResolvedBackgroundJobsRetentionConfiguration}} - Background jobs configuration.
     */
    getBackgroundJobsConfig() {
        const processEnvironment = globalThis.process?.env;
        const envHost = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_HOST;
        const envPortRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_PORT;
        const envDatabaseIdentifier = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_DATABASE_IDENTIFIER;
        const envMaxConcurrentForkedRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_MAX_CONCURRENT_FORKED_JOBS;
        const envMaxConcurrentRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_MAX_CONCURRENT_INLINE_JOBS;
        const envPooledRunnerCountRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_COUNT;
        const envPooledRunnerConcurrencyRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_CONCURRENCY;
        const envPooledRunnerMaxJobsRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_JOBS;
        const envPooledRunnerMaxRssBytesRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_RSS_BYTES;
        const envPooledRunnerMaxLifetimeMsRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_LIFETIME_MS;
        const envPooledRunnerSilenceTimeoutMsRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_SILENCE_TIMEOUT_MS;
        const envRunnerMaxOldSpaceSizeMbRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_RUNNER_MAX_OLD_SPACE_SIZE_MB;
        const envRunnerMallocArenaMaxRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_RUNNER_MALLOC_ARENA_MAX;
        const envDispatchStrategy = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_DISPATCH_STRATEGY;
        const envPollIntervalRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_POLL_INTERVAL_MS;
        const envJobTimeoutRaw = processEnvironment?.VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS;
        const envPort = envPortRaw ? Number(envPortRaw) : undefined;
        const envMaxConcurrentForked = envMaxConcurrentForkedRaw ? Number(envMaxConcurrentForkedRaw) : undefined;
        const envMaxConcurrent = envMaxConcurrentRaw ? Number(envMaxConcurrentRaw) : undefined;
        const envPooledRunnerCount = envPooledRunnerCountRaw ? Number(envPooledRunnerCountRaw) : undefined;
        const envPooledRunnerConcurrency = envPooledRunnerConcurrencyRaw ? Number(envPooledRunnerConcurrencyRaw) : undefined;
        const envPooledRunnerMaxJobs = envPooledRunnerMaxJobsRaw ? Number(envPooledRunnerMaxJobsRaw) : undefined;
        const envPooledRunnerMaxRssBytes = envPooledRunnerMaxRssBytesRaw ? Number(envPooledRunnerMaxRssBytesRaw) : undefined;
        const envPooledRunnerMaxLifetimeMs = envPooledRunnerMaxLifetimeMsRaw ? Number(envPooledRunnerMaxLifetimeMsRaw) : undefined;
        const envPooledRunnerSilenceTimeoutMs = envPooledRunnerSilenceTimeoutMsRaw ? Number(envPooledRunnerSilenceTimeoutMsRaw) : undefined;
        const envRunnerMaxOldSpaceSizeMb = envRunnerMaxOldSpaceSizeMbRaw ? Number(envRunnerMaxOldSpaceSizeMbRaw) : undefined;
        const envRunnerMallocArenaMax = envRunnerMallocArenaMaxRaw ? Number(envRunnerMallocArenaMaxRaw) : undefined;
        const envPollInterval = envPollIntervalRaw ? Number(envPollIntervalRaw) : undefined;
        const envJobTimeout = envJobTimeoutRaw ? Number(envJobTimeoutRaw) : undefined;
        const configured = this._backgroundJobs || {};
        const { generationId, initialGenerationState, lifecycleSocketPath } = this.resolveBackgroundJobsGenerationConfig();
        const mode = configured.mode === undefined ? "background" : configured.mode;
        if (mode !== "background" && mode !== "inline") {
            throw new TypeError(`backgroundJobs.mode must be "background" or "inline", got: ${String(mode)}`);
        }
        const host = configured.host || envHost || "127.0.0.1";
        const port = typeof configured.port === "number"
            ? configured.port
            : (typeof envPort === "number" && Number.isFinite(envPort) ? envPort : 7331);
        const databaseIdentifier = configured.databaseIdentifier || envDatabaseIdentifier || "default";
        const maxConcurrentInlineJobs = typeof configured.maxConcurrentInlineJobs === "number" && configured.maxConcurrentInlineJobs >= 1
            ? configured.maxConcurrentInlineJobs
            : (typeof envMaxConcurrent === "number" && Number.isFinite(envMaxConcurrent) && envMaxConcurrent >= 1 ? envMaxConcurrent : 4);
        const maxConcurrentForkedJobs = typeof configured.maxConcurrentForkedJobs === "number" && configured.maxConcurrentForkedJobs >= 1
            ? configured.maxConcurrentForkedJobs
            : (typeof envMaxConcurrentForked === "number" && Number.isFinite(envMaxConcurrentForked) && envMaxConcurrentForked >= 1 ? envMaxConcurrentForked : 4);
        const pooledRunnerCount = typeof configured.pooledRunnerCount === "number" && Number.isFinite(configured.pooledRunnerCount) && Number.isInteger(configured.pooledRunnerCount) && configured.pooledRunnerCount >= 1
            ? configured.pooledRunnerCount
            : (!("pooledRunnerCount" in configured) && typeof envPooledRunnerCount === "number" && Number.isFinite(envPooledRunnerCount) && Number.isInteger(envPooledRunnerCount) && envPooledRunnerCount >= 1 ? envPooledRunnerCount : 4);
        const pooledRunnerConcurrency = typeof configured.pooledRunnerConcurrency === "number" && Number.isFinite(configured.pooledRunnerConcurrency) && Number.isInteger(configured.pooledRunnerConcurrency) && configured.pooledRunnerConcurrency >= 1
            ? configured.pooledRunnerConcurrency
            : (!("pooledRunnerConcurrency" in configured) && typeof envPooledRunnerConcurrency === "number" && Number.isFinite(envPooledRunnerConcurrency) && Number.isInteger(envPooledRunnerConcurrency) && envPooledRunnerConcurrency >= 1 ? envPooledRunnerConcurrency : 1);
        const pooledRunnerMaxJobs = typeof configured.pooledRunnerMaxJobs === "number" && Number.isFinite(configured.pooledRunnerMaxJobs) && Number.isInteger(configured.pooledRunnerMaxJobs) && configured.pooledRunnerMaxJobs >= 1
            ? configured.pooledRunnerMaxJobs
            : (!("pooledRunnerMaxJobs" in configured) && typeof envPooledRunnerMaxJobs === "number" && Number.isFinite(envPooledRunnerMaxJobs) && Number.isInteger(envPooledRunnerMaxJobs) && envPooledRunnerMaxJobs >= 1 ? envPooledRunnerMaxJobs : 100);
        const pooledRunnerMaxRssBytes = typeof configured.pooledRunnerMaxRssBytes === "number" && Number.isFinite(configured.pooledRunnerMaxRssBytes) && configured.pooledRunnerMaxRssBytes >= 1
            ? configured.pooledRunnerMaxRssBytes
            : (!("pooledRunnerMaxRssBytes" in configured) && typeof envPooledRunnerMaxRssBytes === "number" && Number.isFinite(envPooledRunnerMaxRssBytes) && envPooledRunnerMaxRssBytes >= 1 ? envPooledRunnerMaxRssBytes : 512 * 1024 * 1024);
        const pooledRunnerMaxLifetimeMs = typeof configured.pooledRunnerMaxLifetimeMs === "number" && Number.isFinite(configured.pooledRunnerMaxLifetimeMs) && configured.pooledRunnerMaxLifetimeMs >= 1
            ? configured.pooledRunnerMaxLifetimeMs
            : (!("pooledRunnerMaxLifetimeMs" in configured) && typeof envPooledRunnerMaxLifetimeMs === "number" && Number.isFinite(envPooledRunnerMaxLifetimeMs) && envPooledRunnerMaxLifetimeMs >= 1 ? envPooledRunnerMaxLifetimeMs : 60 * 60 * 1000);
        const pooledRunnerSilenceTimeoutMs = typeof configured.pooledRunnerSilenceTimeoutMs === "number" && Number.isFinite(configured.pooledRunnerSilenceTimeoutMs) && configured.pooledRunnerSilenceTimeoutMs >= 1
            ? configured.pooledRunnerSilenceTimeoutMs
            : (!("pooledRunnerSilenceTimeoutMs" in configured) && typeof envPooledRunnerSilenceTimeoutMs === "number" && Number.isFinite(envPooledRunnerSilenceTimeoutMs) && envPooledRunnerSilenceTimeoutMs >= 1 ? envPooledRunnerSilenceTimeoutMs : 120000);
        // Runner children get a hard V8 heap cap and a bounded glibc arena count
        // so one child can never commit multiple GBs of heap or unbounded
        // allocator arenas. The cap stays far above observed runner usage; an
        // inherited MALLOC_ARENA_MAX is honored before the built-in default.
        const runnerMaxOldSpaceSizeMb = typeof configured.runnerMaxOldSpaceSizeMb === "number" && Number.isFinite(configured.runnerMaxOldSpaceSizeMb) && Number.isInteger(configured.runnerMaxOldSpaceSizeMb) && configured.runnerMaxOldSpaceSizeMb >= 64
            ? configured.runnerMaxOldSpaceSizeMb
            : (!("runnerMaxOldSpaceSizeMb" in configured) && typeof envRunnerMaxOldSpaceSizeMb === "number" && Number.isFinite(envRunnerMaxOldSpaceSizeMb) && Number.isInteger(envRunnerMaxOldSpaceSizeMb) && envRunnerMaxOldSpaceSizeMb >= 64 ? envRunnerMaxOldSpaceSizeMb : 2048);
        const inheritedMallocArenaMax = processEnvironment?.MALLOC_ARENA_MAX ? Number(processEnvironment.MALLOC_ARENA_MAX) : undefined;
        const runnerMallocArenaMax = typeof configured.runnerMallocArenaMax === "number" && Number.isFinite(configured.runnerMallocArenaMax) && Number.isInteger(configured.runnerMallocArenaMax) && configured.runnerMallocArenaMax >= 1
            ? configured.runnerMallocArenaMax
            : (!("runnerMallocArenaMax" in configured) && typeof envRunnerMallocArenaMax === "number" && Number.isFinite(envRunnerMallocArenaMax) && Number.isInteger(envRunnerMallocArenaMax) && envRunnerMallocArenaMax >= 1
                ? envRunnerMallocArenaMax
                : (typeof inheritedMallocArenaMax === "number" && Number.isInteger(inheritedMallocArenaMax) && inheritedMallocArenaMax >= 1 ? inheritedMallocArenaMax : 4));
        const dispatchStrategyRaw = configured.dispatchStrategy || envDispatchStrategy;
        const dispatchStrategy = dispatchStrategyRaw === "polling" ? "polling" : "beacon";
        const pollIntervalMs = typeof configured.pollIntervalMs === "number" && configured.pollIntervalMs >= 1
            ? configured.pollIntervalMs
            : (typeof envPollInterval === "number" && Number.isFinite(envPollInterval) && envPollInterval >= 1 ? envPollInterval : 1000);
        const drainStoreOperationTimeoutMs = typeof configured.drainStoreOperationTimeoutMs === "number" && configured.drainStoreOperationTimeoutMs >= 1
            ? configured.drainStoreOperationTimeoutMs
            : 60_000;
        // `null` is an explicit opt-out of the scheduled-enqueue bound. A present
        // but non-positive number is a mistake, not an opt-out, so it falls back to
        // the framework default rather than silently disabling the watchdog.
        const scheduledEnqueueTimeoutMs = "scheduledEnqueueTimeoutMs" in configured
            ? (configured.scheduledEnqueueTimeoutMs === null ?
                null
                : (typeof configured.scheduledEnqueueTimeoutMs === "number" && configured.scheduledEnqueueTimeoutMs > 0 ?
                    configured.scheduledEnqueueTimeoutMs
                    : DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS))
            : DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS;
        const queues = configured.queues && typeof configured.queues === "object" ? configured.queues : {};
        // An explicit config value wins over the env var — including `null`/`0`,
        // which disable the backstop even when the environment sets a default.
        // Only fall through to the env var when config omits `jobTimeoutMs` entirely.
        const jobTimeoutMs = "jobTimeoutMs" in configured
            ? (typeof configured.jobTimeoutMs === "number" && configured.jobTimeoutMs > 0 ? configured.jobTimeoutMs : null)
            : (typeof envJobTimeout === "number" && Number.isFinite(envJobTimeout) && envJobTimeout > 0 ? envJobTimeout : null);
        const configuredRetention = configured.retention && typeof configured.retention === "object" ? configured.retention : {};
        const retention = {
            completedTtlMs: typeof configuredRetention.completedTtlMs === "number" || configuredRetention.completedTtlMs === null
                ? configuredRetention.completedTtlMs
                : 7 * 24 * 60 * 60 * 1000,
            failedTtlMs: typeof configuredRetention.failedTtlMs === "number" || configuredRetention.failedTtlMs === null
                ? configuredRetention.failedTtlMs
                : 30 * 24 * 60 * 60 * 1000,
            batchSize: typeof configuredRetention.batchSize === "number" && configuredRetention.batchSize > 0
                ? configuredRetention.batchSize
                : 1000,
            sweepIntervalMs: typeof configuredRetention.sweepIntervalMs === "number" && configuredRetention.sweepIntervalMs > 0
                ? configuredRetention.sweepIntervalMs
                : 60 * 60 * 1000
        };
        const jobClasses = this.getBackgroundJobClasses();
        return { host, port, databaseIdentifier, maxConcurrentForkedJobs, maxConcurrentInlineJobs, mode, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, pooledRunnerSilenceTimeoutMs, runnerMaxOldSpaceSizeMb, runnerMallocArenaMax, dispatchStrategy, pollIntervalMs, drainStoreOperationTimeoutMs, scheduledEnqueueTimeoutMs, queues, jobClasses, jobTimeoutMs, retention, generationId, initialGenerationState, lifecycleSocketPath };
    }
    /**
     * Returns statically registered portable background jobs.
     * @returns {import("./configuration-types.js").BackgroundJobClass[]} - Configured job classes.
     */
    getBackgroundJobClasses() {
        const jobClasses = this._backgroundJobs?.jobClasses;
        if (jobClasses === undefined)
            return [];
        if (!Array.isArray(jobClasses))
            throw new TypeError("backgroundJobs.jobClasses must be an array");
        return [...jobClasses];
    }
    /**
     * Resolves and memoizes one background-jobs adapter for this configuration lifecycle.
     * @returns {BackgroundJobsAdapter} - Active adapter.
     */
    getBackgroundJobsAdapter() {
        if (this._backgroundJobsAdapterGeneration)
            return this._backgroundJobsAdapterGeneration.adapter;
        const configuredAdapter = this._backgroundJobs?.adapter;
        const adapter = typeof configuredAdapter === "function"
            ? configuredAdapter({ configuration: this })
            : (configuredAdapter || this.getEnvironmentHandler().createBackgroundJobsAdapter({ configuration: this }));
        if (!(adapter instanceof BackgroundJobsAdapter)) {
            throw new TypeError("backgroundJobs.adapter must be a BackgroundJobsAdapter instance or a synchronous factory returning one");
        }
        this._backgroundJobsAdapterGeneration = {
            adapter,
            closing: false,
            closePromise: undefined,
            readyPromise: undefined
        };
        return adapter;
    }
    /**
     * Atomically acquires the exact ready adapter for the active lifecycle.
     * A close that claims the generation while readiness is pending wins: this
     * operation waits for that close, creates the next generation, readies it,
     * and returns only that live instance.
     * @returns {Promise<BackgroundJobsAdapter>} - Exact ready adapter generation.
     */
    async acquireReadyBackgroundJobsAdapter() {
        while (true) {
            const databaseClosePromise = this._closeDatabaseConnectionsPromise;
            if (databaseClosePromise) {
                await databaseClosePromise;
                continue;
            }
            this.getBackgroundJobsAdapter();
            const generation = this._backgroundJobsAdapterGeneration;
            if (!generation)
                throw new Error("Background jobs adapter generation was not created");
            if (generation.closing) {
                if (generation.closePromise)
                    await generation.closePromise;
                continue;
            }
            const readyPromise = generation.readyPromise || Promise.resolve().then(async () => {
                await generation.adapter.ensureReady();
            });
            generation.readyPromise = readyPromise;
            try {
                await readyPromise;
            }
            catch (error) {
                if (generation.readyPromise === readyPromise)
                    generation.readyPromise = undefined;
                throw error;
            }
            if (generation.closing) {
                if (generation.closePromise)
                    await generation.closePromise;
                continue;
            }
            if (this._backgroundJobsAdapterGeneration !== generation)
                continue;
            return generation.adapter;
        }
    }
    /**
     * Readies the active adapter once per lifecycle. A failed attempt remains retryable.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async ensureBackgroundJobsAdapterReady() {
        await this.acquireReadyBackgroundJobsAdapter();
    }
    /**
     * Returns health without resolving persistence in non-durable inline mode.
     * @returns {Promise<import("./background-jobs/types.js").BackgroundJobsHealth>} - Current health.
     */
    async backgroundJobsHealth() {
        if (this.getBackgroundJobsConfig().mode === "inline")
            return { ready: true };
        const adapter = await this.acquireReadyBackgroundJobsAdapter();
        return await adapter.health();
    }
    /**
     * Closes the resolved adapter once and clears lifecycle caches.
     * @returns {Promise<void>} - Resolves after close.
     */
    async closeBackgroundJobsAdapter() {
        const generation = this._backgroundJobsAdapterGeneration;
        if (!generation)
            return;
        if (generation.closePromise)
            return await generation.closePromise;
        generation.closing = true;
        const closePromise = (async () => {
            /** @type {Error[]} */
            const closeErrors = [];
            if (generation.readyPromise) {
                try {
                    await generation.readyPromise;
                }
                catch (error) {
                    closeErrors.push(error instanceof Error ? error : new Error(String(error)));
                }
            }
            try {
                await generation.adapter.close();
            }
            catch (error) {
                closeErrors.push(error instanceof Error ? error : new Error(String(error)));
            }
            if (closeErrors.length === 1)
                throw closeErrors[0];
            if (closeErrors.length > 1)
                throw new AggregateError(closeErrors, "Failed to ready and close the background-jobs adapter");
        })();
        generation.closePromise = closePromise;
        try {
            await closePromise;
        }
        finally {
            if (this._backgroundJobsAdapterGeneration === generation) {
                this._backgroundJobsAdapterGeneration = undefined;
            }
        }
    }
    /**
     * Runs set background jobs config.
     * @param {import("./configuration-types.js").BackgroundJobsConfiguration} backgroundJobs - Background jobs config.
     * @returns {void}
     */
    setBackgroundJobsConfig(backgroundJobs) {
        if (this._backgroundJobsAdapterGeneration && backgroundJobs.adapter !== undefined) {
            throw new Error("Cannot replace backgroundJobs.adapter during an active adapter lifecycle; close it first");
        }
        this._backgroundJobs = Object.assign({}, this._backgroundJobs, backgroundJobs);
    }
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
    getBeaconConfig() {
        const configured = this._beacon || {};
        const inProcess = configured.inProcess === true;
        if (inProcess && (configured.host || typeof configured.port === "number")) {
            throw new Error("Beacon configuration: `inProcess: true` is mutually exclusive with `host`/`port`. Use one or the other.");
        }
        const envHost = inProcess ? undefined : process.env.VELOCIOUS_BEACON_HOST;
        const envPortRaw = inProcess ? undefined : process.env.VELOCIOUS_BEACON_PORT;
        const envPort = envPortRaw ? Number(envPortRaw) : undefined;
        const host = configured.host || envHost || "127.0.0.1";
        const port = typeof configured.port === "number"
            ? configured.port
            : (typeof envPort === "number" && Number.isFinite(envPort) ? envPort : 7330);
        let enabled;
        if (typeof configured.enabled === "boolean") {
            enabled = configured.enabled;
        }
        else {
            enabled = Boolean(inProcess || configured.host || configured.port || envHost || envPort);
        }
        const unreachableReportMs = resolveBeaconUnreachableReportMs(configured.unreachableReportMs);
        return { enabled, host, port, peerType: configured.peerType, inProcess, unreachableReportMs };
    }
    /**
     * Runs set beacon config.
     * @param {import("./configuration-types.js").BeaconConfiguration} beacon - Beacon config.
     * @returns {void}
     */
    setBeaconConfig(beacon) {
        this._beacon = Object.assign({}, this._beacon, beacon);
    }
    /**
     * Runs get beacon client.
     * @returns {import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined} - The active Beacon client, if connected.
     */
    getBeaconClient() {
        return this._beaconClient;
    }
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
    async connectBeacon({ peerType } = {}) {
        if (this._beaconClient)
            return this._beaconClient;
        if (this._beaconConnectPromise)
            return await this._beaconConnectPromise;
        const config = this.getBeaconConfig();
        if (!config.enabled)
            return undefined;
        this._beaconConnectPromise = (async () => {
            const client = await this._createBeaconClient({
                config,
                peerType: peerType || config.peerType
            });
            client.onBroadcast((message) => {
                // Synapse-style fan-out: deliver every broadcast we receive
                // from the bus through the local delivery path. Echoes of our
                // own publishes follow the same path so every peer sees the
                // same delivery semantics.
                this._deliverBroadcastFromBeacon(message);
            });
            // Beacon connect/disconnect blips are expected during deploys (the broker
            // restarts) and the BeaconClient auto-reconnects in the background, so a
            // single transient failure is NOT reported. Only a sustained outage (still
            // down after `unreachableReportMs`) is surfaced on the framework-error
            // channel; a (re)connect within the grace window clears it silently.
            // `connect-error` fires when the *initial* TCP/handshake fails.
            client.on("connect-error", (error) => {
                this._handleBeaconDown({ stage: "beacon-connect", error, reportAfterMs: config.unreachableReportMs });
            });
            // `disconnect` fires when an established connection drops. The payload is
            // the underlying socket error if there was one, or a synthetic
            // Error("Beacon broker disconnected") otherwise.
            client.on("disconnect", (reason) => {
                this._handleBeaconDown({ stage: "beacon-disconnect", error: reason, reportAfterMs: config.unreachableReportMs });
            });
            // `connect` fires on every (re)connect; clear any pending outage state so
            // a transient blip that recovers within the grace window stays silent.
            client.on("connect", () => {
                this._handleBeaconUp();
            });
            // Register the client *before* kicking off connect so subsequent
            // `connectBeacon()` calls return this same instance instead of
            // racing to construct a second one.
            this._beaconClient = client;
            if (config.inProcess) {
                // In-process connect is synchronous, cannot fail, and resolves
                // before this await yields — callers can rely on
                // `isConnected() === true` immediately after `connectBeacon()`.
                await client.connect();
            }
            else {
                // Fire-and-forget the TCP connect. Awaiting here would block
                // startup on the OS TCP connect timeout (75s default on Linux)
                // when the broker silently drops SYNs. Failures surface
                // asynchronously via the `connect-error` listener registered
                // above; the BeaconClient's reconnect loop keeps trying.
                void client.connect().catch(() => {
                    // Already reported via connect-error above.
                });
            }
            return client;
        })();
        return await this._beaconConnectPromise;
    }
    /**
     * Builds a Beacon client matching the configured mode. Split out so
     * `connectBeacon` stays focused on lifecycle and error wiring.
     * @param {object} args - Options.
     * @param {ReturnType<VelociousConfiguration["getBeaconConfig"]>} args.config - Resolved Beacon config.
     * @param {string} [args.peerType] - Resolved peer type.
     * @returns {Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default>} - Beacon client.
     */
    async _createBeaconClient({ config, peerType }) {
        // Route through the environment handler so the Node-only `node:net`
        // / `node:crypto` deps in the Beacon client modules don't get pulled
        // into browser bundles. Browser bundles statically reach
        // `Configuration` (via `Logger`); putting the dynamic
        // `import("./beacon/...")` calls here would still drag those modules
        // through esbuild's static analysis. Hiding the imports inside the
        // Node environment handler keeps them off the browser path —
        // browser-bundled apps never reach `environment-handlers/node.js`.
        const handler = this.getEnvironmentHandler();
        if (config.inProcess) {
            const InProcessBeaconClient = await handler.loadInProcessBeaconClient();
            return new InProcessBeaconClient({ peerType });
        }
        const BeaconClient = await handler.loadBeaconClient();
        return new BeaconClient({
            host: config.host,
            port: config.port,
            peerType
        });
    }
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
    _handleBeaconDown({ stage, error, reportAfterMs }) {
        this._beaconLastDownError = { stage, error };
        // A report is already pending or already sent for this outage — keep the
        // latest error but don't stack timers or re-report.
        if (this._beaconReportTimer || this._beaconOutageReported)
            return;
        const timer = setTimeout(() => {
            this._beaconReportTimer = undefined;
            if (this._beaconClient?.isConnected()) {
                this._handleBeaconUp();
                return;
            }
            this._beaconOutageReported = true;
            if (this._beaconLastDownError)
                this._reportBeaconError(this._beaconLastDownError);
        }, reportAfterMs);
        // Don't let the grace timer keep the process alive.
        if (typeof timer.unref === "function")
            timer.unref();
        this._beaconReportTimer = timer;
    }
    /**
     * Clears beacon-down state on a (re)connect. A blip that recovers within the
     * grace window is never reported; if a sustained outage had already been
     * reported, the state resets so a future outage can report again.
     * @returns {void}
     */
    _handleBeaconUp() {
        if (this._beaconReportTimer) {
            clearTimeout(this._beaconReportTimer);
            this._beaconReportTimer = undefined;
        }
        this._beaconOutageReported = false;
        this._beaconLastDownError = undefined;
    }
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
    _reportBeaconError({ stage, error }) {
        const errorEvents = this._errorEvents;
        const hasListener = errorEvents.listenerCount("framework-error") > 0
            || errorEvents.listenerCount("all-error") > 0;
        const payload = {
            context: { stage },
            error
        };
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
        if (!hasListener) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[velocious framework-error stage=${stage}] ${message} — register a listener via configuration.getErrorEvents().on("framework-error", …) to suppress this stderr fallback`);
            void Promise.reject(error);
        }
    }
    /**
     * Closes the active Beacon client (if any). Safe to call multiple
     * times.
     * @returns {Promise<void>}
     */
    async disconnectBeacon() {
        const client = this._beaconClient;
        this._beaconClient = undefined;
        this._beaconConnectPromise = undefined;
        if (this._beaconReportTimer) {
            clearTimeout(this._beaconReportTimer);
            this._beaconReportTimer = undefined;
        }
        this._beaconOutageReported = false;
        this._beaconLastDownError = undefined;
        if (client)
            await client.close();
    }
    /**
     * Routes a Beacon-sourced broadcast through the same delivery code
     * path as a locally-originated one. Prefers the workerthread-aware
     * `broadcastV2` when an HTTP server is hosting workers, and falls
     * back to the per-process subscription dispatch otherwise.
     * @param {import("./beacon/types.js").BeaconBroadcastMessage} message - Broadcast message.
     * @returns {void}
     */
    _deliverBroadcastFromBeacon(message) {
        /**
         * Websocket events.
         * @type {ReturnType<typeof JSON.parse>} */
        const websocketEvents = this._websocketEvents;
        if (websocketEvents && typeof websocketEvents.broadcastV2 === "function") {
            websocketEvents.broadcastV2({
                channel: message.channel,
                broadcastParams: message.broadcastParams,
                body: message.body,
                configuration: this
            });
            return;
        }
        this._broadcastToChannelLocal(message.channel, message.broadcastParams, message.body);
    }
    /**
     * Runs get scheduled background jobs config.
     * @returns {Promise<import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | undefined>} - Scheduled background jobs configuration.
     */
    async getScheduledBackgroundJobsConfig() {
        if (!this._scheduledBackgroundJobs) {
            return undefined;
        }
        if (typeof this._scheduledBackgroundJobs === "function") {
            return await this._scheduledBackgroundJobs({ configuration: this });
        }
        return this._scheduledBackgroundJobs;
    }
    /**
     * Runs set scheduled background jobs config.
     * @param {import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | import("./configuration-types.js").ScheduledBackgroundJobsLoaderType | undefined} scheduledBackgroundJobs - Scheduled background jobs configuration.
     * @returns {void}
     */
    setScheduledBackgroundJobsConfig(scheduledBackgroundJobs) {
        this._scheduledBackgroundJobs = scheduledBackgroundJobs;
    }
    /**
     * Runs get mailer backend.
     * @returns {import("./configuration-types.js").MailerBackend | undefined} - Mailer backend.
     */
    getMailerBackend() {
        return this._mailerBackend;
    }
    /**
     * Runs set mailer backend.
     * @param {import("./configuration-types.js").MailerBackend | undefined} mailerBackend - Mailer backend, or undefined to remove it.
     * @returns {void} - No return value.
     */
    setMailerBackend(mailerBackend) {
        this._mailerBackend = mailerBackend;
    }
    /**
     * Logging configuration tailored for HTTP request logging. Defaults console logging to true and applies the user `logging.console` flag only for request logging.
     * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Pick<import("./configuration-types.js").LoggingConfiguration, "directory" | "filePath"> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>} - The http logging configuration.
     */
    getHttpLoggingConfiguration() {
        return this.getLoggingConfiguration({ defaultConsole: true });
    }
    /**
     * Runs get environment handler.
     * @returns {import("./environment-handlers/base.js").default} - The environment handler.
     */
    getEnvironmentHandler() {
        if (!this._environmentHandler)
            throw new Error("No environment handler set");
        return this._environmentHandler;
    }
    /**
     * Runs get locale fallbacks.
     * @returns {import("./configuration-types.js").LocaleFallbacksType | undefined} - The locale fallbacks.
     */
    getLocaleFallbacks() { return this.localeFallbacks; }
    /**
     * Runs set locale fallbacks.
     * @param {import("./configuration-types.js").LocaleFallbacksType} newLocaleFallbacks - New locale fallbacks.
     * @returns {void} - No return value.
     */
    setLocaleFallbacks(newLocaleFallbacks) { this.localeFallbacks = newLocaleFallbacks; }
    /**
     * Runs get structure sql config.
     * @returns {import("./configuration-types.js").StructureSqlConfiguration | undefined} - Structure SQL config.
     */
    getStructureSqlConfig() { return this._structureSql; }
    /**
     * Runs should write structure sql.
     * @param {{reason?: "migration" | "schemaDump"}} [args] - Call context for the structure sql write decision.
     * @returns {boolean} - Whether structure SQL files should be generated for the current environment.
     */
    shouldWriteStructureSql(args = {}) {
        const { reason = "migration" } = args;
        const config = this.getStructureSqlConfig();
        const enabledEnvironments = config?.enabledEnvironments;
        const disabledEnvironments = config?.disabledEnvironments;
        if (reason === "schemaDump") {
            return true;
        }
        if (Array.isArray(enabledEnvironments)) {
            return enabledEnvironments.includes(this.getEnvironment());
        }
        if (Array.isArray(disabledEnvironments) && disabledEnvironments.includes(this.getEnvironment())) {
            return false;
        }
        if (this.getEnvironment() === "test") {
            return false;
        }
        return true;
    }
    /**
     * Runs set structure sql config.
     * @param {import("./configuration-types.js").StructureSqlConfiguration} structureSql - Structure SQL config.
     * @returns {void} - No return value.
     */
    setStructureSqlConfig(structureSql) {
        this._structureSql = structureSql;
    }
    /**
     * Runs get locale.
     * @returns {string} - The locale.
     */
    getLocale() {
        if (typeof this.locale == "function") {
            return this.locale();
        }
        else if (this.locale) {
            return this.locale;
        }
        else {
            return this.getLocales()[0];
        }
    }
    /**
     * Runs get locales.
     * @returns {Array<string>} - The locales.
     */
    getLocales() { return digg(this, "locales"); }
    /**
     * Runs get model class.
     * @param {string} name - Name.
     * @returns {typeof import("./database/record/index.js").default} - The model class.
     */
    getModelClass(name) {
        const modelClass = this.modelClasses[name];
        if (!modelClass)
            throw new Error(`No such model class ${name} in ${Object.keys(this.modelClasses).join(", ")}}`);
        return modelClass;
    }
    /**
     * Runs get model classes.
     * @returns {Record<string, typeof import("./database/record/index.js").default>} A hash of all model classes, keyed by model name, as they were defined in the configuration. This is a direct reference to the model classes, not a copy.
     */
    getModelClasses() {
        return this.modelClasses;
    }
    /**
     * Runs get testing.
     * @returns {string | undefined} The path to a config file that should be used for testing.
     */
    getTesting() { return this._testing; }
    /**
     * Runs get trusted proxies.
     * @returns {string | string[] | undefined} Trusted reverse proxy address ranges.
     */
    getTrustedProxies() { return this._trustedProxies; }
    /**
     * Runs set trusted proxies.
     * @param {string | string[] | undefined} trustedProxies - Trusted reverse proxy address ranges.
     * @returns {void}
     */
    setTrustedProxies(trustedProxies) { this._trustedProxies = trustedProxies; }
    /**
     * Runs initialize database pool.
     * @param {string} [identifier] - Database identifier to initialize.
     * @returns {void} - No return value.
     */
    initializeDatabasePool(identifier = "default") {
        if (!this.database)
            throw new Error("No 'database' was given");
        if (this.databasePools[identifier])
            throw new Error("DatabasePool has already been initialized");
        const PoolType = this.getDatabasePoolType(identifier);
        this.databasePools[identifier] = new PoolType({ configuration: this, identifier });
        this.databasePools[identifier].setCurrent();
    }
    /**
     * Runs is database pool initialized.
     * @param {string} [identifier] - Database identifier to check.
     * @returns {boolean} - Whether database pool initialized.
     */
    isDatabasePoolInitialized(identifier = "default") { return Boolean(this.databasePools[identifier]); }
    /**
     * Runs is initialized.
     * @returns {boolean} - Whether initialized.
     */
    isInitialized() { return this._isInitialized; }
    /**
     * Returns the framework-owned process context for this configuration's
     * lifecycle. It is undefined until `initialize()` starts, and it carries the
     * process `type` (`server`, `worker-handler`, background-jobs types, or an
     * application-defined string) so hooks and framework services can tell which
     * process they are running in.
     * @returns {import("./configuration-types.js").ApplicationProcessContext | undefined} - Process context, when initialization has started.
     */
    getApplicationProcessContext() { return this._applicationProcessContext; }
    /**
     * Runs initialize models.
     * @param {object} args - Options object.
     * @param {string} args.type - Type identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initializeModels(args = { type: "server" }) {
        const modelInitializationGeneration = this._modelInitializationGeneration;
        if (this._modelsInitialized)
            return;
        if (this._initializeModelsPromise) {
            const initializeModelsPromise = this._initializeModelsPromise;
            await initializeModelsPromise;
            if (this._modelInitializationGeneration === modelInitializationGeneration && !this._modelsInitialized) {
                if (this._initializeModelsPromise === initializeModelsPromise) {
                    this._initializeModelsPromise = undefined;
                }
                return await this.initializeModels(args);
            }
            return;
        }
        const initializeModelsPromise = (async () => {
            const shouldSkipDummyModelInitialization = globalThis.process?.env.VELOCIOUS_SKIP_DUMMY_MODEL_INITIALIZATION === "1"
                && globalThis.process?.env.VELOCIOUS_BROWSER_TESTS === "true"
                && this.getEnvironment() === "test";
            if (!shouldSkipDummyModelInitialization) {
                if (this._initializeModels) {
                    await this._initializeModels({ configuration: this, processContext: this.getApplicationProcessContext(), type: args.type });
                }
                await this.getEnvironmentHandler().initializePackageModels(this);
                await initializeAuditedModelRelationships(this);
                await this.getEnvironmentHandler().initializeFrontendModelWebsocketPublishers(this);
            }
            if (this._modelInitializationGeneration === modelInitializationGeneration) {
                this._modelsInitialized = true;
            }
        })();
        this._initializeModelsPromise = initializeModelsPromise;
        try {
            await initializeModelsPromise;
        }
        finally {
            if (this._initializeModelsPromise === initializeModelsPromise) {
                this._initializeModelsPromise = undefined;
            }
        }
    }
    /**
     * Ensures each configured database pool has a global connection available.
     * Useful when `getCurrentConnection` might be called without an async context.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async ensureGlobalConnections() {
        for (const identifier of this.getDatabaseIdentifiers()) {
            const pool = this.getDatabasePool(identifier);
            await pool.ensureGlobalConnection();
        }
    }
    /**
     * Runs initialize.
     * @param {object} args - Options object.
     * @param {string} args.type - Type identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initialize({ type } = { type: "undefined" }) {
        if (this._queuedInitializePromise)
            return this._queuedInitializePromise;
        if (this._shutdownPromise) {
            return this._queueInitialize({ continueAfterWaitFailure: true, type, waitFor: this._shutdownPromise });
        }
        if (this._closeDatabaseConnectionsPromise) {
            return this._queueInitialize({ continueAfterWaitFailure: false, type, waitFor: this._closeDatabaseConnectionsPromise });
        }
        return this._beginInitialize({ type });
    }
    /**
     * Starts or joins initialization after lifecycle blockers have settled.
     * @param {object} args - Startup options.
     * @param {string} args.type - Generic application process type.
     * @returns {Promise<void>} - Shared startup promise.
     */
    _beginInitialize({ type }) {
        const initializationGeneration = this._modelInitializationGeneration;
        if (this._initializePromise && this._initializePromiseGeneration === initializationGeneration) {
            return this._initializePromise;
        }
        if (this._initializePromise) {
            return this._queueInitialize({ continueAfterWaitFailure: false, type, waitFor: this._initializePromise });
        }
        if (this._isInitialized) {
            this._initializePromise = Promise.resolve();
            this._initializePromiseGeneration = initializationGeneration;
            return this._initializePromise;
        }
        // Memoize the in-progress initialization so concurrent callers await the same
        // bootstrap instead of racing. `_isInitialized` was previously set to `true`
        // up front, so a second caller (e.g. a pooled runner with
        // `pooledRunnerConcurrency > 1` starting several jobs on a cold child) could
        // skip initialization and load models / perform a job while the first call
        // was still awaiting model discovery and initializers. Mirrors connectBeacon.
        const initializePromise = this._runInitialize({ initializationGeneration, type });
        this._initializePromise = initializePromise;
        this._initializePromiseGeneration = initializationGeneration;
        return initializePromise;
    }
    /**
     * Queues one shared initialization behind an incompatible lifecycle phase.
     * @param {object} args - Queue options.
     * @param {boolean} args.continueAfterWaitFailure - Whether a completed failed shutdown still permits replacement startup.
     * @param {string} args.type - Replacement process type.
     * @param {Promise<void>} args.waitFor - Lifecycle phase that must settle first.
     * @returns {Promise<void>} - Shared queued startup promise.
     */
    _queueInitialize({ continueAfterWaitFailure, type, waitFor }) {
        if (this._queuedInitializePromise)
            return this._queuedInitializePromise;
        const queuedInitializePromise = (async () => {
            await this._waitForInitializeBlocker({ continueAfterWaitFailure, waitFor });
            if (this._shutdownPromise === waitFor)
                this._shutdownPromise = undefined;
            if (this._initializePromise === waitFor) {
                this._initializePromise = undefined;
                this._initializePromiseGeneration = undefined;
            }
            const shutdownPromise = this._shutdownPromise;
            if (shutdownPromise) {
                await this._waitForInitializeBlocker({ continueAfterWaitFailure: true, waitFor: shutdownPromise });
                if (this._shutdownPromise === shutdownPromise)
                    this._shutdownPromise = undefined;
            }
            if (this._initializePromise && this._initializePromiseGeneration !== this._modelInitializationGeneration) {
                const staleInitializePromise = this._initializePromise;
                await staleInitializePromise;
                if (this._initializePromise === staleInitializePromise) {
                    this._initializePromise = undefined;
                    this._initializePromiseGeneration = undefined;
                }
            }
            await this._beginInitialize({ type });
        })().finally(() => {
            this._queuedInitializePromise = undefined;
        });
        this._queuedInitializePromise = queuedInitializePromise;
        return queuedInitializePromise;
    }
    /**
     * Waits for a lifecycle phase before queued initialization proceeds.
     * @param {object} args - Wait policy.
     * @param {boolean} args.continueAfterWaitFailure - Whether replacement startup remains available after a failed phase.
     * @param {Promise<void>} args.waitFor - Lifecycle phase that must settle first.
     * @returns {Promise<void>} - Resolves when queued initialization may continue.
     */
    async _waitForInitializeBlocker({ continueAfterWaitFailure, waitFor }) {
        try {
            await waitFor;
        }
        catch (error) {
            if (!continueAfterWaitFailure)
                throw error;
        }
    }
    /**
     * Runs one atomic framework and application initialization attempt.
     * @param {object} args - Initialization identity.
     * @param {number} args.initializationGeneration - Framework model generation.
     * @param {string} args.type - Generic application process type.
     * @returns {Promise<void>} - Resolves when initialized.
     */
    async _runInitialize({ initializationGeneration, type }) {
        const startsApplicationLifecycle = !this._applicationLifecycleInitialized;
        if (startsApplicationLifecycle) {
            this._applicationProcessContext = Object.freeze({
                instanceId: new UUID(4).format(),
                type
            });
        }
        try {
            await this.initializeModels({ type });
            // Model initialization can be invalidated by a concurrent connection close.
            // If models are not ready, stop without marking the configuration initialized
            // so the next caller retries a full bootstrap.
            if (this._modelInitializationGeneration !== initializationGeneration || !this._modelsInitialized) {
                if (startsApplicationLifecycle)
                    this._resetApplicationLifecycle();
                return;
            }
            await this.getEnvironmentHandler().autoDiscoverResources(this);
            this._mergeDiscoveredAbilityResources();
            this._validateResourceRelationshipsOnModels();
            if (startsApplicationLifecycle && this._initializers) {
                const initializers = await this._initializers({ configuration: this });
                const { requireContext, ...restArgs } = initializers;
                restArgsError(restArgs);
                if (requireContext) {
                    for (const initializerKey of requireContext.keys()) {
                        const InitializerClass = requireContext(initializerKey).default;
                        const processContext = this._applicationProcessContext;
                        if (!processContext)
                            throw new Error("Application process context is not available during initializer startup");
                        const initializerInstance = new InitializerClass({ configuration: this, processContext, type });
                        await initializerInstance.run();
                        this._successfulInitializers.push(initializerInstance);
                    }
                }
            }
            if (startsApplicationLifecycle)
                this._applicationLifecycleInitialized = true;
            if (this._modelInitializationGeneration === initializationGeneration) {
                this._isInitialized = true;
            }
        }
        catch (error) {
            if (startsApplicationLifecycle) {
                let teardownError;
                try {
                    await this._teardownSuccessfulInitializers();
                }
                catch (caughtTeardownError) {
                    teardownError = caughtTeardownError;
                }
                finally {
                    this._resetApplicationLifecycle();
                }
                if (teardownError instanceof AggregateError) {
                    throw new AggregateError([error, ...teardownError.errors], "Application process startup and cleanup failed", { cause: error });
                }
                if (teardownError !== undefined) {
                    throw new AggregateError([error, teardownError], "Application process startup and cleanup failed", { cause: error });
                }
            }
            throw error;
        }
        finally {
            if (!this._isInitialized && this._initializePromiseGeneration === initializationGeneration) {
                this._initializePromise = undefined;
                this._initializePromiseGeneration = undefined;
            }
        }
    }
    /**
     * Tears down every successfully started initializer in reverse order.
     * @returns {Promise<void>} - Resolves when every teardown succeeds.
     */
    async _teardownSuccessfulInitializers() {
        const successfulInitializers = this._successfulInitializers.splice(0).reverse();
        await runShutdownSteps({
            message: "Application initializer teardown failed",
            steps: successfulInitializers.map((initializer) => async () => await initializer.teardown())
        });
    }
    /** Clears application-owned lifecycle state after every teardown attempt. */
    _resetApplicationLifecycle() {
        this._applicationLifecycleInitialized = false;
        this._applicationProcessContext = undefined;
        this._successfulInitializers = [];
    }
    /**
     * Tears down the current application lifecycle once.
     * @returns {Promise<void>} - Exact shared shutdown promise.
     */
    shutdown() {
        if (this._shutdownPromise)
            return this._shutdownPromise;
        const initializePromise = this._initializePromise;
        const shutdownPromise = (async () => {
            try {
                if (initializePromise)
                    await initializePromise;
                await this._teardownSuccessfulInitializers();
            }
            finally {
                this._resetApplicationLifecycle();
                this._isInitialized = false;
                if (this._initializePromise === initializePromise) {
                    this._initializePromise = undefined;
                    this._initializePromiseGeneration = undefined;
                }
            }
        })();
        this._shutdownPromise = shutdownPromise;
        return shutdownPromise;
    }
    /**
     * Validates that resource-defined relationships are also defined on the corresponding model classes.
     * Throws an error if a relationship is defined on a resource but missing from the model.
     * @returns {void}
     */
    _validateResourceRelationshipsOnModels() {
        for (const backendProject of this._backendProjects) {
            const resources = frontendModelResourcesForBackendProject(backendProject);
            for (const [modelName, resourceDefinition] of Object.entries(resources)) {
                const resourceConfig = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
                if (!resourceConfig?.relationships)
                    continue;
                if (!Array.isArray(resourceConfig.relationships)) {
                    throw new Error(`Resource for ${modelName} defines relationships as an object. Use an array instead: static relationships = ${JSON.stringify(Object.keys(resourceConfig.relationships))}`);
                }
                const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition);
                if (!resourceClass) {
                    throw new Error(`Frontend model resource for ${modelName} must be a FrontendModelBaseResource subclass.`);
                }
                const modelClass = resourceClass.modelClass();
                const existingRelationships = modelClass.getRelationshipsMap();
                for (const relationshipName of resourceConfig.relationships) {
                    if (!(relationshipName in existingRelationships)) {
                        throw new Error(`Resource for ${modelName} defines relationship "${relationshipName}" but ${modelName} model does not. ` +
                            `Add ${modelName}.belongsTo("${relationshipName}", ...) or the appropriate relationship call on the model class.`);
                    }
                }
            }
        }
    }
    /**
     * Runs register model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {void} - No return value.
     */
    registerModelClass(modelClass) {
        this.modelClasses[modelClass.getModelName()] = modelClass;
    }
    /**
     * Runs set current.
     * @returns {void} - No return value.
     */
    setCurrent() {
        setCurrentConfiguration(this);
    }
    /**
     * Runs get routes.
     * @returns {import("./routes/index.js").default | undefined} - The routes.
     */
    getRoutes() { return this._routes; }
    /**
     * Runs set routes.
     * @param {import("./routes/index.js").default} newRoutes - New routes.
     * @returns {void} - No return value.
     */
    setRoutes(newRoutes) {
        this._routes = newRoutes;
        this._applyRouteMounts(newRoutes);
    }
    /**
     * Applies any `route.mount(...)` registrations from the routes file by letting
     * each mountable register its routes (typically route-resolver hooks) against
     * this configuration. Guarded so repeated setRoutes calls with the same routes
     * don't register a mount more than once.
     * @param {import("./routes/index.js").default} newRoutes - Routes instance.
     * @returns {void} - No return value.
     */
    _applyRouteMounts(newRoutes) {
        if (!newRoutes || typeof newRoutes.getMounts !== "function")
            return;
        for (const mount of newRoutes.getMounts()) {
            if (this._appliedRouteMounts.has(mount))
                continue;
            this._appliedRouteMounts.add(mount);
            mount.mountable.mountInto({ configuration: this, ...mount.options });
        }
    }
    /**
     * Adds plugin/library routes using a lightweight route DSL backed by route resolver hooks.
     * @param {(routes: import("./routes/plugin-routes.js").default) => void} callback - Routes callback.
     * @returns {void} - No return value.
     */
    routes(callback) {
        const pluginRoutes = new PluginRoutes({ configuration: this });
        callback(pluginRoutes);
    }
    /**
     * Runs set translator.
     * @param {(arg1: string, arg2: Record<string, ReturnType<typeof JSON.parse>> | undefined) => string} callback - Translator callback.
     * @returns {void} - No return value.
     */
    setTranslator(callback) { this._translator = callback; }
    /**
     * Runs default translator.
     * @param {string} msgID - Msg id.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args] - Translator options and variables.
     * @returns {string} - The default translator.
     */
    _defaultTranslator(msgID, args) {
        this._configureDefaultTranslator();
        const translateArgs = args ? { ...args } : undefined;
        const defaultValue = translateArgs?.defaultValue;
        const locales = translateArgs?.locales;
        if (translateArgs) {
            delete translateArgs.defaultValue;
            delete translateArgs.locales;
        }
        const variables = translateArgs && Object.keys(translateArgs).length > 0 ? translateArgs : undefined;
        const locale = this.getLocale();
        const preferredLocales = locales || (locale ? undefined : []);
        const message = translate(msgID, variables, preferredLocales);
        if (message === msgID && defaultValue)
            return translate(defaultValue, variables, []);
        return message;
    }
    /**
     * Runs get translator.
     * @returns {(msgID: string, args?: Record<string, ReturnType<typeof JSON.parse>>) => string} - The configured translator.
     */
    getTranslator() {
        if (this._translator)
            return this._translator;
        if (!this._defaultTranslatorBound) {
            this._defaultTranslatorBound = this._defaultTranslator.bind(this);
        }
        return this._defaultTranslatorBound;
    }
    /**
     * Runs configure default translator.
     * @returns {void} - Configure gettext defaults for this configuration.
     */
    _configureDefaultTranslator() {
        const locale = this.getLocale();
        gettextConfig.setLocale(locale || "");
        const fallbacks = locale ? this.getLocaleFallbacks()?.[locale] : [];
        gettextConfig.setFallbacks(fallbacks || []);
    }
    /**
     * Runs get timezone offset minutes.
     * @returns {number | undefined} - The timezone offset in minutes.
     */
    getTimezoneOffsetMinutes() {
        if (typeof this._timezoneOffsetMinutes === "function") {
            const configuredOffset = this._timezoneOffsetMinutes();
            if (typeof configuredOffset === "number")
                return configuredOffset;
        }
        if (typeof this._timezoneOffsetMinutes === "number") {
            return this._timezoneOffsetMinutes;
        }
        return new Date().getTimezoneOffset();
    }
    /**
     * Runs get time zone.
     * @returns {string | undefined} - Configured timezone identifier.
     */
    getTimeZone() {
        const timeZone = typeof this._timeZone === "function"
            ? this._timeZone()
            : this._timeZone;
        if (timeZone === undefined || timeZone === null)
            return undefined;
        return validateTimeZone(timeZone, "configuration timeZone");
    }
    /**
     * Runs get websocket events.
     * @returns {import("./http-server/websocket-events.js").default | undefined} - The websocket events.
     */
    getWebsocketEvents() {
        return this._websocketEvents;
    }
    /**
     * Runs set websocket events.
     * @param {import("./http-server/websocket-events.js").default} websocketEvents - Websocket events.
     * @returns {void} - No return value.
     */
    setWebsocketEvents(websocketEvents) {
        this._websocketEvents = websocketEvents;
    }
    /**
     * Per-process registry of channel subscribers used by worker code that
     * needs to react to events broadcast via `websocketEventsHost.publish(...)`
     * without holding an actual websocket session.
     * @returns {import("./http-server/websocket-channel-subscribers.js").default} - The channel subscribers registry.
     */
    getWebsocketChannelSubscribers() {
        if (!this._websocketChannelSubscribers) {
            this._websocketChannelSubscribers = new VelociousWebsocketChannelSubscribers();
        }
        return this._websocketChannelSubscribers;
    }
    /**
     * Runs get websocket channel resolver.
     * @returns {import("./configuration-types.js").WebsocketChannelResolverType | undefined} - The websocket channel resolver.
     */
    getWebsocketChannelResolver() {
        return this._websocketChannelResolver;
    }
    /**
     * Registers a `VelociousWebsocketConnection` subclass under a name.
     * Clients that send `{type: "connection-open", connectionType: name}`
     * will have this class instantiated for their connection.
     * @param {string} name - Client-facing connection type name.
     * @param {typeof import("./http-server/websocket-connection.js").default} ConnectionClass - Websocket connection class.
     * @returns {void}
     */
    registerWebsocketConnection(name, ConnectionClass) {
        if (!name)
            throw new Error("Connection name is required");
        if (!ConnectionClass)
            throw new Error("ConnectionClass is required");
        this._websocketConnectionClasses.set(name, ConnectionClass);
    }
    /**
     * Runs get websocket connection class.
     * @param {string} name - Connection type name to look up.
     * @returns {typeof import("./http-server/websocket-connection.js").default | undefined} - Registered websocket connection class.
     */
    getWebsocketConnectionClass(name) {
        return this._websocketConnectionClasses.get(name);
    }
    /**
     * Registers a `VelociousWebsocketChannel` subclass under a name.
     * Clients subscribe via `{type: "channel-subscribe", channelType: name, ...}`.
     * @param {string} name - Client-facing channel type name.
     * @param {typeof import("./http-server/websocket-channel.js").default} ChannelClass - Websocket channel class.
     * @param {{liveOnly?: boolean}} [options] - Registration options.
     * @returns {void}
     */
    registerWebsocketChannel(name, ChannelClass, { liveOnly = false } = {}) {
        if (!name)
            throw new Error("Channel name is required");
        if (!ChannelClass)
            throw new Error("ChannelClass is required");
        this._websocketChannelClasses.set(name, ChannelClass);
        if (liveOnly)
            this._liveOnlyWebsocketChannels.add(name);
    }
    /**
     * Runs get websocket channel class.
     * @param {string} name - Channel type name to look up.
     * @returns {typeof import("./http-server/websocket-channel.js").default | undefined} - Registered websocket channel class.
     */
    getWebsocketChannelClass(name) {
        return this._websocketChannelClasses.get(name);
    }
    /**
     * Whether a channel type was registered with `{liveOnly: true}`.
     * Live-only channels are never persisted for replay: the event-log
     * store's `markChannelInterested` throws for their names.
     * @param {string} name - Channel type name to look up.
     * @returns {boolean} - Whether the channel is declared live-only.
     */
    isWebsocketChannelLiveOnly(name) {
        return this._liveOnlyWebsocketChannels.has(name);
    }
    /**
     * Tracks a live channel subscription in the global routing registry.
     * Called by the session when `canSubscribe()` resolves truthy; the
     * session calls `_unregisterWebsocketChannelSubscription` on unsubscribe.
     * @param {string} name - Channel type used as the routing key.
     * @param {import("./http-server/websocket-channel.js").default} subscription - Live channel subscription to register.
     * @returns {void}
     */
    _registerWebsocketChannelSubscription(name, subscription) {
        let bucket = this._websocketChannelSubscriptions.get(name);
        if (!bucket) {
            bucket = new Set();
            this._websocketChannelSubscriptions.set(name, bucket);
        }
        bucket.add(subscription);
    }
    /**
     * Runs unregister websocket channel subscription.
     * @param {string} name - Channel type used as the routing key.
     * @param {import("./http-server/websocket-channel.js").default} subscription - Live channel subscription to remove.
     * @returns {void}
     */
    _unregisterWebsocketChannelSubscription(name, subscription) {
        const bucket = this._websocketChannelSubscriptions.get(name);
        if (!bucket)
            return;
        bucket.delete(subscription);
        if (bucket.size === 0) {
            this._websocketChannelSubscriptions.delete(name);
        }
    }
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
    getWebsocketSessionGraceSeconds() { return this._websocketSessionGraceSeconds; }
    /**
     * Runs get websocket session heartbeat seconds.
     * @returns {number} - Interval (seconds) between server→client heartbeat pings; 0 disables reaping.
     */
    getWebsocketSessionHeartbeatSeconds() { return this._websocketSessionHeartbeatSeconds; }
    /**
     * Gets per-session WebSocket inbound message queue limits.
     * @returns {{maxBytes: number, maxMessages: number}} - Per-session inbound queue high-water marks.
     */
    getWebsocketInboundQueueLimits() {
        const queue = this.httpServer.websocketInboundQueue;
        return {
            maxBytes: queue.maxPendingBytes,
            maxMessages: queue.maxPendingMessages
        };
    }
    /**
     * Gets per-client WebSocket outbound queue limits.
     * @returns {{maxBytes: number, maxFrames: number}} - Per-client outbound queue high-water marks.
     */
    getWebsocketOutboundQueueLimits() {
        const queue = this.httpServer.websocketOutboundQueue;
        return {
            maxBytes: queue.maxPendingBytes,
            maxFrames: queue.maxPendingFrames
        };
    }
    /**
     * Registers a wrapper invoked around every WS-borne request /
     * connection message / channel dispatch. The wrapper receives the
     * session and a `next` callback; it must call `next()` to run the
     * handler. Use it to set up AsyncLocalStorage per request.
     * @param {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null} wrapper - Per-message session-context wrapper, or null to disable it.
     * @returns {void}
     */
    setWebsocketAroundRequest(wrapper) {
        this._websocketAroundRequest = wrapper;
    }
    /**
     * Runs get websocket around request.
     * @returns {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null} - Websocket session wrapper.
     */
    getWebsocketAroundRequest() {
        return this._websocketAroundRequest;
    }
    /**
     * Registers a wrapper invoked around every controller action — both
     * HTTP and WS-borne. Receives `{request, response, next}` and must
     * call `next()` to run the action. Use it for per-request context
     * like AsyncLocalStorage-scoped locale or tracing.
     * @param {((context: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default, next: () => Promise<void>}) => Promise<void>) | null} wrapper - Per-action request-context wrapper, or null to disable it.
     * @returns {void}
     */
    setAroundAction(wrapper) {
        this._aroundAction = wrapper;
    }
    /**
     * Runs get around action.
     * @returns {((context: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default, next: () => Promise<void>}) => Promise<void>) | null} - HTTP request wrapper.
     */
    getAroundAction() {
        return this._aroundAction;
    }
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
    setWebsocketSessionIdentityResolver(resolver) {
        this._websocketSessionIdentityResolver = resolver;
    }
    /**
     * Runs get websocket session identity resolver.
     * @returns {((session: import("./http-server/client/websocket-session.js").default) => ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>) | null} - The configured identity resolver.
     */
    getWebsocketSessionIdentityResolver() {
        return this._websocketSessionIdentityResolver;
    }
    /**
     * Runs set websocket session grace seconds.
     * @param {number} seconds - Grace period before a paused session expires.
     * @returns {void}
     */
    setWebsocketSessionGraceSeconds(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0)
            throw new Error(`Invalid grace seconds: ${seconds}`);
        this._websocketSessionGraceSeconds = seconds;
    }
    /**
     * Runs set websocket session heartbeat seconds.
     * @param {number} seconds - Heartbeat interval, with zero disabling reaping.
     * @returns {void}
     */
    setWebsocketSessionHeartbeatSeconds(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0)
            throw new Error(`Invalid heartbeat seconds: ${seconds}`);
        this._websocketSessionHeartbeatSeconds = seconds;
    }
    /**
     * Moves a session into the paused registry and starts the grace
     * timer. When the timer fires, the session's permanent teardown
     * hook is invoked. Called by the session itself from `_handleClose`
     * when there is resumable state (live Connections / Channel subs).
     * @param {import("./http-server/client/websocket-session.js").default} session - Resumable session to retain during its grace period.
     * @returns {void}
     */
    _pauseWebsocketSession(session) {
        const sessionId = session.sessionId;
        if (!sessionId)
            throw new Error("Session must have a sessionId to be paused");
        if (this._pausedWebsocketSessions.has(sessionId))
            return;
        const graceMs = this._websocketSessionGraceSeconds * 1000;
        const graceTimer = setTimeout(() => {
            this._expireWebsocketSession(sessionId);
        }, graceMs);
        // Don't keep the process alive purely for a paused session timer.
        if (typeof graceTimer.unref === "function")
            graceTimer.unref();
        this._pausedWebsocketSessions.set(sessionId, { session, graceTimer, pausedAt: Date.now() });
    }
    /**
     * Looks up a paused session by id (does NOT remove it — caller is
     * expected to call `_resumeWebsocketSession` to complete the handoff).
     * @param {string} sessionId - Paused session identifier to look up.
     * @returns {import("./http-server/client/websocket-session.js").default | null} - Paused session with the requested identifier, if present.
     */
    _findPausedWebsocketSession(sessionId) {
        return this._pausedWebsocketSessions.get(sessionId)?.session || null;
    }
    /**
     * Removes a paused session from the registry and cancels its grace
     * timer. Called on successful resume handoff and on explicit
     * expiry.
     * @param {string} sessionId - Paused session identifier to remove and cancel.
     * @returns {void}
     */
    _clearPausedWebsocketSession(sessionId) {
        const entry = this._pausedWebsocketSessions.get(sessionId);
        if (!entry)
            return;
        clearTimeout(entry.graceTimer);
        this._pausedWebsocketSessions.delete(sessionId);
    }
    /**
     * Grace-timer callback. Calls the session's permanent-teardown
     * hook and drops it from the registry.
     * @param {string} sessionId - Paused session identifier whose grace period expired.
     * @returns {void}
     */
    _expireWebsocketSession(sessionId) {
        const entry = this._pausedWebsocketSessions.get(sessionId);
        if (!entry)
            return;
        this._pausedWebsocketSessions.delete(sessionId);
        try {
            entry.session._finalizeGraceExpiry();
        }
        catch (error) {
            console.error(`Failed to finalize expired WS session ${sessionId}`, error);
        }
    }
    /**
     * Runs broadcast to channel.
     * @param {string} name - Channel type receiving the broadcast.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} broadcastParams - Values used to match eligible subscriptions.
     * @param {ReturnType<typeof JSON.parse>} body - Broadcast payload delivered to matching subscriptions.
     * @returns {void}
     */
    broadcastToChannel(name, broadcastParams, body) {
        // When Beacon is connected, ship the broadcast onto the bus. The
        // daemon echoes it back to every peer (including this one) and
        // each peer's `_deliverBroadcastFromBeacon` performs the same
        // local delivery as the synchronous paths below — so every
        // subscriber, in any process, sees broadcasts via a single code
        // path.
        if (this._beaconClient && this._beaconClient.isConnected()) {
            const sent = this._beaconClient.publish({ channel: name, broadcastParams, body });
            if (sent)
                return;
        }
        // V2 subscriptions live per worker-thread. When running in
        // worker-thread mode, the publisher runs either in the main
        // process (host) or in one of the workers:
        //
        //  - Main process: `_websocketEvents` is the host singleton and
        //    `broadcastV2` fans out to every worker directly.
        //  - Worker: `_websocketEvents` has `publishV2Broadcast` that
        //    posts to main, which then fans out to every worker.
        //
        // In-process mode doesn't install a websocket-events transport,
        // so fall through to the local dispatch.
        /**
         * Websocket events.
         * @type {ReturnType<typeof JSON.parse>} */
        const websocketEvents = this._websocketEvents;
        if (websocketEvents && typeof websocketEvents.broadcastV2 === "function") {
            websocketEvents.broadcastV2({ channel: name, broadcastParams, body, configuration: this });
            return;
        }
        if (websocketEvents && typeof websocketEvents.publishV2Broadcast === "function" && websocketEvents.parentPort) {
            websocketEvents.publishV2Broadcast({ channel: name, broadcastParams, body });
            return;
        }
        this._broadcastToChannelLocal(name, broadcastParams, body);
    }
    /**
     * Awaits all pending broadcast operations (including event-log
     * persistence). Call this after `broadcastToChannel` when you need
     * the event to be persisted before continuing (e.g. before
     * responding to an HTTP request).
     * @returns {Promise<void>}
     */
    async awaitPendingBroadcasts() {
        /**
         * Websocket events.
         * @type {ReturnType<typeof JSON.parse>} */
        const websocketEvents = this._websocketEvents;
        if (websocketEvents && typeof websocketEvents.awaitPendingBroadcasts === "function") {
            // Drain the host/worker publish queues (including event-log persistence)
            // before draining local deliveries, because host dispatch launches the
            // local deliveries synchronously and they must be part of the snapshot.
            await websocketEvents.awaitPendingBroadcasts();
        }
        await this._awaitLocalBroadcastDeliveries();
    }
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
    _broadcastToChannelLocal(name, broadcastParams, body, meta) {
        const bucket = this._websocketChannelSubscriptions.get(name);
        if (!bucket)
            return;
        for (const subscription of bucket) {
            if (subscription.isClosed())
                continue;
            let matches;
            try {
                matches = subscription.matches(broadcastParams || {});
            }
            catch (error) {
                // A broken `matches()` on one subscriber must not poison the
                // broadcast to other subscribers. Skip and continue.
                console.error(`broadcastToChannel: ${name} subscription ${subscription.subscriptionId} matches() threw`, error);
                continue;
            }
            if (!matches)
                continue;
            const deliveryMetadata = {
                broadcastParams,
                ...(meta?.eventId ? { eventId: meta.eventId } : {})
            };
            const previousDelivery = this._localBroadcastDeliveryTails.get(subscription);
            const delivery = this.withoutCurrentConnectionContexts(() => {
                return this.runWithTestSharedConnectionContexts(() => {
                    return (previousDelivery || Promise.resolve())
                        .then(() => this._deliverWebsocketChannelBroadcast(subscription, body, deliveryMetadata))
                        .catch((error) => {
                        console.error(`broadcastToChannel: ${name} subscription ${subscription.subscriptionId} deliverBroadcast threw`, error);
                    });
                });
            });
            this._localBroadcastDeliveryTails.set(subscription, delivery);
            // Keep the fire-and-forget delivery (never awaited at broadcast time) but
            // track it so `awaitPendingBroadcasts` can drain it before settling. Remove
            // on settle; the failure handler also satisfies the promise so a rejected
            // delivery never becomes an unhandled rejection.
            this._localBroadcastDeliveries.add(delivery);
            /**
             * Removes a settled delivery from local tracking.
             * @returns {void}
             */
            const forgetDelivery = () => {
                this._localBroadcastDeliveries.delete(delivery);
                if (this._localBroadcastDeliveryTails.get(subscription) === delivery)
                    this._localBroadcastDeliveryTails.delete(subscription);
            };
            delivery.then(forgetDelivery, forgetDelivery);
        }
    }
    /**
     * Awaits a snapshot of the in-flight local (per-process) websocket channel
     * broadcast deliveries. Called from `awaitPendingBroadcasts` after the host
     * publish queues drain, so every delivery those queues launched is captured.
     * New deliveries enqueued after the snapshot are not awaited. Individual
     * delivery errors are isolated per subscriber — the delivery chain already
     * logs them and resolves — so a snapshotted rejection never fails this barrier.
     * @returns {Promise<void>}
     */
    async _awaitLocalBroadcastDeliveries() {
        const snapshot = [...this._localBroadcastDeliveries];
        await Promise.allSettled(snapshot);
    }
    /**
     * Runs deliver websocket channel broadcast.
     * @param {import("./http-server/websocket-channel.js").default} subscription - Channel subscription.
     * @param {import("./http-server/websocket-channel.js").WebsocketJsonValue} body - Broadcast body.
     * @param {import("./http-server/websocket-channel.js").WebsocketBroadcastMetadata} meta - Broadcast metadata.
     * @returns {void | Promise<void>} Broadcast delivery result.
     */
    _deliverWebsocketChannelBroadcast(subscription, body, meta) {
        if (typeof subscription.deliverBroadcast === "function") {
            return subscription.deliverBroadcast(body, meta);
        }
        return subscription.sendMessage(body, meta);
    }
    /**
     * Runs get websocket message handler resolver.
     * @returns {import("./configuration-types.js").WebsocketMessageHandlerResolverType | undefined} - The websocket message handler resolver.
     */
    getWebsocketMessageHandlerResolver() {
        return this._websocketMessageHandlerResolver;
    }
    /**
     * Runs set websocket channel resolver.
     * @param {import("./configuration-types.js").WebsocketChannelResolverType} resolver - Resolver.
     * @returns {void} - No return value.
     */
    setWebsocketChannelResolver(resolver) {
        this._websocketChannelResolver = resolver;
    }
    /**
     * Runs set websocket message handler resolver.
     * @param {import("./configuration-types.js").WebsocketMessageHandlerResolverType} resolver - Resolver.
     * @returns {void} - No return value.
     */
    setWebsocketMessageHandlerResolver(resolver) {
        this._websocketMessageHandlerResolver = resolver;
    }
    /**
     * Runs resolve ability.
     * @param {object} args - Ability resolver args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Request params.
     * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default} [args.request] - Request object. Absent for websocket channel subscriptions resolved from subscribe params.
     * @param {import("./http-server/client/response.js").default} [args.response] - Response object. Absent outside HTTP request handling.
     * @returns {Promise<import("./authorization/ability.js").default | undefined>} - Resolved ability.
     */
    async resolveAbility({ params, request, response }) {
        const resolver = this.getAbilityResolver();
        if (resolver) {
            const resolved = await resolver({ configuration: this, params, request, response });
            if (resolved)
                return resolved;
        }
        const resources = this.getAbilityResources();
        if (resources.length === 0)
            return;
        return new Ability({
            context: { configuration: this, params, request, response },
            resources
        });
    }
    /**
     * Runs run with ability.
     * @param {import("./authorization/ability.js").default | undefined} ability - Ability instance.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithAbility(ability, callback) {
        return await this.getEnvironmentHandler().runWithAbility(ability, callback);
    }
    /**
     * Runs run with request timing.
     * @param {import("./http-server/client/request-timing.js").default | undefined} requestTiming - Request timing collector.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithRequestTiming(requestTiming, callback) {
        return await this.getEnvironmentHandler().runWithRequestTiming(requestTiming, callback);
    }
    /**
     * Profiles an application-defined test activity when an opt-in test profile
     * context is active. The callback always runs, including outside profiling.
     * @template T
     * @param {string} name - Low-cardinality activity identifier.
     * @param {() => (T | Promise<T>)} callback - Activity callback.
     * @returns {Promise<T>} - Callback result.
     */
    async profileTestActivity(name, callback) {
        const validatedName = validateTestActivityName(name);
        const context = this.getEnvironmentHandler().getCurrentTestProfileContext();
        if (!context)
            return await callback();
        return await context.profiler.profileActivity(context, validatedName, callback);
    }
    /**
     * Runs run with timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithTimezone(timeZone, callback) {
        return await this.getEnvironmentHandler().runWithTimezone(timeZone, callback);
    }
    /**
     * Runs get current ability.
     * @returns {import("./authorization/ability.js").default | undefined} - Current ability from context.
     */
    getCurrentAbility() {
        return this.getEnvironmentHandler().getCurrentAbility();
    }
    /**
     * Runs get current request timing.
     * @returns {import("./http-server/client/request-timing.js").default | undefined} - Current request timing collector.
     */
    getCurrentRequestTiming() {
        return this.getEnvironmentHandler().getCurrentRequestTiming();
    }
    /**
     * Runs get current tenant.
     * @returns {ReturnType<typeof JSON.parse>} - Current tenant from context.
     */
    getCurrentTenant() {
        return this.getEnvironmentHandler().getCurrentTenant();
    }
    /**
     * Runs run with tenant.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithTenant(tenant, callback) {
        return await this.getEnvironmentHandler().runWithTenant(tenant, callback);
    }
    /**
     * Runs resolve tenant.
     * @param {object} args - Tenant resolver args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Request params.
     * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined} args.request - Request object.
     * @param {import("./http-server/client/response.js").default | undefined} args.response - Response object.
     * @param {{channel: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} [args.subscription] - Subscription metadata.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolved tenant.
     */
    async resolveTenant({ params, request, response, subscription }) {
        const resolver = this.getTenantResolver();
        if (!resolver)
            return;
        return await resolver({
            configuration: this,
            params,
            request,
            response,
            subscription
        });
    }
    /**
     * Runs get error events.
     * @returns {import("eventemitter3").EventEmitter} - Framework error events emitter.
     */
    getErrorEvents() {
        return this._errorEvents;
    }
    /**
     * Framework telemetry emitter. Telemetry reports measurements — lock contention,
     * slow queries, queue depth — that are worth observing but are not failures. It is
     * deliberately separate from `getErrorEvents()`: a bug reporter subscribes to the
     * error channel on the promise that every payload there carries a thrown value, and
     * a contention measurement emitted as `framework-error` turns into a bug report on
     * every occurrence instead of a metric.
     * @returns {import("eventemitter3").EventEmitter} - Framework telemetry events emitter.
     */
    getTelemetryEvents() {
        return this._telemetryEvents;
    }
    /**
     * Registers a reporter that can add client-safe metadata to frontend-model error payloads.
     * @param {import("./configuration-types.js").ClientErrorPayloadReporterType} reporter - Reporter callback.
     * @returns {void}
     */
    addClientErrorPayloadReporter(reporter) {
        this._clientErrorPayloadReporters.push(reporter);
    }
    /**
     * Runs registered client error payload reporters.
     * @param {{context: import("./configuration-types.js").ClientErrorPayloadContext, error: Error, request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined}} args - Reporter args.
     * @returns {Promise<import("./configuration-types.js").ClientErrorPayloadReporterPayload>} - Merged client-safe reporter payload.
     */
    async clientErrorPayloadForError(args) {
        /** @type {import("./configuration-types.js").ClientErrorPayloadReporterPayload} */
        const payload = {};
        const requestTiming = this.getCurrentRequestTiming();
        const sensitiveValues = requestTiming ? requestTiming.getLogSensitiveValues() : new Set();
        const details = requestDetails(args.request, { redactor: this.getLogRedactor(), sensitiveValues });
        for (const reporter of this._clientErrorPayloadReporters) {
            const reporterPayload = await reporter({
                ...args,
                requestDetails: details
            });
            if (reporterPayload && typeof reporterPayload === "object") {
                Object.assign(payload, reporterPayload);
            }
        }
        return payload;
    }
    /**
     * Runs one test attempt in a revocable database-access context.
     * @template T
     * @param {{revoked: boolean}} scope - Attempt-owned access scope.
     * @param {() => T | Promise<T>} callback - Attempt work.
     * @returns {T | Promise<T>} - Callback result.
     */
    runWithTestDatabaseAccessScope(scope, callback) {
        return this.getEnvironmentHandler().runWithTestDatabaseAccessScope(scope, callback);
    }
    /**
     * Runs persistent framework work without inheriting a test attempt's revocable database-access scope.
     * @template T
     * @param {() => T | Promise<T>} callback - Persistent work to run.
     * @returns {Promise<T>} - Callback result.
     */
    async withoutCurrentTestDatabaseAccessScope(callback) {
        return await this.getEnvironmentHandler().runWithCapturedTestDatabaseAccessScope(undefined, callback);
    }
    /** Throws when a timed-out test attempt tries to start more database work. */
    assertDatabaseAccessAllowed() {
        this.getEnvironmentHandler().assertTestDatabaseAccessAllowed();
    }
    /**
     * Runs with connections.
     * @template T
     * @param {WithConnectionsOptionsType | WithConnectionsCallbackType<T>} optionsOrCallback - Checkout options or callback function.
     * @param {WithConnectionsCallbackType<T>} [callback] - Callback function.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withConnections(optionsOrCallback, callback) {
        this.assertDatabaseAccessAllowed();
        const { callback: actualWithConnectionsCallback, databaseIdentifiers, name } = resolveWithConnectionsArgs(optionsOrCallback, callback, "Configuration.withConnections");
        if (!actualWithConnectionsCallback)
            throw new Error("withConnections requires a callback");
        /**
         * Dbs.
         * @type {{[key: string]: import("./database/drivers/base.js").default}} */
        const dbs = {};
        return await this.withDatabaseIdentifierConnections({
            callback: actualWithConnectionsCallback,
            dbs,
            identifiers: databaseIdentifiers ?? this.getDatabaseIdentifiers(),
            name,
            stackLabel: "withConnections"
        });
    }
    /**
     * Runs explicit model work in a transaction pinned to one database connection.
     * @template T
     * @param {{databaseIdentifier: string, name?: string}} options - Operation options.
     * @param {(operation: DatabaseOperation) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withTransaction({ databaseIdentifier, name = "Configuration.withTransaction", ...restArgs }, callback) {
        this.assertDatabaseAccessAllowed();
        restArgsError(restArgs);
        if (!databaseIdentifier)
            throw new Error("Configuration.withTransaction requires a databaseIdentifier");
        if (typeof callback != "function")
            throw new Error("Configuration.withTransaction requires a callback");
        if (!this.getDatabaseIdentifiers().includes(databaseIdentifier)) {
            throw new Error(`Unknown or inactive database identifier: ${databaseIdentifier}`);
        }
        const tenant = this.getCurrentTenant();
        const databaseConfiguration = this.resolveDatabaseConfiguration(databaseIdentifier, tenant);
        const pool = this.getDatabasePool(databaseIdentifier);
        return await pool.withOperationConnection({ name }, async (connection, owner) => {
            this.assertDatabaseAccessAllowed();
            const operation = new DatabaseOperation({
                configuration: this,
                databaseConfiguration,
                configurationReuseKey: pool.getConnectionConfigurationReuseKey(connection),
                connection,
                databaseIdentifier,
                owner,
                tenant
            });
            try {
                return await operation.transaction(async () => {
                    this.assertDatabaseAccessAllowed();
                    return await callback(operation);
                });
            }
            finally {
                operation.complete();
            }
        });
    }
    /**
     * Runs explicit model work on one connection selected from a captured physical
     * database configuration. No ambient tenant value is read during checkout or
     * execution.
     * @template T
     * @param {{databaseConfiguration: import("./configuration-types.js").DatabaseConfigurationType, databaseIdentifier: string, name?: string, schemaGeneration?: string, tenant?: object}} options - Captured operation options.
     * @param {(operation: DatabaseOperation) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Callback result.
     */
    async withDatabaseOperation({ databaseConfiguration, databaseIdentifier, name = "Configuration.withDatabaseOperation", schemaGeneration, tenant, ...restArgs }, callback) {
        this.assertDatabaseAccessAllowed();
        restArgsError(restArgs);
        if (!databaseIdentifier)
            throw new Error("Configuration.withDatabaseOperation requires a databaseIdentifier");
        if (!databaseConfiguration)
            throw new Error("Configuration.withDatabaseOperation requires a databaseConfiguration");
        if (typeof callback != "function")
            throw new Error("Configuration.withDatabaseOperation requires a callback");
        const pool = this.getDatabasePool(databaseIdentifier);
        const configurationReuseKey = pool.getConfigurationReuseKey(databaseConfiguration);
        return await pool.withCapturedOperationConnection({ databaseConfiguration, name }, async (connection, owner) => {
            this.assertDatabaseAccessAllowed();
            const operation = new DatabaseOperation({
                configuration: this,
                databaseConfiguration,
                configurationReuseKey,
                connection,
                databaseIdentifier,
                enforceCurrentTenantReuseKey: false,
                owner,
                schemaGeneration,
                tenant
            });
            try {
                return await callback(operation);
            }
            finally {
                operation.complete();
            }
        });
    }
    /**
     * Runs callback with database connections for the requested identifiers.
     * @template T
     * @param {{callback: WithConnectionsCallbackType<T>, dbs: Record<string, import("./database/drivers/base.js").default>, identifiers: string[], name: string, stackLabel: string}} args - Connection scope details.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withDatabaseIdentifierConnections({ callback, dbs, identifiers, name, stackLabel }) {
        const stack = Error().stack;
        const actualCallback = async () => {
            this.assertDatabaseAccessAllowed();
            return await withTrackedStack(stack || stackLabel, async () => {
                return await callback(dbs);
            });
        };
        /**
         * Run request.
         * @type {() => Promise<T>} */
        let runRequest = actualCallback;
        for (const identifier of identifiers) {
            let actualRunRequest = runRequest;
            const nextRunRequest = async () => {
                return await this.getDatabasePool(identifier).withConnection({ name }, async (db) => {
                    dbs[identifier] = db;
                    return await actualRunRequest();
                });
            };
            runRequest = nextRunRequest;
        }
        return await runRequest();
    }
    /**
     * Runs get current connections.
     * @param {string[]} [databaseIdentifiers] - Database identifiers to include.
     * @returns {Record<string, import("./database/drivers/base.js").default>} A map of database connections with identifier as key
     */
    getCurrentConnections(databaseIdentifiers = this.getDatabaseIdentifiers()) {
        this.assertDatabaseAccessAllowed();
        /**
         * Dbs.
         * @type {{[key: string]: import("./database/drivers/base.js").default}} */
        const dbs = {};
        for (const identifier of databaseIdentifiers) {
            try {
                const pool = this.getDatabasePool(identifier);
                const currentConnection = pool.getCurrentContextConnection ? pool.getCurrentContextConnection() : pool.getCurrentConnection();
                if (currentConnection && (!pool.connectionMatchesCurrentConfiguration || pool.connectionMatchesCurrentConfiguration(currentConnection))) {
                    dbs[identifier] = currentConnection;
                }
            }
            catch (error) {
                if (this.isMissingCurrentConnectionError(error)) {
                    // Ignore
                }
                else {
                    throw error;
                }
            }
        }
        return dbs;
    }
    /**
     * Runs without current connection contexts.
     * @template T
     * @param {() => T} callback - Callback to run without inherited DB connection contexts.
     * @returns {T} - Callback result.
     */
    withoutCurrentConnectionContexts(callback) {
        let runCallback = () => this.getEnvironmentHandler().runWithoutSharedTransactionCoordinatorOwners(callback);
        for (const pool of Object.values(this.databasePools)) {
            if (!pool)
                continue;
            const previousRunCallback = runCallback;
            runCallback = () => pool.withoutCurrentConnectionContext(previousRunCallback);
        }
        return runCallback();
    }
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
    runWithTestSharedConnectionContexts(callback) {
        let runCallback = callback;
        for (const pool of Object.values(this.databasePools)) {
            if (!pool)
                continue;
            const previousRunCallback = runCallback;
            runCallback = () => pool.runWithTestSharedConnection(previousRunCallback);
        }
        return runCallback();
    }
    /**
     * Runs is missing current connection error.
     * @param {ReturnType<typeof JSON.parse>} error - Error thrown while looking up the current connection.
     * @returns {boolean} - Whether the error means no current connection is available.
     */
    isMissingCurrentConnectionError(error) {
        return error instanceof Error && (error.message == "ID hasn't been set for this async context" ||
            error.message == "A connection hasn't been made yet" ||
            error.message.startsWith("No async context set for database connection") ||
            error.message.startsWith("Connection ") && error.message.includes("doesn't exist any more"));
    }
    /**
     * Runs ensure connections.
     * @template T
     * @param {WithConnectionsOptionsType | WithConnectionsCallbackType<T>} optionsOrCallback - Checkout options or callback function.
     * @param {WithConnectionsCallbackType<T>} [callback] - Callback function.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async ensureConnections(optionsOrCallback, callback) {
        this.assertDatabaseAccessAllowed();
        const { callback: actualWithConnectionsCallback, databaseIdentifiers, name } = resolveWithConnectionsArgs(optionsOrCallback, callback, "Configuration.ensureConnections");
        if (!actualWithConnectionsCallback)
            throw new Error("ensureConnections requires a callback");
        const requestedIdentifiers = databaseIdentifiers ?? this.getDatabaseIdentifiers();
        const dbs = this.getCurrentConnections(requestedIdentifiers);
        const missingIdentifiers = requestedIdentifiers.filter((identifier) => {
            if (!dbs[identifier])
                return true;
            return !this.getDatabasePool(identifier).hasCurrentConnectionContext();
        });
        if (missingIdentifiers.length === 0) {
            return await actualWithConnectionsCallback(dbs);
        }
        return await this.withDatabaseIdentifierConnections({
            callback: actualWithConnectionsCallback,
            dbs,
            identifiers: missingIdentifiers,
            name,
            stackLabel: "ensureConnections"
        });
    }
    /**
     * Resolves the `advisoryLocks` configuration block (STC-210 design §10).
     * Full backward compatibility: an app that configures nothing gets today's
     * driver-native-only behavior — the file backend is **disabled by default**
     * and only ever selectable by explicit configuration.
     * @returns {{backends: {file: {directory?: string, enabled: boolean, leaseMs: number, renewIntervalMs: number}, lockServer: {authToken: string, connectTimeoutMs: number, enabled: boolean, leaseMs: number, reprobeCooldownMs: number, url: string}}, policy: import("./database/advisory-lock-backend-policy.js").AdvisoryLockBackendPolicyEntry[]}} - Advisory-lock configuration with defaults applied.
     */
    getAdvisoryLockConfig() {
        const configured = this._advisoryLocks || {};
        const fileConfigured = configured.backends?.file || {};
        const lockServerConfigured = configured.backends?.lockServer || {};
        const envHost = process.env.VELOCIOUS_LOCK_SERVER_HOST;
        const envPortRaw = process.env.VELOCIOUS_LOCK_SERVER_PORT;
        const envPort = envPortRaw ? Number(envPortRaw) : undefined;
        const lockServerHost = lockServerConfigured.host || envHost;
        const lockServerPort = typeof lockServerConfigured.port === "number"
            ? lockServerConfigured.port
            : (typeof envPort === "number" && Number.isFinite(envPort) ? envPort : 3006);
        const lockServerUrl = lockServerConfigured.url
            || `ws://${lockServerHost || "127.0.0.1"}:${lockServerPort}/websocket`;
        return {
            backends: {
                file: {
                    directory: fileConfigured.directory,
                    enabled: fileConfigured.enabled === true,
                    leaseMs: typeof fileConfigured.leaseMs === "number" ? fileConfigured.leaseMs : 30_000,
                    renewIntervalMs: typeof fileConfigured.renewIntervalMs === "number" ? fileConfigured.renewIntervalMs : 10_000
                },
                lockServer: {
                    // Enabled only by explicit configuration or an explicit env pair, so
                    // an app that configures nothing keeps today's driver-native behavior.
                    authToken: typeof lockServerConfigured.authToken === "string" ? lockServerConfigured.authToken : "",
                    connectTimeoutMs: typeof lockServerConfigured.connectTimeoutMs === "number" ? lockServerConfigured.connectTimeoutMs : 3000,
                    enabled: typeof lockServerConfigured.enabled === "boolean"
                        ? lockServerConfigured.enabled
                        : Boolean(lockServerConfigured.url || lockServerConfigured.host || envHost || typeof lockServerConfigured.port === "number" || envPortRaw),
                    leaseMs: typeof lockServerConfigured.leaseMs === "number" ? lockServerConfigured.leaseMs : 30_000,
                    reprobeCooldownMs: typeof lockServerConfigured.reprobeCooldownMs === "number" ? lockServerConfigured.reprobeCooldownMs : 5000,
                    url: lockServerUrl
                }
            },
            policy: Array.isArray(configured.policy) ? configured.policy : []
        };
    }
    /**
     * Runs get advisory lock policy.
     * @returns {import("./database/advisory-lock-backend-policy.js").AdvisoryLockBackendPolicyEntry[]} - Per-lock-name backend policy entries.
     */
    getAdvisoryLockPolicy() {
        return this.getAdvisoryLockConfig().policy;
    }
    /**
     * Resolves the effective backend policy for one lock name (design §5).
     * @param {string} lockName - Concrete lock name.
     * @returns {import("./database/advisory-lock-backend-policy.js").ResolvedAdvisoryLockBackendPolicy} - Resolved policy.
     */
    resolveAdvisoryLockPolicy(lockName) {
        return resolveAdvisoryLockBackendPolicy(lockName, this.getAdvisoryLockPolicy());
    }
    /**
     * Returns the file-tier advisory-lock backend when this deployment has
     * explicitly enabled it (`advisoryLocks.backends.file.enabled: true`),
     * creating it on first use. Returns `undefined` when the tier is disabled
     * (the default) — callers must never fall back to it implicitly. Creation
     * goes through the environment handler so browser/Expo configurations
     * without `fs` fail loudly instead of half-working.
     * @returns {Promise<import("./database/advisory-lock-file-backend.js").default | undefined>} - Resolves with the enabled file backend, or undefined.
     */
    async getAdvisoryLockFileBackend() {
        const config = this.getAdvisoryLockConfig();
        if (!config.backends.file.enabled)
            return undefined;
        if (this._advisoryLockFileBackend)
            return this._advisoryLockFileBackend;
        const directory = config.backends.file.directory || `${this.getDirectory()}/tmp/advisory-locks`;
        this._advisoryLockFileBackend = await this.getEnvironmentHandler().createAdvisoryLockFileBackend({
            directory,
            leaseMs: config.backends.file.leaseMs,
            renewIntervalMs: config.backends.file.renewIntervalMs
        });
        return this._advisoryLockFileBackend;
    }
    /**
     * Returns the lock-server advisory-lock backend (tier (b)) when this
     * deployment configured one, creating it on first use. Returns `undefined`
     * when the tier is not configured — callers must never invent one.
     *
     * The backend keeps a single socket per process; it holds no database
     * connection while waiting for or holding a lease.
     * @returns {Promise<import("./database/advisory-lock-lock-server-backend.js").default | undefined>} - Resolves with the configured backend, or undefined.
     */
    async getAdvisoryLockLockServerBackend() {
        const config = this.getAdvisoryLockConfig();
        if (!config.backends.lockServer.enabled)
            return undefined;
        if (this._advisoryLockLockServerBackend)
            return this._advisoryLockLockServerBackend;
        const { default: AdvisoryLockLockServerBackend } = await import("./database/advisory-lock-lock-server-backend.js");
        const backend = new AdvisoryLockLockServerBackend({
            authToken: config.backends.lockServer.authToken,
            connectTimeoutMs: config.backends.lockServer.connectTimeoutMs,
            leaseMs: config.backends.lockServer.leaseMs,
            onError: (error) => {
                this.getErrorEvents().emit("framework-error", { context: "advisory-lock-lock-server", error });
                this.getErrorEvents().emit("all-error", { context: "advisory-lock-lock-server", error, errorType: "framework-error" });
            },
            reprobeCooldownMs: config.backends.lockServer.reprobeCooldownMs,
            url: config.backends.lockServer.url
        });
        this._advisoryLockLockServerBackend = backend;
        return backend;
    }
    /**
     * Records which backend tier served one advisory-lock acquisition so
     * `getAdvisoryLockBackendStatus()` can answer "which backend served this
     * lock" (design §3).
     * @param {object} args - Acquisition record.
     * @param {string} args.lockName - Lock name.
     * @param {import("./database/advisory-lock-backend-policy.js").AdvisoryLockTier} args.backend - Tier that served the acquisition.
     * @param {boolean} args.fencingSupported - Whether the serving tier carries fencing tokens.
     * @returns {void}
     */
    recordAdvisoryLockAcquisition({ lockName, backend, fencingSupported }) {
        this._advisoryLockAcquisitions.set(lockName, { backend, fencingSupported, servedAt: new Date().toISOString() });
    }
    /**
     * The "which backend served this lock" diagnostics surface (design §3):
     * per lock name, the tier of the most recent acquisition, whether that tier
     * carries fencing tokens, and the resolved policy (minimum/allowed/preferred
     * tiers) for the name.
     * @param {string} lockName - Lock name.
     * @returns {{acquisition: {backend: import("./database/advisory-lock-backend-policy.js").AdvisoryLockTier, fencingSupported: boolean, servedAt: string} | null, lockServer: {connected: boolean, lastError: string | null, lastProbeAt: string | null, leasedNames: string[]} | null, policy: import("./database/advisory-lock-backend-policy.js").ResolvedAdvisoryLockBackendPolicy}} - Backend status for the name.
     */
    getAdvisoryLockBackendStatus(lockName) {
        return {
            acquisition: this._advisoryLockAcquisitions.get(lockName) ?? null,
            lockServer: this._advisoryLockLockServerBackend?.getStatus() ?? null,
            policy: this.resolveAdvisoryLockPolicy(lockName)
        };
    }
    /**
     * Registers a dedicated connection that currently holds an advisory lock, so a
     * shutdown can close it and release the lock. See `_advisoryLockConnections`.
     * @param {import("./database/drivers/base.js").default} connection - The dedicated lock connection.
     * @returns {void}
     */
    registerAdvisoryLockConnection(connection) {
        this._advisoryLockConnections.add(connection);
    }
    /**
     * Unregisters a dedicated advisory-lock connection once its lock scope ends and the
     * connection has been (or is about to be) closed by its owner.
     * @param {import("./database/drivers/base.js").default} connection - The dedicated lock connection.
     * @returns {void}
     */
    unregisterAdvisoryLockConnection(connection) {
        this._advisoryLockConnections.delete(connection);
    }
    /**
     * Closes every registered dedicated advisory-lock connection, ending its session so
     * the DB server releases the lock. Every connection is attempted before any failure
     * is surfaced, so one stuck close does not leave the others' locks held; a failure is
     * then thrown (never swallowed), aggregated when more than one connection failed.
     * @returns {Promise<void>} - Resolves once all have been closed; rejects if any failed.
     */
    async _closeAdvisoryLockConnections() {
        const connections = [...this._advisoryLockConnections];
        this._advisoryLockConnections.clear();
        /** @type {unknown[]} */
        const errors = [];
        for (const connection of connections) {
            try {
                await connection.close();
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length == 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Failed to close dedicated advisory-lock connections");
    }
    /**
     * Closes active database connections and clears global connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async closeDatabaseConnections() {
        if (this._closeDatabaseConnectionsPromise) {
            await this._closeDatabaseConnectionsPromise;
            return;
        }
        /** @type {Set<typeof import("./database/pool/base.js").default>} */
        const constructors = new Set();
        this._closeDatabaseConnectionsPromise = (async () => {
            /** @type {Error[]} */
            const closeErrors = [];
            try {
                await this.closeBackgroundJobsAdapter();
            }
            catch (error) {
                closeErrors.push(error instanceof Error ? error : new Error(String(error)));
            }
            try {
                try {
                    // Close dedicated advisory-lock connections first: they are spawned outside the
                    // pools' tracked sets, so `pool.closeAll()` would not reach them and a lock held
                    // by a runner torn down mid-pass would leak until the DB server's `wait_timeout`.
                    // Still close the pools if this throws, so a stuck lock connection does not
                    // leave the rest of the connections open.
                    await this._closeAdvisoryLockConnections();
                }
                finally {
                    try {
                        // Release file-tier advisory-lock holds explicitly (STC-213): the
                        // lease would make them reclaimable anyway, but a clean shutdown
                        // should not leave lock directories behind for the staleness path.
                        await this._advisoryLockFileBackend?.releaseAllHeld();
                    }
                    catch (error) {
                        closeErrors.push(error instanceof Error ? error : new Error(String(error)));
                    }
                    try {
                        // Release lock-server leases explicitly first, then drop the socket:
                        // the server reclaims a closed connection anyway, but an explicit
                        // release hands the name to the next waiter without waiting for the
                        // transport teardown.
                        await this._advisoryLockLockServerBackend?.close();
                    }
                    catch (error) {
                        closeErrors.push(error instanceof Error ? error : new Error(String(error)));
                    }
                    for (const pool of Object.values(this.databasePools)) {
                        if (!pool)
                            continue;
                        await pool.closeAll();
                        const PoolClass = /** @type {typeof import("./database/pool/base.js").default} */ (pool.constructor);
                        constructors.add(PoolClass);
                    }
                    for (const PoolClass of constructors) {
                        PoolClass.clearGlobalConnections(this);
                    }
                    this._frontendTenantSqliteLifecycle.reset();
                    // Allow full re-initialization after connections are closed.
                    this._modelInitializationGeneration += 1;
                    this._modelsInitialized = false;
                    this._isInitialized = false;
                }
            }
            catch (error) {
                closeErrors.push(error instanceof Error ? error : new Error(String(error)));
            }
            if (closeErrors.length === 1)
                throw closeErrors[0];
            if (closeErrors.length > 1)
                throw new AggregateError(closeErrors, "Failed to close background-jobs and database resources");
        })();
        try {
            await this._closeDatabaseConnectionsPromise;
        }
        finally {
            this._closeDatabaseConnectionsPromise = null;
        }
    }
    /**
     * Runs debug endpoint request authorized.
     * @param {{header: (name: string) => string | null | undefined}} request - Incoming request.
     * @param {string} expectedToken - Configured debug-endpoint token.
     * @returns {boolean} - Whether the request carries the expected bearer token.
     */
    debugEndpointRequestAuthorized(request, expectedToken) {
        const header = request.header("authorization");
        if (typeof header !== "string")
            return false;
        const match = (/^Bearer\s+(.+)$/i).exec(header.trim());
        if (!match)
            return false;
        return this.getEnvironmentHandler().debugEndpointTokenMatches(match[1], expectedToken);
    }
    /**
     * Runs get api manifest.
     * @returns {Promise<Record<string, unknown>>} - API manifest for all registered frontend-model resources.
     */
    async getApiManifest() {
        return frontendModelApiManifest(this._backendProjects);
    }
    /**
     * Runs whether API manifest is enabled.
     * @returns {boolean} - Whether the API manifest endpoint is enabled.
     */
    _apiManifestEnabled() {
        return this._apiManifest.enabled;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLEVBQUMsb0NBQW9DLEVBQUMsTUFBTSw4Q0FBOEMsQ0FBQTtBQUNqRyxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFB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QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMscUJBQXFCLElBQUksVUFBVSxDQUFDLElBQUksT0FBTyxzQkFBc0IsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsc0JBQXNCLENBQUMsSUFBSSxzQkFBc0IsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUMvTyxNQUFNLHVCQUF1QixHQUFHLE9BQU8sVUFBVSxDQUFDLHVCQUF1QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLFVBQVUsQ0FBQyx1QkFBdUIsSUFBSSxDQUFDO1lBQ3RMLENBQUMsQ0FBQyxVQUFVLENBQUMsdUJBQXVCO1lBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx5QkFBeUIsSUFBSSxVQUFVLENBQUMsSUFBSSxPQUFPLDBCQUEwQixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLDBCQUEwQixDQUFDLElBQUksMEJBQTBCLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUMsQ0FBQTtRQUNyTyxNQUFNLHlCQUF5QixHQUFHLE9BQU8sVUFBVSxDQUFDLHlCQUF5QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJLFVBQVUsQ0FBQyx5QkFBeUIsSUFBSSxDQUFDO1lBQzlMLENBQUMsQ0FBQyxVQUFVLENBQUMseUJBQXlCO1lBQ3RDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQywyQkFBMkIsSUFBSSxVQUFVLENBQUMsSUFBSSxPQUFPLDRCQUE0QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLDRCQUE0QixDQUFDLElBQUksNEJBQTRCLElB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QUFFLENBQUMseUJBQXlCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLGFBQWEsQ0FBQyxDQUFBO0lBQ3hGLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsY0FBYztRQUNsQixPQUFPLHdCQUF3QixDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO0lBQ3hELENBQUM7SUFFRDs7O09BR0c7SUFDSCxtQkFBbUI7UUFDakIsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGUgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7KGFyZzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD4pID0+IFByb21pc2U8VD59IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIFdpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gW2RhdGFiYXNlSWRlbnRpZmllcnNdIC0gRGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gaW5jbHVkZSBpbiB0aGUgY29ubmVjdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBIdW1hbi1yZWFkYWJsZSBuYW1lIGZvciB0aGUgY2hlY2tlZC1vdXQgZGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gKi9cbi8qKlxuICogT25lIGFkYXB0ZXIgaW5zdGFuY2UgYW5kIGl0cyBzZXJpYWxpemVkIHJlYWR5L2Nsb3NlIGxpZmVjeWNsZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qc1wiKS5kZWZhdWx0fSBhZGFwdGVyIC0gQWRhcHRlciBvd25lZCBieSB0aGlzIGdlbmVyYXRpb24uXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNsb3NpbmcgLSBXaGV0aGVyIGNsb3NlIGhhcyBjbGFpbWVkIHRoaXMgZ2VuZXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gcmVhZHlQcm9taXNlIC0gU2hhcmVkIHJlYWRpbmVzcyBhdHRlbXB0LlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSBjbG9zZVByb21pc2UgLSBTaGFyZWQgY2xvc2Ugb3BlcmF0aW9uLlxuICovXG5cbmltcG9ydCB7IGRpZ2cgfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBnZXR0ZXh0Q29uZmlnIGZyb20gXCJnZXR0ZXh0LXVuaXZlcnNhbC9idWlsZC9zcmMvY29uZmlnLmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuaW1wb3J0IHRyYW5zbGF0ZSBmcm9tIFwiZ2V0dGV4dC11bml2ZXJzYWwvYnVpbGQvc3JjL3RyYW5zbGF0ZS5qc1wiXG5pbXBvcnQgQWJpbGl0eSBmcm9tIFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qc1wiXG5pbXBvcnQge0RFRkFVTFRfU0NIRURVTEVEX0VOUVVFVUVfVElNRU9VVF9NU30gZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL3NjaGVkdWxlZC1lbnF1ZXVlLWJvdW5kLmpzXCJcbmltcG9ydCBEYXRhYmFzZU9wZXJhdGlvbiBmcm9tIFwiLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIlxuaW1wb3J0IHsgaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHMgfSBmcm9tIFwiLi9kYXRhYmFzZS9yZWNvcmQvYXVkaXRpbmcuanNcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgZnJvbSBcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanNcIlxuaW1wb3J0IHsgQ3VycmVudENvbmZpZ3VyYXRpb25Ob3RTZXRFcnJvciwgY3VycmVudENvbmZpZ3VyYXRpb24sIHNldEN1cnJlbnRDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vY3VycmVudC1jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCB7IHJlcXVlc3REZXRhaWxzIH0gZnJvbSBcIi4vZXJyb3ItcmVwb3J0aW5nL3JlcXVlc3QtZGV0YWlscy5qc1wiXG5pbXBvcnQgTG9nUmVkYWN0b3IgZnJvbSBcIi4vbG9nLXJlZGFjdG9yLmpzXCJcbmltcG9ydCB7IGZyb250ZW5kTW9kZWxBcGlNYW5pZmVzdCwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QgfSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQgeyBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleSwgbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleSB9IGZyb20gXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiXG5pbXBvcnQgUGx1Z2luUm91dGVzIGZyb20gXCIuL3JvdXRlcy9wbHVnaW4tcm91dGVzLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRlc3RBY3Rpdml0eU5hbWUgfSBmcm9tIFwiLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1hY3Rpdml0eS5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRpbWVab25lIH0gZnJvbSBcIi4vdGltZS16b25lLmpzXCJcbmltcG9ydCB7IHdpdGhUcmFja2VkU3RhY2sgfSBmcm9tIFwiLi91dGlscy93aXRoLXRyYWNrZWQtc3RhY2suanNcIlxuaW1wb3J0IFZlbG9jaW91c1BhY2thZ2UgZnJvbSBcIi4vcGFja2FnZXMvdmVsb2Npb3VzLXBhY2thZ2UuanNcIlxuaW1wb3J0IEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlIGZyb20gXCIuL3RlbmFudHMvZnJvbnRlbmQtdGVuYW50LXNxbGl0ZS1saWZlY3ljbGUuanNcIlxuaW1wb3J0IHsgcmVzb2x2ZUdlbmVyYXRpb25JZCwgcmVzb2x2ZUluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIHJlc29sdmVMaWZlY3ljbGVTb2NrZXRQYXRoIH0gZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgeyByZXNvbHZlQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeSB9IGZyb20gXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIlxuXG5leHBvcnQgeyBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yIH1cblxuLyoqXG4gKiBSdW5zIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgd29ya2luZyBkaXJlY3Rvcnkgd2hlbiB0aGUgcnVudGltZSBleHBvc2VzIG9uZS5cbiAqL1xuZnVuY3Rpb24gY3VycmVudFdvcmtpbmdEaXJlY3RvcnkoKSB7XG4gIGNvbnN0IHByb2Nlc3NPYmplY3QgPSAvKiogQHR5cGUge3tjd2Q/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gfCB1bmRlZmluZWR9ICovIChnbG9iYWxUaGlzLnByb2Nlc3MpXG5cbiAgaWYgKHR5cGVvZiBwcm9jZXNzT2JqZWN0Py5jd2QgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIHJldHVybiBwcm9jZXNzT2JqZWN0LmN3ZCgpXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIG92ZXJsb2FkZWQgd2l0aC9lbnN1cmUgY29ubmVjdGlvbnMgYXJndW1lbnRzLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgfCBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+IHwgdW5kZWZpbmVkfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGRlZmF1bHROYW1lIC0gRGVmYXVsdCBjaGVja291dCBuYW1lLlxuICogQHJldHVybnMge3tkYXRhYmFzZUlkZW50aWZpZXJzOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCwgbmFtZTogc3RyaW5nLCBjYWxsYmFjazogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+IHwgdW5kZWZpbmVkfX0gUmVzb2x2ZWQgY2hlY2tvdXQgb3B0aW9ucyBhbmQgY2FsbGJhY2suXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgZGVmYXVsdE5hbWUpIHtcbiAgaWYgKHR5cGVvZiBvcHRpb25zT3JDYWxsYmFjayA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBjb25zdCBhY3R1YWxDYWxsYmFjayA9IC8qKiBAdHlwZSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSAqLyAob3B0aW9uc09yQ2FsbGJhY2spXG5cbiAgICByZXR1cm4ge2RhdGFiYXNlSWRlbnRpZmllcnM6IHVuZGVmaW5lZCwgbmFtZTogZGVmYXVsdE5hbWUsIGNhbGxiYWNrOiBhY3R1YWxDYWxsYmFja31cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGF0YWJhc2VJZGVudGlmaWVyczogb3B0aW9uc09yQ2FsbGJhY2suZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICBuYW1lOiBvcHRpb25zT3JDYWxsYmFjay5uYW1lIHx8IGRlZmF1bHROYW1lLFxuICAgIGNhbGxiYWNrXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGNhbm9uaWNhbCBkZWJ1ZyBzbmFwc2hvdCB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU25hcHNob3QgdmFsdWUgdG8gY2Fub25pY2FsaXplLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBTbmFwc2hvdCB2YWx1ZSB3aXRoIG9iamVjdCBrZXlzIHNvcnRlZCByZWN1cnNpdmVseS5cbiAqL1xuZnVuY3Rpb24gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gdmFsdWVcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUubWFwKChlbnRyeSkgPT4gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKGVudHJ5KSlcblxuICByZXR1cm4gT2JqZWN0LmtleXModmFsdWUpLnNvcnQoKS5yZWR1Y2UoKHJlc3VsdCwga2V5KSA9PiB7XG4gICAgcmVzdWx0W2tleV0gPSBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlba2V5XSlcbiAgICByZXR1cm4gcmVzdWx0XG4gIH0sIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe30pKVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlndXJhdGlvbiAtIEJhc2UgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGUgfCBQYXJ0aWFsPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlPiB8IHZvaWR9IG92ZXJyaWRlQ29uZmlndXJhdGlvbiAtIFRlbmFudCBvdmVycmlkZSBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIE1lcmdlZCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBtZXJnZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG92ZXJyaWRlQ29uZmlndXJhdGlvbikge1xuICBpZiAoIW92ZXJyaWRlQ29uZmlndXJhdGlvbikgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuXG4gIHJldHVybiB7XG4gICAgLi4uZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgIC4uLm92ZXJyaWRlQ29uZmlndXJhdGlvbixcbiAgICByZWNvcmQ6IHtcbiAgICAgIC4uLihkYXRhYmFzZUNvbmZpZ3VyYXRpb24ucmVjb3JkIHx8IHt9KSxcbiAgICAgIC4uLihvdmVycmlkZUNvbmZpZ3VyYXRpb24ucmVjb3JkIHx8IHt9KVxuICAgIH0sXG4gICAgc3FsQ29uZmlnOiB7XG4gICAgICAuLi4oZGF0YWJhc2VDb25maWd1cmF0aW9uLnNxbENvbmZpZyB8fCB7fSksXG4gICAgICAuLi4ob3ZlcnJpZGVDb25maWd1cmF0aW9uLnNxbENvbmZpZyB8fCB7fSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgZ3JhY2Ugd2luZG93IChtcykgYmVmb3JlIGEgc3VzdGFpbmVkIGJlYWNvbiBvdXRhZ2UgaXMgcmVwb3J0ZWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgYHVucmVhY2hhYmxlUmVwb3J0TXNgLCBpZiBhbnkuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBjb25maWd1cmVkIHZhbHVlIHdoZW4gaXQncyBhIGZpbml0ZSBudW1iZXIsIG90aGVyd2lzZSB0aGUgMzBzIGRlZmF1bHQuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVCZWFjb25VbnJlYWNoYWJsZVJlcG9ydE1zKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgcmV0dXJuIDMwXzAwMFxufVxuXG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX0JZVEVTID0gMTYgKiAxMDI0ICogMTAyNFxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19NRVNTQUdFUyA9IDI1NlxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfQllURVMgPSAxNiAqIDEwMjQgKiAxMDI0XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19GUkFNRVMgPSAyNTZcblxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQgPSAxMDI0XG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZID0gNFxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMID0gNlxuXG4vKipcbiAqIFZhbGlkYXRlcyBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlciBjb25maWd1cmF0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIHBvc2l0aXZlIHNhZmUgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29uZmlndXJhdGlvbiBrZXkuXG4gKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFZhbHVlIC0gRGVmYXVsdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgb3IgZGVmYXVsdCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVTYWZlSW50ZWdlcih2YWx1ZSwgbmFtZSwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgJHtuYW1lfSBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyYClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbiBvcHRpb25hbCBwb3NpdGl2ZSBzYWZlIGludGVnZXIgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBwb3NpdGl2ZSBzYWZlIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbmZpZ3VyYXRpb24ga2V5LlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBWYWxpZGF0ZWQgY29uZmlndXJlZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKHZhbHVlLCBuYW1lKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgJHtuYW1lfSBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyYClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbiBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUgaW5zaWRlIGFuIGluY2x1c2l2ZSByYW5nZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtaW4gLSBNaW5pbXVtIGFjY2VwdGVkIHZhbHVlIChpbmNsdXNpdmUpLlxuICogQHBhcmFtIHtudW1iZXJ9IG1heCAtIE1heGltdW0gYWNjZXB0ZWQgdmFsdWUgKGluY2x1c2l2ZSkuXG4gKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFZhbHVlIC0gRGVmYXVsdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgb3IgZGVmYXVsdCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gaW50ZWdlckluUmFuZ2UodmFsdWUsIG5hbWUsIG1pbiwgbWF4LCBkZWZhdWx0VmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBkZWZhdWx0VmFsdWVcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCBtaW4gfHwgdmFsdWUgPiBtYXgpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGAke25hbWV9IG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuICR7bWlufSBhbmQgJHttYXh9YClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgdGhlIGJ1ZmZlcmVkIEhUVFAgcmVzcG9uc2UgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi4gQ29tcHJlc3Npb24gaXNcbiAqIGVuYWJsZWQgYnkgZGVmYXVsdCB3aGVuIHRoZSBzZXR0aW5nIGlzIGFic2VudDsgYGZhbHNlYCBvciBge2VuYWJsZWQ6IGZhbHNlfWBcbiAqIGRpc2FibGVzIGl0IGdsb2JhbGx5LlxuICogQHBhcmFtIHtib29sZWFuIHwgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkh0dHBDb21wcmVzc2lvbkNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IHZhbHVlIC0gQ29uZmlndXJlZCBjb21wcmVzc2lvbiB2YWx1ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEh0dHBDb21wcmVzc2lvbkNvbmZpZ3VyYXRpb259IC0gTm9ybWFsaXplZCBjb21wcmVzc2lvbiBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVIdHRwQ29tcHJlc3Npb24odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IHRydWUpIHtcbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHRocmVzaG9sZDogREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQsIGJyb3RsaVF1YWxpdHk6IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFksIGd6aXBMZXZlbDogREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMfVxuICB9XG5cbiAgaWYgKHZhbHVlID09PSBmYWxzZSkge1xuICAgIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHRocmVzaG9sZDogREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQsIGJyb3RsaVF1YWxpdHk6IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFksIGd6aXBMZXZlbDogREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMfVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24gbXVzdCBiZSBhIGJvb2xlYW4gb3IgYW4gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICB9XG5cbiAgY29uc3Qge2Jyb3RsaVF1YWxpdHksIGVuYWJsZWQsIGd6aXBMZXZlbCwgdGhyZXNob2xkLCAuLi5yZXN0Q29tcHJlc3Npb259ID0gdmFsdWVcbiAgY29uc3QgcmVzdENvbXByZXNzaW9uS2V5cyA9IE9iamVjdC5rZXlzKHJlc3RDb21wcmVzc2lvbilcblxuICBpZiAocmVzdENvbXByZXNzaW9uS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbiByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7cmVzdENvbXByZXNzaW9uS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGJyb3RsaVF1YWxpdHksIGVuYWJsZWQsIGd6aXBMZXZlbCwgdGhyZXNob2xkKWApXG4gIH1cblxuICBpZiAoZW5hYmxlZCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBlbmFibGVkICE9PSBcImJvb2xlYW5cIikge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uZW5hYmxlZCBtdXN0IGJlIGEgYm9vbGVhbiwgZ290OiAke1N0cmluZyhlbmFibGVkKX1gKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiBlbmFibGVkID8/IHRydWUsXG4gICAgdGhyZXNob2xkOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHRocmVzaG9sZCwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLnRocmVzaG9sZFwiLCBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCksXG4gICAgYnJvdGxpUXVhbGl0eTogaW50ZWdlckluUmFuZ2UoYnJvdGxpUXVhbGl0eSwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLmJyb3RsaVF1YWxpdHlcIiwgMCwgMTEsIERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFkpLFxuICAgIGd6aXBMZXZlbDogaW50ZWdlckluUmFuZ2UoZ3ppcExldmVsLCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uZ3ppcExldmVsXCIsIDAsIDksIERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTClcbiAgfVxufVxuXG4vKipcbiAqIERlZmF1bHQgcmVxdWVzdC1ib2R5IGxpbWl0IGZvciB0aGUgYnVpbHQtaW4gTUNQIGVuZHBvaW50LiBKU09OLVJQQyBtZXNzYWdlcyBhcmUgc21hbGwsXG4gKiBzbyB0aGUgZnJhbWV3b3JrIGNhcHMgdGhlbSBpbnN0ZWFkIG9mIG1ha2luZyBldmVyeSBhcHAgdGhhdCBlbmFibGVzIGBtY3A6IHRydWVgIHJlc3RhdGVcbiAqIGEgcmVxdWVzdC1ib2R5IHBvbGljeS4gRXhwbGljaXQgYGh0dHBTZXJ2ZXIubWF4UmVxdWVzdEJvZHlCeXRlc2Agb3IgYSByZXNvbHZlciBsaW1pdCB3aW5zLlxuICogQHR5cGUge251bWJlcn1cbiAqL1xuY29uc3QgREVGQVVMVF9NQ1BfTUFYX1JFUVVFU1RfQk9EWV9CWVRFUyA9IDEwMjQgKiAxMDI0XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NvbmZpZ3VyYXRpb24ge1xuICAvKipcbiAgICogQ2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvbnMgcHJvbWlzZS5cbiAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICBfY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IG51bGxcblxuICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gIF9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zIGN1cnJlbnRseSBob2xkaW5nIGEgbG9jay4gVGhlc2UgYXJlIHNwYXduZWRcbiAgICogb3V0c2lkZSB0aGUgcG9vbHMnIHRyYWNrZWQgc2V0cyAoc28gYSBob2xkLXRpbWVvdXQgbG9jayBzdXJ2aXZlcyBwb29sIGNoZWNrb3V0cyksXG4gICAqIHNvIGBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNgIHdvdWxkIG90aGVyd2lzZSB3YWxrIHBhc3QgdGhlbTsgdHJhY2tpbmcgdGhlbSBoZXJlXG4gICAqIGxldHMgYSBzaHV0ZG93biBjbG9zZSB0aGVtIGFuZCByZWxlYXNlIHRoZSBsb2NrIGluc3RlYWQgb2Ygb3JwaGFuaW5nIGl0LlxuICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMgPSBuZXcgU2V0KClcblxuICAvKipcbiAgICogTGF6aWx5IGNyZWF0ZWQgZmlsZS10aWVyIGFkdmlzb3J5LWxvY2sgYmFja2VuZCAoU1RDLTIxMykuIFN0YXlzIGB1bmRlZmluZWRgXG4gICAqIHVubGVzcyBgYWR2aXNvcnlMb2Nrcy5iYWNrZW5kcy5maWxlLmVuYWJsZWQ6IHRydWVgIGlzIGV4cGxpY2l0bHkgY29uZmlndXJlZCDigJRcbiAgICogdGhlIGZpbGUgdGllciBpcyBuZXZlciBhdXRvLWVuYWJsZWQsIGFuZCBhIG5vbi1Ob2RlIGVudmlyb25tZW50IGhhbmRsZXJcbiAgICogKGJyb3dzZXIvRXhwbywgbm8gYGZzYCkgY2Fubm90IGNyZWF0ZSBvbmUgYXQgYWxsLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBfYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIExhemlseSBjcmVhdGVkIGxvY2stc2VydmVyICh0aWVyIChiKSkgYmFja2VuZDsgdW5kZWZpbmVkIHdoZW4gdGhlIHRpZXIgaXNcbiAgICogbm90IGNvbmZpZ3VyZWQuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stbG9jay1zZXJ2ZXItYmFja2VuZC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX2Fkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIE1vc3QgcmVjZW50IGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gcGVyIGxvY2sgbmFtZSDigJQgdGhlIFwid2hpY2ggYmFja2VuZFxuICAgKiBzZXJ2ZWQgdGhpcyBsb2NrXCIgc3VyZmFjZSAoZGVzaWduIMKnMykuXG4gICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7YmFja2VuZDogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXIsIGZlbmNpbmdTdXBwb3J0ZWQ6IGJvb2xlYW4sIHNlcnZlZEF0OiBzdHJpbmd9Pn0gKi9cbiAgX2Fkdmlzb3J5TG9ja0FjcXVpc2l0aW9ucyA9IG5ldyBNYXAoKVxuXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgX3NjaGVtYUNhY2hlR2VuZXJhdGlvbnNCeVJldXNlS2V5ID0gbmV3IE1hcCgpXG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0NvbmZpZ3VyYXRpb259IC0gVGhlIGN1cnJlbnQuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudCgpIHtcbiAgICByZXR1cm4gY3VycmVudENvbmZpZ3VyYXRpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNvbmZpZ3VyYXRpb25BcmdzVHlwZX0gYXJncyAtIENvbmZpZ3VyYXRpb24gYXJndW1lbnRzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FiaWxpdHlSZXNvbHZlciwgYWJpbGl0eVJlc291cmNlcywgYWR2aXNvcnlMb2NrcywgYXR0YWNobWVudHMsIGF1dG9sb2FkID0gdHJ1ZSwgYmFja2dyb3VuZEpvYnMsIGJhY2tlbmRQcm9qZWN0cywgYmVhY29uLCBjb29raWVTZWNyZXQsIGNvcnMsIGRhdGFiYXNlLCBkZWJ1ZyA9IGZhbHNlLCBkZWJ1Z0VuZHBvaW50ID0gZmFsc2UsIGFwaU1hbmlmZXN0ID0gZmFsc2UsIGRpcmVjdG9yeSwgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gdHJ1ZSwgZW52aXJvbm1lbnQsIGVudmlyb25tZW50SGFuZGxlciwgZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMsIGZyb250ZW5kVGVuYW50U3FsaXRlLCBodHRwU2VydmVyLCBpbml0aWFsaXplTW9kZWxzLCBpbml0aWFsaXplcnMsIGxvY2FsZSwgbG9jYWxlRmFsbGJhY2tzLCBsb2NhbGVzLCBsb2dnaW5nLCBtYWlsZXJCYWNrZW5kLCBtY3AgPSBmYWxzZSwgcGFja2FnZXMsIHJlcXVlc3RUaW1lb3V0TXMsIHJvdXRlUmVzb2x2ZXJIb29rcywgc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMsIHNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMsIHN0cnVjdHVyZVNxbCwgc3luYywgdGVuYW50RGF0YWJhc2VQcm92aWRlcnMsIHRlbmFudERhdGFiYXNlUmVzb2x2ZXIsIHRlbmFudFJlc29sdmVyLCB0ZXN0VGVuYW50UG9vbHMsIHRlc3RpbmcsIHRpbWVab25lLCB0aW1lem9uZU9mZnNldE1pbnV0ZXMsIHRydXN0ZWRQcm94aWVzLCB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIsIHdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgPSBhYmlsaXR5UmVzb2x2ZXJcbiAgICB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gYWJpbGl0eVJlc291cmNlcyB8fCBbXVxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja3MgPSBhZHZpc29yeUxvY2tzXG4gICAgdGhpcy5fYXV0b2xvYWQgPSBhdXRvbG9hZFxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzID0gYmFja2dyb3VuZEpvYnNcbiAgICB0aGlzLl9iZWFjb24gPSBiZWFjb25cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBjbGllbnQgdmFsdWUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBjb25uZWN0IHByb21pc2UgdmFsdWUuXG4gICAgICogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIHJlcG9ydCB0aW1lciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9IC0gUGVuZGluZyBcImJlYWNvbiBzdGlsbCB1bnJlYWNoYWJsZVwiIHJlcG9ydCB0aW1lci5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIG91dGFnZSByZXBvcnRlZCB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjdXJyZW50IGJlYWNvbiBvdXRhZ2UgaGFzIGFscmVhZHkgYmVlbiByZXBvcnRlZC5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gbGFzdCBkb3duIGVycm9yIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7c3RhZ2U6IFwiYmVhY29uLWNvbm5lY3RcIiB8IFwiYmVhY29uLWRpc2Nvbm5lY3RcIiwgZXJyb3I6IEVycm9yfSB8IHVuZGVmaW5lZH0gLSBMYXRlc3QgYmVhY29uLWRvd24gZGV0YWlscywgcmVwb3J0ZWQgb25seSBpZiB0aGUgb3V0YWdlIGlzIHN1c3RhaW5lZC5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgPSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICAgIHRoaXMuX2F0dGFjaG1lbnRzID0gYXR0YWNobWVudHMgfHwge31cbiAgICAvLyBDb3B5IHNvIGFwcGVuZGluZyBwYWNrYWdlLWRlcml2ZWQgZW50cmllcyBiZWxvdyBuZXZlciBtdXRhdGVzIGEgY2FsbGVyJ3NcbiAgICAvLyBzaGFyZWQgYXJyYXkgKGNvbmZpZyBtb2R1bGVzIGNvbW1vbmx5IGV4cG9ydCBhIHJldXNlZCBiYWNrZW5kUHJvamVjdHMgYXJyYXkpLlxuICAgIHRoaXMuX2JhY2tlbmRQcm9qZWN0cyA9IGJhY2tlbmRQcm9qZWN0cyA/IFsuLi5iYWNrZW5kUHJvamVjdHNdIDogW11cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclR5cGVbXX0gKi9cbiAgICB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMgPSBbXVxuICAgIHRoaXMuY29ycyA9IGNvcnNcbiAgICB0aGlzLl9jb29raWVTZWNyZXQgPSBjb29raWVTZWNyZXRcbiAgICB0aGlzLmRhdGFiYXNlID0gZGF0YWJhc2VcbiAgICB0aGlzLmRlYnVnID0gZGVidWdcbiAgICB0aGlzLl9kZWJ1Z0VuZHBvaW50ID0gdGhpcy5fbm9ybWFsaXplRGVidWdFbmRwb2ludChkZWJ1Z0VuZHBvaW50KVxuICAgIHRoaXMuX2FwaU1hbmlmZXN0ID0gdGhpcy5fbm9ybWFsaXplQXBpTWFuaWZlc3QoYXBpTWFuaWZlc3QpXG4gICAgdGhpcy5fbWNwID0gdGhpcy5fbm9ybWFsaXplTWNwKG1jcClcbiAgICB0aGlzLl9lbnZpcm9ubWVudCA9IGVudmlyb25tZW50IHx8IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52LlZFTE9DSU9VU19FTlYgfHwgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuTk9ERV9FTlYgfHwgXCJkZXZlbG9wbWVudFwiXG4gICAgdGhpcy5fZW52aXJvbm1lbnRIYW5kbGVyID0gZW52aXJvbm1lbnRIYW5kbGVyXG4gICAgdGhpcy5fZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzXG4gICAgdGhpcy5fZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgPSBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9PT0gdW5kZWZpbmVkXG4gICAgICA/IHNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMgIT09IHRydWVcbiAgICAgIDogZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHNcbiAgICB0aGlzLl9kaXJlY3RvcnkgPSBkaXJlY3RvcnlcbiAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzID0gaW5pdGlhbGl6ZU1vZGVsc1xuICAgIC8qKiBAdHlwZSB7VmVsb2Npb3VzUGFja2FnZVtdfSAqL1xuICAgIHRoaXMuX3BhY2thZ2VzID0gKHBhY2thZ2VzIHx8IFtdKS5tYXAoKGVudHJ5KSA9PiBWZWxvY2lvdXNQYWNrYWdlLmZyb20oZW50cnkpKVxuXG4gICAgLy8gQXBwZW5kIGEgZGVyaXZlZCBiYWNrZW5kLXByb2plY3QgcGVyIHBhY2thZ2Ugc28gdGhlIGV4aXN0aW5nIHJlc291cmNlXG4gICAgLy8gZGlzY292ZXJ5ICsgZnJvbnRlbmQtbW9kZWwgZ2VuZXJhdGlvbiBtYWNoaW5lcnkgaW5jbHVkZXMgaXQuIFBhY2thZ2VcbiAgICAvLyBmcm9udGVuZCBtb2RlbHMgYXJlIGdlbmVyYXRlZCBpbnRvIHRoZSBhcHAncyBmcm9udGVuZC1tb2RlbHMgb3V0cHV0LlxuICAgIGNvbnN0IGFwcEZyb250ZW5kTW9kZWxzT3V0cHV0UGF0aCA9IHRoaXMuX2JhY2tlbmRQcm9qZWN0c1swXT8uZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoXG5cbiAgICBmb3IgKGNvbnN0IHZlbG9jaW91c1BhY2thZ2Ugb2YgdGhpcy5fcGFja2FnZXMpIHtcbiAgICAgIHRoaXMuX2JhY2tlbmRQcm9qZWN0cy5wdXNoKHZlbG9jaW91c1BhY2thZ2UudG9CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24oe2Zyb250ZW5kTW9kZWxzT3V0cHV0UGF0aDogYXBwRnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRofSkpXG4gICAgfVxuXG4gICAgdGhpcy5faXNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2luaXRpYWxpemVyLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gW11cbiAgICAvKiogQHR5cGUge2Jvb2xlYW59ICovXG4gICAgdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBJbnZhbGlkYXRlcyBtb2RlbCBwaGFzZXMgdGhhdCBzdGFydGVkIGJlZm9yZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBjbG9zZWQuXG4gICAgICogQHR5cGUge251bWJlcn1cbiAgICAgKi9cbiAgICB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IDBcbiAgICAvKipcbiAgICAgKiBJbi1wcm9ncmVzcyBgaW5pdGlhbGl6ZU1vZGVscygpYCBwcm9taXNlLiBNb2RlbCBpbml0aWFsaXphdGlvbiBpcyBhblxuICAgICAqIGF0b21pYyBib290c3RyYXAgcGhhc2U6IGNvbmN1cnJlbnQgY2FsbGVycyBzaGFyZSBpdCwgYW5kIGEgcmVqZWN0aW9uXG4gICAgICogbGVhdmVzIHRoZSBwaGFzZSBlbGlnaWJsZSBmb3IgYSBsYXRlciBjb21wbGV0ZSBhdHRlbXB0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogQ3VycmVudCBgaW5pdGlhbGl6ZSgpYCBwcm9taXNlLCBtZW1vaXplZCBzbyBjb25jdXJyZW50IGNhbGxlcnMgYXdhaXQgdGhlXG4gICAgICogc2FtZSBib290c3RyYXAuIFJldGFpbmVkIGFjcm9zcyBhIGNvbm5lY3Rpb24gY2xvc2UgdW50aWwgc3RhbGUgYm9vdHN0cmFwXG4gICAgICogd29yayBzZXR0bGVzLCB0aGVuIGNsZWFyZWQgYnkgaWRlbnRpdHkgYmVmb3JlIHRoZSBuZXcgZ2VuZXJhdGlvbiByZXRyaWVzLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgY29uc3QgcmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciA9IGh0dHBTZXJ2ZXI/LnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJcbiAgICBjb25zdCB3ZWJzb2NrZXRJbmJvdW5kUXVldWUgPSBodHRwU2VydmVyPy53ZWJzb2NrZXRJbmJvdW5kUXVldWVcbiAgICBjb25zdCB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlID0gaHR0cFNlcnZlcj8ud2Vic29ja2V0T3V0Ym91bmRRdWV1ZVxuXG4gICAgaWYgKHJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgcmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG11c3QgYmUgYSBmdW5jdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuaHR0cFNlcnZlciA9IHtcbiAgICAgIC4uLihodHRwU2VydmVyIHx8IHt9KSxcbiAgICAgIGNvbXByZXNzaW9uOiBub3JtYWxpemVIdHRwQ29tcHJlc3Npb24oaHR0cFNlcnZlcj8uY29tcHJlc3Npb24pLFxuICAgICAgbWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlczogb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKGh0dHBTZXJ2ZXI/Lm1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXMsIFwiaHR0cFNlcnZlci5tYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzXCIpLFxuICAgICAgbWF4UmVxdWVzdEJvZHlCeXRlczogb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKGh0dHBTZXJ2ZXI/Lm1heFJlcXVlc3RCb2R5Qnl0ZXMsIFwiaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzXCIpLFxuICAgICAgcmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlcixcbiAgICAgIHdlYnNvY2tldEluYm91bmRRdWV1ZToge1xuICAgICAgICBtYXhQZW5kaW5nQnl0ZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0SW5ib3VuZFF1ZXVlPy5tYXhQZW5kaW5nQnl0ZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWUubWF4UGVuZGluZ0J5dGVzXCIsIERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfQllURVMpLFxuICAgICAgICBtYXhQZW5kaW5nTWVzc2FnZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0SW5ib3VuZFF1ZXVlPy5tYXhQZW5kaW5nTWVzc2FnZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWUubWF4UGVuZGluZ01lc3NhZ2VzXCIsIERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfTUVTU0FHRVMpXG4gICAgICB9LFxuICAgICAgd2Vic29ja2V0T3V0Ym91bmRRdWV1ZToge1xuICAgICAgICBtYXhQZW5kaW5nQnl0ZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0T3V0Ym91bmRRdWV1ZT8ubWF4UGVuZGluZ0J5dGVzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0T3V0Ym91bmRRdWV1ZS5tYXhQZW5kaW5nQnl0ZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfQllURVMpLFxuICAgICAgICBtYXhQZW5kaW5nRnJhbWVzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldE91dGJvdW5kUXVldWU/Lm1heFBlbmRpbmdGcmFtZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlLm1heFBlbmRpbmdGcmFtZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfRlJBTUVTKVxuICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGh0dHAgc2VydmVyIGluc3RhbmNlIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7Z2V0RGVidWdTbmFwc2hvdDogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9odHRwU2VydmVySW5zdGFuY2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLmxvY2FsZSA9IGxvY2FsZVxuICAgIHRoaXMubG9jYWxlRmFsbGJhY2tzID0gbG9jYWxlRmFsbGJhY2tzXG4gICAgdGhpcy5sb2NhbGVzID0gbG9jYWxlc1xuICAgIHRoaXMuX2luaXRpYWxpemVycyA9IGluaXRpYWxpemVyc1xuICAgIHRoaXMuX3Rlc3RpbmcgPSB0ZXN0aW5nXG4gICAgdGhpcy5fdGltZVpvbmUgPSB0aW1lWm9uZVxuICAgIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9IHRpbWV6b25lT2Zmc2V0TWludXRlc1xuICAgIHRoaXMuX3RydXN0ZWRQcm94aWVzID0gdHJ1c3RlZFByb3hpZXNcbiAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zID0gcmVxdWVzdFRpbWVvdXRNc1xuICAgIHRoaXMuX3N0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbFxuICAgIHRoaXMuX3N5bmMgPSB0aGlzLl9ub3JtYWxpemVTeW5jQ29uZmlndXJhdGlvbihzeW5jKVxuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzID0gdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgfHwge31cbiAgICB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyID0gdGVuYW50RGF0YWJhc2VSZXNvbHZlclxuICAgIHRoaXMuX3RlbmFudFJlc29sdmVyID0gdGVuYW50UmVzb2x2ZXJcbiAgICB0aGlzLl90ZXN0VGVuYW50UG9vbHMgPSB0ZXN0VGVuYW50UG9vbHNcbiAgICB0aGlzLl93ZWJzb2NrZXRFdmVudHMgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmliZXJzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyID0gd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyXG4gICAgdGhpcy5fd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlciA9IHdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jb25uZWN0aW9uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBDaGFubmVsIHR5cGVzIHJlZ2lzdGVyZWQgd2l0aCBge2xpdmVPbmx5OiB0cnVlfWA6IHRoZWlyIHRyYWZmaWMgaXNcbiAgICAgKiBuZXZlciBwZXJzaXN0ZWQgZm9yIHJlcGxheSwgYW5kIGBtYXJrQ2hhbm5lbEludGVyZXN0ZWRgIHJlamVjdHMgdGhlXG4gICAgICogbmFtZS5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgdGhpcy5fbGl2ZU9ubHlXZWJzb2NrZXRDaGFubmVscyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBTZXQ8aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0Pj59IC0gY2hhbm5lbFR5cGUg4oaSIGxpdmUgc3Vic2NyaXB0aW9ucyBhY3Jvc3MgYWxsIHNlc3Npb25zLlxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBJbi1mbGlnaHQgbG9jYWwgKHBlci1wcm9jZXNzKSB3ZWJzb2NrZXQgY2hhbm5lbCBicm9hZGNhc3QgZGVsaXZlcmllcyxcbiAgICAgKiBsYXVuY2hlZCBmaXJlLWFuZC1mb3JnZXQgZnJvbSBgX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsYCBzbyBvbmUgc2xvd1xuICAgICAqIHN1YnNjcmliZXIgbmV2ZXIgYmxvY2tzIGFub3RoZXIuIFRyYWNrZWQgaGVyZSBzb1xuICAgICAqIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBjYW4gc25hcHNob3QgYW5kIGRyYWluIHRoZW0gYmVmb3JlIHNldHRsaW5nLlxuICAgICAqIFNldHRsZWQgZGVsaXZlcmllcyBhcmUgcmVtb3ZlZCBieSB0aGUgdHJhY2tpbmctbGV2ZWwgY2xlYW51cC5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogTGF0ZXN0IGxvY2FsIGJyb2FkY2FzdCBkZWxpdmVyeSBwZXIgc3Vic2NyaXB0aW9uLiBDaGFpbmluZyBzdWJzZXF1ZW50XG4gICAgICogZGVsaXZlcmllcyBwcmVzZXJ2ZXMgbGlmZWN5Y2xlIGV2ZW50IG9yZGVyIHdpdGhvdXQgY291cGxpbmcgc2VwYXJhdGVcbiAgICAgKiBzdWJzY3JpYmVycyB0byBvbmUgYW5vdGhlci5cbiAgICAgKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQsIFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscyA9IG5ldyBXZWFrTWFwKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IHNlc3Npb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdD59IC0gTGl2ZSB3ZWJzb2NrZXQgc2Vzc2lvbnMsIGluY2x1ZGluZyBwYXVzZWQgc2Vzc2lvbnMgd2l0aGluIHRoZSBncmFjZSB3aW5kb3cuXG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgcGF1c2VkIHdlYnNvY2tldCBzZXNzaW9ucyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge3Nlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIGdyYWNlVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+LCBwYXVzZWRBdDogbnVtYmVyfT59IC0gc2Vzc2lvbklkIOKGkiBwYXVzZWQgc2Vzc2lvbiBhd2FpdGluZyByZXN1bWUuXG4gICAgICovXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKiBHcmFjZSBwZXJpb2QgZm9yIHBhdXNlZCBXZWJTb2NrZXQgc2Vzc2lvbnMgYmVmb3JlIHBlcm1hbmVudCB0ZWFyZG93bi4gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzID0gMzAwXG5cbiAgICAvKiogSW50ZXJ2YWwgKHNlY29uZHMpIGJldHdlZW4gc2VydmVy4oaSY2xpZW50IGhlYXJ0YmVhdCBwaW5nczsgMCBkaXNhYmxlcyByZWFwaW5nIG9mIHNpbGVudCBzb2NrZXRzLiAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzID0gMzBcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIHdyYXBwZXIgY2FsbGVkIGFyb3VuZCBldmVyeSBXZWJTb2NrZXQtYm9ybmUgcmVxdWVzdCAvXG4gICAgICogY29ubmVjdGlvbiBtZXNzYWdlIC8gY2hhbm5lbCBkaXNwYXRjaC4gQXBwcyByZWdpc3RlciBpdCBoZXJlXG4gICAgICogdG8gc2V0IHVwIHBlci1yZXF1ZXN0IGNvbnRleHQgKGUuZy4gQXN5bmNMb2NhbFN0b3JhZ2UgZm9yXG4gICAgICogbG9jYWxlLCB0ZW5hbnQsIHRyYWNpbmcpIHRoYXQgZG93bnN0cmVhbSBoYW5kbGVycyByZWFkLlxuICAgICAqIEB0eXBlIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH1cbiAgICAgKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0ID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBhcm91bmQgYWN0aW9uIHZhbHVlLlxuICAgICAqIEB0eXBlIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9hcm91bmRBY3Rpb24gPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBzZXNzaW9uIGlkZW50aXR5IHJlc29sdmVyIHZhbHVlLlxuICAgICAqIEB0eXBlIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgbnVsbH0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlciA9IG51bGxcbiAgICB0aGlzLl9sb2dnaW5nID0gbG9nZ2luZ1xuICAgIHRoaXMuX2xvZ1JlZGFjdG9yID0gbmV3IExvZ1JlZGFjdG9yKHtzZW5zaXRpdmVOYW1lczogbG9nZ2luZz8uc2Vuc2l0aXZlTmFtZXN9KVxuICAgIHRoaXMuX21haWxlckJhY2tlbmQgPSBtYWlsZXJCYWNrZW5kXG4gICAgdGhpcy5fcm91dGVSZXNvbHZlckhvb2tzID0gWy4uLihyb3V0ZVJlc29sdmVySG9va3MgfHwgW10pXVxuICAgIHRoaXMuX2FkZERlYnVnRW5kcG9pbnRSb3V0ZUhvb2soKVxuICAgIHRoaXMuX2FkZEFwaU1hbmlmZXN0Um91dGVIb29rKClcbiAgICB0aGlzLl9hZGRNY3BSb3V0ZUhvb2soKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBhcHBsaWVkIHJvdXRlIG1vdW50cyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7V2Vha1NldDxvYmplY3Q+fSAqL1xuICAgIHRoaXMuX2FwcGxpZWRSb3V0ZU1vdW50cyA9IG5ldyBXZWFrU2V0KClcbiAgICB0aGlzLl9lcnJvckV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuICAgIHRoaXMuX3RlbGVtZXRyeUV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBkYXRhYmFzZSBwb29scyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIHRoaXMuZGF0YWJhc2VQb29scyA9IHt9XG4gICAgdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgPSBuZXcgRnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoe2NvbmZpZ3VyYXRpb246IHRoaXMsIG1heE9wZW5IYW5kbGVzOiBmcm9udGVuZFRlbmFudFNxbGl0ZT8ubWF4T3BlbkhhbmRsZXN9KVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBtb2RlbCBjbGFzc2VzIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIHRoaXMubW9kZWxDbGFzc2VzID0ge31cblxuICAgIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuc2V0Q29uZmlndXJhdGlvbih0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF1dG9sb2FkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBvbiBsYXp5IGFjY2VzcyBpcyBlbmFibGVkIGdsb2JhbGx5LlxuICAgKi9cbiAgZ2V0QXV0b2xvYWQoKSB7IHJldHVybiB0aGlzLl9hdXRvbG9hZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4cG9zZSBpbnRlcm5hbCBlcnJvcnMgdG8gY2xpZW50cy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdW5leHBlY3RlZCBpbnRlcm5hbCBlcnJvciBkZXRhaWxzIG1heSBiZSByZXR1cm5lZCB0byBBUEkgY2xpZW50cy5cbiAgICovXG4gIGdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCkgeyByZXR1cm4gdGhpcy5fZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgPT09IHRydWUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgZXJyb3JzIGV4cG9zZSBvbmx5IGV4cGxpY2l0bHkgc2FmZSBtZXNzYWdlcy5cbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBnZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgaW50ZXJuYWwgZXJyb3IgZXhwb3N1cmUgaXMgZGlzYWJsZWQuXG4gICAqL1xuICBnZXRTZWN1cmVGcm9udGVuZE1vZGVsRXJyb3JzKCkgeyByZXR1cm4gIXRoaXMuZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlYnVnIGVuZHBvaW50LlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXREZWJ1Z0VuZHBvaW50KCkgeyByZXR1cm4gdGhpcy5fZGVidWdFbmRwb2ludCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbkNvbmZpZ3VyZWQ6IGJvb2xlYW59fSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZyBmb3IgdGhlIHNuYXBzaG90LCB3aXRoIHRoZSB0b2tlbiByZWRhY3RlZC5cbiAgICovXG4gIF9kZWJ1Z0VuZHBvaW50U25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IHRoaXMuX2RlYnVnRW5kcG9pbnQuZW5hYmxlZCxcbiAgICAgIHBhdGg6IHRoaXMuX2RlYnVnRW5kcG9pbnQucGF0aCxcbiAgICAgIHRva2VuQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkZWJ1ZyBlbmRwb2ludC5cbiAgICogQHBhcmFtIHtib29sZWFuIHwge3BhdGg/OiBzdHJpbmcsIHRva2VuPzogc3RyaW5nfX0gdmFsdWUgLSBEZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIE5vcm1hbGl6ZWQgZGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVEZWJ1Z0VuZHBvaW50KHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCBwYXRoOiBcIi92ZWxvY2lvdXMvZGVidWdcIiwgdG9rZW46IG51bGx9XG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiLCB0b2tlbjogbnVsbH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZGVidWdFbmRwb2ludCB0byBiZSBhIGJvb2xlYW4gb3Igb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSB2YWx1ZS5wYXRoIHx8IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiXG5cbiAgICBpZiAodHlwZW9mIHBhdGggIT09IFwic3RyaW5nXCIgfHwgIXBhdGguc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZGVidWdFbmRwb2ludC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50LnRva2VuIHRvIGJlIGEgbm9uLWVtcHR5IHN0cmluZywgZ290OiAke1N0cmluZyh0b2tlbil9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGgsIHRva2VuOiB0b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB0b2tlbi50cmltKCl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgYXBpIG1hbmlmZXN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIEFQSSBtYW5pZmVzdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIE5vcm1hbGl6ZWQgQVBJIG1hbmlmZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplQXBpTWFuaWZlc3QodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL2FwaS9tYW5pZmVzdFwiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvYXBpL21hbmlmZXN0XCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdCB0byBiZSBhIGJvb2xlYW4gb3Igb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSB2YWx1ZS5wYXRoIHx8IFwiL2FwaS9tYW5pZmVzdFwiXG5cbiAgICBpZiAodHlwZW9mIHBhdGggIT09IFwic3RyaW5nXCIgfHwgIXBhdGguc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXBpTWFuaWZlc3QucGF0aCB0byBiZSBhIHN0cmluZyBzdGFydGluZyB3aXRoICcvJywgZ290OiAke1N0cmluZyhwYXRoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gdmFsdWUudG9rZW4gPT09IHVuZGVmaW5lZCB8fCB2YWx1ZS50b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB2YWx1ZS50b2tlblxuXG4gICAgaWYgKHRva2VuICE9PSBudWxsICYmICh0eXBlb2YgdG9rZW4gIT09IFwic3RyaW5nXCIgfHwgIXRva2VuLnRyaW0oKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXBpTWFuaWZlc3QudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBhcGkgbWFuaWZlc3Qgcm91dGUgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FkZEFwaU1hbmlmZXN0Um91dGVIb29rKCkge1xuICAgIGlmICghdGhpcy5fYXBpTWFuaWZlc3QuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiR0VUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX2FwaU1hbmlmZXN0LnBhdGgpIHJldHVybiBudWxsXG5cbiAgICAgIGlmICh0aGlzLl9hcGlNYW5pZmVzdC50b2tlbiAmJiAhdGhpcy5kZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgdGhpcy5fYXBpTWFuaWZlc3QudG9rZW4pKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3Rpb246IFwic2hvd1wiLFxuICAgICAgICBjb250cm9sbGVyOiBcInZlbG9jaW91c0FwaU1hbmlmZXN0XCIsXG4gICAgICAgIGNvbnRyb2xsZXJQYXRoOiBcIi4vYnVpbHQtaW4vYXBpLW1hbmlmZXN0L2NvbnRyb2xsZXIuanNcIixcbiAgICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uczogdHJ1ZSxcbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9hcGktbWFuaWZlc3RcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbWNwLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIE1DUCBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIE5vcm1hbGl6ZWQgTUNQIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplTWNwKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCBwYXRoOiBcIi9tY3BcIiwgdG9rZW46IG51bGx9XG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IFwiL21jcFwiLCB0b2tlbjogbnVsbH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbWNwIHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvbWNwXCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBtY3AucGF0aCB0byBiZSBhIHN0cmluZyBzdGFydGluZyB3aXRoICcvJywgZ290OiAke1N0cmluZyhwYXRoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gdmFsdWUudG9rZW4gPT09IHVuZGVmaW5lZCB8fCB2YWx1ZS50b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB2YWx1ZS50b2tlblxuXG4gICAgaWYgKHRva2VuICE9PSBudWxsICYmICh0eXBlb2YgdG9rZW4gIT09IFwic3RyaW5nXCIgfHwgIXRva2VuLnRyaW0oKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbWNwLnRva2VuIHRvIGJlIGEgbm9uLWVtcHR5IHN0cmluZywgZ290OiAke1N0cmluZyh0b2tlbil9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGgsIHRva2VuOiB0b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB0b2tlbi50cmltKCl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgbWNwIHJvdXRlIGhvb2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hZGRNY3BSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9tY3AuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiUE9TVFwiKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKGN1cnJlbnRQYXRoICE9PSB0aGlzLl9tY3AucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgLy8gV2hlbiBhIHRva2VuIGlzIGNvbmZpZ3VyZWQsIGFuIHVuYXV0aGVudGljYXRlZCByZXF1ZXN0IGdldHMgbm8gcm91dGUgYXRcbiAgICAgIC8vIGFsbCAoNDA0KSByYXRoZXIgdGhhbiBhIDQwMSwgc28gdGhlIGVuZHBvaW50J3MgZXhpc3RlbmNlIHN0YXlzIGhpZGRlbi5cbiAgICAgIGlmICh0aGlzLl9tY3AudG9rZW4gJiYgIXRoaXMuZGVidWdFbmRwb2ludFJlcXVlc3RBdXRob3JpemVkKHJlcXVlc3QsIHRoaXMuX21jcC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJoYW5kbGVcIixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNNY3BcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9tY3AvY29udHJvbGxlci5qc1wiLFxuICAgICAgICAvLyBUZW5hbnQgYW5kIGFiaWxpdHkgcmVzb2x1dGlvbiBiZWxvbmcgdG8gdGhlIGZyb250ZW5kLW1vZGVsIGRpc3BhdGNoZXJcbiAgICAgICAgLy8gcGVyIGNvbW1hbmQgKHdpdGhGcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQpLCBleGFjdGx5IGxpa2UgdGhlIHJlZ3VsYXJcbiAgICAgICAgLy8gL2Zyb250ZW5kLW1vZGVscyByb3V0ZSDigJQgdGhlIE1DUCB0cmFuc3BvcnQgbmV2ZXIgYnlwYXNzZXMgdGhlbS5cbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9tY3BcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgZGVidWcgZW5kcG9pbnQgcm91dGUgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FkZERlYnVnRW5kcG9pbnRSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9kZWJ1Z0VuZHBvaW50LmVuYWJsZWQpIHJldHVyblxuXG4gICAgdGhpcy5hZGRSb3V0ZVJlc29sdmVySG9vaygoe2N1cnJlbnRQYXRoLCByZXF1ZXN0fSkgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QuaHR0cE1ldGhvZCgpICE9PSBcIkdFVFwiKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKGN1cnJlbnRQYXRoICE9PSB0aGlzLl9kZWJ1Z0VuZHBvaW50LnBhdGgpIHJldHVybiBudWxsXG5cbiAgICAgIC8vIFdoZW4gYSB0b2tlbiBpcyBjb25maWd1cmVkLCBhbiB1bmF1dGhlbnRpY2F0ZWQgcmVxdWVzdCBnZXRzIG5vIHJvdXRlIGF0XG4gICAgICAvLyBhbGwgKDQwNCkgcmF0aGVyIHRoYW4gYSA0MDEsIHNvIHRoZSBlbmRwb2ludCdzIGV4aXN0ZW5jZSBzdGF5cyBoaWRkZW4uXG4gICAgICBpZiAodGhpcy5fZGVidWdFbmRwb2ludC50b2tlbiAmJiAhdGhpcy5kZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgdGhpcy5fZGVidWdFbmRwb2ludC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJzaG93XCIsXG4gICAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzRGVidWdcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9kZWJ1Zy9jb250cm9sbGVyLmpzXCIsXG4gICAgICAgIHNraXBDb250cm9sbGVyQ29ubmVjdGlvbnM6IHRydWUsXG4gICAgICAgIHNraXBBYmlsaXR5UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgc2tpcFRlbmFudFJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHZpZXdQYXRoOiBcIi4vYnVpbHQtaW4vZGVidWdcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXV0b2xvYWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3VmFsdWUgLSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QXV0b2xvYWQobmV3VmFsdWUpIHsgdGhpcy5fYXV0b2xvYWQgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ29yc1R5cGUgfCB1bmRlZmluZWR9IC0gVGhlIGNvcnMuXG4gICAqL1xuICBnZXRDb3JzKCkge1xuICAgIHJldHVybiB0aGlzLmNvcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBodHRwIHNlcnZlciBjb21wcmVzc2lvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIGJ1ZmZlcmVkIHJlc3BvbnNlIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRIdHRwU2VydmVyQ29tcHJlc3Npb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5jb21wcmVzc2lvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1heGltdW0gYnVmZmVyZWQgcmVzcG9uc2UgYm9keSBieXRlcy5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGJ5dGUgbGltaXQsIG9yIHVuZGVmaW5lZCB3aGVuIHVuYm91bmRlZC5cbiAgICovXG4gIGdldEh0dHBTZXJ2ZXJNYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzKCkge1xuICAgIHJldHVybiB0aGlzLmh0dHBTZXJ2ZXIubWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1heGltdW0gcmVxdWVzdCBib2R5IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgYnl0ZSBsaW1pdCwgb3IgdW5kZWZpbmVkIHdoZW4gdW5ib3VuZGVkLlxuICAgKi9cbiAgZ2V0SHR0cFNlcnZlck1heFJlcXVlc3RCb2R5Qnl0ZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgcmVxdWVzdC1ib2R5IGhhbmRsaW5nIGFmdGVyIHRoZSByZXF1ZXN0IGxpbmUgYW5kIGhlYWRlcnMgYXJlIGNvbXBsZXRlLFxuICAgKiBiZWZvcmUgYm9keSBieXRlcyBhcmUgcmV0YWluZWQgb3IgZGVjb2RlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cFJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJBcmdzfSBhcmdzIC0gUGFyc2VkIHJlcXVlc3QgaGVhZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX0gLSBFZmZlY3RpdmUgcmVxdWVzdCBwb2xpY3kuXG4gICAqL1xuICByZXNvbHZlSHR0cFJlcXVlc3RCb2R5UG9saWN5KGFyZ3MpIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyXG4gICAgY29uc3QgY29uZmlndXJlZFBvbGljeSA9IHJlc29sdmVyID8gcmVzb2x2ZXIoYXJncykgOiB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX0gKi9cbiAgICBsZXQgcmVzb2x2ZWRQb2xpY3lcblxuICAgIGlmIChjb25maWd1cmVkUG9saWN5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlc29sdmVkUG9saWN5ID0ge21heFJlcXVlc3RCb2R5Qnl0ZXM6IHRoaXMuaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzLCBtb2RlOiBcInBhcnNlZFwifVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWNvbmZpZ3VyZWRQb2xpY3kgfHwgdHlwZW9mIGNvbmZpZ3VyZWRQb2xpY3kgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjb25maWd1cmVkUG9saWN5KSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG11c3QgcmV0dXJuIGFuIG9iamVjdCBvciB1bmRlZmluZWRcIilcbiAgICAgIH1cblxuICAgICAgY29uc3Qge21heFJlcXVlc3RCb2R5Qnl0ZXMsIG1vZGUgPSBcInBhcnNlZFwiLCAuLi5yZXN0UG9saWN5fSA9IGNvbmZpZ3VyZWRQb2xpY3lcbiAgICAgIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMocmVzdFBvbGljeSlcblxuICAgICAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIHJldHVybmVkIHVua25vd24ga2V5czogJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IG1heFJlcXVlc3RCb2R5Qnl0ZXMsIG1vZGUpYClcbiAgICAgIH1cbiAgICAgIGlmIChtb2RlICE9PSBcInBhcnNlZFwiICYmIG1vZGUgIT09IFwicmF3XCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG1vZGUgbXVzdCBiZSBcInBhcnNlZFwiIG9yIFwicmF3XCIsIGdvdDogJHtTdHJpbmcobW9kZSl9YClcbiAgICAgIH1cblxuICAgICAgcmVzb2x2ZWRQb2xpY3kgPSB7XG4gICAgICAgIG1heFJlcXVlc3RCb2R5Qnl0ZXM6IG1heFJlcXVlc3RCb2R5Qnl0ZXMgPT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gdGhpcy5odHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcbiAgICAgICAgICA6IG9wdGlvbmFsUG9zaXRpdmVTYWZlSW50ZWdlcihtYXhSZXF1ZXN0Qm9keUJ5dGVzLCBcImh0dHBTZXJ2ZXIucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciBtYXhSZXF1ZXN0Qm9keUJ5dGVzXCIpLFxuICAgICAgICBtb2RlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGx5TWNwUmVxdWVzdEJvZHlQb2xpY3lEZWZhdWx0cyh7YXJncywgcG9saWN5OiByZXNvbHZlZFBvbGljeX0pXG4gIH1cblxuICAvKipcbiAgICogRW5mb3JjZXMgdGhlIGJ1aWx0LWluIE1DUCBlbmRwb2ludCdzIGJvZHkgY29udHJhY3Qgd2l0aG91dCBwZXItYXBwIHBsdW1iaW5nOiB0aGVcbiAgICogSlNPTi1SUEMgZW52ZWxvcGUgaXMgcmVhZCBmcm9tIHBhcnNlZCBwYXJhbXMsIHNvIHJhdyBtb2RlIGlzIHJlamVjdGVkIHdpdGggYW5cbiAgICogYWN0aW9uYWJsZSBlcnJvciwgYW5kIGEgZnJhbWV3b3JrIGRlZmF1bHQgYnl0ZSBjYXAgYXBwbGllcyB3aGVuIHRoZSBhcHAgY29uZmlndXJlZCBub25lLlxuICAgKiBAcGFyYW0ge3thcmdzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cFJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJBcmdzLCBwb2xpY3k6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX19IG9wdGlvbnMgLSBSZXNvbHV0aW9uIGlucHV0cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX0gLSBFZmZlY3RpdmUgcmVxdWVzdCBwb2xpY3kuXG4gICAqL1xuICBfYXBwbHlNY3BSZXF1ZXN0Qm9keVBvbGljeURlZmF1bHRzKHthcmdzLCBwb2xpY3l9KSB7XG4gICAgaWYgKCF0aGlzLl9tY3AuZW5hYmxlZCkgcmV0dXJuIHBvbGljeVxuICAgIGlmIChhcmdzLmh0dHBNZXRob2QgIT09IFwiUE9TVFwiKSByZXR1cm4gcG9saWN5XG4gICAgaWYgKGFyZ3MucGF0aC5zcGxpdChcIj9cIilbMF0gIT09IHRoaXMuX21jcC5wYXRoKSByZXR1cm4gcG9saWN5XG5cbiAgICBpZiAocG9saWN5Lm1vZGUgPT09IFwicmF3XCIpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgIGBUaGUgYnVpbHQtaW4gTUNQIGVuZHBvaW50IGF0ICR7dGhpcy5fbWNwLnBhdGh9IHJlcXVpcmVzIHBhcnNlZCByZXF1ZXN0IGJvZGllcyBiZWNhdXNlIGl0cyBKU09OLVJQQyBlbnZlbG9wZSBpcyByZWFkIGZyb20gcGFyYW1zLiBSZW1vdmUgdGhlIHJhdy1tb2RlIGh0dHBTZXJ2ZXIucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciBlbnRyeSBmb3IgdGhpcyBwYXRoLmBcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAocG9saWN5Lm1heFJlcXVlc3RCb2R5Qnl0ZXMgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHBvbGljeVxuXG4gICAgcmV0dXJuIHttYXhSZXF1ZXN0Qm9keUJ5dGVzOiBERUZBVUxUX01DUF9NQVhfUkVRVUVTVF9CT0RZX0JZVEVTLCBtb2RlOiBwb2xpY3kubW9kZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb29raWUgc2VjcmV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENvb2tpZSBzZWNyZXQuXG4gICAqL1xuICBnZXRDb29raWVTZWNyZXQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nvb2tpZVNlY3JldFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb259IC0gU3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0U3luY0NvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX3N5bmNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgb2ZmbGluZSBncmFudCBzaWduaW5nIGtleS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudFNpZ25pbmdLZXl9IC0gQ3VycmVudCBzaWduaW5nIGtleS5cbiAgICovXG4gIGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5KCkge1xuICAgIGNvbnN0IHNpZ25pbmdLZXlzID0gdGhpcy5nZXRTeW5jQ29uZmlndXJhdGlvbigpLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzXG5cbiAgICByZXR1cm4gY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoc2lnbmluZ0tleXMpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBzeW5jIC0gU3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRWZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ29uZmlndXJhdGlvbihzeW5jKSB7XG4gICAgY29uc3QgYXBpID0gc3luYz8uYXBpXG4gICAgY29uc3QgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5ID0gc3luYz8uZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5IHx8IG51bGxcbiAgICBjb25zdCBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSA9IHN5bmM/LmNoYW5nZUZlZWRSZXRlbnRpb25TaXplXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50U2lnbmluZ0tleXMgPSBzeW5jPy5vZmZsaW5lR3JhbnRTaWduaW5nS2V5cyB8fCBbXVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudFR0bE1zID0gc3luYz8ub2ZmbGluZUdyYW50VHRsTXNcblxuICAgIGlmIChkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgIT09IG51bGwgJiYgKHR5cGVvZiBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgbXVzdCBiZSBhIHB1YmxpYyBKU09OIFdlYiBLZXkgb2JqZWN0XCIpXG4gICAgfVxuICAgIGlmIChjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSkgfHwgY2hhbmdlRmVlZFJldGVudGlvblNpemUgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2hhbmdlRmVlZFJldGVudGlvblNpemUgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJcIilcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzKSkgdGhyb3cgbmV3IEVycm9yKFwic3luYy5vZmZsaW5lR3JhbnRTaWduaW5nS2V5cyBtdXN0IGJlIGFuIGFycmF5XCIpXG4gICAgaWYgKG9mZmxpbmVHcmFudFR0bE1zICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKG9mZmxpbmVHcmFudFR0bE1zKSB8fCBvZmZsaW5lR3JhbnRUdGxNcyA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5vZmZsaW5lR3JhbnRUdGxNcyBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlciBudW1iZXIgb2YgbWlsbGlzZWNvbmRzXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFwaTogdGhpcy5fbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSxcbiAgICAgIGNoYW5nZUZlZWRSZXRlbnRpb25TaXplOiBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSB8fCAxMDAwMCxcbiAgICAgIGNsaWVudDogdGhpcy5fbm9ybWFsaXplU3luY0NsaWVudENvbmZpZ3VyYXRpb24oc3luYz8uY2xpZW50KSxcbiAgICAgIGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSxcbiAgICAgIG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzOiBvZmZsaW5lR3JhbnRTaWduaW5nS2V5cy5tYXAoKGtleSkgPT4gbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleShrZXkpKSxcbiAgICAgIG9mZmxpbmVHcmFudFR0bE1zOiBvZmZsaW5lR3JhbnRUdGxNcyB8fCAyNCAqIDYwICogNjAgKiAxMDAwXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgY2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uIGNvbnN1bWVkIGJ5IGBTeW5jQ2xpZW50LmZyb21Db25maWd1cmF0aW9uKC4uLilgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gY2xpZW50IC0gQ2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRWZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIGNsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ2xpZW50Q29uZmlndXJhdGlvbihjbGllbnQpIHtcbiAgICBpZiAoY2xpZW50ID09PSB1bmRlZmluZWQgfHwgY2xpZW50ID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIGNsaWVudCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNsaWVudCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50IG11c3QgYmUgYW4gb2JqZWN0IHdpdGggdHJhbnNwb3J0IGFuZCBhdXRoZW50aWNhdGlvblRva2VuXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge2F1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgaXNPbmxpbmUsIG1vdW50UGF0aCwgb25FcnJvciwgb2ZmbGluZSwgcmVhbHRpbWUsIHRyYW5zcG9ydCwgd2Vic29ja2V0Q2xpZW50LCB3ZWJzb2NrZXRVcmwsIC4uLnJlc3RDbGllbnR9ID0gY2xpZW50XG4gICAgY29uc3QgcmVzdENsaWVudEtleXMgPSBPYmplY3Qua2V5cyhyZXN0Q2xpZW50KVxuXG4gICAgaWYgKHJlc3RDbGllbnRLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RDbGllbnRLZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBpc09ubGluZSwgbW91bnRQYXRoLCBvbkVycm9yLCBvZmZsaW5lLCByZWFsdGltZSwgdHJhbnNwb3J0LCB3ZWJzb2NrZXRDbGllbnQsIHdlYnNvY2tldFVybClgKVxuICAgIH1cbiAgICBpZiAoIXRyYW5zcG9ydCB8fCB0eXBlb2YgdHJhbnNwb3J0ICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiB0cmFuc3BvcnQucG9zdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC50cmFuc3BvcnQgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBhIHBvc3QocGF0aCwgYm9keSkgbWV0aG9kIChsaWtlIHRoZSBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2xpZW50KVwiKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGF1dGhlbnRpY2F0aW9uVG9rZW4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYXV0aGVudGljYXRpb25Ub2tlbiBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIHRoZSBhdXRoIHRva2VuIHNlbnQgd2l0aCBzeW5jIHJlcXVlc3RzXCIpXG4gICAgfVxuICAgIGlmIChpc09ubGluZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBpc09ubGluZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5pc09ubGluZSBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIGNvbm5lY3Rpdml0eVwiKVxuICAgIH1cbiAgICBpZiAob25FcnJvciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvbkVycm9yICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9uRXJyb3IgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlcG9ydGluZyBiYWNrZ3JvdW5kIHN5bmMgZmFpbHVyZXNcIilcbiAgICB9XG4gICAgaWYgKGJhdGNoU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihiYXRjaFNpemUpIHx8IGJhdGNoU2l6ZSA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYmF0Y2hTaXplIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyXCIpXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuICAgIGlmICh3ZWJzb2NrZXRDbGllbnQgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHdlYnNvY2tldENsaWVudCAhPT0gXCJvYmplY3RcIiB8fCB3ZWJzb2NrZXRDbGllbnQgPT09IG51bGwgfHwgdHlwZW9mIHdlYnNvY2tldENsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC53ZWJzb2NrZXRDbGllbnQgbXVzdCBiZSBhIHdlYnNvY2tldCBjbGllbnQgd2l0aCBhIHN1YnNjcmliZUNoYW5uZWwgbWV0aG9kIChsaWtlIFZlbG9jaW91c1dlYnNvY2tldENsaWVudClcIilcbiAgICB9XG4gICAgaWYgKHdlYnNvY2tldFVybCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB3ZWJzb2NrZXRVcmwgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHdlYnNvY2tldFVybCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50LndlYnNvY2tldFVybCBtdXN0IGJlIGEgVVJMIHN0cmluZyBvciBhIGZ1bmN0aW9uIHJlc29sdmluZyBvbmUsIGdvdDogJHtTdHJpbmcod2Vic29ja2V0VXJsKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplLFxuICAgICAgaXNPbmxpbmUsXG4gICAgICBtb3VudFBhdGg6IChtb3VudFBhdGggfHwgXCIvdmVsb2Npb3VzL3N5bmNcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCIsXG4gICAgICBvZmZsaW5lOiB0aGlzLl9ub3JtYWxpemVTeW5jQ2xpZW50T2ZmbGluZUNvbmZpZ3VyYXRpb24ob2ZmbGluZSksXG4gICAgICBvbkVycm9yLFxuICAgICAgcmVhbHRpbWUsXG4gICAgICB0cmFuc3BvcnQsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQsXG4gICAgICB3ZWJzb2NrZXRVcmxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyB0aGUgY2xpZW50LXNpZGUgbG9uZy1vZmZsaW5lIHNlc3Npb24gY29uZmlndXJhdGlvbiBjb25zdW1lZCBieVxuICAgKiBgU3luY0NsaWVudC5zdGFydE9mZmxpbmVTZXNzaW9uKClgLiBUaGUgZnJhbWV3b3JrIG93bnMgdGhlIHNlc3Npb25cbiAgICogbGlmZWN5Y2xlOyB0aGUgYXBwIHByb3ZpZGVzIGR1cmFibGUgaWRlbnRpdHkgc3RvcmFnZSwgdGhlIGVucm9sbG1lbnQgaG9vayxcbiAgICogYW5kIHRoZSBncmFudCBzY29wZXMgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRPZmZsaW5lQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gb2ZmbGluZSAtIE9mZmxpbmUgY29uZmlndXJhdGlvbiBibG9jay5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkVmVsb2Npb3VzU3luY0NsaWVudE9mZmxpbmVDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgb2ZmbGluZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNDbGllbnRPZmZsaW5lQ29uZmlndXJhdGlvbihvZmZsaW5lKSB7XG4gICAgaWYgKG9mZmxpbmUgPT09IHVuZGVmaW5lZCB8fCBvZmZsaW5lID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIG9mZmxpbmUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShvZmZsaW5lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGRldmljZUlkZW50aXR5U3RvcmFnZSwgZW5yb2xsRGV2aWNlLCBhbmQgZ3JhbnRTY29wZXNcIilcbiAgICB9XG5cbiAgICBjb25zdCB7YmFja2VuZFB1YmxpY0tleSwgYm9vdHN0cmFwUGF0aCwgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLCBlbnJvbGxEZXZpY2UsIGdyYW50U2NvcGVzLCBncmFudFN0b3JhZ2UsIG11dGF0aW9uTG9nLCBub3csIHJlcGxheVBhdGgsIC4uLnJlc3RPZmZsaW5lfSA9IG9mZmxpbmVcbiAgICBjb25zdCByZXN0T2ZmbGluZUtleXMgPSBPYmplY3Qua2V5cyhyZXN0T2ZmbGluZSlcblxuICAgIGlmIChyZXN0T2ZmbGluZUtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5vZmZsaW5lIHJlY2VpdmVkIHVua25vd24ga2V5czogJHtyZXN0T2ZmbGluZUtleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBiYWNrZW5kUHVibGljS2V5LCBib290c3RyYXBQYXRoLCBkZXZpY2VJZGVudGl0eVN0b3JhZ2UsIGVucm9sbERldmljZSwgZ3JhbnRTY29wZXMsIGdyYW50U3RvcmFnZSwgbXV0YXRpb25Mb2csIG5vdywgcmVwbGF5UGF0aClgKVxuICAgIH1cbiAgICBpZiAoIWRldmljZUlkZW50aXR5U3RvcmFnZSB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGV2aWNlSWRlbnRpdHlTdG9yYWdlKSB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLmxvYWQgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLnNhdmUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5kZXZpY2VJZGVudGl0eVN0b3JhZ2UgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBsb2FkKCkgYW5kIHNhdmUoaWRlbnRpdHkpIG1ldGhvZHNcIilcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBlbnJvbGxEZXZpY2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5lbnJvbGxEZXZpY2UgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgYmFja2VuZC1zaWduZWQgZGV2aWNlIGNlcnRpZmljYXRlXCIpXG4gICAgaWYgKHR5cGVvZiBncmFudFNjb3BlcyAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmdyYW50U2NvcGVzIG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgdGhlIGJvb3RzdHJhcCBncmFudCBzY29wZXNcIilcbiAgICBpZiAoYmFja2VuZFB1YmxpY0tleSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgYmFja2VuZFB1YmxpY0tleSAhPT0gXCJvYmplY3RcIiB8fCBiYWNrZW5kUHVibGljS2V5ID09PSBudWxsIHx8IEFycmF5LmlzQXJyYXkoYmFja2VuZFB1YmxpY0tleSkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmJhY2tlbmRQdWJsaWNLZXkgbXVzdCBiZSBhIHB1YmxpYyBKU09OIFdlYiBLZXkgb2JqZWN0XCIpXG4gICAgfVxuICAgIGlmIChib290c3RyYXBQYXRoICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBib290c3RyYXBQYXRoICE9PSBcInN0cmluZ1wiIHx8ICFib290c3RyYXBQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5vZmZsaW5lLmJvb3RzdHJhcFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhib290c3RyYXBQYXRoKX1gKVxuICAgIH1cbiAgICBpZiAocmVwbGF5UGF0aCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgcmVwbGF5UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcmVwbGF5UGF0aC5zdGFydHNXaXRoKFwiL1wiKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQub2ZmbGluZS5yZXBsYXlQYXRoIG11c3Qgc3RhcnQgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocmVwbGF5UGF0aCl9YClcbiAgICB9XG4gICAgaWYgKGdyYW50U3RvcmFnZSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgZ3JhbnRTdG9yYWdlICE9PSBcIm9iamVjdFwiIHx8IGdyYW50U3RvcmFnZSA9PT0gbnVsbCB8fCBBcnJheS5pc0FycmF5KGdyYW50U3RvcmFnZSkgfHwgdHlwZW9mIGdyYW50U3RvcmFnZS5sb2FkICE9PSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIGdyYW50U3RvcmFnZS5zYXZlICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmdyYW50U3RvcmFnZSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGxvYWQoKSBhbmQgc2F2ZShncmFudHMpIG1ldGhvZHNcIilcbiAgICB9XG4gICAgaWYgKG11dGF0aW9uTG9nICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtdXRhdGlvbkxvZyAhPT0gXCJvYmplY3RcIiB8fCBtdXRhdGlvbkxvZyA9PT0gbnVsbCB8fCB0eXBlb2YgbXV0YXRpb25Mb2cuYXBwZW5kICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLm11dGF0aW9uTG9nIG11c3QgYmUgYSBMb2NhbE11dGF0aW9uTG9nXCIpXG4gICAgfVxuICAgIGlmIChub3cgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygbm93ICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9mZmxpbmUubm93IG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgdGhlIHNlc3Npb24gY2xvY2tcIilcblxuICAgIHJldHVybiB7XG4gICAgICBiYWNrZW5kUHVibGljS2V5LFxuICAgICAgYm9vdHN0cmFwUGF0aDogKGJvb3RzdHJhcFBhdGggfHwgXCIvZnJvbnRlbmQtbW9kZWxzL3N5bmMvYm9vdHN0cmFwXCIpLnJlcGxhY2UoL1xcLyskL3UsIFwiXCIpIHx8IFwiL1wiLFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRldmljZUlkZW50aXR5U3RvcmFnZSxcbiAgICAgIGVucm9sbERldmljZSxcbiAgICAgIGdyYW50U2NvcGVzLFxuICAgICAgZ3JhbnRTdG9yYWdlLFxuICAgICAgbXV0YXRpb25Mb2csXG4gICAgICBub3c6IG5vdyB8fCAoKCkgPT4gbmV3IERhdGUoKSksXG4gICAgICByZXBsYXlQYXRoOiAocmVwbGF5UGF0aCB8fCBcIi9mcm9udGVuZC1tb2RlbHMvc3luYy9yZXBsYXlcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIEFQSSBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gYXBpIC0gU3luYyBBUEkgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHN5bmMgQVBJIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSB7XG4gICAgaWYgKGFwaSA9PT0gdW5kZWZpbmVkIHx8IGFwaSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgaWYgKHR5cGVvZiBhcGkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhcGkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmFwaSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGEgcmVzb3VyY2VDbGFzc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9ID0gYXBpXG5cbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzIG11c3QgYmUgYSByZXNvdXJjZSBjbGFzcywgZ290OiAke1N0cmluZyhyZXNvdXJjZUNsYXNzKX1gKVxuICAgIH1cbiAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzICR7cmVzb3VyY2VDbGFzcy5uYW1lfSBtdXN0IGRlZmluZSBzdGF0aWMgTW9kZWxDbGFzc2ApXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlPn0gLSBUaGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2UpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgIGlmICghdGhpcy5kYXRhYmFzZVt0aGlzLmdldEVudmlyb25tZW50KCldKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gZm9yIGVudmlyb25tZW50OiAke3RoaXMuZ2V0RW52aXJvbm1lbnQoKX0gLSAke09iamVjdC5rZXlzKHRoaXMuZGF0YWJhc2UpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YWJhc2VcIiwgdGhpcy5nZXRFbnZpcm9ubWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgdGhlIGlkZW50aWZpZXIuXG4gICAqL1xuICByZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIsIHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpKSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVtpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBkYXRhYmFzZSBpZGVudGlmaWVyIGNvbmZpZ3VyZWQ6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGlmICh0ZW5hbnQgPT09IHVuZGVmaW5lZCB8fCAhdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcikge1xuICAgICAgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuICAgIH1cblxuICAgIGNvbnN0IG92ZXJyaWRlQ29uZmlndXJhdGlvbiA9IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgIGlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuXG4gICAgcmV0dXJuIG1lcmdlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3ZlcnJpZGVDb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpc2FibGVkIGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRGlzYWJsZWQgZGF0YWJhc2UgaWRlbnRpZmllcnMgZnJvbSBlbnYgZmxhZ3MuXG4gICAqL1xuICBnZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVycyA9IG5ldyBTZXQoKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnNSYXcgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRElTQUJMRURfREFUQUJBU0VfSURFTlRJRklFUlNcblxuICAgIGlmIChkaXNhYmxlZElkZW50aWZpZXJzUmF3KSB7XG4gICAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGlzYWJsZWRJZGVudGlmaWVyc1Jhdy5zcGxpdChcIixcIikpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGlkZW50aWZpZXIudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIGRpc2FibGVkSWRlbnRpZmllcnMuYWRkKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHByb2Nlc3MuZW52LlZFTE9DSU9VU19ESVNBQkxFX01TU1FMID09PSBcIjFcIikge1xuICAgICAgZGlzYWJsZWRJZGVudGlmaWVycy5hZGQoXCJtc3NxbFwiKVxuICAgIH1cblxuICAgIHJldHVybiBkaXNhYmxlZElkZW50aWZpZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBpZGVudGlmaWVyIGFjdGl2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGRhdGFiYXNlIGlkZW50aWZpZXIgaXMgYWN0aXZlIGluIHRoZSBjdXJyZW50IHRlbmFudCBjb250ZXh0LlxuICAgKi9cbiAgaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllciwgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KCkpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIGRhdGFiYXNlIGlkZW50aWZpZXIgY29uZmlndXJlZDogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkgcmV0dXJuIHRydWVcbiAgICBpZiAodGVuYW50ID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3Qgb3ZlcnJpZGVDb25maWd1cmF0aW9uID0gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgaWRlbnRpZmllcixcbiAgICAgIHRlbmFudFxuICAgIH0pXG5cbiAgICByZXR1cm4gQm9vbGVhbihvdmVycmlkZUNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyh0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnMgPSB0aGlzLmdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpXG5cbiAgICByZXR1cm4gaWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiAhZGlzYWJsZWRJZGVudGlmaWVycy5oYXMoaWRlbnRpZmllcikgJiYgdGhpcy5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBIdW1hbi1yZWFkYWJsZSBzZXJ2ZXIgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBhc3luYyBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGxvY2FsU25hcHNob3QgPSB0aGlzLmdldExvY2FsRGVidWdTbmFwc2hvdCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ubG9jYWxTbmFwc2hvdCxcbiAgICAgIGh0dHBTZXJ2ZXI6IGF3YWl0IHRoaXMuX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWwgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gSHVtYW4tcmVhZGFibGUgZGlhZ25vc3RpY3MgZm9yIHRoaXMgcHJvY2VzcyBvbmx5LlxuICAgKi9cbiAgZ2V0TG9jYWxEZWJ1Z1NuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBiYWNrZ3JvdW5kSm9iczogdGhpcy5fZGVidWdCYWNrZ3JvdW5kSm9ic1NuYXBzaG90KCksXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9kZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpLFxuICAgICAgZGF0YWJhc2U6IHRoaXMuX2RlYnVnRGF0YWJhc2VTbmFwc2hvdCgpLFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHNlcnZlcjogdGhpcy5fZGVidWdTZXJ2ZXJTbmFwc2hvdCgpLFxuICAgICAgd2Vic29ja2V0czogdGhpcy5fZGVidWdXZWJzb2NrZXRTbmFwc2hvdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgaHR0cCBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gSFRUUCBzZXJ2ZXIgd29ya2VyIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgYXN5bmMgX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KCkge1xuICAgIGNvbnN0IGh0dHBTZXJ2ZXIgPSAvKiogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90PzogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSlcblxuICAgIGlmICghaHR0cFNlcnZlcj8uZ2V0RGVidWdTbmFwc2hvdCkge1xuICAgICAgcmV0dXJuIHtjb25maWd1cmVkOiBCb29sZWFuKHRoaXMuaHR0cFNlcnZlciksIGFjdGl2ZTogZmFsc2V9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IGh0dHBTZXJ2ZXIuZ2V0RGVidWdTbmFwc2hvdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2VydmVyIHJ1bnRpbWUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdTZXJ2ZXJTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBub2RlUHJvY2VzcyA9IHR5cGVvZiBwcm9jZXNzID09PSBcInVuZGVmaW5lZFwiID8gdW5kZWZpbmVkIDogcHJvY2Vzc1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmdldEVudmlyb25tZW50KCksXG4gICAgICBtZW1vcnlVc2FnZTogbm9kZVByb2Nlc3MgPyBub2RlUHJvY2Vzcy5tZW1vcnlVc2FnZSgpIDogdW5kZWZpbmVkLFxuICAgICAgbm9kZVZlcnNpb246IG5vZGVQcm9jZXNzPy52ZXJzaW9ucz8ubm9kZSxcbiAgICAgIHBpZDogbm9kZVByb2Nlc3M/LnBpZCxcbiAgICAgIHBsYXRmb3JtOiBub2RlUHJvY2Vzcz8ucGxhdGZvcm0sXG4gICAgICB1cHRpbWVTZWNvbmRzOiBub2RlUHJvY2VzcyA/IG5vZGVQcm9jZXNzLnVwdGltZSgpIDogdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgY29uZmlndXJhdGlvbiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb25maWd1cmF0aW9uIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnQ29uZmlndXJhdGlvblNuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBhcGlNYW5pZmVzdDogdGhpcy5fYXBpTWFuaWZlc3RFbmFibGVkKCkgPyB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogdGhpcy5fYXBpTWFuaWZlc3QucGF0aCwgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuKX0gOiB7ZW5hYmxlZDogZmFsc2V9LFxuICAgICAgYXV0b2xvYWQ6IHRoaXMuZ2V0QXV0b2xvYWQoKSxcbiAgICAgIGRlYnVnOiB0aGlzLmRlYnVnID09PSB0cnVlLFxuICAgICAgZGVidWdFbmRwb2ludDogdGhpcy5fZGVidWdFbmRwb2ludFNuYXBzaG90KCksXG4gICAgICBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IHRoaXMuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCksXG4gICAgICBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50czogdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpLFxuICAgICAgaW5pdGlhbGl6ZWQ6IHRoaXMuX2lzSW5pdGlhbGl6ZWQsXG4gICAgICBtY3A6IHRoaXMuX21jcC5lbmFibGVkID8ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IHRoaXMuX21jcC5wYXRoLCB0b2tlbkNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fbWNwLnRva2VuKX0gOiB7ZW5hYmxlZDogZmFsc2V9LFxuICAgICAgbG9nZ2luZzoge1xuICAgICAgICBkZWJ1Z0xvd0xldmVsOiB0aGlzLl9sb2dnaW5nPy5kZWJ1Z0xvd0xldmVsID09PSB0cnVlLFxuICAgICAgICBvdXRwdXRzOiB0aGlzLl9sb2dnaW5nID8gT2JqZWN0LmtleXModGhpcy5fbG9nZ2luZykgOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGJhY2tncm91bmQgam9icyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBCYWNrZ3JvdW5kIGpvYiBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0JhY2tncm91bmRKb2JzU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fYmFja2dyb3VuZEpvYnMpLFxuICAgICAgc2NoZWR1bGVkQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBkYXRhYmFzZSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0RhdGFiYXNlU25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogRGF0YWJhc2UgcG9vbHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLkRhdGFiYXNlUG9vbERlYnVnU25hcHNob3Q+fSAqL1xuICAgIGNvbnN0IGRhdGFiYXNlUG9vbHMgPSB7fVxuICAgIGNvbnN0IGFjdGl2ZUlkZW50aWZpZXJzID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBhY3RpdmVJZGVudGlmaWVycykge1xuICAgICAgZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmdldERlYnVnU25hcHNob3QoKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhY3RpdmVJZGVudGlmaWVycyxcbiAgICAgIGRpc2FibGVkSWRlbnRpZmllcnM6IEFycmF5LmZyb20odGhpcy5nZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSksXG4gICAgICBpbml0aWFsaXplZFBvb2xzOiBPYmplY3Qua2V5cyh0aGlzLmRhdGFiYXNlUG9vbHMpLFxuICAgICAgcG9vbHM6IGRhdGFiYXNlUG9vbHNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyB3ZWJzb2NrZXQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2ViU29ja2V0IGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnV2Vic29ja2V0U25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBidWNrZXRzLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y291bnQ6IG51bWJlciwgZGV0YWlsczoge2NoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogbnVtYmVyLCBjaGFubmVsU3Vic2NyaXB0aW9uczoge2NoYW5uZWxUeXBlOiBzdHJpbmcsIGNvdW50OiBudW1iZXIsIG1vZGVsOiBzdHJpbmcgfCBudWxsfVtdLCBjb25uZWN0aW9uQ291bnQ6IG51bWJlciwgcGF1c2VkOiBib29sZWFuLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfX0+fSAqL1xuICAgIGNvbnN0IHNlc3Npb25CdWNrZXRzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBkZXRhaWxzLlxuICAgICAqIEB0eXBlIHt7Y2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXIsIGNoYW5uZWxTdWJzY3JpcHRpb25zOiB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9W10sIGNvbm5lY3Rpb25Db3VudDogbnVtYmVyLCBwYXVzZWQ6IGJvb2xlYW4sIHF1ZXVlZE1lc3NhZ2VDb3VudDogbnVtYmVyLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IHNlc3Npb25EZXRhaWxzID0gW11cbiAgICBjb25zdCBzdWJzY3JpcHRpb25zID0gQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5lbnRyaWVzKCkpLm1hcCgoW2NoYW5uZWwsIGNoYW5uZWxTdWJzY3JpcHRpb25zXSkgPT4ge1xuICAgICAgLyoqXG4gICAgICAgKiBEZXRhaWxzIGJ1Y2tldHMuXG4gICAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2NvdW50OiBudW1iZXIsIGRldGFpbHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgICAgY29uc3QgZGV0YWlsc0J1Y2tldHMgPSBuZXcgTWFwKClcblxuICAgICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgY2hhbm5lbFN1YnNjcmlwdGlvbnMpIHtcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpKVxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShkZXRhaWxzKVxuICAgICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IGRldGFpbHNCdWNrZXRzLmdldChrZXkpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRldGFpbHNCdWNrZXRzLnNldChrZXksIHtjb3VudDogMSwgZGV0YWlsc30pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgY291bnQ6IGNoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGRldGFpbHM6IEFycmF5LmZyb20oZGV0YWlsc0J1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IHNlc3Npb24gb2YgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogQ2hhbm5lbCBzdWJzY3JpcHRpb24gYnVja2V0cy5cbiAgICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9Pn0gKi9cbiAgICAgIGNvbnN0IGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzID0gbmV3IE1hcCgpXG5cbiAgICAgIGZvciAoY29uc3Qge2NoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb259IG9mIHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICAgIGNvbnN0IGRldGFpbHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpXG4gICAgICAgIGNvbnN0IG1vZGVsID0gdHlwZW9mIGRldGFpbHMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBkZXRhaWxzLm1vZGVsIDogbnVsbFxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeSh7Y2hhbm5lbFR5cGUsIG1vZGVsfSlcbiAgICAgICAgY29uc3QgZXhpc3RpbmdCdWNrZXQgPSBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5nZXQoa2V5KVxuXG4gICAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5zZXQoa2V5LCB7Y2hhbm5lbFR5cGUsIGNvdW50OiAxLCBtb2RlbH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBBcnJheS5mcm9tKGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudClcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0ge1xuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNlc3Npb24uX2Nvbm5lY3Rpb25zLnNpemUsXG4gICAgICAgIHBhdXNlZDogc2Vzc2lvbi5fcGF1c2VkLFxuICAgICAgICBxdWV1ZWRNZXNzYWdlQ291bnQ6IHNlc3Npb24uX291dGJvdW5kUXVldWUubGVuZ3RoLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc2Vzc2lvbi5zdWJzY3JpcHRpb25zLnNpemVcbiAgICAgIH1cbiAgICAgIGNvbnN0IGJ1Y2tldEtleSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zOiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgY29ubmVjdGlvbkNvdW50OiBzbmFwc2hvdC5jb25uZWN0aW9uQ291bnQsXG4gICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc25hcHNob3Quc3Vic2NyaXB0aW9uQ291bnRcbiAgICAgIH0pXG4gICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IHNlc3Npb25CdWNrZXRzLmdldChidWNrZXRLZXkpXG5cbiAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXNzaW9uQnVja2V0cy5zZXQoYnVja2V0S2V5LCB7XG4gICAgICAgICAgY291bnQ6IDEsXG4gICAgICAgICAgZGV0YWlsczoge1xuICAgICAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uczogc25hcHNob3QuY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNuYXBzaG90LmNvbm5lY3Rpb25Db3VudCxcbiAgICAgICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LnN1YnNjcmlwdGlvbkNvdW50XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgc2Vzc2lvbkRldGFpbHMucHVzaChzbmFwc2hvdClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgbGl2ZU9ubHlDaGFubmVsczogQXJyYXkuZnJvbSh0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzKSxcbiAgICAgIHBhdXNlZFNlc3Npb25zOiB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5zaXplLFxuICAgICAgcmVnaXN0ZXJlZENoYW5uZWxzOiBBcnJheS5mcm9tKHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzLmtleXMoKSksXG4gICAgICByZWdpc3RlcmVkQ29ubmVjdGlvbnM6IEFycmF5LmZyb20odGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMua2V5cygpKSxcbiAgICAgIHNlc3Npb25CdWNrZXRzOiBBcnJheS5mcm9tKHNlc3Npb25CdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudCksXG4gICAgICBzZXNzaW9uQ291bnQ6IHRoaXMuX3dlYnNvY2tldFNlc3Npb25zLnNpemUsXG4gICAgICBzZXNzaW9uczogc2Vzc2lvbkRldGFpbHMuc29ydCgoYSwgYikgPT4gYi5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQgLSBhLmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCksXG4gICAgICBzdWJzY3JpcHRpb25Hcm91cHM6IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICBzdWJzY3JpcHRpb25zXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGRhdGFiYXNlIHBvb2wuXG4gICAqL1xuICBnZXREYXRhYmFzZVBvb2woaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgaWYgKCF0aGlzLmlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoaWRlbnRpZmllcikpIHtcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZURhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuICAgIH1cblxuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YWJhc2VQb29sc1wiLCBpZGVudGlmaWVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZyYW1ld29yay1vd25lZCBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGxpZmVjeWNsZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlfSAtIExpZmVjeWNsZSBvd25lci5cbiAgICovXG4gIGdldEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlKCkgeyByZXR1cm4gdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhZmUgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGVbXCJpbnNwZWN0QWxsXCJdPn0gLSBMaWZlY3ljbGUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBpbnNwZWN0RnJvbnRlbmRUZW5hbnRTcWxpdGVIYW5kbGVzKCkgeyByZXR1cm4gdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUuaW5zcGVjdEFsbCgpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9KVxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGlkZW50aWZpZXIpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBzY2hlbWEgbWV0YWRhdGEgY2FjaGVkIGJ5IGV2ZXJ5IGluaXRpYWxpemVkIHBvb2wgdGhhdCB0YXJnZXRzIHRoZVxuICAgKiBzYW1lIHBoeXNpY2FsIGRhdGFiYXNlIChtYXRjaGVkIGJ5IGNvbm5lY3Rpb24gcmV1c2Uga2V5KS4gU2VwYXJhdGUgcG9vbHMgdGhhdFxuICAgKiBwb2ludCBhdCBvbmUgZGF0YWJhc2Uga2VlcCBpbmRlcGVuZGVudCBzY2hlbWEgY2FjaGVzLCBzbyBEREwgcnVuIHRocm91Z2ggb25lXG4gICAqIHBvb2wgd291bGQgb3RoZXJ3aXNlIGxlYXZlIHRoZSBvdGhlcnMgcmVwb3J0aW5nIHN0YWxlIHRhYmxlcy9jb2x1bW5zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBDb25uZWN0aW9uIHJldXNlIGtleSBpZGVudGlmeWluZyB0aGUgc2hhcmVkIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjbGVhclNjaGVtYUNhY2hlc0ZvclJldXNlS2V5KHJldXNlS2V5KSB7XG4gICAgdGhpcy5fc2NoZW1hQ2FjaGVHZW5lcmF0aW9uc0J5UmV1c2VLZXkuc2V0KFxuICAgICAgcmV1c2VLZXksXG4gICAgICB0aGlzLnNjaGVtYUNhY2hlR2VuZXJhdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KSArIDFcbiAgICApXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoKSA9PT0gcmV1c2VLZXkpIHtcbiAgICAgICAgcG9vbC5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3VycmVudCBzY2hlbWEtY2FjaGUgZ2VuZXJhdGlvbiBmb3Igb25lIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBDb25uZWN0aW9uIHJldXNlIGtleSBpZGVudGlmeWluZyB0aGUgc2hhcmVkIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEN1cnJlbnQgc2NoZW1hLWNhY2hlIGdlbmVyYXRpb24uXG4gICAqL1xuICBzY2hlbWFDYWNoZUdlbmVyYXRpb25Gb3JSZXVzZUtleShyZXVzZUtleSkge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb25zQnlSZXVzZUtleS5nZXQocmV1c2VLZXkpIHx8IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnZhbGlkYXRlcyByZWNvcmQgbWV0YWRhdGEgb3duZWQgYnkgb25lIGNsb3NlZC9kZWxldGVkIHBoeXNpY2FsIHRlbmFudFxuICAgKiBkYXRhYmFzZSB3aGlsZSBwcmVzZXJ2aW5nIGV2ZXJ5IG90aGVyIHRlbmFudCBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIExvZ2ljYWwgaWRlbnRpZmllciBwbHVzIHBvb2wgcmV1c2Uga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyUmVjb3JkTWV0YWRhdGFGb3JEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLm1vZGVsQ2xhc3NlcykpIHtcbiAgICAgIG1vZGVsQ2xhc3MuY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlc0ZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgcG9vbCB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZGF0YWJhc2UgcG9vbCB0eXBlLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VQb29sVHlwZShpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBjb25zdCBwb29sVHlwZUNsYXNzID0gZGlnZyh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKSwgXCJwb29sVHlwZVwiKVxuXG4gICAgaWYgKCFwb29sVHlwZUNsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBwb29sVHlwZSBnaXZlbiBpbiBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucmVzb2x2ZVRlc3RTaGFyZWRUcmFuc2FjdGlvblBvb2xUeXBlKHtcbiAgICAgIGNvbmZpZ3VyZWRQb29sVHlwZTogcG9vbFR5cGVDbGFzcyxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogaWRlbnRpZmllclxuICAgIH0pXG4gIH1cblxuICBnZXREYXRhYmFzZVR5cGUoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgY29uc3QgZGF0YWJhc2VUeXBlID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllcikudHlwZVxuXG4gICAgaWYgKCFkYXRhYmFzZVR5cGUpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIHR5cGUgZ2l2ZW4gaW4gZGF0YWJhc2UgY29uZmlndXJhdGlvblwiKVxuXG4gICAgcmV0dXJuIGRhdGFiYXNlVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGlyZWN0b3J5LlxuICAgKi9cbiAgZ2V0RGlyZWN0b3J5KCkge1xuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKVxuXG4gICAgaWYgKCFkaXJlY3RvcnkpIHRocm93IG5ldyBFcnJvcihcIk5vIGRpcmVjdG9yeSBjb25maWd1cmVkIGFuZCBwcm9jZXNzLmN3ZCBpcyB1bmF2YWlsYWJsZVwiKVxuXG4gICAgcmV0dXJuIGRpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpcmVjdG9yeSBpZiBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGRpcmVjdG9yeSB3aGVuIHRoZSBydW50aW1lIGNhbiByZXNvbHZlIG9uZS5cbiAgICovXG4gIGdldERpcmVjdG9yeUlmQXZhaWxhYmxlKCkge1xuICAgIGlmICghdGhpcy5fZGlyZWN0b3J5KSB7XG4gICAgICB0aGlzLl9kaXJlY3RvcnkgPSBjdXJyZW50V29ya2luZ0RpcmVjdG9yeSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJhY2tlbmQgcHJvamVjdHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119IC0gQmFja2VuZCBwcm9qZWN0cy5cbiAgICovXG4gIGdldEJhY2tlbmRQcm9qZWN0cygpIHsgcmV0dXJuIHRoaXMuX2JhY2tlbmRQcm9qZWN0cyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBhY2thZ2VzLlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzUGFja2FnZVtdfSAtIFJlZ2lzdGVyZWQgVmVsb2Npb3VzIHBhY2thZ2VzLlxuICAgKi9cbiAgZ2V0UGFja2FnZXMoKSB7IHJldHVybiB0aGlzLl9wYWNrYWdlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFiaWxpdHkgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICovXG4gIGdldEFiaWxpdHlSZXNvdXJjZXMoKSB7IHJldHVybiB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYWJpbGl0eSByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSByZXNvdXJjZXMgLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEFiaWxpdHlSZXNvdXJjZXMocmVzb3VyY2VzKSB7IHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSByZXNvdXJjZXMgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgcmVzb3VyY2UgY2xhc3NlcyBkaXNjb3ZlcmVkIGZyb20gdGhlIGFwcCBhbmQgZXZlcnkgcmVnaXN0ZXJlZCBwYWNrYWdlXG4gICAqIGludG8gdGhlIGFiaWxpdHktcmVzb3VyY2VzIGxpc3QuIGBhdXRvRGlzY292ZXJSZXNvdXJjZXNgIHBvcHVsYXRlcyBlYWNoIGJhY2tlbmRcbiAgICogcHJvamVjdCdzIGBmcm9udGVuZE1vZGVsc2AgKGluY2x1ZGluZyBwYWNrYWdlIHByb2plY3RzKSwgc28gdGhpcyBtYWtlcyBhXG4gICAqIHBhY2thZ2UtY29udHJpYnV0ZWQgbW9kZWwncyBhYmlsaXRpZXMgcmVhY2ggc3Vic2NyaXB0aW9uIGFuZCBwZXItcmVjb3JkXG4gICAqIGF1dGhvcml6YXRpb24gYXV0b21hdGljYWxseSDigJQgY29uc3VtaW5nIGFwcHMgZG8gbm90IGhhdmUgdG8gaGFuZC1yZWdpc3RlclxuICAgKiBwYWNrYWdlIHJlc291cmNlcy4gQWxyZWFkeS1wcmVzZW50IGNsYXNzZXMgKGUuZy4gYW4gYXBwJ3MgZXhwbGljaXRseS1zZXRcbiAgICogcmVzb3VyY2VzKSBhcmUgbGVmdCB1bnRvdWNoZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9tZXJnZURpc2NvdmVyZWRBYmlsaXR5UmVzb3VyY2VzKCkge1xuICAgIGNvbnN0IG1lcmdlZCA9IFsuLi50aGlzLl9hYmlsaXR5UmVzb3VyY2VzXVxuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0KG1lcmdlZClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5fYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBpZiAoIWJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3QgUmVzb3VyY2VDbGFzcyBvZiBiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzKSB7XG4gICAgICAgIGlmIChzZWVuLmhhcyhSZXNvdXJjZUNsYXNzKSkgY29udGludWVcblxuICAgICAgICBzZWVuLmFkZChSZXNvdXJjZUNsYXNzKVxuICAgICAgICBtZXJnZWQucHVzaChSZXNvdXJjZUNsYXNzKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSBtZXJnZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gQWJpbGl0eSByZXNvbHZlci5cbiAgICovXG4gIGdldEFiaWxpdHlSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX2FiaWxpdHlSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnRSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGVuYW50IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0VGVuYW50UmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl90ZW5hbnRSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3QgdGVuYW50IHBvb2wgY29uZmlndXJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVzdFRlbmFudFBvb2xzQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBPcHQtaW4gdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbHMga2V5ZWQgYnkgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldFRlc3RUZW5hbnRQb29scygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RUZW5hbnRQb29scyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHJlcXVpcmUgYSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpIHsgcmV0dXJuIHRoaXMuX2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGU+fSAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXJzLlxuICAgKi9cbiAgZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcnMoKSB7IHJldHVybiB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXIuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVyKGlkZW50aWZpZXIpIHtcbiAgICBjb25zdCBwcm92aWRlciA9IHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBjb25maWd1cmVkIGZvciBkYXRhYmFzZSBpZGVudGlmaWVyOiAke2lkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvdmlkZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbn0gLSBBdHRhY2htZW50cyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fYXR0YWNobWVudHMgfHwge30gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Sb3V0ZVJlc29sdmVySG9va1R5cGVbXX0gLSBSb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICovXG4gIGdldFJvdXRlUmVzb2x2ZXJIb29rcygpIHsgcmV0dXJuIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHJvdXRlIHJlc29sdmVyIGhvb2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJvdXRlUmVzb2x2ZXJIb29rVHlwZX0gaG9vayAtIFJvdXRlIHJlc29sdmVyIGhvb2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFkZFJvdXRlUmVzb2x2ZXJIb29rKGhvb2spIHtcbiAgICB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MucHVzaChob29rKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gQWJpbGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QWJpbGl0eVJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX2FiaWxpdHlSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnRSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gVGVuYW50IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUZW5hbnRSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl90ZW5hbnRSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBUZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVzdCB0ZW5hbnQgcG9vbCBjb25maWd1cmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVzdFRlbmFudFBvb2xzQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gcG9vbHMgLSBPcHQtaW4gdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlc3RUZW5hbnRQb29scyhwb29scykgeyB0aGlzLl90ZXN0VGVuYW50UG9vbHMgPSBwb29scyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyByZXF1aXJlIGEgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyhuZXdWYWx1ZSkgeyB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlPn0gcHJvdmlkZXJzIC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKHByb3ZpZGVycykgeyB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyA9IHByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBlbnZpcm9ubWVudC5cbiAgICovXG4gIGdldEVudmlyb25tZW50KCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcIl9lbnZpcm9ubWVudFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlcXVlc3QgdGltZW91dCBtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBSZXF1ZXN0IHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIGdldFJlcXVlc3RUaW1lb3V0TXMoKSB7XG4gICAgY29uc3QgZW52VGltZW91dCA9IHRoaXMuX3BhcnNlUmVxdWVzdFRpbWVvdXRTZWNvbmRzKHByb2Nlc3MuZW52LlZFTE9DSU9VU19SRVFVRVNUX1RJTUVPVVRfTVMpXG4gICAgY29uc3QgdmFsdWUgPSB0eXBlb2YgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMoKVxuICAgICAgOiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodHlwZW9mIGVudlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlRpbWVvdXQpKSByZXR1cm4gZW52VGltZW91dFxuXG4gICAgcmV0dXJuIDYwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSByZXF1ZXN0IHRpbWVvdXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHJhd1ZhbHVlIC0gRW52IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIF9wYXJzZVJlcXVlc3RUaW1lb3V0U2Vjb25kcyhyYXdWYWx1ZSkge1xuICAgIGlmIChyYXdWYWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB0cmltbWVkID0gcmF3VmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9eKFxcZCsoPzpcXC5cXGQrKT8pKG1zfHMpPyQvKVxuXG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcihtYXRjaFsxXSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKG51bWVyaWMpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB1bml0ID0gbWF0Y2hbMl1cblxuICAgIGlmICh1bml0ID09PSBcIm1zXCIpIHJldHVybiBudW1lcmljIC8gMTAwMFxuICAgIGlmICh1bml0ID09PSBcInNcIikgcmV0dXJuIG51bWVyaWNcblxuICAgIGlmICh0cmltbWVkLmluY2x1ZGVzKFwiLlwiKSkgcmV0dXJuIG51bWVyaWNcbiAgICBpZiAobnVtZXJpYyA+PSAxMDAwKSByZXR1cm4gbnVtZXJpYyAvIDEwMDBcblxuICAgIHJldHVybiBudW1lcmljXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZW52aXJvbm1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdFbnZpcm9ubWVudCAtIE5ldyBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0RW52aXJvbm1lbnQobmV3RW52aXJvbm1lbnQpIHsgdGhpcy5fZW52aXJvbm1lbnQgPSBuZXdFbnZpcm9ubWVudCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlZmF1bHRDb25zb2xlXSAtIFdoZXRoZXIgZGVmYXVsdCBjb25zb2xlLlxuICAgKiBAcmV0dXJucyB7UmVxdWlyZWQ8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiY29uc29sZVwiIHwgXCJmaWxlXCIgfCBcImxldmVsc1wiPj4gJiBQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJkaXJlY3RvcnlcIiB8IFwiZmlsZVBhdGhcIj4gJiBQYXJ0aWFsPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcIm91dHB1dHNcIiB8IFwibG9nZ2Vyc1wiPj59IC0gVGhlIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldExvZ2dpbmdDb25maWd1cmF0aW9uKHtkZWZhdWx0Q29uc29sZX0gPSB7fSkge1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gdGhpcy5nZXRFbnZpcm9ubWVudCgpXG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuX2xvZ2dpbmc/LmRpcmVjdG9yeSB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0RGVmYXVsdExvZ0RpcmVjdG9yeSh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLl9sb2dnaW5nPy5maWxlUGF0aCB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0TG9nRmlsZVBhdGgoe2NvbmZpZ3VyYXRpb246IHRoaXMsIGRpcmVjdG9yeSwgZW52aXJvbm1lbnR9KVxuICAgIGNvbnN0IGNvbnNvbGVPdmVycmlkZSA9IHRoaXMuX2xvZ2dpbmc/LmNvbnNvbGVcbiAgICBjb25zdCBoYXNMb2dnaW5nQ29uZmlnID0gQm9vbGVhbih0aGlzLl9sb2dnaW5nKVxuICAgIGNvbnN0IGZpbGVMb2dnaW5nID0gaGFzTG9nZ2luZ0NvbmZpZyA/ICh0aGlzLl9sb2dnaW5nPy5maWxlID8/IEJvb2xlYW4oZmlsZVBhdGgpKSA6IGZhbHNlXG4gICAgY29uc3QgY29uZmlndXJlZExldmVscyA9IHRoaXMuX2xvZ2dpbmc/LmxldmVsc1xuICAgIGNvbnN0IGluY2x1ZGVMb3dMZXZlbERlYnVnID0gdGhpcy5fbG9nZ2luZz8uZGVidWdMb3dMZXZlbCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGxvZ2dlcnMgPSB0aGlzLl9sb2dnaW5nPy5sb2dnZXJzXG5cbiAgICBjb25zdCBjb25zb2xlRGVmYXVsdCA9IGRlZmF1bHRDb25zb2xlICE9PSB1bmRlZmluZWQgPyBkZWZhdWx0Q29uc29sZSA6IHRydWVcbiAgICBjb25zdCBjb25zb2xlTG9nZ2luZyA9IGNvbnNvbGVPdmVycmlkZSAhPT0gdW5kZWZpbmVkID8gY29uc29sZU92ZXJyaWRlIDogY29uc29sZURlZmF1bHRcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgbGV2ZWxzLlxuICAgICAqIEB0eXBlIHtBcnJheTxcImRlYnVnLWxvdy1sZXZlbFwiIHwgXCJkZWJ1Z1wiIHwgXCJpbmZvXCIgfCBcIndhcm5cIiB8IFwiZXJyb3JcIj59ICovXG4gICAgY29uc3QgZGVmYXVsdExldmVscyA9IFtcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl1cblxuICAgIGlmIChpbmNsdWRlTG93TGV2ZWxEZWJ1ZykgZGVmYXVsdExldmVscy51bnNoaWZ0KFwiZGVidWctbG93LWxldmVsXCIpXG5cbiAgICBjb25zdCBsZXZlbHMgPSBjb25maWd1cmVkTGV2ZWxzIHx8IGRlZmF1bHRMZXZlbHNcblxuICAgIHJldHVybiB7XG4gICAgICBjb25zb2xlOiBjb25zb2xlTG9nZ2luZyxcbiAgICAgIGRpcmVjdG9yeSxcbiAgICAgIGZpbGU6IGZpbGVMb2dnaW5nID8/IGZhbHNlLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBsb2dnZXJzLFxuICAgICAgbGV2ZWxzLFxuICAgICAgb3V0cHV0czogdGhpcy5fbG9nZ2luZz8ub3V0cHV0c1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb25maWd1cmF0aW9uLW93bmVkIHN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICogQHJldHVybnMge0xvZ1JlZGFjdG9yfSAtIFN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICovXG4gIGdldExvZ1JlZGFjdG9yKCkge1xuICAgIHJldHVybiB0aGlzLl9sb2dSZWRhY3RvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5IGxvZ2dpbmcgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBxdWVyeSBsb2dnaW5nIGlzIGVuYWJsZWQuXG4gICAqL1xuICBnZXRRdWVyeUxvZ2dpbmdFbmFibGVkKCkge1xuICAgIGlmICh0aGlzLl9sb2dnaW5nPy5xdWVyeUxvZ2dpbmcgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2xvZ2dpbmcucXVlcnlMb2dnaW5nXG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudCgpICE9PSBcInRlc3RcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGdlbmVyYXRpb24gbGlmZWN5Y2xlIHZhbHVlcyBmcm9tIHRoZWlyIHJhdyBjb25maWcsIGVudmlyb25tZW50LFxuICAgKiBhbmQgQVBJIHNvdXJjZXMgYmVmb3JlIGFwcGx5aW5nIGRlZmF1bHRzLiBEZXJpdmVkIGRlZmF1bHRzIGFyZSBkZWxpYmVyYXRlbHlcbiAgICogYWJzZW50IGZyb20gdGhlIHNvdXJjZSBsaXN0LCBzbyBhbiBBUEkgcmVjb3Zlcnkgc3RhdGUgY2FuIG92ZXJyaWRlIGFuXG4gICAqIElELW9ubHkgY29uZmlndXJhdGlvbiB3aXRob3V0IGNyZWF0aW5nIGEgZmFsc2UgY29uZmxpY3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBFeHBsaWNpdCBBUEkgdmFsdWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlfSBbYXJncy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXSAtIEV4cGxpY2l0IGJvb3Qgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5saWZlY3ljbGVTb2NrZXRQYXRoXSAtIEV4cGxpY2l0IGxpZmVjeWNsZSBzb2NrZXQgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvdXJjZU5hbWVdIC0gSHVtYW4tcmVhZGFibGUgQVBJIG93bmVyLlxuICAgKiBAcmV0dXJucyB7e2dlbmVyYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgfCBcImFjdGl2ZVwiLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIFJlc29sdmVkIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgcmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7Z2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsIHNvdXJjZU5hbWUgPSBcImJhY2tncm91bmQgam9icyBBUElcIn0gPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLl9iYWNrZ3JvdW5kSm9icyB8fCB7fVxuICAgIGNvbnN0IGdlbmVyYXRpb25FbnZpcm9ubWVudCA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52IHx8IHt9XG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gcmVzb2x2ZUdlbmVyYXRpb25JZChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5nZW5lcmF0aW9uSWRcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImdlbmVyYXRpb25JZFwiKSAmJiBjb25maWd1cmVkLmdlbmVyYXRpb25JZCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5nZW5lcmF0aW9uSWR9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRFwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSUR9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGdlbmVyYXRpb25JZGAsIHByZXNlbnQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEdlbmVyYXRpb25JZH1cbiAgICBdKVxuICAgIGNvbnN0IGluaXRpYWxHZW5lcmF0aW9uU3RhdGUgPSByZXNvbHZlSW5pdGlhbEdlbmVyYXRpb25TdGF0ZShbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJpbml0aWFsR2VuZXJhdGlvblN0YXRlXCIpICYmIGNvbmZpZ3VyZWQuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5pbml0aWFsR2VuZXJhdGlvblN0YXRlfSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBpbml0aWFsR2VuZXJhdGlvblN0YXRlYCwgcHJlc2VudDogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGV9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuICAgIGNvbnN0IGxpZmVjeWNsZVNvY2tldFBhdGggPSByZXNvbHZlTGlmZWN5Y2xlU29ja2V0UGF0aChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5saWZlY3ljbGVTb2NrZXRQYXRoXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJsaWZlY3ljbGVTb2NrZXRQYXRoXCIpICYmIGNvbmZpZ3VyZWQubGlmZWN5Y2xlU29ja2V0UGF0aCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5saWZlY3ljbGVTb2NrZXRQYXRofSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBsaWZlY3ljbGVTb2NrZXRQYXRoYCwgcHJlc2VudDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGh9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuXG4gICAgcmV0dXJuIHtnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge09taXQ8UmVxdWlyZWQ8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbj4sIFwiYWRhcHRlclwiIHwgXCJyZXRlbnRpb25cIiB8IFwiZ2VuZXJhdGlvbklkXCIgfCBcImxpZmVjeWNsZVNvY2tldFBhdGhcIj4gJiB7Z2VuZXJhdGlvbklkPzogc3RyaW5nLCBsaWZlY3ljbGVTb2NrZXRQYXRoPzogc3RyaW5nLCByZXRlbnRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JzUmV0ZW50aW9uQ29uZmlndXJhdGlvbn19IC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBjb25zdCBwcm9jZXNzRW52aXJvbm1lbnQgPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudlxuICAgIGNvbnN0IGVudkhvc3QgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSE9TVFxuICAgIGNvbnN0IGVudlBvcnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVFxuICAgIGNvbnN0IGVudkRhdGFiYXNlSWRlbnRpZmllciA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19EQVRBQkFTRV9JREVOVElGSUVSXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19NQVhfQ09OQ1VSUkVOVF9GT1JLRURfSk9CU1xuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTUFYX0NPTkNVUlJFTlRfSU5MSU5FX0pPQlNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX0NPVU5UXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3lSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9DT05DVVJSRU5DWVxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfSk9CU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX1JTU19CWVRFU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfTElGRVRJTUVfTVNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfU0lMRU5DRV9USU1FT1VUX01TXG4gICAgY29uc3QgZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWJSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUlVOTkVSX01BWF9PTERfU1BBQ0VfU0laRV9NQlxuICAgIGNvbnN0IGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1JVTk5FUl9NQUxMT0NfQVJFTkFfTUFYXG4gICAgY29uc3QgZW52RGlzcGF0Y2hTdHJhdGVneSA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19ESVNQQVRDSF9TVFJBVEVHWVxuICAgIGNvbnN0IGVudlBvbGxJbnRlcnZhbFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT0xMX0lOVEVSVkFMX01TXG4gICAgY29uc3QgZW52Sm9iVGltZW91dFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19KT0JfVElNRU9VVF9NU1xuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9IGVudk1heENvbmN1cnJlbnRGb3JrZWRSYXcgPyBOdW1iZXIoZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50ID0gZW52TWF4Q29uY3VycmVudFJhdyA/IE51bWJlcihlbnZNYXhDb25jdXJyZW50UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvdW50ID0gZW52UG9vbGVkUnVubmVyQ291bnRSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyQ291bnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhKb2JzID0gZW52UG9vbGVkUnVubmVyTWF4Sm9ic1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID0gZW52UG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID0gZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWJSYXcgPyBOdW1iZXIoZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWJSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UnVubmVyTWFsbG9jQXJlbmFNYXggPSBlbnZSdW5uZXJNYWxsb2NBcmVuYU1heFJhdyA/IE51bWJlcihlbnZSdW5uZXJNYWxsb2NBcmVuYU1heFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb2xsSW50ZXJ2YWwgPSBlbnZQb2xsSW50ZXJ2YWxSYXcgPyBOdW1iZXIoZW52UG9sbEludGVydmFsUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudkpvYlRpbWVvdXQgPSBlbnZKb2JUaW1lb3V0UmF3ID8gTnVtYmVyKGVudkpvYlRpbWVvdXRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JhY2tncm91bmRKb2JzIHx8IHt9XG4gICAgY29uc3Qge2dlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aH0gPSB0aGlzLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoKVxuICAgIGNvbnN0IG1vZGUgPSBjb25maWd1cmVkLm1vZGUgPT09IHVuZGVmaW5lZCA/IFwiYmFja2dyb3VuZFwiIDogY29uZmlndXJlZC5tb2RlXG5cbiAgICBpZiAobW9kZSAhPT0gXCJiYWNrZ3JvdW5kXCIgJiYgbW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgYmFja2dyb3VuZEpvYnMubW9kZSBtdXN0IGJlIFwiYmFja2dyb3VuZFwiIG9yIFwiaW5saW5lXCIsIGdvdDogJHtTdHJpbmcobW9kZSl9YClcbiAgICB9XG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMxKVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IGNvbmZpZ3VyZWQuZGF0YWJhc2VJZGVudGlmaWVyIHx8IGVudkRhdGFiYXNlSWRlbnRpZmllciB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICAgIDogKHR5cGVvZiBlbnZNYXhDb25jdXJyZW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZNYXhDb25jdXJyZW50KSAmJiBlbnZNYXhDb25jdXJyZW50ID49IDEgPyBlbnZNYXhDb25jdXJyZW50IDogNClcbiAgICBjb25zdCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IHR5cGVvZiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgICA6ICh0eXBlb2YgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52TWF4Q29uY3VycmVudEZvcmtlZCkgJiYgZW52TWF4Q29uY3VycmVudEZvcmtlZCA+PSAxID8gZW52TWF4Q29uY3VycmVudEZvcmtlZCA6IDQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyQ291bnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50KSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50ID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudFxuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lckNvdW50XCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lckNvdW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgZW52UG9vbGVkUnVubmVyQ291bnQgPj0gMSA/IGVudlBvb2xlZFJ1bm5lckNvdW50IDogNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyQ29uY3VycmVuY3lcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+PSAxID8gZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgOiAxKVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heEpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhKb2JzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyTWF4Sm9icykgJiYgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4Sm9icyA6IDEwMClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcykgJiYgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzIDogNTEyICogMTAyNCAqIDEwMjQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIDogNjAgKiA2MCAqIDEwMDApXG4gICAgY29uc3QgcG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNc1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zKSAmJiBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID49IDEgPyBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zIDogMTIwMDAwKVxuICAgIC8vIFJ1bm5lciBjaGlsZHJlbiBnZXQgYSBoYXJkIFY4IGhlYXAgY2FwIGFuZCBhIGJvdW5kZWQgZ2xpYmMgYXJlbmEgY291bnRcbiAgICAvLyBzbyBvbmUgY2hpbGQgY2FuIG5ldmVyIGNvbW1pdCBtdWx0aXBsZSBHQnMgb2YgaGVhcCBvciB1bmJvdW5kZWRcbiAgICAvLyBhbGxvY2F0b3IgYXJlbmFzLiBUaGUgY2FwIHN0YXlzIGZhciBhYm92ZSBvYnNlcnZlZCBydW5uZXIgdXNhZ2U7IGFuXG4gICAgLy8gaW5oZXJpdGVkIE1BTExPQ19BUkVOQV9NQVggaXMgaG9ub3JlZCBiZWZvcmUgdGhlIGJ1aWx0LWluIGRlZmF1bHQuXG4gICAgY29uc3QgcnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPSB0eXBlb2YgY29uZmlndXJlZC5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYikgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iKSAmJiBjb25maWd1cmVkLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID49IDY0XG4gICAgICA/IGNvbmZpZ3VyZWQucnVubmVyTWF4T2xkU3BhY2VTaXplTWJcbiAgICAgIDogKCEoXCJydW5uZXJNYXhPbGRTcGFjZVNpemVNYlwiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIpICYmIE51bWJlci5pc0ludGVnZXIoZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIpICYmIGVudlJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID49IDY0ID8gZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIgOiAyMDQ4KVxuICAgIGNvbnN0IGluaGVyaXRlZE1hbGxvY0FyZW5hTWF4ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5NQUxMT0NfQVJFTkFfTUFYID8gTnVtYmVyKHByb2Nlc3NFbnZpcm9ubWVudC5NQUxMT0NfQVJFTkFfTUFYKSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHJ1bm5lck1hbGxvY0FyZW5hTWF4ID0gdHlwZW9mIGNvbmZpZ3VyZWQucnVubmVyTWFsbG9jQXJlbmFNYXggPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucnVubmVyTWFsbG9jQXJlbmFNYXgpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heCkgJiYgY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heCA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucnVubmVyTWFsbG9jQXJlbmFNYXhcbiAgICAgIDogKCEoXCJydW5uZXJNYWxsb2NBcmVuYU1heFwiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZSdW5uZXJNYWxsb2NBcmVuYU1heCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UnVubmVyTWFsbG9jQXJlbmFNYXgpICYmIE51bWJlci5pc0ludGVnZXIoZW52UnVubmVyTWFsbG9jQXJlbmFNYXgpICYmIGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4ID49IDFcbiAgICAgICAgPyBlbnZSdW5uZXJNYWxsb2NBcmVuYU1heFxuICAgICAgICA6ICh0eXBlb2YgaW5oZXJpdGVkTWFsbG9jQXJlbmFNYXggPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcihpbmhlcml0ZWRNYWxsb2NBcmVuYU1heCkgJiYgaW5oZXJpdGVkTWFsbG9jQXJlbmFNYXggPj0gMSA/IGluaGVyaXRlZE1hbGxvY0FyZW5hTWF4IDogNCkpXG4gICAgY29uc3QgZGlzcGF0Y2hTdHJhdGVneVJhdyA9IGNvbmZpZ3VyZWQuZGlzcGF0Y2hTdHJhdGVneSB8fCBlbnZEaXNwYXRjaFN0cmF0ZWd5XG4gICAgY29uc3QgZGlzcGF0Y2hTdHJhdGVneSA9IGRpc3BhdGNoU3RyYXRlZ3lSYXcgPT09IFwicG9sbGluZ1wiID8gXCJwb2xsaW5nXCIgOiBcImJlYWNvblwiXG4gICAgY29uc3QgcG9sbEludGVydmFsTXMgPSB0eXBlb2YgY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNc1xuICAgICAgOiAodHlwZW9mIGVudlBvbGxJbnRlcnZhbCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9sbEludGVydmFsKSAmJiBlbnZQb2xsSW50ZXJ2YWwgPj0gMSA/IGVudlBvbGxJbnRlcnZhbCA6IDEwMDApXG4gICAgY29uc3QgZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNcyA9IHR5cGVvZiBjb25maWd1cmVkLmRyYWluU3RvcmVPcGVyYXRpb25UaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zXG4gICAgICA6IDYwXzAwMFxuICAgIC8vIGBudWxsYCBpcyBhbiBleHBsaWNpdCBvcHQtb3V0IG9mIHRoZSBzY2hlZHVsZWQtZW5xdWV1ZSBib3VuZC4gQSBwcmVzZW50XG4gICAgLy8gYnV0IG5vbi1wb3NpdGl2ZSBudW1iZXIgaXMgYSBtaXN0YWtlLCBub3QgYW4gb3B0LW91dCwgc28gaXQgZmFsbHMgYmFjayB0b1xuICAgIC8vIHRoZSBmcmFtZXdvcmsgZGVmYXVsdCByYXRoZXIgdGhhbiBzaWxlbnRseSBkaXNhYmxpbmcgdGhlIHdhdGNoZG9nLlxuICAgIGNvbnN0IHNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMgPSBcInNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXNcIiBpbiBjb25maWd1cmVkXG4gICAgICA/IChcbiAgICAgICAgY29uZmlndXJlZC5zY2hlZHVsZWRFbnF1ZXVlVGltZW91dE1zID09PSBudWxsID9cbiAgICAgICAgICBudWxsXG4gICAgICAgIDogKFxuICAgICAgICAgIHR5cGVvZiBjb25maWd1cmVkLnNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5zY2hlZHVsZWRFbnF1ZXVlVGltZW91dE1zID4gMCA/XG4gICAgICAgICAgICBjb25maWd1cmVkLnNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXNcbiAgICAgICAgICA6IERFRkFVTFRfU0NIRURVTEVEX0VOUVVFVUVfVElNRU9VVF9NU1xuICAgICAgICApXG4gICAgICApXG4gICAgICA6IERFRkFVTFRfU0NIRURVTEVEX0VOUVVFVUVfVElNRU9VVF9NU1xuICAgIGNvbnN0IHF1ZXVlcyA9IGNvbmZpZ3VyZWQucXVldWVzICYmIHR5cGVvZiBjb25maWd1cmVkLnF1ZXVlcyA9PT0gXCJvYmplY3RcIiA/IGNvbmZpZ3VyZWQucXVldWVzIDoge31cbiAgICAvLyBBbiBleHBsaWNpdCBjb25maWcgdmFsdWUgd2lucyBvdmVyIHRoZSBlbnYgdmFyIOKAlCBpbmNsdWRpbmcgYG51bGxgL2AwYCxcbiAgICAvLyB3aGljaCBkaXNhYmxlIHRoZSBiYWNrc3RvcCBldmVuIHdoZW4gdGhlIGVudmlyb25tZW50IHNldHMgYSBkZWZhdWx0LlxuICAgIC8vIE9ubHkgZmFsbCB0aHJvdWdoIHRvIHRoZSBlbnYgdmFyIHdoZW4gY29uZmlnIG9taXRzIGBqb2JUaW1lb3V0TXNgIGVudGlyZWx5LlxuICAgIGNvbnN0IGpvYlRpbWVvdXRNcyA9IFwiam9iVGltZW91dE1zXCIgaW4gY29uZmlndXJlZFxuICAgICAgPyAodHlwZW9mIGNvbmZpZ3VyZWQuam9iVGltZW91dE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQuam9iVGltZW91dE1zID4gMCA/IGNvbmZpZ3VyZWQuam9iVGltZW91dE1zIDogbnVsbClcbiAgICAgIDogKHR5cGVvZiBlbnZKb2JUaW1lb3V0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZKb2JUaW1lb3V0KSAmJiBlbnZKb2JUaW1lb3V0ID4gMCA/IGVudkpvYlRpbWVvdXQgOiBudWxsKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRSZXRlbnRpb24gPSBjb25maWd1cmVkLnJldGVudGlvbiAmJiB0eXBlb2YgY29uZmlndXJlZC5yZXRlbnRpb24gPT09IFwib2JqZWN0XCIgPyBjb25maWd1cmVkLnJldGVudGlvbiA6IHt9XG4gICAgY29uc3QgcmV0ZW50aW9uID0ge1xuICAgICAgY29tcGxldGVkVHRsTXM6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zID09PSBcIm51bWJlclwiIHx8IGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXMgPT09IG51bGxcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zXG4gICAgICAgIDogNyAqIDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gICAgICBmYWlsZWRUdGxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uZmFpbGVkVHRsTXMgPT09IFwibnVtYmVyXCIgfHwgY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNcyA9PT0gbnVsbFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uZmFpbGVkVHRsTXNcbiAgICAgICAgOiAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gICAgICBiYXRjaFNpemU6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZSA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZSA+IDBcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZVxuICAgICAgICA6IDEwMDAsXG4gICAgICBzd2VlcEludGVydmFsTXM6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNcyA+IDBcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNc1xuICAgICAgICA6IDYwICogNjAgKiAxMDAwXG4gICAgfVxuXG4gICAgY29uc3Qgam9iQ2xhc3NlcyA9IHRoaXMuZ2V0QmFja2dyb3VuZEpvYkNsYXNzZXMoKVxuXG4gICAgcmV0dXJuIHtob3N0LCBwb3J0LCBkYXRhYmFzZUlkZW50aWZpZXIsIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzLCBtYXhDb25jdXJyZW50SW5saW5lSm9icywgbW9kZSwgcG9vbGVkUnVubmVyQ291bnQsIHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5LCBwb29sZWRSdW5uZXJNYXhKb2JzLCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcywgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcywgcG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcywgcnVubmVyTWF4T2xkU3BhY2VTaXplTWIsIHJ1bm5lck1hbGxvY0FyZW5hTWF4LCBkaXNwYXRjaFN0cmF0ZWd5LCBwb2xsSW50ZXJ2YWxNcywgZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNcywgc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNcywgcXVldWVzLCBqb2JDbGFzc2VzLCBqb2JUaW1lb3V0TXMsIHJldGVudGlvbiwgZ2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc3RhdGljYWxseSByZWdpc3RlcmVkIHBvcnRhYmxlIGJhY2tncm91bmQgam9icy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2xhc3NbXX0gLSBDb25maWd1cmVkIGpvYiBjbGFzc2VzLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYkNsYXNzZXMoKSB7XG4gICAgY29uc3Qgam9iQ2xhc3NlcyA9IHRoaXMuX2JhY2tncm91bmRKb2JzPy5qb2JDbGFzc2VzXG5cbiAgICBpZiAoam9iQ2xhc3NlcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoam9iQ2xhc3NlcykpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJiYWNrZ3JvdW5kSm9icy5qb2JDbGFzc2VzIG11c3QgYmUgYW4gYXJyYXlcIilcblxuICAgIHJldHVybiBbLi4uam9iQ2xhc3Nlc11cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbmQgbWVtb2l6ZXMgb25lIGJhY2tncm91bmQtam9icyBhZGFwdGVyIGZvciB0aGlzIGNvbmZpZ3VyYXRpb24gbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7QmFja2dyb3VuZEpvYnNBZGFwdGVyfSAtIEFjdGl2ZSBhZGFwdGVyLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uKSByZXR1cm4gdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbi5hZGFwdGVyXG5cbiAgICBjb25zdCBjb25maWd1cmVkQWRhcHRlciA9IHRoaXMuX2JhY2tncm91bmRKb2JzPy5hZGFwdGVyXG4gICAgY29uc3QgYWRhcHRlciA9IHR5cGVvZiBjb25maWd1cmVkQWRhcHRlciA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGNvbmZpZ3VyZWRBZGFwdGVyKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgIDogKGNvbmZpZ3VyZWRBZGFwdGVyIHx8IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuY3JlYXRlQmFja2dyb3VuZEpvYnNBZGFwdGVyKHtjb25maWd1cmF0aW9uOiB0aGlzfSkpXG5cbiAgICBpZiAoIShhZGFwdGVyIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYnNBZGFwdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmFkYXB0ZXIgbXVzdCBiZSBhIEJhY2tncm91bmRKb2JzQWRhcHRlciBpbnN0YW5jZSBvciBhIHN5bmNocm9ub3VzIGZhY3RvcnkgcmV0dXJuaW5nIG9uZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPSB7XG4gICAgICBhZGFwdGVyLFxuICAgICAgY2xvc2luZzogZmFsc2UsXG4gICAgICBjbG9zZVByb21pc2U6IHVuZGVmaW5lZCxcbiAgICAgIHJlYWR5UHJvbWlzZTogdW5kZWZpbmVkXG4gICAgfVxuICAgIHJldHVybiBhZGFwdGVyXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSBhY3F1aXJlcyB0aGUgZXhhY3QgcmVhZHkgYWRhcHRlciBmb3IgdGhlIGFjdGl2ZSBsaWZlY3ljbGUuXG4gICAqIEEgY2xvc2UgdGhhdCBjbGFpbXMgdGhlIGdlbmVyYXRpb24gd2hpbGUgcmVhZGluZXNzIGlzIHBlbmRpbmcgd2luczogdGhpc1xuICAgKiBvcGVyYXRpb24gd2FpdHMgZm9yIHRoYXQgY2xvc2UsIGNyZWF0ZXMgdGhlIG5leHQgZ2VuZXJhdGlvbiwgcmVhZGllcyBpdCxcbiAgICogYW5kIHJldHVybnMgb25seSB0aGF0IGxpdmUgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJhY2tncm91bmRKb2JzQWRhcHRlcj59IC0gRXhhY3QgcmVhZHkgYWRhcHRlciBnZW5lcmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBkYXRhYmFzZUNsb3NlUHJvbWlzZSA9IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcblxuICAgICAgaWYgKGRhdGFiYXNlQ2xvc2VQcm9taXNlKSB7XG4gICAgICAgIGF3YWl0IGRhdGFiYXNlQ2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRoaXMuZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG5cbiAgICAgIGlmICghZ2VuZXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGFkYXB0ZXIgZ2VuZXJhdGlvbiB3YXMgbm90IGNyZWF0ZWRcIilcblxuICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2luZykge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlYWR5UHJvbWlzZSA9IGdlbmVyYXRpb24ucmVhZHlQcm9taXNlIHx8IFByb21pc2UucmVzb2x2ZSgpLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLmFkYXB0ZXIuZW5zdXJlUmVhZHkoKVxuICAgICAgfSlcblxuICAgICAgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPSByZWFkeVByb21pc2VcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcmVhZHlQcm9taXNlXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPT09IHJlYWR5UHJvbWlzZSkgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2luZykge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uICE9PSBnZW5lcmF0aW9uKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4gZ2VuZXJhdGlvbi5hZGFwdGVyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRpZXMgdGhlIGFjdGl2ZSBhZGFwdGVyIG9uY2UgcGVyIGxpZmVjeWNsZS4gQSBmYWlsZWQgYXR0ZW1wdCByZW1haW5zIHJldHJ5YWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUJhY2tncm91bmRKb2JzQWRhcHRlclJlYWR5KCkge1xuICAgIGF3YWl0IHRoaXMuYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGhlYWx0aCB3aXRob3V0IHJlc29sdmluZyBwZXJzaXN0ZW5jZSBpbiBub24tZHVyYWJsZSBpbmxpbmUgbW9kZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNIZWFsdGg+fSAtIEN1cnJlbnQgaGVhbHRoLlxuICAgKi9cbiAgYXN5bmMgYmFja2dyb3VuZEpvYnNIZWFsdGgoKSB7XG4gICAgaWYgKHRoaXMuZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5tb2RlID09PSBcImlubGluZVwiKSByZXR1cm4ge3JlYWR5OiB0cnVlfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IGF3YWl0IHRoaXMuYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcblxuICAgIHJldHVybiBhd2FpdCBhZGFwdGVyLmhlYWx0aCgpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoZSByZXNvbHZlZCBhZGFwdGVyIG9uY2UgYW5kIGNsZWFycyBsaWZlY3ljbGUgY2FjaGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbG9zZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlQmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG5cbiAgICBpZiAoIWdlbmVyYXRpb24pIHJldHVyblxuICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG5cbiAgICBnZW5lcmF0aW9uLmNsb3NpbmcgPSB0cnVlXG4gICAgY29uc3QgY2xvc2VQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICAgIGNvbnN0IGNsb3NlRXJyb3JzID0gW11cblxuICAgICAgaWYgKGdlbmVyYXRpb24ucmVhZHlQcm9taXNlKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2VcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLmFkYXB0ZXIuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGNsb3NlRXJyb3JzWzBdXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGNsb3NlRXJyb3JzLCBcIkZhaWxlZCB0byByZWFkeSBhbmQgY2xvc2UgdGhlIGJhY2tncm91bmQtam9icyBhZGFwdGVyXCIpXG4gICAgfSkoKVxuXG4gICAgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UgPSBjbG9zZVByb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbG9zZVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPT09IGdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb259IGJhY2tncm91bmRKb2JzIC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZyhiYWNrZ3JvdW5kSm9icykge1xuICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uICYmIGJhY2tncm91bmRKb2JzLmFkYXB0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlcGxhY2UgYmFja2dyb3VuZEpvYnMuYWRhcHRlciBkdXJpbmcgYW4gYWN0aXZlIGFkYXB0ZXIgbGlmZWN5Y2xlOyBjbG9zZSBpdCBmaXJzdFwiKVxuICAgIH1cblxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmFja2dyb3VuZEpvYnMsIGJhY2tncm91bmRKb2JzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhY3RpdmUgQmVhY29uIGNvbmZpZ3VyYXRpb24uIEJlYWNvbiBpcyBvcHQtaW46IGl0XG4gICAqIHN0YXlzIGRpc2FibGVkIHVubGVzcyB0aGUgYXBwIHBhc3NlcyBgYmVhY29uOiB7aG9zdCwgcG9ydH1gIC9cbiAgICogYGJlYWNvbjoge2luUHJvY2VzczogdHJ1ZX1gLCBjYWxscyBgc2V0QmVhY29uQ29uZmlnKHsuLi59KWAsIG9yXG4gICAqIHNldHMgdGhlIGBWRUxPQ0lPVVNfQkVBQ09OX0hPU1RgIC8gYFZFTE9DSU9VU19CRUFDT05fUE9SVGAgZW52IHZhcnMuXG4gICAqIFNldHRpbmcgYGVuYWJsZWQ6IGZhbHNlYCBleHBsaWNpdGx5IGRpc2FibGVzIGl0IGV2ZW4gd2hlbiBlbnYgdmFyc1xuICAgKiBhcmUgcHJlc2VudCAodXNlZnVsIGZvciB0ZXN0cykuIFdoZW4gYGluUHJvY2VzczogdHJ1ZWAgaXMgc2V0LFxuICAgKiBlbnYtdmFyIGhvc3QvcG9ydCBhcmUgaWdub3JlZCDigJQgY29kZS1sZXZlbCBjb25maWcgd2lucy5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBob3N0OiBzdHJpbmcsIHBvcnQ6IG51bWJlciwgcGVlclR5cGU/OiBzdHJpbmcsIGluUHJvY2VzczogYm9vbGVhbiwgdW5yZWFjaGFibGVSZXBvcnRNczogbnVtYmVyfX0gLSBCZWFjb24gY29uZmlndXJhdGlvbiB3aXRoIGRlZmF1bHRzIGFwcGxpZWQuXG4gICAqL1xuICBnZXRCZWFjb25Db25maWcoKSB7XG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JlYWNvbiB8fCB7fVxuICAgIGNvbnN0IGluUHJvY2VzcyA9IGNvbmZpZ3VyZWQuaW5Qcm9jZXNzID09PSB0cnVlXG5cbiAgICBpZiAoaW5Qcm9jZXNzICYmIChjb25maWd1cmVkLmhvc3QgfHwgdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJlYWNvbiBjb25maWd1cmF0aW9uOiBgaW5Qcm9jZXNzOiB0cnVlYCBpcyBtdXR1YWxseSBleGNsdXNpdmUgd2l0aCBgaG9zdGAvYHBvcnRgLiBVc2Ugb25lIG9yIHRoZSBvdGhlci5cIilcbiAgICB9XG5cbiAgICBjb25zdCBlbnZIb3N0ID0gaW5Qcm9jZXNzID8gdW5kZWZpbmVkIDogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JFQUNPTl9IT1NUXG4gICAgY29uc3QgZW52UG9ydFJhdyA9IGluUHJvY2VzcyA/IHVuZGVmaW5lZCA6IHByb2Nlc3MuZW52LlZFTE9DSU9VU19CRUFDT05fUE9SVFxuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMwKVxuXG4gICAgbGV0IGVuYWJsZWRcblxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZC5lbmFibGVkID09PSBcImJvb2xlYW5cIikge1xuICAgICAgZW5hYmxlZCA9IGNvbmZpZ3VyZWQuZW5hYmxlZFxuICAgIH0gZWxzZSB7XG4gICAgICBlbmFibGVkID0gQm9vbGVhbihpblByb2Nlc3MgfHwgY29uZmlndXJlZC5ob3N0IHx8IGNvbmZpZ3VyZWQucG9ydCB8fCBlbnZIb3N0IHx8IGVudlBvcnQpXG4gICAgfVxuXG4gICAgY29uc3QgdW5yZWFjaGFibGVSZXBvcnRNcyA9IHJlc29sdmVCZWFjb25VbnJlYWNoYWJsZVJlcG9ydE1zKGNvbmZpZ3VyZWQudW5yZWFjaGFibGVSZXBvcnRNcylcblxuICAgIHJldHVybiB7ZW5hYmxlZCwgaG9zdCwgcG9ydCwgcGVlclR5cGU6IGNvbmZpZ3VyZWQucGVlclR5cGUsIGluUHJvY2VzcywgdW5yZWFjaGFibGVSZXBvcnRNc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBiZWFjb24gY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CZWFjb25Db25maWd1cmF0aW9ufSBiZWFjb24gLSBCZWFjb24gY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEJlYWNvbkNvbmZpZyhiZWFjb24pIHtcbiAgICB0aGlzLl9iZWFjb24gPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iZWFjb24sIGJlYWNvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBiZWFjb24gY2xpZW50LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSBhY3RpdmUgQmVhY29uIGNsaWVudCwgaWYgY29ubmVjdGVkLlxuICAgKi9cbiAgZ2V0QmVhY29uQ2xpZW50KCkge1xuICAgIHJldHVybiB0aGlzLl9iZWFjb25DbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0aGlzIGNvbmZpZ3VyYXRpb24ncyBCZWFjb24gY2xpZW50IHRvIHRoZSBjb25maWd1cmVkXG4gICAqIGJyb2tlciwgd2lyaW5nIGluY29taW5nIGJyb2FkY2FzdHMgdG8gdGhlIGxvY2FsIGRlbGl2ZXJ5IHBhdGggc29cbiAgICogYW55IHdlYnNvY2tldCBzdWJzY3JpYmVycyBpbiB0aGlzIHByb2Nlc3MgcmVjZWl2ZSB0aGVtLiBJZGVtcG90ZW50XG4gICAqIOKAlCByZXBlYXQgY2FsbHMgcmV0dXJuIHRoZSBzYW1lIGluLWZsaWdodCBvciByZXNvbHZlZCBwcm9taXNlLlxuICAgKlxuICAgKiBSZXR1cm5zIGltbWVkaWF0ZWx5IHdpdGggYHVuZGVmaW5lZGAgaWYgQmVhY29uIGlzIG5vdCBlbmFibGVkLlxuICAgKlxuICAgKiAqKk5vbi1ibG9ja2luZyBieSBkZXNpZ24gKFRDUCBtb2RlKS4qKiBGb3IgYnJva2VyLWJhY2tlZCBCZWFjb24sIHRoZVxuICAgKiByZXR1cm5lZCBwcm9taXNlIHJlc29sdmVzIGFzIHNvb24gYXMgdGhlIGNsaWVudCBpcyBjb25zdHJ1Y3RlZCBhbmRcbiAgICogdGhlIFRDUCBjb25uZWN0IGlzIGxhdW5jaGVkIOKAlCBpdCBkb2VzICoqbm90Kiogd2FpdCBmb3IgdGhlIGNvbm5lY3RcbiAgICogaGFuZHNoYWtlIHRvIGNvbXBsZXRlLiBBIGJyb2tlciB0aGF0IHNpbGVudGx5IGRyb3BzIFNZTnNcbiAgICogKGZpcmV3YWxsL05BQ0wgRFJPUCBydWxlcykgd291bGQgb3RoZXJ3aXNlIGJsb2NrIHN0YXJ0dXAgb24gdGhlIE9TXG4gICAqIFRDUCBjb25uZWN0IHRpbWVvdXQgKHRlbnMgb2Ygc2Vjb25kcyksIHdoaWNoIGNvbnRyYWRpY3RzIHRoZVxuICAgKiBkb2N1bWVudGVkIFwiZmFsbCBiYWNrIHRvIGxvY2FsLW9ubHkgYW5kIHJlY29ubmVjdCBpbiB0aGVcbiAgICogYmFja2dyb3VuZFwiIGNvbnRyYWN0LiBJbml0aWFsLWNvbm5lY3QgZmFpbHVyZXMgc3VyZmFjZVxuICAgKiBhc3luY2hyb25vdXNseSBvbiB0aGUgZnJhbWV3b3JrLWVycm9yIGNoYW5uZWwgdmlhIHRoZVxuICAgKiBgY29ubmVjdC1lcnJvcmAgbGlzdGVuZXIgcmVnaXN0ZXJlZCBoZXJlLiBDYWxsZXJzIHRoYXQgbmVlZCBhXG4gICAqIGRldGVybWluaXN0aWMgcHVibGlzaC1yZWFkaW5lc3MgYm91bmRhcnkgc2hvdWxkIGNhbGxcbiAgICogYGdldEJlYWNvbkNsaWVudCgpPy53YWl0Rm9yUmVhZHkoe3RpbWVvdXRNc30pYC5cbiAgICpcbiAgICogKipJbi1wcm9jZXNzIG1vZGUqKiBhd2FpdHMgYGNvbm5lY3QoKWAg4oCUIHRoYXQgcGF0aCBpcyBzeW5jaHJvbm91cyxcbiAgICogY2Fubm90IGZhaWwsIGFuZCBnaXZlcyBjYWxsZXJzIHByZWRpY3RhYmxlIHJlYWRpbmVzcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBPdmVycmlkZSBwZWVyVHlwZSBmb3IgdGhpcyBjb25uZWN0IGNhbGwgKGUuZy4gYFwic2VydmVyXCJgLCBgXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJgKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZWdpc3RlcmVkIGNsaWVudCAoVENQIG1vZGU6IGNvbm5lY3QgbWF5IHN0aWxsIGJlIGluIGZsaWdodCksIG9yIHVuZGVmaW5lZCB3aGVuIEJlYWNvbiBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGFzeW5jIGNvbm5lY3RCZWFjb24oe3BlZXJUeXBlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCkgcmV0dXJuIHRoaXMuX2JlYWNvbkNsaWVudFxuICAgIGlmICh0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlXG5cbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldEJlYWNvbkNvbmZpZygpXG5cbiAgICBpZiAoIWNvbmZpZy5lbmFibGVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjbGllbnQgPSBhd2FpdCB0aGlzLl9jcmVhdGVCZWFjb25DbGllbnQoe1xuICAgICAgICBjb25maWcsXG4gICAgICAgIHBlZXJUeXBlOiBwZWVyVHlwZSB8fCBjb25maWcucGVlclR5cGVcbiAgICAgIH0pXG5cbiAgICAgIGNsaWVudC5vbkJyb2FkY2FzdCgobWVzc2FnZSkgPT4ge1xuICAgICAgICAvLyBTeW5hcHNlLXN0eWxlIGZhbi1vdXQ6IGRlbGl2ZXIgZXZlcnkgYnJvYWRjYXN0IHdlIHJlY2VpdmVcbiAgICAgICAgLy8gZnJvbSB0aGUgYnVzIHRocm91Z2ggdGhlIGxvY2FsIGRlbGl2ZXJ5IHBhdGguIEVjaG9lcyBvZiBvdXJcbiAgICAgICAgLy8gb3duIHB1Ymxpc2hlcyBmb2xsb3cgdGhlIHNhbWUgcGF0aCBzbyBldmVyeSBwZWVyIHNlZXMgdGhlXG4gICAgICAgIC8vIHNhbWUgZGVsaXZlcnkgc2VtYW50aWNzLlxuICAgICAgICB0aGlzLl9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbihtZXNzYWdlKVxuICAgICAgfSlcblxuICAgICAgLy8gQmVhY29uIGNvbm5lY3QvZGlzY29ubmVjdCBibGlwcyBhcmUgZXhwZWN0ZWQgZHVyaW5nIGRlcGxveXMgKHRoZSBicm9rZXJcbiAgICAgIC8vIHJlc3RhcnRzKSBhbmQgdGhlIEJlYWNvbkNsaWVudCBhdXRvLXJlY29ubmVjdHMgaW4gdGhlIGJhY2tncm91bmQsIHNvIGFcbiAgICAgIC8vIHNpbmdsZSB0cmFuc2llbnQgZmFpbHVyZSBpcyBOT1QgcmVwb3J0ZWQuIE9ubHkgYSBzdXN0YWluZWQgb3V0YWdlIChzdGlsbFxuICAgICAgLy8gZG93biBhZnRlciBgdW5yZWFjaGFibGVSZXBvcnRNc2ApIGlzIHN1cmZhY2VkIG9uIHRoZSBmcmFtZXdvcmstZXJyb3JcbiAgICAgIC8vIGNoYW5uZWw7IGEgKHJlKWNvbm5lY3Qgd2l0aGluIHRoZSBncmFjZSB3aW5kb3cgY2xlYXJzIGl0IHNpbGVudGx5LlxuXG4gICAgICAvLyBgY29ubmVjdC1lcnJvcmAgZmlyZXMgd2hlbiB0aGUgKmluaXRpYWwqIFRDUC9oYW5kc2hha2UgZmFpbHMuXG4gICAgICBjbGllbnQub24oXCJjb25uZWN0LWVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZTogXCJiZWFjb24tY29ubmVjdFwiLCBlcnJvciwgcmVwb3J0QWZ0ZXJNczogY29uZmlnLnVucmVhY2hhYmxlUmVwb3J0TXN9KVxuICAgICAgfSlcblxuICAgICAgLy8gYGRpc2Nvbm5lY3RgIGZpcmVzIHdoZW4gYW4gZXN0YWJsaXNoZWQgY29ubmVjdGlvbiBkcm9wcy4gVGhlIHBheWxvYWQgaXNcbiAgICAgIC8vIHRoZSB1bmRlcmx5aW5nIHNvY2tldCBlcnJvciBpZiB0aGVyZSB3YXMgb25lLCBvciBhIHN5bnRoZXRpY1xuICAgICAgLy8gRXJyb3IoXCJCZWFjb24gYnJva2VyIGRpc2Nvbm5lY3RlZFwiKSBvdGhlcndpc2UuXG4gICAgICBjbGllbnQub24oXCJkaXNjb25uZWN0XCIsIChyZWFzb24pID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uRG93bih7c3RhZ2U6IFwiYmVhY29uLWRpc2Nvbm5lY3RcIiwgZXJyb3I6IHJlYXNvbiwgcmVwb3J0QWZ0ZXJNczogY29uZmlnLnVucmVhY2hhYmxlUmVwb3J0TXN9KVxuICAgICAgfSlcblxuICAgICAgLy8gYGNvbm5lY3RgIGZpcmVzIG9uIGV2ZXJ5IChyZSljb25uZWN0OyBjbGVhciBhbnkgcGVuZGluZyBvdXRhZ2Ugc3RhdGUgc29cbiAgICAgIC8vIGEgdHJhbnNpZW50IGJsaXAgdGhhdCByZWNvdmVycyB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyBzdGF5cyBzaWxlbnQuXG4gICAgICBjbGllbnQub24oXCJjb25uZWN0XCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uVXAoKVxuICAgICAgfSlcblxuICAgICAgLy8gUmVnaXN0ZXIgdGhlIGNsaWVudCAqYmVmb3JlKiBraWNraW5nIG9mZiBjb25uZWN0IHNvIHN1YnNlcXVlbnRcbiAgICAgIC8vIGBjb25uZWN0QmVhY29uKClgIGNhbGxzIHJldHVybiB0aGlzIHNhbWUgaW5zdGFuY2UgaW5zdGVhZCBvZlxuICAgICAgLy8gcmFjaW5nIHRvIGNvbnN0cnVjdCBhIHNlY29uZCBvbmUuXG4gICAgICB0aGlzLl9iZWFjb25DbGllbnQgPSBjbGllbnRcblxuICAgICAgaWYgKGNvbmZpZy5pblByb2Nlc3MpIHtcbiAgICAgICAgLy8gSW4tcHJvY2VzcyBjb25uZWN0IGlzIHN5bmNocm9ub3VzLCBjYW5ub3QgZmFpbCwgYW5kIHJlc29sdmVzXG4gICAgICAgIC8vIGJlZm9yZSB0aGlzIGF3YWl0IHlpZWxkcyDigJQgY2FsbGVycyBjYW4gcmVseSBvblxuICAgICAgICAvLyBgaXNDb25uZWN0ZWQoKSA9PT0gdHJ1ZWAgaW1tZWRpYXRlbHkgYWZ0ZXIgYGNvbm5lY3RCZWFjb24oKWAuXG4gICAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEZpcmUtYW5kLWZvcmdldCB0aGUgVENQIGNvbm5lY3QuIEF3YWl0aW5nIGhlcmUgd291bGQgYmxvY2tcbiAgICAgICAgLy8gc3RhcnR1cCBvbiB0aGUgT1MgVENQIGNvbm5lY3QgdGltZW91dCAoNzVzIGRlZmF1bHQgb24gTGludXgpXG4gICAgICAgIC8vIHdoZW4gdGhlIGJyb2tlciBzaWxlbnRseSBkcm9wcyBTWU5zLiBGYWlsdXJlcyBzdXJmYWNlXG4gICAgICAgIC8vIGFzeW5jaHJvbm91c2x5IHZpYSB0aGUgYGNvbm5lY3QtZXJyb3JgIGxpc3RlbmVyIHJlZ2lzdGVyZWRcbiAgICAgICAgLy8gYWJvdmU7IHRoZSBCZWFjb25DbGllbnQncyByZWNvbm5lY3QgbG9vcCBrZWVwcyB0cnlpbmcuXG4gICAgICAgIHZvaWQgY2xpZW50LmNvbm5lY3QoKS5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gQWxyZWFkeSByZXBvcnRlZCB2aWEgY29ubmVjdC1lcnJvciBhYm92ZS5cbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNsaWVudFxuICAgIH0pKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIEJlYWNvbiBjbGllbnQgbWF0Y2hpbmcgdGhlIGNvbmZpZ3VyZWQgbW9kZS4gU3BsaXQgb3V0IHNvXG4gICAqIGBjb25uZWN0QmVhY29uYCBzdGF5cyBmb2N1c2VkIG9uIGxpZmVjeWNsZSBhbmQgZXJyb3Igd2lyaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTxWZWxvY2lvdXNDb25maWd1cmF0aW9uW1wiZ2V0QmVhY29uQ29uZmlnXCJdPn0gYXJncy5jb25maWcgLSBSZXNvbHZlZCBCZWFjb24gY29uZmlnLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucGVlclR5cGVdIC0gUmVzb2x2ZWQgcGVlciB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEJlYWNvbiBjbGllbnQuXG4gICAqL1xuICBhc3luYyBfY3JlYXRlQmVhY29uQ2xpZW50KHtjb25maWcsIHBlZXJUeXBlfSkge1xuICAgIC8vIFJvdXRlIHRocm91Z2ggdGhlIGVudmlyb25tZW50IGhhbmRsZXIgc28gdGhlIE5vZGUtb25seSBgbm9kZTpuZXRgXG4gICAgLy8gLyBgbm9kZTpjcnlwdG9gIGRlcHMgaW4gdGhlIEJlYWNvbiBjbGllbnQgbW9kdWxlcyBkb24ndCBnZXQgcHVsbGVkXG4gICAgLy8gaW50byBicm93c2VyIGJ1bmRsZXMuIEJyb3dzZXIgYnVuZGxlcyBzdGF0aWNhbGx5IHJlYWNoXG4gICAgLy8gYENvbmZpZ3VyYXRpb25gICh2aWEgYExvZ2dlcmApOyBwdXR0aW5nIHRoZSBkeW5hbWljXG4gICAgLy8gYGltcG9ydChcIi4vYmVhY29uLy4uLlwiKWAgY2FsbHMgaGVyZSB3b3VsZCBzdGlsbCBkcmFnIHRob3NlIG1vZHVsZXNcbiAgICAvLyB0aHJvdWdoIGVzYnVpbGQncyBzdGF0aWMgYW5hbHlzaXMuIEhpZGluZyB0aGUgaW1wb3J0cyBpbnNpZGUgdGhlXG4gICAgLy8gTm9kZSBlbnZpcm9ubWVudCBoYW5kbGVyIGtlZXBzIHRoZW0gb2ZmIHRoZSBicm93c2VyIHBhdGgg4oCUXG4gICAgLy8gYnJvd3Nlci1idW5kbGVkIGFwcHMgbmV2ZXIgcmVhY2ggYGVudmlyb25tZW50LWhhbmRsZXJzL25vZGUuanNgLlxuICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAoY29uZmlnLmluUHJvY2Vzcykge1xuICAgICAgY29uc3QgSW5Qcm9jZXNzQmVhY29uQ2xpZW50ID0gYXdhaXQgaGFuZGxlci5sb2FkSW5Qcm9jZXNzQmVhY29uQ2xpZW50KClcblxuICAgICAgcmV0dXJuIG5ldyBJblByb2Nlc3NCZWFjb25DbGllbnQoe3BlZXJUeXBlfSlcbiAgICB9XG5cbiAgICBjb25zdCBCZWFjb25DbGllbnQgPSBhd2FpdCBoYW5kbGVyLmxvYWRCZWFjb25DbGllbnQoKVxuXG4gICAgcmV0dXJuIG5ldyBCZWFjb25DbGllbnQoe1xuICAgICAgaG9zdDogY29uZmlnLmhvc3QsXG4gICAgICBwb3J0OiBjb25maWcucG9ydCxcbiAgICAgIHBlZXJUeXBlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgQmVhY29uIGNvbm5lY3QvZGlzY29ubmVjdCBmYWlsdXJlIHdpdGhvdXQgcmVwb3J0aW5nIGl0IGltbWVkaWF0ZWx5LlxuICAgKiBUaGUgQmVhY29uQ2xpZW50IGF1dG8tcmVjb25uZWN0cywgc28gYnJpZWYgb3V0YWdlcyAoZS5nLiBhIGRlcGxveSByZXN0YXJ0aW5nXG4gICAqIHRoZSBicm9rZXIpIGFyZSBleHBlY3RlZDsgb25seSBpZiB0aGUgYmVhY29uIGlzIHN0aWxsIHVucmVhY2hhYmxlIGFmdGVyXG4gICAqIGByZXBvcnRBZnRlck1zYCBpcyBhIHNpbmdsZSBmcmFtZXdvcmstZXJyb3Igc3VyZmFjZWQgdmlhIGBfcmVwb3J0QmVhY29uRXJyb3JgLlxuICAgKiBBIHN1YnNlcXVlbnQgYGNvbm5lY3RgIChzZWUgYF9oYW5kbGVCZWFjb25VcGApIGNhbmNlbHMgdGhlIHBlbmRpbmcgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJiZWFjb24tY29ubmVjdFwiIHwgXCJiZWFjb24tZGlzY29ubmVjdFwifSBhcmdzLnN0YWdlIC0gRmFpbHVyZSBzdGFnZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZXBvcnRBZnRlck1zIC0gR3JhY2Ugd2luZG93IGJlZm9yZSBhIHN1c3RhaW5lZCBvdXRhZ2UgaXMgcmVwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlLCBlcnJvciwgcmVwb3J0QWZ0ZXJNc30pIHtcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0ge3N0YWdlLCBlcnJvcn1cblxuICAgIC8vIEEgcmVwb3J0IGlzIGFscmVhZHkgcGVuZGluZyBvciBhbHJlYWR5IHNlbnQgZm9yIHRoaXMgb3V0YWdlIOKAlCBrZWVwIHRoZVxuICAgIC8vIGxhdGVzdCBlcnJvciBidXQgZG9uJ3Qgc3RhY2sgdGltZXJzIG9yIHJlLXJlcG9ydC5cbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIgfHwgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQpIHJldHVyblxuXG4gICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG5cbiAgICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQ/LmlzQ29ubmVjdGVkKCkpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uVXAoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSB0cnVlXG5cbiAgICAgIGlmICh0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yKSB0aGlzLl9yZXBvcnRCZWFjb25FcnJvcih0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yKVxuICAgIH0sIHJlcG9ydEFmdGVyTXMpXG5cbiAgICAvLyBEb24ndCBsZXQgdGhlIGdyYWNlIHRpbWVyIGtlZXAgdGhlIHByb2Nlc3MgYWxpdmUuXG4gICAgaWYgKHR5cGVvZiB0aW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aW1lci51bnJlZigpXG5cbiAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHRpbWVyXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGJlYWNvbi1kb3duIHN0YXRlIG9uIGEgKHJlKWNvbm5lY3QuIEEgYmxpcCB0aGF0IHJlY292ZXJzIHdpdGhpbiB0aGVcbiAgICogZ3JhY2Ugd2luZG93IGlzIG5ldmVyIHJlcG9ydGVkOyBpZiBhIHN1c3RhaW5lZCBvdXRhZ2UgaGFkIGFscmVhZHkgYmVlblxuICAgKiByZXBvcnRlZCwgdGhlIHN0YXRlIHJlc2V0cyBzbyBhIGZ1dHVyZSBvdXRhZ2UgY2FuIHJlcG9ydCBhZ2Fpbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQmVhY29uVXAoKSB7XG4gICAgaWYgKHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpXG4gICAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gZmFsc2VcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYSBCZWFjb24gZmFpbHVyZSBvbiB0aGUgZnJhbWV3b3JrIGVycm9yIGNoYW5uZWwuIE1pcnJvcnNcbiAgICogdGhlIHBhdHRlcm4gdXNlZCBieSBgcmVxdWVzdC1ydW5uZXIuanNgIGZvciBIVFRQIGVycm9ycy4gV2hlbiBub1xuICAgKiBsaXN0ZW5lciBpcyBhdHRhY2hlZCB0byBlaXRoZXIgYGZyYW1ld29yay1lcnJvcmAgb3IgYGFsbC1lcnJvcmAsXG4gICAqIGFsc28gc2NoZWR1bGVzIGFuIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbiBzbyBwcm9jZXNzLWxldmVsIGJ1Z1xuICAgKiByZXBvcnRlcnMgKHdoaWNoIHN1YnNjcmliZSB0byBgdW5oYW5kbGVkUmVqZWN0aW9uYCBieSBkZWZhdWx0KSBwaWNrXG4gICAqIHRoZSBmYWlsdXJlIHVwIOKAlCBhbmQgQUxTTyB3cml0ZXMgYSBvbmUtbGluZSBzdW1tYXJ5IHRvIGBzdGRlcnJgIHNvXG4gICAqIHRoZSBmYWlsdXJlIGlzbid0IGNvbXBsZXRlbHkgc2lsZW50IG9uIE5vZGUgMjQrIHdoZXJlIHRoZSBkZWZhdWx0XG4gICAqIGJlaGF2aW9yIG9mIGB1bmhhbmRsZWRSZWplY3Rpb25gIGlzIHRvIHRlcm1pbmF0ZSB0aGUgcHJvY2Vzcy4gQW5cbiAgICogYXBwIHRoYXQgc2VlcyBpdHMgc2VydmVyIHN1ZGRlbmx5IGV4aXQgbmVlZHMgYXQgbGVhc3Qgb25lXG4gICAqIGJyZWFkY3J1bWIgaW4gdGhlIGxvZ3MgdG8ga25vdyBCZWFjb24gd2FzIHRoZSBjYXVzZTsgdGhlIHByZXZpb3VzXG4gICAqIGJlaGF2aW9yIGxlZnQgYSBzdGFjay1vbmx5IGNyYXNoIHdpdGggbm8gY29udGV4dCB0eWluZyBpdCBiYWNrIHRvXG4gICAqIHRoZSBicm9rZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCJ9IGFyZ3Muc3RhZ2UgLSBGYWlsdXJlIHN0YWdlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEJlYWNvbkVycm9yKHtzdGFnZSwgZXJyb3J9KSB7XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLl9lcnJvckV2ZW50c1xuICAgIGNvbnN0IGhhc0xpc3RlbmVyID0gZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImZyYW1ld29yay1lcnJvclwiKSA+IDBcbiAgICAgIHx8IGVycm9yRXZlbnRzLmxpc3RlbmVyQ291bnQoXCJhbGwtZXJyb3JcIikgPiAwXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtzdGFnZX0sXG4gICAgICBlcnJvclxuICAgIH1cblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gICAgaWYgKCFoYXNMaXN0ZW5lcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuXG5cbiAgICAgIGNvbnNvbGUuZXJyb3IoYFt2ZWxvY2lvdXMgZnJhbWV3b3JrLWVycm9yIHN0YWdlPSR7c3RhZ2V9XSAke21lc3NhZ2V9IOKAlCByZWdpc3RlciBhIGxpc3RlbmVyIHZpYSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkub24oXCJmcmFtZXdvcmstZXJyb3JcIiwg4oCmKSB0byBzdXBwcmVzcyB0aGlzIHN0ZGVyciBmYWxsYmFja2ApXG4gICAgICB2b2lkIFByb21pc2UucmVqZWN0KGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgdGhlIGFjdGl2ZSBCZWFjb24gY2xpZW50IChpZiBhbnkpLiBTYWZlIHRvIGNhbGwgbXVsdGlwbGVcbiAgICogdGltZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgZGlzY29ubmVjdEJlYWNvbigpIHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLl9iZWFjb25DbGllbnRcblxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gdW5kZWZpbmVkXG5cbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcilcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcblxuICAgIGlmIChjbGllbnQpIGF3YWl0IGNsaWVudC5jbG9zZSgpXG4gIH1cblxuICAvKipcbiAgICogUm91dGVzIGEgQmVhY29uLXNvdXJjZWQgYnJvYWRjYXN0IHRocm91Z2ggdGhlIHNhbWUgZGVsaXZlcnkgY29kZVxuICAgKiBwYXRoIGFzIGEgbG9jYWxseS1vcmlnaW5hdGVkIG9uZS4gUHJlZmVycyB0aGUgd29ya2VydGhyZWFkLWF3YXJlXG4gICAqIGBicm9hZGNhc3RWMmAgd2hlbiBhbiBIVFRQIHNlcnZlciBpcyBob3N0aW5nIHdvcmtlcnMsIGFuZCBmYWxsc1xuICAgKiBiYWNrIHRvIHRoZSBwZXItcHJvY2VzcyBzdWJzY3JpcHRpb24gZGlzcGF0Y2ggb3RoZXJ3aXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmVhY29uL3R5cGVzLmpzXCIpLkJlYWNvbkJyb2FkY2FzdE1lc3NhZ2V9IG1lc3NhZ2UgLSBCcm9hZGNhc3QgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZGVsaXZlckJyb2FkY2FzdEZyb21CZWFjb24obWVzc2FnZSkge1xuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMih7XG4gICAgICAgIGNoYW5uZWw6IG1lc3NhZ2UuY2hhbm5lbCxcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zOiBtZXNzYWdlLmJyb2FkY2FzdFBhcmFtcyxcbiAgICAgICAgYm9keTogbWVzc2FnZS5ib2R5LFxuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzXG4gICAgICB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobWVzc2FnZS5jaGFubmVsLCBtZXNzYWdlLmJyb2FkY2FzdFBhcmFtcywgbWVzc2FnZS5ib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBpZiAoIXRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNMb2FkZXJUeXBlIHwgdW5kZWZpbmVkfSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyAtIFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZyhzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icykge1xuICAgIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID0gc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtYWlsZXIgYmFja2VuZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5NYWlsZXJCYWNrZW5kIHwgdW5kZWZpbmVkfSAtIE1haWxlciBiYWNrZW5kLlxuICAgKi9cbiAgZ2V0TWFpbGVyQmFja2VuZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fbWFpbGVyQmFja2VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG1haWxlciBiYWNrZW5kLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5NYWlsZXJCYWNrZW5kIHwgdW5kZWZpbmVkfSBtYWlsZXJCYWNrZW5kIC0gTWFpbGVyIGJhY2tlbmQsIG9yIHVuZGVmaW5lZCB0byByZW1vdmUgaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1haWxlckJhY2tlbmQobWFpbGVyQmFja2VuZCkge1xuICAgIHRoaXMuX21haWxlckJhY2tlbmQgPSBtYWlsZXJCYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogTG9nZ2luZyBjb25maWd1cmF0aW9uIHRhaWxvcmVkIGZvciBIVFRQIHJlcXVlc3QgbG9nZ2luZy4gRGVmYXVsdHMgY29uc29sZSBsb2dnaW5nIHRvIHRydWUgYW5kIGFwcGxpZXMgdGhlIHVzZXIgYGxvZ2dpbmcuY29uc29sZWAgZmxhZyBvbmx5IGZvciByZXF1ZXN0IGxvZ2dpbmcuXG4gICAqIEByZXR1cm5zIHtSZXF1aXJlZDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJjb25zb2xlXCIgfCBcImZpbGVcIiB8IFwibGV2ZWxzXCI+PiAmIFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImRpcmVjdG9yeVwiIHwgXCJmaWxlUGF0aFwiPiAmIFBhcnRpYWw8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwib3V0cHV0c1wiIHwgXCJsb2dnZXJzXCI+Pn0gLSBUaGUgaHR0cCBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRIdHRwTG9nZ2luZ0NvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TG9nZ2luZ0NvbmZpZ3VyYXRpb24oe2RlZmF1bHRDb25zb2xlOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbnZpcm9ubWVudCBoYW5kbGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqL1xuICBnZXRFbnZpcm9ubWVudEhhbmRsZXIoKSB7XG4gICAgaWYgKCF0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGVudmlyb25tZW50IGhhbmRsZXIgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZW52aXJvbm1lbnRIYW5kbGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2NhbGVGYWxsYmFja3NUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKi9cbiAgZ2V0TG9jYWxlRmFsbGJhY2tzKCkgeyByZXR1cm4gdGhpcy5sb2NhbGVGYWxsYmFja3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2NhbGVGYWxsYmFja3NUeXBlfSBuZXdMb2NhbGVGYWxsYmFja3MgLSBOZXcgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TG9jYWxlRmFsbGJhY2tzKG5ld0xvY2FsZUZhbGxiYWNrcykgeyB0aGlzLmxvY2FsZUZhbGxiYWNrcyA9IG5ld0xvY2FsZUZhbGxiYWNrcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN0cnVjdHVyZSBzcWwgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlN0cnVjdHVyZVNxbENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gU3RydWN0dXJlIFNRTCBjb25maWcuXG4gICAqL1xuICBnZXRTdHJ1Y3R1cmVTcWxDb25maWcoKSB7IHJldHVybiB0aGlzLl9zdHJ1Y3R1cmVTcWwgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCB3cml0ZSBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcGFyYW0ge3tyZWFzb24/OiBcIm1pZ3JhdGlvblwiIHwgXCJzY2hlbWFEdW1wXCJ9fSBbYXJnc10gLSBDYWxsIGNvbnRleHQgZm9yIHRoZSBzdHJ1Y3R1cmUgc3FsIHdyaXRlIGRlY2lzaW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN0cnVjdHVyZSBTUUwgZmlsZXMgc2hvdWxkIGJlIGdlbmVyYXRlZCBmb3IgdGhlIGN1cnJlbnQgZW52aXJvbm1lbnQuXG4gICAqL1xuICBzaG91bGRXcml0ZVN0cnVjdHVyZVNxbChhcmdzID0ge30pIHtcbiAgICBjb25zdCB7cmVhc29uID0gXCJtaWdyYXRpb25cIn0gPSBhcmdzXG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRTdHJ1Y3R1cmVTcWxDb25maWcoKVxuICAgIGNvbnN0IGVuYWJsZWRFbnZpcm9ubWVudHMgPSBjb25maWc/LmVuYWJsZWRFbnZpcm9ubWVudHNcbiAgICBjb25zdCBkaXNhYmxlZEVudmlyb25tZW50cyA9IGNvbmZpZz8uZGlzYWJsZWRFbnZpcm9ubWVudHNcblxuICAgIGlmIChyZWFzb24gPT09IFwic2NoZW1hRHVtcFwiKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGVuYWJsZWRFbnZpcm9ubWVudHMpKSB7XG4gICAgICByZXR1cm4gZW5hYmxlZEVudmlyb25tZW50cy5pbmNsdWRlcyh0aGlzLmdldEVudmlyb25tZW50KCkpXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZGlzYWJsZWRFbnZpcm9ubWVudHMpICYmIGRpc2FibGVkRW52aXJvbm1lbnRzLmluY2x1ZGVzKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldEVudmlyb25tZW50KCkgPT09IFwidGVzdFwiKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHN0cnVjdHVyZSBzcWwgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TdHJ1Y3R1cmVTcWxDb25maWd1cmF0aW9ufSBzdHJ1Y3R1cmVTcWwgLSBTdHJ1Y3R1cmUgU1FMIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U3RydWN0dXJlU3FsQ29uZmlnKHN0cnVjdHVyZVNxbCkge1xuICAgIHRoaXMuX3N0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbG9jYWxlLlxuICAgKi9cbiAgZ2V0TG9jYWxlKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5sb2NhbGUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5sb2NhbGUoKVxuICAgIH0gZWxzZSBpZiAodGhpcy5sb2NhbGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvY2FsZVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRMb2NhbGVzKClbMF1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIGxvY2FsZXMuXG4gICAqL1xuICBnZXRMb2NhbGVzKCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcImxvY2FsZXNcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcyhuYW1lKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzc2VzW25hbWVdXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBtb2RlbCBjbGFzcyAke25hbWV9IGluICR7T2JqZWN0LmtleXModGhpcy5tb2RlbENsYXNzZXMpLmpvaW4oXCIsIFwiKX19YClcblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQSBoYXNoIG9mIGFsbCBtb2RlbCBjbGFzc2VzLCBrZXllZCBieSBtb2RlbCBuYW1lLCBhcyB0aGV5IHdlcmUgZGVmaW5lZCBpbiB0aGUgY29uZmlndXJhdGlvbi4gVGhpcyBpcyBhIGRpcmVjdCByZWZlcmVuY2UgdG8gdGhlIG1vZGVsIGNsYXNzZXMsIG5vdCBhIGNvcHkuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzc2VzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdGluZy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gVGhlIHBhdGggdG8gYSBjb25maWcgZmlsZSB0aGF0IHNob3VsZCBiZSB1c2VkIGZvciB0ZXN0aW5nLlxuICAgKi9cbiAgZ2V0VGVzdGluZygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RpbmcgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cnVzdGVkIHByb3hpZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gVHJ1c3RlZCByZXZlcnNlIHByb3h5IGFkZHJlc3MgcmFuZ2VzLlxuICAgKi9cbiAgZ2V0VHJ1c3RlZFByb3hpZXMoKSB7IHJldHVybiB0aGlzLl90cnVzdGVkUHJveGllcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRydXN0ZWQgcHJveGllcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gdHJ1c3RlZFByb3hpZXMgLSBUcnVzdGVkIHJldmVyc2UgcHJveHkgYWRkcmVzcyByYW5nZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0VHJ1c3RlZFByb3hpZXModHJ1c3RlZFByb3hpZXMpIHsgdGhpcy5fdHJ1c3RlZFByb3hpZXMgPSB0cnVzdGVkUHJveGllcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBkYXRhYmFzZSBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2lkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllciB0byBpbml0aWFsaXplLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBpbml0aWFsaXplRGF0YWJhc2VQb29sKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGlmICghdGhpcy5kYXRhYmFzZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gJ2RhdGFiYXNlJyB3YXMgZ2l2ZW5cIilcbiAgICBpZiAodGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZVBvb2wgaGFzIGFscmVhZHkgYmVlbiBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgUG9vbFR5cGUgPSB0aGlzLmdldERhdGFiYXNlUG9vbFR5cGUoaWRlbnRpZmllcilcblxuICAgIHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IG5ldyBQb29sVHlwZSh7Y29uZmlndXJhdGlvbjogdGhpcywgaWRlbnRpZmllcn0pXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdLnNldEN1cnJlbnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZGF0YWJhc2UgcG9vbCBpbml0aWFsaXplZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtpZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0YWJhc2UgcG9vbCBpbml0aWFsaXplZC5cbiAgICovXG4gIGlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7IHJldHVybiBCb29sZWFuKHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGluaXRpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluaXRpYWxpemVkLlxuICAgKi9cbiAgaXNJbml0aWFsaXplZCgpIHsgcmV0dXJuIHRoaXMuX2lzSW5pdGlhbGl6ZWQgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBmcmFtZXdvcmstb3duZWQgcHJvY2VzcyBjb250ZXh0IGZvciB0aGlzIGNvbmZpZ3VyYXRpb24nc1xuICAgKiBsaWZlY3ljbGUuIEl0IGlzIHVuZGVmaW5lZCB1bnRpbCBgaW5pdGlhbGl6ZSgpYCBzdGFydHMsIGFuZCBpdCBjYXJyaWVzIHRoZVxuICAgKiBwcm9jZXNzIGB0eXBlYCAoYHNlcnZlcmAsIGB3b3JrZXItaGFuZGxlcmAsIGJhY2tncm91bmQtam9icyB0eXBlcywgb3IgYW5cbiAgICogYXBwbGljYXRpb24tZGVmaW5lZCBzdHJpbmcpIHNvIGhvb2tzIGFuZCBmcmFtZXdvcmsgc2VydmljZXMgY2FuIHRlbGwgd2hpY2hcbiAgICogcHJvY2VzcyB0aGV5IGFyZSBydW5uaW5nIGluLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgfCB1bmRlZmluZWR9IC0gUHJvY2VzcyBjb250ZXh0LCB3aGVuIGluaXRpYWxpemF0aW9uIGhhcyBzdGFydGVkLlxuICAgKi9cbiAgZ2V0QXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCgpIHsgcmV0dXJuIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgbW9kZWxzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZU1vZGVscyhhcmdzID0ge3R5cGU6IFwic2VydmVyXCJ9KSB7XG4gICAgY29uc3QgbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgaWYgKHRoaXMuX21vZGVsc0luaXRpYWxpemVkKSByZXR1cm5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgIGNvbnN0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgICAgYXdhaXQgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID09PSBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAmJiAhdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID09PSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5pbml0aWFsaXplTW9kZWxzKGFyZ3MpXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNob3VsZFNraXBEdW1teU1vZGVsSW5pdGlhbGl6YXRpb24gPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfU0tJUF9EVU1NWV9NT0RFTF9JTklUSUFMSVpBVElPTiA9PT0gXCIxXCJcbiAgICAgICAgJiYgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gICAgICAgICYmIHRoaXMuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCJcblxuICAgICAgaWYgKCFzaG91bGRTa2lwRHVtbXlNb2RlbEluaXRpYWxpemF0aW9uKSB7XG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVscyh7Y29uZmlndXJhdGlvbjogdGhpcywgcHJvY2Vzc0NvbnRleHQ6IHRoaXMuZ2V0QXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCgpLCB0eXBlOiBhcmdzLnR5cGV9KVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbml0aWFsaXplUGFja2FnZU1vZGVscyh0aGlzKVxuICAgICAgICBhd2FpdCBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyh0aGlzKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW5pdGlhbGl6ZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzKHRoaXMpXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBlYWNoIGNvbmZpZ3VyZWQgZGF0YWJhc2UgcG9vbCBoYXMgYSBnbG9iYWwgY29ubmVjdGlvbiBhdmFpbGFibGUuXG4gICAqIFVzZWZ1bCB3aGVuIGBnZXRDdXJyZW50Q29ubmVjdGlvbmAgbWlnaHQgYmUgY2FsbGVkIHdpdGhvdXQgYW4gYXN5bmMgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUdsb2JhbENvbm5lY3Rpb25zKCkge1xuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIGF3YWl0IHBvb2wuZW5zdXJlR2xvYmFsQ29ubmVjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFR5cGUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGluaXRpYWxpemUoe3R5cGV9ID0ge3R5cGU6IFwidW5kZWZpbmVkXCJ9KSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlKSByZXR1cm4gdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogdHJ1ZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5fc2h1dGRvd25Qcm9taXNlfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiBmYWxzZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIG9yIGpvaW5zIGluaXRpYWxpemF0aW9uIGFmdGVyIGxpZmVjeWNsZSBibG9ja2VycyBoYXZlIHNldHRsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU3RhcnR1cCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gR2VuZXJpYyBhcHBsaWNhdGlvbiBwcm9jZXNzIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBzdGFydHVwIHByb21pc2UuXG4gICAqL1xuICBfYmVnaW5Jbml0aWFsaXplKHt0eXBlfSkge1xuICAgIGNvbnN0IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiBmYWxzZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5faW5pdGlhbGl6ZVByb21pc2V9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pc0luaXRpYWxpemVkKSB7XG4gICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgICAgcmV0dXJuIHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgfVxuICAgIC8vIE1lbW9pemUgdGhlIGluLXByb2dyZXNzIGluaXRpYWxpemF0aW9uIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGUgc2FtZVxuICAgIC8vIGJvb3RzdHJhcCBpbnN0ZWFkIG9mIHJhY2luZy4gYF9pc0luaXRpYWxpemVkYCB3YXMgcHJldmlvdXNseSBzZXQgdG8gYHRydWVgXG4gICAgLy8gdXAgZnJvbnQsIHNvIGEgc2Vjb25kIGNhbGxlciAoZS5nLiBhIHBvb2xlZCBydW5uZXIgd2l0aFxuICAgIC8vIGBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+IDFgIHN0YXJ0aW5nIHNldmVyYWwgam9icyBvbiBhIGNvbGQgY2hpbGQpIGNvdWxkXG4gICAgLy8gc2tpcCBpbml0aWFsaXphdGlvbiBhbmQgbG9hZCBtb2RlbHMgLyBwZXJmb3JtIGEgam9iIHdoaWxlIHRoZSBmaXJzdCBjYWxsXG4gICAgLy8gd2FzIHN0aWxsIGF3YWl0aW5nIG1vZGVsIGRpc2NvdmVyeSBhbmQgaW5pdGlhbGl6ZXJzLiBNaXJyb3JzIGNvbm5lY3RCZWFjb24uXG4gICAgY29uc3QgaW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9ydW5Jbml0aWFsaXplKHtpbml0aWFsaXphdGlvbkdlbmVyYXRpb24sIHR5cGV9KVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSBpbml0aWFsaXplUHJvbWlzZVxuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgcmV0dXJuIGluaXRpYWxpemVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIG9uZSBzaGFyZWQgaW5pdGlhbGl6YXRpb24gYmVoaW5kIGFuIGluY29tcGF0aWJsZSBsaWZlY3ljbGUgcGhhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSAtIFdoZXRoZXIgYSBjb21wbGV0ZWQgZmFpbGVkIHNodXRkb3duIHN0aWxsIHBlcm1pdHMgcmVwbGFjZW1lbnQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFJlcGxhY2VtZW50IHByb2Nlc3MgdHlwZS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBhcmdzLndhaXRGb3IgLSBMaWZlY3ljbGUgcGhhc2UgdGhhdCBtdXN0IHNldHRsZSBmaXJzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2hhcmVkIHF1ZXVlZCBzdGFydHVwIHByb21pc2UuXG4gICAqL1xuICBfcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHR5cGUsIHdhaXRGb3J9KSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlKSByZXR1cm4gdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIGNvbnN0IHF1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB3YWl0Rm9yfSlcblxuICAgICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSA9PT0gd2FpdEZvcikgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IHdhaXRGb3IpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNodXRkb3duUHJvbWlzZSA9IHRoaXMuX3NodXRkb3duUHJvbWlzZVxuXG4gICAgICBpZiAoc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiB0cnVlLCB3YWl0Rm9yOiBzaHV0ZG93blByb21pc2V9KVxuICAgICAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlID09PSBzaHV0ZG93blByb21pc2UpIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uICE9PSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICBjb25zdCBzdGFsZUluaXRpYWxpemVQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcblxuICAgICAgICBhd2FpdCBzdGFsZUluaXRpYWxpemVQcm9taXNlXG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gc3RhbGVJbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fYmVnaW5Jbml0aWFsaXplKHt0eXBlfSlcbiAgICB9KSgpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuXG4gICAgcmV0dXJuIHF1ZXVlZEluaXRpYWxpemVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGEgbGlmZWN5Y2xlIHBoYXNlIGJlZm9yZSBxdWV1ZWQgaW5pdGlhbGl6YXRpb24gcHJvY2VlZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2FpdCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jb250aW51ZUFmdGVyV2FpdEZhaWx1cmUgLSBXaGV0aGVyIHJlcGxhY2VtZW50IHN0YXJ0dXAgcmVtYWlucyBhdmFpbGFibGUgYWZ0ZXIgYSBmYWlsZWQgcGhhc2UuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gYXJncy53YWl0Rm9yIC0gTGlmZWN5Y2xlIHBoYXNlIHRoYXQgbXVzdCBzZXR0bGUgZmlyc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcXVldWVkIGluaXRpYWxpemF0aW9uIG1heSBjb250aW51ZS5cbiAgICovXG4gIGFzeW5jIF93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgd2FpdEZvcn0pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd2FpdEZvclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIWNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgYXRvbWljIGZyYW1ld29yayBhbmQgYXBwbGljYXRpb24gaW5pdGlhbGl6YXRpb24gYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbml0aWFsaXphdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uIC0gRnJhbWV3b3JrIG1vZGVsIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBHZW5lcmljIGFwcGxpY2F0aW9uIHByb2Nlc3MgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBpbml0aWFsaXplZC5cbiAgICovXG4gIGFzeW5jIF9ydW5Jbml0aWFsaXplKHtpbml0aWFsaXphdGlvbkdlbmVyYXRpb24sIHR5cGV9KSB7XG4gICAgY29uc3Qgc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUgPSAhdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZFxuXG4gICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB7XG4gICAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICAgIGluc3RhbmNlSWQ6IG5ldyBVVUlEKDQpLmZvcm1hdCgpLFxuICAgICAgICB0eXBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemVNb2RlbHMoe3R5cGV9KVxuXG4gICAgICAvLyBNb2RlbCBpbml0aWFsaXphdGlvbiBjYW4gYmUgaW52YWxpZGF0ZWQgYnkgYSBjb25jdXJyZW50IGNvbm5lY3Rpb24gY2xvc2UuXG4gICAgICAvLyBJZiBtb2RlbHMgYXJlIG5vdCByZWFkeSwgc3RvcCB3aXRob3V0IG1hcmtpbmcgdGhlIGNvbmZpZ3VyYXRpb24gaW5pdGlhbGl6ZWRcbiAgICAgIC8vIHNvIHRoZSBuZXh0IGNhbGxlciByZXRyaWVzIGEgZnVsbCBib290c3RyYXAuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gIT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiB8fCAhdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuYXV0b0Rpc2NvdmVyUmVzb3VyY2VzKHRoaXMpXG4gICAgICB0aGlzLl9tZXJnZURpc2NvdmVyZWRBYmlsaXR5UmVzb3VyY2VzKClcbiAgICAgIHRoaXMuX3ZhbGlkYXRlUmVzb3VyY2VSZWxhdGlvbnNoaXBzT25Nb2RlbHMoKVxuXG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUgJiYgdGhpcy5faW5pdGlhbGl6ZXJzKSB7XG4gICAgICAgIGNvbnN0IGluaXRpYWxpemVycyA9IGF3YWl0IHRoaXMuX2luaXRpYWxpemVycyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgICAgIGNvbnN0IHtyZXF1aXJlQ29udGV4dCwgLi4ucmVzdEFyZ3N9ID0gaW5pdGlhbGl6ZXJzXG5cbiAgICAgICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgICAgICBpZiAocmVxdWlyZUNvbnRleHQpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGluaXRpYWxpemVyS2V5IG9mIHJlcXVpcmVDb250ZXh0LmtleXMoKSkge1xuICAgICAgICAgICAgY29uc3QgSW5pdGlhbGl6ZXJDbGFzcyA9IHJlcXVpcmVDb250ZXh0KGluaXRpYWxpemVyS2V5KS5kZWZhdWx0XG4gICAgICAgICAgICBjb25zdCBwcm9jZXNzQ29udGV4dCA9IHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHRcblxuICAgICAgICAgICAgaWYgKCFwcm9jZXNzQ29udGV4dCkgdGhyb3cgbmV3IEVycm9yKFwiQXBwbGljYXRpb24gcHJvY2VzcyBjb250ZXh0IGlzIG5vdCBhdmFpbGFibGUgZHVyaW5nIGluaXRpYWxpemVyIHN0YXJ0dXBcIilcblxuICAgICAgICAgICAgY29uc3QgaW5pdGlhbGl6ZXJJbnN0YW5jZSA9IG5ldyBJbml0aWFsaXplckNsYXNzKHtjb25maWd1cmF0aW9uOiB0aGlzLCBwcm9jZXNzQ29udGV4dCwgdHlwZX0pXG5cbiAgICAgICAgICAgIGF3YWl0IGluaXRpYWxpemVySW5zdGFuY2UucnVuKClcbiAgICAgICAgICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMucHVzaChpbml0aWFsaXplckluc3RhbmNlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWQgPSB0cnVlXG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkge1xuICAgICAgICBsZXQgdGVhcmRvd25FcnJvclxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKClcbiAgICAgICAgfSBjYXRjaCAoY2F1Z2h0VGVhcmRvd25FcnJvcikge1xuICAgICAgICAgIHRlYXJkb3duRXJyb3IgPSBjYXVnaHRUZWFyZG93bkVycm9yXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGVhcmRvd25FcnJvciBpbnN0YW5jZW9mIEFnZ3JlZ2F0ZUVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW2Vycm9yLCAuLi50ZWFyZG93bkVycm9yLmVycm9yc10sXG4gICAgICAgICAgICBcIkFwcGxpY2F0aW9uIHByb2Nlc3Mgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlYXJkb3duRXJyb3IgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgdGVhcmRvd25FcnJvcl0sXG4gICAgICAgICAgICBcIkFwcGxpY2F0aW9uIHByb2Nlc3Mgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNJbml0aWFsaXplZCAmJiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biBldmVyeSBzdWNjZXNzZnVsbHkgc3RhcnRlZCBpbml0aWFsaXplciBpbiByZXZlcnNlIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRlYXJkb3duIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpIHtcbiAgICBjb25zdCBzdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5zcGxpY2UoMCkucmV2ZXJzZSgpXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQXBwbGljYXRpb24gaW5pdGlhbGl6ZXIgdGVhcmRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5tYXAoKGluaXRpYWxpemVyKSA9PiBhc3luYyAoKSA9PiBhd2FpdCBpbml0aWFsaXplci50ZWFyZG93bigpKVxuICAgIH0pXG4gIH1cblxuICAvKiogQ2xlYXJzIGFwcGxpY2F0aW9uLW93bmVkIGxpZmVjeWNsZSBzdGF0ZSBhZnRlciBldmVyeSB0ZWFyZG93biBhdHRlbXB0LiAqL1xuICBfcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpIHtcbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycyA9IFtdXG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biB0aGUgY3VycmVudCBhcHBsaWNhdGlvbiBsaWZlY3ljbGUgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gRXhhY3Qgc2hhcmVkIHNodXRkb3duIHByb21pc2UuXG4gICAqL1xuICBzaHV0ZG93bigpIHtcbiAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlKSByZXR1cm4gdGhpcy5fc2h1dGRvd25Qcm9taXNlXG5cbiAgICBjb25zdCBpbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgY29uc3Qgc2h1dGRvd25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChpbml0aWFsaXplUHJvbWlzZSkgYXdhaXQgaW5pdGlhbGl6ZVByb21pc2VcbiAgICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKClcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSBpbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KSgpXG5cbiAgICB0aGlzLl9zaHV0ZG93blByb21pc2UgPSBzaHV0ZG93blByb21pc2VcblxuICAgIHJldHVybiBzaHV0ZG93blByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhhdCByZXNvdXJjZS1kZWZpbmVkIHJlbGF0aW9uc2hpcHMgYXJlIGFsc28gZGVmaW5lZCBvbiB0aGUgY29ycmVzcG9uZGluZyBtb2RlbCBjbGFzc2VzLlxuICAgKiBUaHJvd3MgYW4gZXJyb3IgaWYgYSByZWxhdGlvbnNoaXAgaXMgZGVmaW5lZCBvbiBhIHJlc291cmNlIGJ1dCBtaXNzaW5nIGZyb20gdGhlIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJlc291cmNlUmVsYXRpb25zaGlwc09uTW9kZWxzKCkge1xuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5fYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICAgIGZvciAoY29uc3QgW21vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZXMpKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlnPy5yZWxhdGlvbnNoaXBzKSBjb250aW51ZVxuXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBkZWZpbmVzIHJlbGF0aW9uc2hpcHMgYXMgYW4gb2JqZWN0LiBVc2UgYW4gYXJyYXkgaW5zdGVhZDogc3RhdGljIHJlbGF0aW9uc2hpcHMgPSAke0pTT04uc3RyaW5naWZ5KE9iamVjdC5rZXlzKHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUmVsYXRpb25zaGlwcyA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpXG5cbiAgICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgICBpZiAoIShyZWxhdGlvbnNoaXBOYW1lIGluIGV4aXN0aW5nUmVsYXRpb25zaGlwcykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYFJlc291cmNlIGZvciAke21vZGVsTmFtZX0gZGVmaW5lcyByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgYnV0ICR7bW9kZWxOYW1lfSBtb2RlbCBkb2VzIG5vdC4gYCArXG4gICAgICAgICAgICAgIGBBZGQgJHttb2RlbE5hbWV9LmJlbG9uZ3NUbyhcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiwgLi4uKSBvciB0aGUgYXBwcm9wcmlhdGUgcmVsYXRpb25zaGlwIGNhbGwgb24gdGhlIG1vZGVsIGNsYXNzLmBcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZWdpc3Rlck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWxDbGFzc2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldID0gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnQoKSB7XG4gICAgc2V0Q3VycmVudENvbmZpZ3VyYXRpb24odGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb3V0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSByb3V0ZXMuXG4gICAqL1xuICBnZXRSb3V0ZXMoKSB7IHJldHVybiB0aGlzLl9yb3V0ZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCByb3V0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdH0gbmV3Um91dGVzIC0gTmV3IHJvdXRlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Um91dGVzKG5ld1JvdXRlcykge1xuICAgIHRoaXMuX3JvdXRlcyA9IG5ld1JvdXRlc1xuICAgIHRoaXMuX2FwcGx5Um91dGVNb3VudHMobmV3Um91dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYW55IGByb3V0ZS5tb3VudCguLi4pYCByZWdpc3RyYXRpb25zIGZyb20gdGhlIHJvdXRlcyBmaWxlIGJ5IGxldHRpbmdcbiAgICogZWFjaCBtb3VudGFibGUgcmVnaXN0ZXIgaXRzIHJvdXRlcyAodHlwaWNhbGx5IHJvdXRlLXJlc29sdmVyIGhvb2tzKSBhZ2FpbnN0XG4gICAqIHRoaXMgY29uZmlndXJhdGlvbi4gR3VhcmRlZCBzbyByZXBlYXRlZCBzZXRSb3V0ZXMgY2FsbHMgd2l0aCB0aGUgc2FtZSByb3V0ZXNcbiAgICogZG9uJ3QgcmVnaXN0ZXIgYSBtb3VudCBtb3JlIHRoYW4gb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0fSBuZXdSb3V0ZXMgLSBSb3V0ZXMgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hcHBseVJvdXRlTW91bnRzKG5ld1JvdXRlcykge1xuICAgIGlmICghbmV3Um91dGVzIHx8IHR5cGVvZiBuZXdSb3V0ZXMuZ2V0TW91bnRzICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBtb3VudCBvZiBuZXdSb3V0ZXMuZ2V0TW91bnRzKCkpIHtcbiAgICAgIGlmICh0aGlzLl9hcHBsaWVkUm91dGVNb3VudHMuaGFzKG1vdW50KSkgY29udGludWVcblxuICAgICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzLmFkZChtb3VudClcbiAgICAgIG1vdW50Lm1vdW50YWJsZS5tb3VudEludG8oe2NvbmZpZ3VyYXRpb246IHRoaXMsIC4uLm1vdW50Lm9wdGlvbnN9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIHBsdWdpbi9saWJyYXJ5IHJvdXRlcyB1c2luZyBhIGxpZ2h0d2VpZ2h0IHJvdXRlIERTTCBiYWNrZWQgYnkgcm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqIEBwYXJhbSB7KHJvdXRlczogaW1wb3J0KFwiLi9yb3V0ZXMvcGx1Z2luLXJvdXRlcy5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkfSBjYWxsYmFjayAtIFJvdXRlcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcm91dGVzKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcGx1Z2luUm91dGVzID0gbmV3IFBsdWdpblJvdXRlcyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG5cbiAgICBjYWxsYmFjayhwbHVnaW5Sb3V0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJhbnNsYXRvci5cbiAgICogQHBhcmFtIHsoYXJnMTogc3RyaW5nLCBhcmcyOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWQpID0+IHN0cmluZ30gY2FsbGJhY2sgLSBUcmFuc2xhdG9yIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUcmFuc2xhdG9yKGNhbGxiYWNrKSB7IHRoaXMuX3RyYW5zbGF0b3IgPSBjYWxsYmFjayB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbXNnSUQgLSBNc2cgaWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJnc10gLSBUcmFuc2xhdG9yIG9wdGlvbnMgYW5kIHZhcmlhYmxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKi9cbiAgX2RlZmF1bHRUcmFuc2xhdG9yKG1zZ0lELCBhcmdzKSB7XG4gICAgdGhpcy5fY29uZmlndXJlRGVmYXVsdFRyYW5zbGF0b3IoKVxuXG4gICAgY29uc3QgdHJhbnNsYXRlQXJncyA9IGFyZ3MgPyB7Li4uYXJnc30gOiB1bmRlZmluZWRcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSB0cmFuc2xhdGVBcmdzPy5kZWZhdWx0VmFsdWVcbiAgICBjb25zdCBsb2NhbGVzID0gdHJhbnNsYXRlQXJncz8ubG9jYWxlc1xuXG4gICAgaWYgKHRyYW5zbGF0ZUFyZ3MpIHtcbiAgICAgIGRlbGV0ZSB0cmFuc2xhdGVBcmdzLmRlZmF1bHRWYWx1ZVxuICAgICAgZGVsZXRlIHRyYW5zbGF0ZUFyZ3MubG9jYWxlc1xuICAgIH1cblxuICAgIGNvbnN0IHZhcmlhYmxlcyA9IHRyYW5zbGF0ZUFyZ3MgJiYgT2JqZWN0LmtleXModHJhbnNsYXRlQXJncykubGVuZ3RoID4gMCA/IHRyYW5zbGF0ZUFyZ3MgOiB1bmRlZmluZWRcblxuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKClcbiAgICBjb25zdCBwcmVmZXJyZWRMb2NhbGVzID0gbG9jYWxlcyB8fCAobG9jYWxlID8gdW5kZWZpbmVkIDogW10pXG4gICAgY29uc3QgbWVzc2FnZSA9IHRyYW5zbGF0ZShtc2dJRCwgdmFyaWFibGVzLCBwcmVmZXJyZWRMb2NhbGVzKVxuXG4gICAgaWYgKG1lc3NhZ2UgPT09IG1zZ0lEICYmIGRlZmF1bHRWYWx1ZSkgcmV0dXJuIHRyYW5zbGF0ZShkZWZhdWx0VmFsdWUsIHZhcmlhYmxlcywgW10pXG5cbiAgICByZXR1cm4gbWVzc2FnZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0b3IuXG4gICAqIEByZXR1cm5zIHsobXNnSUQ6IHN0cmluZywgYXJncz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gc3RyaW5nfSAtIFRoZSBjb25maWd1cmVkIHRyYW5zbGF0b3IuXG4gICAqL1xuICBnZXRUcmFuc2xhdG9yKCkge1xuICAgIGlmICh0aGlzLl90cmFuc2xhdG9yKSByZXR1cm4gdGhpcy5fdHJhbnNsYXRvclxuXG4gICAgaWYgKCF0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kKSB7XG4gICAgICB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kID0gdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3IuYmluZCh0aGlzKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmUgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBDb25maWd1cmUgZ2V0dGV4dCBkZWZhdWx0cyBmb3IgdGhpcyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX2NvbmZpZ3VyZURlZmF1bHRUcmFuc2xhdG9yKCkge1xuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKClcblxuICAgIGdldHRleHRDb25maWcuc2V0TG9jYWxlKGxvY2FsZSB8fCBcIlwiKVxuXG4gICAgY29uc3QgZmFsbGJhY2tzID0gbG9jYWxlID8gdGhpcy5nZXRMb2NhbGVGYWxsYmFja3MoKT8uW2xvY2FsZV0gOiBbXVxuXG4gICAgZ2V0dGV4dENvbmZpZy5zZXRGYWxsYmFja3MoZmFsbGJhY2tzIHx8IFtdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lIG9mZnNldCBtaW51dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRoZSB0aW1lem9uZSBvZmZzZXQgaW4gbWludXRlcy5cbiAgICovXG4gIGdldFRpbWV6b25lT2Zmc2V0TWludXRlcygpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjb25zdCBjb25maWd1cmVkT2Zmc2V0ID0gdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzKClcblxuICAgICAgaWYgKHR5cGVvZiBjb25maWd1cmVkT2Zmc2V0ID09PSBcIm51bWJlclwiKSByZXR1cm4gY29uZmlndXJlZE9mZnNldFxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VGltZXpvbmVPZmZzZXQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWUgem9uZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXRUaW1lWm9uZSgpIHtcbiAgICBjb25zdCB0aW1lWm9uZSA9IHR5cGVvZiB0aGlzLl90aW1lWm9uZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3RpbWVab25lKClcbiAgICAgIDogdGhpcy5fdGltZVpvbmVcblxuICAgIGlmICh0aW1lWm9uZSA9PT0gdW5kZWZpbmVkIHx8IHRpbWVab25lID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJjb25maWd1cmF0aW9uIHRpbWVab25lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWV2ZW50cy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0RXZlbnRzKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWV2ZW50cy5qc1wiKS5kZWZhdWx0fSB3ZWJzb2NrZXRFdmVudHMgLSBXZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRXZWJzb2NrZXRFdmVudHMod2Vic29ja2V0RXZlbnRzKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0RXZlbnRzID0gd2Vic29ja2V0RXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUGVyLXByb2Nlc3MgcmVnaXN0cnkgb2YgY2hhbm5lbCBzdWJzY3JpYmVycyB1c2VkIGJ5IHdvcmtlciBjb2RlIHRoYXRcbiAgICogbmVlZHMgdG8gcmVhY3QgdG8gZXZlbnRzIGJyb2FkY2FzdCB2aWEgYHdlYnNvY2tldEV2ZW50c0hvc3QucHVibGlzaCguLi4pYFxuICAgKiB3aXRob3V0IGhvbGRpbmcgYW4gYWN0dWFsIHdlYnNvY2tldCBzZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpYmVycy5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjaGFubmVsIHN1YnNjcmliZXJzIHJlZ2lzdHJ5LlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKCkge1xuICAgIGlmICghdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKSB7XG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgPSBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGBWZWxvY2lvdXNXZWJzb2NrZXRDb25uZWN0aW9uYCBzdWJjbGFzcyB1bmRlciBhIG5hbWUuXG4gICAqIENsaWVudHMgdGhhdCBzZW5kIGB7dHlwZTogXCJjb25uZWN0aW9uLW9wZW5cIiwgY29ubmVjdGlvblR5cGU6IG5hbWV9YFxuICAgKiB3aWxsIGhhdmUgdGhpcyBjbGFzcyBpbnN0YW50aWF0ZWQgZm9yIHRoZWlyIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2xpZW50LWZhY2luZyBjb25uZWN0aW9uIHR5cGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0fSBDb25uZWN0aW9uQ2xhc3MgLSBXZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlcldlYnNvY2tldENvbm5lY3Rpb24obmFtZSwgQ29ubmVjdGlvbkNsYXNzKSB7XG4gICAgaWYgKCFuYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25uZWN0aW9uIG5hbWUgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIUNvbm5lY3Rpb25DbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbkNsYXNzIGlzIHJlcXVpcmVkXCIpXG4gICAgdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMuc2V0KG5hbWUsIENvbm5lY3Rpb25DbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25uZWN0aW9uIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBSZWdpc3RlcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMuZ2V0KG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxgIHN1YmNsYXNzIHVuZGVyIGEgbmFtZS5cbiAgICogQ2xpZW50cyBzdWJzY3JpYmUgdmlhIGB7dHlwZTogXCJjaGFubmVsLXN1YnNjcmliZVwiLCBjaGFubmVsVHlwZTogbmFtZSwgLi4ufWAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2xpZW50LWZhY2luZyBjaGFubmVsIHR5cGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBDaGFubmVsQ2xhc3MgLSBXZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICogQHBhcmFtIHt7bGl2ZU9ubHk/OiBib29sZWFufX0gW29wdGlvbnNdIC0gUmVnaXN0cmF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsKG5hbWUsIENoYW5uZWxDbGFzcywge2xpdmVPbmx5ID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAoIW5hbWUpIHRocm93IG5ldyBFcnJvcihcIkNoYW5uZWwgbmFtZSBpcyByZXF1aXJlZFwiKVxuICAgIGlmICghQ2hhbm5lbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJDaGFubmVsQ2xhc3MgaXMgcmVxdWlyZWRcIilcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5zZXQobmFtZSwgQ2hhbm5lbENsYXNzKVxuXG4gICAgaWYgKGxpdmVPbmx5KSB0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzLmFkZChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSBuYW1lIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFJlZ2lzdGVyZWQgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsQ2xhc3MobmFtZSkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5nZXQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgY2hhbm5lbCB0eXBlIHdhcyByZWdpc3RlcmVkIHdpdGggYHtsaXZlT25seTogdHJ1ZX1gLlxuICAgKiBMaXZlLW9ubHkgY2hhbm5lbHMgYXJlIG5ldmVyIHBlcnNpc3RlZCBmb3IgcmVwbGF5OiB0aGUgZXZlbnQtbG9nXG4gICAqIHN0b3JlJ3MgYG1hcmtDaGFubmVsSW50ZXJlc3RlZGAgdGhyb3dzIGZvciB0aGVpciBuYW1lcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjaGFubmVsIGlzIGRlY2xhcmVkIGxpdmUtb25seS5cbiAgICovXG4gIGlzV2Vic29ja2V0Q2hhbm5lbExpdmVPbmx5KG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbGl2ZU9ubHlXZWJzb2NrZXRDaGFubmVscy5oYXMobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBsaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIGluIHRoZSBnbG9iYWwgcm91dGluZyByZWdpc3RyeS5cbiAgICogQ2FsbGVkIGJ5IHRoZSBzZXNzaW9uIHdoZW4gYGNhblN1YnNjcmliZSgpYCByZXNvbHZlcyB0cnV0aHk7IHRoZVxuICAgKiBzZXNzaW9uIGNhbGxzIGBfdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25gIG9uIHVuc3Vic2NyaWJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSB1c2VkIGFzIHRoZSByb3V0aW5nIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIExpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gdG8gcmVnaXN0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihuYW1lLCBzdWJzY3JpcHRpb24pIHtcbiAgICBsZXQgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkge1xuICAgICAgYnVja2V0ID0gbmV3IFNldCgpXG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5zZXQobmFtZSwgYnVja2V0KVxuICAgIH1cblxuICAgIGJ1Y2tldC5hZGQoc3Vic2NyaXB0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdW5yZWdpc3RlciB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHVzZWQgYXMgdGhlIHJvdXRpbmcga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gc3Vic2NyaXB0aW9uIC0gTGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiB0byByZW1vdmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKG5hbWUsIHN1YnNjcmlwdGlvbikge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHJldHVyblxuXG4gICAgYnVja2V0LmRlbGV0ZShzdWJzY3JpcHRpb24pXG5cbiAgICBpZiAoYnVja2V0LnNpemUgPT09IDApIHtcbiAgICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmRlbGV0ZShuYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBgYm9keWAgdG8gZXZlcnkgbGl2ZSBzdWJzY3JpYmVyIG9mIGBuYW1lYCB3aG9zZVxuICAgKiBgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpYCByZXR1cm5zIHRydWUuIFB1cmUgcm91dGluZyDigJQgbm8gYXV0aFxuICAgKiByZS1jaGVjaywgbm8gcGVyc2lzdGVuY2UuIFN1YnNjcmliZXJzIHdobyB3ZXJlIGFkbWl0dGVkIGJ5XG4gICAqIGBjYW5TdWJzY3JpYmUoKWAgY29udGludWUgdG8gcmVjZWl2ZSBicm9hZGNhc3RzIHVudGlsIHRoZXlcbiAgICogdW5zdWJzY3JpYmUgb3IgdGhlIHNlc3Npb24gZW5kcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVcbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtc1xuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5XG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGdyYWNlIHNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gR3JhY2UgcGVyaW9kIChzZWNvbmRzKSBiZWZvcmUgYSBwYXVzZWQgV1Mgc2Vzc2lvbiBpcyB0b3JuIGRvd24uXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzKCkgeyByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGhlYXJ0YmVhdCBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEludGVydmFsIChzZWNvbmRzKSBiZXR3ZWVuIHNlcnZlcuKGkmNsaWVudCBoZWFydGJlYXQgcGluZ3M7IDAgZGlzYWJsZXMgcmVhcGluZy5cbiAgICovXG4gIGdldFdlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzKCkgeyByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBlci1zZXNzaW9uIFdlYlNvY2tldCBpbmJvdW5kIG1lc3NhZ2UgcXVldWUgbGltaXRzLlxuICAgKiBAcmV0dXJucyB7e21heEJ5dGVzOiBudW1iZXIsIG1heE1lc3NhZ2VzOiBudW1iZXJ9fSAtIFBlci1zZXNzaW9uIGluYm91bmQgcXVldWUgaGlnaC13YXRlciBtYXJrcy5cbiAgICovXG4gIGdldFdlYnNvY2tldEluYm91bmRRdWV1ZUxpbWl0cygpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWVcblxuICAgIHJldHVybiB7XG4gICAgICBtYXhCeXRlczogcXVldWUubWF4UGVuZGluZ0J5dGVzLFxuICAgICAgbWF4TWVzc2FnZXM6IHF1ZXVlLm1heFBlbmRpbmdNZXNzYWdlc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBlci1jbGllbnQgV2ViU29ja2V0IG91dGJvdW5kIHF1ZXVlIGxpbWl0cy5cbiAgICogQHJldHVybnMge3ttYXhCeXRlczogbnVtYmVyLCBtYXhGcmFtZXM6IG51bWJlcn19IC0gUGVyLWNsaWVudCBvdXRib3VuZCBxdWV1ZSBoaWdoLXdhdGVyIG1hcmtzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0T3V0Ym91bmRRdWV1ZUxpbWl0cygpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWF4Qnl0ZXM6IHF1ZXVlLm1heFBlbmRpbmdCeXRlcyxcbiAgICAgIG1heEZyYW1lczogcXVldWUubWF4UGVuZGluZ0ZyYW1lc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB3cmFwcGVyIGludm9rZWQgYXJvdW5kIGV2ZXJ5IFdTLWJvcm5lIHJlcXVlc3QgL1xuICAgKiBjb25uZWN0aW9uIG1lc3NhZ2UgLyBjaGFubmVsIGRpc3BhdGNoLiBUaGUgd3JhcHBlciByZWNlaXZlcyB0aGVcbiAgICogc2Vzc2lvbiBhbmQgYSBgbmV4dGAgY2FsbGJhY2s7IGl0IG11c3QgY2FsbCBgbmV4dCgpYCB0byBydW4gdGhlXG4gICAqIGhhbmRsZXIuIFVzZSBpdCB0byBzZXQgdXAgQXN5bmNMb2NhbFN0b3JhZ2UgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IHdyYXBwZXIgLSBQZXItbWVzc2FnZSBzZXNzaW9uLWNvbnRleHQgd3JhcHBlciwgb3IgbnVsbCB0byBkaXNhYmxlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldEFyb3VuZFJlcXVlc3Qod3JhcHBlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3QgPSB3cmFwcGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGFyb3VuZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gV2Vic29ja2V0IHNlc3Npb24gd3JhcHBlci5cbiAgICovXG4gIGdldFdlYnNvY2tldEFyb3VuZFJlcXVlc3QoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3RcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB3cmFwcGVyIGludm9rZWQgYXJvdW5kIGV2ZXJ5IGNvbnRyb2xsZXIgYWN0aW9uIOKAlCBib3RoXG4gICAqIEhUVFAgYW5kIFdTLWJvcm5lLiBSZWNlaXZlcyBge3JlcXVlc3QsIHJlc3BvbnNlLCBuZXh0fWAgYW5kIG11c3RcbiAgICogY2FsbCBgbmV4dCgpYCB0byBydW4gdGhlIGFjdGlvbi4gVXNlIGl0IGZvciBwZXItcmVxdWVzdCBjb250ZXh0XG4gICAqIGxpa2UgQXN5bmNMb2NhbFN0b3JhZ2Utc2NvcGVkIGxvY2FsZSBvciB0cmFjaW5nLlxuICAgKiBAcGFyYW0geygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSB3cmFwcGVyIC0gUGVyLWFjdGlvbiByZXF1ZXN0LWNvbnRleHQgd3JhcHBlciwgb3IgbnVsbCB0byBkaXNhYmxlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEFyb3VuZEFjdGlvbih3cmFwcGVyKSB7XG4gICAgdGhpcy5fYXJvdW5kQWN0aW9uID0gd3JhcHBlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFyb3VuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gLSBIVFRQIHJlcXVlc3Qgd3JhcHBlci5cbiAgICovXG4gIGdldEFyb3VuZEFjdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fYXJvdW5kQWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGFuIGlkZW50aXR5IHJlc29sdmVyIGNhbGxlZCBvbmNlIGF0IHBhdXNlIHRpbWUgYW5kIG9uY2VcbiAgICogYXQgcmVzdW1lIHRpbWUuIFRoZSByZXNvbHZlciByZWNlaXZlcyB0aGUgc2Vzc2lvbiBhbmQgcmV0dXJucyBhbnlcbiAgICogdmFsdWUgdGhhdCBpZGVudGlmaWVzIHRoZSBhdXRoZW50aWNhdGVkIGNhbGxlciDigJQgdHlwaWNhbGx5IGFcbiAgICogYHVzZXJJZGAgcmVhZCBmcm9tIHRoZSBzZXNzaW9uJ3MgdXBncmFkZS1yZXF1ZXN0IGNvb2tpZS4gVmVsb2Npb3VzXG4gICAqIGNhcHR1cmVzIHRoZSBwYXVzZS10aW1lIHZhbHVlIG9uIHRoZSBwYXVzZWQgc2Vzc2lvbiBhbmQgY29tcGFyZXNcbiAgICogaXQgdmlhIGA9PT1gIChvciBkZWVwLWVxdWFsaXR5IGZvciBwbGFpbiBvYmplY3RzKSB0byB0aGUgZnJlc2hcbiAgICogcmVzdW1lLXRpbWUgdmFsdWUuIElmIHRoZXkgZGlmZmVyLCB0aGUgcmVzdW1lIGlzIHJlamVjdGVkIHdpdGhcbiAgICogYHNlc3Npb24tZ29uZWAgYW5kIHRoZSBwYXVzZWQgc2Vzc2lvbiBpcyBkZXN0cm95ZWQgc28gYSBzaWduZWQtb3V0XG4gICAqIG9yIHJlLWF1dGhlbnRpY2F0ZWQgY2xpZW50IGNhbm5vdCByZWNsYWltIGFub3RoZXIgdXNlcidzIHN0YXRlLlxuICAgKlxuICAgKiBSZXR1cm4gYG51bGxgL2B1bmRlZmluZWRgIHRvIG1lYW4gXCJubyBpZGVudGl0eVwiIOKAlCByZXN1bWVzIHN0aWxsXG4gICAqIHN1Y2NlZWQgaWYgcGF1c2UgYW5kIHJlc3VtZSBib3RoIHJlc29sdmUgdG8gYSBudWxsaXNoIHZhbHVlLlxuICAgKiBAcGFyYW0geygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSByZXNvbHZlciAtIEF1dGhlbnRpY2F0ZWQtY2FsbGVyIGlkZW50aXR5IHJlc29sdmVyLCBvciBudWxsIHRvIGRpc2FibGUgaWRlbnRpdHkgY2hlY2tzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyKHJlc29sdmVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIgPSByZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGlkZW50aXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9IC0gVGhlIGNvbmZpZ3VyZWQgaWRlbnRpdHkgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgc2Vzc2lvbiBncmFjZSBzZWNvbmRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gc2Vjb25kcyAtIEdyYWNlIHBlcmlvZCBiZWZvcmUgYSBwYXVzZWQgc2Vzc2lvbiBleHBpcmVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMoc2Vjb25kcykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNlY29uZHMpIHx8IHNlY29uZHMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZ3JhY2Ugc2Vjb25kczogJHtzZWNvbmRzfWApXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyA9IHNlY29uZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgc2Vzc2lvbiBoZWFydGJlYXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBIZWFydGJlYXQgaW50ZXJ2YWwsIHdpdGggemVybyBkaXNhYmxpbmcgcmVhcGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyhzZWNvbmRzKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2Vjb25kcykgfHwgc2Vjb25kcyA8IDApIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBoZWFydGJlYXQgc2Vjb25kczogJHtzZWNvbmRzfWApXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgPSBzZWNvbmRzXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgYSBzZXNzaW9uIGludG8gdGhlIHBhdXNlZCByZWdpc3RyeSBhbmQgc3RhcnRzIHRoZSBncmFjZVxuICAgKiB0aW1lci4gV2hlbiB0aGUgdGltZXIgZmlyZXMsIHRoZSBzZXNzaW9uJ3MgcGVybWFuZW50IHRlYXJkb3duXG4gICAqIGhvb2sgaXMgaW52b2tlZC4gQ2FsbGVkIGJ5IHRoZSBzZXNzaW9uIGl0c2VsZiBmcm9tIGBfaGFuZGxlQ2xvc2VgXG4gICAqIHdoZW4gdGhlcmUgaXMgcmVzdW1hYmxlIHN0YXRlIChsaXZlIENvbm5lY3Rpb25zIC8gQ2hhbm5lbCBzdWJzKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0fSBzZXNzaW9uIC0gUmVzdW1hYmxlIHNlc3Npb24gdG8gcmV0YWluIGR1cmluZyBpdHMgZ3JhY2UgcGVyaW9kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9wYXVzZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbikge1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHNlc3Npb24uc2Vzc2lvbklkXG5cbiAgICBpZiAoIXNlc3Npb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiU2Vzc2lvbiBtdXN0IGhhdmUgYSBzZXNzaW9uSWQgdG8gYmUgcGF1c2VkXCIpXG4gICAgaWYgKHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmhhcyhzZXNzaW9uSWQpKSByZXR1cm5cblxuICAgIGNvbnN0IGdyYWNlTXMgPSB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzICogMTAwMFxuICAgIGNvbnN0IGdyYWNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2V4cGlyZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKVxuICAgIH0sIGdyYWNlTXMpXG5cbiAgICAvLyBEb24ndCBrZWVwIHRoZSBwcm9jZXNzIGFsaXZlIHB1cmVseSBmb3IgYSBwYXVzZWQgc2Vzc2lvbiB0aW1lci5cbiAgICBpZiAodHlwZW9mIGdyYWNlVGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgZ3JhY2VUaW1lci51bnJlZigpXG5cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5zZXQoc2Vzc2lvbklkLCB7c2Vzc2lvbiwgZ3JhY2VUaW1lciwgcGF1c2VkQXQ6IERhdGUubm93KCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvb2tzIHVwIGEgcGF1c2VkIHNlc3Npb24gYnkgaWQgKGRvZXMgTk9UIHJlbW92ZSBpdCDigJQgY2FsbGVyIGlzXG4gICAqIGV4cGVjdGVkIHRvIGNhbGwgYF9yZXN1bWVXZWJzb2NrZXRTZXNzaW9uYCB0byBjb21wbGV0ZSB0aGUgaGFuZG9mZikuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBQYXVzZWQgc2Vzc2lvbiB3aXRoIHRoZSByZXF1ZXN0ZWQgaWRlbnRpZmllciwgaWYgcHJlc2VudC5cbiAgICovXG4gIF9maW5kUGF1c2VkV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICByZXR1cm4gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCk/LnNlc3Npb24gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBwYXVzZWQgc2Vzc2lvbiBmcm9tIHRoZSByZWdpc3RyeSBhbmQgY2FuY2VscyBpdHMgZ3JhY2VcbiAgICogdGltZXIuIENhbGxlZCBvbiBzdWNjZXNzZnVsIHJlc3VtZSBoYW5kb2ZmIGFuZCBvbiBleHBsaWNpdFxuICAgKiBleHBpcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHRvIHJlbW92ZSBhbmQgY2FuY2VsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbGVhclBhdXNlZFdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICBjbGVhclRpbWVvdXQoZW50cnkuZ3JhY2VUaW1lcilcbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEdyYWNlLXRpbWVyIGNhbGxiYWNrLiBDYWxscyB0aGUgc2Vzc2lvbidzIHBlcm1hbmVudC10ZWFyZG93blxuICAgKiBob29rIGFuZCBkcm9wcyBpdCBmcm9tIHRoZSByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIgd2hvc2UgZ3JhY2UgcGVyaW9kIGV4cGlyZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2V4cGlyZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKVxuICAgIHRyeSB7XG4gICAgICBlbnRyeS5zZXNzaW9uLl9maW5hbGl6ZUdyYWNlRXhwaXJ5KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGZpbmFsaXplIGV4cGlyZWQgV1Mgc2Vzc2lvbiAke3Nlc3Npb25JZH1gLCBlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBicm9hZGNhc3QgdG8gY2hhbm5lbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgcmVjZWl2aW5nIHRoZSBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBWYWx1ZXMgdXNlZCB0byBtYXRjaCBlbGlnaWJsZSBzdWJzY3JpcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gQnJvYWRjYXN0IHBheWxvYWQgZGVsaXZlcmVkIHRvIG1hdGNoaW5nIHN1YnNjcmlwdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYnJvYWRjYXN0VG9DaGFubmVsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSkge1xuICAgIC8vIFdoZW4gQmVhY29uIGlzIGNvbm5lY3RlZCwgc2hpcCB0aGUgYnJvYWRjYXN0IG9udG8gdGhlIGJ1cy4gVGhlXG4gICAgLy8gZGFlbW9uIGVjaG9lcyBpdCBiYWNrIHRvIGV2ZXJ5IHBlZXIgKGluY2x1ZGluZyB0aGlzIG9uZSkgYW5kXG4gICAgLy8gZWFjaCBwZWVyJ3MgYF9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbmAgcGVyZm9ybXMgdGhlIHNhbWVcbiAgICAvLyBsb2NhbCBkZWxpdmVyeSBhcyB0aGUgc3luY2hyb25vdXMgcGF0aHMgYmVsb3cg4oCUIHNvIGV2ZXJ5XG4gICAgLy8gc3Vic2NyaWJlciwgaW4gYW55IHByb2Nlc3MsIHNlZXMgYnJvYWRjYXN0cyB2aWEgYSBzaW5nbGUgY29kZVxuICAgIC8vIHBhdGguXG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCAmJiB0aGlzLl9iZWFjb25DbGllbnQuaXNDb25uZWN0ZWQoKSkge1xuICAgICAgY29uc3Qgc2VudCA9IHRoaXMuX2JlYWNvbkNsaWVudC5wdWJsaXNoKHtjaGFubmVsOiBuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHl9KVxuXG4gICAgICBpZiAoc2VudCkgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gVjIgc3Vic2NyaXB0aW9ucyBsaXZlIHBlciB3b3JrZXItdGhyZWFkLiBXaGVuIHJ1bm5pbmcgaW5cbiAgICAvLyB3b3JrZXItdGhyZWFkIG1vZGUsIHRoZSBwdWJsaXNoZXIgcnVucyBlaXRoZXIgaW4gdGhlIG1haW5cbiAgICAvLyBwcm9jZXNzIChob3N0KSBvciBpbiBvbmUgb2YgdGhlIHdvcmtlcnM6XG4gICAgLy9cbiAgICAvLyAgLSBNYWluIHByb2Nlc3M6IGBfd2Vic29ja2V0RXZlbnRzYCBpcyB0aGUgaG9zdCBzaW5nbGV0b24gYW5kXG4gICAgLy8gICAgYGJyb2FkY2FzdFYyYCBmYW5zIG91dCB0byBldmVyeSB3b3JrZXIgZGlyZWN0bHkuXG4gICAgLy8gIC0gV29ya2VyOiBgX3dlYnNvY2tldEV2ZW50c2AgaGFzIGBwdWJsaXNoVjJCcm9hZGNhc3RgIHRoYXRcbiAgICAvLyAgICBwb3N0cyB0byBtYWluLCB3aGljaCB0aGVuIGZhbnMgb3V0IHRvIGV2ZXJ5IHdvcmtlci5cbiAgICAvL1xuICAgIC8vIEluLXByb2Nlc3MgbW9kZSBkb2Vzbid0IGluc3RhbGwgYSB3ZWJzb2NrZXQtZXZlbnRzIHRyYW5zcG9ydCxcbiAgICAvLyBzbyBmYWxsIHRocm91Z2ggdG8gdGhlIGxvY2FsIGRpc3BhdGNoLlxuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMih7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5wdWJsaXNoVjJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIiAmJiB3ZWJzb2NrZXRFdmVudHMucGFyZW50UG9ydCkge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLnB1Ymxpc2hWMkJyb2FkY2FzdCh7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYWxsIHBlbmRpbmcgYnJvYWRjYXN0IG9wZXJhdGlvbnMgKGluY2x1ZGluZyBldmVudC1sb2dcbiAgICogcGVyc2lzdGVuY2UpLiBDYWxsIHRoaXMgYWZ0ZXIgYGJyb2FkY2FzdFRvQ2hhbm5lbGAgd2hlbiB5b3UgbmVlZFxuICAgKiB0aGUgZXZlbnQgdG8gYmUgcGVyc2lzdGVkIGJlZm9yZSBjb250aW51aW5nIChlLmcuIGJlZm9yZVxuICAgKiByZXNwb25kaW5nIHRvIGFuIEhUVFAgcmVxdWVzdCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpIHtcbiAgICAvKipcbiAgICAgKiBXZWJzb2NrZXQgZXZlbnRzLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBjb25zdCB3ZWJzb2NrZXRFdmVudHMgPSB0aGlzLl93ZWJzb2NrZXRFdmVudHNcblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIC8vIERyYWluIHRoZSBob3N0L3dvcmtlciBwdWJsaXNoIHF1ZXVlcyAoaW5jbHVkaW5nIGV2ZW50LWxvZyBwZXJzaXN0ZW5jZSlcbiAgICAgIC8vIGJlZm9yZSBkcmFpbmluZyBsb2NhbCBkZWxpdmVyaWVzLCBiZWNhdXNlIGhvc3QgZGlzcGF0Y2ggbGF1bmNoZXMgdGhlXG4gICAgICAvLyBsb2NhbCBkZWxpdmVyaWVzIHN5bmNocm9ub3VzbHkgYW5kIHRoZXkgbXVzdCBiZSBwYXJ0IG9mIHRoZSBzbmFwc2hvdC5cbiAgICAgIGF3YWl0IHdlYnNvY2tldEV2ZW50cy5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9hd2FpdExvY2FsQnJvYWRjYXN0RGVsaXZlcmllcygpXG4gIH1cblxuICAvKipcbiAgICogTG9jYWwgKHBlci13b3JrZXIpIGNoYW5uZWwgYnJvYWRjYXN0IGRpc3BhdGNoLiBDYWxsZWQgZWl0aGVyXG4gICAqIGRpcmVjdGx5IChpbi1wcm9jZXNzIG1vZGUpIG9yIGJ5IHRoZSB3b3JrZXIgdGhyZWFkIGFmdGVyIHRoZVxuICAgKiBtYWluLXByb2Nlc3MgZmFuLW91dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBQYXJhbXMgcGFzc2VkIHRvIGVhY2ggc3Vic2NyaXB0aW9uJ3MgYG1hdGNoZXMoKWAuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBNZXNzYWdlIGJvZHkgZGVsaXZlcmVkIHZpYSBgc2VuZE1lc3NhZ2UoKWAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEgZm9yIHJlcGxheSB0cmFja2luZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBidWNrZXQpIHtcbiAgICAgIGlmIChzdWJzY3JpcHRpb24uaXNDbG9zZWQoKSkgY29udGludWVcblxuICAgICAgbGV0IG1hdGNoZXNcblxuICAgICAgdHJ5IHtcbiAgICAgICAgbWF0Y2hlcyA9IHN1YnNjcmlwdGlvbi5tYXRjaGVzKGJyb2FkY2FzdFBhcmFtcyB8fCB7fSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIEEgYnJva2VuIGBtYXRjaGVzKClgIG9uIG9uZSBzdWJzY3JpYmVyIG11c3Qgbm90IHBvaXNvbiB0aGVcbiAgICAgICAgLy8gYnJvYWRjYXN0IHRvIG90aGVyIHN1YnNjcmliZXJzLiBTa2lwIGFuZCBjb250aW51ZS5cbiAgICAgICAgY29uc29sZS5lcnJvcihgYnJvYWRjYXN0VG9DaGFubmVsOiAke25hbWV9IHN1YnNjcmlwdGlvbiAke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH0gbWF0Y2hlcygpIHRocmV3YCwgZXJyb3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWF0Y2hlcykgY29udGludWVcblxuICAgICAgY29uc3QgZGVsaXZlcnlNZXRhZGF0YSA9IHtcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICAuLi4obWV0YT8uZXZlbnRJZCA/IHtldmVudElkOiBtZXRhLmV2ZW50SWR9IDoge30pXG4gICAgICB9XG4gICAgICBjb25zdCBwcmV2aW91c0RlbGl2ZXJ5ID0gdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLmdldChzdWJzY3JpcHRpb24pXG4gICAgICBjb25zdCBkZWxpdmVyeSA9IHRoaXMud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb25Db250ZXh0cygoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIChwcmV2aW91c0RlbGl2ZXJ5IHx8IFByb21pc2UucmVzb2x2ZSgpKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fZGVsaXZlcldlYnNvY2tldENoYW5uZWxCcm9hZGNhc3Qoc3Vic2NyaXB0aW9uLCBib2R5LCBkZWxpdmVyeU1ldGFkYXRhKSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgYnJvYWRjYXN0VG9DaGFubmVsOiAke25hbWV9IHN1YnNjcmlwdGlvbiAke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH0gZGVsaXZlckJyb2FkY2FzdCB0aHJld2AsIGVycm9yKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5zZXQoc3Vic2NyaXB0aW9uLCBkZWxpdmVyeSlcblxuICAgICAgLy8gS2VlcCB0aGUgZmlyZS1hbmQtZm9yZ2V0IGRlbGl2ZXJ5IChuZXZlciBhd2FpdGVkIGF0IGJyb2FkY2FzdCB0aW1lKSBidXRcbiAgICAgIC8vIHRyYWNrIGl0IHNvIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBjYW4gZHJhaW4gaXQgYmVmb3JlIHNldHRsaW5nLiBSZW1vdmVcbiAgICAgIC8vIG9uIHNldHRsZTsgdGhlIGZhaWx1cmUgaGFuZGxlciBhbHNvIHNhdGlzZmllcyB0aGUgcHJvbWlzZSBzbyBhIHJlamVjdGVkXG4gICAgICAvLyBkZWxpdmVyeSBuZXZlciBiZWNvbWVzIGFuIHVuaGFuZGxlZCByZWplY3Rpb24uXG4gICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMuYWRkKGRlbGl2ZXJ5KVxuXG4gICAgICAvKipcbiAgICAgICAqIFJlbW92ZXMgYSBzZXR0bGVkIGRlbGl2ZXJ5IGZyb20gbG9jYWwgdHJhY2tpbmcuXG4gICAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgICAqL1xuICAgICAgY29uc3QgZm9yZ2V0RGVsaXZlcnkgPSAoKSA9PiB7XG4gICAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcy5kZWxldGUoZGVsaXZlcnkpXG4gICAgICAgIGlmICh0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZ2V0KHN1YnNjcmlwdGlvbikgPT09IGRlbGl2ZXJ5KSB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZGVsZXRlKHN1YnNjcmlwdGlvbilcbiAgICAgIH1cblxuICAgICAgZGVsaXZlcnkudGhlbihmb3JnZXREZWxpdmVyeSwgZm9yZ2V0RGVsaXZlcnkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhIHNuYXBzaG90IG9mIHRoZSBpbi1mbGlnaHQgbG9jYWwgKHBlci1wcm9jZXNzKSB3ZWJzb2NrZXQgY2hhbm5lbFxuICAgKiBicm9hZGNhc3QgZGVsaXZlcmllcy4gQ2FsbGVkIGZyb20gYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGFmdGVyIHRoZSBob3N0XG4gICAqIHB1Ymxpc2ggcXVldWVzIGRyYWluLCBzbyBldmVyeSBkZWxpdmVyeSB0aG9zZSBxdWV1ZXMgbGF1bmNoZWQgaXMgY2FwdHVyZWQuXG4gICAqIE5ldyBkZWxpdmVyaWVzIGVucXVldWVkIGFmdGVyIHRoZSBzbmFwc2hvdCBhcmUgbm90IGF3YWl0ZWQuIEluZGl2aWR1YWxcbiAgICogZGVsaXZlcnkgZXJyb3JzIGFyZSBpc29sYXRlZCBwZXIgc3Vic2NyaWJlciDigJQgdGhlIGRlbGl2ZXJ5IGNoYWluIGFscmVhZHlcbiAgICogbG9ncyB0aGVtIGFuZCByZXNvbHZlcyDigJQgc28gYSBzbmFwc2hvdHRlZCByZWplY3Rpb24gbmV2ZXIgZmFpbHMgdGhpcyBiYXJyaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hd2FpdExvY2FsQnJvYWRjYXN0RGVsaXZlcmllcygpIHtcbiAgICBjb25zdCBzbmFwc2hvdCA9IFsuLi50aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXNdXG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc25hcHNob3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIHdlYnNvY2tldCBjaGFubmVsIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIENoYW5uZWwgc3Vic2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gbWV0YSAtIEJyb2FkY2FzdCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSBCcm9hZGNhc3QgZGVsaXZlcnkgcmVzdWx0LlxuICAgKi9cbiAgX2RlbGl2ZXJXZWJzb2NrZXRDaGFubmVsQnJvYWRjYXN0KHN1YnNjcmlwdGlvbiwgYm9keSwgbWV0YSkge1xuICAgIGlmICh0eXBlb2Ygc3Vic2NyaXB0aW9uLmRlbGl2ZXJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpXG4gICAgfVxuXG4gICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldENoYW5uZWxSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBYmlsaXR5IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IFthcmdzLnJlcXVlc3RdIC0gUmVxdWVzdCBvYmplY3QuIEFic2VudCBmb3Igd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9ucyByZXNvbHZlZCBmcm9tIHN1YnNjcmliZSBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MucmVzcG9uc2VdIC0gUmVzcG9uc2Ugb2JqZWN0LiBBYnNlbnQgb3V0c2lkZSBIVFRQIHJlcXVlc3QgaGFuZGxpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVkIGFiaWxpdHkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQWJpbGl0eSh7cGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0QWJpbGl0eVJlc29sdmVyKClcblxuICAgIGlmIChyZXNvbHZlcikge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlcih7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pXG5cbiAgICAgIGlmIChyZXNvbHZlZCkgcmV0dXJuIHJlc29sdmVkXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VzID0gdGhpcy5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICAgIGlmIChyZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIHJldHVybiBuZXcgQWJpbGl0eSh7XG4gICAgICBjb250ZXh0OiB7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0sXG4gICAgICByZXNvdXJjZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9maWxlcyBhbiBhcHBsaWNhdGlvbi1kZWZpbmVkIHRlc3QgYWN0aXZpdHkgd2hlbiBhbiBvcHQtaW4gdGVzdCBwcm9maWxlXG4gICAqIGNvbnRleHQgaXMgYWN0aXZlLiBUaGUgY2FsbGJhY2sgYWx3YXlzIHJ1bnMsIGluY2x1ZGluZyBvdXRzaWRlIHByb2ZpbGluZy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb3ctY2FyZGluYWxpdHkgYWN0aXZpdHkgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIEFjdGl2aXR5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBwcm9maWxlVGVzdEFjdGl2aXR5KG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgdmFsaWRhdGVkTmFtZSA9IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZShuYW1lKVxuXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFRlc3RQcm9maWxlQ29udGV4dCgpXG5cbiAgICBpZiAoIWNvbnRleHQpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgY29udGV4dC5wcm9maWxlci5wcm9maWxlQWN0aXZpdHkoY29udGV4dCwgdmFsaWRhdGVkTmFtZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGFiaWxpdHkgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudEFiaWxpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudEFiaWxpdHkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgcmVxdWVzdCB0aW1pbmcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgcmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKi9cbiAgZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ3VycmVudCB0ZW5hbnQgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlbmFudCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVuYW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVGVuYW50IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7e2NoYW5uZWw6IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gW2FyZ3Muc3Vic2NyaXB0aW9uXSAtIFN1YnNjcmlwdGlvbiBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVUZW5hbnQoe3BhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2UsIHN1YnNjcmlwdGlvbn0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0VGVuYW50UmVzb2x2ZXIoKVxuXG4gICAgaWYgKCFyZXNvbHZlcikgcmV0dXJuXG5cbiAgICByZXR1cm4gYXdhaXQgcmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIHBhcmFtcyxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIHN1YnNjcmlwdGlvblxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXJyb3IgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiZXZlbnRlbWl0dGVyM1wiKS5FdmVudEVtaXR0ZXJ9IC0gRnJhbWV3b3JrIGVycm9yIGV2ZW50cyBlbWl0dGVyLlxuICAgKi9cbiAgZ2V0RXJyb3JFdmVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogRnJhbWV3b3JrIHRlbGVtZXRyeSBlbWl0dGVyLiBUZWxlbWV0cnkgcmVwb3J0cyBtZWFzdXJlbWVudHMg4oCUIGxvY2sgY29udGVudGlvbixcbiAgICogc2xvdyBxdWVyaWVzLCBxdWV1ZSBkZXB0aCDigJQgdGhhdCBhcmUgd29ydGggb2JzZXJ2aW5nIGJ1dCBhcmUgbm90IGZhaWx1cmVzLiBJdCBpc1xuICAgKiBkZWxpYmVyYXRlbHkgc2VwYXJhdGUgZnJvbSBgZ2V0RXJyb3JFdmVudHMoKWA6IGEgYnVnIHJlcG9ydGVyIHN1YnNjcmliZXMgdG8gdGhlXG4gICAqIGVycm9yIGNoYW5uZWwgb24gdGhlIHByb21pc2UgdGhhdCBldmVyeSBwYXlsb2FkIHRoZXJlIGNhcnJpZXMgYSB0aHJvd24gdmFsdWUsIGFuZFxuICAgKiBhIGNvbnRlbnRpb24gbWVhc3VyZW1lbnQgZW1pdHRlZCBhcyBgZnJhbWV3b3JrLWVycm9yYCB0dXJucyBpbnRvIGEgYnVnIHJlcG9ydCBvblxuICAgKiBldmVyeSBvY2N1cnJlbmNlIGluc3RlYWQgb2YgYSBtZXRyaWMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJldmVudGVtaXR0ZXIzXCIpLkV2ZW50RW1pdHRlcn0gLSBGcmFtZXdvcmsgdGVsZW1ldHJ5IGV2ZW50cyBlbWl0dGVyLlxuICAgKi9cbiAgZ2V0VGVsZW1ldHJ5RXZlbnRzKCkge1xuICAgIHJldHVybiB0aGlzLl90ZWxlbWV0cnlFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSByZXBvcnRlciB0aGF0IGNhbiBhZGQgY2xpZW50LXNhZmUgbWV0YWRhdGEgdG8gZnJvbnRlbmQtbW9kZWwgZXJyb3IgcGF5bG9hZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyVHlwZX0gcmVwb3J0ZXIgLSBSZXBvcnRlciBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRDbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcihyZXBvcnRlcikge1xuICAgIHRoaXMuX2NsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVycy5wdXNoKHJlcG9ydGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXJlZCBjbGllbnQgZXJyb3IgcGF5bG9hZCByZXBvcnRlcnMuXG4gICAqIEBwYXJhbSB7e2NvbnRleHQ6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRDb250ZXh0LCBlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gUmVwb3J0ZXIgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZD59IC0gTWVyZ2VkIGNsaWVudC1zYWZlIHJlcG9ydGVyIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBjbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihhcmdzKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkfSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSB0aGlzLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZXF1ZXN0VGltaW5nID8gcmVxdWVzdFRpbWluZy5nZXRMb2dTZW5zaXRpdmVWYWx1ZXMoKSA6IG5ldyBTZXQoKVxuICAgIGNvbnN0IGRldGFpbHMgPSByZXF1ZXN0RGV0YWlscyhhcmdzLnJlcXVlc3QsIHtyZWRhY3RvcjogdGhpcy5nZXRMb2dSZWRhY3RvcigpLCBzZW5zaXRpdmVWYWx1ZXN9KVxuXG4gICAgZm9yIChjb25zdCByZXBvcnRlciBvZiB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMpIHtcbiAgICAgIGNvbnN0IHJlcG9ydGVyUGF5bG9hZCA9IGF3YWl0IHJlcG9ydGVyKHtcbiAgICAgICAgLi4uYXJncyxcbiAgICAgICAgcmVxdWVzdERldGFpbHM6IGRldGFpbHNcbiAgICAgIH0pXG5cbiAgICAgIGlmIChyZXBvcnRlclBheWxvYWQgJiYgdHlwZW9mIHJlcG9ydGVyUGF5bG9hZCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBPYmplY3QuYXNzaWduKHBheWxvYWQsIHJlcG9ydGVyUGF5bG9hZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHRlc3QgYXR0ZW1wdCBpbiBhIHJldm9jYWJsZSBkYXRhYmFzZS1hY2Nlc3MgY29udGV4dC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7cmV2b2tlZDogYm9vbGVhbn19IHNjb3BlIC0gQXR0ZW1wdC1vd25lZCBhY2Nlc3Mgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gVCB8IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQXR0ZW1wdCB3b3JrLlxuICAgKiBAcmV0dXJucyB7VCB8IFByb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHNjb3BlLCBjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJzaXN0ZW50IGZyYW1ld29yayB3b3JrIHdpdGhvdXQgaW5oZXJpdGluZyBhIHRlc3QgYXR0ZW1wdCdzIHJldm9jYWJsZSBkYXRhYmFzZS1hY2Nlc3Mgc2NvcGUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVCB8IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGVyc2lzdGVudCB3b3JrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aG91dEN1cnJlbnRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHVuZGVmaW5lZCwgY2FsbGJhY2spXG4gIH1cblxuICAvKiogVGhyb3dzIHdoZW4gYSB0aW1lZC1vdXQgdGVzdCBhdHRlbXB0IHRyaWVzIHRvIHN0YXJ0IG1vcmUgZGF0YWJhc2Ugd29yay4gKi9cbiAgYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKCkge1xuICAgIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuYXNzZXJ0VGVzdERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGNvbm5lY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhDb25uZWN0aW9ucyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgY29uc3Qge1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIG5hbWVcbiAgICB9ID0gcmVzb2x2ZVdpdGhDb25uZWN0aW9uc0FyZ3Mob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrLCBcIkNvbmZpZ3VyYXRpb24ud2l0aENvbm5lY3Rpb25zXCIpXG5cbiAgICBpZiAoIWFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJ3aXRoQ29ubmVjdGlvbnMgcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgLyoqXG4gICAgICogRGJzLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgY29uc3QgZGJzID0ge31cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYnMsXG4gICAgICBpZGVudGlmaWVyczogZGF0YWJhc2VJZGVudGlmaWVycyA/PyB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSxcbiAgICAgIG5hbWUsXG4gICAgICBzdGFja0xhYmVsOiBcIndpdGhDb25uZWN0aW9uc1wiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cGxpY2l0IG1vZGVsIHdvcmsgaW4gYSB0cmFuc2FjdGlvbiBwaW5uZWQgdG8gb25lIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBuYW1lPzogc3RyaW5nfX0gb3B0aW9ucyAtIE9wZXJhdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IERhdGFiYXNlT3BlcmF0aW9uKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aFRyYW5zYWN0aW9uKHtkYXRhYmFzZUlkZW50aWZpZXIsIG5hbWUgPSBcIkNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uXCIsIC4uLnJlc3RBcmdzfSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvbiByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG4gICAgaWYgKCF0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKS5pbmNsdWRlcyhkYXRhYmFzZUlkZW50aWZpZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3IgaW5hY3RpdmUgZGF0YWJhc2UgaWRlbnRpZmllcjogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnQgPSB0aGlzLmdldEN1cnJlbnRUZW5hbnQoKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuXG4gICAgcmV0dXJuIGF3YWl0IHBvb2wud2l0aE9wZXJhdGlvbkNvbm5lY3Rpb24oe25hbWV9LCBhc3luYyAoY29ubmVjdGlvbiwgb3duZXIpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IG5ldyBEYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgY29uZmlndXJhdGlvblJldXNlS2V5OiBwb29sLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbiksXG4gICAgICAgIGNvbm5lY3Rpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgb3duZXIsXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IG9wZXJhdGlvbi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24pXG4gICAgICAgIH0pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBvcGVyYXRpb24uY29tcGxldGUoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBsaWNpdCBtb2RlbCB3b3JrIG9uIG9uZSBjb25uZWN0aW9uIHNlbGVjdGVkIGZyb20gYSBjYXB0dXJlZCBwaHlzaWNhbFxuICAgKiBkYXRhYmFzZSBjb25maWd1cmF0aW9uLiBObyBhbWJpZW50IHRlbmFudCB2YWx1ZSBpcyByZWFkIGR1cmluZyBjaGVja291dCBvclxuICAgKiBleGVjdXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGUsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBuYW1lPzogc3RyaW5nLCBzY2hlbWFHZW5lcmF0aW9uPzogc3RyaW5nLCB0ZW5hbnQ/OiBvYmplY3R9fSBvcHRpb25zIC0gQ2FwdHVyZWQgb3BlcmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogRGF0YWJhc2VPcGVyYXRpb24pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoRGF0YWJhc2VPcGVyYXRpb24oe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lID0gXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvblwiLCBzY2hlbWFHZW5lcmF0aW9uLCB0ZW5hbnQsIC4uLnJlc3RBcmdzfSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlQ29uZmlndXJhdGlvblwiKVxuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25SZXVzZUtleSA9IHBvb2wuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbilcblxuICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhDYXB0dXJlZE9wZXJhdGlvbkNvbm5lY3Rpb24oe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgbmFtZX0sIGFzeW5jIChjb25uZWN0aW9uLCBvd25lcikgPT4ge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gbmV3IERhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgICBjb25maWd1cmF0aW9uUmV1c2VLZXksXG4gICAgICAgIGNvbm5lY3Rpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgZW5mb3JjZUN1cnJlbnRUZW5hbnRSZXVzZUtleTogZmFsc2UsXG4gICAgICAgIG93bmVyLFxuICAgICAgICBzY2hlbWFHZW5lcmF0aW9uLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBvcGVyYXRpb24uY29tcGxldGUoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYWxsYmFjayB3aXRoIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGZvciB0aGUgcmVxdWVzdGVkIGlkZW50aWZpZXJzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tjYWxsYmFjazogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+LCBkYnM6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+LCBpZGVudGlmaWVyczogc3RyaW5nW10sIG5hbWU6IHN0cmluZywgc3RhY2tMYWJlbDogc3RyaW5nfX0gYXJncyAtIENvbm5lY3Rpb24gc2NvcGUgZGV0YWlscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERhdGFiYXNlSWRlbnRpZmllckNvbm5lY3Rpb25zKHtjYWxsYmFjaywgZGJzLCBpZGVudGlmaWVycywgbmFtZSwgc3RhY2tMYWJlbH0pIHtcbiAgICBjb25zdCBzdGFjayA9IEVycm9yKCkuc3RhY2tcbiAgICBjb25zdCBhY3R1YWxDYWxsYmFjayA9IGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIHJldHVybiBhd2FpdCB3aXRoVHJhY2tlZFN0YWNrKHN0YWNrIHx8IHN0YWNrTGFiZWwsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRicylcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVuIHJlcXVlc3QuXG4gICAgICogQHR5cGUgeygpID0+IFByb21pc2U8VD59ICovXG4gICAgbGV0IHJ1blJlcXVlc3QgPSBhY3R1YWxDYWxsYmFja1xuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGlkZW50aWZpZXJzKSB7XG4gICAgICBsZXQgYWN0dWFsUnVuUmVxdWVzdCA9IHJ1blJlcXVlc3RcblxuICAgICAgY29uc3QgbmV4dFJ1blJlcXVlc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS53aXRoQ29ubmVjdGlvbih7bmFtZX0sIGFzeW5jIChkYikgPT4ge1xuICAgICAgICAgIGRic1tpZGVudGlmaWVyXSA9IGRiXG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgYWN0dWFsUnVuUmVxdWVzdCgpXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJ1blJlcXVlc3QgPSBuZXh0UnVuUmVxdWVzdFxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5SZXF1ZXN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbZGF0YWJhc2VJZGVudGlmaWVyc10gLSBEYXRhYmFzZSBpZGVudGlmaWVycyB0byBpbmNsdWRlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IEEgbWFwIG9mIGRhdGFiYXNlIGNvbm5lY3Rpb25zIHdpdGggaWRlbnRpZmllciBhcyBrZXlcbiAgICovXG4gIGdldEN1cnJlbnRDb25uZWN0aW9ucyhkYXRhYmFzZUlkZW50aWZpZXJzID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgLyoqXG4gICAgICogRGJzLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgY29uc3QgZGJzID0ge31cblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBkYXRhYmFzZUlkZW50aWZpZXJzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcbiAgICAgICAgY29uc3QgY3VycmVudENvbm5lY3Rpb24gPSBwb29sLmdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbiA/IHBvb2wuZ2V0Q3VycmVudENvbnRleHRDb25uZWN0aW9uKCkgOiBwb29sLmdldEN1cnJlbnRDb25uZWN0aW9uKClcblxuICAgICAgICBpZiAoY3VycmVudENvbm5lY3Rpb24gJiYgKCFwb29sLmNvbm5lY3Rpb25NYXRjaGVzQ3VycmVudENvbmZpZ3VyYXRpb24gfHwgcG9vbC5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uKGN1cnJlbnRDb25uZWN0aW9uKSkpIHtcbiAgICAgICAgICBkYnNbaWRlbnRpZmllcl0gPSBjdXJyZW50Q29ubmVjdGlvblxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAodGhpcy5pc01pc3NpbmdDdXJyZW50Q29ubmVjdGlvbkVycm9yKGVycm9yKSkge1xuICAgICAgICAgIC8vIElnbm9yZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRob3V0IGN1cnJlbnQgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biB3aXRob3V0IGluaGVyaXRlZCBEQiBjb25uZWN0aW9uIGNvbnRleHRzLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICB3aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0cyhjYWxsYmFjaykge1xuICAgIGxldCBydW5DYWxsYmFjayA9ICgpID0+IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcnMoY2FsbGJhY2spXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG4gICAgICBjb25zdCBwcmV2aW91c1J1bkNhbGxiYWNrID0gcnVuQ2FsbGJhY2tcblxuICAgICAgcnVuQ2FsbGJhY2sgPSAoKSA9PiBwb29sLndpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQocHJldmlvdXNSdW5DYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuQ2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBpbnNpZGUgZXZlcnkgcG9vbCdzIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gY29udGV4dCAoYSBuby1vcCBmb3JcbiAgICogcG9vbHMgd2l0aG91dCBvbmUpLiBJbi1wcm9jZXNzIHJlcXVlc3QgaGFuZGxpbmcgaXMgd3JhcHBlZCBpbiB0aGlzIHNvIGEgcmVxdWVzdFxuICAgKiBydW5zIG9uIHRoZSBzYW1lIGNvbm5lY3Rpb24g4oCUIGFuZCBvcGVuIHRyYW5zYWN0aW9uIOKAlCBhcyB0aGUgdGVzdCB0aGF0IGlzc3VlZCBpdCxcbiAgICogbGV0dGluZyByZXF1ZXN0IHNwZWNzIGNsZWFuIHVwIGJ5IHJvbGxpbmcgYmFjayBpbnN0ZWFkIG9mIHRydW5jYXRpbmcuIE91dHNpZGVcbiAgICogdGVzdHMgbm8gc2hhcmVkIGNvbm5lY3Rpb24gaXMgc2V0LCBzbyB0aGlzIGp1c3QgcnVucyB0aGUgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gaW5zaWRlIHRoZSBzaGFyZWQgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoY2FsbGJhY2spIHtcbiAgICBsZXQgcnVuQ2FsbGJhY2sgPSBjYWxsYmFja1xuXG4gICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuICAgICAgY29uc3QgcHJldmlvdXNSdW5DYWxsYmFjayA9IHJ1bkNhbGxiYWNrXG5cbiAgICAgIHJ1bkNhbGxiYWNrID0gKCkgPT4gcG9vbC5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb24ocHJldmlvdXNSdW5DYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuQ2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbWlzc2luZyBjdXJyZW50IGNvbm5lY3Rpb24gZXJyb3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRXJyb3IgdGhyb3duIHdoaWxlIGxvb2tpbmcgdXAgdGhlIGN1cnJlbnQgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZXJyb3IgbWVhbnMgbm8gY3VycmVudCBjb25uZWN0aW9uIGlzIGF2YWlsYWJsZS5cbiAgICovXG4gIGlzTWlzc2luZ0N1cnJlbnRDb25uZWN0aW9uRXJyb3IoZXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiAoXG4gICAgICBlcnJvci5tZXNzYWdlID09IFwiSUQgaGFzbid0IGJlZW4gc2V0IGZvciB0aGlzIGFzeW5jIGNvbnRleHRcIiB8fFxuICAgICAgZXJyb3IubWVzc2FnZSA9PSBcIkEgY29ubmVjdGlvbiBoYXNuJ3QgYmVlbiBtYWRlIHlldFwiIHx8XG4gICAgICBlcnJvci5tZXNzYWdlLnN0YXJ0c1dpdGgoXCJObyBhc3luYyBjb250ZXh0IHNldCBmb3IgZGF0YWJhc2UgY29ubmVjdGlvblwiKSB8fFxuICAgICAgZXJyb3IubWVzc2FnZS5zdGFydHNXaXRoKFwiQ29ubmVjdGlvbiBcIikgJiYgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhcImRvZXNuJ3QgZXhpc3QgYW55IG1vcmVcIilcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgY29ubmVjdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgfCBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ29ubmVjdGlvbnMob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBuYW1lXG4gICAgfSA9IHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgXCJDb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zXCIpXG5cbiAgICBpZiAoIWFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJlbnN1cmVDb25uZWN0aW9ucyByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICBjb25zdCByZXF1ZXN0ZWRJZGVudGlmaWVycyA9IGRhdGFiYXNlSWRlbnRpZmllcnMgPz8gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKClcbiAgICBjb25zdCBkYnMgPSB0aGlzLmdldEN1cnJlbnRDb25uZWN0aW9ucyhyZXF1ZXN0ZWRJZGVudGlmaWVycylcbiAgICBjb25zdCBtaXNzaW5nSWRlbnRpZmllcnMgPSByZXF1ZXN0ZWRJZGVudGlmaWVycy5maWx0ZXIoKGlkZW50aWZpZXIpID0+IHtcbiAgICAgIGlmICghZGJzW2lkZW50aWZpZXJdKSByZXR1cm4gdHJ1ZVxuXG4gICAgICByZXR1cm4gIXRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmhhc0N1cnJlbnRDb25uZWN0aW9uQ29udGV4dCgpXG4gICAgfSlcblxuICAgIGlmIChtaXNzaW5nSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gYXdhaXQgYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2soZGJzKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYnMsXG4gICAgICBpZGVudGlmaWVyczogbWlzc2luZ0lkZW50aWZpZXJzLFxuICAgICAgbmFtZSxcbiAgICAgIHN0YWNrTGFiZWw6IFwiZW5zdXJlQ29ubmVjdGlvbnNcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGBhZHZpc29yeUxvY2tzYCBjb25maWd1cmF0aW9uIGJsb2NrIChTVEMtMjEwIGRlc2lnbiDCpzEwKS5cbiAgICogRnVsbCBiYWNrd2FyZCBjb21wYXRpYmlsaXR5OiBhbiBhcHAgdGhhdCBjb25maWd1cmVzIG5vdGhpbmcgZ2V0cyB0b2RheSdzXG4gICAqIGRyaXZlci1uYXRpdmUtb25seSBiZWhhdmlvciDigJQgdGhlIGZpbGUgYmFja2VuZCBpcyAqKmRpc2FibGVkIGJ5IGRlZmF1bHQqKlxuICAgKiBhbmQgb25seSBldmVyIHNlbGVjdGFibGUgYnkgZXhwbGljaXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3tiYWNrZW5kczoge2ZpbGU6IHtkaXJlY3Rvcnk/OiBzdHJpbmcsIGVuYWJsZWQ6IGJvb2xlYW4sIGxlYXNlTXM6IG51bWJlciwgcmVuZXdJbnRlcnZhbE1zOiBudW1iZXJ9LCBsb2NrU2VydmVyOiB7YXV0aFRva2VuOiBzdHJpbmcsIGNvbm5lY3RUaW1lb3V0TXM6IG51bWJlciwgZW5hYmxlZDogYm9vbGVhbiwgbGVhc2VNczogbnVtYmVyLCByZXByb2JlQ29vbGRvd25NczogbnVtYmVyLCB1cmw6IHN0cmluZ319LCBwb2xpY3k6IGltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiKS5BZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5RW50cnlbXX19IC0gQWR2aXNvcnktbG9jayBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdHMgYXBwbGllZC5cbiAgICovXG4gIGdldEFkdmlzb3J5TG9ja0NvbmZpZygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYWR2aXNvcnlMb2NrcyB8fCB7fVxuICAgIGNvbnN0IGZpbGVDb25maWd1cmVkID0gY29uZmlndXJlZC5iYWNrZW5kcz8uZmlsZSB8fCB7fVxuICAgIGNvbnN0IGxvY2tTZXJ2ZXJDb25maWd1cmVkID0gY29uZmlndXJlZC5iYWNrZW5kcz8ubG9ja1NlcnZlciB8fCB7fVxuICAgIGNvbnN0IGVudkhvc3QgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfTE9DS19TRVJWRVJfSE9TVFxuICAgIGNvbnN0IGVudlBvcnRSYXcgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfTE9DS19TRVJWRVJfUE9SVFxuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgbG9ja1NlcnZlckhvc3QgPSBsb2NrU2VydmVyQ29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3RcbiAgICBjb25zdCBsb2NrU2VydmVyUG9ydCA9IHR5cGVvZiBsb2NrU2VydmVyQ29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGxvY2tTZXJ2ZXJDb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiAzMDA2KVxuICAgIGNvbnN0IGxvY2tTZXJ2ZXJVcmwgPSBsb2NrU2VydmVyQ29uZmlndXJlZC51cmxcbiAgICAgIHx8IGB3czovLyR7bG9ja1NlcnZlckhvc3QgfHwgXCIxMjcuMC4wLjFcIn06JHtsb2NrU2VydmVyUG9ydH0vd2Vic29ja2V0YFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tlbmRzOiB7XG4gICAgICAgIGZpbGU6IHtcbiAgICAgICAgICBkaXJlY3Rvcnk6IGZpbGVDb25maWd1cmVkLmRpcmVjdG9yeSxcbiAgICAgICAgICBlbmFibGVkOiBmaWxlQ29uZmlndXJlZC5lbmFibGVkID09PSB0cnVlLFxuICAgICAgICAgIGxlYXNlTXM6IHR5cGVvZiBmaWxlQ29uZmlndXJlZC5sZWFzZU1zID09PSBcIm51bWJlclwiID8gZmlsZUNvbmZpZ3VyZWQubGVhc2VNcyA6IDMwXzAwMCxcbiAgICAgICAgICByZW5ld0ludGVydmFsTXM6IHR5cGVvZiBmaWxlQ29uZmlndXJlZC5yZW5ld0ludGVydmFsTXMgPT09IFwibnVtYmVyXCIgPyBmaWxlQ29uZmlndXJlZC5yZW5ld0ludGVydmFsTXMgOiAxMF8wMDBcbiAgICAgICAgfSxcbiAgICAgICAgbG9ja1NlcnZlcjoge1xuICAgICAgICAgIC8vIEVuYWJsZWQgb25seSBieSBleHBsaWNpdCBjb25maWd1cmF0aW9uIG9yIGFuIGV4cGxpY2l0IGVudiBwYWlyLCBzb1xuICAgICAgICAgIC8vIGFuIGFwcCB0aGF0IGNvbmZpZ3VyZXMgbm90aGluZyBrZWVwcyB0b2RheSdzIGRyaXZlci1uYXRpdmUgYmVoYXZpb3IuXG4gICAgICAgICAgYXV0aFRva2VuOiB0eXBlb2YgbG9ja1NlcnZlckNvbmZpZ3VyZWQuYXV0aFRva2VuID09PSBcInN0cmluZ1wiID8gbG9ja1NlcnZlckNvbmZpZ3VyZWQuYXV0aFRva2VuIDogXCJcIixcbiAgICAgICAgICBjb25uZWN0VGltZW91dE1zOiB0eXBlb2YgbG9ja1NlcnZlckNvbmZpZ3VyZWQuY29ubmVjdFRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiA/IGxvY2tTZXJ2ZXJDb25maWd1cmVkLmNvbm5lY3RUaW1lb3V0TXMgOiAzMDAwLFxuICAgICAgICAgIGVuYWJsZWQ6IHR5cGVvZiBsb2NrU2VydmVyQ29uZmlndXJlZC5lbmFibGVkID09PSBcImJvb2xlYW5cIlxuICAgICAgICAgICAgPyBsb2NrU2VydmVyQ29uZmlndXJlZC5lbmFibGVkXG4gICAgICAgICAgICA6IEJvb2xlYW4obG9ja1NlcnZlckNvbmZpZ3VyZWQudXJsIHx8IGxvY2tTZXJ2ZXJDb25maWd1cmVkLmhvc3QgfHwgZW52SG9zdCB8fCB0eXBlb2YgbG9ja1NlcnZlckNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIiB8fCBlbnZQb3J0UmF3KSxcbiAgICAgICAgICBsZWFzZU1zOiB0eXBlb2YgbG9ja1NlcnZlckNvbmZpZ3VyZWQubGVhc2VNcyA9PT0gXCJudW1iZXJcIiA/IGxvY2tTZXJ2ZXJDb25maWd1cmVkLmxlYXNlTXMgOiAzMF8wMDAsXG4gICAgICAgICAgcmVwcm9iZUNvb2xkb3duTXM6IHR5cGVvZiBsb2NrU2VydmVyQ29uZmlndXJlZC5yZXByb2JlQ29vbGRvd25NcyA9PT0gXCJudW1iZXJcIiA/IGxvY2tTZXJ2ZXJDb25maWd1cmVkLnJlcHJvYmVDb29sZG93bk1zIDogNTAwMCxcbiAgICAgICAgICB1cmw6IGxvY2tTZXJ2ZXJVcmxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHBvbGljeTogQXJyYXkuaXNBcnJheShjb25maWd1cmVkLnBvbGljeSkgPyBjb25maWd1cmVkLnBvbGljeSA6IFtdXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFkdmlzb3J5IGxvY2sgcG9saWN5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3lFbnRyeVtdfSAtIFBlci1sb2NrLW5hbWUgYmFja2VuZCBwb2xpY3kgZW50cmllcy5cbiAgICovXG4gIGdldEFkdmlzb3J5TG9ja1BvbGljeSgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBZHZpc29yeUxvY2tDb25maWcoKS5wb2xpY3lcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZWZmZWN0aXZlIGJhY2tlbmQgcG9saWN5IGZvciBvbmUgbG9jayBuYW1lIChkZXNpZ24gwqc1KS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tOYW1lIC0gQ29uY3JldGUgbG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLlJlc29sdmVkQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeX0gLSBSZXNvbHZlZCBwb2xpY3kuXG4gICAqL1xuICByZXNvbHZlQWR2aXNvcnlMb2NrUG9saWN5KGxvY2tOYW1lKSB7XG4gICAgcmV0dXJuIHJlc29sdmVBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5KGxvY2tOYW1lLCB0aGlzLmdldEFkdmlzb3J5TG9ja1BvbGljeSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZpbGUtdGllciBhZHZpc29yeS1sb2NrIGJhY2tlbmQgd2hlbiB0aGlzIGRlcGxveW1lbnQgaGFzXG4gICAqIGV4cGxpY2l0bHkgZW5hYmxlZCBpdCAoYGFkdmlzb3J5TG9ja3MuYmFja2VuZHMuZmlsZS5lbmFibGVkOiB0cnVlYCksXG4gICAqIGNyZWF0aW5nIGl0IG9uIGZpcnN0IHVzZS4gUmV0dXJucyBgdW5kZWZpbmVkYCB3aGVuIHRoZSB0aWVyIGlzIGRpc2FibGVkXG4gICAqICh0aGUgZGVmYXVsdCkg4oCUIGNhbGxlcnMgbXVzdCBuZXZlciBmYWxsIGJhY2sgdG8gaXQgaW1wbGljaXRseS4gQ3JlYXRpb25cbiAgICogZ29lcyB0aHJvdWdoIHRoZSBlbnZpcm9ubWVudCBoYW5kbGVyIHNvIGJyb3dzZXIvRXhwbyBjb25maWd1cmF0aW9uc1xuICAgKiB3aXRob3V0IGBmc2AgZmFpbCBsb3VkbHkgaW5zdGVhZCBvZiBoYWxmLXdvcmtpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1maWxlLWJhY2tlbmQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZW5hYmxlZCBmaWxlIGJhY2tlbmQsIG9yIHVuZGVmaW5lZC5cbiAgICovXG4gIGFzeW5jIGdldEFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QWR2aXNvcnlMb2NrQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmJhY2tlbmRzLmZpbGUuZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmICh0aGlzLl9hZHZpc29yeUxvY2tGaWxlQmFja2VuZCkgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kXG5cbiAgICBjb25zdCBkaXJlY3RvcnkgPSBjb25maWcuYmFja2VuZHMuZmlsZS5kaXJlY3RvcnkgfHwgYCR7dGhpcy5nZXREaXJlY3RvcnkoKX0vdG1wL2Fkdmlzb3J5LWxvY2tzYFxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQgPSBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmNyZWF0ZUFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKHtcbiAgICAgIGRpcmVjdG9yeSxcbiAgICAgIGxlYXNlTXM6IGNvbmZpZy5iYWNrZW5kcy5maWxlLmxlYXNlTXMsXG4gICAgICByZW5ld0ludGVydmFsTXM6IGNvbmZpZy5iYWNrZW5kcy5maWxlLnJlbmV3SW50ZXJ2YWxNc1xuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5fYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsb2NrLXNlcnZlciBhZHZpc29yeS1sb2NrIGJhY2tlbmQgKHRpZXIgKGIpKSB3aGVuIHRoaXNcbiAgICogZGVwbG95bWVudCBjb25maWd1cmVkIG9uZSwgY3JlYXRpbmcgaXQgb24gZmlyc3QgdXNlLiBSZXR1cm5zIGB1bmRlZmluZWRgXG4gICAqIHdoZW4gdGhlIHRpZXIgaXMgbm90IGNvbmZpZ3VyZWQg4oCUIGNhbGxlcnMgbXVzdCBuZXZlciBpbnZlbnQgb25lLlxuICAgKlxuICAgKiBUaGUgYmFja2VuZCBrZWVwcyBhIHNpbmdsZSBzb2NrZXQgcGVyIHByb2Nlc3M7IGl0IGhvbGRzIG5vIGRhdGFiYXNlXG4gICAqIGNvbm5lY3Rpb24gd2hpbGUgd2FpdGluZyBmb3Igb3IgaG9sZGluZyBhIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stbG9jay1zZXJ2ZXItYmFja2VuZC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb25maWd1cmVkIGJhY2tlbmQsIG9yIHVuZGVmaW5lZC5cbiAgICovXG4gIGFzeW5jIGdldEFkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kKCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QWR2aXNvcnlMb2NrQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmJhY2tlbmRzLmxvY2tTZXJ2ZXIuZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmICh0aGlzLl9hZHZpc29yeUxvY2tMb2NrU2VydmVyQmFja2VuZCkgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kXG5cbiAgICBjb25zdCB7ZGVmYXVsdDogQWR2aXNvcnlMb2NrTG9ja1NlcnZlckJhY2tlbmR9ID0gYXdhaXQgaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWxvY2stc2VydmVyLWJhY2tlbmQuanNcIilcbiAgICBjb25zdCBiYWNrZW5kID0gbmV3IEFkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kKHtcbiAgICAgIGF1dGhUb2tlbjogY29uZmlnLmJhY2tlbmRzLmxvY2tTZXJ2ZXIuYXV0aFRva2VuLFxuICAgICAgY29ubmVjdFRpbWVvdXRNczogY29uZmlnLmJhY2tlbmRzLmxvY2tTZXJ2ZXIuY29ubmVjdFRpbWVvdXRNcyxcbiAgICAgIGxlYXNlTXM6IGNvbmZpZy5iYWNrZW5kcy5sb2NrU2VydmVyLmxlYXNlTXMsXG4gICAgICBvbkVycm9yOiAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwge2NvbnRleHQ6IFwiYWR2aXNvcnktbG9jay1sb2NrLXNlcnZlclwiLCBlcnJvcn0pXG4gICAgICAgIHRoaXMuZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiYWxsLWVycm9yXCIsIHtjb250ZXh0OiBcImFkdmlzb3J5LWxvY2stbG9jay1zZXJ2ZXJcIiwgZXJyb3IsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgICB9LFxuICAgICAgcmVwcm9iZUNvb2xkb3duTXM6IGNvbmZpZy5iYWNrZW5kcy5sb2NrU2VydmVyLnJlcHJvYmVDb29sZG93bk1zLFxuICAgICAgdXJsOiBjb25maWcuYmFja2VuZHMubG9ja1NlcnZlci51cmxcbiAgICB9KVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrTG9ja1NlcnZlckJhY2tlbmQgPSBiYWNrZW5kXG5cbiAgICByZXR1cm4gYmFja2VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgd2hpY2ggYmFja2VuZCB0aWVyIHNlcnZlZCBvbmUgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbiBzb1xuICAgKiBgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cygpYCBjYW4gYW5zd2VyIFwid2hpY2ggYmFja2VuZCBzZXJ2ZWQgdGhpc1xuICAgKiBsb2NrXCIgKGRlc2lnbiDCpzMpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFjcXVpc2l0aW9uIHJlY29yZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubG9ja05hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXJ9IGFyZ3MuYmFja2VuZCAtIFRpZXIgdGhhdCBzZXJ2ZWQgdGhlIGFjcXVpc2l0aW9uLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuZmVuY2luZ1N1cHBvcnRlZCAtIFdoZXRoZXIgdGhlIHNlcnZpbmcgdGllciBjYXJyaWVzIGZlbmNpbmcgdG9rZW5zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEFkdmlzb3J5TG9ja0FjcXVpc2l0aW9uKHtsb2NrTmFtZSwgYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZH0pIHtcbiAgICB0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXNpdGlvbnMuc2V0KGxvY2tOYW1lLCB7YmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZCwgc2VydmVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKX0pXG4gIH1cblxuICAvKipcbiAgICogVGhlIFwid2hpY2ggYmFja2VuZCBzZXJ2ZWQgdGhpcyBsb2NrXCIgZGlhZ25vc3RpY3Mgc3VyZmFjZSAoZGVzaWduIMKnMyk6XG4gICAqIHBlciBsb2NrIG5hbWUsIHRoZSB0aWVyIG9mIHRoZSBtb3N0IHJlY2VudCBhY3F1aXNpdGlvbiwgd2hldGhlciB0aGF0IHRpZXJcbiAgICogY2FycmllcyBmZW5jaW5nIHRva2VucywgYW5kIHRoZSByZXNvbHZlZCBwb2xpY3kgKG1pbmltdW0vYWxsb3dlZC9wcmVmZXJyZWRcbiAgICogdGllcnMpIGZvciB0aGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tOYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2FjcXVpc2l0aW9uOiB7YmFja2VuZDogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXIsIGZlbmNpbmdTdXBwb3J0ZWQ6IGJvb2xlYW4sIHNlcnZlZEF0OiBzdHJpbmd9IHwgbnVsbCwgbG9ja1NlcnZlcjoge2Nvbm5lY3RlZDogYm9vbGVhbiwgbGFzdEVycm9yOiBzdHJpbmcgfCBudWxsLCBsYXN0UHJvYmVBdDogc3RyaW5nIHwgbnVsbCwgbGVhc2VkTmFtZXM6IHN0cmluZ1tdfSB8IG51bGwsIHBvbGljeTogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLlJlc29sdmVkQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeX19IC0gQmFja2VuZCBzdGF0dXMgZm9yIHRoZSBuYW1lLlxuICAgKi9cbiAgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cyhsb2NrTmFtZSkge1xuICAgIHJldHVybiB7XG4gICAgICBhY3F1aXNpdGlvbjogdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlzaXRpb25zLmdldChsb2NrTmFtZSkgPz8gbnVsbCxcbiAgICAgIGxvY2tTZXJ2ZXI6IHRoaXMuX2Fkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kPy5nZXRTdGF0dXMoKSA/PyBudWxsLFxuICAgICAgcG9saWN5OiB0aGlzLnJlc29sdmVBZHZpc29yeUxvY2tQb2xpY3kobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGRlZGljYXRlZCBjb25uZWN0aW9uIHRoYXQgY3VycmVudGx5IGhvbGRzIGFuIGFkdmlzb3J5IGxvY2ssIHNvIGFcbiAgICogc2h1dGRvd24gY2FuIGNsb3NlIGl0IGFuZCByZWxlYXNlIHRoZSBsb2NrLiBTZWUgYF9hZHZpc29yeUxvY2tDb25uZWN0aW9uc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuYWRkKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uIG9uY2UgaXRzIGxvY2sgc2NvcGUgZW5kcyBhbmQgdGhlXG4gICAqIGNvbm5lY3Rpb24gaGFzIGJlZW4gKG9yIGlzIGFib3V0IHRvIGJlKSBjbG9zZWQgYnkgaXRzIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBUaGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB1bnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGV2ZXJ5IHJlZ2lzdGVyZWQgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiwgZW5kaW5nIGl0cyBzZXNzaW9uIHNvXG4gICAqIHRoZSBEQiBzZXJ2ZXIgcmVsZWFzZXMgdGhlIGxvY2suIEV2ZXJ5IGNvbm5lY3Rpb24gaXMgYXR0ZW1wdGVkIGJlZm9yZSBhbnkgZmFpbHVyZVxuICAgKiBpcyBzdXJmYWNlZCwgc28gb25lIHN0dWNrIGNsb3NlIGRvZXMgbm90IGxlYXZlIHRoZSBvdGhlcnMnIGxvY2tzIGhlbGQ7IGEgZmFpbHVyZSBpc1xuICAgKiB0aGVuIHRocm93biAobmV2ZXIgc3dhbGxvd2VkKSwgYWdncmVnYXRlZCB3aGVuIG1vcmUgdGhhbiBvbmUgY29ubmVjdGlvbiBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgYWxsIGhhdmUgYmVlbiBjbG9zZWQ7IHJlamVjdHMgaWYgYW55IGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zXVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuY2xlYXIoKVxuXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBjb25uZWN0aW9ucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFjdGl2ZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBhbmQgY2xlYXJzIGdsb2JhbCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbnN0cnVjdG9ycyA9IG5ldyBTZXQoKVxuXG4gICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgICBjb25zdCBjbG9zZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gQ2xvc2UgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgZmlyc3Q6IHRoZXkgYXJlIHNwYXduZWQgb3V0c2lkZSB0aGVcbiAgICAgICAgICAvLyBwb29scycgdHJhY2tlZCBzZXRzLCBzbyBgcG9vbC5jbG9zZUFsbCgpYCB3b3VsZCBub3QgcmVhY2ggdGhlbSBhbmQgYSBsb2NrIGhlbGRcbiAgICAgICAgICAvLyBieSBhIHJ1bm5lciB0b3JuIGRvd24gbWlkLXBhc3Mgd291bGQgbGVhayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuXG4gICAgICAgICAgLy8gU3RpbGwgY2xvc2UgdGhlIHBvb2xzIGlmIHRoaXMgdGhyb3dzLCBzbyBhIHN0dWNrIGxvY2sgY29ubmVjdGlvbiBkb2VzIG5vdFxuICAgICAgICAgIC8vIGxlYXZlIHRoZSByZXN0IG9mIHRoZSBjb25uZWN0aW9ucyBvcGVuLlxuICAgICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMoKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBSZWxlYXNlIGZpbGUtdGllciBhZHZpc29yeS1sb2NrIGhvbGRzIGV4cGxpY2l0bHkgKFNUQy0yMTMpOiB0aGVcbiAgICAgICAgICAgIC8vIGxlYXNlIHdvdWxkIG1ha2UgdGhlbSByZWNsYWltYWJsZSBhbnl3YXksIGJ1dCBhIGNsZWFuIHNodXRkb3duXG4gICAgICAgICAgICAvLyBzaG91bGQgbm90IGxlYXZlIGxvY2sgZGlyZWN0b3JpZXMgYmVoaW5kIGZvciB0aGUgc3RhbGVuZXNzIHBhdGguXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9hZHZpc29yeUxvY2tGaWxlQmFja2VuZD8ucmVsZWFzZUFsbEhlbGQoKVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gUmVsZWFzZSBsb2NrLXNlcnZlciBsZWFzZXMgZXhwbGljaXRseSBmaXJzdCwgdGhlbiBkcm9wIHRoZSBzb2NrZXQ6XG4gICAgICAgICAgICAvLyB0aGUgc2VydmVyIHJlY2xhaW1zIGEgY2xvc2VkIGNvbm5lY3Rpb24gYW55d2F5LCBidXQgYW4gZXhwbGljaXRcbiAgICAgICAgICAgIC8vIHJlbGVhc2UgaGFuZHMgdGhlIG5hbWUgdG8gdGhlIG5leHQgd2FpdGVyIHdpdGhvdXQgd2FpdGluZyBmb3IgdGhlXG4gICAgICAgICAgICAvLyB0cmFuc3BvcnQgdGVhcmRvd24uXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9hZHZpc29yeUxvY2tMb2NrU2VydmVyQmFja2VuZD8uY2xvc2UoKVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICAgICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG5cbiAgICAgICAgICAgIGF3YWl0IHBvb2wuY2xvc2VBbGwoKVxuXG4gICAgICAgICAgICBjb25zdCBQb29sQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAqLyAocG9vbC5jb25zdHJ1Y3RvcilcbiAgICAgICAgICAgIGNvbnN0cnVjdG9ycy5hZGQoUG9vbENsYXNzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGZvciAoY29uc3QgUG9vbENsYXNzIG9mIGNvbnN0cnVjdG9ycykge1xuICAgICAgICAgICAgUG9vbENsYXNzLmNsZWFyR2xvYmFsQ29ubmVjdGlvbnModGhpcylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZS5yZXNldCgpXG5cbiAgICAgICAgICAvLyBBbGxvdyBmdWxsIHJlLWluaXRpYWxpemF0aW9uIGFmdGVyIGNvbm5lY3Rpb25zIGFyZSBjbG9zZWQuXG4gICAgICAgICAgdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gKz0gMVxuICAgICAgICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGNsb3NlRXJyb3JzWzBdXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGNsb3NlRXJyb3JzLCBcIkZhaWxlZCB0byBjbG9zZSBiYWNrZ3JvdW5kLWpvYnMgYW5kIGRhdGFiYXNlIHJlc291cmNlc1wiKVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgcmVxdWVzdCBhdXRob3JpemVkLlxuICAgKiBAcGFyYW0ge3toZWFkZXI6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9fSByZXF1ZXN0IC0gSW5jb21pbmcgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4cGVjdGVkVG9rZW4gLSBDb25maWd1cmVkIGRlYnVnLWVuZHBvaW50IHRva2VuLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0IGNhcnJpZXMgdGhlIGV4cGVjdGVkIGJlYXJlciB0b2tlbi5cbiAgICovXG4gIGRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCBleHBlY3RlZFRva2VuKSB7XG4gICAgY29uc3QgaGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJhdXRob3JpemF0aW9uXCIpXG5cbiAgICBpZiAodHlwZW9mIGhlYWRlciAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBtYXRjaCA9ICgvXkJlYXJlclxccysoLispJC9pKS5leGVjKGhlYWRlci50cmltKCkpXG5cbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmRlYnVnRW5kcG9pbnRUb2tlbk1hdGNoZXMobWF0Y2hbMV0sIGV4cGVjdGVkVG9rZW4pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXBpIG1hbmlmZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj59IC0gQVBJIG1hbmlmZXN0IGZvciBhbGwgcmVnaXN0ZXJlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBnZXRBcGlNYW5pZmVzdCgpIHtcbiAgICByZXR1cm4gZnJvbnRlbmRNb2RlbEFwaU1hbmlmZXN0KHRoaXMuX2JhY2tlbmRQcm9qZWN0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXRoZXIgQVBJIG1hbmlmZXN0IGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIEFQSSBtYW5pZmVzdCBlbmRwb2ludCBpcyBlbmFibGVkLlxuICAgKi9cbiAgX2FwaU1hbmlmZXN0RW5hYmxlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fYXBpTWFuaWZlc3QuZW5hYmxlZFxuICB9XG59XG4iXX0=