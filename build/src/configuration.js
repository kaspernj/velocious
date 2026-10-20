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
        return { host, port, databaseIdentifier, maxConcurrentForkedJobs, maxConcurrentInlineJobs, mode, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, runnerMaxOldSpaceSizeMb, runnerMallocArenaMax, dispatchStrategy, pollIntervalMs, drainStoreOperationTimeoutMs, scheduledEnqueueTimeoutMs, queues, jobClasses, jobTimeoutMs, retention, generationId, initialGenerationState, lifecycleSocketPath };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLEVBQUMsb0NBQW9DLEVBQUMsTUFBTSw4Q0FBOEMsQ0FBQTtBQUNqRyxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFB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Ozs7Ozs7O09BU0c7SUFDSCxlQUFlO1FBQ2IsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUE7UUFDckMsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLFNBQVMsS0FBSyxJQUFJLENBQUE7UUFFL0MsSUFBSSxTQUFTLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxJQUFJLE9BQU8sVUFBVSxDQUFDLElBQUksS0FBSyxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQzFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUdBQXlHLENBQUMsQ0FBQTtRQUM1SCxDQUFDO1FBRUQsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLENBQUE7UUFDekUsTUFBTSxVQUFVLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLENBQUE7UUFDNUUsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUMzRCxNQUFNLElBQUksR0FBRyxVQUFVLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxXQUFXLENBQUE7UUFDdEQsTUFBTSxJQUFJLEdBQUcsT0FBTyxVQUFVLENBQUMsSUFBSSxLQUFLLFFBQVE7WUFDOUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxJQUFJO1lBQ2pCLENBQUMsQ0FBQyxDQUFDLE9BQU8sT0FBTyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTlFLElBQUksT0FBTyxDQUFBO1FBRVgsSUFBSSxPQUFPLFVBQVUsQ0FBQyxPQUFPLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDNUMsT0FBTyxHQUFHLFVBQVUs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QWUsQ0FBQyxDQUFBO1FBRTlDLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTVDLE1BQU0sS0FBSyxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUE7UUFFdEQsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUV4QixPQUFPLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLHlCQUF5QixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxhQUFhLENBQUMsQ0FBQTtJQUN4RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGNBQWM7UUFDbEIsT0FBTyx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtJQUN4RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsbUJBQW1CO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUE7SUFDbEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlIHR5cGUuXG4gKiBAdGVtcGxhdGUgVFxuICogQHR5cGVkZWYgeyhhcmc6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+KSA9PiBQcm9taXNlPFQ+fSBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gV2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFtkYXRhYmFzZUlkZW50aWZpZXJzXSAtIERhdGFiYXNlIGlkZW50aWZpZXJzIHRvIGluY2x1ZGUgaW4gdGhlIGNvbm5lY3Rpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNoZWNrZWQtb3V0IGRhdGFiYXNlIGNvbm5lY3Rpb25zLlxuICovXG4vKipcbiAqIE9uZSBhZGFwdGVyIGluc3RhbmNlIGFuZCBpdHMgc2VyaWFsaXplZCByZWFkeS9jbG9zZSBsaWZlY3ljbGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXIuanNcIikuZGVmYXVsdH0gYWRhcHRlciAtIEFkYXB0ZXIgb3duZWQgYnkgdGhpcyBnZW5lcmF0aW9uLlxuICogQHByb3BlcnR5IHtib29sZWFufSBjbG9zaW5nIC0gV2hldGhlciBjbG9zZSBoYXMgY2xhaW1lZCB0aGlzIGdlbmVyYXRpb24uXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IHJlYWR5UHJvbWlzZSAtIFNoYXJlZCByZWFkaW5lc3MgYXR0ZW1wdC5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gY2xvc2VQcm9taXNlIC0gU2hhcmVkIGNsb3NlIG9wZXJhdGlvbi5cbiAqL1xuXG5pbXBvcnQgeyBkaWdnIH0gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgZ2V0dGV4dENvbmZpZyBmcm9tIFwiZ2V0dGV4dC11bml2ZXJzYWwvYnVpbGQvc3JjL2NvbmZpZy5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCB0cmFuc2xhdGUgZnJvbSBcImdldHRleHQtdW5pdmVyc2FsL2J1aWxkL3NyYy90cmFuc2xhdGUuanNcIlxuaW1wb3J0IEFiaWxpdHkgZnJvbSBcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXIuanNcIlxuaW1wb3J0IHtERUZBVUxUX1NDSEVEVUxFRF9FTlFVRVVFX1RJTUVPVVRfTVN9IGZyb20gXCIuL2JhY2tncm91bmQtam9icy9zY2hlZHVsZWQtZW5xdWV1ZS1ib3VuZC5qc1wiXG5pbXBvcnQgRGF0YWJhc2VPcGVyYXRpb24gZnJvbSBcIi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCJcbmltcG9ydCB7IGluaXRpYWxpemVBdWRpdGVkTW9kZWxSZWxhdGlvbnNoaXBzIH0gZnJvbSBcIi4vZGF0YWJhc2UvcmVjb3JkL2F1ZGl0aW5nLmpzXCJcbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzIGZyb20gXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLXN1YnNjcmliZXJzLmpzXCJcbmltcG9ydCB7IEN1cnJlbnRDb25maWd1cmF0aW9uTm90U2V0RXJyb3IsIGN1cnJlbnRDb25maWd1cmF0aW9uLCBzZXRDdXJyZW50Q29uZmlndXJhdGlvbiB9IGZyb20gXCIuL2N1cnJlbnQtY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQgeyByZXF1ZXN0RGV0YWlscyB9IGZyb20gXCIuL2Vycm9yLXJlcG9ydGluZy9yZXF1ZXN0LWRldGFpbHMuanNcIlxuaW1wb3J0IExvZ1JlZGFjdG9yIGZyb20gXCIuL2xvZy1yZWRhY3Rvci5qc1wiXG5pbXBvcnQgeyBmcm9udGVuZE1vZGVsQXBpTWFuaWZlc3QsIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24sIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0IH0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHsgY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXksIG5vcm1hbGl6ZU9mZmxpbmVHcmFudFNpZ25pbmdLZXkgfSBmcm9tIFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIlxuaW1wb3J0IFBsdWdpblJvdXRlcyBmcm9tIFwiLi9yb3V0ZXMvcGx1Z2luLXJvdXRlcy5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVUZXN0QWN0aXZpdHlOYW1lIH0gZnJvbSBcIi4vdGVzdGluZy90ZXN0LXByb2ZpbGUtYWN0aXZpdHkuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVUaW1lWm9uZSB9IGZyb20gXCIuL3RpbWUtem9uZS5qc1wiXG5pbXBvcnQgeyB3aXRoVHJhY2tlZFN0YWNrIH0gZnJvbSBcIi4vdXRpbHMvd2l0aC10cmFja2VkLXN0YWNrLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNQYWNrYWdlIGZyb20gXCIuL3BhY2thZ2VzL3ZlbG9jaW91cy1wYWNrYWdlLmpzXCJcbmltcG9ydCBGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSBmcm9tIFwiLi90ZW5hbnRzL2Zyb250ZW5kLXRlbmFudC1zcWxpdGUtbGlmZWN5Y2xlLmpzXCJcbmltcG9ydCB7IHJlc29sdmVHZW5lcmF0aW9uSWQsIHJlc29sdmVJbml0aWFsR2VuZXJhdGlvblN0YXRlLCByZXNvbHZlTGlmZWN5Y2xlU29ja2V0UGF0aCB9IGZyb20gXCIuL2JhY2tncm91bmQtam9icy9nZW5lcmF0aW9uLWlkZW50aXR5LmpzXCJcbmltcG9ydCB7IHJ1blNodXRkb3duU3RlcHMgfSBmcm9tIFwiLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuaW1wb3J0IHsgcmVzb2x2ZUFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3kgfSBmcm9tIFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCJcblxuZXhwb3J0IHsgQ3VycmVudENvbmZpZ3VyYXRpb25Ob3RTZXRFcnJvciB9XG5cbi8qKlxuICogUnVucyBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5LlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5IHdoZW4gdGhlIHJ1bnRpbWUgZXhwb3NlcyBvbmUuXG4gKi9cbmZ1bmN0aW9uIGN1cnJlbnRXb3JraW5nRGlyZWN0b3J5KCkge1xuICBjb25zdCBwcm9jZXNzT2JqZWN0ID0gLyoqIEB0eXBlIHt7Y3dkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHwgdW5kZWZpbmVkfSAqLyAoZ2xvYmFsVGhpcy5wcm9jZXNzKVxuXG4gIGlmICh0eXBlb2YgcHJvY2Vzc09iamVjdD8uY3dkICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiB1bmRlZmluZWRcblxuICByZXR1cm4gcHJvY2Vzc09iamVjdC5jd2QoKVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBvdmVybG9hZGVkIHdpdGgvZW5zdXJlIGNvbm5lY3Rpb25zIGFyZ3VtZW50cy5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiB8IHVuZGVmaW5lZH0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkZWZhdWx0TmFtZSAtIERlZmF1bHQgY2hlY2tvdXQgbmFtZS5cbiAqIEByZXR1cm5zIHt7ZGF0YWJhc2VJZGVudGlmaWVyczogc3RyaW5nW10gfCB1bmRlZmluZWQsIG5hbWU6IHN0cmluZywgY2FsbGJhY2s6IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiB8IHVuZGVmaW5lZH19IFJlc29sdmVkIGNoZWNrb3V0IG9wdGlvbnMgYW5kIGNhbGxiYWNrLlxuICovXG5mdW5jdGlvbiByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIGRlZmF1bHROYW1lKSB7XG4gIGlmICh0eXBlb2Ygb3B0aW9uc09yQ2FsbGJhY2sgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgY29uc3QgYWN0dWFsQ2FsbGJhY2sgPSAvKiogQHR5cGUge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gKi8gKG9wdGlvbnNPckNhbGxiYWNrKVxuXG4gICAgcmV0dXJuIHtkYXRhYmFzZUlkZW50aWZpZXJzOiB1bmRlZmluZWQsIG5hbWU6IGRlZmF1bHROYW1lLCBjYWxsYmFjazogYWN0dWFsQ2FsbGJhY2t9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRhdGFiYXNlSWRlbnRpZmllcnM6IG9wdGlvbnNPckNhbGxiYWNrLmRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgbmFtZTogb3B0aW9uc09yQ2FsbGJhY2submFtZSB8fCBkZWZhdWx0TmFtZSxcbiAgICBjYWxsYmFja1xuICB9XG59XG5cbi8qKlxuICogUnVucyBjYW5vbmljYWwgZGVidWcgc25hcHNob3QgdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNuYXBzaG90IHZhbHVlIHRvIGNhbm9uaWNhbGl6ZS5cbiAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gU25hcHNob3QgdmFsdWUgd2l0aCBvYmplY3Qga2V5cyBzb3J0ZWQgcmVjdXJzaXZlbHkuXG4gKi9cbmZ1bmN0aW9uIGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZSh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHZhbHVlXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLm1hcCgoZW50cnkpID0+IGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZShlbnRyeSkpXG5cbiAgcmV0dXJuIE9iamVjdC5rZXlzKHZhbHVlKS5zb3J0KCkucmVkdWNlKChyZXN1bHQsIGtleSkgPT4ge1xuICAgIHJlc3VsdFtrZXldID0gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpW2tleV0pXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9LCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHt9KSlcbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBCYXNlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlIHwgUGFydGlhbDxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZT4gfCB2b2lkfSBvdmVycmlkZUNvbmZpZ3VyYXRpb24gLSBUZW5hbnQgb3ZlcnJpZGUgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gLSBNZXJnZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbWVyZ2VEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCBvdmVycmlkZUNvbmZpZ3VyYXRpb24pIHtcbiAgaWYgKCFvdmVycmlkZUNvbmZpZ3VyYXRpb24pIHJldHVybiBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cblxuICByZXR1cm4ge1xuICAgIC4uLmRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAuLi5vdmVycmlkZUNvbmZpZ3VyYXRpb24sXG4gICAgcmVjb3JkOiB7XG4gICAgICAuLi4oZGF0YWJhc2VDb25maWd1cmF0aW9uLnJlY29yZCB8fCB7fSksXG4gICAgICAuLi4ob3ZlcnJpZGVDb25maWd1cmF0aW9uLnJlY29yZCB8fCB7fSlcbiAgICB9LFxuICAgIHNxbENvbmZpZzoge1xuICAgICAgLi4uKGRhdGFiYXNlQ29uZmlndXJhdGlvbi5zcWxDb25maWcgfHwge30pLFxuICAgICAgLi4uKG92ZXJyaWRlQ29uZmlndXJhdGlvbi5zcWxDb25maWcgfHwge30pXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGdyYWNlIHdpbmRvdyAobXMpIGJlZm9yZSBhIHN1c3RhaW5lZCBiZWFjb24gb3V0YWdlIGlzIHJlcG9ydGVkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIGB1bnJlYWNoYWJsZVJlcG9ydE1zYCwgaWYgYW55LlxuICogQHJldHVybnMge251bWJlcn0gLSBUaGUgY29uZmlndXJlZCB2YWx1ZSB3aGVuIGl0J3MgYSBmaW5pdGUgbnVtYmVyLCBvdGhlcndpc2UgdGhlIDMwcyBkZWZhdWx0LlxuICovXG5mdW5jdGlvbiByZXNvbHZlQmVhY29uVW5yZWFjaGFibGVSZXBvcnRNcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gIHJldHVybiAzMF8wMDBcbn1cblxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19CWVRFUyA9IDE2ICogMTAyNCAqIDEwMjRcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfTUVTU0FHRVMgPSAyNTZcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0JZVEVTID0gMTYgKiAxMDI0ICogMTAyNFxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfRlJBTUVTID0gMjU2XG5cbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xEID0gMTAyNFxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSA9IDRcbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTCA9IDZcblxuLyoqXG4gKiBWYWxpZGF0ZXMgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXIgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBwb3NpdGl2ZSBzYWZlIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbmZpZ3VyYXRpb24ga2V5LlxuICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRWYWx1ZSAtIERlZmF1bHQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkYXRlZCBjb25maWd1cmVkIG9yIGRlZmF1bHQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlU2FmZUludGVnZXIodmFsdWUsIG5hbWUsIGRlZmF1bHRWYWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGRlZmF1bHRWYWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlcmApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW4gb3B0aW9uYWwgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG9wdGlvbmFsUG9zaXRpdmVTYWZlSW50ZWdlcih2YWx1ZSwgbmFtZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZFxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlcmApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW4gaW50ZWdlciBjb25maWd1cmF0aW9uIHZhbHVlIGluc2lkZSBhbiBpbmNsdXNpdmUgcmFuZ2UuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29uZmlndXJhdGlvbiBrZXkuXG4gKiBAcGFyYW0ge251bWJlcn0gbWluIC0gTWluaW11bSBhY2NlcHRlZCB2YWx1ZSAoaW5jbHVzaXZlKS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtYXggLSBNYXhpbXVtIGFjY2VwdGVkIHZhbHVlIChpbmNsdXNpdmUpLlxuICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRWYWx1ZSAtIERlZmF1bHQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkYXRlZCBjb25maWd1cmVkIG9yIGRlZmF1bHQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGludGVnZXJJblJhbmdlKHZhbHVlLCBuYW1lLCBtaW4sIG1heCwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgbWluIHx8IHZhbHVlID4gbWF4KSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgJHtuYW1lfSBtdXN0IGJlIGFuIGludGVnZXIgYmV0d2VlbiAke21pbn0gYW5kICR7bWF4fWApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHRoZSBidWZmZXJlZCBIVFRQIHJlc3BvbnNlIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uIENvbXByZXNzaW9uIGlzXG4gKiBlbmFibGVkIGJ5IGRlZmF1bHQgd2hlbiB0aGUgc2V0dGluZyBpcyBhYnNlbnQ7IGBmYWxzZWAgb3IgYHtlbmFibGVkOiBmYWxzZX1gXG4gKiBkaXNhYmxlcyBpdCBnbG9iYWxseS5cbiAqIEBwYXJhbSB7Ym9vbGVhbiB8IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5IdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENvbmZpZ3VyZWQgY29tcHJlc3Npb24gdmFsdWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplSHR0cENvbXByZXNzaW9uKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSB0cnVlKSB7XG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCB0aHJlc2hvbGQ6IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xELCBicm90bGlRdWFsaXR5OiBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZLCBnemlwTGV2ZWw6IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTH1cbiAgfVxuXG4gIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCB0aHJlc2hvbGQ6IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xELCBicm90bGlRdWFsaXR5OiBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZLCBnemlwTGV2ZWw6IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTH1cbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uIG11c3QgYmUgYSBib29sZWFuIG9yIGFuIG9iamVjdCwgZ290OiAke1N0cmluZyh2YWx1ZSl9YClcbiAgfVxuXG4gIGNvbnN0IHticm90bGlRdWFsaXR5LCBlbmFibGVkLCBnemlwTGV2ZWwsIHRocmVzaG9sZCwgLi4ucmVzdENvbXByZXNzaW9ufSA9IHZhbHVlXG4gIGNvbnN0IHJlc3RDb21wcmVzc2lvbktleXMgPSBPYmplY3Qua2V5cyhyZXN0Q29tcHJlc3Npb24pXG5cbiAgaWYgKHJlc3RDb21wcmVzc2lvbktleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24gcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RDb21wcmVzc2lvbktleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBicm90bGlRdWFsaXR5LCBlbmFibGVkLCBnemlwTGV2ZWwsIHRocmVzaG9sZClgKVxuICB9XG5cbiAgaWYgKGVuYWJsZWQgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZW5hYmxlZCAhPT0gXCJib29sZWFuXCIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uLmVuYWJsZWQgbXVzdCBiZSBhIGJvb2xlYW4sIGdvdDogJHtTdHJpbmcoZW5hYmxlZCl9YClcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogZW5hYmxlZCA/PyB0cnVlLFxuICAgIHRocmVzaG9sZDogcG9zaXRpdmVTYWZlSW50ZWdlcih0aHJlc2hvbGQsIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi50aHJlc2hvbGRcIiwgREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQpLFxuICAgIGJyb3RsaVF1YWxpdHk6IGludGVnZXJJblJhbmdlKGJyb3RsaVF1YWxpdHksIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi5icm90bGlRdWFsaXR5XCIsIDAsIDExLCBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZKSxcbiAgICBnemlwTGV2ZWw6IGludGVnZXJJblJhbmdlKGd6aXBMZXZlbCwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLmd6aXBMZXZlbFwiLCAwLCA5LCBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUwpXG4gIH1cbn1cblxuLyoqXG4gKiBEZWZhdWx0IHJlcXVlc3QtYm9keSBsaW1pdCBmb3IgdGhlIGJ1aWx0LWluIE1DUCBlbmRwb2ludC4gSlNPTi1SUEMgbWVzc2FnZXMgYXJlIHNtYWxsLFxuICogc28gdGhlIGZyYW1ld29yayBjYXBzIHRoZW0gaW5zdGVhZCBvZiBtYWtpbmcgZXZlcnkgYXBwIHRoYXQgZW5hYmxlcyBgbWNwOiB0cnVlYCByZXN0YXRlXG4gKiBhIHJlcXVlc3QtYm9keSBwb2xpY3kuIEV4cGxpY2l0IGBodHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNgIG9yIGEgcmVzb2x2ZXIgbGltaXQgd2lucy5cbiAqIEB0eXBlIHtudW1iZXJ9XG4gKi9cbmNvbnN0IERFRkFVTFRfTUNQX01BWF9SRVFVRVNUX0JPRFlfQllURVMgPSAxMDI0ICogMTAyNFxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNDb25maWd1cmF0aW9uIHtcbiAgLyoqXG4gICAqIENsb3NlIGRhdGFiYXNlIGNvbm5lY3Rpb25zIHByb21pc2UuXG4gICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UgPSBudWxsXG5cbiAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICBfYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9ucyBjdXJyZW50bHkgaG9sZGluZyBhIGxvY2suIFRoZXNlIGFyZSBzcGF3bmVkXG4gICAqIG91dHNpZGUgdGhlIHBvb2xzJyB0cmFja2VkIHNldHMgKHNvIGEgaG9sZC10aW1lb3V0IGxvY2sgc3Vydml2ZXMgcG9vbCBjaGVja291dHMpLFxuICAgKiBzbyBgY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zYCB3b3VsZCBvdGhlcndpc2Ugd2FsayBwYXN0IHRoZW07IHRyYWNraW5nIHRoZW0gaGVyZVxuICAgKiBsZXRzIGEgc2h1dGRvd24gY2xvc2UgdGhlbSBhbmQgcmVsZWFzZSB0aGUgbG9jayBpbnN0ZWFkIG9mIG9ycGhhbmluZyBpdC5cbiAgICogQHR5cGUge1NldDxpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zID0gbmV3IFNldCgpXG5cbiAgLyoqXG4gICAqIExhemlseSBjcmVhdGVkIGZpbGUtdGllciBhZHZpc29yeS1sb2NrIGJhY2tlbmQgKFNUQy0yMTMpLiBTdGF5cyBgdW5kZWZpbmVkYFxuICAgKiB1bmxlc3MgYGFkdmlzb3J5TG9ja3MuYmFja2VuZHMuZmlsZS5lbmFibGVkOiB0cnVlYCBpcyBleHBsaWNpdGx5IGNvbmZpZ3VyZWQg4oCUXG4gICAqIHRoZSBmaWxlIHRpZXIgaXMgbmV2ZXIgYXV0by1lbmFibGVkLCBhbmQgYSBub24tTm9kZSBlbnZpcm9ubWVudCBoYW5kbGVyXG4gICAqIChicm93c2VyL0V4cG8sIG5vIGBmc2ApIGNhbm5vdCBjcmVhdGUgb25lIGF0IGFsbC5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1maWxlLWJhY2tlbmQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgX2Fkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIE1vc3QgcmVjZW50IGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gcGVyIGxvY2sgbmFtZSDigJQgdGhlIFwid2hpY2ggYmFja2VuZFxuICAgKiBzZXJ2ZWQgdGhpcyBsb2NrXCIgc3VyZmFjZSAoZGVzaWduIMKnMykuXG4gICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7YmFja2VuZDogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXIsIGZlbmNpbmdTdXBwb3J0ZWQ6IGJvb2xlYW4sIHNlcnZlZEF0OiBzdHJpbmd9Pn0gKi9cbiAgX2Fkdmlzb3J5TG9ja0FjcXVpc2l0aW9ucyA9IG5ldyBNYXAoKVxuXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgX3NjaGVtYUNhY2hlR2VuZXJhdGlvbnNCeVJldXNlS2V5ID0gbmV3IE1hcCgpXG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0NvbmZpZ3VyYXRpb259IC0gVGhlIGN1cnJlbnQuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudCgpIHtcbiAgICByZXR1cm4gY3VycmVudENvbmZpZ3VyYXRpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNvbmZpZ3VyYXRpb25BcmdzVHlwZX0gYXJncyAtIENvbmZpZ3VyYXRpb24gYXJndW1lbnRzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FiaWxpdHlSZXNvbHZlciwgYWJpbGl0eVJlc291cmNlcywgYWR2aXNvcnlMb2NrcywgYXR0YWNobWVudHMsIGF1dG9sb2FkID0gdHJ1ZSwgYmFja2dyb3VuZEpvYnMsIGJhY2tlbmRQcm9qZWN0cywgYmVhY29uLCBjb29raWVTZWNyZXQsIGNvcnMsIGRhdGFiYXNlLCBkZWJ1ZyA9IGZhbHNlLCBkZWJ1Z0VuZHBvaW50ID0gZmFsc2UsIGFwaU1hbmlmZXN0ID0gZmFsc2UsIGRpcmVjdG9yeSwgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gdHJ1ZSwgZW52aXJvbm1lbnQsIGVudmlyb25tZW50SGFuZGxlciwgZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMsIGZyb250ZW5kVGVuYW50U3FsaXRlLCBodHRwU2VydmVyLCBpbml0aWFsaXplTW9kZWxzLCBpbml0aWFsaXplcnMsIGxvY2FsZSwgbG9jYWxlRmFsbGJhY2tzLCBsb2NhbGVzLCBsb2dnaW5nLCBtYWlsZXJCYWNrZW5kLCBtY3AgPSBmYWxzZSwgcGFja2FnZXMsIHJlcXVlc3RUaW1lb3V0TXMsIHJvdXRlUmVzb2x2ZXJIb29rcywgc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMsIHNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMsIHN0cnVjdHVyZVNxbCwgc3luYywgdGVuYW50RGF0YWJhc2VQcm92aWRlcnMsIHRlbmFudERhdGFiYXNlUmVzb2x2ZXIsIHRlbmFudFJlc29sdmVyLCB0ZXN0VGVuYW50UG9vbHMsIHRlc3RpbmcsIHRpbWVab25lLCB0aW1lem9uZU9mZnNldE1pbnV0ZXMsIHRydXN0ZWRQcm94aWVzLCB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIsIHdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgPSBhYmlsaXR5UmVzb2x2ZXJcbiAgICB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gYWJpbGl0eVJlc291cmNlcyB8fCBbXVxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja3MgPSBhZHZpc29yeUxvY2tzXG4gICAgdGhpcy5fYXV0b2xvYWQgPSBhdXRvbG9hZFxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzID0gYmFja2dyb3VuZEpvYnNcbiAgICB0aGlzLl9iZWFjb24gPSBiZWFjb25cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBjbGllbnQgdmFsdWUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBjb25uZWN0IHByb21pc2UgdmFsdWUuXG4gICAgICogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIHJlcG9ydCB0aW1lciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9IC0gUGVuZGluZyBcImJlYWNvbiBzdGlsbCB1bnJlYWNoYWJsZVwiIHJlcG9ydCB0aW1lci5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIG91dGFnZSByZXBvcnRlZCB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjdXJyZW50IGJlYWNvbiBvdXRhZ2UgaGFzIGFscmVhZHkgYmVlbiByZXBvcnRlZC5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gbGFzdCBkb3duIGVycm9yIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7c3RhZ2U6IFwiYmVhY29uLWNvbm5lY3RcIiB8IFwiYmVhY29uLWRpc2Nvbm5lY3RcIiwgZXJyb3I6IEVycm9yfSB8IHVuZGVmaW5lZH0gLSBMYXRlc3QgYmVhY29uLWRvd24gZGV0YWlscywgcmVwb3J0ZWQgb25seSBpZiB0aGUgb3V0YWdlIGlzIHN1c3RhaW5lZC5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgPSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICAgIHRoaXMuX2F0dGFjaG1lbnRzID0gYXR0YWNobWVudHMgfHwge31cbiAgICAvLyBDb3B5IHNvIGFwcGVuZGluZyBwYWNrYWdlLWRlcml2ZWQgZW50cmllcyBiZWxvdyBuZXZlciBtdXRhdGVzIGEgY2FsbGVyJ3NcbiAgICAvLyBzaGFyZWQgYXJyYXkgKGNvbmZpZyBtb2R1bGVzIGNvbW1vbmx5IGV4cG9ydCBhIHJldXNlZCBiYWNrZW5kUHJvamVjdHMgYXJyYXkpLlxuICAgIHRoaXMuX2JhY2tlbmRQcm9qZWN0cyA9IGJhY2tlbmRQcm9qZWN0cyA/IFsuLi5iYWNrZW5kUHJvamVjdHNdIDogW11cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclR5cGVbXX0gKi9cbiAgICB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMgPSBbXVxuICAgIHRoaXMuY29ycyA9IGNvcnNcbiAgICB0aGlzLl9jb29raWVTZWNyZXQgPSBjb29raWVTZWNyZXRcbiAgICB0aGlzLmRhdGFiYXNlID0gZGF0YWJhc2VcbiAgICB0aGlzLmRlYnVnID0gZGVidWdcbiAgICB0aGlzLl9kZWJ1Z0VuZHBvaW50ID0gdGhpcy5fbm9ybWFsaXplRGVidWdFbmRwb2ludChkZWJ1Z0VuZHBvaW50KVxuICAgIHRoaXMuX2FwaU1hbmlmZXN0ID0gdGhpcy5fbm9ybWFsaXplQXBpTWFuaWZlc3QoYXBpTWFuaWZlc3QpXG4gICAgdGhpcy5fbWNwID0gdGhpcy5fbm9ybWFsaXplTWNwKG1jcClcbiAgICB0aGlzLl9lbnZpcm9ubWVudCA9IGVudmlyb25tZW50IHx8IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52LlZFTE9DSU9VU19FTlYgfHwgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuTk9ERV9FTlYgfHwgXCJkZXZlbG9wbWVudFwiXG4gICAgdGhpcy5fZW52aXJvbm1lbnRIYW5kbGVyID0gZW52aXJvbm1lbnRIYW5kbGVyXG4gICAgdGhpcy5fZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzXG4gICAgdGhpcy5fZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgPSBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9PT0gdW5kZWZpbmVkXG4gICAgICA/IHNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMgIT09IHRydWVcbiAgICAgIDogZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHNcbiAgICB0aGlzLl9kaXJlY3RvcnkgPSBkaXJlY3RvcnlcbiAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzID0gaW5pdGlhbGl6ZU1vZGVsc1xuICAgIC8qKiBAdHlwZSB7VmVsb2Npb3VzUGFja2FnZVtdfSAqL1xuICAgIHRoaXMuX3BhY2thZ2VzID0gKHBhY2thZ2VzIHx8IFtdKS5tYXAoKGVudHJ5KSA9PiBWZWxvY2lvdXNQYWNrYWdlLmZyb20oZW50cnkpKVxuXG4gICAgLy8gQXBwZW5kIGEgZGVyaXZlZCBiYWNrZW5kLXByb2plY3QgcGVyIHBhY2thZ2Ugc28gdGhlIGV4aXN0aW5nIHJlc291cmNlXG4gICAgLy8gZGlzY292ZXJ5ICsgZnJvbnRlbmQtbW9kZWwgZ2VuZXJhdGlvbiBtYWNoaW5lcnkgaW5jbHVkZXMgaXQuIFBhY2thZ2VcbiAgICAvLyBmcm9udGVuZCBtb2RlbHMgYXJlIGdlbmVyYXRlZCBpbnRvIHRoZSBhcHAncyBmcm9udGVuZC1tb2RlbHMgb3V0cHV0LlxuICAgIGNvbnN0IGFwcEZyb250ZW5kTW9kZWxzT3V0cHV0UGF0aCA9IHRoaXMuX2JhY2tlbmRQcm9qZWN0c1swXT8uZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoXG5cbiAgICBmb3IgKGNvbnN0IHZlbG9jaW91c1BhY2thZ2Ugb2YgdGhpcy5fcGFja2FnZXMpIHtcbiAgICAgIHRoaXMuX2JhY2tlbmRQcm9qZWN0cy5wdXNoKHZlbG9jaW91c1BhY2thZ2UudG9CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24oe2Zyb250ZW5kTW9kZWxzT3V0cHV0UGF0aDogYXBwRnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRofSkpXG4gICAgfVxuXG4gICAgdGhpcy5faXNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2luaXRpYWxpemVyLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gW11cbiAgICAvKiogQHR5cGUge2Jvb2xlYW59ICovXG4gICAgdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBJbnZhbGlkYXRlcyBtb2RlbCBwaGFzZXMgdGhhdCBzdGFydGVkIGJlZm9yZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBjbG9zZWQuXG4gICAgICogQHR5cGUge251bWJlcn1cbiAgICAgKi9cbiAgICB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IDBcbiAgICAvKipcbiAgICAgKiBJbi1wcm9ncmVzcyBgaW5pdGlhbGl6ZU1vZGVscygpYCBwcm9taXNlLiBNb2RlbCBpbml0aWFsaXphdGlvbiBpcyBhblxuICAgICAqIGF0b21pYyBib290c3RyYXAgcGhhc2U6IGNvbmN1cnJlbnQgY2FsbGVycyBzaGFyZSBpdCwgYW5kIGEgcmVqZWN0aW9uXG4gICAgICogbGVhdmVzIHRoZSBwaGFzZSBlbGlnaWJsZSBmb3IgYSBsYXRlciBjb21wbGV0ZSBhdHRlbXB0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogQ3VycmVudCBgaW5pdGlhbGl6ZSgpYCBwcm9taXNlLCBtZW1vaXplZCBzbyBjb25jdXJyZW50IGNhbGxlcnMgYXdhaXQgdGhlXG4gICAgICogc2FtZSBib290c3RyYXAuIFJldGFpbmVkIGFjcm9zcyBhIGNvbm5lY3Rpb24gY2xvc2UgdW50aWwgc3RhbGUgYm9vdHN0cmFwXG4gICAgICogd29yayBzZXR0bGVzLCB0aGVuIGNsZWFyZWQgYnkgaWRlbnRpdHkgYmVmb3JlIHRoZSBuZXcgZ2VuZXJhdGlvbiByZXRyaWVzLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgY29uc3QgcmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciA9IGh0dHBTZXJ2ZXI/LnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJcbiAgICBjb25zdCB3ZWJzb2NrZXRJbmJvdW5kUXVldWUgPSBodHRwU2VydmVyPy53ZWJzb2NrZXRJbmJvdW5kUXVldWVcbiAgICBjb25zdCB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlID0gaHR0cFNlcnZlcj8ud2Vic29ja2V0T3V0Ym91bmRRdWV1ZVxuXG4gICAgaWYgKHJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgcmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG11c3QgYmUgYSBmdW5jdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuaHR0cFNlcnZlciA9IHtcbiAgICAgIC4uLihodHRwU2VydmVyIHx8IHt9KSxcbiAgICAgIGNvbXByZXNzaW9uOiBub3JtYWxpemVIdHRwQ29tcHJlc3Npb24oaHR0cFNlcnZlcj8uY29tcHJlc3Npb24pLFxuICAgICAgbWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlczogb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKGh0dHBTZXJ2ZXI/Lm1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXMsIFwiaHR0cFNlcnZlci5tYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzXCIpLFxuICAgICAgbWF4UmVxdWVzdEJvZHlCeXRlczogb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKGh0dHBTZXJ2ZXI/Lm1heFJlcXVlc3RCb2R5Qnl0ZXMsIFwiaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzXCIpLFxuICAgICAgcmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlcixcbiAgICAgIHdlYnNvY2tldEluYm91bmRRdWV1ZToge1xuICAgICAgICBtYXhQZW5kaW5nQnl0ZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0SW5ib3VuZFF1ZXVlPy5tYXhQZW5kaW5nQnl0ZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWUubWF4UGVuZGluZ0J5dGVzXCIsIERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfQllURVMpLFxuICAgICAgICBtYXhQZW5kaW5nTWVzc2FnZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0SW5ib3VuZFF1ZXVlPy5tYXhQZW5kaW5nTWVzc2FnZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWUubWF4UGVuZGluZ01lc3NhZ2VzXCIsIERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfTUVTU0FHRVMpXG4gICAgICB9LFxuICAgICAgd2Vic29ja2V0T3V0Ym91bmRRdWV1ZToge1xuICAgICAgICBtYXhQZW5kaW5nQnl0ZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0T3V0Ym91bmRRdWV1ZT8ubWF4UGVuZGluZ0J5dGVzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0T3V0Ym91bmRRdWV1ZS5tYXhQZW5kaW5nQnl0ZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfQllURVMpLFxuICAgICAgICBtYXhQZW5kaW5nRnJhbWVzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldE91dGJvdW5kUXVldWU/Lm1heFBlbmRpbmdGcmFtZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlLm1heFBlbmRpbmdGcmFtZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfRlJBTUVTKVxuICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGh0dHAgc2VydmVyIGluc3RhbmNlIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7Z2V0RGVidWdTbmFwc2hvdDogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9odHRwU2VydmVySW5zdGFuY2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLmxvY2FsZSA9IGxvY2FsZVxuICAgIHRoaXMubG9jYWxlRmFsbGJhY2tzID0gbG9jYWxlRmFsbGJhY2tzXG4gICAgdGhpcy5sb2NhbGVzID0gbG9jYWxlc1xuICAgIHRoaXMuX2luaXRpYWxpemVycyA9IGluaXRpYWxpemVyc1xuICAgIHRoaXMuX3Rlc3RpbmcgPSB0ZXN0aW5nXG4gICAgdGhpcy5fdGltZVpvbmUgPSB0aW1lWm9uZVxuICAgIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9IHRpbWV6b25lT2Zmc2V0TWludXRlc1xuICAgIHRoaXMuX3RydXN0ZWRQcm94aWVzID0gdHJ1c3RlZFByb3hpZXNcbiAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zID0gcmVxdWVzdFRpbWVvdXRNc1xuICAgIHRoaXMuX3N0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbFxuICAgIHRoaXMuX3N5bmMgPSB0aGlzLl9ub3JtYWxpemVTeW5jQ29uZmlndXJhdGlvbihzeW5jKVxuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzID0gdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgfHwge31cbiAgICB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyID0gdGVuYW50RGF0YWJhc2VSZXNvbHZlclxuICAgIHRoaXMuX3RlbmFudFJlc29sdmVyID0gdGVuYW50UmVzb2x2ZXJcbiAgICB0aGlzLl90ZXN0VGVuYW50UG9vbHMgPSB0ZXN0VGVuYW50UG9vbHNcbiAgICB0aGlzLl93ZWJzb2NrZXRFdmVudHMgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmliZXJzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyID0gd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyXG4gICAgdGhpcy5fd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlciA9IHdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jb25uZWN0aW9uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBDaGFubmVsIHR5cGVzIHJlZ2lzdGVyZWQgd2l0aCBge2xpdmVPbmx5OiB0cnVlfWA6IHRoZWlyIHRyYWZmaWMgaXNcbiAgICAgKiBuZXZlciBwZXJzaXN0ZWQgZm9yIHJlcGxheSwgYW5kIGBtYXJrQ2hhbm5lbEludGVyZXN0ZWRgIHJlamVjdHMgdGhlXG4gICAgICogbmFtZS5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgdGhpcy5fbGl2ZU9ubHlXZWJzb2NrZXRDaGFubmVscyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBTZXQ8aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0Pj59IC0gY2hhbm5lbFR5cGUg4oaSIGxpdmUgc3Vic2NyaXB0aW9ucyBhY3Jvc3MgYWxsIHNlc3Npb25zLlxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBJbi1mbGlnaHQgbG9jYWwgKHBlci1wcm9jZXNzKSB3ZWJzb2NrZXQgY2hhbm5lbCBicm9hZGNhc3QgZGVsaXZlcmllcyxcbiAgICAgKiBsYXVuY2hlZCBmaXJlLWFuZC1mb3JnZXQgZnJvbSBgX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsYCBzbyBvbmUgc2xvd1xuICAgICAqIHN1YnNjcmliZXIgbmV2ZXIgYmxvY2tzIGFub3RoZXIuIFRyYWNrZWQgaGVyZSBzb1xuICAgICAqIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBjYW4gc25hcHNob3QgYW5kIGRyYWluIHRoZW0gYmVmb3JlIHNldHRsaW5nLlxuICAgICAqIFNldHRsZWQgZGVsaXZlcmllcyBhcmUgcmVtb3ZlZCBieSB0aGUgdHJhY2tpbmctbGV2ZWwgY2xlYW51cC5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogTGF0ZXN0IGxvY2FsIGJyb2FkY2FzdCBkZWxpdmVyeSBwZXIgc3Vic2NyaXB0aW9uLiBDaGFpbmluZyBzdWJzZXF1ZW50XG4gICAgICogZGVsaXZlcmllcyBwcmVzZXJ2ZXMgbGlmZWN5Y2xlIGV2ZW50IG9yZGVyIHdpdGhvdXQgY291cGxpbmcgc2VwYXJhdGVcbiAgICAgKiBzdWJzY3JpYmVycyB0byBvbmUgYW5vdGhlci5cbiAgICAgKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQsIFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscyA9IG5ldyBXZWFrTWFwKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IHNlc3Npb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdD59IC0gTGl2ZSB3ZWJzb2NrZXQgc2Vzc2lvbnMsIGluY2x1ZGluZyBwYXVzZWQgc2Vzc2lvbnMgd2l0aGluIHRoZSBncmFjZSB3aW5kb3cuXG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgcGF1c2VkIHdlYnNvY2tldCBzZXNzaW9ucyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge3Nlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIGdyYWNlVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+LCBwYXVzZWRBdDogbnVtYmVyfT59IC0gc2Vzc2lvbklkIOKGkiBwYXVzZWQgc2Vzc2lvbiBhd2FpdGluZyByZXN1bWUuXG4gICAgICovXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKiBHcmFjZSBwZXJpb2QgZm9yIHBhdXNlZCBXZWJTb2NrZXQgc2Vzc2lvbnMgYmVmb3JlIHBlcm1hbmVudCB0ZWFyZG93bi4gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzID0gMzAwXG5cbiAgICAvKiogSW50ZXJ2YWwgKHNlY29uZHMpIGJldHdlZW4gc2VydmVy4oaSY2xpZW50IGhlYXJ0YmVhdCBwaW5nczsgMCBkaXNhYmxlcyByZWFwaW5nIG9mIHNpbGVudCBzb2NrZXRzLiAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzID0gMzBcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIHdyYXBwZXIgY2FsbGVkIGFyb3VuZCBldmVyeSBXZWJTb2NrZXQtYm9ybmUgcmVxdWVzdCAvXG4gICAgICogY29ubmVjdGlvbiBtZXNzYWdlIC8gY2hhbm5lbCBkaXNwYXRjaC4gQXBwcyByZWdpc3RlciBpdCBoZXJlXG4gICAgICogdG8gc2V0IHVwIHBlci1yZXF1ZXN0IGNvbnRleHQgKGUuZy4gQXN5bmNMb2NhbFN0b3JhZ2UgZm9yXG4gICAgICogbG9jYWxlLCB0ZW5hbnQsIHRyYWNpbmcpIHRoYXQgZG93bnN0cmVhbSBoYW5kbGVycyByZWFkLlxuICAgICAqIEB0eXBlIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH1cbiAgICAgKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0ID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBhcm91bmQgYWN0aW9uIHZhbHVlLlxuICAgICAqIEB0eXBlIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9hcm91bmRBY3Rpb24gPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBzZXNzaW9uIGlkZW50aXR5IHJlc29sdmVyIHZhbHVlLlxuICAgICAqIEB0eXBlIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgbnVsbH0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlciA9IG51bGxcbiAgICB0aGlzLl9sb2dnaW5nID0gbG9nZ2luZ1xuICAgIHRoaXMuX2xvZ1JlZGFjdG9yID0gbmV3IExvZ1JlZGFjdG9yKHtzZW5zaXRpdmVOYW1lczogbG9nZ2luZz8uc2Vuc2l0aXZlTmFtZXN9KVxuICAgIHRoaXMuX21haWxlckJhY2tlbmQgPSBtYWlsZXJCYWNrZW5kXG4gICAgdGhpcy5fcm91dGVSZXNvbHZlckhvb2tzID0gWy4uLihyb3V0ZVJlc29sdmVySG9va3MgfHwgW10pXVxuICAgIHRoaXMuX2FkZERlYnVnRW5kcG9pbnRSb3V0ZUhvb2soKVxuICAgIHRoaXMuX2FkZEFwaU1hbmlmZXN0Um91dGVIb29rKClcbiAgICB0aGlzLl9hZGRNY3BSb3V0ZUhvb2soKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBhcHBsaWVkIHJvdXRlIG1vdW50cyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7V2Vha1NldDxvYmplY3Q+fSAqL1xuICAgIHRoaXMuX2FwcGxpZWRSb3V0ZU1vdW50cyA9IG5ldyBXZWFrU2V0KClcbiAgICB0aGlzLl9lcnJvckV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBkYXRhYmFzZSBwb29scyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIHRoaXMuZGF0YWJhc2VQb29scyA9IHt9XG4gICAgdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgPSBuZXcgRnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoe2NvbmZpZ3VyYXRpb246IHRoaXMsIG1heE9wZW5IYW5kbGVzOiBmcm9udGVuZFRlbmFudFNxbGl0ZT8ubWF4T3BlbkhhbmRsZXN9KVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBtb2RlbCBjbGFzc2VzIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIHRoaXMubW9kZWxDbGFzc2VzID0ge31cblxuICAgIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuc2V0Q29uZmlndXJhdGlvbih0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF1dG9sb2FkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBvbiBsYXp5IGFjY2VzcyBpcyBlbmFibGVkIGdsb2JhbGx5LlxuICAgKi9cbiAgZ2V0QXV0b2xvYWQoKSB7IHJldHVybiB0aGlzLl9hdXRvbG9hZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4cG9zZSBpbnRlcm5hbCBlcnJvcnMgdG8gY2xpZW50cy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdW5leHBlY3RlZCBpbnRlcm5hbCBlcnJvciBkZXRhaWxzIG1heSBiZSByZXR1cm5lZCB0byBBUEkgY2xpZW50cy5cbiAgICovXG4gIGdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCkgeyByZXR1cm4gdGhpcy5fZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgPT09IHRydWUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgZXJyb3JzIGV4cG9zZSBvbmx5IGV4cGxpY2l0bHkgc2FmZSBtZXNzYWdlcy5cbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBnZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgaW50ZXJuYWwgZXJyb3IgZXhwb3N1cmUgaXMgZGlzYWJsZWQuXG4gICAqL1xuICBnZXRTZWN1cmVGcm9udGVuZE1vZGVsRXJyb3JzKCkgeyByZXR1cm4gIXRoaXMuZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlYnVnIGVuZHBvaW50LlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXREZWJ1Z0VuZHBvaW50KCkgeyByZXR1cm4gdGhpcy5fZGVidWdFbmRwb2ludCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbkNvbmZpZ3VyZWQ6IGJvb2xlYW59fSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZyBmb3IgdGhlIHNuYXBzaG90LCB3aXRoIHRoZSB0b2tlbiByZWRhY3RlZC5cbiAgICovXG4gIF9kZWJ1Z0VuZHBvaW50U25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IHRoaXMuX2RlYnVnRW5kcG9pbnQuZW5hYmxlZCxcbiAgICAgIHBhdGg6IHRoaXMuX2RlYnVnRW5kcG9pbnQucGF0aCxcbiAgICAgIHRva2VuQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkZWJ1ZyBlbmRwb2ludC5cbiAgICogQHBhcmFtIHtib29sZWFuIHwge3BhdGg/OiBzdHJpbmcsIHRva2VuPzogc3RyaW5nfX0gdmFsdWUgLSBEZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIE5vcm1hbGl6ZWQgZGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVEZWJ1Z0VuZHBvaW50KHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCBwYXRoOiBcIi92ZWxvY2lvdXMvZGVidWdcIiwgdG9rZW46IG51bGx9XG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiLCB0b2tlbjogbnVsbH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZGVidWdFbmRwb2ludCB0byBiZSBhIGJvb2xlYW4gb3Igb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSB2YWx1ZS5wYXRoIHx8IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiXG5cbiAgICBpZiAodHlwZW9mIHBhdGggIT09IFwic3RyaW5nXCIgfHwgIXBhdGguc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZGVidWdFbmRwb2ludC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50LnRva2VuIHRvIGJlIGEgbm9uLWVtcHR5IHN0cmluZywgZ290OiAke1N0cmluZyh0b2tlbil9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGgsIHRva2VuOiB0b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB0b2tlbi50cmltKCl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgYXBpIG1hbmlmZXN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIEFQSSBtYW5pZmVzdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIE5vcm1hbGl6ZWQgQVBJIG1hbmlmZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplQXBpTWFuaWZlc3QodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL2FwaS9tYW5pZmVzdFwiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvYXBpL21hbmlmZXN0XCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdCB0byBiZSBhIGJvb2xlYW4gb3Igb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSB2YWx1ZS5wYXRoIHx8IFwiL2FwaS9tYW5pZmVzdFwiXG5cbiAgICBpZiAodHlwZW9mIHBhdGggIT09IFwic3RyaW5nXCIgfHwgIXBhdGguc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXBpTWFuaWZlc3QucGF0aCB0byBiZSBhIHN0cmluZyBzdGFydGluZyB3aXRoICcvJywgZ290OiAke1N0cmluZyhwYXRoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gdmFsdWUudG9rZW4gPT09IHVuZGVmaW5lZCB8fCB2YWx1ZS50b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB2YWx1ZS50b2tlblxuXG4gICAgaWYgKHRva2VuICE9PSBudWxsICYmICh0eXBlb2YgdG9rZW4gIT09IFwic3RyaW5nXCIgfHwgIXRva2VuLnRyaW0oKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXBpTWFuaWZlc3QudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBhcGkgbWFuaWZlc3Qgcm91dGUgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FkZEFwaU1hbmlmZXN0Um91dGVIb29rKCkge1xuICAgIGlmICghdGhpcy5fYXBpTWFuaWZlc3QuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiR0VUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX2FwaU1hbmlmZXN0LnBhdGgpIHJldHVybiBudWxsXG5cbiAgICAgIGlmICh0aGlzLl9hcGlNYW5pZmVzdC50b2tlbiAmJiAhdGhpcy5kZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgdGhpcy5fYXBpTWFuaWZlc3QudG9rZW4pKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3Rpb246IFwic2hvd1wiLFxuICAgICAgICBjb250cm9sbGVyOiBcInZlbG9jaW91c0FwaU1hbmlmZXN0XCIsXG4gICAgICAgIGNvbnRyb2xsZXJQYXRoOiBcIi4vYnVpbHQtaW4vYXBpLW1hbmlmZXN0L2NvbnRyb2xsZXIuanNcIixcbiAgICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uczogdHJ1ZSxcbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9hcGktbWFuaWZlc3RcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbWNwLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIE1DUCBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIE5vcm1hbGl6ZWQgTUNQIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplTWNwKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCBwYXRoOiBcIi9tY3BcIiwgdG9rZW46IG51bGx9XG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IFwiL21jcFwiLCB0b2tlbjogbnVsbH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbWNwIHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvbWNwXCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBtY3AucGF0aCB0byBiZSBhIHN0cmluZyBzdGFydGluZyB3aXRoICcvJywgZ290OiAke1N0cmluZyhwYXRoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gdmFsdWUudG9rZW4gPT09IHVuZGVmaW5lZCB8fCB2YWx1ZS50b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB2YWx1ZS50b2tlblxuXG4gICAgaWYgKHRva2VuICE9PSBudWxsICYmICh0eXBlb2YgdG9rZW4gIT09IFwic3RyaW5nXCIgfHwgIXRva2VuLnRyaW0oKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbWNwLnRva2VuIHRvIGJlIGEgbm9uLWVtcHR5IHN0cmluZywgZ290OiAke1N0cmluZyh0b2tlbil9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGgsIHRva2VuOiB0b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB0b2tlbi50cmltKCl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgbWNwIHJvdXRlIGhvb2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hZGRNY3BSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9tY3AuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiUE9TVFwiKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKGN1cnJlbnRQYXRoICE9PSB0aGlzLl9tY3AucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgLy8gV2hlbiBhIHRva2VuIGlzIGNvbmZpZ3VyZWQsIGFuIHVuYXV0aGVudGljYXRlZCByZXF1ZXN0IGdldHMgbm8gcm91dGUgYXRcbiAgICAgIC8vIGFsbCAoNDA0KSByYXRoZXIgdGhhbiBhIDQwMSwgc28gdGhlIGVuZHBvaW50J3MgZXhpc3RlbmNlIHN0YXlzIGhpZGRlbi5cbiAgICAgIGlmICh0aGlzLl9tY3AudG9rZW4gJiYgIXRoaXMuZGVidWdFbmRwb2ludFJlcXVlc3RBdXRob3JpemVkKHJlcXVlc3QsIHRoaXMuX21jcC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJoYW5kbGVcIixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNNY3BcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9tY3AvY29udHJvbGxlci5qc1wiLFxuICAgICAgICAvLyBUZW5hbnQgYW5kIGFiaWxpdHkgcmVzb2x1dGlvbiBiZWxvbmcgdG8gdGhlIGZyb250ZW5kLW1vZGVsIGRpc3BhdGNoZXJcbiAgICAgICAgLy8gcGVyIGNvbW1hbmQgKHdpdGhGcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQpLCBleGFjdGx5IGxpa2UgdGhlIHJlZ3VsYXJcbiAgICAgICAgLy8gL2Zyb250ZW5kLW1vZGVscyByb3V0ZSDigJQgdGhlIE1DUCB0cmFuc3BvcnQgbmV2ZXIgYnlwYXNzZXMgdGhlbS5cbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9tY3BcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgZGVidWcgZW5kcG9pbnQgcm91dGUgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FkZERlYnVnRW5kcG9pbnRSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9kZWJ1Z0VuZHBvaW50LmVuYWJsZWQpIHJldHVyblxuXG4gICAgdGhpcy5hZGRSb3V0ZVJlc29sdmVySG9vaygoe2N1cnJlbnRQYXRoLCByZXF1ZXN0fSkgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QuaHR0cE1ldGhvZCgpICE9PSBcIkdFVFwiKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKGN1cnJlbnRQYXRoICE9PSB0aGlzLl9kZWJ1Z0VuZHBvaW50LnBhdGgpIHJldHVybiBudWxsXG5cbiAgICAgIC8vIFdoZW4gYSB0b2tlbiBpcyBjb25maWd1cmVkLCBhbiB1bmF1dGhlbnRpY2F0ZWQgcmVxdWVzdCBnZXRzIG5vIHJvdXRlIGF0XG4gICAgICAvLyBhbGwgKDQwNCkgcmF0aGVyIHRoYW4gYSA0MDEsIHNvIHRoZSBlbmRwb2ludCdzIGV4aXN0ZW5jZSBzdGF5cyBoaWRkZW4uXG4gICAgICBpZiAodGhpcy5fZGVidWdFbmRwb2ludC50b2tlbiAmJiAhdGhpcy5kZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgdGhpcy5fZGVidWdFbmRwb2ludC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJzaG93XCIsXG4gICAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzRGVidWdcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9kZWJ1Zy9jb250cm9sbGVyLmpzXCIsXG4gICAgICAgIHNraXBDb250cm9sbGVyQ29ubmVjdGlvbnM6IHRydWUsXG4gICAgICAgIHNraXBBYmlsaXR5UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgc2tpcFRlbmFudFJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHZpZXdQYXRoOiBcIi4vYnVpbHQtaW4vZGVidWdcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXV0b2xvYWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3VmFsdWUgLSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QXV0b2xvYWQobmV3VmFsdWUpIHsgdGhpcy5fYXV0b2xvYWQgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ29yc1R5cGUgfCB1bmRlZmluZWR9IC0gVGhlIGNvcnMuXG4gICAqL1xuICBnZXRDb3JzKCkge1xuICAgIHJldHVybiB0aGlzLmNvcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBodHRwIHNlcnZlciBjb21wcmVzc2lvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIGJ1ZmZlcmVkIHJlc3BvbnNlIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRIdHRwU2VydmVyQ29tcHJlc3Npb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5jb21wcmVzc2lvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1heGltdW0gYnVmZmVyZWQgcmVzcG9uc2UgYm9keSBieXRlcy5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGJ5dGUgbGltaXQsIG9yIHVuZGVmaW5lZCB3aGVuIHVuYm91bmRlZC5cbiAgICovXG4gIGdldEh0dHBTZXJ2ZXJNYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzKCkge1xuICAgIHJldHVybiB0aGlzLmh0dHBTZXJ2ZXIubWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1heGltdW0gcmVxdWVzdCBib2R5IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgYnl0ZSBsaW1pdCwgb3IgdW5kZWZpbmVkIHdoZW4gdW5ib3VuZGVkLlxuICAgKi9cbiAgZ2V0SHR0cFNlcnZlck1heFJlcXVlc3RCb2R5Qnl0ZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgcmVxdWVzdC1ib2R5IGhhbmRsaW5nIGFmdGVyIHRoZSByZXF1ZXN0IGxpbmUgYW5kIGhlYWRlcnMgYXJlIGNvbXBsZXRlLFxuICAgKiBiZWZvcmUgYm9keSBieXRlcyBhcmUgcmV0YWluZWQgb3IgZGVjb2RlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cFJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJBcmdzfSBhcmdzIC0gUGFyc2VkIHJlcXVlc3QgaGVhZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX0gLSBFZmZlY3RpdmUgcmVxdWVzdCBwb2xpY3kuXG4gICAqL1xuICByZXNvbHZlSHR0cFJlcXVlc3RCb2R5UG9saWN5KGFyZ3MpIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyXG4gICAgY29uc3QgY29uZmlndXJlZFBvbGljeSA9IHJlc29sdmVyID8gcmVzb2x2ZXIoYXJncykgOiB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX0gKi9cbiAgICBsZXQgcmVzb2x2ZWRQb2xpY3lcblxuICAgIGlmIChjb25maWd1cmVkUG9saWN5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlc29sdmVkUG9saWN5ID0ge21heFJlcXVlc3RCb2R5Qnl0ZXM6IHRoaXMuaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzLCBtb2RlOiBcInBhcnNlZFwifVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWNvbmZpZ3VyZWRQb2xpY3kgfHwgdHlwZW9mIGNvbmZpZ3VyZWRQb2xpY3kgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjb25maWd1cmVkUG9saWN5KSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG11c3QgcmV0dXJuIGFuIG9iamVjdCBvciB1bmRlZmluZWRcIilcbiAgICAgIH1cblxuICAgICAgY29uc3Qge21heFJlcXVlc3RCb2R5Qnl0ZXMsIG1vZGUgPSBcInBhcnNlZFwiLCAuLi5yZXN0UG9saWN5fSA9IGNvbmZpZ3VyZWRQb2xpY3lcbiAgICAgIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMocmVzdFBvbGljeSlcblxuICAgICAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIHJldHVybmVkIHVua25vd24ga2V5czogJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IG1heFJlcXVlc3RCb2R5Qnl0ZXMsIG1vZGUpYClcbiAgICAgIH1cbiAgICAgIGlmIChtb2RlICE9PSBcInBhcnNlZFwiICYmIG1vZGUgIT09IFwicmF3XCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG1vZGUgbXVzdCBiZSBcInBhcnNlZFwiIG9yIFwicmF3XCIsIGdvdDogJHtTdHJpbmcobW9kZSl9YClcbiAgICAgIH1cblxuICAgICAgcmVzb2x2ZWRQb2xpY3kgPSB7XG4gICAgICAgIG1heFJlcXVlc3RCb2R5Qnl0ZXM6IG1heFJlcXVlc3RCb2R5Qnl0ZXMgPT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gdGhpcy5odHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcbiAgICAgICAgICA6IG9wdGlvbmFsUG9zaXRpdmVTYWZlSW50ZWdlcihtYXhSZXF1ZXN0Qm9keUJ5dGVzLCBcImh0dHBTZXJ2ZXIucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciBtYXhSZXF1ZXN0Qm9keUJ5dGVzXCIpLFxuICAgICAgICBtb2RlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGx5TWNwUmVxdWVzdEJvZHlQb2xpY3lEZWZhdWx0cyh7YXJncywgcG9saWN5OiByZXNvbHZlZFBvbGljeX0pXG4gIH1cblxuICAvKipcbiAgICogRW5mb3JjZXMgdGhlIGJ1aWx0LWluIE1DUCBlbmRwb2ludCdzIGJvZHkgY29udHJhY3Qgd2l0aG91dCBwZXItYXBwIHBsdW1iaW5nOiB0aGVcbiAgICogSlNPTi1SUEMgZW52ZWxvcGUgaXMgcmVhZCBmcm9tIHBhcnNlZCBwYXJhbXMsIHNvIHJhdyBtb2RlIGlzIHJlamVjdGVkIHdpdGggYW5cbiAgICogYWN0aW9uYWJsZSBlcnJvciwgYW5kIGEgZnJhbWV3b3JrIGRlZmF1bHQgYnl0ZSBjYXAgYXBwbGllcyB3aGVuIHRoZSBhcHAgY29uZmlndXJlZCBub25lLlxuICAgKiBAcGFyYW0ge3thcmdzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cFJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJBcmdzLCBwb2xpY3k6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX19IG9wdGlvbnMgLSBSZXNvbHV0aW9uIGlucHV0cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX0gLSBFZmZlY3RpdmUgcmVxdWVzdCBwb2xpY3kuXG4gICAqL1xuICBfYXBwbHlNY3BSZXF1ZXN0Qm9keVBvbGljeURlZmF1bHRzKHthcmdzLCBwb2xpY3l9KSB7XG4gICAgaWYgKCF0aGlzLl9tY3AuZW5hYmxlZCkgcmV0dXJuIHBvbGljeVxuICAgIGlmIChhcmdzLmh0dHBNZXRob2QgIT09IFwiUE9TVFwiKSByZXR1cm4gcG9saWN5XG4gICAgaWYgKGFyZ3MucGF0aC5zcGxpdChcIj9cIilbMF0gIT09IHRoaXMuX21jcC5wYXRoKSByZXR1cm4gcG9saWN5XG5cbiAgICBpZiAocG9saWN5Lm1vZGUgPT09IFwicmF3XCIpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgIGBUaGUgYnVpbHQtaW4gTUNQIGVuZHBvaW50IGF0ICR7dGhpcy5fbWNwLnBhdGh9IHJlcXVpcmVzIHBhcnNlZCByZXF1ZXN0IGJvZGllcyBiZWNhdXNlIGl0cyBKU09OLVJQQyBlbnZlbG9wZSBpcyByZWFkIGZyb20gcGFyYW1zLiBSZW1vdmUgdGhlIHJhdy1tb2RlIGh0dHBTZXJ2ZXIucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciBlbnRyeSBmb3IgdGhpcyBwYXRoLmBcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAocG9saWN5Lm1heFJlcXVlc3RCb2R5Qnl0ZXMgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHBvbGljeVxuXG4gICAgcmV0dXJuIHttYXhSZXF1ZXN0Qm9keUJ5dGVzOiBERUZBVUxUX01DUF9NQVhfUkVRVUVTVF9CT0RZX0JZVEVTLCBtb2RlOiBwb2xpY3kubW9kZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb29raWUgc2VjcmV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENvb2tpZSBzZWNyZXQuXG4gICAqL1xuICBnZXRDb29raWVTZWNyZXQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nvb2tpZVNlY3JldFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb259IC0gU3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0U3luY0NvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX3N5bmNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgb2ZmbGluZSBncmFudCBzaWduaW5nIGtleS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudFNpZ25pbmdLZXl9IC0gQ3VycmVudCBzaWduaW5nIGtleS5cbiAgICovXG4gIGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5KCkge1xuICAgIGNvbnN0IHNpZ25pbmdLZXlzID0gdGhpcy5nZXRTeW5jQ29uZmlndXJhdGlvbigpLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzXG5cbiAgICByZXR1cm4gY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoc2lnbmluZ0tleXMpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBzeW5jIC0gU3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRWZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ29uZmlndXJhdGlvbihzeW5jKSB7XG4gICAgY29uc3QgYXBpID0gc3luYz8uYXBpXG4gICAgY29uc3QgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5ID0gc3luYz8uZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5IHx8IG51bGxcbiAgICBjb25zdCBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSA9IHN5bmM/LmNoYW5nZUZlZWRSZXRlbnRpb25TaXplXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50U2lnbmluZ0tleXMgPSBzeW5jPy5vZmZsaW5lR3JhbnRTaWduaW5nS2V5cyB8fCBbXVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudFR0bE1zID0gc3luYz8ub2ZmbGluZUdyYW50VHRsTXNcblxuICAgIGlmIChkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgIT09IG51bGwgJiYgKHR5cGVvZiBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgbXVzdCBiZSBhIHB1YmxpYyBKU09OIFdlYiBLZXkgb2JqZWN0XCIpXG4gICAgfVxuICAgIGlmIChjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSkgfHwgY2hhbmdlRmVlZFJldGVudGlvblNpemUgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2hhbmdlRmVlZFJldGVudGlvblNpemUgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJcIilcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzKSkgdGhyb3cgbmV3IEVycm9yKFwic3luYy5vZmZsaW5lR3JhbnRTaWduaW5nS2V5cyBtdXN0IGJlIGFuIGFycmF5XCIpXG4gICAgaWYgKG9mZmxpbmVHcmFudFR0bE1zICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKG9mZmxpbmVHcmFudFR0bE1zKSB8fCBvZmZsaW5lR3JhbnRUdGxNcyA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5vZmZsaW5lR3JhbnRUdGxNcyBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlciBudW1iZXIgb2YgbWlsbGlzZWNvbmRzXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFwaTogdGhpcy5fbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSxcbiAgICAgIGNoYW5nZUZlZWRSZXRlbnRpb25TaXplOiBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSB8fCAxMDAwMCxcbiAgICAgIGNsaWVudDogdGhpcy5fbm9ybWFsaXplU3luY0NsaWVudENvbmZpZ3VyYXRpb24oc3luYz8uY2xpZW50KSxcbiAgICAgIGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSxcbiAgICAgIG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzOiBvZmZsaW5lR3JhbnRTaWduaW5nS2V5cy5tYXAoKGtleSkgPT4gbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleShrZXkpKSxcbiAgICAgIG9mZmxpbmVHcmFudFR0bE1zOiBvZmZsaW5lR3JhbnRUdGxNcyB8fCAyNCAqIDYwICogNjAgKiAxMDAwXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgY2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uIGNvbnN1bWVkIGJ5IGBTeW5jQ2xpZW50LmZyb21Db25maWd1cmF0aW9uKC4uLilgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gY2xpZW50IC0gQ2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRWZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIGNsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ2xpZW50Q29uZmlndXJhdGlvbihjbGllbnQpIHtcbiAgICBpZiAoY2xpZW50ID09PSB1bmRlZmluZWQgfHwgY2xpZW50ID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIGNsaWVudCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNsaWVudCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50IG11c3QgYmUgYW4gb2JqZWN0IHdpdGggdHJhbnNwb3J0IGFuZCBhdXRoZW50aWNhdGlvblRva2VuXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge2F1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgaXNPbmxpbmUsIG1vdW50UGF0aCwgb25FcnJvciwgb2ZmbGluZSwgcmVhbHRpbWUsIHRyYW5zcG9ydCwgd2Vic29ja2V0Q2xpZW50LCB3ZWJzb2NrZXRVcmwsIC4uLnJlc3RDbGllbnR9ID0gY2xpZW50XG4gICAgY29uc3QgcmVzdENsaWVudEtleXMgPSBPYmplY3Qua2V5cyhyZXN0Q2xpZW50KVxuXG4gICAgaWYgKHJlc3RDbGllbnRLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RDbGllbnRLZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBpc09ubGluZSwgbW91bnRQYXRoLCBvbkVycm9yLCBvZmZsaW5lLCByZWFsdGltZSwgdHJhbnNwb3J0LCB3ZWJzb2NrZXRDbGllbnQsIHdlYnNvY2tldFVybClgKVxuICAgIH1cbiAgICBpZiAoIXRyYW5zcG9ydCB8fCB0eXBlb2YgdHJhbnNwb3J0ICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiB0cmFuc3BvcnQucG9zdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC50cmFuc3BvcnQgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBhIHBvc3QocGF0aCwgYm9keSkgbWV0aG9kIChsaWtlIHRoZSBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2xpZW50KVwiKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGF1dGhlbnRpY2F0aW9uVG9rZW4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYXV0aGVudGljYXRpb25Ub2tlbiBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIHRoZSBhdXRoIHRva2VuIHNlbnQgd2l0aCBzeW5jIHJlcXVlc3RzXCIpXG4gICAgfVxuICAgIGlmIChpc09ubGluZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBpc09ubGluZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5pc09ubGluZSBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIGNvbm5lY3Rpdml0eVwiKVxuICAgIH1cbiAgICBpZiAob25FcnJvciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvbkVycm9yICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9uRXJyb3IgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlcG9ydGluZyBiYWNrZ3JvdW5kIHN5bmMgZmFpbHVyZXNcIilcbiAgICB9XG4gICAgaWYgKGJhdGNoU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihiYXRjaFNpemUpIHx8IGJhdGNoU2l6ZSA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYmF0Y2hTaXplIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyXCIpXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuICAgIGlmICh3ZWJzb2NrZXRDbGllbnQgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHdlYnNvY2tldENsaWVudCAhPT0gXCJvYmplY3RcIiB8fCB3ZWJzb2NrZXRDbGllbnQgPT09IG51bGwgfHwgdHlwZW9mIHdlYnNvY2tldENsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC53ZWJzb2NrZXRDbGllbnQgbXVzdCBiZSBhIHdlYnNvY2tldCBjbGllbnQgd2l0aCBhIHN1YnNjcmliZUNoYW5uZWwgbWV0aG9kIChsaWtlIFZlbG9jaW91c1dlYnNvY2tldENsaWVudClcIilcbiAgICB9XG4gICAgaWYgKHdlYnNvY2tldFVybCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB3ZWJzb2NrZXRVcmwgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHdlYnNvY2tldFVybCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50LndlYnNvY2tldFVybCBtdXN0IGJlIGEgVVJMIHN0cmluZyBvciBhIGZ1bmN0aW9uIHJlc29sdmluZyBvbmUsIGdvdDogJHtTdHJpbmcod2Vic29ja2V0VXJsKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplLFxuICAgICAgaXNPbmxpbmUsXG4gICAgICBtb3VudFBhdGg6IChtb3VudFBhdGggfHwgXCIvdmVsb2Npb3VzL3N5bmNcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCIsXG4gICAgICBvZmZsaW5lOiB0aGlzLl9ub3JtYWxpemVTeW5jQ2xpZW50T2ZmbGluZUNvbmZpZ3VyYXRpb24ob2ZmbGluZSksXG4gICAgICBvbkVycm9yLFxuICAgICAgcmVhbHRpbWUsXG4gICAgICB0cmFuc3BvcnQsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQsXG4gICAgICB3ZWJzb2NrZXRVcmxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyB0aGUgY2xpZW50LXNpZGUgbG9uZy1vZmZsaW5lIHNlc3Npb24gY29uZmlndXJhdGlvbiBjb25zdW1lZCBieVxuICAgKiBgU3luY0NsaWVudC5zdGFydE9mZmxpbmVTZXNzaW9uKClgLiBUaGUgZnJhbWV3b3JrIG93bnMgdGhlIHNlc3Npb25cbiAgICogbGlmZWN5Y2xlOyB0aGUgYXBwIHByb3ZpZGVzIGR1cmFibGUgaWRlbnRpdHkgc3RvcmFnZSwgdGhlIGVucm9sbG1lbnQgaG9vayxcbiAgICogYW5kIHRoZSBncmFudCBzY29wZXMgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRPZmZsaW5lQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gb2ZmbGluZSAtIE9mZmxpbmUgY29uZmlndXJhdGlvbiBibG9jay5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkVmVsb2Npb3VzU3luY0NsaWVudE9mZmxpbmVDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgb2ZmbGluZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNDbGllbnRPZmZsaW5lQ29uZmlndXJhdGlvbihvZmZsaW5lKSB7XG4gICAgaWYgKG9mZmxpbmUgPT09IHVuZGVmaW5lZCB8fCBvZmZsaW5lID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIG9mZmxpbmUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShvZmZsaW5lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGRldmljZUlkZW50aXR5U3RvcmFnZSwgZW5yb2xsRGV2aWNlLCBhbmQgZ3JhbnRTY29wZXNcIilcbiAgICB9XG5cbiAgICBjb25zdCB7YmFja2VuZFB1YmxpY0tleSwgYm9vdHN0cmFwUGF0aCwgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLCBlbnJvbGxEZXZpY2UsIGdyYW50U2NvcGVzLCBncmFudFN0b3JhZ2UsIG11dGF0aW9uTG9nLCBub3csIHJlcGxheVBhdGgsIC4uLnJlc3RPZmZsaW5lfSA9IG9mZmxpbmVcbiAgICBjb25zdCByZXN0T2ZmbGluZUtleXMgPSBPYmplY3Qua2V5cyhyZXN0T2ZmbGluZSlcblxuICAgIGlmIChyZXN0T2ZmbGluZUtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5vZmZsaW5lIHJlY2VpdmVkIHVua25vd24ga2V5czogJHtyZXN0T2ZmbGluZUtleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBiYWNrZW5kUHVibGljS2V5LCBib290c3RyYXBQYXRoLCBkZXZpY2VJZGVudGl0eVN0b3JhZ2UsIGVucm9sbERldmljZSwgZ3JhbnRTY29wZXMsIGdyYW50U3RvcmFnZSwgbXV0YXRpb25Mb2csIG5vdywgcmVwbGF5UGF0aClgKVxuICAgIH1cbiAgICBpZiAoIWRldmljZUlkZW50aXR5U3RvcmFnZSB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGV2aWNlSWRlbnRpdHlTdG9yYWdlKSB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLmxvYWQgIT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLnNhdmUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5kZXZpY2VJZGVudGl0eVN0b3JhZ2UgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBsb2FkKCkgYW5kIHNhdmUoaWRlbnRpdHkpIG1ldGhvZHNcIilcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBlbnJvbGxEZXZpY2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5lbnJvbGxEZXZpY2UgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgYmFja2VuZC1zaWduZWQgZGV2aWNlIGNlcnRpZmljYXRlXCIpXG4gICAgaWYgKHR5cGVvZiBncmFudFNjb3BlcyAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmdyYW50U2NvcGVzIG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgdGhlIGJvb3RzdHJhcCBncmFudCBzY29wZXNcIilcbiAgICBpZiAoYmFja2VuZFB1YmxpY0tleSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgYmFja2VuZFB1YmxpY0tleSAhPT0gXCJvYmplY3RcIiB8fCBiYWNrZW5kUHVibGljS2V5ID09PSBudWxsIHx8IEFycmF5LmlzQXJyYXkoYmFja2VuZFB1YmxpY0tleSkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmJhY2tlbmRQdWJsaWNLZXkgbXVzdCBiZSBhIHB1YmxpYyBKU09OIFdlYiBLZXkgb2JqZWN0XCIpXG4gICAgfVxuICAgIGlmIChib290c3RyYXBQYXRoICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBib290c3RyYXBQYXRoICE9PSBcInN0cmluZ1wiIHx8ICFib290c3RyYXBQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5vZmZsaW5lLmJvb3RzdHJhcFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhib290c3RyYXBQYXRoKX1gKVxuICAgIH1cbiAgICBpZiAocmVwbGF5UGF0aCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgcmVwbGF5UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcmVwbGF5UGF0aC5zdGFydHNXaXRoKFwiL1wiKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQub2ZmbGluZS5yZXBsYXlQYXRoIG11c3Qgc3RhcnQgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocmVwbGF5UGF0aCl9YClcbiAgICB9XG4gICAgaWYgKGdyYW50U3RvcmFnZSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgZ3JhbnRTdG9yYWdlICE9PSBcIm9iamVjdFwiIHx8IGdyYW50U3RvcmFnZSA9PT0gbnVsbCB8fCBBcnJheS5pc0FycmF5KGdyYW50U3RvcmFnZSkgfHwgdHlwZW9mIGdyYW50U3RvcmFnZS5sb2FkICE9PSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIGdyYW50U3RvcmFnZS5zYXZlICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLmdyYW50U3RvcmFnZSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGxvYWQoKSBhbmQgc2F2ZShncmFudHMpIG1ldGhvZHNcIilcbiAgICB9XG4gICAgaWYgKG11dGF0aW9uTG9nICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtdXRhdGlvbkxvZyAhPT0gXCJvYmplY3RcIiB8fCBtdXRhdGlvbkxvZyA9PT0gbnVsbCB8fCB0eXBlb2YgbXV0YXRpb25Mb2cuYXBwZW5kICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lLm11dGF0aW9uTG9nIG11c3QgYmUgYSBMb2NhbE11dGF0aW9uTG9nXCIpXG4gICAgfVxuICAgIGlmIChub3cgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygbm93ICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9mZmxpbmUubm93IG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgdGhlIHNlc3Npb24gY2xvY2tcIilcblxuICAgIHJldHVybiB7XG4gICAgICBiYWNrZW5kUHVibGljS2V5LFxuICAgICAgYm9vdHN0cmFwUGF0aDogKGJvb3RzdHJhcFBhdGggfHwgXCIvZnJvbnRlbmQtbW9kZWxzL3N5bmMvYm9vdHN0cmFwXCIpLnJlcGxhY2UoL1xcLyskL3UsIFwiXCIpIHx8IFwiL1wiLFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRldmljZUlkZW50aXR5U3RvcmFnZSxcbiAgICAgIGVucm9sbERldmljZSxcbiAgICAgIGdyYW50U2NvcGVzLFxuICAgICAgZ3JhbnRTdG9yYWdlLFxuICAgICAgbXV0YXRpb25Mb2csXG4gICAgICBub3c6IG5vdyB8fCAoKCkgPT4gbmV3IERhdGUoKSksXG4gICAgICByZXBsYXlQYXRoOiAocmVwbGF5UGF0aCB8fCBcIi9mcm9udGVuZC1tb2RlbHMvc3luYy9yZXBsYXlcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIEFQSSBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gYXBpIC0gU3luYyBBUEkgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHN5bmMgQVBJIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSB7XG4gICAgaWYgKGFwaSA9PT0gdW5kZWZpbmVkIHx8IGFwaSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgaWYgKHR5cGVvZiBhcGkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhcGkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmFwaSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGEgcmVzb3VyY2VDbGFzc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9ID0gYXBpXG5cbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzIG11c3QgYmUgYSByZXNvdXJjZSBjbGFzcywgZ290OiAke1N0cmluZyhyZXNvdXJjZUNsYXNzKX1gKVxuICAgIH1cbiAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzICR7cmVzb3VyY2VDbGFzcy5uYW1lfSBtdXN0IGRlZmluZSBzdGF0aWMgTW9kZWxDbGFzc2ApXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlPn0gLSBUaGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2UpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgIGlmICghdGhpcy5kYXRhYmFzZVt0aGlzLmdldEVudmlyb25tZW50KCldKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gZm9yIGVudmlyb25tZW50OiAke3RoaXMuZ2V0RW52aXJvbm1lbnQoKX0gLSAke09iamVjdC5rZXlzKHRoaXMuZGF0YWJhc2UpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YWJhc2VcIiwgdGhpcy5nZXRFbnZpcm9ubWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgdGhlIGlkZW50aWZpZXIuXG4gICAqL1xuICByZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIsIHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpKSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVtpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBkYXRhYmFzZSBpZGVudGlmaWVyIGNvbmZpZ3VyZWQ6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGlmICh0ZW5hbnQgPT09IHVuZGVmaW5lZCB8fCAhdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcikge1xuICAgICAgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuICAgIH1cblxuICAgIGNvbnN0IG92ZXJyaWRlQ29uZmlndXJhdGlvbiA9IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgIGlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuXG4gICAgcmV0dXJuIG1lcmdlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3ZlcnJpZGVDb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpc2FibGVkIGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRGlzYWJsZWQgZGF0YWJhc2UgaWRlbnRpZmllcnMgZnJvbSBlbnYgZmxhZ3MuXG4gICAqL1xuICBnZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVycyA9IG5ldyBTZXQoKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnNSYXcgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRElTQUJMRURfREFUQUJBU0VfSURFTlRJRklFUlNcblxuICAgIGlmIChkaXNhYmxlZElkZW50aWZpZXJzUmF3KSB7XG4gICAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGlzYWJsZWRJZGVudGlmaWVyc1Jhdy5zcGxpdChcIixcIikpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGlkZW50aWZpZXIudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIGRpc2FibGVkSWRlbnRpZmllcnMuYWRkKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHByb2Nlc3MuZW52LlZFTE9DSU9VU19ESVNBQkxFX01TU1FMID09PSBcIjFcIikge1xuICAgICAgZGlzYWJsZWRJZGVudGlmaWVycy5hZGQoXCJtc3NxbFwiKVxuICAgIH1cblxuICAgIHJldHVybiBkaXNhYmxlZElkZW50aWZpZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBpZGVudGlmaWVyIGFjdGl2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGRhdGFiYXNlIGlkZW50aWZpZXIgaXMgYWN0aXZlIGluIHRoZSBjdXJyZW50IHRlbmFudCBjb250ZXh0LlxuICAgKi9cbiAgaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllciwgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KCkpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIGRhdGFiYXNlIGlkZW50aWZpZXIgY29uZmlndXJlZDogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkgcmV0dXJuIHRydWVcbiAgICBpZiAodGVuYW50ID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3Qgb3ZlcnJpZGVDb25maWd1cmF0aW9uID0gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgaWRlbnRpZmllcixcbiAgICAgIHRlbmFudFxuICAgIH0pXG5cbiAgICByZXR1cm4gQm9vbGVhbihvdmVycmlkZUNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyh0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnMgPSB0aGlzLmdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpXG5cbiAgICByZXR1cm4gaWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiAhZGlzYWJsZWRJZGVudGlmaWVycy5oYXMoaWRlbnRpZmllcikgJiYgdGhpcy5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBIdW1hbi1yZWFkYWJsZSBzZXJ2ZXIgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBhc3luYyBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGxvY2FsU25hcHNob3QgPSB0aGlzLmdldExvY2FsRGVidWdTbmFwc2hvdCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ubG9jYWxTbmFwc2hvdCxcbiAgICAgIGh0dHBTZXJ2ZXI6IGF3YWl0IHRoaXMuX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWwgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gSHVtYW4tcmVhZGFibGUgZGlhZ25vc3RpY3MgZm9yIHRoaXMgcHJvY2VzcyBvbmx5LlxuICAgKi9cbiAgZ2V0TG9jYWxEZWJ1Z1NuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBiYWNrZ3JvdW5kSm9iczogdGhpcy5fZGVidWdCYWNrZ3JvdW5kSm9ic1NuYXBzaG90KCksXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9kZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpLFxuICAgICAgZGF0YWJhc2U6IHRoaXMuX2RlYnVnRGF0YWJhc2VTbmFwc2hvdCgpLFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHNlcnZlcjogdGhpcy5fZGVidWdTZXJ2ZXJTbmFwc2hvdCgpLFxuICAgICAgd2Vic29ja2V0czogdGhpcy5fZGVidWdXZWJzb2NrZXRTbmFwc2hvdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgaHR0cCBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gSFRUUCBzZXJ2ZXIgd29ya2VyIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgYXN5bmMgX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KCkge1xuICAgIGNvbnN0IGh0dHBTZXJ2ZXIgPSAvKiogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90PzogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSlcblxuICAgIGlmICghaHR0cFNlcnZlcj8uZ2V0RGVidWdTbmFwc2hvdCkge1xuICAgICAgcmV0dXJuIHtjb25maWd1cmVkOiBCb29sZWFuKHRoaXMuaHR0cFNlcnZlciksIGFjdGl2ZTogZmFsc2V9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IGh0dHBTZXJ2ZXIuZ2V0RGVidWdTbmFwc2hvdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2VydmVyIHJ1bnRpbWUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdTZXJ2ZXJTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBub2RlUHJvY2VzcyA9IHR5cGVvZiBwcm9jZXNzID09PSBcInVuZGVmaW5lZFwiID8gdW5kZWZpbmVkIDogcHJvY2Vzc1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmdldEVudmlyb25tZW50KCksXG4gICAgICBtZW1vcnlVc2FnZTogbm9kZVByb2Nlc3MgPyBub2RlUHJvY2Vzcy5tZW1vcnlVc2FnZSgpIDogdW5kZWZpbmVkLFxuICAgICAgbm9kZVZlcnNpb246IG5vZGVQcm9jZXNzPy52ZXJzaW9ucz8ubm9kZSxcbiAgICAgIHBpZDogbm9kZVByb2Nlc3M/LnBpZCxcbiAgICAgIHBsYXRmb3JtOiBub2RlUHJvY2Vzcz8ucGxhdGZvcm0sXG4gICAgICB1cHRpbWVTZWNvbmRzOiBub2RlUHJvY2VzcyA/IG5vZGVQcm9jZXNzLnVwdGltZSgpIDogdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgY29uZmlndXJhdGlvbiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb25maWd1cmF0aW9uIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnQ29uZmlndXJhdGlvblNuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBhcGlNYW5pZmVzdDogdGhpcy5fYXBpTWFuaWZlc3RFbmFibGVkKCkgPyB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogdGhpcy5fYXBpTWFuaWZlc3QucGF0aCwgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuKX0gOiB7ZW5hYmxlZDogZmFsc2V9LFxuICAgICAgYXV0b2xvYWQ6IHRoaXMuZ2V0QXV0b2xvYWQoKSxcbiAgICAgIGRlYnVnOiB0aGlzLmRlYnVnID09PSB0cnVlLFxuICAgICAgZGVidWdFbmRwb2ludDogdGhpcy5fZGVidWdFbmRwb2ludFNuYXBzaG90KCksXG4gICAgICBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IHRoaXMuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCksXG4gICAgICBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50czogdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpLFxuICAgICAgaW5pdGlhbGl6ZWQ6IHRoaXMuX2lzSW5pdGlhbGl6ZWQsXG4gICAgICBtY3A6IHRoaXMuX21jcC5lbmFibGVkID8ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IHRoaXMuX21jcC5wYXRoLCB0b2tlbkNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fbWNwLnRva2VuKX0gOiB7ZW5hYmxlZDogZmFsc2V9LFxuICAgICAgbG9nZ2luZzoge1xuICAgICAgICBkZWJ1Z0xvd0xldmVsOiB0aGlzLl9sb2dnaW5nPy5kZWJ1Z0xvd0xldmVsID09PSB0cnVlLFxuICAgICAgICBvdXRwdXRzOiB0aGlzLl9sb2dnaW5nID8gT2JqZWN0LmtleXModGhpcy5fbG9nZ2luZykgOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGJhY2tncm91bmQgam9icyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBCYWNrZ3JvdW5kIGpvYiBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0JhY2tncm91bmRKb2JzU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fYmFja2dyb3VuZEpvYnMpLFxuICAgICAgc2NoZWR1bGVkQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBkYXRhYmFzZSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0RhdGFiYXNlU25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogRGF0YWJhc2UgcG9vbHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLkRhdGFiYXNlUG9vbERlYnVnU25hcHNob3Q+fSAqL1xuICAgIGNvbnN0IGRhdGFiYXNlUG9vbHMgPSB7fVxuICAgIGNvbnN0IGFjdGl2ZUlkZW50aWZpZXJzID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBhY3RpdmVJZGVudGlmaWVycykge1xuICAgICAgZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmdldERlYnVnU25hcHNob3QoKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhY3RpdmVJZGVudGlmaWVycyxcbiAgICAgIGRpc2FibGVkSWRlbnRpZmllcnM6IEFycmF5LmZyb20odGhpcy5nZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSksXG4gICAgICBpbml0aWFsaXplZFBvb2xzOiBPYmplY3Qua2V5cyh0aGlzLmRhdGFiYXNlUG9vbHMpLFxuICAgICAgcG9vbHM6IGRhdGFiYXNlUG9vbHNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyB3ZWJzb2NrZXQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2ViU29ja2V0IGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnV2Vic29ja2V0U25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBidWNrZXRzLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y291bnQ6IG51bWJlciwgZGV0YWlsczoge2NoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogbnVtYmVyLCBjaGFubmVsU3Vic2NyaXB0aW9uczoge2NoYW5uZWxUeXBlOiBzdHJpbmcsIGNvdW50OiBudW1iZXIsIG1vZGVsOiBzdHJpbmcgfCBudWxsfVtdLCBjb25uZWN0aW9uQ291bnQ6IG51bWJlciwgcGF1c2VkOiBib29sZWFuLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfX0+fSAqL1xuICAgIGNvbnN0IHNlc3Npb25CdWNrZXRzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBkZXRhaWxzLlxuICAgICAqIEB0eXBlIHt7Y2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXIsIGNoYW5uZWxTdWJzY3JpcHRpb25zOiB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9W10sIGNvbm5lY3Rpb25Db3VudDogbnVtYmVyLCBwYXVzZWQ6IGJvb2xlYW4sIHF1ZXVlZE1lc3NhZ2VDb3VudDogbnVtYmVyLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IHNlc3Npb25EZXRhaWxzID0gW11cbiAgICBjb25zdCBzdWJzY3JpcHRpb25zID0gQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5lbnRyaWVzKCkpLm1hcCgoW2NoYW5uZWwsIGNoYW5uZWxTdWJzY3JpcHRpb25zXSkgPT4ge1xuICAgICAgLyoqXG4gICAgICAgKiBEZXRhaWxzIGJ1Y2tldHMuXG4gICAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2NvdW50OiBudW1iZXIsIGRldGFpbHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgICAgY29uc3QgZGV0YWlsc0J1Y2tldHMgPSBuZXcgTWFwKClcblxuICAgICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgY2hhbm5lbFN1YnNjcmlwdGlvbnMpIHtcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpKVxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShkZXRhaWxzKVxuICAgICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IGRldGFpbHNCdWNrZXRzLmdldChrZXkpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRldGFpbHNCdWNrZXRzLnNldChrZXksIHtjb3VudDogMSwgZGV0YWlsc30pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgY291bnQ6IGNoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGRldGFpbHM6IEFycmF5LmZyb20oZGV0YWlsc0J1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IHNlc3Npb24gb2YgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogQ2hhbm5lbCBzdWJzY3JpcHRpb24gYnVja2V0cy5cbiAgICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9Pn0gKi9cbiAgICAgIGNvbnN0IGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzID0gbmV3IE1hcCgpXG5cbiAgICAgIGZvciAoY29uc3Qge2NoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb259IG9mIHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICAgIGNvbnN0IGRldGFpbHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpXG4gICAgICAgIGNvbnN0IG1vZGVsID0gdHlwZW9mIGRldGFpbHMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBkZXRhaWxzLm1vZGVsIDogbnVsbFxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeSh7Y2hhbm5lbFR5cGUsIG1vZGVsfSlcbiAgICAgICAgY29uc3QgZXhpc3RpbmdCdWNrZXQgPSBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5nZXQoa2V5KVxuXG4gICAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5zZXQoa2V5LCB7Y2hhbm5lbFR5cGUsIGNvdW50OiAxLCBtb2RlbH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBBcnJheS5mcm9tKGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudClcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0ge1xuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNlc3Npb24uX2Nvbm5lY3Rpb25zLnNpemUsXG4gICAgICAgIHBhdXNlZDogc2Vzc2lvbi5fcGF1c2VkLFxuICAgICAgICBxdWV1ZWRNZXNzYWdlQ291bnQ6IHNlc3Npb24uX291dGJvdW5kUXVldWUubGVuZ3RoLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc2Vzc2lvbi5zdWJzY3JpcHRpb25zLnNpemVcbiAgICAgIH1cbiAgICAgIGNvbnN0IGJ1Y2tldEtleSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zOiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgY29ubmVjdGlvbkNvdW50OiBzbmFwc2hvdC5jb25uZWN0aW9uQ291bnQsXG4gICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc25hcHNob3Quc3Vic2NyaXB0aW9uQ291bnRcbiAgICAgIH0pXG4gICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IHNlc3Npb25CdWNrZXRzLmdldChidWNrZXRLZXkpXG5cbiAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXNzaW9uQnVja2V0cy5zZXQoYnVja2V0S2V5LCB7XG4gICAgICAgICAgY291bnQ6IDEsXG4gICAgICAgICAgZGV0YWlsczoge1xuICAgICAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uczogc25hcHNob3QuY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNuYXBzaG90LmNvbm5lY3Rpb25Db3VudCxcbiAgICAgICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LnN1YnNjcmlwdGlvbkNvdW50XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgc2Vzc2lvbkRldGFpbHMucHVzaChzbmFwc2hvdClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgbGl2ZU9ubHlDaGFubmVsczogQXJyYXkuZnJvbSh0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzKSxcbiAgICAgIHBhdXNlZFNlc3Npb25zOiB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5zaXplLFxuICAgICAgcmVnaXN0ZXJlZENoYW5uZWxzOiBBcnJheS5mcm9tKHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzLmtleXMoKSksXG4gICAgICByZWdpc3RlcmVkQ29ubmVjdGlvbnM6IEFycmF5LmZyb20odGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMua2V5cygpKSxcbiAgICAgIHNlc3Npb25CdWNrZXRzOiBBcnJheS5mcm9tKHNlc3Npb25CdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudCksXG4gICAgICBzZXNzaW9uQ291bnQ6IHRoaXMuX3dlYnNvY2tldFNlc3Npb25zLnNpemUsXG4gICAgICBzZXNzaW9uczogc2Vzc2lvbkRldGFpbHMuc29ydCgoYSwgYikgPT4gYi5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQgLSBhLmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCksXG4gICAgICBzdWJzY3JpcHRpb25Hcm91cHM6IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICBzdWJzY3JpcHRpb25zXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGRhdGFiYXNlIHBvb2wuXG4gICAqL1xuICBnZXREYXRhYmFzZVBvb2woaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgaWYgKCF0aGlzLmlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoaWRlbnRpZmllcikpIHtcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZURhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuICAgIH1cblxuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YWJhc2VQb29sc1wiLCBpZGVudGlmaWVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZyYW1ld29yay1vd25lZCBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGxpZmVjeWNsZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlfSAtIExpZmVjeWNsZSBvd25lci5cbiAgICovXG4gIGdldEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlKCkgeyByZXR1cm4gdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhZmUgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGVbXCJpbnNwZWN0QWxsXCJdPn0gLSBMaWZlY3ljbGUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBpbnNwZWN0RnJvbnRlbmRUZW5hbnRTcWxpdGVIYW5kbGVzKCkgeyByZXR1cm4gdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUuaW5zcGVjdEFsbCgpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9KVxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGlkZW50aWZpZXIpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBzY2hlbWEgbWV0YWRhdGEgY2FjaGVkIGJ5IGV2ZXJ5IGluaXRpYWxpemVkIHBvb2wgdGhhdCB0YXJnZXRzIHRoZVxuICAgKiBzYW1lIHBoeXNpY2FsIGRhdGFiYXNlIChtYXRjaGVkIGJ5IGNvbm5lY3Rpb24gcmV1c2Uga2V5KS4gU2VwYXJhdGUgcG9vbHMgdGhhdFxuICAgKiBwb2ludCBhdCBvbmUgZGF0YWJhc2Uga2VlcCBpbmRlcGVuZGVudCBzY2hlbWEgY2FjaGVzLCBzbyBEREwgcnVuIHRocm91Z2ggb25lXG4gICAqIHBvb2wgd291bGQgb3RoZXJ3aXNlIGxlYXZlIHRoZSBvdGhlcnMgcmVwb3J0aW5nIHN0YWxlIHRhYmxlcy9jb2x1bW5zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBDb25uZWN0aW9uIHJldXNlIGtleSBpZGVudGlmeWluZyB0aGUgc2hhcmVkIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjbGVhclNjaGVtYUNhY2hlc0ZvclJldXNlS2V5KHJldXNlS2V5KSB7XG4gICAgdGhpcy5fc2NoZW1hQ2FjaGVHZW5lcmF0aW9uc0J5UmV1c2VLZXkuc2V0KFxuICAgICAgcmV1c2VLZXksXG4gICAgICB0aGlzLnNjaGVtYUNhY2hlR2VuZXJhdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KSArIDFcbiAgICApXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoKSA9PT0gcmV1c2VLZXkpIHtcbiAgICAgICAgcG9vbC5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3VycmVudCBzY2hlbWEtY2FjaGUgZ2VuZXJhdGlvbiBmb3Igb25lIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBDb25uZWN0aW9uIHJldXNlIGtleSBpZGVudGlmeWluZyB0aGUgc2hhcmVkIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEN1cnJlbnQgc2NoZW1hLWNhY2hlIGdlbmVyYXRpb24uXG4gICAqL1xuICBzY2hlbWFDYWNoZUdlbmVyYXRpb25Gb3JSZXVzZUtleShyZXVzZUtleSkge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb25zQnlSZXVzZUtleS5nZXQocmV1c2VLZXkpIHx8IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnZhbGlkYXRlcyByZWNvcmQgbWV0YWRhdGEgb3duZWQgYnkgb25lIGNsb3NlZC9kZWxldGVkIHBoeXNpY2FsIHRlbmFudFxuICAgKiBkYXRhYmFzZSB3aGlsZSBwcmVzZXJ2aW5nIGV2ZXJ5IG90aGVyIHRlbmFudCBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIExvZ2ljYWwgaWRlbnRpZmllciBwbHVzIHBvb2wgcmV1c2Uga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyUmVjb3JkTWV0YWRhdGFGb3JEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLm1vZGVsQ2xhc3NlcykpIHtcbiAgICAgIG1vZGVsQ2xhc3MuY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlc0ZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgcG9vbCB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZGF0YWJhc2UgcG9vbCB0eXBlLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VQb29sVHlwZShpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBjb25zdCBwb29sVHlwZUNsYXNzID0gZGlnZyh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKSwgXCJwb29sVHlwZVwiKVxuXG4gICAgaWYgKCFwb29sVHlwZUNsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBwb29sVHlwZSBnaXZlbiBpbiBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucmVzb2x2ZVRlc3RTaGFyZWRUcmFuc2FjdGlvblBvb2xUeXBlKHtcbiAgICAgIGNvbmZpZ3VyZWRQb29sVHlwZTogcG9vbFR5cGVDbGFzcyxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogaWRlbnRpZmllclxuICAgIH0pXG4gIH1cblxuICBnZXREYXRhYmFzZVR5cGUoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgY29uc3QgZGF0YWJhc2VUeXBlID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllcikudHlwZVxuXG4gICAgaWYgKCFkYXRhYmFzZVR5cGUpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIHR5cGUgZ2l2ZW4gaW4gZGF0YWJhc2UgY29uZmlndXJhdGlvblwiKVxuXG4gICAgcmV0dXJuIGRhdGFiYXNlVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGlyZWN0b3J5LlxuICAgKi9cbiAgZ2V0RGlyZWN0b3J5KCkge1xuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKVxuXG4gICAgaWYgKCFkaXJlY3RvcnkpIHRocm93IG5ldyBFcnJvcihcIk5vIGRpcmVjdG9yeSBjb25maWd1cmVkIGFuZCBwcm9jZXNzLmN3ZCBpcyB1bmF2YWlsYWJsZVwiKVxuXG4gICAgcmV0dXJuIGRpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpcmVjdG9yeSBpZiBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGRpcmVjdG9yeSB3aGVuIHRoZSBydW50aW1lIGNhbiByZXNvbHZlIG9uZS5cbiAgICovXG4gIGdldERpcmVjdG9yeUlmQXZhaWxhYmxlKCkge1xuICAgIGlmICghdGhpcy5fZGlyZWN0b3J5KSB7XG4gICAgICB0aGlzLl9kaXJlY3RvcnkgPSBjdXJyZW50V29ya2luZ0RpcmVjdG9yeSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJhY2tlbmQgcHJvamVjdHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119IC0gQmFja2VuZCBwcm9qZWN0cy5cbiAgICovXG4gIGdldEJhY2tlbmRQcm9qZWN0cygpIHsgcmV0dXJuIHRoaXMuX2JhY2tlbmRQcm9qZWN0cyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBhY2thZ2VzLlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzUGFja2FnZVtdfSAtIFJlZ2lzdGVyZWQgVmVsb2Npb3VzIHBhY2thZ2VzLlxuICAgKi9cbiAgZ2V0UGFja2FnZXMoKSB7IHJldHVybiB0aGlzLl9wYWNrYWdlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFiaWxpdHkgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICovXG4gIGdldEFiaWxpdHlSZXNvdXJjZXMoKSB7IHJldHVybiB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYWJpbGl0eSByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSByZXNvdXJjZXMgLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEFiaWxpdHlSZXNvdXJjZXMocmVzb3VyY2VzKSB7IHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSByZXNvdXJjZXMgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgcmVzb3VyY2UgY2xhc3NlcyBkaXNjb3ZlcmVkIGZyb20gdGhlIGFwcCBhbmQgZXZlcnkgcmVnaXN0ZXJlZCBwYWNrYWdlXG4gICAqIGludG8gdGhlIGFiaWxpdHktcmVzb3VyY2VzIGxpc3QuIGBhdXRvRGlzY292ZXJSZXNvdXJjZXNgIHBvcHVsYXRlcyBlYWNoIGJhY2tlbmRcbiAgICogcHJvamVjdCdzIGBmcm9udGVuZE1vZGVsc2AgKGluY2x1ZGluZyBwYWNrYWdlIHByb2plY3RzKSwgc28gdGhpcyBtYWtlcyBhXG4gICAqIHBhY2thZ2UtY29udHJpYnV0ZWQgbW9kZWwncyBhYmlsaXRpZXMgcmVhY2ggc3Vic2NyaXB0aW9uIGFuZCBwZXItcmVjb3JkXG4gICAqIGF1dGhvcml6YXRpb24gYXV0b21hdGljYWxseSDigJQgY29uc3VtaW5nIGFwcHMgZG8gbm90IGhhdmUgdG8gaGFuZC1yZWdpc3RlclxuICAgKiBwYWNrYWdlIHJlc291cmNlcy4gQWxyZWFkeS1wcmVzZW50IGNsYXNzZXMgKGUuZy4gYW4gYXBwJ3MgZXhwbGljaXRseS1zZXRcbiAgICogcmVzb3VyY2VzKSBhcmUgbGVmdCB1bnRvdWNoZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9tZXJnZURpc2NvdmVyZWRBYmlsaXR5UmVzb3VyY2VzKCkge1xuICAgIGNvbnN0IG1lcmdlZCA9IFsuLi50aGlzLl9hYmlsaXR5UmVzb3VyY2VzXVxuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0KG1lcmdlZClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5fYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBpZiAoIWJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3QgUmVzb3VyY2VDbGFzcyBvZiBiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzKSB7XG4gICAgICAgIGlmIChzZWVuLmhhcyhSZXNvdXJjZUNsYXNzKSkgY29udGludWVcblxuICAgICAgICBzZWVuLmFkZChSZXNvdXJjZUNsYXNzKVxuICAgICAgICBtZXJnZWQucHVzaChSZXNvdXJjZUNsYXNzKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSBtZXJnZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gQWJpbGl0eSByZXNvbHZlci5cbiAgICovXG4gIGdldEFiaWxpdHlSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX2FiaWxpdHlSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnRSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGVuYW50IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0VGVuYW50UmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl90ZW5hbnRSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3QgdGVuYW50IHBvb2wgY29uZmlndXJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVzdFRlbmFudFBvb2xzQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBPcHQtaW4gdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbHMga2V5ZWQgYnkgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldFRlc3RUZW5hbnRQb29scygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RUZW5hbnRQb29scyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHJlcXVpcmUgYSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpIHsgcmV0dXJuIHRoaXMuX2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGU+fSAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXJzLlxuICAgKi9cbiAgZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcnMoKSB7IHJldHVybiB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXIuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVyKGlkZW50aWZpZXIpIHtcbiAgICBjb25zdCBwcm92aWRlciA9IHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBjb25maWd1cmVkIGZvciBkYXRhYmFzZSBpZGVudGlmaWVyOiAke2lkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvdmlkZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbn0gLSBBdHRhY2htZW50cyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fYXR0YWNobWVudHMgfHwge30gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Sb3V0ZVJlc29sdmVySG9va1R5cGVbXX0gLSBSb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICovXG4gIGdldFJvdXRlUmVzb2x2ZXJIb29rcygpIHsgcmV0dXJuIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHJvdXRlIHJlc29sdmVyIGhvb2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJvdXRlUmVzb2x2ZXJIb29rVHlwZX0gaG9vayAtIFJvdXRlIHJlc29sdmVyIGhvb2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFkZFJvdXRlUmVzb2x2ZXJIb29rKGhvb2spIHtcbiAgICB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MucHVzaChob29rKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gQWJpbGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QWJpbGl0eVJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX2FiaWxpdHlSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnRSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gVGVuYW50IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUZW5hbnRSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl90ZW5hbnRSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBUZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVzdCB0ZW5hbnQgcG9vbCBjb25maWd1cmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVzdFRlbmFudFBvb2xzQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gcG9vbHMgLSBPcHQtaW4gdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlc3RUZW5hbnRQb29scyhwb29scykgeyB0aGlzLl90ZXN0VGVuYW50UG9vbHMgPSBwb29scyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyByZXF1aXJlIGEgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyhuZXdWYWx1ZSkgeyB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlPn0gcHJvdmlkZXJzIC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKHByb3ZpZGVycykgeyB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyA9IHByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBlbnZpcm9ubWVudC5cbiAgICovXG4gIGdldEVudmlyb25tZW50KCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcIl9lbnZpcm9ubWVudFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlcXVlc3QgdGltZW91dCBtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBSZXF1ZXN0IHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIGdldFJlcXVlc3RUaW1lb3V0TXMoKSB7XG4gICAgY29uc3QgZW52VGltZW91dCA9IHRoaXMuX3BhcnNlUmVxdWVzdFRpbWVvdXRTZWNvbmRzKHByb2Nlc3MuZW52LlZFTE9DSU9VU19SRVFVRVNUX1RJTUVPVVRfTVMpXG4gICAgY29uc3QgdmFsdWUgPSB0eXBlb2YgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMoKVxuICAgICAgOiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodHlwZW9mIGVudlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlRpbWVvdXQpKSByZXR1cm4gZW52VGltZW91dFxuXG4gICAgcmV0dXJuIDYwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSByZXF1ZXN0IHRpbWVvdXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHJhd1ZhbHVlIC0gRW52IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIF9wYXJzZVJlcXVlc3RUaW1lb3V0U2Vjb25kcyhyYXdWYWx1ZSkge1xuICAgIGlmIChyYXdWYWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB0cmltbWVkID0gcmF3VmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9eKFxcZCsoPzpcXC5cXGQrKT8pKG1zfHMpPyQvKVxuXG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcihtYXRjaFsxXSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKG51bWVyaWMpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB1bml0ID0gbWF0Y2hbMl1cblxuICAgIGlmICh1bml0ID09PSBcIm1zXCIpIHJldHVybiBudW1lcmljIC8gMTAwMFxuICAgIGlmICh1bml0ID09PSBcInNcIikgcmV0dXJuIG51bWVyaWNcblxuICAgIGlmICh0cmltbWVkLmluY2x1ZGVzKFwiLlwiKSkgcmV0dXJuIG51bWVyaWNcbiAgICBpZiAobnVtZXJpYyA+PSAxMDAwKSByZXR1cm4gbnVtZXJpYyAvIDEwMDBcblxuICAgIHJldHVybiBudW1lcmljXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZW52aXJvbm1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdFbnZpcm9ubWVudCAtIE5ldyBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0RW52aXJvbm1lbnQobmV3RW52aXJvbm1lbnQpIHsgdGhpcy5fZW52aXJvbm1lbnQgPSBuZXdFbnZpcm9ubWVudCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlZmF1bHRDb25zb2xlXSAtIFdoZXRoZXIgZGVmYXVsdCBjb25zb2xlLlxuICAgKiBAcmV0dXJucyB7UmVxdWlyZWQ8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiY29uc29sZVwiIHwgXCJmaWxlXCIgfCBcImxldmVsc1wiPj4gJiBQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJkaXJlY3RvcnlcIiB8IFwiZmlsZVBhdGhcIj4gJiBQYXJ0aWFsPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcIm91dHB1dHNcIiB8IFwibG9nZ2Vyc1wiPj59IC0gVGhlIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldExvZ2dpbmdDb25maWd1cmF0aW9uKHtkZWZhdWx0Q29uc29sZX0gPSB7fSkge1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gdGhpcy5nZXRFbnZpcm9ubWVudCgpXG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuX2xvZ2dpbmc/LmRpcmVjdG9yeSB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0RGVmYXVsdExvZ0RpcmVjdG9yeSh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLl9sb2dnaW5nPy5maWxlUGF0aCB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0TG9nRmlsZVBhdGgoe2NvbmZpZ3VyYXRpb246IHRoaXMsIGRpcmVjdG9yeSwgZW52aXJvbm1lbnR9KVxuICAgIGNvbnN0IGNvbnNvbGVPdmVycmlkZSA9IHRoaXMuX2xvZ2dpbmc/LmNvbnNvbGVcbiAgICBjb25zdCBoYXNMb2dnaW5nQ29uZmlnID0gQm9vbGVhbih0aGlzLl9sb2dnaW5nKVxuICAgIGNvbnN0IGZpbGVMb2dnaW5nID0gaGFzTG9nZ2luZ0NvbmZpZyA/ICh0aGlzLl9sb2dnaW5nPy5maWxlID8/IEJvb2xlYW4oZmlsZVBhdGgpKSA6IGZhbHNlXG4gICAgY29uc3QgY29uZmlndXJlZExldmVscyA9IHRoaXMuX2xvZ2dpbmc/LmxldmVsc1xuICAgIGNvbnN0IGluY2x1ZGVMb3dMZXZlbERlYnVnID0gdGhpcy5fbG9nZ2luZz8uZGVidWdMb3dMZXZlbCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGxvZ2dlcnMgPSB0aGlzLl9sb2dnaW5nPy5sb2dnZXJzXG5cbiAgICBjb25zdCBjb25zb2xlRGVmYXVsdCA9IGRlZmF1bHRDb25zb2xlICE9PSB1bmRlZmluZWQgPyBkZWZhdWx0Q29uc29sZSA6IHRydWVcbiAgICBjb25zdCBjb25zb2xlTG9nZ2luZyA9IGNvbnNvbGVPdmVycmlkZSAhPT0gdW5kZWZpbmVkID8gY29uc29sZU92ZXJyaWRlIDogY29uc29sZURlZmF1bHRcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgbGV2ZWxzLlxuICAgICAqIEB0eXBlIHtBcnJheTxcImRlYnVnLWxvdy1sZXZlbFwiIHwgXCJkZWJ1Z1wiIHwgXCJpbmZvXCIgfCBcIndhcm5cIiB8IFwiZXJyb3JcIj59ICovXG4gICAgY29uc3QgZGVmYXVsdExldmVscyA9IFtcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl1cblxuICAgIGlmIChpbmNsdWRlTG93TGV2ZWxEZWJ1ZykgZGVmYXVsdExldmVscy51bnNoaWZ0KFwiZGVidWctbG93LWxldmVsXCIpXG5cbiAgICBjb25zdCBsZXZlbHMgPSBjb25maWd1cmVkTGV2ZWxzIHx8IGRlZmF1bHRMZXZlbHNcblxuICAgIHJldHVybiB7XG4gICAgICBjb25zb2xlOiBjb25zb2xlTG9nZ2luZyxcbiAgICAgIGRpcmVjdG9yeSxcbiAgICAgIGZpbGU6IGZpbGVMb2dnaW5nID8/IGZhbHNlLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBsb2dnZXJzLFxuICAgICAgbGV2ZWxzLFxuICAgICAgb3V0cHV0czogdGhpcy5fbG9nZ2luZz8ub3V0cHV0c1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb25maWd1cmF0aW9uLW93bmVkIHN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICogQHJldHVybnMge0xvZ1JlZGFjdG9yfSAtIFN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICovXG4gIGdldExvZ1JlZGFjdG9yKCkge1xuICAgIHJldHVybiB0aGlzLl9sb2dSZWRhY3RvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5IGxvZ2dpbmcgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBxdWVyeSBsb2dnaW5nIGlzIGVuYWJsZWQuXG4gICAqL1xuICBnZXRRdWVyeUxvZ2dpbmdFbmFibGVkKCkge1xuICAgIGlmICh0aGlzLl9sb2dnaW5nPy5xdWVyeUxvZ2dpbmcgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2xvZ2dpbmcucXVlcnlMb2dnaW5nXG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudCgpICE9PSBcInRlc3RcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGdlbmVyYXRpb24gbGlmZWN5Y2xlIHZhbHVlcyBmcm9tIHRoZWlyIHJhdyBjb25maWcsIGVudmlyb25tZW50LFxuICAgKiBhbmQgQVBJIHNvdXJjZXMgYmVmb3JlIGFwcGx5aW5nIGRlZmF1bHRzLiBEZXJpdmVkIGRlZmF1bHRzIGFyZSBkZWxpYmVyYXRlbHlcbiAgICogYWJzZW50IGZyb20gdGhlIHNvdXJjZSBsaXN0LCBzbyBhbiBBUEkgcmVjb3Zlcnkgc3RhdGUgY2FuIG92ZXJyaWRlIGFuXG4gICAqIElELW9ubHkgY29uZmlndXJhdGlvbiB3aXRob3V0IGNyZWF0aW5nIGEgZmFsc2UgY29uZmxpY3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBFeHBsaWNpdCBBUEkgdmFsdWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlfSBbYXJncy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXSAtIEV4cGxpY2l0IGJvb3Qgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5saWZlY3ljbGVTb2NrZXRQYXRoXSAtIEV4cGxpY2l0IGxpZmVjeWNsZSBzb2NrZXQgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvdXJjZU5hbWVdIC0gSHVtYW4tcmVhZGFibGUgQVBJIG93bmVyLlxuICAgKiBAcmV0dXJucyB7e2dlbmVyYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgfCBcImFjdGl2ZVwiLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIFJlc29sdmVkIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgcmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7Z2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsIHNvdXJjZU5hbWUgPSBcImJhY2tncm91bmQgam9icyBBUElcIn0gPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLl9iYWNrZ3JvdW5kSm9icyB8fCB7fVxuICAgIGNvbnN0IGdlbmVyYXRpb25FbnZpcm9ubWVudCA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52IHx8IHt9XG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gcmVzb2x2ZUdlbmVyYXRpb25JZChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5nZW5lcmF0aW9uSWRcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImdlbmVyYXRpb25JZFwiKSAmJiBjb25maWd1cmVkLmdlbmVyYXRpb25JZCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5nZW5lcmF0aW9uSWR9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRFwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSUR9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGdlbmVyYXRpb25JZGAsIHByZXNlbnQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEdlbmVyYXRpb25JZH1cbiAgICBdKVxuICAgIGNvbnN0IGluaXRpYWxHZW5lcmF0aW9uU3RhdGUgPSByZXNvbHZlSW5pdGlhbEdlbmVyYXRpb25TdGF0ZShbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJpbml0aWFsR2VuZXJhdGlvblN0YXRlXCIpICYmIGNvbmZpZ3VyZWQuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5pbml0aWFsR2VuZXJhdGlvblN0YXRlfSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBpbml0aWFsR2VuZXJhdGlvblN0YXRlYCwgcHJlc2VudDogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGV9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuICAgIGNvbnN0IGxpZmVjeWNsZVNvY2tldFBhdGggPSByZXNvbHZlTGlmZWN5Y2xlU29ja2V0UGF0aChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5saWZlY3ljbGVTb2NrZXRQYXRoXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJsaWZlY3ljbGVTb2NrZXRQYXRoXCIpICYmIGNvbmZpZ3VyZWQubGlmZWN5Y2xlU29ja2V0UGF0aCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5saWZlY3ljbGVTb2NrZXRQYXRofSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBsaWZlY3ljbGVTb2NrZXRQYXRoYCwgcHJlc2VudDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGh9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuXG4gICAgcmV0dXJuIHtnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge09taXQ8UmVxdWlyZWQ8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbj4sIFwiYWRhcHRlclwiIHwgXCJyZXRlbnRpb25cIiB8IFwiZ2VuZXJhdGlvbklkXCIgfCBcImxpZmVjeWNsZVNvY2tldFBhdGhcIj4gJiB7Z2VuZXJhdGlvbklkPzogc3RyaW5nLCBsaWZlY3ljbGVTb2NrZXRQYXRoPzogc3RyaW5nLCByZXRlbnRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JzUmV0ZW50aW9uQ29uZmlndXJhdGlvbn19IC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBjb25zdCBwcm9jZXNzRW52aXJvbm1lbnQgPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudlxuICAgIGNvbnN0IGVudkhvc3QgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSE9TVFxuICAgIGNvbnN0IGVudlBvcnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVFxuICAgIGNvbnN0IGVudkRhdGFiYXNlSWRlbnRpZmllciA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19EQVRBQkFTRV9JREVOVElGSUVSXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19NQVhfQ09OQ1VSUkVOVF9GT1JLRURfSk9CU1xuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTUFYX0NPTkNVUlJFTlRfSU5MSU5FX0pPQlNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX0NPVU5UXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3lSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9DT05DVVJSRU5DWVxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfSk9CU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX1JTU19CWVRFU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfTElGRVRJTUVfTVNcbiAgICBjb25zdCBlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYlJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19SVU5ORVJfTUFYX09MRF9TUEFDRV9TSVpFX01CXG4gICAgY29uc3QgZW52UnVubmVyTWFsbG9jQXJlbmFNYXhSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUlVOTkVSX01BTExPQ19BUkVOQV9NQVhcbiAgICBjb25zdCBlbnZEaXNwYXRjaFN0cmF0ZWd5ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0RJU1BBVENIX1NUUkFURUdZXG4gICAgY29uc3QgZW52UG9sbEludGVydmFsUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPTExfSU5URVJWQUxfTVNcbiAgICBjb25zdCBlbnZKb2JUaW1lb3V0UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0pPQl9USU1FT1VUX01TXG4gICAgY29uc3QgZW52UG9ydCA9IGVudlBvcnRSYXcgPyBOdW1iZXIoZW52UG9ydFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID0gZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA/IE51bWJlcihlbnZNYXhDb25jdXJyZW50Rm9ya2VkUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnQgPSBlbnZNYXhDb25jdXJyZW50UmF3ID8gTnVtYmVyKGVudk1heENvbmN1cnJlbnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ291bnQgPSBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJDb3VudFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPSBlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID0gZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWJSYXcgPyBOdW1iZXIoZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWJSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UnVubmVyTWFsbG9jQXJlbmFNYXggPSBlbnZSdW5uZXJNYWxsb2NBcmVuYU1heFJhdyA/IE51bWJlcihlbnZSdW5uZXJNYWxsb2NBcmVuYU1heFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb2xsSW50ZXJ2YWwgPSBlbnZQb2xsSW50ZXJ2YWxSYXcgPyBOdW1iZXIoZW52UG9sbEludGVydmFsUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudkpvYlRpbWVvdXQgPSBlbnZKb2JUaW1lb3V0UmF3ID8gTnVtYmVyKGVudkpvYlRpbWVvdXRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JhY2tncm91bmRKb2JzIHx8IHt9XG4gICAgY29uc3Qge2dlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aH0gPSB0aGlzLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoKVxuICAgIGNvbnN0IG1vZGUgPSBjb25maWd1cmVkLm1vZGUgPT09IHVuZGVmaW5lZCA/IFwiYmFja2dyb3VuZFwiIDogY29uZmlndXJlZC5tb2RlXG5cbiAgICBpZiAobW9kZSAhPT0gXCJiYWNrZ3JvdW5kXCIgJiYgbW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgYmFja2dyb3VuZEpvYnMubW9kZSBtdXN0IGJlIFwiYmFja2dyb3VuZFwiIG9yIFwiaW5saW5lXCIsIGdvdDogJHtTdHJpbmcobW9kZSl9YClcbiAgICB9XG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMxKVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IGNvbmZpZ3VyZWQuZGF0YWJhc2VJZGVudGlmaWVyIHx8IGVudkRhdGFiYXNlSWRlbnRpZmllciB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICAgIDogKHR5cGVvZiBlbnZNYXhDb25jdXJyZW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZNYXhDb25jdXJyZW50KSAmJiBlbnZNYXhDb25jdXJyZW50ID49IDEgPyBlbnZNYXhDb25jdXJyZW50IDogNClcbiAgICBjb25zdCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IHR5cGVvZiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgICA6ICh0eXBlb2YgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52TWF4Q29uY3VycmVudEZvcmtlZCkgJiYgZW52TWF4Q29uY3VycmVudEZvcmtlZCA+PSAxID8gZW52TWF4Q29uY3VycmVudEZvcmtlZCA6IDQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyQ291bnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50KSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50ID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudFxuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lckNvdW50XCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lckNvdW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgZW52UG9vbGVkUnVubmVyQ291bnQgPj0gMSA/IGVudlBvb2xlZFJ1bm5lckNvdW50IDogNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyQ29uY3VycmVuY3lcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+PSAxID8gZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgOiAxKVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heEpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhKb2JzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyTWF4Sm9icykgJiYgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4Sm9icyA6IDEwMClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcykgJiYgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzIDogNTEyICogMTAyNCAqIDEwMjQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIDogNjAgKiA2MCAqIDEwMDApXG4gICAgLy8gUnVubmVyIGNoaWxkcmVuIGdldCBhIGhhcmQgVjggaGVhcCBjYXAgYW5kIGEgYm91bmRlZCBnbGliYyBhcmVuYSBjb3VudFxuICAgIC8vIHNvIG9uZSBjaGlsZCBjYW4gbmV2ZXIgY29tbWl0IG11bHRpcGxlIEdCcyBvZiBoZWFwIG9yIHVuYm91bmRlZFxuICAgIC8vIGFsbG9jYXRvciBhcmVuYXMuIFRoZSBjYXAgc3RheXMgZmFyIGFib3ZlIG9ic2VydmVkIHJ1bm5lciB1c2FnZTsgYW5cbiAgICAvLyBpbmhlcml0ZWQgTUFMTE9DX0FSRU5BX01BWCBpcyBob25vcmVkIGJlZm9yZSB0aGUgYnVpbHQtaW4gZGVmYXVsdC5cbiAgICBjb25zdCBydW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9IHR5cGVvZiBjb25maWd1cmVkLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iKSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucnVubmVyTWF4T2xkU3BhY2VTaXplTWIpICYmIGNvbmZpZ3VyZWQucnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPj0gNjRcbiAgICAgID8gY29uZmlndXJlZC5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYlxuICAgICAgOiAoIShcInJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYikgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYikgJiYgZW52UnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPj0gNjQgPyBlbnZSdW5uZXJNYXhPbGRTcGFjZVNpemVNYiA6IDIwNDgpXG4gICAgY29uc3QgaW5oZXJpdGVkTWFsbG9jQXJlbmFNYXggPSBwcm9jZXNzRW52aXJvbm1lbnQ/Lk1BTExPQ19BUkVOQV9NQVggPyBOdW1iZXIocHJvY2Vzc0Vudmlyb25tZW50Lk1BTExPQ19BUkVOQV9NQVgpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgcnVubmVyTWFsbG9jQXJlbmFNYXggPSB0eXBlb2YgY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heCkgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnJ1bm5lck1hbGxvY0FyZW5hTWF4KSAmJiBjb25maWd1cmVkLnJ1bm5lck1hbGxvY0FyZW5hTWF4ID49IDFcbiAgICAgID8gY29uZmlndXJlZC5ydW5uZXJNYWxsb2NBcmVuYU1heFxuICAgICAgOiAoIShcInJ1bm5lck1hbGxvY0FyZW5hTWF4XCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZSdW5uZXJNYWxsb2NBcmVuYU1heCkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZSdW5uZXJNYWxsb2NBcmVuYU1heCkgJiYgZW52UnVubmVyTWFsbG9jQXJlbmFNYXggPj0gMVxuICAgICAgICA/IGVudlJ1bm5lck1hbGxvY0FyZW5hTWF4XG4gICAgICAgIDogKHR5cGVvZiBpbmhlcml0ZWRNYWxsb2NBcmVuYU1heCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKGluaGVyaXRlZE1hbGxvY0FyZW5hTWF4KSAmJiBpbmhlcml0ZWRNYWxsb2NBcmVuYU1heCA+PSAxID8gaW5oZXJpdGVkTWFsbG9jQXJlbmFNYXggOiA0KSlcbiAgICBjb25zdCBkaXNwYXRjaFN0cmF0ZWd5UmF3ID0gY29uZmlndXJlZC5kaXNwYXRjaFN0cmF0ZWd5IHx8IGVudkRpc3BhdGNoU3RyYXRlZ3lcbiAgICBjb25zdCBkaXNwYXRjaFN0cmF0ZWd5ID0gZGlzcGF0Y2hTdHJhdGVneVJhdyA9PT0gXCJwb2xsaW5nXCIgPyBcInBvbGxpbmdcIiA6IFwiYmVhY29uXCJcbiAgICBjb25zdCBwb2xsSW50ZXJ2YWxNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQucG9sbEludGVydmFsTXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zXG4gICAgICA6ICh0eXBlb2YgZW52UG9sbEludGVydmFsID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb2xsSW50ZXJ2YWwpICYmIGVudlBvbGxJbnRlcnZhbCA+PSAxID8gZW52UG9sbEludGVydmFsIDogMTAwMClcbiAgICBjb25zdCBkcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zID0gdHlwZW9mIGNvbmZpZ3VyZWQuZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLmRyYWluU3RvcmVPcGVyYXRpb25UaW1lb3V0TXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLmRyYWluU3RvcmVPcGVyYXRpb25UaW1lb3V0TXNcbiAgICAgIDogNjBfMDAwXG4gICAgLy8gYG51bGxgIGlzIGFuIGV4cGxpY2l0IG9wdC1vdXQgb2YgdGhlIHNjaGVkdWxlZC1lbnF1ZXVlIGJvdW5kLiBBIHByZXNlbnRcbiAgICAvLyBidXQgbm9uLXBvc2l0aXZlIG51bWJlciBpcyBhIG1pc3Rha2UsIG5vdCBhbiBvcHQtb3V0LCBzbyBpdCBmYWxscyBiYWNrIHRvXG4gICAgLy8gdGhlIGZyYW1ld29yayBkZWZhdWx0IHJhdGhlciB0aGFuIHNpbGVudGx5IGRpc2FibGluZyB0aGUgd2F0Y2hkb2cuXG4gICAgY29uc3Qgc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNcyA9IFwic2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNc1wiIGluIGNvbmZpZ3VyZWRcbiAgICAgID8gKFxuICAgICAgICBjb25maWd1cmVkLnNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMgPT09IG51bGwgP1xuICAgICAgICAgIG51bGxcbiAgICAgICAgOiAoXG4gICAgICAgICAgdHlwZW9mIGNvbmZpZ3VyZWQuc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLnNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMgPiAwID9cbiAgICAgICAgICAgIGNvbmZpZ3VyZWQuc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNc1xuICAgICAgICAgIDogREVGQVVMVF9TQ0hFRFVMRURfRU5RVUVVRV9USU1FT1VUX01TXG4gICAgICAgIClcbiAgICAgIClcbiAgICAgIDogREVGQVVMVF9TQ0hFRFVMRURfRU5RVUVVRV9USU1FT1VUX01TXG4gICAgY29uc3QgcXVldWVzID0gY29uZmlndXJlZC5xdWV1ZXMgJiYgdHlwZW9mIGNvbmZpZ3VyZWQucXVldWVzID09PSBcIm9iamVjdFwiID8gY29uZmlndXJlZC5xdWV1ZXMgOiB7fVxuICAgIC8vIEFuIGV4cGxpY2l0IGNvbmZpZyB2YWx1ZSB3aW5zIG92ZXIgdGhlIGVudiB2YXIg4oCUIGluY2x1ZGluZyBgbnVsbGAvYDBgLFxuICAgIC8vIHdoaWNoIGRpc2FibGUgdGhlIGJhY2tzdG9wIGV2ZW4gd2hlbiB0aGUgZW52aXJvbm1lbnQgc2V0cyBhIGRlZmF1bHQuXG4gICAgLy8gT25seSBmYWxsIHRocm91Z2ggdG8gdGhlIGVudiB2YXIgd2hlbiBjb25maWcgb21pdHMgYGpvYlRpbWVvdXRNc2AgZW50aXJlbHkuXG4gICAgY29uc3Qgam9iVGltZW91dE1zID0gXCJqb2JUaW1lb3V0TXNcIiBpbiBjb25maWd1cmVkXG4gICAgICA/ICh0eXBlb2YgY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgPiAwID8gY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgOiBudWxsKVxuICAgICAgOiAodHlwZW9mIGVudkpvYlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudkpvYlRpbWVvdXQpICYmIGVudkpvYlRpbWVvdXQgPiAwID8gZW52Sm9iVGltZW91dCA6IG51bGwpXG4gICAgY29uc3QgY29uZmlndXJlZFJldGVudGlvbiA9IGNvbmZpZ3VyZWQucmV0ZW50aW9uICYmIHR5cGVvZiBjb25maWd1cmVkLnJldGVudGlvbiA9PT0gXCJvYmplY3RcIiA/IGNvbmZpZ3VyZWQucmV0ZW50aW9uIDoge31cbiAgICBjb25zdCByZXRlbnRpb24gPSB7XG4gICAgICBjb21wbGV0ZWRUdGxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXMgPT09IFwibnVtYmVyXCIgfHwgY29uZmlndXJlZFJldGVudGlvbi5jb21wbGV0ZWRUdGxNcyA9PT0gbnVsbFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXNcbiAgICAgICAgOiA3ICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgICAgIGZhaWxlZFR0bE1zOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNcyA9PT0gXCJudW1iZXJcIiB8fCBjb25maWd1cmVkUmV0ZW50aW9uLmZhaWxlZFR0bE1zID09PSBudWxsXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNc1xuICAgICAgICA6IDMwICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgICAgIGJhdGNoU2l6ZTogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplID4gMFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplXG4gICAgICAgIDogMTAwMCxcbiAgICAgIHN3ZWVwSW50ZXJ2YWxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zID4gMFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zXG4gICAgICAgIDogNjAgKiA2MCAqIDEwMDBcbiAgICB9XG5cbiAgICBjb25zdCBqb2JDbGFzc2VzID0gdGhpcy5nZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpXG5cbiAgICByZXR1cm4ge2hvc3QsIHBvcnQsIGRhdGFiYXNlSWRlbnRpZmllciwgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMsIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzLCBtb2RlLCBwb29sZWRSdW5uZXJDb3VudCwgcG9vbGVkUnVubmVyQ29uY3VycmVuY3ksIHBvb2xlZFJ1bm5lck1heEpvYnMsIHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzLCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zLCBydW5uZXJNYXhPbGRTcGFjZVNpemVNYiwgcnVubmVyTWFsbG9jQXJlbmFNYXgsIGRpc3BhdGNoU3RyYXRlZ3ksIHBvbGxJbnRlcnZhbE1zLCBkcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zLCBzY2hlZHVsZWRFbnF1ZXVlVGltZW91dE1zLCBxdWV1ZXMsIGpvYkNsYXNzZXMsIGpvYlRpbWVvdXRNcywgcmV0ZW50aW9uLCBnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBzdGF0aWNhbGx5IHJlZ2lzdGVyZWQgcG9ydGFibGUgYmFja2dyb3VuZCBqb2JzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDbGFzc1tdfSAtIENvbmZpZ3VyZWQgam9iIGNsYXNzZXMuXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpIHtcbiAgICBjb25zdCBqb2JDbGFzc2VzID0gdGhpcy5fYmFja2dyb3VuZEpvYnM/LmpvYkNsYXNzZXNcblxuICAgIGlmIChqb2JDbGFzc2VzID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICAgIGlmICghQXJyYXkuaXNBcnJheShqb2JDbGFzc2VzKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmpvYkNsYXNzZXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuXG4gICAgcmV0dXJuIFsuLi5qb2JDbGFzc2VzXVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuZCBtZW1vaXplcyBvbmUgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXIgZm9yIHRoaXMgY29uZmlndXJhdGlvbiBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJ9IC0gQWN0aXZlIGFkYXB0ZXIuXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24pIHJldHVybiB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uLmFkYXB0ZXJcblxuICAgIGNvbnN0IGNvbmZpZ3VyZWRBZGFwdGVyID0gdGhpcy5fYmFja2dyb3VuZEpvYnM/LmFkYXB0ZXJcbiAgICBjb25zdCBhZGFwdGVyID0gdHlwZW9mIGNvbmZpZ3VyZWRBZGFwdGVyID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gY29uZmlndXJlZEFkYXB0ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgOiAoY29uZmlndXJlZEFkYXB0ZXIgfHwgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5jcmVhdGVCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXN9KSlcblxuICAgIGlmICghKGFkYXB0ZXIgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiYmFja2dyb3VuZEpvYnMuYWRhcHRlciBtdXN0IGJlIGEgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGluc3RhbmNlIG9yIGEgc3luY2hyb25vdXMgZmFjdG9yeSByZXR1cm5pbmcgb25lXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHtcbiAgICAgIGFkYXB0ZXIsXG4gICAgICBjbG9zaW5nOiBmYWxzZSxcbiAgICAgIGNsb3NlUHJvbWlzZTogdW5kZWZpbmVkLFxuICAgICAgcmVhZHlQcm9taXNlOiB1bmRlZmluZWRcbiAgICB9XG4gICAgcmV0dXJuIGFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IGFjcXVpcmVzIHRoZSBleGFjdCByZWFkeSBhZGFwdGVyIGZvciB0aGUgYWN0aXZlIGxpZmVjeWNsZS5cbiAgICogQSBjbG9zZSB0aGF0IGNsYWltcyB0aGUgZ2VuZXJhdGlvbiB3aGlsZSByZWFkaW5lc3MgaXMgcGVuZGluZyB3aW5zOiB0aGlzXG4gICAqIG9wZXJhdGlvbiB3YWl0cyBmb3IgdGhhdCBjbG9zZSwgY3JlYXRlcyB0aGUgbmV4dCBnZW5lcmF0aW9uLCByZWFkaWVzIGl0LFxuICAgKiBhbmQgcmV0dXJucyBvbmx5IHRoYXQgbGl2ZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYnNBZGFwdGVyPn0gLSBFeGFjdCByZWFkeSBhZGFwdGVyIGdlbmVyYXRpb24uXG4gICAqL1xuICBhc3luYyBhY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IGRhdGFiYXNlQ2xvc2VQcm9taXNlID0gdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuXG4gICAgICBpZiAoZGF0YWJhc2VDbG9zZVByb21pc2UpIHtcbiAgICAgICAgYXdhaXQgZGF0YWJhc2VDbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhpcy5nZXRCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cblxuICAgICAgaWYgKCFnZW5lcmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBnZW5lcmF0aW9uIHdhcyBub3QgY3JlYXRlZFwiKVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zaW5nKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgfHwgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGdlbmVyYXRpb24uYWRhcHRlci5lbnN1cmVSZWFkeSgpXG4gICAgICB9KVxuXG4gICAgICBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9IHJlYWR5UHJvbWlzZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZWFkeVByb21pc2VcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zaW5nKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gIT09IGdlbmVyYXRpb24pIGNvbnRpbnVlXG5cbiAgICAgIHJldHVybiBnZW5lcmF0aW9uLmFkYXB0ZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVhZGllcyB0aGUgYWN0aXZlIGFkYXB0ZXIgb25jZSBwZXIgbGlmZWN5Y2xlLiBBIGZhaWxlZCBhdHRlbXB0IHJlbWFpbnMgcmV0cnlhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQmFja2dyb3VuZEpvYnNBZGFwdGVyUmVhZHkoKSB7XG4gICAgYXdhaXQgdGhpcy5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgaGVhbHRoIHdpdGhvdXQgcmVzb2x2aW5nIHBlcnNpc3RlbmNlIGluIG5vbi1kdXJhYmxlIGlubGluZSBtb2RlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0hlYWx0aD59IC0gQ3VycmVudCBoZWFsdGguXG4gICAqL1xuICBhc3luYyBiYWNrZ3JvdW5kSm9ic0hlYWx0aCgpIHtcbiAgICBpZiAodGhpcy5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLm1vZGUgPT09IFwiaW5saW5lXCIpIHJldHVybiB7cmVhZHk6IHRydWV9XG5cbiAgICBjb25zdCBhZGFwdGVyID0gYXdhaXQgdGhpcy5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFkYXB0ZXIuaGVhbHRoKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgdGhlIHJlc29sdmVkIGFkYXB0ZXIgb25jZSBhbmQgY2xlYXJzIGxpZmVjeWNsZSBjYWNoZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNsb3NlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cblxuICAgIGlmICghZ2VuZXJhdGlvbikgcmV0dXJuXG4gICAgaWYgKGdlbmVyYXRpb24uY2xvc2VQcm9taXNlKSByZXR1cm4gYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcblxuICAgIGdlbmVyYXRpb24uY2xvc2luZyA9IHRydWVcbiAgICBjb25zdCBjbG9zZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgICAgY29uc3QgY2xvc2VFcnJvcnMgPSBbXVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGdlbmVyYXRpb24uYWRhcHRlci5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cblxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgY2xvc2VFcnJvcnNbMF1cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoY2xvc2VFcnJvcnMsIFwiRmFpbGVkIHRvIHJlYWR5IGFuZCBjbG9zZSB0aGUgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXJcIilcbiAgICB9KSgpXG5cbiAgICBnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSA9IGNsb3NlUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsb3NlUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9PT0gZ2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbn0gYmFja2dyb3VuZEpvYnMgLSBCYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEJhY2tncm91bmRKb2JzQ29uZmlnKGJhY2tncm91bmRKb2JzKSB7XG4gICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gJiYgYmFja2dyb3VuZEpvYnMuYWRhcHRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVwbGFjZSBiYWNrZ3JvdW5kSm9icy5hZGFwdGVyIGR1cmluZyBhbiBhY3RpdmUgYWRhcHRlciBsaWZlY3ljbGU7IGNsb3NlIGl0IGZpcnN0XCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iYWNrZ3JvdW5kSm9icywgYmFja2dyb3VuZEpvYnMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGFjdGl2ZSBCZWFjb24gY29uZmlndXJhdGlvbi4gQmVhY29uIGlzIG9wdC1pbjogaXRcbiAgICogc3RheXMgZGlzYWJsZWQgdW5sZXNzIHRoZSBhcHAgcGFzc2VzIGBiZWFjb246IHtob3N0LCBwb3J0fWAgL1xuICAgKiBgYmVhY29uOiB7aW5Qcm9jZXNzOiB0cnVlfWAsIGNhbGxzIGBzZXRCZWFjb25Db25maWcoey4uLn0pYCwgb3JcbiAgICogc2V0cyB0aGUgYFZFTE9DSU9VU19CRUFDT05fSE9TVGAgLyBgVkVMT0NJT1VTX0JFQUNPTl9QT1JUYCBlbnYgdmFycy5cbiAgICogU2V0dGluZyBgZW5hYmxlZDogZmFsc2VgIGV4cGxpY2l0bHkgZGlzYWJsZXMgaXQgZXZlbiB3aGVuIGVudiB2YXJzXG4gICAqIGFyZSBwcmVzZW50ICh1c2VmdWwgZm9yIHRlc3RzKS4gV2hlbiBgaW5Qcm9jZXNzOiB0cnVlYCBpcyBzZXQsXG4gICAqIGVudi12YXIgaG9zdC9wb3J0IGFyZSBpZ25vcmVkIOKAlCBjb2RlLWxldmVsIGNvbmZpZyB3aW5zLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIGhvc3Q6IHN0cmluZywgcG9ydDogbnVtYmVyLCBwZWVyVHlwZT86IHN0cmluZywgaW5Qcm9jZXNzOiBib29sZWFuLCB1bnJlYWNoYWJsZVJlcG9ydE1zOiBudW1iZXJ9fSAtIEJlYWNvbiBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdHMgYXBwbGllZC5cbiAgICovXG4gIGdldEJlYWNvbkNvbmZpZygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmVhY29uIHx8IHt9XG4gICAgY29uc3QgaW5Qcm9jZXNzID0gY29uZmlndXJlZC5pblByb2Nlc3MgPT09IHRydWVcblxuICAgIGlmIChpblByb2Nlc3MgJiYgKGNvbmZpZ3VyZWQuaG9zdCB8fCB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQmVhY29uIGNvbmZpZ3VyYXRpb246IGBpblByb2Nlc3M6IHRydWVgIGlzIG11dHVhbGx5IGV4Y2x1c2l2ZSB3aXRoIGBob3N0YC9gcG9ydGAuIFVzZSBvbmUgb3IgdGhlIG90aGVyLlwiKVxuICAgIH1cblxuICAgIGNvbnN0IGVudkhvc3QgPSBpblByb2Nlc3MgPyB1bmRlZmluZWQgOiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQkVBQ09OX0hPU1RcbiAgICBjb25zdCBlbnZQb3J0UmF3ID0gaW5Qcm9jZXNzID8gdW5kZWZpbmVkIDogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JFQUNPTl9QT1JUXG4gICAgY29uc3QgZW52UG9ydCA9IGVudlBvcnRSYXcgPyBOdW1iZXIoZW52UG9ydFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBob3N0ID0gY29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3QgfHwgXCIxMjcuMC4wLjFcIlxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGNvbmZpZ3VyZWQucG9ydFxuICAgICAgOiAodHlwZW9mIGVudlBvcnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvcnQpID8gZW52UG9ydCA6IDczMzApXG5cbiAgICBsZXQgZW5hYmxlZFxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkLmVuYWJsZWQgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICBlbmFibGVkID0gY29uZmlndXJlZC5lbmFibGVkXG4gICAgfSBlbHNlIHtcbiAgICAgIGVuYWJsZWQgPSBCb29sZWFuKGluUHJvY2VzcyB8fCBjb25maWd1cmVkLmhvc3QgfHwgY29uZmlndXJlZC5wb3J0IHx8IGVudkhvc3QgfHwgZW52UG9ydClcbiAgICB9XG5cbiAgICBjb25zdCB1bnJlYWNoYWJsZVJlcG9ydE1zID0gcmVzb2x2ZUJlYWNvblVucmVhY2hhYmxlUmVwb3J0TXMoY29uZmlndXJlZC51bnJlYWNoYWJsZVJlcG9ydE1zKVxuXG4gICAgcmV0dXJuIHtlbmFibGVkLCBob3N0LCBwb3J0LCBwZWVyVHlwZTogY29uZmlndXJlZC5wZWVyVHlwZSwgaW5Qcm9jZXNzLCB1bnJlYWNoYWJsZVJlcG9ydE1zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJlYWNvbiBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJlYWNvbkNvbmZpZ3VyYXRpb259IGJlYWNvbiAtIEJlYWNvbiBjb25maWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QmVhY29uQ29uZmlnKGJlYWNvbikge1xuICAgIHRoaXMuX2JlYWNvbiA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2JlYWNvbiwgYmVhY29uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJlYWNvbiBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIGFjdGl2ZSBCZWFjb24gY2xpZW50LCBpZiBjb25uZWN0ZWQuXG4gICAqL1xuICBnZXRCZWFjb25DbGllbnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2JlYWNvbkNsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRoaXMgY29uZmlndXJhdGlvbidzIEJlYWNvbiBjbGllbnQgdG8gdGhlIGNvbmZpZ3VyZWRcbiAgICogYnJva2VyLCB3aXJpbmcgaW5jb21pbmcgYnJvYWRjYXN0cyB0byB0aGUgbG9jYWwgZGVsaXZlcnkgcGF0aCBzb1xuICAgKiBhbnkgd2Vic29ja2V0IHN1YnNjcmliZXJzIGluIHRoaXMgcHJvY2VzcyByZWNlaXZlIHRoZW0uIElkZW1wb3RlbnRcbiAgICog4oCUIHJlcGVhdCBjYWxscyByZXR1cm4gdGhlIHNhbWUgaW4tZmxpZ2h0IG9yIHJlc29sdmVkIHByb21pc2UuXG4gICAqXG4gICAqIFJldHVybnMgaW1tZWRpYXRlbHkgd2l0aCBgdW5kZWZpbmVkYCBpZiBCZWFjb24gaXMgbm90IGVuYWJsZWQuXG4gICAqXG4gICAqICoqTm9uLWJsb2NraW5nIGJ5IGRlc2lnbiAoVENQIG1vZGUpLioqIEZvciBicm9rZXItYmFja2VkIEJlYWNvbiwgdGhlXG4gICAqIHJldHVybmVkIHByb21pc2UgcmVzb2x2ZXMgYXMgc29vbiBhcyB0aGUgY2xpZW50IGlzIGNvbnN0cnVjdGVkIGFuZFxuICAgKiB0aGUgVENQIGNvbm5lY3QgaXMgbGF1bmNoZWQg4oCUIGl0IGRvZXMgKipub3QqKiB3YWl0IGZvciB0aGUgY29ubmVjdFxuICAgKiBoYW5kc2hha2UgdG8gY29tcGxldGUuIEEgYnJva2VyIHRoYXQgc2lsZW50bHkgZHJvcHMgU1lOc1xuICAgKiAoZmlyZXdhbGwvTkFDTCBEUk9QIHJ1bGVzKSB3b3VsZCBvdGhlcndpc2UgYmxvY2sgc3RhcnR1cCBvbiB0aGUgT1NcbiAgICogVENQIGNvbm5lY3QgdGltZW91dCAodGVucyBvZiBzZWNvbmRzKSwgd2hpY2ggY29udHJhZGljdHMgdGhlXG4gICAqIGRvY3VtZW50ZWQgXCJmYWxsIGJhY2sgdG8gbG9jYWwtb25seSBhbmQgcmVjb25uZWN0IGluIHRoZVxuICAgKiBiYWNrZ3JvdW5kXCIgY29udHJhY3QuIEluaXRpYWwtY29ubmVjdCBmYWlsdXJlcyBzdXJmYWNlXG4gICAqIGFzeW5jaHJvbm91c2x5IG9uIHRoZSBmcmFtZXdvcmstZXJyb3IgY2hhbm5lbCB2aWEgdGhlXG4gICAqIGBjb25uZWN0LWVycm9yYCBsaXN0ZW5lciByZWdpc3RlcmVkIGhlcmUuIENhbGxlcnMgdGhhdCBuZWVkIGFcbiAgICogZGV0ZXJtaW5pc3RpYyBwdWJsaXNoLXJlYWRpbmVzcyBib3VuZGFyeSBzaG91bGQgY2FsbFxuICAgKiBgZ2V0QmVhY29uQ2xpZW50KCk/LndhaXRGb3JSZWFkeSh7dGltZW91dE1zfSlgLlxuICAgKlxuICAgKiAqKkluLXByb2Nlc3MgbW9kZSoqIGF3YWl0cyBgY29ubmVjdCgpYCDigJQgdGhhdCBwYXRoIGlzIHN5bmNocm9ub3VzLFxuICAgKiBjYW5ub3QgZmFpbCwgYW5kIGdpdmVzIGNhbGxlcnMgcHJlZGljdGFibGUgcmVhZGluZXNzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnBlZXJUeXBlXSAtIE92ZXJyaWRlIHBlZXJUeXBlIGZvciB0aGlzIGNvbm5lY3QgY2FsbCAoZS5nLiBgXCJzZXJ2ZXJcImAsIGBcImJhY2tncm91bmQtam9icy13b3JrZXJcImApLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlZ2lzdGVyZWQgY2xpZW50IChUQ1AgbW9kZTogY29ubmVjdCBtYXkgc3RpbGwgYmUgaW4gZmxpZ2h0KSwgb3IgdW5kZWZpbmVkIHdoZW4gQmVhY29uIGlzIGRpc2FibGVkLlxuICAgKi9cbiAgYXN5bmMgY29ubmVjdEJlYWNvbih7cGVlclR5cGV9ID0ge30pIHtcbiAgICBpZiAodGhpcy5fYmVhY29uQ2xpZW50KSByZXR1cm4gdGhpcy5fYmVhY29uQ2xpZW50XG4gICAgaWYgKHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2VcblxuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QmVhY29uQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNsaWVudCA9IGF3YWl0IHRoaXMuX2NyZWF0ZUJlYWNvbkNsaWVudCh7XG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgcGVlclR5cGU6IHBlZXJUeXBlIHx8IGNvbmZpZy5wZWVyVHlwZVxuICAgICAgfSlcblxuICAgICAgY2xpZW50Lm9uQnJvYWRjYXN0KChtZXNzYWdlKSA9PiB7XG4gICAgICAgIC8vIFN5bmFwc2Utc3R5bGUgZmFuLW91dDogZGVsaXZlciBldmVyeSBicm9hZGNhc3Qgd2UgcmVjZWl2ZVxuICAgICAgICAvLyBmcm9tIHRoZSBidXMgdGhyb3VnaCB0aGUgbG9jYWwgZGVsaXZlcnkgcGF0aC4gRWNob2VzIG9mIG91clxuICAgICAgICAvLyBvd24gcHVibGlzaGVzIGZvbGxvdyB0aGUgc2FtZSBwYXRoIHNvIGV2ZXJ5IHBlZXIgc2VlcyB0aGVcbiAgICAgICAgLy8gc2FtZSBkZWxpdmVyeSBzZW1hbnRpY3MuXG4gICAgICAgIHRoaXMuX2RlbGl2ZXJCcm9hZGNhc3RGcm9tQmVhY29uKG1lc3NhZ2UpXG4gICAgICB9KVxuXG4gICAgICAvLyBCZWFjb24gY29ubmVjdC9kaXNjb25uZWN0IGJsaXBzIGFyZSBleHBlY3RlZCBkdXJpbmcgZGVwbG95cyAodGhlIGJyb2tlclxuICAgICAgLy8gcmVzdGFydHMpIGFuZCB0aGUgQmVhY29uQ2xpZW50IGF1dG8tcmVjb25uZWN0cyBpbiB0aGUgYmFja2dyb3VuZCwgc28gYVxuICAgICAgLy8gc2luZ2xlIHRyYW5zaWVudCBmYWlsdXJlIGlzIE5PVCByZXBvcnRlZC4gT25seSBhIHN1c3RhaW5lZCBvdXRhZ2UgKHN0aWxsXG4gICAgICAvLyBkb3duIGFmdGVyIGB1bnJlYWNoYWJsZVJlcG9ydE1zYCkgaXMgc3VyZmFjZWQgb24gdGhlIGZyYW1ld29yay1lcnJvclxuICAgICAgLy8gY2hhbm5lbDsgYSAocmUpY29ubmVjdCB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyBjbGVhcnMgaXQgc2lsZW50bHkuXG5cbiAgICAgIC8vIGBjb25uZWN0LWVycm9yYCBmaXJlcyB3aGVuIHRoZSAqaW5pdGlhbCogVENQL2hhbmRzaGFrZSBmYWlscy5cbiAgICAgIGNsaWVudC5vbihcImNvbm5lY3QtZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlOiBcImJlYWNvbi1jb25uZWN0XCIsIGVycm9yLCByZXBvcnRBZnRlck1zOiBjb25maWcudW5yZWFjaGFibGVSZXBvcnRNc30pXG4gICAgICB9KVxuXG4gICAgICAvLyBgZGlzY29ubmVjdGAgZmlyZXMgd2hlbiBhbiBlc3RhYmxpc2hlZCBjb25uZWN0aW9uIGRyb3BzLiBUaGUgcGF5bG9hZCBpc1xuICAgICAgLy8gdGhlIHVuZGVybHlpbmcgc29ja2V0IGVycm9yIGlmIHRoZXJlIHdhcyBvbmUsIG9yIGEgc3ludGhldGljXG4gICAgICAvLyBFcnJvcihcIkJlYWNvbiBicm9rZXIgZGlzY29ubmVjdGVkXCIpIG90aGVyd2lzZS5cbiAgICAgIGNsaWVudC5vbihcImRpc2Nvbm5lY3RcIiwgKHJlYXNvbikgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZTogXCJiZWFjb24tZGlzY29ubmVjdFwiLCBlcnJvcjogcmVhc29uLCByZXBvcnRBZnRlck1zOiBjb25maWcudW5yZWFjaGFibGVSZXBvcnRNc30pXG4gICAgICB9KVxuXG4gICAgICAvLyBgY29ubmVjdGAgZmlyZXMgb24gZXZlcnkgKHJlKWNvbm5lY3Q7IGNsZWFyIGFueSBwZW5kaW5nIG91dGFnZSBzdGF0ZSBzb1xuICAgICAgLy8gYSB0cmFuc2llbnQgYmxpcCB0aGF0IHJlY292ZXJzIHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93IHN0YXlzIHNpbGVudC5cbiAgICAgIGNsaWVudC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25VcCgpXG4gICAgICB9KVxuXG4gICAgICAvLyBSZWdpc3RlciB0aGUgY2xpZW50ICpiZWZvcmUqIGtpY2tpbmcgb2ZmIGNvbm5lY3Qgc28gc3Vic2VxdWVudFxuICAgICAgLy8gYGNvbm5lY3RCZWFjb24oKWAgY2FsbHMgcmV0dXJuIHRoaXMgc2FtZSBpbnN0YW5jZSBpbnN0ZWFkIG9mXG4gICAgICAvLyByYWNpbmcgdG8gY29uc3RydWN0IGEgc2Vjb25kIG9uZS5cbiAgICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IGNsaWVudFxuXG4gICAgICBpZiAoY29uZmlnLmluUHJvY2Vzcykge1xuICAgICAgICAvLyBJbi1wcm9jZXNzIGNvbm5lY3QgaXMgc3luY2hyb25vdXMsIGNhbm5vdCBmYWlsLCBhbmQgcmVzb2x2ZXNcbiAgICAgICAgLy8gYmVmb3JlIHRoaXMgYXdhaXQgeWllbGRzIOKAlCBjYWxsZXJzIGNhbiByZWx5IG9uXG4gICAgICAgIC8vIGBpc0Nvbm5lY3RlZCgpID09PSB0cnVlYCBpbW1lZGlhdGVseSBhZnRlciBgY29ubmVjdEJlYWNvbigpYC5cbiAgICAgICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRmlyZS1hbmQtZm9yZ2V0IHRoZSBUQ1AgY29ubmVjdC4gQXdhaXRpbmcgaGVyZSB3b3VsZCBibG9ja1xuICAgICAgICAvLyBzdGFydHVwIG9uIHRoZSBPUyBUQ1AgY29ubmVjdCB0aW1lb3V0ICg3NXMgZGVmYXVsdCBvbiBMaW51eClcbiAgICAgICAgLy8gd2hlbiB0aGUgYnJva2VyIHNpbGVudGx5IGRyb3BzIFNZTnMuIEZhaWx1cmVzIHN1cmZhY2VcbiAgICAgICAgLy8gYXN5bmNocm9ub3VzbHkgdmlhIHRoZSBgY29ubmVjdC1lcnJvcmAgbGlzdGVuZXIgcmVnaXN0ZXJlZFxuICAgICAgICAvLyBhYm92ZTsgdGhlIEJlYWNvbkNsaWVudCdzIHJlY29ubmVjdCBsb29wIGtlZXBzIHRyeWluZy5cbiAgICAgICAgdm9pZCBjbGllbnQuY29ubmVjdCgpLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBBbHJlYWR5IHJlcG9ydGVkIHZpYSBjb25uZWN0LWVycm9yIGFib3ZlLlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2xpZW50XG4gICAgfSkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgQmVhY29uIGNsaWVudCBtYXRjaGluZyB0aGUgY29uZmlndXJlZCBtb2RlLiBTcGxpdCBvdXQgc29cbiAgICogYGNvbm5lY3RCZWFjb25gIHN0YXlzIGZvY3VzZWQgb24gbGlmZWN5Y2xlIGFuZCBlcnJvciB3aXJpbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPFZlbG9jaW91c0NvbmZpZ3VyYXRpb25bXCJnZXRCZWFjb25Db25maWdcIl0+fSBhcmdzLmNvbmZpZyAtIFJlc29sdmVkIEJlYWNvbiBjb25maWcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBSZXNvbHZlZCBwZWVyIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdD59IC0gQmVhY29uIGNsaWVudC5cbiAgICovXG4gIGFzeW5jIF9jcmVhdGVCZWFjb25DbGllbnQoe2NvbmZpZywgcGVlclR5cGV9KSB7XG4gICAgLy8gUm91dGUgdGhyb3VnaCB0aGUgZW52aXJvbm1lbnQgaGFuZGxlciBzbyB0aGUgTm9kZS1vbmx5IGBub2RlOm5ldGBcbiAgICAvLyAvIGBub2RlOmNyeXB0b2AgZGVwcyBpbiB0aGUgQmVhY29uIGNsaWVudCBtb2R1bGVzIGRvbid0IGdldCBwdWxsZWRcbiAgICAvLyBpbnRvIGJyb3dzZXIgYnVuZGxlcy4gQnJvd3NlciBidW5kbGVzIHN0YXRpY2FsbHkgcmVhY2hcbiAgICAvLyBgQ29uZmlndXJhdGlvbmAgKHZpYSBgTG9nZ2VyYCk7IHB1dHRpbmcgdGhlIGR5bmFtaWNcbiAgICAvLyBgaW1wb3J0KFwiLi9iZWFjb24vLi4uXCIpYCBjYWxscyBoZXJlIHdvdWxkIHN0aWxsIGRyYWcgdGhvc2UgbW9kdWxlc1xuICAgIC8vIHRocm91Z2ggZXNidWlsZCdzIHN0YXRpYyBhbmFseXNpcy4gSGlkaW5nIHRoZSBpbXBvcnRzIGluc2lkZSB0aGVcbiAgICAvLyBOb2RlIGVudmlyb25tZW50IGhhbmRsZXIga2VlcHMgdGhlbSBvZmYgdGhlIGJyb3dzZXIgcGF0aCDigJRcbiAgICAvLyBicm93c2VyLWJ1bmRsZWQgYXBwcyBuZXZlciByZWFjaCBgZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS5qc2AuXG4gICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmIChjb25maWcuaW5Qcm9jZXNzKSB7XG4gICAgICBjb25zdCBJblByb2Nlc3NCZWFjb25DbGllbnQgPSBhd2FpdCBoYW5kbGVyLmxvYWRJblByb2Nlc3NCZWFjb25DbGllbnQoKVxuXG4gICAgICByZXR1cm4gbmV3IEluUHJvY2Vzc0JlYWNvbkNsaWVudCh7cGVlclR5cGV9KVxuICAgIH1cblxuICAgIGNvbnN0IEJlYWNvbkNsaWVudCA9IGF3YWl0IGhhbmRsZXIubG9hZEJlYWNvbkNsaWVudCgpXG5cbiAgICByZXR1cm4gbmV3IEJlYWNvbkNsaWVudCh7XG4gICAgICBob3N0OiBjb25maWcuaG9zdCxcbiAgICAgIHBvcnQ6IGNvbmZpZy5wb3J0LFxuICAgICAgcGVlclR5cGVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBCZWFjb24gY29ubmVjdC9kaXNjb25uZWN0IGZhaWx1cmUgd2l0aG91dCByZXBvcnRpbmcgaXQgaW1tZWRpYXRlbHkuXG4gICAqIFRoZSBCZWFjb25DbGllbnQgYXV0by1yZWNvbm5lY3RzLCBzbyBicmllZiBvdXRhZ2VzIChlLmcuIGEgZGVwbG95IHJlc3RhcnRpbmdcbiAgICogdGhlIGJyb2tlcikgYXJlIGV4cGVjdGVkOyBvbmx5IGlmIHRoZSBiZWFjb24gaXMgc3RpbGwgdW5yZWFjaGFibGUgYWZ0ZXJcbiAgICogYHJlcG9ydEFmdGVyTXNgIGlzIGEgc2luZ2xlIGZyYW1ld29yay1lcnJvciBzdXJmYWNlZCB2aWEgYF9yZXBvcnRCZWFjb25FcnJvcmAuXG4gICAqIEEgc3Vic2VxdWVudCBgY29ubmVjdGAgKHNlZSBgX2hhbmRsZUJlYWNvblVwYCkgY2FuY2VscyB0aGUgcGVuZGluZyByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCJ9IGFyZ3Muc3RhZ2UgLSBGYWlsdXJlIHN0YWdlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnJlcG9ydEFmdGVyTXMgLSBHcmFjZSB3aW5kb3cgYmVmb3JlIGEgc3VzdGFpbmVkIG91dGFnZSBpcyByZXBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQmVhY29uRG93bih7c3RhZ2UsIGVycm9yLCByZXBvcnRBZnRlck1zfSkge1xuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB7c3RhZ2UsIGVycm9yfVxuXG4gICAgLy8gQSByZXBvcnQgaXMgYWxyZWFkeSBwZW5kaW5nIG9yIGFscmVhZHkgc2VudCBmb3IgdGhpcyBvdXRhZ2Ug4oCUIGtlZXAgdGhlXG4gICAgLy8gbGF0ZXN0IGVycm9yIGJ1dCBkb24ndCBzdGFjayB0aW1lcnMgb3IgcmUtcmVwb3J0LlxuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lciB8fCB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcblxuICAgICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudD8uaXNDb25uZWN0ZWQoKSkge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25VcCgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IHRydWVcblxuICAgICAgaWYgKHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IpIHRoaXMuX3JlcG9ydEJlYWNvbkVycm9yKHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IpXG4gICAgfSwgcmVwb3J0QWZ0ZXJNcylcblxuICAgIC8vIERvbid0IGxldCB0aGUgZ3JhY2UgdGltZXIga2VlcCB0aGUgcHJvY2VzcyBhbGl2ZS5cbiAgICBpZiAodHlwZW9mIHRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRpbWVyLnVucmVmKClcblxuICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdGltZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgYmVhY29uLWRvd24gc3RhdGUgb24gYSAocmUpY29ubmVjdC4gQSBibGlwIHRoYXQgcmVjb3ZlcnMgd2l0aGluIHRoZVxuICAgKiBncmFjZSB3aW5kb3cgaXMgbmV2ZXIgcmVwb3J0ZWQ7IGlmIGEgc3VzdGFpbmVkIG91dGFnZSBoYWQgYWxyZWFkeSBiZWVuXG4gICAqIHJlcG9ydGVkLCB0aGUgc3RhdGUgcmVzZXRzIHNvIGEgZnV0dXJlIG91dGFnZSBjYW4gcmVwb3J0IGFnYWluLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVCZWFjb25VcCgpIHtcbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcilcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhIEJlYWNvbiBmYWlsdXJlIG9uIHRoZSBmcmFtZXdvcmsgZXJyb3IgY2hhbm5lbC4gTWlycm9yc1xuICAgKiB0aGUgcGF0dGVybiB1c2VkIGJ5IGByZXF1ZXN0LXJ1bm5lci5qc2AgZm9yIEhUVFAgZXJyb3JzLiBXaGVuIG5vXG4gICAqIGxpc3RlbmVyIGlzIGF0dGFjaGVkIHRvIGVpdGhlciBgZnJhbWV3b3JrLWVycm9yYCBvciBgYWxsLWVycm9yYCxcbiAgICogYWxzbyBzY2hlZHVsZXMgYW4gdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uIHNvIHByb2Nlc3MtbGV2ZWwgYnVnXG4gICAqIHJlcG9ydGVycyAod2hpY2ggc3Vic2NyaWJlIHRvIGB1bmhhbmRsZWRSZWplY3Rpb25gIGJ5IGRlZmF1bHQpIHBpY2tcbiAgICogdGhlIGZhaWx1cmUgdXAg4oCUIGFuZCBBTFNPIHdyaXRlcyBhIG9uZS1saW5lIHN1bW1hcnkgdG8gYHN0ZGVycmAgc29cbiAgICogdGhlIGZhaWx1cmUgaXNuJ3QgY29tcGxldGVseSBzaWxlbnQgb24gTm9kZSAyNCsgd2hlcmUgdGhlIGRlZmF1bHRcbiAgICogYmVoYXZpb3Igb2YgYHVuaGFuZGxlZFJlamVjdGlvbmAgaXMgdG8gdGVybWluYXRlIHRoZSBwcm9jZXNzLiBBblxuICAgKiBhcHAgdGhhdCBzZWVzIGl0cyBzZXJ2ZXIgc3VkZGVubHkgZXhpdCBuZWVkcyBhdCBsZWFzdCBvbmVcbiAgICogYnJlYWRjcnVtYiBpbiB0aGUgbG9ncyB0byBrbm93IEJlYWNvbiB3YXMgdGhlIGNhdXNlOyB0aGUgcHJldmlvdXNcbiAgICogYmVoYXZpb3IgbGVmdCBhIHN0YWNrLW9ubHkgY3Jhc2ggd2l0aCBubyBjb250ZXh0IHR5aW5nIGl0IGJhY2sgdG9cbiAgICogdGhlIGJyb2tlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1wiYmVhY29uLWNvbm5lY3RcIiB8IFwiYmVhY29uLWRpc2Nvbm5lY3RcIn0gYXJncy5zdGFnZSAtIEZhaWx1cmUgc3RhZ2UuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0QmVhY29uRXJyb3Ioe3N0YWdlLCBlcnJvcn0pIHtcbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuX2Vycm9yRXZlbnRzXG4gICAgY29uc3QgaGFzTGlzdGVuZXIgPSBlcnJvckV2ZW50cy5saXN0ZW5lckNvdW50KFwiZnJhbWV3b3JrLWVycm9yXCIpID4gMFxuICAgICAgfHwgZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImFsbC1lcnJvclwiKSA+IDBcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge3N0YWdlfSxcbiAgICAgIGVycm9yXG4gICAgfVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG5cbiAgICBpZiAoIWhhc0xpc3RlbmVyKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG5cblxuICAgICAgY29uc29sZS5lcnJvcihgW3ZlbG9jaW91cyBmcmFtZXdvcmstZXJyb3Igc3RhZ2U9JHtzdGFnZX1dICR7bWVzc2FnZX0g4oCUIHJlZ2lzdGVyIGEgbGlzdGVuZXIgdmlhIGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5vbihcImZyYW1ld29yay1lcnJvclwiLCDigKYpIHRvIHN1cHByZXNzIHRoaXMgc3RkZXJyIGZhbGxiYWNrYClcbiAgICAgIHZvaWQgUHJvbWlzZS5yZWplY3QoZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyB0aGUgYWN0aXZlIEJlYWNvbiBjbGllbnQgKGlmIGFueSkuIFNhZmUgdG8gY2FsbCBtdWx0aXBsZVxuICAgKiB0aW1lcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBkaXNjb25uZWN0QmVhY29uKCkge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuX2JlYWNvbkNsaWVudFxuXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UgPSB1bmRlZmluZWRcblxuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKVxuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IGZhbHNlXG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKGNsaWVudCkgYXdhaXQgY2xpZW50LmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSb3V0ZXMgYSBCZWFjb24tc291cmNlZCBicm9hZGNhc3QgdGhyb3VnaCB0aGUgc2FtZSBkZWxpdmVyeSBjb2RlXG4gICAqIHBhdGggYXMgYSBsb2NhbGx5LW9yaWdpbmF0ZWQgb25lLiBQcmVmZXJzIHRoZSB3b3JrZXJ0aHJlYWQtYXdhcmVcbiAgICogYGJyb2FkY2FzdFYyYCB3aGVuIGFuIEhUVFAgc2VydmVyIGlzIGhvc3Rpbmcgd29ya2VycywgYW5kIGZhbGxzXG4gICAqIGJhY2sgdG8gdGhlIHBlci1wcm9jZXNzIHN1YnNjcmlwdGlvbiBkaXNwYXRjaCBvdGhlcndpc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iZWFjb24vdHlwZXMuanNcIikuQmVhY29uQnJvYWRjYXN0TWVzc2FnZX0gbWVzc2FnZSAtIEJyb2FkY2FzdCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbihtZXNzYWdlKSB7XG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyKHtcbiAgICAgICAgY2hhbm5lbDogbWVzc2FnZS5jaGFubmVsLFxuICAgICAgICBicm9hZGNhc3RQYXJhbXM6IG1lc3NhZ2UuYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICBib2R5OiBtZXNzYWdlLmJvZHksXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXNcbiAgICAgIH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChtZXNzYWdlLmNoYW5uZWwsIG1lc3NhZ2UuYnJvYWRjYXN0UGFyYW1zLCBtZXNzYWdlLmJvZHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWQ+fSAtIFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGFzeW5jIGdldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKCkge1xuICAgIGlmICghdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0xvYWRlclR5cGUgfCB1bmRlZmluZWR9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzIC0gU2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKHNjaGVkdWxlZEJhY2tncm91bmRKb2JzKSB7XG4gICAgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgPSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1haWxlciBiYWNrZW5kLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk1haWxlckJhY2tlbmQgfCB1bmRlZmluZWR9IC0gTWFpbGVyIGJhY2tlbmQuXG4gICAqL1xuICBnZXRNYWlsZXJCYWNrZW5kKCkge1xuICAgIHJldHVybiB0aGlzLl9tYWlsZXJCYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbWFpbGVyIGJhY2tlbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk1haWxlckJhY2tlbmQgfCB1bmRlZmluZWR9IG1haWxlckJhY2tlbmQgLSBNYWlsZXIgYmFja2VuZCwgb3IgdW5kZWZpbmVkIHRvIHJlbW92ZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TWFpbGVyQmFja2VuZChtYWlsZXJCYWNrZW5kKSB7XG4gICAgdGhpcy5fbWFpbGVyQmFja2VuZCA9IG1haWxlckJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dnaW5nIGNvbmZpZ3VyYXRpb24gdGFpbG9yZWQgZm9yIEhUVFAgcmVxdWVzdCBsb2dnaW5nLiBEZWZhdWx0cyBjb25zb2xlIGxvZ2dpbmcgdG8gdHJ1ZSBhbmQgYXBwbGllcyB0aGUgdXNlciBgbG9nZ2luZy5jb25zb2xlYCBmbGFnIG9ubHkgZm9yIHJlcXVlc3QgbG9nZ2luZy5cbiAgICogQHJldHVybnMge1JlcXVpcmVkPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImNvbnNvbGVcIiB8IFwiZmlsZVwiIHwgXCJsZXZlbHNcIj4+ICYgUGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiZGlyZWN0b3J5XCIgfCBcImZpbGVQYXRoXCI+ICYgUGFydGlhbDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJvdXRwdXRzXCIgfCBcImxvZ2dlcnNcIj4+fSAtIFRoZSBodHRwIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBMb2dnaW5nQ29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRMb2dnaW5nQ29uZmlndXJhdGlvbih7ZGVmYXVsdENvbnNvbGU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Vudmlyb25tZW50LWhhbmRsZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZW52aXJvbm1lbnQgaGFuZGxlci5cbiAgICovXG4gIGdldEVudmlyb25tZW50SGFuZGxlcigpIHtcbiAgICBpZiAoIXRoaXMuX2Vudmlyb25tZW50SGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gZW52aXJvbm1lbnQgaGFuZGxlciBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvY2FsZUZhbGxiYWNrc1R5cGUgfCB1bmRlZmluZWR9IC0gVGhlIGxvY2FsZSBmYWxsYmFja3MuXG4gICAqL1xuICBnZXRMb2NhbGVGYWxsYmFja3MoKSB7IHJldHVybiB0aGlzLmxvY2FsZUZhbGxiYWNrcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvY2FsZSBmYWxsYmFja3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvY2FsZUZhbGxiYWNrc1R5cGV9IG5ld0xvY2FsZUZhbGxiYWNrcyAtIE5ldyBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRMb2NhbGVGYWxsYmFja3MobmV3TG9jYWxlRmFsbGJhY2tzKSB7IHRoaXMubG9jYWxlRmFsbGJhY2tzID0gbmV3TG9jYWxlRmFsbGJhY2tzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3RydWN0dXJlIHNxbCBjb25maWcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU3RydWN0dXJlU3FsQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBTdHJ1Y3R1cmUgU1FMIGNvbmZpZy5cbiAgICovXG4gIGdldFN0cnVjdHVyZVNxbENvbmZpZygpIHsgcmV0dXJuIHRoaXMuX3N0cnVjdHVyZVNxbCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIHdyaXRlIHN0cnVjdHVyZSBzcWwuXG4gICAqIEBwYXJhbSB7e3JlYXNvbj86IFwibWlncmF0aW9uXCIgfCBcInNjaGVtYUR1bXBcIn19IFthcmdzXSAtIENhbGwgY29udGV4dCBmb3IgdGhlIHN0cnVjdHVyZSBzcWwgd3JpdGUgZGVjaXNpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3RydWN0dXJlIFNRTCBmaWxlcyBzaG91bGQgYmUgZ2VuZXJhdGVkIGZvciB0aGUgY3VycmVudCBlbnZpcm9ubWVudC5cbiAgICovXG4gIHNob3VsZFdyaXRlU3RydWN0dXJlU3FsKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtyZWFzb24gPSBcIm1pZ3JhdGlvblwifSA9IGFyZ3NcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldFN0cnVjdHVyZVNxbENvbmZpZygpXG4gICAgY29uc3QgZW5hYmxlZEVudmlyb25tZW50cyA9IGNvbmZpZz8uZW5hYmxlZEVudmlyb25tZW50c1xuICAgIGNvbnN0IGRpc2FibGVkRW52aXJvbm1lbnRzID0gY29uZmlnPy5kaXNhYmxlZEVudmlyb25tZW50c1xuXG4gICAgaWYgKHJlYXNvbiA9PT0gXCJzY2hlbWFEdW1wXCIpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZW5hYmxlZEVudmlyb25tZW50cykpIHtcbiAgICAgIHJldHVybiBlbmFibGVkRW52aXJvbm1lbnRzLmluY2x1ZGVzKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShkaXNhYmxlZEVudmlyb25tZW50cykgJiYgZGlzYWJsZWRFbnZpcm9ubWVudHMuaW5jbHVkZXModGhpcy5nZXRFbnZpcm9ubWVudCgpKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCIpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc3RydWN0dXJlIHNxbCBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlN0cnVjdHVyZVNxbENvbmZpZ3VyYXRpb259IHN0cnVjdHVyZVNxbCAtIFN0cnVjdHVyZSBTUUwgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRTdHJ1Y3R1cmVTcWxDb25maWcoc3RydWN0dXJlU3FsKSB7XG4gICAgdGhpcy5fc3RydWN0dXJlU3FsID0gc3RydWN0dXJlU3FsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBsb2NhbGUuXG4gICAqL1xuICBnZXRMb2NhbGUoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLmxvY2FsZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvY2FsZSgpXG4gICAgfSBlbHNlIGlmICh0aGlzLmxvY2FsZSkge1xuICAgICAgcmV0dXJuIHRoaXMubG9jYWxlXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLmdldExvY2FsZXMoKVswXVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGVzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gLSBUaGUgbG9jYWxlcy5cbiAgICovXG4gIGdldExvY2FsZXMoKSB7IHJldHVybiBkaWdnKHRoaXMsIFwibG9jYWxlc1wiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBUaGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzKG5hbWUpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5tb2RlbENsYXNzZXNbbmFtZV1cblxuICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIG1vZGVsIGNsYXNzICR7bmFtZX0gaW4gJHtPYmplY3Qua2V5cyh0aGlzLm1vZGVsQ2xhc3Nlcykuam9pbihcIiwgXCIpfX1gKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzc2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBBIGhhc2ggb2YgYWxsIG1vZGVsIGNsYXNzZXMsIGtleWVkIGJ5IG1vZGVsIG5hbWUsIGFzIHRoZXkgd2VyZSBkZWZpbmVkIGluIHRoZSBjb25maWd1cmF0aW9uLiBUaGlzIGlzIGEgZGlyZWN0IHJlZmVyZW5jZSB0byB0aGUgbW9kZWwgY2xhc3Nlcywgbm90IGEgY29weS5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3NlcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0aW5nLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBUaGUgcGF0aCB0byBhIGNvbmZpZyBmaWxlIHRoYXQgc2hvdWxkIGJlIHVzZWQgZm9yIHRlc3RpbmcuXG4gICAqL1xuICBnZXRUZXN0aW5nKCkgeyByZXR1cm4gdGhpcy5fdGVzdGluZyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRydXN0ZWQgcHJveGllcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSBUcnVzdGVkIHJldmVyc2UgcHJveHkgYWRkcmVzcyByYW5nZXMuXG4gICAqL1xuICBnZXRUcnVzdGVkUHJveGllcygpIHsgcmV0dXJuIHRoaXMuX3RydXN0ZWRQcm94aWVzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJ1c3RlZCBwcm94aWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSB0cnVzdGVkUHJveGllcyAtIFRydXN0ZWQgcmV2ZXJzZSBwcm94eSBhZGRyZXNzIHJhbmdlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRUcnVzdGVkUHJveGllcyh0cnVzdGVkUHJveGllcykgeyB0aGlzLl90cnVzdGVkUHJveGllcyA9IHRydXN0ZWRQcm94aWVzIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIGRhdGFiYXNlIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbaWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyIHRvIGluaXRpYWxpemUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGluaXRpYWxpemVEYXRhYmFzZVBvb2woaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyAnZGF0YWJhc2UnIHdhcyBnaXZlblwiKVxuICAgIGlmICh0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0pIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlUG9vbCBoYXMgYWxyZWFkeSBiZWVuIGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBQb29sVHlwZSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sVHlwZShpZGVudGlmaWVyKVxuXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdID0gbmV3IFBvb2xUeXBlKHtjb25maWd1cmF0aW9uOiB0aGlzLCBpZGVudGlmaWVyfSlcbiAgICB0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0uc2V0Q3VycmVudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBwb29sIGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2lkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllciB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBwb29sIGluaXRpYWxpemVkLlxuICAgKi9cbiAgaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHsgcmV0dXJuIEJvb2xlYW4odGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgaW5pdGlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBpc0luaXRpYWxpemVkKCkgeyByZXR1cm4gdGhpcy5faXNJbml0aWFsaXplZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBtb2RlbHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplTW9kZWxzKGFyZ3MgPSB7dHlwZTogXCJzZXJ2ZXJcIn0pIHtcbiAgICBjb25zdCBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICBpZiAodGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgY29uc3QgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgICBhd2FpdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IG1vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICYmICF0aGlzLl9tb2RlbHNJbml0aWFsaXplZCkge1xuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPT09IGluaXRpYWxpemVNb2RlbHNQcm9taXNlKSB7XG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmluaXRpYWxpemVNb2RlbHMoYXJncylcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc2hvdWxkU2tpcER1bW15TW9kZWxJbml0aWFsaXphdGlvbiA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52LlZFTE9DSU9VU19TS0lQX0RVTU1ZX01PREVMX0lOSVRJQUxJWkFUSU9OID09PSBcIjFcIlxuICAgICAgICAmJiBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfQlJPV1NFUl9URVNUUyA9PT0gXCJ0cnVlXCJcbiAgICAgICAgJiYgdGhpcy5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIlxuXG4gICAgICBpZiAoIXNob3VsZFNraXBEdW1teU1vZGVsSW5pdGlhbGl6YXRpb24pIHtcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHMpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplTW9kZWxzKHtjb25maWd1cmF0aW9uOiB0aGlzLCB0eXBlOiBhcmdzLnR5cGV9KVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbml0aWFsaXplUGFja2FnZU1vZGVscyh0aGlzKVxuICAgICAgICBhd2FpdCBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyh0aGlzKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW5pdGlhbGl6ZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzKHRoaXMpXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBlYWNoIGNvbmZpZ3VyZWQgZGF0YWJhc2UgcG9vbCBoYXMgYSBnbG9iYWwgY29ubmVjdGlvbiBhdmFpbGFibGUuXG4gICAqIFVzZWZ1bCB3aGVuIGBnZXRDdXJyZW50Q29ubmVjdGlvbmAgbWlnaHQgYmUgY2FsbGVkIHdpdGhvdXQgYW4gYXN5bmMgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUdsb2JhbENvbm5lY3Rpb25zKCkge1xuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIGF3YWl0IHBvb2wuZW5zdXJlR2xvYmFsQ29ubmVjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFR5cGUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGluaXRpYWxpemUoe3R5cGV9ID0ge3R5cGU6IFwidW5kZWZpbmVkXCJ9KSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlKSByZXR1cm4gdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogdHJ1ZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5fc2h1dGRvd25Qcm9taXNlfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiBmYWxzZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIG9yIGpvaW5zIGluaXRpYWxpemF0aW9uIGFmdGVyIGxpZmVjeWNsZSBibG9ja2VycyBoYXZlIHNldHRsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU3RhcnR1cCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gR2VuZXJpYyBhcHBsaWNhdGlvbiBwcm9jZXNzIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBzdGFydHVwIHByb21pc2UuXG4gICAqL1xuICBfYmVnaW5Jbml0aWFsaXplKHt0eXBlfSkge1xuICAgIGNvbnN0IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiBmYWxzZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5faW5pdGlhbGl6ZVByb21pc2V9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pc0luaXRpYWxpemVkKSB7XG4gICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgICAgcmV0dXJuIHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgfVxuICAgIC8vIE1lbW9pemUgdGhlIGluLXByb2dyZXNzIGluaXRpYWxpemF0aW9uIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGUgc2FtZVxuICAgIC8vIGJvb3RzdHJhcCBpbnN0ZWFkIG9mIHJhY2luZy4gYF9pc0luaXRpYWxpemVkYCB3YXMgcHJldmlvdXNseSBzZXQgdG8gYHRydWVgXG4gICAgLy8gdXAgZnJvbnQsIHNvIGEgc2Vjb25kIGNhbGxlciAoZS5nLiBhIHBvb2xlZCBydW5uZXIgd2l0aFxuICAgIC8vIGBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+IDFgIHN0YXJ0aW5nIHNldmVyYWwgam9icyBvbiBhIGNvbGQgY2hpbGQpIGNvdWxkXG4gICAgLy8gc2tpcCBpbml0aWFsaXphdGlvbiBhbmQgbG9hZCBtb2RlbHMgLyBwZXJmb3JtIGEgam9iIHdoaWxlIHRoZSBmaXJzdCBjYWxsXG4gICAgLy8gd2FzIHN0aWxsIGF3YWl0aW5nIG1vZGVsIGRpc2NvdmVyeSBhbmQgaW5pdGlhbGl6ZXJzLiBNaXJyb3JzIGNvbm5lY3RCZWFjb24uXG4gICAgY29uc3QgaW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9ydW5Jbml0aWFsaXplKHtpbml0aWFsaXphdGlvbkdlbmVyYXRpb24sIHR5cGV9KVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSBpbml0aWFsaXplUHJvbWlzZVxuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgcmV0dXJuIGluaXRpYWxpemVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIG9uZSBzaGFyZWQgaW5pdGlhbGl6YXRpb24gYmVoaW5kIGFuIGluY29tcGF0aWJsZSBsaWZlY3ljbGUgcGhhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSAtIFdoZXRoZXIgYSBjb21wbGV0ZWQgZmFpbGVkIHNodXRkb3duIHN0aWxsIHBlcm1pdHMgcmVwbGFjZW1lbnQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFJlcGxhY2VtZW50IHByb2Nlc3MgdHlwZS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBhcmdzLndhaXRGb3IgLSBMaWZlY3ljbGUgcGhhc2UgdGhhdCBtdXN0IHNldHRsZSBmaXJzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2hhcmVkIHF1ZXVlZCBzdGFydHVwIHByb21pc2UuXG4gICAqL1xuICBfcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHR5cGUsIHdhaXRGb3J9KSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlKSByZXR1cm4gdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIGNvbnN0IHF1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB3YWl0Rm9yfSlcblxuICAgICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSA9PT0gd2FpdEZvcikgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IHdhaXRGb3IpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNodXRkb3duUHJvbWlzZSA9IHRoaXMuX3NodXRkb3duUHJvbWlzZVxuXG4gICAgICBpZiAoc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiB0cnVlLCB3YWl0Rm9yOiBzaHV0ZG93blByb21pc2V9KVxuICAgICAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlID09PSBzaHV0ZG93blByb21pc2UpIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uICE9PSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICBjb25zdCBzdGFsZUluaXRpYWxpemVQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcblxuICAgICAgICBhd2FpdCBzdGFsZUluaXRpYWxpemVQcm9taXNlXG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gc3RhbGVJbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fYmVnaW5Jbml0aWFsaXplKHt0eXBlfSlcbiAgICB9KSgpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuXG4gICAgcmV0dXJuIHF1ZXVlZEluaXRpYWxpemVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGEgbGlmZWN5Y2xlIHBoYXNlIGJlZm9yZSBxdWV1ZWQgaW5pdGlhbGl6YXRpb24gcHJvY2VlZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2FpdCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jb250aW51ZUFmdGVyV2FpdEZhaWx1cmUgLSBXaGV0aGVyIHJlcGxhY2VtZW50IHN0YXJ0dXAgcmVtYWlucyBhdmFpbGFibGUgYWZ0ZXIgYSBmYWlsZWQgcGhhc2UuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gYXJncy53YWl0Rm9yIC0gTGlmZWN5Y2xlIHBoYXNlIHRoYXQgbXVzdCBzZXR0bGUgZmlyc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcXVldWVkIGluaXRpYWxpemF0aW9uIG1heSBjb250aW51ZS5cbiAgICovXG4gIGFzeW5jIF93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgd2FpdEZvcn0pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd2FpdEZvclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIWNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgYXRvbWljIGZyYW1ld29yayBhbmQgYXBwbGljYXRpb24gaW5pdGlhbGl6YXRpb24gYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbml0aWFsaXphdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uIC0gRnJhbWV3b3JrIG1vZGVsIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBHZW5lcmljIGFwcGxpY2F0aW9uIHByb2Nlc3MgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBpbml0aWFsaXplZC5cbiAgICovXG4gIGFzeW5jIF9ydW5Jbml0aWFsaXplKHtpbml0aWFsaXphdGlvbkdlbmVyYXRpb24sIHR5cGV9KSB7XG4gICAgY29uc3Qgc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUgPSAhdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZFxuXG4gICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB7XG4gICAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICAgIGluc3RhbmNlSWQ6IG5ldyBVVUlEKDQpLmZvcm1hdCgpLFxuICAgICAgICB0eXBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemVNb2RlbHMoe3R5cGV9KVxuXG4gICAgICAvLyBNb2RlbCBpbml0aWFsaXphdGlvbiBjYW4gYmUgaW52YWxpZGF0ZWQgYnkgYSBjb25jdXJyZW50IGNvbm5lY3Rpb24gY2xvc2UuXG4gICAgICAvLyBJZiBtb2RlbHMgYXJlIG5vdCByZWFkeSwgc3RvcCB3aXRob3V0IG1hcmtpbmcgdGhlIGNvbmZpZ3VyYXRpb24gaW5pdGlhbGl6ZWRcbiAgICAgIC8vIHNvIHRoZSBuZXh0IGNhbGxlciByZXRyaWVzIGEgZnVsbCBib290c3RyYXAuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gIT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiB8fCAhdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuYXV0b0Rpc2NvdmVyUmVzb3VyY2VzKHRoaXMpXG4gICAgICB0aGlzLl9tZXJnZURpc2NvdmVyZWRBYmlsaXR5UmVzb3VyY2VzKClcbiAgICAgIHRoaXMuX3ZhbGlkYXRlUmVzb3VyY2VSZWxhdGlvbnNoaXBzT25Nb2RlbHMoKVxuXG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUgJiYgdGhpcy5faW5pdGlhbGl6ZXJzKSB7XG4gICAgICAgIGNvbnN0IGluaXRpYWxpemVycyA9IGF3YWl0IHRoaXMuX2luaXRpYWxpemVycyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgICAgIGNvbnN0IHtyZXF1aXJlQ29udGV4dCwgLi4ucmVzdEFyZ3N9ID0gaW5pdGlhbGl6ZXJzXG5cbiAgICAgICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgICAgICBpZiAocmVxdWlyZUNvbnRleHQpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGluaXRpYWxpemVyS2V5IG9mIHJlcXVpcmVDb250ZXh0LmtleXMoKSkge1xuICAgICAgICAgICAgY29uc3QgSW5pdGlhbGl6ZXJDbGFzcyA9IHJlcXVpcmVDb250ZXh0KGluaXRpYWxpemVyS2V5KS5kZWZhdWx0XG4gICAgICAgICAgICBjb25zdCBwcm9jZXNzQ29udGV4dCA9IHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHRcblxuICAgICAgICAgICAgaWYgKCFwcm9jZXNzQ29udGV4dCkgdGhyb3cgbmV3IEVycm9yKFwiQXBwbGljYXRpb24gcHJvY2VzcyBjb250ZXh0IGlzIG5vdCBhdmFpbGFibGUgZHVyaW5nIGluaXRpYWxpemVyIHN0YXJ0dXBcIilcblxuICAgICAgICAgICAgY29uc3QgaW5pdGlhbGl6ZXJJbnN0YW5jZSA9IG5ldyBJbml0aWFsaXplckNsYXNzKHtjb25maWd1cmF0aW9uOiB0aGlzLCBwcm9jZXNzQ29udGV4dCwgdHlwZX0pXG5cbiAgICAgICAgICAgIGF3YWl0IGluaXRpYWxpemVySW5zdGFuY2UucnVuKClcbiAgICAgICAgICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMucHVzaChpbml0aWFsaXplckluc3RhbmNlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWQgPSB0cnVlXG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkge1xuICAgICAgICBsZXQgdGVhcmRvd25FcnJvclxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKClcbiAgICAgICAgfSBjYXRjaCAoY2F1Z2h0VGVhcmRvd25FcnJvcikge1xuICAgICAgICAgIHRlYXJkb3duRXJyb3IgPSBjYXVnaHRUZWFyZG93bkVycm9yXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGVhcmRvd25FcnJvciBpbnN0YW5jZW9mIEFnZ3JlZ2F0ZUVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW2Vycm9yLCAuLi50ZWFyZG93bkVycm9yLmVycm9yc10sXG4gICAgICAgICAgICBcIkFwcGxpY2F0aW9uIHByb2Nlc3Mgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlYXJkb3duRXJyb3IgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgdGVhcmRvd25FcnJvcl0sXG4gICAgICAgICAgICBcIkFwcGxpY2F0aW9uIHByb2Nlc3Mgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNJbml0aWFsaXplZCAmJiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biBldmVyeSBzdWNjZXNzZnVsbHkgc3RhcnRlZCBpbml0aWFsaXplciBpbiByZXZlcnNlIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRlYXJkb3duIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpIHtcbiAgICBjb25zdCBzdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5zcGxpY2UoMCkucmV2ZXJzZSgpXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQXBwbGljYXRpb24gaW5pdGlhbGl6ZXIgdGVhcmRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5tYXAoKGluaXRpYWxpemVyKSA9PiBhc3luYyAoKSA9PiBhd2FpdCBpbml0aWFsaXplci50ZWFyZG93bigpKVxuICAgIH0pXG4gIH1cblxuICAvKiogQ2xlYXJzIGFwcGxpY2F0aW9uLW93bmVkIGxpZmVjeWNsZSBzdGF0ZSBhZnRlciBldmVyeSB0ZWFyZG93biBhdHRlbXB0LiAqL1xuICBfcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpIHtcbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycyA9IFtdXG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biB0aGUgY3VycmVudCBhcHBsaWNhdGlvbiBsaWZlY3ljbGUgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gRXhhY3Qgc2hhcmVkIHNodXRkb3duIHByb21pc2UuXG4gICAqL1xuICBzaHV0ZG93bigpIHtcbiAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlKSByZXR1cm4gdGhpcy5fc2h1dGRvd25Qcm9taXNlXG5cbiAgICBjb25zdCBpbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgY29uc3Qgc2h1dGRvd25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChpbml0aWFsaXplUHJvbWlzZSkgYXdhaXQgaW5pdGlhbGl6ZVByb21pc2VcbiAgICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKClcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSBpbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KSgpXG5cbiAgICB0aGlzLl9zaHV0ZG93blByb21pc2UgPSBzaHV0ZG93blByb21pc2VcblxuICAgIHJldHVybiBzaHV0ZG93blByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhhdCByZXNvdXJjZS1kZWZpbmVkIHJlbGF0aW9uc2hpcHMgYXJlIGFsc28gZGVmaW5lZCBvbiB0aGUgY29ycmVzcG9uZGluZyBtb2RlbCBjbGFzc2VzLlxuICAgKiBUaHJvd3MgYW4gZXJyb3IgaWYgYSByZWxhdGlvbnNoaXAgaXMgZGVmaW5lZCBvbiBhIHJlc291cmNlIGJ1dCBtaXNzaW5nIGZyb20gdGhlIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJlc291cmNlUmVsYXRpb25zaGlwc09uTW9kZWxzKCkge1xuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5fYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICAgIGZvciAoY29uc3QgW21vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZXMpKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlnPy5yZWxhdGlvbnNoaXBzKSBjb250aW51ZVxuXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBkZWZpbmVzIHJlbGF0aW9uc2hpcHMgYXMgYW4gb2JqZWN0LiBVc2UgYW4gYXJyYXkgaW5zdGVhZDogc3RhdGljIHJlbGF0aW9uc2hpcHMgPSAke0pTT04uc3RyaW5naWZ5KE9iamVjdC5rZXlzKHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUmVsYXRpb25zaGlwcyA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpXG5cbiAgICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgICBpZiAoIShyZWxhdGlvbnNoaXBOYW1lIGluIGV4aXN0aW5nUmVsYXRpb25zaGlwcykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYFJlc291cmNlIGZvciAke21vZGVsTmFtZX0gZGVmaW5lcyByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgYnV0ICR7bW9kZWxOYW1lfSBtb2RlbCBkb2VzIG5vdC4gYCArXG4gICAgICAgICAgICAgIGBBZGQgJHttb2RlbE5hbWV9LmJlbG9uZ3NUbyhcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiwgLi4uKSBvciB0aGUgYXBwcm9wcmlhdGUgcmVsYXRpb25zaGlwIGNhbGwgb24gdGhlIG1vZGVsIGNsYXNzLmBcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZWdpc3Rlck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWxDbGFzc2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldID0gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnQoKSB7XG4gICAgc2V0Q3VycmVudENvbmZpZ3VyYXRpb24odGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb3V0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSByb3V0ZXMuXG4gICAqL1xuICBnZXRSb3V0ZXMoKSB7IHJldHVybiB0aGlzLl9yb3V0ZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCByb3V0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdH0gbmV3Um91dGVzIC0gTmV3IHJvdXRlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Um91dGVzKG5ld1JvdXRlcykge1xuICAgIHRoaXMuX3JvdXRlcyA9IG5ld1JvdXRlc1xuICAgIHRoaXMuX2FwcGx5Um91dGVNb3VudHMobmV3Um91dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYW55IGByb3V0ZS5tb3VudCguLi4pYCByZWdpc3RyYXRpb25zIGZyb20gdGhlIHJvdXRlcyBmaWxlIGJ5IGxldHRpbmdcbiAgICogZWFjaCBtb3VudGFibGUgcmVnaXN0ZXIgaXRzIHJvdXRlcyAodHlwaWNhbGx5IHJvdXRlLXJlc29sdmVyIGhvb2tzKSBhZ2FpbnN0XG4gICAqIHRoaXMgY29uZmlndXJhdGlvbi4gR3VhcmRlZCBzbyByZXBlYXRlZCBzZXRSb3V0ZXMgY2FsbHMgd2l0aCB0aGUgc2FtZSByb3V0ZXNcbiAgICogZG9uJ3QgcmVnaXN0ZXIgYSBtb3VudCBtb3JlIHRoYW4gb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0fSBuZXdSb3V0ZXMgLSBSb3V0ZXMgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hcHBseVJvdXRlTW91bnRzKG5ld1JvdXRlcykge1xuICAgIGlmICghbmV3Um91dGVzIHx8IHR5cGVvZiBuZXdSb3V0ZXMuZ2V0TW91bnRzICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBtb3VudCBvZiBuZXdSb3V0ZXMuZ2V0TW91bnRzKCkpIHtcbiAgICAgIGlmICh0aGlzLl9hcHBsaWVkUm91dGVNb3VudHMuaGFzKG1vdW50KSkgY29udGludWVcblxuICAgICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzLmFkZChtb3VudClcbiAgICAgIG1vdW50Lm1vdW50YWJsZS5tb3VudEludG8oe2NvbmZpZ3VyYXRpb246IHRoaXMsIC4uLm1vdW50Lm9wdGlvbnN9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIHBsdWdpbi9saWJyYXJ5IHJvdXRlcyB1c2luZyBhIGxpZ2h0d2VpZ2h0IHJvdXRlIERTTCBiYWNrZWQgYnkgcm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqIEBwYXJhbSB7KHJvdXRlczogaW1wb3J0KFwiLi9yb3V0ZXMvcGx1Z2luLXJvdXRlcy5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkfSBjYWxsYmFjayAtIFJvdXRlcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcm91dGVzKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcGx1Z2luUm91dGVzID0gbmV3IFBsdWdpblJvdXRlcyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG5cbiAgICBjYWxsYmFjayhwbHVnaW5Sb3V0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJhbnNsYXRvci5cbiAgICogQHBhcmFtIHsoYXJnMTogc3RyaW5nLCBhcmcyOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWQpID0+IHN0cmluZ30gY2FsbGJhY2sgLSBUcmFuc2xhdG9yIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUcmFuc2xhdG9yKGNhbGxiYWNrKSB7IHRoaXMuX3RyYW5zbGF0b3IgPSBjYWxsYmFjayB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbXNnSUQgLSBNc2cgaWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJnc10gLSBUcmFuc2xhdG9yIG9wdGlvbnMgYW5kIHZhcmlhYmxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKi9cbiAgX2RlZmF1bHRUcmFuc2xhdG9yKG1zZ0lELCBhcmdzKSB7XG4gICAgdGhpcy5fY29uZmlndXJlRGVmYXVsdFRyYW5zbGF0b3IoKVxuXG4gICAgY29uc3QgdHJhbnNsYXRlQXJncyA9IGFyZ3MgPyB7Li4uYXJnc30gOiB1bmRlZmluZWRcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSB0cmFuc2xhdGVBcmdzPy5kZWZhdWx0VmFsdWVcbiAgICBjb25zdCBsb2NhbGVzID0gdHJhbnNsYXRlQXJncz8ubG9jYWxlc1xuXG4gICAgaWYgKHRyYW5zbGF0ZUFyZ3MpIHtcbiAgICAgIGRlbGV0ZSB0cmFuc2xhdGVBcmdzLmRlZmF1bHRWYWx1ZVxuICAgICAgZGVsZXRlIHRyYW5zbGF0ZUFyZ3MubG9jYWxlc1xuICAgIH1cblxuICAgIGNvbnN0IHZhcmlhYmxlcyA9IHRyYW5zbGF0ZUFyZ3MgJiYgT2JqZWN0LmtleXModHJhbnNsYXRlQXJncykubGVuZ3RoID4gMCA/IHRyYW5zbGF0ZUFyZ3MgOiB1bmRlZmluZWRcblxuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKClcbiAgICBjb25zdCBwcmVmZXJyZWRMb2NhbGVzID0gbG9jYWxlcyB8fCAobG9jYWxlID8gdW5kZWZpbmVkIDogW10pXG4gICAgY29uc3QgbWVzc2FnZSA9IHRyYW5zbGF0ZShtc2dJRCwgdmFyaWFibGVzLCBwcmVmZXJyZWRMb2NhbGVzKVxuXG4gICAgaWYgKG1lc3NhZ2UgPT09IG1zZ0lEICYmIGRlZmF1bHRWYWx1ZSkgcmV0dXJuIHRyYW5zbGF0ZShkZWZhdWx0VmFsdWUsIHZhcmlhYmxlcywgW10pXG5cbiAgICByZXR1cm4gbWVzc2FnZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0b3IuXG4gICAqIEByZXR1cm5zIHsobXNnSUQ6IHN0cmluZywgYXJncz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gc3RyaW5nfSAtIFRoZSBjb25maWd1cmVkIHRyYW5zbGF0b3IuXG4gICAqL1xuICBnZXRUcmFuc2xhdG9yKCkge1xuICAgIGlmICh0aGlzLl90cmFuc2xhdG9yKSByZXR1cm4gdGhpcy5fdHJhbnNsYXRvclxuXG4gICAgaWYgKCF0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kKSB7XG4gICAgICB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kID0gdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3IuYmluZCh0aGlzKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmUgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBDb25maWd1cmUgZ2V0dGV4dCBkZWZhdWx0cyBmb3IgdGhpcyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX2NvbmZpZ3VyZURlZmF1bHRUcmFuc2xhdG9yKCkge1xuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKClcblxuICAgIGdldHRleHRDb25maWcuc2V0TG9jYWxlKGxvY2FsZSB8fCBcIlwiKVxuXG4gICAgY29uc3QgZmFsbGJhY2tzID0gbG9jYWxlID8gdGhpcy5nZXRMb2NhbGVGYWxsYmFja3MoKT8uW2xvY2FsZV0gOiBbXVxuXG4gICAgZ2V0dGV4dENvbmZpZy5zZXRGYWxsYmFja3MoZmFsbGJhY2tzIHx8IFtdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lIG9mZnNldCBtaW51dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRoZSB0aW1lem9uZSBvZmZzZXQgaW4gbWludXRlcy5cbiAgICovXG4gIGdldFRpbWV6b25lT2Zmc2V0TWludXRlcygpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjb25zdCBjb25maWd1cmVkT2Zmc2V0ID0gdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzKClcblxuICAgICAgaWYgKHR5cGVvZiBjb25maWd1cmVkT2Zmc2V0ID09PSBcIm51bWJlclwiKSByZXR1cm4gY29uZmlndXJlZE9mZnNldFxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VGltZXpvbmVPZmZzZXQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWUgem9uZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXRUaW1lWm9uZSgpIHtcbiAgICBjb25zdCB0aW1lWm9uZSA9IHR5cGVvZiB0aGlzLl90aW1lWm9uZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3RpbWVab25lKClcbiAgICAgIDogdGhpcy5fdGltZVpvbmVcblxuICAgIGlmICh0aW1lWm9uZSA9PT0gdW5kZWZpbmVkIHx8IHRpbWVab25lID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJjb25maWd1cmF0aW9uIHRpbWVab25lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWV2ZW50cy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0RXZlbnRzKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWV2ZW50cy5qc1wiKS5kZWZhdWx0fSB3ZWJzb2NrZXRFdmVudHMgLSBXZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRXZWJzb2NrZXRFdmVudHMod2Vic29ja2V0RXZlbnRzKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0RXZlbnRzID0gd2Vic29ja2V0RXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUGVyLXByb2Nlc3MgcmVnaXN0cnkgb2YgY2hhbm5lbCBzdWJzY3JpYmVycyB1c2VkIGJ5IHdvcmtlciBjb2RlIHRoYXRcbiAgICogbmVlZHMgdG8gcmVhY3QgdG8gZXZlbnRzIGJyb2FkY2FzdCB2aWEgYHdlYnNvY2tldEV2ZW50c0hvc3QucHVibGlzaCguLi4pYFxuICAgKiB3aXRob3V0IGhvbGRpbmcgYW4gYWN0dWFsIHdlYnNvY2tldCBzZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpYmVycy5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjaGFubmVsIHN1YnNjcmliZXJzIHJlZ2lzdHJ5LlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKCkge1xuICAgIGlmICghdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKSB7XG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgPSBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGBWZWxvY2lvdXNXZWJzb2NrZXRDb25uZWN0aW9uYCBzdWJjbGFzcyB1bmRlciBhIG5hbWUuXG4gICAqIENsaWVudHMgdGhhdCBzZW5kIGB7dHlwZTogXCJjb25uZWN0aW9uLW9wZW5cIiwgY29ubmVjdGlvblR5cGU6IG5hbWV9YFxuICAgKiB3aWxsIGhhdmUgdGhpcyBjbGFzcyBpbnN0YW50aWF0ZWQgZm9yIHRoZWlyIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2xpZW50LWZhY2luZyBjb25uZWN0aW9uIHR5cGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0fSBDb25uZWN0aW9uQ2xhc3MgLSBXZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlcldlYnNvY2tldENvbm5lY3Rpb24obmFtZSwgQ29ubmVjdGlvbkNsYXNzKSB7XG4gICAgaWYgKCFuYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25uZWN0aW9uIG5hbWUgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIUNvbm5lY3Rpb25DbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbkNsYXNzIGlzIHJlcXVpcmVkXCIpXG4gICAgdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMuc2V0KG5hbWUsIENvbm5lY3Rpb25DbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25uZWN0aW9uIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBSZWdpc3RlcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMuZ2V0KG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxgIHN1YmNsYXNzIHVuZGVyIGEgbmFtZS5cbiAgICogQ2xpZW50cyBzdWJzY3JpYmUgdmlhIGB7dHlwZTogXCJjaGFubmVsLXN1YnNjcmliZVwiLCBjaGFubmVsVHlwZTogbmFtZSwgLi4ufWAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2xpZW50LWZhY2luZyBjaGFubmVsIHR5cGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBDaGFubmVsQ2xhc3MgLSBXZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICogQHBhcmFtIHt7bGl2ZU9ubHk/OiBib29sZWFufX0gW29wdGlvbnNdIC0gUmVnaXN0cmF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsKG5hbWUsIENoYW5uZWxDbGFzcywge2xpdmVPbmx5ID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAoIW5hbWUpIHRocm93IG5ldyBFcnJvcihcIkNoYW5uZWwgbmFtZSBpcyByZXF1aXJlZFwiKVxuICAgIGlmICghQ2hhbm5lbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJDaGFubmVsQ2xhc3MgaXMgcmVxdWlyZWRcIilcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5zZXQobmFtZSwgQ2hhbm5lbENsYXNzKVxuXG4gICAgaWYgKGxpdmVPbmx5KSB0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzLmFkZChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSBuYW1lIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFJlZ2lzdGVyZWQgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsQ2xhc3MobmFtZSkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5nZXQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgY2hhbm5lbCB0eXBlIHdhcyByZWdpc3RlcmVkIHdpdGggYHtsaXZlT25seTogdHJ1ZX1gLlxuICAgKiBMaXZlLW9ubHkgY2hhbm5lbHMgYXJlIG5ldmVyIHBlcnNpc3RlZCBmb3IgcmVwbGF5OiB0aGUgZXZlbnQtbG9nXG4gICAqIHN0b3JlJ3MgYG1hcmtDaGFubmVsSW50ZXJlc3RlZGAgdGhyb3dzIGZvciB0aGVpciBuYW1lcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjaGFubmVsIGlzIGRlY2xhcmVkIGxpdmUtb25seS5cbiAgICovXG4gIGlzV2Vic29ja2V0Q2hhbm5lbExpdmVPbmx5KG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbGl2ZU9ubHlXZWJzb2NrZXRDaGFubmVscy5oYXMobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBsaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIGluIHRoZSBnbG9iYWwgcm91dGluZyByZWdpc3RyeS5cbiAgICogQ2FsbGVkIGJ5IHRoZSBzZXNzaW9uIHdoZW4gYGNhblN1YnNjcmliZSgpYCByZXNvbHZlcyB0cnV0aHk7IHRoZVxuICAgKiBzZXNzaW9uIGNhbGxzIGBfdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25gIG9uIHVuc3Vic2NyaWJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSB1c2VkIGFzIHRoZSByb3V0aW5nIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIExpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gdG8gcmVnaXN0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihuYW1lLCBzdWJzY3JpcHRpb24pIHtcbiAgICBsZXQgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkge1xuICAgICAgYnVja2V0ID0gbmV3IFNldCgpXG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5zZXQobmFtZSwgYnVja2V0KVxuICAgIH1cblxuICAgIGJ1Y2tldC5hZGQoc3Vic2NyaXB0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdW5yZWdpc3RlciB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHVzZWQgYXMgdGhlIHJvdXRpbmcga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gc3Vic2NyaXB0aW9uIC0gTGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiB0byByZW1vdmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKG5hbWUsIHN1YnNjcmlwdGlvbikge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHJldHVyblxuXG4gICAgYnVja2V0LmRlbGV0ZShzdWJzY3JpcHRpb24pXG5cbiAgICBpZiAoYnVja2V0LnNpemUgPT09IDApIHtcbiAgICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmRlbGV0ZShuYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBgYm9keWAgdG8gZXZlcnkgbGl2ZSBzdWJzY3JpYmVyIG9mIGBuYW1lYCB3aG9zZVxuICAgKiBgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpYCByZXR1cm5zIHRydWUuIFB1cmUgcm91dGluZyDigJQgbm8gYXV0aFxuICAgKiByZS1jaGVjaywgbm8gcGVyc2lzdGVuY2UuIFN1YnNjcmliZXJzIHdobyB3ZXJlIGFkbWl0dGVkIGJ5XG4gICAqIGBjYW5TdWJzY3JpYmUoKWAgY29udGludWUgdG8gcmVjZWl2ZSBicm9hZGNhc3RzIHVudGlsIHRoZXlcbiAgICogdW5zdWJzY3JpYmUgb3IgdGhlIHNlc3Npb24gZW5kcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVcbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtc1xuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5XG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGdyYWNlIHNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gR3JhY2UgcGVyaW9kIChzZWNvbmRzKSBiZWZvcmUgYSBwYXVzZWQgV1Mgc2Vzc2lvbiBpcyB0b3JuIGRvd24uXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzKCkgeyByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGhlYXJ0YmVhdCBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEludGVydmFsIChzZWNvbmRzKSBiZXR3ZWVuIHNlcnZlcuKGkmNsaWVudCBoZWFydGJlYXQgcGluZ3M7IDAgZGlzYWJsZXMgcmVhcGluZy5cbiAgICovXG4gIGdldFdlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzKCkgeyByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBlci1zZXNzaW9uIFdlYlNvY2tldCBpbmJvdW5kIG1lc3NhZ2UgcXVldWUgbGltaXRzLlxuICAgKiBAcmV0dXJucyB7e21heEJ5dGVzOiBudW1iZXIsIG1heE1lc3NhZ2VzOiBudW1iZXJ9fSAtIFBlci1zZXNzaW9uIGluYm91bmQgcXVldWUgaGlnaC13YXRlciBtYXJrcy5cbiAgICovXG4gIGdldFdlYnNvY2tldEluYm91bmRRdWV1ZUxpbWl0cygpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWVcblxuICAgIHJldHVybiB7XG4gICAgICBtYXhCeXRlczogcXVldWUubWF4UGVuZGluZ0J5dGVzLFxuICAgICAgbWF4TWVzc2FnZXM6IHF1ZXVlLm1heFBlbmRpbmdNZXNzYWdlc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBlci1jbGllbnQgV2ViU29ja2V0IG91dGJvdW5kIHF1ZXVlIGxpbWl0cy5cbiAgICogQHJldHVybnMge3ttYXhCeXRlczogbnVtYmVyLCBtYXhGcmFtZXM6IG51bWJlcn19IC0gUGVyLWNsaWVudCBvdXRib3VuZCBxdWV1ZSBoaWdoLXdhdGVyIG1hcmtzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0T3V0Ym91bmRRdWV1ZUxpbWl0cygpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWF4Qnl0ZXM6IHF1ZXVlLm1heFBlbmRpbmdCeXRlcyxcbiAgICAgIG1heEZyYW1lczogcXVldWUubWF4UGVuZGluZ0ZyYW1lc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB3cmFwcGVyIGludm9rZWQgYXJvdW5kIGV2ZXJ5IFdTLWJvcm5lIHJlcXVlc3QgL1xuICAgKiBjb25uZWN0aW9uIG1lc3NhZ2UgLyBjaGFubmVsIGRpc3BhdGNoLiBUaGUgd3JhcHBlciByZWNlaXZlcyB0aGVcbiAgICogc2Vzc2lvbiBhbmQgYSBgbmV4dGAgY2FsbGJhY2s7IGl0IG11c3QgY2FsbCBgbmV4dCgpYCB0byBydW4gdGhlXG4gICAqIGhhbmRsZXIuIFVzZSBpdCB0byBzZXQgdXAgQXN5bmNMb2NhbFN0b3JhZ2UgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IHdyYXBwZXIgLSBQZXItbWVzc2FnZSBzZXNzaW9uLWNvbnRleHQgd3JhcHBlciwgb3IgbnVsbCB0byBkaXNhYmxlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldEFyb3VuZFJlcXVlc3Qod3JhcHBlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3QgPSB3cmFwcGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGFyb3VuZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gV2Vic29ja2V0IHNlc3Npb24gd3JhcHBlci5cbiAgICovXG4gIGdldFdlYnNvY2tldEFyb3VuZFJlcXVlc3QoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3RcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB3cmFwcGVyIGludm9rZWQgYXJvdW5kIGV2ZXJ5IGNvbnRyb2xsZXIgYWN0aW9uIOKAlCBib3RoXG4gICAqIEhUVFAgYW5kIFdTLWJvcm5lLiBSZWNlaXZlcyBge3JlcXVlc3QsIHJlc3BvbnNlLCBuZXh0fWAgYW5kIG11c3RcbiAgICogY2FsbCBgbmV4dCgpYCB0byBydW4gdGhlIGFjdGlvbi4gVXNlIGl0IGZvciBwZXItcmVxdWVzdCBjb250ZXh0XG4gICAqIGxpa2UgQXN5bmNMb2NhbFN0b3JhZ2Utc2NvcGVkIGxvY2FsZSBvciB0cmFjaW5nLlxuICAgKiBAcGFyYW0geygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSB3cmFwcGVyIC0gUGVyLWFjdGlvbiByZXF1ZXN0LWNvbnRleHQgd3JhcHBlciwgb3IgbnVsbCB0byBkaXNhYmxlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEFyb3VuZEFjdGlvbih3cmFwcGVyKSB7XG4gICAgdGhpcy5fYXJvdW5kQWN0aW9uID0gd3JhcHBlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFyb3VuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gLSBIVFRQIHJlcXVlc3Qgd3JhcHBlci5cbiAgICovXG4gIGdldEFyb3VuZEFjdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fYXJvdW5kQWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGFuIGlkZW50aXR5IHJlc29sdmVyIGNhbGxlZCBvbmNlIGF0IHBhdXNlIHRpbWUgYW5kIG9uY2VcbiAgICogYXQgcmVzdW1lIHRpbWUuIFRoZSByZXNvbHZlciByZWNlaXZlcyB0aGUgc2Vzc2lvbiBhbmQgcmV0dXJucyBhbnlcbiAgICogdmFsdWUgdGhhdCBpZGVudGlmaWVzIHRoZSBhdXRoZW50aWNhdGVkIGNhbGxlciDigJQgdHlwaWNhbGx5IGFcbiAgICogYHVzZXJJZGAgcmVhZCBmcm9tIHRoZSBzZXNzaW9uJ3MgdXBncmFkZS1yZXF1ZXN0IGNvb2tpZS4gVmVsb2Npb3VzXG4gICAqIGNhcHR1cmVzIHRoZSBwYXVzZS10aW1lIHZhbHVlIG9uIHRoZSBwYXVzZWQgc2Vzc2lvbiBhbmQgY29tcGFyZXNcbiAgICogaXQgdmlhIGA9PT1gIChvciBkZWVwLWVxdWFsaXR5IGZvciBwbGFpbiBvYmplY3RzKSB0byB0aGUgZnJlc2hcbiAgICogcmVzdW1lLXRpbWUgdmFsdWUuIElmIHRoZXkgZGlmZmVyLCB0aGUgcmVzdW1lIGlzIHJlamVjdGVkIHdpdGhcbiAgICogYHNlc3Npb24tZ29uZWAgYW5kIHRoZSBwYXVzZWQgc2Vzc2lvbiBpcyBkZXN0cm95ZWQgc28gYSBzaWduZWQtb3V0XG4gICAqIG9yIHJlLWF1dGhlbnRpY2F0ZWQgY2xpZW50IGNhbm5vdCByZWNsYWltIGFub3RoZXIgdXNlcidzIHN0YXRlLlxuICAgKlxuICAgKiBSZXR1cm4gYG51bGxgL2B1bmRlZmluZWRgIHRvIG1lYW4gXCJubyBpZGVudGl0eVwiIOKAlCByZXN1bWVzIHN0aWxsXG4gICAqIHN1Y2NlZWQgaWYgcGF1c2UgYW5kIHJlc3VtZSBib3RoIHJlc29sdmUgdG8gYSBudWxsaXNoIHZhbHVlLlxuICAgKiBAcGFyYW0geygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSByZXNvbHZlciAtIEF1dGhlbnRpY2F0ZWQtY2FsbGVyIGlkZW50aXR5IHJlc29sdmVyLCBvciBudWxsIHRvIGRpc2FibGUgaWRlbnRpdHkgY2hlY2tzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyKHJlc29sdmVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIgPSByZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGlkZW50aXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9IC0gVGhlIGNvbmZpZ3VyZWQgaWRlbnRpdHkgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgc2Vzc2lvbiBncmFjZSBzZWNvbmRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gc2Vjb25kcyAtIEdyYWNlIHBlcmlvZCBiZWZvcmUgYSBwYXVzZWQgc2Vzc2lvbiBleHBpcmVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMoc2Vjb25kcykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNlY29uZHMpIHx8IHNlY29uZHMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZ3JhY2Ugc2Vjb25kczogJHtzZWNvbmRzfWApXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyA9IHNlY29uZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgc2Vzc2lvbiBoZWFydGJlYXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBIZWFydGJlYXQgaW50ZXJ2YWwsIHdpdGggemVybyBkaXNhYmxpbmcgcmVhcGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyhzZWNvbmRzKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2Vjb25kcykgfHwgc2Vjb25kcyA8IDApIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBoZWFydGJlYXQgc2Vjb25kczogJHtzZWNvbmRzfWApXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgPSBzZWNvbmRzXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgYSBzZXNzaW9uIGludG8gdGhlIHBhdXNlZCByZWdpc3RyeSBhbmQgc3RhcnRzIHRoZSBncmFjZVxuICAgKiB0aW1lci4gV2hlbiB0aGUgdGltZXIgZmlyZXMsIHRoZSBzZXNzaW9uJ3MgcGVybWFuZW50IHRlYXJkb3duXG4gICAqIGhvb2sgaXMgaW52b2tlZC4gQ2FsbGVkIGJ5IHRoZSBzZXNzaW9uIGl0c2VsZiBmcm9tIGBfaGFuZGxlQ2xvc2VgXG4gICAqIHdoZW4gdGhlcmUgaXMgcmVzdW1hYmxlIHN0YXRlIChsaXZlIENvbm5lY3Rpb25zIC8gQ2hhbm5lbCBzdWJzKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0fSBzZXNzaW9uIC0gUmVzdW1hYmxlIHNlc3Npb24gdG8gcmV0YWluIGR1cmluZyBpdHMgZ3JhY2UgcGVyaW9kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9wYXVzZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbikge1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHNlc3Npb24uc2Vzc2lvbklkXG5cbiAgICBpZiAoIXNlc3Npb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiU2Vzc2lvbiBtdXN0IGhhdmUgYSBzZXNzaW9uSWQgdG8gYmUgcGF1c2VkXCIpXG4gICAgaWYgKHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmhhcyhzZXNzaW9uSWQpKSByZXR1cm5cblxuICAgIGNvbnN0IGdyYWNlTXMgPSB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzICogMTAwMFxuICAgIGNvbnN0IGdyYWNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2V4cGlyZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKVxuICAgIH0sIGdyYWNlTXMpXG5cbiAgICAvLyBEb24ndCBrZWVwIHRoZSBwcm9jZXNzIGFsaXZlIHB1cmVseSBmb3IgYSBwYXVzZWQgc2Vzc2lvbiB0aW1lci5cbiAgICBpZiAodHlwZW9mIGdyYWNlVGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgZ3JhY2VUaW1lci51bnJlZigpXG5cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5zZXQoc2Vzc2lvbklkLCB7c2Vzc2lvbiwgZ3JhY2VUaW1lciwgcGF1c2VkQXQ6IERhdGUubm93KCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvb2tzIHVwIGEgcGF1c2VkIHNlc3Npb24gYnkgaWQgKGRvZXMgTk9UIHJlbW92ZSBpdCDigJQgY2FsbGVyIGlzXG4gICAqIGV4cGVjdGVkIHRvIGNhbGwgYF9yZXN1bWVXZWJzb2NrZXRTZXNzaW9uYCB0byBjb21wbGV0ZSB0aGUgaGFuZG9mZikuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBQYXVzZWQgc2Vzc2lvbiB3aXRoIHRoZSByZXF1ZXN0ZWQgaWRlbnRpZmllciwgaWYgcHJlc2VudC5cbiAgICovXG4gIF9maW5kUGF1c2VkV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICByZXR1cm4gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCk/LnNlc3Npb24gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBwYXVzZWQgc2Vzc2lvbiBmcm9tIHRoZSByZWdpc3RyeSBhbmQgY2FuY2VscyBpdHMgZ3JhY2VcbiAgICogdGltZXIuIENhbGxlZCBvbiBzdWNjZXNzZnVsIHJlc3VtZSBoYW5kb2ZmIGFuZCBvbiBleHBsaWNpdFxuICAgKiBleHBpcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHRvIHJlbW92ZSBhbmQgY2FuY2VsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbGVhclBhdXNlZFdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICBjbGVhclRpbWVvdXQoZW50cnkuZ3JhY2VUaW1lcilcbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEdyYWNlLXRpbWVyIGNhbGxiYWNrLiBDYWxscyB0aGUgc2Vzc2lvbidzIHBlcm1hbmVudC10ZWFyZG93blxuICAgKiBob29rIGFuZCBkcm9wcyBpdCBmcm9tIHRoZSByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIgd2hvc2UgZ3JhY2UgcGVyaW9kIGV4cGlyZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2V4cGlyZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKVxuICAgIHRyeSB7XG4gICAgICBlbnRyeS5zZXNzaW9uLl9maW5hbGl6ZUdyYWNlRXhwaXJ5KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGZpbmFsaXplIGV4cGlyZWQgV1Mgc2Vzc2lvbiAke3Nlc3Npb25JZH1gLCBlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBicm9hZGNhc3QgdG8gY2hhbm5lbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgcmVjZWl2aW5nIHRoZSBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBWYWx1ZXMgdXNlZCB0byBtYXRjaCBlbGlnaWJsZSBzdWJzY3JpcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gQnJvYWRjYXN0IHBheWxvYWQgZGVsaXZlcmVkIHRvIG1hdGNoaW5nIHN1YnNjcmlwdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYnJvYWRjYXN0VG9DaGFubmVsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSkge1xuICAgIC8vIFdoZW4gQmVhY29uIGlzIGNvbm5lY3RlZCwgc2hpcCB0aGUgYnJvYWRjYXN0IG9udG8gdGhlIGJ1cy4gVGhlXG4gICAgLy8gZGFlbW9uIGVjaG9lcyBpdCBiYWNrIHRvIGV2ZXJ5IHBlZXIgKGluY2x1ZGluZyB0aGlzIG9uZSkgYW5kXG4gICAgLy8gZWFjaCBwZWVyJ3MgYF9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbmAgcGVyZm9ybXMgdGhlIHNhbWVcbiAgICAvLyBsb2NhbCBkZWxpdmVyeSBhcyB0aGUgc3luY2hyb25vdXMgcGF0aHMgYmVsb3cg4oCUIHNvIGV2ZXJ5XG4gICAgLy8gc3Vic2NyaWJlciwgaW4gYW55IHByb2Nlc3MsIHNlZXMgYnJvYWRjYXN0cyB2aWEgYSBzaW5nbGUgY29kZVxuICAgIC8vIHBhdGguXG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCAmJiB0aGlzLl9iZWFjb25DbGllbnQuaXNDb25uZWN0ZWQoKSkge1xuICAgICAgY29uc3Qgc2VudCA9IHRoaXMuX2JlYWNvbkNsaWVudC5wdWJsaXNoKHtjaGFubmVsOiBuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHl9KVxuXG4gICAgICBpZiAoc2VudCkgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gVjIgc3Vic2NyaXB0aW9ucyBsaXZlIHBlciB3b3JrZXItdGhyZWFkLiBXaGVuIHJ1bm5pbmcgaW5cbiAgICAvLyB3b3JrZXItdGhyZWFkIG1vZGUsIHRoZSBwdWJsaXNoZXIgcnVucyBlaXRoZXIgaW4gdGhlIG1haW5cbiAgICAvLyBwcm9jZXNzIChob3N0KSBvciBpbiBvbmUgb2YgdGhlIHdvcmtlcnM6XG4gICAgLy9cbiAgICAvLyAgLSBNYWluIHByb2Nlc3M6IGBfd2Vic29ja2V0RXZlbnRzYCBpcyB0aGUgaG9zdCBzaW5nbGV0b24gYW5kXG4gICAgLy8gICAgYGJyb2FkY2FzdFYyYCBmYW5zIG91dCB0byBldmVyeSB3b3JrZXIgZGlyZWN0bHkuXG4gICAgLy8gIC0gV29ya2VyOiBgX3dlYnNvY2tldEV2ZW50c2AgaGFzIGBwdWJsaXNoVjJCcm9hZGNhc3RgIHRoYXRcbiAgICAvLyAgICBwb3N0cyB0byBtYWluLCB3aGljaCB0aGVuIGZhbnMgb3V0IHRvIGV2ZXJ5IHdvcmtlci5cbiAgICAvL1xuICAgIC8vIEluLXByb2Nlc3MgbW9kZSBkb2Vzbid0IGluc3RhbGwgYSB3ZWJzb2NrZXQtZXZlbnRzIHRyYW5zcG9ydCxcbiAgICAvLyBzbyBmYWxsIHRocm91Z2ggdG8gdGhlIGxvY2FsIGRpc3BhdGNoLlxuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMih7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5wdWJsaXNoVjJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIiAmJiB3ZWJzb2NrZXRFdmVudHMucGFyZW50UG9ydCkge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLnB1Ymxpc2hWMkJyb2FkY2FzdCh7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYWxsIHBlbmRpbmcgYnJvYWRjYXN0IG9wZXJhdGlvbnMgKGluY2x1ZGluZyBldmVudC1sb2dcbiAgICogcGVyc2lzdGVuY2UpLiBDYWxsIHRoaXMgYWZ0ZXIgYGJyb2FkY2FzdFRvQ2hhbm5lbGAgd2hlbiB5b3UgbmVlZFxuICAgKiB0aGUgZXZlbnQgdG8gYmUgcGVyc2lzdGVkIGJlZm9yZSBjb250aW51aW5nIChlLmcuIGJlZm9yZVxuICAgKiByZXNwb25kaW5nIHRvIGFuIEhUVFAgcmVxdWVzdCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpIHtcbiAgICAvKipcbiAgICAgKiBXZWJzb2NrZXQgZXZlbnRzLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBjb25zdCB3ZWJzb2NrZXRFdmVudHMgPSB0aGlzLl93ZWJzb2NrZXRFdmVudHNcblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIC8vIERyYWluIHRoZSBob3N0L3dvcmtlciBwdWJsaXNoIHF1ZXVlcyAoaW5jbHVkaW5nIGV2ZW50LWxvZyBwZXJzaXN0ZW5jZSlcbiAgICAgIC8vIGJlZm9yZSBkcmFpbmluZyBsb2NhbCBkZWxpdmVyaWVzLCBiZWNhdXNlIGhvc3QgZGlzcGF0Y2ggbGF1bmNoZXMgdGhlXG4gICAgICAvLyBsb2NhbCBkZWxpdmVyaWVzIHN5bmNocm9ub3VzbHkgYW5kIHRoZXkgbXVzdCBiZSBwYXJ0IG9mIHRoZSBzbmFwc2hvdC5cbiAgICAgIGF3YWl0IHdlYnNvY2tldEV2ZW50cy5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9hd2FpdExvY2FsQnJvYWRjYXN0RGVsaXZlcmllcygpXG4gIH1cblxuICAvKipcbiAgICogTG9jYWwgKHBlci13b3JrZXIpIGNoYW5uZWwgYnJvYWRjYXN0IGRpc3BhdGNoLiBDYWxsZWQgZWl0aGVyXG4gICAqIGRpcmVjdGx5IChpbi1wcm9jZXNzIG1vZGUpIG9yIGJ5IHRoZSB3b3JrZXIgdGhyZWFkIGFmdGVyIHRoZVxuICAgKiBtYWluLXByb2Nlc3MgZmFuLW91dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBQYXJhbXMgcGFzc2VkIHRvIGVhY2ggc3Vic2NyaXB0aW9uJ3MgYG1hdGNoZXMoKWAuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBNZXNzYWdlIGJvZHkgZGVsaXZlcmVkIHZpYSBgc2VuZE1lc3NhZ2UoKWAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEgZm9yIHJlcGxheSB0cmFja2luZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBidWNrZXQpIHtcbiAgICAgIGlmIChzdWJzY3JpcHRpb24uaXNDbG9zZWQoKSkgY29udGludWVcblxuICAgICAgbGV0IG1hdGNoZXNcblxuICAgICAgdHJ5IHtcbiAgICAgICAgbWF0Y2hlcyA9IHN1YnNjcmlwdGlvbi5tYXRjaGVzKGJyb2FkY2FzdFBhcmFtcyB8fCB7fSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIEEgYnJva2VuIGBtYXRjaGVzKClgIG9uIG9uZSBzdWJzY3JpYmVyIG11c3Qgbm90IHBvaXNvbiB0aGVcbiAgICAgICAgLy8gYnJvYWRjYXN0IHRvIG90aGVyIHN1YnNjcmliZXJzLiBTa2lwIGFuZCBjb250aW51ZS5cbiAgICAgICAgY29uc29sZS5lcnJvcihgYnJvYWRjYXN0VG9DaGFubmVsOiAke25hbWV9IHN1YnNjcmlwdGlvbiAke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH0gbWF0Y2hlcygpIHRocmV3YCwgZXJyb3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWF0Y2hlcykgY29udGludWVcblxuICAgICAgY29uc3QgZGVsaXZlcnlNZXRhZGF0YSA9IHtcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICAuLi4obWV0YT8uZXZlbnRJZCA/IHtldmVudElkOiBtZXRhLmV2ZW50SWR9IDoge30pXG4gICAgICB9XG4gICAgICBjb25zdCBwcmV2aW91c0RlbGl2ZXJ5ID0gdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLmdldChzdWJzY3JpcHRpb24pXG4gICAgICBjb25zdCBkZWxpdmVyeSA9IHRoaXMud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb25Db250ZXh0cygoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIChwcmV2aW91c0RlbGl2ZXJ5IHx8IFByb21pc2UucmVzb2x2ZSgpKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fZGVsaXZlcldlYnNvY2tldENoYW5uZWxCcm9hZGNhc3Qoc3Vic2NyaXB0aW9uLCBib2R5LCBkZWxpdmVyeU1ldGFkYXRhKSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgYnJvYWRjYXN0VG9DaGFubmVsOiAke25hbWV9IHN1YnNjcmlwdGlvbiAke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH0gZGVsaXZlckJyb2FkY2FzdCB0aHJld2AsIGVycm9yKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5zZXQoc3Vic2NyaXB0aW9uLCBkZWxpdmVyeSlcblxuICAgICAgLy8gS2VlcCB0aGUgZmlyZS1hbmQtZm9yZ2V0IGRlbGl2ZXJ5IChuZXZlciBhd2FpdGVkIGF0IGJyb2FkY2FzdCB0aW1lKSBidXRcbiAgICAgIC8vIHRyYWNrIGl0IHNvIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBjYW4gZHJhaW4gaXQgYmVmb3JlIHNldHRsaW5nLiBSZW1vdmVcbiAgICAgIC8vIG9uIHNldHRsZTsgdGhlIGZhaWx1cmUgaGFuZGxlciBhbHNvIHNhdGlzZmllcyB0aGUgcHJvbWlzZSBzbyBhIHJlamVjdGVkXG4gICAgICAvLyBkZWxpdmVyeSBuZXZlciBiZWNvbWVzIGFuIHVuaGFuZGxlZCByZWplY3Rpb24uXG4gICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMuYWRkKGRlbGl2ZXJ5KVxuXG4gICAgICAvKipcbiAgICAgICAqIFJlbW92ZXMgYSBzZXR0bGVkIGRlbGl2ZXJ5IGZyb20gbG9jYWwgdHJhY2tpbmcuXG4gICAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgICAqL1xuICAgICAgY29uc3QgZm9yZ2V0RGVsaXZlcnkgPSAoKSA9PiB7XG4gICAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcy5kZWxldGUoZGVsaXZlcnkpXG4gICAgICAgIGlmICh0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZ2V0KHN1YnNjcmlwdGlvbikgPT09IGRlbGl2ZXJ5KSB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZGVsZXRlKHN1YnNjcmlwdGlvbilcbiAgICAgIH1cblxuICAgICAgZGVsaXZlcnkudGhlbihmb3JnZXREZWxpdmVyeSwgZm9yZ2V0RGVsaXZlcnkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhIHNuYXBzaG90IG9mIHRoZSBpbi1mbGlnaHQgbG9jYWwgKHBlci1wcm9jZXNzKSB3ZWJzb2NrZXQgY2hhbm5lbFxuICAgKiBicm9hZGNhc3QgZGVsaXZlcmllcy4gQ2FsbGVkIGZyb20gYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGFmdGVyIHRoZSBob3N0XG4gICAqIHB1Ymxpc2ggcXVldWVzIGRyYWluLCBzbyBldmVyeSBkZWxpdmVyeSB0aG9zZSBxdWV1ZXMgbGF1bmNoZWQgaXMgY2FwdHVyZWQuXG4gICAqIE5ldyBkZWxpdmVyaWVzIGVucXVldWVkIGFmdGVyIHRoZSBzbmFwc2hvdCBhcmUgbm90IGF3YWl0ZWQuIEluZGl2aWR1YWxcbiAgICogZGVsaXZlcnkgZXJyb3JzIGFyZSBpc29sYXRlZCBwZXIgc3Vic2NyaWJlciDigJQgdGhlIGRlbGl2ZXJ5IGNoYWluIGFscmVhZHlcbiAgICogbG9ncyB0aGVtIGFuZCByZXNvbHZlcyDigJQgc28gYSBzbmFwc2hvdHRlZCByZWplY3Rpb24gbmV2ZXIgZmFpbHMgdGhpcyBiYXJyaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hd2FpdExvY2FsQnJvYWRjYXN0RGVsaXZlcmllcygpIHtcbiAgICBjb25zdCBzbmFwc2hvdCA9IFsuLi50aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXNdXG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc25hcHNob3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIHdlYnNvY2tldCBjaGFubmVsIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIENoYW5uZWwgc3Vic2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gbWV0YSAtIEJyb2FkY2FzdCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSBCcm9hZGNhc3QgZGVsaXZlcnkgcmVzdWx0LlxuICAgKi9cbiAgX2RlbGl2ZXJXZWJzb2NrZXRDaGFubmVsQnJvYWRjYXN0KHN1YnNjcmlwdGlvbiwgYm9keSwgbWV0YSkge1xuICAgIGlmICh0eXBlb2Ygc3Vic2NyaXB0aW9uLmRlbGl2ZXJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpXG4gICAgfVxuXG4gICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldENoYW5uZWxSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBYmlsaXR5IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IFthcmdzLnJlcXVlc3RdIC0gUmVxdWVzdCBvYmplY3QuIEFic2VudCBmb3Igd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9ucyByZXNvbHZlZCBmcm9tIHN1YnNjcmliZSBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MucmVzcG9uc2VdIC0gUmVzcG9uc2Ugb2JqZWN0LiBBYnNlbnQgb3V0c2lkZSBIVFRQIHJlcXVlc3QgaGFuZGxpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVkIGFiaWxpdHkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQWJpbGl0eSh7cGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0QWJpbGl0eVJlc29sdmVyKClcblxuICAgIGlmIChyZXNvbHZlcikge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlcih7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pXG5cbiAgICAgIGlmIChyZXNvbHZlZCkgcmV0dXJuIHJlc29sdmVkXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VzID0gdGhpcy5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICAgIGlmIChyZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIHJldHVybiBuZXcgQWJpbGl0eSh7XG4gICAgICBjb250ZXh0OiB7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0sXG4gICAgICByZXNvdXJjZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9maWxlcyBhbiBhcHBsaWNhdGlvbi1kZWZpbmVkIHRlc3QgYWN0aXZpdHkgd2hlbiBhbiBvcHQtaW4gdGVzdCBwcm9maWxlXG4gICAqIGNvbnRleHQgaXMgYWN0aXZlLiBUaGUgY2FsbGJhY2sgYWx3YXlzIHJ1bnMsIGluY2x1ZGluZyBvdXRzaWRlIHByb2ZpbGluZy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb3ctY2FyZGluYWxpdHkgYWN0aXZpdHkgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIEFjdGl2aXR5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBwcm9maWxlVGVzdEFjdGl2aXR5KG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgdmFsaWRhdGVkTmFtZSA9IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZShuYW1lKVxuXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFRlc3RQcm9maWxlQ29udGV4dCgpXG5cbiAgICBpZiAoIWNvbnRleHQpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgY29udGV4dC5wcm9maWxlci5wcm9maWxlQWN0aXZpdHkoY29udGV4dCwgdmFsaWRhdGVkTmFtZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGFiaWxpdHkgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudEFiaWxpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudEFiaWxpdHkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgcmVxdWVzdCB0aW1pbmcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgcmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKi9cbiAgZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ3VycmVudCB0ZW5hbnQgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlbmFudCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVuYW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVGVuYW50IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7e2NoYW5uZWw6IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gW2FyZ3Muc3Vic2NyaXB0aW9uXSAtIFN1YnNjcmlwdGlvbiBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVUZW5hbnQoe3BhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2UsIHN1YnNjcmlwdGlvbn0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0VGVuYW50UmVzb2x2ZXIoKVxuXG4gICAgaWYgKCFyZXNvbHZlcikgcmV0dXJuXG5cbiAgICByZXR1cm4gYXdhaXQgcmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIHBhcmFtcyxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIHN1YnNjcmlwdGlvblxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXJyb3IgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiZXZlbnRlbWl0dGVyM1wiKS5FdmVudEVtaXR0ZXJ9IC0gRnJhbWV3b3JrIGVycm9yIGV2ZW50cyBlbWl0dGVyLlxuICAgKi9cbiAgZ2V0RXJyb3JFdmVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgcmVwb3J0ZXIgdGhhdCBjYW4gYWRkIGNsaWVudC1zYWZlIG1ldGFkYXRhIHRvIGZyb250ZW5kLW1vZGVsIGVycm9yIHBheWxvYWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclR5cGV9IHJlcG9ydGVyIC0gUmVwb3J0ZXIgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXIocmVwb3J0ZXIpIHtcbiAgICB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMucHVzaChyZXBvcnRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyZWQgY2xpZW50IGVycm9yIHBheWxvYWQgcmVwb3J0ZXJzLlxuICAgKiBAcGFyYW0ge3tjb250ZXh0OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkQ29udGV4dCwgZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIFJlcG9ydGVyIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWQ+fSAtIE1lcmdlZCBjbGllbnQtc2FmZSByZXBvcnRlciBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgY2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoYXJncykge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICBjb25zdCBkZXRhaWxzID0gcmVxdWVzdERldGFpbHMoYXJncy5yZXF1ZXN0LCB7cmVkYWN0b3I6IHRoaXMuZ2V0TG9nUmVkYWN0b3IoKSwgc2Vuc2l0aXZlVmFsdWVzfSlcblxuICAgIGZvciAoY29uc3QgcmVwb3J0ZXIgb2YgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzKSB7XG4gICAgICBjb25zdCByZXBvcnRlclBheWxvYWQgPSBhd2FpdCByZXBvcnRlcih7XG4gICAgICAgIC4uLmFyZ3MsXG4gICAgICAgIHJlcXVlc3REZXRhaWxzOiBkZXRhaWxzXG4gICAgICB9KVxuXG4gICAgICBpZiAocmVwb3J0ZXJQYXlsb2FkICYmIHR5cGVvZiByZXBvcnRlclBheWxvYWQgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihwYXlsb2FkLCByZXBvcnRlclBheWxvYWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSB0ZXN0IGF0dGVtcHQgaW4gYSByZXZvY2FibGUgZGF0YWJhc2UtYWNjZXNzIGNvbnRleHQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e3Jldm9rZWQ6IGJvb2xlYW59fSBzY29wZSAtIEF0dGVtcHQtb3duZWQgYWNjZXNzIHNjb3BlLlxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF0dGVtcHQgd29yay5cbiAgICogQHJldHVybnMge1QgfCBQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdGVudCBmcmFtZXdvcmsgd29yayB3aXRob3V0IGluaGVyaXRpbmcgYSB0ZXN0IGF0dGVtcHQncyByZXZvY2FibGUgZGF0YWJhc2UtYWNjZXNzIHNjb3BlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBlcnNpc3RlbnQgd29yayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhvdXRDdXJyZW50VGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqIFRocm93cyB3aGVuIGEgdGltZWQtb3V0IHRlc3QgYXR0ZW1wdCB0cmllcyB0byBzdGFydCBtb3JlIGRhdGFiYXNlIHdvcmsuICovXG4gIGFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpIHtcbiAgICB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmFzc2VydFRlc3REYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBjb25uZWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoQ29ubmVjdGlvbnMob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBuYW1lXG4gICAgfSA9IHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgXCJDb25maWd1cmF0aW9uLndpdGhDb25uZWN0aW9uc1wiKVxuXG4gICAgaWYgKCFhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwid2l0aENvbm5lY3Rpb25zIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIC8qKlxuICAgICAqIERicy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIGNvbnN0IGRicyA9IHt9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGJzLFxuICAgICAgaWRlbnRpZmllcnM6IGRhdGFiYXNlSWRlbnRpZmllcnMgPz8gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCksXG4gICAgICBuYW1lLFxuICAgICAgc3RhY2tMYWJlbDogXCJ3aXRoQ29ubmVjdGlvbnNcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBsaWNpdCBtb2RlbCB3b3JrIGluIGEgdHJhbnNhY3Rpb24gcGlubmVkIHRvIG9uZSBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZT86IHN0cmluZ319IG9wdGlvbnMgLSBPcGVyYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHsob3BlcmF0aW9uOiBEYXRhYmFzZU9wZXJhdGlvbikgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhUcmFuc2FjdGlvbih7ZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lID0gXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvblwiLCAuLi5yZXN0QXJnc30sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuICAgIGlmICghdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkuaW5jbHVkZXMoZGF0YWJhc2VJZGVudGlmaWVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9yIGluYWN0aXZlIGRhdGFiYXNlIGlkZW50aWZpZXI6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KClcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhPcGVyYXRpb25Db25uZWN0aW9uKHtuYW1lfSwgYXN5bmMgKGNvbm5lY3Rpb24sIG93bmVyKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICBjb25zdCBvcGVyYXRpb24gPSBuZXcgRGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGNvbmZpZ3VyYXRpb25SZXVzZUtleTogcG9vbC5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pLFxuICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIG93bmVyLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBvcGVyYXRpb24udHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgICAgICB9KVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgb3BlcmF0aW9uLmNvbXBsZXRlKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhwbGljaXQgbW9kZWwgd29yayBvbiBvbmUgY29ubmVjdGlvbiBzZWxlY3RlZCBmcm9tIGEgY2FwdHVyZWQgcGh5c2ljYWxcbiAgICogZGF0YWJhc2UgY29uZmlndXJhdGlvbi4gTm8gYW1iaWVudCB0ZW5hbnQgdmFsdWUgaXMgcmVhZCBkdXJpbmcgY2hlY2tvdXQgb3JcbiAgICogZXhlY3V0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZT86IHN0cmluZywgc2NoZW1hR2VuZXJhdGlvbj86IHN0cmluZywgdGVuYW50Pzogb2JqZWN0fX0gb3B0aW9ucyAtIENhcHR1cmVkIG9wZXJhdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IERhdGFiYXNlT3BlcmF0aW9uKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERhdGFiYXNlT3BlcmF0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgbmFtZSA9IFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb25cIiwgc2NoZW1hR2VuZXJhdGlvbiwgdGVuYW50LCAuLi5yZXN0QXJnc30sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cIilcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBjb25maWd1cmF0aW9uUmV1c2VLZXkgPSBwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG5cbiAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ2FwdHVyZWRPcGVyYXRpb25Db25uZWN0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG5hbWV9LCBhc3luYyAoY29ubmVjdGlvbiwgb3duZXIpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IG5ldyBEYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgY29uZmlndXJhdGlvblJldXNlS2V5LFxuICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIGVuZm9yY2VDdXJyZW50VGVuYW50UmV1c2VLZXk6IGZhbHNlLFxuICAgICAgICBvd25lcixcbiAgICAgICAgc2NoZW1hR2VuZXJhdGlvbixcbiAgICAgICAgdGVuYW50XG4gICAgICB9KVxuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgb3BlcmF0aW9uLmNvbXBsZXRlKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FsbGJhY2sgd2l0aCBkYXRhYmFzZSBjb25uZWN0aW9ucyBmb3IgdGhlIHJlcXVlc3RlZCBpZGVudGlmaWVycy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7Y2FsbGJhY2s6IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiwgZGJzOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0PiwgaWRlbnRpZmllcnM6IHN0cmluZ1tdLCBuYW1lOiBzdHJpbmcsIHN0YWNrTGFiZWw6IHN0cmluZ319IGFyZ3MgLSBDb25uZWN0aW9uIHNjb3BlIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7Y2FsbGJhY2ssIGRicywgaWRlbnRpZmllcnMsIG5hbWUsIHN0YWNrTGFiZWx9KSB7XG4gICAgY29uc3Qgc3RhY2sgPSBFcnJvcigpLnN0YWNrXG4gICAgY29uc3QgYWN0dWFsQ2FsbGJhY2sgPSBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICByZXR1cm4gYXdhaXQgd2l0aFRyYWNrZWRTdGFjayhzdGFjayB8fCBzdGFja0xhYmVsLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYnMpXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1biByZXF1ZXN0LlxuICAgICAqIEB0eXBlIHsoKSA9PiBQcm9taXNlPFQ+fSAqL1xuICAgIGxldCBydW5SZXF1ZXN0ID0gYWN0dWFsQ2FsbGJhY2tcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBpZGVudGlmaWVycykge1xuICAgICAgbGV0IGFjdHVhbFJ1blJlcXVlc3QgPSBydW5SZXF1ZXN0XG5cbiAgICAgIGNvbnN0IG5leHRSdW5SZXF1ZXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikud2l0aENvbm5lY3Rpb24oe25hbWV9LCBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgICBkYnNbaWRlbnRpZmllcl0gPSBkYlxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbFJ1blJlcXVlc3QoKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBydW5SZXF1ZXN0ID0gbmV4dFJ1blJlcXVlc3RcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUmVxdWVzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2RhdGFiYXNlSWRlbnRpZmllcnNdIC0gRGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gaW5jbHVkZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBBIG1hcCBvZiBkYXRhYmFzZSBjb25uZWN0aW9ucyB3aXRoIGlkZW50aWZpZXIgYXMga2V5XG4gICAqL1xuICBnZXRDdXJyZW50Q29ubmVjdGlvbnMoZGF0YWJhc2VJZGVudGlmaWVycyA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIC8qKlxuICAgICAqIERicy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIGNvbnN0IGRicyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGF0YWJhc2VJZGVudGlmaWVycykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9uID0gcG9vbC5nZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24gPyBwb29sLmdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbigpIDogcG9vbC5nZXRDdXJyZW50Q29ubmVjdGlvbigpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRDb25uZWN0aW9uICYmICghcG9vbC5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uIHx8IHBvb2wuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbihjdXJyZW50Q29ubmVjdGlvbikpKSB7XG4gICAgICAgICAgZGJzW2lkZW50aWZpZXJdID0gY3VycmVudENvbm5lY3Rpb25cbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuaXNNaXNzaW5nQ3VycmVudENvbm5lY3Rpb25FcnJvcihlcnJvcikpIHtcbiAgICAgICAgICAvLyBJZ25vcmVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aG91dCBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gd2l0aG91dCBpbmhlcml0ZWQgREIgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoY2FsbGJhY2spIHtcbiAgICBsZXQgcnVuQ2FsbGJhY2sgPSAoKSA9PiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJzKGNhbGxiYWNrKVxuXG4gICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuICAgICAgY29uc3QgcHJldmlvdXNSdW5DYWxsYmFjayA9IHJ1bkNhbGxiYWNrXG5cbiAgICAgIHJ1bkNhbGxiYWNrID0gKCkgPT4gcG9vbC53aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0KHByZXZpb3VzUnVuQ2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bkNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaW5zaWRlIGV2ZXJ5IHBvb2wncyB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIGNvbnRleHQgKGEgbm8tb3AgZm9yXG4gICAqIHBvb2xzIHdpdGhvdXQgb25lKS4gSW4tcHJvY2VzcyByZXF1ZXN0IGhhbmRsaW5nIGlzIHdyYXBwZWQgaW4gdGhpcyBzbyBhIHJlcXVlc3RcbiAgICogcnVucyBvbiB0aGUgc2FtZSBjb25uZWN0aW9uIOKAlCBhbmQgb3BlbiB0cmFuc2FjdGlvbiDigJQgYXMgdGhlIHRlc3QgdGhhdCBpc3N1ZWQgaXQsXG4gICAqIGxldHRpbmcgcmVxdWVzdCBzcGVjcyBjbGVhbiB1cCBieSByb2xsaW5nIGJhY2sgaW5zdGVhZCBvZiB0cnVuY2F0aW5nLiBPdXRzaWRlXG4gICAqIHRlc3RzIG5vIHNoYXJlZCBjb25uZWN0aW9uIGlzIHNldCwgc28gdGhpcyBqdXN0IHJ1bnMgdGhlIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIGluc2lkZSB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGNhbGxiYWNrKSB7XG4gICAgbGV0IHJ1bkNhbGxiYWNrID0gY2FsbGJhY2tcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmICghcG9vbCkgY29udGludWVcbiAgICAgIGNvbnN0IHByZXZpb3VzUnVuQ2FsbGJhY2sgPSBydW5DYWxsYmFja1xuXG4gICAgICBydW5DYWxsYmFjayA9ICgpID0+IHBvb2wucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uKHByZXZpb3VzUnVuQ2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bkNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG1pc3NpbmcgY3VycmVudCBjb25uZWN0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEVycm9yIHRocm93biB3aGlsZSBsb29raW5nIHVwIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGVycm9yIG1lYW5zIG5vIGN1cnJlbnQgY29ubmVjdGlvbiBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBpc01pc3NpbmdDdXJyZW50Q29ubmVjdGlvbkVycm9yKGVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgKFxuICAgICAgZXJyb3IubWVzc2FnZSA9PSBcIklEIGhhc24ndCBiZWVuIHNldCBmb3IgdGhpcyBhc3luYyBjb250ZXh0XCIgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2UgPT0gXCJBIGNvbm5lY3Rpb24gaGFzbid0IGJlZW4gbWFkZSB5ZXRcIiB8fFxuICAgICAgZXJyb3IubWVzc2FnZS5zdGFydHNXaXRoKFwiTm8gYXN5bmMgY29udGV4dCBzZXQgZm9yIGRhdGFiYXNlIGNvbm5lY3Rpb25cIikgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2Uuc3RhcnRzV2l0aChcIkNvbm5lY3Rpb24gXCIpICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJkb2Vzbid0IGV4aXN0IGFueSBtb3JlXCIpXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGNvbm5lY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNvbm5lY3Rpb25zKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBjb25zdCB7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgbmFtZVxuICAgIH0gPSByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIFwiQ29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9uc1wiKVxuXG4gICAgaWYgKCFhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwiZW5zdXJlQ29ubmVjdGlvbnMgcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgcmVxdWVzdGVkSWRlbnRpZmllcnMgPSBkYXRhYmFzZUlkZW50aWZpZXJzID8/IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpXG4gICAgY29uc3QgZGJzID0gdGhpcy5nZXRDdXJyZW50Q29ubmVjdGlvbnMocmVxdWVzdGVkSWRlbnRpZmllcnMpXG4gICAgY29uc3QgbWlzc2luZ0lkZW50aWZpZXJzID0gcmVxdWVzdGVkSWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiB7XG4gICAgICBpZiAoIWRic1tpZGVudGlmaWVyXSkgcmV0dXJuIHRydWVcblxuICAgICAgcmV0dXJuICF0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS5oYXNDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQoKVxuICAgIH0pXG5cbiAgICBpZiAobWlzc2luZ0lkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKGRicylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGJzLFxuICAgICAgaWRlbnRpZmllcnM6IG1pc3NpbmdJZGVudGlmaWVycyxcbiAgICAgIG5hbWUsXG4gICAgICBzdGFja0xhYmVsOiBcImVuc3VyZUNvbm5lY3Rpb25zXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBgYWR2aXNvcnlMb2Nrc2AgY29uZmlndXJhdGlvbiBibG9jayAoU1RDLTIxMCBkZXNpZ24gwqcxMCkuXG4gICAqIEZ1bGwgYmFja3dhcmQgY29tcGF0aWJpbGl0eTogYW4gYXBwIHRoYXQgY29uZmlndXJlcyBub3RoaW5nIGdldHMgdG9kYXknc1xuICAgKiBkcml2ZXItbmF0aXZlLW9ubHkgYmVoYXZpb3Ig4oCUIHRoZSBmaWxlIGJhY2tlbmQgaXMgKipkaXNhYmxlZCBieSBkZWZhdWx0KipcbiAgICogYW5kIG9ubHkgZXZlciBzZWxlY3RhYmxlIGJ5IGV4cGxpY2l0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7YmFja2VuZHM6IHtmaWxlOiB7ZGlyZWN0b3J5Pzogc3RyaW5nLCBlbmFibGVkOiBib29sZWFuLCBsZWFzZU1zOiBudW1iZXIsIHJlbmV3SW50ZXJ2YWxNczogbnVtYmVyfX0sIHBvbGljeTogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3lFbnRyeVtdfX0gLSBBZHZpc29yeS1sb2NrIGNvbmZpZ3VyYXRpb24gd2l0aCBkZWZhdWx0cyBhcHBsaWVkLlxuICAgKi9cbiAgZ2V0QWR2aXNvcnlMb2NrQ29uZmlnKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLl9hZHZpc29yeUxvY2tzIHx8IHt9XG4gICAgY29uc3QgZmlsZUNvbmZpZ3VyZWQgPSBjb25maWd1cmVkLmJhY2tlbmRzPy5maWxlIHx8IHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYmFja2VuZHM6IHtcbiAgICAgICAgZmlsZToge1xuICAgICAgICAgIGRpcmVjdG9yeTogZmlsZUNvbmZpZ3VyZWQuZGlyZWN0b3J5LFxuICAgICAgICAgIGVuYWJsZWQ6IGZpbGVDb25maWd1cmVkLmVuYWJsZWQgPT09IHRydWUsXG4gICAgICAgICAgbGVhc2VNczogdHlwZW9mIGZpbGVDb25maWd1cmVkLmxlYXNlTXMgPT09IFwibnVtYmVyXCIgPyBmaWxlQ29uZmlndXJlZC5sZWFzZU1zIDogMzBfMDAwLFxuICAgICAgICAgIHJlbmV3SW50ZXJ2YWxNczogdHlwZW9mIGZpbGVDb25maWd1cmVkLnJlbmV3SW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiA/IGZpbGVDb25maWd1cmVkLnJlbmV3SW50ZXJ2YWxNcyA6IDEwXzAwMFxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgcG9saWN5OiBBcnJheS5pc0FycmF5KGNvbmZpZ3VyZWQucG9saWN5KSA/IGNvbmZpZ3VyZWQucG9saWN5IDogW11cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYWR2aXNvcnkgbG9jayBwb2xpY3kuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeUVudHJ5W119IC0gUGVyLWxvY2stbmFtZSBiYWNrZW5kIHBvbGljeSBlbnRyaWVzLlxuICAgKi9cbiAgZ2V0QWR2aXNvcnlMb2NrUG9saWN5KCkge1xuICAgIHJldHVybiB0aGlzLmdldEFkdmlzb3J5TG9ja0NvbmZpZygpLnBvbGljeVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlZmZlY3RpdmUgYmFja2VuZCBwb2xpY3kgZm9yIG9uZSBsb2NrIG5hbWUgKGRlc2lnbiDCpzUpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9ja05hbWUgLSBDb25jcmV0ZSBsb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuUmVzb2x2ZWRBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5fSAtIFJlc29sdmVkIHBvbGljeS5cbiAgICovXG4gIHJlc29sdmVBZHZpc29yeUxvY2tQb2xpY3kobG9ja05hbWUpIHtcbiAgICByZXR1cm4gcmVzb2x2ZUFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3kobG9ja05hbWUsIHRoaXMuZ2V0QWR2aXNvcnlMb2NrUG9saWN5KCkpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZmlsZS10aWVyIGFkdmlzb3J5LWxvY2sgYmFja2VuZCB3aGVuIHRoaXMgZGVwbG95bWVudCBoYXNcbiAgICogZXhwbGljaXRseSBlbmFibGVkIGl0IChgYWR2aXNvcnlMb2Nrcy5iYWNrZW5kcy5maWxlLmVuYWJsZWQ6IHRydWVgKSxcbiAgICogY3JlYXRpbmcgaXQgb24gZmlyc3QgdXNlLiBSZXR1cm5zIGB1bmRlZmluZWRgIHdoZW4gdGhlIHRpZXIgaXMgZGlzYWJsZWRcbiAgICogKHRoZSBkZWZhdWx0KSDigJQgY2FsbGVycyBtdXN0IG5ldmVyIGZhbGwgYmFjayB0byBpdCBpbXBsaWNpdGx5LiBDcmVhdGlvblxuICAgKiBnb2VzIHRocm91Z2ggdGhlIGVudmlyb25tZW50IGhhbmRsZXIgc28gYnJvd3Nlci9FeHBvIGNvbmZpZ3VyYXRpb25zXG4gICAqIHdpdGhvdXQgYGZzYCBmYWlsIGxvdWRseSBpbnN0ZWFkIG9mIGhhbGYtd29ya2luZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBlbmFibGVkIGZpbGUgYmFja2VuZCwgb3IgdW5kZWZpbmVkLlxuICAgKi9cbiAgYXN5bmMgZ2V0QWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQoKSB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRBZHZpc29yeUxvY2tDb25maWcoKVxuXG4gICAgaWYgKCFjb25maWcuYmFja2VuZHMuZmlsZS5lbmFibGVkKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgaWYgKHRoaXMuX2Fkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKSByZXR1cm4gdGhpcy5fYWR2aXNvcnlMb2NrRmlsZUJhY2tlbmRcblxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IGNvbmZpZy5iYWNrZW5kcy5maWxlLmRpcmVjdG9yeSB8fCBgJHt0aGlzLmdldERpcmVjdG9yeSgpfS90bXAvYWR2aXNvcnktbG9ja3NgXG5cbiAgICB0aGlzLl9hZHZpc29yeUxvY2tGaWxlQmFja2VuZCA9IGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuY3JlYXRlQWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQoe1xuICAgICAgZGlyZWN0b3J5LFxuICAgICAgbGVhc2VNczogY29uZmlnLmJhY2tlbmRzLmZpbGUubGVhc2VNcyxcbiAgICAgIHJlbmV3SW50ZXJ2YWxNczogY29uZmlnLmJhY2tlbmRzLmZpbGUucmVuZXdJbnRlcnZhbE1zXG4gICAgfSlcblxuICAgIHJldHVybiB0aGlzLl9hZHZpc29yeUxvY2tGaWxlQmFja2VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgd2hpY2ggYmFja2VuZCB0aWVyIHNlcnZlZCBvbmUgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbiBzb1xuICAgKiBgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cygpYCBjYW4gYW5zd2VyIFwid2hpY2ggYmFja2VuZCBzZXJ2ZWQgdGhpc1xuICAgKiBsb2NrXCIgKGRlc2lnbiDCpzMpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFjcXVpc2l0aW9uIHJlY29yZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubG9ja05hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXJ9IGFyZ3MuYmFja2VuZCAtIFRpZXIgdGhhdCBzZXJ2ZWQgdGhlIGFjcXVpc2l0aW9uLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuZmVuY2luZ1N1cHBvcnRlZCAtIFdoZXRoZXIgdGhlIHNlcnZpbmcgdGllciBjYXJyaWVzIGZlbmNpbmcgdG9rZW5zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEFkdmlzb3J5TG9ja0FjcXVpc2l0aW9uKHtsb2NrTmFtZSwgYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZH0pIHtcbiAgICB0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXNpdGlvbnMuc2V0KGxvY2tOYW1lLCB7YmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZCwgc2VydmVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKX0pXG4gIH1cblxuICAvKipcbiAgICogVGhlIFwid2hpY2ggYmFja2VuZCBzZXJ2ZWQgdGhpcyBsb2NrXCIgZGlhZ25vc3RpY3Mgc3VyZmFjZSAoZGVzaWduIMKnMyk6XG4gICAqIHBlciBsb2NrIG5hbWUsIHRoZSB0aWVyIG9mIHRoZSBtb3N0IHJlY2VudCBhY3F1aXNpdGlvbiwgd2hldGhlciB0aGF0IHRpZXJcbiAgICogY2FycmllcyBmZW5jaW5nIHRva2VucywgYW5kIHRoZSByZXNvbHZlZCBwb2xpY3kgKG1pbmltdW0vYWxsb3dlZC9wcmVmZXJyZWRcbiAgICogdGllcnMpIGZvciB0aGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tOYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2FjcXVpc2l0aW9uOiB7YmFja2VuZDogaW1wb3J0KFwiLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXIsIGZlbmNpbmdTdXBwb3J0ZWQ6IGJvb2xlYW4sIHNlcnZlZEF0OiBzdHJpbmd9IHwgbnVsbCwgcG9saWN5OiBpbXBvcnQoXCIuL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuUmVzb2x2ZWRBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5fX0gLSBCYWNrZW5kIHN0YXR1cyBmb3IgdGhlIG5hbWUuXG4gICAqL1xuICBnZXRBZHZpc29yeUxvY2tCYWNrZW5kU3RhdHVzKGxvY2tOYW1lKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjcXVpc2l0aW9uOiB0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXNpdGlvbnMuZ2V0KGxvY2tOYW1lKSA/PyBudWxsLFxuICAgICAgcG9saWN5OiB0aGlzLnJlc29sdmVBZHZpc29yeUxvY2tQb2xpY3kobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGRlZGljYXRlZCBjb25uZWN0aW9uIHRoYXQgY3VycmVudGx5IGhvbGRzIGFuIGFkdmlzb3J5IGxvY2ssIHNvIGFcbiAgICogc2h1dGRvd24gY2FuIGNsb3NlIGl0IGFuZCByZWxlYXNlIHRoZSBsb2NrLiBTZWUgYF9hZHZpc29yeUxvY2tDb25uZWN0aW9uc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuYWRkKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uIG9uY2UgaXRzIGxvY2sgc2NvcGUgZW5kcyBhbmQgdGhlXG4gICAqIGNvbm5lY3Rpb24gaGFzIGJlZW4gKG9yIGlzIGFib3V0IHRvIGJlKSBjbG9zZWQgYnkgaXRzIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBUaGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB1bnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGV2ZXJ5IHJlZ2lzdGVyZWQgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiwgZW5kaW5nIGl0cyBzZXNzaW9uIHNvXG4gICAqIHRoZSBEQiBzZXJ2ZXIgcmVsZWFzZXMgdGhlIGxvY2suIEV2ZXJ5IGNvbm5lY3Rpb24gaXMgYXR0ZW1wdGVkIGJlZm9yZSBhbnkgZmFpbHVyZVxuICAgKiBpcyBzdXJmYWNlZCwgc28gb25lIHN0dWNrIGNsb3NlIGRvZXMgbm90IGxlYXZlIHRoZSBvdGhlcnMnIGxvY2tzIGhlbGQ7IGEgZmFpbHVyZSBpc1xuICAgKiB0aGVuIHRocm93biAobmV2ZXIgc3dhbGxvd2VkKSwgYWdncmVnYXRlZCB3aGVuIG1vcmUgdGhhbiBvbmUgY29ubmVjdGlvbiBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgYWxsIGhhdmUgYmVlbiBjbG9zZWQ7IHJlamVjdHMgaWYgYW55IGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zXVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuY2xlYXIoKVxuXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBjb25uZWN0aW9ucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFjdGl2ZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBhbmQgY2xlYXJzIGdsb2JhbCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbnN0cnVjdG9ycyA9IG5ldyBTZXQoKVxuXG4gICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgICBjb25zdCBjbG9zZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gQ2xvc2UgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgZmlyc3Q6IHRoZXkgYXJlIHNwYXduZWQgb3V0c2lkZSB0aGVcbiAgICAgICAgICAvLyBwb29scycgdHJhY2tlZCBzZXRzLCBzbyBgcG9vbC5jbG9zZUFsbCgpYCB3b3VsZCBub3QgcmVhY2ggdGhlbSBhbmQgYSBsb2NrIGhlbGRcbiAgICAgICAgICAvLyBieSBhIHJ1bm5lciB0b3JuIGRvd24gbWlkLXBhc3Mgd291bGQgbGVhayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuXG4gICAgICAgICAgLy8gU3RpbGwgY2xvc2UgdGhlIHBvb2xzIGlmIHRoaXMgdGhyb3dzLCBzbyBhIHN0dWNrIGxvY2sgY29ubmVjdGlvbiBkb2VzIG5vdFxuICAgICAgICAgIC8vIGxlYXZlIHRoZSByZXN0IG9mIHRoZSBjb25uZWN0aW9ucyBvcGVuLlxuICAgICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMoKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBSZWxlYXNlIGZpbGUtdGllciBhZHZpc29yeS1sb2NrIGhvbGRzIGV4cGxpY2l0bHkgKFNUQy0yMTMpOiB0aGVcbiAgICAgICAgICAgIC8vIGxlYXNlIHdvdWxkIG1ha2UgdGhlbSByZWNsYWltYWJsZSBhbnl3YXksIGJ1dCBhIGNsZWFuIHNodXRkb3duXG4gICAgICAgICAgICAvLyBzaG91bGQgbm90IGxlYXZlIGxvY2sgZGlyZWN0b3JpZXMgYmVoaW5kIGZvciB0aGUgc3RhbGVuZXNzIHBhdGguXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9hZHZpc29yeUxvY2tGaWxlQmFja2VuZD8ucmVsZWFzZUFsbEhlbGQoKVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICAgICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG5cbiAgICAgICAgICAgIGF3YWl0IHBvb2wuY2xvc2VBbGwoKVxuXG4gICAgICAgICAgICBjb25zdCBQb29sQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAqLyAocG9vbC5jb25zdHJ1Y3RvcilcbiAgICAgICAgICAgIGNvbnN0cnVjdG9ycy5hZGQoUG9vbENsYXNzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGZvciAoY29uc3QgUG9vbENsYXNzIG9mIGNvbnN0cnVjdG9ycykge1xuICAgICAgICAgICAgUG9vbENsYXNzLmNsZWFyR2xvYmFsQ29ubmVjdGlvbnModGhpcylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZS5yZXNldCgpXG5cbiAgICAgICAgICAvLyBBbGxvdyBmdWxsIHJlLWluaXRpYWxpemF0aW9uIGFmdGVyIGNvbm5lY3Rpb25zIGFyZSBjbG9zZWQuXG4gICAgICAgICAgdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gKz0gMVxuICAgICAgICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGNsb3NlRXJyb3JzWzBdXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGNsb3NlRXJyb3JzLCBcIkZhaWxlZCB0byBjbG9zZSBiYWNrZ3JvdW5kLWpvYnMgYW5kIGRhdGFiYXNlIHJlc291cmNlc1wiKVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgcmVxdWVzdCBhdXRob3JpemVkLlxuICAgKiBAcGFyYW0ge3toZWFkZXI6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9fSByZXF1ZXN0IC0gSW5jb21pbmcgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4cGVjdGVkVG9rZW4gLSBDb25maWd1cmVkIGRlYnVnLWVuZHBvaW50IHRva2VuLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0IGNhcnJpZXMgdGhlIGV4cGVjdGVkIGJlYXJlciB0b2tlbi5cbiAgICovXG4gIGRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCBleHBlY3RlZFRva2VuKSB7XG4gICAgY29uc3QgaGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJhdXRob3JpemF0aW9uXCIpXG5cbiAgICBpZiAodHlwZW9mIGhlYWRlciAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBtYXRjaCA9ICgvXkJlYXJlclxccysoLispJC9pKS5leGVjKGhlYWRlci50cmltKCkpXG5cbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmRlYnVnRW5kcG9pbnRUb2tlbk1hdGNoZXMobWF0Y2hbMV0sIGV4cGVjdGVkVG9rZW4pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXBpIG1hbmlmZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj59IC0gQVBJIG1hbmlmZXN0IGZvciBhbGwgcmVnaXN0ZXJlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBnZXRBcGlNYW5pZmVzdCgpIHtcbiAgICByZXR1cm4gZnJvbnRlbmRNb2RlbEFwaU1hbmlmZXN0KHRoaXMuX2JhY2tlbmRQcm9qZWN0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXRoZXIgQVBJIG1hbmlmZXN0IGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIEFQSSBtYW5pZmVzdCBlbmRwb2ludCBpcyBlbmFibGVkLlxuICAgKi9cbiAgX2FwaU1hbmlmZXN0RW5hYmxlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fYXBpTWFuaWZlc3QuZW5hYmxlZFxuICB9XG59XG4iXX0=