import VelociousJob from "../../../../src/background-jobs/job.js"
import fs from "fs/promises"

export default class AppendJob extends VelociousJob {
  async perform(value, outputPath) {
    let entries = []

    try {
      const contents = await fs.readFile(outputPath, "utf8")
      entries = JSON.parse(contents)
    } catch {
      // Ignore missing file.
    }

    entries.push(value)

    await fs.writeFile(outputPath, JSON.stringify(entries))
  }
}
