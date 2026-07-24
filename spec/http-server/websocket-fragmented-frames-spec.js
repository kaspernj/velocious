// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import HttpServerClient from "../../src/http-server/client/index.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * Builds a session around the real HTTP server client contract.
 * @param {import("../../src/configuration-types.js").WebsocketMessageHandler} [messageHandler] - Message observer.
 * @returns {{client: HttpServerClient, session: WebsocketSession}}
 */
function buildSession(messageHandler) {
  const client = new HttpServerClient({
    clientCount: 1,
    configuration: dummyConfiguration,
    remoteAddress: "127.0.0.1"
  })
  const session = new WebsocketSession({
    client,
    configuration: dummyConfiguration,
    messageHandler
  })

  return {client, session}
}

/**
 * Narrows a decoded message value at the raw handler boundary.
 * @param {?} value - Decoded message value.
 * @param {string} description - Expected value description.
 * @returns {Record<string, ?>}
 */
function expectRecord(value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${description} to be an object`)
  }

  return value
}

/**
 * Returns a required numeric property from a decoded message.
 * @param {Record<string, ?>} record - Message record.
 * @param {string} property - Property name.
 * @returns {number}
 */
function expectNumberProperty(record, property) {
  const value = record[property]

  if (typeof value !== "number") throw new Error(`Expected ${property} to be a number`)
  return value
}

/**
 * Returns a required string property from a decoded message.
 * @param {Record<string, ?>} record - Message record.
 * @param {string} property - Property name.
 * @returns {string}
 */
function expectStringProperty(record, property) {
  const value = record[property]

  if (typeof value !== "string") throw new Error(`Expected ${property} to be a string`)
  return value
}

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

describe("WebsocketSession fragmented frames", {databaseCleaning: {transaction: true}}, () => {
  it("buffers one large FIN frame in TCP-sized chunks with bounded copying", async () => {
    /** @type {number[]} */
    const dispatchedContentLengths = []
    const {session} = buildSession({
      onMessage: ({message}) => {
        const data = expectRecord(expectRecord(message, "message").data, "message data")

        dispatchedContentLengths.push(expectStringProperty(data, "contents").length)
      }
    })

    const body = JSON.stringify({
      type: "metadata",
      data: {contents: "x".repeat(2 * 1024 * 1024)}
    })
    const frame = buildClientFrame({
      fin: true,
      opcode: 0x1,
      payload: Buffer.from(body, "utf-8")
    })
    const tcpChunkSizes = [1, 256]
    let offset = 0
    let chunkIndex = 0

    while (offset < frame.length) {
      const end = Math.min(offset + tcpChunkSizes[chunkIndex % tcpChunkSizes.length], frame.length)

      session.onData(frame.subarray(offset, end))
      offset = end
      chunkIndex += 1
    }

    await new Promise((resolve) => setImmediate(resolve))

    expect(dispatchedContentLengths).toEqual([2 * 1024 * 1024])
    expect(session._bufferedFrameCopyBytes).toBeLessThanOrEqual(frame.length)
  })

  it("keeps incomplete payloads queued and processes following frames in order", async () => {
    /** @type {number[]} */
    const dispatchedSequences = []
    const {session} = buildSession({
      onMessage: ({message}) => {
        const data = expectRecord(expectRecord(message, "message").data, "message data")

        dispatchedSequences.push(expectNumberProperty(data, "sequence"))
      }
    })

    const firstFrame = buildClientFrame({
      fin: true,
      opcode: 0x1,
      payload: Buffer.from(JSON.stringify({type: "metadata", data: {sequence: 1}}))
    })
    const secondFrame = buildClientFrame({
      fin: true,
      opcode: 0x1,
      payload: Buffer.from(JSON.stringify({type: "metadata", data: {sequence: 2}}))
    })

    session.onData(firstFrame.subarray(0, 1))
    session.onData(firstFrame.subarray(1, firstFrame.length - 3))
    expect(dispatchedSequences.length).toBe(0)

    session.onData(Buffer.concat([firstFrame.subarray(firstFrame.length - 3), secondFrame]))
    await new Promise((resolve) => setImmediate(resolve))

    expect(dispatchedSequences).toEqual([1, 2])
  })

  it("closes as soon as a single FIN frame declares an oversized payload", () => {
    /** @type {Buffer[]} */
    const emittedFrames = []
    let closeEvents = 0
    const {client, session} = buildSession()
    const header = Buffer.alloc(14)

    client.events.on("output", (value) => {
      if (value instanceof Buffer) emittedFrames.push(value)
    })
    session.events.on("close", () => { closeEvents += 1 })
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(16 * 1024 * 1024 + 1), 2)
    header.writeUInt32BE(0x01020304, 10)
    session.onData(header.subarray(0, 6))
    expect(closeEvents).toBe(0)
    session.onData(header.subarray(6))

    expect(closeEvents).toBe(1)
    expect(emittedFrames.some((frame) => frame[0] === 0x88)).toBe(true)
  })

  it("rejects unsafe 64-bit control-frame lengths before Number conversion", () => {
    let closeEvents = 0
    const {session} = buildSession()
    const header = Buffer.alloc(14)

    session.events.on("close", () => { closeEvents += 1 })
    header[0] = 0x89
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 2)
    header.writeUInt32BE(0x01020304, 10)
    session.onData(header)

    expect(closeEvents).toBe(1)
    expect(session._bufferedBytes).toBe(0)
  })

  it("keeps queued chunk accounting exact across thousands of ordered frames", async () => {
    /** @type {number[]} */
    const dispatchedSequences = []
    const {session} = buildSession({
      onMessage: ({message}) => {
        const data = expectRecord(expectRecord(message, "message").data, "message data")

        dispatchedSequences.push(expectNumberProperty(data, "sequence"))
      }
    })
    const frames = Array.from({length: 2000}, (_, sequence) => buildClientFrame({
      fin: true,
      opcode: 0x1,
      payload: Buffer.from(JSON.stringify({type: "metadata", data: {sequence}}))
    }))
    const firstFrame = frames.shift()

    if (!firstFrame) throw new Error("Expected a first frame")

    session.onData(firstFrame.subarray(0, firstFrame.length - 1))
    session.onData(Buffer.concat([firstFrame.subarray(firstFrame.length - 1), ...frames]))
    await new Promise((resolve) => setImmediate(resolve))

    expect(dispatchedSequences).toEqual(Array.from({length: 2000}, (_, index) => index))
    expect(session._bufferedBytes).toBe(0)
    expect(session._bufferChunks.length).toBe(0)
    expect(session._bufferChunkIndex).toBe(0)
    expect(session._bufferChunkOffset).toBe(0)
  })

  it("reassembles a channel-subscribe split across continuation frames", async () => {
    /** @type {Array<{channelType: string, subscriptionId: string, authenticationTokenLength: number}>} */
    const dispatched = []
    const {session} = buildSession({
      onMessage: ({message}) => {
        const record = expectRecord(message, "message")
        const params = expectRecord(record.params, "message params")

        dispatched.push({
          authenticationTokenLength: expectStringProperty(params, "authenticationToken").length,
          channelType: expectStringProperty(record, "channelType"),
          subscriptionId: expectStringProperty(record, "subscriptionId")
        })
      }
    })

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

    await new Promise((resolve) => setImmediate(resolve))

    expect(dispatched).toEqual([{
      authenticationTokenLength: 4096,
      subscriptionId: "s1",
      channelType: "ticket-scans"
    }])
  })

  it("handles a PING interleaved between fragments without losing the data message", async () => {
    /** @type {string[]} */
    const dispatchedLocales = []
    /** @type {Buffer[]} */
    const emittedFrames = []
    const {client, session} = buildSession({
      onMessage: ({message}) => {
        const data = expectRecord(expectRecord(message, "message").data, "message data")

        dispatchedLocales.push(expectStringProperty(data, "locale"))
      }
    })

    client.events.on("output", (value) => {
      if (value instanceof Buffer) emittedFrames.push(value)
    })

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

    expect(emittedFrames.length).toBe(1)
    expect(emittedFrames[0].toString("hex")).toBe("8a0470696e67")
    expect(dispatchedLocales).toEqual(["en"])
  })

  it("closes the connection when a fragmented message exceeds the per-fragment count cap", async () => {
    /** @type {Buffer[]} */
    const emittedFrames = []
    let closeEvents = 0
    const {client, session} = buildSession({
      onMessage: () => { throw new Error("should not dispatch when caps are exceeded") }
    })

    client.events.on("output", (value) => {
      if (value instanceof Buffer) emittedFrames.push(value)
    })
    session.events.on("close", () => { closeEvents += 1 })

    const chunkBodies = Array.from({length: 3000}, () => Buffer.from("x"))
    const framesIn = []

    framesIn.push(buildClientFrame({fin: false, opcode: 0x1, payload: chunkBodies[0]}))
    for (let i = 1; i < chunkBodies.length; i++) {
      framesIn.push(buildClientFrame({fin: false, opcode: 0x0, payload: chunkBodies[i]}))
    }

    session.onData(Buffer.concat(framesIn))
    await new Promise((resolve) => setImmediate(resolve))

    expect(closeEvents).toBe(1)
    // Close frame emitted (opcode 0x8 with FIN=1).
    expect(emittedFrames.length).toBeGreaterThan(0)
    expect(emittedFrames.some((frame) => frame[0] === 0x88)).toBe(true)
    expect(session._fragmentedPayloads).toBe(null)
    expect(session._fragmentedBytes).toBe(0)
  })

  it("still processes a single-frame message after a fragmented message", async () => {
    /** @type {string[]} */
    const dispatchedTypes = []
    const {session} = buildSession({
      onMessage: ({message}) => {
        dispatchedTypes.push(expectStringProperty(expectRecord(message, "message"), "type"))
      }
    })

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

    expect(dispatchedTypes).toEqual(["channel-subscribe", "metadata"])
  })
})
