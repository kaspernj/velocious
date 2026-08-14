// @ts-check

import {fork} from "node:child_process"
import timeout from "awaitery/build/timeout.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {lazyConfigurationChildPath} from "../helpers/background-jobs-lazy-configuration-child.js"
import {outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson} from "../helpers/background-jobs-helper.js"

/**
 * Enqueues from a fresh Node process that has no current configuration.
 * @param {{outputPath: string, port: number}} args - Child options.
 * @returns {Promise<string>} - Enqueued job id.
 */
async function enqueueFromFreshProcess({outputPath, port}) {
  return await timeout({timeout: 5000}, async () => await new Promise((resolve, reject) => {
    const child = fork(lazyConfigurationChildPath, [outputPath], {
      cwd: dummyDirectory(),
      env: {
        ...process.env,
        MSSQL_SA_PASSWORD: process.env.MSSQL_SA_PASSWORD || "unused",
        VELOCIOUS_BACKGROUND_JOBS_HOST: "127.0.0.1",
        VELOCIOUS_BACKGROUND_JOBS_PORT: String(port),
        VELOCIOUS_DISABLE_MSSQL: "1",
        VELOCIOUS_LAZY_CONFIGURATION_CHILD: "1"
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"]
    })
    let settled = false

    child.once("error", reject)
    child.on("message", (message) => {
      if (!message || typeof message !== "object") return

      const typedMessage = /** @type {{error?: string, jobId?: string, type?: string}} */ (message)

      if (typedMessage.type === "error") {
        settled = true
        reject(new Error(typedMessage.error || "Fresh-process enqueue failed"))
      } else if (typedMessage.type === "enqueued" && typedMessage.jobId) {
        settled = true
        resolve(typedMessage.jobId)
      }
    })
    child.once("exit", (code) => {
      if (!settled) reject(new Error(`Fresh-process enqueue exited with status ${String(code)}`))
    })
  }))
}

describe("Background jobs - lazy Node configuration", {databaseCleaning: {truncate: true}}, () => {
  it("preserves VelociousJob configurationResolver lookup in a fresh process", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("lazy-node-configuration")

    try {
      const jobId = await enqueueFromFreshProcess({outputPath, port: main.getPort()})

      expect(await waitForOutputJson({outputPath})).toEqual({message: "lazy-configuration"})
      await waitForJobCompleted({jobId, store})
    } finally {
      await worker.stop()
      await main.stop()
    }
  })
})
