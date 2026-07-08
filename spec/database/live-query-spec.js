// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import LiveQuery from "../../src/database/live-query.js"
import Project from "../dummy/src/models/project.js"
import recordChanges from "../../src/database/record-changes.js"
import Task from "../dummy/src/models/task.js"

/**
 * Builds a structural live-query source over the given project's tasks with a run counter.
 * @param {import("../dummy/src/models/project.js").default} project - Project whose tasks are queried.
 * @returns {{getRunCount: () => number, source: import("../../src/database/live-query.js").LiveQuerySource<InstanceType<typeof Task>>}} Query source and run counter.
 */
function buildTaskLiveQuerySource(project) {
  let runCount = 0

  return {
    getRunCount: () => runCount,
    source: {
      getModelClass: () => Task,
      toArray: async () => {
        runCount++

        return await Task.where({projectId: project.id()}).toArray()
      }
    }
  }
}

describe("database - live query", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("starts loading and resolves to the initial results", async () => {
    const project = await Project.create({name: "Live query initial project"})

    await Task.create({name: "Initial task 1", projectId: project.id()})
    await Task.create({name: "Initial task 2", projectId: project.id()})

    const {source} = buildTaskLiveQuerySource(project)
    const liveQuery = new LiveQuery({query: source})

    try {
      expect(liveQuery.getState().loading).toBe(true)

      liveQuery.start()

      await liveQuery.whenSettled()

      expect(liveQuery.getState().loading).toBe(false)
      expect(liveQuery.getState().results).toHaveLength(2)
    } finally {
      liveQuery.close()
    }
  })

  it("re-runs the query when a matching model changes", async () => {
    const project = await Project.create({name: "Live query matching project"})

    await Task.create({name: "Existing task", projectId: project.id()})

    const {source} = buildTaskLiveQuerySource(project)
    const liveQuery = new LiveQuery({query: source})

    try {
      liveQuery.start()
      await liveQuery.whenSettled()

      expect(liveQuery.getState().results).toHaveLength(1)

      await Task.create({name: "Added task", projectId: project.id()})
      await liveQuery.whenSettled()

      expect(liveQuery.getState().results).toHaveLength(2)
    } finally {
      liveQuery.close()
    }
  })

  it("does not re-run the query when an unrelated model changes", async () => {
    const project = await Project.create({name: "Live query unrelated project"})

    await Task.create({name: "Unrelated baseline task", projectId: project.id()})

    const {getRunCount, source} = buildTaskLiveQuerySource(project)
    const liveQuery = new LiveQuery({query: source})

    try {
      liveQuery.start()
      await liveQuery.whenSettled()

      expect(getRunCount()).toEqual(1)

      await Project.create({name: "Some other project"})
      await liveQuery.whenSettled()

      expect(getRunCount()).toEqual(1)
    } finally {
      liveQuery.close()
    }
  })

  it("coalesces a batch of many changes into a single re-run", async () => {
    const project = await Project.create({name: "Live query batch project"})

    await Task.create({name: "Batch baseline task", projectId: project.id()})

    const {getRunCount, source} = buildTaskLiveQuerySource(project)
    const liveQuery = new LiveQuery({query: source})

    try {
      liveQuery.start()
      await liveQuery.whenSettled()

      const runCountAfterInitial = getRunCount()

      await recordChanges.batch(async () => {
        await Task.create({name: "Batch task 1", projectId: project.id()})
        await Task.create({name: "Batch task 2", projectId: project.id()})
        await Task.create({name: "Batch task 3", projectId: project.id()})
      })
      await liveQuery.whenSettled()

      expect(getRunCount() - runCountAfterInitial).toEqual(1)
      expect(liveQuery.getState().results).toHaveLength(4)
    } finally {
      liveQuery.close()
    }
  })

  it("stops re-running after close", async () => {
    const project = await Project.create({name: "Live query close project"})

    await Task.create({name: "Close baseline task", projectId: project.id()})

    const {getRunCount, source} = buildTaskLiveQuerySource(project)
    const liveQuery = new LiveQuery({query: source})

    liveQuery.start()
    await liveQuery.whenSettled()

    const runCountAfterInitial = getRunCount()

    liveQuery.close()

    await Task.create({name: "Task after close", projectId: project.id()})
    await liveQuery.whenSettled()

    expect(getRunCount()).toEqual(runCountAfterInitial)
    expect(liveQuery.getState().results).toHaveLength(1)
  })

  it("notifies subscribers when the results change", async () => {
    const project = await Project.create({name: "Live query notify project"})

    await Task.create({name: "Notify baseline task", projectId: project.id()})

    const {source} = buildTaskLiveQuerySource(project)
    const liveQuery = new LiveQuery({query: source})
    let notifications = 0
    const unsubscribe = liveQuery.subscribe(() => {
      notifications++
    })

    try {
      liveQuery.start()
      await liveQuery.whenSettled()

      expect(notifications).toEqual(1)

      await Task.create({name: "Notify added task", projectId: project.id()})
      await liveQuery.whenSettled()

      expect(notifications).toEqual(2)
    } finally {
      unsubscribe()
      liveQuery.close()
    }
  })
})
