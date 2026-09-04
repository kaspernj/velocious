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
     * @returns {void}
     */
    registerWebsocketChannel(name, ChannelClass) {
        if (!name)
            throw new Error("Channel name is required");
        if (!ChannelClass)
            throw new Error("ChannelClass is required");
        this._websocketChannelClasses.set(name, ChannelClass);
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
                return (previousDelivery || Promise.resolve())
                    .then(() => this._deliverWebsocketChannelBroadcast(subscription, body, deliveryMetadata))
                    .catch((error) => {
                    console.error(`broadcastToChannel: ${name} subscription ${subscription.subscriptionId} deliverBroadcast threw`, error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFBYSxNQUFNLDRCQUE0QixDQUFBO0FBQ3RELE9BQU8sRUFBRSx3QkFBd0IsRUFB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QUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyx5QkFBeUIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsYUFBYSxDQUFDLENBQUE7SUFDeEYsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxjQUFjO1FBQ2xCLE9BQU8sd0JBQXdCLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILG1CQUFtQjtRQUNqQixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFBO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZSB0eXBlLlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHsoYXJnOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0PikgPT4gUHJvbWlzZTxUPn0gV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogV2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbZGF0YWJhc2VJZGVudGlmaWVyc10gLSBEYXRhYmFzZSBpZGVudGlmaWVycyB0byBpbmNsdWRlIGluIHRoZSBjb25uZWN0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtuYW1lXSAtIEh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoZSBjaGVja2VkLW91dCBkYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAqL1xuLyoqXG4gKiBPbmUgYWRhcHRlciBpbnN0YW5jZSBhbmQgaXRzIHNlcmlhbGl6ZWQgcmVhZHkvY2xvc2UgbGlmZWN5Y2xlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy9hZGFwdGVyLmpzXCIpLmRlZmF1bHR9IGFkYXB0ZXIgLSBBZGFwdGVyIG93bmVkIGJ5IHRoaXMgZ2VuZXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY2xvc2luZyAtIFdoZXRoZXIgY2xvc2UgaGFzIGNsYWltZWQgdGhpcyBnZW5lcmF0aW9uLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSByZWFkeVByb21pc2UgLSBTaGFyZWQgcmVhZGluZXNzIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IGNsb3NlUHJvbWlzZSAtIFNoYXJlZCBjbG9zZSBvcGVyYXRpb24uXG4gKi9cblxuaW1wb3J0IHsgZGlnZyB9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IGdldHRleHRDb25maWcgZnJvbSBcImdldHRleHQtdW5pdmVyc2FsL2J1aWxkL3NyYy9jb25maWcuanNcIlxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5pbXBvcnQgdHJhbnNsYXRlIGZyb20gXCJnZXR0ZXh0LXVuaXZlcnNhbC9idWlsZC9zcmMvdHJhbnNsYXRlLmpzXCJcbmltcG9ydCBBYmlsaXR5IGZyb20gXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGZyb20gXCIuL2JhY2tncm91bmQtam9icy9hZGFwdGVyLmpzXCJcbmltcG9ydCBEYXRhYmFzZU9wZXJhdGlvbiBmcm9tIFwiLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIlxuaW1wb3J0IHsgaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHMgfSBmcm9tIFwiLi9kYXRhYmFzZS9yZWNvcmQvYXVkaXRpbmcuanNcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgZnJvbSBcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanNcIlxuaW1wb3J0IHsgQ3VycmVudENvbmZpZ3VyYXRpb25Ob3RTZXRFcnJvciwgY3VycmVudENvbmZpZ3VyYXRpb24sIHNldEN1cnJlbnRDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vY3VycmVudC1jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCB7IHJlcXVlc3REZXRhaWxzIH0gZnJvbSBcIi4vZXJyb3ItcmVwb3J0aW5nL3JlcXVlc3QtZGV0YWlscy5qc1wiXG5pbXBvcnQgTG9nUmVkYWN0b3IgZnJvbSBcIi4vbG9nLXJlZGFjdG9yLmpzXCJcbmltcG9ydCB7IGZyb250ZW5kTW9kZWxBcGlNYW5pZmVzdCwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QgfSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQgeyBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleSwgbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleSB9IGZyb20gXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiXG5pbXBvcnQgUGx1Z2luUm91dGVzIGZyb20gXCIuL3JvdXRlcy9wbHVnaW4tcm91dGVzLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRlc3RBY3Rpdml0eU5hbWUgfSBmcm9tIFwiLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1hY3Rpdml0eS5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRpbWVab25lIH0gZnJvbSBcIi4vdGltZS16b25lLmpzXCJcbmltcG9ydCB7IHdpdGhUcmFja2VkU3RhY2sgfSBmcm9tIFwiLi91dGlscy93aXRoLXRyYWNrZWQtc3RhY2suanNcIlxuaW1wb3J0IFZlbG9jaW91c1BhY2thZ2UgZnJvbSBcIi4vcGFja2FnZXMvdmVsb2Npb3VzLXBhY2thZ2UuanNcIlxuaW1wb3J0IEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlIGZyb20gXCIuL3RlbmFudHMvZnJvbnRlbmQtdGVuYW50LXNxbGl0ZS1saWZlY3ljbGUuanNcIlxuaW1wb3J0IHsgcmVzb2x2ZUdlbmVyYXRpb25JZCwgcmVzb2x2ZUluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIHJlc29sdmVMaWZlY3ljbGVTb2NrZXRQYXRoIH0gZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5cbmV4cG9ydCB7IEN1cnJlbnRDb25maWd1cmF0aW9uTm90U2V0RXJyb3IgfVxuXG4vKipcbiAqIFJ1bnMgY3VycmVudCB3b3JraW5nIGRpcmVjdG9yeS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ3VycmVudCB3b3JraW5nIGRpcmVjdG9yeSB3aGVuIHRoZSBydW50aW1lIGV4cG9zZXMgb25lLlxuICovXG5mdW5jdGlvbiBjdXJyZW50V29ya2luZ0RpcmVjdG9yeSgpIHtcbiAgY29uc3QgcHJvY2Vzc09iamVjdCA9IC8qKiBAdHlwZSB7e2N3ZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB8IHVuZGVmaW5lZH0gKi8gKGdsb2JhbFRoaXMucHJvY2VzcylcblxuICBpZiAodHlwZW9mIHByb2Nlc3NPYmplY3Q/LmN3ZCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHByb2Nlc3NPYmplY3QuY3dkKClcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgb3ZlcmxvYWRlZCB3aXRoL2Vuc3VyZSBjb25uZWN0aW9ucyBhcmd1bWVudHMuXG4gKiBAdGVtcGxhdGUgVFxuICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD4gfCB1bmRlZmluZWR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcGFyYW0ge3N0cmluZ30gZGVmYXVsdE5hbWUgLSBEZWZhdWx0IGNoZWNrb3V0IG5hbWUuXG4gKiBAcmV0dXJucyB7e2RhdGFiYXNlSWRlbnRpZmllcnM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBuYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD4gfCB1bmRlZmluZWR9fSBSZXNvbHZlZCBjaGVja291dCBvcHRpb25zIGFuZCBjYWxsYmFjay5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVdpdGhDb25uZWN0aW9uc0FyZ3Mob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrLCBkZWZhdWx0TmFtZSkge1xuICBpZiAodHlwZW9mIG9wdGlvbnNPckNhbGxiYWNrID09IFwiZnVuY3Rpb25cIikge1xuICAgIGNvbnN0IGFjdHVhbENhbGxiYWNrID0gLyoqIEB0eXBlIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59ICovIChvcHRpb25zT3JDYWxsYmFjaylcblxuICAgIHJldHVybiB7ZGF0YWJhc2VJZGVudGlmaWVyczogdW5kZWZpbmVkLCBuYW1lOiBkZWZhdWx0TmFtZSwgY2FsbGJhY2s6IGFjdHVhbENhbGxiYWNrfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhYmFzZUlkZW50aWZpZXJzOiBvcHRpb25zT3JDYWxsYmFjay5kYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgIG5hbWU6IG9wdGlvbnNPckNhbGxiYWNrLm5hbWUgfHwgZGVmYXVsdE5hbWUsXG4gICAgY2FsbGJhY2tcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgY2Fub25pY2FsIGRlYnVnIHNuYXBzaG90IHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTbmFwc2hvdCB2YWx1ZSB0byBjYW5vbmljYWxpemUuXG4gKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFNuYXBzaG90IHZhbHVlIHdpdGggb2JqZWN0IGtleXMgc29ydGVkIHJlY3Vyc2l2ZWx5LlxuICovXG5mdW5jdGlvbiBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiB2YWx1ZVxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5tYXAoKGVudHJ5KSA9PiBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoZW50cnkpKVxuXG4gIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpLnJlZHVjZSgocmVzdWx0LCBrZXkpID0+IHtcbiAgICByZXN1bHRba2V5XSA9IGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZSgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVtrZXldKVxuICAgIHJldHVybiByZXN1bHRcbiAgfSwgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7fSkpXG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gQmFzZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZSB8IFBhcnRpYWw8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGU+IHwgdm9pZH0gb3ZlcnJpZGVDb25maWd1cmF0aW9uIC0gVGVuYW50IG92ZXJyaWRlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gTWVyZ2VkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG1lcmdlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3ZlcnJpZGVDb25maWd1cmF0aW9uKSB7XG4gIGlmICghb3ZlcnJpZGVDb25maWd1cmF0aW9uKSByZXR1cm4gZGF0YWJhc2VDb25maWd1cmF0aW9uXG5cbiAgcmV0dXJuIHtcbiAgICAuLi5kYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgLi4ub3ZlcnJpZGVDb25maWd1cmF0aW9uLFxuICAgIHJlY29yZDoge1xuICAgICAgLi4uKGRhdGFiYXNlQ29uZmlndXJhdGlvbi5yZWNvcmQgfHwge30pLFxuICAgICAgLi4uKG92ZXJyaWRlQ29uZmlndXJhdGlvbi5yZWNvcmQgfHwge30pXG4gICAgfSxcbiAgICBzcWxDb25maWc6IHtcbiAgICAgIC4uLihkYXRhYmFzZUNvbmZpZ3VyYXRpb24uc3FsQ29uZmlnIHx8IHt9KSxcbiAgICAgIC4uLihvdmVycmlkZUNvbmZpZ3VyYXRpb24uc3FsQ29uZmlnIHx8IHt9KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBncmFjZSB3aW5kb3cgKG1zKSBiZWZvcmUgYSBzdXN0YWluZWQgYmVhY29uIG91dGFnZSBpcyByZXBvcnRlZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBgdW5yZWFjaGFibGVSZXBvcnRNc2AsIGlmIGFueS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGNvbmZpZ3VyZWQgdmFsdWUgd2hlbiBpdCdzIGEgZmluaXRlIG51bWJlciwgb3RoZXJ3aXNlIHRoZSAzMHMgZGVmYXVsdC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUJlYWNvblVucmVhY2hhYmxlUmVwb3J0TXModmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWVcblxuICByZXR1cm4gMzBfMDAwXG59XG5cbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfQllURVMgPSAxNiAqIDEwMjQgKiAxMDI0XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX01FU1NBR0VTID0gMjU2XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19CWVRFUyA9IDE2ICogMTAyNCAqIDEwMjRcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0ZSQU1FUyA9IDI1NlxuXG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCA9IDEwMjRcbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFkgPSA0XG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUwgPSA2XG5cbi8qKlxuICogVmFsaWRhdGVzIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0VmFsdWUgLSBEZWZhdWx0IHZhbHVlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZGF0ZWQgY29uZmlndXJlZCBvciBkZWZhdWx0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHZhbHVlLCBuYW1lLCBkZWZhdWx0VmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBkZWZhdWx0VmFsdWVcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGAke25hbWV9IG11c3QgYmUgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXJgKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFuIGludGVnZXIgY29uZmlndXJhdGlvbiB2YWx1ZSBpbnNpZGUgYW4gaW5jbHVzaXZlIHJhbmdlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbmZpZ3VyYXRpb24ga2V5LlxuICogQHBhcmFtIHtudW1iZXJ9IG1pbiAtIE1pbmltdW0gYWNjZXB0ZWQgdmFsdWUgKGluY2x1c2l2ZSkuXG4gKiBAcGFyYW0ge251bWJlcn0gbWF4IC0gTWF4aW11bSBhY2NlcHRlZCB2YWx1ZSAoaW5jbHVzaXZlKS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0VmFsdWUgLSBEZWZhdWx0IHZhbHVlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZGF0ZWQgY29uZmlndXJlZCBvciBkZWZhdWx0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBpbnRlZ2VySW5SYW5nZSh2YWx1ZSwgbmFtZSwgbWluLCBtYXgsIGRlZmF1bHRWYWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGRlZmF1bHRWYWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IG1pbiB8fCB2YWx1ZSA+IG1heCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gJHttaW59IGFuZCAke21heH1gKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyB0aGUgYnVmZmVyZWQgSFRUUCByZXNwb25zZSBjb21wcmVzc2lvbiBjb25maWd1cmF0aW9uLiBDb21wcmVzc2lvbiBpc1xuICogZW5hYmxlZCBieSBkZWZhdWx0IHdoZW4gdGhlIHNldHRpbmcgaXMgYWJzZW50OyBgZmFsc2VgIG9yIGB7ZW5hYmxlZDogZmFsc2V9YFxuICogZGlzYWJsZXMgaXQgZ2xvYmFsbHkuXG4gKiBAcGFyYW0ge2Jvb2xlYW4gfCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDb25maWd1cmVkIGNvbXByZXNzaW9uIHZhbHVlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUh0dHBDb21wcmVzc2lvbih2YWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gdHJ1ZSkge1xuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgdGhyZXNob2xkOiBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCwgYnJvdGxpUXVhbGl0eTogREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSwgZ3ppcExldmVsOiBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUx9XG4gIH1cblxuICBpZiAodmFsdWUgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgdGhyZXNob2xkOiBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCwgYnJvdGxpUXVhbGl0eTogREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSwgZ3ppcExldmVsOiBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUx9XG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbiBtdXN0IGJlIGEgYm9vbGVhbiBvciBhbiBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gIH1cblxuICBjb25zdCB7YnJvdGxpUXVhbGl0eSwgZW5hYmxlZCwgZ3ppcExldmVsLCB0aHJlc2hvbGQsIC4uLnJlc3RDb21wcmVzc2lvbn0gPSB2YWx1ZVxuICBjb25zdCByZXN0Q29tcHJlc3Npb25LZXlzID0gT2JqZWN0LmtleXMocmVzdENvbXByZXNzaW9uKVxuXG4gIGlmIChyZXN0Q29tcHJlc3Npb25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uIHJlY2VpdmVkIHVua25vd24ga2V5czogJHtyZXN0Q29tcHJlc3Npb25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYnJvdGxpUXVhbGl0eSwgZW5hYmxlZCwgZ3ppcExldmVsLCB0aHJlc2hvbGQpYClcbiAgfVxuXG4gIGlmIChlbmFibGVkICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGVuYWJsZWQgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbi5lbmFibGVkIG11c3QgYmUgYSBib29sZWFuLCBnb3Q6ICR7U3RyaW5nKGVuYWJsZWQpfWApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGVuYWJsZWQ6IGVuYWJsZWQgPz8gdHJ1ZSxcbiAgICB0aHJlc2hvbGQ6IHBvc2l0aXZlU2FmZUludGVnZXIodGhyZXNob2xkLCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24udGhyZXNob2xkXCIsIERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xEKSxcbiAgICBicm90bGlRdWFsaXR5OiBpbnRlZ2VySW5SYW5nZShicm90bGlRdWFsaXR5LCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uYnJvdGxpUXVhbGl0eVwiLCAwLCAxMSwgREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSksXG4gICAgZ3ppcExldmVsOiBpbnRlZ2VySW5SYW5nZShnemlwTGV2ZWwsIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi5nemlwTGV2ZWxcIiwgMCwgOSwgREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NvbmZpZ3VyYXRpb24ge1xuICAvKipcbiAgICogQ2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvbnMgcHJvbWlzZS5cbiAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICBfY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IG51bGxcblxuICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gIF9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zIGN1cnJlbnRseSBob2xkaW5nIGEgbG9jay4gVGhlc2UgYXJlIHNwYXduZWRcbiAgICogb3V0c2lkZSB0aGUgcG9vbHMnIHRyYWNrZWQgc2V0cyAoc28gYSBob2xkLXRpbWVvdXQgbG9jayBzdXJ2aXZlcyBwb29sIGNoZWNrb3V0cyksXG4gICAqIHNvIGBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNgIHdvdWxkIG90aGVyd2lzZSB3YWxrIHBhc3QgdGhlbTsgdHJhY2tpbmcgdGhlbSBoZXJlXG4gICAqIGxldHMgYSBzaHV0ZG93biBjbG9zZSB0aGVtIGFuZCByZWxlYXNlIHRoZSBsb2NrIGluc3RlYWQgb2Ygb3JwaGFuaW5nIGl0LlxuICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMgPSBuZXcgU2V0KClcblxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gIF9zY2hlbWFDYWNoZUdlbmVyYXRpb25zQnlSZXVzZUtleSA9IG5ldyBNYXAoKVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNDb25maWd1cmF0aW9ufSAtIFRoZSBjdXJyZW50LlxuICAgKi9cbiAgc3RhdGljIGN1cnJlbnQoKSB7XG4gICAgcmV0dXJuIGN1cnJlbnRDb25maWd1cmF0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Db25maWd1cmF0aW9uQXJnc1R5cGV9IGFyZ3MgLSBDb25maWd1cmF0aW9uIGFyZ3VtZW50cy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthYmlsaXR5UmVzb2x2ZXIsIGFiaWxpdHlSZXNvdXJjZXMsIGF0dGFjaG1lbnRzLCBhdXRvbG9hZCA9IHRydWUsIGJhY2tncm91bmRKb2JzLCBiYWNrZW5kUHJvamVjdHMsIGJlYWNvbiwgY29va2llU2VjcmV0LCBjb3JzLCBkYXRhYmFzZSwgZGVidWcgPSBmYWxzZSwgZGVidWdFbmRwb2ludCA9IGZhbHNlLCBhcGlNYW5pZmVzdCA9IGZhbHNlLCBkaXJlY3RvcnksIGVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyA9IHRydWUsIGVudmlyb25tZW50LCBlbnZpcm9ubWVudEhhbmRsZXIsIGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzLCBmcm9udGVuZFRlbmFudFNxbGl0ZSwgaHR0cFNlcnZlciwgaW5pdGlhbGl6ZU1vZGVscywgaW5pdGlhbGl6ZXJzLCBsb2NhbGUsIGxvY2FsZUZhbGxiYWNrcywgbG9jYWxlcywgbG9nZ2luZywgbWFpbGVyQmFja2VuZCwgcGFja2FnZXMsIHJlcXVlc3RUaW1lb3V0TXMsIHJvdXRlUmVzb2x2ZXJIb29rcywgc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMsIHNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMsIHN0cnVjdHVyZVNxbCwgc3luYywgdGVuYW50RGF0YWJhc2VQcm92aWRlcnMsIHRlbmFudERhdGFiYXNlUmVzb2x2ZXIsIHRlbmFudFJlc29sdmVyLCB0ZXN0aW5nLCB0aW1lWm9uZSwgdGltZXpvbmVPZmZzZXRNaW51dGVzLCB0cnVzdGVkUHJveGllcywgd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyLCB3ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5fYWJpbGl0eVJlc29sdmVyID0gYWJpbGl0eVJlc29sdmVyXG4gICAgdGhpcy5fYWJpbGl0eVJlc291cmNlcyA9IGFiaWxpdHlSZXNvdXJjZXMgfHwgW11cbiAgICB0aGlzLl9hdXRvbG9hZCA9IGF1dG9sb2FkXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnMgPSBiYWNrZ3JvdW5kSm9ic1xuICAgIHRoaXMuX2JlYWNvbiA9IGJlYWNvblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGNsaWVudCB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGNvbm5lY3QgcHJvbWlzZSB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gcmVwb3J0IHRpbWVyIHZhbHVlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gLSBQZW5kaW5nIFwiYmVhY29uIHN0aWxsIHVucmVhY2hhYmxlXCIgcmVwb3J0IHRpbWVyLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gb3V0YWdlIHJlcG9ydGVkIHZhbHVlLlxuICAgICAqIEB0eXBlIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYmVhY29uIG91dGFnZSBoYXMgYWxyZWFkeSBiZWVuIHJlcG9ydGVkLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBsYXN0IGRvd24gZXJyb3IgdmFsdWUuXG4gICAgICogQHR5cGUge3tzdGFnZTogXCJiZWFjb24tY29ubmVjdFwiIHwgXCJiZWFjb24tZGlzY29ubmVjdFwiLCBlcnJvcjogRXJyb3J9IHwgdW5kZWZpbmVkfSAtIExhdGVzdCBiZWFjb24tZG93biBkZXRhaWxzLCByZXBvcnRlZCBvbmx5IGlmIHRoZSBvdXRhZ2UgaXMgc3VzdGFpbmVkLlxuICAgICAqL1xuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyA9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzXG4gICAgdGhpcy5fYXR0YWNobWVudHMgPSBhdHRhY2htZW50cyB8fCB7fVxuICAgIC8vIENvcHkgc28gYXBwZW5kaW5nIHBhY2thZ2UtZGVyaXZlZCBlbnRyaWVzIGJlbG93IG5ldmVyIG11dGF0ZXMgYSBjYWxsZXInc1xuICAgIC8vIHNoYXJlZCBhcnJheSAoY29uZmlnIG1vZHVsZXMgY29tbW9ubHkgZXhwb3J0IGEgcmV1c2VkIGJhY2tlbmRQcm9qZWN0cyBhcnJheSkuXG4gICAgdGhpcy5fYmFja2VuZFByb2plY3RzID0gYmFja2VuZFByb2plY3RzID8gWy4uLmJhY2tlbmRQcm9qZWN0c10gOiBbXVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyVHlwZVtdfSAqL1xuICAgIHRoaXMuX2NsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVycyA9IFtdXG4gICAgdGhpcy5jb3JzID0gY29yc1xuICAgIHRoaXMuX2Nvb2tpZVNlY3JldCA9IGNvb2tpZVNlY3JldFxuICAgIHRoaXMuZGF0YWJhc2UgPSBkYXRhYmFzZVxuICAgIHRoaXMuZGVidWcgPSBkZWJ1Z1xuICAgIHRoaXMuX2RlYnVnRW5kcG9pbnQgPSB0aGlzLl9ub3JtYWxpemVEZWJ1Z0VuZHBvaW50KGRlYnVnRW5kcG9pbnQpXG4gICAgdGhpcy5fYXBpTWFuaWZlc3QgPSB0aGlzLl9ub3JtYWxpemVBcGlNYW5pZmVzdChhcGlNYW5pZmVzdClcbiAgICB0aGlzLl9lbnZpcm9ubWVudCA9IGVudmlyb25tZW50IHx8IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52LlZFTE9DSU9VU19FTlYgfHwgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuTk9ERV9FTlYgfHwgXCJkZXZlbG9wbWVudFwiXG4gICAgdGhpcy5fZW52aXJvbm1lbnRIYW5kbGVyID0gZW52aXJvbm1lbnRIYW5kbGVyXG4gICAgdGhpcy5fZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzXG4gICAgdGhpcy5fZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgPSBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9PT0gdW5kZWZpbmVkXG4gICAgICA/IHNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMgIT09IHRydWVcbiAgICAgIDogZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHNcbiAgICB0aGlzLl9kaXJlY3RvcnkgPSBkaXJlY3RvcnlcbiAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzID0gaW5pdGlhbGl6ZU1vZGVsc1xuICAgIC8qKiBAdHlwZSB7VmVsb2Npb3VzUGFja2FnZVtdfSAqL1xuICAgIHRoaXMuX3BhY2thZ2VzID0gKHBhY2thZ2VzIHx8IFtdKS5tYXAoKGVudHJ5KSA9PiBWZWxvY2lvdXNQYWNrYWdlLmZyb20oZW50cnkpKVxuXG4gICAgLy8gQXBwZW5kIGEgZGVyaXZlZCBiYWNrZW5kLXByb2plY3QgcGVyIHBhY2thZ2Ugc28gdGhlIGV4aXN0aW5nIHJlc291cmNlXG4gICAgLy8gZGlzY292ZXJ5ICsgZnJvbnRlbmQtbW9kZWwgZ2VuZXJhdGlvbiBtYWNoaW5lcnkgaW5jbHVkZXMgaXQuIFBhY2thZ2VcbiAgICAvLyBmcm9udGVuZCBtb2RlbHMgYXJlIGdlbmVyYXRlZCBpbnRvIHRoZSBhcHAncyBmcm9udGVuZC1tb2RlbHMgb3V0cHV0LlxuICAgIGNvbnN0IGFwcEZyb250ZW5kTW9kZWxzT3V0cHV0UGF0aCA9IHRoaXMuX2JhY2tlbmRQcm9qZWN0c1swXT8uZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoXG5cbiAgICBmb3IgKGNvbnN0IHZlbG9jaW91c1BhY2thZ2Ugb2YgdGhpcy5fcGFja2FnZXMpIHtcbiAgICAgIHRoaXMuX2JhY2tlbmRQcm9qZWN0cy5wdXNoKHZlbG9jaW91c1BhY2thZ2UudG9CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24oe2Zyb250ZW5kTW9kZWxzT3V0cHV0UGF0aDogYXBwRnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRofSkpXG4gICAgfVxuXG4gICAgdGhpcy5faXNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2luaXRpYWxpemVyLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gW11cbiAgICAvKiogQHR5cGUge2Jvb2xlYW59ICovXG4gICAgdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBJbnZhbGlkYXRlcyBtb2RlbCBwaGFzZXMgdGhhdCBzdGFydGVkIGJlZm9yZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBjbG9zZWQuXG4gICAgICogQHR5cGUge251bWJlcn1cbiAgICAgKi9cbiAgICB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IDBcbiAgICAvKipcbiAgICAgKiBJbi1wcm9ncmVzcyBgaW5pdGlhbGl6ZU1vZGVscygpYCBwcm9taXNlLiBNb2RlbCBpbml0aWFsaXphdGlvbiBpcyBhblxuICAgICAqIGF0b21pYyBib290c3RyYXAgcGhhc2U6IGNvbmN1cnJlbnQgY2FsbGVycyBzaGFyZSBpdCwgYW5kIGEgcmVqZWN0aW9uXG4gICAgICogbGVhdmVzIHRoZSBwaGFzZSBlbGlnaWJsZSBmb3IgYSBsYXRlciBjb21wbGV0ZSBhdHRlbXB0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogQ3VycmVudCBgaW5pdGlhbGl6ZSgpYCBwcm9taXNlLCBtZW1vaXplZCBzbyBjb25jdXJyZW50IGNhbGxlcnMgYXdhaXQgdGhlXG4gICAgICogc2FtZSBib290c3RyYXAuIFJldGFpbmVkIGFjcm9zcyBhIGNvbm5lY3Rpb24gY2xvc2UgdW50aWwgc3RhbGUgYm9vdHN0cmFwXG4gICAgICogd29yayBzZXR0bGVzLCB0aGVuIGNsZWFyZWQgYnkgaWRlbnRpdHkgYmVmb3JlIHRoZSBuZXcgZ2VuZXJhdGlvbiByZXRyaWVzLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgY29uc3Qgd2Vic29ja2V0SW5ib3VuZFF1ZXVlID0gaHR0cFNlcnZlcj8ud2Vic29ja2V0SW5ib3VuZFF1ZXVlXG4gICAgY29uc3Qgd2Vic29ja2V0T3V0Ym91bmRRdWV1ZSA9IGh0dHBTZXJ2ZXI/LndlYnNvY2tldE91dGJvdW5kUXVldWVcblxuICAgIHRoaXMuaHR0cFNlcnZlciA9IHtcbiAgICAgIC4uLihodHRwU2VydmVyIHx8IHt9KSxcbiAgICAgIGNvbXByZXNzaW9uOiBub3JtYWxpemVIdHRwQ29tcHJlc3Npb24oaHR0cFNlcnZlcj8uY29tcHJlc3Npb24pLFxuICAgICAgd2Vic29ja2V0SW5ib3VuZFF1ZXVlOiB7XG4gICAgICAgIG1heFBlbmRpbmdCeXRlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRJbmJvdW5kUXVldWU/Lm1heFBlbmRpbmdCeXRlcywgXCJodHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZS5tYXhQZW5kaW5nQnl0ZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19CWVRFUyksXG4gICAgICAgIG1heFBlbmRpbmdNZXNzYWdlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRJbmJvdW5kUXVldWU/Lm1heFBlbmRpbmdNZXNzYWdlcywgXCJodHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZS5tYXhQZW5kaW5nTWVzc2FnZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19NRVNTQUdFUylcbiAgICAgIH0sXG4gICAgICB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlOiB7XG4gICAgICAgIG1heFBlbmRpbmdCeXRlczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlPy5tYXhQZW5kaW5nQnl0ZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlLm1heFBlbmRpbmdCeXRlc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19CWVRFUyksXG4gICAgICAgIG1heFBlbmRpbmdGcmFtZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0T3V0Ym91bmRRdWV1ZT8ubWF4UGVuZGluZ0ZyYW1lcywgXCJodHRwU2VydmVyLndlYnNvY2tldE91dGJvdW5kUXVldWUubWF4UGVuZGluZ0ZyYW1lc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19GUkFNRVMpXG4gICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgaHR0cCBzZXJ2ZXIgaW5zdGFuY2UgdmFsdWUuXG4gICAgICogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90OiAoKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9jYWxlID0gbG9jYWxlXG4gICAgdGhpcy5sb2NhbGVGYWxsYmFja3MgPSBsb2NhbGVGYWxsYmFja3NcbiAgICB0aGlzLmxvY2FsZXMgPSBsb2NhbGVzXG4gICAgdGhpcy5faW5pdGlhbGl6ZXJzID0gaW5pdGlhbGl6ZXJzXG4gICAgdGhpcy5fdGVzdGluZyA9IHRlc3RpbmdcbiAgICB0aGlzLl90aW1lWm9uZSA9IHRpbWVab25lXG4gICAgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID0gdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgdGhpcy5fdHJ1c3RlZFByb3hpZXMgPSB0cnVzdGVkUHJveGllc1xuICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPSByZXF1ZXN0VGltZW91dE1zXG4gICAgdGhpcy5fc3RydWN0dXJlU3FsID0gc3RydWN0dXJlU3FsXG4gICAgdGhpcy5fc3luYyA9IHRoaXMuX25vcm1hbGl6ZVN5bmNDb25maWd1cmF0aW9uKHN5bmMpXG4gICAgdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgPSB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycyB8fCB7fVxuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIgPSB0ZW5hbnREYXRhYmFzZVJlc29sdmVyXG4gICAgdGhpcy5fdGVuYW50UmVzb2x2ZXIgPSB0ZW5hbnRSZXNvbHZlclxuICAgIHRoaXMuX3dlYnNvY2tldEV2ZW50cyA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaWJlcnMgdmFsdWUuXG4gICAgICogQHR5cGUge1ZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIgPSB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9ucyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgU2V0PGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdD4+fSAtIGNoYW5uZWxUeXBlIOKGkiBsaXZlIHN1YnNjcmlwdGlvbnMgYWNyb3NzIGFsbCBzZXNzaW9ucy5cbiAgICAgKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IGxvY2FsIChwZXItcHJvY2Vzcykgd2Vic29ja2V0IGNoYW5uZWwgYnJvYWRjYXN0IGRlbGl2ZXJpZXMsXG4gICAgICogbGF1bmNoZWQgZmlyZS1hbmQtZm9yZ2V0IGZyb20gYF9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbGAgc28gb25lIHNsb3dcbiAgICAgKiBzdWJzY3JpYmVyIG5ldmVyIGJsb2NrcyBhbm90aGVyLiBUcmFja2VkIGhlcmUgc29cbiAgICAgKiBgYXdhaXRQZW5kaW5nQnJvYWRjYXN0c2AgY2FuIHNuYXBzaG90IGFuZCBkcmFpbiB0aGVtIGJlZm9yZSBzZXR0bGluZy5cbiAgICAgKiBTZXR0bGVkIGRlbGl2ZXJpZXMgYXJlIHJlbW92ZWQgYnkgdGhlIHRyYWNraW5nLWxldmVsIGNsZWFudXAuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIExhdGVzdCBsb2NhbCBicm9hZGNhc3QgZGVsaXZlcnkgcGVyIHN1YnNjcmlwdGlvbi4gQ2hhaW5pbmcgc3Vic2VxdWVudFxuICAgICAqIGRlbGl2ZXJpZXMgcHJlc2VydmVzIGxpZmVjeWNsZSBldmVudCBvcmRlciB3aXRob3V0IGNvdXBsaW5nIHNlcGFyYXRlXG4gICAgICogc3Vic2NyaWJlcnMgdG8gb25lIGFub3RoZXIuXG4gICAgICogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0LCBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMgPSBuZXcgV2Vha01hcCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBzZXNzaW9ucyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQ+fSAtIExpdmUgd2Vic29ja2V0IHNlc3Npb25zLCBpbmNsdWRpbmcgcGF1c2VkIHNlc3Npb25zIHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93LlxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25zID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHBhdXNlZCB3ZWJzb2NrZXQgc2Vzc2lvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBncmFjZVRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiwgcGF1c2VkQXQ6IG51bWJlcn0+fSAtIHNlc3Npb25JZCDihpIgcGF1c2VkIHNlc3Npb24gYXdhaXRpbmcgcmVzdW1lLlxuICAgICAqL1xuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zID0gbmV3IE1hcCgpXG5cbiAgICAvKiogR3JhY2UgcGVyaW9kIGZvciBwYXVzZWQgV2ViU29ja2V0IHNlc3Npb25zIGJlZm9yZSBwZXJtYW5lbnQgdGVhcmRvd24uICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyA9IDMwMFxuXG4gICAgLyoqIEludGVydmFsIChzZWNvbmRzKSBiZXR3ZWVuIHNlcnZlcuKGkmNsaWVudCBoZWFydGJlYXQgcGluZ3M7IDAgZGlzYWJsZXMgcmVhcGluZyBvZiBzaWxlbnQgc29ja2V0cy4gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyA9IDMwXG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCB3cmFwcGVyIGNhbGxlZCBhcm91bmQgZXZlcnkgV2ViU29ja2V0LWJvcm5lIHJlcXVlc3QgL1xuICAgICAqIGNvbm5lY3Rpb24gbWVzc2FnZSAvIGNoYW5uZWwgZGlzcGF0Y2guIEFwcHMgcmVnaXN0ZXIgaXQgaGVyZVxuICAgICAqIHRvIHNldCB1cCBwZXItcmVxdWVzdCBjb250ZXh0IChlLmcuIEFzeW5jTG9jYWxTdG9yYWdlIGZvclxuICAgICAqIGxvY2FsZSwgdGVuYW50LCB0cmFjaW5nKSB0aGF0IGRvd25zdHJlYW0gaGFuZGxlcnMgcmVhZC5cbiAgICAgKiBAdHlwZSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9XG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0QXJvdW5kUmVxdWVzdCA9IG51bGxcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYXJvdW5kIGFjdGlvbiB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7KChjb250ZXh0OiB7cmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgcmVzcG9uc2U6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD59KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9ICovXG4gICAgdGhpcy5fYXJvdW5kQWN0aW9uID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgc2Vzc2lvbiBpZGVudGl0eSByZXNvbHZlciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9ICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIgPSBudWxsXG4gICAgdGhpcy5fbG9nZ2luZyA9IGxvZ2dpbmdcbiAgICB0aGlzLl9sb2dSZWRhY3RvciA9IG5ldyBMb2dSZWRhY3Rvcih7c2Vuc2l0aXZlTmFtZXM6IGxvZ2dpbmc/LnNlbnNpdGl2ZU5hbWVzfSlcbiAgICB0aGlzLl9tYWlsZXJCYWNrZW5kID0gbWFpbGVyQmFja2VuZFxuICAgIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcyA9IFsuLi4ocm91dGVSZXNvbHZlckhvb2tzIHx8IFtdKV1cbiAgICB0aGlzLl9hZGREZWJ1Z0VuZHBvaW50Um91dGVIb29rKClcbiAgICB0aGlzLl9hZGRBcGlNYW5pZmVzdFJvdXRlSG9vaygpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGFwcGxpZWQgcm91dGUgbW91bnRzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtXZWFrU2V0PG9iamVjdD59ICovXG4gICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2Vycm9yRXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGRhdGFiYXNlIHBvb2xzIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzID0ge31cbiAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSA9IG5ldyBGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSh7Y29uZmlndXJhdGlvbjogdGhpcywgbWF4T3BlbkhhbmRsZXM6IGZyb250ZW5kVGVuYW50U3FsaXRlPy5tYXhPcGVuSGFuZGxlc30pXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIG1vZGVsIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiB0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5tb2RlbENsYXNzZXMgPSB7fVxuXG4gICAgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5zZXRDb25maWd1cmF0aW9uKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0b2xvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIG9uIGxhenkgYWNjZXNzIGlzIGVuYWJsZWQgZ2xvYmFsbHkuXG4gICAqL1xuICBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIHRoaXMuX2F1dG9sb2FkIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhwb3NlIGludGVybmFsIGVycm9ycyB0byBjbGllbnRzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB1bmV4cGVjdGVkIGludGVybmFsIGVycm9yIGRldGFpbHMgbWF5IGJlIHJldHVybmVkIHRvIEFQSSBjbGllbnRzLlxuICAgKi9cbiAgZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSB7IHJldHVybiB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9PT0gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBmcm9udGVuZC1tb2RlbCBlcnJvcnMgZXhwb3NlIG9ubHkgZXhwbGljaXRseSBzYWZlIG1lc3NhZ2VzLlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKClgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBpbnRlcm5hbCBlcnJvciBleHBvc3VyZSBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGdldFNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMoKSB7IHJldHVybiAhdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgZW5kcG9pbnQuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERlYnVnRW5kcG9pbnQoKSB7IHJldHVybiB0aGlzLl9kZWJ1Z0VuZHBvaW50IH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBwYXRoOiBzdHJpbmcsIHRva2VuQ29uZmlndXJlZDogYm9vbGVhbn19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlnIGZvciB0aGUgc25hcHNob3QsIHdpdGggdGhlIHRva2VuIHJlZGFjdGVkLlxuICAgKi9cbiAgX2RlYnVnRW5kcG9pbnRTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdGhpcy5fZGVidWdFbmRwb2ludC5lbmFibGVkLFxuICAgICAgcGF0aDogdGhpcy5fZGVidWdFbmRwb2ludC5wYXRoLFxuICAgICAgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2RlYnVnRW5kcG9pbnQudG9rZW4pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRlYnVnIGVuZHBvaW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBkZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZURlYnVnRW5kcG9pbnQodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvdmVsb2Npb3VzL2RlYnVnXCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvdmVsb2Npb3VzL2RlYnVnXCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50LnBhdGggdG8gYmUgYSBzdHJpbmcgc3RhcnRpbmcgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocGF0aCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IHZhbHVlLnRva2VuID09PSB1bmRlZmluZWQgfHwgdmFsdWUudG9rZW4gPT09IG51bGwgPyBudWxsIDogdmFsdWUudG9rZW5cblxuICAgIGlmICh0b2tlbiAhPT0gbnVsbCAmJiAodHlwZW9mIHRva2VuICE9PSBcInN0cmluZ1wiIHx8ICF0b2tlbi50cmltKCkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlYnVnRW5kcG9pbnQudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBhcGkgbWFuaWZlc3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IHtwYXRoPzogc3RyaW5nLCB0b2tlbj86IHN0cmluZ319IHZhbHVlIC0gQVBJIG1hbmlmZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBBUEkgbWFuaWZlc3QgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVBcGlNYW5pZmVzdCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgcGF0aDogXCIvYXBpL21hbmlmZXN0XCIsIHRva2VuOiBudWxsfVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoOiBcIi9hcGkvbWFuaWZlc3RcIiwgdG9rZW46IG51bGx9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFwaU1hbmlmZXN0IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvYXBpL21hbmlmZXN0XCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC50b2tlbiB0byBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcodG9rZW4pfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoLCB0b2tlbjogdG9rZW4gPT09IG51bGwgPyBudWxsIDogdG9rZW4udHJpbSgpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGFwaSBtYW5pZmVzdCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkQXBpTWFuaWZlc3RSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9hcGlNYW5pZmVzdC5lbmFibGVkKSByZXR1cm5cblxuICAgIHRoaXMuYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gXCJHRVRcIikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChjdXJyZW50UGF0aCAhPT0gdGhpcy5fYXBpTWFuaWZlc3QucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9hcGlNYW5pZmVzdC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJzaG93XCIsXG4gICAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzQXBpTWFuaWZlc3RcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9hcGktbWFuaWZlc3QvY29udHJvbGxlci5qc1wiLFxuICAgICAgICBza2lwQ29udHJvbGxlckNvbm5lY3Rpb25zOiB0cnVlLFxuICAgICAgICBza2lwQWJpbGl0eVJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICB2aWV3UGF0aDogXCIuL2J1aWx0LWluL2FwaS1tYW5pZmVzdFwiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBkZWJ1ZyBlbmRwb2ludCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkRGVidWdFbmRwb2ludFJvdXRlSG9vaygpIHtcbiAgICBpZiAoIXRoaXMuX2RlYnVnRW5kcG9pbnQuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiR0VUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX2RlYnVnRW5kcG9pbnQucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgLy8gV2hlbiBhIHRva2VuIGlzIGNvbmZpZ3VyZWQsIGFuIHVuYXV0aGVudGljYXRlZCByZXF1ZXN0IGdldHMgbm8gcm91dGUgYXRcbiAgICAgIC8vIGFsbCAoNDA0KSByYXRoZXIgdGhhbiBhIDQwMSwgc28gdGhlIGVuZHBvaW50J3MgZXhpc3RlbmNlIHN0YXlzIGhpZGRlbi5cbiAgICAgIGlmICh0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uOiBcInNob3dcIixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNEZWJ1Z1wiLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogXCIuL2J1aWx0LWluL2RlYnVnL2NvbnRyb2xsZXIuanNcIixcbiAgICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uczogdHJ1ZSxcbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9kZWJ1Z1wiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdXRvbG9hZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyB0aGlzLl9hdXRvbG9hZCA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29ycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Db3JzVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgY29ycy5cbiAgICovXG4gIGdldENvcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGh0dHAgc2VydmVyIGNvbXByZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgYnVmZmVyZWQgcmVzcG9uc2UgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBTZXJ2ZXJDb21wcmVzc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy5odHRwU2VydmVyLmNvbXByZXNzaW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29va2llIHNlY3JldC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb29raWUgc2VjcmV0LlxuICAgKi9cbiAgZ2V0Q29va2llU2VjcmV0KCkge1xuICAgIHJldHVybiB0aGlzLl9jb29raWVTZWNyZXRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb259IC0gU3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0U3luY0NvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX3N5bmNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgb2ZmbGluZSBncmFudCBzaWduaW5nIGtleS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudFNpZ25pbmdLZXl9IC0gQ3VycmVudCBzaWduaW5nIGtleS5cbiAgICovXG4gIGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5KCkge1xuICAgIGNvbnN0IHNpZ25pbmdLZXlzID0gdGhpcy5nZXRTeW5jQ29uZmlndXJhdGlvbigpLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzXG5cbiAgICByZXR1cm4gY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoc2lnbmluZ0tleXMpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBzeW5jIC0gU3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNDb25maWd1cmF0aW9uKHN5bmMpIHtcbiAgICBjb25zdCBhcGkgPSBzeW5jPy5hcGlcbiAgICBjb25zdCBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgPSBzeW5jPy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgfHwgbnVsbFxuICAgIGNvbnN0IGNoYW5nZUZlZWRSZXRlbnRpb25TaXplID0gc3luYz8uY2hhbmdlRmVlZFJldGVudGlvblNpemVcbiAgICBjb25zdCBvZmZsaW5lR3JhbnRTaWduaW5nS2V5cyA9IHN5bmM/Lm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzIHx8IFtdXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50VHRsTXMgPSBzeW5jPy5vZmZsaW5lR3JhbnRUdGxNc1xuXG4gICAgaWYgKGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSAhPT0gbnVsbCAmJiAodHlwZW9mIGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSBtdXN0IGJlIGEgcHVibGljIEpTT04gV2ViIEtleSBvYmplY3RcIilcbiAgICB9XG4gICAgaWYgKGNoYW5nZUZlZWRSZXRlbnRpb25TaXplICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKGNoYW5nZUZlZWRSZXRlbnRpb25TaXplKSB8fCBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlclwiKVxuICAgIH1cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob2ZmbGluZUdyYW50U2lnbmluZ0tleXMpKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzIG11c3QgYmUgYW4gYXJyYXlcIilcbiAgICBpZiAob2ZmbGluZUdyYW50VHRsTXMgIT09IHVuZGVmaW5lZCAmJiAoIU51bWJlci5pc0ludGVnZXIob2ZmbGluZUdyYW50VHRsTXMpIHx8IG9mZmxpbmVHcmFudFR0bE1zIDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLm9mZmxpbmVHcmFudFR0bE1zIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyIG51bWJlciBvZiBtaWxsaXNlY29uZHNcIilcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYXBpOiB0aGlzLl9ub3JtYWxpemVTeW5jQXBpQ29uZmlndXJhdGlvbihhcGkpLFxuICAgICAgY2hhbmdlRmVlZFJldGVudGlvblNpemU6IGNoYW5nZUZlZWRSZXRlbnRpb25TaXplIHx8IDEwMDAwLFxuICAgICAgY2xpZW50OiB0aGlzLl9ub3JtYWxpemVTeW5jQ2xpZW50Q29uZmlndXJhdGlvbihzeW5jPy5jbGllbnQpLFxuICAgICAgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5LFxuICAgICAgb2ZmbGluZUdyYW50U2lnbmluZ0tleXM6IG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzLm1hcCgoa2V5KSA9PiBub3JtYWxpemVPZmZsaW5lR3JhbnRTaWduaW5nS2V5KGtleSkpLFxuICAgICAgb2ZmbGluZUdyYW50VHRsTXM6IG9mZmxpbmVHcmFudFR0bE1zIHx8IDI0ICogNjAgKiA2MCAqIDEwMDBcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBjbGllbnQtc2lkZSBzeW5jIGNvbmZpZ3VyYXRpb24gY29uc3VtZWQgYnkgYFN5bmNDbGllbnQuZnJvbUNvbmZpZ3VyYXRpb24oLi4uKWAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBjbGllbnQgLSBDbGllbnQtc2lkZSBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NsaWVudENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCBjbGllbnQtc2lkZSBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0NsaWVudENvbmZpZ3VyYXRpb24oY2xpZW50KSB7XG4gICAgaWYgKGNsaWVudCA9PT0gdW5kZWZpbmVkIHx8IGNsaWVudCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgaWYgKHR5cGVvZiBjbGllbnQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjbGllbnQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudCBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIHRyYW5zcG9ydCBhbmQgYXV0aGVudGljYXRpb25Ub2tlblwiKVxuICAgIH1cblxuICAgIGNvbnN0IHthdXRoZW50aWNhdGlvblRva2VuLCBiYXRjaFNpemUsIGlzT25saW5lLCBtb3VudFBhdGgsIG9uRXJyb3IsIHJlYWx0aW1lLCB0cmFuc3BvcnQsIHdlYnNvY2tldENsaWVudCwgd2Vic29ja2V0VXJsLCAuLi5yZXN0Q2xpZW50fSA9IGNsaWVudFxuICAgIGNvbnN0IHJlc3RDbGllbnRLZXlzID0gT2JqZWN0LmtleXMocmVzdENsaWVudClcblxuICAgIGlmIChyZXN0Q2xpZW50S2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50IHJlY2VpdmVkIHVua25vd24ga2V5czogJHtyZXN0Q2xpZW50S2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGF1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgaXNPbmxpbmUsIG1vdW50UGF0aCwgb25FcnJvciwgcmVhbHRpbWUsIHRyYW5zcG9ydCwgd2Vic29ja2V0Q2xpZW50LCB3ZWJzb2NrZXRVcmwpYClcbiAgICB9XG4gICAgaWYgKCF0cmFuc3BvcnQgfHwgdHlwZW9mIHRyYW5zcG9ydCAhPT0gXCJvYmplY3RcIiB8fCB0eXBlb2YgdHJhbnNwb3J0LnBvc3QgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQudHJhbnNwb3J0IG11c3QgYmUgYW4gb2JqZWN0IHdpdGggYSBwb3N0KHBhdGgsIGJvZHkpIG1ldGhvZCAobGlrZSB0aGUgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNsaWVudClcIilcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBhdXRoZW50aWNhdGlvblRva2VuICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LmF1dGhlbnRpY2F0aW9uVG9rZW4gbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgYXV0aCB0b2tlbiBzZW50IHdpdGggc3luYyByZXF1ZXN0c1wiKVxuICAgIH1cbiAgICBpZiAoaXNPbmxpbmUgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaXNPbmxpbmUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuaXNPbmxpbmUgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyBjb25uZWN0aXZpdHlcIilcbiAgICB9XG4gICAgaWYgKG9uRXJyb3IgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygb25FcnJvciAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vbkVycm9yIG11c3QgYmUgYSBmdW5jdGlvbiByZXBvcnRpbmcgYmFja2dyb3VuZCBzeW5jIGZhaWx1cmVzXCIpXG4gICAgfVxuICAgIGlmIChiYXRjaFNpemUgIT09IHVuZGVmaW5lZCAmJiAoIU51bWJlci5pc0ludGVnZXIoYmF0Y2hTaXplKSB8fCBiYXRjaFNpemUgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LmJhdGNoU2l6ZSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlclwiKVxuICAgIH1cbiAgICBpZiAobW91bnRQYXRoICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtb3VudFBhdGggIT09IFwic3RyaW5nXCIgfHwgIW1vdW50UGF0aC5zdGFydHNXaXRoKFwiL1wiKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQubW91bnRQYXRoIG11c3Qgc3RhcnQgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcobW91bnRQYXRoKX1gKVxuICAgIH1cbiAgICBpZiAod2Vic29ja2V0Q2xpZW50ICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiB3ZWJzb2NrZXRDbGllbnQgIT09IFwib2JqZWN0XCIgfHwgd2Vic29ja2V0Q2xpZW50ID09PSBudWxsIHx8IHR5cGVvZiB3ZWJzb2NrZXRDbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQud2Vic29ja2V0Q2xpZW50IG11c3QgYmUgYSB3ZWJzb2NrZXQgY2xpZW50IHdpdGggYSBzdWJzY3JpYmVDaGFubmVsIG1ldGhvZCAobGlrZSBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQpXCIpXG4gICAgfVxuICAgIGlmICh3ZWJzb2NrZXRVcmwgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygd2Vic29ja2V0VXJsICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB3ZWJzb2NrZXRVcmwgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC53ZWJzb2NrZXRVcmwgbXVzdCBiZSBhIFVSTCBzdHJpbmcgb3IgYSBmdW5jdGlvbiByZXNvbHZpbmcgb25lLCBnb3Q6ICR7U3RyaW5nKHdlYnNvY2tldFVybCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZSxcbiAgICAgIGlzT25saW5lLFxuICAgICAgbW91bnRQYXRoOiAobW91bnRQYXRoIHx8IFwiL3ZlbG9jaW91cy9zeW5jXCIpLnJlcGxhY2UoL1xcLyskL3UsIFwiXCIpIHx8IFwiL1wiLFxuICAgICAgb25FcnJvcixcbiAgICAgIHJlYWx0aW1lLFxuICAgICAgdHJhbnNwb3J0LFxuICAgICAgd2Vic29ja2V0Q2xpZW50LFxuICAgICAgd2Vic29ja2V0VXJsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgc3luYyBBUEkgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0FwaUNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IGFwaSAtIFN5bmMgQVBJIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0FwaUNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCBzeW5jIEFQSSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNBcGlDb25maWd1cmF0aW9uKGFwaSkge1xuICAgIGlmIChhcGkgPT09IHVuZGVmaW5lZCB8fCBhcGkgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGlmICh0eXBlb2YgYXBpICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYXBpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5hcGkgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBhIHJlc291cmNlQ2xhc3NcIilcbiAgICB9XG5cbiAgICBjb25zdCB7bW91bnRQYXRoLCByZXNvdXJjZUNsYXNzfSA9IGFwaVxuXG4gICAgaWYgKHR5cGVvZiByZXNvdXJjZUNsYXNzICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5hcGkucmVzb3VyY2VDbGFzcyBtdXN0IGJlIGEgcmVzb3VyY2UgY2xhc3MsIGdvdDogJHtTdHJpbmcocmVzb3VyY2VDbGFzcyl9YClcbiAgICB9XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzLk1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5hcGkucmVzb3VyY2VDbGFzcyAke3Jlc291cmNlQ2xhc3MubmFtZX0gbXVzdCBkZWZpbmUgc3RhdGljIE1vZGVsQ2xhc3NgKVxuICAgIH1cbiAgICBpZiAobW91bnRQYXRoICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtb3VudFBhdGggIT09IFwic3RyaW5nXCIgfHwgIW1vdW50UGF0aC5zdGFydHNXaXRoKFwiL1wiKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5hcGkubW91bnRQYXRoIG11c3Qgc3RhcnQgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcobW91bnRQYXRoKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7bW91bnRQYXRoLCByZXNvdXJjZUNsYXNzfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZT59IC0gVGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG5cbiAgICBpZiAoIXRoaXMuZGF0YWJhc2VbdGhpcy5nZXRFbnZpcm9ubWVudCgpXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBkYXRhYmFzZSBjb25maWd1cmF0aW9uIGZvciBlbnZpcm9ubWVudDogJHt0aGlzLmdldEVudmlyb25tZW50KCl9IC0gJHtPYmplY3Qua2V5cyh0aGlzLmRhdGFiYXNlKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFiYXNlXCIsIHRoaXMuZ2V0RW52aXJvbm1lbnQoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIFJlc29sdmVkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgcmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihpZGVudGlmaWVyLCB0ZW5hbnQgPSB0aGlzLmdldEN1cnJlbnRUZW5hbnQoKSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKClbaWRlbnRpZmllcl1cblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggZGF0YWJhc2UgaWRlbnRpZmllciBjb25maWd1cmVkOiAke2lkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBpZiAodGVuYW50ID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIpIHtcbiAgICAgIHJldHVybiBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cbiAgICB9XG5cbiAgICBjb25zdCBvdmVycmlkZUNvbmZpZ3VyYXRpb24gPSB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICBpZGVudGlmaWVyLFxuICAgICAgdGVuYW50XG4gICAgfSlcblxuICAgIHJldHVybiBtZXJnZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG92ZXJyaWRlQ29uZmlndXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkaXNhYmxlZCBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIERpc2FibGVkIGRhdGFiYXNlIGlkZW50aWZpZXJzIGZyb20gZW52IGZsYWdzLlxuICAgKi9cbiAgZ2V0RGlzYWJsZWREYXRhYmFzZUlkZW50aWZpZXJzKCkge1xuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnMgPSBuZXcgU2V0KClcbiAgICBjb25zdCBkaXNhYmxlZElkZW50aWZpZXJzUmF3ID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RJU0FCTEVEX0RBVEFCQVNFX0lERU5USUZJRVJTXG5cbiAgICBpZiAoZGlzYWJsZWRJZGVudGlmaWVyc1Jhdykge1xuICAgICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGRpc2FibGVkSWRlbnRpZmllcnNSYXcuc3BsaXQoXCIsXCIpKSB7XG4gICAgICAgIGNvbnN0IHRyaW1tZWQgPSBpZGVudGlmaWVyLnRyaW0oKVxuXG4gICAgICAgIGlmICh0cmltbWVkKSBkaXNhYmxlZElkZW50aWZpZXJzLmFkZCh0cmltbWVkKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRElTQUJMRV9NU1NRTCA9PT0gXCIxXCIpIHtcbiAgICAgIGRpc2FibGVkSWRlbnRpZmllcnMuYWRkKFwibXNzcWxcIilcbiAgICB9XG5cbiAgICByZXR1cm4gZGlzYWJsZWRJZGVudGlmaWVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZGF0YWJhc2UgaWRlbnRpZmllciBhY3RpdmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW3RlbmFudF0gLSBUZW5hbnQgb3ZlcnJpZGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBkYXRhYmFzZSBpZGVudGlmaWVyIGlzIGFjdGl2ZSBpbiB0aGUgY3VycmVudCB0ZW5hbnQgY29udGV4dC5cbiAgICovXG4gIGlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIsIHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpKSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVtpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBkYXRhYmFzZSBpZGVudGlmaWVyIGNvbmZpZ3VyZWQ6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLnRlbmFudE9ubHkpIHJldHVybiB0cnVlXG4gICAgaWYgKHRlbmFudCA9PT0gdW5kZWZpbmVkIHx8ICF0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG92ZXJyaWRlQ29uZmlndXJhdGlvbiA9IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgIGlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuXG4gICAgcmV0dXJuIEJvb2xlYW4ob3ZlcnJpZGVDb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gLSBUaGUgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXJzKCkge1xuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gT2JqZWN0LmtleXModGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKSlcbiAgICBjb25zdCBkaXNhYmxlZElkZW50aWZpZXJzID0gdGhpcy5nZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKVxuXG4gICAgcmV0dXJuIGlkZW50aWZpZXJzLmZpbHRlcigoaWRlbnRpZmllcikgPT4gIWRpc2FibGVkSWRlbnRpZmllcnMuaGFzKGlkZW50aWZpZXIpICYmIHRoaXMuaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllcikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gSHVtYW4tcmVhZGFibGUgc2VydmVyIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgYXN5bmMgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBsb2NhbFNuYXBzaG90ID0gdGhpcy5nZXRMb2NhbERlYnVnU25hcHNob3QoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmxvY2FsU25hcHNob3QsXG4gICAgICBodHRwU2VydmVyOiBhd2FpdCB0aGlzLl9kZWJ1Z0h0dHBTZXJ2ZXJTbmFwc2hvdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2FsIGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEh1bWFuLXJlYWRhYmxlIGRpYWdub3N0aWNzIGZvciB0aGlzIHByb2Nlc3Mgb25seS5cbiAgICovXG4gIGdldExvY2FsRGVidWdTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYmFja2dyb3VuZEpvYnM6IHRoaXMuX2RlYnVnQmFja2dyb3VuZEpvYnNTbmFwc2hvdCgpLFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5fZGVidWdDb25maWd1cmF0aW9uU25hcHNob3QoKSxcbiAgICAgIGRhdGFiYXNlOiB0aGlzLl9kZWJ1Z0RhdGFiYXNlU25hcHNob3QoKSxcbiAgICAgIGdlbmVyYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBzZXJ2ZXI6IHRoaXMuX2RlYnVnU2VydmVyU25hcHNob3QoKSxcbiAgICAgIHdlYnNvY2tldHM6IHRoaXMuX2RlYnVnV2Vic29ja2V0U25hcHNob3QoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGh0dHAgc2VydmVyIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEhUVFAgc2VydmVyIHdvcmtlciBkaWFnbm9zdGljcy5cbiAgICovXG4gIGFzeW5jIF9kZWJ1Z0h0dHBTZXJ2ZXJTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBodHRwU2VydmVyID0gLyoqIEB0eXBlIHt7Z2V0RGVidWdTbmFwc2hvdD86ICgpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gfCB1bmRlZmluZWR9ICovICh0aGlzLl9odHRwU2VydmVySW5zdGFuY2UpXG5cbiAgICBpZiAoIWh0dHBTZXJ2ZXI/LmdldERlYnVnU25hcHNob3QpIHtcbiAgICAgIHJldHVybiB7Y29uZmlndXJlZDogQm9vbGVhbih0aGlzLmh0dHBTZXJ2ZXIpLCBhY3RpdmU6IGZhbHNlfVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBodHRwU2VydmVyLmdldERlYnVnU25hcHNob3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgc2VydmVyIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFNlcnZlciBydW50aW1lIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnU2VydmVyU25hcHNob3QoKSB7XG4gICAgY29uc3Qgbm9kZVByb2Nlc3MgPSB0eXBlb2YgcHJvY2VzcyA9PT0gXCJ1bmRlZmluZWRcIiA/IHVuZGVmaW5lZCA6IHByb2Nlc3NcblxuICAgIHJldHVybiB7XG4gICAgICBlbnZpcm9ubWVudDogdGhpcy5nZXRFbnZpcm9ubWVudCgpLFxuICAgICAgbWVtb3J5VXNhZ2U6IG5vZGVQcm9jZXNzID8gbm9kZVByb2Nlc3MubWVtb3J5VXNhZ2UoKSA6IHVuZGVmaW5lZCxcbiAgICAgIG5vZGVWZXJzaW9uOiBub2RlUHJvY2Vzcz8udmVyc2lvbnM/Lm5vZGUsXG4gICAgICBwaWQ6IG5vZGVQcm9jZXNzPy5waWQsXG4gICAgICBwbGF0Zm9ybTogbm9kZVByb2Nlc3M/LnBsYXRmb3JtLFxuICAgICAgdXB0aW1lU2Vjb25kczogbm9kZVByb2Nlc3MgPyBub2RlUHJvY2Vzcy51cHRpbWUoKSA6IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGNvbmZpZ3VyYXRpb24gc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29uZmlndXJhdGlvbiBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXBpTWFuaWZlc3Q6IHRoaXMuX2FwaU1hbmlmZXN0RW5hYmxlZCgpID8ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IHRoaXMuX2FwaU1hbmlmZXN0LnBhdGgsIHRva2VuQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9hcGlNYW5pZmVzdC50b2tlbil9IDoge2VuYWJsZWQ6IGZhbHNlfSxcbiAgICAgIGF1dG9sb2FkOiB0aGlzLmdldEF1dG9sb2FkKCksXG4gICAgICBkZWJ1ZzogdGhpcy5kZWJ1ZyA9PT0gdHJ1ZSxcbiAgICAgIGRlYnVnRW5kcG9pbnQ6IHRoaXMuX2RlYnVnRW5kcG9pbnRTbmFwc2hvdCgpLFxuICAgICAgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzOiB0aGlzLmdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpLFxuICAgICAgZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHM6IHRoaXMuZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSxcbiAgICAgIGluaXRpYWxpemVkOiB0aGlzLl9pc0luaXRpYWxpemVkLFxuICAgICAgbG9nZ2luZzoge1xuICAgICAgICBkZWJ1Z0xvd0xldmVsOiB0aGlzLl9sb2dnaW5nPy5kZWJ1Z0xvd0xldmVsID09PSB0cnVlLFxuICAgICAgICBvdXRwdXRzOiB0aGlzLl9sb2dnaW5nID8gT2JqZWN0LmtleXModGhpcy5fbG9nZ2luZykgOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGJhY2tncm91bmQgam9icyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBCYWNrZ3JvdW5kIGpvYiBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0JhY2tncm91bmRKb2JzU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fYmFja2dyb3VuZEpvYnMpLFxuICAgICAgc2NoZWR1bGVkQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBkYXRhYmFzZSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0RhdGFiYXNlU25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogRGF0YWJhc2UgcG9vbHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLkRhdGFiYXNlUG9vbERlYnVnU25hcHNob3Q+fSAqL1xuICAgIGNvbnN0IGRhdGFiYXNlUG9vbHMgPSB7fVxuICAgIGNvbnN0IGFjdGl2ZUlkZW50aWZpZXJzID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBhY3RpdmVJZGVudGlmaWVycykge1xuICAgICAgZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmdldERlYnVnU25hcHNob3QoKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhY3RpdmVJZGVudGlmaWVycyxcbiAgICAgIGRpc2FibGVkSWRlbnRpZmllcnM6IEFycmF5LmZyb20odGhpcy5nZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSksXG4gICAgICBpbml0aWFsaXplZFBvb2xzOiBPYmplY3Qua2V5cyh0aGlzLmRhdGFiYXNlUG9vbHMpLFxuICAgICAgcG9vbHM6IGRhdGFiYXNlUG9vbHNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyB3ZWJzb2NrZXQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2ViU29ja2V0IGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnV2Vic29ja2V0U25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBidWNrZXRzLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y291bnQ6IG51bWJlciwgZGV0YWlsczoge2NoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogbnVtYmVyLCBjaGFubmVsU3Vic2NyaXB0aW9uczoge2NoYW5uZWxUeXBlOiBzdHJpbmcsIGNvdW50OiBudW1iZXIsIG1vZGVsOiBzdHJpbmcgfCBudWxsfVtdLCBjb25uZWN0aW9uQ291bnQ6IG51bWJlciwgcGF1c2VkOiBib29sZWFuLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfX0+fSAqL1xuICAgIGNvbnN0IHNlc3Npb25CdWNrZXRzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBkZXRhaWxzLlxuICAgICAqIEB0eXBlIHt7Y2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXIsIGNoYW5uZWxTdWJzY3JpcHRpb25zOiB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9W10sIGNvbm5lY3Rpb25Db3VudDogbnVtYmVyLCBwYXVzZWQ6IGJvb2xlYW4sIHF1ZXVlZE1lc3NhZ2VDb3VudDogbnVtYmVyLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IHNlc3Npb25EZXRhaWxzID0gW11cbiAgICBjb25zdCBzdWJzY3JpcHRpb25zID0gQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5lbnRyaWVzKCkpLm1hcCgoW2NoYW5uZWwsIGNoYW5uZWxTdWJzY3JpcHRpb25zXSkgPT4ge1xuICAgICAgLyoqXG4gICAgICAgKiBEZXRhaWxzIGJ1Y2tldHMuXG4gICAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2NvdW50OiBudW1iZXIsIGRldGFpbHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgICAgY29uc3QgZGV0YWlsc0J1Y2tldHMgPSBuZXcgTWFwKClcblxuICAgICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgY2hhbm5lbFN1YnNjcmlwdGlvbnMpIHtcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpKVxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShkZXRhaWxzKVxuICAgICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IGRldGFpbHNCdWNrZXRzLmdldChrZXkpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRldGFpbHNCdWNrZXRzLnNldChrZXksIHtjb3VudDogMSwgZGV0YWlsc30pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgY291bnQ6IGNoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGRldGFpbHM6IEFycmF5LmZyb20oZGV0YWlsc0J1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IHNlc3Npb24gb2YgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogQ2hhbm5lbCBzdWJzY3JpcHRpb24gYnVja2V0cy5cbiAgICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9Pn0gKi9cbiAgICAgIGNvbnN0IGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzID0gbmV3IE1hcCgpXG5cbiAgICAgIGZvciAoY29uc3Qge2NoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb259IG9mIHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICAgIGNvbnN0IGRldGFpbHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpXG4gICAgICAgIGNvbnN0IG1vZGVsID0gdHlwZW9mIGRldGFpbHMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBkZXRhaWxzLm1vZGVsIDogbnVsbFxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeSh7Y2hhbm5lbFR5cGUsIG1vZGVsfSlcbiAgICAgICAgY29uc3QgZXhpc3RpbmdCdWNrZXQgPSBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5nZXQoa2V5KVxuXG4gICAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5zZXQoa2V5LCB7Y2hhbm5lbFR5cGUsIGNvdW50OiAxLCBtb2RlbH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBBcnJheS5mcm9tKGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudClcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0ge1xuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNlc3Npb24uX2Nvbm5lY3Rpb25zLnNpemUsXG4gICAgICAgIHBhdXNlZDogc2Vzc2lvbi5fcGF1c2VkLFxuICAgICAgICBxdWV1ZWRNZXNzYWdlQ291bnQ6IHNlc3Npb24uX291dGJvdW5kUXVldWUubGVuZ3RoLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc2Vzc2lvbi5zdWJzY3JpcHRpb25zLnNpemVcbiAgICAgIH1cbiAgICAgIGNvbnN0IGJ1Y2tldEtleSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zOiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgY29ubmVjdGlvbkNvdW50OiBzbmFwc2hvdC5jb25uZWN0aW9uQ291bnQsXG4gICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc25hcHNob3Quc3Vic2NyaXB0aW9uQ291bnRcbiAgICAgIH0pXG4gICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IHNlc3Npb25CdWNrZXRzLmdldChidWNrZXRLZXkpXG5cbiAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXNzaW9uQnVja2V0cy5zZXQoYnVja2V0S2V5LCB7XG4gICAgICAgICAgY291bnQ6IDEsXG4gICAgICAgICAgZGV0YWlsczoge1xuICAgICAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uczogc25hcHNob3QuY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNuYXBzaG90LmNvbm5lY3Rpb25Db3VudCxcbiAgICAgICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LnN1YnNjcmlwdGlvbkNvdW50XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgc2Vzc2lvbkRldGFpbHMucHVzaChzbmFwc2hvdClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcGF1c2VkU2Vzc2lvbnM6IHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLnNpemUsXG4gICAgICByZWdpc3RlcmVkQ2hhbm5lbHM6IEFycmF5LmZyb20odGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMua2V5cygpKSxcbiAgICAgIHJlZ2lzdGVyZWRDb25uZWN0aW9uczogQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3Nlcy5rZXlzKCkpLFxuICAgICAgc2Vzc2lvbkJ1Y2tldHM6IEFycmF5LmZyb20oc2Vzc2lvbkJ1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KSxcbiAgICAgIHNlc3Npb25Db3VudDogdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMuc2l6ZSxcbiAgICAgIHNlc3Npb25zOiBzZXNzaW9uRGV0YWlscy5zb3J0KChhLCBiKSA9PiBiLmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCAtIGEuY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50KSxcbiAgICAgIHN1YnNjcmlwdGlvbkdyb3VwczogdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgIHN1YnNjcmlwdGlvbnNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZGF0YWJhc2UgcG9vbC5cbiAgICovXG4gIGdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBpZiAoIXRoaXMuaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZChpZGVudGlmaWVyKSkge1xuICAgICAgdGhpcy5pbml0aWFsaXplRGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpZ2codGhpcywgXCJkYXRhYmFzZVBvb2xzXCIsIGlkZW50aWZpZXIpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZnJhbWV3b3JrLW93bmVkIGZyb250ZW5kIHRlbmFudCBTUUxpdGUgbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGV9IC0gTGlmZWN5Y2xlIG93bmVyLlxuICAgKi9cbiAgZ2V0RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoKSB7IHJldHVybiB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc2FmZSBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZVtcImluc3BlY3RBbGxcIl0+fSAtIExpZmVjeWNsZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIGluc3BlY3RGcm9udGVuZFRlbmFudFNxbGl0ZUhhbmRsZXMoKSB7IHJldHVybiB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZS5pbnNwZWN0QWxsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0pXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllcikge1xuICAgIHJldHVybiB0aGlzLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oaWRlbnRpZmllcilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIHNjaGVtYSBtZXRhZGF0YSBjYWNoZWQgYnkgZXZlcnkgaW5pdGlhbGl6ZWQgcG9vbCB0aGF0IHRhcmdldHMgdGhlXG4gICAqIHNhbWUgcGh5c2ljYWwgZGF0YWJhc2UgKG1hdGNoZWQgYnkgY29ubmVjdGlvbiByZXVzZSBrZXkpLiBTZXBhcmF0ZSBwb29scyB0aGF0XG4gICAqIHBvaW50IGF0IG9uZSBkYXRhYmFzZSBrZWVwIGluZGVwZW5kZW50IHNjaGVtYSBjYWNoZXMsIHNvIERETCBydW4gdGhyb3VnaCBvbmVcbiAgICogcG9vbCB3b3VsZCBvdGhlcndpc2UgbGVhdmUgdGhlIG90aGVycyByZXBvcnRpbmcgc3RhbGUgdGFibGVzL2NvbHVtbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIENvbm5lY3Rpb24gcmV1c2Uga2V5IGlkZW50aWZ5aW5nIHRoZSBzaGFyZWQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGVzRm9yUmV1c2VLZXkocmV1c2VLZXkpIHtcbiAgICB0aGlzLl9zY2hlbWFDYWNoZUdlbmVyYXRpb25zQnlSZXVzZUtleS5zZXQoXG4gICAgICByZXVzZUtleSxcbiAgICAgIHRoaXMuc2NoZW1hQ2FjaGVHZW5lcmF0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpICsgMVxuICAgIClcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleSgpID09PSByZXVzZUtleSkge1xuICAgICAgICBwb29sLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IHNjaGVtYS1jYWNoZSBnZW5lcmF0aW9uIGZvciBvbmUgcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIENvbm5lY3Rpb24gcmV1c2Uga2V5IGlkZW50aWZ5aW5nIHRoZSBzaGFyZWQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQ3VycmVudCBzY2hlbWEtY2FjaGUgZ2VuZXJhdGlvbi5cbiAgICovXG4gIHNjaGVtYUNhY2hlR2VuZXJhdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNhY2hlR2VuZXJhdGlvbnNCeVJldXNlS2V5LmdldChyZXVzZUtleSkgfHwgMFxuICB9XG5cbiAgLyoqXG4gICAqIEludmFsaWRhdGVzIHJlY29yZCBtZXRhZGF0YSBvd25lZCBieSBvbmUgY2xvc2VkL2RlbGV0ZWQgcGh5c2ljYWwgdGVuYW50XG4gICAqIGRhdGFiYXNlIHdoaWxlIHByZXNlcnZpbmcgZXZlcnkgb3RoZXIgdGVuYW50IGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gTG9naWNhbCBpZGVudGlmaWVyIHBsdXMgcG9vbCByZXVzZSBrZXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJSZWNvcmRNZXRhZGF0YUZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBPYmplY3QudmFsdWVzKHRoaXMubW9kZWxDbGFzc2VzKSkge1xuICAgICAgbW9kZWxDbGFzcy5jbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzRm9yRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBwb29sIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBkYXRhYmFzZSBwb29sIHR5cGUuXG4gICAqL1xuICBnZXREYXRhYmFzZVBvb2xUeXBlKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGNvbnN0IHBvb2xUeXBlQ2xhc3MgPSBkaWdnKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGlkZW50aWZpZXIpLCBcInBvb2xUeXBlXCIpXG5cbiAgICBpZiAoIXBvb2xUeXBlQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIHBvb2xUeXBlIGdpdmVuIGluIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5yZXNvbHZlVGVzdFNoYXJlZFRyYW5zYWN0aW9uUG9vbFR5cGUoe1xuICAgICAgY29uZmlndXJlZFBvb2xUeXBlOiBwb29sVHlwZUNsYXNzLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiBpZGVudGlmaWVyXG4gICAgfSlcbiAgfVxuXG4gIGdldERhdGFiYXNlVHlwZShpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBjb25zdCBkYXRhYmFzZVR5cGUgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKS50eXBlXG5cbiAgICBpZiAoIWRhdGFiYXNlVHlwZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YWJhc2UgdHlwZSBnaXZlbiBpbiBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG5cbiAgICByZXR1cm4gZGF0YWJhc2VUeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBkaXJlY3RvcnkuXG4gICAqL1xuICBnZXREaXJlY3RvcnkoKSB7XG4gICAgY29uc3QgZGlyZWN0b3J5ID0gdGhpcy5nZXREaXJlY3RvcnlJZkF2YWlsYWJsZSgpXG5cbiAgICBpZiAoIWRpcmVjdG9yeSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGlyZWN0b3J5IGNvbmZpZ3VyZWQgYW5kIHByb2Nlc3MuY3dkIGlzIHVuYXZhaWxhYmxlXCIpXG5cbiAgICByZXR1cm4gZGlyZWN0b3J5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGlyZWN0b3J5IGlmIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgZGlyZWN0b3J5IHdoZW4gdGhlIHJ1bnRpbWUgY2FuIHJlc29sdmUgb25lLlxuICAgKi9cbiAgZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKSB7XG4gICAgaWYgKCF0aGlzLl9kaXJlY3RvcnkpIHtcbiAgICAgIHRoaXMuX2RpcmVjdG9yeSA9IGN1cnJlbnRXb3JraW5nRGlyZWN0b3J5KClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGlyZWN0b3J5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmFja2VuZCBwcm9qZWN0cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb25bXX0gLSBCYWNrZW5kIHByb2plY3RzLlxuICAgKi9cbiAgZ2V0QmFja2VuZFByb2plY3RzKCkgeyByZXR1cm4gdGhpcy5fYmFja2VuZFByb2plY3RzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcGFja2FnZXMuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNQYWNrYWdlW119IC0gUmVnaXN0ZXJlZCBWZWxvY2lvdXMgcGFja2FnZXMuXG4gICAqL1xuICBnZXRQYWNrYWdlcygpIHsgcmV0dXJuIHRoaXMuX3BhY2thZ2VzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYWJpbGl0eSByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IC0gQWJpbGl0eSByZXNvdXJjZSBjbGFzc2VzLlxuICAgKi9cbiAgZ2V0QWJpbGl0eVJlc291cmNlcygpIHsgcmV0dXJuIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhYmlsaXR5IHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IHJlc291cmNlcyAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QWJpbGl0eVJlc291cmNlcyhyZXNvdXJjZXMpIHsgdGhpcy5fYWJpbGl0eVJlc291cmNlcyA9IHJlc291cmNlcyB9XG5cbiAgLyoqXG4gICAqIE1lcmdlcyByZXNvdXJjZSBjbGFzc2VzIGRpc2NvdmVyZWQgZnJvbSB0aGUgYXBwIGFuZCBldmVyeSByZWdpc3RlcmVkIHBhY2thZ2VcbiAgICogaW50byB0aGUgYWJpbGl0eS1yZXNvdXJjZXMgbGlzdC4gYGF1dG9EaXNjb3ZlclJlc291cmNlc2AgcG9wdWxhdGVzIGVhY2ggYmFja2VuZFxuICAgKiBwcm9qZWN0J3MgYGZyb250ZW5kTW9kZWxzYCAoaW5jbHVkaW5nIHBhY2thZ2UgcHJvamVjdHMpLCBzbyB0aGlzIG1ha2VzIGFcbiAgICogcGFja2FnZS1jb250cmlidXRlZCBtb2RlbCdzIGFiaWxpdGllcyByZWFjaCBzdWJzY3JpcHRpb24gYW5kIHBlci1yZWNvcmRcbiAgICogYXV0aG9yaXphdGlvbiBhdXRvbWF0aWNhbGx5IOKAlCBjb25zdW1pbmcgYXBwcyBkbyBub3QgaGF2ZSB0byBoYW5kLXJlZ2lzdGVyXG4gICAqIHBhY2thZ2UgcmVzb3VyY2VzLiBBbHJlYWR5LXByZXNlbnQgY2xhc3NlcyAoZS5nLiBhbiBhcHAncyBleHBsaWNpdGx5LXNldFxuICAgKiByZXNvdXJjZXMpIGFyZSBsZWZ0IHVudG91Y2hlZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX21lcmdlRGlzY292ZXJlZEFiaWxpdHlSZXNvdXJjZXMoKSB7XG4gICAgY29uc3QgbWVyZ2VkID0gWy4uLnRoaXMuX2FiaWxpdHlSZXNvdXJjZXNdXG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQobWVyZ2VkKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLl9iYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGlmICghYmFja2VuZFByb2plY3QuYWJpbGl0eVJlc291cmNlcykgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCBSZXNvdXJjZUNsYXNzIG9mIGJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMpIHtcbiAgICAgICAgaWYgKHNlZW4uaGFzKFJlc291cmNlQ2xhc3MpKSBjb250aW51ZVxuXG4gICAgICAgIHNlZW4uYWRkKFJlc291cmNlQ2xhc3MpXG4gICAgICAgIG1lcmdlZC5wdXNoKFJlc291cmNlQ2xhc3MpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fYWJpbGl0eVJlc291cmNlcyA9IG1lcmdlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBBYmlsaXR5IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0QWJpbGl0eVJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fYWJpbGl0eVJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUZW5hbnQgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRUZW5hbnRSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX3RlbmFudFJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICovXG4gIGdldFRlbmFudERhdGFiYXNlUmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZW5mb3JjZSB0ZW5hbnQgZGF0YWJhc2Ugc2NvcGVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgcmVxdWlyZSBhIHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCkgeyByZXR1cm4gdGhpcy5fZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZT59IC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlcnMuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycygpIHsgcmV0dXJuIHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlci5cbiAgICovXG4gIGdldFRlbmFudERhdGFiYXNlUHJvdmlkZXIoaWRlbnRpZmllcikge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnNbaWRlbnRpZmllcl1cblxuICAgIGlmICghcHJvdmlkZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGNvbmZpZ3VyZWQgZm9yIGRhdGFiYXNlIGlkZW50aWZpZXI6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIHJldHVybiBwcm92aWRlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnRzIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXR0YWNobWVudHNDb25maWd1cmF0aW9ufSAtIEF0dGFjaG1lbnRzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRBdHRhY2htZW50c0NvbmZpZ3VyYXRpb24oKSB7IHJldHVybiB0aGlzLl9hdHRhY2htZW50cyB8fCB7fSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJvdXRlUmVzb2x2ZXJIb29rVHlwZVtdfSAtIFJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKi9cbiAgZ2V0Um91dGVSZXNvbHZlckhvb2tzKCkgeyByZXR1cm4gdGhpcy5fcm91dGVSZXNvbHZlckhvb2tzIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgcm91dGUgcmVzb2x2ZXIgaG9vay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUm91dGVSZXNvbHZlckhvb2tUeXBlfSBob29rIC0gUm91dGUgcmVzb2x2ZXIgaG9vay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWRkUm91dGVSZXNvbHZlckhvb2soaG9vaykge1xuICAgIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcy5wdXNoKGhvb2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYWJpbGl0eSByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBBYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBYmlsaXR5UmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fYWJpbGl0eVJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZW5hbnQgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBUZW5hbnQgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudFJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX3RlbmFudFJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSByZXNvbHZlciAtIFRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGVuYW50RGF0YWJhc2VSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyID0gcmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBlbmZvcmNlIHRlbmFudCBkYXRhYmFzZSBzY29wZXMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3VmFsdWUgLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgcmVxdWlyZSBhIHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRFbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMobmV3VmFsdWUpIHsgdGhpcy5fZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gbmV3VmFsdWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXJzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZT59IHByb3ZpZGVycyAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXJzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycyhwcm92aWRlcnMpIHsgdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgPSBwcm92aWRlcnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZW52aXJvbm1lbnQuXG4gICAqL1xuICBnZXRFbnZpcm9ubWVudCgpIHsgcmV0dXJuIGRpZ2codGhpcywgXCJfZW52aXJvbm1lbnRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXF1ZXN0IHRpbWVvdXQgbXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gUmVxdWVzdCB0aW1lb3V0IGluIHNlY29uZHMuXG4gICAqL1xuICBnZXRSZXF1ZXN0VGltZW91dE1zKCkge1xuICAgIGNvbnN0IGVudlRpbWVvdXQgPSB0aGlzLl9wYXJzZVJlcXVlc3RUaW1lb3V0U2Vjb25kcyhwcm9jZXNzLmVudi5WRUxPQ0lPVVNfUkVRVUVTVF9USU1FT1VUX01TKVxuICAgIGNvbnN0IHZhbHVlID0gdHlwZW9mIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyB0aGlzLl9yZXF1ZXN0VGltZW91dE1zKClcbiAgICAgIDogdGhpcy5fcmVxdWVzdFRpbWVvdXRNc1xuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHR5cGVvZiBlbnZUaW1lb3V0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZUaW1lb3V0KSkgcmV0dXJuIGVudlRpbWVvdXRcblxuICAgIHJldHVybiA2MFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgcmVxdWVzdCB0aW1lb3V0IHNlY29uZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSByYXdWYWx1ZSAtIEVudiB2YWx1ZS5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaW1lb3V0IGluIHNlY29uZHMuXG4gICAqL1xuICBfcGFyc2VSZXF1ZXN0VGltZW91dFNlY29uZHMocmF3VmFsdWUpIHtcbiAgICBpZiAocmF3VmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgdHJpbW1lZCA9IHJhd1ZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG5cbiAgICBpZiAoIXRyaW1tZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IG1hdGNoID0gdHJpbW1lZC5tYXRjaCgvXihcXGQrKD86XFwuXFxkKyk/KShtc3xzKT8kLylcblxuICAgIGlmICghbWF0Y2gpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IG51bWVyaWMgPSBOdW1iZXIobWF0Y2hbMV0pXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShudW1lcmljKSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgdW5pdCA9IG1hdGNoWzJdXG5cbiAgICBpZiAodW5pdCA9PT0gXCJtc1wiKSByZXR1cm4gbnVtZXJpYyAvIDEwMDBcbiAgICBpZiAodW5pdCA9PT0gXCJzXCIpIHJldHVybiBudW1lcmljXG5cbiAgICBpZiAodHJpbW1lZC5pbmNsdWRlcyhcIi5cIikpIHJldHVybiBudW1lcmljXG4gICAgaWYgKG51bWVyaWMgPj0gMTAwMCkgcmV0dXJuIG51bWVyaWMgLyAxMDAwXG5cbiAgICByZXR1cm4gbnVtZXJpY1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVudmlyb25tZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3RW52aXJvbm1lbnQgLSBOZXcgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEVudmlyb25tZW50KG5ld0Vudmlyb25tZW50KSB7IHRoaXMuX2Vudmlyb25tZW50ID0gbmV3RW52aXJvbm1lbnQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5kZWZhdWx0Q29uc29sZV0gLSBXaGV0aGVyIGRlZmF1bHQgY29uc29sZS5cbiAgICogQHJldHVybnMge1JlcXVpcmVkPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImNvbnNvbGVcIiB8IFwiZmlsZVwiIHwgXCJsZXZlbHNcIj4+ICYgUGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiZGlyZWN0b3J5XCIgfCBcImZpbGVQYXRoXCI+ICYgUGFydGlhbDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJvdXRwdXRzXCIgfCBcImxvZ2dlcnNcIj4+fSAtIFRoZSBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRMb2dnaW5nQ29uZmlndXJhdGlvbih7ZGVmYXVsdENvbnNvbGV9ID0ge30pIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudCA9IHRoaXMuZ2V0RW52aXJvbm1lbnQoKVxuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICBjb25zdCBkaXJlY3RvcnkgPSB0aGlzLl9sb2dnaW5nPy5kaXJlY3RvcnkgfHwgZW52aXJvbm1lbnRIYW5kbGVyLmdldERlZmF1bHRMb2dEaXJlY3Rvcnkoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5fbG9nZ2luZz8uZmlsZVBhdGggfHwgZW52aXJvbm1lbnRIYW5kbGVyLmdldExvZ0ZpbGVQYXRoKHtjb25maWd1cmF0aW9uOiB0aGlzLCBkaXJlY3RvcnksIGVudmlyb25tZW50fSlcbiAgICBjb25zdCBjb25zb2xlT3ZlcnJpZGUgPSB0aGlzLl9sb2dnaW5nPy5jb25zb2xlXG4gICAgY29uc3QgaGFzTG9nZ2luZ0NvbmZpZyA9IEJvb2xlYW4odGhpcy5fbG9nZ2luZylcbiAgICBjb25zdCBmaWxlTG9nZ2luZyA9IGhhc0xvZ2dpbmdDb25maWcgPyAodGhpcy5fbG9nZ2luZz8uZmlsZSA/PyBCb29sZWFuKGZpbGVQYXRoKSkgOiBmYWxzZVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRMZXZlbHMgPSB0aGlzLl9sb2dnaW5nPy5sZXZlbHNcbiAgICBjb25zdCBpbmNsdWRlTG93TGV2ZWxEZWJ1ZyA9IHRoaXMuX2xvZ2dpbmc/LmRlYnVnTG93TGV2ZWwgPT09IHRydWVcbiAgICBjb25zdCBsb2dnZXJzID0gdGhpcy5fbG9nZ2luZz8ubG9nZ2Vyc1xuXG4gICAgY29uc3QgY29uc29sZURlZmF1bHQgPSBkZWZhdWx0Q29uc29sZSAhPT0gdW5kZWZpbmVkID8gZGVmYXVsdENvbnNvbGUgOiB0cnVlXG4gICAgY29uc3QgY29uc29sZUxvZ2dpbmcgPSBjb25zb2xlT3ZlcnJpZGUgIT09IHVuZGVmaW5lZCA/IGNvbnNvbGVPdmVycmlkZSA6IGNvbnNvbGVEZWZhdWx0XG5cbiAgICAvKipcbiAgICAgKiBEZWZhdWx0IGxldmVscy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8XCJkZWJ1Zy1sb3ctbGV2ZWxcIiB8IFwiZGVidWdcIiB8IFwiaW5mb1wiIHwgXCJ3YXJuXCIgfCBcImVycm9yXCI+fSAqL1xuICAgIGNvbnN0IGRlZmF1bHRMZXZlbHMgPSBbXCJpbmZvXCIsIFwid2FyblwiLCBcImVycm9yXCJdXG5cbiAgICBpZiAoaW5jbHVkZUxvd0xldmVsRGVidWcpIGRlZmF1bHRMZXZlbHMudW5zaGlmdChcImRlYnVnLWxvdy1sZXZlbFwiKVxuXG4gICAgY29uc3QgbGV2ZWxzID0gY29uZmlndXJlZExldmVscyB8fCBkZWZhdWx0TGV2ZWxzXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29uc29sZTogY29uc29sZUxvZ2dpbmcsXG4gICAgICBkaXJlY3RvcnksXG4gICAgICBmaWxlOiBmaWxlTG9nZ2luZyA/PyBmYWxzZSxcbiAgICAgIGZpbGVQYXRoLFxuICAgICAgbG9nZ2VycyxcbiAgICAgIGxldmVscyxcbiAgICAgIG91dHB1dHM6IHRoaXMuX2xvZ2dpbmc/Lm91dHB1dHNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY29uZmlndXJhdGlvbi1vd25lZCBzdHJ1Y3R1cmVkIGxvZ2dpbmcgcmVkYWN0b3IuXG4gICAqIEByZXR1cm5zIHtMb2dSZWRhY3Rvcn0gLSBTdHJ1Y3R1cmVkIGxvZ2dpbmcgcmVkYWN0b3IuXG4gICAqL1xuICBnZXRMb2dSZWRhY3RvcigpIHtcbiAgICByZXR1cm4gdGhpcy5fbG9nUmVkYWN0b3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBxdWVyeSBsb2dnaW5nIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0YWJhc2UgcXVlcnkgbG9nZ2luZyBpcyBlbmFibGVkLlxuICAgKi9cbiAgZ2V0UXVlcnlMb2dnaW5nRW5hYmxlZCgpIHtcbiAgICBpZiAodGhpcy5fbG9nZ2luZz8ucXVlcnlMb2dnaW5nICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLl9sb2dnaW5nLnF1ZXJ5TG9nZ2luZ1xuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnQoKSAhPT0gXCJ0ZXN0XCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBnZW5lcmF0aW9uIGxpZmVjeWNsZSB2YWx1ZXMgZnJvbSB0aGVpciByYXcgY29uZmlnLCBlbnZpcm9ubWVudCxcbiAgICogYW5kIEFQSSBzb3VyY2VzIGJlZm9yZSBhcHBseWluZyBkZWZhdWx0cy4gRGVyaXZlZCBkZWZhdWx0cyBhcmUgZGVsaWJlcmF0ZWx5XG4gICAqIGFic2VudCBmcm9tIHRoZSBzb3VyY2UgbGlzdCwgc28gYW4gQVBJIHJlY292ZXJ5IHN0YXRlIGNhbiBvdmVycmlkZSBhblxuICAgKiBJRC1vbmx5IGNvbmZpZ3VyYXRpb24gd2l0aG91dCBjcmVhdGluZyBhIGZhbHNlIGNvbmZsaWN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gRXhwbGljaXQgQVBJIHZhbHVlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZX0gW2FyZ3MuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZV0gLSBFeHBsaWNpdCBib290IHN0YXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MubGlmZWN5Y2xlU29ja2V0UGF0aF0gLSBFeHBsaWNpdCBsaWZlY3ljbGUgc29ja2V0IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zb3VyY2VOYW1lXSAtIEh1bWFuLXJlYWRhYmxlIEFQSSBvd25lci5cbiAgICogQHJldHVybnMge3tnZW5lcmF0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogaW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlIHwgXCJhY3RpdmVcIiwgbGlmZWN5Y2xlU29ja2V0UGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBSZXNvbHZlZCBsaWZlY3ljbGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe2dlbmVyYXRpb25JZDogZXhwbGljaXRHZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoLCBzb3VyY2VOYW1lID0gXCJiYWNrZ3JvdW5kIGpvYnMgQVBJXCJ9ID0ge30pIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmFja2dyb3VuZEpvYnMgfHwge31cbiAgICBjb25zdCBnZW5lcmF0aW9uRW52aXJvbm1lbnQgPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudiB8fCB7fVxuICAgIGNvbnN0IGdlbmVyYXRpb25JZCA9IHJlc29sdmVHZW5lcmF0aW9uSWQoW1xuICAgICAge25hbWU6IFwiYmFja2dyb3VuZEpvYnMuZ2VuZXJhdGlvbklkXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJnZW5lcmF0aW9uSWRcIikgJiYgY29uZmlndXJlZC5nZW5lcmF0aW9uSWQgIT09IHVuZGVmaW5lZCwgdmFsdWU6IGNvbmZpZ3VyZWQuZ2VuZXJhdGlvbklkfSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRFwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGdlbmVyYXRpb25FbnZpcm9ubWVudCwgXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSURcIiksIHZhbHVlOiBnZW5lcmF0aW9uRW52aXJvbm1lbnQuVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBnZW5lcmF0aW9uSWRgLCBwcmVzZW50OiBleHBsaWNpdEdlbmVyYXRpb25JZCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogZXhwbGljaXRHZW5lcmF0aW9uSWR9XG4gICAgXSlcbiAgICBjb25zdCBpbml0aWFsR2VuZXJhdGlvblN0YXRlID0gcmVzb2x2ZUluaXRpYWxHZW5lcmF0aW9uU3RhdGUoW1xuICAgICAge25hbWU6IFwiYmFja2dyb3VuZEpvYnMuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZVwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGNvbmZpZ3VyZWQsIFwiaW5pdGlhbEdlbmVyYXRpb25TdGF0ZVwiKSAmJiBjb25maWd1cmVkLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgIT09IHVuZGVmaW5lZCwgdmFsdWU6IGNvbmZpZ3VyZWQuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZX0sXG4gICAgICB7bmFtZTogXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0lOSVRJQUxfR0VORVJBVElPTl9TVEFURVwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGdlbmVyYXRpb25FbnZpcm9ubWVudCwgXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0lOSVRJQUxfR0VORVJBVElPTl9TVEFURVwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0lOSVRJQUxfR0VORVJBVElPTl9TVEFURX0sXG4gICAgICB7bmFtZTogYCR7c291cmNlTmFtZX0gaW5pdGlhbEdlbmVyYXRpb25TdGF0ZWAsIHByZXNlbnQ6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlfVxuICAgIF0sIGdlbmVyYXRpb25JZClcbiAgICBjb25zdCBsaWZlY3ljbGVTb2NrZXRQYXRoID0gcmVzb2x2ZUxpZmVjeWNsZVNvY2tldFBhdGgoW1xuICAgICAge25hbWU6IFwiYmFja2dyb3VuZEpvYnMubGlmZWN5Y2xlU29ja2V0UGF0aFwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGNvbmZpZ3VyZWQsIFwibGlmZWN5Y2xlU29ja2V0UGF0aFwiKSAmJiBjb25maWd1cmVkLmxpZmVjeWNsZVNvY2tldFBhdGggIT09IHVuZGVmaW5lZCwgdmFsdWU6IGNvbmZpZ3VyZWQubGlmZWN5Y2xlU29ja2V0UGF0aH0sXG4gICAgICB7bmFtZTogXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0xJRkVDWUNMRV9TT0NLRVRfUEFUSFwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGdlbmVyYXRpb25FbnZpcm9ubWVudCwgXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0xJRkVDWUNMRV9TT0NLRVRfUEFUSFwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0xJRkVDWUNMRV9TT0NLRVRfUEFUSH0sXG4gICAgICB7bmFtZTogYCR7c291cmNlTmFtZX0gbGlmZWN5Y2xlU29ja2V0UGF0aGAsIHByZXNlbnQ6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRofVxuICAgIF0sIGdlbmVyYXRpb25JZClcblxuICAgIHJldHVybiB7Z2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEByZXR1cm5zIHtPbWl0PFJlcXVpcmVkPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24+LCBcImFkYXB0ZXJcIiB8IFwicmV0ZW50aW9uXCIgfCBcImdlbmVyYXRpb25JZFwiIHwgXCJsaWZlY3ljbGVTb2NrZXRQYXRoXCI+ICYge2dlbmVyYXRpb25JZD86IHN0cmluZywgbGlmZWN5Y2xlU29ja2V0UGF0aD86IHN0cmluZywgcmV0ZW50aW9uOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUmVzb2x2ZWRCYWNrZ3JvdW5kSm9ic1JldGVudGlvbkNvbmZpZ3VyYXRpb259fSAtIEJhY2tncm91bmQgam9icyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKSB7XG4gICAgY29uc3QgcHJvY2Vzc0Vudmlyb25tZW50ID0gZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnZcbiAgICBjb25zdCBlbnZIb3N0ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0hPU1RcbiAgICBjb25zdCBlbnZQb3J0UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPUlRcbiAgICBjb25zdCBlbnZEYXRhYmFzZUlkZW50aWZpZXIgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfREFUQUJBU0VfSURFTlRJRklFUlxuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnRGb3JrZWRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTUFYX0NPTkNVUlJFTlRfRk9SS0VEX0pPQlNcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX01BWF9DT05DVVJSRU5UX0lOTElORV9KT0JTXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ291bnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9DT1VOVFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfQ09OQ1VSUkVOQ1lcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX0pPQlNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX01BWF9SU1NfQllURVNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX0xJRkVUSU1FX01TXG4gICAgY29uc3QgZW52RGlzcGF0Y2hTdHJhdGVneSA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19ESVNQQVRDSF9TVFJBVEVHWVxuICAgIGNvbnN0IGVudlBvbGxJbnRlcnZhbFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT0xMX0lOVEVSVkFMX01TXG4gICAgY29uc3QgZW52Sm9iVGltZW91dFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19KT0JfVElNRU9VVF9NU1xuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9IGVudk1heENvbmN1cnJlbnRGb3JrZWRSYXcgPyBOdW1iZXIoZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50ID0gZW52TWF4Q29uY3VycmVudFJhdyA/IE51bWJlcihlbnZNYXhDb25jdXJyZW50UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvdW50ID0gZW52UG9vbGVkUnVubmVyQ291bnRSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyQ291bnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhKb2JzID0gZW52UG9vbGVkUnVubmVyTWF4Sm9ic1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb2xsSW50ZXJ2YWwgPSBlbnZQb2xsSW50ZXJ2YWxSYXcgPyBOdW1iZXIoZW52UG9sbEludGVydmFsUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudkpvYlRpbWVvdXQgPSBlbnZKb2JUaW1lb3V0UmF3ID8gTnVtYmVyKGVudkpvYlRpbWVvdXRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JhY2tncm91bmRKb2JzIHx8IHt9XG4gICAgY29uc3Qge2dlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aH0gPSB0aGlzLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoKVxuICAgIGNvbnN0IG1vZGUgPSBjb25maWd1cmVkLm1vZGUgPT09IHVuZGVmaW5lZCA/IFwiYmFja2dyb3VuZFwiIDogY29uZmlndXJlZC5tb2RlXG5cbiAgICBpZiAobW9kZSAhPT0gXCJiYWNrZ3JvdW5kXCIgJiYgbW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgYmFja2dyb3VuZEpvYnMubW9kZSBtdXN0IGJlIFwiYmFja2dyb3VuZFwiIG9yIFwiaW5saW5lXCIsIGdvdDogJHtTdHJpbmcobW9kZSl9YClcbiAgICB9XG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMxKVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IGNvbmZpZ3VyZWQuZGF0YWJhc2VJZGVudGlmaWVyIHx8IGVudkRhdGFiYXNlSWRlbnRpZmllciB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICAgIDogKHR5cGVvZiBlbnZNYXhDb25jdXJyZW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZNYXhDb25jdXJyZW50KSAmJiBlbnZNYXhDb25jdXJyZW50ID49IDEgPyBlbnZNYXhDb25jdXJyZW50IDogNClcbiAgICBjb25zdCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IHR5cGVvZiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgICA6ICh0eXBlb2YgZW52TWF4Q29uY3VycmVudEZvcmtlZCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52TWF4Q29uY3VycmVudEZvcmtlZCkgJiYgZW52TWF4Q29uY3VycmVudEZvcmtlZCA+PSAxID8gZW52TWF4Q29uY3VycmVudEZvcmtlZCA6IDQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyQ291bnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50KSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50ID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudFxuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lckNvdW50XCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lckNvdW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJDb3VudCkgJiYgZW52UG9vbGVkUnVubmVyQ291bnQgPj0gMSA/IGVudlBvb2xlZFJ1bm5lckNvdW50IDogNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyQ29uY3VycmVuY3lcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+PSAxID8gZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgOiAxKVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heEpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhKb2JzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heEpvYnMpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyTWF4Sm9icykgJiYgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4Sm9icyA6IDEwMClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcykgJiYgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzIDogNTEyICogMTAyNCAqIDEwMjQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIDogNjAgKiA2MCAqIDEwMDApXG4gICAgY29uc3QgZGlzcGF0Y2hTdHJhdGVneVJhdyA9IGNvbmZpZ3VyZWQuZGlzcGF0Y2hTdHJhdGVneSB8fCBlbnZEaXNwYXRjaFN0cmF0ZWd5XG4gICAgY29uc3QgZGlzcGF0Y2hTdHJhdGVneSA9IGRpc3BhdGNoU3RyYXRlZ3lSYXcgPT09IFwicG9sbGluZ1wiID8gXCJwb2xsaW5nXCIgOiBcImJlYWNvblwiXG4gICAgY29uc3QgcG9sbEludGVydmFsTXMgPSB0eXBlb2YgY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNc1xuICAgICAgOiAodHlwZW9mIGVudlBvbGxJbnRlcnZhbCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9sbEludGVydmFsKSAmJiBlbnZQb2xsSW50ZXJ2YWwgPj0gMSA/IGVudlBvbGxJbnRlcnZhbCA6IDEwMDApXG4gICAgY29uc3QgcXVldWVzID0gY29uZmlndXJlZC5xdWV1ZXMgJiYgdHlwZW9mIGNvbmZpZ3VyZWQucXVldWVzID09PSBcIm9iamVjdFwiID8gY29uZmlndXJlZC5xdWV1ZXMgOiB7fVxuICAgIC8vIEFuIGV4cGxpY2l0IGNvbmZpZyB2YWx1ZSB3aW5zIG92ZXIgdGhlIGVudiB2YXIg4oCUIGluY2x1ZGluZyBgbnVsbGAvYDBgLFxuICAgIC8vIHdoaWNoIGRpc2FibGUgdGhlIGJhY2tzdG9wIGV2ZW4gd2hlbiB0aGUgZW52aXJvbm1lbnQgc2V0cyBhIGRlZmF1bHQuXG4gICAgLy8gT25seSBmYWxsIHRocm91Z2ggdG8gdGhlIGVudiB2YXIgd2hlbiBjb25maWcgb21pdHMgYGpvYlRpbWVvdXRNc2AgZW50aXJlbHkuXG4gICAgY29uc3Qgam9iVGltZW91dE1zID0gXCJqb2JUaW1lb3V0TXNcIiBpbiBjb25maWd1cmVkXG4gICAgICA/ICh0eXBlb2YgY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgPiAwID8gY29uZmlndXJlZC5qb2JUaW1lb3V0TXMgOiBudWxsKVxuICAgICAgOiAodHlwZW9mIGVudkpvYlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudkpvYlRpbWVvdXQpICYmIGVudkpvYlRpbWVvdXQgPiAwID8gZW52Sm9iVGltZW91dCA6IG51bGwpXG4gICAgY29uc3QgY29uZmlndXJlZFJldGVudGlvbiA9IGNvbmZpZ3VyZWQucmV0ZW50aW9uICYmIHR5cGVvZiBjb25maWd1cmVkLnJldGVudGlvbiA9PT0gXCJvYmplY3RcIiA/IGNvbmZpZ3VyZWQucmV0ZW50aW9uIDoge31cbiAgICBjb25zdCByZXRlbnRpb24gPSB7XG4gICAgICBjb21wbGV0ZWRUdGxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXMgPT09IFwibnVtYmVyXCIgfHwgY29uZmlndXJlZFJldGVudGlvbi5jb21wbGV0ZWRUdGxNcyA9PT0gbnVsbFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXNcbiAgICAgICAgOiA3ICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgICAgIGZhaWxlZFR0bE1zOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNcyA9PT0gXCJudW1iZXJcIiB8fCBjb25maWd1cmVkUmV0ZW50aW9uLmZhaWxlZFR0bE1zID09PSBudWxsXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNc1xuICAgICAgICA6IDMwICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgICAgIGJhdGNoU2l6ZTogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplID4gMFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uYmF0Y2hTaXplXG4gICAgICAgIDogMTAwMCxcbiAgICAgIHN3ZWVwSW50ZXJ2YWxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zID4gMFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uc3dlZXBJbnRlcnZhbE1zXG4gICAgICAgIDogNjAgKiA2MCAqIDEwMDBcbiAgICB9XG5cbiAgICBjb25zdCBqb2JDbGFzc2VzID0gdGhpcy5nZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpXG5cbiAgICByZXR1cm4ge2hvc3QsIHBvcnQsIGRhdGFiYXNlSWRlbnRpZmllciwgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMsIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzLCBtb2RlLCBwb29sZWRSdW5uZXJDb3VudCwgcG9vbGVkUnVubmVyQ29uY3VycmVuY3ksIHBvb2xlZFJ1bm5lck1heEpvYnMsIHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzLCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zLCBkaXNwYXRjaFN0cmF0ZWd5LCBwb2xsSW50ZXJ2YWxNcywgcXVldWVzLCBqb2JDbGFzc2VzLCBqb2JUaW1lb3V0TXMsIHJldGVudGlvbiwgZ2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc3RhdGljYWxseSByZWdpc3RlcmVkIHBvcnRhYmxlIGJhY2tncm91bmQgam9icy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2xhc3NbXX0gLSBDb25maWd1cmVkIGpvYiBjbGFzc2VzLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYkNsYXNzZXMoKSB7XG4gICAgY29uc3Qgam9iQ2xhc3NlcyA9IHRoaXMuX2JhY2tncm91bmRKb2JzPy5qb2JDbGFzc2VzXG5cbiAgICBpZiAoam9iQ2xhc3NlcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoam9iQ2xhc3NlcykpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJiYWNrZ3JvdW5kSm9icy5qb2JDbGFzc2VzIG11c3QgYmUgYW4gYXJyYXlcIilcblxuICAgIHJldHVybiBbLi4uam9iQ2xhc3Nlc11cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbmQgbWVtb2l6ZXMgb25lIGJhY2tncm91bmQtam9icyBhZGFwdGVyIGZvciB0aGlzIGNvbmZpZ3VyYXRpb24gbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7QmFja2dyb3VuZEpvYnNBZGFwdGVyfSAtIEFjdGl2ZSBhZGFwdGVyLlxuICAgKi9cbiAgZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uKSByZXR1cm4gdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbi5hZGFwdGVyXG5cbiAgICBjb25zdCBjb25maWd1cmVkQWRhcHRlciA9IHRoaXMuX2JhY2tncm91bmRKb2JzPy5hZGFwdGVyXG4gICAgY29uc3QgYWRhcHRlciA9IHR5cGVvZiBjb25maWd1cmVkQWRhcHRlciA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGNvbmZpZ3VyZWRBZGFwdGVyKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgIDogKGNvbmZpZ3VyZWRBZGFwdGVyIHx8IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuY3JlYXRlQmFja2dyb3VuZEpvYnNBZGFwdGVyKHtjb25maWd1cmF0aW9uOiB0aGlzfSkpXG5cbiAgICBpZiAoIShhZGFwdGVyIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYnNBZGFwdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmFkYXB0ZXIgbXVzdCBiZSBhIEJhY2tncm91bmRKb2JzQWRhcHRlciBpbnN0YW5jZSBvciBhIHN5bmNocm9ub3VzIGZhY3RvcnkgcmV0dXJuaW5nIG9uZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPSB7XG4gICAgICBhZGFwdGVyLFxuICAgICAgY2xvc2luZzogZmFsc2UsXG4gICAgICBjbG9zZVByb21pc2U6IHVuZGVmaW5lZCxcbiAgICAgIHJlYWR5UHJvbWlzZTogdW5kZWZpbmVkXG4gICAgfVxuICAgIHJldHVybiBhZGFwdGVyXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSBhY3F1aXJlcyB0aGUgZXhhY3QgcmVhZHkgYWRhcHRlciBmb3IgdGhlIGFjdGl2ZSBsaWZlY3ljbGUuXG4gICAqIEEgY2xvc2UgdGhhdCBjbGFpbXMgdGhlIGdlbmVyYXRpb24gd2hpbGUgcmVhZGluZXNzIGlzIHBlbmRpbmcgd2luczogdGhpc1xuICAgKiBvcGVyYXRpb24gd2FpdHMgZm9yIHRoYXQgY2xvc2UsIGNyZWF0ZXMgdGhlIG5leHQgZ2VuZXJhdGlvbiwgcmVhZGllcyBpdCxcbiAgICogYW5kIHJldHVybnMgb25seSB0aGF0IGxpdmUgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJhY2tncm91bmRKb2JzQWRhcHRlcj59IC0gRXhhY3QgcmVhZHkgYWRhcHRlciBnZW5lcmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBkYXRhYmFzZUNsb3NlUHJvbWlzZSA9IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcblxuICAgICAgaWYgKGRhdGFiYXNlQ2xvc2VQcm9taXNlKSB7XG4gICAgICAgIGF3YWl0IGRhdGFiYXNlQ2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRoaXMuZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG5cbiAgICAgIGlmICghZ2VuZXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGFkYXB0ZXIgZ2VuZXJhdGlvbiB3YXMgbm90IGNyZWF0ZWRcIilcblxuICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2luZykge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlYWR5UHJvbWlzZSA9IGdlbmVyYXRpb24ucmVhZHlQcm9taXNlIHx8IFByb21pc2UucmVzb2x2ZSgpLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLmFkYXB0ZXIuZW5zdXJlUmVhZHkoKVxuICAgICAgfSlcblxuICAgICAgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPSByZWFkeVByb21pc2VcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcmVhZHlQcm9taXNlXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPT09IHJlYWR5UHJvbWlzZSkgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2luZykge1xuICAgICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uICE9PSBnZW5lcmF0aW9uKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4gZ2VuZXJhdGlvbi5hZGFwdGVyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRpZXMgdGhlIGFjdGl2ZSBhZGFwdGVyIG9uY2UgcGVyIGxpZmVjeWNsZS4gQSBmYWlsZWQgYXR0ZW1wdCByZW1haW5zIHJldHJ5YWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUJhY2tncm91bmRKb2JzQWRhcHRlclJlYWR5KCkge1xuICAgIGF3YWl0IHRoaXMuYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGhlYWx0aCB3aXRob3V0IHJlc29sdmluZyBwZXJzaXN0ZW5jZSBpbiBub24tZHVyYWJsZSBpbmxpbmUgbW9kZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNIZWFsdGg+fSAtIEN1cnJlbnQgaGVhbHRoLlxuICAgKi9cbiAgYXN5bmMgYmFja2dyb3VuZEpvYnNIZWFsdGgoKSB7XG4gICAgaWYgKHRoaXMuZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5tb2RlID09PSBcImlubGluZVwiKSByZXR1cm4ge3JlYWR5OiB0cnVlfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IGF3YWl0IHRoaXMuYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcblxuICAgIHJldHVybiBhd2FpdCBhZGFwdGVyLmhlYWx0aCgpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoZSByZXNvbHZlZCBhZGFwdGVyIG9uY2UgYW5kIGNsZWFycyBsaWZlY3ljbGUgY2FjaGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbG9zZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlQmFja2dyb3VuZEpvYnNBZGFwdGVyKCkge1xuICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uXG5cbiAgICBpZiAoIWdlbmVyYXRpb24pIHJldHVyblxuICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IGdlbmVyYXRpb24uY2xvc2VQcm9taXNlXG5cbiAgICBnZW5lcmF0aW9uLmNsb3NpbmcgPSB0cnVlXG4gICAgY29uc3QgY2xvc2VQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICAgIGNvbnN0IGNsb3NlRXJyb3JzID0gW11cblxuICAgICAgaWYgKGdlbmVyYXRpb24ucmVhZHlQcm9taXNlKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgZ2VuZXJhdGlvbi5yZWFkeVByb21pc2VcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLmFkYXB0ZXIuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGNsb3NlRXJyb3JzWzBdXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGNsb3NlRXJyb3JzLCBcIkZhaWxlZCB0byByZWFkeSBhbmQgY2xvc2UgdGhlIGJhY2tncm91bmQtam9icyBhZGFwdGVyXCIpXG4gICAgfSkoKVxuXG4gICAgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UgPSBjbG9zZVByb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbG9zZVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPT09IGdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb259IGJhY2tncm91bmRKb2JzIC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZyhiYWNrZ3JvdW5kSm9icykge1xuICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uICYmIGJhY2tncm91bmRKb2JzLmFkYXB0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlcGxhY2UgYmFja2dyb3VuZEpvYnMuYWRhcHRlciBkdXJpbmcgYW4gYWN0aXZlIGFkYXB0ZXIgbGlmZWN5Y2xlOyBjbG9zZSBpdCBmaXJzdFwiKVxuICAgIH1cblxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmFja2dyb3VuZEpvYnMsIGJhY2tncm91bmRKb2JzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhY3RpdmUgQmVhY29uIGNvbmZpZ3VyYXRpb24uIEJlYWNvbiBpcyBvcHQtaW46IGl0XG4gICAqIHN0YXlzIGRpc2FibGVkIHVubGVzcyB0aGUgYXBwIHBhc3NlcyBgYmVhY29uOiB7aG9zdCwgcG9ydH1gIC9cbiAgICogYGJlYWNvbjoge2luUHJvY2VzczogdHJ1ZX1gLCBjYWxscyBgc2V0QmVhY29uQ29uZmlnKHsuLi59KWAsIG9yXG4gICAqIHNldHMgdGhlIGBWRUxPQ0lPVVNfQkVBQ09OX0hPU1RgIC8gYFZFTE9DSU9VU19CRUFDT05fUE9SVGAgZW52IHZhcnMuXG4gICAqIFNldHRpbmcgYGVuYWJsZWQ6IGZhbHNlYCBleHBsaWNpdGx5IGRpc2FibGVzIGl0IGV2ZW4gd2hlbiBlbnYgdmFyc1xuICAgKiBhcmUgcHJlc2VudCAodXNlZnVsIGZvciB0ZXN0cykuIFdoZW4gYGluUHJvY2VzczogdHJ1ZWAgaXMgc2V0LFxuICAgKiBlbnYtdmFyIGhvc3QvcG9ydCBhcmUgaWdub3JlZCDigJQgY29kZS1sZXZlbCBjb25maWcgd2lucy5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBob3N0OiBzdHJpbmcsIHBvcnQ6IG51bWJlciwgcGVlclR5cGU/OiBzdHJpbmcsIGluUHJvY2VzczogYm9vbGVhbiwgdW5yZWFjaGFibGVSZXBvcnRNczogbnVtYmVyfX0gLSBCZWFjb24gY29uZmlndXJhdGlvbiB3aXRoIGRlZmF1bHRzIGFwcGxpZWQuXG4gICAqL1xuICBnZXRCZWFjb25Db25maWcoKSB7XG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JlYWNvbiB8fCB7fVxuICAgIGNvbnN0IGluUHJvY2VzcyA9IGNvbmZpZ3VyZWQuaW5Qcm9jZXNzID09PSB0cnVlXG5cbiAgICBpZiAoaW5Qcm9jZXNzICYmIChjb25maWd1cmVkLmhvc3QgfHwgdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJlYWNvbiBjb25maWd1cmF0aW9uOiBgaW5Qcm9jZXNzOiB0cnVlYCBpcyBtdXR1YWxseSBleGNsdXNpdmUgd2l0aCBgaG9zdGAvYHBvcnRgLiBVc2Ugb25lIG9yIHRoZSBvdGhlci5cIilcbiAgICB9XG5cbiAgICBjb25zdCBlbnZIb3N0ID0gaW5Qcm9jZXNzID8gdW5kZWZpbmVkIDogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JFQUNPTl9IT1NUXG4gICAgY29uc3QgZW52UG9ydFJhdyA9IGluUHJvY2VzcyA/IHVuZGVmaW5lZCA6IHByb2Nlc3MuZW52LlZFTE9DSU9VU19CRUFDT05fUE9SVFxuICAgIGNvbnN0IGVudlBvcnQgPSBlbnZQb3J0UmF3ID8gTnVtYmVyKGVudlBvcnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgaG9zdCA9IGNvbmZpZ3VyZWQuaG9zdCB8fCBlbnZIb3N0IHx8IFwiMTI3LjAuMC4xXCJcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9ydCA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBjb25maWd1cmVkLnBvcnRcbiAgICAgIDogKHR5cGVvZiBlbnZQb3J0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb3J0KSA/IGVudlBvcnQgOiA3MzMwKVxuXG4gICAgbGV0IGVuYWJsZWRcblxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZC5lbmFibGVkID09PSBcImJvb2xlYW5cIikge1xuICAgICAgZW5hYmxlZCA9IGNvbmZpZ3VyZWQuZW5hYmxlZFxuICAgIH0gZWxzZSB7XG4gICAgICBlbmFibGVkID0gQm9vbGVhbihpblByb2Nlc3MgfHwgY29uZmlndXJlZC5ob3N0IHx8IGNvbmZpZ3VyZWQucG9ydCB8fCBlbnZIb3N0IHx8IGVudlBvcnQpXG4gICAgfVxuXG4gICAgY29uc3QgdW5yZWFjaGFibGVSZXBvcnRNcyA9IHJlc29sdmVCZWFjb25VbnJlYWNoYWJsZVJlcG9ydE1zKGNvbmZpZ3VyZWQudW5yZWFjaGFibGVSZXBvcnRNcylcblxuICAgIHJldHVybiB7ZW5hYmxlZCwgaG9zdCwgcG9ydCwgcGVlclR5cGU6IGNvbmZpZ3VyZWQucGVlclR5cGUsIGluUHJvY2VzcywgdW5yZWFjaGFibGVSZXBvcnRNc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBiZWFjb24gY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CZWFjb25Db25maWd1cmF0aW9ufSBiZWFjb24gLSBCZWFjb24gY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEJlYWNvbkNvbmZpZyhiZWFjb24pIHtcbiAgICB0aGlzLl9iZWFjb24gPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iZWFjb24sIGJlYWNvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBiZWFjb24gY2xpZW50LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSBhY3RpdmUgQmVhY29uIGNsaWVudCwgaWYgY29ubmVjdGVkLlxuICAgKi9cbiAgZ2V0QmVhY29uQ2xpZW50KCkge1xuICAgIHJldHVybiB0aGlzLl9iZWFjb25DbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0aGlzIGNvbmZpZ3VyYXRpb24ncyBCZWFjb24gY2xpZW50IHRvIHRoZSBjb25maWd1cmVkXG4gICAqIGJyb2tlciwgd2lyaW5nIGluY29taW5nIGJyb2FkY2FzdHMgdG8gdGhlIGxvY2FsIGRlbGl2ZXJ5IHBhdGggc29cbiAgICogYW55IHdlYnNvY2tldCBzdWJzY3JpYmVycyBpbiB0aGlzIHByb2Nlc3MgcmVjZWl2ZSB0aGVtLiBJZGVtcG90ZW50XG4gICAqIOKAlCByZXBlYXQgY2FsbHMgcmV0dXJuIHRoZSBzYW1lIGluLWZsaWdodCBvciByZXNvbHZlZCBwcm9taXNlLlxuICAgKlxuICAgKiBSZXR1cm5zIGltbWVkaWF0ZWx5IHdpdGggYHVuZGVmaW5lZGAgaWYgQmVhY29uIGlzIG5vdCBlbmFibGVkLlxuICAgKlxuICAgKiAqKk5vbi1ibG9ja2luZyBieSBkZXNpZ24gKFRDUCBtb2RlKS4qKiBGb3IgYnJva2VyLWJhY2tlZCBCZWFjb24sIHRoZVxuICAgKiByZXR1cm5lZCBwcm9taXNlIHJlc29sdmVzIGFzIHNvb24gYXMgdGhlIGNsaWVudCBpcyBjb25zdHJ1Y3RlZCBhbmRcbiAgICogdGhlIFRDUCBjb25uZWN0IGlzIGxhdW5jaGVkIOKAlCBpdCBkb2VzICoqbm90Kiogd2FpdCBmb3IgdGhlIGNvbm5lY3RcbiAgICogaGFuZHNoYWtlIHRvIGNvbXBsZXRlLiBBIGJyb2tlciB0aGF0IHNpbGVudGx5IGRyb3BzIFNZTnNcbiAgICogKGZpcmV3YWxsL05BQ0wgRFJPUCBydWxlcykgd291bGQgb3RoZXJ3aXNlIGJsb2NrIHN0YXJ0dXAgb24gdGhlIE9TXG4gICAqIFRDUCBjb25uZWN0IHRpbWVvdXQgKHRlbnMgb2Ygc2Vjb25kcyksIHdoaWNoIGNvbnRyYWRpY3RzIHRoZVxuICAgKiBkb2N1bWVudGVkIFwiZmFsbCBiYWNrIHRvIGxvY2FsLW9ubHkgYW5kIHJlY29ubmVjdCBpbiB0aGVcbiAgICogYmFja2dyb3VuZFwiIGNvbnRyYWN0LiBJbml0aWFsLWNvbm5lY3QgZmFpbHVyZXMgc3VyZmFjZVxuICAgKiBhc3luY2hyb25vdXNseSBvbiB0aGUgZnJhbWV3b3JrLWVycm9yIGNoYW5uZWwgdmlhIHRoZVxuICAgKiBgY29ubmVjdC1lcnJvcmAgbGlzdGVuZXIgcmVnaXN0ZXJlZCBoZXJlLiBDYWxsZXJzIHRoYXQgbmVlZCBhXG4gICAqIGRldGVybWluaXN0aWMgcHVibGlzaC1yZWFkaW5lc3MgYm91bmRhcnkgc2hvdWxkIGNhbGxcbiAgICogYGdldEJlYWNvbkNsaWVudCgpPy53YWl0Rm9yUmVhZHkoe3RpbWVvdXRNc30pYC5cbiAgICpcbiAgICogKipJbi1wcm9jZXNzIG1vZGUqKiBhd2FpdHMgYGNvbm5lY3QoKWAg4oCUIHRoYXQgcGF0aCBpcyBzeW5jaHJvbm91cyxcbiAgICogY2Fubm90IGZhaWwsIGFuZCBnaXZlcyBjYWxsZXJzIHByZWRpY3RhYmxlIHJlYWRpbmVzcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBPdmVycmlkZSBwZWVyVHlwZSBmb3IgdGhpcyBjb25uZWN0IGNhbGwgKGUuZy4gYFwic2VydmVyXCJgLCBgXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJgKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZWdpc3RlcmVkIGNsaWVudCAoVENQIG1vZGU6IGNvbm5lY3QgbWF5IHN0aWxsIGJlIGluIGZsaWdodCksIG9yIHVuZGVmaW5lZCB3aGVuIEJlYWNvbiBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGFzeW5jIGNvbm5lY3RCZWFjb24oe3BlZXJUeXBlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCkgcmV0dXJuIHRoaXMuX2JlYWNvbkNsaWVudFxuICAgIGlmICh0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlXG5cbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldEJlYWNvbkNvbmZpZygpXG5cbiAgICBpZiAoIWNvbmZpZy5lbmFibGVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjbGllbnQgPSBhd2FpdCB0aGlzLl9jcmVhdGVCZWFjb25DbGllbnQoe1xuICAgICAgICBjb25maWcsXG4gICAgICAgIHBlZXJUeXBlOiBwZWVyVHlwZSB8fCBjb25maWcucGVlclR5cGVcbiAgICAgIH0pXG5cbiAgICAgIGNsaWVudC5vbkJyb2FkY2FzdCgobWVzc2FnZSkgPT4ge1xuICAgICAgICAvLyBTeW5hcHNlLXN0eWxlIGZhbi1vdXQ6IGRlbGl2ZXIgZXZlcnkgYnJvYWRjYXN0IHdlIHJlY2VpdmVcbiAgICAgICAgLy8gZnJvbSB0aGUgYnVzIHRocm91Z2ggdGhlIGxvY2FsIGRlbGl2ZXJ5IHBhdGguIEVjaG9lcyBvZiBvdXJcbiAgICAgICAgLy8gb3duIHB1Ymxpc2hlcyBmb2xsb3cgdGhlIHNhbWUgcGF0aCBzbyBldmVyeSBwZWVyIHNlZXMgdGhlXG4gICAgICAgIC8vIHNhbWUgZGVsaXZlcnkgc2VtYW50aWNzLlxuICAgICAgICB0aGlzLl9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbihtZXNzYWdlKVxuICAgICAgfSlcblxuICAgICAgLy8gQmVhY29uIGNvbm5lY3QvZGlzY29ubmVjdCBibGlwcyBhcmUgZXhwZWN0ZWQgZHVyaW5nIGRlcGxveXMgKHRoZSBicm9rZXJcbiAgICAgIC8vIHJlc3RhcnRzKSBhbmQgdGhlIEJlYWNvbkNsaWVudCBhdXRvLXJlY29ubmVjdHMgaW4gdGhlIGJhY2tncm91bmQsIHNvIGFcbiAgICAgIC8vIHNpbmdsZSB0cmFuc2llbnQgZmFpbHVyZSBpcyBOT1QgcmVwb3J0ZWQuIE9ubHkgYSBzdXN0YWluZWQgb3V0YWdlIChzdGlsbFxuICAgICAgLy8gZG93biBhZnRlciBgdW5yZWFjaGFibGVSZXBvcnRNc2ApIGlzIHN1cmZhY2VkIG9uIHRoZSBmcmFtZXdvcmstZXJyb3JcbiAgICAgIC8vIGNoYW5uZWw7IGEgKHJlKWNvbm5lY3Qgd2l0aGluIHRoZSBncmFjZSB3aW5kb3cgY2xlYXJzIGl0IHNpbGVudGx5LlxuXG4gICAgICAvLyBgY29ubmVjdC1lcnJvcmAgZmlyZXMgd2hlbiB0aGUgKmluaXRpYWwqIFRDUC9oYW5kc2hha2UgZmFpbHMuXG4gICAgICBjbGllbnQub24oXCJjb25uZWN0LWVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZTogXCJiZWFjb24tY29ubmVjdFwiLCBlcnJvciwgcmVwb3J0QWZ0ZXJNczogY29uZmlnLnVucmVhY2hhYmxlUmVwb3J0TXN9KVxuICAgICAgfSlcblxuICAgICAgLy8gYGRpc2Nvbm5lY3RgIGZpcmVzIHdoZW4gYW4gZXN0YWJsaXNoZWQgY29ubmVjdGlvbiBkcm9wcy4gVGhlIHBheWxvYWQgaXNcbiAgICAgIC8vIHRoZSB1bmRlcmx5aW5nIHNvY2tldCBlcnJvciBpZiB0aGVyZSB3YXMgb25lLCBvciBhIHN5bnRoZXRpY1xuICAgICAgLy8gRXJyb3IoXCJCZWFjb24gYnJva2VyIGRpc2Nvbm5lY3RlZFwiKSBvdGhlcndpc2UuXG4gICAgICBjbGllbnQub24oXCJkaXNjb25uZWN0XCIsIChyZWFzb24pID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uRG93bih7c3RhZ2U6IFwiYmVhY29uLWRpc2Nvbm5lY3RcIiwgZXJyb3I6IHJlYXNvbiwgcmVwb3J0QWZ0ZXJNczogY29uZmlnLnVucmVhY2hhYmxlUmVwb3J0TXN9KVxuICAgICAgfSlcblxuICAgICAgLy8gYGNvbm5lY3RgIGZpcmVzIG9uIGV2ZXJ5IChyZSljb25uZWN0OyBjbGVhciBhbnkgcGVuZGluZyBvdXRhZ2Ugc3RhdGUgc29cbiAgICAgIC8vIGEgdHJhbnNpZW50IGJsaXAgdGhhdCByZWNvdmVycyB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyBzdGF5cyBzaWxlbnQuXG4gICAgICBjbGllbnQub24oXCJjb25uZWN0XCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uVXAoKVxuICAgICAgfSlcblxuICAgICAgLy8gUmVnaXN0ZXIgdGhlIGNsaWVudCAqYmVmb3JlKiBraWNraW5nIG9mZiBjb25uZWN0IHNvIHN1YnNlcXVlbnRcbiAgICAgIC8vIGBjb25uZWN0QmVhY29uKClgIGNhbGxzIHJldHVybiB0aGlzIHNhbWUgaW5zdGFuY2UgaW5zdGVhZCBvZlxuICAgICAgLy8gcmFjaW5nIHRvIGNvbnN0cnVjdCBhIHNlY29uZCBvbmUuXG4gICAgICB0aGlzLl9iZWFjb25DbGllbnQgPSBjbGllbnRcblxuICAgICAgaWYgKGNvbmZpZy5pblByb2Nlc3MpIHtcbiAgICAgICAgLy8gSW4tcHJvY2VzcyBjb25uZWN0IGlzIHN5bmNocm9ub3VzLCBjYW5ub3QgZmFpbCwgYW5kIHJlc29sdmVzXG4gICAgICAgIC8vIGJlZm9yZSB0aGlzIGF3YWl0IHlpZWxkcyDigJQgY2FsbGVycyBjYW4gcmVseSBvblxuICAgICAgICAvLyBgaXNDb25uZWN0ZWQoKSA9PT0gdHJ1ZWAgaW1tZWRpYXRlbHkgYWZ0ZXIgYGNvbm5lY3RCZWFjb24oKWAuXG4gICAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEZpcmUtYW5kLWZvcmdldCB0aGUgVENQIGNvbm5lY3QuIEF3YWl0aW5nIGhlcmUgd291bGQgYmxvY2tcbiAgICAgICAgLy8gc3RhcnR1cCBvbiB0aGUgT1MgVENQIGNvbm5lY3QgdGltZW91dCAoNzVzIGRlZmF1bHQgb24gTGludXgpXG4gICAgICAgIC8vIHdoZW4gdGhlIGJyb2tlciBzaWxlbnRseSBkcm9wcyBTWU5zLiBGYWlsdXJlcyBzdXJmYWNlXG4gICAgICAgIC8vIGFzeW5jaHJvbm91c2x5IHZpYSB0aGUgYGNvbm5lY3QtZXJyb3JgIGxpc3RlbmVyIHJlZ2lzdGVyZWRcbiAgICAgICAgLy8gYWJvdmU7IHRoZSBCZWFjb25DbGllbnQncyByZWNvbm5lY3QgbG9vcCBrZWVwcyB0cnlpbmcuXG4gICAgICAgIHZvaWQgY2xpZW50LmNvbm5lY3QoKS5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gQWxyZWFkeSByZXBvcnRlZCB2aWEgY29ubmVjdC1lcnJvciBhYm92ZS5cbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNsaWVudFxuICAgIH0pKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIEJlYWNvbiBjbGllbnQgbWF0Y2hpbmcgdGhlIGNvbmZpZ3VyZWQgbW9kZS4gU3BsaXQgb3V0IHNvXG4gICAqIGBjb25uZWN0QmVhY29uYCBzdGF5cyBmb2N1c2VkIG9uIGxpZmVjeWNsZSBhbmQgZXJyb3Igd2lyaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTxWZWxvY2lvdXNDb25maWd1cmF0aW9uW1wiZ2V0QmVhY29uQ29uZmlnXCJdPn0gYXJncy5jb25maWcgLSBSZXNvbHZlZCBCZWFjb24gY29uZmlnLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucGVlclR5cGVdIC0gUmVzb2x2ZWQgcGVlciB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEJlYWNvbiBjbGllbnQuXG4gICAqL1xuICBhc3luYyBfY3JlYXRlQmVhY29uQ2xpZW50KHtjb25maWcsIHBlZXJUeXBlfSkge1xuICAgIC8vIFJvdXRlIHRocm91Z2ggdGhlIGVudmlyb25tZW50IGhhbmRsZXIgc28gdGhlIE5vZGUtb25seSBgbm9kZTpuZXRgXG4gICAgLy8gLyBgbm9kZTpjcnlwdG9gIGRlcHMgaW4gdGhlIEJlYWNvbiBjbGllbnQgbW9kdWxlcyBkb24ndCBnZXQgcHVsbGVkXG4gICAgLy8gaW50byBicm93c2VyIGJ1bmRsZXMuIEJyb3dzZXIgYnVuZGxlcyBzdGF0aWNhbGx5IHJlYWNoXG4gICAgLy8gYENvbmZpZ3VyYXRpb25gICh2aWEgYExvZ2dlcmApOyBwdXR0aW5nIHRoZSBkeW5hbWljXG4gICAgLy8gYGltcG9ydChcIi4vYmVhY29uLy4uLlwiKWAgY2FsbHMgaGVyZSB3b3VsZCBzdGlsbCBkcmFnIHRob3NlIG1vZHVsZXNcbiAgICAvLyB0aHJvdWdoIGVzYnVpbGQncyBzdGF0aWMgYW5hbHlzaXMuIEhpZGluZyB0aGUgaW1wb3J0cyBpbnNpZGUgdGhlXG4gICAgLy8gTm9kZSBlbnZpcm9ubWVudCBoYW5kbGVyIGtlZXBzIHRoZW0gb2ZmIHRoZSBicm93c2VyIHBhdGgg4oCUXG4gICAgLy8gYnJvd3Nlci1idW5kbGVkIGFwcHMgbmV2ZXIgcmVhY2ggYGVudmlyb25tZW50LWhhbmRsZXJzL25vZGUuanNgLlxuICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAoY29uZmlnLmluUHJvY2Vzcykge1xuICAgICAgY29uc3QgSW5Qcm9jZXNzQmVhY29uQ2xpZW50ID0gYXdhaXQgaGFuZGxlci5sb2FkSW5Qcm9jZXNzQmVhY29uQ2xpZW50KClcblxuICAgICAgcmV0dXJuIG5ldyBJblByb2Nlc3NCZWFjb25DbGllbnQoe3BlZXJUeXBlfSlcbiAgICB9XG5cbiAgICBjb25zdCBCZWFjb25DbGllbnQgPSBhd2FpdCBoYW5kbGVyLmxvYWRCZWFjb25DbGllbnQoKVxuXG4gICAgcmV0dXJuIG5ldyBCZWFjb25DbGllbnQoe1xuICAgICAgaG9zdDogY29uZmlnLmhvc3QsXG4gICAgICBwb3J0OiBjb25maWcucG9ydCxcbiAgICAgIHBlZXJUeXBlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgQmVhY29uIGNvbm5lY3QvZGlzY29ubmVjdCBmYWlsdXJlIHdpdGhvdXQgcmVwb3J0aW5nIGl0IGltbWVkaWF0ZWx5LlxuICAgKiBUaGUgQmVhY29uQ2xpZW50IGF1dG8tcmVjb25uZWN0cywgc28gYnJpZWYgb3V0YWdlcyAoZS5nLiBhIGRlcGxveSByZXN0YXJ0aW5nXG4gICAqIHRoZSBicm9rZXIpIGFyZSBleHBlY3RlZDsgb25seSBpZiB0aGUgYmVhY29uIGlzIHN0aWxsIHVucmVhY2hhYmxlIGFmdGVyXG4gICAqIGByZXBvcnRBZnRlck1zYCBpcyBhIHNpbmdsZSBmcmFtZXdvcmstZXJyb3Igc3VyZmFjZWQgdmlhIGBfcmVwb3J0QmVhY29uRXJyb3JgLlxuICAgKiBBIHN1YnNlcXVlbnQgYGNvbm5lY3RgIChzZWUgYF9oYW5kbGVCZWFjb25VcGApIGNhbmNlbHMgdGhlIHBlbmRpbmcgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJiZWFjb24tY29ubmVjdFwiIHwgXCJiZWFjb24tZGlzY29ubmVjdFwifSBhcmdzLnN0YWdlIC0gRmFpbHVyZSBzdGFnZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZXBvcnRBZnRlck1zIC0gR3JhY2Ugd2luZG93IGJlZm9yZSBhIHN1c3RhaW5lZCBvdXRhZ2UgaXMgcmVwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlLCBlcnJvciwgcmVwb3J0QWZ0ZXJNc30pIHtcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0ge3N0YWdlLCBlcnJvcn1cblxuICAgIC8vIEEgcmVwb3J0IGlzIGFscmVhZHkgcGVuZGluZyBvciBhbHJlYWR5IHNlbnQgZm9yIHRoaXMgb3V0YWdlIOKAlCBrZWVwIHRoZVxuICAgIC8vIGxhdGVzdCBlcnJvciBidXQgZG9uJ3Qgc3RhY2sgdGltZXJzIG9yIHJlLXJlcG9ydC5cbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIgfHwgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQpIHJldHVyblxuXG4gICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG5cbiAgICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQ/LmlzQ29ubmVjdGVkKCkpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uVXAoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSB0cnVlXG5cbiAgICAgIGlmICh0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yKSB0aGlzLl9yZXBvcnRCZWFjb25FcnJvcih0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yKVxuICAgIH0sIHJlcG9ydEFmdGVyTXMpXG5cbiAgICAvLyBEb24ndCBsZXQgdGhlIGdyYWNlIHRpbWVyIGtlZXAgdGhlIHByb2Nlc3MgYWxpdmUuXG4gICAgaWYgKHR5cGVvZiB0aW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aW1lci51bnJlZigpXG5cbiAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHRpbWVyXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGJlYWNvbi1kb3duIHN0YXRlIG9uIGEgKHJlKWNvbm5lY3QuIEEgYmxpcCB0aGF0IHJlY292ZXJzIHdpdGhpbiB0aGVcbiAgICogZ3JhY2Ugd2luZG93IGlzIG5ldmVyIHJlcG9ydGVkOyBpZiBhIHN1c3RhaW5lZCBvdXRhZ2UgaGFkIGFscmVhZHkgYmVlblxuICAgKiByZXBvcnRlZCwgdGhlIHN0YXRlIHJlc2V0cyBzbyBhIGZ1dHVyZSBvdXRhZ2UgY2FuIHJlcG9ydCBhZ2Fpbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQmVhY29uVXAoKSB7XG4gICAgaWYgKHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpXG4gICAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gZmFsc2VcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYSBCZWFjb24gZmFpbHVyZSBvbiB0aGUgZnJhbWV3b3JrIGVycm9yIGNoYW5uZWwuIE1pcnJvcnNcbiAgICogdGhlIHBhdHRlcm4gdXNlZCBieSBgcmVxdWVzdC1ydW5uZXIuanNgIGZvciBIVFRQIGVycm9ycy4gV2hlbiBub1xuICAgKiBsaXN0ZW5lciBpcyBhdHRhY2hlZCB0byBlaXRoZXIgYGZyYW1ld29yay1lcnJvcmAgb3IgYGFsbC1lcnJvcmAsXG4gICAqIGFsc28gc2NoZWR1bGVzIGFuIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbiBzbyBwcm9jZXNzLWxldmVsIGJ1Z1xuICAgKiByZXBvcnRlcnMgKHdoaWNoIHN1YnNjcmliZSB0byBgdW5oYW5kbGVkUmVqZWN0aW9uYCBieSBkZWZhdWx0KSBwaWNrXG4gICAqIHRoZSBmYWlsdXJlIHVwIOKAlCBhbmQgQUxTTyB3cml0ZXMgYSBvbmUtbGluZSBzdW1tYXJ5IHRvIGBzdGRlcnJgIHNvXG4gICAqIHRoZSBmYWlsdXJlIGlzbid0IGNvbXBsZXRlbHkgc2lsZW50IG9uIE5vZGUgMjQrIHdoZXJlIHRoZSBkZWZhdWx0XG4gICAqIGJlaGF2aW9yIG9mIGB1bmhhbmRsZWRSZWplY3Rpb25gIGlzIHRvIHRlcm1pbmF0ZSB0aGUgcHJvY2Vzcy4gQW5cbiAgICogYXBwIHRoYXQgc2VlcyBpdHMgc2VydmVyIHN1ZGRlbmx5IGV4aXQgbmVlZHMgYXQgbGVhc3Qgb25lXG4gICAqIGJyZWFkY3J1bWIgaW4gdGhlIGxvZ3MgdG8ga25vdyBCZWFjb24gd2FzIHRoZSBjYXVzZTsgdGhlIHByZXZpb3VzXG4gICAqIGJlaGF2aW9yIGxlZnQgYSBzdGFjay1vbmx5IGNyYXNoIHdpdGggbm8gY29udGV4dCB0eWluZyBpdCBiYWNrIHRvXG4gICAqIHRoZSBicm9rZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCJ9IGFyZ3Muc3RhZ2UgLSBGYWlsdXJlIHN0YWdlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEJlYWNvbkVycm9yKHtzdGFnZSwgZXJyb3J9KSB7XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLl9lcnJvckV2ZW50c1xuICAgIGNvbnN0IGhhc0xpc3RlbmVyID0gZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImZyYW1ld29yay1lcnJvclwiKSA+IDBcbiAgICAgIHx8IGVycm9yRXZlbnRzLmxpc3RlbmVyQ291bnQoXCJhbGwtZXJyb3JcIikgPiAwXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtzdGFnZX0sXG4gICAgICBlcnJvclxuICAgIH1cblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gICAgaWYgKCFoYXNMaXN0ZW5lcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuXG5cbiAgICAgIGNvbnNvbGUuZXJyb3IoYFt2ZWxvY2lvdXMgZnJhbWV3b3JrLWVycm9yIHN0YWdlPSR7c3RhZ2V9XSAke21lc3NhZ2V9IOKAlCByZWdpc3RlciBhIGxpc3RlbmVyIHZpYSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkub24oXCJmcmFtZXdvcmstZXJyb3JcIiwg4oCmKSB0byBzdXBwcmVzcyB0aGlzIHN0ZGVyciBmYWxsYmFja2ApXG4gICAgICB2b2lkIFByb21pc2UucmVqZWN0KGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgdGhlIGFjdGl2ZSBCZWFjb24gY2xpZW50IChpZiBhbnkpLiBTYWZlIHRvIGNhbGwgbXVsdGlwbGVcbiAgICogdGltZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgZGlzY29ubmVjdEJlYWNvbigpIHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLl9iZWFjb25DbGllbnRcblxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gdW5kZWZpbmVkXG5cbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcilcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcblxuICAgIGlmIChjbGllbnQpIGF3YWl0IGNsaWVudC5jbG9zZSgpXG4gIH1cblxuICAvKipcbiAgICogUm91dGVzIGEgQmVhY29uLXNvdXJjZWQgYnJvYWRjYXN0IHRocm91Z2ggdGhlIHNhbWUgZGVsaXZlcnkgY29kZVxuICAgKiBwYXRoIGFzIGEgbG9jYWxseS1vcmlnaW5hdGVkIG9uZS4gUHJlZmVycyB0aGUgd29ya2VydGhyZWFkLWF3YXJlXG4gICAqIGBicm9hZGNhc3RWMmAgd2hlbiBhbiBIVFRQIHNlcnZlciBpcyBob3N0aW5nIHdvcmtlcnMsIGFuZCBmYWxsc1xuICAgKiBiYWNrIHRvIHRoZSBwZXItcHJvY2VzcyBzdWJzY3JpcHRpb24gZGlzcGF0Y2ggb3RoZXJ3aXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmVhY29uL3R5cGVzLmpzXCIpLkJlYWNvbkJyb2FkY2FzdE1lc3NhZ2V9IG1lc3NhZ2UgLSBCcm9hZGNhc3QgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZGVsaXZlckJyb2FkY2FzdEZyb21CZWFjb24obWVzc2FnZSkge1xuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMih7XG4gICAgICAgIGNoYW5uZWw6IG1lc3NhZ2UuY2hhbm5lbCxcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zOiBtZXNzYWdlLmJyb2FkY2FzdFBhcmFtcyxcbiAgICAgICAgYm9keTogbWVzc2FnZS5ib2R5LFxuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzXG4gICAgICB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobWVzc2FnZS5jaGFubmVsLCBtZXNzYWdlLmJyb2FkY2FzdFBhcmFtcywgbWVzc2FnZS5ib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBpZiAoIXRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNMb2FkZXJUeXBlIHwgdW5kZWZpbmVkfSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyAtIFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZyhzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icykge1xuICAgIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID0gc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtYWlsZXIgYmFja2VuZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5NYWlsZXJCYWNrZW5kIHwgdW5kZWZpbmVkfSAtIE1haWxlciBiYWNrZW5kLlxuICAgKi9cbiAgZ2V0TWFpbGVyQmFja2VuZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fbWFpbGVyQmFja2VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG1haWxlciBiYWNrZW5kLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5NYWlsZXJCYWNrZW5kIHwgdW5kZWZpbmVkfSBtYWlsZXJCYWNrZW5kIC0gTWFpbGVyIGJhY2tlbmQsIG9yIHVuZGVmaW5lZCB0byByZW1vdmUgaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1haWxlckJhY2tlbmQobWFpbGVyQmFja2VuZCkge1xuICAgIHRoaXMuX21haWxlckJhY2tlbmQgPSBtYWlsZXJCYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogTG9nZ2luZyBjb25maWd1cmF0aW9uIHRhaWxvcmVkIGZvciBIVFRQIHJlcXVlc3QgbG9nZ2luZy4gRGVmYXVsdHMgY29uc29sZSBsb2dnaW5nIHRvIHRydWUgYW5kIGFwcGxpZXMgdGhlIHVzZXIgYGxvZ2dpbmcuY29uc29sZWAgZmxhZyBvbmx5IGZvciByZXF1ZXN0IGxvZ2dpbmcuXG4gICAqIEByZXR1cm5zIHtSZXF1aXJlZDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJjb25zb2xlXCIgfCBcImZpbGVcIiB8IFwibGV2ZWxzXCI+PiAmIFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImRpcmVjdG9yeVwiIHwgXCJmaWxlUGF0aFwiPiAmIFBhcnRpYWw8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwib3V0cHV0c1wiIHwgXCJsb2dnZXJzXCI+Pn0gLSBUaGUgaHR0cCBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRIdHRwTG9nZ2luZ0NvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TG9nZ2luZ0NvbmZpZ3VyYXRpb24oe2RlZmF1bHRDb25zb2xlOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbnZpcm9ubWVudCBoYW5kbGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqL1xuICBnZXRFbnZpcm9ubWVudEhhbmRsZXIoKSB7XG4gICAgaWYgKCF0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGVudmlyb25tZW50IGhhbmRsZXIgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZW52aXJvbm1lbnRIYW5kbGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2NhbGVGYWxsYmFja3NUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKi9cbiAgZ2V0TG9jYWxlRmFsbGJhY2tzKCkgeyByZXR1cm4gdGhpcy5sb2NhbGVGYWxsYmFja3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2NhbGVGYWxsYmFja3NUeXBlfSBuZXdMb2NhbGVGYWxsYmFja3MgLSBOZXcgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TG9jYWxlRmFsbGJhY2tzKG5ld0xvY2FsZUZhbGxiYWNrcykgeyB0aGlzLmxvY2FsZUZhbGxiYWNrcyA9IG5ld0xvY2FsZUZhbGxiYWNrcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN0cnVjdHVyZSBzcWwgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlN0cnVjdHVyZVNxbENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gU3RydWN0dXJlIFNRTCBjb25maWcuXG4gICAqL1xuICBnZXRTdHJ1Y3R1cmVTcWxDb25maWcoKSB7IHJldHVybiB0aGlzLl9zdHJ1Y3R1cmVTcWwgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCB3cml0ZSBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcGFyYW0ge3tyZWFzb24/OiBcIm1pZ3JhdGlvblwiIHwgXCJzY2hlbWFEdW1wXCJ9fSBbYXJnc10gLSBDYWxsIGNvbnRleHQgZm9yIHRoZSBzdHJ1Y3R1cmUgc3FsIHdyaXRlIGRlY2lzaW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN0cnVjdHVyZSBTUUwgZmlsZXMgc2hvdWxkIGJlIGdlbmVyYXRlZCBmb3IgdGhlIGN1cnJlbnQgZW52aXJvbm1lbnQuXG4gICAqL1xuICBzaG91bGRXcml0ZVN0cnVjdHVyZVNxbChhcmdzID0ge30pIHtcbiAgICBjb25zdCB7cmVhc29uID0gXCJtaWdyYXRpb25cIn0gPSBhcmdzXG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRTdHJ1Y3R1cmVTcWxDb25maWcoKVxuICAgIGNvbnN0IGVuYWJsZWRFbnZpcm9ubWVudHMgPSBjb25maWc/LmVuYWJsZWRFbnZpcm9ubWVudHNcbiAgICBjb25zdCBkaXNhYmxlZEVudmlyb25tZW50cyA9IGNvbmZpZz8uZGlzYWJsZWRFbnZpcm9ubWVudHNcblxuICAgIGlmIChyZWFzb24gPT09IFwic2NoZW1hRHVtcFwiKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGVuYWJsZWRFbnZpcm9ubWVudHMpKSB7XG4gICAgICByZXR1cm4gZW5hYmxlZEVudmlyb25tZW50cy5pbmNsdWRlcyh0aGlzLmdldEVudmlyb25tZW50KCkpXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZGlzYWJsZWRFbnZpcm9ubWVudHMpICYmIGRpc2FibGVkRW52aXJvbm1lbnRzLmluY2x1ZGVzKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldEVudmlyb25tZW50KCkgPT09IFwidGVzdFwiKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHN0cnVjdHVyZSBzcWwgY29uZmlnLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TdHJ1Y3R1cmVTcWxDb25maWd1cmF0aW9ufSBzdHJ1Y3R1cmVTcWwgLSBTdHJ1Y3R1cmUgU1FMIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U3RydWN0dXJlU3FsQ29uZmlnKHN0cnVjdHVyZVNxbCkge1xuICAgIHRoaXMuX3N0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbG9jYWxlLlxuICAgKi9cbiAgZ2V0TG9jYWxlKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5sb2NhbGUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5sb2NhbGUoKVxuICAgIH0gZWxzZSBpZiAodGhpcy5sb2NhbGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvY2FsZVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRMb2NhbGVzKClbMF1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIGxvY2FsZXMuXG4gICAqL1xuICBnZXRMb2NhbGVzKCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcImxvY2FsZXNcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcyhuYW1lKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzc2VzW25hbWVdXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBtb2RlbCBjbGFzcyAke25hbWV9IGluICR7T2JqZWN0LmtleXModGhpcy5tb2RlbENsYXNzZXMpLmpvaW4oXCIsIFwiKX19YClcblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQSBoYXNoIG9mIGFsbCBtb2RlbCBjbGFzc2VzLCBrZXllZCBieSBtb2RlbCBuYW1lLCBhcyB0aGV5IHdlcmUgZGVmaW5lZCBpbiB0aGUgY29uZmlndXJhdGlvbi4gVGhpcyBpcyBhIGRpcmVjdCByZWZlcmVuY2UgdG8gdGhlIG1vZGVsIGNsYXNzZXMsIG5vdCBhIGNvcHkuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzc2VzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdGluZy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gVGhlIHBhdGggdG8gYSBjb25maWcgZmlsZSB0aGF0IHNob3VsZCBiZSB1c2VkIGZvciB0ZXN0aW5nLlxuICAgKi9cbiAgZ2V0VGVzdGluZygpIHsgcmV0dXJuIHRoaXMuX3Rlc3RpbmcgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cnVzdGVkIHByb3hpZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gVHJ1c3RlZCByZXZlcnNlIHByb3h5IGFkZHJlc3MgcmFuZ2VzLlxuICAgKi9cbiAgZ2V0VHJ1c3RlZFByb3hpZXMoKSB7IHJldHVybiB0aGlzLl90cnVzdGVkUHJveGllcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRydXN0ZWQgcHJveGllcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gdHJ1c3RlZFByb3hpZXMgLSBUcnVzdGVkIHJldmVyc2UgcHJveHkgYWRkcmVzcyByYW5nZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0VHJ1c3RlZFByb3hpZXModHJ1c3RlZFByb3hpZXMpIHsgdGhpcy5fdHJ1c3RlZFByb3hpZXMgPSB0cnVzdGVkUHJveGllcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBkYXRhYmFzZSBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2lkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllciB0byBpbml0aWFsaXplLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBpbml0aWFsaXplRGF0YWJhc2VQb29sKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGlmICghdGhpcy5kYXRhYmFzZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gJ2RhdGFiYXNlJyB3YXMgZ2l2ZW5cIilcbiAgICBpZiAodGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZVBvb2wgaGFzIGFscmVhZHkgYmVlbiBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgUG9vbFR5cGUgPSB0aGlzLmdldERhdGFiYXNlUG9vbFR5cGUoaWRlbnRpZmllcilcblxuICAgIHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IG5ldyBQb29sVHlwZSh7Y29uZmlndXJhdGlvbjogdGhpcywgaWRlbnRpZmllcn0pXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdLnNldEN1cnJlbnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZGF0YWJhc2UgcG9vbCBpbml0aWFsaXplZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtpZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0YWJhc2UgcG9vbCBpbml0aWFsaXplZC5cbiAgICovXG4gIGlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7IHJldHVybiBCb29sZWFuKHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGluaXRpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluaXRpYWxpemVkLlxuICAgKi9cbiAgaXNJbml0aWFsaXplZCgpIHsgcmV0dXJuIHRoaXMuX2lzSW5pdGlhbGl6ZWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgbW9kZWxzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZU1vZGVscyhhcmdzID0ge3R5cGU6IFwic2VydmVyXCJ9KSB7XG4gICAgY29uc3QgbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgaWYgKHRoaXMuX21vZGVsc0luaXRpYWxpemVkKSByZXR1cm5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgIGNvbnN0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgICAgYXdhaXQgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID09PSBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAmJiAhdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID09PSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5pbml0aWFsaXplTW9kZWxzKGFyZ3MpXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNob3VsZFNraXBEdW1teU1vZGVsSW5pdGlhbGl6YXRpb24gPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfU0tJUF9EVU1NWV9NT0RFTF9JTklUSUFMSVpBVElPTiA9PT0gXCIxXCJcbiAgICAgICAgJiYgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gICAgICAgICYmIHRoaXMuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCJcblxuICAgICAgaWYgKCFzaG91bGRTa2lwRHVtbXlNb2RlbEluaXRpYWxpemF0aW9uKSB7XG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVscyh7Y29uZmlndXJhdGlvbjogdGhpcywgdHlwZTogYXJncy50eXBlfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW5pdGlhbGl6ZVBhY2thZ2VNb2RlbHModGhpcylcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHModGhpcylcblxuICAgICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmluaXRpYWxpemVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVycyh0aGlzKVxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IG1vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX21vZGVsc0luaXRpYWxpemVkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0pKClcblxuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPT09IGluaXRpYWxpemVNb2RlbHNQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgZWFjaCBjb25maWd1cmVkIGRhdGFiYXNlIHBvb2wgaGFzIGEgZ2xvYmFsIGNvbm5lY3Rpb24gYXZhaWxhYmxlLlxuICAgKiBVc2VmdWwgd2hlbiBgZ2V0Q3VycmVudENvbm5lY3Rpb25gIG1pZ2h0IGJlIGNhbGxlZCB3aXRob3V0IGFuIGFzeW5jIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlbnN1cmVHbG9iYWxDb25uZWN0aW9ucygpIHtcbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICBhd2FpdCBwb29sLmVuc3VyZUdsb2JhbENvbm5lY3Rpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBpbml0aWFsaXplKHt0eXBlfSA9IHt0eXBlOiBcInVuZGVmaW5lZFwifSkge1xuICAgIGlmICh0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlXG5cbiAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IHRydWUsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX3NodXRkb3duUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogZmFsc2UsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2V9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9iZWdpbkluaXRpYWxpemUoe3R5cGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBvciBqb2lucyBpbml0aWFsaXphdGlvbiBhZnRlciBsaWZlY3ljbGUgYmxvY2tlcnMgaGF2ZSBzZXR0bGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFN0YXJ0dXAgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIEdlbmVyaWMgYXBwbGljYXRpb24gcHJvY2VzcyB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTaGFyZWQgc3RhcnR1cCBwcm9taXNlLlxuICAgKi9cbiAgX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pIHtcbiAgICBjb25zdCBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlICYmIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcbiAgICB9XG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogZmFsc2UsIHR5cGUsIHdhaXRGb3I6IHRoaXMuX2luaXRpYWxpemVQcm9taXNlfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5faXNJbml0aWFsaXplZCkge1xuICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICAgIHJldHVybiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIH1cbiAgICAvLyBNZW1vaXplIHRoZSBpbi1wcm9ncmVzcyBpbml0aWFsaXphdGlvbiBzbyBjb25jdXJyZW50IGNhbGxlcnMgYXdhaXQgdGhlIHNhbWVcbiAgICAvLyBib290c3RyYXAgaW5zdGVhZCBvZiByYWNpbmcuIGBfaXNJbml0aWFsaXplZGAgd2FzIHByZXZpb3VzbHkgc2V0IHRvIGB0cnVlYFxuICAgIC8vIHVwIGZyb250LCBzbyBhIHNlY29uZCBjYWxsZXIgKGUuZy4gYSBwb29sZWQgcnVubmVyIHdpdGhcbiAgICAvLyBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPiAxYCBzdGFydGluZyBzZXZlcmFsIGpvYnMgb24gYSBjb2xkIGNoaWxkKSBjb3VsZFxuICAgIC8vIHNraXAgaW5pdGlhbGl6YXRpb24gYW5kIGxvYWQgbW9kZWxzIC8gcGVyZm9ybSBhIGpvYiB3aGlsZSB0aGUgZmlyc3QgY2FsbFxuICAgIC8vIHdhcyBzdGlsbCBhd2FpdGluZyBtb2RlbCBkaXNjb3ZlcnkgYW5kIGluaXRpYWxpemVycy4gTWlycm9ycyBjb25uZWN0QmVhY29uLlxuICAgIGNvbnN0IGluaXRpYWxpemVQcm9taXNlID0gdGhpcy5fcnVuSW5pdGlhbGl6ZSh7aW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uLCB0eXBlfSlcblxuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gaW5pdGlhbGl6ZVByb21pc2VcbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgIHJldHVybiBpbml0aWFsaXplUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBvbmUgc2hhcmVkIGluaXRpYWxpemF0aW9uIGJlaGluZCBhbiBpbmNvbXBhdGlibGUgbGlmZWN5Y2xlIHBoYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jb250aW51ZUFmdGVyV2FpdEZhaWx1cmUgLSBXaGV0aGVyIGEgY29tcGxldGVkIGZhaWxlZCBzaHV0ZG93biBzdGlsbCBwZXJtaXRzIHJlcGxhY2VtZW50IHN0YXJ0dXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBSZXBsYWNlbWVudCBwcm9jZXNzIHR5cGUuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gYXJncy53YWl0Rm9yIC0gTGlmZWN5Y2xlIHBoYXNlIHRoYXQgbXVzdCBzZXR0bGUgZmlyc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBxdWV1ZWQgc3RhcnR1cCBwcm9taXNlLlxuICAgKi9cbiAgX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB0eXBlLCB3YWl0Rm9yfSkge1xuICAgIGlmICh0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlXG5cbiAgICBjb25zdCBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgd2FpdEZvcn0pXG5cbiAgICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UgPT09IHdhaXRGb3IpIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSB3YWl0Rm9yKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBjb25zdCBzaHV0ZG93blByb21pc2UgPSB0aGlzLl9zaHV0ZG93blByb21pc2VcblxuICAgICAgaWYgKHNodXRkb3duUHJvbWlzZSkge1xuICAgICAgICBhd2FpdCB0aGlzLl93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogdHJ1ZSwgd2FpdEZvcjogc2h1dGRvd25Qcm9taXNlfSlcbiAgICAgICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSA9PT0gc2h1dGRvd25Qcm9taXNlKSB0aGlzLl9zaHV0ZG93blByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlICYmIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiAhPT0gdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgY29uc3Qgc3RhbGVJbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG5cbiAgICAgICAgYXdhaXQgc3RhbGVJbml0aWFsaXplUHJvbWlzZVxuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IHN0YWxlSW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pXG4gICAgfSkoKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIHJldHVybiBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhIGxpZmVjeWNsZSBwaGFzZSBiZWZvcmUgcXVldWVkIGluaXRpYWxpemF0aW9uIHByb2NlZWRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdhaXQgcG9saWN5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY29udGludWVBZnRlcldhaXRGYWlsdXJlIC0gV2hldGhlciByZXBsYWNlbWVudCBzdGFydHVwIHJlbWFpbnMgYXZhaWxhYmxlIGFmdGVyIGEgZmFpbGVkIHBoYXNlLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IGFyZ3Mud2FpdEZvciAtIExpZmVjeWNsZSBwaGFzZSB0aGF0IG11c3Qgc2V0dGxlIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHF1ZXVlZCBpbml0aWFsaXphdGlvbiBtYXkgY29udGludWUuXG4gICAqL1xuICBhc3luYyBfd2FpdEZvckluaXRpYWxpemVCbG9ja2VyKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHdhaXRGb3J9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdhaXRGb3JcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUpIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGF0b21pYyBmcmFtZXdvcmsgYW5kIGFwcGxpY2F0aW9uIGluaXRpYWxpemF0aW9uIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSW5pdGlhbGl6YXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAtIEZyYW1ld29yayBtb2RlbCBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gR2VuZXJpYyBhcHBsaWNhdGlvbiBwcm9jZXNzIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBfcnVuSW5pdGlhbGl6ZSh7aW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uLCB0eXBlfSkge1xuICAgIGNvbnN0IHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlID0gIXRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWRcblxuICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkge1xuICAgICAgdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCA9IE9iamVjdC5mcmVlemUoe1xuICAgICAgICBpbnN0YW5jZUlkOiBuZXcgVVVJRCg0KS5mb3JtYXQoKSxcbiAgICAgICAgdHlwZVxuICAgICAgfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplTW9kZWxzKHt0eXBlfSlcblxuICAgICAgLy8gTW9kZWwgaW5pdGlhbGl6YXRpb24gY2FuIGJlIGludmFsaWRhdGVkIGJ5IGEgY29uY3VycmVudCBjb25uZWN0aW9uIGNsb3NlLlxuICAgICAgLy8gSWYgbW9kZWxzIGFyZSBub3QgcmVhZHksIHN0b3Agd2l0aG91dCBtYXJraW5nIHRoZSBjb25maWd1cmF0aW9uIGluaXRpYWxpemVkXG4gICAgICAvLyBzbyB0aGUgbmV4dCBjYWxsZXIgcmV0cmllcyBhIGZ1bGwgYm9vdHN0cmFwLlxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICE9PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24gfHwgIXRoaXMuX21vZGVsc0luaXRpYWxpemVkKSB7XG4gICAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmF1dG9EaXNjb3ZlclJlc291cmNlcyh0aGlzKVxuICAgICAgdGhpcy5fbWVyZ2VEaXNjb3ZlcmVkQWJpbGl0eVJlc291cmNlcygpXG4gICAgICB0aGlzLl92YWxpZGF0ZVJlc291cmNlUmVsYXRpb25zaGlwc09uTW9kZWxzKClcblxuICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlICYmIHRoaXMuX2luaXRpYWxpemVycykge1xuICAgICAgICBjb25zdCBpbml0aWFsaXplcnMgPSBhd2FpdCB0aGlzLl9pbml0aWFsaXplcnMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgICBjb25zdCB7cmVxdWlyZUNvbnRleHQsIC4uLnJlc3RBcmdzfSA9IGluaXRpYWxpemVyc1xuXG4gICAgICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICAgICAgaWYgKHJlcXVpcmVDb250ZXh0KSB7XG4gICAgICAgICAgZm9yIChjb25zdCBpbml0aWFsaXplcktleSBvZiByZXF1aXJlQ29udGV4dC5rZXlzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IEluaXRpYWxpemVyQ2xhc3MgPSByZXF1aXJlQ29udGV4dChpbml0aWFsaXplcktleSkuZGVmYXVsdFxuICAgICAgICAgICAgY29uc3QgcHJvY2Vzc0NvbnRleHQgPSB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0XG5cbiAgICAgICAgICAgIGlmICghcHJvY2Vzc0NvbnRleHQpIHRocm93IG5ldyBFcnJvcihcIkFwcGxpY2F0aW9uIHByb2Nlc3MgY29udGV4dCBpcyBub3QgYXZhaWxhYmxlIGR1cmluZyBpbml0aWFsaXplciBzdGFydHVwXCIpXG5cbiAgICAgICAgICAgIGNvbnN0IGluaXRpYWxpemVySW5zdGFuY2UgPSBuZXcgSW5pdGlhbGl6ZXJDbGFzcyh7Y29uZmlndXJhdGlvbjogdGhpcywgcHJvY2Vzc0NvbnRleHQsIHR5cGV9KVxuXG4gICAgICAgICAgICBhd2FpdCBpbml0aWFsaXplckluc3RhbmNlLnJ1bigpXG4gICAgICAgICAgICB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzLnB1c2goaW5pdGlhbGl6ZXJJbnN0YW5jZSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gdHJ1ZVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHtcbiAgICAgICAgbGV0IHRlYXJkb3duRXJyb3JcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpXG4gICAgICAgIH0gY2F0Y2ggKGNhdWdodFRlYXJkb3duRXJyb3IpIHtcbiAgICAgICAgICB0ZWFyZG93bkVycm9yID0gY2F1Z2h0VGVhcmRvd25FcnJvclxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlYXJkb3duRXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgLi4udGVhcmRvd25FcnJvci5lcnJvcnNdLFxuICAgICAgICAgICAgXCJBcHBsaWNhdGlvbiBwcm9jZXNzIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0ZWFyZG93bkVycm9yICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbZXJyb3IsIHRlYXJkb3duRXJyb3JdLFxuICAgICAgICAgICAgXCJBcHBsaWNhdGlvbiBwcm9jZXNzIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAoIXRoaXMuX2lzSW5pdGlhbGl6ZWQgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRlYXJzIGRvd24gZXZlcnkgc3VjY2Vzc2Z1bGx5IHN0YXJ0ZWQgaW5pdGlhbGl6ZXIgaW4gcmV2ZXJzZSBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSB0ZWFyZG93biBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF90ZWFyZG93blN1Y2Nlc3NmdWxJbml0aWFsaXplcnMoKSB7XG4gICAgY29uc3Qgc3VjY2Vzc2Z1bEluaXRpYWxpemVycyA9IHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMuc3BsaWNlKDApLnJldmVyc2UoKVxuXG4gICAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgICBtZXNzYWdlOiBcIkFwcGxpY2F0aW9uIGluaXRpYWxpemVyIHRlYXJkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IHN1Y2Nlc3NmdWxJbml0aWFsaXplcnMubWFwKChpbml0aWFsaXplcikgPT4gYXN5bmMgKCkgPT4gYXdhaXQgaW5pdGlhbGl6ZXIudGVhcmRvd24oKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqIENsZWFycyBhcHBsaWNhdGlvbi1vd25lZCBsaWZlY3ljbGUgc3RhdGUgYWZ0ZXIgZXZlcnkgdGVhcmRvd24gYXR0ZW1wdC4gKi9cbiAgX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKSB7XG4gICAgdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFRlYXJzIGRvd24gdGhlIGN1cnJlbnQgYXBwbGljYXRpb24gbGlmZWN5Y2xlIG9uY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIEV4YWN0IHNoYXJlZCBzaHV0ZG93biBwcm9taXNlLlxuICAgKi9cbiAgc2h1dGRvd24oKSB7XG4gICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3NodXRkb3duUHJvbWlzZVxuXG4gICAgY29uc3QgaW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIGNvbnN0IHNodXRkb3duUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoaW5pdGlhbGl6ZVByb21pc2UpIGF3YWl0IGluaXRpYWxpemVQcm9taXNlXG4gICAgICAgIGF3YWl0IHRoaXMuX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgdGhpcy5faXNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZVByb21pc2UpIHtcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gc2h1dGRvd25Qcm9taXNlXG5cbiAgICByZXR1cm4gc2h1dGRvd25Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoYXQgcmVzb3VyY2UtZGVmaW5lZCByZWxhdGlvbnNoaXBzIGFyZSBhbHNvIGRlZmluZWQgb24gdGhlIGNvcnJlc3BvbmRpbmcgbW9kZWwgY2xhc3Nlcy5cbiAgICogVGhyb3dzIGFuIGVycm9yIGlmIGEgcmVsYXRpb25zaGlwIGlzIGRlZmluZWQgb24gYSByZXNvdXJjZSBidXQgbWlzc2luZyBmcm9tIHRoZSBtb2RlbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVSZXNvdXJjZVJlbGF0aW9uc2hpcHNPbk1vZGVscygpIHtcbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIHRoaXMuX2JhY2tlbmRQcm9qZWN0cykge1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMocmVzb3VyY2VzKSkge1xuICAgICAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZz8ucmVsYXRpb25zaGlwcykgY29udGludWVcblxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzb3VyY2VDb25maWcucmVsYXRpb25zaGlwcykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlIGZvciAke21vZGVsTmFtZX0gZGVmaW5lcyByZWxhdGlvbnNoaXBzIGFzIGFuIG9iamVjdC4gVXNlIGFuIGFycmF5IGluc3RlYWQ6IHN0YXRpYyByZWxhdGlvbnNoaXBzID0gJHtKU09OLnN0cmluZ2lmeShPYmplY3Qua2V5cyhyZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSl9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGZvciAke21vZGVsTmFtZX0gbXVzdCBiZSBhIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MuYClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgICAgICBjb25zdCBleGlzdGluZ1JlbGF0aW9uc2hpcHMgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVxuXG4gICAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiByZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgICAgaWYgKCEocmVsYXRpb25zaGlwTmFtZSBpbiBleGlzdGluZ1JlbGF0aW9uc2hpcHMpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgIGBSZXNvdXJjZSBmb3IgJHttb2RlbE5hbWV9IGRlZmluZXMgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGJ1dCAke21vZGVsTmFtZX0gbW9kZWwgZG9lcyBub3QuIGAgK1xuICAgICAgICAgICAgICBgQWRkICR7bW9kZWxOYW1lfS5iZWxvbmdzVG8oXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIsIC4uLikgb3IgdGhlIGFwcHJvcHJpYXRlIHJlbGF0aW9uc2hpcCBjYWxsIG9uIHRoZSBtb2RlbCBjbGFzcy5gXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVnaXN0ZXJNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsQ2xhc3Nlc1ttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSA9IG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjdXJyZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDdXJyZW50KCkge1xuICAgIHNldEN1cnJlbnRDb25maWd1cmF0aW9uKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcm91dGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgcm91dGVzLlxuICAgKi9cbiAgZ2V0Um91dGVzKCkgeyByZXR1cm4gdGhpcy5fcm91dGVzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcm91dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHR9IG5ld1JvdXRlcyAtIE5ldyByb3V0ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFJvdXRlcyhuZXdSb3V0ZXMpIHtcbiAgICB0aGlzLl9yb3V0ZXMgPSBuZXdSb3V0ZXNcbiAgICB0aGlzLl9hcHBseVJvdXRlTW91bnRzKG5ld1JvdXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGFueSBgcm91dGUubW91bnQoLi4uKWAgcmVnaXN0cmF0aW9ucyBmcm9tIHRoZSByb3V0ZXMgZmlsZSBieSBsZXR0aW5nXG4gICAqIGVhY2ggbW91bnRhYmxlIHJlZ2lzdGVyIGl0cyByb3V0ZXMgKHR5cGljYWxseSByb3V0ZS1yZXNvbHZlciBob29rcykgYWdhaW5zdFxuICAgKiB0aGlzIGNvbmZpZ3VyYXRpb24uIEd1YXJkZWQgc28gcmVwZWF0ZWQgc2V0Um91dGVzIGNhbGxzIHdpdGggdGhlIHNhbWUgcm91dGVzXG4gICAqIGRvbid0IHJlZ2lzdGVyIGEgbW91bnQgbW9yZSB0aGFuIG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdH0gbmV3Um91dGVzIC0gUm91dGVzIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYXBwbHlSb3V0ZU1vdW50cyhuZXdSb3V0ZXMpIHtcbiAgICBpZiAoIW5ld1JvdXRlcyB8fCB0eXBlb2YgbmV3Um91dGVzLmdldE1vdW50cyAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgbW91bnQgb2YgbmV3Um91dGVzLmdldE1vdW50cygpKSB7XG4gICAgICBpZiAodGhpcy5fYXBwbGllZFJvdXRlTW91bnRzLmhhcyhtb3VudCkpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuX2FwcGxpZWRSb3V0ZU1vdW50cy5hZGQobW91bnQpXG4gICAgICBtb3VudC5tb3VudGFibGUubW91bnRJbnRvKHtjb25maWd1cmF0aW9uOiB0aGlzLCAuLi5tb3VudC5vcHRpb25zfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyBwbHVnaW4vbGlicmFyeSByb3V0ZXMgdXNpbmcgYSBsaWdodHdlaWdodCByb3V0ZSBEU0wgYmFja2VkIGJ5IHJvdXRlIHJlc29sdmVyIGhvb2tzLlxuICAgKiBAcGFyYW0geyhyb3V0ZXM6IGltcG9ydChcIi4vcm91dGVzL3BsdWdpbi1yb3V0ZXMuanNcIikuZGVmYXVsdCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBSb3V0ZXMgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJvdXRlcyhjYWxsYmFjaykge1xuICAgIGNvbnN0IHBsdWdpblJvdXRlcyA9IG5ldyBQbHVnaW5Sb3V0ZXMoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuXG4gICAgY2FsbGJhY2socGx1Z2luUm91dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRyYW5zbGF0b3IuXG4gICAqIEBwYXJhbSB7KGFyZzE6IHN0cmluZywgYXJnMjogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkKSA9PiBzdHJpbmd9IGNhbGxiYWNrIC0gVHJhbnNsYXRvciBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VHJhbnNsYXRvcihjYWxsYmFjaykgeyB0aGlzLl90cmFuc2xhdG9yID0gY2FsbGJhY2sgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1zZ0lEIC0gTXNnIGlkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3NdIC0gVHJhbnNsYXRvciBvcHRpb25zIGFuZCB2YXJpYWJsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICovXG4gIF9kZWZhdWx0VHJhbnNsYXRvcihtc2dJRCwgYXJncykge1xuICAgIHRoaXMuX2NvbmZpZ3VyZURlZmF1bHRUcmFuc2xhdG9yKClcblxuICAgIGNvbnN0IHRyYW5zbGF0ZUFyZ3MgPSBhcmdzID8gey4uLmFyZ3N9IDogdW5kZWZpbmVkXG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gdHJhbnNsYXRlQXJncz8uZGVmYXVsdFZhbHVlXG4gICAgY29uc3QgbG9jYWxlcyA9IHRyYW5zbGF0ZUFyZ3M/LmxvY2FsZXNcblxuICAgIGlmICh0cmFuc2xhdGVBcmdzKSB7XG4gICAgICBkZWxldGUgdHJhbnNsYXRlQXJncy5kZWZhdWx0VmFsdWVcbiAgICAgIGRlbGV0ZSB0cmFuc2xhdGVBcmdzLmxvY2FsZXNcbiAgICB9XG5cbiAgICBjb25zdCB2YXJpYWJsZXMgPSB0cmFuc2xhdGVBcmdzICYmIE9iamVjdC5rZXlzKHRyYW5zbGF0ZUFyZ3MpLmxlbmd0aCA+IDAgPyB0cmFuc2xhdGVBcmdzIDogdW5kZWZpbmVkXG5cbiAgICBjb25zdCBsb2NhbGUgPSB0aGlzLmdldExvY2FsZSgpXG4gICAgY29uc3QgcHJlZmVycmVkTG9jYWxlcyA9IGxvY2FsZXMgfHwgKGxvY2FsZSA/IHVuZGVmaW5lZCA6IFtdKVxuICAgIGNvbnN0IG1lc3NhZ2UgPSB0cmFuc2xhdGUobXNnSUQsIHZhcmlhYmxlcywgcHJlZmVycmVkTG9jYWxlcylcblxuICAgIGlmIChtZXNzYWdlID09PSBtc2dJRCAmJiBkZWZhdWx0VmFsdWUpIHJldHVybiB0cmFuc2xhdGUoZGVmYXVsdFZhbHVlLCB2YXJpYWJsZXMsIFtdKVxuXG4gICAgcmV0dXJuIG1lc3NhZ2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cmFuc2xhdG9yLlxuICAgKiBAcmV0dXJucyB7KG1zZ0lEOiBzdHJpbmcsIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHN0cmluZ30gLSBUaGUgY29uZmlndXJlZCB0cmFuc2xhdG9yLlxuICAgKi9cbiAgZ2V0VHJhbnNsYXRvcigpIHtcbiAgICBpZiAodGhpcy5fdHJhbnNsYXRvcikgcmV0dXJuIHRoaXMuX3RyYW5zbGF0b3JcblxuICAgIGlmICghdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZCkge1xuICAgICAgdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZCA9IHRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yLmJpbmQodGhpcylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3JCb3VuZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlIGRlZmF1bHQgdHJhbnNsYXRvci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gQ29uZmlndXJlIGdldHRleHQgZGVmYXVsdHMgZm9yIHRoaXMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9jb25maWd1cmVEZWZhdWx0VHJhbnNsYXRvcigpIHtcbiAgICBjb25zdCBsb2NhbGUgPSB0aGlzLmdldExvY2FsZSgpXG5cbiAgICBnZXR0ZXh0Q29uZmlnLnNldExvY2FsZShsb2NhbGUgfHwgXCJcIilcblxuICAgIGNvbnN0IGZhbGxiYWNrcyA9IGxvY2FsZSA/IHRoaXMuZ2V0TG9jYWxlRmFsbGJhY2tzKCk/Lltsb2NhbGVdIDogW11cblxuICAgIGdldHRleHRDb25maWcuc2V0RmFsbGJhY2tzKGZhbGxiYWNrcyB8fCBbXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lem9uZSBvZmZzZXQgbWludXRlcy5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaGUgdGltZXpvbmUgb2Zmc2V0IGluIG1pbnV0ZXMuXG4gICAqL1xuICBnZXRUaW1lem9uZU9mZnNldE1pbnV0ZXMoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY29uc3QgY29uZmlndXJlZE9mZnNldCA9IHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcygpXG5cbiAgICAgIGlmICh0eXBlb2YgY29uZmlndXJlZE9mZnNldCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIGNvbmZpZ3VyZWRPZmZzZXRcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlc1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgRGF0ZSgpLmdldFRpbWV6b25lT2Zmc2V0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lIHpvbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0VGltZVpvbmUoKSB7XG4gICAgY29uc3QgdGltZVpvbmUgPSB0eXBlb2YgdGhpcy5fdGltZVpvbmUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyB0aGlzLl90aW1lWm9uZSgpXG4gICAgICA6IHRoaXMuX3RpbWVab25lXG5cbiAgICBpZiAodGltZVpvbmUgPT09IHVuZGVmaW5lZCB8fCB0aW1lWm9uZSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiY29uZmlndXJhdGlvbiB0aW1lWm9uZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBldmVudHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IGV2ZW50cy5cbiAgICovXG4gIGdldFdlYnNvY2tldEV2ZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMuanNcIikuZGVmYXVsdH0gd2Vic29ja2V0RXZlbnRzIC0gV2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0V2Vic29ja2V0RXZlbnRzKHdlYnNvY2tldEV2ZW50cykge1xuICAgIHRoaXMuX3dlYnNvY2tldEV2ZW50cyA9IHdlYnNvY2tldEV2ZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFBlci1wcm9jZXNzIHJlZ2lzdHJ5IG9mIGNoYW5uZWwgc3Vic2NyaWJlcnMgdXNlZCBieSB3b3JrZXIgY29kZSB0aGF0XG4gICAqIG5lZWRzIHRvIHJlYWN0IHRvIGV2ZW50cyBicm9hZGNhc3QgdmlhIGB3ZWJzb2NrZXRFdmVudHNIb3N0LnB1Ymxpc2goLi4uKWBcbiAgICogd2l0aG91dCBob2xkaW5nIGFuIGFjdHVhbCB3ZWJzb2NrZXQgc2Vzc2lvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanNcIikuZGVmYXVsdH0gLSBUaGUgY2hhbm5lbCBzdWJzY3JpYmVycyByZWdpc3RyeS5cbiAgICovXG4gIGdldFdlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycygpIHtcbiAgICBpZiAoIXRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycykge1xuICAgICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzID0gbmV3IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjaGFubmVsIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldENoYW5uZWxSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBjaGFubmVsIHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBgVmVsb2Npb3VzV2Vic29ja2V0Q29ubmVjdGlvbmAgc3ViY2xhc3MgdW5kZXIgYSBuYW1lLlxuICAgKiBDbGllbnRzIHRoYXQgc2VuZCBge3R5cGU6IFwiY29ubmVjdGlvbi1vcGVuXCIsIGNvbm5lY3Rpb25UeXBlOiBuYW1lfWBcbiAgICogd2lsbCBoYXZlIHRoaXMgY2xhc3MgaW5zdGFudGlhdGVkIGZvciB0aGVpciBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENsaWVudC1mYWNpbmcgY29ubmVjdGlvbiB0eXBlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdH0gQ29ubmVjdGlvbkNsYXNzIC0gV2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVnaXN0ZXJXZWJzb2NrZXRDb25uZWN0aW9uKG5hbWUsIENvbm5lY3Rpb25DbGFzcykge1xuICAgIGlmICghbmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbiBuYW1lIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCFDb25uZWN0aW9uQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIkNvbm5lY3Rpb25DbGFzcyBpcyByZXF1aXJlZFwiKVxuICAgIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzLnNldChuYW1lLCBDb25uZWN0aW9uQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29ubmVjdGlvbiB0eXBlIG5hbWUgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jb25uZWN0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gUmVnaXN0ZXJlZCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICovXG4gIGdldFdlYnNvY2tldENvbm5lY3Rpb25DbGFzcyhuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzLmdldChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsYCBzdWJjbGFzcyB1bmRlciBhIG5hbWUuXG4gICAqIENsaWVudHMgc3Vic2NyaWJlIHZpYSBge3R5cGU6IFwiY2hhbm5lbC1zdWJzY3JpYmVcIiwgY2hhbm5lbFR5cGU6IG5hbWUsIC4uLn1gLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENsaWVudC1mYWNpbmcgY2hhbm5lbCB0eXBlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gQ2hhbm5lbENsYXNzIC0gV2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsKG5hbWUsIENoYW5uZWxDbGFzcykge1xuICAgIGlmICghbmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2hhbm5lbCBuYW1lIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCFDaGFubmVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIkNoYW5uZWxDbGFzcyBpcyByZXF1aXJlZFwiKVxuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzLnNldChuYW1lLCBDaGFubmVsQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIG5hbWUgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gUmVnaXN0ZXJlZCB3ZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICovXG4gIGdldFdlYnNvY2tldENoYW5uZWxDbGFzcyhuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzLmdldChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFRyYWNrcyBhIGxpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gaW4gdGhlIGdsb2JhbCByb3V0aW5nIHJlZ2lzdHJ5LlxuICAgKiBDYWxsZWQgYnkgdGhlIHNlc3Npb24gd2hlbiBgY2FuU3Vic2NyaWJlKClgIHJlc29sdmVzIHRydXRoeTsgdGhlXG4gICAqIHNlc3Npb24gY2FsbHMgYF91bnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbmAgb24gdW5zdWJzY3JpYmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHVzZWQgYXMgdGhlIHJvdXRpbmcga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gc3Vic2NyaXB0aW9uIC0gTGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiB0byByZWdpc3Rlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKG5hbWUsIHN1YnNjcmlwdGlvbikge1xuICAgIGxldCBidWNrZXQgPSB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5nZXQobmFtZSlcblxuICAgIGlmICghYnVja2V0KSB7XG4gICAgICBidWNrZXQgPSBuZXcgU2V0KClcbiAgICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLnNldChuYW1lLCBidWNrZXQpXG4gICAgfVxuXG4gICAgYnVja2V0LmFkZChzdWJzY3JpcHRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bnJlZ2lzdGVyIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgdXNlZCBhcyB0aGUgcm91dGluZyBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBzdWJzY3JpcHRpb24gLSBMaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIHRvIHJlbW92ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb24obmFtZSwgc3Vic2NyaXB0aW9uKSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkgcmV0dXJuXG5cbiAgICBidWNrZXQuZGVsZXRlKHN1YnNjcmlwdGlvbilcblxuICAgIGlmIChidWNrZXQuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZGVsZXRlKG5hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGl2ZXJzIGBib2R5YCB0byBldmVyeSBsaXZlIHN1YnNjcmliZXIgb2YgYG5hbWVgIHdob3NlXG4gICAqIGBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcylgIHJldHVybnMgdHJ1ZS4gUHVyZSByb3V0aW5nIOKAlCBubyBhdXRoXG4gICAqIHJlLWNoZWNrLCBubyBwZXJzaXN0ZW5jZS4gU3Vic2NyaWJlcnMgd2hvIHdlcmUgYWRtaXR0ZWQgYnlcbiAgICogYGNhblN1YnNjcmliZSgpYCBjb250aW51ZSB0byByZWNlaXZlIGJyb2FkY2FzdHMgdW50aWwgdGhleVxuICAgKiB1bnN1YnNjcmliZSBvciB0aGUgc2Vzc2lvbiBlbmRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHlcbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IHNlc3Npb24gZ3JhY2Ugc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBHcmFjZSBwZXJpb2QgKHNlY29uZHMpIGJlZm9yZSBhIHBhdXNlZCBXUyBzZXNzaW9uIGlzIHRvcm4gZG93bi5cbiAgICovXG4gIGdldFdlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMoKSB7IHJldHVybiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IHNlc3Npb24gaGVhcnRiZWF0IHNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gSW50ZXJ2YWwgKHNlY29uZHMpIGJldHdlZW4gc2VydmVy4oaSY2xpZW50IGhlYXJ0YmVhdCBwaW5nczsgMCBkaXNhYmxlcyByZWFwaW5nLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMoKSB7IHJldHVybiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGVyLXNlc3Npb24gV2ViU29ja2V0IGluYm91bmQgbWVzc2FnZSBxdWV1ZSBsaW1pdHMuXG4gICAqIEByZXR1cm5zIHt7bWF4Qnl0ZXM6IG51bWJlciwgbWF4TWVzc2FnZXM6IG51bWJlcn19IC0gUGVyLXNlc3Npb24gaW5ib3VuZCBxdWV1ZSBoaWdoLXdhdGVyIG1hcmtzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0SW5ib3VuZFF1ZXVlTGltaXRzKCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5odHRwU2VydmVyLndlYnNvY2tldEluYm91bmRRdWV1ZVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1heEJ5dGVzOiBxdWV1ZS5tYXhQZW5kaW5nQnl0ZXMsXG4gICAgICBtYXhNZXNzYWdlczogcXVldWUubWF4UGVuZGluZ01lc3NhZ2VzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGVyLWNsaWVudCBXZWJTb2NrZXQgb3V0Ym91bmQgcXVldWUgbGltaXRzLlxuICAgKiBAcmV0dXJucyB7e21heEJ5dGVzOiBudW1iZXIsIG1heEZyYW1lczogbnVtYmVyfX0gLSBQZXItY2xpZW50IG91dGJvdW5kIHF1ZXVlIGhpZ2gtd2F0ZXIgbWFya3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRPdXRib3VuZFF1ZXVlTGltaXRzKCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5odHRwU2VydmVyLndlYnNvY2tldE91dGJvdW5kUXVldWVcblxuICAgIHJldHVybiB7XG4gICAgICBtYXhCeXRlczogcXVldWUubWF4UGVuZGluZ0J5dGVzLFxuICAgICAgbWF4RnJhbWVzOiBxdWV1ZS5tYXhQZW5kaW5nRnJhbWVzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIHdyYXBwZXIgaW52b2tlZCBhcm91bmQgZXZlcnkgV1MtYm9ybmUgcmVxdWVzdCAvXG4gICAqIGNvbm5lY3Rpb24gbWVzc2FnZSAvIGNoYW5uZWwgZGlzcGF0Y2guIFRoZSB3cmFwcGVyIHJlY2VpdmVzIHRoZVxuICAgKiBzZXNzaW9uIGFuZCBhIGBuZXh0YCBjYWxsYmFjazsgaXQgbXVzdCBjYWxsIGBuZXh0KClgIHRvIHJ1biB0aGVcbiAgICogaGFuZGxlci4gVXNlIGl0IHRvIHNldCB1cCBBc3luY0xvY2FsU3RvcmFnZSBwZXIgcmVxdWVzdC5cbiAgICogQHBhcmFtIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gd3JhcHBlciAtIFBlci1tZXNzYWdlIHNlc3Npb24tY29udGV4dCB3cmFwcGVyLCBvciBudWxsIHRvIGRpc2FibGUgaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0QXJvdW5kUmVxdWVzdCh3cmFwcGVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0QXJvdW5kUmVxdWVzdCA9IHdyYXBwZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgYXJvdW5kIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gLSBXZWJzb2NrZXQgc2Vzc2lvbiB3cmFwcGVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0QXJvdW5kUmVxdWVzdCgpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0QXJvdW5kUmVxdWVzdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIHdyYXBwZXIgaW52b2tlZCBhcm91bmQgZXZlcnkgY29udHJvbGxlciBhY3Rpb24g4oCUIGJvdGhcbiAgICogSFRUUCBhbmQgV1MtYm9ybmUuIFJlY2VpdmVzIGB7cmVxdWVzdCwgcmVzcG9uc2UsIG5leHR9YCBhbmQgbXVzdFxuICAgKiBjYWxsIGBuZXh0KClgIHRvIHJ1biB0aGUgYWN0aW9uLiBVc2UgaXQgZm9yIHBlci1yZXF1ZXN0IGNvbnRleHRcbiAgICogbGlrZSBBc3luY0xvY2FsU3RvcmFnZS1zY29wZWQgbG9jYWxlIG9yIHRyYWNpbmcuXG4gICAqIEBwYXJhbSB7KChjb250ZXh0OiB7cmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgcmVzcG9uc2U6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD59KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IHdyYXBwZXIgLSBQZXItYWN0aW9uIHJlcXVlc3QtY29udGV4dCB3cmFwcGVyLCBvciBudWxsIHRvIGRpc2FibGUgaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QXJvdW5kQWN0aW9uKHdyYXBwZXIpIHtcbiAgICB0aGlzLl9hcm91bmRBY3Rpb24gPSB3cmFwcGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXJvdW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMgeygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAtIEhUVFAgcmVxdWVzdCB3cmFwcGVyLlxuICAgKi9cbiAgZ2V0QXJvdW5kQWN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9hcm91bmRBY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYW4gaWRlbnRpdHkgcmVzb2x2ZXIgY2FsbGVkIG9uY2UgYXQgcGF1c2UgdGltZSBhbmQgb25jZVxuICAgKiBhdCByZXN1bWUgdGltZS4gVGhlIHJlc29sdmVyIHJlY2VpdmVzIHRoZSBzZXNzaW9uIGFuZCByZXR1cm5zIGFueVxuICAgKiB2YWx1ZSB0aGF0IGlkZW50aWZpZXMgdGhlIGF1dGhlbnRpY2F0ZWQgY2FsbGVyIOKAlCB0eXBpY2FsbHkgYVxuICAgKiBgdXNlcklkYCByZWFkIGZyb20gdGhlIHNlc3Npb24ncyB1cGdyYWRlLXJlcXVlc3QgY29va2llLiBWZWxvY2lvdXNcbiAgICogY2FwdHVyZXMgdGhlIHBhdXNlLXRpbWUgdmFsdWUgb24gdGhlIHBhdXNlZCBzZXNzaW9uIGFuZCBjb21wYXJlc1xuICAgKiBpdCB2aWEgYD09PWAgKG9yIGRlZXAtZXF1YWxpdHkgZm9yIHBsYWluIG9iamVjdHMpIHRvIHRoZSBmcmVzaFxuICAgKiByZXN1bWUtdGltZSB2YWx1ZS4gSWYgdGhleSBkaWZmZXIsIHRoZSByZXN1bWUgaXMgcmVqZWN0ZWQgd2l0aFxuICAgKiBgc2Vzc2lvbi1nb25lYCBhbmQgdGhlIHBhdXNlZCBzZXNzaW9uIGlzIGRlc3Ryb3llZCBzbyBhIHNpZ25lZC1vdXRcbiAgICogb3IgcmUtYXV0aGVudGljYXRlZCBjbGllbnQgY2Fubm90IHJlY2xhaW0gYW5vdGhlciB1c2VyJ3Mgc3RhdGUuXG4gICAqXG4gICAqIFJldHVybiBgbnVsbGAvYHVuZGVmaW5lZGAgdG8gbWVhbiBcIm5vIGlkZW50aXR5XCIg4oCUIHJlc3VtZXMgc3RpbGxcbiAgICogc3VjY2VlZCBpZiBwYXVzZSBhbmQgcmVzdW1lIGJvdGggcmVzb2x2ZSB0byBhIG51bGxpc2ggdmFsdWUuXG4gICAqIEBwYXJhbSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9IHJlc29sdmVyIC0gQXV0aGVudGljYXRlZC1jYWxsZXIgaWRlbnRpdHkgcmVzb2x2ZXIsIG9yIG51bGwgdG8gZGlzYWJsZSBpZGVudGl0eSBjaGVja3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IHNlc3Npb24gaWRlbnRpdHkgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgbnVsbH0gLSBUaGUgY29uZmlndXJlZCBpZGVudGl0eSByZXNvbHZlci5cbiAgICovXG4gIGdldFdlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBzZXNzaW9uIGdyYWNlIHNlY29uZHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzZWNvbmRzIC0gR3JhY2UgcGVyaW9kIGJlZm9yZSBhIHBhdXNlZCBzZXNzaW9uIGV4cGlyZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyhzZWNvbmRzKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2Vjb25kcykgfHwgc2Vjb25kcyA8IDApIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBncmFjZSBzZWNvbmRzOiAke3NlY29uZHN9YClcbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzID0gc2Vjb25kc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBzZXNzaW9uIGhlYXJ0YmVhdCBzZWNvbmRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gc2Vjb25kcyAtIEhlYXJ0YmVhdCBpbnRlcnZhbCwgd2l0aCB6ZXJvIGRpc2FibGluZyByZWFwaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzKHNlY29uZHMpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShzZWNvbmRzKSB8fCBzZWNvbmRzIDwgMCkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGhlYXJ0YmVhdCBzZWNvbmRzOiAke3NlY29uZHN9YClcbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyA9IHNlY29uZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBNb3ZlcyBhIHNlc3Npb24gaW50byB0aGUgcGF1c2VkIHJlZ2lzdHJ5IGFuZCBzdGFydHMgdGhlIGdyYWNlXG4gICAqIHRpbWVyLiBXaGVuIHRoZSB0aW1lciBmaXJlcywgdGhlIHNlc3Npb24ncyBwZXJtYW5lbnQgdGVhcmRvd25cbiAgICogaG9vayBpcyBpbnZva2VkLiBDYWxsZWQgYnkgdGhlIHNlc3Npb24gaXRzZWxmIGZyb20gYF9oYW5kbGVDbG9zZWBcbiAgICogd2hlbiB0aGVyZSBpcyByZXN1bWFibGUgc3RhdGUgKGxpdmUgQ29ubmVjdGlvbnMgLyBDaGFubmVsIHN1YnMpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHR9IHNlc3Npb24gLSBSZXN1bWFibGUgc2Vzc2lvbiB0byByZXRhaW4gZHVyaW5nIGl0cyBncmFjZSBwZXJpb2QuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3BhdXNlV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uKSB7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gc2Vzc2lvbi5zZXNzaW9uSWRcblxuICAgIGlmICghc2Vzc2lvbklkKSB0aHJvdyBuZXcgRXJyb3IoXCJTZXNzaW9uIG11c3QgaGF2ZSBhIHNlc3Npb25JZCB0byBiZSBwYXVzZWRcIilcbiAgICBpZiAodGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuaGFzKHNlc3Npb25JZCkpIHJldHVyblxuXG4gICAgY29uc3QgZ3JhY2VNcyA9IHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgKiAxMDAwXG4gICAgY29uc3QgZ3JhY2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fZXhwaXJlV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpXG4gICAgfSwgZ3JhY2VNcylcblxuICAgIC8vIERvbid0IGtlZXAgdGhlIHByb2Nlc3MgYWxpdmUgcHVyZWx5IGZvciBhIHBhdXNlZCBzZXNzaW9uIHRpbWVyLlxuICAgIGlmICh0eXBlb2YgZ3JhY2VUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSBncmFjZVRpbWVyLnVucmVmKClcblxuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLnNldChzZXNzaW9uSWQsIHtzZXNzaW9uLCBncmFjZVRpbWVyLCBwYXVzZWRBdDogRGF0ZS5ub3coKX0pXG4gIH1cblxuICAvKipcbiAgICogTG9va3MgdXAgYSBwYXVzZWQgc2Vzc2lvbiBieSBpZCAoZG9lcyBOT1QgcmVtb3ZlIGl0IOKAlCBjYWxsZXIgaXNcbiAgICogZXhwZWN0ZWQgdG8gY2FsbCBgX3Jlc3VtZVdlYnNvY2tldFNlc3Npb25gIHRvIGNvbXBsZXRlIHRoZSBoYW5kb2ZmKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIgdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIFBhdXNlZCBzZXNzaW9uIHdpdGggdGhlIHJlcXVlc3RlZCBpZGVudGlmaWVyLCBpZiBwcmVzZW50LlxuICAgKi9cbiAgX2ZpbmRQYXVzZWRXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZCkge1xuICAgIHJldHVybiB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKT8uc2Vzc2lvbiB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHBhdXNlZCBzZXNzaW9uIGZyb20gdGhlIHJlZ2lzdHJ5IGFuZCBjYW5jZWxzIGl0cyBncmFjZVxuICAgKiB0aW1lci4gQ2FsbGVkIG9uIHN1Y2Nlc3NmdWwgcmVzdW1lIGhhbmRvZmYgYW5kIG9uIGV4cGxpY2l0XG4gICAqIGV4cGlyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIgdG8gcmVtb3ZlIGFuZCBjYW5jZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2NsZWFyUGF1c2VkV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmdldChzZXNzaW9uSWQpXG5cbiAgICBpZiAoIWVudHJ5KSByZXR1cm5cblxuICAgIGNsZWFyVGltZW91dChlbnRyeS5ncmFjZVRpbWVyKVxuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmRlbGV0ZShzZXNzaW9uSWQpXG4gIH1cblxuICAvKipcbiAgICogR3JhY2UtdGltZXIgY2FsbGJhY2suIENhbGxzIHRoZSBzZXNzaW9uJ3MgcGVybWFuZW50LXRlYXJkb3duXG4gICAqIGhvb2sgYW5kIGRyb3BzIGl0IGZyb20gdGhlIHJlZ2lzdHJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gUGF1c2VkIHNlc3Npb24gaWRlbnRpZmllciB3aG9zZSBncmFjZSBwZXJpb2QgZXhwaXJlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZXhwaXJlV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmdldChzZXNzaW9uSWQpXG5cbiAgICBpZiAoIWVudHJ5KSByZXR1cm5cblxuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmRlbGV0ZShzZXNzaW9uSWQpXG4gICAgdHJ5IHtcbiAgICAgIGVudHJ5LnNlc3Npb24uX2ZpbmFsaXplR3JhY2VFeHBpcnkoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gZmluYWxpemUgZXhwaXJlZCBXUyBzZXNzaW9uICR7c2Vzc2lvbklkfWAsIGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJyb2FkY2FzdCB0byBjaGFubmVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSByZWNlaXZpbmcgdGhlIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtcyAtIFZhbHVlcyB1c2VkIHRvIG1hdGNoIGVsaWdpYmxlIHN1YnNjcmlwdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBCcm9hZGNhc3QgcGF5bG9hZCBkZWxpdmVyZWQgdG8gbWF0Y2hpbmcgc3Vic2NyaXB0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBicm9hZGNhc3RUb0NoYW5uZWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5KSB7XG4gICAgLy8gV2hlbiBCZWFjb24gaXMgY29ubmVjdGVkLCBzaGlwIHRoZSBicm9hZGNhc3Qgb250byB0aGUgYnVzLiBUaGVcbiAgICAvLyBkYWVtb24gZWNob2VzIGl0IGJhY2sgdG8gZXZlcnkgcGVlciAoaW5jbHVkaW5nIHRoaXMgb25lKSBhbmRcbiAgICAvLyBlYWNoIHBlZXIncyBgX2RlbGl2ZXJCcm9hZGNhc3RGcm9tQmVhY29uYCBwZXJmb3JtcyB0aGUgc2FtZVxuICAgIC8vIGxvY2FsIGRlbGl2ZXJ5IGFzIHRoZSBzeW5jaHJvbm91cyBwYXRocyBiZWxvdyDigJQgc28gZXZlcnlcbiAgICAvLyBzdWJzY3JpYmVyLCBpbiBhbnkgcHJvY2Vzcywgc2VlcyBicm9hZGNhc3RzIHZpYSBhIHNpbmdsZSBjb2RlXG4gICAgLy8gcGF0aC5cbiAgICBpZiAodGhpcy5fYmVhY29uQ2xpZW50ICYmIHRoaXMuX2JlYWNvbkNsaWVudC5pc0Nvbm5lY3RlZCgpKSB7XG4gICAgICBjb25zdCBzZW50ID0gdGhpcy5fYmVhY29uQ2xpZW50LnB1Ymxpc2goe2NoYW5uZWw6IG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keX0pXG5cbiAgICAgIGlmIChzZW50KSByZXR1cm5cbiAgICB9XG5cbiAgICAvLyBWMiBzdWJzY3JpcHRpb25zIGxpdmUgcGVyIHdvcmtlci10aHJlYWQuIFdoZW4gcnVubmluZyBpblxuICAgIC8vIHdvcmtlci10aHJlYWQgbW9kZSwgdGhlIHB1Ymxpc2hlciBydW5zIGVpdGhlciBpbiB0aGUgbWFpblxuICAgIC8vIHByb2Nlc3MgKGhvc3QpIG9yIGluIG9uZSBvZiB0aGUgd29ya2VyczpcbiAgICAvL1xuICAgIC8vICAtIE1haW4gcHJvY2VzczogYF93ZWJzb2NrZXRFdmVudHNgIGlzIHRoZSBob3N0IHNpbmdsZXRvbiBhbmRcbiAgICAvLyAgICBgYnJvYWRjYXN0VjJgIGZhbnMgb3V0IHRvIGV2ZXJ5IHdvcmtlciBkaXJlY3RseS5cbiAgICAvLyAgLSBXb3JrZXI6IGBfd2Vic29ja2V0RXZlbnRzYCBoYXMgYHB1Ymxpc2hWMkJyb2FkY2FzdGAgdGhhdFxuICAgIC8vICAgIHBvc3RzIHRvIG1haW4sIHdoaWNoIHRoZW4gZmFucyBvdXQgdG8gZXZlcnkgd29ya2VyLlxuICAgIC8vXG4gICAgLy8gSW4tcHJvY2VzcyBtb2RlIGRvZXNuJ3QgaW5zdGFsbCBhIHdlYnNvY2tldC1ldmVudHMgdHJhbnNwb3J0LFxuICAgIC8vIHNvIGZhbGwgdGhyb3VnaCB0byB0aGUgbG9jYWwgZGlzcGF0Y2guXG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyKHtjaGFubmVsOiBuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHksIGNvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLnB1Ymxpc2hWMkJyb2FkY2FzdCA9PT0gXCJmdW5jdGlvblwiICYmIHdlYnNvY2tldEV2ZW50cy5wYXJlbnRQb3J0KSB7XG4gICAgICB3ZWJzb2NrZXRFdmVudHMucHVibGlzaFYyQnJvYWRjYXN0KHtjaGFubmVsOiBuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHl9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhbGwgcGVuZGluZyBicm9hZGNhc3Qgb3BlcmF0aW9ucyAoaW5jbHVkaW5nIGV2ZW50LWxvZ1xuICAgKiBwZXJzaXN0ZW5jZSkuIENhbGwgdGhpcyBhZnRlciBgYnJvYWRjYXN0VG9DaGFubmVsYCB3aGVuIHlvdSBuZWVkXG4gICAqIHRoZSBldmVudCB0byBiZSBwZXJzaXN0ZWQgYmVmb3JlIGNvbnRpbnVpbmcgKGUuZy4gYmVmb3JlXG4gICAqIHJlc3BvbmRpbmcgdG8gYW4gSFRUUCByZXF1ZXN0KS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzKCkge1xuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgLy8gRHJhaW4gdGhlIGhvc3Qvd29ya2VyIHB1Ymxpc2ggcXVldWVzIChpbmNsdWRpbmcgZXZlbnQtbG9nIHBlcnNpc3RlbmNlKVxuICAgICAgLy8gYmVmb3JlIGRyYWluaW5nIGxvY2FsIGRlbGl2ZXJpZXMsIGJlY2F1c2UgaG9zdCBkaXNwYXRjaCBsYXVuY2hlcyB0aGVcbiAgICAgIC8vIGxvY2FsIGRlbGl2ZXJpZXMgc3luY2hyb25vdXNseSBhbmQgdGhleSBtdXN0IGJlIHBhcnQgb2YgdGhlIHNuYXBzaG90LlxuICAgICAgYXdhaXQgd2Vic29ja2V0RXZlbnRzLmF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMoKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2F3YWl0TG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2NhbCAocGVyLXdvcmtlcikgY2hhbm5lbCBicm9hZGNhc3QgZGlzcGF0Y2guIENhbGxlZCBlaXRoZXJcbiAgICogZGlyZWN0bHkgKGluLXByb2Nlc3MgbW9kZSkgb3IgYnkgdGhlIHdvcmtlciB0aHJlYWQgYWZ0ZXIgdGhlXG4gICAqIG1haW4tcHJvY2VzcyBmYW4tb3V0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtcyAtIFBhcmFtcyBwYXNzZWQgdG8gZWFjaCBzdWJzY3JpcHRpb24ncyBgbWF0Y2hlcygpYC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIE1lc3NhZ2UgYm9keSBkZWxpdmVyZWQgdmlhIGBzZW5kTWVzc2FnZSgpYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEJyb2FkY2FzdE1ldGFkYXRhfSBbbWV0YV0gLSBPcHRpb25hbCBldmVudCBtZXRhZGF0YSBmb3IgcmVwbGF5IHRyYWNraW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHksIG1ldGEpIHtcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5nZXQobmFtZSlcblxuICAgIGlmICghYnVja2V0KSByZXR1cm5cblxuICAgIGZvciAoY29uc3Qgc3Vic2NyaXB0aW9uIG9mIGJ1Y2tldCkge1xuICAgICAgaWYgKHN1YnNjcmlwdGlvbi5pc0Nsb3NlZCgpKSBjb250aW51ZVxuXG4gICAgICBsZXQgbWF0Y2hlc1xuXG4gICAgICB0cnkge1xuICAgICAgICBtYXRjaGVzID0gc3Vic2NyaXB0aW9uLm1hdGNoZXMoYnJvYWRjYXN0UGFyYW1zIHx8IHt9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gQSBicm9rZW4gYG1hdGNoZXMoKWAgb24gb25lIHN1YnNjcmliZXIgbXVzdCBub3QgcG9pc29uIHRoZVxuICAgICAgICAvLyBicm9hZGNhc3QgdG8gb3RoZXIgc3Vic2NyaWJlcnMuIFNraXAgYW5kIGNvbnRpbnVlLlxuICAgICAgICBjb25zb2xlLmVycm9yKGBicm9hZGNhc3RUb0NoYW5uZWw6ICR7bmFtZX0gc3Vic2NyaXB0aW9uICR7c3Vic2NyaXB0aW9uLnN1YnNjcmlwdGlvbklkfSBtYXRjaGVzKCkgdGhyZXdgLCBlcnJvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKCFtYXRjaGVzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBkZWxpdmVyeU1ldGFkYXRhID0ge1xuICAgICAgICBicm9hZGNhc3RQYXJhbXMsXG4gICAgICAgIC4uLihtZXRhPy5ldmVudElkID8ge2V2ZW50SWQ6IG1ldGEuZXZlbnRJZH0gOiB7fSlcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByZXZpb3VzRGVsaXZlcnkgPSB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZ2V0KHN1YnNjcmlwdGlvbilcbiAgICAgIGNvbnN0IGRlbGl2ZXJ5ID0gdGhpcy53aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0cygoKSA9PiB7XG4gICAgICAgIHJldHVybiAocHJldmlvdXNEZWxpdmVyeSB8fCBQcm9taXNlLnJlc29sdmUoKSlcbiAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLl9kZWxpdmVyV2Vic29ja2V0Q2hhbm5lbEJyb2FkY2FzdChzdWJzY3JpcHRpb24sIGJvZHksIGRlbGl2ZXJ5TWV0YWRhdGEpKVxuICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYGJyb2FkY2FzdFRvQ2hhbm5lbDogJHtuYW1lfSBzdWJzY3JpcHRpb24gJHtzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWR9IGRlbGl2ZXJCcm9hZGNhc3QgdGhyZXdgLCBlcnJvcilcbiAgICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLnNldChzdWJzY3JpcHRpb24sIGRlbGl2ZXJ5KVxuXG4gICAgICAvLyBLZWVwIHRoZSBmaXJlLWFuZC1mb3JnZXQgZGVsaXZlcnkgKG5ldmVyIGF3YWl0ZWQgYXQgYnJvYWRjYXN0IHRpbWUpIGJ1dFxuICAgICAgLy8gdHJhY2sgaXQgc28gYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGNhbiBkcmFpbiBpdCBiZWZvcmUgc2V0dGxpbmcuIFJlbW92ZVxuICAgICAgLy8gb24gc2V0dGxlOyB0aGUgZmFpbHVyZSBoYW5kbGVyIGFsc28gc2F0aXNmaWVzIHRoZSBwcm9taXNlIHNvIGEgcmVqZWN0ZWRcbiAgICAgIC8vIGRlbGl2ZXJ5IG5ldmVyIGJlY29tZXMgYW4gdW5oYW5kbGVkIHJlamVjdGlvbi5cbiAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcy5hZGQoZGVsaXZlcnkpXG5cbiAgICAgIC8qKlxuICAgICAgICogUmVtb3ZlcyBhIHNldHRsZWQgZGVsaXZlcnkgZnJvbSBsb2NhbCB0cmFja2luZy5cbiAgICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAgICovXG4gICAgICBjb25zdCBmb3JnZXREZWxpdmVyeSA9ICgpID0+IHtcbiAgICAgICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzLmRlbGV0ZShkZWxpdmVyeSlcbiAgICAgICAgaWYgKHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5nZXQoc3Vic2NyaXB0aW9uKSA9PT0gZGVsaXZlcnkpIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5kZWxldGUoc3Vic2NyaXB0aW9uKVxuICAgICAgfVxuXG4gICAgICBkZWxpdmVyeS50aGVuKGZvcmdldERlbGl2ZXJ5LCBmb3JnZXREZWxpdmVyeSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIGEgc25hcHNob3Qgb2YgdGhlIGluLWZsaWdodCBsb2NhbCAocGVyLXByb2Nlc3MpIHdlYnNvY2tldCBjaGFubmVsXG4gICAqIGJyb2FkY2FzdCBkZWxpdmVyaWVzLiBDYWxsZWQgZnJvbSBgYXdhaXRQZW5kaW5nQnJvYWRjYXN0c2AgYWZ0ZXIgdGhlIGhvc3RcbiAgICogcHVibGlzaCBxdWV1ZXMgZHJhaW4sIHNvIGV2ZXJ5IGRlbGl2ZXJ5IHRob3NlIHF1ZXVlcyBsYXVuY2hlZCBpcyBjYXB0dXJlZC5cbiAgICogTmV3IGRlbGl2ZXJpZXMgZW5xdWV1ZWQgYWZ0ZXIgdGhlIHNuYXBzaG90IGFyZSBub3QgYXdhaXRlZC4gSW5kaXZpZHVhbFxuICAgKiBkZWxpdmVyeSBlcnJvcnMgYXJlIGlzb2xhdGVkIHBlciBzdWJzY3JpYmVyIOKAlCB0aGUgZGVsaXZlcnkgY2hhaW4gYWxyZWFkeVxuICAgKiBsb2dzIHRoZW0gYW5kIHJlc29sdmVzIOKAlCBzbyBhIHNuYXBzaG90dGVkIHJlamVjdGlvbiBuZXZlciBmYWlscyB0aGlzIGJhcnJpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2F3YWl0TG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzKCkge1xuICAgIGNvbnN0IHNuYXBzaG90ID0gWy4uLnRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllc11cblxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChzbmFwc2hvdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgd2Vic29ja2V0IGNoYW5uZWwgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gc3Vic2NyaXB0aW9uIC0gQ2hhbm5lbCBzdWJzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRKc29uVmFsdWV9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEJyb2FkY2FzdE1ldGFkYXRhfSBtZXRhIC0gQnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IEJyb2FkY2FzdCBkZWxpdmVyeSByZXN1bHQuXG4gICAqL1xuICBfZGVsaXZlcldlYnNvY2tldENoYW5uZWxCcm9hZGNhc3Qoc3Vic2NyaXB0aW9uLCBib2R5LCBtZXRhKSB7XG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb24uZGVsaXZlckJyb2FkY2FzdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gc3Vic2NyaXB0aW9uLmRlbGl2ZXJCcm9hZGNhc3QoYm9keSwgbWV0YSlcbiAgICB9XG5cbiAgICByZXR1cm4gc3Vic2NyaXB0aW9uLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICovXG4gIGdldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgY2hhbm5lbCByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyVHlwZX0gcmVzb2x2ZXIgLSBSZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0V2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyKHJlc29sdmVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyVHlwZX0gcmVzb2x2ZXIgLSBSZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0V2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIgPSByZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFiaWxpdHkgcmVzb2x2ZXIgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gW2FyZ3MucmVxdWVzdF0gLSBSZXF1ZXN0IG9iamVjdC4gQWJzZW50IGZvciB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb25zIHJlc29sdmVkIGZyb20gc3Vic2NyaWJlIHBhcmFtcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSBbYXJncy5yZXNwb25zZV0gLSBSZXNwb25zZSBvYmplY3QuIEFic2VudCBvdXRzaWRlIEhUVFAgcmVxdWVzdCBoYW5kbGluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZWQgYWJpbGl0eS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVBYmlsaXR5KHtwYXJhbXMsIHJlcXVlc3QsIHJlc3BvbnNlfSkge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5nZXRBYmlsaXR5UmVzb2x2ZXIoKVxuXG4gICAgaWYgKHJlc29sdmVyKSB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHJlc29sdmVyKHtjb25maWd1cmF0aW9uOiB0aGlzLCBwYXJhbXMsIHJlcXVlc3QsIHJlc3BvbnNlfSlcblxuICAgICAgaWYgKHJlc29sdmVkKSByZXR1cm4gcmVzb2x2ZWRcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZXMgPSB0aGlzLmdldEFiaWxpdHlSZXNvdXJjZXMoKVxuXG4gICAgaWYgKHJlc291cmNlcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgcmV0dXJuIG5ldyBBYmlsaXR5KHtcbiAgICAgIGNvbnRleHQ6IHtjb25maWd1cmF0aW9uOiB0aGlzLCBwYXJhbXMsIHJlcXVlc3QsIHJlc3BvbnNlfSxcbiAgICAgIHJlc291cmNlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFiaWxpdHkgLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQWJpbGl0eShhYmlsaXR5LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IHJlcXVlc3RUaW1pbmcgLSBSZXF1ZXN0IHRpbWluZyBjb2xsZWN0b3IuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhSZXF1ZXN0VGltaW5nKHJlcXVlc3RUaW1pbmcsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2ZpbGVzIGFuIGFwcGxpY2F0aW9uLWRlZmluZWQgdGVzdCBhY3Rpdml0eSB3aGVuIGFuIG9wdC1pbiB0ZXN0IHByb2ZpbGVcbiAgICogY29udGV4dCBpcyBhY3RpdmUuIFRoZSBjYWxsYmFjayBhbHdheXMgcnVucywgaW5jbHVkaW5nIG91dHNpZGUgcHJvZmlsaW5nLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvdy1jYXJkaW5hbGl0eSBhY3Rpdml0eSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IChUIHwgUHJvbWlzZTxUPil9IGNhbGxiYWNrIC0gQWN0aXZpdHkgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHByb2ZpbGVUZXN0QWN0aXZpdHkobmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCB2YWxpZGF0ZWROYW1lID0gdmFsaWRhdGVUZXN0QWN0aXZpdHlOYW1lKG5hbWUpXG5cbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KClcblxuICAgIGlmICghY29udGV4dCkgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcblxuICAgIHJldHVybiBhd2FpdCBjb250ZXh0LnByb2ZpbGVyLnByb2ZpbGVBY3Rpdml0eShjb250ZXh0LCB2YWxpZGF0ZWROYW1lLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRpbWV6b25lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGltZVpvbmUgLSBJQU5BIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGltZXpvbmUodGltZVpvbmUsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IGFiaWxpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgYWJpbGl0eSBmcm9tIGNvbnRleHQuXG4gICAqL1xuICBnZXRDdXJyZW50QWJpbGl0eSgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50QWJpbGl0eSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCByZXF1ZXN0IHRpbWluZyBjb2xsZWN0b3IuXG4gICAqL1xuICBnZXRDdXJyZW50UmVxdWVzdFRpbWluZygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCB0ZW5hbnQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IHRlbmFudCBmcm9tIGNvbnRleHQuXG4gICAqL1xuICBnZXRDdXJyZW50VGVuYW50KCkge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEN1cnJlbnRUZW5hbnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGVuYW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0ZW5hbnQgLSBUZW5hbnQuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGVuYW50KHRlbmFudCwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoVGVuYW50KHRlbmFudCwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIHRlbmFudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBUZW5hbnQgcmVzb2x2ZXIgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5yZXF1ZXN0IC0gUmVxdWVzdCBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5yZXNwb25zZSAtIFJlc3BvbnNlIG9iamVjdC5cbiAgICogQHBhcmFtIHt7Y2hhbm5lbDogc3RyaW5nLCBwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBbYXJncy5zdWJzY3JpcHRpb25dIC0gU3Vic2NyaXB0aW9uIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZWQgdGVuYW50LlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZVRlbmFudCh7cGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZSwgc3Vic2NyaXB0aW9ufSkge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5nZXRUZW5hbnRSZXNvbHZlcigpXG5cbiAgICBpZiAoIXJlc29sdmVyKSByZXR1cm5cblxuICAgIHJldHVybiBhd2FpdCByZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgcGFyYW1zLFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgc3Vic2NyaXB0aW9uXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlcnJvciBldmVudHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJldmVudGVtaXR0ZXIzXCIpLkV2ZW50RW1pdHRlcn0gLSBGcmFtZXdvcmsgZXJyb3IgZXZlbnRzIGVtaXR0ZXIuXG4gICAqL1xuICBnZXRFcnJvckV2ZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5fZXJyb3JFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSByZXBvcnRlciB0aGF0IGNhbiBhZGQgY2xpZW50LXNhZmUgbWV0YWRhdGEgdG8gZnJvbnRlbmQtbW9kZWwgZXJyb3IgcGF5bG9hZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyVHlwZX0gcmVwb3J0ZXIgLSBSZXBvcnRlciBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRDbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcihyZXBvcnRlcikge1xuICAgIHRoaXMuX2NsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVycy5wdXNoKHJlcG9ydGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXJlZCBjbGllbnQgZXJyb3IgcGF5bG9hZCByZXBvcnRlcnMuXG4gICAqIEBwYXJhbSB7e2NvbnRleHQ6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRDb250ZXh0LCBlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gUmVwb3J0ZXIgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZD59IC0gTWVyZ2VkIGNsaWVudC1zYWZlIHJlcG9ydGVyIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBjbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihhcmdzKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkfSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSB0aGlzLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZXF1ZXN0VGltaW5nID8gcmVxdWVzdFRpbWluZy5nZXRMb2dTZW5zaXRpdmVWYWx1ZXMoKSA6IG5ldyBTZXQoKVxuICAgIGNvbnN0IGRldGFpbHMgPSByZXF1ZXN0RGV0YWlscyhhcmdzLnJlcXVlc3QsIHtyZWRhY3RvcjogdGhpcy5nZXRMb2dSZWRhY3RvcigpLCBzZW5zaXRpdmVWYWx1ZXN9KVxuXG4gICAgZm9yIChjb25zdCByZXBvcnRlciBvZiB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMpIHtcbiAgICAgIGNvbnN0IHJlcG9ydGVyUGF5bG9hZCA9IGF3YWl0IHJlcG9ydGVyKHtcbiAgICAgICAgLi4uYXJncyxcbiAgICAgICAgcmVxdWVzdERldGFpbHM6IGRldGFpbHNcbiAgICAgIH0pXG5cbiAgICAgIGlmIChyZXBvcnRlclBheWxvYWQgJiYgdHlwZW9mIHJlcG9ydGVyUGF5bG9hZCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBPYmplY3QuYXNzaWduKHBheWxvYWQsIHJlcG9ydGVyUGF5bG9hZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHRlc3QgYXR0ZW1wdCBpbiBhIHJldm9jYWJsZSBkYXRhYmFzZS1hY2Nlc3MgY29udGV4dC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7cmV2b2tlZDogYm9vbGVhbn19IHNjb3BlIC0gQXR0ZW1wdC1vd25lZCBhY2Nlc3Mgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gVCB8IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQXR0ZW1wdCB3b3JrLlxuICAgKiBAcmV0dXJucyB7VCB8IFByb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHNjb3BlLCBjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJzaXN0ZW50IGZyYW1ld29yayB3b3JrIHdpdGhvdXQgaW5oZXJpdGluZyBhIHRlc3QgYXR0ZW1wdCdzIHJldm9jYWJsZSBkYXRhYmFzZS1hY2Nlc3Mgc2NvcGUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVCB8IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGVyc2lzdGVudCB3b3JrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aG91dEN1cnJlbnRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHVuZGVmaW5lZCwgY2FsbGJhY2spXG4gIH1cblxuICAvKiogVGhyb3dzIHdoZW4gYSB0aW1lZC1vdXQgdGVzdCBhdHRlbXB0IHRyaWVzIHRvIHN0YXJ0IG1vcmUgZGF0YWJhc2Ugd29yay4gKi9cbiAgYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKCkge1xuICAgIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuYXNzZXJ0VGVzdERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGNvbm5lY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhDb25uZWN0aW9ucyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgY29uc3Qge1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIG5hbWVcbiAgICB9ID0gcmVzb2x2ZVdpdGhDb25uZWN0aW9uc0FyZ3Mob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrLCBcIkNvbmZpZ3VyYXRpb24ud2l0aENvbm5lY3Rpb25zXCIpXG5cbiAgICBpZiAoIWFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJ3aXRoQ29ubmVjdGlvbnMgcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgLyoqXG4gICAgICogRGJzLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgY29uc3QgZGJzID0ge31cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYnMsXG4gICAgICBpZGVudGlmaWVyczogZGF0YWJhc2VJZGVudGlmaWVycyA/PyB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSxcbiAgICAgIG5hbWUsXG4gICAgICBzdGFja0xhYmVsOiBcIndpdGhDb25uZWN0aW9uc1wiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cGxpY2l0IG1vZGVsIHdvcmsgaW4gYSB0cmFuc2FjdGlvbiBwaW5uZWQgdG8gb25lIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBuYW1lPzogc3RyaW5nfX0gb3B0aW9ucyAtIE9wZXJhdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IERhdGFiYXNlT3BlcmF0aW9uKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aFRyYW5zYWN0aW9uKHtkYXRhYmFzZUlkZW50aWZpZXIsIG5hbWUgPSBcIkNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uXCIsIC4uLnJlc3RBcmdzfSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvbiByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG4gICAgaWYgKCF0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKS5pbmNsdWRlcyhkYXRhYmFzZUlkZW50aWZpZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3IgaW5hY3RpdmUgZGF0YWJhc2UgaWRlbnRpZmllcjogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnQgPSB0aGlzLmdldEN1cnJlbnRUZW5hbnQoKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuXG4gICAgcmV0dXJuIGF3YWl0IHBvb2wud2l0aE9wZXJhdGlvbkNvbm5lY3Rpb24oe25hbWV9LCBhc3luYyAoY29ubmVjdGlvbiwgb3duZXIpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IG5ldyBEYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgY29uZmlndXJhdGlvblJldXNlS2V5OiBwb29sLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbiksXG4gICAgICAgIGNvbm5lY3Rpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgb3duZXIsXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IG9wZXJhdGlvbi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24pXG4gICAgICAgIH0pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBvcGVyYXRpb24uY29tcGxldGUoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBsaWNpdCBtb2RlbCB3b3JrIG9uIG9uZSBjb25uZWN0aW9uIHNlbGVjdGVkIGZyb20gYSBjYXB0dXJlZCBwaHlzaWNhbFxuICAgKiBkYXRhYmFzZSBjb25maWd1cmF0aW9uLiBObyBhbWJpZW50IHRlbmFudCB2YWx1ZSBpcyByZWFkIGR1cmluZyBjaGVja291dCBvclxuICAgKiBleGVjdXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGUsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBuYW1lPzogc3RyaW5nLCBzY2hlbWFHZW5lcmF0aW9uPzogc3RyaW5nLCB0ZW5hbnQ/OiBvYmplY3R9fSBvcHRpb25zIC0gQ2FwdHVyZWQgb3BlcmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogRGF0YWJhc2VPcGVyYXRpb24pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoRGF0YWJhc2VPcGVyYXRpb24oe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lID0gXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvblwiLCBzY2hlbWFHZW5lcmF0aW9uLCB0ZW5hbnQsIC4uLnJlc3RBcmdzfSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGRhdGFiYXNlQ29uZmlndXJhdGlvblwiKVxuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbiByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25SZXVzZUtleSA9IHBvb2wuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbilcblxuICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhDYXB0dXJlZE9wZXJhdGlvbkNvbm5lY3Rpb24oe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgbmFtZX0sIGFzeW5jIChjb25uZWN0aW9uLCBvd25lcikgPT4ge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gbmV3IERhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgICBjb25maWd1cmF0aW9uUmV1c2VLZXksXG4gICAgICAgIGNvbm5lY3Rpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgZW5mb3JjZUN1cnJlbnRUZW5hbnRSZXVzZUtleTogZmFsc2UsXG4gICAgICAgIG93bmVyLFxuICAgICAgICBzY2hlbWFHZW5lcmF0aW9uLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBvcGVyYXRpb24uY29tcGxldGUoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYWxsYmFjayB3aXRoIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGZvciB0aGUgcmVxdWVzdGVkIGlkZW50aWZpZXJzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tjYWxsYmFjazogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+LCBkYnM6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+LCBpZGVudGlmaWVyczogc3RyaW5nW10sIG5hbWU6IHN0cmluZywgc3RhY2tMYWJlbDogc3RyaW5nfX0gYXJncyAtIENvbm5lY3Rpb24gc2NvcGUgZGV0YWlscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERhdGFiYXNlSWRlbnRpZmllckNvbm5lY3Rpb25zKHtjYWxsYmFjaywgZGJzLCBpZGVudGlmaWVycywgbmFtZSwgc3RhY2tMYWJlbH0pIHtcbiAgICBjb25zdCBzdGFjayA9IEVycm9yKCkuc3RhY2tcbiAgICBjb25zdCBhY3R1YWxDYWxsYmFjayA9IGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIHJldHVybiBhd2FpdCB3aXRoVHJhY2tlZFN0YWNrKHN0YWNrIHx8IHN0YWNrTGFiZWwsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRicylcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVuIHJlcXVlc3QuXG4gICAgICogQHR5cGUgeygpID0+IFByb21pc2U8VD59ICovXG4gICAgbGV0IHJ1blJlcXVlc3QgPSBhY3R1YWxDYWxsYmFja1xuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGlkZW50aWZpZXJzKSB7XG4gICAgICBsZXQgYWN0dWFsUnVuUmVxdWVzdCA9IHJ1blJlcXVlc3RcblxuICAgICAgY29uc3QgbmV4dFJ1blJlcXVlc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS53aXRoQ29ubmVjdGlvbih7bmFtZX0sIGFzeW5jIChkYikgPT4ge1xuICAgICAgICAgIGRic1tpZGVudGlmaWVyXSA9IGRiXG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgYWN0dWFsUnVuUmVxdWVzdCgpXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJ1blJlcXVlc3QgPSBuZXh0UnVuUmVxdWVzdFxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5SZXF1ZXN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbZGF0YWJhc2VJZGVudGlmaWVyc10gLSBEYXRhYmFzZSBpZGVudGlmaWVycyB0byBpbmNsdWRlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IEEgbWFwIG9mIGRhdGFiYXNlIGNvbm5lY3Rpb25zIHdpdGggaWRlbnRpZmllciBhcyBrZXlcbiAgICovXG4gIGdldEN1cnJlbnRDb25uZWN0aW9ucyhkYXRhYmFzZUlkZW50aWZpZXJzID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgLyoqXG4gICAgICogRGJzLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgY29uc3QgZGJzID0ge31cblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBkYXRhYmFzZUlkZW50aWZpZXJzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcbiAgICAgICAgY29uc3QgY3VycmVudENvbm5lY3Rpb24gPSBwb29sLmdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbiA/IHBvb2wuZ2V0Q3VycmVudENvbnRleHRDb25uZWN0aW9uKCkgOiBwb29sLmdldEN1cnJlbnRDb25uZWN0aW9uKClcblxuICAgICAgICBpZiAoY3VycmVudENvbm5lY3Rpb24gJiYgKCFwb29sLmNvbm5lY3Rpb25NYXRjaGVzQ3VycmVudENvbmZpZ3VyYXRpb24gfHwgcG9vbC5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uKGN1cnJlbnRDb25uZWN0aW9uKSkpIHtcbiAgICAgICAgICBkYnNbaWRlbnRpZmllcl0gPSBjdXJyZW50Q29ubmVjdGlvblxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAodGhpcy5pc01pc3NpbmdDdXJyZW50Q29ubmVjdGlvbkVycm9yKGVycm9yKSkge1xuICAgICAgICAgIC8vIElnbm9yZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRob3V0IGN1cnJlbnQgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biB3aXRob3V0IGluaGVyaXRlZCBEQiBjb25uZWN0aW9uIGNvbnRleHRzLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICB3aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0cyhjYWxsYmFjaykge1xuICAgIGxldCBydW5DYWxsYmFjayA9ICgpID0+IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcnMoY2FsbGJhY2spXG5cbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAoIXBvb2wpIGNvbnRpbnVlXG4gICAgICBjb25zdCBwcmV2aW91c1J1bkNhbGxiYWNrID0gcnVuQ2FsbGJhY2tcblxuICAgICAgcnVuQ2FsbGJhY2sgPSAoKSA9PiBwb29sLndpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQocHJldmlvdXNSdW5DYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuQ2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBpbnNpZGUgZXZlcnkgcG9vbCdzIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gY29udGV4dCAoYSBuby1vcCBmb3JcbiAgICogcG9vbHMgd2l0aG91dCBvbmUpLiBJbi1wcm9jZXNzIHJlcXVlc3QgaGFuZGxpbmcgaXMgd3JhcHBlZCBpbiB0aGlzIHNvIGEgcmVxdWVzdFxuICAgKiBydW5zIG9uIHRoZSBzYW1lIGNvbm5lY3Rpb24g4oCUIGFuZCBvcGVuIHRyYW5zYWN0aW9uIOKAlCBhcyB0aGUgdGVzdCB0aGF0IGlzc3VlZCBpdCxcbiAgICogbGV0dGluZyByZXF1ZXN0IHNwZWNzIGNsZWFuIHVwIGJ5IHJvbGxpbmcgYmFjayBpbnN0ZWFkIG9mIHRydW5jYXRpbmcuIE91dHNpZGVcbiAgICogdGVzdHMgbm8gc2hhcmVkIGNvbm5lY3Rpb24gaXMgc2V0LCBzbyB0aGlzIGp1c3QgcnVucyB0aGUgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gaW5zaWRlIHRoZSBzaGFyZWQgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoY2FsbGJhY2spIHtcbiAgICBsZXQgcnVuQ2FsbGJhY2sgPSBjYWxsYmFja1xuXG4gICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuICAgICAgY29uc3QgcHJldmlvdXNSdW5DYWxsYmFjayA9IHJ1bkNhbGxiYWNrXG5cbiAgICAgIHJ1bkNhbGxiYWNrID0gKCkgPT4gcG9vbC5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb24ocHJldmlvdXNSdW5DYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuQ2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbWlzc2luZyBjdXJyZW50IGNvbm5lY3Rpb24gZXJyb3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRXJyb3IgdGhyb3duIHdoaWxlIGxvb2tpbmcgdXAgdGhlIGN1cnJlbnQgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZXJyb3IgbWVhbnMgbm8gY3VycmVudCBjb25uZWN0aW9uIGlzIGF2YWlsYWJsZS5cbiAgICovXG4gIGlzTWlzc2luZ0N1cnJlbnRDb25uZWN0aW9uRXJyb3IoZXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiAoXG4gICAgICBlcnJvci5tZXNzYWdlID09IFwiSUQgaGFzbid0IGJlZW4gc2V0IGZvciB0aGlzIGFzeW5jIGNvbnRleHRcIiB8fFxuICAgICAgZXJyb3IubWVzc2FnZSA9PSBcIkEgY29ubmVjdGlvbiBoYXNuJ3QgYmVlbiBtYWRlIHlldFwiIHx8XG4gICAgICBlcnJvci5tZXNzYWdlLnN0YXJ0c1dpdGgoXCJObyBhc3luYyBjb250ZXh0IHNldCBmb3IgZGF0YWJhc2UgY29ubmVjdGlvblwiKSB8fFxuICAgICAgZXJyb3IubWVzc2FnZS5zdGFydHNXaXRoKFwiQ29ubmVjdGlvbiBcIikgJiYgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhcImRvZXNuJ3QgZXhpc3QgYW55IG1vcmVcIilcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgY29ubmVjdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgfCBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ29ubmVjdGlvbnMob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBuYW1lXG4gICAgfSA9IHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgXCJDb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zXCIpXG5cbiAgICBpZiAoIWFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJlbnN1cmVDb25uZWN0aW9ucyByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICBjb25zdCByZXF1ZXN0ZWRJZGVudGlmaWVycyA9IGRhdGFiYXNlSWRlbnRpZmllcnMgPz8gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKClcbiAgICBjb25zdCBkYnMgPSB0aGlzLmdldEN1cnJlbnRDb25uZWN0aW9ucyhyZXF1ZXN0ZWRJZGVudGlmaWVycylcbiAgICBjb25zdCBtaXNzaW5nSWRlbnRpZmllcnMgPSByZXF1ZXN0ZWRJZGVudGlmaWVycy5maWx0ZXIoKGlkZW50aWZpZXIpID0+IHtcbiAgICAgIGlmICghZGJzW2lkZW50aWZpZXJdKSByZXR1cm4gdHJ1ZVxuXG4gICAgICByZXR1cm4gIXRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmhhc0N1cnJlbnRDb25uZWN0aW9uQ29udGV4dCgpXG4gICAgfSlcblxuICAgIGlmIChtaXNzaW5nSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gYXdhaXQgYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2soZGJzKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYnMsXG4gICAgICBpZGVudGlmaWVyczogbWlzc2luZ0lkZW50aWZpZXJzLFxuICAgICAgbmFtZSxcbiAgICAgIHN0YWNrTGFiZWw6IFwiZW5zdXJlQ29ubmVjdGlvbnNcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgZGVkaWNhdGVkIGNvbm5lY3Rpb24gdGhhdCBjdXJyZW50bHkgaG9sZHMgYW4gYWR2aXNvcnkgbG9jaywgc28gYVxuICAgKiBzaHV0ZG93biBjYW4gY2xvc2UgaXQgYW5kIHJlbGVhc2UgdGhlIGxvY2suIFNlZSBgX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gVGhlIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVnaXN0ZXJBZHZpc29yeUxvY2tDb25uZWN0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICB0aGlzLl9hZHZpc29yeUxvY2tDb25uZWN0aW9ucy5hZGQoY29ubmVjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb24gb25jZSBpdHMgbG9jayBzY29wZSBlbmRzIGFuZCB0aGVcbiAgICogY29ubmVjdGlvbiBoYXMgYmVlbiAob3IgaXMgYWJvdXQgdG8gYmUpIGNsb3NlZCBieSBpdHMgb3duZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHVucmVnaXN0ZXJBZHZpc29yeUxvY2tDb25uZWN0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICB0aGlzLl9hZHZpc29yeUxvY2tDb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgZXZlcnkgcmVnaXN0ZXJlZCBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uLCBlbmRpbmcgaXRzIHNlc3Npb24gc29cbiAgICogdGhlIERCIHNlcnZlciByZWxlYXNlcyB0aGUgbG9jay4gRXZlcnkgY29ubmVjdGlvbiBpcyBhdHRlbXB0ZWQgYmVmb3JlIGFueSBmYWlsdXJlXG4gICAqIGlzIHN1cmZhY2VkLCBzbyBvbmUgc3R1Y2sgY2xvc2UgZG9lcyBub3QgbGVhdmUgdGhlIG90aGVycycgbG9ja3MgaGVsZDsgYSBmYWlsdXJlIGlzXG4gICAqIHRoZW4gdGhyb3duIChuZXZlciBzd2FsbG93ZWQpLCBhZ2dyZWdhdGVkIHdoZW4gbW9yZSB0aGFuIG9uZSBjb25uZWN0aW9uIGZhaWxlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSBhbGwgaGF2ZSBiZWVuIGNsb3NlZDsgcmVqZWN0cyBpZiBhbnkgZmFpbGVkLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlQWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBbLi4udGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnNdXG5cbiAgICB0aGlzLl9hZHZpc29yeUxvY2tDb25uZWN0aW9ucy5jbGVhcigpXG5cbiAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIGNvbm5lY3Rpb25zKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gY2xvc2UgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgYWN0aXZlIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGFuZCBjbGVhcnMgZ2xvYmFsIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zKCkge1xuICAgIGlmICh0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1NldDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3QgY29uc3RydWN0b3JzID0gbmV3IFNldCgpXG5cbiAgICB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICAgIGNvbnN0IGNsb3NlRXJyb3JzID0gW11cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jbG9zZUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBDbG9zZSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9ucyBmaXJzdDogdGhleSBhcmUgc3Bhd25lZCBvdXRzaWRlIHRoZVxuICAgICAgICAgIC8vIHBvb2xzJyB0cmFja2VkIHNldHMsIHNvIGBwb29sLmNsb3NlQWxsKClgIHdvdWxkIG5vdCByZWFjaCB0aGVtIGFuZCBhIGxvY2sgaGVsZFxuICAgICAgICAgIC8vIGJ5IGEgcnVubmVyIHRvcm4gZG93biBtaWQtcGFzcyB3b3VsZCBsZWFrIHVudGlsIHRoZSBEQiBzZXJ2ZXIncyBgd2FpdF90aW1lb3V0YC5cbiAgICAgICAgICAvLyBTdGlsbCBjbG9zZSB0aGUgcG9vbHMgaWYgdGhpcyB0aHJvd3MsIHNvIGEgc3R1Y2sgbG9jayBjb25uZWN0aW9uIGRvZXMgbm90XG4gICAgICAgICAgLy8gbGVhdmUgdGhlIHJlc3Qgb2YgdGhlIGNvbm5lY3Rpb25zIG9wZW4uXG4gICAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tDb25uZWN0aW9ucygpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuXG4gICAgICAgICAgICBhd2FpdCBwb29sLmNsb3NlQWxsKClcblxuICAgICAgICAgICAgY29uc3QgUG9vbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gKi8gKHBvb2wuY29uc3RydWN0b3IpXG4gICAgICAgICAgICBjb25zdHJ1Y3RvcnMuYWRkKFBvb2xDbGFzcylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IFBvb2xDbGFzcyBvZiBjb25zdHJ1Y3RvcnMpIHtcbiAgICAgICAgICAgIFBvb2xDbGFzcy5jbGVhckdsb2JhbENvbm5lY3Rpb25zKHRoaXMpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhpcy5fZnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUucmVzZXQoKVxuXG4gICAgICAgICAgLy8gQWxsb3cgZnVsbCByZS1pbml0aWFsaXphdGlvbiBhZnRlciBjb25uZWN0aW9ucyBhcmUgY2xvc2VkLlxuICAgICAgICAgIHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICs9IDFcbiAgICAgICAgICB0aGlzLl9tb2RlbHNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgICAgICAgdGhpcy5faXNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBjbG9zZUVycm9yc1swXVxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihjbG9zZUVycm9ycywgXCJGYWlsZWQgdG8gY2xvc2UgYmFja2dyb3VuZC1qb2JzIGFuZCBkYXRhYmFzZSByZXNvdXJjZXNcIilcbiAgICB9KSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGVuZHBvaW50IHJlcXVlc3QgYXV0aG9yaXplZC5cbiAgICogQHBhcmFtIHt7aGVhZGVyOiAobmFtZTogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfX0gcmVxdWVzdCAtIEluY29taW5nIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleHBlY3RlZFRva2VuIC0gQ29uZmlndXJlZCBkZWJ1Zy1lbmRwb2ludCB0b2tlbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdCBjYXJyaWVzIHRoZSBleHBlY3RlZCBiZWFyZXIgdG9rZW4uXG4gICAqL1xuICBkZWJ1Z0VuZHBvaW50UmVxdWVzdEF1dGhvcml6ZWQocmVxdWVzdCwgZXhwZWN0ZWRUb2tlbikge1xuICAgIGNvbnN0IGhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiYXV0aG9yaXphdGlvblwiKVxuXG4gICAgaWYgKHR5cGVvZiBoZWFkZXIgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgbWF0Y2ggPSAoL15CZWFyZXJcXHMrKC4rKSQvaSkuZXhlYyhoZWFkZXIudHJpbSgpKVxuXG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5kZWJ1Z0VuZHBvaW50VG9rZW5NYXRjaGVzKG1hdGNoWzFdLCBleHBlY3RlZFRva2VuKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFwaSBtYW5pZmVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+fSAtIEFQSSBtYW5pZmVzdCBmb3IgYWxsIHJlZ2lzdGVyZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZ2V0QXBpTWFuaWZlc3QoKSB7XG4gICAgcmV0dXJuIGZyb250ZW5kTW9kZWxBcGlNYW5pZmVzdCh0aGlzLl9iYWNrZW5kUHJvamVjdHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGV0aGVyIEFQSSBtYW5pZmVzdCBpcyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBBUEkgbWFuaWZlc3QgZW5kcG9pbnQgaXMgZW5hYmxlZC5cbiAgICovXG4gIF9hcGlNYW5pZmVzdEVuYWJsZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FwaU1hbmlmZXN0LmVuYWJsZWRcbiAgfVxufVxuIl19