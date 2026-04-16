// @ts-check

import VelociousWebsocketChannelV2 from "../http-server/websocket-channel-v2.js"
import Response from "../http-server/client/response.js"

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
export default class FrontendModelWebsocketChannelV2 extends VelociousWebsocketChannelV2 {
  /** @returns {Promise<boolean>} */
  async canSubscribe() {
    const modelName = this._modelName()

    if (!modelName) return false

    const configuration = this.session.configuration
    const modelClasses = configuration.getModelClasses?.() || {}
    const ModelClass = modelClasses[modelName]

    if (!ModelClass) return false

    const ability = await configuration.resolveAbility?.({
      params: {model: modelName},
      request: /** @type {any} */ (this._syntheticRequest()),
      response: new Response({configuration})
    })

    if (!ability) return false

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
   * @param {Record<string, any>} broadcastParams - Params from `broadcastToChannel`.
   * @returns {boolean}
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

  /**
   * Minimal Request-like stub used only for ability resolution. Avoids
   * importing `WebsocketRequest` here because its `node:querystring`
   * dependency would pull server-only code into browser bundles via
   * the `configuration → logger → websocket-publishers` import chain.
   *
   * Header names are normalized to lowercase so `header("cookie")`
   * finds a value regardless of whether the upgrade-request headers
   * map uses `"Cookie"` or `"cookie"`.
   *
   * @returns {{headers: () => Record<string, any>, header: (name: string) => any, path: () => string, httpMethod: () => string, remoteAddress: () => string | undefined, origin: () => any}}
   */
  _syntheticRequest() {
    const upgradeRequest = /** @type {any} */ (this.session.upgradeRequest)
    const rawHeaders = typeof upgradeRequest?.headers === "function" ? upgradeRequest.headers() : {}
    const remoteAddress = typeof upgradeRequest?.remoteAddress === "function" ? upgradeRequest.remoteAddress() : undefined
    /** @type {Record<string, any>} */
    const headerMap = {}

    for (const key of Object.keys(rawHeaders || {})) {
      headerMap[key.toLowerCase()] = rawHeaders[key]
    }

    return {
      headers: () => headerMap,
      header: (name) => headerMap[String(name).toLowerCase()],
      path: () => "/frontend-models",
      httpMethod: () => "POST",
      remoteAddress: () => remoteAddress,
      origin: () => headerMap.origin
    }
  }
}
