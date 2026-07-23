// @ts-check

import fs from "fs/promises"
import path from "path"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * @param {object} [args] - Options.
 * @param {ConstructorParameters<typeof BackgroundJobsWorker>[0]} [args.workerOptions] - Worker constructor options.
 * @returns {Promise<{main: BackgroundJobsMain, store: BackgroundJobsStore, worker: BackgroundJobsWorker}>} - Started background job processes.
 */
export async function startBackgroundJobs({workerOptions = {}} = {}) {
  const {main, store} = await startBackgroundJobsMain()

  dummyConfiguration.setBackgroundJobsConfig({
    host: "127.0.0.1",
    port: main.getPort()
  })

  const worker = new BackgroundJobsWorker({
    closeDatabaseConnectionsOnStop: false,
    configuration: dummyConfiguration,
    ...workerOptions
  })
  await worker.start()

  let connectionsClosed = false
  let mainStopped = false
  let workerStopped = false
  const originalMainStop = main.stop.bind(main)
  const originalWorkerStop = worker.stop.bind(worker)

  const closeConnectionsWhenStopped = async () => {
    if (connectionsClosed || !mainStopped || !workerStopped) return

    connectionsClosed = true
    await dummyConfiguration.closeDatabaseConnections()
  }

  main.stop = async () => {
    try {
      await originalMainStop()
    } finally {
      mainStopped = true
      await closeConnectionsWhenStopped()
    }
  }
  worker.stop = async () => {
    try {
      await originalWorkerStop()
    } finally {
      workerStopped = true
      await closeConnectionsWhenStopped()
    }
  }

  return {main, store, worker}
}

/**
 * @param {object} [args] - Options.
 * @param {import("../../src/configuration-types.js").BackgroundJobsConfiguration} [args.backgroundJobsConfig] - Background jobs config override.
 * @returns {Promise<{main: BackgroundJobsMain, store: BackgroundJobsStore}>} - Started main process and cleared store.
 */
export async function startBackgroundJobsMain({backgroundJobsConfig} = {}) {
  dummyConfiguration.setCurrent()
  if (backgroundJobsConfig) dummyConfiguration.setBackgroundJobsConfig(backgroundJobsConfig)

  const store = new BackgroundJobsStore({configuration: dummyConfiguration})
  await store.clearAll()

  const main = new BackgroundJobsMain({
    closeDatabaseConnectionsOnStop: false,
    configuration: dummyConfiguration,
    host: "127.0.0.1",
    port: 0
  })
  await main.start()

  return {main, store}
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
