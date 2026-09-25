// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Client from "../../src/http-server/client/index.js"
import Request from "../../src/http-server/client/request.js"
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

  it("uses a header-stage request policy before retaining a declared body", () => {
    const result = parseRequest(buildConfiguration({
      requestBodyPolicyResolver: ({httpMethod, path}) => {
        if (httpMethod === "POST" && path === "/bounded?source=policy") {
          return {maxRequestBodyBytes: 4, mode: "raw"}
        }
      }
    }), [
      "POST /bounded?source=policy HTTP/1.1",
      "Host: localhost",
      "Content-Length: 5",
      "Connection: close",
      "",
      ""
    ].join("\r\n"))

    expect(result.output).toContain("HTTP/1.1 413 Payload Too Large")
    expect(result.closed).toEqual(true)
  })

  it("uses a request policy for cumulative chunked admission", () => {
    const result = parseRequest(buildConfiguration({
      requestBodyPolicyResolver: ({path}) => path === "/bounded"
        ? {maxRequestBodyBytes: 4, mode: "raw"}
        : undefined
    }), [
      "POST /bounded HTTP/1.1",
      "Host: localhost",
      "Transfer-Encoding: chunked",
      "Connection: close",
      "",
      "3",
      "123",
      "2",
      ""
    ].join("\r\n"))

    expect(result.output).toContain("HTTP/1.1 413 Payload Too Large")
    expect(result.closed).toEqual(true)
  })

  it("rejects negative chunk sizes before retaining decoded body bytes", () => {
    const repeatedInvalidChunks = Array.from({length: 8}, () => "-ffffffff\r\nX\r\n").join("")
    const result = parseRequest(buildConfiguration({maxRequestBodyBytes: 4}), [
      "POST / HTTP/1.1",
      "Host: localhost",
      "Transfer-Encoding: chunked",
      "Connection: close",
      "",
      `${repeatedInvalidChunks}0\r\n\r\n`
    ].join("\r\n"))

    expect(result.output).toContain("HTTP/1.1 400 Bad Request")
    expect(result.closed).toEqual(true)
  })

  it("rejects partially parsed and signed chunk sizes", () => {
    for (const invalidChunkSize of ["1g", "+1", "0x1"]) {
      const result = parseRequest(buildConfiguration({maxRequestBodyBytes: 4}), [
        "POST / HTTP/1.1",
        "Host: localhost",
        "Transfer-Encoding: chunked",
        "Connection: close",
        "",
        invalidChunkSize,
        "X",
        "0",
        "",
        ""
      ].join("\r\n"))

      expect(result.output).toContain("HTTP/1.1 400 Bad Request")
      expect(result.closed).toEqual(true)
    }
  })

  it("releases retained raw body bytes when the request lifecycle is destroyed", async () => {
    const configuration = buildConfiguration({
      requestBodyPolicyResolver: () => ({maxRequestBodyBytes: 32, mode: "raw"})
    })
    const client = new Client({clientCount: 1, configuration})
    const request = new Request({client, configuration})
    const donePromise = new Promise((resolve) => request.getRequestParser().events.on("done", resolve))
    const body = Buffer.from([0x00, 0xff, 0x61])
    const headers = Buffer.from([
      "POST /raw HTTP/1.1",
      "Host: localhost",
      "Content-Type: application/json",
      `Content-Length: ${body.byteLength}`,
      "",
      ""
    ].join("\r\n"), "latin1")

    request.feed(Buffer.concat([headers, body]))
    await donePromise

    expect(request.rawBody().toString("hex")).toEqual(body.toString("hex"))
    request.getRequestParser().destroy()
    await expect(() => request.rawBody()).toThrow(/Raw request body is unavailable after request cleanup/u)
  })

  it("releases the failed request after rejecting its declared body", () => {
    const configuration = buildConfiguration({
      requestBodyPolicyResolver: () => ({maxRequestBodyBytes: 4, mode: "raw"})
    })
    const client = new Client({clientCount: 1, configuration})

    client.onWrite(Buffer.from([
      "POST /raw HTTP/1.1",
      "Host: localhost",
      "Content-Length: 5",
      "",
      ""
    ].join("\r\n"), "latin1"))

    expect(client.currentRequest).toEqual(undefined)
    expect(client.requestRunners).toHaveLength(0)
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

  it("rejects an unframed multipart body while bytes accumulate", () => {
    const result = parseRequest(buildConfiguration({maxRequestBodyBytes: 4}), [
      "POST / HTTP/1.1",
      "Host: localhost",
      "Content-Type: multipart/form-data; boundary=demo",
      "Connection: close",
      "",
      "--demo"
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

    await expect(() => buildConfiguration({requestBodyPolicyResolver: /** @type {never} */ ("invalid")}))
      .toThrow(/httpServer\.requestBodyPolicyResolver must be a function/u)

    for (const invalidPolicy of [null, [], {mode: "decoded"}, {unknown: true}, {maxRequestBodyBytes: 0}]) {
      const configuration = buildConfiguration({requestBodyPolicyResolver: () => /** @type {never} */ (invalidPolicy)})

      await expect(() => configuration.resolveHttpRequestBodyPolicy({headers: {}, httpMethod: "POST", path: "/"}))
        .toThrow(/httpServer\.requestBodyPolicyResolver/u)
    }
  })
})
