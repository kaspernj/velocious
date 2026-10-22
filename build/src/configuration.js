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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLEVBQUMsb0NBQW9DLEVBQUMsTUFBTSw4Q0FBOEMsQ0FBQTtBQUNqRyxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFB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LElBQUksT0FBTyxzQkFBc0IsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsc0JBQXNCLENBQUMsSUFBSSxzQkFBc0IsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUMvTyxNQUFNLHVCQUF1QixHQUFHLE9BQU8sVUFBVSxDQUFDLHVCQUF1QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLFVBQVUsQ0FBQyx1QkFBdUIsSUFBSSxDQUFDO1lBQ3RMLENBQUMsQ0FBQyxVQUFVLENBQUMsdUJBQXVCO1lBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx5QkFBeUIsSUFBSSxVQUFVLENBQUMsSUFBSSxPQUFPLDBCQUEwQixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLDBCQUEwQixDQUFDLElBQUksMEJBQTBCLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUMsQ0FBQTtRQUNyTyxNQUFNLHlCQUF5QixHQUFHLE9BQU8sVUFBVSxDQUFDLHlCQUF5QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJLFVBQVUsQ0FBQyx5QkFBeUIsSUFBSSxDQUFDO1lBQzlMLENBQUMsQ0FBQyxVQUFVLENBQUMseUJBQXlCO1lBQ3RDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQywyQkFBMkIsSUFBSSxVQUFVLENBQUMsSUFBSSxPQUFPLDRCQUE0QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLDRCQUE0QixDQUFDLElBQUksNEJBQTRCLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDLENBQUMsRUFB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LENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILG1CQUFtQjtRQUNqQixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFBO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZSB0eXBlLlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHsoYXJnOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0PikgPT4gUHJvbWlzZTxUPn0gV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogV2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbZGF0YWJhc2VJZGVudGlmaWVyc10gLSBEYXRhYmFzZSBpZGVudGlmaWVycyB0byBpbmNsdWRlIGluIHRoZSBjb25uZWN0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtuYW1lXSAtIEh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoZSBjaGVja2VkLW91dCBkYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAqL1xuLyoqXG4gKiBPbmUgYWRhcHRlciBpbnN0YW5jZSBhbmQgaXRzIHNlcmlhbGl6ZWQgcmVhZHkvY2xvc2UgbGlmZWN5Y2xlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy9hZGFwdGVyLmpzXCIpLmRlZmF1bHR9IGFkYXB0ZXIgLSBBZGFwdGVyIG93bmVkIGJ5IHRoaXMgZ2VuZXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY2xvc2luZyAtIFdoZXRoZXIgY2xvc2UgaGFzIGNsYWltZWQgdGhpcyBnZW5lcmF0aW9uLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSByZWFkeVByb21pc2UgLSBTaGFyZWQgcmVhZGluZXNzIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IGNsb3NlUHJvbWlzZSAtIFNoYXJlZCBjbG9zZSBvcGVyYXRpb24uXG4gKi9cblxuaW1wb3J0IHsgZGlnZyB9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IGdldHRleHRDb25maWcgZnJvbSBcImdldHRleHQtdW5pdmVyc2FsL2J1aWxkL3NyYy9jb25maWcuanNcIlxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5pbXBvcnQgdHJhbnNsYXRlIGZyb20gXCJnZXR0ZXh0LXVuaXZlcnNhbC9idWlsZC9zcmMvdHJhbnNsYXRlLmpzXCJcbmltcG9ydCBBYmlsaXR5IGZyb20gXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGZyb20gXCIuL2JhY2tncm91bmQtam9icy9hZGFwdGVyLmpzXCJcbmltcG9ydCB7REVGQVVMVF9TQ0hFRFVMRURfRU5RVUVVRV9USU1FT1VUX01TfSBmcm9tIFwiLi9iYWNrZ3JvdW5kLWpvYnMvc2NoZWR1bGVkLWVucXVldWUtYm91bmQuanNcIlxuaW1wb3J0IERhdGFiYXNlT3BlcmF0aW9uIGZyb20gXCIuL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiXG5pbXBvcnQgeyBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyB9IGZyb20gXCIuL2RhdGFiYXNlL3JlY29yZC9hdWRpdGluZy5qc1wiXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyBmcm9tIFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpYmVycy5qc1wiXG5pbXBvcnQgeyBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yLCBjdXJyZW50Q29uZmlndXJhdGlvbiwgc2V0Q3VycmVudENvbmZpZ3VyYXRpb24gfSBmcm9tIFwiLi9jdXJyZW50LWNvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IHsgcmVxdWVzdERldGFpbHMgfSBmcm9tIFwiLi9lcnJvci1yZXBvcnRpbmcvcmVxdWVzdC1kZXRhaWxzLmpzXCJcbmltcG9ydCBMb2dSZWRhY3RvciBmcm9tIFwiLi9sb2ctcmVkYWN0b3IuanNcIlxuaW1wb3J0IHsgZnJvbnRlbmRNb2RlbEFwaU1hbmlmZXN0LCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24sIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdCB9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7IGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5LCBub3JtYWxpemVPZmZsaW5lR3JhbnRTaWduaW5nS2V5IH0gZnJvbSBcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCJcbmltcG9ydCBQbHVnaW5Sb3V0ZXMgZnJvbSBcIi4vcm91dGVzL3BsdWdpbi1yb3V0ZXMuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZSB9IGZyb20gXCIuL3Rlc3RpbmcvdGVzdC1wcm9maWxlLWFjdGl2aXR5LmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGltZVpvbmUgfSBmcm9tIFwiLi90aW1lLXpvbmUuanNcIlxuaW1wb3J0IHsgd2l0aFRyYWNrZWRTdGFjayB9IGZyb20gXCIuL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzUGFja2FnZSBmcm9tIFwiLi9wYWNrYWdlcy92ZWxvY2lvdXMtcGFja2FnZS5qc1wiXG5pbXBvcnQgRnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgZnJvbSBcIi4vdGVuYW50cy9mcm9udGVuZC10ZW5hbnQtc3FsaXRlLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgeyByZXNvbHZlR2VuZXJhdGlvbklkLCByZXNvbHZlSW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgcmVzb2x2ZUxpZmVjeWNsZVNvY2tldFBhdGggfSBmcm9tIFwiLi9iYWNrZ3JvdW5kLWpvYnMvZ2VuZXJhdGlvbi1pZGVudGl0eS5qc1wiXG5pbXBvcnQgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcbmltcG9ydCB7IHJlc29sdmVBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5IH0gZnJvbSBcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiXG5cbmV4cG9ydCB7IEN1cnJlbnRDb25maWd1cmF0aW9uTm90U2V0RXJyb3IgfVxuXG4vKipcbiAqIFJ1bnMgY3VycmVudCB3b3JraW5nIGRpcmVjdG9yeS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ3VycmVudCB3b3JraW5nIGRpcmVjdG9yeSB3aGVuIHRoZSBydW50aW1lIGV4cG9zZXMgb25lLlxuICovXG5mdW5jdGlvbiBjdXJyZW50V29ya2luZ0RpcmVjdG9yeSgpIHtcbiAgY29uc3QgcHJvY2Vzc09iamVjdCA9IC8qKiBAdHlwZSB7e2N3ZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB8IHVuZGVmaW5lZH0gKi8gKGdsb2JhbFRoaXMucHJvY2VzcylcblxuICBpZiAodHlwZW9mIHByb2Nlc3NPYmplY3Q/LmN3ZCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHByb2Nlc3NPYmplY3QuY3dkKClcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgb3ZlcmxvYWRlZCB3aXRoL2Vuc3VyZSBjb25uZWN0aW9ucyBhcmd1bWVudHMuXG4gKiBAdGVtcGxhdGUgVFxuICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD4gfCB1bmRlZmluZWR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcGFyYW0ge3N0cmluZ30gZGVmYXVsdE5hbWUgLSBEZWZhdWx0IGNoZWNrb3V0IG5hbWUuXG4gKiBAcmV0dXJucyB7e2RhdGFiYXNlSWRlbnRpZmllcnM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBuYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD4gfCB1bmRlZmluZWR9fSBSZXNvbHZlZCBjaGVja291dCBvcHRpb25zIGFuZCBjYWxsYmFjay5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVdpdGhDb25uZWN0aW9uc0FyZ3Mob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrLCBkZWZhdWx0TmFtZSkge1xuICBpZiAodHlwZW9mIG9wdGlvbnNPckNhbGxiYWNrID09IFwiZnVuY3Rpb25cIikge1xuICAgIGNvbnN0IGFjdHVhbENhbGxiYWNrID0gLyoqIEB0eXBlIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59ICovIChvcHRpb25zT3JDYWxsYmFjaylcblxuICAgIHJldHVybiB7ZGF0YWJhc2VJZGVudGlmaWVyczogdW5kZWZpbmVkLCBuYW1lOiBkZWZhdWx0TmFtZSwgY2FsbGJhY2s6IGFjdHVhbENhbGxiYWNrfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhYmFzZUlkZW50aWZpZXJzOiBvcHRpb25zT3JDYWxsYmFjay5kYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgIG5hbWU6IG9wdGlvbnNPckNhbGxiYWNrLm5hbWUgfHwgZGVmYXVsdE5hbWUsXG4gICAgY2FsbGJhY2tcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgY2Fub25pY2FsIGRlYnVnIHNuYXBzaG90IHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTbmFwc2hvdCB2YWx1ZSB0byBjYW5vbmljYWxpemUuXG4gKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFNuYXBzaG90IHZhbHVlIHdpdGggb2JqZWN0IGtleXMgc29ydGVkIHJlY3Vyc2l2ZWx5LlxuICovXG5mdW5jdGlvbiBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiB2YWx1ZVxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5tYXAoKGVudHJ5KSA9PiBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoZW50cnkpKVxuXG4gIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpLnJlZHVjZSgocmVzdWx0LCBrZXkpID0+IHtcbiAgICByZXN1bHRba2V5XSA9IGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZSgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVtrZXldKVxuICAgIHJldHVybiByZXN1bHRcbiAgfSwgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7fSkpXG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gQmFzZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZSB8IFBhcnRpYWw8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGU+IHwgdm9pZH0gb3ZlcnJpZGVDb25maWd1cmF0aW9uIC0gVGVuYW50IG92ZXJyaWRlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gTWVyZ2VkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG1lcmdlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3ZlcnJpZGVDb25maWd1cmF0aW9uKSB7XG4gIGlmICghb3ZlcnJpZGVDb25maWd1cmF0aW9uKSByZXR1cm4gZGF0YWJhc2VDb25maWd1cmF0aW9uXG5cbiAgcmV0dXJuIHtcbiAgICAuLi5kYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgLi4ub3ZlcnJpZGVDb25maWd1cmF0aW9uLFxuICAgIHJlY29yZDoge1xuICAgICAgLi4uKGRhdGFiYXNlQ29uZmlndXJhdGlvbi5yZWNvcmQgfHwge30pLFxuICAgICAgLi4uKG92ZXJyaWRlQ29uZmlndXJhdGlvbi5yZWNvcmQgfHwge30pXG4gICAgfSxcbiAgICBzcWxDb25maWc6IHtcbiAgICAgIC4uLihkYXRhYmFzZUNvbmZpZ3VyYXRpb24uc3FsQ29uZmlnIHx8IHt9KSxcbiAgICAgIC4uLihvdmVycmlkZUNvbmZpZ3VyYXRpb24uc3FsQ29uZmlnIHx8IHt9KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBncmFjZSB3aW5kb3cgKG1zKSBiZWZvcmUgYSBzdXN0YWluZWQgYmVhY29uIG91dGFnZSBpcyByZXBvcnRlZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBgdW5yZWFjaGFibGVSZXBvcnRNc2AsIGlmIGFueS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGNvbmZpZ3VyZWQgdmFsdWUgd2hlbiBpdCdzIGEgZmluaXRlIG51bWJlciwgb3RoZXJ3aXNlIHRoZSAzMHMgZGVmYXVsdC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUJlYWNvblVucmVhY2hhYmxlUmVwb3J0TXModmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWVcblxuICByZXR1cm4gMzBfMDAwXG59XG5cbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfQllURVMgPSAxNiAqIDEwMjQgKiAxMDI0XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX01FU1NBR0VTID0gMjU2XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19CWVRFUyA9IDE2ICogMTAyNCAqIDEwMjRcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0ZSQU1FUyA9IDI1NlxuXG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCA9IDEwMjRcbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFkgPSA0XG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUwgPSA2XG5cbi8qKlxuICogVmFsaWRhdGVzIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0VmFsdWUgLSBEZWZhdWx0IHZhbHVlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZGF0ZWQgY29uZmlndXJlZCBvciBkZWZhdWx0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHZhbHVlLCBuYW1lLCBkZWZhdWx0VmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBkZWZhdWx0VmFsdWVcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGAke25hbWV9IG11c3QgYmUgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXJgKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFuIG9wdGlvbmFsIHBvc2l0aXZlIHNhZmUgaW50ZWdlciBjb25maWd1cmF0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIHBvc2l0aXZlIHNhZmUgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29uZmlndXJhdGlvbiBrZXkuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFZhbGlkYXRlZCBjb25maWd1cmVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIodmFsdWUsIG5hbWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWRcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGAke25hbWV9IG11c3QgYmUgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXJgKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFuIGludGVnZXIgY29uZmlndXJhdGlvbiB2YWx1ZSBpbnNpZGUgYW4gaW5jbHVzaXZlIHJhbmdlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbmZpZ3VyYXRpb24ga2V5LlxuICogQHBhcmFtIHtudW1iZXJ9IG1pbiAtIE1pbmltdW0gYWNjZXB0ZWQgdmFsdWUgKGluY2x1c2l2ZSkuXG4gKiBAcGFyYW0ge251bWJlcn0gbWF4IC0gTWF4aW11bSBhY2NlcHRlZCB2YWx1ZSAoaW5jbHVzaXZlKS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0VmFsdWUgLSBEZWZhdWx0IHZhbHVlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZGF0ZWQgY29uZmlndXJlZCBvciBkZWZhdWx0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBpbnRlZ2VySW5SYW5nZSh2YWx1ZSwgbmFtZSwgbWluLCBtYXgsIGRlZmF1bHRWYWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGRlZmF1bHRWYWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IG1pbiB8fCB2YWx1ZSA+IG1heCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gJHttaW59IGFuZCAke21heH1gKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyB0aGUgYnVmZmVyZWQgSFRUUCByZXNwb25zZSBjb21wcmVzc2lvbiBjb25maWd1cmF0aW9uLiBDb21wcmVzc2lvbiBpc1xuICogZW5hYmxlZCBieSBkZWZhdWx0IHdoZW4gdGhlIHNldHRpbmcgaXMgYWJzZW50OyBgZmFsc2VgIG9yIGB7ZW5hYmxlZDogZmFsc2V9YFxuICogZGlzYWJsZXMgaXQgZ2xvYmFsbHkuXG4gKiBAcGFyYW0ge2Jvb2xlYW4gfCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDb25maWd1cmVkIGNvbXByZXNzaW9uIHZhbHVlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUh0dHBDb21wcmVzc2lvbih2YWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gdHJ1ZSkge1xuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgdGhyZXNob2xkOiBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCwgYnJvdGxpUXVhbGl0eTogREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSwgZ3ppcExldmVsOiBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUx9XG4gIH1cblxuICBpZiAodmFsdWUgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgdGhyZXNob2xkOiBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCwgYnJvdGxpUXVhbGl0eTogREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSwgZ3ppcExldmVsOiBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUx9XG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbiBtdXN0IGJlIGEgYm9vbGVhbiBvciBhbiBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gIH1cblxuICBjb25zdCB7YnJvdGxpUXVhbGl0eSwgZW5hYmxlZCwgZ3ppcExldmVsLCB0aHJlc2hvbGQsIC4uLnJlc3RDb21wcmVzc2lvbn0gPSB2YWx1ZVxuICBjb25zdCByZXN0Q29tcHJlc3Npb25LZXlzID0gT2JqZWN0LmtleXMocmVzdENvbXByZXNzaW9uKVxuXG4gIGlmIChyZXN0Q29tcHJlc3Npb25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uIHJlY2VpdmVkIHVua25vd24ga2V5czogJHtyZXN0Q29tcHJlc3Npb25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYnJvdGxpUXVhbGl0eSwgZW5hYmxlZCwgZ3ppcExldmVsLCB0aHJlc2hvbGQpYClcbiAgfVxuXG4gIGlmIChlbmFibGVkICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGVuYWJsZWQgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbi5lbmFibGVkIG11c3QgYmUgYSBib29sZWFuLCBnb3Q6ICR7U3RyaW5nKGVuYWJsZWQpfWApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGVuYWJsZWQ6IGVuYWJsZWQgPz8gdHJ1ZSxcbiAgICB0aHJlc2hvbGQ6IHBvc2l0aXZlU2FmZUludGVnZXIodGhyZXNob2xkLCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24udGhyZXNob2xkXCIsIERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xEKSxcbiAgICBicm90bGlRdWFsaXR5OiBpbnRlZ2VySW5SYW5nZShicm90bGlRdWFsaXR5LCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uYnJvdGxpUXVhbGl0eVwiLCAwLCAxMSwgREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSksXG4gICAgZ3ppcExldmVsOiBpbnRlZ2VySW5SYW5nZShnemlwTGV2ZWwsIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi5nemlwTGV2ZWxcIiwgMCwgOSwgREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMKVxuICB9XG59XG5cbi8qKlxuICogRGVmYXVsdCByZXF1ZXN0LWJvZHkgbGltaXQgZm9yIHRoZSBidWlsdC1pbiBNQ1AgZW5kcG9pbnQuIEpTT04tUlBDIG1lc3NhZ2VzIGFyZSBzbWFsbCxcbiAqIHNvIHRoZSBmcmFtZXdvcmsgY2FwcyB0aGVtIGluc3RlYWQgb2YgbWFraW5nIGV2ZXJ5IGFwcCB0aGF0IGVuYWJsZXMgYG1jcDogdHJ1ZWAgcmVzdGF0ZVxuICogYSByZXF1ZXN0LWJvZHkgcG9saWN5LiBFeHBsaWNpdCBgaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzYCBvciBhIHJlc29sdmVyIGxpbWl0IHdpbnMuXG4gKiBAdHlwZSB7bnVtYmVyfVxuICovXG5jb25zdCBERUZBVUxUX01DUF9NQVhfUkVRVUVTVF9CT0RZX0JZVEVTID0gMTAyNCAqIDEwMjRcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ29uZmlndXJhdGlvbiB7XG4gIC8qKlxuICAgKiBDbG9zZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBwcm9taXNlLlxuICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gIF9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlID0gbnVsbFxuXG4gIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgY3VycmVudGx5IGhvbGRpbmcgYSBsb2NrLiBUaGVzZSBhcmUgc3Bhd25lZFxuICAgKiBvdXRzaWRlIHRoZSBwb29scycgdHJhY2tlZCBzZXRzIChzbyBhIGhvbGQtdGltZW91dCBsb2NrIHN1cnZpdmVzIHBvb2wgY2hlY2tvdXRzKSxcbiAgICogc28gYGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc2Agd291bGQgb3RoZXJ3aXNlIHdhbGsgcGFzdCB0aGVtOyB0cmFja2luZyB0aGVtIGhlcmVcbiAgICogbGV0cyBhIHNodXRkb3duIGNsb3NlIHRoZW0gYW5kIHJlbGVhc2UgdGhlIGxvY2sgaW5zdGVhZCBvZiBvcnBoYW5pbmcgaXQuXG4gICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gIF9hZHZpc29yeUxvY2tDb25uZWN0aW9ucyA9IG5ldyBTZXQoKVxuXG4gIC8qKlxuICAgKiBMYXppbHkgY3JlYXRlZCBmaWxlLXRpZXIgYWR2aXNvcnktbG9jayBiYWNrZW5kIChTVEMtMjEzKS4gU3RheXMgYHVuZGVmaW5lZGBcbiAgICogdW5sZXNzIGBhZHZpc29yeUxvY2tzLmJhY2tlbmRzLmZpbGUuZW5hYmxlZDogdHJ1ZWAgaXMgZXhwbGljaXRseSBjb25maWd1cmVkIOKAlFxuICAgKiB0aGUgZmlsZSB0aWVyIGlzIG5ldmVyIGF1dG8tZW5hYmxlZCwgYW5kIGEgbm9uLU5vZGUgZW52aXJvbm1lbnQgaGFuZGxlclxuICAgKiAoYnJvd3Nlci9FeHBvLCBubyBgZnNgKSBjYW5ub3QgY3JlYXRlIG9uZSBhdCBhbGwuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stZmlsZS1iYWNrZW5kLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIF9hZHZpc29yeUxvY2tGaWxlQmFja2VuZCA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogTGF6aWx5IGNyZWF0ZWQgbG9jay1zZXJ2ZXIgKHRpZXIgKGIpKSBiYWNrZW5kOyB1bmRlZmluZWQgd2hlbiB0aGUgdGllciBpc1xuICAgKiBub3QgY29uZmlndXJlZC5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1sb2NrLXNlcnZlci1iYWNrZW5kLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9XG4gICAqL1xuICBfYWR2aXNvcnlMb2NrTG9ja1NlcnZlckJhY2tlbmQgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogTW9zdCByZWNlbnQgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbiBwZXIgbG9jayBuYW1lIOKAlCB0aGUgXCJ3aGljaCBiYWNrZW5kXG4gICAqIHNlcnZlZCB0aGlzIGxvY2tcIiBzdXJmYWNlIChkZXNpZ24gwqczKS5cbiAgICogQHR5cGUge01hcDxzdHJpbmcsIHtiYWNrZW5kOiBpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuQWR2aXNvcnlMb2NrVGllciwgZmVuY2luZ1N1cHBvcnRlZDogYm9vbGVhbiwgc2VydmVkQXQ6IHN0cmluZ30+fSAqL1xuICBfYWR2aXNvcnlMb2NrQWNxdWlzaXRpb25zID0gbmV3IE1hcCgpXG5cbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICBfc2NoZW1hQ2FjaGVHZW5lcmF0aW9uc0J5UmV1c2VLZXkgPSBuZXcgTWFwKClcblxuICAvKipcbiAgICogUnVucyBjdXJyZW50LlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzQ29uZmlndXJhdGlvbn0gLSBUaGUgY3VycmVudC5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIHJldHVybiBjdXJyZW50Q29uZmlndXJhdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ29uZmlndXJhdGlvbkFyZ3NUeXBlfSBhcmdzIC0gQ29uZmlndXJhdGlvbiBhcmd1bWVudHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YWJpbGl0eVJlc29sdmVyLCBhYmlsaXR5UmVzb3VyY2VzLCBhZHZpc29yeUxvY2tzLCBhdHRhY2htZW50cywgYXV0b2xvYWQgPSB0cnVlLCBiYWNrZ3JvdW5kSm9icywgYmFja2VuZFByb2plY3RzLCBiZWFjb24sIGNvb2tpZVNlY3JldCwgY29ycywgZGF0YWJhc2UsIGRlYnVnID0gZmFsc2UsIGRlYnVnRW5kcG9pbnQgPSBmYWxzZSwgYXBpTWFuaWZlc3QgPSBmYWxzZSwgZGlyZWN0b3J5LCBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSB0cnVlLCBlbnZpcm9ubWVudCwgZW52aXJvbm1lbnRIYW5kbGVyLCBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cywgZnJvbnRlbmRUZW5hbnRTcWxpdGUsIGh0dHBTZXJ2ZXIsIGluaXRpYWxpemVNb2RlbHMsIGluaXRpYWxpemVycywgbG9jYWxlLCBsb2NhbGVGYWxsYmFja3MsIGxvY2FsZXMsIGxvZ2dpbmcsIG1haWxlckJhY2tlbmQsIG1jcCA9IGZhbHNlLCBwYWNrYWdlcywgcmVxdWVzdFRpbWVvdXRNcywgcm91dGVSZXNvbHZlckhvb2tzLCBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icywgc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycywgc3RydWN0dXJlU3FsLCBzeW5jLCB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycywgdGVuYW50RGF0YWJhc2VSZXNvbHZlciwgdGVuYW50UmVzb2x2ZXIsIHRlc3RUZW5hbnRQb29scywgdGVzdGluZywgdGltZVpvbmUsIHRpbWV6b25lT2Zmc2V0TWludXRlcywgdHJ1c3RlZFByb3hpZXMsIHdlYnNvY2tldENoYW5uZWxSZXNvbHZlciwgd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMuX2FiaWxpdHlSZXNvbHZlciA9IGFiaWxpdHlSZXNvbHZlclxuICAgIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSBhYmlsaXR5UmVzb3VyY2VzIHx8IFtdXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrcyA9IGFkdmlzb3J5TG9ja3NcbiAgICB0aGlzLl9hdXRvbG9hZCA9IGF1dG9sb2FkXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnMgPSBiYWNrZ3JvdW5kSm9ic1xuICAgIHRoaXMuX2JlYWNvbiA9IGJlYWNvblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGNsaWVudCB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGNvbm5lY3QgcHJvbWlzZSB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gcmVwb3J0IHRpbWVyIHZhbHVlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gLSBQZW5kaW5nIFwiYmVhY29uIHN0aWxsIHVucmVhY2hhYmxlXCIgcmVwb3J0IHRpbWVyLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gb3V0YWdlIHJlcG9ydGVkIHZhbHVlLlxuICAgICAqIEB0eXBlIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYmVhY29uIG91dGFnZSBoYXMgYWxyZWFkeSBiZWVuIHJlcG9ydGVkLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBsYXN0IGRvd24gZXJyb3IgdmFsdWUuXG4gICAgICogQHR5cGUge3tzdGFnZTogXCJiZWFjb24tY29ubmVjdFwiIHwgXCJiZWFjb24tZGlzY29ubmVjdFwiLCBlcnJvcjogRXJyb3J9IHwgdW5kZWZpbmVkfSAtIExhdGVzdCBiZWFjb24tZG93biBkZXRhaWxzLCByZXBvcnRlZCBvbmx5IGlmIHRoZSBvdXRhZ2UgaXMgc3VzdGFpbmVkLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyA9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzXG4gICAgdGhpcy5fYXR0YWNobWVudHMgPSBhdHRhY2htZW50cyB8fCB7fVxuICAgIC8vIENvcHkgc28gYXBwZW5kaW5nIHBhY2thZ2UtZGVyaXZlZCBlbnRyaWVzIGJlbG93IG5ldmVyIG11dGF0ZXMgYSBjYWxsZXInc1xuICAgIC8vIHNoYXJlZCBhcnJheSAoY29uZmlnIG1vZHVsZXMgY29tbW9ubHkgZXhwb3J0IGEgcmV1c2VkIGJhY2tlbmRQcm9qZWN0cyBhcnJheSkuXG4gICAgdGhpcy5fYmFja2VuZFByb2plY3RzID0gYmFja2VuZFByb2plY3RzID8gWy4uLmJhY2tlbmRQcm9qZWN0c10gOiBbXVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyVHlwZVtdfSAqL1xuICAgIHRoaXMuX2NsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVycyA9IFtdXG4gICAgdGhpcy5jb3JzID0gY29yc1xuICAgIHRoaXMuX2Nvb2tpZVNlY3JldCA9IGNvb2tpZVNlY3JldFxuICAgIHRoaXMuZGF0YWJhc2UgPSBkYXRhYmFzZVxuICAgIHRoaXMuZGVidWcgPSBkZWJ1Z1xuICAgIHRoaXMuX2RlYnVnRW5kcG9pbnQgPSB0aGlzLl9ub3JtYWxpemVEZWJ1Z0VuZHBvaW50KGRlYnVnRW5kcG9pbnQpXG4gICAgdGhpcy5fYXBpTWFuaWZlc3QgPSB0aGlzLl9ub3JtYWxpemVBcGlNYW5pZmVzdChhcGlNYW5pZmVzdClcbiAgICB0aGlzLl9tY3AgPSB0aGlzLl9ub3JtYWxpemVNY3AobWNwKVxuICAgIHRoaXMuX2Vudmlyb25tZW50ID0gZW52aXJvbm1lbnQgfHwgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0VOViB8fCBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5OT0RFX0VOViB8fCBcImRldmVsb3BtZW50XCJcbiAgICB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIgPSBlbnZpcm9ubWVudEhhbmRsZXJcbiAgICB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXNcbiAgICB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9IGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzID09PSB1bmRlZmluZWRcbiAgICAgID8gc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycyAhPT0gdHJ1ZVxuICAgICAgOiBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50c1xuICAgIHRoaXMuX2RpcmVjdG9yeSA9IGRpcmVjdG9yeVxuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHMgPSBpbml0aWFsaXplTW9kZWxzXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNQYWNrYWdlW119ICovXG4gICAgdGhpcy5fcGFja2FnZXMgPSAocGFja2FnZXMgfHwgW10pLm1hcCgoZW50cnkpID0+IFZlbG9jaW91c1BhY2thZ2UuZnJvbShlbnRyeSkpXG5cbiAgICAvLyBBcHBlbmQgYSBkZXJpdmVkIGJhY2tlbmQtcHJvamVjdCBwZXIgcGFja2FnZSBzbyB0aGUgZXhpc3RpbmcgcmVzb3VyY2VcbiAgICAvLyBkaXNjb3ZlcnkgKyBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uIG1hY2hpbmVyeSBpbmNsdWRlcyBpdC4gUGFja2FnZVxuICAgIC8vIGZyb250ZW5kIG1vZGVscyBhcmUgZ2VuZXJhdGVkIGludG8gdGhlIGFwcCdzIGZyb250ZW5kLW1vZGVscyBvdXRwdXQuXG4gICAgY29uc3QgYXBwRnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoID0gdGhpcy5fYmFja2VuZFByb2plY3RzWzBdPy5mcm9udGVuZE1vZGVsc091dHB1dFBhdGhcblxuICAgIGZvciAoY29uc3QgdmVsb2Npb3VzUGFja2FnZSBvZiB0aGlzLl9wYWNrYWdlcykge1xuICAgICAgdGhpcy5fYmFja2VuZFByb2plY3RzLnB1c2godmVsb2Npb3VzUGFja2FnZS50b0JhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbih7ZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoOiBhcHBGcm9udGVuZE1vZGVsc091dHB1dFBhdGh9KSlcbiAgICB9XG5cbiAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vaW5pdGlhbGl6ZXIuanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIEludmFsaWRhdGVzIG1vZGVsIHBoYXNlcyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGNsb3NlZC5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID0gMFxuICAgIC8qKlxuICAgICAqIEluLXByb2dyZXNzIGBpbml0aWFsaXplTW9kZWxzKClgIHByb21pc2UuIE1vZGVsIGluaXRpYWxpemF0aW9uIGlzIGFuXG4gICAgICogYXRvbWljIGJvb3RzdHJhcCBwaGFzZTogY29uY3VycmVudCBjYWxsZXJzIHNoYXJlIGl0LCBhbmQgYSByZWplY3Rpb25cbiAgICAgKiBsZWF2ZXMgdGhlIHBoYXNlIGVsaWdpYmxlIGZvciBhIGxhdGVyIGNvbXBsZXRlIGF0dGVtcHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGBpbml0aWFsaXplKClgIHByb21pc2UsIG1lbW9pemVkIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGVcbiAgICAgKiBzYW1lIGJvb3RzdHJhcC4gUmV0YWluZWQgYWNyb3NzIGEgY29ubmVjdGlvbiBjbG9zZSB1bnRpbCBzdGFsZSBib290c3RyYXBcbiAgICAgKiB3b3JrIHNldHRsZXMsIHRoZW4gY2xlYXJlZCBieSBpZGVudGl0eSBiZWZvcmUgdGhlIG5ldyBnZW5lcmF0aW9uIHJldHJpZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICBjb25zdCByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyID0gaHR0cFNlcnZlcj8ucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlclxuICAgIGNvbnN0IHdlYnNvY2tldEluYm91bmRRdWV1ZSA9IGh0dHBTZXJ2ZXI/LndlYnNvY2tldEluYm91bmRRdWV1ZVxuICAgIGNvbnN0IHdlYnNvY2tldE91dGJvdW5kUXVldWUgPSBodHRwU2VydmVyPy53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlXG5cbiAgICBpZiAocmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5odHRwU2VydmVyID0ge1xuICAgICAgLi4uKGh0dHBTZXJ2ZXIgfHwge30pLFxuICAgICAgY29tcHJlc3Npb246IG5vcm1hbGl6ZUh0dHBDb21wcmVzc2lvbihodHRwU2VydmVyPy5jb21wcmVzc2lvbiksXG4gICAgICBtYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzOiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIoaHR0cFNlcnZlcj8ubWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlcywgXCJodHRwU2VydmVyLm1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXNcIiksXG4gICAgICBtYXhSZXF1ZXN0Qm9keUJ5dGVzOiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIoaHR0cFNlcnZlcj8ubWF4UmVxdWVzdEJvZHlCeXRlcywgXCJodHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcIiksXG4gICAgICByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyLFxuICAgICAgd2Vic29ja2V0SW5ib3VuZFF1ZXVlOiB7XG4gICAgICAgIG1heFBlbmRpbmdCeXRlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRJbmJvdW5kUXVldWU/Lm1heFBlbmRpbmdCeXRlcywgXCJodHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZS5tYXhQZW5kaW5nQnl0ZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19CWVRFUyksXG4gICAgICAgIG1heFBlbmRpbmdNZXNzYWdlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRJbmJvdW5kUXVldWU/Lm1heFBlbmRpbmdNZXNzYWdlcywgXCJodHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZS5tYXhQZW5kaW5nTWVzc2FnZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19NRVNTQUdFUylcbiAgICAgIH0sXG4gICAgICB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlOiB7XG4gICAgICAgIG1heFBlbmRpbmdCeXRlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlPy5tYXhQZW5kaW5nQnl0ZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlLm1heFBlbmRpbmdCeXRlc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19CWVRFUyksXG4gICAgICAgIG1heFBlbmRpbmdGcmFtZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0T3V0Ym91bmRRdWV1ZT8ubWF4UGVuZGluZ0ZyYW1lcywgXCJodHRwU2VydmVyLndlYnNvY2tldE91dGJvdW5kUXVldWUubWF4UGVuZGluZ0ZyYW1lc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19GUkFNRVMpXG4gICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgaHR0cCBzZXJ2ZXIgaW5zdGFuY2UgdmFsdWUuXG4gICAgICogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90OiAoKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9jYWxlID0gbG9jYWxlXG4gICAgdGhpcy5sb2NhbGVGYWxsYmFja3MgPSBsb2NhbGVGYWxsYmFja3NcbiAgICB0aGlzLmxvY2FsZXMgPSBsb2NhbGVzXG4gICAgdGhpcy5faW5pdGlhbGl6ZXJzID0gaW5pdGlhbGl6ZXJzXG4gICAgdGhpcy5fdGVzdGluZyA9IHRlc3RpbmdcbiAgICB0aGlzLl90aW1lWm9uZSA9IHRpbWVab25lXG4gICAgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID0gdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgdGhpcy5fdHJ1c3RlZFByb3hpZXMgPSB0cnVzdGVkUHJveGllc1xuICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPSByZXF1ZXN0VGltZW91dE1zXG4gICAgdGhpcy5fc3RydWN0dXJlU3FsID0gc3RydWN0dXJlU3FsXG4gICAgdGhpcy5fc3luYyA9IHRoaXMuX25vcm1hbGl6ZVN5bmNDb25maWd1cmF0aW9uKHN5bmMpXG4gICAgdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgPSB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycyB8fCB7fVxuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIgPSB0ZW5hbnREYXRhYmFzZVJlc29sdmVyXG4gICAgdGhpcy5fdGVuYW50UmVzb2x2ZXIgPSB0ZW5hbnRSZXNvbHZlclxuICAgIHRoaXMuX3Rlc3RUZW5hbnRQb29scyA9IHRlc3RUZW5hbnRQb29sc1xuICAgIHRoaXMuX3dlYnNvY2tldEV2ZW50cyA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaWJlcnMgdmFsdWUuXG4gICAgICogQHR5cGUge1ZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIgPSB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIENoYW5uZWwgdHlwZXMgcmVnaXN0ZXJlZCB3aXRoIGB7bGl2ZU9ubHk6IHRydWV9YDogdGhlaXIgdHJhZmZpYyBpc1xuICAgICAqIG5ldmVyIHBlcnNpc3RlZCBmb3IgcmVwbGF5LCBhbmQgYG1hcmtDaGFubmVsSW50ZXJlc3RlZGAgcmVqZWN0cyB0aGVcbiAgICAgKiBuYW1lLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICB0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmlwdGlvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIFNldDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQ+Pn0gLSBjaGFubmVsVHlwZSDihpIgbGl2ZSBzdWJzY3JpcHRpb25zIGFjcm9zcyBhbGwgc2Vzc2lvbnMuXG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBsb2NhbCAocGVyLXByb2Nlc3MpIHdlYnNvY2tldCBjaGFubmVsIGJyb2FkY2FzdCBkZWxpdmVyaWVzLFxuICAgICAqIGxhdW5jaGVkIGZpcmUtYW5kLWZvcmdldCBmcm9tIGBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWxgIHNvIG9uZSBzbG93XG4gICAgICogc3Vic2NyaWJlciBuZXZlciBibG9ja3MgYW5vdGhlci4gVHJhY2tlZCBoZXJlIHNvXG4gICAgICogYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGNhbiBzbmFwc2hvdCBhbmQgZHJhaW4gdGhlbSBiZWZvcmUgc2V0dGxpbmcuXG4gICAgICogU2V0dGxlZCBkZWxpdmVyaWVzIGFyZSByZW1vdmVkIGJ5IHRoZSB0cmFja2luZy1sZXZlbCBjbGVhbnVwLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBMYXRlc3QgbG9jYWwgYnJvYWRjYXN0IGRlbGl2ZXJ5IHBlciBzdWJzY3JpcHRpb24uIENoYWluaW5nIHN1YnNlcXVlbnRcbiAgICAgKiBkZWxpdmVyaWVzIHByZXNlcnZlcyBsaWZlY3ljbGUgZXZlbnQgb3JkZXIgd2l0aG91dCBjb3VwbGluZyBzZXBhcmF0ZVxuICAgICAqIHN1YnNjcmliZXJzIHRvIG9uZSBhbm90aGVyLlxuICAgICAqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdCwgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzID0gbmV3IFdlYWtNYXAoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgc2Vzc2lvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0Pn0gLSBMaXZlIHdlYnNvY2tldCBzZXNzaW9ucywgaW5jbHVkaW5nIHBhdXNlZCBzZXNzaW9ucyB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdy5cbiAgICAgKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9ucyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBwYXVzZWQgd2Vic29ja2V0IHNlc3Npb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7c2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgZ3JhY2VUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4sIHBhdXNlZEF0OiBudW1iZXJ9Pn0gLSBzZXNzaW9uSWQg4oaSIHBhdXNlZCBzZXNzaW9uIGF3YWl0aW5nIHJlc3VtZS5cbiAgICAgKi9cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqIEdyYWNlIHBlcmlvZCBmb3IgcGF1c2VkIFdlYlNvY2tldCBzZXNzaW9ucyBiZWZvcmUgcGVybWFuZW50IHRlYXJkb3duLiAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgPSAzMDBcblxuICAgIC8qKiBJbnRlcnZhbCAoc2Vjb25kcykgYmV0d2VlbiBzZXJ2ZXLihpJjbGllbnQgaGVhcnRiZWF0IHBpbmdzOyAwIGRpc2FibGVzIHJlYXBpbmcgb2Ygc2lsZW50IHNvY2tldHMuICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgPSAzMFxuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgd3JhcHBlciBjYWxsZWQgYXJvdW5kIGV2ZXJ5IFdlYlNvY2tldC1ib3JuZSByZXF1ZXN0IC9cbiAgICAgKiBjb25uZWN0aW9uIG1lc3NhZ2UgLyBjaGFubmVsIGRpc3BhdGNoLiBBcHBzIHJlZ2lzdGVyIGl0IGhlcmVcbiAgICAgKiB0byBzZXQgdXAgcGVyLXJlcXVlc3QgY29udGV4dCAoZS5nLiBBc3luY0xvY2FsU3RvcmFnZSBmb3JcbiAgICAgKiBsb2NhbGUsIHRlbmFudCwgdHJhY2luZykgdGhhdCBkb3duc3RyZWFtIGhhbmRsZXJzIHJlYWQuXG4gICAgICogQHR5cGUgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfVxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3QgPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGFyb3VuZCBhY3Rpb24gdmFsdWUuXG4gICAgICogQHR5cGUgeygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAqL1xuICAgIHRoaXMuX2Fyb3VuZEFjdGlvbiA9IG51bGxcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IHNlc3Npb24gaWRlbnRpdHkgcmVzb2x2ZXIgdmFsdWUuXG4gICAgICogQHR5cGUgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyID0gbnVsbFxuICAgIHRoaXMuX2xvZ2dpbmcgPSBsb2dnaW5nXG4gICAgdGhpcy5fbG9nUmVkYWN0b3IgPSBuZXcgTG9nUmVkYWN0b3Ioe3NlbnNpdGl2ZU5hbWVzOiBsb2dnaW5nPy5zZW5zaXRpdmVOYW1lc30pXG4gICAgdGhpcy5fbWFpbGVyQmFja2VuZCA9IG1haWxlckJhY2tlbmRcbiAgICB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MgPSBbLi4uKHJvdXRlUmVzb2x2ZXJIb29rcyB8fCBbXSldXG4gICAgdGhpcy5fYWRkRGVidWdFbmRwb2ludFJvdXRlSG9vaygpXG4gICAgdGhpcy5fYWRkQXBpTWFuaWZlc3RSb3V0ZUhvb2soKVxuICAgIHRoaXMuX2FkZE1jcFJvdXRlSG9vaygpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGFwcGxpZWQgcm91dGUgbW91bnRzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtXZWFrU2V0PG9iamVjdD59ICovXG4gICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2Vycm9yRXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGRhdGFiYXNlIHBvb2xzIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzID0ge31cbiAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSA9IG5ldyBGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSh7Y29uZmlndXJhdGlvbjogdGhpcywgbWF4T3BlbkhhbmRsZXM6IGZyb250ZW5kVGVuYW50U3FsaXRlPy5tYXhPcGVuSGFuZGxlc30pXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIG1vZGVsIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiB0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5tb2RlbENsYXNzZXMgPSB7fVxuXG4gICAgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5zZXRDb25maWd1cmF0aW9uKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0b2xvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIG9uIGxhenkgYWNjZXNzIGlzIGVuYWJsZWQgZ2xvYmFsbHkuXG4gICAqL1xuICBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIHRoaXMuX2F1dG9sb2FkIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhwb3NlIGludGVybmFsIGVycm9ycyB0byBjbGllbnRzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB1bmV4cGVjdGVkIGludGVybmFsIGVycm9yIGRldGFpbHMgbWF5IGJlIHJldHVybmVkIHRvIEFQSSBjbGllbnRzLlxuICAgKi9cbiAgZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSB7IHJldHVybiB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9PT0gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBmcm9udGVuZC1tb2RlbCBlcnJvcnMgZXhwb3NlIG9ubHkgZXhwbGljaXRseSBzYWZlIG1lc3NhZ2VzLlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKClgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBpbnRlcm5hbCBlcnJvciBleHBvc3VyZSBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGdldFNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMoKSB7IHJldHVybiAhdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgZW5kcG9pbnQuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERlYnVnRW5kcG9pbnQoKSB7IHJldHVybiB0aGlzLl9kZWJ1Z0VuZHBvaW50IH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBwYXRoOiBzdHJpbmcsIHRva2VuQ29uZmlndXJlZDogYm9vbGVhbn19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlnIGZvciB0aGUgc25hcHNob3QsIHdpdGggdGhlIHRva2VuIHJlZGFjdGVkLlxuICAgKi9cbiAgX2RlYnVnRW5kcG9pbnRTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdGhpcy5fZGVidWdFbmRwb2ludC5lbmFibGVkLFxuICAgICAgcGF0aDogdGhpcy5fZGVidWdFbmRwb2ludC5wYXRoLFxuICAgICAgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2RlYnVnRW5kcG9pbnQudG9rZW4pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRlYnVnIGVuZHBvaW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBkZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZURlYnVnRW5kcG9pbnQodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvdmVsb2Npb3VzL2RlYnVnXCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvdmVsb2Npb3VzL2RlYnVnXCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50LnBhdGggdG8gYmUgYSBzdHJpbmcgc3RhcnRpbmcgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocGF0aCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IHZhbHVlLnRva2VuID09PSB1bmRlZmluZWQgfHwgdmFsdWUudG9rZW4gPT09IG51bGwgPyBudWxsIDogdmFsdWUudG9rZW5cblxuICAgIGlmICh0b2tlbiAhPT0gbnVsbCAmJiAodHlwZW9mIHRva2VuICE9PSBcInN0cmluZ1wiIHx8ICF0b2tlbi50cmltKCkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlYnVnRW5kcG9pbnQudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBhcGkgbWFuaWZlc3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IHtwYXRoPzogc3RyaW5nLCB0b2tlbj86IHN0cmluZ319IHZhbHVlIC0gQVBJIG1hbmlmZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBBUEkgbWFuaWZlc3QgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVBcGlNYW5pZmVzdCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgcGF0aDogXCIvYXBpL21hbmlmZXN0XCIsIHRva2VuOiBudWxsfVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoOiBcIi9hcGkvbWFuaWZlc3RcIiwgdG9rZW46IG51bGx9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFwaU1hbmlmZXN0IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvYXBpL21hbmlmZXN0XCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC50b2tlbiB0byBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcodG9rZW4pfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoLCB0b2tlbjogdG9rZW4gPT09IG51bGwgPyBudWxsIDogdG9rZW4udHJpbSgpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGFwaSBtYW5pZmVzdCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkQXBpTWFuaWZlc3RSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9hcGlNYW5pZmVzdC5lbmFibGVkKSByZXR1cm5cblxuICAgIHRoaXMuYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gXCJHRVRcIikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChjdXJyZW50UGF0aCAhPT0gdGhpcy5fYXBpTWFuaWZlc3QucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9hcGlNYW5pZmVzdC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJzaG93XCIsXG4gICAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzQXBpTWFuaWZlc3RcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9hcGktbWFuaWZlc3QvY29udHJvbGxlci5qc1wiLFxuICAgICAgICBza2lwQ29udHJvbGxlckNvbm5lY3Rpb25zOiB0cnVlLFxuICAgICAgICBza2lwQWJpbGl0eVJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICB2aWV3UGF0aDogXCIuL2J1aWx0LWluL2FwaS1tYW5pZmVzdFwiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBtY3AuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IHtwYXRoPzogc3RyaW5nLCB0b2tlbj86IHN0cmluZ319IHZhbHVlIC0gTUNQIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBNQ1AgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVNY3AodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL21jcFwiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvbWNwXCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBtY3AgdG8gYmUgYSBib29sZWFuIG9yIG9iamVjdCwgZ290OiAke1N0cmluZyh2YWx1ZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gdmFsdWUucGF0aCB8fCBcIi9tY3BcIlxuXG4gICAgaWYgKHR5cGVvZiBwYXRoICE9PSBcInN0cmluZ1wiIHx8ICFwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG1jcC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBtY3AudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBtY3Agcm91dGUgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FkZE1jcFJvdXRlSG9vaygpIHtcbiAgICBpZiAoIXRoaXMuX21jcC5lbmFibGVkKSByZXR1cm5cblxuICAgIHRoaXMuYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gXCJQT1NUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX21jcC5wYXRoKSByZXR1cm4gbnVsbFxuXG4gICAgICAvLyBXaGVuIGEgdG9rZW4gaXMgY29uZmlndXJlZCwgYW4gdW5hdXRoZW50aWNhdGVkIHJlcXVlc3QgZ2V0cyBubyByb3V0ZSBhdFxuICAgICAgLy8gYWxsICg0MDQpIHJhdGhlciB0aGFuIGEgNDAxLCBzbyB0aGUgZW5kcG9pbnQncyBleGlzdGVuY2Ugc3RheXMgaGlkZGVuLlxuICAgICAgaWYgKHRoaXMuX21jcC50b2tlbiAmJiAhdGhpcy5kZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgdGhpcy5fbWNwLnRva2VuKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uOiBcImhhbmRsZVwiLFxuICAgICAgICBjb250cm9sbGVyOiBcInZlbG9jaW91c01jcFwiLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogXCIuL2J1aWx0LWluL21jcC9jb250cm9sbGVyLmpzXCIsXG4gICAgICAgIC8vIFRlbmFudCBhbmQgYWJpbGl0eSByZXNvbHV0aW9uIGJlbG9uZyB0byB0aGUgZnJvbnRlbmQtbW9kZWwgZGlzcGF0Y2hlclxuICAgICAgICAvLyBwZXIgY29tbWFuZCAod2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCksIGV4YWN0bHkgbGlrZSB0aGUgcmVndWxhclxuICAgICAgICAvLyAvZnJvbnRlbmQtbW9kZWxzIHJvdXRlIOKAlCB0aGUgTUNQIHRyYW5zcG9ydCBuZXZlciBieXBhc3NlcyB0aGVtLlxuICAgICAgICBza2lwQWJpbGl0eVJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICB2aWV3UGF0aDogXCIuL2J1aWx0LWluL21jcFwiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBkZWJ1ZyBlbmRwb2ludCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkRGVidWdFbmRwb2ludFJvdXRlSG9vaygpIHtcbiAgICBpZiAoIXRoaXMuX2RlYnVnRW5kcG9pbnQuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiR0VUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX2RlYnVnRW5kcG9pbnQucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgLy8gV2hlbiBhIHRva2VuIGlzIGNvbmZpZ3VyZWQsIGFuIHVuYXV0aGVudGljYXRlZCByZXF1ZXN0IGdldHMgbm8gcm91dGUgYXRcbiAgICAgIC8vIGFsbCAoNDA0KSByYXRoZXIgdGhhbiBhIDQwMSwgc28gdGhlIGVuZHBvaW50J3MgZXhpc3RlbmNlIHN0YXlzIGhpZGRlbi5cbiAgICAgIGlmICh0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uOiBcInNob3dcIixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNEZWJ1Z1wiLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogXCIuL2J1aWx0LWluL2RlYnVnL2NvbnRyb2xsZXIuanNcIixcbiAgICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uczogdHJ1ZSxcbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9kZWJ1Z1wiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdXRvbG9hZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyB0aGlzLl9hdXRvbG9hZCA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29ycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Db3JzVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgY29ycy5cbiAgICovXG4gIGdldENvcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGh0dHAgc2VydmVyIGNvbXByZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgYnVmZmVyZWQgcmVzcG9uc2UgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBTZXJ2ZXJDb21wcmVzc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy5odHRwU2VydmVyLmNvbXByZXNzaW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbWF4aW11bSBidWZmZXJlZCByZXNwb25zZSBib2R5IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgYnl0ZSBsaW1pdCwgb3IgdW5kZWZpbmVkIHdoZW4gdW5ib3VuZGVkLlxuICAgKi9cbiAgZ2V0SHR0cFNlcnZlck1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5tYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbWF4aW11bSByZXF1ZXN0IGJvZHkgYnl0ZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBieXRlIGxpbWl0LCBvciB1bmRlZmluZWQgd2hlbiB1bmJvdW5kZWQuXG4gICAqL1xuICBnZXRIdHRwU2VydmVyTWF4UmVxdWVzdEJvZHlCeXRlcygpIHtcbiAgICByZXR1cm4gdGhpcy5odHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyByZXF1ZXN0LWJvZHkgaGFuZGxpbmcgYWZ0ZXIgdGhlIHJlcXVlc3QgbGluZSBhbmQgaGVhZGVycyBhcmUgY29tcGxldGUsXG4gICAqIGJlZm9yZSBib2R5IGJ5dGVzIGFyZSByZXRhaW5lZCBvciBkZWNvZGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5IdHRwUmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlckFyZ3N9IGFyZ3MgLSBQYXJzZWQgcmVxdWVzdCBoZWFkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkSHR0cFJlcXVlc3RCb2R5UG9saWN5fSAtIEVmZmVjdGl2ZSByZXF1ZXN0IHBvbGljeS5cbiAgICovXG4gIHJlc29sdmVIdHRwUmVxdWVzdEJvZHlQb2xpY3koYXJncykge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5odHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJcbiAgICBjb25zdCBjb25maWd1cmVkUG9saWN5ID0gcmVzb2x2ZXIgPyByZXNvbHZlcihhcmdzKSA6IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkSHR0cFJlcXVlc3RCb2R5UG9saWN5fSAqL1xuICAgIGxldCByZXNvbHZlZFBvbGljeVxuXG4gICAgaWYgKGNvbmZpZ3VyZWRQb2xpY3kgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVzb2x2ZWRQb2xpY3kgPSB7bWF4UmVxdWVzdEJvZHlCeXRlczogdGhpcy5odHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXMsIG1vZGU6IFwicGFyc2VkXCJ9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghY29uZmlndXJlZFBvbGljeSB8fCB0eXBlb2YgY29uZmlndXJlZFBvbGljeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmZpZ3VyZWRQb2xpY3kpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgbXVzdCByZXR1cm4gYW4gb2JqZWN0IG9yIHVuZGVmaW5lZFwiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCB7bWF4UmVxdWVzdEJvZHlCeXRlcywgbW9kZSA9IFwicGFyc2VkXCIsIC4uLnJlc3RQb2xpY3l9ID0gY29uZmlndXJlZFBvbGljeVxuICAgICAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhyZXN0UG9saWN5KVxuXG4gICAgICBpZiAodW5rbm93bktleXMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgcmV0dXJuZWQgdW5rbm93biBrZXlzOiAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogbWF4UmVxdWVzdEJvZHlCeXRlcywgbW9kZSlgKVxuICAgICAgfVxuICAgICAgaWYgKG1vZGUgIT09IFwicGFyc2VkXCIgJiYgbW9kZSAhPT0gXCJyYXdcIikge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgbW9kZSBtdXN0IGJlIFwicGFyc2VkXCIgb3IgXCJyYXdcIiwgZ290OiAke1N0cmluZyhtb2RlKX1gKVxuICAgICAgfVxuXG4gICAgICByZXNvbHZlZFBvbGljeSA9IHtcbiAgICAgICAgbWF4UmVxdWVzdEJvZHlCeXRlczogbWF4UmVxdWVzdEJvZHlCeXRlcyA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyB0aGlzLmh0dHBTZXJ2ZXIubWF4UmVxdWVzdEJvZHlCeXRlc1xuICAgICAgICAgIDogb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKG1heFJlcXVlc3RCb2R5Qnl0ZXMsIFwiaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG1heFJlcXVlc3RCb2R5Qnl0ZXNcIiksXG4gICAgICAgIG1vZGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXBwbHlNY3BSZXF1ZXN0Qm9keVBvbGljeURlZmF1bHRzKHthcmdzLCBwb2xpY3k6IHJlc29sdmVkUG9saWN5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbmZvcmNlcyB0aGUgYnVpbHQtaW4gTUNQIGVuZHBvaW50J3MgYm9keSBjb250cmFjdCB3aXRob3V0IHBlci1hcHAgcGx1bWJpbmc6IHRoZVxuICAgKiBKU09OLVJQQyBlbnZlbG9wZSBpcyByZWFkIGZyb20gcGFyc2VkIHBhcmFtcywgc28gcmF3IG1vZGUgaXMgcmVqZWN0ZWQgd2l0aCBhblxuICAgKiBhY3Rpb25hYmxlIGVycm9yLCBhbmQgYSBmcmFtZXdvcmsgZGVmYXVsdCBieXRlIGNhcCBhcHBsaWVzIHdoZW4gdGhlIGFwcCBjb25maWd1cmVkIG5vbmUuXG4gICAqIEBwYXJhbSB7e2FyZ3M6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5IdHRwUmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlckFyZ3MsIHBvbGljeTogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkSHR0cFJlcXVlc3RCb2R5UG9saWN5fX0gb3B0aW9ucyAtIFJlc29sdXRpb24gaW5wdXRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkSHR0cFJlcXVlc3RCb2R5UG9saWN5fSAtIEVmZmVjdGl2ZSByZXF1ZXN0IHBvbGljeS5cbiAgICovXG4gIF9hcHBseU1jcFJlcXVlc3RCb2R5UG9saWN5RGVmYXVsdHMoe2FyZ3MsIHBvbGljeX0pIHtcbiAgICBpZiAoIXRoaXMuX21jcC5lbmFibGVkKSByZXR1cm4gcG9saWN5XG4gICAgaWYgKGFyZ3MuaHR0cE1ldGhvZCAhPT0gXCJQT1NUXCIpIHJldHVybiBwb2xpY3lcbiAgICBpZiAoYXJncy5wYXRoLnNwbGl0KFwiP1wiKVswXSAhPT0gdGhpcy5fbWNwLnBhdGgpIHJldHVybiBwb2xpY3lcblxuICAgIGlmIChwb2xpY3kubW9kZSA9PT0gXCJyYXdcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgYFRoZSBidWlsdC1pbiBNQ1AgZW5kcG9pbnQgYXQgJHt0aGlzLl9tY3AucGF0aH0gcmVxdWlyZXMgcGFyc2VkIHJlcXVlc3QgYm9kaWVzIGJlY2F1c2UgaXRzIEpTT04tUlBDIGVudmVsb3BlIGlzIHJlYWQgZnJvbSBwYXJhbXMuIFJlbW92ZSB0aGUgcmF3LW1vZGUgaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIGVudHJ5IGZvciB0aGlzIHBhdGguYFxuICAgICAgKVxuICAgIH1cblxuICAgIGlmIChwb2xpY3kubWF4UmVxdWVzdEJvZHlCeXRlcyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gcG9saWN5XG5cbiAgICByZXR1cm4ge21heFJlcXVlc3RCb2R5Qnl0ZXM6IERFRkFVTFRfTUNQX01BWF9SRVFVRVNUX0JPRFlfQllURVMsIG1vZGU6IHBvbGljeS5tb2RlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvb2tpZSBzZWNyZXQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29va2llIHNlY3JldC5cbiAgICovXG4gIGdldENvb2tpZVNlY3JldCgpIHtcbiAgICByZXR1cm4gdGhpcy5fY29va2llU2VjcmV0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRWZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbn0gLSBTeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRTeW5jQ29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fc3luY1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBvZmZsaW5lIGdyYW50IHNpZ25pbmcga2V5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50U2lnbmluZ0tleX0gLSBDdXJyZW50IHNpZ25pbmcga2V5LlxuICAgKi9cbiAgY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoKSB7XG4gICAgY29uc3Qgc2lnbmluZ0tleXMgPSB0aGlzLmdldFN5bmNDb25maWd1cmF0aW9uKCkub2ZmbGluZUdyYW50U2lnbmluZ0tleXNcblxuICAgIHJldHVybiBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleShzaWduaW5nS2V5cylcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IHN5bmMgLSBTeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZFZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNDb25maWd1cmF0aW9uKHN5bmMpIHtcbiAgICBjb25zdCBhcGkgPSBzeW5jPy5hcGlcbiAgICBjb25zdCBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgPSBzeW5jPy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgfHwgbnVsbFxuICAgIGNvbnN0IGNoYW5nZUZlZWRSZXRlbnRpb25TaXplID0gc3luYz8uY2hhbmdlRmVlZFJldGVudGlvblNpemVcbiAgICBjb25zdCBvZmZsaW5lR3JhbnRTaWduaW5nS2V5cyA9IHN5bmM/Lm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzIHx8IFtdXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50VHRsTXMgPSBzeW5jPy5vZmZsaW5lR3JhbnRUdGxNc1xuXG4gICAgaWYgKGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSAhPT0gbnVsbCAmJiAodHlwZW9mIGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSBtdXN0IGJlIGEgcHVibGljIEpTT04gV2ViIEtleSBvYmplY3RcIilcbiAgICB9XG4gICAgaWYgKGNoYW5nZUZlZWRSZXRlbnRpb25TaXplICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKGNoYW5nZUZlZWRSZXRlbnRpb25TaXplKSB8fCBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlclwiKVxuICAgIH1cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob2ZmbGluZUdyYW50U2lnbmluZ0tleXMpKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzIG11c3QgYmUgYW4gYXJyYXlcIilcbiAgICBpZiAob2ZmbGluZUdyYW50VHRsTXMgIT09IHVuZGVmaW5lZCAmJiAoIU51bWJlci5pc0ludGVnZXIob2ZmbGluZUdyYW50VHRsTXMpIHx8IG9mZmxpbmVHcmFudFR0bE1zIDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLm9mZmxpbmVHcmFudFR0bE1zIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyIG51bWJlciBvZiBtaWxsaXNlY29uZHNcIilcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYXBpOiB0aGlzLl9ub3JtYWxpemVTeW5jQXBpQ29uZmlndXJhdGlvbihhcGkpLFxuICAgICAgY2hhbmdlRmVlZFJldGVudGlvblNpemU6IGNoYW5nZUZlZWRSZXRlbnRpb25TaXplIHx8IDEwMDAwLFxuICAgICAgY2xpZW50OiB0aGlzLl9ub3JtYWxpemVTeW5jQ2xpZW50Q29uZmlndXJhdGlvbihzeW5jPy5jbGllbnQpLFxuICAgICAgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5LFxuICAgICAgb2ZmbGluZUdyYW50U2lnbmluZ0tleXM6IG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzLm1hcCgoa2V5KSA9PiBub3JtYWxpemVPZmZsaW5lR3JhbnRTaWduaW5nS2V5KGtleSkpLFxuICAgICAgb2ZmbGluZUdyYW50VHRsTXM6IG9mZmxpbmVHcmFudFR0bE1zIHx8IDI0ICogNjAgKiA2MCAqIDEwMDBcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBjbGllbnQtc2lkZSBzeW5jIGNvbmZpZ3VyYXRpb24gY29uc3VtZWQgYnkgYFN5bmNDbGllbnQuZnJvbUNvbmZpZ3VyYXRpb24oLi4uKWAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBjbGllbnQgLSBDbGllbnQtc2lkZSBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZFZlbG9jaW91c1N5bmNDbGllbnRDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgY2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNDbGllbnRDb25maWd1cmF0aW9uKGNsaWVudCkge1xuICAgIGlmIChjbGllbnQgPT09IHVuZGVmaW5lZCB8fCBjbGllbnQgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGlmICh0eXBlb2YgY2xpZW50ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY2xpZW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCB0cmFuc3BvcnQgYW5kIGF1dGhlbnRpY2F0aW9uVG9rZW5cIilcbiAgICB9XG5cbiAgICBjb25zdCB7YXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBpc09ubGluZSwgbW91bnRQYXRoLCBvbkVycm9yLCBvZmZsaW5lLCByZWFsdGltZSwgdHJhbnNwb3J0LCB3ZWJzb2NrZXRDbGllbnQsIHdlYnNvY2tldFVybCwgLi4ucmVzdENsaWVudH0gPSBjbGllbnRcbiAgICBjb25zdCByZXN0Q2xpZW50S2V5cyA9IE9iamVjdC5rZXlzKHJlc3RDbGllbnQpXG5cbiAgICBpZiAocmVzdENsaWVudEtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudCByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7cmVzdENsaWVudEtleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBhdXRoZW50aWNhdGlvblRva2VuLCBiYXRjaFNpemUsIGlzT25saW5lLCBtb3VudFBhdGgsIG9uRXJyb3IsIG9mZmxpbmUsIHJlYWx0aW1lLCB0cmFuc3BvcnQsIHdlYnNvY2tldENsaWVudCwgd2Vic29ja2V0VXJsKWApXG4gICAgfVxuICAgIGlmICghdHJhbnNwb3J0IHx8IHR5cGVvZiB0cmFuc3BvcnQgIT09IFwib2JqZWN0XCIgfHwgdHlwZW9mIHRyYW5zcG9ydC5wb3N0ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LnRyYW5zcG9ydCBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGEgcG9zdChwYXRoLCBib2R5KSBtZXRob2QgKGxpa2UgdGhlIGZyb250ZW5kLW1vZGVsIHdlYnNvY2tldCBjbGllbnQpXCIpXG4gICAgfVxuICAgIGlmICh0eXBlb2YgYXV0aGVudGljYXRpb25Ub2tlbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5hdXRoZW50aWNhdGlvblRva2VuIG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgdGhlIGF1dGggdG9rZW4gc2VudCB3aXRoIHN5bmMgcmVxdWVzdHNcIilcbiAgICB9XG4gICAgaWYgKGlzT25saW5lICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGlzT25saW5lICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LmlzT25saW5lIG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgY29ubmVjdGl2aXR5XCIpXG4gICAgfVxuICAgIGlmIChvbkVycm9yICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9uRXJyb3IgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub25FcnJvciBtdXN0IGJlIGEgZnVuY3Rpb24gcmVwb3J0aW5nIGJhY2tncm91bmQgc3luYyBmYWlsdXJlc1wiKVxuICAgIH1cbiAgICBpZiAoYmF0Y2hTaXplICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKGJhdGNoU2l6ZSkgfHwgYmF0Y2hTaXplIDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5iYXRjaFNpemUgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJcIilcbiAgICB9XG4gICAgaWYgKG1vdW50UGF0aCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgbW91bnRQYXRoICE9PSBcInN0cmluZ1wiIHx8ICFtb3VudFBhdGguc3RhcnRzV2l0aChcIi9cIikpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50Lm1vdW50UGF0aCBtdXN0IHN0YXJ0IHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKG1vdW50UGF0aCl9YClcbiAgICB9XG4gICAgaWYgKHdlYnNvY2tldENsaWVudCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2Ygd2Vic29ja2V0Q2xpZW50ICE9PSBcIm9iamVjdFwiIHx8IHdlYnNvY2tldENsaWVudCA9PT0gbnVsbCB8fCB0eXBlb2Ygd2Vic29ja2V0Q2xpZW50LnN1YnNjcmliZUNoYW5uZWwgIT09IFwiZnVuY3Rpb25cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LndlYnNvY2tldENsaWVudCBtdXN0IGJlIGEgd2Vic29ja2V0IGNsaWVudCB3aXRoIGEgc3Vic2NyaWJlQ2hhbm5lbCBtZXRob2QgKGxpa2UgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KVwiKVxuICAgIH1cbiAgICBpZiAod2Vic29ja2V0VXJsICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHdlYnNvY2tldFVybCAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2Ygd2Vic29ja2V0VXJsICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQud2Vic29ja2V0VXJsIG11c3QgYmUgYSBVUkwgc3RyaW5nIG9yIGEgZnVuY3Rpb24gcmVzb2x2aW5nIG9uZSwgZ290OiAke1N0cmluZyh3ZWJzb2NrZXRVcmwpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBiYXRjaFNpemUsXG4gICAgICBpc09ubGluZSxcbiAgICAgIG1vdW50UGF0aDogKG1vdW50UGF0aCB8fCBcIi92ZWxvY2lvdXMvc3luY1wiKS5yZXBsYWNlKC9cXC8rJC91LCBcIlwiKSB8fCBcIi9cIixcbiAgICAgIG9mZmxpbmU6IHRoaXMuX25vcm1hbGl6ZVN5bmNDbGllbnRPZmZsaW5lQ29uZmlndXJhdGlvbihvZmZsaW5lKSxcbiAgICAgIG9uRXJyb3IsXG4gICAgICByZWFsdGltZSxcbiAgICAgIHRyYW5zcG9ydCxcbiAgICAgIHdlYnNvY2tldENsaWVudCxcbiAgICAgIHdlYnNvY2tldFVybFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHRoZSBjbGllbnQtc2lkZSBsb25nLW9mZmxpbmUgc2Vzc2lvbiBjb25maWd1cmF0aW9uIGNvbnN1bWVkIGJ5XG4gICAqIGBTeW5jQ2xpZW50LnN0YXJ0T2ZmbGluZVNlc3Npb24oKWAuIFRoZSBmcmFtZXdvcmsgb3ducyB0aGUgc2Vzc2lvblxuICAgKiBsaWZlY3ljbGU7IHRoZSBhcHAgcHJvdmlkZXMgZHVyYWJsZSBpZGVudGl0eSBzdG9yYWdlLCB0aGUgZW5yb2xsbWVudCBob29rLFxuICAgKiBhbmQgdGhlIGdyYW50IHNjb3BlcyBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NsaWVudE9mZmxpbmVDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBvZmZsaW5lIC0gT2ZmbGluZSBjb25maWd1cmF0aW9uIGJsb2NrLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRWZWxvY2lvdXNTeW5jQ2xpZW50T2ZmbGluZUNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCBvZmZsaW5lIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0NsaWVudE9mZmxpbmVDb25maWd1cmF0aW9uKG9mZmxpbmUpIHtcbiAgICBpZiAob2ZmbGluZSA9PT0gdW5kZWZpbmVkIHx8IG9mZmxpbmUgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGlmICh0eXBlb2Ygb2ZmbGluZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG9mZmxpbmUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lIG11c3QgYmUgYW4gb2JqZWN0IHdpdGggZGV2aWNlSWRlbnRpdHlTdG9yYWdlLCBlbnJvbGxEZXZpY2UsIGFuZCBncmFudFNjb3Blc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IHtiYWNrZW5kUHVibGljS2V5LCBib290c3RyYXBQYXRoLCBkZXZpY2VJZGVudGl0eVN0b3JhZ2UsIGVucm9sbERldmljZSwgZ3JhbnRTY29wZXMsIGdyYW50U3RvcmFnZSwgbXV0YXRpb25Mb2csIG5vdywgcmVwbGF5UGF0aCwgLi4ucmVzdE9mZmxpbmV9ID0gb2ZmbGluZVxuICAgIGNvbnN0IHJlc3RPZmZsaW5lS2V5cyA9IE9iamVjdC5rZXlzKHJlc3RPZmZsaW5lKVxuXG4gICAgaWYgKHJlc3RPZmZsaW5lS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50Lm9mZmxpbmUgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RPZmZsaW5lS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGJhY2tlbmRQdWJsaWNLZXksIGJvb3RzdHJhcFBhdGgsIGRldmljZUlkZW50aXR5U3RvcmFnZSwgZW5yb2xsRGV2aWNlLCBncmFudFNjb3BlcywgZ3JhbnRTdG9yYWdlLCBtdXRhdGlvbkxvZywgbm93LCByZXBsYXlQYXRoKWApXG4gICAgfVxuICAgIGlmICghZGV2aWNlSWRlbnRpdHlTdG9yYWdlIHx8IHR5cGVvZiBkZXZpY2VJZGVudGl0eVN0b3JhZ2UgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkZXZpY2VJZGVudGl0eVN0b3JhZ2UpIHx8IHR5cGVvZiBkZXZpY2VJZGVudGl0eVN0b3JhZ2UubG9hZCAhPT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiBkZXZpY2VJZGVudGl0eVN0b3JhZ2Uuc2F2ZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmRldmljZUlkZW50aXR5U3RvcmFnZSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGxvYWQoKSBhbmQgc2F2ZShpZGVudGl0eSkgbWV0aG9kc1wiKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGVucm9sbERldmljZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmVucm9sbERldmljZSBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIHRoZSBiYWNrZW5kLXNpZ25lZCBkZXZpY2UgY2VydGlmaWNhdGVcIilcbiAgICBpZiAodHlwZW9mIGdyYW50U2NvcGVzICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9mZmxpbmUuZ3JhbnRTY29wZXMgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgYm9vdHN0cmFwIGdyYW50IHNjb3Blc1wiKVxuICAgIGlmIChiYWNrZW5kUHVibGljS2V5ICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBiYWNrZW5kUHVibGljS2V5ICE9PSBcIm9iamVjdFwiIHx8IGJhY2tlbmRQdWJsaWNLZXkgPT09IG51bGwgfHwgQXJyYXkuaXNBcnJheShiYWNrZW5kUHVibGljS2V5KSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9mZmxpbmUuYmFja2VuZFB1YmxpY0tleSBtdXN0IGJlIGEgcHVibGljIEpTT04gV2ViIEtleSBvYmplY3RcIilcbiAgICB9XG4gICAgaWYgKGJvb3RzdHJhcFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIGJvb3RzdHJhcFBhdGggIT09IFwic3RyaW5nXCIgfHwgIWJvb3RzdHJhcFBhdGguc3RhcnRzV2l0aChcIi9cIikpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50Lm9mZmxpbmUuYm9vdHN0cmFwUGF0aCBtdXN0IHN0YXJ0IHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKGJvb3RzdHJhcFBhdGgpfWApXG4gICAgfVxuICAgIGlmIChyZXBsYXlQYXRoICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiByZXBsYXlQYXRoICE9PSBcInN0cmluZ1wiIHx8ICFyZXBsYXlQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5vZmZsaW5lLnJlcGxheVBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhyZXBsYXlQYXRoKX1gKVxuICAgIH1cbiAgICBpZiAoZ3JhbnRTdG9yYWdlICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBncmFudFN0b3JhZ2UgIT09IFwib2JqZWN0XCIgfHwgZ3JhbnRTdG9yYWdlID09PSBudWxsIHx8IEFycmF5LmlzQXJyYXkoZ3JhbnRTdG9yYWdlKSB8fCB0eXBlb2YgZ3JhbnRTdG9yYWdlLmxvYWQgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgZ3JhbnRTdG9yYWdlLnNhdmUgIT09IFwiZnVuY3Rpb25cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9mZmxpbmUuZ3JhbnRTdG9yYWdlIG11c3QgYmUgYW4gb2JqZWN0IHdpdGggbG9hZCgpIGFuZCBzYXZlKGdyYW50cykgbWV0aG9kc1wiKVxuICAgIH1cbiAgICBpZiAobXV0YXRpb25Mb2cgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG11dGF0aW9uTG9nICE9PSBcIm9iamVjdFwiIHx8IG11dGF0aW9uTG9nID09PSBudWxsIHx8IHR5cGVvZiBtdXRhdGlvbkxvZy5hcHBlbmQgIT09IFwiZnVuY3Rpb25cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9mZmxpbmUubXV0YXRpb25Mb2cgbXVzdCBiZSBhIExvY2FsTXV0YXRpb25Mb2dcIilcbiAgICB9XG4gICAgaWYgKG5vdyAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBub3cgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5ub3cgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgc2Vzc2lvbiBjbG9ja1wiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tlbmRQdWJsaWNLZXksXG4gICAgICBib290c3RyYXBQYXRoOiAoYm9vdHN0cmFwUGF0aCB8fCBcIi9mcm9udGVuZC1tb2RlbHMvc3luYy9ib290c3RyYXBcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCIsXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLFxuICAgICAgZW5yb2xsRGV2aWNlLFxuICAgICAgZ3JhbnRTY29wZXMsXG4gICAgICBncmFudFN0b3JhZ2UsXG4gICAgICBtdXRhdGlvbkxvZyxcbiAgICAgIG5vdzogbm93IHx8ICgoKSA9PiBuZXcgRGF0ZSgpKSxcbiAgICAgIHJlcGxheVBhdGg6IChyZXBsYXlQYXRoIHx8IFwiL2Zyb250ZW5kLW1vZGVscy9zeW5jL3JlcGxheVwiKS5yZXBsYWNlKC9cXC8rJC91LCBcIlwiKSB8fCBcIi9cIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHN5bmMgQVBJIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNBcGlDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBhcGkgLSBTeW5jIEFQSSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNBcGlDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgc3luYyBBUEkgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQXBpQ29uZmlndXJhdGlvbihhcGkpIHtcbiAgICBpZiAoYXBpID09PSB1bmRlZmluZWQgfHwgYXBpID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIGFwaSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGFwaSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuYXBpIG11c3QgYmUgYW4gb2JqZWN0IHdpdGggYSByZXNvdXJjZUNsYXNzXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge21vdW50UGF0aCwgcmVzb3VyY2VDbGFzc30gPSBhcGlcblxuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuYXBpLnJlc291cmNlQ2xhc3MgbXVzdCBiZSBhIHJlc291cmNlIGNsYXNzLCBnb3Q6ICR7U3RyaW5nKHJlc291cmNlQ2xhc3MpfWApXG4gICAgfVxuICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuYXBpLnJlc291cmNlQ2xhc3MgJHtyZXNvdXJjZUNsYXNzLm5hbWV9IG11c3QgZGVmaW5lIHN0YXRpYyBNb2RlbENsYXNzYClcbiAgICB9XG4gICAgaWYgKG1vdW50UGF0aCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgbW91bnRQYXRoICE9PSBcInN0cmluZ1wiIHx8ICFtb3VudFBhdGguc3RhcnRzV2l0aChcIi9cIikpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuYXBpLm1vdW50UGF0aCBtdXN0IHN0YXJ0IHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKG1vdW50UGF0aCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge21vdW50UGF0aCwgcmVzb3VyY2VDbGFzc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGU+fSAtIFRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5kYXRhYmFzZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YWJhc2UgY29uZmlndXJhdGlvblwiKVxuXG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlW3RoaXMuZ2V0RW52aXJvbm1lbnQoKV0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgZW52aXJvbm1lbnQ6ICR7dGhpcy5nZXRFbnZpcm9ubWVudCgpfSAtICR7T2JqZWN0LmtleXModGhpcy5kYXRhYmFzZSkuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpZ2codGhpcywgXCJkYXRhYmFzZVwiLCB0aGlzLmdldEVudmlyb25tZW50KCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW3RlbmFudF0gLSBUZW5hbnQgb3ZlcnJpZGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gLSBSZXNvbHZlZCBkYXRhYmFzZSBjb25maWd1cmF0aW9uIGZvciB0aGUgaWRlbnRpZmllci5cbiAgICovXG4gIHJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oaWRlbnRpZmllciwgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KCkpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIGRhdGFiYXNlIGlkZW50aWZpZXIgY29uZmlndXJlZDogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgaWYgKHRlbmFudCA9PT0gdW5kZWZpbmVkIHx8ICF0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyKSB7XG4gICAgICByZXR1cm4gZGF0YWJhc2VDb25maWd1cmF0aW9uXG4gICAgfVxuXG4gICAgY29uc3Qgb3ZlcnJpZGVDb25maWd1cmF0aW9uID0gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgaWRlbnRpZmllcixcbiAgICAgIHRlbmFudFxuICAgIH0pXG5cbiAgICByZXR1cm4gbWVyZ2VEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCBvdmVycmlkZUNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGlzYWJsZWQgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBEaXNhYmxlZCBkYXRhYmFzZSBpZGVudGlmaWVycyBmcm9tIGVudiBmbGFncy5cbiAgICovXG4gIGdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpIHtcbiAgICBjb25zdCBkaXNhYmxlZElkZW50aWZpZXJzID0gbmV3IFNldCgpXG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVyc1JhdyA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19ESVNBQkxFRF9EQVRBQkFTRV9JREVOVElGSUVSU1xuXG4gICAgaWYgKGRpc2FibGVkSWRlbnRpZmllcnNSYXcpIHtcbiAgICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBkaXNhYmxlZElkZW50aWZpZXJzUmF3LnNwbGl0KFwiLFwiKSkge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gaWRlbnRpZmllci50cmltKClcblxuICAgICAgICBpZiAodHJpbW1lZCkgZGlzYWJsZWRJZGVudGlmaWVycy5hZGQodHJpbW1lZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RJU0FCTEVfTVNTUUwgPT09IFwiMVwiKSB7XG4gICAgICBkaXNhYmxlZElkZW50aWZpZXJzLmFkZChcIm1zc3FsXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpc2FibGVkSWRlbnRpZmllcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGRhdGFiYXNlIGlkZW50aWZpZXIgYWN0aXZlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgZGF0YWJhc2UgaWRlbnRpZmllciBpcyBhY3RpdmUgaW4gdGhlIGN1cnJlbnQgdGVuYW50IGNvbnRleHQuXG4gICAqL1xuICBpc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyLCB0ZW5hbnQgPSB0aGlzLmdldEN1cnJlbnRUZW5hbnQoKSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKClbaWRlbnRpZmllcl1cblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggZGF0YWJhc2UgaWRlbnRpZmllciBjb25maWd1cmVkOiAke2lkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi50ZW5hbnRPbmx5KSByZXR1cm4gdHJ1ZVxuICAgIGlmICh0ZW5hbnQgPT09IHVuZGVmaW5lZCB8fCAhdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBvdmVycmlkZUNvbmZpZ3VyYXRpb24gPSB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICBpZGVudGlmaWVyLFxuICAgICAgdGVuYW50XG4gICAgfSlcblxuICAgIHJldHVybiBCb29sZWFuKG92ZXJyaWRlQ29uZmlndXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpIHtcbiAgICBjb25zdCBpZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKHRoaXMuZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKCkpXG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVycyA9IHRoaXMuZ2V0RGlzYWJsZWREYXRhYmFzZUlkZW50aWZpZXJzKClcblxuICAgIHJldHVybiBpZGVudGlmaWVycy5maWx0ZXIoKGlkZW50aWZpZXIpID0+ICFkaXNhYmxlZElkZW50aWZpZXJzLmhhcyhpZGVudGlmaWVyKSAmJiB0aGlzLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEh1bWFuLXJlYWRhYmxlIHNlcnZlciBkaWFnbm9zdGljcy5cbiAgICovXG4gIGFzeW5jIGdldERlYnVnU25hcHNob3QoKSB7XG4gICAgY29uc3QgbG9jYWxTbmFwc2hvdCA9IHRoaXMuZ2V0TG9jYWxEZWJ1Z1NuYXBzaG90KClcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5sb2NhbFNuYXBzaG90LFxuICAgICAgaHR0cFNlcnZlcjogYXdhaXQgdGhpcy5fZGVidWdIdHRwU2VydmVyU25hcHNob3QoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBIdW1hbi1yZWFkYWJsZSBkaWFnbm9zdGljcyBmb3IgdGhpcyBwcm9jZXNzIG9ubHkuXG4gICAqL1xuICBnZXRMb2NhbERlYnVnU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tncm91bmRKb2JzOiB0aGlzLl9kZWJ1Z0JhY2tncm91bmRKb2JzU25hcHNob3QoKSxcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2RlYnVnQ29uZmlndXJhdGlvblNuYXBzaG90KCksXG4gICAgICBkYXRhYmFzZTogdGhpcy5fZGVidWdEYXRhYmFzZVNuYXBzaG90KCksXG4gICAgICBnZW5lcmF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgc2VydmVyOiB0aGlzLl9kZWJ1Z1NlcnZlclNuYXBzaG90KCksXG4gICAgICB3ZWJzb2NrZXRzOiB0aGlzLl9kZWJ1Z1dlYnNvY2tldFNuYXBzaG90KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBodHRwIHNlcnZlciBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBIVFRQIHNlcnZlciB3b3JrZXIgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBhc3luYyBfZGVidWdIdHRwU2VydmVyU25hcHNob3QoKSB7XG4gICAgY29uc3QgaHR0cFNlcnZlciA9IC8qKiBAdHlwZSB7e2dldERlYnVnU25hcHNob3Q/OiAoKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHwgdW5kZWZpbmVkfSAqLyAodGhpcy5faHR0cFNlcnZlckluc3RhbmNlKVxuXG4gICAgaWYgKCFodHRwU2VydmVyPy5nZXREZWJ1Z1NuYXBzaG90KSB7XG4gICAgICByZXR1cm4ge2NvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5odHRwU2VydmVyKSwgYWN0aXZlOiBmYWxzZX1cbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgaHR0cFNlcnZlci5nZXREZWJ1Z1NuYXBzaG90KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHNlcnZlciBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBTZXJ2ZXIgcnVudGltZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z1NlcnZlclNuYXBzaG90KCkge1xuICAgIGNvbnN0IG5vZGVQcm9jZXNzID0gdHlwZW9mIHByb2Nlc3MgPT09IFwidW5kZWZpbmVkXCIgPyB1bmRlZmluZWQgOiBwcm9jZXNzXG5cbiAgICByZXR1cm4ge1xuICAgICAgZW52aXJvbm1lbnQ6IHRoaXMuZ2V0RW52aXJvbm1lbnQoKSxcbiAgICAgIG1lbW9yeVVzYWdlOiBub2RlUHJvY2VzcyA/IG5vZGVQcm9jZXNzLm1lbW9yeVVzYWdlKCkgOiB1bmRlZmluZWQsXG4gICAgICBub2RlVmVyc2lvbjogbm9kZVByb2Nlc3M/LnZlcnNpb25zPy5ub2RlLFxuICAgICAgcGlkOiBub2RlUHJvY2Vzcz8ucGlkLFxuICAgICAgcGxhdGZvcm06IG5vZGVQcm9jZXNzPy5wbGF0Zm9ybSxcbiAgICAgIHVwdGltZVNlY29uZHM6IG5vZGVQcm9jZXNzID8gbm9kZVByb2Nlc3MudXB0aW1lKCkgOiB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBjb25maWd1cmF0aW9uIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbmZpZ3VyYXRpb24gZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdDb25maWd1cmF0aW9uU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFwaU1hbmlmZXN0OiB0aGlzLl9hcGlNYW5pZmVzdEVuYWJsZWQoKSA/IHtlbmFibGVkOiB0cnVlLCBwYXRoOiB0aGlzLl9hcGlNYW5pZmVzdC5wYXRoLCB0b2tlbkNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fYXBpTWFuaWZlc3QudG9rZW4pfSA6IHtlbmFibGVkOiBmYWxzZX0sXG4gICAgICBhdXRvbG9hZDogdGhpcy5nZXRBdXRvbG9hZCgpLFxuICAgICAgZGVidWc6IHRoaXMuZGVidWcgPT09IHRydWUsXG4gICAgICBkZWJ1Z0VuZHBvaW50OiB0aGlzLl9kZWJ1Z0VuZHBvaW50U25hcHNob3QoKSxcbiAgICAgIGVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlczogdGhpcy5nZXRFbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMoKSxcbiAgICAgIGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzOiB0aGlzLmdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCksXG4gICAgICBpbml0aWFsaXplZDogdGhpcy5faXNJbml0aWFsaXplZCxcbiAgICAgIG1jcDogdGhpcy5fbWNwLmVuYWJsZWQgPyB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogdGhpcy5fbWNwLnBhdGgsIHRva2VuQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9tY3AudG9rZW4pfSA6IHtlbmFibGVkOiBmYWxzZX0sXG4gICAgICBsb2dnaW5nOiB7XG4gICAgICAgIGRlYnVnTG93TGV2ZWw6IHRoaXMuX2xvZ2dpbmc/LmRlYnVnTG93TGV2ZWwgPT09IHRydWUsXG4gICAgICAgIG91dHB1dHM6IHRoaXMuX2xvZ2dpbmcgPyBPYmplY3Qua2V5cyh0aGlzLl9sb2dnaW5nKSA6IFtdXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgYmFja2dyb3VuZCBqb2JzIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEJhY2tncm91bmQgam9iIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnQmFja2dyb3VuZEpvYnNTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9iYWNrZ3JvdW5kSm9icyksXG4gICAgICBzY2hlZHVsZWRDb25maWd1cmVkOiBCb29sZWFuKHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGRhdGFiYXNlIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERhdGFiYXNlIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnRGF0YWJhc2VTbmFwc2hvdCgpIHtcbiAgICAvKipcbiAgICAgKiBEYXRhYmFzZSBwb29scy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuRGF0YWJhc2VQb29sRGVidWdTbmFwc2hvdD59ICovXG4gICAgY29uc3QgZGF0YWJhc2VQb29scyA9IHt9XG4gICAgY29uc3QgYWN0aXZlSWRlbnRpZmllcnMgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGFjdGl2ZUlkZW50aWZpZXJzKSB7XG4gICAgICBkYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdID0gdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuZ2V0RGVidWdTbmFwc2hvdCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGl2ZUlkZW50aWZpZXJzLFxuICAgICAgZGlzYWJsZWRJZGVudGlmaWVyczogQXJyYXkuZnJvbSh0aGlzLmdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpKSxcbiAgICAgIGluaXRpYWxpemVkUG9vbHM6IE9iamVjdC5rZXlzKHRoaXMuZGF0YWJhc2VQb29scyksXG4gICAgICBwb29sczogZGF0YWJhc2VQb29sc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHdlYnNvY2tldCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXZWJTb2NrZXQgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdXZWJzb2NrZXRTbmFwc2hvdCgpIHtcbiAgICAvKipcbiAgICAgKiBTZXNzaW9uIGJ1Y2tldHMuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtjb3VudDogbnVtYmVyLCBkZXRhaWxzOiB7Y2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXIsIGNoYW5uZWxTdWJzY3JpcHRpb25zOiB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9W10sIGNvbm5lY3Rpb25Db3VudDogbnVtYmVyLCBwYXVzZWQ6IGJvb2xlYW4sIHN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXJ9fT59ICovXG4gICAgY29uc3Qgc2Vzc2lvbkJ1Y2tldHMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBTZXNzaW9uIGRldGFpbHMuXG4gICAgICogQHR5cGUge3tjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IG51bWJlciwgY2hhbm5lbFN1YnNjcmlwdGlvbnM6IHtjaGFubmVsVHlwZTogc3RyaW5nLCBjb3VudDogbnVtYmVyLCBtb2RlbDogc3RyaW5nIHwgbnVsbH1bXSwgY29ubmVjdGlvbkNvdW50OiBudW1iZXIsIHBhdXNlZDogYm9vbGVhbiwgcXVldWVkTWVzc2FnZUNvdW50OiBudW1iZXIsIHN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXJ9W119ICovXG4gICAgY29uc3Qgc2Vzc2lvbkRldGFpbHMgPSBbXVxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBBcnJheS5mcm9tKHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmVudHJpZXMoKSkubWFwKChbY2hhbm5lbCwgY2hhbm5lbFN1YnNjcmlwdGlvbnNdKSA9PiB7XG4gICAgICAvKipcbiAgICAgICAqIERldGFpbHMgYnVja2V0cy5cbiAgICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y291bnQ6IG51bWJlciwgZGV0YWlsczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59ICovXG4gICAgICBjb25zdCBkZXRhaWxzQnVja2V0cyA9IG5ldyBNYXAoKVxuXG4gICAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBjaGFubmVsU3Vic2NyaXB0aW9ucykge1xuICAgICAgICBjb25zdCBkZXRhaWxzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoc3Vic2NyaXB0aW9uLmRlYnVnU25hcHNob3QoKSkpXG4gICAgICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KGRldGFpbHMpXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nQnVja2V0ID0gZGV0YWlsc0J1Y2tldHMuZ2V0KGtleSlcblxuICAgICAgICBpZiAoZXhpc3RpbmdCdWNrZXQpIHtcbiAgICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZGV0YWlsc0J1Y2tldHMuc2V0KGtleSwge2NvdW50OiAxLCBkZXRhaWxzfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBjaGFubmVsLFxuICAgICAgICBjb3VudDogY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgICAgZGV0YWlsczogQXJyYXkuZnJvbShkZXRhaWxzQnVja2V0cy52YWx1ZXMoKSkuc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGZvciAoY29uc3Qgc2Vzc2lvbiBvZiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9ucykge1xuICAgICAgLyoqXG4gICAgICAgKiBDaGFubmVsIHN1YnNjcmlwdGlvbiBidWNrZXRzLlxuICAgICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtjaGFubmVsVHlwZTogc3RyaW5nLCBjb3VudDogbnVtYmVyLCBtb2RlbDogc3RyaW5nIHwgbnVsbH0+fSAqL1xuICAgICAgY29uc3QgY2hhbm5lbFN1YnNjcmlwdGlvbkJ1Y2tldHMgPSBuZXcgTWFwKClcblxuICAgICAgZm9yIChjb25zdCB7Y2hhbm5lbFR5cGUsIHN1YnNjcmlwdGlvbn0gb2Ygc2Vzc2lvbi5fY2hhbm5lbFN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc3Vic2NyaXB0aW9uLmRlYnVnU25hcHNob3QoKSlcbiAgICAgICAgY29uc3QgbW9kZWwgPSB0eXBlb2YgZGV0YWlscy5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IGRldGFpbHMubW9kZWwgOiBudWxsXG4gICAgICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KHtjaGFubmVsVHlwZSwgbW9kZWx9KVxuICAgICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLmdldChrZXkpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLnNldChrZXksIHtjaGFubmVsVHlwZSwgY291bnQ6IDEsIG1vZGVsfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjaGFubmVsU3Vic2NyaXB0aW9ucyA9IEFycmF5LmZyb20oY2hhbm5lbFN1YnNjcmlwdGlvbkJ1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KVxuICAgICAgY29uc3Qgc25hcHNob3QgPSB7XG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogc2Vzc2lvbi5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgIGNvbm5lY3Rpb25Db3VudDogc2Vzc2lvbi5fY29ubmVjdGlvbnMuc2l6ZSxcbiAgICAgICAgcGF1c2VkOiBzZXNzaW9uLl9wYXVzZWQsXG4gICAgICAgIHF1ZXVlZE1lc3NhZ2VDb3VudDogc2Vzc2lvbi5fb3V0Ym91bmRRdWV1ZS5sZW5ndGgsXG4gICAgICAgIHN1YnNjcmlwdGlvbkNvdW50OiBzZXNzaW9uLnN1YnNjcmlwdGlvbnMuc2l6ZVxuICAgICAgfVxuICAgICAgY29uc3QgYnVja2V0S2V5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCxcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbnM6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNuYXBzaG90LmNvbm5lY3Rpb25Db3VudCxcbiAgICAgICAgcGF1c2VkOiBzbmFwc2hvdC5wYXVzZWQsXG4gICAgICAgIHN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5zdWJzY3JpcHRpb25Db3VudFxuICAgICAgfSlcbiAgICAgIGNvbnN0IGV4aXN0aW5nQnVja2V0ID0gc2Vzc2lvbkJ1Y2tldHMuZ2V0KGJ1Y2tldEtleSlcblxuICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlc3Npb25CdWNrZXRzLnNldChidWNrZXRLZXksIHtcbiAgICAgICAgICBjb3VudDogMSxcbiAgICAgICAgICBkZXRhaWxzOiB7XG4gICAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCxcbiAgICAgICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zOiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgICAgIGNvbm5lY3Rpb25Db3VudDogc25hcHNob3QuY29ubmVjdGlvbkNvdW50LFxuICAgICAgICAgICAgcGF1c2VkOiBzbmFwc2hvdC5wYXVzZWQsXG4gICAgICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc25hcHNob3Quc3Vic2NyaXB0aW9uQ291bnRcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgICBzZXNzaW9uRGV0YWlscy5wdXNoKHNuYXBzaG90KVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBsaXZlT25seUNoYW5uZWxzOiBBcnJheS5mcm9tKHRoaXMuX2xpdmVPbmx5V2Vic29ja2V0Q2hhbm5lbHMpLFxuICAgICAgcGF1c2VkU2Vzc2lvbnM6IHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLnNpemUsXG4gICAgICByZWdpc3RlcmVkQ2hhbm5lbHM6IEFycmF5LmZyb20odGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMua2V5cygpKSxcbiAgICAgIHJlZ2lzdGVyZWRDb25uZWN0aW9uczogQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3Nlcy5rZXlzKCkpLFxuICAgICAgc2Vzc2lvbkJ1Y2tldHM6IEFycmF5LmZyb20oc2Vzc2lvbkJ1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KSxcbiAgICAgIHNlc3Npb25Db3VudDogdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMuc2l6ZSxcbiAgICAgIHNlc3Npb25zOiBzZXNzaW9uRGV0YWlscy5zb3J0KChhLCBiKSA9PiBiLmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCAtIGEuY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50KSxcbiAgICAgIHN1YnNjcmlwdGlvbkdyb3VwczogdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgIHN1YnNjcmlwdGlvbnNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZGF0YWJhc2UgcG9vbC5cbiAgICovXG4gIGdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBpZiAoIXRoaXMuaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZChpZGVudGlmaWVyKSkge1xuICAgICAgdGhpcy5pbml0aWFsaXplRGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpZ2codGhpcywgXCJkYXRhYmFzZVBvb2xzXCIsIGlkZW50aWZpZXIpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZnJhbWV3b3JrLW93bmVkIGZyb250ZW5kIHRlbmFudCBTUUxpdGUgbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGV9IC0gTGlmZWN5Y2xlIG93bmVyLlxuICAgKi9cbiAgZ2V0RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoKSB7IHJldHVybiB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc2FmZSBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZVtcImluc3BlY3RBbGxcIl0+fSAtIExpZmVjeWNsZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIGluc3BlY3RGcm9udGVuZFRlbmFudFNxbGl0ZUhhbmRsZXMoKSB7IHJldHVybiB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZS5pbnNwZWN0QWxsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0pXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllcikge1xuICAgIHJldHVybiB0aGlzLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oaWRlbnRpZmllcilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIHNjaGVtYSBtZXRhZGF0YSBjYWNoZWQgYnkgZXZlcnkgaW5pdGlhbGl6ZWQgcG9vbCB0aGF0IHRhcmdldHMgdGhlXG4gICAqIHNhbWUgcGh5c2ljYWwgZGF0YWJhc2UgKG1hdGNoZWQgYnkgY29ubmVjdGlvbiByZXVzZSBrZXkpLiBTZXBhcmF0ZSBwb29scyB0aGF0XG4gICAqIHBvaW50IGF0IG9uZSBkYXRhYmFzZSBrZWVwIGluZGVwZW5kZW50IHNjaGVtYSBjYWNoZXMsIHNvIERETCBydW4gdGhyb3VnaCBvbmVcbiAgICogcG9vbCB3b3VsZCBvdGhlcndpc2UgbGVhdmUgdGhlIG90aGVycyByZXBvcnRpbmcgc3RhbGUgdGFibGVzL2NvbHVtbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIENvbm5lY3Rpb24gcmV1c2Uga2V5IGlkZW50aWZ5aW5nIHRoZSBzaGFyZWQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGVzRm9yUmV1c2VLZXkocmV1c2VLZXkpIHtcbiAgICB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb25zQnlSZXVzZUtleS5zZXQoXG4gICAgICByZXVzZUtleSxcbiAgICAgIHRoaXMuc2NoZW1hQ2FjaGVHZW5lcmF0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpICsgMVxuICAgIClcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleSgpID09PSByZXVzZUtleSkge1xuICAgICAgICBwb29sLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IHNjaGVtYS1jYWNoZSBnZW5lcmF0aW9uIGZvciBvbmUgcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIENvbm5lY3Rpb24gcmV1c2Uga2V5IGlkZW50aWZ5aW5nIHRoZSBzaGFyZWQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQ3VycmVudCBzY2hlbWEtY2FjaGUgZ2VuZXJhdGlvbi5cbiAgICovXG4gIHNjaGVtYUNhY2hlR2VuZXJhdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNhY2hlR2VuZXJhdGlvbnNCeVJldXNlS2V5LmdldChyZXVzZUtleSkgfHwgMFxuICB9XG5cbiAgLyoqXG4gICAqIEludmFsaWRhdGVzIHJlY29yZCBtZXRhZGF0YSBvd25lZCBieSBvbmUgY2xvc2VkL2RlbGV0ZWQgcGh5c2ljYWwgdGVuYW50XG4gICAqIGRhdGFiYXNlIHdoaWxlIHByZXNlcnZpbmcgZXZlcnkgb3RoZXIgdGVuYW50IGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gTG9naWNhbCBpZGVudGlmaWVyIHBsdXMgcG9vbCByZXVzZSBrZXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJSZWNvcmRNZXRhZGF0YUZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBPYmplY3QudmFsdWVzKHRoaXMubW9kZWxDbGFzc2VzKSkge1xuICAgICAgbW9kZWxDbGFzcy5jbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzRm9yRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBwb29sIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBkYXRhYmFzZSBwb29sIHR5cGUuXG4gICAqL1xuICBnZXREYXRhYmFzZVBvb2xUeXBlKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGNvbnN0IHBvb2xUeXBlQ2xhc3MgPSBkaWdnKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGlkZW50aWZpZXIpLCBcInBvb2xUeXBlXCIpXG5cbiAgICBpZiAoIXBvb2xUeXBlQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIHBvb2xUeXBlIGdpdmVuIGluIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5yZXNvbHZlVGVzdFNoYXJlZFRyYW5zYWN0aW9uUG9vbFR5cGUoe1xuICAgICAgY29uZmlndXJlZFBvb2xUeXBlOiBwb29sVHlwZUNsYXNzLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiBpZGVudGlmaWVyXG4gICAgfSlcbiAgfVxuXG4gIGdldERhdGFiYXNlVHlwZShpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBjb25zdCBkYXRhYmFzZVR5cGUgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKS50eXBlXG5cbiAgICBpZiAoIWRhdGFiYXNlVHlwZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YWJhc2UgdHlwZSBnaXZlbiBpbiBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG5cbiAgICByZXR1cm4gZGF0YWJhc2VUeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBkaXJlY3RvcnkuXG4gICAqL1xuICBnZXREaXJlY3RvcnkoKSB7XG4gICAgY29uc3QgZGlyZWN0b3J5ID0gdGhpcy5nZXREaXJlY3RvcnlJZkF2YWlsYWJsZSgpXG5cbiAgICBpZiAoIWRpcmVjdG9yeSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGlyZWN0b3J5IGNvbmZpZ3VyZWQgYW5kIHByb2Nlc3MuY3dkIGlzIHVuYXZhaWxhYmxlXCIpXG5cbiAgICByZXR1cm4gZGlyZWN0b3J5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGlyZWN0b3J5IGlmIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgZGlyZWN0b3J5IHdoZW4gdGhlIHJ1bnRpbWUgY2FuIHJlc29sdmUgb25lLlxuICAgKi9cbiAgZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKSB7XG4gICAgaWYgKCF0aGlzLl9kaXJlY3RvcnkpIHtcbiAgICAgIHRoaXMuX2RpcmVjdG9yeSA9IGN1cnJlbnRXb3JraW5nRGlyZWN0b3J5KClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGlyZWN0b3J5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmFja2VuZCBwcm9qZWN0cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb25bXX0gLSBCYWNrZW5kIHByb2plY3RzLlxuICAgKi9cbiAgZ2V0QmFja2VuZFByb2plY3RzKCkgeyByZXR1cm4gdGhpcy5fYmFja2VuZFByb2plY3RzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcGFja2FnZXMuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNQYWNrYWdlW119IC0gUmVnaXN0ZXJlZCBWZWxvY2lvdXMgcGFja2FnZXMuXG4gICAqL1xuICBnZXRQYWNrYWdlcygpIHsgcmV0dXJuIHRoaXMuX3BhY2thZ2VzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYWJpbGl0eSByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IC0gQWJpbGl0eSByZXNvdXJjZSBjbGFzc2VzLlxuICAgKi9cbiAgZ2V0QWJpbGl0eVJlc291cmNlcygpIHsgcmV0dXJuIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhYmlsaXR5IHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IHJlc291cmNlcyAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QWJpbGl0eVJlc291cmNlcyhyZXNvdXJjZXMpIHsgdGhpcy5fYWJpbGl0eVJlc291cmNlcyA9IHJlc291cmNlcyB9XG5cbiAgLyoqXG4gICAqIE1lcmdlcyByZXNvdXJjZSBjbGFzc2VzIGRpc2NvdmVyZWQgZnJvbSB0aGUgYXBwIGFuZCBldmVyeSByZWdpc3RlcmVkIHBhY2thZ2VcbiAgICogaW50byB0aGUgYWJpbGl0eS1yZXNvdXJjZXMgbGlzdC4gYGF1dG9EaXNjb3ZlclJlc291cmNlc2AgcG9wdWxhdGVzIGVhY2ggYmFja2VuZFxuICAgKiBwcm9qZWN0J3MgYGZyb250ZW5kTW9kZWxzYCAoaW5jbHVkaW5nIHBhY2thZ2UgcHJvamVjdHMpLCBzbyB0aGlzIG1ha2VzIGFcbiAgICogcGFja2FnZS1jb250cmlidXRlZCBtb2RlbCdzIGFiaWxpdGllcyByZWFjaCBzdWJzY3JpcHRpb24gYW5kIHBlci1yZWNvcmRcbiAgICogYXV0aG9yaXphdGlvbiBhdXRvbWF0aWNhbGx5IOKAlCBjb25zdW1pbmcgYXBwcyBkbyBub3QgaGF2ZSB0byBoYW5kLXJlZ2lzdGVyXG4gICAqIHBhY2thZ2UgcmVzb3VyY2VzLiBBbHJlYWR5LXByZXNlbnQgY2xhc3NlcyAoZS5nLiBhbiBhcHAncyBleHBsaWNpdGx5LXNldFxuICAgKiByZXNvdXJjZXMpIGFyZSBsZWZ0IHVudG91Y2hlZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX21lcmdlRGlzY292ZXJlZEFiaWxpdHlSZXNvdXJjZXMoKSB7XG4gICAgY29uc3QgbWVyZ2VkID0gWy4uLnRoaXMuX2FiaWxpdHlSZXNvdXJjZXNdXG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQobWVyZ2VkKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLl9iYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGlmICghYmFja2VuZFByb2plY3QuYWJpbGl0eVJlc291cmNlcykgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCBSZXNvdXJjZUNsYXNzIG9mIGJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMpIHtcbiAgICAgICAgaWYgKHNlZW4uaGFzKFJlc291cmNlQ2xhc3MpKSBjb250aW51ZVxuXG4gICAgICAgIHNlZW4uYWRkKFJlc291cmNlQ2xhc3MpXG4gICAgICAgIG1lcmdlZC5wdXNoKFJlc291cmNlQ2xhc3MpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fYWJpbGl0eVJlc291cmNlcyA9IG1lcmdlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBBYmlsaXR5IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0QWJpbGl0eVJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fYWJpbGl0eVJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUZW5hbnQgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRUZW5hbnRSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX3RlbmFudFJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICovXG4gIGdldFRlbmFudERhdGFiYXNlUmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdCB0ZW5hbnQgcG9vbCBjb25maWd1cmF0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZXN0VGVuYW50UG9vbHNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE9wdC1pbiB0ZXN0IHRlbmFudCBkYXRhYmFzZSBwb29scyBrZXllZCBieSBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0VGVzdFRlbmFudFBvb2xzKCkgeyByZXR1cm4gdGhpcy5fdGVzdFRlbmFudFBvb2xzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZW5mb3JjZSB0ZW5hbnQgZGF0YWJhc2Ugc2NvcGVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgcmVxdWlyZSBhIHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCkgeyByZXR1cm4gdGhpcy5fZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZT59IC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlcnMuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycygpIHsgcmV0dXJuIHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlci5cbiAgICovXG4gIGdldFRlbmFudERhdGFiYXNlUHJvdmlkZXIoaWRlbnRpZmllcikge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnNbaWRlbnRpZmllcl1cblxuICAgIGlmICghcHJvdmlkZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGNvbmZpZ3VyZWQgZm9yIGRhdGFiYXNlIGlkZW50aWZpZXI6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIHJldHVybiBwcm92aWRlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnRzIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXR0YWNobWVudHNDb25maWd1cmF0aW9ufSAtIEF0dGFjaG1lbnRzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRBdHRhY2htZW50c0NvbmZpZ3VyYXRpb24oKSB7IHJldHVybiB0aGlzLl9hdHRhY2htZW50cyB8fCB7fSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJvdXRlUmVzb2x2ZXJIb29rVHlwZVtdfSAtIFJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKi9cbiAgZ2V0Um91dGVSZXNvbHZlckhvb2tzKCkgeyByZXR1cm4gdGhpcy5fcm91dGVSZXNvbHZlckhvb2tzIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgcm91dGUgcmVzb2x2ZXIgaG9vay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUm91dGVSZXNvbHZlckhvb2tUeXBlfSBob29rIC0gUm91dGUgcmVzb2x2ZXIgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWRkUm91dGVSZXNvbHZlckhvb2soaG9vaykge1xuICAgIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcy5wdXNoKGhvb2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYWJpbGl0eSByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBBYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBYmlsaXR5UmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fYWJpbGl0eVJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZW5hbnQgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBUZW5hbnQgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudFJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX3RlbmFudFJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSByZXNvbHZlciAtIFRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGVuYW50RGF0YWJhc2VSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZXN0IHRlbmFudCBwb29sIGNvbmZpZ3VyYXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZXN0VGVuYW50UG9vbHNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBwb29scyAtIE9wdC1pbiB0ZXN0IHRlbmFudCBkYXRhYmFzZSBwb29scy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGVzdFRlbmFudFBvb2xzKHBvb2xzKSB7IHRoaXMuX3Rlc3RUZW5hbnRQb29scyA9IHBvb2xzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZW5mb3JjZSB0ZW5hbnQgZGF0YWJhc2Ugc2NvcGVzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ZhbHVlIC0gV2hldGhlciB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHJlcXVpcmUgYSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKG5ld1ZhbHVlKSB7IHRoaXMuX2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVycy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGU+fSBwcm92aWRlcnMgLSBUZW5hbnQgZGF0YWJhc2UgbGlmZWN5Y2xlIHByb3ZpZGVycy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcnMocHJvdmlkZXJzKSB7IHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzID0gcHJvdmlkZXJzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGVudmlyb25tZW50LlxuICAgKi9cbiAgZ2V0RW52aXJvbm1lbnQoKSB7IHJldHVybiBkaWdnKHRoaXMsIFwiX2Vudmlyb25tZW50XCIpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVxdWVzdCB0aW1lb3V0IG1zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFJlcXVlc3QgdGltZW91dCBpbiBzZWNvbmRzLlxuICAgKi9cbiAgZ2V0UmVxdWVzdFRpbWVvdXRNcygpIHtcbiAgICBjb25zdCBlbnZUaW1lb3V0ID0gdGhpcy5fcGFyc2VSZXF1ZXN0VGltZW91dFNlY29uZHMocHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1JFUVVFU1RfVElNRU9VVF9NUylcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVvZiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gdGhpcy5fcmVxdWVzdFRpbWVvdXRNcygpXG4gICAgICA6IHRoaXMuX3JlcXVlc3RUaW1lb3V0TXNcblxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICh0eXBlb2YgZW52VGltZW91dCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52VGltZW91dCkpIHJldHVybiBlbnZUaW1lb3V0XG5cbiAgICByZXR1cm4gNjBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIHJlcXVlc3QgdGltZW91dCBzZWNvbmRzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gcmF3VmFsdWUgLSBFbnYgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gVGltZW91dCBpbiBzZWNvbmRzLlxuICAgKi9cbiAgX3BhcnNlUmVxdWVzdFRpbWVvdXRTZWNvbmRzKHJhd1ZhbHVlKSB7XG4gICAgaWYgKHJhd1ZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IHRyaW1tZWQgPSByYXdWYWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKVxuXG4gICAgaWYgKCF0cmltbWVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBtYXRjaCA9IHRyaW1tZWQubWF0Y2goL14oXFxkKyg/OlxcLlxcZCspPykobXN8cyk/JC8pXG5cbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBudW1lcmljID0gTnVtYmVyKG1hdGNoWzFdKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobnVtZXJpYykpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IHVuaXQgPSBtYXRjaFsyXVxuXG4gICAgaWYgKHVuaXQgPT09IFwibXNcIikgcmV0dXJuIG51bWVyaWMgLyAxMDAwXG4gICAgaWYgKHVuaXQgPT09IFwic1wiKSByZXR1cm4gbnVtZXJpY1xuXG4gICAgaWYgKHRyaW1tZWQuaW5jbHVkZXMoXCIuXCIpKSByZXR1cm4gbnVtZXJpY1xuICAgIGlmIChudW1lcmljID49IDEwMDApIHJldHVybiBudW1lcmljIC8gMTAwMFxuXG4gICAgcmV0dXJuIG51bWVyaWNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBlbnZpcm9ubWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld0Vudmlyb25tZW50IC0gTmV3IGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRFbnZpcm9ubWVudChuZXdFbnZpcm9ubWVudCkgeyB0aGlzLl9lbnZpcm9ubWVudCA9IG5ld0Vudmlyb25tZW50IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9nZ2luZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZGVmYXVsdENvbnNvbGVdIC0gV2hldGhlciBkZWZhdWx0IGNvbnNvbGUuXG4gICAqIEByZXR1cm5zIHtSZXF1aXJlZDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJjb25zb2xlXCIgfCBcImZpbGVcIiB8IFwibGV2ZWxzXCI+PiAmIFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImRpcmVjdG9yeVwiIHwgXCJmaWxlUGF0aFwiPiAmIFBhcnRpYWw8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwib3V0cHV0c1wiIHwgXCJsb2dnZXJzXCI+Pn0gLSBUaGUgbG9nZ2luZyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0TG9nZ2luZ0NvbmZpZ3VyYXRpb24oe2RlZmF1bHRDb25zb2xlfSA9IHt9KSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSB0aGlzLmdldEVudmlyb25tZW50KClcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gdGhpcy5fbG9nZ2luZz8uZGlyZWN0b3J5IHx8IGVudmlyb25tZW50SGFuZGxlci5nZXREZWZhdWx0TG9nRGlyZWN0b3J5KHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMuX2xvZ2dpbmc/LmZpbGVQYXRoIHx8IGVudmlyb25tZW50SGFuZGxlci5nZXRMb2dGaWxlUGF0aCh7Y29uZmlndXJhdGlvbjogdGhpcywgZGlyZWN0b3J5LCBlbnZpcm9ubWVudH0pXG4gICAgY29uc3QgY29uc29sZU92ZXJyaWRlID0gdGhpcy5fbG9nZ2luZz8uY29uc29sZVxuICAgIGNvbnN0IGhhc0xvZ2dpbmdDb25maWcgPSBCb29sZWFuKHRoaXMuX2xvZ2dpbmcpXG4gICAgY29uc3QgZmlsZUxvZ2dpbmcgPSBoYXNMb2dnaW5nQ29uZmlnID8gKHRoaXMuX2xvZ2dpbmc/LmZpbGUgPz8gQm9vbGVhbihmaWxlUGF0aCkpIDogZmFsc2VcbiAgICBjb25zdCBjb25maWd1cmVkTGV2ZWxzID0gdGhpcy5fbG9nZ2luZz8ubGV2ZWxzXG4gICAgY29uc3QgaW5jbHVkZUxvd0xldmVsRGVidWcgPSB0aGlzLl9sb2dnaW5nPy5kZWJ1Z0xvd0xldmVsID09PSB0cnVlXG4gICAgY29uc3QgbG9nZ2VycyA9IHRoaXMuX2xvZ2dpbmc/LmxvZ2dlcnNcblxuICAgIGNvbnN0IGNvbnNvbGVEZWZhdWx0ID0gZGVmYXVsdENvbnNvbGUgIT09IHVuZGVmaW5lZCA/IGRlZmF1bHRDb25zb2xlIDogdHJ1ZVxuICAgIGNvbnN0IGNvbnNvbGVMb2dnaW5nID0gY29uc29sZU92ZXJyaWRlICE9PSB1bmRlZmluZWQgPyBjb25zb2xlT3ZlcnJpZGUgOiBjb25zb2xlRGVmYXVsdFxuXG4gICAgLyoqXG4gICAgICogRGVmYXVsdCBsZXZlbHMuXG4gICAgICogQHR5cGUge0FycmF5PFwiZGVidWctbG93LWxldmVsXCIgfCBcImRlYnVnXCIgfCBcImluZm9cIiB8IFwid2FyblwiIHwgXCJlcnJvclwiPn0gKi9cbiAgICBjb25zdCBkZWZhdWx0TGV2ZWxzID0gW1wiaW5mb1wiLCBcIndhcm5cIiwgXCJlcnJvclwiXVxuXG4gICAgaWYgKGluY2x1ZGVMb3dMZXZlbERlYnVnKSBkZWZhdWx0TGV2ZWxzLnVuc2hpZnQoXCJkZWJ1Zy1sb3ctbGV2ZWxcIilcblxuICAgIGNvbnN0IGxldmVscyA9IGNvbmZpZ3VyZWRMZXZlbHMgfHwgZGVmYXVsdExldmVsc1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnNvbGU6IGNvbnNvbGVMb2dnaW5nLFxuICAgICAgZGlyZWN0b3J5LFxuICAgICAgZmlsZTogZmlsZUxvZ2dpbmcgPz8gZmFsc2UsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGxvZ2dlcnMsXG4gICAgICBsZXZlbHMsXG4gICAgICBvdXRwdXRzOiB0aGlzLl9sb2dnaW5nPy5vdXRwdXRzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGNvbmZpZ3VyYXRpb24tb3duZWQgc3RydWN0dXJlZCBsb2dnaW5nIHJlZGFjdG9yLlxuICAgKiBAcmV0dXJucyB7TG9nUmVkYWN0b3J9IC0gU3RydWN0dXJlZCBsb2dnaW5nIHJlZGFjdG9yLlxuICAgKi9cbiAgZ2V0TG9nUmVkYWN0b3IoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2xvZ1JlZGFjdG9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcXVlcnkgbG9nZ2luZyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGRhdGFiYXNlIHF1ZXJ5IGxvZ2dpbmcgaXMgZW5hYmxlZC5cbiAgICovXG4gIGdldFF1ZXJ5TG9nZ2luZ0VuYWJsZWQoKSB7XG4gICAgaWYgKHRoaXMuX2xvZ2dpbmc/LnF1ZXJ5TG9nZ2luZyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fbG9nZ2luZy5xdWVyeUxvZ2dpbmdcblxuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50KCkgIT09IFwidGVzdFwiXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZ2VuZXJhdGlvbiBsaWZlY3ljbGUgdmFsdWVzIGZyb20gdGhlaXIgcmF3IGNvbmZpZywgZW52aXJvbm1lbnQsXG4gICAqIGFuZCBBUEkgc291cmNlcyBiZWZvcmUgYXBwbHlpbmcgZGVmYXVsdHMuIERlcml2ZWQgZGVmYXVsdHMgYXJlIGRlbGliZXJhdGVseVxuICAgKiBhYnNlbnQgZnJvbSB0aGUgc291cmNlIGxpc3QsIHNvIGFuIEFQSSByZWNvdmVyeSBzdGF0ZSBjYW4gb3ZlcnJpZGUgYW5cbiAgICogSUQtb25seSBjb25maWd1cmF0aW9uIHdpdGhvdXQgY3JlYXRpbmcgYSBmYWxzZSBjb25mbGljdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIEV4cGxpY2l0IEFQSSB2YWx1ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGV9IFthcmdzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGVdIC0gRXhwbGljaXQgYm9vdCBzdGF0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmxpZmVjeWNsZVNvY2tldFBhdGhdIC0gRXhwbGljaXQgbGlmZWN5Y2xlIHNvY2tldCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc291cmNlTmFtZV0gLSBIdW1hbi1yZWFkYWJsZSBBUEkgb3duZXIuXG4gICAqIEByZXR1cm5zIHt7Z2VuZXJhdGlvbklkOiBzdHJpbmcgfCB1bmRlZmluZWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGltcG9ydChcIi4vYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZSB8IFwiYWN0aXZlXCIsIGxpZmVjeWNsZVNvY2tldFBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZH19IC0gUmVzb2x2ZWQgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICByZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtnZW5lcmF0aW9uSWQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGg6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aCwgc291cmNlTmFtZSA9IFwiYmFja2dyb3VuZCBqb2JzIEFQSVwifSA9IHt9KSB7XG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JhY2tncm91bmRKb2JzIHx8IHt9XG4gICAgY29uc3QgZ2VuZXJhdGlvbkVudmlyb25tZW50ID0gZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYgfHwge31cbiAgICBjb25zdCBnZW5lcmF0aW9uSWQgPSByZXNvbHZlR2VuZXJhdGlvbklkKFtcbiAgICAgIHtuYW1lOiBcImJhY2tncm91bmRKb2JzLmdlbmVyYXRpb25JZFwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGNvbmZpZ3VyZWQsIFwiZ2VuZXJhdGlvbklkXCIpICYmIGNvbmZpZ3VyZWQuZ2VuZXJhdGlvbklkICE9PSB1bmRlZmluZWQsIHZhbHVlOiBjb25maWd1cmVkLmdlbmVyYXRpb25JZH0sXG4gICAgICB7bmFtZTogXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSURcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihnZW5lcmF0aW9uRW52aXJvbm1lbnQsIFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRH0sXG4gICAgICB7bmFtZTogYCR7c291cmNlTmFtZX0gZ2VuZXJhdGlvbklkYCwgcHJlc2VudDogZXhwbGljaXRHZW5lcmF0aW9uSWQgIT09IHVuZGVmaW5lZCwgdmFsdWU6IGV4cGxpY2l0R2VuZXJhdGlvbklkfVxuICAgIF0pXG4gICAgY29uc3QgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSA9IHJlc29sdmVJbml0aWFsR2VuZXJhdGlvblN0YXRlKFtcbiAgICAgIHtuYW1lOiBcImJhY2tncm91bmRKb2JzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGVcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImluaXRpYWxHZW5lcmF0aW9uU3RhdGVcIikgJiYgY29uZmlndXJlZC5pbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSB1bmRlZmluZWQsIHZhbHVlOiBjb25maWd1cmVkLmluaXRpYWxHZW5lcmF0aW9uU3RhdGV9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19JTklUSUFMX0dFTkVSQVRJT05fU1RBVEVcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihnZW5lcmF0aW9uRW52aXJvbm1lbnQsIFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19JTklUSUFMX0dFTkVSQVRJT05fU1RBVEVcIiksIHZhbHVlOiBnZW5lcmF0aW9uRW52aXJvbm1lbnQuVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19JTklUSUFMX0dFTkVSQVRJT05fU1RBVEV9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGluaXRpYWxHZW5lcmF0aW9uU3RhdGVgLCBwcmVzZW50OiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUgIT09IHVuZGVmaW5lZCwgdmFsdWU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZX1cbiAgICBdLCBnZW5lcmF0aW9uSWQpXG4gICAgY29uc3QgbGlmZWN5Y2xlU29ja2V0UGF0aCA9IHJlc29sdmVMaWZlY3ljbGVTb2NrZXRQYXRoKFtcbiAgICAgIHtuYW1lOiBcImJhY2tncm91bmRKb2JzLmxpZmVjeWNsZVNvY2tldFBhdGhcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImxpZmVjeWNsZVNvY2tldFBhdGhcIikgJiYgY29uZmlndXJlZC5saWZlY3ljbGVTb2NrZXRQYXRoICE9PSB1bmRlZmluZWQsIHZhbHVlOiBjb25maWd1cmVkLmxpZmVjeWNsZVNvY2tldFBhdGh9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19MSUZFQ1lDTEVfU09DS0VUX1BBVEhcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihnZW5lcmF0aW9uRW52aXJvbm1lbnQsIFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19MSUZFQ1lDTEVfU09DS0VUX1BBVEhcIiksIHZhbHVlOiBnZW5lcmF0aW9uRW52aXJvbm1lbnQuVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19MSUZFQ1lDTEVfU09DS0VUX1BBVEh9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGxpZmVjeWNsZVNvY2tldFBhdGhgLCBwcmVzZW50OiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGggIT09IHVuZGVmaW5lZCwgdmFsdWU6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aH1cbiAgICBdLCBnZW5lcmF0aW9uSWQpXG5cbiAgICByZXR1cm4ge2dlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7T21pdDxSZXF1aXJlZDxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNDb25maWd1cmF0aW9uPiwgXCJhZGFwdGVyXCIgfCBcInJldGVudGlvblwiIHwgXCJnZW5lcmF0aW9uSWRcIiB8IFwibGlmZWN5Y2xlU29ja2V0UGF0aFwiPiAmIHtnZW5lcmF0aW9uSWQ/OiBzdHJpbmcsIGxpZmVjeWNsZVNvY2tldFBhdGg/OiBzdHJpbmcsIHJldGVudGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkQmFja2dyb3VuZEpvYnNSZXRlbnRpb25Db25maWd1cmF0aW9ufX0gLSBCYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkge1xuICAgIGNvbnN0IHByb2Nlc3NFbnZpcm9ubWVudCA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52XG4gICAgY29uc3QgZW52SG9zdCA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19IT1NUXG4gICAgY29uc3QgZW52UG9ydFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT1JUXG4gICAgY29uc3QgZW52RGF0YWJhc2VJZGVudGlmaWVyID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0RBVEFCQVNFX0lERU5USUZJRVJcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50Rm9ya2VkUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX01BWF9DT05DVVJSRU5UX0ZPUktFRF9KT0JTXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19NQVhfQ09OQ1VSUkVOVF9JTkxJTkVfSk9CU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvdW50UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfQ09VTlRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX0NPTkNVUlJFTkNZXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4Sm9ic1JhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX01BWF9KT0JTXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfUlNTX0JZVEVTXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX01BWF9MSUZFVElNRV9NU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9TSUxFTkNFX1RJTUVPVVRfTVNcbiAgICBjb25zdCBlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYlJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19SVU5ORVJfTUFYX09MRF9TUEFDRV9TSVpFX01CXG4gICAgY29uc3QgZW52UnVubmVyTWFsbG9jQXJlbmFNYXhSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUlVOTkVSX01BTExPQ19BUkVOQV9NQVhcbiAgICBjb25zdCBlbnZEaXNwYXRjaFN0cmF0ZWd5ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0RJU1BBVENIX1NUUkFURUdZXG4gICAgY29uc3QgZW52UG9sbEludGVydmFsUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPTExfSU5URVJWQUxfTVNcbiAgICBjb25zdCBlbnZKb2JUaW1lb3V0UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0pPQl9USU1FT1VUX01TXG4gICAgY29uc3QgZW52UG9ydCA9IGVudlBvcnRSYXcgPyBOdW1iZXIoZW52UG9ydFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID0gZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA/IE51bWJlcihlbnZNYXhDb25jdXJyZW50Rm9ya2VkUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnQgPSBlbnZNYXhDb25jdXJyZW50UmF3ID8gTnVtYmVyKGVudk1heENvbmN1cnJlbnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ291bnQgPSBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJDb3VudFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPSBlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMgPSBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zUmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPSBlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYlJhdyA/IE51bWJlcihlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYlJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZSdW5uZXJNYWxsb2NBcmVuYU1heCA9IGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4UmF3ID8gTnVtYmVyKGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvbGxJbnRlcnZhbCA9IGVudlBvbGxJbnRlcnZhbFJhdyA/IE51bWJlcihlbnZQb2xsSW50ZXJ2YWxSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52Sm9iVGltZW91dCA9IGVudkpvYlRpbWVvdXRSYXcgPyBOdW1iZXIoZW52Sm9iVGltZW91dFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmFja2dyb3VuZEpvYnMgfHwge31cbiAgICBjb25zdCB7Z2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofSA9IHRoaXMucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZygpXG4gICAgY29uc3QgbW9kZSA9IGNvbmZpZ3VyZWQubW9kZSA9PT0gdW5kZWZpbmVkID8gXCJiYWNrZ3JvdW5kXCIgOiBjb25maWd1cmVkLm1vZGVcblxuICAgIGlmIChtb2RlICE9PSBcImJhY2tncm91bmRcIiAmJiBtb2RlICE9PSBcImlubGluZVwiKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBiYWNrZ3JvdW5kSm9icy5tb2RlIG11c3QgYmUgXCJiYWNrZ3JvdW5kXCIgb3IgXCJpbmxpbmVcIiwgZ290OiAke1N0cmluZyhtb2RlKX1gKVxuICAgIH1cbiAgICBjb25zdCBob3N0ID0gY29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3QgfHwgXCIxMjcuMC4wLjFcIlxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGNvbmZpZ3VyZWQucG9ydFxuICAgICAgOiAodHlwZW9mIGVudlBvcnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvcnQpID8gZW52UG9ydCA6IDczMzEpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gY29uZmlndXJlZC5kYXRhYmFzZUlkZW50aWZpZXIgfHwgZW52RGF0YWJhc2VJZGVudGlmaWVyIHx8IFwiZGVmYXVsdFwiXG4gICAgY29uc3QgbWF4Q29uY3VycmVudElubGluZUpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgICAgOiAodHlwZW9mIGVudk1heENvbmN1cnJlbnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudk1heENvbmN1cnJlbnQpICYmIGVudk1heENvbmN1cnJlbnQgPj0gMSA/IGVudk1heENvbmN1cnJlbnQgOiA0KVxuICAgIGNvbnN0IG1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICAgIDogKHR5cGVvZiBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZNYXhDb25jdXJyZW50Rm9ya2VkKSAmJiBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID49IDEgPyBlbnZNYXhDb25jdXJyZW50Rm9ya2VkIDogNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJDb3VudCA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnQpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnQgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50XG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyQ291bnRcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyQ291bnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lckNvdW50KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lckNvdW50KSAmJiBlbnZQb29sZWRSdW5uZXJDb3VudCA+PSAxID8gZW52UG9vbGVkUnVubmVyQ291bnQgOiA0KVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSkgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJDb25jdXJyZW5jeVwiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID49IDEgPyBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA6IDEpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4Sm9icyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9icykgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9ic1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heEpvYnNcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyTWF4Sm9icykgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhKb2JzID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhKb2JzIDogMTAwKVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgOiA1MTIgKiAxMDI0ICogMTAyNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpICYmIGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgOiA2MCAqIDYwICogMTAwMClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMpICYmIGVudlBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMgOiAxMjAwMDApXG4gICAgLy8gUnVubmVyIGNoaWxkcmVuIGdldCBhIGhhcmQgVjggaGVhcCBjYXAgYW5kIGEgYm91bmRlZCBnbGliYyBhcmVuYSBjb3VudFxuICAgIC8vIHNvIG9uZSBjaGlsZCBjYW4gbmV2ZXIgY29tbWl0IG11bHRpcGxlIEdCcyBvZiBoZWFwIG9yIHVuYm91bmRlZFxuICAgIC8vIGFsbG9jYXRvciBhcmVuYXMuIFRoZSBjYXAgc3RheXMgZmFyIGFib3ZlIG9ic2VydmVkIHJ1bm5lciB1c2FnZTsgYW5cbiAgICAvLyBpbmhlcml0ZWQgTUFMTE9DX0FSRU5BX01BWCBpcyBob25vcmVkIGJlZm9yZSB0aGUgYnVpbHQtaW4gZGVmYXVsdC5cbiAgICBjb25zdCBydW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9IHR5cGVvZiBjb25maWd1cmVkLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iKSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucnVubmVyTWF4T2xkU3BhY2VTaXplTWIpICYmIGNvbmZpZ3VyZWQucnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPj0gNjRcbiAgICAgID8gY29uZmlndXJlZC5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYlxuICAgICAgOiAoIShcInJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYikgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYikgJiYgZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPj0gNjQgPyBlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYiA6IDIwNDgpXG4gICAgY29uc3QgaW5oZXJpdGVkTWFsbG9jQXJlbmFNYXggPSBwcm9jZXNzRW52aXJvbm1lbnQ/Lk1BTExPQ19BUkVOQV9NQVggPyBOdW1iZXIocHJvY2Vzc0Vudmlyb25tZW50Lk1BTExPQ19BUkVOQV9NQVgpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgcnVubmVyTWFsbG9jQXJlbmFNYXggPSB0eXBlb2YgY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heCkgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnJ1bm5lck1hbGxvY0FyZW5hTWF4KSAmJiBjb25maWd1cmVkLnJ1bm5lck1hbGxvY0FyZW5hTWF4ID49IDFcbiAgICAgID8gY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heFxuICAgICAgOiAoIShcInJ1bm5lck1hbGxvY0FyZW5hTWF4XCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZSdW5uZXJNYWxsb2NBcmVuYU1heCkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZSdW5uZXJNYWxsb2NBcmVuYU1heCkgJiYgZW52UnVubmVyTWFsbG9jQXJlbmFNYXggPj0gMVxuICAgICAgICA/IGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4XG4gICAgICAgIDogKHR5cGVvZiBpbmhlcml0ZWRNYWxsb2NBcmVuYU1heCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKGluaGVyaXRlZE1hbGxvY0FyZW5hTWF4KSAmJiBpbmhlcml0ZWRNYWxsb2NBcmVuYU1heCA+PSAxID8gaW5oZXJpdGVkTWFsbG9jQXJlbmFNYXggOiA0KSlcbiAgICBjb25zdCBkaXNwYXRjaFN0cmF0ZWd5UmF3ID0gY29uZmlndXJlZC5kaXNwYXRjaFN0cmF0ZWd5IHx8IGVudkRpc3BhdGNoU3RyYXRlZ3lcbiAgICBjb25zdCBkaXNwYXRjaFN0cmF0ZWd5ID0gZGlzcGF0Y2hTdHJhdGVneVJhdyA9PT0gXCJwb2xsaW5nXCIgPyBcInBvbGxpbmdcIiA6IFwiYmVhY29uXCJcbiAgICBjb25zdCBwb2xsSW50ZXJ2YWxNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQucG9sbEludGVydmFsTXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zXG4gICAgICA6ICh0eXBlb2YgZW52UG9sbEludGVydmFsID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb2xsSW50ZXJ2YWwpICYmIGVudlBvbGxJbnRlcnZhbCA+PSAxID8gZW52UG9sbEludGVydmFsIDogMTAwMClcbiAgICBjb25zdCBkcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zID0gdHlwZW9mIGNvbmZpZ3VyZWQuZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLmRyYWluU3RvcmVPcGVyYXRpb25UaW1lb3V0TXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLmRyYWluU3RvcmVPcGVyYXRpb25UaW1lb3V0TXNcbiAgICAgIDogNjBfMDAwXG4gICAgLy8gYG51bGxgIGlzIGFuIGV4cGxpY2l0IG9wdC1vdXQgb2YgdGhlIHNjaGVkdWxlZC1lbnF1ZXVlIGJvdW5kLiBBIHByZXNlbnRcbiAgICAvLyBidXQgbm9uLXBvc2l0aXZlIG51bWJlciBpcyBhIG1pc3Rha2UsIG5vdCBhbiBvcHQtb3V0LCBzbyBpdCBmYWxscyBiYWNrIHRvXG4gICAgLy8gdGhlIGZyYW1ld29yayBkZWZhdWx0IHJhdGhlciB0aGFuIHNpbGVudGx5IGRpc2FibGluZyB0aGUgd2F0Y2hkb2cuXG4gICAgY29uc3Qgc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNcyA9IFwic2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNc1wiIGluIGNvbmZpZ3VyZWRcbiAgICAgID8gKFxuICAgICAgICBjb25maWd1cmVkLnNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMgPT09IG51bGwgP1xuICAgICAgICAgIG51bGxcbiAgICAgICAgOiAoXG4gICAgICAgICAgdHlwZW9mIGNvbmZpZ3VyZWQuc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLnNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMgPiAwID9cbiAgICAgICAgICAgIGNvbmZpZ3VyZWQuc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNc1xuICAgICAgICAgIDogREVGQVVMVF9TQ0hFRFVMRURfRU5RVUVVRV9USU1FT1VUX01TXG4gICAgICAgIClcbiAgICAgIClcbiAgICAgIDogREVGQVVMVF9TQ0hFRFVMRURfRU5RVUVVRV9USU1FT1VUX01TXG4gICAgY29uc3QgcXVldWVzID0gY29uZmlndXJlZC5xdWV1ZXMgJiYgdHlwZW9mIGNvbmZpZ3VyZWQucXVldWVzID09PSBcIm9iamVjdFwiID8gY29uZmlndXJlZC5xdWV1ZXMgOiB7fVxuICAgIC8vIEFuIGV4cGxpY2l0IGNvbmZpZyB2YWx1ZSB3aW5zIG92ZXIgdGhlIGVudiB2YXIg4oCUIGluY2x1ZGluZyBgbnVsbGAvYDBgLFxuICAgIC8vIHdoaWNoIGRpc2FibGUgdGhlIGJhY2tzdG9wIGV2ZW4gd2hlbiB0aGUgZW52aXJvbm1lbnQgc2V0cyBhIGRlZmF1bHQuXG4gICAgLy8gT25seSBmYWxsIHRocm91Z2ggdG8gdGhlIGVudiB2YXIgd2hlbiBjb25maWcgb21pdHMgYGpvYlRpbWVvdXRNc2AgZW50aXJlbHkuXG4gICAgY29uc3Qgam9iVGltZW91dE1zID0gXCJqb2JUaW1lb3V0TXNcIiBpbiBjb25maWd1cmVkXG4gICAgICA/ICh0eXBlb2YgY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgPiAwID8gY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgOiBudWxsKVxuICAgICAgOiAodHlwZW9mIGVudkpvYlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudkpvYlRpbWVvdXQpICYmIGVudkpvYlRpbWVvdXQgPiAwID8gZW52Sm9iVGltZW91dCA6IG51bGwpXG4gICAgY29uc3QgY29uZmlndXJlZFJldGVudGlvbiA9IGNvbmZpZ3VyZWQucmV0ZW50aW9uICYmIHR5cGVvZiBjb25maWd1cmVkLnJldGVudGlvbiA9PT0gXCJvYmplY3RcIiA/IGNvbmZpZ3VyZWQucmV0ZW50aW9uIDoge31cbiAgICBjb25zdCByZXRlbnRpb24gPSB7XG4gICAgICBjb21wbGV0ZWRUdGxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXMgPT09IFwibnVtYmVyXCIgfHwgY29uZmlndXJlZFJldGVudGlvbi5jb21wbGV0ZWRUdGxNcyA9PT0gbnVsbFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXNcbiAgICAgICAgOiA3ICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgICAgIGZhaWxlZFR0bE1zOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNcyA9PT0gXCJudW1iZXJcIiB8fCBjb25maWd1cmVkUmV0ZW50aW9uLmZhaWxlZFR0bE1zID09PSBudWxsXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNc1xuICAgICAgICA6IDMwICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgICAgIGJhdGNoU2l6ZTogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplID4gMFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplXG4gICAgICAgIDogMTAwMCxcbiAgICAgIHN3ZWVwSW50ZXJ2YWxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zID4gMFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zXG4gICAgICAgIDogNjAgKiA2MCAqIDEwMDBcbiAgICB9XG5cbiAgICBjb25zdCBqb2JDbGFzc2VzID0gdGhpcy5nZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpXG5cbiAgICByZXR1cm4ge2hvc3QsIHBvcnQsIGRhdGFiYXNlSWRlbnRpZmllciwgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMsIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzLCBtb2RlLCBwb29sZWRSdW5uZXJDb3VudCwgcG9vbGVkUnVubmVyQ29uY3VycmVuY3ksIHBvb2xlZFJ1bm5lck1heEpvYnMsIHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzLCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zLCBwb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zLCBydW5uZXJNYXhPbGRTcGFjZVNpemVNYiwgcnVubmVyTWFsbG9jQXJlbmFNYXgsIGRpc3BhdGNoU3RyYXRlZ3ksIHBvbGxJbnRlcnZhbE1zLCBkcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zLCBzY2hlZHVsZWRFbnF1ZXVlVGltZW91dE1zLCBxdWV1ZXMsIGpvYkNsYXNzZXMsIGpvYlRpbWVvdXRNcywgcmV0ZW50aW9uLCBnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBzdGF0aWNhbGx5IHJlZ2lzdGVyZWQgcG9ydGFibGUgYmFja2dyb3VuZCBqb2JzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDbGFzc1tdfSAtIENvbmZpZ3VyZWQgam9iIGNsYXNzZXMuXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpIHtcbiAgICBjb25zdCBqb2JDbGFzc2VzID0gdGhpcy5fYmFja2dyb3VuZEpvYnM/LmpvYkNsYXNzZXNcblxuICAgIGlmIChqb2JDbGFzc2VzID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICAgIGlmICghQXJyYXkuaXNBcnJheShqb2JDbGFzc2VzKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmpvYkNsYXNzZXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuXG4gICAgcmV0dXJuIFsuLi5qb2JDbGFzc2VzXVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuZCBtZW1vaXplcyBvbmUgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXIgZm9yIHRoaXMgY29uZmlndXJhdGlvbiBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJ9IC0gQWN0aXZlIGFkYXB0ZXIuXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24pIHJldHVybiB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uLmFkYXB0ZXJcblxuICAgIGNvbnN0IGNvbmZpZ3VyZWRBZGFwdGVyID0gdGhpcy5fYmFja2dyb3VuZEpvYnM/LmFkYXB0ZXJcbiAgICBjb25zdCBhZGFwdGVyID0gdHlwZW9mIGNvbmZpZ3VyZWRBZGFwdGVyID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gY29uZmlndXJlZEFkYXB0ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgOiAoY29uZmlndXJlZEFkYXB0ZXIgfHwgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5jcmVhdGVCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXN9KSlcblxuICAgIGlmICghKGFkYXB0ZXIgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiYmFja2dyb3VuZEpvYnMuYWRhcHRlciBtdXN0IGJlIGEgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGluc3RhbmNlIG9yIGEgc3luY2hyb25vdXMgZmFjdG9yeSByZXR1cm5pbmcgb25lXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHtcbiAgICAgIGFkYXB0ZXIsXG4gICAgICBjbG9zaW5nOiBmYWxzZSxcbiAgICAgIGNsb3NlUHJvbWlzZTogdW5kZWZpbmVkLFxuICAgICAgcmVhZHlQcm9taXNlOiB1bmRlZmluZWRcbiAgICB9XG4gICAgcmV0dXJuIGFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IGFjcXVpcmVzIHRoZSBleGFjdCByZWFkeSBhZGFwdGVyIGZvciB0aGUgYWN0aXZlIGxpZmVjeWNsZS5cbiAgICogQSBjbG9zZSB0aGF0IGNsYWltcyB0aGUgZ2VuZXJhdGlvbiB3aGlsZSByZWFkaW5lc3MgaXMgcGVuZGluZyB3aW5zOiB0aGlzXG4gICAqIG9wZXJhdGlvbiB3YWl0cyBmb3IgdGhhdCBjbG9zZSwgY3JlYXRlcyB0aGUgbmV4dCBnZW5lcmF0aW9uLCByZWFkaWVzIGl0LFxuICAgKiBhbmQgcmV0dXJucyBvbmx5IHRoYXQgbGl2ZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYnNBZGFwdGVyPn0gLSBFeGFjdCByZWFkeSBhZGFwdGVyIGdlbmVyYXRpb24uXG4gICAqL1xuICBhc3luYyBhY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IGRhdGFiYXNlQ2xvc2VQcm9taXNlID0gdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuXG4gICAgICBpZiAoZGF0YWJhc2VDbG9zZVByb21pc2UpIHtcbiAgICAgICAgYXdhaXQgZGF0YWJhc2VDbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhpcy5nZXRCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cblxuICAgICAgaWYgKCFnZW5lcmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBnZW5lcmF0aW9uIHdhcyBub3QgY3JlYXRlZFwiKVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zaW5nKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgfHwgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGdlbmVyYXRpb24uYWRhcHRlci5lbnN1cmVSZWFkeSgpXG4gICAgICB9KVxuXG4gICAgICBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9IHJlYWR5UHJvbWlzZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZWFkeVByb21pc2VcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zaW5nKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gIT09IGdlbmVyYXRpb24pIGNvbnRpbnVlXG5cbiAgICAgIHJldHVybiBnZW5lcmF0aW9uLmFkYXB0ZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVhZGllcyB0aGUgYWN0aXZlIGFkYXB0ZXIgb25jZSBwZXIgbGlmZWN5Y2xlLiBBIGZhaWxlZCBhdHRlbXB0IHJlbWFpbnMgcmV0cnlhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQmFja2dyb3VuZEpvYnNBZGFwdGVyUmVhZHkoKSB7XG4gICAgYXdhaXQgdGhpcy5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgaGVhbHRoIHdpdGhvdXQgcmVzb2x2aW5nIHBlcnNpc3RlbmNlIGluIG5vbi1kdXJhYmxlIGlubGluZSBtb2RlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0hlYWx0aD59IC0gQ3VycmVudCBoZWFsdGguXG4gICAqL1xuICBhc3luYyBiYWNrZ3JvdW5kSm9ic0hlYWx0aCgpIHtcbiAgICBpZiAodGhpcy5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLm1vZGUgPT09IFwiaW5saW5lXCIpIHJldHVybiB7cmVhZHk6IHRydWV9XG5cbiAgICBjb25zdCBhZGFwdGVyID0gYXdhaXQgdGhpcy5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFkYXB0ZXIuaGVhbHRoKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgdGhlIHJlc29sdmVkIGFkYXB0ZXIgb25jZSBhbmQgY2xlYXJzIGxpZmVjeWNsZSBjYWNoZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNsb3NlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cblxuICAgIGlmICghZ2VuZXJhdGlvbikgcmV0dXJuXG4gICAgaWYgKGdlbmVyYXRpb24uY2xvc2VQcm9taXNlKSByZXR1cm4gYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcblxuICAgIGdlbmVyYXRpb24uY2xvc2luZyA9IHRydWVcbiAgICBjb25zdCBjbG9zZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgICAgY29uc3QgY2xvc2VFcnJvcnMgPSBbXVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGdlbmVyYXRpb24uYWRhcHRlci5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cblxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgY2xvc2VFcnJvcnNbMF1cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoY2xvc2VFcnJvcnMsIFwiRmFpbGVkIHRvIHJlYWR5IGFuZCBjbG9zZSB0aGUgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXJcIilcbiAgICB9KSgpXG5cbiAgICBnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSA9IGNsb3NlUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsb3NlUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9PT0gZ2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbn0gYmFja2dyb3VuZEpvYnMgLSBCYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEJhY2tncm91bmRKb2JzQ29uZmlnKGJhY2tncm91bmRKb2JzKSB7XG4gICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gJiYgYmFja2dyb3VuZEpvYnMuYWRhcHRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVwbGFjZSBiYWNrZ3JvdW5kSm9icy5hZGFwdGVyIGR1cmluZyBhbiBhY3RpdmUgYWRhcHRlciBsaWZlY3ljbGU7IGNsb3NlIGl0IGZpcnN0XCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iYWNrZ3JvdW5kSm9icywgYmFja2dyb3VuZEpvYnMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGFjdGl2ZSBCZWFjb24gY29uZmlndXJhdGlvbi4gQmVhY29uIGlzIG9wdC1pbjogaXRcbiAgICogc3RheXMgZGlzYWJsZWQgdW5sZXNzIHRoZSBhcHAgcGFzc2VzIGBiZWFjb246IHtob3N0LCBwb3J0fWAgL1xuICAgKiBgYmVhY29uOiB7aW5Qcm9jZXNzOiB0cnVlfWAsIGNhbGxzIGBzZXRCZWFjb25Db25maWcoey4uLn0pYCwgb3JcbiAgICogc2V0cyB0aGUgYFZFTE9DSU9VU19CRUFDT05fSE9TVGAgLyBgVkVMT0NJT1VTX0JFQUNPTl9QT1JUYCBlbnYgdmFycy5cbiAgICogU2V0dGluZyBgZW5hYmxlZDogZmFsc2VgIGV4cGxpY2l0bHkgZGlzYWJsZXMgaXQgZXZlbiB3aGVuIGVudiB2YXJzXG4gICAqIGFyZSBwcmVzZW50ICh1c2VmdWwgZm9yIHRlc3RzKS4gV2hlbiBgaW5Qcm9jZXNzOiB0cnVlYCBpcyBzZXQsXG4gICAqIGVudi12YXIgaG9zdC9wb3J0IGFyZSBpZ25vcmVkIOKAlCBjb2RlLWxldmVsIGNvbmZpZyB3aW5zLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIGhvc3Q6IHN0cmluZywgcG9ydDogbnVtYmVyLCBwZWVyVHlwZT86IHN0cmluZywgaW5Qcm9jZXNzOiBib29sZWFuLCB1bnJlYWNoYWJsZVJlcG9ydE1zOiBudW1iZXJ9fSAtIEJlYWNvbiBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdHMgYXBwbGllZC5cbiAgICovXG4gIGdldEJlYWNvbkNvbmZpZygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmVhY29uIHx8IHt9XG4gICAgY29uc3QgaW5Qcm9jZXNzID0gY29uZmlndXJlZC5pblByb2Nlc3MgPT09IHRydWVcblxuICAgIGlmIChpblByb2Nlc3MgJiYgKGNvbmZpZ3VyZWQuaG9zdCB8fCB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQmVhY29uIGNvbmZpZ3VyYXRpb246IGBpblByb2Nlc3M6IHRydWVgIGlzIG11dHVhbGx5IGV4Y2x1c2l2ZSB3aXRoIGBob3N0YC9gcG9ydGAuIFVzZSBvbmUgb3IgdGhlIG90aGVyLlwiKVxuICAgIH1cblxuICAgIGNvbnN0IGVudkhvc3QgPSBpblByb2Nlc3MgPyB1bmRlZmluZWQgOiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQkVBQ09OX0hPU1RcbiAgICBjb25zdCBlbnZQb3J0UmF3ID0gaW5Qcm9jZXNzID8gdW5kZWZpbmVkIDogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JFQUNPTl9QT1JUXG4gICAgY29uc3QgZW52UG9ydCA9IGVudlBvcnRSYXcgPyBOdW1iZXIoZW52UG9ydFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBob3N0ID0gY29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3QgfHwgXCIxMjcuMC4wLjFcIlxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGNvbmZpZ3VyZWQucG9ydFxuICAgICAgOiAodHlwZW9mIGVudlBvcnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvcnQpID8gZW52UG9ydCA6IDczMzApXG5cbiAgICBsZXQgZW5hYmxlZFxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkLmVuYWJsZWQgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICBlbmFibGVkID0gY29uZmlndXJlZC5lbmFibGVkXG4gICAgfSBlbHNlIHtcbiAgICAgIGVuYWJsZWQgPSBCb29sZWFuKGluUHJvY2VzcyB8fCBjb25maWd1cmVkLmhvc3QgfHwgY29uZmlndXJlZC5wb3J0IHx8IGVudkhvc3QgfHwgZW52UG9ydClcbiAgICB9XG5cbiAgICBjb25zdCB1bnJlYWNoYWJsZVJlcG9ydE1zID0gcmVzb2x2ZUJlYWNvblVucmVhY2hhYmxlUmVwb3J0TXMoY29uZmlndXJlZC51bnJlYWNoYWJsZVJlcG9ydE1zKVxuXG4gICAgcmV0dXJuIHtlbmFibGVkLCBob3N0LCBwb3J0LCBwZWVyVHlwZTogY29uZmlndXJlZC5wZWVyVHlwZSwgaW5Qcm9jZXNzLCB1bnJlYWNoYWJsZVJlcG9ydE1zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJlYWNvbiBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJlYWNvbkNvbmZpZ3VyYXRpb259IGJlYWNvbiAtIEJlYWNvbiBjb25maWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QmVhY29uQ29uZmlnKGJlYWNvbikge1xuICAgIHRoaXMuX2JlYWNvbiA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2JlYWNvbiwgYmVhY29uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJlYWNvbiBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIGFjdGl2ZSBCZWFjb24gY2xpZW50LCBpZiBjb25uZWN0ZWQuXG4gICAqL1xuICBnZXRCZWFjb25DbGllbnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2JlYWNvbkNsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRoaXMgY29uZmlndXJhdGlvbidzIEJlYWNvbiBjbGllbnQgdG8gdGhlIGNvbmZpZ3VyZWRcbiAgICogYnJva2VyLCB3aXJpbmcgaW5jb21pbmcgYnJvYWRjYXN0cyB0byB0aGUgbG9jYWwgZGVsaXZlcnkgcGF0aCBzb1xuICAgKiBhbnkgd2Vic29ja2V0IHN1YnNjcmliZXJzIGluIHRoaXMgcHJvY2VzcyByZWNlaXZlIHRoZW0uIElkZW1wb3RlbnRcbiAgICog4oCUIHJlcGVhdCBjYWxscyByZXR1cm4gdGhlIHNhbWUgaW4tZmxpZ2h0IG9yIHJlc29sdmVkIHByb21pc2UuXG4gICAqXG4gICAqIFJldHVybnMgaW1tZWRpYXRlbHkgd2l0aCBgdW5kZWZpbmVkYCBpZiBCZWFjb24gaXMgbm90IGVuYWJsZWQuXG4gICAqXG4gICAqICoqTm9uLWJsb2NraW5nIGJ5IGRlc2lnbiAoVENQIG1vZGUpLioqIEZvciBicm9rZXItYmFja2VkIEJlYWNvbiwgdGhlXG4gICAqIHJldHVybmVkIHByb21pc2UgcmVzb2x2ZXMgYXMgc29vbiBhcyB0aGUgY2xpZW50IGlzIGNvbnN0cnVjdGVkIGFuZFxuICAgKiB0aGUgVENQIGNvbm5lY3QgaXMgbGF1bmNoZWQg4oCUIGl0IGRvZXMgKipub3QqKiB3YWl0IGZvciB0aGUgY29ubmVjdFxuICAgKiBoYW5kc2hha2UgdG8gY29tcGxldGUuIEEgYnJva2VyIHRoYXQgc2lsZW50bHkgZHJvcHMgU1lOc1xuICAgKiAoZmlyZXdhbGwvTkFDTCBEUk9QIHJ1bGVzKSB3b3VsZCBvdGhlcndpc2UgYmxvY2sgc3RhcnR1cCBvbiB0aGUgT1NcbiAgICogVENQIGNvbm5lY3QgdGltZW91dCAodGVucyBvZiBzZWNvbmRzKSwgd2hpY2ggY29udHJhZGljdHMgdGhlXG4gICAqIGRvY3VtZW50ZWQgXCJmYWxsIGJhY2sgdG8gbG9jYWwtb25seSBhbmQgcmVjb25uZWN0IGluIHRoZVxuICAgKiBiYWNrZ3JvdW5kXCIgY29udHJhY3QuIEluaXRpYWwtY29ubmVjdCBmYWlsdXJlcyBzdXJmYWNlXG4gICAqIGFzeW5jaHJvbm91c2x5IG9uIHRoZSBmcmFtZXdvcmstZXJyb3IgY2hhbm5lbCB2aWEgdGhlXG4gICAqIGBjb25uZWN0LWVycm9yYCBsaXN0ZW5lciByZWdpc3RlcmVkIGhlcmUuIENhbGxlcnMgdGhhdCBuZWVkIGFcbiAgICogZGV0ZXJtaW5pc3RpYyBwdWJsaXNoLXJlYWRpbmVzcyBib3VuZGFyeSBzaG91bGQgY2FsbFxuICAgKiBgZ2V0QmVhY29uQ2xpZW50KCk/LndhaXRGb3JSZWFkeSh7dGltZW91dE1zfSlgLlxuICAgKlxuICAgKiAqKkluLXByb2Nlc3MgbW9kZSoqIGF3YWl0cyBgY29ubmVjdCgpYCDigJQgdGhhdCBwYXRoIGlzIHN5bmNocm9ub3VzLFxuICAgKiBjYW5ub3QgZmFpbCwgYW5kIGdpdmVzIGNhbGxlcnMgcHJlZGljdGFibGUgcmVhZGluZXNzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnBlZXJUeXBlXSAtIE92ZXJyaWRlIHBlZXJUeXBlIGZvciB0aGlzIGNvbm5lY3QgY2FsbCAoZS5nLiBgXCJzZXJ2ZXJcImAsIGBcImJhY2tncm91bmQtam9icy13b3JrZXJcImApLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlZ2lzdGVyZWQgY2xpZW50IChUQ1AgbW9kZTogY29ubmVjdCBtYXkgc3RpbGwgYmUgaW4gZmxpZ2h0KSwgb3IgdW5kZWZpbmVkIHdoZW4gQmVhY29uIGlzIGRpc2FibGVkLlxuICAgKi9cbiAgYXN5bmMgY29ubmVjdEJlYWNvbih7cGVlclR5cGV9ID0ge30pIHtcbiAgICBpZiAodGhpcy5fYmVhY29uQ2xpZW50KSByZXR1cm4gdGhpcy5fYmVhY29uQ2xpZW50XG4gICAgaWYgKHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2VcblxuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QmVhY29uQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNsaWVudCA9IGF3YWl0IHRoaXMuX2NyZWF0ZUJlYWNvbkNsaWVudCh7XG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgcGVlclR5cGU6IHBlZXJUeXBlIHx8IGNvbmZpZy5wZWVyVHlwZVxuICAgICAgfSlcblxuICAgICAgY2xpZW50Lm9uQnJvYWRjYXN0KChtZXNzYWdlKSA9PiB7XG4gICAgICAgIC8vIFN5bmFwc2Utc3R5bGUgZmFuLW91dDogZGVsaXZlciBldmVyeSBicm9hZGNhc3Qgd2UgcmVjZWl2ZVxuICAgICAgICAvLyBmcm9tIHRoZSBidXMgdGhyb3VnaCB0aGUgbG9jYWwgZGVsaXZlcnkgcGF0aC4gRWNob2VzIG9mIG91clxuICAgICAgICAvLyBvd24gcHVibGlzaGVzIGZvbGxvdyB0aGUgc2FtZSBwYXRoIHNvIGV2ZXJ5IHBlZXIgc2VlcyB0aGVcbiAgICAgICAgLy8gc2FtZSBkZWxpdmVyeSBzZW1hbnRpY3MuXG4gICAgICAgIHRoaXMuX2RlbGl2ZXJCcm9hZGNhc3RGcm9tQmVhY29uKG1lc3NhZ2UpXG4gICAgICB9KVxuXG4gICAgICAvLyBCZWFjb24gY29ubmVjdC9kaXNjb25uZWN0IGJsaXBzIGFyZSBleHBlY3RlZCBkdXJpbmcgZGVwbG95cyAodGhlIGJyb2tlclxuICAgICAgLy8gcmVzdGFydHMpIGFuZCB0aGUgQmVhY29uQ2xpZW50IGF1dG8tcmVjb25uZWN0cyBpbiB0aGUgYmFja2dyb3VuZCwgc28gYVxuICAgICAgLy8gc2luZ2xlIHRyYW5zaWVudCBmYWlsdXJlIGlzIE5PVCByZXBvcnRlZC4gT25seSBhIHN1c3RhaW5lZCBvdXRhZ2UgKHN0aWxsXG4gICAgICAvLyBkb3duIGFmdGVyIGB1bnJlYWNoYWJsZVJlcG9ydE1zYCkgaXMgc3VyZmFjZWQgb24gdGhlIGZyYW1ld29yay1lcnJvclxuICAgICAgLy8gY2hhbm5lbDsgYSAocmUpY29ubmVjdCB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyBjbGVhcnMgaXQgc2lsZW50bHkuXG5cbiAgICAgIC8vIGBjb25uZWN0LWVycm9yYCBmaXJlcyB3aGVuIHRoZSAqaW5pdGlhbCogVENQL2hhbmRzaGFrZSBmYWlscy5cbiAgICAgIGNsaWVudC5vbihcImNvbm5lY3QtZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlOiBcImJlYWNvbi1jb25uZWN0XCIsIGVycm9yLCByZXBvcnRBZnRlck1zOiBjb25maWcudW5yZWFjaGFibGVSZXBvcnRNc30pXG4gICAgICB9KVxuXG4gICAgICAvLyBgZGlzY29ubmVjdGAgZmlyZXMgd2hlbiBhbiBlc3RhYmxpc2hlZCBjb25uZWN0aW9uIGRyb3BzLiBUaGUgcGF5bG9hZCBpc1xuICAgICAgLy8gdGhlIHVuZGVybHlpbmcgc29ja2V0IGVycm9yIGlmIHRoZXJlIHdhcyBvbmUsIG9yIGEgc3ludGhldGljXG4gICAgICAvLyBFcnJvcihcIkJlYWNvbiBicm9rZXIgZGlzY29ubmVjdGVkXCIpIG90aGVyd2lzZS5cbiAgICAgIGNsaWVudC5vbihcImRpc2Nvbm5lY3RcIiwgKHJlYXNvbikgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZTogXCJiZWFjb24tZGlzY29ubmVjdFwiLCBlcnJvcjogcmVhc29uLCByZXBvcnRBZnRlck1zOiBjb25maWcudW5yZWFjaGFibGVSZXBvcnRNc30pXG4gICAgICB9KVxuXG4gICAgICAvLyBgY29ubmVjdGAgZmlyZXMgb24gZXZlcnkgKHJlKWNvbm5lY3Q7IGNsZWFyIGFueSBwZW5kaW5nIG91dGFnZSBzdGF0ZSBzb1xuICAgICAgLy8gYSB0cmFuc2llbnQgYmxpcCB0aGF0IHJlY292ZXJzIHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93IHN0YXlzIHNpbGVudC5cbiAgICAgIGNsaWVudC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25VcCgpXG4gICAgICB9KVxuXG4gICAgICAvLyBSZWdpc3RlciB0aGUgY2xpZW50ICpiZWZvcmUqIGtpY2tpbmcgb2ZmIGNvbm5lY3Qgc28gc3Vic2VxdWVudFxuICAgICAgLy8gYGNvbm5lY3RCZWFjb24oKWAgY2FsbHMgcmV0dXJuIHRoaXMgc2FtZSBpbnN0YW5jZSBpbnN0ZWFkIG9mXG4gICAgICAvLyByYWNpbmcgdG8gY29uc3RydWN0IGEgc2Vjb25kIG9uZS5cbiAgICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IGNsaWVudFxuXG4gICAgICBpZiAoY29uZmlnLmluUHJvY2Vzcykge1xuICAgICAgICAvLyBJbi1wcm9jZXNzIGNvbm5lY3QgaXMgc3luY2hyb25vdXMsIGNhbm5vdCBmYWlsLCBhbmQgcmVzb2x2ZXNcbiAgICAgICAgLy8gYmVmb3JlIHRoaXMgYXdhaXQgeWllbGRzIOKAlCBjYWxsZXJzIGNhbiByZWx5IG9uXG4gICAgICAgIC8vIGBpc0Nvbm5lY3RlZCgpID09PSB0cnVlYCBpbW1lZGlhdGVseSBhZnRlciBgY29ubmVjdEJlYWNvbigpYC5cbiAgICAgICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRmlyZS1hbmQtZm9yZ2V0IHRoZSBUQ1AgY29ubmVjdC4gQXdhaXRpbmcgaGVyZSB3b3VsZCBibG9ja1xuICAgICAgICAvLyBzdGFydHVwIG9uIHRoZSBPUyBUQ1AgY29ubmVjdCB0aW1lb3V0ICg3NXMgZGVmYXVsdCBvbiBMaW51eClcbiAgICAgICAgLy8gd2hlbiB0aGUgYnJva2VyIHNpbGVudGx5IGRyb3BzIFNZTnMuIEZhaWx1cmVzIHN1cmZhY2VcbiAgICAgICAgLy8gYXN5bmNocm9ub3VzbHkgdmlhIHRoZSBgY29ubmVjdC1lcnJvcmAgbGlzdGVuZXIgcmVnaXN0ZXJlZFxuICAgICAgICAvLyBhYm92ZTsgdGhlIEJlYWNvbkNsaWVudCdzIHJlY29ubmVjdCBsb29wIGtlZXBzIHRyeWluZy5cbiAgICAgICAgdm9pZCBjbGllbnQuY29ubmVjdCgpLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBBbHJlYWR5IHJlcG9ydGVkIHZpYSBjb25uZWN0LWVycm9yIGFib3ZlLlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2xpZW50XG4gICAgfSkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgQmVhY29uIGNsaWVudCBtYXRjaGluZyB0aGUgY29uZmlndXJlZCBtb2RlLiBTcGxpdCBvdXQgc29cbiAgICogYGNvbm5lY3RCZWFjb25gIHN0YXlzIGZvY3VzZWQgb24gbGlmZWN5Y2xlIGFuZCBlcnJvciB3aXJpbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPFZlbG9jaW91c0NvbmZpZ3VyYXRpb25bXCJnZXRCZWFjb25Db25maWdcIl0+fSBhcmdzLmNvbmZpZyAtIFJlc29sdmVkIEJlYWNvbiBjb25maWcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBSZXNvbHZlZCBwZWVyIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdD59IC0gQmVhY29uIGNsaWVudC5cbiAgICovXG4gIGFzeW5jIF9jcmVhdGVCZWFjb25DbGllbnQoe2NvbmZpZywgcGVlclR5cGV9KSB7XG4gICAgLy8gUm91dGUgdGhyb3VnaCB0aGUgZW52aXJvbm1lbnQgaGFuZGxlciBzbyB0aGUgTm9kZS1vbmx5IGBub2RlOm5ldGBcbiAgICAvLyAvIGBub2RlOmNyeXB0b2AgZGVwcyBpbiB0aGUgQmVhY29uIGNsaWVudCBtb2R1bGVzIGRvbid0IGdldCBwdWxsZWRcbiAgICAvLyBpbnRvIGJyb3dzZXIgYnVuZGxlcy4gQnJvd3NlciBidW5kbGVzIHN0YXRpY2FsbHkgcmVhY2hcbiAgICAvLyBgQ29uZmlndXJhdGlvbmAgKHZpYSBgTG9nZ2VyYCk7IHB1dHRpbmcgdGhlIGR5bmFtaWNcbiAgICAvLyBgaW1wb3J0KFwiLi9iZWFjb24vLi4uXCIpYCBjYWxscyBoZXJlIHdvdWxkIHN0aWxsIGRyYWcgdGhvc2UgbW9kdWxlc1xuICAgIC8vIHRocm91Z2ggZXNidWlsZCdzIHN0YXRpYyBhbmFseXNpcy4gSGlkaW5nIHRoZSBpbXBvcnRzIGluc2lkZSB0aGVcbiAgICAvLyBOb2RlIGVudmlyb25tZW50IGhhbmRsZXIga2VlcHMgdGhlbSBvZmYgdGhlIGJyb3dzZXIgcGF0aCDigJRcbiAgICAvLyBicm93c2VyLWJ1bmRsZWQgYXBwcyBuZXZlciByZWFjaCBgZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS5qc2AuXG4gICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmIChjb25maWcuaW5Qcm9jZXNzKSB7XG4gICAgICBjb25zdCBJblByb2Nlc3NCZWFjb25DbGllbnQgPSBhd2FpdCBoYW5kbGVyLmxvYWRJblByb2Nlc3NCZWFjb25DbGllbnQoKVxuXG4gICAgICByZXR1cm4gbmV3IEluUHJvY2Vzc0JlYWNvbkNsaWVudCh7cGVlclR5cGV9KVxuICAgIH1cblxuICAgIGNvbnN0IEJlYWNvbkNsaWVudCA9IGF3YWl0IGhhbmRsZXIubG9hZEJlYWNvbkNsaWVudCgpXG5cbiAgICByZXR1cm4gbmV3IEJlYWNvbkNsaWVudCh7XG4gICAgICBob3N0OiBjb25maWcuaG9zdCxcbiAgICAgIHBvcnQ6IGNvbmZpZy5wb3J0LFxuICAgICAgcGVlclR5cGVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBCZWFjb24gY29ubmVjdC9kaXNjb25uZWN0IGZhaWx1cmUgd2l0aG91dCByZXBvcnRpbmcgaXQgaW1tZWRpYXRlbHkuXG4gICAqIFRoZSBCZWFjb25DbGllbnQgYXV0by1yZWNvbm5lY3RzLCBzbyBicmllZiBvdXRhZ2VzIChlLmcuIGEgZGVwbG95IHJlc3RhcnRpbmdcbiAgICogdGhlIGJyb2tlcikgYXJlIGV4cGVjdGVkOyBvbmx5IGlmIHRoZSBiZWFjb24gaXMgc3RpbGwgdW5yZWFjaGFibGUgYWZ0ZXJcbiAgICogYHJlcG9ydEFmdGVyTXNgIGlzIGEgc2luZ2xlIGZyYW1ld29yay1lcnJvciBzdXJmYWNlZCB2aWEgYF9yZXBvcnRCZWFjb25FcnJvcmAuXG4gICAqIEEgc3Vic2VxdWVudCBgY29ubmVjdGAgKHNlZSBgX2hhbmRsZUJlYWNvblVwYCkgY2FuY2VscyB0aGUgcGVuZGluZyByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCJ9IGFyZ3Muc3RhZ2UgLSBGYWlsdXJlIHN0YWdlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnJlcG9ydEFmdGVyTXMgLSBHcmFjZSB3aW5kb3cgYmVmb3JlIGEgc3VzdGFpbmVkIG91dGFnZSBpcyByZXBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQmVhY29uRG93bih7c3RhZ2UsIGVycm9yLCByZXBvcnRBZnRlck1zfSkge1xuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB7c3RhZ2UsIGVycm9yfVxuXG4gICAgLy8gQSByZXBvcnQgaXMgYWxyZWFkeSBwZW5kaW5nIG9yIGFscmVhZHkgc2VudCBmb3IgdGhpcyBvdXRhZ2Ug4oCUIGtlZXAgdGhlXG4gICAgLy8gbGF0ZXN0IGVycm9yIGJ1dCBkb24ndCBzdGFjayB0aW1lcnMgb3IgcmUtcmVwb3J0LlxuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lciB8fCB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcblxuICAgICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudD8uaXNDb25uZWN0ZWQoKSkge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25VcCgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IHRydWVcblxuICAgICAgaWYgKHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IpIHRoaXMuX3JlcG9ydEJlYWNvbkVycm9yKHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IpXG4gICAgfSwgcmVwb3J0QWZ0ZXJNcylcblxuICAgIC8vIERvbid0IGxldCB0aGUgZ3JhY2UgdGltZXIga2VlcCB0aGUgcHJvY2VzcyBhbGl2ZS5cbiAgICBpZiAodHlwZW9mIHRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRpbWVyLnVucmVmKClcblxuICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdGltZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgYmVhY29uLWRvd24gc3RhdGUgb24gYSAocmUpY29ubmVjdC4gQSBibGlwIHRoYXQgcmVjb3ZlcnMgd2l0aGluIHRoZVxuICAgKiBncmFjZSB3aW5kb3cgaXMgbmV2ZXIgcmVwb3J0ZWQ7IGlmIGEgc3VzdGFpbmVkIG91dGFnZSBoYWQgYWxyZWFkeSBiZWVuXG4gICAqIHJlcG9ydGVkLCB0aGUgc3RhdGUgcmVzZXRzIHNvIGEgZnV0dXJlIG91dGFnZSBjYW4gcmVwb3J0IGFnYWluLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVCZWFjb25VcCgpIHtcbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcilcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhIEJlYWNvbiBmYWlsdXJlIG9uIHRoZSBmcmFtZXdvcmsgZXJyb3IgY2hhbm5lbC4gTWlycm9yc1xuICAgKiB0aGUgcGF0dGVybiB1c2VkIGJ5IGByZXF1ZXN0LXJ1bm5lci5qc2AgZm9yIEhUVFAgZXJyb3JzLiBXaGVuIG5vXG4gICAqIGxpc3RlbmVyIGlzIGF0dGFjaGVkIHRvIGVpdGhlciBgZnJhbWV3b3JrLWVycm9yYCBvciBgYWxsLWVycm9yYCxcbiAgICogYWxzbyBzY2hlZHVsZXMgYW4gdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uIHNvIHByb2Nlc3MtbGV2ZWwgYnVnXG4gICAqIHJlcG9ydGVycyAod2hpY2ggc3Vic2NyaWJlIHRvIGB1bmhhbmRsZWRSZWplY3Rpb25gIGJ5IGRlZmF1bHQpIHBpY2tcbiAgICogdGhlIGZhaWx1cmUgdXAg4oCUIGFuZCBBTFNPIHdyaXRlcyBhIG9uZS1saW5lIHN1bW1hcnkgdG8gYHN0ZGVycmAgc29cbiAgICogdGhlIGZhaWx1cmUgaXNuJ3QgY29tcGxldGVseSBzaWxlbnQgb24gTm9kZSAyNCsgd2hlcmUgdGhlIGRlZmF1bHRcbiAgICogYmVoYXZpb3Igb2YgYHVuaGFuZGxlZFJlamVjdGlvbmAgaXMgdG8gdGVybWluYXRlIHRoZSBwcm9jZXNzLiBBblxuICAgKiBhcHAgdGhhdCBzZWVzIGl0cyBzZXJ2ZXIgc3VkZGVubHkgZXhpdCBuZWVkcyBhdCBsZWFzdCBvbmVcbiAgICogYnJlYWRjcnVtYiBpbiB0aGUgbG9ncyB0byBrbm93IEJlYWNvbiB3YXMgdGhlIGNhdXNlOyB0aGUgcHJldmlvdXNcbiAgICogYmVoYXZpb3IgbGVmdCBhIHN0YWNrLW9ubHkgY3Jhc2ggd2l0aCBubyBjb250ZXh0IHR5aW5nIGl0IGJhY2sgdG9cbiAgICogdGhlIGJyb2tlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1wiYmVhY29uLWNvbm5lY3RcIiB8IFwiYmVhY29uLWRpc2Nvbm5lY3RcIn0gYXJncy5zdGFnZSAtIEZhaWx1cmUgc3RhZ2UuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0QmVhY29uRXJyb3Ioe3N0YWdlLCBlcnJvcn0pIHtcbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuX2Vycm9yRXZlbnRzXG4gICAgY29uc3QgaGFzTGlzdGVuZXIgPSBlcnJvckV2ZW50cy5saXN0ZW5lckNvdW50KFwiZnJhbWV3b3JrLWVycm9yXCIpID4gMFxuICAgICAgfHwgZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImFsbC1lcnJvclwiKSA+IDBcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge3N0YWdlfSxcbiAgICAgIGVycm9yXG4gICAgfVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG5cbiAgICBpZiAoIWhhc0xpc3RlbmVyKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG5cblxuICAgICAgY29uc29sZS5lcnJvcihgW3ZlbG9jaW91cyBmcmFtZXdvcmstZXJyb3Igc3RhZ2U9JHtzdGFnZX1dICR7bWVzc2FnZX0g4oCUIHJlZ2lzdGVyIGEgbGlzdGVuZXIgdmlhIGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5vbihcImZyYW1ld29yay1lcnJvclwiLCDigKYpIHRvIHN1cHByZXNzIHRoaXMgc3RkZXJyIGZhbGxiYWNrYClcbiAgICAgIHZvaWQgUHJvbWlzZS5yZWplY3QoZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyB0aGUgYWN0aXZlIEJlYWNvbiBjbGllbnQgKGlmIGFueSkuIFNhZmUgdG8gY2FsbCBtdWx0aXBsZVxuICAgKiB0aW1lcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBkaXNjb25uZWN0QmVhY29uKCkge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuX2JlYWNvbkNsaWVudFxuXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UgPSB1bmRlZmluZWRcblxuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKVxuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IGZhbHNlXG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKGNsaWVudCkgYXdhaXQgY2xpZW50LmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSb3V0ZXMgYSBCZWFjb24tc291cmNlZCBicm9hZGNhc3QgdGhyb3VnaCB0aGUgc2FtZSBkZWxpdmVyeSBjb2RlXG4gICAqIHBhdGggYXMgYSBsb2NhbGx5LW9yaWdpbmF0ZWQgb25lLiBQcmVmZXJzIHRoZSB3b3JrZXJ0aHJlYWQtYXdhcmVcbiAgICogYGJyb2FkY2FzdFYyYCB3aGVuIGFuIEhUVFAgc2VydmVyIGlzIGhvc3Rpbmcgd29ya2VycywgYW5kIGZhbGxzXG4gICAqIGJhY2sgdG8gdGhlIHBlci1wcm9jZXNzIHN1YnNjcmlwdGlvbiBkaXNwYXRjaCBvdGhlcndpc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iZWFjb24vdHlwZXMuanNcIikuQmVhY29uQnJvYWRjYXN0TWVzc2FnZX0gbWVzc2FnZSAtIEJyb2FkY2FzdCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbihtZXNzYWdlKSB7XG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyKHtcbiAgICAgICAgY2hhbm5lbDogbWVzc2FnZS5jaGFubmVsLFxuICAgICAgICBicm9hZGNhc3RQYXJhbXM6IG1lc3NhZ2UuYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICBib2R5OiBtZXNzYWdlLmJvZHksXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXNcbiAgICAgIH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChtZXNzYWdlLmNoYW5uZWwsIG1lc3NhZ2UuYnJvYWRjYXN0UGFyYW1zLCBtZXNzYWdlLmJvZHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWQ+fSAtIFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGFzeW5jIGdldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKCkge1xuICAgIGlmICghdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0xvYWRlclR5cGUgfCB1bmRlZmluZWR9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzIC0gU2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKHNjaGVkdWxlZEJhY2tncm91bmRKb2JzKSB7XG4gICAgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgPSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1haWxlciBiYWNrZW5kLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk1haWxlckJhY2tlbmQgfCB1bmRlZmluZWR9IC0gTWFpbGVyIGJhY2tlbmQuXG4gICAqL1xuICBnZXRNYWlsZXJCYWNrZW5kKCkge1xuICAgIHJldHVybiB0aGlzLl9tYWlsZXJCYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbWFpbGVyIGJhY2tlbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk1haWxlckJhY2tlbmQgfCB1bmRlZmluZWR9IG1haWxlckJhY2tlbmQgLSBNYWlsZXIgYmFja2VuZCwgb3IgdW5kZWZpbmVkIHRvIHJlbW92ZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TWFpbGVyQmFja2VuZChtYWlsZXJCYWNrZW5kKSB7XG4gICAgdGhpcy5fbWFpbGVyQmFja2VuZCA9IG1haWxlckJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dnaW5nIGNvbmZpZ3VyYXRpb24gdGFpbG9yZWQgZm9yIEhUVFAgcmVxdWVzdCBsb2dnaW5nLiBEZWZhdWx0cyBjb25zb2xlIGxvZ2dpbmcgdG8gdHJ1ZSBhbmQgYXBwbGllcyB0aGUgdXNlciBgbG9nZ2luZy5jb25zb2xlYCBmbGFnIG9ubHkgZm9yIHJlcXVlc3QgbG9nZ2luZy5cbiAgICogQHJldHVybnMge1JlcXVpcmVkPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImNvbnNvbGVcIiB8IFwiZmlsZVwiIHwgXCJsZXZlbHNcIj4+ICYgUGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiZGlyZWN0b3J5XCIgfCBcImZpbGVQYXRoXCI+ICYgUGFydGlhbDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJvdXRwdXRzXCIgfCBcImxvZ2dlcnNcIj4+fSAtIFRoZSBodHRwIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBMb2dnaW5nQ29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRMb2dnaW5nQ29uZmlndXJhdGlvbih7ZGVmYXVsdENvbnNvbGU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Vudmlyb25tZW50LWhhbmRsZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZW52aXJvbm1lbnQgaGFuZGxlci5cbiAgICovXG4gIGdldEVudmlyb25tZW50SGFuZGxlcigpIHtcbiAgICBpZiAoIXRoaXMuX2Vudmlyb25tZW50SGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gZW52aXJvbm1lbnQgaGFuZGxlciBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvY2FsZUZhbGxiYWNrc1R5cGUgfCB1bmRlZmluZWR9IC0gVGhlIGxvY2FsZSBmYWxsYmFja3MuXG4gICAqL1xuICBnZXRMb2NhbGVGYWxsYmFja3MoKSB7IHJldHVybiB0aGlzLmxvY2FsZUZhbGxiYWNrcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvY2FsZSBmYWxsYmFja3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvY2FsZUZhbGxiYWNrc1R5cGV9IG5ld0xvY2FsZUZhbGxiYWNrcyAtIE5ldyBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRMb2NhbGVGYWxsYmFja3MobmV3TG9jYWxlRmFsbGJhY2tzKSB7IHRoaXMubG9jYWxlRmFsbGJhY2tzID0gbmV3TG9jYWxlRmFsbGJhY2tzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3RydWN0dXJlIHNxbCBjb25maWcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU3RydWN0dXJlU3FsQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBTdHJ1Y3R1cmUgU1FMIGNvbmZpZy5cbiAgICovXG4gIGdldFN0cnVjdHVyZVNxbENvbmZpZygpIHsgcmV0dXJuIHRoaXMuX3N0cnVjdHVyZVNxbCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIHdyaXRlIHN0cnVjdHVyZSBzcWwuXG4gICAqIEBwYXJhbSB7e3JlYXNvbj86IFwibWlncmF0aW9uXCIgfCBcInNjaGVtYUR1bXBcIn19IFthcmdzXSAtIENhbGwgY29udGV4dCBmb3IgdGhlIHN0cnVjdHVyZSBzcWwgd3JpdGUgZGVjaXNpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3RydWN0dXJlIFNRTCBmaWxlcyBzaG91bGQgYmUgZ2VuZXJhdGVkIGZvciB0aGUgY3VycmVudCBlbnZpcm9ubWVudC5cbiAgICovXG4gIHNob3VsZFdyaXRlU3RydWN0dXJlU3FsKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtyZWFzb24gPSBcIm1pZ3JhdGlvblwifSA9IGFyZ3NcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldFN0cnVjdHVyZVNxbENvbmZpZygpXG4gICAgY29uc3QgZW5hYmxlZEVudmlyb25tZW50cyA9IGNvbmZpZz8uZW5hYmxlZEVudmlyb25tZW50c1xuICAgIGNvbnN0IGRpc2FibGVkRW52aXJvbm1lbnRzID0gY29uZmlnPy5kaXNhYmxlZEVudmlyb25tZW50c1xuXG4gICAgaWYgKHJlYXNvbiA9PT0gXCJzY2hlbWFEdW1wXCIpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZW5hYmxlZEVudmlyb25tZW50cykpIHtcbiAgICAgIHJldHVybiBlbmFibGVkRW52aXJvbm1lbnRzLmluY2x1ZGVzKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShkaXNhYmxlZEVudmlyb25tZW50cykgJiYgZGlzYWJsZWRFbnZpcm9ubWVudHMuaW5jbHVkZXModGhpcy5nZXRFbnZpcm9ubWVudCgpKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCIpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc3RydWN0dXJlIHNxbCBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlN0cnVjdHVyZVNxbENvbmZpZ3VyYXRpb259IHN0cnVjdHVyZVNxbCAtIFN0cnVjdHVyZSBTUUwgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRTdHJ1Y3R1cmVTcWxDb25maWcoc3RydWN0dXJlU3FsKSB7XG4gICAgdGhpcy5fc3RydWN0dXJlU3FsID0gc3RydWN0dXJlU3FsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBsb2NhbGUuXG4gICAqL1xuICBnZXRMb2NhbGUoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLmxvY2FsZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvY2FsZSgpXG4gICAgfSBlbHNlIGlmICh0aGlzLmxvY2FsZSkge1xuICAgICAgcmV0dXJuIHRoaXMubG9jYWxlXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLmdldExvY2FsZXMoKVswXVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGVzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gLSBUaGUgbG9jYWxlcy5cbiAgICovXG4gIGdldExvY2FsZXMoKSB7IHJldHVybiBkaWdnKHRoaXMsIFwibG9jYWxlc1wiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBUaGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzKG5hbWUpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5tb2RlbENsYXNzZXNbbmFtZV1cblxuICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIG1vZGVsIGNsYXNzICR7bmFtZX0gaW4gJHtPYmplY3Qua2V5cyh0aGlzLm1vZGVsQ2xhc3Nlcykuam9pbihcIiwgXCIpfX1gKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzc2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBBIGhhc2ggb2YgYWxsIG1vZGVsIGNsYXNzZXMsIGtleWVkIGJ5IG1vZGVsIG5hbWUsIGFzIHRoZXkgd2VyZSBkZWZpbmVkIGluIHRoZSBjb25maWd1cmF0aW9uLiBUaGlzIGlzIGEgZGlyZWN0IHJlZmVyZW5jZSB0byB0aGUgbW9kZWwgY2xhc3Nlcywgbm90IGEgY29weS5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3NlcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0aW5nLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBUaGUgcGF0aCB0byBhIGNvbmZpZyBmaWxlIHRoYXQgc2hvdWxkIGJlIHVzZWQgZm9yIHRlc3RpbmcuXG4gICAqL1xuICBnZXRUZXN0aW5nKCkgeyByZXR1cm4gdGhpcy5fdGVzdGluZyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRydXN0ZWQgcHJveGllcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSBUcnVzdGVkIHJldmVyc2UgcHJveHkgYWRkcmVzcyByYW5nZXMuXG4gICAqL1xuICBnZXRUcnVzdGVkUHJveGllcygpIHsgcmV0dXJuIHRoaXMuX3RydXN0ZWRQcm94aWVzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJ1c3RlZCBwcm94aWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSB0cnVzdGVkUHJveGllcyAtIFRydXN0ZWQgcmV2ZXJzZSBwcm94eSBhZGRyZXNzIHJhbmdlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRUcnVzdGVkUHJveGllcyh0cnVzdGVkUHJveGllcykgeyB0aGlzLl90cnVzdGVkUHJveGllcyA9IHRydXN0ZWRQcm94aWVzIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIGRhdGFiYXNlIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbaWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyIHRvIGluaXRpYWxpemUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGluaXRpYWxpemVEYXRhYmFzZVBvb2woaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyAnZGF0YWJhc2UnIHdhcyBnaXZlblwiKVxuICAgIGlmICh0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0pIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlUG9vbCBoYXMgYWxyZWFkeSBiZWVuIGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBQb29sVHlwZSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sVHlwZShpZGVudGlmaWVyKVxuXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdID0gbmV3IFBvb2xUeXBlKHtjb25maWd1cmF0aW9uOiB0aGlzLCBpZGVudGlmaWVyfSlcbiAgICB0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0uc2V0Q3VycmVudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBwb29sIGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2lkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllciB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBwb29sIGluaXRpYWxpemVkLlxuICAgKi9cbiAgaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHsgcmV0dXJuIEJvb2xlYW4odGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgaW5pdGlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBpc0luaXRpYWxpemVkKCkgeyByZXR1cm4gdGhpcy5faXNJbml0aWFsaXplZCB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZyYW1ld29yay1vd25lZCBwcm9jZXNzIGNvbnRleHQgZm9yIHRoaXMgY29uZmlndXJhdGlvbidzXG4gICAqIGxpZmVjeWNsZS4gSXQgaXMgdW5kZWZpbmVkIHVudGlsIGBpbml0aWFsaXplKClgIHN0YXJ0cywgYW5kIGl0IGNhcnJpZXMgdGhlXG4gICAqIHByb2Nlc3MgYHR5cGVgIChgc2VydmVyYCwgYHdvcmtlci1oYW5kbGVyYCwgYmFja2dyb3VuZC1qb2JzIHR5cGVzLCBvciBhblxuICAgKiBhcHBsaWNhdGlvbi1kZWZpbmVkIHN0cmluZykgc28gaG9va3MgYW5kIGZyYW1ld29yayBzZXJ2aWNlcyBjYW4gdGVsbCB3aGljaFxuICAgKiBwcm9jZXNzIHRoZXkgYXJlIHJ1bm5pbmcgaW4uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCB8IHVuZGVmaW5lZH0gLSBQcm9jZXNzIGNvbnRleHQsIHdoZW4gaW5pdGlhbGl6YXRpb24gaGFzIHN0YXJ0ZWQuXG4gICAqL1xuICBnZXRBcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0KCkgeyByZXR1cm4gdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBtb2RlbHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplTW9kZWxzKGFyZ3MgPSB7dHlwZTogXCJzZXJ2ZXJcIn0pIHtcbiAgICBjb25zdCBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICBpZiAodGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgY29uc3QgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgICBhd2FpdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IG1vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICYmICF0aGlzLl9tb2RlbHNJbml0aWFsaXplZCkge1xuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPT09IGluaXRpYWxpemVNb2RlbHNQcm9taXNlKSB7XG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmluaXRpYWxpemVNb2RlbHMoYXJncylcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc2hvdWxkU2tpcER1bW15TW9kZWxJbml0aWFsaXphdGlvbiA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52LlZFTE9DSU9VU19TS0lQX0RVTU1ZX01PREVMX0lOSVRJQUxJWkFUSU9OID09PSBcIjFcIlxuICAgICAgICAmJiBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfQlJPV1NFUl9URVNUUyA9PT0gXCJ0cnVlXCJcbiAgICAgICAgJiYgdGhpcy5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIlxuXG4gICAgICBpZiAoIXNob3VsZFNraXBEdW1teU1vZGVsSW5pdGlhbGl6YXRpb24pIHtcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHMpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplTW9kZWxzKHtjb25maWd1cmF0aW9uOiB0aGlzLCBwcm9jZXNzQ29udGV4dDogdGhpcy5nZXRBcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0KCksIHR5cGU6IGFyZ3MudHlwZX0pXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmluaXRpYWxpemVQYWNrYWdlTW9kZWxzKHRoaXMpXG4gICAgICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGVkTW9kZWxSZWxhdGlvbnNoaXBzKHRoaXMpXG5cbiAgICAgICAgYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbml0aWFsaXplRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnModGhpcylcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID09PSBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9tb2RlbHNJbml0aWFsaXplZCA9IHRydWVcbiAgICAgIH1cbiAgICB9KSgpXG5cbiAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9IGluaXRpYWxpemVNb2RlbHNQcm9taXNlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID09PSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGVhY2ggY29uZmlndXJlZCBkYXRhYmFzZSBwb29sIGhhcyBhIGdsb2JhbCBjb25uZWN0aW9uIGF2YWlsYWJsZS5cbiAgICogVXNlZnVsIHdoZW4gYGdldEN1cnJlbnRDb25uZWN0aW9uYCBtaWdodCBiZSBjYWxsZWQgd2l0aG91dCBhbiBhc3luYyBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlR2xvYmFsQ29ubmVjdGlvbnMoKSB7XG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgYXdhaXQgcG9vbC5lbnN1cmVHbG9iYWxDb25uZWN0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgaW5pdGlhbGl6ZSh7dHlwZX0gPSB7dHlwZTogXCJ1bmRlZmluZWRcIn0pIHtcbiAgICBpZiAodGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UpIHJldHVybiB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuXG4gICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiB0cnVlLCB0eXBlLCB3YWl0Rm9yOiB0aGlzLl9zaHV0ZG93blByb21pc2V9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IGZhbHNlLCB0eXBlLCB3YWl0Rm9yOiB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYmVnaW5Jbml0aWFsaXplKHt0eXBlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgb3Igam9pbnMgaW5pdGlhbGl6YXRpb24gYWZ0ZXIgbGlmZWN5Y2xlIGJsb2NrZXJzIGhhdmUgc2V0dGxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTdGFydHVwIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBHZW5lcmljIGFwcGxpY2F0aW9uIHByb2Nlc3MgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2hhcmVkIHN0YXJ0dXAgcHJvbWlzZS5cbiAgICovXG4gIF9iZWdpbkluaXRpYWxpemUoe3R5cGV9KSB7XG4gICAgY29uc3QgaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID0gdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSAmJiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgcmV0dXJuIHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IGZhbHNlLCB0eXBlLCB3YWl0Rm9yOiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2lzSW5pdGlhbGl6ZWQpIHtcbiAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgICByZXR1cm4gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcbiAgICB9XG4gICAgLy8gTWVtb2l6ZSB0aGUgaW4tcHJvZ3Jlc3MgaW5pdGlhbGl6YXRpb24gc28gY29uY3VycmVudCBjYWxsZXJzIGF3YWl0IHRoZSBzYW1lXG4gICAgLy8gYm9vdHN0cmFwIGluc3RlYWQgb2YgcmFjaW5nLiBgX2lzSW5pdGlhbGl6ZWRgIHdhcyBwcmV2aW91c2x5IHNldCB0byBgdHJ1ZWBcbiAgICAvLyB1cCBmcm9udCwgc28gYSBzZWNvbmQgY2FsbGVyIChlLmcuIGEgcG9vbGVkIHJ1bm5lciB3aXRoXG4gICAgLy8gYHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID4gMWAgc3RhcnRpbmcgc2V2ZXJhbCBqb2JzIG9uIGEgY29sZCBjaGlsZCkgY291bGRcbiAgICAvLyBza2lwIGluaXRpYWxpemF0aW9uIGFuZCBsb2FkIG1vZGVscyAvIHBlcmZvcm0gYSBqb2Igd2hpbGUgdGhlIGZpcnN0IGNhbGxcbiAgICAvLyB3YXMgc3RpbGwgYXdhaXRpbmcgbW9kZWwgZGlzY292ZXJ5IGFuZCBpbml0aWFsaXplcnMuIE1pcnJvcnMgY29ubmVjdEJlYWNvbi5cbiAgICBjb25zdCBpbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX3J1bkluaXRpYWxpemUoe2luaXRpYWxpemF0aW9uR2VuZXJhdGlvbiwgdHlwZX0pXG5cbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IGluaXRpYWxpemVQcm9taXNlXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICByZXR1cm4gaW5pdGlhbGl6ZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZXMgb25lIHNoYXJlZCBpbml0aWFsaXphdGlvbiBiZWhpbmQgYW4gaW5jb21wYXRpYmxlIGxpZmVjeWNsZSBwaGFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBRdWV1ZSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY29udGludWVBZnRlcldhaXRGYWlsdXJlIC0gV2hldGhlciBhIGNvbXBsZXRlZCBmYWlsZWQgc2h1dGRvd24gc3RpbGwgcGVybWl0cyByZXBsYWNlbWVudCBzdGFydHVwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gUmVwbGFjZW1lbnQgcHJvY2VzcyB0eXBlLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IGFyZ3Mud2FpdEZvciAtIExpZmVjeWNsZSBwaGFzZSB0aGF0IG11c3Qgc2V0dGxlIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTaGFyZWQgcXVldWVkIHN0YXJ0dXAgcHJvbWlzZS5cbiAgICovXG4gIF9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgdHlwZSwgd2FpdEZvcn0pIHtcbiAgICBpZiAodGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UpIHJldHVybiB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuXG4gICAgY29uc3QgcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fd2FpdEZvckluaXRpYWxpemVCbG9ja2VyKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHdhaXRGb3J9KVxuXG4gICAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlID09PSB3YWl0Rm9yKSB0aGlzLl9zaHV0ZG93blByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gd2FpdEZvcikge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2h1dGRvd25Qcm9taXNlID0gdGhpcy5fc2h1dGRvd25Qcm9taXNlXG5cbiAgICAgIGlmIChzaHV0ZG93blByb21pc2UpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fd2FpdEZvckluaXRpYWxpemVCbG9ja2VyKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IHRydWUsIHdhaXRGb3I6IHNodXRkb3duUHJvbWlzZX0pXG4gICAgICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UgPT09IHNodXRkb3duUHJvbWlzZSkgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSAmJiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gIT09IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIGNvbnN0IHN0YWxlSW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuXG4gICAgICAgIGF3YWl0IHN0YWxlSW5pdGlhbGl6ZVByb21pc2VcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSBzdGFsZUluaXRpYWxpemVQcm9taXNlKSB7XG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9iZWdpbkluaXRpYWxpemUoe3R5cGV9KVxuICAgIH0pKCkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IHF1ZXVlZEluaXRpYWxpemVQcm9taXNlXG5cbiAgICByZXR1cm4gcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYSBsaWZlY3ljbGUgcGhhc2UgYmVmb3JlIHF1ZXVlZCBpbml0aWFsaXphdGlvbiBwcm9jZWVkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBXYWl0IHBvbGljeS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSAtIFdoZXRoZXIgcmVwbGFjZW1lbnQgc3RhcnR1cCByZW1haW5zIGF2YWlsYWJsZSBhZnRlciBhIGZhaWxlZCBwaGFzZS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBhcmdzLndhaXRGb3IgLSBMaWZlY3ljbGUgcGhhc2UgdGhhdCBtdXN0IHNldHRsZSBmaXJzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBxdWV1ZWQgaW5pdGlhbGl6YXRpb24gbWF5IGNvbnRpbnVlLlxuICAgKi9cbiAgYXN5bmMgX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB3YWl0Rm9yfSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3YWl0Rm9yXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghY29udGludWVBZnRlcldhaXRGYWlsdXJlKSB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBhdG9taWMgZnJhbWV3b3JrIGFuZCBhcHBsaWNhdGlvbiBpbml0aWFsaXphdGlvbiBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEluaXRpYWxpemF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5pbml0aWFsaXphdGlvbkdlbmVyYXRpb24gLSBGcmFtZXdvcmsgbW9kZWwgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIEdlbmVyaWMgYXBwbGljYXRpb24gcHJvY2VzcyB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGluaXRpYWxpemVkLlxuICAgKi9cbiAgYXN5bmMgX3J1bkluaXRpYWxpemUoe2luaXRpYWxpemF0aW9uR2VuZXJhdGlvbiwgdHlwZX0pIHtcbiAgICBjb25zdCBzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSA9ICF0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkXG5cbiAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHtcbiAgICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSBPYmplY3QuZnJlZXplKHtcbiAgICAgICAgaW5zdGFuY2VJZDogbmV3IFVVSUQoNCkuZm9ybWF0KCksXG4gICAgICAgIHR5cGVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZU1vZGVscyh7dHlwZX0pXG5cbiAgICAgIC8vIE1vZGVsIGluaXRpYWxpemF0aW9uIGNhbiBiZSBpbnZhbGlkYXRlZCBieSBhIGNvbmN1cnJlbnQgY29ubmVjdGlvbiBjbG9zZS5cbiAgICAgIC8vIElmIG1vZGVscyBhcmUgbm90IHJlYWR5LCBzdG9wIHdpdGhvdXQgbWFya2luZyB0aGUgY29uZmlndXJhdGlvbiBpbml0aWFsaXplZFxuICAgICAgLy8gc28gdGhlIG5leHQgY2FsbGVyIHJldHJpZXMgYSBmdWxsIGJvb3RzdHJhcC5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAhPT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uIHx8ICF0aGlzLl9tb2RlbHNJbml0aWFsaXplZCkge1xuICAgICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5hdXRvRGlzY292ZXJSZXNvdXJjZXModGhpcylcbiAgICAgIHRoaXMuX21lcmdlRGlzY292ZXJlZEFiaWxpdHlSZXNvdXJjZXMoKVxuICAgICAgdGhpcy5fdmFsaWRhdGVSZXNvdXJjZVJlbGF0aW9uc2hpcHNPbk1vZGVscygpXG5cbiAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSAmJiB0aGlzLl9pbml0aWFsaXplcnMpIHtcbiAgICAgICAgY29uc3QgaW5pdGlhbGl6ZXJzID0gYXdhaXQgdGhpcy5faW5pdGlhbGl6ZXJzKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgICAgY29uc3Qge3JlcXVpcmVDb250ZXh0LCAuLi5yZXN0QXJnc30gPSBpbml0aWFsaXplcnNcblxuICAgICAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgICAgIGlmIChyZXF1aXJlQ29udGV4dCkge1xuICAgICAgICAgIGZvciAoY29uc3QgaW5pdGlhbGl6ZXJLZXkgb2YgcmVxdWlyZUNvbnRleHQua2V5cygpKSB7XG4gICAgICAgICAgICBjb25zdCBJbml0aWFsaXplckNsYXNzID0gcmVxdWlyZUNvbnRleHQoaW5pdGlhbGl6ZXJLZXkpLmRlZmF1bHRcbiAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NDb250ZXh0ID0gdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dFxuXG4gICAgICAgICAgICBpZiAoIXByb2Nlc3NDb250ZXh0KSB0aHJvdyBuZXcgRXJyb3IoXCJBcHBsaWNhdGlvbiBwcm9jZXNzIGNvbnRleHQgaXMgbm90IGF2YWlsYWJsZSBkdXJpbmcgaW5pdGlhbGl6ZXIgc3RhcnR1cFwiKVxuXG4gICAgICAgICAgICBjb25zdCBpbml0aWFsaXplckluc3RhbmNlID0gbmV3IEluaXRpYWxpemVyQ2xhc3Moe2NvbmZpZ3VyYXRpb246IHRoaXMsIHByb2Nlc3NDb250ZXh0LCB0eXBlfSlcblxuICAgICAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZXJJbnN0YW5jZS5ydW4oKVxuICAgICAgICAgICAgdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5wdXNoKGluaXRpYWxpemVySW5zdGFuY2UpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkgdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZCA9IHRydWVcblxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5faXNJbml0aWFsaXplZCA9IHRydWVcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB7XG4gICAgICAgIGxldCB0ZWFyZG93bkVycm9yXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl90ZWFyZG93blN1Y2Nlc3NmdWxJbml0aWFsaXplcnMoKVxuICAgICAgICB9IGNhdGNoIChjYXVnaHRUZWFyZG93bkVycm9yKSB7XG4gICAgICAgICAgdGVhcmRvd25FcnJvciA9IGNhdWdodFRlYXJkb3duRXJyb3JcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0ZWFyZG93bkVycm9yIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbZXJyb3IsIC4uLnRlYXJkb3duRXJyb3IuZXJyb3JzXSxcbiAgICAgICAgICAgIFwiQXBwbGljYXRpb24gcHJvY2VzcyBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgICApXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGVhcmRvd25FcnJvciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW2Vycm9yLCB0ZWFyZG93bkVycm9yXSxcbiAgICAgICAgICAgIFwiQXBwbGljYXRpb24gcHJvY2VzcyBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc0luaXRpYWxpemVkICYmIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWFycyBkb3duIGV2ZXJ5IHN1Y2Nlc3NmdWxseSBzdGFydGVkIGluaXRpYWxpemVyIGluIHJldmVyc2Ugb3JkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgdGVhcmRvd24gc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKCkge1xuICAgIGNvbnN0IHN1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzLnNwbGljZSgwKS5yZXZlcnNlKClcblxuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJBcHBsaWNhdGlvbiBpbml0aWFsaXplciB0ZWFyZG93biBmYWlsZWRcIixcbiAgICAgIHN0ZXBzOiBzdWNjZXNzZnVsSW5pdGlhbGl6ZXJzLm1hcCgoaW5pdGlhbGl6ZXIpID0+IGFzeW5jICgpID0+IGF3YWl0IGluaXRpYWxpemVyLnRlYXJkb3duKCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKiBDbGVhcnMgYXBwbGljYXRpb24tb3duZWQgbGlmZWN5Y2xlIHN0YXRlIGFmdGVyIGV2ZXJ5IHRlYXJkb3duIGF0dGVtcHQuICovXG4gIF9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKCkge1xuICAgIHRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWFycyBkb3duIHRoZSBjdXJyZW50IGFwcGxpY2F0aW9uIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBFeGFjdCBzaGFyZWQgc2h1dGRvd24gcHJvbWlzZS5cbiAgICovXG4gIHNodXRkb3duKCkge1xuICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UpIHJldHVybiB0aGlzLl9zaHV0ZG93blByb21pc2VcblxuICAgIGNvbnN0IGluaXRpYWxpemVQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcbiAgICBjb25zdCBzaHV0ZG93blByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKGluaXRpYWxpemVQcm9taXNlKSBhd2FpdCBpbml0aWFsaXplUHJvbWlzZVxuICAgICAgICBhd2FpdCB0aGlzLl90ZWFyZG93blN1Y2Nlc3NmdWxJbml0aWFsaXplcnMoKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IGluaXRpYWxpemVQcm9taXNlKSB7XG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pKClcblxuICAgIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHNodXRkb3duUHJvbWlzZVxuXG4gICAgcmV0dXJuIHNodXRkb3duUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGF0IHJlc291cmNlLWRlZmluZWQgcmVsYXRpb25zaGlwcyBhcmUgYWxzbyBkZWZpbmVkIG9uIHRoZSBjb3JyZXNwb25kaW5nIG1vZGVsIGNsYXNzZXMuXG4gICAqIFRocm93cyBhbiBlcnJvciBpZiBhIHJlbGF0aW9uc2hpcCBpcyBkZWZpbmVkIG9uIGEgcmVzb3VyY2UgYnV0IG1pc3NpbmcgZnJvbSB0aGUgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlUmVzb3VyY2VSZWxhdGlvbnNoaXBzT25Nb2RlbHMoKSB7XG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLl9iYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgICAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb25dIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlcykpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDb25maWc/LnJlbGF0aW9uc2hpcHMpIGNvbnRpbnVlXG5cbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSBmb3IgJHttb2RlbE5hbWV9IGRlZmluZXMgcmVsYXRpb25zaGlwcyBhcyBhbiBvYmplY3QuIFVzZSBhbiBhcnJheSBpbnN0ZWFkOiBzdGF0aWMgcmVsYXRpb25zaGlwcyA9ICR7SlNPTi5zdHJpbmdpZnkoT2JqZWN0LmtleXMocmVzb3VyY2VDb25maWcucmVsYXRpb25zaGlwcykpfWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKCFyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSBmb3IgJHttb2RlbE5hbWV9IG11c3QgYmUgYSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICAgICAgY29uc3QgZXhpc3RpbmdSZWxhdGlvbnNoaXBzID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClcblxuICAgICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgcmVzb3VyY2VDb25maWcucmVsYXRpb25zaGlwcykge1xuICAgICAgICAgIGlmICghKHJlbGF0aW9uc2hpcE5hbWUgaW4gZXhpc3RpbmdSZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICBgUmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBkZWZpbmVzIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBidXQgJHttb2RlbE5hbWV9IG1vZGVsIGRvZXMgbm90LiBgICtcbiAgICAgICAgICAgICAgYEFkZCAke21vZGVsTmFtZX0uYmVsb25nc1RvKFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiLCAuLi4pIG9yIHRoZSBhcHByb3ByaWF0ZSByZWxhdGlvbnNoaXAgY2FsbCBvbiB0aGUgbW9kZWwgY2xhc3MuYFxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlZ2lzdGVyTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgdGhpcy5tb2RlbENsYXNzZXNbbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKV0gPSBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY3VycmVudC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Q3VycmVudCgpIHtcbiAgICBzZXRDdXJyZW50Q29uZmlndXJhdGlvbih0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJvdXRlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIHJvdXRlcy5cbiAgICovXG4gIGdldFJvdXRlcygpIHsgcmV0dXJuIHRoaXMuX3JvdXRlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHJvdXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0fSBuZXdSb3V0ZXMgLSBOZXcgcm91dGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRSb3V0ZXMobmV3Um91dGVzKSB7XG4gICAgdGhpcy5fcm91dGVzID0gbmV3Um91dGVzXG4gICAgdGhpcy5fYXBwbHlSb3V0ZU1vdW50cyhuZXdSb3V0ZXMpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhbnkgYHJvdXRlLm1vdW50KC4uLilgIHJlZ2lzdHJhdGlvbnMgZnJvbSB0aGUgcm91dGVzIGZpbGUgYnkgbGV0dGluZ1xuICAgKiBlYWNoIG1vdW50YWJsZSByZWdpc3RlciBpdHMgcm91dGVzICh0eXBpY2FsbHkgcm91dGUtcmVzb2x2ZXIgaG9va3MpIGFnYWluc3RcbiAgICogdGhpcyBjb25maWd1cmF0aW9uLiBHdWFyZGVkIHNvIHJlcGVhdGVkIHNldFJvdXRlcyBjYWxscyB3aXRoIHRoZSBzYW1lIHJvdXRlc1xuICAgKiBkb24ndCByZWdpc3RlciBhIG1vdW50IG1vcmUgdGhhbiBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHR9IG5ld1JvdXRlcyAtIFJvdXRlcyBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FwcGx5Um91dGVNb3VudHMobmV3Um91dGVzKSB7XG4gICAgaWYgKCFuZXdSb3V0ZXMgfHwgdHlwZW9mIG5ld1JvdXRlcy5nZXRNb3VudHMgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IG1vdW50IG9mIG5ld1JvdXRlcy5nZXRNb3VudHMoKSkge1xuICAgICAgaWYgKHRoaXMuX2FwcGxpZWRSb3V0ZU1vdW50cy5oYXMobW91bnQpKSBjb250aW51ZVxuXG4gICAgICB0aGlzLl9hcHBsaWVkUm91dGVNb3VudHMuYWRkKG1vdW50KVxuICAgICAgbW91bnQubW91bnRhYmxlLm1vdW50SW50byh7Y29uZmlndXJhdGlvbjogdGhpcywgLi4ubW91bnQub3B0aW9uc30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgcGx1Z2luL2xpYnJhcnkgcm91dGVzIHVzaW5nIGEgbGlnaHR3ZWlnaHQgcm91dGUgRFNMIGJhY2tlZCBieSByb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICogQHBhcmFtIHsocm91dGVzOiBpbXBvcnQoXCIuL3JvdXRlcy9wbHVnaW4tcm91dGVzLmpzXCIpLmRlZmF1bHQpID0+IHZvaWR9IGNhbGxiYWNrIC0gUm91dGVzIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByb3V0ZXMoY2FsbGJhY2spIHtcbiAgICBjb25zdCBwbHVnaW5Sb3V0ZXMgPSBuZXcgUGx1Z2luUm91dGVzKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcblxuICAgIGNhbGxiYWNrKHBsdWdpblJvdXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0cmFuc2xhdG9yLlxuICAgKiBAcGFyYW0geyhhcmcxOiBzdHJpbmcsIGFyZzI6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZCkgPT4gc3RyaW5nfSBjYWxsYmFjayAtIFRyYW5zbGF0b3IgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRyYW5zbGF0b3IoY2FsbGJhY2spIHsgdGhpcy5fdHJhbnNsYXRvciA9IGNhbGxiYWNrIH1cblxuICAvKipcbiAgICogUnVucyBkZWZhdWx0IHRyYW5zbGF0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtc2dJRCAtIE1zZyBpZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzXSAtIFRyYW5zbGF0b3Igb3B0aW9ucyBhbmQgdmFyaWFibGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBkZWZhdWx0IHRyYW5zbGF0b3IuXG4gICAqL1xuICBfZGVmYXVsdFRyYW5zbGF0b3IobXNnSUQsIGFyZ3MpIHtcbiAgICB0aGlzLl9jb25maWd1cmVEZWZhdWx0VHJhbnNsYXRvcigpXG5cbiAgICBjb25zdCB0cmFuc2xhdGVBcmdzID0gYXJncyA/IHsuLi5hcmdzfSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHRyYW5zbGF0ZUFyZ3M/LmRlZmF1bHRWYWx1ZVxuICAgIGNvbnN0IGxvY2FsZXMgPSB0cmFuc2xhdGVBcmdzPy5sb2NhbGVzXG5cbiAgICBpZiAodHJhbnNsYXRlQXJncykge1xuICAgICAgZGVsZXRlIHRyYW5zbGF0ZUFyZ3MuZGVmYXVsdFZhbHVlXG4gICAgICBkZWxldGUgdHJhbnNsYXRlQXJncy5sb2NhbGVzXG4gICAgfVxuXG4gICAgY29uc3QgdmFyaWFibGVzID0gdHJhbnNsYXRlQXJncyAmJiBPYmplY3Qua2V5cyh0cmFuc2xhdGVBcmdzKS5sZW5ndGggPiAwID8gdHJhbnNsYXRlQXJncyA6IHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbG9jYWxlID0gdGhpcy5nZXRMb2NhbGUoKVxuICAgIGNvbnN0IHByZWZlcnJlZExvY2FsZXMgPSBsb2NhbGVzIHx8IChsb2NhbGUgPyB1bmRlZmluZWQgOiBbXSlcbiAgICBjb25zdCBtZXNzYWdlID0gdHJhbnNsYXRlKG1zZ0lELCB2YXJpYWJsZXMsIHByZWZlcnJlZExvY2FsZXMpXG5cbiAgICBpZiAobWVzc2FnZSA9PT0gbXNnSUQgJiYgZGVmYXVsdFZhbHVlKSByZXR1cm4gdHJhbnNsYXRlKGRlZmF1bHRWYWx1ZSwgdmFyaWFibGVzLCBbXSlcblxuICAgIHJldHVybiBtZXNzYWdlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRvci5cbiAgICogQHJldHVybnMgeyhtc2dJRDogc3RyaW5nLCBhcmdzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBzdHJpbmd9IC0gVGhlIGNvbmZpZ3VyZWQgdHJhbnNsYXRvci5cbiAgICovXG4gIGdldFRyYW5zbGF0b3IoKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0b3IpIHJldHVybiB0aGlzLl90cmFuc2xhdG9yXG5cbiAgICBpZiAoIXRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yQm91bmQpIHtcbiAgICAgIHRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yQm91bmQgPSB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvci5iaW5kKHRoaXMpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yQm91bmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmZpZ3VyZSBkZWZhdWx0IHRyYW5zbGF0b3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIENvbmZpZ3VyZSBnZXR0ZXh0IGRlZmF1bHRzIGZvciB0aGlzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfY29uZmlndXJlRGVmYXVsdFRyYW5zbGF0b3IoKSB7XG4gICAgY29uc3QgbG9jYWxlID0gdGhpcy5nZXRMb2NhbGUoKVxuXG4gICAgZ2V0dGV4dENvbmZpZy5zZXRMb2NhbGUobG9jYWxlIHx8IFwiXCIpXG5cbiAgICBjb25zdCBmYWxsYmFja3MgPSBsb2NhbGUgPyB0aGlzLmdldExvY2FsZUZhbGxiYWNrcygpPy5bbG9jYWxlXSA6IFtdXG5cbiAgICBnZXR0ZXh0Q29uZmlnLnNldEZhbGxiYWNrcyhmYWxsYmFja3MgfHwgW10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGltZXpvbmUgb2Zmc2V0IG1pbnV0ZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gVGhlIHRpbWV6b25lIG9mZnNldCBpbiBtaW51dGVzLlxuICAgKi9cbiAgZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWRPZmZzZXQgPSB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMoKVxuXG4gICAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWRPZmZzZXQgPT09IFwibnVtYmVyXCIpIHJldHVybiBjb25maWd1cmVkT2Zmc2V0XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXNcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IERhdGUoKS5nZXRUaW1lem9uZU9mZnNldCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGltZSB6b25lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICovXG4gIGdldFRpbWVab25lKCkge1xuICAgIGNvbnN0IHRpbWVab25lID0gdHlwZW9mIHRoaXMuX3RpbWVab25lID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gdGhpcy5fdGltZVpvbmUoKVxuICAgICAgOiB0aGlzLl90aW1lWm9uZVxuXG4gICAgaWYgKHRpbWVab25lID09PSB1bmRlZmluZWQgfHwgdGltZVpvbmUgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImNvbmZpZ3VyYXRpb24gdGltZVpvbmVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtZXZlbnRzLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBldmVudHMuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRFdmVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBldmVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtZXZlbnRzLmpzXCIpLmRlZmF1bHR9IHdlYnNvY2tldEV2ZW50cyAtIFdlYnNvY2tldCBldmVudHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldEV2ZW50cyh3ZWJzb2NrZXRFdmVudHMpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRFdmVudHMgPSB3ZWJzb2NrZXRFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXItcHJvY2VzcyByZWdpc3RyeSBvZiBjaGFubmVsIHN1YnNjcmliZXJzIHVzZWQgYnkgd29ya2VyIGNvZGUgdGhhdFxuICAgKiBuZWVkcyB0byByZWFjdCB0byBldmVudHMgYnJvYWRjYXN0IHZpYSBgd2Vic29ja2V0RXZlbnRzSG9zdC5wdWJsaXNoKC4uLilgXG4gICAqIHdpdGhvdXQgaG9sZGluZyBhbiBhY3R1YWwgd2Vic29ja2V0IHNlc3Npb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLXN1YnNjcmliZXJzLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNoYW5uZWwgc3Vic2NyaWJlcnMgcmVnaXN0cnkuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMoKSB7XG4gICAgaWYgKCF0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMpIHtcbiAgICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyA9IG5ldyBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY2hhbm5lbCByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSB3ZWJzb2NrZXQgY2hhbm5lbCByZXNvbHZlci5cbiAgICovXG4gIGdldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYFZlbG9jaW91c1dlYnNvY2tldENvbm5lY3Rpb25gIHN1YmNsYXNzIHVuZGVyIGEgbmFtZS5cbiAgICogQ2xpZW50cyB0aGF0IHNlbmQgYHt0eXBlOiBcImNvbm5lY3Rpb24tb3BlblwiLCBjb25uZWN0aW9uVHlwZTogbmFtZX1gXG4gICAqIHdpbGwgaGF2ZSB0aGlzIGNsYXNzIGluc3RhbnRpYXRlZCBmb3IgdGhlaXIgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDbGllbnQtZmFjaW5nIGNvbm5lY3Rpb24gdHlwZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jb25uZWN0aW9uLmpzXCIpLmRlZmF1bHR9IENvbm5lY3Rpb25DbGFzcyAtIFdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyV2Vic29ja2V0Q29ubmVjdGlvbihuYW1lLCBDb25uZWN0aW9uQ2xhc3MpIHtcbiAgICBpZiAoIW5hbWUpIHRocm93IG5ldyBFcnJvcihcIkNvbm5lY3Rpb24gbmFtZSBpcyByZXF1aXJlZFwiKVxuICAgIGlmICghQ29ubmVjdGlvbkNsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25uZWN0aW9uQ2xhc3MgaXMgcmVxdWlyZWRcIilcbiAgICB0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3Nlcy5zZXQobmFtZSwgQ29ubmVjdGlvbkNsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbm5lY3Rpb24gdHlwZSBuYW1lIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFJlZ2lzdGVyZWQgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3MobmFtZSkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3Nlcy5nZXQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbGAgc3ViY2xhc3MgdW5kZXIgYSBuYW1lLlxuICAgKiBDbGllbnRzIHN1YnNjcmliZSB2aWEgYHt0eXBlOiBcImNoYW5uZWwtc3Vic2NyaWJlXCIsIGNoYW5uZWxUeXBlOiBuYW1lLCAuLi59YC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDbGllbnQtZmFjaW5nIGNoYW5uZWwgdHlwZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IENoYW5uZWxDbGFzcyAtIFdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3tsaXZlT25seT86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBSZWdpc3RyYXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlcldlYnNvY2tldENoYW5uZWwobmFtZSwgQ2hhbm5lbENsYXNzLCB7bGl2ZU9ubHkgPSBmYWxzZX0gPSB7fSkge1xuICAgIGlmICghbmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2hhbm5lbCBuYW1lIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCFDaGFubmVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIkNoYW5uZWxDbGFzcyBpcyByZXF1aXJlZFwiKVxuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzLnNldChuYW1lLCBDaGFubmVsQ2xhc3MpXG5cbiAgICBpZiAobGl2ZU9ubHkpIHRoaXMuX2xpdmVPbmx5V2Vic29ja2V0Q2hhbm5lbHMuYWRkKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIG5hbWUgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gUmVnaXN0ZXJlZCB3ZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICovXG4gIGdldFdlYnNvY2tldENoYW5uZWxDbGFzcyhuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzLmdldChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBjaGFubmVsIHR5cGUgd2FzIHJlZ2lzdGVyZWQgd2l0aCBge2xpdmVPbmx5OiB0cnVlfWAuXG4gICAqIExpdmUtb25seSBjaGFubmVscyBhcmUgbmV2ZXIgcGVyc2lzdGVkIGZvciByZXBsYXk6IHRoZSBldmVudC1sb2dcbiAgICogc3RvcmUncyBgbWFya0NoYW5uZWxJbnRlcmVzdGVkYCB0aHJvd3MgZm9yIHRoZWlyIG5hbWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSBuYW1lIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNoYW5uZWwgaXMgZGVjbGFyZWQgbGl2ZS1vbmx5LlxuICAgKi9cbiAgaXNXZWJzb2NrZXRDaGFubmVsTGl2ZU9ubHkobmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzLmhhcyhuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFRyYWNrcyBhIGxpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gaW4gdGhlIGdsb2JhbCByb3V0aW5nIHJlZ2lzdHJ5LlxuICAgKiBDYWxsZWQgYnkgdGhlIHNlc3Npb24gd2hlbiBgY2FuU3Vic2NyaWJlKClgIHJlc29sdmVzIHRydXRoeTsgdGhlXG4gICAqIHNlc3Npb24gY2FsbHMgYF91bnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbmAgb24gdW5zdWJzY3JpYmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHVzZWQgYXMgdGhlIHJvdXRpbmcga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gc3Vic2NyaXB0aW9uIC0gTGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiB0byByZWdpc3Rlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKG5hbWUsIHN1YnNjcmlwdGlvbikge1xuICAgIGxldCBidWNrZXQgPSB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5nZXQobmFtZSlcblxuICAgIGlmICghYnVja2V0KSB7XG4gICAgICBidWNrZXQgPSBuZXcgU2V0KClcbiAgICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLnNldChuYW1lLCBidWNrZXQpXG4gICAgfVxuXG4gICAgYnVja2V0LmFkZChzdWJzY3JpcHRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bnJlZ2lzdGVyIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgdXNlZCBhcyB0aGUgcm91dGluZyBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBzdWJzY3JpcHRpb24gLSBMaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIHRvIHJlbW92ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb24obmFtZSwgc3Vic2NyaXB0aW9uKSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkgcmV0dXJuXG5cbiAgICBidWNrZXQuZGVsZXRlKHN1YnNjcmlwdGlvbilcblxuICAgIGlmIChidWNrZXQuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZGVsZXRlKG5hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGl2ZXJzIGBib2R5YCB0byBldmVyeSBsaXZlIHN1YnNjcmliZXIgb2YgYG5hbWVgIHdob3NlXG4gICAqIGBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcylgIHJldHVybnMgdHJ1ZS4gUHVyZSByb3V0aW5nIOKAlCBubyBhdXRoXG4gICAqIHJlLWNoZWNrLCBubyBwZXJzaXN0ZW5jZS4gU3Vic2NyaWJlcnMgd2hvIHdlcmUgYWRtaXR0ZWQgYnlcbiAgICogYGNhblN1YnNjcmliZSgpYCBjb250aW51ZSB0byByZWNlaXZlIGJyb2FkY2FzdHMgdW50aWwgdGhleVxuICAgKiB1bnN1YnNjcmliZSBvciB0aGUgc2Vzc2lvbiBlbmRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHlcbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IHNlc3Npb24gZ3JhY2Ugc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBHcmFjZSBwZXJpb2QgKHNlY29uZHMpIGJlZm9yZSBhIHBhdXNlZCBXUyBzZXNzaW9uIGlzIHRvcm4gZG93bi5cbiAgICovXG4gIGdldFdlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMoKSB7IHJldHVybiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IHNlc3Npb24gaGVhcnRiZWF0IHNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gSW50ZXJ2YWwgKHNlY29uZHMpIGJldHdlZW4gc2VydmVy4oaSY2xpZW50IGhlYXJ0YmVhdCBwaW5nczsgMCBkaXNhYmxlcyByZWFwaW5nLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMoKSB7IHJldHVybiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGVyLXNlc3Npb24gV2ViU29ja2V0IGluYm91bmQgbWVzc2FnZSBxdWV1ZSBsaW1pdHMuXG4gICAqIEByZXR1cm5zIHt7bWF4Qnl0ZXM6IG51bWJlciwgbWF4TWVzc2FnZXM6IG51bWJlcn19IC0gUGVyLXNlc3Npb24gaW5ib3VuZCBxdWV1ZSBoaWdoLXdhdGVyIG1hcmtzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0SW5ib3VuZFF1ZXVlTGltaXRzKCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5odHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1heEJ5dGVzOiBxdWV1ZS5tYXhQZW5kaW5nQnl0ZXMsXG4gICAgICBtYXhNZXNzYWdlczogcXVldWUubWF4UGVuZGluZ01lc3NhZ2VzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGVyLWNsaWVudCBXZWJTb2NrZXQgb3V0Ym91bmQgcXVldWUgbGltaXRzLlxuICAgKiBAcmV0dXJucyB7e21heEJ5dGVzOiBudW1iZXIsIG1heEZyYW1lczogbnVtYmVyfX0gLSBQZXItY2xpZW50IG91dGJvdW5kIHF1ZXVlIGhpZ2gtd2F0ZXIgbWFya3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRPdXRib3VuZFF1ZXVlTGltaXRzKCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5odHRwU2VydmVyLndlYnNvY2tldE91dGJvdW5kUXVldWVcblxuICAgIHJldHVybiB7XG4gICAgICBtYXhCeXRlczogcXVldWUubWF4UGVuZGluZ0J5dGVzLFxuICAgICAgbWF4RnJhbWVzOiBxdWV1ZS5tYXhQZW5kaW5nRnJhbWVzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIHdyYXBwZXIgaW52b2tlZCBhcm91bmQgZXZlcnkgV1MtYm9ybmUgcmVxdWVzdCAvXG4gICAqIGNvbm5lY3Rpb24gbWVzc2FnZSAvIGNoYW5uZWwgZGlzcGF0Y2guIFRoZSB3cmFwcGVyIHJlY2VpdmVzIHRoZVxuICAgKiBzZXNzaW9uIGFuZCBhIGBuZXh0YCBjYWxsYmFjazsgaXQgbXVzdCBjYWxsIGBuZXh0KClgIHRvIHJ1biB0aGVcbiAgICogaGFuZGxlci4gVXNlIGl0IHRvIHNldCB1cCBBc3luY0xvY2FsU3RvcmFnZSBwZXIgcmVxdWVzdC5cbiAgICogQHBhcmFtIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gd3JhcHBlciAtIFBlci1tZXNzYWdlIHNlc3Npb24tY29udGV4dCB3cmFwcGVyLCBvciBudWxsIHRvIGRpc2FibGUgaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0QXJvdW5kUmVxdWVzdCh3cmFwcGVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0QXJvdW5kUmVxdWVzdCA9IHdyYXBwZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgYXJvdW5kIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gLSBXZWJzb2NrZXQgc2Vzc2lvbiB3cmFwcGVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0QXJvdW5kUmVxdWVzdCgpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0QXJvdW5kUmVxdWVzdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIHdyYXBwZXIgaW52b2tlZCBhcm91bmQgZXZlcnkgY29udHJvbGxlciBhY3Rpb24g4oCUIGJvdGhcbiAgICogSFRUUCBhbmQgV1MtYm9ybmUuIFJlY2VpdmVzIGB7cmVxdWVzdCwgcmVzcG9uc2UsIG5leHR9YCBhbmQgbXVzdFxuICAgKiBjYWxsIGBuZXh0KClgIHRvIHJ1biB0aGUgYWN0aW9uLiBVc2UgaXQgZm9yIHBlci1yZXF1ZXN0IGNvbnRleHRcbiAgICogbGlrZSBBc3luY0xvY2FsU3RvcmFnZS1zY29wZWQgbG9jYWxlIG9yIHRyYWNpbmcuXG4gICAqIEBwYXJhbSB7KChjb250ZXh0OiB7cmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgcmVzcG9uc2U6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD59KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IHdyYXBwZXIgLSBQZXItYWN0aW9uIHJlcXVlc3QtY29udGV4dCB3cmFwcGVyLCBvciBudWxsIHRvIGRpc2FibGUgaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QXJvdW5kQWN0aW9uKHdyYXBwZXIpIHtcbiAgICB0aGlzLl9hcm91bmRBY3Rpb24gPSB3cmFwcGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXJvdW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMgeygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAtIEhUVFAgcmVxdWVzdCB3cmFwcGVyLlxuICAgKi9cbiAgZ2V0QXJvdW5kQWN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9hcm91bmRBY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYW4gaWRlbnRpdHkgcmVzb2x2ZXIgY2FsbGVkIG9uY2UgYXQgcGF1c2UgdGltZSBhbmQgb25jZVxuICAgKiBhdCByZXN1bWUgdGltZS4gVGhlIHJlc29sdmVyIHJlY2VpdmVzIHRoZSBzZXNzaW9uIGFuZCByZXR1cm5zIGFueVxuICAgKiB2YWx1ZSB0aGF0IGlkZW50aWZpZXMgdGhlIGF1dGhlbnRpY2F0ZWQgY2FsbGVyIOKAlCB0eXBpY2FsbHkgYVxuICAgKiBgdXNlcklkYCByZWFkIGZyb20gdGhlIHNlc3Npb24ncyB1cGdyYWRlLXJlcXVlc3QgY29va2llLiBWZWxvY2lvdXNcbiAgICogY2FwdHVyZXMgdGhlIHBhdXNlLXRpbWUgdmFsdWUgb24gdGhlIHBhdXNlZCBzZXNzaW9uIGFuZCBjb21wYXJlc1xuICAgKiBpdCB2aWEgYD09PWAgKG9yIGRlZXAtZXF1YWxpdHkgZm9yIHBsYWluIG9iamVjdHMpIHRvIHRoZSBmcmVzaFxuICAgKiByZXN1bWUtdGltZSB2YWx1ZS4gSWYgdGhleSBkaWZmZXIsIHRoZSByZXN1bWUgaXMgcmVqZWN0ZWQgd2l0aFxuICAgKiBgc2Vzc2lvbi1nb25lYCBhbmQgdGhlIHBhdXNlZCBzZXNzaW9uIGlzIGRlc3Ryb3llZCBzbyBhIHNpZ25lZC1vdXRcbiAgICogb3IgcmUtYXV0aGVudGljYXRlZCBjbGllbnQgY2Fubm90IHJlY2xhaW0gYW5vdGhlciB1c2VyJ3Mgc3RhdGUuXG4gICAqXG4gICAqIFJldHVybiBgbnVsbGAvYHVuZGVmaW5lZGAgdG8gbWVhbiBcIm5vIGlkZW50aXR5XCIg4oCUIHJlc3VtZXMgc3RpbGxcbiAgICogc3VjY2VlZCBpZiBwYXVzZSBhbmQgcmVzdW1lIGJvdGggcmVzb2x2ZSB0byBhIG51bGxpc2ggdmFsdWUuXG4gICAqIEBwYXJhbSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9IHJlc29sdmVyIC0gQXV0aGVudGljYXRlZC1jYWxsZXIgaWRlbnRpdHkgcmVzb2x2ZXIsIG9yIG51bGwgdG8gZGlzYWJsZSBpZGVudGl0eSBjaGVja3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IHNlc3Npb24gaWRlbnRpdHkgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgbnVsbH0gLSBUaGUgY29uZmlndXJlZCBpZGVudGl0eSByZXNvbHZlci5cbiAgICovXG4gIGdldFdlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBzZXNzaW9uIGdyYWNlIHNlY29uZHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzZWNvbmRzIC0gR3JhY2UgcGVyaW9kIGJlZm9yZSBhIHBhdXNlZCBzZXNzaW9uIGV4cGlyZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyhzZWNvbmRzKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2Vjb25kcykgfHwgc2Vjb25kcyA8IDApIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBncmFjZSBzZWNvbmRzOiAke3NlY29uZHN9YClcbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzID0gc2Vjb25kc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBzZXNzaW9uIGhlYXJ0YmVhdCBzZWNvbmRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gc2Vjb25kcyAtIEhlYXJ0YmVhdCBpbnRlcnZhbCwgd2l0aCB6ZXJvIGRpc2FibGluZyByZWFwaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzKHNlY29uZHMpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShzZWNvbmRzKSB8fCBzZWNvbmRzIDwgMCkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGhlYXJ0YmVhdCBzZWNvbmRzOiAke3NlY29uZHN9YClcbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyA9IHNlY29uZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBNb3ZlcyBhIHNlc3Npb24gaW50byB0aGUgcGF1c2VkIHJlZ2lzdHJ5IGFuZCBzdGFydHMgdGhlIGdyYWNlXG4gICAqIHRpbWVyLiBXaGVuIHRoZSB0aW1lciBmaXJlcywgdGhlIHNlc3Npb24ncyBwZXJtYW5lbnQgdGVhcmRvd25cbiAgICogaG9vayBpcyBpbnZva2VkLiBDYWxsZWQgYnkgdGhlIHNlc3Npb24gaXRzZWxmIGZyb20gYF9oYW5kbGVDbG9zZWBcbiAgICogd2hlbiB0aGVyZSBpcyByZXN1bWFibGUgc3RhdGUgKGxpdmUgQ29ubmVjdGlvbnMgLyBDaGFubmVsIHN1YnMpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHR9IHNlc3Npb24gLSBSZXN1bWFibGUgc2Vzc2lvbiB0byByZXRhaW4gZHVyaW5nIGl0cyBncmFjZSBwZXJpb2QuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3BhdXNlV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uKSB7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gc2Vzc2lvbi5zZXNzaW9uSWRcblxuICAgIGlmICghc2Vzc2lvbklkKSB0aHJvdyBuZXcgRXJyb3IoXCJTZXNzaW9uIG11c3QgaGF2ZSBhIHNlc3Npb25JZCB0byBiZSBwYXVzZWRcIilcbiAgICBpZiAodGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuaGFzKHNlc3Npb25JZCkpIHJldHVyblxuXG4gICAgY29uc3QgZ3JhY2VNcyA9IHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgKiAxMDAwXG4gICAgY29uc3QgZ3JhY2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fZXhwaXJlV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpXG4gICAgfSwgZ3JhY2VNcylcblxuICAgIC8vIERvbid0IGtlZXAgdGhlIHByb2Nlc3MgYWxpdmUgcHVyZWx5IGZvciBhIHBhdXNlZCBzZXNzaW9uIHRpbWVyLlxuICAgIGlmICh0eXBlb2YgZ3JhY2VUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSBncmFjZVRpbWVyLnVucmVmKClcblxuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLnNldChzZXNzaW9uSWQsIHtzZXNzaW9uLCBncmFjZVRpbWVyLCBwYXVzZWRBdDogRGF0ZS5ub3coKX0pXG4gIH1cblxuICAvKipcbiAgICogTG9va3MgdXAgYSBwYXVzZWQgc2Vzc2lvbiBieSBpZCAoZG9lcyBOT1QgcmVtb3ZlIGl0IOKAlCBjYWxsZXIgaXNcbiAgICogZXhwZWN0ZWQgdG8gY2FsbCBgX3Jlc3VtZVdlYnNvY2tldFNlc3Npb25gIHRvIGNvbXBsZXRlIHRoZSBoYW5kb2ZmKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIFBhdXNlZCBzZXNzaW9uIHdpdGggdGhlIHJlcXVlc3RlZCBpZGVudGlmaWVyLCBpZiBwcmVzZW50LlxuICAgKi9cbiAgX2ZpbmRQYXVzZWRXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZCkge1xuICAgIHJldHVybiB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKT8uc2Vzc2lvbiB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHBhdXNlZCBzZXNzaW9uIGZyb20gdGhlIHJlZ2lzdHJ5IGFuZCBjYW5jZWxzIGl0cyBncmFjZVxuICAgKiB0aW1lci4gQ2FsbGVkIG9uIHN1Y2Nlc3NmdWwgcmVzdW1lIGhhbmRvZmYgYW5kIG9uIGV4cGxpY2l0XG4gICAqIGV4cGlyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIgdG8gcmVtb3ZlIGFuZCBjYW5jZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2NsZWFyUGF1c2VkV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmdldChzZXNzaW9uSWQpXG5cbiAgICBpZiAoIWVudHJ5KSByZXR1cm5cblxuICAgIGNsZWFyVGltZW91dChlbnRyeS5ncmFjZVRpbWVyKVxuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmRlbGV0ZShzZXNzaW9uSWQpXG4gIH1cblxuICAvKipcbiAgICogR3JhY2UtdGltZXIgY2FsbGJhY2suIENhbGxzIHRoZSBzZXNzaW9uJ3MgcGVybWFuZW50LXRlYXJkb3duXG4gICAqIGhvb2sgYW5kIGRyb3BzIGl0IGZyb20gdGhlIHJlZ2lzdHJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gUGF1c2VkIHNlc3Npb24gaWRlbnRpZmllciB3aG9zZSBncmFjZSBwZXJpb2QgZXhwaXJlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZXhwaXJlV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmdldChzZXNzaW9uSWQpXG5cbiAgICBpZiAoIWVudHJ5KSByZXR1cm5cblxuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmRlbGV0ZShzZXNzaW9uSWQpXG4gICAgdHJ5IHtcbiAgICAgIGVudHJ5LnNlc3Npb24uX2ZpbmFsaXplR3JhY2VFeHBpcnkoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gZmluYWxpemUgZXhwaXJlZCBXUyBzZXNzaW9uICR7c2Vzc2lvbklkfWAsIGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJyb2FkY2FzdCB0byBjaGFubmVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSByZWNlaXZpbmcgdGhlIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtcyAtIFZhbHVlcyB1c2VkIHRvIG1hdGNoIGVsaWdpYmxlIHN1YnNjcmlwdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBCcm9hZGNhc3QgcGF5bG9hZCBkZWxpdmVyZWQgdG8gbWF0Y2hpbmcgc3Vic2NyaXB0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBicm9hZGNhc3RUb0NoYW5uZWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5KSB7XG4gICAgLy8gV2hlbiBCZWFjb24gaXMgY29ubmVjdGVkLCBzaGlwIHRoZSBicm9hZGNhc3Qgb250byB0aGUgYnVzLiBUaGVcbiAgICAvLyBkYWVtb24gZWNob2VzIGl0IGJhY2sgdG8gZXZlcnkgcGVlciAoaW5jbHVkaW5nIHRoaXMgb25lKSBhbmRcbiAgICAvLyBlYWNoIHBlZXIncyBgX2RlbGl2ZXJCcm9hZGNhc3RGcm9tQmVhY29uYCBwZXJmb3JtcyB0aGUgc2FtZVxuICAgIC8vIGxvY2FsIGRlbGl2ZXJ5IGFzIHRoZSBzeW5jaHJvbm91cyBwYXRocyBiZWxvdyDigJQgc28gZXZlcnlcbiAgICAvLyBzdWJzY3JpYmVyLCBpbiBhbnkgcHJvY2Vzcywgc2VlcyBicm9hZGNhc3RzIHZpYSBhIHNpbmdsZSBjb2RlXG4gICAgLy8gcGF0aC5cbiAgICBpZiAodGhpcy5fYmVhY29uQ2xpZW50ICYmIHRoaXMuX2JlYWNvbkNsaWVudC5pc0Nvbm5lY3RlZCgpKSB7XG4gICAgICBjb25zdCBzZW50ID0gdGhpcy5fYmVhY29uQ2xpZW50LnB1Ymxpc2goe2NoYW5uZWw6IG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keX0pXG5cbiAgICAgIGlmIChzZW50KSByZXR1cm5cbiAgICB9XG5cbiAgICAvLyBWMiBzdWJzY3JpcHRpb25zIGxpdmUgcGVyIHdvcmtlci10aHJlYWQuIFdoZW4gcnVubmluZyBpblxuICAgIC8vIHdvcmtlci10aHJlYWQgbW9kZSwgdGhlIHB1Ymxpc2hlciBydW5zIGVpdGhlciBpbiB0aGUgbWFpblxuICAgIC8vIHByb2Nlc3MgKGhvc3QpIG9yIGluIG9uZSBvZiB0aGUgd29ya2VyczpcbiAgICAvL1xuICAgIC8vICAtIE1haW4gcHJvY2VzczogYF93ZWJzb2NrZXRFdmVudHNgIGlzIHRoZSBob3N0IHNpbmdsZXRvbiBhbmRcbiAgICAvLyAgICBgYnJvYWRjYXN0VjJgIGZhbnMgb3V0IHRvIGV2ZXJ5IHdvcmtlciBkaXJlY3RseS5cbiAgICAvLyAgLSBXb3JrZXI6IGBfd2Vic29ja2V0RXZlbnRzYCBoYXMgYHB1Ymxpc2hWMkJyb2FkY2FzdGAgdGhhdFxuICAgIC8vICAgIHBvc3RzIHRvIG1haW4sIHdoaWNoIHRoZW4gZmFucyBvdXQgdG8gZXZlcnkgd29ya2VyLlxuICAgIC8vXG4gICAgLy8gSW4tcHJvY2VzcyBtb2RlIGRvZXNuJ3QgaW5zdGFsbCBhIHdlYnNvY2tldC1ldmVudHMgdHJhbnNwb3J0LFxuICAgIC8vIHNvIGZhbGwgdGhyb3VnaCB0byB0aGUgbG9jYWwgZGlzcGF0Y2guXG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyKHtjaGFubmVsOiBuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHksIGNvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLnB1Ymxpc2hWMkJyb2FkY2FzdCA9PT0gXCJmdW5jdGlvblwiICYmIHdlYnNvY2tldEV2ZW50cy5wYXJlbnRQb3J0KSB7XG4gICAgICB3ZWJzb2NrZXRFdmVudHMucHVibGlzaFYyQnJvYWRjYXN0KHtjaGFubmVsOiBuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHl9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhbGwgcGVuZGluZyBicm9hZGNhc3Qgb3BlcmF0aW9ucyAoaW5jbHVkaW5nIGV2ZW50LWxvZ1xuICAgKiBwZXJzaXN0ZW5jZSkuIENhbGwgdGhpcyBhZnRlciBgYnJvYWRjYXN0VG9DaGFubmVsYCB3aGVuIHlvdSBuZWVkXG4gICAqIHRoZSBldmVudCB0byBiZSBwZXJzaXN0ZWQgYmVmb3JlIGNvbnRpbnVpbmcgKGUuZy4gYmVmb3JlXG4gICAqIHJlc3BvbmRpbmcgdG8gYW4gSFRUUCByZXF1ZXN0KS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzKCkge1xuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgLy8gRHJhaW4gdGhlIGhvc3Qvd29ya2VyIHB1Ymxpc2ggcXVldWVzIChpbmNsdWRpbmcgZXZlbnQtbG9nIHBlcnNpc3RlbmNlKVxuICAgICAgLy8gYmVmb3JlIGRyYWluaW5nIGxvY2FsIGRlbGl2ZXJpZXMsIGJlY2F1c2UgaG9zdCBkaXNwYXRjaCBsYXVuY2hlcyB0aGVcbiAgICAgIC8vIGxvY2FsIGRlbGl2ZXJpZXMgc3luY2hyb25vdXNseSBhbmQgdGhleSBtdXN0IGJlIHBhcnQgb2YgdGhlIHNuYXBzaG90LlxuICAgICAgYXdhaXQgd2Vic29ja2V0RXZlbnRzLmF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMoKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2F3YWl0TG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2NhbCAocGVyLXdvcmtlcikgY2hhbm5lbCBicm9hZGNhc3QgZGlzcGF0Y2guIENhbGxlZCBlaXRoZXJcbiAgICogZGlyZWN0bHkgKGluLXByb2Nlc3MgbW9kZSkgb3IgYnkgdGhlIHdvcmtlciB0aHJlYWQgYWZ0ZXIgdGhlXG4gICAqIG1haW4tcHJvY2VzcyBmYW4tb3V0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtcyAtIFBhcmFtcyBwYXNzZWQgdG8gZWFjaCBzdWJzY3JpcHRpb24ncyBgbWF0Y2hlcygpYC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIE1lc3NhZ2UgYm9keSBkZWxpdmVyZWQgdmlhIGBzZW5kTWVzc2FnZSgpYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEJyb2FkY2FzdE1ldGFkYXRhfSBbbWV0YV0gLSBPcHRpb25hbCBldmVudCBtZXRhZGF0YSBmb3IgcmVwbGF5IHRyYWNraW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHksIG1ldGEpIHtcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5nZXQobmFtZSlcblxuICAgIGlmICghYnVja2V0KSByZXR1cm5cblxuICAgIGZvciAoY29uc3Qgc3Vic2NyaXB0aW9uIG9mIGJ1Y2tldCkge1xuICAgICAgaWYgKHN1YnNjcmlwdGlvbi5pc0Nsb3NlZCgpKSBjb250aW51ZVxuXG4gICAgICBsZXQgbWF0Y2hlc1xuXG4gICAgICB0cnkge1xuICAgICAgICBtYXRjaGVzID0gc3Vic2NyaXB0aW9uLm1hdGNoZXMoYnJvYWRjYXN0UGFyYW1zIHx8IHt9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gQSBicm9rZW4gYG1hdGNoZXMoKWAgb24gb25lIHN1YnNjcmliZXIgbXVzdCBub3QgcG9pc29uIHRoZVxuICAgICAgICAvLyBicm9hZGNhc3QgdG8gb3RoZXIgc3Vic2NyaWJlcnMuIFNraXAgYW5kIGNvbnRpbnVlLlxuICAgICAgICBjb25zb2xlLmVycm9yKGBicm9hZGNhc3RUb0NoYW5uZWw6ICR7bmFtZX0gc3Vic2NyaXB0aW9uICR7c3Vic2NyaXB0aW9uLnN1YnNjcmlwdGlvbklkfSBtYXRjaGVzKCkgdGhyZXdgLCBlcnJvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKCFtYXRjaGVzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBkZWxpdmVyeU1ldGFkYXRhID0ge1xuICAgICAgICBicm9hZGNhc3RQYXJhbXMsXG4gICAgICAgIC4uLihtZXRhPy5ldmVudElkID8ge2V2ZW50SWQ6IG1ldGEuZXZlbnRJZH0gOiB7fSlcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByZXZpb3VzRGVsaXZlcnkgPSB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZ2V0KHN1YnNjcmlwdGlvbilcbiAgICAgIGNvbnN0IGRlbGl2ZXJ5ID0gdGhpcy53aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0cygoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKCgpID0+IHtcbiAgICAgICAgICByZXR1cm4gKHByZXZpb3VzRGVsaXZlcnkgfHwgUHJvbWlzZS5yZXNvbHZlKCkpXG4gICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLl9kZWxpdmVyV2Vic29ja2V0Q2hhbm5lbEJyb2FkY2FzdChzdWJzY3JpcHRpb24sIGJvZHksIGRlbGl2ZXJ5TWV0YWRhdGEpKVxuICAgICAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBicm9hZGNhc3RUb0NoYW5uZWw6ICR7bmFtZX0gc3Vic2NyaXB0aW9uICR7c3Vic2NyaXB0aW9uLnN1YnNjcmlwdGlvbklkfSBkZWxpdmVyQnJvYWRjYXN0IHRocmV3YCwgZXJyb3IpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLnNldChzdWJzY3JpcHRpb24sIGRlbGl2ZXJ5KVxuXG4gICAgICAvLyBLZWVwIHRoZSBmaXJlLWFuZC1mb3JnZXQgZGVsaXZlcnkgKG5ldmVyIGF3YWl0ZWQgYXQgYnJvYWRjYXN0IHRpbWUpIGJ1dFxuICAgICAgLy8gdHJhY2sgaXQgc28gYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGNhbiBkcmFpbiBpdCBiZWZvcmUgc2V0dGxpbmcuIFJlbW92ZVxuICAgICAgLy8gb24gc2V0dGxlOyB0aGUgZmFpbHVyZSBoYW5kbGVyIGFsc28gc2F0aXNmaWVzIHRoZSBwcm9taXNlIHNvIGEgcmVqZWN0ZWRcbiAgICAgIC8vIGRlbGl2ZXJ5IG5ldmVyIGJlY29tZXMgYW4gdW5oYW5kbGVkIHJlamVjdGlvbi5cbiAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcy5hZGQoZGVsaXZlcnkpXG5cbiAgICAgIC8qKlxuICAgICAgICogUmVtb3ZlcyBhIHNldHRsZWQgZGVsaXZlcnkgZnJvbSBsb2NhbCB0cmFja2luZy5cbiAgICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAgICovXG4gICAgICBjb25zdCBmb3JnZXREZWxpdmVyeSA9ICgpID0+IHtcbiAgICAgICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzLmRlbGV0ZShkZWxpdmVyeSlcbiAgICAgICAgaWYgKHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5nZXQoc3Vic2NyaXB0aW9uKSA9PT0gZGVsaXZlcnkpIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5kZWxldGUoc3Vic2NyaXB0aW9uKVxuICAgICAgfVxuXG4gICAgICBkZWxpdmVyeS50aGVuKGZvcmdldERlbGl2ZXJ5LCBmb3JnZXREZWxpdmVyeSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIGEgc25hcHNob3Qgb2YgdGhlIGluLWZsaWdodCBsb2NhbCAocGVyLXByb2Nlc3MpIHdlYnNvY2tldCBjaGFubmVsXG4gICAqIGJyb2FkY2FzdCBkZWxpdmVyaWVzLiBDYWxsZWQgZnJvbSBgYXdhaXRQZW5kaW5nQnJvYWRjYXN0c2AgYWZ0ZXIgdGhlIGhvc3RcbiAgICogcHVibGlzaCBxdWV1ZXMgZHJhaW4sIHNvIGV2ZXJ5IGRlbGl2ZXJ5IHRob3NlIHF1ZXVlcyBsYXVuY2hlZCBpcyBjYXB0dXJlZC5cbiAgICogTmV3IGRlbGl2ZXJpZXMgZW5xdWV1ZWQgYWZ0ZXIgdGhlIHNuYXBzaG90IGFyZSBub3QgYXdhaXRlZC4gSW5kaXZpZHVhbFxuICAgKiBkZWxpdmVyeSBlcnJvcnMgYXJlIGlzb2xhdGVkIHBlciBzdWJzY3JpYmVyIOKAlCB0aGUgZGVsaXZlcnkgY2hhaW4gYWxyZWFkeVxuICAgKiBsb2dzIHRoZW0gYW5kIHJlc29sdmVzIOKAlCBzbyBhIHNuYXBzaG90dGVkIHJlamVjdGlvbiBuZXZlciBmYWlscyB0aGlzIGJhcnJpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2F3YWl0TG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzKCkge1xuICAgIGNvbnN0IHNuYXBzaG90ID0gWy4uLnRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllc11cblxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChzbmFwc2hvdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgd2Vic29ja2V0IGNoYW5uZWwgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gc3Vic2NyaXB0aW9uIC0gQ2hhbm5lbCBzdWJzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRKc29uVmFsdWV9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEJyb2FkY2FzdE1ldGFkYXRhfSBtZXRhIC0gQnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IEJyb2FkY2FzdCBkZWxpdmVyeSByZXN1bHQuXG4gICAqL1xuICBfZGVsaXZlcldlYnNvY2tldENoYW5uZWxCcm9hZGNhc3Qoc3Vic2NyaXB0aW9uLCBib2R5LCBtZXRhKSB7XG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb24uZGVsaXZlckJyb2FkY2FzdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gc3Vic2NyaXB0aW9uLmRlbGl2ZXJCcm9hZGNhc3QoYm9keSwgbWV0YSlcbiAgICB9XG5cbiAgICByZXR1cm4gc3Vic2NyaXB0aW9uLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICovXG4gIGdldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgY2hhbm5lbCByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyVHlwZX0gcmVzb2x2ZXIgLSBSZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0V2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyKHJlc29sdmVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyVHlwZX0gcmVzb2x2ZXIgLSBSZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0V2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIgPSByZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFiaWxpdHkgcmVzb2x2ZXIgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gW2FyZ3MucmVxdWVzdF0gLSBSZXF1ZXN0IG9iamVjdC4gQWJzZW50IGZvciB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb25zIHJlc29sdmVkIGZyb20gc3Vic2NyaWJlIHBhcmFtcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSBbYXJncy5yZXNwb25zZV0gLSBSZXNwb25zZSBvYmplY3QuIEFic2VudCBvdXRzaWRlIEhUVFAgcmVxdWVzdCBoYW5kbGluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZWQgYWJpbGl0eS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVBYmlsaXR5KHtwYXJhbXMsIHJlcXVlc3QsIHJlc3BvbnNlfSkge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5nZXRBYmlsaXR5UmVzb2x2ZXIoKVxuXG4gICAgaWYgKHJlc29sdmVyKSB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHJlc29sdmVyKHtjb25maWd1cmF0aW9uOiB0aGlzLCBwYXJhbXMsIHJlcXVlc3QsIHJlc3BvbnNlfSlcblxuICAgICAgaWYgKHJlc29sdmVkKSByZXR1cm4gcmVzb2x2ZWRcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZXMgPSB0aGlzLmdldEFiaWxpdHlSZXNvdXJjZXMoKVxuXG4gICAgaWYgKHJlc291cmNlcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgcmV0dXJuIG5ldyBBYmlsaXR5KHtcbiAgICAgIGNvbnRleHQ6IHtjb25maWd1cmF0aW9uOiB0aGlzLCBwYXJhbXMsIHJlcXVlc3QsIHJlc3BvbnNlfSxcbiAgICAgIHJlc291cmNlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFiaWxpdHkgLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQWJpbGl0eShhYmlsaXR5LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IHJlcXVlc3RUaW1pbmcgLSBSZXF1ZXN0IHRpbWluZyBjb2xsZWN0b3IuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhSZXF1ZXN0VGltaW5nKHJlcXVlc3RUaW1pbmcsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2ZpbGVzIGFuIGFwcGxpY2F0aW9uLWRlZmluZWQgdGVzdCBhY3Rpdml0eSB3aGVuIGFuIG9wdC1pbiB0ZXN0IHByb2ZpbGVcbiAgICogY29udGV4dCBpcyBhY3RpdmUuIFRoZSBjYWxsYmFjayBhbHdheXMgcnVucywgaW5jbHVkaW5nIG91dHNpZGUgcHJvZmlsaW5nLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvdy1jYXJkaW5hbGl0eSBhY3Rpdml0eSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IChUIHwgUHJvbWlzZTxUPil9IGNhbGxiYWNrIC0gQWN0aXZpdHkgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHByb2ZpbGVUZXN0QWN0aXZpdHkobmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCB2YWxpZGF0ZWROYW1lID0gdmFsaWRhdGVUZXN0QWN0aXZpdHlOYW1lKG5hbWUpXG5cbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KClcblxuICAgIGlmICghY29udGV4dCkgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcblxuICAgIHJldHVybiBhd2FpdCBjb250ZXh0LnByb2ZpbGVyLnByb2ZpbGVBY3Rpdml0eShjb250ZXh0LCB2YWxpZGF0ZWROYW1lLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRpbWV6b25lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGltZVpvbmUgLSBJQU5BIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGltZXpvbmUodGltZVpvbmUsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IGFiaWxpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgYWJpbGl0eSBmcm9tIGNvbnRleHQuXG4gICAqL1xuICBnZXRDdXJyZW50QWJpbGl0eSgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50QWJpbGl0eSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCByZXF1ZXN0IHRpbWluZyBjb2xsZWN0b3IuXG4gICAqL1xuICBnZXRDdXJyZW50UmVxdWVzdFRpbWluZygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCB0ZW5hbnQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IHRlbmFudCBmcm9tIGNvbnRleHQuXG4gICAqL1xuICBnZXRDdXJyZW50VGVuYW50KCkge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEN1cnJlbnRUZW5hbnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGVuYW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0ZW5hbnQgLSBUZW5hbnQuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGVuYW50KHRlbmFudCwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoVGVuYW50KHRlbmFudCwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIHRlbmFudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBUZW5hbnQgcmVzb2x2ZXIgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5yZXF1ZXN0IC0gUmVxdWVzdCBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5yZXNwb25zZSAtIFJlc3BvbnNlIG9iamVjdC5cbiAgICogQHBhcmFtIHt7Y2hhbm5lbDogc3RyaW5nLCBwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBbYXJncy5zdWJzY3JpcHRpb25dIC0gU3Vic2NyaXB0aW9uIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZWQgdGVuYW50LlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZVRlbmFudCh7cGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZSwgc3Vic2NyaXB0aW9ufSkge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5nZXRUZW5hbnRSZXNvbHZlcigpXG5cbiAgICBpZiAoIXJlc29sdmVyKSByZXR1cm5cblxuICAgIHJldHVybiBhd2FpdCByZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgcGFyYW1zLFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgc3Vic2NyaXB0aW9uXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlcnJvciBldmVudHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJldmVudGVtaXR0ZXIzXCIpLkV2ZW50RW1pdHRlcn0gLSBGcmFtZXdvcmsgZXJyb3IgZXZlbnRzIGVtaXR0ZXIuXG4gICAqL1xuICBnZXRFcnJvckV2ZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5fZXJyb3JFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSByZXBvcnRlciB0aGF0IGNhbiBhZGQgY2xpZW50LXNhZmUgbWV0YWRhdGEgdG8gZnJvbnRlbmQtbW9kZWwgZXJyb3IgcGF5bG9hZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyVHlwZX0gcmVwb3J0ZXIgLSBSZXBvcnRlciBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRDbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcihyZXBvcnRlcikge1xuICAgIHRoaXMuX2NsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVycy5wdXNoKHJlcG9ydGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXJlZCBjbGllbnQgZXJyb3IgcGF5bG9hZCByZXBvcnRlcnMuXG4gICAqIEBwYXJhbSB7e2NvbnRleHQ6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRDb250ZXh0LCBlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gUmVwb3J0ZXIgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZD59IC0gTWVyZ2VkIGNsaWVudC1zYWZlIHJlcG9ydGVyIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBjbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihhcmdzKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkfSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSB0aGlzLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZXF1ZXN0VGltaW5nID8gcmVxdWVzdFRpbWluZy5nZXRMb2dTZW5zaXRpdmVWYWx1ZXMoKSA6IG5ldyBTZXQoKVxuICAgIGNvbnN0IGRldGFpbHMgPSByZXF1ZXN0RGV0YWlscyhhcmdzLnJlcXVlc3QsIHtyZWRhY3RvcjogdGhpcy5nZXRMb2dSZWRhY3RvcigpLCBzZW5zaXRpdmVWYWx1ZXN9KVxuXG4gICAgZm9yIChjb25zdCByZXBvcnRlciBvZiB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMpIHtcbiAgICAgIGNvbnN0IHJlcG9ydGVyUGF5bG9hZCA9IGF3YWl0IHJlcG9ydGVyKHtcbiAgICAgICAgLi4uYXJncyxcbiAgICAgICAgcmVxdWVzdERldGFpbHM6IGRldGFpbHNcbiAgICAgIH0pXG5cbiAgICAgIGlmIChyZXBvcnRlclBheWxvYWQgJiYgdHlwZW9mIHJlcG9ydGVyUGF5bG9hZCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBPYmplY3QuYXNzaWduKHBheWxvYWQsIHJlcG9ydGVyUGF5bG9hZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHRlc3QgYXR0ZW1wdCBpbiBhIHJldm9jYWJsZSBkYXRhYmFzZS1hY2Nlc3MgY29udGV4dC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7cmV2b2tlZDogYm9vbGVhbn19IHNjb3BlIC0gQXR0ZW1wdC1vd25lZCBhY2Nlc3Mgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gVCB8IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQXR0ZW1wdCB3b3JrLlxuICAgKiBAcmV0dXJucyB7VCB8IFByb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHNjb3BlLCBjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJzaXN0ZW50IGZyYW1ld29yayB3b3JrIHdpdGhvdXQgaW5oZXJpdGluZyBhIHRlc3QgYXR0ZW1wdCdzIHJldm9jYWJsZSBkYXRhYmFzZS1hY2Nlc3Mgc2NvcGUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVCB8IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGVyc2lzdGVudCB3b3JrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aG91dEN1cnJlbnRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHVuZGVmaW5lZCwgY2FsbGJhY2spXG4gIH1cblxuICAvKiogVGhyb3dzIHdoZW4gYSB0aW1lZC1vdXQgdGVzdCBhdHRlbXB0IHRyaWVzIHRvIHN0YXJ0IG1vcmUgZGF0YWJhc2Ugd29yay4gKi9cbiAgYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKCkge1xuICAgIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuYXNzZXJ0VGVzdERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGNvbm5lY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhDb25uZWN0aW9ucyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgY29uc3Qge1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIG5hbWVcbiAgICB9ID0gcmVzb2x2ZVdpdGhDb25uZWN0aW9uc0FyZ3Mob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrLCBcIkNvbmZpZ3VyYXRpb24ud2l0aENvbm5lY3Rpb25zXCIpXG5cbiAgICBpZiAoIWFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJ3aXRoQ29ubmVjdGlvbnMgcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgLyoqXG4gICAgICogRGJzLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgY29uc3QgZGJzID0ge31cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYnMsXG4gICAgICBpZGVudGlmaWVyczogZGF0YWJhc2VJZGVudGlmaWVycyA/PyB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSxcbiAgICAgIG5hbWUsXG4gICAgICBzdGFja0xhYmVsOiBcIndpdGhDb25uZWN0aW9uc1wiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cGxpY2l0IG1vZGVsIHdvcmsgaW4gYSB0cmFuc2FjdGlvbiBwaW5uZWQgdG8gb25lIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBuYW1lPzogc3RyaW5nfX0gb3B0aW9ucyAtIE9wZXJhdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IERhdGFiYXNlT3BlcmF0aW9uKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aFRyYW5zYWN0aW9uKHtkYXRhYmFzZUlkZW50aWZpZXIsIG5hbWUgPSBcIkNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uXCIsIC4uLnJlc3RBcmdzfSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvbiByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG4gICAgaWYgKCF0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKS5pbmNsdWRlcyhkYXRhYmFzZUlkZW50aWZpZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3IgaW5hY3RpdmUgZGF0YWJhc2UgaWRlbnRpZmllcjogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnQgPSB0aGlzLmdldEN1cnJlbnRUZW5hbnQoKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuXG4gICAgcmV0dXJuIGF3YWl0IHBvb2wud2l0aE9wZXJhdGlvbkNvbm5lY3Rpb24oe25hbWV9LCBhc3luYyAoY29ubmVjdGlvbiwgb3duZXIpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IG5ldyBEYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgY29uZmlndXJhdGlvblJldXNlS2V5OiBwb29sLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbiksXG4gICAgICAgIGNvbm5lY3Rpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgb3duZXIsXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IG9wZXJhdGlvbi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24pXG4gICAgICAgIH0pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBvcGVyYXRpb24uY29tcGxldGUoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBsaWNpdCBtb2RlbCB3b3JrIG9uIG9uZSBjb25uZWN0aW9uIHNlbGVjdGVkIGZyb20gYSBjYXB0dXJlZCBwaHlzaWNhbFxuICAgKiBkYXRhYmFzZSBjb25maWd1cmF0aW9uLiBObyBhbWJpZW50IHRlbmFudCB2YWx1ZSBpcyByZWFkIGR1cmluZyBjaGVja291dCBvclxuICAgKiBleGVjdXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGUsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBuYW1lPzogc3RyaW5nLCBzY2hlbWFHZW5lcmF0aW9uPzogc3RyaW5nLCB0ZW5hbnQ/OiBvYmplY3R9fSBvcHRpb25zIC0gQ2FwdHVyZWQgb3BlcmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogRGF0YWJhc2VPcGVyYXRpb24pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoRGF0YWJhc2VPcGVyYXRpb24oe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lID0gXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvblwiLCBzY2hlbWFHZW5lcmF0aW9uLCB0ZW5hbnQsIC4uLnJlc3RBcmdzfSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlQ29uZmlndXJhdGlvblwiKVxuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25SZXVzZUtleSA9IHBvb2wuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbilcblxuICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhDYXB0dXJlZE9wZXJhdGlvbkNvbm5lY3Rpb24oe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgbmFtZX0sIGFzeW5jIChjb25uZWN0aW9uLCBvd25lcikgPT4ge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gbmV3IERhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgICBjb25maWd1cmF0aW9uUmV1c2VLZXksXG4gICAgICAgIGNvbm5lY3Rpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgZW5mb3JjZUN1cnJlbnRUZW5hbnRSZXVzZUtleTogZmFsc2UsXG4gICAgICAgIG93bmVyLFxuICAgICAgICBzY2hlbWFHZW5lcmF0aW9uLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBvcGVyYXRpb24uY29tcGxldGUoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYWxsYmFjayB3aXRoIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGZvciB0aGUgcmVxdWVzdGVkIGlkZW50aWZpZXJzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tjYWxsYmFjazogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+LCBkYnM6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+LCBpZGVudGlmaWVyczogc3RyaW5nW10sIG5hbWU6IHN0cmluZywgc3RhY2tMYWJlbDogc3RyaW5nfX0gYXJncyAtIENvbm5lY3Rpb24gc2NvcGUgZGV0YWlscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERhdGFiYXNlSWRlbnRpZmllckNvbm5lY3Rpb25zKHtjYWxsYmFjaywgZGJzLCBpZGVudGlmaWVycywgbmFtZSwgc3RhY2tMYWJlbH0pIHtcbiAgICBjb25zdCBzdGFjayA9IEVycm9yKCkuc3RhY2tcbiAgICBjb25zdCBhY3R1YWxDYWxsYmFjayA9IGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIHJldHVybiBhd2FpdCB3aXRoVHJhY2tlZFN0YWNrKHN0YWNrIHx8IHN0YWNrTGFiZWwsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRicylcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVuIHJlcXVlc3QuXG4gICAgICogQHR5cGUgeygpID0+IFByb21pc2U8VD59ICovXG4gICAgbGV0IHJ1blJlcXVlc3QgPSBhY3R1YWxDYWxsYmFja1xuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGlkZW50aWZpZXJzKSB7XG4gICAgICBsZXQgYWN0dWFsUnVuUmVxdWVzdCA9IHJ1blJlcXVlc3RcblxuICAgICAgY29uc3QgbmV4dFJ1blJlcXVlc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS53aXRoQ29ubmVjdGlvbih7bmFtZX0sIGFzeW5jIChkYikgPT4ge1xuICAgICAgICAgIGRic1tpZGVudGlmaWVyXSA9IGRiXG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgYWN0dWFsUnVuUmVxdWVzdCgpXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJ1blJlcXVlc3QgPSBuZXh0UnVuUmVxdWVzdFxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5SZXF1ZXN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbZGF0YWJhc2VJZGVudGlmaWVyc10gLSBEYXRhYmFzZSBpZGVudGlmaWVycyB0byBpbmNsdWRlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IEEgbWFwIG9mIGRhdGFiYXNlIGNvbm5lY3Rpb25zIHdpdGggaWRlbnRpZmllciBhcyBrZXlcbiAgICovXG4gIGdldEN1cnJlbnRDb25uZWN0aW9ucyhkYXRhYmFzZUlkZW50aWZpZXJzID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgLyoqXG4gICAgICogRGJzLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgY29uc3QgZGJzID0ge31cblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBkYXRhYmFzZUlkZW50aWZpZXJzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcbiAgICAgICAgY29uc3QgY3VycmVudENvbm5lY3Rpb24gPSBwb29sLmdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbiA/IHBvb2wuZ2V0Q3VycmVudENvbnRleHRDb25uZWN0aW9uKCkgOiBwb29sLmdldEN1cnJlbnRDb25uZWN0aW9uKClcblxuICAgICAgICBpZiAoY3VycmVudENvbm5lY3Rpb24gJiYgKCFwb29sLmNvbm5lY3Rpb25NYXRjaGVzQ3VycmVudENvbmZpZ3VyYXRpb24gfHwgcG9vbC5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uKGN1cnJlbnRDb25uZWN0aW9uKSkpIHtcbiAgICAgICAgICBkYnNbaWRlbnRpZmllcl0gPSBjdXJyZW50Q29ubmVjdGlvblxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAodGhpcy5pc01pc3NpbmdDdXJyZW50Q29ubmVjdGlvbkVycm9yKGVycm9yKSkge1xuICAgICAgICAgIC8vIElnbm9yZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRob3V0IGN1cnJlbnQgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biB3aXRob3V0IGluaGVyaXRlZCBEQiBjb25uZWN0aW9uIGNvbnRleHRzLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICB3aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0cyhjYWxsYmFjaykge1xuICAgIGxldCBydW5DYWxsYmFjayA9ICgpID0+IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcnMoY2FsbGJhY2spXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG4gICAgICBjb25zdCBwcmV2aW91c1J1bkNhbGxiYWNrID0gcnVuQ2FsbGJhY2tcblxuICAgICAgcnVuQ2FsbGJhY2sgPSAoKSA9PiBwb29sLndpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQocHJldmlvdXNSdW5DYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuQ2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBpbnNpZGUgZXZlcnkgcG9vbCdzIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gY29udGV4dCAoYSBuby1vcCBmb3JcbiAgICogcG9vbHMgd2l0aG91dCBvbmUpLiBJbi1wcm9jZXNzIHJlcXVlc3QgaGFuZGxpbmcgaXMgd3JhcHBlZCBpbiB0aGlzIHNvIGEgcmVxdWVzdFxuICAgKiBydW5zIG9uIHRoZSBzYW1lIGNvbm5lY3Rpb24g4oCUIGFuZCBvcGVuIHRyYW5zYWN0aW9uIOKAlCBhcyB0aGUgdGVzdCB0aGF0IGlzc3VlZCBpdCxcbiAgICogbGV0dGluZyByZXF1ZXN0IHNwZWNzIGNsZWFuIHVwIGJ5IHJvbGxpbmcgYmFjayBpbnN0ZWFkIG9mIHRydW5jYXRpbmcuIE91dHNpZGVcbiAgICogdGVzdHMgbm8gc2hhcmVkIGNvbm5lY3Rpb24gaXMgc2V0LCBzbyB0aGlzIGp1c3QgcnVucyB0aGUgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gaW5zaWRlIHRoZSBzaGFyZWQgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoY2FsbGJhY2spIHtcbiAgICBsZXQgcnVuQ2FsbGJhY2sgPSBjYWxsYmFja1xuXG4gICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuICAgICAgY29uc3QgcHJldmlvdXNSdW5DYWxsYmFjayA9IHJ1bkNhbGxiYWNrXG5cbiAgICAgIHJ1bkNhbGxiYWNrID0gKCkgPT4gcG9vbC5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb24ocHJldmlvdXNSdW5DYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuQ2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbWlzc2luZyBjdXJyZW50IGNvbm5lY3Rpb24gZXJyb3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRXJyb3IgdGhyb3duIHdoaWxlIGxvb2tpbmcgdXAgdGhlIGN1cnJlbnQgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZXJyb3IgbWVhbnMgbm8gY3VycmVudCBjb25uZWN0aW9uIGlzIGF2YWlsYWJsZS5cbiAgICovXG4gIGlzTWlzc2luZ0N1cnJlbnRDb25uZWN0aW9uRXJyb3IoZXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiAoXG4gICAgICBlcnJvci5tZXNzYWdlID09IFwiSUQgaGFzbid0IGJlZW4gc2V0IGZvciB0aGlzIGFzeW5jIGNvbnRleHRcIiB8fFxuICAgICAgZXJyb3IubWVzc2FnZSA9PSBcIkEgY29ubmVjdGlvbiBoYXNuJ3QgYmVlbiBtYWRlIHlldFwiIHx8XG4gICAgICBlcnJvci5tZXNzYWdlLnN0YXJ0c1dpdGgoXCJObyBhc3luYyBjb250ZXh0IHNldCBmb3IgZGF0YWJhc2UgY29ubmVjdGlvblwiKSB8fFxuICAgICAgZXJyb3IubWVzc2FnZS5zdGFydHNXaXRoKFwiQ29ubmVjdGlvbiBcIikgJiYgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhcImRvZXNuJ3QgZXhpc3QgYW55IG1vcmVcIilcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgY29ubmVjdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgfCBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ29ubmVjdGlvbnMob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBuYW1lXG4gICAgfSA9IHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgXCJDb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zXCIpXG5cbiAgICBpZiAoIWFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJlbnN1cmVDb25uZWN0aW9ucyByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICBjb25zdCByZXF1ZXN0ZWRJZGVudGlmaWVycyA9IGRhdGFiYXNlSWRlbnRpZmllcnMgPz8gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKClcbiAgICBjb25zdCBkYnMgPSB0aGlzLmdldEN1cnJlbnRDb25uZWN0aW9ucyhyZXF1ZXN0ZWRJZGVudGlmaWVycylcbiAgICBjb25zdCBtaXNzaW5nSWRlbnRpZmllcnMgPSByZXF1ZXN0ZWRJZGVudGlmaWVycy5maWx0ZXIoKGlkZW50aWZpZXIpID0+IHtcbiAgICAgIGlmICghZGJzW2lkZW50aWZpZXJdKSByZXR1cm4gdHJ1ZVxuXG4gICAgICByZXR1cm4gIXRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmhhc0N1cnJlbnRDb25uZWN0aW9uQ29udGV4dCgpXG4gICAgfSlcblxuICAgIGlmIChtaXNzaW5nSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gYXdhaXQgYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2soZGJzKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYnMsXG4gICAgICBpZGVudGlmaWVyczogbWlzc2luZ0lkZW50aWZpZXJzLFxuICAgICAgbmFtZSxcbiAgICAgIHN0YWNrTGFiZWw6IFwiZW5zdXJlQ29ubmVjdGlvbnNcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGBhZHZpc29yeUxvY2tzYCBjb25maWd1cmF0aW9uIGJsb2NrIChTVEMtMjEwIGRlc2lnbiDCpzEwKS5cbiAgICogRnVsbCBiYWNrd2FyZCBjb21wYXRpYmlsaXR5OiBhbiBhcHAgdGhhdCBjb25maWd1cmVzIG5vdGhpbmcgZ2V0cyB0b2RheSdzXG4gICAqIGRyaXZlci1uYXRpdmUtb25seSBiZWhhdmlvciDigJQgdGhlIGZpbGUgYmFja2VuZCBpcyAqKmRpc2FibGVkIGJ5IGRlZmF1bHQqKlxuICAgKiBhbmQgb25seSBldmVyIHNlbGVjdGFibGUgYnkgZXhwbGljaXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3tiYWNrZW5kczoge2ZpbGU6IHtkaXJlY3Rvcnk/OiBzdHJpbmcsIGVuYWJsZWQ6IGJvb2xlYW4sIGxlYXNlTXM6IG51bWJlciwgcmVuZXdJbnRlcnZhbE1zOiBudW1iZXJ9LCBsb2NrU2VydmVyOiB7YXV0aFRva2VuOiBzdHJpbmcsIGNvbm5lY3RUaW1lb3V0TXM6IG51bWJlciwgZW5hYmxlZDogYm9vbGVhbiwgbGVhc2VNczogbnVtYmVyLCByZXByb2JlQ29vbGRvd25NczogbnVtYmVyLCB1cmw6IHN0cmluZ319LCBwb2xpY3k6IGltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiKS5BZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5RW50cnlbXX19IC0gQWR2aXNvcnktbG9jayBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdHMgYXBwbGllZC5cbiAgICovXG4gIGdldEFkdmlzb3J5TG9ja0NvbmZpZygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYWR2aXNvcnlMb2NrcyB8fCB7fVxuICAgIGNvbnN0IGZpbGVDb25maWd1cmVkID0gY29uZmlndXJlZC5iYWNrZW5kcz8uZmlsZSB8fCB7fVxuICAgIGNvbnN0IGxvY2tTZXJ2ZXJDb25maWd1cmVkID0gY29uZmlndXJlZC5iYWNrZW5kcz8ubG9ja1NlcnZlciB8fCB7fVxuICAgIGNvbnN0IGVudkhvc3QgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfTE9DS19TRVJWRVJfSE9TVFxuICAgIGNvbnN0IGVudlBvcnRSYXcgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfTE9DS19TRVJWRVJfUE9SVFxuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgbG9ja1NlcnZlckhvc3QgPSBsb2NrU2VydmVyQ29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3RcbiAgICBjb25zdCBsb2NrU2VydmVyUG9ydCA9IHR5cGVvZiBsb2NrU2VydmVyQ29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGxvY2tTZXJ2ZXJDb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiAzMDA2KVxuICAgIGNvbnN0IGxvY2tTZXJ2ZXJVcmwgPSBsb2NrU2VydmVyQ29uZmlndXJlZC51cmxcbiAgICAgIHx8IGB3czovLyR7bG9ja1NlcnZlckhvc3QgfHwgXCIxMjcuMC4wLjFcIn06JHtsb2NrU2VydmVyUG9ydH0vd2Vic29ja2V0YFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tlbmRzOiB7XG4gICAgICAgIGZpbGU6IHtcbiAgICAgICAgICBkaXJlY3Rvcnk6IGZpbGVDb25maWd1cmVkLmRpcmVjdG9yeSxcbiAgICAgICAgICBlbmFibGVkOiBmaWxlQ29uZmlndXJlZC5lbmFibGVkID09PSB0cnVlLFxuICAgICAgICAgIGxlYXNlTXM6IHR5cGVvZiBmaWxlQ29uZmlndXJlZC5sZWFzZU1zID09PSBcIm51bWJlclwiID8gZmlsZUNvbmZpZ3VyZWQubGVhc2VNcyA6IDMwXzAwMCxcbiAgICAgICAgICByZW5ld0ludGVydmFsTXM6IHR5cGVvZiBmaWxlQ29uZmlndXJlZC5yZW5ld0ludGVydmFsTXMgPT09IFwibnVtYmVyXCIgPyBmaWxlQ29uZmlndXJlZC5yZW5ld0ludGVydmFsTXMgOiAxMF8wMDBcbiAgICAgICAgfSxcbiAgICAgICAgbG9ja1NlcnZlcjoge1xuICAgICAgICAgIC8vIEVuYWJsZWQgb25seSBieSBleHBsaWNpdCBjb25maWd1cmF0aW9uIG9yIGFuIGV4cGxpY2l0IGVudiBwYWlyLCBzb1xuICAgICAgICAgIC8vIGFuIGFwcCB0aGF0IGNvbmZpZ3VyZXMgbm90aGluZyBrZWVwcyB0b2RheSdzIGRyaXZlci1uYXRpdmUgYmVoYXZpb3IuXG4gICAgICAgICAgYXV0aFRva2VuOiB0eXBlb2YgbG9ja1NlcnZlckNvbmZpZ3VyZWQuYXV0aFRva2VuID09PSBcInN0cmluZ1wiID8gbG9ja1NlcnZlckNvbmZpZ3VyZWQuYXV0aFRva2VuIDogXCJcIixcbiAgICAgICAgICBjb25uZWN0VGltZW91dE1zOiB0eXBlb2YgbG9ja1NlcnZlckNvbmZpZ3VyZWQuY29ubmVjdFRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiA/IGxvY2tTZXJ2ZXJDb25maWd1cmVkLmNvbm5lY3RUaW1lb3V0TXMgOiAzMDAwLFxuICAgICAgICAgIGVuYWJsZWQ6IHR5cGVvZiBsb2NrU2VydmVyQ29uZmlndXJlZC5lbmFibGVkID09PSBcImJvb2xlYW5cIlxuICAgICAgICAgICAgPyBsb2NrU2VydmVyQ29uZmlndXJlZC5lbmFibGVkXG4gICAgICAgICAgICA6IEJvb2xlYW4obG9ja1NlcnZlckNvbmZpZ3VyZWQudXJsIHx8IGxvY2tTZXJ2ZXJDb25maWd1cmVkLmhvc3QgfHwgZW52SG9zdCB8fCB0eXBlb2YgbG9ja1NlcnZlckNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIiB8fCBlbnZQb3J0UmF3KSxcbiAgICAgICAgICBsZWFzZU1zOiB0eXBlb2YgbG9ja1NlcnZlckNvbmZpZ3VyZWQubGVhc2VNcyA9PT0gXCJudW1iZXJcIiA/IGxvY2tTZXJ2ZXJDb25maWd1cmVkLmxlYXNlTXMgOiAzMF8wMDAsXG4gICAgICAgICAgcmVwcm9iZUNvb2xkb3duTXM6IHR5cGVvZiBsb2NrU2VydmVyQ29uZmlndXJlZC5yZXByb2JlQ29vbGRvd25NcyA9PT0gXCJudW1iZXJcIiA/IGxvY2tTZXJ2ZXJDb25maWd1cmVkLnJlcHJvYmVDb29sZG93bk1zIDogNTAwMCxcbiAgICAgICAgICB1cmw6IGxvY2tTZXJ2ZXJVcmxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHBvbGljeTogQXJyYXkuaXNBcnJheShjb25maWd1cmVkLnBvbGljeSkgPyBjb25maWd1cmVkLnBvbGljeSA6IFtdXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFkdmlzb3J5IGxvY2sgcG9saWN5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3lFbnRyeVtdfSAtIFBlci1sb2NrLW5hbWUgYmFja2VuZCBwb2xpY3kgZW50cmllcy5cbiAgICovXG4gIGdldEFkdmlzb3J5TG9ja1BvbGljeSgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBZHZpc29yeUxvY2tDb25maWcoKS5wb2xpY3lcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZWZmZWN0aXZlIGJhY2tlbmQgcG9saWN5IGZvciBvbmUgbG9jayBuYW1lIChkZXNpZ24gwqc1KS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tOYW1lIC0gQ29uY3JldGUgbG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLlJlc29sdmVkQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeX0gLSBSZXNvbHZlZCBwb2xpY3kuXG4gICAqL1xuICByZXNvbHZlQWR2aXNvcnlMb2NrUG9saWN5KGxvY2tOYW1lKSB7XG4gICAgcmV0dXJuIHJlc29sdmVBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5KGxvY2tOYW1lLCB0aGlzLmdldEFkdmlzb3J5TG9ja1BvbGljeSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZpbGUtdGllciBhZHZpc29yeS1sb2NrIGJhY2tlbmQgd2hlbiB0aGlzIGRlcGxveW1lbnQgaGFzXG4gICAqIGV4cGxpY2l0bHkgZW5hYmxlZCBpdCAoYGFkdmlzb3J5TG9ja3MuYmFja2VuZHMuZmlsZS5lbmFibGVkOiB0cnVlYCksXG4gICAqIGNyZWF0aW5nIGl0IG9uIGZpcnN0IHVzZS4gUmV0dXJucyBgdW5kZWZpbmVkYCB3aGVuIHRoZSB0aWVyIGlzIGRpc2FibGVkXG4gICAqICh0aGUgZGVmYXVsdCkg4oCUIGNhbGxlcnMgbXVzdCBuZXZlciBmYWxsIGJhY2sgdG8gaXQgaW1wbGljaXRseS4gQ3JlYXRpb25cbiAgICogZ29lcyB0aHJvdWdoIHRoZSBlbnZpcm9ubWVudCBoYW5kbGVyIHNvIGJyb3dzZXIvRXhwbyBjb25maWd1cmF0aW9uc1xuICAgKiB3aXRob3V0IGBmc2AgZmFpbCBsb3VkbHkgaW5zdGVhZCBvZiBoYWxmLXdvcmtpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1maWxlLWJhY2tlbmQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZW5hYmxlZCBmaWxlIGJhY2tlbmQsIG9yIHVuZGVmaW5lZC5cbiAgICovXG4gIGFzeW5jIGdldEFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QWR2aXNvcnlMb2NrQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmJhY2tlbmRzLmZpbGUuZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmICh0aGlzLl9hZHZpc29yeUxvY2tGaWxlQmFja2VuZCkgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kXG5cbiAgICBjb25zdCBkaXJlY3RvcnkgPSBjb25maWcuYmFja2VuZHMuZmlsZS5kaXJlY3RvcnkgfHwgYCR7dGhpcy5nZXREaXJlY3RvcnkoKX0vdG1wL2Fkdmlzb3J5LWxvY2tzYFxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQgPSBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmNyZWF0ZUFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKHtcbiAgICAgIGRpcmVjdG9yeSxcbiAgICAgIGxlYXNlTXM6IGNvbmZpZy5iYWNrZW5kcy5maWxlLmxlYXNlTXMsXG4gICAgICByZW5ld0ludGVydmFsTXM6IGNvbmZpZy5iYWNrZW5kcy5maWxlLnJlbmV3SW50ZXJ2YWxNc1xuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5fYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsb2NrLXNlcnZlciBhZHZpc29yeS1sb2NrIGJhY2tlbmQgKHRpZXIgKGIpKSB3aGVuIHRoaXNcbiAgICogZGVwbG95bWVudCBjb25maWd1cmVkIG9uZSwgY3JlYXRpbmcgaXQgb24gZmlyc3QgdXNlLiBSZXR1cm5zIGB1bmRlZmluZWRgXG4gICAqIHdoZW4gdGhlIHRpZXIgaXMgbm90IGNvbmZpZ3VyZWQg4oCUIGNhbGxlcnMgbXVzdCBuZXZlciBpbnZlbnQgb25lLlxuICAgKlxuICAgKiBUaGUgYmFja2VuZCBrZWVwcyBhIHNpbmdsZSBzb2NrZXQgcGVyIHByb2Nlc3M7IGl0IGhvbGRzIG5vIGRhdGFiYXNlXG4gICAqIGNvbm5lY3Rpb24gd2hpbGUgd2FpdGluZyBmb3Igb3IgaG9sZGluZyBhIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stbG9jay1zZXJ2ZXItYmFja2VuZC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb25maWd1cmVkIGJhY2tlbmQsIG9yIHVuZGVmaW5lZC5cbiAgICovXG4gIGFzeW5jIGdldEFkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kKCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QWR2aXNvcnlMb2NrQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmJhY2tlbmRzLmxvY2tTZXJ2ZXIuZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmICh0aGlzLl9hZHZpc29yeUxvY2tMb2NrU2VydmVyQmFja2VuZCkgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kXG5cbiAgICBjb25zdCB7ZGVmYXVsdDogQWR2aXNvcnlMb2NrTG9ja1NlcnZlckJhY2tlbmR9ID0gYXdhaXQgaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWxvY2stc2VydmVyLWJhY2tlbmQuanNcIilcbiAgICBjb25zdCBiYWNrZW5kID0gbmV3IEFkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kKHtcbiAgICAgIGF1dGhUb2tlbjogY29uZmlnLmJhY2tlbmRzLmxvY2tTZXJ2ZXIuYXV0aFRva2VuLFxuICAgICAgY29ubmVjdFRpbWVvdXRNczogY29uZmlnLmJhY2tlbmRzLmxvY2tTZXJ2ZXIuY29ubmVjdFRpbWVvdXRNcyxcbiAgICAgIGxlYXNlTXM6IGNvbmZpZy5iYWNrZW5kcy5sb2NrU2VydmVyLmxlYXNlTXMsXG4gICAgICBvbkVycm9yOiAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwge2NvbnRleHQ6IFwiYWR2aXNvcnktbG9jay1sb2NrLXNlcnZlclwiLCBlcnJvcn0pXG4gICAgICAgIHRoaXMuZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiYWxsLWVycm9yXCIsIHtjb250ZXh0OiBcImFkdmlzb3J5LWxvY2stbG9jay1zZXJ2ZXJcIiwgZXJyb3IsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgICB9LFxuICAgICAgcmVwcm9iZUNvb2xkb3duTXM6IGNvbmZpZy5iYWNrZW5kcy5sb2NrU2VydmVyLnJlcHJvYmVDb29sZG93bk1zLFxuICAgICAgdXJsOiBjb25maWcuYmFja2VuZHMubG9ja1NlcnZlci51cmxcbiAgICB9KVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrTG9ja1NlcnZlckJhY2tlbmQgPSBiYWNrZW5kXG5cbiAgICByZXR1cm4gYmFja2VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgd2hpY2ggYmFja2VuZCB0aWVyIHNlcnZlZCBvbmUgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbiBzb1xuICAgKiBgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cygpYCBjYW4gYW5zd2VyIFwid2hpY2ggYmFja2VuZCBzZXJ2ZWQgdGhpc1xuICAgKiBsb2NrXCIgKGRlc2lnbiDCpzMpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFjcXVpc2l0aW9uIHJlY29yZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubG9ja05hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXJ9IGFyZ3MuYmFja2VuZCAtIFRpZXIgdGhhdCBzZXJ2ZWQgdGhlIGFjcXVpc2l0aW9uLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuZmVuY2luZ1N1cHBvcnRlZCAtIFdoZXRoZXIgdGhlIHNlcnZpbmcgdGllciBjYXJyaWVzIGZlbmNpbmcgdG9rZW5zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEFkdmlzb3J5TG9ja0FjcXVpc2l0aW9uKHtsb2NrTmFtZSwgYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZH0pIHtcbiAgICB0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXNpdGlvbnMuc2V0KGxvY2tOYW1lLCB7YmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZCwgc2VydmVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKX0pXG4gIH1cblxuICAvKipcbiAgICogVGhlIFwid2hpY2ggYmFja2VuZCBzZXJ2ZWQgdGhpcyBsb2NrXCIgZGlhZ25vc3RpY3Mgc3VyZmFjZSAoZGVzaWduIMKnMyk6XG4gICAqIHBlciBsb2NrIG5hbWUsIHRoZSB0aWVyIG9mIHRoZSBtb3N0IHJlY2VudCBhY3F1aXNpdGlvbiwgd2hldGhlciB0aGF0IHRpZXJcbiAgICogY2FycmllcyBmZW5jaW5nIHRva2VucywgYW5kIHRoZSByZXNvbHZlZCBwb2xpY3kgKG1pbmltdW0vYWxsb3dlZC9wcmVmZXJyZWRcbiAgICogdGllcnMpIGZvciB0aGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tOYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2FjcXVpc2l0aW9uOiB7YmFja2VuZDogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXIsIGZlbmNpbmdTdXBwb3J0ZWQ6IGJvb2xlYW4sIHNlcnZlZEF0OiBzdHJpbmd9IHwgbnVsbCwgbG9ja1NlcnZlcjoge2Nvbm5lY3RlZDogYm9vbGVhbiwgbGFzdEVycm9yOiBzdHJpbmcgfCBudWxsLCBsYXN0UHJvYmVBdDogc3RyaW5nIHwgbnVsbCwgbGVhc2VkTmFtZXM6IHN0cmluZ1tdfSB8IG51bGwsIHBvbGljeTogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLlJlc29sdmVkQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeX19IC0gQmFja2VuZCBzdGF0dXMgZm9yIHRoZSBuYW1lLlxuICAgKi9cbiAgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cyhsb2NrTmFtZSkge1xuICAgIHJldHVybiB7XG4gICAgICBhY3F1aXNpdGlvbjogdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlzaXRpb25zLmdldChsb2NrTmFtZSkgPz8gbnVsbCxcbiAgICAgIGxvY2tTZXJ2ZXI6IHRoaXMuX2Fkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kPy5nZXRTdGF0dXMoKSA/PyBudWxsLFxuICAgICAgcG9saWN5OiB0aGlzLnJlc29sdmVBZHZpc29yeUxvY2tQb2xpY3kobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGRlZGljYXRlZCBjb25uZWN0aW9uIHRoYXQgY3VycmVudGx5IGhvbGRzIGFuIGFkdmlzb3J5IGxvY2ssIHNvIGFcbiAgICogc2h1dGRvd24gY2FuIGNsb3NlIGl0IGFuZCByZWxlYXNlIHRoZSBsb2NrLiBTZWUgYF9hZHZpc29yeUxvY2tDb25uZWN0aW9uc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuYWRkKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uIG9uY2UgaXRzIGxvY2sgc2NvcGUgZW5kcyBhbmQgdGhlXG4gICAqIGNvbm5lY3Rpb24gaGFzIGJlZW4gKG9yIGlzIGFib3V0IHRvIGJlKSBjbG9zZWQgYnkgaXRzIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBUaGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB1bnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGV2ZXJ5IHJlZ2lzdGVyZWQgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiwgZW5kaW5nIGl0cyBzZXNzaW9uIHNvXG4gICAqIHRoZSBEQiBzZXJ2ZXIgcmVsZWFzZXMgdGhlIGxvY2suIEV2ZXJ5IGNvbm5lY3Rpb24gaXMgYXR0ZW1wdGVkIGJlZm9yZSBhbnkgZmFpbHVyZVxuICAgKiBpcyBzdXJmYWNlZCwgc28gb25lIHN0dWNrIGNsb3NlIGRvZXMgbm90IGxlYXZlIHRoZSBvdGhlcnMnIGxvY2tzIGhlbGQ7IGEgZmFpbHVyZSBpc1xuICAgKiB0aGVuIHRocm93biAobmV2ZXIgc3dhbGxvd2VkKSwgYWdncmVnYXRlZCB3aGVuIG1vcmUgdGhhbiBvbmUgY29ubmVjdGlvbiBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgYWxsIGhhdmUgYmVlbiBjbG9zZWQ7IHJlamVjdHMgaWYgYW55IGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zXVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuY2xlYXIoKVxuXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBjb25uZWN0aW9ucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFjdGl2ZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBhbmQgY2xlYXJzIGdsb2JhbCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbnN0cnVjdG9ycyA9IG5ldyBTZXQoKVxuXG4gICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgICBjb25zdCBjbG9zZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gQ2xvc2UgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgZmlyc3Q6IHRoZXkgYXJlIHNwYXduZWQgb3V0c2lkZSB0aGVcbiAgICAgICAgICAvLyBwb29scycgdHJhY2tlZCBzZXRzLCBzbyBgcG9vbC5jbG9zZUFsbCgpYCB3b3VsZCBub3QgcmVhY2ggdGhlbSBhbmQgYSBsb2NrIGhlbGRcbiAgICAgICAgICAvLyBieSBhIHJ1bm5lciB0b3JuIGRvd24gbWlkLXBhc3Mgd291bGQgbGVhayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuXG4gICAgICAgICAgLy8gU3RpbGwgY2xvc2UgdGhlIHBvb2xzIGlmIHRoaXMgdGhyb3dzLCBzbyBhIHN0dWNrIGxvY2sgY29ubmVjdGlvbiBkb2VzIG5vdFxuICAgICAgICAgIC8vIGxlYXZlIHRoZSByZXN0IG9mIHRoZSBjb25uZWN0aW9ucyBvcGVuLlxuICAgICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMoKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBSZWxlYXNlIGZpbGUtdGllciBhZHZpc29yeS1sb2NrIGhvbGRzIGV4cGxpY2l0bHkgKFNUQy0yMTMpOiB0aGVcbiAgICAgICAgICAgIC8vIGxlYXNlIHdvdWxkIG1ha2UgdGhlbSByZWNsYWltYWJsZSBhbnl3YXksIGJ1dCBhIGNsZWFuIHNodXRkb3duXG4gICAgICAgICAgICAvLyBzaG91bGQgbm90IGxlYXZlIGxvY2sgZGlyZWN0b3JpZXMgYmVoaW5kIGZvciB0aGUgc3RhbGVuZXNzIHBhdGguXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9hZHZpc29yeUxvY2tGaWxlQmFja2VuZD8ucmVsZWFzZUFsbEhlbGQoKVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gUmVsZWFzZSBsb2NrLXNlcnZlciBsZWFzZXMgZXhwbGljaXRseSBmaXJzdCwgdGhlbiBkcm9wIHRoZSBzb2NrZXQ6XG4gICAgICAgICAgICAvLyB0aGUgc2VydmVyIHJlY2xhaW1zIGEgY2xvc2VkIGNvbm5lY3Rpb24gYW55d2F5LCBidXQgYW4gZXhwbGljaXRcbiAgICAgICAgICAgIC8vIHJlbGVhc2UgaGFuZHMgdGhlIG5hbWUgdG8gdGhlIG5leHQgd2FpdGVyIHdpdGhvdXQgd2FpdGluZyBmb3IgdGhlXG4gICAgICAgICAgICAvLyB0cmFuc3BvcnQgdGVhcmRvd24uXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9hZHZpc29yeUxvY2tMb2NrU2VydmVyQmFja2VuZD8uY2xvc2UoKVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICAgICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG5cbiAgICAgICAgICAgIGF3YWl0IHBvb2wuY2xvc2VBbGwoKVxuXG4gICAgICAgICAgICBjb25zdCBQb29sQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAqLyAocG9vbC5jb25zdHJ1Y3RvcilcbiAgICAgICAgICAgIGNvbnN0cnVjdG9ycy5hZGQoUG9vbENsYXNzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGZvciAoY29uc3QgUG9vbENsYXNzIG9mIGNvbnN0cnVjdG9ycykge1xuICAgICAgICAgICAgUG9vbENsYXNzLmNsZWFyR2xvYmFsQ29ubmVjdGlvbnModGhpcylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZS5yZXNldCgpXG5cbiAgICAgICAgICAvLyBBbGxvdyBmdWxsIHJlLWluaXRpYWxpemF0aW9uIGFmdGVyIGNvbm5lY3Rpb25zIGFyZSBjbG9zZWQuXG4gICAgICAgICAgdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gKz0gMVxuICAgICAgICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGNsb3NlRXJyb3JzWzBdXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGNsb3NlRXJyb3JzLCBcIkZhaWxlZCB0byBjbG9zZSBiYWNrZ3JvdW5kLWpvYnMgYW5kIGRhdGFiYXNlIHJlc291cmNlc1wiKVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgcmVxdWVzdCBhdXRob3JpemVkLlxuICAgKiBAcGFyYW0ge3toZWFkZXI6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9fSByZXF1ZXN0IC0gSW5jb21pbmcgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4cGVjdGVkVG9rZW4gLSBDb25maWd1cmVkIGRlYnVnLWVuZHBvaW50IHRva2VuLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0IGNhcnJpZXMgdGhlIGV4cGVjdGVkIGJlYXJlciB0b2tlbi5cbiAgICovXG4gIGRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCBleHBlY3RlZFRva2VuKSB7XG4gICAgY29uc3QgaGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJhdXRob3JpemF0aW9uXCIpXG5cbiAgICBpZiAodHlwZW9mIGhlYWRlciAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBtYXRjaCA9ICgvXkJlYXJlclxccysoLispJC9pKS5leGVjKGhlYWRlci50cmltKCkpXG5cbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmRlYnVnRW5kcG9pbnRUb2tlbk1hdGNoZXMobWF0Y2hbMV0sIGV4cGVjdGVkVG9rZW4pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXBpIG1hbmlmZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj59IC0gQVBJIG1hbmlmZXN0IGZvciBhbGwgcmVnaXN0ZXJlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBnZXRBcGlNYW5pZmVzdCgpIHtcbiAgICByZXR1cm4gZnJvbnRlbmRNb2RlbEFwaU1hbmlmZXN0KHRoaXMuX2JhY2tlbmRQcm9qZWN0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXRoZXIgQVBJIG1hbmlmZXN0IGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIEFQSSBtYW5pZmVzdCBlbmRwb2ludCBpcyBlbmFibGVkLlxuICAgKi9cbiAgX2FwaU1hbmlmZXN0RW5hYmxlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fYXBpTWFuaWZlc3QuZW5hYmxlZFxuICB9XG59XG4iXX0=