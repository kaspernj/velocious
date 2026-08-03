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
  buildOfflineGrantAbilityFactory,
  buildSignedReplayFixtures,
  dummySyncManifest,
  signFixtureMutation
} from "../helpers/signed-sync-replay-helper.js"

const GRANT_NOW = new Date("2026-08-03T00:00:00.000Z")

/**
 * Builds grant fixtures for one actor scoped to a project.
 * @param {object} args - Fixture args.
 * @param {string} args.grantId - Grant id.
 * @param {string} args.operation - Authorized operation.
 * @param {string} args.model - Grant model.
 * @param {?} args.projectId - Grant project scope.
 * @returns {Promise<Record<string, ?>>} Fixture bundle.
 */
async function buildGrantForProject({grantId, model, operation, projectId}) {
  return await buildSignedReplayFixtures({
    actorDeviceId: "device-a",
    actorUserId: "user-1",
    grantId,
    grantNow: GRANT_NOW,
    resources: {[model]: {enabled: true, operations: [operation], policyHash: dummySyncManifest()[model].policyHash}},
    scopes: {projectId}
  })
}

/**
 * Signs a Task update mutation against fixtures.
 * @param {object} args - Mutation args.
 * @param {Record<string, ?>} args.fixtures - Fixture bundle.
 * @param {string} args.grantId - Grant id.
 * @param {string} args.mutationId - Client mutation id.
 * @param {string} args.name - New task name.
 * @param {number} args.taskId - Target task id.
 * @returns {Promise<Record<string, ?>>} Signed mutation envelope.
 */
async function signTaskUpdate({fixtures, grantId, mutationId, name, taskId}) {
  return await signFixtureMutation({
    fixtures,
    mutation: {
      actorDeviceId: "device-a",
      actorUserId: "user-1",
      attributes: {name},
      clientMutationId: mutationId,
      model: "Task",
      occurredAt: "2026-08-01T01:00:00.000Z",
      offlineGrantId: grantId,
      operation: "update",
      payload: {id: String(taskId)},
      policyHash: dummySyncManifest().Task.policyHash
    }
  })
}

describe("AwesomeTasks signed offline sync scope authorization", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("denies a project-A grant updating a project-B task", async () => {
    const projectA = await Project.create({name: "Project A"})
    const projectB = await Project.create({name: "Project B"})
    const taskB = await Task.create({name: "Project B task", projectId: projectB.id()})
    const fixtures = await buildGrantForProject({grantId: "grant-a", model: "Task", operation: "update", projectId: projectA.id()})
    const signedMutation = await signTaskUpdate({fixtures, grantId: "grant-a", mutationId: "mutation-cross", name: "Hijacked", taskId: taskB.id()})
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

    expect(result.syncs).toHaveLength(1)
    expect(result.syncs[0].syncState).toEqual("failed")

    const unchangedTask = await Task.findByOrFail({id: taskB.id()})

    expect(unchangedTask.name()).toEqual("Project B task")
  })

  it("denies a project-A grant moving a card on a project-B board", async () => {
    const projectA = await Project.create({name: "Project A"})
    const projectB = await Project.create({name: "Project B"})
    const boardB = await TaskBoard.create({name: "Project B board", projectId: projectB.id()})
    const taskB = await Task.create({name: "Project B task", projectId: projectB.id()})

    await TaskBoardCard.create({taskBoardId: boardB.id(), taskId: taskB.id(), boardColumnId: "todo", position: 1})

    const fixtures = await buildGrantForProject({grantId: "grant-a", model: "TaskBoard", operation: "moveCard", projectId: projectA.id()})
    const signedMutation = await signFixtureMutation({
      fixtures,
      mutation: {
        actorDeviceId: "device-a",
        actorUserId: "user-1",
        clientMutationId: "mutation-cross-move",
        model: "TaskBoard",
        occurredAt: "2026-08-01T01:00:00.000Z",
        offlineGrantId: "grant-a",
        operation: "moveCard",
        payload: {id: String(boardB.id()), targetColumnId: "done", taskId: String(taskB.id())},
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

    expect(result.syncs).toHaveLength(1)
    expect(result.syncs[0].syncState).toEqual("failed")

    const unchangedCard = await TaskBoardCard.findByOrFail({taskBoardId: boardB.id(), taskId: taskB.id()})

    expect(unchangedCard.boardColumnId()).toEqual("todo")
  })

  it("replays a project-A grant against project-A records", async () => {
    const projectA = await Project.create({name: "Project A"})
    const boardA = await TaskBoard.create({name: "Project A board", projectId: projectA.id()})
    const taskA = await Task.create({name: "Project A task", projectId: projectA.id()})

    await TaskBoardCard.create({taskBoardId: boardA.id(), taskId: taskA.id(), boardColumnId: "todo", position: 1})

    const fixtures = await buildGrantForProject({grantId: "grant-a", model: "TaskBoard", operation: "moveCard", projectId: projectA.id()})
    const signedMutation = await signFixtureMutation({
      fixtures,
      mutation: {
        actorDeviceId: "device-a",
        actorUserId: "user-1",
        clientMutationId: "mutation-own-move",
        model: "TaskBoard",
        occurredAt: "2026-08-01T01:00:00.000Z",
        offlineGrantId: "grant-a",
        operation: "moveCard",
        payload: {id: String(boardA.id()), targetColumnId: "done", taskId: String(taskA.id())},
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

    expect(result).toEqual({syncs: [{idempotencyKey: "user-1:device-a:mutation-own-move", syncState: "successful"}]})

    const movedCard = await TaskBoardCard.findByOrFail({taskBoardId: boardA.id(), taskId: taskA.id()})

    expect(movedCard.boardColumnId()).toEqual("done")
  })

  it("passes the verified actor and grant to the ability factory", async () => {
    const projectA = await Project.create({name: "Project A"})
    const taskA = await Task.create({name: "Project A task", projectId: projectA.id()})
    const fixtures = await buildGrantForProject({grantId: "grant-a", model: "Task", operation: "update", projectId: projectA.id()})
    const signedMutation = await signTaskUpdate({fixtures, grantId: "grant-a", mutationId: "mutation-factory", name: "Factory scoped", taskId: taskA.id()})

    /** @type {Array<{actor: ?, grant: ?}>} */
    const factoryCalls = []
    const recordingFactory = (/** @type {{actor: ?, grant: ?}} */ args) => {
      factoryCalls.push(args)

      return buildOfflineGrantAbilityFactory()(args)
    }
    const service = new SignedSyncEnvelopeReplayService({
      abilityFactory: recordingFactory,
      backendPublicKey: fixtures.backendKeys.publicKey,
      configuration: dummyConfiguration,
      offlineGrantSigningKeys: [fixtures.signingKey],
      syncModel: SyncEntry
    })

    const result = await service.replay({
      signedMutations: [{signedMutation, signedOfflineGrant: fixtures.signedOfflineGrant}]
    })

    expect(result.syncs[0].syncState).toEqual("successful")
    expect(factoryCalls).toHaveLength(1)
    expect(factoryCalls[0].actor.id()).toEqual("user-1")
    expect(factoryCalls[0].grant.grantId).toEqual("grant-a")
    expect(factoryCalls[0].grant.scopes).toEqual({projectId: projectA.id()})
  })

  it("fails closed when routed signed replay has no ability factory", async () => {
    const projectA = await Project.create({name: "Project A"})
    const taskA = await Task.create({name: "Project A task", projectId: projectA.id()})
    const fixtures = await buildGrantForProject({grantId: "grant-a", model: "Task", operation: "update", projectId: projectA.id()})
    const signedMutation = await signTaskUpdate({fixtures, grantId: "grant-a", mutationId: "mutation-no-factory", name: "Should not apply", taskId: taskA.id()})
    const service = new SignedSyncEnvelopeReplayService({
      backendPublicKey: fixtures.backendKeys.publicKey,
      configuration: dummyConfiguration,
      offlineGrantSigningKeys: [fixtures.signingKey],
      syncModel: SyncEntry
    })

    const result = await service.replay({
      signedMutations: [{signedMutation, signedOfflineGrant: fixtures.signedOfflineGrant}]
    })

    expect(result.syncs).toHaveLength(1)
    expect(result.syncs[0].syncState).toEqual("failed")
    expect(result.syncs[0].reason).toEqual("signed-replay-ability-missing")

    const unchangedTask = await Task.findByOrFail({id: taskA.id()})

    expect(unchangedTask.name()).toEqual("Project A task")
  })
})
