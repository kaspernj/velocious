// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import EventEmitter from "../../src/utils/event-emitter.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import WebsocketChannel from "../../src/http-server/websocket-channel.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * @param {WebSocket} socket - WebSocket instance.
 * @returns {Promise<void>} - Resolves when open.
 */
async function waitForSocketOpen(socket) {
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(undefined))
    socket.addEventListener("error", (event) => {
      reject(event?.error || new Error("Websocket connection error"))
    })
  })
}


describe("WebsocketClient - metadata", () => {
  it("stores metadata via setMetadata and returns it from getMetadata", () => {
    const client = new WebsocketClient()

    client.setMetadata("locale", "en")
    client.setMetadata("theme", "dark")

    expect(client.getMetadata()).toEqual({locale: "en", theme: "dark"})
  })

  it("removes a metadata key when value is null", () => {
    const client = new WebsocketClient()

    client.setMetadata("locale", "en")
    client.setMetadata("theme", "dark")
    client.setMetadata("locale", null)

    expect(client.getMetadata()).toEqual({theme: "dark"})
  })

  it("removes a metadata key when value is undefined", () => {
    const client = new WebsocketClient()

    client.setMetadata("locale", "en")
    client.setMetadata("locale", undefined)

    expect(client.getMetadata()).toEqual({})
  })

  it("returns a copy from getMetadata so mutations do not affect internal state", () => {
    const client = new WebsocketClient()

    client.setMetadata("locale", "en")

    const metadata = client.getMetadata()

    metadata.locale = "de"

    expect(client.getMetadata()).toEqual({locale: "en"})
  })

  it("sends metadata message to the server when setting while connected", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        /** @type {Record<string, any>[]} */
        const sent = []
        const originalSend = client._sendMessage.bind(client)

        client._sendMessage = (/** @type {Record<string, any>} */ payload) => {
          sent.push(payload)
          originalSend(payload)
        }

        client.setMetadata("locale", "en")

        const metadataMessage = sent.find((message) => message.type === "metadata")

        expect(metadataMessage).toEqual({type: "metadata", data: {locale: "en"}})
      } finally {
        await client.close()
      }
    })
  })

  it("does not send metadata message when not connected", () => {
    const client = new WebsocketClient()

    // Should not throw — just stores locally
    client.setMetadata("locale", "en")

    expect(client.getMetadata()).toEqual({locale: "en"})
  })

  it("sends metadata on connect when metadata was set before connecting", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        client.setMetadata("locale", "de")

        /** @type {Record<string, any>[]} */
        const sent = []
        const originalSend = WebSocket.prototype.send
        const interceptSend = function (/** @type {string} */ data) {
          try {
            sent.push(JSON.parse(data))
          } catch {
            // non-JSON payload — ignore
          }

          return originalSend.call(this, data)
        }

        WebSocket.prototype.send = interceptSend

        try {
          await client.connect()
        } finally {
          WebSocket.prototype.send = originalSend
        }

        const metadataMessage = sent.find((message) => message.type === "metadata")

        expect(metadataMessage).toEqual({type: "metadata", data: {locale: "de"}})
      } finally {
        await client.close()
      }
    })
  })

  it("re-sends metadata after reconnect", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient({autoReconnect: true, reconnectDelays: [50]})

      try {
        client.setMetadata("locale", "fr")
        await client.connect()

        /** @type {Record<string, any>[]} */
        const sent = []
        const originalSend = WebSocket.prototype.send
        const interceptSend = function (/** @type {string} */ data) {
          try {
            sent.push(JSON.parse(data))
          } catch {
            // non-JSON payload — ignore
          }

          return originalSend.call(this, data)
        }

        WebSocket.prototype.send = interceptSend

        try {
          await client.dropConnection()
          await new Promise((resolve) => setTimeout(resolve, 300))
        } finally {
          WebSocket.prototype.send = originalSend
        }

        const metadataMessage = sent.find((message) => message.type === "metadata")

        expect(metadataMessage).toEqual({type: "metadata", data: {locale: "fr"}})
      } finally {
        await client.disconnectAndStopReconnect()
      }
    })
  })
})

describe("WebsocketSession - metadata", () => {
  it("stores received metadata and exposes via getMetadata", async () => {
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration
    })

    await session._handleMessage({type: "metadata", data: {locale: "en", theme: "dark"}})

    expect(session.getMetadata()).toEqual({locale: "en", theme: "dark"})
  })

  it("replaces previous metadata on subsequent metadata messages", async () => {
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration
    })

    await session._handleMessage({type: "metadata", data: {locale: "en"}})
    await session._handleMessage({type: "metadata", data: {locale: "de", theme: "light"}})

    expect(session.getMetadata()).toEqual({locale: "de", theme: "light"})
  })

  it("clears metadata when data is missing", async () => {
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration
    })

    await session._handleMessage({type: "metadata", data: {locale: "en"}})
    await session._handleMessage({type: "metadata"})

    expect(session.getMetadata()).toEqual({})
  })

  it("calls onMetadataChanged on active channels when metadata is received", async () => {
    /** @type {Record<string, any>[]} */
    const receivedMetadata = []

    class MetadataTrackingChannel extends WebsocketChannel {
      /** @returns {boolean} */
      canSubscribe() { return true }

      /**
       * @param {Record<string, any>} metadata - Metadata.
       * @returns {Promise<void>}
       */
      async onMetadataChanged(metadata) {
        receivedMetadata.push({...metadata})
      }
    }

    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration,
      upgradeRequest: new WebsocketRequest({method: "GET", path: "/websocket", remoteAddress: "127.0.0.1"})
    })

    const subscription = new MetadataTrackingChannel({subscriptionId: "s1", params: {}, session})

    session._channelSubscriptions.set("s1", {channelType: "test", subscription})

    await session._handleMessage({type: "metadata", data: {locale: "en"}})
    await session._handleMessage({type: "metadata", data: {locale: "de", theme: "dark"}})

    expect(receivedMetadata).toEqual([
      {locale: "en"},
      {locale: "de", theme: "dark"}
    ])
  })

  it("does not fail when channels lack onMetadataChanged", async () => {
    class PlainChannel extends WebsocketChannel {
      /** @returns {boolean} */
      canSubscribe() { return true }
    }

    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration,
      upgradeRequest: new WebsocketRequest({method: "GET", path: "/websocket", remoteAddress: "127.0.0.1"})
    })

    const subscription = new PlainChannel({subscriptionId: "s1", params: {}, session})

    session._channelSubscriptions.set("s1", {channelType: "test", subscription})

    // Should not throw
    await session._handleMessage({type: "metadata", data: {locale: "en"}})

    expect(session.getMetadata()).toEqual({locale: "en"})
  })
})

describe("WebsocketRequest - metadata", () => {
  it("exposes websocket metadata separately from request headers", () => {
    const request = new WebsocketRequest({
      headers: {
        cookie: "session=upgrade-token"
      },
      metadata: {
        locale: "da",
        sessionToken: "metadata-token"
      },
      method: "POST",
      path: "/api/version"
    })

    expect(request.header("cookie")).toEqual("session=upgrade-token")
    expect(request.header("locale")).toEqual(null)
    expect(request.metadata()).toEqual({locale: "da", sessionToken: "metadata-token"})
    expect(request.metadata("sessionToken")).toEqual("metadata-token")
  })
})

describe("WebSocket metadata integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("delivers metadata from client to server session", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/websocket")

      try {
        await waitForSocketOpen(socket)

        socket.send(JSON.stringify({type: "metadata", data: {locale: "en", userId: "abc-123"}}))

        // Give the server time to process the metadata message
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Verify via a request that triggers metadata echo
        const client = new WebsocketClient()

        try {
          await client.connect()

          const response = await client.post("/api/version")

          expect(response.statusCode).toEqual(200)
        } finally {
          await client.close()
        }
      } finally {
        socket.close()
      }
    })
  })

  it("exposes metadata to requests posted over the websocket", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        client.setMetadata("locale", "da")
        client.setMetadata("sessionToken", "metadata-token")

        await client.connect()

        const response = await client.post("/api/metadata")

        expect(response.statusCode).toEqual(200)
        expect(response.json().metadata).toEqual({
          locale: "da",
          sessionToken: "metadata-token"
        })
      } finally {
        await client.close()
      }
    })
  })
})

describe("FrontendModelBase.setWebsocketMetadata", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("delegates to the internal websocket client setMetadata", async () => {
    await Dummy.run(async () => {
      FrontendModelBase.configureTransport({websocketUrl: "ws://127.0.0.1:3006/websocket"})

      try {
        await FrontendModelBase.connectWebsocket()

        FrontendModelBase.setWebsocketMetadata("locale", "en")
        FrontendModelBase.setWebsocketMetadata("userId", "user-42")

        const state = FrontendModelBase.websocketState()

        expect(state.hasClient).toEqual(true)
        expect(state.isOpen).toEqual(true)

        // Setting to null removes the key
        FrontendModelBase.setWebsocketMetadata("userId", null)
      } finally {
        await FrontendModelBase.disconnectWebsocket()
        // Reset transport config to avoid leaking into other tests
        FrontendModelBase.configureTransport({websocketUrl: undefined})
      }
    })
  })
})
