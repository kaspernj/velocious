// @ts-check

import EventEmitter from "../../src/utils/event-emitter.js"
import HttpServer from "../../src/http-server/index.js"
import WorkerHandler from "../../src/http-server/worker-handler/index.js"
import WorkerThreadHandler from "../../src/http-server/worker-handler/worker-thread.js"
import {describe, expect, it} from "../../src/testing/test.js"

class RoutingSocket extends EventEmitter {
  destroyed = false
  remoteAddress = "127.0.0.1"
  writable = true
  writableEnded = false

  /** @returns {void} */
  destroy() {
    this.destroyed = true
    this.emit("close")
  }

  /** @returns {void} */
  end() {
    this.destroy()
  }
}

class RecordingWorkerHandler {
  /** @param {number} workerCount */
  constructor(workerCount) {
    this.workerCount = workerCount
    /** @type {number[]} */
    this.clientCounts = []
  }

  /** @param {import("../../src/http-server/server-client.js").default} client */
  addSocketConnection(client) {
    this.clientCounts.push(client.clientCount)
    client.setWorker(/** @type {import("worker_threads").Worker} */ (/** @type {unknown} */ ({postMessage: () => {}})))
    client.listen()
  }

  /** @returns {Promise<void>} */
  async stop() {}
}

/** @returns {HttpServer} */
function buildServer(args = {}) {
  return new HttpServer({
    availableParallelism: () => 4,
    configuration: {
      debug: false,
      getEnvironment: () => "test",
      getLocalDebugSnapshot: () => ({database: {initializedPools: []}}),
      getWebsocketOutboundQueueLimits: () => ({maxBytes: 1024, maxFrames: 16}),
      logging: {console: false, file: false}
    },
    ...args
  })
}

describe("HTTP server worker routing", () => {
  it("defaults threaded servers to the process-available CPU count and preserves explicit overrides", () => {
    expect(buildServer().workers).toEqual(4)
    expect(buildServer({workers: 2}).workers).toEqual(2)
    expect(buildServer({maxWorkers: 3}).workers).toEqual(3)
  })

  it("keeps the default in-process test server to one effective handler", async () => {
    const server = buildServer({inProcess: true})

    await server._ensureWorkers()

    try {
      const snapshot = await server.getDebugSnapshot()

      expect(snapshot.configuredWorkerCount).toEqual(4)
      expect(snapshot.effectiveWorkerCount).toEqual(1)
      expect(server.workerHandlers).toHaveLength(1)
    } finally {
      await server.stop()
    }
  })

  it("distributes ordinary HTTP sockets sharing one proxy address", () => {
    const server = buildServer({workers: 2})
    const firstWorker = new RecordingWorkerHandler(0)
    const secondWorker = new RecordingWorkerHandler(1)

    server.workerHandlers = [firstWorker, secondWorker]

    const firstSocket = new RoutingSocket()
    const secondSocket = new RoutingSocket()

    server.onConnection(/** @type {import("net").Socket} */ (/** @type {unknown} */ (firstSocket)))
    server.onConnection(/** @type {import("net").Socket} */ (/** @type {unknown} */ (secondSocket)))
    firstSocket.emit("data", Buffer.from("GET /ping HTTP/1.1\r\nHost: localhost\r\n\r\n"))
    secondSocket.emit("data", Buffer.from("GET /ping HTTP/1.1\r\nHost: localhost\r\n\r\n"))

    expect(firstWorker.clientCounts).toEqual([0])
    expect(secondWorker.clientCounts).toEqual([1])
  })

  it("routes resumptions by bounded session ownership and cleans ownership lifecycle", async () => {
    const server = buildServer({workers: 2})
    const firstWorker = new RecordingWorkerHandler(0)
    const secondWorker = new RecordingWorkerHandler(1)

    server.workerHandlers = [firstWorker, secondWorker]
    server.claimWebsocketSession({sessionId: "session-a", workerHandler: firstWorker})
    server.claimWebsocketSession({sessionId: "session-b", workerHandler: secondWorker})

    const resumeA = Buffer.from("GET /websocket?velociousSessionId=session-a HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
    const resumeB = Buffer.from("GET /websocket?velociousSessionId=session-b HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")

    expect(server.workerHandlerForInitialRequest(resumeA)).toBe(firstWorker)
    expect(server.workerHandlerForInitialRequest(resumeB)).toBe(secondWorker)
    expect(server.websocketSessionOwners.size).toEqual(2)

    server.releaseWebsocketSession({sessionId: "session-a", workerHandler: firstWorker})
    expect(server.websocketSessionOwners.has("session-a")).toEqual(false)

    server.workerHandlers = [firstWorker]
    expect(server.workerHandlerForInitialRequest(resumeB)).toBe(firstWorker)
    expect(server.websocketSessionOwners.has("session-b")).toEqual(false)

    server.claimWebsocketSession({sessionId: "session-c", workerHandler: firstWorker})
    await server.stop()
    expect(server.websocketSessionOwners.size).toEqual(0)
  })

  it("forwards session ownership claims and releases across the worker boundary", () => {
    const postedMessages = []
    const workerThread = Object.create(WorkerThreadHandler.prototype)

    workerThread.clients = {}
    workerThread.configuration = {logging: {console: false, file: false}}
    workerThread.fileTransferCount = 0
    workerThread.fileTransfers = new Map()
    workerThread.parentPort = {postMessage: (message) => postedMessages.push(message)}
    workerThread.handleNewClient({clientCount: 7, remoteAddress: "127.0.0.1"})
    workerThread.clients[7].events.emit("websocketSessionOwned", {sessionId: "session-7"})
    workerThread.clients[7].events.emit("websocketSessionReleased", {sessionId: "session-7"})

    expect(postedMessages).toEqual([
      {command: "websocketSessionOwned", sessionId: "session-7"},
      {command: "websocketSessionReleased", sessionId: "session-7"}
    ])

    const ownershipEvents = []
    const handler = new WorkerHandler({
      configuration: /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ ({debug: false})),
      onWebsocketSessionOwned: ({sessionId}) => ownershipEvents.push(`owned:${sessionId}`),
      onWebsocketSessionReleased: ({sessionId}) => ownershipEvents.push(`released:${sessionId}`),
      workerCount: 3
    })

    handler.onWorkerMessage({command: "websocketSessionOwned", sessionId: "session-7"})
    handler.onWorkerMessage({command: "websocketSessionReleased", sessionId: "session-7"})

    expect(ownershipEvents).toEqual(["owned:session-7", "released:session-7"])
  })
})
