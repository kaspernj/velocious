// @ts-check

import WorkerHandler from "../../src/http-server/worker-handler/index.js"
import HttpServer from "../../src/http-server/index.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("HttpServer - worker handler", () => {
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

  it("recycles workers on development reload without restarting the process", async () => {
    const startedHandlers = []
    const stoppedHandlers = []

    class FakeWorkerHandler {
      constructor({workerCount}) {
        this.workerCount = workerCount
      }

      async start() {
        startedHandlers.push(this.workerCount)
      }

      async stop() {
        stoppedHandlers.push(this.workerCount)
      }
    }

    const server = new HttpServer({
      configuration: {
        debug: false,
        getEnvironment: () => "development"
      }
    })

    server.inProcess = false
    server.workerCount = 0
    server.workerHandlers = [new FakeWorkerHandler({workerCount: 0})]
    server.workerHandlers[0].stop = async () => {
      stoppedHandlers.push(0)
    }

    server._buildWorkerHandler = async function () {
      const workerHandler = new FakeWorkerHandler({workerCount: this.workerCount})

      this.workerCount++
      await workerHandler.start()

      return workerHandler
    }

    await server.reloadWorkersForDevelopment()

    expect(startedHandlers).toEqual([0])
    expect(stoppedHandlers).toEqual([0])
    expect(server.workerHandlers.map((handler) => handler.workerCount)).toEqual([0])
  })
})
