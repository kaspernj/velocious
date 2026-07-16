// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import ParamsToObject from "../../src/http-server/client/params-to-object.js"
import RequestParser from "../../src/http-server/client/request-parser.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * Builds a minimal configuration for parser specs.
 * @returns {Configuration} - Configuration instance.
 */
function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: true, file: false, levels: ["info", "warn", "error"]}
  })
}

describe("HttpServer - request parser", {databaseCleaning: {transaction: true}}, async () => {
  it("does not accept multiple requests in one parser", async () => {
    const configuration = buildConfiguration()

    let previousConfiguration
    try {
      previousConfiguration = Configuration.current()
    } catch {
      // Ignore missing configuration
    }

    configuration.setCurrent()

    const requestParser = new RequestParser({configuration})
    const donePromise = new Promise((resolve) => requestParser.events.on("done", resolve))
    const requestLines = [
      "GET /ping HTTP/1.1",
      "Host: example.com",
      "",
      ""
    ].join("\r\n")

    try {
      requestParser.feed(Buffer.from(requestLines, "utf8"))
      await donePromise

      await expect(() => requestParser.feed(Buffer.from(requestLines, "utf8")))
        .toThrow(/Request parser already completed/)
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })

  it("includes the malformed nested parameter key in parser errors", async () => {
    const paramsToObject = new ParamsToObject({"task[]]": "Broken"})

    await expect(() => paramsToObject.toObject())
      .toThrow('Could not parse nested params key "task[]]" at rest "]"')
  })

  it("parses a body-carrying request identically no matter how the bytes are chunked", async () => {
    const configuration = buildConfiguration()

    let previousConfiguration
    try {
      previousConfiguration = Configuration.current()
    } catch {
      // Ignore missing configuration
    }

    configuration.setCurrent()

    const body = JSON.stringify({task: {description: "Multi-byte chars split across chunks: æøå ✓", name: "Chunky"}})
    const requestData = Buffer.from([
      "POST /tasks?from=chunk-test HTTP/1.1",
      "Host: example.com:3000",
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "",
      body
    ].join("\r\n"), "utf8")

    const parseWithSplit = async (/** @type {number | undefined} */ splitPosition) => {
      const requestParser = new RequestParser({configuration})
      const donePromise = new Promise((resolve) => requestParser.events.on("done", resolve))

      if (splitPosition === undefined) {
        requestParser.feed(requestData)
      } else {
        requestParser.feed(requestData.subarray(0, splitPosition))
        requestParser.feed(requestData.subarray(splitPosition))
      }

      await donePromise

      return requestParser
    }

    const expectedHeaders = {
      "Host": "example.com:3000",
      "Content-Type": "application/json",
      "Content-Length": `${Buffer.byteLength(body)}`
    }
    const expectedParams = {task: {description: "Multi-byte chars split across chunks: æøå ✓", name: "Chunky"}}

    try {
      const reference = await parseWithSplit(undefined)

      expect(reference.getHttpMethod()).toEqual("POST")
      expect(reference.getPath()).toEqual("/tasks?from=chunk-test")
      expect(reference.getHeaders()).toEqual(expectedHeaders)
      expect(reference.params).toEqual(expectedParams)

      // Splitting at every byte position covers header lines, the header/body
      // boundary and multi-byte UTF-8 sequences broken across socket chunks.
      for (let splitPosition = 1; splitPosition < requestData.length; splitPosition += 1) {
        const requestParser = await parseWithSplit(splitPosition)

        expect(requestParser.getHttpMethod()).toEqual("POST")
        expect(requestParser.getPath()).toEqual("/tasks?from=chunk-test")
        expect(requestParser.getHeaders()).toEqual(expectedHeaders)
        expect(requestParser.params).toEqual(expectedParams)
      }
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })
})
