// @ts-check

import {forcedFunction} from "typanic"

import Configuration from "../configuration.js"

import {serializedScopeFromQuery} from "./query-scope.js"
import SyncApiClient from "./sync-api-client.js"
import SyncScopeStore from "./sync-scope-store.js"
import {currentSyncClient, setCurrentSyncClient} from "./sync-client-registry.js"

let clientCounter = 0

/**
 * Declarative client-side sync driver.
 *
 * Apps configure resources, transport, auth, and connectivity once; Velocious
 * owns scope persistence, per-scope cursors, pull paging/apply, local queueing,
 * and online-gated replay. Declare sync interest from queries:
 *
 *     const syncClient = new SyncClient({...})
 *     syncClient.setCurrent()
 *     await syncClient.sync(Event.where({partnerId}))
 */
export default class SyncClient {
  /**
   * Creates a declarative sync client.
   * @param {import("./sync-client-types.js").SyncClientConfig} config - Sync client configuration.
   */
  constructor(config) {
    if (!config || typeof config !== "object") throw new Error("SyncClient requires a configuration object")

    forcedFunction(config.postChanges, "SyncClient config.postChanges")
    forcedFunction(config.postReplay, "SyncClient config.postReplay")
    forcedFunction(config.authenticationToken, "SyncClient config.authenticationToken")

    if (!config.syncModel) throw new Error("SyncClient requires config.syncModel")
    if (!config.resources || typeof config.resources !== "object" || Object.keys(config.resources).length === 0) {
      throw new Error("SyncClient requires at least one entry in config.resources")
    }

    for (const [resourceType, resource] of Object.entries(config.resources)) {
      if (!resource || typeof resource !== "object" || !resource.modelClass) {
        throw new Error(`SyncClient resource ${resourceType} must declare a modelClass`)
      }
    }

    this.config = config
    this._clientNumber = ++clientCounter
    /** @type {import("./sync-scope-store.js").default | null} */
    this._scopeStore = config.scopeStore || null
    /** @type {Promise<void> | null} */
    this._scheduledReplay = null
    /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig> | null} */
    this._pullResourceConfigs = null
  }

  /**
   * Registers this client as the app's current sync client.
   * @returns {void}
   */
  setCurrent() {
    setCurrentSyncClient(this)
  }

  /**
   * Returns the app's current sync client.
   * @returns {SyncClient} Current sync client.
   */
  static current() {
    return /** @type {SyncClient} */ (currentSyncClient())
  }

  /**
   * Declares (or re-activates) a sync scope from a model query and pulls it when online.
   * @param {import("../database/query/model-class-query.js").default<?>} query - Query declaring the sync scope.
   * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result (null while offline).
   */
  async sync(query) {
    const scope = serializedScopeFromQuery(query)
    const scopeStore = this.scopeStore()
    const scopeRow = await scopeStore.findOrCreateScope(scope)

    if (!scopeRow.cursorPayload && this.config.legacyCursor) {
      const legacyCursorPayload = await this.config.legacyCursor({scope})
      const legacyCursor = SyncApiClient.syncCursorFromPayload(legacyCursorPayload)

      if (legacyCursor) await scopeStore.saveCursor(scopeRow, legacyCursor)
    }

    return {pulled: await this.pull(), scope}
  }

  /**
   * Deactivates the sync scope declared by a model query.
   * @param {import("../database/query/model-class-query.js").default<?>} query - Query whose scope should stop syncing.
   * @returns {Promise<void>}
   */
  async unsync(query) {
    await this.scopeStore().deactivate(serializedScopeFromQuery(query))
  }

  /**
   * Pulls changes for every active scope with per-scope cursors (single-flighted, online-gated).
   * @returns {Promise<import("./sync-api-client-types.js").SyncChangesResult | null>} Combined pull result, or null while offline.
   */
  async pull() {
    if (!(await this.isOnline())) return null

    /** @type {import("./sync-api-client-types.js").SyncChangesResult | null} */
    let combinedResult = null

    await SyncApiClient.singleFlight(`velocious-sync-client-pull-${this._clientNumber}`, async () => {
      const authenticationToken = await this.config.authenticationToken()
      const scopeStore = this.scopeStore()
      const applySync = SyncApiClient.resourceApplier(this.pullResourceConfigs())
      const result = {
        changed: false,
        pages: 0,
        resourceChanged: /** @type {Record<string, boolean>} */ ({}),
        resourceCounts: /** @type {Record<string, number>} */ ({}),
        syncedCount: 0
      }

      for (const scopeRow of await scopeStore.activeScopes()) {
        const scopeResult = await SyncApiClient.pullChanges({
          applySync,
          authenticationToken,
          batchSize: this.config.batchSize,
          loadCursor: async () => await scopeStore.loadCursor(scopeRow),
          postChanges: async (payload) => await this.config.postChanges({
            ...payload,
            scope: {conditions: scopeRow.conditions, resourceType: scopeRow.resourceType}
          }),
          saveCursor: async (cursor) => await scopeStore.saveCursor(scopeRow, cursor)
        })

        result.changed ||= scopeResult.changed
        result.pages += scopeResult.pages
        result.syncedCount += scopeResult.syncedCount

        for (const [resourceType, count] of Object.entries(scopeResult.resourceCounts)) {
          result.resourceCounts[resourceType] = (result.resourceCounts[resourceType] || 0) + count
        }
        for (const [resourceType, changed] of Object.entries(scopeResult.resourceChanged)) {
          result.resourceChanged[resourceType] ||= changed
        }
      }

      combinedResult = result
    })

    return combinedResult
  }

  /**
   * Queues a local model change as a pending sync row and schedules an immediate
   * replay attempt (kept pending while offline or when the backend rejects it).
   * @param {{resource: ?, data?: Record<string, ?>, syncType?: string}} args - Queue args.
   * @returns {Promise<?>} Pending local sync row.
   */
  async queue({data, resource, syncType}) {
    const resourceConfig = this.resourceConfigFor(resource)
    const syncRow = await SyncApiClient.queueLocalSync({
      booleanAttributes: resourceConfig.booleanAttributes || [],
      data,
      localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
      resource,
      syncModel: this.config.syncModel,
      syncType: syncType ?? this.defaultSyncType({operation: "update", record: resource, resourceConfig})
    })

    this.scheduleReplay()

    return syncRow
  }

  /**
   * Drains pending local sync rows to the backend (single-flighted, online-gated).
   * Rows are only marked successful after the backend acknowledges them.
   * @returns {Promise<void>}
   */
  async replayPending() {
    if (!(await this.isOnline())) return

    await SyncApiClient.singleFlight(`velocious-sync-client-replay-${this._clientNumber}`, async () => {
      await SyncApiClient.replayLocalSyncs({
        authenticationToken: await this.config.authenticationToken(),
        batchSize: this.config.batchSize,
        postReplay: this.config.postReplay,
        syncModel: this.config.syncModel
      })
    })
  }

  /**
   * Schedules a background replay attempt without blocking the caller.
   * Failures go to config.onError (or rethrow when none is configured).
   * @returns {void}
   */
  scheduleReplay() {
    this._scheduledReplay = (async () => {
      try {
        await this.replayPending()
      } catch (error) {
        this.reportError(/** @type {Error} */ (error))
      }
    })()
  }

  /**
   * Awaits the last scheduled background replay (useful in tests and shutdown flows).
   * @returns {Promise<void>}
   */
  async waitForScheduledReplay() {
    if (this._scheduledReplay) await this._scheduledReplay
  }

  /**
   * Reports a background sync failure.
   * @param {Error} error - Background failure.
   * @returns {void}
   */
  reportError(error) {
    if (this.config.onError) {
      this.config.onError(error)
      return
    }

    throw error
  }

  /**
   * Resolves connectivity through the configured gate.
   * @returns {Promise<boolean>} Whether the backend is considered reachable.
   */
  async isOnline() {
    if (!this.config.isOnline) return true

    return (await this.config.isOnline()) !== false
  }

  /**
   * Returns the scope store backing declared scopes and cursors.
   * @returns {import("./sync-scope-store.js").default} Scope store.
   */
  scopeStore() {
    this._scopeStore ||= new SyncScopeStore({configuration: this.config.configuration || Configuration.current()})

    return this._scopeStore
  }

  /**
   * Resolves the declared resource config for a local record.
   * @param {?} resource - Local model record.
   * @returns {import("./sync-client-types.js").SyncClientResourceConfig} Declared resource config.
   */
  resourceConfigFor(resource) {
    const resourceType = resource?.constructor?.name
    const resourceConfig = resourceType ? this.config.resources[resourceType] : undefined

    if (!resourceConfig) throw new Error(`No sync resource configured for: ${resourceType || String(resource)}`)

    return resourceConfig
  }

  /**
   * Resolves the sync type for a mutation through the resource config.
   * @param {{operation: "create" | "update" | "destroy", record: ?, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Mutation args.
   * @returns {string} Sync type.
   */
  defaultSyncType({operation, record, resourceConfig}) {
    if (resourceConfig.syncType) return resourceConfig.syncType({operation, record})
    if (operation === "destroy") return "delete"

    return operation
  }

  /**
   * Derives the pull-apply resource configs from the declared resources.
   * @returns {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} Pull-apply resource configs.
   */
  pullResourceConfigs() {
    this._pullResourceConfigs ||= /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} */ (Object.fromEntries(
      Object.entries(this.config.resources)
        .filter(([, resource]) => Boolean(resource.attributes))
        .map(([resourceType, resource]) => [resourceType, {
          afterApply: resource.afterApply,
          attributes: /** @type {import("./sync-api-client-types.js").SyncResourceConfig["attributes"]} */ (resource.attributes),
          enabled: true,
          findRecord: resource.findRecord,
          findRecordForDelete: resource.findRecordForDelete,
          modelClass: resource.modelClass
        }])
    ))

    return this._pullResourceConfigs
  }
}

/**
 * Declares a sync scope on the current sync client.
 * @param {import("../database/query/model-class-query.js").default<?>} query - Query declaring the sync scope.
 * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result.
 */
export async function sync(query) {
  return await SyncClient.current().sync(query)
}
