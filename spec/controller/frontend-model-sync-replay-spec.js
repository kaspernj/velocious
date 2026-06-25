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
import ServerChangeFeedStore, {serverChangeFeedStoreForConfiguration} from "../../src/sync/server-change-feed.js"

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

  it("routes the sync change-feed endpoint through the frontend-model controller", async () => {
    const {configuration} = await syncReplayConfiguration()

    for (const currentPath of ["/frontend-models/sync/change-feed", "/frontend-models/sync/changes", "/sync/changes"]) {
      const routeMatch = await frontendModelCommandRouteHook({
        configuration,
        currentPath
      })

      expect(routeMatch?.action).toEqual("frontend-sync-change-feed")
      expect(routeMatch?.controller).toEqual("velocious/api")
    }
  })

  it("routes the sync snapshot endpoint through the frontend-model controller", async () => {
    const {configuration} = await syncReplayConfiguration()

    for (const currentPath of ["/frontend-models/sync/snapshot", "/sync/snapshot"]) {
      const routeMatch = await frontendModelCommandRouteHook({
        configuration,
        currentPath
      })

      expect(routeMatch?.action).toEqual("frontend-sync-snapshot")
      expect(routeMatch?.controller).toEqual("velocious/api")
    }
  })

  it("pages stable server-sequenced changes without skipping newly inserted changes", async () => {
    const {configuration} = await syncReplayConfiguration()
    const store = new ServerChangeFeedStore({configuration})

    await appendTestChange(store, {clientMutationId: "mutation-1", recordId: "ticket-1"})
    await appendTestChange(store, {clientMutationId: "mutation-2", recordId: "ticket-2"})

    const firstPage = await store.changesAfter({afterSequence: 0, limit: 1})

    expect(firstPage.changes.map((change) => change.recordId)).toEqual(["ticket-1"])
    expect(firstPage.hasMore).toEqual(true)
    expect(firstPage.nextSequence).toEqual(1)
    expect(firstPage.upToSequence).toEqual(2)

    await appendTestChange(store, {clientMutationId: "mutation-3", recordId: "ticket-3"})

    const secondPage = await store.changesAfter({afterSequence: firstPage.nextSequence, limit: 1, upToSequence: firstPage.upToSequence})
    const catchUpPage = await store.changesAfter({afterSequence: secondPage.nextSequence, limit: 10})

    expect(secondPage.changes.map((change) => change.recordId)).toEqual(["ticket-2"])
    expect(secondPage.hasMore).toEqual(false)
    expect(secondPage.upToSequence).toEqual(2)
    expect(catchUpPage.changes.map((change) => change.recordId)).toEqual(["ticket-3"])
    expect(catchUpPage.upToSequence).toEqual(3)
  })

  it("requires snapshots when retention no longer covers the requested sequence", async () => {
    const {configuration} = await syncReplayConfiguration({changeFeedRetentionSize: 1})
    const store = new ServerChangeFeedStore({configuration})

    await appendTestChange(store, {clientMutationId: "mutation-1", recordId: "ticket-1"})
    await appendTestChange(store, {clientMutationId: "mutation-2", recordId: "ticket-2"})
    await appendTestChange(store, {clientMutationId: "mutation-3", recordId: "ticket-3"})

    const page = await store.changesAfter({afterSequence: 0, limit: 10})
    const expiredPage = await store.changesAfter({afterSequence: 1, limit: 10})

    expect(page.changes.map((change) => change.serverSequence)).toEqual([3])
    expect(expiredPage.status).toEqual(undefined)
    expect(expiredPage.snapshotRequired).toEqual(true)
    expect(expiredPage.oldestSequence).toEqual(3)
  })

  it("filters server change-feed pages to the verified offline grant scope", async () => {
    const {configuration} = await syncReplayConfiguration()
    const store = new ServerChangeFeedStore({configuration})

    await appendTestChange(store, {clientMutationId: "mutation-event-1", recordId: "ticket-1", scope: {eventId: "event-1", userId: "user-1"}})
    await appendTestChange(store, {clientMutationId: "mutation-event-2", recordId: "ticket-2", scope: {eventId: "event-2", userId: "user-1"}})
    await appendTestChange(store, {clientMutationId: "mutation-event-1b", recordId: "ticket-3", scope: {userId: "user-1", eventId: "event-1"}})

    const page = await store.changesAfter({afterSequence: 0, limit: 10, scope: {userId: "user-1", eventId: "event-1"}})

    expect(page.changes.map((change) => change.recordId)).toEqual(["ticket-1", "ticket-3"])
    expect(page.changes.every((change) => change.scope?.eventId === "event-1" && change.scope?.userId === "user-1")).toEqual(true)
    expect(page.nextSequence).toEqual(3)
  })

  it("assigns server sequences to replayed mutations and returns snapshot/change-feed cursors", async () => {
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
    expect(payload.results[0].serverSequence).toEqual(1)

    const snapshotResponse = new Response({configuration})
    const snapshotController = new ReplayTestController({
      action: "frontendSyncChangeFeed",
      configuration,
      controller: "velocious/api",
      params: {afterSequence: 0, signedOfflineGrant: signedMutation.signedOfflineGrant},
      request: requestFor(configuration, "/frontend-models/sync/change-feed"),
      response: snapshotResponse,
      viewPath: "/tmp"
    })

    await snapshotController.frontendSyncChangeFeed()

    const snapshotPayload = JSON.parse(String(snapshotResponse.getBody()))

    expect(snapshotPayload.status).toEqual("success")
    expect(snapshotPayload.serverSequence).toEqual(1)
    expect(snapshotPayload.hasMore).toEqual(false)
    expect(snapshotPayload.nextSequence).toEqual(1)
    expect(snapshotPayload.upToSequence).toEqual(1)
    expect(snapshotPayload.changes).toEqual([{actorDeviceId: "scanner-1", actorUserId: "user-1", attributes: {scanned: true}, createdAt: snapshotPayload.changes[0].createdAt, id: snapshotPayload.changes[0].id, idempotencyKey: "user-1:scanner-1:mutation-1", model: "Ticket", operation: "update", payload: {id: "ticket-1"}, recordId: "ticket-1", response: {status: "success", replayed: true}, scope: {eventId: "event-1"}, serverSequence: 1}])
    expect(snapshotPayload.snapshot).toEqual({resources: {Ticket: {models: [{id: "ticket-1", scanned: true}], status: "success"}}, serverSequence: 1})

    const changesResponse = new Response({configuration})
    const changesController = new ReplayTestController({
      action: "frontendSyncChangeFeed",
      configuration,
      controller: "velocious/api",
      params: {afterSequence: 1, signedOfflineGrant: signedMutation.signedOfflineGrant},
      request: requestFor(configuration, "/frontend-models/sync/change-feed"),
      response: changesResponse,
      viewPath: "/tmp"
    })

    await changesController.frontendSyncChangeFeed()

    const changesPayload = JSON.parse(String(changesResponse.getBody()))

    expect(changesPayload.status).toEqual("success")
    expect(changesPayload.serverSequence).toEqual(1)
    expect(changesPayload.changes).toEqual([])
    expect(changesPayload.snapshot).toEqual(undefined)
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

  it("replays custom sync commands through the resource command API and appends emitted changes", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        clientMutationId: "mutation-scan-attempt",
        command: "scanAttempt",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "scanAttempt",
        payload: {ticketId: "ticket-1", scannerId: "gate-a"},
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
    expect(payload.results[0].response).toEqual({scan: {scannerId: "gate-a", ticketId: "ticket-1"}, status: "success", syncChanges: [{attributes: {lastScannerId: "gate-a", scanned: true}, model: "Ticket", operation: "update", payload: {id: "ticket-1"}, recordId: "ticket-1"}]})
    expect(payload.results[0].serverSequence).toEqual(1)

    const store = serverChangeFeedStoreForConfiguration(configuration)
    const changePage = await store.changesAfter({afterSequence: 0, limit: 10})

    expect(changePage.changes).toEqual([{actorDeviceId: "scanner-1", actorUserId: "user-1", attributes: {lastScannerId: "gate-a", scanned: true}, createdAt: changePage.changes[0].createdAt, id: changePage.changes[0].id, idempotencyKey: "user-1:scanner-1:mutation-scan-attempt", model: "Ticket", operation: "update", payload: {id: "ticket-1"}, recordId: "ticket-1", response: {scan: {scannerId: "gate-a", ticketId: "ticket-1"}, status: "success", syncChanges: [{attributes: {lastScannerId: "gate-a", scanned: true}, model: "Ticket", operation: "update", payload: {id: "ticket-1"}, recordId: "ticket-1"}]}, scope: {eventId: "event-1"}, serverSequence: 1}])
  })

  it("rejects custom sync commands that are not registered on the resource", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        clientMutationId: "mutation-unknown-command",
        command: "closeGate",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "closeGate",
        payload: {ticketId: "ticket-1"},
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

    expect(payload.results[0].status).toEqual("error")
    expect(payload.results[0].response.errorMessage).toEqual("Sync replay command is not registered for Ticket: closeGate")
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

  it("keeps successful replay responses visible when the change-feed append fails", async () => {
    const {backendKeys, configuration} = await syncReplayConfiguration()
    const signedMutation = await signedReplayMutation({
      backendKeys,
      configuration,
      mutation: {
        actorDeviceId: "scanner-1",
        actorUserId: "user-1",
        attributes: {scanned: true},
        clientMutationId: "mutation-feed-failure",
        model: "Ticket",
        occurredAt: "2026-01-02T03:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        payload: {id: "ticket-1"},
        policyHash: syncPolicyHash(configuration, "Ticket")
      }
    })

    const response = new Response({configuration})
    const controller = new FeedAppendFailingReplayTestController({
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
    expect(payload.results[0].response).toEqual({status: "success", replayed: true})
    expect(payload.results[0].serverSequence).toEqual(null)
    expect(payload.results[0].serverChangeFeedStatus).toEqual("error")
    expect(payload.results[0].serverChangeFeedError.errorMessage).toEqual("Request failed.")
    expect(controller.replayedCommands).toEqual([{action: "update", params: {attributes: {scanned: true}, id: "ticket-1", model: "Ticket"}}])
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

/**
 * Appends a deterministic test change.
 * @param {ServerChangeFeedStore} store - Change-feed store.
 * @param {object} args - Arguments.
 * @param {string} args.clientMutationId - Client mutation id.
 * @param {string} args.recordId - Record id.
 * @param {Record<string, ?>} [args.scope] - Change scope.
 * @returns {Promise<void>} - Resolves when appended.
 */
async function appendTestChange(store, {clientMutationId, recordId, scope = {eventId: "event-1"}}) {
  await store.append({
    actorDeviceId: "scanner-1",
    actorUserId: "user-1",
    attributes: {scanned: true},
    idempotencyKey: `user-1:scanner-1:${clientMutationId}`,
    model: "Ticket",
    operation: "update",
    payload: {id: recordId},
    recordId,
    response: {status: "success", replayed: true},
    scope
  })
}

class TicketResource extends FrontendModelBaseResource {
  static attributes = ["id", "scanned"]
  static collectionCommands = ["scanAttempt"]
  static sync = {
    metadata: {scope: "event"},
    operations: ["find", "update", "scanAttempt", "closeGate"],
    policy: {grantScopeAttributes: ["eventId"]},
    policyVersion: "scanner-v1"
  }

  /**
   * Applies a scanner domain command.
   * @param {Record<string, ?>} args - Command arguments.
   * @returns {Promise<Record<string, ?>>} - Command response with emitted sync changes.
   */
  async scanAttempt(args) {
    const ticketId = String(args.ticketId)
    const scannerId = String(args.scannerId)

    return {
      scan: {scannerId, ticketId},
      status: "success",
      syncChanges: [{
        attributes: {lastScannerId: scannerId, scanned: true},
        model: "Ticket",
        operation: "update",
        payload: {id: ticketId},
        recordId: ticketId
      }]
    }
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
    if (action === "index") {
      return {models: [{id: "ticket-1", scanned: true}], status: "success"}
    }

    this.replayedCommands.push({action, params: this.frontendModelParams()})

    return {status: "success", replayed: true}
  }
}

class FeedAppendFailingReplayTestController extends ReplayTestController {
  /**
   * Simulates a change-feed append failure after the replay command succeeds.
   * @returns {Promise<number | null>} - Never resolves successfully.
   */
  async frontendSyncAppendServerChange() {
    throw new Error("Change feed exploded")
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
 * @param {object} [options] - Configuration options.
 * @param {number} [options.changeFeedRetentionSize] - Change-feed retention size.
 * @returns {Promise<{backendKeys: {privateKey: import("../../src/sync/device-identity.js").SyncJsonWebKey, publicKey: import("../../src/sync/device-identity.js").SyncJsonWebKey}, configuration: Configuration}>} - Test configuration.
 */
async function syncReplayConfiguration({changeFeedRetentionSize} = {}) {
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
      changeFeedRetentionSize,
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
 * @param {string} [path] - Request path.
 * @returns {Request} - Request.
 */
function requestFor(configuration, path = "/frontend-models/sync/replay") {
  const client = /** @type {any} */ ({remoteAddress: "127.0.0.1"})
  const request = new Request({client, configuration})

  request.feed(Buffer.from([
    `POST ${path} HTTP/1.1`,
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  return request
}
