// @ts-check

/**
 * Builds a fake websocket client implementing the sync.client.realtime
 * createClient contract with recorded connects, disconnects, and subscriptions
 * that can emit messages and resumes. Connect and subscription readiness can be
 * deferred to exercise subscribe-in-flight races and readiness gating.
 * @param {object} [args] - Fake client args.
 * @param {boolean} [args.deferConnect] - Keep connect() pending until resolveConnect() is called.
 * @param {boolean} [args.deferReady] - Keep waitForReady() pending until each subscription's resolveReady() is called.
 * @returns {?} Fake websocket client.
 */
export function buildFakeWebsocketClient({deferConnect, deferReady} = {}) {
  const fakeWebsocketClient = {
    /** @returns {Promise<void>} */
    connect: () => {
      fakeWebsocketClient.connectCalls += 1

      if (!deferConnect) return Promise.resolve()

      return new Promise((resolve) => {
        fakeWebsocketClient.resolveConnect = resolve
      })
    },
    connectCalls: 0,
    /** @returns {Promise<void>} */
    disconnectAndStopReconnect: async () => {
      fakeWebsocketClient.disconnectCalls += 1
    },
    disconnectCalls: 0,
    /** @type {(() => void) | null} */
    resolveConnect: null,
    /**
     * @param {string} channelType - Channel name.
     * @param {{params?: Record<string, ?>, onMessage?: (body: ?) => void, onResume?: () => void}} [options] - Subscription options.
     * @returns {?} Fake subscription.
     */
    subscribeChannel: (channelType, {onMessage, onResume, params} = {}) => {
      const subscription = {
        channelType,
        /** @returns {void} */
        close: () => {
          subscription.closed = true
        },
        closed: false,
        /** @param {?} body - Message body. @returns {void} */
        emitMessage: (body) => {
          if (onMessage) onMessage(body)
        },
        /** @returns {void} */
        emitResume: () => {
          if (onResume) onResume()
        },
        /** @returns {boolean} Whether the subscription is acknowledged. */
        isReady: () => !subscription.closed,
        params,
        /** @type {(() => void) | null} */
        resolveReady: null,
        /** @returns {Promise<void>} Resolves once the subscription is acknowledged. */
        waitForReady: () => {
          if (!deferReady) return Promise.resolve()

          return new Promise((resolve) => {
            subscription.resolveReady = resolve
          })
        }
      }

      fakeWebsocketClient.subscriptions.push(subscription)

      return subscription
    },
    subscriptions: /** @type {Array<?>} */ ([])
  }

  return fakeWebsocketClient
}
