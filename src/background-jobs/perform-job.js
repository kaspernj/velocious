// @ts-check

/**
 * Performs a job class inside its declared database-connection scope.
 * @param {object} args - Performance options.
 * @param {import("../configuration.js").default} args.configuration - Active configuration.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {string} args.name - Connection-scope label.
 * @returns {Promise<void>} - Resolves after performance.
 */
export default async function performBackgroundJob({configuration, JobClass, jobArgs, name}) {
  const jobInstance = new JobClass()
  /**
   * Narrows the generic subclass's runtime method to serialized job arguments.
   * @type {(...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>}
   */
  const perform = jobInstance.perform

  await configuration.withConnections({databaseIdentifiers: JobClass.databaseIdentifiers, name}, async () => {
    await perform.apply(jobInstance, jobArgs)
  })
}
