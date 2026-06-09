// @ts-check

import WorkerHandler from "../../src/http-server/worker-handler/index.js"
import HttpServer from "../../src/http-server/index.js"
import {describe, expect, it} from "../../src/testing/test.js"
import websocketEventsHost from "../../src/http-server/websocket-events-host.js"

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

describe("HttpServer - worker handler", {databaseCleaning: {transaction: true}}, () => {
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

  it("keeps sticky connections on the same worker", () => {
    const server = buildWorkerHandlerTestServer()

    server.workerHandlers = [
      {workerCount: 0},
      {workerCount: 1},
      {workerCount: 2}
    ]

    expect(server.workerHandlerToUse({stickyKey: "client-a"}).workerCount).toEqual(0)
    expect(server.workerHandlerToUse({stickyKey: "client-b"}).workerCount).toEqual(1)
    expect(server.workerHandlerToUse({stickyKey: "client-a"}).workerCount).toEqual(0)
    expect(server.workerHandlerToUse().workerCount).toEqual(2)
  })

  it("drops stale sticky workers after replacement", () => {
    const server = buildWorkerHandlerTestServer()

    server.workerHandlers = [
      {workerCount: 0}
    ]

    expect(server.workerHandlerToUse({stickyKey: "client-a"}).workerCount).toEqual(0)

    server.workerHandlers = [
      {workerCount: 1}
    ]
    server.nextWorkerHandlerIndex = 0

    expect(server.workerHandlerToUse({stickyKey: "client-a"}).workerCount).toEqual(1)
  })

  it("closes client connections when the worker exits unexpectedly", () => {
    const configuration = {debug: false}
    const handler = new WorkerHandler({configuration, workerCount: 1})

    const closed = new Set()
    handler.clients = {
      1: {end: () => { closed.add(1) }},
      2: {end: () => { closed.add(2) }}
    }

    handler.unregisterFromEventsHost = () => {}

    expect(() => handler.onWorkerExit(1)).toThrowError("Client worker stopped with exit code 1")
    expect(closed).toEqual(new Set([1, 2]))
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
      websocketEventsHost.broadcastV2({body: {action: "create", id: "1"}, broadcastParams: {model: "Build"}, channel: "frontend-models"})
      await websocketEventsHost.awaitPendingBroadcasts()

      expect(sentMessages).toEqual([])

      handler.onWorkerMessage({command: "started"})
      websocketEventsHost.broadcastV2({body: {action: "update", id: "1"}, broadcastParams: {model: "Build"}, channel: "frontend-models"})
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
      websocketEventsHost.broadcastV2({body: {action: "destroy", id: "1"}, broadcastParams: {model: "Build"}, channel: "frontend-models"})
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

  it("recycles workers on development reload without restarting the process", async () => {
    const startedHandlers = []
    const stoppedHandlers = []

    const server = new HttpServer({
      configuration: {
        debug: false,
        getEnvironment: () => "development"
      }
    })

    server.inProcess = false
    server.workerCount = 0
    server.workerHandlers = [new FakeWorkerHandler({stoppedHandlers, workerCount: 0})]

    server._buildWorkerHandler = async function () {
      const workerHandler = new FakeWorkerHandler({startedHandlers, stoppedHandlers, workerCount: this.workerCount})

      this.workerCount++
      await workerHandler.start()

      return workerHandler
    }

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
