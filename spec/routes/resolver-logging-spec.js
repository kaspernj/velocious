// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("routes - resolver logging", async () => {
  it("logs request start at debug level in test environment", async () => {
    /** @type {string[]} */
    const writes = []
    const originalWrite = process.stdout.write

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
    configuration.setRoutes(dummyRoutes.routes)

    const client = {remoteAddress: "127.0.0.1"}
    const request = new Request({client, configuration})
    const response = new Response({configuration})

    const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
    const requestLines = [
      "GET /ping HTTP/1.1",
      "Host: example.com",
      "",
      ""
    ].join("\r\n")

    try {
      // @ts-ignore Monkey-patch to capture logger output
      process.stdout.write = (chunk, encoding, callback) => {
        writes.push(chunk.toString())
        if (typeof callback === "function") callback()
        return true
      }

      request.feed(Buffer.from(requestLines, "utf8"))
      await donePromise

      const resolver = new RoutesResolver({configuration, request, response})

      await resolver.resolve()
    } finally {
      // @ts-ignore Restore original stdout
      process.stdout.write = originalWrite
      if (previousConfiguration) previousConfiguration.setCurrent()
    }

    expect(writes).toEqual([])
  })
})
