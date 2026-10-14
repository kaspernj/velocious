// @ts-check

import Configuration, {CurrentConfigurationNotSetError} from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import Routes from "../../src/routes/index.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @returns {Configuration | undefined} - Current configuration when one has been set.
 */
function currentConfigurationOrUndefined() {
  try {
    return Configuration.current()
  } catch (error) {
    if (error instanceof CurrentConfigurationNotSetError) return

    throw error
  }
}

/**
 * Resolves one GET request through the route resolver with the given routes.
 * @param {Configuration} configuration - Configuration instance.
 * @param {Routes} routes - Routes to resolve against.
 * @param {string} path - Request path.
 * @returns {Promise<Response>} - Resolved response.
 */
async function resolveGet(configuration, routes, path) {
  const previousConfiguration = currentConfigurationOrUndefined()
  configuration.setCurrent()
  configuration.setRoutes(routes)

  const response = new Response({configuration})
  const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

  try {
    request.feed(Buffer.from(`GET ${path} HTTP/1.1\r\nHost: example.com\r\n\r\n`, "utf8"))
    await donePromise

    await new RoutesResolver({configuration, request, response}).resolve()
  } finally {
    if (previousConfiguration) previousConfiguration.setCurrent()
  }

  return response
}

/**
 * @param {object} [options] - Options.
 * @param {boolean} [options.catchAll] - Declare the application catch-all route.
 * @returns {Routes} - Routes instance.
 */
function buildRoutes({catchAll = true} = {}) {
  const routes = new Routes()

  routes.draw((route) => {
    route.namespace("catchall-probe", (route) => {
      route.get("ping")
    })

    if (catchAll) {
      route.catchAll({action: "missing", controller: "catchall"})
    }
  })

  return routes
}

/**
 * @param {object} [options] - Options.
 * @param {boolean} [options.spyResolvers] - Install throwing ability/tenant resolver spies.
 * @returns {Configuration} - Configuration instance.
 */
function buildConfiguration({spyResolvers = true} = {}) {
  let resolvedAbility = false
  let resolvedTenant = false

  /** @type {Record<string, ReturnType<typeof JSON.parse> | (() => never)} */
  const options = {
    database: false,
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: true, file: false, levels: ["info", "warn", "error"]}
  }

  if (spyResolvers) {
    options.abilityResolver = () => {
      resolvedAbility = true
      throw new Error("Ability resolver should not run for catch-all responses")
    }
    options.tenantResolver = () => {
      resolvedTenant = true
      throw new Error("Tenant resolver should not run for catch-all responses")
    }
  }

  const configuration = new Configuration(options)

  configuration.resolvedAbilityCheck = () => resolvedAbility
  configuration.resolvedTenantCheck = () => resolvedTenant

  return configuration
}

describe("routes - catch-all", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("routes unmatched requests to the application catch-all controller/action without resolving tenant or ability", async () => {
    const routes = buildRoutes()
    const configuration = buildConfiguration()

    const response = await resolveGet(configuration, routes, "/nope/nowhere")

    expect(response.getStatusCode()).toEqual(404)
    expect(JSON.parse(response.getBody())).toEqual({error: "not_found", path: "/nope/nowhere"})
    expect(configuration.resolvedAbilityCheck()).toEqual(false)
    expect(configuration.resolvedTenantCheck()).toEqual(false)
  })

  it("does not intercept requests matched by declared routes", async () => {
    const routes = buildRoutes()
    const configuration = buildConfiguration({spyResolvers: false})

    const response = await resolveGet(configuration, routes, "/catchall-probe/ping")

    // The declared route resolves to the probe controller, not the catch-all.
    expect(response.getStatusCode()).toEqual(200)
    expect(JSON.parse(response.getBody())).toEqual({message: "pong"})
  })

  it("keeps the built-in not-found response when no catch-all is declared", async () => {
    const routes = buildRoutes({catchAll: false})
    const configuration = buildConfiguration()

    const response = await resolveGet(configuration, routes, "/nope/nowhere")

    expect(response.getStatusCode()).toEqual(404)
    expect(response.getBody()).toEqual("Path not found: /nope/nowhere\n")
  })

  it("throws when more than one catch-all is declared", async () => {
    const routes = new Routes()

    expect(() => {
      routes.draw((route) => {
        route.catchAll()
        route.catchAll()
      })
    }).toThrow("Only one catchAll route can be declared")
  })
})
