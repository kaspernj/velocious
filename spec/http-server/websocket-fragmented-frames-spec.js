// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import EventEmitter from "../../src/utils/event-emitter.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * Builds a single client→server websocket frame with mandatory masking,
 * matching what a browser produces. Used to drive `_processBuffer` from
 * unit tests without going through a real socket.
 * @param {{fin: boolean, opcode: number, payload: Buffer}} params
 * @returns {Buffer}
 */
function buildClientFrame({fin, opcode, payload}) {
  const mask = Buffer.from([0x01, 0x02, 0x03, 0x04])
  const maskedPayload = Buffer.alloc(payload.length)

  for (let i = 0; i < payload.length; i++) {
    maskedPayload[i] = payload[i] ^ mask[i % 4]
  }

  const firstByte = (fin ? 0x80 : 0x00) | (opcode & 0x0F)
  /** @type {Buffer} */
  let header

  if (payload.length < 126) {
    header = Buffer.from([firstByte, 0x80 | payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = firstByte
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = firstByte
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }

  return Buffer.concat([header, mask, maskedPayload])
}

describe("WebsocketSession fragmented frames", () => {
  it("reassembles a channel-subscribe split across continuation frames", async () => {
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration
    })

    /** @type {any[]} */
    const dispatched = []

    session._handleMessage = async (message) => { dispatched.push(message) }

    const body = JSON.stringify({
      type: "channel-subscribe",
      subscriptionId: "s1",
      channelType: "ticket-scans",
      params: {authenticationToken: "x".repeat(4096), eventID: "event-1"}
    })
    const payload = Buffer.from(body, "utf-8")
    const mid = Math.floor(payload.length / 2)

    const firstFrame = buildClientFrame({
      fin: false,
      opcode: 0x1,
      payload: payload.slice(0, mid)
    })
    const continuationFrame = buildClientFrame({
      fin: true,
      opcode: 0x0,
      payload: payload.slice(mid)
    })

    session.onData(Buffer.concat([firstFrame, continuationFrame]))

    // Synchronous parse → _handleMessage() runs in the event loop.
    await new Promise((resolve) => setImmediate(resolve))

    expect(dispatched.length).toBe(1)
    expect(dispatched[0]).toMatchObject({
      type: "channel-subscribe",
      subscriptionId: "s1",
      channelType: "ticket-scans"
    })
    expect(dispatched[0].params.authenticationToken.length).toBe(4096)
  })

  it("handles a PING interleaved between fragments without losing the data message", async () => {
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration
    })

    /** @type {any[]} */
    const dispatched = []
    /** @type {Array<{opcode: number, payload: Buffer}>} */
    const sentControlFrames = []

    session._handleMessage = async (message) => { dispatched.push(message) }
    session._sendControlFrame = (opcode, payload) => {
      sentControlFrames.push({opcode, payload: Buffer.from(payload)})
    }

    const body = JSON.stringify({type: "metadata", data: {locale: "en"}})
    const payload = Buffer.from(body, "utf-8")
    const mid = Math.floor(payload.length / 2)

    const firstFrame = buildClientFrame({
      fin: false,
      opcode: 0x1,
      payload: payload.slice(0, mid)
    })
    const pingFrame = buildClientFrame({
      fin: true,
      opcode: 0x9,
      payload: Buffer.from("ping")
    })
    const continuationFrame = buildClientFrame({
      fin: true,
      opcode: 0x0,
      payload: payload.slice(mid)
    })

    session.onData(Buffer.concat([firstFrame, pingFrame, continuationFrame]))
    await new Promise((resolve) => setImmediate(resolve))

    expect(sentControlFrames.length).toBe(1)
    expect(sentControlFrames[0].opcode).toBe(0xA) // PONG
    expect(sentControlFrames[0].payload.toString("utf-8")).toBe("ping")

    expect(dispatched.length).toBe(1)
    expect(dispatched[0]).toMatchObject({type: "metadata", data: {locale: "en"}})
  })

  it("still processes a single-frame message after a fragmented message", async () => {
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration
    })

    /** @type {any[]} */
    const dispatched = []

    session._handleMessage = async (message) => { dispatched.push(message) }

    const firstBody = JSON.stringify({type: "channel-subscribe", subscriptionId: "s1", channelType: "c"})
    const firstPayload = Buffer.from(firstBody, "utf-8")
    const half = Math.floor(firstPayload.length / 2)

    const fragA = buildClientFrame({fin: false, opcode: 0x1, payload: firstPayload.slice(0, half)})
    const fragB = buildClientFrame({fin: true, opcode: 0x0, payload: firstPayload.slice(half)})

    const secondBody = JSON.stringify({type: "metadata", data: {theme: "dark"}})
    const secondFrame = buildClientFrame({
      fin: true,
      opcode: 0x1,
      payload: Buffer.from(secondBody, "utf-8")
    })

    session.onData(Buffer.concat([fragA, fragB, secondFrame]))
    await new Promise((resolve) => setImmediate(resolve))

    expect(dispatched.length).toBe(2)
    expect(dispatched[0]).toMatchObject({type: "channel-subscribe", subscriptionId: "s1"})
    expect(dispatched[1]).toMatchObject({type: "metadata", data: {theme: "dark"}})
  })
})
