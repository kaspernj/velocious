// @ts-check

import FrontendModelController from "../frontend-model-controller.js"
import Response from "../http-server/client/response.js"
import WebsocketRequest from "../http-server/client/websocket-request.js"
import WebsocketChannel from "../http-server/websocket-channel.js"
import {frontendModelBroadcastChannelName} from "./websocket-publishers.js"
import {serializeFrontendModelTransportValue} from "./transport-serialization.js"

/** Built-in websocket channel for frontend-model lifecycle events. */
export default class FrontendModelWebsocketChannel extends WebsocketChannel {
  /** @returns {Promise<void>} - Resolves when the websocket subscription is ready. */
  async subscribed() {
    const modelName = this.modelName()

    await this.streamFrom(frontendModelBroadcastChannelName(modelName), {acknowledge: false})
    this.websocketSession.sendJson({
      channel: "frontend-models",
      params: {model: modelName},
      type: "subscribed"
    })
  }

  /**
   * @param {object} args - Event args.
   * @param {string} args.channel - Broadcast channel.
   * @param {Record<string, any>} args.payload - Event payload.
   * @returns {Promise<void>} - Resolves when the event has been authorized and emitted.
   */
  async receivedBroadcast({channel, payload}) {
    void channel

    const action = payload?.action
    const id = payload?.id

    if ((action !== "create" && action !== "destroy" && action !== "update") || typeof id !== "string") return

    if (action === "destroy") {
      this.websocketSession.sendJson({
        channel: "frontend-models",
        payload: serializeFrontendModelTransportValue({
          action,
          id,
          model: this.modelName()
        }),
        type: "event"
      })
      return
    }

    const serializedModelFromPayload = payload?.record && typeof payload.record === "object"
      ? /** @type {Record<string, any>} */ (payload.record)
      : null
    const serializedModel = serializedModelFromPayload || await (async () => {
      const model = await this.findAuthorizedModelById(id)

      if (!model) return null

      return await this.serializeModel(model)
    })()

    if (!serializedModel) return

    this.websocketSession.sendJson({
      channel: "frontend-models",
      payload: serializeFrontendModelTransportValue({
        action,
        id,
        model: this.modelName(),
        record: serializedModel
      }),
      type: "event"
    })
  }

  /**
   * @param {string} id - Model id.
   * @returns {Promise<import("../database/record/index.js").default | null>} - Authorized model or null.
   */
  async findAuthorizedModelById(id) {
    const controller = this.frontendModelController()

    return await this.configuration.ensureConnections(async () => {
      const ability = await this.configuration.resolveAbility({
        params: this.syntheticParams(),
        request: this.syntheticRequest(),
        response: new Response({configuration: this.configuration})
      })

      return await this.configuration.runWithAbility(ability, async () => {
        return await controller.frontendModelAuthorizedQuery("find").findBy({[controller.frontendModelPrimaryKey()]: id})
      })
    })
  }

  /**
   * @param {import("../database/record/index.js").default} model - Model instance.
   * @returns {Promise<Record<string, any>>} - Serialized model payload.
   */
  async serializeModel(model) {
    const controller = this.frontendModelController()

    return await this.configuration.ensureConnections(async () => {
      const ability = await this.configuration.resolveAbility({
        params: this.syntheticParams(),
        request: this.syntheticRequest(),
        response: new Response({configuration: this.configuration})
      })

      return await this.configuration.runWithAbility(ability, async () => {
        return await controller.frontendModelResourceInstance().serialize(model, "find")
      })
    })
  }

  /**
   * @returns {FrontendModelController} - Synthetic frontend-model controller.
   */
  frontendModelController() {
    return new FrontendModelController({
      action: "frontendApi",
      configuration: this.configuration,
      controller: "frontend-models",
      params: this.syntheticParams(),
      request: /** @type {any} */ (this.syntheticRequest()),
      response: new Response({configuration: this.configuration}),
      viewPath: `${this.configuration.getDirectory()}/src/routes/frontend-models`
    })
  }

  /**
   * @returns {string} - Requested frontend-model name.
   */
  modelName() {
    const model = this.params().model

    if (typeof model !== "string" || model.length < 1) {
      throw new Error("Expected frontend-model websocket subscription param 'model'")
    }

    return model
  }

  /**
   * @returns {Record<string, any>} - Synthetic params for authorization and serialization.
   */
  syntheticParams() {
    return {
      model: this.modelName(),
      requests: [{
        model: this.modelName()
      }]
    }
  }

  /**
   * @returns {WebsocketRequest} - Synthetic shared frontend-model request.
   */
  syntheticRequest() {
    return new WebsocketRequest({
      headers: this.request?.headers?.() || {},
      method: "POST",
      params: this.syntheticParams(),
      path: "/velocious/api",
      remoteAddress: this.request?.remoteAddress?.()
    })
  }
}
