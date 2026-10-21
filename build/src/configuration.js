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
     * @returns {import("./configuration-types.js").VelociousSyncConfiguration} - Sync configuration.
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
     * @returns {import("./configuration-types.js").VelociousSyncConfiguration} - Normalized sync configuration.
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
                    await this._initializeModels({ configuration: this, type: args.type });
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
     * @returns {{backends: {file: {directory?: string, enabled: boolean, leaseMs: number, renewIntervalMs: number}}, policy: import("./database/advisory-lock-backend-policy.js").AdvisoryLockBackendPolicyEntry[]}} - Advisory-lock configuration with defaults applied.
     */
    getAdvisoryLockConfig() {
        const configured = this._advisoryLocks || {};
        const fileConfigured = configured.backends?.file || {};
        return {
            backends: {
                file: {
                    directory: fileConfigured.directory,
                    enabled: fileConfigured.enabled === true,
                    leaseMs: typeof fileConfigured.leaseMs === "number" ? fileConfigured.leaseMs : 30_000,
                    renewIntervalMs: typeof fileConfigured.renewIntervalMs === "number" ? fileConfigured.renewIntervalMs : 10_000
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
     * @returns {{acquisition: {backend: import("./database/advisory-lock-backend-policy.js").AdvisoryLockTier, fencingSupported: boolean, servedAt: string} | null, policy: import("./database/advisory-lock-backend-policy.js").ResolvedAdvisoryLockBackendPolicy}} - Backend status for the name.
     */
    getAdvisoryLockBackendStatus(lockName) {
        return {
            acquisition: this._advisoryLockAcquisitions.get(lockName) ?? null,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLEVBQUMsb0NBQW9DLEVBQUMsTUFBTSw4Q0FBOEMsQ0FBQTtBQUNqRyxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFB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QyxRQUFRLENBQUMsc0JBQXNCLENBQUMsSUFBSSxNQUFNLENBQUMsU0FBUyxDQUFDLHNCQUFzQixDQUFDLElBQUksc0JBQXNCLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDL08sTUFBTSx1QkFBdUIsR0FBRyxPQUFPLFVBQVUsQ0FBQyx1QkFBdUIsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsdUJBQXVCLENBQUMsSUFBSSxVQUFVLENBQUMsdUJBQXVCLElBQUksQ0FBQztZQUN0TCxDQUFDLENBQUMsVUFBVSxDQUFDLHVCQUF1QjtZQUNwQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMseUJBQXlCLElBQUksVUFBVSxDQUFDLElBQUksT0FBTywwQkFBMEIsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQywwQkFBMEIsQ0FBQyxJQUFJLDBCQUEwQixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUE7UUFDck8sTUFBTSx5QkFBeUIsR0FBRyxPQUFPLFVBQVUsQ0FBQyx5QkFBeUIsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMseUJBQXlCLENBQUMsSUFBSSxVQUFVLENBQUMseUJBQXlCLElBQUksQ0FBQztZQUM5TCxDQUFDLENBQUMsVUFBVSxDQUFDLHlCQUF5QjtZQUN0QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsMkJBQTJCLElBQUksVUFBVSxDQUFDLElBQUksT0FBTyw0QkFBNEIsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyw0QkFBNEIsQ0FBQyxJQUFJLDRCQUE0QixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsNEJBQTRCLENBQUMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUE7UUFDNU8sTUFB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R0c7SUFDSCxtQkFBbUI7UUFDakIsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGUgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7KGFyZzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD4pID0+IFByb21pc2U8VD59IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIFdpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gW2RhdGFiYXNlSWRlbnRpZmllcnNdIC0gRGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gaW5jbHVkZSBpbiB0aGUgY29ubmVjdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBIdW1hbi1yZWFkYWJsZSBuYW1lIGZvciB0aGUgY2hlY2tlZC1vdXQgZGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gKi9cbi8qKlxuICogT25lIGFkYXB0ZXIgaW5zdGFuY2UgYW5kIGl0cyBzZXJpYWxpemVkIHJlYWR5L2Nsb3NlIGxpZmVjeWNsZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qc1wiKS5kZWZhdWx0fSBhZGFwdGVyIC0gQWRhcHRlciBvd25lZCBieSB0aGlzIGdlbmVyYXRpb24uXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNsb3NpbmcgLSBXaGV0aGVyIGNsb3NlIGhhcyBjbGFpbWVkIHRoaXMgZ2VuZXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gcmVhZHlQcm9taXNlIC0gU2hhcmVkIHJlYWRpbmVzcyBhdHRlbXB0LlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSBjbG9zZVByb21pc2UgLSBTaGFyZWQgY2xvc2Ugb3BlcmF0aW9uLlxuICovXG5cbmltcG9ydCB7IGRpZ2cgfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBnZXR0ZXh0Q29uZmlnIGZyb20gXCJnZXR0ZXh0LXVuaXZlcnNhbC9idWlsZC9zcmMvY29uZmlnLmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuaW1wb3J0IHRyYW5zbGF0ZSBmcm9tIFwiZ2V0dGV4dC11bml2ZXJzYWwvYnVpbGQvc3JjL3RyYW5zbGF0ZS5qc1wiXG5pbXBvcnQgQWJpbGl0eSBmcm9tIFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qc1wiXG5pbXBvcnQge0RFRkFVTFRfU0NIRURVTEVEX0VOUVVFVUVfVElNRU9VVF9NU30gZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL3NjaGVkdWxlZC1lbnF1ZXVlLWJvdW5kLmpzXCJcbmltcG9ydCBEYXRhYmFzZU9wZXJhdGlvbiBmcm9tIFwiLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIlxuaW1wb3J0IHsgaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHMgfSBmcm9tIFwiLi9kYXRhYmFzZS9yZWNvcmQvYXVkaXRpbmcuanNcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgZnJvbSBcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanNcIlxuaW1wb3J0IHsgQ3VycmVudENvbmZpZ3VyYXRpb25Ob3RTZXRFcnJvciwgY3VycmVudENvbmZpZ3VyYXRpb24sIHNldEN1cnJlbnRDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vY3VycmVudC1jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCB7IHJlcXVlc3REZXRhaWxzIH0gZnJvbSBcIi4vZXJyb3ItcmVwb3J0aW5nL3JlcXVlc3QtZGV0YWlscy5qc1wiXG5pbXBvcnQgTG9nUmVkYWN0b3IgZnJvbSBcIi4vbG9nLXJlZGFjdG9yLmpzXCJcbmltcG9ydCB7IGZyb250ZW5kTW9kZWxBcGlNYW5pZmVzdCwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QgfSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQgeyBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleSwgbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleSB9IGZyb20gXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiXG5pbXBvcnQgUGx1Z2luUm91dGVzIGZyb20gXCIuL3JvdXRlcy9wbHVnaW4tcm91dGVzLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRlc3RBY3Rpdml0eU5hbWUgfSBmcm9tIFwiLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1hY3Rpdml0eS5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRpbWVab25lIH0gZnJvbSBcIi4vdGltZS16b25lLmpzXCJcbmltcG9ydCB7IHdpdGhUcmFja2VkU3RhY2sgfSBmcm9tIFwiLi91dGlscy93aXRoLXRyYWNrZWQtc3RhY2suanNcIlxuaW1wb3J0IFZlbG9jaW91c1BhY2thZ2UgZnJvbSBcIi4vcGFja2FnZXMvdmVsb2Npb3VzLXBhY2thZ2UuanNcIlxuaW1wb3J0IEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlIGZyb20gXCIuL3RlbmFudHMvZnJvbnRlbmQtdGVuYW50LXNxbGl0ZS1saWZlY3ljbGUuanNcIlxuaW1wb3J0IHsgcmVzb2x2ZUdlbmVyYXRpb25JZCwgcmVzb2x2ZUluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIHJlc29sdmVMaWZlY3ljbGVTb2NrZXRQYXRoIH0gZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgeyByZXNvbHZlQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeSB9IGZyb20gXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIlxuXG5leHBvcnQgeyBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yIH1cblxuLyoqXG4gKiBSdW5zIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgd29ya2luZyBkaXJlY3Rvcnkgd2hlbiB0aGUgcnVudGltZSBleHBvc2VzIG9uZS5cbiAqL1xuZnVuY3Rpb24gY3VycmVudFdvcmtpbmdEaXJlY3RvcnkoKSB7XG4gIGNvbnN0IHByb2Nlc3NPYmplY3QgPSAvKiogQHR5cGUge3tjd2Q/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gfCB1bmRlZmluZWR9ICovIChnbG9iYWxUaGlzLnByb2Nlc3MpXG5cbiAgaWYgKHR5cGVvZiBwcm9jZXNzT2JqZWN0Py5jd2QgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIHJldHVybiBwcm9jZXNzT2JqZWN0LmN3ZCgpXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIG92ZXJsb2FkZWQgd2l0aC9lbnN1cmUgY29ubmVjdGlvbnMgYXJndW1lbnRzLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgfCBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+IHwgdW5kZWZpbmVkfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGRlZmF1bHROYW1lIC0gRGVmYXVsdCBjaGVja291dCBuYW1lLlxuICogQHJldHVybnMge3tkYXRhYmFzZUlkZW50aWZpZXJzOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCwgbmFtZTogc3RyaW5nLCBjYWxsYmFjazogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+IHwgdW5kZWZpbmVkfX0gUmVzb2x2ZWQgY2hlY2tvdXQgb3B0aW9ucyBhbmQgY2FsbGJhY2suXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgZGVmYXVsdE5hbWUpIHtcbiAgaWYgKHR5cGVvZiBvcHRpb25zT3JDYWxsYmFjayA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBjb25zdCBhY3R1YWxDYWxsYmFjayA9IC8qKiBAdHlwZSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSAqLyAob3B0aW9uc09yQ2FsbGJhY2spXG5cbiAgICByZXR1cm4ge2RhdGFiYXNlSWRlbnRpZmllcnM6IHVuZGVmaW5lZCwgbmFtZTogZGVmYXVsdE5hbWUsIGNhbGxiYWNrOiBhY3R1YWxDYWxsYmFja31cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGF0YWJhc2VJZGVudGlmaWVyczogb3B0aW9uc09yQ2FsbGJhY2suZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICBuYW1lOiBvcHRpb25zT3JDYWxsYmFjay5uYW1lIHx8IGRlZmF1bHROYW1lLFxuICAgIGNhbGxiYWNrXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGNhbm9uaWNhbCBkZWJ1ZyBzbmFwc2hvdCB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU25hcHNob3QgdmFsdWUgdG8gY2Fub25pY2FsaXplLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBTbmFwc2hvdCB2YWx1ZSB3aXRoIG9iamVjdCBrZXlzIHNvcnRlZCByZWN1cnNpdmVseS5cbiAqL1xuZnVuY3Rpb24gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gdmFsdWVcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUubWFwKChlbnRyeSkgPT4gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKGVudHJ5KSlcblxuICByZXR1cm4gT2JqZWN0LmtleXModmFsdWUpLnNvcnQoKS5yZWR1Y2UoKHJlc3VsdCwga2V5KSA9PiB7XG4gICAgcmVzdWx0W2tleV0gPSBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlba2V5XSlcbiAgICByZXR1cm4gcmVzdWx0XG4gIH0sIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe30pKVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlndXJhdGlvbiAtIEJhc2UgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGUgfCBQYXJ0aWFsPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlPiB8IHZvaWR9IG92ZXJyaWRlQ29uZmlndXJhdGlvbiAtIFRlbmFudCBvdmVycmlkZSBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIE1lcmdlZCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBtZXJnZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG92ZXJyaWRlQ29uZmlndXJhdGlvbikge1xuICBpZiAoIW92ZXJyaWRlQ29uZmlndXJhdGlvbikgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuXG4gIHJldHVybiB7XG4gICAgLi4uZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgIC4uLm92ZXJyaWRlQ29uZmlndXJhdGlvbixcbiAgICByZWNvcmQ6IHtcbiAgICAgIC4uLihkYXRhYmFzZUNvbmZpZ3VyYXRpb24ucmVjb3JkIHx8IHt9KSxcbiAgICAgIC4uLihvdmVycmlkZUNvbmZpZ3VyYXRpb24ucmVjb3JkIHx8IHt9KVxuICAgIH0sXG4gICAgc3FsQ29uZmlnOiB7XG4gICAgICAuLi4oZGF0YWJhc2VDb25maWd1cmF0aW9uLnNxbENvbmZpZyB8fCB7fSksXG4gICAgICAuLi4ob3ZlcnJpZGVDb25maWd1cmF0aW9uLnNxbENvbmZpZyB8fCB7fSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgZ3JhY2Ugd2luZG93IChtcykgYmVmb3JlIGEgc3VzdGFpbmVkIGJlYWNvbiBvdXRhZ2UgaXMgcmVwb3J0ZWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgYHVucmVhY2hhYmxlUmVwb3J0TXNgLCBpZiBhbnkuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBjb25maWd1cmVkIHZhbHVlIHdoZW4gaXQncyBhIGZpbml0ZSBudW1iZXIsIG90aGVyd2lzZSB0aGUgMzBzIGRlZmF1bHQuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVCZWFjb25VbnJlYWNoYWJsZVJlcG9ydE1zKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgcmV0dXJuIDMwXzAwMFxufVxuXG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX0JZVEVTID0gMTYgKiAxMDI0ICogMTAyNFxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19NRVNTQUdFUyA9IDI1NlxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfQllURVMgPSAxNiAqIDEwMjQgKiAxMDI0XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19GUkFNRVMgPSAyNTZcblxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQgPSAxMDI0XG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZID0gNFxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMID0gNlxuXG4vKipcbiAqIFZhbGlkYXRlcyBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlciBjb25maWd1cmF0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIHBvc2l0aXZlIHNhZmUgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29uZmlndXJhdGlvbiBrZXkuXG4gKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFZhbHVlIC0gRGVmYXVsdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgb3IgZGVmYXVsdCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVTYWZlSW50ZWdlcih2YWx1ZSwgbmFtZSwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgJHtuYW1lfSBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyYClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbiBvcHRpb25hbCBwb3NpdGl2ZSBzYWZlIGludGVnZXIgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBwb3NpdGl2ZSBzYWZlIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbmZpZ3VyYXRpb24ga2V5LlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBWYWxpZGF0ZWQgY29uZmlndXJlZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKHZhbHVlLCBuYW1lKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgJHtuYW1lfSBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyYClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbiBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUgaW5zaWRlIGFuIGluY2x1c2l2ZSByYW5nZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtaW4gLSBNaW5pbXVtIGFjY2VwdGVkIHZhbHVlIChpbmNsdXNpdmUpLlxuICogQHBhcmFtIHtudW1iZXJ9IG1heCAtIE1heGltdW0gYWNjZXB0ZWQgdmFsdWUgKGluY2x1c2l2ZSkuXG4gKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFZhbHVlIC0gRGVmYXVsdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgb3IgZGVmYXVsdCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gaW50ZWdlckluUmFuZ2UodmFsdWUsIG5hbWUsIG1pbiwgbWF4LCBkZWZhdWx0VmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBkZWZhdWx0VmFsdWVcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCBtaW4gfHwgdmFsdWUgPiBtYXgpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGAke25hbWV9IG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuICR7bWlufSBhbmQgJHttYXh9YClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgdGhlIGJ1ZmZlcmVkIEhUVFAgcmVzcG9uc2UgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi4gQ29tcHJlc3Npb24gaXNcbiAqIGVuYWJsZWQgYnkgZGVmYXVsdCB3aGVuIHRoZSBzZXR0aW5nIGlzIGFic2VudDsgYGZhbHNlYCBvciBge2VuYWJsZWQ6IGZhbHNlfWBcbiAqIGRpc2FibGVzIGl0IGdsb2JhbGx5LlxuICogQHBhcmFtIHtib29sZWFuIHwgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkh0dHBDb21wcmVzc2lvbkNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IHZhbHVlIC0gQ29uZmlndXJlZCBjb21wcmVzc2lvbiB2YWx1ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEh0dHBDb21wcmVzc2lvbkNvbmZpZ3VyYXRpb259IC0gTm9ybWFsaXplZCBjb21wcmVzc2lvbiBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVIdHRwQ29tcHJlc3Npb24odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IHRydWUpIHtcbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHRocmVzaG9sZDogREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQsIGJyb3RsaVF1YWxpdHk6IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFksIGd6aXBMZXZlbDogREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMfVxuICB9XG5cbiAgaWYgKHZhbHVlID09PSBmYWxzZSkge1xuICAgIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHRocmVzaG9sZDogREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQsIGJyb3RsaVF1YWxpdHk6IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFksIGd6aXBMZXZlbDogREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMfVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24gbXVzdCBiZSBhIGJvb2xlYW4gb3IgYW4gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICB9XG5cbiAgY29uc3Qge2Jyb3RsaVF1YWxpdHksIGVuYWJsZWQsIGd6aXBMZXZlbCwgdGhyZXNob2xkLCAuLi5yZXN0Q29tcHJlc3Npb259ID0gdmFsdWVcbiAgY29uc3QgcmVzdENvbXByZXNzaW9uS2V5cyA9IE9iamVjdC5rZXlzKHJlc3RDb21wcmVzc2lvbilcblxuICBpZiAocmVzdENvbXByZXNzaW9uS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbiByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7cmVzdENvbXByZXNzaW9uS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGJyb3RsaVF1YWxpdHksIGVuYWJsZWQsIGd6aXBMZXZlbCwgdGhyZXNob2xkKWApXG4gIH1cblxuICBpZiAoZW5hYmxlZCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBlbmFibGVkICE9PSBcImJvb2xlYW5cIikge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uZW5hYmxlZCBtdXN0IGJlIGEgYm9vbGVhbiwgZ290OiAke1N0cmluZyhlbmFibGVkKX1gKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiBlbmFibGVkID8/IHRydWUsXG4gICAgdGhyZXNob2xkOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHRocmVzaG9sZCwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLnRocmVzaG9sZFwiLCBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCksXG4gICAgYnJvdGxpUXVhbGl0eTogaW50ZWdlckluUmFuZ2UoYnJvdGxpUXVhbGl0eSwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLmJyb3RsaVF1YWxpdHlcIiwgMCwgMTEsIERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFkpLFxuICAgIGd6aXBMZXZlbDogaW50ZWdlckluUmFuZ2UoZ3ppcExldmVsLCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uZ3ppcExldmVsXCIsIDAsIDksIERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTClcbiAgfVxufVxuXG4vKipcbiAqIERlZmF1bHQgcmVxdWVzdC1ib2R5IGxpbWl0IGZvciB0aGUgYnVpbHQtaW4gTUNQIGVuZHBvaW50LiBKU09OLVJQQyBtZXNzYWdlcyBhcmUgc21hbGwsXG4gKiBzbyB0aGUgZnJhbWV3b3JrIGNhcHMgdGhlbSBpbnN0ZWFkIG9mIG1ha2luZyBldmVyeSBhcHAgdGhhdCBlbmFibGVzIGBtY3A6IHRydWVgIHJlc3RhdGVcbiAqIGEgcmVxdWVzdC1ib2R5IHBvbGljeS4gRXhwbGljaXQgYGh0dHBTZXJ2ZXIubWF4UmVxdWVzdEJvZHlCeXRlc2Agb3IgYSByZXNvbHZlciBsaW1pdCB3aW5zLlxuICogQHR5cGUge251bWJlcn1cbiAqL1xuY29uc3QgREVGQVVMVF9NQ1BfTUFYX1JFUVVFU1RfQk9EWV9CWVRFUyA9IDEwMjQgKiAxMDI0XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NvbmZpZ3VyYXRpb24ge1xuICAvKipcbiAgICogQ2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvbnMgcHJvbWlzZS5cbiAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICBfY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IG51bGxcblxuICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gIF9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zIGN1cnJlbnRseSBob2xkaW5nIGEgbG9jay4gVGhlc2UgYXJlIHNwYXduZWRcbiAgICogb3V0c2lkZSB0aGUgcG9vbHMnIHRyYWNrZWQgc2V0cyAoc28gYSBob2xkLXRpbWVvdXQgbG9jayBzdXJ2aXZlcyBwb29sIGNoZWNrb3V0cyksXG4gICAqIHNvIGBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNgIHdvdWxkIG90aGVyd2lzZSB3YWxrIHBhc3QgdGhlbTsgdHJhY2tpbmcgdGhlbSBoZXJlXG4gICAqIGxldHMgYSBzaHV0ZG93biBjbG9zZSB0aGVtIGFuZCByZWxlYXNlIHRoZSBsb2NrIGluc3RlYWQgb2Ygb3JwaGFuaW5nIGl0LlxuICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMgPSBuZXcgU2V0KClcblxuICAvKipcbiAgICogTGF6aWx5IGNyZWF0ZWQgZmlsZS10aWVyIGFkdmlzb3J5LWxvY2sgYmFja2VuZCAoU1RDLTIxMykuIFN0YXlzIGB1bmRlZmluZWRgXG4gICAqIHVubGVzcyBgYWR2aXNvcnlMb2Nrcy5iYWNrZW5kcy5maWxlLmVuYWJsZWQ6IHRydWVgIGlzIGV4cGxpY2l0bHkgY29uZmlndXJlZCDigJRcbiAgICogdGhlIGZpbGUgdGllciBpcyBuZXZlciBhdXRvLWVuYWJsZWQsIGFuZCBhIG5vbi1Ob2RlIGVudmlyb25tZW50IGhhbmRsZXJcbiAgICogKGJyb3dzZXIvRXhwbywgbm8gYGZzYCkgY2Fubm90IGNyZWF0ZSBvbmUgYXQgYWxsLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBfYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogTW9zdCByZWNlbnQgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbiBwZXIgbG9jayBuYW1lIOKAlCB0aGUgXCJ3aGljaCBiYWNrZW5kXG4gICAqIHNlcnZlZCB0aGlzIGxvY2tcIiBzdXJmYWNlIChkZXNpZ24gwqczKS5cbiAgICogQHR5cGUge01hcDxzdHJpbmcsIHtiYWNrZW5kOiBpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuQWR2aXNvcnlMb2NrVGllciwgZmVuY2luZ1N1cHBvcnRlZDogYm9vbGVhbiwgc2VydmVkQXQ6IHN0cmluZ30+fSAqL1xuICBfYWR2aXNvcnlMb2NrQWNxdWlzaXRpb25zID0gbmV3IE1hcCgpXG5cbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICBfc2NoZW1hQ2FjaGVHZW5lcmF0aW9uc0J5UmV1c2VLZXkgPSBuZXcgTWFwKClcblxuICAvKipcbiAgICogUnVucyBjdXJyZW50LlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzQ29uZmlndXJhdGlvbn0gLSBUaGUgY3VycmVudC5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIHJldHVybiBjdXJyZW50Q29uZmlndXJhdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ29uZmlndXJhdGlvbkFyZ3NUeXBlfSBhcmdzIC0gQ29uZmlndXJhdGlvbiBhcmd1bWVudHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YWJpbGl0eVJlc29sdmVyLCBhYmlsaXR5UmVzb3VyY2VzLCBhZHZpc29yeUxvY2tzLCBhdHRhY2htZW50cywgYXV0b2xvYWQgPSB0cnVlLCBiYWNrZ3JvdW5kSm9icywgYmFja2VuZFByb2plY3RzLCBiZWFjb24sIGNvb2tpZVNlY3JldCwgY29ycywgZGF0YWJhc2UsIGRlYnVnID0gZmFsc2UsIGRlYnVnRW5kcG9pbnQgPSBmYWxzZSwgYXBpTWFuaWZlc3QgPSBmYWxzZSwgZGlyZWN0b3J5LCBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSB0cnVlLCBlbnZpcm9ubWVudCwgZW52aXJvbm1lbnRIYW5kbGVyLCBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cywgZnJvbnRlbmRUZW5hbnRTcWxpdGUsIGh0dHBTZXJ2ZXIsIGluaXRpYWxpemVNb2RlbHMsIGluaXRpYWxpemVycywgbG9jYWxlLCBsb2NhbGVGYWxsYmFja3MsIGxvY2FsZXMsIGxvZ2dpbmcsIG1haWxlckJhY2tlbmQsIG1jcCA9IGZhbHNlLCBwYWNrYWdlcywgcmVxdWVzdFRpbWVvdXRNcywgcm91dGVSZXNvbHZlckhvb2tzLCBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icywgc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycywgc3RydWN0dXJlU3FsLCBzeW5jLCB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycywgdGVuYW50RGF0YWJhc2VSZXNvbHZlciwgdGVuYW50UmVzb2x2ZXIsIHRlc3RUZW5hbnRQb29scywgdGVzdGluZywgdGltZVpvbmUsIHRpbWV6b25lT2Zmc2V0TWludXRlcywgdHJ1c3RlZFByb3hpZXMsIHdlYnNvY2tldENoYW5uZWxSZXNvbHZlciwgd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMuX2FiaWxpdHlSZXNvbHZlciA9IGFiaWxpdHlSZXNvbHZlclxuICAgIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSBhYmlsaXR5UmVzb3VyY2VzIHx8IFtdXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrcyA9IGFkdmlzb3J5TG9ja3NcbiAgICB0aGlzLl9hdXRvbG9hZCA9IGF1dG9sb2FkXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnMgPSBiYWNrZ3JvdW5kSm9ic1xuICAgIHRoaXMuX2JlYWNvbiA9IGJlYWNvblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGNsaWVudCB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGNvbm5lY3QgcHJvbWlzZSB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gcmVwb3J0IHRpbWVyIHZhbHVlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gLSBQZW5kaW5nIFwiYmVhY29uIHN0aWxsIHVucmVhY2hhYmxlXCIgcmVwb3J0IHRpbWVyLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gb3V0YWdlIHJlcG9ydGVkIHZhbHVlLlxuICAgICAqIEB0eXBlIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYmVhY29uIG91dGFnZSBoYXMgYWxyZWFkeSBiZWVuIHJlcG9ydGVkLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBsYXN0IGRvd24gZXJyb3IgdmFsdWUuXG4gICAgICogQHR5cGUge3tzdGFnZTogXCJiZWFjb24tY29ubmVjdFwiIHwgXCJiZWFjb24tZGlzY29ubmVjdFwiLCBlcnJvcjogRXJyb3J9IHwgdW5kZWZpbmVkfSAtIExhdGVzdCBiZWFjb24tZG93biBkZXRhaWxzLCByZXBvcnRlZCBvbmx5IGlmIHRoZSBvdXRhZ2UgaXMgc3VzdGFpbmVkLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyA9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzXG4gICAgdGhpcy5fYXR0YWNobWVudHMgPSBhdHRhY2htZW50cyB8fCB7fVxuICAgIC8vIENvcHkgc28gYXBwZW5kaW5nIHBhY2thZ2UtZGVyaXZlZCBlbnRyaWVzIGJlbG93IG5ldmVyIG11dGF0ZXMgYSBjYWxsZXInc1xuICAgIC8vIHNoYXJlZCBhcnJheSAoY29uZmlnIG1vZHVsZXMgY29tbW9ubHkgZXhwb3J0IGEgcmV1c2VkIGJhY2tlbmRQcm9qZWN0cyBhcnJheSkuXG4gICAgdGhpcy5fYmFja2VuZFByb2plY3RzID0gYmFja2VuZFByb2plY3RzID8gWy4uLmJhY2tlbmRQcm9qZWN0c10gOiBbXVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyVHlwZVtdfSAqL1xuICAgIHRoaXMuX2NsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVycyA9IFtdXG4gICAgdGhpcy5jb3JzID0gY29yc1xuICAgIHRoaXMuX2Nvb2tpZVNlY3JldCA9IGNvb2tpZVNlY3JldFxuICAgIHRoaXMuZGF0YWJhc2UgPSBkYXRhYmFzZVxuICAgIHRoaXMuZGVidWcgPSBkZWJ1Z1xuICAgIHRoaXMuX2RlYnVnRW5kcG9pbnQgPSB0aGlzLl9ub3JtYWxpemVEZWJ1Z0VuZHBvaW50KGRlYnVnRW5kcG9pbnQpXG4gICAgdGhpcy5fYXBpTWFuaWZlc3QgPSB0aGlzLl9ub3JtYWxpemVBcGlNYW5pZmVzdChhcGlNYW5pZmVzdClcbiAgICB0aGlzLl9tY3AgPSB0aGlzLl9ub3JtYWxpemVNY3AobWNwKVxuICAgIHRoaXMuX2Vudmlyb25tZW50ID0gZW52aXJvbm1lbnQgfHwgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0VOViB8fCBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5OT0RFX0VOViB8fCBcImRldmVsb3BtZW50XCJcbiAgICB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIgPSBlbnZpcm9ubWVudEhhbmRsZXJcbiAgICB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXNcbiAgICB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9IGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzID09PSB1bmRlZmluZWRcbiAgICAgID8gc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycyAhPT0gdHJ1ZVxuICAgICAgOiBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50c1xuICAgIHRoaXMuX2RpcmVjdG9yeSA9IGRpcmVjdG9yeVxuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHMgPSBpbml0aWFsaXplTW9kZWxzXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNQYWNrYWdlW119ICovXG4gICAgdGhpcy5fcGFja2FnZXMgPSAocGFja2FnZXMgfHwgW10pLm1hcCgoZW50cnkpID0+IFZlbG9jaW91c1BhY2thZ2UuZnJvbShlbnRyeSkpXG5cbiAgICAvLyBBcHBlbmQgYSBkZXJpdmVkIGJhY2tlbmQtcHJvamVjdCBwZXIgcGFja2FnZSBzbyB0aGUgZXhpc3RpbmcgcmVzb3VyY2VcbiAgICAvLyBkaXNjb3ZlcnkgKyBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uIG1hY2hpbmVyeSBpbmNsdWRlcyBpdC4gUGFja2FnZVxuICAgIC8vIGZyb250ZW5kIG1vZGVscyBhcmUgZ2VuZXJhdGVkIGludG8gdGhlIGFwcCdzIGZyb250ZW5kLW1vZGVscyBvdXRwdXQuXG4gICAgY29uc3QgYXBwRnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoID0gdGhpcy5fYmFja2VuZFByb2plY3RzWzBdPy5mcm9udGVuZE1vZGVsc091dHB1dFBhdGhcblxuICAgIGZvciAoY29uc3QgdmVsb2Npb3VzUGFja2FnZSBvZiB0aGlzLl9wYWNrYWdlcykge1xuICAgICAgdGhpcy5fYmFja2VuZFByb2plY3RzLnB1c2godmVsb2Npb3VzUGFja2FnZS50b0JhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbih7ZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoOiBhcHBGcm9udGVuZE1vZGVsc091dHB1dFBhdGh9KSlcbiAgICB9XG5cbiAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vaW5pdGlhbGl6ZXIuanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIEludmFsaWRhdGVzIG1vZGVsIHBoYXNlcyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGNsb3NlZC5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID0gMFxuICAgIC8qKlxuICAgICAqIEluLXByb2dyZXNzIGBpbml0aWFsaXplTW9kZWxzKClgIHByb21pc2UuIE1vZGVsIGluaXRpYWxpemF0aW9uIGlzIGFuXG4gICAgICogYXRvbWljIGJvb3RzdHJhcCBwaGFzZTogY29uY3VycmVudCBjYWxsZXJzIHNoYXJlIGl0LCBhbmQgYSByZWplY3Rpb25cbiAgICAgKiBsZWF2ZXMgdGhlIHBoYXNlIGVsaWdpYmxlIGZvciBhIGxhdGVyIGNvbXBsZXRlIGF0dGVtcHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGBpbml0aWFsaXplKClgIHByb21pc2UsIG1lbW9pemVkIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGVcbiAgICAgKiBzYW1lIGJvb3RzdHJhcC4gUmV0YWluZWQgYWNyb3NzIGEgY29ubmVjdGlvbiBjbG9zZSB1bnRpbCBzdGFsZSBib290c3RyYXBcbiAgICAgKiB3b3JrIHNldHRsZXMsIHRoZW4gY2xlYXJlZCBieSBpZGVudGl0eSBiZWZvcmUgdGhlIG5ldyBnZW5lcmF0aW9uIHJldHJpZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICBjb25zdCByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyID0gaHR0cFNlcnZlcj8ucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlclxuICAgIGNvbnN0IHdlYnNvY2tldEluYm91bmRRdWV1ZSA9IGh0dHBTZXJ2ZXI/LndlYnNvY2tldEluYm91bmRRdWV1ZVxuICAgIGNvbnN0IHdlYnNvY2tldE91dGJvdW5kUXVldWUgPSBodHRwU2VydmVyPy53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlXG5cbiAgICBpZiAocmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5odHRwU2VydmVyID0ge1xuICAgICAgLi4uKGh0dHBTZXJ2ZXIgfHwge30pLFxuICAgICAgY29tcHJlc3Npb246IG5vcm1hbGl6ZUh0dHBDb21wcmVzc2lvbihodHRwU2VydmVyPy5jb21wcmVzc2lvbiksXG4gICAgICBtYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzOiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIoaHR0cFNlcnZlcj8ubWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlcywgXCJodHRwU2VydmVyLm1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXNcIiksXG4gICAgICBtYXhSZXF1ZXN0Qm9keUJ5dGVzOiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIoaHR0cFNlcnZlcj8ubWF4UmVxdWVzdEJvZHlCeXRlcywgXCJodHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcIiksXG4gICAgICByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyLFxuICAgICAgd2Vic29ja2V0SW5ib3VuZFF1ZXVlOiB7XG4gICAgICAgIG1heFBlbmRpbmdCeXRlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRJbmJvdW5kUXVldWU/Lm1heFBlbmRpbmdCeXRlcywgXCJodHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZS5tYXhQZW5kaW5nQnl0ZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19CWVRFUyksXG4gICAgICAgIG1heFBlbmRpbmdNZXNzYWdlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRJbmJvdW5kUXVldWU/Lm1heFBlbmRpbmdNZXNzYWdlcywgXCJodHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZS5tYXhQZW5kaW5nTWVzc2FnZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19NRVNTQUdFUylcbiAgICAgIH0sXG4gICAgICB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlOiB7XG4gICAgICAgIG1heFBlbmRpbmdCeXRlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlPy5tYXhQZW5kaW5nQnl0ZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlLm1heFBlbmRpbmdCeXRlc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19CWVRFUyksXG4gICAgICAgIG1heFBlbmRpbmdGcmFtZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0T3V0Ym91bmRRdWV1ZT8ubWF4UGVuZGluZ0ZyYW1lcywgXCJodHRwU2VydmVyLndlYnNvY2tldE91dGJvdW5kUXVldWUubWF4UGVuZGluZ0ZyYW1lc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19GUkFNRVMpXG4gICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgaHR0cCBzZXJ2ZXIgaW5zdGFuY2UgdmFsdWUuXG4gICAgICogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90OiAoKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9jYWxlID0gbG9jYWxlXG4gICAgdGhpcy5sb2NhbGVGYWxsYmFja3MgPSBsb2NhbGVGYWxsYmFja3NcbiAgICB0aGlzLmxvY2FsZXMgPSBsb2NhbGVzXG4gICAgdGhpcy5faW5pdGlhbGl6ZXJzID0gaW5pdGlhbGl6ZXJzXG4gICAgdGhpcy5fdGVzdGluZyA9IHRlc3RpbmdcbiAgICB0aGlzLl90aW1lWm9uZSA9IHRpbWVab25lXG4gICAgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID0gdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgdGhpcy5fdHJ1c3RlZFByb3hpZXMgPSB0cnVzdGVkUHJveGllc1xuICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPSByZXF1ZXN0VGltZW91dE1zXG4gICAgdGhpcy5fc3RydWN0dXJlU3FsID0gc3RydWN0dXJlU3FsXG4gICAgdGhpcy5fc3luYyA9IHRoaXMuX25vcm1hbGl6ZVN5bmNDb25maWd1cmF0aW9uKHN5bmMpXG4gICAgdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgPSB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycyB8fCB7fVxuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIgPSB0ZW5hbnREYXRhYmFzZVJlc29sdmVyXG4gICAgdGhpcy5fdGVuYW50UmVzb2x2ZXIgPSB0ZW5hbnRSZXNvbHZlclxuICAgIHRoaXMuX3Rlc3RUZW5hbnRQb29scyA9IHRlc3RUZW5hbnRQb29sc1xuICAgIHRoaXMuX3dlYnNvY2tldEV2ZW50cyA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaWJlcnMgdmFsdWUuXG4gICAgICogQHR5cGUge1ZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIgPSB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIENoYW5uZWwgdHlwZXMgcmVnaXN0ZXJlZCB3aXRoIGB7bGl2ZU9ubHk6IHRydWV9YDogdGhlaXIgdHJhZmZpYyBpc1xuICAgICAqIG5ldmVyIHBlcnNpc3RlZCBmb3IgcmVwbGF5LCBhbmQgYG1hcmtDaGFubmVsSW50ZXJlc3RlZGAgcmVqZWN0cyB0aGVcbiAgICAgKiBuYW1lLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICB0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmlwdGlvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIFNldDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQ+Pn0gLSBjaGFubmVsVHlwZSDihpIgbGl2ZSBzdWJzY3JpcHRpb25zIGFjcm9zcyBhbGwgc2Vzc2lvbnMuXG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBsb2NhbCAocGVyLXByb2Nlc3MpIHdlYnNvY2tldCBjaGFubmVsIGJyb2FkY2FzdCBkZWxpdmVyaWVzLFxuICAgICAqIGxhdW5jaGVkIGZpcmUtYW5kLWZvcmdldCBmcm9tIGBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWxgIHNvIG9uZSBzbG93XG4gICAgICogc3Vic2NyaWJlciBuZXZlciBibG9ja3MgYW5vdGhlci4gVHJhY2tlZCBoZXJlIHNvXG4gICAgICogYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGNhbiBzbmFwc2hvdCBhbmQgZHJhaW4gdGhlbSBiZWZvcmUgc2V0dGxpbmcuXG4gICAgICogU2V0dGxlZCBkZWxpdmVyaWVzIGFyZSByZW1vdmVkIGJ5IHRoZSB0cmFja2luZy1sZXZlbCBjbGVhbnVwLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBMYXRlc3QgbG9jYWwgYnJvYWRjYXN0IGRlbGl2ZXJ5IHBlciBzdWJzY3JpcHRpb24uIENoYWluaW5nIHN1YnNlcXVlbnRcbiAgICAgKiBkZWxpdmVyaWVzIHByZXNlcnZlcyBsaWZlY3ljbGUgZXZlbnQgb3JkZXIgd2l0aG91dCBjb3VwbGluZyBzZXBhcmF0ZVxuICAgICAqIHN1YnNjcmliZXJzIHRvIG9uZSBhbm90aGVyLlxuICAgICAqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdCwgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzID0gbmV3IFdlYWtNYXAoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgc2Vzc2lvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0Pn0gLSBMaXZlIHdlYnNvY2tldCBzZXNzaW9ucywgaW5jbHVkaW5nIHBhdXNlZCBzZXNzaW9ucyB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdy5cbiAgICAgKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9ucyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBwYXVzZWQgd2Vic29ja2V0IHNlc3Npb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7c2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgZ3JhY2VUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4sIHBhdXNlZEF0OiBudW1iZXJ9Pn0gLSBzZXNzaW9uSWQg4oaSIHBhdXNlZCBzZXNzaW9uIGF3YWl0aW5nIHJlc3VtZS5cbiAgICAgKi9cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqIEdyYWNlIHBlcmlvZCBmb3IgcGF1c2VkIFdlYlNvY2tldCBzZXNzaW9ucyBiZWZvcmUgcGVybWFuZW50IHRlYXJkb3duLiAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgPSAzMDBcblxuICAgIC8qKiBJbnRlcnZhbCAoc2Vjb25kcykgYmV0d2VlbiBzZXJ2ZXLihpJjbGllbnQgaGVhcnRiZWF0IHBpbmdzOyAwIGRpc2FibGVzIHJlYXBpbmcgb2Ygc2lsZW50IHNvY2tldHMuICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgPSAzMFxuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgd3JhcHBlciBjYWxsZWQgYXJvdW5kIGV2ZXJ5IFdlYlNvY2tldC1ib3JuZSByZXF1ZXN0IC9cbiAgICAgKiBjb25uZWN0aW9uIG1lc3NhZ2UgLyBjaGFubmVsIGRpc3BhdGNoLiBBcHBzIHJlZ2lzdGVyIGl0IGhlcmVcbiAgICAgKiB0byBzZXQgdXAgcGVyLXJlcXVlc3QgY29udGV4dCAoZS5nLiBBc3luY0xvY2FsU3RvcmFnZSBmb3JcbiAgICAgKiBsb2NhbGUsIHRlbmFudCwgdHJhY2luZykgdGhhdCBkb3duc3RyZWFtIGhhbmRsZXJzIHJlYWQuXG4gICAgICogQHR5cGUgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfVxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3QgPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGFyb3VuZCBhY3Rpb24gdmFsdWUuXG4gICAgICogQHR5cGUgeygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAqL1xuICAgIHRoaXMuX2Fyb3VuZEFjdGlvbiA9IG51bGxcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IHNlc3Npb24gaWRlbnRpdHkgcmVzb2x2ZXIgdmFsdWUuXG4gICAgICogQHR5cGUgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyID0gbnVsbFxuICAgIHRoaXMuX2xvZ2dpbmcgPSBsb2dnaW5nXG4gICAgdGhpcy5fbG9nUmVkYWN0b3IgPSBuZXcgTG9nUmVkYWN0b3Ioe3NlbnNpdGl2ZU5hbWVzOiBsb2dnaW5nPy5zZW5zaXRpdmVOYW1lc30pXG4gICAgdGhpcy5fbWFpbGVyQmFja2VuZCA9IG1haWxlckJhY2tlbmRcbiAgICB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MgPSBbLi4uKHJvdXRlUmVzb2x2ZXJIb29rcyB8fCBbXSldXG4gICAgdGhpcy5fYWRkRGVidWdFbmRwb2ludFJvdXRlSG9vaygpXG4gICAgdGhpcy5fYWRkQXBpTWFuaWZlc3RSb3V0ZUhvb2soKVxuICAgIHRoaXMuX2FkZE1jcFJvdXRlSG9vaygpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGFwcGxpZWQgcm91dGUgbW91bnRzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtXZWFrU2V0PG9iamVjdD59ICovXG4gICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2Vycm9yRXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGRhdGFiYXNlIHBvb2xzIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzID0ge31cbiAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSA9IG5ldyBGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSh7Y29uZmlndXJhdGlvbjogdGhpcywgbWF4T3BlbkhhbmRsZXM6IGZyb250ZW5kVGVuYW50U3FsaXRlPy5tYXhPcGVuSGFuZGxlc30pXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIG1vZGVsIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiB0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5tb2RlbENsYXNzZXMgPSB7fVxuXG4gICAgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5zZXRDb25maWd1cmF0aW9uKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0b2xvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIG9uIGxhenkgYWNjZXNzIGlzIGVuYWJsZWQgZ2xvYmFsbHkuXG4gICAqL1xuICBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIHRoaXMuX2F1dG9sb2FkIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhwb3NlIGludGVybmFsIGVycm9ycyB0byBjbGllbnRzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB1bmV4cGVjdGVkIGludGVybmFsIGVycm9yIGRldGFpbHMgbWF5IGJlIHJldHVybmVkIHRvIEFQSSBjbGllbnRzLlxuICAgKi9cbiAgZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSB7IHJldHVybiB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9PT0gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBmcm9udGVuZC1tb2RlbCBlcnJvcnMgZXhwb3NlIG9ubHkgZXhwbGljaXRseSBzYWZlIG1lc3NhZ2VzLlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKClgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBpbnRlcm5hbCBlcnJvciBleHBvc3VyZSBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGdldFNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMoKSB7IHJldHVybiAhdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgZW5kcG9pbnQuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERlYnVnRW5kcG9pbnQoKSB7IHJldHVybiB0aGlzLl9kZWJ1Z0VuZHBvaW50IH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBwYXRoOiBzdHJpbmcsIHRva2VuQ29uZmlndXJlZDogYm9vbGVhbn19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlnIGZvciB0aGUgc25hcHNob3QsIHdpdGggdGhlIHRva2VuIHJlZGFjdGVkLlxuICAgKi9cbiAgX2RlYnVnRW5kcG9pbnRTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdGhpcy5fZGVidWdFbmRwb2ludC5lbmFibGVkLFxuICAgICAgcGF0aDogdGhpcy5fZGVidWdFbmRwb2ludC5wYXRoLFxuICAgICAgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2RlYnVnRW5kcG9pbnQudG9rZW4pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRlYnVnIGVuZHBvaW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBkZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZURlYnVnRW5kcG9pbnQodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvdmVsb2Npb3VzL2RlYnVnXCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvdmVsb2Npb3VzL2RlYnVnXCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50LnBhdGggdG8gYmUgYSBzdHJpbmcgc3RhcnRpbmcgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocGF0aCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IHZhbHVlLnRva2VuID09PSB1bmRlZmluZWQgfHwgdmFsdWUudG9rZW4gPT09IG51bGwgPyBudWxsIDogdmFsdWUudG9rZW5cblxuICAgIGlmICh0b2tlbiAhPT0gbnVsbCAmJiAodHlwZW9mIHRva2VuICE9PSBcInN0cmluZ1wiIHx8ICF0b2tlbi50cmltKCkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlYnVnRW5kcG9pbnQudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBhcGkgbWFuaWZlc3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IHtwYXRoPzogc3RyaW5nLCB0b2tlbj86IHN0cmluZ319IHZhbHVlIC0gQVBJIG1hbmlmZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBBUEkgbWFuaWZlc3QgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVBcGlNYW5pZmVzdCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgcGF0aDogXCIvYXBpL21hbmlmZXN0XCIsIHRva2VuOiBudWxsfVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoOiBcIi9hcGkvbWFuaWZlc3RcIiwgdG9rZW46IG51bGx9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFwaU1hbmlmZXN0IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvYXBpL21hbmlmZXN0XCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC50b2tlbiB0byBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcodG9rZW4pfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoLCB0b2tlbjogdG9rZW4gPT09IG51bGwgPyBudWxsIDogdG9rZW4udHJpbSgpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGFwaSBtYW5pZmVzdCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkQXBpTWFuaWZlc3RSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9hcGlNYW5pZmVzdC5lbmFibGVkKSByZXR1cm5cblxuICAgIHRoaXMuYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gXCJHRVRcIikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChjdXJyZW50UGF0aCAhPT0gdGhpcy5fYXBpTWFuaWZlc3QucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9hcGlNYW5pZmVzdC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJzaG93XCIsXG4gICAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzQXBpTWFuaWZlc3RcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9hcGktbWFuaWZlc3QvY29udHJvbGxlci5qc1wiLFxuICAgICAgICBza2lwQ29udHJvbGxlckNvbm5lY3Rpb25zOiB0cnVlLFxuICAgICAgICBza2lwQWJpbGl0eVJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICB2aWV3UGF0aDogXCIuL2J1aWx0LWluL2FwaS1tYW5pZmVzdFwiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBtY3AuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IHtwYXRoPzogc3RyaW5nLCB0b2tlbj86IHN0cmluZ319IHZhbHVlIC0gTUNQIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBNQ1AgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVNY3AodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL21jcFwiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvbWNwXCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBtY3AgdG8gYmUgYSBib29sZWFuIG9yIG9iamVjdCwgZ290OiAke1N0cmluZyh2YWx1ZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gdmFsdWUucGF0aCB8fCBcIi9tY3BcIlxuXG4gICAgaWYgKHR5cGVvZiBwYXRoICE9PSBcInN0cmluZ1wiIHx8ICFwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG1jcC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBtY3AudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBtY3Agcm91dGUgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FkZE1jcFJvdXRlSG9vaygpIHtcbiAgICBpZiAoIXRoaXMuX21jcC5lbmFibGVkKSByZXR1cm5cblxuICAgIHRoaXMuYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gXCJQT1NUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX21jcC5wYXRoKSByZXR1cm4gbnVsbFxuXG4gICAgICAvLyBXaGVuIGEgdG9rZW4gaXMgY29uZmlndXJlZCwgYW4gdW5hdXRoZW50aWNhdGVkIHJlcXVlc3QgZ2V0cyBubyByb3V0ZSBhdFxuICAgICAgLy8gYWxsICg0MDQpIHJhdGhlciB0aGFuIGEgNDAxLCBzbyB0aGUgZW5kcG9pbnQncyBleGlzdGVuY2Ugc3RheXMgaGlkZGVuLlxuICAgICAgaWYgKHRoaXMuX21jcC50b2tlbiAmJiAhdGhpcy5kZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgdGhpcy5fbWNwLnRva2VuKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uOiBcImhhbmRsZVwiLFxuICAgICAgICBjb250cm9sbGVyOiBcInZlbG9jaW91c01jcFwiLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogXCIuL2J1aWx0LWluL21jcC9jb250cm9sbGVyLmpzXCIsXG4gICAgICAgIC8vIFRlbmFudCBhbmQgYWJpbGl0eSByZXNvbHV0aW9uIGJlbG9uZyB0byB0aGUgZnJvbnRlbmQtbW9kZWwgZGlzcGF0Y2hlclxuICAgICAgICAvLyBwZXIgY29tbWFuZCAod2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCksIGV4YWN0bHkgbGlrZSB0aGUgcmVndWxhclxuICAgICAgICAvLyAvZnJvbnRlbmQtbW9kZWxzIHJvdXRlIOKAlCB0aGUgTUNQIHRyYW5zcG9ydCBuZXZlciBieXBhc3NlcyB0aGVtLlxuICAgICAgICBza2lwQWJpbGl0eVJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICB2aWV3UGF0aDogXCIuL2J1aWx0LWluL21jcFwiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBkZWJ1ZyBlbmRwb2ludCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkRGVidWdFbmRwb2ludFJvdXRlSG9vaygpIHtcbiAgICBpZiAoIXRoaXMuX2RlYnVnRW5kcG9pbnQuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiR0VUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX2RlYnVnRW5kcG9pbnQucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgLy8gV2hlbiBhIHRva2VuIGlzIGNvbmZpZ3VyZWQsIGFuIHVuYXV0aGVudGljYXRlZCByZXF1ZXN0IGdldHMgbm8gcm91dGUgYXRcbiAgICAgIC8vIGFsbCAoNDA0KSByYXRoZXIgdGhhbiBhIDQwMSwgc28gdGhlIGVuZHBvaW50J3MgZXhpc3RlbmNlIHN0YXlzIGhpZGRlbi5cbiAgICAgIGlmICh0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uOiBcInNob3dcIixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNEZWJ1Z1wiLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogXCIuL2J1aWx0LWluL2RlYnVnL2NvbnRyb2xsZXIuanNcIixcbiAgICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uczogdHJ1ZSxcbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9kZWJ1Z1wiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdXRvbG9hZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyB0aGlzLl9hdXRvbG9hZCA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29ycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Db3JzVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgY29ycy5cbiAgICovXG4gIGdldENvcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGh0dHAgc2VydmVyIGNvbXByZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgYnVmZmVyZWQgcmVzcG9uc2UgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBTZXJ2ZXJDb21wcmVzc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy5odHRwU2VydmVyLmNvbXByZXNzaW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbWF4aW11bSBidWZmZXJlZCByZXNwb25zZSBib2R5IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgYnl0ZSBsaW1pdCwgb3IgdW5kZWZpbmVkIHdoZW4gdW5ib3VuZGVkLlxuICAgKi9cbiAgZ2V0SHR0cFNlcnZlck1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5tYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbWF4aW11bSByZXF1ZXN0IGJvZHkgYnl0ZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBieXRlIGxpbWl0LCBvciB1bmRlZmluZWQgd2hlbiB1bmJvdW5kZWQuXG4gICAqL1xuICBnZXRIdHRwU2VydmVyTWF4UmVxdWVzdEJvZHlCeXRlcygpIHtcbiAgICByZXR1cm4gdGhpcy5odHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyByZXF1ZXN0LWJvZHkgaGFuZGxpbmcgYWZ0ZXIgdGhlIHJlcXVlc3QgbGluZSBhbmQgaGVhZGVycyBhcmUgY29tcGxldGUsXG4gICAqIGJlZm9yZSBib2R5IGJ5dGVzIGFyZSByZXRhaW5lZCBvciBkZWNvZGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5IdHRwUmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlckFyZ3N9IGFyZ3MgLSBQYXJzZWQgcmVxdWVzdCBoZWFkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkSHR0cFJlcXVlc3RCb2R5UG9saWN5fSAtIEVmZmVjdGl2ZSByZXF1ZXN0IHBvbGljeS5cbiAgICovXG4gIHJlc29sdmVIdHRwUmVxdWVzdEJvZHlQb2xpY3koYXJncykge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5odHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJcbiAgICBjb25zdCBjb25maWd1cmVkUG9saWN5ID0gcmVzb2x2ZXIgPyByZXNvbHZlcihhcmdzKSA6IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkSHR0cFJlcXVlc3RCb2R5UG9saWN5fSAqL1xuICAgIGxldCByZXNvbHZlZFBvbGljeVxuXG4gICAgaWYgKGNvbmZpZ3VyZWRQb2xpY3kgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVzb2x2ZWRQb2xpY3kgPSB7bWF4UmVxdWVzdEJvZHlCeXRlczogdGhpcy5odHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXMsIG1vZGU6IFwicGFyc2VkXCJ9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghY29uZmlndXJlZFBvbGljeSB8fCB0eXBlb2YgY29uZmlndXJlZFBvbGljeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmZpZ3VyZWRQb2xpY3kpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgbXVzdCByZXR1cm4gYW4gb2JqZWN0IG9yIHVuZGVmaW5lZFwiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCB7bWF4UmVxdWVzdEJvZHlCeXRlcywgbW9kZSA9IFwicGFyc2VkXCIsIC4uLnJlc3RQb2xpY3l9ID0gY29uZmlndXJlZFBvbGljeVxuICAgICAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhyZXN0UG9saWN5KVxuXG4gICAgICBpZiAodW5rbm93bktleXMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgcmV0dXJuZWQgdW5rbm93biBrZXlzOiAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogbWF4UmVxdWVzdEJvZHlCeXRlcywgbW9kZSlgKVxuICAgICAgfVxuICAgICAgaWYgKG1vZGUgIT09IFwicGFyc2VkXCIgJiYgbW9kZSAhPT0gXCJyYXdcIikge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgbW9kZSBtdXN0IGJlIFwicGFyc2VkXCIgb3IgXCJyYXdcIiwgZ290OiAke1N0cmluZyhtb2RlKX1gKVxuICAgICAgfVxuXG4gICAgICByZXNvbHZlZFBvbGljeSA9IHtcbiAgICAgICAgbWF4UmVxdWVzdEJvZHlCeXRlczogbWF4UmVxdWVzdEJvZHlCeXRlcyA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyB0aGlzLmh0dHBTZXJ2ZXIubWF4UmVxdWVzdEJvZHlCeXRlc1xuICAgICAgICAgIDogb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKG1heFJlcXVlc3RCb2R5Qnl0ZXMsIFwiaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG1heFJlcXVlc3RCb2R5Qnl0ZXNcIiksXG4gICAgICAgIG1vZGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXBwbHlNY3BSZXF1ZXN0Qm9keVBvbGljeURlZmF1bHRzKHthcmdzLCBwb2xpY3k6IHJlc29sdmVkUG9saWN5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbmZvcmNlcyB0aGUgYnVpbHQtaW4gTUNQIGVuZHBvaW50J3MgYm9keSBjb250cmFjdCB3aXRob3V0IHBlci1hcHAgcGx1bWJpbmc6IHRoZVxuICAgKiBKU09OLVJQQyBlbnZlbG9wZSBpcyByZWFkIGZyb20gcGFyc2VkIHBhcmFtcywgc28gcmF3IG1vZGUgaXMgcmVqZWN0ZWQgd2l0aCBhblxuICAgKiBhY3Rpb25hYmxlIGVycm9yLCBhbmQgYSBmcmFtZXdvcmsgZGVmYXVsdCBieXRlIGNhcCBhcHBsaWVzIHdoZW4gdGhlIGFwcCBjb25maWd1cmVkIG5vbmUuXG4gICAqIEBwYXJhbSB7e2FyZ3M6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5IdHRwUmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlckFyZ3MsIHBvbGljeTogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkSHR0cFJlcXVlc3RCb2R5UG9saWN5fX0gb3B0aW9ucyAtIFJlc29sdXRpb24gaW5wdXRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkSHR0cFJlcXVlc3RCb2R5UG9saWN5fSAtIEVmZmVjdGl2ZSByZXF1ZXN0IHBvbGljeS5cbiAgICovXG4gIF9hcHBseU1jcFJlcXVlc3RCb2R5UG9saWN5RGVmYXVsdHMoe2FyZ3MsIHBvbGljeX0pIHtcbiAgICBpZiAoIXRoaXMuX21jcC5lbmFibGVkKSByZXR1cm4gcG9saWN5XG4gICAgaWYgKGFyZ3MuaHR0cE1ldGhvZCAhPT0gXCJQT1NUXCIpIHJldHVybiBwb2xpY3lcbiAgICBpZiAoYXJncy5wYXRoLnNwbGl0KFwiP1wiKVswXSAhPT0gdGhpcy5fbWNwLnBhdGgpIHJldHVybiBwb2xpY3lcblxuICAgIGlmIChwb2xpY3kubW9kZSA9PT0gXCJyYXdcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgYFRoZSBidWlsdC1pbiBNQ1AgZW5kcG9pbnQgYXQgJHt0aGlzLl9tY3AucGF0aH0gcmVxdWlyZXMgcGFyc2VkIHJlcXVlc3QgYm9kaWVzIGJlY2F1c2UgaXRzIEpTT04tUlBDIGVudmVsb3BlIGlzIHJlYWQgZnJvbSBwYXJhbXMuIFJlbW92ZSB0aGUgcmF3LW1vZGUgaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIGVudHJ5IGZvciB0aGlzIHBhdGguYFxuICAgICAgKVxuICAgIH1cblxuICAgIGlmIChwb2xpY3kubWF4UmVxdWVzdEJvZHlCeXRlcyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gcG9saWN5XG5cbiAgICByZXR1cm4ge21heFJlcXVlc3RCb2R5Qnl0ZXM6IERFRkFVTFRfTUNQX01BWF9SRVFVRVNUX0JPRFlfQllURVMsIG1vZGU6IHBvbGljeS5tb2RlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvb2tpZSBzZWNyZXQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29va2llIHNlY3JldC5cbiAgICovXG4gIGdldENvb2tpZVNlY3JldCgpIHtcbiAgICByZXR1cm4gdGhpcy5fY29va2llU2VjcmV0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9ufSAtIFN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldFN5bmNDb25maWd1cmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9zeW5jXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IG9mZmxpbmUgZ3JhbnQgc2lnbmluZyBrZXkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5PZmZsaW5lR3JhbnRTaWduaW5nS2V5fSAtIEN1cnJlbnQgc2lnbmluZyBrZXkuXG4gICAqL1xuICBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleSgpIHtcbiAgICBjb25zdCBzaWduaW5nS2V5cyA9IHRoaXMuZ2V0U3luY0NvbmZpZ3VyYXRpb24oKS5vZmZsaW5lR3JhbnRTaWduaW5nS2V5c1xuXG4gICAgcmV0dXJuIGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5KHNpZ25pbmdLZXlzKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gc3luYyAtIFN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ29uZmlndXJhdGlvbihzeW5jKSB7XG4gICAgY29uc3QgYXBpID0gc3luYz8uYXBpXG4gICAgY29uc3QgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5ID0gc3luYz8uZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5IHx8IG51bGxcbiAgICBjb25zdCBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSA9IHN5bmM/LmNoYW5nZUZlZWRSZXRlbnRpb25TaXplXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50U2lnbmluZ0tleXMgPSBzeW5jPy5vZmZsaW5lR3JhbnRTaWduaW5nS2V5cyB8fCBbXVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudFR0bE1zID0gc3luYz8ub2ZmbGluZUdyYW50VHRsTXNcblxuICAgIGlmIChkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgIT09IG51bGwgJiYgKHR5cGVvZiBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgbXVzdCBiZSBhIHB1YmxpYyBKU09OIFdlYiBLZXkgb2JqZWN0XCIpXG4gICAgfVxuICAgIGlmIChjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSkgfHwgY2hhbmdlRmVlZFJldGVudGlvblNpemUgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2hhbmdlRmVlZFJldGVudGlvblNpemUgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJcIilcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzKSkgdGhyb3cgbmV3IEVycm9yKFwic3luYy5vZmZsaW5lR3JhbnRTaWduaW5nS2V5cyBtdXN0IGJlIGFuIGFycmF5XCIpXG4gICAgaWYgKG9mZmxpbmVHcmFudFR0bE1zICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKG9mZmxpbmVHcmFudFR0bE1zKSB8fCBvZmZsaW5lR3JhbnRUdGxNcyA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5vZmZsaW5lR3JhbnRUdGxNcyBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlciBudW1iZXIgb2YgbWlsbGlzZWNvbmRzXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFwaTogdGhpcy5fbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSxcbiAgICAgIGNoYW5nZUZlZWRSZXRlbnRpb25TaXplOiBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSB8fCAxMDAwMCxcbiAgICAgIGNsaWVudDogdGhpcy5fbm9ybWFsaXplU3luY0NsaWVudENvbmZpZ3VyYXRpb24oc3luYz8uY2xpZW50KSxcbiAgICAgIGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSxcbiAgICAgIG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzOiBvZmZsaW5lR3JhbnRTaWduaW5nS2V5cy5tYXAoKGtleSkgPT4gbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleShrZXkpKSxcbiAgICAgIG9mZmxpbmVHcmFudFR0bE1zOiBvZmZsaW5lR3JhbnRUdGxNcyB8fCAyNCAqIDYwICogNjAgKiAxMDAwXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgY2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uIGNvbnN1bWVkIGJ5IGBTeW5jQ2xpZW50LmZyb21Db25maWd1cmF0aW9uKC4uLilgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gY2xpZW50IC0gQ2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRWZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIGNsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ2xpZW50Q29uZmlndXJhdGlvbihjbGllbnQpIHtcbiAgICBpZiAoY2xpZW50ID09PSB1bmRlZmluZWQgfHwgY2xpZW50ID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIGNsaWVudCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNsaWVudCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50IG11c3QgYmUgYW4gb2JqZWN0IHdpdGggdHJhbnNwb3J0IGFuZCBhdXRoZW50aWNhdGlvblRva2VuXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge2F1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgaXNPbmxpbmUsIG1vdW50UGF0aCwgb25FcnJvciwgb2ZmbGluZSwgcmVhbHRpbWUsIHRyYW5zcG9ydCwgd2Vic29ja2V0Q2xpZW50LCB3ZWJzb2NrZXRVcmwsIC4uLnJlc3RDbGllbnR9ID0gY2xpZW50XG4gICAgY29uc3QgcmVzdENsaWVudEtleXMgPSBPYmplY3Qua2V5cyhyZXN0Q2xpZW50KVxuXG4gICAgaWYgKHJlc3RDbGllbnRLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RDbGllbnRLZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBpc09ubGluZSwgbW91bnRQYXRoLCBvbkVycm9yLCBvZmZsaW5lLCByZWFsdGltZSwgdHJhbnNwb3J0LCB3ZWJzb2NrZXRDbGllbnQsIHdlYnNvY2tldFVybClgKVxuICAgIH1cbiAgICBpZiAoIXRyYW5zcG9ydCB8fCB0eXBlb2YgdHJhbnNwb3J0ICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiB0cmFuc3BvcnQucG9zdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC50cmFuc3BvcnQgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBhIHBvc3QocGF0aCwgYm9keSkgbWV0aG9kIChsaWtlIHRoZSBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2xpZW50KVwiKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGF1dGhlbnRpY2F0aW9uVG9rZW4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYXV0aGVudGljYXRpb25Ub2tlbiBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIHRoZSBhdXRoIHRva2VuIHNlbnQgd2l0aCBzeW5jIHJlcXVlc3RzXCIpXG4gICAgfVxuICAgIGlmIChpc09ubGluZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBpc09ubGluZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5pc09ubGluZSBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIGNvbm5lY3Rpdml0eVwiKVxuICAgIH1cbiAgICBpZiAob25FcnJvciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvbkVycm9yICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9uRXJyb3IgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlcG9ydGluZyBiYWNrZ3JvdW5kIHN5bmMgZmFpbHVyZXNcIilcbiAgICB9XG4gICAgaWYgKGJhdGNoU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihiYXRjaFNpemUpIHx8IGJhdGNoU2l6ZSA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYmF0Y2hTaXplIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyXCIpXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuICAgIGlmICh3ZWJzb2NrZXRDbGllbnQgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHdlYnNvY2tldENsaWVudCAhPT0gXCJvYmplY3RcIiB8fCB3ZWJzb2NrZXRDbGllbnQgPT09IG51bGwgfHwgdHlwZW9mIHdlYnNvY2tldENsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC53ZWJzb2NrZXRDbGllbnQgbXVzdCBiZSBhIHdlYnNvY2tldCBjbGllbnQgd2l0aCBhIHN1YnNjcmliZUNoYW5uZWwgbWV0aG9kIChsaWtlIFZlbG9jaW91c1dlYnNvY2tldENsaWVudClcIilcbiAgICB9XG4gICAgaWYgKHdlYnNvY2tldFVybCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB3ZWJzb2NrZXRVcmwgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHdlYnNvY2tldFVybCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50LndlYnNvY2tldFVybCBtdXN0IGJlIGEgVVJMIHN0cmluZyBvciBhIGZ1bmN0aW9uIHJlc29sdmluZyBvbmUsIGdvdDogJHtTdHJpbmcod2Vic29ja2V0VXJsKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplLFxuICAgICAgaXNPbmxpbmUsXG4gICAgICBtb3VudFBhdGg6IChtb3VudFBhdGggfHwgXCIvdmVsb2Npb3VzL3N5bmNcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCIsXG4gICAgICBvZmZsaW5lOiB0aGlzLl9ub3JtYWxpemVTeW5jQ2xpZW50T2ZmbGluZUNvbmZpZ3VyYXRpb24ob2ZmbGluZSksXG4gICAgICBvbkVycm9yLFxuICAgICAgcmVhbHRpbWUsXG4gICAgICB0cmFuc3BvcnQsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQsXG4gICAgICB3ZWJzb2NrZXRVcmxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyB0aGUgY2xpZW50LXNpZGUgbG9uZy1vZmZsaW5lIHNlc3Npb24gY29uZmlndXJhdGlvbiBjb25zdW1lZCBieVxuICAgKiBgU3luY0NsaWVudC5zdGFydE9mZmxpbmVTZXNzaW9uKClgLiBUaGUgZnJhbWV3b3JrIG93bnMgdGhlIHNlc3Npb25cbiAgICogbGlmZWN5Y2xlOyB0aGUgYXBwIHByb3ZpZGVzIGR1cmFibGUgaWRlbnRpdHkgc3RvcmFnZSwgdGhlIGVucm9sbG1lbnQgaG9vayxcbiAgICogYW5kIHRoZSBncmFudCBzY29wZXMgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRPZmZsaW5lQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gb2ZmbGluZSAtIE9mZmxpbmUgY29uZmlndXJhdGlvbiBibG9jay5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkVmVsb2Npb3VzU3luY0NsaWVudE9mZmxpbmVDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgb2ZmbGluZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNDbGllbnRPZmZsaW5lQ29uZmlndXJhdGlvbihvZmZsaW5lKSB7XG4gICAgaWYgKG9mZmxpbmUgPT09IHVuZGVmaW5lZCB8fCBvZmZsaW5lID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIG9mZmxpbmUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShvZmZsaW5lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGRldmljZUlkZW50aXR5U3RvcmFnZSwgZW5yb2xsRGV2aWNlLCBhbmQgZ3JhbnRTY29wZXNcIilcbiAgICB9XG5cbiAgICBjb25zdCB7YmFja2VuZFB1YmxpY0tleSwgYm9vdHN0cmFwUGF0aCwgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLCBlbnJvbGxEZXZpY2UsIGdyYW50U2NvcGVzLCBncmFudFN0b3JhZ2UsIG11dGF0aW9uTG9nLCBub3csIHJlcGxheVBhdGgsIC4uLnJlc3RPZmZsaW5lfSA9IG9mZmxpbmVcbiAgICBjb25zdCByZXN0T2ZmbGluZUtleXMgPSBPYmplY3Qua2V5cyhyZXN0T2ZmbGluZSlcblxuICAgIGlmIChyZXN0T2ZmbGluZUtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5vZmZsaW5lIHJlY2VpdmVkIHVua25vd24ga2V5czogJHtyZXN0T2ZmbGluZUtleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBiYWNrZW5kUHVibGljS2V5LCBib290c3RyYXBQYXRoLCBkZXZpY2VJZGVudGl0eVN0b3JhZ2UsIGVucm9sbERldmljZSwgZ3JhbnRTY29wZXMsIGdyYW50U3RvcmFnZSwgbXV0YXRpb25Mb2csIG5vdywgcmVwbGF5UGF0aClgKVxuICAgIH1cbiAgICBpZiAoIWRldmljZUlkZW50aXR5U3RvcmFnZSB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGV2aWNlSWRlbnRpdHlTdG9yYWdlKSB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLmxvYWQgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLnNhdmUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5kZXZpY2VJZGVudGl0eVN0b3JhZ2UgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBsb2FkKCkgYW5kIHNhdmUoaWRlbnRpdHkpIG1ldGhvZHNcIilcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBlbnJvbGxEZXZpY2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5lbnJvbGxEZXZpY2UgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgYmFja2VuZC1zaWduZWQgZGV2aWNlIGNlcnRpZmljYXRlXCIpXG4gICAgaWYgKHR5cGVvZiBncmFudFNjb3BlcyAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmdyYW50U2NvcGVzIG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgdGhlIGJvb3RzdHJhcCBncmFudCBzY29wZXNcIilcbiAgICBpZiAoYmFja2VuZFB1YmxpY0tleSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgYmFja2VuZFB1YmxpY0tleSAhPT0gXCJvYmplY3RcIiB8fCBiYWNrZW5kUHVibGljS2V5ID09PSBudWxsIHx8IEFycmF5LmlzQXJyYXkoYmFja2VuZFB1YmxpY0tleSkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmJhY2tlbmRQdWJsaWNLZXkgbXVzdCBiZSBhIHB1YmxpYyBKU09OIFdlYiBLZXkgb2JqZWN0XCIpXG4gICAgfVxuICAgIGlmIChib290c3RyYXBQYXRoICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBib290c3RyYXBQYXRoICE9PSBcInN0cmluZ1wiIHx8ICFib290c3RyYXBQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5vZmZsaW5lLmJvb3RzdHJhcFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhib290c3RyYXBQYXRoKX1gKVxuICAgIH1cbiAgICBpZiAocmVwbGF5UGF0aCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgcmVwbGF5UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcmVwbGF5UGF0aC5zdGFydHNXaXRoKFwiL1wiKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQub2ZmbGluZS5yZXBsYXlQYXRoIG11c3Qgc3RhcnQgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocmVwbGF5UGF0aCl9YClcbiAgICB9XG4gICAgaWYgKGdyYW50U3RvcmFnZSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgZ3JhbnRTdG9yYWdlICE9PSBcIm9iamVjdFwiIHx8IGdyYW50U3RvcmFnZSA9PT0gbnVsbCB8fCBBcnJheS5pc0FycmF5KGdyYW50U3RvcmFnZSkgfHwgdHlwZW9mIGdyYW50U3RvcmFnZS5sb2FkICE9PSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIGdyYW50U3RvcmFnZS5zYXZlICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmdyYW50U3RvcmFnZSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGxvYWQoKSBhbmQgc2F2ZShncmFudHMpIG1ldGhvZHNcIilcbiAgICB9XG4gICAgaWYgKG11dGF0aW9uTG9nICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtdXRhdGlvbkxvZyAhPT0gXCJvYmplY3RcIiB8fCBtdXRhdGlvbkxvZyA9PT0gbnVsbCB8fCB0eXBlb2YgbXV0YXRpb25Mb2cuYXBwZW5kICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLm11dGF0aW9uTG9nIG11c3QgYmUgYSBMb2NhbE11dGF0aW9uTG9nXCIpXG4gICAgfVxuICAgIGlmIChub3cgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygbm93ICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9mZmxpbmUubm93IG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgdGhlIHNlc3Npb24gY2xvY2tcIilcblxuICAgIHJldHVybiB7XG4gICAgICBiYWNrZW5kUHVibGljS2V5LFxuICAgICAgYm9vdHN0cmFwUGF0aDogKGJvb3RzdHJhcFBhdGggfHwgXCIvZnJvbnRlbmQtbW9kZWxzL3N5bmMvYm9vdHN0cmFwXCIpLnJlcGxhY2UoL1xcLyskL3UsIFwiXCIpIHx8IFwiL1wiLFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRldmljZUlkZW50aXR5U3RvcmFnZSxcbiAgICAgIGVucm9sbERldmljZSxcbiAgICAgIGdyYW50U2NvcGVzLFxuICAgICAgZ3JhbnRTdG9yYWdlLFxuICAgICAgbXV0YXRpb25Mb2csXG4gICAgICBub3c6IG5vdyB8fCAoKCkgPT4gbmV3IERhdGUoKSksXG4gICAgICByZXBsYXlQYXRoOiAocmVwbGF5UGF0aCB8fCBcIi9mcm9udGVuZC1tb2RlbHMvc3luYy9yZXBsYXlcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIEFQSSBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gYXBpIC0gU3luYyBBUEkgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHN5bmMgQVBJIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSB7XG4gICAgaWYgKGFwaSA9PT0gdW5kZWZpbmVkIHx8IGFwaSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgaWYgKHR5cGVvZiBhcGkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhcGkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmFwaSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGEgcmVzb3VyY2VDbGFzc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9ID0gYXBpXG5cbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzIG11c3QgYmUgYSByZXNvdXJjZSBjbGFzcywgZ290OiAke1N0cmluZyhyZXNvdXJjZUNsYXNzKX1gKVxuICAgIH1cbiAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzICR7cmVzb3VyY2VDbGFzcy5uYW1lfSBtdXN0IGRlZmluZSBzdGF0aWMgTW9kZWxDbGFzc2ApXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlPn0gLSBUaGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2UpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgIGlmICghdGhpcy5kYXRhYmFzZVt0aGlzLmdldEVudmlyb25tZW50KCldKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gZm9yIGVudmlyb25tZW50OiAke3RoaXMuZ2V0RW52aXJvbm1lbnQoKX0gLSAke09iamVjdC5rZXlzKHRoaXMuZGF0YWJhc2UpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YWJhc2VcIiwgdGhpcy5nZXRFbnZpcm9ubWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgdGhlIGlkZW50aWZpZXIuXG4gICAqL1xuICByZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIsIHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpKSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVtpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBkYXRhYmFzZSBpZGVudGlmaWVyIGNvbmZpZ3VyZWQ6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGlmICh0ZW5hbnQgPT09IHVuZGVmaW5lZCB8fCAhdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcikge1xuICAgICAgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuICAgIH1cblxuICAgIGNvbnN0IG92ZXJyaWRlQ29uZmlndXJhdGlvbiA9IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgIGlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuXG4gICAgcmV0dXJuIG1lcmdlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3ZlcnJpZGVDb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpc2FibGVkIGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRGlzYWJsZWQgZGF0YWJhc2UgaWRlbnRpZmllcnMgZnJvbSBlbnYgZmxhZ3MuXG4gICAqL1xuICBnZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVycyA9IG5ldyBTZXQoKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnNSYXcgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRElTQUJMRURfREFUQUJBU0VfSURFTlRJRklFUlNcblxuICAgIGlmIChkaXNhYmxlZElkZW50aWZpZXJzUmF3KSB7XG4gICAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGlzYWJsZWRJZGVudGlmaWVyc1Jhdy5zcGxpdChcIixcIikpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGlkZW50aWZpZXIudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIGRpc2FibGVkSWRlbnRpZmllcnMuYWRkKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHByb2Nlc3MuZW52LlZFTE9DSU9VU19ESVNBQkxFX01TU1FMID09PSBcIjFcIikge1xuICAgICAgZGlzYWJsZWRJZGVudGlmaWVycy5hZGQoXCJtc3NxbFwiKVxuICAgIH1cblxuICAgIHJldHVybiBkaXNhYmxlZElkZW50aWZpZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBpZGVudGlmaWVyIGFjdGl2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGRhdGFiYXNlIGlkZW50aWZpZXIgaXMgYWN0aXZlIGluIHRoZSBjdXJyZW50IHRlbmFudCBjb250ZXh0LlxuICAgKi9cbiAgaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllciwgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KCkpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIGRhdGFiYXNlIGlkZW50aWZpZXIgY29uZmlndXJlZDogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkgcmV0dXJuIHRydWVcbiAgICBpZiAodGVuYW50ID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3Qgb3ZlcnJpZGVDb25maWd1cmF0aW9uID0gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgaWRlbnRpZmllcixcbiAgICAgIHRlbmFudFxuICAgIH0pXG5cbiAgICByZXR1cm4gQm9vbGVhbihvdmVycmlkZUNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyh0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnMgPSB0aGlzLmdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpXG5cbiAgICByZXR1cm4gaWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiAhZGlzYWJsZWRJZGVudGlmaWVycy5oYXMoaWRlbnRpZmllcikgJiYgdGhpcy5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBIdW1hbi1yZWFkYWJsZSBzZXJ2ZXIgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBhc3luYyBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGxvY2FsU25hcHNob3QgPSB0aGlzLmdldExvY2FsRGVidWdTbmFwc2hvdCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ubG9jYWxTbmFwc2hvdCxcbiAgICAgIGh0dHBTZXJ2ZXI6IGF3YWl0IHRoaXMuX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWwgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gSHVtYW4tcmVhZGFibGUgZGlhZ25vc3RpY3MgZm9yIHRoaXMgcHJvY2VzcyBvbmx5LlxuICAgKi9cbiAgZ2V0TG9jYWxEZWJ1Z1NuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBiYWNrZ3JvdW5kSm9iczogdGhpcy5fZGVidWdCYWNrZ3JvdW5kSm9ic1NuYXBzaG90KCksXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9kZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpLFxuICAgICAgZGF0YWJhc2U6IHRoaXMuX2RlYnVnRGF0YWJhc2VTbmFwc2hvdCgpLFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHNlcnZlcjogdGhpcy5fZGVidWdTZXJ2ZXJTbmFwc2hvdCgpLFxuICAgICAgd2Vic29ja2V0czogdGhpcy5fZGVidWdXZWJzb2NrZXRTbmFwc2hvdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgaHR0cCBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gSFRUUCBzZXJ2ZXIgd29ya2VyIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgYXN5bmMgX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KCkge1xuICAgIGNvbnN0IGh0dHBTZXJ2ZXIgPSAvKiogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90PzogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSlcblxuICAgIGlmICghaHR0cFNlcnZlcj8uZ2V0RGVidWdTbmFwc2hvdCkge1xuICAgICAgcmV0dXJuIHtjb25maWd1cmVkOiBCb29sZWFuKHRoaXMuaHR0cFNlcnZlciksIGFjdGl2ZTogZmFsc2V9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IGh0dHBTZXJ2ZXIuZ2V0RGVidWdTbmFwc2hvdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2VydmVyIHJ1bnRpbWUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdTZXJ2ZXJTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBub2RlUHJvY2VzcyA9IHR5cGVvZiBwcm9jZXNzID09PSBcInVuZGVmaW5lZFwiID8gdW5kZWZpbmVkIDogcHJvY2Vzc1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmdldEVudmlyb25tZW50KCksXG4gICAgICBtZW1vcnlVc2FnZTogbm9kZVByb2Nlc3MgPyBub2RlUHJvY2Vzcy5tZW1vcnlVc2FnZSgpIDogdW5kZWZpbmVkLFxuICAgICAgbm9kZVZlcnNpb246IG5vZGVQcm9jZXNzPy52ZXJzaW9ucz8ubm9kZSxcbiAgICAgIHBpZDogbm9kZVByb2Nlc3M/LnBpZCxcbiAgICAgIHBsYXRmb3JtOiBub2RlUHJvY2Vzcz8ucGxhdGZvcm0sXG4gICAgICB1cHRpbWVTZWNvbmRzOiBub2RlUHJvY2VzcyA/IG5vZGVQcm9jZXNzLnVwdGltZSgpIDogdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgY29uZmlndXJhdGlvbiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb25maWd1cmF0aW9uIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnQ29uZmlndXJhdGlvblNuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBhcGlNYW5pZmVzdDogdGhpcy5fYXBpTWFuaWZlc3RFbmFibGVkKCkgPyB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogdGhpcy5fYXBpTWFuaWZlc3QucGF0aCwgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuKX0gOiB7ZW5hYmxlZDogZmFsc2V9LFxuICAgICAgYXV0b2xvYWQ6IHRoaXMuZ2V0QXV0b2xvYWQoKSxcbiAgICAgIGRlYnVnOiB0aGlzLmRlYnVnID09PSB0cnVlLFxuICAgICAgZGVidWdFbmRwb2ludDogdGhpcy5fZGVidWdFbmRwb2ludFNuYXBzaG90KCksXG4gICAgICBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IHRoaXMuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCksXG4gICAgICBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50czogdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpLFxuICAgICAgaW5pdGlhbGl6ZWQ6IHRoaXMuX2lzSW5pdGlhbGl6ZWQsXG4gICAgICBtY3A6IHRoaXMuX21jcC5lbmFibGVkID8ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IHRoaXMuX21jcC5wYXRoLCB0b2tlbkNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fbWNwLnRva2VuKX0gOiB7ZW5hYmxlZDogZmFsc2V9LFxuICAgICAgbG9nZ2luZzoge1xuICAgICAgICBkZWJ1Z0xvd0xldmVsOiB0aGlzLl9sb2dnaW5nPy5kZWJ1Z0xvd0xldmVsID09PSB0cnVlLFxuICAgICAgICBvdXRwdXRzOiB0aGlzLl9sb2dnaW5nID8gT2JqZWN0LmtleXModGhpcy5fbG9nZ2luZykgOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGJhY2tncm91bmQgam9icyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBCYWNrZ3JvdW5kIGpvYiBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0JhY2tncm91bmRKb2JzU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fYmFja2dyb3VuZEpvYnMpLFxuICAgICAgc2NoZWR1bGVkQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBkYXRhYmFzZSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0RhdGFiYXNlU25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogRGF0YWJhc2UgcG9vbHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLkRhdGFiYXNlUG9vbERlYnVnU25hcHNob3Q+fSAqL1xuICAgIGNvbnN0IGRhdGFiYXNlUG9vbHMgPSB7fVxuICAgIGNvbnN0IGFjdGl2ZUlkZW50aWZpZXJzID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBhY3RpdmVJZGVudGlmaWVycykge1xuICAgICAgZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmdldERlYnVnU25hcHNob3QoKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhY3RpdmVJZGVudGlmaWVycyxcbiAgICAgIGRpc2FibGVkSWRlbnRpZmllcnM6IEFycmF5LmZyb20odGhpcy5nZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSksXG4gICAgICBpbml0aWFsaXplZFBvb2xzOiBPYmplY3Qua2V5cyh0aGlzLmRhdGFiYXNlUG9vbHMpLFxuICAgICAgcG9vbHM6IGRhdGFiYXNlUG9vbHNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyB3ZWJzb2NrZXQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2ViU29ja2V0IGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnV2Vic29ja2V0U25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBidWNrZXRzLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y291bnQ6IG51bWJlciwgZGV0YWlsczoge2NoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogbnVtYmVyLCBjaGFubmVsU3Vic2NyaXB0aW9uczoge2NoYW5uZWxUeXBlOiBzdHJpbmcsIGNvdW50OiBudW1iZXIsIG1vZGVsOiBzdHJpbmcgfCBudWxsfVtdLCBjb25uZWN0aW9uQ291bnQ6IG51bWJlciwgcGF1c2VkOiBib29sZWFuLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfX0+fSAqL1xuICAgIGNvbnN0IHNlc3Npb25CdWNrZXRzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBkZXRhaWxzLlxuICAgICAqIEB0eXBlIHt7Y2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXIsIGNoYW5uZWxTdWJzY3JpcHRpb25zOiB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9W10sIGNvbm5lY3Rpb25Db3VudDogbnVtYmVyLCBwYXVzZWQ6IGJvb2xlYW4sIHF1ZXVlZE1lc3NhZ2VDb3VudDogbnVtYmVyLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IHNlc3Npb25EZXRhaWxzID0gW11cbiAgICBjb25zdCBzdWJzY3JpcHRpb25zID0gQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5lbnRyaWVzKCkpLm1hcCgoW2NoYW5uZWwsIGNoYW5uZWxTdWJzY3JpcHRpb25zXSkgPT4ge1xuICAgICAgLyoqXG4gICAgICAgKiBEZXRhaWxzIGJ1Y2tldHMuXG4gICAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2NvdW50OiBudW1iZXIsIGRldGFpbHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgICAgY29uc3QgZGV0YWlsc0J1Y2tldHMgPSBuZXcgTWFwKClcblxuICAgICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgY2hhbm5lbFN1YnNjcmlwdGlvbnMpIHtcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpKVxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShkZXRhaWxzKVxuICAgICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IGRldGFpbHNCdWNrZXRzLmdldChrZXkpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRldGFpbHNCdWNrZXRzLnNldChrZXksIHtjb3VudDogMSwgZGV0YWlsc30pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgY291bnQ6IGNoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGRldGFpbHM6IEFycmF5LmZyb20oZGV0YWlsc0J1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IHNlc3Npb24gb2YgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogQ2hhbm5lbCBzdWJzY3JpcHRpb24gYnVja2V0cy5cbiAgICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9Pn0gKi9cbiAgICAgIGNvbnN0IGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzID0gbmV3IE1hcCgpXG5cbiAgICAgIGZvciAoY29uc3Qge2NoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb259IG9mIHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICAgIGNvbnN0IGRldGFpbHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpXG4gICAgICAgIGNvbnN0IG1vZGVsID0gdHlwZW9mIGRldGFpbHMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBkZXRhaWxzLm1vZGVsIDogbnVsbFxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeSh7Y2hhbm5lbFR5cGUsIG1vZGVsfSlcbiAgICAgICAgY29uc3QgZXhpc3RpbmdCdWNrZXQgPSBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5nZXQoa2V5KVxuXG4gICAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5zZXQoa2V5LCB7Y2hhbm5lbFR5cGUsIGNvdW50OiAxLCBtb2RlbH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBBcnJheS5mcm9tKGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudClcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0ge1xuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNlc3Npb24uX2Nvbm5lY3Rpb25zLnNpemUsXG4gICAgICAgIHBhdXNlZDogc2Vzc2lvbi5fcGF1c2VkLFxuICAgICAgICBxdWV1ZWRNZXNzYWdlQ291bnQ6IHNlc3Npb24uX291dGJvdW5kUXVldWUubGVuZ3RoLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc2Vzc2lvbi5zdWJzY3JpcHRpb25zLnNpemVcbiAgICAgIH1cbiAgICAgIGNvbnN0IGJ1Y2tldEtleSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zOiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgY29ubmVjdGlvbkNvdW50OiBzbmFwc2hvdC5jb25uZWN0aW9uQ291bnQsXG4gICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc25hcHNob3Quc3Vic2NyaXB0aW9uQ291bnRcbiAgICAgIH0pXG4gICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IHNlc3Npb25CdWNrZXRzLmdldChidWNrZXRLZXkpXG5cbiAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXNzaW9uQnVja2V0cy5zZXQoYnVja2V0S2V5LCB7XG4gICAgICAgICAgY291bnQ6IDEsXG4gICAgICAgICAgZGV0YWlsczoge1xuICAgICAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uczogc25hcHNob3QuY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNuYXBzaG90LmNvbm5lY3Rpb25Db3VudCxcbiAgICAgICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LnN1YnNjcmlwdGlvbkNvdW50XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgc2Vzc2lvbkRldGFpbHMucHVzaChzbmFwc2hvdClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgbGl2ZU9ubHlDaGFubmVsczogQXJyYXkuZnJvbSh0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzKSxcbiAgICAgIHBhdXNlZFNlc3Npb25zOiB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5zaXplLFxuICAgICAgcmVnaXN0ZXJlZENoYW5uZWxzOiBBcnJheS5mcm9tKHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzLmtleXMoKSksXG4gICAgICByZWdpc3RlcmVkQ29ubmVjdGlvbnM6IEFycmF5LmZyb20odGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMua2V5cygpKSxcbiAgICAgIHNlc3Npb25CdWNrZXRzOiBBcnJheS5mcm9tKHNlc3Npb25CdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudCksXG4gICAgICBzZXNzaW9uQ291bnQ6IHRoaXMuX3dlYnNvY2tldFNlc3Npb25zLnNpemUsXG4gICAgICBzZXNzaW9uczogc2Vzc2lvbkRldGFpbHMuc29ydCgoYSwgYikgPT4gYi5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQgLSBhLmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCksXG4gICAgICBzdWJzY3JpcHRpb25Hcm91cHM6IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICBzdWJzY3JpcHRpb25zXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGRhdGFiYXNlIHBvb2wuXG4gICAqL1xuICBnZXREYXRhYmFzZVBvb2woaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgaWYgKCF0aGlzLmlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoaWRlbnRpZmllcikpIHtcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZURhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuICAgIH1cblxuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YWJhc2VQb29sc1wiLCBpZGVudGlmaWVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZyYW1ld29yay1vd25lZCBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGxpZmVjeWNsZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlfSAtIExpZmVjeWNsZSBvd25lci5cbiAgICovXG4gIGdldEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlKCkgeyByZXR1cm4gdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhZmUgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGVbXCJpbnNwZWN0QWxsXCJdPn0gLSBMaWZlY3ljbGUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBpbnNwZWN0RnJvbnRlbmRUZW5hbnRTcWxpdGVIYW5kbGVzKCkgeyByZXR1cm4gdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUuaW5zcGVjdEFsbCgpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9KVxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGlkZW50aWZpZXIpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBzY2hlbWEgbWV0YWRhdGEgY2FjaGVkIGJ5IGV2ZXJ5IGluaXRpYWxpemVkIHBvb2wgdGhhdCB0YXJnZXRzIHRoZVxuICAgKiBzYW1lIHBoeXNpY2FsIGRhdGFiYXNlIChtYXRjaGVkIGJ5IGNvbm5lY3Rpb24gcmV1c2Uga2V5KS4gU2VwYXJhdGUgcG9vbHMgdGhhdFxuICAgKiBwb2ludCBhdCBvbmUgZGF0YWJhc2Uga2VlcCBpbmRlcGVuZGVudCBzY2hlbWEgY2FjaGVzLCBzbyBEREwgcnVuIHRocm91Z2ggb25lXG4gICAqIHBvb2wgd291bGQgb3RoZXJ3aXNlIGxlYXZlIHRoZSBvdGhlcnMgcmVwb3J0aW5nIHN0YWxlIHRhYmxlcy9jb2x1bW5zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBDb25uZWN0aW9uIHJldXNlIGtleSBpZGVudGlmeWluZyB0aGUgc2hhcmVkIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjbGVhclNjaGVtYUNhY2hlc0ZvclJldXNlS2V5KHJldXNlS2V5KSB7XG4gICAgdGhpcy5fc2NoZW1hQ2FjaGVHZW5lcmF0aW9uc0J5UmV1c2VLZXkuc2V0KFxuICAgICAgcmV1c2VLZXksXG4gICAgICB0aGlzLnNjaGVtYUNhY2hlR2VuZXJhdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KSArIDFcbiAgICApXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoKSA9PT0gcmV1c2VLZXkpIHtcbiAgICAgICAgcG9vbC5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3VycmVudCBzY2hlbWEtY2FjaGUgZ2VuZXJhdGlvbiBmb3Igb25lIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBDb25uZWN0aW9uIHJldXNlIGtleSBpZGVudGlmeWluZyB0aGUgc2hhcmVkIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEN1cnJlbnQgc2NoZW1hLWNhY2hlIGdlbmVyYXRpb24uXG4gICAqL1xuICBzY2hlbWFDYWNoZUdlbmVyYXRpb25Gb3JSZXVzZUtleShyZXVzZUtleSkge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb25zQnlSZXVzZUtleS5nZXQocmV1c2VLZXkpIHx8IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnZhbGlkYXRlcyByZWNvcmQgbWV0YWRhdGEgb3duZWQgYnkgb25lIGNsb3NlZC9kZWxldGVkIHBoeXNpY2FsIHRlbmFudFxuICAgKiBkYXRhYmFzZSB3aGlsZSBwcmVzZXJ2aW5nIGV2ZXJ5IG90aGVyIHRlbmFudCBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIExvZ2ljYWwgaWRlbnRpZmllciBwbHVzIHBvb2wgcmV1c2Uga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyUmVjb3JkTWV0YWRhdGFGb3JEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLm1vZGVsQ2xhc3NlcykpIHtcbiAgICAgIG1vZGVsQ2xhc3MuY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlc0ZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgcG9vbCB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZGF0YWJhc2UgcG9vbCB0eXBlLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VQb29sVHlwZShpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBjb25zdCBwb29sVHlwZUNsYXNzID0gZGlnZyh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKSwgXCJwb29sVHlwZVwiKVxuXG4gICAgaWYgKCFwb29sVHlwZUNsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBwb29sVHlwZSBnaXZlbiBpbiBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucmVzb2x2ZVRlc3RTaGFyZWRUcmFuc2FjdGlvblBvb2xUeXBlKHtcbiAgICAgIGNvbmZpZ3VyZWRQb29sVHlwZTogcG9vbFR5cGVDbGFzcyxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogaWRlbnRpZmllclxuICAgIH0pXG4gIH1cblxuICBnZXREYXRhYmFzZVR5cGUoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgY29uc3QgZGF0YWJhc2VUeXBlID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllcikudHlwZVxuXG4gICAgaWYgKCFkYXRhYmFzZVR5cGUpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIHR5cGUgZ2l2ZW4gaW4gZGF0YWJhc2UgY29uZmlndXJhdGlvblwiKVxuXG4gICAgcmV0dXJuIGRhdGFiYXNlVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGlyZWN0b3J5LlxuICAgKi9cbiAgZ2V0RGlyZWN0b3J5KCkge1xuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKVxuXG4gICAgaWYgKCFkaXJlY3RvcnkpIHRocm93IG5ldyBFcnJvcihcIk5vIGRpcmVjdG9yeSBjb25maWd1cmVkIGFuZCBwcm9jZXNzLmN3ZCBpcyB1bmF2YWlsYWJsZVwiKVxuXG4gICAgcmV0dXJuIGRpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpcmVjdG9yeSBpZiBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGRpcmVjdG9yeSB3aGVuIHRoZSBydW50aW1lIGNhbiByZXNvbHZlIG9uZS5cbiAgICovXG4gIGdldERpcmVjdG9yeUlmQXZhaWxhYmxlKCkge1xuICAgIGlmICghdGhpcy5fZGlyZWN0b3J5KSB7XG4gICAgICB0aGlzLl9kaXJlY3RvcnkgPSBjdXJyZW50V29ya2luZ0RpcmVjdG9yeSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJhY2tlbmQgcHJvamVjdHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119IC0gQmFja2VuZCBwcm9qZWN0cy5cbiAgICovXG4gIGdldEJhY2tlbmRQcm9qZWN0cygpIHsgcmV0dXJuIHRoaXMuX2JhY2tlbmRQcm9qZWN0cyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBhY2thZ2VzLlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzUGFja2FnZVtdfSAtIFJlZ2lzdGVyZWQgVmVsb2Npb3VzIHBhY2thZ2VzLlxuICAgKi9cbiAgZ2V0UGFja2FnZXMoKSB7IHJldHVybiB0aGlzLl9wYWNrYWdlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFiaWxpdHkgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICovXG4gIGdldEFiaWxpdHlSZXNvdXJjZXMoKSB7IHJldHVybiB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYWJpbGl0eSByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSByZXNvdXJjZXMgLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEFiaWxpdHlSZXNvdXJjZXMocmVzb3VyY2VzKSB7IHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSByZXNvdXJjZXMgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgcmVzb3VyY2UgY2xhc3NlcyBkaXNjb3ZlcmVkIGZyb20gdGhlIGFwcCBhbmQgZXZlcnkgcmVnaXN0ZXJlZCBwYWNrYWdlXG4gICAqIGludG8gdGhlIGFiaWxpdHktcmVzb3VyY2VzIGxpc3QuIGBhdXRvRGlzY292ZXJSZXNvdXJjZXNgIHBvcHVsYXRlcyBlYWNoIGJhY2tlbmRcbiAgICogcHJvamVjdCdzIGBmcm9udGVuZE1vZGVsc2AgKGluY2x1ZGluZyBwYWNrYWdlIHByb2plY3RzKSwgc28gdGhpcyBtYWtlcyBhXG4gICAqIHBhY2thZ2UtY29udHJpYnV0ZWQgbW9kZWwncyBhYmlsaXRpZXMgcmVhY2ggc3Vic2NyaXB0aW9uIGFuZCBwZXItcmVjb3JkXG4gICAqIGF1dGhvcml6YXRpb24gYXV0b21hdGljYWxseSDigJQgY29uc3VtaW5nIGFwcHMgZG8gbm90IGhhdmUgdG8gaGFuZC1yZWdpc3RlclxuICAgKiBwYWNrYWdlIHJlc291cmNlcy4gQWxyZWFkeS1wcmVzZW50IGNsYXNzZXMgKGUuZy4gYW4gYXBwJ3MgZXhwbGljaXRseS1zZXRcbiAgICogcmVzb3VyY2VzKSBhcmUgbGVmdCB1bnRvdWNoZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9tZXJnZURpc2NvdmVyZWRBYmlsaXR5UmVzb3VyY2VzKCkge1xuICAgIGNvbnN0IG1lcmdlZCA9IFsuLi50aGlzLl9hYmlsaXR5UmVzb3VyY2VzXVxuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0KG1lcmdlZClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5fYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBpZiAoIWJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3QgUmVzb3VyY2VDbGFzcyBvZiBiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzKSB7XG4gICAgICAgIGlmIChzZWVuLmhhcyhSZXNvdXJjZUNsYXNzKSkgY29udGludWVcblxuICAgICAgICBzZWVuLmFkZChSZXNvdXJjZUNsYXNzKVxuICAgICAgICBtZXJnZWQucHVzaChSZXNvdXJjZUNsYXNzKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSBtZXJnZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gQWJpbGl0eSByZXNvbHZlci5cbiAgICovXG4gIGdldEFiaWxpdHlSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX2FiaWxpdHlSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnRSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGVuYW50IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0VGVuYW50UmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl90ZW5hbnRSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3QgdGVuYW50IHBvb2wgY29uZmlndXJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVzdFRlbmFudFBvb2xzQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBPcHQtaW4gdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbHMga2V5ZWQgYnkgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldFRlc3RUZW5hbnRQb29scygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RUZW5hbnRQb29scyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHJlcXVpcmUgYSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpIHsgcmV0dXJuIHRoaXMuX2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGU+fSAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXJzLlxuICAgKi9cbiAgZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcnMoKSB7IHJldHVybiB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXIuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVyKGlkZW50aWZpZXIpIHtcbiAgICBjb25zdCBwcm92aWRlciA9IHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBjb25maWd1cmVkIGZvciBkYXRhYmFzZSBpZGVudGlmaWVyOiAke2lkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvdmlkZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbn0gLSBBdHRhY2htZW50cyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fYXR0YWNobWVudHMgfHwge30gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Sb3V0ZVJlc29sdmVySG9va1R5cGVbXX0gLSBSb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICovXG4gIGdldFJvdXRlUmVzb2x2ZXJIb29rcygpIHsgcmV0dXJuIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHJvdXRlIHJlc29sdmVyIGhvb2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJvdXRlUmVzb2x2ZXJIb29rVHlwZX0gaG9vayAtIFJvdXRlIHJlc29sdmVyIGhvb2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFkZFJvdXRlUmVzb2x2ZXJIb29rKGhvb2spIHtcbiAgICB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MucHVzaChob29rKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gQWJpbGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QWJpbGl0eVJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX2FiaWxpdHlSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnRSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gVGVuYW50IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUZW5hbnRSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl90ZW5hbnRSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBUZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVzdCB0ZW5hbnQgcG9vbCBjb25maWd1cmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVzdFRlbmFudFBvb2xzQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gcG9vbHMgLSBPcHQtaW4gdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlc3RUZW5hbnRQb29scyhwb29scykgeyB0aGlzLl90ZXN0VGVuYW50UG9vbHMgPSBwb29scyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyByZXF1aXJlIGEgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyhuZXdWYWx1ZSkgeyB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlPn0gcHJvdmlkZXJzIC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKHByb3ZpZGVycykgeyB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyA9IHByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBlbnZpcm9ubWVudC5cbiAgICovXG4gIGdldEVudmlyb25tZW50KCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcIl9lbnZpcm9ubWVudFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlcXVlc3QgdGltZW91dCBtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBSZXF1ZXN0IHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIGdldFJlcXVlc3RUaW1lb3V0TXMoKSB7XG4gICAgY29uc3QgZW52VGltZW91dCA9IHRoaXMuX3BhcnNlUmVxdWVzdFRpbWVvdXRTZWNvbmRzKHByb2Nlc3MuZW52LlZFTE9DSU9VU19SRVFVRVNUX1RJTUVPVVRfTVMpXG4gICAgY29uc3QgdmFsdWUgPSB0eXBlb2YgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMoKVxuICAgICAgOiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodHlwZW9mIGVudlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlRpbWVvdXQpKSByZXR1cm4gZW52VGltZW91dFxuXG4gICAgcmV0dXJuIDYwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSByZXF1ZXN0IHRpbWVvdXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHJhd1ZhbHVlIC0gRW52IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIF9wYXJzZVJlcXVlc3RUaW1lb3V0U2Vjb25kcyhyYXdWYWx1ZSkge1xuICAgIGlmIChyYXdWYWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB0cmltbWVkID0gcmF3VmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9eKFxcZCsoPzpcXC5cXGQrKT8pKG1zfHMpPyQvKVxuXG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcihtYXRjaFsxXSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKG51bWVyaWMpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB1bml0ID0gbWF0Y2hbMl1cblxuICAgIGlmICh1bml0ID09PSBcIm1zXCIpIHJldHVybiBudW1lcmljIC8gMTAwMFxuICAgIGlmICh1bml0ID09PSBcInNcIikgcmV0dXJuIG51bWVyaWNcblxuICAgIGlmICh0cmltbWVkLmluY2x1ZGVzKFwiLlwiKSkgcmV0dXJuIG51bWVyaWNcbiAgICBpZiAobnVtZXJpYyA+PSAxMDAwKSByZXR1cm4gbnVtZXJpYyAvIDEwMDBcblxuICAgIHJldHVybiBudW1lcmljXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZW52aXJvbm1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdFbnZpcm9ubWVudCAtIE5ldyBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0RW52aXJvbm1lbnQobmV3RW52aXJvbm1lbnQpIHsgdGhpcy5fZW52aXJvbm1lbnQgPSBuZXdFbnZpcm9ubWVudCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlZmF1bHRDb25zb2xlXSAtIFdoZXRoZXIgZGVmYXVsdCBjb25zb2xlLlxuICAgKiBAcmV0dXJucyB7UmVxdWlyZWQ8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiY29uc29sZVwiIHwgXCJmaWxlXCIgfCBcImxldmVsc1wiPj4gJiBQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJkaXJlY3RvcnlcIiB8IFwiZmlsZVBhdGhcIj4gJiBQYXJ0aWFsPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcIm91dHB1dHNcIiB8IFwibG9nZ2Vyc1wiPj59IC0gVGhlIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldExvZ2dpbmdDb25maWd1cmF0aW9uKHtkZWZhdWx0Q29uc29sZX0gPSB7fSkge1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gdGhpcy5nZXRFbnZpcm9ubWVudCgpXG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuX2xvZ2dpbmc/LmRpcmVjdG9yeSB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0RGVmYXVsdExvZ0RpcmVjdG9yeSh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLl9sb2dnaW5nPy5maWxlUGF0aCB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0TG9nRmlsZVBhdGgoe2NvbmZpZ3VyYXRpb246IHRoaXMsIGRpcmVjdG9yeSwgZW52aXJvbm1lbnR9KVxuICAgIGNvbnN0IGNvbnNvbGVPdmVycmlkZSA9IHRoaXMuX2xvZ2dpbmc/LmNvbnNvbGVcbiAgICBjb25zdCBoYXNMb2dnaW5nQ29uZmlnID0gQm9vbGVhbih0aGlzLl9sb2dnaW5nKVxuICAgIGNvbnN0IGZpbGVMb2dnaW5nID0gaGFzTG9nZ2luZ0NvbmZpZyA/ICh0aGlzLl9sb2dnaW5nPy5maWxlID8/IEJvb2xlYW4oZmlsZVBhdGgpKSA6IGZhbHNlXG4gICAgY29uc3QgY29uZmlndXJlZExldmVscyA9IHRoaXMuX2xvZ2dpbmc/LmxldmVsc1xuICAgIGNvbnN0IGluY2x1ZGVMb3dMZXZlbERlYnVnID0gdGhpcy5fbG9nZ2luZz8uZGVidWdMb3dMZXZlbCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGxvZ2dlcnMgPSB0aGlzLl9sb2dnaW5nPy5sb2dnZXJzXG5cbiAgICBjb25zdCBjb25zb2xlRGVmYXVsdCA9IGRlZmF1bHRDb25zb2xlICE9PSB1bmRlZmluZWQgPyBkZWZhdWx0Q29uc29sZSA6IHRydWVcbiAgICBjb25zdCBjb25zb2xlTG9nZ2luZyA9IGNvbnNvbGVPdmVycmlkZSAhPT0gdW5kZWZpbmVkID8gY29uc29sZU92ZXJyaWRlIDogY29uc29sZURlZmF1bHRcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgbGV2ZWxzLlxuICAgICAqIEB0eXBlIHtBcnJheTxcImRlYnVnLWxvdy1sZXZlbFwiIHwgXCJkZWJ1Z1wiIHwgXCJpbmZvXCIgfCBcIndhcm5cIiB8IFwiZXJyb3JcIj59ICovXG4gICAgY29uc3QgZGVmYXVsdExldmVscyA9IFtcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl1cblxuICAgIGlmIChpbmNsdWRlTG93TGV2ZWxEZWJ1ZykgZGVmYXVsdExldmVscy51bnNoaWZ0KFwiZGVidWctbG93LWxldmVsXCIpXG5cbiAgICBjb25zdCBsZXZlbHMgPSBjb25maWd1cmVkTGV2ZWxzIHx8IGRlZmF1bHRMZXZlbHNcblxuICAgIHJldHVybiB7XG4gICAgICBjb25zb2xlOiBjb25zb2xlTG9nZ2luZyxcbiAgICAgIGRpcmVjdG9yeSxcbiAgICAgIGZpbGU6IGZpbGVMb2dnaW5nID8/IGZhbHNlLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBsb2dnZXJzLFxuICAgICAgbGV2ZWxzLFxuICAgICAgb3V0cHV0czogdGhpcy5fbG9nZ2luZz8ub3V0cHV0c1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb25maWd1cmF0aW9uLW93bmVkIHN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICogQHJldHVybnMge0xvZ1JlZGFjdG9yfSAtIFN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICovXG4gIGdldExvZ1JlZGFjdG9yKCkge1xuICAgIHJldHVybiB0aGlzLl9sb2dSZWRhY3RvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5IGxvZ2dpbmcgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBxdWVyeSBsb2dnaW5nIGlzIGVuYWJsZWQuXG4gICAqL1xuICBnZXRRdWVyeUxvZ2dpbmdFbmFibGVkKCkge1xuICAgIGlmICh0aGlzLl9sb2dnaW5nPy5xdWVyeUxvZ2dpbmcgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2xvZ2dpbmcucXVlcnlMb2dnaW5nXG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudCgpICE9PSBcInRlc3RcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGdlbmVyYXRpb24gbGlmZWN5Y2xlIHZhbHVlcyBmcm9tIHRoZWlyIHJhdyBjb25maWcsIGVudmlyb25tZW50LFxuICAgKiBhbmQgQVBJIHNvdXJjZXMgYmVmb3JlIGFwcGx5aW5nIGRlZmF1bHRzLiBEZXJpdmVkIGRlZmF1bHRzIGFyZSBkZWxpYmVyYXRlbHlcbiAgICogYWJzZW50IGZyb20gdGhlIHNvdXJjZSBsaXN0LCBzbyBhbiBBUEkgcmVjb3Zlcnkgc3RhdGUgY2FuIG92ZXJyaWRlIGFuXG4gICAqIElELW9ubHkgY29uZmlndXJhdGlvbiB3aXRob3V0IGNyZWF0aW5nIGEgZmFsc2UgY29uZmxpY3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBFeHBsaWNpdCBBUEkgdmFsdWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlfSBbYXJncy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXSAtIEV4cGxpY2l0IGJvb3Qgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5saWZlY3ljbGVTb2NrZXRQYXRoXSAtIEV4cGxpY2l0IGxpZmVjeWNsZSBzb2NrZXQgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvdXJjZU5hbWVdIC0gSHVtYW4tcmVhZGFibGUgQVBJIG93bmVyLlxuICAgKiBAcmV0dXJucyB7e2dlbmVyYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgfCBcImFjdGl2ZVwiLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIFJlc29sdmVkIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgcmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7Z2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsIHNvdXJjZU5hbWUgPSBcImJhY2tncm91bmQgam9icyBBUElcIn0gPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLl9iYWNrZ3JvdW5kSm9icyB8fCB7fVxuICAgIGNvbnN0IGdlbmVyYXRpb25FbnZpcm9ubWVudCA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52IHx8IHt9XG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gcmVzb2x2ZUdlbmVyYXRpb25JZChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5nZW5lcmF0aW9uSWRcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImdlbmVyYXRpb25JZFwiKSAmJiBjb25maWd1cmVkLmdlbmVyYXRpb25JZCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5nZW5lcmF0aW9uSWR9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRFwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSUR9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGdlbmVyYXRpb25JZGAsIHByZXNlbnQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEdlbmVyYXRpb25JZH1cbiAgICBdKVxuICAgIGNvbnN0IGluaXRpYWxHZW5lcmF0aW9uU3RhdGUgPSByZXNvbHZlSW5pdGlhbEdlbmVyYXRpb25TdGF0ZShbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJpbml0aWFsR2VuZXJhdGlvblN0YXRlXCIpICYmIGNvbmZpZ3VyZWQuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5pbml0aWFsR2VuZXJhdGlvblN0YXRlfSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBpbml0aWFsR2VuZXJhdGlvblN0YXRlYCwgcHJlc2VudDogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGV9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuICAgIGNvbnN0IGxpZmVjeWNsZVNvY2tldFBhdGggPSByZXNvbHZlTGlmZWN5Y2xlU29ja2V0UGF0aChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5saWZlY3ljbGVTb2NrZXRQYXRoXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJsaWZlY3ljbGVTb2NrZXRQYXRoXCIpICYmIGNvbmZpZ3VyZWQubGlmZWN5Y2xlU29ja2V0UGF0aCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5saWZlY3ljbGVTb2NrZXRQYXRofSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBsaWZlY3ljbGVTb2NrZXRQYXRoYCwgcHJlc2VudDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGh9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuXG4gICAgcmV0dXJuIHtnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge09taXQ8UmVxdWlyZWQ8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbj4sIFwiYWRhcHRlclwiIHwgXCJyZXRlbnRpb25cIiB8IFwiZ2VuZXJhdGlvbklkXCIgfCBcImxpZmVjeWNsZVNvY2tldFBhdGhcIj4gJiB7Z2VuZXJhdGlvbklkPzogc3RyaW5nLCBsaWZlY3ljbGVTb2NrZXRQYXRoPzogc3RyaW5nLCByZXRlbnRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JzUmV0ZW50aW9uQ29uZmlndXJhdGlvbn19IC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBjb25zdCBwcm9jZXNzRW52aXJvbm1lbnQgPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudlxuICAgIGNvbnN0IGVudkhvc3QgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSE9TVFxuICAgIGNvbnN0IGVudlBvcnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVFxuICAgIGNvbnN0IGVudkRhdGFiYXNlSWRlbnRpZmllciA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19EQVRBQkFTRV9JREVOVElGSUVSXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19NQVhfQ09OQ1VSUkVOVF9GT1JLRURfSk9CU1xuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTUFYX0NPTkNVUlJFTlRfSU5MSU5FX0pPQlNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX0NPVU5UXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3lSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9DT05DVVJSRU5DWVxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfSk9CU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX1JTU19CWVRFU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfTElGRVRJTUVfTVNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfU0lMRU5DRV9USU1FT1VUX01TXG4gICAgY29uc3QgZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWJSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUlVOTkVSX01BWF9PTERfU1BBQ0VfU0laRV9NQlxuICAgIGNvbnN0IGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1JVTk5FUl9NQUxMT0NfQVJFTkFfTUFYXG4gICAgY29uc3QgZW52RGlzcGF0Y2hTdHJhdGVneSA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19ESVNQQVRDSF9TVFJBVEVHWVxuICAgIGNvbnN0IGVudlBvbGxJbnRlcnZhbFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT0xMX0lOVEVSVkFMX01TXG4gICAgY29uc3QgZW52Sm9iVGltZW91dFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19KT0JfVElNRU9VVF9NU1xuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9IGVudk1heENvbmN1cnJlbnRGb3JrZWRSYXcgPyBOdW1iZXIoZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50ID0gZW52TWF4Q29uY3VycmVudFJhdyA/IE51bWJlcihlbnZNYXhDb25jdXJyZW50UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvdW50ID0gZW52UG9vbGVkUnVubmVyQ291bnRSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyQ291bnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhKb2JzID0gZW52UG9vbGVkUnVubmVyTWF4Sm9ic1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID0gZW52UG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID0gZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWJSYXcgPyBOdW1iZXIoZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWJSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UnVubmVyTWFsbG9jQXJlbmFNYXggPSBlbnZSdW5uZXJNYWxsb2NBcmVuYU1heFJhdyA/IE51bWJlcihlbnZSdW5uZXJNYWxsb2NBcmVuYU1heFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb2xsSW50ZXJ2YWwgPSBlbnZQb2xsSW50ZXJ2YWxSYXcgPyBOdW1iZXIoZW52UG9sbEludGVydmFsUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudkpvYlRpbWVvdXQgPSBlbnZKb2JUaW1lb3V0UmF3ID8gTnVtYmVyKGVudkpvYlRpbWVvdXRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JhY2tncm91bmRKb2JzIHx8IHt9XG4gICAgY29uc3Qge2dlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aH0gPSB0aGlzLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoKVxuICAgIGNvbnN0IG1vZGUgPSBjb25maWd1cmVkLm1vZGUgPT09IHVuZGVmaW5lZCA/IFwiYmFja2dyb3VuZFwiIDogY29uZmlndXJlZC5tb2RlXG5cbiAgICBpZiAobW9kZSAhPT0gXCJiYWNrZ3JvdW5kXCIgJiYgbW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgYmFja2dyb3VuZEpvYnMubW9kZSBtdXN0IGJlIFwiYmFja2dyb3VuZFwiIG9yIFwiaW5saW5lXCIsIGdvdDogJHtTdHJpbmcobW9kZSl9YClcbiAgICB9XG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMxKVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IGNvbmZpZ3VyZWQuZGF0YWJhc2VJZGVudGlmaWVyIHx8IGVudkRhdGFiYXNlSWRlbnRpZmllciB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICAgIDogKHR5cGVvZiBlbnZNYXhDb25jdXJyZW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZNYXhDb25jdXJyZW50KSAmJiBlbnZNYXhDb25jdXJyZW50ID49IDEgPyBlbnZNYXhDb25jdXJyZW50IDogNClcbiAgICBjb25zdCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IHR5cGVvZiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgICA6ICh0eXBlb2YgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52TWF4Q29uY3VycmVudEZvcmtlZCkgJiYgZW52TWF4Q29uY3VycmVudEZvcmtlZCA+PSAxID8gZW52TWF4Q29uY3VycmVudEZvcmtlZCA6IDQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyQ291bnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50KSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50ID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudFxuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lckNvdW50XCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lckNvdW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgZW52UG9vbGVkUnVubmVyQ291bnQgPj0gMSA/IGVudlBvb2xlZFJ1bm5lckNvdW50IDogNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyQ29uY3VycmVuY3lcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+PSAxID8gZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgOiAxKVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heEpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhKb2JzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyTWF4Sm9icykgJiYgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4Sm9icyA6IDEwMClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcykgJiYgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzIDogNTEyICogMTAyNCAqIDEwMjQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIDogNjAgKiA2MCAqIDEwMDApXG4gICAgY29uc3QgcG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNc1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zKSAmJiBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID49IDEgPyBlbnZQb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zIDogMTIwMDAwKVxuICAgIC8vIFJ1bm5lciBjaGlsZHJlbiBnZXQgYSBoYXJkIFY4IGhlYXAgY2FwIGFuZCBhIGJvdW5kZWQgZ2xpYmMgYXJlbmEgY291bnRcbiAgICAvLyBzbyBvbmUgY2hpbGQgY2FuIG5ldmVyIGNvbW1pdCBtdWx0aXBsZSBHQnMgb2YgaGVhcCBvciB1bmJvdW5kZWRcbiAgICAvLyBhbGxvY2F0b3IgYXJlbmFzLiBUaGUgY2FwIHN0YXlzIGZhciBhYm92ZSBvYnNlcnZlZCBydW5uZXIgdXNhZ2U7IGFuXG4gICAgLy8gaW5oZXJpdGVkIE1BTExPQ19BUkVOQV9NQVggaXMgaG9ub3JlZCBiZWZvcmUgdGhlIGJ1aWx0LWluIGRlZmF1bHQuXG4gICAgY29uc3QgcnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPSB0eXBlb2YgY29uZmlndXJlZC5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYikgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iKSAmJiBjb25maWd1cmVkLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID49IDY0XG4gICAgICA/IGNvbmZpZ3VyZWQucnVubmVyTWF4T2xkU3BhY2VTaXplTWJcbiAgICAgIDogKCEoXCJydW5uZXJNYXhPbGRTcGFjZVNpemVNYlwiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIpICYmIE51bWJlci5pc0ludGVnZXIoZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIpICYmIGVudlJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID49IDY0ID8gZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIgOiAyMDQ4KVxuICAgIGNvbnN0IGluaGVyaXRlZE1hbGxvY0FyZW5hTWF4ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5NQUxMT0NfQVJFTkFfTUFYID8gTnVtYmVyKHByb2Nlc3NFbnZpcm9ubWVudC5NQUxMT0NfQVJFTkFfTUFYKSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHJ1bm5lck1hbGxvY0FyZW5hTWF4ID0gdHlwZW9mIGNvbmZpZ3VyZWQucnVubmVyTWFsbG9jQXJlbmFNYXggPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucnVubmVyTWFsbG9jQXJlbmFNYXgpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heCkgJiYgY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heCA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucnVubmVyTWFsbG9jQXJlbmFNYXhcbiAgICAgIDogKCEoXCJydW5uZXJNYWxsb2NBcmVuYU1heFwiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZSdW5uZXJNYWxsb2NBcmVuYU1heCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UnVubmVyTWFsbG9jQXJlbmFNYXgpICYmIE51bWJlci5pc0ludGVnZXIoZW52UnVubmVyTWFsbG9jQXJlbmFNYXgpICYmIGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4ID49IDFcbiAgICAgICAgPyBlbnZSdW5uZXJNYWxsb2NBcmVuYU1heFxuICAgICAgICA6ICh0eXBlb2YgaW5oZXJpdGVkTWFsbG9jQXJlbmFNYXggPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcihpbmhlcml0ZWRNYWxsb2NBcmVuYU1heCkgJiYgaW5oZXJpdGVkTWFsbG9jQXJlbmFNYXggPj0gMSA/IGluaGVyaXRlZE1hbGxvY0FyZW5hTWF4IDogNCkpXG4gICAgY29uc3QgZGlzcGF0Y2hTdHJhdGVneVJhdyA9IGNvbmZpZ3VyZWQuZGlzcGF0Y2hTdHJhdGVneSB8fCBlbnZEaXNwYXRjaFN0cmF0ZWd5XG4gICAgY29uc3QgZGlzcGF0Y2hTdHJhdGVneSA9IGRpc3BhdGNoU3RyYXRlZ3lSYXcgPT09IFwicG9sbGluZ1wiID8gXCJwb2xsaW5nXCIgOiBcImJlYWNvblwiXG4gICAgY29uc3QgcG9sbEludGVydmFsTXMgPSB0eXBlb2YgY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNc1xuICAgICAgOiAodHlwZW9mIGVudlBvbGxJbnRlcnZhbCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9sbEludGVydmFsKSAmJiBlbnZQb2xsSW50ZXJ2YWwgPj0gMSA/IGVudlBvbGxJbnRlcnZhbCA6IDEwMDApXG4gICAgY29uc3QgZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNcyA9IHR5cGVvZiBjb25maWd1cmVkLmRyYWluU3RvcmVPcGVyYXRpb25UaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zXG4gICAgICA6IDYwXzAwMFxuICAgIC8vIGBudWxsYCBpcyBhbiBleHBsaWNpdCBvcHQtb3V0IG9mIHRoZSBzY2hlZHVsZWQtZW5xdWV1ZSBib3VuZC4gQSBwcmVzZW50XG4gICAgLy8gYnV0IG5vbi1wb3NpdGl2ZSBudW1iZXIgaXMgYSBtaXN0YWtlLCBub3QgYW4gb3B0LW91dCwgc28gaXQgZmFsbHMgYmFjayB0b1xuICAgIC8vIHRoZSBmcmFtZXdvcmsgZGVmYXVsdCByYXRoZXIgdGhhbiBzaWxlbnRseSBkaXNhYmxpbmcgdGhlIHdhdGNoZG9nLlxuICAgIGNvbnN0IHNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMgPSBcInNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXNcIiBpbiBjb25maWd1cmVkXG4gICAgICA/IChcbiAgICAgICAgY29uZmlndXJlZC5zY2hlZHVsZWRFbnF1ZXVlVGltZW91dE1zID09PSBudWxsID9cbiAgICAgICAgICBudWxsXG4gICAgICAgIDogKFxuICAgICAgICAgIHR5cGVvZiBjb25maWd1cmVkLnNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5zY2hlZHVsZWRFbnF1ZXVlVGltZW91dE1zID4gMCA/XG4gICAgICAgICAgICBjb25maWd1cmVkLnNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXNcbiAgICAgICAgICA6IERFRkFVTFRfU0NIRURVTEVEX0VOUVVFVUVfVElNRU9VVF9NU1xuICAgICAgICApXG4gICAgICApXG4gICAgICA6IERFRkFVTFRfU0NIRURVTEVEX0VOUVVFVUVfVElNRU9VVF9NU1xuICAgIGNvbnN0IHF1ZXVlcyA9IGNvbmZpZ3VyZWQucXVldWVzICYmIHR5cGVvZiBjb25maWd1cmVkLnF1ZXVlcyA9PT0gXCJvYmplY3RcIiA/IGNvbmZpZ3VyZWQucXVldWVzIDoge31cbiAgICAvLyBBbiBleHBsaWNpdCBjb25maWcgdmFsdWUgd2lucyBvdmVyIHRoZSBlbnYgdmFyIOKAlCBpbmNsdWRpbmcgYG51bGxgL2AwYCxcbiAgICAvLyB3aGljaCBkaXNhYmxlIHRoZSBiYWNrc3RvcCBldmVuIHdoZW4gdGhlIGVudmlyb25tZW50IHNldHMgYSBkZWZhdWx0LlxuICAgIC8vIE9ubHkgZmFsbCB0aHJvdWdoIHRvIHRoZSBlbnYgdmFyIHdoZW4gY29uZmlnIG9taXRzIGBqb2JUaW1lb3V0TXNgIGVudGlyZWx5LlxuICAgIGNvbnN0IGpvYlRpbWVvdXRNcyA9IFwiam9iVGltZW91dE1zXCIgaW4gY29uZmlndXJlZFxuICAgICAgPyAodHlwZW9mIGNvbmZpZ3VyZWQuam9iVGltZW91dE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQuam9iVGltZW91dE1zID4gMCA/IGNvbmZpZ3VyZWQuam9iVGltZW91dE1zIDogbnVsbClcbiAgICAgIDogKHR5cGVvZiBlbnZKb2JUaW1lb3V0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZKb2JUaW1lb3V0KSAmJiBlbnZKb2JUaW1lb3V0ID4gMCA/IGVudkpvYlRpbWVvdXQgOiBudWxsKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRSZXRlbnRpb24gPSBjb25maWd1cmVkLnJldGVudGlvbiAmJiB0eXBlb2YgY29uZmlndXJlZC5yZXRlbnRpb24gPT09IFwib2JqZWN0XCIgPyBjb25maWd1cmVkLnJldGVudGlvbiA6IHt9XG4gICAgY29uc3QgcmV0ZW50aW9uID0ge1xuICAgICAgY29tcGxldGVkVHRsTXM6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zID09PSBcIm51bWJlclwiIHx8IGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXMgPT09IG51bGxcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zXG4gICAgICAgIDogNyAqIDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gICAgICBmYWlsZWRUdGxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uZmFpbGVkVHRsTXMgPT09IFwibnVtYmVyXCIgfHwgY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNcyA9PT0gbnVsbFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uZmFpbGVkVHRsTXNcbiAgICAgICAgOiAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gICAgICBiYXRjaFNpemU6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZSA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZSA+IDBcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZVxuICAgICAgICA6IDEwMDAsXG4gICAgICBzd2VlcEludGVydmFsTXM6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNcyA+IDBcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNc1xuICAgICAgICA6IDYwICogNjAgKiAxMDAwXG4gICAgfVxuXG4gICAgY29uc3Qgam9iQ2xhc3NlcyA9IHRoaXMuZ2V0QmFja2dyb3VuZEpvYkNsYXNzZXMoKVxuXG4gICAgcmV0dXJuIHtob3N0LCBwb3J0LCBkYXRhYmFzZUlkZW50aWZpZXIsIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzLCBtYXhDb25jdXJyZW50SW5saW5lSm9icywgbW9kZSwgcG9vbGVkUnVubmVyQ291bnQsIHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5LCBwb29sZWRSdW5uZXJNYXhKb2JzLCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcywgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcywgcG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcywgcnVubmVyTWF4T2xkU3BhY2VTaXplTWIsIHJ1bm5lck1hbGxvY0FyZW5hTWF4LCBkaXNwYXRjaFN0cmF0ZWd5LCBwb2xsSW50ZXJ2YWxNcywgZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNcywgc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNcywgcXVldWVzLCBqb2JDbGFzc2VzLCBqb2JUaW1lb3V0TXMsIHJldGVudGlvbiwgZ2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc3RhdGljYWxseSByZWdpc3RlcmVkIHBvcnRhYmxlIGJhY2tncm91bmQgam9icy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2xhc3NbXX0gLSBDb25maWd1cmVkIGpvYiBjbGFzc2VzLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYkNsYXNzZXMoKSB7XG4gICAgY29uc3Qgam9iQ2xhc3NlcyA9IHRoaXMuX2JhY2tncm91bmRKb2JzPy5qb2JDbGFzc2VzXG5cbiAgICBpZiAoam9iQ2xhc3NlcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoam9iQ2xhc3NlcykpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJiYWNrZ3JvdW5kSm9icy5qb2JDbGFzc2VzIG11c3QgYmUgYW4gYXJyYXlcIilcblxuICAgIHJldHVybiBbLi4uam9iQ2xhc3Nlc11cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbmQgbWVtb2l6ZXMgb25lIGJhY2tncm91bmQtam9icyBhZGFwdGVyIGZvciB0aGlzIGNvbmZpZ3VyYXRpb24gbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7QmFja2dyb3VuZEpvYnNBZGFwdGVyfSAtIEFjdGl2ZSBhZGFwdGVyLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uKSByZXR1cm4gdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbi5hZGFwdGVyXG5cbiAgICBjb25zdCBjb25maWd1cmVkQWRhcHRlciA9IHRoaXMuX2JhY2tncm91bmRKb2JzPy5hZGFwdGVyXG4gICAgY29uc3QgYWRhcHRlciA9IHR5cGVvZiBjb25maWd1cmVkQWRhcHRlciA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGNvbmZpZ3VyZWRBZGFwdGVyKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgIDogKGNvbmZpZ3VyZWRBZGFwdGVyIHx8IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuY3JlYXRlQmFja2dyb3VuZEpvYnNBZGFwdGVyKHtjb25maWd1cmF0aW9uOiB0aGlzfSkpXG5cbiAgICBpZiAoIShhZGFwdGVyIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYnNBZGFwdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmFkYXB0ZXIgbXVzdCBiZSBhIEJhY2tncm91bmRKb2JzQWRhcHRlciBpbnN0YW5jZSBvciBhIHN5bmNocm9ub3VzIGZhY3RvcnkgcmV0dXJuaW5nIG9uZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPSB7XG4gICAgICBhZGFwdGVyLFxuICAgICAgY2xvc2luZzogZmFsc2UsXG4gICAgICBjbG9zZVByb21pc2U6IHVuZGVmaW5lZCxcbiAgICAgIHJlYWR5UHJvbWlzZTogdW5kZWZpbmVkXG4gICAgfVxuICAgIHJldHVybiBhZGFwdGVyXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSBhY3F1aXJlcyB0aGUgZXhhY3QgcmVhZHkgYWRhcHRlciBmb3IgdGhlIGFjdGl2ZSBsaWZlY3ljbGUuXG4gICAqIEEgY2xvc2UgdGhhdCBjbGFpbXMgdGhlIGdlbmVyYXRpb24gd2hpbGUgcmVhZGluZXNzIGlzIHBlbmRpbmcgd2luczogdGhpc1xuICAgKiBvcGVyYXRpb24gd2FpdHMgZm9yIHRoYXQgY2xvc2UsIGNyZWF0ZXMgdGhlIG5leHQgZ2VuZXJhdGlvbiwgcmVhZGllcyBpdCxcbiAgICogYW5kIHJldHVybnMgb25seSB0aGF0IGxpdmUgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJhY2tncm91bmRKb2JzQWRhcHRlcj59IC0gRXhhY3QgcmVhZHkgYWRhcHRlciBnZW5lcmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBkYXRhYmFzZUNsb3NlUHJvbWlzZSA9IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcblxuICAgICAgaWYgKGRhdGFiYXNlQ2xvc2VQcm9taXNlKSB7XG4gICAgICAgIGF3YWl0IGRhdGFiYXNlQ2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRoaXMuZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG5cbiAgICAgIGlmICghZ2VuZXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGFkYXB0ZXIgZ2VuZXJhdGlvbiB3YXMgbm90IGNyZWF0ZWRcIilcblxuICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2luZykge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlYWR5UHJvbWlzZSA9IGdlbmVyYXRpb24ucmVhZHlQcm9taXNlIHx8IFByb21pc2UucmVzb2x2ZSgpLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLmFkYXB0ZXIuZW5zdXJlUmVhZHkoKVxuICAgICAgfSlcblxuICAgICAgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPSByZWFkeVByb21pc2VcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcmVhZHlQcm9taXNlXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPT09IHJlYWR5UHJvbWlzZSkgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2luZykge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uICE9PSBnZW5lcmF0aW9uKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4gZ2VuZXJhdGlvbi5hZGFwdGVyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRpZXMgdGhlIGFjdGl2ZSBhZGFwdGVyIG9uY2UgcGVyIGxpZmVjeWNsZS4gQSBmYWlsZWQgYXR0ZW1wdCByZW1haW5zIHJldHJ5YWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUJhY2tncm91bmRKb2JzQWRhcHRlclJlYWR5KCkge1xuICAgIGF3YWl0IHRoaXMuYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGhlYWx0aCB3aXRob3V0IHJlc29sdmluZyBwZXJzaXN0ZW5jZSBpbiBub24tZHVyYWJsZSBpbmxpbmUgbW9kZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNIZWFsdGg+fSAtIEN1cnJlbnQgaGVhbHRoLlxuICAgKi9cbiAgYXN5bmMgYmFja2dyb3VuZEpvYnNIZWFsdGgoKSB7XG4gICAgaWYgKHRoaXMuZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5tb2RlID09PSBcImlubGluZVwiKSByZXR1cm4ge3JlYWR5OiB0cnVlfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IGF3YWl0IHRoaXMuYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcblxuICAgIHJldHVybiBhd2FpdCBhZGFwdGVyLmhlYWx0aCgpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoZSByZXNvbHZlZCBhZGFwdGVyIG9uY2UgYW5kIGNsZWFycyBsaWZlY3ljbGUgY2FjaGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbG9zZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlQmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG5cbiAgICBpZiAoIWdlbmVyYXRpb24pIHJldHVyblxuICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG5cbiAgICBnZW5lcmF0aW9uLmNsb3NpbmcgPSB0cnVlXG4gICAgY29uc3QgY2xvc2VQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICAgIGNvbnN0IGNsb3NlRXJyb3JzID0gW11cblxuICAgICAgaWYgKGdlbmVyYXRpb24ucmVhZHlQcm9taXNlKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2VcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLmFkYXB0ZXIuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGNsb3NlRXJyb3JzWzBdXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGNsb3NlRXJyb3JzLCBcIkZhaWxlZCB0byByZWFkeSBhbmQgY2xvc2UgdGhlIGJhY2tncm91bmQtam9icyBhZGFwdGVyXCIpXG4gICAgfSkoKVxuXG4gICAgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UgPSBjbG9zZVByb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbG9zZVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPT09IGdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb259IGJhY2tncm91bmRKb2JzIC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZyhiYWNrZ3JvdW5kSm9icykge1xuICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uICYmIGJhY2tncm91bmRKb2JzLmFkYXB0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlcGxhY2UgYmFja2dyb3VuZEpvYnMuYWRhcHRlciBkdXJpbmcgYW4gYWN0aXZlIGFkYXB0ZXIgbGlmZWN5Y2xlOyBjbG9zZSBpdCBmaXJzdFwiKVxuICAgIH1cblxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmFja2dyb3VuZEpvYnMsIGJhY2tncm91bmRKb2JzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhY3RpdmUgQmVhY29uIGNvbmZpZ3VyYXRpb24uIEJlYWNvbiBpcyBvcHQtaW46IGl0XG4gICAqIHN0YXlzIGRpc2FibGVkIHVubGVzcyB0aGUgYXBwIHBhc3NlcyBgYmVhY29uOiB7aG9zdCwgcG9ydH1gIC9cbiAgICogYGJlYWNvbjoge2luUHJvY2VzczogdHJ1ZX1gLCBjYWxscyBgc2V0QmVhY29uQ29uZmlnKHsuLi59KWAsIG9yXG4gICAqIHNldHMgdGhlIGBWRUxPQ0lPVVNfQkVBQ09OX0hPU1RgIC8gYFZFTE9DSU9VU19CRUFDT05fUE9SVGAgZW52IHZhcnMuXG4gICAqIFNldHRpbmcgYGVuYWJsZWQ6IGZhbHNlYCBleHBsaWNpdGx5IGRpc2FibGVzIGl0IGV2ZW4gd2hlbiBlbnYgdmFyc1xuICAgKiBhcmUgcHJlc2VudCAodXNlZnVsIGZvciB0ZXN0cykuIFdoZW4gYGluUHJvY2VzczogdHJ1ZWAgaXMgc2V0LFxuICAgKiBlbnYtdmFyIGhvc3QvcG9ydCBhcmUgaWdub3JlZCDigJQgY29kZS1sZXZlbCBjb25maWcgd2lucy5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBob3N0OiBzdHJpbmcsIHBvcnQ6IG51bWJlciwgcGVlclR5cGU/OiBzdHJpbmcsIGluUHJvY2VzczogYm9vbGVhbiwgdW5yZWFjaGFibGVSZXBvcnRNczogbnVtYmVyfX0gLSBCZWFjb24gY29uZmlndXJhdGlvbiB3aXRoIGRlZmF1bHRzIGFwcGxpZWQuXG4gICAqL1xuICBnZXRCZWFjb25Db25maWcoKSB7XG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JlYWNvbiB8fCB7fVxuICAgIGNvbnN0IGluUHJvY2VzcyA9IGNvbmZpZ3VyZWQuaW5Qcm9jZXNzID09PSB0cnVlXG5cbiAgICBpZiAoaW5Qcm9jZXNzICYmIChjb25maWd1cmVkLmhvc3QgfHwgdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJlYWNvbiBjb25maWd1cmF0aW9uOiBgaW5Qcm9jZXNzOiB0cnVlYCBpcyBtdXR1YWxseSBleGNsdXNpdmUgd2l0aCBgaG9zdGAvYHBvcnRgLiBVc2Ugb25lIG9yIHRoZSBvdGhlci5cIilcbiAgICB9XG5cbiAgICBjb25zdCBlbnZIb3N0ID0gaW5Qcm9jZXNzID8gdW5kZWZpbmVkIDogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JFQUNPTl9IT1NUXG4gICAgY29uc3QgZW52UG9ydFJhdyA9IGluUHJvY2VzcyA/IHVuZGVmaW5lZCA6IHByb2Nlc3MuZW52LlZFTE9DSU9VU19CRUFDT05fUE9SVFxuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMwKVxuXG4gICAgbGV0IGVuYWJsZWRcblxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZC5lbmFibGVkID09PSBcImJvb2xlYW5cIikge1xuICAgICAgZW5hYmxlZCA9IGNvbmZpZ3VyZWQuZW5hYmxlZFxuICAgIH0gZWxzZSB7XG4gICAgICBlbmFibGVkID0gQm9vbGVhbihpblByb2Nlc3MgfHwgY29uZmlndXJlZC5ob3N0IHx8IGNvbmZpZ3VyZWQucG9ydCB8fCBlbnZIb3N0IHx8IGVudlBvcnQpXG4gICAgfVxuXG4gICAgY29uc3QgdW5yZWFjaGFibGVSZXBvcnRNcyA9IHJlc29sdmVCZWFjb25VbnJlYWNoYWJsZVJlcG9ydE1zKGNvbmZpZ3VyZWQudW5yZWFjaGFibGVSZXBvcnRNcylcblxuICAgIHJldHVybiB7ZW5hYmxlZCwgaG9zdCwgcG9ydCwgcGVlclR5cGU6IGNvbmZpZ3VyZWQucGVlclR5cGUsIGluUHJvY2VzcywgdW5yZWFjaGFibGVSZXBvcnRNc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBiZWFjb24gY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CZWFjb25Db25maWd1cmF0aW9ufSBiZWFjb24gLSBCZWFjb24gY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEJlYWNvbkNvbmZpZyhiZWFjb24pIHtcbiAgICB0aGlzLl9iZWFjb24gPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iZWFjb24sIGJlYWNvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBiZWFjb24gY2xpZW50LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSBhY3RpdmUgQmVhY29uIGNsaWVudCwgaWYgY29ubmVjdGVkLlxuICAgKi9cbiAgZ2V0QmVhY29uQ2xpZW50KCkge1xuICAgIHJldHVybiB0aGlzLl9iZWFjb25DbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0aGlzIGNvbmZpZ3VyYXRpb24ncyBCZWFjb24gY2xpZW50IHRvIHRoZSBjb25maWd1cmVkXG4gICAqIGJyb2tlciwgd2lyaW5nIGluY29taW5nIGJyb2FkY2FzdHMgdG8gdGhlIGxvY2FsIGRlbGl2ZXJ5IHBhdGggc29cbiAgICogYW55IHdlYnNvY2tldCBzdWJzY3JpYmVycyBpbiB0aGlzIHByb2Nlc3MgcmVjZWl2ZSB0aGVtLiBJZGVtcG90ZW50XG4gICAqIOKAlCByZXBlYXQgY2FsbHMgcmV0dXJuIHRoZSBzYW1lIGluLWZsaWdodCBvciByZXNvbHZlZCBwcm9taXNlLlxuICAgKlxuICAgKiBSZXR1cm5zIGltbWVkaWF0ZWx5IHdpdGggYHVuZGVmaW5lZGAgaWYgQmVhY29uIGlzIG5vdCBlbmFibGVkLlxuICAgKlxuICAgKiAqKk5vbi1ibG9ja2luZyBieSBkZXNpZ24gKFRDUCBtb2RlKS4qKiBGb3IgYnJva2VyLWJhY2tlZCBCZWFjb24sIHRoZVxuICAgKiByZXR1cm5lZCBwcm9taXNlIHJlc29sdmVzIGFzIHNvb24gYXMgdGhlIGNsaWVudCBpcyBjb25zdHJ1Y3RlZCBhbmRcbiAgICogdGhlIFRDUCBjb25uZWN0IGlzIGxhdW5jaGVkIOKAlCBpdCBkb2VzICoqbm90Kiogd2FpdCBmb3IgdGhlIGNvbm5lY3RcbiAgICogaGFuZHNoYWtlIHRvIGNvbXBsZXRlLiBBIGJyb2tlciB0aGF0IHNpbGVudGx5IGRyb3BzIFNZTnNcbiAgICogKGZpcmV3YWxsL05BQ0wgRFJPUCBydWxlcykgd291bGQgb3RoZXJ3aXNlIGJsb2NrIHN0YXJ0dXAgb24gdGhlIE9TXG4gICAqIFRDUCBjb25uZWN0IHRpbWVvdXQgKHRlbnMgb2Ygc2Vjb25kcyksIHdoaWNoIGNvbnRyYWRpY3RzIHRoZVxuICAgKiBkb2N1bWVudGVkIFwiZmFsbCBiYWNrIHRvIGxvY2FsLW9ubHkgYW5kIHJlY29ubmVjdCBpbiB0aGVcbiAgICogYmFja2dyb3VuZFwiIGNvbnRyYWN0LiBJbml0aWFsLWNvbm5lY3QgZmFpbHVyZXMgc3VyZmFjZVxuICAgKiBhc3luY2hyb25vdXNseSBvbiB0aGUgZnJhbWV3b3JrLWVycm9yIGNoYW5uZWwgdmlhIHRoZVxuICAgKiBgY29ubmVjdC1lcnJvcmAgbGlzdGVuZXIgcmVnaXN0ZXJlZCBoZXJlLiBDYWxsZXJzIHRoYXQgbmVlZCBhXG4gICAqIGRldGVybWluaXN0aWMgcHVibGlzaC1yZWFkaW5lc3MgYm91bmRhcnkgc2hvdWxkIGNhbGxcbiAgICogYGdldEJlYWNvbkNsaWVudCgpPy53YWl0Rm9yUmVhZHkoe3RpbWVvdXRNc30pYC5cbiAgICpcbiAgICogKipJbi1wcm9jZXNzIG1vZGUqKiBhd2FpdHMgYGNvbm5lY3QoKWAg4oCUIHRoYXQgcGF0aCBpcyBzeW5jaHJvbm91cyxcbiAgICogY2Fubm90IGZhaWwsIGFuZCBnaXZlcyBjYWxsZXJzIHByZWRpY3RhYmxlIHJlYWRpbmVzcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBPdmVycmlkZSBwZWVyVHlwZSBmb3IgdGhpcyBjb25uZWN0IGNhbGwgKGUuZy4gYFwic2VydmVyXCJgLCBgXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJgKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZWdpc3RlcmVkIGNsaWVudCAoVENQIG1vZGU6IGNvbm5lY3QgbWF5IHN0aWxsIGJlIGluIGZsaWdodCksIG9yIHVuZGVmaW5lZCB3aGVuIEJlYWNvbiBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGFzeW5jIGNvbm5lY3RCZWFjb24oe3BlZXJUeXBlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCkgcmV0dXJuIHRoaXMuX2JlYWNvbkNsaWVudFxuICAgIGlmICh0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlXG5cbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldEJlYWNvbkNvbmZpZygpXG5cbiAgICBpZiAoIWNvbmZpZy5lbmFibGVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjbGllbnQgPSBhd2FpdCB0aGlzLl9jcmVhdGVCZWFjb25DbGllbnQoe1xuICAgICAgICBjb25maWcsXG4gICAgICAgIHBlZXJUeXBlOiBwZWVyVHlwZSB8fCBjb25maWcucGVlclR5cGVcbiAgICAgIH0pXG5cbiAgICAgIGNsaWVudC5vbkJyb2FkY2FzdCgobWVzc2FnZSkgPT4ge1xuICAgICAgICAvLyBTeW5hcHNlLXN0eWxlIGZhbi1vdXQ6IGRlbGl2ZXIgZXZlcnkgYnJvYWRjYXN0IHdlIHJlY2VpdmVcbiAgICAgICAgLy8gZnJvbSB0aGUgYnVzIHRocm91Z2ggdGhlIGxvY2FsIGRlbGl2ZXJ5IHBhdGguIEVjaG9lcyBvZiBvdXJcbiAgICAgICAgLy8gb3duIHB1Ymxpc2hlcyBmb2xsb3cgdGhlIHNhbWUgcGF0aCBzbyBldmVyeSBwZWVyIHNlZXMgdGhlXG4gICAgICAgIC8vIHNhbWUgZGVsaXZlcnkgc2VtYW50aWNzLlxuICAgICAgICB0aGlzLl9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbihtZXNzYWdlKVxuICAgICAgfSlcblxuICAgICAgLy8gQmVhY29uIGNvbm5lY3QvZGlzY29ubmVjdCBibGlwcyBhcmUgZXhwZWN0ZWQgZHVyaW5nIGRlcGxveXMgKHRoZSBicm9rZXJcbiAgICAgIC8vIHJlc3RhcnRzKSBhbmQgdGhlIEJlYWNvbkNsaWVudCBhdXRvLXJlY29ubmVjdHMgaW4gdGhlIGJhY2tncm91bmQsIHNvIGFcbiAgICAgIC8vIHNpbmdsZSB0cmFuc2llbnQgZmFpbHVyZSBpcyBOT1QgcmVwb3J0ZWQuIE9ubHkgYSBzdXN0YWluZWQgb3V0YWdlIChzdGlsbFxuICAgICAgLy8gZG93biBhZnRlciBgdW5yZWFjaGFibGVSZXBvcnRNc2ApIGlzIHN1cmZhY2VkIG9uIHRoZSBmcmFtZXdvcmstZXJyb3JcbiAgICAgIC8vIGNoYW5uZWw7IGEgKHJlKWNvbm5lY3Qgd2l0aGluIHRoZSBncmFjZSB3aW5kb3cgY2xlYXJzIGl0IHNpbGVudGx5LlxuXG4gICAgICAvLyBgY29ubmVjdC1lcnJvcmAgZmlyZXMgd2hlbiB0aGUgKmluaXRpYWwqIFRDUC9oYW5kc2hha2UgZmFpbHMuXG4gICAgICBjbGllbnQub24oXCJjb25uZWN0LWVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZTogXCJiZWFjb24tY29ubmVjdFwiLCBlcnJvciwgcmVwb3J0QWZ0ZXJNczogY29uZmlnLnVucmVhY2hhYmxlUmVwb3J0TXN9KVxuICAgICAgfSlcblxuICAgICAgLy8gYGRpc2Nvbm5lY3RgIGZpcmVzIHdoZW4gYW4gZXN0YWJsaXNoZWQgY29ubmVjdGlvbiBkcm9wcy4gVGhlIHBheWxvYWQgaXNcbiAgICAgIC8vIHRoZSB1bmRlcmx5aW5nIHNvY2tldCBlcnJvciBpZiB0aGVyZSB3YXMgb25lLCBvciBhIHN5bnRoZXRpY1xuICAgICAgLy8gRXJyb3IoXCJCZWFjb24gYnJva2VyIGRpc2Nvbm5lY3RlZFwiKSBvdGhlcndpc2UuXG4gICAgICBjbGllbnQub24oXCJkaXNjb25uZWN0XCIsIChyZWFzb24pID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uRG93bih7c3RhZ2U6IFwiYmVhY29uLWRpc2Nvbm5lY3RcIiwgZXJyb3I6IHJlYXNvbiwgcmVwb3J0QWZ0ZXJNczogY29uZmlnLnVucmVhY2hhYmxlUmVwb3J0TXN9KVxuICAgICAgfSlcblxuICAgICAgLy8gYGNvbm5lY3RgIGZpcmVzIG9uIGV2ZXJ5IChyZSljb25uZWN0OyBjbGVhciBhbnkgcGVuZGluZyBvdXRhZ2Ugc3RhdGUgc29cbiAgICAgIC8vIGEgdHJhbnNpZW50IGJsaXAgdGhhdCByZWNvdmVycyB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyBzdGF5cyBzaWxlbnQuXG4gICAgICBjbGllbnQub24oXCJjb25uZWN0XCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uVXAoKVxuICAgICAgfSlcblxuICAgICAgLy8gUmVnaXN0ZXIgdGhlIGNsaWVudCAqYmVmb3JlKiBraWNraW5nIG9mZiBjb25uZWN0IHNvIHN1YnNlcXVlbnRcbiAgICAgIC8vIGBjb25uZWN0QmVhY29uKClgIGNhbGxzIHJldHVybiB0aGlzIHNhbWUgaW5zdGFuY2UgaW5zdGVhZCBvZlxuICAgICAgLy8gcmFjaW5nIHRvIGNvbnN0cnVjdCBhIHNlY29uZCBvbmUuXG4gICAgICB0aGlzLl9iZWFjb25DbGllbnQgPSBjbGllbnRcblxuICAgICAgaWYgKGNvbmZpZy5pblByb2Nlc3MpIHtcbiAgICAgICAgLy8gSW4tcHJvY2VzcyBjb25uZWN0IGlzIHN5bmNocm9ub3VzLCBjYW5ub3QgZmFpbCwgYW5kIHJlc29sdmVzXG4gICAgICAgIC8vIGJlZm9yZSB0aGlzIGF3YWl0IHlpZWxkcyDigJQgY2FsbGVycyBjYW4gcmVseSBvblxuICAgICAgICAvLyBgaXNDb25uZWN0ZWQoKSA9PT0gdHJ1ZWAgaW1tZWRpYXRlbHkgYWZ0ZXIgYGNvbm5lY3RCZWFjb24oKWAuXG4gICAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEZpcmUtYW5kLWZvcmdldCB0aGUgVENQIGNvbm5lY3QuIEF3YWl0aW5nIGhlcmUgd291bGQgYmxvY2tcbiAgICAgICAgLy8gc3RhcnR1cCBvbiB0aGUgT1MgVENQIGNvbm5lY3QgdGltZW91dCAoNzVzIGRlZmF1bHQgb24gTGludXgpXG4gICAgICAgIC8vIHdoZW4gdGhlIGJyb2tlciBzaWxlbnRseSBkcm9wcyBTWU5zLiBGYWlsdXJlcyBzdXJmYWNlXG4gICAgICAgIC8vIGFzeW5jaHJvbm91c2x5IHZpYSB0aGUgYGNvbm5lY3QtZXJyb3JgIGxpc3RlbmVyIHJlZ2lzdGVyZWRcbiAgICAgICAgLy8gYWJvdmU7IHRoZSBCZWFjb25DbGllbnQncyByZWNvbm5lY3QgbG9vcCBrZWVwcyB0cnlpbmcuXG4gICAgICAgIHZvaWQgY2xpZW50LmNvbm5lY3QoKS5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gQWxyZWFkeSByZXBvcnRlZCB2aWEgY29ubmVjdC1lcnJvciBhYm92ZS5cbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNsaWVudFxuICAgIH0pKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIEJlYWNvbiBjbGllbnQgbWF0Y2hpbmcgdGhlIGNvbmZpZ3VyZWQgbW9kZS4gU3BsaXQgb3V0IHNvXG4gICAqIGBjb25uZWN0QmVhY29uYCBzdGF5cyBmb2N1c2VkIG9uIGxpZmVjeWNsZSBhbmQgZXJyb3Igd2lyaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTxWZWxvY2lvdXNDb25maWd1cmF0aW9uW1wiZ2V0QmVhY29uQ29uZmlnXCJdPn0gYXJncy5jb25maWcgLSBSZXNvbHZlZCBCZWFjb24gY29uZmlnLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucGVlclR5cGVdIC0gUmVzb2x2ZWQgcGVlciB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEJlYWNvbiBjbGllbnQuXG4gICAqL1xuICBhc3luYyBfY3JlYXRlQmVhY29uQ2xpZW50KHtjb25maWcsIHBlZXJUeXBlfSkge1xuICAgIC8vIFJvdXRlIHRocm91Z2ggdGhlIGVudmlyb25tZW50IGhhbmRsZXIgc28gdGhlIE5vZGUtb25seSBgbm9kZTpuZXRgXG4gICAgLy8gLyBgbm9kZTpjcnlwdG9gIGRlcHMgaW4gdGhlIEJlYWNvbiBjbGllbnQgbW9kdWxlcyBkb24ndCBnZXQgcHVsbGVkXG4gICAgLy8gaW50byBicm93c2VyIGJ1bmRsZXMuIEJyb3dzZXIgYnVuZGxlcyBzdGF0aWNhbGx5IHJlYWNoXG4gICAgLy8gYENvbmZpZ3VyYXRpb25gICh2aWEgYExvZ2dlcmApOyBwdXR0aW5nIHRoZSBkeW5hbWljXG4gICAgLy8gYGltcG9ydChcIi4vYmVhY29uLy4uLlwiKWAgY2FsbHMgaGVyZSB3b3VsZCBzdGlsbCBkcmFnIHRob3NlIG1vZHVsZXNcbiAgICAvLyB0aHJvdWdoIGVzYnVpbGQncyBzdGF0aWMgYW5hbHlzaXMuIEhpZGluZyB0aGUgaW1wb3J0cyBpbnNpZGUgdGhlXG4gICAgLy8gTm9kZSBlbnZpcm9ubWVudCBoYW5kbGVyIGtlZXBzIHRoZW0gb2ZmIHRoZSBicm93c2VyIHBhdGgg4oCUXG4gICAgLy8gYnJvd3Nlci1idW5kbGVkIGFwcHMgbmV2ZXIgcmVhY2ggYGVudmlyb25tZW50LWhhbmRsZXJzL25vZGUuanNgLlxuICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAoY29uZmlnLmluUHJvY2Vzcykge1xuICAgICAgY29uc3QgSW5Qcm9jZXNzQmVhY29uQ2xpZW50ID0gYXdhaXQgaGFuZGxlci5sb2FkSW5Qcm9jZXNzQmVhY29uQ2xpZW50KClcblxuICAgICAgcmV0dXJuIG5ldyBJblByb2Nlc3NCZWFjb25DbGllbnQoe3BlZXJUeXBlfSlcbiAgICB9XG5cbiAgICBjb25zdCBCZWFjb25DbGllbnQgPSBhd2FpdCBoYW5kbGVyLmxvYWRCZWFjb25DbGllbnQoKVxuXG4gICAgcmV0dXJuIG5ldyBCZWFjb25DbGllbnQoe1xuICAgICAgaG9zdDogY29uZmlnLmhvc3QsXG4gICAgICBwb3J0OiBjb25maWcucG9ydCxcbiAgICAgIHBlZXJUeXBlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgQmVhY29uIGNvbm5lY3QvZGlzY29ubmVjdCBmYWlsdXJlIHdpdGhvdXQgcmVwb3J0aW5nIGl0IGltbWVkaWF0ZWx5LlxuICAgKiBUaGUgQmVhY29uQ2xpZW50IGF1dG8tcmVjb25uZWN0cywgc28gYnJpZWYgb3V0YWdlcyAoZS5nLiBhIGRlcGxveSByZXN0YXJ0aW5nXG4gICAqIHRoZSBicm9rZXIpIGFyZSBleHBlY3RlZDsgb25seSBpZiB0aGUgYmVhY29uIGlzIHN0aWxsIHVucmVhY2hhYmxlIGFmdGVyXG4gICAqIGByZXBvcnRBZnRlck1zYCBpcyBhIHNpbmdsZSBmcmFtZXdvcmstZXJyb3Igc3VyZmFjZWQgdmlhIGBfcmVwb3J0QmVhY29uRXJyb3JgLlxuICAgKiBBIHN1YnNlcXVlbnQgYGNvbm5lY3RgIChzZWUgYF9oYW5kbGVCZWFjb25VcGApIGNhbmNlbHMgdGhlIHBlbmRpbmcgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJiZWFjb24tY29ubmVjdFwiIHwgXCJiZWFjb24tZGlzY29ubmVjdFwifSBhcmdzLnN0YWdlIC0gRmFpbHVyZSBzdGFnZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZXBvcnRBZnRlck1zIC0gR3JhY2Ugd2luZG93IGJlZm9yZSBhIHN1c3RhaW5lZCBvdXRhZ2UgaXMgcmVwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlLCBlcnJvciwgcmVwb3J0QWZ0ZXJNc30pIHtcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0ge3N0YWdlLCBlcnJvcn1cblxuICAgIC8vIEEgcmVwb3J0IGlzIGFscmVhZHkgcGVuZGluZyBvciBhbHJlYWR5IHNlbnQgZm9yIHRoaXMgb3V0YWdlIOKAlCBrZWVwIHRoZVxuICAgIC8vIGxhdGVzdCBlcnJvciBidXQgZG9uJ3Qgc3RhY2sgdGltZXJzIG9yIHJlLXJlcG9ydC5cbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIgfHwgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQpIHJldHVyblxuXG4gICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG5cbiAgICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQ/LmlzQ29ubmVjdGVkKCkpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uVXAoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSB0cnVlXG5cbiAgICAgIGlmICh0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yKSB0aGlzLl9yZXBvcnRCZWFjb25FcnJvcih0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yKVxuICAgIH0sIHJlcG9ydEFmdGVyTXMpXG5cbiAgICAvLyBEb24ndCBsZXQgdGhlIGdyYWNlIHRpbWVyIGtlZXAgdGhlIHByb2Nlc3MgYWxpdmUuXG4gICAgaWYgKHR5cGVvZiB0aW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aW1lci51bnJlZigpXG5cbiAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHRpbWVyXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGJlYWNvbi1kb3duIHN0YXRlIG9uIGEgKHJlKWNvbm5lY3QuIEEgYmxpcCB0aGF0IHJlY292ZXJzIHdpdGhpbiB0aGVcbiAgICogZ3JhY2Ugd2luZG93IGlzIG5ldmVyIHJlcG9ydGVkOyBpZiBhIHN1c3RhaW5lZCBvdXRhZ2UgaGFkIGFscmVhZHkgYmVlblxuICAgKiByZXBvcnRlZCwgdGhlIHN0YXRlIHJlc2V0cyBzbyBhIGZ1dHVyZSBvdXRhZ2UgY2FuIHJlcG9ydCBhZ2Fpbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQmVhY29uVXAoKSB7XG4gICAgaWYgKHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpXG4gICAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gZmFsc2VcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYSBCZWFjb24gZmFpbHVyZSBvbiB0aGUgZnJhbWV3b3JrIGVycm9yIGNoYW5uZWwuIE1pcnJvcnNcbiAgICogdGhlIHBhdHRlcm4gdXNlZCBieSBgcmVxdWVzdC1ydW5uZXIuanNgIGZvciBIVFRQIGVycm9ycy4gV2hlbiBub1xuICAgKiBsaXN0ZW5lciBpcyBhdHRhY2hlZCB0byBlaXRoZXIgYGZyYW1ld29yay1lcnJvcmAgb3IgYGFsbC1lcnJvcmAsXG4gICAqIGFsc28gc2NoZWR1bGVzIGFuIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbiBzbyBwcm9jZXNzLWxldmVsIGJ1Z1xuICAgKiByZXBvcnRlcnMgKHdoaWNoIHN1YnNjcmliZSB0byBgdW5oYW5kbGVkUmVqZWN0aW9uYCBieSBkZWZhdWx0KSBwaWNrXG4gICAqIHRoZSBmYWlsdXJlIHVwIOKAlCBhbmQgQUxTTyB3cml0ZXMgYSBvbmUtbGluZSBzdW1tYXJ5IHRvIGBzdGRlcnJgIHNvXG4gICAqIHRoZSBmYWlsdXJlIGlzbid0IGNvbXBsZXRlbHkgc2lsZW50IG9uIE5vZGUgMjQrIHdoZXJlIHRoZSBkZWZhdWx0XG4gICAqIGJlaGF2aW9yIG9mIGB1bmhhbmRsZWRSZWplY3Rpb25gIGlzIHRvIHRlcm1pbmF0ZSB0aGUgcHJvY2Vzcy4gQW5cbiAgICogYXBwIHRoYXQgc2VlcyBpdHMgc2VydmVyIHN1ZGRlbmx5IGV4aXQgbmVlZHMgYXQgbGVhc3Qgb25lXG4gICAqIGJyZWFkY3J1bWIgaW4gdGhlIGxvZ3MgdG8ga25vdyBCZWFjb24gd2FzIHRoZSBjYXVzZTsgdGhlIHByZXZpb3VzXG4gICAqIGJlaGF2aW9yIGxlZnQgYSBzdGFjay1vbmx5IGNyYXNoIHdpdGggbm8gY29udGV4dCB0eWluZyBpdCBiYWNrIHRvXG4gICAqIHRoZSBicm9rZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCJ9IGFyZ3Muc3RhZ2UgLSBGYWlsdXJlIHN0YWdlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEJlYWNvbkVycm9yKHtzdGFnZSwgZXJyb3J9KSB7XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLl9lcnJvckV2ZW50c1xuICAgIGNvbnN0IGhhc0xpc3RlbmVyID0gZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImZyYW1ld29yay1lcnJvclwiKSA+IDBcbiAgICAgIHx8IGVycm9yRXZlbnRzLmxpc3RlbmVyQ291bnQoXCJhbGwtZXJyb3JcIikgPiAwXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtzdGFnZX0sXG4gICAgICBlcnJvclxuICAgIH1cblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gICAgaWYgKCFoYXNMaXN0ZW5lcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuXG5cbiAgICAgIGNvbnNvbGUuZXJyb3IoYFt2ZWxvY2lvdXMgZnJhbWV3b3JrLWVycm9yIHN0YWdlPSR7c3RhZ2V9XSAke21lc3NhZ2V9IOKAlCByZWdpc3RlciBhIGxpc3RlbmVyIHZpYSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkub24oXCJmcmFtZXdvcmstZXJyb3JcIiwg4oCmKSB0byBzdXBwcmVzcyB0aGlzIHN0ZGVyciBmYWxsYmFja2ApXG4gICAgICB2b2lkIFByb21pc2UucmVqZWN0KGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgdGhlIGFjdGl2ZSBCZWFjb24gY2xpZW50IChpZiBhbnkpLiBTYWZlIHRvIGNhbGwgbXVsdGlwbGVcbiAgICogdGltZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgZGlzY29ubmVjdEJlYWNvbigpIHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLl9iZWFjb25DbGllbnRcblxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gdW5kZWZpbmVkXG5cbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcilcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcblxuICAgIGlmIChjbGllbnQpIGF3YWl0IGNsaWVudC5jbG9zZSgpXG4gIH1cblxuICAvKipcbiAgICogUm91dGVzIGEgQmVhY29uLXNvdXJjZWQgYnJvYWRjYXN0IHRocm91Z2ggdGhlIHNhbWUgZGVsaXZlcnkgY29kZVxuICAgKiBwYXRoIGFzIGEgbG9jYWxseS1vcmlnaW5hdGVkIG9uZS4gUHJlZmVycyB0aGUgd29ya2VydGhyZWFkLWF3YXJlXG4gICAqIGBicm9hZGNhc3RWMmAgd2hlbiBhbiBIVFRQIHNlcnZlciBpcyBob3N0aW5nIHdvcmtlcnMsIGFuZCBmYWxsc1xuICAgKiBiYWNrIHRvIHRoZSBwZXItcHJvY2VzcyBzdWJzY3JpcHRpb24gZGlzcGF0Y2ggb3RoZXJ3aXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmVhY29uL3R5cGVzLmpzXCIpLkJlYWNvbkJyb2FkY2FzdE1lc3NhZ2V9IG1lc3NhZ2UgLSBCcm9hZGNhc3QgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZGVsaXZlckJyb2FkY2FzdEZyb21CZWFjb24obWVzc2FnZSkge1xuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMih7XG4gICAgICAgIGNoYW5uZWw6IG1lc3NhZ2UuY2hhbm5lbCxcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zOiBtZXNzYWdlLmJyb2FkY2FzdFBhcmFtcyxcbiAgICAgICAgYm9keTogbWVzc2FnZS5ib2R5LFxuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzXG4gICAgICB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobWVzc2FnZS5jaGFubmVsLCBtZXNzYWdlLmJyb2FkY2FzdFBhcmFtcywgbWVzc2FnZS5ib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBpZiAoIXRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNMb2FkZXJUeXBlIHwgdW5kZWZpbmVkfSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyAtIFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZyhzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icykge1xuICAgIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID0gc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtYWlsZXIgYmFja2VuZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5NYWlsZXJCYWNrZW5kIHwgdW5kZWZpbmVkfSAtIE1haWxlciBiYWNrZW5kLlxuICAgKi9cbiAgZ2V0TWFpbGVyQmFja2VuZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fbWFpbGVyQmFja2VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG1haWxlciBiYWNrZW5kLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5NYWlsZXJCYWNrZW5kIHwgdW5kZWZpbmVkfSBtYWlsZXJCYWNrZW5kIC0gTWFpbGVyIGJhY2tlbmQsIG9yIHVuZGVmaW5lZCB0byByZW1vdmUgaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1haWxlckJhY2tlbmQobWFpbGVyQmFja2VuZCkge1xuICAgIHRoaXMuX21haWxlckJhY2tlbmQgPSBtYWlsZXJCYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogTG9nZ2luZyBjb25maWd1cmF0aW9uIHRhaWxvcmVkIGZvciBIVFRQIHJlcXVlc3QgbG9nZ2luZy4gRGVmYXVsdHMgY29uc29sZSBsb2dnaW5nIHRvIHRydWUgYW5kIGFwcGxpZXMgdGhlIHVzZXIgYGxvZ2dpbmcuY29uc29sZWAgZmxhZyBvbmx5IGZvciByZXF1ZXN0IGxvZ2dpbmcuXG4gICAqIEByZXR1cm5zIHtSZXF1aXJlZDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJjb25zb2xlXCIgfCBcImZpbGVcIiB8IFwibGV2ZWxzXCI+PiAmIFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImRpcmVjdG9yeVwiIHwgXCJmaWxlUGF0aFwiPiAmIFBhcnRpYWw8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwib3V0cHV0c1wiIHwgXCJsb2dnZXJzXCI+Pn0gLSBUaGUgaHR0cCBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRIdHRwTG9nZ2luZ0NvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TG9nZ2luZ0NvbmZpZ3VyYXRpb24oe2RlZmF1bHRDb25zb2xlOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbnZpcm9ubWVudCBoYW5kbGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqL1xuICBnZXRFbnZpcm9ubWVudEhhbmRsZXIoKSB7XG4gICAgaWYgKCF0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGVudmlyb25tZW50IGhhbmRsZXIgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZW52aXJvbm1lbnRIYW5kbGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2NhbGVGYWxsYmFja3NUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKi9cbiAgZ2V0TG9jYWxlRmFsbGJhY2tzKCkgeyByZXR1cm4gdGhpcy5sb2NhbGVGYWxsYmFja3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2NhbGVGYWxsYmFja3NUeXBlfSBuZXdMb2NhbGVGYWxsYmFja3MgLSBOZXcgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TG9jYWxlRmFsbGJhY2tzKG5ld0xvY2FsZUZhbGxiYWNrcykgeyB0aGlzLmxvY2FsZUZhbGxiYWNrcyA9IG5ld0xvY2FsZUZhbGxiYWNrcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN0cnVjdHVyZSBzcWwgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlN0cnVjdHVyZVNxbENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gU3RydWN0dXJlIFNRTCBjb25maWcuXG4gICAqL1xuICBnZXRTdHJ1Y3R1cmVTcWxDb25maWcoKSB7IHJldHVybiB0aGlzLl9zdHJ1Y3R1cmVTcWwgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCB3cml0ZSBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcGFyYW0ge3tyZWFzb24/OiBcIm1pZ3JhdGlvblwiIHwgXCJzY2hlbWFEdW1wXCJ9fSBbYXJnc10gLSBDYWxsIGNvbnRleHQgZm9yIHRoZSBzdHJ1Y3R1cmUgc3FsIHdyaXRlIGRlY2lzaW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN0cnVjdHVyZSBTUUwgZmlsZXMgc2hvdWxkIGJlIGdlbmVyYXRlZCBmb3IgdGhlIGN1cnJlbnQgZW52aXJvbm1lbnQuXG4gICAqL1xuICBzaG91bGRXcml0ZVN0cnVjdHVyZVNxbChhcmdzID0ge30pIHtcbiAgICBjb25zdCB7cmVhc29uID0gXCJtaWdyYXRpb25cIn0gPSBhcmdzXG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRTdHJ1Y3R1cmVTcWxDb25maWcoKVxuICAgIGNvbnN0IGVuYWJsZWRFbnZpcm9ubWVudHMgPSBjb25maWc/LmVuYWJsZWRFbnZpcm9ubWVudHNcbiAgICBjb25zdCBkaXNhYmxlZEVudmlyb25tZW50cyA9IGNvbmZpZz8uZGlzYWJsZWRFbnZpcm9ubWVudHNcblxuICAgIGlmIChyZWFzb24gPT09IFwic2NoZW1hRHVtcFwiKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGVuYWJsZWRFbnZpcm9ubWVudHMpKSB7XG4gICAgICByZXR1cm4gZW5hYmxlZEVudmlyb25tZW50cy5pbmNsdWRlcyh0aGlzLmdldEVudmlyb25tZW50KCkpXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZGlzYWJsZWRFbnZpcm9ubWVudHMpICYmIGRpc2FibGVkRW52aXJvbm1lbnRzLmluY2x1ZGVzKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldEVudmlyb25tZW50KCkgPT09IFwidGVzdFwiKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHN0cnVjdHVyZSBzcWwgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TdHJ1Y3R1cmVTcWxDb25maWd1cmF0aW9ufSBzdHJ1Y3R1cmVTcWwgLSBTdHJ1Y3R1cmUgU1FMIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U3RydWN0dXJlU3FsQ29uZmlnKHN0cnVjdHVyZVNxbCkge1xuICAgIHRoaXMuX3N0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbG9jYWxlLlxuICAgKi9cbiAgZ2V0TG9jYWxlKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5sb2NhbGUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5sb2NhbGUoKVxuICAgIH0gZWxzZSBpZiAodGhpcy5sb2NhbGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvY2FsZVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRMb2NhbGVzKClbMF1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIGxvY2FsZXMuXG4gICAqL1xuICBnZXRMb2NhbGVzKCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcImxvY2FsZXNcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcyhuYW1lKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzc2VzW25hbWVdXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBtb2RlbCBjbGFzcyAke25hbWV9IGluICR7T2JqZWN0LmtleXModGhpcy5tb2RlbENsYXNzZXMpLmpvaW4oXCIsIFwiKX19YClcblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQSBoYXNoIG9mIGFsbCBtb2RlbCBjbGFzc2VzLCBrZXllZCBieSBtb2RlbCBuYW1lLCBhcyB0aGV5IHdlcmUgZGVmaW5lZCBpbiB0aGUgY29uZmlndXJhdGlvbi4gVGhpcyBpcyBhIGRpcmVjdCByZWZlcmVuY2UgdG8gdGhlIG1vZGVsIGNsYXNzZXMsIG5vdCBhIGNvcHkuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzc2VzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdGluZy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gVGhlIHBhdGggdG8gYSBjb25maWcgZmlsZSB0aGF0IHNob3VsZCBiZSB1c2VkIGZvciB0ZXN0aW5nLlxuICAgKi9cbiAgZ2V0VGVzdGluZygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RpbmcgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cnVzdGVkIHByb3hpZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gVHJ1c3RlZCByZXZlcnNlIHByb3h5IGFkZHJlc3MgcmFuZ2VzLlxuICAgKi9cbiAgZ2V0VHJ1c3RlZFByb3hpZXMoKSB7IHJldHVybiB0aGlzLl90cnVzdGVkUHJveGllcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRydXN0ZWQgcHJveGllcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gdHJ1c3RlZFByb3hpZXMgLSBUcnVzdGVkIHJldmVyc2UgcHJveHkgYWRkcmVzcyByYW5nZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0VHJ1c3RlZFByb3hpZXModHJ1c3RlZFByb3hpZXMpIHsgdGhpcy5fdHJ1c3RlZFByb3hpZXMgPSB0cnVzdGVkUHJveGllcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBkYXRhYmFzZSBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2lkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllciB0byBpbml0aWFsaXplLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBpbml0aWFsaXplRGF0YWJhc2VQb29sKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGlmICghdGhpcy5kYXRhYmFzZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gJ2RhdGFiYXNlJyB3YXMgZ2l2ZW5cIilcbiAgICBpZiAodGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZVBvb2wgaGFzIGFscmVhZHkgYmVlbiBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgUG9vbFR5cGUgPSB0aGlzLmdldERhdGFiYXNlUG9vbFR5cGUoaWRlbnRpZmllcilcblxuICAgIHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IG5ldyBQb29sVHlwZSh7Y29uZmlndXJhdGlvbjogdGhpcywgaWRlbnRpZmllcn0pXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdLnNldEN1cnJlbnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZGF0YWJhc2UgcG9vbCBpbml0aWFsaXplZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtpZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0YWJhc2UgcG9vbCBpbml0aWFsaXplZC5cbiAgICovXG4gIGlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7IHJldHVybiBCb29sZWFuKHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGluaXRpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluaXRpYWxpemVkLlxuICAgKi9cbiAgaXNJbml0aWFsaXplZCgpIHsgcmV0dXJuIHRoaXMuX2lzSW5pdGlhbGl6ZWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgbW9kZWxzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZU1vZGVscyhhcmdzID0ge3R5cGU6IFwic2VydmVyXCJ9KSB7XG4gICAgY29uc3QgbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgaWYgKHRoaXMuX21vZGVsc0luaXRpYWxpemVkKSByZXR1cm5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgIGNvbnN0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgICAgYXdhaXQgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID09PSBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAmJiAhdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID09PSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5pbml0aWFsaXplTW9kZWxzKGFyZ3MpXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNob3VsZFNraXBEdW1teU1vZGVsSW5pdGlhbGl6YXRpb24gPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfU0tJUF9EVU1NWV9NT0RFTF9JTklUSUFMSVpBVElPTiA9PT0gXCIxXCJcbiAgICAgICAgJiYgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gICAgICAgICYmIHRoaXMuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCJcblxuICAgICAgaWYgKCFzaG91bGRTa2lwRHVtbXlNb2RlbEluaXRpYWxpemF0aW9uKSB7XG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVscyh7Y29uZmlndXJhdGlvbjogdGhpcywgdHlwZTogYXJncy50eXBlfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW5pdGlhbGl6ZVBhY2thZ2VNb2RlbHModGhpcylcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHModGhpcylcblxuICAgICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmluaXRpYWxpemVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVycyh0aGlzKVxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IG1vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0pKClcblxuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPT09IGluaXRpYWxpemVNb2RlbHNQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgZWFjaCBjb25maWd1cmVkIGRhdGFiYXNlIHBvb2wgaGFzIGEgZ2xvYmFsIGNvbm5lY3Rpb24gYXZhaWxhYmxlLlxuICAgKiBVc2VmdWwgd2hlbiBgZ2V0Q3VycmVudENvbm5lY3Rpb25gIG1pZ2h0IGJlIGNhbGxlZCB3aXRob3V0IGFuIGFzeW5jIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlbnN1cmVHbG9iYWxDb25uZWN0aW9ucygpIHtcbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICBhd2FpdCBwb29sLmVuc3VyZUdsb2JhbENvbm5lY3Rpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBpbml0aWFsaXplKHt0eXBlfSA9IHt0eXBlOiBcInVuZGVmaW5lZFwifSkge1xuICAgIGlmICh0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlXG5cbiAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IHRydWUsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX3NodXRkb3duUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogZmFsc2UsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2V9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9iZWdpbkluaXRpYWxpemUoe3R5cGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBvciBqb2lucyBpbml0aWFsaXphdGlvbiBhZnRlciBsaWZlY3ljbGUgYmxvY2tlcnMgaGF2ZSBzZXR0bGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFN0YXJ0dXAgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIEdlbmVyaWMgYXBwbGljYXRpb24gcHJvY2VzcyB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTaGFyZWQgc3RhcnR1cCBwcm9taXNlLlxuICAgKi9cbiAgX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pIHtcbiAgICBjb25zdCBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlICYmIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcbiAgICB9XG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogZmFsc2UsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX2luaXRpYWxpemVQcm9taXNlfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5faXNJbml0aWFsaXplZCkge1xuICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICAgIHJldHVybiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIH1cbiAgICAvLyBNZW1vaXplIHRoZSBpbi1wcm9ncmVzcyBpbml0aWFsaXphdGlvbiBzbyBjb25jdXJyZW50IGNhbGxlcnMgYXdhaXQgdGhlIHNhbWVcbiAgICAvLyBib290c3RyYXAgaW5zdGVhZCBvZiByYWNpbmcuIGBfaXNJbml0aWFsaXplZGAgd2FzIHByZXZpb3VzbHkgc2V0IHRvIGB0cnVlYFxuICAgIC8vIHVwIGZyb250LCBzbyBhIHNlY29uZCBjYWxsZXIgKGUuZy4gYSBwb29sZWQgcnVubmVyIHdpdGhcbiAgICAvLyBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPiAxYCBzdGFydGluZyBzZXZlcmFsIGpvYnMgb24gYSBjb2xkIGNoaWxkKSBjb3VsZFxuICAgIC8vIHNraXAgaW5pdGlhbGl6YXRpb24gYW5kIGxvYWQgbW9kZWxzIC8gcGVyZm9ybSBhIGpvYiB3aGlsZSB0aGUgZmlyc3QgY2FsbFxuICAgIC8vIHdhcyBzdGlsbCBhd2FpdGluZyBtb2RlbCBkaXNjb3ZlcnkgYW5kIGluaXRpYWxpemVycy4gTWlycm9ycyBjb25uZWN0QmVhY29uLlxuICAgIGNvbnN0IGluaXRpYWxpemVQcm9taXNlID0gdGhpcy5fcnVuSW5pdGlhbGl6ZSh7aW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uLCB0eXBlfSlcblxuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gaW5pdGlhbGl6ZVByb21pc2VcbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgIHJldHVybiBpbml0aWFsaXplUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBvbmUgc2hhcmVkIGluaXRpYWxpemF0aW9uIGJlaGluZCBhbiBpbmNvbXBhdGlibGUgbGlmZWN5Y2xlIHBoYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jb250aW51ZUFmdGVyV2FpdEZhaWx1cmUgLSBXaGV0aGVyIGEgY29tcGxldGVkIGZhaWxlZCBzaHV0ZG93biBzdGlsbCBwZXJtaXRzIHJlcGxhY2VtZW50IHN0YXJ0dXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBSZXBsYWNlbWVudCBwcm9jZXNzIHR5cGUuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gYXJncy53YWl0Rm9yIC0gTGlmZWN5Y2xlIHBoYXNlIHRoYXQgbXVzdCBzZXR0bGUgZmlyc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBxdWV1ZWQgc3RhcnR1cCBwcm9taXNlLlxuICAgKi9cbiAgX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB0eXBlLCB3YWl0Rm9yfSkge1xuICAgIGlmICh0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlXG5cbiAgICBjb25zdCBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgd2FpdEZvcn0pXG5cbiAgICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UgPT09IHdhaXRGb3IpIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSB3YWl0Rm9yKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBjb25zdCBzaHV0ZG93blByb21pc2UgPSB0aGlzLl9zaHV0ZG93blByb21pc2VcblxuICAgICAgaWYgKHNodXRkb3duUHJvbWlzZSkge1xuICAgICAgICBhd2FpdCB0aGlzLl93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogdHJ1ZSwgd2FpdEZvcjogc2h1dGRvd25Qcm9taXNlfSlcbiAgICAgICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSA9PT0gc2h1dGRvd25Qcm9taXNlKSB0aGlzLl9zaHV0ZG93blByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlICYmIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiAhPT0gdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgY29uc3Qgc3RhbGVJbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG5cbiAgICAgICAgYXdhaXQgc3RhbGVJbml0aWFsaXplUHJvbWlzZVxuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IHN0YWxlSW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pXG4gICAgfSkoKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIHJldHVybiBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhIGxpZmVjeWNsZSBwaGFzZSBiZWZvcmUgcXVldWVkIGluaXRpYWxpemF0aW9uIHByb2NlZWRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdhaXQgcG9saWN5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY29udGludWVBZnRlcldhaXRGYWlsdXJlIC0gV2hldGhlciByZXBsYWNlbWVudCBzdGFydHVwIHJlbWFpbnMgYXZhaWxhYmxlIGFmdGVyIGEgZmFpbGVkIHBoYXNlLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IGFyZ3Mud2FpdEZvciAtIExpZmVjeWNsZSBwaGFzZSB0aGF0IG11c3Qgc2V0dGxlIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHF1ZXVlZCBpbml0aWFsaXphdGlvbiBtYXkgY29udGludWUuXG4gICAqL1xuICBhc3luYyBfd2FpdEZvckluaXRpYWxpemVCbG9ja2VyKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHdhaXRGb3J9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdhaXRGb3JcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUpIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGF0b21pYyBmcmFtZXdvcmsgYW5kIGFwcGxpY2F0aW9uIGluaXRpYWxpemF0aW9uIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSW5pdGlhbGl6YXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAtIEZyYW1ld29yayBtb2RlbCBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gR2VuZXJpYyBhcHBsaWNhdGlvbiBwcm9jZXNzIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBfcnVuSW5pdGlhbGl6ZSh7aW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uLCB0eXBlfSkge1xuICAgIGNvbnN0IHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlID0gIXRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWRcblxuICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkge1xuICAgICAgdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCA9IE9iamVjdC5mcmVlemUoe1xuICAgICAgICBpbnN0YW5jZUlkOiBuZXcgVVVJRCg0KS5mb3JtYXQoKSxcbiAgICAgICAgdHlwZVxuICAgICAgfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplTW9kZWxzKHt0eXBlfSlcblxuICAgICAgLy8gTW9kZWwgaW5pdGlhbGl6YXRpb24gY2FuIGJlIGludmFsaWRhdGVkIGJ5IGEgY29uY3VycmVudCBjb25uZWN0aW9uIGNsb3NlLlxuICAgICAgLy8gSWYgbW9kZWxzIGFyZSBub3QgcmVhZHksIHN0b3Agd2l0aG91dCBtYXJraW5nIHRoZSBjb25maWd1cmF0aW9uIGluaXRpYWxpemVkXG4gICAgICAvLyBzbyB0aGUgbmV4dCBjYWxsZXIgcmV0cmllcyBhIGZ1bGwgYm9vdHN0cmFwLlxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICE9PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24gfHwgIXRoaXMuX21vZGVsc0luaXRpYWxpemVkKSB7XG4gICAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmF1dG9EaXNjb3ZlclJlc291cmNlcyh0aGlzKVxuICAgICAgdGhpcy5fbWVyZ2VEaXNjb3ZlcmVkQWJpbGl0eVJlc291cmNlcygpXG4gICAgICB0aGlzLl92YWxpZGF0ZVJlc291cmNlUmVsYXRpb25zaGlwc09uTW9kZWxzKClcblxuICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlICYmIHRoaXMuX2luaXRpYWxpemVycykge1xuICAgICAgICBjb25zdCBpbml0aWFsaXplcnMgPSBhd2FpdCB0aGlzLl9pbml0aWFsaXplcnMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgICBjb25zdCB7cmVxdWlyZUNvbnRleHQsIC4uLnJlc3RBcmdzfSA9IGluaXRpYWxpemVyc1xuXG4gICAgICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICAgICAgaWYgKHJlcXVpcmVDb250ZXh0KSB7XG4gICAgICAgICAgZm9yIChjb25zdCBpbml0aWFsaXplcktleSBvZiByZXF1aXJlQ29udGV4dC5rZXlzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IEluaXRpYWxpemVyQ2xhc3MgPSByZXF1aXJlQ29udGV4dChpbml0aWFsaXplcktleSkuZGVmYXVsdFxuICAgICAgICAgICAgY29uc3QgcHJvY2Vzc0NvbnRleHQgPSB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0XG5cbiAgICAgICAgICAgIGlmICghcHJvY2Vzc0NvbnRleHQpIHRocm93IG5ldyBFcnJvcihcIkFwcGxpY2F0aW9uIHByb2Nlc3MgY29udGV4dCBpcyBub3QgYXZhaWxhYmxlIGR1cmluZyBpbml0aWFsaXplciBzdGFydHVwXCIpXG5cbiAgICAgICAgICAgIGNvbnN0IGluaXRpYWxpemVySW5zdGFuY2UgPSBuZXcgSW5pdGlhbGl6ZXJDbGFzcyh7Y29uZmlndXJhdGlvbjogdGhpcywgcHJvY2Vzc0NvbnRleHQsIHR5cGV9KVxuXG4gICAgICAgICAgICBhd2FpdCBpbml0aWFsaXplckluc3RhbmNlLnJ1bigpXG4gICAgICAgICAgICB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzLnB1c2goaW5pdGlhbGl6ZXJJbnN0YW5jZSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gdHJ1ZVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHtcbiAgICAgICAgbGV0IHRlYXJkb3duRXJyb3JcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpXG4gICAgICAgIH0gY2F0Y2ggKGNhdWdodFRlYXJkb3duRXJyb3IpIHtcbiAgICAgICAgICB0ZWFyZG93bkVycm9yID0gY2F1Z2h0VGVhcmRvd25FcnJvclxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlYXJkb3duRXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgLi4udGVhcmRvd25FcnJvci5lcnJvcnNdLFxuICAgICAgICAgICAgXCJBcHBsaWNhdGlvbiBwcm9jZXNzIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0ZWFyZG93bkVycm9yICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbZXJyb3IsIHRlYXJkb3duRXJyb3JdLFxuICAgICAgICAgICAgXCJBcHBsaWNhdGlvbiBwcm9jZXNzIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAoIXRoaXMuX2lzSW5pdGlhbGl6ZWQgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRlYXJzIGRvd24gZXZlcnkgc3VjY2Vzc2Z1bGx5IHN0YXJ0ZWQgaW5pdGlhbGl6ZXIgaW4gcmV2ZXJzZSBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSB0ZWFyZG93biBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF90ZWFyZG93blN1Y2Nlc3NmdWxJbml0aWFsaXplcnMoKSB7XG4gICAgY29uc3Qgc3VjY2Vzc2Z1bEluaXRpYWxpemVycyA9IHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMuc3BsaWNlKDApLnJldmVyc2UoKVxuXG4gICAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgICBtZXNzYWdlOiBcIkFwcGxpY2F0aW9uIGluaXRpYWxpemVyIHRlYXJkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IHN1Y2Nlc3NmdWxJbml0aWFsaXplcnMubWFwKChpbml0aWFsaXplcikgPT4gYXN5bmMgKCkgPT4gYXdhaXQgaW5pdGlhbGl6ZXIudGVhcmRvd24oKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqIENsZWFycyBhcHBsaWNhdGlvbi1vd25lZCBsaWZlY3ljbGUgc3RhdGUgYWZ0ZXIgZXZlcnkgdGVhcmRvd24gYXR0ZW1wdC4gKi9cbiAgX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKSB7XG4gICAgdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFRlYXJzIGRvd24gdGhlIGN1cnJlbnQgYXBwbGljYXRpb24gbGlmZWN5Y2xlIG9uY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIEV4YWN0IHNoYXJlZCBzaHV0ZG93biBwcm9taXNlLlxuICAgKi9cbiAgc2h1dGRvd24oKSB7XG4gICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3NodXRkb3duUHJvbWlzZVxuXG4gICAgY29uc3QgaW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIGNvbnN0IHNodXRkb3duUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoaW5pdGlhbGl6ZVByb21pc2UpIGF3YWl0IGluaXRpYWxpemVQcm9taXNlXG4gICAgICAgIGF3YWl0IHRoaXMuX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgdGhpcy5faXNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gc2h1dGRvd25Qcm9taXNlXG5cbiAgICByZXR1cm4gc2h1dGRvd25Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoYXQgcmVzb3VyY2UtZGVmaW5lZCByZWxhdGlvbnNoaXBzIGFyZSBhbHNvIGRlZmluZWQgb24gdGhlIGNvcnJlc3BvbmRpbmcgbW9kZWwgY2xhc3Nlcy5cbiAgICogVGhyb3dzIGFuIGVycm9yIGlmIGEgcmVsYXRpb25zaGlwIGlzIGRlZmluZWQgb24gYSByZXNvdXJjZSBidXQgbWlzc2luZyBmcm9tIHRoZSBtb2RlbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVSZXNvdXJjZVJlbGF0aW9uc2hpcHNPbk1vZGVscygpIHtcbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIHRoaXMuX2JhY2tlbmRQcm9qZWN0cykge1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMocmVzb3VyY2VzKSkge1xuICAgICAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZz8ucmVsYXRpb25zaGlwcykgY29udGludWVcblxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzb3VyY2VDb25maWcucmVsYXRpb25zaGlwcykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlIGZvciAke21vZGVsTmFtZX0gZGVmaW5lcyByZWxhdGlvbnNoaXBzIGFzIGFuIG9iamVjdC4gVXNlIGFuIGFycmF5IGluc3RlYWQ6IHN0YXRpYyByZWxhdGlvbnNoaXBzID0gJHtKU09OLnN0cmluZ2lmeShPYmplY3Qua2V5cyhyZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSl9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGZvciAke21vZGVsTmFtZX0gbXVzdCBiZSBhIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MuYClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgICAgICBjb25zdCBleGlzdGluZ1JlbGF0aW9uc2hpcHMgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVxuXG4gICAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiByZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgICAgaWYgKCEocmVsYXRpb25zaGlwTmFtZSBpbiBleGlzdGluZ1JlbGF0aW9uc2hpcHMpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgIGBSZXNvdXJjZSBmb3IgJHttb2RlbE5hbWV9IGRlZmluZXMgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGJ1dCAke21vZGVsTmFtZX0gbW9kZWwgZG9lcyBub3QuIGAgK1xuICAgICAgICAgICAgICBgQWRkICR7bW9kZWxOYW1lfS5iZWxvbmdzVG8oXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIsIC4uLikgb3IgdGhlIGFwcHJvcHJpYXRlIHJlbGF0aW9uc2hpcCBjYWxsIG9uIHRoZSBtb2RlbCBjbGFzcy5gXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVnaXN0ZXJNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsQ2xhc3Nlc1ttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSA9IG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjdXJyZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDdXJyZW50KCkge1xuICAgIHNldEN1cnJlbnRDb25maWd1cmF0aW9uKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcm91dGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgcm91dGVzLlxuICAgKi9cbiAgZ2V0Um91dGVzKCkgeyByZXR1cm4gdGhpcy5fcm91dGVzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcm91dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHR9IG5ld1JvdXRlcyAtIE5ldyByb3V0ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFJvdXRlcyhuZXdSb3V0ZXMpIHtcbiAgICB0aGlzLl9yb3V0ZXMgPSBuZXdSb3V0ZXNcbiAgICB0aGlzLl9hcHBseVJvdXRlTW91bnRzKG5ld1JvdXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGFueSBgcm91dGUubW91bnQoLi4uKWAgcmVnaXN0cmF0aW9ucyBmcm9tIHRoZSByb3V0ZXMgZmlsZSBieSBsZXR0aW5nXG4gICAqIGVhY2ggbW91bnRhYmxlIHJlZ2lzdGVyIGl0cyByb3V0ZXMgKHR5cGljYWxseSByb3V0ZS1yZXNvbHZlciBob29rcykgYWdhaW5zdFxuICAgKiB0aGlzIGNvbmZpZ3VyYXRpb24uIEd1YXJkZWQgc28gcmVwZWF0ZWQgc2V0Um91dGVzIGNhbGxzIHdpdGggdGhlIHNhbWUgcm91dGVzXG4gICAqIGRvbid0IHJlZ2lzdGVyIGEgbW91bnQgbW9yZSB0aGFuIG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdH0gbmV3Um91dGVzIC0gUm91dGVzIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYXBwbHlSb3V0ZU1vdW50cyhuZXdSb3V0ZXMpIHtcbiAgICBpZiAoIW5ld1JvdXRlcyB8fCB0eXBlb2YgbmV3Um91dGVzLmdldE1vdW50cyAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgbW91bnQgb2YgbmV3Um91dGVzLmdldE1vdW50cygpKSB7XG4gICAgICBpZiAodGhpcy5fYXBwbGllZFJvdXRlTW91bnRzLmhhcyhtb3VudCkpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuX2FwcGxpZWRSb3V0ZU1vdW50cy5hZGQobW91bnQpXG4gICAgICBtb3VudC5tb3VudGFibGUubW91bnRJbnRvKHtjb25maWd1cmF0aW9uOiB0aGlzLCAuLi5tb3VudC5vcHRpb25zfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyBwbHVnaW4vbGlicmFyeSByb3V0ZXMgdXNpbmcgYSBsaWdodHdlaWdodCByb3V0ZSBEU0wgYmFja2VkIGJ5IHJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKiBAcGFyYW0geyhyb3V0ZXM6IGltcG9ydChcIi4vcm91dGVzL3BsdWdpbi1yb3V0ZXMuanNcIikuZGVmYXVsdCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBSb3V0ZXMgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJvdXRlcyhjYWxsYmFjaykge1xuICAgIGNvbnN0IHBsdWdpblJvdXRlcyA9IG5ldyBQbHVnaW5Sb3V0ZXMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuXG4gICAgY2FsbGJhY2socGx1Z2luUm91dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRyYW5zbGF0b3IuXG4gICAqIEBwYXJhbSB7KGFyZzE6IHN0cmluZywgYXJnMjogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkKSA9PiBzdHJpbmd9IGNhbGxiYWNrIC0gVHJhbnNsYXRvciBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VHJhbnNsYXRvcihjYWxsYmFjaykgeyB0aGlzLl90cmFuc2xhdG9yID0gY2FsbGJhY2sgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1zZ0lEIC0gTXNnIGlkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3NdIC0gVHJhbnNsYXRvciBvcHRpb25zIGFuZCB2YXJpYWJsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICovXG4gIF9kZWZhdWx0VHJhbnNsYXRvcihtc2dJRCwgYXJncykge1xuICAgIHRoaXMuX2NvbmZpZ3VyZURlZmF1bHRUcmFuc2xhdG9yKClcblxuICAgIGNvbnN0IHRyYW5zbGF0ZUFyZ3MgPSBhcmdzID8gey4uLmFyZ3N9IDogdW5kZWZpbmVkXG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gdHJhbnNsYXRlQXJncz8uZGVmYXVsdFZhbHVlXG4gICAgY29uc3QgbG9jYWxlcyA9IHRyYW5zbGF0ZUFyZ3M/LmxvY2FsZXNcblxuICAgIGlmICh0cmFuc2xhdGVBcmdzKSB7XG4gICAgICBkZWxldGUgdHJhbnNsYXRlQXJncy5kZWZhdWx0VmFsdWVcbiAgICAgIGRlbGV0ZSB0cmFuc2xhdGVBcmdzLmxvY2FsZXNcbiAgICB9XG5cbiAgICBjb25zdCB2YXJpYWJsZXMgPSB0cmFuc2xhdGVBcmdzICYmIE9iamVjdC5rZXlzKHRyYW5zbGF0ZUFyZ3MpLmxlbmd0aCA+IDAgPyB0cmFuc2xhdGVBcmdzIDogdW5kZWZpbmVkXG5cbiAgICBjb25zdCBsb2NhbGUgPSB0aGlzLmdldExvY2FsZSgpXG4gICAgY29uc3QgcHJlZmVycmVkTG9jYWxlcyA9IGxvY2FsZXMgfHwgKGxvY2FsZSA/IHVuZGVmaW5lZCA6IFtdKVxuICAgIGNvbnN0IG1lc3NhZ2UgPSB0cmFuc2xhdGUobXNnSUQsIHZhcmlhYmxlcywgcHJlZmVycmVkTG9jYWxlcylcblxuICAgIGlmIChtZXNzYWdlID09PSBtc2dJRCAmJiBkZWZhdWx0VmFsdWUpIHJldHVybiB0cmFuc2xhdGUoZGVmYXVsdFZhbHVlLCB2YXJpYWJsZXMsIFtdKVxuXG4gICAgcmV0dXJuIG1lc3NhZ2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cmFuc2xhdG9yLlxuICAgKiBAcmV0dXJucyB7KG1zZ0lEOiBzdHJpbmcsIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHN0cmluZ30gLSBUaGUgY29uZmlndXJlZCB0cmFuc2xhdG9yLlxuICAgKi9cbiAgZ2V0VHJhbnNsYXRvcigpIHtcbiAgICBpZiAodGhpcy5fdHJhbnNsYXRvcikgcmV0dXJuIHRoaXMuX3RyYW5zbGF0b3JcblxuICAgIGlmICghdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZCkge1xuICAgICAgdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZCA9IHRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yLmJpbmQodGhpcylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gQ29uZmlndXJlIGdldHRleHQgZGVmYXVsdHMgZm9yIHRoaXMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9jb25maWd1cmVEZWZhdWx0VHJhbnNsYXRvcigpIHtcbiAgICBjb25zdCBsb2NhbGUgPSB0aGlzLmdldExvY2FsZSgpXG5cbiAgICBnZXR0ZXh0Q29uZmlnLnNldExvY2FsZShsb2NhbGUgfHwgXCJcIilcblxuICAgIGNvbnN0IGZhbGxiYWNrcyA9IGxvY2FsZSA/IHRoaXMuZ2V0TG9jYWxlRmFsbGJhY2tzKCk/Lltsb2NhbGVdIDogW11cblxuICAgIGdldHRleHRDb25maWcuc2V0RmFsbGJhY2tzKGZhbGxiYWNrcyB8fCBbXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lem9uZSBvZmZzZXQgbWludXRlcy5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaGUgdGltZXpvbmUgb2Zmc2V0IGluIG1pbnV0ZXMuXG4gICAqL1xuICBnZXRUaW1lem9uZU9mZnNldE1pbnV0ZXMoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY29uc3QgY29uZmlndXJlZE9mZnNldCA9IHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcygpXG5cbiAgICAgIGlmICh0eXBlb2YgY29uZmlndXJlZE9mZnNldCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIGNvbmZpZ3VyZWRPZmZzZXRcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlc1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgRGF0ZSgpLmdldFRpbWV6b25lT2Zmc2V0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lIHpvbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0VGltZVpvbmUoKSB7XG4gICAgY29uc3QgdGltZVpvbmUgPSB0eXBlb2YgdGhpcy5fdGltZVpvbmUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyB0aGlzLl90aW1lWm9uZSgpXG4gICAgICA6IHRoaXMuX3RpbWVab25lXG5cbiAgICBpZiAodGltZVpvbmUgPT09IHVuZGVmaW5lZCB8fCB0aW1lWm9uZSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiY29uZmlndXJhdGlvbiB0aW1lWm9uZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBldmVudHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IGV2ZW50cy5cbiAgICovXG4gIGdldFdlYnNvY2tldEV2ZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMuanNcIikuZGVmYXVsdH0gd2Vic29ja2V0RXZlbnRzIC0gV2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0V2Vic29ja2V0RXZlbnRzKHdlYnNvY2tldEV2ZW50cykge1xuICAgIHRoaXMuX3dlYnNvY2tldEV2ZW50cyA9IHdlYnNvY2tldEV2ZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFBlci1wcm9jZXNzIHJlZ2lzdHJ5IG9mIGNoYW5uZWwgc3Vic2NyaWJlcnMgdXNlZCBieSB3b3JrZXIgY29kZSB0aGF0XG4gICAqIG5lZWRzIHRvIHJlYWN0IHRvIGV2ZW50cyBicm9hZGNhc3QgdmlhIGB3ZWJzb2NrZXRFdmVudHNIb3N0LnB1Ymxpc2goLi4uKWBcbiAgICogd2l0aG91dCBob2xkaW5nIGFuIGFjdHVhbCB3ZWJzb2NrZXQgc2Vzc2lvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanNcIikuZGVmYXVsdH0gLSBUaGUgY2hhbm5lbCBzdWJzY3JpYmVycyByZWdpc3RyeS5cbiAgICovXG4gIGdldFdlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycygpIHtcbiAgICBpZiAoIXRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycykge1xuICAgICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzID0gbmV3IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjaGFubmVsIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldENoYW5uZWxSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBjaGFubmVsIHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBgVmVsb2Npb3VzV2Vic29ja2V0Q29ubmVjdGlvbmAgc3ViY2xhc3MgdW5kZXIgYSBuYW1lLlxuICAgKiBDbGllbnRzIHRoYXQgc2VuZCBge3R5cGU6IFwiY29ubmVjdGlvbi1vcGVuXCIsIGNvbm5lY3Rpb25UeXBlOiBuYW1lfWBcbiAgICogd2lsbCBoYXZlIHRoaXMgY2xhc3MgaW5zdGFudGlhdGVkIGZvciB0aGVpciBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENsaWVudC1mYWNpbmcgY29ubmVjdGlvbiB0eXBlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdH0gQ29ubmVjdGlvbkNsYXNzIC0gV2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVnaXN0ZXJXZWJzb2NrZXRDb25uZWN0aW9uKG5hbWUsIENvbm5lY3Rpb25DbGFzcykge1xuICAgIGlmICghbmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbiBuYW1lIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCFDb25uZWN0aW9uQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIkNvbm5lY3Rpb25DbGFzcyBpcyByZXF1aXJlZFwiKVxuICAgIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzLnNldChuYW1lLCBDb25uZWN0aW9uQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29ubmVjdGlvbiB0eXBlIG5hbWUgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jb25uZWN0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gUmVnaXN0ZXJlZCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICovXG4gIGdldFdlYnNvY2tldENvbm5lY3Rpb25DbGFzcyhuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzLmdldChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsYCBzdWJjbGFzcyB1bmRlciBhIG5hbWUuXG4gICAqIENsaWVudHMgc3Vic2NyaWJlIHZpYSBge3R5cGU6IFwiY2hhbm5lbC1zdWJzY3JpYmVcIiwgY2hhbm5lbFR5cGU6IG5hbWUsIC4uLn1gLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENsaWVudC1mYWNpbmcgY2hhbm5lbCB0eXBlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gQ2hhbm5lbENsYXNzIC0gV2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7e2xpdmVPbmx5PzogYm9vbGVhbn19IFtvcHRpb25zXSAtIFJlZ2lzdHJhdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChuYW1lLCBDaGFubmVsQ2xhc3MsIHtsaXZlT25seSA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKCFuYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJDaGFubmVsIG5hbWUgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIUNoYW5uZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ2hhbm5lbENsYXNzIGlzIHJlcXVpcmVkXCIpXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMuc2V0KG5hbWUsIENoYW5uZWxDbGFzcylcblxuICAgIGlmIChsaXZlT25seSkgdGhpcy5fbGl2ZU9ubHlXZWJzb2NrZXRDaGFubmVscy5hZGQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBSZWdpc3RlcmVkIHdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbENsYXNzKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMuZ2V0KG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGNoYW5uZWwgdHlwZSB3YXMgcmVnaXN0ZXJlZCB3aXRoIGB7bGl2ZU9ubHk6IHRydWV9YC5cbiAgICogTGl2ZS1vbmx5IGNoYW5uZWxzIGFyZSBuZXZlciBwZXJzaXN0ZWQgZm9yIHJlcGxheTogdGhlIGV2ZW50LWxvZ1xuICAgKiBzdG9yZSdzIGBtYXJrQ2hhbm5lbEludGVyZXN0ZWRgIHRocm93cyBmb3IgdGhlaXIgbmFtZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIG5hbWUgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2hhbm5lbCBpcyBkZWNsYXJlZCBsaXZlLW9ubHkuXG4gICAqL1xuICBpc1dlYnNvY2tldENoYW5uZWxMaXZlT25seShuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX2xpdmVPbmx5V2Vic29ja2V0Q2hhbm5lbHMuaGFzKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgbGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiBpbiB0aGUgZ2xvYmFsIHJvdXRpbmcgcmVnaXN0cnkuXG4gICAqIENhbGxlZCBieSB0aGUgc2Vzc2lvbiB3aGVuIGBjYW5TdWJzY3JpYmUoKWAgcmVzb2x2ZXMgdHJ1dGh5OyB0aGVcbiAgICogc2Vzc2lvbiBjYWxscyBgX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uYCBvbiB1bnN1YnNjcmliZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgdXNlZCBhcyB0aGUgcm91dGluZyBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBzdWJzY3JpcHRpb24gLSBMaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIHRvIHJlZ2lzdGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb24obmFtZSwgc3Vic2NyaXB0aW9uKSB7XG4gICAgbGV0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHtcbiAgICAgIGJ1Y2tldCA9IG5ldyBTZXQoKVxuICAgICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuc2V0KG5hbWUsIGJ1Y2tldClcbiAgICB9XG5cbiAgICBidWNrZXQuYWRkKHN1YnNjcmlwdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVucmVnaXN0ZXIgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSB1c2VkIGFzIHRoZSByb3V0aW5nIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIExpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gdG8gcmVtb3ZlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF91bnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihuYW1lLCBzdWJzY3JpcHRpb24pIHtcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5nZXQobmFtZSlcblxuICAgIGlmICghYnVja2V0KSByZXR1cm5cblxuICAgIGJ1Y2tldC5kZWxldGUoc3Vic2NyaXB0aW9uKVxuXG4gICAgaWYgKGJ1Y2tldC5zaXplID09PSAwKSB7XG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5kZWxldGUobmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsaXZlcnMgYGJvZHlgIHRvIGV2ZXJ5IGxpdmUgc3Vic2NyaWJlciBvZiBgbmFtZWAgd2hvc2VcbiAgICogYG1hdGNoZXMoYnJvYWRjYXN0UGFyYW1zKWAgcmV0dXJucyB0cnVlLiBQdXJlIHJvdXRpbmcg4oCUIG5vIGF1dGhcbiAgICogcmUtY2hlY2ssIG5vIHBlcnNpc3RlbmNlLiBTdWJzY3JpYmVycyB3aG8gd2VyZSBhZG1pdHRlZCBieVxuICAgKiBgY2FuU3Vic2NyaWJlKClgIGNvbnRpbnVlIHRvIHJlY2VpdmUgYnJvYWRjYXN0cyB1bnRpbCB0aGV5XG4gICAqIHVuc3Vic2NyaWJlIG9yIHRoZSBzZXNzaW9uIGVuZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXNcbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keVxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBncmFjZSBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEdyYWNlIHBlcmlvZCAoc2Vjb25kcykgYmVmb3JlIGEgcGF1c2VkIFdTIHNlc3Npb24gaXMgdG9ybiBkb3duLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcygpIHsgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBoZWFydGJlYXQgc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBJbnRlcnZhbCAoc2Vjb25kcykgYmV0d2VlbiBzZXJ2ZXLihpJjbGllbnQgaGVhcnRiZWF0IHBpbmdzOyAwIGRpc2FibGVzIHJlYXBpbmcuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcygpIHsgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzIH1cblxuICAvKipcbiAgICogR2V0cyBwZXItc2Vzc2lvbiBXZWJTb2NrZXQgaW5ib3VuZCBtZXNzYWdlIHF1ZXVlIGxpbWl0cy5cbiAgICogQHJldHVybnMge3ttYXhCeXRlczogbnVtYmVyLCBtYXhNZXNzYWdlczogbnVtYmVyfX0gLSBQZXItc2Vzc2lvbiBpbmJvdW5kIHF1ZXVlIGhpZ2gtd2F0ZXIgbWFya3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRJbmJvdW5kUXVldWVMaW1pdHMoKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLmh0dHBTZXJ2ZXIud2Vic29ja2V0SW5ib3VuZFF1ZXVlXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWF4Qnl0ZXM6IHF1ZXVlLm1heFBlbmRpbmdCeXRlcyxcbiAgICAgIG1heE1lc3NhZ2VzOiBxdWV1ZS5tYXhQZW5kaW5nTWVzc2FnZXNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBwZXItY2xpZW50IFdlYlNvY2tldCBvdXRib3VuZCBxdWV1ZSBsaW1pdHMuXG4gICAqIEByZXR1cm5zIHt7bWF4Qnl0ZXM6IG51bWJlciwgbWF4RnJhbWVzOiBudW1iZXJ9fSAtIFBlci1jbGllbnQgb3V0Ym91bmQgcXVldWUgaGlnaC13YXRlciBtYXJrcy5cbiAgICovXG4gIGdldFdlYnNvY2tldE91dGJvdW5kUXVldWVMaW1pdHMoKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLmh0dHBTZXJ2ZXIud2Vic29ja2V0T3V0Ym91bmRRdWV1ZVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1heEJ5dGVzOiBxdWV1ZS5tYXhQZW5kaW5nQnl0ZXMsXG4gICAgICBtYXhGcmFtZXM6IHF1ZXVlLm1heFBlbmRpbmdGcmFtZXNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgd3JhcHBlciBpbnZva2VkIGFyb3VuZCBldmVyeSBXUy1ib3JuZSByZXF1ZXN0IC9cbiAgICogY29ubmVjdGlvbiBtZXNzYWdlIC8gY2hhbm5lbCBkaXNwYXRjaC4gVGhlIHdyYXBwZXIgcmVjZWl2ZXMgdGhlXG4gICAqIHNlc3Npb24gYW5kIGEgYG5leHRgIGNhbGxiYWNrOyBpdCBtdXN0IGNhbGwgYG5leHQoKWAgdG8gcnVuIHRoZVxuICAgKiBoYW5kbGVyLiBVc2UgaXQgdG8gc2V0IHVwIEFzeW5jTG9jYWxTdG9yYWdlIHBlciByZXF1ZXN0LlxuICAgKiBAcGFyYW0geygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSB3cmFwcGVyIC0gUGVyLW1lc3NhZ2Ugc2Vzc2lvbi1jb250ZXh0IHdyYXBwZXIsIG9yIG51bGwgdG8gZGlzYWJsZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRBcm91bmRSZXF1ZXN0KHdyYXBwZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0ID0gd3JhcHBlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBhcm91bmQgcmVxdWVzdC5cbiAgICogQHJldHVybnMgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAtIFdlYnNvY2tldCBzZXNzaW9uIHdyYXBwZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRBcm91bmRSZXF1ZXN0KCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgd3JhcHBlciBpbnZva2VkIGFyb3VuZCBldmVyeSBjb250cm9sbGVyIGFjdGlvbiDigJQgYm90aFxuICAgKiBIVFRQIGFuZCBXUy1ib3JuZS4gUmVjZWl2ZXMgYHtyZXF1ZXN0LCByZXNwb25zZSwgbmV4dH1gIGFuZCBtdXN0XG4gICAqIGNhbGwgYG5leHQoKWAgdG8gcnVuIHRoZSBhY3Rpb24uIFVzZSBpdCBmb3IgcGVyLXJlcXVlc3QgY29udGV4dFxuICAgKiBsaWtlIEFzeW5jTG9jYWxTdG9yYWdlLXNjb3BlZCBsb2NhbGUgb3IgdHJhY2luZy5cbiAgICogQHBhcmFtIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gd3JhcHBlciAtIFBlci1hY3Rpb24gcmVxdWVzdC1jb250ZXh0IHdyYXBwZXIsIG9yIG51bGwgdG8gZGlzYWJsZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRBcm91bmRBY3Rpb24od3JhcHBlcikge1xuICAgIHRoaXMuX2Fyb3VuZEFjdGlvbiA9IHdyYXBwZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcm91bmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7KChjb250ZXh0OiB7cmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgcmVzcG9uc2U6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD59KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gSFRUUCByZXF1ZXN0IHdyYXBwZXIuXG4gICAqL1xuICBnZXRBcm91bmRBY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Fyb3VuZEFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhbiBpZGVudGl0eSByZXNvbHZlciBjYWxsZWQgb25jZSBhdCBwYXVzZSB0aW1lIGFuZCBvbmNlXG4gICAqIGF0IHJlc3VtZSB0aW1lLiBUaGUgcmVzb2x2ZXIgcmVjZWl2ZXMgdGhlIHNlc3Npb24gYW5kIHJldHVybnMgYW55XG4gICAqIHZhbHVlIHRoYXQgaWRlbnRpZmllcyB0aGUgYXV0aGVudGljYXRlZCBjYWxsZXIg4oCUIHR5cGljYWxseSBhXG4gICAqIGB1c2VySWRgIHJlYWQgZnJvbSB0aGUgc2Vzc2lvbidzIHVwZ3JhZGUtcmVxdWVzdCBjb29raWUuIFZlbG9jaW91c1xuICAgKiBjYXB0dXJlcyB0aGUgcGF1c2UtdGltZSB2YWx1ZSBvbiB0aGUgcGF1c2VkIHNlc3Npb24gYW5kIGNvbXBhcmVzXG4gICAqIGl0IHZpYSBgPT09YCAob3IgZGVlcC1lcXVhbGl0eSBmb3IgcGxhaW4gb2JqZWN0cykgdG8gdGhlIGZyZXNoXG4gICAqIHJlc3VtZS10aW1lIHZhbHVlLiBJZiB0aGV5IGRpZmZlciwgdGhlIHJlc3VtZSBpcyByZWplY3RlZCB3aXRoXG4gICAqIGBzZXNzaW9uLWdvbmVgIGFuZCB0aGUgcGF1c2VkIHNlc3Npb24gaXMgZGVzdHJveWVkIHNvIGEgc2lnbmVkLW91dFxuICAgKiBvciByZS1hdXRoZW50aWNhdGVkIGNsaWVudCBjYW5ub3QgcmVjbGFpbSBhbm90aGVyIHVzZXIncyBzdGF0ZS5cbiAgICpcbiAgICogUmV0dXJuIGBudWxsYC9gdW5kZWZpbmVkYCB0byBtZWFuIFwibm8gaWRlbnRpdHlcIiDigJQgcmVzdW1lcyBzdGlsbFxuICAgKiBzdWNjZWVkIGlmIHBhdXNlIGFuZCByZXN1bWUgYm90aCByZXNvbHZlIHRvIGEgbnVsbGlzaCB2YWx1ZS5cbiAgICogQHBhcmFtIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgbnVsbH0gcmVzb2x2ZXIgLSBBdXRoZW50aWNhdGVkLWNhbGxlciBpZGVudGl0eSByZXNvbHZlciwgb3IgbnVsbCB0byBkaXNhYmxlIGlkZW50aXR5IGNoZWNrcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBpZGVudGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSAtIFRoZSBjb25maWd1cmVkIGlkZW50aXR5IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IHNlc3Npb24gZ3JhY2Ugc2Vjb25kcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBHcmFjZSBwZXJpb2QgYmVmb3JlIGEgcGF1c2VkIHNlc3Npb24gZXhwaXJlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzKHNlY29uZHMpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShzZWNvbmRzKSB8fCBzZWNvbmRzIDwgMCkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGdyYWNlIHNlY29uZHM6ICR7c2Vjb25kc31gKVxuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgPSBzZWNvbmRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IHNlc3Npb24gaGVhcnRiZWF0IHNlY29uZHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzZWNvbmRzIC0gSGVhcnRiZWF0IGludGVydmFsLCB3aXRoIHplcm8gZGlzYWJsaW5nIHJlYXBpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMoc2Vjb25kcykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNlY29uZHMpIHx8IHNlY29uZHMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgaGVhcnRiZWF0IHNlY29uZHM6ICR7c2Vjb25kc31gKVxuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzID0gc2Vjb25kc1xuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIGEgc2Vzc2lvbiBpbnRvIHRoZSBwYXVzZWQgcmVnaXN0cnkgYW5kIHN0YXJ0cyB0aGUgZ3JhY2VcbiAgICogdGltZXIuIFdoZW4gdGhlIHRpbWVyIGZpcmVzLCB0aGUgc2Vzc2lvbidzIHBlcm1hbmVudCB0ZWFyZG93blxuICAgKiBob29rIGlzIGludm9rZWQuIENhbGxlZCBieSB0aGUgc2Vzc2lvbiBpdHNlbGYgZnJvbSBgX2hhbmRsZUNsb3NlYFxuICAgKiB3aGVuIHRoZXJlIGlzIHJlc3VtYWJsZSBzdGF0ZSAobGl2ZSBDb25uZWN0aW9ucyAvIENoYW5uZWwgc3VicykuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdH0gc2Vzc2lvbiAtIFJlc3VtYWJsZSBzZXNzaW9uIHRvIHJldGFpbiBkdXJpbmcgaXRzIGdyYWNlIHBlcmlvZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcGF1c2VXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb24pIHtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBzZXNzaW9uLnNlc3Npb25JZFxuXG4gICAgaWYgKCFzZXNzaW9uSWQpIHRocm93IG5ldyBFcnJvcihcIlNlc3Npb24gbXVzdCBoYXZlIGEgc2Vzc2lvbklkIHRvIGJlIHBhdXNlZFwiKVxuICAgIGlmICh0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5oYXMoc2Vzc2lvbklkKSkgcmV0dXJuXG5cbiAgICBjb25zdCBncmFjZU1zID0gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyAqIDEwMDBcbiAgICBjb25zdCBncmFjZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9leHBpcmVXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZClcbiAgICB9LCBncmFjZU1zKVxuXG4gICAgLy8gRG9uJ3Qga2VlcCB0aGUgcHJvY2VzcyBhbGl2ZSBwdXJlbHkgZm9yIGEgcGF1c2VkIHNlc3Npb24gdGltZXIuXG4gICAgaWYgKHR5cGVvZiBncmFjZVRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIGdyYWNlVGltZXIudW5yZWYoKVxuXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuc2V0KHNlc3Npb25JZCwge3Nlc3Npb24sIGdyYWNlVGltZXIsIHBhdXNlZEF0OiBEYXRlLm5vdygpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb29rcyB1cCBhIHBhdXNlZCBzZXNzaW9uIGJ5IGlkIChkb2VzIE5PVCByZW1vdmUgaXQg4oCUIGNhbGxlciBpc1xuICAgKiBleHBlY3RlZCB0byBjYWxsIGBfcmVzdW1lV2Vic29ja2V0U2Vzc2lvbmAgdG8gY29tcGxldGUgdGhlIGhhbmRvZmYpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gUGF1c2VkIHNlc3Npb24gaWRlbnRpZmllciB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCB8IG51bGx9IC0gUGF1c2VkIHNlc3Npb24gd2l0aCB0aGUgcmVxdWVzdGVkIGlkZW50aWZpZXIsIGlmIHByZXNlbnQuXG4gICAqL1xuICBfZmluZFBhdXNlZFdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmdldChzZXNzaW9uSWQpPy5zZXNzaW9uIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgcGF1c2VkIHNlc3Npb24gZnJvbSB0aGUgcmVnaXN0cnkgYW5kIGNhbmNlbHMgaXRzIGdyYWNlXG4gICAqIHRpbWVyLiBDYWxsZWQgb24gc3VjY2Vzc2Z1bCByZXN1bWUgaGFuZG9mZiBhbmQgb24gZXhwbGljaXRcbiAgICogZXhwaXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gUGF1c2VkIHNlc3Npb24gaWRlbnRpZmllciB0byByZW1vdmUgYW5kIGNhbmNlbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJQYXVzZWRXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZClcblxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgY2xlYXJUaW1lb3V0KGVudHJ5LmdyYWNlVGltZXIpXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZGVsZXRlKHNlc3Npb25JZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFjZS10aW1lciBjYWxsYmFjay4gQ2FsbHMgdGhlIHNlc3Npb24ncyBwZXJtYW5lbnQtdGVhcmRvd25cbiAgICogaG9vayBhbmQgZHJvcHMgaXQgZnJvbSB0aGUgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHdob3NlIGdyYWNlIHBlcmlvZCBleHBpcmVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9leHBpcmVXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZClcblxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZGVsZXRlKHNlc3Npb25JZClcbiAgICB0cnkge1xuICAgICAgZW50cnkuc2Vzc2lvbi5fZmluYWxpemVHcmFjZUV4cGlyeSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBmaW5hbGl6ZSBleHBpcmVkIFdTIHNlc3Npb24gJHtzZXNzaW9uSWR9YCwgZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnJvYWRjYXN0IHRvIGNoYW5uZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHJlY2VpdmluZyB0aGUgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gVmFsdWVzIHVzZWQgdG8gbWF0Y2ggZWxpZ2libGUgc3Vic2NyaXB0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIEJyb2FkY2FzdCBwYXlsb2FkIGRlbGl2ZXJlZCB0byBtYXRjaGluZyBzdWJzY3JpcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGJyb2FkY2FzdFRvQ2hhbm5lbChuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHkpIHtcbiAgICAvLyBXaGVuIEJlYWNvbiBpcyBjb25uZWN0ZWQsIHNoaXAgdGhlIGJyb2FkY2FzdCBvbnRvIHRoZSBidXMuIFRoZVxuICAgIC8vIGRhZW1vbiBlY2hvZXMgaXQgYmFjayB0byBldmVyeSBwZWVyIChpbmNsdWRpbmcgdGhpcyBvbmUpIGFuZFxuICAgIC8vIGVhY2ggcGVlcidzIGBfZGVsaXZlckJyb2FkY2FzdEZyb21CZWFjb25gIHBlcmZvcm1zIHRoZSBzYW1lXG4gICAgLy8gbG9jYWwgZGVsaXZlcnkgYXMgdGhlIHN5bmNocm9ub3VzIHBhdGhzIGJlbG93IOKAlCBzbyBldmVyeVxuICAgIC8vIHN1YnNjcmliZXIsIGluIGFueSBwcm9jZXNzLCBzZWVzIGJyb2FkY2FzdHMgdmlhIGEgc2luZ2xlIGNvZGVcbiAgICAvLyBwYXRoLlxuICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQgJiYgdGhpcy5fYmVhY29uQ2xpZW50LmlzQ29ubmVjdGVkKCkpIHtcbiAgICAgIGNvbnN0IHNlbnQgPSB0aGlzLl9iZWFjb25DbGllbnQucHVibGlzaCh7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5fSlcblxuICAgICAgaWYgKHNlbnQpIHJldHVyblxuICAgIH1cblxuICAgIC8vIFYyIHN1YnNjcmlwdGlvbnMgbGl2ZSBwZXIgd29ya2VyLXRocmVhZC4gV2hlbiBydW5uaW5nIGluXG4gICAgLy8gd29ya2VyLXRocmVhZCBtb2RlLCB0aGUgcHVibGlzaGVyIHJ1bnMgZWl0aGVyIGluIHRoZSBtYWluXG4gICAgLy8gcHJvY2VzcyAoaG9zdCkgb3IgaW4gb25lIG9mIHRoZSB3b3JrZXJzOlxuICAgIC8vXG4gICAgLy8gIC0gTWFpbiBwcm9jZXNzOiBgX3dlYnNvY2tldEV2ZW50c2AgaXMgdGhlIGhvc3Qgc2luZ2xldG9uIGFuZFxuICAgIC8vICAgIGBicm9hZGNhc3RWMmAgZmFucyBvdXQgdG8gZXZlcnkgd29ya2VyIGRpcmVjdGx5LlxuICAgIC8vICAtIFdvcmtlcjogYF93ZWJzb2NrZXRFdmVudHNgIGhhcyBgcHVibGlzaFYyQnJvYWRjYXN0YCB0aGF0XG4gICAgLy8gICAgcG9zdHMgdG8gbWFpbiwgd2hpY2ggdGhlbiBmYW5zIG91dCB0byBldmVyeSB3b3JrZXIuXG4gICAgLy9cbiAgICAvLyBJbi1wcm9jZXNzIG1vZGUgZG9lc24ndCBpbnN0YWxsIGEgd2Vic29ja2V0LWV2ZW50cyB0cmFuc3BvcnQsXG4gICAgLy8gc28gZmFsbCB0aHJvdWdoIHRvIHRoZSBsb2NhbCBkaXNwYXRjaC5cbiAgICAvKipcbiAgICAgKiBXZWJzb2NrZXQgZXZlbnRzLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBjb25zdCB3ZWJzb2NrZXRFdmVudHMgPSB0aGlzLl93ZWJzb2NrZXRFdmVudHNcblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIoe2NoYW5uZWw6IG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSwgY29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMucHVibGlzaFYyQnJvYWRjYXN0ID09PSBcImZ1bmN0aW9uXCIgJiYgd2Vic29ja2V0RXZlbnRzLnBhcmVudFBvcnQpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5wdWJsaXNoVjJCcm9hZGNhc3Qoe2NoYW5uZWw6IG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIGFsbCBwZW5kaW5nIGJyb2FkY2FzdCBvcGVyYXRpb25zIChpbmNsdWRpbmcgZXZlbnQtbG9nXG4gICAqIHBlcnNpc3RlbmNlKS4gQ2FsbCB0aGlzIGFmdGVyIGBicm9hZGNhc3RUb0NoYW5uZWxgIHdoZW4geW91IG5lZWRcbiAgICogdGhlIGV2ZW50IHRvIGJlIHBlcnNpc3RlZCBiZWZvcmUgY29udGludWluZyAoZS5nLiBiZWZvcmVcbiAgICogcmVzcG9uZGluZyB0byBhbiBIVFRQIHJlcXVlc3QpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMoKSB7XG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYXdhaXRQZW5kaW5nQnJvYWRjYXN0cyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAvLyBEcmFpbiB0aGUgaG9zdC93b3JrZXIgcHVibGlzaCBxdWV1ZXMgKGluY2x1ZGluZyBldmVudC1sb2cgcGVyc2lzdGVuY2UpXG4gICAgICAvLyBiZWZvcmUgZHJhaW5pbmcgbG9jYWwgZGVsaXZlcmllcywgYmVjYXVzZSBob3N0IGRpc3BhdGNoIGxhdW5jaGVzIHRoZVxuICAgICAgLy8gbG9jYWwgZGVsaXZlcmllcyBzeW5jaHJvbm91c2x5IGFuZCB0aGV5IG11c3QgYmUgcGFydCBvZiB0aGUgc25hcHNob3QuXG4gICAgICBhd2FpdCB3ZWJzb2NrZXRFdmVudHMuYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYXdhaXRMb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIExvY2FsIChwZXItd29ya2VyKSBjaGFubmVsIGJyb2FkY2FzdCBkaXNwYXRjaC4gQ2FsbGVkIGVpdGhlclxuICAgKiBkaXJlY3RseSAoaW4tcHJvY2VzcyBtb2RlKSBvciBieSB0aGUgd29ya2VyIHRocmVhZCBhZnRlciB0aGVcbiAgICogbWFpbi1wcm9jZXNzIGZhbi1vdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gUGFyYW1zIHBhc3NlZCB0byBlYWNoIHN1YnNjcmlwdGlvbidzIGBtYXRjaGVzKClgLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gTWVzc2FnZSBib2R5IGRlbGl2ZXJlZCB2aWEgYHNlbmRNZXNzYWdlKClgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0QnJvYWRjYXN0TWV0YWRhdGF9IFttZXRhXSAtIE9wdGlvbmFsIGV2ZW50IG1ldGFkYXRhIGZvciByZXBsYXkgdHJhY2tpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSwgbWV0YSkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgYnVja2V0KSB7XG4gICAgICBpZiAoc3Vic2NyaXB0aW9uLmlzQ2xvc2VkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGxldCBtYXRjaGVzXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIG1hdGNoZXMgPSBzdWJzY3JpcHRpb24ubWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMgfHwge30pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBBIGJyb2tlbiBgbWF0Y2hlcygpYCBvbiBvbmUgc3Vic2NyaWJlciBtdXN0IG5vdCBwb2lzb24gdGhlXG4gICAgICAgIC8vIGJyb2FkY2FzdCB0byBvdGhlciBzdWJzY3JpYmVycy4gU2tpcCBhbmQgY29udGludWUuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYGJyb2FkY2FzdFRvQ2hhbm5lbDogJHtuYW1lfSBzdWJzY3JpcHRpb24gJHtzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWR9IG1hdGNoZXMoKSB0aHJld2AsIGVycm9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1hdGNoZXMpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRlbGl2ZXJ5TWV0YWRhdGEgPSB7XG4gICAgICAgIGJyb2FkY2FzdFBhcmFtcyxcbiAgICAgICAgLi4uKG1ldGE/LmV2ZW50SWQgPyB7ZXZlbnRJZDogbWV0YS5ldmVudElkfSA6IHt9KVxuICAgICAgfVxuICAgICAgY29uc3QgcHJldmlvdXNEZWxpdmVyeSA9IHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5nZXQoc3Vic2NyaXB0aW9uKVxuICAgICAgY29uc3QgZGVsaXZlcnkgPSB0aGlzLndpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHRzKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICAgIHJldHVybiAocHJldmlvdXNEZWxpdmVyeSB8fCBQcm9taXNlLnJlc29sdmUoKSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuX2RlbGl2ZXJXZWJzb2NrZXRDaGFubmVsQnJvYWRjYXN0KHN1YnNjcmlwdGlvbiwgYm9keSwgZGVsaXZlcnlNZXRhZGF0YSkpXG4gICAgICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYGJyb2FkY2FzdFRvQ2hhbm5lbDogJHtuYW1lfSBzdWJzY3JpcHRpb24gJHtzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWR9IGRlbGl2ZXJCcm9hZGNhc3QgdGhyZXdgLCBlcnJvcilcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICB9KVxuXG4gICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuc2V0KHN1YnNjcmlwdGlvbiwgZGVsaXZlcnkpXG5cbiAgICAgIC8vIEtlZXAgdGhlIGZpcmUtYW5kLWZvcmdldCBkZWxpdmVyeSAobmV2ZXIgYXdhaXRlZCBhdCBicm9hZGNhc3QgdGltZSkgYnV0XG4gICAgICAvLyB0cmFjayBpdCBzbyBgYXdhaXRQZW5kaW5nQnJvYWRjYXN0c2AgY2FuIGRyYWluIGl0IGJlZm9yZSBzZXR0bGluZy4gUmVtb3ZlXG4gICAgICAvLyBvbiBzZXR0bGU7IHRoZSBmYWlsdXJlIGhhbmRsZXIgYWxzbyBzYXRpc2ZpZXMgdGhlIHByb21pc2Ugc28gYSByZWplY3RlZFxuICAgICAgLy8gZGVsaXZlcnkgbmV2ZXIgYmVjb21lcyBhbiB1bmhhbmRsZWQgcmVqZWN0aW9uLlxuICAgICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzLmFkZChkZWxpdmVyeSlcblxuICAgICAgLyoqXG4gICAgICAgKiBSZW1vdmVzIGEgc2V0dGxlZCBkZWxpdmVyeSBmcm9tIGxvY2FsIHRyYWNraW5nLlxuICAgICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICAgKi9cbiAgICAgIGNvbnN0IGZvcmdldERlbGl2ZXJ5ID0gKCkgPT4ge1xuICAgICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMuZGVsZXRlKGRlbGl2ZXJ5KVxuICAgICAgICBpZiAodGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLmdldChzdWJzY3JpcHRpb24pID09PSBkZWxpdmVyeSkgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLmRlbGV0ZShzdWJzY3JpcHRpb24pXG4gICAgICB9XG5cbiAgICAgIGRlbGl2ZXJ5LnRoZW4oZm9yZ2V0RGVsaXZlcnksIGZvcmdldERlbGl2ZXJ5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYSBzbmFwc2hvdCBvZiB0aGUgaW4tZmxpZ2h0IGxvY2FsIChwZXItcHJvY2Vzcykgd2Vic29ja2V0IGNoYW5uZWxcbiAgICogYnJvYWRjYXN0IGRlbGl2ZXJpZXMuIENhbGxlZCBmcm9tIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBhZnRlciB0aGUgaG9zdFxuICAgKiBwdWJsaXNoIHF1ZXVlcyBkcmFpbiwgc28gZXZlcnkgZGVsaXZlcnkgdGhvc2UgcXVldWVzIGxhdW5jaGVkIGlzIGNhcHR1cmVkLlxuICAgKiBOZXcgZGVsaXZlcmllcyBlbnF1ZXVlZCBhZnRlciB0aGUgc25hcHNob3QgYXJlIG5vdCBhd2FpdGVkLiBJbmRpdmlkdWFsXG4gICAqIGRlbGl2ZXJ5IGVycm9ycyBhcmUgaXNvbGF0ZWQgcGVyIHN1YnNjcmliZXIg4oCUIHRoZSBkZWxpdmVyeSBjaGFpbiBhbHJlYWR5XG4gICAqIGxvZ3MgdGhlbSBhbmQgcmVzb2x2ZXMg4oCUIHNvIGEgc25hcHNob3R0ZWQgcmVqZWN0aW9uIG5ldmVyIGZhaWxzIHRoaXMgYmFycmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXdhaXRMb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMoKSB7XG4gICAgY29uc3Qgc25hcHNob3QgPSBbLi4udGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzXVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHNuYXBzaG90KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciB3ZWJzb2NrZXQgY2hhbm5lbCBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBzdWJzY3JpcHRpb24gLSBDaGFubmVsIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEpzb25WYWx1ZX0gYm9keSAtIEJyb2FkY2FzdCBib2R5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0QnJvYWRjYXN0TWV0YWRhdGF9IG1ldGEgLSBCcm9hZGNhc3QgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gQnJvYWRjYXN0IGRlbGl2ZXJ5IHJlc3VsdC5cbiAgICovXG4gIF9kZWxpdmVyV2Vic29ja2V0Q2hhbm5lbEJyb2FkY2FzdChzdWJzY3JpcHRpb24sIGJvZHksIG1ldGEpIHtcbiAgICBpZiAodHlwZW9mIHN1YnNjcmlwdGlvbi5kZWxpdmVyQnJvYWRjYXN0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBzdWJzY3JpcHRpb24uZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKVxuICAgIH1cblxuICAgIHJldHVybiBzdWJzY3JpcHRpb24uc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSB3ZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBjaGFubmVsIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJUeXBlfSByZXNvbHZlciAtIFJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRXZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIgPSByZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJUeXBlfSByZXNvbHZlciAtIFJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRXZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyKHJlc29sdmVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWJpbGl0eSByZXNvbHZlciBhcmdzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSBbYXJncy5yZXF1ZXN0XSAtIFJlcXVlc3Qgb2JqZWN0LiBBYnNlbnQgZm9yIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmlwdGlvbnMgcmVzb2x2ZWQgZnJvbSBzdWJzY3JpYmUgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHR9IFthcmdzLnJlc3BvbnNlXSAtIFJlc3BvbnNlIG9iamVjdC4gQWJzZW50IG91dHNpZGUgSFRUUCByZXF1ZXN0IGhhbmRsaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlZCBhYmlsaXR5LlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUFiaWxpdHkoe3BhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2V9KSB7XG4gICAgY29uc3QgcmVzb2x2ZXIgPSB0aGlzLmdldEFiaWxpdHlSZXNvbHZlcigpXG5cbiAgICBpZiAocmVzb2x2ZXIpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgcmVzb2x2ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXMsIHBhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2V9KVxuXG4gICAgICBpZiAocmVzb2x2ZWQpIHJldHVybiByZXNvbHZlZFxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlcyA9IHRoaXMuZ2V0QWJpbGl0eVJlc291cmNlcygpXG5cbiAgICBpZiAocmVzb3VyY2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICByZXR1cm4gbmV3IEFiaWxpdHkoe1xuICAgICAgY29udGV4dDoge2NvbmZpZ3VyYXRpb246IHRoaXMsIHBhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2V9LFxuICAgICAgcmVzb3VyY2VzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYWJpbGl0eSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoQWJpbGl0eShhYmlsaXR5LCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggcmVxdWVzdCB0aW1pbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gcmVxdWVzdFRpbWluZyAtIFJlcXVlc3QgdGltaW5nIGNvbGxlY3Rvci5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhSZXF1ZXN0VGltaW5nKHJlcXVlc3RUaW1pbmcsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUHJvZmlsZXMgYW4gYXBwbGljYXRpb24tZGVmaW5lZCB0ZXN0IGFjdGl2aXR5IHdoZW4gYW4gb3B0LWluIHRlc3QgcHJvZmlsZVxuICAgKiBjb250ZXh0IGlzIGFjdGl2ZS4gVGhlIGNhbGxiYWNrIGFsd2F5cyBydW5zLCBpbmNsdWRpbmcgb3V0c2lkZSBwcm9maWxpbmcuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG93LWNhcmRpbmFsaXR5IGFjdGl2aXR5IGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gKFQgfCBQcm9taXNlPFQ+KX0gY2FsbGJhY2sgLSBBY3Rpdml0eSBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcHJvZmlsZVRlc3RBY3Rpdml0eShuYW1lLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHZhbGlkYXRlZE5hbWUgPSB2YWxpZGF0ZVRlc3RBY3Rpdml0eU5hbWUobmFtZSlcblxuICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQoKVxuXG4gICAgaWYgKCFjb250ZXh0KSByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbnRleHQucHJvZmlsZXIucHJvZmlsZUFjdGl2aXR5KGNvbnRleHQsIHZhbGlkYXRlZE5hbWUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0aW1lWm9uZSAtIElBTkEgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoVGltZXpvbmUodGltZVpvbmUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBhYmlsaXR5IGZyb20gY29udGV4dC5cbiAgICovXG4gIGdldEN1cnJlbnRBYmlsaXR5KCkge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEN1cnJlbnRBYmlsaXR5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IHJlcXVlc3QgdGltaW5nIGNvbGxlY3Rvci5cbiAgICovXG4gIGdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKCkge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IHRlbmFudC5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEN1cnJlbnQgdGVuYW50IGZyb20gY29udGV4dC5cbiAgICovXG4gIGdldEN1cnJlbnRUZW5hbnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFRlbmFudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHRlbmFudCAtIFRlbmFudC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgdGVuYW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRlbmFudCByZXNvbHZlciBhcmdzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLnJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLnJlc3BvbnNlIC0gUmVzcG9uc2Ugb2JqZWN0LlxuICAgKiBAcGFyYW0ge3tjaGFubmVsOiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFthcmdzLnN1YnNjcmlwdGlvbl0gLSBTdWJzY3JpcHRpb24gbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyByZXNvbHZlVGVuYW50KHtwYXJhbXMsIHJlcXVlc3QsIHJlc3BvbnNlLCBzdWJzY3JpcHRpb259KSB7XG4gICAgY29uc3QgcmVzb2x2ZXIgPSB0aGlzLmdldFRlbmFudFJlc29sdmVyKClcblxuICAgIGlmICghcmVzb2x2ZXIpIHJldHVyblxuXG4gICAgcmV0dXJuIGF3YWl0IHJlc29sdmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICBwYXJhbXMsXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2UsXG4gICAgICBzdWJzY3JpcHRpb25cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVycm9yIGV2ZW50cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcImV2ZW50ZW1pdHRlcjNcIikuRXZlbnRFbWl0dGVyfSAtIEZyYW1ld29yayBlcnJvciBldmVudHMgZW1pdHRlci5cbiAgICovXG4gIGdldEVycm9yRXZlbnRzKCkge1xuICAgIHJldHVybiB0aGlzLl9lcnJvckV2ZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIHJlcG9ydGVyIHRoYXQgY2FuIGFkZCBjbGllbnQtc2FmZSBtZXRhZGF0YSB0byBmcm9udGVuZC1tb2RlbCBlcnJvciBwYXlsb2Fkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJUeXBlfSByZXBvcnRlciAtIFJlcG9ydGVyIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZENsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyKHJlcG9ydGVyKSB7XG4gICAgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzLnB1c2gocmVwb3J0ZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlcmVkIGNsaWVudCBlcnJvciBwYXlsb2FkIHJlcG9ydGVycy5cbiAgICogQHBhcmFtIHt7Y29udGV4dDogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZENvbnRleHQsIGVycm9yOiBFcnJvciwgcmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH19IGFyZ3MgLSBSZXBvcnRlciBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkPn0gLSBNZXJnZWQgY2xpZW50LXNhZmUgcmVwb3J0ZXIgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGNsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGFyZ3MpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IHRoaXMuZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlcXVlc3RUaW1pbmcgPyByZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpIDogbmV3IFNldCgpXG4gICAgY29uc3QgZGV0YWlscyA9IHJlcXVlc3REZXRhaWxzKGFyZ3MucmVxdWVzdCwge3JlZGFjdG9yOiB0aGlzLmdldExvZ1JlZGFjdG9yKCksIHNlbnNpdGl2ZVZhbHVlc30pXG5cbiAgICBmb3IgKGNvbnN0IHJlcG9ydGVyIG9mIHRoaXMuX2NsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVycykge1xuICAgICAgY29uc3QgcmVwb3J0ZXJQYXlsb2FkID0gYXdhaXQgcmVwb3J0ZXIoe1xuICAgICAgICAuLi5hcmdzLFxuICAgICAgICByZXF1ZXN0RGV0YWlsczogZGV0YWlsc1xuICAgICAgfSlcblxuICAgICAgaWYgKHJlcG9ydGVyUGF5bG9hZCAmJiB0eXBlb2YgcmVwb3J0ZXJQYXlsb2FkID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24ocGF5bG9hZCwgcmVwb3J0ZXJQYXlsb2FkKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgdGVzdCBhdHRlbXB0IGluIGEgcmV2b2NhYmxlIGRhdGFiYXNlLWFjY2VzcyBjb250ZXh0LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tyZXZva2VkOiBib29sZWFufX0gc2NvcGUgLSBBdHRlbXB0LW93bmVkIGFjY2VzcyBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBUIHwgUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBBdHRlbXB0IHdvcmsuXG4gICAqIEByZXR1cm5zIHtUIHwgUHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHNjb3BlLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3RlbnQgZnJhbWV3b3JrIHdvcmsgd2l0aG91dCBpbmhlcml0aW5nIGEgdGVzdCBhdHRlbXB0J3MgcmV2b2NhYmxlIGRhdGFiYXNlLWFjY2VzcyBzY29wZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUIHwgUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQZXJzaXN0ZW50IHdvcmsgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRob3V0Q3VycmVudFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aENhcHR1cmVkVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUodW5kZWZpbmVkLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKiBUaHJvd3Mgd2hlbiBhIHRpbWVkLW91dCB0ZXN0IGF0dGVtcHQgdHJpZXMgdG8gc3RhcnQgbW9yZSBkYXRhYmFzZSB3b3JrLiAqL1xuICBhc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKSB7XG4gICAgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5hc3NlcnRUZXN0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggY29ubmVjdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgfCBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aENvbm5lY3Rpb25zKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBjb25zdCB7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgbmFtZVxuICAgIH0gPSByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIFwiQ29uZmlndXJhdGlvbi53aXRoQ29ubmVjdGlvbnNcIilcblxuICAgIGlmICghYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2spIHRocm93IG5ldyBFcnJvcihcIndpdGhDb25uZWN0aW9ucyByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICAvKipcbiAgICAgKiBEYnMuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gKi9cbiAgICBjb25zdCBkYnMgPSB7fVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aERhdGFiYXNlSWRlbnRpZmllckNvbm5lY3Rpb25zKHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRicyxcbiAgICAgIGlkZW50aWZpZXJzOiBkYXRhYmFzZUlkZW50aWZpZXJzID8/IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpLFxuICAgICAgbmFtZSxcbiAgICAgIHN0YWNrTGFiZWw6IFwid2l0aENvbm5lY3Rpb25zXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhwbGljaXQgbW9kZWwgd29yayBpbiBhIHRyYW5zYWN0aW9uIHBpbm5lZCB0byBvbmUgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIG5hbWU/OiBzdHJpbmd9fSBvcHRpb25zIC0gT3BlcmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogRGF0YWJhc2VPcGVyYXRpb24pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoVHJhbnNhY3Rpb24oe2RhdGFiYXNlSWRlbnRpZmllciwgbmFtZSA9IFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb25cIiwgLi4ucmVzdEFyZ3N9LCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uIHJlcXVpcmVzIGEgZGF0YWJhc2VJZGVudGlmaWVyXCIpXG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcbiAgICBpZiAoIXRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpLmluY2x1ZGVzKGRhdGFiYXNlSWRlbnRpZmllcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvciBpbmFjdGl2ZSBkYXRhYmFzZSBpZGVudGlmaWVyOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpXG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50KVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoT3BlcmF0aW9uQ29ubmVjdGlvbih7bmFtZX0sIGFzeW5jIChjb25uZWN0aW9uLCBvd25lcikgPT4ge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gbmV3IERhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgICBjb25maWd1cmF0aW9uUmV1c2VLZXk6IHBvb2wuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKSxcbiAgICAgICAgY29ubmVjdGlvbixcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICBvd25lcixcbiAgICAgICAgdGVuYW50XG4gICAgICB9KVxuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgb3BlcmF0aW9uLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbilcbiAgICAgICAgfSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIG9wZXJhdGlvbi5jb21wbGV0ZSgpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cGxpY2l0IG1vZGVsIHdvcmsgb24gb25lIGNvbm5lY3Rpb24gc2VsZWN0ZWQgZnJvbSBhIGNhcHR1cmVkIHBoeXNpY2FsXG4gICAqIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uIE5vIGFtYmllbnQgdGVuYW50IHZhbHVlIGlzIHJlYWQgZHVyaW5nIGNoZWNrb3V0IG9yXG4gICAqIGV4ZWN1dGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZSwgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcsIHNjaGVtYUdlbmVyYXRpb24/OiBzdHJpbmcsIHRlbmFudD86IG9iamVjdH19IG9wdGlvbnMgLSBDYXB0dXJlZCBvcGVyYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHsob3BlcmF0aW9uOiBEYXRhYmFzZU9wZXJhdGlvbikgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhEYXRhYmFzZU9wZXJhdGlvbih7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIG5hbWUgPSBcIkNvbmZpZ3VyYXRpb24ud2l0aERhdGFiYXNlT3BlcmF0aW9uXCIsIHNjaGVtYUdlbmVyYXRpb24sIHRlbmFudCwgLi4ucmVzdEFyZ3N9LCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aERhdGFiYXNlT3BlcmF0aW9uIHJlcXVpcmVzIGEgZGF0YWJhc2VJZGVudGlmaWVyXCIpXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aERhdGFiYXNlT3BlcmF0aW9uIHJlcXVpcmVzIGEgZGF0YWJhc2VDb25maWd1cmF0aW9uXCIpXG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aERhdGFiYXNlT3BlcmF0aW9uIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgY29uZmlndXJhdGlvblJldXNlS2V5ID0gcG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuXG4gICAgcmV0dXJuIGF3YWl0IHBvb2wud2l0aENhcHR1cmVkT3BlcmF0aW9uQ29ubmVjdGlvbih7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCBuYW1lfSwgYXN5bmMgKGNvbm5lY3Rpb24sIG93bmVyKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICBjb25zdCBvcGVyYXRpb24gPSBuZXcgRGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGNvbmZpZ3VyYXRpb25SZXVzZUtleSxcbiAgICAgICAgY29ubmVjdGlvbixcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICBlbmZvcmNlQ3VycmVudFRlbmFudFJldXNlS2V5OiBmYWxzZSxcbiAgICAgICAgb3duZXIsXG4gICAgICAgIHNjaGVtYUdlbmVyYXRpb24sXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbilcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIG9wZXJhdGlvbi5jb21wbGV0ZSgpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbGxiYWNrIHdpdGggZGF0YWJhc2UgY29ubmVjdGlvbnMgZm9yIHRoZSByZXF1ZXN0ZWQgaWRlbnRpZmllcnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2NhbGxiYWNrOiBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD4sIGRiczogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD4sIGlkZW50aWZpZXJzOiBzdHJpbmdbXSwgbmFtZTogc3RyaW5nLCBzdGFja0xhYmVsOiBzdHJpbmd9fSBhcmdzIC0gQ29ubmVjdGlvbiBzY29wZSBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe2NhbGxiYWNrLCBkYnMsIGlkZW50aWZpZXJzLCBuYW1lLCBzdGFja0xhYmVsfSkge1xuICAgIGNvbnN0IHN0YWNrID0gRXJyb3IoKS5zdGFja1xuICAgIGNvbnN0IGFjdHVhbENhbGxiYWNrID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgcmV0dXJuIGF3YWl0IHdpdGhUcmFja2VkU3RhY2soc3RhY2sgfHwgc3RhY2tMYWJlbCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGJzKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW4gcmVxdWVzdC5cbiAgICAgKiBAdHlwZSB7KCkgPT4gUHJvbWlzZTxUPn0gKi9cbiAgICBsZXQgcnVuUmVxdWVzdCA9IGFjdHVhbENhbGxiYWNrXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgaWRlbnRpZmllcnMpIHtcbiAgICAgIGxldCBhY3R1YWxSdW5SZXF1ZXN0ID0gcnVuUmVxdWVzdFxuXG4gICAgICBjb25zdCBuZXh0UnVuUmVxdWVzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLndpdGhDb25uZWN0aW9uKHtuYW1lfSwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgICAgZGJzW2lkZW50aWZpZXJdID0gZGJcblxuICAgICAgICAgIHJldHVybiBhd2FpdCBhY3R1YWxSdW5SZXF1ZXN0KClcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcnVuUmVxdWVzdCA9IG5leHRSdW5SZXF1ZXN0XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blJlcXVlc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFtkYXRhYmFzZUlkZW50aWZpZXJzXSAtIERhdGFiYXNlIGlkZW50aWZpZXJzIHRvIGluY2x1ZGUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gQSBtYXAgb2YgZGF0YWJhc2UgY29ubmVjdGlvbnMgd2l0aCBpZGVudGlmaWVyIGFzIGtleVxuICAgKi9cbiAgZ2V0Q3VycmVudENvbm5lY3Rpb25zKGRhdGFiYXNlSWRlbnRpZmllcnMgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAvKipcbiAgICAgKiBEYnMuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gKi9cbiAgICBjb25zdCBkYnMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGRhdGFiYXNlSWRlbnRpZmllcnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuICAgICAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbiA9IHBvb2wuZ2V0Q3VycmVudENvbnRleHRDb25uZWN0aW9uID8gcG9vbC5nZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24oKSA6IHBvb2wuZ2V0Q3VycmVudENvbm5lY3Rpb24oKVxuXG4gICAgICAgIGlmIChjdXJyZW50Q29ubmVjdGlvbiAmJiAoIXBvb2wuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbiB8fCBwb29sLmNvbm5lY3Rpb25NYXRjaGVzQ3VycmVudENvbmZpZ3VyYXRpb24oY3VycmVudENvbm5lY3Rpb24pKSkge1xuICAgICAgICAgIGRic1tpZGVudGlmaWVyXSA9IGN1cnJlbnRDb25uZWN0aW9uXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICh0aGlzLmlzTWlzc2luZ0N1cnJlbnRDb25uZWN0aW9uRXJyb3IoZXJyb3IpKSB7XG4gICAgICAgICAgLy8gSWdub3JlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBkYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGhvdXQgY3VycmVudCBjb25uZWN0aW9uIGNvbnRleHRzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIHdpdGhvdXQgaW5oZXJpdGVkIERCIGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHdpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHRzKGNhbGxiYWNrKSB7XG4gICAgbGV0IHJ1bkNhbGxiYWNrID0gKCkgPT4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRob3V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVycyhjYWxsYmFjaylcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmICghcG9vbCkgY29udGludWVcbiAgICAgIGNvbnN0IHByZXZpb3VzUnVuQ2FsbGJhY2sgPSBydW5DYWxsYmFja1xuXG4gICAgICBydW5DYWxsYmFjayA9ICgpID0+IHBvb2wud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dChwcmV2aW91c1J1bkNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBydW5DYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluc2lkZSBldmVyeSBwb29sJ3MgdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBjb250ZXh0IChhIG5vLW9wIGZvclxuICAgKiBwb29scyB3aXRob3V0IG9uZSkuIEluLXByb2Nlc3MgcmVxdWVzdCBoYW5kbGluZyBpcyB3cmFwcGVkIGluIHRoaXMgc28gYSByZXF1ZXN0XG4gICAqIHJ1bnMgb24gdGhlIHNhbWUgY29ubmVjdGlvbiDigJQgYW5kIG9wZW4gdHJhbnNhY3Rpb24g4oCUIGFzIHRoZSB0ZXN0IHRoYXQgaXNzdWVkIGl0LFxuICAgKiBsZXR0aW5nIHJlcXVlc3Qgc3BlY3MgY2xlYW4gdXAgYnkgcm9sbGluZyBiYWNrIGluc3RlYWQgb2YgdHJ1bmNhdGluZy4gT3V0c2lkZVxuICAgKiB0ZXN0cyBubyBzaGFyZWQgY29ubmVjdGlvbiBpcyBzZXQsIHNvIHRoaXMganVzdCBydW5zIHRoZSBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biBpbnNpZGUgdGhlIHNoYXJlZCBjb25uZWN0aW9uIGNvbnRleHRzLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb25Db250ZXh0cyhjYWxsYmFjaykge1xuICAgIGxldCBydW5DYWxsYmFjayA9IGNhbGxiYWNrXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG4gICAgICBjb25zdCBwcmV2aW91c1J1bkNhbGxiYWNrID0gcnVuQ2FsbGJhY2tcblxuICAgICAgcnVuQ2FsbGJhY2sgPSAoKSA9PiBwb29sLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbihwcmV2aW91c1J1bkNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBydW5DYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBtaXNzaW5nIGN1cnJlbnQgY29ubmVjdGlvbiBlcnJvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBFcnJvciB0aHJvd24gd2hpbGUgbG9va2luZyB1cCB0aGUgY3VycmVudCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBlcnJvciBtZWFucyBubyBjdXJyZW50IGNvbm5lY3Rpb24gaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgaXNNaXNzaW5nQ3VycmVudENvbm5lY3Rpb25FcnJvcihlcnJvcikge1xuICAgIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIChcbiAgICAgIGVycm9yLm1lc3NhZ2UgPT0gXCJJRCBoYXNuJ3QgYmVlbiBzZXQgZm9yIHRoaXMgYXN5bmMgY29udGV4dFwiIHx8XG4gICAgICBlcnJvci5tZXNzYWdlID09IFwiQSBjb25uZWN0aW9uIGhhc24ndCBiZWVuIG1hZGUgeWV0XCIgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2Uuc3RhcnRzV2l0aChcIk5vIGFzeW5jIGNvbnRleHQgc2V0IGZvciBkYXRhYmFzZSBjb25uZWN0aW9uXCIpIHx8XG4gICAgICBlcnJvci5tZXNzYWdlLnN0YXJ0c1dpdGgoXCJDb25uZWN0aW9uIFwiKSAmJiBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKFwiZG9lc24ndCBleGlzdCBhbnkgbW9yZVwiKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBjb25uZWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDb25uZWN0aW9ucyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgY29uc3Qge1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIG5hbWVcbiAgICB9ID0gcmVzb2x2ZVdpdGhDb25uZWN0aW9uc0FyZ3Mob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrLCBcIkNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnNcIilcblxuICAgIGlmICghYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2spIHRocm93IG5ldyBFcnJvcihcImVuc3VyZUNvbm5lY3Rpb25zIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIGNvbnN0IHJlcXVlc3RlZElkZW50aWZpZXJzID0gZGF0YWJhc2VJZGVudGlmaWVycyA/PyB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKVxuICAgIGNvbnN0IGRicyA9IHRoaXMuZ2V0Q3VycmVudENvbm5lY3Rpb25zKHJlcXVlc3RlZElkZW50aWZpZXJzKVxuICAgIGNvbnN0IG1pc3NpbmdJZGVudGlmaWVycyA9IHJlcXVlc3RlZElkZW50aWZpZXJzLmZpbHRlcigoaWRlbnRpZmllcikgPT4ge1xuICAgICAgaWYgKCFkYnNbaWRlbnRpZmllcl0pIHJldHVybiB0cnVlXG5cbiAgICAgIHJldHVybiAhdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuaGFzQ3VycmVudENvbm5lY3Rpb25Db250ZXh0KClcbiAgICB9KVxuXG4gICAgaWYgKG1pc3NpbmdJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBhd2FpdCBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayhkYnMpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aERhdGFiYXNlSWRlbnRpZmllckNvbm5lY3Rpb25zKHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRicyxcbiAgICAgIGlkZW50aWZpZXJzOiBtaXNzaW5nSWRlbnRpZmllcnMsXG4gICAgICBuYW1lLFxuICAgICAgc3RhY2tMYWJlbDogXCJlbnN1cmVDb25uZWN0aW9uc1wiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYGFkdmlzb3J5TG9ja3NgIGNvbmZpZ3VyYXRpb24gYmxvY2sgKFNUQy0yMTAgZGVzaWduIMKnMTApLlxuICAgKiBGdWxsIGJhY2t3YXJkIGNvbXBhdGliaWxpdHk6IGFuIGFwcCB0aGF0IGNvbmZpZ3VyZXMgbm90aGluZyBnZXRzIHRvZGF5J3NcbiAgICogZHJpdmVyLW5hdGl2ZS1vbmx5IGJlaGF2aW9yIOKAlCB0aGUgZmlsZSBiYWNrZW5kIGlzICoqZGlzYWJsZWQgYnkgZGVmYXVsdCoqXG4gICAqIGFuZCBvbmx5IGV2ZXIgc2VsZWN0YWJsZSBieSBleHBsaWNpdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2JhY2tlbmRzOiB7ZmlsZToge2RpcmVjdG9yeT86IHN0cmluZywgZW5hYmxlZDogYm9vbGVhbiwgbGVhc2VNczogbnVtYmVyLCByZW5ld0ludGVydmFsTXM6IG51bWJlcn19LCBwb2xpY3k6IGltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiKS5BZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5RW50cnlbXX19IC0gQWR2aXNvcnktbG9jayBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdHMgYXBwbGllZC5cbiAgICovXG4gIGdldEFkdmlzb3J5TG9ja0NvbmZpZygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYWR2aXNvcnlMb2NrcyB8fCB7fVxuICAgIGNvbnN0IGZpbGVDb25maWd1cmVkID0gY29uZmlndXJlZC5iYWNrZW5kcz8uZmlsZSB8fCB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tlbmRzOiB7XG4gICAgICAgIGZpbGU6IHtcbiAgICAgICAgICBkaXJlY3Rvcnk6IGZpbGVDb25maWd1cmVkLmRpcmVjdG9yeSxcbiAgICAgICAgICBlbmFibGVkOiBmaWxlQ29uZmlndXJlZC5lbmFibGVkID09PSB0cnVlLFxuICAgICAgICAgIGxlYXNlTXM6IHR5cGVvZiBmaWxlQ29uZmlndXJlZC5sZWFzZU1zID09PSBcIm51bWJlclwiID8gZmlsZUNvbmZpZ3VyZWQubGVhc2VNcyA6IDMwXzAwMCxcbiAgICAgICAgICByZW5ld0ludGVydmFsTXM6IHR5cGVvZiBmaWxlQ29uZmlndXJlZC5yZW5ld0ludGVydmFsTXMgPT09IFwibnVtYmVyXCIgPyBmaWxlQ29uZmlndXJlZC5yZW5ld0ludGVydmFsTXMgOiAxMF8wMDBcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHBvbGljeTogQXJyYXkuaXNBcnJheShjb25maWd1cmVkLnBvbGljeSkgPyBjb25maWd1cmVkLnBvbGljeSA6IFtdXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFkdmlzb3J5IGxvY2sgcG9saWN5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3lFbnRyeVtdfSAtIFBlci1sb2NrLW5hbWUgYmFja2VuZCBwb2xpY3kgZW50cmllcy5cbiAgICovXG4gIGdldEFkdmlzb3J5TG9ja1BvbGljeSgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBZHZpc29yeUxvY2tDb25maWcoKS5wb2xpY3lcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZWZmZWN0aXZlIGJhY2tlbmQgcG9saWN5IGZvciBvbmUgbG9jayBuYW1lIChkZXNpZ24gwqc1KS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tOYW1lIC0gQ29uY3JldGUgbG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLlJlc29sdmVkQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeX0gLSBSZXNvbHZlZCBwb2xpY3kuXG4gICAqL1xuICByZXNvbHZlQWR2aXNvcnlMb2NrUG9saWN5KGxvY2tOYW1lKSB7XG4gICAgcmV0dXJuIHJlc29sdmVBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5KGxvY2tOYW1lLCB0aGlzLmdldEFkdmlzb3J5TG9ja1BvbGljeSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZpbGUtdGllciBhZHZpc29yeS1sb2NrIGJhY2tlbmQgd2hlbiB0aGlzIGRlcGxveW1lbnQgaGFzXG4gICAqIGV4cGxpY2l0bHkgZW5hYmxlZCBpdCAoYGFkdmlzb3J5TG9ja3MuYmFja2VuZHMuZmlsZS5lbmFibGVkOiB0cnVlYCksXG4gICAqIGNyZWF0aW5nIGl0IG9uIGZpcnN0IHVzZS4gUmV0dXJucyBgdW5kZWZpbmVkYCB3aGVuIHRoZSB0aWVyIGlzIGRpc2FibGVkXG4gICAqICh0aGUgZGVmYXVsdCkg4oCUIGNhbGxlcnMgbXVzdCBuZXZlciBmYWxsIGJhY2sgdG8gaXQgaW1wbGljaXRseS4gQ3JlYXRpb25cbiAgICogZ29lcyB0aHJvdWdoIHRoZSBlbnZpcm9ubWVudCBoYW5kbGVyIHNvIGJyb3dzZXIvRXhwbyBjb25maWd1cmF0aW9uc1xuICAgKiB3aXRob3V0IGBmc2AgZmFpbCBsb3VkbHkgaW5zdGVhZCBvZiBoYWxmLXdvcmtpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1maWxlLWJhY2tlbmQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZW5hYmxlZCBmaWxlIGJhY2tlbmQsIG9yIHVuZGVmaW5lZC5cbiAgICovXG4gIGFzeW5jIGdldEFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QWR2aXNvcnlMb2NrQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmJhY2tlbmRzLmZpbGUuZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmICh0aGlzLl9hZHZpc29yeUxvY2tGaWxlQmFja2VuZCkgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kXG5cbiAgICBjb25zdCBkaXJlY3RvcnkgPSBjb25maWcuYmFja2VuZHMuZmlsZS5kaXJlY3RvcnkgfHwgYCR7dGhpcy5nZXREaXJlY3RvcnkoKX0vdG1wL2Fkdmlzb3J5LWxvY2tzYFxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQgPSBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmNyZWF0ZUFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKHtcbiAgICAgIGRpcmVjdG9yeSxcbiAgICAgIGxlYXNlTXM6IGNvbmZpZy5iYWNrZW5kcy5maWxlLmxlYXNlTXMsXG4gICAgICByZW5ld0ludGVydmFsTXM6IGNvbmZpZy5iYWNrZW5kcy5maWxlLnJlbmV3SW50ZXJ2YWxNc1xuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5fYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHdoaWNoIGJhY2tlbmQgdGllciBzZXJ2ZWQgb25lIGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gc29cbiAgICogYGdldEFkdmlzb3J5TG9ja0JhY2tlbmRTdGF0dXMoKWAgY2FuIGFuc3dlciBcIndoaWNoIGJhY2tlbmQgc2VydmVkIHRoaXNcbiAgICogbG9ja1wiIChkZXNpZ24gwqczKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBY3F1aXNpdGlvbiByZWNvcmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxvY2tOYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiKS5BZHZpc29yeUxvY2tUaWVyfSBhcmdzLmJhY2tlbmQgLSBUaWVyIHRoYXQgc2VydmVkIHRoZSBhY3F1aXNpdGlvbi5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmZlbmNpbmdTdXBwb3J0ZWQgLSBXaGV0aGVyIHRoZSBzZXJ2aW5nIHRpZXIgY2FycmllcyBmZW5jaW5nIHRva2Vucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRBZHZpc29yeUxvY2tBY3F1aXNpdGlvbih7bG9ja05hbWUsIGJhY2tlbmQsIGZlbmNpbmdTdXBwb3J0ZWR9KSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlzaXRpb25zLnNldChsb2NrTmFtZSwge2JhY2tlbmQsIGZlbmNpbmdTdXBwb3J0ZWQsIHNlcnZlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBcIndoaWNoIGJhY2tlbmQgc2VydmVkIHRoaXMgbG9ja1wiIGRpYWdub3N0aWNzIHN1cmZhY2UgKGRlc2lnbiDCpzMpOlxuICAgKiBwZXIgbG9jayBuYW1lLCB0aGUgdGllciBvZiB0aGUgbW9zdCByZWNlbnQgYWNxdWlzaXRpb24sIHdoZXRoZXIgdGhhdCB0aWVyXG4gICAqIGNhcnJpZXMgZmVuY2luZyB0b2tlbnMsIGFuZCB0aGUgcmVzb2x2ZWQgcG9saWN5IChtaW5pbXVtL2FsbG93ZWQvcHJlZmVycmVkXG4gICAqIHRpZXJzKSBmb3IgdGhlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NrTmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge3thY3F1aXNpdGlvbjoge2JhY2tlbmQ6IGltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiKS5BZHZpc29yeUxvY2tUaWVyLCBmZW5jaW5nU3VwcG9ydGVkOiBib29sZWFuLCBzZXJ2ZWRBdDogc3RyaW5nfSB8IG51bGwsIHBvbGljeTogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLlJlc29sdmVkQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeX19IC0gQmFja2VuZCBzdGF0dXMgZm9yIHRoZSBuYW1lLlxuICAgKi9cbiAgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cyhsb2NrTmFtZSkge1xuICAgIHJldHVybiB7XG4gICAgICBhY3F1aXNpdGlvbjogdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlzaXRpb25zLmdldChsb2NrTmFtZSkgPz8gbnVsbCxcbiAgICAgIHBvbGljeTogdGhpcy5yZXNvbHZlQWR2aXNvcnlMb2NrUG9saWN5KGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBkZWRpY2F0ZWQgY29ubmVjdGlvbiB0aGF0IGN1cnJlbnRseSBob2xkcyBhbiBhZHZpc29yeSBsb2NrLCBzbyBhXG4gICAqIHNodXRkb3duIGNhbiBjbG9zZSBpdCBhbmQgcmVsZWFzZSB0aGUgbG9jay4gU2VlIGBfYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnNgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBUaGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlckFkdmlzb3J5TG9ja0Nvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zLmFkZChjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGEgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiBvbmNlIGl0cyBsb2NrIHNjb3BlIGVuZHMgYW5kIHRoZVxuICAgKiBjb25uZWN0aW9uIGhhcyBiZWVuIChvciBpcyBhYm91dCB0byBiZSkgY2xvc2VkIGJ5IGl0cyBvd25lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gVGhlIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgdW5yZWdpc3RlckFkdmlzb3J5TG9ja0Nvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBldmVyeSByZWdpc3RlcmVkIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb24sIGVuZGluZyBpdHMgc2Vzc2lvbiBzb1xuICAgKiB0aGUgREIgc2VydmVyIHJlbGVhc2VzIHRoZSBsb2NrLiBFdmVyeSBjb25uZWN0aW9uIGlzIGF0dGVtcHRlZCBiZWZvcmUgYW55IGZhaWx1cmVcbiAgICogaXMgc3VyZmFjZWQsIHNvIG9uZSBzdHVjayBjbG9zZSBkb2VzIG5vdCBsZWF2ZSB0aGUgb3RoZXJzJyBsb2NrcyBoZWxkOyBhIGZhaWx1cmUgaXNcbiAgICogdGhlbiB0aHJvd24gKG5ldmVyIHN3YWxsb3dlZCksIGFnZ3JlZ2F0ZWQgd2hlbiBtb3JlIHRoYW4gb25lIGNvbm5lY3Rpb24gZmFpbGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIGFsbCBoYXZlIGJlZW4gY2xvc2VkOyByZWplY3RzIGlmIGFueSBmYWlsZWQuXG4gICAqL1xuICBhc3luYyBfY2xvc2VBZHZpc29yeUxvY2tDb25uZWN0aW9ucygpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IFsuLi50aGlzLl9hZHZpc29yeUxvY2tDb25uZWN0aW9uc11cblxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zLmNsZWFyKClcblxuICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgY29ubmVjdGlvbnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBjbG9zZSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhY3RpdmUgZGF0YWJhc2UgY29ubmVjdGlvbnMgYW5kIGNsZWFycyBnbG9iYWwgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKSB7XG4gICAgaWYgKHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7U2V0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCBjb25zdHJ1Y3RvcnMgPSBuZXcgU2V0KClcblxuICAgIHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgICAgY29uc3QgY2xvc2VFcnJvcnMgPSBbXVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmNsb3NlQmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIC8vIENsb3NlIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zIGZpcnN0OiB0aGV5IGFyZSBzcGF3bmVkIG91dHNpZGUgdGhlXG4gICAgICAgICAgLy8gcG9vbHMnIHRyYWNrZWQgc2V0cywgc28gYHBvb2wuY2xvc2VBbGwoKWAgd291bGQgbm90IHJlYWNoIHRoZW0gYW5kIGEgbG9jayBoZWxkXG4gICAgICAgICAgLy8gYnkgYSBydW5uZXIgdG9ybiBkb3duIG1pZC1wYXNzIHdvdWxkIGxlYWsgdW50aWwgdGhlIERCIHNlcnZlcidzIGB3YWl0X3RpbWVvdXRgLlxuICAgICAgICAgIC8vIFN0aWxsIGNsb3NlIHRoZSBwb29scyBpZiB0aGlzIHRocm93cywgc28gYSBzdHVjayBsb2NrIGNvbm5lY3Rpb24gZG9lcyBub3RcbiAgICAgICAgICAvLyBsZWF2ZSB0aGUgcmVzdCBvZiB0aGUgY29ubmVjdGlvbnMgb3Blbi5cbiAgICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zKClcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gUmVsZWFzZSBmaWxlLXRpZXIgYWR2aXNvcnktbG9jayBob2xkcyBleHBsaWNpdGx5IChTVEMtMjEzKTogdGhlXG4gICAgICAgICAgICAvLyBsZWFzZSB3b3VsZCBtYWtlIHRoZW0gcmVjbGFpbWFibGUgYW55d2F5LCBidXQgYSBjbGVhbiBzaHV0ZG93blxuICAgICAgICAgICAgLy8gc2hvdWxkIG5vdCBsZWF2ZSBsb2NrIGRpcmVjdG9yaWVzIGJlaGluZCBmb3IgdGhlIHN0YWxlbmVzcyBwYXRoLlxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQ/LnJlbGVhc2VBbGxIZWxkKClcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuXG4gICAgICAgICAgICBhd2FpdCBwb29sLmNsb3NlQWxsKClcblxuICAgICAgICAgICAgY29uc3QgUG9vbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gKi8gKHBvb2wuY29uc3RydWN0b3IpXG4gICAgICAgICAgICBjb25zdHJ1Y3RvcnMuYWRkKFBvb2xDbGFzcylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IFBvb2xDbGFzcyBvZiBjb25zdHJ1Y3RvcnMpIHtcbiAgICAgICAgICAgIFBvb2xDbGFzcy5jbGVhckdsb2JhbENvbm5lY3Rpb25zKHRoaXMpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUucmVzZXQoKVxuXG4gICAgICAgICAgLy8gQWxsb3cgZnVsbCByZS1pbml0aWFsaXphdGlvbiBhZnRlciBjb25uZWN0aW9ucyBhcmUgY2xvc2VkLlxuICAgICAgICAgIHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICs9IDFcbiAgICAgICAgICB0aGlzLl9tb2RlbHNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgICAgICAgdGhpcy5faXNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBjbG9zZUVycm9yc1swXVxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihjbG9zZUVycm9ycywgXCJGYWlsZWQgdG8gY2xvc2UgYmFja2dyb3VuZC1qb2JzIGFuZCBkYXRhYmFzZSByZXNvdXJjZXNcIilcbiAgICB9KSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGVuZHBvaW50IHJlcXVlc3QgYXV0aG9yaXplZC5cbiAgICogQHBhcmFtIHt7aGVhZGVyOiAobmFtZTogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfX0gcmVxdWVzdCAtIEluY29taW5nIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleHBlY3RlZFRva2VuIC0gQ29uZmlndXJlZCBkZWJ1Zy1lbmRwb2ludCB0b2tlbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdCBjYXJyaWVzIHRoZSBleHBlY3RlZCBiZWFyZXIgdG9rZW4uXG4gICAqL1xuICBkZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgZXhwZWN0ZWRUb2tlbikge1xuICAgIGNvbnN0IGhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiYXV0aG9yaXphdGlvblwiKVxuXG4gICAgaWYgKHR5cGVvZiBoZWFkZXIgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgbWF0Y2ggPSAoL15CZWFyZXJcXHMrKC4rKSQvaSkuZXhlYyhoZWFkZXIudHJpbSgpKVxuXG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5kZWJ1Z0VuZHBvaW50VG9rZW5NYXRjaGVzKG1hdGNoWzFdLCBleHBlY3RlZFRva2VuKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFwaSBtYW5pZmVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+fSAtIEFQSSBtYW5pZmVzdCBmb3IgYWxsIHJlZ2lzdGVyZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZ2V0QXBpTWFuaWZlc3QoKSB7XG4gICAgcmV0dXJuIGZyb250ZW5kTW9kZWxBcGlNYW5pZmVzdCh0aGlzLl9iYWNrZW5kUHJvamVjdHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGV0aGVyIEFQSSBtYW5pZmVzdCBpcyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBBUEkgbWFuaWZlc3QgZW5kcG9pbnQgaXMgZW5hYmxlZC5cbiAgICovXG4gIF9hcGlNYW5pZmVzdEVuYWJsZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FwaU1hbmlmZXN0LmVuYWJsZWRcbiAgfVxufVxuIl19