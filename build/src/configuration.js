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
     * Resolves request-body handling after the request line and headers are complete,
     * before body bytes are retained or decoded.
     * @param {import("./configuration-types.js").HttpRequestBodyPolicyResolverArgs} args - Parsed request head.
     * @returns {import("./configuration-types.js").ResolvedHttpRequestBodyPolicy} - Effective request policy.
     */
    resolveHttpRequestBodyPolicy(args) {
        const resolver = this.httpServer.requestBodyPolicyResolver;
        const configuredPolicy = resolver ? resolver(args) : undefined;
        if (configuredPolicy === undefined) {
            return { maxRequestBodyBytes: this.httpServer.maxRequestBodyBytes, mode: "parsed" };
        }
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
        return {
            maxRequestBodyBytes: maxRequestBodyBytes === undefined
                ? this.httpServer.maxRequestBodyBytes
                : optionalPositiveSafeInteger(maxRequestBodyBytes, "httpServer.requestBodyPolicyResolver maxRequestBodyBytes"),
            mode
        };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFBYSxNQUFNLDRCQUE0QixDQUFBO0FBQ3RELE9BQU8sRUFBRSx3QkFBd0IsRUFB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QUFNLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQTtRQUM3QyxDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsZ0NBQWdDLEdBQUcsSUFBSSxDQUFBO1FBQzlDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCw4QkFBOEIsQ0FBQyxPQUFPLEVBQUUsYUFBYTtRQUNuRCxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLGVBQWUsQ0FBQyxDQUFBO1FBRTlDLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTVDLE1BQU0sS0FBSyxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUE7UUFFdEQsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUV4QixPQUFPLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLHlCQUF5QixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxhQUFhLENBQUMsQ0FBQTtJQUN4RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGNBQWM7UUFDbEIsT0FBTyx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtJQUN4RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsbUJBQW1CO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUE7SUFDbEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlIHR5cGUuXG4gKiBAdGVtcGxhdGUgVFxuICogQHR5cGVkZWYgeyhhcmc6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+KSA9PiBQcm9taXNlPFQ+fSBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gV2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFtkYXRhYmFzZUlkZW50aWZpZXJzXSAtIERhdGFiYXNlIGlkZW50aWZpZXJzIHRvIGluY2x1ZGUgaW4gdGhlIGNvbm5lY3Rpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNoZWNrZWQtb3V0IGRhdGFiYXNlIGNvbm5lY3Rpb25zLlxuICovXG4vKipcbiAqIE9uZSBhZGFwdGVyIGluc3RhbmNlIGFuZCBpdHMgc2VyaWFsaXplZCByZWFkeS9jbG9zZSBsaWZlY3ljbGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXIuanNcIikuZGVmYXVsdH0gYWRhcHRlciAtIEFkYXB0ZXIgb3duZWQgYnkgdGhpcyBnZW5lcmF0aW9uLlxuICogQHByb3BlcnR5IHtib29sZWFufSBjbG9zaW5nIC0gV2hldGhlciBjbG9zZSBoYXMgY2xhaW1lZCB0aGlzIGdlbmVyYXRpb24uXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IHJlYWR5UHJvbWlzZSAtIFNoYXJlZCByZWFkaW5lc3MgYXR0ZW1wdC5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gY2xvc2VQcm9taXNlIC0gU2hhcmVkIGNsb3NlIG9wZXJhdGlvbi5cbiAqL1xuXG5pbXBvcnQgeyBkaWdnIH0gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgZ2V0dGV4dENvbmZpZyBmcm9tIFwiZ2V0dGV4dC11bml2ZXJzYWwvYnVpbGQvc3JjL2NvbmZpZy5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCB0cmFuc2xhdGUgZnJvbSBcImdldHRleHQtdW5pdmVyc2FsL2J1aWxkL3NyYy90cmFuc2xhdGUuanNcIlxuaW1wb3J0IEFiaWxpdHkgZnJvbSBcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXIuanNcIlxuaW1wb3J0IERhdGFiYXNlT3BlcmF0aW9uIGZyb20gXCIuL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiXG5pbXBvcnQgeyBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyB9IGZyb20gXCIuL2RhdGFiYXNlL3JlY29yZC9hdWRpdGluZy5qc1wiXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyBmcm9tIFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpYmVycy5qc1wiXG5pbXBvcnQgeyBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yLCBjdXJyZW50Q29uZmlndXJhdGlvbiwgc2V0Q3VycmVudENvbmZpZ3VyYXRpb24gfSBmcm9tIFwiLi9jdXJyZW50LWNvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IHsgcmVxdWVzdERldGFpbHMgfSBmcm9tIFwiLi9lcnJvci1yZXBvcnRpbmcvcmVxdWVzdC1kZXRhaWxzLmpzXCJcbmltcG9ydCBMb2dSZWRhY3RvciBmcm9tIFwiLi9sb2ctcmVkYWN0b3IuanNcIlxuaW1wb3J0IHsgZnJvbnRlbmRNb2RlbEFwaU1hbmlmZXN0LCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24sIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdCB9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7IGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5LCBub3JtYWxpemVPZmZsaW5lR3JhbnRTaWduaW5nS2V5IH0gZnJvbSBcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCJcbmltcG9ydCBQbHVnaW5Sb3V0ZXMgZnJvbSBcIi4vcm91dGVzL3BsdWdpbi1yb3V0ZXMuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZSB9IGZyb20gXCIuL3Rlc3RpbmcvdGVzdC1wcm9maWxlLWFjdGl2aXR5LmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGltZVpvbmUgfSBmcm9tIFwiLi90aW1lLXpvbmUuanNcIlxuaW1wb3J0IHsgd2l0aFRyYWNrZWRTdGFjayB9IGZyb20gXCIuL3V0aWxzL3dpdGgtdHJhY2tlZC1zdGFjay5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzUGFja2FnZSBmcm9tIFwiLi9wYWNrYWdlcy92ZWxvY2lvdXMtcGFja2FnZS5qc1wiXG5pbXBvcnQgRnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgZnJvbSBcIi4vdGVuYW50cy9mcm9udGVuZC10ZW5hbnQtc3FsaXRlLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgeyByZXNvbHZlR2VuZXJhdGlvbklkLCByZXNvbHZlSW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgcmVzb2x2ZUxpZmVjeWNsZVNvY2tldFBhdGggfSBmcm9tIFwiLi9iYWNrZ3JvdW5kLWpvYnMvZ2VuZXJhdGlvbi1pZGVudGl0eS5qc1wiXG5pbXBvcnQgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcblxuZXhwb3J0IHsgQ3VycmVudENvbmZpZ3VyYXRpb25Ob3RTZXRFcnJvciB9XG5cbi8qKlxuICogUnVucyBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5LlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5IHdoZW4gdGhlIHJ1bnRpbWUgZXhwb3NlcyBvbmUuXG4gKi9cbmZ1bmN0aW9uIGN1cnJlbnRXb3JraW5nRGlyZWN0b3J5KCkge1xuICBjb25zdCBwcm9jZXNzT2JqZWN0ID0gLyoqIEB0eXBlIHt7Y3dkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHwgdW5kZWZpbmVkfSAqLyAoZ2xvYmFsVGhpcy5wcm9jZXNzKVxuXG4gIGlmICh0eXBlb2YgcHJvY2Vzc09iamVjdD8uY3dkICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiB1bmRlZmluZWRcblxuICByZXR1cm4gcHJvY2Vzc09iamVjdC5jd2QoKVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBvdmVybG9hZGVkIHdpdGgvZW5zdXJlIGNvbm5lY3Rpb25zIGFyZ3VtZW50cy5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiB8IHVuZGVmaW5lZH0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkZWZhdWx0TmFtZSAtIERlZmF1bHQgY2hlY2tvdXQgbmFtZS5cbiAqIEByZXR1cm5zIHt7ZGF0YWJhc2VJZGVudGlmaWVyczogc3RyaW5nW10gfCB1bmRlZmluZWQsIG5hbWU6IHN0cmluZywgY2FsbGJhY2s6IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiB8IHVuZGVmaW5lZH19IFJlc29sdmVkIGNoZWNrb3V0IG9wdGlvbnMgYW5kIGNhbGxiYWNrLlxuICovXG5mdW5jdGlvbiByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIGRlZmF1bHROYW1lKSB7XG4gIGlmICh0eXBlb2Ygb3B0aW9uc09yQ2FsbGJhY2sgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgY29uc3QgYWN0dWFsQ2FsbGJhY2sgPSAvKiogQHR5cGUge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gKi8gKG9wdGlvbnNPckNhbGxiYWNrKVxuXG4gICAgcmV0dXJuIHtkYXRhYmFzZUlkZW50aWZpZXJzOiB1bmRlZmluZWQsIG5hbWU6IGRlZmF1bHROYW1lLCBjYWxsYmFjazogYWN0dWFsQ2FsbGJhY2t9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRhdGFiYXNlSWRlbnRpZmllcnM6IG9wdGlvbnNPckNhbGxiYWNrLmRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgbmFtZTogb3B0aW9uc09yQ2FsbGJhY2submFtZSB8fCBkZWZhdWx0TmFtZSxcbiAgICBjYWxsYmFja1xuICB9XG59XG5cbi8qKlxuICogUnVucyBjYW5vbmljYWwgZGVidWcgc25hcHNob3QgdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNuYXBzaG90IHZhbHVlIHRvIGNhbm9uaWNhbGl6ZS5cbiAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gU25hcHNob3QgdmFsdWUgd2l0aCBvYmplY3Qga2V5cyBzb3J0ZWQgcmVjdXJzaXZlbHkuXG4gKi9cbmZ1bmN0aW9uIGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZSh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHZhbHVlXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLm1hcCgoZW50cnkpID0+IGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZShlbnRyeSkpXG5cbiAgcmV0dXJuIE9iamVjdC5rZXlzKHZhbHVlKS5zb3J0KCkucmVkdWNlKChyZXN1bHQsIGtleSkgPT4ge1xuICAgIHJlc3VsdFtrZXldID0gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpW2tleV0pXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9LCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHt9KSlcbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBCYXNlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlIHwgUGFydGlhbDxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZT4gfCB2b2lkfSBvdmVycmlkZUNvbmZpZ3VyYXRpb24gLSBUZW5hbnQgb3ZlcnJpZGUgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gLSBNZXJnZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbWVyZ2VEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCBvdmVycmlkZUNvbmZpZ3VyYXRpb24pIHtcbiAgaWYgKCFvdmVycmlkZUNvbmZpZ3VyYXRpb24pIHJldHVybiBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cblxuICByZXR1cm4ge1xuICAgIC4uLmRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAuLi5vdmVycmlkZUNvbmZpZ3VyYXRpb24sXG4gICAgcmVjb3JkOiB7XG4gICAgICAuLi4oZGF0YWJhc2VDb25maWd1cmF0aW9uLnJlY29yZCB8fCB7fSksXG4gICAgICAuLi4ob3ZlcnJpZGVDb25maWd1cmF0aW9uLnJlY29yZCB8fCB7fSlcbiAgICB9LFxuICAgIHNxbENvbmZpZzoge1xuICAgICAgLi4uKGRhdGFiYXNlQ29uZmlndXJhdGlvbi5zcWxDb25maWcgfHwge30pLFxuICAgICAgLi4uKG92ZXJyaWRlQ29uZmlndXJhdGlvbi5zcWxDb25maWcgfHwge30pXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGdyYWNlIHdpbmRvdyAobXMpIGJlZm9yZSBhIHN1c3RhaW5lZCBiZWFjb24gb3V0YWdlIGlzIHJlcG9ydGVkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIGB1bnJlYWNoYWJsZVJlcG9ydE1zYCwgaWYgYW55LlxuICogQHJldHVybnMge251bWJlcn0gLSBUaGUgY29uZmlndXJlZCB2YWx1ZSB3aGVuIGl0J3MgYSBmaW5pdGUgbnVtYmVyLCBvdGhlcndpc2UgdGhlIDMwcyBkZWZhdWx0LlxuICovXG5mdW5jdGlvbiByZXNvbHZlQmVhY29uVW5yZWFjaGFibGVSZXBvcnRNcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gIHJldHVybiAzMF8wMDBcbn1cblxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19CWVRFUyA9IDE2ICogMTAyNCAqIDEwMjRcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfTUVTU0FHRVMgPSAyNTZcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0JZVEVTID0gMTYgKiAxMDI0ICogMTAyNFxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfRlJBTUVTID0gMjU2XG5cbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xEID0gMTAyNFxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSA9IDRcbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTCA9IDZcblxuLyoqXG4gKiBWYWxpZGF0ZXMgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXIgY29uZmlndXJhdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBwb3NpdGl2ZSBzYWZlIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbmZpZ3VyYXRpb24ga2V5LlxuICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRWYWx1ZSAtIERlZmF1bHQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkYXRlZCBjb25maWd1cmVkIG9yIGRlZmF1bHQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlU2FmZUludGVnZXIodmFsdWUsIG5hbWUsIGRlZmF1bHRWYWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGRlZmF1bHRWYWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlcmApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW4gb3B0aW9uYWwgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG9wdGlvbmFsUG9zaXRpdmVTYWZlSW50ZWdlcih2YWx1ZSwgbmFtZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZFxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlcmApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW4gaW50ZWdlciBjb25maWd1cmF0aW9uIHZhbHVlIGluc2lkZSBhbiBpbmNsdXNpdmUgcmFuZ2UuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29uZmlndXJhdGlvbiBrZXkuXG4gKiBAcGFyYW0ge251bWJlcn0gbWluIC0gTWluaW11bSBhY2NlcHRlZCB2YWx1ZSAoaW5jbHVzaXZlKS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtYXggLSBNYXhpbXVtIGFjY2VwdGVkIHZhbHVlIChpbmNsdXNpdmUpLlxuICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRWYWx1ZSAtIERlZmF1bHQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkYXRlZCBjb25maWd1cmVkIG9yIGRlZmF1bHQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGludGVnZXJJblJhbmdlKHZhbHVlLCBuYW1lLCBtaW4sIG1heCwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgbWluIHx8IHZhbHVlID4gbWF4KSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgJHtuYW1lfSBtdXN0IGJlIGFuIGludGVnZXIgYmV0d2VlbiAke21pbn0gYW5kICR7bWF4fWApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHRoZSBidWZmZXJlZCBIVFRQIHJlc3BvbnNlIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uIENvbXByZXNzaW9uIGlzXG4gKiBlbmFibGVkIGJ5IGRlZmF1bHQgd2hlbiB0aGUgc2V0dGluZyBpcyBhYnNlbnQ7IGBmYWxzZWAgb3IgYHtlbmFibGVkOiBmYWxzZX1gXG4gKiBkaXNhYmxlcyBpdCBnbG9iYWxseS5cbiAqIEBwYXJhbSB7Ym9vbGVhbiB8IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5IdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENvbmZpZ3VyZWQgY29tcHJlc3Npb24gdmFsdWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplSHR0cENvbXByZXNzaW9uKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSB0cnVlKSB7XG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCB0aHJlc2hvbGQ6IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xELCBicm90bGlRdWFsaXR5OiBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZLCBnemlwTGV2ZWw6IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTH1cbiAgfVxuXG4gIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCB0aHJlc2hvbGQ6IERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xELCBicm90bGlRdWFsaXR5OiBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZLCBnemlwTGV2ZWw6IERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTH1cbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uIG11c3QgYmUgYSBib29sZWFuIG9yIGFuIG9iamVjdCwgZ290OiAke1N0cmluZyh2YWx1ZSl9YClcbiAgfVxuXG4gIGNvbnN0IHticm90bGlRdWFsaXR5LCBlbmFibGVkLCBnemlwTGV2ZWwsIHRocmVzaG9sZCwgLi4ucmVzdENvbXByZXNzaW9ufSA9IHZhbHVlXG4gIGNvbnN0IHJlc3RDb21wcmVzc2lvbktleXMgPSBPYmplY3Qua2V5cyhyZXN0Q29tcHJlc3Npb24pXG5cbiAgaWYgKHJlc3RDb21wcmVzc2lvbktleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24gcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RDb21wcmVzc2lvbktleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBicm90bGlRdWFsaXR5LCBlbmFibGVkLCBnemlwTGV2ZWwsIHRocmVzaG9sZClgKVxuICB9XG5cbiAgaWYgKGVuYWJsZWQgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZW5hYmxlZCAhPT0gXCJib29sZWFuXCIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uLmVuYWJsZWQgbXVzdCBiZSBhIGJvb2xlYW4sIGdvdDogJHtTdHJpbmcoZW5hYmxlZCl9YClcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogZW5hYmxlZCA/PyB0cnVlLFxuICAgIHRocmVzaG9sZDogcG9zaXRpdmVTYWZlSW50ZWdlcih0aHJlc2hvbGQsIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi50aHJlc2hvbGRcIiwgREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQpLFxuICAgIGJyb3RsaVF1YWxpdHk6IGludGVnZXJJblJhbmdlKGJyb3RsaVF1YWxpdHksIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi5icm90bGlRdWFsaXR5XCIsIDAsIDExLCBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZKSxcbiAgICBnemlwTGV2ZWw6IGludGVnZXJJblJhbmdlKGd6aXBMZXZlbCwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLmd6aXBMZXZlbFwiLCAwLCA5LCBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUwpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ29uZmlndXJhdGlvbiB7XG4gIC8qKlxuICAgKiBDbG9zZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBwcm9taXNlLlxuICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gIF9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlID0gbnVsbFxuXG4gIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgY3VycmVudGx5IGhvbGRpbmcgYSBsb2NrLiBUaGVzZSBhcmUgc3Bhd25lZFxuICAgKiBvdXRzaWRlIHRoZSBwb29scycgdHJhY2tlZCBzZXRzIChzbyBhIGhvbGQtdGltZW91dCBsb2NrIHN1cnZpdmVzIHBvb2wgY2hlY2tvdXRzKSxcbiAgICogc28gYGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc2Agd291bGQgb3RoZXJ3aXNlIHdhbGsgcGFzdCB0aGVtOyB0cmFja2luZyB0aGVtIGhlcmVcbiAgICogbGV0cyBhIHNodXRkb3duIGNsb3NlIHRoZW0gYW5kIHJlbGVhc2UgdGhlIGxvY2sgaW5zdGVhZCBvZiBvcnBoYW5pbmcgaXQuXG4gICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gIF9hZHZpc29yeUxvY2tDb25uZWN0aW9ucyA9IG5ldyBTZXQoKVxuXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgX3NjaGVtYUNhY2hlR2VuZXJhdGlvbnNCeVJldXNlS2V5ID0gbmV3IE1hcCgpXG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0NvbmZpZ3VyYXRpb259IC0gVGhlIGN1cnJlbnQuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudCgpIHtcbiAgICByZXR1cm4gY3VycmVudENvbmZpZ3VyYXRpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNvbmZpZ3VyYXRpb25BcmdzVHlwZX0gYXJncyAtIENvbmZpZ3VyYXRpb24gYXJndW1lbnRzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FiaWxpdHlSZXNvbHZlciwgYWJpbGl0eVJlc291cmNlcywgYXR0YWNobWVudHMsIGF1dG9sb2FkID0gdHJ1ZSwgYmFja2dyb3VuZEpvYnMsIGJhY2tlbmRQcm9qZWN0cywgYmVhY29uLCBjb29raWVTZWNyZXQsIGNvcnMsIGRhdGFiYXNlLCBkZWJ1ZyA9IGZhbHNlLCBkZWJ1Z0VuZHBvaW50ID0gZmFsc2UsIGFwaU1hbmlmZXN0ID0gZmFsc2UsIGRpcmVjdG9yeSwgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gdHJ1ZSwgZW52aXJvbm1lbnQsIGVudmlyb25tZW50SGFuZGxlciwgZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMsIGZyb250ZW5kVGVuYW50U3FsaXRlLCBodHRwU2VydmVyLCBpbml0aWFsaXplTW9kZWxzLCBpbml0aWFsaXplcnMsIGxvY2FsZSwgbG9jYWxlRmFsbGJhY2tzLCBsb2NhbGVzLCBsb2dnaW5nLCBtYWlsZXJCYWNrZW5kLCBwYWNrYWdlcywgcmVxdWVzdFRpbWVvdXRNcywgcm91dGVSZXNvbHZlckhvb2tzLCBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icywgc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycywgc3RydWN0dXJlU3FsLCBzeW5jLCB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycywgdGVuYW50RGF0YWJhc2VSZXNvbHZlciwgdGVuYW50UmVzb2x2ZXIsIHRlc3RpbmcsIHRpbWVab25lLCB0aW1lem9uZU9mZnNldE1pbnV0ZXMsIHRydXN0ZWRQcm94aWVzLCB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIsIHdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgPSBhYmlsaXR5UmVzb2x2ZXJcbiAgICB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gYWJpbGl0eVJlc291cmNlcyB8fCBbXVxuICAgIHRoaXMuX2F1dG9sb2FkID0gYXV0b2xvYWRcbiAgICB0aGlzLl9iYWNrZ3JvdW5kSm9icyA9IGJhY2tncm91bmRKb2JzXG4gICAgdGhpcy5fYmVhY29uID0gYmVhY29uXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gY2xpZW50IHZhbHVlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gY29ubmVjdCBwcm9taXNlIHZhbHVlLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiByZXBvcnQgdGltZXIgdmFsdWUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAtIFBlbmRpbmcgXCJiZWFjb24gc3RpbGwgdW5yZWFjaGFibGVcIiByZXBvcnQgdGltZXIuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBvdXRhZ2UgcmVwb3J0ZWQgdmFsdWUuXG4gICAgICogQHR5cGUge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY3VycmVudCBiZWFjb24gb3V0YWdlIGhhcyBhbHJlYWR5IGJlZW4gcmVwb3J0ZWQuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGxhc3QgZG93biBlcnJvciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e3N0YWdlOiBcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCIsIGVycm9yOiBFcnJvcn0gfCB1bmRlZmluZWR9IC0gTGF0ZXN0IGJlYWNvbi1kb3duIGRldGFpbHMsIHJlcG9ydGVkIG9ubHkgaWYgdGhlIG91dGFnZSBpcyBzdXN0YWluZWQuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID0gc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNcbiAgICB0aGlzLl9hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzIHx8IHt9XG4gICAgLy8gQ29weSBzbyBhcHBlbmRpbmcgcGFja2FnZS1kZXJpdmVkIGVudHJpZXMgYmVsb3cgbmV2ZXIgbXV0YXRlcyBhIGNhbGxlcidzXG4gICAgLy8gc2hhcmVkIGFycmF5IChjb25maWcgbW9kdWxlcyBjb21tb25seSBleHBvcnQgYSByZXVzZWQgYmFja2VuZFByb2plY3RzIGFycmF5KS5cbiAgICB0aGlzLl9iYWNrZW5kUHJvamVjdHMgPSBiYWNrZW5kUHJvamVjdHMgPyBbLi4uYmFja2VuZFByb2plY3RzXSA6IFtdXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJUeXBlW119ICovXG4gICAgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzID0gW11cbiAgICB0aGlzLmNvcnMgPSBjb3JzXG4gICAgdGhpcy5fY29va2llU2VjcmV0ID0gY29va2llU2VjcmV0XG4gICAgdGhpcy5kYXRhYmFzZSA9IGRhdGFiYXNlXG4gICAgdGhpcy5kZWJ1ZyA9IGRlYnVnXG4gICAgdGhpcy5fZGVidWdFbmRwb2ludCA9IHRoaXMuX25vcm1hbGl6ZURlYnVnRW5kcG9pbnQoZGVidWdFbmRwb2ludClcbiAgICB0aGlzLl9hcGlNYW5pZmVzdCA9IHRoaXMuX25vcm1hbGl6ZUFwaU1hbmlmZXN0KGFwaU1hbmlmZXN0KVxuICAgIHRoaXMuX2Vudmlyb25tZW50ID0gZW52aXJvbm1lbnQgfHwgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0VOViB8fCBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5OT0RFX0VOViB8fCBcImRldmVsb3BtZW50XCJcbiAgICB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIgPSBlbnZpcm9ubWVudEhhbmRsZXJcbiAgICB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXNcbiAgICB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9IGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzID09PSB1bmRlZmluZWRcbiAgICAgID8gc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycyAhPT0gdHJ1ZVxuICAgICAgOiBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50c1xuICAgIHRoaXMuX2RpcmVjdG9yeSA9IGRpcmVjdG9yeVxuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHMgPSBpbml0aWFsaXplTW9kZWxzXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNQYWNrYWdlW119ICovXG4gICAgdGhpcy5fcGFja2FnZXMgPSAocGFja2FnZXMgfHwgW10pLm1hcCgoZW50cnkpID0+IFZlbG9jaW91c1BhY2thZ2UuZnJvbShlbnRyeSkpXG5cbiAgICAvLyBBcHBlbmQgYSBkZXJpdmVkIGJhY2tlbmQtcHJvamVjdCBwZXIgcGFja2FnZSBzbyB0aGUgZXhpc3RpbmcgcmVzb3VyY2VcbiAgICAvLyBkaXNjb3ZlcnkgKyBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uIG1hY2hpbmVyeSBpbmNsdWRlcyBpdC4gUGFja2FnZVxuICAgIC8vIGZyb250ZW5kIG1vZGVscyBhcmUgZ2VuZXJhdGVkIGludG8gdGhlIGFwcCdzIGZyb250ZW5kLW1vZGVscyBvdXRwdXQuXG4gICAgY29uc3QgYXBwRnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoID0gdGhpcy5fYmFja2VuZFByb2plY3RzWzBdPy5mcm9udGVuZE1vZGVsc091dHB1dFBhdGhcblxuICAgIGZvciAoY29uc3QgdmVsb2Npb3VzUGFja2FnZSBvZiB0aGlzLl9wYWNrYWdlcykge1xuICAgICAgdGhpcy5fYmFja2VuZFByb2plY3RzLnB1c2godmVsb2Npb3VzUGFja2FnZS50b0JhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbih7ZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoOiBhcHBGcm9udGVuZE1vZGVsc091dHB1dFBhdGh9KSlcbiAgICB9XG5cbiAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vaW5pdGlhbGl6ZXIuanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIEludmFsaWRhdGVzIG1vZGVsIHBoYXNlcyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGNsb3NlZC5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID0gMFxuICAgIC8qKlxuICAgICAqIEluLXByb2dyZXNzIGBpbml0aWFsaXplTW9kZWxzKClgIHByb21pc2UuIE1vZGVsIGluaXRpYWxpemF0aW9uIGlzIGFuXG4gICAgICogYXRvbWljIGJvb3RzdHJhcCBwaGFzZTogY29uY3VycmVudCBjYWxsZXJzIHNoYXJlIGl0LCBhbmQgYSByZWplY3Rpb25cbiAgICAgKiBsZWF2ZXMgdGhlIHBoYXNlIGVsaWdpYmxlIGZvciBhIGxhdGVyIGNvbXBsZXRlIGF0dGVtcHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGBpbml0aWFsaXplKClgIHByb21pc2UsIG1lbW9pemVkIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGVcbiAgICAgKiBzYW1lIGJvb3RzdHJhcC4gUmV0YWluZWQgYWNyb3NzIGEgY29ubmVjdGlvbiBjbG9zZSB1bnRpbCBzdGFsZSBib290c3RyYXBcbiAgICAgKiB3b3JrIHNldHRsZXMsIHRoZW4gY2xlYXJlZCBieSBpZGVudGl0eSBiZWZvcmUgdGhlIG5ldyBnZW5lcmF0aW9uIHJldHJpZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICBjb25zdCByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyID0gaHR0cFNlcnZlcj8ucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlclxuICAgIGNvbnN0IHdlYnNvY2tldEluYm91bmRRdWV1ZSA9IGh0dHBTZXJ2ZXI/LndlYnNvY2tldEluYm91bmRRdWV1ZVxuICAgIGNvbnN0IHdlYnNvY2tldE91dGJvdW5kUXVldWUgPSBodHRwU2VydmVyPy53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlXG5cbiAgICBpZiAocmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5odHRwU2VydmVyID0ge1xuICAgICAgLi4uKGh0dHBTZXJ2ZXIgfHwge30pLFxuICAgICAgY29tcHJlc3Npb246IG5vcm1hbGl6ZUh0dHBDb21wcmVzc2lvbihodHRwU2VydmVyPy5jb21wcmVzc2lvbiksXG4gICAgICBtYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzOiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIoaHR0cFNlcnZlcj8ubWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlcywgXCJodHRwU2VydmVyLm1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXNcIiksXG4gICAgICBtYXhSZXF1ZXN0Qm9keUJ5dGVzOiBvcHRpb25hbFBvc2l0aXZlU2FmZUludGVnZXIoaHR0cFNlcnZlcj8ubWF4UmVxdWVzdEJvZHlCeXRlcywgXCJodHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXNcIiksXG4gICAgICByZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyLFxuICAgICAgd2Vic29ja2V0SW5ib3VuZFF1ZXVlOiB7XG4gICAgICAgIG1heFBlbmRpbmdCeXRlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRJbmJvdW5kUXVldWU/Lm1heFBlbmRpbmdCeXRlcywgXCJodHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZS5tYXhQZW5kaW5nQnl0ZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19CWVRFUyksXG4gICAgICAgIG1heFBlbmRpbmdNZXNzYWdlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRJbmJvdW5kUXVldWU/Lm1heFBlbmRpbmdNZXNzYWdlcywgXCJodHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZS5tYXhQZW5kaW5nTWVzc2FnZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19NRVNTQUdFUylcbiAgICAgIH0sXG4gICAgICB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlOiB7XG4gICAgICAgIG1heFBlbmRpbmdCeXRlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlPy5tYXhQZW5kaW5nQnl0ZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlLm1heFBlbmRpbmdCeXRlc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19CWVRFUyksXG4gICAgICAgIG1heFBlbmRpbmdGcmFtZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0T3V0Ym91bmRRdWV1ZT8ubWF4UGVuZGluZ0ZyYW1lcywgXCJodHRwU2VydmVyLndlYnNvY2tldE91dGJvdW5kUXVldWUubWF4UGVuZGluZ0ZyYW1lc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19GUkFNRVMpXG4gICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgaHR0cCBzZXJ2ZXIgaW5zdGFuY2UgdmFsdWUuXG4gICAgICogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90OiAoKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9jYWxlID0gbG9jYWxlXG4gICAgdGhpcy5sb2NhbGVGYWxsYmFja3MgPSBsb2NhbGVGYWxsYmFja3NcbiAgICB0aGlzLmxvY2FsZXMgPSBsb2NhbGVzXG4gICAgdGhpcy5faW5pdGlhbGl6ZXJzID0gaW5pdGlhbGl6ZXJzXG4gICAgdGhpcy5fdGVzdGluZyA9IHRlc3RpbmdcbiAgICB0aGlzLl90aW1lWm9uZSA9IHRpbWVab25lXG4gICAgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID0gdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgdGhpcy5fdHJ1c3RlZFByb3hpZXMgPSB0cnVzdGVkUHJveGllc1xuICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPSByZXF1ZXN0VGltZW91dE1zXG4gICAgdGhpcy5fc3RydWN0dXJlU3FsID0gc3RydWN0dXJlU3FsXG4gICAgdGhpcy5fc3luYyA9IHRoaXMuX25vcm1hbGl6ZVN5bmNDb25maWd1cmF0aW9uKHN5bmMpXG4gICAgdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgPSB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycyB8fCB7fVxuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIgPSB0ZW5hbnREYXRhYmFzZVJlc29sdmVyXG4gICAgdGhpcy5fdGVuYW50UmVzb2x2ZXIgPSB0ZW5hbnRSZXNvbHZlclxuICAgIHRoaXMuX3dlYnNvY2tldEV2ZW50cyA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaWJlcnMgdmFsdWUuXG4gICAgICogQHR5cGUge1ZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIgPSB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIENoYW5uZWwgdHlwZXMgcmVnaXN0ZXJlZCB3aXRoIGB7bGl2ZU9ubHk6IHRydWV9YDogdGhlaXIgdHJhZmZpYyBpc1xuICAgICAqIG5ldmVyIHBlcnNpc3RlZCBmb3IgcmVwbGF5LCBhbmQgYG1hcmtDaGFubmVsSW50ZXJlc3RlZGAgcmVqZWN0cyB0aGVcbiAgICAgKiBuYW1lLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICB0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmlwdGlvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIFNldDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQ+Pn0gLSBjaGFubmVsVHlwZSDihpIgbGl2ZSBzdWJzY3JpcHRpb25zIGFjcm9zcyBhbGwgc2Vzc2lvbnMuXG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBsb2NhbCAocGVyLXByb2Nlc3MpIHdlYnNvY2tldCBjaGFubmVsIGJyb2FkY2FzdCBkZWxpdmVyaWVzLFxuICAgICAqIGxhdW5jaGVkIGZpcmUtYW5kLWZvcmdldCBmcm9tIGBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWxgIHNvIG9uZSBzbG93XG4gICAgICogc3Vic2NyaWJlciBuZXZlciBibG9ja3MgYW5vdGhlci4gVHJhY2tlZCBoZXJlIHNvXG4gICAgICogYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGNhbiBzbmFwc2hvdCBhbmQgZHJhaW4gdGhlbSBiZWZvcmUgc2V0dGxpbmcuXG4gICAgICogU2V0dGxlZCBkZWxpdmVyaWVzIGFyZSByZW1vdmVkIGJ5IHRoZSB0cmFja2luZy1sZXZlbCBjbGVhbnVwLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBMYXRlc3QgbG9jYWwgYnJvYWRjYXN0IGRlbGl2ZXJ5IHBlciBzdWJzY3JpcHRpb24uIENoYWluaW5nIHN1YnNlcXVlbnRcbiAgICAgKiBkZWxpdmVyaWVzIHByZXNlcnZlcyBsaWZlY3ljbGUgZXZlbnQgb3JkZXIgd2l0aG91dCBjb3VwbGluZyBzZXBhcmF0ZVxuICAgICAqIHN1YnNjcmliZXJzIHRvIG9uZSBhbm90aGVyLlxuICAgICAqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdCwgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzID0gbmV3IFdlYWtNYXAoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgc2Vzc2lvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0Pn0gLSBMaXZlIHdlYnNvY2tldCBzZXNzaW9ucywgaW5jbHVkaW5nIHBhdXNlZCBzZXNzaW9ucyB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdy5cbiAgICAgKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9ucyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBwYXVzZWQgd2Vic29ja2V0IHNlc3Npb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7c2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgZ3JhY2VUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4sIHBhdXNlZEF0OiBudW1iZXJ9Pn0gLSBzZXNzaW9uSWQg4oaSIHBhdXNlZCBzZXNzaW9uIGF3YWl0aW5nIHJlc3VtZS5cbiAgICAgKi9cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqIEdyYWNlIHBlcmlvZCBmb3IgcGF1c2VkIFdlYlNvY2tldCBzZXNzaW9ucyBiZWZvcmUgcGVybWFuZW50IHRlYXJkb3duLiAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgPSAzMDBcblxuICAgIC8qKiBJbnRlcnZhbCAoc2Vjb25kcykgYmV0d2VlbiBzZXJ2ZXLihpJjbGllbnQgaGVhcnRiZWF0IHBpbmdzOyAwIGRpc2FibGVzIHJlYXBpbmcgb2Ygc2lsZW50IHNvY2tldHMuICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgPSAzMFxuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgd3JhcHBlciBjYWxsZWQgYXJvdW5kIGV2ZXJ5IFdlYlNvY2tldC1ib3JuZSByZXF1ZXN0IC9cbiAgICAgKiBjb25uZWN0aW9uIG1lc3NhZ2UgLyBjaGFubmVsIGRpc3BhdGNoLiBBcHBzIHJlZ2lzdGVyIGl0IGhlcmVcbiAgICAgKiB0byBzZXQgdXAgcGVyLXJlcXVlc3QgY29udGV4dCAoZS5nLiBBc3luY0xvY2FsU3RvcmFnZSBmb3JcbiAgICAgKiBsb2NhbGUsIHRlbmFudCwgdHJhY2luZykgdGhhdCBkb3duc3RyZWFtIGhhbmRsZXJzIHJlYWQuXG4gICAgICogQHR5cGUgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfVxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3QgPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGFyb3VuZCBhY3Rpb24gdmFsdWUuXG4gICAgICogQHR5cGUgeygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAqL1xuICAgIHRoaXMuX2Fyb3VuZEFjdGlvbiA9IG51bGxcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IHNlc3Npb24gaWRlbnRpdHkgcmVzb2x2ZXIgdmFsdWUuXG4gICAgICogQHR5cGUgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyID0gbnVsbFxuICAgIHRoaXMuX2xvZ2dpbmcgPSBsb2dnaW5nXG4gICAgdGhpcy5fbG9nUmVkYWN0b3IgPSBuZXcgTG9nUmVkYWN0b3Ioe3NlbnNpdGl2ZU5hbWVzOiBsb2dnaW5nPy5zZW5zaXRpdmVOYW1lc30pXG4gICAgdGhpcy5fbWFpbGVyQmFja2VuZCA9IG1haWxlckJhY2tlbmRcbiAgICB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MgPSBbLi4uKHJvdXRlUmVzb2x2ZXJIb29rcyB8fCBbXSldXG4gICAgdGhpcy5fYWRkRGVidWdFbmRwb2ludFJvdXRlSG9vaygpXG4gICAgdGhpcy5fYWRkQXBpTWFuaWZlc3RSb3V0ZUhvb2soKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBhcHBsaWVkIHJvdXRlIG1vdW50cyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7V2Vha1NldDxvYmplY3Q+fSAqL1xuICAgIHRoaXMuX2FwcGxpZWRSb3V0ZU1vdW50cyA9IG5ldyBXZWFrU2V0KClcbiAgICB0aGlzLl9lcnJvckV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBkYXRhYmFzZSBwb29scyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIHRoaXMuZGF0YWJhc2VQb29scyA9IHt9XG4gICAgdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUgPSBuZXcgRnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoe2NvbmZpZ3VyYXRpb246IHRoaXMsIG1heE9wZW5IYW5kbGVzOiBmcm9udGVuZFRlbmFudFNxbGl0ZT8ubWF4T3BlbkhhbmRsZXN9KVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBtb2RlbCBjbGFzc2VzIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIHRoaXMubW9kZWxDbGFzc2VzID0ge31cblxuICAgIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuc2V0Q29uZmlndXJhdGlvbih0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF1dG9sb2FkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBvbiBsYXp5IGFjY2VzcyBpcyBlbmFibGVkIGdsb2JhbGx5LlxuICAgKi9cbiAgZ2V0QXV0b2xvYWQoKSB7IHJldHVybiB0aGlzLl9hdXRvbG9hZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4cG9zZSBpbnRlcm5hbCBlcnJvcnMgdG8gY2xpZW50cy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdW5leHBlY3RlZCBpbnRlcm5hbCBlcnJvciBkZXRhaWxzIG1heSBiZSByZXR1cm5lZCB0byBBUEkgY2xpZW50cy5cbiAgICovXG4gIGdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCkgeyByZXR1cm4gdGhpcy5fZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgPT09IHRydWUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgZXJyb3JzIGV4cG9zZSBvbmx5IGV4cGxpY2l0bHkgc2FmZSBtZXNzYWdlcy5cbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBnZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgaW50ZXJuYWwgZXJyb3IgZXhwb3N1cmUgaXMgZGlzYWJsZWQuXG4gICAqL1xuICBnZXRTZWN1cmVGcm9udGVuZE1vZGVsRXJyb3JzKCkgeyByZXR1cm4gIXRoaXMuZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlYnVnIGVuZHBvaW50LlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXREZWJ1Z0VuZHBvaW50KCkgeyByZXR1cm4gdGhpcy5fZGVidWdFbmRwb2ludCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbkNvbmZpZ3VyZWQ6IGJvb2xlYW59fSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZyBmb3IgdGhlIHNuYXBzaG90LCB3aXRoIHRoZSB0b2tlbiByZWRhY3RlZC5cbiAgICovXG4gIF9kZWJ1Z0VuZHBvaW50U25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IHRoaXMuX2RlYnVnRW5kcG9pbnQuZW5hYmxlZCxcbiAgICAgIHBhdGg6IHRoaXMuX2RlYnVnRW5kcG9pbnQucGF0aCxcbiAgICAgIHRva2VuQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkZWJ1ZyBlbmRwb2ludC5cbiAgICogQHBhcmFtIHtib29sZWFuIHwge3BhdGg/OiBzdHJpbmcsIHRva2VuPzogc3RyaW5nfX0gdmFsdWUgLSBEZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIE5vcm1hbGl6ZWQgZGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVEZWJ1Z0VuZHBvaW50KHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCBwYXRoOiBcIi92ZWxvY2lvdXMvZGVidWdcIiwgdG9rZW46IG51bGx9XG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiLCB0b2tlbjogbnVsbH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZGVidWdFbmRwb2ludCB0byBiZSBhIGJvb2xlYW4gb3Igb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSB2YWx1ZS5wYXRoIHx8IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiXG5cbiAgICBpZiAodHlwZW9mIHBhdGggIT09IFwic3RyaW5nXCIgfHwgIXBhdGguc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZGVidWdFbmRwb2ludC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50LnRva2VuIHRvIGJlIGEgbm9uLWVtcHR5IHN0cmluZywgZ290OiAke1N0cmluZyh0b2tlbil9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGgsIHRva2VuOiB0b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB0b2tlbi50cmltKCl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgYXBpIG1hbmlmZXN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIEFQSSBtYW5pZmVzdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW46IHN0cmluZyB8IG51bGx9fSAtIE5vcm1hbGl6ZWQgQVBJIG1hbmlmZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplQXBpTWFuaWZlc3QodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL2FwaS9tYW5pZmVzdFwiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvYXBpL21hbmlmZXN0XCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdCB0byBiZSBhIGJvb2xlYW4gb3Igb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSB2YWx1ZS5wYXRoIHx8IFwiL2FwaS9tYW5pZmVzdFwiXG5cbiAgICBpZiAodHlwZW9mIHBhdGggIT09IFwic3RyaW5nXCIgfHwgIXBhdGguc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXBpTWFuaWZlc3QucGF0aCB0byBiZSBhIHN0cmluZyBzdGFydGluZyB3aXRoICcvJywgZ290OiAke1N0cmluZyhwYXRoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gdmFsdWUudG9rZW4gPT09IHVuZGVmaW5lZCB8fCB2YWx1ZS50b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB2YWx1ZS50b2tlblxuXG4gICAgaWYgKHRva2VuICE9PSBudWxsICYmICh0eXBlb2YgdG9rZW4gIT09IFwic3RyaW5nXCIgfHwgIXRva2VuLnRyaW0oKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXBpTWFuaWZlc3QudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBhcGkgbWFuaWZlc3Qgcm91dGUgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FkZEFwaU1hbmlmZXN0Um91dGVIb29rKCkge1xuICAgIGlmICghdGhpcy5fYXBpTWFuaWZlc3QuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiR0VUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX2FwaU1hbmlmZXN0LnBhdGgpIHJldHVybiBudWxsXG5cbiAgICAgIGlmICh0aGlzLl9hcGlNYW5pZmVzdC50b2tlbiAmJiAhdGhpcy5kZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgdGhpcy5fYXBpTWFuaWZlc3QudG9rZW4pKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3Rpb246IFwic2hvd1wiLFxuICAgICAgICBjb250cm9sbGVyOiBcInZlbG9jaW91c0FwaU1hbmlmZXN0XCIsXG4gICAgICAgIGNvbnRyb2xsZXJQYXRoOiBcIi4vYnVpbHQtaW4vYXBpLW1hbmlmZXN0L2NvbnRyb2xsZXIuanNcIixcbiAgICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uczogdHJ1ZSxcbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9hcGktbWFuaWZlc3RcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgZGVidWcgZW5kcG9pbnQgcm91dGUgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FkZERlYnVnRW5kcG9pbnRSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9kZWJ1Z0VuZHBvaW50LmVuYWJsZWQpIHJldHVyblxuXG4gICAgdGhpcy5hZGRSb3V0ZVJlc29sdmVySG9vaygoe2N1cnJlbnRQYXRoLCByZXF1ZXN0fSkgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QuaHR0cE1ldGhvZCgpICE9PSBcIkdFVFwiKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKGN1cnJlbnRQYXRoICE9PSB0aGlzLl9kZWJ1Z0VuZHBvaW50LnBhdGgpIHJldHVybiBudWxsXG5cbiAgICAgIC8vIFdoZW4gYSB0b2tlbiBpcyBjb25maWd1cmVkLCBhbiB1bmF1dGhlbnRpY2F0ZWQgcmVxdWVzdCBnZXRzIG5vIHJvdXRlIGF0XG4gICAgICAvLyBhbGwgKDQwNCkgcmF0aGVyIHRoYW4gYSA0MDEsIHNvIHRoZSBlbmRwb2ludCdzIGV4aXN0ZW5jZSBzdGF5cyBoaWRkZW4uXG4gICAgICBpZiAodGhpcy5fZGVidWdFbmRwb2ludC50b2tlbiAmJiAhdGhpcy5kZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgdGhpcy5fZGVidWdFbmRwb2ludC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJzaG93XCIsXG4gICAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzRGVidWdcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9kZWJ1Zy9jb250cm9sbGVyLmpzXCIsXG4gICAgICAgIHNraXBDb250cm9sbGVyQ29ubmVjdGlvbnM6IHRydWUsXG4gICAgICAgIHNraXBBYmlsaXR5UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgc2tpcFRlbmFudFJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHZpZXdQYXRoOiBcIi4vYnVpbHQtaW4vZGVidWdcIlxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXV0b2xvYWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3VmFsdWUgLSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QXV0b2xvYWQobmV3VmFsdWUpIHsgdGhpcy5fYXV0b2xvYWQgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ29yc1R5cGUgfCB1bmRlZmluZWR9IC0gVGhlIGNvcnMuXG4gICAqL1xuICBnZXRDb3JzKCkge1xuICAgIHJldHVybiB0aGlzLmNvcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBodHRwIHNlcnZlciBjb21wcmVzc2lvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIGJ1ZmZlcmVkIHJlc3BvbnNlIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRIdHRwU2VydmVyQ29tcHJlc3Npb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5jb21wcmVzc2lvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1heGltdW0gYnVmZmVyZWQgcmVzcG9uc2UgYm9keSBieXRlcy5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGJ5dGUgbGltaXQsIG9yIHVuZGVmaW5lZCB3aGVuIHVuYm91bmRlZC5cbiAgICovXG4gIGdldEh0dHBTZXJ2ZXJNYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzKCkge1xuICAgIHJldHVybiB0aGlzLmh0dHBTZXJ2ZXIubWF4QnVmZmVyZWRSZXNwb25zZUJvZHlCeXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1heGltdW0gcmVxdWVzdCBib2R5IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgYnl0ZSBsaW1pdCwgb3IgdW5kZWZpbmVkIHdoZW4gdW5ib3VuZGVkLlxuICAgKi9cbiAgZ2V0SHR0cFNlcnZlck1heFJlcXVlc3RCb2R5Qnl0ZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgcmVxdWVzdC1ib2R5IGhhbmRsaW5nIGFmdGVyIHRoZSByZXF1ZXN0IGxpbmUgYW5kIGhlYWRlcnMgYXJlIGNvbXBsZXRlLFxuICAgKiBiZWZvcmUgYm9keSBieXRlcyBhcmUgcmV0YWluZWQgb3IgZGVjb2RlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cFJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXJBcmdzfSBhcmdzIC0gUGFyc2VkIHJlcXVlc3QgaGVhZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeX0gLSBFZmZlY3RpdmUgcmVxdWVzdCBwb2xpY3kuXG4gICAqL1xuICByZXNvbHZlSHR0cFJlcXVlc3RCb2R5UG9saWN5KGFyZ3MpIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyXG4gICAgY29uc3QgY29uZmlndXJlZFBvbGljeSA9IHJlc29sdmVyID8gcmVzb2x2ZXIoYXJncykgOiB1bmRlZmluZWRcblxuICAgIGlmIChjb25maWd1cmVkUG9saWN5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiB7bWF4UmVxdWVzdEJvZHlCeXRlczogdGhpcy5odHRwU2VydmVyLm1heFJlcXVlc3RCb2R5Qnl0ZXMsIG1vZGU6IFwicGFyc2VkXCJ9XG4gICAgfVxuXG4gICAgaWYgKCFjb25maWd1cmVkUG9saWN5IHx8IHR5cGVvZiBjb25maWd1cmVkUG9saWN5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY29uZmlndXJlZFBvbGljeSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJodHRwU2VydmVyLnJlcXVlc3RCb2R5UG9saWN5UmVzb2x2ZXIgbXVzdCByZXR1cm4gYW4gb2JqZWN0IG9yIHVuZGVmaW5lZFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHttYXhSZXF1ZXN0Qm9keUJ5dGVzLCBtb2RlID0gXCJwYXJzZWRcIiwgLi4ucmVzdFBvbGljeX0gPSBjb25maWd1cmVkUG9saWN5XG4gICAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhyZXN0UG9saWN5KVxuXG4gICAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciByZXR1cm5lZCB1bmtub3duIGtleXM6ICR7dW5rbm93bktleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBtYXhSZXF1ZXN0Qm9keUJ5dGVzLCBtb2RlKWApXG4gICAgfVxuICAgIGlmIChtb2RlICE9PSBcInBhcnNlZFwiICYmIG1vZGUgIT09IFwicmF3XCIpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIucmVxdWVzdEJvZHlQb2xpY3lSZXNvbHZlciBtb2RlIG11c3QgYmUgXCJwYXJzZWRcIiBvciBcInJhd1wiLCBnb3Q6ICR7U3RyaW5nKG1vZGUpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1heFJlcXVlc3RCb2R5Qnl0ZXM6IG1heFJlcXVlc3RCb2R5Qnl0ZXMgPT09IHVuZGVmaW5lZFxuICAgICAgICA/IHRoaXMuaHR0cFNlcnZlci5tYXhSZXF1ZXN0Qm9keUJ5dGVzXG4gICAgICAgIDogb3B0aW9uYWxQb3NpdGl2ZVNhZmVJbnRlZ2VyKG1heFJlcXVlc3RCb2R5Qnl0ZXMsIFwiaHR0cFNlcnZlci5yZXF1ZXN0Qm9keVBvbGljeVJlc29sdmVyIG1heFJlcXVlc3RCb2R5Qnl0ZXNcIiksXG4gICAgICBtb2RlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvb2tpZSBzZWNyZXQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29va2llIHNlY3JldC5cbiAgICovXG4gIGdldENvb2tpZVNlY3JldCgpIHtcbiAgICByZXR1cm4gdGhpcy5fY29va2llU2VjcmV0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9ufSAtIFN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldFN5bmNDb25maWd1cmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9zeW5jXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IG9mZmxpbmUgZ3JhbnQgc2lnbmluZyBrZXkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5PZmZsaW5lR3JhbnRTaWduaW5nS2V5fSAtIEN1cnJlbnQgc2lnbmluZyBrZXkuXG4gICAqL1xuICBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleSgpIHtcbiAgICBjb25zdCBzaWduaW5nS2V5cyA9IHRoaXMuZ2V0U3luY0NvbmZpZ3VyYXRpb24oKS5vZmZsaW5lR3JhbnRTaWduaW5nS2V5c1xuXG4gICAgcmV0dXJuIGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5KHNpZ25pbmdLZXlzKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gc3luYyAtIFN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ29uZmlndXJhdGlvbihzeW5jKSB7XG4gICAgY29uc3QgYXBpID0gc3luYz8uYXBpXG4gICAgY29uc3QgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5ID0gc3luYz8uZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5IHx8IG51bGxcbiAgICBjb25zdCBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSA9IHN5bmM/LmNoYW5nZUZlZWRSZXRlbnRpb25TaXplXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50U2lnbmluZ0tleXMgPSBzeW5jPy5vZmZsaW5lR3JhbnRTaWduaW5nS2V5cyB8fCBbXVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudFR0bE1zID0gc3luYz8ub2ZmbGluZUdyYW50VHRsTXNcblxuICAgIGlmIChkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgIT09IG51bGwgJiYgKHR5cGVvZiBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgbXVzdCBiZSBhIHB1YmxpYyBKU09OIFdlYiBLZXkgb2JqZWN0XCIpXG4gICAgfVxuICAgIGlmIChjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSkgfHwgY2hhbmdlRmVlZFJldGVudGlvblNpemUgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2hhbmdlRmVlZFJldGVudGlvblNpemUgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJcIilcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzKSkgdGhyb3cgbmV3IEVycm9yKFwic3luYy5vZmZsaW5lR3JhbnRTaWduaW5nS2V5cyBtdXN0IGJlIGFuIGFycmF5XCIpXG4gICAgaWYgKG9mZmxpbmVHcmFudFR0bE1zICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKG9mZmxpbmVHcmFudFR0bE1zKSB8fCBvZmZsaW5lR3JhbnRUdGxNcyA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5vZmZsaW5lR3JhbnRUdGxNcyBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlciBudW1iZXIgb2YgbWlsbGlzZWNvbmRzXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFwaTogdGhpcy5fbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSxcbiAgICAgIGNoYW5nZUZlZWRSZXRlbnRpb25TaXplOiBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSB8fCAxMDAwMCxcbiAgICAgIGNsaWVudDogdGhpcy5fbm9ybWFsaXplU3luY0NsaWVudENvbmZpZ3VyYXRpb24oc3luYz8uY2xpZW50KSxcbiAgICAgIGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSxcbiAgICAgIG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzOiBvZmZsaW5lR3JhbnRTaWduaW5nS2V5cy5tYXAoKGtleSkgPT4gbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleShrZXkpKSxcbiAgICAgIG9mZmxpbmVHcmFudFR0bE1zOiBvZmZsaW5lR3JhbnRUdGxNcyB8fCAyNCAqIDYwICogNjAgKiAxMDAwXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgY2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uIGNvbnN1bWVkIGJ5IGBTeW5jQ2xpZW50LmZyb21Db25maWd1cmF0aW9uKC4uLilgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gY2xpZW50IC0gQ2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgY2xpZW50LXNpZGUgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNDbGllbnRDb25maWd1cmF0aW9uKGNsaWVudCkge1xuICAgIGlmIChjbGllbnQgPT09IHVuZGVmaW5lZCB8fCBjbGllbnQgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGlmICh0eXBlb2YgY2xpZW50ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY2xpZW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCB0cmFuc3BvcnQgYW5kIGF1dGhlbnRpY2F0aW9uVG9rZW5cIilcbiAgICB9XG5cbiAgICBjb25zdCB7YXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBpc09ubGluZSwgbW91bnRQYXRoLCBvbkVycm9yLCByZWFsdGltZSwgdHJhbnNwb3J0LCB3ZWJzb2NrZXRDbGllbnQsIHdlYnNvY2tldFVybCwgLi4ucmVzdENsaWVudH0gPSBjbGllbnRcbiAgICBjb25zdCByZXN0Q2xpZW50S2V5cyA9IE9iamVjdC5rZXlzKHJlc3RDbGllbnQpXG5cbiAgICBpZiAocmVzdENsaWVudEtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudCByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7cmVzdENsaWVudEtleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBhdXRoZW50aWNhdGlvblRva2VuLCBiYXRjaFNpemUsIGlzT25saW5lLCBtb3VudFBhdGgsIG9uRXJyb3IsIHJlYWx0aW1lLCB0cmFuc3BvcnQsIHdlYnNvY2tldENsaWVudCwgd2Vic29ja2V0VXJsKWApXG4gICAgfVxuICAgIGlmICghdHJhbnNwb3J0IHx8IHR5cGVvZiB0cmFuc3BvcnQgIT09IFwib2JqZWN0XCIgfHwgdHlwZW9mIHRyYW5zcG9ydC5wb3N0ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LnRyYW5zcG9ydCBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGEgcG9zdChwYXRoLCBib2R5KSBtZXRob2QgKGxpa2UgdGhlIGZyb250ZW5kLW1vZGVsIHdlYnNvY2tldCBjbGllbnQpXCIpXG4gICAgfVxuICAgIGlmICh0eXBlb2YgYXV0aGVudGljYXRpb25Ub2tlbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5hdXRoZW50aWNhdGlvblRva2VuIG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgdGhlIGF1dGggdG9rZW4gc2VudCB3aXRoIHN5bmMgcmVxdWVzdHNcIilcbiAgICB9XG4gICAgaWYgKGlzT25saW5lICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGlzT25saW5lICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LmlzT25saW5lIG11c3QgYmUgYSBmdW5jdGlvbiByZXNvbHZpbmcgY29ubmVjdGl2aXR5XCIpXG4gICAgfVxuICAgIGlmIChvbkVycm9yICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9uRXJyb3IgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub25FcnJvciBtdXN0IGJlIGEgZnVuY3Rpb24gcmVwb3J0aW5nIGJhY2tncm91bmQgc3luYyBmYWlsdXJlc1wiKVxuICAgIH1cbiAgICBpZiAoYmF0Y2hTaXplICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKGJhdGNoU2l6ZSkgfHwgYmF0Y2hTaXplIDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5iYXRjaFNpemUgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJcIilcbiAgICB9XG4gICAgaWYgKG1vdW50UGF0aCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgbW91bnRQYXRoICE9PSBcInN0cmluZ1wiIHx8ICFtb3VudFBhdGguc3RhcnRzV2l0aChcIi9cIikpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50Lm1vdW50UGF0aCBtdXN0IHN0YXJ0IHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKG1vdW50UGF0aCl9YClcbiAgICB9XG4gICAgaWYgKHdlYnNvY2tldENsaWVudCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2Ygd2Vic29ja2V0Q2xpZW50ICE9PSBcIm9iamVjdFwiIHx8IHdlYnNvY2tldENsaWVudCA9PT0gbnVsbCB8fCB0eXBlb2Ygd2Vic29ja2V0Q2xpZW50LnN1YnNjcmliZUNoYW5uZWwgIT09IFwiZnVuY3Rpb25cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LndlYnNvY2tldENsaWVudCBtdXN0IGJlIGEgd2Vic29ja2V0IGNsaWVudCB3aXRoIGEgc3Vic2NyaWJlQ2hhbm5lbCBtZXRob2QgKGxpa2UgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KVwiKVxuICAgIH1cbiAgICBpZiAod2Vic29ja2V0VXJsICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHdlYnNvY2tldFVybCAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2Ygd2Vic29ja2V0VXJsICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQud2Vic29ja2V0VXJsIG11c3QgYmUgYSBVUkwgc3RyaW5nIG9yIGEgZnVuY3Rpb24gcmVzb2x2aW5nIG9uZSwgZ290OiAke1N0cmluZyh3ZWJzb2NrZXRVcmwpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBiYXRjaFNpemUsXG4gICAgICBpc09ubGluZSxcbiAgICAgIG1vdW50UGF0aDogKG1vdW50UGF0aCB8fCBcIi92ZWxvY2lvdXMvc3luY1wiKS5yZXBsYWNlKC9cXC8rJC91LCBcIlwiKSB8fCBcIi9cIixcbiAgICAgIG9uRXJyb3IsXG4gICAgICByZWFsdGltZSxcbiAgICAgIHRyYW5zcG9ydCxcbiAgICAgIHdlYnNvY2tldENsaWVudCxcbiAgICAgIHdlYnNvY2tldFVybFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHN5bmMgQVBJIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNBcGlDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBhcGkgLSBTeW5jIEFQSSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNBcGlDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgc3luYyBBUEkgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQXBpQ29uZmlndXJhdGlvbihhcGkpIHtcbiAgICBpZiAoYXBpID09PSB1bmRlZmluZWQgfHwgYXBpID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIGFwaSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGFwaSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuYXBpIG11c3QgYmUgYW4gb2JqZWN0IHdpdGggYSByZXNvdXJjZUNsYXNzXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge21vdW50UGF0aCwgcmVzb3VyY2VDbGFzc30gPSBhcGlcblxuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuYXBpLnJlc291cmNlQ2xhc3MgbXVzdCBiZSBhIHJlc291cmNlIGNsYXNzLCBnb3Q6ICR7U3RyaW5nKHJlc291cmNlQ2xhc3MpfWApXG4gICAgfVxuICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuYXBpLnJlc291cmNlQ2xhc3MgJHtyZXNvdXJjZUNsYXNzLm5hbWV9IG11c3QgZGVmaW5lIHN0YXRpYyBNb2RlbENsYXNzYClcbiAgICB9XG4gICAgaWYgKG1vdW50UGF0aCAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgbW91bnRQYXRoICE9PSBcInN0cmluZ1wiIHx8ICFtb3VudFBhdGguc3RhcnRzV2l0aChcIi9cIikpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuYXBpLm1vdW50UGF0aCBtdXN0IHN0YXJ0IHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKG1vdW50UGF0aCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge21vdW50UGF0aCwgcmVzb3VyY2VDbGFzc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGU+fSAtIFRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5kYXRhYmFzZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YWJhc2UgY29uZmlndXJhdGlvblwiKVxuXG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlW3RoaXMuZ2V0RW52aXJvbm1lbnQoKV0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgZW52aXJvbm1lbnQ6ICR7dGhpcy5nZXRFbnZpcm9ubWVudCgpfSAtICR7T2JqZWN0LmtleXModGhpcy5kYXRhYmFzZSkuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpZ2codGhpcywgXCJkYXRhYmFzZVwiLCB0aGlzLmdldEVudmlyb25tZW50KCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW3RlbmFudF0gLSBUZW5hbnQgb3ZlcnJpZGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gLSBSZXNvbHZlZCBkYXRhYmFzZSBjb25maWd1cmF0aW9uIGZvciB0aGUgaWRlbnRpZmllci5cbiAgICovXG4gIHJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oaWRlbnRpZmllciwgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KCkpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIGRhdGFiYXNlIGlkZW50aWZpZXIgY29uZmlndXJlZDogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgaWYgKHRlbmFudCA9PT0gdW5kZWZpbmVkIHx8ICF0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyKSB7XG4gICAgICByZXR1cm4gZGF0YWJhc2VDb25maWd1cmF0aW9uXG4gICAgfVxuXG4gICAgY29uc3Qgb3ZlcnJpZGVDb25maWd1cmF0aW9uID0gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgaWRlbnRpZmllcixcbiAgICAgIHRlbmFudFxuICAgIH0pXG5cbiAgICByZXR1cm4gbWVyZ2VEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCBvdmVycmlkZUNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGlzYWJsZWQgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBEaXNhYmxlZCBkYXRhYmFzZSBpZGVudGlmaWVycyBmcm9tIGVudiBmbGFncy5cbiAgICovXG4gIGdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpIHtcbiAgICBjb25zdCBkaXNhYmxlZElkZW50aWZpZXJzID0gbmV3IFNldCgpXG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVyc1JhdyA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19ESVNBQkxFRF9EQVRBQkFTRV9JREVOVElGSUVSU1xuXG4gICAgaWYgKGRpc2FibGVkSWRlbnRpZmllcnNSYXcpIHtcbiAgICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBkaXNhYmxlZElkZW50aWZpZXJzUmF3LnNwbGl0KFwiLFwiKSkge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gaWRlbnRpZmllci50cmltKClcblxuICAgICAgICBpZiAodHJpbW1lZCkgZGlzYWJsZWRJZGVudGlmaWVycy5hZGQodHJpbW1lZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RJU0FCTEVfTVNTUUwgPT09IFwiMVwiKSB7XG4gICAgICBkaXNhYmxlZElkZW50aWZpZXJzLmFkZChcIm1zc3FsXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpc2FibGVkSWRlbnRpZmllcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGRhdGFiYXNlIGlkZW50aWZpZXIgYWN0aXZlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgZGF0YWJhc2UgaWRlbnRpZmllciBpcyBhY3RpdmUgaW4gdGhlIGN1cnJlbnQgdGVuYW50IGNvbnRleHQuXG4gICAqL1xuICBpc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyLCB0ZW5hbnQgPSB0aGlzLmdldEN1cnJlbnRUZW5hbnQoKSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKClbaWRlbnRpZmllcl1cblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggZGF0YWJhc2UgaWRlbnRpZmllciBjb25maWd1cmVkOiAke2lkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi50ZW5hbnRPbmx5KSByZXR1cm4gdHJ1ZVxuICAgIGlmICh0ZW5hbnQgPT09IHVuZGVmaW5lZCB8fCAhdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBvdmVycmlkZUNvbmZpZ3VyYXRpb24gPSB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICBpZGVudGlmaWVyLFxuICAgICAgdGVuYW50XG4gICAgfSlcblxuICAgIHJldHVybiBCb29sZWFuKG92ZXJyaWRlQ29uZmlndXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpIHtcbiAgICBjb25zdCBpZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKHRoaXMuZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKCkpXG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVycyA9IHRoaXMuZ2V0RGlzYWJsZWREYXRhYmFzZUlkZW50aWZpZXJzKClcblxuICAgIHJldHVybiBpZGVudGlmaWVycy5maWx0ZXIoKGlkZW50aWZpZXIpID0+ICFkaXNhYmxlZElkZW50aWZpZXJzLmhhcyhpZGVudGlmaWVyKSAmJiB0aGlzLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEh1bWFuLXJlYWRhYmxlIHNlcnZlciBkaWFnbm9zdGljcy5cbiAgICovXG4gIGFzeW5jIGdldERlYnVnU25hcHNob3QoKSB7XG4gICAgY29uc3QgbG9jYWxTbmFwc2hvdCA9IHRoaXMuZ2V0TG9jYWxEZWJ1Z1NuYXBzaG90KClcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5sb2NhbFNuYXBzaG90LFxuICAgICAgaHR0cFNlcnZlcjogYXdhaXQgdGhpcy5fZGVidWdIdHRwU2VydmVyU25hcHNob3QoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBIdW1hbi1yZWFkYWJsZSBkaWFnbm9zdGljcyBmb3IgdGhpcyBwcm9jZXNzIG9ubHkuXG4gICAqL1xuICBnZXRMb2NhbERlYnVnU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tncm91bmRKb2JzOiB0aGlzLl9kZWJ1Z0JhY2tncm91bmRKb2JzU25hcHNob3QoKSxcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2RlYnVnQ29uZmlndXJhdGlvblNuYXBzaG90KCksXG4gICAgICBkYXRhYmFzZTogdGhpcy5fZGVidWdEYXRhYmFzZVNuYXBzaG90KCksXG4gICAgICBnZW5lcmF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgc2VydmVyOiB0aGlzLl9kZWJ1Z1NlcnZlclNuYXBzaG90KCksXG4gICAgICB3ZWJzb2NrZXRzOiB0aGlzLl9kZWJ1Z1dlYnNvY2tldFNuYXBzaG90KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBodHRwIHNlcnZlciBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBIVFRQIHNlcnZlciB3b3JrZXIgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBhc3luYyBfZGVidWdIdHRwU2VydmVyU25hcHNob3QoKSB7XG4gICAgY29uc3QgaHR0cFNlcnZlciA9IC8qKiBAdHlwZSB7e2dldERlYnVnU25hcHNob3Q/OiAoKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHwgdW5kZWZpbmVkfSAqLyAodGhpcy5faHR0cFNlcnZlckluc3RhbmNlKVxuXG4gICAgaWYgKCFodHRwU2VydmVyPy5nZXREZWJ1Z1NuYXBzaG90KSB7XG4gICAgICByZXR1cm4ge2NvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5odHRwU2VydmVyKSwgYWN0aXZlOiBmYWxzZX1cbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgaHR0cFNlcnZlci5nZXREZWJ1Z1NuYXBzaG90KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHNlcnZlciBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBTZXJ2ZXIgcnVudGltZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z1NlcnZlclNuYXBzaG90KCkge1xuICAgIGNvbnN0IG5vZGVQcm9jZXNzID0gdHlwZW9mIHByb2Nlc3MgPT09IFwidW5kZWZpbmVkXCIgPyB1bmRlZmluZWQgOiBwcm9jZXNzXG5cbiAgICByZXR1cm4ge1xuICAgICAgZW52aXJvbm1lbnQ6IHRoaXMuZ2V0RW52aXJvbm1lbnQoKSxcbiAgICAgIG1lbW9yeVVzYWdlOiBub2RlUHJvY2VzcyA/IG5vZGVQcm9jZXNzLm1lbW9yeVVzYWdlKCkgOiB1bmRlZmluZWQsXG4gICAgICBub2RlVmVyc2lvbjogbm9kZVByb2Nlc3M/LnZlcnNpb25zPy5ub2RlLFxuICAgICAgcGlkOiBub2RlUHJvY2Vzcz8ucGlkLFxuICAgICAgcGxhdGZvcm06IG5vZGVQcm9jZXNzPy5wbGF0Zm9ybSxcbiAgICAgIHVwdGltZVNlY29uZHM6IG5vZGVQcm9jZXNzID8gbm9kZVByb2Nlc3MudXB0aW1lKCkgOiB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBjb25maWd1cmF0aW9uIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbmZpZ3VyYXRpb24gZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdDb25maWd1cmF0aW9uU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFwaU1hbmlmZXN0OiB0aGlzLl9hcGlNYW5pZmVzdEVuYWJsZWQoKSA/IHtlbmFibGVkOiB0cnVlLCBwYXRoOiB0aGlzLl9hcGlNYW5pZmVzdC5wYXRoLCB0b2tlbkNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fYXBpTWFuaWZlc3QudG9rZW4pfSA6IHtlbmFibGVkOiBmYWxzZX0sXG4gICAgICBhdXRvbG9hZDogdGhpcy5nZXRBdXRvbG9hZCgpLFxuICAgICAgZGVidWc6IHRoaXMuZGVidWcgPT09IHRydWUsXG4gICAgICBkZWJ1Z0VuZHBvaW50OiB0aGlzLl9kZWJ1Z0VuZHBvaW50U25hcHNob3QoKSxcbiAgICAgIGVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlczogdGhpcy5nZXRFbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMoKSxcbiAgICAgIGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzOiB0aGlzLmdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCksXG4gICAgICBpbml0aWFsaXplZDogdGhpcy5faXNJbml0aWFsaXplZCxcbiAgICAgIGxvZ2dpbmc6IHtcbiAgICAgICAgZGVidWdMb3dMZXZlbDogdGhpcy5fbG9nZ2luZz8uZGVidWdMb3dMZXZlbCA9PT0gdHJ1ZSxcbiAgICAgICAgb3V0cHV0czogdGhpcy5fbG9nZ2luZyA/IE9iamVjdC5rZXlzKHRoaXMuX2xvZ2dpbmcpIDogW11cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBiYWNrZ3JvdW5kIGpvYnMgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQmFja2dyb3VuZCBqb2IgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdCYWNrZ3JvdW5kSm9ic1NuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBjb25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2JhY2tncm91bmRKb2JzKSxcbiAgICAgIHNjaGVkdWxlZENvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZGF0YWJhc2Ugc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gRGF0YWJhc2UgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdEYXRhYmFzZVNuYXBzaG90KCkge1xuICAgIC8qKlxuICAgICAqIERhdGFiYXNlIHBvb2xzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5EYXRhYmFzZVBvb2xEZWJ1Z1NuYXBzaG90Pn0gKi9cbiAgICBjb25zdCBkYXRhYmFzZVBvb2xzID0ge31cbiAgICBjb25zdCBhY3RpdmVJZGVudGlmaWVycyA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgYWN0aXZlSWRlbnRpZmllcnMpIHtcbiAgICAgIGRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0gPSB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS5nZXREZWJ1Z1NuYXBzaG90KClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWN0aXZlSWRlbnRpZmllcnMsXG4gICAgICBkaXNhYmxlZElkZW50aWZpZXJzOiBBcnJheS5mcm9tKHRoaXMuZ2V0RGlzYWJsZWREYXRhYmFzZUlkZW50aWZpZXJzKCkpLFxuICAgICAgaW5pdGlhbGl6ZWRQb29sczogT2JqZWN0LmtleXModGhpcy5kYXRhYmFzZVBvb2xzKSxcbiAgICAgIHBvb2xzOiBkYXRhYmFzZVBvb2xzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgd2Vic29ja2V0IHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFdlYlNvY2tldCBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z1dlYnNvY2tldFNuYXBzaG90KCkge1xuICAgIC8qKlxuICAgICAqIFNlc3Npb24gYnVja2V0cy5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2NvdW50OiBudW1iZXIsIGRldGFpbHM6IHtjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IG51bWJlciwgY2hhbm5lbFN1YnNjcmlwdGlvbnM6IHtjaGFubmVsVHlwZTogc3RyaW5nLCBjb3VudDogbnVtYmVyLCBtb2RlbDogc3RyaW5nIHwgbnVsbH1bXSwgY29ubmVjdGlvbkNvdW50OiBudW1iZXIsIHBhdXNlZDogYm9vbGVhbiwgc3Vic2NyaXB0aW9uQ291bnQ6IG51bWJlcn19Pn0gKi9cbiAgICBjb25zdCBzZXNzaW9uQnVja2V0cyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIFNlc3Npb24gZGV0YWlscy5cbiAgICAgKiBAdHlwZSB7e2NoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogbnVtYmVyLCBjaGFubmVsU3Vic2NyaXB0aW9uczoge2NoYW5uZWxUeXBlOiBzdHJpbmcsIGNvdW50OiBudW1iZXIsIG1vZGVsOiBzdHJpbmcgfCBudWxsfVtdLCBjb25uZWN0aW9uQ291bnQ6IG51bWJlciwgcGF1c2VkOiBib29sZWFuLCBxdWV1ZWRNZXNzYWdlQ291bnQ6IG51bWJlciwgc3Vic2NyaXB0aW9uQ291bnQ6IG51bWJlcn1bXX0gKi9cbiAgICBjb25zdCBzZXNzaW9uRGV0YWlscyA9IFtdXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IEFycmF5LmZyb20odGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZW50cmllcygpKS5tYXAoKFtjaGFubmVsLCBjaGFubmVsU3Vic2NyaXB0aW9uc10pID0+IHtcbiAgICAgIC8qKlxuICAgICAgICogRGV0YWlscyBidWNrZXRzLlxuICAgICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtjb3VudDogbnVtYmVyLCBkZXRhaWxzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgICAgIGNvbnN0IGRldGFpbHNCdWNrZXRzID0gbmV3IE1hcCgpXG5cbiAgICAgIGZvciAoY29uc3Qgc3Vic2NyaXB0aW9uIG9mIGNoYW5uZWxTdWJzY3JpcHRpb25zKSB7XG4gICAgICAgIGNvbnN0IGRldGFpbHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZShzdWJzY3JpcHRpb24uZGVidWdTbmFwc2hvdCgpKSlcbiAgICAgICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkoZGV0YWlscylcbiAgICAgICAgY29uc3QgZXhpc3RpbmdCdWNrZXQgPSBkZXRhaWxzQnVja2V0cy5nZXQoa2V5KVxuXG4gICAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkZXRhaWxzQnVja2V0cy5zZXQoa2V5LCB7Y291bnQ6IDEsIGRldGFpbHN9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNoYW5uZWwsXG4gICAgICAgIGNvdW50OiBjaGFubmVsU3Vic2NyaXB0aW9ucy5zaXplLFxuICAgICAgICBkZXRhaWxzOiBBcnJheS5mcm9tKGRldGFpbHNCdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgZm9yIChjb25zdCBzZXNzaW9uIG9mIHRoaXMuX3dlYnNvY2tldFNlc3Npb25zKSB7XG4gICAgICAvKipcbiAgICAgICAqIENoYW5uZWwgc3Vic2NyaXB0aW9uIGJ1Y2tldHMuXG4gICAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2NoYW5uZWxUeXBlOiBzdHJpbmcsIGNvdW50OiBudW1iZXIsIG1vZGVsOiBzdHJpbmcgfCBudWxsfT59ICovXG4gICAgICBjb25zdCBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cyA9IG5ldyBNYXAoKVxuXG4gICAgICBmb3IgKGNvbnN0IHtjaGFubmVsVHlwZSwgc3Vic2NyaXB0aW9ufSBvZiBzZXNzaW9uLl9jaGFubmVsU3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgICBjb25zdCBkZXRhaWxzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzdWJzY3JpcHRpb24uZGVidWdTbmFwc2hvdCgpKVxuICAgICAgICBjb25zdCBtb2RlbCA9IHR5cGVvZiBkZXRhaWxzLm1vZGVsID09PSBcInN0cmluZ1wiID8gZGV0YWlscy5tb2RlbCA6IG51bGxcbiAgICAgICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkoe2NoYW5uZWxUeXBlLCBtb2RlbH0pXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nQnVja2V0ID0gY2hhbm5lbFN1YnNjcmlwdGlvbkJ1Y2tldHMuZ2V0KGtleSlcblxuICAgICAgICBpZiAoZXhpc3RpbmdCdWNrZXQpIHtcbiAgICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkJ1Y2tldHMuc2V0KGtleSwge2NoYW5uZWxUeXBlLCBjb3VudDogMSwgbW9kZWx9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNoYW5uZWxTdWJzY3JpcHRpb25zID0gQXJyYXkuZnJvbShjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy52YWx1ZXMoKSkuc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQpXG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHtcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzZXNzaW9uLl9jaGFubmVsU3Vic2NyaXB0aW9ucy5zaXplLFxuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgY29ubmVjdGlvbkNvdW50OiBzZXNzaW9uLl9jb25uZWN0aW9ucy5zaXplLFxuICAgICAgICBwYXVzZWQ6IHNlc3Npb24uX3BhdXNlZCxcbiAgICAgICAgcXVldWVkTWVzc2FnZUNvdW50OiBzZXNzaW9uLl9vdXRib3VuZFF1ZXVlLmxlbmd0aCxcbiAgICAgICAgc3Vic2NyaXB0aW9uQ291bnQ6IHNlc3Npb24uc3Vic2NyaXB0aW9ucy5zaXplXG4gICAgICB9XG4gICAgICBjb25zdCBidWNrZXRLZXkgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogc25hcHNob3QuY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50LFxuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uczogc25hcHNob3QuY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgIGNvbm5lY3Rpb25Db3VudDogc25hcHNob3QuY29ubmVjdGlvbkNvdW50LFxuICAgICAgICBwYXVzZWQ6IHNuYXBzaG90LnBhdXNlZCxcbiAgICAgICAgc3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LnN1YnNjcmlwdGlvbkNvdW50XG4gICAgICB9KVxuICAgICAgY29uc3QgZXhpc3RpbmdCdWNrZXQgPSBzZXNzaW9uQnVja2V0cy5nZXQoYnVja2V0S2V5KVxuXG4gICAgICBpZiAoZXhpc3RpbmdCdWNrZXQpIHtcbiAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2Vzc2lvbkJ1Y2tldHMuc2V0KGJ1Y2tldEtleSwge1xuICAgICAgICAgIGNvdW50OiAxLFxuICAgICAgICAgIGRldGFpbHM6IHtcbiAgICAgICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogc25hcHNob3QuY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50LFxuICAgICAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbnM6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICAgICAgY29ubmVjdGlvbkNvdW50OiBzbmFwc2hvdC5jb25uZWN0aW9uQ291bnQsXG4gICAgICAgICAgICBwYXVzZWQ6IHNuYXBzaG90LnBhdXNlZCxcbiAgICAgICAgICAgIHN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5zdWJzY3JpcHRpb25Db3VudFxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICAgIHNlc3Npb25EZXRhaWxzLnB1c2goc25hcHNob3QpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGxpdmVPbmx5Q2hhbm5lbHM6IEFycmF5LmZyb20odGhpcy5fbGl2ZU9ubHlXZWJzb2NrZXRDaGFubmVscyksXG4gICAgICBwYXVzZWRTZXNzaW9uczogdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuc2l6ZSxcbiAgICAgIHJlZ2lzdGVyZWRDaGFubmVsczogQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5rZXlzKCkpLFxuICAgICAgcmVnaXN0ZXJlZENvbm5lY3Rpb25zOiBBcnJheS5mcm9tKHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzLmtleXMoKSksXG4gICAgICBzZXNzaW9uQnVja2V0czogQXJyYXkuZnJvbShzZXNzaW9uQnVja2V0cy52YWx1ZXMoKSkuc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQpLFxuICAgICAgc2Vzc2lvbkNvdW50OiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9ucy5zaXplLFxuICAgICAgc2Vzc2lvbnM6IHNlc3Npb25EZXRhaWxzLnNvcnQoKGEsIGIpID0+IGIuY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50IC0gYS5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQpLFxuICAgICAgc3Vic2NyaXB0aW9uR3JvdXBzOiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5zaXplLFxuICAgICAgc3Vic2NyaXB0aW9uc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBkYXRhYmFzZSBwb29sLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGlmICghdGhpcy5pc0RhdGFiYXNlUG9vbEluaXRpYWxpemVkKGlkZW50aWZpZXIpKSB7XG4gICAgICB0aGlzLmluaXRpYWxpemVEYXRhYmFzZVBvb2woaWRlbnRpZmllcilcbiAgICB9XG5cbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFiYXNlUG9vbHNcIiwgaWRlbnRpZmllcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBmcmFtZXdvcmstb3duZWQgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZX0gLSBMaWZlY3ljbGUgb3duZXIuXG4gICAqL1xuICBnZXRGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSgpIHsgcmV0dXJuIHRoaXMuX2Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlIH1cblxuICAvKipcbiAgICogUmV0dXJucyBzYWZlIGZyb250ZW5kIHRlbmFudCBTUUxpdGUgZGlhZ25vc3RpY3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlW1wiaW5zcGVjdEFsbFwiXT59IC0gTGlmZWN5Y2xlIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgaW5zcGVjdEZyb250ZW5kVGVuYW50U3FsaXRlSGFuZGxlcygpIHsgcmV0dXJuIHRoaXMuX2Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlLmluc3BlY3RBbGwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSlcbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihpZGVudGlmaWVyKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgc2NoZW1hIG1ldGFkYXRhIGNhY2hlZCBieSBldmVyeSBpbml0aWFsaXplZCBwb29sIHRoYXQgdGFyZ2V0cyB0aGVcbiAgICogc2FtZSBwaHlzaWNhbCBkYXRhYmFzZSAobWF0Y2hlZCBieSBjb25uZWN0aW9uIHJldXNlIGtleSkuIFNlcGFyYXRlIHBvb2xzIHRoYXRcbiAgICogcG9pbnQgYXQgb25lIGRhdGFiYXNlIGtlZXAgaW5kZXBlbmRlbnQgc2NoZW1hIGNhY2hlcywgc28gRERMIHJ1biB0aHJvdWdoIG9uZVxuICAgKiBwb29sIHdvdWxkIG90aGVyd2lzZSBsZWF2ZSB0aGUgb3RoZXJzIHJlcG9ydGluZyBzdGFsZSB0YWJsZXMvY29sdW1ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gQ29ubmVjdGlvbiByZXVzZSBrZXkgaWRlbnRpZnlpbmcgdGhlIHNoYXJlZCBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2xlYXJTY2hlbWFDYWNoZXNGb3JSZXVzZUtleShyZXVzZUtleSkge1xuICAgIHRoaXMuX3NjaGVtYUNhY2hlR2VuZXJhdGlvbnNCeVJldXNlS2V5LnNldChcbiAgICAgIHJldXNlS2V5LFxuICAgICAgdGhpcy5zY2hlbWFDYWNoZUdlbmVyYXRpb25Gb3JSZXVzZUtleShyZXVzZUtleSkgKyAxXG4gICAgKVxuXG4gICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgaWYgKHBvb2wuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KCkgPT09IHJldXNlS2V5KSB7XG4gICAgICAgIHBvb2wuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgc2NoZW1hLWNhY2hlIGdlbmVyYXRpb24gZm9yIG9uZSBwaHlzaWNhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gQ29ubmVjdGlvbiByZXVzZSBrZXkgaWRlbnRpZnlpbmcgdGhlIHNoYXJlZCBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBDdXJyZW50IHNjaGVtYS1jYWNoZSBnZW5lcmF0aW9uLlxuICAgKi9cbiAgc2NoZW1hQ2FjaGVHZW5lcmF0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5fc2NoZW1hQ2FjaGVHZW5lcmF0aW9uc0J5UmV1c2VLZXkuZ2V0KHJldXNlS2V5KSB8fCAwXG4gIH1cblxuICAvKipcbiAgICogSW52YWxpZGF0ZXMgcmVjb3JkIG1ldGFkYXRhIG93bmVkIGJ5IG9uZSBjbG9zZWQvZGVsZXRlZCBwaHlzaWNhbCB0ZW5hbnRcbiAgICogZGF0YWJhc2Ugd2hpbGUgcHJlc2VydmluZyBldmVyeSBvdGhlciB0ZW5hbnQgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBMb2dpY2FsIGlkZW50aWZpZXIgcGx1cyBwb29sIHJldXNlIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGVhclJlY29yZE1ldGFkYXRhRm9yRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIE9iamVjdC52YWx1ZXModGhpcy5tb2RlbENsYXNzZXMpKSB7XG4gICAgICBtb2RlbENsYXNzLmNsZWFyUmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3JEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIHBvb2wgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGRhdGFiYXNlIHBvb2wgdHlwZS5cbiAgICovXG4gIGdldERhdGFiYXNlUG9vbFR5cGUoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgY29uc3QgcG9vbFR5cGVDbGFzcyA9IGRpZ2codGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllciksIFwicG9vbFR5cGVcIilcblxuICAgIGlmICghcG9vbFR5cGVDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gcG9vbFR5cGUgZ2l2ZW4gaW4gZGF0YWJhc2UgY29uZmlndXJhdGlvblwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJlc29sdmVUZXN0U2hhcmVkVHJhbnNhY3Rpb25Qb29sVHlwZSh7XG4gICAgICBjb25maWd1cmVkUG9vbFR5cGU6IHBvb2xUeXBlQ2xhc3MsXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IGlkZW50aWZpZXJcbiAgICB9KVxuICB9XG5cbiAgZ2V0RGF0YWJhc2VUeXBlKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGNvbnN0IGRhdGFiYXNlVHlwZSA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGlkZW50aWZpZXIpLnR5cGVcblxuICAgIGlmICghZGF0YWJhc2VUeXBlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhYmFzZSB0eXBlIGdpdmVuIGluIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgIHJldHVybiBkYXRhYmFzZVR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRpcmVjdG9yeS5cbiAgICovXG4gIGdldERpcmVjdG9yeSgpIHtcbiAgICBjb25zdCBkaXJlY3RvcnkgPSB0aGlzLmdldERpcmVjdG9yeUlmQXZhaWxhYmxlKClcblxuICAgIGlmICghZGlyZWN0b3J5KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkaXJlY3RvcnkgY29uZmlndXJlZCBhbmQgcHJvY2Vzcy5jd2QgaXMgdW5hdmFpbGFibGVcIilcblxuICAgIHJldHVybiBkaXJlY3RvcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkaXJlY3RvcnkgaWYgYXZhaWxhYmxlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBkaXJlY3Rvcnkgd2hlbiB0aGUgcnVudGltZSBjYW4gcmVzb2x2ZSBvbmUuXG4gICAqL1xuICBnZXREaXJlY3RvcnlJZkF2YWlsYWJsZSgpIHtcbiAgICBpZiAoIXRoaXMuX2RpcmVjdG9yeSkge1xuICAgICAgdGhpcy5fZGlyZWN0b3J5ID0gY3VycmVudFdvcmtpbmdEaXJlY3RvcnkoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9kaXJlY3RvcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBiYWNrZW5kIHByb2plY3RzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfSAtIEJhY2tlbmQgcHJvamVjdHMuXG4gICAqL1xuICBnZXRCYWNrZW5kUHJvamVjdHMoKSB7IHJldHVybiB0aGlzLl9iYWNrZW5kUHJvamVjdHMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwYWNrYWdlcy5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c1BhY2thZ2VbXX0gLSBSZWdpc3RlcmVkIFZlbG9jaW91cyBwYWNrYWdlcy5cbiAgICovXG4gIGdldFBhY2thZ2VzKCkgeyByZXR1cm4gdGhpcy5fcGFja2FnZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhYmlsaXR5IHJlc291cmNlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gICAqL1xuICBnZXRBYmlsaXR5UmVzb3VyY2VzKCkgeyByZXR1cm4gdGhpcy5fYWJpbGl0eVJlc291cmNlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGFiaWxpdHkgcmVzb3VyY2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gcmVzb3VyY2VzIC0gQWJpbGl0eSByZXNvdXJjZSBjbGFzc2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBYmlsaXR5UmVzb3VyY2VzKHJlc291cmNlcykgeyB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gcmVzb3VyY2VzIH1cblxuICAvKipcbiAgICogTWVyZ2VzIHJlc291cmNlIGNsYXNzZXMgZGlzY292ZXJlZCBmcm9tIHRoZSBhcHAgYW5kIGV2ZXJ5IHJlZ2lzdGVyZWQgcGFja2FnZVxuICAgKiBpbnRvIHRoZSBhYmlsaXR5LXJlc291cmNlcyBsaXN0LiBgYXV0b0Rpc2NvdmVyUmVzb3VyY2VzYCBwb3B1bGF0ZXMgZWFjaCBiYWNrZW5kXG4gICAqIHByb2plY3QncyBgZnJvbnRlbmRNb2RlbHNgIChpbmNsdWRpbmcgcGFja2FnZSBwcm9qZWN0cyksIHNvIHRoaXMgbWFrZXMgYVxuICAgKiBwYWNrYWdlLWNvbnRyaWJ1dGVkIG1vZGVsJ3MgYWJpbGl0aWVzIHJlYWNoIHN1YnNjcmlwdGlvbiBhbmQgcGVyLXJlY29yZFxuICAgKiBhdXRob3JpemF0aW9uIGF1dG9tYXRpY2FsbHkg4oCUIGNvbnN1bWluZyBhcHBzIGRvIG5vdCBoYXZlIHRvIGhhbmQtcmVnaXN0ZXJcbiAgICogcGFja2FnZSByZXNvdXJjZXMuIEFscmVhZHktcHJlc2VudCBjbGFzc2VzIChlLmcuIGFuIGFwcCdzIGV4cGxpY2l0bHktc2V0XG4gICAqIHJlc291cmNlcykgYXJlIGxlZnQgdW50b3VjaGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfbWVyZ2VEaXNjb3ZlcmVkQWJpbGl0eVJlc291cmNlcygpIHtcbiAgICBjb25zdCBtZXJnZWQgPSBbLi4udGhpcy5fYWJpbGl0eVJlc291cmNlc11cbiAgICBjb25zdCBzZWVuID0gbmV3IFNldChtZXJnZWQpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIHRoaXMuX2JhY2tlbmRQcm9qZWN0cykge1xuICAgICAgaWYgKCFiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzKSBjb250aW51ZVxuXG4gICAgICBmb3IgKGNvbnN0IFJlc291cmNlQ2xhc3Mgb2YgYmFja2VuZFByb2plY3QuYWJpbGl0eVJlc291cmNlcykge1xuICAgICAgICBpZiAoc2Vlbi5oYXMoUmVzb3VyY2VDbGFzcykpIGNvbnRpbnVlXG5cbiAgICAgICAgc2Vlbi5hZGQoUmVzb3VyY2VDbGFzcylcbiAgICAgICAgbWVyZ2VkLnB1c2goUmVzb3VyY2VDbGFzcylcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gbWVyZ2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYWJpbGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIEFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRBYmlsaXR5UmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50UmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRlbmFudCByZXNvbHZlci5cbiAgICovXG4gIGdldFRlbmFudFJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fdGVuYW50UmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0VGVuYW50RGF0YWJhc2VSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbmZvcmNlIHRlbmFudCBkYXRhYmFzZSBzY29wZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyByZXF1aXJlIGEgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXRFbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMoKSB7IHJldHVybiB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXJzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlPn0gLSBUZW5hbnQgZGF0YWJhc2UgbGlmZWN5Y2xlIHByb3ZpZGVycy5cbiAgICovXG4gIGdldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKCkgeyByZXR1cm4gdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZX0gLSBUZW5hbnQgZGF0YWJhc2UgbGlmZWN5Y2xlIHByb3ZpZGVyLlxuICAgKi9cbiAgZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcihpZGVudGlmaWVyKSB7XG4gICAgY29uc3QgcHJvdmlkZXIgPSB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVyc1tpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFwcm92aWRlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgY29uZmlndXJlZCBmb3IgZGF0YWJhc2UgaWRlbnRpZmllcjogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3ZpZGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudHMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50c0NvbmZpZ3VyYXRpb259IC0gQXR0YWNobWVudHMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbigpIHsgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzIHx8IHt9IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUm91dGVSZXNvbHZlckhvb2tUeXBlW119IC0gUm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqL1xuICBnZXRSb3V0ZVJlc29sdmVySG9va3MoKSB7IHJldHVybiB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCByb3V0ZSByZXNvbHZlciBob29rLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Sb3V0ZVJlc29sdmVySG9va1R5cGV9IGhvb2sgLSBSb3V0ZSByZXNvbHZlciBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhZGRSb3V0ZVJlc29sdmVySG9vayhob29rKSB7XG4gICAgdGhpcy5fcm91dGVSZXNvbHZlckhvb2tzLnB1c2goaG9vaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSByZXNvbHZlciAtIEFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEFiaWxpdHlSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgPSByZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50UmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSByZXNvbHZlciAtIFRlbmFudCByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGVuYW50UmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fdGVuYW50UmVzb2x2ZXIgPSByZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gVGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUZW5hbnREYXRhYmFzZVJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIgPSByZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyByZXF1aXJlIGEgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyhuZXdWYWx1ZSkgeyB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlPn0gcHJvdmlkZXJzIC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKHByb3ZpZGVycykgeyB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyA9IHByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBlbnZpcm9ubWVudC5cbiAgICovXG4gIGdldEVudmlyb25tZW50KCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcIl9lbnZpcm9ubWVudFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlcXVlc3QgdGltZW91dCBtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBSZXF1ZXN0IHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIGdldFJlcXVlc3RUaW1lb3V0TXMoKSB7XG4gICAgY29uc3QgZW52VGltZW91dCA9IHRoaXMuX3BhcnNlUmVxdWVzdFRpbWVvdXRTZWNvbmRzKHByb2Nlc3MuZW52LlZFTE9DSU9VU19SRVFVRVNUX1RJTUVPVVRfTVMpXG4gICAgY29uc3QgdmFsdWUgPSB0eXBlb2YgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMoKVxuICAgICAgOiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodHlwZW9mIGVudlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlRpbWVvdXQpKSByZXR1cm4gZW52VGltZW91dFxuXG4gICAgcmV0dXJuIDYwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSByZXF1ZXN0IHRpbWVvdXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHJhd1ZhbHVlIC0gRW52IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIF9wYXJzZVJlcXVlc3RUaW1lb3V0U2Vjb25kcyhyYXdWYWx1ZSkge1xuICAgIGlmIChyYXdWYWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB0cmltbWVkID0gcmF3VmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9eKFxcZCsoPzpcXC5cXGQrKT8pKG1zfHMpPyQvKVxuXG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcihtYXRjaFsxXSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKG51bWVyaWMpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB1bml0ID0gbWF0Y2hbMl1cblxuICAgIGlmICh1bml0ID09PSBcIm1zXCIpIHJldHVybiBudW1lcmljIC8gMTAwMFxuICAgIGlmICh1bml0ID09PSBcInNcIikgcmV0dXJuIG51bWVyaWNcblxuICAgIGlmICh0cmltbWVkLmluY2x1ZGVzKFwiLlwiKSkgcmV0dXJuIG51bWVyaWNcbiAgICBpZiAobnVtZXJpYyA+PSAxMDAwKSByZXR1cm4gbnVtZXJpYyAvIDEwMDBcblxuICAgIHJldHVybiBudW1lcmljXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZW52aXJvbm1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdFbnZpcm9ubWVudCAtIE5ldyBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0RW52aXJvbm1lbnQobmV3RW52aXJvbm1lbnQpIHsgdGhpcy5fZW52aXJvbm1lbnQgPSBuZXdFbnZpcm9ubWVudCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlZmF1bHRDb25zb2xlXSAtIFdoZXRoZXIgZGVmYXVsdCBjb25zb2xlLlxuICAgKiBAcmV0dXJucyB7UmVxdWlyZWQ8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiY29uc29sZVwiIHwgXCJmaWxlXCIgfCBcImxldmVsc1wiPj4gJiBQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJkaXJlY3RvcnlcIiB8IFwiZmlsZVBhdGhcIj4gJiBQYXJ0aWFsPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcIm91dHB1dHNcIiB8IFwibG9nZ2Vyc1wiPj59IC0gVGhlIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldExvZ2dpbmdDb25maWd1cmF0aW9uKHtkZWZhdWx0Q29uc29sZX0gPSB7fSkge1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gdGhpcy5nZXRFbnZpcm9ubWVudCgpXG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuX2xvZ2dpbmc/LmRpcmVjdG9yeSB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0RGVmYXVsdExvZ0RpcmVjdG9yeSh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLl9sb2dnaW5nPy5maWxlUGF0aCB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0TG9nRmlsZVBhdGgoe2NvbmZpZ3VyYXRpb246IHRoaXMsIGRpcmVjdG9yeSwgZW52aXJvbm1lbnR9KVxuICAgIGNvbnN0IGNvbnNvbGVPdmVycmlkZSA9IHRoaXMuX2xvZ2dpbmc/LmNvbnNvbGVcbiAgICBjb25zdCBoYXNMb2dnaW5nQ29uZmlnID0gQm9vbGVhbih0aGlzLl9sb2dnaW5nKVxuICAgIGNvbnN0IGZpbGVMb2dnaW5nID0gaGFzTG9nZ2luZ0NvbmZpZyA/ICh0aGlzLl9sb2dnaW5nPy5maWxlID8/IEJvb2xlYW4oZmlsZVBhdGgpKSA6IGZhbHNlXG4gICAgY29uc3QgY29uZmlndXJlZExldmVscyA9IHRoaXMuX2xvZ2dpbmc/LmxldmVsc1xuICAgIGNvbnN0IGluY2x1ZGVMb3dMZXZlbERlYnVnID0gdGhpcy5fbG9nZ2luZz8uZGVidWdMb3dMZXZlbCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGxvZ2dlcnMgPSB0aGlzLl9sb2dnaW5nPy5sb2dnZXJzXG5cbiAgICBjb25zdCBjb25zb2xlRGVmYXVsdCA9IGRlZmF1bHRDb25zb2xlICE9PSB1bmRlZmluZWQgPyBkZWZhdWx0Q29uc29sZSA6IHRydWVcbiAgICBjb25zdCBjb25zb2xlTG9nZ2luZyA9IGNvbnNvbGVPdmVycmlkZSAhPT0gdW5kZWZpbmVkID8gY29uc29sZU92ZXJyaWRlIDogY29uc29sZURlZmF1bHRcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgbGV2ZWxzLlxuICAgICAqIEB0eXBlIHtBcnJheTxcImRlYnVnLWxvdy1sZXZlbFwiIHwgXCJkZWJ1Z1wiIHwgXCJpbmZvXCIgfCBcIndhcm5cIiB8IFwiZXJyb3JcIj59ICovXG4gICAgY29uc3QgZGVmYXVsdExldmVscyA9IFtcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl1cblxuICAgIGlmIChpbmNsdWRlTG93TGV2ZWxEZWJ1ZykgZGVmYXVsdExldmVscy51bnNoaWZ0KFwiZGVidWctbG93LWxldmVsXCIpXG5cbiAgICBjb25zdCBsZXZlbHMgPSBjb25maWd1cmVkTGV2ZWxzIHx8IGRlZmF1bHRMZXZlbHNcblxuICAgIHJldHVybiB7XG4gICAgICBjb25zb2xlOiBjb25zb2xlTG9nZ2luZyxcbiAgICAgIGRpcmVjdG9yeSxcbiAgICAgIGZpbGU6IGZpbGVMb2dnaW5nID8/IGZhbHNlLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBsb2dnZXJzLFxuICAgICAgbGV2ZWxzLFxuICAgICAgb3V0cHV0czogdGhpcy5fbG9nZ2luZz8ub3V0cHV0c1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb25maWd1cmF0aW9uLW93bmVkIHN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICogQHJldHVybnMge0xvZ1JlZGFjdG9yfSAtIFN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICovXG4gIGdldExvZ1JlZGFjdG9yKCkge1xuICAgIHJldHVybiB0aGlzLl9sb2dSZWRhY3RvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5IGxvZ2dpbmcgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBxdWVyeSBsb2dnaW5nIGlzIGVuYWJsZWQuXG4gICAqL1xuICBnZXRRdWVyeUxvZ2dpbmdFbmFibGVkKCkge1xuICAgIGlmICh0aGlzLl9sb2dnaW5nPy5xdWVyeUxvZ2dpbmcgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2xvZ2dpbmcucXVlcnlMb2dnaW5nXG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudCgpICE9PSBcInRlc3RcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGdlbmVyYXRpb24gbGlmZWN5Y2xlIHZhbHVlcyBmcm9tIHRoZWlyIHJhdyBjb25maWcsIGVudmlyb25tZW50LFxuICAgKiBhbmQgQVBJIHNvdXJjZXMgYmVmb3JlIGFwcGx5aW5nIGRlZmF1bHRzLiBEZXJpdmVkIGRlZmF1bHRzIGFyZSBkZWxpYmVyYXRlbHlcbiAgICogYWJzZW50IGZyb20gdGhlIHNvdXJjZSBsaXN0LCBzbyBhbiBBUEkgcmVjb3Zlcnkgc3RhdGUgY2FuIG92ZXJyaWRlIGFuXG4gICAqIElELW9ubHkgY29uZmlndXJhdGlvbiB3aXRob3V0IGNyZWF0aW5nIGEgZmFsc2UgY29uZmxpY3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBFeHBsaWNpdCBBUEkgdmFsdWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlfSBbYXJncy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXSAtIEV4cGxpY2l0IGJvb3Qgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5saWZlY3ljbGVTb2NrZXRQYXRoXSAtIEV4cGxpY2l0IGxpZmVjeWNsZSBzb2NrZXQgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvdXJjZU5hbWVdIC0gSHVtYW4tcmVhZGFibGUgQVBJIG93bmVyLlxuICAgKiBAcmV0dXJucyB7e2dlbmVyYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgfCBcImFjdGl2ZVwiLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIFJlc29sdmVkIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgcmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7Z2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsIHNvdXJjZU5hbWUgPSBcImJhY2tncm91bmQgam9icyBBUElcIn0gPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLl9iYWNrZ3JvdW5kSm9icyB8fCB7fVxuICAgIGNvbnN0IGdlbmVyYXRpb25FbnZpcm9ubWVudCA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52IHx8IHt9XG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gcmVzb2x2ZUdlbmVyYXRpb25JZChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5nZW5lcmF0aW9uSWRcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImdlbmVyYXRpb25JZFwiKSAmJiBjb25maWd1cmVkLmdlbmVyYXRpb25JZCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5nZW5lcmF0aW9uSWR9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRFwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSUR9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGdlbmVyYXRpb25JZGAsIHByZXNlbnQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEdlbmVyYXRpb25JZH1cbiAgICBdKVxuICAgIGNvbnN0IGluaXRpYWxHZW5lcmF0aW9uU3RhdGUgPSByZXNvbHZlSW5pdGlhbEdlbmVyYXRpb25TdGF0ZShbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJpbml0aWFsR2VuZXJhdGlvblN0YXRlXCIpICYmIGNvbmZpZ3VyZWQuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5pbml0aWFsR2VuZXJhdGlvblN0YXRlfSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBpbml0aWFsR2VuZXJhdGlvblN0YXRlYCwgcHJlc2VudDogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGV9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuICAgIGNvbnN0IGxpZmVjeWNsZVNvY2tldFBhdGggPSByZXNvbHZlTGlmZWN5Y2xlU29ja2V0UGF0aChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5saWZlY3ljbGVTb2NrZXRQYXRoXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJsaWZlY3ljbGVTb2NrZXRQYXRoXCIpICYmIGNvbmZpZ3VyZWQubGlmZWN5Y2xlU29ja2V0UGF0aCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5saWZlY3ljbGVTb2NrZXRQYXRofSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBsaWZlY3ljbGVTb2NrZXRQYXRoYCwgcHJlc2VudDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGh9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuXG4gICAgcmV0dXJuIHtnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge09taXQ8UmVxdWlyZWQ8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbj4sIFwiYWRhcHRlclwiIHwgXCJyZXRlbnRpb25cIiB8IFwiZ2VuZXJhdGlvbklkXCIgfCBcImxpZmVjeWNsZVNvY2tldFBhdGhcIj4gJiB7Z2VuZXJhdGlvbklkPzogc3RyaW5nLCBsaWZlY3ljbGVTb2NrZXRQYXRoPzogc3RyaW5nLCByZXRlbnRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JzUmV0ZW50aW9uQ29uZmlndXJhdGlvbn19IC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBjb25zdCBwcm9jZXNzRW52aXJvbm1lbnQgPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudlxuICAgIGNvbnN0IGVudkhvc3QgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSE9TVFxuICAgIGNvbnN0IGVudlBvcnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVFxuICAgIGNvbnN0IGVudkRhdGFiYXNlSWRlbnRpZmllciA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19EQVRBQkFTRV9JREVOVElGSUVSXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19NQVhfQ09OQ1VSUkVOVF9GT1JLRURfSk9CU1xuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTUFYX0NPTkNVUlJFTlRfSU5MSU5FX0pPQlNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX0NPVU5UXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3lSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9DT05DVVJSRU5DWVxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfSk9CU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX1JTU19CWVRFU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfTElGRVRJTUVfTVNcbiAgICBjb25zdCBlbnZEaXNwYXRjaFN0cmF0ZWd5ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0RJU1BBVENIX1NUUkFURUdZXG4gICAgY29uc3QgZW52UG9sbEludGVydmFsUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPTExfSU5URVJWQUxfTVNcbiAgICBjb25zdCBlbnZKb2JUaW1lb3V0UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0pPQl9USU1FT1VUX01TXG4gICAgY29uc3QgZW52UG9ydCA9IGVudlBvcnRSYXcgPyBOdW1iZXIoZW52UG9ydFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID0gZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA/IE51bWJlcihlbnZNYXhDb25jdXJyZW50Rm9ya2VkUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnQgPSBlbnZNYXhDb25jdXJyZW50UmF3ID8gTnVtYmVyKGVudk1heENvbmN1cnJlbnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ291bnQgPSBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJDb3VudFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPSBlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvbGxJbnRlcnZhbCA9IGVudlBvbGxJbnRlcnZhbFJhdyA/IE51bWJlcihlbnZQb2xsSW50ZXJ2YWxSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52Sm9iVGltZW91dCA9IGVudkpvYlRpbWVvdXRSYXcgPyBOdW1iZXIoZW52Sm9iVGltZW91dFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmFja2dyb3VuZEpvYnMgfHwge31cbiAgICBjb25zdCB7Z2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofSA9IHRoaXMucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZygpXG4gICAgY29uc3QgbW9kZSA9IGNvbmZpZ3VyZWQubW9kZSA9PT0gdW5kZWZpbmVkID8gXCJiYWNrZ3JvdW5kXCIgOiBjb25maWd1cmVkLm1vZGVcblxuICAgIGlmIChtb2RlICE9PSBcImJhY2tncm91bmRcIiAmJiBtb2RlICE9PSBcImlubGluZVwiKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBiYWNrZ3JvdW5kSm9icy5tb2RlIG11c3QgYmUgXCJiYWNrZ3JvdW5kXCIgb3IgXCJpbmxpbmVcIiwgZ290OiAke1N0cmluZyhtb2RlKX1gKVxuICAgIH1cbiAgICBjb25zdCBob3N0ID0gY29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3QgfHwgXCIxMjcuMC4wLjFcIlxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGNvbmZpZ3VyZWQucG9ydFxuICAgICAgOiAodHlwZW9mIGVudlBvcnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvcnQpID8gZW52UG9ydCA6IDczMzEpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gY29uZmlndXJlZC5kYXRhYmFzZUlkZW50aWZpZXIgfHwgZW52RGF0YWJhc2VJZGVudGlmaWVyIHx8IFwiZGVmYXVsdFwiXG4gICAgY29uc3QgbWF4Q29uY3VycmVudElubGluZUpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgICAgOiAodHlwZW9mIGVudk1heENvbmN1cnJlbnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudk1heENvbmN1cnJlbnQpICYmIGVudk1heENvbmN1cnJlbnQgPj0gMSA/IGVudk1heENvbmN1cnJlbnQgOiA0KVxuICAgIGNvbnN0IG1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICAgIDogKHR5cGVvZiBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZNYXhDb25jdXJyZW50Rm9ya2VkKSAmJiBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID49IDEgPyBlbnZNYXhDb25jdXJyZW50Rm9ya2VkIDogNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJDb3VudCA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnQpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnQgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50XG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyQ291bnRcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyQ291bnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lckNvdW50KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lckNvdW50KSAmJiBlbnZQb29sZWRSdW5uZXJDb3VudCA+PSAxID8gZW52UG9vbGVkUnVubmVyQ291bnQgOiA0KVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSkgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJDb25jdXJyZW5jeVwiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID49IDEgPyBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA6IDEpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4Sm9icyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9icykgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9ic1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heEpvYnNcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyTWF4Sm9icykgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhKb2JzID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhKb2JzIDogMTAwKVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgOiA1MTIgKiAxMDI0ICogMTAyNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpICYmIGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgOiA2MCAqIDYwICogMTAwMClcbiAgICBjb25zdCBkaXNwYXRjaFN0cmF0ZWd5UmF3ID0gY29uZmlndXJlZC5kaXNwYXRjaFN0cmF0ZWd5IHx8IGVudkRpc3BhdGNoU3RyYXRlZ3lcbiAgICBjb25zdCBkaXNwYXRjaFN0cmF0ZWd5ID0gZGlzcGF0Y2hTdHJhdGVneVJhdyA9PT0gXCJwb2xsaW5nXCIgPyBcInBvbGxpbmdcIiA6IFwiYmVhY29uXCJcbiAgICBjb25zdCBwb2xsSW50ZXJ2YWxNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQucG9sbEludGVydmFsTXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zXG4gICAgICA6ICh0eXBlb2YgZW52UG9sbEludGVydmFsID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb2xsSW50ZXJ2YWwpICYmIGVudlBvbGxJbnRlcnZhbCA+PSAxID8gZW52UG9sbEludGVydmFsIDogMTAwMClcbiAgICBjb25zdCBxdWV1ZXMgPSBjb25maWd1cmVkLnF1ZXVlcyAmJiB0eXBlb2YgY29uZmlndXJlZC5xdWV1ZXMgPT09IFwib2JqZWN0XCIgPyBjb25maWd1cmVkLnF1ZXVlcyA6IHt9XG4gICAgLy8gQW4gZXhwbGljaXQgY29uZmlnIHZhbHVlIHdpbnMgb3ZlciB0aGUgZW52IHZhciDigJQgaW5jbHVkaW5nIGBudWxsYC9gMGAsXG4gICAgLy8gd2hpY2ggZGlzYWJsZSB0aGUgYmFja3N0b3AgZXZlbiB3aGVuIHRoZSBlbnZpcm9ubWVudCBzZXRzIGEgZGVmYXVsdC5cbiAgICAvLyBPbmx5IGZhbGwgdGhyb3VnaCB0byB0aGUgZW52IHZhciB3aGVuIGNvbmZpZyBvbWl0cyBgam9iVGltZW91dE1zYCBlbnRpcmVseS5cbiAgICBjb25zdCBqb2JUaW1lb3V0TXMgPSBcImpvYlRpbWVvdXRNc1wiIGluIGNvbmZpZ3VyZWRcbiAgICAgID8gKHR5cGVvZiBjb25maWd1cmVkLmpvYlRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLmpvYlRpbWVvdXRNcyA+IDAgPyBjb25maWd1cmVkLmpvYlRpbWVvdXRNcyA6IG51bGwpXG4gICAgICA6ICh0eXBlb2YgZW52Sm9iVGltZW91dCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52Sm9iVGltZW91dCkgJiYgZW52Sm9iVGltZW91dCA+IDAgPyBlbnZKb2JUaW1lb3V0IDogbnVsbClcbiAgICBjb25zdCBjb25maWd1cmVkUmV0ZW50aW9uID0gY29uZmlndXJlZC5yZXRlbnRpb24gJiYgdHlwZW9mIGNvbmZpZ3VyZWQucmV0ZW50aW9uID09PSBcIm9iamVjdFwiID8gY29uZmlndXJlZC5yZXRlbnRpb24gOiB7fVxuICAgIGNvbnN0IHJldGVudGlvbiA9IHtcbiAgICAgIGNvbXBsZXRlZFR0bE1zOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5jb21wbGV0ZWRUdGxNcyA9PT0gXCJudW1iZXJcIiB8fCBjb25maWd1cmVkUmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zID09PSBudWxsXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5jb21wbGV0ZWRUdGxNc1xuICAgICAgICA6IDcgKiAyNCAqIDYwICogNjAgKiAxMDAwLFxuICAgICAgZmFpbGVkVHRsTXM6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLmZhaWxlZFR0bE1zID09PSBcIm51bWJlclwiIHx8IGNvbmZpZ3VyZWRSZXRlbnRpb24uZmFpbGVkVHRsTXMgPT09IG51bGxcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLmZhaWxlZFR0bE1zXG4gICAgICAgIDogMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwLFxuICAgICAgYmF0Y2hTaXplOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5iYXRjaFNpemUgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZFJldGVudGlvbi5iYXRjaFNpemUgPiAwXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5iYXRjaFNpemVcbiAgICAgICAgOiAxMDAwLFxuICAgICAgc3dlZXBJbnRlcnZhbE1zOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5zd2VlcEludGVydmFsTXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZFJldGVudGlvbi5zd2VlcEludGVydmFsTXMgPiAwXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5zd2VlcEludGVydmFsTXNcbiAgICAgICAgOiA2MCAqIDYwICogMTAwMFxuICAgIH1cblxuICAgIGNvbnN0IGpvYkNsYXNzZXMgPSB0aGlzLmdldEJhY2tncm91bmRKb2JDbGFzc2VzKClcblxuICAgIHJldHVybiB7aG9zdCwgcG9ydCwgZGF0YWJhc2VJZGVudGlmaWVyLCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icywgbWF4Q29uY3VycmVudElubGluZUpvYnMsIG1vZGUsIHBvb2xlZFJ1bm5lckNvdW50LCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSwgcG9vbGVkUnVubmVyTWF4Sm9icywgcG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMsIHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMsIGRpc3BhdGNoU3RyYXRlZ3ksIHBvbGxJbnRlcnZhbE1zLCBxdWV1ZXMsIGpvYkNsYXNzZXMsIGpvYlRpbWVvdXRNcywgcmV0ZW50aW9uLCBnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBzdGF0aWNhbGx5IHJlZ2lzdGVyZWQgcG9ydGFibGUgYmFja2dyb3VuZCBqb2JzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDbGFzc1tdfSAtIENvbmZpZ3VyZWQgam9iIGNsYXNzZXMuXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpIHtcbiAgICBjb25zdCBqb2JDbGFzc2VzID0gdGhpcy5fYmFja2dyb3VuZEpvYnM/LmpvYkNsYXNzZXNcblxuICAgIGlmIChqb2JDbGFzc2VzID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICAgIGlmICghQXJyYXkuaXNBcnJheShqb2JDbGFzc2VzKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmpvYkNsYXNzZXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuXG4gICAgcmV0dXJuIFsuLi5qb2JDbGFzc2VzXVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuZCBtZW1vaXplcyBvbmUgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXIgZm9yIHRoaXMgY29uZmlndXJhdGlvbiBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJ9IC0gQWN0aXZlIGFkYXB0ZXIuXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24pIHJldHVybiB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uLmFkYXB0ZXJcblxuICAgIGNvbnN0IGNvbmZpZ3VyZWRBZGFwdGVyID0gdGhpcy5fYmFja2dyb3VuZEpvYnM/LmFkYXB0ZXJcbiAgICBjb25zdCBhZGFwdGVyID0gdHlwZW9mIGNvbmZpZ3VyZWRBZGFwdGVyID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gY29uZmlndXJlZEFkYXB0ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgOiAoY29uZmlndXJlZEFkYXB0ZXIgfHwgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5jcmVhdGVCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXN9KSlcblxuICAgIGlmICghKGFkYXB0ZXIgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiYmFja2dyb3VuZEpvYnMuYWRhcHRlciBtdXN0IGJlIGEgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGluc3RhbmNlIG9yIGEgc3luY2hyb25vdXMgZmFjdG9yeSByZXR1cm5pbmcgb25lXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHtcbiAgICAgIGFkYXB0ZXIsXG4gICAgICBjbG9zaW5nOiBmYWxzZSxcbiAgICAgIGNsb3NlUHJvbWlzZTogdW5kZWZpbmVkLFxuICAgICAgcmVhZHlQcm9taXNlOiB1bmRlZmluZWRcbiAgICB9XG4gICAgcmV0dXJuIGFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IGFjcXVpcmVzIHRoZSBleGFjdCByZWFkeSBhZGFwdGVyIGZvciB0aGUgYWN0aXZlIGxpZmVjeWNsZS5cbiAgICogQSBjbG9zZSB0aGF0IGNsYWltcyB0aGUgZ2VuZXJhdGlvbiB3aGlsZSByZWFkaW5lc3MgaXMgcGVuZGluZyB3aW5zOiB0aGlzXG4gICAqIG9wZXJhdGlvbiB3YWl0cyBmb3IgdGhhdCBjbG9zZSwgY3JlYXRlcyB0aGUgbmV4dCBnZW5lcmF0aW9uLCByZWFkaWVzIGl0LFxuICAgKiBhbmQgcmV0dXJucyBvbmx5IHRoYXQgbGl2ZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYnNBZGFwdGVyPn0gLSBFeGFjdCByZWFkeSBhZGFwdGVyIGdlbmVyYXRpb24uXG4gICAqL1xuICBhc3luYyBhY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IGRhdGFiYXNlQ2xvc2VQcm9taXNlID0gdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuXG4gICAgICBpZiAoZGF0YWJhc2VDbG9zZVByb21pc2UpIHtcbiAgICAgICAgYXdhaXQgZGF0YWJhc2VDbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhpcy5nZXRCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cblxuICAgICAgaWYgKCFnZW5lcmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBnZW5lcmF0aW9uIHdhcyBub3QgY3JlYXRlZFwiKVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zaW5nKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgfHwgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGdlbmVyYXRpb24uYWRhcHRlci5lbnN1cmVSZWFkeSgpXG4gICAgICB9KVxuXG4gICAgICBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9IHJlYWR5UHJvbWlzZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZWFkeVByb21pc2VcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zaW5nKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gIT09IGdlbmVyYXRpb24pIGNvbnRpbnVlXG5cbiAgICAgIHJldHVybiBnZW5lcmF0aW9uLmFkYXB0ZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVhZGllcyB0aGUgYWN0aXZlIGFkYXB0ZXIgb25jZSBwZXIgbGlmZWN5Y2xlLiBBIGZhaWxlZCBhdHRlbXB0IHJlbWFpbnMgcmV0cnlhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQmFja2dyb3VuZEpvYnNBZGFwdGVyUmVhZHkoKSB7XG4gICAgYXdhaXQgdGhpcy5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgaGVhbHRoIHdpdGhvdXQgcmVzb2x2aW5nIHBlcnNpc3RlbmNlIGluIG5vbi1kdXJhYmxlIGlubGluZSBtb2RlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0hlYWx0aD59IC0gQ3VycmVudCBoZWFsdGguXG4gICAqL1xuICBhc3luYyBiYWNrZ3JvdW5kSm9ic0hlYWx0aCgpIHtcbiAgICBpZiAodGhpcy5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLm1vZGUgPT09IFwiaW5saW5lXCIpIHJldHVybiB7cmVhZHk6IHRydWV9XG5cbiAgICBjb25zdCBhZGFwdGVyID0gYXdhaXQgdGhpcy5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFkYXB0ZXIuaGVhbHRoKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgdGhlIHJlc29sdmVkIGFkYXB0ZXIgb25jZSBhbmQgY2xlYXJzIGxpZmVjeWNsZSBjYWNoZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNsb3NlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cblxuICAgIGlmICghZ2VuZXJhdGlvbikgcmV0dXJuXG4gICAgaWYgKGdlbmVyYXRpb24uY2xvc2VQcm9taXNlKSByZXR1cm4gYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcblxuICAgIGdlbmVyYXRpb24uY2xvc2luZyA9IHRydWVcbiAgICBjb25zdCBjbG9zZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgICAgY29uc3QgY2xvc2VFcnJvcnMgPSBbXVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGdlbmVyYXRpb24uYWRhcHRlci5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cblxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgY2xvc2VFcnJvcnNbMF1cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoY2xvc2VFcnJvcnMsIFwiRmFpbGVkIHRvIHJlYWR5IGFuZCBjbG9zZSB0aGUgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXJcIilcbiAgICB9KSgpXG5cbiAgICBnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSA9IGNsb3NlUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsb3NlUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9PT0gZ2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbn0gYmFja2dyb3VuZEpvYnMgLSBCYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEJhY2tncm91bmRKb2JzQ29uZmlnKGJhY2tncm91bmRKb2JzKSB7XG4gICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gJiYgYmFja2dyb3VuZEpvYnMuYWRhcHRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVwbGFjZSBiYWNrZ3JvdW5kSm9icy5hZGFwdGVyIGR1cmluZyBhbiBhY3RpdmUgYWRhcHRlciBsaWZlY3ljbGU7IGNsb3NlIGl0IGZpcnN0XCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iYWNrZ3JvdW5kSm9icywgYmFja2dyb3VuZEpvYnMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGFjdGl2ZSBCZWFjb24gY29uZmlndXJhdGlvbi4gQmVhY29uIGlzIG9wdC1pbjogaXRcbiAgICogc3RheXMgZGlzYWJsZWQgdW5sZXNzIHRoZSBhcHAgcGFzc2VzIGBiZWFjb246IHtob3N0LCBwb3J0fWAgL1xuICAgKiBgYmVhY29uOiB7aW5Qcm9jZXNzOiB0cnVlfWAsIGNhbGxzIGBzZXRCZWFjb25Db25maWcoey4uLn0pYCwgb3JcbiAgICogc2V0cyB0aGUgYFZFTE9DSU9VU19CRUFDT05fSE9TVGAgLyBgVkVMT0NJT1VTX0JFQUNPTl9QT1JUYCBlbnYgdmFycy5cbiAgICogU2V0dGluZyBgZW5hYmxlZDogZmFsc2VgIGV4cGxpY2l0bHkgZGlzYWJsZXMgaXQgZXZlbiB3aGVuIGVudiB2YXJzXG4gICAqIGFyZSBwcmVzZW50ICh1c2VmdWwgZm9yIHRlc3RzKS4gV2hlbiBgaW5Qcm9jZXNzOiB0cnVlYCBpcyBzZXQsXG4gICAqIGVudi12YXIgaG9zdC9wb3J0IGFyZSBpZ25vcmVkIOKAlCBjb2RlLWxldmVsIGNvbmZpZyB3aW5zLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIGhvc3Q6IHN0cmluZywgcG9ydDogbnVtYmVyLCBwZWVyVHlwZT86IHN0cmluZywgaW5Qcm9jZXNzOiBib29sZWFuLCB1bnJlYWNoYWJsZVJlcG9ydE1zOiBudW1iZXJ9fSAtIEJlYWNvbiBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdHMgYXBwbGllZC5cbiAgICovXG4gIGdldEJlYWNvbkNvbmZpZygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmVhY29uIHx8IHt9XG4gICAgY29uc3QgaW5Qcm9jZXNzID0gY29uZmlndXJlZC5pblByb2Nlc3MgPT09IHRydWVcblxuICAgIGlmIChpblByb2Nlc3MgJiYgKGNvbmZpZ3VyZWQuaG9zdCB8fCB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQmVhY29uIGNvbmZpZ3VyYXRpb246IGBpblByb2Nlc3M6IHRydWVgIGlzIG11dHVhbGx5IGV4Y2x1c2l2ZSB3aXRoIGBob3N0YC9gcG9ydGAuIFVzZSBvbmUgb3IgdGhlIG90aGVyLlwiKVxuICAgIH1cblxuICAgIGNvbnN0IGVudkhvc3QgPSBpblByb2Nlc3MgPyB1bmRlZmluZWQgOiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQkVBQ09OX0hPU1RcbiAgICBjb25zdCBlbnZQb3J0UmF3ID0gaW5Qcm9jZXNzID8gdW5kZWZpbmVkIDogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JFQUNPTl9QT1JUXG4gICAgY29uc3QgZW52UG9ydCA9IGVudlBvcnRSYXcgPyBOdW1iZXIoZW52UG9ydFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBob3N0ID0gY29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3QgfHwgXCIxMjcuMC4wLjFcIlxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGNvbmZpZ3VyZWQucG9ydFxuICAgICAgOiAodHlwZW9mIGVudlBvcnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvcnQpID8gZW52UG9ydCA6IDczMzApXG5cbiAgICBsZXQgZW5hYmxlZFxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkLmVuYWJsZWQgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICBlbmFibGVkID0gY29uZmlndXJlZC5lbmFibGVkXG4gICAgfSBlbHNlIHtcbiAgICAgIGVuYWJsZWQgPSBCb29sZWFuKGluUHJvY2VzcyB8fCBjb25maWd1cmVkLmhvc3QgfHwgY29uZmlndXJlZC5wb3J0IHx8IGVudkhvc3QgfHwgZW52UG9ydClcbiAgICB9XG5cbiAgICBjb25zdCB1bnJlYWNoYWJsZVJlcG9ydE1zID0gcmVzb2x2ZUJlYWNvblVucmVhY2hhYmxlUmVwb3J0TXMoY29uZmlndXJlZC51bnJlYWNoYWJsZVJlcG9ydE1zKVxuXG4gICAgcmV0dXJuIHtlbmFibGVkLCBob3N0LCBwb3J0LCBwZWVyVHlwZTogY29uZmlndXJlZC5wZWVyVHlwZSwgaW5Qcm9jZXNzLCB1bnJlYWNoYWJsZVJlcG9ydE1zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJlYWNvbiBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJlYWNvbkNvbmZpZ3VyYXRpb259IGJlYWNvbiAtIEJlYWNvbiBjb25maWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QmVhY29uQ29uZmlnKGJlYWNvbikge1xuICAgIHRoaXMuX2JlYWNvbiA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2JlYWNvbiwgYmVhY29uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJlYWNvbiBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIGFjdGl2ZSBCZWFjb24gY2xpZW50LCBpZiBjb25uZWN0ZWQuXG4gICAqL1xuICBnZXRCZWFjb25DbGllbnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2JlYWNvbkNsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRoaXMgY29uZmlndXJhdGlvbidzIEJlYWNvbiBjbGllbnQgdG8gdGhlIGNvbmZpZ3VyZWRcbiAgICogYnJva2VyLCB3aXJpbmcgaW5jb21pbmcgYnJvYWRjYXN0cyB0byB0aGUgbG9jYWwgZGVsaXZlcnkgcGF0aCBzb1xuICAgKiBhbnkgd2Vic29ja2V0IHN1YnNjcmliZXJzIGluIHRoaXMgcHJvY2VzcyByZWNlaXZlIHRoZW0uIElkZW1wb3RlbnRcbiAgICog4oCUIHJlcGVhdCBjYWxscyByZXR1cm4gdGhlIHNhbWUgaW4tZmxpZ2h0IG9yIHJlc29sdmVkIHByb21pc2UuXG4gICAqXG4gICAqIFJldHVybnMgaW1tZWRpYXRlbHkgd2l0aCBgdW5kZWZpbmVkYCBpZiBCZWFjb24gaXMgbm90IGVuYWJsZWQuXG4gICAqXG4gICAqICoqTm9uLWJsb2NraW5nIGJ5IGRlc2lnbiAoVENQIG1vZGUpLioqIEZvciBicm9rZXItYmFja2VkIEJlYWNvbiwgdGhlXG4gICAqIHJldHVybmVkIHByb21pc2UgcmVzb2x2ZXMgYXMgc29vbiBhcyB0aGUgY2xpZW50IGlzIGNvbnN0cnVjdGVkIGFuZFxuICAgKiB0aGUgVENQIGNvbm5lY3QgaXMgbGF1bmNoZWQg4oCUIGl0IGRvZXMgKipub3QqKiB3YWl0IGZvciB0aGUgY29ubmVjdFxuICAgKiBoYW5kc2hha2UgdG8gY29tcGxldGUuIEEgYnJva2VyIHRoYXQgc2lsZW50bHkgZHJvcHMgU1lOc1xuICAgKiAoZmlyZXdhbGwvTkFDTCBEUk9QIHJ1bGVzKSB3b3VsZCBvdGhlcndpc2UgYmxvY2sgc3RhcnR1cCBvbiB0aGUgT1NcbiAgICogVENQIGNvbm5lY3QgdGltZW91dCAodGVucyBvZiBzZWNvbmRzKSwgd2hpY2ggY29udHJhZGljdHMgdGhlXG4gICAqIGRvY3VtZW50ZWQgXCJmYWxsIGJhY2sgdG8gbG9jYWwtb25seSBhbmQgcmVjb25uZWN0IGluIHRoZVxuICAgKiBiYWNrZ3JvdW5kXCIgY29udHJhY3QuIEluaXRpYWwtY29ubmVjdCBmYWlsdXJlcyBzdXJmYWNlXG4gICAqIGFzeW5jaHJvbm91c2x5IG9uIHRoZSBmcmFtZXdvcmstZXJyb3IgY2hhbm5lbCB2aWEgdGhlXG4gICAqIGBjb25uZWN0LWVycm9yYCBsaXN0ZW5lciByZWdpc3RlcmVkIGhlcmUuIENhbGxlcnMgdGhhdCBuZWVkIGFcbiAgICogZGV0ZXJtaW5pc3RpYyBwdWJsaXNoLXJlYWRpbmVzcyBib3VuZGFyeSBzaG91bGQgY2FsbFxuICAgKiBgZ2V0QmVhY29uQ2xpZW50KCk/LndhaXRGb3JSZWFkeSh7dGltZW91dE1zfSlgLlxuICAgKlxuICAgKiAqKkluLXByb2Nlc3MgbW9kZSoqIGF3YWl0cyBgY29ubmVjdCgpYCDigJQgdGhhdCBwYXRoIGlzIHN5bmNocm9ub3VzLFxuICAgKiBjYW5ub3QgZmFpbCwgYW5kIGdpdmVzIGNhbGxlcnMgcHJlZGljdGFibGUgcmVhZGluZXNzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnBlZXJUeXBlXSAtIE92ZXJyaWRlIHBlZXJUeXBlIGZvciB0aGlzIGNvbm5lY3QgY2FsbCAoZS5nLiBgXCJzZXJ2ZXJcImAsIGBcImJhY2tncm91bmQtam9icy13b3JrZXJcImApLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlZ2lzdGVyZWQgY2xpZW50IChUQ1AgbW9kZTogY29ubmVjdCBtYXkgc3RpbGwgYmUgaW4gZmxpZ2h0KSwgb3IgdW5kZWZpbmVkIHdoZW4gQmVhY29uIGlzIGRpc2FibGVkLlxuICAgKi9cbiAgYXN5bmMgY29ubmVjdEJlYWNvbih7cGVlclR5cGV9ID0ge30pIHtcbiAgICBpZiAodGhpcy5fYmVhY29uQ2xpZW50KSByZXR1cm4gdGhpcy5fYmVhY29uQ2xpZW50XG4gICAgaWYgKHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2VcblxuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QmVhY29uQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNsaWVudCA9IGF3YWl0IHRoaXMuX2NyZWF0ZUJlYWNvbkNsaWVudCh7XG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgcGVlclR5cGU6IHBlZXJUeXBlIHx8IGNvbmZpZy5wZWVyVHlwZVxuICAgICAgfSlcblxuICAgICAgY2xpZW50Lm9uQnJvYWRjYXN0KChtZXNzYWdlKSA9PiB7XG4gICAgICAgIC8vIFN5bmFwc2Utc3R5bGUgZmFuLW91dDogZGVsaXZlciBldmVyeSBicm9hZGNhc3Qgd2UgcmVjZWl2ZVxuICAgICAgICAvLyBmcm9tIHRoZSBidXMgdGhyb3VnaCB0aGUgbG9jYWwgZGVsaXZlcnkgcGF0aC4gRWNob2VzIG9mIG91clxuICAgICAgICAvLyBvd24gcHVibGlzaGVzIGZvbGxvdyB0aGUgc2FtZSBwYXRoIHNvIGV2ZXJ5IHBlZXIgc2VlcyB0aGVcbiAgICAgICAgLy8gc2FtZSBkZWxpdmVyeSBzZW1hbnRpY3MuXG4gICAgICAgIHRoaXMuX2RlbGl2ZXJCcm9hZGNhc3RGcm9tQmVhY29uKG1lc3NhZ2UpXG4gICAgICB9KVxuXG4gICAgICAvLyBCZWFjb24gY29ubmVjdC9kaXNjb25uZWN0IGJsaXBzIGFyZSBleHBlY3RlZCBkdXJpbmcgZGVwbG95cyAodGhlIGJyb2tlclxuICAgICAgLy8gcmVzdGFydHMpIGFuZCB0aGUgQmVhY29uQ2xpZW50IGF1dG8tcmVjb25uZWN0cyBpbiB0aGUgYmFja2dyb3VuZCwgc28gYVxuICAgICAgLy8gc2luZ2xlIHRyYW5zaWVudCBmYWlsdXJlIGlzIE5PVCByZXBvcnRlZC4gT25seSBhIHN1c3RhaW5lZCBvdXRhZ2UgKHN0aWxsXG4gICAgICAvLyBkb3duIGFmdGVyIGB1bnJlYWNoYWJsZVJlcG9ydE1zYCkgaXMgc3VyZmFjZWQgb24gdGhlIGZyYW1ld29yay1lcnJvclxuICAgICAgLy8gY2hhbm5lbDsgYSAocmUpY29ubmVjdCB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyBjbGVhcnMgaXQgc2lsZW50bHkuXG5cbiAgICAgIC8vIGBjb25uZWN0LWVycm9yYCBmaXJlcyB3aGVuIHRoZSAqaW5pdGlhbCogVENQL2hhbmRzaGFrZSBmYWlscy5cbiAgICAgIGNsaWVudC5vbihcImNvbm5lY3QtZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlOiBcImJlYWNvbi1jb25uZWN0XCIsIGVycm9yLCByZXBvcnRBZnRlck1zOiBjb25maWcudW5yZWFjaGFibGVSZXBvcnRNc30pXG4gICAgICB9KVxuXG4gICAgICAvLyBgZGlzY29ubmVjdGAgZmlyZXMgd2hlbiBhbiBlc3RhYmxpc2hlZCBjb25uZWN0aW9uIGRyb3BzLiBUaGUgcGF5bG9hZCBpc1xuICAgICAgLy8gdGhlIHVuZGVybHlpbmcgc29ja2V0IGVycm9yIGlmIHRoZXJlIHdhcyBvbmUsIG9yIGEgc3ludGhldGljXG4gICAgICAvLyBFcnJvcihcIkJlYWNvbiBicm9rZXIgZGlzY29ubmVjdGVkXCIpIG90aGVyd2lzZS5cbiAgICAgIGNsaWVudC5vbihcImRpc2Nvbm5lY3RcIiwgKHJlYXNvbikgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZTogXCJiZWFjb24tZGlzY29ubmVjdFwiLCBlcnJvcjogcmVhc29uLCByZXBvcnRBZnRlck1zOiBjb25maWcudW5yZWFjaGFibGVSZXBvcnRNc30pXG4gICAgICB9KVxuXG4gICAgICAvLyBgY29ubmVjdGAgZmlyZXMgb24gZXZlcnkgKHJlKWNvbm5lY3Q7IGNsZWFyIGFueSBwZW5kaW5nIG91dGFnZSBzdGF0ZSBzb1xuICAgICAgLy8gYSB0cmFuc2llbnQgYmxpcCB0aGF0IHJlY292ZXJzIHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93IHN0YXlzIHNpbGVudC5cbiAgICAgIGNsaWVudC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25VcCgpXG4gICAgICB9KVxuXG4gICAgICAvLyBSZWdpc3RlciB0aGUgY2xpZW50ICpiZWZvcmUqIGtpY2tpbmcgb2ZmIGNvbm5lY3Qgc28gc3Vic2VxdWVudFxuICAgICAgLy8gYGNvbm5lY3RCZWFjb24oKWAgY2FsbHMgcmV0dXJuIHRoaXMgc2FtZSBpbnN0YW5jZSBpbnN0ZWFkIG9mXG4gICAgICAvLyByYWNpbmcgdG8gY29uc3RydWN0IGEgc2Vjb25kIG9uZS5cbiAgICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IGNsaWVudFxuXG4gICAgICBpZiAoY29uZmlnLmluUHJvY2Vzcykge1xuICAgICAgICAvLyBJbi1wcm9jZXNzIGNvbm5lY3QgaXMgc3luY2hyb25vdXMsIGNhbm5vdCBmYWlsLCBhbmQgcmVzb2x2ZXNcbiAgICAgICAgLy8gYmVmb3JlIHRoaXMgYXdhaXQgeWllbGRzIOKAlCBjYWxsZXJzIGNhbiByZWx5IG9uXG4gICAgICAgIC8vIGBpc0Nvbm5lY3RlZCgpID09PSB0cnVlYCBpbW1lZGlhdGVseSBhZnRlciBgY29ubmVjdEJlYWNvbigpYC5cbiAgICAgICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRmlyZS1hbmQtZm9yZ2V0IHRoZSBUQ1AgY29ubmVjdC4gQXdhaXRpbmcgaGVyZSB3b3VsZCBibG9ja1xuICAgICAgICAvLyBzdGFydHVwIG9uIHRoZSBPUyBUQ1AgY29ubmVjdCB0aW1lb3V0ICg3NXMgZGVmYXVsdCBvbiBMaW51eClcbiAgICAgICAgLy8gd2hlbiB0aGUgYnJva2VyIHNpbGVudGx5IGRyb3BzIFNZTnMuIEZhaWx1cmVzIHN1cmZhY2VcbiAgICAgICAgLy8gYXN5bmNocm9ub3VzbHkgdmlhIHRoZSBgY29ubmVjdC1lcnJvcmAgbGlzdGVuZXIgcmVnaXN0ZXJlZFxuICAgICAgICAvLyBhYm92ZTsgdGhlIEJlYWNvbkNsaWVudCdzIHJlY29ubmVjdCBsb29wIGtlZXBzIHRyeWluZy5cbiAgICAgICAgdm9pZCBjbGllbnQuY29ubmVjdCgpLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBBbHJlYWR5IHJlcG9ydGVkIHZpYSBjb25uZWN0LWVycm9yIGFib3ZlLlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2xpZW50XG4gICAgfSkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgQmVhY29uIGNsaWVudCBtYXRjaGluZyB0aGUgY29uZmlndXJlZCBtb2RlLiBTcGxpdCBvdXQgc29cbiAgICogYGNvbm5lY3RCZWFjb25gIHN0YXlzIGZvY3VzZWQgb24gbGlmZWN5Y2xlIGFuZCBlcnJvciB3aXJpbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPFZlbG9jaW91c0NvbmZpZ3VyYXRpb25bXCJnZXRCZWFjb25Db25maWdcIl0+fSBhcmdzLmNvbmZpZyAtIFJlc29sdmVkIEJlYWNvbiBjb25maWcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBSZXNvbHZlZCBwZWVyIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdD59IC0gQmVhY29uIGNsaWVudC5cbiAgICovXG4gIGFzeW5jIF9jcmVhdGVCZWFjb25DbGllbnQoe2NvbmZpZywgcGVlclR5cGV9KSB7XG4gICAgLy8gUm91dGUgdGhyb3VnaCB0aGUgZW52aXJvbm1lbnQgaGFuZGxlciBzbyB0aGUgTm9kZS1vbmx5IGBub2RlOm5ldGBcbiAgICAvLyAvIGBub2RlOmNyeXB0b2AgZGVwcyBpbiB0aGUgQmVhY29uIGNsaWVudCBtb2R1bGVzIGRvbid0IGdldCBwdWxsZWRcbiAgICAvLyBpbnRvIGJyb3dzZXIgYnVuZGxlcy4gQnJvd3NlciBidW5kbGVzIHN0YXRpY2FsbHkgcmVhY2hcbiAgICAvLyBgQ29uZmlndXJhdGlvbmAgKHZpYSBgTG9nZ2VyYCk7IHB1dHRpbmcgdGhlIGR5bmFtaWNcbiAgICAvLyBgaW1wb3J0KFwiLi9iZWFjb24vLi4uXCIpYCBjYWxscyBoZXJlIHdvdWxkIHN0aWxsIGRyYWcgdGhvc2UgbW9kdWxlc1xuICAgIC8vIHRocm91Z2ggZXNidWlsZCdzIHN0YXRpYyBhbmFseXNpcy4gSGlkaW5nIHRoZSBpbXBvcnRzIGluc2lkZSB0aGVcbiAgICAvLyBOb2RlIGVudmlyb25tZW50IGhhbmRsZXIga2VlcHMgdGhlbSBvZmYgdGhlIGJyb3dzZXIgcGF0aCDigJRcbiAgICAvLyBicm93c2VyLWJ1bmRsZWQgYXBwcyBuZXZlciByZWFjaCBgZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS5qc2AuXG4gICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmIChjb25maWcuaW5Qcm9jZXNzKSB7XG4gICAgICBjb25zdCBJblByb2Nlc3NCZWFjb25DbGllbnQgPSBhd2FpdCBoYW5kbGVyLmxvYWRJblByb2Nlc3NCZWFjb25DbGllbnQoKVxuXG4gICAgICByZXR1cm4gbmV3IEluUHJvY2Vzc0JlYWNvbkNsaWVudCh7cGVlclR5cGV9KVxuICAgIH1cblxuICAgIGNvbnN0IEJlYWNvbkNsaWVudCA9IGF3YWl0IGhhbmRsZXIubG9hZEJlYWNvbkNsaWVudCgpXG5cbiAgICByZXR1cm4gbmV3IEJlYWNvbkNsaWVudCh7XG4gICAgICBob3N0OiBjb25maWcuaG9zdCxcbiAgICAgIHBvcnQ6IGNvbmZpZy5wb3J0LFxuICAgICAgcGVlclR5cGVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBCZWFjb24gY29ubmVjdC9kaXNjb25uZWN0IGZhaWx1cmUgd2l0aG91dCByZXBvcnRpbmcgaXQgaW1tZWRpYXRlbHkuXG4gICAqIFRoZSBCZWFjb25DbGllbnQgYXV0by1yZWNvbm5lY3RzLCBzbyBicmllZiBvdXRhZ2VzIChlLmcuIGEgZGVwbG95IHJlc3RhcnRpbmdcbiAgICogdGhlIGJyb2tlcikgYXJlIGV4cGVjdGVkOyBvbmx5IGlmIHRoZSBiZWFjb24gaXMgc3RpbGwgdW5yZWFjaGFibGUgYWZ0ZXJcbiAgICogYHJlcG9ydEFmdGVyTXNgIGlzIGEgc2luZ2xlIGZyYW1ld29yay1lcnJvciBzdXJmYWNlZCB2aWEgYF9yZXBvcnRCZWFjb25FcnJvcmAuXG4gICAqIEEgc3Vic2VxdWVudCBgY29ubmVjdGAgKHNlZSBgX2hhbmRsZUJlYWNvblVwYCkgY2FuY2VscyB0aGUgcGVuZGluZyByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCJ9IGFyZ3Muc3RhZ2UgLSBGYWlsdXJlIHN0YWdlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnJlcG9ydEFmdGVyTXMgLSBHcmFjZSB3aW5kb3cgYmVmb3JlIGEgc3VzdGFpbmVkIG91dGFnZSBpcyByZXBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQmVhY29uRG93bih7c3RhZ2UsIGVycm9yLCByZXBvcnRBZnRlck1zfSkge1xuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB7c3RhZ2UsIGVycm9yfVxuXG4gICAgLy8gQSByZXBvcnQgaXMgYWxyZWFkeSBwZW5kaW5nIG9yIGFscmVhZHkgc2VudCBmb3IgdGhpcyBvdXRhZ2Ug4oCUIGtlZXAgdGhlXG4gICAgLy8gbGF0ZXN0IGVycm9yIGJ1dCBkb24ndCBzdGFjayB0aW1lcnMgb3IgcmUtcmVwb3J0LlxuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lciB8fCB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcblxuICAgICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudD8uaXNDb25uZWN0ZWQoKSkge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25VcCgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IHRydWVcblxuICAgICAgaWYgKHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IpIHRoaXMuX3JlcG9ydEJlYWNvbkVycm9yKHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IpXG4gICAgfSwgcmVwb3J0QWZ0ZXJNcylcblxuICAgIC8vIERvbid0IGxldCB0aGUgZ3JhY2UgdGltZXIga2VlcCB0aGUgcHJvY2VzcyBhbGl2ZS5cbiAgICBpZiAodHlwZW9mIHRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRpbWVyLnVucmVmKClcblxuICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdGltZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgYmVhY29uLWRvd24gc3RhdGUgb24gYSAocmUpY29ubmVjdC4gQSBibGlwIHRoYXQgcmVjb3ZlcnMgd2l0aGluIHRoZVxuICAgKiBncmFjZSB3aW5kb3cgaXMgbmV2ZXIgcmVwb3J0ZWQ7IGlmIGEgc3VzdGFpbmVkIG91dGFnZSBoYWQgYWxyZWFkeSBiZWVuXG4gICAqIHJlcG9ydGVkLCB0aGUgc3RhdGUgcmVzZXRzIHNvIGEgZnV0dXJlIG91dGFnZSBjYW4gcmVwb3J0IGFnYWluLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVCZWFjb25VcCgpIHtcbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcilcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhIEJlYWNvbiBmYWlsdXJlIG9uIHRoZSBmcmFtZXdvcmsgZXJyb3IgY2hhbm5lbC4gTWlycm9yc1xuICAgKiB0aGUgcGF0dGVybiB1c2VkIGJ5IGByZXF1ZXN0LXJ1bm5lci5qc2AgZm9yIEhUVFAgZXJyb3JzLiBXaGVuIG5vXG4gICAqIGxpc3RlbmVyIGlzIGF0dGFjaGVkIHRvIGVpdGhlciBgZnJhbWV3b3JrLWVycm9yYCBvciBgYWxsLWVycm9yYCxcbiAgICogYWxzbyBzY2hlZHVsZXMgYW4gdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uIHNvIHByb2Nlc3MtbGV2ZWwgYnVnXG4gICAqIHJlcG9ydGVycyAod2hpY2ggc3Vic2NyaWJlIHRvIGB1bmhhbmRsZWRSZWplY3Rpb25gIGJ5IGRlZmF1bHQpIHBpY2tcbiAgICogdGhlIGZhaWx1cmUgdXAg4oCUIGFuZCBBTFNPIHdyaXRlcyBhIG9uZS1saW5lIHN1bW1hcnkgdG8gYHN0ZGVycmAgc29cbiAgICogdGhlIGZhaWx1cmUgaXNuJ3QgY29tcGxldGVseSBzaWxlbnQgb24gTm9kZSAyNCsgd2hlcmUgdGhlIGRlZmF1bHRcbiAgICogYmVoYXZpb3Igb2YgYHVuaGFuZGxlZFJlamVjdGlvbmAgaXMgdG8gdGVybWluYXRlIHRoZSBwcm9jZXNzLiBBblxuICAgKiBhcHAgdGhhdCBzZWVzIGl0cyBzZXJ2ZXIgc3VkZGVubHkgZXhpdCBuZWVkcyBhdCBsZWFzdCBvbmVcbiAgICogYnJlYWRjcnVtYiBpbiB0aGUgbG9ncyB0byBrbm93IEJlYWNvbiB3YXMgdGhlIGNhdXNlOyB0aGUgcHJldmlvdXNcbiAgICogYmVoYXZpb3IgbGVmdCBhIHN0YWNrLW9ubHkgY3Jhc2ggd2l0aCBubyBjb250ZXh0IHR5aW5nIGl0IGJhY2sgdG9cbiAgICogdGhlIGJyb2tlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1wiYmVhY29uLWNvbm5lY3RcIiB8IFwiYmVhY29uLWRpc2Nvbm5lY3RcIn0gYXJncy5zdGFnZSAtIEZhaWx1cmUgc3RhZ2UuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0QmVhY29uRXJyb3Ioe3N0YWdlLCBlcnJvcn0pIHtcbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuX2Vycm9yRXZlbnRzXG4gICAgY29uc3QgaGFzTGlzdGVuZXIgPSBlcnJvckV2ZW50cy5saXN0ZW5lckNvdW50KFwiZnJhbWV3b3JrLWVycm9yXCIpID4gMFxuICAgICAgfHwgZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImFsbC1lcnJvclwiKSA+IDBcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge3N0YWdlfSxcbiAgICAgIGVycm9yXG4gICAgfVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG5cbiAgICBpZiAoIWhhc0xpc3RlbmVyKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG5cblxuICAgICAgY29uc29sZS5lcnJvcihgW3ZlbG9jaW91cyBmcmFtZXdvcmstZXJyb3Igc3RhZ2U9JHtzdGFnZX1dICR7bWVzc2FnZX0g4oCUIHJlZ2lzdGVyIGEgbGlzdGVuZXIgdmlhIGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5vbihcImZyYW1ld29yay1lcnJvclwiLCDigKYpIHRvIHN1cHByZXNzIHRoaXMgc3RkZXJyIGZhbGxiYWNrYClcbiAgICAgIHZvaWQgUHJvbWlzZS5yZWplY3QoZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyB0aGUgYWN0aXZlIEJlYWNvbiBjbGllbnQgKGlmIGFueSkuIFNhZmUgdG8gY2FsbCBtdWx0aXBsZVxuICAgKiB0aW1lcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBkaXNjb25uZWN0QmVhY29uKCkge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuX2JlYWNvbkNsaWVudFxuXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UgPSB1bmRlZmluZWRcblxuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKVxuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IGZhbHNlXG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKGNsaWVudCkgYXdhaXQgY2xpZW50LmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSb3V0ZXMgYSBCZWFjb24tc291cmNlZCBicm9hZGNhc3QgdGhyb3VnaCB0aGUgc2FtZSBkZWxpdmVyeSBjb2RlXG4gICAqIHBhdGggYXMgYSBsb2NhbGx5LW9yaWdpbmF0ZWQgb25lLiBQcmVmZXJzIHRoZSB3b3JrZXJ0aHJlYWQtYXdhcmVcbiAgICogYGJyb2FkY2FzdFYyYCB3aGVuIGFuIEhUVFAgc2VydmVyIGlzIGhvc3Rpbmcgd29ya2VycywgYW5kIGZhbGxzXG4gICAqIGJhY2sgdG8gdGhlIHBlci1wcm9jZXNzIHN1YnNjcmlwdGlvbiBkaXNwYXRjaCBvdGhlcndpc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iZWFjb24vdHlwZXMuanNcIikuQmVhY29uQnJvYWRjYXN0TWVzc2FnZX0gbWVzc2FnZSAtIEJyb2FkY2FzdCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbihtZXNzYWdlKSB7XG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyKHtcbiAgICAgICAgY2hhbm5lbDogbWVzc2FnZS5jaGFubmVsLFxuICAgICAgICBicm9hZGNhc3RQYXJhbXM6IG1lc3NhZ2UuYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICBib2R5OiBtZXNzYWdlLmJvZHksXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXNcbiAgICAgIH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChtZXNzYWdlLmNoYW5uZWwsIG1lc3NhZ2UuYnJvYWRjYXN0UGFyYW1zLCBtZXNzYWdlLmJvZHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWQ+fSAtIFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGFzeW5jIGdldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKCkge1xuICAgIGlmICghdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0xvYWRlclR5cGUgfCB1bmRlZmluZWR9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzIC0gU2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKHNjaGVkdWxlZEJhY2tncm91bmRKb2JzKSB7XG4gICAgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgPSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1haWxlciBiYWNrZW5kLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk1haWxlckJhY2tlbmQgfCB1bmRlZmluZWR9IC0gTWFpbGVyIGJhY2tlbmQuXG4gICAqL1xuICBnZXRNYWlsZXJCYWNrZW5kKCkge1xuICAgIHJldHVybiB0aGlzLl9tYWlsZXJCYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbWFpbGVyIGJhY2tlbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk1haWxlckJhY2tlbmQgfCB1bmRlZmluZWR9IG1haWxlckJhY2tlbmQgLSBNYWlsZXIgYmFja2VuZCwgb3IgdW5kZWZpbmVkIHRvIHJlbW92ZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TWFpbGVyQmFja2VuZChtYWlsZXJCYWNrZW5kKSB7XG4gICAgdGhpcy5fbWFpbGVyQmFja2VuZCA9IG1haWxlckJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dnaW5nIGNvbmZpZ3VyYXRpb24gdGFpbG9yZWQgZm9yIEhUVFAgcmVxdWVzdCBsb2dnaW5nLiBEZWZhdWx0cyBjb25zb2xlIGxvZ2dpbmcgdG8gdHJ1ZSBhbmQgYXBwbGllcyB0aGUgdXNlciBgbG9nZ2luZy5jb25zb2xlYCBmbGFnIG9ubHkgZm9yIHJlcXVlc3QgbG9nZ2luZy5cbiAgICogQHJldHVybnMge1JlcXVpcmVkPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImNvbnNvbGVcIiB8IFwiZmlsZVwiIHwgXCJsZXZlbHNcIj4+ICYgUGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiZGlyZWN0b3J5XCIgfCBcImZpbGVQYXRoXCI+ICYgUGFydGlhbDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJvdXRwdXRzXCIgfCBcImxvZ2dlcnNcIj4+fSAtIFRoZSBodHRwIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBMb2dnaW5nQ29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRMb2dnaW5nQ29uZmlndXJhdGlvbih7ZGVmYXVsdENvbnNvbGU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Vudmlyb25tZW50LWhhbmRsZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZW52aXJvbm1lbnQgaGFuZGxlci5cbiAgICovXG4gIGdldEVudmlyb25tZW50SGFuZGxlcigpIHtcbiAgICBpZiAoIXRoaXMuX2Vudmlyb25tZW50SGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gZW52aXJvbm1lbnQgaGFuZGxlciBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvY2FsZUZhbGxiYWNrc1R5cGUgfCB1bmRlZmluZWR9IC0gVGhlIGxvY2FsZSBmYWxsYmFja3MuXG4gICAqL1xuICBnZXRMb2NhbGVGYWxsYmFja3MoKSB7IHJldHVybiB0aGlzLmxvY2FsZUZhbGxiYWNrcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvY2FsZSBmYWxsYmFja3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvY2FsZUZhbGxiYWNrc1R5cGV9IG5ld0xvY2FsZUZhbGxiYWNrcyAtIE5ldyBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRMb2NhbGVGYWxsYmFja3MobmV3TG9jYWxlRmFsbGJhY2tzKSB7IHRoaXMubG9jYWxlRmFsbGJhY2tzID0gbmV3TG9jYWxlRmFsbGJhY2tzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3RydWN0dXJlIHNxbCBjb25maWcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU3RydWN0dXJlU3FsQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBTdHJ1Y3R1cmUgU1FMIGNvbmZpZy5cbiAgICovXG4gIGdldFN0cnVjdHVyZVNxbENvbmZpZygpIHsgcmV0dXJuIHRoaXMuX3N0cnVjdHVyZVNxbCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIHdyaXRlIHN0cnVjdHVyZSBzcWwuXG4gICAqIEBwYXJhbSB7e3JlYXNvbj86IFwibWlncmF0aW9uXCIgfCBcInNjaGVtYUR1bXBcIn19IFthcmdzXSAtIENhbGwgY29udGV4dCBmb3IgdGhlIHN0cnVjdHVyZSBzcWwgd3JpdGUgZGVjaXNpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3RydWN0dXJlIFNRTCBmaWxlcyBzaG91bGQgYmUgZ2VuZXJhdGVkIGZvciB0aGUgY3VycmVudCBlbnZpcm9ubWVudC5cbiAgICovXG4gIHNob3VsZFdyaXRlU3RydWN0dXJlU3FsKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtyZWFzb24gPSBcIm1pZ3JhdGlvblwifSA9IGFyZ3NcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldFN0cnVjdHVyZVNxbENvbmZpZygpXG4gICAgY29uc3QgZW5hYmxlZEVudmlyb25tZW50cyA9IGNvbmZpZz8uZW5hYmxlZEVudmlyb25tZW50c1xuICAgIGNvbnN0IGRpc2FibGVkRW52aXJvbm1lbnRzID0gY29uZmlnPy5kaXNhYmxlZEVudmlyb25tZW50c1xuXG4gICAgaWYgKHJlYXNvbiA9PT0gXCJzY2hlbWFEdW1wXCIpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZW5hYmxlZEVudmlyb25tZW50cykpIHtcbiAgICAgIHJldHVybiBlbmFibGVkRW52aXJvbm1lbnRzLmluY2x1ZGVzKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShkaXNhYmxlZEVudmlyb25tZW50cykgJiYgZGlzYWJsZWRFbnZpcm9ubWVudHMuaW5jbHVkZXModGhpcy5nZXRFbnZpcm9ubWVudCgpKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCIpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc3RydWN0dXJlIHNxbCBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlN0cnVjdHVyZVNxbENvbmZpZ3VyYXRpb259IHN0cnVjdHVyZVNxbCAtIFN0cnVjdHVyZSBTUUwgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRTdHJ1Y3R1cmVTcWxDb25maWcoc3RydWN0dXJlU3FsKSB7XG4gICAgdGhpcy5fc3RydWN0dXJlU3FsID0gc3RydWN0dXJlU3FsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBsb2NhbGUuXG4gICAqL1xuICBnZXRMb2NhbGUoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLmxvY2FsZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvY2FsZSgpXG4gICAgfSBlbHNlIGlmICh0aGlzLmxvY2FsZSkge1xuICAgICAgcmV0dXJuIHRoaXMubG9jYWxlXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLmdldExvY2FsZXMoKVswXVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGVzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gLSBUaGUgbG9jYWxlcy5cbiAgICovXG4gIGdldExvY2FsZXMoKSB7IHJldHVybiBkaWdnKHRoaXMsIFwibG9jYWxlc1wiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBUaGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzKG5hbWUpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5tb2RlbENsYXNzZXNbbmFtZV1cblxuICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIG1vZGVsIGNsYXNzICR7bmFtZX0gaW4gJHtPYmplY3Qua2V5cyh0aGlzLm1vZGVsQ2xhc3Nlcykuam9pbihcIiwgXCIpfX1gKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzc2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBBIGhhc2ggb2YgYWxsIG1vZGVsIGNsYXNzZXMsIGtleWVkIGJ5IG1vZGVsIG5hbWUsIGFzIHRoZXkgd2VyZSBkZWZpbmVkIGluIHRoZSBjb25maWd1cmF0aW9uLiBUaGlzIGlzIGEgZGlyZWN0IHJlZmVyZW5jZSB0byB0aGUgbW9kZWwgY2xhc3Nlcywgbm90IGEgY29weS5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3NlcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0aW5nLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBUaGUgcGF0aCB0byBhIGNvbmZpZyBmaWxlIHRoYXQgc2hvdWxkIGJlIHVzZWQgZm9yIHRlc3RpbmcuXG4gICAqL1xuICBnZXRUZXN0aW5nKCkgeyByZXR1cm4gdGhpcy5fdGVzdGluZyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRydXN0ZWQgcHJveGllcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSBUcnVzdGVkIHJldmVyc2UgcHJveHkgYWRkcmVzcyByYW5nZXMuXG4gICAqL1xuICBnZXRUcnVzdGVkUHJveGllcygpIHsgcmV0dXJuIHRoaXMuX3RydXN0ZWRQcm94aWVzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJ1c3RlZCBwcm94aWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSB0cnVzdGVkUHJveGllcyAtIFRydXN0ZWQgcmV2ZXJzZSBwcm94eSBhZGRyZXNzIHJhbmdlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRUcnVzdGVkUHJveGllcyh0cnVzdGVkUHJveGllcykgeyB0aGlzLl90cnVzdGVkUHJveGllcyA9IHRydXN0ZWRQcm94aWVzIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIGRhdGFiYXNlIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbaWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyIHRvIGluaXRpYWxpemUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGluaXRpYWxpemVEYXRhYmFzZVBvb2woaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyAnZGF0YWJhc2UnIHdhcyBnaXZlblwiKVxuICAgIGlmICh0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0pIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlUG9vbCBoYXMgYWxyZWFkeSBiZWVuIGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBQb29sVHlwZSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sVHlwZShpZGVudGlmaWVyKVxuXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdID0gbmV3IFBvb2xUeXBlKHtjb25maWd1cmF0aW9uOiB0aGlzLCBpZGVudGlmaWVyfSlcbiAgICB0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0uc2V0Q3VycmVudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBwb29sIGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2lkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllciB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBwb29sIGluaXRpYWxpemVkLlxuICAgKi9cbiAgaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHsgcmV0dXJuIEJvb2xlYW4odGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgaW5pdGlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBpc0luaXRpYWxpemVkKCkgeyByZXR1cm4gdGhpcy5faXNJbml0aWFsaXplZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBtb2RlbHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplTW9kZWxzKGFyZ3MgPSB7dHlwZTogXCJzZXJ2ZXJcIn0pIHtcbiAgICBjb25zdCBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICBpZiAodGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgY29uc3QgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgICBhd2FpdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IG1vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICYmICF0aGlzLl9tb2RlbHNJbml0aWFsaXplZCkge1xuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPT09IGluaXRpYWxpemVNb2RlbHNQcm9taXNlKSB7XG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmluaXRpYWxpemVNb2RlbHMoYXJncylcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc2hvdWxkU2tpcER1bW15TW9kZWxJbml0aWFsaXphdGlvbiA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52LlZFTE9DSU9VU19TS0lQX0RVTU1ZX01PREVMX0lOSVRJQUxJWkFUSU9OID09PSBcIjFcIlxuICAgICAgICAmJiBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfQlJPV1NFUl9URVNUUyA9PT0gXCJ0cnVlXCJcbiAgICAgICAgJiYgdGhpcy5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIlxuXG4gICAgICBpZiAoIXNob3VsZFNraXBEdW1teU1vZGVsSW5pdGlhbGl6YXRpb24pIHtcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHMpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplTW9kZWxzKHtjb25maWd1cmF0aW9uOiB0aGlzLCB0eXBlOiBhcmdzLnR5cGV9KVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbml0aWFsaXplUGFja2FnZU1vZGVscyh0aGlzKVxuICAgICAgICBhd2FpdCBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyh0aGlzKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW5pdGlhbGl6ZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzKHRoaXMpXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBlYWNoIGNvbmZpZ3VyZWQgZGF0YWJhc2UgcG9vbCBoYXMgYSBnbG9iYWwgY29ubmVjdGlvbiBhdmFpbGFibGUuXG4gICAqIFVzZWZ1bCB3aGVuIGBnZXRDdXJyZW50Q29ubmVjdGlvbmAgbWlnaHQgYmUgY2FsbGVkIHdpdGhvdXQgYW4gYXN5bmMgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUdsb2JhbENvbm5lY3Rpb25zKCkge1xuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIGF3YWl0IHBvb2wuZW5zdXJlR2xvYmFsQ29ubmVjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFR5cGUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGluaXRpYWxpemUoe3R5cGV9ID0ge3R5cGU6IFwidW5kZWZpbmVkXCJ9KSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlKSByZXR1cm4gdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogdHJ1ZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5fc2h1dGRvd25Qcm9taXNlfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiBmYWxzZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIG9yIGpvaW5zIGluaXRpYWxpemF0aW9uIGFmdGVyIGxpZmVjeWNsZSBibG9ja2VycyBoYXZlIHNldHRsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU3RhcnR1cCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gR2VuZXJpYyBhcHBsaWNhdGlvbiBwcm9jZXNzIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBzdGFydHVwIHByb21pc2UuXG4gICAqL1xuICBfYmVnaW5Jbml0aWFsaXplKHt0eXBlfSkge1xuICAgIGNvbnN0IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiBmYWxzZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5faW5pdGlhbGl6ZVByb21pc2V9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pc0luaXRpYWxpemVkKSB7XG4gICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgICAgcmV0dXJuIHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgfVxuICAgIC8vIE1lbW9pemUgdGhlIGluLXByb2dyZXNzIGluaXRpYWxpemF0aW9uIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGUgc2FtZVxuICAgIC8vIGJvb3RzdHJhcCBpbnN0ZWFkIG9mIHJhY2luZy4gYF9pc0luaXRpYWxpemVkYCB3YXMgcHJldmlvdXNseSBzZXQgdG8gYHRydWVgXG4gICAgLy8gdXAgZnJvbnQsIHNvIGEgc2Vjb25kIGNhbGxlciAoZS5nLiBhIHBvb2xlZCBydW5uZXIgd2l0aFxuICAgIC8vIGBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+IDFgIHN0YXJ0aW5nIHNldmVyYWwgam9icyBvbiBhIGNvbGQgY2hpbGQpIGNvdWxkXG4gICAgLy8gc2tpcCBpbml0aWFsaXphdGlvbiBhbmQgbG9hZCBtb2RlbHMgLyBwZXJmb3JtIGEgam9iIHdoaWxlIHRoZSBmaXJzdCBjYWxsXG4gICAgLy8gd2FzIHN0aWxsIGF3YWl0aW5nIG1vZGVsIGRpc2NvdmVyeSBhbmQgaW5pdGlhbGl6ZXJzLiBNaXJyb3JzIGNvbm5lY3RCZWFjb24uXG4gICAgY29uc3QgaW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9ydW5Jbml0aWFsaXplKHtpbml0aWFsaXphdGlvbkdlbmVyYXRpb24sIHR5cGV9KVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSBpbml0aWFsaXplUHJvbWlzZVxuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgcmV0dXJuIGluaXRpYWxpemVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIG9uZSBzaGFyZWQgaW5pdGlhbGl6YXRpb24gYmVoaW5kIGFuIGluY29tcGF0aWJsZSBsaWZlY3ljbGUgcGhhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSAtIFdoZXRoZXIgYSBjb21wbGV0ZWQgZmFpbGVkIHNodXRkb3duIHN0aWxsIHBlcm1pdHMgcmVwbGFjZW1lbnQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFJlcGxhY2VtZW50IHByb2Nlc3MgdHlwZS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBhcmdzLndhaXRGb3IgLSBMaWZlY3ljbGUgcGhhc2UgdGhhdCBtdXN0IHNldHRsZSBmaXJzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2hhcmVkIHF1ZXVlZCBzdGFydHVwIHByb21pc2UuXG4gICAqL1xuICBfcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHR5cGUsIHdhaXRGb3J9KSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlKSByZXR1cm4gdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIGNvbnN0IHF1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB3YWl0Rm9yfSlcblxuICAgICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSA9PT0gd2FpdEZvcikgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IHdhaXRGb3IpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNodXRkb3duUHJvbWlzZSA9IHRoaXMuX3NodXRkb3duUHJvbWlzZVxuXG4gICAgICBpZiAoc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiB0cnVlLCB3YWl0Rm9yOiBzaHV0ZG93blByb21pc2V9KVxuICAgICAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlID09PSBzaHV0ZG93blByb21pc2UpIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uICE9PSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICBjb25zdCBzdGFsZUluaXRpYWxpemVQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcblxuICAgICAgICBhd2FpdCBzdGFsZUluaXRpYWxpemVQcm9taXNlXG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gc3RhbGVJbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fYmVnaW5Jbml0aWFsaXplKHt0eXBlfSlcbiAgICB9KSgpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuXG4gICAgcmV0dXJuIHF1ZXVlZEluaXRpYWxpemVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGEgbGlmZWN5Y2xlIHBoYXNlIGJlZm9yZSBxdWV1ZWQgaW5pdGlhbGl6YXRpb24gcHJvY2VlZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2FpdCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jb250aW51ZUFmdGVyV2FpdEZhaWx1cmUgLSBXaGV0aGVyIHJlcGxhY2VtZW50IHN0YXJ0dXAgcmVtYWlucyBhdmFpbGFibGUgYWZ0ZXIgYSBmYWlsZWQgcGhhc2UuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gYXJncy53YWl0Rm9yIC0gTGlmZWN5Y2xlIHBoYXNlIHRoYXQgbXVzdCBzZXR0bGUgZmlyc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcXVldWVkIGluaXRpYWxpemF0aW9uIG1heSBjb250aW51ZS5cbiAgICovXG4gIGFzeW5jIF93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgd2FpdEZvcn0pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd2FpdEZvclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIWNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgYXRvbWljIGZyYW1ld29yayBhbmQgYXBwbGljYXRpb24gaW5pdGlhbGl6YXRpb24gYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbml0aWFsaXphdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uIC0gRnJhbWV3b3JrIG1vZGVsIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBHZW5lcmljIGFwcGxpY2F0aW9uIHByb2Nlc3MgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBpbml0aWFsaXplZC5cbiAgICovXG4gIGFzeW5jIF9ydW5Jbml0aWFsaXplKHtpbml0aWFsaXphdGlvbkdlbmVyYXRpb24sIHR5cGV9KSB7XG4gICAgY29uc3Qgc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUgPSAhdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZFxuXG4gICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB7XG4gICAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICAgIGluc3RhbmNlSWQ6IG5ldyBVVUlEKDQpLmZvcm1hdCgpLFxuICAgICAgICB0eXBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemVNb2RlbHMoe3R5cGV9KVxuXG4gICAgICAvLyBNb2RlbCBpbml0aWFsaXphdGlvbiBjYW4gYmUgaW52YWxpZGF0ZWQgYnkgYSBjb25jdXJyZW50IGNvbm5lY3Rpb24gY2xvc2UuXG4gICAgICAvLyBJZiBtb2RlbHMgYXJlIG5vdCByZWFkeSwgc3RvcCB3aXRob3V0IG1hcmtpbmcgdGhlIGNvbmZpZ3VyYXRpb24gaW5pdGlhbGl6ZWRcbiAgICAgIC8vIHNvIHRoZSBuZXh0IGNhbGxlciByZXRyaWVzIGEgZnVsbCBib290c3RyYXAuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gIT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiB8fCAhdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuYXV0b0Rpc2NvdmVyUmVzb3VyY2VzKHRoaXMpXG4gICAgICB0aGlzLl9tZXJnZURpc2NvdmVyZWRBYmlsaXR5UmVzb3VyY2VzKClcbiAgICAgIHRoaXMuX3ZhbGlkYXRlUmVzb3VyY2VSZWxhdGlvbnNoaXBzT25Nb2RlbHMoKVxuXG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUgJiYgdGhpcy5faW5pdGlhbGl6ZXJzKSB7XG4gICAgICAgIGNvbnN0IGluaXRpYWxpemVycyA9IGF3YWl0IHRoaXMuX2luaXRpYWxpemVycyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgICAgIGNvbnN0IHtyZXF1aXJlQ29udGV4dCwgLi4ucmVzdEFyZ3N9ID0gaW5pdGlhbGl6ZXJzXG5cbiAgICAgICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgICAgICBpZiAocmVxdWlyZUNvbnRleHQpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGluaXRpYWxpemVyS2V5IG9mIHJlcXVpcmVDb250ZXh0LmtleXMoKSkge1xuICAgICAgICAgICAgY29uc3QgSW5pdGlhbGl6ZXJDbGFzcyA9IHJlcXVpcmVDb250ZXh0KGluaXRpYWxpemVyS2V5KS5kZWZhdWx0XG4gICAgICAgICAgICBjb25zdCBwcm9jZXNzQ29udGV4dCA9IHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHRcblxuICAgICAgICAgICAgaWYgKCFwcm9jZXNzQ29udGV4dCkgdGhyb3cgbmV3IEVycm9yKFwiQXBwbGljYXRpb24gcHJvY2VzcyBjb250ZXh0IGlzIG5vdCBhdmFpbGFibGUgZHVyaW5nIGluaXRpYWxpemVyIHN0YXJ0dXBcIilcblxuICAgICAgICAgICAgY29uc3QgaW5pdGlhbGl6ZXJJbnN0YW5jZSA9IG5ldyBJbml0aWFsaXplckNsYXNzKHtjb25maWd1cmF0aW9uOiB0aGlzLCBwcm9jZXNzQ29udGV4dCwgdHlwZX0pXG5cbiAgICAgICAgICAgIGF3YWl0IGluaXRpYWxpemVySW5zdGFuY2UucnVuKClcbiAgICAgICAgICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMucHVzaChpbml0aWFsaXplckluc3RhbmNlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWQgPSB0cnVlXG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkge1xuICAgICAgICBsZXQgdGVhcmRvd25FcnJvclxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKClcbiAgICAgICAgfSBjYXRjaCAoY2F1Z2h0VGVhcmRvd25FcnJvcikge1xuICAgICAgICAgIHRlYXJkb3duRXJyb3IgPSBjYXVnaHRUZWFyZG93bkVycm9yXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGVhcmRvd25FcnJvciBpbnN0YW5jZW9mIEFnZ3JlZ2F0ZUVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW2Vycm9yLCAuLi50ZWFyZG93bkVycm9yLmVycm9yc10sXG4gICAgICAgICAgICBcIkFwcGxpY2F0aW9uIHByb2Nlc3Mgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlYXJkb3duRXJyb3IgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgdGVhcmRvd25FcnJvcl0sXG4gICAgICAgICAgICBcIkFwcGxpY2F0aW9uIHByb2Nlc3Mgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNJbml0aWFsaXplZCAmJiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biBldmVyeSBzdWNjZXNzZnVsbHkgc3RhcnRlZCBpbml0aWFsaXplciBpbiByZXZlcnNlIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRlYXJkb3duIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpIHtcbiAgICBjb25zdCBzdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5zcGxpY2UoMCkucmV2ZXJzZSgpXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQXBwbGljYXRpb24gaW5pdGlhbGl6ZXIgdGVhcmRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5tYXAoKGluaXRpYWxpemVyKSA9PiBhc3luYyAoKSA9PiBhd2FpdCBpbml0aWFsaXplci50ZWFyZG93bigpKVxuICAgIH0pXG4gIH1cblxuICAvKiogQ2xlYXJzIGFwcGxpY2F0aW9uLW93bmVkIGxpZmVjeWNsZSBzdGF0ZSBhZnRlciBldmVyeSB0ZWFyZG93biBhdHRlbXB0LiAqL1xuICBfcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpIHtcbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycyA9IFtdXG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biB0aGUgY3VycmVudCBhcHBsaWNhdGlvbiBsaWZlY3ljbGUgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gRXhhY3Qgc2hhcmVkIHNodXRkb3duIHByb21pc2UuXG4gICAqL1xuICBzaHV0ZG93bigpIHtcbiAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlKSByZXR1cm4gdGhpcy5fc2h1dGRvd25Qcm9taXNlXG5cbiAgICBjb25zdCBpbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgY29uc3Qgc2h1dGRvd25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChpbml0aWFsaXplUHJvbWlzZSkgYXdhaXQgaW5pdGlhbGl6ZVByb21pc2VcbiAgICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKClcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSBpbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KSgpXG5cbiAgICB0aGlzLl9zaHV0ZG93blByb21pc2UgPSBzaHV0ZG93blByb21pc2VcblxuICAgIHJldHVybiBzaHV0ZG93blByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhhdCByZXNvdXJjZS1kZWZpbmVkIHJlbGF0aW9uc2hpcHMgYXJlIGFsc28gZGVmaW5lZCBvbiB0aGUgY29ycmVzcG9uZGluZyBtb2RlbCBjbGFzc2VzLlxuICAgKiBUaHJvd3MgYW4gZXJyb3IgaWYgYSByZWxhdGlvbnNoaXAgaXMgZGVmaW5lZCBvbiBhIHJlc291cmNlIGJ1dCBtaXNzaW5nIGZyb20gdGhlIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJlc291cmNlUmVsYXRpb25zaGlwc09uTW9kZWxzKCkge1xuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5fYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICAgIGZvciAoY29uc3QgW21vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZXMpKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlnPy5yZWxhdGlvbnNoaXBzKSBjb250aW51ZVxuXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBkZWZpbmVzIHJlbGF0aW9uc2hpcHMgYXMgYW4gb2JqZWN0LiBVc2UgYW4gYXJyYXkgaW5zdGVhZDogc3RhdGljIHJlbGF0aW9uc2hpcHMgPSAke0pTT04uc3RyaW5naWZ5KE9iamVjdC5rZXlzKHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUmVsYXRpb25zaGlwcyA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpXG5cbiAgICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgICBpZiAoIShyZWxhdGlvbnNoaXBOYW1lIGluIGV4aXN0aW5nUmVsYXRpb25zaGlwcykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYFJlc291cmNlIGZvciAke21vZGVsTmFtZX0gZGVmaW5lcyByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgYnV0ICR7bW9kZWxOYW1lfSBtb2RlbCBkb2VzIG5vdC4gYCArXG4gICAgICAgICAgICAgIGBBZGQgJHttb2RlbE5hbWV9LmJlbG9uZ3NUbyhcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiwgLi4uKSBvciB0aGUgYXBwcm9wcmlhdGUgcmVsYXRpb25zaGlwIGNhbGwgb24gdGhlIG1vZGVsIGNsYXNzLmBcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZWdpc3Rlck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWxDbGFzc2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldID0gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnQoKSB7XG4gICAgc2V0Q3VycmVudENvbmZpZ3VyYXRpb24odGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb3V0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSByb3V0ZXMuXG4gICAqL1xuICBnZXRSb3V0ZXMoKSB7IHJldHVybiB0aGlzLl9yb3V0ZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCByb3V0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdH0gbmV3Um91dGVzIC0gTmV3IHJvdXRlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Um91dGVzKG5ld1JvdXRlcykge1xuICAgIHRoaXMuX3JvdXRlcyA9IG5ld1JvdXRlc1xuICAgIHRoaXMuX2FwcGx5Um91dGVNb3VudHMobmV3Um91dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYW55IGByb3V0ZS5tb3VudCguLi4pYCByZWdpc3RyYXRpb25zIGZyb20gdGhlIHJvdXRlcyBmaWxlIGJ5IGxldHRpbmdcbiAgICogZWFjaCBtb3VudGFibGUgcmVnaXN0ZXIgaXRzIHJvdXRlcyAodHlwaWNhbGx5IHJvdXRlLXJlc29sdmVyIGhvb2tzKSBhZ2FpbnN0XG4gICAqIHRoaXMgY29uZmlndXJhdGlvbi4gR3VhcmRlZCBzbyByZXBlYXRlZCBzZXRSb3V0ZXMgY2FsbHMgd2l0aCB0aGUgc2FtZSByb3V0ZXNcbiAgICogZG9uJ3QgcmVnaXN0ZXIgYSBtb3VudCBtb3JlIHRoYW4gb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0fSBuZXdSb3V0ZXMgLSBSb3V0ZXMgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hcHBseVJvdXRlTW91bnRzKG5ld1JvdXRlcykge1xuICAgIGlmICghbmV3Um91dGVzIHx8IHR5cGVvZiBuZXdSb3V0ZXMuZ2V0TW91bnRzICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBtb3VudCBvZiBuZXdSb3V0ZXMuZ2V0TW91bnRzKCkpIHtcbiAgICAgIGlmICh0aGlzLl9hcHBsaWVkUm91dGVNb3VudHMuaGFzKG1vdW50KSkgY29udGludWVcblxuICAgICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzLmFkZChtb3VudClcbiAgICAgIG1vdW50Lm1vdW50YWJsZS5tb3VudEludG8oe2NvbmZpZ3VyYXRpb246IHRoaXMsIC4uLm1vdW50Lm9wdGlvbnN9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIHBsdWdpbi9saWJyYXJ5IHJvdXRlcyB1c2luZyBhIGxpZ2h0d2VpZ2h0IHJvdXRlIERTTCBiYWNrZWQgYnkgcm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqIEBwYXJhbSB7KHJvdXRlczogaW1wb3J0KFwiLi9yb3V0ZXMvcGx1Z2luLXJvdXRlcy5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkfSBjYWxsYmFjayAtIFJvdXRlcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcm91dGVzKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcGx1Z2luUm91dGVzID0gbmV3IFBsdWdpblJvdXRlcyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG5cbiAgICBjYWxsYmFjayhwbHVnaW5Sb3V0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJhbnNsYXRvci5cbiAgICogQHBhcmFtIHsoYXJnMTogc3RyaW5nLCBhcmcyOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWQpID0+IHN0cmluZ30gY2FsbGJhY2sgLSBUcmFuc2xhdG9yIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUcmFuc2xhdG9yKGNhbGxiYWNrKSB7IHRoaXMuX3RyYW5zbGF0b3IgPSBjYWxsYmFjayB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbXNnSUQgLSBNc2cgaWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJnc10gLSBUcmFuc2xhdG9yIG9wdGlvbnMgYW5kIHZhcmlhYmxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKi9cbiAgX2RlZmF1bHRUcmFuc2xhdG9yKG1zZ0lELCBhcmdzKSB7XG4gICAgdGhpcy5fY29uZmlndXJlRGVmYXVsdFRyYW5zbGF0b3IoKVxuXG4gICAgY29uc3QgdHJhbnNsYXRlQXJncyA9IGFyZ3MgPyB7Li4uYXJnc30gOiB1bmRlZmluZWRcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSB0cmFuc2xhdGVBcmdzPy5kZWZhdWx0VmFsdWVcbiAgICBjb25zdCBsb2NhbGVzID0gdHJhbnNsYXRlQXJncz8ubG9jYWxlc1xuXG4gICAgaWYgKHRyYW5zbGF0ZUFyZ3MpIHtcbiAgICAgIGRlbGV0ZSB0cmFuc2xhdGVBcmdzLmRlZmF1bHRWYWx1ZVxuICAgICAgZGVsZXRlIHRyYW5zbGF0ZUFyZ3MubG9jYWxlc1xuICAgIH1cblxuICAgIGNvbnN0IHZhcmlhYmxlcyA9IHRyYW5zbGF0ZUFyZ3MgJiYgT2JqZWN0LmtleXModHJhbnNsYXRlQXJncykubGVuZ3RoID4gMCA/IHRyYW5zbGF0ZUFyZ3MgOiB1bmRlZmluZWRcblxuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKClcbiAgICBjb25zdCBwcmVmZXJyZWRMb2NhbGVzID0gbG9jYWxlcyB8fCAobG9jYWxlID8gdW5kZWZpbmVkIDogW10pXG4gICAgY29uc3QgbWVzc2FnZSA9IHRyYW5zbGF0ZShtc2dJRCwgdmFyaWFibGVzLCBwcmVmZXJyZWRMb2NhbGVzKVxuXG4gICAgaWYgKG1lc3NhZ2UgPT09IG1zZ0lEICYmIGRlZmF1bHRWYWx1ZSkgcmV0dXJuIHRyYW5zbGF0ZShkZWZhdWx0VmFsdWUsIHZhcmlhYmxlcywgW10pXG5cbiAgICByZXR1cm4gbWVzc2FnZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0b3IuXG4gICAqIEByZXR1cm5zIHsobXNnSUQ6IHN0cmluZywgYXJncz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gc3RyaW5nfSAtIFRoZSBjb25maWd1cmVkIHRyYW5zbGF0b3IuXG4gICAqL1xuICBnZXRUcmFuc2xhdG9yKCkge1xuICAgIGlmICh0aGlzLl90cmFuc2xhdG9yKSByZXR1cm4gdGhpcy5fdHJhbnNsYXRvclxuXG4gICAgaWYgKCF0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kKSB7XG4gICAgICB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kID0gdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3IuYmluZCh0aGlzKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmUgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBDb25maWd1cmUgZ2V0dGV4dCBkZWZhdWx0cyBmb3IgdGhpcyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX2NvbmZpZ3VyZURlZmF1bHRUcmFuc2xhdG9yKCkge1xuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKClcblxuICAgIGdldHRleHRDb25maWcuc2V0TG9jYWxlKGxvY2FsZSB8fCBcIlwiKVxuXG4gICAgY29uc3QgZmFsbGJhY2tzID0gbG9jYWxlID8gdGhpcy5nZXRMb2NhbGVGYWxsYmFja3MoKT8uW2xvY2FsZV0gOiBbXVxuXG4gICAgZ2V0dGV4dENvbmZpZy5zZXRGYWxsYmFja3MoZmFsbGJhY2tzIHx8IFtdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lIG9mZnNldCBtaW51dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRoZSB0aW1lem9uZSBvZmZzZXQgaW4gbWludXRlcy5cbiAgICovXG4gIGdldFRpbWV6b25lT2Zmc2V0TWludXRlcygpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjb25zdCBjb25maWd1cmVkT2Zmc2V0ID0gdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzKClcblxuICAgICAgaWYgKHR5cGVvZiBjb25maWd1cmVkT2Zmc2V0ID09PSBcIm51bWJlclwiKSByZXR1cm4gY29uZmlndXJlZE9mZnNldFxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VGltZXpvbmVPZmZzZXQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWUgem9uZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXRUaW1lWm9uZSgpIHtcbiAgICBjb25zdCB0aW1lWm9uZSA9IHR5cGVvZiB0aGlzLl90aW1lWm9uZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3RpbWVab25lKClcbiAgICAgIDogdGhpcy5fdGltZVpvbmVcblxuICAgIGlmICh0aW1lWm9uZSA9PT0gdW5kZWZpbmVkIHx8IHRpbWVab25lID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJjb25maWd1cmF0aW9uIHRpbWVab25lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWV2ZW50cy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0RXZlbnRzKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWV2ZW50cy5qc1wiKS5kZWZhdWx0fSB3ZWJzb2NrZXRFdmVudHMgLSBXZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRXZWJzb2NrZXRFdmVudHMod2Vic29ja2V0RXZlbnRzKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0RXZlbnRzID0gd2Vic29ja2V0RXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUGVyLXByb2Nlc3MgcmVnaXN0cnkgb2YgY2hhbm5lbCBzdWJzY3JpYmVycyB1c2VkIGJ5IHdvcmtlciBjb2RlIHRoYXRcbiAgICogbmVlZHMgdG8gcmVhY3QgdG8gZXZlbnRzIGJyb2FkY2FzdCB2aWEgYHdlYnNvY2tldEV2ZW50c0hvc3QucHVibGlzaCguLi4pYFxuICAgKiB3aXRob3V0IGhvbGRpbmcgYW4gYWN0dWFsIHdlYnNvY2tldCBzZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpYmVycy5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjaGFubmVsIHN1YnNjcmliZXJzIHJlZ2lzdHJ5LlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKCkge1xuICAgIGlmICghdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKSB7XG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgPSBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGBWZWxvY2lvdXNXZWJzb2NrZXRDb25uZWN0aW9uYCBzdWJjbGFzcyB1bmRlciBhIG5hbWUuXG4gICAqIENsaWVudHMgdGhhdCBzZW5kIGB7dHlwZTogXCJjb25uZWN0aW9uLW9wZW5cIiwgY29ubmVjdGlvblR5cGU6IG5hbWV9YFxuICAgKiB3aWxsIGhhdmUgdGhpcyBjbGFzcyBpbnN0YW50aWF0ZWQgZm9yIHRoZWlyIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2xpZW50LWZhY2luZyBjb25uZWN0aW9uIHR5cGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0fSBDb25uZWN0aW9uQ2xhc3MgLSBXZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlcldlYnNvY2tldENvbm5lY3Rpb24obmFtZSwgQ29ubmVjdGlvbkNsYXNzKSB7XG4gICAgaWYgKCFuYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25uZWN0aW9uIG5hbWUgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIUNvbm5lY3Rpb25DbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbkNsYXNzIGlzIHJlcXVpcmVkXCIpXG4gICAgdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMuc2V0KG5hbWUsIENvbm5lY3Rpb25DbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25uZWN0aW9uIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBSZWdpc3RlcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMuZ2V0KG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxgIHN1YmNsYXNzIHVuZGVyIGEgbmFtZS5cbiAgICogQ2xpZW50cyBzdWJzY3JpYmUgdmlhIGB7dHlwZTogXCJjaGFubmVsLXN1YnNjcmliZVwiLCBjaGFubmVsVHlwZTogbmFtZSwgLi4ufWAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2xpZW50LWZhY2luZyBjaGFubmVsIHR5cGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBDaGFubmVsQ2xhc3MgLSBXZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICogQHBhcmFtIHt7bGl2ZU9ubHk/OiBib29sZWFufX0gW29wdGlvbnNdIC0gUmVnaXN0cmF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsKG5hbWUsIENoYW5uZWxDbGFzcywge2xpdmVPbmx5ID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAoIW5hbWUpIHRocm93IG5ldyBFcnJvcihcIkNoYW5uZWwgbmFtZSBpcyByZXF1aXJlZFwiKVxuICAgIGlmICghQ2hhbm5lbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJDaGFubmVsQ2xhc3MgaXMgcmVxdWlyZWRcIilcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5zZXQobmFtZSwgQ2hhbm5lbENsYXNzKVxuXG4gICAgaWYgKGxpdmVPbmx5KSB0aGlzLl9saXZlT25seVdlYnNvY2tldENoYW5uZWxzLmFkZChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSBuYW1lIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFJlZ2lzdGVyZWQgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsQ2xhc3MobmFtZSkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5nZXQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgY2hhbm5lbCB0eXBlIHdhcyByZWdpc3RlcmVkIHdpdGggYHtsaXZlT25seTogdHJ1ZX1gLlxuICAgKiBMaXZlLW9ubHkgY2hhbm5lbHMgYXJlIG5ldmVyIHBlcnNpc3RlZCBmb3IgcmVwbGF5OiB0aGUgZXZlbnQtbG9nXG4gICAqIHN0b3JlJ3MgYG1hcmtDaGFubmVsSW50ZXJlc3RlZGAgdGhyb3dzIGZvciB0aGVpciBuYW1lcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjaGFubmVsIGlzIGRlY2xhcmVkIGxpdmUtb25seS5cbiAgICovXG4gIGlzV2Vic29ja2V0Q2hhbm5lbExpdmVPbmx5KG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbGl2ZU9ubHlXZWJzb2NrZXRDaGFubmVscy5oYXMobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBsaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIGluIHRoZSBnbG9iYWwgcm91dGluZyByZWdpc3RyeS5cbiAgICogQ2FsbGVkIGJ5IHRoZSBzZXNzaW9uIHdoZW4gYGNhblN1YnNjcmliZSgpYCByZXNvbHZlcyB0cnV0aHk7IHRoZVxuICAgKiBzZXNzaW9uIGNhbGxzIGBfdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25gIG9uIHVuc3Vic2NyaWJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSB1c2VkIGFzIHRoZSByb3V0aW5nIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIExpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gdG8gcmVnaXN0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihuYW1lLCBzdWJzY3JpcHRpb24pIHtcbiAgICBsZXQgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkge1xuICAgICAgYnVja2V0ID0gbmV3IFNldCgpXG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5zZXQobmFtZSwgYnVja2V0KVxuICAgIH1cblxuICAgIGJ1Y2tldC5hZGQoc3Vic2NyaXB0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdW5yZWdpc3RlciB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHVzZWQgYXMgdGhlIHJvdXRpbmcga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gc3Vic2NyaXB0aW9uIC0gTGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiB0byByZW1vdmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKG5hbWUsIHN1YnNjcmlwdGlvbikge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHJldHVyblxuXG4gICAgYnVja2V0LmRlbGV0ZShzdWJzY3JpcHRpb24pXG5cbiAgICBpZiAoYnVja2V0LnNpemUgPT09IDApIHtcbiAgICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmRlbGV0ZShuYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBgYm9keWAgdG8gZXZlcnkgbGl2ZSBzdWJzY3JpYmVyIG9mIGBuYW1lYCB3aG9zZVxuICAgKiBgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpYCByZXR1cm5zIHRydWUuIFB1cmUgcm91dGluZyDigJQgbm8gYXV0aFxuICAgKiByZS1jaGVjaywgbm8gcGVyc2lzdGVuY2UuIFN1YnNjcmliZXJzIHdobyB3ZXJlIGFkbWl0dGVkIGJ5XG4gICAqIGBjYW5TdWJzY3JpYmUoKWAgY29udGludWUgdG8gcmVjZWl2ZSBicm9hZGNhc3RzIHVudGlsIHRoZXlcbiAgICogdW5zdWJzY3JpYmUgb3IgdGhlIHNlc3Npb24gZW5kcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVcbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtc1xuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5XG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGdyYWNlIHNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gR3JhY2UgcGVyaW9kIChzZWNvbmRzKSBiZWZvcmUgYSBwYXVzZWQgV1Mgc2Vzc2lvbiBpcyB0b3JuIGRvd24uXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzKCkgeyByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGhlYXJ0YmVhdCBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEludGVydmFsIChzZWNvbmRzKSBiZXR3ZWVuIHNlcnZlcuKGkmNsaWVudCBoZWFydGJlYXQgcGluZ3M7IDAgZGlzYWJsZXMgcmVhcGluZy5cbiAgICovXG4gIGdldFdlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzKCkgeyByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBlci1zZXNzaW9uIFdlYlNvY2tldCBpbmJvdW5kIG1lc3NhZ2UgcXVldWUgbGltaXRzLlxuICAgKiBAcmV0dXJucyB7e21heEJ5dGVzOiBudW1iZXIsIG1heE1lc3NhZ2VzOiBudW1iZXJ9fSAtIFBlci1zZXNzaW9uIGluYm91bmQgcXVldWUgaGlnaC13YXRlciBtYXJrcy5cbiAgICovXG4gIGdldFdlYnNvY2tldEluYm91bmRRdWV1ZUxpbWl0cygpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWVcblxuICAgIHJldHVybiB7XG4gICAgICBtYXhCeXRlczogcXVldWUubWF4UGVuZGluZ0J5dGVzLFxuICAgICAgbWF4TWVzc2FnZXM6IHF1ZXVlLm1heFBlbmRpbmdNZXNzYWdlc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBlci1jbGllbnQgV2ViU29ja2V0IG91dGJvdW5kIHF1ZXVlIGxpbWl0cy5cbiAgICogQHJldHVybnMge3ttYXhCeXRlczogbnVtYmVyLCBtYXhGcmFtZXM6IG51bWJlcn19IC0gUGVyLWNsaWVudCBvdXRib3VuZCBxdWV1ZSBoaWdoLXdhdGVyIG1hcmtzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0T3V0Ym91bmRRdWV1ZUxpbWl0cygpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWF4Qnl0ZXM6IHF1ZXVlLm1heFBlbmRpbmdCeXRlcyxcbiAgICAgIG1heEZyYW1lczogcXVldWUubWF4UGVuZGluZ0ZyYW1lc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB3cmFwcGVyIGludm9rZWQgYXJvdW5kIGV2ZXJ5IFdTLWJvcm5lIHJlcXVlc3QgL1xuICAgKiBjb25uZWN0aW9uIG1lc3NhZ2UgLyBjaGFubmVsIGRpc3BhdGNoLiBUaGUgd3JhcHBlciByZWNlaXZlcyB0aGVcbiAgICogc2Vzc2lvbiBhbmQgYSBgbmV4dGAgY2FsbGJhY2s7IGl0IG11c3QgY2FsbCBgbmV4dCgpYCB0byBydW4gdGhlXG4gICAqIGhhbmRsZXIuIFVzZSBpdCB0byBzZXQgdXAgQXN5bmNMb2NhbFN0b3JhZ2UgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IHdyYXBwZXIgLSBQZXItbWVzc2FnZSBzZXNzaW9uLWNvbnRleHQgd3JhcHBlciwgb3IgbnVsbCB0byBkaXNhYmxlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldEFyb3VuZFJlcXVlc3Qod3JhcHBlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3QgPSB3cmFwcGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGFyb3VuZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gV2Vic29ja2V0IHNlc3Npb24gd3JhcHBlci5cbiAgICovXG4gIGdldFdlYnNvY2tldEFyb3VuZFJlcXVlc3QoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3RcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB3cmFwcGVyIGludm9rZWQgYXJvdW5kIGV2ZXJ5IGNvbnRyb2xsZXIgYWN0aW9uIOKAlCBib3RoXG4gICAqIEhUVFAgYW5kIFdTLWJvcm5lLiBSZWNlaXZlcyBge3JlcXVlc3QsIHJlc3BvbnNlLCBuZXh0fWAgYW5kIG11c3RcbiAgICogY2FsbCBgbmV4dCgpYCB0byBydW4gdGhlIGFjdGlvbi4gVXNlIGl0IGZvciBwZXItcmVxdWVzdCBjb250ZXh0XG4gICAqIGxpa2UgQXN5bmNMb2NhbFN0b3JhZ2Utc2NvcGVkIGxvY2FsZSBvciB0cmFjaW5nLlxuICAgKiBAcGFyYW0geygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSB3cmFwcGVyIC0gUGVyLWFjdGlvbiByZXF1ZXN0LWNvbnRleHQgd3JhcHBlciwgb3IgbnVsbCB0byBkaXNhYmxlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEFyb3VuZEFjdGlvbih3cmFwcGVyKSB7XG4gICAgdGhpcy5fYXJvdW5kQWN0aW9uID0gd3JhcHBlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFyb3VuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gLSBIVFRQIHJlcXVlc3Qgd3JhcHBlci5cbiAgICovXG4gIGdldEFyb3VuZEFjdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fYXJvdW5kQWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGFuIGlkZW50aXR5IHJlc29sdmVyIGNhbGxlZCBvbmNlIGF0IHBhdXNlIHRpbWUgYW5kIG9uY2VcbiAgICogYXQgcmVzdW1lIHRpbWUuIFRoZSByZXNvbHZlciByZWNlaXZlcyB0aGUgc2Vzc2lvbiBhbmQgcmV0dXJucyBhbnlcbiAgICogdmFsdWUgdGhhdCBpZGVudGlmaWVzIHRoZSBhdXRoZW50aWNhdGVkIGNhbGxlciDigJQgdHlwaWNhbGx5IGFcbiAgICogYHVzZXJJZGAgcmVhZCBmcm9tIHRoZSBzZXNzaW9uJ3MgdXBncmFkZS1yZXF1ZXN0IGNvb2tpZS4gVmVsb2Npb3VzXG4gICAqIGNhcHR1cmVzIHRoZSBwYXVzZS10aW1lIHZhbHVlIG9uIHRoZSBwYXVzZWQgc2Vzc2lvbiBhbmQgY29tcGFyZXNcbiAgICogaXQgdmlhIGA9PT1gIChvciBkZWVwLWVxdWFsaXR5IGZvciBwbGFpbiBvYmplY3RzKSB0byB0aGUgZnJlc2hcbiAgICogcmVzdW1lLXRpbWUgdmFsdWUuIElmIHRoZXkgZGlmZmVyLCB0aGUgcmVzdW1lIGlzIHJlamVjdGVkIHdpdGhcbiAgICogYHNlc3Npb24tZ29uZWAgYW5kIHRoZSBwYXVzZWQgc2Vzc2lvbiBpcyBkZXN0cm95ZWQgc28gYSBzaWduZWQtb3V0XG4gICAqIG9yIHJlLWF1dGhlbnRpY2F0ZWQgY2xpZW50IGNhbm5vdCByZWNsYWltIGFub3RoZXIgdXNlcidzIHN0YXRlLlxuICAgKlxuICAgKiBSZXR1cm4gYG51bGxgL2B1bmRlZmluZWRgIHRvIG1lYW4gXCJubyBpZGVudGl0eVwiIOKAlCByZXN1bWVzIHN0aWxsXG4gICAqIHN1Y2NlZWQgaWYgcGF1c2UgYW5kIHJlc3VtZSBib3RoIHJlc29sdmUgdG8gYSBudWxsaXNoIHZhbHVlLlxuICAgKiBAcGFyYW0geygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSByZXNvbHZlciAtIEF1dGhlbnRpY2F0ZWQtY2FsbGVyIGlkZW50aXR5IHJlc29sdmVyLCBvciBudWxsIHRvIGRpc2FibGUgaWRlbnRpdHkgY2hlY2tzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyKHJlc29sdmVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIgPSByZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGlkZW50aXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9IC0gVGhlIGNvbmZpZ3VyZWQgaWRlbnRpdHkgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgc2Vzc2lvbiBncmFjZSBzZWNvbmRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gc2Vjb25kcyAtIEdyYWNlIHBlcmlvZCBiZWZvcmUgYSBwYXVzZWQgc2Vzc2lvbiBleHBpcmVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMoc2Vjb25kcykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNlY29uZHMpIHx8IHNlY29uZHMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZ3JhY2Ugc2Vjb25kczogJHtzZWNvbmRzfWApXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyA9IHNlY29uZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgc2Vzc2lvbiBoZWFydGJlYXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBIZWFydGJlYXQgaW50ZXJ2YWwsIHdpdGggemVybyBkaXNhYmxpbmcgcmVhcGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyhzZWNvbmRzKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2Vjb25kcykgfHwgc2Vjb25kcyA8IDApIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBoZWFydGJlYXQgc2Vjb25kczogJHtzZWNvbmRzfWApXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgPSBzZWNvbmRzXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgYSBzZXNzaW9uIGludG8gdGhlIHBhdXNlZCByZWdpc3RyeSBhbmQgc3RhcnRzIHRoZSBncmFjZVxuICAgKiB0aW1lci4gV2hlbiB0aGUgdGltZXIgZmlyZXMsIHRoZSBzZXNzaW9uJ3MgcGVybWFuZW50IHRlYXJkb3duXG4gICAqIGhvb2sgaXMgaW52b2tlZC4gQ2FsbGVkIGJ5IHRoZSBzZXNzaW9uIGl0c2VsZiBmcm9tIGBfaGFuZGxlQ2xvc2VgXG4gICAqIHdoZW4gdGhlcmUgaXMgcmVzdW1hYmxlIHN0YXRlIChsaXZlIENvbm5lY3Rpb25zIC8gQ2hhbm5lbCBzdWJzKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0fSBzZXNzaW9uIC0gUmVzdW1hYmxlIHNlc3Npb24gdG8gcmV0YWluIGR1cmluZyBpdHMgZ3JhY2UgcGVyaW9kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9wYXVzZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbikge1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHNlc3Npb24uc2Vzc2lvbklkXG5cbiAgICBpZiAoIXNlc3Npb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiU2Vzc2lvbiBtdXN0IGhhdmUgYSBzZXNzaW9uSWQgdG8gYmUgcGF1c2VkXCIpXG4gICAgaWYgKHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmhhcyhzZXNzaW9uSWQpKSByZXR1cm5cblxuICAgIGNvbnN0IGdyYWNlTXMgPSB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzICogMTAwMFxuICAgIGNvbnN0IGdyYWNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2V4cGlyZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKVxuICAgIH0sIGdyYWNlTXMpXG5cbiAgICAvLyBEb24ndCBrZWVwIHRoZSBwcm9jZXNzIGFsaXZlIHB1cmVseSBmb3IgYSBwYXVzZWQgc2Vzc2lvbiB0aW1lci5cbiAgICBpZiAodHlwZW9mIGdyYWNlVGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgZ3JhY2VUaW1lci51bnJlZigpXG5cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5zZXQoc2Vzc2lvbklkLCB7c2Vzc2lvbiwgZ3JhY2VUaW1lciwgcGF1c2VkQXQ6IERhdGUubm93KCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvb2tzIHVwIGEgcGF1c2VkIHNlc3Npb24gYnkgaWQgKGRvZXMgTk9UIHJlbW92ZSBpdCDigJQgY2FsbGVyIGlzXG4gICAqIGV4cGVjdGVkIHRvIGNhbGwgYF9yZXN1bWVXZWJzb2NrZXRTZXNzaW9uYCB0byBjb21wbGV0ZSB0aGUgaGFuZG9mZikuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBQYXVzZWQgc2Vzc2lvbiB3aXRoIHRoZSByZXF1ZXN0ZWQgaWRlbnRpZmllciwgaWYgcHJlc2VudC5cbiAgICovXG4gIF9maW5kUGF1c2VkV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICByZXR1cm4gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCk/LnNlc3Npb24gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBwYXVzZWQgc2Vzc2lvbiBmcm9tIHRoZSByZWdpc3RyeSBhbmQgY2FuY2VscyBpdHMgZ3JhY2VcbiAgICogdGltZXIuIENhbGxlZCBvbiBzdWNjZXNzZnVsIHJlc3VtZSBoYW5kb2ZmIGFuZCBvbiBleHBsaWNpdFxuICAgKiBleHBpcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHRvIHJlbW92ZSBhbmQgY2FuY2VsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbGVhclBhdXNlZFdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICBjbGVhclRpbWVvdXQoZW50cnkuZ3JhY2VUaW1lcilcbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEdyYWNlLXRpbWVyIGNhbGxiYWNrLiBDYWxscyB0aGUgc2Vzc2lvbidzIHBlcm1hbmVudC10ZWFyZG93blxuICAgKiBob29rIGFuZCBkcm9wcyBpdCBmcm9tIHRoZSByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIgd2hvc2UgZ3JhY2UgcGVyaW9kIGV4cGlyZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2V4cGlyZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKVxuICAgIHRyeSB7XG4gICAgICBlbnRyeS5zZXNzaW9uLl9maW5hbGl6ZUdyYWNlRXhwaXJ5KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGZpbmFsaXplIGV4cGlyZWQgV1Mgc2Vzc2lvbiAke3Nlc3Npb25JZH1gLCBlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBicm9hZGNhc3QgdG8gY2hhbm5lbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgcmVjZWl2aW5nIHRoZSBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBWYWx1ZXMgdXNlZCB0byBtYXRjaCBlbGlnaWJsZSBzdWJzY3JpcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gQnJvYWRjYXN0IHBheWxvYWQgZGVsaXZlcmVkIHRvIG1hdGNoaW5nIHN1YnNjcmlwdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYnJvYWRjYXN0VG9DaGFubmVsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSkge1xuICAgIC8vIFdoZW4gQmVhY29uIGlzIGNvbm5lY3RlZCwgc2hpcCB0aGUgYnJvYWRjYXN0IG9udG8gdGhlIGJ1cy4gVGhlXG4gICAgLy8gZGFlbW9uIGVjaG9lcyBpdCBiYWNrIHRvIGV2ZXJ5IHBlZXIgKGluY2x1ZGluZyB0aGlzIG9uZSkgYW5kXG4gICAgLy8gZWFjaCBwZWVyJ3MgYF9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbmAgcGVyZm9ybXMgdGhlIHNhbWVcbiAgICAvLyBsb2NhbCBkZWxpdmVyeSBhcyB0aGUgc3luY2hyb25vdXMgcGF0aHMgYmVsb3cg4oCUIHNvIGV2ZXJ5XG4gICAgLy8gc3Vic2NyaWJlciwgaW4gYW55IHByb2Nlc3MsIHNlZXMgYnJvYWRjYXN0cyB2aWEgYSBzaW5nbGUgY29kZVxuICAgIC8vIHBhdGguXG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCAmJiB0aGlzLl9iZWFjb25DbGllbnQuaXNDb25uZWN0ZWQoKSkge1xuICAgICAgY29uc3Qgc2VudCA9IHRoaXMuX2JlYWNvbkNsaWVudC5wdWJsaXNoKHtjaGFubmVsOiBuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHl9KVxuXG4gICAgICBpZiAoc2VudCkgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gVjIgc3Vic2NyaXB0aW9ucyBsaXZlIHBlciB3b3JrZXItdGhyZWFkLiBXaGVuIHJ1bm5pbmcgaW5cbiAgICAvLyB3b3JrZXItdGhyZWFkIG1vZGUsIHRoZSBwdWJsaXNoZXIgcnVucyBlaXRoZXIgaW4gdGhlIG1haW5cbiAgICAvLyBwcm9jZXNzIChob3N0KSBvciBpbiBvbmUgb2YgdGhlIHdvcmtlcnM6XG4gICAgLy9cbiAgICAvLyAgLSBNYWluIHByb2Nlc3M6IGBfd2Vic29ja2V0RXZlbnRzYCBpcyB0aGUgaG9zdCBzaW5nbGV0b24gYW5kXG4gICAgLy8gICAgYGJyb2FkY2FzdFYyYCBmYW5zIG91dCB0byBldmVyeSB3b3JrZXIgZGlyZWN0bHkuXG4gICAgLy8gIC0gV29ya2VyOiBgX3dlYnNvY2tldEV2ZW50c2AgaGFzIGBwdWJsaXNoVjJCcm9hZGNhc3RgIHRoYXRcbiAgICAvLyAgICBwb3N0cyB0byBtYWluLCB3aGljaCB0aGVuIGZhbnMgb3V0IHRvIGV2ZXJ5IHdvcmtlci5cbiAgICAvL1xuICAgIC8vIEluLXByb2Nlc3MgbW9kZSBkb2Vzbid0IGluc3RhbGwgYSB3ZWJzb2NrZXQtZXZlbnRzIHRyYW5zcG9ydCxcbiAgICAvLyBzbyBmYWxsIHRocm91Z2ggdG8gdGhlIGxvY2FsIGRpc3BhdGNoLlxuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMih7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5wdWJsaXNoVjJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIiAmJiB3ZWJzb2NrZXRFdmVudHMucGFyZW50UG9ydCkge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLnB1Ymxpc2hWMkJyb2FkY2FzdCh7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYWxsIHBlbmRpbmcgYnJvYWRjYXN0IG9wZXJhdGlvbnMgKGluY2x1ZGluZyBldmVudC1sb2dcbiAgICogcGVyc2lzdGVuY2UpLiBDYWxsIHRoaXMgYWZ0ZXIgYGJyb2FkY2FzdFRvQ2hhbm5lbGAgd2hlbiB5b3UgbmVlZFxuICAgKiB0aGUgZXZlbnQgdG8gYmUgcGVyc2lzdGVkIGJlZm9yZSBjb250aW51aW5nIChlLmcuIGJlZm9yZVxuICAgKiByZXNwb25kaW5nIHRvIGFuIEhUVFAgcmVxdWVzdCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpIHtcbiAgICAvKipcbiAgICAgKiBXZWJzb2NrZXQgZXZlbnRzLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBjb25zdCB3ZWJzb2NrZXRFdmVudHMgPSB0aGlzLl93ZWJzb2NrZXRFdmVudHNcblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIC8vIERyYWluIHRoZSBob3N0L3dvcmtlciBwdWJsaXNoIHF1ZXVlcyAoaW5jbHVkaW5nIGV2ZW50LWxvZyBwZXJzaXN0ZW5jZSlcbiAgICAgIC8vIGJlZm9yZSBkcmFpbmluZyBsb2NhbCBkZWxpdmVyaWVzLCBiZWNhdXNlIGhvc3QgZGlzcGF0Y2ggbGF1bmNoZXMgdGhlXG4gICAgICAvLyBsb2NhbCBkZWxpdmVyaWVzIHN5bmNocm9ub3VzbHkgYW5kIHRoZXkgbXVzdCBiZSBwYXJ0IG9mIHRoZSBzbmFwc2hvdC5cbiAgICAgIGF3YWl0IHdlYnNvY2tldEV2ZW50cy5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9hd2FpdExvY2FsQnJvYWRjYXN0RGVsaXZlcmllcygpXG4gIH1cblxuICAvKipcbiAgICogTG9jYWwgKHBlci13b3JrZXIpIGNoYW5uZWwgYnJvYWRjYXN0IGRpc3BhdGNoLiBDYWxsZWQgZWl0aGVyXG4gICAqIGRpcmVjdGx5IChpbi1wcm9jZXNzIG1vZGUpIG9yIGJ5IHRoZSB3b3JrZXIgdGhyZWFkIGFmdGVyIHRoZVxuICAgKiBtYWluLXByb2Nlc3MgZmFuLW91dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBQYXJhbXMgcGFzc2VkIHRvIGVhY2ggc3Vic2NyaXB0aW9uJ3MgYG1hdGNoZXMoKWAuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBNZXNzYWdlIGJvZHkgZGVsaXZlcmVkIHZpYSBgc2VuZE1lc3NhZ2UoKWAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEgZm9yIHJlcGxheSB0cmFja2luZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBidWNrZXQpIHtcbiAgICAgIGlmIChzdWJzY3JpcHRpb24uaXNDbG9zZWQoKSkgY29udGludWVcblxuICAgICAgbGV0IG1hdGNoZXNcblxuICAgICAgdHJ5IHtcbiAgICAgICAgbWF0Y2hlcyA9IHN1YnNjcmlwdGlvbi5tYXRjaGVzKGJyb2FkY2FzdFBhcmFtcyB8fCB7fSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIEEgYnJva2VuIGBtYXRjaGVzKClgIG9uIG9uZSBzdWJzY3JpYmVyIG11c3Qgbm90IHBvaXNvbiB0aGVcbiAgICAgICAgLy8gYnJvYWRjYXN0IHRvIG90aGVyIHN1YnNjcmliZXJzLiBTa2lwIGFuZCBjb250aW51ZS5cbiAgICAgICAgY29uc29sZS5lcnJvcihgYnJvYWRjYXN0VG9DaGFubmVsOiAke25hbWV9IHN1YnNjcmlwdGlvbiAke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH0gbWF0Y2hlcygpIHRocmV3YCwgZXJyb3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWF0Y2hlcykgY29udGludWVcblxuICAgICAgY29uc3QgZGVsaXZlcnlNZXRhZGF0YSA9IHtcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICAuLi4obWV0YT8uZXZlbnRJZCA/IHtldmVudElkOiBtZXRhLmV2ZW50SWR9IDoge30pXG4gICAgICB9XG4gICAgICBjb25zdCBwcmV2aW91c0RlbGl2ZXJ5ID0gdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLmdldChzdWJzY3JpcHRpb24pXG4gICAgICBjb25zdCBkZWxpdmVyeSA9IHRoaXMud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb25Db250ZXh0cygoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIChwcmV2aW91c0RlbGl2ZXJ5IHx8IFByb21pc2UucmVzb2x2ZSgpKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fZGVsaXZlcldlYnNvY2tldENoYW5uZWxCcm9hZGNhc3Qoc3Vic2NyaXB0aW9uLCBib2R5LCBkZWxpdmVyeU1ldGFkYXRhKSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgYnJvYWRjYXN0VG9DaGFubmVsOiAke25hbWV9IHN1YnNjcmlwdGlvbiAke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH0gZGVsaXZlckJyb2FkY2FzdCB0aHJld2AsIGVycm9yKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5zZXQoc3Vic2NyaXB0aW9uLCBkZWxpdmVyeSlcblxuICAgICAgLy8gS2VlcCB0aGUgZmlyZS1hbmQtZm9yZ2V0IGRlbGl2ZXJ5IChuZXZlciBhd2FpdGVkIGF0IGJyb2FkY2FzdCB0aW1lKSBidXRcbiAgICAgIC8vIHRyYWNrIGl0IHNvIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBjYW4gZHJhaW4gaXQgYmVmb3JlIHNldHRsaW5nLiBSZW1vdmVcbiAgICAgIC8vIG9uIHNldHRsZTsgdGhlIGZhaWx1cmUgaGFuZGxlciBhbHNvIHNhdGlzZmllcyB0aGUgcHJvbWlzZSBzbyBhIHJlamVjdGVkXG4gICAgICAvLyBkZWxpdmVyeSBuZXZlciBiZWNvbWVzIGFuIHVuaGFuZGxlZCByZWplY3Rpb24uXG4gICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMuYWRkKGRlbGl2ZXJ5KVxuXG4gICAgICAvKipcbiAgICAgICAqIFJlbW92ZXMgYSBzZXR0bGVkIGRlbGl2ZXJ5IGZyb20gbG9jYWwgdHJhY2tpbmcuXG4gICAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgICAqL1xuICAgICAgY29uc3QgZm9yZ2V0RGVsaXZlcnkgPSAoKSA9PiB7XG4gICAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcy5kZWxldGUoZGVsaXZlcnkpXG4gICAgICAgIGlmICh0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZ2V0KHN1YnNjcmlwdGlvbikgPT09IGRlbGl2ZXJ5KSB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZGVsZXRlKHN1YnNjcmlwdGlvbilcbiAgICAgIH1cblxuICAgICAgZGVsaXZlcnkudGhlbihmb3JnZXREZWxpdmVyeSwgZm9yZ2V0RGVsaXZlcnkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhIHNuYXBzaG90IG9mIHRoZSBpbi1mbGlnaHQgbG9jYWwgKHBlci1wcm9jZXNzKSB3ZWJzb2NrZXQgY2hhbm5lbFxuICAgKiBicm9hZGNhc3QgZGVsaXZlcmllcy4gQ2FsbGVkIGZyb20gYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGFmdGVyIHRoZSBob3N0XG4gICAqIHB1Ymxpc2ggcXVldWVzIGRyYWluLCBzbyBldmVyeSBkZWxpdmVyeSB0aG9zZSBxdWV1ZXMgbGF1bmNoZWQgaXMgY2FwdHVyZWQuXG4gICAqIE5ldyBkZWxpdmVyaWVzIGVucXVldWVkIGFmdGVyIHRoZSBzbmFwc2hvdCBhcmUgbm90IGF3YWl0ZWQuIEluZGl2aWR1YWxcbiAgICogZGVsaXZlcnkgZXJyb3JzIGFyZSBpc29sYXRlZCBwZXIgc3Vic2NyaWJlciDigJQgdGhlIGRlbGl2ZXJ5IGNoYWluIGFscmVhZHlcbiAgICogbG9ncyB0aGVtIGFuZCByZXNvbHZlcyDigJQgc28gYSBzbmFwc2hvdHRlZCByZWplY3Rpb24gbmV2ZXIgZmFpbHMgdGhpcyBiYXJyaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hd2FpdExvY2FsQnJvYWRjYXN0RGVsaXZlcmllcygpIHtcbiAgICBjb25zdCBzbmFwc2hvdCA9IFsuLi50aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXNdXG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc25hcHNob3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIHdlYnNvY2tldCBjaGFubmVsIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIENoYW5uZWwgc3Vic2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gbWV0YSAtIEJyb2FkY2FzdCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSBCcm9hZGNhc3QgZGVsaXZlcnkgcmVzdWx0LlxuICAgKi9cbiAgX2RlbGl2ZXJXZWJzb2NrZXRDaGFubmVsQnJvYWRjYXN0KHN1YnNjcmlwdGlvbiwgYm9keSwgbWV0YSkge1xuICAgIGlmICh0eXBlb2Ygc3Vic2NyaXB0aW9uLmRlbGl2ZXJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpXG4gICAgfVxuXG4gICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldENoYW5uZWxSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBYmlsaXR5IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IFthcmdzLnJlcXVlc3RdIC0gUmVxdWVzdCBvYmplY3QuIEFic2VudCBmb3Igd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9ucyByZXNvbHZlZCBmcm9tIHN1YnNjcmliZSBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MucmVzcG9uc2VdIC0gUmVzcG9uc2Ugb2JqZWN0LiBBYnNlbnQgb3V0c2lkZSBIVFRQIHJlcXVlc3QgaGFuZGxpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVkIGFiaWxpdHkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQWJpbGl0eSh7cGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0QWJpbGl0eVJlc29sdmVyKClcblxuICAgIGlmIChyZXNvbHZlcikge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlcih7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pXG5cbiAgICAgIGlmIChyZXNvbHZlZCkgcmV0dXJuIHJlc29sdmVkXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VzID0gdGhpcy5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICAgIGlmIChyZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIHJldHVybiBuZXcgQWJpbGl0eSh7XG4gICAgICBjb250ZXh0OiB7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0sXG4gICAgICByZXNvdXJjZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9maWxlcyBhbiBhcHBsaWNhdGlvbi1kZWZpbmVkIHRlc3QgYWN0aXZpdHkgd2hlbiBhbiBvcHQtaW4gdGVzdCBwcm9maWxlXG4gICAqIGNvbnRleHQgaXMgYWN0aXZlLiBUaGUgY2FsbGJhY2sgYWx3YXlzIHJ1bnMsIGluY2x1ZGluZyBvdXRzaWRlIHByb2ZpbGluZy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb3ctY2FyZGluYWxpdHkgYWN0aXZpdHkgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIEFjdGl2aXR5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBwcm9maWxlVGVzdEFjdGl2aXR5KG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgdmFsaWRhdGVkTmFtZSA9IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZShuYW1lKVxuXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFRlc3RQcm9maWxlQ29udGV4dCgpXG5cbiAgICBpZiAoIWNvbnRleHQpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgY29udGV4dC5wcm9maWxlci5wcm9maWxlQWN0aXZpdHkoY29udGV4dCwgdmFsaWRhdGVkTmFtZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGFiaWxpdHkgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudEFiaWxpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudEFiaWxpdHkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgcmVxdWVzdCB0aW1pbmcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgcmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKi9cbiAgZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ3VycmVudCB0ZW5hbnQgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlbmFudCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVuYW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVGVuYW50IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7e2NoYW5uZWw6IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gW2FyZ3Muc3Vic2NyaXB0aW9uXSAtIFN1YnNjcmlwdGlvbiBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVUZW5hbnQoe3BhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2UsIHN1YnNjcmlwdGlvbn0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0VGVuYW50UmVzb2x2ZXIoKVxuXG4gICAgaWYgKCFyZXNvbHZlcikgcmV0dXJuXG5cbiAgICByZXR1cm4gYXdhaXQgcmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIHBhcmFtcyxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIHN1YnNjcmlwdGlvblxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXJyb3IgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiZXZlbnRlbWl0dGVyM1wiKS5FdmVudEVtaXR0ZXJ9IC0gRnJhbWV3b3JrIGVycm9yIGV2ZW50cyBlbWl0dGVyLlxuICAgKi9cbiAgZ2V0RXJyb3JFdmVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgcmVwb3J0ZXIgdGhhdCBjYW4gYWRkIGNsaWVudC1zYWZlIG1ldGFkYXRhIHRvIGZyb250ZW5kLW1vZGVsIGVycm9yIHBheWxvYWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclR5cGV9IHJlcG9ydGVyIC0gUmVwb3J0ZXIgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXIocmVwb3J0ZXIpIHtcbiAgICB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMucHVzaChyZXBvcnRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyZWQgY2xpZW50IGVycm9yIHBheWxvYWQgcmVwb3J0ZXJzLlxuICAgKiBAcGFyYW0ge3tjb250ZXh0OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkQ29udGV4dCwgZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIFJlcG9ydGVyIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWQ+fSAtIE1lcmdlZCBjbGllbnQtc2FmZSByZXBvcnRlciBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgY2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoYXJncykge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICBjb25zdCBkZXRhaWxzID0gcmVxdWVzdERldGFpbHMoYXJncy5yZXF1ZXN0LCB7cmVkYWN0b3I6IHRoaXMuZ2V0TG9nUmVkYWN0b3IoKSwgc2Vuc2l0aXZlVmFsdWVzfSlcblxuICAgIGZvciAoY29uc3QgcmVwb3J0ZXIgb2YgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzKSB7XG4gICAgICBjb25zdCByZXBvcnRlclBheWxvYWQgPSBhd2FpdCByZXBvcnRlcih7XG4gICAgICAgIC4uLmFyZ3MsXG4gICAgICAgIHJlcXVlc3REZXRhaWxzOiBkZXRhaWxzXG4gICAgICB9KVxuXG4gICAgICBpZiAocmVwb3J0ZXJQYXlsb2FkICYmIHR5cGVvZiByZXBvcnRlclBheWxvYWQgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihwYXlsb2FkLCByZXBvcnRlclBheWxvYWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSB0ZXN0IGF0dGVtcHQgaW4gYSByZXZvY2FibGUgZGF0YWJhc2UtYWNjZXNzIGNvbnRleHQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e3Jldm9rZWQ6IGJvb2xlYW59fSBzY29wZSAtIEF0dGVtcHQtb3duZWQgYWNjZXNzIHNjb3BlLlxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF0dGVtcHQgd29yay5cbiAgICogQHJldHVybnMge1QgfCBQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdGVudCBmcmFtZXdvcmsgd29yayB3aXRob3V0IGluaGVyaXRpbmcgYSB0ZXN0IGF0dGVtcHQncyByZXZvY2FibGUgZGF0YWJhc2UtYWNjZXNzIHNjb3BlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBlcnNpc3RlbnQgd29yayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhvdXRDdXJyZW50VGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqIFRocm93cyB3aGVuIGEgdGltZWQtb3V0IHRlc3QgYXR0ZW1wdCB0cmllcyB0byBzdGFydCBtb3JlIGRhdGFiYXNlIHdvcmsuICovXG4gIGFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpIHtcbiAgICB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmFzc2VydFRlc3REYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBjb25uZWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoQ29ubmVjdGlvbnMob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBuYW1lXG4gICAgfSA9IHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgXCJDb25maWd1cmF0aW9uLndpdGhDb25uZWN0aW9uc1wiKVxuXG4gICAgaWYgKCFhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwid2l0aENvbm5lY3Rpb25zIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIC8qKlxuICAgICAqIERicy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIGNvbnN0IGRicyA9IHt9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGJzLFxuICAgICAgaWRlbnRpZmllcnM6IGRhdGFiYXNlSWRlbnRpZmllcnMgPz8gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCksXG4gICAgICBuYW1lLFxuICAgICAgc3RhY2tMYWJlbDogXCJ3aXRoQ29ubmVjdGlvbnNcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBsaWNpdCBtb2RlbCB3b3JrIGluIGEgdHJhbnNhY3Rpb24gcGlubmVkIHRvIG9uZSBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZT86IHN0cmluZ319IG9wdGlvbnMgLSBPcGVyYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHsob3BlcmF0aW9uOiBEYXRhYmFzZU9wZXJhdGlvbikgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhUcmFuc2FjdGlvbih7ZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lID0gXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvblwiLCAuLi5yZXN0QXJnc30sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuICAgIGlmICghdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkuaW5jbHVkZXMoZGF0YWJhc2VJZGVudGlmaWVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9yIGluYWN0aXZlIGRhdGFiYXNlIGlkZW50aWZpZXI6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KClcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhPcGVyYXRpb25Db25uZWN0aW9uKHtuYW1lfSwgYXN5bmMgKGNvbm5lY3Rpb24sIG93bmVyKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICBjb25zdCBvcGVyYXRpb24gPSBuZXcgRGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGNvbmZpZ3VyYXRpb25SZXVzZUtleTogcG9vbC5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pLFxuICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIG93bmVyLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBvcGVyYXRpb24udHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgICAgICB9KVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgb3BlcmF0aW9uLmNvbXBsZXRlKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhwbGljaXQgbW9kZWwgd29yayBvbiBvbmUgY29ubmVjdGlvbiBzZWxlY3RlZCBmcm9tIGEgY2FwdHVyZWQgcGh5c2ljYWxcbiAgICogZGF0YWJhc2UgY29uZmlndXJhdGlvbi4gTm8gYW1iaWVudCB0ZW5hbnQgdmFsdWUgaXMgcmVhZCBkdXJpbmcgY2hlY2tvdXQgb3JcbiAgICogZXhlY3V0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZT86IHN0cmluZywgc2NoZW1hR2VuZXJhdGlvbj86IHN0cmluZywgdGVuYW50Pzogb2JqZWN0fX0gb3B0aW9ucyAtIENhcHR1cmVkIG9wZXJhdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IERhdGFiYXNlT3BlcmF0aW9uKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERhdGFiYXNlT3BlcmF0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgbmFtZSA9IFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb25cIiwgc2NoZW1hR2VuZXJhdGlvbiwgdGVuYW50LCAuLi5yZXN0QXJnc30sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cIilcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBjb25maWd1cmF0aW9uUmV1c2VLZXkgPSBwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG5cbiAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ2FwdHVyZWRPcGVyYXRpb25Db25uZWN0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG5hbWV9LCBhc3luYyAoY29ubmVjdGlvbiwgb3duZXIpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IG5ldyBEYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgY29uZmlndXJhdGlvblJldXNlS2V5LFxuICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIGVuZm9yY2VDdXJyZW50VGVuYW50UmV1c2VLZXk6IGZhbHNlLFxuICAgICAgICBvd25lcixcbiAgICAgICAgc2NoZW1hR2VuZXJhdGlvbixcbiAgICAgICAgdGVuYW50XG4gICAgICB9KVxuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgb3BlcmF0aW9uLmNvbXBsZXRlKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FsbGJhY2sgd2l0aCBkYXRhYmFzZSBjb25uZWN0aW9ucyBmb3IgdGhlIHJlcXVlc3RlZCBpZGVudGlmaWVycy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7Y2FsbGJhY2s6IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiwgZGJzOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0PiwgaWRlbnRpZmllcnM6IHN0cmluZ1tdLCBuYW1lOiBzdHJpbmcsIHN0YWNrTGFiZWw6IHN0cmluZ319IGFyZ3MgLSBDb25uZWN0aW9uIHNjb3BlIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7Y2FsbGJhY2ssIGRicywgaWRlbnRpZmllcnMsIG5hbWUsIHN0YWNrTGFiZWx9KSB7XG4gICAgY29uc3Qgc3RhY2sgPSBFcnJvcigpLnN0YWNrXG4gICAgY29uc3QgYWN0dWFsQ2FsbGJhY2sgPSBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICByZXR1cm4gYXdhaXQgd2l0aFRyYWNrZWRTdGFjayhzdGFjayB8fCBzdGFja0xhYmVsLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYnMpXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1biByZXF1ZXN0LlxuICAgICAqIEB0eXBlIHsoKSA9PiBQcm9taXNlPFQ+fSAqL1xuICAgIGxldCBydW5SZXF1ZXN0ID0gYWN0dWFsQ2FsbGJhY2tcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBpZGVudGlmaWVycykge1xuICAgICAgbGV0IGFjdHVhbFJ1blJlcXVlc3QgPSBydW5SZXF1ZXN0XG5cbiAgICAgIGNvbnN0IG5leHRSdW5SZXF1ZXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikud2l0aENvbm5lY3Rpb24oe25hbWV9LCBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgICBkYnNbaWRlbnRpZmllcl0gPSBkYlxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbFJ1blJlcXVlc3QoKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBydW5SZXF1ZXN0ID0gbmV4dFJ1blJlcXVlc3RcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUmVxdWVzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2RhdGFiYXNlSWRlbnRpZmllcnNdIC0gRGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gaW5jbHVkZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBBIG1hcCBvZiBkYXRhYmFzZSBjb25uZWN0aW9ucyB3aXRoIGlkZW50aWZpZXIgYXMga2V5XG4gICAqL1xuICBnZXRDdXJyZW50Q29ubmVjdGlvbnMoZGF0YWJhc2VJZGVudGlmaWVycyA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIC8qKlxuICAgICAqIERicy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIGNvbnN0IGRicyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGF0YWJhc2VJZGVudGlmaWVycykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9uID0gcG9vbC5nZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24gPyBwb29sLmdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbigpIDogcG9vbC5nZXRDdXJyZW50Q29ubmVjdGlvbigpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRDb25uZWN0aW9uICYmICghcG9vbC5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uIHx8IHBvb2wuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbihjdXJyZW50Q29ubmVjdGlvbikpKSB7XG4gICAgICAgICAgZGJzW2lkZW50aWZpZXJdID0gY3VycmVudENvbm5lY3Rpb25cbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuaXNNaXNzaW5nQ3VycmVudENvbm5lY3Rpb25FcnJvcihlcnJvcikpIHtcbiAgICAgICAgICAvLyBJZ25vcmVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aG91dCBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gd2l0aG91dCBpbmhlcml0ZWQgREIgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoY2FsbGJhY2spIHtcbiAgICBsZXQgcnVuQ2FsbGJhY2sgPSAoKSA9PiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJzKGNhbGxiYWNrKVxuXG4gICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuICAgICAgY29uc3QgcHJldmlvdXNSdW5DYWxsYmFjayA9IHJ1bkNhbGxiYWNrXG5cbiAgICAgIHJ1bkNhbGxiYWNrID0gKCkgPT4gcG9vbC53aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0KHByZXZpb3VzUnVuQ2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bkNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaW5zaWRlIGV2ZXJ5IHBvb2wncyB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIGNvbnRleHQgKGEgbm8tb3AgZm9yXG4gICAqIHBvb2xzIHdpdGhvdXQgb25lKS4gSW4tcHJvY2VzcyByZXF1ZXN0IGhhbmRsaW5nIGlzIHdyYXBwZWQgaW4gdGhpcyBzbyBhIHJlcXVlc3RcbiAgICogcnVucyBvbiB0aGUgc2FtZSBjb25uZWN0aW9uIOKAlCBhbmQgb3BlbiB0cmFuc2FjdGlvbiDigJQgYXMgdGhlIHRlc3QgdGhhdCBpc3N1ZWQgaXQsXG4gICAqIGxldHRpbmcgcmVxdWVzdCBzcGVjcyBjbGVhbiB1cCBieSByb2xsaW5nIGJhY2sgaW5zdGVhZCBvZiB0cnVuY2F0aW5nLiBPdXRzaWRlXG4gICAqIHRlc3RzIG5vIHNoYXJlZCBjb25uZWN0aW9uIGlzIHNldCwgc28gdGhpcyBqdXN0IHJ1bnMgdGhlIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIGluc2lkZSB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGNhbGxiYWNrKSB7XG4gICAgbGV0IHJ1bkNhbGxiYWNrID0gY2FsbGJhY2tcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmICghcG9vbCkgY29udGludWVcbiAgICAgIGNvbnN0IHByZXZpb3VzUnVuQ2FsbGJhY2sgPSBydW5DYWxsYmFja1xuXG4gICAgICBydW5DYWxsYmFjayA9ICgpID0+IHBvb2wucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uKHByZXZpb3VzUnVuQ2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bkNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG1pc3NpbmcgY3VycmVudCBjb25uZWN0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEVycm9yIHRocm93biB3aGlsZSBsb29raW5nIHVwIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGVycm9yIG1lYW5zIG5vIGN1cnJlbnQgY29ubmVjdGlvbiBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBpc01pc3NpbmdDdXJyZW50Q29ubmVjdGlvbkVycm9yKGVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgKFxuICAgICAgZXJyb3IubWVzc2FnZSA9PSBcIklEIGhhc24ndCBiZWVuIHNldCBmb3IgdGhpcyBhc3luYyBjb250ZXh0XCIgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2UgPT0gXCJBIGNvbm5lY3Rpb24gaGFzbid0IGJlZW4gbWFkZSB5ZXRcIiB8fFxuICAgICAgZXJyb3IubWVzc2FnZS5zdGFydHNXaXRoKFwiTm8gYXN5bmMgY29udGV4dCBzZXQgZm9yIGRhdGFiYXNlIGNvbm5lY3Rpb25cIikgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2Uuc3RhcnRzV2l0aChcIkNvbm5lY3Rpb24gXCIpICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJkb2Vzbid0IGV4aXN0IGFueSBtb3JlXCIpXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGNvbm5lY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNvbm5lY3Rpb25zKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBjb25zdCB7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgbmFtZVxuICAgIH0gPSByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIFwiQ29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9uc1wiKVxuXG4gICAgaWYgKCFhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwiZW5zdXJlQ29ubmVjdGlvbnMgcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgcmVxdWVzdGVkSWRlbnRpZmllcnMgPSBkYXRhYmFzZUlkZW50aWZpZXJzID8/IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpXG4gICAgY29uc3QgZGJzID0gdGhpcy5nZXRDdXJyZW50Q29ubmVjdGlvbnMocmVxdWVzdGVkSWRlbnRpZmllcnMpXG4gICAgY29uc3QgbWlzc2luZ0lkZW50aWZpZXJzID0gcmVxdWVzdGVkSWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiB7XG4gICAgICBpZiAoIWRic1tpZGVudGlmaWVyXSkgcmV0dXJuIHRydWVcblxuICAgICAgcmV0dXJuICF0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS5oYXNDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQoKVxuICAgIH0pXG5cbiAgICBpZiAobWlzc2luZ0lkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKGRicylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGJzLFxuICAgICAgaWRlbnRpZmllcnM6IG1pc3NpbmdJZGVudGlmaWVycyxcbiAgICAgIG5hbWUsXG4gICAgICBzdGFja0xhYmVsOiBcImVuc3VyZUNvbm5lY3Rpb25zXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGRlZGljYXRlZCBjb25uZWN0aW9uIHRoYXQgY3VycmVudGx5IGhvbGRzIGFuIGFkdmlzb3J5IGxvY2ssIHNvIGFcbiAgICogc2h1dGRvd24gY2FuIGNsb3NlIGl0IGFuZCByZWxlYXNlIHRoZSBsb2NrLiBTZWUgYF9hZHZpc29yeUxvY2tDb25uZWN0aW9uc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuYWRkKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uIG9uY2UgaXRzIGxvY2sgc2NvcGUgZW5kcyBhbmQgdGhlXG4gICAqIGNvbm5lY3Rpb24gaGFzIGJlZW4gKG9yIGlzIGFib3V0IHRvIGJlKSBjbG9zZWQgYnkgaXRzIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBUaGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB1bnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGV2ZXJ5IHJlZ2lzdGVyZWQgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiwgZW5kaW5nIGl0cyBzZXNzaW9uIHNvXG4gICAqIHRoZSBEQiBzZXJ2ZXIgcmVsZWFzZXMgdGhlIGxvY2suIEV2ZXJ5IGNvbm5lY3Rpb24gaXMgYXR0ZW1wdGVkIGJlZm9yZSBhbnkgZmFpbHVyZVxuICAgKiBpcyBzdXJmYWNlZCwgc28gb25lIHN0dWNrIGNsb3NlIGRvZXMgbm90IGxlYXZlIHRoZSBvdGhlcnMnIGxvY2tzIGhlbGQ7IGEgZmFpbHVyZSBpc1xuICAgKiB0aGVuIHRocm93biAobmV2ZXIgc3dhbGxvd2VkKSwgYWdncmVnYXRlZCB3aGVuIG1vcmUgdGhhbiBvbmUgY29ubmVjdGlvbiBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgYWxsIGhhdmUgYmVlbiBjbG9zZWQ7IHJlamVjdHMgaWYgYW55IGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zXVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuY2xlYXIoKVxuXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBjb25uZWN0aW9ucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFjdGl2ZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBhbmQgY2xlYXJzIGdsb2JhbCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbnN0cnVjdG9ycyA9IG5ldyBTZXQoKVxuXG4gICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgICBjb25zdCBjbG9zZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gQ2xvc2UgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgZmlyc3Q6IHRoZXkgYXJlIHNwYXduZWQgb3V0c2lkZSB0aGVcbiAgICAgICAgICAvLyBwb29scycgdHJhY2tlZCBzZXRzLCBzbyBgcG9vbC5jbG9zZUFsbCgpYCB3b3VsZCBub3QgcmVhY2ggdGhlbSBhbmQgYSBsb2NrIGhlbGRcbiAgICAgICAgICAvLyBieSBhIHJ1bm5lciB0b3JuIGRvd24gbWlkLXBhc3Mgd291bGQgbGVhayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuXG4gICAgICAgICAgLy8gU3RpbGwgY2xvc2UgdGhlIHBvb2xzIGlmIHRoaXMgdGhyb3dzLCBzbyBhIHN0dWNrIGxvY2sgY29ubmVjdGlvbiBkb2VzIG5vdFxuICAgICAgICAgIC8vIGxlYXZlIHRoZSByZXN0IG9mIHRoZSBjb25uZWN0aW9ucyBvcGVuLlxuICAgICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMoKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgICAgICAgIGlmICghcG9vbCkgY29udGludWVcblxuICAgICAgICAgICAgYXdhaXQgcG9vbC5jbG9zZUFsbCgpXG5cbiAgICAgICAgICAgIGNvbnN0IFBvb2xDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9ICovIChwb29sLmNvbnN0cnVjdG9yKVxuICAgICAgICAgICAgY29uc3RydWN0b3JzLmFkZChQb29sQ2xhc3MpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZm9yIChjb25zdCBQb29sQ2xhc3Mgb2YgY29uc3RydWN0b3JzKSB7XG4gICAgICAgICAgICBQb29sQ2xhc3MuY2xlYXJHbG9iYWxDb25uZWN0aW9ucyh0aGlzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRoaXMuX2Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlLnJlc2V0KClcblxuICAgICAgICAgIC8vIEFsbG93IGZ1bGwgcmUtaW5pdGlhbGl6YXRpb24gYWZ0ZXIgY29ubmVjdGlvbnMgYXJlIGNsb3NlZC5cbiAgICAgICAgICB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiArPSAxXG4gICAgICAgICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cblxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgY2xvc2VFcnJvcnNbMF1cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoY2xvc2VFcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGJhY2tncm91bmQtam9icyBhbmQgZGF0YWJhc2UgcmVzb3VyY2VzXCIpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCByZXF1ZXN0IGF1dGhvcml6ZWQuXG4gICAqIEBwYXJhbSB7e2hlYWRlcjogKG5hbWU6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH19IHJlcXVlc3QgLSBJbmNvbWluZyByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhwZWN0ZWRUb2tlbiAtIENvbmZpZ3VyZWQgZGVidWctZW5kcG9pbnQgdG9rZW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgY2FycmllcyB0aGUgZXhwZWN0ZWQgYmVhcmVyIHRva2VuLlxuICAgKi9cbiAgZGVidWdFbmRwb2ludFJlcXVlc3RBdXRob3JpemVkKHJlcXVlc3QsIGV4cGVjdGVkVG9rZW4pIHtcbiAgICBjb25zdCBoZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImF1dGhvcml6YXRpb25cIilcblxuICAgIGlmICh0eXBlb2YgaGVhZGVyICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG1hdGNoID0gKC9eQmVhcmVyXFxzKyguKykkL2kpLmV4ZWMoaGVhZGVyLnRyaW0oKSlcblxuICAgIGlmICghbWF0Y2gpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZGVidWdFbmRwb2ludFRva2VuTWF0Y2hlcyhtYXRjaFsxXSwgZXhwZWN0ZWRUb2tlbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcGkgbWFuaWZlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHVua25vd24+Pn0gLSBBUEkgbWFuaWZlc3QgZm9yIGFsbCByZWdpc3RlcmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGdldEFwaU1hbmlmZXN0KCkge1xuICAgIHJldHVybiBmcm9udGVuZE1vZGVsQXBpTWFuaWZlc3QodGhpcy5fYmFja2VuZFByb2plY3RzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hldGhlciBBUEkgbWFuaWZlc3QgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgQVBJIG1hbmlmZXN0IGVuZHBvaW50IGlzIGVuYWJsZWQuXG4gICAqL1xuICBfYXBpTWFuaWZlc3RFbmFibGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9hcGlNYW5pZmVzdC5lbmFibGVkXG4gIH1cbn1cbiJdfQ==