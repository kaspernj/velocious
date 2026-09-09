// @ts-check

import VelociousJob from "./platform-job.js"

/** Static, bundler-safe local background-job registry. */
export default class LocalBackgroundJobRegistry {
  /**
   * Creates a registry from the configuration's statically imported job classes.
   * @param {{jobClasses: Array<typeof VelociousJob>}} args - Registry options.
   */
  constructor({jobClasses}) {
    this.jobClasses = jobClasses
    /** @type {Map<string, typeof VelociousJob> | undefined} */
    this.jobsByName = undefined
  }

  /**
   * Validates and indexes the configured job classes.
   * @returns {void} - No return value.
   */
  ensureReady() {
    if (this.jobsByName) return
    if (!Array.isArray(this.jobClasses)) throw new TypeError("backgroundJobs.jobClasses must be an array")

    const jobsByName = new Map()

    for (const JobClass of this.jobClasses) {
      if (typeof JobClass !== "function" || JobClass === VelociousJob || !(JobClass.prototype instanceof VelociousJob)) {
        throw new TypeError("backgroundJobs.jobClasses must contain VelociousJob subclasses")
      }

      const jobName = JobClass.jobName()

      if (typeof jobName !== "string" || jobName.trim().length === 0) {
        throw new TypeError("backgroundJobs.jobClasses must declare non-empty job names")
      }
      if (jobsByName.has(jobName)) throw new Error(`Duplicate local background job name: ${jobName}`)

      jobsByName.set(jobName, JobClass)
    }

    this.jobsByName = jobsByName
  }

  /**
   * Resolves a registered class.
   * @param {string} jobName - Persisted job name.
   * @returns {typeof VelociousJob} - Registered class.
   */
  resolve(jobName) {
    this.ensureReady()

    const JobClass = this.jobsByName?.get(jobName)

    if (!JobClass) throw new Error(`Local background job is not registered in backgroundJobs.jobClasses: ${jobName}`)

    return JobClass
  }
}
