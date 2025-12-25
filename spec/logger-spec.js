// @ts-check

import {Logger} from "../src/logger.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {describe, expect, it} from "../src/testing/test.js"
import Configuration from "../src/configuration.js"
import EnvironmentHandlerNode from "../src/environment-handlers/node.js"

describe("Logger", async () => {
  it("separates subject and message with a space", async () => {
    /** @type {string[]} */
    const writes = []
    const originalWrite = process.stdout.write
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-logger-"))

    try {
      // @ts-ignore Monkey-patch to capture logger output
      process.stdout.write = (chunk, encoding, callback) => {
        writes.push(chunk.toString())
        if (typeof callback === "function") callback()
        return true
      }

      const environmentHandler = new EnvironmentHandlerNode()
      const configuration = new Configuration({
        database: {test: {}},
        directory: tempDirectory,
        environment: "test",
        environmentHandler,
        initializeModels: async () => {},
        locale: "en",
        localeFallbacks: {en: ["en"]},
        locales: ["en"],
        logging: {console: true, file: false}
      })

      const logger = new Logger("PartnersEventsController", {configuration})

      await logger.log("Processing by PartnersEventsController#show")
    } finally {
      // @ts-ignore Restore original stdout
      process.stdout.write = originalWrite
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }

    expect(writes[0]).toBe("PartnersEventsController Processing by PartnersEventsController#show\n")
  })

  it("disables console logging by default in test environment but still writes to file", async () => {
    /** @type {string[]} */
    const writes = []
    const originalWrite = process.stdout.write
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-logger-"))

    try {
      // @ts-ignore Monkey-patch to capture logger output
      process.stdout.write = (chunk, encoding, callback) => {
        writes.push(chunk.toString())
        if (typeof callback === "function") callback()
        return true
      }

      const environmentHandler = new EnvironmentHandlerNode()
      const configuration = new Configuration({
        database: {test: {}},
        directory: tempDirectory,
        environment: "test",
        environmentHandler,
        initializeModels: async () => {},
        locale: "en",
        localeFallbacks: {en: ["en"]},
        locales: ["en"]
      })
      const logger = new Logger("PartnersEventsController", {configuration})

      await logger.log("Processing by PartnersEventsController#show")

      const logFilePath = path.join(tempDirectory, "log", "test.log")
      const logContents = await fs.readFile(logFilePath, "utf8")

      expect(writes.length).toBe(1)
      expect(logContents.trim()).toBe("PartnersEventsController Processing by PartnersEventsController#show")
    } finally {
      // @ts-ignore Restore original stdout
      process.stdout.write = originalWrite
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }
  })
})
