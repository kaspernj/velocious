// @ts-check

export class VelociousHttpServerWebsocketEventsHost {
  constructor() {
    /** @type {Set<import("./worker-handler/index.js").default>} */
    this.handlers = new Set()
  }

  /**
   * @param {import("./worker-handler/index.js").default} handler - Handler instance.
   * @returns {() => void} - The register.
   */
  register(handler) {
    this.handlers.add(handler)

    return () => this.handlers.delete(handler)
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {any} args.payload - Payload data.
   * @returns {void} - No return value.
   */
  publish({channel, payload}) {
    for (const handler of this.handlers) {
      handler.dispatchWebsocketEvent({channel, payload})
    }
  }
}

const websocketEventsHost = new VelociousHttpServerWebsocketEventsHost()

export default websocketEventsHost

