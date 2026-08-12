// @ts-check

import fs from "node:fs/promises"
import VelociousJob from "../../../../src/background-jobs/job.js"

export default class RescheduleTestJob extends VelociousJob {
  /** @param {string} outputPath - Output file. @param {number} delayMs - Reschedule delay. */
  async perform(outputPath, delayMs) {
    let runs = 0
    try {
      runs = JSON.parse(await fs.readFile(outputPath, "utf8")).runs
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
    }

    runs += 1
    await fs.writeFile(outputPath, JSON.stringify({runs}))
    if (runs === 1) this.rescheduleIn(delayMs)
  }
}
