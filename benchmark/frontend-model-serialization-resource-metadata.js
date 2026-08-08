import { performance } from "node:perf_hooks"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dummyConfiguration from "../spec/dummy/src/config/configuration.js"
import Dummy from "../spec/dummy/index.js"
import Comment from "../spec/dummy/src/models/comment.js"
import FrontendModelController from "../src/frontend-model-controller.js"
import Project from "../spec/dummy/src/models/project.js"
import Task from "../spec/dummy/src/models/task.js"
import { withSourcePeerPackage } from "../src/environment-handlers/node/source-peer-package.js"

const modelCount = 500
const iterations = 20
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

dummyConfiguration.setEnvironment("test")

/** @param {number[]} values - Measurements. @returns {number} - 95th percentile. */
function p95(values) {
  return [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1]
}

/**
 * Builds a controller for direct serialization benchmarking.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Frontend-model params.
 * @returns {FrontendModelController} - Controller instance.
 */
function buildBenchmarkController(params) {
  const request = {
    baseURL: () => "http://localhost:3006",
    header: () => undefined,
    headers: () => ({}),
    httpMethod: () => "POST",
    params: () => params,
    path: () => "/benchmark-serialization"
  }
  const controller = new FrontendModelController({
    action: "index",
    configuration: dummyConfiguration,
    controller: "frontend_models",
    params,
    request,
    response: {},
    viewPath: dummyConfiguration.getDirectory()
  })

  // Bypass transport deserialization so the benchmark can feed plain params directly.
  controller._frontendModelParams = params

  return controller
}

await withSourcePeerPackage(projectDirectory, async () => {
  await Dummy.run(async () => {
    const connection = Task.connection()

    await connection.truncateAllTables()

    const project = await Project.create({name: "Benchmark project"})

    for (let index = 0; index < modelCount; index += 1) {
      const task = await Task.create({name: `Task ${index}`, project})

      await Comment.create({body: `Comment ${index}`, task})
    }

    const tasks = await Task.where({}).preload(["project", "comments"]).toArray()
    const params = {
      model: "Task",
      preload: ["project", "comments"]
    }

    // Warm-up serialization to prime caches.
    const warmUpController = buildBenchmarkController(params)

    await warmUpController.serializeFrontendModels(tasks)

    const latencies = []
    let totalResourceInstanceResolutions = 0

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const controller = buildBenchmarkController(params)
      let resourceInstanceResolutions = 0
      const cleanup = controller.setSerializationResourceInstanceHook(() => {
        resourceInstanceResolutions += 1
      })

      try {
        const startedAt = performance.now()

        await controller.serializeFrontendModels(tasks)
        latencies.push(performance.now() - startedAt)
      } finally {
        cleanup()
      }

      totalResourceInstanceResolutions += resourceInstanceResolutions
    }

    console.log("models\titerations\tp95 ms\tresource-instance resolutions/op")
    console.log(`${modelCount}\t${iterations}\t${p95(latencies).toFixed(2)} ms\t${Math.round(totalResourceInstanceResolutions / iterations)}`)
  })

  await Dummy.teardown()
})
