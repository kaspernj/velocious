// @ts-check

import fs from "node:fs/promises"
import VelociousJob from "../../../../src/background-jobs/job.js"

export default class PooledRunnerTestJob extends VelociousJob {
  /** Records the runner pid for reuse assertions. @param {string} outputPath - Output file. */
  async perform(outputPath) {
    let pids = []
    try {
      pids = JSON.parse(await fs.readFile(outputPath, "utf8"))
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
    }
    pids.push(process.pid)
    await fs.writeFile(outputPath, JSON.stringify(pids))
  }
}
