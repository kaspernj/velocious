// @ts-check

import {waitFor} from "awaitery"
import EventEmitter from "../../src/utils/event-emitter.js"
import WorkerHandler from "../../src/http-server/worker-handler/index.js"
import HttpServer from "../../src/http-server/index.js"
import {describe, expect, it} from "../../src/testing/test.js"
import websocketEventsHost from "../../src/http-server/websocket-events-host.js"
import InProcessHandler from "../../src/http-server/worker-handler/in-process.js"
import ServerClient from "../../src/http-server/server-client.js"
import WorkerThreadHandler from "../../src/http-server/worker-handler/worker-thread.js"

class BlockedWriteSocket extends EventEmitter {
  remoteAddress = "127.0.0.1"
  destroyed = false
  writable = true
  writableEnded = false
  /** @type {Array<{callback: (error?: Error) => void, data: Buffer}>} */
  writes = []

  /**
   * @param {string | Uint8Array} data - Data payload.
   * @param {(error?: Error) => void} callback - Write completion callback.
   * @returns {boolean} - False while blocked.
   */
  write(data, callback) {
    this.writes.push({callback, data: Buffer.from(data)})
    return false
  }

  /** @returns {void} - No return value. */
  end() {
    this.destroy()
  }

  /** @returns {void} - No return value. */
  destroy() {
    if (this.destroyed) return

    this.destroyed = true
    this.writable = false
    this.writableEnded = true
    this.emit("close")
  }
}

class FakeWorkerHandler {
  /**
   * @param {object} args - Options object.
   * @param {Array<number>} [args.startedHandlers] - Worker ids recorded on start.
   * @param {Array<number>} [args.stoppedHandlers] - Worker ids recorded on stop.
   * @param {number} args.workerCount - Worker id.
   */
  constructor({startedHandlers = [], stoppedHandlers = [], workerCount}) {
    this.startedHandlers = startedHandlers
    this.stoppedHandlers = stoppedHandlers
    this.workerCount = workerCount
  }

  /** @returns {Promise<void>} - Resolves when started. */
  async start() {
    this.startedHandlers.push(this.workerCount)
  }

  /** @returns {Promise<void>} - Resolves when stopped. */
  async stop() {
    this.stoppedHandlers.push(this.workerCount)
  }
}

/** @returns {HttpServer} - Test HTTP server with the minimal worker-handler configuration. */
function buildWorkerHandlerTestServer() {
  return new HttpServer({
    configuration: {
      debug: false,
      getEnvironment: () => "test"
    }
  })
}

/**
 * Builds the worker-thread side without starting a real thread.
 * @returns {{errorEvents: EventEmitter, postedMessages: object[], workerThread: WorkerThreadHandler}} - Worker-thread test state.
 */
function buildWorkerThread() {
  const errorEvents = new EventEmitter()
  const postedMessages = []
  const workerThread = Object.create(WorkerThreadHandler.prototype)

  workerThread.clients = {}
  workerThread.configuration = {
    getErrorEvents: () => errorEvents,
    logging: {console: false, file: false}
  }
  workerThread.fileTransferCount = 0
  workerThread.fileTransfers = new Map()
  workerThread.parentPort = {postMessage: (message) => postedMessages.push(message)}

  return {errorEvents, postedMessages, workerThread}
}

/**
 * @param {{maxBytes?: number, maxFrames?: number}} [limits] - Queue limits.
 * @returns {object} - Minimal handler configuration.
 */
function buildHandlerConfiguration({maxBytes = 16 * 1024 * 1024, maxFrames = 256} = {}) {
  const errorEvents = new EventEmitter()

  return {
    debug: false,
    getErrorEvents: () => errorEvents,
    getWebsocketOutboundQueueLimits: () => ({maxBytes, maxFrames}),
    logging: {console: false, file: false}
  }
}

describe("HttpServer - worker handler", {databaseCleaning: {transaction: true}}, () => {
  it("tags only explicitly completed frames across the worker boundary", () => {
    const {postedMessages, workerThread} = buildWorkerThread()

    workerThread.handleNewClient({clientCount: 99, remoteAddress: "127.0.0.1"})
    workerThread.clients[99].events.emit("output", "HTTP/1.1 101 Switching Protocols\r\n\r\n")
    workerThread.clients[99].events.emit("output", Buffer.from([0x81, 0x00]), {websocketFrame: true})

    expect(postedMessages.map(({clientCount, command, websocketFrame}) => ({clientCount, command, websocketFrame}))).toEqual([
      {clientCount: 99, command: "clientOutput", websocketFrame: false},
      {clientCount: 99, command: "clientOutput", websocketFrame: true}
    ])
    expect(postedMessages[0].output).toEqual("HTTP/1.1 101 Switching Protocols\r\n\r\n")
    expect(Array.from(postedMessages[1].output)).toEqual([0x81, 0x00])
  })

  it("excludes the completed HTTP upgrade response from a one-frame WebSocket budget", async () => {
    const configuration = buildHandlerConfiguration({maxFrames: 1})
    const handler = new InProcessHandler({configuration, workerCount: 0})
    const socket = new BlockedWriteSocket()
    const serverClient = new ServerClient({clientCount: 100, configuration, socket})

    handler.addSocketConnection(serverClient)
    handler.clients[100].httpClient.websocketSession = /** @type {ReturnType<typeof JSON.parse>} */ ({})
    handler.clients[100].httpClient.events.emit("output", "HTTP/1.1 101 Switching Protocols\r\n\r\n")
    handler.clients[100].httpClient.events.emit("output", Buffer.from([0x81, 0x00]), {websocketFrame: true})

    await waitFor(() => expect(socket.writes.length).toEqual(1))
    expect(socket.writes[0].data.toString()).toEqual("HTTP/1.1 101 Switching Protocols\r\n\r\n")
    expect(socket.destroyed).toEqual(false)
    expect(handler.clients[100].deliveryQueue.snapshot().pendingFrames).toEqual(1)

    socket.writes[0].callback()
    await waitFor(() => expect(socket.writes.length).toEqual(2))
    socket.writes[1].callback()
    serverClient.destroy(new Error("Test teardown"))
    handler.unregisterFromEventsHost()
  })

  it("bounds in-process output retained behind a blocked socket write", async () => {
    const configuration = buildHandlerConfiguration({maxBytes: 6, maxFrames: 2})
    const reportedErrors = []
    const handler = new InProcessHandler({configuration, workerCount: 0})
    const socket = new BlockedWriteSocket()
    const serverClient = new ServerClient({clientCount: 101, configuration, socket})

    configuration.getErrorEvents().on("framework-error", ({error}) => reportedErrors.push(error))
    handler.addSocketConnection(serverClient)
    configuration.getErrorEvents().on("framework-error", () => {
      handler.clients[101]?.httpClient.events.emit("output", "recursive-report-output")
    })
    handler.clients[101].httpClient.events.emit("output", "abc", {websocketFrame: true})
    handler.clients[101].httpClient.events.emit("output", "def", {websocketFrame: true})

    await waitFor(() => expect(socket.writes.length).toEqual(1))
    expect(socket.destroyed).toEqual(false)

    handler.clients[101].httpClient.events.emit("output", "g", {websocketFrame: true})
    await waitFor(() => expect(socket.destroyed).toEqual(true))

    expect(reportedErrors.length).toEqual(1)
    expect(reportedErrors[0].name).toEqual("ClientDeliveryQueueOverflowError")
    expect(socket.writes.length).toEqual(1)
    await waitFor(() => expect(handler.clients[101]).toEqual(undefined))
    handler.unregisterFromEventsHost()
  })

  it("bounds worker output retained behind a blocked socket write", async () => {
    const configuration = buildHandlerConfiguration({maxBytes: 6, maxFrames: 2})
    const reportedErrors = []
    const handler = new WorkerHandler({configuration, workerCount: 1})
    const socket = new BlockedWriteSocket()
    const isolatedSocket = new BlockedWriteSocket()
    const client = new ServerClient({clientCount: 102, configuration, socket})
    const isolatedClient = new ServerClient({clientCount: 103, configuration, socket: isolatedSocket})

    configuration.getErrorEvents().on("framework-error", ({error}) => reportedErrors.push(error))
    handler.clients[102] = client
    handler.clients[103] = isolatedClient
    handler.onWorkerMessage({clientCount: 102, command: "clientOutput", output: "abc", websocketFrame: true})
    handler.onWorkerMessage({clientCount: 102, command: "clientOutput", output: "def", websocketFrame: true})
    handler.onWorkerMessage({clientCount: 103, command: "clientOutput", output: "safe", websocketFrame: true})

    await waitFor(() => expect(socket.writes.length).toEqual(1))
    await waitFor(() => expect(isolatedSocket.writes.length).toEqual(1))
    expect(socket.destroyed).toEqual(false)

    handler.onWorkerMessage({clientCount: 102, command: "clientOutput", output: "g", websocketFrame: true})
    await waitFor(() => expect(socket.destroyed).toEqual(true))

    expect(isolatedSocket.destroyed).toEqual(false)
    expect(reportedErrors.length).toEqual(1)
    expect(reportedErrors[0].name).toEqual("ClientDeliveryQueueOverflowError")
  })

  it("releases in-process frame accounting only after the blocked write callback", async () => {
    const configuration = buildHandlerConfiguration({maxBytes: 6, maxFrames: 2})
    const handler = new InProcessHandler({configuration, workerCount: 0})
    const socket = new BlockedWriteSocket()
    const serverClient = new ServerClient({clientCount: 104, configuration, socket})

    handler.addSocketConnection(serverClient)
    handler.clients[104].httpClient.events.emit("output", "abc", {websocketFrame: true})
    handler.clients[104].httpClient.events.emit("output", "def", {websocketFrame: true})

    await waitFor(() => expect(socket.writes.length).toEqual(1))
    expect(handler.clients[104].deliveryQueue.snapshot()).toEqual({pendingBytes: 6, pendingFrames: 2})

    socket.writes[0].callback()
    await waitFor(() => expect(socket.writes.length).toEqual(2))

    expect(handler.clients[104].deliveryQueue.snapshot()).toEqual({pendingBytes: 3, pendingFrames: 1})
    serverClient.destroy(new Error("Test teardown"))
    handler.unregisterFromEventsHost()
  })

  it("starts the configured worker handlers", async () => {
    const startedHandlers = []
    const stoppedHandlers = []

    const server = new HttpServer({
      configuration: {
        debug: false,
        getEnvironment: () => "test"
      },
      port: 0,
      workerHandlerFactory: ({workerCount}) => new FakeWorkerHandler({startedHandlers, stoppedHandlers, workerCount}),
      workers: 3
    })

    await server.start()

    expect(startedHandlers).toEqual([0, 1, 2])
    expect(server.workerHandlers.map((handler) => handler.workerCount)).toEqual([0, 1, 2])

    await server.stop()

    expect(stoppedHandlers).toEqual([0, 1, 2])
  })

  it("assigns connections across workers in round-robin order", () => {
    const server = buildWorkerHandlerTestServer()

    server.workerHandlers = [
      {workerCount: 0},
      {workerCount: 1},
      {workerCount: 2}
    ]

    expect(server.workerHandlerToUse().workerCount).toEqual(0)
    expect(server.workerHandlerToUse().workerCount).toEqual(1)
    expect(server.workerHandlerToUse().workerCount).toEqual(2)
    expect(server.workerHandlerToUse().workerCount).toEqual(0)
  })

  it("does not retain source-address stickiness between assignments", () => {
    const server = buildWorkerHandlerTestServer()

    server.workerHandlers = [
      {workerCount: 0},
      {workerCount: 1},
      {workerCount: 2}
    ]

    expect(server.workerHandlerToUse().workerCount).toEqual(0)
    expect(server.workerHandlerToUse().workerCount).toEqual(1)
    expect(server.workerHandlerToUse().workerCount).toEqual(2)
    expect(server.workerHandlerToUse().workerCount).toEqual(0)
  })

  it("closes client connections when the worker exits unexpectedly", () => {
    const configuration = {debug: false}
    const handler = new WorkerHandler({configuration, workerCount: 1})

    const closed = new Set()
    const destroyedQueues = new Set()
    handler.clients = {
      1: {end: () => { closed.add(1) }},
      2: {end: () => { closed.add(2) }}
    }
    handler._clientDeliveryQueues.set(1, {destroy: () => { destroyedQueues.add(1) }})
    handler._clientDeliveryQueues.set(2, {destroy: () => { destroyedQueues.add(2) }})

    handler.unregisterFromEventsHost = () => {}

    expect(() => handler.onWorkerExit(1)).toThrowError("Client worker stopped with exit code 1")
    expect(closed).toEqual(new Set([1, 2]))
    expect(destroyedQueues).toEqual(new Set([1, 2]))
    expect(handler._clientDeliveryQueues.size).toEqual(0)
    expect(Object.keys(handler.clients)).toEqual([])
  })

  it("stops cleanly when the worker has already exited", async () => {
    const configuration = {debug: false}
    const handler = new WorkerHandler({configuration, workerCount: 1})

    handler.worker = {}
    handler.unregisterFromEventsHost = () => {}

    handler.onWorkerExit(0)

    await handler.stop()
    expect(true).toBeTrue()
  })

  it("awaits in-process file cleanup before removing clients during shutdown", async () => {
    let releaseCleanup
    const cleanupReleased = new Promise((resolve) => {
      releaseCleanup = resolve
    })
    const shutdownEvents = []
    const handler = Object.create(InProcessHandler.prototype)

    handler.pendingClientCloseCleanups = new Set()
    handler.clients = {
      11: {
        httpClient: {
          abortPendingFileResponses: async () => {
            shutdownEvents.push("cleanup-started")
            await cleanupReleased
            shutdownEvents.push("cleanup-finished")
          }
        },
        serverClient: {
          clientCount: 11,
          end: async () => {
            shutdownEvents.push("client-ended")
          }
        }
      }
    }
    handler.unregisterFromEventsHost = () => {
      shutdownEvents.push("unregistered")
    }

    let stopSettled = false
    const stopping = handler.stop().then(() => {
      stopSettled = true
    })

    await waitFor(() => expect(shutdownEvents).toContain("cleanup-started"))
    expect(shutdownEvents).toContain("client-ended")
    expect(stopSettled).toEqual(false)
    expect(handler.clients[11]).not.toEqual(undefined)

    releaseCleanup()
    await stopping

    expect(shutdownEvents).toEqual(["cleanup-started", "client-ended", "cleanup-finished", "unregistered"])
    expect(handler.clients[11]).toEqual(undefined)
  })

  it("awaits close-triggered in-process file cleanup during normal shutdown order", async () => {
    let releaseCleanup
    const cleanupReleased = new Promise((resolve) => {
      releaseCleanup = resolve
    })
    const shutdownEvents = []
    const handler = new InProcessHandler({configuration: buildHandlerConfiguration(), workerCount: 0})
    const serverClientEvents = new EventEmitter()
    let socketClosed = false
    const serverClient = /** @type {import("../../src/http-server/server-client.js").default} */ (/** @type {ReturnType<typeof JSON.parse>} */ ({
      clientCount: 12,
      end: async () => {
        if (socketClosed) return

        socketClosed = true
        shutdownEvents.push("socket-closed")
        serverClientEvents.emit("close")
      },
      events: serverClientEvents,
      listen: () => {},
      remoteAddress: "127.0.0.1",
      send: async () => {},
      sendFile: async () => await new Promise(() => {}),
      setWorker: () => {}
    }))

    handler.addSocketConnection(serverClient)

    const transfer = handler.clients[12].httpClient.sendFileOutput("/tmp/shutdown-order.bin", true, async (result) => {
      shutdownEvents.push(`cleanup-${result}-started`)
      await cleanupReleased
      shutdownEvents.push(`cleanup-${result}-finished`)
    })

    await serverClient.end()
    await waitFor(() => expect(shutdownEvents).toContain("cleanup-aborted-started"))

    let stopSettled = false
    const stopping = handler.stop().then(() => {
      stopSettled = true
    })

    await new Promise((resolve) => setImmediate(resolve))
    const stopSettledBeforeCleanup = stopSettled

    releaseCleanup()
    await stopping
    await transfer

    expect(stopSettledBeforeCleanup).toEqual(false)
    expect(shutdownEvents).toEqual(["socket-closed", "cleanup-aborted-started", "cleanup-aborted-finished"])
    expect(handler.clients[12]).toEqual(undefined)
  })

  it("sends descriptor-only file messages and acknowledges completion once", async () => {
    const {postedMessages, workerThread} = buildWorkerThread()
    workerThread.handleNewClient({clientCount: 7, remoteAddress: "127.0.0.1"})

    const results = []
    const transfer = workerThread.clients[7].sendFileOutput("/tmp/example.bin", true, (result) => results.push(result))

    expect(postedMessages).toEqual([{
      clientCount: 7,
      command: "clientFile",
      filePath: "/tmp/example.bin",
      sendBody: true,
      transferId: 1
    }])
    expect("output" in postedMessages[0]).toEqual(false)

    await workerThread.handleClientFileResult({result: "completed", transferId: 1})
    await workerThread.handleClientFileResult({result: "aborted", transferId: 1})
    await transfer

    expect(results).toEqual(["completed"])

    const abortedTransfer = workerThread.clients[7].sendFileOutput("/tmp/aborted.bin", true, (result) => results.push(result))

    await workerThread.clients[7].abortPendingFileResponses()
    await workerThread.clients[7].abortPendingFileResponses()
    await abortedTransfer

    expect(results).toEqual(["completed", "aborted"])
  })

  it("propagates parent socket close and settles a waiting worker descriptor once as aborted", async () => {
    const {workerThread} = buildWorkerThread()
    const handler = new WorkerHandler({configuration: buildHandlerConfiguration(), workerCount: 1})
    const parentClientEvents = new EventEmitter()
    const parentClient = {
      clientCount: 8,
      events: parentClientEvents,
      listen: () => {},
      remoteAddress: "127.0.0.1",
      setWorker: () => {}
    }
    let abortHandling = Promise.resolve()

    workerThread.handleNewClient({clientCount: 8, remoteAddress: "127.0.0.1"})
    handler.worker = {
      postMessage: (message) => {
        if (message.command === "clientAbort") abortHandling = workerThread.handleClientAbort(message)
      }
    }
    handler.addSocketConnection(parentClient)
    handler._clientDeliveryQueues.set(8, {destroy: () => {}})

    const results = []
    const transfer = workerThread.clients[8].sendFileOutput("/tmp/waiting.bin", true, (result) => results.push(result))

    parentClientEvents.emit("close")
    parentClientEvents.emit("close")
    await abortHandling
    await transfer

    expect(results).toEqual(["aborted"])
    expect(handler.clients[8]).toEqual(undefined)
    expect(handler._clientDeliveryQueues.has(8)).toEqual(false)
    expect(workerThread.clients[8]).toEqual(undefined)
  })

  it("awaits async file cleanup once before settling the worker descriptor", async () => {
    const {workerThread} = buildWorkerThread()
    let releaseCleanup
    const cleanupReleased = new Promise((resolve) => {
      releaseCleanup = resolve
    })
    const results = []
    let transferSettled = false

    workerThread.handleNewClient({clientCount: 9, remoteAddress: "127.0.0.1"})
    const transfer = workerThread.clients[9].sendFileOutput("/tmp/async-cleanup.bin", true, async (result) => {
      results.push(result)
      await cleanupReleased
    })
    transfer.then(() => { transferSettled = true })

    const resultHandling = workerThread.handleClientFileResult({result: "completed", transferId: 1})

    await waitFor(() => expect(results).toEqual(["completed"]))
    expect(transferSettled).toEqual(false)

    releaseCleanup()
    await resultHandling
    await transfer
    await workerThread.handleClientFileResult({result: "aborted", transferId: 1})

    expect(transferSettled).toEqual(true)
    expect(results).toEqual(["completed"])
  })

  it("reports thrown and rejected file cleanup errors without rejecting committed responses", async () => {
    const {errorEvents, workerThread} = buildWorkerThread()
    const reportedErrors = []

    errorEvents.on("framework-error", ({error}) => reportedErrors.push(error.message))
    workerThread.handleNewClient({clientCount: 10, remoteAddress: "127.0.0.1"})

    const thrownTransfer = workerThread.clients[10].sendFileOutput("/tmp/thrown-cleanup.bin", true, () => {
      throw new Error("sync cleanup failed")
    })

    await workerThread.handleClientFileResult({result: "completed", transferId: 1})
    await thrownTransfer

    const rejectedTransfer = workerThread.clients[10].sendFileOutput("/tmp/rejected-cleanup.bin", true, async () => {
      throw new Error("async cleanup failed")
    })

    await workerThread.handleClientFileResult({result: "completed", transferId: 2})
    await rejectedTransfer

    expect(reportedErrors).toEqual(["sync cleanup failed", "async cleanup failed"])
  })

  it("acknowledges missing-client file descriptors as aborted", () => {
    const postedMessages = []
    const handler = new WorkerHandler({configuration: buildHandlerConfiguration(), workerCount: 1})

    handler.worker = {postMessage: (message) => postedMessages.push(message)}
    handler.onWorkerMessage({clientCount: 99, command: "clientFile", filePath: "/tmp/example.bin", sendBody: true, transferId: 4})

    expect(postedMessages).toEqual([{command: "clientFileResult", result: "aborted", transferId: 4}])
  })

  it("delivers file descriptors after earlier queued output", async () => {
    const deliveries = []
    const postedMessages = []
    let releaseOutput
    const outputDelivered = new Promise((resolve) => {
      releaseOutput = resolve
    })
    const handler = new WorkerHandler({configuration: buildHandlerConfiguration(), workerCount: 1})

    handler.worker = {postMessage: (message) => postedMessages.push(message)}
    handler.clients[3] = {
      clientCount: 3,
      send: async () => {
        deliveries.push("headers")
        await outputDelivered
      },
      sendFile: async () => {
        deliveries.push("file")
        return "completed"
      }
    }

    handler.onWorkerMessage({clientCount: 3, command: "clientOutput", output: "headers"})
    handler.onWorkerMessage({clientCount: 3, command: "clientFile", filePath: "/tmp/example.bin", sendBody: true, transferId: 5})

    await waitFor(() => expect(deliveries).toEqual(["headers"]))

    releaseOutput()
    await waitFor(() => expect(postedMessages.length).toEqual(1))

    expect(deliveries).toEqual(["headers", "file"])
    expect(postedMessages).toEqual([{command: "clientFileResult", result: "completed", transferId: 5}])
  })

  it("ignores websocket dispatch when the worker transport is missing", () => {
    const configuration = {debug: false}
    const handler = new WorkerHandler({configuration, workerCount: 1})

    handler.worker = {}
    handler.unregisterFromEventsHost = () => {}

    expect(() => handler.dispatchWebsocketEvent({channel: "frontend-models:Task", payload: {action: "update"}})).not.toThrow()
  })

  it("only receives websocket broadcasts after the worker has started", async () => {
    await websocketEventsHost.awaitPendingBroadcasts()

    const originalHandlers = new Set(websocketEventsHost.handlers)
    const sentMessages = []
    const handler = new WorkerHandler({
      configuration: {
        debug: false,
        withoutCurrentConnectionContexts: (callback) => callback()
      },
      workerCount: 1
    })

    websocketEventsHost.handlers.clear()
    handler.worker = {
      postMessage: (message) => {
        sentMessages.push(message)
      }
    }

    try {
      websocketEventsHost.broadcastV2({
        body: {action: "create", id: "1"},
        broadcastParams: {model: "Build"},
        channel: "frontend-models",
        configuration: handler.configuration
      })
      await websocketEventsHost.awaitPendingBroadcasts()

      expect(sentMessages).toEqual([])

      handler.onWorkerMessage({command: "started"})
      websocketEventsHost.broadcastV2({
        body: {action: "update", id: "1"},
        broadcastParams: {model: "Build"},
        channel: "frontend-models",
        configuration: handler.configuration
      })
      await websocketEventsHost.awaitPendingBroadcasts()

      expect(sentMessages).toEqual([{
        body: {action: "update", id: "1"},
        broadcastParams: {model: "Build"},
        channel: "frontend-models",
        command: "websocketV2Broadcast",
        createdAt: undefined,
        eventId: undefined
      }])

      handler.onWorkerExit(0)
      websocketEventsHost.broadcastV2({
        body: {action: "destroy", id: "1"},
        broadcastParams: {model: "Build"},
        channel: "frontend-models",
        configuration: handler.configuration
      })
      await websocketEventsHost.awaitPendingBroadcasts()

      expect(sentMessages.length).toEqual(1)
    } finally {
      handler.unregisterFromEventsHostIfNeeded()
      websocketEventsHost.handlers.clear()

      for (const originalHandler of originalHandlers) {
        websocketEventsHost.handlers.add(originalHandler)
      }
    }
  })

  it("routes worker-originated V2 broadcasts only to workers for the originating configuration", async () => {
    await websocketEventsHost.awaitPendingBroadcasts()

    const originalHandlers = new Set(websocketEventsHost.handlers)
    const configurationA = {
      debug: false,
      withoutCurrentConnectionContexts: (callback) => callback()
    }
    const configurationB = {
      debug: false,
      withoutCurrentConnectionContexts: (callback) => callback()
    }
    const handlers = [
      new WorkerHandler({configuration: configurationA, workerCount: 1}),
      new WorkerHandler({configuration: configurationA, workerCount: 2}),
      new WorkerHandler({configuration: configurationB, workerCount: 1})
    ]
    const sentMessages = handlers.map(() => [])

    websocketEventsHost.handlers.clear()

    try {
      handlers.forEach((handler, index) => {
        handler.workerStarted = true
        handler.worker = {postMessage: (message) => sentMessages[index].push(message)}
        handler.registerWithEventsHost()
      })

      handlers[0].onWorkerMessage({
        body: {configuration: "A"},
        broadcastParams: {subscription: "shared"},
        channel: "SharedChannel",
        command: "websocketV2Broadcast"
      })
      await websocketEventsHost.awaitPendingBroadcasts()

      expect(sentMessages.map((messages) => messages.map(({body}) => body))).toEqual([
        [{configuration: "A"}],
        [{configuration: "A"}],
        []
      ])

      handlers[2].onWorkerMessage({
        body: {configuration: "B"},
        broadcastParams: {subscription: "shared"},
        channel: "SharedChannel",
        command: "websocketV2Broadcast"
      })
      await websocketEventsHost.awaitPendingBroadcasts()

      expect(sentMessages.map((messages) => messages.map(({body}) => body))).toEqual([
        [{configuration: "A"}],
        [{configuration: "A"}],
        [{configuration: "B"}]
      ])
    } finally {
      handlers.forEach((handler) => handler.unregisterFromEventsHostIfNeeded())
      websocketEventsHost.handlers.clear()

      for (const originalHandler of originalHandlers) {
        websocketEventsHost.handlers.add(originalHandler)
      }
    }
  })

  it("recycles workers on development reload without restarting the process", async () => {
    const startedHandlers = []
    const stoppedHandlers = []

    const server = new HttpServer({
      availableParallelism: () => 1,
      configuration: {
        debug: false,
        getEnvironment: () => "development"
      },
      workerHandlerFactory: ({workerCount}) => new FakeWorkerHandler({startedHandlers, stoppedHandlers, workerCount})
    })

    server.inProcess = false
    server.workerCount = 0
    server.workerHandlers = [new FakeWorkerHandler({stoppedHandlers, workerCount: 0})]

    await server.reloadWorkersForDevelopment()

    expect(startedHandlers).toEqual([0])
    expect(stoppedHandlers).toEqual([0])
    expect(server.workerHandlers.map((handler) => handler.workerCount)).toEqual([0])
  })

  it("recycles every configured worker on development reload", async () => {
    const startedHandlers = []
    const stoppedHandlers = []

    const server = new HttpServer({
      configuration: {
        debug: false,
        getEnvironment: () => "development"
      },
      workerHandlerFactory: ({workerCount}) => new FakeWorkerHandler({startedHandlers, stoppedHandlers, workerCount}),
      workers: 2
    })

    server.inProcess = false
    server.workerCount = 2
    server.workerHandlers = [
      new FakeWorkerHandler({stoppedHandlers, workerCount: 0}),
      new FakeWorkerHandler({stoppedHandlers, workerCount: 1})
    ]

    await server.reloadWorkersForDevelopment()

    expect(startedHandlers).toEqual([2, 3])
    expect(stoppedHandlers).toEqual([0, 1])
    expect(server.workerHandlers.map((handler) => handler.workerCount)).toEqual([2, 3])
  })
})
