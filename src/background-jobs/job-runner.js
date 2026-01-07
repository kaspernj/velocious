// @ts-check

import configurationResolver from "../configuration-resolver.js"
import BackgroundJobRegistry from "./job-registry.js"

/**
 * @param {object} payload - Payload.
 * @returns {Promise<void>} - Resolves when complete.
 */
export default async function runJobPayload(payload) {
  const configuration = await configurationResolver()
  configuration.setCurrent()
  await configuration.initialize({type: "background-jobs-runner"})

  const registry = new BackgroundJobRegistry({configuration})
  await registry.load()
  const JobClass = registry.getJobByName(payload.jobName)
  const jobInstance = new JobClass()

  await jobInstance.perform.apply(jobInstance, payload.args || [])
}
