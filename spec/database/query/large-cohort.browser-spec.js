// @ts-check

import Configuration from "../../../src/configuration.js"
import Preloader from "../../../src/database/query/preloader.js"
import Project from "../../dummy/src/models/project.js"
import RequestTiming from "../../../src/http-server/client/request-timing.js"
import Task from "../../dummy/src/models/task.js"

// Module-level registration, unique to this spec to avoid collisions.
Project.queryData("largeCohortTaskCount", ({driver, query}) => {
  query.joins({tasks: true})
  const tasksTable = driver.quoteTable(query.tableNameFor("tasks"))
  const idCol = driver.quoteColumn("id")
  query.select(`COUNT(${tasksTable}.${idCol}) AS ${driver.quoteColumn("largeCohortTaskCount")}`)
})

const now = new Date()
const cohortSize = 10001

/**
 * @param {number} count
 * @returns {Array<Array<ReturnType<typeof JSON.parse>>>}
 */
function projectRows(count) {
  /** @type {Array<Array<ReturnType<typeof JSON.parse>>>} */
  const rows = []

  for (let index = 0; index < count; index += 1) {
    rows.push([0, now, now])
  }

  return rows
}

/**
 * @param {Project[]} projects
 * @returns {Array<Array<ReturnType<typeof JSON.parse>>>}
 */
function taskRows(projects) {
  /** @type {Array<Array<ReturnType<typeof JSON.parse>>>} */
  const rows = []

  for (let index = 0; index < projects.length; index += 1) {
    rows.push([projects[index].id(), `Cohort task ${index}`, false, now, now])
  }

  return rows
}

describe("Database - query - large IN cohorts", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("chunks preload, withCount, and queryData across >10k parents", async () => {
    await Project.insertMultiple(["tasks_count", "created_at", "updated_at"], projectRows(cohortSize))
    const projects = await Project.order("id ASC").toArray()
    await Task.insertMultiple(["project_id", "name", "is_done", "created_at", "updated_at"], taskRows(projects))

    expect(projects.length).toEqual(cohortSize)

    const tasks = await Task.order("id ASC").toArray()
    const belongsToTiming = new RequestTiming()

    await Configuration.current().getEnvironmentHandler().runWithRequestTiming(belongsToTiming, async () => {
      await Preloader.preload(tasks, Task.preload("project"))
    })

    expect(tasks.length).toEqual(cohortSize)
    expect(tasks[0].project().id()).toEqual(tasks[0].projectId())
    expect(tasks[tasks.length - 1].project().id()).toEqual(tasks[tasks.length - 1].projectId())
    expect(belongsToTiming.dbQueryCount).toBeGreaterThan(1)

    const hasManyTiming = new RequestTiming()

    await Configuration.current().getEnvironmentHandler().runWithRequestTiming(hasManyTiming, async () => {
      await Preloader.preload(projects, Project.preload("tasks"))
    })

    expect(projects[0].tasksLoaded().length).toEqual(1)
    expect(projects[0].tasksLoaded()[0].projectId()).toEqual(projects[0].id())
    expect(projects[projects.length - 1].tasksLoaded().length).toEqual(1)
    expect(hasManyTiming.dbQueryCount).toBeGreaterThan(1)

    const hasOneTiming = new RequestTiming()

    await Configuration.current().getEnvironmentHandler().runWithRequestTiming(hasOneTiming, async () => {
      await Preloader.preload(projects, Project.preload("reviewTask"))
    })

    expect(projects[0].reviewTask().projectId()).toEqual(projects[0].id())
    expect(projects[projects.length - 1].reviewTask().projectId()).toEqual(projects[projects.length - 1].id())
    expect(hasOneTiming.dbQueryCount).toBeGreaterThan(1)

    const withCountTiming = new RequestTiming()

    const projectsWithCount = await Configuration.current().getEnvironmentHandler().runWithRequestTiming(withCountTiming, async () => {
      return await Project.order("id ASC").withCount("tasks").toArray()
    })

    expect(projectsWithCount.length).toEqual(cohortSize)
    expect(projectsWithCount[0].readCount("tasksCount")).toEqual(1)
    expect(projectsWithCount[projectsWithCount.length - 1].readCount("tasksCount")).toEqual(1)
    expect(withCountTiming.dbQueryCount).toBeGreaterThan(1)

    const queryDataTiming = new RequestTiming()

    const projectsWithQueryData = await Configuration.current().getEnvironmentHandler().runWithRequestTiming(queryDataTiming, async () => {
      return await Project.order("id ASC").queryData("largeCohortTaskCount").toArray()
    })

    expect(projectsWithQueryData.length).toEqual(cohortSize)
    expect(Number(projectsWithQueryData[0].queryData("largeCohortTaskCount"))).toEqual(1)
    expect(Number(projectsWithQueryData[projectsWithQueryData.length - 1].queryData("largeCohortTaskCount"))).toEqual(1)
    expect(queryDataTiming.dbQueryCount).toBeGreaterThan(1)
  })
})
