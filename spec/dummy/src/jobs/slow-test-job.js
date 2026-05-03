import VelociousJob from "../../../../src/background-jobs/job.js"
import fs from "fs/promises"
import wait from "awaitery/build/wait.js"

export default class SlowTestJob extends VelociousJob {
  async perform(message, outputPath, delayMs) {
    await wait(delayMs)
    await fs.writeFile(outputPath, JSON.stringify({message}))
  }
}
