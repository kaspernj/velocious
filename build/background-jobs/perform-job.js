// @ts-check

/**
 * Performs a job class inside its declared database-connection scope.
 * @param {object} args - Performance options.
 * @param {import("../configuration.js").default} args.configuration - Active configuration.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions} [args.jobOptions] - Resolved runtime options.
 * @param {string} args.name - Connection-scope label.
 * @param {import("./types.js").BackgroundJobPayload} [args.payload] - Persisted runner payload.
 * @returns {Promise<void>} - Resolves after performance.
 */
export default async function performBackgroundJob({configuration, JobClass, jobArgs, jobOptions = {}, name, payload}) {
  const jobInstance = new JobClass()
  jobInstance._setBackgroundJobContext({
    args: jobArgs,
    jobClass: JobClass,
    jobName: JobClass.jobName(),
    options: jobOptions,
    ...(payload ? {payload} : {})
  })
  /**
   * Narrows the generic subclass's runtime method to serialized job arguments.
   * @type {(...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>}
   */
  const perform = jobInstance.perform

  await configuration.withConnections({databaseIdentifiers: JobClass.databaseIdentifiers, name}, async () => {
    await perform.apply(jobInstance, jobArgs)
  })
}
