// @ts-check

import {createRequire} from "node:module"
import fs from "node:fs/promises"
import path from "node:path"

import Configuration from "../../src/configuration.js"
import fetch from "node-fetch"
import Dummy from "../dummy/index.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import installSqlJsWasmRoute, {sqlJsLocateFileFromBackend} from "../../src/plugins/sqljs-wasm-route.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

const require = createRequire(import.meta.url)
const sqlJsDistDirectory = path.dirname(require.resolve("sql.js"))

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
    const responseFilePath = response.getFilePath()
    const responseBody = response.getBody()

    expect(contentType).toEqual("application/wasm")
    expect(typeof responseFilePath === "string").toEqual(true)
    expect(responseFilePath?.endsWith("/sql-wasm.wasm")).toEqual(true)
    expect(responseBody).toEqual(null)
  })

  it("builds locateFile URLs for backend-hosted sql.js assets", () => {
    const locateFile = sqlJsLocateFileFromBackend({
      backendBaseUrl: "http://127.0.0.1:4501/",
      routePrefix: "/velocious/sqljs"
    })

    const sqlWasmUrl = locateFile("sql-wasm.wasm")

    expect(sqlWasmUrl).toEqual("http://127.0.0.1:4501/velocious/sqljs/sql-wasm.wasm")
  })

  it("serves identical wasm bytes over dummy app HTTP", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://localhost:3006/velocious/sqljs/sql-wasm.wasm")
      const responseBytes = Buffer.from(await response.arrayBuffer())
      const expectedBytes = await fs.readFile(path.join(sqlJsDistDirectory, "sql-wasm.wasm"))

      expect(response.status).toEqual(200)
      expect(response.headers.get("content-type")).toEqual("application/wasm")
      expect(responseBytes.byteLength).toEqual(expectedBytes.byteLength)
      expect(responseBytes.equals(expectedBytes)).toEqual(true)
    })
  })
})
