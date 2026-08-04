// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"
import SyncPublisher from "../../src/sync/sync-publisher.js"
import Task from "../dummy/src/models/task.js"
import TaskBoard from "../dummy/src/models/task-board.js"
import TaskBoardCard from "../dummy/src/models/task-board-card.js"

const ACTOR_ID = "1f6e9a4c-2b3d-4e5f-8a9b-0c1d2e3f4a5b"

/**
 * Builds a sync replay payload.
 * @param {object} args - Payload args.
 * @param {Record<string, ?>} args.data - Mutation data.
 * @param {string} args.id - Client sync id.
 * @param {string} args.resourceId - Resource id.
 * @param {string} args.resourceType - Resource type.
 * @param {string} args.syncType - Sync type.
 * @returns {Record<string, ?>} Sync payload.
 */
function buildSync({data, id, resourceId, resourceType, syncType}) {
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

/**
 * Loads persisted card positions for a column.
 * @param {number} boardId - Board id.
 * @param {string} columnId - Column id.
 * @returns {Promise<Array<{taskId: number, position: number}>>} Ordered cards.
 */
async function columnCards(boardId, columnId) {
  const cards = await TaskBoardCard
    .where({taskBoardId: boardId, boardColumnId: columnId})
    .order("position")
    .toArray()

  return cards.map((card) => ({taskId: Number(card.taskId()), position: Number(card.position())}))
}

/**
 * Temporarily declares TaskBoardCard as a published resource and starts a
 * SyncPublisher. Restores the original static sync declaration and stops the
 * publisher when the test finishes.
 * @param {() => Promise<void>} callback - Test body that runs while publishing is active.
 * @returns {Promise<void>}
 */
async function withTaskBoardCardPublishing(callback) {
  const originalSync = TaskBoardCard.sync

  TaskBoardCard.sync = {
    publish: {
      serialize: (/** @type {TaskBoardCard} */ card) => ({
        boardColumnId: card.boardColumnId(),
        id: card.id(),
        position: card.position()
      })
    }
  }

  const publisher = new SyncPublisher({
    configuration: dummyConfiguration,
    syncModel: SyncEntry
  })

  await publisher.start()

  try {
    await callback()
  } finally {
    publisher.stop()
    TaskBoardCard.sync = originalSync
  }
}

describe("AwesomeTasks TaskBoard.moveCard offline sync command", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("reorders cards within a column and emits a change-feed row", async () => {
    const project = await Project.create({name: "Board project"})
    const board = await TaskBoard.create({name: "Project board", projectId: project.id()})
    const taskOne = await Task.create({name: "Task one", projectId: project.id()})
    const taskTwo = await Task.create({name: "Task two", projectId: project.id()})
    const taskThree = await Task.create({name: "Task three", projectId: project.id()})

    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskOne.id(), boardColumnId: "todo", position: 1})
    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskTwo.id(), boardColumnId: "todo", position: 2})
    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskThree.id(), boardColumnId: "todo", position: 3})

    const service = buildService()
    const result = await service.replay({
      syncs: [buildSync({
        data: {position: 1, targetColumnId: "todo", taskId: taskThree.id()},
        id: "move-card-1",
        resourceId: String(board.id()),
        resourceType: "TaskBoard",
        syncType: "moveCard"
      })]
    })

    expect(result).toEqual({syncs: [{id: "move-card-1", syncState: "successful"}]})

    expect(await columnCards(board.id(), "todo")).toEqual([
      {taskId: Number(taskThree.id()), position: 1},
      {taskId: Number(taskOne.id()), position: 2},
      {taskId: Number(taskTwo.id()), position: 3}
    ])

    const syncEntry = await SyncEntry.findBy({resourceId: String(board.id()), resourceType: "TaskBoard"})

    expect(syncEntry).not.toEqual(null)
    expect(syncEntry.syncType()).toEqual("moveCard")
  })

  it("moves a card to another column and compacts source positions", async () => {
    const project = await Project.create({name: "Board project"})
    const board = await TaskBoard.create({name: "Project board", projectId: project.id()})
    const taskOne = await Task.create({name: "Task one", projectId: project.id()})
    const taskTwo = await Task.create({name: "Task two", projectId: project.id()})
    const taskThree = await Task.create({name: "Task three", projectId: project.id()})

    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskOne.id(), boardColumnId: "todo", position: 1})
    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskTwo.id(), boardColumnId: "todo", position: 2})
    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskThree.id(), boardColumnId: "done", position: 1})

    const service = buildService()
    const result = await service.replay({
      syncs: [buildSync({
        data: {position: 2, targetColumnId: "done", taskId: taskOne.id()},
        id: "move-card-2",
        resourceId: String(board.id()),
        resourceType: "TaskBoard",
        syncType: "moveCard"
      })]
    })

    expect(result).toEqual({syncs: [{id: "move-card-2", syncState: "successful"}]})

    expect(await columnCards(board.id(), "todo")).toEqual([
      {taskId: Number(taskTwo.id()), position: 1}
    ])
    expect(await columnCards(board.id(), "done")).toEqual([
      {taskId: Number(taskThree.id()), position: 1},
      {taskId: Number(taskOne.id()), position: 2}
    ])
  })

  it("rejects a moveCard command for a missing task", async () => {
    const project = await Project.create({name: "Board project"})
    const board = await TaskBoard.create({name: "Project board", projectId: project.id()})
    const task = await Task.create({name: "Task", projectId: project.id()})

    await TaskBoardCard.create({taskBoardId: board.id(), taskId: task.id(), boardColumnId: "todo", position: 1})

    const service = buildService()
    const result = await service.replay({
      syncs: [buildSync({
        data: {position: 1, targetColumnId: "done", taskId: 999999},
        id: "move-card-missing",
        resourceId: String(board.id()),
        resourceType: "TaskBoard",
        syncType: "moveCard"
      })]
    })

    expect(result.syncs[0].syncState).toEqual("failed")
  })

  it("suppresses command-owned card publishes and emits exactly one TaskBoard change-feed row", async () => {
    const project = await Project.create({name: "Board project"})
    const board = await TaskBoard.create({name: "Project board", projectId: project.id()})
    const taskOne = await Task.create({name: "Task one", projectId: project.id()})
    const taskTwo = await Task.create({name: "Task two", projectId: project.id()})
    const taskThree = await Task.create({name: "Task three", projectId: project.id()})

    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskOne.id(), boardColumnId: "todo", position: 1})
    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskTwo.id(), boardColumnId: "todo", position: 2})
    await TaskBoardCard.create({taskBoardId: board.id(), taskId: taskThree.id(), boardColumnId: "done", position: 1})

    const service = buildService()

    await withTaskBoardCardPublishing(async () => {
      const result = await service.replay({
        syncs: [buildSync({
          data: {position: 2, targetColumnId: "done", taskId: taskOne.id()},
          id: "move-card-suppress",
          resourceId: String(board.id()),
          resourceType: "TaskBoard",
          syncType: "moveCard"
        })]
      })

      expect(result).toEqual({syncs: [{id: "move-card-suppress", syncState: "successful"}]})
    })

    const boardEntries = await SyncEntry.where({resourceType: "TaskBoard", resourceId: String(board.id())}).toArray()
    const cardEntries = await SyncEntry.where({resourceType: "TaskBoardCard"}).toArray()

    expect(boardEntries).toHaveLength(1)
    expect(boardEntries[0].syncType()).toEqual("moveCard")
    expect(cardEntries).toHaveLength(0)
  })

  it("keeps the envelope resource id authoritative over a payload id for member commands", async () => {
    const project = await Project.create({name: "Board project"})
    const board = await TaskBoard.create({name: "Project board", projectId: project.id()})
    const otherBoard = await TaskBoard.create({name: "Other board", projectId: project.id()})
    const task = await Task.create({name: "Task", projectId: project.id()})

    await TaskBoardCard.create({taskBoardId: board.id(), taskId: task.id(), boardColumnId: "todo", position: 1})

    const service = buildService()
    const result = await service.replay({
      syncs: [buildSync({
        data: {id: otherBoard.id(), targetColumnId: "done", taskId: task.id()},
        id: "move-card-envelope-id",
        resourceId: String(board.id()),
        resourceType: "TaskBoard",
        syncType: "moveCard"
      })]
    })

    expect(result).toEqual({syncs: [{id: "move-card-envelope-id", syncState: "successful"}]})

    const movedCard = await TaskBoardCard.findByOrFail({taskBoardId: board.id(), taskId: task.id()})

    expect(movedCard.boardColumnId()).toEqual("done")
  })
})
