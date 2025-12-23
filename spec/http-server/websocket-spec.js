// @ts-check

import crypto from "crypto"
import net from "net"
import {describe, expect, it} from "../../src/testing/test.js"

import Dummy from "../dummy/index.js"

class WsTestClient {
  /**
   * @param {net.Socket} socket
   * @param {Buffer} initialBuffer
   */
  constructor(socket, initialBuffer = Buffer.alloc(0)) {
    this.buffer = initialBuffer
    this.dataWaiters = []
    this.socket = socket
    this.socket.on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, data])

      const waiters = this.dataWaiters

      this.dataWaiters = []

      for (const waiter of waiters) waiter()
    })
  }

  /**
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve())
      this.socket.end()
    })
  }

  /**
   * @param {string} jsonString
   * @returns {void}
   */
  sendJson(jsonString) {
    const payload = Buffer.from(jsonString)
    const mask = crypto.randomBytes(4)
    let header

    if (payload.length < 126) {
      header = Buffer.alloc(2)
      header[1] = 0x80 | payload.length
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4)
      header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }

    header[0] = 0x81

    const maskedPayload = Buffer.alloc(payload.length)

    for (let i = 0; i < payload.length; i++) {
      maskedPayload[i] = payload[i] ^ mask[i % 4]
    }

    this.socket.write(Buffer.concat([header, mask, maskedPayload]))
  }

  /**
   * @param {number} timeoutMs
   * @returns {Promise<any>}
   */
  async waitForMessage(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs

    while (true) {
      const frame = this._decodeServerFrame()

      if (frame) {
        const payload = frame.payload.toString("utf-8")

        return JSON.parse(payload)
      }

      const remaining = deadline - Date.now()

      if (remaining <= 0) {
        throw new Error("Timed out waiting for websocket message")
      }

      await new Promise((resolve, reject) => {
        const waiter = () => {
          clearTimeout(timer)
          resolve(null)
        }
        const timer = setTimeout(() => {
          this._removeWaiter(waiter)
          reject(new Error("Timed out waiting for websocket data"))
        }, remaining)

        this.dataWaiters.push(waiter)
      })
    }
  }

  _decodeServerFrame() {
    if (this.buffer.length < 2) return

    const firstByte = this.buffer[0]
    const secondByte = this.buffer[1]
    const opcode = firstByte & 0x0f
    let payloadLength = secondByte & 0x7f
    let offset = 2

    if (payloadLength === 126) {
      if (this.buffer.length < offset + 2) return
      payloadLength = this.buffer.readUInt16BE(offset)
      offset += 2
    } else if (payloadLength === 127) {
      if (this.buffer.length < offset + 8) return
      payloadLength = Number(this.buffer.readBigUInt64BE(offset))
      offset += 8
    }

    const requiredLength = offset + payloadLength

    if (this.buffer.length < requiredLength) return

    const payload = this.buffer.slice(offset, requiredLength)

    this.buffer = this.buffer.slice(requiredLength)

    if (opcode === 0x8) return // Close frame

    return {opcode, payload}
  }

  /**
   * @param {() => void} waiter
   * @returns {void}
   */
  _removeWaiter(waiter) {
    this.dataWaiters = this.dataWaiters.filter((entry) => entry !== waiter)
  }

  /**
   * @returns {Promise<WsTestClient>}
   */
  static async connect() {
    const key = crypto.randomBytes(16).toString("base64")
    const headers = [
      "GET /websocket HTTP/1.1",
      "Host: localhost:3006",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n")

    return await new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0)
      const socket = net.createConnection({host: "127.0.0.1", port: 3006}, () => {
        socket.write(headers)
      })

      socket.on("data", (data) => {
        buffer = Buffer.concat([buffer, data])
        const bufferString = buffer.toString("utf-8")
        const separatorIndex = bufferString.indexOf("\r\n\r\n")

        if (separatorIndex === -1) return

        const responseHeaders = bufferString.slice(0, separatorIndex)

        if (!responseHeaders.includes("101 Switching Protocols")) {
          reject(new Error(`Websocket upgrade failed: ${responseHeaders}`))
          return
        }

        const remaining = buffer.slice(separatorIndex + 4)
        const client = new WsTestClient(socket, remaining)

        resolve(client)
      })

      socket.on("error", reject)
    })
  }
}

describe("HttpServer - websocket", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("delegates websocket requests through controllers", async () => {
    await Dummy.run(async () => {
      const client = await WsTestClient.connect()

      try {
        client.sendJson(JSON.stringify({
          id: "req-1",
          method: "POST",
          path: "/api/version",
          type: "request"
        }))

        const responseMessage = await client.waitForMessage()
        const parsedBody = JSON.parse(responseMessage.body)

        expect(responseMessage.type).toEqual("response")
        expect(responseMessage.id).toEqual("req-1")
        expect(parsedBody.version).toEqual("2.1")
      } finally {
        await client.close()
      }
    })
  })

  it("broadcasts published events to websocket subscribers", async () => {
    await Dummy.run(async () => {
      const client = await WsTestClient.connect()

      try {
        client.sendJson(JSON.stringify({channel: "news", type: "subscribe"}))
        const subscribedMessage = await client.waitForMessage()

        expect(subscribedMessage.type).toEqual("subscribed")
        expect(subscribedMessage.channel).toEqual("news")

        client.sendJson(JSON.stringify({
          body: {channel: "news", payload: {headline: "breaking"}},
          id: "req-2",
          method: "POST",
          path: "/api/broadcast-event",
          type: "request"
        }))

        const messages = [await client.waitForMessage(), await client.waitForMessage()]
        const response = messages.find((msg) => msg.type === "response")
        const event = messages.find((msg) => msg.type === "event")

        expect(response?.id).toEqual("req-2")
        expect(event?.channel).toEqual("news")
        expect(event?.payload.headline).toEqual("breaking")
      } finally {
        await client.close()
      }
    })
  })
})
