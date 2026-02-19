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
})
