// @ts-check

export default class VelociousHttpServerWebsocketChannel {
  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {import("./client/request.js").default | import("./client/websocket-request.js").default | undefined} args.request - Request instance.
   * @param {import("./client/index.js").default} args.client - Client instance.
   * @param {import("./client/websocket-session.js").default} args.websocketSession - Websocket session.
   * @param {Record<string, unknown>} [args.subscriptionParams] - Params from subscribe message.
   */
  constructor({configuration, request, client, websocketSession, subscriptionParams}) {
    this.configuration = configuration
    this.request = request
    this.client = client
    this.websocketSession = websocketSession
    this.subscriptionParams = subscriptionParams
    this._params = this._buildParams()
  }

  /**
   * @returns {Record<string, unknown>} - Params for the websocket connection.
   */
  params() { return this._params }

  /**
   * Called when the channel is created for a websocket connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async subscribed() {}

  /**
   * Called when the websocket disconnects.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async unsubscribed() {}

  /**
   * Subscribe this connection to a broadcast channel.
   * @param {string} channel - Channel name.
   * @param {{acknowledge?: boolean}} [options] - Subscription options.
   * @returns {Promise<boolean>} - Whether the subscription succeeded.
   */
  async streamFrom(channel, options = {}) {
    return await this.websocketSession.subscribeToChannel(channel, {
      acknowledge: options.acknowledge ?? true,
      channelHandler: this
    })
  }

  /**
   * Called when a broadcast event is delivered for one of this channel instance's subscriptions.
   * @param {object} args - Event args.
   * @param {string} args.channel - Broadcast channel name.
   * @param {any} args.payload - Broadcast payload.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async receivedBroadcast({channel, payload}) {
    this.websocketSession.sendJson({channel, payload, type: "event"})
  }

  /**
   * @returns {Record<string, unknown>} - Parsed params.
   */
  _buildParams() {
    /** @type {Record<string, unknown>} */
    const params = {}

    if (this.request?.params) {
      const requestParams = this.request.params()

      if (requestParams && typeof requestParams === "object") {
        Object.assign(params, requestParams)
      }
    }

    const pathValue = this.request?.path?.()
    const query = pathValue?.split("?")[1]

    if (query) {
      const searchParams = new URLSearchParams(query)

      for (const [key, value] of searchParams.entries()) {
        if (params[key] === undefined) {
          params[key] = value
        }
      }
    }

    if (this.subscriptionParams && typeof this.subscriptionParams === "object") {
      Object.assign(params, this.subscriptionParams)
    }

    return params
  }
}
