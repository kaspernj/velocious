// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import WorkerHandler from "../../src/http-server/worker-handler/index.js"

describe("TestRunner application", {type: "request"}, () => {
  it("uses worker-thread handler by default, not in-process", async ({application}) => {
    const httpServer = application.httpServer

    expect(httpServer.inProcess).toBe(false)

    const handler = httpServer.workerHandlers[0]

    expect(handler).toBeInstanceOf(WorkerHandler)
  })
})
