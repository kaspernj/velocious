// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SignedSyncEnvelopeReplayService from "../../src/sync/signed-sync-envelope-replay-service.js"
import Task from "../dummy/src/models/task.js"
import TaskBoard from "../dummy/src/models/task-board.js"
import TaskBoardCard from "../dummy/src/models/task-board-card.js"
import {generateSyncSigningKeyPair} from "../../src/sync/device-identity.js"
import {
  buildOfflineGrantAbilityFactory,
  buildSignedReplayFixtures,
  dummySyncManifest,
  signFixtureMutation
} from "../helpers/signed-sync-replay-helper.js"

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
      resources: {Task: {enabled: true, operations: ["update"], policyHash: dummySyncManifest().Task.policyHash}},
      scopes: {projectId: project.id()}
    })
    const signedMutation = await signFixtureMutation({
      fixtures,
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
        policyHash: dummySyncManifest().Task.policyHash
      }
    })
    const service = new SignedSyncEnvelopeReplayService({
      abilityFactory: buildOfflineGrantAbilityFactory(),
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
      resources: {Task: {enabled: true, operations: ["update"], policyHash: dummySyncManifest().Task.policyHash}},
      scopes: {projectId: project.id()}
    })
    const signedMutation = await signFixtureMutation({
      fixtures,
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
        policyHash: dummySyncManifest().Task.policyHash
      }
    })
    const service = new SignedSyncEnvelopeReplayService({
      abilityFactory: buildOfflineGrantAbilityFactory(),
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
      resources: {TaskBoard: {enabled: true, operations: ["moveCard"], policyHash: dummySyncManifest().TaskBoard.policyHash}},
      scopes: {projectId: project.id()}
    })
    const signedMutation = await signFixtureMutation({
      fixtures,
      mutation: {
        actorDeviceId: "peer-device",
        actorUserId: "peer-user",
        clientMutationId: "peer-move-1",
        model: "TaskBoard",
        occurredAt: "2026-08-01T01:00:00.000Z",
        offlineGrantId: "grant-peer",
        operation: "moveCard",
        payload: {id: String(board.id()), targetColumnId: "done", taskId: String(task.id())},
        policyHash: dummySyncManifest().TaskBoard.policyHash
      }
    })
    const service = new SignedSyncEnvelopeReplayService({
      abilityFactory: buildOfflineGrantAbilityFactory(),
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
      resources: {Task: {enabled: true, operations: ["update"], policyHash: dummySyncManifest().Task.policyHash}},
      scopes: {projectId: project.id()}
    })
    const signedMutation = await signFixtureMutation({
      fixtures,
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
        policyHash: dummySyncManifest().Task.policyHash
      }
    })
    const service = new SignedSyncEnvelopeReplayService({
      abilityFactory: buildOfflineGrantAbilityFactory(),
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

  it("keeps concurrent replays on one service from crossing actors or grants", async () => {
    const grantNow = new Date("2026-08-03T00:00:00.000Z")

    /**
     * Builds one actor's fixtures and signed Task mutation.
     * @param {string} userId - Actor user id.
     * @param {string} deviceId - Actor device id.
     * @param {string} mutationId - Client mutation id.
     * @param {string} probeTaskId - Target task id carried in the payload.
     * @returns {Promise<Record<string, ?>>} Fixtures plus signed mutation.
     */
    async function buildActorMutation(userId, deviceId, mutationId, probeTaskId) {
      const fixtures = await buildSignedReplayFixtures({
        actorDeviceId: deviceId,
        actorUserId: userId,
        backendKeys: sharedBackendKeys,
        grantId: `grant-${userId}`,
        grantNow,
        resources: {Task: {enabled: true, operations: ["update"], policyHash: dummySyncManifest().Task.policyHash}},
        scopes: {projectId: `project-of-${userId}`},
        signingKey: sharedSigningKey
      })
      const signedMutation = await signFixtureMutation({
        fixtures,
        mutation: {
          actorDeviceId: deviceId,
          actorUserId: userId,
          attributes: {},
          clientMutationId: mutationId,
          model: "Task",
          occurredAt: "2026-08-01T01:00:00.000Z",
          offlineGrantId: `grant-${userId}`,
          operation: "update",
          payload: {id: probeTaskId},
          policyHash: dummySyncManifest().Task.policyHash
        }
      })

      return {fixtures, signedMutation}
    }

    const sharedBackendKeys = await generateSyncSigningKeyPair()
    const sharedSigningKey = {current: true, id: "shared-key-1", secret: "shared-super-secret-key"}
    const actorA = await buildActorMutation("user-a", "device-a", "mutation-a", "task-a")
    const actorB = await buildActorMutation("user-b", "device-b", "mutation-b", "task-b")

    /** @type {Array<{actorId: ?, grantUserId: ?, grantScopes: ?}>} */
    const observed = []

    const service = new SignedSyncEnvelopeReplayService({
      actorLookup: async (userId) => ({id: () => `actor-${userId}`}),
      applyHandlers: {
        Task: async ({actor, context}) => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          observed.push({
            actorId: actor.id(),
            grantScopes: context.offlineGrant?.scopes,
            grantUserId: context.offlineGrant?.userId
          })

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

    const observedByActor = Object.fromEntries(observed.map((entry) => [entry.actorId, entry]))

    expect(Object.keys(observedByActor).sort()).toEqual(["actor-user-a", "actor-user-b"])
    expect(observedByActor["actor-user-a"].grantUserId).toEqual("user-a")
    expect(observedByActor["actor-user-a"].grantScopes).toEqual({projectId: "project-of-user-a"})
    expect(observedByActor["actor-user-b"].grantUserId).toEqual("user-b")
    expect(observedByActor["actor-user-b"].grantScopes).toEqual({projectId: "project-of-user-b"})
  })
})
