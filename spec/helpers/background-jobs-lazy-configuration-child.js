// @ts-check

import {fileURLToPath} from "node:url"
import TestJob from "../dummy/src/jobs/test-job.js"

export const lazyConfigurationChildPath = fileURLToPath(import.meta.url)

async function run() {
  const outputPath = process.argv[2]

  if (!outputPath) throw new Error("Expected an output path")

  try {
    const jobId = await TestJob.performLater("lazy-configuration", outputPath)

    process.send?.({jobId, type: "enqueued"})
    process.disconnect?.()
  } catch (error) {
    process.send?.({error: error instanceof Error ? error.message : String(error), type: "error"})
    process.disconnect?.()
    process.exitCode = 1
  }
}

if (process.env.VELOCIOUS_LAZY_CONFIGURATION_CHILD === "1") await run()
