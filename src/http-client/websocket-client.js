// @ts-check

import SnapReqWebSocketClient from "snapreq/websocket"
import {deserializeFrontendModelTransportValue} from "../frontend-models/transport-serialization.js"

const DEFAULT_URL = "ws://127.0.0.1:3006/websocket"

/**
 * Velocious's WebSocket client. The cross-platform connection/session/channel
 * machinery lives in snapreq's `SnapReqWebSocketClient`; this thin subclass only
 * pre-wires the two Velocious-specific defaults: the local development websocket
 * URL and frontend-model transport deserialization inside `response.json()`.
 * @augments SnapReqWebSocketClient
 */
export default class VelociousWebsocketClient extends SnapReqWebSocketClient {
  /**
   * @param {Partial<ConstructorParameters<typeof SnapReqWebSocketClient>[0]>} [args] - Options forwarded to `SnapReqWebSocketClient`.
   */
  constructor(args = {}) {
    super({
      ...args,
      url: args.url ?? DEFAULT_URL,
      deserialize: args.deserialize ?? deserializeFrontendModelTransportValue
    })
  }
}
