// @ts-check

import VelociousWebsocketChannelV2 from "../../../../src/http-server/websocket-channel-v2.js"

/**
 * Test-only channel used by the Phase 1B spec.
 *
 * Auth: allows any subscription whose params contain
 * `{allow: true}`; rejects otherwise. Lets the spec exercise both
 * the default-deny path and the happy path.
 *
 * Routing: `matches()` returns true when `broadcastParams.topic`
 * equals the subscription's `params.topic`. Used by the spec to
 * verify per-subscription filtering.
 *
 * On `subscribed()` it fires a welcome message with the subscribed
 * params so the client can confirm the bidirectional wiring.
 */
export default class CounterChannel extends VelociousWebsocketChannelV2 {
  /** @returns {boolean} */
  canSubscribe() {
    return Boolean(this.params?.allow)
  }

  /** @returns {void} */
  subscribed() {
    this.sendMessage({welcome: this.params?.topic || null})
  }

  /**
   * @param {Record<string, any>} broadcastParams
   * @returns {boolean}
   */
  matches(broadcastParams) {
    return broadcastParams.topic === this.params.topic
  }
}
