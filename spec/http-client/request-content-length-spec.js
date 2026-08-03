// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import Request from "../../src/http-client/request.js"

/**
 * Builds a request with the given body and returns the serialized head (request line + headers).
 * @param {string | Buffer | Uint8Array} body - Request body.
 * @returns {string} - Serialized request head.
 */
function requestHead(body) {
  const request = new Request({body, method: "POST", path: "/tasks", version: "1.1"})
  const requestString = request.asString()

  return requestString.slice(0, requestString.indexOf("\r\n\r\n") + 2)
}

describe("http client - request Content-Length framing", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("declares the UTF-8 byte length, not the JavaScript UTF-16 length, for multi-byte and astral characters", () => {
    // "A" (1 byte / 1 UTF-16 unit), "ö" (2 bytes / 1 unit), "€" (3 bytes / 1 unit),
    // "😀" and "𐍈" are astral-plane code points (4 bytes / 2 UTF-16 units each).
    const body = "Aö€😀𐍈"
    const utf16Length = body.length
    const utf8ByteLength = Buffer.byteLength(body, "utf8")

    // Guard the premise of the test: the two measures MUST differ, otherwise the
    // assertions below could pass even if byte length were computed incorrectly.
    expect(utf16Length).toEqual(7)
    expect(utf8ByteLength).toEqual(14)

    const head = requestHead(body)

    expect(head).toContain(`Content-Length: ${utf8ByteLength}\r\n`)
    expect(head).not.toContain(`Content-Length: ${utf16Length}\r\n`)
  })

  it("declares the encoded byte length for malformed UTF-16 surrogate sequences", () => {
    const cases = [
      {body: "\ud800", expectedByteLength: 3},
      {body: "\udc00", expectedByteLength: 3},
      {body: "a\ud800b", expectedByteLength: 5},
      {body: "\ud800\ud800", expectedByteLength: 6}
    ]

    for (const {body, expectedByteLength} of cases) {
      const head = requestHead(body)

      // The declared Content-Length must equal the number of bytes actually written
      // for the body on the wire, so keep-alive servers read exactly the right amount.
      expect(head).toContain(`Content-Length: ${expectedByteLength}\r\n`)
      expect(Buffer.byteLength(body, "utf8")).toEqual(expectedByteLength)
    }
  })

  it("declares the buffer byte length for Buffer and Uint8Array bodies", () => {
    const buffer = Buffer.from("Aö€😀𐍈", "utf8")
    const uint8Array = new Uint8Array(buffer)

    expect(requestHead(buffer)).toContain(`Content-Length: ${buffer.byteLength}\r\n`)
    expect(requestHead(uint8Array)).toContain(`Content-Length: ${uint8Array.byteLength}\r\n`)
  })
})
