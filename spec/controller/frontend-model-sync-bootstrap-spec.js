// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Ability from "../../src/authorization/ability.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import frontendModelCommandRouteHook from "../../src/routes/hooks/frontend-model-command-route-hook.js"
import {verifyOfflineGrant} from "../../src/sync/offline-grant.js"

describe("frontend-model sync bootstrap", () => {
  it("routes the sync bootstrap endpoint through the frontend-model controller", async () => {
    const configuration = syncBootstrapConfiguration()
    const routeMatch = await frontendModelCommandRouteHook({
      configuration,
      currentPath: "/frontend-models/sync/bootstrap"
    })

    expect(routeMatch?.action).toEqual("frontend-sync-bootstrap")
    expect(routeMatch?.controller).toEqual("velocious/api")
  })

  it("returns a signed offline grant with the current sync manifest", async () => {
    const configuration = syncBootstrapConfiguration()
    const response = new Response({configuration})
    const controller = new FrontendModelController({
      action: "frontendSyncBootstrap",
      configuration,
      controller: "velocious/api",
      params: {
        deviceId: "scanner-1",
        grantId: "grant-1",
        now: "2026-01-02T03:04:05.000Z",
        scopes: {eventId: "event-1"}
      },
      request: requestFor(configuration),
      response,
      viewPath: "/tmp"
    })
    controller._frontendModelAbilityOverride = new Ability({context: {currentUser: {id: "user-1"}}})

    await controller.frontendSyncBootstrap()

    const payload = JSON.parse(String(response.getBody()))

    expect(payload.status).toEqual("success")
    expect(payload.syncManifest.Ticket.policyHash).toMatch(/^sha256-[a-f0-9]{64}$/)
    expect(payload.offlineGrant.grant).toMatchObject({
      deviceId: "scanner-1",
      expiresAt: "2026-01-02T03:05:05.000Z",
      grantId: "grant-1",
      issuedAt: "2026-01-02T03:04:05.000Z",
      scopes: {eventId: "event-1"},
      userId: "user-1"
    })
    expect(payload.offlineGrant.grant.resources).toEqual(payload.syncManifest)

    const verifiedGrant = await verifyOfflineGrant({
      now: new Date("2026-01-02T03:04:10.000Z"),
      signedGrant: payload.offlineGrant,
      signingKeys: configuration.getSyncConfiguration().offlineGrantSigningKeys
    })

    expect(verifiedGrant).toEqual(payload.offlineGrant.grant)
  })
})

class TicketResource extends FrontendModelBaseResource {
  static attributes = ["id"]
  static sync = {
    metadata: {scope: "event"},
    operations: ["find", "scanAttempt"],
    policy: {grantScopeAttributes: ["eventId"]},
    policyVersion: "scanner-v1"
  }
}

/**
 * Builds test configuration for sync bootstrap specs.
 * @returns {Configuration} - Test configuration.
 */
function syncBootstrapConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: "/tmp",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    backendProjects: [{frontendModels: {Ticket: TicketResource}, path: "/tmp/backend"}],
    sync: {
      offlineGrantSigningKeys: [{current: true, id: "key-1", secret: "test-signing-secret"}],
      offlineGrantTtlMs: 60_000
    }
  })
}

/**
 * Builds a minimal request object for sync bootstrap specs.
 * @param {import("../../src/configuration.js").default} configuration - Test configuration.
 * @returns {Request} - Request.
 */
function requestFor(configuration) {
  const client = /** @type {any} */ ({remoteAddress: "127.0.0.1"})
  const request = new Request({client, configuration})

  request.feed(Buffer.from([
    "POST /frontend-models/sync/bootstrap HTTP/1.1",
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  return request
}
