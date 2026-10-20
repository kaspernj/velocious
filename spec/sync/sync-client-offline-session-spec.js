// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration, buildFakeSyncModel, buildMetadataModelClass, buildRecord} from "./sync-client-fakes.js"
import {createDeviceCertificate, generateSyncSigningKeyPair} from "../../src/sync/device-identity.js"
import {createOfflineGrantFromBootstrap} from "../../src/sync/offline-grant.js"
import LocalMutationLog from "../../src/sync/local-mutation-log.js"
import SyncClient from "../../src/sync/sync-client.js"

const NOW = new Date("2030-01-01T00:00:00.000Z")
let harnessSequenceCounter = 0
const POLICY_HASH = "sha256:policy-one"
const GRANT_SIGNING_KEY = {current: true, id: "key-1", secret: "test-grant-secret"}

/**
 * Builds an in-memory durable storage adapter for a LocalMutationLog.
 * @returns {import("../../src/sync/local-mutation-log.js").LocalMutationLogStorage} Storage adapter.
 */
function buildMemoryStorage() {
  /** @type {Map<string, Array<Record<string, ReturnType<typeof JSON.parse>>>}} */
  const recordsByKey = new Map()

  /** @param {string} storageKey - Log storage key. @returns {Array<Record<string, ReturnType<typeof JSON.parse>>>} Records for the key. */
  function recordsFor(storageKey) {
    if (!recordsByKey.has(storageKey)) recordsByKey.set(storageKey, [])

    return recordsByKey.get(storageKey)
  }

  return {
    appendRecord(storageKey, record) {
      recordsFor(storageKey).push(JSON.parse(JSON.stringify(record)))
    },
    deleteRecords(storageKey, ids) {
      recordsByKey.set(storageKey, recordsFor(storageKey).filter((record) => !ids.includes(record.id)))
    },
    nextSequence(storageKey) {
      return recordsFor(storageKey).length + 1
    },
    record(storageKey, id) {
      const record = recordsFor(storageKey).find((entry) => entry.id === id)

      return record ? JSON.parse(JSON.stringify(record)) : null
    },
    records(storageKey, options = {}) {
      let records = recordsFor(storageKey)

      if (options.statuses) records = records.filter((record) => options.statuses.includes(record.status))

      return JSON.parse(JSON.stringify(records))
    },
    updateRecord(storageKey, record) {
      const records = recordsFor(storageKey)
      const index = records.findIndex((entry) => entry.id === record.id)

      if (index < 0) throw new Error(`No record ${record.id}`)
      records[index] = JSON.parse(JSON.stringify(record))
    }
  }
}

/**
 * Builds a signed offline grant exactly like the built-in bootstrap endpoint does.
 * @param {object} args - Grant args.
 * @param {string} args.actorDeviceId - Device id.
 * @param {string} args.actorUserId - User id.
 * @param {string} args.grantId - Grant id.
 * @param {Date} [args.now] - Issue time.
 * @param {number} [args.ttlMs] - Grant TTL.
 * @returns {Promise<import("../../src/sync/offline-grant.js").SignedOfflineGrant>} - Signed grant.
 */
async function buildSignedGrant({actorDeviceId, actorUserId, grantId, now = NOW, ttlMs = 3600000}) {
  return await createOfflineGrantFromBootstrap({
    deviceId: actorDeviceId,
    grantId,
    grantTtlMs: ttlMs,
    now,
    resources: {Ticket: {conflictStrategy: "optimisticVersion", enabled: true, operations: ["create", "update"], policyHash: POLICY_HASH}},
    scopes: {workspaceId: "workspace-1"},
    signingKey: GRANT_SIGNING_KEY,
    userId: actorUserId
  })
}

/**
 * Builds an offline-capable sync client harness: fake Ticket model with
 * conflict tracking, a recording transport answering the built-in
 * bootstrap/replay paths, and an app-owned identity storage.
 * @param {object} [args] - Harness args.
 * @param {Awaited<ReturnType<typeof generateSyncSigningKeyPair>>} [args.backendKeys] - Reuse these backend keys (identity carried over from another harness).
 * @param {Record<string, ReturnType<typeof JSON.parse>> | null} [args.initialIdentity] - Identity pre-stored in the app-owned storage.
 * @param {ReturnType<typeof JSON.parse>} [args.offline] - Offline block override (falsy disables the offline block).
 * @param {Array<Record<string, ReturnType<typeof JSON.parse>>>} [args.replayResponses] - Queued signed-replay responses.
 * @param {boolean} [args.withGrantStorage] - Add a durable grant storage adapter.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} Harness with client, fixtures, and recorded calls.
 */
async function buildHarness({backendKeys: prebuiltBackendKeys, initialIdentity = null, offline, replayResponses = [], withGrantStorage = false} = {}) {
  const backendKeys = prebuiltBackendKeys || await generateSyncSigningKeyPair()

  /** @param {{publicKey: import("../../src/sync/device-identity.js").SyncJsonWebKey}} deviceKeys - Public key the framework session generated. @returns {Promise<ReturnType<typeof createDeviceCertificate>>} Backend-signed certificate for that key. */
  async function certificateFor(deviceKeys) {
    return await createDeviceCertificate({
      backendPrivateKey: backendKeys.privateKey,
      certificate: {
        actorDeviceId: "device-1",
        actorUserId: "user-1",
        certificateId: "cert-1",
        devicePublicKey: deviceKeys.publicKey,
        expiresAt: "2031-01-01T00:00:00.000Z",
        issuedAt: "2030-01-01T00:00:00.000Z"
      }
    })
  }
  const deviceKeys = await generateSyncSigningKeyPair()
  const certificate = await certificateFor(deviceKeys)
  const mutationLog = new LocalMutationLog({
    idGenerator: () => `log-${Math.random().toString(36).slice(2)}`,
    now: () => new Date(NOW),
    storage: buildMemoryStorage()
  })
  const harnessSequence = ++harnessSequenceCounter
  const state = {
    enrollCalls: /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ ([]),
    grantSequence: 0,
    identitySaved: /** @type {Record<string, ReturnType<typeof JSON.parse>> | null} */ (null),
    grantsSaved: /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ ([]),
    now: new Date(NOW),
    online: false,
    posts: /** @type {Array<{path: string, payload: Record<string, ReturnType<typeof JSON.parse>>}>} */ ([]),
    applied: /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ ([])
  }
  const identityStorage = {
    load: async () => initialIdentity === null && state.identitySaved === null ? null : (state.identitySaved || initialIdentity),
    save: async (identity) => {
      state.identitySaved = JSON.parse(JSON.stringify(identity))
    }
  }
  const grantStorage = withGrantStorage
    ? {
      load: async () => JSON.parse(JSON.stringify(state.grantsSaved)),
      save: async (grants) => {
        state.grantsSaved = JSON.parse(JSON.stringify(grants))
      }
    }
    : undefined
  const transport = {
    post: async (path, payload) => {
      state.posts.push({path, payload: JSON.parse(JSON.stringify(payload))})

      if (path === "/frontend-models/sync/bootstrap") {
        const grantId = `grant-${harnessSequence}-${++state.grantSequence}`
        const grant = await buildSignedGrant({actorDeviceId: "device-1", actorUserId: "user-1", grantId, now: state.now})

        return {
          json: () => ({
            offlineGrant: grant,
            status: "success",
            syncManifest: {Ticket: {conflictStrategy: "optimisticVersion", enabled: true, operations: ["create", "update"], policyHash: POLICY_HASH}}
          })
        }
      }

      if (path === "/frontend-models/sync/replay") {
        if (!Array.isArray(payload.mutations)) {
          // Legacy online replay payload: acknowledge each sync by its mutation id.
          return {
            json: () => ({
              status: "success",
              syncs: payload.syncs.map((sync) => ({id: sync.id, syncState: "successful"}))
            })
          }
        }

        const queued = replayResponses.shift()

        if (queued) return {json: () => queued}

        return {
          json: () => ({
            results: payload.mutations.map((mutation) => ({
              idempotencyKey: `${mutation.mutation.actorUserId}:${mutation.mutation.actorDeviceId}:${mutation.mutation.clientMutationId}`,
              status: "success"
            })),
            status: "success"
          })
        }
      }

      return {json: () => ({status: "success", syncs: []})}
    }
  }
  const ModelClass = buildMetadataModelClass({
    columns: [
      {attributeName: "id", name: "id", type: "uuid"},
      {attributeName: "title", name: "title", type: "varchar"},
      {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
    ],
    modelName: "Ticket",
    sync: {
      attributes: (/** @type {{data: Record<string, ReturnType<typeof JSON.parse>>}} */ {data}) => ({title: data.title, updatedAt: data.updatedAt}),
      conflictTracking: {
        clientMutationId: () => `mutation-${state.posts.length + 1}-${Math.random().toString(36).slice(2)}`,
        mutationLog,
        versionAttribute: "updatedAt"
      },
      findRecord: async (/** @type {{data: Record<string, ReturnType<typeof JSON.parse>>, resourceId: string}} */ {data, resourceId}) => {
        state.applied.push({data, resourceId})

        return {
          /** @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Applied attributes. @returns {void} */
          assign: (attributes) => {
            state.applied.at(-1).attributes = attributes
          },
          isChanged: () => true,
          save: async () => {}
        }
      },
      track: true
    }
  })
  const syncModel = buildFakeSyncModel()
  const offlineBlock = offline === undefined
    ? {
      backendPublicKey: backendKeys.publicKey,
      deviceIdentityStorage: identityStorage,
      enrollDevice: async ({publicKey}) => {
        state.enrollCalls.push({publicKey})

        return await certificateFor({publicKey})
      },
      grantScopes: () => ({workspaceId: "workspace-1"}),
      grantStorage,
      now: () => state.now
    }
    : offline
  const configuration = buildConfiguration({
    modelClasses: [ModelClass],
    sync: {client: {authenticationToken: () => "token-1", isOnline: () => state.online, offline: offlineBlock, transport}}
  })

  return {
    appliedRecords: state.applied,
    backendKeys,
    harnessSequence,
    certificate,
    client: new SyncClient({configuration, syncModel}),
    deviceKeys,
    identityStorage,
    mutationLog,
    state
  }
}

/** @returns {ReturnType<typeof JSON.parse>} Fake Ticket record. */
function ticketRecord(ModelClass) {
  return buildRecord(ModelClass, "ticket-1", {id: "ticket-1", title: "Offline title", updatedAt: new Date("2030-01-01T00:00:00.000Z")})
}

describe("sync client offline session", () => {
  it("generates, enrolls, and stores the device identity on first start and bootstraps the grant", async () => {
    const harness = await buildHarness()

    const summary = await harness.client.startOfflineSession()

    expect(harness.state.enrollCalls.length).toEqual(1)
    expect(harness.state.identitySaved).not.toEqual(null)
    expect(harness.state.identitySaved.privateKey.x).toEqual(harness.state.enrollCalls[0].publicKey.x)
    expect(harness.state.identitySaved.privateKey.y).toEqual(harness.state.enrollCalls[0].publicKey.y)
    expect(harness.state.identitySaved.certificate.certificate.actorDeviceId).toEqual("device-1")
    expect(summary.actorDeviceId).toEqual("device-1")
    expect(summary.actorUserId).toEqual("user-1")
    expect(summary.grantId).toEqual(`grant-${harness.harnessSequence}-1`)

    const bootstrapPost = harness.state.posts.find((post) => post.path === "/frontend-models/sync/bootstrap")

    expect(bootstrapPost).not.toEqual(undefined)
    expect(bootstrapPost.payload.authenticationToken).toEqual("token-1")
    expect(bootstrapPost.payload.deviceId).toEqual("device-1")
    expect(bootstrapPost.payload.scopes).toEqual({workspaceId: "workspace-1"})

    // A second start reuses the stored identity and live grant without re-enrolling.
    const second = await harness.client.startOfflineSession()

    expect(second.grantId).toEqual(`grant-${harness.harnessSequence}-1`)
    expect(harness.state.enrollCalls.length).toEqual(1)
    expect(harness.state.posts.filter((post) => post.path === "/frontend-models/sync/bootstrap").length).toEqual(1)
  })

  it("reuses a stored identity instead of re-enrolling", async () => {
    const first = await buildHarness()

    await first.client.startOfflineSession()

    const harness = await buildHarness({backendKeys: first.backendKeys, initialIdentity: first.state.identitySaved})
    const summary = await harness.client.startOfflineSession()

    expect(harness.state.enrollCalls.length).toEqual(0)
    expect(summary.actorDeviceId).toEqual("device-1")
  })

  it("signs tracked mutations at queue time with the session identity and grant", async () => {
    const harness = await buildHarness()

    await harness.client.startOfflineSession()

    const ModelClass = harness.client.config.resources.Ticket.modelClass
    const record = await harness.client.queue({baseVersion: "2030-01-01T00:00:00.000Z", data: {title: "Offline title"}, operation: "update", resource: ticketRecord(ModelClass)})

    expect(record.signedMutation).not.toEqual(undefined)
    expect(record.mutation.actorDeviceId).toEqual("device-1")
    expect(record.mutation.actorUserId).toEqual("user-1")
    expect(record.mutation.offlineGrantId).toEqual(`grant-${harness.harnessSequence}-1`)
    expect(record.mutation.policyHash).toEqual(POLICY_HASH)
    expect(record.signedMutation.signature).toMatch(/^ecdsa-p256-sha256-/)
    expect(record.signedMutation.deviceCertificate.certificate.certificateId).toEqual("cert-1")
  })

  it("queues offline under a retained grant without bootstrapping, then refreshes and re-signs pending records on replay", async () => {
    const harness = await buildHarness()

    await harness.client.startOfflineSession()

    const ModelClass = harness.client.config.resources.Ticket.modelClass
    const record = await harness.client.queue({baseVersion: "2030-01-01T00:00:00.000Z", data: {title: "Offline title"}, operation: "update", resource: ticketRecord(ModelClass)})

    expect(record.mutation.offlineGrantId).toEqual(`grant-${harness.harnessSequence}-1`)

    // The grant expires while the device stays offline.
    harness.state.now = new Date("2030-01-01T02:00:00.000Z")

    const result = await harness.client.replayOfflinePending()

    expect(result.syncedCount).toEqual(1)
    expect(result.results[0].status).toEqual("synced")

    const posts = harness.state.posts
    const bootstraps = posts.filter((post) => post.path === "/frontend-models/sync/bootstrap")
    const replays = posts.filter((post) => post.path === "/frontend-models/sync/replay")

    // Expired grant: replay refreshed it (second bootstrap) before posting.
    expect(bootstraps.length).toEqual(2)
    expect(replays.length).toEqual(1)

    // The replayed mutation travelled under the refreshed grant, re-signed.
    const mutation = replays[0].payload.mutations[0]

    expect(mutation.mutation.offlineGrantId).toEqual(`grant-${harness.harnessSequence}-2`)
    expect(mutation.signedOfflineGrant.grant.grantId).toEqual(`grant-${harness.harnessSequence}-2`)
    expect(mutation.mutation.clientMutationId).toEqual(record.mutation.clientMutationId)

    const records = await harness.mutationLog.records()

    expect(records[0].status).toEqual("synced")
    expect(records[0].mutation.offlineGrantId).toEqual(`grant-${harness.harnessSequence}-2`)
  })

  it("retains grants per grant id so a mutation always replays with the grant it was signed under", async () => {
    const harness = await buildHarness({withGrantStorage: true})

    await harness.client.startOfflineSession()

    const ModelClass = harness.client.config.resources.Ticket.modelClass
    const record = await harness.client.queue({baseVersion: "2030-01-01T00:00:00.000Z", data: {title: "Offline title"}, operation: "update", resource: ticketRecord(ModelClass)})

    expect(record.mutation.offlineGrantId).toEqual(`grant-${harness.harnessSequence}-1`)

    // Force a refresh while the old grant is still live: the pending record is
    // re-signed under the new grant, and both grants stay retained.
    await harness.client.refreshOfflineGrant()

    const records = await harness.mutationLog.records()

    expect(records[0].mutation.offlineGrantId).toEqual(`grant-${harness.harnessSequence}-2`)
    expect(harness.state.grantsSaved.map((grant) => grant.grant.grantId)).toEqual([`grant-${harness.harnessSequence}-1`, `grant-${harness.harnessSequence}-2`])

    const result = await harness.client.replayOfflinePending()

    expect(result.syncedCount).toEqual(1)
    expect(harness.state.posts.filter((post) => post.path === "/frontend-models/sync/replay")[0].payload.mutations[0].signedOfflineGrant.grant.grantId).toEqual(`grant-${harness.harnessSequence}-2`)
  })

  it("maps signed replay results onto log records as synced/conflict/rejected", async () => {
    const harness = await buildHarness()

    await harness.client.startOfflineSession()

    const ModelClass = harness.client.config.resources.Ticket.modelClass
    const first = await harness.client.queue({baseVersion: "v1", data: {title: "First"}, operation: "update", resource: buildRecord(ModelClass, "ticket-1", {id: "ticket-1", title: "First", updatedAt: new Date("2030-01-01T00:00:00.000Z")})})
    const second = await harness.client.queue({baseVersion: "v1", data: {title: "Second"}, operation: "update", resource: buildRecord(ModelClass, "ticket-2", {id: "ticket-2", title: "Second", updatedAt: new Date("2030-01-01T00:00:00.000Z")})})
    const third = await harness.client.queue({baseVersion: "v1", data: {title: "Third"}, operation: "update", resource: buildRecord(ModelClass, "ticket-3", {id: "ticket-3", title: "Third", updatedAt: new Date("2030-01-01T00:00:00.000Z")})})

    const conflict = {affectedFields: ["title"], baseVersion: "v1", serverModel: {title: "Server wins"}, serverVersion: "v2"}

    await harness.client.replayOfflinePending({batchSize: 10})

    // Responses were queued before queueing, so inject via a fresh harness
    // response path instead: verify the default mapping first.
    expect(first).not.toEqual(null)
    expect((await harness.mutationLog.records()).every((record) => record.status === "synced")).toBe(true)

    // Now a conflict + rejection mapping pass with queued responses.
    const conflictHarness = await buildHarness({replayResponses: [{
      results: [
        {conflict, idempotencyKey: "user-1:device-1:m-a", response: {conflict, status: "success"}, status: "success", syncState: "conflict"},
        {idempotencyKey: "user-1:device-1:m-b", response: {status: "error"}, status: "error", syncState: "rejected"}
      ],
      status: "success"
    }]})

    await conflictHarness.client.startOfflineSession()

    // Seed the log with signed records directly so the ids are deterministic.
    const signedA = await conflictHarness.client.offlineSession().signMutation({
      attributes: {title: "Local"},
      baseVersion: "v1",
      clientMutationId: "m-a",
      model: "Ticket",
      occurredAt: "2030-01-01T00:00:00.000Z",
      operation: "update",
      payload: {resourceId: "ticket-1", syncType: "update"}
    })
    const signedB = await conflictHarness.client.offlineSession().signMutation({
      attributes: {title: "Local"},
      baseVersion: "v1",
      clientMutationId: "m-b",
      model: "Ticket",
      occurredAt: "2030-01-01T00:00:01.000Z",
      operation: "update",
      payload: {resourceId: "ticket-2", syncType: "update"}
    })

    await conflictHarness.mutationLog.append({mutation: signedA.mutation, signedMutation: signedA})
    await conflictHarness.mutationLog.append({mutation: signedB.mutation, signedMutation: signedB})

    const result = await conflictHarness.client.replayOfflinePending()

    expect(result.conflictCount).toEqual(1)
    expect(result.rejectedCount).toEqual(1)
    expect(result.syncedCount).toEqual(0)
    expect(result.pendingCount).toEqual(0)

    const records = await conflictHarness.mutationLog.records()

    expect(records[0].status).toEqual("conflict")
    expect(records[0].syncResult.conflict).toEqual(conflict)
    expect(records[1].status).toEqual("rejected")

    // The structured conflict stays reachable through the conflict contract.
    const resolved = await conflictHarness.client.resolveConflict({recordId: records[0].id, resolution: "keep-server", resourceType: "Ticket"})

    expect(resolved.status).toEqual("synced")

    void second
    void third
  })

  it("fails closed when a pending record's grant is not retained and keeps it pending", async () => {
    const harness = await buildHarness()

    await harness.client.startOfflineSession()

    const signed = await harness.client.offlineSession().signMutation({
      attributes: {title: "Local"},
      baseVersion: "v1",
      clientMutationId: "m-foreign",
      model: "Ticket",
      occurredAt: "2030-01-01T00:00:00.000Z",
      operation: "update",
      payload: {resourceId: "ticket-1", syncType: "update"}
    })

    await harness.mutationLog.append({mutation: signed.mutation, signedMutation: signed})

    // Replace the session's retained grants by restarting with a fresh client
    // whose storage has no grant storage: the old grant is gone.
    const freshHarness = await buildHarness({backendKeys: harness.backendKeys, initialIdentity: harness.state.identitySaved})

    await freshHarness.client.startOfflineSession()

    // Seed the fresh log with the foreign-grant record.
    await freshHarness.mutationLog.append({mutation: signed.mutation, signedMutation: signed})

    const result = await freshHarness.client.replayOfflinePending()

    expect(result.syncedCount).toEqual(0)
    expect(result.pendingCount).toEqual(1)
    expect((await freshHarness.mutationLog.records())[0].status).toEqual("pending")
  })

  it("exports and imports signed peer bundles with dedupe and backend-key rejection", async () => {
    const source = await buildHarness()

    await source.client.startOfflineSession()

    const ModelClass = source.client.config.resources.Ticket.modelClass
    const queued = await source.client.queue({baseVersion: "v1", data: {title: "Peer title"}, operation: "update", resource: ticketRecord(ModelClass)})

    await source.client.waitForScheduledReplay()

    const bundle = await source.client.exportPeerBundle()

    expect(bundle.mutations.length).toEqual(1)
    expect(bundle.mutations[0].signedMutation.mutation.clientMutationId).toEqual(queued.mutation.clientMutationId)

    // The target verifies peer certificates against its configured backend
    // public key, so it shares the source's backend keys for the accepted case.
    const target = await buildHarness({backendKeys: source.backendKeys})

    const importResult = await target.client.importPeerBundle({
      bundle,
      signedOfflineGrants: [await buildSignedGrant({actorDeviceId: "device-1", actorUserId: "user-1", grantId: `grant-${source.harnessSequence}-1`})]
    })

    expect(importResult.imported.length).toEqual(1)
    expect(importResult.rejected.length).toEqual(0)

    // Importing the same bundle again skips by idempotency key.
    const secondImport = await target.client.importPeerBundle({bundle})

    expect(secondImport.imported.length).toEqual(0)
    expect(secondImport.skipped.length).toEqual(1)
    expect(secondImport.skipped[0].reason).toEqual("duplicate")

    // A bundle signed by a foreign backend is rejected entry-by-entry.
    const foreign = await generateSyncSigningKeyPair()
    const foreignCertificate = await createDeviceCertificate({
      backendPrivateKey: foreign.privateKey,
      certificate: {
        actorDeviceId: "device-x",
        actorUserId: "user-x",
        certificateId: "cert-x",
        devicePublicKey: (await generateSyncSigningKeyPair()).publicKey,
        expiresAt: "2031-01-01T00:00:00.000Z",
        issuedAt: "2030-01-01T00:00:00.000Z"
      }
    })
    const foreignLog = new LocalMutationLog({storage: buildMemoryStorage()})
    const foreignSigned = await (await import("../../src/sync/device-identity.js")).createSignedMutation({
      deviceCertificate: foreignCertificate,
      devicePrivateKey: foreign.privateKey,
      mutation: {
        actorDeviceId: "device-x",
        actorUserId: "user-x",
        attributes: {title: "Foreign"},
        clientMutationId: "m-foreign",
        model: "Ticket",
        occurredAt: "2030-01-01T00:00:00.000Z",
        offlineGrantId: "grant-x",
        operation: "update",
        policyHash: POLICY_HASH
      }
    })

    await foreignLog.append({mutation: foreignSigned.mutation, signedMutation: foreignSigned})

    const foreignBundle = await (await import("../../src/sync/peer-mutation-bundle.js")).exportPeerMutationBundle({
      deviceCertificate: foreignCertificate,
      devicePrivateKey: foreign.privateKey,
      mutationLog: foreignLog
    })
    const rejectedImport = await target.client.importPeerBundle({bundle: foreignBundle})

    expect(rejectedImport.imported.length).toEqual(0)
    expect(rejectedImport.rejected.length).toEqual(1)
  })

  it("rejects queue-time signing when the session manifest has no policy hash for the model", async () => {
    const harness = await buildHarness()

    await harness.client.startOfflineSession()

    await expect(async () => await harness.client.offlineSession().signMutation({
      clientMutationId: "m-x",
      model: "UnknownModel",
      occurredAt: "2030-01-01T00:00:00.000Z",
      operation: "update"
    })).toThrow(/no policy hash for model 'UnknownModel'/u)
  })

  it("keeps static conflictTracking declarations working without an offline block", async () => {
    const mutationLog = new LocalMutationLog({storage: buildMemoryStorage()})
    const ModelClass = buildMetadataModelClass({
      columns: [
        {attributeName: "id", name: "id", type: "uuid"},
        {attributeName: "title", name: "title", type: "varchar"},
        {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
      ],
      modelName: "Ticket",
      sync: {
        conflictTracking: {
          actorDeviceId: "device-static",
          actorUserId: "user-static",
          clientMutationId: () => "mutation-static",
          mutationLog,
          offlineGrantId: "grant-static",
          policyHash: "policy-static",
          versionAttribute: "updatedAt"
        },
        track: true
      }
    })
    const posts = []
    const transport = {post: async (_path, payload) => ({json: () => ({status: "success", syncs: payload.syncs.map((sync) => ({id: sync.id, syncState: "successful"}))})})}
    const configuration = buildConfiguration({modelClasses: [ModelClass], sync: {client: {authenticationToken: () => "token-1", transport}}})
    const client = new SyncClient({configuration, syncModel: buildFakeSyncModel()})

    const record = await client.queue({baseVersion: "v1", data: {title: "Static"}, operation: "update", resource: buildRecord(ModelClass, "ticket-1", {id: "ticket-1", title: "Static", updatedAt: new Date("2030-01-01T00:00:00.000Z")})})

    expect(record.mutation.actorDeviceId).toEqual("device-static")
    expect(record.mutation.offlineGrantId).toEqual("grant-static")
    expect(record.signedMutation).toEqual(undefined)
    expect(posts.length).toEqual(0)
  })

  it("accepts function-resolved conflictTracking identity metadata", async () => {
    const mutationLog = new LocalMutationLog({storage: buildMemoryStorage()})
    let grant = "grant-runtime-1"
    const ModelClass = buildMetadataModelClass({
      columns: [
        {attributeName: "id", name: "id", type: "uuid"},
        {attributeName: "title", name: "title", type: "varchar"},
        {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
      ],
      modelName: "Ticket",
      sync: {
        conflictTracking: {
          actorDeviceId: () => "device-runtime",
          actorUserId: async () => "user-runtime",
          clientMutationId: () => "mutation-runtime",
          mutationLog,
          offlineGrantId: () => grant,
          policyHash: () => "policy-runtime",
          versionAttribute: "updatedAt"
        },
        track: true
      }
    })
    const transport = {post: async (_path, payload) => ({json: () => ({status: "success", syncs: payload.syncs.map((sync) => ({id: sync.id, syncState: "successful"}))})})}
    const configuration = buildConfiguration({modelClasses: [ModelClass], sync: {client: {authenticationToken: () => "token-1", transport}}})
    const client = new SyncClient({configuration, syncModel: buildFakeSyncModel()})

    const record = await client.queue({baseVersion: "v1", data: {title: "Runtime"}, operation: "update", resource: buildRecord(ModelClass, "ticket-1", {id: "ticket-1", title: "Runtime", updatedAt: new Date("2030-01-01T00:00:00.000Z")})})

    expect(record.mutation.actorDeviceId).toEqual("device-runtime")
    expect(record.mutation.actorUserId).toEqual("user-runtime")
    expect(record.mutation.offlineGrantId).toEqual("grant-runtime-1")

    grant = "grant-runtime-2"

    const second = await client.queue({baseVersion: "v1", data: {title: "Runtime 2"}, operation: "update", resource: buildRecord(ModelClass, "ticket-2", {id: "ticket-2", title: "Runtime 2", updatedAt: new Date("2030-01-01T00:00:00.000Z")})})

    expect(second.mutation.offlineGrantId).toEqual("grant-runtime-2")
  })

  it("rejects a conflictTracking declaration that omits rotating identity without an offline block", async () => {
    const mutationLog = new LocalMutationLog({storage: buildMemoryStorage()})
    const ModelClass = buildMetadataModelClass({
      columns: [
        {attributeName: "id", name: "id", type: "uuid"},
        {attributeName: "title", name: "title", type: "varchar"},
        {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
      ],
      modelName: "Ticket",
      sync: {
        conflictTracking: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          clientMutationId: () => "mutation-1",
          mutationLog,
          versionAttribute: "updatedAt"
        },
        track: true
      }
    })
    const transport = {post: async () => ({json: () => ({status: "success", syncs: []})})}
    const configuration = buildConfiguration({modelClasses: [ModelClass], sync: {client: {authenticationToken: () => "token-1", transport}}})

    expect(() => new SyncClient({configuration, syncModel: buildFakeSyncModel()})).toThrow(/conflictTracking.offlineGrantId must be a non-empty string/u)
  })

  it("stops the offline session without losing durable state", async () => {
    const harness = await buildHarness()

    await harness.client.startOfflineSession()

    const ModelClass = harness.client.config.resources.Ticket.modelClass

    await harness.client.queue({baseVersion: "v1", data: {title: "Pending"}, operation: "update", resource: ticketRecord(ModelClass)})

    await harness.client.stopOfflineSession()

    expect((await harness.mutationLog.pendingRecords()).length).toEqual(1)
    expect(harness.state.identitySaved).not.toEqual(null)

    // Restarting resumes from the stored identity and replays the pending intent.
    const result = await harness.client.replayOfflinePending()

    expect(result.syncedCount).toEqual(1)
  })
})
