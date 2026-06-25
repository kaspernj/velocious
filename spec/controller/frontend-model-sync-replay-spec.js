// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import frontendModelCommandRouteHook from "../../src/routes/hooks/frontend-model-command-route-hook.js"
import {createDeviceCertificate, createSignedMutation, generateSyncSigningKeyPair} from "../../src/sync/device-identity.js"
import {createOfflineGrantFromBootstrap} from "../../src/sync/offline-grant.js"
import {frontendModelSyncManifestForBackendProjects} from "../../src/frontend-models/resource-definition.js"

/** @typedef {import("../../src/sync/device-identity.js").SignedSyncMutation} SignedSyncMutation */

describe("frontend-model sync replay", () => {
  it("routes the sync replay endpoint through the frontend-model controller", async () => {
    const {configuration} = await syncReplayConfiguration()
    const routeMatch = await frontendModelCommandRouteHook({
      configuration,
      currentPath: "/frontend-models/sync/replay"
    })

    expect(routeMatch?.action).toEqual("frontend-sync-replay")
    expect(routeMatch?.controller).toEqual("velocious/api")
  })

  it("verifies and replays signed CRUD mutations through frontend-model command payloads", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        attributes: {scanned: true},
        clientMutationId: "mutation-1",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        payload: {id: "ticket-1"},
        policyHash: syncPolicyHash(configuration, "Ticket")
      }
    })
    const response = new Response({configuration})
    const controller = new ReplayTestController({
      action: "frontendSyncReplay",
      configuration,
      controller: "velocious/api",
      params: {mutation: signedMutation},
      request: requestFor(configuration),
      response,
      viewPath: "/tmp"
    })

    await controller.frontendSyncReplay()

    const payload = JSON.parse(String(response.getBody()))

    expect(payload.status).toEqual("success")
    expect(payload.results.length).toEqual(1)
    expect(payload.results[0].status).toEqual("success")
    expect(payload.results[0].idempotencyKey).toEqual("user-1:scanner-1:mutation-1")
    expect(payload.results[0].response).toEqual({status: "success", replayed: true})
    expect(controller.replayedCommands).toEqual([{action: "update", params: {attributes: {scanned: true}, id: "ticket-1", model: "Ticket"}}])
  })

  it("keeps signed mutation model and attributes authoritative over replay payload", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        attributes: {id: "ticket-1", scanned: true},
        clientMutationId: "mutation-override",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        payload: {attributes: {scanned: false}, id: "payload-ticket", model: "OtherModel"},
        policyHash: syncPolicyHash(configuration, "Ticket")
      }
    })
    const response = new Response({configuration})
    const controller = new ReplayTestController({
      action: "frontendSyncReplay",
      configuration,
      controller: "velocious/api",
      params: {mutation: signedMutation},
      request: requestFor(configuration),
      response,
      viewPath: "/tmp"
    })

    await controller.frontendSyncReplay()

    const payload = JSON.parse(String(response.getBody()))

    expect(payload.results[0].status).toEqual("success")
    expect(controller.replayedCommands).toEqual([{action: "update", params: {attributes: {scanned: true}, id: "payload-ticket", model: "Ticket"}}])
  })

  it("reads replay ids from generated mutation attributes", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        attributes: {id: "ticket-1", scanned: true},
        clientMutationId: "mutation-generated-id",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        policyHash: syncPolicyHash(configuration, "Ticket")
      }
    })
    const response = new Response({configuration})
    const controller = new ReplayTestController({
      action: "frontendSyncReplay",
      configuration,
      controller: "velocious/api",
      params: {mutation: signedMutation},
      request: requestFor(configuration),
      response,
      viewPath: "/tmp"
    })

    await controller.frontendSyncReplay()

    const payload = JSON.parse(String(response.getBody()))

    expect(payload.results[0].status).toEqual("success")
    expect(controller.replayedCommands).toEqual([{action: "update", params: {attributes: {scanned: true}, id: "ticket-1", model: "Ticket"}}])
  })

  it("emits framework errors for unexpected replay command failures", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const frameworkErrors = []
    const allErrors = []
    configuration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push(payload))
    configuration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        attributes: {scanned: true},
        clientMutationId: "mutation-command-failure",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        payload: {id: "ticket-1"},
        policyHash: syncPolicyHash(configuration, "Ticket")
      }
    })

    const response = new Response({configuration})
    const controller = new ThrowingReplayTestController({
      action: "frontendSyncReplay",
      configuration,
      controller: "velocious/api",
      params: {mutation: signedMutation},
      request: requestFor(configuration),
      response,
      viewPath: "/tmp"
    })

    await controller.frontendSyncReplay()

    const payload = JSON.parse(String(response.getBody()))

    expect(payload.results[0].status).toEqual("success")
    expect(payload.results[0].response.status).toEqual("error")
    expect(payload.results[0].response.errorMessage).toEqual("Request failed.")
    expect(frameworkErrors.length).toEqual(1)
    expect(frameworkErrors[0].error.message).toEqual("Replay command exploded")
    expect(frameworkErrors[0].context.action).toEqual("frontendSyncReplay")
    expect(allErrors.length).toEqual(1)
    expect(allErrors[0].errorType).toEqual("framework-error")
  })

  it("rejects replay when the signed offline grant does not authorize the mutation", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        attributes: {scanned: true},
        clientMutationId: "mutation-grant-mismatch",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-2",
        operation: "update",
        payload: {id: "ticket-1"},
        policyHash: syncPolicyHash(configuration, "Ticket")
      },
      offlineGrantId: "grant-1"
    })

    const response = new Response({configuration})
    const controller = new ReplayTestController({
      action: "frontendSyncReplay",
      configuration,
      controller: "velocious/api",
      params: {mutation: signedMutation},
      request: requestFor(configuration),
      response,
      viewPath: "/tmp"
    })

    await controller.frontendSyncReplay()

    const payload = JSON.parse(String(response.getBody()))

    expect(payload.results[0].status).toEqual("error")
    expect(payload.results[0].response.errorMessage).toEqual("Sync replay offline grant does not match mutation")
    expect(controller.replayedCommands).toEqual([])
  })

  it("rejects replay when the signed policy hash is stale", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        attributes: {scanned: true},
        clientMutationId: "mutation-2",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        payload: {id: "ticket-1"},
        policyHash: "sha256-stale"
      }
    })
    const response = new Response({configuration})
    const controller = new ReplayTestController({
      action: "frontendSyncReplay",
      configuration,
      controller: "velocious/api",
      params: {mutation: signedMutation},
      request: requestFor(configuration),
      response,
      viewPath: "/tmp"
    })

    await controller.frontendSyncReplay()

    const payload = JSON.parse(String(response.getBody()))

    expect(payload.results[0].status).toEqual("error")
    expect(payload.results[0].response.errorMessage).toEqual("Sync replay policy hash mismatch for Ticket")
    expect(controller.replayedCommands).toEqual([])
  })
})

class TicketResource extends FrontendModelBaseResource {
  static attributes = ["id", "scanned"]
  static sync = {
    metadata: {scope: "event"},
    operations: ["find", "update"],
    policy: {grantScopeAttributes: ["eventId"]},
    policyVersion: "scanner-v1"
  }
}

class ReplayTestController extends FrontendModelController {
  /**
   * Builds replay test controller.
   * @param {ConstructorParameters<typeof FrontendModelController>[0]} args - Controller args.
   */
  constructor(args) {
    super(args)

    /** @type {Array<{action: string, params: Record<string, ?>}>} */
    this.replayedCommands = []
  }

  /**
   * Records replayed command payloads.
   * @param {"create" | "update" | "destroy"} action - Frontend action.
   * @returns {Promise<Record<string, ?>>} - Replay result.
   */
  async frontendModelCommandPayload(action) {
    this.replayedCommands.push({action, params: this.frontendModelParams()})

    return {status: "success", replayed: true}
  }
}

class ThrowingReplayTestController extends ReplayTestController {
  /**
   * Throws an unexpected replay command failure.
   * @param {"create" | "update" | "destroy"} action - Frontend action.
   * @returns {Promise<Record<string, ?>>} - Never resolves successfully.
   */
  async frontendModelCommandPayload(action) {
    this.replayedCommands.push({action, params: this.frontendModelParams()})

    throw new Error("Replay command exploded")
  }
}

/**
 * Builds test configuration for sync replay specs.
 * @returns {Promise<{backendKeys: {privateKey: import("../../src/sync/device-identity.js").SyncJsonWebKey, publicKey: import("../../src/sync/device-identity.js").SyncJsonWebKey}, configuration: Configuration}>} - Test configuration.
 */
async function syncReplayConfiguration() {
  const backendKeys = await generateSyncSigningKeyPair()

  const configuration = new Configuration({
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
      deviceCertificateBackendPublicKey: backendKeys.publicKey,
      offlineGrantSigningKeys: [{current: true, id: "key-1", secret: "test-signing-secret"}],
      offlineGrantTtlMs: 1000 * 60 * 60 * 24 * 365 * 100
    }
  })

  return {backendKeys, configuration}
}

/**
 * Creates a signed replay mutation.
 * @param {object} args - Arguments.
 * @param {{privateKey: import("../../src/sync/device-identity.js").SyncJsonWebKey}} args.backendKeys - Backend signing keys.
 * @param {Configuration} args.configuration - Test configuration.
 * @param {import("../../src/sync/device-identity.js").SyncMutation} args.mutation - Mutation.
 * @param {string} [args.offlineGrantId] - Signed grant id override.
 * @returns {Promise<SignedSyncMutation & {signedOfflineGrant: import("../../src/sync/offline-grant.js").SignedOfflineGrant}>} - Signed mutation.
 */
async function signedReplayMutation({backendKeys, configuration, mutation, offlineGrantId}) {
  const deviceKeys = await generateSyncSigningKeyPair()
  const deviceCertificate = await createDeviceCertificate({
    backendPrivateKey: backendKeys.privateKey,
    certificate: {
      actorDeviceId: mutation.actorDeviceId,
      actorUserId: mutation.actorUserId,
      certificateId: "certificate-1",
      devicePublicKey: deviceKeys.publicKey,
      expiresAt: "2099-01-03T03:04:05.000Z",
      issuedAt: "2026-01-02T03:04:05.000Z"
    }
  })

  const signedMutation = await createSignedMutation({
    deviceCertificate,
    devicePrivateKey: deviceKeys.privateKey,
    mutation
  })
  const signingKey = {current: true, id: "key-1", secret: "test-signing-secret"}
  const signedOfflineGrant = await createOfflineGrantFromBootstrap({
    deviceId: mutation.actorDeviceId,
    grantId: offlineGrantId || mutation.offlineGrantId,
    grantTtlMs: 1000 * 60 * 60 * 24 * 365 * 100,
    now: new Date("2026-01-02T03:04:05.000Z"),
    resources: frontendModelSyncManifestForBackendProjects(configuration.getBackendProjects()),
    scopes: {eventId: "event-1"},
    signingKey,
    userId: mutation.actorUserId
  })

  return {
    ...signedMutation,
    signedOfflineGrant
  }
}

/**
 * Resolves current policy hash for a model.
 * @param {Configuration} configuration - Configuration.
 * @param {string} model - Model name.
 * @returns {string} - Policy hash.
 */
function syncPolicyHash(configuration, model) {
  const manifest = frontendModelSyncManifestForBackendProjects(configuration.getBackendProjects())

  return manifest[model].policyHash
}

/**
 * Builds a minimal request object for sync replay specs.
 * @param {Configuration} configuration - Test configuration.
 * @returns {Request} - Request.
 */
function requestFor(configuration) {
  const client = /** @type {any} */ ({remoteAddress: "127.0.0.1"})
  const request = new Request({client, configuration})

  request.feed(Buffer.from([
    "POST /frontend-models/sync/replay HTTP/1.1",
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  return request
}
