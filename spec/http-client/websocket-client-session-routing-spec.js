// @ts-check

import WebsocketClient from "../../src/http-client/websocket-client.js"
import {describe, expect, it} from "../../src/testing/test.js"

class RecordingWebSocket {
  static CLOSED = 3
  static CONNECTING = 0
  static OPEN = 1
  static urls = []
  static constructed = Promise.resolve()
  static signalConstructed = () => {}
  CLOSED = 3
  CONNECTING = 0
  OPEN = 1
  readyState = 0

  /** @param {string | URL} url */
  constructor(url) {
    RecordingWebSocket.urls.push(String(url))
    RecordingWebSocket.signalConstructed()
  }

  addEventListener() {}
  removeEventListener() {}
}

describe("WebSocket client session routing", () => {
  it("adds the prior session identity to reconnect and cold-restore URLs", async () => {
    RecordingWebSocket.urls = []
    RecordingWebSocket.constructed = new Promise((resolve) => {
      RecordingWebSocket.signalConstructed = resolve
    })
    const sessionStore = {
      clear: () => {},
      get: () => "restored-session",
      set: () => {}
    }
    const client = new WebsocketClient({
      sessionStore,
      url: "ws://localhost:3006/websocket?locale=da",
      webSocketImplementation: /** @type {typeof globalThis.WebSocket} */ (/** @type {unknown} */ (RecordingWebSocket))
    })

    const connecting = client._connect()

    await RecordingWebSocket.constructed
    expect(RecordingWebSocket.urls).toEqual([
      "ws://localhost:3006/websocket?locale=da&velociousSessionId=restored-session"
    ])

    void connecting.catch(() => {})
  })
})
