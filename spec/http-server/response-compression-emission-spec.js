// @ts-check

import zlib from "node:zlib"
import fs from "node:fs/promises"
import {promisify} from "node:util"
import Client from "../../src/http-server/client/index.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {bodyBuffer, buildConfiguration, buildRequest, buildRequestRunner, buildResponse, deliverResponse, headerText, repositoryPackageJsonPath} from "../helpers/http-response-compression-test-helper.js"

const gzipAsync = promisify(zlib.gzip)
const gunzipAsync = promisify(zlib.gunzip)

describe("http server - response compression emission", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("keeps pipelined response order when an async compression overlaps the next done request", async () => {
    const configuration = buildConfiguration({compression: true})
    const client = new Client({clientCount: 1, configuration})
    const firstBody = "compressible-body-content ".repeat(256)
    const secondBody = "second-response-marker"
    const firstRunner = buildRequestRunner({
      request: buildRequest({headers: {"Accept-Encoding": "gzip"}}),
      response: buildResponse({body: firstBody, configuration})
    })
    const secondRunner = buildRequestRunner({
      request: buildRequest(),
      response: buildResponse({body: secondBody, configuration})
    })

    /** @type {Array<string | Uint8Array>} */
    const outputs = []

    client.events.on("output", (data) => {
      outputs.push(data)
    })

    client.requestRunners.push(firstRunner, secondRunner)

    // The first response suspends on async zlib after its runner is shifted out of the
    // queue; the second requestDone must not overtake it and reorder the socket writes.
    const firstDrain = client.requestDone()
    const secondDrain = client.requestDone()

    await Promise.all([firstDrain, secondDrain])

    expect(outputs.length).toEqual(4)

    const firstHeaders = headerText(outputs)

    expect(firstHeaders).toContain("Content-Encoding: gzip\r\n")
    expect((await gunzipAsync(/** @type {Buffer} */ (outputs[1]))).toString("utf8")).toEqual(firstBody)
    expect(outputs[2]).toContain("HTTP/1.1 200 OK\r\n")
    expect(/** @type {string} */ (outputs[2])).not.toContain("Content-Encoding")
    expect(outputs[3]).toEqual(secondBody)
  })

  it("computes GET-equivalent headers for HEAD but emits no buffered body", async () => {
    const body = "HEAD body that must not be emitted"
    const configuration = buildConfiguration()
    const headRequest = buildRequest({httpMethod: "HEAD"})
    const getRequest = buildRequest({httpMethod: "GET"})
    const headResponse = buildResponse({body, configuration, contentType: "text/plain; charset=UTF-8"})
    const getResponse = buildResponse({body, configuration, contentType: "text/plain; charset=UTF-8"})
    const headResult = await deliverResponse({configuration, request: headRequest, response: headResponse})
    const getResult = await deliverResponse({configuration, request: getRequest, response: getResponse})

    expect(headResult.outputs.length).toEqual(1)
    expect(headerText(headResult.outputs)).toContain(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n`)
    expect(headerText(headResult.outputs)).toContain("Content-Type: text/plain; charset=UTF-8\r\n")

    // The representation headers match what the equivalent GET declares.
    const headContentLength = headerText(headResult.outputs).match(/Content-Length: \d+/u)?.[0]
    const getContentLength = headerText(getResult.outputs).match(/Content-Length: \d+/u)?.[0]

    expect(headContentLength).toEqual(getContentLength)
  })

  it("computes compressed representation headers for HEAD but emits no body", async () => {
    const body = "compressible-body-content ".repeat(128)
    const configuration = buildConfiguration({compression: true})
    const headRequest = buildRequest({headers: {"Accept-Encoding": "gzip"}, httpMethod: "HEAD"})
    const response = buildResponse({body, configuration})
    const {outputs} = await deliverResponse({configuration, request: headRequest, response})
    const expectedCompressed = await gzipAsync(Buffer.from(body, "utf8"), {level: 6})
    const headers = headerText(outputs)

    expect(outputs.length).toEqual(1)
    expect(headers).toContain("Content-Encoding: gzip\r\n")
    expect(headers).toContain(`Content-Length: ${expectedCompressed.length}\r\n`)
    expect(bodyBuffer(outputs).length).toEqual(0)
  })

  it("declares the file size for HEAD file responses without sending the file body", async () => {
    const configuration = buildConfiguration()
    const filePath = repositoryPackageJsonPath()
    const stats = await fs.stat(filePath)
    const request = buildRequest({httpMethod: "HEAD"})
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

    expect(outputs.length).toEqual(1)
    expect(fileSendBody).toBeFalse()
    expect(headerText(outputs)).toContain(`Content-Length: ${stats.size}\r\n`)
  })
})
