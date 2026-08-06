// @ts-check

import zlib from "node:zlib"
import {promisify} from "node:util"
import {parseAcceptEncoding} from "../../src/http-server/client/response-compression.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {bodyBuffer, buildConfiguration, buildRequest, buildResponse, deliverResponse, headerText} from "../helpers/http-response-compression-test-helper.js"

const gzipAsync = promisify(zlib.gzip)
const gunzipAsync = promisify(zlib.gunzip)
const brotliCompressAsync = promisify(zlib.brotliCompress)
const brotliDecompressAsync = promisify(zlib.brotliDecompress)

/** @type {zlib.ZlibOptions} */
const EXPECTED_GZIP_OPTIONS = {level: 6}

/**
 * Builds an enabled configuration, a compressible response, and delivers it with the given Accept-Encoding.
 * @param {object} [args] - Options object.
 * @param {string} [args.acceptEncoding] - Accept-Encoding header value.
 * @param {string | Uint8Array} [args.body] - Buffered response body.
 * @param {Record<string, string>} [args.headers] - Additional response headers.
 * @returns {Promise<{outputs: Array<string | Uint8Array>}>} - Captured output chunks.
 */
async function deliverCompressed({acceptEncoding, body = "compressible-body-content ".repeat(128), headers = {}} = {}) {
  const configuration = buildConfiguration({compression: true})
  const request = buildRequest({headers: acceptEncoding === undefined ? {} : {"Accept-Encoding": acceptEncoding}})
  const response = buildResponse({body, configuration, headers})

  return await deliverResponse({configuration, request, response})
}

describe("http server - response compression", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("does not compress when compression is explicitly disabled", async () => {
    const configuration = buildConfiguration({compression: false})
    const request = buildRequest({headers: {"Accept-Encoding": "gzip, br"}})
    const body = "compressible-body-content ".repeat(128)
    const response = buildResponse({body, configuration})
    const {outputs} = await deliverResponse({configuration, request, response})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(headerText(outputs)).not.toContain("Vary")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(body)
  })

  it("compresses with gzip and round-trips the exact bytes", async () => {
    const body = "compressible-body-content ".repeat(128)
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip", body})
    const expectedCompressed = await gzipAsync(Buffer.from(body, "utf8"), EXPECTED_GZIP_OPTIONS)
    const headers = headerText(outputs)

    expect(headers).toContain("Content-Encoding: gzip\r\n")
    expect(headers).toContain(`Content-Length: ${expectedCompressed.length}\r\n`)
    expect(headers).toContain("Vary: Accept-Encoding\r\n")

    const actualBody = bodyBuffer(outputs)

    expect(actualBody.length).toEqual(expectedCompressed.length)
    expect((await gunzipAsync(actualBody)).toString("utf8")).toEqual(body)
  })

  it("prefers br over gzip at equal q", async () => {
    const body = "compressible-body-content ".repeat(128)
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip, br", body})
    const headers = headerText(outputs)

    expect(headers).toContain("Content-Encoding: br\r\n")

    const decompressed = await brotliDecompressAsync(bodyBuffer(outputs))

    expect(decompressed.toString("utf8")).toEqual(body)
  })

  it("honors q-values over the br preference", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "br;q=0.5, gzip;q=1.0"})

    expect(headerText(outputs)).toContain("Content-Encoding: gzip\r\n")
  })

  it("chooses identity when identity has a higher q-value than every supported coding", async () => {
    const body = "compressible-body-content ".repeat(128)
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip;q=0.5, identity;q=1", body})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(body)
  })

  it("compares identity quality against all supported codings", async () => {
    const body = "compressible-body-content ".repeat(128)
    const {outputs} = await deliverCompressed({acceptEncoding: "br;q=0.5, gzip;q=0.4, identity;q=0.8", body})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(body)
  })

  it("breaks equal-q ties in server order: br, gzip, identity", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "identity;q=1, gzip;q=1"})

    expect(headerText(outputs)).toContain("Content-Encoding: gzip\r\n")
  })

  it("parses q-values strictly per the RFC qvalue grammar", () => {
    expect(parseAcceptEncoding("gzip;q=.5").get("gzip")).toEqual(0)
    expect(parseAcceptEncoding("gzip;q=01").get("gzip")).toEqual(0)
    expect(parseAcceptEncoding("gzip;q=1.001").get("gzip")).toEqual(0)
    expect(parseAcceptEncoding("gzip;q=0.1234").get("gzip")).toEqual(0)
    expect(parseAcceptEncoding("gzip;q=").get("gzip")).toEqual(0)
    expect(parseAcceptEncoding("gzip;q=0").get("gzip")).toEqual(0)
    expect(parseAcceptEncoding("gzip;q=0.5").get("gzip")).toEqual(0.5)
    expect(parseAcceptEncoding("gzip;q=0.125").get("gzip")).toEqual(0.125)
    expect(parseAcceptEncoding("gzip;q=1").get("gzip")).toEqual(1)
    expect(parseAcceptEncoding("gzip;q=1.000").get("gzip")).toEqual(1)
    expect(parseAcceptEncoding("gzip").get("gzip")).toEqual(1)
  })

  it("treats malformed q-values as not acceptable during negotiation", async () => {
    for (const acceptEncoding of ["gzip;q=.5", "gzip;q=01", "gzip;q=0.1234"]) {
      const {outputs} = await deliverCompressed({acceptEncoding})

      expect(headerText(outputs)).not.toContain("Content-Encoding")
    }
  })

  it("lets an explicit coding beat the wildcard", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "*;q=0.5, gzip;q=0.9"})

    expect(headerText(outputs)).toContain("Content-Encoding: gzip\r\n")
  })

  it("accepts supported codings through the wildcard and still prefers br", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "*;q=1"})

    expect(headerText(outputs)).toContain("Content-Encoding: br\r\n")
  })

  it("parses Accept-Encoding case-insensitively", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "GzIp"})

    expect(headerText(outputs)).toContain("Content-Encoding: gzip\r\n")
  })

  it("excludes codings with a q-value of zero", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "br;q=0, gzip"})

    expect(headerText(outputs)).toContain("Content-Encoding: gzip\r\n")
  })

  it("sends identity when the Accept-Encoding header is missing", async () => {
    const body = "compressible-body-content ".repeat(128)
    const {outputs} = await deliverCompressed({body})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(body)
  })

  it("sends identity when the Accept-Encoding header is empty", async () => {
    const body = "compressible-body-content ".repeat(128)
    const {outputs} = await deliverCompressed({acceptEncoding: "", body})

    expect(headerText(outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).toString("utf8")).toEqual(body)
  })

  it("compresses at the exact threshold boundary and skips one byte below it", async () => {
    const atThreshold = await deliverCompressed({acceptEncoding: "gzip", body: "a".repeat(1024)})
    const belowThreshold = await deliverCompressed({acceptEncoding: "gzip", body: "a".repeat(1023)})

    expect(headerText(atThreshold.outputs)).toContain("Content-Encoding: gzip\r\n")
    expect(headerText(belowThreshold.outputs)).not.toContain("Content-Encoding")
    expect(bodyBuffer(belowThreshold.outputs).toString("utf8")).toEqual("a".repeat(1023))
  })

  it("compresses below the threshold when identity is forbidden but a supported coding is acceptable", async () => {
    const body = "small-body-below-threshold"
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip, identity;q=0", body})

    expect(headerText(outputs)).toContain("Content-Encoding: gzip\r\n")
    expect((await gunzipAsync(bodyBuffer(outputs))).toString("utf8")).toEqual(body)
  })

  it("returns an empty 406 when identity is forbidden and no supported coding is acceptable", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "identity;q=0"})
    const headers = headerText(outputs)

    expect(headers).toContain("HTTP/1.1 406 Not Acceptable\r\n")
    expect(headers).toContain("Content-Length: 0\r\n")
    expect(headers).not.toContain("Content-Encoding")
    expect(bodyBuffer(outputs).length).toEqual(0)
  })

  it("returns an empty 406 when the wildcard forbids every supported coding and identity", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "*;q=0, identity;q=0"})

    expect(headerText(outputs)).toContain("HTTP/1.1 406 Not Acceptable\r\n")
    expect(bodyBuffer(outputs).length).toEqual(0)
  })

  it("preserves UTF-8 framing through compression", async () => {
    const body = "Aö€😀𐍈 ".repeat(300)
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip", body})
    const decompressed = await gunzipAsync(bodyBuffer(outputs))

    expect(decompressed.toString("utf8")).toEqual(body)
  })

  it("compresses Uint8Array bodies with binary correctness", async () => {
    const body = new Uint8Array(2048)

    for (let i = 0; i < body.length; i++) body[i] = i % 256

    const configuration = buildConfiguration({compression: true})
    const request = buildRequest({headers: {"Accept-Encoding": "gzip"}})
    const response = buildResponse({body, configuration, contentType: "application/json"})
    const {outputs} = await deliverResponse({configuration, request, response})

    expect(headerText(outputs)).toContain("Content-Encoding: gzip\r\n")

    const decompressed = await gunzipAsync(bodyBuffer(outputs))

    expect(decompressed.equals(Buffer.from(body))).toBeTrue()
  })

  it("compresses with the configured Brotli quality", async () => {
    const body = "compressible-body-content ".repeat(128)
    const configuration = buildConfiguration({compression: {brotliQuality: 11}})
    const request = buildRequest({headers: {"Accept-Encoding": "br"}})
    const response = buildResponse({body, configuration})
    const {outputs} = await deliverResponse({configuration, request, response})
    const expectedCompressed = await brotliCompressAsync(Buffer.from(body, "utf8"), {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11}})

    expect(headerText(outputs)).toContain(`Content-Length: ${expectedCompressed.length}\r\n`)
    expect(bodyBuffer(outputs).equals(expectedCompressed)).toBeTrue()
  })

  it("merges Accept-Encoding into an existing Vary without duplicates", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip", headers: {"Vary": "Accept-Language"}})

    expect(headerText(outputs)).toContain("Vary: Accept-Language, Accept-Encoding\r\n")
  })

  it("does not duplicate Accept-Encoding when Vary already carries it case-insensitively", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip", headers: {"vary": "accept-encoding"}})
    const varyLines = headerText(outputs).split("\r\n").filter((line) => line.toLowerCase().startsWith("vary:"))

    expect(varyLines).toEqual(["vary: accept-encoding"])
  })

  it("preserves Vary: * without merging", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip", headers: {"Vary": "*"}})
    const varyLines = headerText(outputs).split("\r\n").filter((line) => line.toLowerCase().startsWith("vary:"))

    expect(varyLines).toEqual(["Vary: *"])
  })

  it("emits exactly one Content-Length when a differently-cased content-length was pre-set", async () => {
    const body = "compressible-body-content ".repeat(128)
    const {outputs} = await deliverCompressed({acceptEncoding: "gzip", body, headers: {"content-length": "999"}})
    const expectedCompressed = await gzipAsync(Buffer.from(body, "utf8"), EXPECTED_GZIP_OPTIONS)
    const contentLengthLines = headerText(outputs).split("\r\n").filter((line) => line.toLowerCase().startsWith("content-length:"))

    expect(contentLengthLines).toEqual([`Content-Length: ${expectedCompressed.length}`])
  })

  it("emits exactly one Content-Length on an empty 406", async () => {
    const {outputs} = await deliverCompressed({acceptEncoding: "identity;q=0", headers: {"content-length": "999"}})
    const contentLengthLines = headerText(outputs).split("\r\n").filter((line) => line.toLowerCase().startsWith("content-length:"))

    expect(contentLengthLines).toEqual(["Content-Length: 0"])
  })
})
