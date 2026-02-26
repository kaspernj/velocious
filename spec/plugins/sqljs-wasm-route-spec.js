// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import installSqlJsWasmRoute, {sqlJsLocateFileFromBackend} from "../../src/plugins/sqljs-wasm-route.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("plugins - sqljs wasm route", () => {
  it("serves sql-wasm.wasm from backend route hook", async () => {
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

    installSqlJsWasmRoute({configuration})

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

    const contentType = response.headers["Content-Type"]?.[0]
    const responseBody = response.getBody()

    expect(contentType).toEqual("application/wasm")
    expect(responseBody instanceof Uint8Array).toEqual(true)
    expect(responseBody[0]).toEqual(0)
    expect(responseBody[1]).toEqual(97)
    expect(responseBody[2]).toEqual(115)
    expect(responseBody[3]).toEqual(109)
  })

  it("builds locateFile URLs for backend-hosted sql.js assets", () => {
    const locateFile = sqlJsLocateFileFromBackend({
      backendBaseUrl: "http://127.0.0.1:4501/",
      routePrefix: "/velocious/sqljs"
    })

    const sqlWasmUrl = locateFile("sql-wasm.wasm")

    expect(sqlWasmUrl).toEqual("http://127.0.0.1:4501/velocious/sqljs/sql-wasm.wasm")
  })
})
