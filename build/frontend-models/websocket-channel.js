// @ts-check

import VelociousWebsocketChannel from "../http-server/websocket-channel.js"
import {Buffer} from "node:buffer"
import Response from "../http-server/client/response.js"
import {frontendModelResourcesWithBuiltInsForBackendProject} from "./built-in-resources.js"
import {frontendModelResourceClassFromDefinition} from "./resource-definition.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "./transport-serialization.js"
import {modelPrimaryKeyConditions} from "../utils/model-primary-key.js"

/**
 * Defines this typedef.
 * @typedef {{action?: string, destroyAuthorizationRecord?: Record<string, ReturnType<typeof JSON.parse>>, id?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, matchedEventFilterKeys?: string[], previousId?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, record?: import("./query.js").FrontendModelTransportValue, [key: string]: import("./query.js").FrontendModelTransportValue | string[] | undefined}} FrontendModelLifecycleBroadcastBody
 */
/**
 * Defines this typedef.
 * @typedef {{headers?: () => Record<string, string | string[] | undefined>, remoteAddress?: () => string | undefined}} FrontendModelWebsocketUpgradeRequest
 */
/**
 * Defines this typedef.
 * @typedef {{headers: () => Record<string, string | string[] | undefined>, header: (name: string) => string | string[] | undefined, metadata: (key?: string) => Record<string, import("./query.js").FrontendModelTransportValue> | import("./query.js").FrontendModelTransportValue | undefined, path: () => string, httpMethod: () => string, remoteAddress: () => string | undefined, origin: () => string | string[] | undefined}} FrontendModelWebsocketSyntheticRequest
 */
const EVENT_FILTER_KEYS = new Set(["joins", "key", "searches", "where"])

// Mirrors FRONTEND_MODELS_CHANNEL_NAME in ./websocket-publishers.js, duplicated here
// to avoid the configuration → logger → websocket-publishers import cycle.
const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models"

/**
 * Resolves frontend resource identity attributes to backing database columns.
 * @param {typeof import("../database/record/index.js").default} ModelClass - Backing model class.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} primaryKey - Frontend resource identity definition.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Frontend resource identity.
 * @returns {Record<string, import("../utils/model-primary-key.js").ModelPrimaryKeyScalar>} - Backing column conditions.
 */
function frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id) {
  const resourceConditions = modelPrimaryKeyConditions(primaryKey, id)
  /** @type {Record<string, import("../utils/model-primary-key.js").ModelPrimaryKeyScalar>} */
  const databaseConditions = {}

  for (const [attributeName, value] of Object.entries(resourceConditions)) {
    databaseConditions[ModelClass.getColumnNameForAttributeName(attributeName)] = value
  }

  return databaseConditions
}

/**
 * Runs transport serialization options for a configuration.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {import("./transport-serialization.js").FrontendModelTransportSerializationOptions} - Serialization options.
 */
function transportSerializationOptionsForConfiguration(configuration) {
  return {
    timeZone: configuration.getEnvironmentHandler().getTimeZone(configuration)
  }
}

/**
 * Per-session channel subscription for frontend-model lifecycle events.
 * Replaces the legacy `FrontendModelWebsocketChannel` (Phase 3).
 *
 * `canSubscribe` resolves the caller's ability once and requires a read rule
 * for the requested model class. Create/update delivery then reloads each
 * record through that ability and serializes it through the subscribed
 * frontend resource. Subscriber-provided event filters can further narrow
 * those authorized events.
 *
 * Wire: subscribe with `subscribeChannel("frontend-models", {params: {model: ModelName}})`.
 * Backend publishes `{action, id, record}` via
 * `configuration.broadcastToChannel("frontend-models", {model: ModelName}, body)`;
 * `matches()` routes by model name.
 */
export default class FrontendModelWebsocketChannel extends VelociousWebsocketChannel {
  /**
   * Ability.
   * @type {import("../authorization/ability.js").default | null} */
  _ability = null

  /**
   * Runs can subscribe.
   * @returns {Promise<boolean>} Whether the frontend-model subscription is authorized.
   */
  async canSubscribe() {
    const modelName = this._modelName()

    if (!modelName) return false
    this._eventFilters()

    const configuration = this.session.configuration
    const ModelClass = this._modelClass(modelName)

    if (!ModelClass) return false

    const request = /** @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest())
    const ability = await configuration.resolveAbility({
      // Forward the subscriber's params (e.g. authenticationToken) so token-authenticated clients
      // resolve the same ability they would over HTTP. Without this only session/cookie auth on the
      // upgrade request works, and param-based auth (like a scanner passing an authenticationToken)
      // is dropped — leaving such subscribers with a guest ability and no read rule.
      params: {...this.params, model: modelName},
      request,
      response: new Response({configuration})
    })

    if (!ability) return false
    this._ability = ability

    // Load resource-declared rules for this model class before checking,
    // otherwise `rulesFor` returns empty for abilities whose resources
    // register rules lazily via `abilities()`.
    ability.loadAbilitiesForModelClass(ModelClass)

    const readRules = ability.rulesFor({action: "read", modelClass: ModelClass})

    return readRules.some((/** @type {{effect: string}} */ rule) => rule.effect === "allow")
  }

  /**
   * Resolves a subscription name through frontend resources before falling back to a backing model name.
   * @param {string} modelName - Frontend resource name.
   * @returns {typeof import("../database/record/index.js").default | undefined} - Backing model class.
   */
  _modelClass(modelName) {
    const configuration = this.session.configuration

    for (const backendProject of configuration.getBackendProjects()) {
      const resourceDefinition = frontendModelResourcesWithBuiltInsForBackendProject(backendProject)[modelName]
      const resourceClass = resourceDefinition ? frontendModelResourceClassFromDefinition(resourceDefinition) : null

      if (resourceClass?.ModelClass) return resourceClass.modelClass()
    }

    return configuration.getModelClasses()[modelName]
  }

  /**
   * Runs deliver broadcast.
   * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
   * @param {{eventId?: string}} [meta] - Optional event metadata.
   * @returns {Promise<void>} Resolves after delivery.
   */
  async deliverBroadcast(body, meta) {
    await this._deliverBroadcast(body, meta)
  }

  /**
   * Runs deliver broadcast.
   * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
   * @param {{eventId?: string}} [meta] - Optional event metadata.
   * @returns {Promise<void>} Resolves after delivery.
   */
  async _deliverBroadcast(body, meta) {
    const hasEventFilters = this._hasEventFilterParams()

    if (!body || typeof body !== "object") {
      if (!hasEventFilters || this._hasUnfilteredEventDelivery()) this.sendMessage(body, meta)
      return
    }

    if (typeof body.model === "string" && body.model !== this._modelName()) return

    if (body.action === "destroy") {
      if (body.id === undefined || body.id === null) return

      const FrontendModelController = await this._frontendModelControllerClass()
      const authorized = await this._destroyEventIsAuthorized(body, FrontendModelController)

      if (!authorized) return

      if (!hasEventFilters || this._hasDestroyEventDelivery() || this._hasUnfilteredEventDelivery()) {
        this.sendMessage({
          action: body.action,
          id: body.id,
          ...(typeof body.model === "string" ? {model: body.model} : {})
        }, meta)
      }
      return
    }

    if (body.id === undefined || body.id === null) {
      if (!hasEventFilters || this._hasUnfilteredEventDelivery()) this.sendMessage(body, meta)
      return
    }

    const FrontendModelController = await this._frontendModelControllerClass()
    const matchedEventFilterKeys = hasEventFilters
      ? await this._matchedEventFilterKeysForEventId(body.id, FrontendModelController)
      : []
    const isIdentityTransition = body.action === "update" && body.previousId !== undefined && body.previousId !== null

    if (hasEventFilters && matchedEventFilterKeys.length === 0 && !this._hasUnfilteredEventDelivery() && !isIdentityTransition) {
      return
    }

    const projectedRecord = await this._projectedRecordForEventId(body.id, FrontendModelController)

    if (!projectedRecord) {
      if (isIdentityTransition) {
        this.sendMessage({
          action: body.action,
          id: body.id,
          ...(hasEventFilters ? {matchedEventFilterKeys} : {}),
          ...(typeof body.model === "string" ? {model: body.model} : {}),
          previousId: body.previousId
        }, meta)
      }
      return
    }

    const configuration = this.session.configuration

    if (!configuration) {
      throw new Error("Frontend model websocket channel has no configuration for transport serialization")
    }

    /**
     * Deliver body.
     * @type {FrontendModelLifecycleBroadcastBody} */
    let deliverBody = {
      ...body,
      record: /** @type {import("./query.js").FrontendModelTransportValue} */ (serializeFrontendModelTransportValue(projectedRecord, transportSerializationOptionsForConfiguration(configuration)))
    }

    if (hasEventFilters) {
      deliverBody = {
        ...deliverBody,
        matchedEventFilterKeys
      }
    }

    this.sendMessage(deliverBody, meta)
  }

  /**
   * Checks a destroy against the subscriber's ordinary authorized query by
   * replacing the deleted backing table with the captured pre-delete row. Values
   * are quoted on this trusted database connection; no broadcast-provided SQL is run.
   * @param {FrontendModelLifecycleBroadcastBody} body - Destroy broadcast body.
   * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
   * @returns {Promise<boolean>} - Whether the subscriber could read the record before deletion.
   */
  async _destroyEventIsAuthorized(body, FrontendModelController) {
    const destroyAuthorizationRecord = body.destroyAuthorizationRecord
    const id = body.id

    if (id === undefined || id === null || !destroyAuthorizationRecord || typeof destroyAuthorizationRecord !== "object" || Array.isArray(destroyAuthorizationRecord)) return false

    return await this._withEventTenant(id, async () => {
      const controller = this._frontendModelController(FrontendModelController)

      await controller.ensureFrontendModelClassInitialized()

      const ModelClass = controller.frontendModelClass()
      const primaryKey = controller.frontendModelPrimaryKey()
      const ruleQueryFactory = () => this._destroyAuthorizationQuery(ModelClass, destroyAuthorizationRecord)
      const query = controller.frontendModelAuthorizedQuery("find", {ruleQueryFactory})

      this._applyDestroyAuthorizationRecordToQuery(query, ModelClass, destroyAuthorizationRecord)
      query.where({
        [ModelClass.tableName()]: frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id)
      })

      return Boolean(await query.first())
    })
  }

  /**
   * Builds a backing-model query whose source is the captured pre-delete row.
   * @param {typeof import("../database/record/index.js").default} ModelClass - Backing model class.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} destroyAuthorizationRecord - Captured pre-delete record.
   * @returns {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} - One-row model query.
   */
  _destroyAuthorizationQuery(ModelClass, destroyAuthorizationRecord) {
    const query = ModelClass._newQuery()

    this._applyDestroyAuthorizationRecordToQuery(query, ModelClass, destroyAuthorizationRecord)

    return query
  }

  /**
   * Replaces a query's backing table with a safely quoted one-row derived table.
   * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} query - Query to update.
   * @param {typeof import("../database/record/index.js").default} ModelClass - Backing model class.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} destroyAuthorizationRecord - Captured pre-delete record.
   * @returns {void}
   */
  _applyDestroyAuthorizationRecordToQuery(query, ModelClass, destroyAuthorizationRecord) {
    const selectedColumns = Object.entries(destroyAuthorizationRecord).map(([columnName, serializedValue]) => {
      const binaryMarker = serializedValue && typeof serializedValue === "object" && !Array.isArray(serializedValue)
        && serializedValue.__velociousDestroyAuthorizationType === "binary"
        && Array.isArray(serializedValue.value)
      const value = binaryMarker
        ? Buffer.from(serializedValue.value)
        : deserializeFrontendModelTransportValue(serializedValue)
      const quotedValue = value === null ? "NULL" : query.driver.quote(value)

      return `${quotedValue} AS ${query.driver.quoteColumn(columnName)}`
    })

    if (selectedColumns.length === 0) {
      throw new Error(`Cannot authorize a destroyed ${ModelClass.name} without captured attributes`)
    }

    const froms = query.getFroms()

    froms.splice(0, froms.length)
    query.from(`(SELECT ${selectedColumns.join(", ")}) AS ${query.driver.quoteTable(ModelClass.tableName())}`)
  }

  /**
   * Runs matches.
   * @param {Record<string, import("./query.js").FrontendModelTransportValue>} broadcastParams - Params from `broadcastToChannel`.
   * @returns {boolean} Whether the broadcast matches this subscriber's model.
   */
  matches(broadcastParams) {
    return broadcastParams?.model === this._modelName()
  }

  /**
   * Runs debug snapshot.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} Debug-safe subscription details.
   */
  debugSnapshot() {
    const eventFilters = this._eventFilters()

    return {
      abilities: this.params.abilities !== undefined,
      eventFilterCount: eventFilters.length,
      destroyEventDelivery: this.params.destroyEventDelivery === true,
      model: this._modelName(),
      preload: this.params.preload !== undefined,
      queryData: this.params.queryData !== undefined,
      select: this.params.select !== undefined,
      selectsExtra: this.params.selectsExtra !== undefined,
      unfilteredEventDelivery: this.params.unfilteredEventDelivery === true,
      withCount: this.params.withCount !== undefined
    }
  }

  /**
   * Runs model name.
   * @returns {string | null} - Requested frontend-model name or null.
   */
  _modelName() {
    return typeof this.params?.model === "string" && this.params.model.length > 0
      ? this.params.model
      : null
  }

  /**
   * Runs has event filter params.
   * @returns {boolean} - Whether this subscription requested event query filters.
   */
  _hasEventFilterParams() {
    return this._eventFilters().length > 0
  }

  /**
   * Runs has unfiltered event delivery.
   * @returns {boolean} - Whether unfiltered callbacks should receive every event.
   */
  _hasUnfilteredEventDelivery() {
    return this.params.unfilteredEventDelivery === true
  }

  /**
   * Runs has destroy event delivery.
   * @returns {boolean} - Whether id-only destroy events should be delivered with event filters.
   */
  _hasDestroyEventDelivery() {
    return this.params.destroyEventDelivery === true
  }

  /**
   * Runs event filters.
   * @returns {import("./query.js").FrontendModelEventFilterPayloadEntry[]} - Valid event filters.
   */
  _eventFilters() {
    if (this.params.eventFilters === undefined) return []
    if (!Array.isArray(this.params.eventFilters)) {
      throw new Error("Frontend model eventFilters must be an array")
    }

    return this.params.eventFilters.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("Frontend model eventFilters entries must be objects")
      }

      const eventFilter = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (entry)
      const unknownKeys = Object.keys(eventFilter).filter((key) => !EVENT_FILTER_KEYS.has(key))

      if (unknownKeys.length > 0) {
        throw new Error(`Frontend model eventFilters entries cannot include ${unknownKeys.join(", ")}`)
      }

      if (typeof eventFilter.key !== "string" || eventFilter.key.length === 0) {
        throw new Error("Frontend model eventFilters entries require a key")
      }

      /**
       * Sanitized event filter.
       * @type {import("./query.js").FrontendModelEventFilterPayloadEntry} */
      const sanitizedEventFilter = {key: eventFilter.key}

      if (eventFilter.joins !== undefined) {
        sanitizedEventFilter.joins = /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (eventFilter.joins)
      }

      if (eventFilter.searches !== undefined) {
        sanitizedEventFilter.searches = /** @type {import("./query.js").FrontendModelSearch[]} */ (eventFilter.searches)
      }

      if (eventFilter.where !== undefined) {
        sanitizedEventFilter.where = /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (eventFilter.where)
      }

      return sanitizedEventFilter
    })
  }

  /**
   * Runs frontend model controller class.
   * @returns {Promise<typeof import("../frontend-model-controller.js").default>} - Frontend model controller class.
   */
  async _frontendModelControllerClass() {
    const frontendModelControllerPath = "../frontend-model-controller.js"
    const {default: FrontendModelController} = await import(frontendModelControllerPath)

    return FrontendModelController
  }

  /**
   * Runs frontend model controller.
   * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [params] - Optional params override.
   * @returns {import("../frontend-model-controller.js").default} - Synthetic controller used for resource serialization.
   */
  _frontendModelController(FrontendModelController, params = {}) {
    const configuration = this.session.configuration
    const controller = new FrontendModelController({
      action: "websocketEvent",
      configuration,
      controller: "frontend-models",
      params: {
        abilities: this.params.abilities,
        joins: this.params.joins,
        model: this._modelName(),
        preload: this.params.preload,
        queryData: this.params.queryData,
        searches: this.params.searches,
        select: this.params.select,
        selectsExtra: this.params.selectsExtra,
        where: this.params.where,
        ...params,
        withCount: this.params.withCount
      },
      request: /** @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest()),
      response: new Response({configuration}),
      viewPath: "/"
    })

    controller._frontendModelAbilityOverride = this._ability || undefined

    return controller
  }

  /**
   * Resolves tenant for event.
   * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
   * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolved tenant.
   */
  async _resolveEventTenant(id) {
    const configuration = this.session.configuration

    return await configuration.ensureConnections({name: "Frontend model websocket event tenant resolution"}, async () => {
      // Mirror the subscribe-time tenant resolution (`WebsocketSession._resolveTenant`):
      // pass `subscription: {channel, params}` so resolvers that derive scope from the
      // subscription behave the same for broadcasts as they did at `channel-subscribe`.
      // The synthetic request forwards the subscriber's params (e.g. authenticationToken),
      // matching this channel's ability resolution above.
      return await configuration.resolveTenant({
        params: {...this.params, id, model: this._modelName()},
        request: /** @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest()),
        response: new Response({configuration}),
        subscription: {channel: FRONTEND_MODELS_CHANNEL_NAME, params: this.params}
      })
    })
  }

  /**
   * Resolves the subscriber's tenant for the broadcast record and runs `callback` inside that tenant
   * context. Broadcast delivery runs in whatever ambient tenant context the publisher left behind. For
   * multi-tenant records that ambient tenant may have been resolved without the subscriber's request
   * (e.g. a relay endpoint or background job mutating the row), so it lacks the subscriber's per-record
   * access flags and the per-event authorization query wrongly finds nothing. Re-resolving the tenant
   * from the event record id plus the subscriber's request makes the authorization queries run against
   * the subscriber's own tenant/ability scope. When no tenant resolves (non-multitenant configs), the
   * callback runs directly so the ambient context is preserved.
   * @template T
   * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
   * @param {() => Promise<T>} callback - Authorized-query callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _withEventTenant(id, callback) {
    const configuration = this.session.configuration

    if (!configuration || typeof configuration.resolveTenant !== "function") {
      return await callback()
    }

    const tenant = await this._resolveEventTenant(id)

    // Always enter `runWithTenant`, even when no tenant resolved. Broadcast fan-out
    // runs in the publisher's ambient tenant context; falling back to `callback()`
    // there would authorize a cross-tenant record against the publisher's tenant and
    // could leak it to a subscriber whose own resolver could not resolve it.
    return await configuration.runWithTenant(tenant, async () => {
      return await configuration.ensureConnections({name: "Frontend model websocket event tenant"}, callback)
    })
  }

  /**
   * Runs matched event filter keys for event id.
   * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
   * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
   * @returns {Promise<string[]>} - Event filter keys matched by the record.
   */
  async _matchedEventFilterKeysForEventId(id, FrontendModelController) {
    /**
     * Matched event filter keys.
     * @type {string[]} */
    const matchedEventFilterKeys = []

    for (const eventFilter of this._eventFilters()) {
      const matches = await this._eventMatchesFilter({
        FrontendModelController,
        eventFilter,
        id
      })

      if (matches) matchedEventFilterKeys.push(eventFilter.key)
    }

    return matchedEventFilterKeys
  }

  /**
   * Runs event matches filter.
   * @param {object} args - Filter args.
   * @param {typeof import("../frontend-model-controller.js").default} args.FrontendModelController - Server-side frontend-model controller class.
   * @param {import("./query.js").FrontendModelEventFilterPayloadEntry} args.eventFilter - Event filter payload.
   * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} args.id - Event record id.
   * @returns {Promise<boolean>} Whether the record matches the filter.
   */
  async _eventMatchesFilter({FrontendModelController, eventFilter, id}) {
    return await this._withEventTenant(id, async () => {
      const controller = this._frontendModelController(FrontendModelController, {
        joins: eventFilter.joins,
        searches: eventFilter.searches,
        where: eventFilter.where
      })

      await controller.ensureFrontendModelClassInitialized()

      const ModelClass = controller.frontendModelClass()
      const primaryKey = controller.frontendModelPrimaryKey()
      const where = controller.frontendModelWhere()
      const joins = controller.frontendModelJoins()
      // Start from the subscriber's authorized scope so a filter can only ever match records the
      // subscription's ability permits to read.
      let query = controller.frontendModelAuthorizedQuery("find").where({
        [ModelClass.tableName()]: frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id)
      })

      if (where) controller.applyFrontendModelWhere({query, where})
      if (joins) controller.applyFrontendModelJoins({joins, query})

      for (const search of controller.frontendModelSearches()) {
        controller.applyFrontendModelSearch({query, search})
      }

      return Boolean(await query.first())
    })
  }

  /**
   * Runs projected record for event id.
   * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
   * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
   * @returns {Promise<Record<string, import("./query.js").FrontendModelTransportValue> | null>} - Serialized projected record.
   */
  async _projectedRecordForEventId(id, FrontendModelController) {
    return await this._withEventTenant(id, async () => {
      const controller = this._frontendModelController(FrontendModelController)

      await controller.ensureFrontendModelClassInitialized()

      const ModelClass = controller.frontendModelClass()
      const primaryKey = controller.frontendModelPrimaryKey()
      // Reload through the subscriber's authorized scope so projected records are only ever sent for
      // rows the subscription's ability permits to read.
      let query = controller.frontendModelAuthorizedQuery("find").where({
        [ModelClass.tableName()]: frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id)
      })
      const preload = controller.frontendModelPreload()

      if (preload) query = query.preload(preload)

      for (const entry of controller.frontendModelWithCount()) {
        /**
         * Spec.
         * @type {Record<string, boolean | {relationship?: string, where?: Record<string, import("./query.js").FrontendModelTransportValue>}>} */
        const spec = {}

        spec[entry.attributeName] = {
          relationship: entry.relationshipName,
          where: entry.where ? /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (entry.where) : undefined
        }
        query.withCount(spec)
      }

      const queryData = controller.frontendModelQueryData()

      if (queryData !== null) query.queryData(queryData)

      query = controller.applyFrontendModelTranslatedAttributePreloads({query})

      const model = await query.first()

      if (!model) return null

      if (this.params.abilities !== undefined) {
        await controller.frontendModelComputeAbilities([model])
      }

      controller._frontendModelAbilityOverride = undefined

      return await controller.frontendModelResourceInstance().serialize(model, "find")
    })
  }

  /**
   * Minimal Request-like stub used only for ability resolution. Avoids
   * importing `WebsocketRequest` here because its `node:querystring`
   * dependency would pull server-only code into browser bundles via
   * the `configuration → logger → websocket-publishers` import chain.
   * Header names are normalized to lowercase so `header("cookie")`
   * finds a value regardless of whether the upgrade-request headers
   * map uses `"Cookie"` or `"cookie"`. Session metadata stays separate
   * from headers and is exposed through `metadata(...)` for ability
   * resolvers that need websocket-delivered session data.
   * @returns {FrontendModelWebsocketSyntheticRequest} Request-like object for ability resolution.
   */
  _syntheticRequest() {
    const upgradeRequest = /** @type {FrontendModelWebsocketUpgradeRequest} */ (this.session.upgradeRequest)
    const rawHeaders = typeof upgradeRequest?.headers === "function" ? upgradeRequest.headers() : {}
    const metadata = typeof this.session.getMetadata === "function" ? this.session.getMetadata() : {}
    const remoteAddress = typeof upgradeRequest?.remoteAddress === "function" ? upgradeRequest.remoteAddress() : undefined
    /**
     * Header map.
     * @type {Record<string, string | string[] | undefined>} */
    const headerMap = {}

    for (const key of Object.keys(rawHeaders || {})) {
      headerMap[key.toLowerCase()] = rawHeaders[key]
    }

    return {
      headers: () => headerMap,
      header: (name) => headerMap[String(name).toLowerCase()],
      metadata: (key) => key === undefined ? {...metadata} : metadata[key],
      path: () => "/frontend-models",
      httpMethod: () => "POST",
      remoteAddress: () => remoteAddress,
      origin: () => headerMap.origin
    }
  }
}
