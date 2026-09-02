// @ts-check

import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import { describe, expect, it } from "../../src/testing/test.js"

class RouteCredentialController extends Controller {
  async show() {}
}

describe("routes - resolver log redaction", () => {
  it("redacts sensitive request query and nested parameter values before logging", async () => {
    const requestSecret = "SYNTHETIC_REQUEST_SECRET_6993A903"
    const extendedSecret = "SYNTHETIC_EXTENDED_SECRET_6993A903"
    const safeValue = "visible-request-diagnostic"
    const output = new LoggerArrayOutput()
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {
        outputs: [{levels: ["debug"], output}],
        sensitiveNames: ["integrationPin"]
      }
    })

    configuration.setRoutes(dummyRoutes.routes)

    const request = new WebsocketRequest({
      headers: {Authorization: `Bearer ${requestSecret}`},
      method: "GET",
      params: {
        items: [{authentication_token: requestSecret, safeField: safeValue}],
        integration_pin: extendedSecret
      },
      path: `/ping?service-token=${encodeURIComponent(requestSecret)}&visible=${safeValue}`,
      remoteAddress: "127.0.0.1"
    })
    const response = new Response({configuration})
    const resolver = new RoutesResolver({configuration, request, response})

    await resolver.resolve()

    const messages = output.getLogs().map((entry) => entry.message)
    const leakedValueCount = messages.filter((message) => message.includes(requestSecret) || message.includes(extendedSecret)).length
    const redactionMarkerCount = messages.filter((message) => message.includes("[REDACTED]")).length
    const safeValueCount = messages.filter((message) => message.includes(safeValue)).length

    expect(leakedValueCount).toEqual(0)
    expect(redactionMarkerCount).toBeGreaterThan(0)
    expect(safeValueCount).toBeGreaterThan(0)
  })

  it("registers finalized sensitive route params before formatting the request path", async () => {
    const secret = "SYNTHETIC_ROUTE_PARAM_SECRET_6993A903"
    const output = new LoggerArrayOutput()
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {outputs: [{levels: ["debug"], output}]}
    })

    configuration.setRoutes(dummyRoutes.routes)
    configuration.addRouteResolverHook(({currentPath}) => {
      if (!currentPath.startsWith("/route-credential/")) return null

      return {
        action: "show",
        controller: "route-credential",
        controllerClass: RouteCredentialController,
        params: {serviceToken: currentPath.slice("/route-credential/".length)},
        skipAbilityResolution: true,
        skipControllerConnections: true,
        skipTenantResolution: true
      }
    })

    const request = new WebsocketRequest({method: "GET", path: `/route-credential/${secret}`})
    const response = new Response({configuration})
    const resolver = new RoutesResolver({configuration, request, response})

    await resolver.resolve()

    const messages = output.getLogs().map((entry) => entry.message)

    expect(messages.filter((message) => message.includes(secret)).length).toEqual(0)
    expect(messages.filter((message) => message.includes("[REDACTED]")).length).toBeGreaterThan(0)
  })
})
