import {performance} from "node:perf_hooks"
import path from "node:path"
import {fileURLToPath} from "node:url"
import dummyConfiguration from "../spec/dummy/src/config/configuration.js"
import Dummy from "../spec/dummy/index.js"
import Comment from "../spec/dummy/src/models/comment.js"
import FrontendModelController from "../src/frontend-model-controller.js"
import Project from "../spec/dummy/src/models/project.js"
import Task from "../spec/dummy/src/models/task.js"
import {withSourcePeerPackage} from "../src/environment-handlers/node/source-peer-package.js"

const modelCount = 500
const iterations = 20
const url = "http://localhost:3006/frontend-models"
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

dummyConfiguration.setEnvironment("test")

/** @param {number[]} values - Measurements. @returns {number} - 95th percentile. */
function p95(values) {
  return [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1]
}

/**
 * Instruments resource-resolution counters for the duration of a callback.
 * @param {() => Promise<void>} callback - Measured work.
 * @returns {Promise<{resourceInstanceResolutions: number}>} - Counters.
 */
async function measureResourceResolutions(callback) {
  let resourceInstanceResolutions = 0
  const originalSerializationResourceInstanceForModel = FrontendModelController.prototype._serializationResourceInstanceForModel
  const originalFrontendModelResourceInstance = FrontendModelController.prototype.frontendModelResourceInstance

  FrontendModelController.prototype._serializationResourceInstanceForModel = function(model) {
    resourceInstanceResolutions += 1

    return originalSerializationResourceInstanceForModel.call(this, model)
  }

  FrontendModelController.prototype.frontendModelResourceInstance = function() {
    resourceInstanceResolutions += 1

    return originalFrontendModelResourceInstance.call(this)
  }

  try {
    await callback()
  } finally {
    FrontendModelController.prototype._serializationResourceInstanceForModel = originalSerializationResourceInstanceForModel
    FrontendModelController.prototype.frontendModelResourceInstance = originalFrontendModelResourceInstance
  }

  return {resourceInstanceResolutions}
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

    const body = JSON.stringify({
      requests: [{
        commandType: "index",
        model: "Task",
        payload: {
          limit: modelCount,
          preload: ["project", "comments"]
        },
        requestId: "1"
      }]
    })

    // Warm-up request to prime connections and caches.
    const warmUpResponse = await fetch(url, {
      body,
      headers: {"content-type": "application/json"},
      method: "POST"
    })

    if (!warmUpResponse.ok) {
      throw new Error(`Frontend-model warm-up failed: ${warmUpResponse.status} ${await warmUpResponse.text()}`)
    }

    const latencies = []
    let totalResourceInstanceResolutions = 0

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const counters = await measureResourceResolutions(async () => {
        const startedAt = performance.now()
        const response = await fetch(url, {
          body,
          headers: {"content-type": "application/json"},
          method: "POST"
        })

        if (!response.ok) {
          throw new Error(`Frontend-model index failed: ${response.status} ${await response.text()}`)
        }

        latencies.push(performance.now() - startedAt)
      })

      totalResourceInstanceResolutions += counters.resourceInstanceResolutions
    }

    console.log("models\titerations\tp95 ms\tresource-instance resolutions/op")
    console.log(`${modelCount}\t${iterations}\t${p95(latencies).toFixed(2)} ms\t${Math.round(totalResourceInstanceResolutions / iterations)}`)
  })

  await Dummy.teardown()
})
