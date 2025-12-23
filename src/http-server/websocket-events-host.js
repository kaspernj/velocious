// @ts-check

export class VelociousHttpServerWebsocketEventsHost {
  constructor() {
    /** @type {Set<import("./worker-handler/index.js").default>} */
    this.handlers = new Set()
  }

  /**
   * @param {import("./worker-handler/index.js").default} handler
   * @returns {() => void}
   */
  register(handler) {
    this.handlers.add(handler)

    return () => this.handlers.delete(handler)
  }

  /**
   * @param {object} args
   * @param {string} args.channel
   * @param {any} args.payload
   * @returns {void}
   */
  publish({channel, payload}) {
    for (const handler of this.handlers) {
      handler.dispatchWebsocketEvent({channel, payload})
    }
  }
}

const websocketEventsHost = new VelociousHttpServerWebsocketEventsHost()

export default websocketEventsHost
