import VelociousJob from "../../../../src/background-jobs/job.js"
import fs from "fs/promises"
import User from "../models/user.js"

export default class DbQueryJob extends VelociousJob {
  async perform(outputPath) {
    const users = await User.all().toArray()

    await fs.writeFile(outputPath, JSON.stringify({count: users.length}))
  }
}
