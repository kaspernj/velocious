// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import EventEmitter from "../../src/utils/event-emitter.js"
import Request from "../../src/http-server/client/request.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {object} [args] - Options object.
 * @param {string | string[]} [args.trustedProxies] - Trusted proxy ranges.
 * @returns {Configuration} - Test configuration.
 */
function buildConfiguration({trustedProxies} = {}) {
  return new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    trustedProxies
  })
}

/**
 * @param {object} args - Options object.
 * @param {string} [args.forwardedFor] - X-Forwarded-For value.
 * @param {string} [args.socketRemoteAddress] - Socket peer address.
 * @param {string | string[]} [args.trustedProxies] - Trusted proxy ranges.
 * @returns {Promise<Request>} - Parsed HTTP request.
 */
async function buildRequest({forwardedFor, socketRemoteAddress = "42.0.0.4", trustedProxies}) {
  const configuration = buildConfiguration({trustedProxies})
  const request = new Request({
    client: /** @type {import("../../src/http-server/client/index.js").default} */ (/** @type {unknown} */ ({remoteAddress: socketRemoteAddress})),
    configuration
  })
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const requestLines = [
    "GET /websocket HTTP/1.1",
    "Host: example.com",
    "Origin: https://example.com"
  ]

  if (forwardedFor) requestLines.push(`X-Forwarded-For: ${forwardedFor}`)

  requestLines.push("", "")
  request.feed(Buffer.from(requestLines.join("\r\n"), "utf8"))
  await donePromise

  return request
}

describe("HttpServer - request remote address", () => {
  it("ignores forwarded headers when trusted proxies are not configured", async () => {
    const request = await buildRequest({forwardedFor: "78.46.21.37"})

    expect(request.remoteAddress()).toEqual("42.0.0.4")
  })

  it("uses the forwarded client IP when the socket peer is trusted", async () => {
    const request = await buildRequest({
      forwardedFor: "78.46.21.37",
      trustedProxies: ["42.0.0.4"]
    })

    expect(request.remoteAddress()).toEqual("78.46.21.37")
  })

  it("keeps the socket peer IP when the socket peer is not trusted", async () => {
    const request = await buildRequest({
      forwardedFor: "78.46.21.37",
      trustedProxies: ["10.0.0.1"]
    })

    expect(request.remoteAddress()).toEqual("42.0.0.4")
  })

  it("resolves the first untrusted address across multiple forwarded hops", async () => {
    const request = await buildRequest({
      forwardedFor: "78.46.21.37, 42.0.0.3",
      trustedProxies: ["42.0.0.3", "42.0.0.4"]
    })

    expect(request.remoteAddress()).toEqual("78.46.21.37")
  })

  it("matches trusted proxies against IPv4-mapped socket addresses", async () => {
    const request = await buildRequest({
      forwardedFor: "78.46.21.37",
      socketRemoteAddress: "::ffff:42.0.0.4",
      trustedProxies: ["42.0.0.4"]
    })

    expect(request.remoteAddress()).toEqual("78.46.21.37")
  })

  it("uses the resolved upgrade request remote address for websocket sessions", async () => {
    const upgradeRequest = await buildRequest({
      forwardedFor: "78.46.21.37",
      trustedProxies: ["42.0.0.4"]
    })
    const session = new WebsocketSession({
      client: /** @type {import("../../src/http-server/client/index.js").default} */ (/** @type {unknown} */ ({
        events: new EventEmitter(),
        remoteAddress: "42.0.0.4"
      })),
      configuration: buildConfiguration({trustedProxies: ["42.0.0.4"]}),
      upgradeRequest
    })

    expect(session.remoteAddress()).toEqual("78.46.21.37")
  })
})
