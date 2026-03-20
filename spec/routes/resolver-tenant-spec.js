// @ts-check

import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import Current from "../../src/current.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {createTenantTestConfiguration, seedTenantValue} from "../helpers/tenant-test-helpers.js"

class TenantValueController extends Controller {
  /** @returns {Promise<void>} */
  async show() {
    const tenant = /** @type {{slug?: string} | undefined} */ (Current.tenant())
    const dbs = Configuration.current().getCurrentConnections()
    const defaultRows = await dbs.default.query("SELECT value FROM tenant_values LIMIT 1")
    const analyticsRows = await dbs.analytics.query("SELECT value FROM tenant_values LIMIT 1")

    this.renderJsonArg({
      analyticsValue: analyticsRows[0]?.value,
      tenantSlug: tenant?.slug,
      value: defaultRows[0]?.value
    })
  }
}

/**
 * @param {Configuration} configuration - Configuration.
 * @param {string} path - Request path.
 * @returns {Promise<Record<string, unknown>>} - Parsed response body.
 */
async function runHttpRequest(configuration, path) {
  const client = {remoteAddress: "127.0.0.1"}
  const request = new Request({client, configuration})
  const response = new Response({configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const requestLines = [
    `GET ${path} HTTP/1.1`,
    "Host: example.com",
    "",
    ""
  ].join("\r\n")

  request.feed(Buffer.from(requestLines, "utf8"))
  await donePromise
  await new RoutesResolver({configuration, request, response}).resolve()

  return JSON.parse(response.getBody())
}

/**
 * @param {Configuration} configuration - Configuration.
 * @param {string} path - Request path.
 * @returns {Promise<Record<string, unknown>>} - Parsed response body.
 */
async function runWebsocketRequest(configuration, path) {
  const request = new WebsocketRequest({method: "GET", path, remoteAddress: "127.0.0.1"})
  const response = new Response({configuration})

  await new RoutesResolver({configuration, request, response}).resolve()

  return JSON.parse(response.getBody())
}

describe("routes - resolver tenant", () => {
  it("runs HTTP and websocket requests inside the resolved tenant context", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-routes-tenant")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Configuration.current()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      configuration.addRouteResolverHook(({currentPath}) => {
        if (currentPath !== "/tenant-value") return null

        return {
          action: "show",
          controller: "tenant-value",
          controllerClass: TenantValueController
        }
      })

      await seedTenantValue(configuration, "default", "alpha", "alpha-default")
      await seedTenantValue(configuration, "analytics", "alpha", "alpha-analytics")
      await seedTenantValue(configuration, "default", "beta", "beta-default")
      await seedTenantValue(configuration, "analytics", "beta", "beta-analytics")

      const httpBody = await runHttpRequest(configuration, "/tenant-value?project_slug=alpha")
      const websocketBody = await runWebsocketRequest(configuration, "/tenant-value?project_slug=beta")

      expect(httpBody).toEqual({
        analyticsValue: "alpha-analytics",
        tenantSlug: "alpha",
        value: "alpha-default"
      })
      expect(websocketBody).toEqual({
        analyticsValue: "beta-analytics",
        tenantSlug: "beta",
        value: "beta-default"
      })
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })
})
