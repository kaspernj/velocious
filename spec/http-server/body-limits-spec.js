// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Client from "../../src/http-server/client/index.js"
import Response from "../../src/http-server/client/response.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {import("../../src/configuration-types.js").HttpServerConfiguration} httpServer - HTTP server configuration.
 * @returns {Configuration} - Minimal server configuration.
 */
function buildConfiguration(httpServer) {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    httpServer,
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: false, file: false}
  })
}

/**
 * @param {Configuration} configuration - Server configuration.
 * @param {string} request - Complete wire request.
 * @returns {{closed: boolean, output: string}} - Synchronous parser response.
 */
function parseRequest(configuration, request) {
  const client = new Client({clientCount: 1, configuration})
  const outputs = []
  let closed = false

  client.events.on("close", () => { closed = true })
  client.events.on("output", (output) => { outputs.push(Buffer.from(output).toString("utf8")) })
  client.onWrite(Buffer.from(request, "utf8"))

  return {closed, output: outputs.join("")}
}

describe("HTTP buffered body limits", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("rejects a declared request body larger than the configured limit", () => {
    const result = parseRequest(buildConfiguration({maxRequestBodyBytes: 4}), [
      "POST / HTTP/1.1",
      "Host: localhost",
      "Content-Length: 5",
      "Connection: close",
      "",
      "12345"
    ].join("\r\n"))

    expect(result.output).toContain("HTTP/1.1 413 Payload Too Large")
    expect(result.output).toContain("\r\nConnection: Close\r\n")
    expect(result.closed).toEqual(true)
  })

  it("rejects cumulative chunked request data larger than the configured limit", () => {
    const result = parseRequest(buildConfiguration({maxRequestBodyBytes: 4}), [
      "POST / HTTP/1.1",
      "Host: localhost",
      "Transfer-Encoding: chunked",
      "Connection: close",
      "",
      "3",
      "123",
      "2",
      "45",
      "0",
      "",
      ""
    ].join("\r\n"))

    expect(result.output).toContain("HTTP/1.1 413 Payload Too Large")
    expect(result.closed).toEqual(true)
  })

  it("rejects an oversized multipart request before buffering parts", () => {
    const result = parseRequest(buildConfiguration({maxRequestBodyBytes: 4}), [
      "POST / HTTP/1.1",
      "Host: localhost",
      "Content-Type: multipart/form-data; boundary=demo",
      "Content-Length: 10",
      "Connection: close",
      "",
      "0123456789"
    ].join("\r\n"))

    expect(result.output).toContain("HTTP/1.1 413 Payload Too Large")
    expect(result.closed).toEqual(true)
  })

  it("rejects an oversized buffered response by its UTF-8 byte length", async () => {
    const response = new Response({configuration: buildConfiguration({maxBufferedResponseBodyBytes: 3})})

    await expect(() => response.setBody("éé")).toThrow(/Buffered HTTP response body exceeds 3 bytes/u)
    expect(response.getBody()).toEqual("")
  })

  it("validates configured buffered body limits", async () => {
    for (const invalidValue of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
      await expect(() => buildConfiguration({maxRequestBodyBytes: invalidValue})).toThrow(/httpServer\.maxRequestBodyBytes must be a positive safe integer/u)
      await expect(() => buildConfiguration({maxBufferedResponseBodyBytes: invalidValue})).toThrow(/httpServer\.maxBufferedResponseBodyBytes must be a positive safe integer/u)
    }
  })
})
