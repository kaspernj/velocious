// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import InProcessHandler from "../../src/http-server/worker-handler/in-process.js"

describe("TestRunner application", {type: "request"}, () => {
  it("uses the in-process handler so request handlers share the test's connection and transaction", async ({application}) => {
    const httpServer = application.httpServer

    // The test runner runs request handlers in-process (not worker threads) so
    // they resolve DB work to the per-test shared connection, letting request
    // specs clean up with a transaction rollback instead of truncating tables.
    // (The 1.0.275-era in-process parity bugs that #494 reverted this for have
    // since been fixed.)
    expect(httpServer.inProcess).toBe(true)

    const handler = httpServer.workerHandlers[0]

    expect(handler).toBeInstanceOf(InProcessHandler)
  })
})
