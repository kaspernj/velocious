// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SignedSyncEnvelopeReplayService from "../../src/sync/signed-sync-envelope-replay-service.js"
import Task from "../dummy/src/models/task.js"
import TaskBoard from "../dummy/src/models/task-board.js"
import TaskBoardCard from "../dummy/src/models/task-board-card.js"
import {
  createDeviceCertificate,
  createSignedMutation,
  generateSyncSigningKeyPair
} from "../../src/sync/device-identity.js"
import {createOfflineGrantFromBootstrap} from "../../src/sync/offline-grant.js"

/**
 * Builds the test keys, certificate, and grant fixtures for signed replay specs.
 * @param {object} args - Fixture args.
 * @param {string} args.actorDeviceId - Device id.
 * @param {string} args.actorUserId - User id.
 * @param {string} args.grantId - Grant id.
 * @param {Date} args.grantNow - Grant issue time.
 * @param {number} [args.grantTtlMs] - Grant TTL.
 * @param {Record<string, ?>} args.resources - Grant resource manifest.
 * @param {import("../../src/sync/device-identity.js").SyncJsonWebKey} [args.backendKeys] - Optional shared backend key pair; generated when omitted.
 * @param {import("../../src/sync/offline-grant.js").OfflineGrantSigningKey} [args.signingKey] - Optional shared offline-grant signing key; defaults to a literal test key.
 * @returns {Promise<Record<string, ?>>} Fixture bundle.
 */
async function buildSignedReplayFixtures({actorDeviceId, actorUserId, grantId, grantNow, grantTtlMs = 24 * 60 * 60 * 1000, resources, backendKeys, signingKey}) {
  const resolvedBackendKeys = backendKeys || await generateSyncSigningKeyPair()
  const deviceKeys = await generateSyncSigningKeyPair()
  const deviceCertificate = await createDeviceCertificate({
    backendPrivateKey: resolvedBackendKeys.privateKey,
    certificate: {
      actorDeviceId,
      actorUserId,
      certificateId: "cert-1",
      devicePublicKey: deviceKeys.publicKey,
      expiresAt: "2027-01-01T00:00:00.000Z",
      issuedAt: "2026-08-01T00:00:00.000Z"
    }
  })
  const resolvedSigningKey = signingKey || {current: true, id: "key-1", secret: "super-secret-key"}
  const signedOfflineGrant = await createOfflineGrantFromBootstrap({
    deviceId: actorDeviceId,
    grantId,
    grantTtlMs,
    now: grantNow,
    resources,
    scopes: {projectId: "project-1"},
    signingKey: resolvedSigningKey,
    userId: actorUserId
  })

  return {backendKeys: resolvedBackendKeys, deviceCertificate, deviceKeys, signingKey: resolvedSigningKey, signedOfflineGrant}
}

describe("AwesomeTasks signed offline and peer-forwarded sync", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("replays a long-offline signed Task update after verifying device certificate and grant", async () => {
    const project = await Project.create({name: "Signed sync project"})
    const task = await Task.create({name: "Signed task", projectId: project.id()})
    const grantNow = new Date("2026-08-03T00:00:00.000Z")
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-1",
      grantNow,
      resources: {Task: ["update"]}
    })
    const signedMutation = await createSignedMutation({
      deviceCertificate: fixtures.deviceCertificate,
      devicePrivateKey: fixtures.deviceKeys.privateKey,
      mutation: {
        actorDeviceId: "device-a",
        actorUserId: "user-1",
        attributes: {name: "Updated by signed mutation"},
        baseVersion: "server-1",
        clientMutationId: "mutation-1",
        model: "Task",
        occurredAt: "2026-08-01T01:00:00.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        payload: {id: String(task.id())},
        policyHash: "sha256-policy"
      }
    })
    const service = new SignedSyncEnvelopeReplayService({
      backendPublicKey: fixtures.backendKeys.publicKey,
      configuration: dummyConfiguration,
      offlineGrantSigningKeys: [fixtures.signingKey],
      syncModel: SyncEntry
    })

    const result = await service.replay({
      signedMutations: [{signedMutation, signedOfflineGrant: fixtures.signedOfflineGrant}]
    })

    expect(result).toEqual({syncs: [{idempotencyKey: "user-1:device-a:mutation-1", syncState: "successful"}]})

    const updatedTask = await Task.findByOrFail({id: task.id()})

    expect(updatedTask.name()).toEqual("Updated by signed mutation")

    const syncEntry = await SyncEntry.findBy({resourceId: String(task.id()), resourceType: "Task"})

    expect(syncEntry).not.toEqual(null)
    expect(syncEntry.authenticationTokenId()).toEqual("user-1")
  })

  it("rejects replay when the offline grant has expired", async () => {
    const project = await Project.create({name: "Expired grant project"})
    const task = await Task.create({name: "Expired task", projectId: project.id()})
    const grantNow = new Date("2026-08-01T00:00:00.000Z")
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-expired",
      grantNow,
      grantTtlMs: 1000,
      resources: {Task: ["update"]}
    })
    const signedMutation = await createSignedMutation({
      deviceCertificate: fixtures.deviceCertificate,
      devicePrivateKey: fixtures.deviceKeys.privateKey,
      mutation: {
        actorDeviceId: "device-a",
        actorUserId: "user-1",
        attributes: {name: "Should not apply"},
        clientMutationId: "mutation-expired",
        model: "Task",
        occurredAt: "2026-08-01T00:00:01.000Z",
        offlineGrantId: "grant-expired",
        operation: "update",
        payload: {id: String(task.id())},
        policyHash: "sha256-policy"
      }
    })
    const service = new SignedSyncEnvelopeReplayService({
      backendPublicKey: fixtures.backendKeys.publicKey,
      configuration: dummyConfiguration,
      offlineGrantSigningKeys: [fixtures.signingKey],
      syncModel: SyncEntry
    })

    await expect(async () => {
      await service.replay({
        signedMutations: [{signedMutation, signedOfflineGrant: fixtures.signedOfflineGrant}]
      })
    }).toThrow("Offline grant expired")

    const unchangedTask = await Task.findByOrFail({id: task.id()})

    expect(unchangedTask.name()).toEqual("Expired task")
  })

  it("replays a peer-forwarded signed TaskBoard.moveCard under the original actor", async () => {
    const project = await Project.create({name: "Peer board project"})
    const board = await TaskBoard.create({name: "Peer board", projectId: project.id()})
    const task = await Task.create({name: "Peer task", projectId: project.id()})

    await TaskBoardCard.create({taskBoardId: board.id(), taskId: task.id(), boardColumnId: "todo", position: 1})

    const grantNow = new Date("2026-08-03T00:00:00.000Z")
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "peer-device",
      actorUserId: "peer-user",
      grantId: "grant-peer",
      grantNow,
      resources: {TaskBoard: ["moveCard"]}
    })
    const signedMutation = await createSignedMutation({
      deviceCertificate: fixtures.deviceCertificate,
      devicePrivateKey: fixtures.deviceKeys.privateKey,
      mutation: {
        actorDeviceId: "peer-device",
        actorUserId: "peer-user",
        clientMutationId: "peer-move-1",
        model: "TaskBoard",
        occurredAt: "2026-08-01T01:00:00.000Z",
        offlineGrantId: "grant-peer",
        operation: "moveCard",
        payload: {id: String(board.id()), targetColumnId: "done", taskId: String(task.id())},
        policyHash: "sha256-policy"
      }
    })
    const service = new SignedSyncEnvelopeReplayService({
      backendPublicKey: fixtures.backendKeys.publicKey,
      configuration: dummyConfiguration,
      offlineGrantSigningKeys: [fixtures.signingKey],
      syncModel: SyncEntry
    })

    const result = await service.replay({
      signedMutations: [{signedMutation, signedOfflineGrant: fixtures.signedOfflineGrant}]
    })

    expect(result).toEqual({syncs: [{idempotencyKey: "peer-user:peer-device:peer-move-1", syncState: "successful"}]})

    const movedCard = await TaskBoardCard.findByOrFail({taskBoardId: board.id(), taskId: task.id()})

    expect(movedCard.boardColumnId()).toEqual("done")
    expect(Number(movedCard.position())).toEqual(1)

    const syncEntry = await SyncEntry.findBy({resourceId: String(board.id()), resourceType: "TaskBoard"})

    expect(syncEntry).not.toEqual(null)
    expect(syncEntry.authenticationTokenId()).toEqual("peer-user")
  })

  it("fails closed when actorLookup returns null", async () => {
    const project = await Project.create({name: "Missing actor project"})
    const task = await Task.create({name: "Missing actor task", projectId: project.id()})
    const grantNow = new Date("2026-08-03T00:00:00.000Z")
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "unknown-user",
      grantId: "grant-missing-actor",
      grantNow,
      resources: {Task: ["update"]}
    })
    const signedMutation = await createSignedMutation({
      deviceCertificate: fixtures.deviceCertificate,
      devicePrivateKey: fixtures.deviceKeys.privateKey,
      mutation: {
        actorDeviceId: "device-a",
        actorUserId: "unknown-user",
        attributes: {name: "Should not apply"},
        clientMutationId: "mutation-missing-actor",
        model: "Task",
        occurredAt: "2026-08-01T01:00:00.000Z",
        offlineGrantId: "grant-missing-actor",
        operation: "update",
        payload: {id: String(task.id())},
        policyHash: "sha256-policy"
      }
    })
    const service = new SignedSyncEnvelopeReplayService({
      actorLookup: async () => null,
      backendPublicKey: fixtures.backendKeys.publicKey,
      configuration: dummyConfiguration,
      offlineGrantSigningKeys: [fixtures.signingKey],
      syncModel: SyncEntry
    })

    await expect(async () => {
      await service.replay({
        signedMutations: [{signedMutation, signedOfflineGrant: fixtures.signedOfflineGrant}]
      })
    }).toThrow(/Signed replay actor not found/)

    const unchangedTask = await Task.findByOrFail({id: task.id()})

    expect(unchangedTask.name()).toEqual("Missing actor task")
  })

  it("keeps concurrent replays on one service from crossing actors", async () => {
    const grantNow = new Date("2026-08-03T00:00:00.000Z")

    /**
     * Builds one actor's fixtures and signed mutation for a no-DB probe resource.
     * @param {string} userId - Actor user id.
     * @param {string} deviceId - Actor device id.
     * @param {string} mutationId - Client mutation id.
     * @param {string} probeId - Probe resource id.
     * @returns {Promise<Record<string, ?>>} Fixtures plus signed mutation.
     */
    async function buildActorMutation(userId, deviceId, mutationId, probeId) {
      const fixtures = await buildSignedReplayFixtures({
        actorDeviceId: deviceId,
        actorUserId: userId,
        backendKeys: sharedBackendKeys,
        grantId: `grant-${userId}`,
        grantNow,
        resources: {ActorProbe: ["update"]},
        signingKey: sharedSigningKey
      })
      const signedMutation = await createSignedMutation({
        deviceCertificate: fixtures.deviceCertificate,
        devicePrivateKey: fixtures.deviceKeys.privateKey,
        mutation: {
          actorDeviceId: deviceId,
          actorUserId: userId,
          attributes: {},
          clientMutationId: mutationId,
          model: "ActorProbe",
          occurredAt: "2026-08-01T01:00:00.000Z",
          offlineGrantId: `grant-${userId}`,
          operation: "update",
          payload: {id: probeId},
          policyHash: "sha256-policy"
        }
      })

      return {fixtures, signedMutation}
    }

    const sharedBackendKeys = await generateSyncSigningKeyPair()
    const sharedSigningKey = {current: true, id: "shared-key-1", secret: "shared-super-secret-key"}
    const actorA = await buildActorMutation("user-a", "device-a", "mutation-a", "probe-a")
    const actorB = await buildActorMutation("user-b", "device-b", "mutation-b", "probe-b")

    /** @type {string[]} */
    const observedActors = []

    const service = new SignedSyncEnvelopeReplayService({
      actorLookup: async (userId) => ({id: () => `actor-${userId}`}),
      applyHandlers: {
        ActorProbe: async ({actor}) => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          observedActors.push(actor.id())

          return {actorId: actor.id()}
        }
      },
      backendPublicKey: sharedBackendKeys.publicKey,
      configuration: dummyConfiguration,
      offlineGrantSigningKeys: [sharedSigningKey]
    })

    const [resultA, resultB] = await Promise.all([
      service.replay({signedMutations: [{signedMutation: actorA.signedMutation, signedOfflineGrant: actorA.fixtures.signedOfflineGrant}]}),
      service.replay({signedMutations: [{signedMutation: actorB.signedMutation, signedOfflineGrant: actorB.fixtures.signedOfflineGrant}]})
    ])

    expect(resultA).toEqual({syncs: [{idempotencyKey: "user-a:device-a:mutation-a", syncState: "successful"}]})
    expect(resultB).toEqual({syncs: [{idempotencyKey: "user-b:device-b:mutation-b", syncState: "successful"}]})

    expect(observedActors.sort()).toEqual(["actor-user-a", "actor-user-b"])
  })
})
