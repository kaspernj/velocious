import VelociousJob from "../../../../src/background-jobs/job.js"
import fs from "fs/promises"

export default class TestJob extends VelociousJob {
  async perform(message, outputPath) {
    await fs.writeFile(outputPath, JSON.stringify({message}))
  }
}
