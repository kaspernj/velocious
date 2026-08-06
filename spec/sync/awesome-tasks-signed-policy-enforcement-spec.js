// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SignedSyncEnvelopeReplayService from "../../src/sync/signed-sync-envelope-replay-service.js"
import Task from "../dummy/src/models/task.js"
import {
  buildOfflineGrantAbilityFactory,
  buildSignedReplayFixtures,
  dummySyncManifest,
  signFixtureMutation
} from "../helpers/signed-sync-replay-helper.js"

/**
 * Builds a signed replay service with the proof ability factory.
 * @param {Record<string, ?>} fixtures - Fixture bundle.
 * @param {Record<string, ?>} [serviceArgs] - Extra service constructor args.
 * @returns {SignedSyncEnvelopeReplayService} Replay service.
 */
function buildService(fixtures, serviceArgs = {}) {
  return new SignedSyncEnvelopeReplayService({
    abilityFactory: buildOfflineGrantAbilityFactory(),
    backendPublicKey: fixtures.backendKeys.publicKey,
    configuration: dummyConfiguration,
    offlineGrantSigningKeys: [fixtures.signingKey],
    syncModel: SyncEntry,
    ...serviceArgs
  })
}

/**
 * Replays one signed Task update and returns the thrown error message.
 * @param {object} args - Replay args.
 * @param {Record<string, ?>} args.fixtures - Fixture bundle.
 * @param {Record<string, ?>} args.mutationOverrides - Mutation overrides.
 * @param {Record<string, ?>} [args.serviceArgs] - Extra service constructor args.
 * @param {number} args.taskId - Target task id.
 * @returns {Promise<string>} Thrown error message.
 */
async function expectPolicyFailure({fixtures, mutationOverrides, serviceArgs, taskId}) {
  const signedMutation = await signFixtureMutation({
    fixtures,
    mutation: {
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      attributes: {name: "Should not apply"},
      clientMutationId: "mutation-policy",
      model: "Task",
      occurredAt: "2026-08-01T01:00:00.000Z",
      offlineGrantId: "grant-policy",
      operation: "update",
      payload: {id: String(taskId)},
      policyHash: dummySyncManifest().Task.policyHash,
      ...mutationOverrides
    }
  })
  const service = buildService(fixtures, serviceArgs)

  try {
    await service.replay({
      signedMutations: [{signedMutation, signedOfflineGrant: fixtures.signedOfflineGrant}]
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  throw new Error("Expected the signed replay to fail")
}

describe("AwesomeTasks signed offline sync policy enforcement", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("rejects a mutation for a model missing from the current sync manifest", async () => {
    const project = await Project.create({name: "Policy project"})
    const task = await Task.create({name: "Policy task", projectId: project.id()})
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-policy",
      grantNow: new Date(),
      resources: {NotAModel: {enabled: true, operations: ["update"], policyHash: "sha256-stale"}},
      scopes: {projectId: project.id()}
    })

    const message = await expectPolicyFailure({
      fixtures,
      mutationOverrides: {model: "NotAModel"},
      taskId: task.id()
    })

    expect(message).toMatch(/not enabled/u)
  })

  it("rejects a mutation for an operation missing from the current sync manifest", async () => {
    const project = await Project.create({name: "Policy project"})
    const task = await Task.create({name: "Policy task", projectId: project.id()})
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-policy",
      grantNow: new Date(),
      resources: {Task: {enabled: true, operations: ["destroy"], policyHash: dummySyncManifest().Task.policyHash}},
      scopes: {projectId: project.id()}
    })

    const message = await expectPolicyFailure({
      fixtures,
      mutationOverrides: {operation: "destroy"},
      taskId: task.id()
    })

    expect(message).toMatch(/not enabled/u)
  })

  it("rejects a mutation whose policy hash differs from the current manifest", async () => {
    const project = await Project.create({name: "Policy project"})
    const task = await Task.create({name: "Policy task", projectId: project.id()})
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-policy",
      grantNow: new Date(),
      resources: {Task: {enabled: true, operations: ["update"], policyHash: dummySyncManifest().Task.policyHash}},
      scopes: {projectId: project.id()}
    })

    const message = await expectPolicyFailure({
      fixtures,
      mutationOverrides: {policyHash: "sha256-stale"},
      taskId: task.id()
    })

    expect(message).toMatch(/policy hash mismatch/u)
  })

  it("rejects a grant resource that is disabled even when the operation is listed", async () => {
    const project = await Project.create({name: "Policy project"})
    const task = await Task.create({name: "Policy task", projectId: project.id()})
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-policy",
      grantNow: new Date(),
      resources: {Task: {enabled: false, operations: ["update"], policyHash: dummySyncManifest().Task.policyHash}},
      scopes: {projectId: project.id()}
    })

    const message = await expectPolicyFailure({fixtures, mutationOverrides: {}, taskId: task.id()})

    expect(message).toMatch(/does not authorize/u)
  })

  it("rejects a grant resource that does not list the operation", async () => {
    const project = await Project.create({name: "Policy project"})
    const task = await Task.create({name: "Policy task", projectId: project.id()})
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-policy",
      grantNow: new Date(),
      resources: {Task: {enabled: true, operations: ["find"], policyHash: dummySyncManifest().Task.policyHash}},
      scopes: {projectId: project.id()}
    })

    const message = await expectPolicyFailure({fixtures, mutationOverrides: {}, taskId: task.id()})

    expect(message).toMatch(/does not authorize/u)
  })

  it("rejects a stale grant whose policy hash predates the current manifest", async () => {
    const project = await Project.create({name: "Policy project"})
    const task = await Task.create({name: "Policy task", projectId: project.id()})
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-policy",
      grantNow: new Date(),
      resources: {Task: {enabled: true, operations: ["update"], policyHash: "sha256-stale"}},
      scopes: {projectId: project.id()}
    })

    const message = await expectPolicyFailure({fixtures, mutationOverrides: {}, taskId: task.id()})

    expect(message).toMatch(/policy hash mismatch/u)
  })

  it("rejects legacy array grant resources that bypass policy enforcement", async () => {
    const project = await Project.create({name: "Policy project"})
    const task = await Task.create({name: "Policy task", projectId: project.id()})
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-policy",
      grantNow: new Date(),
      resources: {Task: ["update"]},
      scopes: {projectId: project.id()}
    })

    const message = await expectPolicyFailure({fixtures, mutationOverrides: {}, taskId: task.id()})

    expect(message).toMatch(/does not authorize/u)
  })

  it("replays a mutation whose grant and policy hash match the current manifest", async () => {
    const project = await Project.create({name: "Policy project"})
    const task = await Task.create({name: "Policy task", projectId: project.id()})
    const fixtures = await buildSignedReplayFixtures({
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      grantId: "grant-policy",
      grantNow: new Date(),
      resources: {Task: {enabled: true, operations: ["update"], policyHash: dummySyncManifest().Task.policyHash}},
      scopes: {projectId: project.id()}
    })
    const signedMutation = await signFixtureMutation({
      fixtures,
      mutation: {
        actorDeviceId: "device-a",
        actorUserId: "user-1",
        attributes: {name: "Updated under current policy"},
        clientMutationId: "mutation-policy-ok",
        model: "Task",
        occurredAt: "2026-08-01T01:00:00.000Z",
        offlineGrantId: "grant-policy",
        operation: "update",
        payload: {id: String(task.id())},
        policyHash: dummySyncManifest().Task.policyHash
      }
    })
    const service = buildService(fixtures)

    const result = await service.replay({
      signedMutations: [{signedMutation, signedOfflineGrant: fixtures.signedOfflineGrant}]
    })

    expect(result).toEqual({syncs: [{idempotencyKey: "user-1:device-a:mutation-policy-ok", syncState: "successful"}]})

    const updatedTask = await Task.findByOrFail({id: task.id()})

    expect(updatedTask.name()).toEqual("Updated under current policy")
  })
})
