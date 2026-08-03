// @ts-check

import fs from "node:fs/promises"
import Client from "../../src/http-server/client/index.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {bodyBuffer, buildConfiguration, buildRequest, buildRequestRunner, buildResponse, deliverResponse, headerText, repositoryPackageJsonPath} from "../helpers/http-response-compression-test-helper.js"

const COMPRESSIBLE_BODY = "compressible-body-content ".repeat(128)

/**
 * Delivers a large compressible response with an accepting client and one mutated skip condition.
 * @param {object} [args] - Options object.
 * @param {string | Uint8Array} [args.body] - Buffered response body.
 * @param {string} [args.contentType] - Content-Type header value.
 * @param {Record<string, string>} [args.headers] - Additional response headers.
 * @param {Record<string, string>} [args.requestHeaders] - Additional request headers.
 * @param {number} [args.status] - HTTP status code.
 * @param {(response: import("../../src/http-server/client/response.js").default) => void} [args.prepareResponse] - Response mutator run before delivery.
 * @returns {Promise<{outputs: Array<string | Uint8Array>, response: import("../../src/http-server/client/response.js").default}>} - Captured output chunks and response.
 */
async function deliverSkipped({body = COMPRESSIBLE_BODY, contentType, headers = {}, prepareResponse, requestHeaders = {}, status} = {}) {
  const configuration = buildConfiguration({compression: true})
  const request = buildRequest({headers: {"Accept-Encoding": "br, gzip", ...requestHeaders}})
  const response = buildResponse({body, configuration, contentType, headers, status})

  if (prepareResponse) prepareResponse(response)

  const {outputs} = await deliverResponse({configuration, request, response})

  return {outputs, response}
}

describe("http server - response compression skip conditions", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("skips responses that already carry a Content-Encoding", async () => {
    const {outputs} = await deliverSkipped({headers: {"Content-Encoding": "custom"}})

    expect(headerText(outputs)).toContain("Content-Encoding: custom\r\n")
    expect(headerText(outputs)).not.toContain("Content-Encoding: br")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("passes application-supplied Content-Encoding responses through even when identity is forbidden", async () => {
    const {outputs} = await deliverSkipped({headers: {"Content-Encoding": "custom"}, requestHeaders: {"Accept-Encoding": "identity;q=0"}})

    expect(headerText(outputs)).toContain("HTTP/1.1 200 OK\r\n")
    expect(headerText(outputs)).toContain("Content-Encoding: custom\r\n")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("returns an empty 406 for a non-compressible content type when identity is forbidden", async () => {
    const {outputs} = await deliverSkipped({contentType: "application/octet-stream", requestHeaders: {"Accept-Encoding": "identity;q=0"}})

    expect(headerText(outputs)).toContain("HTTP/1.1 406 Not Acceptable\r\n")
    expect(headerText(outputs)).toContain("Content-Length: 0\r\n")
    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).length).toEqual(0)
  })

  it("returns an empty 406 for a missing Content-Type when identity is forbidden", async () => {
    const {outputs} = await deliverSkipped({contentType: "", requestHeaders: {"Accept-Encoding": "identity;q=0"}})

    expect(headerText(outputs)).toContain("HTTP/1.1 406 Not Acceptable\r\n")
    expect(headerText(outputs)).toContain("Content-Length: 0\r\n")
    expect(bodyBuffer(outputs).length).toEqual(0)
  })

  it("returns an empty 406 for a no-transform response when a coding is required", async () => {
    const {outputs} = await deliverSkipped({headers: {"Cache-Control": "public, no-transform"}, requestHeaders: {"Accept-Encoding": "br, identity;q=0"}})

    expect(headerText(outputs)).toContain("HTTP/1.1 406 Not Acceptable\r\n")
    expect(headerText(outputs)).toContain("Content-Length: 0\r\n")
    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).length).toEqual(0)
  })

  it("returns an empty 406 when a response opted out of compression but identity is forbidden", async () => {
    const {outputs} = await deliverSkipped({
      prepareResponse: (response) => {
        response.disableCompression()
      },
      requestHeaders: {"Accept-Encoding": "br, identity;q=0"}
    })

    expect(headerText(outputs)).toContain("HTTP/1.1 406 Not Acceptable\r\n")
    expect(headerText(outputs)).toContain("Content-Length: 0\r\n")
    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).length).toEqual(0)
  })

  it("skips responses with Cache-Control: no-transform", async () => {
    const {outputs} = await deliverSkipped({headers: {"Cache-Control": "public, no-transform"}})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("skips text/event-stream responses", async () => {
    const {outputs} = await deliverSkipped({contentType: "text/event-stream"})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("skips 206 partial responses", async () => {
    const {outputs} = await deliverSkipped({status: 206})

    expect(headerText(outputs)).toContain("HTTP/1.1 206 Partial Content\r\n")
    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("skips responses to requests with a Range header", async () => {
    const {outputs} = await deliverSkipped({requestHeaders: {"Range": "bytes=0-99"}})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("skips responses that carry a Content-Range header", async () => {
    const {outputs} = await deliverSkipped({headers: {"Content-Range": "bytes 0-99/2048"}})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("skips bodyless status responses", async () => {
    const {outputs} = await deliverSkipped({status: 304})
    const headers = headerText(outputs)

    expect(headers).toContain("HTTP/1.1 304 Not Modified\r\n")
    expect(headers).not.toContain("Content-Encoding")
    expect(headers).not.toContain("Content-Length")
    expect(bodyBuffer(outputs).length).toEqual(0)
  })

  it("skips responses that opted out with disableCompression()", async () => {
    const {outputs} = await deliverSkipped({
      prepareResponse: (response) => {
        response.disableCompression()
      }
    })

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("skips unknown binary content types", async () => {
    const {outputs} = await deliverSkipped({contentType: "application/octet-stream"})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("skips commonly pre-compressed media types", async () => {
    for (const contentType of ["image/png", "image/jpeg", "video/mp4", "application/zip", "application/gzip"]) {
      const {outputs} = await deliverSkipped({contentType})

      expect(headerText(outputs)).not.toContain("Content-Encoding")
      expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
    }
  })

  it("skips responses without a Content-Type header", async () => {
    const {outputs} = await deliverSkipped({contentType: ""})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(COMPRESSIBLE_BODY)
  })

  it("compresses JSON, +json, XML, +xml, JavaScript, and SVG content types", async () => {
    const compressibleTypes = [
      "text/plain; charset=UTF-8",
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/atom+xml",
      "application/javascript",
      "image/svg+xml"
    ]

    for (const contentType of compressibleTypes) {
      const configuration = buildConfiguration({compression: true})
      const request = buildRequest({headers: {"Accept-Encoding": "gzip"}})
      const response = buildResponse({body: COMPRESSIBLE_BODY, configuration, contentType})
      const {outputs} = await deliverResponse({configuration, request, response})

      expect(headerText(outputs)).toContain("Content-Encoding: gzip\r\n")
    }
  })

  it("skips sendFile responses", async () => {
    const configuration = buildConfiguration({compression: true})
    const filePath = repositoryPackageJsonPath()
    const stats = await fs.stat(filePath)
    const request = buildRequest({headers: {"Accept-Encoding": "br, gzip"}})
    const response = buildResponse({body: "", configuration})

    response.setFilePath(filePath)

    const client = new Client({clientCount: 1, configuration})

    /** @type {Array<string | Uint8Array>} */
    const outputs = []

    /** @type {boolean | undefined} */
    let fileSendBody

    client.events.on("output", (data) => {
      outputs.push(data)
    })
    client.events.on("file", ({sendBody, settle}) => {
      fileSendBody = sendBody
      void settle("completed")
    })

    await client.sendResponse(buildRequestRunner({request, response}))

    expect(fileSendBody).toBeTrue()
    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(headerText(outputs)).toContain(`Content-Length: ${stats.size}\r\n`)
  })
})
