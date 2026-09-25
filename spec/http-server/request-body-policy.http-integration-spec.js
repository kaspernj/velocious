// @ts-check

import {connectRawHttpSocket, readRawHttpResponse, sendRawHttpRequest} from "../helpers/raw-http-test-client.js"
import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"

/**
 * @param {Buffer} body - Exact body bytes.
 * @param {object} [args] - Request options.
 * @param {string} [args.connection] - Connection header.
 * @param {string} [args.path] - Request path.
 * @returns {Buffer} - Complete wire request.
 */
function rawBodyRequest(body, {connection = "close", path = "/raw-body"} = {}) {
  const headers = Buffer.from([
    `POST ${path} HTTP/1.1`,
    "Host: localhost",
    `Connection: ${connection}`,
    "Content-Type: application/json",
    `Content-Length: ${body.byteLength}`,
    "",
    ""
  ].join("\r\n"), "latin1")

  return Buffer.concat([headers, body])
}

/**
 * @param {Buffer} responseBody - JSON response bytes.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Parsed JSON object.
 */
function parsedJson(responseBody) {
  return JSON.parse(responseBody.toString("utf8"))
}

describe("HTTP per-request body policies", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("delivers malformed JSON and exact binary bytes to an opted-in raw controller", async () => {
    await Dummy.run(async () => {
      const body = Buffer.from([0x7b, 0x22, 0xc3, 0xa9, 0x22, 0x3a, 0x00, 0xff])
      const response = await sendRawHttpRequest(rawBodyRequest(body, {path: "/raw-body?request=exact"}))
      const headerEndIndex = response.indexOf("\r\n\r\n")

      expect(response.subarray(0, headerEndIndex).toString("latin1")).toContain("HTTP/1.1 200 OK")
      expect(parsedJson(response.subarray(headerEndIndex + 4))).toEqual({
        base64: body.toString("base64"),
        byteLength: body.byteLength,
        queryValue: "exact"
      })
    })
  })

  it("preserves exact bytes when a Unicode sequence crosses socket chunks", async () => {
    await Dummy.run(async () => {
      const socket = await connectRawHttpSocket()
      const body = Buffer.from("{\"message\":\"æøå ✓\"", "utf8")
      const request = rawBodyRequest(body)
      const unicodeByteIndex = request.indexOf(Buffer.from("✓", "utf8"))

      try {
        socket.write(request.subarray(0, unicodeByteIndex + 1))
        socket.write(request.subarray(unicodeByteIndex + 1))

        const response = await readRawHttpResponse(socket)

        expect(response.headers).toContain("HTTP/1.1 200 OK")
        expect(parsedJson(response.body).base64).toEqual(body.toString("base64"))
      } finally {
        socket.destroy()
      }
    })
  })

  it("isolates raw policy state across keep-alive requests and ordinary routes", async () => {
    await Dummy.run(async () => {
      const socket = await connectRawHttpSocket()
      const rawBody = Buffer.from("{", "utf8")
      const formBody = "task[name]=ordinary-parsing"

      try {
        socket.write(rawBodyRequest(rawBody, {connection: "keep-alive", path: "/raw-body?request=first"}))
        const firstResponse = await readRawHttpResponse(socket)

        expect(firstResponse.headers).toContain("HTTP/1.1 200 OK")
        expect(parsedJson(firstResponse.body).base64).toEqual(rawBody.toString("base64"))

        socket.write([
          "POST /tasks/collection-post HTTP/1.1",
          "Host: localhost",
          "Connection: close",
          "Content-Type: application/x-www-form-urlencoded",
          `Content-Length: ${Buffer.byteLength(formBody)}`,
          "",
          formBody
        ].join("\r\n"))

        const secondResponse = await readRawHttpResponse(socket, firstResponse.remaining)

        expect(secondResponse.headers).toContain("HTTP/1.1 200 OK")
        expect(parsedJson(secondResponse.body)).toEqual({scope: "collection", method: "post"})
      } finally {
        socket.destroy()
      }
    })
  })

  it("rejects the raw route limit without applying it to an ordinary route", async () => {
    await Dummy.run(async () => {
      const oversizedBody = Buffer.from("123456789012345678901234567890123", "utf8")
      const rejected = await sendRawHttpRequest(rawBodyRequest(oversizedBody))
      const ordinaryBody = JSON.stringify({value: "12345678901234567"})
      const ordinary = await sendRawHttpRequest([
        "POST /tasks/collection-post HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(ordinaryBody)}`,
        "",
        ordinaryBody
      ].join("\r\n"))

      expect(rejected.toString("latin1")).toContain("HTTP/1.1 413 Payload Too Large")
      expect(ordinary.toString("latin1")).toContain("HTTP/1.1 200 OK")
    })
  })

  it("rejects malformed negative chunk framing before it can bypass the raw-route bound", async () => {
    await Dummy.run(async () => {
      const repeatedInvalidChunks = Array.from({length: 40}, () => "-ffffffff\r\nX\r\n").join("")
      const response = await sendRawHttpRequest([
        "POST /raw-body HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/json",
        "Transfer-Encoding: chunked",
        "",
        `${repeatedInvalidChunks}0\r\n\r\n`
      ].join("\r\n"))

      expect(response.toString("latin1")).toContain("HTTP/1.1 400 Bad Request")
    })
  })

  it("preserves valid chunk extensions and exact decoded bytes within the raw-route bound", async () => {
    await Dummy.run(async () => {
      const response = await sendRawHttpRequest([
        "POST /raw-body HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/json",
        "Transfer-Encoding: chunked",
        "",
        "2;name=first",
        "æ",
        "4;name=second",
        "øå",
        "0",
        "",
        ""
      ].join("\r\n"))
      const headerEndIndex = response.indexOf("\r\n\r\n")
      const expectedBody = Buffer.from("æøå", "utf8")

      expect(response.subarray(0, headerEndIndex).toString("latin1")).toContain("HTTP/1.1 200 OK")
      expect(parsedJson(response.subarray(headerEndIndex + 4)).base64).toEqual(expectedBody.toString("base64"))
    })
  })
})
