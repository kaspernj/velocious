// @ts-check

import {Logger, LoggerArrayOutput} from "../src/logger.js"
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

  it("writes all levels to console when debug is enabled", async () => {
    /** @type {string[]} */
    const stdoutWrites = []
    /** @type {string[]} */
    const stderrWrites = []
    const originalStdoutWrite = process.stdout.write
    const originalStderrWrite = process.stderr.write
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-logger-"))

    try {
      // @ts-ignore Monkey-patch to capture logger output
      process.stdout.write = (chunk, encoding, callback) => {
        stdoutWrites.push(chunk.toString())
        if (typeof callback === "function") callback()
        return true
      }
      // @ts-ignore Monkey-patch to capture logger output
      process.stderr.write = (chunk, encoding, callback) => {
        stderrWrites.push(chunk.toString())
        if (typeof callback === "function") callback()
        return true
      }

      const environmentHandler = new EnvironmentHandlerNode()
      const configuration = new Configuration({
        database: {test: {}},
        debug: true,
        directory: tempDirectory,
        environment: "test",
        environmentHandler,
        initializeModels: async () => {},
        locale: "en",
        localeFallbacks: {en: ["en"]},
        locales: ["en"],
        logging: {console: false, file: false, levels: ["error"]}
      })
      const logger = new Logger("PartnersEventsController", {configuration})

      await logger.debugLowLevel("Low level")
      await logger.debug("Debug")
      await logger.info("Info")
      await logger.warn("Warn")
      await logger.error("Error")
    } finally {
      // @ts-ignore Restore original stdout
      process.stdout.write = originalStdoutWrite
      // @ts-ignore Restore original stderr
      process.stderr.write = originalStderrWrite
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }

    expect(stdoutWrites).toEqual([
      "PartnersEventsController Low level\n",
      "PartnersEventsController Debug\n",
      "PartnersEventsController Info\n"
    ])
    expect(stderrWrites).toEqual([
      "PartnersEventsController Warn\n",
      "PartnersEventsController Error\n"
    ])
  })

  it("stores logs in an array output with a limit", async () => {
    const arrayOutput = new LoggerArrayOutput({limit: 2})

    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {
        outputs: [{output: arrayOutput}]
      }
    })

    const logger = new Logger("BugReporter", {configuration})

    await logger.info("First")
    await logger.warn("Second")
    await logger.error("Third")

    const logs = arrayOutput.getLogs()

    expect(logs.map((log) => log.message)).toEqual([
      "BugReporter Second",
      "BugReporter Third"
    ])
    expect(logs.map((log) => log.level)).toEqual(["warn", "error"])
  })

  it("respects output-specific levels", async () => {
    const arrayOutput = new LoggerArrayOutput()

    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {
        outputs: [{output: arrayOutput, levels: ["error"]}]
      }
    })

    const logger = new Logger("BugReporter", {configuration})

    await logger.info("Info")
    await logger.error("Error")

    const logs = arrayOutput.getLogs()

    expect(logs.map((log) => log.message)).toEqual(["BugReporter Error"])
    expect(logs.map((log) => log.level)).toEqual(["error"])
  })
})
