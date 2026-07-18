// @ts-check

/**
 * WithConnectionsCallbackType type.
 * @template T
 * @typedef {function(Record<string, import("./database/drivers/base.js").default>) : Promise<T>} WithConnectionsCallbackType
 */
/**
 * WithConnectionsOptionsType type.
 * @typedef {object} WithConnectionsOptionsType
 * @property {string} [name] - Human-readable name for the checked-out database connections.
 */

import {digg} from "diggerize"
import gettextConfig from "gettext-universal/build/src/config.js"
import translate from "gettext-universal/build/src/translate.js"
import Ability from "./authorization/ability.js"
import {initializeAuditedModelRelationships} from "./database/record/auditing.js"
import EventEmitter from "./utils/event-emitter.js"
import VelociousWebsocketChannelSubscribers from "./http-server/websocket-channel-subscribers.js"
import {CurrentConfigurationNotSetError, currentConfiguration, setCurrentConfiguration} from "./current-configuration.js"
import {requestDetails} from "./error-reporting/request-details.js"
import {frontendModelApiManifest, frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition, frontendModelResourcesForBackendProject} from "./frontend-models/resource-definition.js"
import {currentOfflineGrantSigningKey, normalizeOfflineGrantSigningKey} from "./sync/offline-grant.js"
import PluginRoutes from "./routes/plugin-routes.js"
import restArgsError from "./utils/rest-args-error.js"
import {validateTimeZone} from "./time-zone.js"
import {withTrackedStack} from "./utils/with-tracked-stack.js"
import VelociousPackage from "./packages/velocious-package.js"

export {CurrentConfigurationNotSetError}

/**
 * Runs current working directory.
 * @returns {string | undefined} - Current working directory when the runtime exposes one.
 */
function currentWorkingDirectory() {
  const processObject = /** @type {{cwd?: ?} | undefined} */ (globalThis.process)

  if (typeof processObject?.cwd !== "function") return undefined

  return processObject.cwd()
}

/**
 * Resolves the overloaded with/ensure connections arguments.
 * @template T
 * @param {WithConnectionsOptionsType | WithConnectionsCallbackType<T>} optionsOrCallback - Checkout options or callback function.
 * @param {WithConnectionsCallbackType<T> | undefined} callback - Callback function.
 * @param {string} defaultName - Default checkout name.
 * @returns {{name: string, callback: WithConnectionsCallbackType<T> | undefined}} Resolved checkout name and callback.
 */
function resolveWithConnectionsArgs(optionsOrCallback, callback, defaultName) {
  if (typeof optionsOrCallback == "function") {
    const actualCallback = /** @type {WithConnectionsCallbackType<T>} */ (optionsOrCallback)

    return {name: defaultName, callback: actualCallback}
  }

  return {
    name: optionsOrCallback.name || defaultName,
    callback
  }
}

/**
 * Runs canonical debug snapshot value.
 * @param {?} value - Snapshot value to canonicalize.
 * @returns {?} Snapshot value with object keys sorted recursively.
 */
function canonicalDebugSnapshotValue(value) {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((entry) => canonicalDebugSnapshotValue(entry))

  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalDebugSnapshotValue(/** @type {Record<string, ?>} */ (value)[key])
    return result
  }, /** @type {Record<string, ?>} */ ({}))
}

/**
 * Runs merge database configuration.
 * @param {import("./configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Base database configuration.
 * @param {import("./configuration-types.js").DatabaseConfigurationType | Partial<import("./configuration-types.js").DatabaseConfigurationType> | void} overrideConfiguration - Tenant override configuration.
 * @returns {import("./configuration-types.js").DatabaseConfigurationType} - Merged database configuration.
 */
function mergeDatabaseConfiguration(databaseConfiguration, overrideConfiguration) {
  if (!overrideConfiguration) return databaseConfiguration

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
  }
}

/**
 * Resolves the grace window (ms) before a sustained beacon outage is reported.
 * @param {?} value - Configured `unreachableReportMs`, if any.
 * @returns {number} - The configured value when it's a finite number, otherwise the 30s default.
 */
function resolveBeaconUnreachableReportMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value

  return 30_000
}

export default class VelociousConfiguration {
  /**
   * Close database connections promise.
   * @type {Promise<void> | null} */
  _closeDatabaseConnectionsPromise = null
  /**
   * Runs current.
   * @returns {VelociousConfiguration} - The current.
   */
  static current() {
    return currentConfiguration()
  }

  /**
   * Runs constructor.
   * @param {import("./configuration-types.js").ConfigurationArgsType} args - Configuration arguments.
   */
  constructor({abilityResolver, abilityResources, attachments, autoload = true, backgroundJobs, backendProjects, beacon, cookieSecret, cors, database, debug = false, debugEndpoint = false, apiManifest = false, directory, enforceTenantDatabaseScopes = true, environment, environmentHandler, exposeInternalErrorsToClients = false, httpServer, initializeModels, initializers, locale, localeFallbacks, locales, logging, mailerBackend, packages, requestTimeoutMs, routeResolverHooks, scheduledBackgroundJobs, structureSql, sync, tenantDatabaseProviders, tenantDatabaseResolver, tenantResolver, testing, timeZone, timezoneOffsetMinutes, trustedProxies, websocketChannelResolver, websocketMessageHandlerResolver, ...restArgs}) {
    restArgsError(restArgs)

    this._abilityResolver = abilityResolver
    this._abilityResources = abilityResources || []
    this._autoload = autoload
    this._backgroundJobs = backgroundJobs
    this._beacon = beacon
    /**
     * Stores the beacon client value.
     * @type {import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined} */
    this._beaconClient = undefined
    /**
     * Stores the beacon connect promise value.
     * @type {Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined> | undefined} */
    this._beaconConnectPromise = undefined
    /**
     * Stores the beacon report timer value.
     * @type {ReturnType<typeof setTimeout> | undefined} - Pending "beacon still unreachable" report timer.
     */
    this._beaconReportTimer = undefined
    /**
     * Stores the beacon outage reported value.
     * @type {boolean} - Whether the current beacon outage has already been reported.
     */
    this._beaconOutageReported = false
    /**
     * Stores the beacon last down error value.
     * @type {{stage: "beacon-connect" | "beacon-disconnect", error: Error} | undefined} - Latest beacon-down details, reported only if the outage is sustained.
     */
    this._beaconLastDownError = undefined
    this._scheduledBackgroundJobs = scheduledBackgroundJobs
    this._attachments = attachments || {}
    // Copy so appending package-derived entries below never mutates a caller's
    // shared array (config modules commonly export a reused backendProjects array).
    this._backendProjects = backendProjects ? [...backendProjects] : []
    /** @type {import("./configuration-types.js").ClientErrorPayloadReporterType[]} */
    this._clientErrorPayloadReporters = []
    this.cors = cors
    this._cookieSecret = cookieSecret
    this.database = database
    this.debug = debug
    this._debugEndpoint = this._normalizeDebugEndpoint(debugEndpoint)
    this._apiManifest = this._normalizeApiManifest(apiManifest)
    this._environment = environment || process.env.VELOCIOUS_ENV || process.env.NODE_ENV || "development"
    this._environmentHandler = environmentHandler
    this._enforceTenantDatabaseScopes = enforceTenantDatabaseScopes
    this._exposeInternalErrorsToClients = exposeInternalErrorsToClients
    this._directory = directory
    this._initializeModels = initializeModels
    /** @type {VelociousPackage[]} */
    this._packages = (packages || []).map((entry) => VelociousPackage.from(entry))

    // Append a derived backend-project per package so the existing resource
    // discovery + frontend-model generation machinery includes it. Package
    // frontend models are generated into the app's frontend-models output.
    const appFrontendModelsOutputPath = this._backendProjects[0]?.frontendModelsOutputPath

    for (const velociousPackage of this._packages) {
      this._backendProjects.push(velociousPackage.toBackendProjectConfiguration({frontendModelsOutputPath: appFrontendModelsOutputPath}))
    }

    this._isInitialized = false
    /**
     * In-progress `initialize()` promise, memoized so concurrent callers await
     * the same bootstrap. Reset to undefined if initialization fails.
     * @type {Promise<void> | undefined}
     */
    this._initializePromise = undefined
    this.httpServer = httpServer || {}
    /**
     * Stores the http server instance value.
     * @type {{getDebugSnapshot: () => Promise<Record<string, ?>>} | undefined} */
    this._httpServerInstance = undefined
    this.locale = locale
    this.localeFallbacks = localeFallbacks
    this.locales = locales
    this._initializers = initializers
    this._testing = testing
    this._timeZone = timeZone
    this._timezoneOffsetMinutes = timezoneOffsetMinutes
    this._trustedProxies = trustedProxies
    this._requestTimeoutMs = requestTimeoutMs
    this._structureSql = structureSql
    this._sync = this._normalizeSyncConfiguration(sync)
    this._tenantDatabaseProviders = tenantDatabaseProviders || {}
    this._tenantDatabaseResolver = tenantDatabaseResolver
    this._tenantResolver = tenantResolver
    this._websocketEvents = undefined
    /**
     * Stores the websocket channel subscribers value.
     * @type {VelociousWebsocketChannelSubscribers | undefined} */
    this._websocketChannelSubscribers = undefined
    this._websocketChannelResolver = websocketChannelResolver
    this._websocketMessageHandlerResolver = websocketMessageHandlerResolver
    /**
     * Stores the websocket connection classes value.
     * @type {Map<string, typeof import("./http-server/websocket-connection.js").default>} */
    this._websocketConnectionClasses = new Map()

    /**
     * Stores the websocket channel classes value.
     * @type {Map<string, typeof import("./http-server/websocket-channel.js").default>} */
    this._websocketChannelClasses = new Map()

    /**
     * Stores the websocket channel subscriptions value.
     * @type {Map<string, Set<import("./http-server/websocket-channel.js").default>>} - channelType → live subscriptions across all sessions.
     */
    this._websocketChannelSubscriptions = new Map()

    /**
     * Stores the websocket sessions value.
     * @type {Set<import("./http-server/client/websocket-session.js").default>} - Live websocket sessions, including paused sessions within the grace window.
     */
    this._websocketSessions = new Set()

    /**
     * Stores the paused websocket sessions value.
     * @type {Map<string, {session: import("./http-server/client/websocket-session.js").default, graceTimer: ReturnType<typeof setTimeout>, pausedAt: number}>} - sessionId → paused session awaiting resume.
     */
    this._pausedWebsocketSessions = new Map()

    /** Grace period for paused WebSocket sessions before permanent teardown. */
    this._websocketSessionGraceSeconds = 300

    /** Interval (seconds) between server→client heartbeat pings; 0 disables reaping of silent sockets. */
    this._websocketSessionHeartbeatSeconds = 30

    /**
     * Optional wrapper called around every WebSocket-borne request /
     * connection message / channel dispatch. Apps register it here
     * to set up per-request context (e.g. AsyncLocalStorage for
     * locale, tenant, tracing) that downstream handlers read.
     * @type {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null}
     */
    this._websocketAroundRequest = null

    /**
     * Stores the around action value.
     * @type {((context: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default, next: () => Promise<void>}) => Promise<void>) | null} */
    this._aroundAction = null

    /**
     * Stores the websocket session identity resolver value.
     * @type {((session: import("./http-server/client/websocket-session.js").default) => ? | Promise<?>) | null} */
    this._websocketSessionIdentityResolver = null
    this._logging = logging
    this._mailerBackend = mailerBackend
    this._routeResolverHooks = [...(routeResolverHooks || [])]
    this._addDebugEndpointRouteHook()
    this._addApiManifestRouteHook()

    /**
     * Stores the applied route mounts value.
     * @type {WeakSet<object>} */
    this._appliedRouteMounts = new WeakSet()
    this._errorEvents = new EventEmitter()

    /**
     * Stores the database pools value.
     * @type {{[key: string]: import("./database/pool/base.js").default}} */
    this.databasePools = {}

    /**
     * Stores the model classes value.
     * @type {{[key: string]: typeof import("./database/record/index.js").default}} */
    this.modelClasses = {}

    this.getEnvironmentHandler().setConfiguration(this)
  }

  /**
   * Runs get autoload.
   * @returns {boolean} Whether auto-batch-preload of relationships on lazy access is enabled globally.
   */
  getAutoload() { return this._autoload }

  /**
   * Runs get expose internal errors to clients.
   * @returns {boolean} Whether unexpected internal error details may be returned to API clients.
   */
  getExposeInternalErrorsToClients() { return this._exposeInternalErrorsToClients === true }

  /**
   * Runs get debug endpoint.
   * @returns {{enabled: boolean, path: string, token: string | null}} - Debug endpoint configuration.
   */
  getDebugEndpoint() { return this._debugEndpoint }

  /**
   * Runs debug endpoint snapshot.
   * @returns {{enabled: boolean, path: string, tokenConfigured: boolean}} - Debug endpoint config for the snapshot, with the token redacted.
   */
  _debugEndpointSnapshot() {
    return {
      enabled: this._debugEndpoint.enabled,
      path: this._debugEndpoint.path,
      tokenConfigured: Boolean(this._debugEndpoint.token)
    }
  }

  /**
   * Runs normalize debug endpoint.
   * @param {boolean | {path?: string, token?: string}} value - Debug endpoint configuration.
   * @returns {{enabled: boolean, path: string, token: string | null}} - Normalized debug endpoint configuration.
   */
  _normalizeDebugEndpoint(value) {
    if (value === false || value === undefined) return {enabled: false, path: "/velocious/debug", token: null}
    if (value === true) return {enabled: true, path: "/velocious/debug", token: null}

    if (typeof value !== "object" || value === null) {
      throw new Error(`Expected debugEndpoint to be a boolean or object, got: ${String(value)}`)
    }

    const path = value.path || "/velocious/debug"

    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error(`Expected debugEndpoint.path to be a string starting with '/', got: ${String(path)}`)
    }

    const token = value.token === undefined || value.token === null ? null : value.token

    if (token !== null && (typeof token !== "string" || !token.trim())) {
      throw new Error(`Expected debugEndpoint.token to be a non-empty string, got: ${String(token)}`)
    }

    return {enabled: true, path, token: token === null ? null : token.trim()}
  }

  /**
   * Runs normalize api manifest.
   * @param {boolean | {path?: string, token?: string}} value - API manifest configuration.
   * @returns {{enabled: boolean, path: string, token: string | null}} - Normalized API manifest configuration.
   */
  _normalizeApiManifest(value) {
    if (value === false || value === undefined) return {enabled: false, path: "/api/manifest", token: null}
    if (value === true) return {enabled: true, path: "/api/manifest", token: null}

    if (typeof value !== "object" || value === null) {
      throw new Error(`Expected apiManifest to be a boolean or object, got: ${String(value)}`)
    }

    const path = value.path || "/api/manifest"

    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error(`Expected apiManifest.path to be a string starting with '/', got: ${String(path)}`)
    }

    const token = value.token === undefined || value.token === null ? null : value.token

    if (token !== null && (typeof token !== "string" || !token.trim())) {
      throw new Error(`Expected apiManifest.token to be a non-empty string, got: ${String(token)}`)
    }

    return {enabled: true, path, token: token === null ? null : token.trim()}
  }

  /**
   * Runs add api manifest route hook.
   * @returns {void} - No return value.
   */
  _addApiManifestRouteHook() {
    if (!this._apiManifest.enabled) return

    this.addRouteResolverHook(({currentPath, request}) => {
      if (request.httpMethod() !== "GET") return null
      if (currentPath !== this._apiManifest.path) return null

      if (this._apiManifest.token && !this.debugEndpointRequestAuthorized(request, this._apiManifest.token)) return null

      return {
        action: "show",
        controller: "velociousApiManifest",
        controllerPath: "./built-in/api-manifest/controller.js",
        skipControllerConnections: true,
        skipAbilityResolution: true,
        skipTenantResolution: true,
        viewPath: "./built-in/api-manifest"
      }
    })
  }

  /**
   * Runs add debug endpoint route hook.
   * @returns {void} - No return value.
   */
  _addDebugEndpointRouteHook() {
    if (!this._debugEndpoint.enabled) return

    this.addRouteResolverHook(({currentPath, request}) => {
      if (request.httpMethod() !== "GET") return null
      if (currentPath !== this._debugEndpoint.path) return null

      // When a token is configured, an unauthenticated request gets no route at
      // all (404) rather than a 401, so the endpoint's existence stays hidden.
      if (this._debugEndpoint.token && !this.debugEndpointRequestAuthorized(request, this._debugEndpoint.token)) return null

      return {
        action: "show",
        controller: "velociousDebug",
        controllerPath: "./built-in/debug/controller.js",
        skipControllerConnections: true,
        skipAbilityResolution: true,
        skipTenantResolution: true,
        viewPath: "./built-in/debug"
      }
    })
  }

  /**
   * Runs set autoload.
   * @param {boolean} newValue - Whether auto-batch-preload of relationships is enabled.
   * @returns {void}
   */
  setAutoload(newValue) { this._autoload = newValue }

  /**
   * Runs get cors.
   * @returns {import("./configuration-types.js").CorsType | undefined} - The cors.
   */
  getCors() {
    return this.cors
  }

  /**
   * Runs get cookie secret.
   * @returns {string | undefined} - Cookie secret.
   */
  getCookieSecret() {
    return this._cookieSecret
  }

  /**
   * Runs get sync configuration.
   * @returns {import("./configuration-types.js").VelociousSyncConfiguration} - Sync configuration.
   */
  getSyncConfiguration() {
    return this._sync
  }

  /**
   * Runs current offline grant signing key.
   * @returns {import("./sync/offline-grant.js").OfflineGrantSigningKey} - Current signing key.
   */
  currentOfflineGrantSigningKey() {
    const signingKeys = this.getSyncConfiguration().offlineGrantSigningKeys

    return currentOfflineGrantSigningKey(signingKeys)
  }

  /**
   * Normalizes sync configuration.
   * @param {import("./configuration-types.js").VelociousSyncConfiguration | undefined} sync - Sync configuration.
   * @returns {import("./configuration-types.js").VelociousSyncConfiguration} - Normalized sync configuration.
   */
  _normalizeSyncConfiguration(sync) {
    const api = sync?.api
    const deviceCertificateBackendPublicKey = sync?.deviceCertificateBackendPublicKey || null
    const changeFeedRetentionSize = sync?.changeFeedRetentionSize
    const offlineGrantSigningKeys = sync?.offlineGrantSigningKeys || []
    const offlineGrantTtlMs = sync?.offlineGrantTtlMs

    if (deviceCertificateBackendPublicKey !== null && (typeof deviceCertificateBackendPublicKey !== "object" || Array.isArray(deviceCertificateBackendPublicKey))) {
      throw new Error("sync.deviceCertificateBackendPublicKey must be a public JSON Web Key object")
    }
    if (changeFeedRetentionSize !== undefined && (!Number.isInteger(changeFeedRetentionSize) || changeFeedRetentionSize <= 0)) {
      throw new Error("sync.changeFeedRetentionSize must be a positive integer")
    }
    if (!Array.isArray(offlineGrantSigningKeys)) throw new Error("sync.offlineGrantSigningKeys must be an array")
    if (offlineGrantTtlMs !== undefined && (!Number.isInteger(offlineGrantTtlMs) || offlineGrantTtlMs <= 0)) {
      throw new Error("sync.offlineGrantTtlMs must be a positive integer number of milliseconds")
    }

    return {
      api: this._normalizeSyncApiConfiguration(api),
      changeFeedRetentionSize: changeFeedRetentionSize || 10000,
      client: this._normalizeSyncClientConfiguration(sync?.client),
      deviceCertificateBackendPublicKey,
      offlineGrantSigningKeys: offlineGrantSigningKeys.map((key) => normalizeOfflineGrantSigningKey(key)),
      offlineGrantTtlMs: offlineGrantTtlMs || 24 * 60 * 60 * 1000
    }
  }

  /**
   * Normalizes client-side sync configuration consumed by `SyncClient.fromConfiguration(...)`.
   * @param {import("./configuration-types.js").VelociousSyncClientConfiguration | undefined} client - Client-side sync configuration.
   * @returns {import("./configuration-types.js").VelociousSyncClientConfiguration | undefined} - Normalized client-side sync configuration.
   */
  _normalizeSyncClientConfiguration(client) {
    if (client === undefined || client === null) return undefined

    if (typeof client !== "object" || Array.isArray(client)) {
      throw new Error("sync.client must be an object with transport and authenticationToken")
    }

    const {authenticationToken, batchSize, isOnline, mountPath, onError, realtime, transport, websocketClient, websocketUrl, ...restClient} = client
    const restClientKeys = Object.keys(restClient)

    if (restClientKeys.length > 0) {
      throw new Error(`sync.client received unknown keys: ${restClientKeys.join(", ")} (supported: authenticationToken, batchSize, isOnline, mountPath, onError, realtime, transport, websocketClient, websocketUrl)`)
    }
    if (!transport || typeof transport !== "object" || typeof transport.post !== "function") {
      throw new Error("sync.client.transport must be an object with a post(path, body) method (like the frontend-model websocket client)")
    }
    if (typeof authenticationToken !== "function") {
      throw new Error("sync.client.authenticationToken must be a function resolving the auth token sent with sync requests")
    }
    if (isOnline !== undefined && typeof isOnline !== "function") {
      throw new Error("sync.client.isOnline must be a function resolving connectivity")
    }
    if (onError !== undefined && typeof onError !== "function") {
      throw new Error("sync.client.onError must be a function reporting background sync failures")
    }
    if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize <= 0)) {
      throw new Error("sync.client.batchSize must be a positive integer")
    }
    if (mountPath !== undefined && (typeof mountPath !== "string" || !mountPath.startsWith("/"))) {
      throw new Error(`sync.client.mountPath must start with '/', got: ${String(mountPath)}`)
    }
    if (websocketClient !== undefined && (typeof websocketClient !== "object" || websocketClient === null || typeof websocketClient.subscribeChannel !== "function")) {
      throw new Error("sync.client.websocketClient must be a websocket client with a subscribeChannel method (like VelociousWebsocketClient)")
    }
    if (websocketUrl !== undefined && typeof websocketUrl !== "string" && typeof websocketUrl !== "function") {
      throw new Error(`sync.client.websocketUrl must be a URL string or a function resolving one, got: ${String(websocketUrl)}`)
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
    }
  }

  /**
   * Normalizes sync API endpoint configuration.
   * @param {import("./configuration-types.js").VelociousSyncApiConfiguration | undefined} api - Sync API configuration.
   * @returns {import("./configuration-types.js").VelociousSyncApiConfiguration | undefined} - Normalized sync API configuration.
   */
  _normalizeSyncApiConfiguration(api) {
    if (api === undefined || api === null) return undefined

    if (typeof api !== "object" || Array.isArray(api)) {
      throw new Error("sync.api must be an object with a resourceClass")
    }

    const {mountPath, resourceClass} = api

    if (typeof resourceClass !== "function") {
      throw new Error(`sync.api.resourceClass must be a resource class, got: ${String(resourceClass)}`)
    }
    if (!resourceClass.ModelClass) {
      throw new Error(`sync.api.resourceClass ${resourceClass.name} must define static ModelClass`)
    }
    if (mountPath !== undefined && (typeof mountPath !== "string" || !mountPath.startsWith("/"))) {
      throw new Error(`sync.api.mountPath must start with '/', got: ${String(mountPath)}`)
    }

    return {mountPath, resourceClass}
  }

  /**
   * Runs get database configuration.
   * @returns {Record<string, import("./configuration-types.js").DatabaseConfigurationType>} - The database configuration.
   */
  getDatabaseConfiguration() {
    if (!this.database) throw new Error("No database configuration")

    if (!this.database[this.getEnvironment()]) {
      throw new Error(`No database configuration for environment: ${this.getEnvironment()} - ${Object.keys(this.database).join(", ")}`)
    }

    return digg(this, "database", this.getEnvironment())
  }

  /**
   * Runs resolve database configuration.
   * @param {string} identifier - Identifier.
   * @param {?} [tenant] - Tenant override.
   * @returns {import("./configuration-types.js").DatabaseConfigurationType} - Resolved database configuration for the identifier.
   */
  resolveDatabaseConfiguration(identifier, tenant = this.getCurrentTenant()) {
    const databaseConfiguration = this.getDatabaseConfiguration()[identifier]

    if (!databaseConfiguration) {
      throw new Error(`No such database identifier configured: ${identifier}`)
    }

    if (tenant === undefined || !this._tenantDatabaseResolver) {
      return databaseConfiguration
    }

    const overrideConfiguration = this._tenantDatabaseResolver({
      configuration: this,
      databaseConfiguration,
      identifier,
      tenant
    })

    return mergeDatabaseConfiguration(databaseConfiguration, overrideConfiguration)
  }

  /**
   * Runs get disabled database identifiers.
   * @returns {Set<string>} - Disabled database identifiers from env flags.
   */
  getDisabledDatabaseIdentifiers() {
    const disabledIdentifiers = new Set()
    const disabledIdentifiersRaw = process.env.VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS

    if (disabledIdentifiersRaw) {
      for (const identifier of disabledIdentifiersRaw.split(",")) {
        const trimmed = identifier.trim()

        if (trimmed) disabledIdentifiers.add(trimmed)
      }
    }

    if (process.env.VELOCIOUS_DISABLE_MSSQL === "1") {
      disabledIdentifiers.add("mssql")
    }

    return disabledIdentifiers
  }

  /**
   * Runs is database identifier active.
   * @param {string} identifier - Database identifier.
   * @param {?} [tenant] - Tenant override.
   * @returns {boolean} - Whether this database identifier is active in the current tenant context.
   */
  isDatabaseIdentifierActive(identifier, tenant = this.getCurrentTenant()) {
    const databaseConfiguration = this.getDatabaseConfiguration()[identifier]

    if (!databaseConfiguration) {
      throw new Error(`No such database identifier configured: ${identifier}`)
    }

    if (!databaseConfiguration.tenantOnly) return true
    if (tenant === undefined || !this._tenantDatabaseResolver) return false

    const overrideConfiguration = this._tenantDatabaseResolver({
      configuration: this,
      databaseConfiguration,
      identifier,
      tenant
    })

    return Boolean(overrideConfiguration)
  }

  /**
   * Runs get database identifiers.
   * @returns {Array<string>} - The database identifiers.
   */
  getDatabaseIdentifiers() {
    const identifiers = Object.keys(this.getDatabaseConfiguration())
    const disabledIdentifiers = this.getDisabledDatabaseIdentifiers()

    return identifiers.filter((identifier) => !disabledIdentifiers.has(identifier) && this.isDatabaseIdentifierActive(identifier))
  }

  /**
   * Runs get debug snapshot.
   * @returns {Promise<Record<string, ?>>} - Human-readable server diagnostics.
   */
  async getDebugSnapshot() {
    const localSnapshot = this.getLocalDebugSnapshot()

    return {
      ...localSnapshot,
      httpServer: await this._debugHttpServerSnapshot()
    }
  }

  /**
   * Runs get local debug snapshot.
   * @returns {Record<string, ?>} - Human-readable diagnostics for this process only.
   */
  getLocalDebugSnapshot() {
    return {
      backgroundJobs: this._debugBackgroundJobsSnapshot(),
      configuration: this._debugConfigurationSnapshot(),
      database: this._debugDatabaseSnapshot(),
      generatedAt: new Date().toISOString(),
      server: this._debugServerSnapshot(),
      websockets: this._debugWebsocketSnapshot()
    }
  }

  /**
   * Runs debug http server snapshot.
   * @returns {Promise<Record<string, ?>>} - HTTP server worker diagnostics.
   */
  async _debugHttpServerSnapshot() {
    const httpServer = /** @type {{getDebugSnapshot?: () => Promise<Record<string, ?>>} | undefined} */ (this._httpServerInstance)

    if (!httpServer?.getDebugSnapshot) {
      return {configured: Boolean(this.httpServer), active: false}
    }

    return await httpServer.getDebugSnapshot()
  }

  /**
   * Runs debug server snapshot.
   * @returns {Record<string, ?>} - Server runtime diagnostics.
   */
  _debugServerSnapshot() {
    const nodeProcess = typeof process === "undefined" ? undefined : process

    return {
      environment: this.getEnvironment(),
      memoryUsage: nodeProcess ? nodeProcess.memoryUsage() : undefined,
      nodeVersion: nodeProcess?.versions?.node,
      pid: nodeProcess?.pid,
      platform: nodeProcess?.platform,
      uptimeSeconds: nodeProcess ? nodeProcess.uptime() : undefined
    }
  }

  /**
   * Runs debug configuration snapshot.
   * @returns {Record<string, ?>} - Configuration diagnostics.
   */
  _debugConfigurationSnapshot() {
    return {
      apiManifest: this._apiManifestEnabled() ? {enabled: true, path: this._apiManifest.path, tokenConfigured: Boolean(this._apiManifest.token)} : {enabled: false},
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
    }
  }

  /**
   * Runs debug background jobs snapshot.
   * @returns {Record<string, ?>} - Background job diagnostics.
   */
  _debugBackgroundJobsSnapshot() {
    return {
      configured: Boolean(this._backgroundJobs),
      scheduledConfigured: Boolean(this._scheduledBackgroundJobs)
    }
  }

  /**
   * Runs debug database snapshot.
   * @returns {Record<string, ?>} - Database diagnostics.
   */
  _debugDatabaseSnapshot() {
    /**
     * Database pools.
     * @type {Record<string, import("./database/pool/base.js").DatabasePoolDebugSnapshot>} */
    const databasePools = {}
    const activeIdentifiers = this.getDatabaseIdentifiers()

    for (const identifier of activeIdentifiers) {
      databasePools[identifier] = this.getDatabasePool(identifier).getDebugSnapshot()
    }

    return {
      activeIdentifiers,
      disabledIdentifiers: Array.from(this.getDisabledDatabaseIdentifiers()),
      initializedPools: Object.keys(this.databasePools),
      pools: databasePools
    }
  }

  /**
   * Runs debug websocket snapshot.
   * @returns {Record<string, ?>} - WebSocket diagnostics.
   */
  _debugWebsocketSnapshot() {
    /**
     * Session buckets.
     * @type {Map<string, {count: number, details: {channelSubscriptionCount: number, channelSubscriptions: {channelType: string, count: number, model: string | null}[], connectionCount: number, paused: boolean, subscriptionCount: number}}>} */
    const sessionBuckets = new Map()
    /**
     * Session details.
     * @type {{channelSubscriptionCount: number, channelSubscriptions: {channelType: string, count: number, model: string | null}[], connectionCount: number, paused: boolean, queuedMessageCount: number, subscriptionCount: number}[]} */
    const sessionDetails = []
    const subscriptions = Array.from(this._websocketChannelSubscriptions.entries()).map(([channel, channelSubscriptions]) => {
      /**
       * Details buckets.
       * @type {Map<string, {count: number, details: Record<string, ?>}>} */
      const detailsBuckets = new Map()

      for (const subscription of channelSubscriptions) {
        const details = /** @type {Record<string, ?>} */ (canonicalDebugSnapshotValue(subscription.debugSnapshot()))
        const key = JSON.stringify(details)
        const existingBucket = detailsBuckets.get(key)

        if (existingBucket) {
          existingBucket.count += 1
        } else {
          detailsBuckets.set(key, {count: 1, details})
        }
      }

      return {
        channel,
        count: channelSubscriptions.size,
        details: Array.from(detailsBuckets.values()).sort((a, b) => b.count - a.count)
      }
    })

    for (const session of this._websocketSessions) {
      /**
       * Channel subscription buckets.
       * @type {Map<string, {channelType: string, count: number, model: string | null}>} */
      const channelSubscriptionBuckets = new Map()

      for (const {channelType, subscription} of session._channelSubscriptions.values()) {
        const details = /** @type {Record<string, ?>} */ (subscription.debugSnapshot())
        const model = typeof details.model === "string" ? details.model : null
        const key = JSON.stringify({channelType, model})
        const existingBucket = channelSubscriptionBuckets.get(key)

        if (existingBucket) {
          existingBucket.count += 1
        } else {
          channelSubscriptionBuckets.set(key, {channelType, count: 1, model})
        }
      }

      const channelSubscriptions = Array.from(channelSubscriptionBuckets.values()).sort((a, b) => b.count - a.count)
      const snapshot = {
        channelSubscriptionCount: session._channelSubscriptions.size,
        channelSubscriptions,
        connectionCount: session._connections.size,
        paused: session._paused,
        queuedMessageCount: session._outboundQueue.length,
        subscriptionCount: session.subscriptions.size
      }
      const bucketKey = JSON.stringify({
        channelSubscriptionCount: snapshot.channelSubscriptionCount,
        channelSubscriptions: snapshot.channelSubscriptions,
        connectionCount: snapshot.connectionCount,
        paused: snapshot.paused,
        subscriptionCount: snapshot.subscriptionCount
      })
      const existingBucket = sessionBuckets.get(bucketKey)

      if (existingBucket) {
        existingBucket.count += 1
      } else {
        sessionBuckets.set(bucketKey, {
          count: 1,
          details: {
            channelSubscriptionCount: snapshot.channelSubscriptionCount,
            channelSubscriptions: snapshot.channelSubscriptions,
            connectionCount: snapshot.connectionCount,
            paused: snapshot.paused,
            subscriptionCount: snapshot.subscriptionCount
          }
        })
      }
      sessionDetails.push(snapshot)
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
    }
  }

  /**
   * Runs get database pool.
   * @param {string} identifier - Identifier.
   * @returns {import("./database/pool/base.js").default} - The database pool.
   */
  getDatabasePool(identifier = "default") {
    if (!this.isDatabasePoolInitialized(identifier)) {
      this.initializeDatabasePool(identifier)
    }

    return digg(this, "databasePools", identifier)
  }

  /**
   * Runs get database identifier.
   * @param {string} identifier - Identifier.
   * @returns {import("./configuration-types.js").DatabaseConfigurationType})
   */
  getDatabaseIdentifier(identifier) {
    return this.resolveDatabaseConfiguration(identifier)
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
        pool.clearSchemaCache()
      }
    }
  }

  /**
   * Runs get database pool type.
   * @param {string} identifier - Identifier.
   * @returns {typeof import("./database/pool/base.js").default} - The database pool type.
   */
  getDatabasePoolType(identifier = "default") {
    const poolTypeClass = digg(this.getDatabaseIdentifier(identifier), "poolType")

    if (!poolTypeClass) {
      throw new Error("No poolType given in database configuration")
    }

    return poolTypeClass
  }

  getDatabaseType(identifier = "default") {
    const databaseType = this.getDatabaseIdentifier(identifier).type

    if (!databaseType) throw new Error("No database type given in database configuration")

    return databaseType
  }

  /**
   * Runs get directory.
   * @returns {string} - The directory.
   */
  getDirectory() {
    const directory = this.getDirectoryIfAvailable()

    if (!directory) throw new Error("No directory configured and process.cwd is unavailable")

    return directory
  }

  /**
   * Runs get directory if available.
   * @returns {string | undefined} - The directory when the runtime can resolve one.
   */
  getDirectoryIfAvailable() {
    if (!this._directory) {
      this._directory = currentWorkingDirectory()
    }

    return this._directory
  }

  /**
   * Runs get backend projects.
   * @returns {import("./configuration-types.js").BackendProjectConfiguration[]} - Backend projects.
   */
  getBackendProjects() { return this._backendProjects }

  /**
   * Runs get packages.
   * @returns {VelociousPackage[]} - Registered Velocious packages.
   */
  getPackages() { return this._packages }

  /**
   * Runs get ability resources.
   * @returns {import("./configuration-types.js").AbilityResourceClassType[]} - Ability resource classes.
   */
  getAbilityResources() { return this._abilityResources }

  /**
   * Runs set ability resources.
   * @param {import("./configuration-types.js").AbilityResourceClassType[]} resources - Ability resource classes.
   * @returns {void} - No return value.
   */
  setAbilityResources(resources) { this._abilityResources = resources }

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
    const merged = [...this._abilityResources]
    const seen = new Set(merged)

    for (const backendProject of this._backendProjects) {
      if (!backendProject.abilityResources) continue

      for (const ResourceClass of backendProject.abilityResources) {
        if (seen.has(ResourceClass)) continue

        seen.add(ResourceClass)
        merged.push(ResourceClass)
      }
    }

    this._abilityResources = merged
  }

  /**
   * Runs get ability resolver.
   * @returns {import("./configuration-types.js").AbilityResolverType | undefined} - Ability resolver.
   */
  getAbilityResolver() { return this._abilityResolver }

  /**
   * Runs get tenant resolver.
   * @returns {import("./configuration-types.js").TenantResolverType | undefined} - Tenant resolver.
   */
  getTenantResolver() { return this._tenantResolver }

  /**
   * Runs get tenant database resolver.
   * @returns {import("./configuration-types.js").TenantDatabaseResolverType | undefined} - Tenant database resolver.
   */
  getTenantDatabaseResolver() { return this._tenantDatabaseResolver }

  /**
   * Runs get enforce tenant database scopes.
   * @returns {boolean} - Whether tenant-switched models require a resolved tenant database identifier.
   */
  getEnforceTenantDatabaseScopes() { return this._enforceTenantDatabaseScopes }

  /**
   * Runs get tenant database providers.
   * @returns {Record<string, import("./configuration-types.js").TenantDatabaseProviderType>} - Tenant database lifecycle providers.
   */
  getTenantDatabaseProviders() { return this._tenantDatabaseProviders }

  /**
   * Runs get tenant database provider.
   * @param {string} identifier - Database identifier.
   * @returns {import("./configuration-types.js").TenantDatabaseProviderType} - Tenant database lifecycle provider.
   */
  getTenantDatabaseProvider(identifier) {
    const provider = this._tenantDatabaseProviders[identifier]

    if (!provider) {
      throw new Error(`No tenant database provider configured for database identifier: ${identifier}`)
    }

    return provider
  }

  /**
   * Runs get attachments configuration.
   * @returns {import("./configuration-types.js").AttachmentsConfiguration} - Attachments configuration.
   */
  getAttachmentsConfiguration() { return this._attachments || {} }

  /**
   * Runs get route resolver hooks.
   * @returns {import("./configuration-types.js").RouteResolverHookType[]} - Route resolver hooks.
   */
  getRouteResolverHooks() { return this._routeResolverHooks }

  /**
   * Runs add route resolver hook.
   * @param {import("./configuration-types.js").RouteResolverHookType} hook - Route resolver hook.
   * @returns {void} - No return value.
   */
  addRouteResolverHook(hook) {
    this._routeResolverHooks.push(hook)
  }

  /**
   * Runs set ability resolver.
   * @param {import("./configuration-types.js").AbilityResolverType | undefined} resolver - Ability resolver.
   * @returns {void} - No return value.
   */
  setAbilityResolver(resolver) { this._abilityResolver = resolver }

  /**
   * Runs set tenant resolver.
   * @param {import("./configuration-types.js").TenantResolverType | undefined} resolver - Tenant resolver.
   * @returns {void} - No return value.
   */
  setTenantResolver(resolver) { this._tenantResolver = resolver }

  /**
   * Runs set tenant database resolver.
   * @param {import("./configuration-types.js").TenantDatabaseResolverType | undefined} resolver - Tenant database resolver.
   * @returns {void} - No return value.
   */
  setTenantDatabaseResolver(resolver) { this._tenantDatabaseResolver = resolver }

  /**
   * Runs set enforce tenant database scopes.
   * @param {boolean} newValue - Whether tenant-switched models require a resolved tenant database identifier.
   * @returns {void} - No return value.
   */
  setEnforceTenantDatabaseScopes(newValue) { this._enforceTenantDatabaseScopes = newValue }

  /**
   * Runs set tenant database providers.
   * @param {Record<string, import("./configuration-types.js").TenantDatabaseProviderType>} providers - Tenant database lifecycle providers.
   * @returns {void} - No return value.
   */
  setTenantDatabaseProviders(providers) { this._tenantDatabaseProviders = providers }

  /**
   * Runs get environment.
   * @returns {string} - The environment.
   */
  getEnvironment() { return digg(this, "_environment") }

  /**
   * Runs get request timeout ms.
   * @returns {number} - Request timeout in seconds.
   */
  getRequestTimeoutMs() {
    const envTimeout = this._parseRequestTimeoutSeconds(process.env.VELOCIOUS_REQUEST_TIMEOUT_MS)
    const value = typeof this._requestTimeoutMs === "function"
      ? this._requestTimeoutMs()
      : this._requestTimeoutMs

    if (typeof value === "number") return value
    if (typeof envTimeout === "number" && Number.isFinite(envTimeout)) return envTimeout

    return 60
  }

  /**
   * Runs parse request timeout seconds.
   * @param {string | undefined} rawValue - Env value.
   * @returns {number | undefined} - Timeout in seconds.
   */
  _parseRequestTimeoutSeconds(rawValue) {
    if (rawValue === undefined) return undefined

    const trimmed = rawValue.trim().toLowerCase()

    if (!trimmed) return undefined

    const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s)?$/)

    if (!match) return undefined

    const numeric = Number(match[1])

    if (!Number.isFinite(numeric)) return undefined

    const unit = match[2]

    if (unit === "ms") return numeric / 1000
    if (unit === "s") return numeric

    if (trimmed.includes(".")) return numeric
    if (numeric >= 1000) return numeric / 1000

    return numeric
  }

  /**
   * Runs set environment.
   * @param {string} newEnvironment - New environment.
   * @returns {void} - No return value.
   */
  setEnvironment(newEnvironment) { this._environment = newEnvironment }

  /**
   * Runs get logging configuration.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.defaultConsole] - Whether default console.
   * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Pick<import("./configuration-types.js").LoggingConfiguration, "directory" | "filePath"> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>} - The logging configuration.
   */
  getLoggingConfiguration({defaultConsole} = {}) {
    const environment = this.getEnvironment()
    const environmentHandler = this.getEnvironmentHandler()
    const directory = this._logging?.directory || environmentHandler.getDefaultLogDirectory({configuration: this})
    const filePath = this._logging?.filePath || environmentHandler.getLogFilePath({configuration: this, directory, environment})
    const consoleOverride = this._logging?.console
    const hasLoggingConfig = Boolean(this._logging)
    const fileLogging = hasLoggingConfig ? (this._logging?.file ?? Boolean(filePath)) : false
    const configuredLevels = this._logging?.levels
    const includeLowLevelDebug = this._logging?.debugLowLevel === true
    const loggers = this._logging?.loggers

    const consoleDefault = defaultConsole !== undefined ? defaultConsole : true
    const consoleLogging = consoleOverride !== undefined ? consoleOverride : consoleDefault

    /**
     * Default levels.
     * @type {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} */
    const defaultLevels = ["info", "warn", "error"]

    if (includeLowLevelDebug) defaultLevels.unshift("debug-low-level")

    const levels = configuredLevels || defaultLevels

    return {
      console: consoleLogging,
      directory,
      file: fileLogging ?? false,
      filePath,
      loggers,
      levels,
      outputs: this._logging?.outputs
    }
  }

  /**
   * Runs get query logging enabled.
   * @returns {boolean} - Whether database query logging is enabled.
   */
  getQueryLoggingEnabled() {
    if (this._logging?.queryLogging !== undefined) return this._logging.queryLogging

    return this.getEnvironment() !== "test"
  }

  /**
   * Runs get background jobs config.
   * @returns {Required<import("./configuration-types.js").BackgroundJobsConfiguration> & {retention: import("./configuration-types.js").ResolvedBackgroundJobsRetentionConfiguration}} - Background jobs configuration.
   */
  getBackgroundJobsConfig() {
    const envHost = process.env.VELOCIOUS_BACKGROUND_JOBS_HOST
    const envPortRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_PORT
    const envDatabaseIdentifier = process.env.VELOCIOUS_BACKGROUND_JOBS_DATABASE_IDENTIFIER
    const envMaxConcurrentForkedRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_MAX_CONCURRENT_FORKED_JOBS
    const envMaxConcurrentRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_MAX_CONCURRENT_INLINE_JOBS
    const envPooledRunnerCountRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_COUNT
    const envPooledRunnerConcurrencyRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_CONCURRENCY
    const envPooledRunnerMaxJobsRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_JOBS
    const envPooledRunnerMaxRssBytesRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_RSS_BYTES
    const envPooledRunnerMaxLifetimeMsRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_LIFETIME_MS
    const envDispatchStrategy = process.env.VELOCIOUS_BACKGROUND_JOBS_DISPATCH_STRATEGY
    const envPollIntervalRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_POLL_INTERVAL_MS
    const envJobTimeoutRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS
    const envPort = envPortRaw ? Number(envPortRaw) : undefined
    const envMaxConcurrentForked = envMaxConcurrentForkedRaw ? Number(envMaxConcurrentForkedRaw) : undefined
    const envMaxConcurrent = envMaxConcurrentRaw ? Number(envMaxConcurrentRaw) : undefined
    const envPooledRunnerCount = envPooledRunnerCountRaw ? Number(envPooledRunnerCountRaw) : undefined
    const envPooledRunnerConcurrency = envPooledRunnerConcurrencyRaw ? Number(envPooledRunnerConcurrencyRaw) : undefined
    const envPooledRunnerMaxJobs = envPooledRunnerMaxJobsRaw ? Number(envPooledRunnerMaxJobsRaw) : undefined
    const envPooledRunnerMaxRssBytes = envPooledRunnerMaxRssBytesRaw ? Number(envPooledRunnerMaxRssBytesRaw) : undefined
    const envPooledRunnerMaxLifetimeMs = envPooledRunnerMaxLifetimeMsRaw ? Number(envPooledRunnerMaxLifetimeMsRaw) : undefined
    const envPollInterval = envPollIntervalRaw ? Number(envPollIntervalRaw) : undefined
    const envJobTimeout = envJobTimeoutRaw ? Number(envJobTimeoutRaw) : undefined
    const configured = this._backgroundJobs || {}
    const host = configured.host || envHost || "127.0.0.1"
    const port = typeof configured.port === "number"
      ? configured.port
      : (typeof envPort === "number" && Number.isFinite(envPort) ? envPort : 7331)
    const databaseIdentifier = configured.databaseIdentifier || envDatabaseIdentifier || "default"
    const maxConcurrentInlineJobs = typeof configured.maxConcurrentInlineJobs === "number" && configured.maxConcurrentInlineJobs >= 1
      ? configured.maxConcurrentInlineJobs
      : (typeof envMaxConcurrent === "number" && Number.isFinite(envMaxConcurrent) && envMaxConcurrent >= 1 ? envMaxConcurrent : 4)
    const maxConcurrentForkedJobs = typeof configured.maxConcurrentForkedJobs === "number" && configured.maxConcurrentForkedJobs >= 1
      ? configured.maxConcurrentForkedJobs
      : (typeof envMaxConcurrentForked === "number" && Number.isFinite(envMaxConcurrentForked) && envMaxConcurrentForked >= 1 ? envMaxConcurrentForked : 4)
    const pooledRunnerCount = typeof configured.pooledRunnerCount === "number" && Number.isFinite(configured.pooledRunnerCount) && Number.isInteger(configured.pooledRunnerCount) && configured.pooledRunnerCount >= 1
      ? configured.pooledRunnerCount
      : (!("pooledRunnerCount" in configured) && typeof envPooledRunnerCount === "number" && Number.isFinite(envPooledRunnerCount) && Number.isInteger(envPooledRunnerCount) && envPooledRunnerCount >= 1 ? envPooledRunnerCount : 4)
    const pooledRunnerConcurrency = typeof configured.pooledRunnerConcurrency === "number" && Number.isFinite(configured.pooledRunnerConcurrency) && Number.isInteger(configured.pooledRunnerConcurrency) && configured.pooledRunnerConcurrency >= 1
      ? configured.pooledRunnerConcurrency
      : (!("pooledRunnerConcurrency" in configured) && typeof envPooledRunnerConcurrency === "number" && Number.isFinite(envPooledRunnerConcurrency) && Number.isInteger(envPooledRunnerConcurrency) && envPooledRunnerConcurrency >= 1 ? envPooledRunnerConcurrency : 1)
    const pooledRunnerMaxJobs = typeof configured.pooledRunnerMaxJobs === "number" && Number.isFinite(configured.pooledRunnerMaxJobs) && Number.isInteger(configured.pooledRunnerMaxJobs) && configured.pooledRunnerMaxJobs >= 1
      ? configured.pooledRunnerMaxJobs
      : (!("pooledRunnerMaxJobs" in configured) && typeof envPooledRunnerMaxJobs === "number" && Number.isFinite(envPooledRunnerMaxJobs) && Number.isInteger(envPooledRunnerMaxJobs) && envPooledRunnerMaxJobs >= 1 ? envPooledRunnerMaxJobs : 100)
    const pooledRunnerMaxRssBytes = typeof configured.pooledRunnerMaxRssBytes === "number" && Number.isFinite(configured.pooledRunnerMaxRssBytes) && configured.pooledRunnerMaxRssBytes >= 1
      ? configured.pooledRunnerMaxRssBytes
      : (!("pooledRunnerMaxRssBytes" in configured) && typeof envPooledRunnerMaxRssBytes === "number" && Number.isFinite(envPooledRunnerMaxRssBytes) && envPooledRunnerMaxRssBytes >= 1 ? envPooledRunnerMaxRssBytes : 512 * 1024 * 1024)
    const pooledRunnerMaxLifetimeMs = typeof configured.pooledRunnerMaxLifetimeMs === "number" && Number.isFinite(configured.pooledRunnerMaxLifetimeMs) && configured.pooledRunnerMaxLifetimeMs >= 1
      ? configured.pooledRunnerMaxLifetimeMs
      : (!("pooledRunnerMaxLifetimeMs" in configured) && typeof envPooledRunnerMaxLifetimeMs === "number" && Number.isFinite(envPooledRunnerMaxLifetimeMs) && envPooledRunnerMaxLifetimeMs >= 1 ? envPooledRunnerMaxLifetimeMs : 60 * 60 * 1000)
    const dispatchStrategyRaw = configured.dispatchStrategy || envDispatchStrategy
    const dispatchStrategy = dispatchStrategyRaw === "polling" ? "polling" : "beacon"
    const pollIntervalMs = typeof configured.pollIntervalMs === "number" && configured.pollIntervalMs >= 1
      ? configured.pollIntervalMs
      : (typeof envPollInterval === "number" && Number.isFinite(envPollInterval) && envPollInterval >= 1 ? envPollInterval : 1000)
    const queues = configured.queues && typeof configured.queues === "object" ? configured.queues : {}
    // An explicit config value wins over the env var — including `null`/`0`,
    // which disable the backstop even when the environment sets a default.
    // Only fall through to the env var when config omits `jobTimeoutMs` entirely.
    const jobTimeoutMs = "jobTimeoutMs" in configured
      ? (typeof configured.jobTimeoutMs === "number" && configured.jobTimeoutMs > 0 ? configured.jobTimeoutMs : null)
      : (typeof envJobTimeout === "number" && Number.isFinite(envJobTimeout) && envJobTimeout > 0 ? envJobTimeout : null)
    const configuredRetention = configured.retention && typeof configured.retention === "object" ? configured.retention : {}
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
    }

    return {host, port, databaseIdentifier, maxConcurrentForkedJobs, maxConcurrentInlineJobs, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, dispatchStrategy, pollIntervalMs, queues, jobTimeoutMs, retention}
  }

  /**
   * Runs set background jobs config.
   * @param {import("./configuration-types.js").BackgroundJobsConfiguration} backgroundJobs - Background jobs config.
   * @returns {void}
   */
  setBackgroundJobsConfig(backgroundJobs) {
    this._backgroundJobs = Object.assign({}, this._backgroundJobs, backgroundJobs)
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
    const configured = this._beacon || {}
    const inProcess = configured.inProcess === true

    if (inProcess && (configured.host || typeof configured.port === "number")) {
      throw new Error("Beacon configuration: `inProcess: true` is mutually exclusive with `host`/`port`. Use one or the other.")
    }

    const envHost = inProcess ? undefined : process.env.VELOCIOUS_BEACON_HOST
    const envPortRaw = inProcess ? undefined : process.env.VELOCIOUS_BEACON_PORT
    const envPort = envPortRaw ? Number(envPortRaw) : undefined
    const host = configured.host || envHost || "127.0.0.1"
    const port = typeof configured.port === "number"
      ? configured.port
      : (typeof envPort === "number" && Number.isFinite(envPort) ? envPort : 7330)

    let enabled

    if (typeof configured.enabled === "boolean") {
      enabled = configured.enabled
    } else {
      enabled = Boolean(inProcess || configured.host || configured.port || envHost || envPort)
    }

    const unreachableReportMs = resolveBeaconUnreachableReportMs(configured.unreachableReportMs)

    return {enabled, host, port, peerType: configured.peerType, inProcess, unreachableReportMs}
  }

  /**
   * Runs set beacon config.
   * @param {import("./configuration-types.js").BeaconConfiguration} beacon - Beacon config.
   * @returns {void}
   */
  setBeaconConfig(beacon) {
    this._beacon = Object.assign({}, this._beacon, beacon)
  }

  /**
   * Runs get beacon client.
   * @returns {import("./beacon/client.js").default | import("./beacon/in-process-client.js").default | undefined} - The active Beacon client, if connected.
   */
  getBeaconClient() {
    return this._beaconClient
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
  async connectBeacon({peerType} = {}) {
    if (this._beaconClient) return this._beaconClient
    if (this._beaconConnectPromise) return await this._beaconConnectPromise

    const config = this.getBeaconConfig()

    if (!config.enabled) return undefined

    this._beaconConnectPromise = (async () => {
      const client = await this._createBeaconClient({
        config,
        peerType: peerType || config.peerType
      })

      client.onBroadcast((message) => {
        // Synapse-style fan-out: deliver every broadcast we receive
        // from the bus through the local delivery path. Echoes of our
        // own publishes follow the same path so every peer sees the
        // same delivery semantics.
        this._deliverBroadcastFromBeacon(message)
      })

      // Beacon connect/disconnect blips are expected during deploys (the broker
      // restarts) and the BeaconClient auto-reconnects in the background, so a
      // single transient failure is NOT reported. Only a sustained outage (still
      // down after `unreachableReportMs`) is surfaced on the framework-error
      // channel; a (re)connect within the grace window clears it silently.

      // `connect-error` fires when the *initial* TCP/handshake fails.
      client.on("connect-error", (error) => {
        this._handleBeaconDown({stage: "beacon-connect", error, reportAfterMs: config.unreachableReportMs})
      })

      // `disconnect` fires when an established connection drops. The payload is
      // the underlying socket error if there was one, or a synthetic
      // Error("Beacon broker disconnected") otherwise.
      client.on("disconnect", (reason) => {
        this._handleBeaconDown({stage: "beacon-disconnect", error: reason, reportAfterMs: config.unreachableReportMs})
      })

      // `connect` fires on every (re)connect; clear any pending outage state so
      // a transient blip that recovers within the grace window stays silent.
      client.on("connect", () => {
        this._handleBeaconUp()
      })

      // Register the client *before* kicking off connect so subsequent
      // `connectBeacon()` calls return this same instance instead of
      // racing to construct a second one.
      this._beaconClient = client

      if (config.inProcess) {
        // In-process connect is synchronous, cannot fail, and resolves
        // before this await yields — callers can rely on
        // `isConnected() === true` immediately after `connectBeacon()`.
        await client.connect()
      } else {
        // Fire-and-forget the TCP connect. Awaiting here would block
        // startup on the OS TCP connect timeout (75s default on Linux)
        // when the broker silently drops SYNs. Failures surface
        // asynchronously via the `connect-error` listener registered
        // above; the BeaconClient's reconnect loop keeps trying.
        void client.connect().catch(() => {
          // Already reported via connect-error above.
        })
      }

      return client
    })()

    return await this._beaconConnectPromise
  }

  /**
   * Builds a Beacon client matching the configured mode. Split out so
   * `connectBeacon` stays focused on lifecycle and error wiring.
   * @param {object} args - Options.
   * @param {ReturnType<VelociousConfiguration["getBeaconConfig"]>} args.config - Resolved Beacon config.
   * @param {string} [args.peerType] - Resolved peer type.
   * @returns {Promise<import("./beacon/client.js").default | import("./beacon/in-process-client.js").default>} - Beacon client.
   */
  async _createBeaconClient({config, peerType}) {
    // Route through the environment handler so the Node-only `node:net`
    // / `node:crypto` deps in the Beacon client modules don't get pulled
    // into browser bundles. Browser bundles statically reach
    // `Configuration` (via `Logger`); putting the dynamic
    // `import("./beacon/...")` calls here would still drag those modules
    // through esbuild's static analysis. Hiding the imports inside the
    // Node environment handler keeps them off the browser path —
    // browser-bundled apps never reach `environment-handlers/node.js`.
    const handler = this.getEnvironmentHandler()

    if (config.inProcess) {
      const InProcessBeaconClient = await handler.loadInProcessBeaconClient()

      return new InProcessBeaconClient({peerType})
    }

    const BeaconClient = await handler.loadBeaconClient()

    return new BeaconClient({
      host: config.host,
      port: config.port,
      peerType
    })
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
  _handleBeaconDown({stage, error, reportAfterMs}) {
    this._beaconLastDownError = {stage, error}

    // A report is already pending or already sent for this outage — keep the
    // latest error but don't stack timers or re-report.
    if (this._beaconReportTimer || this._beaconOutageReported) return

    const timer = setTimeout(() => {
      this._beaconReportTimer = undefined

      if (this._beaconClient?.isConnected()) {
        this._handleBeaconUp()
        return
      }

      this._beaconOutageReported = true

      if (this._beaconLastDownError) this._reportBeaconError(this._beaconLastDownError)
    }, reportAfterMs)

    // Don't let the grace timer keep the process alive.
    if (typeof timer.unref === "function") timer.unref()

    this._beaconReportTimer = timer
  }

  /**
   * Clears beacon-down state on a (re)connect. A blip that recovers within the
   * grace window is never reported; if a sustained outage had already been
   * reported, the state resets so a future outage can report again.
   * @returns {void}
   */
  _handleBeaconUp() {
    if (this._beaconReportTimer) {
      clearTimeout(this._beaconReportTimer)
      this._beaconReportTimer = undefined
    }

    this._beaconOutageReported = false
    this._beaconLastDownError = undefined
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
  _reportBeaconError({stage, error}) {
    const errorEvents = this._errorEvents
    const hasListener = errorEvents.listenerCount("framework-error") > 0
      || errorEvents.listenerCount("all-error") > 0
    const payload = {
      context: {stage},
      error
    }

    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})

    if (!hasListener) {
      const message = error instanceof Error ? error.message : String(error)


      console.error(`[velocious framework-error stage=${stage}] ${message} — register a listener via configuration.getErrorEvents().on("framework-error", …) to suppress this stderr fallback`)
      void Promise.reject(error)
    }
  }

  /**
   * Closes the active Beacon client (if any). Safe to call multiple
   * times.
   * @returns {Promise<void>}
   */
  async disconnectBeacon() {
    const client = this._beaconClient

    this._beaconClient = undefined
    this._beaconConnectPromise = undefined

    if (this._beaconReportTimer) {
      clearTimeout(this._beaconReportTimer)
      this._beaconReportTimer = undefined
    }

    this._beaconOutageReported = false
    this._beaconLastDownError = undefined

    if (client) await client.close()
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
     * @type {?} */
    const websocketEvents = this._websocketEvents

    if (websocketEvents && typeof websocketEvents.broadcastV2 === "function") {
      websocketEvents.broadcastV2({
        channel: message.channel,
        broadcastParams: message.broadcastParams,
        body: message.body
      })
      return
    }

    this._broadcastToChannelLocal(message.channel, message.broadcastParams, message.body)
  }

  /**
   * Runs get scheduled background jobs config.
   * @returns {Promise<import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | undefined>} - Scheduled background jobs configuration.
   */
  async getScheduledBackgroundJobsConfig() {
    if (!this._scheduledBackgroundJobs) {
      return undefined
    }

    if (typeof this._scheduledBackgroundJobs === "function") {
      return await this._scheduledBackgroundJobs({configuration: this})
    }

    return this._scheduledBackgroundJobs
  }

  /**
   * Runs set scheduled background jobs config.
   * @param {import("./configuration-types.js").ScheduledBackgroundJobsConfiguration | import("./configuration-types.js").ScheduledBackgroundJobsLoaderType | undefined} scheduledBackgroundJobs - Scheduled background jobs configuration.
   * @returns {void}
   */
  setScheduledBackgroundJobsConfig(scheduledBackgroundJobs) {
    this._scheduledBackgroundJobs = scheduledBackgroundJobs
  }

  /**
   * Runs get mailer backend.
   * @returns {import("./configuration-types.js").MailerBackend | undefined} - Mailer backend.
   */
  getMailerBackend() {
    return this._mailerBackend
  }

  /**
   * Runs set mailer backend.
   * @param {import("./configuration-types.js").MailerBackend} mailerBackend - Mailer backend.
   * @returns {void} - No return value.
   */
  setMailerBackend(mailerBackend) {
    this._mailerBackend = mailerBackend
  }

  /**
   * Logging configuration tailored for HTTP request logging. Defaults console logging to true and applies the user `logging.console` flag only for request logging.
   * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Pick<import("./configuration-types.js").LoggingConfiguration, "directory" | "filePath"> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>} - The http logging configuration.
   */
  getHttpLoggingConfiguration() {
    return this.getLoggingConfiguration({defaultConsole: true})
  }

  /**
   * Runs get environment handler.
   * @returns {import("./environment-handlers/base.js").default} - The environment handler.
   */
  getEnvironmentHandler() {
    if (!this._environmentHandler) throw new Error("No environment handler set")

    return this._environmentHandler
  }

  /**
   * Runs get locale fallbacks.
   * @returns {import("./configuration-types.js").LocaleFallbacksType | undefined} - The locale fallbacks.
   */
  getLocaleFallbacks() { return this.localeFallbacks }

  /**
   * Runs set locale fallbacks.
   * @param {import("./configuration-types.js").LocaleFallbacksType} newLocaleFallbacks - New locale fallbacks.
   * @returns {void} - No return value.
   */
  setLocaleFallbacks(newLocaleFallbacks) { this.localeFallbacks = newLocaleFallbacks }

  /**
   * Runs get structure sql config.
   * @returns {import("./configuration-types.js").StructureSqlConfiguration | undefined} - Structure SQL config.
   */
  getStructureSqlConfig() { return this._structureSql }

  /**
   * Runs should write structure sql.
   * @param {{reason?: "migration" | "schemaDump"}} [args] - Call context for the structure sql write decision.
   * @returns {boolean} - Whether structure SQL files should be generated for the current environment.
   */
  shouldWriteStructureSql(args = {}) {
    const {reason = "migration"} = args
    const config = this.getStructureSqlConfig()
    const enabledEnvironments = config?.enabledEnvironments
    const disabledEnvironments = config?.disabledEnvironments

    if (reason === "schemaDump") {
      return true
    }

    if (Array.isArray(enabledEnvironments)) {
      return enabledEnvironments.includes(this.getEnvironment())
    }

    if (Array.isArray(disabledEnvironments) && disabledEnvironments.includes(this.getEnvironment())) {
      return false
    }

    if (this.getEnvironment() === "test") {
      return false
    }

    return true
  }

  /**
   * Runs set structure sql config.
   * @param {import("./configuration-types.js").StructureSqlConfiguration} structureSql - Structure SQL config.
   * @returns {void} - No return value.
   */
  setStructureSqlConfig(structureSql) {
    this._structureSql = structureSql
  }

  /**
   * Runs get locale.
   * @returns {string} - The locale.
   */
  getLocale() {
    if (typeof this.locale == "function") {
      return this.locale()
    } else if (this.locale) {
      return this.locale
    } else {
      return this.getLocales()[0]
    }
  }

  /**
   * Runs get locales.
   * @returns {Array<string>} - The locales.
   */
  getLocales() { return digg(this, "locales") }

  /**
   * Runs get model class.
   * @param {string} name - Name.
   * @returns {typeof import("./database/record/index.js").default} - The model class.
   */
  getModelClass(name) {
    const modelClass = this.modelClasses[name]

    if (!modelClass) throw new Error(`No such model class ${name} in ${Object.keys(this.modelClasses).join(", ")}}`)

    return modelClass
  }

  /**
   * Runs get model classes.
   * @returns {Record<string, typeof import("./database/record/index.js").default>} A hash of all model classes, keyed by model name, as they were defined in the configuration. This is a direct reference to the model classes, not a copy.
   */
  getModelClasses() {
    return this.modelClasses
  }

  /**
   * Runs get testing.
   * @returns {string | undefined} The path to a config file that should be used for testing.
   */
  getTesting() { return this._testing }

  /**
   * Runs get trusted proxies.
   * @returns {string | string[] | undefined} Trusted reverse proxy address ranges.
   */
  getTrustedProxies() { return this._trustedProxies }

  /**
   * Runs set trusted proxies.
   * @param {string | string[] | undefined} trustedProxies - Trusted reverse proxy address ranges.
   * @returns {void}
   */
  setTrustedProxies(trustedProxies) { this._trustedProxies = trustedProxies }

  /**
   * Runs initialize database pool.
   * @param {string} [identifier] - Database identifier to initialize.
   * @returns {void} - No return value.
   */
  initializeDatabasePool(identifier = "default") {
    if (!this.database) throw new Error("No 'database' was given")
    if (this.databasePools[identifier]) throw new Error("DatabasePool has already been initialized")

    const PoolType = this.getDatabasePoolType(identifier)

    this.databasePools[identifier] = new PoolType({configuration: this, identifier})
    this.databasePools[identifier].setCurrent()
  }

  /**
   * Runs is database pool initialized.
   * @param {string} [identifier] - Database identifier to check.
   * @returns {boolean} - Whether database pool initialized.
   */
  isDatabasePoolInitialized(identifier = "default") { return Boolean(this.databasePools[identifier]) }

  /**
   * Runs is initialized.
   * @returns {boolean} - Whether initialized.
   */
  isInitialized() { return this._isInitialized }

  /**
   * Runs initialize models.
   * @param {object} args - Options object.
   * @param {string} args.type - Type identifier.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initializeModels(args = {type: "server"}) {
    if (!this._modelsInitialized) {
      this._modelsInitialized = true

      const shouldSkipDummyModelInitialization = process.env.VELOCIOUS_SKIP_DUMMY_MODEL_INITIALIZATION === "1"
        && process.env.VELOCIOUS_BROWSER_TESTS === "true"
        && this.getEnvironment() === "test"

      if (shouldSkipDummyModelInitialization) {
        return
      }

      if (this._initializeModels) {
        await this._initializeModels({configuration: this, type: args.type})
      }

      await this.getEnvironmentHandler().initializePackageModels(this)
      await initializeAuditedModelRelationships(this)

      await this.getEnvironmentHandler().initializeFrontendModelWebsocketPublishers(this)
    }
  }

  /**
   * Ensures each configured database pool has a global connection available.
   * Useful when `getCurrentConnection` might be called without an async context.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async ensureGlobalConnections() {
    for (const identifier of this.getDatabaseIdentifiers()) {
      const pool = this.getDatabasePool(identifier)

      await pool.ensureGlobalConnection()
    }
  }

  /**
   * Runs initialize.
   * @param {object} args - Options object.
   * @param {string} args.type - Type identifier.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initialize({type} = {type: "undefined"}) {
    if (this._isInitialized) return
    // Memoize the in-progress initialization so concurrent callers await the same
    // bootstrap instead of racing. `_isInitialized` was previously set to `true`
    // up front, so a second caller (e.g. a pooled runner with
    // `pooledRunnerConcurrency > 1` starting several jobs on a cold child) could
    // skip initialization and load models / perform a job while the first call
    // was still awaiting model discovery and initializers. Mirrors connectBeacon.
    if (this._initializePromise) return await this._initializePromise

    this._initializePromise = (async () => {
      await this.initializeModels({type})
      await this.getEnvironmentHandler().autoDiscoverResources(this)
      this._mergeDiscoveredAbilityResources()
      this._validateResourceRelationshipsOnModels()

      if (this._initializers) {
        const initializers = await this._initializers({configuration: this})
        const {requireContext, ...restArgs} = initializers

        restArgsError(restArgs)

        if (requireContext) {
          for (const initializerKey of requireContext.keys()) {
            const InitializerClass = requireContext(initializerKey).default
            const initializerInstance = new InitializerClass({configuration: this, type})

            await initializerInstance.run()
          }
        }
      }

      this._isInitialized = true
    })()

    try {
      await this._initializePromise
    } catch (error) {
      // Let a later call retry a failed initialization instead of every future
      // caller awaiting the same cached rejection.
      this._initializePromise = undefined
      throw error
    }
  }

  /**
   * Validates that resource-defined relationships are also defined on the corresponding model classes.
   * Throws an error if a relationship is defined on a resource but missing from the model.
   * @returns {void}
   */
  _validateResourceRelationshipsOnModels() {
    for (const backendProject of this._backendProjects) {
      const resources = frontendModelResourcesForBackendProject(backendProject)

      for (const [modelName, resourceDefinition] of Object.entries(resources)) {
        const resourceConfig = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

        if (!resourceConfig?.relationships) continue

        if (!Array.isArray(resourceConfig.relationships)) {
          throw new Error(`Resource for ${modelName} defines relationships as an object. Use an array instead: static relationships = ${JSON.stringify(Object.keys(resourceConfig.relationships))}`)
        }

        const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition)

        if (!resourceClass) {
          throw new Error(`Frontend model resource for ${modelName} must be a FrontendModelBaseResource subclass.`)
        }

        const modelClass = resourceClass.modelClass()
        const existingRelationships = modelClass.getRelationshipsMap()

        for (const relationshipName of resourceConfig.relationships) {
          if (!(relationshipName in existingRelationships)) {
            throw new Error(
              `Resource for ${modelName} defines relationship "${relationshipName}" but ${modelName} model does not. ` +
              `Add ${modelName}.belongsTo("${relationshipName}", ...) or the appropriate relationship call on the model class.`
            )
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
    this.modelClasses[modelClass.getModelName()] = modelClass
  }

  /**
   * Runs set current.
   * @returns {void} - No return value.
   */
  setCurrent() {
    setCurrentConfiguration(this)
  }

  /**
   * Runs get routes.
   * @returns {import("./routes/index.js").default | undefined} - The routes.
   */
  getRoutes() { return this._routes }

  /**
   * Runs set routes.
   * @param {import("./routes/index.js").default} newRoutes - New routes.
   * @returns {void} - No return value.
   */
  setRoutes(newRoutes) {
    this._routes = newRoutes
    this._applyRouteMounts(newRoutes)
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
    if (!newRoutes || typeof newRoutes.getMounts !== "function") return

    for (const mount of newRoutes.getMounts()) {
      if (this._appliedRouteMounts.has(mount)) continue

      this._appliedRouteMounts.add(mount)
      mount.mountable.mountInto({configuration: this, ...mount.options})
    }
  }

  /**
   * Adds plugin/library routes using a lightweight route DSL backed by route resolver hooks.
   * @param {(routes: import("./routes/plugin-routes.js").default) => void} callback - Routes callback.
   * @returns {void} - No return value.
   */
  routes(callback) {
    const pluginRoutes = new PluginRoutes({configuration: this})

    callback(pluginRoutes)
  }

  /**
   * Runs set translator.
   * @param {function(string, Record<string, ?> | undefined) : string} callback - Translator callback.
   * @returns {void} - No return value.
   */
  setTranslator(callback) { this._translator = callback }

  /**
   * Runs default translator.
   * @param {string} msgID - Msg id.
   * @param {Record<string, ?>} [args] - Translator options and variables.
   * @returns {string} - The default translator.
   */
  _defaultTranslator(msgID, args) {
    this._configureDefaultTranslator()

    const translateArgs = args ? {...args} : undefined
    const defaultValue = translateArgs?.defaultValue
    const locales = translateArgs?.locales

    if (translateArgs) {
      delete translateArgs.defaultValue
      delete translateArgs.locales
    }

    const variables = translateArgs && Object.keys(translateArgs).length > 0 ? translateArgs : undefined

    const locale = this.getLocale()
    const preferredLocales = locales || (locale ? undefined : [])
    const message = translate(msgID, variables, preferredLocales)

    if (message === msgID && defaultValue) return translate(defaultValue, variables, [])

    return message
  }

  /**
   * Runs get translator.
   * @returns {(msgID: string, args?: Record<string, ?>) => string} - The configured translator.
   */
  getTranslator() {
    if (this._translator) return this._translator

    if (!this._defaultTranslatorBound) {
      this._defaultTranslatorBound = this._defaultTranslator.bind(this)
    }

    return this._defaultTranslatorBound
  }

  /**
   * Runs configure default translator.
   * @returns {void} - Configure gettext defaults for this configuration.
   */
  _configureDefaultTranslator() {
    const locale = this.getLocale()

    gettextConfig.setLocale(locale || "")

    const fallbacks = locale ? this.getLocaleFallbacks()?.[locale] : []

    gettextConfig.setFallbacks(fallbacks || [])
  }

  /**
   * Runs get timezone offset minutes.
   * @returns {number | undefined} - The timezone offset in minutes.
   */
  getTimezoneOffsetMinutes() {
    if (typeof this._timezoneOffsetMinutes === "function") {
      const configuredOffset = this._timezoneOffsetMinutes()

      if (typeof configuredOffset === "number") return configuredOffset
    }

    if (typeof this._timezoneOffsetMinutes === "number") {
      return this._timezoneOffsetMinutes
    }

    return new Date().getTimezoneOffset()
  }

  /**
   * Runs get time zone.
   * @returns {string | undefined} - Configured timezone identifier.
   */
  getTimeZone() {
    const timeZone = typeof this._timeZone === "function"
      ? this._timeZone()
      : this._timeZone

    if (timeZone === undefined || timeZone === null) return undefined

    return validateTimeZone(timeZone, "configuration timeZone")
  }

  /**
   * Runs get websocket events.
   * @returns {import("./http-server/websocket-events.js").default | undefined} - The websocket events.
   */
  getWebsocketEvents() {
    return this._websocketEvents
  }

  /**
   * Runs set websocket events.
   * @param {import("./http-server/websocket-events.js").default} websocketEvents - Websocket events.
   * @returns {void} - No return value.
   */
  setWebsocketEvents(websocketEvents) {
    this._websocketEvents = websocketEvents
  }

  /**
   * Per-process registry of channel subscribers used by worker code that
   * needs to react to events broadcast via `websocketEventsHost.publish(...)`
   * without holding an actual websocket session.
   * @returns {import("./http-server/websocket-channel-subscribers.js").default} - The channel subscribers registry.
   */
  getWebsocketChannelSubscribers() {
    if (!this._websocketChannelSubscribers) {
      this._websocketChannelSubscribers = new VelociousWebsocketChannelSubscribers()
    }

    return this._websocketChannelSubscribers
  }

  /**
   * Runs get websocket channel resolver.
   * @returns {import("./configuration-types.js").WebsocketChannelResolverType | undefined} - The websocket channel resolver.
   */
  getWebsocketChannelResolver() {
    return this._websocketChannelResolver
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
    if (!name) throw new Error("Connection name is required")
    if (!ConnectionClass) throw new Error("ConnectionClass is required")
    this._websocketConnectionClasses.set(name, ConnectionClass)
  }

  /**
   * Runs get websocket connection class.
   * @param {string} name - Connection type name to look up.
   * @returns {typeof import("./http-server/websocket-connection.js").default | undefined} - Registered websocket connection class.
   */
  getWebsocketConnectionClass(name) {
    return this._websocketConnectionClasses.get(name)
  }

  /**
   * Registers a `VelociousWebsocketChannel` subclass under a name.
   * Clients subscribe via `{type: "channel-subscribe", channelType: name, ...}`.
   * @param {string} name - Client-facing channel type name.
   * @param {typeof import("./http-server/websocket-channel.js").default} ChannelClass - Websocket channel class.
   * @returns {void}
   */
  registerWebsocketChannel(name, ChannelClass) {
    if (!name) throw new Error("Channel name is required")
    if (!ChannelClass) throw new Error("ChannelClass is required")
    this._websocketChannelClasses.set(name, ChannelClass)
  }

  /**
   * Runs get websocket channel class.
   * @param {string} name - Channel type name to look up.
   * @returns {typeof import("./http-server/websocket-channel.js").default | undefined} - Registered websocket channel class.
   */
  getWebsocketChannelClass(name) {
    return this._websocketChannelClasses.get(name)
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
    let bucket = this._websocketChannelSubscriptions.get(name)

    if (!bucket) {
      bucket = new Set()
      this._websocketChannelSubscriptions.set(name, bucket)
    }

    bucket.add(subscription)
  }

  /**
   * Runs unregister websocket channel subscription.
   * @param {string} name - Channel type used as the routing key.
   * @param {import("./http-server/websocket-channel.js").default} subscription - Live channel subscription to remove.
   * @returns {void}
   */
  _unregisterWebsocketChannelSubscription(name, subscription) {
    const bucket = this._websocketChannelSubscriptions.get(name)

    if (!bucket) return

    bucket.delete(subscription)

    if (bucket.size === 0) {
      this._websocketChannelSubscriptions.delete(name)
    }
  }

  /**
   * Delivers `body` to every live subscriber of `name` whose
   * `matches(broadcastParams)` returns true. Pure routing — no auth
   * re-check, no persistence. Subscribers who were admitted by
   * `canSubscribe()` continue to receive broadcasts until they
   * unsubscribe or the session ends.
   * @param {string} name
   * @param {Record<string, ?>} broadcastParams
   * @param {?} body
   * @returns {void}
   */
  /**
   * Runs get websocket session grace seconds.
   * @returns {number} - Grace period (seconds) before a paused WS session is torn down.
   */
  getWebsocketSessionGraceSeconds() { return this._websocketSessionGraceSeconds }

  /**
   * Runs get websocket session heartbeat seconds.
   * @returns {number} - Interval (seconds) between server→client heartbeat pings; 0 disables reaping.
   */
  getWebsocketSessionHeartbeatSeconds() { return this._websocketSessionHeartbeatSeconds }

  /**
   * Registers a wrapper invoked around every WS-borne request /
   * connection message / channel dispatch. The wrapper receives the
   * session and a `next` callback; it must call `next()` to run the
   * handler. Use it to set up AsyncLocalStorage per request.
   * @param {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null} wrapper - Per-message session-context wrapper, or null to disable it.
   * @returns {void}
   */
  setWebsocketAroundRequest(wrapper) {
    this._websocketAroundRequest = wrapper
  }

  /**
   * Runs get websocket around request.
   * @returns {((session: import("./http-server/client/websocket-session.js").default, next: () => Promise<void>) => Promise<void>) | null} - Websocket session wrapper.
   */
  getWebsocketAroundRequest() {
    return this._websocketAroundRequest
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
    this._aroundAction = wrapper
  }

  /**
   * Runs get around action.
   * @returns {((context: {request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default, next: () => Promise<void>}) => Promise<void>) | null} - HTTP request wrapper.
   */
  getAroundAction() {
    return this._aroundAction
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
   * @param {((session: import("./http-server/client/websocket-session.js").default) => ? | Promise<?>) | null} resolver - Authenticated-caller identity resolver, or null to disable identity checks.
   * @returns {void}
   */
  setWebsocketSessionIdentityResolver(resolver) {
    this._websocketSessionIdentityResolver = resolver
  }

  /**
   * Runs get websocket session identity resolver.
   * @returns {((session: import("./http-server/client/websocket-session.js").default) => ? | Promise<?>) | null} - The configured identity resolver.
   */
  getWebsocketSessionIdentityResolver() {
    return this._websocketSessionIdentityResolver
  }

  /**
   * Runs set websocket session grace seconds.
   * @param {number} seconds - Grace period before a paused session expires.
   * @returns {void}
   */
  setWebsocketSessionGraceSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`Invalid grace seconds: ${seconds}`)
    this._websocketSessionGraceSeconds = seconds
  }

  /**
   * Runs set websocket session heartbeat seconds.
   * @param {number} seconds - Heartbeat interval, with zero disabling reaping.
   * @returns {void}
   */
  setWebsocketSessionHeartbeatSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`Invalid heartbeat seconds: ${seconds}`)
    this._websocketSessionHeartbeatSeconds = seconds
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
    const sessionId = session.sessionId

    if (!sessionId) throw new Error("Session must have a sessionId to be paused")
    if (this._pausedWebsocketSessions.has(sessionId)) return

    const graceMs = this._websocketSessionGraceSeconds * 1000
    const graceTimer = setTimeout(() => {
      this._expireWebsocketSession(sessionId)
    }, graceMs)

    // Don't keep the process alive purely for a paused session timer.
    if (typeof graceTimer.unref === "function") graceTimer.unref()

    this._pausedWebsocketSessions.set(sessionId, {session, graceTimer, pausedAt: Date.now()})
  }

  /**
   * Looks up a paused session by id (does NOT remove it — caller is
   * expected to call `_resumeWebsocketSession` to complete the handoff).
   * @param {string} sessionId - Paused session identifier to look up.
   * @returns {import("./http-server/client/websocket-session.js").default | null} - Paused session with the requested identifier, if present.
   */
  _findPausedWebsocketSession(sessionId) {
    return this._pausedWebsocketSessions.get(sessionId)?.session || null
  }

  /**
   * Removes a paused session from the registry and cancels its grace
   * timer. Called on successful resume handoff and on explicit
   * expiry.
   * @param {string} sessionId - Paused session identifier to remove and cancel.
   * @returns {void}
   */
  _clearPausedWebsocketSession(sessionId) {
    const entry = this._pausedWebsocketSessions.get(sessionId)

    if (!entry) return

    clearTimeout(entry.graceTimer)
    this._pausedWebsocketSessions.delete(sessionId)
  }

  /**
   * Grace-timer callback. Calls the session's permanent-teardown
   * hook and drops it from the registry.
   * @param {string} sessionId - Paused session identifier whose grace period expired.
   * @returns {void}
   */
  _expireWebsocketSession(sessionId) {
    const entry = this._pausedWebsocketSessions.get(sessionId)

    if (!entry) return

    this._pausedWebsocketSessions.delete(sessionId)
    try {
      entry.session._finalizeGraceExpiry()
    } catch (error) {
      console.error(`Failed to finalize expired WS session ${sessionId}`, error)
    }
  }

  /**
   * Runs broadcast to channel.
   * @param {string} name - Channel type receiving the broadcast.
   * @param {Record<string, ?>} broadcastParams - Values used to match eligible subscriptions.
   * @param {?} body - Broadcast payload delivered to matching subscriptions.
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
      const sent = this._beaconClient.publish({channel: name, broadcastParams, body})

      if (sent) return
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
     * @type {?} */
    const websocketEvents = this._websocketEvents

    if (websocketEvents && typeof websocketEvents.broadcastV2 === "function") {
      websocketEvents.broadcastV2({channel: name, broadcastParams, body})
      return
    }

    if (websocketEvents && typeof websocketEvents.publishV2Broadcast === "function" && websocketEvents.parentPort) {
      websocketEvents.publishV2Broadcast({channel: name, broadcastParams, body})
      return
    }

    this._broadcastToChannelLocal(name, broadcastParams, body)
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
     * @type {?} */
    const websocketEvents = this._websocketEvents

    if (websocketEvents && typeof websocketEvents.awaitPendingBroadcasts === "function") {
      await websocketEvents.awaitPendingBroadcasts()
    }
  }

  /**
   * Local (per-worker) channel broadcast dispatch. Called either
   * directly (in-process mode) or by the worker thread after the
   * main-process fan-out.
   * @param {string} name - Channel name.
   * @param {Record<string, ?>} broadcastParams - Params passed to each subscription's `matches()`.
   * @param {?} body - Message body delivered via `sendMessage()`.
   * @param {{eventId?: string}} [meta] - Optional event metadata for replay tracking.
   * @returns {void}
   */
  _broadcastToChannelLocal(name, broadcastParams, body, meta) {
    const bucket = this._websocketChannelSubscriptions.get(name)

    if (!bucket) return

    for (const subscription of bucket) {
      if (subscription.isClosed()) continue

      let matches

      try {
        matches = subscription.matches(broadcastParams || {})
      } catch (error) {
        // A broken `matches()` on one subscriber must not poison the
        // broadcast to other subscribers. Skip and continue.
        console.error(`broadcastToChannel: ${name} subscription ${subscription.subscriptionId} matches() threw`, error)
        continue
      }

      if (!matches) continue

      void this.withoutCurrentConnectionContexts(() => {
        return Promise
          .resolve()
          .then(() => this._deliverWebsocketChannelBroadcast(subscription, body, {eventId: meta?.eventId}))
          .catch((error) => {
            console.error(`broadcastToChannel: ${name} subscription ${subscription.subscriptionId} deliverBroadcast threw`, error)
          })
      })
    }
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
      return subscription.deliverBroadcast(body, meta)
    }

    return subscription.sendMessage(body, meta)
  }

  /**
   * Runs get websocket message handler resolver.
   * @returns {import("./configuration-types.js").WebsocketMessageHandlerResolverType | undefined} - The websocket message handler resolver.
   */
  getWebsocketMessageHandlerResolver() {
    return this._websocketMessageHandlerResolver
  }

  /**
   * Runs set websocket channel resolver.
   * @param {import("./configuration-types.js").WebsocketChannelResolverType} resolver - Resolver.
   * @returns {void} - No return value.
   */
  setWebsocketChannelResolver(resolver) {
    this._websocketChannelResolver = resolver
  }

  /**
   * Runs set websocket message handler resolver.
   * @param {import("./configuration-types.js").WebsocketMessageHandlerResolverType} resolver - Resolver.
   * @returns {void} - No return value.
   */
  setWebsocketMessageHandlerResolver(resolver) {
    this._websocketMessageHandlerResolver = resolver
  }

  /**
   * Runs resolve ability.
   * @param {object} args - Ability resolver args.
   * @param {Record<string, ?>} args.params - Request params.
   * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default} [args.request] - Request object. Absent for websocket channel subscriptions resolved from subscribe params.
   * @param {import("./http-server/client/response.js").default} [args.response] - Response object. Absent outside HTTP request handling.
   * @returns {Promise<import("./authorization/ability.js").default | undefined>} - Resolved ability.
   */
  async resolveAbility({params, request, response}) {
    const resolver = this.getAbilityResolver()

    if (resolver) {
      const resolved = await resolver({configuration: this, params, request, response})

      if (resolved) return resolved
    }

    const resources = this.getAbilityResources()

    if (resources.length === 0) return

    return new Ability({
      context: {configuration: this, params, request, response},
      resources
    })
  }

  /**
   * Runs run with ability.
   * @param {import("./authorization/ability.js").default | undefined} ability - Ability instance.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithAbility(ability, callback) {
    return await this.getEnvironmentHandler().runWithAbility(ability, callback)
  }

  /**
   * Runs run with request timing.
   * @param {import("./http-server/client/request-timing.js").default | undefined} requestTiming - Request timing collector.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithRequestTiming(requestTiming, callback) {
    return await this.getEnvironmentHandler().runWithRequestTiming(requestTiming, callback)
  }

  /**
   * Runs run with timezone.
   * @param {string} timeZone - IANA timezone identifier.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithTimezone(timeZone, callback) {
    return await this.getEnvironmentHandler().runWithTimezone(timeZone, callback)
  }

  /**
   * Runs get current ability.
   * @returns {import("./authorization/ability.js").default | undefined} - Current ability from context.
   */
  getCurrentAbility() {
    return this.getEnvironmentHandler().getCurrentAbility()
  }

  /**
   * Runs get current request timing.
   * @returns {import("./http-server/client/request-timing.js").default | undefined} - Current request timing collector.
   */
  getCurrentRequestTiming() {
    return this.getEnvironmentHandler().getCurrentRequestTiming()
  }

  /**
   * Runs get current tenant.
   * @returns {?} - Current tenant from context.
   */
  getCurrentTenant() {
    return this.getEnvironmentHandler().getCurrentTenant()
  }

  /**
   * Runs run with tenant.
   * @param {?} tenant - Tenant.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithTenant(tenant, callback) {
    return await this.getEnvironmentHandler().runWithTenant(tenant, callback)
  }

  /**
   * Runs resolve tenant.
   * @param {object} args - Tenant resolver args.
   * @param {Record<string, ?>} args.params - Request params.
   * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined} args.request - Request object.
   * @param {import("./http-server/client/response.js").default | undefined} args.response - Response object.
   * @param {{channel: string, params?: Record<string, ?>}} [args.subscription] - Subscription metadata.
   * @returns {Promise<?>} - Resolved tenant.
   */
  async resolveTenant({params, request, response, subscription}) {
    const resolver = this.getTenantResolver()

    if (!resolver) return

    return await resolver({
      configuration: this,
      params,
      request,
      response,
      subscription
    })
  }

  /**
   * Runs get error events.
   * @returns {import("eventemitter3").EventEmitter} - Framework error events emitter.
   */
  getErrorEvents() {
    return this._errorEvents
  }

  /**
   * Registers a reporter that can add client-safe metadata to frontend-model error payloads.
   * @param {import("./configuration-types.js").ClientErrorPayloadReporterType} reporter - Reporter callback.
   * @returns {void}
   */
  addClientErrorPayloadReporter(reporter) {
    this._clientErrorPayloadReporters.push(reporter)
  }

  /**
   * Runs registered client error payload reporters.
   * @param {{context: import("./configuration-types.js").ClientErrorPayloadContext, error: Error, request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined}} args - Reporter args.
   * @returns {Promise<import("./configuration-types.js").ClientErrorPayloadReporterPayload>} - Merged client-safe reporter payload.
   */
  async clientErrorPayloadForError(args) {
    /** @type {import("./configuration-types.js").ClientErrorPayloadReporterPayload} */
    const payload = {}
    const details = requestDetails(args.request)

    for (const reporter of this._clientErrorPayloadReporters) {
      const reporterPayload = await reporter({
        ...args,
        requestDetails: details
      })

      if (reporterPayload && typeof reporterPayload === "object") {
        Object.assign(payload, reporterPayload)
      }
    }

    return payload
  }

  /**
   * Runs with connections.
   * @template T
   * @param {WithConnectionsOptionsType | WithConnectionsCallbackType<T>} optionsOrCallback - Checkout options or callback function.
   * @param {WithConnectionsCallbackType<T>} [callback] - Callback function.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withConnections(optionsOrCallback, callback) {
    const {name, callback: actualWithConnectionsCallback} = resolveWithConnectionsArgs(optionsOrCallback, callback, "Configuration.withConnections")

    if (!actualWithConnectionsCallback) throw new Error("withConnections requires a callback")

    /**
     * Dbs.
     * @type {{[key: string]: import("./database/drivers/base.js").default}} */
    const dbs = {}

    return await this.withDatabaseIdentifierConnections({
      callback: actualWithConnectionsCallback,
      dbs,
      identifiers: this.getDatabaseIdentifiers(),
      name,
      stackLabel: "withConnections"
    })
  }

  /**
   * Runs callback with database connections for the requested identifiers.
   * @template T
   * @param {{callback: WithConnectionsCallbackType<T>, dbs: Record<string, import("./database/drivers/base.js").default>, identifiers: string[], name: string, stackLabel: string}} args - Connection scope details.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withDatabaseIdentifierConnections({callback, dbs, identifiers, name, stackLabel}) {
    const stack = Error().stack
    const actualCallback = async () => {
      return await withTrackedStack(stack || stackLabel, async () => {
        return await callback(dbs)
      })
    }

    /**
     * Run request.
     * @type {() => Promise<T>} */
    let runRequest = actualCallback

    for (const identifier of identifiers) {
      let actualRunRequest = runRequest

      const nextRunRequest = async () => {
        return await this.getDatabasePool(identifier).withConnection({name}, async (db) => {
          dbs[identifier] = db

          return await actualRunRequest()
        })
      }

      runRequest = nextRunRequest
    }

    return await runRequest()
  }

  /**
   * Runs get current connections.
   * @returns {Record<string, import("./database/drivers/base.js").default>} A map of database connections with identifier as key
   */
  getCurrentConnections() {
    /**
     * Dbs.
     * @type {{[key: string]: import("./database/drivers/base.js").default}} */
    const dbs = {}

    for (const identifier of this.getDatabaseIdentifiers()) {
      try {
        const pool = this.getDatabasePool(identifier)
        const currentConnection = pool.getCurrentContextConnection ? pool.getCurrentContextConnection() : pool.getCurrentConnection()

        if (currentConnection && (!pool.connectionMatchesCurrentConfiguration || pool.connectionMatchesCurrentConfiguration(currentConnection))) {
          dbs[identifier] = currentConnection
        }
      } catch (error) {
        if (this.isMissingCurrentConnectionError(error)) {
          // Ignore
        } else {
          throw error
        }
      }
    }

    return dbs
  }

  /**
   * Runs without current connection contexts.
   * @template T
   * @param {() => T} callback - Callback to run without inherited DB connection contexts.
   * @returns {T} - Callback result.
   */
  withoutCurrentConnectionContexts(callback) {
    let runCallback = callback

    for (const pool of Object.values(this.databasePools)) {
      if (!pool) continue
      const previousRunCallback = runCallback

      runCallback = () => pool.withoutCurrentConnectionContext(previousRunCallback)
    }

    return runCallback()
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
    let runCallback = callback

    for (const pool of Object.values(this.databasePools)) {
      if (!pool) continue
      const previousRunCallback = runCallback

      runCallback = () => pool.runWithTestSharedConnection(previousRunCallback)
    }

    return runCallback()
  }

  /**
   * Runs is missing current connection error.
   * @param {?} error - Error thrown while looking up the current connection.
   * @returns {boolean} - Whether the error means no current connection is available.
   */
  isMissingCurrentConnectionError(error) {
    return error instanceof Error && (
      error.message == "ID hasn't been set for this async context" ||
      error.message == "A connection hasn't been made yet" ||
      error.message.startsWith("No async context set for database connection") ||
      error.message.startsWith("Connection ") && error.message.includes("doesn't exist any more")
    )
  }

  /**
   * Runs ensure connections.
   * @template T
   * @param {WithConnectionsOptionsType | WithConnectionsCallbackType<T>} optionsOrCallback - Checkout options or callback function.
   * @param {WithConnectionsCallbackType<T>} [callback] - Callback function.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async ensureConnections(optionsOrCallback, callback) {
    const {name, callback: actualWithConnectionsCallback} = resolveWithConnectionsArgs(optionsOrCallback, callback, "Configuration.ensureConnections")

    if (!actualWithConnectionsCallback) throw new Error("ensureConnections requires a callback")

    const dbs = this.getCurrentConnections()
    const missingIdentifiers = this.getDatabaseIdentifiers().filter((identifier) => {
      if (!dbs[identifier]) return true

      return !this.getDatabasePool(identifier).hasCurrentConnectionContext()
    })

    if (missingIdentifiers.length === 0) {
      return await actualWithConnectionsCallback(dbs)
    }

    return await this.withDatabaseIdentifierConnections({
      callback: actualWithConnectionsCallback,
      dbs,
      identifiers: missingIdentifiers,
      name,
      stackLabel: "ensureConnections"
    })
  }

  /**
   * Closes active database connections and clears global connections.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeDatabaseConnections() {
    if (this._closeDatabaseConnectionsPromise) {
      await this._closeDatabaseConnectionsPromise
      return
    }

    /** @type {Set<typeof import("./database/pool/base.js").default>} */
    const constructors = new Set()

    this._closeDatabaseConnectionsPromise = (async () => {
      for (const pool of Object.values(this.databasePools)) {
        if (!pool) continue

        await pool.closeAll()

        const PoolClass = /** @type {typeof import("./database/pool/base.js").default} */ (pool.constructor)
        constructors.add(PoolClass)
      }

      for (const PoolClass of constructors) {
        PoolClass.clearGlobalConnections(this)
      }

      // Allow models to be re-initialized after connections are closed.
      this._modelsInitialized = false
    })()

    try {
      await this._closeDatabaseConnectionsPromise
    } finally {
      this._closeDatabaseConnectionsPromise = null
    }
  }

  /**
   * Runs debug endpoint request authorized.
   * @param {{header: (name: string) => string | null | undefined}} request - Incoming request.
   * @param {string} expectedToken - Configured debug-endpoint token.
   * @returns {boolean} - Whether the request carries the expected bearer token.
   */
  debugEndpointRequestAuthorized(request, expectedToken) {
    const header = request.header("authorization")

    if (typeof header !== "string") return false

    const match = (/^Bearer\s+(.+)$/i).exec(header.trim())

    if (!match) return false

    return this.getEnvironmentHandler().debugEndpointTokenMatches(match[1], expectedToken)
  }

  /**
   * Runs get api manifest.
   * @returns {Promise<Record<string, unknown>>} - API manifest for all registered frontend-model resources.
   */
  async getApiManifest() {
    return frontendModelApiManifest(this._backendProjects)
  }

  /**
   * Runs whether API manifest is enabled.
   * @returns {boolean} - Whether the API manifest endpoint is enabled.
   */
  _apiManifestEnabled() {
    return this._apiManifest.enabled
  }
}
