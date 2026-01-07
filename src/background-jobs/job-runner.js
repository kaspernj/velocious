// @ts-check

import configurationResolver from "../configuration-resolver.js"
import BackgroundJobRegistry from "./job-registry.js"
import BackgroundJobsStatusReporter from "./status-reporter.js"

/**
 * @param {object} payload - Payload.
 * @returns {Promise<void>} - Resolves when complete.
 */
export default async function runJobPayload(payload) {
  const configuration = await configurationResolver()
  configuration.setCurrent()
  await configuration.initialize({type: "background-jobs-runner"})
  const reporter = new BackgroundJobsStatusReporter({configuration})

  const registry = new BackgroundJobRegistry({configuration})
  await registry.load()
  const JobClass = registry.getJobByName(payload.jobName)
  const jobInstance = new JobClass()

  try {
    await jobInstance.perform.apply(jobInstance, payload.args || [])

    if (payload.id) {
      await reporter.reportWithRetry({jobId: payload.id, status: "completed"})
    }
  } catch (error) {
    if (payload.id) {
      await reporter.reportWithRetry({jobId: payload.id, status: "failed", error})
    }

    throw error
  }
}
