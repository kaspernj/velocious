import {performance} from "node:perf_hooks"
import Configuration from "../src/configuration.js"
import Dummy from "../spec/dummy/index.js"
import dummyConfiguration from "../spec/dummy/src/config/configuration.js"
import Project from "../spec/dummy/src/models/project.js"
import RequestTiming from "../src/http-server/client/request-timing.js"
import Task from "../spec/dummy/src/models/task.js"
import {normalizeQueryDataSpec, runQueryData} from "../src/database/query/query-data.js"
import {normalizeWithCount, runWithCount} from "../src/database/query/with-count.js"

const iterations = 40

dummyConfiguration.setEnvironment("test")

Project.queryData("roundtripTaskCount", ({driver, query}) => {
  query.joins({tasks: true})
  const tasks = driver.quoteTable(query.tableNameFor("tasks"))
  query.select(`COUNT(${tasks}.${driver.quoteColumn("id")}) AS ${driver.quoteColumn("roundtripTaskCount")}`)
})

Project.queryData("roundtripTaskMaximumId", ({driver, query}) => {
  query.joins({tasks: true})
  const tasks = driver.quoteTable(query.tableNameFor("tasks"))
  query.select(`MAX(${tasks}.${driver.quoteColumn("id")}) AS ${driver.quoteColumn("roundtripTaskMaximumId")}`)
})

/** @param {number[]} values - Measurements. @returns {number} - 95th percentile. */
function p95(values) {
  return [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1]
}

/**
 * Measures one runner repeatedly with repository request instrumentation.
 * @param {() => Promise<void>} callback - Measured database work.
 * @returns {Promise<{p95Ms: number, pendingCheckouts: number, queries: number, inUseConnections: number}>} - Measurement.
 */
async function measure(callback) {
  const latencies = []
  let queries = 0

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const timing = new RequestTiming()
    const startedAt = performance.now()

    await Configuration.current().getEnvironmentHandler().runWithRequestTiming(timing, callback)
    latencies.push(performance.now() - startedAt)
    queries += timing.dbQueryCount
  }

  const poolSnapshot = Configuration.current().getDatabasePool().getDebugSnapshot()

  return {
    inUseConnections: poolSnapshot.inUseCount,
    p95Ms: p95(latencies),
    pendingCheckouts: poolSnapshot.pendingCheckoutCount,
    queries: queries / iterations
  }
}

await Dummy.run(async () => {
  const connection = Project.connection()

  await connection.truncateAllTables()

  const project = await Project.create({nameEn: "Roundtrips", nameDe: "Roundtrips"})

  for (let index = 0; index < 20; index += 1) {
    await Task.create({isDone: true, name: `Task ${index}`, project})
  }

  const withCountEntries = normalizeWithCount({
    completedTasksCount: {relationship: "tasks", where: {isDone: true}},
    doneTasksCount: {relationship: "tasks", where: {isDone: true}}
  })
  const queryDataEntries = normalizeQueryDataSpec(["roundtripTaskCount", "roundtripTaskMaximumId"])

  const baseline = await measure(async () => {
    const rootModels = await Project.where({id: project.id()}).toArray()

    for (const entry of withCountEntries) {
      await runWithCount({entries: [entry], modelClass: Project, models: rootModels})
    }

    for (const entry of queryDataEntries) {
      await runQueryData({entries: [entry], rootModelClass: Project, rootModels})
    }
  })
  const optimized = await measure(async () => {
    const rootModels = await Project.where({id: project.id()}).toArray()

    await runWithCount({entries: withCountEntries, modelClass: Project, models: rootModels})
    await runQueryData({entries: queryDataEntries, rootModelClass: Project, rootModels})
  })

  console.log("path\tqueries/op\tp95\tpool pending\tpool in-use")
  console.log(`sequential\t${baseline.queries}\t${baseline.p95Ms.toFixed(2)} ms\t${baseline.pendingCheckouts}\t${baseline.inUseConnections}`)
  console.log(`batched\t${optimized.queries}\t${optimized.p95Ms.toFixed(2)} ms\t${optimized.pendingCheckouts}\t${optimized.inUseConnections}`)
})

await Dummy.teardown()
