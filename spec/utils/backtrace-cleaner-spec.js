// @ts-check

import BacktraceCleaner from "../../src/utils/backtrace-cleaner.js"
import NodeBacktraceCleaner, {FRAMEWORK_SOURCE_DIRECTORY} from "../../src/utils/backtrace-cleaner-node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import fs from "node:fs/promises"
import path from "path"
import {fileURLToPath} from "url"

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

describe("BacktraceCleaner", () => {
  it("keeps the browser-safe shared cleaner free from raw import.meta syntax", async () => {
    const source = await fs.readFile(path.join(repositoryDirectory, "src/utils/backtrace-cleaner.js"), "utf8")

    expect(source).not.toContain("import.meta")
  })

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

  it("skips configured framework source frames before returning an application line", () => {
    const error = new Error("Query source")

    error.stack = [
      "Error: Query source",
      "    at VelociousDatabaseDriversBase.query (/app/vendor/velocious/src/database/drivers/base.js:700:10)",
      "    at CountryController.show (/app/src/routes/countries/controller.js:44:8)"
    ].join("\n")

    const sourceLine = BacktraceCleaner.getApplicationSourceLine(error, {
      applicationDirectory: "/app",
      frameworkSourceDirectory: "/app/vendor/velocious/src"
    })

    expect(sourceLine).toEqual("src/routes/countries/controller.js:44:in CountryController.show")
  })

  it("node wrapper skips Velocious source frames by default", () => {
    const error = new Error("Query source")

    if (!FRAMEWORK_SOURCE_DIRECTORY) throw new Error("Expected Node framework source directory")

    const applicationDirectory = path.resolve(FRAMEWORK_SOURCE_DIRECTORY, "..")

    error.stack = [
      "Error: Query source",
      `    at VelociousDatabaseDriversBase.query (${FRAMEWORK_SOURCE_DIRECTORY}database/drivers/base.js:700:10)`,
      `    at RootController.index (${applicationDirectory}/spec/dummy/src/routes/root/controller.js:44:8)`
    ].join("\n")

    const sourceLine = NodeBacktraceCleaner.getApplicationSourceLine(error, {
      applicationDirectory
    })

    expect(sourceLine).toEqual("spec/dummy/src/routes/root/controller.js:44:in RootController.index")
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
