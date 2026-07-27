// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import HttpServerClient from "../../src/http-server/client/index.js"
import WebsocketConnection from "../../src/http-server/websocket-connection.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import { describe, expect, it } from "../../src/testing/test.js"
import VelociousError from "../../src/velocious-error.js"
import {
  buildMaskedClientTextFrame,
  decodeServerCloseFrame,
  decodeServerTextFrame
} from "../helpers/websocket-frame.js"

/**
 * @typedef {object} ErrorEventPayload
 * @property {Record<string, ?>} context - Structured failure context.
 * @property {Error} error - Reported error.
 * @property {string} [errorType] - All-error classification.
 * @property {WebsocketRequest} [request] - Upgrade request.
 */

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
 * @param {WebsocketRequest} [args.upgradeRequest] - Upgrade request.
 * @returns {{closeFrames: Buffer[], jsonMessages: Record<string, ?>[], session: WebsocketSession}}
 */
function buildSession({configuration, messageHandler, messageHandlerPromise, upgradeRequest}) {
  const client = new HttpServerClient({
    clientCount: 1,
    configuration,
    remoteAddress: "127.0.0.1"
  })
  const closeFrames = []
  /** @type {Record<string, ?>[]} */
  const jsonMessages = []
  const session = new WebsocketSession({
    client,
    configuration,
    messageHandler,
    messageHandlerPromise,
    upgradeRequest
  })

  client.events.on("output", (output) => {
    if (!(output instanceof Buffer)) return

    if (output[0] === 0x88) {
      closeFrames.push(output)
    } else if (output[0] === 0x81) {
      const parsed = JSON.parse(decodeServerTextFrame(output))

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object in the server WebSocket text frame")
      }

      jsonMessages.push(/** @type {Record<string, ?>} */ (parsed))
    }
  })

  return {closeFrames, jsonMessages, session}
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

  it("reports an unexpected built-in dispatch failure once while draining the resolver queue and preserves FIFO", async () => {
    const configuration = buildConfiguration({
      maxPendingBytes: 1024 * 1024,
      maxPendingMessages: 8
    })
    const handlerResolver = deferred()
    const dispatchError = new Error("Queued built-in dispatch exploded")
    const upgradeRequest = new WebsocketRequest({
      method: "GET",
      path: "/websocket",
      remoteAddress: "127.0.0.1"
    })
    /** @type {ErrorEventPayload[]} */
    const frameworkErrors = []
    /** @type {ErrorEventPayload[]} */
    const allErrors = []
    let wrapperCalls = 0

    configuration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push(payload))
    configuration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))
    configuration.setWebsocketAroundRequest(async (_session, next) => {
      const call = wrapperCalls

      wrapperCalls += 1
      if (call === 0) throw dispatchError
      await next()
    })

    const {jsonMessages, session} = buildSession({
      configuration,
      messageHandlerPromise: handlerResolver.promise.then(() => ({})),
      upgradeRequest
    })
    const initialization = session.initializeChannel()

    session.onData(Buffer.concat([
      buildMaskedClientTextFrame(JSON.stringify({data: {sequence: 0}, type: "metadata"})),
      buildMaskedClientTextFrame(JSON.stringify({data: {sequence: 1}, type: "metadata"})),
      buildMaskedClientTextFrame(JSON.stringify({data: {sequence: 2}, type: "metadata"}))
    ]))
    handlerResolver.resolve()
    await initialization

    expect(jsonMessages).toEqual([{
      error: "Queued built-in dispatch exploded",
      type: "error"
    }])
    expect(wrapperCalls).toEqual(3)
    expect(session.getMetadata()).toEqual({sequence: 2})
    expect([frameworkErrors.length, allErrors.length]).toEqual([1, 1])
    expect(frameworkErrors[0].error).toEqual(dispatchError)
    expect(frameworkErrors[0].context).toMatchObject({stage: "websocket-message-dispatch"})
    expect(frameworkErrors[0].request).toEqual(upgradeRequest)
    expect(allErrors[0].error).toEqual(dispatchError)
    expect(allErrors[0].context).toMatchObject({stage: "websocket-message-dispatch"})
    expect(allErrors[0].errorType).toEqual("framework-error")
    expect(allErrors[0].request).toEqual(upgradeRequest)
  })

  it("does not report an explicit safe error while draining the resolver queue and preserves FIFO", async () => {
    const configuration = buildConfiguration({
      maxPendingBytes: 1024 * 1024,
      maxPendingMessages: 8
    })
    const handlerResolver = deferred()
    const safeError = VelociousError.safe("Queued client-flow rejection")
    /** @type {ErrorEventPayload[]} */
    const frameworkErrors = []
    /** @type {ErrorEventPayload[]} */
    const allErrors = []
    let wrapperCalls = 0

    configuration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push(payload))
    configuration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))
    configuration.setWebsocketAroundRequest(async (_session, next) => {
      const call = wrapperCalls

      wrapperCalls += 1
      if (call === 0) throw safeError
      await next()
    })

    const {jsonMessages, session} = buildSession({
      configuration,
      messageHandlerPromise: handlerResolver.promise.then(() => ({}))
    })
    const initialization = session.initializeChannel()

    session.onData(Buffer.concat([
      buildMaskedClientTextFrame(JSON.stringify({data: {sequence: 0}, type: "metadata"})),
      buildMaskedClientTextFrame(JSON.stringify({data: {sequence: 1}, type: "metadata"})),
      buildMaskedClientTextFrame(JSON.stringify({data: {sequence: 2}, type: "metadata"}))
    ]))
    handlerResolver.resolve()
    await initialization

    expect(jsonMessages).toEqual([{
      error: "Queued client-flow rejection",
      type: "error"
    }])
    expect(wrapperCalls).toEqual(3)
    expect(session.getMetadata()).toEqual({sequence: 2})
    expect(frameworkErrors).toEqual([])
    expect(allErrors).toEqual([])
  })

  it("reports raw message and error-handler failures separately while preserving recovery", async () => {
    const configuration = buildConfiguration({
      maxPendingBytes: 1024 * 1024,
      maxPendingMessages: 8
    })
    const handlerResolver = deferred()
    const messageError = new Error("Raw message handler exploded")
    const errorHandlerError = new Error("Raw error handler exploded")
    const upgradeRequest = new WebsocketRequest({
      method: "GET",
      path: "/websocket",
      remoteAddress: "127.0.0.1"
    })
    /** @type {ErrorEventPayload[]} */
    const frameworkErrors = []
    /** @type {ErrorEventPayload[]} */
    const allErrors = []
    /** @type {Error[]} */
    const handledErrors = []
    /** @type {number[]} */
    const received = []

    configuration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push(payload))
    configuration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))
    const {jsonMessages, session} = buildSession({
      configuration,
      messageHandlerPromise: handlerResolver.promise.then(() => ({
        onError: async ({error}) => {
          handledErrors.push(error)
          throw errorHandlerError
        },
        onMessage: async ({message}) => {
          const sequence = messageSequence(message)

          received.push(sequence)
          if (sequence === 0) throw messageError
        }
      })),
      upgradeRequest
    })
    const initialization = session.initializeChannel()

    session.onData(Buffer.concat([
      buildMaskedClientTextFrame(JSON.stringify({sequence: 0})),
      buildMaskedClientTextFrame(JSON.stringify({sequence: 1}))
    ]))
    handlerResolver.resolve()
    await initialization

    expect(jsonMessages).toEqual([{
      error: "Raw error handler exploded",
      type: "error"
    }])
    expect(received).toEqual([0, 1])
    expect(handledErrors.length).toEqual(1)
    expect(handledErrors[0]).toBe(messageError)
    expect({
      allErrors: allErrors.map((payload) => ({
        error: payload.error,
        errorType: payload.errorType,
        request: payload.request,
        stage: payload.context.stage
      })),
      frameworkErrors: frameworkErrors.map((payload) => ({
        error: payload.error,
        request: payload.request,
        stage: payload.context.stage
      }))
    }).toEqual({
      allErrors: [
        {
          error: messageError,
          errorType: "framework-error",
          request: upgradeRequest,
          stage: "websocket-message-handler"
        },
        {
          error: errorHandlerError,
          errorType: "framework-error",
          request: upgradeRequest,
          stage: "websocket-message-handler-error"
        }
      ],
      frameworkErrors: [
        {
          error: messageError,
          request: upgradeRequest,
          stage: "websocket-message-handler"
        },
        {
          error: errorHandlerError,
          request: upgradeRequest,
          stage: "websocket-message-handler-error"
        }
      ]
    })
    expect(frameworkErrors[0].error).toBe(messageError)
    expect(allErrors[0].error).toBe(messageError)
    expect(frameworkErrors[1].error).toBe(errorHandlerError)
    expect(allErrors[1].error).toBe(errorHandlerError)
    expect(frameworkErrors[0].request).toBe(upgradeRequest)
    expect(allErrors[0].request).toBe(upgradeRequest)
    expect(frameworkErrors[1].request).toBe(upgradeRequest)
    expect(allErrors[1].request).toBe(upgradeRequest)
  })

  it("reports an unexpected queued connection handler failure once and preserves its response and recovery", async () => {
    const configuration = buildConfiguration({
      maxPendingBytes: 1024 * 1024,
      maxPendingMessages: 8
    })
    const handlerResolver = deferred()
    const connectionError = new Error("Queued connection handler exploded")
    const upgradeRequest = new WebsocketRequest({
      method: "GET",
      path: "/websocket",
      remoteAddress: "127.0.0.1"
    })
    /** @type {ErrorEventPayload[]} */
    const frameworkErrors = []
    /** @type {ErrorEventPayload[]} */
    const allErrors = []
    /** @type {number[]} */
    const received = []

    class ReviewConnection extends WebsocketConnection {
      /**
       * @param {?} body - Decoded connection body.
       * @returns {void} - No return value.
       */
      onMessage(body) {
        const sequence = messageSequence(body)

        received.push(sequence)
        if (sequence === 0) throw connectionError
      }
    }

    configuration.registerWebsocketConnection("Review", ReviewConnection)
    configuration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push(payload))
    configuration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))
    const {jsonMessages, session} = buildSession({
      configuration,
      messageHandlerPromise: handlerResolver.promise.then(() => ({})),
      upgradeRequest
    })
    const initialization = session.initializeChannel()

    session.onData(Buffer.concat([
      buildMaskedClientTextFrame(JSON.stringify({
        connectionId: "review",
        connectionType: "Review",
        params: {},
        type: "connection-open"
      })),
      buildMaskedClientTextFrame(JSON.stringify({
        body: {sequence: 0},
        connectionId: "review",
        type: "connection-message"
      })),
      buildMaskedClientTextFrame(JSON.stringify({
        body: {sequence: 1},
        connectionId: "review",
        type: "connection-message"
      }))
    ]))
    handlerResolver.resolve()
    await initialization

    expect(jsonMessages).toEqual([
      {connectionId: "review", type: "connection-opened"},
      {
        connectionId: "review",
        message: "Queued connection handler exploded",
        type: "connection-error"
      }
    ])
    expect(received).toEqual([0, 1])
    expect([frameworkErrors.length, allErrors.length]).toEqual([1, 1])
    expect(frameworkErrors[0].error).toEqual(connectionError)
    expect(frameworkErrors[0].context).toMatchObject({stage: "websocket-connection-message"})
    expect(frameworkErrors[0].request).toEqual(upgradeRequest)
    expect(allErrors[0].error).toEqual(connectionError)
    expect(allErrors[0].context).toMatchObject({stage: "websocket-connection-message"})
    expect(allErrors[0].errorType).toEqual("framework-error")
    expect(allErrors[0].request).toEqual(upgradeRequest)
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
