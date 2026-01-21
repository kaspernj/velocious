// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import RequestParser from "../../src/http-server/client/request-parser.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("HttpServer - request parser", async () => {
  it("does not accept multiple requests in one parser", async () => {
    const configuration = new Configuration({
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
})
