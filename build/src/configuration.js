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
        for (const pool of Object.values(this.databasePools)) {
            if (pool.getConfigurationReuseKey() === reuseKey) {
                pool.clearSchemaCache();
            }
        }
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
     * @param {{eventId?: string}} [meta] - Optional event metadata for replay tracking.
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
            const delivery = this.withoutCurrentConnectionContexts(() => {
                return Promise
                    .resolve()
                    .then(() => this._deliverWebsocketChannelBroadcast(subscription, body, { eventId: meta?.eventId }))
                    .catch((error) => {
                    console.error(`broadcastToChannel: ${name} subscription ${subscription.subscriptionId} deliverBroadcast threw`, error);
                });
            });
            // Keep the fire-and-forget delivery (never awaited at broadcast time) but
            // track it so `awaitPendingBroadcasts` can drain it before settling. Remove
            // on settle; the failure handler also satisfies the promise so a rejected
            // delivery never becomes an unhandled rejection.
            this._localBroadcastDeliveries.add(delivery);
            delivery.then(() => { this._localBroadcastDeliveries.delete(delivery); }, () => { this._localBroadcastDeliveries.delete(delivery); });
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
     * @param {{eventId?: string}} meta - Broadcast metadata.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFBYSxNQUFNLDRCQUE0QixDQUFBO0FBQ3RELE9BQU8sRUFBRSx3QkFBd0IsRUFB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LENBQUMsQ0FBQTtRQUU5QyxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVE7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU1QyxNQUFNLEtBQUssR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBRXRELElBQUksQ0FBQyxLQUFLO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFeEIsT0FBTyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyx5QkFBeUIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsYUFBYSxDQUFDLENBQUE7SUFDeEYsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxjQUFjO1FBQ2xCLE9BQU8sd0JBQXdCLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILG1CQUFtQjtRQUNqQixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFBO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZSB0eXBlLlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHsoYXJnOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0PikgPT4gUHJvbWlzZTxUPn0gV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogV2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbZGF0YWJhc2VJZGVudGlmaWVyc10gLSBEYXRhYmFzZSBpZGVudGlmaWVycyB0byBpbmNsdWRlIGluIHRoZSBjb25uZWN0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtuYW1lXSAtIEh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoZSBjaGVja2VkLW91dCBkYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAqL1xuLyoqXG4gKiBPbmUgYWRhcHRlciBpbnN0YW5jZSBhbmQgaXRzIHNlcmlhbGl6ZWQgcmVhZHkvY2xvc2UgbGlmZWN5Y2xlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy9hZGFwdGVyLmpzXCIpLmRlZmF1bHR9IGFkYXB0ZXIgLSBBZGFwdGVyIG93bmVkIGJ5IHRoaXMgZ2VuZXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY2xvc2luZyAtIFdoZXRoZXIgY2xvc2UgaGFzIGNsYWltZWQgdGhpcyBnZW5lcmF0aW9uLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSByZWFkeVByb21pc2UgLSBTaGFyZWQgcmVhZGluZXNzIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IGNsb3NlUHJvbWlzZSAtIFNoYXJlZCBjbG9zZSBvcGVyYXRpb24uXG4gKi9cblxuaW1wb3J0IHsgZGlnZyB9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IGdldHRleHRDb25maWcgZnJvbSBcImdldHRleHQtdW5pdmVyc2FsL2J1aWxkL3NyYy9jb25maWcuanNcIlxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5pbXBvcnQgdHJhbnNsYXRlIGZyb20gXCJnZXR0ZXh0LXVuaXZlcnNhbC9idWlsZC9zcmMvdHJhbnNsYXRlLmpzXCJcbmltcG9ydCBBYmlsaXR5IGZyb20gXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGZyb20gXCIuL2JhY2tncm91bmQtam9icy9hZGFwdGVyLmpzXCJcbmltcG9ydCBEYXRhYmFzZU9wZXJhdGlvbiBmcm9tIFwiLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIlxuaW1wb3J0IHsgaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHMgfSBmcm9tIFwiLi9kYXRhYmFzZS9yZWNvcmQvYXVkaXRpbmcuanNcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgZnJvbSBcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanNcIlxuaW1wb3J0IHsgQ3VycmVudENvbmZpZ3VyYXRpb25Ob3RTZXRFcnJvciwgY3VycmVudENvbmZpZ3VyYXRpb24sIHNldEN1cnJlbnRDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vY3VycmVudC1jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCB7IHJlcXVlc3REZXRhaWxzIH0gZnJvbSBcIi4vZXJyb3ItcmVwb3J0aW5nL3JlcXVlc3QtZGV0YWlscy5qc1wiXG5pbXBvcnQgTG9nUmVkYWN0b3IgZnJvbSBcIi4vbG9nLXJlZGFjdG9yLmpzXCJcbmltcG9ydCB7IGZyb250ZW5kTW9kZWxBcGlNYW5pZmVzdCwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QgfSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQgeyBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleSwgbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleSB9IGZyb20gXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiXG5pbXBvcnQgUGx1Z2luUm91dGVzIGZyb20gXCIuL3JvdXRlcy9wbHVnaW4tcm91dGVzLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRlc3RBY3Rpdml0eU5hbWUgfSBmcm9tIFwiLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1hY3Rpdml0eS5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRpbWVab25lIH0gZnJvbSBcIi4vdGltZS16b25lLmpzXCJcbmltcG9ydCB7IHdpdGhUcmFja2VkU3RhY2sgfSBmcm9tIFwiLi91dGlscy93aXRoLXRyYWNrZWQtc3RhY2suanNcIlxuaW1wb3J0IFZlbG9jaW91c1BhY2thZ2UgZnJvbSBcIi4vcGFja2FnZXMvdmVsb2Npb3VzLXBhY2thZ2UuanNcIlxuaW1wb3J0IEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlIGZyb20gXCIuL3RlbmFudHMvZnJvbnRlbmQtdGVuYW50LXNxbGl0ZS1saWZlY3ljbGUuanNcIlxuaW1wb3J0IHsgcmVzb2x2ZUdlbmVyYXRpb25JZCwgcmVzb2x2ZUluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIHJlc29sdmVMaWZlY3ljbGVTb2NrZXRQYXRoIH0gZnJvbSBcIi4vYmFja2dyb3VuZC1qb2JzL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5cbmV4cG9ydCB7IEN1cnJlbnRDb25maWd1cmF0aW9uTm90U2V0RXJyb3IgfVxuXG4vKipcbiAqIFJ1bnMgY3VycmVudCB3b3JraW5nIGRpcmVjdG9yeS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ3VycmVudCB3b3JraW5nIGRpcmVjdG9yeSB3aGVuIHRoZSBydW50aW1lIGV4cG9zZXMgb25lLlxuICovXG5mdW5jdGlvbiBjdXJyZW50V29ya2luZ0RpcmVjdG9yeSgpIHtcbiAgY29uc3QgcHJvY2Vzc09iamVjdCA9IC8qKiBAdHlwZSB7e2N3ZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB8IHVuZGVmaW5lZH0gKi8gKGdsb2JhbFRoaXMucHJvY2VzcylcblxuICBpZiAodHlwZW9mIHByb2Nlc3NPYmplY3Q/LmN3ZCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHByb2Nlc3NPYmplY3QuY3dkKClcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgb3ZlcmxvYWRlZCB3aXRoL2Vuc3VyZSBjb25uZWN0aW9ucyBhcmd1bWVudHMuXG4gKiBAdGVtcGxhdGUgVFxuICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD4gfCB1bmRlZmluZWR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcGFyYW0ge3N0cmluZ30gZGVmYXVsdE5hbWUgLSBEZWZhdWx0IGNoZWNrb3V0IG5hbWUuXG4gKiBAcmV0dXJucyB7e2RhdGFiYXNlSWRlbnRpZmllcnM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBuYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD4gfCB1bmRlZmluZWR9fSBSZXNvbHZlZCBjaGVja291dCBvcHRpb25zIGFuZCBjYWxsYmFjay5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVdpdGhDb25uZWN0aW9uc0FyZ3Mob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrLCBkZWZhdWx0TmFtZSkge1xuICBpZiAodHlwZW9mIG9wdGlvbnNPckNhbGxiYWNrID09IFwiZnVuY3Rpb25cIikge1xuICAgIGNvbnN0IGFjdHVhbENhbGxiYWNrID0gLyoqIEB0eXBlIHtXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59ICovIChvcHRpb25zT3JDYWxsYmFjaylcblxuICAgIHJldHVybiB7ZGF0YWJhc2VJZGVudGlmaWVyczogdW5kZWZpbmVkLCBuYW1lOiBkZWZhdWx0TmFtZSwgY2FsbGJhY2s6IGFjdHVhbENhbGxiYWNrfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhYmFzZUlkZW50aWZpZXJzOiBvcHRpb25zT3JDYWxsYmFjay5kYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgIG5hbWU6IG9wdGlvbnNPckNhbGxiYWNrLm5hbWUgfHwgZGVmYXVsdE5hbWUsXG4gICAgY2FsbGJhY2tcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgY2Fub25pY2FsIGRlYnVnIHNuYXBzaG90IHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTbmFwc2hvdCB2YWx1ZSB0byBjYW5vbmljYWxpemUuXG4gKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFNuYXBzaG90IHZhbHVlIHdpdGggb2JqZWN0IGtleXMgc29ydGVkIHJlY3Vyc2l2ZWx5LlxuICovXG5mdW5jdGlvbiBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiB2YWx1ZVxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5tYXAoKGVudHJ5KSA9PiBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoZW50cnkpKVxuXG4gIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpLnJlZHVjZSgocmVzdWx0LCBrZXkpID0+IHtcbiAgICByZXN1bHRba2V5XSA9IGNhbm9uaWNhbERlYnVnU25hcHNob3RWYWx1ZSgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVtrZXldKVxuICAgIHJldHVybiByZXN1bHRcbiAgfSwgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7fSkpXG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gQmFzZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZSB8IFBhcnRpYWw8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGU+IHwgdm9pZH0gb3ZlcnJpZGVDb25maWd1cmF0aW9uIC0gVGVuYW50IG92ZXJyaWRlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gTWVyZ2VkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG1lcmdlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3ZlcnJpZGVDb25maWd1cmF0aW9uKSB7XG4gIGlmICghb3ZlcnJpZGVDb25maWd1cmF0aW9uKSByZXR1cm4gZGF0YWJhc2VDb25maWd1cmF0aW9uXG5cbiAgcmV0dXJuIHtcbiAgICAuLi5kYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgLi4ub3ZlcnJpZGVDb25maWd1cmF0aW9uLFxuICAgIHJlY29yZDoge1xuICAgICAgLi4uKGRhdGFiYXNlQ29uZmlndXJhdGlvbi5yZWNvcmQgfHwge30pLFxuICAgICAgLi4uKG92ZXJyaWRlQ29uZmlndXJhdGlvbi5yZWNvcmQgfHwge30pXG4gICAgfSxcbiAgICBzcWxDb25maWc6IHtcbiAgICAgIC4uLihkYXRhYmFzZUNvbmZpZ3VyYXRpb24uc3FsQ29uZmlnIHx8IHt9KSxcbiAgICAgIC4uLihvdmVycmlkZUNvbmZpZ3VyYXRpb24uc3FsQ29uZmlnIHx8IHt9KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBncmFjZSB3aW5kb3cgKG1zKSBiZWZvcmUgYSBzdXN0YWluZWQgYmVhY29uIG91dGFnZSBpcyByZXBvcnRlZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBgdW5yZWFjaGFibGVSZXBvcnRNc2AsIGlmIGFueS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGNvbmZpZ3VyZWQgdmFsdWUgd2hlbiBpdCdzIGEgZmluaXRlIG51bWJlciwgb3RoZXJ3aXNlIHRoZSAzMHMgZGVmYXVsdC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUJlYWNvblVucmVhY2hhYmxlUmVwb3J0TXModmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWVcblxuICByZXR1cm4gMzBfMDAwXG59XG5cbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfQllURVMgPSAxNiAqIDEwMjQgKiAxMDI0XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX01FU1NBR0VTID0gMjU2XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19CWVRFUyA9IDE2ICogMTAyNCAqIDEwMjRcbmNvbnN0IERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0ZSQU1FUyA9IDI1NlxuXG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCA9IDEwMjRcbmNvbnN0IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFkgPSA0XG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUwgPSA2XG5cbi8qKlxuICogVmFsaWRhdGVzIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0VmFsdWUgLSBEZWZhdWx0IHZhbHVlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZGF0ZWQgY29uZmlndXJlZCBvciBkZWZhdWx0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHZhbHVlLCBuYW1lLCBkZWZhdWx0VmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBkZWZhdWx0VmFsdWVcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGAke25hbWV9IG11c3QgYmUgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXJgKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFuIGludGVnZXIgY29uZmlndXJhdGlvbiB2YWx1ZSBpbnNpZGUgYW4gaW5jbHVzaXZlIHJhbmdlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbmZpZ3VyYXRpb24ga2V5LlxuICogQHBhcmFtIHtudW1iZXJ9IG1pbiAtIE1pbmltdW0gYWNjZXB0ZWQgdmFsdWUgKGluY2x1c2l2ZSkuXG4gKiBAcGFyYW0ge251bWJlcn0gbWF4IC0gTWF4aW11bSBhY2NlcHRlZCB2YWx1ZSAoaW5jbHVzaXZlKS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0VmFsdWUgLSBEZWZhdWx0IHZhbHVlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZGF0ZWQgY29uZmlndXJlZCBvciBkZWZhdWx0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBpbnRlZ2VySW5SYW5nZSh2YWx1ZSwgbmFtZSwgbWluLCBtYXgsIGRlZmF1bHRWYWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGRlZmF1bHRWYWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IG1pbiB8fCB2YWx1ZSA+IG1heCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYCR7bmFtZX0gbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gJHttaW59IGFuZCAke21heH1gKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyB0aGUgYnVmZmVyZWQgSFRUUCByZXNwb25zZSBjb21wcmVzc2lvbiBjb25maWd1cmF0aW9uLiBDb21wcmVzc2lvbiBpc1xuICogZW5hYmxlZCBieSBkZWZhdWx0IHdoZW4gdGhlIHNldHRpbmcgaXMgYWJzZW50OyBgZmFsc2VgIG9yIGB7ZW5hYmxlZDogZmFsc2V9YFxuICogZGlzYWJsZXMgaXQgZ2xvYmFsbHkuXG4gKiBAcGFyYW0ge2Jvb2xlYW4gfCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDb25maWd1cmVkIGNvbXByZXNzaW9uIHZhbHVlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkSHR0cENvbXByZXNzaW9uQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIGNvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUh0dHBDb21wcmVzc2lvbih2YWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gdHJ1ZSkge1xuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgdGhyZXNob2xkOiBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCwgYnJvdGxpUXVhbGl0eTogREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSwgZ3ppcExldmVsOiBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUx9XG4gIH1cblxuICBpZiAodmFsdWUgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgdGhyZXNob2xkOiBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCwgYnJvdGxpUXVhbGl0eTogREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSwgZ3ppcExldmVsOiBERUZBVUxUX0NPTVBSRVNTSU9OX0daSVBfTEVWRUx9XG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbiBtdXN0IGJlIGEgYm9vbGVhbiBvciBhbiBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gIH1cblxuICBjb25zdCB7YnJvdGxpUXVhbGl0eSwgZW5hYmxlZCwgZ3ppcExldmVsLCB0aHJlc2hvbGQsIC4uLnJlc3RDb21wcmVzc2lvbn0gPSB2YWx1ZVxuICBjb25zdCByZXN0Q29tcHJlc3Npb25LZXlzID0gT2JqZWN0LmtleXMocmVzdENvbXByZXNzaW9uKVxuXG4gIGlmIChyZXN0Q29tcHJlc3Npb25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBodHRwU2VydmVyLmNvbXByZXNzaW9uIHJlY2VpdmVkIHVua25vd24ga2V5czogJHtyZXN0Q29tcHJlc3Npb25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYnJvdGxpUXVhbGl0eSwgZW5hYmxlZCwgZ3ppcExldmVsLCB0aHJlc2hvbGQpYClcbiAgfVxuXG4gIGlmIChlbmFibGVkICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGVuYWJsZWQgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbi5lbmFibGVkIG11c3QgYmUgYSBib29sZWFuLCBnb3Q6ICR7U3RyaW5nKGVuYWJsZWQpfWApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGVuYWJsZWQ6IGVuYWJsZWQgPz8gdHJ1ZSxcbiAgICB0aHJlc2hvbGQ6IHBvc2l0aXZlU2FmZUludGVnZXIodGhyZXNob2xkLCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24udGhyZXNob2xkXCIsIERFRkFVTFRfQ09NUFJFU1NJT05fVEhSRVNIT0xEKSxcbiAgICBicm90bGlRdWFsaXR5OiBpbnRlZ2VySW5SYW5nZShicm90bGlRdWFsaXR5LCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uYnJvdGxpUXVhbGl0eVwiLCAwLCAxMSwgREVGQVVMVF9DT01QUkVTU0lPTl9CUk9UTElfUVVBTElUWSksXG4gICAgZ3ppcExldmVsOiBpbnRlZ2VySW5SYW5nZShnemlwTGV2ZWwsIFwiaHR0cFNlcnZlci5jb21wcmVzc2lvbi5nemlwTGV2ZWxcIiwgMCwgOSwgREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NvbmZpZ3VyYXRpb24ge1xuICAvKipcbiAgICogQ2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvbnMgcHJvbWlzZS5cbiAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICBfY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IG51bGxcblxuICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gIF9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zIGN1cnJlbnRseSBob2xkaW5nIGEgbG9jay4gVGhlc2UgYXJlIHNwYXduZWRcbiAgICogb3V0c2lkZSB0aGUgcG9vbHMnIHRyYWNrZWQgc2V0cyAoc28gYSBob2xkLXRpbWVvdXQgbG9jayBzdXJ2aXZlcyBwb29sIGNoZWNrb3V0cyksXG4gICAqIHNvIGBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNgIHdvdWxkIG90aGVyd2lzZSB3YWxrIHBhc3QgdGhlbTsgdHJhY2tpbmcgdGhlbSBoZXJlXG4gICAqIGxldHMgYSBzaHV0ZG93biBjbG9zZSB0aGVtIGFuZCByZWxlYXNlIHRoZSBsb2NrIGluc3RlYWQgb2Ygb3JwaGFuaW5nIGl0LlxuICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMgPSBuZXcgU2V0KClcblxuICAvKipcbiAgICogUnVucyBjdXJyZW50LlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzQ29uZmlndXJhdGlvbn0gLSBUaGUgY3VycmVudC5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIHJldHVybiBjdXJyZW50Q29uZmlndXJhdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ29uZmlndXJhdGlvbkFyZ3NUeXBlfSBhcmdzIC0gQ29uZmlndXJhdGlvbiBhcmd1bWVudHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YWJpbGl0eVJlc29sdmVyLCBhYmlsaXR5UmVzb3VyY2VzLCBhdHRhY2htZW50cywgYXV0b2xvYWQgPSB0cnVlLCBiYWNrZ3JvdW5kSm9icywgYmFja2VuZFByb2plY3RzLCBiZWFjb24sIGNvb2tpZVNlY3JldCwgY29ycywgZGF0YWJhc2UsIGRlYnVnID0gZmFsc2UsIGRlYnVnRW5kcG9pbnQgPSBmYWxzZSwgYXBpTWFuaWZlc3QgPSBmYWxzZSwgZGlyZWN0b3J5LCBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSB0cnVlLCBlbnZpcm9ubWVudCwgZW52aXJvbm1lbnRIYW5kbGVyLCBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cywgZnJvbnRlbmRUZW5hbnRTcWxpdGUsIGh0dHBTZXJ2ZXIsIGluaXRpYWxpemVNb2RlbHMsIGluaXRpYWxpemVycywgbG9jYWxlLCBsb2NhbGVGYWxsYmFja3MsIGxvY2FsZXMsIGxvZ2dpbmcsIG1haWxlckJhY2tlbmQsIHBhY2thZ2VzLCByZXF1ZXN0VGltZW91dE1zLCByb3V0ZVJlc29sdmVySG9va3MsIHNjaGVkdWxlZEJhY2tncm91bmRKb2JzLCBzZWN1cmVGcm9udGVuZE1vZGVsRXJyb3JzLCBzdHJ1Y3R1cmVTcWwsIHN5bmMsIHRlbmFudERhdGFiYXNlUHJvdmlkZXJzLCB0ZW5hbnREYXRhYmFzZVJlc29sdmVyLCB0ZW5hbnRSZXNvbHZlciwgdGVzdGluZywgdGltZVpvbmUsIHRpbWV6b25lT2Zmc2V0TWludXRlcywgdHJ1c3RlZFByb3hpZXMsIHdlYnNvY2tldENoYW5uZWxSZXNvbHZlciwgd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMuX2FiaWxpdHlSZXNvbHZlciA9IGFiaWxpdHlSZXNvbHZlclxuICAgIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSBhYmlsaXR5UmVzb3VyY2VzIHx8IFtdXG4gICAgdGhpcy5fYXV0b2xvYWQgPSBhdXRvbG9hZFxuICAgIHRoaXMuX2JhY2tncm91bmRKb2JzID0gYmFja2dyb3VuZEpvYnNcbiAgICB0aGlzLl9iZWFjb24gPSBiZWFjb25cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBjbGllbnQgdmFsdWUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBjb25uZWN0IHByb21pc2UgdmFsdWUuXG4gICAgICogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIHJlcG9ydCB0aW1lciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9IC0gUGVuZGluZyBcImJlYWNvbiBzdGlsbCB1bnJlYWNoYWJsZVwiIHJlcG9ydCB0aW1lci5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIG91dGFnZSByZXBvcnRlZCB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjdXJyZW50IGJlYWNvbiBvdXRhZ2UgaGFzIGFscmVhZHkgYmVlbiByZXBvcnRlZC5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gbGFzdCBkb3duIGVycm9yIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7c3RhZ2U6IFwiYmVhY29uLWNvbm5lY3RcIiB8IFwiYmVhY29uLWRpc2Nvbm5lY3RcIiwgZXJyb3I6IEVycm9yfSB8IHVuZGVmaW5lZH0gLSBMYXRlc3QgYmVhY29uLWRvd24gZGV0YWlscywgcmVwb3J0ZWQgb25seSBpZiB0aGUgb3V0YWdlIGlzIHN1c3RhaW5lZC5cbiAgICAgKi9cbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgPSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICAgIHRoaXMuX2F0dGFjaG1lbnRzID0gYXR0YWNobWVudHMgfHwge31cbiAgICAvLyBDb3B5IHNvIGFwcGVuZGluZyBwYWNrYWdlLWRlcml2ZWQgZW50cmllcyBiZWxvdyBuZXZlciBtdXRhdGVzIGEgY2FsbGVyJ3NcbiAgICAvLyBzaGFyZWQgYXJyYXkgKGNvbmZpZyBtb2R1bGVzIGNvbW1vbmx5IGV4cG9ydCBhIHJldXNlZCBiYWNrZW5kUHJvamVjdHMgYXJyYXkpLlxuICAgIHRoaXMuX2JhY2tlbmRQcm9qZWN0cyA9IGJhY2tlbmRQcm9qZWN0cyA/IFsuLi5iYWNrZW5kUHJvamVjdHNdIDogW11cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclR5cGVbXX0gKi9cbiAgICB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMgPSBbXVxuICAgIHRoaXMuY29ycyA9IGNvcnNcbiAgICB0aGlzLl9jb29raWVTZWNyZXQgPSBjb29raWVTZWNyZXRcbiAgICB0aGlzLmRhdGFiYXNlID0gZGF0YWJhc2VcbiAgICB0aGlzLmRlYnVnID0gZGVidWdcbiAgICB0aGlzLl9kZWJ1Z0VuZHBvaW50ID0gdGhpcy5fbm9ybWFsaXplRGVidWdFbmRwb2ludChkZWJ1Z0VuZHBvaW50KVxuICAgIHRoaXMuX2FwaU1hbmlmZXN0ID0gdGhpcy5fbm9ybWFsaXplQXBpTWFuaWZlc3QoYXBpTWFuaWZlc3QpXG4gICAgdGhpcy5fZW52aXJvbm1lbnQgPSBlbnZpcm9ubWVudCB8fCBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfRU5WIHx8IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52Lk5PREVfRU5WIHx8IFwiZGV2ZWxvcG1lbnRcIlxuICAgIHRoaXMuX2Vudmlyb25tZW50SGFuZGxlciA9IGVudmlyb25tZW50SGFuZGxlclxuICAgIHRoaXMuX2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyA9IGVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3Blc1xuICAgIHRoaXMuX2V4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzID0gZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgPT09IHVuZGVmaW5lZFxuICAgICAgPyBzZWN1cmVGcm9udGVuZE1vZGVsRXJyb3JzICE9PSB0cnVlXG4gICAgICA6IGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzXG4gICAgdGhpcy5fZGlyZWN0b3J5ID0gZGlyZWN0b3J5XG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVscyA9IGluaXRpYWxpemVNb2RlbHNcbiAgICAvKiogQHR5cGUge1ZlbG9jaW91c1BhY2thZ2VbXX0gKi9cbiAgICB0aGlzLl9wYWNrYWdlcyA9IChwYWNrYWdlcyB8fCBbXSkubWFwKChlbnRyeSkgPT4gVmVsb2Npb3VzUGFja2FnZS5mcm9tKGVudHJ5KSlcblxuICAgIC8vIEFwcGVuZCBhIGRlcml2ZWQgYmFja2VuZC1wcm9qZWN0IHBlciBwYWNrYWdlIHNvIHRoZSBleGlzdGluZyByZXNvdXJjZVxuICAgIC8vIGRpc2NvdmVyeSArIGZyb250ZW5kLW1vZGVsIGdlbmVyYXRpb24gbWFjaGluZXJ5IGluY2x1ZGVzIGl0LiBQYWNrYWdlXG4gICAgLy8gZnJvbnRlbmQgbW9kZWxzIGFyZSBnZW5lcmF0ZWQgaW50byB0aGUgYXBwJ3MgZnJvbnRlbmQtbW9kZWxzIG91dHB1dC5cbiAgICBjb25zdCBhcHBGcm9udGVuZE1vZGVsc091dHB1dFBhdGggPSB0aGlzLl9iYWNrZW5kUHJvamVjdHNbMF0/LmZyb250ZW5kTW9kZWxzT3V0cHV0UGF0aFxuXG4gICAgZm9yIChjb25zdCB2ZWxvY2lvdXNQYWNrYWdlIG9mIHRoaXMuX3BhY2thZ2VzKSB7XG4gICAgICB0aGlzLl9iYWNrZW5kUHJvamVjdHMucHVzaCh2ZWxvY2lvdXNQYWNrYWdlLnRvQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uKHtmcm9udGVuZE1vZGVsc091dHB1dFBhdGg6IGFwcEZyb250ZW5kTW9kZWxzT3V0cHV0UGF0aH0pKVxuICAgIH1cblxuICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dCA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9pbml0aWFsaXplci5qc1wiKS5kZWZhdWx0W119ICovXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycyA9IFtdXG4gICAgLyoqIEB0eXBlIHtib29sZWFufSAqL1xuICAgIHRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zaHV0ZG93blByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9tb2RlbHNJbml0aWFsaXplZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogSW52YWxpZGF0ZXMgbW9kZWwgcGhhc2VzIHRoYXQgc3RhcnRlZCBiZWZvcmUgZGF0YWJhc2UgY29ubmVjdGlvbnMgY2xvc2VkLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPSAwXG4gICAgLyoqXG4gICAgICogSW4tcHJvZ3Jlc3MgYGluaXRpYWxpemVNb2RlbHMoKWAgcHJvbWlzZS4gTW9kZWwgaW5pdGlhbGl6YXRpb24gaXMgYW5cbiAgICAgKiBhdG9taWMgYm9vdHN0cmFwIHBoYXNlOiBjb25jdXJyZW50IGNhbGxlcnMgc2hhcmUgaXQsIGFuZCBhIHJlamVjdGlvblxuICAgICAqIGxlYXZlcyB0aGUgcGhhc2UgZWxpZ2libGUgZm9yIGEgbGF0ZXIgY29tcGxldGUgYXR0ZW1wdC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEN1cnJlbnQgYGluaXRpYWxpemUoKWAgcHJvbWlzZSwgbWVtb2l6ZWQgc28gY29uY3VycmVudCBjYWxsZXJzIGF3YWl0IHRoZVxuICAgICAqIHNhbWUgYm9vdHN0cmFwLiBSZXRhaW5lZCBhY3Jvc3MgYSBjb25uZWN0aW9uIGNsb3NlIHVudGlsIHN0YWxlIGJvb3RzdHJhcFxuICAgICAqIHdvcmsgc2V0dGxlcywgdGhlbiBjbGVhcmVkIGJ5IGlkZW50aXR5IGJlZm9yZSB0aGUgbmV3IGdlbmVyYXRpb24gcmV0cmllcy5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgIGNvbnN0IHdlYnNvY2tldEluYm91bmRRdWV1ZSA9IGh0dHBTZXJ2ZXI/LndlYnNvY2tldEluYm91bmRRdWV1ZVxuICAgIGNvbnN0IHdlYnNvY2tldE91dGJvdW5kUXVldWUgPSBodHRwU2VydmVyPy53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlXG5cbiAgICB0aGlzLmh0dHBTZXJ2ZXIgPSB7XG4gICAgICAuLi4oaHR0cFNlcnZlciB8fCB7fSksXG4gICAgICBjb21wcmVzc2lvbjogbm9ybWFsaXplSHR0cENvbXByZXNzaW9uKGh0dHBTZXJ2ZXI/LmNvbXByZXNzaW9uKSxcbiAgICAgIHdlYnNvY2tldEluYm91bmRRdWV1ZToge1xuICAgICAgICBtYXhQZW5kaW5nQnl0ZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0SW5ib3VuZFF1ZXVlPy5tYXhQZW5kaW5nQnl0ZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWUubWF4UGVuZGluZ0J5dGVzXCIsIERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfQllURVMpLFxuICAgICAgICBtYXhQZW5kaW5nTWVzc2FnZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0SW5ib3VuZFF1ZXVlPy5tYXhQZW5kaW5nTWVzc2FnZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWUubWF4UGVuZGluZ01lc3NhZ2VzXCIsIERFRkFVTFRfV0VCU09DS0VUX0lOQk9VTkRfTUFYX1BFTkRJTkdfTUVTU0FHRVMpXG4gICAgICB9LFxuICAgICAgd2Vic29ja2V0T3V0Ym91bmRRdWV1ZToge1xuICAgICAgICBtYXhQZW5kaW5nQnl0ZXM6IHBvc2l0aXZlU2FmZUludGVnZXIod2Vic29ja2V0T3V0Ym91bmRRdWV1ZT8ubWF4UGVuZGluZ0J5dGVzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0T3V0Ym91bmRRdWV1ZS5tYXhQZW5kaW5nQnl0ZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfQllURVMpLFxuICAgICAgICBtYXhQZW5kaW5nRnJhbWVzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldE91dGJvdW5kUXVldWU/Lm1heFBlbmRpbmdGcmFtZXMsIFwiaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlLm1heFBlbmRpbmdGcmFtZXNcIiwgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfRlJBTUVTKVxuICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGh0dHAgc2VydmVyIGluc3RhbmNlIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7Z2V0RGVidWdTbmFwc2hvdDogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9odHRwU2VydmVySW5zdGFuY2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLmxvY2FsZSA9IGxvY2FsZVxuICAgIHRoaXMubG9jYWxlRmFsbGJhY2tzID0gbG9jYWxlRmFsbGJhY2tzXG4gICAgdGhpcy5sb2NhbGVzID0gbG9jYWxlc1xuICAgIHRoaXMuX2luaXRpYWxpemVycyA9IGluaXRpYWxpemVyc1xuICAgIHRoaXMuX3Rlc3RpbmcgPSB0ZXN0aW5nXG4gICAgdGhpcy5fdGltZVpvbmUgPSB0aW1lWm9uZVxuICAgIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9IHRpbWV6b25lT2Zmc2V0TWludXRlc1xuICAgIHRoaXMuX3RydXN0ZWRQcm94aWVzID0gdHJ1c3RlZFByb3hpZXNcbiAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zID0gcmVxdWVzdFRpbWVvdXRNc1xuICAgIHRoaXMuX3N0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbFxuICAgIHRoaXMuX3N5bmMgPSB0aGlzLl9ub3JtYWxpemVTeW5jQ29uZmlndXJhdGlvbihzeW5jKVxuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzID0gdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgfHwge31cbiAgICB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyID0gdGVuYW50RGF0YWJhc2VSZXNvbHZlclxuICAgIHRoaXMuX3RlbmFudFJlc29sdmVyID0gdGVuYW50UmVzb2x2ZXJcbiAgICB0aGlzLl93ZWJzb2NrZXRFdmVudHMgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmliZXJzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyID0gd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyXG4gICAgdGhpcy5fd2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlciA9IHdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXJcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jb25uZWN0aW9uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxDbGFzc2VzID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBjaGFubmVsIHN1YnNjcmlwdGlvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIFNldDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQ+Pn0gLSBjaGFubmVsVHlwZSDihpIgbGl2ZSBzdWJzY3JpcHRpb25zIGFjcm9zcyBhbGwgc2Vzc2lvbnMuXG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBsb2NhbCAocGVyLXByb2Nlc3MpIHdlYnNvY2tldCBjaGFubmVsIGJyb2FkY2FzdCBkZWxpdmVyaWVzLFxuICAgICAqIGxhdW5jaGVkIGZpcmUtYW5kLWZvcmdldCBmcm9tIGBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWxgIHNvIG9uZSBzbG93XG4gICAgICogc3Vic2NyaWJlciBuZXZlciBibG9ja3MgYW5vdGhlci4gVHJhY2tlZCBoZXJlIHNvXG4gICAgICogYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGNhbiBzbmFwc2hvdCBhbmQgZHJhaW4gdGhlbSBiZWZvcmUgc2V0dGxpbmcuXG4gICAgICogU2V0dGxlZCBkZWxpdmVyaWVzIGFyZSByZW1vdmVkIGJ5IHRoZSB0cmFja2luZy1sZXZlbCBjbGVhbnVwLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBzZXNzaW9ucyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQ+fSAtIExpdmUgd2Vic29ja2V0IHNlc3Npb25zLCBpbmNsdWRpbmcgcGF1c2VkIHNlc3Npb25zIHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93LlxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25zID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHBhdXNlZCB3ZWJzb2NrZXQgc2Vzc2lvbnMgdmFsdWUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBncmFjZVRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiwgcGF1c2VkQXQ6IG51bWJlcn0+fSAtIHNlc3Npb25JZCDihpIgcGF1c2VkIHNlc3Npb24gYXdhaXRpbmcgcmVzdW1lLlxuICAgICAqL1xuICAgIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zID0gbmV3IE1hcCgpXG5cbiAgICAvKiogR3JhY2UgcGVyaW9kIGZvciBwYXVzZWQgV2ViU29ja2V0IHNlc3Npb25zIGJlZm9yZSBwZXJtYW5lbnQgdGVhcmRvd24uICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyA9IDMwMFxuXG4gICAgLyoqIEludGVydmFsIChzZWNvbmRzKSBiZXR3ZWVuIHNlcnZlcuKGkmNsaWVudCBoZWFydGJlYXQgcGluZ3M7IDAgZGlzYWJsZXMgcmVhcGluZyBvZiBzaWxlbnQgc29ja2V0cy4gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyA9IDMwXG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCB3cmFwcGVyIGNhbGxlZCBhcm91bmQgZXZlcnkgV2ViU29ja2V0LWJvcm5lIHJlcXVlc3QgL1xuICAgICAqIGNvbm5lY3Rpb24gbWVzc2FnZSAvIGNoYW5uZWwgZGlzcGF0Y2guIEFwcHMgcmVnaXN0ZXIgaXQgaGVyZVxuICAgICAqIHRvIHNldCB1cCBwZXItcmVxdWVzdCBjb250ZXh0IChlLmcuIEFzeW5jTG9jYWxTdG9yYWdlIGZvclxuICAgICAqIGxvY2FsZSwgdGVuYW50LCB0cmFjaW5nKSB0aGF0IGRvd25zdHJlYW0gaGFuZGxlcnMgcmVhZC5cbiAgICAgKiBAdHlwZSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9XG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0QXJvdW5kUmVxdWVzdCA9IG51bGxcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYXJvdW5kIGFjdGlvbiB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7KChjb250ZXh0OiB7cmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgcmVzcG9uc2U6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD59KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9ICovXG4gICAgdGhpcy5fYXJvdW5kQWN0aW9uID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgc2Vzc2lvbiBpZGVudGl0eSByZXNvbHZlciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9ICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIgPSBudWxsXG4gICAgdGhpcy5fbG9nZ2luZyA9IGxvZ2dpbmdcbiAgICB0aGlzLl9sb2dSZWRhY3RvciA9IG5ldyBMb2dSZWRhY3Rvcih7c2Vuc2l0aXZlTmFtZXM6IGxvZ2dpbmc/LnNlbnNpdGl2ZU5hbWVzfSlcbiAgICB0aGlzLl9tYWlsZXJCYWNrZW5kID0gbWFpbGVyQmFja2VuZFxuICAgIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcyA9IFsuLi4ocm91dGVSZXNvbHZlckhvb2tzIHx8IFtdKV1cbiAgICB0aGlzLl9hZGREZWJ1Z0VuZHBvaW50Um91dGVIb29rKClcbiAgICB0aGlzLl9hZGRBcGlNYW5pZmVzdFJvdXRlSG9vaygpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGFwcGxpZWQgcm91dGUgbW91bnRzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtXZWFrU2V0PG9iamVjdD59ICovXG4gICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2Vycm9yRXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGRhdGFiYXNlIHBvb2xzIHZhbHVlLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzID0ge31cbiAgICB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSA9IG5ldyBGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSh7Y29uZmlndXJhdGlvbjogdGhpcywgbWF4T3BlbkhhbmRsZXM6IGZyb250ZW5kVGVuYW50U3FsaXRlPy5tYXhPcGVuSGFuZGxlc30pXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIG1vZGVsIGNsYXNzZXMgdmFsdWUuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiB0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19ICovXG4gICAgdGhpcy5tb2RlbENsYXNzZXMgPSB7fVxuXG4gICAgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5zZXRDb25maWd1cmF0aW9uKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0b2xvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIG9uIGxhenkgYWNjZXNzIGlzIGVuYWJsZWQgZ2xvYmFsbHkuXG4gICAqL1xuICBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIHRoaXMuX2F1dG9sb2FkIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhwb3NlIGludGVybmFsIGVycm9ycyB0byBjbGllbnRzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB1bmV4cGVjdGVkIGludGVybmFsIGVycm9yIGRldGFpbHMgbWF5IGJlIHJldHVybmVkIHRvIEFQSSBjbGllbnRzLlxuICAgKi9cbiAgZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSB7IHJldHVybiB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9PT0gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBmcm9udGVuZC1tb2RlbCBlcnJvcnMgZXhwb3NlIG9ubHkgZXhwbGljaXRseSBzYWZlIG1lc3NhZ2VzLlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKClgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBpbnRlcm5hbCBlcnJvciBleHBvc3VyZSBpcyBkaXNhYmxlZC5cbiAgICovXG4gIGdldFNlY3VyZUZyb250ZW5kTW9kZWxFcnJvcnMoKSB7IHJldHVybiAhdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgZW5kcG9pbnQuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERlYnVnRW5kcG9pbnQoKSB7IHJldHVybiB0aGlzLl9kZWJ1Z0VuZHBvaW50IH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBwYXRoOiBzdHJpbmcsIHRva2VuQ29uZmlndXJlZDogYm9vbGVhbn19IC0gRGVidWcgZW5kcG9pbnQgY29uZmlnIGZvciB0aGUgc25hcHNob3QsIHdpdGggdGhlIHRva2VuIHJlZGFjdGVkLlxuICAgKi9cbiAgX2RlYnVnRW5kcG9pbnRTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdGhpcy5fZGVidWdFbmRwb2ludC5lbmFibGVkLFxuICAgICAgcGF0aDogdGhpcy5fZGVidWdFbmRwb2ludC5wYXRoLFxuICAgICAgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2RlYnVnRW5kcG9pbnQudG9rZW4pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRlYnVnIGVuZHBvaW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCB7cGF0aD86IHN0cmluZywgdG9rZW4/OiBzdHJpbmd9fSB2YWx1ZSAtIERlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBkZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZURlYnVnRW5kcG9pbnQodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHBhdGg6IFwiL3ZlbG9jaW91cy9kZWJ1Z1wiLCB0b2tlbjogbnVsbH1cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogXCIvdmVsb2Npb3VzL2RlYnVnXCIsIHRva2VuOiBudWxsfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvdmVsb2Npb3VzL2RlYnVnXCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBkZWJ1Z0VuZHBvaW50LnBhdGggdG8gYmUgYSBzdHJpbmcgc3RhcnRpbmcgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocGF0aCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IHZhbHVlLnRva2VuID09PSB1bmRlZmluZWQgfHwgdmFsdWUudG9rZW4gPT09IG51bGwgPyBudWxsIDogdmFsdWUudG9rZW5cblxuICAgIGlmICh0b2tlbiAhPT0gbnVsbCAmJiAodHlwZW9mIHRva2VuICE9PSBcInN0cmluZ1wiIHx8ICF0b2tlbi50cmltKCkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlYnVnRW5kcG9pbnQudG9rZW4gdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKHRva2VuKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7ZW5hYmxlZDogdHJ1ZSwgcGF0aCwgdG9rZW46IHRva2VuID09PSBudWxsID8gbnVsbCA6IHRva2VuLnRyaW0oKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBhcGkgbWFuaWZlc3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IHtwYXRoPzogc3RyaW5nLCB0b2tlbj86IHN0cmluZ319IHZhbHVlIC0gQVBJIG1hbmlmZXN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgcGF0aDogc3RyaW5nLCB0b2tlbjogc3RyaW5nIHwgbnVsbH19IC0gTm9ybWFsaXplZCBBUEkgbWFuaWZlc3QgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVBcGlNYW5pZmVzdCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgcGF0aDogXCIvYXBpL21hbmlmZXN0XCIsIHRva2VuOiBudWxsfVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoOiBcIi9hcGkvbWFuaWZlc3RcIiwgdG9rZW46IG51bGx9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFwaU1hbmlmZXN0IHRvIGJlIGEgYm9vbGVhbiBvciBvYmplY3QsIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnBhdGggfHwgXCIvYXBpL21hbmlmZXN0XCJcblxuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcGF0aC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC5wYXRoIHRvIGJlIGEgc3RyaW5nIHN0YXJ0aW5nIHdpdGggJy8nLCBnb3Q6ICR7U3RyaW5nKHBhdGgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSB2YWx1ZS50b2tlbiA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlLnRva2VuID09PSBudWxsID8gbnVsbCA6IHZhbHVlLnRva2VuXG5cbiAgICBpZiAodG9rZW4gIT09IG51bGwgJiYgKHR5cGVvZiB0b2tlbiAhPT0gXCJzdHJpbmdcIiB8fCAhdG9rZW4udHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcGlNYW5pZmVzdC50b2tlbiB0byBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcodG9rZW4pfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoLCB0b2tlbjogdG9rZW4gPT09IG51bGwgPyBudWxsIDogdG9rZW4udHJpbSgpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGFwaSBtYW5pZmVzdCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkQXBpTWFuaWZlc3RSb3V0ZUhvb2soKSB7XG4gICAgaWYgKCF0aGlzLl9hcGlNYW5pZmVzdC5lbmFibGVkKSByZXR1cm5cblxuICAgIHRoaXMuYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gXCJHRVRcIikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChjdXJyZW50UGF0aCAhPT0gdGhpcy5fYXBpTWFuaWZlc3QucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9hcGlNYW5pZmVzdC50b2tlbikpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjdGlvbjogXCJzaG93XCIsXG4gICAgICAgIGNvbnRyb2xsZXI6IFwidmVsb2Npb3VzQXBpTWFuaWZlc3RcIixcbiAgICAgICAgY29udHJvbGxlclBhdGg6IFwiLi9idWlsdC1pbi9hcGktbWFuaWZlc3QvY29udHJvbGxlci5qc1wiLFxuICAgICAgICBza2lwQ29udHJvbGxlckNvbm5lY3Rpb25zOiB0cnVlLFxuICAgICAgICBza2lwQWJpbGl0eVJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICB2aWV3UGF0aDogXCIuL2J1aWx0LWluL2FwaS1tYW5pZmVzdFwiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBkZWJ1ZyBlbmRwb2ludCByb3V0ZSBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkRGVidWdFbmRwb2ludFJvdXRlSG9vaygpIHtcbiAgICBpZiAoIXRoaXMuX2RlYnVnRW5kcG9pbnQuZW5hYmxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgIT09IFwiR0VUXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAoY3VycmVudFBhdGggIT09IHRoaXMuX2RlYnVnRW5kcG9pbnQucGF0aCkgcmV0dXJuIG51bGxcblxuICAgICAgLy8gV2hlbiBhIHRva2VuIGlzIGNvbmZpZ3VyZWQsIGFuIHVuYXV0aGVudGljYXRlZCByZXF1ZXN0IGdldHMgbm8gcm91dGUgYXRcbiAgICAgIC8vIGFsbCAoNDA0KSByYXRoZXIgdGhhbiBhIDQwMSwgc28gdGhlIGVuZHBvaW50J3MgZXhpc3RlbmNlIHN0YXlzIGhpZGRlbi5cbiAgICAgIGlmICh0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuICYmICF0aGlzLmRlYnVnRW5kcG9pbnRSZXF1ZXN0QXV0aG9yaXplZChyZXF1ZXN0LCB0aGlzLl9kZWJ1Z0VuZHBvaW50LnRva2VuKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uOiBcInNob3dcIixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNEZWJ1Z1wiLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogXCIuL2J1aWx0LWluL2RlYnVnL2NvbnRyb2xsZXIuanNcIixcbiAgICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uczogdHJ1ZSxcbiAgICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICBza2lwVGVuYW50UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgdmlld1BhdGg6IFwiLi9idWlsdC1pbi9kZWJ1Z1wiXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdXRvbG9hZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyB0aGlzLl9hdXRvbG9hZCA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29ycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Db3JzVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgY29ycy5cbiAgICovXG4gIGdldENvcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGh0dHAgc2VydmVyIGNvbXByZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRIdHRwQ29tcHJlc3Npb25Db25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgYnVmZmVyZWQgcmVzcG9uc2UgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBTZXJ2ZXJDb21wcmVzc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy5odHRwU2VydmVyLmNvbXByZXNzaW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29va2llIHNlY3JldC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb29raWUgc2VjcmV0LlxuICAgKi9cbiAgZ2V0Q29va2llU2VjcmV0KCkge1xuICAgIHJldHVybiB0aGlzLl9jb29raWVTZWNyZXRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb259IC0gU3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0U3luY0NvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX3N5bmNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgb2ZmbGluZSBncmFudCBzaWduaW5nIGtleS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudFNpZ25pbmdLZXl9IC0gQ3VycmVudCBzaWduaW5nIGtleS5cbiAgICovXG4gIGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5KCkge1xuICAgIGNvbnN0IHNpZ25pbmdLZXlzID0gdGhpcy5nZXRTeW5jQ29uZmlndXJhdGlvbigpLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzXG5cbiAgICByZXR1cm4gY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoc2lnbmluZ0tleXMpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBzeW5jIC0gU3luYyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDb25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgc3luYyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNDb25maWd1cmF0aW9uKHN5bmMpIHtcbiAgICBjb25zdCBhcGkgPSBzeW5jPy5hcGlcbiAgICBjb25zdCBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgPSBzeW5jPy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgfHwgbnVsbFxuICAgIGNvbnN0IGNoYW5nZUZlZWRSZXRlbnRpb25TaXplID0gc3luYz8uY2hhbmdlRmVlZFJldGVudGlvblNpemVcbiAgICBjb25zdCBvZmZsaW5lR3JhbnRTaWduaW5nS2V5cyA9IHN5bmM/Lm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzIHx8IFtdXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50VHRsTXMgPSBzeW5jPy5vZmZsaW5lR3JhbnRUdGxNc1xuXG4gICAgaWYgKGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSAhPT0gbnVsbCAmJiAodHlwZW9mIGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSBtdXN0IGJlIGEgcHVibGljIEpTT04gV2ViIEtleSBvYmplY3RcIilcbiAgICB9XG4gICAgaWYgKGNoYW5nZUZlZWRSZXRlbnRpb25TaXplICE9PSB1bmRlZmluZWQgJiYgKCFOdW1iZXIuaXNJbnRlZ2VyKGNoYW5nZUZlZWRSZXRlbnRpb25TaXplKSB8fCBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlclwiKVxuICAgIH1cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob2ZmbGluZUdyYW50U2lnbmluZ0tleXMpKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzIG11c3QgYmUgYW4gYXJyYXlcIilcbiAgICBpZiAob2ZmbGluZUdyYW50VHRsTXMgIT09IHVuZGVmaW5lZCAmJiAoIU51bWJlci5pc0ludGVnZXIob2ZmbGluZUdyYW50VHRsTXMpIHx8IG9mZmxpbmVHcmFudFR0bE1zIDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLm9mZmxpbmVHcmFudFR0bE1zIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyIG51bWJlciBvZiBtaWxsaXNlY29uZHNcIilcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYXBpOiB0aGlzLl9ub3JtYWxpemVTeW5jQXBpQ29uZmlndXJhdGlvbihhcGkpLFxuICAgICAgY2hhbmdlRmVlZFJldGVudGlvblNpemU6IGNoYW5nZUZlZWRSZXRlbnRpb25TaXplIHx8IDEwMDAwLFxuICAgICAgY2xpZW50OiB0aGlzLl9ub3JtYWxpemVTeW5jQ2xpZW50Q29uZmlndXJhdGlvbihzeW5jPy5jbGllbnQpLFxuICAgICAgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5LFxuICAgICAgb2ZmbGluZUdyYW50U2lnbmluZ0tleXM6IG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzLm1hcCgoa2V5KSA9PiBub3JtYWxpemVPZmZsaW5lR3JhbnRTaWduaW5nS2V5KGtleSkpLFxuICAgICAgb2ZmbGluZUdyYW50VHRsTXM6IG9mZmxpbmVHcmFudFR0bE1zIHx8IDI0ICogNjAgKiA2MCAqIDEwMDBcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBjbGllbnQtc2lkZSBzeW5jIGNvbmZpZ3VyYXRpb24gY29uc3VtZWQgYnkgYFN5bmNDbGllbnQuZnJvbUNvbmZpZ3VyYXRpb24oLi4uKWAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSBjbGllbnQgLSBDbGllbnQtc2lkZSBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NsaWVudENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCBjbGllbnQtc2lkZSBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0NsaWVudENvbmZpZ3VyYXRpb24oY2xpZW50KSB7XG4gICAgaWYgKGNsaWVudCA9PT0gdW5kZWZpbmVkIHx8IGNsaWVudCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgaWYgKHR5cGVvZiBjbGllbnQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjbGllbnQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudCBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIHRyYW5zcG9ydCBhbmQgYXV0aGVudGljYXRpb25Ub2tlblwiKVxuICAgIH1cblxuICAgIGNvbnN0IHthdXRoZW50aWNhdGlvblRva2VuLCBiYXRjaFNpemUsIGlzT25saW5lLCBtb3VudFBhdGgsIG9uRXJyb3IsIHJlYWx0aW1lLCB0cmFuc3BvcnQsIHdlYnNvY2tldENsaWVudCwgd2Vic29ja2V0VXJsLCAuLi5yZXN0Q2xpZW50fSA9IGNsaWVudFxuICAgIGNvbnN0IHJlc3RDbGllbnRLZXlzID0gT2JqZWN0LmtleXMocmVzdENsaWVudClcblxuICAgIGlmIChyZXN0Q2xpZW50S2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50IHJlY2VpdmVkIHVua25vd24ga2V5czogJHtyZXN0Q2xpZW50S2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGF1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgaXNPbmxpbmUsIG1vdW50UGF0aCwgb25FcnJvciwgcmVhbHRpbWUsIHRyYW5zcG9ydCwgd2Vic29ja2V0Q2xpZW50LCB3ZWJzb2NrZXRVcmwpYClcbiAgICB9XG4gICAgaWYgKCF0cmFuc3BvcnQgfHwgdHlwZW9mIHRyYW5zcG9ydCAhPT0gXCJvYmplY3RcIiB8fCB0eXBlb2YgdHJhbnNwb3J0LnBvc3QgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQudHJhbnNwb3J0IG11c3QgYmUgYW4gb2JqZWN0IHdpdGggYSBwb3N0KHBhdGgsIGJvZHkpIG1ldGhvZCAobGlrZSB0aGUgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNsaWVudClcIilcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBhdXRoZW50aWNhdGlvblRva2VuICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LmF1dGhlbnRpY2F0aW9uVG9rZW4gbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgYXV0aCB0b2tlbiBzZW50IHdpdGggc3luYyByZXF1ZXN0c1wiKVxuICAgIH1cbiAgICBpZiAoaXNPbmxpbmUgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaXNPbmxpbmUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuaXNPbmxpbmUgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlc29sdmluZyBjb25uZWN0aXZpdHlcIilcbiAgICB9XG4gICAgaWYgKG9uRXJyb3IgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygb25FcnJvciAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vbkVycm9yIG11c3QgYmUgYSBmdW5jdGlvbiByZXBvcnRpbmcgYmFja2dyb3VuZCBzeW5jIGZhaWx1cmVzXCIpXG4gICAgfVxuICAgIGlmIChiYXRjaFNpemUgIT09IHVuZGVmaW5lZCAmJiAoIU51bWJlci5pc0ludGVnZXIoYmF0Y2hTaXplKSB8fCBiYXRjaFNpemUgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50LmJhdGNoU2l6ZSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlclwiKVxuICAgIH1cbiAgICBpZiAobW91bnRQYXRoICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtb3VudFBhdGggIT09IFwic3RyaW5nXCIgfHwgIW1vdW50UGF0aC5zdGFydHNXaXRoKFwiL1wiKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQubW91bnRQYXRoIG11c3Qgc3RhcnQgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcobW91bnRQYXRoKX1gKVxuICAgIH1cbiAgICBpZiAod2Vic29ja2V0Q2xpZW50ICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiB3ZWJzb2NrZXRDbGllbnQgIT09IFwib2JqZWN0XCIgfHwgd2Vic29ja2V0Q2xpZW50ID09PSBudWxsIHx8IHR5cGVvZiB3ZWJzb2NrZXRDbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQud2Vic29ja2V0Q2xpZW50IG11c3QgYmUgYSB3ZWJzb2NrZXQgY2xpZW50IHdpdGggYSBzdWJzY3JpYmVDaGFubmVsIG1ldGhvZCAobGlrZSBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQpXCIpXG4gICAgfVxuICAgIGlmICh3ZWJzb2NrZXRVcmwgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygd2Vic29ja2V0VXJsICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB3ZWJzb2NrZXRVcmwgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC53ZWJzb2NrZXRVcmwgbXVzdCBiZSBhIFVSTCBzdHJpbmcgb3IgYSBmdW5jdGlvbiByZXNvbHZpbmcgb25lLCBnb3Q6ICR7U3RyaW5nKHdlYnNvY2tldFVybCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZSxcbiAgICAgIGlzT25saW5lLFxuICAgICAgbW91bnRQYXRoOiAobW91bnRQYXRoIHx8IFwiL3ZlbG9jaW91cy9zeW5jXCIpLnJlcGxhY2UoL1xcLyskL3UsIFwiXCIpIHx8IFwiL1wiLFxuICAgICAgb25FcnJvcixcbiAgICAgIHJlYWx0aW1lLFxuICAgICAgdHJhbnNwb3J0LFxuICAgICAgd2Vic29ja2V0Q2xpZW50LFxuICAgICAgd2Vic29ja2V0VXJsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgc3luYyBBUEkgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0FwaUNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IGFwaSAtIFN5bmMgQVBJIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0FwaUNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCBzeW5jIEFQSSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZVN5bmNBcGlDb25maWd1cmF0aW9uKGFwaSkge1xuICAgIGlmIChhcGkgPT09IHVuZGVmaW5lZCB8fCBhcGkgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGlmICh0eXBlb2YgYXBpICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYXBpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5hcGkgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBhIHJlc291cmNlQ2xhc3NcIilcbiAgICB9XG5cbiAgICBjb25zdCB7bW91bnRQYXRoLCByZXNvdXJjZUNsYXNzfSA9IGFwaVxuXG4gICAgaWYgKHR5cGVvZiByZXNvdXJjZUNsYXNzICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5hcGkucmVzb3VyY2VDbGFzcyBtdXN0IGJlIGEgcmVzb3VyY2UgY2xhc3MsIGdvdDogJHtTdHJpbmcocmVzb3VyY2VDbGFzcyl9YClcbiAgICB9XG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzLk1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5hcGkucmVzb3VyY2VDbGFzcyAke3Jlc291cmNlQ2xhc3MubmFtZX0gbXVzdCBkZWZpbmUgc3RhdGljIE1vZGVsQ2xhc3NgKVxuICAgIH1cbiAgICBpZiAobW91bnRQYXRoICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtb3VudFBhdGggIT09IFwic3RyaW5nXCIgfHwgIW1vdW50UGF0aC5zdGFydHNXaXRoKFwiL1wiKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5hcGkubW91bnRQYXRoIG11c3Qgc3RhcnQgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcobW91bnRQYXRoKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7bW91bnRQYXRoLCByZXNvdXJjZUNsYXNzfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZT59IC0gVGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG5cbiAgICBpZiAoIXRoaXMuZGF0YWJhc2VbdGhpcy5nZXRFbnZpcm9ubWVudCgpXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBkYXRhYmFzZSBjb25maWd1cmF0aW9uIGZvciBlbnZpcm9ubWVudDogJHt0aGlzLmdldEVudmlyb25tZW50KCl9IC0gJHtPYmplY3Qua2V5cyh0aGlzLmRhdGFiYXNlKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFiYXNlXCIsIHRoaXMuZ2V0RW52aXJvbm1lbnQoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIFJlc29sdmVkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgcmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihpZGVudGlmaWVyLCB0ZW5hbnQgPSB0aGlzLmdldEN1cnJlbnRUZW5hbnQoKSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKClbaWRlbnRpZmllcl1cblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggZGF0YWJhc2UgaWRlbnRpZmllciBjb25maWd1cmVkOiAke2lkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBpZiAodGVuYW50ID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIpIHtcbiAgICAgIHJldHVybiBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cbiAgICB9XG5cbiAgICBjb25zdCBvdmVycmlkZUNvbmZpZ3VyYXRpb24gPSB0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICBpZGVudGlmaWVyLFxuICAgICAgdGVuYW50XG4gICAgfSlcblxuICAgIHJldHVybiBtZXJnZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG92ZXJyaWRlQ29uZmlndXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkaXNhYmxlZCBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIERpc2FibGVkIGRhdGFiYXNlIGlkZW50aWZpZXJzIGZyb20gZW52IGZsYWdzLlxuICAgKi9cbiAgZ2V0RGlzYWJsZWREYXRhYmFzZUlkZW50aWZpZXJzKCkge1xuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnMgPSBuZXcgU2V0KClcbiAgICBjb25zdCBkaXNhYmxlZElkZW50aWZpZXJzUmF3ID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RJU0FCTEVEX0RBVEFCQVNFX0lERU5USUZJRVJTXG5cbiAgICBpZiAoZGlzYWJsZWRJZGVudGlmaWVyc1Jhdykge1xuICAgICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGRpc2FibGVkSWRlbnRpZmllcnNSYXcuc3BsaXQoXCIsXCIpKSB7XG4gICAgICAgIGNvbnN0IHRyaW1tZWQgPSBpZGVudGlmaWVyLnRyaW0oKVxuXG4gICAgICAgIGlmICh0cmltbWVkKSBkaXNhYmxlZElkZW50aWZpZXJzLmFkZCh0cmltbWVkKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRElTQUJMRV9NU1NRTCA9PT0gXCIxXCIpIHtcbiAgICAgIGRpc2FibGVkSWRlbnRpZmllcnMuYWRkKFwibXNzcWxcIilcbiAgICB9XG5cbiAgICByZXR1cm4gZGlzYWJsZWRJZGVudGlmaWVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZGF0YWJhc2UgaWRlbnRpZmllciBhY3RpdmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW3RlbmFudF0gLSBUZW5hbnQgb3ZlcnJpZGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBkYXRhYmFzZSBpZGVudGlmaWVyIGlzIGFjdGl2ZSBpbiB0aGUgY3VycmVudCB0ZW5hbnQgY29udGV4dC5cbiAgICovXG4gIGlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIsIHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpKSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVtpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBkYXRhYmFzZSBpZGVudGlmaWVyIGNvbmZpZ3VyZWQ6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLnRlbmFudE9ubHkpIHJldHVybiB0cnVlXG4gICAgaWYgKHRlbmFudCA9PT0gdW5kZWZpbmVkIHx8ICF0aGlzLl90ZW5hbnREYXRhYmFzZVJlc29sdmVyKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG92ZXJyaWRlQ29uZmlndXJhdGlvbiA9IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgIGlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuXG4gICAgcmV0dXJuIEJvb2xlYW4ob3ZlcnJpZGVDb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gLSBUaGUgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXJzKCkge1xuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gT2JqZWN0LmtleXModGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKSlcbiAgICBjb25zdCBkaXNhYmxlZElkZW50aWZpZXJzID0gdGhpcy5nZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKVxuXG4gICAgcmV0dXJuIGlkZW50aWZpZXJzLmZpbHRlcigoaWRlbnRpZmllcikgPT4gIWRpc2FibGVkSWRlbnRpZmllcnMuaGFzKGlkZW50aWZpZXIpICYmIHRoaXMuaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllcikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gSHVtYW4tcmVhZGFibGUgc2VydmVyIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgYXN5bmMgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBsb2NhbFNuYXBzaG90ID0gdGhpcy5nZXRMb2NhbERlYnVnU25hcHNob3QoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmxvY2FsU25hcHNob3QsXG4gICAgICBodHRwU2VydmVyOiBhd2FpdCB0aGlzLl9kZWJ1Z0h0dHBTZXJ2ZXJTbmFwc2hvdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2FsIGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEh1bWFuLXJlYWRhYmxlIGRpYWdub3N0aWNzIGZvciB0aGlzIHByb2Nlc3Mgb25seS5cbiAgICovXG4gIGdldExvY2FsRGVidWdTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYmFja2dyb3VuZEpvYnM6IHRoaXMuX2RlYnVnQmFja2dyb3VuZEpvYnNTbmFwc2hvdCgpLFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5fZGVidWdDb25maWd1cmF0aW9uU25hcHNob3QoKSxcbiAgICAgIGRhdGFiYXNlOiB0aGlzLl9kZWJ1Z0RhdGFiYXNlU25hcHNob3QoKSxcbiAgICAgIGdlbmVyYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBzZXJ2ZXI6IHRoaXMuX2RlYnVnU2VydmVyU25hcHNob3QoKSxcbiAgICAgIHdlYnNvY2tldHM6IHRoaXMuX2RlYnVnV2Vic29ja2V0U25hcHNob3QoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGh0dHAgc2VydmVyIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEhUVFAgc2VydmVyIHdvcmtlciBkaWFnbm9zdGljcy5cbiAgICovXG4gIGFzeW5jIF9kZWJ1Z0h0dHBTZXJ2ZXJTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBodHRwU2VydmVyID0gLyoqIEB0eXBlIHt7Z2V0RGVidWdTbmFwc2hvdD86ICgpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gfCB1bmRlZmluZWR9ICovICh0aGlzLl9odHRwU2VydmVySW5zdGFuY2UpXG5cbiAgICBpZiAoIWh0dHBTZXJ2ZXI/LmdldERlYnVnU25hcHNob3QpIHtcbiAgICAgIHJldHVybiB7Y29uZmlndXJlZDogQm9vbGVhbih0aGlzLmh0dHBTZXJ2ZXIpLCBhY3RpdmU6IGZhbHNlfVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBodHRwU2VydmVyLmdldERlYnVnU25hcHNob3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgc2VydmVyIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFNlcnZlciBydW50aW1lIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnU2VydmVyU25hcHNob3QoKSB7XG4gICAgY29uc3Qgbm9kZVByb2Nlc3MgPSB0eXBlb2YgcHJvY2VzcyA9PT0gXCJ1bmRlZmluZWRcIiA/IHVuZGVmaW5lZCA6IHByb2Nlc3NcblxuICAgIHJldHVybiB7XG4gICAgICBlbnZpcm9ubWVudDogdGhpcy5nZXRFbnZpcm9ubWVudCgpLFxuICAgICAgbWVtb3J5VXNhZ2U6IG5vZGVQcm9jZXNzID8gbm9kZVByb2Nlc3MubWVtb3J5VXNhZ2UoKSA6IHVuZGVmaW5lZCxcbiAgICAgIG5vZGVWZXJzaW9uOiBub2RlUHJvY2Vzcz8udmVyc2lvbnM/Lm5vZGUsXG4gICAgICBwaWQ6IG5vZGVQcm9jZXNzPy5waWQsXG4gICAgICBwbGF0Zm9ybTogbm9kZVByb2Nlc3M/LnBsYXRmb3JtLFxuICAgICAgdXB0aW1lU2Vjb25kczogbm9kZVByb2Nlc3MgPyBub2RlUHJvY2Vzcy51cHRpbWUoKSA6IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGNvbmZpZ3VyYXRpb24gc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29uZmlndXJhdGlvbiBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXBpTWFuaWZlc3Q6IHRoaXMuX2FwaU1hbmlmZXN0RW5hYmxlZCgpID8ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IHRoaXMuX2FwaU1hbmlmZXN0LnBhdGgsIHRva2VuQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9hcGlNYW5pZmVzdC50b2tlbil9IDoge2VuYWJsZWQ6IGZhbHNlfSxcbiAgICAgIGF1dG9sb2FkOiB0aGlzLmdldEF1dG9sb2FkKCksXG4gICAgICBkZWJ1ZzogdGhpcy5kZWJ1ZyA9PT0gdHJ1ZSxcbiAgICAgIGRlYnVnRW5kcG9pbnQ6IHRoaXMuX2RlYnVnRW5kcG9pbnRTbmFwc2hvdCgpLFxuICAgICAgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzOiB0aGlzLmdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpLFxuICAgICAgZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHM6IHRoaXMuZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSxcbiAgICAgIGluaXRpYWxpemVkOiB0aGlzLl9pc0luaXRpYWxpemVkLFxuICAgICAgbG9nZ2luZzoge1xuICAgICAgICBkZWJ1Z0xvd0xldmVsOiB0aGlzLl9sb2dnaW5nPy5kZWJ1Z0xvd0xldmVsID09PSB0cnVlLFxuICAgICAgICBvdXRwdXRzOiB0aGlzLl9sb2dnaW5nID8gT2JqZWN0LmtleXModGhpcy5fbG9nZ2luZykgOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGJhY2tncm91bmQgam9icyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBCYWNrZ3JvdW5kIGpvYiBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0JhY2tncm91bmRKb2JzU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fYmFja2dyb3VuZEpvYnMpLFxuICAgICAgc2NoZWR1bGVkQ29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBkYXRhYmFzZSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z0RhdGFiYXNlU25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogRGF0YWJhc2UgcG9vbHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLkRhdGFiYXNlUG9vbERlYnVnU25hcHNob3Q+fSAqL1xuICAgIGNvbnN0IGRhdGFiYXNlUG9vbHMgPSB7fVxuICAgIGNvbnN0IGFjdGl2ZUlkZW50aWZpZXJzID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBhY3RpdmVJZGVudGlmaWVycykge1xuICAgICAgZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmdldERlYnVnU25hcHNob3QoKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhY3RpdmVJZGVudGlmaWVycyxcbiAgICAgIGRpc2FibGVkSWRlbnRpZmllcnM6IEFycmF5LmZyb20odGhpcy5nZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSksXG4gICAgICBpbml0aWFsaXplZFBvb2xzOiBPYmplY3Qua2V5cyh0aGlzLmRhdGFiYXNlUG9vbHMpLFxuICAgICAgcG9vbHM6IGRhdGFiYXNlUG9vbHNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyB3ZWJzb2NrZXQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2ViU29ja2V0IGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnV2Vic29ja2V0U25hcHNob3QoKSB7XG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBidWNrZXRzLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y291bnQ6IG51bWJlciwgZGV0YWlsczoge2NoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogbnVtYmVyLCBjaGFubmVsU3Vic2NyaXB0aW9uczoge2NoYW5uZWxUeXBlOiBzdHJpbmcsIGNvdW50OiBudW1iZXIsIG1vZGVsOiBzdHJpbmcgfCBudWxsfVtdLCBjb25uZWN0aW9uQ291bnQ6IG51bWJlciwgcGF1c2VkOiBib29sZWFuLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfX0+fSAqL1xuICAgIGNvbnN0IHNlc3Npb25CdWNrZXRzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogU2Vzc2lvbiBkZXRhaWxzLlxuICAgICAqIEB0eXBlIHt7Y2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXIsIGNoYW5uZWxTdWJzY3JpcHRpb25zOiB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9W10sIGNvbm5lY3Rpb25Db3VudDogbnVtYmVyLCBwYXVzZWQ6IGJvb2xlYW4sIHF1ZXVlZE1lc3NhZ2VDb3VudDogbnVtYmVyLCBzdWJzY3JpcHRpb25Db3VudDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IHNlc3Npb25EZXRhaWxzID0gW11cbiAgICBjb25zdCBzdWJzY3JpcHRpb25zID0gQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5lbnRyaWVzKCkpLm1hcCgoW2NoYW5uZWwsIGNoYW5uZWxTdWJzY3JpcHRpb25zXSkgPT4ge1xuICAgICAgLyoqXG4gICAgICAgKiBEZXRhaWxzIGJ1Y2tldHMuXG4gICAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2NvdW50OiBudW1iZXIsIGRldGFpbHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgICAgY29uc3QgZGV0YWlsc0J1Y2tldHMgPSBuZXcgTWFwKClcblxuICAgICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgY2hhbm5lbFN1YnNjcmlwdGlvbnMpIHtcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpKVxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShkZXRhaWxzKVxuICAgICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IGRldGFpbHNCdWNrZXRzLmdldChrZXkpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRldGFpbHNCdWNrZXRzLnNldChrZXksIHtjb3VudDogMSwgZGV0YWlsc30pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgY291bnQ6IGNoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGRldGFpbHM6IEFycmF5LmZyb20oZGV0YWlsc0J1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IHNlc3Npb24gb2YgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogQ2hhbm5lbCBzdWJzY3JpcHRpb24gYnVja2V0cy5cbiAgICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9Pn0gKi9cbiAgICAgIGNvbnN0IGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzID0gbmV3IE1hcCgpXG5cbiAgICAgIGZvciAoY29uc3Qge2NoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb259IG9mIHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICAgIGNvbnN0IGRldGFpbHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHN1YnNjcmlwdGlvbi5kZWJ1Z1NuYXBzaG90KCkpXG4gICAgICAgIGNvbnN0IG1vZGVsID0gdHlwZW9mIGRldGFpbHMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBkZXRhaWxzLm1vZGVsIDogbnVsbFxuICAgICAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeSh7Y2hhbm5lbFR5cGUsIG1vZGVsfSlcbiAgICAgICAgY29uc3QgZXhpc3RpbmdCdWNrZXQgPSBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5nZXQoa2V5KVxuXG4gICAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQnVja2V0cy5zZXQoa2V5LCB7Y2hhbm5lbFR5cGUsIGNvdW50OiAxLCBtb2RlbH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBBcnJheS5mcm9tKGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudClcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0ge1xuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNlc3Npb24uX2NoYW5uZWxTdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNlc3Npb24uX2Nvbm5lY3Rpb25zLnNpemUsXG4gICAgICAgIHBhdXNlZDogc2Vzc2lvbi5fcGF1c2VkLFxuICAgICAgICBxdWV1ZWRNZXNzYWdlQ291bnQ6IHNlc3Npb24uX291dGJvdW5kUXVldWUubGVuZ3RoLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc2Vzc2lvbi5zdWJzY3JpcHRpb25zLnNpemVcbiAgICAgIH1cbiAgICAgIGNvbnN0IGJ1Y2tldEtleSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zOiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgY29ubmVjdGlvbkNvdW50OiBzbmFwc2hvdC5jb25uZWN0aW9uQ291bnQsXG4gICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc25hcHNob3Quc3Vic2NyaXB0aW9uQ291bnRcbiAgICAgIH0pXG4gICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IHNlc3Npb25CdWNrZXRzLmdldChidWNrZXRLZXkpXG5cbiAgICAgIGlmIChleGlzdGluZ0J1Y2tldCkge1xuICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXNzaW9uQnVja2V0cy5zZXQoYnVja2V0S2V5LCB7XG4gICAgICAgICAgY291bnQ6IDEsXG4gICAgICAgICAgZGV0YWlsczoge1xuICAgICAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQsXG4gICAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uczogc25hcHNob3QuY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNuYXBzaG90LmNvbm5lY3Rpb25Db3VudCxcbiAgICAgICAgICAgIHBhdXNlZDogc25hcHNob3QucGF1c2VkLFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LnN1YnNjcmlwdGlvbkNvdW50XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgc2Vzc2lvbkRldGFpbHMucHVzaChzbmFwc2hvdClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcGF1c2VkU2Vzc2lvbnM6IHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLnNpemUsXG4gICAgICByZWdpc3RlcmVkQ2hhbm5lbHM6IEFycmF5LmZyb20odGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMua2V5cygpKSxcbiAgICAgIHJlZ2lzdGVyZWRDb25uZWN0aW9uczogQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3Nlcy5rZXlzKCkpLFxuICAgICAgc2Vzc2lvbkJ1Y2tldHM6IEFycmF5LmZyb20oc2Vzc2lvbkJ1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KSxcbiAgICAgIHNlc3Npb25Db3VudDogdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMuc2l6ZSxcbiAgICAgIHNlc3Npb25zOiBzZXNzaW9uRGV0YWlscy5zb3J0KChhLCBiKSA9PiBiLmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCAtIGEuY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50KSxcbiAgICAgIHN1YnNjcmlwdGlvbkdyb3VwczogdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgIHN1YnNjcmlwdGlvbnNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZGF0YWJhc2UgcG9vbC5cbiAgICovXG4gIGdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBpZiAoIXRoaXMuaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZChpZGVudGlmaWVyKSkge1xuICAgICAgdGhpcy5pbml0aWFsaXplRGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpZ2codGhpcywgXCJkYXRhYmFzZVBvb2xzXCIsIGlkZW50aWZpZXIpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZnJhbWV3b3JrLW93bmVkIGZyb250ZW5kIHRlbmFudCBTUUxpdGUgbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGV9IC0gTGlmZWN5Y2xlIG93bmVyLlxuICAgKi9cbiAgZ2V0RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoKSB7IHJldHVybiB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc2FmZSBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZVtcImluc3BlY3RBbGxcIl0+fSAtIExpZmVjeWNsZSBkaWFnbm9zdGljcy5cbiAgICovXG4gIGluc3BlY3RGcm9udGVuZFRlbmFudFNxbGl0ZUhhbmRsZXMoKSB7IHJldHVybiB0aGlzLl9mcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZS5pbnNwZWN0QWxsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0pXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllcikge1xuICAgIHJldHVybiB0aGlzLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oaWRlbnRpZmllcilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIHNjaGVtYSBtZXRhZGF0YSBjYWNoZWQgYnkgZXZlcnkgaW5pdGlhbGl6ZWQgcG9vbCB0aGF0IHRhcmdldHMgdGhlXG4gICAqIHNhbWUgcGh5c2ljYWwgZGF0YWJhc2UgKG1hdGNoZWQgYnkgY29ubmVjdGlvbiByZXVzZSBrZXkpLiBTZXBhcmF0ZSBwb29scyB0aGF0XG4gICAqIHBvaW50IGF0IG9uZSBkYXRhYmFzZSBrZWVwIGluZGVwZW5kZW50IHNjaGVtYSBjYWNoZXMsIHNvIERETCBydW4gdGhyb3VnaCBvbmVcbiAgICogcG9vbCB3b3VsZCBvdGhlcndpc2UgbGVhdmUgdGhlIG90aGVycyByZXBvcnRpbmcgc3RhbGUgdGFibGVzL2NvbHVtbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIENvbm5lY3Rpb24gcmV1c2Uga2V5IGlkZW50aWZ5aW5nIHRoZSBzaGFyZWQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGVzRm9yUmV1c2VLZXkocmV1c2VLZXkpIHtcbiAgICBmb3IgKGNvbnN0IHBvb2wgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGFiYXNlUG9vbHMpKSB7XG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoKSA9PT0gcmV1c2VLZXkpIHtcbiAgICAgICAgcG9vbC5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW52YWxpZGF0ZXMgcmVjb3JkIG1ldGFkYXRhIG93bmVkIGJ5IG9uZSBjbG9zZWQvZGVsZXRlZCBwaHlzaWNhbCB0ZW5hbnRcbiAgICogZGF0YWJhc2Ugd2hpbGUgcHJlc2VydmluZyBldmVyeSBvdGhlciB0ZW5hbnQgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBMb2dpY2FsIGlkZW50aWZpZXIgcGx1cyBwb29sIHJldXNlIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGVhclJlY29yZE1ldGFkYXRhRm9yRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIE9iamVjdC52YWx1ZXModGhpcy5tb2RlbENsYXNzZXMpKSB7XG4gICAgICBtb2RlbENsYXNzLmNsZWFyUmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3JEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIHBvb2wgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGRhdGFiYXNlIHBvb2wgdHlwZS5cbiAgICovXG4gIGdldERhdGFiYXNlUG9vbFR5cGUoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgY29uc3QgcG9vbFR5cGVDbGFzcyA9IGRpZ2codGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllciksIFwicG9vbFR5cGVcIilcblxuICAgIGlmICghcG9vbFR5cGVDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gcG9vbFR5cGUgZ2l2ZW4gaW4gZGF0YWJhc2UgY29uZmlndXJhdGlvblwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJlc29sdmVUZXN0U2hhcmVkVHJhbnNhY3Rpb25Qb29sVHlwZSh7XG4gICAgICBjb25maWd1cmVkUG9vbFR5cGU6IHBvb2xUeXBlQ2xhc3MsXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IGlkZW50aWZpZXJcbiAgICB9KVxuICB9XG5cbiAgZ2V0RGF0YWJhc2VUeXBlKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGNvbnN0IGRhdGFiYXNlVHlwZSA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGlkZW50aWZpZXIpLnR5cGVcblxuICAgIGlmICghZGF0YWJhc2VUeXBlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhYmFzZSB0eXBlIGdpdmVuIGluIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgIHJldHVybiBkYXRhYmFzZVR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRpcmVjdG9yeS5cbiAgICovXG4gIGdldERpcmVjdG9yeSgpIHtcbiAgICBjb25zdCBkaXJlY3RvcnkgPSB0aGlzLmdldERpcmVjdG9yeUlmQXZhaWxhYmxlKClcblxuICAgIGlmICghZGlyZWN0b3J5KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkaXJlY3RvcnkgY29uZmlndXJlZCBhbmQgcHJvY2Vzcy5jd2QgaXMgdW5hdmFpbGFibGVcIilcblxuICAgIHJldHVybiBkaXJlY3RvcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkaXJlY3RvcnkgaWYgYXZhaWxhYmxlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBkaXJlY3Rvcnkgd2hlbiB0aGUgcnVudGltZSBjYW4gcmVzb2x2ZSBvbmUuXG4gICAqL1xuICBnZXREaXJlY3RvcnlJZkF2YWlsYWJsZSgpIHtcbiAgICBpZiAoIXRoaXMuX2RpcmVjdG9yeSkge1xuICAgICAgdGhpcy5fZGlyZWN0b3J5ID0gY3VycmVudFdvcmtpbmdEaXJlY3RvcnkoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9kaXJlY3RvcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBiYWNrZW5kIHByb2plY3RzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfSAtIEJhY2tlbmQgcHJvamVjdHMuXG4gICAqL1xuICBnZXRCYWNrZW5kUHJvamVjdHMoKSB7IHJldHVybiB0aGlzLl9iYWNrZW5kUHJvamVjdHMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwYWNrYWdlcy5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c1BhY2thZ2VbXX0gLSBSZWdpc3RlcmVkIFZlbG9jaW91cyBwYWNrYWdlcy5cbiAgICovXG4gIGdldFBhY2thZ2VzKCkgeyByZXR1cm4gdGhpcy5fcGFja2FnZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhYmlsaXR5IHJlc291cmNlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gICAqL1xuICBnZXRBYmlsaXR5UmVzb3VyY2VzKCkgeyByZXR1cm4gdGhpcy5fYWJpbGl0eVJlc291cmNlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGFiaWxpdHkgcmVzb3VyY2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gcmVzb3VyY2VzIC0gQWJpbGl0eSByZXNvdXJjZSBjbGFzc2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBYmlsaXR5UmVzb3VyY2VzKHJlc291cmNlcykgeyB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gcmVzb3VyY2VzIH1cblxuICAvKipcbiAgICogTWVyZ2VzIHJlc291cmNlIGNsYXNzZXMgZGlzY292ZXJlZCBmcm9tIHRoZSBhcHAgYW5kIGV2ZXJ5IHJlZ2lzdGVyZWQgcGFja2FnZVxuICAgKiBpbnRvIHRoZSBhYmlsaXR5LXJlc291cmNlcyBsaXN0LiBgYXV0b0Rpc2NvdmVyUmVzb3VyY2VzYCBwb3B1bGF0ZXMgZWFjaCBiYWNrZW5kXG4gICAqIHByb2plY3QncyBgZnJvbnRlbmRNb2RlbHNgIChpbmNsdWRpbmcgcGFja2FnZSBwcm9qZWN0cyksIHNvIHRoaXMgbWFrZXMgYVxuICAgKiBwYWNrYWdlLWNvbnRyaWJ1dGVkIG1vZGVsJ3MgYWJpbGl0aWVzIHJlYWNoIHN1YnNjcmlwdGlvbiBhbmQgcGVyLXJlY29yZFxuICAgKiBhdXRob3JpemF0aW9uIGF1dG9tYXRpY2FsbHkg4oCUIGNvbnN1bWluZyBhcHBzIGRvIG5vdCBoYXZlIHRvIGhhbmQtcmVnaXN0ZXJcbiAgICogcGFja2FnZSByZXNvdXJjZXMuIEFscmVhZHktcHJlc2VudCBjbGFzc2VzIChlLmcuIGFuIGFwcCdzIGV4cGxpY2l0bHktc2V0XG4gICAqIHJlc291cmNlcykgYXJlIGxlZnQgdW50b3VjaGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfbWVyZ2VEaXNjb3ZlcmVkQWJpbGl0eVJlc291cmNlcygpIHtcbiAgICBjb25zdCBtZXJnZWQgPSBbLi4udGhpcy5fYWJpbGl0eVJlc291cmNlc11cbiAgICBjb25zdCBzZWVuID0gbmV3IFNldChtZXJnZWQpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIHRoaXMuX2JhY2tlbmRQcm9qZWN0cykge1xuICAgICAgaWYgKCFiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzKSBjb250aW51ZVxuXG4gICAgICBmb3IgKGNvbnN0IFJlc291cmNlQ2xhc3Mgb2YgYmFja2VuZFByb2plY3QuYWJpbGl0eVJlc291cmNlcykge1xuICAgICAgICBpZiAoc2Vlbi5oYXMoUmVzb3VyY2VDbGFzcykpIGNvbnRpbnVlXG5cbiAgICAgICAgc2Vlbi5hZGQoUmVzb3VyY2VDbGFzcylcbiAgICAgICAgbWVyZ2VkLnB1c2goUmVzb3VyY2VDbGFzcylcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gbWVyZ2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYWJpbGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIEFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRBYmlsaXR5UmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50UmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRlbmFudCByZXNvbHZlci5cbiAgICovXG4gIGdldFRlbmFudFJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fdGVuYW50UmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0VGVuYW50RGF0YWJhc2VSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlbmZvcmNlIHRlbmFudCBkYXRhYmFzZSBzY29wZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyByZXF1aXJlIGEgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXRFbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMoKSB7IHJldHVybiB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXJzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlPn0gLSBUZW5hbnQgZGF0YWJhc2UgbGlmZWN5Y2xlIHByb3ZpZGVycy5cbiAgICovXG4gIGdldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKCkgeyByZXR1cm4gdGhpcy5fdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZX0gLSBUZW5hbnQgZGF0YWJhc2UgbGlmZWN5Y2xlIHByb3ZpZGVyLlxuICAgKi9cbiAgZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcihpZGVudGlmaWVyKSB7XG4gICAgY29uc3QgcHJvdmlkZXIgPSB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVyc1tpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFwcm92aWRlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgY29uZmlndXJlZCBmb3IgZGF0YWJhc2UgaWRlbnRpZmllcjogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3ZpZGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudHMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50c0NvbmZpZ3VyYXRpb259IC0gQXR0YWNobWVudHMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbigpIHsgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzIHx8IHt9IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUm91dGVSZXNvbHZlckhvb2tUeXBlW119IC0gUm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqL1xuICBnZXRSb3V0ZVJlc29sdmVySG9va3MoKSB7IHJldHVybiB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCByb3V0ZSByZXNvbHZlciBob29rLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Sb3V0ZVJlc29sdmVySG9va1R5cGV9IGhvb2sgLSBSb3V0ZSByZXNvbHZlciBob29rLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhZGRSb3V0ZVJlc29sdmVySG9vayhob29rKSB7XG4gICAgdGhpcy5fcm91dGVSZXNvbHZlckhvb2tzLnB1c2goaG9vaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSByZXNvbHZlciAtIEFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEFiaWxpdHlSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgPSByZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50UmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSByZXNvbHZlciAtIFRlbmFudCByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGVuYW50UmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fdGVuYW50UmVzb2x2ZXIgPSByZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gVGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUZW5hbnREYXRhYmFzZVJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIgPSByZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyByZXF1aXJlIGEgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyhuZXdWYWx1ZSkgeyB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlPn0gcHJvdmlkZXJzIC0gVGVuYW50IGRhdGFiYXNlIGxpZmVjeWNsZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKHByb3ZpZGVycykgeyB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyA9IHByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBlbnZpcm9ubWVudC5cbiAgICovXG4gIGdldEVudmlyb25tZW50KCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcIl9lbnZpcm9ubWVudFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlcXVlc3QgdGltZW91dCBtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBSZXF1ZXN0IHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIGdldFJlcXVlc3RUaW1lb3V0TXMoKSB7XG4gICAgY29uc3QgZW52VGltZW91dCA9IHRoaXMuX3BhcnNlUmVxdWVzdFRpbWVvdXRTZWNvbmRzKHByb2Nlc3MuZW52LlZFTE9DSU9VU19SRVFVRVNUX1RJTUVPVVRfTVMpXG4gICAgY29uc3QgdmFsdWUgPSB0eXBlb2YgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMoKVxuICAgICAgOiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodHlwZW9mIGVudlRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlRpbWVvdXQpKSByZXR1cm4gZW52VGltZW91dFxuXG4gICAgcmV0dXJuIDYwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSByZXF1ZXN0IHRpbWVvdXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHJhd1ZhbHVlIC0gRW52IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIF9wYXJzZVJlcXVlc3RUaW1lb3V0U2Vjb25kcyhyYXdWYWx1ZSkge1xuICAgIGlmIChyYXdWYWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB0cmltbWVkID0gcmF3VmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9eKFxcZCsoPzpcXC5cXGQrKT8pKG1zfHMpPyQvKVxuXG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcihtYXRjaFsxXSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKG51bWVyaWMpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB1bml0ID0gbWF0Y2hbMl1cblxuICAgIGlmICh1bml0ID09PSBcIm1zXCIpIHJldHVybiBudW1lcmljIC8gMTAwMFxuICAgIGlmICh1bml0ID09PSBcInNcIikgcmV0dXJuIG51bWVyaWNcblxuICAgIGlmICh0cmltbWVkLmluY2x1ZGVzKFwiLlwiKSkgcmV0dXJuIG51bWVyaWNcbiAgICBpZiAobnVtZXJpYyA+PSAxMDAwKSByZXR1cm4gbnVtZXJpYyAvIDEwMDBcblxuICAgIHJldHVybiBudW1lcmljXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZW52aXJvbm1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdFbnZpcm9ubWVudCAtIE5ldyBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0RW52aXJvbm1lbnQobmV3RW52aXJvbm1lbnQpIHsgdGhpcy5fZW52aXJvbm1lbnQgPSBuZXdFbnZpcm9ubWVudCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlZmF1bHRDb25zb2xlXSAtIFdoZXRoZXIgZGVmYXVsdCBjb25zb2xlLlxuICAgKiBAcmV0dXJucyB7UmVxdWlyZWQ8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiY29uc29sZVwiIHwgXCJmaWxlXCIgfCBcImxldmVsc1wiPj4gJiBQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJkaXJlY3RvcnlcIiB8IFwiZmlsZVBhdGhcIj4gJiBQYXJ0aWFsPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcIm91dHB1dHNcIiB8IFwibG9nZ2Vyc1wiPj59IC0gVGhlIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldExvZ2dpbmdDb25maWd1cmF0aW9uKHtkZWZhdWx0Q29uc29sZX0gPSB7fSkge1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gdGhpcy5nZXRFbnZpcm9ubWVudCgpXG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuX2xvZ2dpbmc/LmRpcmVjdG9yeSB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0RGVmYXVsdExvZ0RpcmVjdG9yeSh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLl9sb2dnaW5nPy5maWxlUGF0aCB8fCBlbnZpcm9ubWVudEhhbmRsZXIuZ2V0TG9nRmlsZVBhdGgoe2NvbmZpZ3VyYXRpb246IHRoaXMsIGRpcmVjdG9yeSwgZW52aXJvbm1lbnR9KVxuICAgIGNvbnN0IGNvbnNvbGVPdmVycmlkZSA9IHRoaXMuX2xvZ2dpbmc/LmNvbnNvbGVcbiAgICBjb25zdCBoYXNMb2dnaW5nQ29uZmlnID0gQm9vbGVhbih0aGlzLl9sb2dnaW5nKVxuICAgIGNvbnN0IGZpbGVMb2dnaW5nID0gaGFzTG9nZ2luZ0NvbmZpZyA/ICh0aGlzLl9sb2dnaW5nPy5maWxlID8/IEJvb2xlYW4oZmlsZVBhdGgpKSA6IGZhbHNlXG4gICAgY29uc3QgY29uZmlndXJlZExldmVscyA9IHRoaXMuX2xvZ2dpbmc/LmxldmVsc1xuICAgIGNvbnN0IGluY2x1ZGVMb3dMZXZlbERlYnVnID0gdGhpcy5fbG9nZ2luZz8uZGVidWdMb3dMZXZlbCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGxvZ2dlcnMgPSB0aGlzLl9sb2dnaW5nPy5sb2dnZXJzXG5cbiAgICBjb25zdCBjb25zb2xlRGVmYXVsdCA9IGRlZmF1bHRDb25zb2xlICE9PSB1bmRlZmluZWQgPyBkZWZhdWx0Q29uc29sZSA6IHRydWVcbiAgICBjb25zdCBjb25zb2xlTG9nZ2luZyA9IGNvbnNvbGVPdmVycmlkZSAhPT0gdW5kZWZpbmVkID8gY29uc29sZU92ZXJyaWRlIDogY29uc29sZURlZmF1bHRcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgbGV2ZWxzLlxuICAgICAqIEB0eXBlIHtBcnJheTxcImRlYnVnLWxvdy1sZXZlbFwiIHwgXCJkZWJ1Z1wiIHwgXCJpbmZvXCIgfCBcIndhcm5cIiB8IFwiZXJyb3JcIj59ICovXG4gICAgY29uc3QgZGVmYXVsdExldmVscyA9IFtcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl1cblxuICAgIGlmIChpbmNsdWRlTG93TGV2ZWxEZWJ1ZykgZGVmYXVsdExldmVscy51bnNoaWZ0KFwiZGVidWctbG93LWxldmVsXCIpXG5cbiAgICBjb25zdCBsZXZlbHMgPSBjb25maWd1cmVkTGV2ZWxzIHx8IGRlZmF1bHRMZXZlbHNcblxuICAgIHJldHVybiB7XG4gICAgICBjb25zb2xlOiBjb25zb2xlTG9nZ2luZyxcbiAgICAgIGRpcmVjdG9yeSxcbiAgICAgIGZpbGU6IGZpbGVMb2dnaW5nID8/IGZhbHNlLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBsb2dnZXJzLFxuICAgICAgbGV2ZWxzLFxuICAgICAgb3V0cHV0czogdGhpcy5fbG9nZ2luZz8ub3V0cHV0c1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb25maWd1cmF0aW9uLW93bmVkIHN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICogQHJldHVybnMge0xvZ1JlZGFjdG9yfSAtIFN0cnVjdHVyZWQgbG9nZ2luZyByZWRhY3Rvci5cbiAgICovXG4gIGdldExvZ1JlZGFjdG9yKCkge1xuICAgIHJldHVybiB0aGlzLl9sb2dSZWRhY3RvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5IGxvZ2dpbmcgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBxdWVyeSBsb2dnaW5nIGlzIGVuYWJsZWQuXG4gICAqL1xuICBnZXRRdWVyeUxvZ2dpbmdFbmFibGVkKCkge1xuICAgIGlmICh0aGlzLl9sb2dnaW5nPy5xdWVyeUxvZ2dpbmcgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2xvZ2dpbmcucXVlcnlMb2dnaW5nXG5cbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudCgpICE9PSBcInRlc3RcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGdlbmVyYXRpb24gbGlmZWN5Y2xlIHZhbHVlcyBmcm9tIHRoZWlyIHJhdyBjb25maWcsIGVudmlyb25tZW50LFxuICAgKiBhbmQgQVBJIHNvdXJjZXMgYmVmb3JlIGFwcGx5aW5nIGRlZmF1bHRzLiBEZXJpdmVkIGRlZmF1bHRzIGFyZSBkZWxpYmVyYXRlbHlcbiAgICogYWJzZW50IGZyb20gdGhlIHNvdXJjZSBsaXN0LCBzbyBhbiBBUEkgcmVjb3Zlcnkgc3RhdGUgY2FuIG92ZXJyaWRlIGFuXG4gICAqIElELW9ubHkgY29uZmlndXJhdGlvbiB3aXRob3V0IGNyZWF0aW5nIGEgZmFsc2UgY29uZmxpY3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBFeHBsaWNpdCBBUEkgdmFsdWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlfSBbYXJncy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXSAtIEV4cGxpY2l0IGJvb3Qgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5saWZlY3ljbGVTb2NrZXRQYXRoXSAtIEV4cGxpY2l0IGxpZmVjeWNsZSBzb2NrZXQgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvdXJjZU5hbWVdIC0gSHVtYW4tcmVhZGFibGUgQVBJIG93bmVyLlxuICAgKiBAcmV0dXJucyB7e2dlbmVyYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgfCBcImFjdGl2ZVwiLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIFJlc29sdmVkIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgcmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7Z2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsIHNvdXJjZU5hbWUgPSBcImJhY2tncm91bmQgam9icyBBUElcIn0gPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLl9iYWNrZ3JvdW5kSm9icyB8fCB7fVxuICAgIGNvbnN0IGdlbmVyYXRpb25FbnZpcm9ubWVudCA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52IHx8IHt9XG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gcmVzb2x2ZUdlbmVyYXRpb25JZChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5nZW5lcmF0aW9uSWRcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImdlbmVyYXRpb25JZFwiKSAmJiBjb25maWd1cmVkLmdlbmVyYXRpb25JZCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5nZW5lcmF0aW9uSWR9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRFwiKSwgdmFsdWU6IGdlbmVyYXRpb25FbnZpcm9ubWVudC5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSUR9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGdlbmVyYXRpb25JZGAsIHByZXNlbnQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEdlbmVyYXRpb25JZH1cbiAgICBdKVxuICAgIGNvbnN0IGluaXRpYWxHZW5lcmF0aW9uU3RhdGUgPSByZXNvbHZlSW5pdGlhbEdlbmVyYXRpb25TdGF0ZShbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJpbml0aWFsR2VuZXJhdGlvblN0YXRlXCIpICYmIGNvbmZpZ3VyZWQuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5pbml0aWFsR2VuZXJhdGlvblN0YXRlfSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSU5JVElBTF9HRU5FUkFUSU9OX1NUQVRFfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBpbml0aWFsR2VuZXJhdGlvblN0YXRlYCwgcHJlc2VudDogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGV9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuICAgIGNvbnN0IGxpZmVjeWNsZVNvY2tldFBhdGggPSByZXNvbHZlTGlmZWN5Y2xlU29ja2V0UGF0aChbXG4gICAgICB7bmFtZTogXCJiYWNrZ3JvdW5kSm9icy5saWZlY3ljbGVTb2NrZXRQYXRoXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oY29uZmlndXJlZCwgXCJsaWZlY3ljbGVTb2NrZXRQYXRoXCIpICYmIGNvbmZpZ3VyZWQubGlmZWN5Y2xlU29ja2V0UGF0aCAhPT0gdW5kZWZpbmVkLCB2YWx1ZTogY29uZmlndXJlZC5saWZlY3ljbGVTb2NrZXRQYXRofSxcbiAgICAgIHtuYW1lOiBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIsIHByZXNlbnQ6IE9iamVjdC5oYXNPd24oZ2VuZXJhdGlvbkVudmlyb25tZW50LCBcIlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTElGRUNZQ0xFX1NPQ0tFVF9QQVRIfSxcbiAgICAgIHtuYW1lOiBgJHtzb3VyY2VOYW1lfSBsaWZlY3ljbGVTb2NrZXRQYXRoYCwgcHJlc2VudDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoICE9PSB1bmRlZmluZWQsIHZhbHVlOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGh9XG4gICAgXSwgZ2VuZXJhdGlvbklkKVxuXG4gICAgcmV0dXJuIHtnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge09taXQ8UmVxdWlyZWQ8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbj4sIFwiYWRhcHRlclwiIHwgXCJyZXRlbnRpb25cIiB8IFwiZ2VuZXJhdGlvbklkXCIgfCBcImxpZmVjeWNsZVNvY2tldFBhdGhcIj4gJiB7Z2VuZXJhdGlvbklkPzogc3RyaW5nLCBsaWZlY3ljbGVTb2NrZXRQYXRoPzogc3RyaW5nLCByZXRlbnRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JzUmV0ZW50aW9uQ29uZmlndXJhdGlvbn19IC0gQmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpIHtcbiAgICBjb25zdCBwcm9jZXNzRW52aXJvbm1lbnQgPSBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudlxuICAgIGNvbnN0IGVudkhvc3QgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSE9TVFxuICAgIGNvbnN0IGVudlBvcnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVFxuICAgIGNvbnN0IGVudkRhdGFiYXNlSWRlbnRpZmllciA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19EQVRBQkFTRV9JREVOVElGSUVSXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19NQVhfQ09OQ1VSUkVOVF9GT1JLRURfSk9CU1xuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfTUFYX0NPTkNVUlJFTlRfSU5MSU5FX0pPQlNcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX0NPVU5UXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3lSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9DT05DVVJSRU5DWVxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfSk9CU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfTUFYX1JTU19CWVRFU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfTElGRVRJTUVfTVNcbiAgICBjb25zdCBlbnZEaXNwYXRjaFN0cmF0ZWd5ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0RJU1BBVENIX1NUUkFURUdZXG4gICAgY29uc3QgZW52UG9sbEludGVydmFsUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPTExfSU5URVJWQUxfTVNcbiAgICBjb25zdCBlbnZKb2JUaW1lb3V0UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0pPQl9USU1FT1VUX01TXG4gICAgY29uc3QgZW52UG9ydCA9IGVudlBvcnRSYXcgPyBOdW1iZXIoZW52UG9ydFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID0gZW52TWF4Q29uY3VycmVudEZvcmtlZFJhdyA/IE51bWJlcihlbnZNYXhDb25jdXJyZW50Rm9ya2VkUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnQgPSBlbnZNYXhDb25jdXJyZW50UmF3ID8gTnVtYmVyKGVudk1heENvbmN1cnJlbnRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyQ291bnQgPSBlbnZQb29sZWRSdW5uZXJDb3VudFJhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJDb3VudFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPSBlbnZQb29sZWRSdW5uZXJNYXhKb2JzUmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlc1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdyA/IE51bWJlcihlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvbGxJbnRlcnZhbCA9IGVudlBvbGxJbnRlcnZhbFJhdyA/IE51bWJlcihlbnZQb2xsSW50ZXJ2YWxSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52Sm9iVGltZW91dCA9IGVudkpvYlRpbWVvdXRSYXcgPyBOdW1iZXIoZW52Sm9iVGltZW91dFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmFja2dyb3VuZEpvYnMgfHwge31cbiAgICBjb25zdCB7Z2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRofSA9IHRoaXMucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZygpXG4gICAgY29uc3QgbW9kZSA9IGNvbmZpZ3VyZWQubW9kZSA9PT0gdW5kZWZpbmVkID8gXCJiYWNrZ3JvdW5kXCIgOiBjb25maWd1cmVkLm1vZGVcblxuICAgIGlmIChtb2RlICE9PSBcImJhY2tncm91bmRcIiAmJiBtb2RlICE9PSBcImlubGluZVwiKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBiYWNrZ3JvdW5kSm9icy5tb2RlIG11c3QgYmUgXCJiYWNrZ3JvdW5kXCIgb3IgXCJpbmxpbmVcIiwgZ290OiAke1N0cmluZyhtb2RlKX1gKVxuICAgIH1cbiAgICBjb25zdCBob3N0ID0gY29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3QgfHwgXCIxMjcuMC4wLjFcIlxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGNvbmZpZ3VyZWQucG9ydFxuICAgICAgOiAodHlwZW9mIGVudlBvcnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvcnQpID8gZW52UG9ydCA6IDczMzEpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gY29uZmlndXJlZC5kYXRhYmFzZUlkZW50aWZpZXIgfHwgZW52RGF0YWJhc2VJZGVudGlmaWVyIHx8IFwiZGVmYXVsdFwiXG4gICAgY29uc3QgbWF4Q29uY3VycmVudElubGluZUpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5tYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgICAgOiAodHlwZW9mIGVudk1heENvbmN1cnJlbnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudk1heENvbmN1cnJlbnQpICYmIGVudk1heENvbmN1cnJlbnQgPj0gMSA/IGVudk1heENvbmN1cnJlbnQgOiA0KVxuICAgIGNvbnN0IG1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICAgIDogKHR5cGVvZiBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZNYXhDb25jdXJyZW50Rm9ya2VkKSAmJiBlbnZNYXhDb25jdXJyZW50Rm9ya2VkID49IDEgPyBlbnZNYXhDb25jdXJyZW50Rm9ya2VkIDogNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJDb3VudCA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnQpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnQgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvdW50XG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyQ291bnRcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyQ291bnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lckNvdW50KSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lckNvdW50KSAmJiBlbnZQb29sZWRSdW5uZXJDb3VudCA+PSAxID8gZW52UG9vbGVkUnVubmVyQ291bnQgOiA0KVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSkgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJDb25jdXJyZW5jeVwiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kpICYmIGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID49IDEgPyBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSA6IDEpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4Sm9icyA9IHR5cGVvZiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9icykgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heEpvYnMpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9icyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9ic1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heEpvYnNcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyTWF4Sm9icykgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhKb2JzID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhKb2JzIDogMTAwKVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKSAmJiBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgOiA1MTIgKiAxMDI0ICogMTAyNClcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpICYmIGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgOiA2MCAqIDYwICogMTAwMClcbiAgICBjb25zdCBkaXNwYXRjaFN0cmF0ZWd5UmF3ID0gY29uZmlndXJlZC5kaXNwYXRjaFN0cmF0ZWd5IHx8IGVudkRpc3BhdGNoU3RyYXRlZ3lcbiAgICBjb25zdCBkaXNwYXRjaFN0cmF0ZWd5ID0gZGlzcGF0Y2hTdHJhdGVneVJhdyA9PT0gXCJwb2xsaW5nXCIgPyBcInBvbGxpbmdcIiA6IFwiYmVhY29uXCJcbiAgICBjb25zdCBwb2xsSW50ZXJ2YWxNcyA9IHR5cGVvZiBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQucG9sbEludGVydmFsTXMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLnBvbGxJbnRlcnZhbE1zXG4gICAgICA6ICh0eXBlb2YgZW52UG9sbEludGVydmFsID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb2xsSW50ZXJ2YWwpICYmIGVudlBvbGxJbnRlcnZhbCA+PSAxID8gZW52UG9sbEludGVydmFsIDogMTAwMClcbiAgICBjb25zdCBxdWV1ZXMgPSBjb25maWd1cmVkLnF1ZXVlcyAmJiB0eXBlb2YgY29uZmlndXJlZC5xdWV1ZXMgPT09IFwib2JqZWN0XCIgPyBjb25maWd1cmVkLnF1ZXVlcyA6IHt9XG4gICAgLy8gQW4gZXhwbGljaXQgY29uZmlnIHZhbHVlIHdpbnMgb3ZlciB0aGUgZW52IHZhciDigJQgaW5jbHVkaW5nIGBudWxsYC9gMGAsXG4gICAgLy8gd2hpY2ggZGlzYWJsZSB0aGUgYmFja3N0b3AgZXZlbiB3aGVuIHRoZSBlbnZpcm9ubWVudCBzZXRzIGEgZGVmYXVsdC5cbiAgICAvLyBPbmx5IGZhbGwgdGhyb3VnaCB0byB0aGUgZW52IHZhciB3aGVuIGNvbmZpZyBvbWl0cyBgam9iVGltZW91dE1zYCBlbnRpcmVseS5cbiAgICBjb25zdCBqb2JUaW1lb3V0TXMgPSBcImpvYlRpbWVvdXRNc1wiIGluIGNvbmZpZ3VyZWRcbiAgICAgID8gKHR5cGVvZiBjb25maWd1cmVkLmpvYlRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLmpvYlRpbWVvdXRNcyA+IDAgPyBjb25maWd1cmVkLmpvYlRpbWVvdXRNcyA6IG51bGwpXG4gICAgICA6ICh0eXBlb2YgZW52Sm9iVGltZW91dCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52Sm9iVGltZW91dCkgJiYgZW52Sm9iVGltZW91dCA+IDAgPyBlbnZKb2JUaW1lb3V0IDogbnVsbClcbiAgICBjb25zdCBjb25maWd1cmVkUmV0ZW50aW9uID0gY29uZmlndXJlZC5yZXRlbnRpb24gJiYgdHlwZW9mIGNvbmZpZ3VyZWQucmV0ZW50aW9uID09PSBcIm9iamVjdFwiID8gY29uZmlndXJlZC5yZXRlbnRpb24gOiB7fVxuICAgIGNvbnN0IHJldGVudGlvbiA9IHtcbiAgICAgIGNvbXBsZXRlZFR0bE1zOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5jb21wbGV0ZWRUdGxNcyA9PT0gXCJudW1iZXJcIiB8fCBjb25maWd1cmVkUmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zID09PSBudWxsXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5jb21wbGV0ZWRUdGxNc1xuICAgICAgICA6IDcgKiAyNCAqIDYwICogNjAgKiAxMDAwLFxuICAgICAgZmFpbGVkVHRsTXM6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLmZhaWxlZFR0bE1zID09PSBcIm51bWJlclwiIHx8IGNvbmZpZ3VyZWRSZXRlbnRpb24uZmFpbGVkVHRsTXMgPT09IG51bGxcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLmZhaWxlZFR0bE1zXG4gICAgICAgIDogMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwLFxuICAgICAgYmF0Y2hTaXplOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5iYXRjaFNpemUgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZFJldGVudGlvbi5iYXRjaFNpemUgPiAwXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5iYXRjaFNpemVcbiAgICAgICAgOiAxMDAwLFxuICAgICAgc3dlZXBJbnRlcnZhbE1zOiB0eXBlb2YgY29uZmlndXJlZFJldGVudGlvbi5zd2VlcEludGVydmFsTXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZFJldGVudGlvbi5zd2VlcEludGVydmFsTXMgPiAwXG4gICAgICAgID8gY29uZmlndXJlZFJldGVudGlvbi5zd2VlcEludGVydmFsTXNcbiAgICAgICAgOiA2MCAqIDYwICogMTAwMFxuICAgIH1cblxuICAgIGNvbnN0IGpvYkNsYXNzZXMgPSB0aGlzLmdldEJhY2tncm91bmRKb2JDbGFzc2VzKClcblxuICAgIHJldHVybiB7aG9zdCwgcG9ydCwgZGF0YWJhc2VJZGVudGlmaWVyLCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icywgbWF4Q29uY3VycmVudElubGluZUpvYnMsIG1vZGUsIHBvb2xlZFJ1bm5lckNvdW50LCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSwgcG9vbGVkUnVubmVyTWF4Sm9icywgcG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMsIHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMsIGRpc3BhdGNoU3RyYXRlZ3ksIHBvbGxJbnRlcnZhbE1zLCBxdWV1ZXMsIGpvYkNsYXNzZXMsIGpvYlRpbWVvdXRNcywgcmV0ZW50aW9uLCBnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBzdGF0aWNhbGx5IHJlZ2lzdGVyZWQgcG9ydGFibGUgYmFja2dyb3VuZCBqb2JzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDbGFzc1tdfSAtIENvbmZpZ3VyZWQgam9iIGNsYXNzZXMuXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9iQ2xhc3NlcygpIHtcbiAgICBjb25zdCBqb2JDbGFzc2VzID0gdGhpcy5fYmFja2dyb3VuZEpvYnM/LmpvYkNsYXNzZXNcblxuICAgIGlmIChqb2JDbGFzc2VzID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICAgIGlmICghQXJyYXkuaXNBcnJheShqb2JDbGFzc2VzKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmRKb2JzLmpvYkNsYXNzZXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuXG4gICAgcmV0dXJuIFsuLi5qb2JDbGFzc2VzXVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuZCBtZW1vaXplcyBvbmUgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXIgZm9yIHRoaXMgY29uZmlndXJhdGlvbiBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJ9IC0gQWN0aXZlIGFkYXB0ZXIuXG4gICAqL1xuICBnZXRCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24pIHJldHVybiB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uLmFkYXB0ZXJcblxuICAgIGNvbnN0IGNvbmZpZ3VyZWRBZGFwdGVyID0gdGhpcy5fYmFja2dyb3VuZEpvYnM/LmFkYXB0ZXJcbiAgICBjb25zdCBhZGFwdGVyID0gdHlwZW9mIGNvbmZpZ3VyZWRBZGFwdGVyID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gY29uZmlndXJlZEFkYXB0ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXN9KVxuICAgICAgOiAoY29uZmlndXJlZEFkYXB0ZXIgfHwgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5jcmVhdGVCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoe2NvbmZpZ3VyYXRpb246IHRoaXN9KSlcblxuICAgIGlmICghKGFkYXB0ZXIgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiYmFja2dyb3VuZEpvYnMuYWRhcHRlciBtdXN0IGJlIGEgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGluc3RhbmNlIG9yIGEgc3luY2hyb25vdXMgZmFjdG9yeSByZXR1cm5pbmcgb25lXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHtcbiAgICAgIGFkYXB0ZXIsXG4gICAgICBjbG9zaW5nOiBmYWxzZSxcbiAgICAgIGNsb3NlUHJvbWlzZTogdW5kZWZpbmVkLFxuICAgICAgcmVhZHlQcm9taXNlOiB1bmRlZmluZWRcbiAgICB9XG4gICAgcmV0dXJuIGFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IGFjcXVpcmVzIHRoZSBleGFjdCByZWFkeSBhZGFwdGVyIGZvciB0aGUgYWN0aXZlIGxpZmVjeWNsZS5cbiAgICogQSBjbG9zZSB0aGF0IGNsYWltcyB0aGUgZ2VuZXJhdGlvbiB3aGlsZSByZWFkaW5lc3MgaXMgcGVuZGluZyB3aW5zOiB0aGlzXG4gICAqIG9wZXJhdGlvbiB3YWl0cyBmb3IgdGhhdCBjbG9zZSwgY3JlYXRlcyB0aGUgbmV4dCBnZW5lcmF0aW9uLCByZWFkaWVzIGl0LFxuICAgKiBhbmQgcmV0dXJucyBvbmx5IHRoYXQgbGl2ZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYnNBZGFwdGVyPn0gLSBFeGFjdCByZWFkeSBhZGFwdGVyIGdlbmVyYXRpb24uXG4gICAqL1xuICBhc3luYyBhY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IGRhdGFiYXNlQ2xvc2VQcm9taXNlID0gdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuXG4gICAgICBpZiAoZGF0YWJhc2VDbG9zZVByb21pc2UpIHtcbiAgICAgICAgYXdhaXQgZGF0YWJhc2VDbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhpcy5nZXRCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cblxuICAgICAgaWYgKCFnZW5lcmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBnZW5lcmF0aW9uIHdhcyBub3QgY3JlYXRlZFwiKVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zaW5nKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UgfHwgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGdlbmVyYXRpb24uYWRhcHRlci5lbnN1cmVSZWFkeSgpXG4gICAgICB9KVxuXG4gICAgICBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9IHJlYWR5UHJvbWlzZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZWFkeVByb21pc2VcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zaW5nKSB7XG4gICAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSkgYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gIT09IGdlbmVyYXRpb24pIGNvbnRpbnVlXG5cbiAgICAgIHJldHVybiBnZW5lcmF0aW9uLmFkYXB0ZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVhZGllcyB0aGUgYWN0aXZlIGFkYXB0ZXIgb25jZSBwZXIgbGlmZWN5Y2xlLiBBIGZhaWxlZCBhdHRlbXB0IHJlbWFpbnMgcmV0cnlhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQmFja2dyb3VuZEpvYnNBZGFwdGVyUmVhZHkoKSB7XG4gICAgYXdhaXQgdGhpcy5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgaGVhbHRoIHdpdGhvdXQgcmVzb2x2aW5nIHBlcnNpc3RlbmNlIGluIG5vbi1kdXJhYmxlIGlubGluZSBtb2RlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0hlYWx0aD59IC0gQ3VycmVudCBoZWFsdGguXG4gICAqL1xuICBhc3luYyBiYWNrZ3JvdW5kSm9ic0hlYWx0aCgpIHtcbiAgICBpZiAodGhpcy5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLm1vZGUgPT09IFwiaW5saW5lXCIpIHJldHVybiB7cmVhZHk6IHRydWV9XG5cbiAgICBjb25zdCBhZGFwdGVyID0gYXdhaXQgdGhpcy5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFkYXB0ZXIuaGVhbHRoKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgdGhlIHJlc29sdmVkIGFkYXB0ZXIgb25jZSBhbmQgY2xlYXJzIGxpZmVjeWNsZSBjYWNoZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNsb3NlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKSB7XG4gICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cblxuICAgIGlmICghZ2VuZXJhdGlvbikgcmV0dXJuXG4gICAgaWYgKGdlbmVyYXRpb24uY2xvc2VQcm9taXNlKSByZXR1cm4gYXdhaXQgZ2VuZXJhdGlvbi5jbG9zZVByb21pc2VcblxuICAgIGdlbmVyYXRpb24uY2xvc2luZyA9IHRydWVcbiAgICBjb25zdCBjbG9zZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgICAgY29uc3QgY2xvc2VFcnJvcnMgPSBbXVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbi5yZWFkeVByb21pc2UpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGdlbmVyYXRpb24uYWRhcHRlci5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cblxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgY2xvc2VFcnJvcnNbMF1cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoY2xvc2VFcnJvcnMsIFwiRmFpbGVkIHRvIHJlYWR5IGFuZCBjbG9zZSB0aGUgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXJcIilcbiAgICB9KSgpXG5cbiAgICBnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZSA9IGNsb3NlUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsb3NlUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9PT0gZ2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbn0gYmFja2dyb3VuZEpvYnMgLSBCYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEJhY2tncm91bmRKb2JzQ29uZmlnKGJhY2tncm91bmRKb2JzKSB7XG4gICAgaWYgKHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gJiYgYmFja2dyb3VuZEpvYnMuYWRhcHRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVwbGFjZSBiYWNrZ3JvdW5kSm9icy5hZGFwdGVyIGR1cmluZyBhbiBhY3RpdmUgYWRhcHRlciBsaWZlY3ljbGU7IGNsb3NlIGl0IGZpcnN0XCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iYWNrZ3JvdW5kSm9icywgYmFja2dyb3VuZEpvYnMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGFjdGl2ZSBCZWFjb24gY29uZmlndXJhdGlvbi4gQmVhY29uIGlzIG9wdC1pbjogaXRcbiAgICogc3RheXMgZGlzYWJsZWQgdW5sZXNzIHRoZSBhcHAgcGFzc2VzIGBiZWFjb246IHtob3N0LCBwb3J0fWAgL1xuICAgKiBgYmVhY29uOiB7aW5Qcm9jZXNzOiB0cnVlfWAsIGNhbGxzIGBzZXRCZWFjb25Db25maWcoey4uLn0pYCwgb3JcbiAgICogc2V0cyB0aGUgYFZFTE9DSU9VU19CRUFDT05fSE9TVGAgLyBgVkVMT0NJT1VTX0JFQUNPTl9QT1JUYCBlbnYgdmFycy5cbiAgICogU2V0dGluZyBgZW5hYmxlZDogZmFsc2VgIGV4cGxpY2l0bHkgZGlzYWJsZXMgaXQgZXZlbiB3aGVuIGVudiB2YXJzXG4gICAqIGFyZSBwcmVzZW50ICh1c2VmdWwgZm9yIHRlc3RzKS4gV2hlbiBgaW5Qcm9jZXNzOiB0cnVlYCBpcyBzZXQsXG4gICAqIGVudi12YXIgaG9zdC9wb3J0IGFyZSBpZ25vcmVkIOKAlCBjb2RlLWxldmVsIGNvbmZpZyB3aW5zLlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIGhvc3Q6IHN0cmluZywgcG9ydDogbnVtYmVyLCBwZWVyVHlwZT86IHN0cmluZywgaW5Qcm9jZXNzOiBib29sZWFuLCB1bnJlYWNoYWJsZVJlcG9ydE1zOiBudW1iZXJ9fSAtIEJlYWNvbiBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdHMgYXBwbGllZC5cbiAgICovXG4gIGdldEJlYWNvbkNvbmZpZygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5fYmVhY29uIHx8IHt9XG4gICAgY29uc3QgaW5Qcm9jZXNzID0gY29uZmlndXJlZC5pblByb2Nlc3MgPT09IHRydWVcblxuICAgIGlmIChpblByb2Nlc3MgJiYgKGNvbmZpZ3VyZWQuaG9zdCB8fCB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQmVhY29uIGNvbmZpZ3VyYXRpb246IGBpblByb2Nlc3M6IHRydWVgIGlzIG11dHVhbGx5IGV4Y2x1c2l2ZSB3aXRoIGBob3N0YC9gcG9ydGAuIFVzZSBvbmUgb3IgdGhlIG90aGVyLlwiKVxuICAgIH1cblxuICAgIGNvbnN0IGVudkhvc3QgPSBpblByb2Nlc3MgPyB1bmRlZmluZWQgOiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQkVBQ09OX0hPU1RcbiAgICBjb25zdCBlbnZQb3J0UmF3ID0gaW5Qcm9jZXNzID8gdW5kZWZpbmVkIDogcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JFQUNPTl9QT1JUXG4gICAgY29uc3QgZW52UG9ydCA9IGVudlBvcnRSYXcgPyBOdW1iZXIoZW52UG9ydFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBob3N0ID0gY29uZmlndXJlZC5ob3N0IHx8IGVudkhvc3QgfHwgXCIxMjcuMC4wLjFcIlxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgY29uZmlndXJlZC5wb3J0ID09PSBcIm51bWJlclwiXG4gICAgICA/IGNvbmZpZ3VyZWQucG9ydFxuICAgICAgOiAodHlwZW9mIGVudlBvcnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvcnQpID8gZW52UG9ydCA6IDczMzApXG5cbiAgICBsZXQgZW5hYmxlZFxuXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkLmVuYWJsZWQgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICBlbmFibGVkID0gY29uZmlndXJlZC5lbmFibGVkXG4gICAgfSBlbHNlIHtcbiAgICAgIGVuYWJsZWQgPSBCb29sZWFuKGluUHJvY2VzcyB8fCBjb25maWd1cmVkLmhvc3QgfHwgY29uZmlndXJlZC5wb3J0IHx8IGVudkhvc3QgfHwgZW52UG9ydClcbiAgICB9XG5cbiAgICBjb25zdCB1bnJlYWNoYWJsZVJlcG9ydE1zID0gcmVzb2x2ZUJlYWNvblVucmVhY2hhYmxlUmVwb3J0TXMoY29uZmlndXJlZC51bnJlYWNoYWJsZVJlcG9ydE1zKVxuXG4gICAgcmV0dXJuIHtlbmFibGVkLCBob3N0LCBwb3J0LCBwZWVyVHlwZTogY29uZmlndXJlZC5wZWVyVHlwZSwgaW5Qcm9jZXNzLCB1bnJlYWNoYWJsZVJlcG9ydE1zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJlYWNvbiBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJlYWNvbkNvbmZpZ3VyYXRpb259IGJlYWNvbiAtIEJlYWNvbiBjb25maWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QmVhY29uQ29uZmlnKGJlYWNvbikge1xuICAgIHRoaXMuX2JlYWNvbiA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2JlYWNvbiwgYmVhY29uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJlYWNvbiBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIGFjdGl2ZSBCZWFjb24gY2xpZW50LCBpZiBjb25uZWN0ZWQuXG4gICAqL1xuICBnZXRCZWFjb25DbGllbnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2JlYWNvbkNsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRoaXMgY29uZmlndXJhdGlvbidzIEJlYWNvbiBjbGllbnQgdG8gdGhlIGNvbmZpZ3VyZWRcbiAgICogYnJva2VyLCB3aXJpbmcgaW5jb21pbmcgYnJvYWRjYXN0cyB0byB0aGUgbG9jYWwgZGVsaXZlcnkgcGF0aCBzb1xuICAgKiBhbnkgd2Vic29ja2V0IHN1YnNjcmliZXJzIGluIHRoaXMgcHJvY2VzcyByZWNlaXZlIHRoZW0uIElkZW1wb3RlbnRcbiAgICog4oCUIHJlcGVhdCBjYWxscyByZXR1cm4gdGhlIHNhbWUgaW4tZmxpZ2h0IG9yIHJlc29sdmVkIHByb21pc2UuXG4gICAqXG4gICAqIFJldHVybnMgaW1tZWRpYXRlbHkgd2l0aCBgdW5kZWZpbmVkYCBpZiBCZWFjb24gaXMgbm90IGVuYWJsZWQuXG4gICAqXG4gICAqICoqTm9uLWJsb2NraW5nIGJ5IGRlc2lnbiAoVENQIG1vZGUpLioqIEZvciBicm9rZXItYmFja2VkIEJlYWNvbiwgdGhlXG4gICAqIHJldHVybmVkIHByb21pc2UgcmVzb2x2ZXMgYXMgc29vbiBhcyB0aGUgY2xpZW50IGlzIGNvbnN0cnVjdGVkIGFuZFxuICAgKiB0aGUgVENQIGNvbm5lY3QgaXMgbGF1bmNoZWQg4oCUIGl0IGRvZXMgKipub3QqKiB3YWl0IGZvciB0aGUgY29ubmVjdFxuICAgKiBoYW5kc2hha2UgdG8gY29tcGxldGUuIEEgYnJva2VyIHRoYXQgc2lsZW50bHkgZHJvcHMgU1lOc1xuICAgKiAoZmlyZXdhbGwvTkFDTCBEUk9QIHJ1bGVzKSB3b3VsZCBvdGhlcndpc2UgYmxvY2sgc3RhcnR1cCBvbiB0aGUgT1NcbiAgICogVENQIGNvbm5lY3QgdGltZW91dCAodGVucyBvZiBzZWNvbmRzKSwgd2hpY2ggY29udHJhZGljdHMgdGhlXG4gICAqIGRvY3VtZW50ZWQgXCJmYWxsIGJhY2sgdG8gbG9jYWwtb25seSBhbmQgcmVjb25uZWN0IGluIHRoZVxuICAgKiBiYWNrZ3JvdW5kXCIgY29udHJhY3QuIEluaXRpYWwtY29ubmVjdCBmYWlsdXJlcyBzdXJmYWNlXG4gICAqIGFzeW5jaHJvbm91c2x5IG9uIHRoZSBmcmFtZXdvcmstZXJyb3IgY2hhbm5lbCB2aWEgdGhlXG4gICAqIGBjb25uZWN0LWVycm9yYCBsaXN0ZW5lciByZWdpc3RlcmVkIGhlcmUuIENhbGxlcnMgdGhhdCBuZWVkIGFcbiAgICogZGV0ZXJtaW5pc3RpYyBwdWJsaXNoLXJlYWRpbmVzcyBib3VuZGFyeSBzaG91bGQgY2FsbFxuICAgKiBgZ2V0QmVhY29uQ2xpZW50KCk/LndhaXRGb3JSZWFkeSh7dGltZW91dE1zfSlgLlxuICAgKlxuICAgKiAqKkluLXByb2Nlc3MgbW9kZSoqIGF3YWl0cyBgY29ubmVjdCgpYCDigJQgdGhhdCBwYXRoIGlzIHN5bmNocm9ub3VzLFxuICAgKiBjYW5ub3QgZmFpbCwgYW5kIGdpdmVzIGNhbGxlcnMgcHJlZGljdGFibGUgcmVhZGluZXNzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnBlZXJUeXBlXSAtIE92ZXJyaWRlIHBlZXJUeXBlIGZvciB0aGlzIGNvbm5lY3QgY2FsbCAoZS5nLiBgXCJzZXJ2ZXJcImAsIGBcImJhY2tncm91bmQtam9icy13b3JrZXJcImApLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlZ2lzdGVyZWQgY2xpZW50IChUQ1AgbW9kZTogY29ubmVjdCBtYXkgc3RpbGwgYmUgaW4gZmxpZ2h0KSwgb3IgdW5kZWZpbmVkIHdoZW4gQmVhY29uIGlzIGRpc2FibGVkLlxuICAgKi9cbiAgYXN5bmMgY29ubmVjdEJlYWNvbih7cGVlclR5cGV9ID0ge30pIHtcbiAgICBpZiAodGhpcy5fYmVhY29uQ2xpZW50KSByZXR1cm4gdGhpcy5fYmVhY29uQ2xpZW50XG4gICAgaWYgKHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2VcblxuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0QmVhY29uQ29uZmlnKClcblxuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNsaWVudCA9IGF3YWl0IHRoaXMuX2NyZWF0ZUJlYWNvbkNsaWVudCh7XG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgcGVlclR5cGU6IHBlZXJUeXBlIHx8IGNvbmZpZy5wZWVyVHlwZVxuICAgICAgfSlcblxuICAgICAgY2xpZW50Lm9uQnJvYWRjYXN0KChtZXNzYWdlKSA9PiB7XG4gICAgICAgIC8vIFN5bmFwc2Utc3R5bGUgZmFuLW91dDogZGVsaXZlciBldmVyeSBicm9hZGNhc3Qgd2UgcmVjZWl2ZVxuICAgICAgICAvLyBmcm9tIHRoZSBidXMgdGhyb3VnaCB0aGUgbG9jYWwgZGVsaXZlcnkgcGF0aC4gRWNob2VzIG9mIG91clxuICAgICAgICAvLyBvd24gcHVibGlzaGVzIGZvbGxvdyB0aGUgc2FtZSBwYXRoIHNvIGV2ZXJ5IHBlZXIgc2VlcyB0aGVcbiAgICAgICAgLy8gc2FtZSBkZWxpdmVyeSBzZW1hbnRpY3MuXG4gICAgICAgIHRoaXMuX2RlbGl2ZXJCcm9hZGNhc3RGcm9tQmVhY29uKG1lc3NhZ2UpXG4gICAgICB9KVxuXG4gICAgICAvLyBCZWFjb24gY29ubmVjdC9kaXNjb25uZWN0IGJsaXBzIGFyZSBleHBlY3RlZCBkdXJpbmcgZGVwbG95cyAodGhlIGJyb2tlclxuICAgICAgLy8gcmVzdGFydHMpIGFuZCB0aGUgQmVhY29uQ2xpZW50IGF1dG8tcmVjb25uZWN0cyBpbiB0aGUgYmFja2dyb3VuZCwgc28gYVxuICAgICAgLy8gc2luZ2xlIHRyYW5zaWVudCBmYWlsdXJlIGlzIE5PVCByZXBvcnRlZC4gT25seSBhIHN1c3RhaW5lZCBvdXRhZ2UgKHN0aWxsXG4gICAgICAvLyBkb3duIGFmdGVyIGB1bnJlYWNoYWJsZVJlcG9ydE1zYCkgaXMgc3VyZmFjZWQgb24gdGhlIGZyYW1ld29yay1lcnJvclxuICAgICAgLy8gY2hhbm5lbDsgYSAocmUpY29ubmVjdCB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyBjbGVhcnMgaXQgc2lsZW50bHkuXG5cbiAgICAgIC8vIGBjb25uZWN0LWVycm9yYCBmaXJlcyB3aGVuIHRoZSAqaW5pdGlhbCogVENQL2hhbmRzaGFrZSBmYWlscy5cbiAgICAgIGNsaWVudC5vbihcImNvbm5lY3QtZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlOiBcImJlYWNvbi1jb25uZWN0XCIsIGVycm9yLCByZXBvcnRBZnRlck1zOiBjb25maWcudW5yZWFjaGFibGVSZXBvcnRNc30pXG4gICAgICB9KVxuXG4gICAgICAvLyBgZGlzY29ubmVjdGAgZmlyZXMgd2hlbiBhbiBlc3RhYmxpc2hlZCBjb25uZWN0aW9uIGRyb3BzLiBUaGUgcGF5bG9hZCBpc1xuICAgICAgLy8gdGhlIHVuZGVybHlpbmcgc29ja2V0IGVycm9yIGlmIHRoZXJlIHdhcyBvbmUsIG9yIGEgc3ludGhldGljXG4gICAgICAvLyBFcnJvcihcIkJlYWNvbiBicm9rZXIgZGlzY29ubmVjdGVkXCIpIG90aGVyd2lzZS5cbiAgICAgIGNsaWVudC5vbihcImRpc2Nvbm5lY3RcIiwgKHJlYXNvbikgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZTogXCJiZWFjb24tZGlzY29ubmVjdFwiLCBlcnJvcjogcmVhc29uLCByZXBvcnRBZnRlck1zOiBjb25maWcudW5yZWFjaGFibGVSZXBvcnRNc30pXG4gICAgICB9KVxuXG4gICAgICAvLyBgY29ubmVjdGAgZmlyZXMgb24gZXZlcnkgKHJlKWNvbm5lY3Q7IGNsZWFyIGFueSBwZW5kaW5nIG91dGFnZSBzdGF0ZSBzb1xuICAgICAgLy8gYSB0cmFuc2llbnQgYmxpcCB0aGF0IHJlY292ZXJzIHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93IHN0YXlzIHNpbGVudC5cbiAgICAgIGNsaWVudC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25VcCgpXG4gICAgICB9KVxuXG4gICAgICAvLyBSZWdpc3RlciB0aGUgY2xpZW50ICpiZWZvcmUqIGtpY2tpbmcgb2ZmIGNvbm5lY3Qgc28gc3Vic2VxdWVudFxuICAgICAgLy8gYGNvbm5lY3RCZWFjb24oKWAgY2FsbHMgcmV0dXJuIHRoaXMgc2FtZSBpbnN0YW5jZSBpbnN0ZWFkIG9mXG4gICAgICAvLyByYWNpbmcgdG8gY29uc3RydWN0IGEgc2Vjb25kIG9uZS5cbiAgICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IGNsaWVudFxuXG4gICAgICBpZiAoY29uZmlnLmluUHJvY2Vzcykge1xuICAgICAgICAvLyBJbi1wcm9jZXNzIGNvbm5lY3QgaXMgc3luY2hyb25vdXMsIGNhbm5vdCBmYWlsLCBhbmQgcmVzb2x2ZXNcbiAgICAgICAgLy8gYmVmb3JlIHRoaXMgYXdhaXQgeWllbGRzIOKAlCBjYWxsZXJzIGNhbiByZWx5IG9uXG4gICAgICAgIC8vIGBpc0Nvbm5lY3RlZCgpID09PSB0cnVlYCBpbW1lZGlhdGVseSBhZnRlciBgY29ubmVjdEJlYWNvbigpYC5cbiAgICAgICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRmlyZS1hbmQtZm9yZ2V0IHRoZSBUQ1AgY29ubmVjdC4gQXdhaXRpbmcgaGVyZSB3b3VsZCBibG9ja1xuICAgICAgICAvLyBzdGFydHVwIG9uIHRoZSBPUyBUQ1AgY29ubmVjdCB0aW1lb3V0ICg3NXMgZGVmYXVsdCBvbiBMaW51eClcbiAgICAgICAgLy8gd2hlbiB0aGUgYnJva2VyIHNpbGVudGx5IGRyb3BzIFNZTnMuIEZhaWx1cmVzIHN1cmZhY2VcbiAgICAgICAgLy8gYXN5bmNocm9ub3VzbHkgdmlhIHRoZSBgY29ubmVjdC1lcnJvcmAgbGlzdGVuZXIgcmVnaXN0ZXJlZFxuICAgICAgICAvLyBhYm92ZTsgdGhlIEJlYWNvbkNsaWVudCdzIHJlY29ubmVjdCBsb29wIGtlZXBzIHRyeWluZy5cbiAgICAgICAgdm9pZCBjbGllbnQuY29ubmVjdCgpLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBBbHJlYWR5IHJlcG9ydGVkIHZpYSBjb25uZWN0LWVycm9yIGFib3ZlLlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2xpZW50XG4gICAgfSkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2JlYWNvbkNvbm5lY3RQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgQmVhY29uIGNsaWVudCBtYXRjaGluZyB0aGUgY29uZmlndXJlZCBtb2RlLiBTcGxpdCBvdXQgc29cbiAgICogYGNvbm5lY3RCZWFjb25gIHN0YXlzIGZvY3VzZWQgb24gbGlmZWN5Y2xlIGFuZCBlcnJvciB3aXJpbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPFZlbG9jaW91c0NvbmZpZ3VyYXRpb25bXCJnZXRCZWFjb25Db25maWdcIl0+fSBhcmdzLmNvbmZpZyAtIFJlc29sdmVkIEJlYWNvbiBjb25maWcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBSZXNvbHZlZCBwZWVyIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdD59IC0gQmVhY29uIGNsaWVudC5cbiAgICovXG4gIGFzeW5jIF9jcmVhdGVCZWFjb25DbGllbnQoe2NvbmZpZywgcGVlclR5cGV9KSB7XG4gICAgLy8gUm91dGUgdGhyb3VnaCB0aGUgZW52aXJvbm1lbnQgaGFuZGxlciBzbyB0aGUgTm9kZS1vbmx5IGBub2RlOm5ldGBcbiAgICAvLyAvIGBub2RlOmNyeXB0b2AgZGVwcyBpbiB0aGUgQmVhY29uIGNsaWVudCBtb2R1bGVzIGRvbid0IGdldCBwdWxsZWRcbiAgICAvLyBpbnRvIGJyb3dzZXIgYnVuZGxlcy4gQnJvd3NlciBidW5kbGVzIHN0YXRpY2FsbHkgcmVhY2hcbiAgICAvLyBgQ29uZmlndXJhdGlvbmAgKHZpYSBgTG9nZ2VyYCk7IHB1dHRpbmcgdGhlIGR5bmFtaWNcbiAgICAvLyBgaW1wb3J0KFwiLi9iZWFjb24vLi4uXCIpYCBjYWxscyBoZXJlIHdvdWxkIHN0aWxsIGRyYWcgdGhvc2UgbW9kdWxlc1xuICAgIC8vIHRocm91Z2ggZXNidWlsZCdzIHN0YXRpYyBhbmFseXNpcy4gSGlkaW5nIHRoZSBpbXBvcnRzIGluc2lkZSB0aGVcbiAgICAvLyBOb2RlIGVudmlyb25tZW50IGhhbmRsZXIga2VlcHMgdGhlbSBvZmYgdGhlIGJyb3dzZXIgcGF0aCDigJRcbiAgICAvLyBicm93c2VyLWJ1bmRsZWQgYXBwcyBuZXZlciByZWFjaCBgZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS5qc2AuXG4gICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmIChjb25maWcuaW5Qcm9jZXNzKSB7XG4gICAgICBjb25zdCBJblByb2Nlc3NCZWFjb25DbGllbnQgPSBhd2FpdCBoYW5kbGVyLmxvYWRJblByb2Nlc3NCZWFjb25DbGllbnQoKVxuXG4gICAgICByZXR1cm4gbmV3IEluUHJvY2Vzc0JlYWNvbkNsaWVudCh7cGVlclR5cGV9KVxuICAgIH1cblxuICAgIGNvbnN0IEJlYWNvbkNsaWVudCA9IGF3YWl0IGhhbmRsZXIubG9hZEJlYWNvbkNsaWVudCgpXG5cbiAgICByZXR1cm4gbmV3IEJlYWNvbkNsaWVudCh7XG4gICAgICBob3N0OiBjb25maWcuaG9zdCxcbiAgICAgIHBvcnQ6IGNvbmZpZy5wb3J0LFxuICAgICAgcGVlclR5cGVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBCZWFjb24gY29ubmVjdC9kaXNjb25uZWN0IGZhaWx1cmUgd2l0aG91dCByZXBvcnRpbmcgaXQgaW1tZWRpYXRlbHkuXG4gICAqIFRoZSBCZWFjb25DbGllbnQgYXV0by1yZWNvbm5lY3RzLCBzbyBicmllZiBvdXRhZ2VzIChlLmcuIGEgZGVwbG95IHJlc3RhcnRpbmdcbiAgICogdGhlIGJyb2tlcikgYXJlIGV4cGVjdGVkOyBvbmx5IGlmIHRoZSBiZWFjb24gaXMgc3RpbGwgdW5yZWFjaGFibGUgYWZ0ZXJcbiAgICogYHJlcG9ydEFmdGVyTXNgIGlzIGEgc2luZ2xlIGZyYW1ld29yay1lcnJvciBzdXJmYWNlZCB2aWEgYF9yZXBvcnRCZWFjb25FcnJvcmAuXG4gICAqIEEgc3Vic2VxdWVudCBgY29ubmVjdGAgKHNlZSBgX2hhbmRsZUJlYWNvblVwYCkgY2FuY2VscyB0aGUgcGVuZGluZyByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCJ9IGFyZ3Muc3RhZ2UgLSBGYWlsdXJlIHN0YWdlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnJlcG9ydEFmdGVyTXMgLSBHcmFjZSB3aW5kb3cgYmVmb3JlIGEgc3VzdGFpbmVkIG91dGFnZSBpcyByZXBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQmVhY29uRG93bih7c3RhZ2UsIGVycm9yLCByZXBvcnRBZnRlck1zfSkge1xuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB7c3RhZ2UsIGVycm9yfVxuXG4gICAgLy8gQSByZXBvcnQgaXMgYWxyZWFkeSBwZW5kaW5nIG9yIGFscmVhZHkgc2VudCBmb3IgdGhpcyBvdXRhZ2Ug4oCUIGtlZXAgdGhlXG4gICAgLy8gbGF0ZXN0IGVycm9yIGJ1dCBkb24ndCBzdGFjayB0aW1lcnMgb3IgcmUtcmVwb3J0LlxuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lciB8fCB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcblxuICAgICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudD8uaXNDb25uZWN0ZWQoKSkge1xuICAgICAgICB0aGlzLl9oYW5kbGVCZWFjb25VcCgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IHRydWVcblxuICAgICAgaWYgKHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IpIHRoaXMuX3JlcG9ydEJlYWNvbkVycm9yKHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IpXG4gICAgfSwgcmVwb3J0QWZ0ZXJNcylcblxuICAgIC8vIERvbid0IGxldCB0aGUgZ3JhY2UgdGltZXIga2VlcCB0aGUgcHJvY2VzcyBhbGl2ZS5cbiAgICBpZiAodHlwZW9mIHRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRpbWVyLnVucmVmKClcblxuICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdGltZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgYmVhY29uLWRvd24gc3RhdGUgb24gYSAocmUpY29ubmVjdC4gQSBibGlwIHRoYXQgcmVjb3ZlcnMgd2l0aGluIHRoZVxuICAgKiBncmFjZSB3aW5kb3cgaXMgbmV2ZXIgcmVwb3J0ZWQ7IGlmIGEgc3VzdGFpbmVkIG91dGFnZSBoYWQgYWxyZWFkeSBiZWVuXG4gICAqIHJlcG9ydGVkLCB0aGUgc3RhdGUgcmVzZXRzIHNvIGEgZnV0dXJlIG91dGFnZSBjYW4gcmVwb3J0IGFnYWluLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVCZWFjb25VcCgpIHtcbiAgICBpZiAodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcilcbiAgICAgIHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2JlYWNvbkxhc3REb3duRXJyb3IgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhIEJlYWNvbiBmYWlsdXJlIG9uIHRoZSBmcmFtZXdvcmsgZXJyb3IgY2hhbm5lbC4gTWlycm9yc1xuICAgKiB0aGUgcGF0dGVybiB1c2VkIGJ5IGByZXF1ZXN0LXJ1bm5lci5qc2AgZm9yIEhUVFAgZXJyb3JzLiBXaGVuIG5vXG4gICAqIGxpc3RlbmVyIGlzIGF0dGFjaGVkIHRvIGVpdGhlciBgZnJhbWV3b3JrLWVycm9yYCBvciBgYWxsLWVycm9yYCxcbiAgICogYWxzbyBzY2hlZHVsZXMgYW4gdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uIHNvIHByb2Nlc3MtbGV2ZWwgYnVnXG4gICAqIHJlcG9ydGVycyAod2hpY2ggc3Vic2NyaWJlIHRvIGB1bmhhbmRsZWRSZWplY3Rpb25gIGJ5IGRlZmF1bHQpIHBpY2tcbiAgICogdGhlIGZhaWx1cmUgdXAg4oCUIGFuZCBBTFNPIHdyaXRlcyBhIG9uZS1saW5lIHN1bW1hcnkgdG8gYHN0ZGVycmAgc29cbiAgICogdGhlIGZhaWx1cmUgaXNuJ3QgY29tcGxldGVseSBzaWxlbnQgb24gTm9kZSAyNCsgd2hlcmUgdGhlIGRlZmF1bHRcbiAgICogYmVoYXZpb3Igb2YgYHVuaGFuZGxlZFJlamVjdGlvbmAgaXMgdG8gdGVybWluYXRlIHRoZSBwcm9jZXNzLiBBblxuICAgKiBhcHAgdGhhdCBzZWVzIGl0cyBzZXJ2ZXIgc3VkZGVubHkgZXhpdCBuZWVkcyBhdCBsZWFzdCBvbmVcbiAgICogYnJlYWRjcnVtYiBpbiB0aGUgbG9ncyB0byBrbm93IEJlYWNvbiB3YXMgdGhlIGNhdXNlOyB0aGUgcHJldmlvdXNcbiAgICogYmVoYXZpb3IgbGVmdCBhIHN0YWNrLW9ubHkgY3Jhc2ggd2l0aCBubyBjb250ZXh0IHR5aW5nIGl0IGJhY2sgdG9cbiAgICogdGhlIGJyb2tlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1wiYmVhY29uLWNvbm5lY3RcIiB8IFwiYmVhY29uLWRpc2Nvbm5lY3RcIn0gYXJncy5zdGFnZSAtIEZhaWx1cmUgc3RhZ2UuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0QmVhY29uRXJyb3Ioe3N0YWdlLCBlcnJvcn0pIHtcbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuX2Vycm9yRXZlbnRzXG4gICAgY29uc3QgaGFzTGlzdGVuZXIgPSBlcnJvckV2ZW50cy5saXN0ZW5lckNvdW50KFwiZnJhbWV3b3JrLWVycm9yXCIpID4gMFxuICAgICAgfHwgZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImFsbC1lcnJvclwiKSA+IDBcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge3N0YWdlfSxcbiAgICAgIGVycm9yXG4gICAgfVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG5cbiAgICBpZiAoIWhhc0xpc3RlbmVyKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG5cblxuICAgICAgY29uc29sZS5lcnJvcihgW3ZlbG9jaW91cyBmcmFtZXdvcmstZXJyb3Igc3RhZ2U9JHtzdGFnZX1dICR7bWVzc2FnZX0g4oCUIHJlZ2lzdGVyIGEgbGlzdGVuZXIgdmlhIGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5vbihcImZyYW1ld29yay1lcnJvclwiLCDigKYpIHRvIHN1cHByZXNzIHRoaXMgc3RkZXJyIGZhbGxiYWNrYClcbiAgICAgIHZvaWQgUHJvbWlzZS5yZWplY3QoZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyB0aGUgYWN0aXZlIEJlYWNvbiBjbGllbnQgKGlmIGFueSkuIFNhZmUgdG8gY2FsbCBtdWx0aXBsZVxuICAgKiB0aW1lcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBkaXNjb25uZWN0QmVhY29uKCkge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuX2JlYWNvbkNsaWVudFxuXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UgPSB1bmRlZmluZWRcblxuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKVxuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IGZhbHNlXG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKGNsaWVudCkgYXdhaXQgY2xpZW50LmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSb3V0ZXMgYSBCZWFjb24tc291cmNlZCBicm9hZGNhc3QgdGhyb3VnaCB0aGUgc2FtZSBkZWxpdmVyeSBjb2RlXG4gICAqIHBhdGggYXMgYSBsb2NhbGx5LW9yaWdpbmF0ZWQgb25lLiBQcmVmZXJzIHRoZSB3b3JrZXJ0aHJlYWQtYXdhcmVcbiAgICogYGJyb2FkY2FzdFYyYCB3aGVuIGFuIEhUVFAgc2VydmVyIGlzIGhvc3Rpbmcgd29ya2VycywgYW5kIGZhbGxzXG4gICAqIGJhY2sgdG8gdGhlIHBlci1wcm9jZXNzIHN1YnNjcmlwdGlvbiBkaXNwYXRjaCBvdGhlcndpc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iZWFjb24vdHlwZXMuanNcIikuQmVhY29uQnJvYWRjYXN0TWVzc2FnZX0gbWVzc2FnZSAtIEJyb2FkY2FzdCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbihtZXNzYWdlKSB7XG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyKHtcbiAgICAgICAgY2hhbm5lbDogbWVzc2FnZS5jaGFubmVsLFxuICAgICAgICBicm9hZGNhc3RQYXJhbXM6IG1lc3NhZ2UuYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICBib2R5OiBtZXNzYWdlLmJvZHksXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXNcbiAgICAgIH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChtZXNzYWdlLmNoYW5uZWwsIG1lc3NhZ2UuYnJvYWRjYXN0UGFyYW1zLCBtZXNzYWdlLmJvZHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWQ+fSAtIFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGFzeW5jIGdldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKCkge1xuICAgIGlmICghdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0xvYWRlclR5cGUgfCB1bmRlZmluZWR9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzIC0gU2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKHNjaGVkdWxlZEJhY2tncm91bmRKb2JzKSB7XG4gICAgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgPSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1haWxlciBiYWNrZW5kLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk1haWxlckJhY2tlbmQgfCB1bmRlZmluZWR9IC0gTWFpbGVyIGJhY2tlbmQuXG4gICAqL1xuICBnZXRNYWlsZXJCYWNrZW5kKCkge1xuICAgIHJldHVybiB0aGlzLl9tYWlsZXJCYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbWFpbGVyIGJhY2tlbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk1haWxlckJhY2tlbmQgfCB1bmRlZmluZWR9IG1haWxlckJhY2tlbmQgLSBNYWlsZXIgYmFja2VuZCwgb3IgdW5kZWZpbmVkIHRvIHJlbW92ZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TWFpbGVyQmFja2VuZChtYWlsZXJCYWNrZW5kKSB7XG4gICAgdGhpcy5fbWFpbGVyQmFja2VuZCA9IG1haWxlckJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dnaW5nIGNvbmZpZ3VyYXRpb24gdGFpbG9yZWQgZm9yIEhUVFAgcmVxdWVzdCBsb2dnaW5nLiBEZWZhdWx0cyBjb25zb2xlIGxvZ2dpbmcgdG8gdHJ1ZSBhbmQgYXBwbGllcyB0aGUgdXNlciBgbG9nZ2luZy5jb25zb2xlYCBmbGFnIG9ubHkgZm9yIHJlcXVlc3QgbG9nZ2luZy5cbiAgICogQHJldHVybnMge1JlcXVpcmVkPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImNvbnNvbGVcIiB8IFwiZmlsZVwiIHwgXCJsZXZlbHNcIj4+ICYgUGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiZGlyZWN0b3J5XCIgfCBcImZpbGVQYXRoXCI+ICYgUGFydGlhbDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJvdXRwdXRzXCIgfCBcImxvZ2dlcnNcIj4+fSAtIFRoZSBodHRwIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEh0dHBMb2dnaW5nQ29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRMb2dnaW5nQ29uZmlndXJhdGlvbih7ZGVmYXVsdENvbnNvbGU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Vudmlyb25tZW50LWhhbmRsZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZW52aXJvbm1lbnQgaGFuZGxlci5cbiAgICovXG4gIGdldEVudmlyb25tZW50SGFuZGxlcigpIHtcbiAgICBpZiAoIXRoaXMuX2Vudmlyb25tZW50SGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gZW52aXJvbm1lbnQgaGFuZGxlciBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvY2FsZUZhbGxiYWNrc1R5cGUgfCB1bmRlZmluZWR9IC0gVGhlIGxvY2FsZSBmYWxsYmFja3MuXG4gICAqL1xuICBnZXRMb2NhbGVGYWxsYmFja3MoKSB7IHJldHVybiB0aGlzLmxvY2FsZUZhbGxiYWNrcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvY2FsZSBmYWxsYmFja3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvY2FsZUZhbGxiYWNrc1R5cGV9IG5ld0xvY2FsZUZhbGxiYWNrcyAtIE5ldyBsb2NhbGUgZmFsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRMb2NhbGVGYWxsYmFja3MobmV3TG9jYWxlRmFsbGJhY2tzKSB7IHRoaXMubG9jYWxlRmFsbGJhY2tzID0gbmV3TG9jYWxlRmFsbGJhY2tzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3RydWN0dXJlIHNxbCBjb25maWcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU3RydWN0dXJlU3FsQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBTdHJ1Y3R1cmUgU1FMIGNvbmZpZy5cbiAgICovXG4gIGdldFN0cnVjdHVyZVNxbENvbmZpZygpIHsgcmV0dXJuIHRoaXMuX3N0cnVjdHVyZVNxbCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIHdyaXRlIHN0cnVjdHVyZSBzcWwuXG4gICAqIEBwYXJhbSB7e3JlYXNvbj86IFwibWlncmF0aW9uXCIgfCBcInNjaGVtYUR1bXBcIn19IFthcmdzXSAtIENhbGwgY29udGV4dCBmb3IgdGhlIHN0cnVjdHVyZSBzcWwgd3JpdGUgZGVjaXNpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3RydWN0dXJlIFNRTCBmaWxlcyBzaG91bGQgYmUgZ2VuZXJhdGVkIGZvciB0aGUgY3VycmVudCBlbnZpcm9ubWVudC5cbiAgICovXG4gIHNob3VsZFdyaXRlU3RydWN0dXJlU3FsKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtyZWFzb24gPSBcIm1pZ3JhdGlvblwifSA9IGFyZ3NcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldFN0cnVjdHVyZVNxbENvbmZpZygpXG4gICAgY29uc3QgZW5hYmxlZEVudmlyb25tZW50cyA9IGNvbmZpZz8uZW5hYmxlZEVudmlyb25tZW50c1xuICAgIGNvbnN0IGRpc2FibGVkRW52aXJvbm1lbnRzID0gY29uZmlnPy5kaXNhYmxlZEVudmlyb25tZW50c1xuXG4gICAgaWYgKHJlYXNvbiA9PT0gXCJzY2hlbWFEdW1wXCIpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZW5hYmxlZEVudmlyb25tZW50cykpIHtcbiAgICAgIHJldHVybiBlbmFibGVkRW52aXJvbm1lbnRzLmluY2x1ZGVzKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShkaXNhYmxlZEVudmlyb25tZW50cykgJiYgZGlzYWJsZWRFbnZpcm9ubWVudHMuaW5jbHVkZXModGhpcy5nZXRFbnZpcm9ubWVudCgpKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCIpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc3RydWN0dXJlIHNxbCBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlN0cnVjdHVyZVNxbENvbmZpZ3VyYXRpb259IHN0cnVjdHVyZVNxbCAtIFN0cnVjdHVyZSBTUUwgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRTdHJ1Y3R1cmVTcWxDb25maWcoc3RydWN0dXJlU3FsKSB7XG4gICAgdGhpcy5fc3RydWN0dXJlU3FsID0gc3RydWN0dXJlU3FsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBsb2NhbGUuXG4gICAqL1xuICBnZXRMb2NhbGUoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLmxvY2FsZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvY2FsZSgpXG4gICAgfSBlbHNlIGlmICh0aGlzLmxvY2FsZSkge1xuICAgICAgcmV0dXJuIHRoaXMubG9jYWxlXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLmdldExvY2FsZXMoKVswXVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGVzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gLSBUaGUgbG9jYWxlcy5cbiAgICovXG4gIGdldExvY2FsZXMoKSB7IHJldHVybiBkaWdnKHRoaXMsIFwibG9jYWxlc1wiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBUaGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzKG5hbWUpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5tb2RlbENsYXNzZXNbbmFtZV1cblxuICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIG1vZGVsIGNsYXNzICR7bmFtZX0gaW4gJHtPYmplY3Qua2V5cyh0aGlzLm1vZGVsQ2xhc3Nlcykuam9pbihcIiwgXCIpfX1gKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzc2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBBIGhhc2ggb2YgYWxsIG1vZGVsIGNsYXNzZXMsIGtleWVkIGJ5IG1vZGVsIG5hbWUsIGFzIHRoZXkgd2VyZSBkZWZpbmVkIGluIHRoZSBjb25maWd1cmF0aW9uLiBUaGlzIGlzIGEgZGlyZWN0IHJlZmVyZW5jZSB0byB0aGUgbW9kZWwgY2xhc3Nlcywgbm90IGEgY29weS5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3NlcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0aW5nLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBUaGUgcGF0aCB0byBhIGNvbmZpZyBmaWxlIHRoYXQgc2hvdWxkIGJlIHVzZWQgZm9yIHRlc3RpbmcuXG4gICAqL1xuICBnZXRUZXN0aW5nKCkgeyByZXR1cm4gdGhpcy5fdGVzdGluZyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRydXN0ZWQgcHJveGllcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSBUcnVzdGVkIHJldmVyc2UgcHJveHkgYWRkcmVzcyByYW5nZXMuXG4gICAqL1xuICBnZXRUcnVzdGVkUHJveGllcygpIHsgcmV0dXJuIHRoaXMuX3RydXN0ZWRQcm94aWVzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJ1c3RlZCBwcm94aWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSB0cnVzdGVkUHJveGllcyAtIFRydXN0ZWQgcmV2ZXJzZSBwcm94eSBhZGRyZXNzIHJhbmdlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRUcnVzdGVkUHJveGllcyh0cnVzdGVkUHJveGllcykgeyB0aGlzLl90cnVzdGVkUHJveGllcyA9IHRydXN0ZWRQcm94aWVzIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIGRhdGFiYXNlIHBvb2wuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbaWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyIHRvIGluaXRpYWxpemUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGluaXRpYWxpemVEYXRhYmFzZVBvb2woaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyAnZGF0YWJhc2UnIHdhcyBnaXZlblwiKVxuICAgIGlmICh0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0pIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlUG9vbCBoYXMgYWxyZWFkeSBiZWVuIGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBQb29sVHlwZSA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sVHlwZShpZGVudGlmaWVyKVxuXG4gICAgdGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdID0gbmV3IFBvb2xUeXBlKHtjb25maWd1cmF0aW9uOiB0aGlzLCBpZGVudGlmaWVyfSlcbiAgICB0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0uc2V0Q3VycmVudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBwb29sIGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2lkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllciB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRhYmFzZSBwb29sIGluaXRpYWxpemVkLlxuICAgKi9cbiAgaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHsgcmV0dXJuIEJvb2xlYW4odGhpcy5kYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgaW5pdGlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBpc0luaXRpYWxpemVkKCkgeyByZXR1cm4gdGhpcy5faXNJbml0aWFsaXplZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBtb2RlbHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplTW9kZWxzKGFyZ3MgPSB7dHlwZTogXCJzZXJ2ZXJcIn0pIHtcbiAgICBjb25zdCBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICBpZiAodGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgY29uc3QgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgICBhd2FpdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gPT09IG1vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uICYmICF0aGlzLl9tb2RlbHNJbml0aWFsaXplZCkge1xuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPT09IGluaXRpYWxpemVNb2RlbHNQcm9taXNlKSB7XG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmluaXRpYWxpemVNb2RlbHMoYXJncylcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc2hvdWxkU2tpcER1bW15TW9kZWxJbml0aWFsaXphdGlvbiA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52LlZFTE9DSU9VU19TS0lQX0RVTU1ZX01PREVMX0lOSVRJQUxJWkFUSU9OID09PSBcIjFcIlxuICAgICAgICAmJiBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5WRUxPQ0lPVVNfQlJPV1NFUl9URVNUUyA9PT0gXCJ0cnVlXCJcbiAgICAgICAgJiYgdGhpcy5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIlxuXG4gICAgICBpZiAoIXNob3VsZFNraXBEdW1teU1vZGVsSW5pdGlhbGl6YXRpb24pIHtcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHMpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplTW9kZWxzKHtjb25maWd1cmF0aW9uOiB0aGlzLCB0eXBlOiBhcmdzLnR5cGV9KVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbml0aWFsaXplUGFja2FnZU1vZGVscyh0aGlzKVxuICAgICAgICBhd2FpdCBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyh0aGlzKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW5pdGlhbGl6ZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzKHRoaXMpXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBlYWNoIGNvbmZpZ3VyZWQgZGF0YWJhc2UgcG9vbCBoYXMgYSBnbG9iYWwgY29ubmVjdGlvbiBhdmFpbGFibGUuXG4gICAqIFVzZWZ1bCB3aGVuIGBnZXRDdXJyZW50Q29ubmVjdGlvbmAgbWlnaHQgYmUgY2FsbGVkIHdpdGhvdXQgYW4gYXN5bmMgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUdsb2JhbENvbm5lY3Rpb25zKCkge1xuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIGF3YWl0IHBvb2wuZW5zdXJlR2xvYmFsQ29ubmVjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFR5cGUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGluaXRpYWxpemUoe3R5cGV9ID0ge3R5cGU6IFwidW5kZWZpbmVkXCJ9KSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlKSByZXR1cm4gdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLl9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZTogdHJ1ZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5fc2h1dGRvd25Qcm9taXNlfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiBmYWxzZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2JlZ2luSW5pdGlhbGl6ZSh7dHlwZX0pXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIG9yIGpvaW5zIGluaXRpYWxpemF0aW9uIGFmdGVyIGxpZmVjeWNsZSBibG9ja2VycyBoYXZlIHNldHRsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU3RhcnR1cCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gR2VuZXJpYyBhcHBsaWNhdGlvbiBwcm9jZXNzIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBzdGFydHVwIHByb21pc2UuXG4gICAqL1xuICBfYmVnaW5Jbml0aWFsaXplKHt0eXBlfSkge1xuICAgIGNvbnN0IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiBmYWxzZSwgdHlwZSwgd2FpdEZvcjogdGhpcy5faW5pdGlhbGl6ZVByb21pc2V9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pc0luaXRpYWxpemVkKSB7XG4gICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgICAgcmV0dXJuIHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgfVxuICAgIC8vIE1lbW9pemUgdGhlIGluLXByb2dyZXNzIGluaXRpYWxpemF0aW9uIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGUgc2FtZVxuICAgIC8vIGJvb3RzdHJhcCBpbnN0ZWFkIG9mIHJhY2luZy4gYF9pc0luaXRpYWxpemVkYCB3YXMgcHJldmlvdXNseSBzZXQgdG8gYHRydWVgXG4gICAgLy8gdXAgZnJvbnQsIHNvIGEgc2Vjb25kIGNhbGxlciAoZS5nLiBhIHBvb2xlZCBydW5uZXIgd2l0aFxuICAgIC8vIGBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSA+IDFgIHN0YXJ0aW5nIHNldmVyYWwgam9icyBvbiBhIGNvbGQgY2hpbGQpIGNvdWxkXG4gICAgLy8gc2tpcCBpbml0aWFsaXphdGlvbiBhbmQgbG9hZCBtb2RlbHMgLyBwZXJmb3JtIGEgam9iIHdoaWxlIHRoZSBmaXJzdCBjYWxsXG4gICAgLy8gd2FzIHN0aWxsIGF3YWl0aW5nIG1vZGVsIGRpc2NvdmVyeSBhbmQgaW5pdGlhbGl6ZXJzLiBNaXJyb3JzIGNvbm5lY3RCZWFjb24uXG4gICAgY29uc3QgaW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9ydW5Jbml0aWFsaXplKHtpbml0aWFsaXphdGlvbkdlbmVyYXRpb24sIHR5cGV9KVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSBpbml0aWFsaXplUHJvbWlzZVxuICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgcmV0dXJuIGluaXRpYWxpemVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIG9uZSBzaGFyZWQgaW5pdGlhbGl6YXRpb24gYmVoaW5kIGFuIGluY29tcGF0aWJsZSBsaWZlY3ljbGUgcGhhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSAtIFdoZXRoZXIgYSBjb21wbGV0ZWQgZmFpbGVkIHNodXRkb3duIHN0aWxsIHBlcm1pdHMgcmVwbGFjZW1lbnQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFJlcGxhY2VtZW50IHByb2Nlc3MgdHlwZS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBhcmdzLndhaXRGb3IgLSBMaWZlY3ljbGUgcGhhc2UgdGhhdCBtdXN0IHNldHRsZSBmaXJzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2hhcmVkIHF1ZXVlZCBzdGFydHVwIHByb21pc2UuXG4gICAqL1xuICBfcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHR5cGUsIHdhaXRGb3J9KSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlKSByZXR1cm4gdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcblxuICAgIGNvbnN0IHF1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB3YWl0Rm9yfSlcblxuICAgICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSA9PT0gd2FpdEZvcikgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IHdhaXRGb3IpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNodXRkb3duUHJvbWlzZSA9IHRoaXMuX3NodXRkb3duUHJvbWlzZVxuXG4gICAgICBpZiAoc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiB0cnVlLCB3YWl0Rm9yOiBzaHV0ZG93blByb21pc2V9KVxuICAgICAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlID09PSBzaHV0ZG93blByb21pc2UpIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgJiYgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uICE9PSB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICBjb25zdCBzdGFsZUluaXRpYWxpemVQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcblxuICAgICAgICBhd2FpdCBzdGFsZUluaXRpYWxpemVQcm9taXNlXG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gc3RhbGVJbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fYmVnaW5Jbml0aWFsaXplKHt0eXBlfSlcbiAgICB9KSgpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgdGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSBxdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuXG4gICAgcmV0dXJuIHF1ZXVlZEluaXRpYWxpemVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGEgbGlmZWN5Y2xlIHBoYXNlIGJlZm9yZSBxdWV1ZWQgaW5pdGlhbGl6YXRpb24gcHJvY2VlZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2FpdCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jb250aW51ZUFmdGVyV2FpdEZhaWx1cmUgLSBXaGV0aGVyIHJlcGxhY2VtZW50IHN0YXJ0dXAgcmVtYWlucyBhdmFpbGFibGUgYWZ0ZXIgYSBmYWlsZWQgcGhhc2UuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gYXJncy53YWl0Rm9yIC0gTGlmZWN5Y2xlIHBoYXNlIHRoYXQgbXVzdCBzZXR0bGUgZmlyc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcXVldWVkIGluaXRpYWxpemF0aW9uIG1heSBjb250aW51ZS5cbiAgICovXG4gIGFzeW5jIF93YWl0Rm9ySW5pdGlhbGl6ZUJsb2NrZXIoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgd2FpdEZvcn0pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd2FpdEZvclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIWNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgYXRvbWljIGZyYW1ld29yayBhbmQgYXBwbGljYXRpb24gaW5pdGlhbGl6YXRpb24gYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbml0aWFsaXphdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uIC0gRnJhbWV3b3JrIG1vZGVsIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBHZW5lcmljIGFwcGxpY2F0aW9uIHByb2Nlc3MgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBpbml0aWFsaXplZC5cbiAgICovXG4gIGFzeW5jIF9ydW5Jbml0aWFsaXplKHtpbml0aWFsaXphdGlvbkdlbmVyYXRpb24sIHR5cGV9KSB7XG4gICAgY29uc3Qgc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUgPSAhdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZFxuXG4gICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB7XG4gICAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICAgIGluc3RhbmNlSWQ6IG5ldyBVVUlEKDQpLmZvcm1hdCgpLFxuICAgICAgICB0eXBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemVNb2RlbHMoe3R5cGV9KVxuXG4gICAgICAvLyBNb2RlbCBpbml0aWFsaXphdGlvbiBjYW4gYmUgaW52YWxpZGF0ZWQgYnkgYSBjb25jdXJyZW50IGNvbm5lY3Rpb24gY2xvc2UuXG4gICAgICAvLyBJZiBtb2RlbHMgYXJlIG5vdCByZWFkeSwgc3RvcCB3aXRob3V0IG1hcmtpbmcgdGhlIGNvbmZpZ3VyYXRpb24gaW5pdGlhbGl6ZWRcbiAgICAgIC8vIHNvIHRoZSBuZXh0IGNhbGxlciByZXRyaWVzIGEgZnVsbCBib290c3RyYXAuXG4gICAgICBpZiAodGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gIT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiB8fCAhdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuYXV0b0Rpc2NvdmVyUmVzb3VyY2VzKHRoaXMpXG4gICAgICB0aGlzLl9tZXJnZURpc2NvdmVyZWRBYmlsaXR5UmVzb3VyY2VzKClcbiAgICAgIHRoaXMuX3ZhbGlkYXRlUmVzb3VyY2VSZWxhdGlvbnNoaXBzT25Nb2RlbHMoKVxuXG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUgJiYgdGhpcy5faW5pdGlhbGl6ZXJzKSB7XG4gICAgICAgIGNvbnN0IGluaXRpYWxpemVycyA9IGF3YWl0IHRoaXMuX2luaXRpYWxpemVycyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgICAgIGNvbnN0IHtyZXF1aXJlQ29udGV4dCwgLi4ucmVzdEFyZ3N9ID0gaW5pdGlhbGl6ZXJzXG5cbiAgICAgICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgICAgICBpZiAocmVxdWlyZUNvbnRleHQpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGluaXRpYWxpemVyS2V5IG9mIHJlcXVpcmVDb250ZXh0LmtleXMoKSkge1xuICAgICAgICAgICAgY29uc3QgSW5pdGlhbGl6ZXJDbGFzcyA9IHJlcXVpcmVDb250ZXh0KGluaXRpYWxpemVyS2V5KS5kZWZhdWx0XG4gICAgICAgICAgICBjb25zdCBwcm9jZXNzQ29udGV4dCA9IHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHRcblxuICAgICAgICAgICAgaWYgKCFwcm9jZXNzQ29udGV4dCkgdGhyb3cgbmV3IEVycm9yKFwiQXBwbGljYXRpb24gcHJvY2VzcyBjb250ZXh0IGlzIG5vdCBhdmFpbGFibGUgZHVyaW5nIGluaXRpYWxpemVyIHN0YXJ0dXBcIilcblxuICAgICAgICAgICAgY29uc3QgaW5pdGlhbGl6ZXJJbnN0YW5jZSA9IG5ldyBJbml0aWFsaXplckNsYXNzKHtjb25maWd1cmF0aW9uOiB0aGlzLCBwcm9jZXNzQ29udGV4dCwgdHlwZX0pXG5cbiAgICAgICAgICAgIGF3YWl0IGluaXRpYWxpemVySW5zdGFuY2UucnVuKClcbiAgICAgICAgICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMucHVzaChpbml0aWFsaXplckluc3RhbmNlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWQgPSB0cnVlXG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkge1xuICAgICAgICBsZXQgdGVhcmRvd25FcnJvclxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKClcbiAgICAgICAgfSBjYXRjaCAoY2F1Z2h0VGVhcmRvd25FcnJvcikge1xuICAgICAgICAgIHRlYXJkb3duRXJyb3IgPSBjYXVnaHRUZWFyZG93bkVycm9yXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGVhcmRvd25FcnJvciBpbnN0YW5jZW9mIEFnZ3JlZ2F0ZUVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW2Vycm9yLCAuLi50ZWFyZG93bkVycm9yLmVycm9yc10sXG4gICAgICAgICAgICBcIkFwcGxpY2F0aW9uIHByb2Nlc3Mgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRlYXJkb3duRXJyb3IgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgdGVhcmRvd25FcnJvcl0sXG4gICAgICAgICAgICBcIkFwcGxpY2F0aW9uIHByb2Nlc3Mgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNJbml0aWFsaXplZCAmJiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biBldmVyeSBzdWNjZXNzZnVsbHkgc3RhcnRlZCBpbml0aWFsaXplciBpbiByZXZlcnNlIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRlYXJkb3duIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3RlYXJkb3duU3VjY2Vzc2Z1bEluaXRpYWxpemVycygpIHtcbiAgICBjb25zdCBzdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5zcGxpY2UoMCkucmV2ZXJzZSgpXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQXBwbGljYXRpb24gaW5pdGlhbGl6ZXIgdGVhcmRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5tYXAoKGluaXRpYWxpemVyKSA9PiBhc3luYyAoKSA9PiBhd2FpdCBpbml0aWFsaXplci50ZWFyZG93bigpKVxuICAgIH0pXG4gIH1cblxuICAvKiogQ2xlYXJzIGFwcGxpY2F0aW9uLW93bmVkIGxpZmVjeWNsZSBzdGF0ZSBhZnRlciBldmVyeSB0ZWFyZG93biBhdHRlbXB0LiAqL1xuICBfcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpIHtcbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICB0aGlzLl9hcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycyA9IFtdXG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biB0aGUgY3VycmVudCBhcHBsaWNhdGlvbiBsaWZlY3ljbGUgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gRXhhY3Qgc2hhcmVkIHNodXRkb3duIHByb21pc2UuXG4gICAqL1xuICBzaHV0ZG93bigpIHtcbiAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlKSByZXR1cm4gdGhpcy5fc2h1dGRvd25Qcm9taXNlXG5cbiAgICBjb25zdCBpbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgY29uc3Qgc2h1dGRvd25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChpbml0aWFsaXplUHJvbWlzZSkgYXdhaXQgaW5pdGlhbGl6ZVByb21pc2VcbiAgICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKClcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSBpbml0aWFsaXplUHJvbWlzZSkge1xuICAgICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KSgpXG5cbiAgICB0aGlzLl9zaHV0ZG93blByb21pc2UgPSBzaHV0ZG93blByb21pc2VcblxuICAgIHJldHVybiBzaHV0ZG93blByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhhdCByZXNvdXJjZS1kZWZpbmVkIHJlbGF0aW9uc2hpcHMgYXJlIGFsc28gZGVmaW5lZCBvbiB0aGUgY29ycmVzcG9uZGluZyBtb2RlbCBjbGFzc2VzLlxuICAgKiBUaHJvd3MgYW4gZXJyb3IgaWYgYSByZWxhdGlvbnNoaXAgaXMgZGVmaW5lZCBvbiBhIHJlc291cmNlIGJ1dCBtaXNzaW5nIGZyb20gdGhlIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJlc291cmNlUmVsYXRpb25zaGlwc09uTW9kZWxzKCkge1xuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5fYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICAgIGZvciAoY29uc3QgW21vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZXMpKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlnPy5yZWxhdGlvbnNoaXBzKSBjb250aW51ZVxuXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNvdXJjZUNvbmZpZy5yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBkZWZpbmVzIHJlbGF0aW9uc2hpcHMgYXMgYW4gb2JqZWN0LiBVc2UgYW4gYXJyYXkgaW5zdGVhZDogc3RhdGljIHJlbGF0aW9uc2hpcHMgPSAke0pTT04uc3RyaW5naWZ5KE9iamVjdC5rZXlzKHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUmVsYXRpb25zaGlwcyA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpXG5cbiAgICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgICBpZiAoIShyZWxhdGlvbnNoaXBOYW1lIGluIGV4aXN0aW5nUmVsYXRpb25zaGlwcykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYFJlc291cmNlIGZvciAke21vZGVsTmFtZX0gZGVmaW5lcyByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgYnV0ICR7bW9kZWxOYW1lfSBtb2RlbCBkb2VzIG5vdC4gYCArXG4gICAgICAgICAgICAgIGBBZGQgJHttb2RlbE5hbWV9LmJlbG9uZ3NUbyhcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiwgLi4uKSBvciB0aGUgYXBwcm9wcmlhdGUgcmVsYXRpb25zaGlwIGNhbGwgb24gdGhlIG1vZGVsIGNsYXNzLmBcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZWdpc3Rlck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWxDbGFzc2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldID0gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnQoKSB7XG4gICAgc2V0Q3VycmVudENvbmZpZ3VyYXRpb24odGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb3V0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSByb3V0ZXMuXG4gICAqL1xuICBnZXRSb3V0ZXMoKSB7IHJldHVybiB0aGlzLl9yb3V0ZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCByb3V0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdH0gbmV3Um91dGVzIC0gTmV3IHJvdXRlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Um91dGVzKG5ld1JvdXRlcykge1xuICAgIHRoaXMuX3JvdXRlcyA9IG5ld1JvdXRlc1xuICAgIHRoaXMuX2FwcGx5Um91dGVNb3VudHMobmV3Um91dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYW55IGByb3V0ZS5tb3VudCguLi4pYCByZWdpc3RyYXRpb25zIGZyb20gdGhlIHJvdXRlcyBmaWxlIGJ5IGxldHRpbmdcbiAgICogZWFjaCBtb3VudGFibGUgcmVnaXN0ZXIgaXRzIHJvdXRlcyAodHlwaWNhbGx5IHJvdXRlLXJlc29sdmVyIGhvb2tzKSBhZ2FpbnN0XG4gICAqIHRoaXMgY29uZmlndXJhdGlvbi4gR3VhcmRlZCBzbyByZXBlYXRlZCBzZXRSb3V0ZXMgY2FsbHMgd2l0aCB0aGUgc2FtZSByb3V0ZXNcbiAgICogZG9uJ3QgcmVnaXN0ZXIgYSBtb3VudCBtb3JlIHRoYW4gb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0fSBuZXdSb3V0ZXMgLSBSb3V0ZXMgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hcHBseVJvdXRlTW91bnRzKG5ld1JvdXRlcykge1xuICAgIGlmICghbmV3Um91dGVzIHx8IHR5cGVvZiBuZXdSb3V0ZXMuZ2V0TW91bnRzICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBtb3VudCBvZiBuZXdSb3V0ZXMuZ2V0TW91bnRzKCkpIHtcbiAgICAgIGlmICh0aGlzLl9hcHBsaWVkUm91dGVNb3VudHMuaGFzKG1vdW50KSkgY29udGludWVcblxuICAgICAgdGhpcy5fYXBwbGllZFJvdXRlTW91bnRzLmFkZChtb3VudClcbiAgICAgIG1vdW50Lm1vdW50YWJsZS5tb3VudEludG8oe2NvbmZpZ3VyYXRpb246IHRoaXMsIC4uLm1vdW50Lm9wdGlvbnN9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIHBsdWdpbi9saWJyYXJ5IHJvdXRlcyB1c2luZyBhIGxpZ2h0d2VpZ2h0IHJvdXRlIERTTCBiYWNrZWQgYnkgcm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqIEBwYXJhbSB7KHJvdXRlczogaW1wb3J0KFwiLi9yb3V0ZXMvcGx1Z2luLXJvdXRlcy5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkfSBjYWxsYmFjayAtIFJvdXRlcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcm91dGVzKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcGx1Z2luUm91dGVzID0gbmV3IFBsdWdpblJvdXRlcyh7Y29uZmlndXJhdGlvbjogdGhpc30pXG5cbiAgICBjYWxsYmFjayhwbHVnaW5Sb3V0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJhbnNsYXRvci5cbiAgICogQHBhcmFtIHsoYXJnMTogc3RyaW5nLCBhcmcyOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWQpID0+IHN0cmluZ30gY2FsbGJhY2sgLSBUcmFuc2xhdG9yIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUcmFuc2xhdG9yKGNhbGxiYWNrKSB7IHRoaXMuX3RyYW5zbGF0b3IgPSBjYWxsYmFjayB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbXNnSUQgLSBNc2cgaWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJnc10gLSBUcmFuc2xhdG9yIG9wdGlvbnMgYW5kIHZhcmlhYmxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKi9cbiAgX2RlZmF1bHRUcmFuc2xhdG9yKG1zZ0lELCBhcmdzKSB7XG4gICAgdGhpcy5fY29uZmlndXJlRGVmYXVsdFRyYW5zbGF0b3IoKVxuXG4gICAgY29uc3QgdHJhbnNsYXRlQXJncyA9IGFyZ3MgPyB7Li4uYXJnc30gOiB1bmRlZmluZWRcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSB0cmFuc2xhdGVBcmdzPy5kZWZhdWx0VmFsdWVcbiAgICBjb25zdCBsb2NhbGVzID0gdHJhbnNsYXRlQXJncz8ubG9jYWxlc1xuXG4gICAgaWYgKHRyYW5zbGF0ZUFyZ3MpIHtcbiAgICAgIGRlbGV0ZSB0cmFuc2xhdGVBcmdzLmRlZmF1bHRWYWx1ZVxuICAgICAgZGVsZXRlIHRyYW5zbGF0ZUFyZ3MubG9jYWxlc1xuICAgIH1cblxuICAgIGNvbnN0IHZhcmlhYmxlcyA9IHRyYW5zbGF0ZUFyZ3MgJiYgT2JqZWN0LmtleXModHJhbnNsYXRlQXJncykubGVuZ3RoID4gMCA/IHRyYW5zbGF0ZUFyZ3MgOiB1bmRlZmluZWRcblxuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKClcbiAgICBjb25zdCBwcmVmZXJyZWRMb2NhbGVzID0gbG9jYWxlcyB8fCAobG9jYWxlID8gdW5kZWZpbmVkIDogW10pXG4gICAgY29uc3QgbWVzc2FnZSA9IHRyYW5zbGF0ZShtc2dJRCwgdmFyaWFibGVzLCBwcmVmZXJyZWRMb2NhbGVzKVxuXG4gICAgaWYgKG1lc3NhZ2UgPT09IG1zZ0lEICYmIGRlZmF1bHRWYWx1ZSkgcmV0dXJuIHRyYW5zbGF0ZShkZWZhdWx0VmFsdWUsIHZhcmlhYmxlcywgW10pXG5cbiAgICByZXR1cm4gbWVzc2FnZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0b3IuXG4gICAqIEByZXR1cm5zIHsobXNnSUQ6IHN0cmluZywgYXJncz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gc3RyaW5nfSAtIFRoZSBjb25maWd1cmVkIHRyYW5zbGF0b3IuXG4gICAqL1xuICBnZXRUcmFuc2xhdG9yKCkge1xuICAgIGlmICh0aGlzLl90cmFuc2xhdG9yKSByZXR1cm4gdGhpcy5fdHJhbnNsYXRvclxuXG4gICAgaWYgKCF0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kKSB7XG4gICAgICB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kID0gdGhpcy5fZGVmYXVsdFRyYW5zbGF0b3IuYmluZCh0aGlzKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvckJvdW5kXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmUgZGVmYXVsdCB0cmFuc2xhdG9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBDb25maWd1cmUgZ2V0dGV4dCBkZWZhdWx0cyBmb3IgdGhpcyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX2NvbmZpZ3VyZURlZmF1bHRUcmFuc2xhdG9yKCkge1xuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKClcblxuICAgIGdldHRleHRDb25maWcuc2V0TG9jYWxlKGxvY2FsZSB8fCBcIlwiKVxuXG4gICAgY29uc3QgZmFsbGJhY2tzID0gbG9jYWxlID8gdGhpcy5nZXRMb2NhbGVGYWxsYmFja3MoKT8uW2xvY2FsZV0gOiBbXVxuXG4gICAgZ2V0dGV4dENvbmZpZy5zZXRGYWxsYmFja3MoZmFsbGJhY2tzIHx8IFtdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lIG9mZnNldCBtaW51dGVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRoZSB0aW1lem9uZSBvZmZzZXQgaW4gbWludXRlcy5cbiAgICovXG4gIGdldFRpbWV6b25lT2Zmc2V0TWludXRlcygpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjb25zdCBjb25maWd1cmVkT2Zmc2V0ID0gdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzKClcblxuICAgICAgaWYgKHR5cGVvZiBjb25maWd1cmVkT2Zmc2V0ID09PSBcIm51bWJlclwiKSByZXR1cm4gY29uZmlndXJlZE9mZnNldFxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VGltZXpvbmVPZmZzZXQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWUgem9uZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXRUaW1lWm9uZSgpIHtcbiAgICBjb25zdCB0aW1lWm9uZSA9IHR5cGVvZiB0aGlzLl90aW1lWm9uZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRoaXMuX3RpbWVab25lKClcbiAgICAgIDogdGhpcy5fdGltZVpvbmVcblxuICAgIGlmICh0aW1lWm9uZSA9PT0gdW5kZWZpbmVkIHx8IHRpbWVab25lID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJjb25maWd1cmF0aW9uIHRpbWVab25lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGV2ZW50cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWV2ZW50cy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0RXZlbnRzKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWV2ZW50cy5qc1wiKS5kZWZhdWx0fSB3ZWJzb2NrZXRFdmVudHMgLSBXZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRXZWJzb2NrZXRFdmVudHMod2Vic29ja2V0RXZlbnRzKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0RXZlbnRzID0gd2Vic29ja2V0RXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUGVyLXByb2Nlc3MgcmVnaXN0cnkgb2YgY2hhbm5lbCBzdWJzY3JpYmVycyB1c2VkIGJ5IHdvcmtlciBjb2RlIHRoYXRcbiAgICogbmVlZHMgdG8gcmVhY3QgdG8gZXZlbnRzIGJyb2FkY2FzdCB2aWEgYHdlYnNvY2tldEV2ZW50c0hvc3QucHVibGlzaCguLi4pYFxuICAgKiB3aXRob3V0IGhvbGRpbmcgYW4gYWN0dWFsIHdlYnNvY2tldCBzZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpYmVycy5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjaGFubmVsIHN1YnNjcmliZXJzIHJlZ2lzdHJ5LlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKCkge1xuICAgIGlmICghdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKSB7XG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMgPSBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGBWZWxvY2lvdXNXZWJzb2NrZXRDb25uZWN0aW9uYCBzdWJjbGFzcyB1bmRlciBhIG5hbWUuXG4gICAqIENsaWVudHMgdGhhdCBzZW5kIGB7dHlwZTogXCJjb25uZWN0aW9uLW9wZW5cIiwgY29ubmVjdGlvblR5cGU6IG5hbWV9YFxuICAgKiB3aWxsIGhhdmUgdGhpcyBjbGFzcyBpbnN0YW50aWF0ZWQgZm9yIHRoZWlyIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2xpZW50LWZhY2luZyBjb25uZWN0aW9uIHR5cGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0fSBDb25uZWN0aW9uQ2xhc3MgLSBXZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlcldlYnNvY2tldENvbm5lY3Rpb24obmFtZSwgQ29ubmVjdGlvbkNsYXNzKSB7XG4gICAgaWYgKCFuYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25uZWN0aW9uIG5hbWUgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIUNvbm5lY3Rpb25DbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbkNsYXNzIGlzIHJlcXVpcmVkXCIpXG4gICAgdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMuc2V0KG5hbWUsIENvbm5lY3Rpb25DbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25uZWN0aW9uIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBSZWdpc3RlcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzZXMuZ2V0KG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxgIHN1YmNsYXNzIHVuZGVyIGEgbmFtZS5cbiAgICogQ2xpZW50cyBzdWJzY3JpYmUgdmlhIGB7dHlwZTogXCJjaGFubmVsLXN1YnNjcmliZVwiLCBjaGFubmVsVHlwZTogbmFtZSwgLi4ufWAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2xpZW50LWZhY2luZyBjaGFubmVsIHR5cGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBDaGFubmVsQ2xhc3MgLSBXZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlcldlYnNvY2tldENoYW5uZWwobmFtZSwgQ2hhbm5lbENsYXNzKSB7XG4gICAgaWYgKCFuYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJDaGFubmVsIG5hbWUgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIUNoYW5uZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ2hhbm5lbENsYXNzIGlzIHJlcXVpcmVkXCIpXG4gICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMuc2V0KG5hbWUsIENoYW5uZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY2hhbm5lbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgbmFtZSB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBSZWdpc3RlcmVkIHdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0Q2hhbm5lbENsYXNzKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbENsYXNzZXMuZ2V0KG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgbGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiBpbiB0aGUgZ2xvYmFsIHJvdXRpbmcgcmVnaXN0cnkuXG4gICAqIENhbGxlZCBieSB0aGUgc2Vzc2lvbiB3aGVuIGBjYW5TdWJzY3JpYmUoKWAgcmVzb2x2ZXMgdHJ1dGh5OyB0aGVcbiAgICogc2Vzc2lvbiBjYWxscyBgX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uYCBvbiB1bnN1YnNjcmliZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgdXNlZCBhcyB0aGUgcm91dGluZyBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBzdWJzY3JpcHRpb24gLSBMaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIHRvIHJlZ2lzdGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb24obmFtZSwgc3Vic2NyaXB0aW9uKSB7XG4gICAgbGV0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHtcbiAgICAgIGJ1Y2tldCA9IG5ldyBTZXQoKVxuICAgICAgdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuc2V0KG5hbWUsIGJ1Y2tldClcbiAgICB9XG5cbiAgICBidWNrZXQuYWRkKHN1YnNjcmlwdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVucmVnaXN0ZXIgd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSB1c2VkIGFzIHRoZSByb3V0aW5nIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIExpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gdG8gcmVtb3ZlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF91bnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihuYW1lLCBzdWJzY3JpcHRpb24pIHtcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5nZXQobmFtZSlcblxuICAgIGlmICghYnVja2V0KSByZXR1cm5cblxuICAgIGJ1Y2tldC5kZWxldGUoc3Vic2NyaXB0aW9uKVxuXG4gICAgaWYgKGJ1Y2tldC5zaXplID09PSAwKSB7XG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5kZWxldGUobmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsaXZlcnMgYGJvZHlgIHRvIGV2ZXJ5IGxpdmUgc3Vic2NyaWJlciBvZiBgbmFtZWAgd2hvc2VcbiAgICogYG1hdGNoZXMoYnJvYWRjYXN0UGFyYW1zKWAgcmV0dXJucyB0cnVlLiBQdXJlIHJvdXRpbmcg4oCUIG5vIGF1dGhcbiAgICogcmUtY2hlY2ssIG5vIHBlcnNpc3RlbmNlLiBTdWJzY3JpYmVycyB3aG8gd2VyZSBhZG1pdHRlZCBieVxuICAgKiBgY2FuU3Vic2NyaWJlKClgIGNvbnRpbnVlIHRvIHJlY2VpdmUgYnJvYWRjYXN0cyB1bnRpbCB0aGV5XG4gICAqIHVuc3Vic2NyaWJlIG9yIHRoZSBzZXNzaW9uIGVuZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXNcbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keVxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBncmFjZSBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEdyYWNlIHBlcmlvZCAoc2Vjb25kcykgYmVmb3JlIGEgcGF1c2VkIFdTIHNlc3Npb24gaXMgdG9ybiBkb3duLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcygpIHsgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBoZWFydGJlYXQgc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBJbnRlcnZhbCAoc2Vjb25kcykgYmV0d2VlbiBzZXJ2ZXLihpJjbGllbnQgaGVhcnRiZWF0IHBpbmdzOyAwIGRpc2FibGVzIHJlYXBpbmcuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcygpIHsgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzIH1cblxuICAvKipcbiAgICogR2V0cyBwZXItc2Vzc2lvbiBXZWJTb2NrZXQgaW5ib3VuZCBtZXNzYWdlIHF1ZXVlIGxpbWl0cy5cbiAgICogQHJldHVybnMge3ttYXhCeXRlczogbnVtYmVyLCBtYXhNZXNzYWdlczogbnVtYmVyfX0gLSBQZXItc2Vzc2lvbiBpbmJvdW5kIHF1ZXVlIGhpZ2gtd2F0ZXIgbWFya3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRJbmJvdW5kUXVldWVMaW1pdHMoKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLmh0dHBTZXJ2ZXIud2Vic29ja2V0SW5ib3VuZFF1ZXVlXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWF4Qnl0ZXM6IHF1ZXVlLm1heFBlbmRpbmdCeXRlcyxcbiAgICAgIG1heE1lc3NhZ2VzOiBxdWV1ZS5tYXhQZW5kaW5nTWVzc2FnZXNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBwZXItY2xpZW50IFdlYlNvY2tldCBvdXRib3VuZCBxdWV1ZSBsaW1pdHMuXG4gICAqIEByZXR1cm5zIHt7bWF4Qnl0ZXM6IG51bWJlciwgbWF4RnJhbWVzOiBudW1iZXJ9fSAtIFBlci1jbGllbnQgb3V0Ym91bmQgcXVldWUgaGlnaC13YXRlciBtYXJrcy5cbiAgICovXG4gIGdldFdlYnNvY2tldE91dGJvdW5kUXVldWVMaW1pdHMoKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLmh0dHBTZXJ2ZXIud2Vic29ja2V0T3V0Ym91bmRRdWV1ZVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1heEJ5dGVzOiBxdWV1ZS5tYXhQZW5kaW5nQnl0ZXMsXG4gICAgICBtYXhGcmFtZXM6IHF1ZXVlLm1heFBlbmRpbmdGcmFtZXNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgd3JhcHBlciBpbnZva2VkIGFyb3VuZCBldmVyeSBXUy1ib3JuZSByZXF1ZXN0IC9cbiAgICogY29ubmVjdGlvbiBtZXNzYWdlIC8gY2hhbm5lbCBkaXNwYXRjaC4gVGhlIHdyYXBwZXIgcmVjZWl2ZXMgdGhlXG4gICAqIHNlc3Npb24gYW5kIGEgYG5leHRgIGNhbGxiYWNrOyBpdCBtdXN0IGNhbGwgYG5leHQoKWAgdG8gcnVuIHRoZVxuICAgKiBoYW5kbGVyLiBVc2UgaXQgdG8gc2V0IHVwIEFzeW5jTG9jYWxTdG9yYWdlIHBlciByZXF1ZXN0LlxuICAgKiBAcGFyYW0geygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSB3cmFwcGVyIC0gUGVyLW1lc3NhZ2Ugc2Vzc2lvbi1jb250ZXh0IHdyYXBwZXIsIG9yIG51bGwgdG8gZGlzYWJsZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRBcm91bmRSZXF1ZXN0KHdyYXBwZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0ID0gd3JhcHBlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBhcm91bmQgcmVxdWVzdC5cbiAgICogQHJldHVybnMgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAtIFdlYnNvY2tldCBzZXNzaW9uIHdyYXBwZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRBcm91bmRSZXF1ZXN0KCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgd3JhcHBlciBpbnZva2VkIGFyb3VuZCBldmVyeSBjb250cm9sbGVyIGFjdGlvbiDigJQgYm90aFxuICAgKiBIVFRQIGFuZCBXUy1ib3JuZS4gUmVjZWl2ZXMgYHtyZXF1ZXN0LCByZXNwb25zZSwgbmV4dH1gIGFuZCBtdXN0XG4gICAqIGNhbGwgYG5leHQoKWAgdG8gcnVuIHRoZSBhY3Rpb24uIFVzZSBpdCBmb3IgcGVyLXJlcXVlc3QgY29udGV4dFxuICAgKiBsaWtlIEFzeW5jTG9jYWxTdG9yYWdlLXNjb3BlZCBsb2NhbGUgb3IgdHJhY2luZy5cbiAgICogQHBhcmFtIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gd3JhcHBlciAtIFBlci1hY3Rpb24gcmVxdWVzdC1jb250ZXh0IHdyYXBwZXIsIG9yIG51bGwgdG8gZGlzYWJsZSBpdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRBcm91bmRBY3Rpb24od3JhcHBlcikge1xuICAgIHRoaXMuX2Fyb3VuZEFjdGlvbiA9IHdyYXBwZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcm91bmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7KChjb250ZXh0OiB7cmVxdWVzdDogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgcmVzcG9uc2U6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD59KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gSFRUUCByZXF1ZXN0IHdyYXBwZXIuXG4gICAqL1xuICBnZXRBcm91bmRBY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Fyb3VuZEFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhbiBpZGVudGl0eSByZXNvbHZlciBjYWxsZWQgb25jZSBhdCBwYXVzZSB0aW1lIGFuZCBvbmNlXG4gICAqIGF0IHJlc3VtZSB0aW1lLiBUaGUgcmVzb2x2ZXIgcmVjZWl2ZXMgdGhlIHNlc3Npb24gYW5kIHJldHVybnMgYW55XG4gICAqIHZhbHVlIHRoYXQgaWRlbnRpZmllcyB0aGUgYXV0aGVudGljYXRlZCBjYWxsZXIg4oCUIHR5cGljYWxseSBhXG4gICAqIGB1c2VySWRgIHJlYWQgZnJvbSB0aGUgc2Vzc2lvbidzIHVwZ3JhZGUtcmVxdWVzdCBjb29raWUuIFZlbG9jaW91c1xuICAgKiBjYXB0dXJlcyB0aGUgcGF1c2UtdGltZSB2YWx1ZSBvbiB0aGUgcGF1c2VkIHNlc3Npb24gYW5kIGNvbXBhcmVzXG4gICAqIGl0IHZpYSBgPT09YCAob3IgZGVlcC1lcXVhbGl0eSBmb3IgcGxhaW4gb2JqZWN0cykgdG8gdGhlIGZyZXNoXG4gICAqIHJlc3VtZS10aW1lIHZhbHVlLiBJZiB0aGV5IGRpZmZlciwgdGhlIHJlc3VtZSBpcyByZWplY3RlZCB3aXRoXG4gICAqIGBzZXNzaW9uLWdvbmVgIGFuZCB0aGUgcGF1c2VkIHNlc3Npb24gaXMgZGVzdHJveWVkIHNvIGEgc2lnbmVkLW91dFxuICAgKiBvciByZS1hdXRoZW50aWNhdGVkIGNsaWVudCBjYW5ub3QgcmVjbGFpbSBhbm90aGVyIHVzZXIncyBzdGF0ZS5cbiAgICpcbiAgICogUmV0dXJuIGBudWxsYC9gdW5kZWZpbmVkYCB0byBtZWFuIFwibm8gaWRlbnRpdHlcIiDigJQgcmVzdW1lcyBzdGlsbFxuICAgKiBzdWNjZWVkIGlmIHBhdXNlIGFuZCByZXN1bWUgYm90aCByZXNvbHZlIHRvIGEgbnVsbGlzaCB2YWx1ZS5cbiAgICogQHBhcmFtIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgbnVsbH0gcmVzb2x2ZXIgLSBBdXRoZW50aWNhdGVkLWNhbGxlciBpZGVudGl0eSByZXNvbHZlciwgb3IgbnVsbCB0byBkaXNhYmxlIGlkZW50aXR5IGNoZWNrcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgc2Vzc2lvbiBpZGVudGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMgeygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSAtIFRoZSBjb25maWd1cmVkIGlkZW50aXR5IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IHNlc3Npb24gZ3JhY2Ugc2Vjb25kcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBHcmFjZSBwZXJpb2QgYmVmb3JlIGEgcGF1c2VkIHNlc3Npb24gZXhwaXJlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzKHNlY29uZHMpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShzZWNvbmRzKSB8fCBzZWNvbmRzIDwgMCkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGdyYWNlIHNlY29uZHM6ICR7c2Vjb25kc31gKVxuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMgPSBzZWNvbmRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IHNlc3Npb24gaGVhcnRiZWF0IHNlY29uZHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzZWNvbmRzIC0gSGVhcnRiZWF0IGludGVydmFsLCB3aXRoIHplcm8gZGlzYWJsaW5nIHJlYXBpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0V2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMoc2Vjb25kcykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNlY29uZHMpIHx8IHNlY29uZHMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgaGVhcnRiZWF0IHNlY29uZHM6ICR7c2Vjb25kc31gKVxuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzID0gc2Vjb25kc1xuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIGEgc2Vzc2lvbiBpbnRvIHRoZSBwYXVzZWQgcmVnaXN0cnkgYW5kIHN0YXJ0cyB0aGUgZ3JhY2VcbiAgICogdGltZXIuIFdoZW4gdGhlIHRpbWVyIGZpcmVzLCB0aGUgc2Vzc2lvbidzIHBlcm1hbmVudCB0ZWFyZG93blxuICAgKiBob29rIGlzIGludm9rZWQuIENhbGxlZCBieSB0aGUgc2Vzc2lvbiBpdHNlbGYgZnJvbSBgX2hhbmRsZUNsb3NlYFxuICAgKiB3aGVuIHRoZXJlIGlzIHJlc3VtYWJsZSBzdGF0ZSAobGl2ZSBDb25uZWN0aW9ucyAvIENoYW5uZWwgc3VicykuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdH0gc2Vzc2lvbiAtIFJlc3VtYWJsZSBzZXNzaW9uIHRvIHJldGFpbiBkdXJpbmcgaXRzIGdyYWNlIHBlcmlvZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcGF1c2VXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb24pIHtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBzZXNzaW9uLnNlc3Npb25JZFxuXG4gICAgaWYgKCFzZXNzaW9uSWQpIHRocm93IG5ldyBFcnJvcihcIlNlc3Npb24gbXVzdCBoYXZlIGEgc2Vzc2lvbklkIHRvIGJlIHBhdXNlZFwiKVxuICAgIGlmICh0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5oYXMoc2Vzc2lvbklkKSkgcmV0dXJuXG5cbiAgICBjb25zdCBncmFjZU1zID0gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyAqIDEwMDBcbiAgICBjb25zdCBncmFjZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9leHBpcmVXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZClcbiAgICB9LCBncmFjZU1zKVxuXG4gICAgLy8gRG9uJ3Qga2VlcCB0aGUgcHJvY2VzcyBhbGl2ZSBwdXJlbHkgZm9yIGEgcGF1c2VkIHNlc3Npb24gdGltZXIuXG4gICAgaWYgKHR5cGVvZiBncmFjZVRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIGdyYWNlVGltZXIudW5yZWYoKVxuXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuc2V0KHNlc3Npb25JZCwge3Nlc3Npb24sIGdyYWNlVGltZXIsIHBhdXNlZEF0OiBEYXRlLm5vdygpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb29rcyB1cCBhIHBhdXNlZCBzZXNzaW9uIGJ5IGlkIChkb2VzIE5PVCByZW1vdmUgaXQg4oCUIGNhbGxlciBpc1xuICAgKiBleHBlY3RlZCB0byBjYWxsIGBfcmVzdW1lV2Vic29ja2V0U2Vzc2lvbmAgdG8gY29tcGxldGUgdGhlIGhhbmRvZmYpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gUGF1c2VkIHNlc3Npb24gaWRlbnRpZmllciB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCB8IG51bGx9IC0gUGF1c2VkIHNlc3Npb24gd2l0aCB0aGUgcmVxdWVzdGVkIGlkZW50aWZpZXIsIGlmIHByZXNlbnQuXG4gICAqL1xuICBfZmluZFBhdXNlZFdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmdldChzZXNzaW9uSWQpPy5zZXNzaW9uIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgcGF1c2VkIHNlc3Npb24gZnJvbSB0aGUgcmVnaXN0cnkgYW5kIGNhbmNlbHMgaXRzIGdyYWNlXG4gICAqIHRpbWVyLiBDYWxsZWQgb24gc3VjY2Vzc2Z1bCByZXN1bWUgaGFuZG9mZiBhbmQgb24gZXhwbGljaXRcbiAgICogZXhwaXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gUGF1c2VkIHNlc3Npb24gaWRlbnRpZmllciB0byByZW1vdmUgYW5kIGNhbmNlbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJQYXVzZWRXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZClcblxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgY2xlYXJUaW1lb3V0KGVudHJ5LmdyYWNlVGltZXIpXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZGVsZXRlKHNlc3Npb25JZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFjZS10aW1lciBjYWxsYmFjay4gQ2FsbHMgdGhlIHNlc3Npb24ncyBwZXJtYW5lbnQtdGVhcmRvd25cbiAgICogaG9vayBhbmQgZHJvcHMgaXQgZnJvbSB0aGUgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHdob3NlIGdyYWNlIHBlcmlvZCBleHBpcmVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9leHBpcmVXZWJzb2NrZXRTZXNzaW9uKHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZClcblxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZGVsZXRlKHNlc3Npb25JZClcbiAgICB0cnkge1xuICAgICAgZW50cnkuc2Vzc2lvbi5fZmluYWxpemVHcmFjZUV4cGlyeSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBmaW5hbGl6ZSBleHBpcmVkIFdTIHNlc3Npb24gJHtzZXNzaW9uSWR9YCwgZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnJvYWRjYXN0IHRvIGNoYW5uZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHJlY2VpdmluZyB0aGUgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gVmFsdWVzIHVzZWQgdG8gbWF0Y2ggZWxpZ2libGUgc3Vic2NyaXB0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIEJyb2FkY2FzdCBwYXlsb2FkIGRlbGl2ZXJlZCB0byBtYXRjaGluZyBzdWJzY3JpcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGJyb2FkY2FzdFRvQ2hhbm5lbChuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHkpIHtcbiAgICAvLyBXaGVuIEJlYWNvbiBpcyBjb25uZWN0ZWQsIHNoaXAgdGhlIGJyb2FkY2FzdCBvbnRvIHRoZSBidXMuIFRoZVxuICAgIC8vIGRhZW1vbiBlY2hvZXMgaXQgYmFjayB0byBldmVyeSBwZWVyIChpbmNsdWRpbmcgdGhpcyBvbmUpIGFuZFxuICAgIC8vIGVhY2ggcGVlcidzIGBfZGVsaXZlckJyb2FkY2FzdEZyb21CZWFjb25gIHBlcmZvcm1zIHRoZSBzYW1lXG4gICAgLy8gbG9jYWwgZGVsaXZlcnkgYXMgdGhlIHN5bmNocm9ub3VzIHBhdGhzIGJlbG93IOKAlCBzbyBldmVyeVxuICAgIC8vIHN1YnNjcmliZXIsIGluIGFueSBwcm9jZXNzLCBzZWVzIGJyb2FkY2FzdHMgdmlhIGEgc2luZ2xlIGNvZGVcbiAgICAvLyBwYXRoLlxuICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQgJiYgdGhpcy5fYmVhY29uQ2xpZW50LmlzQ29ubmVjdGVkKCkpIHtcbiAgICAgIGNvbnN0IHNlbnQgPSB0aGlzLl9iZWFjb25DbGllbnQucHVibGlzaCh7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5fSlcblxuICAgICAgaWYgKHNlbnQpIHJldHVyblxuICAgIH1cblxuICAgIC8vIFYyIHN1YnNjcmlwdGlvbnMgbGl2ZSBwZXIgd29ya2VyLXRocmVhZC4gV2hlbiBydW5uaW5nIGluXG4gICAgLy8gd29ya2VyLXRocmVhZCBtb2RlLCB0aGUgcHVibGlzaGVyIHJ1bnMgZWl0aGVyIGluIHRoZSBtYWluXG4gICAgLy8gcHJvY2VzcyAoaG9zdCkgb3IgaW4gb25lIG9mIHRoZSB3b3JrZXJzOlxuICAgIC8vXG4gICAgLy8gIC0gTWFpbiBwcm9jZXNzOiBgX3dlYnNvY2tldEV2ZW50c2AgaXMgdGhlIGhvc3Qgc2luZ2xldG9uIGFuZFxuICAgIC8vICAgIGBicm9hZGNhc3RWMmAgZmFucyBvdXQgdG8gZXZlcnkgd29ya2VyIGRpcmVjdGx5LlxuICAgIC8vICAtIFdvcmtlcjogYF93ZWJzb2NrZXRFdmVudHNgIGhhcyBgcHVibGlzaFYyQnJvYWRjYXN0YCB0aGF0XG4gICAgLy8gICAgcG9zdHMgdG8gbWFpbiwgd2hpY2ggdGhlbiBmYW5zIG91dCB0byBldmVyeSB3b3JrZXIuXG4gICAgLy9cbiAgICAvLyBJbi1wcm9jZXNzIG1vZGUgZG9lc24ndCBpbnN0YWxsIGEgd2Vic29ja2V0LWV2ZW50cyB0cmFuc3BvcnQsXG4gICAgLy8gc28gZmFsbCB0aHJvdWdoIHRvIHRoZSBsb2NhbCBkaXNwYXRjaC5cbiAgICAvKipcbiAgICAgKiBXZWJzb2NrZXQgZXZlbnRzLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBjb25zdCB3ZWJzb2NrZXRFdmVudHMgPSB0aGlzLl93ZWJzb2NrZXRFdmVudHNcblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIoe2NoYW5uZWw6IG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSwgY29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMucHVibGlzaFYyQnJvYWRjYXN0ID09PSBcImZ1bmN0aW9uXCIgJiYgd2Vic29ja2V0RXZlbnRzLnBhcmVudFBvcnQpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5wdWJsaXNoVjJCcm9hZGNhc3Qoe2NoYW5uZWw6IG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIGFsbCBwZW5kaW5nIGJyb2FkY2FzdCBvcGVyYXRpb25zIChpbmNsdWRpbmcgZXZlbnQtbG9nXG4gICAqIHBlcnNpc3RlbmNlKS4gQ2FsbCB0aGlzIGFmdGVyIGBicm9hZGNhc3RUb0NoYW5uZWxgIHdoZW4geW91IG5lZWRcbiAgICogdGhlIGV2ZW50IHRvIGJlIHBlcnNpc3RlZCBiZWZvcmUgY29udGludWluZyAoZS5nLiBiZWZvcmVcbiAgICogcmVzcG9uZGluZyB0byBhbiBIVFRQIHJlcXVlc3QpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMoKSB7XG4gICAgLyoqXG4gICAgICogV2Vic29ja2V0IGV2ZW50cy5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRzID0gdGhpcy5fd2Vic29ja2V0RXZlbnRzXG5cbiAgICBpZiAod2Vic29ja2V0RXZlbnRzICYmIHR5cGVvZiB3ZWJzb2NrZXRFdmVudHMuYXdhaXRQZW5kaW5nQnJvYWRjYXN0cyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAvLyBEcmFpbiB0aGUgaG9zdC93b3JrZXIgcHVibGlzaCBxdWV1ZXMgKGluY2x1ZGluZyBldmVudC1sb2cgcGVyc2lzdGVuY2UpXG4gICAgICAvLyBiZWZvcmUgZHJhaW5pbmcgbG9jYWwgZGVsaXZlcmllcywgYmVjYXVzZSBob3N0IGRpc3BhdGNoIGxhdW5jaGVzIHRoZVxuICAgICAgLy8gbG9jYWwgZGVsaXZlcmllcyBzeW5jaHJvbm91c2x5IGFuZCB0aGV5IG11c3QgYmUgcGFydCBvZiB0aGUgc25hcHNob3QuXG4gICAgICBhd2FpdCB3ZWJzb2NrZXRFdmVudHMuYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYXdhaXRMb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIExvY2FsIChwZXItd29ya2VyKSBjaGFubmVsIGJyb2FkY2FzdCBkaXNwYXRjaC4gQ2FsbGVkIGVpdGhlclxuICAgKiBkaXJlY3RseSAoaW4tcHJvY2VzcyBtb2RlKSBvciBieSB0aGUgd29ya2VyIHRocmVhZCBhZnRlciB0aGVcbiAgICogbWFpbi1wcm9jZXNzIGZhbi1vdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gUGFyYW1zIHBhc3NlZCB0byBlYWNoIHN1YnNjcmlwdGlvbidzIGBtYXRjaGVzKClgLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gTWVzc2FnZSBib2R5IGRlbGl2ZXJlZCB2aWEgYHNlbmRNZXNzYWdlKClgLlxuICAgKiBAcGFyYW0ge3tldmVudElkPzogc3RyaW5nfX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEgZm9yIHJlcGxheSB0cmFja2luZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBidWNrZXQpIHtcbiAgICAgIGlmIChzdWJzY3JpcHRpb24uaXNDbG9zZWQoKSkgY29udGludWVcblxuICAgICAgbGV0IG1hdGNoZXNcblxuICAgICAgdHJ5IHtcbiAgICAgICAgbWF0Y2hlcyA9IHN1YnNjcmlwdGlvbi5tYXRjaGVzKGJyb2FkY2FzdFBhcmFtcyB8fCB7fSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIEEgYnJva2VuIGBtYXRjaGVzKClgIG9uIG9uZSBzdWJzY3JpYmVyIG11c3Qgbm90IHBvaXNvbiB0aGVcbiAgICAgICAgLy8gYnJvYWRjYXN0IHRvIG90aGVyIHN1YnNjcmliZXJzLiBTa2lwIGFuZCBjb250aW51ZS5cbiAgICAgICAgY29uc29sZS5lcnJvcihgYnJvYWRjYXN0VG9DaGFubmVsOiAke25hbWV9IHN1YnNjcmlwdGlvbiAke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH0gbWF0Y2hlcygpIHRocmV3YCwgZXJyb3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWF0Y2hlcykgY29udGludWVcblxuICAgICAgY29uc3QgZGVsaXZlcnkgPSB0aGlzLndpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHRzKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIFByb21pc2VcbiAgICAgICAgICAucmVzb2x2ZSgpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fZGVsaXZlcldlYnNvY2tldENoYW5uZWxCcm9hZGNhc3Qoc3Vic2NyaXB0aW9uLCBib2R5LCB7ZXZlbnRJZDogbWV0YT8uZXZlbnRJZH0pKVxuICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYGJyb2FkY2FzdFRvQ2hhbm5lbDogJHtuYW1lfSBzdWJzY3JpcHRpb24gJHtzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWR9IGRlbGl2ZXJCcm9hZGNhc3QgdGhyZXdgLCBlcnJvcilcbiAgICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgLy8gS2VlcCB0aGUgZmlyZS1hbmQtZm9yZ2V0IGRlbGl2ZXJ5IChuZXZlciBhd2FpdGVkIGF0IGJyb2FkY2FzdCB0aW1lKSBidXRcbiAgICAgIC8vIHRyYWNrIGl0IHNvIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBjYW4gZHJhaW4gaXQgYmVmb3JlIHNldHRsaW5nLiBSZW1vdmVcbiAgICAgIC8vIG9uIHNldHRsZTsgdGhlIGZhaWx1cmUgaGFuZGxlciBhbHNvIHNhdGlzZmllcyB0aGUgcHJvbWlzZSBzbyBhIHJlamVjdGVkXG4gICAgICAvLyBkZWxpdmVyeSBuZXZlciBiZWNvbWVzIGFuIHVuaGFuZGxlZCByZWplY3Rpb24uXG4gICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMuYWRkKGRlbGl2ZXJ5KVxuXG4gICAgICBkZWxpdmVyeS50aGVuKFxuICAgICAgICAoKSA9PiB7IHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcy5kZWxldGUoZGVsaXZlcnkpIH0sXG4gICAgICAgICgpID0+IHsgdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzLmRlbGV0ZShkZWxpdmVyeSkgfVxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYSBzbmFwc2hvdCBvZiB0aGUgaW4tZmxpZ2h0IGxvY2FsIChwZXItcHJvY2Vzcykgd2Vic29ja2V0IGNoYW5uZWxcbiAgICogYnJvYWRjYXN0IGRlbGl2ZXJpZXMuIENhbGxlZCBmcm9tIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBhZnRlciB0aGUgaG9zdFxuICAgKiBwdWJsaXNoIHF1ZXVlcyBkcmFpbiwgc28gZXZlcnkgZGVsaXZlcnkgdGhvc2UgcXVldWVzIGxhdW5jaGVkIGlzIGNhcHR1cmVkLlxuICAgKiBOZXcgZGVsaXZlcmllcyBlbnF1ZXVlZCBhZnRlciB0aGUgc25hcHNob3QgYXJlIG5vdCBhd2FpdGVkLiBJbmRpdmlkdWFsXG4gICAqIGRlbGl2ZXJ5IGVycm9ycyBhcmUgaXNvbGF0ZWQgcGVyIHN1YnNjcmliZXIg4oCUIHRoZSBkZWxpdmVyeSBjaGFpbiBhbHJlYWR5XG4gICAqIGxvZ3MgdGhlbSBhbmQgcmVzb2x2ZXMg4oCUIHNvIGEgc25hcHNob3R0ZWQgcmVqZWN0aW9uIG5ldmVyIGZhaWxzIHRoaXMgYmFycmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXdhaXRMb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMoKSB7XG4gICAgY29uc3Qgc25hcHNob3QgPSBbLi4udGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyaWVzXVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHNuYXBzaG90KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciB3ZWJzb2NrZXQgY2hhbm5lbCBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBzdWJzY3JpcHRpb24gLSBDaGFubmVsIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEpzb25WYWx1ZX0gYm9keSAtIEJyb2FkY2FzdCBib2R5LlxuICAgKiBAcGFyYW0ge3tldmVudElkPzogc3RyaW5nfX0gbWV0YSAtIEJyb2FkY2FzdCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSBCcm9hZGNhc3QgZGVsaXZlcnkgcmVzdWx0LlxuICAgKi9cbiAgX2RlbGl2ZXJXZWJzb2NrZXRDaGFubmVsQnJvYWRjYXN0KHN1YnNjcmlwdGlvbiwgYm9keSwgbWV0YSkge1xuICAgIGlmICh0eXBlb2Ygc3Vic2NyaXB0aW9uLmRlbGl2ZXJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpXG4gICAgfVxuXG4gICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldENoYW5uZWxSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBYmlsaXR5IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IFthcmdzLnJlcXVlc3RdIC0gUmVxdWVzdCBvYmplY3QuIEFic2VudCBmb3Igd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9ucyByZXNvbHZlZCBmcm9tIHN1YnNjcmliZSBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MucmVzcG9uc2VdIC0gUmVzcG9uc2Ugb2JqZWN0LiBBYnNlbnQgb3V0c2lkZSBIVFRQIHJlcXVlc3QgaGFuZGxpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVkIGFiaWxpdHkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQWJpbGl0eSh7cGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0QWJpbGl0eVJlc29sdmVyKClcblxuICAgIGlmIChyZXNvbHZlcikge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlcih7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pXG5cbiAgICAgIGlmIChyZXNvbHZlZCkgcmV0dXJuIHJlc29sdmVkXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VzID0gdGhpcy5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICAgIGlmIChyZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIHJldHVybiBuZXcgQWJpbGl0eSh7XG4gICAgICBjb250ZXh0OiB7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0sXG4gICAgICByZXNvdXJjZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9maWxlcyBhbiBhcHBsaWNhdGlvbi1kZWZpbmVkIHRlc3QgYWN0aXZpdHkgd2hlbiBhbiBvcHQtaW4gdGVzdCBwcm9maWxlXG4gICAqIGNvbnRleHQgaXMgYWN0aXZlLiBUaGUgY2FsbGJhY2sgYWx3YXlzIHJ1bnMsIGluY2x1ZGluZyBvdXRzaWRlIHByb2ZpbGluZy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb3ctY2FyZGluYWxpdHkgYWN0aXZpdHkgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIEFjdGl2aXR5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBwcm9maWxlVGVzdEFjdGl2aXR5KG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgdmFsaWRhdGVkTmFtZSA9IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZShuYW1lKVxuXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFRlc3RQcm9maWxlQ29udGV4dCgpXG5cbiAgICBpZiAoIWNvbnRleHQpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgY29udGV4dC5wcm9maWxlci5wcm9maWxlQWN0aXZpdHkoY29udGV4dCwgdmFsaWRhdGVkTmFtZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGFiaWxpdHkgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudEFiaWxpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudEFiaWxpdHkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgcmVxdWVzdCB0aW1pbmcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgcmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKi9cbiAgZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ3VycmVudCB0ZW5hbnQgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlbmFudCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVuYW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVGVuYW50IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7e2NoYW5uZWw6IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gW2FyZ3Muc3Vic2NyaXB0aW9uXSAtIFN1YnNjcmlwdGlvbiBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVUZW5hbnQoe3BhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2UsIHN1YnNjcmlwdGlvbn0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0VGVuYW50UmVzb2x2ZXIoKVxuXG4gICAgaWYgKCFyZXNvbHZlcikgcmV0dXJuXG5cbiAgICByZXR1cm4gYXdhaXQgcmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIHBhcmFtcyxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIHN1YnNjcmlwdGlvblxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXJyb3IgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiZXZlbnRlbWl0dGVyM1wiKS5FdmVudEVtaXR0ZXJ9IC0gRnJhbWV3b3JrIGVycm9yIGV2ZW50cyBlbWl0dGVyLlxuICAgKi9cbiAgZ2V0RXJyb3JFdmVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgcmVwb3J0ZXIgdGhhdCBjYW4gYWRkIGNsaWVudC1zYWZlIG1ldGFkYXRhIHRvIGZyb250ZW5kLW1vZGVsIGVycm9yIHBheWxvYWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclR5cGV9IHJlcG9ydGVyIC0gUmVwb3J0ZXIgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXIocmVwb3J0ZXIpIHtcbiAgICB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMucHVzaChyZXBvcnRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyZWQgY2xpZW50IGVycm9yIHBheWxvYWQgcmVwb3J0ZXJzLlxuICAgKiBAcGFyYW0ge3tjb250ZXh0OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkQ29udGV4dCwgZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIFJlcG9ydGVyIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWQ+fSAtIE1lcmdlZCBjbGllbnQtc2FmZSByZXBvcnRlciBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgY2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoYXJncykge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICBjb25zdCBkZXRhaWxzID0gcmVxdWVzdERldGFpbHMoYXJncy5yZXF1ZXN0LCB7cmVkYWN0b3I6IHRoaXMuZ2V0TG9nUmVkYWN0b3IoKSwgc2Vuc2l0aXZlVmFsdWVzfSlcblxuICAgIGZvciAoY29uc3QgcmVwb3J0ZXIgb2YgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzKSB7XG4gICAgICBjb25zdCByZXBvcnRlclBheWxvYWQgPSBhd2FpdCByZXBvcnRlcih7XG4gICAgICAgIC4uLmFyZ3MsXG4gICAgICAgIHJlcXVlc3REZXRhaWxzOiBkZXRhaWxzXG4gICAgICB9KVxuXG4gICAgICBpZiAocmVwb3J0ZXJQYXlsb2FkICYmIHR5cGVvZiByZXBvcnRlclBheWxvYWQgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihwYXlsb2FkLCByZXBvcnRlclBheWxvYWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSB0ZXN0IGF0dGVtcHQgaW4gYSByZXZvY2FibGUgZGF0YWJhc2UtYWNjZXNzIGNvbnRleHQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e3Jldm9rZWQ6IGJvb2xlYW59fSBzY29wZSAtIEF0dGVtcHQtb3duZWQgYWNjZXNzIHNjb3BlLlxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF0dGVtcHQgd29yay5cbiAgICogQHJldHVybnMge1QgfCBQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdGVudCBmcmFtZXdvcmsgd29yayB3aXRob3V0IGluaGVyaXRpbmcgYSB0ZXN0IGF0dGVtcHQncyByZXZvY2FibGUgZGF0YWJhc2UtYWNjZXNzIHNjb3BlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBlcnNpc3RlbnQgd29yayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhvdXRDdXJyZW50VGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqIFRocm93cyB3aGVuIGEgdGltZWQtb3V0IHRlc3QgYXR0ZW1wdCB0cmllcyB0byBzdGFydCBtb3JlIGRhdGFiYXNlIHdvcmsuICovXG4gIGFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpIHtcbiAgICB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmFzc2VydFRlc3REYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBjb25uZWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoQ29ubmVjdGlvbnMob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBuYW1lXG4gICAgfSA9IHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgXCJDb25maWd1cmF0aW9uLndpdGhDb25uZWN0aW9uc1wiKVxuXG4gICAgaWYgKCFhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwid2l0aENvbm5lY3Rpb25zIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIC8qKlxuICAgICAqIERicy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIGNvbnN0IGRicyA9IHt9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGJzLFxuICAgICAgaWRlbnRpZmllcnM6IGRhdGFiYXNlSWRlbnRpZmllcnMgPz8gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCksXG4gICAgICBuYW1lLFxuICAgICAgc3RhY2tMYWJlbDogXCJ3aXRoQ29ubmVjdGlvbnNcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBsaWNpdCBtb2RlbCB3b3JrIGluIGEgdHJhbnNhY3Rpb24gcGlubmVkIHRvIG9uZSBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZT86IHN0cmluZ319IG9wdGlvbnMgLSBPcGVyYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHsob3BlcmF0aW9uOiBEYXRhYmFzZU9wZXJhdGlvbikgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhUcmFuc2FjdGlvbih7ZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lID0gXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvblwiLCAuLi5yZXN0QXJnc30sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuICAgIGlmICghdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkuaW5jbHVkZXMoZGF0YWJhc2VJZGVudGlmaWVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9yIGluYWN0aXZlIGRhdGFiYXNlIGlkZW50aWZpZXI6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KClcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhPcGVyYXRpb25Db25uZWN0aW9uKHtuYW1lfSwgYXN5bmMgKGNvbm5lY3Rpb24sIG93bmVyKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICBjb25zdCBvcGVyYXRpb24gPSBuZXcgRGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGNvbmZpZ3VyYXRpb25SZXVzZUtleTogcG9vbC5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pLFxuICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIG93bmVyLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBvcGVyYXRpb24udHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgICAgICB9KVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgb3BlcmF0aW9uLmNvbXBsZXRlKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhwbGljaXQgbW9kZWwgd29yayBvbiBvbmUgY29ubmVjdGlvbiBzZWxlY3RlZCBmcm9tIGEgY2FwdHVyZWQgcGh5c2ljYWxcbiAgICogZGF0YWJhc2UgY29uZmlndXJhdGlvbi4gTm8gYW1iaWVudCB0ZW5hbnQgdmFsdWUgaXMgcmVhZCBkdXJpbmcgY2hlY2tvdXQgb3JcbiAgICogZXhlY3V0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZT86IHN0cmluZywgc2NoZW1hR2VuZXJhdGlvbj86IHN0cmluZywgdGVuYW50Pzogb2JqZWN0fX0gb3B0aW9ucyAtIENhcHR1cmVkIG9wZXJhdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IERhdGFiYXNlT3BlcmF0aW9uKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERhdGFiYXNlT3BlcmF0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgbmFtZSA9IFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb25cIiwgc2NoZW1hR2VuZXJhdGlvbiwgdGVuYW50LCAuLi5yZXN0QXJnc30sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cIilcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBjb25maWd1cmF0aW9uUmV1c2VLZXkgPSBwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG5cbiAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ2FwdHVyZWRPcGVyYXRpb25Db25uZWN0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG5hbWV9LCBhc3luYyAoY29ubmVjdGlvbiwgb3duZXIpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IG5ldyBEYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgY29uZmlndXJhdGlvblJldXNlS2V5LFxuICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIGVuZm9yY2VDdXJyZW50VGVuYW50UmV1c2VLZXk6IGZhbHNlLFxuICAgICAgICBvd25lcixcbiAgICAgICAgc2NoZW1hR2VuZXJhdGlvbixcbiAgICAgICAgdGVuYW50XG4gICAgICB9KVxuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgb3BlcmF0aW9uLmNvbXBsZXRlKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FsbGJhY2sgd2l0aCBkYXRhYmFzZSBjb25uZWN0aW9ucyBmb3IgdGhlIHJlcXVlc3RlZCBpZGVudGlmaWVycy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7Y2FsbGJhY2s6IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiwgZGJzOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0PiwgaWRlbnRpZmllcnM6IHN0cmluZ1tdLCBuYW1lOiBzdHJpbmcsIHN0YWNrTGFiZWw6IHN0cmluZ319IGFyZ3MgLSBDb25uZWN0aW9uIHNjb3BlIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7Y2FsbGJhY2ssIGRicywgaWRlbnRpZmllcnMsIG5hbWUsIHN0YWNrTGFiZWx9KSB7XG4gICAgY29uc3Qgc3RhY2sgPSBFcnJvcigpLnN0YWNrXG4gICAgY29uc3QgYWN0dWFsQ2FsbGJhY2sgPSBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICByZXR1cm4gYXdhaXQgd2l0aFRyYWNrZWRTdGFjayhzdGFjayB8fCBzdGFja0xhYmVsLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYnMpXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1biByZXF1ZXN0LlxuICAgICAqIEB0eXBlIHsoKSA9PiBQcm9taXNlPFQ+fSAqL1xuICAgIGxldCBydW5SZXF1ZXN0ID0gYWN0dWFsQ2FsbGJhY2tcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBpZGVudGlmaWVycykge1xuICAgICAgbGV0IGFjdHVhbFJ1blJlcXVlc3QgPSBydW5SZXF1ZXN0XG5cbiAgICAgIGNvbnN0IG5leHRSdW5SZXF1ZXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikud2l0aENvbm5lY3Rpb24oe25hbWV9LCBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgICBkYnNbaWRlbnRpZmllcl0gPSBkYlxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbFJ1blJlcXVlc3QoKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBydW5SZXF1ZXN0ID0gbmV4dFJ1blJlcXVlc3RcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUmVxdWVzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2RhdGFiYXNlSWRlbnRpZmllcnNdIC0gRGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gaW5jbHVkZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBBIG1hcCBvZiBkYXRhYmFzZSBjb25uZWN0aW9ucyB3aXRoIGlkZW50aWZpZXIgYXMga2V5XG4gICAqL1xuICBnZXRDdXJyZW50Q29ubmVjdGlvbnMoZGF0YWJhc2VJZGVudGlmaWVycyA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIC8qKlxuICAgICAqIERicy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIGNvbnN0IGRicyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGF0YWJhc2VJZGVudGlmaWVycykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9uID0gcG9vbC5nZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24gPyBwb29sLmdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbigpIDogcG9vbC5nZXRDdXJyZW50Q29ubmVjdGlvbigpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRDb25uZWN0aW9uICYmICghcG9vbC5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uIHx8IHBvb2wuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbihjdXJyZW50Q29ubmVjdGlvbikpKSB7XG4gICAgICAgICAgZGJzW2lkZW50aWZpZXJdID0gY3VycmVudENvbm5lY3Rpb25cbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuaXNNaXNzaW5nQ3VycmVudENvbm5lY3Rpb25FcnJvcihlcnJvcikpIHtcbiAgICAgICAgICAvLyBJZ25vcmVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aG91dCBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gd2l0aG91dCBpbmhlcml0ZWQgREIgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoY2FsbGJhY2spIHtcbiAgICBsZXQgcnVuQ2FsbGJhY2sgPSAoKSA9PiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJzKGNhbGxiYWNrKVxuXG4gICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuICAgICAgY29uc3QgcHJldmlvdXNSdW5DYWxsYmFjayA9IHJ1bkNhbGxiYWNrXG5cbiAgICAgIHJ1bkNhbGxiYWNrID0gKCkgPT4gcG9vbC53aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0KHByZXZpb3VzUnVuQ2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bkNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaW5zaWRlIGV2ZXJ5IHBvb2wncyB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIGNvbnRleHQgKGEgbm8tb3AgZm9yXG4gICAqIHBvb2xzIHdpdGhvdXQgb25lKS4gSW4tcHJvY2VzcyByZXF1ZXN0IGhhbmRsaW5nIGlzIHdyYXBwZWQgaW4gdGhpcyBzbyBhIHJlcXVlc3RcbiAgICogcnVucyBvbiB0aGUgc2FtZSBjb25uZWN0aW9uIOKAlCBhbmQgb3BlbiB0cmFuc2FjdGlvbiDigJQgYXMgdGhlIHRlc3QgdGhhdCBpc3N1ZWQgaXQsXG4gICAqIGxldHRpbmcgcmVxdWVzdCBzcGVjcyBjbGVhbiB1cCBieSByb2xsaW5nIGJhY2sgaW5zdGVhZCBvZiB0cnVuY2F0aW5nLiBPdXRzaWRlXG4gICAqIHRlc3RzIG5vIHNoYXJlZCBjb25uZWN0aW9uIGlzIHNldCwgc28gdGhpcyBqdXN0IHJ1bnMgdGhlIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIGluc2lkZSB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGNhbGxiYWNrKSB7XG4gICAgbGV0IHJ1bkNhbGxiYWNrID0gY2FsbGJhY2tcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmICghcG9vbCkgY29udGludWVcbiAgICAgIGNvbnN0IHByZXZpb3VzUnVuQ2FsbGJhY2sgPSBydW5DYWxsYmFja1xuXG4gICAgICBydW5DYWxsYmFjayA9ICgpID0+IHBvb2wucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uKHByZXZpb3VzUnVuQ2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bkNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG1pc3NpbmcgY3VycmVudCBjb25uZWN0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEVycm9yIHRocm93biB3aGlsZSBsb29raW5nIHVwIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGVycm9yIG1lYW5zIG5vIGN1cnJlbnQgY29ubmVjdGlvbiBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBpc01pc3NpbmdDdXJyZW50Q29ubmVjdGlvbkVycm9yKGVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgKFxuICAgICAgZXJyb3IubWVzc2FnZSA9PSBcIklEIGhhc24ndCBiZWVuIHNldCBmb3IgdGhpcyBhc3luYyBjb250ZXh0XCIgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2UgPT0gXCJBIGNvbm5lY3Rpb24gaGFzbid0IGJlZW4gbWFkZSB5ZXRcIiB8fFxuICAgICAgZXJyb3IubWVzc2FnZS5zdGFydHNXaXRoKFwiTm8gYXN5bmMgY29udGV4dCBzZXQgZm9yIGRhdGFiYXNlIGNvbm5lY3Rpb25cIikgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2Uuc3RhcnRzV2l0aChcIkNvbm5lY3Rpb24gXCIpICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJkb2Vzbid0IGV4aXN0IGFueSBtb3JlXCIpXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGNvbm5lY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNvbm5lY3Rpb25zKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBjb25zdCB7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgbmFtZVxuICAgIH0gPSByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIFwiQ29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9uc1wiKVxuXG4gICAgaWYgKCFhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwiZW5zdXJlQ29ubmVjdGlvbnMgcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgcmVxdWVzdGVkSWRlbnRpZmllcnMgPSBkYXRhYmFzZUlkZW50aWZpZXJzID8/IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpXG4gICAgY29uc3QgZGJzID0gdGhpcy5nZXRDdXJyZW50Q29ubmVjdGlvbnMocmVxdWVzdGVkSWRlbnRpZmllcnMpXG4gICAgY29uc3QgbWlzc2luZ0lkZW50aWZpZXJzID0gcmVxdWVzdGVkSWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiB7XG4gICAgICBpZiAoIWRic1tpZGVudGlmaWVyXSkgcmV0dXJuIHRydWVcblxuICAgICAgcmV0dXJuICF0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS5oYXNDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQoKVxuICAgIH0pXG5cbiAgICBpZiAobWlzc2luZ0lkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKGRicylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGJzLFxuICAgICAgaWRlbnRpZmllcnM6IG1pc3NpbmdJZGVudGlmaWVycyxcbiAgICAgIG5hbWUsXG4gICAgICBzdGFja0xhYmVsOiBcImVuc3VyZUNvbm5lY3Rpb25zXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGRlZGljYXRlZCBjb25uZWN0aW9uIHRoYXQgY3VycmVudGx5IGhvbGRzIGFuIGFkdmlzb3J5IGxvY2ssIHNvIGFcbiAgICogc2h1dGRvd24gY2FuIGNsb3NlIGl0IGFuZCByZWxlYXNlIHRoZSBsb2NrLiBTZWUgYF9hZHZpc29yeUxvY2tDb25uZWN0aW9uc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuYWRkKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uIG9uY2UgaXRzIGxvY2sgc2NvcGUgZW5kcyBhbmQgdGhlXG4gICAqIGNvbm5lY3Rpb24gaGFzIGJlZW4gKG9yIGlzIGFib3V0IHRvIGJlKSBjbG9zZWQgYnkgaXRzIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBUaGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB1bnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGV2ZXJ5IHJlZ2lzdGVyZWQgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiwgZW5kaW5nIGl0cyBzZXNzaW9uIHNvXG4gICAqIHRoZSBEQiBzZXJ2ZXIgcmVsZWFzZXMgdGhlIGxvY2suIEV2ZXJ5IGNvbm5lY3Rpb24gaXMgYXR0ZW1wdGVkIGJlZm9yZSBhbnkgZmFpbHVyZVxuICAgKiBpcyBzdXJmYWNlZCwgc28gb25lIHN0dWNrIGNsb3NlIGRvZXMgbm90IGxlYXZlIHRoZSBvdGhlcnMnIGxvY2tzIGhlbGQ7IGEgZmFpbHVyZSBpc1xuICAgKiB0aGVuIHRocm93biAobmV2ZXIgc3dhbGxvd2VkKSwgYWdncmVnYXRlZCB3aGVuIG1vcmUgdGhhbiBvbmUgY29ubmVjdGlvbiBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgYWxsIGhhdmUgYmVlbiBjbG9zZWQ7IHJlamVjdHMgaWYgYW55IGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zXVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuY2xlYXIoKVxuXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBjb25uZWN0aW9ucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFjdGl2ZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBhbmQgY2xlYXJzIGdsb2JhbCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbnN0cnVjdG9ycyA9IG5ldyBTZXQoKVxuXG4gICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgICBjb25zdCBjbG9zZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gQ2xvc2UgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgZmlyc3Q6IHRoZXkgYXJlIHNwYXduZWQgb3V0c2lkZSB0aGVcbiAgICAgICAgICAvLyBwb29scycgdHJhY2tlZCBzZXRzLCBzbyBgcG9vbC5jbG9zZUFsbCgpYCB3b3VsZCBub3QgcmVhY2ggdGhlbSBhbmQgYSBsb2NrIGhlbGRcbiAgICAgICAgICAvLyBieSBhIHJ1bm5lciB0b3JuIGRvd24gbWlkLXBhc3Mgd291bGQgbGVhayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuXG4gICAgICAgICAgLy8gU3RpbGwgY2xvc2UgdGhlIHBvb2xzIGlmIHRoaXMgdGhyb3dzLCBzbyBhIHN0dWNrIGxvY2sgY29ubmVjdGlvbiBkb2VzIG5vdFxuICAgICAgICAgIC8vIGxlYXZlIHRoZSByZXN0IG9mIHRoZSBjb25uZWN0aW9ucyBvcGVuLlxuICAgICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMoKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgICAgICAgIGlmICghcG9vbCkgY29udGludWVcblxuICAgICAgICAgICAgYXdhaXQgcG9vbC5jbG9zZUFsbCgpXG5cbiAgICAgICAgICAgIGNvbnN0IFBvb2xDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9ICovIChwb29sLmNvbnN0cnVjdG9yKVxuICAgICAgICAgICAgY29uc3RydWN0b3JzLmFkZChQb29sQ2xhc3MpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZm9yIChjb25zdCBQb29sQ2xhc3Mgb2YgY29uc3RydWN0b3JzKSB7XG4gICAgICAgICAgICBQb29sQ2xhc3MuY2xlYXJHbG9iYWxDb25uZWN0aW9ucyh0aGlzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRoaXMuX2Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlLnJlc2V0KClcblxuICAgICAgICAgIC8vIEFsbG93IGZ1bGwgcmUtaW5pdGlhbGl6YXRpb24gYWZ0ZXIgY29ubmVjdGlvbnMgYXJlIGNsb3NlZC5cbiAgICAgICAgICB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiArPSAxXG4gICAgICAgICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cblxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgY2xvc2VFcnJvcnNbMF1cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoY2xvc2VFcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGJhY2tncm91bmQtam9icyBhbmQgZGF0YWJhc2UgcmVzb3VyY2VzXCIpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCByZXF1ZXN0IGF1dGhvcml6ZWQuXG4gICAqIEBwYXJhbSB7e2hlYWRlcjogKG5hbWU6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH19IHJlcXVlc3QgLSBJbmNvbWluZyByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhwZWN0ZWRUb2tlbiAtIENvbmZpZ3VyZWQgZGVidWctZW5kcG9pbnQgdG9rZW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgY2FycmllcyB0aGUgZXhwZWN0ZWQgYmVhcmVyIHRva2VuLlxuICAgKi9cbiAgZGVidWdFbmRwb2ludFJlcXVlc3RBdXRob3JpemVkKHJlcXVlc3QsIGV4cGVjdGVkVG9rZW4pIHtcbiAgICBjb25zdCBoZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImF1dGhvcml6YXRpb25cIilcblxuICAgIGlmICh0eXBlb2YgaGVhZGVyICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG1hdGNoID0gKC9eQmVhcmVyXFxzKyguKykkL2kpLmV4ZWMoaGVhZGVyLnRyaW0oKSlcblxuICAgIGlmICghbWF0Y2gpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZGVidWdFbmRwb2ludFRva2VuTWF0Y2hlcyhtYXRjaFsxXSwgZXhwZWN0ZWRUb2tlbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcGkgbWFuaWZlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHVua25vd24+Pn0gLSBBUEkgbWFuaWZlc3QgZm9yIGFsbCByZWdpc3RlcmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGdldEFwaU1hbmlmZXN0KCkge1xuICAgIHJldHVybiBmcm9udGVuZE1vZGVsQXBpTWFuaWZlc3QodGhpcy5fYmFja2VuZFByb2plY3RzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hldGhlciBBUEkgbWFuaWZlc3QgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgQVBJIG1hbmlmZXN0IGVuZHBvaW50IGlzIGVuYWJsZWQuXG4gICAqL1xuICBfYXBpTWFuaWZlc3RFbmFibGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9hcGlNYW5pZmVzdC5lbmFibGVkXG4gIH1cbn1cbiJdfQ==