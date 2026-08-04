// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import SignedSyncEnvelopeReplayService from "../../src/sync/signed-sync-envelope-replay-service.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import Task from "../dummy/src/models/task.js"
import {exportPeerMutationBundle, importPeerMutationBundle} from "../../src/sync/peer-mutation-bundle.js"
import LocalMutationLog from "../../src/sync/local-mutation-log.js"
import {generateSyncSigningKeyPair} from "../../src/sync/device-identity.js"
import {
  buildOfflineGrantAbilityFactory,
  buildSignedReplayFixtures,
  dummySyncManifest,
  signFixtureMutation
} from "../helpers/signed-sync-replay-helper.js"

const GRANT_NOW = new Date("2030-01-01T00:00:00.000Z")

/**
 * Builds an in-memory storage adapter for a LocalMutationLog.
 * @returns {import("../../src/sync/local-mutation-log.js").LocalMutationLogStorage} Storage adapter.
 */
function buildMemoryStorage() {
  const recordsByKey = new Map()

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

  function recordsFor(storageKey) {
    if (!recordsByKey.has(storageKey)) recordsByKey.set(storageKey, [])

    return recordsByKey.get(storageKey)
  }
}

/**
 * Builds a local mutation log with deterministic ids.
 * @param {string} prefix - Id prefix.
 * @returns {LocalMutationLog} Mutation log.
 */
function buildDeviceMutationLog(prefix) {
  let sequence = 0

  return new LocalMutationLog({
    idGenerator: () => `${prefix}-${++sequence}`,
    now: () => GRANT_NOW,
    storage: buildMemoryStorage()
  })
}

/**
 * Builds fixtures for a device scoped to a project.
 * @param {object} args - Fixture args.
 * @param {string} args.actorDeviceId - Device id.
 * @param {string} args.actorUserId - User id.
 * @param {Record<string, ?>} [args.backendKeys] - Shared backend key pair.
 * @param {string} args.grantId - Grant id.
 * @param {?} args.projectId - Project scope.
 * @param {Record<string, ?>} [args.signingKey] - Shared offline-grant signing key.
 * @returns {Promise<Record<string, ?>>} Fixture bundle.
 */
async function buildDeviceFixtures({actorDeviceId, actorUserId, backendKeys, grantId, projectId, signingKey}) {
  return await buildSignedReplayFixtures({
    actorDeviceId,
    actorUserId,
    backendKeys,
    grantId,
    grantNow: GRANT_NOW,
    resources: {Task: {enabled: true, operations: ["update"], policyHash: dummySyncManifest().Task.policyHash}},
    scopes: {projectId},
    signingKey
  })
}

/**
 * Builds a Task update mutation payload.
 * @param {object} args - Mutation args.
 * @param {string} args.actorDeviceId - Device id.
 * @param {string} args.actorUserId - User id.
 * @param {Record<string, ?>} args.attributes - Update attributes.
 * @param {string} args.baseVersion - Base version.
 * @param {string} args.clientMutationId - Client mutation id.
 * @param {string} args.grantId - Grant id.
 * @param {number} args.taskId - Task id.
 * @returns {import("../../src/sync/device-identity.js").SyncMutation} Mutation payload.
 */
function buildTaskUpdateMutation({actorDeviceId, actorUserId, attributes, baseVersion, clientMutationId, grantId, taskId}) {
  return {
    actorDeviceId,
    actorUserId,
    attributes,
    baseVersion,
    clientMutationId,
    model: "Task",
    occurredAt: "2026-08-01T01:00:00.000Z",
    offlineGrantId: grantId,
    operation: "update",
    payload: {id: String(taskId)},
    policyHash: dummySyncManifest().Task.policyHash
  }
}

/**
 * Replays signed mutations through the backend replay service.
 * @param {object} args - Replay args.
 * @param {{strategy?: string, versionAttribute: string} | null} [args.conflictStrategy] - Optional base-version conflict strategy.
 * @param {Record<string, ?>} args.fixtures - Backend fixtures.
 * @param {Array<{signedMutation: Record<string, ?>, signedOfflineGrant: Record<string, ?>}>} args.signedMutations - Signed mutations.
 * @returns {Promise<Record<string, ?>>} Replay result.
 */
async function replaySignedMutations({conflictStrategy = null, fixtures, signedMutations}) {
  const service = new SignedSyncEnvelopeReplayService({
    abilityFactory: buildOfflineGrantAbilityFactory(),
    backendPublicKey: fixtures.backendKeys.publicKey,
    configuration: dummyConfiguration,
    conflictStrategy,
    offlineGrantSigningKeys: [fixtures.signingKey],
    syncModel: SyncEntry
  })

  return await service.replay({signedMutations})
}

describe("AwesomeTasks offline peer sync end-to-end", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("two devices exchange a signed peer bundle, the importer forwards the signed mutation to the backend, and state converges", async () => {
    const project = await Project.create({name: "Peer sync project"})
    const task = await Task.create({name: "Original task", projectId: project.id()})
    const deviceAFixtures = await buildDeviceFixtures({actorDeviceId: "device-a", actorUserId: "user-1", grantId: "grant-a", projectId: project.id()})
    const logA = buildDeviceMutationLog("log-a")
    const logB = buildDeviceMutationLog("log-b")

    // Device A mutates offline.
    const mutationA = buildTaskUpdateMutation({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      attributes: {name: "Updated by A"},
      baseVersion: "server-1",
      clientMutationId: "mutation-a",
      grantId: "grant-a",
      taskId: task.id()
    })
    const signedMutationA = await signFixtureMutation({fixtures: deviceAFixtures, mutation: mutationA})

    await logA.append({mutation: mutationA, signedMutation: signedMutationA})

    // Device A exports a signed peer bundle.
    const bundleFromA = await exportPeerMutationBundle({
      deviceCertificate: deviceAFixtures.deviceCertificate,
      devicePrivateKey: deviceAFixtures.deviceKeys.privateKey,
      mutationLog: logA,
      now: () => GRANT_NOW
    })

    expect(bundleFromA.mutations).toHaveLength(1)
    expect(bundleFromA.mutations[0].signedMutation.mutation.clientMutationId).toEqual("mutation-a")

    // Device B imports the peer bundle and receives A's mutation as peer-applied.
    const importResult = await importPeerMutationBundle({
      backendPublicKey: deviceAFixtures.backendKeys.publicKey,
      bundle: bundleFromA,
      mutationLog: logB,
      now: GRANT_NOW
    })

    expect(importResult.imported).toHaveLength(1)

    // The importer can later retrieve the original signed mutation from its log
    // so it can forward A's mutation to the backend on reconnection.
    const logBRecords = await logB.records()
    const forwardedRecord = logBRecords[0]

    expect(forwardedRecord.signedMutation).toEqual(signedMutationA)

    // Device B reconnects and forwards A's signed mutation to the backend.
    const replayResult = await replaySignedMutations({
      fixtures: deviceAFixtures,
      signedMutations: [{signedMutation: forwardedRecord.signedMutation, signedOfflineGrant: deviceAFixtures.signedOfflineGrant}]
    })

    expect(replayResult).toEqual({syncs: [{idempotencyKey: "user-1:device-a:mutation-a", syncState: "successful"}]})

    const convergedTask = await Task.findByOrFail({id: task.id()})

    expect(convergedTask.name()).toEqual("Updated by A")

    const syncEntry = await SyncEntry.findBy({resourceId: String(task.id()), resourceType: "Task"})

    expect(syncEntry).not.toEqual(null)
    expect(syncEntry.authenticationTokenId()).toEqual("user-1")
  })

  it("rejects an unauthorized attribute mutation peer-side and server-side", async () => {
    const project = await Project.create({name: "Unauthorized project"})
    const task = await Task.create({name: "Task", projectId: project.id()})
    const deviceAFixtures = await buildDeviceFixtures({actorDeviceId: "device-a", actorUserId: "user-1", grantId: "grant-a", projectId: project.id()})
    const logA = buildDeviceMutationLog("log-a")
    const logB = buildDeviceMutationLog("log-b")
    const validMutation = buildTaskUpdateMutation({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      attributes: {name: "Valid update"},
      baseVersion: "server-1",
      clientMutationId: "mutation-valid",
      grantId: "grant-a",
      taskId: task.id()
    })
    const attributeMutation = {
      ...validMutation,
      attributes: {name: "Attribute update", unknownAttribute: "should not apply"},
      clientMutationId: "mutation-attribute"
    }
    const signedValidMutation = await signFixtureMutation({fixtures: deviceAFixtures, mutation: validMutation})
    const signedAttributeMutation = await signFixtureMutation({fixtures: deviceAFixtures, mutation: attributeMutation})

    await logA.append({mutation: validMutation, signedMutation: signedValidMutation})
    await logA.append({mutation: attributeMutation, signedMutation: signedAttributeMutation})

    const bundleFromA = await exportPeerMutationBundle({
      deviceCertificate: deviceAFixtures.deviceCertificate,
      devicePrivateKey: deviceAFixtures.deviceKeys.privateKey,
      mutationLog: logA,
      now: () => GRANT_NOW
    })

    // Peer-side: tampering the mutation after signing causes verification failure on import.
    const tamperedBundle = {
      ...bundleFromA,
      mutations: bundleFromA.mutations.map((entry) => (
        entry.signedMutation.mutation.clientMutationId === "mutation-attribute"
          ? {signedMutation: {...entry.signedMutation, mutation: {...entry.signedMutation.mutation, attributes: {name: "Tampered again"}}}}
          : entry
      ))
    }
    const importResult = await importPeerMutationBundle({
      backendPublicKey: deviceAFixtures.backendKeys.publicKey,
      bundle: tamperedBundle,
      mutationLog: logB,
      now: GRANT_NOW
    })

    expect(importResult.rejected).toHaveLength(1)
    expect(importResult.rejected[0].errorMessage).toMatch(/signature/u)

    // Server-side: an untampered mutation with an unauthorized attribute is rejected with a structured per-sync result.
    const serverResult = await replaySignedMutations({
      fixtures: deviceAFixtures,
      signedMutations: [{signedMutation: signedAttributeMutation, signedOfflineGrant: deviceAFixtures.signedOfflineGrant}]
    })

    expect(serverResult.syncs[0].syncState).toEqual("failed")
    expect(serverResult.syncs[0].reason).toEqual("sync-unknown-attribute")

    const unchangedTask = await Task.findByOrFail({id: task.id()})

    expect(unchangedTask.name()).toEqual("Task")
  })

  it("surfaces a structured conflict when a peer mutation has a stale base version", async () => {
    const project = await Project.create({name: "Conflict project"})
    const task = await Task.create({name: "Original task", projectId: project.id()})
    const backendKeys = await generateSyncSigningKeyPair()
    const signingKey = {current: true, id: "shared-key", secret: "super-secret-key"}
    const deviceAFixtures = await buildDeviceFixtures({actorDeviceId: "device-a", actorUserId: "user-1", backendKeys, grantId: "grant-a", projectId: project.id(), signingKey})
    const deviceBFixtures = await buildDeviceFixtures({actorDeviceId: "device-b", actorUserId: "user-1", backendKeys, grantId: "grant-b", projectId: project.id(), signingKey})
    const logA = buildDeviceMutationLog("log-a")
    const logB = buildDeviceMutationLog("log-b")
    const baseVersion = task.updatedAt().toISOString()

    // Device A mutates offline based on the original server version.
    const mutationA = buildTaskUpdateMutation({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      attributes: {name: "A's edit"},
      baseVersion,
      clientMutationId: "mutation-a",
      grantId: "grant-a",
      taskId: task.id()
    })

    // Device B mutates the same task offline based on the same base version, later.
    const mutationB = {
      ...buildTaskUpdateMutation({
        actorDeviceId: "device-b",
        actorUserId: "user-1",
        attributes: {name: "B's edit"},
        baseVersion,
        clientMutationId: "mutation-b",
        grantId: "grant-b",
        taskId: task.id()
      }),
      occurredAt: "2026-08-01T02:00:00.000Z"
    }

    const signedMutationA = await signFixtureMutation({fixtures: deviceAFixtures, mutation: mutationA})
    const signedMutationB = await signFixtureMutation({fixtures: deviceBFixtures, mutation: mutationB})

    await logA.append({mutation: mutationA, signedMutation: signedMutationA})

    const bundleFromA = await exportPeerMutationBundle({
      deviceCertificate: deviceAFixtures.deviceCertificate,
      devicePrivateKey: deviceAFixtures.deviceKeys.privateKey,
      mutationLog: logA,
      now: () => GRANT_NOW
    })

    await importPeerMutationBundle({
      backendPublicKey: deviceAFixtures.backendKeys.publicKey,
      bundle: bundleFromA,
      mutationLog: logB,
      now: GRANT_NOW
    })

    // Device B records its own conflicting mutation locally.
    await logB.append({mutation: mutationB, signedMutation: signedMutationB})

    // Device B reconnects and forwards A's signed mutation first; it applies.
    const logBRecords = await logB.records()
    const recordA = logBRecords.find((record) => record.mutation.clientMutationId === "mutation-a")

    expect(recordA).not.toEqual(undefined)

    const firstReplay = await replaySignedMutations({
      fixtures: deviceAFixtures,
      signedMutations: [{signedMutation: recordA.signedMutation, signedOfflineGrant: deviceAFixtures.signedOfflineGrant}]
    })

    expect(firstReplay.syncs[0].syncState).toEqual("successful")

    const taskAfterA = await Task.findByOrFail({id: task.id()})

    expect(taskAfterA.name()).toEqual("A's edit")

    // Device B now replays its own pending mutation against the new server state.
    const recordB = logBRecords.find((record) => record.mutation.clientMutationId === "mutation-b")

    expect(recordB).not.toEqual(undefined)

    const secondReplay = await replaySignedMutations({
      conflictStrategy: {strategy: "serverWins", versionAttribute: "updatedAt"},
      fixtures: deviceBFixtures,
      signedMutations: [{signedMutation: recordB.signedMutation, signedOfflineGrant: deviceBFixtures.signedOfflineGrant}]
    })

    expect(secondReplay.syncs[0].syncState).toEqual("conflict")
    expect(secondReplay.syncs[0].conflict.localMutation.clientMutationId).toEqual("mutation-b")
    expect(secondReplay.syncs[0].conflict.baseVersion).toEqual(baseVersion)
    expect(secondReplay.syncs[0].conflict.serverVersion).not.toEqual(baseVersion)
    expect(secondReplay.syncs[0].conflict.affectedFields).toEqual(["name"])

    // Convergence: authoritative state is A's edit; B's conflicting mutation is not applied.
    const convergedTask = await Task.findByOrFail({id: task.id()})

    expect(convergedTask.name()).toEqual("A's edit")
  })

  it("serializes concurrent signed replays from the same base version so exactly one applies and the other conflicts", async () => {
    const project = await Project.create({name: "Concurrent replay project"})
    const task = await Task.create({name: "Concurrent task", projectId: project.id()})
    const backendKeys = await generateSyncSigningKeyPair()
    const signingKey = {current: true, id: "shared-key", secret: "super-secret-key"}
    const deviceAFixtures = await buildDeviceFixtures({actorDeviceId: "device-a", actorUserId: "user-1", backendKeys, grantId: "grant-a", projectId: project.id(), signingKey})
    const deviceBFixtures = await buildDeviceFixtures({actorDeviceId: "device-b", actorUserId: "user-1", backendKeys, grantId: "grant-b", projectId: project.id(), signingKey})
    const baseVersion = task.updatedAt().toISOString()

    // Two devices each mutate the same task offline from the same base version.
    const mutationA = buildTaskUpdateMutation({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      attributes: {name: "A's concurrent edit"},
      baseVersion,
      clientMutationId: "mutation-a-concurrent",
      grantId: "grant-a",
      taskId: task.id()
    })
    const mutationB = {
      ...buildTaskUpdateMutation({
        actorDeviceId: "device-b",
        actorUserId: "user-1",
        attributes: {name: "B's concurrent edit"},
        baseVersion,
        clientMutationId: "mutation-b-concurrent",
        grantId: "grant-b",
        taskId: task.id()
      }),
      occurredAt: "2026-08-01T02:00:00.000Z"
    }

    const signedMutationA = await signFixtureMutation({fixtures: deviceAFixtures, mutation: mutationA})
    const signedMutationB = await signFixtureMutation({fixtures: deviceBFixtures, mutation: mutationB})

    // Both devices reconnect and replay concurrently against the same backend state.
    const [resultA, resultB] = await Promise.all([
      replaySignedMutations({
        conflictStrategy: {strategy: "serverWins", versionAttribute: "updatedAt"},
        fixtures: deviceAFixtures,
        signedMutations: [{signedMutation: signedMutationA, signedOfflineGrant: deviceAFixtures.signedOfflineGrant}]
      }),
      replaySignedMutations({
        conflictStrategy: {strategy: "serverWins", versionAttribute: "updatedAt"},
        fixtures: deviceBFixtures,
        signedMutations: [{signedMutation: signedMutationB, signedOfflineGrant: deviceBFixtures.signedOfflineGrant}]
      })
    ])

    const states = [resultA.syncs[0].syncState, resultB.syncs[0].syncState].sort()

    expect(states).toEqual(["conflict", "successful"])

    const successfulResult = resultA.syncs[0].syncState === "successful" ? resultA.syncs[0] : resultB.syncs[0]
    const conflictResult = resultA.syncs[0].syncState === "conflict" ? resultA.syncs[0] : resultB.syncs[0]

    expect(successfulResult.syncState).toEqual("successful")
    expect(conflictResult.syncState).toEqual("conflict")
    expect(conflictResult.conflict.localMutation.clientMutationId).toMatch(/^mutation-[ab]-concurrent$/u)
    expect(conflictResult.conflict.baseVersion).toEqual(baseVersion)
    expect(conflictResult.conflict.serverVersion).not.toEqual(baseVersion)
    expect(conflictResult.conflict.affectedFields).toEqual(["name"])

    // Exactly one update applied; the final record equals the winner's value.
    const convergedTask = await Task.findByOrFail({id: task.id()})
    const winnerName = convergedTask.name()

    expect(["A's concurrent edit", "B's concurrent edit"]).toContain(winnerName)

    // The conflict replay must not persist a sync row, fan out broadcasts, or run afterSyncApply.
    const syncEntries = await SyncEntry.where({resourceId: String(task.id()), resourceType: "Task"}).toArray()

    expect(syncEntries).toHaveLength(1)
  })

  it("rejects a stale-policy mutation during backend replay", async () => {
    const project = await Project.create({name: "Stale policy project"})
    const task = await Task.create({name: "Stale task", projectId: project.id()})
    const deviceAFixtures = await buildDeviceFixtures({actorDeviceId: "device-a", actorUserId: "user-1", grantId: "grant-a", projectId: project.id()})
    const staleMutation = buildTaskUpdateMutation({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      attributes: {name: "Should not apply"},
      baseVersion: "server-1",
      clientMutationId: "mutation-stale",
      grantId: "grant-a",
      taskId: task.id()
    })
    const signedStaleMutation = await signFixtureMutation({
      fixtures: deviceAFixtures,
      mutation: {...staleMutation, policyHash: "sha256-stale"}
    })

    await expect(async () => {
      await replaySignedMutations({
        fixtures: deviceAFixtures,
        signedMutations: [{signedMutation: signedStaleMutation, signedOfflineGrant: deviceAFixtures.signedOfflineGrant}]
      })
    }).toThrow(/policy hash mismatch/u)

    const unchangedTask = await Task.findByOrFail({id: task.id()})

    expect(unchangedTask.name()).toEqual("Stale task")
  })
})
