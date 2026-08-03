// @ts-check

import FrontendModelBaseResource from "../../../../src/frontend-model-resource/base-resource.js"
import {markServerApply} from "../../../../src/sync/sync-publish-suppression.js"
import TaskBoard from "../models/task-board.js"
import TaskBoardCard from "../models/task-board-card.js"
import Task from "../models/task.js"

/** Sync-enabled resource for TaskBoard domain commands. */
class TaskBoardSyncResource extends FrontendModelBaseResource {
  static ModelClass = TaskBoard

  static attributes = ["id", "name", {name: "projectId", selectedByDefault: false}]

  static builtInCollectionCommands = ["index"]

  static builtInMemberCommands = ["find"]

  static memberCommands = ["moveCard"]

  static sync = {operations: ["index", "find", "moveCard"]}

  /**
   * Returns the Velocious configuration, supplied by the replay service through
   * locals so domain commands can use the established transaction mechanism.
   * @returns {import("../../../../src/configuration.js").default} Configuration.
   */
  configuration() {
    const config = this.locals?.configuration

    if (!config) throw new Error("TaskBoardSyncResource requires configuration in locals")

    return config
  }

  /**
   * Returns a fresh operation-bound query for TaskBoardCard. Query objects are
   * mutated by `.where(...)`, so each independent query starts from a fresh
   * operation-bound scope.
   * @param {import("../../../../src/database/operation.js").default} operation - Database operation.
   * @returns {?} Operation-bound TaskBoardCard query.
   */
  cardQuery(operation) {
    return operation.forModel(TaskBoardCard)
  }

  /**
   * Moves a task card to a column/position and compacts sibling positions.
   *
   * The whole move runs inside an operation-scoped transaction and holds a
   * board-scoped advisory lock on the transaction connection for the duration
   * of the operation, so concurrent moves on the same board are serialized and
   * partial ordering cannot be committed if a later step fails. Every
   * command-owned card save is marked as a server apply so an active
   * SyncPublisher does not publish intermediate shuffle positions.
   * @param {{id: number, position?: number, targetColumnId: string, taskId: number}} args - Move args.
   * @returns {Promise<{movedCardId: number, taskId: number, targetColumnId: string, position: number}>} - Move result.
   */
  async moveCard(args) {
    const boardId = Number(args.id)
    const taskId = Number(args.taskId)
    const targetColumnId = args.targetColumnId
    const requestedPosition = args.position === undefined ? null : Number(args.position)

    return await this.configuration().withTransaction({databaseIdentifier: "default"}, async (operation) => {
      const lockName = `task-board-move:${boardId}`
      const acquired = await operation.connection().acquireAdvisoryLock(lockName)

      if (!acquired) {
        throw this.writableAttributeError("Could not acquire board move lock.", {code: "board-move-lock-busy"})
      }

      try {
        return await this.executeMove({
          operation,
          boardId,
          requestedPosition,
          targetColumnId,
          taskId
        })
      } finally {
        await operation.connection().releaseAdvisoryLock(lockName)
      }
    })
  }

  /**
   * Executes the move once the transaction and advisory lock are held.
   * @param {{operation: import("../../../../src/database/operation.js").default, boardId: number, requestedPosition: number | null, targetColumnId: string, taskId: number}} args - Move args.
   * @returns {Promise<{movedCardId: number, taskId: number, targetColumnId: string, position: number}>} - Move result.
   */
  async executeMove({operation, boardId, requestedPosition, targetColumnId, taskId}) {
    const boardQuery = operation.forModel(TaskBoard).where({id: boardId})
    const board = this.ability
      ? await this.ability.applyToQuery({action: "update", modelClass: TaskBoard, query: boardQuery}).first()
      : await boardQuery.first()

    if (!board) {
      throw this.writableAttributeError("TaskBoard not found.", {code: "task-board-not-found"})
    }

    const task = await operation.forModel(Task).findBy({id: taskId})

    if (!task) {
      throw this.writableAttributeError("Task not found.", {code: "task-not-found"})
    }

    const card = await this.cardQuery(operation).findBy({taskBoardId: boardId, taskId})

    if (!card) {
      throw this.writableAttributeError("Card not found on board.", {code: "card-not-found"})
    }

    const sourceColumnId = card.boardColumnId()
    const sourcePosition = Number(card.position())
    const sameColumn = sourceColumnId === targetColumnId
    const newPosition = await this.resolveNewPosition({operation, boardId, requestedPosition, targetColumnId})

    if (newPosition < 1 || !Number.isInteger(newPosition)) {
      throw this.writableAttributeError("Position must be a positive integer.", {code: "invalid-position"})
    }

    if (sameColumn && newPosition === sourcePosition) {
      return this.moveCardResult({card, targetColumnId})
    }

    const tempPosition = await this.deriveTempPosition({operation, boardId, targetColumnId})

    card.assign({boardColumnId: targetColumnId, position: tempPosition})
    await this.saveCommandCard(card)

    if (sameColumn) {
      await this.shiftWithinColumn({
        operation,
        card,
        newPosition,
        sourcePosition,
        targetColumnId
      })
    } else {
      await this.shiftAcrossColumns({
        operation,
        card,
        newPosition,
        sourceColumnId,
        sourcePosition,
        targetColumnId
      })
    }

    card.assign({position: newPosition})
    await this.saveCommandCard(card)

    return this.moveCardResult({card, targetColumnId})
  }

  /**
   * Resolves the target position for a card, defaulting to the end of the column.
   * @param {{operation: import("../../../../src/database/operation.js").default, boardId: number, requestedPosition: number | null, targetColumnId: string}} args - Resolution args.
   * @returns {Promise<number>} Resolved position.
   */
  async resolveNewPosition({operation, boardId, requestedPosition, targetColumnId}) {
    if (requestedPosition !== null && !Number.isNaN(requestedPosition)) return requestedPosition

    const cards = await this.cardQuery(operation)
      .where({taskBoardId: boardId, boardColumnId: targetColumnId})
      .order("position")
      .toArray()

    if (cards.length === 0) return 1

    return Math.max(...cards.map((c) => Number(c.position()))) + 1
  }

  /**
   * Derives a temporary position guaranteed not to collide with an existing card
   * in the target column. Must be called while holding the board advisory lock.
   * @param {{operation: import("../../../../src/database/operation.js").default, boardId: number, targetColumnId: string}} args - Derivation args.
   * @returns {Promise<number>} Collision-free temporary position.
   */
  async deriveTempPosition({operation, boardId, targetColumnId}) {
    const cards = await this.cardQuery(operation)
      .where({taskBoardId: boardId, boardColumnId: targetColumnId})
      .order("position")
      .toArray()

    if (cards.length === 0) return 1

    return Math.max(...cards.map((c) => Number(c.position()))) + 1
  }

  /**
   * Saves a command-owned card with server-apply suppression so intermediate
   * shuffle positions are not published by an active SyncPublisher.
   * @param {import("../models/task-board-card.js").default} card - Card to save.
   * @returns {Promise<void>}
   */
  async saveCommandCard(card) {
    const releaseServerApply = markServerApply(card)

    try {
      await card.save()
    } finally {
      releaseServerApply()
    }
  }

  /**
   * Shuffles positions for an in-column move after the moving card has been
   * moved to a temporary slot.
   * @param {{operation: import("../../../../src/database/operation.js").default, card: import("../models/task-board-card.js").default, newPosition: number, sourcePosition: number, targetColumnId: string}} args - Shift args.
   * @returns {Promise<void>}
   */
  async shiftWithinColumn({operation, card, newPosition, sourcePosition, targetColumnId}) {
    const minPosition = Math.min(newPosition, sourcePosition)
    const maxPosition = Math.max(newPosition, sourcePosition)
    const ascending = newPosition < sourcePosition
    const siblings = await this.cardQuery(operation)
      .where({taskBoardId: card.taskBoardId(), boardColumnId: targetColumnId})
      .order("position")
      .toArray()

    const affected = siblings.filter((sibling) => {
      const position = Number(sibling.position())

      return sibling.id() !== card.id() && position >= minPosition && position <= maxPosition
    })

    if (ascending) {
      // Moving up: room is created at the top; shift affected cards up by one,
      // updating from highest position to lowest to avoid unique-index collisions.
      for (const sibling of affected.slice().reverse()) {
        sibling.assign({position: Number(sibling.position()) + 1})
        await this.saveCommandCard(sibling)
      }
    } else {
      // Moving down: room is created at the bottom; shift affected cards down by
      // one, updating from lowest position to highest.
      for (const sibling of affected) {
        sibling.assign({position: Number(sibling.position()) - 1})
        await this.saveCommandCard(sibling)
      }
    }
  }

  /**
   * Shuffles positions for a cross-column move before the moving card is placed
   * in the target column. Target cards are shifted up to make room; source cards
   * after the removed card are shifted down to compact the source column.
   * @param {{operation: import("../../../../src/database/operation.js").default, card: import("../models/task-board-card.js").default, newPosition: number, sourceColumnId: string, sourcePosition: number, targetColumnId: string}} args - Shift args.
   * @returns {Promise<void>}
   */
  async shiftAcrossColumns({operation, card, newPosition, sourceColumnId, sourcePosition, targetColumnId}) {
    const targetCards = await this.cardQuery(operation)
      .where({taskBoardId: card.taskBoardId(), boardColumnId: targetColumnId})
      .order("position")
      .toArray()

    const affectedTarget = targetCards
      .filter((sibling) => sibling.id() !== card.id() && Number(sibling.position()) >= newPosition)
      .sort((a, b) => Number(b.position()) - Number(a.position()))

    for (const sibling of affectedTarget) {
      sibling.assign({position: Number(sibling.position()) + 1})
      await this.saveCommandCard(sibling)
    }

    const sourceCards = await this.cardQuery(operation)
      .where({taskBoardId: card.taskBoardId(), boardColumnId: sourceColumnId})
      .order("position")
      .toArray()

    const affectedSource = sourceCards
      .filter((sibling) => sibling.id() !== card.id())
      .filter((sibling) => Number(sibling.position()) > sourcePosition)
      .sort((a, b) => Number(a.position()) - Number(b.position()))

    for (const sibling of affectedSource) {
      sibling.assign({position: Number(sibling.position()) - 1})
      await this.saveCommandCard(sibling)
    }
  }

  /**
   * Builds the standardized moveCard command result.
   * @param {{card: import("../models/task-board-card.js").default, targetColumnId: string}} args - Result args.
   * @returns {{movedCardId: number, position: number, targetColumnId: string, taskId: number}} - Result.
   */
  moveCardResult({card, targetColumnId}) {
    return {
      movedCardId: Number(card.id()),
      position: Number(card.position()),
      targetColumnId,
      taskId: Number(card.taskId())
    }
  }
}

export default TaskBoardSyncResource
