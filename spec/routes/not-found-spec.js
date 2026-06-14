// @ts-check

import Configuration, {CurrentConfigurationNotSetError} from "../../src/configuration.js"
import BasePool from "../../src/database/pool/base.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** Test pool that fails if the not-found route tries to resolve database connections. */
class NotFoundFailingPool extends BasePool {
  /** @type {boolean} */
  static resolvedConnections = false

  /** @param {import("../../src/database/drivers/base.js").default} _connection - Connection. */
  checkin(_connection) {
    throw new Error("Not-found responses should not check in database connections")
  }

  /**
   * @param {import("../../src/database/pool/base.js").ConnectionCheckoutOptions} [_options] - Checkout options.
   * @returns {Promise<import("../../src/database/drivers/base.js").default>} - Rejected checkout.
   */
  async checkout(_options) {
    NotFoundFailingPool.resolvedConnections = true

    throw new Error("Not-found responses should not check out database connections")
  }

  /** @returns {import("../../src/database/drivers/base.js").default} - Current connection. */
  getCurrentConnection() {
    throw new Error("Not-found responses should not read current database connections")
  }

  /** @returns {string} - Primary key type. */
  primaryKeyType() {
    return "integer"
  }

  /**
   * @template T
   * @param {import("../../src/database/pool/base.js").ConnectionCheckoutOptions | ((connection: import("../../src/database/drivers/base.js").default) => Promise<T>)} _optionsOrCallback - Options or callback.
   * @param {(connection: import("../../src/database/drivers/base.js").default) => Promise<T>} [_callback] - Callback.
   * @returns {Promise<T>} - Rejected connection callback.
   */
  async withConnection(_optionsOrCallback, _callback) {
    NotFoundFailingPool.resolvedConnections = true

    throw new Error("Not-found responses should not resolve database connections")
  }
}

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
 * Resolves one GET request through the route resolver.
 * @param {Configuration} configuration - Configuration instance.
 * @param {string} path - Request path.
 * @returns {Promise<Response>} - Resolved response.
 */
async function resolveGet(configuration, path) {
  const previousConfiguration = currentConfigurationOrUndefined()
  configuration.setCurrent()
  configuration.setRoutes(dummyRoutes.routes)

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

describe("routes - not found", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("renders the built-in not-found response without resolving database connections, tenant, or ability", async () => {
    let resolvedAbility = false
    let resolvedTenant = false
    NotFoundFailingPool.resolvedConnections = false
    const configuration = new Configuration({
      abilityResolver: () => {
        resolvedAbility = true
        throw new Error("Ability resolver should not run for built-in not-found responses")
      },
      database: {
        test: {
          default: {
            poolType: NotFoundFailingPool,
            type: "fake"
          }
        }
      },
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: true, file: false, levels: ["info", "warn", "error"]},
      tenantResolver: () => {
        resolvedTenant = true
        throw new Error("Tenant resolver should not run for built-in not-found responses")
      }
    })

    const response = await resolveGet(configuration, "/application.yaml")

    expect(response.getStatusCode()).toEqual(404)
    expect(response.getBody()).toEqual("Path not found: /application.yaml\n")
    expect(resolvedAbility).toEqual(false)
    expect(NotFoundFailingPool.resolvedConnections).toEqual(false)
    expect(resolvedTenant).toEqual(false)
  })
})
