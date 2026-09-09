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
export default async function performBackgroundJob({ configuration, JobClass, jobArgs, jobOptions = {}, name, payload }) {
    const jobInstance = new JobClass();
    jobInstance._setBackgroundJobContext({
        args: jobArgs,
        jobClass: JobClass,
        jobName: JobClass.jobName(),
        options: jobOptions,
        ...(payload ? { payload } : {})
    });
    /**
     * Narrows the generic subclass's runtime method to serialized job arguments.
     * @type {(...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>}
     */
    const perform = jobInstance.perform;
    await configuration.withConnections({ databaseIdentifiers: JobClass.databaseIdentifiers, name }, async () => {
        await perform.apply(jobInstance, jobArgs);
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGVyZm9ybS1qb2IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3BlcmZvcm0tam9iLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7Ozs7OztHQVVHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFVBQVUsb0JBQW9CLENBQUMsRUFBQyxhQUFhLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxVQUFVLEdBQUcsRUFBRSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7SUFDbkgsTUFBTSxXQUFXLEdBQUcsSUFBSSxRQUFRLEVBQUUsQ0FBQTtJQUNsQyxXQUFXLENBQUMsd0JBQXdCLENBQUM7UUFDbkMsSUFBSSxFQUFFLE9BQU87UUFDYixRQUFRLEVBQUUsUUFBUTtRQUNsQixPQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU8sRUFBRTtRQUMzQixPQUFPLEVBQUUsVUFBVTtRQUNuQixHQUFHLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFDLE9BQU8sRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7S0FDOUIsQ0FBQyxDQUFBO0lBQ0Y7OztPQUdHO0lBQ0gsTUFBTSxPQUFPLEdBQUcsV0FBVyxDQUFDLE9BQU8sQ0FBQTtJQUVuQyxNQUFNLGFBQWEsQ0FBQyxlQUFlLENBQUMsRUFBQyxtQkFBbUIsRUFBRSxRQUFRLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxFQUFDLEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDeEcsTUFBTSxPQUFPLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQTtJQUMzQyxDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBQZXJmb3JtcyBhIGpvYiBjbGFzcyBpbnNpZGUgaXRzIGRlY2xhcmVkIGRhdGFiYXNlLWNvbm5lY3Rpb24gc2NvcGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBlcmZvcm1hbmNlIG9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQWN0aXZlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL3BsYXRmb3JtLWpvYi5qc1wiKS5kZWZhdWx0fSBhcmdzLkpvYkNsYXNzIC0gSm9iIGNsYXNzLlxuICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muam9iQXJncyAtIEpvYiBhcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLmpvYk9wdGlvbnNdIC0gUmVzb2x2ZWQgcnVudGltZSBvcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIENvbm5lY3Rpb24tc2NvcGUgbGFiZWwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IFthcmdzLnBheWxvYWRdIC0gUGVyc2lzdGVkIHJ1bm5lciBwYXlsb2FkLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyZm9ybWFuY2UuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1CYWNrZ3JvdW5kSm9iKHtjb25maWd1cmF0aW9uLCBKb2JDbGFzcywgam9iQXJncywgam9iT3B0aW9ucyA9IHt9LCBuYW1lLCBwYXlsb2FkfSkge1xuICBjb25zdCBqb2JJbnN0YW5jZSA9IG5ldyBKb2JDbGFzcygpXG4gIGpvYkluc3RhbmNlLl9zZXRCYWNrZ3JvdW5kSm9iQ29udGV4dCh7XG4gICAgYXJnczogam9iQXJncyxcbiAgICBqb2JDbGFzczogSm9iQ2xhc3MsXG4gICAgam9iTmFtZTogSm9iQ2xhc3Muam9iTmFtZSgpLFxuICAgIG9wdGlvbnM6IGpvYk9wdGlvbnMsXG4gICAgLi4uKHBheWxvYWQgPyB7cGF5bG9hZH0gOiB7fSlcbiAgfSlcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIGdlbmVyaWMgc3ViY2xhc3MncyBydW50aW1lIG1ldGhvZCB0byBzZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gICAqIEB0eXBlIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgY29uc3QgcGVyZm9ybSA9IGpvYkluc3RhbmNlLnBlcmZvcm1cblxuICBhd2FpdCBjb25maWd1cmF0aW9uLndpdGhDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogSm9iQ2xhc3MuZGF0YWJhc2VJZGVudGlmaWVycywgbmFtZX0sIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBwZXJmb3JtLmFwcGx5KGpvYkluc3RhbmNlLCBqb2JBcmdzKVxuICB9KVxufVxuIl19