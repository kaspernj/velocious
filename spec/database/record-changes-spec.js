// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Comment from "../dummy/src/models/comment.js"
import Project from "../dummy/src/models/project.js"
import recordChanges from "../../src/database/record-changes.js"
import Task from "../dummy/src/models/task.js"

/**
 * Subscribes a counting listener to a model class' record changes.
 * @param {typeof import("../../src/database/record/index.js").default} modelClass - Model class to observe.
 * @returns {{events: import("../../src/database/record-changes.js").RecordChangeEvent[], unsubscribe: () => void}} Captured events and unsubscribe.
 */
function captureChanges(modelClass) {
  /** @type {import("../../src/database/record-changes.js").RecordChangeEvent[]} */
  const events = []
  const unsubscribe = recordChanges.subscribe(modelClass, (event) => {
    events.push(event)
  })

  return {events, unsubscribe}
}

describe("database - record changes", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("emits a change event once per commit for a create", async () => {
    const {events, unsubscribe} = captureChanges(Task)
    const project = await Project.create({name: "Record change create project"})

    try {
      const task = await Task.create({name: "Created task", projectId: project.id()})

      expect(events).toHaveLength(1)
      expect(events[0].operation).toEqual("create")
      expect(events[0].modelClass).toBe(Task)
      expect(events[0].record).toBe(task)
    } finally {
      unsubscribe()
    }
  })

  it("emits an update change event once per commit for an update", async () => {
    const project = await Project.create({name: "Record change update project"})
    const task = await Task.create({name: "Task before update", projectId: project.id()})
    const {events, unsubscribe} = captureChanges(Task)

    try {
      task.assign({name: "Task after update"})
      await task.save()

      expect(events).toHaveLength(1)
      expect(events[0].operation).toEqual("update")
    } finally {
      unsubscribe()
    }
  })

  it("emits a destroy change event once per commit for a destroy", async () => {
    const project = await Project.create({name: "Record change destroy project"})
    const task = await Task.create({name: "Task to destroy", projectId: project.id()})
    const {events, unsubscribe} = captureChanges(Task)

    try {
      await task.destroy()

      expect(events).toHaveLength(1)
      expect(events[0].operation).toEqual("destroy")
    } finally {
      unsubscribe()
    }
  })

  it("does not emit a change event for rolled-back saves", async () => {
    const {events, unsubscribe} = captureChanges(Task)
    const project = await Project.create({name: "Record change rollback project"})

    try {
      await expect(async () => {
        await Task.transaction(async () => {
          await Task.create({name: "Rolled back task", projectId: project.id()})

          throw new Error("Roll the save back")
        })
      }).toThrow(/Roll the save back/u)

      expect(events).toHaveLength(0)
    } finally {
      unsubscribe()
    }
  })

  it("does not notify subscribers of unrelated model classes", async () => {
    const {events: commentEvents, unsubscribe} = captureChanges(Comment)
    const project = await Project.create({name: "Record change unrelated project"})

    try {
      await Task.create({name: "Task without comment change", projectId: project.id()})

      expect(commentEvents).toHaveLength(0)
    } finally {
      unsubscribe()
    }
  })

  it("coalesces a batch of many commits into a single flush per model class", async () => {
    const {events, unsubscribe} = captureChanges(Task)
    const project = await Project.create({name: "Record change batch project"})

    try {
      await recordChanges.batch(async () => {
        await Task.create({name: "Batch task 1", projectId: project.id()})
        await Task.create({name: "Batch task 2", projectId: project.id()})
        await Task.create({name: "Batch task 3", projectId: project.id()})

        expect(events).toHaveLength(0)
      })

      expect(events).toHaveLength(1)
    } finally {
      unsubscribe()
    }
  })

  it("stops notifying after unsubscribe", async () => {
    const {events, unsubscribe} = captureChanges(Task)
    const project = await Project.create({name: "Record change unsubscribe project"})

    unsubscribe()

    await Task.create({name: "Task after unsubscribe", projectId: project.id()})

    expect(events).toHaveLength(0)
  })
})
