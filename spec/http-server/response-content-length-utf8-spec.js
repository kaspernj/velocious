// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Client from "../../src/http-server/client/index.js"
import VelociousHttpServerClientResponse from "../../src/http-server/client/response.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @returns {Configuration} - Minimal client test configuration without database access. */
function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: false, file: false}
  })
}

/**
 * Builds a fake request runner around a real response so sendResponse can be exercised in isolation.
 * @param {VelociousHttpServerClientResponse} response - Response instance to deliver.
 * @returns {any} - Minimal request runner stand-in.
 */
function buildRequestRunner(response) {
  const request = {
    header: () => undefined,
    httpVersion: () => "1.1"
  }

  return {
    response,
    getRequest: () => request,
    logCompletedRequest: async () => {}
  }
}

describe("http server - client Content-Length for UTF-8 string bodies", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("declares the UTF-8 byte length, not the JavaScript UTF-16 length, for multi-byte and astral characters", async () => {
    // "A" (1 byte / 1 UTF-16 unit), "ö" (2 bytes / 1 unit), "€" (3 bytes / 1 unit),
    // "😀" and "𐍈" are astral-plane code points (4 bytes / 2 UTF-16 units each).
    const body = "Aö€😀𐍈"
    const utf16Length = body.length
    const utf8ByteLength = Buffer.byteLength(body, "utf8")

    // Guard the premise of the test: the two measures MUST differ, otherwise the
    // assertions below could pass even if byte length were computed incorrectly.
    expect(utf16Length).toEqual(7)
    expect(utf8ByteLength).toEqual(14)

    const configuration = buildConfiguration()
    const client = new Client({clientCount: 1, configuration})
    const response = new VelociousHttpServerClientResponse({configuration})

    response.setBody(body)

    /** @type {Array<string | Uint8Array>} */
    const outputs = []

    client.events.on("output", (data) => {
      outputs.push(data)
    })

    await client.sendResponse(buildRequestRunner(response))

    // The header carries the exact UTF-8 byte length (14), never the UTF-16 length (7).
    expect(response.headers["Content-Length"]).toEqual([utf8ByteLength])
    expect(response.headers["Content-Length"]).not.toEqual([utf16Length])

    const headerOutput = /** @type {string} */ (outputs[0])
    const bodyOutput = outputs[1]

    expect(headerOutput).toContain("Content-Length: 14\r\n")

    // The declared Content-Length must equal the number of bytes actually written
    // for the body on the wire, so keep-alive clients read exactly the right amount.
    expect(bodyOutput).toEqual(body)
    expect(Buffer.byteLength(/** @type {string} */ (bodyOutput), "utf8")).toEqual(utf8ByteLength)
  })

  it("declares the encoded byte length for malformed UTF-16 surrogate sequences", async () => {
    const configuration = buildConfiguration()
    const cases = [
      {body: "\ud800", expectedByteLength: 3},
      {body: "\udc00", expectedByteLength: 3},
      {body: "a\ud800b", expectedByteLength: 5},
      {body: "\ud800\ud800", expectedByteLength: 6}
    ]

    for (const {body, expectedByteLength} of cases) {
      const client = new Client({clientCount: 1, configuration})
      const response = new VelociousHttpServerClientResponse({configuration})
      const outputs = /** @type {Array<string | Uint8Array>} */ ([])

      response.setBody(body)
      client.events.on("output", (data) => {
        outputs.push(data)
      })

      await client.sendResponse(buildRequestRunner(response))

      const headerOutput = /** @type {string} */ (outputs[0])
      const bodyOutput = /** @type {string} */ (outputs[1])

      expect(response.headers["Content-Length"]).toEqual([expectedByteLength])
      expect(headerOutput).toContain(`Content-Length: ${expectedByteLength}\r\n`)
      expect(bodyOutput).toEqual(body)
      expect(Buffer.byteLength(bodyOutput, "utf8")).toEqual(expectedByteLength)
    }
  })
})
