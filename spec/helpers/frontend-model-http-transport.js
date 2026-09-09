// @ts-check

import FrontendModelBase from "../../src/frontend-models/base.js"

/** @returns {void} - Restores the unconfigured frontend-model transport. */
export function resetFrontendModelTransport() {
  FrontendModelBase.configureTransport({
    timeZone: undefined,
    url: undefined,
    websocketClient: undefined
  })
}

/** @returns {void} - Uses the dummy server's Node HTTP endpoint. */
export function configureNodeTransport() {
  FrontendModelBase.configureTransport({
    url: "http://127.0.0.1:3006"
  })
}

/** @returns {void} - Uses the dummy server's Node HTTP endpoint with a request timezone. */
export function configureNodeTransportWithTimeZone() {
  FrontendModelBase.configureTransport({
    timeZone: () => "Europe/Berlin",
    url: "http://127.0.0.1:3006"
  })
}

/**
 * @param {import("../../src/http-client/websocket-client.js").default} websocketClient - Websocket client.
 * @returns {void} - Uses the shared websocket frontend-model transport.
 */
export function configureWebsocketSharedTransport(websocketClient) {
  FrontendModelBase.configureTransport({
    shared: true,
    websocketClient
  })
}
