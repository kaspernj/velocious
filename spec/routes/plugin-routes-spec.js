// @ts-check

import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

class PluginRouteController extends Controller {
  /** @returns {Promise<void>} - Resolves when complete. */
  async downloadSqlJs() {
    await this.render({json: {ok: true, value: this.params().sqlJsAssetFileName}})
  }
}

describe("routes - plugin routes", () => {
  it("supports configuration.routes((routes) => routes.get(path, {to}))", async () => {
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

    configuration.routes((routes) => {
      routes.get("/velocious/sqljs/:sqlJsAssetFileName", {to: [PluginRouteController, "downloadSqlJs"]})
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
      "GET /velocious/sqljs/sql-wasm.wasm HTTP/1.1",
      "Host: example.com",
      "",
      ""
    ].join("\r\n")

    try {
      request.feed(Buffer.from(requestLines, "utf8"))
      await donePromise

      const resolver = new RoutesResolver({configuration, request, response})
      await resolver.resolve()
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }

    expect(JSON.parse(response.getBody())).toEqual({ok: true, value: "sql-wasm.wasm"})
  })
})
