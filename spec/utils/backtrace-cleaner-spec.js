// @ts-check

import BacktraceCleaner from "../../src/utils/backtrace-cleaner.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("BacktraceCleaner", () => {
  it("removes Node-style bracketed error headers from cleaned backtraces", () => {
    const error = new TypeError("Unknown encoding: utf16")

    error.stack = [
      "TypeError [ERR_UNKNOWN_ENCODING]: Unknown encoding: utf16",
      "    at decodePayload (/app/src/services/decoder.js:12:3)",
      "    at parseInput (/app/node_modules/some-lib/index.js:1:1)",
      "    at handleRequest (/app/src/routes/root.js:44:8)"
    ].join("\n")

    const cleanedBacktrace = BacktraceCleaner.getCleanedStack(error, {includeErrorHeader: false})

    expect(cleanedBacktrace?.includes("TypeError [ERR_UNKNOWN_ENCODING]")).toEqual(false)
    expect(cleanedBacktrace).toContain("decodePayload")
    expect(cleanedBacktrace).toContain("handleRequest")
    expect(cleanedBacktrace?.includes("node_modules")).toEqual(false)
  })

  it("returns the first application source line and skips dependencies", () => {
    const error = new Error("Query source")

    error.stack = [
      "Error: Query source",
      "    at VelociousDatabaseDriversBase.query (/app/node_modules/velocious/build/src/database/drivers/base.js:700:10)",
      "    at parseInput (/app/node_modules/some-lib/index.js:1:1)",
      "    at CountryController.show (/app/src/routes/countries/controller.js:44:8)"
    ].join("\n")

    const sourceLine = BacktraceCleaner.getApplicationSourceLine(error, {
      applicationDirectory: "/app"
    })

    expect(sourceLine).toEqual("src/routes/countries/controller.js:44:in CountryController.show")
  })

  it("does not return a source line when no application frame is available", () => {
    const error = new Error("Query source")

    error.stack = [
      "Error: Query source",
      "    at VelociousDatabaseDriversBase.query (/app/node_modules/velocious/build/src/database/drivers/base.js:700:10)",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)"
    ].join("\n")

    const sourceLine = BacktraceCleaner.getApplicationSourceLine(error, {
      applicationDirectory: "/app"
    })

    expect(sourceLine).toBeUndefined()
  })
})
