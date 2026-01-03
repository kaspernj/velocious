// @ts-check

import WorkerHandler from "../../src/http-server/worker-handler/index.js"
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
})
