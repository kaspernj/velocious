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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBRUgsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGFBQWEsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxTQUFTLE1BQU0sMENBQTBDLENBQUE7QUFDaEUsT0FBTyxPQUFPLE1BQU0sNEJBQTRCLENBQUE7QUFDaEQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBQ3ZELE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25GLE9BQU8sWUFBWSxNQUFNLDBCQUEwQixDQUFBO0FBQ25ELE9BQU8sb0NBQW9DLE1BQU0sZ0RBQWdELENBQUE7QUFDakcsT0FBTyxFQUFFLCtCQUErQixFQUFFLG9CQUFvQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0gsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3JFLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLDBDQUEwQyxDQUFBO0FBQ3hOLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHlCQUF5QixDQUFBO0FBQ3hHLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sYUFBYSxNQUFNLDRCQUE0QixDQUFBO0FBQ3RELE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxNQUFNLG9DQUFvQyxDQUFBO0FBQzdFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGdCQUFnQixDQUFBO0FBQ2pELE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ2hFLE9BQU8sZ0JBQWdCLE1BQU0saUNBQWlDLENBQUE7QUFDOUQsT0FBTyw2QkFBNkIsTUFBTSwrQ0FBK0MsQ0FBQTtBQUN6RixPQUFPLEVBQUUsbUJBQW1CLEVBQUUsNkJBQTZCLEVBQUUsMEJBQTBCLEVBQUUsTUFBTSwwQ0FBMEMsQ0FBQTtBQUN6SSxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQTtBQUVoRSxPQUFPLEVBQUUsK0JBQStCLEVBQUUsQ0FBQTtBQUUxQzs7O0dBR0c7QUFDSCxTQUFTLHVCQUF1QjtJQUM5QixNQUFNLGFBQWEsR0FBRyxnRUFBZ0UsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUUzRyxJQUFJLE9BQU8sYUFBYSxFQUFFLEdBQUcsS0FBSyxVQUFVO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFFOUQsT0FBTyxhQUFhLENBQUMsR0FBRyxFQUFFLENBQUE7QUFDNUIsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLDBCQUEwQixDQUFDLGlCQUFpQixFQUFFLFFBQVEsRUFBRSxXQUFXO0lBQzFFLElBQUksT0FBTyxpQkFBaUIsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUMzQyxNQUFNLGNBQWMsR0FBRyw2Q0FBNkMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUE7UUFFeEYsT0FBTyxFQUFDLG1CQUFtQixFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxjQUFjLEVBQUMsQ0FBQTtJQUN0RixDQUFDO0lBRUQsT0FBTztRQUNMLG1CQUFtQixFQUFFLGlCQUFpQixDQUFDLG1CQUFtQjtRQUMxRCxJQUFJLEVBQUUsaUJBQWlCLENBQUMsSUFBSSxJQUFJLFdBQVc7UUFDM0MsUUFBUTtLQUNULENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsMkJBQTJCLENBQUMsS0FBSztJQUN4QyxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUNyRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQywyQkFBMkIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0lBRXpGLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFLEVBQUU7UUFDdEQsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLDJCQUEyQixDQUFDLDREQUE0RCxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUNwSCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUMsRUFBRSw0REFBNEQsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUE7QUFDdkUsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUywwQkFBMEIsQ0FBQyxxQkFBcUIsRUFBRSxxQkFBcUI7SUFDOUUsSUFBSSxDQUFDLHFCQUFxQjtRQUFFLE9BQU8scUJBQXFCLENBQUE7SUFFeEQsT0FBTztRQUNMLEdBQUcscUJBQXFCO1FBQ3hCLEdBQUcscUJBQXFCO1FBQ3hCLE1BQU0sRUFBRTtZQUNOLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDO1lBQ3ZDLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDO1NBQ3hDO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsR0FBRyxDQUFDLHFCQUFxQixDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUM7WUFDMUMsR0FBRyxDQUFDLHFCQUFxQixDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUM7U0FDM0M7S0FDRixDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGdDQUFnQyxDQUFDLEtBQUs7SUFDN0MsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUM7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUVyRSxPQUFPLE1BQU0sQ0FBQTtBQUNmLENBQUM7QUFFRCxNQUFNLDJDQUEyQyxHQUFHLEVBQUUsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFBO0FBQ3BFLE1BQU0sOENBQThDLEdBQUcsR0FBRyxDQUFBO0FBQzFELE1BQU0sNENBQTRDLEdBQUcsRUFBRSxHQUFHLElBQUksR0FBRyxJQUFJLENBQUE7QUFDckUsTUFBTSw2Q0FBNkMsR0FBRyxHQUFHLENBQUE7QUFFekQsTUFBTSw2QkFBNkIsR0FBRyxJQUFJLENBQUE7QUFDMUMsTUFBTSxrQ0FBa0MsR0FBRyxDQUFDLENBQUE7QUFDNUMsTUFBTSw4QkFBOEIsR0FBRyxDQUFDLENBQUE7QUFFeEM7Ozs7OztHQU1HO0FBQ0gsU0FBUyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFlBQVk7SUFDcEQsSUFBSSxLQUFLLEtBQUssU0FBUztRQUFFLE9BQU8sWUFBWSxDQUFBO0lBQzVDLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDNUUsTUFBTSxJQUFJLFNBQVMsQ0FBQyxHQUFHLElBQUksa0NBQWtDLENBQUMsQ0FBQTtJQUNoRSxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUE7QUFDZCxDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxTQUFTLGNBQWMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsWUFBWTtJQUN6RCxJQUFJLEtBQUssS0FBSyxTQUFTO1FBQUUsT0FBTyxZQUFZLENBQUE7SUFDNUMsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssR0FBRyxHQUFHLElBQUksS0FBSyxHQUFHLEdBQUcsRUFBRSxDQUFDO1FBQ3hGLE1BQU0sSUFBSSxTQUFTLENBQUMsR0FBRyxJQUFJLCtCQUErQixHQUFHLFFBQVEsR0FBRyxFQUFFLENBQUMsQ0FBQTtJQUM3RSxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUE7QUFDZCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyx3QkFBd0IsQ0FBQyxLQUFLO0lBQ3JDLElBQUksS0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDMUMsT0FBTyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLDZCQUE2QixFQUFFLGFBQWEsRUFBRSxrQ0FBa0MsRUFBRSxTQUFTLEVBQUUsOEJBQThCLEVBQUMsQ0FBQTtJQUNoSyxDQUFDO0lBRUQsSUFBSSxLQUFLLEtBQUssS0FBSyxFQUFFLENBQUM7UUFDcEIsT0FBTyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLDZCQUE2QixFQUFFLGFBQWEsRUFBRSxrQ0FBa0MsRUFBRSxTQUFTLEVBQUUsOEJBQThCLEVBQUMsQ0FBQTtJQUNqSyxDQUFDO0lBRUQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDeEUsTUFBTSxJQUFJLFNBQVMsQ0FBQywrREFBK0QsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQTtJQUNyRyxDQUFDO0lBRUQsTUFBTSxFQUFDLGFBQWEsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxHQUFHLGVBQWUsRUFBQyxHQUFHLEtBQUssQ0FBQTtJQUNoRixNQUFNLG1CQUFtQixHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7SUFFeEQsSUFBSSxtQkFBbUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDbkMsTUFBTSxJQUFJLFNBQVMsQ0FBQyxpREFBaUQsbUJBQW1CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyw0REFBNEQsQ0FBQyxDQUFBO0lBQ2xLLENBQUM7SUFFRCxJQUFJLE9BQU8sS0FBSyxTQUFTLElBQUksT0FBTyxPQUFPLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDMUQsTUFBTSxJQUFJLFNBQVMsQ0FBQywwREFBMEQsTUFBTSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQTtJQUNsRyxDQUFDO0lBRUQsT0FBTztRQUNMLE9BQU8sRUFBRSxPQUFPLElBQUksSUFBSTtRQUN4QixTQUFTLEVBQUUsbUJBQW1CLENBQUMsU0FBUyxFQUFFLGtDQUFrQyxFQUFFLDZCQUE2QixDQUFDO1FBQzVHLGFBQWEsRUFBRSxjQUFjLENBQUMsYUFBYSxFQUFFLHNDQUFzQyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsa0NBQWtDLENBQUM7UUFDL0gsU0FBUyxFQUFFLGNBQWMsQ0FBQyxTQUFTLEVBQUUsa0NBQWtDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSw4QkFBOEIsQ0FBQztLQUMvRyxDQUFBO0FBQ0gsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sc0JBQXNCO0lBQ3pDOztzQ0FFa0M7SUFDbEMsZ0NBQWdDLEdBQUcsSUFBSSxDQUFBO0lBRXZDLDBEQUEwRDtJQUMxRCxnQ0FBZ0MsR0FBRyxTQUFTLENBQUE7SUFFNUM7Ozs7O21FQUsrRDtJQUMvRCx3QkFBd0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBRXBDOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxPQUFPO1FBQ1osT0FBTyxvQkFBb0IsRUFBRSxDQUFBO0lBQy9CLENBQUM7SUFFRDs7O09BR0c7SUFDSCxZQUFZLEVBQUMsZUFBZSxFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxRQUFRLEdBQUcsSUFBSSxFQUFFLGNBQWMsRUFBRSxlQUFlLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLEtBQUssR0FBRyxLQUFLLEVBQUUsYUFBYSxHQUFHLEtBQUssRUFBRSxXQUFXLEdBQUcsS0FBSyxFQUFFLFNBQVMsRUFBRSwyQkFBMkIsR0FBRyxJQUFJLEVBQUUsV0FBVyxFQUFFLGtCQUFrQixFQUFFLDZCQUE2QixFQUFFLG9CQUFvQixFQUFFLFVBQVUsRUFBRSxnQkFBZ0IsRUFBRSxZQUFZLEVBQUUsTUFBTSxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsZ0JBQWdCLEVBQUUsa0JBQWtCLEVBQUUsdUJBQXVCLEVBQUUseUJBQXlCLEVBQUUsWUFBWSxFQUFFLElBQUksRUFBRSx1QkFBdUIsRUFBRSxzQkFBc0IsRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxxQkFBcUIsRUFBRSxjQUFjLEVBQUUsd0JBQXdCLEVBQUUsK0JBQStCLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDbnZCLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsZUFBZSxDQUFBO1FBQ3ZDLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxnQkFBZ0IsSUFBSSxFQUFFLENBQUE7UUFDL0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxRQUFRLENBQUE7UUFDekIsSUFBSSxDQUFDLGVBQWUsR0FBRyxjQUFjLENBQUE7UUFDckMsSUFBSSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUE7UUFDckI7O3dIQUVnSDtRQUNoSCxJQUFJLENBQUMsYUFBYSxHQUFHLFNBQVMsQ0FBQTtRQUM5Qjs7NklBRXFJO1FBQ3JJLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxTQUFTLENBQUE7UUFDdEM7OztXQUdHO1FBQ0gsSUFBSSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsQ0FBQTtRQUNuQzs7O1dBR0c7UUFDSCxJQUFJLENBQUMscUJBQXFCLEdBQUcsS0FBSyxDQUFBO1FBQ2xDOzs7V0FHRztRQUNILElBQUksQ0FBQyxvQkFBb0IsR0FBRyxTQUFTLENBQUE7UUFDckMsSUFBSSxDQUFDLHdCQUF3QixHQUFHLHVCQUF1QixDQUFBO1FBQ3ZELElBQUksQ0FBQyxZQUFZLEdBQUcsV0FBVyxJQUFJLEVBQUUsQ0FBQTtRQUNyQywyRUFBMkU7UUFDM0UsZ0ZBQWdGO1FBQ2hGLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO1FBQ25FLGtGQUFrRjtRQUNsRixJQUFJLENBQUMsNEJBQTRCLEdBQUcsRUFBRSxDQUFBO1FBQ3RDLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxhQUFhLEdBQUcsWUFBWSxDQUFBO1FBQ2pDLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO1FBQ2xCLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQ2pFLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQzNELElBQUksQ0FBQyxZQUFZLEdBQUcsV0FBVyxJQUFJLFVBQVUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLGFBQWEsSUFBSSxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLElBQUksYUFBYSxDQUFBO1FBQzdILElBQUksQ0FBQyxtQkFBbUIsR0FBRyxrQkFBa0IsQ0FBQTtRQUM3QyxJQUFJLENBQUMsNEJBQTRCLEdBQUcsMkJBQTJCLENBQUE7UUFDL0QsSUFBSSxDQUFDLDhCQUE4QixHQUFHLDZCQUE2QixLQUFLLFNBQVM7WUFDL0UsQ0FBQyxDQUFDLHlCQUF5QixLQUFLLElBQUk7WUFDcEMsQ0FBQyxDQUFDLDZCQUE2QixDQUFBO1FBQ2pDLElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO1FBQzNCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxnQkFBZ0IsQ0FBQTtRQUN6QyxpQ0FBaUM7UUFDakMsSUFBSSxDQUFDLFNBQVMsR0FBRyxDQUFDLFFBQVEsSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBRTlFLHdFQUF3RTtRQUN4RSx1RUFBdUU7UUFDdkUsdUVBQXVFO1FBQ3ZFLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxFQUFFLHdCQUF3QixDQUFBO1FBRXRGLEtBQUssTUFBTSxnQkFBZ0IsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDOUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyw2QkFBNkIsQ0FBQyxFQUFDLHdCQUF3QixFQUFFLDJCQUEyQixFQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3JJLENBQUM7UUFFRCxJQUFJLENBQUMsY0FBYyxHQUFHLEtBQUssQ0FBQTtRQUMzQix1RkFBdUY7UUFDdkYsSUFBSSxDQUFDLDBCQUEwQixHQUFHLFNBQVMsQ0FBQTtRQUMzQyxtREFBbUQ7UUFDbkQsSUFBSSxDQUFDLHVCQUF1QixHQUFHLEVBQUUsQ0FBQTtRQUNqQyxzQkFBc0I7UUFDdEIsSUFBSSxDQUFDLGdDQUFnQyxHQUFHLEtBQUssQ0FBQTtRQUM3Qyx3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLFNBQVMsQ0FBQTtRQUNqQyx3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLHdCQUF3QixHQUFHLFNBQVMsQ0FBQTtRQUN6QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsS0FBSyxDQUFBO1FBQy9COzs7V0FHRztRQUNILElBQUksQ0FBQyw4QkFBOEIsR0FBRyxDQUFDLENBQUE7UUFDdkM7Ozs7O1dBS0c7UUFDSCxJQUFJLENBQUMsd0JBQXdCLEdBQUcsU0FBUyxDQUFBO1FBQ3pDOzs7OztXQUtHO1FBQ0gsSUFBSSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsQ0FBQTtRQUNuQyxpQ0FBaUM7UUFDakMsSUFBSSxDQUFDLDRCQUE0QixHQUFHLFNBQVMsQ0FBQTtRQUM3QyxNQUFNLHFCQUFxQixHQUFHLFVBQVUsRUFBRSxxQkFBcUIsQ0FBQTtRQUMvRCxNQUFNLHNCQUFzQixHQUFHLFVBQVUsRUFBRSxzQkFBc0IsQ0FBQTtRQUVqRSxJQUFJLENBQUMsVUFBVSxHQUFHO1lBQ2hCLEdBQUcsQ0FBQyxVQUFVLElBQUksRUFBRSxDQUFDO1lBQ3JCLFdBQVcsRUFBRSx3QkFBd0IsQ0FBQyxVQUFVLEVBQUUsV0FBVyxDQUFDO1lBQzlELHFCQUFxQixFQUFFO2dCQUNyQixlQUFlLEVBQUUsbUJBQW1CLENBQUMscUJBQXFCLEVBQUUsZUFBZSxFQUFFLGtEQUFrRCxFQUFFLDJDQUEyQyxDQUFDO2dCQUM3SyxrQkFBa0IsRUFBRSxtQkFBbUIsQ0FBQyxxQkFBcUIsRUFBRSxrQkFBa0IsRUFBRSxxREFBcUQsRUFBRSw4Q0FBOEMsQ0FBQzthQUMxTDtZQUNELHNCQUFzQixFQUFFO2dCQUN0QixlQUFlLEVBQUUsbUJBQW1CLENBQUMsc0JBQXNCLEVBQUUsZUFBZSxFQUFFLG1EQUFtRCxFQUFFLDRDQUE0QyxDQUFDO2dCQUNoTCxnQkFBZ0IsRUFBRSxtQkFBbUIsQ0FBQyxzQkFBc0IsRUFBRSxnQkFBZ0IsRUFBRSxvREFBb0QsRUFBRSw2Q0FBNkMsQ0FBQzthQUNyTDtTQUNGLENBQUE7UUFDRDs7a0hBRTBHO1FBQzFHLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxTQUFTLENBQUE7UUFDcEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLGVBQWUsR0FBRyxlQUFlLENBQUE7UUFDdEMsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7UUFDdEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxZQUFZLENBQUE7UUFDakMsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUE7UUFDdkIsSUFBSSxDQUFDLFNBQVMsR0FBRyxRQUFRLENBQUE7UUFDekIsSUFBSSxDQUFDLHNCQUFzQixHQUFHLHFCQUFxQixDQUFBO1FBQ25ELElBQUksQ0FBQyxlQUFlLEdBQUcsY0FBYyxDQUFBO1FBQ3JDLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxnQkFBZ0IsQ0FBQTtRQUN6QyxJQUFJLENBQUMsYUFBYSxHQUFHLFlBQVksQ0FBQTtRQUNqQyxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNuRCxJQUFJLENBQUMsd0JBQXdCLEdBQUcsdUJBQXVCLElBQUksRUFBRSxDQUFBO1FBQzdELElBQUksQ0FBQyx1QkFBdUIsR0FBRyxzQkFBc0IsQ0FBQTtRQUNyRCxJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQTtRQUNyQyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFBO1FBQ2pDOztzRUFFOEQ7UUFDOUQsSUFBSSxDQUFDLDRCQUE0QixHQUFHLFNBQVMsQ0FBQTtRQUM3QyxJQUFJLENBQUMseUJBQXlCLEdBQUcsd0JBQXdCLENBQUE7UUFDekQsSUFBSSxDQUFDLGdDQUFnQyxHQUFHLCtCQUErQixDQUFBO1FBQ3ZFOztpR0FFeUY7UUFDekYsSUFBSSxDQUFDLDJCQUEyQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFNUM7OzhGQUVzRjtRQUN0RixJQUFJLENBQUMsd0JBQXdCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUV6Qzs7O1dBR0c7UUFDSCxJQUFJLENBQUMsOEJBQThCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUUvQzs7Ozs7O3dDQU1nQztRQUNoQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUUxQzs7OztrR0FJMEY7UUFDMUYsSUFBSSxDQUFDLDRCQUE0QixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7UUFFakQ7OztXQUdHO1FBQ0gsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFbkM7OztXQUdHO1FBQ0gsSUFBSSxDQUFDLHdCQUF3QixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFekMsNEVBQTRFO1FBQzVFLElBQUksQ0FBQyw2QkFBNkIsR0FBRyxHQUFHLENBQUE7UUFFeEMsc0dBQXNHO1FBQ3RHLElBQUksQ0FBQyxpQ0FBaUMsR0FBRyxFQUFFLENBQUE7UUFFM0M7Ozs7OztXQU1HO1FBQ0gsSUFBSSxDQUFDLHVCQUF1QixHQUFHLElBQUksQ0FBQTtRQUVuQzs7OFFBRXNRO1FBQ3RRLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFBO1FBRXpCOzsrS0FFdUs7UUFDdkssSUFBSSxDQUFDLGlDQUFpQyxHQUFHLElBQUksQ0FBQTtRQUM3QyxJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQTtRQUN2QixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksV0FBVyxDQUFDLEVBQUMsY0FBYyxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFBO1FBQzlFLElBQUksQ0FBQyxjQUFjLEdBQUcsYUFBYSxDQUFBO1FBQ25DLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFBO1FBQzFELElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFBO1FBQ2pDLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBRS9COztxQ0FFNkI7UUFDN0IsSUFBSSxDQUFDLG1CQUFtQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7UUFDeEMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLFlBQVksRUFBRSxDQUFBO1FBRXRDOztnRkFFd0U7UUFDeEUsSUFBSSxDQUFDLGFBQWEsR0FBRyxFQUFFLENBQUE7UUFDdkIsSUFBSSxDQUFDLDhCQUE4QixHQUFHLElBQUksNkJBQTZCLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxvQkFBb0IsRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFBO1FBRXBKOzswRkFFa0Y7UUFDbEYsSUFBSSxDQUFDLFlBQVksR0FBRyxFQUFFLENBQUE7UUFFdEIsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDckQsQ0FBQztJQUVEOzs7T0FHRztJQUNILFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUEsQ0FBQyxDQUFDO0lBRXZDOzs7T0FHRztJQUNILGdDQUFnQyxLQUFLLE9BQU8sSUFBSSxDQUFDLDhCQUE4QixLQUFLLElBQUksQ0FBQSxDQUFDLENBQUM7SUFFMUY7Ozs7T0FJRztJQUNILDRCQUE0QixLQUFLLE9BQU8sQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFFbEY7OztPQUdHO0lBQ0gsZ0JBQWdCLEtBQUssT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFBLENBQUMsQ0FBQztJQUVqRDs7O09BR0c7SUFDSCxzQkFBc0I7UUFDcEIsT0FBTztZQUNMLE9BQU8sRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLE9BQU87WUFDcEMsSUFBSSxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSTtZQUM5QixlQUFlLEVBQUUsT0FBTyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDO1NBQ3BELENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHVCQUF1QixDQUFDLEtBQUs7UUFDM0IsSUFBSSxLQUFLLEtBQUssS0FBSyxJQUFJLEtBQUssS0FBSyxTQUFTO1lBQUUsT0FBTyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQTtRQUMxRyxJQUFJLEtBQUssS0FBSyxJQUFJO1lBQUUsT0FBTyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQTtRQUVqRixJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDaEQsTUFBTSxJQUFJLEtBQUssQ0FBQywwREFBMEQsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUM1RixDQUFDO1FBRUQsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksSUFBSSxrQkFBa0IsQ0FBQTtRQUU3QyxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN0RCxNQUFNLElBQUksS0FBSyxDQUFDLHNFQUFzRSxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ3ZHLENBQUM7UUFFRCxNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFBO1FBRXBGLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDbkUsTUFBTSxJQUFJLEtBQUssQ0FBQywrREFBK0QsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNqRyxDQUFDO1FBRUQsT0FBTyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsRUFBQyxDQUFBO0lBQzNFLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsS0FBSztRQUN6QixJQUFJLEtBQUssS0FBSyxLQUFLLElBQUksS0FBSyxLQUFLLFNBQVM7WUFBRSxPQUFPLEVBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsZUFBZSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQTtRQUN2RyxJQUFJLEtBQUssS0FBSyxJQUFJO1lBQUUsT0FBTyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUE7UUFFOUUsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxLQUFLLElBQUksRUFBRSxDQUFDO1lBQ2hELE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDMUYsQ0FBQztRQUVELE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLElBQUksZUFBZSxDQUFBO1FBRTFDLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3RELE1BQU0sSUFBSSxLQUFLLENBQUMsb0VBQW9FLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDckcsQ0FBQztRQUVELE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLEtBQUssU0FBUyxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUE7UUFFcEYsSUFBSSxLQUFLLEtBQUssSUFBSSxJQUFJLENBQUMsT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUNuRSxNQUFNLElBQUksS0FBSyxDQUFDLDZEQUE2RCxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQy9GLENBQUM7UUFFRCxPQUFPLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxFQUFDLENBQUE7SUFDM0UsQ0FBQztJQUVEOzs7T0FHRztJQUNILHdCQUF3QjtRQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPO1lBQUUsT0FBTTtRQUV0QyxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxFQUFDLFdBQVcsRUFBRSxPQUFPLEVBQUMsRUFBRSxFQUFFO1lBQ25ELElBQUksT0FBTyxDQUFDLFVBQVUsRUFBRSxLQUFLLEtBQUs7Z0JBQUUsT0FBTyxJQUFJLENBQUE7WUFDL0MsSUFBSSxXQUFXLEtBQUssSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBRXZELElBQUksSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsOEJBQThCLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBRWxILE9BQU87Z0JBQ0wsTUFBTSxFQUFFLE1BQU07Z0JBQ2QsVUFBVSxFQUFFLHNCQUFzQjtnQkFDbEMsY0FBYyxFQUFFLHVDQUF1QztnQkFDdkQseUJBQXlCLEVBQUUsSUFBSTtnQkFDL0IscUJBQXFCLEVBQUUsSUFBSTtnQkFDM0Isb0JBQW9CLEVBQUUsSUFBSTtnQkFDMUIsUUFBUSxFQUFFLHlCQUF5QjthQUNwQyxDQUFBO1FBQ0gsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsMEJBQTBCO1FBQ3hCLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLE9BQU87WUFBRSxPQUFNO1FBRXhDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLEVBQUMsV0FBVyxFQUFFLE9BQU8sRUFBQyxFQUFFLEVBQUU7WUFDbkQsSUFBSSxPQUFPLENBQUMsVUFBVSxFQUFFLEtBQUssS0FBSztnQkFBRSxPQUFPLElBQUksQ0FBQTtZQUMvQyxJQUFJLFdBQVcsS0FBSyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUk7Z0JBQUUsT0FBTyxJQUFJLENBQUE7WUFFekQsMEVBQTBFO1lBQzFFLHlFQUF5RTtZQUN6RSxJQUFJLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLDhCQUE4QixDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQztnQkFBRSxPQUFPLElBQUksQ0FBQTtZQUV0SCxPQUFPO2dCQUNMLE1BQU0sRUFBRSxNQUFNO2dCQUNkLFVBQVUsRUFBRSxnQkFBZ0I7Z0JBQzVCLGNBQWMsRUFBRSxnQ0FBZ0M7Z0JBQ2hELHlCQUF5QixFQUFFLElBQUk7Z0JBQy9CLHFCQUFxQixFQUFFLElBQUk7Z0JBQzNCLG9CQUFvQixFQUFFLElBQUk7Z0JBQzFCLFFBQVEsRUFBRSxrQkFBa0I7YUFDN0IsQ0FBQTtRQUNILENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxXQUFXLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxTQUFTLEdBQUcsUUFBUSxDQUFBLENBQUMsQ0FBQztJQUVuRDs7O09BR0c7SUFDSCxPQUFPO1FBQ0wsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7O09BR0c7SUFDSCx3QkFBd0I7UUFDdEIsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQTtJQUMzQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsb0JBQW9CO1FBQ2xCLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtJQUNuQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsNkJBQTZCO1FBQzNCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDLHVCQUF1QixDQUFBO1FBRXZFLE9BQU8sNkJBQTZCLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDbkQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwyQkFBMkIsQ0FBQyxJQUFJO1FBQzlCLE1BQU0sR0FBRyxHQUFHLElBQUksRUFBRSxHQUFHLENBQUE7UUFDckIsTUFBTSxpQ0FBaUMsR0FBRyxJQUFJLEVBQUUsaUNBQWlDLElBQUksSUFBSSxDQUFBO1FBQ3pGLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxFQUFFLHVCQUF1QixDQUFBO1FBQzdELE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxFQUFFLHVCQUF1QixJQUFJLEVBQUUsQ0FBQTtRQUNuRSxNQUFNLGlCQUFpQixHQUFHLElBQUksRUFBRSxpQkFBaUIsQ0FBQTtRQUVqRCxJQUFJLGlDQUFpQyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8saUNBQWlDLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsaUNBQWlDLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDOUosTUFBTSxJQUFJLEtBQUssQ0FBQyw2RUFBNkUsQ0FBQyxDQUFBO1FBQ2hHLENBQUM7UUFDRCxJQUFJLHVCQUF1QixLQUFLLFNBQVMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLHVCQUF1QixJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDMUgsTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFBeUQsQ0FBQyxDQUFBO1FBQzVFLENBQUM7UUFDRCxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQTtRQUM3RyxJQUFJLGlCQUFpQixLQUFLLFNBQVMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLGlCQUFpQixJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDeEcsTUFBTSxJQUFJLEtBQUssQ0FBQywwRUFBMEUsQ0FBQyxDQUFBO1FBQzdGLENBQUM7UUFFRCxPQUFPO1lBQ0wsR0FBRyxFQUFFLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxHQUFHLENBQUM7WUFDN0MsdUJBQXVCLEVBQUUsdUJBQXVCLElBQUksS0FBSztZQUN6RCxNQUFNLEVBQUUsSUFBSSxDQUFDLGlDQUFpQyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUM7WUFDNUQsaUNBQWlDO1lBQ2pDLHVCQUF1QixFQUFFLHVCQUF1QixDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsK0JBQStCLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDbkcsaUJBQWlCLEVBQUUsaUJBQWlCLElBQUksRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSTtTQUM1RCxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxpQ0FBaUMsQ0FBQyxNQUFNO1FBQ3RDLElBQUksTUFBTSxLQUFLLFNBQVMsSUFBSSxNQUFNLEtBQUssSUFBSTtZQUFFLE9BQU8sU0FBUyxDQUFBO1FBRTdELElBQUksT0FBTyxNQUFNLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUN4RCxNQUFNLElBQUksS0FBSyxDQUFDLHNFQUFzRSxDQUFDLENBQUE7UUFDekYsQ0FBQztRQUVELE1BQU0sRUFBQyxtQkFBbUIsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxlQUFlLEVBQUUsWUFBWSxFQUFFLEdBQUcsVUFBVSxFQUFDLEdBQUcsTUFBTSxDQUFBO1FBQ2hKLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFOUMsSUFBSSxjQUFjLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzlCLE1BQU0sSUFBSSxLQUFLLENBQUMsc0NBQXNDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGdJQUFnSSxDQUFDLENBQUE7UUFDbE4sQ0FBQztRQUNELElBQUksQ0FBQyxTQUFTLElBQUksT0FBTyxTQUFTLEtBQUssUUFBUSxJQUFJLE9BQU8sU0FBUyxDQUFDLElBQUksS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN4RixNQUFNLElBQUksS0FBSyxDQUFDLG1IQUFtSCxDQUFDLENBQUE7UUFDdEksQ0FBQztRQUNELElBQUksT0FBTyxtQkFBbUIsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUM5QyxNQUFNLElBQUksS0FBSyxDQUFDLHFHQUFxRyxDQUFDLENBQUE7UUFDeEgsQ0FBQztRQUNELElBQUksUUFBUSxLQUFLLFNBQVMsSUFBSSxPQUFPLFFBQVEsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUM3RCxNQUFNLElBQUksS0FBSyxDQUFDLGdFQUFnRSxDQUFDLENBQUE7UUFDbkYsQ0FBQztRQUNELElBQUksT0FBTyxLQUFLLFNBQVMsSUFBSSxPQUFPLE9BQU8sS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUMzRCxNQUFNLElBQUksS0FBSyxDQUFDLDJFQUEyRSxDQUFDLENBQUE7UUFDOUYsQ0FBQztRQUNELElBQUksU0FBUyxLQUFLLFNBQVMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsSUFBSSxTQUFTLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNoRixNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUE7UUFDckUsQ0FBQztRQUNELElBQUksU0FBUyxLQUFLLFNBQVMsSUFBSSxDQUFDLE9BQU8sU0FBUyxLQUFLLFFBQVEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQzdGLE1BQU0sSUFBSSxLQUFLLENBQUMsbURBQW1ELE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDekYsQ0FBQztRQUNELElBQUksZUFBZSxLQUFLLFNBQVMsSUFBSSxDQUFDLE9BQU8sZUFBZSxLQUFLLFFBQVEsSUFBSSxlQUFlLEtBQUssSUFBSSxJQUFJLE9BQU8sZUFBZSxDQUFDLGdCQUFnQixLQUFLLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDakssTUFBTSxJQUFJLEtBQUssQ0FBQyx1SEFBdUgsQ0FBQyxDQUFBO1FBQzFJLENBQUM7UUFDRCxJQUFJLFlBQVksS0FBSyxTQUFTLElBQUksT0FBTyxZQUFZLEtBQUssUUFBUSxJQUFJLE9BQU8sWUFBWSxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3pHLE1BQU0sSUFBSSxLQUFLLENBQUMsbUZBQW1GLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDNUgsQ0FBQztRQUVELE9BQU87WUFDTCxtQkFBbUI7WUFDbkIsU0FBUztZQUNULFFBQVE7WUFDUixTQUFTLEVBQUUsQ0FBQyxTQUFTLElBQUksaUJBQWlCLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxJQUFJLEdBQUc7WUFDdkUsT0FBTztZQUNQLFFBQVE7WUFDUixTQUFTO1lBQ1QsZUFBZTtZQUNmLFlBQVk7U0FDYixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCw4QkFBOEIsQ0FBQyxHQUFHO1FBQ2hDLElBQUksR0FBRyxLQUFLLFNBQVMsSUFBSSxHQUFHLEtBQUssSUFBSTtZQUFFLE9BQU8sU0FBUyxDQUFBO1FBRXZELElBQUksT0FBTyxHQUFHLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNsRCxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUE7UUFDcEUsQ0FBQztRQUVELE1BQU0sRUFBQyxTQUFTLEVBQUUsYUFBYSxFQUFDLEdBQUcsR0FBRyxDQUFBO1FBRXRDLElBQUksT0FBTyxhQUFhLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDeEMsTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFBeUQsTUFBTSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNuRyxDQUFDO1FBQ0QsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixhQUFhLENBQUMsSUFBSSxnQ0FBZ0MsQ0FBQyxDQUFBO1FBQy9GLENBQUM7UUFDRCxJQUFJLFNBQVMsS0FBSyxTQUFTLElBQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxRQUFRLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUM3RixNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxNQUFNLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ3RGLENBQUM7UUFFRCxPQUFPLEVBQUMsU0FBUyxFQUFFLGFBQWEsRUFBQyxDQUFBO0lBQ25DLENBQUM7SUFFRDs7O09BR0c7SUFDSCx3QkFBd0I7UUFDdEIsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxDQUFBO1FBRWhFLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDMUMsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsSUFBSSxDQUFDLGNBQWMsRUFBRSxNQUFNLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDbkksQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUE7SUFDdEQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsNEJBQTRCLENBQUMsVUFBVSxFQUFFLE1BQU0sR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7UUFDdkUsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUV6RSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLDJDQUEyQyxVQUFVLEVBQUUsQ0FBQyxDQUFBO1FBQzFFLENBQUM7UUFFRCxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztZQUMxRCxPQUFPLHFCQUFxQixDQUFBO1FBQzlCLENBQUM7UUFFRCxNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQztZQUN6RCxhQUFhLEVBQUUsSUFBSTtZQUNuQixxQkFBcUI7WUFDckIsVUFBVTtZQUNWLE1BQU07U0FDUCxDQUFDLENBQUE7UUFFRixPQUFPLDBCQUEwQixDQUFDLHFCQUFxQixFQUFFLHFCQUFxQixDQUFDLENBQUE7SUFDakYsQ0FBQztJQUVEOzs7T0FHRztJQUNILDhCQUE4QjtRQUM1QixNQUFNLG1CQUFtQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDckMsTUFBTSxzQkFBc0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHVDQUF1QyxDQUFBO1FBRWxGLElBQUksc0JBQXNCLEVBQUUsQ0FBQztZQUMzQixLQUFLLE1BQU0sVUFBVSxJQUFJLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUMzRCxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUE7Z0JBRWpDLElBQUksT0FBTztvQkFBRSxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDL0MsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLEtBQUssR0FBRyxFQUFFLENBQUM7WUFDaEQsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2xDLENBQUM7UUFFRCxPQUFPLG1CQUFtQixDQUFBO0lBQzVCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILDBCQUEwQixDQUFDLFVBQVUsRUFBRSxNQUFNLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFO1FBQ3JFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFekUsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7WUFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQywyQ0FBMkMsVUFBVSxFQUFFLENBQUMsQ0FBQTtRQUMxRSxDQUFDO1FBRUQsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFVBQVU7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUNsRCxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksQ0FBQyxJQUFJLENBQUMsdUJBQXVCO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFdkUsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUM7WUFDekQsYUFBYSxFQUFFLElBQUk7WUFDbkIscUJBQXFCO1lBQ3JCLFVBQVU7WUFDVixNQUFNO1NBQ1AsQ0FBQyxDQUFBO1FBRUYsT0FBTyxPQUFPLENBQUMscUJBQXFCLENBQUMsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsc0JBQXNCO1FBQ3BCLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUMsQ0FBQTtRQUNoRSxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyw4QkFBOEIsRUFBRSxDQUFBO1FBRWpFLE9BQU8sV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksSUFBSSxDQUFDLDBCQUEwQixDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUE7SUFDaEksQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxnQkFBZ0I7UUFDcEIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFFbEQsT0FBTztZQUNMLEdBQUcsYUFBYTtZQUNoQixVQUFVLEVBQUUsTUFBTSxJQUFJLENBQUMsd0JBQXdCLEVBQUU7U0FDbEQsQ0FBQTtJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxxQkFBcUI7UUFDbkIsT0FBTztZQUNMLGNBQWMsRUFBRSxJQUFJLENBQUMsNEJBQTRCLEVBQUU7WUFDbkQsYUFBYSxFQUFFLElBQUksQ0FBQywyQkFBMkIsRUFBRTtZQUNqRCxRQUFRLEVBQUUsSUFBSSxDQUFDLHNCQUFzQixFQUFFO1lBQ3ZDLFdBQVcsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtZQUNyQyxNQUFNLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixFQUFFO1lBQ25DLFVBQVUsRUFBRSxJQUFJLENBQUMsdUJBQXVCLEVBQUU7U0FDM0MsQ0FBQTtJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsd0JBQXdCO1FBQzVCLE1BQU0sVUFBVSxHQUFHLDRHQUE0RyxDQUFDLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLENBQUE7UUFFMUosSUFBSSxDQUFDLFVBQVUsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDO1lBQ2xDLE9BQU8sRUFBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFDLENBQUE7UUFDOUQsQ0FBQztRQUVELE9BQU8sTUFBTSxVQUFVLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtJQUM1QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsb0JBQW9CO1FBQ2xCLE1BQU0sV0FBVyxHQUFHLE9BQU8sT0FBTyxLQUFLLFdBQVcsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUE7UUFFeEUsT0FBTztZQUNMLFdBQVcsRUFBRSxJQUFJLENBQUMsY0FBYyxFQUFFO1lBQ2xDLFdBQVcsRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUNoRSxXQUFXLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxJQUFJO1lBQ3hDLEdBQUcsRUFBRSxXQUFXLEVBQUUsR0FBRztZQUNyQixRQUFRLEVBQUUsV0FBVyxFQUFFLFFBQVE7WUFDL0IsYUFBYSxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTO1NBQzlELENBQUE7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsMkJBQTJCO1FBQ3pCLE9BQU87WUFDTCxXQUFXLEVBQUUsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUMsT0FBTyxFQUFFLEtBQUssRUFBQztZQUM3SixRQUFRLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRTtZQUM1QixLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUssS0FBSyxJQUFJO1lBQzFCLGFBQWEsRUFBRSxJQUFJLENBQUMsc0JBQXNCLEVBQUU7WUFDNUMsMkJBQTJCLEVBQUUsSUFBSSxDQUFDLDhCQUE4QixFQUFFO1lBQ2xFLDZCQUE2QixFQUFFLElBQUksQ0FBQyxnQ0FBZ0MsRUFBRTtZQUN0RSxXQUFXLEVBQUUsSUFBSSxDQUFDLGNBQWM7WUFDaEMsT0FBTyxFQUFFO2dCQUNQLGFBQWEsRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFFLGFBQWEsS0FBSyxJQUFJO2dCQUNwRCxPQUFPLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7YUFDekQ7U0FDRixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILDRCQUE0QjtRQUMxQixPQUFPO1lBQ0wsVUFBVSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDO1lBQ3pDLG1CQUFtQixFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsd0JBQXdCLENBQUM7U0FDNUQsQ0FBQTtJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxzQkFBc0I7UUFDcEI7O2lHQUV5RjtRQUN6RixNQUFNLGFBQWEsR0FBRyxFQUFFLENBQUE7UUFDeEIsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUV2RCxLQUFLLE1BQU0sVUFBVSxJQUFJLGlCQUFpQixFQUFFLENBQUM7WUFDM0MsYUFBYSxDQUFDLFVBQVUsQ0FBQyxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUNqRixDQUFDO1FBRUQsT0FBTztZQUNMLGlCQUFpQjtZQUNqQixtQkFBbUIsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyw4QkFBOEIsRUFBRSxDQUFDO1lBQ3RFLGdCQUFnQixFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQztZQUNqRCxLQUFLLEVBQUUsYUFBYTtTQUNyQixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILHVCQUF1QjtRQUNyQjs7d1BBRWdQO1FBQ2hQLE1BQU0sY0FBYyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDaEM7OytPQUV1TztRQUN2TyxNQUFNLGNBQWMsR0FBRyxFQUFFLENBQUE7UUFDekIsTUFBTSxhQUFhLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsOEJBQThCLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxvQkFBb0IsQ0FBQyxFQUFFLEVBQUU7WUFDdEg7OzhHQUVrRztZQUNsRyxNQUFNLGNBQWMsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1lBRWhDLEtBQUssTUFBTSxZQUFZLElBQUksb0JBQW9CLEVBQUUsQ0FBQztnQkFDaEQsTUFBTSxPQUFPLEdBQUcsNERBQTRELENBQUMsQ0FBQywyQkFBMkIsQ0FBQyxZQUFZLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQyxDQUFBO2dCQUN4SSxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUNuQyxNQUFNLGNBQWMsR0FBRyxjQUFjLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUU5QyxJQUFJLGNBQWMsRUFBRSxDQUFDO29CQUNuQixjQUFjLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQTtnQkFDM0IsQ0FBQztxQkFBTSxDQUFDO29CQUNOLGNBQWMsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLEVBQUMsS0FBSyxFQUFFLENBQUMsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO2dCQUM5QyxDQUFDO1lBQ0gsQ0FBQztZQUVELE9BQU87Z0JBQ0wsT0FBTztnQkFDUCxLQUFLLEVBQUUsb0JBQW9CLENBQUMsSUFBSTtnQkFDaEMsT0FBTyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDO2FBQy9FLENBQUE7UUFDSCxDQUFDLENBQUMsQ0FBQTtRQUVGLEtBQUssTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDOUM7O2lHQUVxRjtZQUNyRixNQUFNLDBCQUEwQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7WUFFNUMsS0FBSyxNQUFNLEVBQUMsV0FBVyxFQUFFLFlBQVksRUFBQyxJQUFJLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO2dCQUNqRixNQUFNLE9BQU8sR0FBRyw0REFBNEQsQ0FBQyxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFBO2dCQUMzRyxNQUFNLEtBQUssR0FBRyxPQUFPLE9BQU8sQ0FBQyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7Z0JBQ3RFLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBQyxXQUFXLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtnQkFDaEQsTUFBTSxjQUFjLEdBQUcsMEJBQTBCLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUUxRCxJQUFJLGNBQWMsRUFBRSxDQUFDO29CQUNuQixjQUFjLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQTtnQkFDM0IsQ0FBQztxQkFBTSxDQUFDO29CQUNOLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsRUFBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO2dCQUNyRSxDQUFDO1lBQ0gsQ0FBQztZQUVELE1BQU0sb0JBQW9CLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzlHLE1BQU0sUUFBUSxHQUFHO2dCQUNmLHdCQUF3QixFQUFFLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJO2dCQUM1RCxvQkFBb0I7Z0JBQ3BCLGVBQWUsRUFBRSxPQUFPLENBQUMsWUFBWSxDQUFDLElBQUk7Z0JBQzFDLE1BQU0sRUFBRSxPQUFPLENBQUMsT0FBTztnQkFDdkIsa0JBQWtCLEVBQUUsT0FBTyxDQUFDLGNBQWMsQ0FBQyxNQUFNO2dCQUNqRCxpQkFBaUIsRUFBRSxPQUFPLENBQUMsYUFBYSxDQUFDLElBQUk7YUFDOUMsQ0FBQTtZQUNELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQy9CLHdCQUF3QixFQUFFLFFBQVEsQ0FBQyx3QkFBd0I7Z0JBQzNELG9CQUFvQixFQUFFLFFBQVEsQ0FBQyxvQkFBb0I7Z0JBQ25ELGVBQWUsRUFBRSxRQUFRLENBQUMsZUFBZTtnQkFDekMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxNQUFNO2dCQUN2QixpQkFBaUIsRUFBRSxRQUFRLENBQUMsaUJBQWlCO2FBQzlDLENBQUMsQ0FBQTtZQUNGLE1BQU0sY0FBYyxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUE7WUFFcEQsSUFBSSxjQUFjLEVBQUUsQ0FBQztnQkFDbkIsY0FBYyxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUE7WUFDM0IsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFO29CQUM1QixLQUFLLEVBQUUsQ0FBQztvQkFDUixPQUFPLEVBQUU7d0JBQ1Asd0JBQXdCLEVBQUUsUUFBUSxDQUFDLHdCQUF3Qjt3QkFDM0Qsb0JBQW9CLEVBQUUsUUFBUSxDQUFDLG9CQUFvQjt3QkFDbkQsZUFBZSxFQUFFLFFBQVEsQ0FBQyxlQUFlO3dCQUN6QyxNQUFNLEVBQUUsUUFBUSxDQUFDLE1BQU07d0JBQ3ZCLGlCQUFpQixFQUFFLFFBQVEsQ0FBQyxpQkFBaUI7cUJBQzlDO2lCQUNGLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFDRCxjQUFjLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQy9CLENBQUM7UUFFRCxPQUFPO1lBQ0wsY0FBYyxFQUFFLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJO1lBQ2xELGtCQUFrQixFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksRUFBRSxDQUFDO1lBQ3BFLHFCQUFxQixFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLDJCQUEyQixDQUFDLElBQUksRUFBRSxDQUFDO1lBQzFFLGNBQWMsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQztZQUNyRixZQUFZLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUk7WUFDMUMsUUFBUSxFQUFFLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLEdBQUcsQ0FBQyxDQUFDLHdCQUF3QixDQUFDO1lBQ2hHLGtCQUFrQixFQUFFLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJO1lBQzVELGFBQWE7U0FDZCxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsVUFBVSxHQUFHLFNBQVM7UUFDcEMsSUFBSSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQ2hELElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUN6QyxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxVQUFVLENBQUMsQ0FBQTtJQUNoRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZ0NBQWdDLEtBQUssT0FBTyxJQUFJLENBQUMsOEJBQThCLENBQUEsQ0FBQyxDQUFDO0lBRWpGOzs7T0FHRztJQUNILGtDQUFrQyxLQUFLLE9BQU8sSUFBSSxDQUFDLDhCQUE4QixDQUFDLFVBQVUsRUFBRSxDQUFBLENBQUMsQ0FBQztJQUVoRzs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsVUFBVTtRQUM5QixPQUFPLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUN0RCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILDRCQUE0QixDQUFDLFFBQVE7UUFDbkMsS0FBSyxNQUFNLElBQUksSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1lBQ3JELElBQUksSUFBSSxDQUFDLHdCQUF3QixFQUFFLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQ2pELElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3pCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsc0NBQXNDLENBQUMsZ0JBQWdCO1FBQ3JELEtBQUssTUFBTSxVQUFVLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUMxRCxVQUFVLENBQUMsNENBQTRDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUMzRSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxtQkFBbUIsQ0FBQyxVQUFVLEdBQUcsU0FBUztRQUN4QyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFVBQVUsQ0FBQyxFQUFFLFVBQVUsQ0FBQyxDQUFBO1FBRTlFLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLDZDQUE2QyxDQUFDLENBQUE7UUFDaEUsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsb0NBQW9DLENBQUM7WUFDdkUsa0JBQWtCLEVBQUUsYUFBYTtZQUNqQyxrQkFBa0IsRUFBRSxVQUFVO1NBQy9CLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRCxlQUFlLENBQUMsVUFBVSxHQUFHLFNBQVM7UUFDcEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUVoRSxJQUFJLENBQUMsWUFBWTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FBQTtRQUV0RixPQUFPLFlBQVksQ0FBQTtJQUNyQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsWUFBWTtRQUNWLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1FBRWhELElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3REFBd0QsQ0FBQyxDQUFBO1FBRXpGLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7O09BR0c7SUFDSCx1QkFBdUI7UUFDckIsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMsVUFBVSxHQUFHLHVCQUF1QixFQUFFLENBQUE7UUFDN0MsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsa0JBQWtCLEtBQUssT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUEsQ0FBQyxDQUFDO0lBRXJEOzs7T0FHRztJQUNILFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUEsQ0FBQyxDQUFDO0lBRXZDOzs7T0FHRztJQUNILG1CQUFtQixLQUFLLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFBLENBQUMsQ0FBQztJQUV2RDs7OztPQUlHO0lBQ0gsbUJBQW1CLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxTQUFTLENBQUEsQ0FBQyxDQUFDO0lBRXJFOzs7Ozs7Ozs7T0FTRztJQUNILGdDQUFnQztRQUM5QixNQUFNLE1BQU0sR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUE7UUFDMUMsTUFBTSxJQUFJLEdBQUcsSUFBSSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFNUIsS0FBSyxNQUFNLGNBQWMsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUNuRCxJQUFJLENBQUMsY0FBYyxDQUFDLGdCQUFnQjtnQkFBRSxTQUFRO1lBRTlDLEtBQUssTUFBTSxhQUFhLElBQUksY0FBYyxDQUFDLGdCQUFnQixFQUFFLENBQUM7Z0JBQzVELElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7b0JBQUUsU0FBUTtnQkFFckMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQTtnQkFDdkIsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtZQUM1QixDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksQ0FBQyxpQkFBaUIsR0FBRyxNQUFNLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7T0FHRztJQUNILGtCQUFrQixLQUFLLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixDQUFBLENBQUMsQ0FBQztJQUVyRDs7O09BR0c7SUFDSCxpQkFBaUIsS0FBSyxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUEsQ0FBQyxDQUFDO0lBRW5EOzs7T0FHRztJQUNILHlCQUF5QixLQUFLLE9BQU8sSUFBSSxDQUFDLHVCQUF1QixDQUFBLENBQUMsQ0FBQztJQUVuRTs7O09BR0c7SUFDSCw4QkFBOEIsS0FBSyxPQUFPLElBQUksQ0FBQyw0QkFBNEIsQ0FBQSxDQUFDLENBQUM7SUFFN0U7OztPQUdHO0lBQ0gsMEJBQTBCLEtBQUssT0FBTyxJQUFJLENBQUMsd0JBQXdCLENBQUEsQ0FBQyxDQUFDO0lBRXJFOzs7O09BSUc7SUFDSCx5QkFBeUIsQ0FBQyxVQUFVO1FBQ2xDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDZCxNQUFNLElBQUksS0FBSyxDQUFDLG1FQUFtRSxVQUFVLEVBQUUsQ0FBQyxDQUFBO1FBQ2xHLENBQUM7UUFFRCxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsMkJBQTJCLEtBQUssT0FBTyxJQUFJLENBQUMsWUFBWSxJQUFJLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFFaEU7OztPQUdHO0lBQ0gscUJBQXFCLEtBQUssT0FBTyxJQUFJLENBQUMsbUJBQW1CLENBQUEsQ0FBQyxDQUFDO0lBRTNEOzs7O09BSUc7SUFDSCxvQkFBb0IsQ0FBQyxJQUFJO1FBQ3ZCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxrQkFBa0IsQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLGdCQUFnQixHQUFHLFFBQVEsQ0FBQSxDQUFDLENBQUM7SUFFakU7Ozs7T0FJRztJQUNILGlCQUFpQixDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsZUFBZSxHQUFHLFFBQVEsQ0FBQSxDQUFDLENBQUM7SUFFL0Q7Ozs7T0FJRztJQUNILHlCQUF5QixDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsdUJBQXVCLEdBQUcsUUFBUSxDQUFBLENBQUMsQ0FBQztJQUUvRTs7OztPQUlHO0lBQ0gsOEJBQThCLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxRQUFRLENBQUEsQ0FBQyxDQUFDO0lBRXpGOzs7O09BSUc7SUFDSCwwQkFBMEIsQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLHdCQUF3QixHQUFHLFNBQVMsQ0FBQSxDQUFDLENBQUM7SUFFbkY7OztPQUdHO0lBQ0gsY0FBYyxLQUFLLE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxjQUFjLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFdEQ7OztPQUdHO0lBQ0gsbUJBQW1CO1FBQ2pCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLDRCQUE0QixDQUFDLENBQUE7UUFDN0YsTUFBTSxLQUFLLEdBQUcsT0FBTyxJQUFJLENBQUMsaUJBQWlCLEtBQUssVUFBVTtZQUN4RCxDQUFDLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFO1lBQzFCLENBQUMsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUE7UUFFMUIsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFDM0MsSUFBSSxPQUFPLFVBQVUsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUM7WUFBRSxPQUFPLFVBQVUsQ0FBQTtRQUVwRixPQUFPLEVBQUUsQ0FBQTtJQUNYLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMkJBQTJCLENBQUMsUUFBUTtRQUNsQyxJQUFJLFFBQVEsS0FBSyxTQUFTO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFFNUMsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBRTdDLElBQUksQ0FBQyxPQUFPO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFFOUIsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxDQUFBO1FBRXZELElBQUksQ0FBQyxLQUFLO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFFNUIsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRWhDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQztZQUFFLE9BQU8sU0FBUyxDQUFBO1FBRS9DLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUVyQixJQUFJLElBQUksS0FBSyxJQUFJO1lBQUUsT0FBTyxPQUFPLEdBQUcsSUFBSSxDQUFBO1FBQ3hDLElBQUksSUFBSSxLQUFLLEdBQUc7WUFBRSxPQUFPLE9BQU8sQ0FBQTtRQUVoQyxJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDO1lBQUUsT0FBTyxPQUFPLENBQUE7UUFDekMsSUFBSSxPQUFPLElBQUksSUFBSTtZQUFFLE9BQU8sT0FBTyxHQUFHLElBQUksQ0FBQTtRQUUxQyxPQUFPLE9BQU8sQ0FBQTtJQUNoQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWMsQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDLFlBQVksR0FBRyxjQUFjLENBQUEsQ0FBQyxDQUFDO0lBRXJFOzs7OztPQUtHO0lBQ0gsdUJBQXVCLENBQUMsRUFBQyxjQUFjLEVBQUMsR0FBRyxFQUFFO1FBQzNDLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUN6QyxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3ZELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsU0FBUyxJQUFJLGtCQUFrQixDQUFDLHNCQUFzQixDQUFDLEVBQUMsYUFBYSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDOUcsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxRQUFRLElBQUksa0JBQWtCLENBQUMsY0FBYyxDQUFDLEVBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtRQUM1SCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQTtRQUM5QyxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDL0MsTUFBTSxXQUFXLEdBQUcsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQTtRQUN6RixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFBO1FBQzlDLE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxhQUFhLEtBQUssSUFBSSxDQUFBO1FBQ2xFLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFBO1FBRXRDLE1BQU0sY0FBYyxHQUFHLGNBQWMsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBQzNFLE1BQU0sY0FBYyxHQUFHLGVBQWUsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFBO1FBRXZGOztvRkFFNEU7UUFDNUUsTUFBTSxhQUFhLEdBQUcsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBRS9DLElBQUksb0JBQW9CO1lBQUUsYUFBYSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBRWxFLE1BQU0sTUFBTSxHQUFHLGdCQUFnQixJQUFJLGFBQWEsQ0FBQTtRQUVoRCxPQUFPO1lBQ0wsT0FBTyxFQUFFLGNBQWM7WUFDdkIsU0FBUztZQUNULElBQUksRUFBRSxXQUFXLElBQUksS0FBSztZQUMxQixRQUFRO1lBQ1IsT0FBTztZQUNQLE1BQU07WUFDTixPQUFPLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxPQUFPO1NBQ2hDLENBQUE7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsY0FBYztRQUNaLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQTtJQUMxQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsc0JBQXNCO1FBQ3BCLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxZQUFZLEtBQUssU0FBUztZQUFFLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUE7UUFFaEYsT0FBTyxJQUFJLENBQUMsY0FBYyxFQUFFLEtBQUssTUFBTSxDQUFBO0lBQ3pDLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNILHFDQUFxQyxDQUFDLEVBQUMsWUFBWSxFQUFFLG9CQUFvQixFQUFFLHNCQUFzQixFQUFFLDhCQUE4QixFQUFFLG1CQUFtQixFQUFFLDJCQUEyQixFQUFFLFVBQVUsR0FBRyxxQkFBcUIsRUFBQyxHQUFHLEVBQUU7UUFDM04sTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGVBQWUsSUFBSSxFQUFFLENBQUE7UUFDN0MsTUFBTSxxQkFBcUIsR0FBRyxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsSUFBSSxFQUFFLENBQUE7UUFDM0QsTUFBTSxZQUFZLEdBQUcsbUJBQW1CLENBQUM7WUFDdkMsRUFBQyxJQUFJLEVBQUUsNkJBQTZCLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxFQUFFLGNBQWMsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxZQUFZLEtBQUssU0FBUyxFQUFFLEtBQUssRUFBRSxVQUFVLENBQUMsWUFBWSxFQUFDO1lBQ2xLLEVBQUMsSUFBSSxFQUFFLHlDQUF5QyxFQUFFLE9BQU8sRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLHFCQUFxQixFQUFFLHlDQUF5QyxDQUFDLEVBQUUsS0FBSyxFQUFFLHFCQUFxQixDQUFDLHVDQUF1QyxFQUFDO1lBQ2pOLEVBQUMsSUFBSSxFQUFFLEdBQUcsVUFBVSxlQUFlLEVBQUUsT0FBTyxFQUFFLG9CQUFvQixLQUFLLFNBQVMsRUFBRSxLQUFLLEVBQUUsb0JBQW9CLEVBQUM7U0FDL0csQ0FBQyxDQUFBO1FBQ0YsTUFBTSxzQkFBc0IsR0FBRyw2QkFBNkIsQ0FBQztZQUMzRCxFQUFDLElBQUksRUFBRSx1Q0FBdUMsRUFBRSxPQUFPLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsd0JBQXdCLENBQUMsSUFBSSxVQUFVLENBQUMsc0JBQXNCLEtBQUssU0FBUyxFQUFFLEtBQUssRUFBRSxVQUFVLENBQUMsc0JBQXNCLEVBQUM7WUFDMU0sRUFBQyxJQUFJLEVBQUUsb0RBQW9ELEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMscUJBQXFCLEVBQUUsb0RBQW9ELENBQUMsRUFBRSxLQUFLLEVBQUUscUJBQXFCLENBQUMsa0RBQWtELEVBQUM7WUFDbFAsRUFBQyxJQUFJLEVBQUUsR0FBRyxVQUFVLHlCQUF5QixFQUFFLE9BQU8sRUFBRSw4QkFBOEIsS0FBSyxTQUFTLEVBQUUsS0FBSyxFQUFFLDhCQUE4QixFQUFDO1NBQzdJLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFDaEIsTUFBTSxtQkFBbUIsR0FBRywwQkFBMEIsQ0FBQztZQUNyRCxFQUFDLElBQUksRUFBRSxvQ0FBb0MsRUFBRSxPQUFPLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUscUJBQXFCLENBQUMsSUFBSSxVQUFVLENBQUMsbUJBQW1CLEtBQUssU0FBUyxFQUFFLEtBQUssRUFBRSxVQUFVLENBQUMsbUJBQW1CLEVBQUM7WUFDOUwsRUFBQyxJQUFJLEVBQUUsaURBQWlELEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMscUJBQXFCLEVBQUUsaURBQWlELENBQUMsRUFBRSxLQUFLLEVBQUUscUJBQXFCLENBQUMsK0NBQStDLEVBQUM7WUFDek8sRUFBQyxJQUFJLEVBQUUsR0FBRyxVQUFVLHNCQUFzQixFQUFFLE9BQU8sRUFBRSwyQkFBMkIsS0FBSyxTQUFTLEVBQUUsS0FBSyxFQUFFLDJCQUEyQixFQUFDO1NBQ3BJLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFFaEIsT0FBTyxFQUFDLFlBQVksRUFBRSxzQkFBc0IsRUFBRSxtQkFBbUIsRUFBQyxDQUFBO0lBQ3BFLENBQUM7SUFFRDs7O09BR0c7SUFDSCx1QkFBdUI7UUFDckIsTUFBTSxrQkFBa0IsR0FBRyxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQTtRQUNsRCxNQUFNLE9BQU8sR0FBRyxrQkFBa0IsRUFBRSw4QkFBOEIsQ0FBQTtRQUNsRSxNQUFNLFVBQVUsR0FBRyxrQkFBa0IsRUFBRSw4QkFBOEIsQ0FBQTtRQUNyRSxNQUFNLHFCQUFxQixHQUFHLGtCQUFrQixFQUFFLDZDQUE2QyxDQUFBO1FBQy9GLE1BQU0seUJBQXlCLEdBQUcsa0JBQWtCLEVBQUUsb0RBQW9ELENBQUE7UUFDMUcsTUFBTSxtQkFBbUIsR0FBRyxrQkFBa0IsRUFBRSxvREFBb0QsQ0FBQTtRQUNwRyxNQUFNLHVCQUF1QixHQUFHLGtCQUFrQixFQUFFLDZDQUE2QyxDQUFBO1FBQ2pHLE1BQU0sNkJBQTZCLEdBQUcsa0JBQWtCLEVBQUUsbURBQW1ELENBQUE7UUFDN0csTUFBTSx5QkFBeUIsR0FBRyxrQkFBa0IsRUFBRSxnREFBZ0QsQ0FBQTtRQUN0RyxNQUFNLDZCQUE2QixHQUFHLGtCQUFrQixFQUFFLHFEQUFxRCxDQUFBO1FBQy9HLE1BQU0sK0JBQStCLEdBQUcsa0JBQWtCLEVBQUUsdURBQXVELENBQUE7UUFDbkgsTUFBTSxtQkFBbUIsR0FBRyxrQkFBa0IsRUFBRSwyQ0FBMkMsQ0FBQTtRQUMzRixNQUFNLGtCQUFrQixHQUFHLGtCQUFrQixFQUFFLDBDQUEwQyxDQUFBO1FBQ3pGLE1BQU0sZ0JBQWdCLEdBQUcsa0JBQWtCLEVBQUUsd0NBQXdDLENBQUE7UUFDckYsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUMzRCxNQUFNLHNCQUFzQixHQUFHLHlCQUF5QixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMseUJBQXlCLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ3hHLE1BQU0sZ0JBQWdCLEdBQUcsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFDdEYsTUFBTSxvQkFBb0IsR0FBRyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUNsRyxNQUFNLDBCQUEwQixHQUFHLDZCQUE2QixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ3BILE1BQU0sc0JBQXNCLEdBQUcseUJBQXlCLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFDeEcsTUFBTSwwQkFBMEIsR0FBRyw2QkFBNkIsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLDZCQUE2QixDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUNwSCxNQUFNLDRCQUE0QixHQUFHLCtCQUErQixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsK0JBQStCLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQzFILE1BQU0sZUFBZSxHQUFHLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ25GLE1BQU0sYUFBYSxHQUFHLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQzdFLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxlQUFlLElBQUksRUFBRSxDQUFBO1FBQzdDLE1BQU0sRUFBQyxZQUFZLEVBQUUsc0JBQXNCLEVBQUUsbUJBQW1CLEVBQUMsR0FBRyxJQUFJLENBQUMscUNBQXFDLEVBQUUsQ0FBQTtRQUNoSCxNQUFNLElBQUksR0FBRyxVQUFVLENBQUMsSUFBSSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFBO1FBRTNFLElBQUksSUFBSSxLQUFLLFlBQVksSUFBSSxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDL0MsTUFBTSxJQUFJLFNBQVMsQ0FBQyw4REFBOEQsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNuRyxDQUFDO1FBQ0QsTUFBTSxJQUFJLEdBQUcsVUFBVSxDQUFDLElBQUksSUFBSSxPQUFPLElBQUksV0FBVyxDQUFBO1FBQ3RELE1BQU0sSUFBSSxHQUFHLE9BQU8sVUFBVSxDQUFDLElBQUksS0FBSyxRQUFRO1lBQzlDLENBQUMsQ0FBQyxVQUFVLENBQUMsSUFBSTtZQUNqQixDQUFDLENBQUMsQ0FBQyxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5RSxNQUFNLGtCQUFrQixHQUFHLFVBQVUsQ0FBQyxrQkFBa0IsSUFBSSxxQkFBcUIsSUFBSSxTQUFTLENBQUE7UUFDOUYsTUFBTSx1QkFBdUIsR0FBRyxPQUFPLFVBQVUsQ0FBQyx1QkFBdUIsS0FBSyxRQUFRLElBQUksVUFBVSxDQUFDLHVCQUF1QixJQUFJLENBQUM7WUFDL0gsQ0FBQyxDQUFDLFVBQVUsQ0FBQyx1QkFBdUI7WUFDcEMsQ0FBQyxDQUFDLENBQUMsT0FBTyxnQkFBZ0IsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLGdCQUFnQixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQy9ILE1BQU0sdUJBQXVCLEdBQUcsT0FBTyxVQUFVLENBQUMsdUJBQXVCLEtBQUssUUFBUSxJQUFJLFVBQVUsQ0FBQyx1QkFBdUIsSUFBSSxDQUFDO1lBQy9ILENBQUMsQ0FBQyxVQUFVLENBQUMsdUJBQXVCO1lBQ3BDLENBQUMsQ0FBQyxDQUFDLE9BQU8sc0JBQXNCLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsc0JBQXNCLENBQUMsSUFBSSxzQkFBc0IsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUN2SixNQUFNLGlCQUFpQixHQUFHLE9BQU8sVUFBVSxDQUFDLGlCQUFpQixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLGlCQUFpQixDQUFDLElBQUksVUFBVSxDQUFDLGlCQUFpQixJQUFJLENBQUM7WUFDaE4sQ0FBQyxDQUFDLFVBQVUsQ0FBQyxpQkFBaUI7WUFDOUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixJQUFJLFVBQVUsQ0FBQyxJQUFJLE9BQU8sb0JBQW9CLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsb0JBQW9CLENBQUMsSUFBSSxNQUFNLENBQUMsU0FBUyxDQUFDLG9CQUFvQixDQUFDLElBQUksb0JBQW9CLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDak8sTUFBTSx1QkFBdUIsR0FBRyxPQUFPLFVBQVUsQ0FBQyx1QkFBdUIsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsdUJBQXVCLENBQUMsSUFBSSxNQUFNLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLFVBQVUsQ0FBQyx1QkFBdUIsSUFBSSxDQUFDO1lBQzlPLENBQUMsQ0FBQyxVQUFVLENBQUMsdUJBQXVCO1lBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx5QkFBeUIsSUFBSSxVQUFVLENBQUMsSUFBSSxPQUFPLDBCQUEwQixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLDBCQUEwQixDQUFDLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQywwQkFBMEIsQ0FBQyxJQUFJLDBCQUEwQixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3JRLE1BQU0sbUJBQW1CLEdBQUcsT0FBTyxVQUFVLENBQUMsbUJBQW1CLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLG1CQUFtQixDQUFDLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLENBQUMsSUFBSSxVQUFVLENBQUMsbUJBQW1CLElBQUksQ0FBQztZQUMxTixDQUFDLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtZQUNoQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMscUJBQXFCLElBQUksVUFBVSxDQUFDLElBQUksT0FBTyxzQkFBc0IsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsc0JBQXNCLENBQUMsSUFBSSxzQkFBc0IsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUMvTyxNQUFNLHVCQUF1QixHQUFHLE9BQU8sVUFBVSxDQUFDLHVCQUF1QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLFVBQVUsQ0FBQyx1QkFBdUIsSUFBSSxDQUFDO1lBQ3RMLENBQUMsQ0FBQyxVQUFVLENBQUMsdUJBQXVCO1lBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx5QkFBeUIsSUFBSSxVQUFVLENBQUMsSUFBSSxPQUFPLDBCQUEwQixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLDBCQUEwQixDQUFDLElBQUksMEJBQTBCLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUMsQ0FBQTtRQUNyTyxNQUFNLHlCQUF5QixHQUFHLE9BQU8sVUFBVSxDQUFDLHlCQUF5QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJLFVBQVUsQ0FBQyx5QkFBeUIsSUFBSSxDQUFDO1lBQzlMLENBQUMsQ0FBQyxVQUFVLENBQUMseUJBQXlCO1lBQ3RDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQywyQkFBMkIsSUFBSSxVQUFVLENBQUMsSUFBSSxPQUFPLDRCQUE0QixLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLDRCQUE0QixDQUFDLElBQUksNEJBQTRCLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQTtRQUM1TyxNQUFNLG1CQUFtQixHQUFHLFVBQVUsQ0FBQyxnQkFBZ0IsSUFBSSxtQkFBbUIsQ0FBQTtRQUM5RSxNQUFNLGdCQUFnQixHQUFHLG1CQUFtQixLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUE7UUFDakYsTUFBTSxjQUFjLEdBQUcsT0FBTyxVQUFVLENBQUMsY0FBYyxLQUFLLFFBQVEsSUFBSSxVQUFVLENBQUMsY0FBYyxJQUFJLENBQUM7WUFDcEcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxjQUFjO1lBQzNCLENBQUMsQ0FBQyxDQUFDLE9BQU8sZUFBZSxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxJQUFJLGVBQWUsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDOUgsTUFBTSxNQUFNLEdBQUcsVUFBVSxDQUFDLE1BQU0sSUFBSSxPQUFPLFVBQVUsQ0FBQyxNQUFNLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFDbEcseUVBQXlFO1FBQ3pFLHVFQUF1RTtRQUN2RSw4RUFBOEU7UUFDOUUsTUFBTSxZQUFZLEdBQUcsY0FBYyxJQUFJLFVBQVU7WUFDL0MsQ0FBQyxDQUFDLENBQUMsT0FBTyxVQUFVLENBQUMsWUFBWSxLQUFLLFFBQVEsSUFBSSxVQUFVLENBQUMsWUFBWSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1lBQy9HLENBQUMsQ0FBQyxDQUFDLE9BQU8sYUFBYSxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDckgsTUFBTSxtQkFBbUIsR0FBRyxVQUFVLENBQUMsU0FBUyxJQUFJLE9BQU8sVUFBVSxDQUFDLFNBQVMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUN4SCxNQUFNLFNBQVMsR0FBRztZQUNoQixjQUFjLEVBQUUsT0FBTyxtQkFBbUIsQ0FBQyxjQUFjLEtBQUssUUFBUSxJQUFJLG1CQUFtQixDQUFDLGNBQWMsS0FBSyxJQUFJO2dCQUNuSCxDQUFDLENBQUMsbUJBQW1CLENBQUMsY0FBYztnQkFDcEMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJO1lBQzNCLFdBQVcsRUFBRSxPQUFPLG1CQUFtQixDQUFDLFdBQVcsS0FBSyxRQUFRLElBQUksbUJBQW1CLENBQUMsV0FBVyxLQUFLLElBQUk7Z0JBQzFHLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxXQUFXO2dCQUNqQyxDQUFDLENBQUMsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUk7WUFDNUIsU0FBUyxFQUFFLE9BQU8sbUJBQW1CLENBQUMsU0FBUyxLQUFLLFFBQVEsSUFBSSxtQkFBbUIsQ0FBQyxTQUFTLEdBQUcsQ0FBQztnQkFDL0YsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLFNBQVM7Z0JBQy9CLENBQUMsQ0FBQyxJQUFJO1lBQ1IsZUFBZSxFQUFFLE9BQU8sbUJBQW1CLENBQUMsZUFBZSxLQUFLLFFBQVEsSUFBSSxtQkFBbUIsQ0FBQyxlQUFlLEdBQUcsQ0FBQztnQkFDakgsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLGVBQWU7Z0JBQ3JDLENBQUMsQ0FBQyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUk7U0FDbkIsQ0FBQTtRQUVELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1FBRWpELE9BQU8sRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLGtCQUFrQixFQUFFLHVCQUF1QixFQUFFLHVCQUF1QixFQUFFLElBQUksRUFBRSxpQkFBaUIsRUFBRSx1QkFBdUIsRUFBRSxtQkFBbUIsRUFBRSx1QkFBdUIsRUFBRSx5QkFBeUIsRUFBRSxnQkFBZ0IsRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFFLFlBQVksRUFBRSxzQkFBc0IsRUFBRSxtQkFBbUIsRUFBQyxDQUFBO0lBQ2hXLENBQUM7SUFFRDs7O09BR0c7SUFDSCx1QkFBdUI7UUFDckIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxVQUFVLENBQUE7UUFFbkQsSUFBSSxVQUFVLEtBQUssU0FBUztZQUFFLE9BQU8sRUFBRSxDQUFBO1FBQ3ZDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQztZQUFFLE1BQU0sSUFBSSxTQUFTLENBQUMsNENBQTRDLENBQUMsQ0FBQTtRQUVqRyxPQUFPLENBQUMsR0FBRyxVQUFVLENBQUMsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsd0JBQXdCO1FBQ3RCLElBQUksSUFBSSxDQUFDLGdDQUFnQztZQUFFLE9BQU8sSUFBSSxDQUFDLGdDQUFnQyxDQUFDLE9BQU8sQ0FBQTtRQUUvRixNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsT0FBTyxDQUFBO1FBQ3ZELE1BQU0sT0FBTyxHQUFHLE9BQU8saUJBQWlCLEtBQUssVUFBVTtZQUNyRCxDQUFDLENBQUMsaUJBQWlCLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFDLENBQUM7WUFDMUMsQ0FBQyxDQUFDLENBQUMsaUJBQWlCLElBQUksSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsMkJBQTJCLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQyxDQUFBO1FBRTFHLElBQUksQ0FBQyxDQUFDLE9BQU8sWUFBWSxxQkFBcUIsQ0FBQyxFQUFFLENBQUM7WUFDaEQsTUFBTSxJQUFJLFNBQVMsQ0FBQyx3R0FBd0csQ0FBQyxDQUFBO1FBQy9ILENBQUM7UUFFRCxJQUFJLENBQUMsZ0NBQWdDLEdBQUc7WUFDdEMsT0FBTztZQUNQLE9BQU8sRUFBRSxLQUFLO1lBQ2QsWUFBWSxFQUFFLFNBQVM7WUFDdkIsWUFBWSxFQUFFLFNBQVM7U0FDeEIsQ0FBQTtRQUNELE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsaUNBQWlDO1FBQ3JDLE9BQU8sSUFBSSxFQUFFLENBQUM7WUFDWixNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQTtZQUVsRSxJQUFJLG9CQUFvQixFQUFFLENBQUM7Z0JBQ3pCLE1BQU0sb0JBQW9CLENBQUE7Z0JBQzFCLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUE7WUFDL0IsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGdDQUFnQyxDQUFBO1lBRXhELElBQUksQ0FBQyxVQUFVO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQTtZQUV0RixJQUFJLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQztnQkFDdkIsSUFBSSxVQUFVLENBQUMsWUFBWTtvQkFBRSxNQUFNLFVBQVUsQ0FBQyxZQUFZLENBQUE7Z0JBQzFELFNBQVE7WUFDVixDQUFDO1lBRUQsTUFBTSxZQUFZLEdBQUcsVUFBVSxDQUFDLFlBQVksSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFO2dCQUNoRixNQUFNLFVBQVUsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUE7WUFDeEMsQ0FBQyxDQUFDLENBQUE7WUFFRixVQUFVLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtZQUV0QyxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxZQUFZLENBQUE7WUFDcEIsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxVQUFVLENBQUMsWUFBWSxLQUFLLFlBQVk7b0JBQUUsVUFBVSxDQUFDLFlBQVksR0FBRyxTQUFTLENBQUE7Z0JBQ2pGLE1BQU0sS0FBSyxDQUFBO1lBQ2IsQ0FBQztZQUVELElBQUksVUFBVSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUN2QixJQUFJLFVBQVUsQ0FBQyxZQUFZO29CQUFFLE1BQU0sVUFBVSxDQUFDLFlBQVksQ0FBQTtnQkFDMUQsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLElBQUksQ0FBQyxnQ0FBZ0MsS0FBSyxVQUFVO2dCQUFFLFNBQVE7WUFFbEUsT0FBTyxVQUFVLENBQUMsT0FBTyxDQUFBO1FBQzNCLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGdDQUFnQztRQUNwQyxNQUFNLElBQUksQ0FBQyxpQ0FBaUMsRUFBRSxDQUFBO0lBQ2hELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsb0JBQW9CO1FBQ3hCLElBQUksSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUMsSUFBSSxLQUFLLFFBQVE7WUFBRSxPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFBO1FBRTFFLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGlDQUFpQyxFQUFFLENBQUE7UUFFOUQsT0FBTyxNQUFNLE9BQU8sQ0FBQyxNQUFNLEVBQUUsQ0FBQTtJQUMvQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQjtRQUM5QixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsZ0NBQWdDLENBQUE7UUFFeEQsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFNO1FBQ3ZCLElBQUksVUFBVSxDQUFDLFlBQVk7WUFBRSxPQUFPLE1BQU0sVUFBVSxDQUFDLFlBQVksQ0FBQTtRQUVqRSxVQUFVLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQTtRQUN6QixNQUFNLFlBQVksR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQy9CLHNCQUFzQjtZQUN0QixNQUFNLFdBQVcsR0FBRyxFQUFFLENBQUE7WUFFdEIsSUFBSSxVQUFVLENBQUMsWUFBWSxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQztvQkFDSCxNQUFNLFVBQVUsQ0FBQyxZQUFZLENBQUE7Z0JBQy9CLENBQUM7Z0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztvQkFDZixXQUFXLENBQUMsSUFBSSxDQUFDLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtnQkFDN0UsQ0FBQztZQUNILENBQUM7WUFFRCxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxVQUFVLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQ2xDLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLFdBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQzdFLENBQUM7WUFFRCxJQUFJLFdBQVcsQ0FBQyxNQUFNLEtBQUssQ0FBQztnQkFBRSxNQUFNLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUNsRCxJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQztnQkFBRSxNQUFNLElBQUksY0FBYyxDQUFDLFdBQVcsRUFBRSx1REFBdUQsQ0FBQyxDQUFBO1FBQzVILENBQUMsQ0FBQyxFQUFFLENBQUE7UUFFSixVQUFVLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtRQUV0QyxJQUFJLENBQUM7WUFDSCxNQUFNLFlBQVksQ0FBQTtRQUNwQixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLElBQUksQ0FBQyxnQ0FBZ0MsS0FBSyxVQUFVLEVBQUUsQ0FBQztnQkFDekQsSUFBSSxDQUFDLGdDQUFnQyxHQUFHLFNBQVMsQ0FBQTtZQUNuRCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsdUJBQXVCLENBQUMsY0FBYztRQUNwQyxJQUFJLElBQUksQ0FBQyxnQ0FBZ0MsSUFBSSxjQUFjLENBQUMsT0FBTyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2xGLE1BQU0sSUFBSSxLQUFLLENBQUMsMEZBQTBGLENBQUMsQ0FBQTtRQUM3RyxDQUFDO1FBRUQsSUFBSSxDQUFDLGVBQWUsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsZUFBZSxFQUFFLGNBQWMsQ0FBQyxDQUFBO0lBQ2hGLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxlQUFlO1FBQ2IsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUE7UUFDckMsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLFNBQVMsS0FBSyxJQUFJLENBQUE7UUFFL0MsSUFBSSxTQUFTLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxJQUFJLE9BQU8sVUFBVSxDQUFDLElBQUksS0FBSyxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQzFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUdBQXlHLENBQUMsQ0FBQTtRQUM1SCxDQUFDO1FBRUQsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLENBQUE7UUFDekUsTUFBTSxVQUFVLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLENBQUE7UUFDNUUsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUMzRCxNQUFNLElBQUksR0FBRyxVQUFVLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxXQUFXLENBQUE7UUFDdEQsTUFBTSxJQUFJLEdBQUcsT0FBTyxVQUFVLENBQUMsSUFBSSxLQUFLLFFBQVE7WUFDOUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxJQUFJO1lBQ2pCLENBQUMsQ0FBQyxDQUFDLE9BQU8sT0FBTyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTlFLElBQUksT0FBTyxDQUFBO1FBRVgsSUFBSSxPQUFPLFVBQVUsQ0FBQyxPQUFPLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDNUMsT0FBTyxHQUFHLFVBQVUsQ0FBQyxPQUFPLENBQUE7UUFDOUIsQ0FBQzthQUFNLENBQUM7WUFDTixPQUFPLEdBQUcsT0FBTyxDQUFDLFNBQVMsSUFBSSxVQUFVLENBQUMsSUFBSSxJQUFJLFVBQVUsQ0FBQyxJQUFJLElBQUksT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFBO1FBQzFGLENBQUM7UUFFRCxNQUFNLG1CQUFtQixHQUFHLGdDQUFnQyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO1FBRTVGLE9BQU8sRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsVUFBVSxDQUFDLFFBQVEsRUFBRSxTQUFTLEVBQUUsbUJBQW1CLEVBQUMsQ0FBQTtJQUM3RixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGVBQWUsQ0FBQyxNQUFNO1FBQ3BCLElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQTtJQUN4RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQTtJQUMzQixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09BMEJHO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxFQUFDLFFBQVEsRUFBQyxHQUFHLEVBQUU7UUFDakMsSUFBSSxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQTtRQUNqRCxJQUFJLElBQUksQ0FBQyxxQkFBcUI7WUFBRSxPQUFPLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFBO1FBRXZFLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUVyQyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU87WUFBRSxPQUFPLFNBQVMsQ0FBQTtRQUVyQyxJQUFJLENBQUMscUJBQXFCLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUN2QyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQztnQkFDNUMsTUFBTTtnQkFDTixRQUFRLEVBQUUsUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRO2FBQ3RDLENBQUMsQ0FBQTtZQUVGLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRTtnQkFDN0IsNERBQTREO2dCQUM1RCw4REFBOEQ7Z0JBQzlELDREQUE0RDtnQkFDNUQsMkJBQTJCO2dCQUMzQixJQUFJLENBQUMsMkJBQTJCLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDM0MsQ0FBQyxDQUFDLENBQUE7WUFFRiwwRUFBMEU7WUFDMUUseUVBQXlFO1lBQ3pFLDJFQUEyRTtZQUMzRSx1RUFBdUU7WUFDdkUscUVBQXFFO1lBRXJFLGdFQUFnRTtZQUNoRSxNQUFNLENBQUMsRUFBRSxDQUFDLGVBQWUsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFO2dCQUNuQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxLQUFLLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLGFBQWEsRUFBRSxNQUFNLENBQUMsbUJBQW1CLEVBQUMsQ0FBQyxDQUFBO1lBQ3JHLENBQUMsQ0FBQyxDQUFBO1lBRUYsMEVBQTBFO1lBQzFFLCtEQUErRDtZQUMvRCxpREFBaUQ7WUFDakQsTUFBTSxDQUFDLEVBQUUsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDakMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsS0FBSyxFQUFFLG1CQUFtQixFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFFLE1BQU0sQ0FBQyxtQkFBbUIsRUFBQyxDQUFDLENBQUE7WUFDaEgsQ0FBQyxDQUFDLENBQUE7WUFFRiwwRUFBMEU7WUFDMUUsdUVBQXVFO1lBQ3ZFLE1BQU0sQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLEdBQUcsRUFBRTtnQkFDeEIsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3hCLENBQUMsQ0FBQyxDQUFBO1lBRUYsaUVBQWlFO1lBQ2pFLCtEQUErRDtZQUMvRCxvQ0FBb0M7WUFDcEMsSUFBSSxDQUFDLGFBQWEsR0FBRyxNQUFNLENBQUE7WUFFM0IsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ3JCLCtEQUErRDtnQkFDL0QsaURBQWlEO2dCQUNqRCxnRUFBZ0U7Z0JBQ2hFLE1BQU0sTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBQ3hCLENBQUM7aUJBQU0sQ0FBQztnQkFDTiw2REFBNkQ7Z0JBQzdELCtEQUErRDtnQkFDL0Qsd0RBQXdEO2dCQUN4RCw2REFBNkQ7Z0JBQzdELHlEQUF5RDtnQkFDekQsS0FBSyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRTtvQkFDL0IsNENBQTRDO2dCQUM5QyxDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFFRCxPQUFPLE1BQU0sQ0FBQTtRQUNmLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFFSixPQUFPLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFBO0lBQ3pDLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLEVBQUMsTUFBTSxFQUFFLFFBQVEsRUFBQztRQUMxQyxvRUFBb0U7UUFDcEUscUVBQXFFO1FBQ3JFLHlEQUF5RDtRQUN6RCxzREFBc0Q7UUFDdEQscUVBQXFFO1FBQ3JFLG1FQUFtRTtRQUNuRSw2REFBNkQ7UUFDN0QsbUVBQW1FO1FBQ25FLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBRTVDLElBQUksTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3JCLE1BQU0scUJBQXFCLEdBQUcsTUFBTSxPQUFPLENBQUMseUJBQXlCLEVBQUUsQ0FBQTtZQUV2RSxPQUFPLElBQUkscUJBQXFCLENBQUMsRUFBQyxRQUFRLEVBQUMsQ0FBQyxDQUFBO1FBQzlDLENBQUM7UUFFRCxNQUFNLFlBQVksR0FBRyxNQUFNLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRXJELE9BQU8sSUFBSSxZQUFZLENBQUM7WUFDdEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJO1lBQ2pCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSTtZQUNqQixRQUFRO1NBQ1QsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7OztPQVdHO0lBQ0gsaUJBQWlCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLGFBQWEsRUFBQztRQUM3QyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUE7UUFFMUMseUVBQXlFO1FBQ3pFLG9EQUFvRDtRQUNwRCxJQUFJLElBQUksQ0FBQyxrQkFBa0IsSUFBSSxJQUFJLENBQUMscUJBQXFCO1lBQUUsT0FBTTtRQUVqRSxNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsR0FBRyxFQUFFO1lBQzVCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7WUFFbkMsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLFdBQVcsRUFBRSxFQUFFLENBQUM7Z0JBQ3RDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtnQkFDdEIsT0FBTTtZQUNSLENBQUM7WUFFRCxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxDQUFBO1lBRWpDLElBQUksSUFBSSxDQUFDLG9CQUFvQjtnQkFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFDbkYsQ0FBQyxFQUFFLGFBQWEsQ0FBQyxDQUFBO1FBRWpCLG9EQUFvRDtRQUNwRCxJQUFJLE9BQU8sS0FBSyxDQUFDLEtBQUssS0FBSyxVQUFVO1lBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRXBELElBQUksQ0FBQyxrQkFBa0IsR0FBRyxLQUFLLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsZUFBZTtRQUNiLElBQUksSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDNUIsWUFBWSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBQ3JDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7UUFDckMsQ0FBQztRQUVELElBQUksQ0FBQyxxQkFBcUIsR0FBRyxLQUFLLENBQUE7UUFDbEMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLFNBQVMsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7O09BaUJHO0lBQ0gsa0JBQWtCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDO1FBQy9CLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUE7UUFDckMsTUFBTSxXQUFXLEdBQUcsV0FBVyxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUM7ZUFDL0QsV0FBVyxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDL0MsTUFBTSxPQUFPLEdBQUc7WUFDZCxPQUFPLEVBQUUsRUFBQyxLQUFLLEVBQUM7WUFDaEIsS0FBSztTQUNOLENBQUE7UUFFRCxXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtRQUV6RSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakIsTUFBTSxPQUFPLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBR3RFLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0NBQW9DLEtBQUssS0FBSyxPQUFPLHFIQUFxSCxDQUFDLENBQUE7WUFDekwsS0FBSyxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQzVCLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxnQkFBZ0I7UUFDcEIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQTtRQUVqQyxJQUFJLENBQUMsYUFBYSxHQUFHLFNBQVMsQ0FBQTtRQUM5QixJQUFJLENBQUMscUJBQXFCLEdBQUcsU0FBUyxDQUFBO1FBRXRDLElBQUksSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDNUIsWUFBWSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBQ3JDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7UUFDckMsQ0FBQztRQUVELElBQUksQ0FBQyxxQkFBcUIsR0FBRyxLQUFLLENBQUE7UUFDbEMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLFNBQVMsQ0FBQTtRQUVyQyxJQUFJLE1BQU07WUFBRSxNQUFNLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILDJCQUEyQixDQUFDLE9BQU87UUFDakM7O21EQUUyQztRQUMzQyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUE7UUFFN0MsSUFBSSxlQUFlLElBQUksT0FBTyxlQUFlLENBQUMsV0FBVyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3pFLGVBQWUsQ0FBQyxXQUFXLENBQUM7Z0JBQzFCLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTztnQkFDeEIsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlO2dCQUN4QyxJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUk7Z0JBQ2xCLGFBQWEsRUFBRSxJQUFJO2FBQ3BCLENBQUMsQ0FBQTtZQUNGLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLGVBQWUsRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDdkYsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxnQ0FBZ0M7UUFDcEMsSUFBSSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFDO1lBQ25DLE9BQU8sU0FBUyxDQUFBO1FBQ2xCLENBQUM7UUFFRCxJQUFJLE9BQU8sSUFBSSxDQUFDLHdCQUF3QixLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3hELE9BQU8sTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNuRSxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsd0JBQXdCLENBQUE7SUFDdEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxnQ0FBZ0MsQ0FBQyx1QkFBdUI7UUFDdEQsSUFBSSxDQUFDLHdCQUF3QixHQUFHLHVCQUF1QixDQUFBO0lBQ3pELENBQUM7SUFFRDs7O09BR0c7SUFDSCxnQkFBZ0I7UUFDZCxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxnQkFBZ0IsQ0FBQyxhQUFhO1FBQzVCLElBQUksQ0FBQyxjQUFjLEdBQUcsYUFBYSxDQUFBO0lBQ3JDLENBQUM7SUFFRDs7O09BR0c7SUFDSCwyQkFBMkI7UUFDekIsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxjQUFjLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtJQUM3RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gscUJBQXFCO1FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBRTVFLE9BQU8sSUFBSSxDQUFDLG1CQUFtQixDQUFBO0lBQ2pDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQkFBa0IsS0FBSyxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7O09BSUc7SUFDSCxrQkFBa0IsQ0FBQyxrQkFBa0IsSUFBSSxJQUFJLENBQUMsZUFBZSxHQUFHLGtCQUFrQixDQUFBLENBQUMsQ0FBQztJQUVwRjs7O09BR0c7SUFDSCxxQkFBcUIsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUEsQ0FBQyxDQUFDO0lBRXJEOzs7O09BSUc7SUFDSCx1QkFBdUIsQ0FBQyxJQUFJLEdBQUcsRUFBRTtRQUMvQixNQUFNLEVBQUMsTUFBTSxHQUFHLFdBQVcsRUFBQyxHQUFHLElBQUksQ0FBQTtRQUNuQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUMzQyxNQUFNLG1CQUFtQixHQUFHLE1BQU0sRUFBRSxtQkFBbUIsQ0FBQTtRQUN2RCxNQUFNLG9CQUFvQixHQUFHLE1BQU0sRUFBRSxvQkFBb0IsQ0FBQTtRQUV6RCxJQUFJLE1BQU0sS0FBSyxZQUFZLEVBQUUsQ0FBQztZQUM1QixPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLE9BQU8sbUJBQW1CLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFBO1FBQzVELENBQUM7UUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsb0JBQW9CLENBQUMsSUFBSSxvQkFBb0IsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUNoRyxPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxjQUFjLEVBQUUsS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUNyQyxPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsWUFBWTtRQUNoQyxJQUFJLENBQUMsYUFBYSxHQUFHLFlBQVksQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsU0FBUztRQUNQLElBQUksT0FBTyxJQUFJLENBQUMsTUFBTSxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ3JDLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ3RCLENBQUM7YUFBTSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUN2QixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUE7UUFDcEIsQ0FBQzthQUFNLENBQUM7WUFDTixPQUFPLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUM3QixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVUsS0FBSyxPQUFPLElBQUksQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTdDOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsSUFBSTtRQUNoQixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTFDLElBQUksQ0FBQyxVQUFVO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1QkFBdUIsSUFBSSxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7UUFFaEgsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7T0FHRztJQUNILGVBQWU7UUFDYixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVUsS0FBSyxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUEsQ0FBQyxDQUFDO0lBRXJDOzs7T0FHRztJQUNILGlCQUFpQixLQUFLLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQSxDQUFDLENBQUM7SUFFbkQ7Ozs7T0FJRztJQUNILGlCQUFpQixDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQSxDQUFDLENBQUM7SUFFM0U7Ozs7T0FJRztJQUNILHNCQUFzQixDQUFDLFVBQVUsR0FBRyxTQUFTO1FBQzNDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQTtRQUM5RCxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywyQ0FBMkMsQ0FBQyxDQUFBO1FBRWhHLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVyRCxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxHQUFHLElBQUksUUFBUSxDQUFDLEVBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO1FBQ2hGLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx5QkFBeUIsQ0FBQyxVQUFVLEdBQUcsU0FBUyxJQUFJLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFcEc7OztPQUdHO0lBQ0gsYUFBYSxLQUFLLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQSxDQUFDLENBQUM7SUFFOUM7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxHQUFHLEVBQUMsSUFBSSxFQUFFLFFBQVEsRUFBQztRQUM1QyxNQUFNLDZCQUE2QixHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQTtRQUV6RSxJQUFJLElBQUksQ0FBQyxrQkFBa0I7WUFBRSxPQUFNO1FBQ25DLElBQUksSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUM7WUFDbEMsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUE7WUFFN0QsTUFBTSx1QkFBdUIsQ0FBQTtZQUU3QixJQUFJLElBQUksQ0FBQyw4QkFBOEIsS0FBSyw2QkFBNkIsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO2dCQUN0RyxJQUFJLElBQUksQ0FBQyx3QkFBd0IsS0FBSyx1QkFBdUIsRUFBRSxDQUFDO29CQUM5RCxJQUFJLENBQUMsd0JBQXdCLEdBQUcsU0FBUyxDQUFBO2dCQUMzQyxDQUFDO2dCQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDMUMsQ0FBQztZQUVELE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSx1QkFBdUIsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQzFDLE1BQU0sa0NBQWtDLEdBQUcsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMseUNBQXlDLEtBQUssR0FBRzttQkFDL0csVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsdUJBQXVCLEtBQUssTUFBTTttQkFDMUQsSUFBSSxDQUFDLGNBQWMsRUFBRSxLQUFLLE1BQU0sQ0FBQTtZQUVyQyxJQUFJLENBQUMsa0NBQWtDLEVBQUUsQ0FBQztnQkFDeEMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztvQkFDM0IsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxFQUFDLENBQUMsQ0FBQTtnQkFDdEUsQ0FBQztnQkFFRCxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLHVCQUF1QixDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUNoRSxNQUFNLG1DQUFtQyxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUUvQyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLDBDQUEwQyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQ3JGLENBQUM7WUFFRCxJQUFJLElBQUksQ0FBQyw4QkFBOEIsS0FBSyw2QkFBNkIsRUFBRSxDQUFDO2dCQUMxRSxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxDQUFBO1lBQ2hDLENBQUM7UUFDSCxDQUFDLENBQUMsRUFBRSxDQUFBO1FBRUosSUFBSSxDQUFDLHdCQUF3QixHQUFHLHVCQUF1QixDQUFBO1FBRXZELElBQUksQ0FBQztZQUNILE1BQU0sdUJBQXVCLENBQUE7UUFDL0IsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxJQUFJLENBQUMsd0JBQXdCLEtBQUssdUJBQXVCLEVBQUUsQ0FBQztnQkFDOUQsSUFBSSxDQUFDLHdCQUF3QixHQUFHLFNBQVMsQ0FBQTtZQUMzQyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QjtRQUMzQixLQUFLLE1BQU0sVUFBVSxJQUFJLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxFQUFFLENBQUM7WUFDdkQsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUU3QyxNQUFNLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1FBQ3JDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxVQUFVLENBQUMsRUFBQyxJQUFJLEVBQUMsR0FBRyxFQUFDLElBQUksRUFBRSxXQUFXLEVBQUM7UUFDckMsSUFBSSxJQUFJLENBQUMsd0JBQXdCO1lBQUUsT0FBTyxJQUFJLENBQUMsd0JBQXdCLENBQUE7UUFFdkUsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUMxQixPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLHdCQUF3QixFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBQyxDQUFDLENBQUE7UUFDdEcsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLGdDQUFnQyxFQUFFLENBQUM7WUFDMUMsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyx3QkFBd0IsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsZ0NBQWdDLEVBQUMsQ0FBQyxDQUFBO1FBQ3ZILENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLElBQUksRUFBQyxDQUFDLENBQUE7SUFDdEMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsZ0JBQWdCLENBQUMsRUFBQyxJQUFJLEVBQUM7UUFDckIsTUFBTSx3QkFBd0IsR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUE7UUFFcEUsSUFBSSxJQUFJLENBQUMsa0JBQWtCLElBQUksSUFBSSxDQUFDLDRCQUE0QixLQUFLLHdCQUF3QixFQUFFLENBQUM7WUFDOUYsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUE7UUFDaEMsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDNUIsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyx3QkFBd0IsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsa0JBQWtCLEVBQUMsQ0FBQyxDQUFBO1FBQ3pHLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUN4QixJQUFJLENBQUMsa0JBQWtCLEdBQUcsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBQzNDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyx3QkFBd0IsQ0FBQTtZQUU1RCxPQUFPLElBQUksQ0FBQyxrQkFBa0IsQ0FBQTtRQUNoQyxDQUFDO1FBQ0QsOEVBQThFO1FBQzlFLDZFQUE2RTtRQUM3RSwwREFBMEQ7UUFDMUQsNkVBQTZFO1FBQzdFLDJFQUEyRTtRQUMzRSw4RUFBOEU7UUFDOUUsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsd0JBQXdCLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUUvRSxJQUFJLENBQUMsa0JBQWtCLEdBQUcsaUJBQWlCLENBQUE7UUFDM0MsSUFBSSxDQUFDLDRCQUE0QixHQUFHLHdCQUF3QixDQUFBO1FBRTVELE9BQU8saUJBQWlCLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxnQkFBZ0IsQ0FBQyxFQUFDLHdCQUF3QixFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDeEQsSUFBSSxJQUFJLENBQUMsd0JBQXdCO1lBQUUsT0FBTyxJQUFJLENBQUMsd0JBQXdCLENBQUE7UUFFdkUsTUFBTSx1QkFBdUIsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQzFDLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLEVBQUMsd0JBQXdCLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUV6RSxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxPQUFPO2dCQUFFLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7WUFDeEUsSUFBSSxJQUFJLENBQUMsa0JBQWtCLEtBQUssT0FBTyxFQUFFLENBQUM7Z0JBQ3hDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7Z0JBQ25DLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxTQUFTLENBQUE7WUFDL0MsQ0FBQztZQUVELE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQTtZQUU3QyxJQUFJLGVBQWUsRUFBRSxDQUFDO2dCQUNwQixNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxFQUFDLHdCQUF3QixFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQTtnQkFDaEcsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEtBQUssZUFBZTtvQkFBRSxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFBO1lBQ2xGLENBQUM7WUFFRCxJQUFJLElBQUksQ0FBQyxrQkFBa0IsSUFBSSxJQUFJLENBQUMsNEJBQTRCLEtBQUssSUFBSSxDQUFDLDhCQUE4QixFQUFFLENBQUM7Z0JBQ3pHLE1BQU0sc0JBQXNCLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFBO2dCQUV0RCxNQUFNLHNCQUFzQixDQUFBO2dCQUM1QixJQUFJLElBQUksQ0FBQyxrQkFBa0IsS0FBSyxzQkFBc0IsRUFBRSxDQUFDO29CQUN2RCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFBO29CQUNuQyxJQUFJLENBQUMsNEJBQTRCLEdBQUcsU0FBUyxDQUFBO2dCQUMvQyxDQUFDO1lBQ0gsQ0FBQztZQUVELE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNyQyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUU7WUFDaEIsSUFBSSxDQUFDLHdCQUF3QixHQUFHLFNBQVMsQ0FBQTtRQUMzQyxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyx3QkFBd0IsR0FBRyx1QkFBdUIsQ0FBQTtRQUV2RCxPQUFPLHVCQUF1QixDQUFBO0lBQ2hDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMseUJBQXlCLENBQUMsRUFBQyx3QkFBd0IsRUFBRSxPQUFPLEVBQUM7UUFDakUsSUFBSSxDQUFDO1lBQ0gsTUFBTSxPQUFPLENBQUE7UUFDZixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyx3QkFBd0I7Z0JBQUUsTUFBTSxLQUFLLENBQUE7UUFDNUMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsY0FBYyxDQUFDLEVBQUMsd0JBQXdCLEVBQUUsSUFBSSxFQUFDO1FBQ25ELE1BQU0sMEJBQTBCLEdBQUcsQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLENBQUE7UUFFekUsSUFBSSwwQkFBMEIsRUFBRSxDQUFDO1lBQy9CLElBQUksQ0FBQywwQkFBMEIsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO2dCQUM5QyxVQUFVLEVBQUUsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFO2dCQUNoQyxJQUFJO2FBQ0wsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsSUFBSSxFQUFDLENBQUMsQ0FBQTtZQUVuQyw0RUFBNEU7WUFDNUUsOEVBQThFO1lBQzlFLCtDQUErQztZQUMvQyxJQUFJLElBQUksQ0FBQyw4QkFBOEIsS0FBSyx3QkFBd0IsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO2dCQUNqRyxJQUFJLDBCQUEwQjtvQkFBRSxJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQTtnQkFDakUsT0FBTTtZQUNSLENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxDQUFBO1lBQzlELElBQUksQ0FBQyxnQ0FBZ0MsRUFBRSxDQUFBO1lBQ3ZDLElBQUksQ0FBQyxzQ0FBc0MsRUFBRSxDQUFBO1lBRTdDLElBQUksMEJBQTBCLElBQUksSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO2dCQUNyRCxNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtnQkFDcEUsTUFBTSxFQUFDLGNBQWMsRUFBRSxHQUFHLFFBQVEsRUFBQyxHQUFHLFlBQVksQ0FBQTtnQkFFbEQsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUV2QixJQUFJLGNBQWMsRUFBRSxDQUFDO29CQUNuQixLQUFLLE1BQU0sY0FBYyxJQUFJLGNBQWMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDO3dCQUNuRCxNQUFNLGdCQUFnQixHQUFHLGNBQWMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxPQUFPLENBQUE7d0JBQy9ELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQTt3QkFFdEQsSUFBSSxDQUFDLGNBQWM7NEJBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5RUFBeUUsQ0FBQyxDQUFBO3dCQUUvRyxNQUFNLG1CQUFtQixHQUFHLElBQUksZ0JBQWdCLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO3dCQUU3RixNQUFNLG1CQUFtQixDQUFDLEdBQUcsRUFBRSxDQUFBO3dCQUMvQixJQUFJLENBQUMsdUJBQXVCLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLENBQUE7b0JBQ3hELENBQUM7Z0JBQ0gsQ0FBQztZQUNILENBQUM7WUFFRCxJQUFJLDBCQUEwQjtnQkFBRSxJQUFJLENBQUMsZ0NBQWdDLEdBQUcsSUFBSSxDQUFBO1lBRTVFLElBQUksSUFBSSxDQUFDLDhCQUE4QixLQUFLLHdCQUF3QixFQUFFLENBQUM7Z0JBQ3JFLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFBO1lBQzVCLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksMEJBQTBCLEVBQUUsQ0FBQztnQkFDL0IsSUFBSSxhQUFhLENBQUE7Z0JBRWpCLElBQUksQ0FBQztvQkFDSCxNQUFNLElBQUksQ0FBQywrQkFBK0IsRUFBRSxDQUFBO2dCQUM5QyxDQUFDO2dCQUFDLE9BQU8sbUJBQW1CLEVBQUUsQ0FBQztvQkFDN0IsYUFBYSxHQUFHLG1CQUFtQixDQUFBO2dCQUNyQyxDQUFDO3dCQUFTLENBQUM7b0JBQ1QsSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUE7Z0JBQ25DLENBQUM7Z0JBRUQsSUFBSSxhQUFhLFlBQVksY0FBYyxFQUFFLENBQUM7b0JBQzVDLE1BQU0sSUFBSSxjQUFjLENBQ3RCLENBQUMsS0FBSyxFQUFFLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FBQyxFQUNoQyxnREFBZ0QsRUFDaEQsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQ2YsQ0FBQTtnQkFDSCxDQUFDO2dCQUVELElBQUksYUFBYSxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUNoQyxNQUFNLElBQUksY0FBYyxDQUN0QixDQUFDLEtBQUssRUFBRSxhQUFhLENBQUMsRUFDdEIsZ0RBQWdELEVBQ2hELEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUNmLENBQUE7Z0JBQ0gsQ0FBQztZQUNILENBQUM7WUFFRCxNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxJQUFJLElBQUksQ0FBQyw0QkFBNEIsS0FBSyx3QkFBd0IsRUFBRSxDQUFDO2dCQUMzRixJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFBO2dCQUNuQyxJQUFJLENBQUMsNEJBQTRCLEdBQUcsU0FBUyxDQUFBO1lBQy9DLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQywrQkFBK0I7UUFDbkMsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRS9FLE1BQU0sZ0JBQWdCLENBQUM7WUFDckIsT0FBTyxFQUFFLHlDQUF5QztZQUNsRCxLQUFLLEVBQUUsc0JBQXNCLENBQUMsR0FBRyxDQUFDLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sV0FBVyxDQUFDLFFBQVEsRUFBRSxDQUFDO1NBQzdGLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRCw2RUFBNkU7SUFDN0UsMEJBQTBCO1FBQ3hCLElBQUksQ0FBQyxnQ0FBZ0MsR0FBRyxLQUFLLENBQUE7UUFDN0MsSUFBSSxDQUFDLDBCQUEwQixHQUFHLFNBQVMsQ0FBQTtRQUMzQyxJQUFJLENBQUMsdUJBQXVCLEdBQUcsRUFBRSxDQUFBO0lBQ25DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRO1FBQ04sSUFBSSxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUE7UUFFdkQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUE7UUFDakQsTUFBTSxlQUFlLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUNsQyxJQUFJLENBQUM7Z0JBQ0gsSUFBSSxpQkFBaUI7b0JBQUUsTUFBTSxpQkFBaUIsQ0FBQTtnQkFDOUMsTUFBTSxJQUFJLENBQUMsK0JBQStCLEVBQUUsQ0FBQTtZQUM5QyxDQUFDO29CQUFTLENBQUM7Z0JBQ1QsSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUE7Z0JBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsS0FBSyxDQUFBO2dCQUMzQixJQUFJLElBQUksQ0FBQyxrQkFBa0IsS0FBSyxpQkFBaUIsRUFBRSxDQUFDO29CQUNsRCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFBO29CQUNuQyxJQUFJLENBQUMsNEJBQTRCLEdBQUcsU0FBUyxDQUFBO2dCQUMvQyxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUMsQ0FBQyxFQUFFLENBQUE7UUFFSixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsZUFBZSxDQUFBO1FBRXZDLE9BQU8sZUFBZSxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsc0NBQXNDO1FBQ3BDLEtBQUssTUFBTSxjQUFjLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDbkQsTUFBTSxTQUFTLEdBQUcsdUNBQXVDLENBQUMsY0FBYyxDQUFDLENBQUE7WUFFekUsS0FBSyxNQUFNLENBQUMsU0FBUyxFQUFFLGtCQUFrQixDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO2dCQUN4RSxNQUFNLGNBQWMsR0FBRyxnREFBZ0QsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO2dCQUUzRixJQUFJLENBQUMsY0FBYyxFQUFFLGFBQWE7b0JBQUUsU0FBUTtnQkFFNUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7b0JBQ2pELE1BQU0sSUFBSSxLQUFLLENBQUMsZ0JBQWdCLFNBQVMscUZBQXFGLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsYUFBYSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBQzVMLENBQUM7Z0JBRUQsTUFBTSxhQUFhLEdBQUcsd0NBQXdDLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtnQkFFbEYsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO29CQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixTQUFTLGdEQUFnRCxDQUFDLENBQUE7Z0JBQzNHLENBQUM7Z0JBRUQsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLFVBQVUsRUFBRSxDQUFBO2dCQUM3QyxNQUFNLHFCQUFxQixHQUFHLFVBQVUsQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO2dCQUU5RCxLQUFLLE1BQU0sZ0JBQWdCLElBQUksY0FBYyxDQUFDLGFBQWEsRUFBRSxDQUFDO29CQUM1RCxJQUFJLENBQUMsQ0FBQyxnQkFBZ0IsSUFBSSxxQkFBcUIsQ0FBQyxFQUFFLENBQUM7d0JBQ2pELE1BQU0sSUFBSSxLQUFLLENBQ2IsZ0JBQWdCLFNBQVMsMEJBQTBCLGdCQUFnQixTQUFTLFNBQVMsbUJBQW1COzRCQUN4RyxPQUFPLFNBQVMsZUFBZSxnQkFBZ0Isa0VBQWtFLENBQ2xILENBQUE7b0JBQ0gsQ0FBQztnQkFDSCxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGtCQUFrQixDQUFDLFVBQVU7UUFDM0IsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLENBQUMsR0FBRyxVQUFVLENBQUE7SUFDM0QsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUix1QkFBdUIsQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUMvQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsU0FBUyxLQUFLLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQSxDQUFDLENBQUM7SUFFbkM7Ozs7T0FJRztJQUNILFNBQVMsQ0FBQyxTQUFTO1FBQ2pCLElBQUksQ0FBQyxPQUFPLEdBQUcsU0FBUyxDQUFBO1FBQ3hCLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILGlCQUFpQixDQUFDLFNBQVM7UUFDekIsSUFBSSxDQUFDLFNBQVMsSUFBSSxPQUFPLFNBQVMsQ0FBQyxTQUFTLEtBQUssVUFBVTtZQUFFLE9BQU07UUFFbkUsS0FBSyxNQUFNLEtBQUssSUFBSSxTQUFTLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQztZQUMxQyxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDO2dCQUFFLFNBQVE7WUFFakQsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNuQyxLQUFLLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsR0FBRyxLQUFLLENBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQTtRQUNwRSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsUUFBUTtRQUNiLE1BQU0sWUFBWSxHQUFHLElBQUksWUFBWSxDQUFDLEVBQUMsYUFBYSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFFNUQsUUFBUSxDQUFDLFlBQVksQ0FBQyxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsV0FBVyxHQUFHLFFBQVEsQ0FBQSxDQUFDLENBQUM7SUFFdkQ7Ozs7O09BS0c7SUFDSCxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsSUFBSTtRQUM1QixJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQTtRQUVsQyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxJQUFJLEVBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ2xELE1BQU0sWUFBWSxHQUFHLGFBQWEsRUFBRSxZQUFZLENBQUE7UUFDaEQsTUFBTSxPQUFPLEdBQUcsYUFBYSxFQUFFLE9BQU8sQ0FBQTtRQUV0QyxJQUFJLGFBQWEsRUFBRSxDQUFDO1lBQ2xCLE9BQU8sYUFBYSxDQUFDLFlBQVksQ0FBQTtZQUNqQyxPQUFPLGFBQWEsQ0FBQyxPQUFPLENBQUE7UUFDOUIsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLGFBQWEsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBRXBHLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUMvQixNQUFNLGdCQUFnQixHQUFHLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUM3RCxNQUFNLE9BQU8sR0FBRyxTQUFTLENBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO1FBRTdELElBQUksT0FBTyxLQUFLLEtBQUssSUFBSSxZQUFZO1lBQUUsT0FBTyxTQUFTLENBQUMsWUFBWSxFQUFFLFNBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUVwRixPQUFPLE9BQU8sQ0FBQTtJQUNoQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsYUFBYTtRQUNYLElBQUksSUFBSSxDQUFDLFdBQVc7WUFBRSxPQUFPLElBQUksQ0FBQyxXQUFXLENBQUE7UUFFN0MsSUFBSSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1lBQ2xDLElBQUksQ0FBQyx1QkFBdUIsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ25FLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyx1QkFBdUIsQ0FBQTtJQUNyQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsMkJBQTJCO1FBQ3pCLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUUvQixhQUFhLENBQUMsU0FBUyxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUVyQyxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUVuRSxhQUFhLENBQUMsWUFBWSxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsd0JBQXdCO1FBQ3RCLElBQUksT0FBTyxJQUFJLENBQUMsc0JBQXNCLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDdEQsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtZQUV0RCxJQUFJLE9BQU8sZ0JBQWdCLEtBQUssUUFBUTtnQkFBRSxPQUFPLGdCQUFnQixDQUFBO1FBQ25FLENBQUM7UUFFRCxJQUFJLE9BQU8sSUFBSSxDQUFDLHNCQUFzQixLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3BELE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFBO1FBQ3BDLENBQUM7UUFFRCxPQUFPLElBQUksSUFBSSxFQUFFLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsV0FBVztRQUNULE1BQU0sUUFBUSxHQUFHLE9BQU8sSUFBSSxDQUFDLFNBQVMsS0FBSyxVQUFVO1lBQ25ELENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFO1lBQ2xCLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFBO1FBRWxCLElBQUksUUFBUSxLQUFLLFNBQVMsSUFBSSxRQUFRLEtBQUssSUFBSTtZQUFFLE9BQU8sU0FBUyxDQUFBO1FBRWpFLE9BQU8sZ0JBQWdCLENBQUMsUUFBUSxFQUFFLHdCQUF3QixDQUFDLENBQUE7SUFDN0QsQ0FBQztJQUVEOzs7T0FHRztJQUNILGtCQUFrQjtRQUNoQixPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGtCQUFrQixDQUFDLGVBQWU7UUFDaEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGVBQWUsQ0FBQTtJQUN6QyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCw4QkFBOEI7UUFDNUIsSUFBSSxDQUFDLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO1lBQ3ZDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxJQUFJLG9DQUFvQyxFQUFFLENBQUE7UUFDaEYsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLDRCQUE0QixDQUFBO0lBQzFDLENBQUM7SUFFRDs7O09BR0c7SUFDSCwyQkFBMkI7UUFDekIsT0FBTyxJQUFJLENBQUMseUJBQXlCLENBQUE7SUFDdkMsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCwyQkFBMkIsQ0FBQyxJQUFJLEVBQUUsZUFBZTtRQUMvQyxJQUFJLENBQUMsSUFBSTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQTtRQUN6RCxJQUFJLENBQUMsZUFBZTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQTtRQUNwRSxJQUFJLENBQUMsMkJBQTJCLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxlQUFlLENBQUMsQ0FBQTtJQUM3RCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDJCQUEyQixDQUFDLElBQUk7UUFDOUIsT0FBTyxJQUFJLENBQUMsMkJBQTJCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ25ELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx3QkFBd0IsQ0FBQyxJQUFJLEVBQUUsWUFBWTtRQUN6QyxJQUFJLENBQUMsSUFBSTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMEJBQTBCLENBQUMsQ0FBQTtRQUN0RCxJQUFJLENBQUMsWUFBWTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMEJBQTBCLENBQUMsQ0FBQTtRQUM5RCxJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxZQUFZLENBQUMsQ0FBQTtJQUN2RCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHdCQUF3QixDQUFDLElBQUk7UUFDM0IsT0FBTyxJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ2hELENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gscUNBQXFDLENBQUMsSUFBSSxFQUFFLFlBQVk7UUFDdEQsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtZQUNsQixJQUFJLENBQUMsOEJBQThCLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUN2RCxDQUFDO1FBRUQsTUFBTSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCx1Q0FBdUMsQ0FBQyxJQUFJLEVBQUUsWUFBWTtRQUN4RCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTVELElBQUksQ0FBQyxNQUFNO1lBQUUsT0FBTTtRQUVuQixNQUFNLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRTNCLElBQUksTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN0QixJQUFJLENBQUMsOEJBQThCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ2xELENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNIOzs7T0FHRztJQUNILCtCQUErQixLQUFLLE9BQU8sSUFBSSxDQUFDLDZCQUE2QixDQUFBLENBQUMsQ0FBQztJQUUvRTs7O09BR0c7SUFDSCxtQ0FBbUMsS0FBSyxPQUFPLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQSxDQUFDLENBQUM7SUFFdkY7OztPQUdHO0lBQ0gsOEJBQThCO1FBQzVCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMscUJBQXFCLENBQUE7UUFFbkQsT0FBTztZQUNMLFFBQVEsRUFBRSxLQUFLLENBQUMsZUFBZTtZQUMvQixXQUFXLEVBQUUsS0FBSyxDQUFDLGtCQUFrQjtTQUN0QyxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILCtCQUErQjtRQUM3QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLHNCQUFzQixDQUFBO1FBRXBELE9BQU87WUFDTCxRQUFRLEVBQUUsS0FBSyxDQUFDLGVBQWU7WUFDL0IsU0FBUyxFQUFFLEtBQUssQ0FBQyxnQkFBZ0I7U0FDbEMsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gseUJBQXlCLENBQUMsT0FBTztRQUMvQixJQUFJLENBQUMsdUJBQXVCLEdBQUcsT0FBTyxDQUFBO0lBQ3hDLENBQUM7SUFFRDs7O09BR0c7SUFDSCx5QkFBeUI7UUFDdkIsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxlQUFlLENBQUMsT0FBTztRQUNyQixJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQTtJQUM5QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQTtJQUMzQixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7OztPQWVHO0lBQ0gsbUNBQW1DLENBQUMsUUFBUTtRQUMxQyxJQUFJLENBQUMsaUNBQWlDLEdBQUcsUUFBUSxDQUFBO0lBQ25ELENBQUM7SUFFRDs7O09BR0c7SUFDSCxtQ0FBbUM7UUFDakMsT0FBTyxJQUFJLENBQUMsaUNBQWlDLENBQUE7SUFDL0MsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwrQkFBK0IsQ0FBQyxPQUFPO1FBQ3JDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLE9BQU8sR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsT0FBTyxFQUFFLENBQUMsQ0FBQTtRQUNsRyxJQUFJLENBQUMsNkJBQTZCLEdBQUcsT0FBTyxDQUFBO0lBQzlDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsbUNBQW1DLENBQUMsT0FBTztRQUN6QyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxPQUFPLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLE9BQU8sRUFBRSxDQUFDLENBQUE7UUFDdEcsSUFBSSxDQUFDLGlDQUFpQyxHQUFHLE9BQU8sQ0FBQTtJQUNsRCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILHNCQUFzQixDQUFDLE9BQU87UUFDNUIsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQTtRQUVuQyxJQUFJLENBQUMsU0FBUztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNENBQTRDLENBQUMsQ0FBQTtRQUM3RSxJQUFJLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDO1lBQUUsT0FBTTtRQUV4RCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsNkJBQTZCLEdBQUcsSUFBSSxDQUFBO1FBQ3pELE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxHQUFHLEVBQUU7WUFDakMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ3pDLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUVYLGtFQUFrRTtRQUNsRSxJQUFJLE9BQU8sVUFBVSxDQUFDLEtBQUssS0FBSyxVQUFVO1lBQUUsVUFBVSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRTlELElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLEVBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFDLENBQUMsQ0FBQTtJQUMzRixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCwyQkFBMkIsQ0FBQyxTQUFTO1FBQ25DLE9BQU8sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxPQUFPLElBQUksSUFBSSxDQUFBO0lBQ3RFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCw0QkFBNEIsQ0FBQyxTQUFTO1FBQ3BDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFMUQsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFNO1FBRWxCLFlBQVksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDOUIsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUNqRCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCx1QkFBdUIsQ0FBQyxTQUFTO1FBQy9CLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFMUQsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFNO1FBRWxCLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDL0MsSUFBSSxDQUFDO1lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO1FBQ3RDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx5Q0FBeUMsU0FBUyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUE7UUFDNUUsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLElBQUk7UUFDNUMsaUVBQWlFO1FBQ2pFLCtEQUErRDtRQUMvRCw4REFBOEQ7UUFDOUQsMkRBQTJEO1FBQzNELGdFQUFnRTtRQUNoRSxRQUFRO1FBQ1IsSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUMzRCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFFL0UsSUFBSSxJQUFJO2dCQUFFLE9BQU07UUFDbEIsQ0FBQztRQUVELDJEQUEyRDtRQUMzRCw0REFBNEQ7UUFDNUQsMkNBQTJDO1FBQzNDLEVBQUU7UUFDRixnRUFBZ0U7UUFDaEUsc0RBQXNEO1FBQ3RELDhEQUE4RDtRQUM5RCx5REFBeUQ7UUFDekQsRUFBRTtRQUNGLGdFQUFnRTtRQUNoRSx5Q0FBeUM7UUFDekM7O21EQUUyQztRQUMzQyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUE7UUFFN0MsSUFBSSxlQUFlLElBQUksT0FBTyxlQUFlLENBQUMsV0FBVyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3pFLGVBQWUsQ0FBQyxXQUFXLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDeEYsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLGVBQWUsSUFBSSxPQUFPLGVBQWUsQ0FBQyxrQkFBa0IsS0FBSyxVQUFVLElBQUksZUFBZSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzlHLGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDMUUsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsd0JBQXdCLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxJQUFJLENBQUMsQ0FBQTtJQUM1RCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQjtRQUMxQjs7bURBRTJDO1FBQzNDLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQTtRQUU3QyxJQUFJLGVBQWUsSUFBSSxPQUFPLGVBQWUsQ0FBQyxzQkFBc0IsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUNwRix5RUFBeUU7WUFDekUsdUVBQXVFO1lBQ3ZFLHdFQUF3RTtZQUN4RSxNQUFNLGVBQWUsQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1FBQ2hELENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyw4QkFBOEIsRUFBRSxDQUFBO0lBQzdDLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCx3QkFBd0IsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxJQUFJO1FBQ3hELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFNUQsSUFBSSxDQUFDLE1BQU07WUFBRSxPQUFNO1FBRW5CLEtBQUssTUFBTSxZQUFZLElBQUksTUFBTSxFQUFFLENBQUM7WUFDbEMsSUFBSSxZQUFZLENBQUMsUUFBUSxFQUFFO2dCQUFFLFNBQVE7WUFFckMsSUFBSSxPQUFPLENBQUE7WUFFWCxJQUFJLENBQUM7Z0JBQ0gsT0FBTyxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsZUFBZSxJQUFJLEVBQUUsQ0FBQyxDQUFBO1lBQ3ZELENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLDZEQUE2RDtnQkFDN0QscURBQXFEO2dCQUNyRCxPQUFPLENBQUMsS0FBSyxDQUFDLHVCQUF1QixJQUFJLGlCQUFpQixZQUFZLENBQUMsY0FBYyxrQkFBa0IsRUFBRSxLQUFLLENBQUMsQ0FBQTtnQkFDL0csU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLENBQUMsT0FBTztnQkFBRSxTQUFRO1lBRXRCLE1BQU0sZ0JBQWdCLEdBQUc7Z0JBQ3ZCLGVBQWU7Z0JBQ2YsR0FBRyxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2FBQ2xELENBQUE7WUFDRCxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUE7WUFDNUUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGdDQUFnQyxDQUFDLEdBQUcsRUFBRTtnQkFDMUQsT0FBTyxDQUFDLGdCQUFnQixJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztxQkFDM0MsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxZQUFZLEVBQUUsSUFBSSxFQUFFLGdCQUFnQixDQUFDLENBQUM7cUJBQ3hGLEtBQUssQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO29CQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsdUJBQXVCLElBQUksaUJBQWlCLFlBQVksQ0FBQyxjQUFjLHlCQUF5QixFQUFFLEtBQUssQ0FBQyxDQUFBO2dCQUN4SCxDQUFDLENBQUMsQ0FBQTtZQUNOLENBQUMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLDRCQUE0QixDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsUUFBUSxDQUFDLENBQUE7WUFFN0QsMEVBQTBFO1lBQzFFLDRFQUE0RTtZQUM1RSwwRUFBMEU7WUFDMUUsaURBQWlEO1lBQ2pELElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUE7WUFFNUM7OztlQUdHO1lBQ0gsTUFBTSxjQUFjLEdBQUcsR0FBRyxFQUFFO2dCQUMxQixJQUFJLENBQUMseUJBQXlCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUMvQyxJQUFJLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEtBQUssUUFBUTtvQkFBRSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFBO1lBQzlILENBQUMsQ0FBQTtZQUVELFFBQVEsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLGNBQWMsQ0FBQyxDQUFBO1FBQy9DLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsOEJBQThCO1FBQ2xDLE1BQU0sUUFBUSxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsQ0FBQTtRQUVwRCxNQUFNLE9BQU8sQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGlDQUFpQyxDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsSUFBSTtRQUN4RCxJQUFJLE9BQU8sWUFBWSxDQUFDLGdCQUFnQixLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3hELE9BQU8sWUFBWSxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQTtRQUNsRCxDQUFDO1FBRUQsT0FBTyxZQUFZLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsa0NBQWtDO1FBQ2hDLE9BQU8sSUFBSSxDQUFDLGdDQUFnQyxDQUFBO0lBQzlDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMkJBQTJCLENBQUMsUUFBUTtRQUNsQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsUUFBUSxDQUFBO0lBQzNDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsa0NBQWtDLENBQUMsUUFBUTtRQUN6QyxJQUFJLENBQUMsZ0NBQWdDLEdBQUcsUUFBUSxDQUFBO0lBQ2xELENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFDO1FBQzlDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBRTFDLElBQUksUUFBUSxFQUFFLENBQUM7WUFDYixNQUFNLFFBQVEsR0FBRyxNQUFNLFFBQVEsQ0FBQyxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO1lBRWpGLElBQUksUUFBUTtnQkFBRSxPQUFPLFFBQVEsQ0FBQTtRQUMvQixDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFNUMsSUFBSSxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRWxDLE9BQU8sSUFBSSxPQUFPLENBQUM7WUFDakIsT0FBTyxFQUFFLEVBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBQztZQUN6RCxTQUFTO1NBQ1YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxPQUFPLEVBQUUsUUFBUTtRQUNwQyxPQUFPLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsY0FBYyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUM3RSxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsYUFBYSxFQUFFLFFBQVE7UUFDaEQsT0FBTyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLG9CQUFvQixDQUFDLGFBQWEsRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUN6RixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLEVBQUUsUUFBUTtRQUN0QyxNQUFNLGFBQWEsR0FBRyx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUVwRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyw0QkFBNEIsRUFBRSxDQUFBO1FBRTNFLElBQUksQ0FBQyxPQUFPO1lBQUUsT0FBTyxNQUFNLFFBQVEsRUFBRSxDQUFBO1FBRXJDLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxPQUFPLEVBQUUsYUFBYSxFQUFFLFFBQVEsQ0FBQyxDQUFBO0lBQ2pGLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsUUFBUSxFQUFFLFFBQVE7UUFDdEMsT0FBTyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLGVBQWUsQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFDL0UsQ0FBQztJQUVEOzs7T0FHRztJQUNILGlCQUFpQjtRQUNmLE9BQU8sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUN6RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsdUJBQXVCO1FBQ3JCLE9BQU8sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtJQUMvRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZ0JBQWdCO1FBQ2QsT0FBTyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO0lBQ3hELENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLFFBQVE7UUFDbEMsT0FBTyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFDM0UsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxFQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBQztRQUMzRCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUV6QyxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFckIsT0FBTyxNQUFNLFFBQVEsQ0FBQztZQUNwQixhQUFhLEVBQUUsSUFBSTtZQUNuQixNQUFNO1lBQ04sT0FBTztZQUNQLFFBQVE7WUFDUixZQUFZO1NBQ2IsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILGNBQWM7UUFDWixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCw2QkFBNkIsQ0FBQyxRQUFRO1FBQ3BDLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDbEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsSUFBSTtRQUNuQyxtRkFBbUY7UUFDbkYsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBO1FBQ2xCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1FBQ3BELE1BQU0sZUFBZSxHQUFHLGFBQWEsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksR0FBRyxFQUFFLENBQUE7UUFDekYsTUFBTSxPQUFPLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsRUFBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxFQUFFLGVBQWUsRUFBQyxDQUFDLENBQUE7UUFFaEcsS0FBSyxNQUFNLFFBQVEsSUFBSSxJQUFJLENBQUMsNEJBQTRCLEVBQUUsQ0FBQztZQUN6RCxNQUFNLGVBQWUsR0FBRyxNQUFNLFFBQVEsQ0FBQztnQkFDckMsR0FBRyxJQUFJO2dCQUNQLGNBQWMsRUFBRSxPQUFPO2FBQ3hCLENBQUMsQ0FBQTtZQUVGLElBQUksZUFBZSxJQUFJLE9BQU8sZUFBZSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUMzRCxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxlQUFlLENBQUMsQ0FBQTtZQUN6QyxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCw4QkFBOEIsQ0FBQyxLQUFLLEVBQUUsUUFBUTtRQUM1QyxPQUFPLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLDhCQUE4QixDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUNyRixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMscUNBQXFDLENBQUMsUUFBUTtRQUNsRCxPQUFPLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsc0NBQXNDLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFBO0lBQ3ZHLENBQUM7SUFFRCw4RUFBOEU7SUFDOUUsMkJBQTJCO1FBQ3pCLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLCtCQUErQixFQUFFLENBQUE7SUFDaEUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsaUJBQWlCLEVBQUUsUUFBUTtRQUMvQyxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQTtRQUNsQyxNQUFNLEVBQ0osUUFBUSxFQUFFLDZCQUE2QixFQUN2QyxtQkFBbUIsRUFDbkIsSUFBSSxFQUNMLEdBQUcsMEJBQTBCLENBQUMsaUJBQWlCLEVBQUUsUUFBUSxFQUFFLCtCQUErQixDQUFDLENBQUE7UUFFNUYsSUFBSSxDQUFDLDZCQUE2QjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQTtRQUUxRjs7bUZBRTJFO1FBQzNFLE1BQU0sR0FBRyxHQUFHLEVBQUUsQ0FBQTtRQUVkLE9BQU8sTUFBTSxJQUFJLENBQUMsaUNBQWlDLENBQUM7WUFDbEQsUUFBUSxFQUFFLDZCQUE2QjtZQUN2QyxHQUFHO1lBQ0gsV0FBVyxFQUFFLG1CQUFtQixJQUFJLElBQUksQ0FBQyxzQkFBc0IsRUFBRTtZQUNqRSxJQUFJO1lBQ0osVUFBVSxFQUFFLGlCQUFpQjtTQUM5QixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxFQUFDLGtCQUFrQixFQUFFLElBQUksR0FBRywrQkFBK0IsRUFBRSxHQUFHLFFBQVEsRUFBQyxFQUFFLFFBQVE7UUFDdkcsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDbEMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxrQkFBa0I7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZEQUE2RCxDQUFDLENBQUE7UUFDdkcsSUFBSSxPQUFPLFFBQVEsSUFBSSxVQUFVO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtREFBbUQsQ0FBQyxDQUFBO1FBQ3ZHLElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1lBQ2hFLE1BQU0sSUFBSSxLQUFLLENBQUMsNENBQTRDLGtCQUFrQixFQUFFLENBQUMsQ0FBQTtRQUNuRixDQUFDO1FBRUQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDdEMsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsa0JBQWtCLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDM0YsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRXJELE9BQU8sTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxJQUFJLEVBQUMsRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFFO1lBQzVFLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1lBQ2xDLE1BQU0sU0FBUyxHQUFHLElBQUksaUJBQWlCLENBQUM7Z0JBQ3RDLGFBQWEsRUFBRSxJQUFJO2dCQUNuQixxQkFBcUI7Z0JBQ3JCLHFCQUFxQixFQUFFLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxVQUFVLENBQUM7Z0JBQzFFLFVBQVU7Z0JBQ1Ysa0JBQWtCO2dCQUNsQixLQUFLO2dCQUNMLE1BQU07YUFDUCxDQUFDLENBQUE7WUFFRixJQUFJLENBQUM7Z0JBQ0gsT0FBTyxNQUFNLFNBQVMsQ0FBQyxXQUFXLENBQUMsS0FBSyxJQUFJLEVBQUU7b0JBQzVDLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO29CQUNsQyxPQUFPLE1BQU0sUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFBO2dCQUNsQyxDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUM7b0JBQVMsQ0FBQztnQkFDVCxTQUFTLENBQUMsUUFBUSxFQUFFLENBQUE7WUFDdEIsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLEVBQUMscUJBQXFCLEVBQUUsa0JBQWtCLEVBQUUsSUFBSSxHQUFHLHFDQUFxQyxFQUFFLGdCQUFnQixFQUFFLE1BQU0sRUFBRSxHQUFHLFFBQVEsRUFBQyxFQUFFLFFBQVE7UUFDcEssSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDbEMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxrQkFBa0I7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1FQUFtRSxDQUFDLENBQUE7UUFDN0csSUFBSSxDQUFDLHFCQUFxQjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsc0VBQXNFLENBQUMsQ0FBQTtRQUNuSCxJQUFJLE9BQU8sUUFBUSxJQUFJLFVBQVU7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlEQUF5RCxDQUFDLENBQUE7UUFFN0csTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBQ3JELE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFFbEYsT0FBTyxNQUFNLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxFQUFDLHFCQUFxQixFQUFFLElBQUksRUFBQyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQUU7WUFDM0csSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7WUFDbEMsTUFBTSxTQUFTLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQztnQkFDdEMsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLHFCQUFxQjtnQkFDckIscUJBQXFCO2dCQUNyQixVQUFVO2dCQUNWLGtCQUFrQjtnQkFDbEIsNEJBQTRCLEVBQUUsS0FBSztnQkFDbkMsS0FBSztnQkFDTCxnQkFBZ0I7Z0JBQ2hCLE1BQU07YUFDUCxDQUFDLENBQUE7WUFFRixJQUFJLENBQUM7Z0JBQ0gsT0FBTyxNQUFNLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUNsQyxDQUFDO29CQUFTLENBQUM7Z0JBQ1QsU0FBUyxDQUFDLFFBQVEsRUFBRSxDQUFBO1lBQ3RCLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFDLFFBQVEsRUFBRSxHQUFHLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUM7UUFDcEYsTUFBTSxLQUFLLEdBQUcsS0FBSyxFQUFFLENBQUMsS0FBSyxDQUFBO1FBQzNCLE1BQU0sY0FBYyxHQUFHLEtBQUssSUFBSSxFQUFFO1lBQ2hDLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1lBQ2xDLE9BQU8sTUFBTSxnQkFBZ0IsQ0FBQyxLQUFLLElBQUksVUFBVSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUM1RCxPQUFPLE1BQU0sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFBO1lBQzVCLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFBO1FBRUQ7O3NDQUU4QjtRQUM5QixJQUFJLFVBQVUsR0FBRyxjQUFjLENBQUE7UUFFL0IsS0FBSyxNQUFNLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNyQyxJQUFJLGdCQUFnQixHQUFHLFVBQVUsQ0FBQTtZQUVqQyxNQUFNLGNBQWMsR0FBRyxLQUFLLElBQUksRUFBRTtnQkFDaEMsT0FBTyxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUMsY0FBYyxDQUFDLEVBQUMsSUFBSSxFQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO29CQUNoRixHQUFHLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxDQUFBO29CQUVwQixPQUFPLE1BQU0sZ0JBQWdCLEVBQUUsQ0FBQTtnQkFDakMsQ0FBQyxDQUFDLENBQUE7WUFDSixDQUFDLENBQUE7WUFFRCxVQUFVLEdBQUcsY0FBYyxDQUFBO1FBQzdCLENBQUM7UUFFRCxPQUFPLE1BQU0sVUFBVSxFQUFFLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQkFBcUIsQ0FBQyxtQkFBbUIsR0FBRyxJQUFJLENBQUMsc0JBQXNCLEVBQUU7UUFDdkUsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDbEM7O21GQUUyRTtRQUMzRSxNQUFNLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFZCxLQUFLLE1BQU0sVUFBVSxJQUFJLG1CQUFtQixFQUFFLENBQUM7WUFDN0MsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBQzdDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxDQUFDLDJCQUEyQixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7Z0JBRTdILElBQUksaUJBQWlCLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsSUFBSSxJQUFJLENBQUMscUNBQXFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxFQUFFLENBQUM7b0JBQ3hJLEdBQUcsQ0FBQyxVQUFVLENBQUMsR0FBRyxpQkFBaUIsQ0FBQTtnQkFDckMsQ0FBQztZQUNILENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksSUFBSSxDQUFDLCtCQUErQixDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQ2hELFNBQVM7Z0JBQ1gsQ0FBQztxQkFBTSxDQUFDO29CQUNOLE1BQU0sS0FBSyxDQUFBO2dCQUNiLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFBO0lBQ1osQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsZ0NBQWdDLENBQUMsUUFBUTtRQUN2QyxJQUFJLFdBQVcsR0FBRyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyw0Q0FBNEMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUUzRyxLQUFLLE1BQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDckQsSUFBSSxDQUFDLElBQUk7Z0JBQUUsU0FBUTtZQUNuQixNQUFNLG1CQUFtQixHQUFHLFdBQVcsQ0FBQTtZQUV2QyxXQUFXLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLCtCQUErQixDQUFDLG1CQUFtQixDQUFDLENBQUE7UUFDL0UsQ0FBQztRQUVELE9BQU8sV0FBVyxFQUFFLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILG1DQUFtQyxDQUFDLFFBQVE7UUFDMUMsSUFBSSxXQUFXLEdBQUcsUUFBUSxDQUFBO1FBRTFCLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUNyRCxJQUFJLENBQUMsSUFBSTtnQkFBRSxTQUFRO1lBQ25CLE1BQU0sbUJBQW1CLEdBQUcsV0FBVyxDQUFBO1lBRXZDLFdBQVcsR0FBRyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsMkJBQTJCLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtRQUMzRSxDQUFDO1FBRUQsT0FBTyxXQUFXLEVBQUUsQ0FBQTtJQUN0QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILCtCQUErQixDQUFDLEtBQUs7UUFDbkMsT0FBTyxLQUFLLFlBQVksS0FBSyxJQUFJLENBQy9CLEtBQUssQ0FBQyxPQUFPLElBQUksMkNBQTJDO1lBQzVELEtBQUssQ0FBQyxPQUFPLElBQUksbUNBQW1DO1lBQ3BELEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLDhDQUE4QyxDQUFDO1lBQ3hFLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLHdCQUF3QixDQUFDLENBQzVGLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLGlCQUFpQixFQUFFLFFBQVE7UUFDakQsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDbEMsTUFBTSxFQUNKLFFBQVEsRUFBRSw2QkFBNkIsRUFDdkMsbUJBQW1CLEVBQ25CLElBQUksRUFDTCxHQUFHLDBCQUEwQixDQUFDLGlCQUFpQixFQUFFLFFBQVEsRUFBRSxpQ0FBaUMsQ0FBQyxDQUFBO1FBRTlGLElBQUksQ0FBQyw2QkFBNkI7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUE7UUFFNUYsTUFBTSxvQkFBb0IsR0FBRyxtQkFBbUIsSUFBSSxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUNqRixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsb0JBQW9CLENBQUMsQ0FBQTtRQUM1RCxNQUFNLGtCQUFrQixHQUFHLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFO1lBQ3BFLElBQUksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBRWpDLE9BQU8sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDeEUsQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLGtCQUFrQixDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNwQyxPQUFPLE1BQU0sNkJBQTZCLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDakQsQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsaUNBQWlDLENBQUM7WUFDbEQsUUFBUSxFQUFFLDZCQUE2QjtZQUN2QyxHQUFHO1lBQ0gsV0FBVyxFQUFFLGtCQUFrQjtZQUMvQixJQUFJO1lBQ0osVUFBVSxFQUFFLG1CQUFtQjtTQUNoQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCw4QkFBOEIsQ0FBQyxVQUFVO1FBQ3ZDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDL0MsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsZ0NBQWdDLENBQUMsVUFBVTtRQUN6QyxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ2xELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsNkJBQTZCO1FBQ2pDLE1BQU0sV0FBVyxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtRQUV0RCxJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSyxFQUFFLENBQUE7UUFFckMsd0JBQXdCO1FBQ3hCLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUVqQixLQUFLLE1BQU0sVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ3JDLElBQUksQ0FBQztnQkFDSCxNQUFNLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUMxQixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3BCLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsTUFBTSxJQUFJLENBQUM7WUFBRSxNQUFNLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUN2QyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxjQUFjLENBQUMsTUFBTSxFQUFFLHFEQUFxRCxDQUFDLENBQUE7SUFDaEgsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyx3QkFBd0I7UUFDNUIsSUFBSSxJQUFJLENBQUMsZ0NBQWdDLEVBQUUsQ0FBQztZQUMxQyxNQUFNLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQTtZQUMzQyxPQUFNO1FBQ1IsQ0FBQztRQUVELG9FQUFvRTtRQUNwRSxNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRTlCLElBQUksQ0FBQyxnQ0FBZ0MsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQ2xELHNCQUFzQjtZQUN0QixNQUFNLFdBQVcsR0FBRyxFQUFFLENBQUE7WUFFdEIsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUE7WUFDekMsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsV0FBVyxDQUFDLElBQUksQ0FBQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDN0UsQ0FBQztZQUVELElBQUksQ0FBQztnQkFDSCxJQUFJLENBQUM7b0JBQ0gsZ0ZBQWdGO29CQUNoRixpRkFBaUY7b0JBQ2pGLGtGQUFrRjtvQkFDbEYsNEVBQTRFO29CQUM1RSwwQ0FBMEM7b0JBQzFDLE1BQU0sSUFBSSxDQUFDLDZCQUE2QixFQUFFLENBQUE7Z0JBQzVDLENBQUM7d0JBQVMsQ0FBQztvQkFDVCxLQUFLLE1BQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7d0JBQ3JELElBQUksQ0FBQyxJQUFJOzRCQUFFLFNBQVE7d0JBRW5CLE1BQU0sSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFBO3dCQUVyQixNQUFNLFNBQVMsR0FBRywrREFBK0QsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTt3QkFDcEcsWUFBWSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQTtvQkFDN0IsQ0FBQztvQkFFRCxLQUFLLE1BQU0sU0FBUyxJQUFJLFlBQVksRUFBRSxDQUFDO3dCQUNyQyxTQUFTLENBQUMsc0JBQXNCLENBQUMsSUFBSSxDQUFDLENBQUE7b0JBQ3hDLENBQUM7b0JBRUQsSUFBSSxDQUFDLDhCQUE4QixDQUFDLEtBQUssRUFBRSxDQUFBO29CQUUzQyw2REFBNkQ7b0JBQzdELElBQUksQ0FBQyw4QkFBOEIsSUFBSSxDQUFDLENBQUE7b0JBQ3hDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxLQUFLLENBQUE7b0JBQy9CLElBQUksQ0FBQyxjQUFjLEdBQUcsS0FBSyxDQUFBO2dCQUM3QixDQUFDO1lBQ0gsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsV0FBVyxDQUFDLElBQUksQ0FBQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDN0UsQ0FBQztZQUVELElBQUksV0FBVyxDQUFDLE1BQU0sS0FBSyxDQUFDO2dCQUFFLE1BQU0sV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQ2xELElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUFFLE1BQU0sSUFBSSxjQUFjLENBQUMsV0FBVyxFQUFFLHdEQUF3RCxDQUFDLENBQUE7UUFDN0gsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUVKLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLGdDQUFnQyxDQUFBO1FBQzdDLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxnQ0FBZ0MsR0FBRyxJQUFJLENBQUE7UUFDOUMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILDhCQUE4QixDQUFDLE9BQU8sRUFBRSxhQUFhO1FBQ25ELE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLENBQUE7UUFFOUMsSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFNUMsTUFBTSxLQUFLLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUV0RCxJQUFJLENBQUMsS0FBSztZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXhCLE9BQU8sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMseUJBQXlCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLGFBQWEsQ0FBQyxDQUFBO0lBQ3hGLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsY0FBYztRQUNsQixPQUFPLHdCQUF3QixDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO0lBQ3hELENBQUM7SUFFRDs7O09BR0c7SUFDSCxtQkFBbUI7UUFDakIsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGUgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7KGFyZzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD4pID0+IFByb21pc2U8VD59IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIFdpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gW2RhdGFiYXNlSWRlbnRpZmllcnNdIC0gRGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gaW5jbHVkZSBpbiB0aGUgY29ubmVjdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBIdW1hbi1yZWFkYWJsZSBuYW1lIGZvciB0aGUgY2hlY2tlZC1vdXQgZGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gKi9cbi8qKlxuICogT25lIGFkYXB0ZXIgaW5zdGFuY2UgYW5kIGl0cyBzZXJpYWxpemVkIHJlYWR5L2Nsb3NlIGxpZmVjeWNsZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qc1wiKS5kZWZhdWx0fSBhZGFwdGVyIC0gQWRhcHRlciBvd25lZCBieSB0aGlzIGdlbmVyYXRpb24uXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNsb3NpbmcgLSBXaGV0aGVyIGNsb3NlIGhhcyBjbGFpbWVkIHRoaXMgZ2VuZXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gcmVhZHlQcm9taXNlIC0gU2hhcmVkIHJlYWRpbmVzcyBhdHRlbXB0LlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSBjbG9zZVByb21pc2UgLSBTaGFyZWQgY2xvc2Ugb3BlcmF0aW9uLlxuICovXG5cbmltcG9ydCB7IGRpZ2cgfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBnZXR0ZXh0Q29uZmlnIGZyb20gXCJnZXR0ZXh0LXVuaXZlcnNhbC9idWlsZC9zcmMvY29uZmlnLmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuaW1wb3J0IHRyYW5zbGF0ZSBmcm9tIFwiZ2V0dGV4dC11bml2ZXJzYWwvYnVpbGQvc3JjL3RyYW5zbGF0ZS5qc1wiXG5pbXBvcnQgQWJpbGl0eSBmcm9tIFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qc1wiXG5pbXBvcnQgRGF0YWJhc2VPcGVyYXRpb24gZnJvbSBcIi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCJcbmltcG9ydCB7IGluaXRpYWxpemVBdWRpdGVkTW9kZWxSZWxhdGlvbnNoaXBzIH0gZnJvbSBcIi4vZGF0YWJhc2UvcmVjb3JkL2F1ZGl0aW5nLmpzXCJcbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzIGZyb20gXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLXN1YnNjcmliZXJzLmpzXCJcbmltcG9ydCB7IEN1cnJlbnRDb25maWd1cmF0aW9uTm90U2V0RXJyb3IsIGN1cnJlbnRDb25maWd1cmF0aW9uLCBzZXRDdXJyZW50Q29uZmlndXJhdGlvbiB9IGZyb20gXCIuL2N1cnJlbnQtY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQgeyByZXF1ZXN0RGV0YWlscyB9IGZyb20gXCIuL2Vycm9yLXJlcG9ydGluZy9yZXF1ZXN0LWRldGFpbHMuanNcIlxuaW1wb3J0IExvZ1JlZGFjdG9yIGZyb20gXCIuL2xvZy1yZWRhY3Rvci5qc1wiXG5pbXBvcnQgeyBmcm9udGVuZE1vZGVsQXBpTWFuaWZlc3QsIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24sIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0IH0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHsgY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXksIG5vcm1hbGl6ZU9mZmxpbmVHcmFudFNpZ25pbmdLZXkgfSBmcm9tIFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIlxuaW1wb3J0IFBsdWdpblJvdXRlcyBmcm9tIFwiLi9yb3V0ZXMvcGx1Z2luLXJvdXRlcy5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVUZXN0QWN0aXZpdHlOYW1lIH0gZnJvbSBcIi4vdGVzdGluZy90ZXN0LXByb2ZpbGUtYWN0aXZpdHkuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVUaW1lWm9uZSB9IGZyb20gXCIuL3RpbWUtem9uZS5qc1wiXG5pbXBvcnQgeyB3aXRoVHJhY2tlZFN0YWNrIH0gZnJvbSBcIi4vdXRpbHMvd2l0aC10cmFja2VkLXN0YWNrLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNQYWNrYWdlIGZyb20gXCIuL3BhY2thZ2VzL3ZlbG9jaW91cy1wYWNrYWdlLmpzXCJcbmltcG9ydCBGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSBmcm9tIFwiLi90ZW5hbnRzL2Zyb250ZW5kLXRlbmFudC1zcWxpdGUtbGlmZWN5Y2xlLmpzXCJcbmltcG9ydCB7IHJlc29sdmVHZW5lcmF0aW9uSWQsIHJlc29sdmVJbml0aWFsR2VuZXJhdGlvblN0YXRlLCByZXNvbHZlTGlmZWN5Y2xlU29ja2V0UGF0aCB9IGZyb20gXCIuL2JhY2tncm91bmQtam9icy9nZW5lcmF0aW9uLWlkZW50aXR5LmpzXCJcbmltcG9ydCB7IHJ1blNodXRkb3duU3RlcHMgfSBmcm9tIFwiLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuXG5leHBvcnQgeyBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yIH1cblxuLyoqXG4gKiBSdW5zIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgd29ya2luZyBkaXJlY3Rvcnkgd2hlbiB0aGUgcnVudGltZSBleHBvc2VzIG9uZS5cbiAqL1xuZnVuY3Rpb24gY3VycmVudFdvcmtpbmdEaXJlY3RvcnkoKSB7XG4gIGNvbnN0IHByb2Nlc3NPYmplY3QgPSAvKiogQHR5cGUge3tjd2Q/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gfCB1bmRlZmluZWR9ICovIChnbG9iYWxUaGlzLnByb2Nlc3MpXG5cbiAgaWYgKHR5cGVvZiBwcm9jZXNzT2JqZWN0Py5jd2QgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIHJldHVybiBwcm9jZXNzT2JqZWN0LmN3ZCgpXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIG92ZXJsb2FkZWQgd2l0aC9lbnN1cmUgY29ubmVjdGlvbnMgYXJndW1lbnRzLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zT3B0aW9uc1R5cGUgfCBXaXRoQ29ubmVjdGlvbnNDYWxsYmFja1R5cGU8VD59IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+IHwgdW5kZWZpbmVkfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGRlZmF1bHROYW1lIC0gRGVmYXVsdCBjaGVja291dCBuYW1lLlxuICogQHJldHVybnMge3tkYXRhYmFzZUlkZW50aWZpZXJzOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCwgbmFtZTogc3RyaW5nLCBjYWxsYmFjazogV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+IHwgdW5kZWZpbmVkfX0gUmVzb2x2ZWQgY2hlY2tvdXQgb3B0aW9ucyBhbmQgY2FsbGJhY2suXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgZGVmYXVsdE5hbWUpIHtcbiAgaWYgKHR5cGVvZiBvcHRpb25zT3JDYWxsYmFjayA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBjb25zdCBhY3R1YWxDYWxsYmFjayA9IC8qKiBAdHlwZSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSAqLyAob3B0aW9uc09yQ2FsbGJhY2spXG5cbiAgICByZXR1cm4ge2RhdGFiYXNlSWRlbnRpZmllcnM6IHVuZGVmaW5lZCwgbmFtZTogZGVmYXVsdE5hbWUsIGNhbGxiYWNrOiBhY3R1YWxDYWxsYmFja31cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGF0YWJhc2VJZGVudGlmaWVyczogb3B0aW9uc09yQ2FsbGJhY2suZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICBuYW1lOiBvcHRpb25zT3JDYWxsYmFjay5uYW1lIHx8IGRlZmF1bHROYW1lLFxuICAgIGNhbGxiYWNrXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGNhbm9uaWNhbCBkZWJ1ZyBzbmFwc2hvdCB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU25hcHNob3QgdmFsdWUgdG8gY2Fub25pY2FsaXplLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBTbmFwc2hvdCB2YWx1ZSB3aXRoIG9iamVjdCBrZXlzIHNvcnRlZCByZWN1cnNpdmVseS5cbiAqL1xuZnVuY3Rpb24gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gdmFsdWVcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUubWFwKChlbnRyeSkgPT4gY2Fub25pY2FsRGVidWdTbmFwc2hvdFZhbHVlKGVudHJ5KSlcblxuICByZXR1cm4gT2JqZWN0LmtleXModmFsdWUpLnNvcnQoKS5yZWR1Y2UoKHJlc3VsdCwga2V5KSA9PiB7XG4gICAgcmVzdWx0W2tleV0gPSBjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlba2V5XSlcbiAgICByZXR1cm4gcmVzdWx0XG4gIH0sIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe30pKVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlndXJhdGlvbiAtIEJhc2UgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGUgfCBQYXJ0aWFsPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlPiB8IHZvaWR9IG92ZXJyaWRlQ29uZmlndXJhdGlvbiAtIFRlbmFudCBvdmVycmlkZSBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIE1lcmdlZCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBtZXJnZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG92ZXJyaWRlQ29uZmlndXJhdGlvbikge1xuICBpZiAoIW92ZXJyaWRlQ29uZmlndXJhdGlvbikgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuXG4gIHJldHVybiB7XG4gICAgLi4uZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgIC4uLm92ZXJyaWRlQ29uZmlndXJhdGlvbixcbiAgICByZWNvcmQ6IHtcbiAgICAgIC4uLihkYXRhYmFzZUNvbmZpZ3VyYXRpb24ucmVjb3JkIHx8IHt9KSxcbiAgICAgIC4uLihvdmVycmlkZUNvbmZpZ3VyYXRpb24ucmVjb3JkIHx8IHt9KVxuICAgIH0sXG4gICAgc3FsQ29uZmlnOiB7XG4gICAgICAuLi4oZGF0YWJhc2VDb25maWd1cmF0aW9uLnNxbENvbmZpZyB8fCB7fSksXG4gICAgICAuLi4ob3ZlcnJpZGVDb25maWd1cmF0aW9uLnNxbENvbmZpZyB8fCB7fSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgZ3JhY2Ugd2luZG93IChtcykgYmVmb3JlIGEgc3VzdGFpbmVkIGJlYWNvbiBvdXRhZ2UgaXMgcmVwb3J0ZWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyZWQgYHVucmVhY2hhYmxlUmVwb3J0TXNgLCBpZiBhbnkuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBjb25maWd1cmVkIHZhbHVlIHdoZW4gaXQncyBhIGZpbml0ZSBudW1iZXIsIG90aGVyd2lzZSB0aGUgMzBzIGRlZmF1bHQuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVCZWFjb25VbnJlYWNoYWJsZVJlcG9ydE1zKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgcmV0dXJuIDMwXzAwMFxufVxuXG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX0JZVEVTID0gMTYgKiAxMDI0ICogMTAyNFxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfSU5CT1VORF9NQVhfUEVORElOR19NRVNTQUdFUyA9IDI1NlxuY29uc3QgREVGQVVMVF9XRUJTT0NLRVRfT1VUQk9VTkRfTUFYX1BFTkRJTkdfQllURVMgPSAxNiAqIDEwMjQgKiAxMDI0XG5jb25zdCBERUZBVUxUX1dFQlNPQ0tFVF9PVVRCT1VORF9NQVhfUEVORElOR19GUkFNRVMgPSAyNTZcblxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQgPSAxMDI0XG5jb25zdCBERUZBVUxUX0NPTVBSRVNTSU9OX0JST1RMSV9RVUFMSVRZID0gNFxuY29uc3QgREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMID0gNlxuXG4vKipcbiAqIFZhbGlkYXRlcyBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlciBjb25maWd1cmF0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25maWd1cmVkIHBvc2l0aXZlIHNhZmUgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29uZmlndXJhdGlvbiBrZXkuXG4gKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFZhbHVlIC0gRGVmYXVsdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgb3IgZGVmYXVsdCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVTYWZlSW50ZWdlcih2YWx1ZSwgbmFtZSwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgJHtuYW1lfSBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyYClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbiBpbnRlZ2VyIGNvbmZpZ3VyYXRpb24gdmFsdWUgaW5zaWRlIGFuIGluY2x1c2l2ZSByYW5nZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZmlndXJlZCBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb25maWd1cmF0aW9uIGtleS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtaW4gLSBNaW5pbXVtIGFjY2VwdGVkIHZhbHVlIChpbmNsdXNpdmUpLlxuICogQHBhcmFtIHtudW1iZXJ9IG1heCAtIE1heGltdW0gYWNjZXB0ZWQgdmFsdWUgKGluY2x1c2l2ZSkuXG4gKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFZhbHVlIC0gRGVmYXVsdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVmFsaWRhdGVkIGNvbmZpZ3VyZWQgb3IgZGVmYXVsdCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gaW50ZWdlckluUmFuZ2UodmFsdWUsIG5hbWUsIG1pbiwgbWF4LCBkZWZhdWx0VmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBkZWZhdWx0VmFsdWVcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCBtaW4gfHwgdmFsdWUgPiBtYXgpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGAke25hbWV9IG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuICR7bWlufSBhbmQgJHttYXh9YClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgdGhlIGJ1ZmZlcmVkIEhUVFAgcmVzcG9uc2UgY29tcHJlc3Npb24gY29uZmlndXJhdGlvbi4gQ29tcHJlc3Npb24gaXNcbiAqIGVuYWJsZWQgYnkgZGVmYXVsdCB3aGVuIHRoZSBzZXR0aW5nIGlzIGFic2VudDsgYGZhbHNlYCBvciBge2VuYWJsZWQ6IGZhbHNlfWBcbiAqIGRpc2FibGVzIGl0IGdsb2JhbGx5LlxuICogQHBhcmFtIHtib29sZWFuIHwgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkh0dHBDb21wcmVzc2lvbkNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IHZhbHVlIC0gQ29uZmlndXJlZCBjb21wcmVzc2lvbiB2YWx1ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEh0dHBDb21wcmVzc2lvbkNvbmZpZ3VyYXRpb259IC0gTm9ybWFsaXplZCBjb21wcmVzc2lvbiBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVIdHRwQ29tcHJlc3Npb24odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IHRydWUpIHtcbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHRocmVzaG9sZDogREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQsIGJyb3RsaVF1YWxpdHk6IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFksIGd6aXBMZXZlbDogREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMfVxuICB9XG5cbiAgaWYgKHZhbHVlID09PSBmYWxzZSkge1xuICAgIHJldHVybiB7ZW5hYmxlZDogZmFsc2UsIHRocmVzaG9sZDogREVGQVVMVF9DT01QUkVTU0lPTl9USFJFU0hPTEQsIGJyb3RsaVF1YWxpdHk6IERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFksIGd6aXBMZXZlbDogREVGQVVMVF9DT01QUkVTU0lPTl9HWklQX0xFVkVMfVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCB2YWx1ZSA9PT0gbnVsbCB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24gbXVzdCBiZSBhIGJvb2xlYW4gb3IgYW4gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuICB9XG5cbiAgY29uc3Qge2Jyb3RsaVF1YWxpdHksIGVuYWJsZWQsIGd6aXBMZXZlbCwgdGhyZXNob2xkLCAuLi5yZXN0Q29tcHJlc3Npb259ID0gdmFsdWVcbiAgY29uc3QgcmVzdENvbXByZXNzaW9uS2V5cyA9IE9iamVjdC5rZXlzKHJlc3RDb21wcmVzc2lvbilcblxuICBpZiAocmVzdENvbXByZXNzaW9uS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgaHR0cFNlcnZlci5jb21wcmVzc2lvbiByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7cmVzdENvbXByZXNzaW9uS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGJyb3RsaVF1YWxpdHksIGVuYWJsZWQsIGd6aXBMZXZlbCwgdGhyZXNob2xkKWApXG4gIH1cblxuICBpZiAoZW5hYmxlZCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBlbmFibGVkICE9PSBcImJvb2xlYW5cIikge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uZW5hYmxlZCBtdXN0IGJlIGEgYm9vbGVhbiwgZ290OiAke1N0cmluZyhlbmFibGVkKX1gKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiBlbmFibGVkID8/IHRydWUsXG4gICAgdGhyZXNob2xkOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHRocmVzaG9sZCwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLnRocmVzaG9sZFwiLCBERUZBVUxUX0NPTVBSRVNTSU9OX1RIUkVTSE9MRCksXG4gICAgYnJvdGxpUXVhbGl0eTogaW50ZWdlckluUmFuZ2UoYnJvdGxpUXVhbGl0eSwgXCJodHRwU2VydmVyLmNvbXByZXNzaW9uLmJyb3RsaVF1YWxpdHlcIiwgMCwgMTEsIERFRkFVTFRfQ09NUFJFU1NJT05fQlJPVExJX1FVQUxJVFkpLFxuICAgIGd6aXBMZXZlbDogaW50ZWdlckluUmFuZ2UoZ3ppcExldmVsLCBcImh0dHBTZXJ2ZXIuY29tcHJlc3Npb24uZ3ppcExldmVsXCIsIDAsIDksIERFRkFVTFRfQ09NUFJFU1NJT05fR1pJUF9MRVZFTClcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNDb25maWd1cmF0aW9uIHtcbiAgLyoqXG4gICAqIENsb3NlIGRhdGFiYXNlIGNvbm5lY3Rpb25zIHByb21pc2UuXG4gICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2UgPSBudWxsXG5cbiAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICBfYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9ucyBjdXJyZW50bHkgaG9sZGluZyBhIGxvY2suIFRoZXNlIGFyZSBzcGF3bmVkXG4gICAqIG91dHNpZGUgdGhlIHBvb2xzJyB0cmFja2VkIHNldHMgKHNvIGEgaG9sZC10aW1lb3V0IGxvY2sgc3Vydml2ZXMgcG9vbCBjaGVja291dHMpLFxuICAgKiBzbyBgY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zYCB3b3VsZCBvdGhlcndpc2Ugd2FsayBwYXN0IHRoZW07IHRyYWNraW5nIHRoZW0gaGVyZVxuICAgKiBsZXRzIGEgc2h1dGRvd24gY2xvc2UgdGhlbSBhbmQgcmVsZWFzZSB0aGUgbG9jayBpbnN0ZWFkIG9mIG9ycGhhbmluZyBpdC5cbiAgICogQHR5cGUge1NldDxpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zID0gbmV3IFNldCgpXG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0NvbmZpZ3VyYXRpb259IC0gVGhlIGN1cnJlbnQuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudCgpIHtcbiAgICByZXR1cm4gY3VycmVudENvbmZpZ3VyYXRpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNvbmZpZ3VyYXRpb25BcmdzVHlwZX0gYXJncyAtIENvbmZpZ3VyYXRpb24gYXJndW1lbnRzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FiaWxpdHlSZXNvbHZlciwgYWJpbGl0eVJlc291cmNlcywgYXR0YWNobWVudHMsIGF1dG9sb2FkID0gdHJ1ZSwgYmFja2dyb3VuZEpvYnMsIGJhY2tlbmRQcm9qZWN0cywgYmVhY29uLCBjb29raWVTZWNyZXQsIGNvcnMsIGRhdGFiYXNlLCBkZWJ1ZyA9IGZhbHNlLCBkZWJ1Z0VuZHBvaW50ID0gZmFsc2UsIGFwaU1hbmlmZXN0ID0gZmFsc2UsIGRpcmVjdG9yeSwgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzID0gdHJ1ZSwgZW52aXJvbm1lbnQsIGVudmlyb25tZW50SGFuZGxlciwgZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMsIGZyb250ZW5kVGVuYW50U3FsaXRlLCBodHRwU2VydmVyLCBpbml0aWFsaXplTW9kZWxzLCBpbml0aWFsaXplcnMsIGxvY2FsZSwgbG9jYWxlRmFsbGJhY2tzLCBsb2NhbGVzLCBsb2dnaW5nLCBtYWlsZXJCYWNrZW5kLCBwYWNrYWdlcywgcmVxdWVzdFRpbWVvdXRNcywgcm91dGVSZXNvbHZlckhvb2tzLCBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9icywgc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycywgc3RydWN0dXJlU3FsLCBzeW5jLCB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycywgdGVuYW50RGF0YWJhc2VSZXNvbHZlciwgdGVuYW50UmVzb2x2ZXIsIHRlc3RpbmcsIHRpbWVab25lLCB0aW1lem9uZU9mZnNldE1pbnV0ZXMsIHRydXN0ZWRQcm94aWVzLCB3ZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXIsIHdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLl9hYmlsaXR5UmVzb2x2ZXIgPSBhYmlsaXR5UmVzb2x2ZXJcbiAgICB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzID0gYWJpbGl0eVJlc291cmNlcyB8fCBbXVxuICAgIHRoaXMuX2F1dG9sb2FkID0gYXV0b2xvYWRcbiAgICB0aGlzLl9iYWNrZ3JvdW5kSm9icyA9IGJhY2tncm91bmRKb2JzXG4gICAgdGhpcy5fYmVhY29uID0gYmVhY29uXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gY2xpZW50IHZhbHVlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBiZWFjb24gY29ubmVjdCBwcm9taXNlIHZhbHVlLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiByZXBvcnQgdGltZXIgdmFsdWUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAtIFBlbmRpbmcgXCJiZWFjb24gc3RpbGwgdW5yZWFjaGFibGVcIiByZXBvcnQgdGltZXIuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGJlYWNvbiBvdXRhZ2UgcmVwb3J0ZWQgdmFsdWUuXG4gICAgICogQHR5cGUge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY3VycmVudCBiZWFjb24gb3V0YWdlIGhhcyBhbHJlYWR5IGJlZW4gcmVwb3J0ZWQuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uT3V0YWdlUmVwb3J0ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYmVhY29uIGxhc3QgZG93biBlcnJvciB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e3N0YWdlOiBcImJlYWNvbi1jb25uZWN0XCIgfCBcImJlYWNvbi1kaXNjb25uZWN0XCIsIGVycm9yOiBFcnJvcn0gfCB1bmRlZmluZWR9IC0gTGF0ZXN0IGJlYWNvbi1kb3duIGRldGFpbHMsIHJlcG9ydGVkIG9ubHkgaWYgdGhlIG91dGFnZSBpcyBzdXN0YWluZWQuXG4gICAgICovXG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzID0gc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNcbiAgICB0aGlzLl9hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzIHx8IHt9XG4gICAgLy8gQ29weSBzbyBhcHBlbmRpbmcgcGFja2FnZS1kZXJpdmVkIGVudHJpZXMgYmVsb3cgbmV2ZXIgbXV0YXRlcyBhIGNhbGxlcidzXG4gICAgLy8gc2hhcmVkIGFycmF5IChjb25maWcgbW9kdWxlcyBjb21tb25seSBleHBvcnQgYSByZXVzZWQgYmFja2VuZFByb2plY3RzIGFycmF5KS5cbiAgICB0aGlzLl9iYWNrZW5kUHJvamVjdHMgPSBiYWNrZW5kUHJvamVjdHMgPyBbLi4uYmFja2VuZFByb2plY3RzXSA6IFtdXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJUeXBlW119ICovXG4gICAgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzID0gW11cbiAgICB0aGlzLmNvcnMgPSBjb3JzXG4gICAgdGhpcy5fY29va2llU2VjcmV0ID0gY29va2llU2VjcmV0XG4gICAgdGhpcy5kYXRhYmFzZSA9IGRhdGFiYXNlXG4gICAgdGhpcy5kZWJ1ZyA9IGRlYnVnXG4gICAgdGhpcy5fZGVidWdFbmRwb2ludCA9IHRoaXMuX25vcm1hbGl6ZURlYnVnRW5kcG9pbnQoZGVidWdFbmRwb2ludClcbiAgICB0aGlzLl9hcGlNYW5pZmVzdCA9IHRoaXMuX25vcm1hbGl6ZUFwaU1hbmlmZXN0KGFwaU1hbmlmZXN0KVxuICAgIHRoaXMuX2Vudmlyb25tZW50ID0gZW52aXJvbm1lbnQgfHwgZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX0VOViB8fCBnbG9iYWxUaGlzLnByb2Nlc3M/LmVudi5OT0RFX0VOViB8fCBcImRldmVsb3BtZW50XCJcbiAgICB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIgPSBlbnZpcm9ubWVudEhhbmRsZXJcbiAgICB0aGlzLl9lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMgPSBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXNcbiAgICB0aGlzLl9leHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyA9IGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzID09PSB1bmRlZmluZWRcbiAgICAgID8gc2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycyAhPT0gdHJ1ZVxuICAgICAgOiBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50c1xuICAgIHRoaXMuX2RpcmVjdG9yeSA9IGRpcmVjdG9yeVxuICAgIHRoaXMuX2luaXRpYWxpemVNb2RlbHMgPSBpbml0aWFsaXplTW9kZWxzXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNQYWNrYWdlW119ICovXG4gICAgdGhpcy5fcGFja2FnZXMgPSAocGFja2FnZXMgfHwgW10pLm1hcCgoZW50cnkpID0+IFZlbG9jaW91c1BhY2thZ2UuZnJvbShlbnRyeSkpXG5cbiAgICAvLyBBcHBlbmQgYSBkZXJpdmVkIGJhY2tlbmQtcHJvamVjdCBwZXIgcGFja2FnZSBzbyB0aGUgZXhpc3RpbmcgcmVzb3VyY2VcbiAgICAvLyBkaXNjb3ZlcnkgKyBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uIG1hY2hpbmVyeSBpbmNsdWRlcyBpdC4gUGFja2FnZVxuICAgIC8vIGZyb250ZW5kIG1vZGVscyBhcmUgZ2VuZXJhdGVkIGludG8gdGhlIGFwcCdzIGZyb250ZW5kLW1vZGVscyBvdXRwdXQuXG4gICAgY29uc3QgYXBwRnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoID0gdGhpcy5fYmFja2VuZFByb2plY3RzWzBdPy5mcm9udGVuZE1vZGVsc091dHB1dFBhdGhcblxuICAgIGZvciAoY29uc3QgdmVsb2Npb3VzUGFja2FnZSBvZiB0aGlzLl9wYWNrYWdlcykge1xuICAgICAgdGhpcy5fYmFja2VuZFByb2plY3RzLnB1c2godmVsb2Npb3VzUGFja2FnZS50b0JhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbih7ZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoOiBhcHBGcm9udGVuZE1vZGVsc091dHB1dFBhdGh9KSlcbiAgICB9XG5cbiAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vaW5pdGlhbGl6ZXIuanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIHRoaXMuX3N1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3F1ZXVlZEluaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIEludmFsaWRhdGVzIG1vZGVsIHBoYXNlcyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIGRhdGFiYXNlIGNvbm5lY3Rpb25zIGNsb3NlZC5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID0gMFxuICAgIC8qKlxuICAgICAqIEluLXByb2dyZXNzIGBpbml0aWFsaXplTW9kZWxzKClgIHByb21pc2UuIE1vZGVsIGluaXRpYWxpemF0aW9uIGlzIGFuXG4gICAgICogYXRvbWljIGJvb3RzdHJhcCBwaGFzZTogY29uY3VycmVudCBjYWxsZXJzIHNoYXJlIGl0LCBhbmQgYSByZWplY3Rpb25cbiAgICAgKiBsZWF2ZXMgdGhlIHBoYXNlIGVsaWdpYmxlIGZvciBhIGxhdGVyIGNvbXBsZXRlIGF0dGVtcHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGBpbml0aWFsaXplKClgIHByb21pc2UsIG1lbW9pemVkIHNvIGNvbmN1cnJlbnQgY2FsbGVycyBhd2FpdCB0aGVcbiAgICAgKiBzYW1lIGJvb3RzdHJhcC4gUmV0YWluZWQgYWNyb3NzIGEgY29ubmVjdGlvbiBjbG9zZSB1bnRpbCBzdGFsZSBib290c3RyYXBcbiAgICAgKiB3b3JrIHNldHRsZXMsIHRoZW4gY2xlYXJlZCBieSBpZGVudGl0eSBiZWZvcmUgdGhlIG5ldyBnZW5lcmF0aW9uIHJldHJpZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICBjb25zdCB3ZWJzb2NrZXRJbmJvdW5kUXVldWUgPSBodHRwU2VydmVyPy53ZWJzb2NrZXRJbmJvdW5kUXVldWVcbiAgICBjb25zdCB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlID0gaHR0cFNlcnZlcj8ud2Vic29ja2V0T3V0Ym91bmRRdWV1ZVxuXG4gICAgdGhpcy5odHRwU2VydmVyID0ge1xuICAgICAgLi4uKGh0dHBTZXJ2ZXIgfHwge30pLFxuICAgICAgY29tcHJlc3Npb246IG5vcm1hbGl6ZUh0dHBDb21wcmVzc2lvbihodHRwU2VydmVyPy5jb21wcmVzc2lvbiksXG4gICAgICB3ZWJzb2NrZXRJbmJvdW5kUXVldWU6IHtcbiAgICAgICAgbWF4UGVuZGluZ0J5dGVzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldEluYm91bmRRdWV1ZT8ubWF4UGVuZGluZ0J5dGVzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0SW5ib3VuZFF1ZXVlLm1heFBlbmRpbmdCeXRlc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX0JZVEVTKSxcbiAgICAgICAgbWF4UGVuZGluZ01lc3NhZ2VzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldEluYm91bmRRdWV1ZT8ubWF4UGVuZGluZ01lc3NhZ2VzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0SW5ib3VuZFF1ZXVlLm1heFBlbmRpbmdNZXNzYWdlc1wiLCBERUZBVUxUX1dFQlNPQ0tFVF9JTkJPVU5EX01BWF9QRU5ESU5HX01FU1NBR0VTKVxuICAgICAgfSxcbiAgICAgIHdlYnNvY2tldE91dGJvdW5kUXVldWU6IHtcbiAgICAgICAgbWF4UGVuZGluZ0J5dGVzOiBwb3NpdGl2ZVNhZmVJbnRlZ2VyKHdlYnNvY2tldE91dGJvdW5kUXVldWU/Lm1heFBlbmRpbmdCeXRlcywgXCJodHRwU2VydmVyLndlYnNvY2tldE91dGJvdW5kUXVldWUubWF4UGVuZGluZ0J5dGVzXCIsIERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0JZVEVTKSxcbiAgICAgICAgbWF4UGVuZGluZ0ZyYW1lczogcG9zaXRpdmVTYWZlSW50ZWdlcih3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlPy5tYXhQZW5kaW5nRnJhbWVzLCBcImh0dHBTZXJ2ZXIud2Vic29ja2V0T3V0Ym91bmRRdWV1ZS5tYXhQZW5kaW5nRnJhbWVzXCIsIERFRkFVTFRfV0VCU09DS0VUX09VVEJPVU5EX01BWF9QRU5ESU5HX0ZSQU1FUylcbiAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBodHRwIHNlcnZlciBpbnN0YW5jZSB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e2dldERlYnVnU25hcHNob3Q6ICgpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5faHR0cFNlcnZlckluc3RhbmNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5sb2NhbGUgPSBsb2NhbGVcbiAgICB0aGlzLmxvY2FsZUZhbGxiYWNrcyA9IGxvY2FsZUZhbGxiYWNrc1xuICAgIHRoaXMubG9jYWxlcyA9IGxvY2FsZXNcbiAgICB0aGlzLl9pbml0aWFsaXplcnMgPSBpbml0aWFsaXplcnNcbiAgICB0aGlzLl90ZXN0aW5nID0gdGVzdGluZ1xuICAgIHRoaXMuX3RpbWVab25lID0gdGltZVpvbmVcbiAgICB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPSB0aW1lem9uZU9mZnNldE1pbnV0ZXNcbiAgICB0aGlzLl90cnVzdGVkUHJveGllcyA9IHRydXN0ZWRQcm94aWVzXG4gICAgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9IHJlcXVlc3RUaW1lb3V0TXNcbiAgICB0aGlzLl9zdHJ1Y3R1cmVTcWwgPSBzdHJ1Y3R1cmVTcWxcbiAgICB0aGlzLl9zeW5jID0gdGhpcy5fbm9ybWFsaXplU3luY0NvbmZpZ3VyYXRpb24oc3luYylcbiAgICB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyA9IHRlbmFudERhdGFiYXNlUHJvdmlkZXJzIHx8IHt9XG4gICAgdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciA9IHRlbmFudERhdGFiYXNlUmVzb2x2ZXJcbiAgICB0aGlzLl90ZW5hbnRSZXNvbHZlciA9IHRlbmFudFJlc29sdmVyXG4gICAgdGhpcy5fd2Vic29ja2V0RXZlbnRzID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpYmVycyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7VmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmliZXJzIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlciA9IHdlYnNvY2tldENoYW5uZWxSZXNvbHZlclxuICAgIHRoaXMuX3dlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIgPSB3ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbGFzc2VzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3NlcyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY2hhbm5lbCBjbGFzc2VzIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3NlcyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBTZXQ8aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0Pj59IC0gY2hhbm5lbFR5cGUg4oaSIGxpdmUgc3Vic2NyaXB0aW9ucyBhY3Jvc3MgYWxsIHNlc3Npb25zLlxuICAgICAqL1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBJbi1mbGlnaHQgbG9jYWwgKHBlci1wcm9jZXNzKSB3ZWJzb2NrZXQgY2hhbm5lbCBicm9hZGNhc3QgZGVsaXZlcmllcyxcbiAgICAgKiBsYXVuY2hlZCBmaXJlLWFuZC1mb3JnZXQgZnJvbSBgX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsYCBzbyBvbmUgc2xvd1xuICAgICAqIHN1YnNjcmliZXIgbmV2ZXIgYmxvY2tzIGFub3RoZXIuIFRyYWNrZWQgaGVyZSBzb1xuICAgICAqIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBjYW4gc25hcHNob3QgYW5kIGRyYWluIHRoZW0gYmVmb3JlIHNldHRsaW5nLlxuICAgICAqIFNldHRsZWQgZGVsaXZlcmllcyBhcmUgcmVtb3ZlZCBieSB0aGUgdHJhY2tpbmctbGV2ZWwgY2xlYW51cC5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogTGF0ZXN0IGxvY2FsIGJyb2FkY2FzdCBkZWxpdmVyeSBwZXIgc3Vic2NyaXB0aW9uLiBDaGFpbmluZyBzdWJzZXF1ZW50XG4gICAgICogZGVsaXZlcmllcyBwcmVzZXJ2ZXMgbGlmZWN5Y2xlIGV2ZW50IG9yZGVyIHdpdGhvdXQgY291cGxpbmcgc2VwYXJhdGVcbiAgICAgKiBzdWJzY3JpYmVycyB0byBvbmUgYW5vdGhlci5cbiAgICAgKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHQsIFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscyA9IG5ldyBXZWFrTWFwKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgd2Vic29ja2V0IHNlc3Npb25zIHZhbHVlLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdD59IC0gTGl2ZSB3ZWJzb2NrZXQgc2Vzc2lvbnMsIGluY2x1ZGluZyBwYXVzZWQgc2Vzc2lvbnMgd2l0aGluIHRoZSBncmFjZSB3aW5kb3cuXG4gICAgICovXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbnMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgcGF1c2VkIHdlYnNvY2tldCBzZXNzaW9ucyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge3Nlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIGdyYWNlVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+LCBwYXVzZWRBdDogbnVtYmVyfT59IC0gc2Vzc2lvbklkIOKGkiBwYXVzZWQgc2Vzc2lvbiBhd2FpdGluZyByZXN1bWUuXG4gICAgICovXG4gICAgdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKiBHcmFjZSBwZXJpb2QgZm9yIHBhdXNlZCBXZWJTb2NrZXQgc2Vzc2lvbnMgYmVmb3JlIHBlcm1hbmVudCB0ZWFyZG93bi4gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzID0gMzAwXG5cbiAgICAvKiogSW50ZXJ2YWwgKHNlY29uZHMpIGJldHdlZW4gc2VydmVy4oaSY2xpZW50IGhlYXJ0YmVhdCBwaW5nczsgMCBkaXNhYmxlcyByZWFwaW5nIG9mIHNpbGVudCBzb2NrZXRzLiAqL1xuICAgIHRoaXMuX3dlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzID0gMzBcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIHdyYXBwZXIgY2FsbGVkIGFyb3VuZCBldmVyeSBXZWJTb2NrZXQtYm9ybmUgcmVxdWVzdCAvXG4gICAgICogY29ubmVjdGlvbiBtZXNzYWdlIC8gY2hhbm5lbCBkaXNwYXRjaC4gQXBwcyByZWdpc3RlciBpdCBoZXJlXG4gICAgICogdG8gc2V0IHVwIHBlci1yZXF1ZXN0IGNvbnRleHQgKGUuZy4gQXN5bmNMb2NhbFN0b3JhZ2UgZm9yXG4gICAgICogbG9jYWxlLCB0ZW5hbnQsIHRyYWNpbmcpIHRoYXQgZG93bnN0cmVhbSBoYW5kbGVycyByZWFkLlxuICAgICAqIEB0eXBlIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH1cbiAgICAgKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRBcm91bmRSZXF1ZXN0ID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBhcm91bmQgYWN0aW9uIHZhbHVlLlxuICAgICAqIEB0eXBlIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9hcm91bmRBY3Rpb24gPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIHdlYnNvY2tldCBzZXNzaW9uIGlkZW50aXR5IHJlc29sdmVyIHZhbHVlLlxuICAgICAqIEB0eXBlIHsoKHNlc3Npb246IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzXCIpLmRlZmF1bHQpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgbnVsbH0gKi9cbiAgICB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlciA9IG51bGxcbiAgICB0aGlzLl9sb2dnaW5nID0gbG9nZ2luZ1xuICAgIHRoaXMuX2xvZ1JlZGFjdG9yID0gbmV3IExvZ1JlZGFjdG9yKHtzZW5zaXRpdmVOYW1lczogbG9nZ2luZz8uc2Vuc2l0aXZlTmFtZXN9KVxuICAgIHRoaXMuX21haWxlckJhY2tlbmQgPSBtYWlsZXJCYWNrZW5kXG4gICAgdGhpcy5fcm91dGVSZXNvbHZlckhvb2tzID0gWy4uLihyb3V0ZVJlc29sdmVySG9va3MgfHwgW10pXVxuICAgIHRoaXMuX2FkZERlYnVnRW5kcG9pbnRSb3V0ZUhvb2soKVxuICAgIHRoaXMuX2FkZEFwaU1hbmlmZXN0Um91dGVIb29rKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgYXBwbGllZCByb3V0ZSBtb3VudHMgdmFsdWUuXG4gICAgICogQHR5cGUge1dlYWtTZXQ8b2JqZWN0Pn0gKi9cbiAgICB0aGlzLl9hcHBsaWVkUm91dGVNb3VudHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fZXJyb3JFdmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgZGF0YWJhc2UgcG9vbHMgdmFsdWUuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiBpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fX0gKi9cbiAgICB0aGlzLmRhdGFiYXNlUG9vbHMgPSB7fVxuICAgIHRoaXMuX2Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlID0gbmV3IEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlKHtjb25maWd1cmF0aW9uOiB0aGlzLCBtYXhPcGVuSGFuZGxlczogZnJvbnRlbmRUZW5hbnRTcWxpdGU/Lm1heE9wZW5IYW5kbGVzfSlcblxuICAgIC8qKlxuICAgICAqIFN0b3JlcyB0aGUgbW9kZWwgY2xhc3NlcyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gKi9cbiAgICB0aGlzLm1vZGVsQ2xhc3NlcyA9IHt9XG5cbiAgICB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnNldENvbmZpZ3VyYXRpb24odGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdXRvbG9hZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgb24gbGF6eSBhY2Nlc3MgaXMgZW5hYmxlZCBnbG9iYWxseS5cbiAgICovXG4gIGdldEF1dG9sb2FkKCkgeyByZXR1cm4gdGhpcy5fYXV0b2xvYWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleHBvc2UgaW50ZXJuYWwgZXJyb3JzIHRvIGNsaWVudHMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHVuZXhwZWN0ZWQgaW50ZXJuYWwgZXJyb3IgZGV0YWlscyBtYXkgYmUgcmV0dXJuZWQgdG8gQVBJIGNsaWVudHMuXG4gICAqL1xuICBnZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpIHsgcmV0dXJuIHRoaXMuX2V4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzID09PSB0cnVlIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGV0aGVyIGZyb250ZW5kLW1vZGVsIGVycm9ycyBleHBvc2Ugb25seSBleHBsaWNpdGx5IHNhZmUgbWVzc2FnZXMuXG4gICAqIEBkZXByZWNhdGVkIFVzZSBgZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKWAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIGludGVybmFsIGVycm9yIGV4cG9zdXJlIGlzIGRpc2FibGVkLlxuICAgKi9cbiAgZ2V0U2VjdXJlRnJvbnRlbmRNb2RlbEVycm9ycygpIHsgcmV0dXJuICF0aGlzLmdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBlbmRwb2ludC5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBwYXRoOiBzdHJpbmcsIHRva2VuOiBzdHJpbmcgfCBudWxsfX0gLSBEZWJ1ZyBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0RGVidWdFbmRwb2ludCgpIHsgcmV0dXJuIHRoaXMuX2RlYnVnRW5kcG9pbnQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGVuZHBvaW50IHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7e2VuYWJsZWQ6IGJvb2xlYW4sIHBhdGg6IHN0cmluZywgdG9rZW5Db25maWd1cmVkOiBib29sZWFufX0gLSBEZWJ1ZyBlbmRwb2ludCBjb25maWcgZm9yIHRoZSBzbmFwc2hvdCwgd2l0aCB0aGUgdG9rZW4gcmVkYWN0ZWQuXG4gICAqL1xuICBfZGVidWdFbmRwb2ludFNuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiB0aGlzLl9kZWJ1Z0VuZHBvaW50LmVuYWJsZWQsXG4gICAgICBwYXRoOiB0aGlzLl9kZWJ1Z0VuZHBvaW50LnBhdGgsXG4gICAgICB0b2tlbkNvbmZpZ3VyZWQ6IEJvb2xlYW4odGhpcy5fZGVidWdFbmRwb2ludC50b2tlbilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGVidWcgZW5kcG9pbnQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IHtwYXRoPzogc3RyaW5nLCB0b2tlbj86IHN0cmluZ319IHZhbHVlIC0gRGVidWcgZW5kcG9pbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBwYXRoOiBzdHJpbmcsIHRva2VuOiBzdHJpbmcgfCBudWxsfX0gLSBOb3JtYWxpemVkIGRlYnVnIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplRGVidWdFbmRwb2ludCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHtlbmFibGVkOiBmYWxzZSwgcGF0aDogXCIvdmVsb2Npb3VzL2RlYnVnXCIsIHRva2VuOiBudWxsfVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoOiBcIi92ZWxvY2lvdXMvZGVidWdcIiwgdG9rZW46IG51bGx9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlYnVnRW5kcG9pbnQgdG8gYmUgYSBib29sZWFuIG9yIG9iamVjdCwgZ290OiAke1N0cmluZyh2YWx1ZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gdmFsdWUucGF0aCB8fCBcIi92ZWxvY2lvdXMvZGVidWdcIlxuXG4gICAgaWYgKHR5cGVvZiBwYXRoICE9PSBcInN0cmluZ1wiIHx8ICFwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlYnVnRW5kcG9pbnQucGF0aCB0byBiZSBhIHN0cmluZyBzdGFydGluZyB3aXRoICcvJywgZ290OiAke1N0cmluZyhwYXRoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gdmFsdWUudG9rZW4gPT09IHVuZGVmaW5lZCB8fCB2YWx1ZS50b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB2YWx1ZS50b2tlblxuXG4gICAgaWYgKHRva2VuICE9PSBudWxsICYmICh0eXBlb2YgdG9rZW4gIT09IFwic3RyaW5nXCIgfHwgIXRva2VuLnRyaW0oKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZGVidWdFbmRwb2ludC50b2tlbiB0byBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcodG9rZW4pfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtlbmFibGVkOiB0cnVlLCBwYXRoLCB0b2tlbjogdG9rZW4gPT09IG51bGwgPyBudWxsIDogdG9rZW4udHJpbSgpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGFwaSBtYW5pZmVzdC5cbiAgICogQHBhcmFtIHtib29sZWFuIHwge3BhdGg/OiBzdHJpbmcsIHRva2VuPzogc3RyaW5nfX0gdmFsdWUgLSBBUEkgbWFuaWZlc3QgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3tlbmFibGVkOiBib29sZWFuLCBwYXRoOiBzdHJpbmcsIHRva2VuOiBzdHJpbmcgfCBudWxsfX0gLSBOb3JtYWxpemVkIEFQSSBtYW5pZmVzdCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX25vcm1hbGl6ZUFwaU1hbmlmZXN0KHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge2VuYWJsZWQ6IGZhbHNlLCBwYXRoOiBcIi9hcGkvbWFuaWZlc3RcIiwgdG9rZW46IG51bGx9XG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGg6IFwiL2FwaS9tYW5pZmVzdFwiLCB0b2tlbjogbnVsbH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXBpTWFuaWZlc3QgdG8gYmUgYSBib29sZWFuIG9yIG9iamVjdCwgZ290OiAke1N0cmluZyh2YWx1ZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gdmFsdWUucGF0aCB8fCBcIi9hcGkvbWFuaWZlc3RcIlxuXG4gICAgaWYgKHR5cGVvZiBwYXRoICE9PSBcInN0cmluZ1wiIHx8ICFwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFwaU1hbmlmZXN0LnBhdGggdG8gYmUgYSBzdHJpbmcgc3RhcnRpbmcgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocGF0aCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IHZhbHVlLnRva2VuID09PSB1bmRlZmluZWQgfHwgdmFsdWUudG9rZW4gPT09IG51bGwgPyBudWxsIDogdmFsdWUudG9rZW5cblxuICAgIGlmICh0b2tlbiAhPT0gbnVsbCAmJiAodHlwZW9mIHRva2VuICE9PSBcInN0cmluZ1wiIHx8ICF0b2tlbi50cmltKCkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFwaU1hbmlmZXN0LnRva2VuIHRvIGJlIGEgbm9uLWVtcHR5IHN0cmluZywgZ290OiAke1N0cmluZyh0b2tlbil9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge2VuYWJsZWQ6IHRydWUsIHBhdGgsIHRva2VuOiB0b2tlbiA9PT0gbnVsbCA/IG51bGwgOiB0b2tlbi50cmltKCl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgYXBpIG1hbmlmZXN0IHJvdXRlIGhvb2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hZGRBcGlNYW5pZmVzdFJvdXRlSG9vaygpIHtcbiAgICBpZiAoIXRoaXMuX2FwaU1hbmlmZXN0LmVuYWJsZWQpIHJldHVyblxuXG4gICAgdGhpcy5hZGRSb3V0ZVJlc29sdmVySG9vaygoe2N1cnJlbnRQYXRoLCByZXF1ZXN0fSkgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QuaHR0cE1ldGhvZCgpICE9PSBcIkdFVFwiKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKGN1cnJlbnRQYXRoICE9PSB0aGlzLl9hcGlNYW5pZmVzdC5wYXRoKSByZXR1cm4gbnVsbFxuXG4gICAgICBpZiAodGhpcy5fYXBpTWFuaWZlc3QudG9rZW4gJiYgIXRoaXMuZGVidWdFbmRwb2ludFJlcXVlc3RBdXRob3JpemVkKHJlcXVlc3QsIHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uOiBcInNob3dcIixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNBcGlNYW5pZmVzdFwiLFxuICAgICAgICBjb250cm9sbGVyUGF0aDogXCIuL2J1aWx0LWluL2FwaS1tYW5pZmVzdC9jb250cm9sbGVyLmpzXCIsXG4gICAgICAgIHNraXBDb250cm9sbGVyQ29ubmVjdGlvbnM6IHRydWUsXG4gICAgICAgIHNraXBBYmlsaXR5UmVzb2x1dGlvbjogdHJ1ZSxcbiAgICAgICAgc2tpcFRlbmFudFJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHZpZXdQYXRoOiBcIi4vYnVpbHQtaW4vYXBpLW1hbmlmZXN0XCJcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGRlYnVnIGVuZHBvaW50IHJvdXRlIGhvb2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hZGREZWJ1Z0VuZHBvaW50Um91dGVIb29rKCkge1xuICAgIGlmICghdGhpcy5fZGVidWdFbmRwb2ludC5lbmFibGVkKSByZXR1cm5cblxuICAgIHRoaXMuYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gXCJHRVRcIikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChjdXJyZW50UGF0aCAhPT0gdGhpcy5fZGVidWdFbmRwb2ludC5wYXRoKSByZXR1cm4gbnVsbFxuXG4gICAgICAvLyBXaGVuIGEgdG9rZW4gaXMgY29uZmlndXJlZCwgYW4gdW5hdXRoZW50aWNhdGVkIHJlcXVlc3QgZ2V0cyBubyByb3V0ZSBhdFxuICAgICAgLy8gYWxsICg0MDQpIHJhdGhlciB0aGFuIGEgNDAxLCBzbyB0aGUgZW5kcG9pbnQncyBleGlzdGVuY2Ugc3RheXMgaGlkZGVuLlxuICAgICAgaWYgKHRoaXMuX2RlYnVnRW5kcG9pbnQudG9rZW4gJiYgIXRoaXMuZGVidWdFbmRwb2ludFJlcXVlc3RBdXRob3JpemVkKHJlcXVlc3QsIHRoaXMuX2RlYnVnRW5kcG9pbnQudG9rZW4pKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3Rpb246IFwic2hvd1wiLFxuICAgICAgICBjb250cm9sbGVyOiBcInZlbG9jaW91c0RlYnVnXCIsXG4gICAgICAgIGNvbnRyb2xsZXJQYXRoOiBcIi4vYnVpbHQtaW4vZGVidWcvY29udHJvbGxlci5qc1wiLFxuICAgICAgICBza2lwQ29udHJvbGxlckNvbm5lY3Rpb25zOiB0cnVlLFxuICAgICAgICBza2lwQWJpbGl0eVJlc29sdXRpb246IHRydWUsXG4gICAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uOiB0cnVlLFxuICAgICAgICB2aWV3UGF0aDogXCIuL2J1aWx0LWluL2RlYnVnXCJcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF1dG9sb2FkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ZhbHVlIC0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBpcyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEF1dG9sb2FkKG5ld1ZhbHVlKSB7IHRoaXMuX2F1dG9sb2FkID0gbmV3VmFsdWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb3JzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNvcnNUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSBjb3JzLlxuICAgKi9cbiAgZ2V0Q29ycygpIHtcbiAgICByZXR1cm4gdGhpcy5jb3JzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaHR0cCBzZXJ2ZXIgY29tcHJlc3Npb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEh0dHBDb21wcmVzc2lvbkNvbmZpZ3VyYXRpb259IC0gTm9ybWFsaXplZCBidWZmZXJlZCByZXNwb25zZSBjb21wcmVzc2lvbiBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0SHR0cFNlcnZlckNvbXByZXNzaW9uKCkge1xuICAgIHJldHVybiB0aGlzLmh0dHBTZXJ2ZXIuY29tcHJlc3Npb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb29raWUgc2VjcmV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENvb2tpZSBzZWNyZXQuXG4gICAqL1xuICBnZXRDb29raWVTZWNyZXQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nvb2tpZVNlY3JldFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ29uZmlndXJhdGlvbn0gLSBTeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRTeW5jQ29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fc3luY1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBvZmZsaW5lIGdyYW50IHNpZ25pbmcga2V5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50U2lnbmluZ0tleX0gLSBDdXJyZW50IHNpZ25pbmcga2V5LlxuICAgKi9cbiAgY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoKSB7XG4gICAgY29uc3Qgc2lnbmluZ0tleXMgPSB0aGlzLmdldFN5bmNDb25maWd1cmF0aW9uKCkub2ZmbGluZUdyYW50U2lnbmluZ0tleXNcblxuICAgIHJldHVybiBjdXJyZW50T2ZmbGluZUdyYW50U2lnbmluZ0tleShzaWduaW5nS2V5cylcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IHN5bmMgLSBTeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NvbmZpZ3VyYXRpb259IC0gTm9ybWFsaXplZCBzeW5jIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0NvbmZpZ3VyYXRpb24oc3luYykge1xuICAgIGNvbnN0IGFwaSA9IHN5bmM/LmFwaVxuICAgIGNvbnN0IGRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSA9IHN5bmM/LmRldmljZUNlcnRpZmljYXRlQmFja2VuZFB1YmxpY0tleSB8fCBudWxsXG4gICAgY29uc3QgY2hhbmdlRmVlZFJldGVudGlvblNpemUgPSBzeW5jPy5jaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudFNpZ25pbmdLZXlzID0gc3luYz8ub2ZmbGluZUdyYW50U2lnbmluZ0tleXMgfHwgW11cbiAgICBjb25zdCBvZmZsaW5lR3JhbnRUdGxNcyA9IHN5bmM/Lm9mZmxpbmVHcmFudFR0bE1zXG5cbiAgICBpZiAoZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5ICE9PSBudWxsICYmICh0eXBlb2YgZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5KSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5IG11c3QgYmUgYSBwdWJsaWMgSlNPTiBXZWIgS2V5IG9iamVjdFwiKVxuICAgIH1cbiAgICBpZiAoY2hhbmdlRmVlZFJldGVudGlvblNpemUgIT09IHVuZGVmaW5lZCAmJiAoIU51bWJlci5pc0ludGVnZXIoY2hhbmdlRmVlZFJldGVudGlvblNpemUpIHx8IGNoYW5nZUZlZWRSZXRlbnRpb25TaXplIDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNoYW5nZUZlZWRSZXRlbnRpb25TaXplIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyXCIpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShvZmZsaW5lR3JhbnRTaWduaW5nS2V5cykpIHRocm93IG5ldyBFcnJvcihcInN5bmMub2ZmbGluZUdyYW50U2lnbmluZ0tleXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIGlmIChvZmZsaW5lR3JhbnRUdGxNcyAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihvZmZsaW5lR3JhbnRUdGxNcykgfHwgb2ZmbGluZUdyYW50VHRsTXMgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMub2ZmbGluZUdyYW50VHRsTXMgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIgbnVtYmVyIG9mIG1pbGxpc2Vjb25kc1wiKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhcGk6IHRoaXMuX25vcm1hbGl6ZVN5bmNBcGlDb25maWd1cmF0aW9uKGFwaSksXG4gICAgICBjaGFuZ2VGZWVkUmV0ZW50aW9uU2l6ZTogY2hhbmdlRmVlZFJldGVudGlvblNpemUgfHwgMTAwMDAsXG4gICAgICBjbGllbnQ6IHRoaXMuX25vcm1hbGl6ZVN5bmNDbGllbnRDb25maWd1cmF0aW9uKHN5bmM/LmNsaWVudCksXG4gICAgICBkZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXksXG4gICAgICBvZmZsaW5lR3JhbnRTaWduaW5nS2V5czogb2ZmbGluZUdyYW50U2lnbmluZ0tleXMubWFwKChrZXkpID0+IG5vcm1hbGl6ZU9mZmxpbmVHcmFudFNpZ25pbmdLZXkoa2V5KSksXG4gICAgICBvZmZsaW5lR3JhbnRUdGxNczogb2ZmbGluZUdyYW50VHRsTXMgfHwgMjQgKiA2MCAqIDYwICogMTAwMFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGNsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbiBjb25zdW1lZCBieSBgU3luY0NsaWVudC5mcm9tQ29uZmlndXJhdGlvbiguLi4pYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NsaWVudENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IGNsaWVudCAtIENsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIGNsaWVudC1zaWRlIHN5bmMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9ub3JtYWxpemVTeW5jQ2xpZW50Q29uZmlndXJhdGlvbihjbGllbnQpIHtcbiAgICBpZiAoY2xpZW50ID09PSB1bmRlZmluZWQgfHwgY2xpZW50ID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBpZiAodHlwZW9mIGNsaWVudCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNsaWVudCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50IG11c3QgYmUgYW4gb2JqZWN0IHdpdGggdHJhbnNwb3J0IGFuZCBhdXRoZW50aWNhdGlvblRva2VuXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge2F1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgaXNPbmxpbmUsIG1vdW50UGF0aCwgb25FcnJvciwgcmVhbHRpbWUsIHRyYW5zcG9ydCwgd2Vic29ja2V0Q2xpZW50LCB3ZWJzb2NrZXRVcmwsIC4uLnJlc3RDbGllbnR9ID0gY2xpZW50XG4gICAgY29uc3QgcmVzdENsaWVudEtleXMgPSBPYmplY3Qua2V5cyhyZXN0Q2xpZW50KVxuXG4gICAgaWYgKHJlc3RDbGllbnRLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Jlc3RDbGllbnRLZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBpc09ubGluZSwgbW91bnRQYXRoLCBvbkVycm9yLCByZWFsdGltZSwgdHJhbnNwb3J0LCB3ZWJzb2NrZXRDbGllbnQsIHdlYnNvY2tldFVybClgKVxuICAgIH1cbiAgICBpZiAoIXRyYW5zcG9ydCB8fCB0eXBlb2YgdHJhbnNwb3J0ICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiB0cmFuc3BvcnQucG9zdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC50cmFuc3BvcnQgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBhIHBvc3QocGF0aCwgYm9keSkgbWV0aG9kIChsaWtlIHRoZSBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2xpZW50KVwiKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGF1dGhlbnRpY2F0aW9uVG9rZW4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYXV0aGVudGljYXRpb25Ub2tlbiBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIHRoZSBhdXRoIHRva2VuIHNlbnQgd2l0aCBzeW5jIHJlcXVlc3RzXCIpXG4gICAgfVxuICAgIGlmIChpc09ubGluZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBpc09ubGluZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5pc09ubGluZSBtdXN0IGJlIGEgZnVuY3Rpb24gcmVzb2x2aW5nIGNvbm5lY3Rpdml0eVwiKVxuICAgIH1cbiAgICBpZiAob25FcnJvciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvbkVycm9yICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9uRXJyb3IgbXVzdCBiZSBhIGZ1bmN0aW9uIHJlcG9ydGluZyBiYWNrZ3JvdW5kIHN5bmMgZmFpbHVyZXNcIilcbiAgICB9XG4gICAgaWYgKGJhdGNoU2l6ZSAhPT0gdW5kZWZpbmVkICYmICghTnVtYmVyLmlzSW50ZWdlcihiYXRjaFNpemUpIHx8IGJhdGNoU2l6ZSA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQuYmF0Y2hTaXplIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyXCIpXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudC5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuICAgIGlmICh3ZWJzb2NrZXRDbGllbnQgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHdlYnNvY2tldENsaWVudCAhPT0gXCJvYmplY3RcIiB8fCB3ZWJzb2NrZXRDbGllbnQgPT09IG51bGwgfHwgdHlwZW9mIHdlYnNvY2tldENsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC53ZWJzb2NrZXRDbGllbnQgbXVzdCBiZSBhIHdlYnNvY2tldCBjbGllbnQgd2l0aCBhIHN1YnNjcmliZUNoYW5uZWwgbWV0aG9kIChsaWtlIFZlbG9jaW91c1dlYnNvY2tldENsaWVudClcIilcbiAgICB9XG4gICAgaWYgKHdlYnNvY2tldFVybCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB3ZWJzb2NrZXRVcmwgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHdlYnNvY2tldFVybCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50LndlYnNvY2tldFVybCBtdXN0IGJlIGEgVVJMIHN0cmluZyBvciBhIGZ1bmN0aW9uIHJlc29sdmluZyBvbmUsIGdvdDogJHtTdHJpbmcod2Vic29ja2V0VXJsKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplLFxuICAgICAgaXNPbmxpbmUsXG4gICAgICBtb3VudFBhdGg6IChtb3VudFBhdGggfHwgXCIvdmVsb2Npb3VzL3N5bmNcIikucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCIsXG4gICAgICBvbkVycm9yLFxuICAgICAgcmVhbHRpbWUsXG4gICAgICB0cmFuc3BvcnQsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQsXG4gICAgICB3ZWJzb2NrZXRVcmxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBzeW5jIEFQSSBlbmRwb2ludCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gYXBpIC0gU3luYyBBUEkgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQXBpQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHN5bmMgQVBJIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfbm9ybWFsaXplU3luY0FwaUNvbmZpZ3VyYXRpb24oYXBpKSB7XG4gICAgaWYgKGFwaSA9PT0gdW5kZWZpbmVkIHx8IGFwaSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgaWYgKHR5cGVvZiBhcGkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhcGkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmFwaSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGEgcmVzb3VyY2VDbGFzc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9ID0gYXBpXG5cbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzIG11c3QgYmUgYSByZXNvdXJjZSBjbGFzcywgZ290OiAke1N0cmluZyhyZXNvdXJjZUNsYXNzKX1gKVxuICAgIH1cbiAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5yZXNvdXJjZUNsYXNzICR7cmVzb3VyY2VDbGFzcy5uYW1lfSBtdXN0IGRlZmluZSBzdGF0aWMgTW9kZWxDbGFzc2ApXG4gICAgfVxuICAgIGlmIChtb3VudFBhdGggIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG1vdW50UGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhbW91bnRQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmFwaS5tb3VudFBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhtb3VudFBhdGgpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHttb3VudFBhdGgsIHJlc291cmNlQ2xhc3N9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlPn0gLSBUaGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2UpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgIGlmICghdGhpcy5kYXRhYmFzZVt0aGlzLmdldEVudmlyb25tZW50KCldKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gZm9yIGVudmlyb25tZW50OiAke3RoaXMuZ2V0RW52aXJvbm1lbnQoKX0gLSAke09iamVjdC5rZXlzKHRoaXMuZGF0YWJhc2UpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YWJhc2VcIiwgdGhpcy5nZXRFbnZpcm9ubWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgdGhlIGlkZW50aWZpZXIuXG4gICAqL1xuICByZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIsIHRlbmFudCA9IHRoaXMuZ2V0Q3VycmVudFRlbmFudCgpKSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVtpZGVudGlmaWVyXVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBkYXRhYmFzZSBpZGVudGlmaWVyIGNvbmZpZ3VyZWQ6ICR7aWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIGlmICh0ZW5hbnQgPT09IHVuZGVmaW5lZCB8fCAhdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcikge1xuICAgICAgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuICAgIH1cblxuICAgIGNvbnN0IG92ZXJyaWRlQ29uZmlndXJhdGlvbiA9IHRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgIGlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuXG4gICAgcmV0dXJuIG1lcmdlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3ZlcnJpZGVDb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpc2FibGVkIGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRGlzYWJsZWQgZGF0YWJhc2UgaWRlbnRpZmllcnMgZnJvbSBlbnYgZmxhZ3MuXG4gICAqL1xuICBnZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVycyA9IG5ldyBTZXQoKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnNSYXcgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRElTQUJMRURfREFUQUJBU0VfSURFTlRJRklFUlNcblxuICAgIGlmIChkaXNhYmxlZElkZW50aWZpZXJzUmF3KSB7XG4gICAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGlzYWJsZWRJZGVudGlmaWVyc1Jhdy5zcGxpdChcIixcIikpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGlkZW50aWZpZXIudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIGRpc2FibGVkSWRlbnRpZmllcnMuYWRkKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHByb2Nlc3MuZW52LlZFTE9DSU9VU19ESVNBQkxFX01TU1FMID09PSBcIjFcIikge1xuICAgICAgZGlzYWJsZWRJZGVudGlmaWVycy5hZGQoXCJtc3NxbFwiKVxuICAgIH1cblxuICAgIHJldHVybiBkaXNhYmxlZElkZW50aWZpZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRhYmFzZSBpZGVudGlmaWVyIGFjdGl2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGRhdGFiYXNlIGlkZW50aWZpZXIgaXMgYWN0aXZlIGluIHRoZSBjdXJyZW50IHRlbmFudCBjb250ZXh0LlxuICAgKi9cbiAgaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllciwgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KCkpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIGRhdGFiYXNlIGlkZW50aWZpZXIgY29uZmlndXJlZDogJHtpZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkgcmV0dXJuIHRydWVcbiAgICBpZiAodGVuYW50ID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX3RlbmFudERhdGFiYXNlUmVzb2x2ZXIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3Qgb3ZlcnJpZGVDb25maWd1cmF0aW9uID0gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgaWRlbnRpZmllcixcbiAgICAgIHRlbmFudFxuICAgIH0pXG5cbiAgICByZXR1cm4gQm9vbGVhbihvdmVycmlkZUNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBkYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyh0aGlzLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IGRpc2FibGVkSWRlbnRpZmllcnMgPSB0aGlzLmdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpXG5cbiAgICByZXR1cm4gaWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiAhZGlzYWJsZWRJZGVudGlmaWVycy5oYXMoaWRlbnRpZmllcikgJiYgdGhpcy5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBIdW1hbi1yZWFkYWJsZSBzZXJ2ZXIgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBhc3luYyBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGxvY2FsU25hcHNob3QgPSB0aGlzLmdldExvY2FsRGVidWdTbmFwc2hvdCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ubG9jYWxTbmFwc2hvdCxcbiAgICAgIGh0dHBTZXJ2ZXI6IGF3YWl0IHRoaXMuX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWwgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gSHVtYW4tcmVhZGFibGUgZGlhZ25vc3RpY3MgZm9yIHRoaXMgcHJvY2VzcyBvbmx5LlxuICAgKi9cbiAgZ2V0TG9jYWxEZWJ1Z1NuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBiYWNrZ3JvdW5kSm9iczogdGhpcy5fZGVidWdCYWNrZ3JvdW5kSm9ic1NuYXBzaG90KCksXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9kZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpLFxuICAgICAgZGF0YWJhc2U6IHRoaXMuX2RlYnVnRGF0YWJhc2VTbmFwc2hvdCgpLFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHNlcnZlcjogdGhpcy5fZGVidWdTZXJ2ZXJTbmFwc2hvdCgpLFxuICAgICAgd2Vic29ja2V0czogdGhpcy5fZGVidWdXZWJzb2NrZXRTbmFwc2hvdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgaHR0cCBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gSFRUUCBzZXJ2ZXIgd29ya2VyIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgYXN5bmMgX2RlYnVnSHR0cFNlcnZlclNuYXBzaG90KCkge1xuICAgIGNvbnN0IGh0dHBTZXJ2ZXIgPSAvKiogQHR5cGUge3tnZXREZWJ1Z1NuYXBzaG90PzogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuX2h0dHBTZXJ2ZXJJbnN0YW5jZSlcblxuICAgIGlmICghaHR0cFNlcnZlcj8uZ2V0RGVidWdTbmFwc2hvdCkge1xuICAgICAgcmV0dXJuIHtjb25maWd1cmVkOiBCb29sZWFuKHRoaXMuaHR0cFNlcnZlciksIGFjdGl2ZTogZmFsc2V9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IGh0dHBTZXJ2ZXIuZ2V0RGVidWdTbmFwc2hvdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzZXJ2ZXIgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2VydmVyIHJ1bnRpbWUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdTZXJ2ZXJTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBub2RlUHJvY2VzcyA9IHR5cGVvZiBwcm9jZXNzID09PSBcInVuZGVmaW5lZFwiID8gdW5kZWZpbmVkIDogcHJvY2Vzc1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmdldEVudmlyb25tZW50KCksXG4gICAgICBtZW1vcnlVc2FnZTogbm9kZVByb2Nlc3MgPyBub2RlUHJvY2Vzcy5tZW1vcnlVc2FnZSgpIDogdW5kZWZpbmVkLFxuICAgICAgbm9kZVZlcnNpb246IG5vZGVQcm9jZXNzPy52ZXJzaW9ucz8ubm9kZSxcbiAgICAgIHBpZDogbm9kZVByb2Nlc3M/LnBpZCxcbiAgICAgIHBsYXRmb3JtOiBub2RlUHJvY2Vzcz8ucGxhdGZvcm0sXG4gICAgICB1cHRpbWVTZWNvbmRzOiBub2RlUHJvY2VzcyA/IG5vZGVQcm9jZXNzLnVwdGltZSgpIDogdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgY29uZmlndXJhdGlvbiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb25maWd1cmF0aW9uIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnQ29uZmlndXJhdGlvblNuYXBzaG90KCkge1xuICAgIHJldHVybiB7XG4gICAgICBhcGlNYW5pZmVzdDogdGhpcy5fYXBpTWFuaWZlc3RFbmFibGVkKCkgPyB7ZW5hYmxlZDogdHJ1ZSwgcGF0aDogdGhpcy5fYXBpTWFuaWZlc3QucGF0aCwgdG9rZW5Db25maWd1cmVkOiBCb29sZWFuKHRoaXMuX2FwaU1hbmlmZXN0LnRva2VuKX0gOiB7ZW5hYmxlZDogZmFsc2V9LFxuICAgICAgYXV0b2xvYWQ6IHRoaXMuZ2V0QXV0b2xvYWQoKSxcbiAgICAgIGRlYnVnOiB0aGlzLmRlYnVnID09PSB0cnVlLFxuICAgICAgZGVidWdFbmRwb2ludDogdGhpcy5fZGVidWdFbmRwb2ludFNuYXBzaG90KCksXG4gICAgICBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IHRoaXMuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCksXG4gICAgICBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50czogdGhpcy5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpLFxuICAgICAgaW5pdGlhbGl6ZWQ6IHRoaXMuX2lzSW5pdGlhbGl6ZWQsXG4gICAgICBsb2dnaW5nOiB7XG4gICAgICAgIGRlYnVnTG93TGV2ZWw6IHRoaXMuX2xvZ2dpbmc/LmRlYnVnTG93TGV2ZWwgPT09IHRydWUsXG4gICAgICAgIG91dHB1dHM6IHRoaXMuX2xvZ2dpbmcgPyBPYmplY3Qua2V5cyh0aGlzLl9sb2dnaW5nKSA6IFtdXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgYmFja2dyb3VuZCBqb2JzIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEJhY2tncm91bmQgam9iIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnQmFja2dyb3VuZEpvYnNTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29uZmlndXJlZDogQm9vbGVhbih0aGlzLl9iYWNrZ3JvdW5kSm9icyksXG4gICAgICBzY2hlZHVsZWRDb25maWd1cmVkOiBCb29sZWFuKHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGRhdGFiYXNlIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERhdGFiYXNlIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnRGF0YWJhc2VTbmFwc2hvdCgpIHtcbiAgICAvKipcbiAgICAgKiBEYXRhYmFzZSBwb29scy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuRGF0YWJhc2VQb29sRGVidWdTbmFwc2hvdD59ICovXG4gICAgY29uc3QgZGF0YWJhc2VQb29scyA9IHt9XG4gICAgY29uc3QgYWN0aXZlSWRlbnRpZmllcnMgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGFjdGl2ZUlkZW50aWZpZXJzKSB7XG4gICAgICBkYXRhYmFzZVBvb2xzW2lkZW50aWZpZXJdID0gdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuZ2V0RGVidWdTbmFwc2hvdCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGl2ZUlkZW50aWZpZXJzLFxuICAgICAgZGlzYWJsZWRJZGVudGlmaWVyczogQXJyYXkuZnJvbSh0aGlzLmdldERpc2FibGVkRGF0YWJhc2VJZGVudGlmaWVycygpKSxcbiAgICAgIGluaXRpYWxpemVkUG9vbHM6IE9iamVjdC5rZXlzKHRoaXMuZGF0YWJhc2VQb29scyksXG4gICAgICBwb29sczogZGF0YWJhc2VQb29sc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHdlYnNvY2tldCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXZWJTb2NrZXQgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdXZWJzb2NrZXRTbmFwc2hvdCgpIHtcbiAgICAvKipcbiAgICAgKiBTZXNzaW9uIGJ1Y2tldHMuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtjb3VudDogbnVtYmVyLCBkZXRhaWxzOiB7Y2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXIsIGNoYW5uZWxTdWJzY3JpcHRpb25zOiB7Y2hhbm5lbFR5cGU6IHN0cmluZywgY291bnQ6IG51bWJlciwgbW9kZWw6IHN0cmluZyB8IG51bGx9W10sIGNvbm5lY3Rpb25Db3VudDogbnVtYmVyLCBwYXVzZWQ6IGJvb2xlYW4sIHN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXJ9fT59ICovXG4gICAgY29uc3Qgc2Vzc2lvbkJ1Y2tldHMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBTZXNzaW9uIGRldGFpbHMuXG4gICAgICogQHR5cGUge3tjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IG51bWJlciwgY2hhbm5lbFN1YnNjcmlwdGlvbnM6IHtjaGFubmVsVHlwZTogc3RyaW5nLCBjb3VudDogbnVtYmVyLCBtb2RlbDogc3RyaW5nIHwgbnVsbH1bXSwgY29ubmVjdGlvbkNvdW50OiBudW1iZXIsIHBhdXNlZDogYm9vbGVhbiwgcXVldWVkTWVzc2FnZUNvdW50OiBudW1iZXIsIHN1YnNjcmlwdGlvbkNvdW50OiBudW1iZXJ9W119ICovXG4gICAgY29uc3Qgc2Vzc2lvbkRldGFpbHMgPSBbXVxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBBcnJheS5mcm9tKHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmVudHJpZXMoKSkubWFwKChbY2hhbm5lbCwgY2hhbm5lbFN1YnNjcmlwdGlvbnNdKSA9PiB7XG4gICAgICAvKipcbiAgICAgICAqIERldGFpbHMgYnVja2V0cy5cbiAgICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y291bnQ6IG51bWJlciwgZGV0YWlsczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59ICovXG4gICAgICBjb25zdCBkZXRhaWxzQnVja2V0cyA9IG5ldyBNYXAoKVxuXG4gICAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBjaGFubmVsU3Vic2NyaXB0aW9ucykge1xuICAgICAgICBjb25zdCBkZXRhaWxzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjYW5vbmljYWxEZWJ1Z1NuYXBzaG90VmFsdWUoc3Vic2NyaXB0aW9uLmRlYnVnU25hcHNob3QoKSkpXG4gICAgICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KGRldGFpbHMpXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nQnVja2V0ID0gZGV0YWlsc0J1Y2tldHMuZ2V0KGtleSlcblxuICAgICAgICBpZiAoZXhpc3RpbmdCdWNrZXQpIHtcbiAgICAgICAgICBleGlzdGluZ0J1Y2tldC5jb3VudCArPSAxXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZGV0YWlsc0J1Y2tldHMuc2V0KGtleSwge2NvdW50OiAxLCBkZXRhaWxzfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBjaGFubmVsLFxuICAgICAgICBjb3VudDogY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgICAgZGV0YWlsczogQXJyYXkuZnJvbShkZXRhaWxzQnVja2V0cy52YWx1ZXMoKSkuc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGZvciAoY29uc3Qgc2Vzc2lvbiBvZiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9ucykge1xuICAgICAgLyoqXG4gICAgICAgKiBDaGFubmVsIHN1YnNjcmlwdGlvbiBidWNrZXRzLlxuICAgICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtjaGFubmVsVHlwZTogc3RyaW5nLCBjb3VudDogbnVtYmVyLCBtb2RlbDogc3RyaW5nIHwgbnVsbH0+fSAqL1xuICAgICAgY29uc3QgY2hhbm5lbFN1YnNjcmlwdGlvbkJ1Y2tldHMgPSBuZXcgTWFwKClcblxuICAgICAgZm9yIChjb25zdCB7Y2hhbm5lbFR5cGUsIHN1YnNjcmlwdGlvbn0gb2Ygc2Vzc2lvbi5fY2hhbm5lbFN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc3Vic2NyaXB0aW9uLmRlYnVnU25hcHNob3QoKSlcbiAgICAgICAgY29uc3QgbW9kZWwgPSB0eXBlb2YgZGV0YWlscy5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IGRldGFpbHMubW9kZWwgOiBudWxsXG4gICAgICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KHtjaGFubmVsVHlwZSwgbW9kZWx9KVxuICAgICAgICBjb25zdCBleGlzdGluZ0J1Y2tldCA9IGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLmdldChrZXkpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgICAgZXhpc3RpbmdCdWNrZXQuY291bnQgKz0gMVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25CdWNrZXRzLnNldChrZXksIHtjaGFubmVsVHlwZSwgY291bnQ6IDEsIG1vZGVsfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjaGFubmVsU3Vic2NyaXB0aW9ucyA9IEFycmF5LmZyb20oY2hhbm5lbFN1YnNjcmlwdGlvbkJ1Y2tldHMudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50KVxuICAgICAgY29uc3Qgc25hcHNob3QgPSB7XG4gICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25Db3VudDogc2Vzc2lvbi5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbnMsXG4gICAgICAgIGNvbm5lY3Rpb25Db3VudDogc2Vzc2lvbi5fY29ubmVjdGlvbnMuc2l6ZSxcbiAgICAgICAgcGF1c2VkOiBzZXNzaW9uLl9wYXVzZWQsXG4gICAgICAgIHF1ZXVlZE1lc3NhZ2VDb3VudDogc2Vzc2lvbi5fb3V0Ym91bmRRdWV1ZS5sZW5ndGgsXG4gICAgICAgIHN1YnNjcmlwdGlvbkNvdW50OiBzZXNzaW9uLnN1YnNjcmlwdGlvbnMuc2l6ZVxuICAgICAgfVxuICAgICAgY29uc3QgYnVja2V0S2V5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCxcbiAgICAgICAgY2hhbm5lbFN1YnNjcmlwdGlvbnM6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25zLFxuICAgICAgICBjb25uZWN0aW9uQ291bnQ6IHNuYXBzaG90LmNvbm5lY3Rpb25Db3VudCxcbiAgICAgICAgcGF1c2VkOiBzbmFwc2hvdC5wYXVzZWQsXG4gICAgICAgIHN1YnNjcmlwdGlvbkNvdW50OiBzbmFwc2hvdC5zdWJzY3JpcHRpb25Db3VudFxuICAgICAgfSlcbiAgICAgIGNvbnN0IGV4aXN0aW5nQnVja2V0ID0gc2Vzc2lvbkJ1Y2tldHMuZ2V0KGJ1Y2tldEtleSlcblxuICAgICAgaWYgKGV4aXN0aW5nQnVja2V0KSB7XG4gICAgICAgIGV4aXN0aW5nQnVja2V0LmNvdW50ICs9IDFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlc3Npb25CdWNrZXRzLnNldChidWNrZXRLZXksIHtcbiAgICAgICAgICBjb3VudDogMSxcbiAgICAgICAgICBkZXRhaWxzOiB7XG4gICAgICAgICAgICBjaGFubmVsU3Vic2NyaXB0aW9uQ291bnQ6IHNuYXBzaG90LmNoYW5uZWxTdWJzY3JpcHRpb25Db3VudCxcbiAgICAgICAgICAgIGNoYW5uZWxTdWJzY3JpcHRpb25zOiBzbmFwc2hvdC5jaGFubmVsU3Vic2NyaXB0aW9ucyxcbiAgICAgICAgICAgIGNvbm5lY3Rpb25Db3VudDogc25hcHNob3QuY29ubmVjdGlvbkNvdW50LFxuICAgICAgICAgICAgcGF1c2VkOiBzbmFwc2hvdC5wYXVzZWQsXG4gICAgICAgICAgICBzdWJzY3JpcHRpb25Db3VudDogc25hcHNob3Quc3Vic2NyaXB0aW9uQ291bnRcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgICBzZXNzaW9uRGV0YWlscy5wdXNoKHNuYXBzaG90KVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBwYXVzZWRTZXNzaW9uczogdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuc2l6ZSxcbiAgICAgIHJlZ2lzdGVyZWRDaGFubmVsczogQXJyYXkuZnJvbSh0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5rZXlzKCkpLFxuICAgICAgcmVnaXN0ZXJlZENvbm5lY3Rpb25zOiBBcnJheS5mcm9tKHRoaXMuX3dlYnNvY2tldENvbm5lY3Rpb25DbGFzc2VzLmtleXMoKSksXG4gICAgICBzZXNzaW9uQnVja2V0czogQXJyYXkuZnJvbShzZXNzaW9uQnVja2V0cy52YWx1ZXMoKSkuc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQpLFxuICAgICAgc2Vzc2lvbkNvdW50OiB0aGlzLl93ZWJzb2NrZXRTZXNzaW9ucy5zaXplLFxuICAgICAgc2Vzc2lvbnM6IHNlc3Npb25EZXRhaWxzLnNvcnQoKGEsIGIpID0+IGIuY2hhbm5lbFN1YnNjcmlwdGlvbkNvdW50IC0gYS5jaGFubmVsU3Vic2NyaXB0aW9uQ291bnQpLFxuICAgICAgc3Vic2NyaXB0aW9uR3JvdXBzOiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5zaXplLFxuICAgICAgc3Vic2NyaXB0aW9uc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBkYXRhYmFzZSBwb29sLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikge1xuICAgIGlmICghdGhpcy5pc0RhdGFiYXNlUG9vbEluaXRpYWxpemVkKGlkZW50aWZpZXIpKSB7XG4gICAgICB0aGlzLmluaXRpYWxpemVEYXRhYmFzZVBvb2woaWRlbnRpZmllcilcbiAgICB9XG5cbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFiYXNlUG9vbHNcIiwgaWRlbnRpZmllcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBmcmFtZXdvcmstb3duZWQgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZX0gLSBMaWZlY3ljbGUgb3duZXIuXG4gICAqL1xuICBnZXRGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSgpIHsgcmV0dXJuIHRoaXMuX2Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlIH1cblxuICAvKipcbiAgICogUmV0dXJucyBzYWZlIGZyb250ZW5kIHRlbmFudCBTUUxpdGUgZGlhZ25vc3RpY3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlW1wiaW5zcGVjdEFsbFwiXT59IC0gTGlmZWN5Y2xlIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgaW5zcGVjdEZyb250ZW5kVGVuYW50U3FsaXRlSGFuZGxlcygpIHsgcmV0dXJuIHRoaXMuX2Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlLmluc3BlY3RBbGwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSlcbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihpZGVudGlmaWVyKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgc2NoZW1hIG1ldGFkYXRhIGNhY2hlZCBieSBldmVyeSBpbml0aWFsaXplZCBwb29sIHRoYXQgdGFyZ2V0cyB0aGVcbiAgICogc2FtZSBwaHlzaWNhbCBkYXRhYmFzZSAobWF0Y2hlZCBieSBjb25uZWN0aW9uIHJldXNlIGtleSkuIFNlcGFyYXRlIHBvb2xzIHRoYXRcbiAgICogcG9pbnQgYXQgb25lIGRhdGFiYXNlIGtlZXAgaW5kZXBlbmRlbnQgc2NoZW1hIGNhY2hlcywgc28gRERMIHJ1biB0aHJvdWdoIG9uZVxuICAgKiBwb29sIHdvdWxkIG90aGVyd2lzZSBsZWF2ZSB0aGUgb3RoZXJzIHJlcG9ydGluZyBzdGFsZSB0YWJsZXMvY29sdW1ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gQ29ubmVjdGlvbiByZXVzZSBrZXkgaWRlbnRpZnlpbmcgdGhlIHNoYXJlZCBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2xlYXJTY2hlbWFDYWNoZXNGb3JSZXVzZUtleShyZXVzZUtleSkge1xuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleSgpID09PSByZXVzZUtleSkge1xuICAgICAgICBwb29sLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbnZhbGlkYXRlcyByZWNvcmQgbWV0YWRhdGEgb3duZWQgYnkgb25lIGNsb3NlZC9kZWxldGVkIHBoeXNpY2FsIHRlbmFudFxuICAgKiBkYXRhYmFzZSB3aGlsZSBwcmVzZXJ2aW5nIGV2ZXJ5IG90aGVyIHRlbmFudCBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIExvZ2ljYWwgaWRlbnRpZmllciBwbHVzIHBvb2wgcmV1c2Uga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyUmVjb3JkTWV0YWRhdGFGb3JEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLm1vZGVsQ2xhc3NlcykpIHtcbiAgICAgIG1vZGVsQ2xhc3MuY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlc0ZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgcG9vbCB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZGF0YWJhc2UgcG9vbCB0eXBlLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VQb29sVHlwZShpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBjb25zdCBwb29sVHlwZUNsYXNzID0gZGlnZyh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcihpZGVudGlmaWVyKSwgXCJwb29sVHlwZVwiKVxuXG4gICAgaWYgKCFwb29sVHlwZUNsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBwb29sVHlwZSBnaXZlbiBpbiBkYXRhYmFzZSBjb25maWd1cmF0aW9uXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucmVzb2x2ZVRlc3RTaGFyZWRUcmFuc2FjdGlvblBvb2xUeXBlKHtcbiAgICAgIGNvbmZpZ3VyZWRQb29sVHlwZTogcG9vbFR5cGVDbGFzcyxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogaWRlbnRpZmllclxuICAgIH0pXG4gIH1cblxuICBnZXREYXRhYmFzZVR5cGUoaWRlbnRpZmllciA9IFwiZGVmYXVsdFwiKSB7XG4gICAgY29uc3QgZGF0YWJhc2VUeXBlID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoaWRlbnRpZmllcikudHlwZVxuXG4gICAgaWYgKCFkYXRhYmFzZVR5cGUpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIHR5cGUgZ2l2ZW4gaW4gZGF0YWJhc2UgY29uZmlndXJhdGlvblwiKVxuXG4gICAgcmV0dXJuIGRhdGFiYXNlVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGlyZWN0b3J5LlxuICAgKi9cbiAgZ2V0RGlyZWN0b3J5KCkge1xuICAgIGNvbnN0IGRpcmVjdG9yeSA9IHRoaXMuZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKVxuXG4gICAgaWYgKCFkaXJlY3RvcnkpIHRocm93IG5ldyBFcnJvcihcIk5vIGRpcmVjdG9yeSBjb25maWd1cmVkIGFuZCBwcm9jZXNzLmN3ZCBpcyB1bmF2YWlsYWJsZVwiKVxuXG4gICAgcmV0dXJuIGRpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRpcmVjdG9yeSBpZiBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGRpcmVjdG9yeSB3aGVuIHRoZSBydW50aW1lIGNhbiByZXNvbHZlIG9uZS5cbiAgICovXG4gIGdldERpcmVjdG9yeUlmQXZhaWxhYmxlKCkge1xuICAgIGlmICghdGhpcy5fZGlyZWN0b3J5KSB7XG4gICAgICB0aGlzLl9kaXJlY3RvcnkgPSBjdXJyZW50V29ya2luZ0RpcmVjdG9yeSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RpcmVjdG9yeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJhY2tlbmQgcHJvamVjdHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119IC0gQmFja2VuZCBwcm9qZWN0cy5cbiAgICovXG4gIGdldEJhY2tlbmRQcm9qZWN0cygpIHsgcmV0dXJuIHRoaXMuX2JhY2tlbmRQcm9qZWN0cyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBhY2thZ2VzLlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzUGFja2FnZVtdfSAtIFJlZ2lzdGVyZWQgVmVsb2Npb3VzIHBhY2thZ2VzLlxuICAgKi9cbiAgZ2V0UGFja2FnZXMoKSB7IHJldHVybiB0aGlzLl9wYWNrYWdlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFiaWxpdHkgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICovXG4gIGdldEFiaWxpdHlSZXNvdXJjZXMoKSB7IHJldHVybiB0aGlzLl9hYmlsaXR5UmVzb3VyY2VzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYWJpbGl0eSByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSByZXNvdXJjZXMgLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEFiaWxpdHlSZXNvdXJjZXMocmVzb3VyY2VzKSB7IHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSByZXNvdXJjZXMgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgcmVzb3VyY2UgY2xhc3NlcyBkaXNjb3ZlcmVkIGZyb20gdGhlIGFwcCBhbmQgZXZlcnkgcmVnaXN0ZXJlZCBwYWNrYWdlXG4gICAqIGludG8gdGhlIGFiaWxpdHktcmVzb3VyY2VzIGxpc3QuIGBhdXRvRGlzY292ZXJSZXNvdXJjZXNgIHBvcHVsYXRlcyBlYWNoIGJhY2tlbmRcbiAgICogcHJvamVjdCdzIGBmcm9udGVuZE1vZGVsc2AgKGluY2x1ZGluZyBwYWNrYWdlIHByb2plY3RzKSwgc28gdGhpcyBtYWtlcyBhXG4gICAqIHBhY2thZ2UtY29udHJpYnV0ZWQgbW9kZWwncyBhYmlsaXRpZXMgcmVhY2ggc3Vic2NyaXB0aW9uIGFuZCBwZXItcmVjb3JkXG4gICAqIGF1dGhvcml6YXRpb24gYXV0b21hdGljYWxseSDigJQgY29uc3VtaW5nIGFwcHMgZG8gbm90IGhhdmUgdG8gaGFuZC1yZWdpc3RlclxuICAgKiBwYWNrYWdlIHJlc291cmNlcy4gQWxyZWFkeS1wcmVzZW50IGNsYXNzZXMgKGUuZy4gYW4gYXBwJ3MgZXhwbGljaXRseS1zZXRcbiAgICogcmVzb3VyY2VzKSBhcmUgbGVmdCB1bnRvdWNoZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9tZXJnZURpc2NvdmVyZWRBYmlsaXR5UmVzb3VyY2VzKCkge1xuICAgIGNvbnN0IG1lcmdlZCA9IFsuLi50aGlzLl9hYmlsaXR5UmVzb3VyY2VzXVxuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0KG1lcmdlZClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgdGhpcy5fYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBpZiAoIWJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3QgUmVzb3VyY2VDbGFzcyBvZiBiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzKSB7XG4gICAgICAgIGlmIChzZWVuLmhhcyhSZXNvdXJjZUNsYXNzKSkgY29udGludWVcblxuICAgICAgICBzZWVuLmFkZChSZXNvdXJjZUNsYXNzKVxuICAgICAgICBtZXJnZWQucHVzaChSZXNvdXJjZUNsYXNzKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2FiaWxpdHlSZXNvdXJjZXMgPSBtZXJnZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhYmlsaXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gQWJpbGl0eSByZXNvbHZlci5cbiAgICovXG4gIGdldEFiaWxpdHlSZXNvbHZlcigpIHsgcmV0dXJuIHRoaXMuX2FiaWxpdHlSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnRSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGVuYW50IHJlc29sdmVyLlxuICAgKi9cbiAgZ2V0VGVuYW50UmVzb2x2ZXIoKSB7IHJldHVybiB0aGlzLl90ZW5hbnRSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gLSBUZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVJlc29sdmVyKCkgeyByZXR1cm4gdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVuZm9yY2UgdGVuYW50IGRhdGFiYXNlIHNjb3Blcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHJlcXVpcmUgYSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpIHsgcmV0dXJuIHRoaXMuX2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGU+fSAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXJzLlxuICAgKi9cbiAgZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcnMoKSB7IHJldHVybiB0aGlzLl90ZW5hbnREYXRhYmFzZVByb3ZpZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBwcm92aWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSAtIFRlbmFudCBkYXRhYmFzZSBsaWZlY3ljbGUgcHJvdmlkZXIuXG4gICAqL1xuICBnZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVyKGlkZW50aWZpZXIpIHtcbiAgICBjb25zdCBwcm92aWRlciA9IHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzW2lkZW50aWZpZXJdXG5cbiAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBjb25maWd1cmVkIGZvciBkYXRhYmFzZSBpZGVudGlmaWVyOiAke2lkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvdmlkZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRzQ29uZmlndXJhdGlvbn0gLSBBdHRhY2htZW50cyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0QXR0YWNobWVudHNDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fYXR0YWNobWVudHMgfHwge30gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Sb3V0ZVJlc29sdmVySG9va1R5cGVbXX0gLSBSb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICovXG4gIGdldFJvdXRlUmVzb2x2ZXJIb29rcygpIHsgcmV0dXJuIHRoaXMuX3JvdXRlUmVzb2x2ZXJIb29rcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHJvdXRlIHJlc29sdmVyIGhvb2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJvdXRlUmVzb2x2ZXJIb29rVHlwZX0gaG9vayAtIFJvdXRlIHJlc29sdmVyIGhvb2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFkZFJvdXRlUmVzb2x2ZXJIb29rKGhvb2spIHtcbiAgICB0aGlzLl9yb3V0ZVJlc29sdmVySG9va3MucHVzaChob29rKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGFiaWxpdHkgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gQWJpbGl0eSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QWJpbGl0eVJlc29sdmVyKHJlc29sdmVyKSB7IHRoaXMuX2FiaWxpdHlSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnRSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IHJlc29sdmVyIC0gVGVuYW50IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUZW5hbnRSZXNvbHZlcihyZXNvbHZlcikgeyB0aGlzLl90ZW5hbnRSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVJlc29sdmVyVHlwZSB8IHVuZGVmaW5lZH0gcmVzb2x2ZXIgLSBUZW5hbnQgZGF0YWJhc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRlbmFudERhdGFiYXNlUmVzb2x2ZXIocmVzb2x2ZXIpIHsgdGhpcy5fdGVuYW50RGF0YWJhc2VSZXNvbHZlciA9IHJlc29sdmVyIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZW5mb3JjZSB0ZW5hbnQgZGF0YWJhc2Ugc2NvcGVzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ZhbHVlIC0gV2hldGhlciB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHJlcXVpcmUgYSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKG5ld1ZhbHVlKSB7IHRoaXMuX2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcyA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVycy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGU+fSBwcm92aWRlcnMgLSBUZW5hbnQgZGF0YWJhc2UgbGlmZWN5Y2xlIHByb3ZpZGVycy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcnMocHJvdmlkZXJzKSB7IHRoaXMuX3RlbmFudERhdGFiYXNlUHJvdmlkZXJzID0gcHJvdmlkZXJzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGVudmlyb25tZW50LlxuICAgKi9cbiAgZ2V0RW52aXJvbm1lbnQoKSB7IHJldHVybiBkaWdnKHRoaXMsIFwiX2Vudmlyb25tZW50XCIpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVxdWVzdCB0aW1lb3V0IG1zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFJlcXVlc3QgdGltZW91dCBpbiBzZWNvbmRzLlxuICAgKi9cbiAgZ2V0UmVxdWVzdFRpbWVvdXRNcygpIHtcbiAgICBjb25zdCBlbnZUaW1lb3V0ID0gdGhpcy5fcGFyc2VSZXF1ZXN0VGltZW91dFNlY29uZHMocHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1JFUVVFU1RfVElNRU9VVF9NUylcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVvZiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gdGhpcy5fcmVxdWVzdFRpbWVvdXRNcygpXG4gICAgICA6IHRoaXMuX3JlcXVlc3RUaW1lb3V0TXNcblxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICh0eXBlb2YgZW52VGltZW91dCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52VGltZW91dCkpIHJldHVybiBlbnZUaW1lb3V0XG5cbiAgICByZXR1cm4gNjBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIHJlcXVlc3QgdGltZW91dCBzZWNvbmRzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gcmF3VmFsdWUgLSBFbnYgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gVGltZW91dCBpbiBzZWNvbmRzLlxuICAgKi9cbiAgX3BhcnNlUmVxdWVzdFRpbWVvdXRTZWNvbmRzKHJhd1ZhbHVlKSB7XG4gICAgaWYgKHJhd1ZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IHRyaW1tZWQgPSByYXdWYWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKVxuXG4gICAgaWYgKCF0cmltbWVkKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBtYXRjaCA9IHRyaW1tZWQubWF0Y2goL14oXFxkKyg/OlxcLlxcZCspPykobXN8cyk/JC8pXG5cbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBudW1lcmljID0gTnVtYmVyKG1hdGNoWzFdKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobnVtZXJpYykpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IHVuaXQgPSBtYXRjaFsyXVxuXG4gICAgaWYgKHVuaXQgPT09IFwibXNcIikgcmV0dXJuIG51bWVyaWMgLyAxMDAwXG4gICAgaWYgKHVuaXQgPT09IFwic1wiKSByZXR1cm4gbnVtZXJpY1xuXG4gICAgaWYgKHRyaW1tZWQuaW5jbHVkZXMoXCIuXCIpKSByZXR1cm4gbnVtZXJpY1xuICAgIGlmIChudW1lcmljID49IDEwMDApIHJldHVybiBudW1lcmljIC8gMTAwMFxuXG4gICAgcmV0dXJuIG51bWVyaWNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBlbnZpcm9ubWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld0Vudmlyb25tZW50IC0gTmV3IGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRFbnZpcm9ubWVudChuZXdFbnZpcm9ubWVudCkgeyB0aGlzLl9lbnZpcm9ubWVudCA9IG5ld0Vudmlyb25tZW50IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9nZ2luZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZGVmYXVsdENvbnNvbGVdIC0gV2hldGhlciBkZWZhdWx0IGNvbnNvbGUuXG4gICAqIEByZXR1cm5zIHtSZXF1aXJlZDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJjb25zb2xlXCIgfCBcImZpbGVcIiB8IFwibGV2ZWxzXCI+PiAmIFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcImRpcmVjdG9yeVwiIHwgXCJmaWxlUGF0aFwiPiAmIFBhcnRpYWw8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwib3V0cHV0c1wiIHwgXCJsb2dnZXJzXCI+Pn0gLSBUaGUgbG9nZ2luZyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0TG9nZ2luZ0NvbmZpZ3VyYXRpb24oe2RlZmF1bHRDb25zb2xlfSA9IHt9KSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSB0aGlzLmdldEVudmlyb25tZW50KClcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gdGhpcy5fbG9nZ2luZz8uZGlyZWN0b3J5IHx8IGVudmlyb25tZW50SGFuZGxlci5nZXREZWZhdWx0TG9nRGlyZWN0b3J5KHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMuX2xvZ2dpbmc/LmZpbGVQYXRoIHx8IGVudmlyb25tZW50SGFuZGxlci5nZXRMb2dGaWxlUGF0aCh7Y29uZmlndXJhdGlvbjogdGhpcywgZGlyZWN0b3J5LCBlbnZpcm9ubWVudH0pXG4gICAgY29uc3QgY29uc29sZU92ZXJyaWRlID0gdGhpcy5fbG9nZ2luZz8uY29uc29sZVxuICAgIGNvbnN0IGhhc0xvZ2dpbmdDb25maWcgPSBCb29sZWFuKHRoaXMuX2xvZ2dpbmcpXG4gICAgY29uc3QgZmlsZUxvZ2dpbmcgPSBoYXNMb2dnaW5nQ29uZmlnID8gKHRoaXMuX2xvZ2dpbmc/LmZpbGUgPz8gQm9vbGVhbihmaWxlUGF0aCkpIDogZmFsc2VcbiAgICBjb25zdCBjb25maWd1cmVkTGV2ZWxzID0gdGhpcy5fbG9nZ2luZz8ubGV2ZWxzXG4gICAgY29uc3QgaW5jbHVkZUxvd0xldmVsRGVidWcgPSB0aGlzLl9sb2dnaW5nPy5kZWJ1Z0xvd0xldmVsID09PSB0cnVlXG4gICAgY29uc3QgbG9nZ2VycyA9IHRoaXMuX2xvZ2dpbmc/LmxvZ2dlcnNcblxuICAgIGNvbnN0IGNvbnNvbGVEZWZhdWx0ID0gZGVmYXVsdENvbnNvbGUgIT09IHVuZGVmaW5lZCA/IGRlZmF1bHRDb25zb2xlIDogdHJ1ZVxuICAgIGNvbnN0IGNvbnNvbGVMb2dnaW5nID0gY29uc29sZU92ZXJyaWRlICE9PSB1bmRlZmluZWQgPyBjb25zb2xlT3ZlcnJpZGUgOiBjb25zb2xlRGVmYXVsdFxuXG4gICAgLyoqXG4gICAgICogRGVmYXVsdCBsZXZlbHMuXG4gICAgICogQHR5cGUge0FycmF5PFwiZGVidWctbG93LWxldmVsXCIgfCBcImRlYnVnXCIgfCBcImluZm9cIiB8IFwid2FyblwiIHwgXCJlcnJvclwiPn0gKi9cbiAgICBjb25zdCBkZWZhdWx0TGV2ZWxzID0gW1wiaW5mb1wiLCBcIndhcm5cIiwgXCJlcnJvclwiXVxuXG4gICAgaWYgKGluY2x1ZGVMb3dMZXZlbERlYnVnKSBkZWZhdWx0TGV2ZWxzLnVuc2hpZnQoXCJkZWJ1Zy1sb3ctbGV2ZWxcIilcblxuICAgIGNvbnN0IGxldmVscyA9IGNvbmZpZ3VyZWRMZXZlbHMgfHwgZGVmYXVsdExldmVsc1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnNvbGU6IGNvbnNvbGVMb2dnaW5nLFxuICAgICAgZGlyZWN0b3J5LFxuICAgICAgZmlsZTogZmlsZUxvZ2dpbmcgPz8gZmFsc2UsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGxvZ2dlcnMsXG4gICAgICBsZXZlbHMsXG4gICAgICBvdXRwdXRzOiB0aGlzLl9sb2dnaW5nPy5vdXRwdXRzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGNvbmZpZ3VyYXRpb24tb3duZWQgc3RydWN0dXJlZCBsb2dnaW5nIHJlZGFjdG9yLlxuICAgKiBAcmV0dXJucyB7TG9nUmVkYWN0b3J9IC0gU3RydWN0dXJlZCBsb2dnaW5nIHJlZGFjdG9yLlxuICAgKi9cbiAgZ2V0TG9nUmVkYWN0b3IoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2xvZ1JlZGFjdG9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcXVlcnkgbG9nZ2luZyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGRhdGFiYXNlIHF1ZXJ5IGxvZ2dpbmcgaXMgZW5hYmxlZC5cbiAgICovXG4gIGdldFF1ZXJ5TG9nZ2luZ0VuYWJsZWQoKSB7XG4gICAgaWYgKHRoaXMuX2xvZ2dpbmc/LnF1ZXJ5TG9nZ2luZyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fbG9nZ2luZy5xdWVyeUxvZ2dpbmdcblxuICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50KCkgIT09IFwidGVzdFwiXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZ2VuZXJhdGlvbiBsaWZlY3ljbGUgdmFsdWVzIGZyb20gdGhlaXIgcmF3IGNvbmZpZywgZW52aXJvbm1lbnQsXG4gICAqIGFuZCBBUEkgc291cmNlcyBiZWZvcmUgYXBwbHlpbmcgZGVmYXVsdHMuIERlcml2ZWQgZGVmYXVsdHMgYXJlIGRlbGliZXJhdGVseVxuICAgKiBhYnNlbnQgZnJvbSB0aGUgc291cmNlIGxpc3QsIHNvIGFuIEFQSSByZWNvdmVyeSBzdGF0ZSBjYW4gb3ZlcnJpZGUgYW5cbiAgICogSUQtb25seSBjb25maWd1cmF0aW9uIHdpdGhvdXQgY3JlYXRpbmcgYSBmYWxzZSBjb25mbGljdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIEV4cGxpY2l0IEFQSSB2YWx1ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGV9IFthcmdzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGVdIC0gRXhwbGljaXQgYm9vdCBzdGF0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmxpZmVjeWNsZVNvY2tldFBhdGhdIC0gRXhwbGljaXQgbGlmZWN5Y2xlIHNvY2tldCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc291cmNlTmFtZV0gLSBIdW1hbi1yZWFkYWJsZSBBUEkgb3duZXIuXG4gICAqIEByZXR1cm5zIHt7Z2VuZXJhdGlvbklkOiBzdHJpbmcgfCB1bmRlZmluZWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGltcG9ydChcIi4vYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZSB8IFwiYWN0aXZlXCIsIGxpZmVjeWNsZVNvY2tldFBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZH19IC0gUmVzb2x2ZWQgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICByZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtnZW5lcmF0aW9uSWQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGg6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aCwgc291cmNlTmFtZSA9IFwiYmFja2dyb3VuZCBqb2JzIEFQSVwifSA9IHt9KSB7XG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuX2JhY2tncm91bmRKb2JzIHx8IHt9XG4gICAgY29uc3QgZ2VuZXJhdGlvbkVudmlyb25tZW50ID0gZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYgfHwge31cbiAgICBjb25zdCBnZW5lcmF0aW9uSWQgPSByZXNvbHZlR2VuZXJhdGlvbklkKFtcbiAgICAgIHtuYW1lOiBcImJhY2tncm91bmRKb2JzLmdlbmVyYXRpb25JZFwiLCBwcmVzZW50OiBPYmplY3QuaGFzT3duKGNvbmZpZ3VyZWQsIFwiZ2VuZXJhdGlvbklkXCIpICYmIGNvbmZpZ3VyZWQuZ2VuZXJhdGlvbklkICE9PSB1bmRlZmluZWQsIHZhbHVlOiBjb25maWd1cmVkLmdlbmVyYXRpb25JZH0sXG4gICAgICB7bmFtZTogXCJWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSURcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihnZW5lcmF0aW9uRW52aXJvbm1lbnQsIFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEXCIpLCB2YWx1ZTogZ2VuZXJhdGlvbkVudmlyb25tZW50LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRH0sXG4gICAgICB7bmFtZTogYCR7c291cmNlTmFtZX0gZ2VuZXJhdGlvbklkYCwgcHJlc2VudDogZXhwbGljaXRHZW5lcmF0aW9uSWQgIT09IHVuZGVmaW5lZCwgdmFsdWU6IGV4cGxpY2l0R2VuZXJhdGlvbklkfVxuICAgIF0pXG4gICAgY29uc3QgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSA9IHJlc29sdmVJbml0aWFsR2VuZXJhdGlvblN0YXRlKFtcbiAgICAgIHtuYW1lOiBcImJhY2tncm91bmRKb2JzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGVcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImluaXRpYWxHZW5lcmF0aW9uU3RhdGVcIikgJiYgY29uZmlndXJlZC5pbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSB1bmRlZmluZWQsIHZhbHVlOiBjb25maWd1cmVkLmluaXRpYWxHZW5lcmF0aW9uU3RhdGV9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19JTklUSUFMX0dFTkVSQVRJT05fU1RBVEVcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihnZW5lcmF0aW9uRW52aXJvbm1lbnQsIFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19JTklUSUFMX0dFTkVSQVRJT05fU1RBVEVcIiksIHZhbHVlOiBnZW5lcmF0aW9uRW52aXJvbm1lbnQuVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19JTklUSUFMX0dFTkVSQVRJT05fU1RBVEV9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGluaXRpYWxHZW5lcmF0aW9uU3RhdGVgLCBwcmVzZW50OiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUgIT09IHVuZGVmaW5lZCwgdmFsdWU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZX1cbiAgICBdLCBnZW5lcmF0aW9uSWQpXG4gICAgY29uc3QgbGlmZWN5Y2xlU29ja2V0UGF0aCA9IHJlc29sdmVMaWZlY3ljbGVTb2NrZXRQYXRoKFtcbiAgICAgIHtuYW1lOiBcImJhY2tncm91bmRKb2JzLmxpZmVjeWNsZVNvY2tldFBhdGhcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihjb25maWd1cmVkLCBcImxpZmVjeWNsZVNvY2tldFBhdGhcIikgJiYgY29uZmlndXJlZC5saWZlY3ljbGVTb2NrZXRQYXRoICE9PSB1bmRlZmluZWQsIHZhbHVlOiBjb25maWd1cmVkLmxpZmVjeWNsZVNvY2tldFBhdGh9LFxuICAgICAge25hbWU6IFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19MSUZFQ1lDTEVfU09DS0VUX1BBVEhcIiwgcHJlc2VudDogT2JqZWN0Lmhhc093bihnZW5lcmF0aW9uRW52aXJvbm1lbnQsIFwiVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19MSUZFQ1lDTEVfU09DS0VUX1BBVEhcIiksIHZhbHVlOiBnZW5lcmF0aW9uRW52aXJvbm1lbnQuVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19MSUZFQ1lDTEVfU09DS0VUX1BBVEh9LFxuICAgICAge25hbWU6IGAke3NvdXJjZU5hbWV9IGxpZmVjeWNsZVNvY2tldFBhdGhgLCBwcmVzZW50OiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGggIT09IHVuZGVmaW5lZCwgdmFsdWU6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aH1cbiAgICBdLCBnZW5lcmF0aW9uSWQpXG5cbiAgICByZXR1cm4ge2dlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBiYWNrZ3JvdW5kIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7T21pdDxSZXF1aXJlZDxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNDb25maWd1cmF0aW9uPiwgXCJhZGFwdGVyXCIgfCBcInJldGVudGlvblwiIHwgXCJnZW5lcmF0aW9uSWRcIiB8IFwibGlmZWN5Y2xlU29ja2V0UGF0aFwiPiAmIHtnZW5lcmF0aW9uSWQ/OiBzdHJpbmcsIGxpZmVjeWNsZVNvY2tldFBhdGg/OiBzdHJpbmcsIHJldGVudGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlc29sdmVkQmFja2dyb3VuZEpvYnNSZXRlbnRpb25Db25maWd1cmF0aW9ufX0gLSBCYWNrZ3JvdW5kIGpvYnMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkge1xuICAgIGNvbnN0IHByb2Nlc3NFbnZpcm9ubWVudCA9IGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52XG4gICAgY29uc3QgZW52SG9zdCA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19IT1NUXG4gICAgY29uc3QgZW52UG9ydFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT1JUXG4gICAgY29uc3QgZW52RGF0YWJhc2VJZGVudGlmaWVyID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0RBVEFCQVNFX0lERU5USUZJRVJcbiAgICBjb25zdCBlbnZNYXhDb25jdXJyZW50Rm9ya2VkUmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX01BWF9DT05DVVJSRU5UX0ZPUktFRF9KT0JTXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudFJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19NQVhfQ09OQ1VSUkVOVF9JTkxJTkVfSk9CU1xuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvdW50UmF3ID0gcHJvY2Vzc0Vudmlyb25tZW50Py5WRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPT0xFRF9SVU5ORVJfQ09VTlRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeVJhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX0NPTkNVUlJFTkNZXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4Sm9ic1JhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX01BWF9KT0JTXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9PTEVEX1JVTk5FUl9NQVhfUlNTX0JZVEVTXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1JhdyA9IHByb2Nlc3NFbnZpcm9ubWVudD8uVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT09MRURfUlVOTkVSX01BWF9MSUZFVElNRV9NU1xuICAgIGNvbnN0IGVudkRpc3BhdGNoU3RyYXRlZ3kgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfRElTUEFUQ0hfU1RSQVRFR1lcbiAgICBjb25zdCBlbnZQb2xsSW50ZXJ2YWxSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9MTF9JTlRFUlZBTF9NU1xuICAgIGNvbnN0IGVudkpvYlRpbWVvdXRSYXcgPSBwcm9jZXNzRW52aXJvbm1lbnQ/LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSk9CX1RJTUVPVVRfTVNcbiAgICBjb25zdCBlbnZQb3J0ID0gZW52UG9ydFJhdyA/IE51bWJlcihlbnZQb3J0UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudk1heENvbmN1cnJlbnRGb3JrZWQgPSBlbnZNYXhDb25jdXJyZW50Rm9ya2VkUmF3ID8gTnVtYmVyKGVudk1heENvbmN1cnJlbnRGb3JrZWRSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52TWF4Q29uY3VycmVudCA9IGVudk1heENvbmN1cnJlbnRSYXcgPyBOdW1iZXIoZW52TWF4Q29uY3VycmVudFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJDb3VudCA9IGVudlBvb2xlZFJ1bm5lckNvdW50UmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lckNvdW50UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3lSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3lSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9vbGVkUnVubmVyTWF4Sm9icyA9IGVudlBvb2xlZFJ1bm5lck1heEpvYnNSYXcgPyBOdW1iZXIoZW52UG9vbGVkUnVubmVyTWF4Sm9ic1JhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzUmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzUmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPSBlbnZQb29sZWRSdW5uZXJNYXhMaWZldGltZU1zUmF3ID8gTnVtYmVyKGVudlBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNSYXcpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZW52UG9sbEludGVydmFsID0gZW52UG9sbEludGVydmFsUmF3ID8gTnVtYmVyKGVudlBvbGxJbnRlcnZhbFJhdykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBlbnZKb2JUaW1lb3V0ID0gZW52Sm9iVGltZW91dFJhdyA/IE51bWJlcihlbnZKb2JUaW1lb3V0UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLl9iYWNrZ3JvdW5kSm9icyB8fCB7fVxuICAgIGNvbnN0IHtnZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGh9ID0gdGhpcy5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKClcbiAgICBjb25zdCBtb2RlID0gY29uZmlndXJlZC5tb2RlID09PSB1bmRlZmluZWQgPyBcImJhY2tncm91bmRcIiA6IGNvbmZpZ3VyZWQubW9kZVxuXG4gICAgaWYgKG1vZGUgIT09IFwiYmFja2dyb3VuZFwiICYmIG1vZGUgIT09IFwiaW5saW5lXCIpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGJhY2tncm91bmRKb2JzLm1vZGUgbXVzdCBiZSBcImJhY2tncm91bmRcIiBvciBcImlubGluZVwiLCBnb3Q6ICR7U3RyaW5nKG1vZGUpfWApXG4gICAgfVxuICAgIGNvbnN0IGhvc3QgPSBjb25maWd1cmVkLmhvc3QgfHwgZW52SG9zdCB8fCBcIjEyNy4wLjAuMVwiXG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiBjb25maWd1cmVkLnBvcnQgPT09IFwibnVtYmVyXCJcbiAgICAgID8gY29uZmlndXJlZC5wb3J0XG4gICAgICA6ICh0eXBlb2YgZW52UG9ydCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9ydCkgPyBlbnZQb3J0IDogNzMzMSlcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBjb25maWd1cmVkLmRhdGFiYXNlSWRlbnRpZmllciB8fCBlbnZEYXRhYmFzZUlkZW50aWZpZXIgfHwgXCJkZWZhdWx0XCJcbiAgICBjb25zdCBtYXhDb25jdXJyZW50SW5saW5lSm9icyA9IHR5cGVvZiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQubWF4Q29uY3VycmVudElubGluZUpvYnMgPj0gMVxuICAgICAgPyBjb25maWd1cmVkLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgICA6ICh0eXBlb2YgZW52TWF4Q29uY3VycmVudCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52TWF4Q29uY3VycmVudCkgJiYgZW52TWF4Q29uY3VycmVudCA+PSAxID8gZW52TWF4Q29uY3VycmVudCA6IDQpXG4gICAgY29uc3QgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSB0eXBlb2YgY29uZmlndXJlZC5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgICAgOiAodHlwZW9mIGVudk1heENvbmN1cnJlbnRGb3JrZWQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudk1heENvbmN1cnJlbnRGb3JrZWQpICYmIGVudk1heENvbmN1cnJlbnRGb3JrZWQgPj0gMSA/IGVudk1heENvbmN1cnJlbnRGb3JrZWQgOiA0KVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lckNvdW50ID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnQpICYmIE51bWJlci5pc0ludGVnZXIoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCkgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb3VudCA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyQ291bnRcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJDb3VudFwiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJDb3VudCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyQ291bnQpICYmIE51bWJlci5pc0ludGVnZXIoZW52UG9vbGVkUnVubmVyQ291bnQpICYmIGVudlBvb2xlZFJ1bm5lckNvdW50ID49IDEgPyBlbnZQb29sZWRSdW5uZXJDb3VudCA6IDQpXG4gICAgY29uc3QgcG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSkgJiYgTnVtYmVyLmlzSW50ZWdlcihjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSAmJiBjb25maWd1cmVkLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJDb25jdXJyZW5jeVxuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XCIgaW4gY29uZmlndXJlZCkgJiYgdHlwZW9mIGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbnZQb29sZWRSdW5uZXJDb25jdXJyZW5jeSkgJiYgZW52UG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPj0gMSA/IGVudlBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5IDogMSlcbiAgICBjb25zdCBwb29sZWRSdW5uZXJNYXhKb2JzID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9icyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4Sm9icykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzID49IDFcbiAgICAgID8gY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhKb2JzXG4gICAgICA6ICghKFwicG9vbGVkUnVubmVyTWF4Sm9ic1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJNYXhKb2JzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZQb29sZWRSdW5uZXJNYXhKb2JzKSAmJiBOdW1iZXIuaXNJbnRlZ2VyKGVudlBvb2xlZFJ1bm5lck1heEpvYnMpICYmIGVudlBvb2xlZFJ1bm5lck1heEpvYnMgPj0gMSA/IGVudlBvb2xlZFJ1bm5lck1heEpvYnMgOiAxMDApXG4gICAgY29uc3QgcG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcykgJiYgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcbiAgICAgIDogKCEoXCJwb29sZWRSdW5uZXJNYXhSc3NCeXRlc1wiIGluIGNvbmZpZ3VyZWQpICYmIHR5cGVvZiBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMpICYmIGVudlBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID49IDEgPyBlbnZQb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA6IDUxMiAqIDEwMjQgKiAxMDI0KVxuICAgIGNvbnN0IHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPSB0eXBlb2YgY29uZmlndXJlZC5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpICYmIGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1xuICAgICAgOiAoIShcInBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcIiBpbiBjb25maWd1cmVkKSAmJiB0eXBlb2YgZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcykgJiYgZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA+PSAxID8gZW52UG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA6IDYwICogNjAgKiAxMDAwKVxuICAgIGNvbnN0IGRpc3BhdGNoU3RyYXRlZ3lSYXcgPSBjb25maWd1cmVkLmRpc3BhdGNoU3RyYXRlZ3kgfHwgZW52RGlzcGF0Y2hTdHJhdGVneVxuICAgIGNvbnN0IGRpc3BhdGNoU3RyYXRlZ3kgPSBkaXNwYXRjaFN0cmF0ZWd5UmF3ID09PSBcInBvbGxpbmdcIiA/IFwicG9sbGluZ1wiIDogXCJiZWFjb25cIlxuICAgIGNvbnN0IHBvbGxJbnRlcnZhbE1zID0gdHlwZW9mIGNvbmZpZ3VyZWQucG9sbEludGVydmFsTXMgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZC5wb2xsSW50ZXJ2YWxNcyA+PSAxXG4gICAgICA/IGNvbmZpZ3VyZWQucG9sbEludGVydmFsTXNcbiAgICAgIDogKHR5cGVvZiBlbnZQb2xsSW50ZXJ2YWwgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGVudlBvbGxJbnRlcnZhbCkgJiYgZW52UG9sbEludGVydmFsID49IDEgPyBlbnZQb2xsSW50ZXJ2YWwgOiAxMDAwKVxuICAgIGNvbnN0IHF1ZXVlcyA9IGNvbmZpZ3VyZWQucXVldWVzICYmIHR5cGVvZiBjb25maWd1cmVkLnF1ZXVlcyA9PT0gXCJvYmplY3RcIiA/IGNvbmZpZ3VyZWQucXVldWVzIDoge31cbiAgICAvLyBBbiBleHBsaWNpdCBjb25maWcgdmFsdWUgd2lucyBvdmVyIHRoZSBlbnYgdmFyIOKAlCBpbmNsdWRpbmcgYG51bGxgL2AwYCxcbiAgICAvLyB3aGljaCBkaXNhYmxlIHRoZSBiYWNrc3RvcCBldmVuIHdoZW4gdGhlIGVudmlyb25tZW50IHNldHMgYSBkZWZhdWx0LlxuICAgIC8vIE9ubHkgZmFsbCB0aHJvdWdoIHRvIHRoZSBlbnYgdmFyIHdoZW4gY29uZmlnIG9taXRzIGBqb2JUaW1lb3V0TXNgIGVudGlyZWx5LlxuICAgIGNvbnN0IGpvYlRpbWVvdXRNcyA9IFwiam9iVGltZW91dE1zXCIgaW4gY29uZmlndXJlZFxuICAgICAgPyAodHlwZW9mIGNvbmZpZ3VyZWQuam9iVGltZW91dE1zID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQuam9iVGltZW91dE1zID4gMCA/IGNvbmZpZ3VyZWQuam9iVGltZW91dE1zIDogbnVsbClcbiAgICAgIDogKHR5cGVvZiBlbnZKb2JUaW1lb3V0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShlbnZKb2JUaW1lb3V0KSAmJiBlbnZKb2JUaW1lb3V0ID4gMCA/IGVudkpvYlRpbWVvdXQgOiBudWxsKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRSZXRlbnRpb24gPSBjb25maWd1cmVkLnJldGVudGlvbiAmJiB0eXBlb2YgY29uZmlndXJlZC5yZXRlbnRpb24gPT09IFwib2JqZWN0XCIgPyBjb25maWd1cmVkLnJldGVudGlvbiA6IHt9XG4gICAgY29uc3QgcmV0ZW50aW9uID0ge1xuICAgICAgY29tcGxldGVkVHRsTXM6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zID09PSBcIm51bWJlclwiIHx8IGNvbmZpZ3VyZWRSZXRlbnRpb24uY29tcGxldGVkVHRsTXMgPT09IG51bGxcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zXG4gICAgICAgIDogNyAqIDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gICAgICBmYWlsZWRUdGxNczogdHlwZW9mIGNvbmZpZ3VyZWRSZXRlbnRpb24uZmFpbGVkVHRsTXMgPT09IFwibnVtYmVyXCIgfHwgY29uZmlndXJlZFJldGVudGlvbi5mYWlsZWRUdGxNcyA9PT0gbnVsbFxuICAgICAgICA/IGNvbmZpZ3VyZWRSZXRlbnRpb24uZmFpbGVkVHRsTXNcbiAgICAgICAgOiAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gICAgICBiYXRjaFNpemU6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZSA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZSA+IDBcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLmJhdGNoU2l6ZVxuICAgICAgICA6IDEwMDAsXG4gICAgICBzd2VlcEludGVydmFsTXM6IHR5cGVvZiBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNcyA+IDBcbiAgICAgICAgPyBjb25maWd1cmVkUmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNc1xuICAgICAgICA6IDYwICogNjAgKiAxMDAwXG4gICAgfVxuXG4gICAgY29uc3Qgam9iQ2xhc3NlcyA9IHRoaXMuZ2V0QmFja2dyb3VuZEpvYkNsYXNzZXMoKVxuXG4gICAgcmV0dXJuIHtob3N0LCBwb3J0LCBkYXRhYmFzZUlkZW50aWZpZXIsIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzLCBtYXhDb25jdXJyZW50SW5saW5lSm9icywgbW9kZSwgcG9vbGVkUnVubmVyQ291bnQsIHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5LCBwb29sZWRSdW5uZXJNYXhKb2JzLCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcywgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcywgZGlzcGF0Y2hTdHJhdGVneSwgcG9sbEludGVydmFsTXMsIHF1ZXVlcywgam9iQ2xhc3Nlcywgam9iVGltZW91dE1zLCByZXRlbnRpb24sIGdlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHN0YXRpY2FsbHkgcmVnaXN0ZXJlZCBwb3J0YWJsZSBiYWNrZ3JvdW5kIGpvYnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNsYXNzW119IC0gQ29uZmlndXJlZCBqb2IgY2xhc3Nlcy5cbiAgICovXG4gIGdldEJhY2tncm91bmRKb2JDbGFzc2VzKCkge1xuICAgIGNvbnN0IGpvYkNsYXNzZXMgPSB0aGlzLl9iYWNrZ3JvdW5kSm9icz8uam9iQ2xhc3Nlc1xuXG4gICAgaWYgKGpvYkNsYXNzZXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFtdXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGpvYkNsYXNzZXMpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiYmFja2dyb3VuZEpvYnMuam9iQ2xhc3NlcyBtdXN0IGJlIGFuIGFycmF5XCIpXG5cbiAgICByZXR1cm4gWy4uLmpvYkNsYXNzZXNdXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW5kIG1lbW9pemVzIG9uZSBiYWNrZ3JvdW5kLWpvYnMgYWRhcHRlciBmb3IgdGhpcyBjb25maWd1cmF0aW9uIGxpZmVjeWNsZS5cbiAgICogQHJldHVybnMge0JhY2tncm91bmRKb2JzQWRhcHRlcn0gLSBBY3RpdmUgYWRhcHRlci5cbiAgICovXG4gIGdldEJhY2tncm91bmRKb2JzQWRhcHRlcigpIHtcbiAgICBpZiAodGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbikgcmV0dXJuIHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24uYWRhcHRlclxuXG4gICAgY29uc3QgY29uZmlndXJlZEFkYXB0ZXIgPSB0aGlzLl9iYWNrZ3JvdW5kSm9icz8uYWRhcHRlclxuICAgIGNvbnN0IGFkYXB0ZXIgPSB0eXBlb2YgY29uZmlndXJlZEFkYXB0ZXIgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBjb25maWd1cmVkQWRhcHRlcih7Y29uZmlndXJhdGlvbjogdGhpc30pXG4gICAgICA6IChjb25maWd1cmVkQWRhcHRlciB8fCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmNyZWF0ZUJhY2tncm91bmRKb2JzQWRhcHRlcih7Y29uZmlndXJhdGlvbjogdGhpc30pKVxuXG4gICAgaWYgKCEoYWRhcHRlciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JzQWRhcHRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJiYWNrZ3JvdW5kSm9icy5hZGFwdGVyIG11c3QgYmUgYSBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgaW5zdGFuY2Ugb3IgYSBzeW5jaHJvbm91cyBmYWN0b3J5IHJldHVybmluZyBvbmVcIilcbiAgICB9XG5cbiAgICB0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID0ge1xuICAgICAgYWRhcHRlcixcbiAgICAgIGNsb3Npbmc6IGZhbHNlLFxuICAgICAgY2xvc2VQcm9taXNlOiB1bmRlZmluZWQsXG4gICAgICByZWFkeVByb21pc2U6IHVuZGVmaW5lZFxuICAgIH1cbiAgICByZXR1cm4gYWRhcHRlclxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgYWNxdWlyZXMgdGhlIGV4YWN0IHJlYWR5IGFkYXB0ZXIgZm9yIHRoZSBhY3RpdmUgbGlmZWN5Y2xlLlxuICAgKiBBIGNsb3NlIHRoYXQgY2xhaW1zIHRoZSBnZW5lcmF0aW9uIHdoaWxlIHJlYWRpbmVzcyBpcyBwZW5kaW5nIHdpbnM6IHRoaXNcbiAgICogb3BlcmF0aW9uIHdhaXRzIGZvciB0aGF0IGNsb3NlLCBjcmVhdGVzIHRoZSBuZXh0IGdlbmVyYXRpb24sIHJlYWRpZXMgaXQsXG4gICAqIGFuZCByZXR1cm5zIG9ubHkgdGhhdCBsaXZlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxCYWNrZ3JvdW5kSm9ic0FkYXB0ZXI+fSAtIEV4YWN0IHJlYWR5IGFkYXB0ZXIgZ2VuZXJhdGlvbi5cbiAgICovXG4gIGFzeW5jIGFjcXVpcmVSZWFkeUJhY2tncm91bmRKb2JzQWRhcHRlcigpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgZGF0YWJhc2VDbG9zZVByb21pc2UgPSB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlXG5cbiAgICAgIGlmIChkYXRhYmFzZUNsb3NlUHJvbWlzZSkge1xuICAgICAgICBhd2FpdCBkYXRhYmFzZUNsb3NlUHJvbWlzZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aGlzLmdldEJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICBjb25zdCBnZW5lcmF0aW9uID0gdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvblxuXG4gICAgICBpZiAoIWdlbmVyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBhZGFwdGVyIGdlbmVyYXRpb24gd2FzIG5vdCBjcmVhdGVkXCIpXG5cbiAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NpbmcpIHtcbiAgICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2VQcm9taXNlKSBhd2FpdCBnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWFkeVByb21pc2UgPSBnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSB8fCBQcm9taXNlLnJlc29sdmUoKS50aGVuKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZ2VuZXJhdGlvbi5hZGFwdGVyLmVuc3VyZVJlYWR5KClcbiAgICAgIH0pXG5cbiAgICAgIGdlbmVyYXRpb24ucmVhZHlQcm9taXNlID0gcmVhZHlQcm9taXNlXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHJlYWR5UHJvbWlzZVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGdlbmVyYXRpb24ucmVhZHlQcm9taXNlID09PSByZWFkeVByb21pc2UpIGdlbmVyYXRpb24ucmVhZHlQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChnZW5lcmF0aW9uLmNsb3NpbmcpIHtcbiAgICAgICAgaWYgKGdlbmVyYXRpb24uY2xvc2VQcm9taXNlKSBhd2FpdCBnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiAhPT0gZ2VuZXJhdGlvbikgY29udGludWVcblxuICAgICAgcmV0dXJuIGdlbmVyYXRpb24uYWRhcHRlclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkaWVzIHRoZSBhY3RpdmUgYWRhcHRlciBvbmNlIHBlciBsaWZlY3ljbGUuIEEgZmFpbGVkIGF0dGVtcHQgcmVtYWlucyByZXRyeWFibGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJSZWFkeSgpIHtcbiAgICBhd2FpdCB0aGlzLmFjcXVpcmVSZWFkeUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBoZWFsdGggd2l0aG91dCByZXNvbHZpbmcgcGVyc2lzdGVuY2UgaW4gbm9uLWR1cmFibGUgaW5saW5lIG1vZGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzSGVhbHRoPn0gLSBDdXJyZW50IGhlYWx0aC5cbiAgICovXG4gIGFzeW5jIGJhY2tncm91bmRKb2JzSGVhbHRoKCkge1xuICAgIGlmICh0aGlzLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkubW9kZSA9PT0gXCJpbmxpbmVcIikgcmV0dXJuIHtyZWFkeTogdHJ1ZX1cblxuICAgIGNvbnN0IGFkYXB0ZXIgPSBhd2FpdCB0aGlzLmFjcXVpcmVSZWFkeUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG5cbiAgICByZXR1cm4gYXdhaXQgYWRhcHRlci5oZWFsdGgoKVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyB0aGUgcmVzb2x2ZWQgYWRhcHRlciBvbmNlIGFuZCBjbGVhcnMgbGlmZWN5Y2xlIGNhY2hlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY2xvc2UuXG4gICAqL1xuICBhc3luYyBjbG9zZUJhY2tncm91bmRKb2JzQWRhcHRlcigpIHtcbiAgICBjb25zdCBnZW5lcmF0aW9uID0gdGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvblxuXG4gICAgaWYgKCFnZW5lcmF0aW9uKSByZXR1cm5cbiAgICBpZiAoZ2VuZXJhdGlvbi5jbG9zZVByb21pc2UpIHJldHVybiBhd2FpdCBnZW5lcmF0aW9uLmNsb3NlUHJvbWlzZVxuXG4gICAgZ2VuZXJhdGlvbi5jbG9zaW5nID0gdHJ1ZVxuICAgIGNvbnN0IGNsb3NlUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgICBjb25zdCBjbG9zZUVycm9ycyA9IFtdXG5cbiAgICAgIGlmIChnZW5lcmF0aW9uLnJlYWR5UHJvbWlzZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGdlbmVyYXRpb24ucmVhZHlQcm9taXNlXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZ2VuZXJhdGlvbi5hZGFwdGVyLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNsb3NlRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBjbG9zZUVycm9yc1swXVxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihjbG9zZUVycm9ycywgXCJGYWlsZWQgdG8gcmVhZHkgYW5kIGNsb3NlIHRoZSBiYWNrZ3JvdW5kLWpvYnMgYWRhcHRlclwiKVxuICAgIH0pKClcblxuICAgIGdlbmVyYXRpb24uY2xvc2VQcm9taXNlID0gY2xvc2VQcm9taXNlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2xvc2VQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLl9iYWNrZ3JvdW5kSm9ic0FkYXB0ZXJHZW5lcmF0aW9uID09PSBnZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX2JhY2tncm91bmRKb2JzQWRhcHRlckdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNDb25maWd1cmF0aW9ufSBiYWNrZ3JvdW5kSm9icyAtIEJhY2tncm91bmQgam9icyBjb25maWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0QmFja2dyb3VuZEpvYnNDb25maWcoYmFja2dyb3VuZEpvYnMpIHtcbiAgICBpZiAodGhpcy5fYmFja2dyb3VuZEpvYnNBZGFwdGVyR2VuZXJhdGlvbiAmJiBiYWNrZ3JvdW5kSm9icy5hZGFwdGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZXBsYWNlIGJhY2tncm91bmRKb2JzLmFkYXB0ZXIgZHVyaW5nIGFuIGFjdGl2ZSBhZGFwdGVyIGxpZmVjeWNsZTsgY2xvc2UgaXQgZmlyc3RcIilcbiAgICB9XG5cbiAgICB0aGlzLl9iYWNrZ3JvdW5kSm9icyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2JhY2tncm91bmRKb2JzLCBiYWNrZ3JvdW5kSm9icylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYWN0aXZlIEJlYWNvbiBjb25maWd1cmF0aW9uLiBCZWFjb24gaXMgb3B0LWluOiBpdFxuICAgKiBzdGF5cyBkaXNhYmxlZCB1bmxlc3MgdGhlIGFwcCBwYXNzZXMgYGJlYWNvbjoge2hvc3QsIHBvcnR9YCAvXG4gICAqIGBiZWFjb246IHtpblByb2Nlc3M6IHRydWV9YCwgY2FsbHMgYHNldEJlYWNvbkNvbmZpZyh7Li4ufSlgLCBvclxuICAgKiBzZXRzIHRoZSBgVkVMT0NJT1VTX0JFQUNPTl9IT1NUYCAvIGBWRUxPQ0lPVVNfQkVBQ09OX1BPUlRgIGVudiB2YXJzLlxuICAgKiBTZXR0aW5nIGBlbmFibGVkOiBmYWxzZWAgZXhwbGljaXRseSBkaXNhYmxlcyBpdCBldmVuIHdoZW4gZW52IHZhcnNcbiAgICogYXJlIHByZXNlbnQgKHVzZWZ1bCBmb3IgdGVzdHMpLiBXaGVuIGBpblByb2Nlc3M6IHRydWVgIGlzIHNldCxcbiAgICogZW52LXZhciBob3N0L3BvcnQgYXJlIGlnbm9yZWQg4oCUIGNvZGUtbGV2ZWwgY29uZmlnIHdpbnMuXG4gICAqIEByZXR1cm5zIHt7ZW5hYmxlZDogYm9vbGVhbiwgaG9zdDogc3RyaW5nLCBwb3J0OiBudW1iZXIsIHBlZXJUeXBlPzogc3RyaW5nLCBpblByb2Nlc3M6IGJvb2xlYW4sIHVucmVhY2hhYmxlUmVwb3J0TXM6IG51bWJlcn19IC0gQmVhY29uIGNvbmZpZ3VyYXRpb24gd2l0aCBkZWZhdWx0cyBhcHBsaWVkLlxuICAgKi9cbiAgZ2V0QmVhY29uQ29uZmlnKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLl9iZWFjb24gfHwge31cbiAgICBjb25zdCBpblByb2Nlc3MgPSBjb25maWd1cmVkLmluUHJvY2VzcyA9PT0gdHJ1ZVxuXG4gICAgaWYgKGluUHJvY2VzcyAmJiAoY29uZmlndXJlZC5ob3N0IHx8IHR5cGVvZiBjb25maWd1cmVkLnBvcnQgPT09IFwibnVtYmVyXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCZWFjb24gY29uZmlndXJhdGlvbjogYGluUHJvY2VzczogdHJ1ZWAgaXMgbXV0dWFsbHkgZXhjbHVzaXZlIHdpdGggYGhvc3RgL2Bwb3J0YC4gVXNlIG9uZSBvciB0aGUgb3RoZXIuXCIpXG4gICAgfVxuXG4gICAgY29uc3QgZW52SG9zdCA9IGluUHJvY2VzcyA/IHVuZGVmaW5lZCA6IHByb2Nlc3MuZW52LlZFTE9DSU9VU19CRUFDT05fSE9TVFxuICAgIGNvbnN0IGVudlBvcnRSYXcgPSBpblByb2Nlc3MgPyB1bmRlZmluZWQgOiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQkVBQ09OX1BPUlRcbiAgICBjb25zdCBlbnZQb3J0ID0gZW52UG9ydFJhdyA/IE51bWJlcihlbnZQb3J0UmF3KSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGhvc3QgPSBjb25maWd1cmVkLmhvc3QgfHwgZW52SG9zdCB8fCBcIjEyNy4wLjAuMVwiXG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiBjb25maWd1cmVkLnBvcnQgPT09IFwibnVtYmVyXCJcbiAgICAgID8gY29uZmlndXJlZC5wb3J0XG4gICAgICA6ICh0eXBlb2YgZW52UG9ydCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUoZW52UG9ydCkgPyBlbnZQb3J0IDogNzMzMClcblxuICAgIGxldCBlbmFibGVkXG5cbiAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWQuZW5hYmxlZCA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIGVuYWJsZWQgPSBjb25maWd1cmVkLmVuYWJsZWRcbiAgICB9IGVsc2Uge1xuICAgICAgZW5hYmxlZCA9IEJvb2xlYW4oaW5Qcm9jZXNzIHx8IGNvbmZpZ3VyZWQuaG9zdCB8fCBjb25maWd1cmVkLnBvcnQgfHwgZW52SG9zdCB8fCBlbnZQb3J0KVxuICAgIH1cblxuICAgIGNvbnN0IHVucmVhY2hhYmxlUmVwb3J0TXMgPSByZXNvbHZlQmVhY29uVW5yZWFjaGFibGVSZXBvcnRNcyhjb25maWd1cmVkLnVucmVhY2hhYmxlUmVwb3J0TXMpXG5cbiAgICByZXR1cm4ge2VuYWJsZWQsIGhvc3QsIHBvcnQsIHBlZXJUeXBlOiBjb25maWd1cmVkLnBlZXJUeXBlLCBpblByb2Nlc3MsIHVucmVhY2hhYmxlUmVwb3J0TXN9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYmVhY29uIGNvbmZpZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmVhY29uQ29uZmlndXJhdGlvbn0gYmVhY29uIC0gQmVhY29uIGNvbmZpZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRCZWFjb25Db25maWcoYmVhY29uKSB7XG4gICAgdGhpcy5fYmVhY29uID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmVhY29uLCBiZWFjb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYmVhY29uIGNsaWVudC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgYWN0aXZlIEJlYWNvbiBjbGllbnQsIGlmIGNvbm5lY3RlZC5cbiAgICovXG4gIGdldEJlYWNvbkNsaWVudCgpIHtcbiAgICByZXR1cm4gdGhpcy5fYmVhY29uQ2xpZW50XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdHMgdGhpcyBjb25maWd1cmF0aW9uJ3MgQmVhY29uIGNsaWVudCB0byB0aGUgY29uZmlndXJlZFxuICAgKiBicm9rZXIsIHdpcmluZyBpbmNvbWluZyBicm9hZGNhc3RzIHRvIHRoZSBsb2NhbCBkZWxpdmVyeSBwYXRoIHNvXG4gICAqIGFueSB3ZWJzb2NrZXQgc3Vic2NyaWJlcnMgaW4gdGhpcyBwcm9jZXNzIHJlY2VpdmUgdGhlbS4gSWRlbXBvdGVudFxuICAgKiDigJQgcmVwZWF0IGNhbGxzIHJldHVybiB0aGUgc2FtZSBpbi1mbGlnaHQgb3IgcmVzb2x2ZWQgcHJvbWlzZS5cbiAgICpcbiAgICogUmV0dXJucyBpbW1lZGlhdGVseSB3aXRoIGB1bmRlZmluZWRgIGlmIEJlYWNvbiBpcyBub3QgZW5hYmxlZC5cbiAgICpcbiAgICogKipOb24tYmxvY2tpbmcgYnkgZGVzaWduIChUQ1AgbW9kZSkuKiogRm9yIGJyb2tlci1iYWNrZWQgQmVhY29uLCB0aGVcbiAgICogcmV0dXJuZWQgcHJvbWlzZSByZXNvbHZlcyBhcyBzb29uIGFzIHRoZSBjbGllbnQgaXMgY29uc3RydWN0ZWQgYW5kXG4gICAqIHRoZSBUQ1AgY29ubmVjdCBpcyBsYXVuY2hlZCDigJQgaXQgZG9lcyAqKm5vdCoqIHdhaXQgZm9yIHRoZSBjb25uZWN0XG4gICAqIGhhbmRzaGFrZSB0byBjb21wbGV0ZS4gQSBicm9rZXIgdGhhdCBzaWxlbnRseSBkcm9wcyBTWU5zXG4gICAqIChmaXJld2FsbC9OQUNMIERST1AgcnVsZXMpIHdvdWxkIG90aGVyd2lzZSBibG9jayBzdGFydHVwIG9uIHRoZSBPU1xuICAgKiBUQ1AgY29ubmVjdCB0aW1lb3V0ICh0ZW5zIG9mIHNlY29uZHMpLCB3aGljaCBjb250cmFkaWN0cyB0aGVcbiAgICogZG9jdW1lbnRlZCBcImZhbGwgYmFjayB0byBsb2NhbC1vbmx5IGFuZCByZWNvbm5lY3QgaW4gdGhlXG4gICAqIGJhY2tncm91bmRcIiBjb250cmFjdC4gSW5pdGlhbC1jb25uZWN0IGZhaWx1cmVzIHN1cmZhY2VcbiAgICogYXN5bmNocm9ub3VzbHkgb24gdGhlIGZyYW1ld29yay1lcnJvciBjaGFubmVsIHZpYSB0aGVcbiAgICogYGNvbm5lY3QtZXJyb3JgIGxpc3RlbmVyIHJlZ2lzdGVyZWQgaGVyZS4gQ2FsbGVycyB0aGF0IG5lZWQgYVxuICAgKiBkZXRlcm1pbmlzdGljIHB1Ymxpc2gtcmVhZGluZXNzIGJvdW5kYXJ5IHNob3VsZCBjYWxsXG4gICAqIGBnZXRCZWFjb25DbGllbnQoKT8ud2FpdEZvclJlYWR5KHt0aW1lb3V0TXN9KWAuXG4gICAqXG4gICAqICoqSW4tcHJvY2VzcyBtb2RlKiogYXdhaXRzIGBjb25uZWN0KClgIOKAlCB0aGF0IHBhdGggaXMgc3luY2hyb25vdXMsXG4gICAqIGNhbm5vdCBmYWlsLCBhbmQgZ2l2ZXMgY2FsbGVycyBwcmVkaWN0YWJsZSByZWFkaW5lc3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucGVlclR5cGVdIC0gT3ZlcnJpZGUgcGVlclR5cGUgZm9yIHRoaXMgY29ubmVjdCBjYWxsIChlLmcuIGBcInNlcnZlclwiYCwgYFwiYmFja2dyb3VuZC1qb2JzLXdvcmtlclwiYCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcmVnaXN0ZXJlZCBjbGllbnQgKFRDUCBtb2RlOiBjb25uZWN0IG1heSBzdGlsbCBiZSBpbiBmbGlnaHQpLCBvciB1bmRlZmluZWQgd2hlbiBCZWFjb24gaXMgZGlzYWJsZWQuXG4gICAqL1xuICBhc3luYyBjb25uZWN0QmVhY29uKHtwZWVyVHlwZX0gPSB7fSkge1xuICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQpIHJldHVybiB0aGlzLl9iZWFjb25DbGllbnRcbiAgICBpZiAodGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZVxuXG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRCZWFjb25Db25maWcoKVxuXG4gICAgaWYgKCFjb25maWcuZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY2xpZW50ID0gYXdhaXQgdGhpcy5fY3JlYXRlQmVhY29uQ2xpZW50KHtcbiAgICAgICAgY29uZmlnLFxuICAgICAgICBwZWVyVHlwZTogcGVlclR5cGUgfHwgY29uZmlnLnBlZXJUeXBlXG4gICAgICB9KVxuXG4gICAgICBjbGllbnQub25Ccm9hZGNhc3QoKG1lc3NhZ2UpID0+IHtcbiAgICAgICAgLy8gU3luYXBzZS1zdHlsZSBmYW4tb3V0OiBkZWxpdmVyIGV2ZXJ5IGJyb2FkY2FzdCB3ZSByZWNlaXZlXG4gICAgICAgIC8vIGZyb20gdGhlIGJ1cyB0aHJvdWdoIHRoZSBsb2NhbCBkZWxpdmVyeSBwYXRoLiBFY2hvZXMgb2Ygb3VyXG4gICAgICAgIC8vIG93biBwdWJsaXNoZXMgZm9sbG93IHRoZSBzYW1lIHBhdGggc28gZXZlcnkgcGVlciBzZWVzIHRoZVxuICAgICAgICAvLyBzYW1lIGRlbGl2ZXJ5IHNlbWFudGljcy5cbiAgICAgICAgdGhpcy5fZGVsaXZlckJyb2FkY2FzdEZyb21CZWFjb24obWVzc2FnZSlcbiAgICAgIH0pXG5cbiAgICAgIC8vIEJlYWNvbiBjb25uZWN0L2Rpc2Nvbm5lY3QgYmxpcHMgYXJlIGV4cGVjdGVkIGR1cmluZyBkZXBsb3lzICh0aGUgYnJva2VyXG4gICAgICAvLyByZXN0YXJ0cykgYW5kIHRoZSBCZWFjb25DbGllbnQgYXV0by1yZWNvbm5lY3RzIGluIHRoZSBiYWNrZ3JvdW5kLCBzbyBhXG4gICAgICAvLyBzaW5nbGUgdHJhbnNpZW50IGZhaWx1cmUgaXMgTk9UIHJlcG9ydGVkLiBPbmx5IGEgc3VzdGFpbmVkIG91dGFnZSAoc3RpbGxcbiAgICAgIC8vIGRvd24gYWZ0ZXIgYHVucmVhY2hhYmxlUmVwb3J0TXNgKSBpcyBzdXJmYWNlZCBvbiB0aGUgZnJhbWV3b3JrLWVycm9yXG4gICAgICAvLyBjaGFubmVsOyBhIChyZSljb25uZWN0IHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93IGNsZWFycyBpdCBzaWxlbnRseS5cblxuICAgICAgLy8gYGNvbm5lY3QtZXJyb3JgIGZpcmVzIHdoZW4gdGhlICppbml0aWFsKiBUQ1AvaGFuZHNoYWtlIGZhaWxzLlxuICAgICAgY2xpZW50Lm9uKFwiY29ubmVjdC1lcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5faGFuZGxlQmVhY29uRG93bih7c3RhZ2U6IFwiYmVhY29uLWNvbm5lY3RcIiwgZXJyb3IsIHJlcG9ydEFmdGVyTXM6IGNvbmZpZy51bnJlYWNoYWJsZVJlcG9ydE1zfSlcbiAgICAgIH0pXG5cbiAgICAgIC8vIGBkaXNjb25uZWN0YCBmaXJlcyB3aGVuIGFuIGVzdGFibGlzaGVkIGNvbm5lY3Rpb24gZHJvcHMuIFRoZSBwYXlsb2FkIGlzXG4gICAgICAvLyB0aGUgdW5kZXJseWluZyBzb2NrZXQgZXJyb3IgaWYgdGhlcmUgd2FzIG9uZSwgb3IgYSBzeW50aGV0aWNcbiAgICAgIC8vIEVycm9yKFwiQmVhY29uIGJyb2tlciBkaXNjb25uZWN0ZWRcIikgb3RoZXJ3aXNlLlxuICAgICAgY2xpZW50Lm9uKFwiZGlzY29ubmVjdFwiLCAocmVhc29uKSA9PiB7XG4gICAgICAgIHRoaXMuX2hhbmRsZUJlYWNvbkRvd24oe3N0YWdlOiBcImJlYWNvbi1kaXNjb25uZWN0XCIsIGVycm9yOiByZWFzb24sIHJlcG9ydEFmdGVyTXM6IGNvbmZpZy51bnJlYWNoYWJsZVJlcG9ydE1zfSlcbiAgICAgIH0pXG5cbiAgICAgIC8vIGBjb25uZWN0YCBmaXJlcyBvbiBldmVyeSAocmUpY29ubmVjdDsgY2xlYXIgYW55IHBlbmRpbmcgb3V0YWdlIHN0YXRlIHNvXG4gICAgICAvLyBhIHRyYW5zaWVudCBibGlwIHRoYXQgcmVjb3ZlcnMgd2l0aGluIHRoZSBncmFjZSB3aW5kb3cgc3RheXMgc2lsZW50LlxuICAgICAgY2xpZW50Lm9uKFwiY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuX2hhbmRsZUJlYWNvblVwKClcbiAgICAgIH0pXG5cbiAgICAgIC8vIFJlZ2lzdGVyIHRoZSBjbGllbnQgKmJlZm9yZSoga2lja2luZyBvZmYgY29ubmVjdCBzbyBzdWJzZXF1ZW50XG4gICAgICAvLyBgY29ubmVjdEJlYWNvbigpYCBjYWxscyByZXR1cm4gdGhpcyBzYW1lIGluc3RhbmNlIGluc3RlYWQgb2ZcbiAgICAgIC8vIHJhY2luZyB0byBjb25zdHJ1Y3QgYSBzZWNvbmQgb25lLlxuICAgICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gY2xpZW50XG5cbiAgICAgIGlmIChjb25maWcuaW5Qcm9jZXNzKSB7XG4gICAgICAgIC8vIEluLXByb2Nlc3MgY29ubmVjdCBpcyBzeW5jaHJvbm91cywgY2Fubm90IGZhaWwsIGFuZCByZXNvbHZlc1xuICAgICAgICAvLyBiZWZvcmUgdGhpcyBhd2FpdCB5aWVsZHMg4oCUIGNhbGxlcnMgY2FuIHJlbHkgb25cbiAgICAgICAgLy8gYGlzQ29ubmVjdGVkKCkgPT09IHRydWVgIGltbWVkaWF0ZWx5IGFmdGVyIGBjb25uZWN0QmVhY29uKClgLlxuICAgICAgICBhd2FpdCBjbGllbnQuY29ubmVjdCgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBGaXJlLWFuZC1mb3JnZXQgdGhlIFRDUCBjb25uZWN0LiBBd2FpdGluZyBoZXJlIHdvdWxkIGJsb2NrXG4gICAgICAgIC8vIHN0YXJ0dXAgb24gdGhlIE9TIFRDUCBjb25uZWN0IHRpbWVvdXQgKDc1cyBkZWZhdWx0IG9uIExpbnV4KVxuICAgICAgICAvLyB3aGVuIHRoZSBicm9rZXIgc2lsZW50bHkgZHJvcHMgU1lOcy4gRmFpbHVyZXMgc3VyZmFjZVxuICAgICAgICAvLyBhc3luY2hyb25vdXNseSB2aWEgdGhlIGBjb25uZWN0LWVycm9yYCBsaXN0ZW5lciByZWdpc3RlcmVkXG4gICAgICAgIC8vIGFib3ZlOyB0aGUgQmVhY29uQ2xpZW50J3MgcmVjb25uZWN0IGxvb3Aga2VlcHMgdHJ5aW5nLlxuICAgICAgICB2b2lkIGNsaWVudC5jb25uZWN0KCkuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgIC8vIEFscmVhZHkgcmVwb3J0ZWQgdmlhIGNvbm5lY3QtZXJyb3IgYWJvdmUuXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjbGllbnRcbiAgICB9KSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fYmVhY29uQ29ubmVjdFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBCZWFjb24gY2xpZW50IG1hdGNoaW5nIHRoZSBjb25maWd1cmVkIG1vZGUuIFNwbGl0IG91dCBzb1xuICAgKiBgY29ubmVjdEJlYWNvbmAgc3RheXMgZm9jdXNlZCBvbiBsaWZlY3ljbGUgYW5kIGVycm9yIHdpcmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8VmVsb2Npb3VzQ29uZmlndXJhdGlvbltcImdldEJlYWNvbkNvbmZpZ1wiXT59IGFyZ3MuY29uZmlnIC0gUmVzb2x2ZWQgQmVhY29uIGNvbmZpZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnBlZXJUeXBlXSAtIFJlc29sdmVkIHBlZXIgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0Pn0gLSBCZWFjb24gY2xpZW50LlxuICAgKi9cbiAgYXN5bmMgX2NyZWF0ZUJlYWNvbkNsaWVudCh7Y29uZmlnLCBwZWVyVHlwZX0pIHtcbiAgICAvLyBSb3V0ZSB0aHJvdWdoIHRoZSBlbnZpcm9ubWVudCBoYW5kbGVyIHNvIHRoZSBOb2RlLW9ubHkgYG5vZGU6bmV0YFxuICAgIC8vIC8gYG5vZGU6Y3J5cHRvYCBkZXBzIGluIHRoZSBCZWFjb24gY2xpZW50IG1vZHVsZXMgZG9uJ3QgZ2V0IHB1bGxlZFxuICAgIC8vIGludG8gYnJvd3NlciBidW5kbGVzLiBCcm93c2VyIGJ1bmRsZXMgc3RhdGljYWxseSByZWFjaFxuICAgIC8vIGBDb25maWd1cmF0aW9uYCAodmlhIGBMb2dnZXJgKTsgcHV0dGluZyB0aGUgZHluYW1pY1xuICAgIC8vIGBpbXBvcnQoXCIuL2JlYWNvbi8uLi5cIilgIGNhbGxzIGhlcmUgd291bGQgc3RpbGwgZHJhZyB0aG9zZSBtb2R1bGVzXG4gICAgLy8gdGhyb3VnaCBlc2J1aWxkJ3Mgc3RhdGljIGFuYWx5c2lzLiBIaWRpbmcgdGhlIGltcG9ydHMgaW5zaWRlIHRoZVxuICAgIC8vIE5vZGUgZW52aXJvbm1lbnQgaGFuZGxlciBrZWVwcyB0aGVtIG9mZiB0aGUgYnJvd3NlciBwYXRoIOKAlFxuICAgIC8vIGJyb3dzZXItYnVuZGxlZCBhcHBzIG5ldmVyIHJlYWNoIGBlbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlLmpzYC5cbiAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuXG4gICAgaWYgKGNvbmZpZy5pblByb2Nlc3MpIHtcbiAgICAgIGNvbnN0IEluUHJvY2Vzc0JlYWNvbkNsaWVudCA9IGF3YWl0IGhhbmRsZXIubG9hZEluUHJvY2Vzc0JlYWNvbkNsaWVudCgpXG5cbiAgICAgIHJldHVybiBuZXcgSW5Qcm9jZXNzQmVhY29uQ2xpZW50KHtwZWVyVHlwZX0pXG4gICAgfVxuXG4gICAgY29uc3QgQmVhY29uQ2xpZW50ID0gYXdhaXQgaGFuZGxlci5sb2FkQmVhY29uQ2xpZW50KClcblxuICAgIHJldHVybiBuZXcgQmVhY29uQ2xpZW50KHtcbiAgICAgIGhvc3Q6IGNvbmZpZy5ob3N0LFxuICAgICAgcG9ydDogY29uZmlnLnBvcnQsXG4gICAgICBwZWVyVHlwZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIEJlYWNvbiBjb25uZWN0L2Rpc2Nvbm5lY3QgZmFpbHVyZSB3aXRob3V0IHJlcG9ydGluZyBpdCBpbW1lZGlhdGVseS5cbiAgICogVGhlIEJlYWNvbkNsaWVudCBhdXRvLXJlY29ubmVjdHMsIHNvIGJyaWVmIG91dGFnZXMgKGUuZy4gYSBkZXBsb3kgcmVzdGFydGluZ1xuICAgKiB0aGUgYnJva2VyKSBhcmUgZXhwZWN0ZWQ7IG9ubHkgaWYgdGhlIGJlYWNvbiBpcyBzdGlsbCB1bnJlYWNoYWJsZSBhZnRlclxuICAgKiBgcmVwb3J0QWZ0ZXJNc2AgaXMgYSBzaW5nbGUgZnJhbWV3b3JrLWVycm9yIHN1cmZhY2VkIHZpYSBgX3JlcG9ydEJlYWNvbkVycm9yYC5cbiAgICogQSBzdWJzZXF1ZW50IGBjb25uZWN0YCAoc2VlIGBfaGFuZGxlQmVhY29uVXBgKSBjYW5jZWxzIHRoZSBwZW5kaW5nIHJlcG9ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1wiYmVhY29uLWNvbm5lY3RcIiB8IFwiYmVhY29uLWRpc2Nvbm5lY3RcIn0gYXJncy5zdGFnZSAtIEZhaWx1cmUgc3RhZ2UuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucmVwb3J0QWZ0ZXJNcyAtIEdyYWNlIHdpbmRvdyBiZWZvcmUgYSBzdXN0YWluZWQgb3V0YWdlIGlzIHJlcG9ydGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVCZWFjb25Eb3duKHtzdGFnZSwgZXJyb3IsIHJlcG9ydEFmdGVyTXN9KSB7XG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHtzdGFnZSwgZXJyb3J9XG5cbiAgICAvLyBBIHJlcG9ydCBpcyBhbHJlYWR5IHBlbmRpbmcgb3IgYWxyZWFkeSBzZW50IGZvciB0aGlzIG91dGFnZSDigJQga2VlcCB0aGVcbiAgICAvLyBsYXRlc3QgZXJyb3IgYnV0IGRvbid0IHN0YWNrIHRpbWVycyBvciByZS1yZXBvcnQuXG4gICAgaWYgKHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyIHx8IHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkKSByZXR1cm5cblxuICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuXG4gICAgICBpZiAodGhpcy5fYmVhY29uQ2xpZW50Py5pc0Nvbm5lY3RlZCgpKSB7XG4gICAgICAgIHRoaXMuX2hhbmRsZUJlYWNvblVwKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gdHJ1ZVxuXG4gICAgICBpZiAodGhpcy5fYmVhY29uTGFzdERvd25FcnJvcikgdGhpcy5fcmVwb3J0QmVhY29uRXJyb3IodGhpcy5fYmVhY29uTGFzdERvd25FcnJvcilcbiAgICB9LCByZXBvcnRBZnRlck1zKVxuXG4gICAgLy8gRG9uJ3QgbGV0IHRoZSBncmFjZSB0aW1lciBrZWVwIHRoZSBwcm9jZXNzIGFsaXZlLlxuICAgIGlmICh0eXBlb2YgdGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgdGltZXIudW5yZWYoKVxuXG4gICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB0aW1lclxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBiZWFjb24tZG93biBzdGF0ZSBvbiBhIChyZSljb25uZWN0LiBBIGJsaXAgdGhhdCByZWNvdmVycyB3aXRoaW4gdGhlXG4gICAqIGdyYWNlIHdpbmRvdyBpcyBuZXZlciByZXBvcnRlZDsgaWYgYSBzdXN0YWluZWQgb3V0YWdlIGhhZCBhbHJlYWR5IGJlZW5cbiAgICogcmVwb3J0ZWQsIHRoZSBzdGF0ZSByZXNldHMgc28gYSBmdXR1cmUgb3V0YWdlIGNhbiByZXBvcnQgYWdhaW4uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUJlYWNvblVwKCkge1xuICAgIGlmICh0aGlzLl9iZWFjb25SZXBvcnRUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKVxuICAgICAgdGhpcy5fYmVhY29uUmVwb3J0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICB0aGlzLl9iZWFjb25PdXRhZ2VSZXBvcnRlZCA9IGZhbHNlXG4gICAgdGhpcy5fYmVhY29uTGFzdERvd25FcnJvciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGEgQmVhY29uIGZhaWx1cmUgb24gdGhlIGZyYW1ld29yayBlcnJvciBjaGFubmVsLiBNaXJyb3JzXG4gICAqIHRoZSBwYXR0ZXJuIHVzZWQgYnkgYHJlcXVlc3QtcnVubmVyLmpzYCBmb3IgSFRUUCBlcnJvcnMuIFdoZW4gbm9cbiAgICogbGlzdGVuZXIgaXMgYXR0YWNoZWQgdG8gZWl0aGVyIGBmcmFtZXdvcmstZXJyb3JgIG9yIGBhbGwtZXJyb3JgLFxuICAgKiBhbHNvIHNjaGVkdWxlcyBhbiB1bmhhbmRsZWQgcHJvbWlzZSByZWplY3Rpb24gc28gcHJvY2Vzcy1sZXZlbCBidWdcbiAgICogcmVwb3J0ZXJzICh3aGljaCBzdWJzY3JpYmUgdG8gYHVuaGFuZGxlZFJlamVjdGlvbmAgYnkgZGVmYXVsdCkgcGlja1xuICAgKiB0aGUgZmFpbHVyZSB1cCDigJQgYW5kIEFMU08gd3JpdGVzIGEgb25lLWxpbmUgc3VtbWFyeSB0byBgc3RkZXJyYCBzb1xuICAgKiB0aGUgZmFpbHVyZSBpc24ndCBjb21wbGV0ZWx5IHNpbGVudCBvbiBOb2RlIDI0KyB3aGVyZSB0aGUgZGVmYXVsdFxuICAgKiBiZWhhdmlvciBvZiBgdW5oYW5kbGVkUmVqZWN0aW9uYCBpcyB0byB0ZXJtaW5hdGUgdGhlIHByb2Nlc3MuIEFuXG4gICAqIGFwcCB0aGF0IHNlZXMgaXRzIHNlcnZlciBzdWRkZW5seSBleGl0IG5lZWRzIGF0IGxlYXN0IG9uZVxuICAgKiBicmVhZGNydW1iIGluIHRoZSBsb2dzIHRvIGtub3cgQmVhY29uIHdhcyB0aGUgY2F1c2U7IHRoZSBwcmV2aW91c1xuICAgKiBiZWhhdmlvciBsZWZ0IGEgc3RhY2stb25seSBjcmFzaCB3aXRoIG5vIGNvbnRleHQgdHlpbmcgaXQgYmFjayB0b1xuICAgKiB0aGUgYnJva2VyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJiZWFjb24tY29ubmVjdFwiIHwgXCJiZWFjb24tZGlzY29ubmVjdFwifSBhcmdzLnN0YWdlIC0gRmFpbHVyZSBzdGFnZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRCZWFjb25FcnJvcih7c3RhZ2UsIGVycm9yfSkge1xuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5fZXJyb3JFdmVudHNcbiAgICBjb25zdCBoYXNMaXN0ZW5lciA9IGVycm9yRXZlbnRzLmxpc3RlbmVyQ291bnQoXCJmcmFtZXdvcmstZXJyb3JcIikgPiAwXG4gICAgICB8fCBlcnJvckV2ZW50cy5saXN0ZW5lckNvdW50KFwiYWxsLWVycm9yXCIpID4gMFxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7c3RhZ2V9LFxuICAgICAgZXJyb3JcbiAgICB9XG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcblxuICAgIGlmICghaGFzTGlzdGVuZXIpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcilcblxuXG4gICAgICBjb25zb2xlLmVycm9yKGBbdmVsb2Npb3VzIGZyYW1ld29yay1lcnJvciBzdGFnZT0ke3N0YWdlfV0gJHttZXNzYWdlfSDigJQgcmVnaXN0ZXIgYSBsaXN0ZW5lciB2aWEgY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpLm9uKFwiZnJhbWV3b3JrLWVycm9yXCIsIOKApikgdG8gc3VwcHJlc3MgdGhpcyBzdGRlcnIgZmFsbGJhY2tgKVxuICAgICAgdm9pZCBQcm9taXNlLnJlamVjdChlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoZSBhY3RpdmUgQmVhY29uIGNsaWVudCAoaWYgYW55KS4gU2FmZSB0byBjYWxsIG11bHRpcGxlXG4gICAqIHRpbWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGRpc2Nvbm5lY3RCZWFjb24oKSB7XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5fYmVhY29uQ2xpZW50XG5cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9iZWFjb25Db25uZWN0UHJvbWlzZSA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKHRoaXMuX2JlYWNvblJlcG9ydFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fYmVhY29uUmVwb3J0VGltZXIpXG4gICAgICB0aGlzLl9iZWFjb25SZXBvcnRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHRoaXMuX2JlYWNvbk91dGFnZVJlcG9ydGVkID0gZmFsc2VcbiAgICB0aGlzLl9iZWFjb25MYXN0RG93bkVycm9yID0gdW5kZWZpbmVkXG5cbiAgICBpZiAoY2xpZW50KSBhd2FpdCBjbGllbnQuY2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJvdXRlcyBhIEJlYWNvbi1zb3VyY2VkIGJyb2FkY2FzdCB0aHJvdWdoIHRoZSBzYW1lIGRlbGl2ZXJ5IGNvZGVcbiAgICogcGF0aCBhcyBhIGxvY2FsbHktb3JpZ2luYXRlZCBvbmUuIFByZWZlcnMgdGhlIHdvcmtlcnRocmVhZC1hd2FyZVxuICAgKiBgYnJvYWRjYXN0VjJgIHdoZW4gYW4gSFRUUCBzZXJ2ZXIgaXMgaG9zdGluZyB3b3JrZXJzLCBhbmQgZmFsbHNcbiAgICogYmFjayB0byB0aGUgcGVyLXByb2Nlc3Mgc3Vic2NyaXB0aW9uIGRpc3BhdGNoIG90aGVyd2lzZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2JlYWNvbi90eXBlcy5qc1wiKS5CZWFjb25Ccm9hZGNhc3RNZXNzYWdlfSBtZXNzYWdlIC0gQnJvYWRjYXN0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2RlbGl2ZXJCcm9hZGNhc3RGcm9tQmVhY29uKG1lc3NhZ2UpIHtcbiAgICAvKipcbiAgICAgKiBXZWJzb2NrZXQgZXZlbnRzLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBjb25zdCB3ZWJzb2NrZXRFdmVudHMgPSB0aGlzLl93ZWJzb2NrZXRFdmVudHNcblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB3ZWJzb2NrZXRFdmVudHMuYnJvYWRjYXN0VjIoe1xuICAgICAgICBjaGFubmVsOiBtZXNzYWdlLmNoYW5uZWwsXG4gICAgICAgIGJyb2FkY2FzdFBhcmFtczogbWVzc2FnZS5icm9hZGNhc3RQYXJhbXMsXG4gICAgICAgIGJvZHk6IG1lc3NhZ2UuYm9keSxcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpc1xuICAgICAgfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKG1lc3NhZ2UuY2hhbm5lbCwgbWVzc2FnZS5icm9hZGNhc3RQYXJhbXMsIG1lc3NhZ2UuYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZD59IC0gU2NoZWR1bGVkIGJhY2tncm91bmQgam9icyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgZ2V0U2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWcoKSB7XG4gICAgaWYgKCF0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icykge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NjaGVkdWxlZEJhY2tncm91bmRKb2JzKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JzTG9hZGVyVHlwZSB8IHVuZGVmaW5lZH0gc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMgLSBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JzIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0U2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWcoc2NoZWR1bGVkQmFja2dyb3VuZEpvYnMpIHtcbiAgICB0aGlzLl9zY2hlZHVsZWRCYWNrZ3JvdW5kSm9icyA9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbWFpbGVyIGJhY2tlbmQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTWFpbGVyQmFja2VuZCB8IHVuZGVmaW5lZH0gLSBNYWlsZXIgYmFja2VuZC5cbiAgICovXG4gIGdldE1haWxlckJhY2tlbmQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX21haWxlckJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBtYWlsZXIgYmFja2VuZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTWFpbGVyQmFja2VuZCB8IHVuZGVmaW5lZH0gbWFpbGVyQmFja2VuZCAtIE1haWxlciBiYWNrZW5kLCBvciB1bmRlZmluZWQgdG8gcmVtb3ZlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRNYWlsZXJCYWNrZW5kKG1haWxlckJhY2tlbmQpIHtcbiAgICB0aGlzLl9tYWlsZXJCYWNrZW5kID0gbWFpbGVyQmFja2VuZFxuICB9XG5cbiAgLyoqXG4gICAqIExvZ2dpbmcgY29uZmlndXJhdGlvbiB0YWlsb3JlZCBmb3IgSFRUUCByZXF1ZXN0IGxvZ2dpbmcuIERlZmF1bHRzIGNvbnNvbGUgbG9nZ2luZyB0byB0cnVlIGFuZCBhcHBsaWVzIHRoZSB1c2VyIGBsb2dnaW5nLmNvbnNvbGVgIGZsYWcgb25seSBmb3IgcmVxdWVzdCBsb2dnaW5nLlxuICAgKiBAcmV0dXJucyB7UmVxdWlyZWQ8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiY29uc29sZVwiIHwgXCJmaWxlXCIgfCBcImxldmVsc1wiPj4gJiBQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJkaXJlY3RvcnlcIiB8IFwiZmlsZVBhdGhcIj4gJiBQYXJ0aWFsPFBpY2s8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9uLCBcIm91dHB1dHNcIiB8IFwibG9nZ2Vyc1wiPj59IC0gVGhlIGh0dHAgbG9nZ2luZyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0SHR0cExvZ2dpbmdDb25maWd1cmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldExvZ2dpbmdDb25maWd1cmF0aW9uKHtkZWZhdWx0Q29uc29sZTogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZW52aXJvbm1lbnQgaGFuZGxlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZW52aXJvbm1lbnQtaGFuZGxlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBlbnZpcm9ubWVudCBoYW5kbGVyLlxuICAgKi9cbiAgZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkge1xuICAgIGlmICghdGhpcy5fZW52aXJvbm1lbnRIYW5kbGVyKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBlbnZpcm9ubWVudCBoYW5kbGVyIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2Vudmlyb25tZW50SGFuZGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2FsZSBmYWxsYmFja3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9jYWxlRmFsbGJhY2tzVHlwZSB8IHVuZGVmaW5lZH0gLSBUaGUgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICovXG4gIGdldExvY2FsZUZhbGxiYWNrcygpIHsgcmV0dXJuIHRoaXMubG9jYWxlRmFsbGJhY2tzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbG9jYWxlIGZhbGxiYWNrcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9jYWxlRmFsbGJhY2tzVHlwZX0gbmV3TG9jYWxlRmFsbGJhY2tzIC0gTmV3IGxvY2FsZSBmYWxsYmFja3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldExvY2FsZUZhbGxiYWNrcyhuZXdMb2NhbGVGYWxsYmFja3MpIHsgdGhpcy5sb2NhbGVGYWxsYmFja3MgPSBuZXdMb2NhbGVGYWxsYmFja3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzdHJ1Y3R1cmUgc3FsIGNvbmZpZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TdHJ1Y3R1cmVTcWxDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIFN0cnVjdHVyZSBTUUwgY29uZmlnLlxuICAgKi9cbiAgZ2V0U3RydWN0dXJlU3FsQ29uZmlnKCkgeyByZXR1cm4gdGhpcy5fc3RydWN0dXJlU3FsIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgd3JpdGUgc3RydWN0dXJlIHNxbC5cbiAgICogQHBhcmFtIHt7cmVhc29uPzogXCJtaWdyYXRpb25cIiB8IFwic2NoZW1hRHVtcFwifX0gW2FyZ3NdIC0gQ2FsbCBjb250ZXh0IGZvciB0aGUgc3RydWN0dXJlIHNxbCB3cml0ZSBkZWNpc2lvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdHJ1Y3R1cmUgU1FMIGZpbGVzIHNob3VsZCBiZSBnZW5lcmF0ZWQgZm9yIHRoZSBjdXJyZW50IGVudmlyb25tZW50LlxuICAgKi9cbiAgc2hvdWxkV3JpdGVTdHJ1Y3R1cmVTcWwoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge3JlYXNvbiA9IFwibWlncmF0aW9uXCJ9ID0gYXJnc1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0U3RydWN0dXJlU3FsQ29uZmlnKClcbiAgICBjb25zdCBlbmFibGVkRW52aXJvbm1lbnRzID0gY29uZmlnPy5lbmFibGVkRW52aXJvbm1lbnRzXG4gICAgY29uc3QgZGlzYWJsZWRFbnZpcm9ubWVudHMgPSBjb25maWc/LmRpc2FibGVkRW52aXJvbm1lbnRzXG5cbiAgICBpZiAocmVhc29uID09PSBcInNjaGVtYUR1bXBcIikge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShlbmFibGVkRW52aXJvbm1lbnRzKSkge1xuICAgICAgcmV0dXJuIGVuYWJsZWRFbnZpcm9ubWVudHMuaW5jbHVkZXModGhpcy5nZXRFbnZpcm9ubWVudCgpKVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGRpc2FibGVkRW52aXJvbm1lbnRzKSAmJiBkaXNhYmxlZEVudmlyb25tZW50cy5pbmNsdWRlcyh0aGlzLmdldEVudmlyb25tZW50KCkpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIikge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBzdHJ1Y3R1cmUgc3FsIGNvbmZpZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU3RydWN0dXJlU3FsQ29uZmlndXJhdGlvbn0gc3RydWN0dXJlU3FsIC0gU3RydWN0dXJlIFNRTCBjb25maWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFN0cnVjdHVyZVNxbENvbmZpZyhzdHJ1Y3R1cmVTcWwpIHtcbiAgICB0aGlzLl9zdHJ1Y3R1cmVTcWwgPSBzdHJ1Y3R1cmVTcWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGxvY2FsZS5cbiAgICovXG4gIGdldExvY2FsZSgpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMubG9jYWxlID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHRoaXMubG9jYWxlKClcbiAgICB9IGVsc2UgaWYgKHRoaXMubG9jYWxlKSB7XG4gICAgICByZXR1cm4gdGhpcy5sb2NhbGVcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0TG9jYWxlcygpWzBdXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2FsZXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBsb2NhbGVzLlxuICAgKi9cbiAgZ2V0TG9jYWxlcygpIHsgcmV0dXJuIGRpZ2codGhpcywgXCJsb2NhbGVzXCIpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFRoZSBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3MobmFtZSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLm1vZGVsQ2xhc3Nlc1tuYW1lXVxuXG4gICAgaWYgKCFtb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggbW9kZWwgY2xhc3MgJHtuYW1lfSBpbiAke09iamVjdC5rZXlzKHRoaXMubW9kZWxDbGFzc2VzKS5qb2luKFwiLCBcIil9fWApXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IEEgaGFzaCBvZiBhbGwgbW9kZWwgY2xhc3Nlcywga2V5ZWQgYnkgbW9kZWwgbmFtZSwgYXMgdGhleSB3ZXJlIGRlZmluZWQgaW4gdGhlIGNvbmZpZ3VyYXRpb24uIFRoaXMgaXMgYSBkaXJlY3QgcmVmZXJlbmNlIHRvIHRoZSBtb2RlbCBjbGFzc2VzLCBub3QgYSBjb3B5LlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzc2VzKCkge1xuICAgIHJldHVybiB0aGlzLm1vZGVsQ2xhc3Nlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3RpbmcuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IFRoZSBwYXRoIHRvIGEgY29uZmlnIGZpbGUgdGhhdCBzaG91bGQgYmUgdXNlZCBmb3IgdGVzdGluZy5cbiAgICovXG4gIGdldFRlc3RpbmcoKSB7IHJldHVybiB0aGlzLl90ZXN0aW5nIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJ1c3RlZCBwcm94aWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9IFRydXN0ZWQgcmV2ZXJzZSBwcm94eSBhZGRyZXNzIHJhbmdlcy5cbiAgICovXG4gIGdldFRydXN0ZWRQcm94aWVzKCkgeyByZXR1cm4gdGhpcy5fdHJ1c3RlZFByb3hpZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0cnVzdGVkIHByb3hpZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9IHRydXN0ZWRQcm94aWVzIC0gVHJ1c3RlZCByZXZlcnNlIHByb3h5IGFkZHJlc3MgcmFuZ2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFRydXN0ZWRQcm94aWVzKHRydXN0ZWRQcm94aWVzKSB7IHRoaXMuX3RydXN0ZWRQcm94aWVzID0gdHJ1c3RlZFByb3hpZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgZGF0YWJhc2UgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtpZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIgdG8gaW5pdGlhbGl6ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgaW5pdGlhbGl6ZURhdGFiYXNlUG9vbChpZGVudGlmaWVyID0gXCJkZWZhdWx0XCIpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2UpIHRocm93IG5ldyBFcnJvcihcIk5vICdkYXRhYmFzZScgd2FzIGdpdmVuXCIpXG4gICAgaWYgKHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXSkgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2VQb29sIGhhcyBhbHJlYWR5IGJlZW4gaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IFBvb2xUeXBlID0gdGhpcy5nZXREYXRhYmFzZVBvb2xUeXBlKGlkZW50aWZpZXIpXG5cbiAgICB0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0gPSBuZXcgUG9vbFR5cGUoe2NvbmZpZ3VyYXRpb246IHRoaXMsIGlkZW50aWZpZXJ9KVxuICAgIHRoaXMuZGF0YWJhc2VQb29sc1tpZGVudGlmaWVyXS5zZXRDdXJyZW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGRhdGFiYXNlIHBvb2wgaW5pdGlhbGl6ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbaWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGRhdGFiYXNlIHBvb2wgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBpc0RhdGFiYXNlUG9vbEluaXRpYWxpemVkKGlkZW50aWZpZXIgPSBcImRlZmF1bHRcIikgeyByZXR1cm4gQm9vbGVhbih0aGlzLmRhdGFiYXNlUG9vbHNbaWRlbnRpZmllcl0pIH1cblxuICAvKipcbiAgICogUnVucyBpcyBpbml0aWFsaXplZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpbml0aWFsaXplZC5cbiAgICovXG4gIGlzSW5pdGlhbGl6ZWQoKSB7IHJldHVybiB0aGlzLl9pc0luaXRpYWxpemVkIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIG1vZGVscy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFR5cGUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemVNb2RlbHMoYXJncyA9IHt0eXBlOiBcInNlcnZlclwifSkge1xuICAgIGNvbnN0IG1vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID0gdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgIGlmICh0aGlzLl9tb2RlbHNJbml0aWFsaXplZCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlKSB7XG4gICAgICBjb25zdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9IHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlXG5cbiAgICAgIGF3YWl0IGluaXRpYWxpemVNb2RlbHNQcm9taXNlXG5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiA9PT0gbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb24gJiYgIXRoaXMuX21vZGVsc0luaXRpYWxpemVkKSB7XG4gICAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2UpIHtcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZU1vZGVscyhhcmdzKVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBpbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzaG91bGRTa2lwRHVtbXlNb2RlbEluaXRpYWxpemF0aW9uID0gZ2xvYmFsVGhpcy5wcm9jZXNzPy5lbnYuVkVMT0NJT1VTX1NLSVBfRFVNTVlfTU9ERUxfSU5JVElBTElaQVRJT04gPT09IFwiMVwiXG4gICAgICAgICYmIGdsb2JhbFRoaXMucHJvY2Vzcz8uZW52LlZFTE9DSU9VU19CUk9XU0VSX1RFU1RTID09PSBcInRydWVcIlxuICAgICAgICAmJiB0aGlzLmdldEVudmlyb25tZW50KCkgPT09IFwidGVzdFwiXG5cbiAgICAgIGlmICghc2hvdWxkU2tpcER1bW15TW9kZWxJbml0aWFsaXphdGlvbikge1xuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZU1vZGVscykge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2luaXRpYWxpemVNb2RlbHMoe2NvbmZpZ3VyYXRpb246IHRoaXMsIHR5cGU6IGFyZ3MudHlwZX0pXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmluaXRpYWxpemVQYWNrYWdlTW9kZWxzKHRoaXMpXG4gICAgICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGVkTW9kZWxSZWxhdGlvbnNoaXBzKHRoaXMpXG5cbiAgICAgICAgYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbml0aWFsaXplRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnModGhpcylcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID09PSBtb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgICB0aGlzLl9tb2RlbHNJbml0aWFsaXplZCA9IHRydWVcbiAgICAgIH1cbiAgICB9KSgpXG5cbiAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9IGluaXRpYWxpemVNb2RlbHNQcm9taXNlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgaW5pdGlhbGl6ZU1vZGVsc1Byb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVNb2RlbHNQcm9taXNlID09PSBpbml0aWFsaXplTW9kZWxzUHJvbWlzZSkge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplTW9kZWxzUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGVhY2ggY29uZmlndXJlZCBkYXRhYmFzZSBwb29sIGhhcyBhIGdsb2JhbCBjb25uZWN0aW9uIGF2YWlsYWJsZS5cbiAgICogVXNlZnVsIHdoZW4gYGdldEN1cnJlbnRDb25uZWN0aW9uYCBtaWdodCBiZSBjYWxsZWQgd2l0aG91dCBhbiBhc3luYyBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlR2xvYmFsQ29ubmVjdGlvbnMoKSB7XG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgICBjb25zdCBwb29sID0gdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgYXdhaXQgcG9vbC5lbnN1cmVHbG9iYWxDb25uZWN0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgaW5pdGlhbGl6ZSh7dHlwZX0gPSB7dHlwZTogXCJ1bmRlZmluZWRcIn0pIHtcbiAgICBpZiAodGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UpIHJldHVybiB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuXG4gICAgaWYgKHRoaXMuX3NodXRkb3duUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3F1ZXVlSW5pdGlhbGl6ZSh7Y29udGludWVBZnRlcldhaXRGYWlsdXJlOiB0cnVlLCB0eXBlLCB3YWl0Rm9yOiB0aGlzLl9zaHV0ZG93blByb21pc2V9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IGZhbHNlLCB0eXBlLCB3YWl0Rm9yOiB0aGlzLl9jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNQcm9taXNlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYmVnaW5Jbml0aWFsaXplKHt0eXBlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgb3Igam9pbnMgaW5pdGlhbGl6YXRpb24gYWZ0ZXIgbGlmZWN5Y2xlIGJsb2NrZXJzIGhhdmUgc2V0dGxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTdGFydHVwIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBHZW5lcmljIGFwcGxpY2F0aW9uIHByb2Nlc3MgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2hhcmVkIHN0YXJ0dXAgcHJvbWlzZS5cbiAgICovXG4gIF9iZWdpbkluaXRpYWxpemUoe3R5cGV9KSB7XG4gICAgY29uc3QgaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID0gdGhpcy5fbW9kZWxJbml0aWFsaXphdGlvbkdlbmVyYXRpb25cblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSAmJiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPT09IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvbikge1xuICAgICAgcmV0dXJuIHRoaXMuX2luaXRpYWxpemVQcm9taXNlXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcXVldWVJbml0aWFsaXplKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IGZhbHNlLCB0eXBlLCB3YWl0Rm9yOiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZX0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2lzSW5pdGlhbGl6ZWQpIHtcbiAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IGluaXRpYWxpemF0aW9uR2VuZXJhdGlvblxuXG4gICAgICByZXR1cm4gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcbiAgICB9XG4gICAgLy8gTWVtb2l6ZSB0aGUgaW4tcHJvZ3Jlc3MgaW5pdGlhbGl6YXRpb24gc28gY29uY3VycmVudCBjYWxsZXJzIGF3YWl0IHRoZSBzYW1lXG4gICAgLy8gYm9vdHN0cmFwIGluc3RlYWQgb2YgcmFjaW5nLiBgX2lzSW5pdGlhbGl6ZWRgIHdhcyBwcmV2aW91c2x5IHNldCB0byBgdHJ1ZWBcbiAgICAvLyB1cCBmcm9udCwgc28gYSBzZWNvbmQgY2FsbGVyIChlLmcuIGEgcG9vbGVkIHJ1bm5lciB3aXRoXG4gICAgLy8gYHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID4gMWAgc3RhcnRpbmcgc2V2ZXJhbCBqb2JzIG9uIGEgY29sZCBjaGlsZCkgY291bGRcbiAgICAvLyBza2lwIGluaXRpYWxpemF0aW9uIGFuZCBsb2FkIG1vZGVscyAvIHBlcmZvcm0gYSBqb2Igd2hpbGUgdGhlIGZpcnN0IGNhbGxcbiAgICAvLyB3YXMgc3RpbGwgYXdhaXRpbmcgbW9kZWwgZGlzY292ZXJ5IGFuZCBpbml0aWFsaXplcnMuIE1pcnJvcnMgY29ubmVjdEJlYWNvbi5cbiAgICBjb25zdCBpbml0aWFsaXplUHJvbWlzZSA9IHRoaXMuX3J1bkluaXRpYWxpemUoe2luaXRpYWxpemF0aW9uR2VuZXJhdGlvbiwgdHlwZX0pXG5cbiAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IGluaXRpYWxpemVQcm9taXNlXG4gICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2VHZW5lcmF0aW9uID0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uXG5cbiAgICByZXR1cm4gaW5pdGlhbGl6ZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZXMgb25lIHNoYXJlZCBpbml0aWFsaXphdGlvbiBiZWhpbmQgYW4gaW5jb21wYXRpYmxlIGxpZmVjeWNsZSBwaGFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBRdWV1ZSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY29udGludWVBZnRlcldhaXRGYWlsdXJlIC0gV2hldGhlciBhIGNvbXBsZXRlZCBmYWlsZWQgc2h1dGRvd24gc3RpbGwgcGVybWl0cyByZXBsYWNlbWVudCBzdGFydHVwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gUmVwbGFjZW1lbnQgcHJvY2VzcyB0eXBlLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IGFyZ3Mud2FpdEZvciAtIExpZmVjeWNsZSBwaGFzZSB0aGF0IG11c3Qgc2V0dGxlIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTaGFyZWQgcXVldWVkIHN0YXJ0dXAgcHJvbWlzZS5cbiAgICovXG4gIF9xdWV1ZUluaXRpYWxpemUoe2NvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSwgdHlwZSwgd2FpdEZvcn0pIHtcbiAgICBpZiAodGhpcy5fcXVldWVkSW5pdGlhbGl6ZVByb21pc2UpIHJldHVybiB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZVxuXG4gICAgY29uc3QgcXVldWVkSW5pdGlhbGl6ZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fd2FpdEZvckluaXRpYWxpemVCbG9ja2VyKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmUsIHdhaXRGb3J9KVxuXG4gICAgICBpZiAodGhpcy5fc2h1dGRvd25Qcm9taXNlID09PSB3YWl0Rm9yKSB0aGlzLl9zaHV0ZG93blByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9PT0gd2FpdEZvcikge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2h1dGRvd25Qcm9taXNlID0gdGhpcy5fc2h1dGRvd25Qcm9taXNlXG5cbiAgICAgIGlmIChzaHV0ZG93blByb21pc2UpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fd2FpdEZvckluaXRpYWxpemVCbG9ja2VyKHtjb250aW51ZUFmdGVyV2FpdEZhaWx1cmU6IHRydWUsIHdhaXRGb3I6IHNodXRkb3duUHJvbWlzZX0pXG4gICAgICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UgPT09IHNodXRkb3duUHJvbWlzZSkgdGhpcy5fc2h1dGRvd25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUHJvbWlzZSAmJiB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gIT09IHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIGNvbnN0IHN0YWxlSW5pdGlhbGl6ZVByb21pc2UgPSB0aGlzLl9pbml0aWFsaXplUHJvbWlzZVxuXG4gICAgICAgIGF3YWl0IHN0YWxlSW5pdGlhbGl6ZVByb21pc2VcbiAgICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVQcm9taXNlID09PSBzdGFsZUluaXRpYWxpemVQcm9taXNlKSB7XG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9iZWdpbkluaXRpYWxpemUoe3R5cGV9KVxuICAgIH0pKCkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIH0pXG5cbiAgICB0aGlzLl9xdWV1ZWRJbml0aWFsaXplUHJvbWlzZSA9IHF1ZXVlZEluaXRpYWxpemVQcm9taXNlXG5cbiAgICByZXR1cm4gcXVldWVkSW5pdGlhbGl6ZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYSBsaWZlY3ljbGUgcGhhc2UgYmVmb3JlIHF1ZXVlZCBpbml0aWFsaXphdGlvbiBwcm9jZWVkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBXYWl0IHBvbGljeS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmNvbnRpbnVlQWZ0ZXJXYWl0RmFpbHVyZSAtIFdoZXRoZXIgcmVwbGFjZW1lbnQgc3RhcnR1cCByZW1haW5zIGF2YWlsYWJsZSBhZnRlciBhIGZhaWxlZCBwaGFzZS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBhcmdzLndhaXRGb3IgLSBMaWZlY3ljbGUgcGhhc2UgdGhhdCBtdXN0IHNldHRsZSBmaXJzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBxdWV1ZWQgaW5pdGlhbGl6YXRpb24gbWF5IGNvbnRpbnVlLlxuICAgKi9cbiAgYXN5bmMgX3dhaXRGb3JJbml0aWFsaXplQmxvY2tlcih7Y29udGludWVBZnRlcldhaXRGYWlsdXJlLCB3YWl0Rm9yfSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3YWl0Rm9yXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghY29udGludWVBZnRlcldhaXRGYWlsdXJlKSB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBhdG9taWMgZnJhbWV3b3JrIGFuZCBhcHBsaWNhdGlvbiBpbml0aWFsaXphdGlvbiBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEluaXRpYWxpemF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5pbml0aWFsaXphdGlvbkdlbmVyYXRpb24gLSBGcmFtZXdvcmsgbW9kZWwgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIEdlbmVyaWMgYXBwbGljYXRpb24gcHJvY2VzcyB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGluaXRpYWxpemVkLlxuICAgKi9cbiAgYXN5bmMgX3J1bkluaXRpYWxpemUoe2luaXRpYWxpemF0aW9uR2VuZXJhdGlvbiwgdHlwZX0pIHtcbiAgICBjb25zdCBzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSA9ICF0aGlzLl9hcHBsaWNhdGlvbkxpZmVjeWNsZUluaXRpYWxpemVkXG5cbiAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHtcbiAgICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSBPYmplY3QuZnJlZXplKHtcbiAgICAgICAgaW5zdGFuY2VJZDogbmV3IFVVSUQoNCkuZm9ybWF0KCksXG4gICAgICAgIHR5cGVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZU1vZGVscyh7dHlwZX0pXG5cbiAgICAgIC8vIE1vZGVsIGluaXRpYWxpemF0aW9uIGNhbiBiZSBpbnZhbGlkYXRlZCBieSBhIGNvbmN1cnJlbnQgY29ubmVjdGlvbiBjbG9zZS5cbiAgICAgIC8vIElmIG1vZGVscyBhcmUgbm90IHJlYWR5LCBzdG9wIHdpdGhvdXQgbWFya2luZyB0aGUgY29uZmlndXJhdGlvbiBpbml0aWFsaXplZFxuICAgICAgLy8gc28gdGhlIG5leHQgY2FsbGVyIHJldHJpZXMgYSBmdWxsIGJvb3RzdHJhcC5cbiAgICAgIGlmICh0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiAhPT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uIHx8ICF0aGlzLl9tb2RlbHNJbml0aWFsaXplZCkge1xuICAgICAgICBpZiAoc3RhcnRzQXBwbGljYXRpb25MaWZlY3ljbGUpIHRoaXMuX3Jlc2V0QXBwbGljYXRpb25MaWZlY3ljbGUoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5hdXRvRGlzY292ZXJSZXNvdXJjZXModGhpcylcbiAgICAgIHRoaXMuX21lcmdlRGlzY292ZXJlZEFiaWxpdHlSZXNvdXJjZXMoKVxuICAgICAgdGhpcy5fdmFsaWRhdGVSZXNvdXJjZVJlbGF0aW9uc2hpcHNPbk1vZGVscygpXG5cbiAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSAmJiB0aGlzLl9pbml0aWFsaXplcnMpIHtcbiAgICAgICAgY29uc3QgaW5pdGlhbGl6ZXJzID0gYXdhaXQgdGhpcy5faW5pdGlhbGl6ZXJzKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgICAgY29uc3Qge3JlcXVpcmVDb250ZXh0LCAuLi5yZXN0QXJnc30gPSBpbml0aWFsaXplcnNcblxuICAgICAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgICAgIGlmIChyZXF1aXJlQ29udGV4dCkge1xuICAgICAgICAgIGZvciAoY29uc3QgaW5pdGlhbGl6ZXJLZXkgb2YgcmVxdWlyZUNvbnRleHQua2V5cygpKSB7XG4gICAgICAgICAgICBjb25zdCBJbml0aWFsaXplckNsYXNzID0gcmVxdWlyZUNvbnRleHQoaW5pdGlhbGl6ZXJLZXkpLmRlZmF1bHRcbiAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NDb250ZXh0ID0gdGhpcy5fYXBwbGljYXRpb25Qcm9jZXNzQ29udGV4dFxuXG4gICAgICAgICAgICBpZiAoIXByb2Nlc3NDb250ZXh0KSB0aHJvdyBuZXcgRXJyb3IoXCJBcHBsaWNhdGlvbiBwcm9jZXNzIGNvbnRleHQgaXMgbm90IGF2YWlsYWJsZSBkdXJpbmcgaW5pdGlhbGl6ZXIgc3RhcnR1cFwiKVxuXG4gICAgICAgICAgICBjb25zdCBpbml0aWFsaXplckluc3RhbmNlID0gbmV3IEluaXRpYWxpemVyQ2xhc3Moe2NvbmZpZ3VyYXRpb246IHRoaXMsIHByb2Nlc3NDb250ZXh0LCB0eXBlfSlcblxuICAgICAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZXJJbnN0YW5jZS5ydW4oKVxuICAgICAgICAgICAgdGhpcy5fc3VjY2Vzc2Z1bEluaXRpYWxpemVycy5wdXNoKGluaXRpYWxpemVySW5zdGFuY2UpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChzdGFydHNBcHBsaWNhdGlvbkxpZmVjeWNsZSkgdGhpcy5fYXBwbGljYXRpb25MaWZlY3ljbGVJbml0aWFsaXplZCA9IHRydWVcblxuICAgICAgaWYgKHRoaXMuX21vZGVsSW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uID09PSBpbml0aWFsaXphdGlvbkdlbmVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5faXNJbml0aWFsaXplZCA9IHRydWVcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHN0YXJ0c0FwcGxpY2F0aW9uTGlmZWN5Y2xlKSB7XG4gICAgICAgIGxldCB0ZWFyZG93bkVycm9yXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl90ZWFyZG93blN1Y2Nlc3NmdWxJbml0aWFsaXplcnMoKVxuICAgICAgICB9IGNhdGNoIChjYXVnaHRUZWFyZG93bkVycm9yKSB7XG4gICAgICAgICAgdGVhcmRvd25FcnJvciA9IGNhdWdodFRlYXJkb3duRXJyb3JcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICB0aGlzLl9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0ZWFyZG93bkVycm9yIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICBbZXJyb3IsIC4uLnRlYXJkb3duRXJyb3IuZXJyb3JzXSxcbiAgICAgICAgICAgIFwiQXBwbGljYXRpb24gcHJvY2VzcyBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgICApXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGVhcmRvd25FcnJvciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgICAgW2Vycm9yLCB0ZWFyZG93bkVycm9yXSxcbiAgICAgICAgICAgIFwiQXBwbGljYXRpb24gcHJvY2VzcyBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc0luaXRpYWxpemVkICYmIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9PT0gaW5pdGlhbGl6YXRpb25HZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVQcm9taXNlR2VuZXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWFycyBkb3duIGV2ZXJ5IHN1Y2Nlc3NmdWxseSBzdGFydGVkIGluaXRpYWxpemVyIGluIHJldmVyc2Ugb3JkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgdGVhcmRvd24gc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfdGVhcmRvd25TdWNjZXNzZnVsSW5pdGlhbGl6ZXJzKCkge1xuICAgIGNvbnN0IHN1Y2Nlc3NmdWxJbml0aWFsaXplcnMgPSB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzLnNwbGljZSgwKS5yZXZlcnNlKClcblxuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJBcHBsaWNhdGlvbiBpbml0aWFsaXplciB0ZWFyZG93biBmYWlsZWRcIixcbiAgICAgIHN0ZXBzOiBzdWNjZXNzZnVsSW5pdGlhbGl6ZXJzLm1hcCgoaW5pdGlhbGl6ZXIpID0+IGFzeW5jICgpID0+IGF3YWl0IGluaXRpYWxpemVyLnRlYXJkb3duKCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKiBDbGVhcnMgYXBwbGljYXRpb24tb3duZWQgbGlmZWN5Y2xlIHN0YXRlIGFmdGVyIGV2ZXJ5IHRlYXJkb3duIGF0dGVtcHQuICovXG4gIF9yZXNldEFwcGxpY2F0aW9uTGlmZWN5Y2xlKCkge1xuICAgIHRoaXMuX2FwcGxpY2F0aW9uTGlmZWN5Y2xlSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2FwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHQgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zdWNjZXNzZnVsSW5pdGlhbGl6ZXJzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWFycyBkb3duIHRoZSBjdXJyZW50IGFwcGxpY2F0aW9uIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBFeGFjdCBzaGFyZWQgc2h1dGRvd24gcHJvbWlzZS5cbiAgICovXG4gIHNodXRkb3duKCkge1xuICAgIGlmICh0aGlzLl9zaHV0ZG93blByb21pc2UpIHJldHVybiB0aGlzLl9zaHV0ZG93blByb21pc2VcblxuICAgIGNvbnN0IGluaXRpYWxpemVQcm9taXNlID0gdGhpcy5faW5pdGlhbGl6ZVByb21pc2VcbiAgICBjb25zdCBzaHV0ZG93blByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKGluaXRpYWxpemVQcm9taXNlKSBhd2FpdCBpbml0aWFsaXplUHJvbWlzZVxuICAgICAgICBhd2FpdCB0aGlzLl90ZWFyZG93blN1Y2Nlc3NmdWxJbml0aWFsaXplcnMoKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fcmVzZXRBcHBsaWNhdGlvbkxpZmVjeWNsZSgpXG4gICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPT09IGluaXRpYWxpemVQcm9taXNlKSB7XG4gICAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgICAgICB0aGlzLl9pbml0aWFsaXplUHJvbWlzZUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pKClcblxuICAgIHRoaXMuX3NodXRkb3duUHJvbWlzZSA9IHNodXRkb3duUHJvbWlzZVxuXG4gICAgcmV0dXJuIHNodXRkb3duUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGF0IHJlc291cmNlLWRlZmluZWQgcmVsYXRpb25zaGlwcyBhcmUgYWxzbyBkZWZpbmVkIG9uIHRoZSBjb3JyZXNwb25kaW5nIG1vZGVsIGNsYXNzZXMuXG4gICAqIFRocm93cyBhbiBlcnJvciBpZiBhIHJlbGF0aW9uc2hpcCBpcyBkZWZpbmVkIG9uIGEgcmVzb3VyY2UgYnV0IG1pc3NpbmcgZnJvbSB0aGUgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlUmVzb3VyY2VSZWxhdGlvbnNoaXBzT25Nb2RlbHMoKSB7XG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLl9iYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgICAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb25dIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlcykpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDb25maWc/LnJlbGF0aW9uc2hpcHMpIGNvbnRpbnVlXG5cbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc291cmNlQ29uZmlnLnJlbGF0aW9uc2hpcHMpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSBmb3IgJHttb2RlbE5hbWV9IGRlZmluZXMgcmVsYXRpb25zaGlwcyBhcyBhbiBvYmplY3QuIFVzZSBhbiBhcnJheSBpbnN0ZWFkOiBzdGF0aWMgcmVsYXRpb25zaGlwcyA9ICR7SlNPTi5zdHJpbmdpZnkoT2JqZWN0LmtleXMocmVzb3VyY2VDb25maWcucmVsYXRpb25zaGlwcykpfWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKCFyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSBmb3IgJHttb2RlbE5hbWV9IG11c3QgYmUgYSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICAgICAgY29uc3QgZXhpc3RpbmdSZWxhdGlvbnNoaXBzID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClcblxuICAgICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgcmVzb3VyY2VDb25maWcucmVsYXRpb25zaGlwcykge1xuICAgICAgICAgIGlmICghKHJlbGF0aW9uc2hpcE5hbWUgaW4gZXhpc3RpbmdSZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICBgUmVzb3VyY2UgZm9yICR7bW9kZWxOYW1lfSBkZWZpbmVzIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBidXQgJHttb2RlbE5hbWV9IG1vZGVsIGRvZXMgbm90LiBgICtcbiAgICAgICAgICAgICAgYEFkZCAke21vZGVsTmFtZX0uYmVsb25nc1RvKFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiLCAuLi4pIG9yIHRoZSBhcHByb3ByaWF0ZSByZWxhdGlvbnNoaXAgY2FsbCBvbiB0aGUgbW9kZWwgY2xhc3MuYFxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlZ2lzdGVyTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgdGhpcy5tb2RlbENsYXNzZXNbbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKV0gPSBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY3VycmVudC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Q3VycmVudCgpIHtcbiAgICBzZXRDdXJyZW50Q29uZmlndXJhdGlvbih0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJvdXRlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIHJvdXRlcy5cbiAgICovXG4gIGdldFJvdXRlcygpIHsgcmV0dXJuIHRoaXMuX3JvdXRlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHJvdXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0fSBuZXdSb3V0ZXMgLSBOZXcgcm91dGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRSb3V0ZXMobmV3Um91dGVzKSB7XG4gICAgdGhpcy5fcm91dGVzID0gbmV3Um91dGVzXG4gICAgdGhpcy5fYXBwbHlSb3V0ZU1vdW50cyhuZXdSb3V0ZXMpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhbnkgYHJvdXRlLm1vdW50KC4uLilgIHJlZ2lzdHJhdGlvbnMgZnJvbSB0aGUgcm91dGVzIGZpbGUgYnkgbGV0dGluZ1xuICAgKiBlYWNoIG1vdW50YWJsZSByZWdpc3RlciBpdHMgcm91dGVzICh0eXBpY2FsbHkgcm91dGUtcmVzb2x2ZXIgaG9va3MpIGFnYWluc3RcbiAgICogdGhpcyBjb25maWd1cmF0aW9uLiBHdWFyZGVkIHNvIHJlcGVhdGVkIHNldFJvdXRlcyBjYWxscyB3aXRoIHRoZSBzYW1lIHJvdXRlc1xuICAgKiBkb24ndCByZWdpc3RlciBhIG1vdW50IG1vcmUgdGhhbiBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHR9IG5ld1JvdXRlcyAtIFJvdXRlcyBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FwcGx5Um91dGVNb3VudHMobmV3Um91dGVzKSB7XG4gICAgaWYgKCFuZXdSb3V0ZXMgfHwgdHlwZW9mIG5ld1JvdXRlcy5nZXRNb3VudHMgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IG1vdW50IG9mIG5ld1JvdXRlcy5nZXRNb3VudHMoKSkge1xuICAgICAgaWYgKHRoaXMuX2FwcGxpZWRSb3V0ZU1vdW50cy5oYXMobW91bnQpKSBjb250aW51ZVxuXG4gICAgICB0aGlzLl9hcHBsaWVkUm91dGVNb3VudHMuYWRkKG1vdW50KVxuICAgICAgbW91bnQubW91bnRhYmxlLm1vdW50SW50byh7Y29uZmlndXJhdGlvbjogdGhpcywgLi4ubW91bnQub3B0aW9uc30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgcGx1Z2luL2xpYnJhcnkgcm91dGVzIHVzaW5nIGEgbGlnaHR3ZWlnaHQgcm91dGUgRFNMIGJhY2tlZCBieSByb3V0ZSByZXNvbHZlciBob29rcy5cbiAgICogQHBhcmFtIHsocm91dGVzOiBpbXBvcnQoXCIuL3JvdXRlcy9wbHVnaW4tcm91dGVzLmpzXCIpLmRlZmF1bHQpID0+IHZvaWR9IGNhbGxiYWNrIC0gUm91dGVzIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByb3V0ZXMoY2FsbGJhY2spIHtcbiAgICBjb25zdCBwbHVnaW5Sb3V0ZXMgPSBuZXcgUGx1Z2luUm91dGVzKHtjb25maWd1cmF0aW9uOiB0aGlzfSlcblxuICAgIGNhbGxiYWNrKHBsdWdpblJvdXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0cmFuc2xhdG9yLlxuICAgKiBAcGFyYW0geyhhcmcxOiBzdHJpbmcsIGFyZzI6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZCkgPT4gc3RyaW5nfSBjYWxsYmFjayAtIFRyYW5zbGF0b3IgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRyYW5zbGF0b3IoY2FsbGJhY2spIHsgdGhpcy5fdHJhbnNsYXRvciA9IGNhbGxiYWNrIH1cblxuICAvKipcbiAgICogUnVucyBkZWZhdWx0IHRyYW5zbGF0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtc2dJRCAtIE1zZyBpZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzXSAtIFRyYW5zbGF0b3Igb3B0aW9ucyBhbmQgdmFyaWFibGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBkZWZhdWx0IHRyYW5zbGF0b3IuXG4gICAqL1xuICBfZGVmYXVsdFRyYW5zbGF0b3IobXNnSUQsIGFyZ3MpIHtcbiAgICB0aGlzLl9jb25maWd1cmVEZWZhdWx0VHJhbnNsYXRvcigpXG5cbiAgICBjb25zdCB0cmFuc2xhdGVBcmdzID0gYXJncyA/IHsuLi5hcmdzfSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHRyYW5zbGF0ZUFyZ3M/LmRlZmF1bHRWYWx1ZVxuICAgIGNvbnN0IGxvY2FsZXMgPSB0cmFuc2xhdGVBcmdzPy5sb2NhbGVzXG5cbiAgICBpZiAodHJhbnNsYXRlQXJncykge1xuICAgICAgZGVsZXRlIHRyYW5zbGF0ZUFyZ3MuZGVmYXVsdFZhbHVlXG4gICAgICBkZWxldGUgdHJhbnNsYXRlQXJncy5sb2NhbGVzXG4gICAgfVxuXG4gICAgY29uc3QgdmFyaWFibGVzID0gdHJhbnNsYXRlQXJncyAmJiBPYmplY3Qua2V5cyh0cmFuc2xhdGVBcmdzKS5sZW5ndGggPiAwID8gdHJhbnNsYXRlQXJncyA6IHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbG9jYWxlID0gdGhpcy5nZXRMb2NhbGUoKVxuICAgIGNvbnN0IHByZWZlcnJlZExvY2FsZXMgPSBsb2NhbGVzIHx8IChsb2NhbGUgPyB1bmRlZmluZWQgOiBbXSlcbiAgICBjb25zdCBtZXNzYWdlID0gdHJhbnNsYXRlKG1zZ0lELCB2YXJpYWJsZXMsIHByZWZlcnJlZExvY2FsZXMpXG5cbiAgICBpZiAobWVzc2FnZSA9PT0gbXNnSUQgJiYgZGVmYXVsdFZhbHVlKSByZXR1cm4gdHJhbnNsYXRlKGRlZmF1bHRWYWx1ZSwgdmFyaWFibGVzLCBbXSlcblxuICAgIHJldHVybiBtZXNzYWdlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRvci5cbiAgICogQHJldHVybnMgeyhtc2dJRDogc3RyaW5nLCBhcmdzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBzdHJpbmd9IC0gVGhlIGNvbmZpZ3VyZWQgdHJhbnNsYXRvci5cbiAgICovXG4gIGdldFRyYW5zbGF0b3IoKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0b3IpIHJldHVybiB0aGlzLl90cmFuc2xhdG9yXG5cbiAgICBpZiAoIXRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yQm91bmQpIHtcbiAgICAgIHRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yQm91bmQgPSB0aGlzLl9kZWZhdWx0VHJhbnNsYXRvci5iaW5kKHRoaXMpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RlZmF1bHRUcmFuc2xhdG9yQm91bmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmZpZ3VyZSBkZWZhdWx0IHRyYW5zbGF0b3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIENvbmZpZ3VyZSBnZXR0ZXh0IGRlZmF1bHRzIGZvciB0aGlzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfY29uZmlndXJlRGVmYXVsdFRyYW5zbGF0b3IoKSB7XG4gICAgY29uc3QgbG9jYWxlID0gdGhpcy5nZXRMb2NhbGUoKVxuXG4gICAgZ2V0dGV4dENvbmZpZy5zZXRMb2NhbGUobG9jYWxlIHx8IFwiXCIpXG5cbiAgICBjb25zdCBmYWxsYmFja3MgPSBsb2NhbGUgPyB0aGlzLmdldExvY2FsZUZhbGxiYWNrcygpPy5bbG9jYWxlXSA6IFtdXG5cbiAgICBnZXR0ZXh0Q29uZmlnLnNldEZhbGxiYWNrcyhmYWxsYmFja3MgfHwgW10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGltZXpvbmUgb2Zmc2V0IG1pbnV0ZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gVGhlIHRpbWV6b25lIG9mZnNldCBpbiBtaW51dGVzLlxuICAgKi9cbiAgZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5fdGltZXpvbmVPZmZzZXRNaW51dGVzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWRPZmZzZXQgPSB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMoKVxuXG4gICAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWRPZmZzZXQgPT09IFwibnVtYmVyXCIpIHJldHVybiBjb25maWd1cmVkT2Zmc2V0XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLl90aW1lem9uZU9mZnNldE1pbnV0ZXNcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IERhdGUoKS5nZXRUaW1lem9uZU9mZnNldCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGltZSB6b25lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICovXG4gIGdldFRpbWVab25lKCkge1xuICAgIGNvbnN0IHRpbWVab25lID0gdHlwZW9mIHRoaXMuX3RpbWVab25lID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gdGhpcy5fdGltZVpvbmUoKVxuICAgICAgOiB0aGlzLl90aW1lWm9uZVxuXG4gICAgaWYgKHRpbWVab25lID09PSB1bmRlZmluZWQgfHwgdGltZVpvbmUgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImNvbmZpZ3VyYXRpb24gdGltZVpvbmVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtZXZlbnRzLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBldmVudHMuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRFdmVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHdlYnNvY2tldCBldmVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtZXZlbnRzLmpzXCIpLmRlZmF1bHR9IHdlYnNvY2tldEV2ZW50cyAtIFdlYnNvY2tldCBldmVudHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldEV2ZW50cyh3ZWJzb2NrZXRFdmVudHMpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRFdmVudHMgPSB3ZWJzb2NrZXRFdmVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXItcHJvY2VzcyByZWdpc3RyeSBvZiBjaGFubmVsIHN1YnNjcmliZXJzIHVzZWQgYnkgd29ya2VyIGNvZGUgdGhhdFxuICAgKiBuZWVkcyB0byByZWFjdCB0byBldmVudHMgYnJvYWRjYXN0IHZpYSBgd2Vic29ja2V0RXZlbnRzSG9zdC5wdWJsaXNoKC4uLilgXG4gICAqIHdpdGhvdXQgaG9sZGluZyBhbiBhY3R1YWwgd2Vic29ja2V0IHNlc3Npb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLXN1YnNjcmliZXJzLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNoYW5uZWwgc3Vic2NyaWJlcnMgcmVnaXN0cnkuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMoKSB7XG4gICAgaWYgKCF0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMpIHtcbiAgICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyA9IG5ldyBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3ZWJzb2NrZXQgY2hhbm5lbCByZXNvbHZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXJUeXBlIHwgdW5kZWZpbmVkfSAtIFRoZSB3ZWJzb2NrZXQgY2hhbm5lbCByZXNvbHZlci5cbiAgICovXG4gIGdldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYFZlbG9jaW91c1dlYnNvY2tldENvbm5lY3Rpb25gIHN1YmNsYXNzIHVuZGVyIGEgbmFtZS5cbiAgICogQ2xpZW50cyB0aGF0IHNlbmQgYHt0eXBlOiBcImNvbm5lY3Rpb24tb3BlblwiLCBjb25uZWN0aW9uVHlwZTogbmFtZX1gXG4gICAqIHdpbGwgaGF2ZSB0aGlzIGNsYXNzIGluc3RhbnRpYXRlZCBmb3IgdGhlaXIgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDbGllbnQtZmFjaW5nIGNvbm5lY3Rpb24gdHlwZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jb25uZWN0aW9uLmpzXCIpLmRlZmF1bHR9IENvbm5lY3Rpb25DbGFzcyAtIFdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyV2Vic29ja2V0Q29ubmVjdGlvbihuYW1lLCBDb25uZWN0aW9uQ2xhc3MpIHtcbiAgICBpZiAoIW5hbWUpIHRocm93IG5ldyBFcnJvcihcIkNvbm5lY3Rpb24gbmFtZSBpcyByZXF1aXJlZFwiKVxuICAgIGlmICghQ29ubmVjdGlvbkNsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25uZWN0aW9uQ2xhc3MgaXMgcmVxdWlyZWRcIilcbiAgICB0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3Nlcy5zZXQobmFtZSwgQ29ubmVjdGlvbkNsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjb25uZWN0aW9uIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbm5lY3Rpb24gdHlwZSBuYW1lIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFJlZ2lzdGVyZWQgd2Vic29ja2V0IGNvbm5lY3Rpb24gY2xhc3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3MobmFtZSkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3Nlcy5nZXQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbGAgc3ViY2xhc3MgdW5kZXIgYSBuYW1lLlxuICAgKiBDbGllbnRzIHN1YnNjcmliZSB2aWEgYHt0eXBlOiBcImNoYW5uZWwtc3Vic2NyaWJlXCIsIGNoYW5uZWxUeXBlOiBuYW1lLCAuLi59YC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDbGllbnQtZmFjaW5nIGNoYW5uZWwgdHlwZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IENoYW5uZWxDbGFzcyAtIFdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChuYW1lLCBDaGFubmVsQ2xhc3MpIHtcbiAgICBpZiAoIW5hbWUpIHRocm93IG5ldyBFcnJvcihcIkNoYW5uZWwgbmFtZSBpcyByZXF1aXJlZFwiKVxuICAgIGlmICghQ2hhbm5lbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJDaGFubmVsQ2xhc3MgaXMgcmVxdWlyZWRcIilcbiAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5zZXQobmFtZSwgQ2hhbm5lbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBjaGFubmVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSBuYW1lIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFJlZ2lzdGVyZWQgd2Vic29ja2V0IGNoYW5uZWwgY2xhc3MuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRDaGFubmVsQ2xhc3MobmFtZSkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRDaGFubmVsQ2xhc3Nlcy5nZXQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBsaXZlIGNoYW5uZWwgc3Vic2NyaXB0aW9uIGluIHRoZSBnbG9iYWwgcm91dGluZyByZWdpc3RyeS5cbiAgICogQ2FsbGVkIGJ5IHRoZSBzZXNzaW9uIHdoZW4gYGNhblN1YnNjcmliZSgpYCByZXNvbHZlcyB0cnV0aHk7IHRoZVxuICAgKiBzZXNzaW9uIGNhbGxzIGBfdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25gIG9uIHVuc3Vic2NyaWJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENoYW5uZWwgdHlwZSB1c2VkIGFzIHRoZSByb3V0aW5nIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIExpdmUgY2hhbm5lbCBzdWJzY3JpcHRpb24gdG8gcmVnaXN0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihuYW1lLCBzdWJzY3JpcHRpb24pIHtcbiAgICBsZXQgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkge1xuICAgICAgYnVja2V0ID0gbmV3IFNldCgpXG4gICAgICB0aGlzLl93ZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9ucy5zZXQobmFtZSwgYnVja2V0KVxuICAgIH1cblxuICAgIGJ1Y2tldC5hZGQoc3Vic2NyaXB0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdW5yZWdpc3RlciB3ZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ2hhbm5lbCB0eXBlIHVzZWQgYXMgdGhlIHJvdXRpbmcga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gc3Vic2NyaXB0aW9uIC0gTGl2ZSBjaGFubmVsIHN1YnNjcmlwdGlvbiB0byByZW1vdmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKG5hbWUsIHN1YnNjcmlwdGlvbikge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmdldChuYW1lKVxuXG4gICAgaWYgKCFidWNrZXQpIHJldHVyblxuXG4gICAgYnVja2V0LmRlbGV0ZShzdWJzY3JpcHRpb24pXG5cbiAgICBpZiAoYnVja2V0LnNpemUgPT09IDApIHtcbiAgICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb25zLmRlbGV0ZShuYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBgYm9keWAgdG8gZXZlcnkgbGl2ZSBzdWJzY3JpYmVyIG9mIGBuYW1lYCB3aG9zZVxuICAgKiBgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpYCByZXR1cm5zIHRydWUuIFB1cmUgcm91dGluZyDigJQgbm8gYXV0aFxuICAgKiByZS1jaGVjaywgbm8gcGVyc2lzdGVuY2UuIFN1YnNjcmliZXJzIHdobyB3ZXJlIGFkbWl0dGVkIGJ5XG4gICAqIGBjYW5TdWJzY3JpYmUoKWAgY29udGludWUgdG8gcmVjZWl2ZSBicm9hZGNhc3RzIHVudGlsIHRoZXlcbiAgICogdW5zdWJzY3JpYmUgb3IgdGhlIHNlc3Npb24gZW5kcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVcbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtc1xuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5XG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGdyYWNlIHNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gR3JhY2UgcGVyaW9kIChzZWNvbmRzKSBiZWZvcmUgYSBwYXVzZWQgV1Mgc2Vzc2lvbiBpcyB0b3JuIGRvd24uXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzKCkgeyByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGhlYXJ0YmVhdCBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEludGVydmFsIChzZWNvbmRzKSBiZXR3ZWVuIHNlcnZlcuKGkmNsaWVudCBoZWFydGJlYXQgcGluZ3M7IDAgZGlzYWJsZXMgcmVhcGluZy5cbiAgICovXG4gIGdldFdlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzKCkgeyByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBlci1zZXNzaW9uIFdlYlNvY2tldCBpbmJvdW5kIG1lc3NhZ2UgcXVldWUgbGltaXRzLlxuICAgKiBAcmV0dXJucyB7e21heEJ5dGVzOiBudW1iZXIsIG1heE1lc3NhZ2VzOiBudW1iZXJ9fSAtIFBlci1zZXNzaW9uIGluYm91bmQgcXVldWUgaGlnaC13YXRlciBtYXJrcy5cbiAgICovXG4gIGdldFdlYnNvY2tldEluYm91bmRRdWV1ZUxpbWl0cygpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuaHR0cFNlcnZlci53ZWJzb2NrZXRJbmJvdW5kUXVldWVcblxuICAgIHJldHVybiB7XG4gICAgICBtYXhCeXRlczogcXVldWUubWF4UGVuZGluZ0J5dGVzLFxuICAgICAgbWF4TWVzc2FnZXM6IHF1ZXVlLm1heFBlbmRpbmdNZXNzYWdlc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBlci1jbGllbnQgV2ViU29ja2V0IG91dGJvdW5kIHF1ZXVlIGxpbWl0cy5cbiAgICogQHJldHVybnMge3ttYXhCeXRlczogbnVtYmVyLCBtYXhGcmFtZXM6IG51bWJlcn19IC0gUGVyLWNsaWVudCBvdXRib3VuZCBxdWV1ZSBoaWdoLXdhdGVyIG1hcmtzLlxuICAgKi9cbiAgZ2V0V2Vic29ja2V0T3V0Ym91bmRRdWV1ZUxpbWl0cygpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuaHR0cFNlcnZlci53ZWJzb2NrZXRPdXRib3VuZFF1ZXVlXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWF4Qnl0ZXM6IHF1ZXVlLm1heFBlbmRpbmdCeXRlcyxcbiAgICAgIG1heEZyYW1lczogcXVldWUubWF4UGVuZGluZ0ZyYW1lc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB3cmFwcGVyIGludm9rZWQgYXJvdW5kIGV2ZXJ5IFdTLWJvcm5lIHJlcXVlc3QgL1xuICAgKiBjb25uZWN0aW9uIG1lc3NhZ2UgLyBjaGFubmVsIGRpc3BhdGNoLiBUaGUgd3JhcHBlciByZWNlaXZlcyB0aGVcbiAgICogc2Vzc2lvbiBhbmQgYSBgbmV4dGAgY2FsbGJhY2s7IGl0IG11c3QgY2FsbCBgbmV4dCgpYCB0byBydW4gdGhlXG4gICAqIGhhbmRsZXIuIFVzZSBpdCB0byBzZXQgdXAgQXN5bmNMb2NhbFN0b3JhZ2UgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IHdyYXBwZXIgLSBQZXItbWVzc2FnZSBzZXNzaW9uLWNvbnRleHQgd3JhcHBlciwgb3IgbnVsbCB0byBkaXNhYmxlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldEFyb3VuZFJlcXVlc3Qod3JhcHBlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3QgPSB3cmFwcGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgd2Vic29ja2V0IGFyb3VuZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gV2Vic29ja2V0IHNlc3Npb24gd3JhcHBlci5cbiAgICovXG4gIGdldFdlYnNvY2tldEFyb3VuZFJlcXVlc3QoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dlYnNvY2tldEFyb3VuZFJlcXVlc3RcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB3cmFwcGVyIGludm9rZWQgYXJvdW5kIGV2ZXJ5IGNvbnRyb2xsZXIgYWN0aW9uIOKAlCBib3RoXG4gICAqIEhUVFAgYW5kIFdTLWJvcm5lLiBSZWNlaXZlcyBge3JlcXVlc3QsIHJlc3BvbnNlLCBuZXh0fWAgYW5kIG11c3RcbiAgICogY2FsbCBgbmV4dCgpYCB0byBydW4gdGhlIGFjdGlvbi4gVXNlIGl0IGZvciBwZXItcmVxdWVzdCBjb250ZXh0XG4gICAqIGxpa2UgQXN5bmNMb2NhbFN0b3JhZ2Utc2NvcGVkIGxvY2FsZSBvciB0cmFjaW5nLlxuICAgKiBAcGFyYW0geygoY29udGV4dDoge3JlcXVlc3Q6IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQsIHJlc3BvbnNlOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSB3cmFwcGVyIC0gUGVyLWFjdGlvbiByZXF1ZXN0LWNvbnRleHQgd3JhcHBlciwgb3IgbnVsbCB0byBkaXNhYmxlIGl0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEFyb3VuZEFjdGlvbih3cmFwcGVyKSB7XG4gICAgdGhpcy5fYXJvdW5kQWN0aW9uID0gd3JhcHBlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFyb3VuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHsoKGNvbnRleHQ6IHtyZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0LCByZXNwb25zZTogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPn0pID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gLSBIVFRQIHJlcXVlc3Qgd3JhcHBlci5cbiAgICovXG4gIGdldEFyb3VuZEFjdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fYXJvdW5kQWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGFuIGlkZW50aXR5IHJlc29sdmVyIGNhbGxlZCBvbmNlIGF0IHBhdXNlIHRpbWUgYW5kIG9uY2VcbiAgICogYXQgcmVzdW1lIHRpbWUuIFRoZSByZXNvbHZlciByZWNlaXZlcyB0aGUgc2Vzc2lvbiBhbmQgcmV0dXJucyBhbnlcbiAgICogdmFsdWUgdGhhdCBpZGVudGlmaWVzIHRoZSBhdXRoZW50aWNhdGVkIGNhbGxlciDigJQgdHlwaWNhbGx5IGFcbiAgICogYHVzZXJJZGAgcmVhZCBmcm9tIHRoZSBzZXNzaW9uJ3MgdXBncmFkZS1yZXF1ZXN0IGNvb2tpZS4gVmVsb2Npb3VzXG4gICAqIGNhcHR1cmVzIHRoZSBwYXVzZS10aW1lIHZhbHVlIG9uIHRoZSBwYXVzZWQgc2Vzc2lvbiBhbmQgY29tcGFyZXNcbiAgICogaXQgdmlhIGA9PT1gIChvciBkZWVwLWVxdWFsaXR5IGZvciBwbGFpbiBvYmplY3RzKSB0byB0aGUgZnJlc2hcbiAgICogcmVzdW1lLXRpbWUgdmFsdWUuIElmIHRoZXkgZGlmZmVyLCB0aGUgcmVzdW1lIGlzIHJlamVjdGVkIHdpdGhcbiAgICogYHNlc3Npb24tZ29uZWAgYW5kIHRoZSBwYXVzZWQgc2Vzc2lvbiBpcyBkZXN0cm95ZWQgc28gYSBzaWduZWQtb3V0XG4gICAqIG9yIHJlLWF1dGhlbnRpY2F0ZWQgY2xpZW50IGNhbm5vdCByZWNsYWltIGFub3RoZXIgdXNlcidzIHN0YXRlLlxuICAgKlxuICAgKiBSZXR1cm4gYG51bGxgL2B1bmRlZmluZWRgIHRvIG1lYW4gXCJubyBpZGVudGl0eVwiIOKAlCByZXN1bWVzIHN0aWxsXG4gICAqIHN1Y2NlZWQgaWYgcGF1c2UgYW5kIHJlc3VtZSBib3RoIHJlc29sdmUgdG8gYSBudWxsaXNoIHZhbHVlLlxuICAgKiBAcGFyYW0geygoc2Vzc2lvbjogaW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXNlc3Npb24uanNcIikuZGVmYXVsdCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBudWxsfSByZXNvbHZlciAtIEF1dGhlbnRpY2F0ZWQtY2FsbGVyIGlkZW50aXR5IHJlc29sdmVyLCBvciBudWxsIHRvIGRpc2FibGUgaWRlbnRpdHkgY2hlY2tzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyKHJlc29sdmVyKSB7XG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXIgPSByZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBzZXNzaW9uIGlkZW50aXR5IHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7KChzZXNzaW9uOiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IG51bGx9IC0gVGhlIGNvbmZpZ3VyZWQgaWRlbnRpdHkgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fd2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgc2Vzc2lvbiBncmFjZSBzZWNvbmRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gc2Vjb25kcyAtIEdyYWNlIHBlcmlvZCBiZWZvcmUgYSBwYXVzZWQgc2Vzc2lvbiBleHBpcmVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFdlYnNvY2tldFNlc3Npb25HcmFjZVNlY29uZHMoc2Vjb25kcykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNlY29uZHMpIHx8IHNlY29uZHMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZ3JhY2Ugc2Vjb25kczogJHtzZWNvbmRzfWApXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcyA9IHNlY29uZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB3ZWJzb2NrZXQgc2Vzc2lvbiBoZWFydGJlYXQgc2Vjb25kcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBIZWFydGJlYXQgaW50ZXJ2YWwsIHdpdGggemVybyBkaXNhYmxpbmcgcmVhcGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRXZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcyhzZWNvbmRzKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2Vjb25kcykgfHwgc2Vjb25kcyA8IDApIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBoZWFydGJlYXQgc2Vjb25kczogJHtzZWNvbmRzfWApXG4gICAgdGhpcy5fd2Vic29ja2V0U2Vzc2lvbkhlYXJ0YmVhdFNlY29uZHMgPSBzZWNvbmRzXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgYSBzZXNzaW9uIGludG8gdGhlIHBhdXNlZCByZWdpc3RyeSBhbmQgc3RhcnRzIHRoZSBncmFjZVxuICAgKiB0aW1lci4gV2hlbiB0aGUgdGltZXIgZmlyZXMsIHRoZSBzZXNzaW9uJ3MgcGVybWFuZW50IHRlYXJkb3duXG4gICAqIGhvb2sgaXMgaW52b2tlZC4gQ2FsbGVkIGJ5IHRoZSBzZXNzaW9uIGl0c2VsZiBmcm9tIGBfaGFuZGxlQ2xvc2VgXG4gICAqIHdoZW4gdGhlcmUgaXMgcmVzdW1hYmxlIHN0YXRlIChsaXZlIENvbm5lY3Rpb25zIC8gQ2hhbm5lbCBzdWJzKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0fSBzZXNzaW9uIC0gUmVzdW1hYmxlIHNlc3Npb24gdG8gcmV0YWluIGR1cmluZyBpdHMgZ3JhY2UgcGVyaW9kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9wYXVzZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbikge1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHNlc3Npb24uc2Vzc2lvbklkXG5cbiAgICBpZiAoIXNlc3Npb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiU2Vzc2lvbiBtdXN0IGhhdmUgYSBzZXNzaW9uSWQgdG8gYmUgcGF1c2VkXCIpXG4gICAgaWYgKHRoaXMuX3BhdXNlZFdlYnNvY2tldFNlc3Npb25zLmhhcyhzZXNzaW9uSWQpKSByZXR1cm5cblxuICAgIGNvbnN0IGdyYWNlTXMgPSB0aGlzLl93ZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzICogMTAwMFxuICAgIGNvbnN0IGdyYWNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2V4cGlyZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKVxuICAgIH0sIGdyYWNlTXMpXG5cbiAgICAvLyBEb24ndCBrZWVwIHRoZSBwcm9jZXNzIGFsaXZlIHB1cmVseSBmb3IgYSBwYXVzZWQgc2Vzc2lvbiB0aW1lci5cbiAgICBpZiAodHlwZW9mIGdyYWNlVGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgZ3JhY2VUaW1lci51bnJlZigpXG5cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5zZXQoc2Vzc2lvbklkLCB7c2Vzc2lvbiwgZ3JhY2VUaW1lciwgcGF1c2VkQXQ6IERhdGUubm93KCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvb2tzIHVwIGEgcGF1c2VkIHNlc3Npb24gYnkgaWQgKGRvZXMgTk9UIHJlbW92ZSBpdCDigJQgY2FsbGVyIGlzXG4gICAqIGV4cGVjdGVkIHRvIGNhbGwgYF9yZXN1bWVXZWJzb2NrZXRTZXNzaW9uYCB0byBjb21wbGV0ZSB0aGUgaGFuZG9mZikuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHRvIGxvb2sgdXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBQYXVzZWQgc2Vzc2lvbiB3aXRoIHRoZSByZXF1ZXN0ZWQgaWRlbnRpZmllciwgaWYgcHJlc2VudC5cbiAgICovXG4gIF9maW5kUGF1c2VkV2Vic29ja2V0U2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICByZXR1cm4gdGhpcy5fcGF1c2VkV2Vic29ja2V0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCk/LnNlc3Npb24gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBwYXVzZWQgc2Vzc2lvbiBmcm9tIHRoZSByZWdpc3RyeSBhbmQgY2FuY2VscyBpdHMgZ3JhY2VcbiAgICogdGltZXIuIENhbGxlZCBvbiBzdWNjZXNzZnVsIHJlc3VtZSBoYW5kb2ZmIGFuZCBvbiBleHBsaWNpdFxuICAgKiBleHBpcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBQYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyIHRvIHJlbW92ZSBhbmQgY2FuY2VsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbGVhclBhdXNlZFdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICBjbGVhclRpbWVvdXQoZW50cnkuZ3JhY2VUaW1lcilcbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEdyYWNlLXRpbWVyIGNhbGxiYWNrLiBDYWxscyB0aGUgc2Vzc2lvbidzIHBlcm1hbmVudC10ZWFyZG93blxuICAgKiBob29rIGFuZCBkcm9wcyBpdCBmcm9tIHRoZSByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIgd2hvc2UgZ3JhY2UgcGVyaW9kIGV4cGlyZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2V4cGlyZVdlYnNvY2tldFNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICB0aGlzLl9wYXVzZWRXZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKVxuICAgIHRyeSB7XG4gICAgICBlbnRyeS5zZXNzaW9uLl9maW5hbGl6ZUdyYWNlRXhwaXJ5KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGZpbmFsaXplIGV4cGlyZWQgV1Mgc2Vzc2lvbiAke3Nlc3Npb25JZH1gLCBlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBicm9hZGNhc3QgdG8gY2hhbm5lbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIHR5cGUgcmVjZWl2aW5nIHRoZSBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBWYWx1ZXMgdXNlZCB0byBtYXRjaCBlbGlnaWJsZSBzdWJzY3JpcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gQnJvYWRjYXN0IHBheWxvYWQgZGVsaXZlcmVkIHRvIG1hdGNoaW5nIHN1YnNjcmlwdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYnJvYWRjYXN0VG9DaGFubmVsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSkge1xuICAgIC8vIFdoZW4gQmVhY29uIGlzIGNvbm5lY3RlZCwgc2hpcCB0aGUgYnJvYWRjYXN0IG9udG8gdGhlIGJ1cy4gVGhlXG4gICAgLy8gZGFlbW9uIGVjaG9lcyBpdCBiYWNrIHRvIGV2ZXJ5IHBlZXIgKGluY2x1ZGluZyB0aGlzIG9uZSkgYW5kXG4gICAgLy8gZWFjaCBwZWVyJ3MgYF9kZWxpdmVyQnJvYWRjYXN0RnJvbUJlYWNvbmAgcGVyZm9ybXMgdGhlIHNhbWVcbiAgICAvLyBsb2NhbCBkZWxpdmVyeSBhcyB0aGUgc3luY2hyb25vdXMgcGF0aHMgYmVsb3cg4oCUIHNvIGV2ZXJ5XG4gICAgLy8gc3Vic2NyaWJlciwgaW4gYW55IHByb2Nlc3MsIHNlZXMgYnJvYWRjYXN0cyB2aWEgYSBzaW5nbGUgY29kZVxuICAgIC8vIHBhdGguXG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCAmJiB0aGlzLl9iZWFjb25DbGllbnQuaXNDb25uZWN0ZWQoKSkge1xuICAgICAgY29uc3Qgc2VudCA9IHRoaXMuX2JlYWNvbkNsaWVudC5wdWJsaXNoKHtjaGFubmVsOiBuYW1lLCBicm9hZGNhc3RQYXJhbXMsIGJvZHl9KVxuXG4gICAgICBpZiAoc2VudCkgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gVjIgc3Vic2NyaXB0aW9ucyBsaXZlIHBlciB3b3JrZXItdGhyZWFkLiBXaGVuIHJ1bm5pbmcgaW5cbiAgICAvLyB3b3JrZXItdGhyZWFkIG1vZGUsIHRoZSBwdWJsaXNoZXIgcnVucyBlaXRoZXIgaW4gdGhlIG1haW5cbiAgICAvLyBwcm9jZXNzIChob3N0KSBvciBpbiBvbmUgb2YgdGhlIHdvcmtlcnM6XG4gICAgLy9cbiAgICAvLyAgLSBNYWluIHByb2Nlc3M6IGBfd2Vic29ja2V0RXZlbnRzYCBpcyB0aGUgaG9zdCBzaW5nbGV0b24gYW5kXG4gICAgLy8gICAgYGJyb2FkY2FzdFYyYCBmYW5zIG91dCB0byBldmVyeSB3b3JrZXIgZGlyZWN0bHkuXG4gICAgLy8gIC0gV29ya2VyOiBgX3dlYnNvY2tldEV2ZW50c2AgaGFzIGBwdWJsaXNoVjJCcm9hZGNhc3RgIHRoYXRcbiAgICAvLyAgICBwb3N0cyB0byBtYWluLCB3aGljaCB0aGVuIGZhbnMgb3V0IHRvIGV2ZXJ5IHdvcmtlci5cbiAgICAvL1xuICAgIC8vIEluLXByb2Nlc3MgbW9kZSBkb2Vzbid0IGluc3RhbGwgYSB3ZWJzb2NrZXQtZXZlbnRzIHRyYW5zcG9ydCxcbiAgICAvLyBzbyBmYWxsIHRocm91Z2ggdG8gdGhlIGxvY2FsIGRpc3BhdGNoLlxuICAgIC8qKlxuICAgICAqIFdlYnNvY2tldCBldmVudHMuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IHdlYnNvY2tldEV2ZW50cyA9IHRoaXMuX3dlYnNvY2tldEV2ZW50c1xuXG4gICAgaWYgKHdlYnNvY2tldEV2ZW50cyAmJiB0eXBlb2Ygd2Vic29ja2V0RXZlbnRzLmJyb2FkY2FzdFYyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHdlYnNvY2tldEV2ZW50cy5icm9hZGNhc3RWMih7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBjb25maWd1cmF0aW9uOiB0aGlzfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5wdWJsaXNoVjJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIiAmJiB3ZWJzb2NrZXRFdmVudHMucGFyZW50UG9ydCkge1xuICAgICAgd2Vic29ja2V0RXZlbnRzLnB1Ymxpc2hWMkJyb2FkY2FzdCh7Y2hhbm5lbDogbmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKG5hbWUsIGJyb2FkY2FzdFBhcmFtcywgYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYWxsIHBlbmRpbmcgYnJvYWRjYXN0IG9wZXJhdGlvbnMgKGluY2x1ZGluZyBldmVudC1sb2dcbiAgICogcGVyc2lzdGVuY2UpLiBDYWxsIHRoaXMgYWZ0ZXIgYGJyb2FkY2FzdFRvQ2hhbm5lbGAgd2hlbiB5b3UgbmVlZFxuICAgKiB0aGUgZXZlbnQgdG8gYmUgcGVyc2lzdGVkIGJlZm9yZSBjb250aW51aW5nIChlLmcuIGJlZm9yZVxuICAgKiByZXNwb25kaW5nIHRvIGFuIEhUVFAgcmVxdWVzdCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpIHtcbiAgICAvKipcbiAgICAgKiBXZWJzb2NrZXQgZXZlbnRzLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBjb25zdCB3ZWJzb2NrZXRFdmVudHMgPSB0aGlzLl93ZWJzb2NrZXRFdmVudHNcblxuICAgIGlmICh3ZWJzb2NrZXRFdmVudHMgJiYgdHlwZW9mIHdlYnNvY2tldEV2ZW50cy5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIC8vIERyYWluIHRoZSBob3N0L3dvcmtlciBwdWJsaXNoIHF1ZXVlcyAoaW5jbHVkaW5nIGV2ZW50LWxvZyBwZXJzaXN0ZW5jZSlcbiAgICAgIC8vIGJlZm9yZSBkcmFpbmluZyBsb2NhbCBkZWxpdmVyaWVzLCBiZWNhdXNlIGhvc3QgZGlzcGF0Y2ggbGF1bmNoZXMgdGhlXG4gICAgICAvLyBsb2NhbCBkZWxpdmVyaWVzIHN5bmNocm9ub3VzbHkgYW5kIHRoZXkgbXVzdCBiZSBwYXJ0IG9mIHRoZSBzbmFwc2hvdC5cbiAgICAgIGF3YWl0IHdlYnNvY2tldEV2ZW50cy5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9hd2FpdExvY2FsQnJvYWRjYXN0RGVsaXZlcmllcygpXG4gIH1cblxuICAvKipcbiAgICogTG9jYWwgKHBlci13b3JrZXIpIGNoYW5uZWwgYnJvYWRjYXN0IGRpc3BhdGNoLiBDYWxsZWQgZWl0aGVyXG4gICAqIGRpcmVjdGx5IChpbi1wcm9jZXNzIG1vZGUpIG9yIGJ5IHRoZSB3b3JrZXIgdGhyZWFkIGFmdGVyIHRoZVxuICAgKiBtYWluLXByb2Nlc3MgZmFuLW91dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBQYXJhbXMgcGFzc2VkIHRvIGVhY2ggc3Vic2NyaXB0aW9uJ3MgYG1hdGNoZXMoKWAuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBNZXNzYWdlIGJvZHkgZGVsaXZlcmVkIHZpYSBgc2VuZE1lc3NhZ2UoKWAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEgZm9yIHJlcGxheSB0cmFja2luZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwobmFtZSwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5fd2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWJ1Y2tldCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBidWNrZXQpIHtcbiAgICAgIGlmIChzdWJzY3JpcHRpb24uaXNDbG9zZWQoKSkgY29udGludWVcblxuICAgICAgbGV0IG1hdGNoZXNcblxuICAgICAgdHJ5IHtcbiAgICAgICAgbWF0Y2hlcyA9IHN1YnNjcmlwdGlvbi5tYXRjaGVzKGJyb2FkY2FzdFBhcmFtcyB8fCB7fSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIEEgYnJva2VuIGBtYXRjaGVzKClgIG9uIG9uZSBzdWJzY3JpYmVyIG11c3Qgbm90IHBvaXNvbiB0aGVcbiAgICAgICAgLy8gYnJvYWRjYXN0IHRvIG90aGVyIHN1YnNjcmliZXJzLiBTa2lwIGFuZCBjb250aW51ZS5cbiAgICAgICAgY29uc29sZS5lcnJvcihgYnJvYWRjYXN0VG9DaGFubmVsOiAke25hbWV9IHN1YnNjcmlwdGlvbiAke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH0gbWF0Y2hlcygpIHRocmV3YCwgZXJyb3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWF0Y2hlcykgY29udGludWVcblxuICAgICAgY29uc3QgZGVsaXZlcnlNZXRhZGF0YSA9IHtcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICAuLi4obWV0YT8uZXZlbnRJZCA/IHtldmVudElkOiBtZXRhLmV2ZW50SWR9IDoge30pXG4gICAgICB9XG4gICAgICBjb25zdCBwcmV2aW91c0RlbGl2ZXJ5ID0gdGhpcy5fbG9jYWxCcm9hZGNhc3REZWxpdmVyeVRhaWxzLmdldChzdWJzY3JpcHRpb24pXG4gICAgICBjb25zdCBkZWxpdmVyeSA9IHRoaXMud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICByZXR1cm4gKHByZXZpb3VzRGVsaXZlcnkgfHwgUHJvbWlzZS5yZXNvbHZlKCkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fZGVsaXZlcldlYnNvY2tldENoYW5uZWxCcm9hZGNhc3Qoc3Vic2NyaXB0aW9uLCBib2R5LCBkZWxpdmVyeU1ldGFkYXRhKSlcbiAgICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBicm9hZGNhc3RUb0NoYW5uZWw6ICR7bmFtZX0gc3Vic2NyaXB0aW9uICR7c3Vic2NyaXB0aW9uLnN1YnNjcmlwdGlvbklkfSBkZWxpdmVyQnJvYWRjYXN0IHRocmV3YCwgZXJyb3IpXG4gICAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcnlUYWlscy5zZXQoc3Vic2NyaXB0aW9uLCBkZWxpdmVyeSlcblxuICAgICAgLy8gS2VlcCB0aGUgZmlyZS1hbmQtZm9yZ2V0IGRlbGl2ZXJ5IChuZXZlciBhd2FpdGVkIGF0IGJyb2FkY2FzdCB0aW1lKSBidXRcbiAgICAgIC8vIHRyYWNrIGl0IHNvIGBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzYCBjYW4gZHJhaW4gaXQgYmVmb3JlIHNldHRsaW5nLiBSZW1vdmVcbiAgICAgIC8vIG9uIHNldHRsZTsgdGhlIGZhaWx1cmUgaGFuZGxlciBhbHNvIHNhdGlzZmllcyB0aGUgcHJvbWlzZSBzbyBhIHJlamVjdGVkXG4gICAgICAvLyBkZWxpdmVyeSBuZXZlciBiZWNvbWVzIGFuIHVuaGFuZGxlZCByZWplY3Rpb24uXG4gICAgICB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXMuYWRkKGRlbGl2ZXJ5KVxuXG4gICAgICAvKipcbiAgICAgICAqIFJlbW92ZXMgYSBzZXR0bGVkIGRlbGl2ZXJ5IGZyb20gbG9jYWwgdHJhY2tpbmcuXG4gICAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgICAqL1xuICAgICAgY29uc3QgZm9yZ2V0RGVsaXZlcnkgPSAoKSA9PiB7XG4gICAgICAgIHRoaXMuX2xvY2FsQnJvYWRjYXN0RGVsaXZlcmllcy5kZWxldGUoZGVsaXZlcnkpXG4gICAgICAgIGlmICh0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZ2V0KHN1YnNjcmlwdGlvbikgPT09IGRlbGl2ZXJ5KSB0aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJ5VGFpbHMuZGVsZXRlKHN1YnNjcmlwdGlvbilcbiAgICAgIH1cblxuICAgICAgZGVsaXZlcnkudGhlbihmb3JnZXREZWxpdmVyeSwgZm9yZ2V0RGVsaXZlcnkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhIHNuYXBzaG90IG9mIHRoZSBpbi1mbGlnaHQgbG9jYWwgKHBlci1wcm9jZXNzKSB3ZWJzb2NrZXQgY2hhbm5lbFxuICAgKiBicm9hZGNhc3QgZGVsaXZlcmllcy4gQ2FsbGVkIGZyb20gYGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHNgIGFmdGVyIHRoZSBob3N0XG4gICAqIHB1Ymxpc2ggcXVldWVzIGRyYWluLCBzbyBldmVyeSBkZWxpdmVyeSB0aG9zZSBxdWV1ZXMgbGF1bmNoZWQgaXMgY2FwdHVyZWQuXG4gICAqIE5ldyBkZWxpdmVyaWVzIGVucXVldWVkIGFmdGVyIHRoZSBzbmFwc2hvdCBhcmUgbm90IGF3YWl0ZWQuIEluZGl2aWR1YWxcbiAgICogZGVsaXZlcnkgZXJyb3JzIGFyZSBpc29sYXRlZCBwZXIgc3Vic2NyaWJlciDigJQgdGhlIGRlbGl2ZXJ5IGNoYWluIGFscmVhZHlcbiAgICogbG9ncyB0aGVtIGFuZCByZXNvbHZlcyDigJQgc28gYSBzbmFwc2hvdHRlZCByZWplY3Rpb24gbmV2ZXIgZmFpbHMgdGhpcyBiYXJyaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hd2FpdExvY2FsQnJvYWRjYXN0RGVsaXZlcmllcygpIHtcbiAgICBjb25zdCBzbmFwc2hvdCA9IFsuLi50aGlzLl9sb2NhbEJyb2FkY2FzdERlbGl2ZXJpZXNdXG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc25hcHNob3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIHdlYnNvY2tldCBjaGFubmVsIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLmRlZmF1bHR9IHN1YnNjcmlwdGlvbiAtIENoYW5uZWwgc3Vic2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gbWV0YSAtIEJyb2FkY2FzdCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSBCcm9hZGNhc3QgZGVsaXZlcnkgcmVzdWx0LlxuICAgKi9cbiAgX2RlbGl2ZXJXZWJzb2NrZXRDaGFubmVsQnJvYWRjYXN0KHN1YnNjcmlwdGlvbiwgYm9keSwgbWV0YSkge1xuICAgIGlmICh0eXBlb2Ygc3Vic2NyaXB0aW9uLmRlbGl2ZXJCcm9hZGNhc3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpXG4gICAgfVxuXG4gICAgcmV0dXJuIHN1YnNjcmlwdGlvbi5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGUgfCB1bmRlZmluZWR9IC0gVGhlIHdlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIuXG4gICAqL1xuICBnZXRXZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyKCkge1xuICAgIHJldHVybiB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IGNoYW5uZWwgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldENoYW5uZWxSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3dlYnNvY2tldENoYW5uZWxSZXNvbHZlciA9IHJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgd2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlclR5cGV9IHJlc29sdmVyIC0gUmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIocmVzb2x2ZXIpIHtcbiAgICB0aGlzLl93ZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBYmlsaXR5IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IFthcmdzLnJlcXVlc3RdIC0gUmVxdWVzdCBvYmplY3QuIEFic2VudCBmb3Igd2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9ucyByZXNvbHZlZCBmcm9tIHN1YnNjcmliZSBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MucmVzcG9uc2VdIC0gUmVzcG9uc2Ugb2JqZWN0LiBBYnNlbnQgb3V0c2lkZSBIVFRQIHJlcXVlc3QgaGFuZGxpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVkIGFiaWxpdHkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQWJpbGl0eSh7cGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0QWJpbGl0eVJlc29sdmVyKClcblxuICAgIGlmIChyZXNvbHZlcikge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlcih7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0pXG5cbiAgICAgIGlmIChyZXNvbHZlZCkgcmV0dXJuIHJlc29sdmVkXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VzID0gdGhpcy5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICAgIGlmIChyZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIHJldHVybiBuZXcgQWJpbGl0eSh7XG4gICAgICBjb250ZXh0OiB7Y29uZmlndXJhdGlvbjogdGhpcywgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZX0sXG4gICAgICByZXNvdXJjZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9maWxlcyBhbiBhcHBsaWNhdGlvbi1kZWZpbmVkIHRlc3QgYWN0aXZpdHkgd2hlbiBhbiBvcHQtaW4gdGVzdCBwcm9maWxlXG4gICAqIGNvbnRleHQgaXMgYWN0aXZlLiBUaGUgY2FsbGJhY2sgYWx3YXlzIHJ1bnMsIGluY2x1ZGluZyBvdXRzaWRlIHByb2ZpbGluZy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb3ctY2FyZGluYWxpdHkgYWN0aXZpdHkgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIEFjdGl2aXR5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBwcm9maWxlVGVzdEFjdGl2aXR5KG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgdmFsaWRhdGVkTmFtZSA9IHZhbGlkYXRlVGVzdEFjdGl2aXR5TmFtZShuYW1lKVxuXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFRlc3RQcm9maWxlQ29udGV4dCgpXG5cbiAgICBpZiAoIWNvbnRleHQpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgY29udGV4dC5wcm9maWxlci5wcm9maWxlQWN0aXZpdHkoY29udGV4dCwgdmFsaWRhdGVkTmFtZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGFiaWxpdHkgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudEFiaWxpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudEFiaWxpdHkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgcmVxdWVzdCB0aW1pbmcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgcmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKi9cbiAgZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ3VycmVudCB0ZW5hbnQgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlbmFudCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRDdXJyZW50VGVuYW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVGVuYW50IHJlc29sdmVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7e2NoYW5uZWw6IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gW2FyZ3Muc3Vic2NyaXB0aW9uXSAtIFN1YnNjcmlwdGlvbiBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVUZW5hbnQoe3BhcmFtcywgcmVxdWVzdCwgcmVzcG9uc2UsIHN1YnNjcmlwdGlvbn0pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuZ2V0VGVuYW50UmVzb2x2ZXIoKVxuXG4gICAgaWYgKCFyZXNvbHZlcikgcmV0dXJuXG5cbiAgICByZXR1cm4gYXdhaXQgcmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcyxcbiAgICAgIHBhcmFtcyxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIHN1YnNjcmlwdGlvblxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXJyb3IgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiZXZlbnRlbWl0dGVyM1wiKS5FdmVudEVtaXR0ZXJ9IC0gRnJhbWV3b3JrIGVycm9yIGV2ZW50cyBlbWl0dGVyLlxuICAgKi9cbiAgZ2V0RXJyb3JFdmVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnRzXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgcmVwb3J0ZXIgdGhhdCBjYW4gYWRkIGNsaWVudC1zYWZlIG1ldGFkYXRhIHRvIGZyb250ZW5kLW1vZGVsIGVycm9yIHBheWxvYWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclR5cGV9IHJlcG9ydGVyIC0gUmVwb3J0ZXIgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXIocmVwb3J0ZXIpIHtcbiAgICB0aGlzLl9jbGllbnRFcnJvclBheWxvYWRSZXBvcnRlcnMucHVzaChyZXBvcnRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyZWQgY2xpZW50IGVycm9yIHBheWxvYWQgcmVwb3J0ZXJzLlxuICAgKiBAcGFyYW0ge3tjb250ZXh0OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkQ29udGV4dCwgZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gYXJncyAtIFJlcG9ydGVyIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWQ+fSAtIE1lcmdlZCBjbGllbnQtc2FmZSByZXBvcnRlciBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgY2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoYXJncykge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICBjb25zdCBkZXRhaWxzID0gcmVxdWVzdERldGFpbHMoYXJncy5yZXF1ZXN0LCB7cmVkYWN0b3I6IHRoaXMuZ2V0TG9nUmVkYWN0b3IoKSwgc2Vuc2l0aXZlVmFsdWVzfSlcblxuICAgIGZvciAoY29uc3QgcmVwb3J0ZXIgb2YgdGhpcy5fY2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJzKSB7XG4gICAgICBjb25zdCByZXBvcnRlclBheWxvYWQgPSBhd2FpdCByZXBvcnRlcih7XG4gICAgICAgIC4uLmFyZ3MsXG4gICAgICAgIHJlcXVlc3REZXRhaWxzOiBkZXRhaWxzXG4gICAgICB9KVxuXG4gICAgICBpZiAocmVwb3J0ZXJQYXlsb2FkICYmIHR5cGVvZiByZXBvcnRlclBheWxvYWQgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihwYXlsb2FkLCByZXBvcnRlclBheWxvYWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSB0ZXN0IGF0dGVtcHQgaW4gYSByZXZvY2FibGUgZGF0YWJhc2UtYWNjZXNzIGNvbnRleHQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e3Jldm9rZWQ6IGJvb2xlYW59fSBzY29wZSAtIEF0dGVtcHQtb3duZWQgYWNjZXNzIHNjb3BlLlxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF0dGVtcHQgd29yay5cbiAgICogQHJldHVybnMge1QgfCBQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdGVudCBmcmFtZXdvcmsgd29yayB3aXRob3V0IGluaGVyaXRpbmcgYSB0ZXN0IGF0dGVtcHQncyByZXZvY2FibGUgZGF0YWJhc2UtYWNjZXNzIHNjb3BlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBlcnNpc3RlbnQgd29yayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhvdXRDdXJyZW50VGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqIFRocm93cyB3aGVuIGEgdGltZWQtb3V0IHRlc3QgYXR0ZW1wdCB0cmllcyB0byBzdGFydCBtb3JlIGRhdGFiYXNlIHdvcmsuICovXG4gIGFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpIHtcbiAgICB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmFzc2VydFRlc3REYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBjb25uZWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtXaXRoQ29ubmVjdGlvbnNPcHRpb25zVHlwZSB8IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPn0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoQ29ubmVjdGlvbnMob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IHtcbiAgICAgIGNhbGxiYWNrOiBhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjayxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBuYW1lXG4gICAgfSA9IHJlc29sdmVXaXRoQ29ubmVjdGlvbnNBcmdzKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaywgXCJDb25maWd1cmF0aW9uLndpdGhDb25uZWN0aW9uc1wiKVxuXG4gICAgaWYgKCFhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwid2l0aENvbm5lY3Rpb25zIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIC8qKlxuICAgICAqIERicy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIGNvbnN0IGRicyA9IHt9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGJzLFxuICAgICAgaWRlbnRpZmllcnM6IGRhdGFiYXNlSWRlbnRpZmllcnMgPz8gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCksXG4gICAgICBuYW1lLFxuICAgICAgc3RhY2tMYWJlbDogXCJ3aXRoQ29ubmVjdGlvbnNcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBsaWNpdCBtb2RlbCB3b3JrIGluIGEgdHJhbnNhY3Rpb24gcGlubmVkIHRvIG9uZSBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZT86IHN0cmluZ319IG9wdGlvbnMgLSBPcGVyYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHsob3BlcmF0aW9uOiBEYXRhYmFzZU9wZXJhdGlvbikgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhUcmFuc2FjdGlvbih7ZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lID0gXCJDb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvblwiLCAuLi5yZXN0QXJnc30sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuICAgIGlmICghdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkuaW5jbHVkZXMoZGF0YWJhc2VJZGVudGlmaWVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9yIGluYWN0aXZlIGRhdGFiYXNlIGlkZW50aWZpZXI6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50ID0gdGhpcy5nZXRDdXJyZW50VGVuYW50KClcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhPcGVyYXRpb25Db25uZWN0aW9uKHtuYW1lfSwgYXN5bmMgKGNvbm5lY3Rpb24sIG93bmVyKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICBjb25zdCBvcGVyYXRpb24gPSBuZXcgRGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLFxuICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGNvbmZpZ3VyYXRpb25SZXVzZUtleTogcG9vbC5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pLFxuICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIG93bmVyLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBvcGVyYXRpb24udHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgICAgICB9KVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgb3BlcmF0aW9uLmNvbXBsZXRlKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhwbGljaXQgbW9kZWwgd29yayBvbiBvbmUgY29ubmVjdGlvbiBzZWxlY3RlZCBmcm9tIGEgY2FwdHVyZWQgcGh5c2ljYWxcbiAgICogZGF0YWJhc2UgY29uZmlndXJhdGlvbi4gTm8gYW1iaWVudCB0ZW5hbnQgdmFsdWUgaXMgcmVhZCBkdXJpbmcgY2hlY2tvdXQgb3JcbiAgICogZXhlY3V0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZT86IHN0cmluZywgc2NoZW1hR2VuZXJhdGlvbj86IHN0cmluZywgdGVuYW50Pzogb2JqZWN0fX0gb3B0aW9ucyAtIENhcHR1cmVkIG9wZXJhdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IERhdGFiYXNlT3BlcmF0aW9uKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERhdGFiYXNlT3BlcmF0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgbmFtZSA9IFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb25cIiwgc2NoZW1hR2VuZXJhdGlvbiwgdGVuYW50LCAuLi5yZXN0QXJnc30sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cIilcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBjb25maWd1cmF0aW9uUmV1c2VLZXkgPSBwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG5cbiAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ2FwdHVyZWRPcGVyYXRpb25Db25uZWN0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG5hbWV9LCBhc3luYyAoY29ubmVjdGlvbiwgb3duZXIpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IG5ldyBEYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMsXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgY29uZmlndXJhdGlvblJldXNlS2V5LFxuICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIGVuZm9yY2VDdXJyZW50VGVuYW50UmV1c2VLZXk6IGZhbHNlLFxuICAgICAgICBvd25lcixcbiAgICAgICAgc2NoZW1hR2VuZXJhdGlvbixcbiAgICAgICAgdGVuYW50XG4gICAgICB9KVxuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgb3BlcmF0aW9uLmNvbXBsZXRlKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FsbGJhY2sgd2l0aCBkYXRhYmFzZSBjb25uZWN0aW9ucyBmb3IgdGhlIHJlcXVlc3RlZCBpZGVudGlmaWVycy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7Y2FsbGJhY2s6IFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrVHlwZTxUPiwgZGJzOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0PiwgaWRlbnRpZmllcnM6IHN0cmluZ1tdLCBuYW1lOiBzdHJpbmcsIHN0YWNrTGFiZWw6IHN0cmluZ319IGFyZ3MgLSBDb25uZWN0aW9uIHNjb3BlIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhEYXRhYmFzZUlkZW50aWZpZXJDb25uZWN0aW9ucyh7Y2FsbGJhY2ssIGRicywgaWRlbnRpZmllcnMsIG5hbWUsIHN0YWNrTGFiZWx9KSB7XG4gICAgY29uc3Qgc3RhY2sgPSBFcnJvcigpLnN0YWNrXG4gICAgY29uc3QgYWN0dWFsQ2FsbGJhY2sgPSBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICByZXR1cm4gYXdhaXQgd2l0aFRyYWNrZWRTdGFjayhzdGFjayB8fCBzdGFja0xhYmVsLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYnMpXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1biByZXF1ZXN0LlxuICAgICAqIEB0eXBlIHsoKSA9PiBQcm9taXNlPFQ+fSAqL1xuICAgIGxldCBydW5SZXF1ZXN0ID0gYWN0dWFsQ2FsbGJhY2tcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBpZGVudGlmaWVycykge1xuICAgICAgbGV0IGFjdHVhbFJ1blJlcXVlc3QgPSBydW5SZXF1ZXN0XG5cbiAgICAgIGNvbnN0IG5leHRSdW5SZXF1ZXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikud2l0aENvbm5lY3Rpb24oe25hbWV9LCBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgICBkYnNbaWRlbnRpZmllcl0gPSBkYlxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbFJ1blJlcXVlc3QoKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBydW5SZXF1ZXN0ID0gbmV4dFJ1blJlcXVlc3RcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUmVxdWVzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2RhdGFiYXNlSWRlbnRpZmllcnNdIC0gRGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gaW5jbHVkZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBBIG1hcCBvZiBkYXRhYmFzZSBjb25uZWN0aW9ucyB3aXRoIGlkZW50aWZpZXIgYXMga2V5XG4gICAqL1xuICBnZXRDdXJyZW50Q29ubmVjdGlvbnMoZGF0YWJhc2VJZGVudGlmaWVycyA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIC8qKlxuICAgICAqIERicy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IGltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSAqL1xuICAgIGNvbnN0IGRicyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgZGF0YWJhc2VJZGVudGlmaWVycykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcG9vbCA9IHRoaXMuZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9uID0gcG9vbC5nZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24gPyBwb29sLmdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbigpIDogcG9vbC5nZXRDdXJyZW50Q29ubmVjdGlvbigpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRDb25uZWN0aW9uICYmICghcG9vbC5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uIHx8IHBvb2wuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbihjdXJyZW50Q29ubmVjdGlvbikpKSB7XG4gICAgICAgICAgZGJzW2lkZW50aWZpZXJdID0gY3VycmVudENvbm5lY3Rpb25cbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuaXNNaXNzaW5nQ3VycmVudENvbm5lY3Rpb25FcnJvcihlcnJvcikpIHtcbiAgICAgICAgICAvLyBJZ25vcmVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRic1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aG91dCBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gd2l0aG91dCBpbmhlcml0ZWQgREIgY29ubmVjdGlvbiBjb250ZXh0cy5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoY2FsbGJhY2spIHtcbiAgICBsZXQgcnVuQ2FsbGJhY2sgPSAoKSA9PiB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJzKGNhbGxiYWNrKVxuXG4gICAgZm9yIChjb25zdCBwb29sIG9mIE9iamVjdC52YWx1ZXModGhpcy5kYXRhYmFzZVBvb2xzKSkge1xuICAgICAgaWYgKCFwb29sKSBjb250aW51ZVxuICAgICAgY29uc3QgcHJldmlvdXNSdW5DYWxsYmFjayA9IHJ1bkNhbGxiYWNrXG5cbiAgICAgIHJ1bkNhbGxiYWNrID0gKCkgPT4gcG9vbC53aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0KHByZXZpb3VzUnVuQ2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bkNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaW5zaWRlIGV2ZXJ5IHBvb2wncyB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIGNvbnRleHQgKGEgbm8tb3AgZm9yXG4gICAqIHBvb2xzIHdpdGhvdXQgb25lKS4gSW4tcHJvY2VzcyByZXF1ZXN0IGhhbmRsaW5nIGlzIHdyYXBwZWQgaW4gdGhpcyBzbyBhIHJlcXVlc3RcbiAgICogcnVucyBvbiB0aGUgc2FtZSBjb25uZWN0aW9uIOKAlCBhbmQgb3BlbiB0cmFuc2FjdGlvbiDigJQgYXMgdGhlIHRlc3QgdGhhdCBpc3N1ZWQgaXQsXG4gICAqIGxldHRpbmcgcmVxdWVzdCBzcGVjcyBjbGVhbiB1cCBieSByb2xsaW5nIGJhY2sgaW5zdGVhZCBvZiB0cnVuY2F0aW5nLiBPdXRzaWRlXG4gICAqIHRlc3RzIG5vIHNoYXJlZCBjb25uZWN0aW9uIGlzIHNldCwgc28gdGhpcyBqdXN0IHJ1bnMgdGhlIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIGluc2lkZSB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gY29udGV4dHMuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGNhbGxiYWNrKSB7XG4gICAgbGV0IHJ1bkNhbGxiYWNrID0gY2FsbGJhY2tcblxuICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgIGlmICghcG9vbCkgY29udGludWVcbiAgICAgIGNvbnN0IHByZXZpb3VzUnVuQ2FsbGJhY2sgPSBydW5DYWxsYmFja1xuXG4gICAgICBydW5DYWxsYmFjayA9ICgpID0+IHBvb2wucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uKHByZXZpb3VzUnVuQ2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bkNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG1pc3NpbmcgY3VycmVudCBjb25uZWN0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEVycm9yIHRocm93biB3aGlsZSBsb29raW5nIHVwIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGVycm9yIG1lYW5zIG5vIGN1cnJlbnQgY29ubmVjdGlvbiBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBpc01pc3NpbmdDdXJyZW50Q29ubmVjdGlvbkVycm9yKGVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgKFxuICAgICAgZXJyb3IubWVzc2FnZSA9PSBcIklEIGhhc24ndCBiZWVuIHNldCBmb3IgdGhpcyBhc3luYyBjb250ZXh0XCIgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2UgPT0gXCJBIGNvbm5lY3Rpb24gaGFzbid0IGJlZW4gbWFkZSB5ZXRcIiB8fFxuICAgICAgZXJyb3IubWVzc2FnZS5zdGFydHNXaXRoKFwiTm8gYXN5bmMgY29udGV4dCBzZXQgZm9yIGRhdGFiYXNlIGNvbm5lY3Rpb25cIikgfHxcbiAgICAgIGVycm9yLm1lc3NhZ2Uuc3RhcnRzV2l0aChcIkNvbm5lY3Rpb24gXCIpICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoXCJkb2Vzbid0IGV4aXN0IGFueSBtb3JlXCIpXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGNvbm5lY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1dpdGhDb25uZWN0aW9uc09wdGlvbnNUeXBlIHwgV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7V2l0aENvbm5lY3Rpb25zQ2FsbGJhY2tUeXBlPFQ+fSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNvbm5lY3Rpb25zKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBjb25zdCB7XG4gICAgICBjYWxsYmFjazogYWN0dWFsV2l0aENvbm5lY3Rpb25zQ2FsbGJhY2ssXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgbmFtZVxuICAgIH0gPSByZXNvbHZlV2l0aENvbm5lY3Rpb25zQXJncyhvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2ssIFwiQ29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9uc1wiKVxuXG4gICAgaWYgKCFhY3R1YWxXaXRoQ29ubmVjdGlvbnNDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwiZW5zdXJlQ29ubmVjdGlvbnMgcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgcmVxdWVzdGVkSWRlbnRpZmllcnMgPSBkYXRhYmFzZUlkZW50aWZpZXJzID8/IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpXG4gICAgY29uc3QgZGJzID0gdGhpcy5nZXRDdXJyZW50Q29ubmVjdGlvbnMocmVxdWVzdGVkSWRlbnRpZmllcnMpXG4gICAgY29uc3QgbWlzc2luZ0lkZW50aWZpZXJzID0gcmVxdWVzdGVkSWRlbnRpZmllcnMuZmlsdGVyKChpZGVudGlmaWVyKSA9PiB7XG4gICAgICBpZiAoIWRic1tpZGVudGlmaWVyXSkgcmV0dXJuIHRydWVcblxuICAgICAgcmV0dXJuICF0aGlzLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS5oYXNDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQoKVxuICAgIH0pXG5cbiAgICBpZiAobWlzc2luZ0lkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrKGRicylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGF0YWJhc2VJZGVudGlmaWVyQ29ubmVjdGlvbnMoe1xuICAgICAgY2FsbGJhY2s6IGFjdHVhbFdpdGhDb25uZWN0aW9uc0NhbGxiYWNrLFxuICAgICAgZGJzLFxuICAgICAgaWRlbnRpZmllcnM6IG1pc3NpbmdJZGVudGlmaWVycyxcbiAgICAgIG5hbWUsXG4gICAgICBzdGFja0xhYmVsOiBcImVuc3VyZUNvbm5lY3Rpb25zXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGRlZGljYXRlZCBjb25uZWN0aW9uIHRoYXQgY3VycmVudGx5IGhvbGRzIGFuIGFkdmlzb3J5IGxvY2ssIHNvIGFcbiAgICogc2h1dGRvd24gY2FuIGNsb3NlIGl0IGFuZCByZWxlYXNlIHRoZSBsb2NrLiBTZWUgYF9hZHZpc29yeUxvY2tDb25uZWN0aW9uc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuYWRkKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uIG9uY2UgaXRzIGxvY2sgc2NvcGUgZW5kcyBhbmQgdGhlXG4gICAqIGNvbm5lY3Rpb24gaGFzIGJlZW4gKG9yIGlzIGFib3V0IHRvIGJlKSBjbG9zZWQgYnkgaXRzIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBUaGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB1bnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGV2ZXJ5IHJlZ2lzdGVyZWQgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiwgZW5kaW5nIGl0cyBzZXNzaW9uIHNvXG4gICAqIHRoZSBEQiBzZXJ2ZXIgcmVsZWFzZXMgdGhlIGxvY2suIEV2ZXJ5IGNvbm5lY3Rpb24gaXMgYXR0ZW1wdGVkIGJlZm9yZSBhbnkgZmFpbHVyZVxuICAgKiBpcyBzdXJmYWNlZCwgc28gb25lIHN0dWNrIGNsb3NlIGRvZXMgbm90IGxlYXZlIHRoZSBvdGhlcnMnIGxvY2tzIGhlbGQ7IGEgZmFpbHVyZSBpc1xuICAgKiB0aGVuIHRocm93biAobmV2ZXIgc3dhbGxvd2VkKSwgYWdncmVnYXRlZCB3aGVuIG1vcmUgdGhhbiBvbmUgY29ubmVjdGlvbiBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgYWxsIGhhdmUgYmVlbiBjbG9zZWQ7IHJlamVjdHMgaWYgYW55IGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuX2Fkdmlzb3J5TG9ja0Nvbm5lY3Rpb25zXVxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMuY2xlYXIoKVxuXG4gICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBjb25uZWN0aW9ucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFjdGl2ZSBkYXRhYmFzZSBjb25uZWN0aW9ucyBhbmQgY2xlYXJzIGdsb2JhbCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbnN0cnVjdG9ycyA9IG5ldyBTZXQoKVxuXG4gICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgICBjb25zdCBjbG9zZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY2xvc2VFcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gQ2xvc2UgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbnMgZmlyc3Q6IHRoZXkgYXJlIHNwYXduZWQgb3V0c2lkZSB0aGVcbiAgICAgICAgICAvLyBwb29scycgdHJhY2tlZCBzZXRzLCBzbyBgcG9vbC5jbG9zZUFsbCgpYCB3b3VsZCBub3QgcmVhY2ggdGhlbSBhbmQgYSBsb2NrIGhlbGRcbiAgICAgICAgICAvLyBieSBhIHJ1bm5lciB0b3JuIGRvd24gbWlkLXBhc3Mgd291bGQgbGVhayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuXG4gICAgICAgICAgLy8gU3RpbGwgY2xvc2UgdGhlIHBvb2xzIGlmIHRoaXMgdGhyb3dzLCBzbyBhIHN0dWNrIGxvY2sgY29ubmVjdGlvbiBkb2VzIG5vdFxuICAgICAgICAgIC8vIGxlYXZlIHRoZSByZXN0IG9mIHRoZSBjb25uZWN0aW9ucyBvcGVuLlxuICAgICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrQ29ubmVjdGlvbnMoKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGZvciAoY29uc3QgcG9vbCBvZiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YWJhc2VQb29scykpIHtcbiAgICAgICAgICAgIGlmICghcG9vbCkgY29udGludWVcblxuICAgICAgICAgICAgYXdhaXQgcG9vbC5jbG9zZUFsbCgpXG5cbiAgICAgICAgICAgIGNvbnN0IFBvb2xDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9ICovIChwb29sLmNvbnN0cnVjdG9yKVxuICAgICAgICAgICAgY29uc3RydWN0b3JzLmFkZChQb29sQ2xhc3MpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZm9yIChjb25zdCBQb29sQ2xhc3Mgb2YgY29uc3RydWN0b3JzKSB7XG4gICAgICAgICAgICBQb29sQ2xhc3MuY2xlYXJHbG9iYWxDb25uZWN0aW9ucyh0aGlzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRoaXMuX2Zyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlLnJlc2V0KClcblxuICAgICAgICAgIC8vIEFsbG93IGZ1bGwgcmUtaW5pdGlhbGl6YXRpb24gYWZ0ZXIgY29ubmVjdGlvbnMgYXJlIGNsb3NlZC5cbiAgICAgICAgICB0aGlzLl9tb2RlbEluaXRpYWxpemF0aW9uR2VuZXJhdGlvbiArPSAxXG4gICAgICAgICAgdGhpcy5fbW9kZWxzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgICAgICAgIHRoaXMuX2lzSW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cblxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgY2xvc2VFcnJvcnNbMF1cbiAgICAgIGlmIChjbG9zZUVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoY2xvc2VFcnJvcnMsIFwiRmFpbGVkIHRvIGNsb3NlIGJhY2tncm91bmQtam9icyBhbmQgZGF0YWJhc2UgcmVzb3VyY2VzXCIpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlRGF0YWJhc2VDb25uZWN0aW9uc1Byb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zUHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCByZXF1ZXN0IGF1dGhvcml6ZWQuXG4gICAqIEBwYXJhbSB7e2hlYWRlcjogKG5hbWU6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH19IHJlcXVlc3QgLSBJbmNvbWluZyByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhwZWN0ZWRUb2tlbiAtIENvbmZpZ3VyZWQgZGVidWctZW5kcG9pbnQgdG9rZW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgY2FycmllcyB0aGUgZXhwZWN0ZWQgYmVhcmVyIHRva2VuLlxuICAgKi9cbiAgZGVidWdFbmRwb2ludFJlcXVlc3RBdXRob3JpemVkKHJlcXVlc3QsIGV4cGVjdGVkVG9rZW4pIHtcbiAgICBjb25zdCBoZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImF1dGhvcml6YXRpb25cIilcblxuICAgIGlmICh0eXBlb2YgaGVhZGVyICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG1hdGNoID0gKC9eQmVhcmVyXFxzKyguKykkL2kpLmV4ZWMoaGVhZGVyLnRyaW0oKSlcblxuICAgIGlmICghbWF0Y2gpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZGVidWdFbmRwb2ludFRva2VuTWF0Y2hlcyhtYXRjaFsxXSwgZXhwZWN0ZWRUb2tlbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcGkgbWFuaWZlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHVua25vd24+Pn0gLSBBUEkgbWFuaWZlc3QgZm9yIGFsbCByZWdpc3RlcmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGdldEFwaU1hbmlmZXN0KCkge1xuICAgIHJldHVybiBmcm9udGVuZE1vZGVsQXBpTWFuaWZlc3QodGhpcy5fYmFja2VuZFByb2plY3RzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hldGhlciBBUEkgbWFuaWZlc3QgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgQVBJIG1hbmlmZXN0IGVuZHBvaW50IGlzIGVuYWJsZWQuXG4gICAqL1xuICBfYXBpTWFuaWZlc3RFbmFibGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9hcGlNYW5pZmVzdC5lbmFibGVkXG4gIH1cbn1cbiJdfQ==