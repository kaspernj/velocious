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

    expect(consoleErrorWrites.length).toEqual(1)
    expect(consoleErrorWrites[0]).toContain("Error while running request: Error: Boom")
    expect(consoleErrorWrites[0]).toContain("Cleaned backtrace:")
    expect(consoleErrorWrites[0]).toContain("RootController.partnerSignIn")
    expect(consoleErrorWrites[0]).toContain("someHandler")
    expect(consoleErrorWrites[0].includes("node_modules")).toEqual(false)
    expect(consoleErrorWrites[0].includes("node:internal/process/")).toEqual(false)
  })

  it("keeps error type and code in request error summary", async () => {
    const originalConsoleError = console.error
    const consoleErrorWrites = []
    const error = new TypeError("Unknown encoding: utf16")

    error.stack = [
      "TypeError [ERR_UNKNOWN_ENCODING]: Unknown encoding: utf16",
      "    at decodePayload (/app/src/services/decoder.js:12:3)",
      "    at parseInput (/app/node_modules/some-lib/index.js:1:1)",
      "    at handleRequest (/app/src/routes/root.js:44:8)"
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

    expect(consoleErrorWrites.length).toEqual(1)
    expect(consoleErrorWrites[0]).toContain("Error while running request: TypeError [ERR_UNKNOWN_ENCODING]: Unknown encoding: utf16")
    expect(consoleErrorWrites[0]).toContain("Cleaned backtrace:")
    expect(consoleErrorWrites[0]).toContain("decodePayload")
    expect(consoleErrorWrites[0]).toContain("handleRequest")
    expect(consoleErrorWrites[0].includes("node_modules")).toEqual(false)
  })

  it("falls back to error summary when cleaned stack header is filtered out", async () => {
    const originalConsoleError = console.error
    const consoleErrorWrites = []
    const error = new Error("Cannot resolve /app/node_modules/demo")

    error.stack = [
      "Error: Cannot resolve /app/node_modules/demo",
      "    at resolveRequest (/app/src/services/resolver.js:10:2)",
      "    at runInNodeModule (/app/node_modules/demo/index.js:1:1)",
      "    at handleRequest (/app/src/routes/root.js:44:8)"
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

    expect(consoleErrorWrites.length).toEqual(1)
    expect(consoleErrorWrites[0]).toContain("Error while running request: Error: Cannot resolve /app/node_modules/demo")
    expect(consoleErrorWrites[0]).toContain("Cleaned backtrace:")
    expect(consoleErrorWrites[0]).toContain("resolveRequest")
    expect(consoleErrorWrites[0]).toContain("handleRequest")
    expect(consoleErrorWrites[0].includes("Error while running request: at ")).toEqual(false)
  })
})
