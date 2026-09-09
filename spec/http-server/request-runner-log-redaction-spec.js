// @ts-check

import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"
import LoggerFileOutput from "../../src/logger/outputs/file-output.js"
import LoggerStdoutOutput from "../../src/logger/outputs/stdout-output.js"
import fs from "fs/promises"
import os from "node:os"
import path from "node:path"
import Request from "../../src/http-server/client/request.js"
import RequestRunner from "../../src/http-server/client/request-runner.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import { describe, expect, it } from "../../src/testing/test.js"

class RedactionErrorController extends Controller {
  async explode() {
    const error = new Error(`Synthetic request failure ${this.getParams().serviceToken}`)

    error.velociousContext = {
      safeContext: "visible-error-context",
      serviceToken: this.getParams().serviceToken
    }

    throw error
  }
}

class RedactionSuccessController extends Controller {
  async show() {}
}

/**
 * @param {LoggerArrayOutput} output - Captured logging output.
 * @returns {Configuration} - Request runner configuration.
 */
function buildConfiguration(output) {
  const configuration = new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {outputs: [{levels: ["debug", "error"], output}]}
  })

  configuration.setRoutes(dummyRoutes.routes)

  return configuration
}

describe("HTTP request runner log redaction", () => {
  it("redacts request diagnostics before lifecycle log formatting", async () => {
    const secret = "SYNTHETIC_RUNNER_SECRET_6993A903"
    const output = new LoggerArrayOutput()
    const configuration = buildConfiguration(output)
    const request = new WebsocketRequest({
      headers: {Authorization: `Bearer ${secret}`},
      method: "GET",
      params: {nested: [{sessionToken: secret}], safeField: "visible-runner-value"},
      path: `/ping?service-token=${secret}&safe=visible-runner-value`
    })
    const runner = new RequestRunner({configuration, request})

    await runner.run()

    const messages = output.getLogs().map((entry) => entry.message)
    const leakedValueCount = messages.filter((message) => message.includes(secret)).length

    expect(leakedValueCount).toEqual(0)
    expect(messages.filter((message) => message.includes("[REDACTED]")).length).toBeGreaterThan(0)
    expect(messages.filter((message) => message.includes("visible-runner-value")).length).toBeGreaterThan(0)
  })

  it("redacts request error logs and emitted structured error context", async () => {
    const secret = "SYNTHETIC_REQUEST_ERROR_SECRET_6993A903"
    const output = new LoggerArrayOutput()
    const configuration = buildConfiguration(output)
    /** @type {Array<{context: Record<string, ReturnType<typeof JSON.parse>>, error: Error}>} */
    const frameworkErrors = []

    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath !== "/redaction-error") return null

      return {
        action: "explode",
        controller: "redaction-error",
        controllerClass: RedactionErrorController,
        skipAbilityResolution: true,
        skipControllerConnections: true,
        skipTenantResolution: true
      }
    })
    configuration.getErrorEvents().on("framework-error", (payload) => {
      frameworkErrors.push(/** @type {{context: Record<string, ReturnType<typeof JSON.parse>>, error: Error}} */ (payload))
    })

    const request = new WebsocketRequest({method: "GET", params: {serviceToken: secret}, path: "/redaction-error"})
    const runner = new RequestRunner({configuration, request})

    await runner.run()

    const errorMessages = output.getLogs().filter((entry) => entry.level === "error").map((entry) => entry.message)
    const serializedContext = JSON.stringify(frameworkErrors[0].context)

    expect(errorMessages.filter((message) => message.includes(secret)).length).toEqual(0)
    expect(errorMessages[0]).toContain("Error")
    expect(errorMessages[0]).toContain("request-runner-log-redaction-spec.js")
    expect(serializedContext.includes(secret)).toEqual(false)
    expect(serializedContext).toContain("visible-error-context")
    expect(frameworkErrors[0].error.message.includes(secret)).toEqual(false)
  })

  it("sends identical redacted HTTP request content to console, file, and custom outputs", async () => {
    const secret = "SYNTHETIC_OUTPUT_SECRET_6993A903"
    const safeValue = "visible-output-value"
    const customOutput = new LoggerArrayOutput()
    const stdoutWrites = []
    const originalStdoutWrite = process.stdout.write
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-redaction-"))
    const logFilePath = path.join(tempDirectory, "request.log")
    let configuration
    const fileOutput = new LoggerFileOutput({filePath: logFilePath, getConfiguration: () => configuration})

    try {
      // @ts-ignore Capture the configured console output.
      process.stdout.write = (chunk, encoding, callback) => {
        stdoutWrites.push(chunk.toString().trimEnd())
        if (typeof callback === "function") callback()
        return true
      }

      configuration = new Configuration({
        database: {test: {}},
        directory: dummyDirectory(),
        environment: "test",
        environmentHandler: new EnvironmentHandlerNode(),
        initializeModels: async () => {},
        locale: "en",
        localeFallbacks: {en: ["en"]},
        locales: ["en"],
        logging: {
          outputs: [
            {levels: ["debug"], output: new LoggerStdoutOutput()},
            {levels: ["debug"], output: fileOutput},
            {levels: ["debug"], output: customOutput}
          ]
        }
      })
      configuration.setRoutes(dummyRoutes.routes)
      configuration.addRouteResolverHook(({currentPath}) => {
        if (currentPath !== "/redaction-http") return null

        return {
          action: "show",
          controller: "redaction-http",
          controllerClass: RedactionSuccessController,
          skipAbilityResolution: true,
          skipControllerConnections: true,
          skipTenantResolution: true
        }
      })

      const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration})
      const requestBody = JSON.stringify({nested: [{service_token: secret}], safeField: safeValue})
      const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

      request.feed(Buffer.from([
        `POST /redaction-http?api-key=${secret}&safe=${safeValue} HTTP/1.1`,
        "Host: example.com",
        `Authorization: Bearer ${secret}`,
        `Cookie: session_id=${secret}`,
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(requestBody)}`,
        "",
        requestBody
      ].join("\r\n"), "utf8"))
      await donePromise

      const runner = new RequestRunner({configuration, request})

      await runner.run()

      const customMessages = customOutput.getLogs().map((entry) => entry.message)
      const fileMessages = (await fs.readFile(logFilePath, "utf8")).trimEnd().split("\n")

      expect(stdoutWrites).toEqual(customMessages)
      expect(fileMessages).toEqual(customMessages)
      expect(customMessages.filter((message) => message.includes(secret)).length).toEqual(0)
      expect(customMessages.filter((message) => message.includes("[REDACTED]")).length).toBeGreaterThan(0)
      expect(customMessages.filter((message) => message.includes(safeValue)).length).toBeGreaterThan(0)
    } finally {
      // @ts-ignore Restore stdout after the configured console output check.
      process.stdout.write = originalStdoutWrite
      await fs.rm(tempDirectory, {force: true, recursive: true})
    }
  })
})
