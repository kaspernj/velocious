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

const defaultBackgroundJobsConfig = dummyConfiguration.getBackgroundJobsConfig()
const generationConfigKeys = new Set(["generationId", "initialGenerationState", "lifecycleSocketPath"])
const legacyDefaultBackgroundJobsConfig = Object.fromEntries(
  Object.entries(defaultBackgroundJobsConfig).filter(([key]) => !generationConfigKeys.has(key))
)

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
 * @param {import("../../src/configuration-types.js").BackgroundJobsConfiguration} [args.backgroundJobsConfig] - Main adapter configuration.
 * @param {ConstructorParameters<typeof BackgroundJobsWorker>[0]} [args.workerOptions] - Worker constructor options.
 * @returns {Promise<{main: BackgroundJobsMain, store: BackgroundJobsStore, worker: BackgroundJobsWorker}>} - Started background job processes.
 */
export async function startBackgroundJobs({backgroundJobsConfig, workerOptions = {}} = {}) {
  const {main, store, stopped} = await startBackgroundJobsMain({backgroundJobsConfig, waitForWorkerStop: true})

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
 * Runs a callback with an owned main/worker pair and stops both services before returning or throwing.
 * @template T
 * @param {(backgroundJobs: {main: BackgroundJobsMain, store: BackgroundJobsStore, worker: BackgroundJobsWorker}) => Promise<T>} callback - Owned background-jobs callback.
 * @param {object} [args] - Start options.
 * @param {(args: {workerOptions?: ConstructorParameters<typeof BackgroundJobsWorker>[0]}) => Promise<{main: BackgroundJobsMain, store: BackgroundJobsStore, worker: BackgroundJobsWorker}>} [args.start] - Service factory override for lifecycle tests.
 * @param {ConstructorParameters<typeof BackgroundJobsWorker>[0]} [args.workerOptions] - Worker constructor options.
 * @returns {Promise<T>} - Callback result after both services stop.
 */
export async function withBackgroundJobs(callback, args) {
  const start = args?.start || startBackgroundJobs
  const backgroundJobs = await start({workerOptions: args?.workerOptions})
  let callbackFailed = false
  let callbackError
  /** @type {T} */
  let result

  try {
    result = await callback(backgroundJobs)
  } catch (error) {
    callbackFailed = true
    callbackError = error
  }

  const cleanupErrors = []

  try {
    await backgroundJobs.worker.stop()
  } catch (error) {
    cleanupErrors.push(error)
  }

  try {
    await backgroundJobs.main.stop()
  } catch (error) {
    cleanupErrors.push(error)
  }

  if (callbackFailed && cleanupErrors.length > 0) {
    throw new AggregateError(
      [callbackError, ...cleanupErrors],
      "Background jobs callback and cleanup failed",
      {cause: callbackError}
    )
  }

  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, "Background jobs cleanup failed", {cause: cleanupErrors[0]})
  }

  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (callbackFailed) throw callbackError

  return result
}

/**
 * @param {object} [args] - Options.
 * @param {import("../../src/configuration-types.js").BackgroundJobsConfiguration} [args.backgroundJobsConfig] - Background jobs config override.
 * @param {boolean} [args.waitForWorkerStop] - Wait for the paired worker before closing shared test connections.
 * @returns {Promise<{main: BackgroundJobsMain, store: BackgroundJobsStore, stopped: (service: string) => Promise<void>}>} - Started main process and cleared store.
 */
export async function startBackgroundJobsMain({backgroundJobsConfig, waitForWorkerStop = false} = {}) {
  await dummyConfiguration.closeBackgroundJobsAdapter()
  dummyConfiguration.setBackgroundJobsConfig({
    ...legacyDefaultBackgroundJobsConfig,
    adapter: undefined,
    generationId: undefined,
    initialGenerationState: undefined,
    jobClasses: [...legacyDefaultBackgroundJobsConfig.jobClasses],
    lifecycleSocketPath: undefined,
    queues: {...legacyDefaultBackgroundJobsConfig.queues},
    retention: {...legacyDefaultBackgroundJobsConfig.retention},
    ...backgroundJobsConfig
  })

  const store = await clearBackgroundJobs()

  const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

  const stoppedServices = new Set()
  if (!waitForWorkerStop) stoppedServices.add("worker")
  let connectionsClosed = false
  const stopped = async (service) => {
    stoppedServices.add(service)
    if (connectionsClosed || !stoppedServices.has("main") || !stoppedServices.has("worker")) return

    connectionsClosed = true

    if (pool instanceof AsyncTrackedMultiConnectionPool) {
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
