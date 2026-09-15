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
    constructor({ abilityResolver, abilityResources, attachments, autoload = true, backgroundJobs, backendProjects, beacon, cookieSecret, cors, database, debug = false, debugEndpoint = false, apiManifest = false, directory, enforceTenantDatabaseScopes = true, environment, environmentHandler, exposeInternalErrorsToClients, frontendTenantSqlite, httpServer, initializeModels, initializers, locale, localeFallbacks, locales, logging, mailerBackend, packages, requestTimeoutMs, routeResolverHooks, scheduledBackgroundJobs, secureFrontendModelErrors, structureSql, sync, tenantDatabaseProviders, tenantDatabaseResolver, tenantResolver, testing, timeZone, timezoneOffsetMinutes, trustedProxies, websocketChannelResolver, websocketMessageHandlerResolver, ...restArgs }) {
        restArgsError(restArgs);
        this._abilityResolver = abilityResolver;
        this._abilityResources = abilityResources || [];
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
        const websocketInboundQueue = httpServer?.websocketInboundQueue;
        const websocketOutboundQueue = httpServer?.websocketOutboundQueue;
        this.httpServer = {
            ...(httpServer || {}),
            compression: normalizeHttpCompression(httpServer?.compression),
            maxBufferedResponseBodyBytes: optionalPositiveSafeInteger(httpServer?.maxBufferedResponseBodyBytes, "httpServer.maxBufferedResponseBodyBytes"),
            maxRequestBodyBytes: optionalPositiveSafeInteger(httpServer?.maxRequestBodyBytes, "httpServer.maxRequestBodyBytes"),
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
     * @returns {import("./configuration-types.js").VelociousSyncClientConfiguration | undefined} - Normalized client-side sync configuration.
     */
    _normalizeSyncClientConfiguration(client) {
        if (client === undefined || client === null)
            return undefined;
        if (typeof client !== "object" || Array.isArray(client)) {
            throw new Error("sync.client must be an object with transport and authenticationToken");
        }
        const { authenticationToken, batchSize, isOnline, mountPath, onError, realtime, transport, websocketClient, websocketUrl, ...restClient } = client;
        const restClientKeys = Object.keys(restClient);
        if (restClientKeys.length > 0) {
            throw new Error(`sync.client received unknown keys: ${restClientKeys.join(", ")} (supported: authenticationToken, batchSize, isOnline, mountPath, onError, realtime, transport, websocketClient, websocketUrl)`);
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
            onError,
            realtime,
            transport,
            websocketClient,
            websocketUrl
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
        const dispatchStrategyRaw = configured.dispatchStrategy || envDispatchStrategy;
        const dispatchStrategy = dispatchStrategyRaw === "polling" ? "polling" : "beacon";
        const pollIntervalMs = typeof configured.pollIntervalMs === "number" && configured.pollIntervalMs >= 1
            ? configured.pollIntervalMs
            : (typeof envPollInterval === "number" && Number.isFinite(envPollInterval) && envPollInterval >= 1 ? envPollInterval : 1000);
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
        return { host, port, databaseIdentifier, maxConcurrentForkedJobs, maxConcurrentInlineJobs, mode, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, dispatchStrategy, pollIntervalMs, queues, jobClasses, jobTimeoutMs, retention, generationId, initialGenerationState, lifecycleSocketPath };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFBYSxNQUFNLDRCQUE0QixDQUFBO0FBQ3RELE9BQU8sRUFBRSx3QkFBd0IsRUFB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TSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUE7UUFFdEQsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUV4QixPQUFPLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLHlCQUF5QixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxhQUFhLENBQUMsQ0FBQTtJQUN4RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGNBQWM7UUFDbEIsT0FBTyx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtJQUN4RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsbUJBQW1CO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUE7SUFDbEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlIHR5cGUuXG4gKiBAdGVtcGxhdGUgVFxuICogQHR5cGVkZWYgeyhhcmc6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+KSA9PiBQcm9taXNlPFQ+fSBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gV2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFtkYXRhYmFzZUlkZW50aWZpZXJzXSAtIERhdGFiYXNlIGlkZW50aWZpZXJzIHRvIGluY2x1ZGUgaW4gdGhlIGNvbm5lY3Rpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNoZWNrZWQtb3V0IGRhdGFiYXNlIGNvbm5lY3Rpb25zLlxuICovXG4vKipcbiAqIE9uZSBhZGFwdGVyIGluc3RhbmNlIGFuZCBpdHMgc2VyaWFsaXplZCByZWFkeS9jbG9zZSBsaWZlY3ljbGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXIuanNcIikuZGVmYXVsdH0gYWRhcHRlciAtIEFkYXB0ZXIgb3duZWQgYnkgdGhpcyBnZW5lcmF0aW9uLlxuICogQHByb3BlcnR5IHtib29sZWFufSBjbG9zaW5nIC0gV2hldGhlciBjbG9zZSBoYXMgY2xhaW1lZCB0aGlzIGdlbmVyYXRpb24uXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IHJlYWR5UHJvbWlzZSAtIFNoYXJlZCByZWFkaW5lc3MgYXR0ZW1wdC5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gY2xvc2VQcm9taXNlIC0gU2hhcmVkIGNsb3NlIG9wZXJhdGlvbi5cbiAqL1xuXG5pbXBvcnQgeyBkaWdnIH0gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgZ2V0dGV4dENvbmZpZyBmcm9tIFwiZ2V0dGV4dC11bml2ZXJzYWwvYnVpbGQvc3JjL2NvbmZpZy5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCB0cmFuc2xhdGUgZnJvbSBcImdldHRleHQtdW5pdmVyc2FsL2J1aWxkL3NyYy90cmFuc2xhdGUuanNcIlxuaW1wb3J0IEFiaWxpdHkgZnJvbSBcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXIuanNcIlxuaW1wb3J0IERhdGFiYXNlT3BlcmF0aW9uIGZyb20gXCIuL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiXG5pbXBvcnQgeyBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyB9IGZyb20gXCIuL2RhdGFiYXNlL3JlY29yZC9hdWRpdGluZy5qc1wiXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyBmcm9tIFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpYmVycy5qc1wiXG5pbXBvcnQgeyBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yLCBjdXJyZW50Q29uZmlndXJhdGlvbiwgc2V0Q3VycmVudENvbmZpZ3VyYXRpb24gfSBmcm9tIFwiLi9jdXJyZW50LWNvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IHsgcmVxdWVzdERldGFpbHMgfSBmcm9tIFwiLi9lcnJvci1yZXBvcnRpbmcvcmVxdWVzdC1kZXRhaWxzLmpzXCJcbmltcG9ydCBMb2dSZWRhY3RvciBmcm9tIFwiLi9sb2ctcmVkYWN0b3IuanNcIlxuaW1wb3J0IHsgZnJvbnRlbmRNb2RlbEFwaU1hbmlmZXN0LCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24sIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdCB9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7IGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5LCBub3JtYWxpemVPZmZsaW5lR3JhbnRTaWduaW5nS2V5IH0gZnJvbSBcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCJcbmltcG9ydCBQbHVnaW5Sb3V0ZXMgZnJvbSBcIi4vcm91dGVzL3BsdWdpbi1yb3V0ZXMuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZSB9IGZyb20gXCIuL3Rlc3RpbmcvdGVzdC1wcm9maWxlLWFjdGl2aXR5LmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGltZVpvbmUgfSBmcm9tIFwiLi90aW1lLXpvbmUuanNcIlxuaW1wb3J0IHsgd2l0aFRyYWNrZWRTdGFjayB9IGZyb20gXCIuL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzUGFja2FnZSBmcm9tIFwiLi9wYWNrYWdlcy92ZWxvY2lvdXMtcGFja2FnZS5qc1wiXG5pbXBvcnQgRnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgZnJvbSBcIi4vdGVuYW50cy9mcm9udGVuZC10ZW5hbnQtc3FsaXRlLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgeyByZXNvbHZlR2VuZXJhdGlvbklkLCByZXNvbHZlSW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgcmVzb2x2ZUxpZmVjeWNsZVNvY2tldFBhdGggfSBmcm9tIFwiLi9iYWNrZ3JvdW5kLWpvYnMvZ2VuZXJhdGlvbi1pZGVudGl0eS5qc1wiXG5pbXBvcnQgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcblxuZXhwb3J0IHsgQ3VycmVudENvbmZpZ3VyYXRpb25Ob3RTZXRFcnJvciB9XG5cbi8qKlxuICogUnVucyBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5LlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5IHdoZW4gdGhlIHJ1bnRpbWUgZXhwb3NlcyBvbmUuXG4gKi9cbmZ1bmN0aW9uIGN1cnJlbnRXb3JraW5nRGlyZWN0b3J5KCkge1xuICBjb25zdCBwcm9jZXNzT2JqZWN0ID0gLyoqIEB0eXBlIHt7Y3dkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHwgdW5kZWZpbmVkfSAqLyAoZ2xvYmFsVGhpcy5wcm9jZXNzKVxuXG4gIGlmICh0eXBlb2YgcHJvY2Vzc09iamVjdD8uY3dkICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiB1bmRlZmluZWRcblxuICByZXR1cm4gcHJvY2Vzc09iamVjdC5jd2QoKVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBvdmVybG9hZGVkIHdpdGgvZW5zdXJlIGNvbm5lY3Rpb25zIGFyZ3VtZW50cy5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiB8IHVuZGVmaW5lZH0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkZWZhdWx0TmFtZSAtIERlZmF1bHQgY2hlY2tvdXQgbmFtZS5cbiAqIEByZXR1cm5zIHt7ZGF0YWJhc2VJZGVudGlmaWVyczogc3RyaW5nW10gfCB1bmRlZmluZWQsIG5hbWU6IHN0cmluZywgY2FsbGJhY2s6IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiB8IHVuZGVmaW5lZH19IFJlc29sdmVkIGNoZWNrb3V0IG9wdGlvbnMgYW5kIGNhbGxiYWNrLlxuICovXG5mdW5jdGlvbiByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIGRlZmF1bHROYW1lKSB7XG4gIGlmICh0eXBlb2Ygb3B0aW9uc09yQ2FsbGJhY2sgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgY29uc3QgYWN0dWFsQ2FsbGJhY2sgPSAvKiogQHR5cGUge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gKi8gKG9wdGlvbnNPckNhbGxiYWNrKVxuXG4gICAgcmV0dXJuIHtkYXRhYmFzZUlkZW50aWZpZXJzOiB1bmRlZmluZWQsIG5hbWU6IGRlZmF1bHROYW1lLCBjYWxsYmFjazogYWN0dWFsQ2FsbGJhY2t9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRhdGFiYXNlSWRlbnRpZmllcnM6IG9wdGlvbnNPckNhbGxiYWNrLmRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgbmFtZTogb3B0aW9uc09yQ2FsbGJhY2submFtZSB8fCBkZWZhdWx0TmFtZSxcbiAgICBjYWxsYmFja1xuICB9XG59XG5cbi8qKlxuICogUnVucyBjYW5vbmljYWwgZGVidWcgc25hcHNob3QgdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNuYXBzaG90IHZhbHVlIHRvIGNhbm9uaWNhbGl6ZS5cbiAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gU25hcHNob3QgdmFsdWUgd2l0aCBvYmplY3Qga2V5cyBzb3J0ZWQgcmVjdXJzaXZlbHkuXG4gKi9cbmZ1bmN0aW9uIGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZSh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHZhbHVlXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLm1hcCgoZW50cnkpID0+IGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZShlbnRyeSkpXG5cbiAgcmV0dXJuIE9iamVjdC5rZXlzKHZhbHVlKS5zb3J0KCkucmVkdWNlKChyZXN1bHQsIGtleSkgPT4ge1xuICAgIHJlc3VsdFtrZXldID0gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpW2tleV0pXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9LCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHt9KSlcbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBCYXNlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlIHwgUGFydGlhbDxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZT4gfCB2b2lkfSBvdmVycmlkZUNvbmZpZ3VyYXRpb24gLSBUZW5hbnQgb3ZlcnJpZGUgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gLSBNZXJnZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbWVyZ2VEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCBvdmVycmlkZUNvbmZpZ3VyYXRpb24pIHtcbiAgaWYgKCFvdmVycmlkZUNvbmZpZ3VyYXRpb24pIHJldHVybiBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cblxuICByZXR1cm4ge1xuICAgIC4uLmRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAuLi5vdmVycmlkZUNvbmZpZ3VyYXRpb24sXG4gICAgcmVjb3JkOiB7XG4gICAgICAuLi4oZGF0YWJhc2VDb25maWd1cmF0aW9uLnJlY29yZCB8fCB7fSksXG4gICAgICAuLi4ob3ZlcnJpZGVDb25maWd1cmF0aW9uLnJlY29yZCB8fCB7fSlcbiAgICB9LFxuICAgIHNxbENvbmZpZzoge1xuICAgICAgLi4uKGRhdGFiYXNlQ29uZmlndXJhdGlvbi5zcWxDb25maWcgfHwge30pLFxuICAgICAgLi4uKG92ZXJyaWRlQ29uZmlndXJhdGlvbi5zcWxDb25maWcgfHwge30pXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGdyYWNlIHdpbmRvdyAobXMpIGJlZm9yZSBhIHN1c3RhaW5lZCBiZWFjb24gb3V0YWdlIGlzIHJlcG9ydGVkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIGB1bnJlYWNoYWJsZVJlcG9ydE1zYCwgaWYgYW55LlxuICogQHJldHVybnMge251bWJlcn0gLSBUaGUgY29uZmlndXJlZCB2YWx1ZSB3aGVuIGl0J3MgYSBmaW5pdGUgbnVtYmVyLCBvdGhlcndpc2UgdGhlIDMwcyBkZWZhdWx0LlxuICovXG5mdW5jdGlvbiByZXNvbHZlQmVhY29uVW5yZWFjaGFibGVSZXBvcnRNcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gIHJldHVybiAzMF8wMDBcbn1cblxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19CWVRFUyA9IDE2ICogMTAyNCAqIDEwMjRcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfTUVTU0FHRVMgPSAyNTZcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0JZVEVTID0gMTYgKiAxMDI0ICogMTAyNFxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfRlJBTUVTID0gMjU2XG5cbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xEID0gMTAyNFxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSA9IDRcbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTCA9IDZcblxuLyoqXG4gKiBWYWxpZGF0ZXMgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXIgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBwb3NpdGl2ZSBzYWZlIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbmZpZ3VyYXRpb24ga2V5LlxuICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRWYWx1ZSAtIERlZmF1bHQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkYXRlZCBjb25maWd1cmVkIG9yIGRlZmF1bHQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlU2FmZUludGVnZXIodmFsdWUsIG5hbWUsIGRlZmF1bHRWYWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGRlZmF1bHRWYWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlcmApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW4gb3B0aW9uYWwgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG9wdGlvbmFsUG9zaXRpdmVTYWZlSW50ZWdlcih2YWx1ZSwgbmFtZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZFxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlcmApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW4gaW50ZWdlciBjb25maWd1cmF0aW9uIHZhbHVlIGluc2lkZSBhbiBpbmNsdXNpdmUgcmFuZ2UuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29uZmlndXJhdGlvbiBrZXkuXG4gKiBAcGFyYW0ge251bWJlcn0gbWluIC0gTWluaW11bSBhY2NlcHRlZCB2YWx1ZSAoaW5jbHVzaXZlKS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtYXggLSBNYXhpbXVtIGFjY2VwdGVkIHZhbHVlIChpbmNsdXNpdmUpLlxuICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRWYWx1ZSAtIERlZmF1bHQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkYXRlZCBjb25maWd1cmVkIG9yIGRlZmF1bHQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGludGVnZXJJblJhbmdlKHZhbHVlLCBuYW1lLCBtaW4sIG1heCwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgbWluIHx8IHZhbHVlID4gbWF4KSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgJHtuYW1lfSBtdXN0IGJlIGFuIGludGVnZXIgYmV0d2VlbiAke21pbn0gYW5kICR7bWF4fWApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHRoZSBidWZmZXJlZCBIVFRQIHJlc3BvbnNlIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uIENvbXByZXNzaW9uIGlzXG4gKiBlbmFibGVkIGJ5IGRlZmF1bHQgd2hlbiB0aGUgc2V0dGluZyBpcyBhYnNlbnQ7IGBmYWxzZWAgb3IgYHtlbmFibGVkOiBmYWxzZX1gXG4gKiBkaXNhYmxlcyBpdCBnbG9iYWxseS5cbiAqIEBwYXJhbSB7Ym9vbGVhbiB8IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5IdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENvbmZpZ3VyZWQgY29tcHJlc3Npb24gdmFsdWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplSHR0cENvbXByZXNzaW9uKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSB0cnVlKSB7XG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCB0aHJlc2hvbGQ6IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xELCBicm90bGlRdWFsaXR5OiBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZLCBnemlwTGV2ZWw6IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTH1cbiAgfVxuXG4gIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCB0aHJlc2hvbGQ6IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xELCBicm90bGlRdWFsaXR5OiBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZLCBnemlwTGV2ZWw6IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTH1cbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uIG11c3QgYmUgYSBib29sZWFuIG9yIGFuIG9iamVjdCwgZ290OiAke1N0cmluZyh2YWx1ZSl9YClcbiAgfVxuXG4gIGNvbnN0IHticm90bGlRdWFsaXR5LCBlbmFibGVkLCBnemlwTGV2ZWwsIHRocmVzaG9sZCwgLi4ucmVzdENvbXByZXNzaW9ufSA9IHZhbHVlXG4gIGNvbnN0IHJlc3RDb21wcmVzc2lvbktleXMgPSBPYmplY3Qua2V5cyhyZXN0Q29tcHJlc3Npb24pXG5cbiAgaWYgKHJlc3RDb21wcmVzc2lvbktleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24gcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RDb21wcmVzc2lvbktleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBicm90bGlRdWFsaXR5LCBlbmFibGVkLCBnemlwTGV2ZWwsIHRocmVzaG9sZClgKVxuICB9XG5cbiAgaWYgKGVuYWJsZWQgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZW5hYmxlZCAhPT0gXCJib29sZWFuXCIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uLmVuYWJsZWQgbXVzdCBiZSBhIGJvb2xlYW4sIGdvdDogJHtTdHJpbmcoZW5hYmxlZCl9YClcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogZW5hYmxlZCA/PyB0cnVlLFxuICAgIHRocmVzaG9sZDogcG9zaXRpdmVTYWZlSW50ZWdlcih0aHJlc2hvbGQsIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi50aHJlc2hvbGRcIiwgREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQpLFxuICAgIGJyb3RsaVF1YWxpdHk6IGludGVnZXJJblJhbmdlKGJyb3RsaVF1YWxpdHksIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi5icm90bGlRdWFsaXR5XCIsIDAsIDExLCBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZKSxcbiAgICBnemlwTGV2ZWw6IGludGVnZXJJblJhbmdlKGd6aXBMZXZlbCwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLmd6aXBMZXZlbFwiLCAwLCA5LCBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUwpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ29uZmlndXJhdGlvbiB7XG4gIC8qKlxuICAgKiBDbG9zZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBwcm9taXNlLlxuICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gIF9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlID0gbnVsbFxuXG4gIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgY3VycmVudGx5IGhvbGRpbmcgYSBsb2NrLiBUaGVzZSBhcmUgc3Bhd25lZFxuICAgKiBvdXRzaWRlIHRoZSBwb29scycgdHJhY2tlZCBzZXRzIChzbyBhIGhvbGQtdGltZW91dCBsb2NrIHN1cnZpdmVzIHBvb2wgY2hlY2tvdXRzKSxcbiAgICogc28gYGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc2Agd291bGQgb3RoZXJ3aXNlIHdhbGsgcGFzdCB0aGVtOyB0cmFja2luZyB0aGVtIGhlcmVcbiAgICogbGV0cyBhIHNodXRkb3duIGNsb3NlIHRoZW0gYW5kIHJlbGVhc2UgdGhlIGxvY2sgaW5zdGVhZCBvZiBvcnBoYW5pbmcgaXQuXG4gICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gIF9hZHZpc29yeUxvY2tDb25uZWN0aW9ucyA9IG5ldyBTZXQoKVxuXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgX3NjaGVtYUNhY2hlR2VuZXJhdGlvbnNCeVJldXNlS2V5ID0gbmV3IE1hcCgpXG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0NvbmZpZ3VyYXRpb259IC0gVGhlIGN1cnJlbnQuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudCgpIHtcbiAgICByZXR1cm4gY3VycmVudENvbmZpZ3VyYXRpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNvbmZpZ3VyYXRpb25BcmdzVHlwZX0gYXJncyAtIENvbmZpZ3VyYXRpb24gYXJndW1lbnRzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FiaWxpdHlSZXNvbHZlciwgYWJpbGl0eVJlc291cmNlcywgYXR0YWNobWVudHMsIGF1dG9sb2FkID0gdHJ1ZSwgYmFja2dyb3VuZEpvYnMsIGJhY2tlbmRQcm9qZWN0cywgYmVhY29uLCBjb29raWVTZWNyZXQsIGNvcnMsIGRhdGFiYXNlLCBkZWJ1ZyA9IGZhbHNlLCBkZWJ1Z0VuZHBvaW50ID0gZmFsc2UsIGFwaU1hbmlmZXN0ID0gZmFsc2UsIGRpcmVjdG9yeSwgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gdHJ1ZSwgZW52aXJvbm1lbnQsIGVudmlyb25tZW50SGFuZGxlciwgZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMsIGZyb250ZW5kVGVuYW50U3FsaXRlLCBodHRwU2VydmVyLCBpbml0aWFsaXplTW9kZWxzLCBpbml0aWFsaXplcnMsIGxvY2FsZSwgbG9jYWxlRmFsbGJhY2tzLCBsb2NhbGVzLCBsb2dnaW5nLCBtYWlsZXJCYWNrZW5kLCBwYWNrYWdlcywgcmVxdWVzdFRpbWVvdXRNcywgcm91dGVSZXNvbHZlckhvb2tzLCBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icywgc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycywgc3RydWN0dXJlU3FsLCBzeW5jLCB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycywgdGVuYW50RGF0YWJhc2VSZXNvbHZlciwgdGVuYW50UmVzb2x2ZXIsIHRlc3RpbmcsIHRpbWVab25lLCB0aW1lem9uZU9mZnNldE1pbnV0ZXMsIHRydXN0ZWRQcm94aWVzLCB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIsIHdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgPSBhYmlsaXR5UmVzb2x2ZXJcbiAgICB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gYWJpbGl0eVJlc291cmNlcyB8fCBbXVxuICAgIHRoaXMuX2F1dG9sb2FkID0gYXV0b2xvYWRcbiAgICB0aGlzLl9iYWNrZ3JvdW5kSm9icyA9IGJhY2tncm91bmRKb2JzXG4gICAgdGhpcy5fYmVhY29uID0gYmVhY29uXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gY2xpZW50IHZhbHVlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gY29ubmVjdCBwcm9taXNlIHZhbHVlLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiByZXBvcnQgdGltZXIgdmFsdWUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAtIFBlbmRpbmcgXCJiZWFjb24gc3RpbGwgdW5yZWFjaGFibGVcIiByZXBvcnQgdGltZXIuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBvdXRhZ2UgcmVwb3J0ZWQgdmFsdWUuXG4gICAgICogQHR5cGUge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY3VycmVudCBiZWFjb24gb3V0YWdlIGhhcyBhbHJlYWR5IGJlZW4gcmVwb3J0ZWQuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGxhc3QgZG93biBlcnJvciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e3N0YWdlOiBcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCIsIGVycm9yOiBFcnJvcn0gfCB1bmRlZmluZWR9IC0gTGF0ZXN0IGJlYWNvbi1kb3duIGRldGFpbHMsIHJlcG9ydGVkIG9ubHkgaWYgdGhlIG91dGFnZSBpcyBzdXN0YWluZWQuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID0gc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNcbiAgICB0aGlzLl9hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzIHx8IHt9XG4gICAgLy8gQ29weSBzbyBhcHBlbmRpbmcgcGFja2FnZS1kZXJpdmVkIGVudHJpZXMgYmVsb3cgbmV2ZXIgbXV0YXRlcyBhIGNhbGxlcidzXG4gICAgLy8gc2hhcmVkIGFycmF5IChjb25maWcgbW9kdWxlcyBjb21tb25seSBleHBvcnQgYSByZXVzZWQgYmFja2VuZFByb2plY3RzIGFycmF5KS5cbiAgICB0aGlzLl9iYWNrZW5kUHJvamVjdHMgPSBiYWNrZW5kUHJvamVjdHMgPyBbLi4uYmFja2VuZFByb2plY3RzXSA6IFtdXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJUeXBlW119ICovXG4gICAgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzID0gW11cbiAgICB0aGlzLmNvcnMgPSBjb3JzXG4gICAgdGhpcy5fY29va2llU2VjcmV0ID0gY29va2llU2VjcmV0XG4gICAgdGhpcy5kYXRhYmFzZSA9IGRhdGFiYXNlXG4gICAgdGhpcy5kZWJ1ZyA9IGRlYnVnXG4gICAgdGhpcy5fZGVidWdFbmRwb2ludCA9IHRoaXMuX25vcm1hbGl6ZURlYnVnRW5kcG9pbnQoZGVidWdFbmRwb2ludClcbiAgICB0aGlzLl9hcGlNYW5pZmVzdCA9IHRoaXMuX25vcm1hbGl6ZUFwaU1hbmlmZXN0KGFwaU1hbmlmZXN0KVxuICAgIHRoaXMuX2Vudmlyb25tZW50ID0gZW52aXJvbm1lbnQgfHwgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0VOViB8fCBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5OT0RFX0VOViB8fCBcImRldmVsb3BtZW50XCJcbiAgICB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIgPSBlbnZpcm9ubWVudEhhbmRsZXJcbiAgICB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXNcbiAgICB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9IGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzID09PSB1bmRlZmluZWRcbiAgICAgID8gc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycyAhPT0gdHJ1ZVxuICAgICAgOiBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50c1xuICAgIHRoaXMuX2RpcmVjdG9yeSA9IGRpcmVjdG9yeVxuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHMgPSBpbml0aWFsaXplTW9kZWxzXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNQYWNrYWdlW119ICovXG4gICAgdGhpcy5fcGFja2FnZXMgPSAocGFja2FnZXMgfHwgW10pLm1hcCgoZW50cnkpID0+IFZlbG9jaW91c1BhY2thZ2UuZnJvbShlbnRyeSkpXG5cbiAgICAvLyBBcHBlbmQgYSBkZXJpdmVkIGJhY2tlbmQtcHJvamVjdCBwZXIgcGFja2FnZSBzbyB0aGUgZXhpc3RpbmcgcmVzb3VyY2VcbiAgICAvLyBkaXNjb3ZlcnkgKyBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uIG1hY2hpbmVyeSBpbmNsdWRlcyBpdC4gUGFja2FnZVxuICAgIC8vIGZyb250ZW5kIG1vZGVscyBhcmUgZ2VuZXJhdGVkIGludG8gdGhlIGFwcCdzIGZyb250ZW5kLW1vZGVscyBvdXRwdXQuXG4gICAgY29uc3QgYXBwRnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoID0gdGhpcy5fYmFja2VuZFByb2plY3RzWzBdPy5mcm9udGVuZE1vZGVsc091dHB1dFBhdGhcblxuICAgIGZvciAoY29uc3QgdmVsb2Npb3VzUGFja2FnZSBvZiB0aGlzLl9wYWNrYWdlcykge1xuICAgICAgdGhpcy5fYmFja2VuZFByb2plY3RzLnB1c2godmVsb2Npb3VzUGFja2FnZS50b0JhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbih7ZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoOiBhcHBGcm9udGVuZE1vZGVsc091dHB1dFBhdGh9KSlcbiAgICB9XG5cbiAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vaW5pdGlhbGl6ZXIuanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIEludmFsaWRhdGVzIG1vZGVsIHBoYXNlcyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGNsb3NlZC5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID0gMFxuICAgIC8qKlxuICAgICAqIEluLXByb2dyZXNzIGBpbml0aWFsaXplTW9kZWxzKClgIHByb21pc2UuIE1vZGVsIGluaXRpYWxpemF0aW9uIGlzIGFuXG4gICAgICogYXRvbWljIGJvb3RzdHJhcCBwaGFzZTogY29uY3VycmVudCBjYWxsZXJzIHNoYXJlIGl0LCBhbmQgYSByZWplY3Rpb25cbiAgICAgKiBsZWF2ZXMgdGhlIHBoYXNlIGVsaWdpYmxlIGZvciBhIGxhdGVyIGNvbXBsZXRlIGF0dGVtcHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGBpbml0aWFsaXplKClgIHByb21pc2UsIG1lbW9pemVkIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGVcbiAgICAgKiBzYW1lIGJvb3RzdHJhcC4gUmV0YWluZWQgYWNyb3NzIGEgY29ubmVjdGlvbiBjbG9zZSB1bnRpbCBzdGFsZSBib290c3RyYXBcbiAgICAgKiB3b3JrIHNldHRsZXMsIHRoZW4gY2xlYXJlZCBieSBpZGVudGl0eSBiZWZvcmUgdGhlIG5ldyBnZW5lcmF0aW9uIHJldHJpZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICBjb25zdCB3ZWJzb2NrZXRJbmJvdW5kUXVldWUgPSBodHRwU2VydmVyPy53ZWJzb2NrZXRJbmJvdW5kUXVldWVcbiAgICBjb25zdCB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlID0gaHR0cFNlcnZlcj8ud2Vic29ja2V0T3V0Ym91bmRRdWV1ZVxuXG4gICAgdGhpcy5odHRwU2VydmVyID0ge1xuICAgICAgLi4uKGh0dHBTZXJ2ZXIgfHwge30pLFxuICAgICAgY29tcHJlc3Npb246IG5vcm1hbGl6ZUh0dHBDb21wcmVzc2lvbihodHRwU2VydmVyPy5jb21wcmVzc2lvbiksXG4gICAgICBtYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzOiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIoaHR0cFNlcnZlcj8ubWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlcywgXCJodHRwU2VydmVyLm1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXNcIiksXG4gICAgICBtYXhSZXF1ZXN0Qm9keUJ5dGVzOiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIoaHR0cFNlcnZlcj8ubWF4UmVxdWVzdEJvZHlCeXRlcywgXCJodHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcIiksXG4gICAgICB3ZWJzb2NrZXRJbmJvdW5kUXVldWU6IHtcbiAgICAgICAgbWF4UGVuZGluZ0J5dGVzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldEluYm91bmRRdWV1ZT8ubWF4UGVuZGluZ0J5dGVzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0SW5ib3VuZFF1ZXVlLm1heFBlbmRpbmdCeXRlc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX0JZVEVTKSxcbiAgICAgICAgbWF4UGVuZGluZ01lc3NhZ2VzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldEluYm91bmRRdWV1ZT8ubWF4UGVuZGluZ01lc3NhZ2VzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0SW5ib3VuZFF1ZXVlLm1heFBlbmRpbmdNZXNzYWdlc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX01FU1NBR0VTKVxuICAgICAgfSxcbiAgICAgIHdlYnNvY2tldE91dGJvdW5kUXVldWU6IHtcbiAgICAgICAgbWF4UGVuZGluZ0J5dGVzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldE91dGJvdW5kUXVldWU/Lm1heFBlbmRpbmdCeXRlcywgXCJodHRwU2VydmVyLndlYnNvY2tldE91dGJvdW5kUXVldWUubWF4UGVuZGluZ0J5dGVzXCIsIERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0JZVEVTKSxcbiAgICAgICAgbWF4UGVuZGluZ0ZyYW1lczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlPy5tYXhQZW5kaW5nRnJhbWVzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0T3V0Ym91bmRRdWV1ZS5tYXhQZW5kaW5nRnJhbWVzXCIsIERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0ZSQU1FUylcbiAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBodHRwIHNlcnZlciBpbnN0YW5jZSB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e2dldERlYnVnU25hcHNob3Q6ICgpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5faHR0cFNlcnZlckluc3RhbmNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5sb2NhbGUgPSBsb2NhbGVcbiAgICB0aGlzLmxvY2FsZUZhbGxiYWNrcyA9IGxvY2FsZUZhbGxiYWNrc1xuICAgIHRoaXMubG9jYWxlcyA9IGxvY2FsZXNcbiAgICB0aGlzLl9pbml0aWFsaXplcnMgPSBpbml0aWFsaXplcnNcbiAgICB0aGlzLl90ZXN0aW5nID0gdGVzdGluZ1xuICAgIHRoaXMuX3RpbWVab25lID0gdGltZVpvbmVcbiAgICB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPSB0aW1lem9uZU9mZnNldE1pbnV0ZXNcbiAgICB0aGlzLl90cnVzdGVkUHJveGllcyA9IHRydXN0ZWRQcm94aWVzXG4gICAgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9IHJlcXVlc3RUaW1lb3V0TXNcbiAgICB0aGlzLl9zdHJ1Y3R1cmVTcWwgPSBzdHJ1Y3R1cmVTcWxcbiAgICB0aGlzLl9zeW5jID0gdGhpcy5fbm9ybWFsaXplU3luY0NvbmZpZ3VyYXRpb24oc3luYylcbiAgICB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyA9IHRlbmFudERhdGFiYXNlUHJvdmlkZXJzIHx8IHt9XG4gICAgdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciA9IHRlbmFudERhdGFiYXNlUmVzb2x2ZXJcbiAgICB0aGlzLl90ZW5hbnRSZXNvbHZlciA9IHRlbmFudFJlc29sdmVyXG4gICAgdGhpcy5fd2Vic29ja2V0RXZlbnRzID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpYmVycyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7VmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlciA9IHdlYnNvY2tldENoYW5uZWxSZXNvbHZlclxuICAgIHRoaXMuX3dlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIgPSB3ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzc2VzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3NlcyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY2hhbm5lbCBjbGFzc2VzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3NlcyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqXG4gICAgICogQ2hhbm5lbCB0eXBlcyByZWdpc3RlcmVkIHdpdGggYHtsaXZlT25seTogdHJ1ZX1gOiB0aGVpciB0cmFmZmljIGlzXG4gICAgICogbmV2ZXIgcGVyc2lzdGVkIGZvciByZXBsYXksIGFuZCBgbWFya0NoYW5uZWxJbnRlcmVzdGVkYCByZWplY3RzIHRoZVxuICAgICAqIG5hbWUuXG4gICAgICogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIHRoaXMuX2xpdmVPbmx5V2Vic29ja2V0Q2hhbm5lbHMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9ucyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgU2V0PGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdD4+fSAtIGNoYW5uZWxUeXBlIOKGkiBsaXZlIHN1YnNjcmlwdGlvbnMgYWNyb3NzIGFsbCBzZXNzaW9ucy5cbiAgICAgKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IGxvY2FsIChwZXItcHJvY2Vzcykgd2Vic29ja2V0IGNoYW5uZWwgYnJvYWRjYXN0IGRlbGl2ZXJpZXMsXG4gICAgICogbGF1bmNoZWQgZmlyZS1hbmQtZm9yZ2V0IGZyb20gYF9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbGAgc28gb25lIHNsb3dcbiAgICAgKiBzdWJzY3JpYmVyIG5ldmVyIGJsb2NrcyBhbm90aGVyLiBUcmFja2VkIGhlcmUgc29cbiAgICAgKiBgYXdhaXRQZW5kaW5nQnJvYWRjYXN0c2AgY2FuIHNuYXBzaG90IGFuZCBkcmFpbiB0aGVtIGJlZm9yZSBzZXR0bGluZy5cbiAgICAgKiBTZXR0bGVkIGRlbGl2ZXJpZXMgYXJlIHJlbW92ZWQgYnkgdGhlIHRyYWNraW5nLWxldmVsIGNsZWFudXAuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIExhdGVzdCBsb2NhbCBicm9hZGNhc3QgZGVsaXZlcnkgcGVyIHN1YnNjcmlwdGlvbi4gQ2hhaW5pbmcgc3Vic2VxdWVudFxuICAgICAqIGRlbGl2ZXJpZXMgcHJlc2VydmVzIGxpZmVjeWNsZSBldmVudCBvcmRlciB3aXRob3V0IGNvdXBsaW5nIHNlcGFyYXRlXG4gICAgICogc3Vic2NyaWJlcnMgdG8gb25lIGFub3RoZXIuXG4gICAgICogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0LCBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMgPSBuZXcgV2Vha01hcCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBzZXNzaW9ucyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQ+fSAtIExpdmUgd2Vic29ja2V0IHNlc3Npb25zLCBpbmNsdWRpbmcgcGF1c2VkIHNlc3Npb25zIHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93LlxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25zID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHBhdXNlZCB3ZWJzb2NrZXQgc2Vzc2lvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBncmFjZVRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiwgcGF1c2VkQXQ6IG51bWJlcn0+fSAtIHNlc3Npb25JZCDihpIgcGF1c2VkIHNlc3Npb24gYXdhaXRpbmcgcmVzdW1lLlxuICAgICAqL1xuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zID0gbmV3IE1hcCgpXG5cbiAgICAvKiogR3JhY2UgcGVyaW9kIGZvciBwYXVzZWQgV2ViU29ja2V0IHNlc3Npb25zIGJlZm9yZSBwZXJtYW5lbnQgdGVhcmRvd24uICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyA9IDMwMFxuXG4gICAgLyoqIEludGVydmFsIChzZWNvbmRzKSBiZXR3ZWVuIHNlcnZlcuKGkmNsaWVudCBoZWFydGJlYXQgcGluZ3M7IDAgZGlzYWJsZXMgcmVhcGluZyBvZiBzaWxlbnQgc29ja2V0cy4gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyA9IDMwXG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCB3cmFwcGVyIGNhbGxlZCBhcm91bmQgZXZlcnkgV2ViU29ja2V0LWJvcm5lIHJlcXVlc3QgL1xuICAgICAqIGNvbm5lY3Rpb24gbWVzc2FnZSAvIGNoYW5uZWwgZGlzcGF0Y2guIEFwcHMgcmVnaXN0ZXIgaXQgaGVyZVxuICAgICAqIHRvIHNldCB1cCBwZXItcmVxdWVzdCBjb250ZXh0IChlLmcuIEFzeW5jTG9jYWxTdG9yYWdlIGZvclxuICAgICAqIGxvY2FsZSwgdGVuYW50LCB0cmFjaW5nKSB0aGF0IGRvd25zdHJlYW0gaGFuZGxlcnMgcmVhZC5cbiAgICAgKiBAdHlwZSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9XG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0QXJvdW5kUmVxdWVzdCA9IG51bGxcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYXJvdW5kIGFjdGlvbiB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7KChjb250ZXh0OiB7cmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgcmVzcG9uc2U6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD59KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9ICovXG4gICAgdGhpcy5fYXJvdW5kQWN0aW9uID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgc2Vzc2lvbiBpZGVudGl0eSByZXNvbHZlciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9ICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIgPSBudWxsXG4gICAgdGhpcy5fbG9nZ2luZyA9IGxvZ2dpbmdcbiAgICB0aGlzLl9sb2dSZWRhY3RvciA9IG5ldyBMb2dSZWRhY3Rvcih7c2Vuc2l0aXZlTmFtZXM6IGxvZ2dpbmc/LnNlbnNpdGl2ZU5hbWVzfSlcbiAgICB0aGlzLl9tYWlsZXJCYWNrZW5kID0gbWFpbGVyQmFja2VuZFxuICAgIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcyA9IFsuLi4ocm91dGVSZXNvbHZlckhvb2tzIHx8IFtdKV1cbiAgICB0aGlzLl9hZGREZWJ1Z0VuZHBvaW50Um91dGVIb29rKClcbiAgICB0aGlzLl9hZGRBcGlNYW5pZmVzdFJvdXRlSG9vaygpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGFwcGxpZWQgcm91dGUgbW91bnRzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtXZWFrU2V0PG9iamVjdD59ICovXG4gICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2Vycm9yRXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGRhdGFiYXNlIHBvb2xzIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzID0ge31cbiAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSA9IG5ldyBGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSh7Y29uZmlndXJhdGlvbjogdGhpcywgbWF4T3BlbkhhbmRsZXM6IGZyb250ZW5kVGVuYW50U3FsaXRlPy5tYXhPcGVuSGFuZGxlc30pXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIG1vZGVsIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiB0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5tb2RlbENsYXNzZXMgPSB7fVxuXG4gICAgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5zZXRDb25maWd1cmF0aW9uKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0b2xvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIG9uIGxhenkgYWNjZXNzIGlzIGVuYWJsZWQgZ2xvYmFsbHkuXG4gICAqL1xuICBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIHRoaXMuX2F1dG9sb2FkIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhwb3NlIGludGVybmFsIGVycm9ycyB0byBjbGllbnRzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB1bmV4cGVjdGVkIGludGVybmFsIGVycm9yIGRldGFpbHMgbWF5IGJlIHJldHVybmVkIHRvIEFQSSBjbGllbnRzLlxuICAgKi9cbiAgZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSB7IHJldHVybiB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9PT0gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBmcm9udGVuZC1tb2RlbCBlcnJvcnMgZXhwb3NlIG9ubHkgZXhwbGljaXRseSBzYWZlIG1lc3NhZ2VzLlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKClgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBpbnRlcm5hbCBlcnJvciBleHBvc3VyZSBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGdldFNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMoKSB7IHJldHVybiAhdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgZW5kcG9pbnQuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERlYnVnRW5kcG9pbnQoKSB7IHJldHVybiB0aGlzLl9kZWJ1Z0VuZHBvaW50IH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBwYXRoOiBzdHJpbmcsIHRva2VuQ29uZmlndXJlZDogYm9vbGVhbn19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlnIGZvciB0aGUgc25hcHNob3QsIHdpdGggdGhlIHRva2VuIHJlZGFjdGVkLlxuICAgKi9cbiAgX2RlYnVnRW5kcG9pbnRTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdGhpcy5fZGVidWdFbmRwb2ludC5lbmFibGVkLFxuICAgICAgcGF0aDogdGhpcy5fZGVidWdFbmRwb2ludC5wYXRoLFxuICAgICAgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2RlYnVnRW5kcG9pbnQudG9rZW4pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRlYnVnIGVuZHBvaW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBkZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZURlYnVnRW5kcG9pbnQodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvdmVsb2Npb3VzL2RlYnVnXCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvdmVsb2Npb3VzL2RlYnVnXCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50LnBhdGggdG8gYmUgYSBzdHJpbmcgc3RhcnRpbmcgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocGF0aCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IHZhbHVlLnRva2VuID09PSB1bmRlZmluZWQgfHwgdmFsdWUudG9rZW4gPT09IG51bGwgPyBudWxsIDogdmFsdWUudG9rZW5cblxuICAgIGlmICh0b2tlbiAhPT0gbnVsbCAmJiAodHlwZW9mIHRva2VuICE9PSBcInN0cmluZ1wiIHx8ICF0b2tlbi50cmltKCkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlYnVnRW5kcG9pbnQudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBhcGkgbWFuaWZlc3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IHtwYXRoPzogc3RyaW5nLCB0b2tlbj86IHN0cmluZ319IHZhbHVlIC0gQVBJIG1hbmlmZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBBUEkgbWFuaWZlc3QgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVBcGlNYW5pZmVzdCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgcGF0aDogXCIvYXBpL21hbmlmZXN0XCIsIHRva2VuOiBudWxsfVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoOiBcIi9hcGkvbWFuaWZlc3RcIiwgdG9rZW46IG51bGx9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFwaU1hbmlmZXN0IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvYXBpL21hbmlmZXN0XCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC50b2tlbiB0byBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcodG9rZW4pfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoLCB0b2tlbjogdG9rZW4gPT09IG51bGwgPyBudWxsIDogdG9rZW4udHJpbSgpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGFwaSBtYW5pZmVzdCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkQXBpTWFuaWZlc3RSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9hcGlNYW5pZmVzdC5lbmFibGVkKSByZXR1cm5cblxuICAgIHRoaXMuYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gXCJHRVRcIikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChjdXJyZW50UGF0aCAhPT0gdGhpcy5fYXBpTWFuaWZlc3QucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9hcGlNYW5pZmVzdC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJzaG93XCIsXG4gICAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzQXBpTWFuaWZlc3RcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9hcGktbWFuaWZlc3QvY29udHJvbGxlci5qc1wiLFxuICAgICAgICBza2lwQ29udHJvbGxlckNvbm5lY3Rpb25zOiB0cnVlLFxuICAgICAgICBza2lwQWJpbGl0eVJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICB2aWV3UGF0aDogXCIuL2J1aWx0LWluL2FwaS1tYW5pZmVzdFwiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBkZWJ1ZyBlbmRwb2ludCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkRGVidWdFbmRwb2ludFJvdXRlSG9vaygpIHtcbiAgICBpZiAoIXRoaXMuX2RlYnVnRW5kcG9pbnQuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiR0VUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX2RlYnVnRW5kcG9pbnQucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgLy8gV2hlbiBhIHRva2VuIGlzIGNvbmZpZ3VyZWQsIGFuIHVuYXV0aGVudGljYXRlZCByZXF1ZXN0IGdldHMgbm8gcm91dGUgYXRcbiAgICAgIC8vIGFsbCAoNDA0KSByYXRoZXIgdGhhbiBhIDQwMSwgc28gdGhlIGVuZHBvaW50J3MgZXhpc3RlbmNlIHN0YXlzIGhpZGRlbi5cbiAgICAgIGlmICh0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uOiBcInNob3dcIixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNEZWJ1Z1wiLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogXCIuL2J1aWx0LWluL2RlYnVnL2NvbnRyb2xsZXIuanNcIixcbiAgICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uczogdHJ1ZSxcbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9kZWJ1Z1wiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdXRvbG9hZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyB0aGlzLl9hdXRvbG9hZCA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29ycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Db3JzVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgY29ycy5cbiAgICovXG4gIGdldENvcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGh0dHAgc2VydmVyIGNvbXByZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgYnVmZmVyZWQgcmVzcG9uc2UgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBTZXJ2ZXJDb21wcmVzc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy5odHRwU2VydmVyLmNvbXByZXNzaW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbWF4aW11bSBidWZmZXJlZCByZXNwb25zZSBib2R5IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgYnl0ZSBsaW1pdCwgb3IgdW5kZWZpbmVkIHdoZW4gdW5ib3VuZGVkLlxuICAgKi9cbiAgZ2V0SHR0cFNlcnZlck1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5tYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbWF4aW11bSByZXF1ZXN0IGJvZHkgYnl0ZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBieXRlIGxpbWl0LCBvciB1bmRlZmluZWQgd2hlbiB1bmJvdW5kZWQuXG4gICAqL1xuICBnZXRIdHRwU2VydmVyTWF4UmVxdWVzdEJvZHlCeXRlcygpIHtcbiAgICByZXR1cm4gdGhpcy5odHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb29raWUgc2VjcmV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENvb2tpZSBzZWNyZXQuXG4gICAqL1xuICBnZXRDb29raWVTZWNyZXQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nvb2tpZVNlY3JldFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbn0gLSBTeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRTeW5jQ29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fc3luY1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBvZmZsaW5lIGdyYW50IHNpZ25pbmcga2V5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50U2lnbmluZ0tleX0gLSBDdXJyZW50IHNpZ25pbmcga2V5LlxuICAgKi9cbiAgY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoKSB7XG4gICAgY29uc3Qgc2lnbmluZ0tleXMgPSB0aGlzLmdldFN5bmNDb25maWd1cmF0aW9uKCkub2ZmbGluZUdyYW50U2lnbmluZ0tleXNcblxuICAgIHJldHVybiBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleShzaWduaW5nS2V5cylcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IHN5bmMgLSBTeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb259IC0gTm9ybWFsaXplZCBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0NvbmZpZ3VyYXRpb24oc3luYykge1xuICAgIGNvbnN0IGFwaSA9IHN5bmM/LmFwaVxuICAgIGNvbnN0IGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSA9IHN5bmM/LmRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSB8fCBudWxsXG4gICAgY29uc3QgY2hhbmdlRmVlZFJldGVudGlvblNpemUgPSBzeW5jPy5jaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzID0gc3luYz8ub2ZmbGluZUdyYW50U2lnbmluZ0tleXMgfHwgW11cbiAgICBjb25zdCBvZmZsaW5lR3JhbnRUdGxNcyA9IHN5bmM/Lm9mZmxpbmVHcmFudFR0bE1zXG5cbiAgICBpZiAoZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5ICE9PSBudWxsICYmICh0eXBlb2YgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5KSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5IG11c3QgYmUgYSBwdWJsaWMgSlNPTiBXZWIgS2V5IG9iamVjdFwiKVxuICAgIH1cbiAgICBpZiAoY2hhbmdlRmVlZFJldGVudGlvblNpemUgIT09IHVuZGVmaW5lZCAmJiAoIU51bWJlci5pc0ludGVnZXIoY2hhbmdlRmVlZFJldGVudGlvblNpemUpIHx8IGNoYW5nZUZlZWRSZXRlbnRpb25TaXplIDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNoYW5nZUZlZWRSZXRlbnRpb25TaXplIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyXCIpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShvZmZsaW5lR3JhbnRTaWduaW5nS2V5cykpIHRocm93IG5ldyBFcnJvcihcInN5bmMub2ZmbGluZUdyYW50U2lnbmluZ0tleXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIGlmIChvZmZsaW5lR3JhbnRUdGxNcyAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihvZmZsaW5lR3JhbnRUdGxNcykgfHwgb2ZmbGluZUdyYW50VHRsTXMgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMub2ZmbGluZUdyYW50VHRsTXMgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIgbnVtYmVyIG9mIG1pbGxpc2Vjb25kc1wiKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhcGk6IHRoaXMuX25vcm1hbGl6ZVN5bmNBcGlDb25maWd1cmF0aW9uKGFwaSksXG4gICAgICBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZTogY2hhbmdlRmVlZFJldGVudGlvblNpemUgfHwgMTAwMDAsXG4gICAgICBjbGllbnQ6IHRoaXMuX25vcm1hbGl6ZVN5bmNDbGllbnRDb25maWd1cmF0aW9uKHN5bmM/LmNsaWVudCksXG4gICAgICBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXksXG4gICAgICBvZmZsaW5lR3JhbnRTaWduaW5nS2V5czogb2ZmbGluZUdyYW50U2lnbmluZ0tleXMubWFwKChrZXkpID0+IG5vcm1hbGl6ZU9mZmxpbmVHcmFudFNpZ25pbmdLZXkoa2V5KSksXG4gICAgICBvZmZsaW5lR3JhbnRUdGxNczogb2ZmbGluZUdyYW50VHRsTXMgfHwgMjQgKiA2MCAqIDYwICogMTAwMFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGNsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbiBjb25zdW1lZCBieSBgU3luY0NsaWVudC5mcm9tQ29uZmlndXJhdGlvbiguLi4pYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NsaWVudENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IGNsaWVudCAtIENsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIGNsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ2xpZW50Q29uZmlndXJhdGlvbihjbGllbnQpIHtcbiAgICBpZiAoY2xpZW50ID09PSB1bmRlZmluZWQgfHwgY2xpZW50ID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIGNsaWVudCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNsaWVudCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50IG11c3QgYmUgYW4gb2JqZWN0IHdpdGggdHJhbnNwb3J0IGFuZCBhdXRoZW50aWNhdGlvblRva2VuXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge2F1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgaXNPbmxpbmUsIG1vdW50UGF0aCwgb25FcnJvciwgcmVhbHRpbWUsIHRyYW5zcG9ydCwgd2Vic29ja2V0Q2xpZW50LCB3ZWJzb2NrZXRVcmwsIC4uLnJlc3RDbGllbnR9ID0gY2xpZW50XG4gICAgY29uc3QgcmVzdENsaWVudEtleXMgPSBPYmplY3Qua2V5cyhyZXN0Q2xpZW50KVxuXG4gICAgaWYgKHJlc3RDbGllbnRLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RDbGllbnRLZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBpc09ubGluZSwgbW91bnRQYXRoLCBvbkVycm9yLCByZWFsdGltZSwgdHJhbnNwb3J0LCB3ZWJzb2NrZXRDbGllbnQsIHdlYnNvY2tldFVybClgKVxuICAgIH1cbiAgICBpZiAoIXRyYW5zcG9ydCB8fCB0eXBlb2YgdHJhbnNwb3J0ICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiB0cmFuc3BvcnQucG9zdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC50cmFuc3BvcnQgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBhIHBvc3QocGF0aCwgYm9keSkgbWV0aG9kIChsaWtlIHRoZSBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2xpZW50KVwiKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGF1dGhlbnRpY2F0aW9uVG9rZW4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYXV0aGVudGljYXRpb25Ub2tlbiBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIHRoZSBhdXRoIHRva2VuIHNlbnQgd2l0aCBzeW5jIHJlcXVlc3RzXCIpXG4gICAgfVxuICAgIGlmIChpc09ubGluZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBpc09ubGluZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5pc09ubGluZSBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIGNvbm5lY3Rpdml0eVwiKVxuICAgIH1cbiAgICBpZiAob25FcnJvciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvbkVycm9yICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9uRXJyb3IgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlcG9ydGluZyBiYWNrZ3JvdW5kIHN5bmMgZmFpbHVyZXNcIilcbiAgICB9XG4gICAgaWYgKGJhdGNoU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihiYXRjaFNpemUpIHx8IGJhdGNoU2l6ZSA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYmF0Y2hTaXplIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyXCIpXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuICAgIGlmICh3ZWJzb2NrZXRDbGllbnQgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHdlYnNvY2tldENsaWVudCAhPT0gXCJvYmplY3RcIiB8fCB3ZWJzb2NrZXRDbGllbnQgPT09IG51bGwgfHwgdHlwZW9mIHdlYnNvY2tldENsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC53ZWJzb2NrZXRDbGllbnQgbXVzdCBiZSBhIHdlYnNvY2tldCBjbGllbnQgd2l0aCBhIHN1YnNjcmliZUNoYW5uZWwgbWV0aG9kIChsaWtlIFZlbG9jaW91c1dlYnNvY2tldENsaWVudClcIilcbiAgICB9XG4gICAgaWYgKHdlYnNvY2tldFVybCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB3ZWJzb2NrZXRVcmwgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHdlYnNvY2tldFVybCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50LndlYnNvY2tldFVybCBtdXN0IGJlIGEgVVJMIHN0cmluZyBvciBhIGZ1bmN0aW9uIHJlc29sdmluZyBvbmUsIGdvdDogJHtTdHJpbmcod2Vic29ja2V0VXJsKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplLFxuICAgICAgaXNPbmxpbmUsXG4gICAgICBtb3VudFBhdGg6IChtb3VudFBhdGggfHwgXCIvdmVsb2Npb3VzL3N5bmNcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCIsXG4gICAgICBvbkVycm9yLFxuICAgICAgcmVhbHRpbWUsXG4gICAgICB0cmFuc3BvcnQsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQsXG4gICAgICB3ZWJzb2NrZXRVcmxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIEFQSSBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gYXBpIC0gU3luYyBBUEkgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHN5bmMgQVBJIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSB7XG4gICAgaWYgKGFwaSA9PT0gdW5kZWZpbmVkIHx8IGFwaSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgaWYgKHR5cGVvZiBhcGkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhcGkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmFwaSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGEgcmVzb3VyY2VDbGFzc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9ID0gYXBpXG5cbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzIG11c3QgYmUgYSByZXNvdXJjZSBjbGFzcywgZ290OiAke1N0cmluZyhyZXNvdXJjZUNsYXNzKX1gKVxuICAgIH1cbiAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzICR7cmVzb3VyY2VDbGFzcy5uYW1lfSBtdXN0IGRlZmluZSBzdGF0aWMgTW9kZWxDbGFzc2ApXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlPn0gLSBUaGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2UpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgIGlmICghdGhpcy5kYXRhYmFzZVt0aGlzLmdldEVudmlyb25tZW50KCldKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gZm9yIGVudmlyb25tZW50OiAke3RoaXMuZ2V0RW52aXJvbm1lbnQoKX0gLSAke09iamVjdC5rZXlzKHRoaXMuZGF0YWJhc2UpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YWJhc2VcIiwgdGhpcy5nZXRFbnZpcm9ubWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgdGhlIGlkZW50aWZpZXIuXG4gICAqL1xuICByZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIsIHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpKSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVtpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBkYXRhYmFzZSBpZGVudGlmaWVyIGNvbmZpZ3VyZWQ6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGlmICh0ZW5hbnQgPT09IHVuZGVmaW5lZCB8fCAhdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcikge1xuICAgICAgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuICAgIH1cblxuICAgIGNvbnN0IG92ZXJyaWRlQ29uZmlndXJhdGlvbiA9IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgIGlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuXG4gICAgcmV0dXJuIG1lcmdlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3ZlcnJpZGVDb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpc2FibGVkIGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRGlzYWJsZWQgZGF0YWJhc2UgaWRlbnRpZmllcnMgZnJvbSBlbnYgZmxhZ3MuXG4gICAqL1xuICBnZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVycyA9IG5ldyBTZXQoKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnNSYXcgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRElTQUJMRURfREFUQUJBU0VfSURFTlRJRklFUlNcblxuICAgIGlmIChkaXNhYmxlZElkZW50aWZpZXJzUmF3KSB7XG4gICAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGlzYWJsZWRJZGVudGlmaWVyc1Jhdy5zcGxpdChcIixcIikpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGlkZW50aWZpZXIudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIGRpc2FibGVkSWRlbnRpZmllcnMuYWRkKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHByb2Nlc3MuZW52LlZFTE9DSU9VU19ESVNBQkxFX01TU1FMID09PSBcIjFcIikge1xuICAgICAgZGlzYWJsZWRJZGVudGlmaWVycy5hZGQoXCJtc3NxbFwiKVxuICAgIH1cblxuICAgIHJldHVybiBkaXNhYmxlZElkZW50aWZpZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBpZGVudGlmaWVyIGFjdGl2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGRhdGFiYXNlIGlkZW50aWZpZXIgaXMgYWN0aXZlIGluIHRoZSBjdXJyZW50IHRlbmFudCBjb250ZXh0LlxuICAgKi9cbiAgaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllciwgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KCkpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIGRhdGFiYXNlIGlkZW50aWZpZXIgY29uZmlndXJlZDogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkgcmV0dXJuIHRydWVcbiAgICBpZiAodGVuYW50ID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3Qgb3ZlcnJpZGVDb25maWd1cmF0aW9uID0gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgaWRlbnRpZmllcixcbiAgICAgIHRlbmFudFxuICAgIH0pXG5cbiAgICByZXR1cm4gQm9vbGVhbihvdmVycmlkZUNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyh0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnMgPSB0aGlzLmdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpXG5cbiAgICByZXR1cm4gaWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiAhZGlzYWJsZWRJZGVudGlmaWVycy5oYXMoaWRlbnRpZmllcikgJiYgdGhpcy5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBIdW1hbi1yZWFkYWJsZSBzZXJ2ZXIgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBhc3luYyBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGxvY2FsU25hcHNob3QgPSB0aGlzLmdldExvY2FsRGVidWdTbmFwc2hvdCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ubG9jYWxTbmFwc2hvdCxcbiAgICAgIGh0dHBTZXJ2ZXI6IGF3YWl0IHRoaXMuX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWwgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gSHVtYW4tcmVhZGFibGUgZGlhZ25vc3RpY3MgZm9yIHRoaXMgcHJvY2VzcyBvbmx5LlxuICAgKi9cbiAgZ2V0TG9jYWxEZWJ1Z1NuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBiYWNrZ3JvdW5kSm9iczogdGhpcy5fZGVidWdCYWNrZ3JvdW5kSm9ic1NuYXBzaG90KCksXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9kZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpLFxuICAgICAgZGF0YWJhc2U6IHRoaXMuX2RlYnVnRGF0YWJhc2VTbmFwc2hvdCgpLFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHNlcnZlcjogdGhpcy5fZGVidWdTZXJ2ZXJTbmFwc2hvdCgpLFxuICAgICAgd2Vic29ja2V0czogdGhpcy5fZGVidWdXZWJzb2NrZXRTbmFwc2hvdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgaHR0cCBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gSFRUUCBzZXJ2ZXIgd29ya2VyIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgYXN5bmMgX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KCkge1xuICAgIGNvbnN0IGh0dHBTZXJ2ZXIgPSAvKiogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90PzogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSlcblxuICAgIGlmICghaHR0cFNlcnZlcj8uZ2V0RGVidWdTbmFwc2hvdCkge1xuICAgICAgcmV0dXJuIHtjb25maWd1cmVkOiBCb29sZWFuKHRoaXMuaHR0cFNlcnZlciksIGFjdGl2ZTogZmFsc2V9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IGh0dHBTZXJ2ZXIuZ2V0RGVidWdTbmFwc2hvdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2VydmVyIHJ1bnRpbWUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdTZXJ2ZXJTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBub2RlUHJvY2VzcyA9IHR5cGVvZiBwcm9jZXNzID09PSBcInVuZGVmaW5lZFwiID8gdW5kZWZpbmVkIDogcHJvY2Vzc1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmdldEVudmlyb25tZW50KCksXG4gICAgICBtZW1vcnlVc2FnZTogbm9kZVByb2Nlc3MgPyBub2RlUHJvY2Vzcy5tZW1vcnlVc2FnZSgpIDogdW5kZWZpbmVkLFxuICAgICAgbm9kZVZlcnNpb246IG5vZGVQcm9jZXNzPy52ZXJzaW9ucz8ubm9kZSxcbiAgICAgIHBpZDogbm9kZVByb2Nlc3M/LnBpZCxcbiAgICAgIHBsYXRmb3JtOiBub2RlUHJvY2Vzcz8ucGxhdGZvcm0sXG4gICAgICB1cHRpbWVTZWNvbmRzOiBub2RlUHJvY2VzcyA/IG5vZGVQcm9jZXNzLnVwdGltZSgpIDogdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgY29uZmlndXJhdGlvbiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb25maWd1cmF0aW9uIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnQ29uZmlndXJhdGlvblNuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBhcGlNYW5pZmVzdDogdGhpcy5fYXBpTWFuaWZlc3RFbmFibGVkKCkgPyB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogdGhpcy5fYXBpTWFuaWZlc3QucGF0aCwgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuKX0gOiB7ZW5hYmxlZDogZmFsc2V9LFxuICAgICAgYXV0b2xvYWQ6IHRoaXMuZ2V0QXV0b2xvYWQoKSxcbiAgICAgIGRlYnVnOiB0aGlzLmRlYnVnID09PSB0cnVlLFxuICAgICAgZGVidWdFbmRwb2ludDogdGhpcy5fZGVidWdFbmRwb2ludFNuYXBzaG90KCksXG4gICAgICBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IHRoaXMuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCksXG4gICAgICBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50czogdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpLFxuICAgICAgaW5pdGlhbGl6ZWQ6IHRoaXMuX2lzSW5pdGlhbGl6ZWQsXG4gICAgICBsb2dnaW5nOiB7XG4gICAgICAgIGRlYnVnTG93TGV2ZWw6IHRoaXMuX2xvZ2dpbmc/LmRlYnVnTG93TGV2ZWwgPT09IHRydWUsXG4gICAgICAgIG91dHB1dHM6IHRoaXMuX2xvZ2dpbmcgPyBPYmplY3Qua2V5cyh0aGlzLl9sb2dnaW5nKSA6IFtdXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgYmFja2dyb3VuZCBqb2JzIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEJhY2tncm91bmQgam9iIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnQmFja2dyb3VuZEpvYnNTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9iYWNrZ3JvdW5kSm9icyksXG4gICAgICBzY2hlZHVsZWRDb25maWd1cmVkOiBCb29sZWFuKHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGRhdGFiYXNlIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERhdGFiYXNlIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnRGF0YWJhc2VTbmFwc2hvdCgpIHtcbiAgICAvKipcbiAgICAgKiBEYXRhYmFzZSBwb29scy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuRGF0YWJhc2VQb29sRGVidWdTbmFwc2hvdD59ICovXG4gICAgY29uc3QgZGF0YWJhc2VQb29scyA9IHt9XG4gICAgY29uc3QgYWN0aXZlSWRlbnRpZmllcnMgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGFjdGl2ZUlkZW50aWZpZXJzKSB7XG4gICAgICBkYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdID0gdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuZ2V0RGVidWdTbmFwc2hvdCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGl2ZUlkZW50aWZpZXJzLFxuICAgICAgZGlzYWJsZWRJZGVudGlmaWVyczogQXJyYXkuZnJvbSh0aGlzLmdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpKSxcbiAgICAgIGluaXRpYWxpemVkUG9vbHM6IE9iamVjdC5rZXlzKHRoaXMuZGF0YWJhc2VQb29scyksXG4gICAgICBwb29sczogZGF0YWJhc2VQb29sc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHdlYnNvY2tldCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXZWJTb2NrZXQgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdXZWJzb2NrZXRTbmFwc2hvdCgpIHtcbiAgICAvKipcbiAgICAgKiBTZXNzaW9uIGJ1Y2tldHMuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtjb3VudDogbnVtYmVyLCBkZXRhaWxzOiB7Y2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXIsIGNoYW5uZWxTdWJzY3JpcHRpb25zOiB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9W10sIGNvbm5lY3Rpb25Db3VudDogbnVtYmVyLCBwYXVzZWQ6IGJvb2xlYW4sIHN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXJ9fT59ICovXG4gICAgY29uc3Qgc2Vzc2lvbkJ1Y2tldHMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBTZXNzaW9uIGRldGFpbHMuXG4gICAgICogQHR5cGUge3tjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IG51bWJlciwgY2hhbm5lbFN1YnNjcmlwdGlvbnM6IHtjaGFubmVsVHlwZTogc3RyaW5nLCBjb3VudDogbnVtYmVyLCBtb2RlbDogc3RyaW5nIHwgbnVsbH1bXSwgY29ubmVjdGlvbkNvdW50OiBudW1iZXIsIHBhdXNlZDogYm9vbGVhbiwgcXVldWVkTWVzc2FnZUNvdW50OiBudW1iZXIsIHN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXJ9W119ICovXG4gICAgY29uc3Qgc2Vzc2lvbkRldGFpbHMgPSBbXVxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBBcnJheS5mcm9tKHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmVudHJpZXMoKSkubWFwKChbY2hhbm5lbCwgY2hhbm5lbFN1YnNjcmlwdGlvbnNdKSA9PiB7XG4gICAgICAvKipcbiAgICAgICAqIERldGFpbHMgYnVja2V0cy5cbiAgICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y291bnQ6IG51bWJlciwgZGV0YWlsczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59ICovXG4gICAgICBjb25zdCBkZXRhaWxzQnVja2V0cyA9IG5ldyBNYXAoKVxuXG4gICAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBjaGFubmVsU3Vic2NyaXB0aW9ucykge1xuICAgICAgICBjb25zdCBkZXRhaWxzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoc3Vic2NyaXB0aW9uLmRlYnVnU25hcHNob3QoKSkpXG4gICAgICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KGRldGFpbHMpXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nQnVja2V0ID0gZGV0YWlsc0J1Y2tldHMuZ2V0KGtleSlcblxuICAgICAgICBpZiAoZXhpc3RpbmdCdWNrZXQpIHtcbiAgICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZGV0YWlsc0J1Y2tldHMuc2V0KGtleSwge2NvdW50OiAxLCBkZXRhaWxzfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBjaGFubmVsLFxuICAgICAgICBjb3VudDogY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgICAgZGV0YWlsczogQXJyYXkuZnJvbShkZXRhaWxzQnVja2V0cy52YWx1ZXMoKSkuc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGZvciAoY29uc3Qgc2Vzc2lvbiBvZiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9ucykge1xuICAgICAgLyoqXG4gICAgICAgKiBDaGFubmVsIHN1YnNjcmlwdGlvbiBidWNrZXRzLlxuICAgICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtjaGFubmVsVHlwZTogc3RyaW5nLCBjb3VudDogbnVtYmVyLCBtb2RlbDogc3RyaW5nIHwgbnVsbH0+fSAqL1xuICAgICAgY29uc3QgY2hhbm5lbFN1YnNjcmlwdGlvbkJ1Y2tldHMgPSBuZXcgTWFwKClcblxuICAgICAgZm9yIChjb25zdCB7Y2hhbm5lbFR5cGUsIHN1YnNjcmlwdGlvbn0gb2Ygc2Vzc2lvbi5fY2hhbm5lbFN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc3Vic2NyaXB0aW9uLmRlYnVnU25hcHNob3QoKSlcbiAgICAgICAgY29uc3QgbW9kZWwgPSB0eXBlb2YgZGV0YWlscy5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IGRldGFpbHMubW9kZWwgOiBudWxsXG4gICAgICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KHtjaGFubmVsVHlwZSwgbW9kZWx9KVxuICAgICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLmdldChrZXkpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLnNldChrZXksIHtjaGFubmVsVHlwZSwgY291bnQ6IDEsIG1vZGVsfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjaGFubmVsU3Vic2NyaXB0aW9ucyA9IEFycmF5LmZyb20oY2hhbm5lbFN1YnNjcmlwdGlvbkJ1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KVxuICAgICAgY29uc3Qgc25hcHNob3QgPSB7XG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogc2Vzc2lvbi5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgIGNvbm5lY3Rpb25Db3VudDogc2Vzc2lvbi5fY29ubmVjdGlvbnMuc2l6ZSxcbiAgICAgICAgcGF1c2VkOiBzZXNzaW9uLl9wYXVzZWQsXG4gICAgICAgIHF1ZXVlZE1lc3NhZ2VDb3VudDogc2Vzc2lvbi5fb3V0Ym91bmRRdWV1ZS5sZW5ndGgsXG4gICAgICAgIHN1YnNjcmlwdGlvbkNvdW50OiBzZXNzaW9uLnN1YnNjcmlwdGlvbnMuc2l6ZVxuICAgICAgfVxuICAgICAgY29uc3QgYnVja2V0S2V5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCxcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbnM6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNuYXBzaG90LmNvbm5lY3Rpb25Db3VudCxcbiAgICAgICAgcGF1c2VkOiBzbmFwc2hvdC5wYXVzZWQsXG4gICAgICAgIHN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5zdWJzY3JpcHRpb25Db3VudFxuICAgICAgfSlcbiAgICAgIGNvbnN0IGV4aXN0aW5nQnVja2V0ID0gc2Vzc2lvbkJ1Y2tldHMuZ2V0KGJ1Y2tldEtleSlcblxuICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlc3Npb25CdWNrZXRzLnNldChidWNrZXRLZXksIHtcbiAgICAgICAgICBjb3VudDogMSxcbiAgICAgICAgICBkZXRhaWxzOiB7XG4gICAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCxcbiAgICAgICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zOiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgICAgIGNvbm5lY3Rpb25Db3VudDogc25hcHNob3QuY29ubmVjdGlvbkNvdW50LFxuICAgICAgICAgICAgcGF1c2VkOiBzbmFwc2hvdC5wYXVzZWQsXG4gICAgICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc25hcHNob3Quc3Vic2NyaXB0aW9uQ291bnRcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgICBzZXNzaW9uRGV0YWlscy5wdXNoKHNuYXBzaG90KVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBsaXZlT25seUNoYW5uZWxzOiBBcnJheS5mcm9tKHRoaXMuX2xpdmVPbmx5V2Vic29ja2V0Q2hhbm5lbHMpLFxuICAgICAgcGF1c2VkU2Vzc2lvbnM6IHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLnNpemUsXG4gICAgICByZWdpc3RlcmVkQ2hhbm5lbHM6IEFycmF5LmZyb20odGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMua2V5cygpKSxcbiAgICAgIHJlZ2lzdGVyZWRDb25uZWN0aW9uczogQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3Nlcy5rZXlzKCkpLFxuICAgICAgc2Vzc2lvbkJ1Y2tldHM6IEFycmF5LmZyb20oc2Vzc2lvbkJ1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KSxcbiAgICAgIHNlc3Npb25Db3VudDogdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMuc2l6ZSxcbiAgICAgIHNlc3Npb25zOiBzZXNzaW9uRGV0YWlscy5zb3J0KChhLCBiKSA9PiBiLmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCAtIGEuY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50KSxcbiAgICAgIHN1YnNjcmlwdGlvbkdyb3VwczogdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgIHN1YnNjcmlwdGlvbnNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZGF0YWJhc2UgcG9vbC5cbiAgICovXG4gIGdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBpZiAoIXRoaXMuaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZChpZGVudGlmaWVyKSkge1xuICAgICAgdGhpcy5pbml0aWFsaXplRGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpZ2codGhpcywgXCJkYXRhYmFzZVBvb2xzXCIsIGlkZW50aWZpZXIpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZnJhbWV3b3JrLW93bmVkIGZyb250ZW5kIHRlbmFudCBTUUxpdGUgbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGV9IC0gTGlmZWN5Y2xlIG93bmVyLlxuICAgKi9cbiAgZ2V0RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoKSB7IHJldHVybiB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc2FmZSBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZVtcImluc3BlY3RBbGxcIl0+fSAtIExpZmVjeWNsZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIGluc3BlY3RGcm9udGVuZFRlbmFudFNxbGl0ZUhhbmRsZXMoKSB7IHJldHVybiB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZS5pbnNwZWN0QWxsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0pXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllcikge1xuICAgIHJldHVybiB0aGlzLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oaWRlbnRpZmllcilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIHNjaGVtYSBtZXRhZGF0YSBjYWNoZWQgYnkgZXZlcnkgaW5pdGlhbGl6ZWQgcG9vbCB0aGF0IHRhcmdldHMgdGhlXG4gICAqIHNhbWUgcGh5c2ljYWwgZGF0YWJhc2UgKG1hdGNoZWQgYnkgY29ubmVjdGlvbiByZXVzZSBrZXkpLiBTZXBhcmF0ZSBwb29scyB0aGF0XG4gICAqIHBvaW50IGF0IG9uZSBkYXRhYmFzZSBrZWVwIGluZGVwZW5kZW50IHNjaGVtYSBjYWNoZXMsIHNvIERETCBydW4gdGhyb3VnaCBvbmVcbiAgICogcG9vbCB3b3VsZCBvdGhlcndpc2UgbGVhdmUgdGhlIG90aGVycyByZXBvcnRpbmcgc3RhbGUgdGFibGVzL2NvbHVtbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIENvbm5lY3Rpb24gcmV1c2Uga2V5IGlkZW50aWZ5aW5nIHRoZSBzaGFyZWQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGVzRm9yUmV1c2VLZXkocmV1c2VLZXkpIHtcbiAgICB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb25zQnlSZXVzZUtleS5zZXQoXG4gICAgICByZXVzZUtleSxcbiAgICAgIHRoaXMuc2NoZW1hQ2FjaGVHZW5lcmF0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpICsgMVxuICAgIClcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleSgpID09PSByZXVzZUtleSkge1xuICAgICAgICBwb29sLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IHNjaGVtYS1jYWNoZSBnZW5lcmF0aW9uIGZvciBvbmUgcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIENvbm5lY3Rpb24gcmV1c2Uga2V5IGlkZW50aWZ5aW5nIHRoZSBzaGFyZWQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQ3VycmVudCBzY2hlbWEtY2FjaGUgZ2VuZXJhdGlvbi5cbiAgICovXG4gIHNjaGVtYUNhY2hlR2VuZXJhdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNhY2hlR2VuZXJhdGlvbnNCeVJldXNlS2V5LmdldChyZXVzZUtleSkgfHwgMFxuICB9XG5cbiAgLyoqXG4gICAqIEludmFsaWRhdGVzIHJlY29yZCBtZXRhZGF0YSBvd25lZCBieSBvbmUgY2xvc2VkL2RlbGV0ZWQgcGh5c2ljYWwgdGVuYW50XG4gICAqIGRhdGFiYXNlIHdoaWxlIHByZXNlcnZpbmcgZXZlcnkgb3RoZXIgdGVuYW50IGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gTG9naWNhbCBpZGVudGlmaWVyIHBsdXMgcG9vbCByZXVzZSBrZXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJSZWNvcmRNZXRhZGF0YUZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBPYmplY3QudmFsdWVzKHRoaXMubW9kZWxDbGFzc2VzKSkge1xuICAgICAgbW9kZWxDbGFzcy5jbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzRm9yRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBwb29sIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBkYXRhYmFzZSBwb29sIHR5cGUuXG4gICAqL1xuICBnZXREYXRhYmFzZVBvb2xUeXBlKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGNvbnN0IHBvb2xUeXBlQ2xhc3MgPSBkaWdnKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGlkZW50aWZpZXIpLCBcInBvb2xUeXBlXCIpXG5cbiAgICBpZiAoIXBvb2xUeXBlQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIHBvb2xUeXBlIGdpdmVuIGluIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5yZXNvbHZlVGVzdFNoYXJlZFRyYW5zYWN0aW9uUG9vbFR5cGUoe1xuICAgICAgY29uZmlndXJlZFBvb2xUeXBlOiBwb29sVHlwZUNsYXNzLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiBpZGVudGlmaWVyXG4gICAgfSlcbiAgfVxuXG4gIGdldERhdGFiYXNlVHlwZShpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBjb25zdCBkYXRhYmFzZVR5cGUgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKS50eXBlXG5cbiAgICBpZiAoIWRhdGFiYXNlVHlwZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YWJhc2UgdHlwZSBnaXZlbiBpbiBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG5cbiAgICByZXR1cm4gZGF0YWJhc2VUeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBkaXJlY3RvcnkuXG4gICAqL1xuICBnZXREaXJlY3RvcnkoKSB7XG4gICAgY29uc3QgZGlyZWN0b3J5ID0gdGhpcy5nZXREaXJlY3RvcnlJZkF2YWlsYWJsZSgpXG5cbiAgICBpZiAoIWRpcmVjdG9yeSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGlyZWN0b3J5IGNvbmZpZ3VyZWQgYW5kIHByb2Nlc3MuY3dkIGlzIHVuYXZhaWxhYmxlXCIpXG5cbiAgICByZXR1cm4gZGlyZWN0b3J5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGlyZWN0b3J5IGlmIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgZGlyZWN0b3J5IHdoZW4gdGhlIHJ1bnRpbWUgY2FuIHJlc29sdmUgb25lLlxuICAgKi9cbiAgZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKSB7XG4gICAgaWYgKCF0aGlzLl9kaXJlY3RvcnkpIHtcbiAgICAgIHRoaXMuX2RpcmVjdG9yeSA9IGN1cnJlbnRXb3JraW5nRGlyZWN0b3J5KClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGlyZWN0b3J5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmFja2VuZCBwcm9qZWN0cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb25bXX0gLSBCYWNrZW5kIHByb2plY3RzLlxuICAgKi9cbiAgZ2V0QmFja2VuZFByb2plY3RzKCkgeyByZXR1cm4gdGhpcy5fYmFja2VuZFByb2plY3RzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcGFja2FnZXMuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNQYWNrYWdlW119IC0gUmVnaXN0ZXJlZCBWZWxvY2lvdXMgcGFja2FnZXMuXG4gICAqL1xuICBnZXRQYWNrYWdlcygpIHsgcmV0dXJuIHRoaXMuX3BhY2thZ2VzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYWJpbGl0eSByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IC0gQWJpbGl0eSByZXNvdXJjZSBjbGFzc2VzLlxuICAgKi9cbiAgZ2V0QWJpbGl0eVJlc291cmNlcygpIHsgcmV0dXJuIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhYmlsaXR5IHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IHJlc291cmNlcyAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QWJpbGl0eVJlc291cmNlcyhyZXNvdXJjZXMpIHsgdGhpcy5fYWJpbGl0eVJlc291cmNlcyA9IHJlc291cmNlcyB9XG5cbiAgLyoqXG4gICAqIE1lcmdlcyByZXNvdXJjZSBjbGFzc2VzIGRpc2NvdmVyZWQgZnJvbSB0aGUgYXBwIGFuZCBldmVyeSByZWdpc3RlcmVkIHBhY2thZ2VcbiAgICogaW50byB0aGUgYWJpbGl0eS1yZXNvdXJjZXMgbGlzdC4gYGF1dG9EaXNjb3ZlclJlc291cmNlc2AgcG9wdWxhdGVzIGVhY2ggYmFja2VuZFxuICAgKiBwcm9qZWN0J3MgYGZyb250ZW5kTW9kZWxzYCAoaW5jbHVkaW5nIHBhY2thZ2UgcHJvamVjdHMpLCBzbyB0aGlzIG1ha2VzIGFcbiAgICogcGFja2FnZS1jb250cmlidXRlZCBtb2RlbCdzIGFiaWxpdGllcyByZWFjaCBzdWJzY3JpcHRpb24gYW5kIHBlci1yZWNvcmRcbiAgICogYXV0aG9yaXphdGlvbiBhdXRvbWF0aWNhbGx5IOKAlCBjb25zdW1pbmcgYXBwcyBkbyBub3QgaGF2ZSB0byBoYW5kLXJlZ2lzdGVyXG4gICAqIHBhY2thZ2UgcmVzb3VyY2VzLiBBbHJlYWR5LXByZXNlbnQgY2xhc3NlcyAoZS5nLiBhbiBhcHAncyBleHBsaWNpdGx5LXNldFxuICAgKiByZXNvdXJjZXMpIGFyZSBsZWZ0IHVudG91Y2hlZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX21lcmdlRGlzY292ZXJlZEFiaWxpdHlSZXNvdXJjZXMoKSB7XG4gICAgY29uc3QgbWVyZ2VkID0gWy4uLnRoaXMuX2FiaWxpdHlSZXNvdXJjZXNdXG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQobWVyZ2VkKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLl9iYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGlmICghYmFja2VuZFByb2plY3QuYWJpbGl0eVJlc291cmNlcykgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCBSZXNvdXJjZUNsYXNzIG9mIGJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMpIHtcbiAgICAgICAgaWYgKHNlZW4uaGFzKFJlc291cmNlQ2xhc3MpKSBjb250aW51ZVxuXG4gICAgICAgIHNlZW4uYWRkKFJlc291cmNlQ2xhc3MpXG4gICAgICAgIG1lcmdlZC5wdXNoKFJlc291cmNlQ2xhc3MpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fYWJpbGl0eVJlc291cmNlcyA9IG1lcmdlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBBYmlsaXR5IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0QWJpbGl0eVJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fYWJpbGl0eVJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUZW5hbnQgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRUZW5hbnRSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX3RlbmFudFJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICovXG4gIGdldFRlbmFudERhdGFiYXNlUmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZW5mb3JjZSB0ZW5hbnQgZGF0YWJhc2Ugc2NvcGVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgcmVxdWlyZSBhIHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCkgeyByZXR1cm4gdGhpcy5fZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZT59IC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlcnMuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycygpIHsgcmV0dXJuIHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlci5cbiAgICovXG4gIGdldFRlbmFudERhdGFiYXNlUHJvdmlkZXIoaWRlbnRpZmllcikge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnNbaWRlbnRpZmllcl1cblxuICAgIGlmICghcHJvdmlkZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGNvbmZpZ3VyZWQgZm9yIGRhdGFiYXNlIGlkZW50aWZpZXI6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIHJldHVybiBwcm92aWRlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnRzIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXR0YWNobWVudHNDb25maWd1cmF0aW9ufSAtIEF0dGFjaG1lbnRzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRBdHRhY2htZW50c0NvbmZpZ3VyYXRpb24oKSB7IHJldHVybiB0aGlzLl9hdHRhY2htZW50cyB8fCB7fSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJvdXRlUmVzb2x2ZXJIb29rVHlwZVtdfSAtIFJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKi9cbiAgZ2V0Um91dGVSZXNvbHZlckhvb2tzKCkgeyByZXR1cm4gdGhpcy5fcm91dGVSZXNvbHZlckhvb2tzIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgcm91dGUgcmVzb2x2ZXIgaG9vay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUm91dGVSZXNvbHZlckhvb2tUeXBlfSBob29rIC0gUm91dGUgcmVzb2x2ZXIgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWRkUm91dGVSZXNvbHZlckhvb2soaG9vaykge1xuICAgIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcy5wdXNoKGhvb2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYWJpbGl0eSByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBBYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBYmlsaXR5UmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fYWJpbGl0eVJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZW5hbnQgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBUZW5hbnQgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudFJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX3RlbmFudFJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSByZXNvbHZlciAtIFRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGVuYW50RGF0YWJhc2VSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBlbmZvcmNlIHRlbmFudCBkYXRhYmFzZSBzY29wZXMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3VmFsdWUgLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgcmVxdWlyZSBhIHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRFbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMobmV3VmFsdWUpIHsgdGhpcy5fZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gbmV3VmFsdWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXJzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZT59IHByb3ZpZGVycyAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXJzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycyhwcm92aWRlcnMpIHsgdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgPSBwcm92aWRlcnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZW52aXJvbm1lbnQuXG4gICAqL1xuICBnZXRFbnZpcm9ubWVudCgpIHsgcmV0dXJuIGRpZ2codGhpcywgXCJfZW52aXJvbm1lbnRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXF1ZXN0IHRpbWVvdXQgbXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gUmVxdWVzdCB0aW1lb3V0IGluIHNlY29uZHMuXG4gICAqL1xuICBnZXRSZXF1ZXN0VGltZW91dE1zKCkge1xuICAgIGNvbnN0IGVudlRpbWVvdXQgPSB0aGlzLl9wYXJzZVJlcXVlc3RUaW1lb3V0U2Vjb25kcyhwcm9jZXNzLmVudi5WRUxPQ0lPVVNfUkVRVUVTVF9USU1FT1VUX01TKVxuICAgIGNvbnN0IHZhbHVlID0gdHlwZW9mIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyB0aGlzLl9yZXF1ZXN0VGltZW91dE1zKClcbiAgICAgIDogdGhpcy5fcmVxdWVzdFRpbWVvdXRNc1xuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHR5cGVvZiBlbnZUaW1lb3V0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZUaW1lb3V0KSkgcmV0dXJuIGVudlRpbWVvdXRcblxuICAgIHJldHVybiA2MFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgcmVxdWVzdCB0aW1lb3V0IHNlY29uZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSByYXdWYWx1ZSAtIEVudiB2YWx1ZS5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaW1lb3V0IGluIHNlY29uZHMuXG4gICAqL1xuICBfcGFyc2VSZXF1ZXN0VGltZW91dFNlY29uZHMocmF3VmFsdWUpIHtcbiAgICBpZiAocmF3VmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgdHJpbW1lZCA9IHJhd1ZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG5cbiAgICBpZiAoIXRyaW1tZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IG1hdGNoID0gdHJpbW1lZC5tYXRjaCgvXihcXGQrKD86XFwuXFxkKyk/KShtc3xzKT8kLylcblxuICAgIGlmICghbWF0Y2gpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IG51bWVyaWMgPSBOdW1iZXIobWF0Y2hbMV0pXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShudW1lcmljKSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgdW5pdCA9IG1hdGNoWzJdXG5cbiAgICBpZiAodW5pdCA9PT0gXCJtc1wiKSByZXR1cm4gbnVtZXJpYyAvIDEwMDBcbiAgICBpZiAodW5pdCA9PT0gXCJzXCIpIHJldHVybiBudW1lcmljXG5cbiAgICBpZiAodHJpbW1lZC5pbmNsdWRlcyhcIi5cIikpIHJldHVybiBudW1lcmljXG4gICAgaWYgKG51bWVyaWMgPj0gMTAwMCkgcmV0dXJuIG51bWVyaWMgLyAxMDAwXG5cbiAgICByZXR1cm4gbnVtZXJpY1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVudmlyb25tZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3RW52aXJvbm1lbnQgLSBOZXcgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEVudmlyb25tZW50KG5ld0Vudmlyb25tZW50KSB7IHRoaXMuX2Vudmlyb25tZW50ID0gbmV3RW52aXJvbm1lbnQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5kZWZhdWx0Q29uc29sZV0gLSBXaGV0aGVyIGRlZmF1bHQgY29uc29sZS5cbiAgICogQHJldHVybnMge1JlcXVpcmVkPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImNvbnNvbGVcIiB8IFwiZmlsZVwiIHwgXCJsZXZlbHNcIj4+ICYgUGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiZGlyZWN0b3J5XCIgfCBcImZpbGVQYXRoXCI+ICYgUGFydGlhbDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJvdXRwdXRzXCIgfCBcImxvZ2dlcnNcIj4+fSAtIFRoZSBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRMb2dnaW5nQ29uZmlndXJhdGlvbih7ZGVmYXVsdENvbnNvbGV9ID0ge30pIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudCA9IHRoaXMuZ2V0RW52aXJvbm1lbnQoKVxuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICBjb25zdCBkaXJlY3RvcnkgPSB0aGlzLl9sb2dnaW5nPy5kaXJlY3RvcnkgfHwgZW52aXJvbm1lbnRIYW5kbGVyLmdldERlZmF1bHRMb2dEaXJlY3Rvcnkoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5fbG9nZ2luZz8uZmlsZVBhdGggfHwgZW52aXJvbm1lbnRIYW5kbGVyLmdldExvZ0ZpbGVQYXRoKHtjb25maWd1cmF0aW9uOiB0aGlzLCBkaXJlY3RvcnksIGVudmlyb25tZW50fSlcbiAgICBjb25zdCBjb25zb2xlT3ZlcnJpZGUgPSB0aGlzLl9sb2dnaW5nPy5jb25zb2xlXG4gICAgY29uc3QgaGFzTG9nZ2luZ0NvbmZpZyA9IEJvb2xlYW4odGhpcy5fbG9nZ2luZylcbiAgICBjb25zdCBmaWxlTG9nZ2luZyA9IGhhc0xvZ2dpbmdDb25maWcgPyAodGhpcy5fbG9nZ2luZz8uZmlsZSA/PyBCb29sZWFuKGZpbGVQYXRoKSkgOiBmYWxzZVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRMZXZlbHMgPSB0aGlzLl9sb2dnaW5nPy5sZXZlbHNcbiAgICBjb25zdCBpbmNsdWRlTG93TGV2ZWxEZWJ1ZyA9IHRoaXMuX2xvZ2dpbmc/LmRlYnVnTG93TGV2ZWwgPT09IHRydWVcbiAgICBjb25zdCBsb2dnZXJzID0gdGhpcy5fbG9nZ2luZz8ubG9nZ2Vyc1xuXG4gICAgY29uc3QgY29uc29sZURlZmF1bHQgPSBkZWZhdWx0Q29uc29sZSAhPT0gdW5kZWZpbmVkID8gZGVmYXVsdENvbnNvbGUgOiB0cnVlXG4gICAgY29uc3QgY29uc29sZUxvZ2dpbmcgPSBjb25zb2xlT3ZlcnJpZGUgIT09IHVuZGVmaW5lZCA/IGNvbnNvbGVPdmVycmlkZSA6IGNvbnNvbGVEZWZhdWx0XG5cbiAgICAvKipcbiAgICAgKiBEZWZhdWx0IGxldmVscy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8XCJkZWJ1Zy1sb3ctbGV2ZWxcIiB8IFwiZGVidWdcIiB8IFwiaW5mb1wiIHwgXCJ3YXJuXCIgfCBcImVycm9yXCI+fSAqL1xuICAgIGNvbnN0IGRlZmF1bHRMZXZlbHMgPSBbXCJpbmZvXCIsIFwid2FyblwiLCBcImVycm9yXCJdXG5cbiAgICBpZiAoaW5jbHVkZUxvd0xldmVsRGVidWcpIGRlZmF1bHRMZXZlbHMudW5zaGlmdChcImRlYnVnLWxvdy1sZXZlbFwiKVxuXG4gICAgY29uc3QgbGV2ZWxzID0gY29uZmlndXJlZExldmVscyB8fCBkZWZhdWx0TGV2ZWxzXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29uc29sZTogY29uc29sZUxvZ2dpbmcsXG4gICAgICBkaXJlY3RvcnksXG4gICAgICBmaWxlOiBmaWxlTG9nZ2luZyA/PyBmYWxzZSxcbiAgICAgIGZpbGVQYXRoLFxuICAgICAgbG9nZ2VycyxcbiAgICAgIGxldmVscyxcbiAgICAgIG91dHB1dHM6IHRoaXMuX2xvZ2dpbmc/Lm91dHB1dHNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY29uZmlndXJhdGlvbi1vd25lZCBzdHJ1Y3R1cmVkIGxvZ2dpbmcgcmVkYWN0b3IuXG4gICAqIEByZXR1cm5zIHtMb2dSZWRhY3Rvcn0gLSBTdHJ1Y3R1cmVkIGxvZ2dpbmcgcmVkYWN0b3IuXG4gICAqL1xuICBnZXRMb2dSZWRhY3RvcigpIHtcbiAgICByZXR1cm4gdGhpcy5fbG9nUmVkYWN0b3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBxdWVyeSBsb2dnaW5nIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0YWJhc2UgcXVlcnkgbG9nZ2luZyBpcyBlbmFibGVkLlxuICAgKi9cbiAgZ2V0UXVlcnlMb2dnaW5nRW5hYmxlZCgpIHtcbiAgICBpZiAodGhpcy5fbG9nZ2luZz8ucXVlcnlMb2dnaW5nICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLl9sb2dnaW5nLnF1ZXJ5TG9nZ2luZ1xuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnQoKSAhPT0gXCJ0ZXN0XCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBnZW5lcmF0aW9uIGxpZmVjeWNsZSB2YWx1ZXMgZnJvbSB0aGVpciByYXcgY29uZmlnLCBlbnZpcm9ubWVudCxcbiAgICogYW5kIEFQSSBzb3VyY2VzIGJlZm9yZSBhcHBseWluZyBkZWZhdWx0cy4gRGVyaXZlZCBkZWZhdWx0cyBhcmUgZGVsaWJlcmF0ZWx5XG4gICAqIGFic2VudCBmcm9tIHRoZSBzb3VyY2UgbGlzdCwgc28gYW4gQVBJIHJlY292ZXJ5IHN0YXRlIGNhbiBvdmVycmlkZSBhblxuICAgKiBJRC1vbmx5IGNvbmZpZ3VyYXRpb24gd2l0aG91dCBjcmVhdGluZyBhIGZhbHNlIGNvbmZsaWN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gRXhwbGljaXQgQVBJIHZhbHVlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZX0gW2FyZ3MuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZV0gLSBFeHBsaWNpdCBib290IHN0YXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MubGlmZWN5Y2xlU29ja2V0UGF0aF0gLSBFeHBsaWNpdCBsaWZlY3ljbGUgc29ja2V0IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zb3VyY2VOYW1lXSAtIEh1bWFuLXJlYWRhYmxlIEFQSSBvd25lci5cbiAgICogQHJldHVybnMge3tnZW5lcmF0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogaW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlIHwgXCJhY3RpdmVcIiwgbGlmZWN5Y2xlU29ja2V0UGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBSZXNvbHZlZCBsaWZlY3ljbGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe2dlbmVyYXRpb25JZDogZXhwbGljaXRHZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoLCBzb3VyY2VOYW1lID0gXCJiYWNrZ3JvdW5kIGpvYnMgQVBJXCJ9ID0ge30pIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmFja2dyb3VuZEpvYnMgfHwge31cbiAgICBjb25zdCBnZW5lcmF0aW9uRW52aXJvbm1lbnQgPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudiB8fCB7fVxuICAgIGNvbnN0IGdlbmVyYXRpb25JZCA9IHJlc29sdmVHZW5lcmF0aW9uSWQoW1xuICAgICAge25hbWU6IFwiYmFja2dyb3VuZEpvYnMuZ2VuZXJhdGlvbklkXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJnZW5lcmF0aW9uSWRcIikgJiYgY29uZmlndXJlZC5nZW5lcmF0aW9uSWQgIT09IHVuZGVmaW5lZCwgdmFsdWU6IGNvbmZpZ3VyZWQuZ2VuZXJhdGlvbklkfSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRFwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGdlbmVyYXRpb25FbnZpcm9ubWVudCwgXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSURcIiksIHZhbHVlOiBnZW5lcmF0aW9uRW52aXJvbm1lbnQuVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBnZW5lcmF0aW9uSWRgLCBwcmVzZW50OiBleHBsaWNpdEdlbmVyYXRpb25JZCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogZXhwbGljaXRHZW5lcmF0aW9uSWR9XG4gICAgXSlcbiAgICBjb25zdCBpbml0aWFsR2VuZXJhdGlvblN0YXRlID0gcmVzb2x2ZUluaXRpYWxHZW5lcmF0aW9uU3RhdGUoW1xuICAgICAge25hbWU6IFwiYmFja2dyb3VuZEpvYnMuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZVwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGNvbmZpZ3VyZWQsIFwiaW5pdGlhbEdlbmVyYXRpb25TdGF0ZVwiKSAmJiBjb25maWd1cmVkLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgIT09IHVuZGVmaW5lZCwgdmFsdWU6IGNvbmZpZ3VyZWQuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZX0sXG4gICAgICB7bmFtZTogXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0lOSVRJQUxfR0VORVJBVElPTl9TVEFURVwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGdlbmVyYXRpb25FbnZpcm9ubWVudCwgXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0lOSVRJQUxfR0VORVJBVElPTl9TVEFURVwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0lOSVRJQUxfR0VORVJBVElPTl9TVEFURX0sXG4gICAgICB7bmFtZTogYCR7c291cmNlTmFtZX0gaW5pdGlhbEdlbmVyYXRpb25TdGF0ZWAsIHByZXNlbnQ6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlfVxuICAgIF0sIGdlbmVyYXRpb25JZClcbiAgICBjb25zdCBsaWZlY3ljbGVTb2NrZXRQYXRoID0gcmVzb2x2ZUxpZmVjeWNsZVNvY2tldFBhdGgoW1xuICAgICAge25hbWU6IFwiYmFja2dyb3VuZEpvYnMubGlmZWN5Y2xlU29ja2V0UGF0aFwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGNvbmZpZ3VyZWQsIFwibGlmZWN5Y2xlU29ja2V0UGF0aFwiKSAmJiBjb25maWd1cmVkLmxpZmVjeWNsZVNvY2tldFBhdGggIT09IHVuZGVmaW5lZCwgdmFsdWU6IGNvbmZpZ3VyZWQubGlmZWN5Y2xlU29ja2V0UGF0aH0sXG4gICAgICB7bmFtZTogXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0xJRkVDWUNMRV9TT0NLRVRfUEFUSFwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGdlbmVyYXRpb25FbnZpcm9ubWVudCwgXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0xJRkVDWUNMRV9TT0NLRVRfUEFUSFwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0xJRkVDWUNMRV9TT0NLRVRfUEFUSH0sXG4gICAgICB7bmFtZTogYCR7c291cmNlTmFtZX0gbGlmZWN5Y2xlU29ja2V0UGF0aGAsIHByZXNlbnQ6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRofVxuICAgIF0sIGdlbmVyYXRpb25JZClcblxuICAgIHJldHVybiB7Z2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEByZXR1cm5zIHtPbWl0PFJlcXVpcmVkPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24+LCBcImFkYXB0ZXJcIiB8IFwicmV0ZW50aW9uXCIgfCBcImdlbmVyYXRpb25JZFwiIHwgXCJsaWZlY3ljbGVTb2NrZXRQYXRoXCI+ICYge2dlbmVyYXRpb25JZD86IHN0cmluZywgbGlmZWN5Y2xlU29ja2V0UGF0aD86IHN0cmluZywgcmV0ZW50aW9uOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUmVzb2x2ZWRCYWNrZ3JvdW5kSm9ic1JldGVudGlvbkNvbmZpZ3VyYXRpb259fSAtIEJhY2tncm91bmQgam9icyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKSB7XG4gICAgY29uc3QgcHJvY2Vzc0Vudmlyb25tZW50ID0gZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnZcbiAgICBjb25zdCBlbnZIb3N0ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0hPU1RcbiAgICBjb25zdCBlbnZQb3J0UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPUlRcbiAgICBjb25zdCBlbnZEYXRhYmFzZUlkZW50aWZpZXIgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfREFUQUJBU0VfSURFTlRJRklFUlxuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnRGb3JrZWRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTUFYX0NPTkNVUlJFTlRfRk9SS0VEX0pPQlNcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX01BWF9DT05DVVJSRU5UX0lOTElORV9KT0JTXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ291bnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9DT1VOVFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfQ09OQ1VSUkVOQ1lcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX0pPQlNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX01BWF9SU1NfQllURVNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX0xJRkVUSU1FX01TXG4gICAgY29uc3QgZW52RGlzcGF0Y2hTdHJhdGVneSA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19ESVNQQVRDSF9TVFJBVEVHWVxuICAgIGNvbnN0IGVudlBvbGxJbnRlcnZhbFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT0xMX0lOVEVSVkFMX01TXG4gICAgY29uc3QgZW52Sm9iVGltZW91dFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19KT0JfVElNRU9VVF9NU1xuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9IGVudk1heENvbmN1cnJlbnRGb3JrZWRSYXcgPyBOdW1iZXIoZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50ID0gZW52TWF4Q29uY3VycmVudFJhdyA/IE51bWJlcihlbnZNYXhDb25jdXJyZW50UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvdW50ID0gZW52UG9vbGVkUnVubmVyQ291bnRSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyQ291bnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhKb2JzID0gZW52UG9vbGVkUnVubmVyTWF4Sm9ic1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb2xsSW50ZXJ2YWwgPSBlbnZQb2xsSW50ZXJ2YWxSYXcgPyBOdW1iZXIoZW52UG9sbEludGVydmFsUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudkpvYlRpbWVvdXQgPSBlbnZKb2JUaW1lb3V0UmF3ID8gTnVtYmVyKGVudkpvYlRpbWVvdXRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JhY2tncm91bmRKb2JzIHx8IHt9XG4gICAgY29uc3Qge2dlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aH0gPSB0aGlzLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoKVxuICAgIGNvbnN0IG1vZGUgPSBjb25maWd1cmVkLm1vZGUgPT09IHVuZGVmaW5lZCA/IFwiYmFja2dyb3VuZFwiIDogY29uZmlndXJlZC5tb2RlXG5cbiAgICBpZiAobW9kZSAhPT0gXCJiYWNrZ3JvdW5kXCIgJiYgbW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgYmFja2dyb3VuZEpvYnMubW9kZSBtdXN0IGJlIFwiYmFja2dyb3VuZFwiIG9yIFwiaW5saW5lXCIsIGdvdDogJHtTdHJpbmcobW9kZSl9YClcbiAgICB9XG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMxKVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IGNvbmZpZ3VyZWQuZGF0YWJhc2VJZGVudGlmaWVyIHx8IGVudkRhdGFiYXNlSWRlbnRpZmllciB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICAgIDogKHR5cGVvZiBlbnZNYXhDb25jdXJyZW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZNYXhDb25jdXJyZW50KSAmJiBlbnZNYXhDb25jdXJyZW50ID49IDEgPyBlbnZNYXhDb25jdXJyZW50IDogNClcbiAgICBjb25zdCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IHR5cGVvZiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgICA6ICh0eXBlb2YgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52TWF4Q29uY3VycmVudEZvcmtlZCkgJiYgZW52TWF4Q29uY3VycmVudEZvcmtlZCA+PSAxID8gZW52TWF4Q29uY3VycmVudEZvcmtlZCA6IDQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyQ291bnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50KSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50ID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudFxuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lckNvdW50XCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lckNvdW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgZW52UG9vbGVkUnVubmVyQ291bnQgPj0gMSA/IGVudlBvb2xlZFJ1bm5lckNvdW50IDogNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyQ29uY3VycmVuY3lcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+PSAxID8gZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgOiAxKVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heEpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhKb2JzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyTWF4Sm9icykgJiYgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4Sm9icyA6IDEwMClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcykgJiYgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzIDogNTEyICogMTAyNCAqIDEwMjQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIDogNjAgKiA2MCAqIDEwMDApXG4gICAgY29uc3QgZGlzcGF0Y2hTdHJhdGVneVJhdyA9IGNvbmZpZ3VyZWQuZGlzcGF0Y2hTdHJhdGVneSB8fCBlbnZEaXNwYXRjaFN0cmF0ZWd5XG4gICAgY29uc3QgZGlzcGF0Y2hTdHJhdGVneSA9IGRpc3BhdGNoU3RyYXRlZ3lSYXcgPT09IFwicG9sbGluZ1wiID8gXCJwb2xsaW5nXCIgOiBcImJlYWNvblwiXG4gICAgY29uc3QgcG9sbEludGVydmFsTXMgPSB0eXBlb2YgY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNc1xuICAgICAgOiAodHlwZW9mIGVudlBvbGxJbnRlcnZhbCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9sbEludGVydmFsKSAmJiBlbnZQb2xsSW50ZXJ2YWwgPj0gMSA/IGVudlBvbGxJbnRlcnZhbCA6IDEwMDApXG4gICAgY29uc3QgcXVldWVzID0gY29uZmlndXJlZC5xdWV1ZXMgJiYgdHlwZW9mIGNvbmZpZ3VyZWQucXVldWVzID09PSBcIm9iamVjdFwiID8gY29uZmlndXJlZC5xdWV1ZXMgOiB7fVxuICAgIC8vIEFuIGV4cGxpY2l0IGNvbmZpZyB2YWx1ZSB3aW5zIG92ZXIgdGhlIGVudiB2YXIg4oCUIGluY2x1ZGluZyBgbnVsbGAvYDBgLFxuICAgIC8vIHdoaWNoIGRpc2FibGUgdGhlIGJhY2tzdG9wIGV2ZW4gd2hlbiB0aGUgZW52aXJvbm1lbnQgc2V0cyBhIGRlZmF1bHQuXG4gICAgLy8gT25seSBmYWxsIHRocm91Z2ggdG8gdGhlIGVudiB2YXIgd2hlbiBjb25maWcgb21pdHMgYGpvYlRpbWVvdXRNc2AgZW50aXJlbHkuXG4gICAgY29uc3Qgam9iVGltZW91dE1zID0gXCJqb2JUaW1lb3V0TXNcIiBpbiBjb25maWd1cmVkXG4gICAgICA/ICh0eXBlb2YgY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgPiAwID8gY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgOiBudWxsKVxuICAgICAgOiAodHlwZW9mIGVudkpvYlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudkpvYlRpbWVvdXQpICYmIGVudkpvYlRpbWVvdXQgPiAwID8gZW52Sm9iVGltZW91dCA6IG51bGwpXG4gICAgY29uc3QgY29uZmlndXJlZFJldGVudGlvbiA9IGNvbmZpZ3VyZWQucmV0ZW50aW9uICYmIHR5cGVvZiBjb25maWd1cmVkLnJldGVudGlvbiA9PT0gXCJvYmplY3RcIiA/IGNvbmZpZ3VyZWQucmV0ZW50aW9uIDoge31cbiAgICBjb25zdCByZXRlbnRpb24gPSB7XG4gICAgICBjb21wbGV0ZWRUdGxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXMgPT09IFwibnVtYmVyXCIgfHwgY29uZmlndXJlZFJldGVudGlvbi5jb21wbGV0ZWRUdGxNcyA9PT0gbnVsbFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXNcbiAgICAgICAgOiA3ICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgICAgIGZhaWxlZFR0bE1zOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNcyA9PT0gXCJudW1iZXJcIiB8fCBjb25maWd1cmVkUmV0ZW50aW9uLmZhaWxlZFR0bE1zID09PSBudWxsXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNc1xuICAgICAgICA6IDMwICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgICAgIGJhdGNoU2l6ZTogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplID4gMFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplXG4gICAgICAgIDogMTAwMCxcbiAgICAgIHN3ZWVwSW50ZXJ2YWxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zID4gMFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zXG4gICAgICAgIDogNjAgKiA2MCAqIDEwMDBcbiAgICB9XG5cbiAgICBjb25zdCBqb2JDbGFzc2VzID0gdGhpcy5nZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpXG5cbiAgICByZXR1cm4ge2hvc3QsIHBvcnQsIGRhdGFiYXNlSWRlbnRpZmllciwgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMsIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzLCBtb2RlLCBwb29sZWRSdW5uZXJDb3VudCwgcG9vbGVkUnVubmVyQ29uY3VycmVuY3ksIHBvb2xlZFJ1bm5lck1heEpvYnMsIHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzLCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zLCBkaXNwYXRjaFN0cmF0ZWd5LCBwb2xsSW50ZXJ2YWxNcywgcXVldWVzLCBqb2JDbGFzc2VzLCBqb2JUaW1lb3V0TXMsIHJldGVudGlvbiwgZ2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc3RhdGljYWxseSByZWdpc3RlcmVkIHBvcnRhYmxlIGJhY2tncm91bmQgam9icy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2xhc3NbXX0gLSBDb25maWd1cmVkIGpvYiBjbGFzc2VzLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYkNsYXNzZXMoKSB7XG4gICAgY29uc3Qgam9iQ2xhc3NlcyA9IHRoaXMuX2JhY2tncm91bmRKb2JzPy5qb2JDbGFzc2VzXG5cbiAgICBpZiAoam9iQ2xhc3NlcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoam9iQ2xhc3NlcykpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJiYWNrZ3JvdW5kSm9icy5qb2JDbGFzc2VzIG11c3QgYmUgYW4gYXJyYXlcIilcblxuICAgIHJldHVybiBbLi4uam9iQ2xhc3Nlc11cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbmQgbWVtb2l6ZXMgb25lIGJhY2tncm91bmQtam9icyBhZGFwdGVyIGZvciB0aGlzIGNvbmZpZ3VyYXRpb24gbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7QmFja2dyb3VuZEpvYnNBZGFwdGVyfSAtIEFjdGl2ZSBhZGFwdGVyLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uKSByZXR1cm4gdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbi5hZGFwdGVyXG5cbiAgICBjb25zdCBjb25maWd1cmVkQWRhcHRlciA9IHRoaXMuX2JhY2tncm91bmRKb2JzPy5hZGFwdGVyXG4gICAgY29uc3QgYWRhcHRlciA9IHR5cGVvZiBjb25maWd1cmVkQWRhcHRlciA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGNvbmZpZ3VyZWRBZGFwdGVyKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgIDogKGNvbmZpZ3VyZWRBZGFwdGVyIHx8IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuY3JlYXRlQmFja2dyb3VuZEpvYnNBZGFwdGVyKHtjb25maWd1cmF0aW9uOiB0aGlzfSkpXG5cbiAgICBpZiAoIShhZGFwdGVyIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYnNBZGFwdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmFkYXB0ZXIgbXVzdCBiZSBhIEJhY2tncm91bmRKb2JzQWRhcHRlciBpbnN0YW5jZSBvciBhIHN5bmNocm9ub3VzIGZhY3RvcnkgcmV0dXJuaW5nIG9uZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPSB7XG4gICAgICBhZGFwdGVyLFxuICAgICAgY2xvc2luZzogZmFsc2UsXG4gICAgICBjbG9zZVByb21pc2U6IHVuZGVmaW5lZCxcbiAgICAgIHJlYWR5UHJvbWlzZTogdW5kZWZpbmVkXG4gICAgfVxuICAgIHJldHVybiBhZGFwdGVyXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSBhY3F1aXJlcyB0aGUgZXhhY3QgcmVhZHkgYWRhcHRlciBmb3IgdGhlIGFjdGl2ZSBsaWZlY3ljbGUuXG4gICAqIEEgY2xvc2UgdGhhdCBjbGFpbXMgdGhlIGdlbmVyYXRpb24gd2hpbGUgcmVhZGluZXNzIGlzIHBlbmRpbmcgd2luczogdGhpc1xuICAgKiBvcGVyYXRpb24gd2FpdHMgZm9yIHRoYXQgY2xvc2UsIGNyZWF0ZXMgdGhlIG5leHQgZ2VuZXJhdGlvbiwgcmVhZGllcyBpdCxcbiAgICogYW5kIHJldHVybnMgb25seSB0aGF0IGxpdmUgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJhY2tncm91bmRKb2JzQWRhcHRlcj59IC0gRXhhY3QgcmVhZHkgYWRhcHRlciBnZW5lcmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBkYXRhYmFzZUNsb3NlUHJvbWlzZSA9IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcblxuICAgICAgaWYgKGRhdGFiYXNlQ2xvc2VQcm9taXNlKSB7XG4gICAgICAgIGF3YWl0IGRhdGFiYXNlQ2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRoaXMuZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG5cbiAgICAgIGlmICghZ2VuZXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGFkYXB0ZXIgZ2VuZXJhdGlvbiB3YXMgbm90IGNyZWF0ZWRcIilcblxuICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2luZykge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlYWR5UHJvbWlzZSA9IGdlbmVyYXRpb24ucmVhZHlQcm9taXNlIHx8IFByb21pc2UucmVzb2x2ZSgpLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLmFkYXB0ZXIuZW5zdXJlUmVhZHkoKVxuICAgICAgfSlcblxuICAgICAgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPSByZWFkeVByb21pc2VcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcmVhZHlQcm9taXNlXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPT09IHJlYWR5UHJvbWlzZSkgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2luZykge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uICE9PSBnZW5lcmF0aW9uKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4gZ2VuZXJhdGlvbi5hZGFwdGVyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRpZXMgdGhlIGFjdGl2ZSBhZGFwdGVyIG9uY2UgcGVyIGxpZmVjeWNsZS4gQSBmYWlsZWQgYXR0ZW1wdCByZW1haW5zIHJldHJ5YWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUJhY2tncm91bmRKb2JzQWRhcHRlclJlYWR5KCkge1xuICAgIGF3YWl0IHRoaXMuYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGhlYWx0aCB3aXRob3V0IHJlc29sdmluZyBwZXJzaXN0ZW5jZSBpbiBub24tZHVyYWJsZSBpbmxpbmUgbW9kZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNIZWFsdGg+fSAtIEN1cnJlbnQgaGVhbHRoLlxuICAgKi9cbiAgYXN5bmMgYmFja2dyb3VuZEpvYnNIZWFsdGgoKSB7XG4gICAgaWYgKHRoaXMuZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5tb2RlID09PSBcImlubGluZVwiKSByZXR1cm4ge3JlYWR5OiB0cnVlfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IGF3YWl0IHRoaXMuYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcblxuICAgIHJldHVybiBhd2FpdCBhZGFwdGVyLmhlYWx0aCgpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoZSByZXNvbHZlZCBhZGFwdGVyIG9uY2UgYW5kIGNsZWFycyBsaWZlY3ljbGUgY2FjaGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbG9zZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlQmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG5cbiAgICBpZiAoIWdlbmVyYXRpb24pIHJldHVyblxuICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG5cbiAgICBnZW5lcmF0aW9uLmNsb3NpbmcgPSB0cnVlXG4gICAgY29uc3QgY2xvc2VQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICAgIGNvbnN0IGNsb3NlRXJyb3JzID0gW11cblxuICAgICAgaWYgKGdlbmVyYXRpb24ucmVhZHlQcm9taXNlKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2VcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLmFkYXB0ZXIuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGNsb3NlRXJyb3JzWzBdXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGNsb3NlRXJyb3JzLCBcIkZhaWxlZCB0byByZWFkeSBhbmQgY2xvc2UgdGhlIGJhY2tncm91bmQtam9icyBhZGFwdGVyXCIpXG4gICAgfSkoKVxuXG4gICAgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UgPSBjbG9zZVByb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbG9zZVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPT09IGdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb259IGJhY2tncm91bmRKb2JzIC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZyhiYWNrZ3JvdW5kSm9icykge1xuICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uICYmIGJhY2tncm91bmRKb2JzLmFkYXB0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlcGxhY2UgYmFja2dyb3VuZEpvYnMuYWRhcHRlciBkdXJpbmcgYW4gYWN0aXZlIGFkYXB0ZXIgbGlmZWN5Y2xlOyBjbG9zZSBpdCBmaXJzdFwiKVxuICAgIH1cblxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmFja2dyb3VuZEpvYnMsIGJhY2tncm91bmRKb2JzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhY3RpdmUgQmVhY29uIGNvbmZpZ3VyYXRpb24uIEJlYWNvbiBpcyBvcHQtaW46IGl0XG4gICAqIHN0YXlzIGRpc2FibGVkIHVubGVzcyB0aGUgYXBwIHBhc3NlcyBgYmVhY29uOiB7aG9zdCwgcG9ydH1gIC9cbiAgICogYGJlYWNvbjoge2luUHJvY2VzczogdHJ1ZX1gLCBjYWxscyBgc2V0QmVhY29uQ29uZmlnKHsuLi59KWAsIG9yXG4gICAqIHNldHMgdGhlIGBWRUxPQ0lPVVNfQkVBQ09OX0hPU1RgIC8gYFZFTE9DSU9VU19CRUFDT05fUE9SVGAgZW52IHZhcnMuXG4gICAqIFNldHRpbmcgYGVuYWJsZWQ6IGZhbHNlYCBleHBsaWNpdGx5IGRpc2FibGVzIGl0IGV2ZW4gd2hlbiBlbnYgdmFyc1xuICAgKiBhcmUgcHJlc2VudCAodXNlZnVsIGZvciB0ZXN0cykuIFdoZW4gYGluUHJvY2VzczogdHJ1ZWAgaXMgc2V0LFxuICAgKiBlbnYtdmFyIGhvc3QvcG9ydCBhcmUgaWdub3JlZCDigJQgY29kZS1sZXZlbCBjb25maWcgd2lucy5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBob3N0OiBzdHJpbmcsIHBvcnQ6IG51bWJlciwgcGVlclR5cGU/OiBzdHJpbmcsIGluUHJvY2VzczogYm9vbGVhbiwgdW5yZWFjaGFibGVSZXBvcnRNczogbnVtYmVyfX0gLSBCZWFjb24gY29uZmlndXJhdGlvbiB3aXRoIGRlZmF1bHRzIGFwcGxpZWQuXG4gICAqL1xuICBnZXRCZWFjb25Db25maWcoKSB7XG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JlYWNvbiB8fCB7fVxuICAgIGNvbnN0IGluUHJvY2VzcyA9IGNvbmZpZ3VyZWQuaW5Qcm9jZXNzID09PSB0cnVlXG5cbiAgICBpZiAoaW5Qcm9jZXNzICYmIChjb25maWd1cmVkLmhvc3QgfHwgdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJlYWNvbiBjb25maWd1cmF0aW9uOiBgaW5Qcm9jZXNzOiB0cnVlYCBpcyBtdXR1YWxseSBleGNsdXNpdmUgd2l0aCBgaG9zdGAvYHBvcnRgLiBVc2Ugb25lIG9yIHRoZSBvdGhlci5cIilcbiAgICB9XG5cbiAgICBjb25zdCBlbnZIb3N0ID0gaW5Qcm9jZXNzID8gdW5kZWZpbmVkIDogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JFQUNPTl9IT1NUXG4gICAgY29uc3QgZW52UG9ydFJhdyA9IGluUHJvY2VzcyA/IHVuZGVmaW5lZCA6IHByb2Nlc3MuZW52LlZFTE9DSU9VU19CRUFDT05fUE9SVFxuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMwKVxuXG4gICAgbGV0IGVuYWJsZWRcblxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZC5lbmFibGVkID09PSBcImJvb2xlYW5cIikge1xuICAgICAgZW5hYmxlZCA9IGNvbmZpZ3VyZWQuZW5hYmxlZFxuICAgIH0gZWxzZSB7XG4gICAgICBlbmFibGVkID0gQm9vbGVhbihpblByb2Nlc3MgfHwgY29uZmlndXJlZC5ob3N0IHx8IGNvbmZpZ3VyZWQucG9ydCB8fCBlbnZIb3N0IHx8IGVudlBvcnQpXG4gICAgfVxuXG4gICAgY29uc3QgdW5yZWFjaGFibGVSZXBvcnRNcyA9IHJlc29sdmVCZWFjb25VbnJlYWNoYWJsZVJlcG9ydE1zKGNvbmZpZ3VyZWQudW5yZWFjaGFibGVSZXBvcnRNcylcblxuICAgIHJldHVybiB7ZW5hYmxlZCwgaG9zdCwgcG9ydCwgcGVlclR5cGU6IGNvbmZpZ3VyZWQucGVlclR5cGUsIGluUHJvY2VzcywgdW5yZWFjaGFibGVSZXBvcnRNc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBiZWFjb24gY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CZWFjb25Db25maWd1cmF0aW9ufSBiZWFjb24gLSBCZWFjb24gY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEJlYWNvbkNvbmZpZyhiZWFjb24pIHtcbiAgICB0aGlzLl9iZWFjb24gPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iZWFjb24sIGJlYWNvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBiZWFjb24gY2xpZW50LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSBhY3RpdmUgQmVhY29uIGNsaWVudCwgaWYgY29ubmVjdGVkLlxuICAgKi9cbiAgZ2V0QmVhY29uQ2xpZW50KCkge1xuICAgIHJldHVybiB0aGlzLl9iZWFjb25DbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0aGlzIGNvbmZpZ3VyYXRpb24ncyBCZWFjb24gY2xpZW50IHRvIHRoZSBjb25maWd1cmVkXG4gICAqIGJyb2tlciwgd2lyaW5nIGluY29taW5nIGJyb2FkY2FzdHMgdG8gdGhlIGxvY2FsIGRlbGl2ZXJ5IHBhdGggc29cbiAgICogYW55IHdlYnNvY2tldCBzdWJzY3JpYmVycyBpbiB0aGlzIHByb2Nlc3MgcmVjZWl2ZSB0aGVtLiBJZGVtcG90ZW50XG4gICAqIOKAlCByZXBlYXQgY2FsbHMgcmV0dXJuIHRoZSBzYW1lIGluLWZsaWdodCBvciByZXNvbHZlZCBwcm9taXNlLlxuICAgKlxuICAgKiBSZXR1cm5zIGltbWVkaWF0ZWx5IHdpdGggYHVuZGVmaW5lZGAgaWYgQmVhY29uIGlzIG5vdCBlbmFibGVkLlxuICAgKlxuICAgKiAqKk5vbi1ibG9ja2luZyBieSBkZXNpZ24gKFRDUCBtb2RlKS4qKiBGb3IgYnJva2VyLWJhY2tlZCBCZWFjb24sIHRoZVxuICAgKiByZXR1cm5lZCBwcm9taXNlIHJlc29sdmVzIGFzIHNvb24gYXMgdGhlIGNsaWVudCBpcyBjb25zdHJ1Y3RlZCBhbmRcbiAgICogdGhlIFRDUCBjb25uZWN0IGlzIGxhdW5jaGVkIOKAlCBpdCBkb2VzICoqbm90Kiogd2FpdCBmb3IgdGhlIGNvbm5lY3RcbiAgICogaGFuZHNoYWtlIHRvIGNvbXBsZXRlLiBBIGJyb2tlciB0aGF0IHNpbGVudGx5IGRyb3BzIFNZTnNcbiAgICogKGZpcmV3YWxsL05BQ0wgRFJPUCBydWxlcykgd291bGQgb3RoZXJ3aXNlIGJsb2NrIHN0YXJ0dXAgb24gdGhlIE9TXG4gICAqIFRDUCBjb25uZWN0IHRpbWVvdXQgKHRlbnMgb2Ygc2Vjb25kcyksIHdoaWNoIGNvbnRyYWRpY3RzIHRoZVxuICAgKiBkb2N1bWVudGVkIFwiZmFsbCBiYWNrIHRvIGxvY2FsLW9ubHkgYW5kIHJlY29ubmVjdCBpbiB0aGVcbiAgICogYmFja2dyb3VuZFwiIGNvbnRyYWN0LiBJbml0aWFsLWNvbm5lY3QgZmFpbHVyZXMgc3VyZmFjZVxuICAgKiBhc3luY2hyb25vdXNseSBvbiB0aGUgZnJhbWV3b3JrLWVycm9yIGNoYW5uZWwgdmlhIHRoZVxuICAgKiBgY29ubmVjdC1lcnJvcmAgbGlzdGVuZXIgcmVnaXN0ZXJlZCBoZXJlLiBDYWxsZXJzIHRoYXQgbmVlZCBhXG4gICAqIGRldGVybWluaXN0aWMgcHVibGlzaC1yZWFkaW5lc3MgYm91bmRhcnkgc2hvdWxkIGNhbGxcbiAgICogYGdldEJlYWNvbkNsaWVudCgpPy53YWl0Rm9yUmVhZHkoe3RpbWVvdXRNc30pYC5cbiAgICpcbiAgICogKipJbi1wcm9jZXNzIG1vZGUqKiBhd2FpdHMgYGNvbm5lY3QoKWAg4oCUIHRoYXQgcGF0aCBpcyBzeW5jaHJvbm91cyxcbiAgICogY2Fubm90IGZhaWwsIGFuZCBnaXZlcyBjYWxsZXJzIHByZWRpY3RhYmxlIHJlYWRpbmVzcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBPdmVycmlkZSBwZWVyVHlwZSBmb3IgdGhpcyBjb25uZWN0IGNhbGwgKGUuZy4gYFwic2VydmVyXCJgLCBgXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJgKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZWdpc3RlcmVkIGNsaWVudCAoVENQIG1vZGU6IGNvbm5lY3QgbWF5IHN0aWxsIGJlIGluIGZsaWdodCksIG9yIHVuZGVmaW5lZCB3aGVuIEJlYWNvbiBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGFzeW5jIGNvbm5lY3RCZWFjb24oe3BlZXJUeXBlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCkgcmV0dXJuIHRoaXMuX2JlYWNvbkNsaWVudFxuICAgIGlmICh0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlXG5cbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldEJlYWNvbkNvbmZpZygpXG5cbiAgICBpZiAoIWNvbmZpZy5lbmFibGVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjbGllbnQgPSBhd2FpdCB0aGlzLl9jcmVhdGVCZWFjb25DbGllbnQoe1xuICAgICAgICBjb25maWcsXG4gICAgICAgIHBlZXJUeXBlOiBwZWVyVHlwZSB8fCBjb25maWcucGVlclR5cGVcbiAgICAgIH0pXG5cbiAgICAgIGNsaWVudC5vbkJyb2FkY2FzdCgobWVzc2FnZSkgPT4ge1xuICAgICAgICAvLyBTeW5hcHNlLXN0eWxlIGZhbi1vdXQ6IGRlbGl2ZXIgZXZlcnkgYnJvYWRjYXN0IHdlIHJlY2VpdmVcbiAgICAgICAgLy8gZnJvbSB0aGUgYnVzIHRocm91Z2ggdGhlIGxvY2FsIGRlbGl2ZXJ5IHBhdGguIEVjaG9lcyBvZiBvdXJcbiAgICAgICAgLy8gb3duIHB1Ymxpc2hlcyBmb2xsb3cgdGhlIHNhbWUgcGF0aCBzbyBldmVyeSBwZWVyIHNlZXMgdGhlXG4gICAgICAgIC8vIHNhbWUgZGVsaXZlcnkgc2VtYW50aWNzLlxuICAgICAgICB0aGlzLl9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbihtZXNzYWdlKVxuICAgICAgfSlcblxuICAgICAgLy8gQmVhY29uIGNvbm5lY3QvZGlzY29ubmVjdCBibGlwcyBhcmUgZXhwZWN0ZWQgZHVyaW5nIGRlcGxveXMgKHRoZSBicm9rZXJcbiAgICAgIC8vIHJlc3RhcnRzKSBhbmQgdGhlIEJlYWNvbkNsaWVudCBhdXRvLXJlY29ubmVjdHMgaW4gdGhlIGJhY2tncm91bmQsIHNvIGFcbiAgICAgIC8vIHNpbmdsZSB0cmFuc2llbnQgZmFpbHVyZSBpcyBOT1QgcmVwb3J0ZWQuIE9ubHkgYSBzdXN0YWluZWQgb3V0YWdlIChzdGlsbFxuICAgICAgLy8gZG93biBhZnRlciBgdW5yZWFjaGFibGVSZXBvcnRNc2ApIGlzIHN1cmZhY2VkIG9uIHRoZSBmcmFtZXdvcmstZXJyb3JcbiAgICAgIC8vIGNoYW5uZWw7IGEgKHJlKWNvbm5lY3Qgd2l0aGluIHRoZSBncmFjZSB3aW5kb3cgY2xlYXJzIGl0IHNpbGVudGx5LlxuXG4gICAgICAvLyBgY29ubmVjdC1lcnJvcmAgZmlyZXMgd2hlbiB0aGUgKmluaXRpYWwqIFRDUC9oYW5kc2hha2UgZmFpbHMuXG4gICAgICBjbGllbnQub24oXCJjb25uZWN0LWVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZTogXCJiZWFjb24tY29ubmVjdFwiLCBlcnJvciwgcmVwb3J0QWZ0ZXJNczogY29uZmlnLnVucmVhY2hhYmxlUmVwb3J0TXN9KVxuICAgICAgfSlcblxuICAgICAgLy8gYGRpc2Nvbm5lY3RgIGZpcmVzIHdoZW4gYW4gZXN0YWJsaXNoZWQgY29ubmVjdGlvbiBkcm9wcy4gVGhlIHBheWxvYWQgaXNcbiAgICAgIC8vIHRoZSB1bmRlcmx5aW5nIHNvY2tldCBlcnJvciBpZiB0aGVyZSB3YXMgb25lLCBvciBhIHN5bnRoZXRpY1xuICAgICAgLy8gRXJyb3IoXCJCZWFjb24gYnJva2VyIGRpc2Nvbm5lY3RlZFwiKSBvdGhlcndpc2UuXG4gICAgICBjbGllbnQub24oXCJkaXNjb25uZWN0XCIsIChyZWFzb24pID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uRG93bih7c3RhZ2U6IFwiYmVhY29uLWRpc2Nvbm5lY3RcIiwgZXJyb3I6IHJlYXNvbiwgcmVwb3J0QWZ0ZXJNczogY29uZmlnLnVucmVhY2hhYmxlUmVwb3J0TXN9KVxuICAgICAgfSlcblxuICAgICAgLy8gYGNvbm5lY3RgIGZpcmVzIG9uIGV2ZXJ5IChyZSljb25uZWN0OyBjbGVhciBhbnkgcGVuZGluZyBvdXRhZ2Ugc3RhdGUgc29cbiAgICAgIC8vIGEgdHJhbnNpZW50IGJsaXAgdGhhdCByZWNvdmVycyB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyBzdGF5cyBzaWxlbnQuXG4gICAgICBjbGllbnQub24oXCJjb25uZWN0XCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uVXAoKVxuICAgICAgfSlcblxuICAgICAgLy8gUmVnaXN0ZXIgdGhlIGNsaWVudCAqYmVmb3JlKiBraWNraW5nIG9mZiBjb25uZWN0IHNvIHN1YnNlcXVlbnRcbiAgICAgIC8vIGBjb25uZWN0QmVhY29uKClgIGNhbGxzIHJldHVybiB0aGlzIHNhbWUgaW5zdGFuY2UgaW5zdGVhZCBvZlxuICAgICAgLy8gcmFjaW5nIHRvIGNvbnN0cnVjdCBhIHNlY29uZCBvbmUuXG4gICAgICB0aGlzLl9iZWFjb25DbGllbnQgPSBjbGllbnRcblxuICAgICAgaWYgKGNvbmZpZy5pblByb2Nlc3MpIHtcbiAgICAgICAgLy8gSW4tcHJvY2VzcyBjb25uZWN0IGlzIHN5bmNocm9ub3VzLCBjYW5ub3QgZmFpbCwgYW5kIHJlc29sdmVzXG4gICAgICAgIC8vIGJlZm9yZSB0aGlzIGF3YWl0IHlpZWxkcyDigJQgY2FsbGVycyBjYW4gcmVseSBvblxuICAgICAgICAvLyBgaXNDb25uZWN0ZWQoKSA9PT0gdHJ1ZWAgaW1tZWRpYXRlbHkgYWZ0ZXIgYGNvbm5lY3RCZWFjb24oKWAuXG4gICAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEZpcmUtYW5kLWZvcmdldCB0aGUgVENQIGNvbm5lY3QuIEF3YWl0aW5nIGhlcmUgd291bGQgYmxvY2tcbiAgICAgICAgLy8gc3RhcnR1cCBvbiB0aGUgT1MgVENQIGNvbm5lY3QgdGltZW91dCAoNzVzIGRlZmF1bHQgb24gTGludXgpXG4gICAgICAgIC8vIHdoZW4gdGhlIGJyb2tlciBzaWxlbnRseSBkcm9wcyBTWU5zLiBGYWlsdXJlcyBzdXJmYWNlXG4gICAgICAgIC8vIGFzeW5jaHJvbm91c2x5IHZpYSB0aGUgYGNvbm5lY3QtZXJyb3JgIGxpc3RlbmVyIHJlZ2lzdGVyZWRcbiAgICAgICAgLy8gYWJvdmU7IHRoZSBCZWFjb25DbGllbnQncyByZWNvbm5lY3QgbG9vcCBrZWVwcyB0cnlpbmcuXG4gICAgICAgIHZvaWQgY2xpZW50LmNvbm5lY3QoKS5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gQWxyZWFkeSByZXBvcnRlZCB2aWEgY29ubmVjdC1lcnJvciBhYm92ZS5cbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNsaWVudFxuICAgIH0pKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIEJlYWNvbiBjbGllbnQgbWF0Y2hpbmcgdGhlIGNvbmZpZ3VyZWQgbW9kZS4gU3BsaXQgb3V0IHNvXG4gICAqIGBjb25uZWN0QmVhY29uYCBzdGF5cyBmb2N1c2VkIG9uIGxpZmVjeWNsZSBhbmQgZXJyb3Igd2lyaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTxWZWxvY2lvdXNDb25maWd1cmF0aW9uW1wiZ2V0QmVhY29uQ29uZmlnXCJdPn0gYXJncy5jb25maWcgLSBSZXNvbHZlZCBCZWFjb24gY29uZmlnLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucGVlclR5cGVdIC0gUmVzb2x2ZWQgcGVlciB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEJlYWNvbiBjbGllbnQuXG4gICAqL1xuICBhc3luYyBfY3JlYXRlQmVhY29uQ2xpZW50KHtjb25maWcsIHBlZXJUeXBlfSkge1xuICAgIC8vIFJvdXRlIHRocm91Z2ggdGhlIGVudmlyb25tZW50IGhhbmRsZXIgc28gdGhlIE5vZGUtb25seSBgbm9kZTpuZXRgXG4gICAgLy8gLyBgbm9kZTpjcnlwdG9gIGRlcHMgaW4gdGhlIEJlYWNvbiBjbGllbnQgbW9kdWxlcyBkb24ndCBnZXQgcHVsbGVkXG4gICAgLy8gaW50byBicm93c2VyIGJ1bmRsZXMuIEJyb3dzZXIgYnVuZGxlcyBzdGF0aWNhbGx5IHJlYWNoXG4gICAgLy8gYENvbmZpZ3VyYXRpb25gICh2aWEgYExvZ2dlcmApOyBwdXR0aW5nIHRoZSBkeW5hbWljXG4gICAgLy8gYGltcG9ydChcIi4vYmVhY29uLy4uLlwiKWAgY2FsbHMgaGVyZSB3b3VsZCBzdGlsbCBkcmFnIHRob3NlIG1vZHVsZXNcbiAgICAvLyB0aHJvdWdoIGVzYnVpbGQncyBzdGF0aWMgYW5hbHlzaXMuIEhpZGluZyB0aGUgaW1wb3J0cyBpbnNpZGUgdGhlXG4gICAgLy8gTm9kZSBlbnZpcm9ubWVudCBoYW5kbGVyIGtlZXBzIHRoZW0gb2ZmIHRoZSBicm93c2VyIHBhdGgg4oCUXG4gICAgLy8gYnJvd3Nlci1idW5kbGVkIGFwcHMgbmV2ZXIgcmVhY2ggYGVudmlyb25tZW50LWhhbmRsZXJzL25vZGUuanNgLlxuICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAoY29uZmlnLmluUHJvY2Vzcykge1xuICAgICAgY29uc3QgSW5Qcm9jZXNzQmVhY29uQ2xpZW50ID0gYXdhaXQgaGFuZGxlci5sb2FkSW5Qcm9jZXNzQmVhY29uQ2xpZW50KClcblxuICAgICAgcmV0dXJuIG5ldyBJblByb2Nlc3NCZWFjb25DbGllbnQoe3BlZXJUeXBlfSlcbiAgICB9XG5cbiAgICBjb25zdCBCZWFjb25DbGllbnQgPSBhd2FpdCBoYW5kbGVyLmxvYWRCZWFjb25DbGllbnQoKVxuXG4gICAgcmV0dXJuIG5ldyBCZWFjb25DbGllbnQoe1xuICAgICAgaG9zdDogY29uZmlnLmhvc3QsXG4gICAgICBwb3J0OiBjb25maWcucG9ydCxcbiAgICAgIHBlZXJUeXBlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgQmVhY29uIGNvbm5lY3QvZGlzY29ubmVjdCBmYWlsdXJlIHdpdGhvdXQgcmVwb3J0aW5nIGl0IGltbWVkaWF0ZWx5LlxuICAgKiBUaGUgQmVhY29uQ2xpZW50IGF1dG8tcmVjb25uZWN0cywgc28gYnJpZWYgb3V0YWdlcyAoZS5nLiBhIGRlcGxveSByZXN0YXJ0aW5nXG4gICAqIHRoZSBicm9rZXIpIGFyZSBleHBlY3RlZDsgb25seSBpZiB0aGUgYmVhY29uIGlzIHN0aWxsIHVucmVhY2hhYmxlIGFmdGVyXG4gICAqIGByZXBvcnRBZnRlck1zYCBpcyBhIHNpbmdsZSBmcmFtZXdvcmstZXJyb3Igc3VyZmFjZWQgdmlhIGBfcmVwb3J0QmVhY29uRXJyb3JgLlxuICAgKiBBIHN1YnNlcXVlbnQgYGNvbm5lY3RgIChzZWUgYF9oYW5kbGVCZWFjb25VcGApIGNhbmNlbHMgdGhlIHBlbmRpbmcgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJiZWFjb24tY29ubmVjdFwiIHwgXCJiZWFjb24tZGlzY29ubmVjdFwifSBhcmdzLnN0YWdlIC0gRmFpbHVyZSBzdGFnZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZXBvcnRBZnRlck1zIC0gR3JhY2Ugd2luZG93IGJlZm9yZSBhIHN1c3RhaW5lZCBvdXRhZ2UgaXMgcmVwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlLCBlcnJvciwgcmVwb3J0QWZ0ZXJNc30pIHtcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0ge3N0YWdlLCBlcnJvcn1cblxuICAgIC8vIEEgcmVwb3J0IGlzIGFscmVhZHkgcGVuZGluZyBvciBhbHJlYWR5IHNlbnQgZm9yIHRoaXMgb3V0YWdlIOKAlCBrZWVwIHRoZVxuICAgIC8vIGxhdGVzdCBlcnJvciBidXQgZG9uJ3Qgc3RhY2sgdGltZXJzIG9yIHJlLXJlcG9ydC5cbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIgfHwgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQpIHJldHVyblxuXG4gICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG5cbiAgICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQ/LmlzQ29ubmVjdGVkKCkpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uVXAoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSB0cnVlXG5cbiAgICAgIGlmICh0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yKSB0aGlzLl9yZXBvcnRCZWFjb25FcnJvcih0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yKVxuICAgIH0sIHJlcG9ydEFmdGVyTXMpXG5cbiAgICAvLyBEb24ndCBsZXQgdGhlIGdyYWNlIHRpbWVyIGtlZXAgdGhlIHByb2Nlc3MgYWxpdmUuXG4gICAgaWYgKHR5cGVvZiB0aW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aW1lci51bnJlZigpXG5cbiAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHRpbWVyXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGJlYWNvbi1kb3duIHN0YXRlIG9uIGEgKHJlKWNvbm5lY3QuIEEgYmxpcCB0aGF0IHJlY292ZXJzIHdpdGhpbiB0aGVcbiAgICogZ3JhY2Ugd2luZG93IGlzIG5ldmVyIHJlcG9ydGVkOyBpZiBhIHN1c3RhaW5lZCBvdXRhZ2UgaGFkIGFscmVhZHkgYmVlblxuICAgKiByZXBvcnRlZCwgdGhlIHN0YXRlIHJlc2V0cyBzbyBhIGZ1dHVyZSBvdXRhZ2UgY2FuIHJlcG9ydCBhZ2Fpbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQmVhY29uVXAoKSB7XG4gICAgaWYgKHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpXG4gICAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gZmFsc2VcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYSBCZWFjb24gZmFpbHVyZSBvbiB0aGUgZnJhbWV3b3JrIGVycm9yIGNoYW5uZWwuIE1pcnJvcnNcbiAgICogdGhlIHBhdHRlcm4gdXNlZCBieSBgcmVxdWVzdC1ydW5uZXIuanNgIGZvciBIVFRQIGVycm9ycy4gV2hlbiBub1xuICAgKiBsaXN0ZW5lciBpcyBhdHRhY2hlZCB0byBlaXRoZXIgYGZyYW1ld29yay1lcnJvcmAgb3IgYGFsbC1lcnJvcmAsXG4gICAqIGFsc28gc2NoZWR1bGVzIGFuIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbiBzbyBwcm9jZXNzLWxldmVsIGJ1Z1xuICAgKiByZXBvcnRlcnMgKHdoaWNoIHN1YnNjcmliZSB0byBgdW5oYW5kbGVkUmVqZWN0aW9uYCBieSBkZWZhdWx0KSBwaWNrXG4gICAqIHRoZSBmYWlsdXJlIHVwIOKAlCBhbmQgQUxTTyB3cml0ZXMgYSBvbmUtbGluZSBzdW1tYXJ5IHRvIGBzdGRlcnJgIHNvXG4gICAqIHRoZSBmYWlsdXJlIGlzbid0IGNvbXBsZXRlbHkgc2lsZW50IG9uIE5vZGUgMjQrIHdoZXJlIHRoZSBkZWZhdWx0XG4gICAqIGJlaGF2aW9yIG9mIGB1bmhhbmRsZWRSZWplY3Rpb25gIGlzIHRvIHRlcm1pbmF0ZSB0aGUgcHJvY2Vzcy4gQW5cbiAgICogYXBwIHRoYXQgc2VlcyBpdHMgc2VydmVyIHN1ZGRlbmx5IGV4aXQgbmVlZHMgYXQgbGVhc3Qgb25lXG4gICAqIGJyZWFkY3J1bWIgaW4gdGhlIGxvZ3MgdG8ga25vdyBCZWFjb24gd2FzIHRoZSBjYXVzZTsgdGhlIHByZXZpb3VzXG4gICAqIGJlaGF2aW9yIGxlZnQgYSBzdGFjay1vbmx5IGNyYXNoIHdpdGggbm8gY29udGV4dCB0eWluZyBpdCBiYWNrIHRvXG4gICAqIHRoZSBicm9rZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCJ9IGFyZ3Muc3RhZ2UgLSBGYWlsdXJlIHN0YWdlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEJlYWNvbkVycm9yKHtzdGFnZSwgZXJyb3J9KSB7XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLl9lcnJvckV2ZW50c1xuICAgIGNvbnN0IGhhc0xpc3RlbmVyID0gZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImZyYW1ld29yay1lcnJvclwiKSA+IDBcbiAgICAgIHx8IGVycm9yRXZlbnRzLmxpc3RlbmVyQ291bnQoXCJhbGwtZXJyb3JcIikgPiAwXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtzdGFnZX0sXG4gICAgICBlcnJvclxuICAgIH1cblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gICAgaWYgKCFoYXNMaXN0ZW5lcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuXG5cbiAgICAgIGNvbnNvbGUuZXJyb3IoYFt2ZWxvY2lvdXMgZnJhbWV3b3JrLWVycm9yIHN0YWdlPSR7c3RhZ2V9XSAke21lc3NhZ2V9IOKAlCByZWdpc3RlciBhIGxpc3RlbmVyIHZpYSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkub24oXCJmcmFtZXdvcmstZXJyb3JcIiwg4oCmKSB0byBzdXBwcmVzcyB0aGlzIHN0ZGVyciBmYWxsYmFja2ApXG4gICAgICB2b2lkIFByb21pc2UucmVqZWN0KGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgdGhlIGFjdGl2ZSBCZWFjb24gY2xpZW50IChpZiBhbnkpLiBTYWZlIHRvIGNhbGwgbXVsdGlwbGVcbiAgICogdGltZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgZGlzY29ubmVjdEJlYWNvbigpIHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLl9iZWFjb25DbGllbnRcblxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gdW5kZWZpbmVkXG5cbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcilcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcblxuICAgIGlmIChjbGllbnQpIGF3YWl0IGNsaWVudC5jbG9zZSgpXG4gIH1cblxuICAvKipcbiAgICogUm91dGVzIGEgQmVhY29uLXNvdXJjZWQgYnJvYWRjYXN0IHRocm91Z2ggdGhlIHNhbWUgZGVsaXZlcnkgY29kZVxuICAgKiBwYXRoIGFzIGEgbG9jYWxseS1vcmlnaW5hdGVkIG9uZS4gUHJlZmVycyB0aGUgd29ya2VydGhyZWFkLWF3YXJlXG4gICAqIGBicm9hZGNhc3RWMmAgd2hlbiBhbiBIVFRQIHNlcnZlciBpcyBob3N0aW5nIHdvcmtlcnMsIGFuZCBmYWxsc1xuICAgKiBiYWNrIHRvIHRoZSBwZXItcHJvY2VzcyBzdWJzY3JpcHRpb24gZGlzcGF0Y2ggb3RoZXJ3aXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmVhY29uL3R5cGVzLmpzXCIpLkJlYWNvbkJyb2FkY2FzdE1lc3NhZ2V9IG1lc3NhZ2UgLSBCcm9hZGNhc3QgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZGVsaXZlckJyb2FkY2FzdEZyb21CZWFjb24obWVzc2FnZSkge1xuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMih7XG4gICAgICAgIGNoYW5uZWw6IG1lc3NhZ2UuY2hhbm5lbCxcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zOiBtZXNzYWdlLmJyb2FkY2FzdFBhcmFtcyxcbiAgICAgICAgYm9keTogbWVzc2FnZS5ib2R5LFxuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzXG4gICAgICB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobWVzc2FnZS5jaGFubmVsLCBtZXNzYWdlLmJyb2FkY2FzdFBhcmFtcywgbWVzc2FnZS5ib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBpZiAoIXRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNMb2FkZXJUeXBlIHwgdW5kZWZpbmVkfSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyAtIFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZyhzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icykge1xuICAgIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID0gc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtYWlsZXIgYmFja2VuZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5NYWlsZXJCYWNrZW5kIHwgdW5kZWZpbmVkfSAtIE1haWxlciBiYWNrZW5kLlxuICAgKi9cbiAgZ2V0TWFpbGVyQmFja2VuZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fbWFpbGVyQmFja2VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG1haWxlciBiYWNrZW5kLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5NYWlsZXJCYWNrZW5kIHwgdW5kZWZpbmVkfSBtYWlsZXJCYWNrZW5kIC0gTWFpbGVyIGJhY2tlbmQsIG9yIHVuZGVmaW5lZCB0byByZW1vdmUgaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1haWxlckJhY2tlbmQobWFpbGVyQmFja2VuZCkge1xuICAgIHRoaXMuX21haWxlckJhY2tlbmQgPSBtYWlsZXJCYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogTG9nZ2luZyBjb25maWd1cmF0aW9uIHRhaWxvcmVkIGZvciBIVFRQIHJlcXVlc3QgbG9nZ2luZy4gRGVmYXVsdHMgY29uc29sZSBsb2dnaW5nIHRvIHRydWUgYW5kIGFwcGxpZXMgdGhlIHVzZXIgYGxvZ2dpbmcuY29uc29sZWAgZmxhZyBvbmx5IGZvciByZXF1ZXN0IGxvZ2dpbmcuXG4gICAqIEByZXR1cm5zIHtSZXF1aXJlZDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJjb25zb2xlXCIgfCBcImZpbGVcIiB8IFwibGV2ZWxzXCI+PiAmIFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImRpcmVjdG9yeVwiIHwgXCJmaWxlUGF0aFwiPiAmIFBhcnRpYWw8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwib3V0cHV0c1wiIHwgXCJsb2dnZXJzXCI+Pn0gLSBUaGUgaHR0cCBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRIdHRwTG9nZ2luZ0NvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TG9nZ2luZ0NvbmZpZ3VyYXRpb24oe2RlZmF1bHRDb25zb2xlOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbnZpcm9ubWVudCBoYW5kbGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqL1xuICBnZXRFbnZpcm9ubWVudEhhbmRsZXIoKSB7XG4gICAgaWYgKCF0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGVudmlyb25tZW50IGhhbmRsZXIgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZW52aXJvbm1lbnRIYW5kbGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2NhbGVGYWxsYmFja3NUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKi9cbiAgZ2V0TG9jYWxlRmFsbGJhY2tzKCkgeyByZXR1cm4gdGhpcy5sb2NhbGVGYWxsYmFja3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2NhbGVGYWxsYmFja3NUeXBlfSBuZXdMb2NhbGVGYWxsYmFja3MgLSBOZXcgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TG9jYWxlRmFsbGJhY2tzKG5ld0xvY2FsZUZhbGxiYWNrcykgeyB0aGlzLmxvY2FsZUZhbGxiYWNrcyA9IG5ld0xvY2FsZUZhbGxiYWNrcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN0cnVjdHVyZSBzcWwgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlN0cnVjdHVyZVNxbENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gU3RydWN0dXJlIFNRTCBjb25maWcuXG4gICAqL1xuICBnZXRTdHJ1Y3R1cmVTcWxDb25maWcoKSB7IHJldHVybiB0aGlzLl9zdHJ1Y3R1cmVTcWwgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCB3cml0ZSBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcGFyYW0ge3tyZWFzb24/OiBcIm1pZ3JhdGlvblwiIHwgXCJzY2hlbWFEdW1wXCJ9fSBbYXJnc10gLSBDYWxsIGNvbnRleHQgZm9yIHRoZSBzdHJ1Y3R1cmUgc3FsIHdyaXRlIGRlY2lzaW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN0cnVjdHVyZSBTUUwgZmlsZXMgc2hvdWxkIGJlIGdlbmVyYXRlZCBmb3IgdGhlIGN1cnJlbnQgZW52aXJvbm1lbnQuXG4gICAqL1xuICBzaG91bGRXcml0ZVN0cnVjdHVyZVNxbChhcmdzID0ge30pIHtcbiAgICBjb25zdCB7cmVhc29uID0gXCJtaWdyYXRpb25cIn0gPSBhcmdzXG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRTdHJ1Y3R1cmVTcWxDb25maWcoKVxuICAgIGNvbnN0IGVuYWJsZWRFbnZpcm9ubWVudHMgPSBjb25maWc/LmVuYWJsZWRFbnZpcm9ubWVudHNcbiAgICBjb25zdCBkaXNhYmxlZEVudmlyb25tZW50cyA9IGNvbmZpZz8uZGlzYWJsZWRFbnZpcm9ubWVudHNcblxuICAgIGlmIChyZWFzb24gPT09IFwic2NoZW1hRHVtcFwiKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGVuYWJsZWRFbnZpcm9ubWVudHMpKSB7XG4gICAgICByZXR1cm4gZW5hYmxlZEVudmlyb25tZW50cy5pbmNsdWRlcyh0aGlzLmdldEVudmlyb25tZW50KCkpXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZGlzYWJsZWRFbnZpcm9ubWVudHMpICYmIGRpc2FibGVkRW52aXJvbm1lbnRzLmluY2x1ZGVzKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldEVudmlyb25tZW50KCkgPT09IFwidGVzdFwiKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHN0cnVjdHVyZSBzcWwgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TdHJ1Y3R1cmVTcWxDb25maWd1cmF0aW9ufSBzdHJ1Y3R1cmVTcWwgLSBTdHJ1Y3R1cmUgU1FMIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U3RydWN0dXJlU3FsQ29uZmlnKHN0cnVjdHVyZVNxbCkge1xuICAgIHRoaXMuX3N0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbG9jYWxlLlxuICAgKi9cbiAgZ2V0TG9jYWxlKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5sb2NhbGUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5sb2NhbGUoKVxuICAgIH0gZWxzZSBpZiAodGhpcy5sb2NhbGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvY2FsZVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRMb2NhbGVzKClbMF1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIGxvY2FsZXMuXG4gICAqL1xuICBnZXRMb2NhbGVzKCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcImxvY2FsZXNcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcyhuYW1lKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzc2VzW25hbWVdXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBtb2RlbCBjbGFzcyAke25hbWV9IGluICR7T2JqZWN0LmtleXModGhpcy5tb2RlbENsYXNzZXMpLmpvaW4oXCIsIFwiKX19YClcblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQSBoYXNoIG9mIGFsbCBtb2RlbCBjbGFzc2VzLCBrZXllZCBieSBtb2RlbCBuYW1lLCBhcyB0aGV5IHdlcmUgZGVmaW5lZCBpbiB0aGUgY29uZmlndXJhdGlvbi4gVGhpcyBpcyBhIGRpcmVjdCByZWZlcmVuY2UgdG8gdGhlIG1vZGVsIGNsYXNzZXMsIG5vdCBhIGNvcHkuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzc2VzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdGluZy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gVGhlIHBhdGggdG8gYSBjb25maWcgZmlsZSB0aGF0IHNob3VsZCBiZSB1c2VkIGZvciB0ZXN0aW5nLlxuICAgKi9cbiAgZ2V0VGVzdGluZygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RpbmcgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cnVzdGVkIHByb3hpZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gVHJ1c3RlZCByZXZlcnNlIHByb3h5IGFkZHJlc3MgcmFuZ2VzLlxuICAgKi9cbiAgZ2V0VHJ1c3RlZFByb3hpZXMoKSB7IHJldHVybiB0aGlzLl90cnVzdGVkUHJveGllcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRydXN0ZWQgcHJveGllcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gdHJ1c3RlZFByb3hpZXMgLSBUcnVzdGVkIHJldmVyc2UgcHJveHkgYWRkcmVzcyByYW5nZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0VHJ1c3RlZFByb3hpZXModHJ1c3RlZFByb3hpZXMpIHsgdGhpcy5fdHJ1c3RlZFByb3hpZXMgPSB0cnVzdGVkUHJveGllcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBkYXRhYmFzZSBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2lkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllciB0byBpbml0aWFsaXplLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBpbml0aWFsaXplRGF0YWJhc2VQb29sKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGlmICghdGhpcy5kYXRhYmFzZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gJ2RhdGFiYXNlJyB3YXMgZ2l2ZW5cIilcbiAgICBpZiAodGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZVBvb2wgaGFzIGFscmVhZHkgYmVlbiBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgUG9vbFR5cGUgPSB0aGlzLmdldERhdGFiYXNlUG9vbFR5cGUoaWRlbnRpZmllcilcblxuICAgIHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IG5ldyBQb29sVHlwZSh7Y29uZmlndXJhdGlvbjogdGhpcywgaWRlbnRpZmllcn0pXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdLnNldEN1cnJlbnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZGF0YWJhc2UgcG9vbCBpbml0aWFsaXplZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtpZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0YWJhc2UgcG9vbCBpbml0aWFsaXplZC5cbiAgICovXG4gIGlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7IHJldHVybiBCb29sZWFuKHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGluaXRpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluaXRpYWxpemVkLlxuICAgKi9cbiAgaXNJbml0aWFsaXplZCgpIHsgcmV0dXJuIHRoaXMuX2lzSW5pdGlhbGl6ZWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgbW9kZWxzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZU1vZGVscyhhcmdzID0ge3R5cGU6IFwic2VydmVyXCJ9KSB7XG4gICAgY29uc3QgbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgaWYgKHRoaXMuX21vZGVsc0luaXRpYWxpemVkKSByZXR1cm5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgIGNvbnN0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgICAgYXdhaXQgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID09PSBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAmJiAhdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID09PSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5pbml0aWFsaXplTW9kZWxzKGFyZ3MpXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNob3VsZFNraXBEdW1teU1vZGVsSW5pdGlhbGl6YXRpb24gPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfU0tJUF9EVU1NWV9NT0RFTF9JTklUSUFMSVpBVElPTiA9PT0gXCIxXCJcbiAgICAgICAgJiYgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gICAgICAgICYmIHRoaXMuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCJcblxuICAgICAgaWYgKCFzaG91bGRTa2lwRHVtbXlNb2RlbEluaXRpYWxpemF0aW9uKSB7XG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVscyh7Y29uZmlndXJhdGlvbjogdGhpcywgdHlwZTogYXJncy50eXBlfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW5pdGlhbGl6ZVBhY2thZ2VNb2RlbHModGhpcylcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHModGhpcylcblxuICAgICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmluaXRpYWxpemVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVycyh0aGlzKVxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IG1vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0pKClcblxuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPT09IGluaXRpYWxpemVNb2RlbHNQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgZWFjaCBjb25maWd1cmVkIGRhdGFiYXNlIHBvb2wgaGFzIGEgZ2xvYmFsIGNvbm5lY3Rpb24gYXZhaWxhYmxlLlxuICAgKiBVc2VmdWwgd2hlbiBgZ2V0Q3VycmVudENvbm5lY3Rpb25gIG1pZ2h0IGJlIGNhbGxlZCB3aXRob3V0IGFuIGFzeW5jIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlbnN1cmVHbG9iYWxDb25uZWN0aW9ucygpIHtcbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICBhd2FpdCBwb29sLmVuc3VyZUdsb2JhbENvbm5lY3Rpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBpbml0aWFsaXplKHt0eXBlfSA9IHt0eXBlOiBcInVuZGVmaW5lZFwifSkge1xuICAgIGlmICh0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlXG5cbiAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IHRydWUsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX3NodXRkb3duUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogZmFsc2UsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2V9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9iZWdpbkluaXRpYWxpemUoe3R5cGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBvciBqb2lucyBpbml0aWFsaXphdGlvbiBhZnRlciBsaWZlY3ljbGUgYmxvY2tlcnMgaGF2ZSBzZXR0bGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFN0YXJ0dXAgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIEdlbmVyaWMgYXBwbGljYXRpb24gcHJvY2VzcyB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTaGFyZWQgc3RhcnR1cCBwcm9taXNlLlxuICAgKi9cbiAgX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pIHtcbiAgICBjb25zdCBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlICYmIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcbiAgICB9XG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogZmFsc2UsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX2luaXRpYWxpemVQcm9taXNlfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5faXNJbml0aWFsaXplZCkge1xuICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICAgIHJldHVybiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIH1cbiAgICAvLyBNZW1vaXplIHRoZSBpbi1wcm9ncmVzcyBpbml0aWFsaXphdGlvbiBzbyBjb25jdXJyZW50IGNhbGxlcnMgYXdhaXQgdGhlIHNhbWVcbiAgICAvLyBib290c3RyYXAgaW5zdGVhZCBvZiByYWNpbmcuIGBfaXNJbml0aWFsaXplZGAgd2FzIHByZXZpb3VzbHkgc2V0IHRvIGB0cnVlYFxuICAgIC8vIHVwIGZyb250LCBzbyBhIHNlY29uZCBjYWxsZXIgKGUuZy4gYSBwb29sZWQgcnVubmVyIHdpdGhcbiAgICAvLyBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPiAxYCBzdGFydGluZyBzZXZlcmFsIGpvYnMgb24gYSBjb2xkIGNoaWxkKSBjb3VsZFxuICAgIC8vIHNraXAgaW5pdGlhbGl6YXRpb24gYW5kIGxvYWQgbW9kZWxzIC8gcGVyZm9ybSBhIGpvYiB3aGlsZSB0aGUgZmlyc3QgY2FsbFxuICAgIC8vIHdhcyBzdGlsbCBhd2FpdGluZyBtb2RlbCBkaXNjb3ZlcnkgYW5kIGluaXRpYWxpemVycy4gTWlycm9ycyBjb25uZWN0QmVhY29uLlxuICAgIGNvbnN0IGluaXRpYWxpemVQcm9taXNlID0gdGhpcy5fcnVuSW5pdGlhbGl6ZSh7aW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uLCB0eXBlfSlcblxuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gaW5pdGlhbGl6ZVByb21pc2VcbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgIHJldHVybiBpbml0aWFsaXplUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBvbmUgc2hhcmVkIGluaXRpYWxpemF0aW9uIGJlaGluZCBhbiBpbmNvbXBhdGlibGUgbGlmZWN5Y2xlIHBoYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jb250aW51ZUFmdGVyV2FpdEZhaWx1cmUgLSBXaGV0aGVyIGEgY29tcGxldGVkIGZhaWxlZCBzaHV0ZG93biBzdGlsbCBwZXJtaXRzIHJlcGxhY2VtZW50IHN0YXJ0dXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBSZXBsYWNlbWVudCBwcm9jZXNzIHR5cGUuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gYXJncy53YWl0Rm9yIC0gTGlmZWN5Y2xlIHBoYXNlIHRoYXQgbXVzdCBzZXR0bGUgZmlyc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBxdWV1ZWQgc3RhcnR1cCBwcm9taXNlLlxuICAgKi9cbiAgX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB0eXBlLCB3YWl0Rm9yfSkge1xuICAgIGlmICh0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlXG5cbiAgICBjb25zdCBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgd2FpdEZvcn0pXG5cbiAgICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UgPT09IHdhaXRGb3IpIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSB3YWl0Rm9yKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBjb25zdCBzaHV0ZG93blByb21pc2UgPSB0aGlzLl9zaHV0ZG93blByb21pc2VcblxuICAgICAgaWYgKHNodXRkb3duUHJvbWlzZSkge1xuICAgICAgICBhd2FpdCB0aGlzLl93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogdHJ1ZSwgd2FpdEZvcjogc2h1dGRvd25Qcm9taXNlfSlcbiAgICAgICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSA9PT0gc2h1dGRvd25Qcm9taXNlKSB0aGlzLl9zaHV0ZG93blByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlICYmIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiAhPT0gdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgY29uc3Qgc3RhbGVJbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG5cbiAgICAgICAgYXdhaXQgc3RhbGVJbml0aWFsaXplUHJvbWlzZVxuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IHN0YWxlSW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pXG4gICAgfSkoKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIHJldHVybiBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhIGxpZmVjeWNsZSBwaGFzZSBiZWZvcmUgcXVldWVkIGluaXRpYWxpemF0aW9uIHByb2NlZWRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdhaXQgcG9saWN5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY29udGludWVBZnRlcldhaXRGYWlsdXJlIC0gV2hldGhlciByZXBsYWNlbWVudCBzdGFydHVwIHJlbWFpbnMgYXZhaWxhYmxlIGFmdGVyIGEgZmFpbGVkIHBoYXNlLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IGFyZ3Mud2FpdEZvciAtIExpZmVjeWNsZSBwaGFzZSB0aGF0IG11c3Qgc2V0dGxlIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHF1ZXVlZCBpbml0aWFsaXphdGlvbiBtYXkgY29udGludWUuXG4gICAqL1xuICBhc3luYyBfd2FpdEZvckluaXRpYWxpemVCbG9ja2VyKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHdhaXRGb3J9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdhaXRGb3JcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUpIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGF0b21pYyBmcmFtZXdvcmsgYW5kIGFwcGxpY2F0aW9uIGluaXRpYWxpemF0aW9uIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSW5pdGlhbGl6YXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAtIEZyYW1ld29yayBtb2RlbCBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gR2VuZXJpYyBhcHBsaWNhdGlvbiBwcm9jZXNzIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBfcnVuSW5pdGlhbGl6ZSh7aW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uLCB0eXBlfSkge1xuICAgIGNvbnN0IHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlID0gIXRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWRcblxuICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkge1xuICAgICAgdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCA9IE9iamVjdC5mcmVlemUoe1xuICAgICAgICBpbnN0YW5jZUlkOiBuZXcgVVVJRCg0KS5mb3JtYXQoKSxcbiAgICAgICAgdHlwZVxuICAgICAgfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplTW9kZWxzKHt0eXBlfSlcblxuICAgICAgLy8gTW9kZWwgaW5pdGlhbGl6YXRpb24gY2FuIGJlIGludmFsaWRhdGVkIGJ5IGEgY29uY3VycmVudCBjb25uZWN0aW9uIGNsb3NlLlxuICAgICAgLy8gSWYgbW9kZWxzIGFyZSBub3QgcmVhZHksIHN0b3Agd2l0aG91dCBtYXJraW5nIHRoZSBjb25maWd1cmF0aW9uIGluaXRpYWxpemVkXG4gICAgICAvLyBzbyB0aGUgbmV4dCBjYWxsZXIgcmV0cmllcyBhIGZ1bGwgYm9vdHN0cmFwLlxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICE9PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24gfHwgIXRoaXMuX21vZGVsc0luaXRpYWxpemVkKSB7XG4gICAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmF1dG9EaXNjb3ZlclJlc291cmNlcyh0aGlzKVxuICAgICAgdGhpcy5fbWVyZ2VEaXNjb3ZlcmVkQWJpbGl0eVJlc291cmNlcygpXG4gICAgICB0aGlzLl92YWxpZGF0ZVJlc291cmNlUmVsYXRpb25zaGlwc09uTW9kZWxzKClcblxuICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlICYmIHRoaXMuX2luaXRpYWxpemVycykge1xuICAgICAgICBjb25zdCBpbml0aWFsaXplcnMgPSBhd2FpdCB0aGlzLl9pbml0aWFsaXplcnMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgICBjb25zdCB7cmVxdWlyZUNvbnRleHQsIC4uLnJlc3RBcmdzfSA9IGluaXRpYWxpemVyc1xuXG4gICAgICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICAgICAgaWYgKHJlcXVpcmVDb250ZXh0KSB7XG4gICAgICAgICAgZm9yIChjb25zdCBpbml0aWFsaXplcktleSBvZiByZXF1aXJlQ29udGV4dC5rZXlzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IEluaXRpYWxpemVyQ2xhc3MgPSByZXF1aXJlQ29udGV4dChpbml0aWFsaXplcktleSkuZGVmYXVsdFxuICAgICAgICAgICAgY29uc3QgcHJvY2Vzc0NvbnRleHQgPSB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0XG5cbiAgICAgICAgICAgIGlmICghcHJvY2Vzc0NvbnRleHQpIHRocm93IG5ldyBFcnJvcihcIkFwcGxpY2F0aW9uIHByb2Nlc3MgY29udGV4dCBpcyBub3QgYXZhaWxhYmxlIGR1cmluZyBpbml0aWFsaXplciBzdGFydHVwXCIpXG5cbiAgICAgICAgICAgIGNvbnN0IGluaXRpYWxpemVySW5zdGFuY2UgPSBuZXcgSW5pdGlhbGl6ZXJDbGFzcyh7Y29uZmlndXJhdGlvbjogdGhpcywgcHJvY2Vzc0NvbnRleHQsIHR5cGV9KVxuXG4gICAgICAgICAgICBhd2FpdCBpbml0aWFsaXplckluc3RhbmNlLnJ1bigpXG4gICAgICAgICAgICB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzLnB1c2goaW5pdGlhbGl6ZXJJbnN0YW5jZSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gdHJ1ZVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHtcbiAgICAgICAgbGV0IHRlYXJkb3duRXJyb3JcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpXG4gICAgICAgIH0gY2F0Y2ggKGNhdWdodFRlYXJkb3duRXJyb3IpIHtcbiAgICAgICAgICB0ZWFyZG93bkVycm9yID0gY2F1Z2h0VGVhcmRvd25FcnJvclxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlYXJkb3duRXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgLi4udGVhcmRvd25FcnJvci5lcnJvcnNdLFxuICAgICAgICAgICAgXCJBcHBsaWNhdGlvbiBwcm9jZXNzIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0ZWFyZG93bkVycm9yICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbZXJyb3IsIHRlYXJkb3duRXJyb3JdLFxuICAgICAgICAgICAgXCJBcHBsaWNhdGlvbiBwcm9jZXNzIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAoIXRoaXMuX2lzSW5pdGlhbGl6ZWQgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRlYXJzIGRvd24gZXZlcnkgc3VjY2Vzc2Z1bGx5IHN0YXJ0ZWQgaW5pdGlhbGl6ZXIgaW4gcmV2ZXJzZSBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSB0ZWFyZG93biBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF90ZWFyZG93blN1Y2Nlc3NmdWxJbml0aWFsaXplcnMoKSB7XG4gICAgY29uc3Qgc3VjY2Vzc2Z1bEluaXRpYWxpemVycyA9IHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMuc3BsaWNlKDApLnJldmVyc2UoKVxuXG4gICAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgICBtZXNzYWdlOiBcIkFwcGxpY2F0aW9uIGluaXRpYWxpemVyIHRlYXJkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IHN1Y2Nlc3NmdWxJbml0aWFsaXplcnMubWFwKChpbml0aWFsaXplcikgPT4gYXN5bmMgKCkgPT4gYXdhaXQgaW5pdGlhbGl6ZXIudGVhcmRvd24oKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqIENsZWFycyBhcHBsaWNhdGlvbi1vd25lZCBsaWZlY3ljbGUgc3RhdGUgYWZ0ZXIgZXZlcnkgdGVhcmRvd24gYXR0ZW1wdC4gKi9cbiAgX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKSB7XG4gICAgdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFRlYXJzIGRvd24gdGhlIGN1cnJlbnQgYXBwbGljYXRpb24gbGlmZWN5Y2xlIG9uY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIEV4YWN0IHNoYXJlZCBzaHV0ZG93biBwcm9taXNlLlxuICAgKi9cbiAgc2h1dGRvd24oKSB7XG4gICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3NodXRkb3duUHJvbWlzZVxuXG4gICAgY29uc3QgaW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIGNvbnN0IHNodXRkb3duUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoaW5pdGlhbGl6ZVByb21pc2UpIGF3YWl0IGluaXRpYWxpemVQcm9taXNlXG4gICAgICAgIGF3YWl0IHRoaXMuX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgdGhpcy5faXNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gc2h1dGRvd25Qcm9taXNlXG5cbiAgICByZXR1cm4gc2h1dGRvd25Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoYXQgcmVzb3VyY2UtZGVmaW5lZCByZWxhdGlvbnNoaXBzIGFyZSBhbHNvIGRlZmluZWQgb24gdGhlIGNvcnJlc3BvbmRpbmcgbW9kZWwgY2xhc3Nlcy5cbiAgICogVGhyb3dzIGFuIGVycm9yIGlmIGEgcmVsYXRpb25zaGlwIGlzIGRlZmluZWQgb24gYSByZXNvdXJjZSBidXQgbWlzc2luZyBmcm9tIHRoZSBtb2RlbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVSZXNvdXJjZVJlbGF0aW9uc2hpcHNPbk1vZGVscygpIHtcbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIHRoaXMuX2JhY2tlbmRQcm9qZWN0cykge1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMocmVzb3VyY2VzKSkge1xuICAgICAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZz8ucmVsYXRpb25zaGlwcykgY29udGludWVcblxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzb3VyY2VDb25maWcucmVsYXRpb25zaGlwcykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlIGZvciAke21vZGVsTmFtZX0gZGVmaW5lcyByZWxhdGlvbnNoaXBzIGFzIGFuIG9iamVjdC4gVXNlIGFuIGFycmF5IGluc3RlYWQ6IHN0YXRpYyByZWxhdGlvbnNoaXBzID0gJHtKU09OLnN0cmluZ2lmeShPYmplY3Qua2V5cyhyZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSl9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGZvciAke21vZGVsTmFtZX0gbXVzdCBiZSBhIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MuYClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgICAgICBjb25zdCBleGlzdGluZ1JlbGF0aW9uc2hpcHMgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVxuXG4gICAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiByZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgICAgaWYgKCEocmVsYXRpb25zaGlwTmFtZSBpbiBleGlzdGluZ1JlbGF0aW9uc2hpcHMpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgIGBSZXNvdXJjZSBmb3IgJHttb2RlbE5hbWV9IGRlZmluZXMgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGJ1dCAke21vZGVsTmFtZX0gbW9kZWwgZG9lcyBub3QuIGAgK1xuICAgICAgICAgICAgICBgQWRkICR7bW9kZWxOYW1lfS5iZWxvbmdzVG8oXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIsIC4uLikgb3IgdGhlIGFwcHJvcHJpYXRlIHJlbGF0aW9uc2hpcCBjYWxsIG9uIHRoZSBtb2RlbCBjbGFzcy5gXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVnaXN0ZXJNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsQ2xhc3Nlc1ttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSA9IG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjdXJyZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDdXJyZW50KCkge1xuICAgIHNldEN1cnJlbnRDb25maWd1cmF0aW9uKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcm91dGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgcm91dGVzLlxuICAgKi9cbiAgZ2V0Um91dGVzKCkgeyByZXR1cm4gdGhpcy5fcm91dGVzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcm91dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHR9IG5ld1JvdXRlcyAtIE5ldyByb3V0ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFJvdXRlcyhuZXdSb3V0ZXMpIHtcbiAgICB0aGlzLl9yb3V0ZXMgPSBuZXdSb3V0ZXNcbiAgICB0aGlzLl9hcHBseVJvdXRlTW91bnRzKG5ld1JvdXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGFueSBgcm91dGUubW91bnQoLi4uKWAgcmVnaXN0cmF0aW9ucyBmcm9tIHRoZSByb3V0ZXMgZmlsZSBieSBsZXR0aW5nXG4gICAqIGVhY2ggbW91bnRhYmxlIHJlZ2lzdGVyIGl0cyByb3V0ZXMgKHR5cGljYWxseSByb3V0ZS1yZXNvbHZlciBob29rcykgYWdhaW5zdFxuICAgKiB0aGlzIGNvbmZpZ3VyYXRpb24uIEd1YXJkZWQgc28gcmVwZWF0ZWQgc2V0Um91dGVzIGNhbGxzIHdpdGggdGhlIHNhbWUgcm91dGVzXG4gICAqIGRvbid0IHJlZ2lzdGVyIGEgbW91bnQgbW9yZSB0aGFuIG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdH0gbmV3Um91dGVzIC0gUm91dGVzIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYXBwbHlSb3V0ZU1vdW50cyhuZXdSb3V0ZXMpIHtcbiAgICBpZiAoIW5ld1JvdXRlcyB8fCB0eXBlb2YgbmV3Um91dGVzLmdldE1vdW50cyAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgbW91bnQgb2YgbmV3Um91dGVzLmdldE1vdW50cygpKSB7XG4gICAgICBpZiAodGhpcy5fYXBwbGllZFJvdXRlTW91bnRzLmhhcyhtb3VudCkpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuX2FwcGxpZWRSb3V0ZU1vdW50cy5hZGQobW91bnQpXG4gICAgICBtb3VudC5tb3VudGFibGUubW91bnRJbnRvKHtjb25maWd1cmF0aW9uOiB0aGlzLCAuLi5tb3VudC5vcHRpb25zfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyBwbHVnaW4vbGlicmFyeSByb3V0ZXMgdXNpbmcgYSBsaWdodHdlaWdodCByb3V0ZSBEU0wgYmFja2VkIGJ5IHJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKiBAcGFyYW0geyhyb3V0ZXM6IGltcG9ydChcIi4vcm91dGVzL3BsdWdpbi1yb3V0ZXMuanNcIikuZGVmYXVsdCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBSb3V0ZXMgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJvdXRlcyhjYWxsYmFjaykge1xuICAgIGNvbnN0IHBsdWdpblJvdXRlcyA9IG5ldyBQbHVnaW5Sb3V0ZXMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuXG4gICAgY2FsbGJhY2socGx1Z2luUm91dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRyYW5zbGF0b3IuXG4gICAqIEBwYXJhbSB7KGFyZzE6IHN0cmluZywgYXJnMjogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkKSA9PiBzdHJpbmd9IGNhbGxiYWNrIC0gVHJhbnNsYXRvciBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VHJhbnNsYXRvcihjYWxsYmFjaykgeyB0aGlzLl90cmFuc2xhdG9yID0gY2FsbGJhY2sgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1zZ0lEIC0gTXNnIGlkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3NdIC0gVHJhbnNsYXRvciBvcHRpb25zIGFuZCB2YXJpYWJsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICovXG4gIF9kZWZhdWx0VHJhbnNsYXRvcihtc2dJRCwgYXJncykge1xuICAgIHRoaXMuX2NvbmZpZ3VyZURlZmF1bHRUcmFuc2xhdG9yKClcblxuICAgIGNvbnN0IHRyYW5zbGF0ZUFyZ3MgPSBhcmdzID8gey4uLmFyZ3N9IDogdW5kZWZpbmVkXG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gdHJhbnNsYXRlQXJncz8uZGVmYXVsdFZhbHVlXG4gICAgY29uc3QgbG9jYWxlcyA9IHRyYW5zbGF0ZUFyZ3M/LmxvY2FsZXNcblxuICAgIGlmICh0cmFuc2xhdGVBcmdzKSB7XG4gICAgICBkZWxldGUgdHJhbnNsYXRlQXJncy5kZWZhdWx0VmFsdWVcbiAgICAgIGRlbGV0ZSB0cmFuc2xhdGVBcmdzLmxvY2FsZXNcbiAgICB9XG5cbiAgICBjb25zdCB2YXJpYWJsZXMgPSB0cmFuc2xhdGVBcmdzICYmIE9iamVjdC5rZXlzKHRyYW5zbGF0ZUFyZ3MpLmxlbmd0aCA+IDAgPyB0cmFuc2xhdGVBcmdzIDogdW5kZWZpbmVkXG5cbiAgICBjb25zdCBsb2NhbGUgPSB0aGlzLmdldExvY2FsZSgpXG4gICAgY29uc3QgcHJlZmVycmVkTG9jYWxlcyA9IGxvY2FsZXMgfHwgKGxvY2FsZSA/IHVuZGVmaW5lZCA6IFtdKVxuICAgIGNvbnN0IG1lc3NhZ2UgPSB0cmFuc2xhdGUobXNnSUQsIHZhcmlhYmxlcywgcHJlZmVycmVkTG9jYWxlcylcblxuICAgIGlmIChtZXNzYWdlID09PSBtc2dJRCAmJiBkZWZhdWx0VmFsdWUpIHJldHVybiB0cmFuc2xhdGUoZGVmYXVsdFZhbHVlLCB2YXJpYWJsZXMsIFtdKVxuXG4gICAgcmV0dXJuIG1lc3NhZ2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cmFuc2xhdG9yLlxuICAgKiBAcmV0dXJucyB7KG1zZ0lEOiBzdHJpbmcsIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHN0cmluZ30gLSBUaGUgY29uZmlndXJlZCB0cmFuc2xhdG9yLlxuICAgKi9cbiAgZ2V0VHJhbnNsYXRvcigpIHtcbiAgICBpZiAodGhpcy5fdHJhbnNsYXRvcikgcmV0dXJuIHRoaXMuX3RyYW5zbGF0b3JcblxuICAgIGlmICghdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZCkge1xuICAgICAgdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZCA9IHRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yLmJpbmQodGhpcylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gQ29uZmlndXJlIGdldHRleHQgZGVmYXVsdHMgZm9yIHRoaXMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9jb25maWd1cmVEZWZhdWx0VHJhbnNsYXRvcigpIHtcbiAgICBjb25zdCBsb2NhbGUgPSB0aGlzLmdldExvY2FsZSgpXG5cbiAgICBnZXR0ZXh0Q29uZmlnLnNldExvY2FsZShsb2NhbGUgfHwgXCJcIilcblxuICAgIGNvbnN0IGZhbGxiYWNrcyA9IGxvY2FsZSA/IHRoaXMuZ2V0TG9jYWxlRmFsbGJhY2tzKCk/Lltsb2NhbGVdIDogW11cblxuICAgIGdldHRleHRDb25maWcuc2V0RmFsbGJhY2tzKGZhbGxiYWNrcyB8fCBbXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lem9uZSBvZmZzZXQgbWludXRlcy5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaGUgdGltZXpvbmUgb2Zmc2V0IGluIG1pbnV0ZXMuXG4gICAqL1xuICBnZXRUaW1lem9uZU9mZnNldE1pbnV0ZXMoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY29uc3QgY29uZmlndXJlZE9mZnNldCA9IHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcygpXG5cbiAgICAgIGlmICh0eXBlb2YgY29uZmlndXJlZE9mZnNldCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIGNvbmZpZ3VyZWRPZmZzZXRcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlc1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgRGF0ZSgpLmdldFRpbWV6b25lT2Zmc2V0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lIHpvbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0VGltZVpvbmUoKSB7XG4gICAgY29uc3QgdGltZVpvbmUgPSB0eXBlb2YgdGhpcy5fdGltZVpvbmUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyB0aGlzLl90aW1lWm9uZSgpXG4gICAgICA6IHRoaXMuX3RpbWVab25lXG5cbiAgICBpZiAodGltZVpvbmUgPT09IHVuZGVmaW5lZCB8fCB0aW1lWm9uZSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiY29uZmlndXJhdGlvbiB0aW1lWm9uZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBldmVudHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IGV2ZW50cy5cbiAgICovXG4gIGdldFdlYnNvY2tldEV2ZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMuanNcIikuZGVmYXVsdH0gd2Vic29ja2V0RXZlbnRzIC0gV2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0V2Vic29ja2V0RXZlbnRzKHdlYnNvY2tldEV2ZW50cykge1xuICAgIHRoaXMuX3dlYnNvY2tldEV2ZW50cyA9IHdlYnNvY2tldEV2ZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFBlci1wcm9jZXNzIHJlZ2lzdHJ5IG9mIGNoYW5uZWwgc3Vic2NyaWJlcnMgdXNlZCBieSB3b3JrZXIgY29kZSB0aGF0XG4gICAqIG5lZWRzIHRvIHJlYWN0IHRvIGV2ZW50cyBicm9hZGNhc3QgdmlhIGB3ZWJzb2NrZXRFdmVudHNIb3N0LnB1Ymxpc2goLi4uKWBcbiAgICogd2l0aG91dCBob2xkaW5nIGFuIGFjdHVhbCB3ZWJzb2NrZXQgc2Vzc2lvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanNcIikuZGVmYXVsdH0gLSBUaGUgY2hhbm5lbCBzdWJzY3JpYmVycyByZWdpc3RyeS5cbiAgICovXG4gIGdldFdlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycygpIHtcbiAgICBpZiAoIXRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycykge1xuICAgICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzID0gbmV3IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjaGFubmVsIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldENoYW5uZWxSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBjaGFubmVsIHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBgVmVsb2Npb3VzV2Vic29ja2V0Q29ubmVjdGlvbmAgc3ViY2xhc3MgdW5kZXIgYSBuYW1lLlxuICAgKiBDbGllbnRzIHRoYXQgc2VuZCBge3R5cGU6IFwiY29ubmVjdGlvbi1vcGVuXCIsIGNvbm5lY3Rpb25UeXBlOiBuYW1lfWBcbiAgICogd2lsbCBoYXZlIHRoaXMgY2xhc3MgaW5zdGFudGlhdGVkIGZvciB0aGVpciBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENsaWVudC1mYWNpbmcgY29ubmVjdGlvbiB0eXBlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdH0gQ29ubmVjdGlvbkNsYXNzIC0gV2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVnaXN0ZXJXZWJzb2NrZXRDb25uZWN0aW9uKG5hbWUsIENvbm5lY3Rpb25DbGFzcykge1xuICAgIGlmICghbmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbiBuYW1lIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCFDb25uZWN0aW9uQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIkNvbm5lY3Rpb25DbGFzcyBpcyByZXF1aXJlZFwiKVxuICAgIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzLnNldChuYW1lLCBDb25uZWN0aW9uQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29ubmVjdGlvbiB0eXBlIG5hbWUgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jb25uZWN0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gUmVnaXN0ZXJlZCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICovXG4gIGdldFdlYnNvY2tldENvbm5lY3Rpb25DbGFzcyhuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzLmdldChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsYCBzdWJjbGFzcyB1bmRlciBhIG5hbWUuXG4gICAqIENsaWVudHMgc3Vic2NyaWJlIHZpYSBge3R5cGU6IFwiY2hhbm5lbC1zdWJzY3JpYmVcIiwgY2hhbm5lbFR5cGU6IG5hbWUsIC4uLn1gLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENsaWVudC1mYWNpbmcgY2hhbm5lbCB0eXBlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gQ2hhbm5lbENsYXNzIC0gV2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7e2xpdmVPbmx5PzogYm9vbGVhbn19IFtvcHRpb25zXSAtIFJlZ2lzdHJhdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChuYW1lLCBDaGFubmVsQ2xhc3MsIHtsaXZlT25seSA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKCFuYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJDaGFubmVsIG5hbWUgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIUNoYW5uZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ2hhbm5lbENsYXNzIGlzIHJlcXVpcmVkXCIpXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMuc2V0KG5hbWUsIENoYW5uZWxDbGFzcylcblxuICAgIGlmIChsaXZlT25seSkgdGhpcy5fbGl2ZU9ubHlXZWJzb2NrZXRDaGFubmVscy5hZGQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBSZWdpc3RlcmVkIHdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbENsYXNzKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMuZ2V0KG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGNoYW5uZWwgdHlwZSB3YXMgcmVnaXN0ZXJlZCB3aXRoIGB7bGl2ZU9ubHk6IHRydWV9YC5cbiAgICogTGl2ZS1vbmx5IGNoYW5uZWxzIGFyZSBuZXZlciBwZXJzaXN0ZWQgZm9yIHJlcGxheTogdGhlIGV2ZW50LWxvZ1xuICAgKiBzdG9yZSdzIGBtYXJrQ2hhbm5lbEludGVyZXN0ZWRgIHRocm93cyBmb3IgdGhlaXIgbmFtZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIG5hbWUgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2hhbm5lbCBpcyBkZWNsYXJlZCBsaXZlLW9ubHkuXG4gICAqL1xuICBpc1dlYnNvY2tldENoYW5uZWxMaXZlT25seShuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX2xpdmVPbmx5V2Vic29ja2V0Q2hhbm5lbHMuaGFzKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgbGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiBpbiB0aGUgZ2xvYmFsIHJvdXRpbmcgcmVnaXN0cnkuXG4gICAqIENhbGxlZCBieSB0aGUgc2Vzc2lvbiB3aGVuIGBjYW5TdWJzY3JpYmUoKWAgcmVzb2x2ZXMgdHJ1dGh5OyB0aGVcbiAgICogc2Vzc2lvbiBjYWxscyBgX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uYCBvbiB1bnN1YnNjcmliZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgdXNlZCBhcyB0aGUgcm91dGluZyBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBzdWJzY3JpcHRpb24gLSBMaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIHRvIHJlZ2lzdGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb24obmFtZSwgc3Vic2NyaXB0aW9uKSB7XG4gICAgbGV0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHtcbiAgICAgIGJ1Y2tldCA9IG5ldyBTZXQoKVxuICAgICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuc2V0KG5hbWUsIGJ1Y2tldClcbiAgICB9XG5cbiAgICBidWNrZXQuYWRkKHN1YnNjcmlwdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVucmVnaXN0ZXIgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSB1c2VkIGFzIHRoZSByb3V0aW5nIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIExpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gdG8gcmVtb3ZlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF91bnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihuYW1lLCBzdWJzY3JpcHRpb24pIHtcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5nZXQobmFtZSlcblxuICAgIGlmICghYnVja2V0KSByZXR1cm5cblxuICAgIGJ1Y2tldC5kZWxldGUoc3Vic2NyaXB0aW9uKVxuXG4gICAgaWYgKGJ1Y2tldC5zaXplID09PSAwKSB7XG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5kZWxldGUobmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsaXZlcnMgYGJvZHlgIHRvIGV2ZXJ5IGxpdmUgc3Vic2NyaWJlciBvZiBgbmFtZWAgd2hvc2VcbiAgICogYG1hdGNoZXMoYnJvYWRjYXN0UGFyYW1zKWAgcmV0dXJucyB0cnVlLiBQdXJlIHJvdXRpbmcg4oCUIG5vIGF1dGhcbiAgICogcmUtY2hlY2ssIG5vIHBlcnNpc3RlbmNlLiBTdWJzY3JpYmVycyB3aG8gd2VyZSBhZG1pdHRlZCBieVxuICAgKiBgY2FuU3Vic2NyaWJlKClgIGNvbnRpbnVlIHRvIHJlY2VpdmUgYnJvYWRjYXN0cyB1bnRpbCB0aGV5XG4gICAqIHVuc3Vic2NyaWJlIG9yIHRoZSBzZXNzaW9uIGVuZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXNcbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keVxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBncmFjZSBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEdyYWNlIHBlcmlvZCAoc2Vjb25kcykgYmVmb3JlIGEgcGF1c2VkIFdTIHNlc3Npb24gaXMgdG9ybiBkb3duLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcygpIHsgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBoZWFydGJlYXQgc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBJbnRlcnZhbCAoc2Vjb25kcykgYmV0d2VlbiBzZXJ2ZXLihpJjbGllbnQgaGVhcnRiZWF0IHBpbmdzOyAwIGRpc2FibGVzIHJlYXBpbmcuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcygpIHsgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzIH1cblxuICAvKipcbiAgICogR2V0cyBwZXItc2Vzc2lvbiBXZWJTb2NrZXQgaW5ib3VuZCBtZXNzYWdlIHF1ZXVlIGxpbWl0cy5cbiAgICogQHJldHVybnMge3ttYXhCeXRlczogbnVtYmVyLCBtYXhNZXNzYWdlczogbnVtYmVyfX0gLSBQZXItc2Vzc2lvbiBpbmJvdW5kIHF1ZXVlIGhpZ2gtd2F0ZXIgbWFya3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRJbmJvdW5kUXVldWVMaW1pdHMoKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLmh0dHBTZXJ2ZXIud2Vic29ja2V0SW5ib3VuZFF1ZXVlXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWF4Qnl0ZXM6IHF1ZXVlLm1heFBlbmRpbmdCeXRlcyxcbiAgICAgIG1heE1lc3NhZ2VzOiBxdWV1ZS5tYXhQZW5kaW5nTWVzc2FnZXNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBwZXItY2xpZW50IFdlYlNvY2tldCBvdXRib3VuZCBxdWV1ZSBsaW1pdHMuXG4gICAqIEByZXR1cm5zIHt7bWF4Qnl0ZXM6IG51bWJlciwgbWF4RnJhbWVzOiBudW1iZXJ9fSAtIFBlci1jbGllbnQgb3V0Ym91bmQgcXVldWUgaGlnaC13YXRlciBtYXJrcy5cbiAgICovXG4gIGdldFdlYnNvY2tldE91dGJvdW5kUXVldWVMaW1pdHMoKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLmh0dHBTZXJ2ZXIud2Vic29ja2V0T3V0Ym91bmRRdWV1ZVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1heEJ5dGVzOiBxdWV1ZS5tYXhQZW5kaW5nQnl0ZXMsXG4gICAgICBtYXhGcmFtZXM6IHF1ZXVlLm1heFBlbmRpbmdGcmFtZXNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgd3JhcHBlciBpbnZva2VkIGFyb3VuZCBldmVyeSBXUy1ib3JuZSByZXF1ZXN0IC9cbiAgICogY29ubmVjdGlvbiBtZXNzYWdlIC8gY2hhbm5lbCBkaXNwYXRjaC4gVGhlIHdyYXBwZXIgcmVjZWl2ZXMgdGhlXG4gICAqIHNlc3Npb24gYW5kIGEgYG5leHRgIGNhbGxiYWNrOyBpdCBtdXN0IGNhbGwgYG5leHQoKWAgdG8gcnVuIHRoZVxuICAgKiBoYW5kbGVyLiBVc2UgaXQgdG8gc2V0IHVwIEFzeW5jTG9jYWxTdG9yYWdlIHBlciByZXF1ZXN0LlxuICAgKiBAcGFyYW0geygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSB3cmFwcGVyIC0gUGVyLW1lc3NhZ2Ugc2Vzc2lvbi1jb250ZXh0IHdyYXBwZXIsIG9yIG51bGwgdG8gZGlzYWJsZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRBcm91bmRSZXF1ZXN0KHdyYXBwZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0ID0gd3JhcHBlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBhcm91bmQgcmVxdWVzdC5cbiAgICogQHJldHVybnMgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAtIFdlYnNvY2tldCBzZXNzaW9uIHdyYXBwZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRBcm91bmRSZXF1ZXN0KCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgd3JhcHBlciBpbnZva2VkIGFyb3VuZCBldmVyeSBjb250cm9sbGVyIGFjdGlvbiDigJQgYm90aFxuICAgKiBIVFRQIGFuZCBXUy1ib3JuZS4gUmVjZWl2ZXMgYHtyZXF1ZXN0LCByZXNwb25zZSwgbmV4dH1gIGFuZCBtdXN0XG4gICAqIGNhbGwgYG5leHQoKWAgdG8gcnVuIHRoZSBhY3Rpb24uIFVzZSBpdCBmb3IgcGVyLXJlcXVlc3QgY29udGV4dFxuICAgKiBsaWtlIEFzeW5jTG9jYWxTdG9yYWdlLXNjb3BlZCBsb2NhbGUgb3IgdHJhY2luZy5cbiAgICogQHBhcmFtIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gd3JhcHBlciAtIFBlci1hY3Rpb24gcmVxdWVzdC1jb250ZXh0IHdyYXBwZXIsIG9yIG51bGwgdG8gZGlzYWJsZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRBcm91bmRBY3Rpb24od3JhcHBlcikge1xuICAgIHRoaXMuX2Fyb3VuZEFjdGlvbiA9IHdyYXBwZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcm91bmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7KChjb250ZXh0OiB7cmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgcmVzcG9uc2U6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD59KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gSFRUUCByZXF1ZXN0IHdyYXBwZXIuXG4gICAqL1xuICBnZXRBcm91bmRBY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Fyb3VuZEFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhbiBpZGVudGl0eSByZXNvbHZlciBjYWxsZWQgb25jZSBhdCBwYXVzZSB0aW1lIGFuZCBvbmNlXG4gICAqIGF0IHJlc3VtZSB0aW1lLiBUaGUgcmVzb2x2ZXIgcmVjZWl2ZXMgdGhlIHNlc3Npb24gYW5kIHJldHVybnMgYW55XG4gICAqIHZhbHVlIHRoYXQgaWRlbnRpZmllcyB0aGUgYXV0aGVudGljYXRlZCBjYWxsZXIg4oCUIHR5cGljYWxseSBhXG4gICAqIGB1c2VySWRgIHJlYWQgZnJvbSB0aGUgc2Vzc2lvbidzIHVwZ3JhZGUtcmVxdWVzdCBjb29raWUuIFZlbG9jaW91c1xuICAgKiBjYXB0dXJlcyB0aGUgcGF1c2UtdGltZSB2YWx1ZSBvbiB0aGUgcGF1c2VkIHNlc3Npb24gYW5kIGNvbXBhcmVzXG4gICAqIGl0IHZpYSBgPT09YCAob3IgZGVlcC1lcXVhbGl0eSBmb3IgcGxhaW4gb2JqZWN0cykgdG8gdGhlIGZyZXNoXG4gICAqIHJlc3VtZS10aW1lIHZhbHVlLiBJZiB0aGV5IGRpZmZlciwgdGhlIHJlc3VtZSBpcyByZWplY3RlZCB3aXRoXG4gICAqIGBzZXNzaW9uLWdvbmVgIGFuZCB0aGUgcGF1c2VkIHNlc3Npb24gaXMgZGVzdHJveWVkIHNvIGEgc2lnbmVkLW91dFxuICAgKiBvciByZS1hdXRoZW50aWNhdGVkIGNsaWVudCBjYW5ub3QgcmVjbGFpbSBhbm90aGVyIHVzZXIncyBzdGF0ZS5cbiAgICpcbiAgICogUmV0dXJuIGBudWxsYC9gdW5kZWZpbmVkYCB0byBtZWFuIFwibm8gaWRlbnRpdHlcIiDigJQgcmVzdW1lcyBzdGlsbFxuICAgKiBzdWNjZWVkIGlmIHBhdXNlIGFuZCByZXN1bWUgYm90aCByZXNvbHZlIHRvIGEgbnVsbGlzaCB2YWx1ZS5cbiAgICogQHBhcmFtIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgbnVsbH0gcmVzb2x2ZXIgLSBBdXRoZW50aWNhdGVkLWNhbGxlciBpZGVudGl0eSByZXNvbHZlciwgb3IgbnVsbCB0byBkaXNhYmxlIGlkZW50aXR5IGNoZWNrcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBpZGVudGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSAtIFRoZSBjb25maWd1cmVkIGlkZW50aXR5IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IHNlc3Npb24gZ3JhY2Ugc2Vjb25kcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBHcmFjZSBwZXJpb2QgYmVmb3JlIGEgcGF1c2VkIHNlc3Npb24gZXhwaXJlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzKHNlY29uZHMpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShzZWNvbmRzKSB8fCBzZWNvbmRzIDwgMCkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGdyYWNlIHNlY29uZHM6ICR7c2Vjb25kc31gKVxuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgPSBzZWNvbmRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IHNlc3Npb24gaGVhcnRiZWF0IHNlY29uZHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzZWNvbmRzIC0gSGVhcnRiZWF0IGludGVydmFsLCB3aXRoIHplcm8gZGlzYWJsaW5nIHJlYXBpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMoc2Vjb25kcykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNlY29uZHMpIHx8IHNlY29uZHMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgaGVhcnRiZWF0IHNlY29uZHM6ICR7c2Vjb25kc31gKVxuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzID0gc2Vjb25kc1xuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIGEgc2Vzc2lvbiBpbnRvIHRoZSBwYXVzZWQgcmVnaXN0cnkgYW5kIHN0YXJ0cyB0aGUgZ3JhY2VcbiAgICogdGltZXIuIFdoZW4gdGhlIHRpbWVyIGZpcmVzLCB0aGUgc2Vzc2lvbidzIHBlcm1hbmVudCB0ZWFyZG93blxuICAgKiBob29rIGlzIGludm9rZWQuIENhbGxlZCBieSB0aGUgc2Vzc2lvbiBpdHNlbGYgZnJvbSBgX2hhbmRsZUNsb3NlYFxuICAgKiB3aGVuIHRoZXJlIGlzIHJlc3VtYWJsZSBzdGF0ZSAobGl2ZSBDb25uZWN0aW9ucyAvIENoYW5uZWwgc3VicykuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdH0gc2Vzc2lvbiAtIFJlc3VtYWJsZSBzZXNzaW9uIHRvIHJldGFpbiBkdXJpbmcgaXRzIGdyYWNlIHBlcmlvZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcGF1c2VXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb24pIHtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBzZXNzaW9uLnNlc3Npb25JZFxuXG4gICAgaWYgKCFzZXNzaW9uSWQpIHRocm93IG5ldyBFcnJvcihcIlNlc3Npb24gbXVzdCBoYXZlIGEgc2Vzc2lvbklkIHRvIGJlIHBhdXNlZFwiKVxuICAgIGlmICh0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5oYXMoc2Vzc2lvbklkKSkgcmV0dXJuXG5cbiAgICBjb25zdCBncmFjZU1zID0gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyAqIDEwMDBcbiAgICBjb25zdCBncmFjZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9leHBpcmVXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZClcbiAgICB9LCBncmFjZU1zKVxuXG4gICAgLy8gRG9uJ3Qga2VlcCB0aGUgcHJvY2VzcyBhbGl2ZSBwdXJlbHkgZm9yIGEgcGF1c2VkIHNlc3Npb24gdGltZXIuXG4gICAgaWYgKHR5cGVvZiBncmFjZVRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIGdyYWNlVGltZXIudW5yZWYoKVxuXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuc2V0KHNlc3Npb25JZCwge3Nlc3Npb24sIGdyYWNlVGltZXIsIHBhdXNlZEF0OiBEYXRlLm5vdygpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb29rcyB1cCBhIHBhdXNlZCBzZXNzaW9uIGJ5IGlkIChkb2VzIE5PVCByZW1vdmUgaXQg4oCUIGNhbGxlciBpc1xuICAgKiBleHBlY3RlZCB0byBjYWxsIGBfcmVzdW1lV2Vic29ja2V0U2Vzc2lvbmAgdG8gY29tcGxldGUgdGhlIGhhbmRvZmYpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gUGF1c2VkIHNlc3Npb24gaWRlbnRpZmllciB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCB8IG51bGx9IC0gUGF1c2VkIHNlc3Npb24gd2l0aCB0aGUgcmVxdWVzdGVkIGlkZW50aWZpZXIsIGlmIHByZXNlbnQuXG4gICAqL1xuICBfZmluZFBhdXNlZFdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmdldChzZXNzaW9uSWQpPy5zZXNzaW9uIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgcGF1c2VkIHNlc3Npb24gZnJvbSB0aGUgcmVnaXN0cnkgYW5kIGNhbmNlbHMgaXRzIGdyYWNlXG4gICAqIHRpbWVyLiBDYWxsZWQgb24gc3VjY2Vzc2Z1bCByZXN1bWUgaGFuZG9mZiBhbmQgb24gZXhwbGljaXRcbiAgICogZXhwaXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gUGF1c2VkIHNlc3Npb24gaWRlbnRpZmllciB0byByZW1vdmUgYW5kIGNhbmNlbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJQYXVzZWRXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZClcblxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgY2xlYXJUaW1lb3V0KGVudHJ5LmdyYWNlVGltZXIpXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZGVsZXRlKHNlc3Npb25JZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFjZS10aW1lciBjYWxsYmFjay4gQ2FsbHMgdGhlIHNlc3Npb24ncyBwZXJtYW5lbnQtdGVhcmRvd25cbiAgICogaG9vayBhbmQgZHJvcHMgaXQgZnJvbSB0aGUgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHdob3NlIGdyYWNlIHBlcmlvZCBleHBpcmVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9leHBpcmVXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZClcblxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZGVsZXRlKHNlc3Npb25JZClcbiAgICB0cnkge1xuICAgICAgZW50cnkuc2Vzc2lvbi5fZmluYWxpemVHcmFjZUV4cGlyeSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBmaW5hbGl6ZSBleHBpcmVkIFdTIHNlc3Npb24gJHtzZXNzaW9uSWR9YCwgZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnJvYWRjYXN0IHRvIGNoYW5uZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHJlY2VpdmluZyB0aGUgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gVmFsdWVzIHVzZWQgdG8gbWF0Y2ggZWxpZ2libGUgc3Vic2NyaXB0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIEJyb2FkY2FzdCBwYXlsb2FkIGRlbGl2ZXJlZCB0byBtYXRjaGluZyBzdWJzY3JpcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGJyb2FkY2FzdFRvQ2hhbm5lbChuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHkpIHtcbiAgICAvLyBXaGVuIEJlYWNvbiBpcyBjb25uZWN0ZWQsIHNoaXAgdGhlIGJyb2FkY2FzdCBvbnRvIHRoZSBidXMuIFRoZVxuICAgIC8vIGRhZW1vbiBlY2hvZXMgaXQgYmFjayB0byBldmVyeSBwZWVyIChpbmNsdWRpbmcgdGhpcyBvbmUpIGFuZFxuICAgIC8vIGVhY2ggcGVlcidzIGBfZGVsaXZlckJyb2FkY2FzdEZyb21CZWFjb25gIHBlcmZvcm1zIHRoZSBzYW1lXG4gICAgLy8gbG9jYWwgZGVsaXZlcnkgYXMgdGhlIHN5bmNocm9ub3VzIHBhdGhzIGJlbG93IOKAlCBzbyBldmVyeVxuICAgIC8vIHN1YnNjcmliZXIsIGluIGFueSBwcm9jZXNzLCBzZWVzIGJyb2FkY2FzdHMgdmlhIGEgc2luZ2xlIGNvZGVcbiAgICAvLyBwYXRoLlxuICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQgJiYgdGhpcy5fYmVhY29uQ2xpZW50LmlzQ29ubmVjdGVkKCkpIHtcbiAgICAgIGNvbnN0IHNlbnQgPSB0aGlzLl9iZWFjb25DbGllbnQucHVibGlzaCh7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5fSlcblxuICAgICAgaWYgKHNlbnQpIHJldHVyblxuICAgIH1cblxuICAgIC8vIFYyIHN1YnNjcmlwdGlvbnMgbGl2ZSBwZXIgd29ya2VyLXRocmVhZC4gV2hlbiBydW5uaW5nIGluXG4gICAgLy8gd29ya2VyLXRocmVhZCBtb2RlLCB0aGUgcHVibGlzaGVyIHJ1bnMgZWl0aGVyIGluIHRoZSBtYWluXG4gICAgLy8gcHJvY2VzcyAoaG9zdCkgb3IgaW4gb25lIG9mIHRoZSB3b3JrZXJzOlxuICAgIC8vXG4gICAgLy8gIC0gTWFpbiBwcm9jZXNzOiBgX3dlYnNvY2tldEV2ZW50c2AgaXMgdGhlIGhvc3Qgc2luZ2xldG9uIGFuZFxuICAgIC8vICAgIGBicm9hZGNhc3RWMmAgZmFucyBvdXQgdG8gZXZlcnkgd29ya2VyIGRpcmVjdGx5LlxuICAgIC8vICAtIFdvcmtlcjogYF93ZWJzb2NrZXRFdmVudHNgIGhhcyBgcHVibGlzaFYyQnJvYWRjYXN0YCB0aGF0XG4gICAgLy8gICAgcG9zdHMgdG8gbWFpbiwgd2hpY2ggdGhlbiBmYW5zIG91dCB0byBldmVyeSB3b3JrZXIuXG4gICAgLy9cbiAgICAvLyBJbi1wcm9jZXNzIG1vZGUgZG9lc24ndCBpbnN0YWxsIGEgd2Vic29ja2V0LWV2ZW50cyB0cmFuc3BvcnQsXG4gICAgLy8gc28gZmFsbCB0aHJvdWdoIHRvIHRoZSBsb2NhbCBkaXNwYXRjaC5cbiAgICAvKipcbiAgICAgKiBXZWJzb2NrZXQgZXZlbnRzLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBjb25zdCB3ZWJzb2NrZXRFdmVudHMgPSB0aGlzLl93ZWJzb2NrZXRFdmVudHNcblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIoe2NoYW5uZWw6IG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSwgY29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMucHVibGlzaFYyQnJvYWRjYXN0ID09PSBcImZ1bmN0aW9uXCIgJiYgd2Vic29ja2V0RXZlbnRzLnBhcmVudFBvcnQpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5wdWJsaXNoVjJCcm9hZGNhc3Qoe2NoYW5uZWw6IG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIGFsbCBwZW5kaW5nIGJyb2FkY2FzdCBvcGVyYXRpb25zIChpbmNsdWRpbmcgZXZlbnQtbG9nXG4gICAqIHBlcnNpc3RlbmNlKS4gQ2FsbCB0aGlzIGFmdGVyIGBicm9hZGNhc3RUb0NoYW5uZWxgIHdoZW4geW91IG5lZWRcbiAgICogdGhlIGV2ZW50IHRvIGJlIHBlcnNpc3RlZCBiZWZvcmUgY29udGludWluZyAoZS5nLiBiZWZvcmVcbiAgICogcmVzcG9uZGluZyB0byBhbiBIVFRQIHJlcXVlc3QpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMoKSB7XG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYXdhaXRQZW5kaW5nQnJvYWRjYXN0cyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAvLyBEcmFpbiB0aGUgaG9zdC93b3JrZXIgcHVibGlzaCBxdWV1ZXMgKGluY2x1ZGluZyBldmVudC1sb2cgcGVyc2lzdGVuY2UpXG4gICAgICAvLyBiZWZvcmUgZHJhaW5pbmcgbG9jYWwgZGVsaXZlcmllcywgYmVjYXVzZSBob3N0IGRpc3BhdGNoIGxhdW5jaGVzIHRoZVxuICAgICAgLy8gbG9jYWwgZGVsaXZlcmllcyBzeW5jaHJvbm91c2x5IGFuZCB0aGV5IG11c3QgYmUgcGFydCBvZiB0aGUgc25hcHNob3QuXG4gICAgICBhd2FpdCB3ZWJzb2NrZXRFdmVudHMuYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYXdhaXRMb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIExvY2FsIChwZXItd29ya2VyKSBjaGFubmVsIGJyb2FkY2FzdCBkaXNwYXRjaC4gQ2FsbGVkIGVpdGhlclxuICAgKiBkaXJlY3RseSAoaW4tcHJvY2VzcyBtb2RlKSBvciBieSB0aGUgd29ya2VyIHRocmVhZCBhZnRlciB0aGVcbiAgICogbWFpbi1wcm9jZXNzIGZhbi1vdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gUGFyYW1zIHBhc3NlZCB0byBlYWNoIHN1YnNjcmlwdGlvbidzIGBtYXRjaGVzKClgLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gTWVzc2FnZSBib2R5IGRlbGl2ZXJlZCB2aWEgYHNlbmRNZXNzYWdlKClgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0QnJvYWRjYXN0TWV0YWRhdGF9IFttZXRhXSAtIE9wdGlvbmFsIGV2ZW50IG1ldGFkYXRhIGZvciByZXBsYXkgdHJhY2tpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSwgbWV0YSkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgYnVja2V0KSB7XG4gICAgICBpZiAoc3Vic2NyaXB0aW9uLmlzQ2xvc2VkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGxldCBtYXRjaGVzXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIG1hdGNoZXMgPSBzdWJzY3JpcHRpb24ubWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMgfHwge30pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBBIGJyb2tlbiBgbWF0Y2hlcygpYCBvbiBvbmUgc3Vic2NyaWJlciBtdXN0IG5vdCBwb2lzb24gdGhlXG4gICAgICAgIC8vIGJyb2FkY2FzdCB0byBvdGhlciBzdWJzY3JpYmVycy4gU2tpcCBhbmQgY29udGludWUuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYGJyb2FkY2FzdFRvQ2hhbm5lbDogJHtuYW1lfSBzdWJzY3JpcHRpb24gJHtzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWR9IG1hdGNoZXMoKSB0aHJld2AsIGVycm9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1hdGNoZXMpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRlbGl2ZXJ5TWV0YWRhdGEgPSB7XG4gICAgICAgIGJyb2FkY2FzdFBhcmFtcyxcbiAgICAgICAgLi4uKG1ldGE/LmV2ZW50SWQgPyB7ZXZlbnRJZDogbWV0YS5ldmVudElkfSA6IHt9KVxuICAgICAgfVxuICAgICAgY29uc3QgcHJldmlvdXNEZWxpdmVyeSA9IHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5nZXQoc3Vic2NyaXB0aW9uKVxuICAgICAgY29uc3QgZGVsaXZlcnkgPSB0aGlzLndpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHRzKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICAgIHJldHVybiAocHJldmlvdXNEZWxpdmVyeSB8fCBQcm9taXNlLnJlc29sdmUoKSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuX2RlbGl2ZXJXZWJzb2NrZXRDaGFubmVsQnJvYWRjYXN0KHN1YnNjcmlwdGlvbiwgYm9keSwgZGVsaXZlcnlNZXRhZGF0YSkpXG4gICAgICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYGJyb2FkY2FzdFRvQ2hhbm5lbDogJHtuYW1lfSBzdWJzY3JpcHRpb24gJHtzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWR9IGRlbGl2ZXJCcm9hZGNhc3QgdGhyZXdgLCBlcnJvcilcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICB9KVxuXG4gICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuc2V0KHN1YnNjcmlwdGlvbiwgZGVsaXZlcnkpXG5cbiAgICAgIC8vIEtlZXAgdGhlIGZpcmUtYW5kLWZvcmdldCBkZWxpdmVyeSAobmV2ZXIgYXdhaXRlZCBhdCBicm9hZGNhc3QgdGltZSkgYnV0XG4gICAgICAvLyB0cmFjayBpdCBzbyBgYXdhaXRQZW5kaW5nQnJvYWRjYXN0c2AgY2FuIGRyYWluIGl0IGJlZm9yZSBzZXR0bGluZy4gUmVtb3ZlXG4gICAgICAvLyBvbiBzZXR0bGU7IHRoZSBmYWlsdXJlIGhhbmRsZXIgYWxzbyBzYXRpc2ZpZXMgdGhlIHByb21pc2Ugc28gYSByZWplY3RlZFxuICAgICAgLy8gZGVsaXZlcnkgbmV2ZXIgYmVjb21lcyBhbiB1bmhhbmRsZWQgcmVqZWN0aW9uLlxuICAgICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzLmFkZChkZWxpdmVyeSlcblxuICAgICAgLyoqXG4gICAgICAgKiBSZW1vdmVzIGEgc2V0dGxlZCBkZWxpdmVyeSBmcm9tIGxvY2FsIHRyYWNraW5nLlxuICAgICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICAgKi9cbiAgICAgIGNvbnN0IGZvcmdldERlbGl2ZXJ5ID0gKCkgPT4ge1xuICAgICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMuZGVsZXRlKGRlbGl2ZXJ5KVxuICAgICAgICBpZiAodGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLmdldChzdWJzY3JpcHRpb24pID09PSBkZWxpdmVyeSkgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLmRlbGV0ZShzdWJzY3JpcHRpb24pXG4gICAgICB9XG5cbiAgICAgIGRlbGl2ZXJ5LnRoZW4oZm9yZ2V0RGVsaXZlcnksIGZvcmdldERlbGl2ZXJ5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYSBzbmFwc2hvdCBvZiB0aGUgaW4tZmxpZ2h0IGxvY2FsIChwZXItcHJvY2Vzcykgd2Vic29ja2V0IGNoYW5uZWxcbiAgICogYnJvYWRjYXN0IGRlbGl2ZXJpZXMuIENhbGxlZCBmcm9tIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBhZnRlciB0aGUgaG9zdFxuICAgKiBwdWJsaXNoIHF1ZXVlcyBkcmFpbiwgc28gZXZlcnkgZGVsaXZlcnkgdGhvc2UgcXVldWVzIGxhdW5jaGVkIGlzIGNhcHR1cmVkLlxuICAgKiBOZXcgZGVsaXZlcmllcyBlbnF1ZXVlZCBhZnRlciB0aGUgc25hcHNob3QgYXJlIG5vdCBhd2FpdGVkLiBJbmRpdmlkdWFsXG4gICAqIGRlbGl2ZXJ5IGVycm9ycyBhcmUgaXNvbGF0ZWQgcGVyIHN1YnNjcmliZXIg4oCUIHRoZSBkZWxpdmVyeSBjaGFpbiBhbHJlYWR5XG4gICAqIGxvZ3MgdGhlbSBhbmQgcmVzb2x2ZXMg4oCUIHNvIGEgc25hcHNob3R0ZWQgcmVqZWN0aW9uIG5ldmVyIGZhaWxzIHRoaXMgYmFycmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXdhaXRMb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMoKSB7XG4gICAgY29uc3Qgc25hcHNob3QgPSBbLi4udGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzXVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHNuYXBzaG90KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciB3ZWJzb2NrZXQgY2hhbm5lbCBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBzdWJzY3JpcHRpb24gLSBDaGFubmVsIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEpzb25WYWx1ZX0gYm9keSAtIEJyb2FkY2FzdCBib2R5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0QnJvYWRjYXN0TWV0YWRhdGF9IG1ldGEgLSBCcm9hZGNhc3QgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gQnJvYWRjYXN0IGRlbGl2ZXJ5IHJlc3VsdC5cbiAgICovXG4gIF9kZWxpdmVyV2Vic29ja2V0Q2hhbm5lbEJyb2FkY2FzdChzdWJzY3JpcHRpb24sIGJvZHksIG1ldGEpIHtcbiAgICBpZiAodHlwZW9mIHN1YnNjcmlwdGlvbi5kZWxpdmVyQnJvYWRjYXN0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBzdWJzY3JpcHRpb24uZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKVxuICAgIH1cblxuICAgIHJldHVybiBzdWJzY3JpcHRpb24uc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSB3ZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBjaGFubmVsIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJUeXBlfSByZXNvbHZlciAtIFJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRXZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIgPSByZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJUeXBlfSByZXNvbHZlciAtIFJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRXZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyKHJlc29sdmVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWJpbGl0eSByZXNvbHZlciBhcmdzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSBbYXJncy5yZXF1ZXN0XSAtIFJlcXVlc3Qgb2JqZWN0LiBBYnNlbnQgZm9yIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmlwdGlvbnMgcmVzb2x2ZWQgZnJvbSBzdWJzY3JpYmUgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHR9IFthcmdzLnJlc3BvbnNlXSAtIFJlc3BvbnNlIG9iamVjdC4gQWJzZW50IG91dHNpZGUgSFRUUCByZXF1ZXN0IGhhbmRsaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlZCBhYmlsaXR5LlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUFiaWxpdHkoe3BhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2V9KSB7XG4gICAgY29uc3QgcmVzb2x2ZXIgPSB0aGlzLmdldEFiaWxpdHlSZXNvbHZlcigpXG5cbiAgICBpZiAocmVzb2x2ZXIpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgcmVzb2x2ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXMsIHBhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2V9KVxuXG4gICAgICBpZiAocmVzb2x2ZWQpIHJldHVybiByZXNvbHZlZFxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlcyA9IHRoaXMuZ2V0QWJpbGl0eVJlc291cmNlcygpXG5cbiAgICBpZiAocmVzb3VyY2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICByZXR1cm4gbmV3IEFiaWxpdHkoe1xuICAgICAgY29udGV4dDoge2NvbmZpZ3VyYXRpb246IHRoaXMsIHBhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2V9LFxuICAgICAgcmVzb3VyY2VzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYWJpbGl0eSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoQWJpbGl0eShhYmlsaXR5LCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggcmVxdWVzdCB0aW1pbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gcmVxdWVzdFRpbWluZyAtIFJlcXVlc3QgdGltaW5nIGNvbGxlY3Rvci5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhSZXF1ZXN0VGltaW5nKHJlcXVlc3RUaW1pbmcsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUHJvZmlsZXMgYW4gYXBwbGljYXRpb24tZGVmaW5lZCB0ZXN0IGFjdGl2aXR5IHdoZW4gYW4gb3B0LWluIHRlc3QgcHJvZmlsZVxuICAgKiBjb250ZXh0IGlzIGFjdGl2ZS4gVGhlIGNhbGxiYWNrIGFsd2F5cyBydW5zLCBpbmNsdWRpbmcgb3V0c2lkZSBwcm9maWxpbmcuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG93LWNhcmRpbmFsaXR5IGFjdGl2aXR5IGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gKFQgfCBQcm9taXNlPFQ+KX0gY2FsbGJhY2sgLSBBY3Rpdml0eSBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcHJvZmlsZVRlc3RBY3Rpdml0eShuYW1lLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHZhbGlkYXRlZE5hbWUgPSB2YWxpZGF0ZVRlc3RBY3Rpdml0eU5hbWUobmFtZSlcblxuICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQoKVxuXG4gICAgaWYgKCFjb250ZXh0KSByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbnRleHQucHJvZmlsZXIucHJvZmlsZUFjdGl2aXR5KGNvbnRleHQsIHZhbGlkYXRlZE5hbWUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0aW1lWm9uZSAtIElBTkEgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoVGltZXpvbmUodGltZVpvbmUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBhYmlsaXR5IGZyb20gY29udGV4dC5cbiAgICovXG4gIGdldEN1cnJlbnRBYmlsaXR5KCkge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEN1cnJlbnRBYmlsaXR5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IHJlcXVlc3QgdGltaW5nIGNvbGxlY3Rvci5cbiAgICovXG4gIGdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKCkge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IHRlbmFudC5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEN1cnJlbnQgdGVuYW50IGZyb20gY29udGV4dC5cbiAgICovXG4gIGdldEN1cnJlbnRUZW5hbnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFRlbmFudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHRlbmFudCAtIFRlbmFudC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgdGVuYW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRlbmFudCByZXNvbHZlciBhcmdzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLnJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLnJlc3BvbnNlIC0gUmVzcG9uc2Ugb2JqZWN0LlxuICAgKiBAcGFyYW0ge3tjaGFubmVsOiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFthcmdzLnN1YnNjcmlwdGlvbl0gLSBTdWJzY3JpcHRpb24gbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyByZXNvbHZlVGVuYW50KHtwYXJhbXMsIHJlcXVlc3QsIHJlc3BvbnNlLCBzdWJzY3JpcHRpb259KSB7XG4gICAgY29uc3QgcmVzb2x2ZXIgPSB0aGlzLmdldFRlbmFudFJlc29sdmVyKClcblxuICAgIGlmICghcmVzb2x2ZXIpIHJldHVyblxuXG4gICAgcmV0dXJuIGF3YWl0IHJlc29sdmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICBwYXJhbXMsXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2UsXG4gICAgICBzdWJzY3JpcHRpb25cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVycm9yIGV2ZW50cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcImV2ZW50ZW1pdHRlcjNcIikuRXZlbnRFbWl0dGVyfSAtIEZyYW1ld29yayBlcnJvciBldmVudHMgZW1pdHRlci5cbiAgICovXG4gIGdldEVycm9yRXZlbnRzKCkge1xuICAgIHJldHVybiB0aGlzLl9lcnJvckV2ZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIHJlcG9ydGVyIHRoYXQgY2FuIGFkZCBjbGllbnQtc2FmZSBtZXRhZGF0YSB0byBmcm9udGVuZC1tb2RlbCBlcnJvciBwYXlsb2Fkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJUeXBlfSByZXBvcnRlciAtIFJlcG9ydGVyIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZENsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyKHJlcG9ydGVyKSB7XG4gICAgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzLnB1c2gocmVwb3J0ZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlcmVkIGNsaWVudCBlcnJvciBwYXlsb2FkIHJlcG9ydGVycy5cbiAgICogQHBhcmFtIHt7Y29udGV4dDogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZENvbnRleHQsIGVycm9yOiBFcnJvciwgcmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH19IGFyZ3MgLSBSZXBvcnRlciBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkPn0gLSBNZXJnZWQgY2xpZW50LXNhZmUgcmVwb3J0ZXIgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGNsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGFyZ3MpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IHRoaXMuZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlcXVlc3RUaW1pbmcgPyByZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpIDogbmV3IFNldCgpXG4gICAgY29uc3QgZGV0YWlscyA9IHJlcXVlc3REZXRhaWxzKGFyZ3MucmVxdWVzdCwge3JlZGFjdG9yOiB0aGlzLmdldExvZ1JlZGFjdG9yKCksIHNlbnNpdGl2ZVZhbHVlc30pXG5cbiAgICBmb3IgKGNvbnN0IHJlcG9ydGVyIG9mIHRoaXMuX2NsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVycykge1xuICAgICAgY29uc3QgcmVwb3J0ZXJQYXlsb2FkID0gYXdhaXQgcmVwb3J0ZXIoe1xuICAgICAgICAuLi5hcmdzLFxuICAgICAgICByZXF1ZXN0RGV0YWlsczogZGV0YWlsc1xuICAgICAgfSlcblxuICAgICAgaWYgKHJlcG9ydGVyUGF5bG9hZCAmJiB0eXBlb2YgcmVwb3J0ZXJQYXlsb2FkID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24ocGF5bG9hZCwgcmVwb3J0ZXJQYXlsb2FkKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgdGVzdCBhdHRlbXB0IGluIGEgcmV2b2NhYmxlIGRhdGFiYXNlLWFjY2VzcyBjb250ZXh0LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tyZXZva2VkOiBib29sZWFufX0gc2NvcGUgLSBBdHRlbXB0LW93bmVkIGFjY2VzcyBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBUIHwgUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBBdHRlbXB0IHdvcmsuXG4gICAqIEByZXR1cm5zIHtUIHwgUHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHNjb3BlLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3RlbnQgZnJhbWV3b3JrIHdvcmsgd2l0aG91dCBpbmhlcml0aW5nIGEgdGVzdCBhdHRlbXB0J3MgcmV2b2NhYmxlIGRhdGFiYXNlLWFjY2VzcyBzY29wZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUIHwgUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQZXJzaXN0ZW50IHdvcmsgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRob3V0Q3VycmVudFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aENhcHR1cmVkVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUodW5kZWZpbmVkLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKiBUaHJvd3Mgd2hlbiBhIHRpbWVkLW91dCB0ZXN0IGF0dGVtcHQgdHJpZXMgdG8gc3RhcnQgbW9yZSBkYXRhYmFzZSB3b3JrLiAqL1xuICBhc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKSB7XG4gICAgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5hc3NlcnRUZXN0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggY29ubmVjdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgfCBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aENvbm5lY3Rpb25zKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBjb25zdCB7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgbmFtZVxuICAgIH0gPSByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIFwiQ29uZmlndXJhdGlvbi53aXRoQ29ubmVjdGlvbnNcIilcblxuICAgIGlmICghYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2spIHRocm93IG5ldyBFcnJvcihcIndpdGhDb25uZWN0aW9ucyByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICAvKipcbiAgICAgKiBEYnMuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gKi9cbiAgICBjb25zdCBkYnMgPSB7fVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aERhdGFiYXNlSWRlbnRpZmllckNvbm5lY3Rpb25zKHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRicyxcbiAgICAgIGlkZW50aWZpZXJzOiBkYXRhYmFzZUlkZW50aWZpZXJzID8/IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpLFxuICAgICAgbmFtZSxcbiAgICAgIHN0YWNrTGFiZWw6IFwid2l0aENvbm5lY3Rpb25zXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhwbGljaXQgbW9kZWwgd29yayBpbiBhIHRyYW5zYWN0aW9uIHBpbm5lZCB0byBvbmUgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIG5hbWU/OiBzdHJpbmd9fSBvcHRpb25zIC0gT3BlcmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogRGF0YWJhc2VPcGVyYXRpb24pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoVHJhbnNhY3Rpb24oe2RhdGFiYXNlSWRlbnRpZmllciwgbmFtZSA9IFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb25cIiwgLi4ucmVzdEFyZ3N9LCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uIHJlcXVpcmVzIGEgZGF0YWJhc2VJZGVudGlmaWVyXCIpXG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcbiAgICBpZiAoIXRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpLmluY2x1ZGVzKGRhdGFiYXNlSWRlbnRpZmllcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvciBpbmFjdGl2ZSBkYXRhYmFzZSBpZGVudGlmaWVyOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpXG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50KVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoT3BlcmF0aW9uQ29ubmVjdGlvbih7bmFtZX0sIGFzeW5jIChjb25uZWN0aW9uLCBvd25lcikgPT4ge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gbmV3IERhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgICBjb25maWd1cmF0aW9uUmV1c2VLZXk6IHBvb2wuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKSxcbiAgICAgICAgY29ubmVjdGlvbixcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICBvd25lcixcbiAgICAgICAgdGVuYW50XG4gICAgICB9KVxuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgb3BlcmF0aW9uLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbilcbiAgICAgICAgfSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIG9wZXJhdGlvbi5jb21wbGV0ZSgpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cGxpY2l0IG1vZGVsIHdvcmsgb24gb25lIGNvbm5lY3Rpb24gc2VsZWN0ZWQgZnJvbSBhIGNhcHR1cmVkIHBoeXNpY2FsXG4gICAqIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uIE5vIGFtYmllbnQgdGVuYW50IHZhbHVlIGlzIHJlYWQgZHVyaW5nIGNoZWNrb3V0IG9yXG4gICAqIGV4ZWN1dGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZSwgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcsIHNjaGVtYUdlbmVyYXRpb24/OiBzdHJpbmcsIHRlbmFudD86IG9iamVjdH19IG9wdGlvbnMgLSBDYXB0dXJlZCBvcGVyYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHsob3BlcmF0aW9uOiBEYXRhYmFzZU9wZXJhdGlvbikgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhEYXRhYmFzZU9wZXJhdGlvbih7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIG5hbWUgPSBcIkNvbmZpZ3VyYXRpb24ud2l0aERhdGFiYXNlT3BlcmF0aW9uXCIsIHNjaGVtYUdlbmVyYXRpb24sIHRlbmFudCwgLi4ucmVzdEFyZ3N9LCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aERhdGFiYXNlT3BlcmF0aW9uIHJlcXVpcmVzIGEgZGF0YWJhc2VJZGVudGlmaWVyXCIpXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aERhdGFiYXNlT3BlcmF0aW9uIHJlcXVpcmVzIGEgZGF0YWJhc2VDb25maWd1cmF0aW9uXCIpXG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24ud2l0aERhdGFiYXNlT3BlcmF0aW9uIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgY29uZmlndXJhdGlvblJldXNlS2V5ID0gcG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuXG4gICAgcmV0dXJuIGF3YWl0IHBvb2wud2l0aENhcHR1cmVkT3BlcmF0aW9uQ29ubmVjdGlvbih7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCBuYW1lfSwgYXN5bmMgKGNvbm5lY3Rpb24sIG93bmVyKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICBjb25zdCBvcGVyYXRpb24gPSBuZXcgRGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGNvbmZpZ3VyYXRpb25SZXVzZUtleSxcbiAgICAgICAgY29ubmVjdGlvbixcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICBlbmZvcmNlQ3VycmVudFRlbmFudFJldXNlS2V5OiBmYWxzZSxcbiAgICAgICAgb3duZXIsXG4gICAgICAgIHNjaGVtYUdlbmVyYXRpb24sXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbilcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIG9wZXJhdGlvbi5jb21wbGV0ZSgpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbGxiYWNrIHdpdGggZGF0YWJhc2UgY29ubmVjdGlvbnMgZm9yIHRoZSByZXF1ZXN0ZWQgaWRlbnRpZmllcnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2NhbGxiYWNrOiBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD4sIGRiczogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD4sIGlkZW50aWZpZXJzOiBzdHJpbmdbXSwgbmFtZTogc3RyaW5nLCBzdGFja0xhYmVsOiBzdHJpbmd9fSBhcmdzIC0gQ29ubmVjdGlvbiBzY29wZSBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe2NhbGxiYWNrLCBkYnMsIGlkZW50aWZpZXJzLCBuYW1lLCBzdGFja0xhYmVsfSkge1xuICAgIGNvbnN0IHN0YWNrID0gRXJyb3IoKS5zdGFja1xuICAgIGNvbnN0IGFjdHVhbENhbGxiYWNrID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgcmV0dXJuIGF3YWl0IHdpdGhUcmFja2VkU3RhY2soc3RhY2sgfHwgc3RhY2tMYWJlbCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGJzKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW4gcmVxdWVzdC5cbiAgICAgKiBAdHlwZSB7KCkgPT4gUHJvbWlzZTxUPn0gKi9cbiAgICBsZXQgcnVuUmVxdWVzdCA9IGFjdHVhbENhbGxiYWNrXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgaWRlbnRpZmllcnMpIHtcbiAgICAgIGxldCBhY3R1YWxSdW5SZXF1ZXN0ID0gcnVuUmVxdWVzdFxuXG4gICAgICBjb25zdCBuZXh0UnVuUmVxdWVzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLndpdGhDb25uZWN0aW9uKHtuYW1lfSwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgICAgZGJzW2lkZW50aWZpZXJdID0gZGJcblxuICAgICAgICAgIHJldHVybiBhd2FpdCBhY3R1YWxSdW5SZXF1ZXN0KClcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcnVuUmVxdWVzdCA9IG5leHRSdW5SZXF1ZXN0XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blJlcXVlc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFtkYXRhYmFzZUlkZW50aWZpZXJzXSAtIERhdGFiYXNlIGlkZW50aWZpZXJzIHRvIGluY2x1ZGUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gQSBtYXAgb2YgZGF0YWJhc2UgY29ubmVjdGlvbnMgd2l0aCBpZGVudGlmaWVyIGFzIGtleVxuICAgKi9cbiAgZ2V0Q3VycmVudENvbm5lY3Rpb25zKGRhdGFiYXNlSWRlbnRpZmllcnMgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAvKipcbiAgICAgKiBEYnMuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gKi9cbiAgICBjb25zdCBkYnMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGRhdGFiYXNlSWRlbnRpZmllcnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuICAgICAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbiA9IHBvb2wuZ2V0Q3VycmVudENvbnRleHRDb25uZWN0aW9uID8gcG9vbC5nZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24oKSA6IHBvb2wuZ2V0Q3VycmVudENvbm5lY3Rpb24oKVxuXG4gICAgICAgIGlmIChjdXJyZW50Q29ubmVjdGlvbiAmJiAoIXBvb2wuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbiB8fCBwb29sLmNvbm5lY3Rpb25NYXRjaGVzQ3VycmVudENvbmZpZ3VyYXRpb24oY3VycmVudENvbm5lY3Rpb24pKSkge1xuICAgICAgICAgIGRic1tpZGVudGlmaWVyXSA9IGN1cnJlbnRDb25uZWN0aW9uXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICh0aGlzLmlzTWlzc2luZ0N1cnJlbnRDb25uZWN0aW9uRXJyb3IoZXJyb3IpKSB7XG4gICAgICAgICAgLy8gSWdub3JlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBkYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGhvdXQgY3VycmVudCBjb25uZWN0aW9uIGNvbnRleHRzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIHdpdGhvdXQgaW5oZXJpdGVkIERCIGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHdpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHRzKGNhbGxiYWNrKSB7XG4gICAgbGV0IHJ1bkNhbGxiYWNrID0gKCkgPT4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRob3V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVycyhjYWxsYmFjaylcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmICghcG9vbCkgY29udGludWVcbiAgICAgIGNvbnN0IHByZXZpb3VzUnVuQ2FsbGJhY2sgPSBydW5DYWxsYmFja1xuXG4gICAgICBydW5DYWxsYmFjayA9ICgpID0+IHBvb2wud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dChwcmV2aW91c1J1bkNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBydW5DYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluc2lkZSBldmVyeSBwb29sJ3MgdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBjb250ZXh0IChhIG5vLW9wIGZvclxuICAgKiBwb29scyB3aXRob3V0IG9uZSkuIEluLXByb2Nlc3MgcmVxdWVzdCBoYW5kbGluZyBpcyB3cmFwcGVkIGluIHRoaXMgc28gYSByZXF1ZXN0XG4gICAqIHJ1bnMgb24gdGhlIHNhbWUgY29ubmVjdGlvbiDigJQgYW5kIG9wZW4gdHJhbnNhY3Rpb24g4oCUIGFzIHRoZSB0ZXN0IHRoYXQgaXNzdWVkIGl0LFxuICAgKiBsZXR0aW5nIHJlcXVlc3Qgc3BlY3MgY2xlYW4gdXAgYnkgcm9sbGluZyBiYWNrIGluc3RlYWQgb2YgdHJ1bmNhdGluZy4gT3V0c2lkZVxuICAgKiB0ZXN0cyBubyBzaGFyZWQgY29ubmVjdGlvbiBpcyBzZXQsIHNvIHRoaXMganVzdCBydW5zIHRoZSBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biBpbnNpZGUgdGhlIHNoYXJlZCBjb25uZWN0aW9uIGNvbnRleHRzLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb25Db250ZXh0cyhjYWxsYmFjaykge1xuICAgIGxldCBydW5DYWxsYmFjayA9IGNhbGxiYWNrXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG4gICAgICBjb25zdCBwcmV2aW91c1J1bkNhbGxiYWNrID0gcnVuQ2FsbGJhY2tcblxuICAgICAgcnVuQ2FsbGJhY2sgPSAoKSA9PiBwb29sLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbihwcmV2aW91c1J1bkNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBydW5DYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBtaXNzaW5nIGN1cnJlbnQgY29ubmVjdGlvbiBlcnJvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBFcnJvciB0aHJvd24gd2hpbGUgbG9va2luZyB1cCB0aGUgY3VycmVudCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBlcnJvciBtZWFucyBubyBjdXJyZW50IGNvbm5lY3Rpb24gaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgaXNNaXNzaW5nQ3VycmVudENvbm5lY3Rpb25FcnJvcihlcnJvcikge1xuICAgIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIChcbiAgICAgIGVycm9yLm1lc3NhZ2UgPT0gXCJJRCBoYXNuJ3QgYmVlbiBzZXQgZm9yIHRoaXMgYXN5bmMgY29udGV4dFwiIHx8XG4gICAgICBlcnJvci5tZXNzYWdlID09IFwiQSBjb25uZWN0aW9uIGhhc24ndCBiZWVuIG1hZGUgeWV0XCIgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2Uuc3RhcnRzV2l0aChcIk5vIGFzeW5jIGNvbnRleHQgc2V0IGZvciBkYXRhYmFzZSBjb25uZWN0aW9uXCIpIHx8XG4gICAgICBlcnJvci5tZXNzYWdlLnN0YXJ0c1dpdGgoXCJDb25uZWN0aW9uIFwiKSAmJiBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKFwiZG9lc24ndCBleGlzdCBhbnkgbW9yZVwiKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBjb25uZWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDb25uZWN0aW9ucyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgY29uc3Qge1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIG5hbWVcbiAgICB9ID0gcmVzb2x2ZVdpdGhDb25uZWN0aW9uc0FyZ3Mob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrLCBcIkNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnNcIilcblxuICAgIGlmICghYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2spIHRocm93IG5ldyBFcnJvcihcImVuc3VyZUNvbm5lY3Rpb25zIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIGNvbnN0IHJlcXVlc3RlZElkZW50aWZpZXJzID0gZGF0YWJhc2VJZGVudGlmaWVycyA/PyB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKVxuICAgIGNvbnN0IGRicyA9IHRoaXMuZ2V0Q3VycmVudENvbm5lY3Rpb25zKHJlcXVlc3RlZElkZW50aWZpZXJzKVxuICAgIGNvbnN0IG1pc3NpbmdJZGVudGlmaWVycyA9IHJlcXVlc3RlZElkZW50aWZpZXJzLmZpbHRlcigoaWRlbnRpZmllcikgPT4ge1xuICAgICAgaWYgKCFkYnNbaWRlbnRpZmllcl0pIHJldHVybiB0cnVlXG5cbiAgICAgIHJldHVybiAhdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuaGFzQ3VycmVudENvbm5lY3Rpb25Db250ZXh0KClcbiAgICB9KVxuXG4gICAgaWYgKG1pc3NpbmdJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBhd2FpdCBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayhkYnMpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aERhdGFiYXNlSWRlbnRpZmllckNvbm5lY3Rpb25zKHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRicyxcbiAgICAgIGlkZW50aWZpZXJzOiBtaXNzaW5nSWRlbnRpZmllcnMsXG4gICAgICBuYW1lLFxuICAgICAgc3RhY2tMYWJlbDogXCJlbnN1cmVDb25uZWN0aW9uc1wiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBkZWRpY2F0ZWQgY29ubmVjdGlvbiB0aGF0IGN1cnJlbnRseSBob2xkcyBhbiBhZHZpc29yeSBsb2NrLCBzbyBhXG4gICAqIHNodXRkb3duIGNhbiBjbG9zZSBpdCBhbmQgcmVsZWFzZSB0aGUgbG9jay4gU2VlIGBfYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnNgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBUaGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlckFkdmlzb3J5TG9ja0Nvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zLmFkZChjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGEgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiBvbmNlIGl0cyBsb2NrIHNjb3BlIGVuZHMgYW5kIHRoZVxuICAgKiBjb25uZWN0aW9uIGhhcyBiZWVuIChvciBpcyBhYm91dCB0byBiZSkgY2xvc2VkIGJ5IGl0cyBvd25lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gVGhlIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgdW5yZWdpc3RlckFkdmlzb3J5TG9ja0Nvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBldmVyeSByZWdpc3RlcmVkIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb24sIGVuZGluZyBpdHMgc2Vzc2lvbiBzb1xuICAgKiB0aGUgREIgc2VydmVyIHJlbGVhc2VzIHRoZSBsb2NrLiBFdmVyeSBjb25uZWN0aW9uIGlzIGF0dGVtcHRlZCBiZWZvcmUgYW55IGZhaWx1cmVcbiAgICogaXMgc3VyZmFjZWQsIHNvIG9uZSBzdHVjayBjbG9zZSBkb2VzIG5vdCBsZWF2ZSB0aGUgb3RoZXJzJyBsb2NrcyBoZWxkOyBhIGZhaWx1cmUgaXNcbiAgICogdGhlbiB0aHJvd24gKG5ldmVyIHN3YWxsb3dlZCksIGFnZ3JlZ2F0ZWQgd2hlbiBtb3JlIHRoYW4gb25lIGNvbm5lY3Rpb24gZmFpbGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIGFsbCBoYXZlIGJlZW4gY2xvc2VkOyByZWplY3RzIGlmIGFueSBmYWlsZWQuXG4gICAqL1xuICBhc3luYyBfY2xvc2VBZHZpc29yeUxvY2tDb25uZWN0aW9ucygpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IFsuLi50aGlzLl9hZHZpc29yeUxvY2tDb25uZWN0aW9uc11cblxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zLmNsZWFyKClcblxuICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgY29ubmVjdGlvbnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBjbG9zZSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhY3RpdmUgZGF0YWJhc2UgY29ubmVjdGlvbnMgYW5kIGNsZWFycyBnbG9iYWwgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKSB7XG4gICAgaWYgKHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7U2V0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCBjb25zdHJ1Y3RvcnMgPSBuZXcgU2V0KClcblxuICAgIHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgICAgY29uc3QgY2xvc2VFcnJvcnMgPSBbXVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmNsb3NlQmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIC8vIENsb3NlIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zIGZpcnN0OiB0aGV5IGFyZSBzcGF3bmVkIG91dHNpZGUgdGhlXG4gICAgICAgICAgLy8gcG9vbHMnIHRyYWNrZWQgc2V0cywgc28gYHBvb2wuY2xvc2VBbGwoKWAgd291bGQgbm90IHJlYWNoIHRoZW0gYW5kIGEgbG9jayBoZWxkXG4gICAgICAgICAgLy8gYnkgYSBydW5uZXIgdG9ybiBkb3duIG1pZC1wYXNzIHdvdWxkIGxlYWsgdW50aWwgdGhlIERCIHNlcnZlcidzIGB3YWl0X3RpbWVvdXRgLlxuICAgICAgICAgIC8vIFN0aWxsIGNsb3NlIHRoZSBwb29scyBpZiB0aGlzIHRocm93cywgc28gYSBzdHVjayBsb2NrIGNvbm5lY3Rpb24gZG9lcyBub3RcbiAgICAgICAgICAvLyBsZWF2ZSB0aGUgcmVzdCBvZiB0aGUgY29ubmVjdGlvbnMgb3Blbi5cbiAgICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zKClcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICAgICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG5cbiAgICAgICAgICAgIGF3YWl0IHBvb2wuY2xvc2VBbGwoKVxuXG4gICAgICAgICAgICBjb25zdCBQb29sQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAqLyAocG9vbC5jb25zdHJ1Y3RvcilcbiAgICAgICAgICAgIGNvbnN0cnVjdG9ycy5hZGQoUG9vbENsYXNzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGZvciAoY29uc3QgUG9vbENsYXNzIG9mIGNvbnN0cnVjdG9ycykge1xuICAgICAgICAgICAgUG9vbENsYXNzLmNsZWFyR2xvYmFsQ29ubmVjdGlvbnModGhpcylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZS5yZXNldCgpXG5cbiAgICAgICAgICAvLyBBbGxvdyBmdWxsIHJlLWluaXRpYWxpemF0aW9uIGFmdGVyIGNvbm5lY3Rpb25zIGFyZSBjbG9zZWQuXG4gICAgICAgICAgdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gKz0gMVxuICAgICAgICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGNsb3NlRXJyb3JzWzBdXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGNsb3NlRXJyb3JzLCBcIkZhaWxlZCB0byBjbG9zZSBiYWNrZ3JvdW5kLWpvYnMgYW5kIGRhdGFiYXNlIHJlc291cmNlc1wiKVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgcmVxdWVzdCBhdXRob3JpemVkLlxuICAgKiBAcGFyYW0ge3toZWFkZXI6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9fSByZXF1ZXN0IC0gSW5jb21pbmcgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4cGVjdGVkVG9rZW4gLSBDb25maWd1cmVkIGRlYnVnLWVuZHBvaW50IHRva2VuLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0IGNhcnJpZXMgdGhlIGV4cGVjdGVkIGJlYXJlciB0b2tlbi5cbiAgICovXG4gIGRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCBleHBlY3RlZFRva2VuKSB7XG4gICAgY29uc3QgaGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJhdXRob3JpemF0aW9uXCIpXG5cbiAgICBpZiAodHlwZW9mIGhlYWRlciAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBtYXRjaCA9ICgvXkJlYXJlclxccysoLispJC9pKS5leGVjKGhlYWRlci50cmltKCkpXG5cbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmRlYnVnRW5kcG9pbnRUb2tlbk1hdGNoZXMobWF0Y2hbMV0sIGV4cGVjdGVkVG9rZW4pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXBpIG1hbmlmZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj59IC0gQVBJIG1hbmlmZXN0IGZvciBhbGwgcmVnaXN0ZXJlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBnZXRBcGlNYW5pZmVzdCgpIHtcbiAgICByZXR1cm4gZnJvbnRlbmRNb2RlbEFwaU1hbmlmZXN0KHRoaXMuX2JhY2tlbmRQcm9qZWN0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXRoZXIgQVBJIG1hbmlmZXN0IGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIEFQSSBtYW5pZmVzdCBlbmRwb2ludCBpcyBlbmFibGVkLlxuICAgKi9cbiAgX2FwaU1hbmlmZXN0RW5hYmxlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fYXBpTWFuaWZlc3QuZW5hYmxlZFxuICB9XG59XG4iXX0=