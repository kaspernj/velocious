// @ts-check

import VelociousWebsocketConnection from "../../../../src/http-server/websocket-connection.js"

/**
 * Test-only connection used by the Phase 1A spec. Echoes every
 * incoming message back as `{echo: body}` and replies with
 * `{hello: params.name || "world"}` on open. Sends
 * `{closing: reason}` in `onClose` when the socket is still open so
 * the client spec can verify the server saw the right close reason
 * for client_close / server_close paths.
 */
export default class EchoConnection extends VelociousWebsocketConnection {
  /** @returns {void} */
  onConnect() {
    this.sendMessage({hello: this.params?.name || "world"})
  }

  /**
   * @param {any} body
   * @returns {void}
   */
  onMessage(body) {
    if (body?.__testCloseFromServer) {
      void this.close("server_close")
      return
    }

    this.sendMessage({echo: body})
  }

  /**
   * @param {string} reason
   * @returns {void}
   */
  onClose(reason) {
    // Fire a "closing" notice if the socket is still open — the
    // base class will send `connection-closed` right after.
    try {
      this.sendMessage({closing: reason})
    } catch {
      // Socket already gone (session_destroyed) — nothing to do.
    }
  }
}
