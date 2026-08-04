// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"
import Task from "../dummy/src/models/task.js"
import Comment from "../dummy/src/models/comment.js"

const ACTOR_ID = "1f6e9a4c-2b3d-4e5f-8a9b-0c1d2e3f4a5b"

/**
 * Builds a sync replay payload.
 * @param {object} args - Payload args.
 * @param {Record<string, ?>} args.data - Mutation data.
 * @param {string} args.id - Client sync id.
 * @param {string} args.resourceId - Resource id.
 * @param {string} [args.resourceType] - Resource type. Defaults to "Task".
 * @param {string} [args.syncType] - Sync type. Defaults to "update".
 * @returns {Record<string, ?>} Sync payload.
 */
function buildSync({data, id, resourceId, resourceType = "Task", syncType = "update"}) {
  return {
    clientUpdatedAt: "2030-01-01T10:00:00.000Z",
    data,
    id,
    resourceId: String(resourceId),
    resourceType,
    syncType
  }
}

/**
 * Builds a routed replay service with a stubbed authenticated actor.
 * @param {Record<string, ?>} [serviceArgs] - Extra service constructor args.
 * @returns {SyncEnvelopeReplayService} Replay service.
 */
function buildService(serviceArgs = {}) {
  class RoutedReplayService extends SyncEnvelopeReplayService {
    /** @returns {Promise<{authenticated: true, actor: {id: () => string}}>} Authenticated fake actor. */
    async authenticateReplay() {
      return {actor: {id: () => ACTOR_ID}, authenticated: true}
    }
  }

  return new RoutedReplayService({configuration: dummyConfiguration, syncModel: SyncEntry, ...serviceArgs})
}

describe("AwesomeTasks Task and Comment offline sync", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("creates a Task via routed sync replay", async () => {
    const project = await Project.create({name: "Sync project"})
    const resourceId = "123456"
    const service = buildService()
    const result = await service.replay({
      syncs: [buildSync({
        data: {name: "Offline task", projectId: project.id()},
        id: "task-create-1",
        resourceId,
        syncType: "create"
      })]
    })

    expect(result).toEqual({syncs: [{id: "task-create-1", syncState: "successful"}]})

    const task = await Task.findByOrFail({id: Number(resourceId)})

    expect(task.name()).toEqual("Offline task")
    expect(Number(task.projectId())).toEqual(Number(project.id()))

    const syncEntry = await SyncEntry.findBy({resourceId, resourceType: "Task"})

    expect(syncEntry).not.toEqual(null)
    expect(syncEntry.syncType()).toEqual("create")
  })

  it("updates a Task via routed sync replay", async () => {
    const project = await Project.create({name: "Sync project"})
    const task = await Task.create({name: "Original name", projectId: project.id()})
    const service = buildService()
    const result = await service.replay({
      syncs: [buildSync({
        data: {name: "Updated name", isDone: true},
        id: "task-update-1",
        resourceId: String(task.id()),
        syncType: "update"
      })]
    })

    expect(result).toEqual({syncs: [{id: "task-update-1", syncState: "successful"}]})

    const updatedTask = await Task.findByOrFail({id: task.id()})

    expect(updatedTask.name()).toEqual("Updated name")
    expect(updatedTask.isDone()).toEqual(true)
  })

  it("rejects Task updates with attributes outside the permit list", async () => {
    const project = await Project.create({name: "Sync project"})
    const task = await Task.create({name: "Original name", projectId: project.id()})
    const service = buildService()
    const result = await service.replay({
      syncs: [buildSync({
        data: {evilAttribute: "x", name: "Updated name"},
        id: "task-update-bad",
        resourceId: String(task.id()),
        syncType: "update"
      })]
    })

    expect(result.syncs[0].syncState).toEqual("failed")
    expect(result.syncs[0].reason).toEqual("sync-unknown-attribute")
  })

  it("creates a Comment via routed sync replay", async () => {
    const project = await Project.create({name: "Sync project"})
    const task = await Task.create({name: "Commented task", projectId: project.id()})
    const resourceId = "123457"
    const service = buildService()
    const result = await service.replay({
      syncs: [buildSync({
        data: {body: "Offline comment", taskId: task.id()},
        id: "comment-create-1",
        resourceId,
        resourceType: "Comment",
        syncType: "create"
      })]
    })

    expect(result).toEqual({syncs: [{id: "comment-create-1", syncState: "successful"}]})

    const comment = await Comment.findByOrFail({id: Number(resourceId)})

    expect(comment.body()).toEqual("Offline comment")
    expect(Number(comment.taskId())).toEqual(Number(task.id()))

    const syncEntry = await SyncEntry.findBy({resourceId, resourceType: "Comment"})

    expect(syncEntry).not.toEqual(null)
    expect(syncEntry.syncType()).toEqual("create")
  })
})
