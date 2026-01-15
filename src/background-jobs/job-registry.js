// @ts-check

import fs from "fs/promises"
import path from "path"
import VelociousJob from "./job.js"

export default class BackgroundJobRegistry {
  /**
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   */
  constructor({configuration}) {
    this.configuration = configuration
    /** @type {Map<string, typeof VelociousJob>} */
    this.jobsByName = new Map()
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async load() {
    const directory = this.configuration.getDirectory()
    const jobsDir = path.join(directory, "src", "jobs")
    await this._loadJobsFromDirectory(jobsDir, {skipDuplicates: false})

    const velociousPath = await this.configuration.getEnvironmentHandler().getVelociousPath()
    const velociousJobsDir = path.join(velociousPath, "src", "jobs")
    const normalizedJobsDir = path.resolve(jobsDir)
    const normalizedVelociousJobsDir = path.resolve(velociousJobsDir)

    if (normalizedJobsDir !== normalizedVelociousJobsDir) {
      await this._loadJobsFromDirectory(velociousJobsDir, {skipDuplicates: true})
    }
  }

  /**
   * @param {string} jobName - Job name.
   * @returns {typeof VelociousJob} - Job class.
   */
  getJobByName(jobName) {
    const jobClass = this.jobsByName.get(jobName)

    if (!jobClass) {
      throw new Error(`Unknown job "${jobName}". Check src/jobs`)
    }

    return jobClass
  }

  /**
   * @param {string} jobsDir - Directory with job files.
   * @param {object} args - Options.
   * @param {boolean} args.skipDuplicates - Whether to skip duplicate job names.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _loadJobsFromDirectory(jobsDir, {skipDuplicates}) {
    try {
      await fs.access(jobsDir)
    } catch {
      return
    }

    const jobFiles = fs.glob(`${jobsDir}/**/*.js`)

    for await (const jobFile of jobFiles) {
      const jobImport = await import(jobFile)
      const JobClass = jobImport.default

      if (!JobClass) throw new Error(`Job file must export a default class: ${jobFile}`)
      if (!(JobClass.prototype instanceof VelociousJob)) {
        throw new Error(`Job class must extend VelociousJob: ${jobFile}`)
      }

      const jobName = JobClass.jobName()

      if (this.jobsByName.has(jobName)) {
        if (skipDuplicates) continue

        throw new Error(`Duplicate job name "${jobName}" from ${jobFile}`)
      }

      this.jobsByName.set(jobName, JobClass)
    }
  }
}
