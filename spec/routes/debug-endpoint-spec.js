// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {object} args - Configuration arguments.
 * @param {boolean | {path?: string, token?: string}} [args.debugEndpoint] - Debug endpoint configuration.
 * @returns {Configuration} - Test configuration.
 */
function buildConfiguration({debugEndpoint = false} = {}) {
  return new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          name: "test-db",
          poolType: SingleMultiUsePool,
          type: "sqlite"
        }
      }
    },
    debugEndpoint,
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

/**
 * @param {Configuration} configuration - Configuration instance.
 * @param {string} path - Request path.
 * @param {{authorization?: string}} [options] - Optional request headers.
 * @returns {Promise<Response>} - Response after route resolution.
 */
async function resolveGet(configuration, path, {authorization} = {}) {
  const previousConfiguration = currentConfigurationOrUndefined()
  configuration.setCurrent()
  configuration.setRoutes(dummyRoutes.routes)

  const response = new Response({configuration})
  const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const authorizationHeaderLine = authorization ? `Authorization: ${authorization}\r\n` : ""

  try {
    request.feed(Buffer.from(`GET ${path} HTTP/1.1\r\nHost: example.com\r\n${authorizationHeaderLine}\r\n`, "utf8"))
    await donePromise

    const resolver = new RoutesResolver({configuration, request, response})
    await resolver.resolve()
  } finally {
    await configuration.closeDatabaseConnections()

    if (previousConfiguration) previousConfiguration.setCurrent()
  }

  return response
}

/** @returns {Configuration | undefined} - Current configuration when one has been set. */
function currentConfigurationOrUndefined() {
  try {
    return Configuration.current()
  } catch {
    return
  }
}

describe("routes - debug endpoint", {databaseCleaning: {transaction: true}}, () => {
  it("is disabled by default", async () => {
    const response = await resolveGet(buildConfiguration(), "/velocious/debug")

    expect(response.getStatusCode()).toEqual(404)
  })

  it("returns pretty JSON diagnostics when enabled", async () => {
    const configuration = buildConfiguration({debugEndpoint: true})
    const response = await resolveGet(configuration, "/velocious/debug")
    const body = response.getBody()

    if (typeof body !== "string") throw new Error("Expected debug response body to be a string")

    const payload = JSON.parse(body)
    const defaultPool = payload.database.pools.default

    expect(response.getStatusCode()).toEqual(200)
    expect(response.headers["Content-Type"]).toEqual(["application/json; charset=UTF-8"])
    expect(body.startsWith("{\n  ")).toEqual(true)
    expect(payload.configuration.debugEndpoint).toEqual({enabled: true, path: "/velocious/debug", tokenConfigured: false})
    expect(payload.server.environment).toEqual("test")
    expect(payload.database.activeIdentifiers).toEqual(["default"])
    expect(defaultPool.connections).toEqual([])
    expect(defaultPool.idleCount).toEqual(0)
  })

  it("reports held connections without checking one out for the debug action", async () => {
    const configuration = buildConfiguration({debugEndpoint: true})

    await configuration.ensureConnections({name: "outer checkout"}, async () => {
      const response = await resolveGet(configuration, "/velocious/debug")
      const body = response.getBody()

      if (typeof body !== "string") throw new Error("Expected debug response body to be a string")

      const defaultPool = JSON.parse(body).database.pools.default

      expect(defaultPool.connections[0].checkoutName).toEqual("outer checkout")
      expect(defaultPool.connections[0].state).toEqual("shared")
    })
  })

  it("supports a custom debug endpoint path", async () => {
    const response = await resolveGet(buildConfiguration({debugEndpoint: {path: "/internal/debug"}}), "/internal/debug")
    const body = response.getBody()

    if (typeof body !== "string") throw new Error("Expected debug response body to be a string")

    expect(JSON.parse(body).configuration.debugEndpoint.path).toEqual("/internal/debug")
  })

  it("returns 404 when a token is configured but the request has no bearer token", async () => {
    const response = await resolveGet(buildConfiguration({debugEndpoint: {token: "secret-debug-token"}}), "/velocious/debug")

    expect(response.getStatusCode()).toEqual(404)
  })

  it("returns 404 when a token is configured but the bearer token is wrong", async () => {
    const response = await resolveGet(buildConfiguration({debugEndpoint: {token: "secret-debug-token"}}), "/velocious/debug", {authorization: "Bearer wrong-token"})

    expect(response.getStatusCode()).toEqual(404)
  })

  it("returns diagnostics with the correct bearer token and never exposes the token", async () => {
    const response = await resolveGet(buildConfiguration({debugEndpoint: {token: "secret-debug-token"}}), "/velocious/debug", {authorization: "Bearer secret-debug-token"})
    const body = response.getBody()

    if (typeof body !== "string") throw new Error("Expected debug response body to be a string")

    expect(response.getStatusCode()).toEqual(200)
    expect(JSON.parse(body).configuration.debugEndpoint).toEqual({enabled: true, path: "/velocious/debug", tokenConfigured: true})
    expect(body.includes("secret-debug-token")).toEqual(false)
  })
})
