// @ts-check

import VelociousWebsocketChannel from "../http-server/websocket-channel.js"
import Response from "../http-server/client/response.js"
import {serializeFrontendModelTransportValue} from "./transport-serialization.js"

/**
 * @typedef {{action?: string, id?: string | number, record?: import("./query.js").FrontendModelTransportValue, [key: string]: import("./query.js").FrontendModelTransportValue | undefined}} FrontendModelLifecycleBroadcastBody
 */
/**
 * @typedef {{headers?: () => Record<string, string | string[] | undefined>, remoteAddress?: () => string | undefined}} FrontendModelWebsocketUpgradeRequest
 */
/**
 * @typedef {{headers: () => Record<string, string | string[] | undefined>, header: (name: string) => string | string[] | undefined, metadata: (key?: string) => Record<string, import("./query.js").FrontendModelTransportValue> | import("./query.js").FrontendModelTransportValue | undefined, path: () => string, httpMethod: () => string, remoteAddress: () => string | undefined, origin: () => string | string[] | undefined}} FrontendModelWebsocketSyntheticRequest
 */

/**
 * Per-session channel subscription for frontend-model lifecycle events.
 * Replaces the legacy `FrontendModelWebsocketChannel` (Phase 3).
 *
 * Auth model: subscribe-time only. `canSubscribe` resolves the caller's
 * ability once, checks that at least one `allow` rule exists for
 * `read` on the requested model class, and then delivers every future
 * lifecycle broadcast for that model without re-authorizing per event.
 * This matches the explicit design decision in Phase 3 to trade
 * per-record visibility guarantees for massively cheaper broadcast fan-out.
 *
 * Wire: subscribe with `subscribeChannel("frontend-models", {params: {model: ModelName}})`.
 * Backend publishes `{action, id, record}` via
 * `configuration.broadcastToChannel("frontend-models", {model: ModelName}, body)`;
 * `matches()` routes by model name.
 */
export default class FrontendModelWebsocketChannel extends VelociousWebsocketChannel {
  /** @type {import("../authorization/ability.js").default | null} */
  _ability = null

  /** @returns {Promise<boolean>} Whether the frontend-model subscription is authorized. */
  async canSubscribe() {
    const modelName = this._modelName()

    if (!modelName) return false

    const configuration = this.session.configuration
    const modelClasses = configuration.getModelClasses?.() || {}
    const ModelClass = modelClasses[modelName]

    if (!ModelClass) return false

    const ability = await configuration.resolveAbility?.({
      params: {model: modelName},
      request: /** @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest()),
      response: new Response({configuration})
    })

    if (!ability) return false
    this._ability = ability

    // Load resource-declared rules for this model class before checking,
    // otherwise `rulesFor` returns empty for abilities whose resources
    // register rules lazily via `abilities()`.
    if (typeof ability.loadAbilitiesForModelClass === "function") {
      ability.loadAbilitiesForModelClass(ModelClass)
    }

    const readRules = typeof ability.rulesFor === "function"
      ? ability.rulesFor({action: "read", modelClass: ModelClass})
      : []

    return readRules.some((/** @type {{effect: string}} */ rule) => rule.effect === "allow")
  }

  /**
   * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
   * @param {{eventId?: string}} [meta] - Optional event metadata.
   * @returns {Promise<void>} Resolves after delivery.
   */
  async deliverBroadcast(body, meta) {
    if (!this._hasProjectionParams()) {
      this.sendMessage(body, meta)
      return
    }

    if (!body || typeof body !== "object" || body.action === "destroy") {
      this.sendMessage(body, meta)
      return
    }

    if (body.id === undefined || body.id === null) {
      this.sendMessage(body, meta)
      return
    }

    const projectedRecord = await this._projectedRecordForEventId(body.id)

    if (!projectedRecord) {
      this.sendMessage(body, meta)
      return
    }

    this.sendMessage({
      ...body,
      record: serializeFrontendModelTransportValue(projectedRecord)
    }, meta)
  }

  /**
   * @param {Record<string, import("./query.js").FrontendModelTransportValue>} broadcastParams - Params from `broadcastToChannel`.
   * @returns {boolean} Whether the broadcast matches this subscriber's model.
   */
  matches(broadcastParams) {
    return broadcastParams?.model === this._modelName()
  }

  /** @returns {string | null} - Requested frontend-model name or null. */
  _modelName() {
    return typeof this.params?.model === "string" && this.params.model.length > 0
      ? this.params.model
      : null
  }

  /** @returns {boolean} - Whether this subscription requested per-event record projection. */
  _hasProjectionParams() {
    return this.params.select !== undefined
      || this.params.preload !== undefined
      || this.params.withCount !== undefined
      || this.params.abilities !== undefined
      || this.params.queryData !== undefined
  }

  /**
   * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
   * @returns {import("../frontend-model-controller.js").default} - Synthetic controller used for resource serialization.
   */
  _frontendModelController(FrontendModelController) {
    const configuration = this.session.configuration
    const controller = new FrontendModelController({
      action: "websocketEvent",
      configuration,
      controller: "frontend-models",
      params: {
        abilities: this.params.abilities,
        model: this._modelName(),
        preload: this.params.preload,
        queryData: this.params.queryData,
        select: this.params.select,
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
   * @param {string | number} id - Event record id.
   * @returns {Promise<Record<string, import("./query.js").FrontendModelTransportValue> | null>} - Serialized projected record.
   */
  async _projectedRecordForEventId(id) {
    const frontendModelControllerPath = "../frontend-model-controller.js"
    const {default: FrontendModelController} = await import(frontendModelControllerPath)
    const controller = this._frontendModelController(FrontendModelController)

    await controller.ensureFrontendModelClassInitialized()

    const ModelClass = controller.frontendModelClass()
    const primaryKey = ModelClass.primaryKey()
    let query = ModelClass.where({[primaryKey]: id})
    const preload = controller.frontendModelPreload()

    if (preload) query = query.preload(preload)

    for (const entry of controller.frontendModelWithCount()) {
      /** @type {Record<string, boolean | {relationship?: string, where?: Record<string, import("./query.js").FrontendModelTransportValue>}>} */
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
    /** @type {Record<string, string | string[] | undefined>} */
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
