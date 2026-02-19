// @ts-check

import VelociousHttpServerClientRequestRunner from "../../src/http-server/client/request-runner.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("HttpServer - request runner", async () => {
  it("logs a cleaned backtrace when request processing fails", async () => {
    const originalConsoleError = console.error
    const consoleErrorWrites = []
    const error = new Error("Boom")

    error.stack = [
      "Error: Boom",
      "    at RootController.partnerSignIn (/app/src/routes/_root/controller.js:200:62)",
      "    at runInNodeModule (/app/node_modules/demo/index.js:10:5)",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
      "    at someHandler (/app/src/routes/_root/controller.js:220:11)"
    ].join("\n")

    try {
      console.error = (message) => {
        consoleErrorWrites.push(String(message))
      }

      const configuration = /** @type {any} */ ({
        getCors: () => async () => {
          throw error
        },
        getErrorEvents: () => ({
          emit: () => {}
        })
      })
      const request = /** @type {any} */ ({
        header: () => undefined,
        httpMethod: () => "GET"
      })
      const requestRunner = new VelociousHttpServerClientRequestRunner({configuration, request})

      await requestRunner.run()
    } finally {
      console.error = originalConsoleError
    }

    expect(consoleErrorWrites.length).toEqual(2)
    expect(consoleErrorWrites[0]).toContain("Error while running request: Boom")
    expect(consoleErrorWrites[1]).toContain("Cleaned backtrace:")
    expect(consoleErrorWrites[1]).toContain("RootController.partnerSignIn")
    expect(consoleErrorWrites[1]).toContain("someHandler")
    expect(consoleErrorWrites[1].includes("Error: Boom")).toEqual(false)
    expect(consoleErrorWrites[1].includes("node_modules")).toEqual(false)
    expect(consoleErrorWrites[1].includes("node:internal/process/")).toEqual(false)
  })
})
