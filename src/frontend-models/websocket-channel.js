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
    const subscribed = await this.streamFrom(frontendModelBroadcastChannelName(modelName), {acknowledge: false})

    if (!subscribed) return

    this.websocketSession.sendJson({
      channel: "frontend-models",
      params: {model: modelName},
      type: "subscribed"
    })
  }

  /**
   * @param {object} args - Event args.
   * @param {string} args.channel - Broadcast channel.
   * @param {string} [args.createdAt] - Event creation timestamp.
   * @param {string} [args.eventId] - Event id.
   * @param {Record<string, any>} args.payload - Event payload.
   * @param {boolean} [args.replayed] - Whether this event was replayed.
   * @param {number} [args.sequence] - Event sequence.
   * @returns {Promise<void>} - Resolves when the event has been authorized and emitted.
   */
  async receivedBroadcast({channel, createdAt, eventId, payload, replayed, sequence}) {
    void channel

    const action = payload?.action
    const id = payload?.id

    if (action !== "create" && action !== "destroy" && action !== "update") {
      throw new Error(`Unknown frontend model broadcast action: ${action}`)
    }

    if (id === undefined || id === null) {
      throw new Error(`Frontend model broadcast missing id for action: ${action}`)
    }

    if (action === "destroy") {
      this.websocketSession.sendJson({
        channel: "frontend-models",
        createdAt,
        eventId,
        payload: serializeFrontendModelTransportValue({
          action,
          id,
          model: this.modelName()
        }),
        replayed,
        sequence,
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
      createdAt,
      eventId,
      payload: serializeFrontendModelTransportValue({
        action,
        id,
        model: this.modelName(),
        record: serializedModel
      }),
      replayed,
      sequence,
      type: "event"
    })
  }

  /**
   * @param {string | number} id - Model id.
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
      path: "/frontend-models",
      remoteAddress: this.request?.remoteAddress?.()
    })
  }
}
