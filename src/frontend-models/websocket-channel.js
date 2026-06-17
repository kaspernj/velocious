// @ts-check

import VelociousWebsocketChannel from "../http-server/websocket-channel.js"
import Response from "../http-server/client/response.js"
import {serializeFrontendModelTransportValue} from "./transport-serialization.js"

const EVENT_FILTER_KEYS = new Set(["joins", "key", "searches", "where"])

/**
 * Defines this typedef.
 * @typedef {{action?: string, id?: string | number, matchedEventFilterKeys?: string[], record?: import("./query.js").FrontendModelTransportValue, [key: string]: import("./query.js").FrontendModelTransportValue | string[] | undefined}} FrontendModelLifecycleBroadcastBody
 */
/**
 * Defines this typedef.
 * @typedef {{headers?: () => Record<string, string | string[] | undefined>, remoteAddress?: () => string | undefined}} FrontendModelWebsocketUpgradeRequest
 */
/**
 * Defines this typedef.
 * @typedef {{headers: () => Record<string, string | string[] | undefined>, header: (name: string) => string | string[] | undefined, metadata: (key?: string) => Record<string, import("./query.js").FrontendModelTransportValue> | import("./query.js").FrontendModelTransportValue | undefined, path: () => string, httpMethod: () => string, remoteAddress: () => string | undefined, origin: () => string | string[] | undefined}} FrontendModelWebsocketSyntheticRequest
 */

/**
 * Per-session channel subscription for frontend-model lifecycle events.
 * Replaces the legacy `FrontendModelWebsocketChannel` (Phase 3).
 *
 * Auth model: subscribe-time only. `canSubscribe` resolves the caller's
 * ability once, checks that at least one `allow` rule exists for
 * `read` on the requested model class, and then delivers future
 * lifecycle broadcasts for that model without re-authorizing per event.
 * This matches the explicit design decision in Phase 3 to trade
 * per-record visibility guarantees for massively cheaper broadcast fan-out.
 * Subscriber-provided event filters can still narrow which create/update
 * events are delivered, but they are matching predicates rather than
 * per-record authorization checks.
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
    const modelClasses = configuration.getModelClasses()
    const ModelClass = modelClasses[modelName]

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

    return readRules.some((/**
                            * Narrows the runtime value to the documented type.
                            * @type {{effect: string}} */ rule) => rule.effect === "allow")
  }

  /**
   * Runs deliver broadcast.
   * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
   * @param {{eventId?: string}} [meta] - Optional event metadata.
   * @returns {Promise<void>} Resolves after delivery.
   */
  async deliverBroadcast(body, meta) {
    const configuration = this.session.configuration

    if (configuration) {
      await configuration.ensureConnections({name: "Frontend model websocket broadcast"}, async () => {
        await this._deliverBroadcast(body, meta)
      })
      return
    }

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

    if (!this._hasProjectionParams() && !hasEventFilters) {
      // Even unfiltered subscriptions must respect the subscriber's ability. A create/update carries
      // the record, so only deliver it when the record is within the authenticated ability's scope.
      // Destroys (and bodies without a usable id) carry no record, so pass them through unchanged.
      if (body && typeof body === "object" && (body.action === "create" || body.action === "update") && body.id !== undefined && body.id !== null) {
        const FrontendModelController = await this._frontendModelControllerClass()

        if (!await this._eventIsAccessible(body.id, FrontendModelController)) return
      }

      this.sendMessage(body, meta)
      return
    }

    if (!body || typeof body !== "object") {
      if (!hasEventFilters || this._hasUnfilteredEventDelivery()) this.sendMessage(body, meta)
      return
    }

    if (body.action === "destroy") {
      if (!hasEventFilters || this._hasDestroyEventDelivery() || this._hasUnfilteredEventDelivery()) this.sendMessage(body, meta)
      return
    }

    if (body.id === undefined || body.id === null) {
      if (!hasEventFilters || this._hasUnfilteredEventDelivery()) this.sendMessage(body, meta)
      return
    }

    const FrontendModelController = await this._frontendModelControllerClass()
    const matchedEventFilterKeys = await this._matchedEventFilterKeysForEventId(body.id, FrontendModelController)

    if (hasEventFilters && matchedEventFilterKeys.length === 0 && !this._hasUnfilteredEventDelivery()) {
      return
    }

    /**
     * Deliver body.
     * @type {FrontendModelLifecycleBroadcastBody} */
    let deliverBody = body

    if (this._hasProjectionParams()) {
      const projectedRecord = await this._projectedRecordForEventId(body.id, FrontendModelController)

      if (!projectedRecord) {
        return
      }

      deliverBody = {
        ...deliverBody,
        record: /**
                 * Narrows the runtime value to the documented type.
                 * @type {import("./query.js").FrontendModelTransportValue} */ (serializeFrontendModelTransportValue(projectedRecord))
      }
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
   * Runs matches.
   * @param {Record<string, import("./query.js").FrontendModelTransportValue>} broadcastParams - Params from `broadcastToChannel`.
   * @returns {boolean} Whether the broadcast matches this subscriber's model.
   */
  matches(broadcastParams) {
    return broadcastParams?.model === this._modelName()
  }

  /**
   * Runs debug snapshot.
   * @returns {Record<string, ?>} Debug-safe subscription details.
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
   * Runs has projection params.
   * @returns {boolean} - Whether this subscription requested per-event record projection.
   */
  _hasProjectionParams() {
    return this.params.select !== undefined
      || this.params.selectsExtra !== undefined
      || this.params.preload !== undefined
      || this.params.withCount !== undefined
      || this.params.abilities !== undefined
      || this.params.queryData !== undefined
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

      const eventFilter = /**
                           * Narrows the runtime value to the documented type.
                           * @type {Record<string, ?>} */ (entry)
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
        sanitizedEventFilter.joins = /**
                                      * Narrows the runtime value to the documented type.
                                      * @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (eventFilter.joins)
      }

      if (eventFilter.searches !== undefined) {
        sanitizedEventFilter.searches = /**
                                         * Narrows the runtime value to the documented type.
                                         * @type {import("./query.js").FrontendModelSearch[]} */ (eventFilter.searches)
      }

      if (eventFilter.where !== undefined) {
        sanitizedEventFilter.where = /**
                                      * Narrows the runtime value to the documented type.
                                      * @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (eventFilter.where)
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
   * @param {Record<string, ?>} [params] - Optional params override.
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
      request: /**
                * Narrows the runtime value to the documented type.
                * @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest()),
      response: new Response({configuration}),
      viewPath: "/"
    })

    controller._frontendModelAbilityOverride = this._ability || undefined

    return controller
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
   * @param {string | number} id - Event record id.
   * @param {() => Promise<T>} callback - Authorized-query callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _withEventTenant(id, callback) {
    const configuration = this.session.configuration

    if (!configuration || typeof configuration.resolveTenant !== "function") {
      return await callback()
    }

    const tenant = await configuration.resolveTenant({
      params: {...this.params, id, model: this._modelName()},
      request: /**
                * Narrows the runtime value to the documented type.
                * @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest()),
      response: new Response({configuration})
    })

    if (!tenant) {
      return await callback()
    }

    return await configuration.runWithTenant(tenant, async () => {
      return await configuration.ensureConnections({name: "Frontend model websocket event tenant"}, callback)
    })
  }

  /**
   * Whether the broadcast record is within the subscriber's authenticated ability scope. Used to gate
   * unfiltered/unprojected create/update delivery so a scoped token never receives a record it cannot read.
   * @param {string | number} id - Event record id.
   * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
   * @returns {Promise<boolean>} True when the record is readable by this subscription.
   */
  async _eventIsAccessible(id, FrontendModelController) {
    return await this._withEventTenant(id, async () => {
      const controller = this._frontendModelController(FrontendModelController)

      await controller.ensureFrontendModelClassInitialized()

      const ModelClass = controller.frontendModelClass()
      const primaryKey = ModelClass.primaryKey()
      const query = controller.frontendModelAuthorizedQuery("find").where({[ModelClass.tableName()]: {[primaryKey]: id}})

      return Boolean(await query.first())
    })
  }

  /**
   * Runs matched event filter keys for event id.
   * @param {string | number} id - Event record id.
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
   * @param {string | number} args.id - Event record id.
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
      const primaryKey = ModelClass.primaryKey()
      const where = controller.frontendModelWhere()
      const joins = controller.frontendModelJoins()
      // Start from the subscriber's authorized scope so a filter can only ever match records the
      // subscription's ability permits to read.
      let query = controller.frontendModelAuthorizedQuery("find").where({[ModelClass.tableName()]: {[primaryKey]: id}})

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
   * @param {string | number} id - Event record id.
   * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
   * @returns {Promise<Record<string, import("./query.js").FrontendModelTransportValue> | null>} - Serialized projected record.
   */
  async _projectedRecordForEventId(id, FrontendModelController) {
    return await this._withEventTenant(id, async () => {
      const controller = this._frontendModelController(FrontendModelController)

      await controller.ensureFrontendModelClassInitialized()

      const ModelClass = controller.frontendModelClass()
      const primaryKey = ModelClass.primaryKey()
      // Reload through the subscriber's authorized scope so projected records are only ever sent for
      // rows the subscription's ability permits to read.
      let query = controller.frontendModelAuthorizedQuery("find").where({[ModelClass.tableName()]: {[primaryKey]: id}})
      const preload = controller.frontendModelPreload()

      if (preload) query = query.preload(preload)

      for (const entry of controller.frontendModelWithCount()) {
        /**
         * Spec.
         * @type {Record<string, boolean | {relationship?: string, where?: Record<string, import("./query.js").FrontendModelTransportValue>}>} */
        const spec = {}

        spec[entry.attributeName] = {
          relationship: entry.relationshipName,
          where: entry.where ? /**
                                * Narrows the runtime value to the documented type.
                                * @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (entry.where) : undefined
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
    const upgradeRequest = /**
                            * Narrows the runtime value to the documented type.
                            * @type {FrontendModelWebsocketUpgradeRequest} */ (this.session.upgradeRequest)
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
