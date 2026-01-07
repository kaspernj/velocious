import VelociousJob from "../../../../src/background-jobs/job.js"
import fs from "fs/promises"
import wait from "awaitery/build/wait.js"

export default class DelayedJob extends VelociousJob {
  async perform(value, outputPath) {
    await wait(0.5)
    await fs.writeFile(outputPath, JSON.stringify({value}))
  }
}
