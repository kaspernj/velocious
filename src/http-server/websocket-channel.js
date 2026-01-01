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
   * @returns {Promise<boolean>} - Whether the subscription succeeded.
   */
  async streamFrom(channel) {
    return await this.websocketSession.subscribeToChannel(channel, {acknowledge: true})
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
