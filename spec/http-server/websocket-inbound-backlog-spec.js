// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import HttpServerClient from "../../src/http-server/client/index.js"
import WebsocketConnection from "../../src/http-server/websocket-connection.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {
  buildMaskedClientTextFrame,
  decodeServerCloseFrame
} from "../helpers/websocket-frame.js"

/**
 * @returns {{promise: Promise<void>, resolve: () => void}} - Manually resolved promise.
 */
function deferred() {
  /** @type {() => void} */
  let resolve = () => {}
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve
  })

  return {promise, resolve}
}

/** @returns {Promise<void>} - Resolves on the next event-loop turn. */
function nextEventLoopTurn() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * @param {{maxPendingBytes: number, maxPendingMessages: number}} limits - Inbound queue limits.
 * @returns {Configuration} - Isolated test configuration.
 */
function buildConfiguration(limits) {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    httpServer: {websocketInboundQueue: limits},
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: false, file: false}
  })
}

/**
 * @param {object} args - Session options.
 * @param {Configuration} args.configuration - Session configuration.
 * @param {import("../../src/configuration-types.js").WebsocketMessageHandler} [args.messageHandler] - Raw handler.
 * @param {Promise<import("../../src/configuration-types.js").WebsocketMessageHandler | void>} [args.messageHandlerPromise] - Deferred raw handler.
 * @returns {{closeFrames: Buffer[], session: WebsocketSession}}
 */
function buildSession({configuration, messageHandler, messageHandlerPromise}) {
  const client = new HttpServerClient({
    clientCount: 1,
    configuration,
    remoteAddress: "127.0.0.1"
  })
  const closeFrames = []
  const session = new WebsocketSession({
    client,
    configuration,
    messageHandler,
    messageHandlerPromise
  })

  client.events.on("output", (output) => {
    if (output instanceof Buffer && output[0] === 0x88) closeFrames.push(output)
  })

  return {closeFrames, session}
}

/**
 * @param {?} message - Decoded WebSocket message.
 * @returns {number} - Required sequence value.
 */
function messageSequence(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("Expected a message object")
  }

  const sequence = message.sequence

  if (typeof sequence !== "number") throw new Error("Expected a numeric sequence")
  return sequence
}

/**
 * @param {number} sequence - Connection-message sequence.
 * @returns {Buffer} - Encoded connection-message frame.
 */
function connectionMessageFrame(sequence) {
  return buildMaskedClientTextFrame(JSON.stringify({
    body: {sequence},
    connectionId: "retained",
    type: "connection-message"
  }))
}

describe("WebsocketSession inbound message backlog", {databaseCleaning: {transaction: true}}, () => {
  it("accepts the count boundary then permanently closes before retaining the next of thousands of frames", async () => {
    const maxPendingMessages = 32
    const configuration = buildConfiguration({
      maxPendingBytes: 1024 * 1024,
      maxPendingMessages
    })
    const connectionReady = deferred()
    const firstStarted = deferred()
    const firstFinished = deferred()
    const releaseFirst = deferred()
    /** @type {number[]} */
    const received = []

    class DeferredConnection extends WebsocketConnection {
      /** @returns {void} - No return value. */
      onConnect() {
        connectionReady.resolve()
      }

      /**
       * @param {?} body - Decoded connection body.
       * @returns {Promise<void>} - Resolves after handling.
       */
      async onMessage(body) {
        const sequence = messageSequence(body)

        received.push(sequence)
        if (sequence === 0) {
          firstStarted.resolve()
          await releaseFirst.promise
          firstFinished.resolve()
        }
      }
    }

    configuration.registerWebsocketConnection("Deferred", DeferredConnection)
    const {closeFrames, session} = buildSession({configuration})
    let closeEvents = 0

    session.events.on("close", () => { closeEvents += 1 })
    session.onData(buildMaskedClientTextFrame(JSON.stringify({
      connectionId: "retained",
      connectionType: "Deferred",
      params: {},
      type: "connection-open"
    })))
    await connectionReady.promise
    session.onData(connectionMessageFrame(0))
    await firstStarted.promise

    const boundaryFrames = Array.from(
      {length: maxPendingMessages - 1},
      (_, offset) => connectionMessageFrame(offset + 1)
    )

    session.onData(Buffer.concat(boundaryFrames))
    expect(closeFrames.length).toEqual(0)
    expect(closeEvents).toEqual(0)

    const remainingFrames = Array.from(
      {length: 2000 - maxPendingMessages},
      (_, offset) => connectionMessageFrame(maxPendingMessages + offset)
    )

    session.onData(Buffer.concat(remainingFrames))
    expect(closeEvents).toEqual(1)
    expect(closeFrames.length).toEqual(1)
    expect(decodeServerCloseFrame(closeFrames[0])).toEqual({
      code: 1008,
      reason: "Inbound message backlog exceeded"
    })
    expect(session.isPaused()).toEqual(false)

    releaseFirst.resolve()
    await firstFinished.promise
    await nextEventLoopTurn()
    expect(received).toEqual([0])
  })

  it("accounts exact raw UTF-8 payload bytes at the boundary", async () => {
    const firstPayload = "{\"sequence\":0,\"label\":\"é\"}"
    const secondPayload = " \n { \"sequence\" : 1, \"label\" : \"☃\" } \t"
    const maxPendingBytes = Buffer.byteLength(firstPayload, "utf-8") +
      Buffer.byteLength(secondPayload, "utf-8")
    const configuration = buildConfiguration({
      maxPendingBytes,
      maxPendingMessages: 8
    })
    const firstStarted = deferred()
    const firstFinished = deferred()
    const releaseFirst = deferred()
    /** @type {number[]} */
    const received = []
    const {closeFrames, session} = buildSession({
      configuration,
      messageHandler: {
        onMessage: async ({message}) => {
          const sequence = messageSequence(message)

          received.push(sequence)
          if (sequence === 0) {
            firstStarted.resolve()
            await releaseFirst.promise
            firstFinished.resolve()
          }
        }
      }
    })

    session.onData(buildMaskedClientTextFrame(firstPayload))
    await firstStarted.promise
    session.onData(buildMaskedClientTextFrame(secondPayload))
    expect(closeFrames.length).toEqual(0)

    session.onData(buildMaskedClientTextFrame("{}"))
    expect(closeFrames.length).toEqual(1)
    expect(decodeServerCloseFrame(closeFrames[0])).toEqual({
      code: 1008,
      reason: "Inbound message backlog exceeded"
    })

    releaseFirst.resolve()
    await firstFinished.promise
    await nextEventLoopTurn()
    expect(received).toEqual([0])
  })

  it("releases invalid JSON and settled dispatch before admitting later messages", async () => {
    const configuration = buildConfiguration({
      maxPendingBytes: 1024,
      maxPendingMessages: 1
    })
    const firstReceived = deferred()
    const secondReceived = deferred()
    /** @type {number[]} */
    const received = []
    const {closeFrames, session} = buildSession({
      configuration,
      messageHandler: {
        onMessage: ({message}) => {
          const sequence = messageSequence(message)

          received.push(sequence)
          if (sequence === 0) firstReceived.resolve()
          if (sequence === 1) secondReceived.resolve()
        }
      }
    })

    session.onData(buildMaskedClientTextFrame("{invalid"))
    session.onData(buildMaskedClientTextFrame(JSON.stringify({sequence: 0})))
    await firstReceived.promise
    await nextEventLoopTurn()
    session.onData(buildMaskedClientTextFrame(JSON.stringify({sequence: 1})))
    await secondReceived.promise

    expect(closeFrames).toEqual([])
    expect(received).toEqual([0, 1])
  })

  it("bounds messages retained while the async message-handler resolver is pending", async () => {
    const configuration = buildConfiguration({
      maxPendingBytes: 1024 * 1024,
      maxPendingMessages: 16
    })
    const handlerResolver = deferred()
    /** @type {number[]} */
    const received = []
    const messageHandlerPromise = handlerResolver.promise.then(() => ({
      onMessage: ({message}) => {
        received.push(messageSequence(message))
      }
    }))
    const {closeFrames, session} = buildSession({
      configuration,
      messageHandlerPromise
    })
    const initialization = session.initializeChannel()
    const frames = Array.from(
      {length: 2000},
      (_, sequence) => buildMaskedClientTextFrame(JSON.stringify({sequence}))
    )

    session.onData(Buffer.concat(frames))
    handlerResolver.resolve()
    await initialization

    expect(closeFrames.length).toEqual(1)
    expect(decodeServerCloseFrame(closeFrames[0])).toEqual({
      code: 1008,
      reason: "Inbound message backlog exceeded"
    })
    expect(received).toEqual([])
  })

  it("keeps accepted messages FIFO and recovers after one dispatch rejects", async () => {
    const configuration = buildConfiguration({
      maxPendingBytes: 1024 * 1024,
      maxPendingMessages: 8
    })
    const firstStarted = deferred()
    const lastReceived = deferred()
    const rejectFirst = deferred()
    let wrapperCall = 0
    /** @type {number[]} */
    const received = []

    configuration.setWebsocketAroundRequest(async (_session, next) => {
      const call = wrapperCall

      wrapperCall += 1
      if (call === 0) {
        firstStarted.resolve()
        await rejectFirst.promise
        throw new Error("Expected first dispatch rejection")
      }

      await next()
    })

    const {session} = buildSession({
      configuration,
      messageHandler: {
        onMessage: ({message}) => {
          const sequence = messageSequence(message)

          received.push(sequence)
          if (sequence === 2) lastReceived.resolve()
        }
      }
    })

    session.onData(buildMaskedClientTextFrame(JSON.stringify({sequence: 0})))
    await firstStarted.promise
    session.onData(Buffer.concat([
      buildMaskedClientTextFrame(JSON.stringify({sequence: 1})),
      buildMaskedClientTextFrame(JSON.stringify({sequence: 2}))
    ]))
    expect(received).toEqual([])

    rejectFirst.resolve()
    await lastReceived.promise

    expect(received).toEqual([1, 2])
  })
})
