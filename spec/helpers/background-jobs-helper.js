// @ts-check

import fs from "fs/promises"
import path from "path"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import AsyncTrackedMultiConnectionPool from "../../src/database/pool/async-tracked-multi-connection.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * Clears only framework background-job persistence.
 * @returns {Promise<BackgroundJobsStore>} - Cleared background jobs store.
 */
export async function clearBackgroundJobs() {
  dummyConfiguration.setCurrent()
  const store = new BackgroundJobsStore({configuration: dummyConfiguration})

  await store.clearAll()

  return store
}

/**
 * @param {object} [args] - Options.
 * @param {ConstructorParameters<typeof BackgroundJobsWorker>[0]} [args.workerOptions] - Worker constructor options.
 * @returns {Promise<{main: BackgroundJobsMain, store: BackgroundJobsStore, worker: BackgroundJobsWorker}>} - Started background job processes.
 */
export async function startBackgroundJobs({workerOptions = {}} = {}) {
  const {main, store, stopped} = await startBackgroundJobsMain({waitForWorkerStop: true})

  dummyConfiguration.setBackgroundJobsConfig({
    host: "127.0.0.1",
    port: main.getPort()
  })

  const {onStopped, ...resolvedWorkerOptions} = workerOptions
  const worker = new BackgroundJobsWorker({
    closeDatabaseConnectionsOnStop: false,
    configuration: dummyConfiguration,
    onStopped: async () => {
      try {
        await onStopped?.()
      } finally {
        await stopped("worker")
      }
    },
    ...resolvedWorkerOptions
  })
  await worker.start()

  return {main, store, worker}
}

/**
 * @param {object} [args] - Options.
 * @param {import("../../src/configuration-types.js").BackgroundJobsConfiguration} [args.backgroundJobsConfig] - Background jobs config override.
 * @param {boolean} [args.waitForWorkerStop] - Wait for the paired worker before closing shared test connections.
 * @returns {Promise<{main: BackgroundJobsMain, store: BackgroundJobsStore, stopped: (service: string) => Promise<void>}>} - Started main process and cleared store.
 */
export async function startBackgroundJobsMain({backgroundJobsConfig, waitForWorkerStop = false} = {}) {
  if (backgroundJobsConfig) dummyConfiguration.setBackgroundJobsConfig(backgroundJobsConfig)

  const store = await clearBackgroundJobs()

  const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

  if (pool instanceof AsyncTrackedMultiConnectionPool) {
    pool.setTestSharedConnection(pool.getCurrentConnection())
  }

  const stoppedServices = new Set()
  if (!waitForWorkerStop) stoppedServices.add("worker")
  let connectionsClosed = false
  const stopped = async (service) => {
    stoppedServices.add(service)
    if (connectionsClosed || !stoppedServices.has("main") || !stoppedServices.has("worker")) return

    connectionsClosed = true

    if (pool instanceof AsyncTrackedMultiConnectionPool) {
      pool.clearTestSharedConnection()
      AsyncTrackedMultiConnectionPool.clearGlobalConnections(dummyConfiguration)
    } else if (pool.getCurrentConnection().insideTransaction()) {
      // TestRunner owns this physical connection and rolls it back after the
      // background-job broker has drained. Closing it here would implicitly end
      // SQLite's transaction before the test lifecycle can roll back child work.
      return
    } else {
      await dummyConfiguration.closeDatabaseConnections()
      await dummyConfiguration.initializeModels()
    }
  }

  const main = new BackgroundJobsMain({
    closeDatabaseConnectionsOnStop: false,
    configuration: dummyConfiguration,
    host: "127.0.0.1",
    onStopped: () => stopped("main"),
    port: 0
  })
  await main.start()

  return {main, store, stopped}
}

/**
 * @param {string} prefix - File name prefix.
 * @returns {Promise<string>} - Temp output path.
 */
export async function outputPathFor(prefix) {
  const tmpDir = path.join(dummyConfiguration.getDirectory(), "tmp")
  await fs.mkdir(tmpDir, {recursive: true})

  return path.join(tmpDir, `${prefix}-${Date.now()}.json`)
}

/**
 * @param {object} args - Options.
 * @param {string} args.outputPath - File to wait for and parse.
 * @param {(value: any) => boolean} [args.predicate] - Predicate that must match the parsed JSON.
 * @param {number} [args.timeoutSeconds] - Timeout in seconds.
 * @returns {Promise<any>} - Parsed JSON.
 */
export async function waitForOutputJson({outputPath, predicate, timeoutSeconds = 2}) {
  let result

  await timeout({timeout: timeoutSeconds * 1000}, async () => {
    while (true) {
      result = await readOutputJson(outputPath)
      if (matchesOutputJson({predicate, result})) break

      await wait(0.05)
    }
  })

  return result
}

/**
 * @param {string} outputPath - Output path.
 * @returns {Promise<any | undefined>} - Parsed JSON when readable.
 */
async function readOutputJson(outputPath) {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8"))
  } catch {
    return undefined
  }
}

/**
 * @param {object} args - Options.
 * @param {(value: any) => boolean} [args.predicate] - Predicate that must match the parsed JSON.
 * @param {any} args.result - Parsed JSON result.
 * @returns {boolean} - Whether the parsed value matches.
 */
function matchesOutputJson({predicate, result}) {
  if (result === undefined) return false
  if (!predicate) return true

  return predicate(result)
}

/**
 * @param {object} args - Options.
 * @param {string} args.jobId - Job id.
 * @param {BackgroundJobsStore} args.store - Background jobs store.
 * @param {number} [args.timeoutSeconds] - Timeout in seconds.
 * @returns {Promise<void>} - Resolves when completed.
 */
export async function waitForJobCompleted({jobId, store, timeoutSeconds = 2}) {
  await timeout({timeout: timeoutSeconds * 1000}, async () => {
    while (true) {
      if (await jobCompleted({jobId, store})) break
      await wait(0.05)
    }
  })
}

/**
 * @param {object} args - Options.
 * @param {string} args.jobId - Job id.
 * @param {BackgroundJobsStore} args.store - Background jobs store.
 * @returns {Promise<boolean>} - Whether the job is completed.
 */
async function jobCompleted({jobId, store}) {
  const job = await store.getJob(jobId)
  if (job?.status === "failed") throw new Error(`Job failed: ${job.lastError}`)

  return job?.status === "completed"
}
