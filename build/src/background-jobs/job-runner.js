// @ts-check
import configurationResolver from "../configuration-resolver.js";
import BackgroundJobRegistry from "./job-registry.js";
import BackgroundJobsStatusReporter from "./status-reporter.js";
import BackgroundJobRescheduleSignal from "./reschedule-signal.js";
import { runWithBackgroundJobPayload } from "./execution-context.js";
import { closeRunnerConnections } from "./runner-graceful-shutdown.js";
const BEACON_READY_TIMEOUT_MS = 5000;
export class BackgroundJobPerformedFailure extends Error {
    /**
     * Creates a performed-job failure after its terminal report is acknowledged.
     * @param {Error} cause - A job perform error whose failed terminal report was acknowledged.
     */
    constructor(cause) {
        super(cause.message, { cause });
        this.name = "BackgroundJobPerformedFailure";
    }
}
/**
 * Runs report beacon ready error.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @param {ReturnType<typeof JSON.parse>} error - Beacon readiness error.
 * @returns {void}
 */
function reportBeaconReadyError(configuration, error) {
    const errorEvents = configuration.getErrorEvents();
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const payload = {
        context: { peerType: "background-jobs-runner", stage: "beacon-ready" },
        error: normalizedError
    };
    const hasListener = errorEvents.listenerCount("framework-error") > 0
        || errorEvents.listenerCount("all-error") > 0;
    errorEvents.emit("framework-error", payload);
    errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    if (!hasListener) {
        console.error(`[velocious framework-error stage=beacon-ready] ${normalizedError.message}`);
    }
}
/**
 * Runs connect beacon.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {Promise<void>}
 */
async function connectBeacon(configuration) {
    const beaconClient = await configuration.connectBeacon({ peerType: "background-jobs-runner" });
    if (!beaconClient)
        return;
    try {
        await beaconClient.waitForReady({ timeoutMs: BEACON_READY_TIMEOUT_MS });
    }
    catch (error) {
        reportBeaconReadyError(configuration, error);
    }
}
/**
 * Resolves the process title to show while a job runs: the job class's declared
 * `static processTitle`, else a `velocious job-runner: <JobName>` fallback.
 * @param {typeof import("./job.js").default} JobClass - Resolved job class.
 * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
 * @returns {string} - Process title.
 */
function runnerProcessTitle(JobClass, payload) {
    const declared = JobClass.processTitle;
    if (typeof declared === "string" && declared.length > 0)
        return declared;
    return `velocious job-runner: ${payload.jobName}`;
}
/**
 * Runs run job payload.
 * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
 * @param {object} [options] - Runner options.
 * @param {boolean} [options.closeConnections] - Whether to gracefully close framework connections after the job.
 * @param {boolean} [options.manageProcessTitle] - Whether to set the per-job process title and restore it afterwards. Off for concurrent pooled runners, where interleaved snapshot/restore of the single process-wide `process.title` would corrupt it; the pooled child owns an aggregate title instead.
 * @param {string} [options.processType] - Generic application process type.
 * @returns {Promise<"completed" | "rescheduled">} - Acknowledged outcome.
 */
export default async function runJobPayload(payload, { closeConnections = true, manageProcessTitle = true, processType = "background-jobs-runner" } = {}) {
    const configuration = await configurationResolver();
    configuration.setCurrent();
    await configuration.initialize({ type: processType });
    await connectBeacon(configuration);
    const reporter = new BackgroundJobsStatusReporter({ configuration });
    const registry = new BackgroundJobRegistry({ configuration });
    await registry.load();
    const JobClass = registry.getJobByName(payload.jobName);
    const jobInstance = new JobClass();
    const jobArgs = payload.args || [];
    jobInstance._setBackgroundJobContext({
        args: jobArgs,
        jobClass: JobClass,
        jobName: payload.jobName,
        options: payload.options || {},
        payload
    });
    /**
     * Perform.
     * @type {(...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>} */
    const perform = jobInstance.perform;
    // Name the process after the job it is running so `ps`/`top` show what each
    // runner is doing; restored in the `finally` below when the job finishes.
    // Skipped for concurrent pooled runners, whose child owns an aggregate title.
    const previousTitle = process.title;
    if (manageProcessTitle)
        process.title = runnerProcessTitle(JobClass, payload);
    try {
        try {
            await runWithBackgroundJobPayload(payload, async () => {
                await configuration.withConnections({ databaseIdentifiers: JobClass.databaseIdentifiers, name: `Background job runner: ${payload.jobName}` }, async () => {
                    await perform.apply(jobInstance, jobArgs);
                });
            });
        }
        catch (error) {
            if (error instanceof BackgroundJobRescheduleSignal) {
                if (payload.id) {
                    await reporter.reportWithRetry({
                        jobId: payload.id,
                        status: "rescheduled",
                        delayMs: error.delayMs,
                        handoffId: payload.handoffId,
                        workerId: payload.workerId,
                        handedOffAtMs: payload.handedOffAtMs,
                        maxDurationMs: 30000,
                        retryPersistErrors: true
                    });
                }
                return "rescheduled";
            }
            const performedError = error instanceof Error ? error : new Error(String(error));
            if (payload.id) {
                await reporter.reportWithRetry({
                    jobId: payload.id,
                    status: "failed",
                    error: performedError,
                    handoffId: payload.handoffId,
                    workerId: payload.workerId,
                    handedOffAtMs: payload.handedOffAtMs,
                    maxDurationMs: 30000
                });
            }
            throw new BackgroundJobPerformedFailure(performedError);
        }
        if (payload.id) {
            await reporter.reportWithRetry({
                jobId: payload.id,
                status: "completed",
                handoffId: payload.handoffId,
                workerId: payload.workerId,
                handedOffAtMs: payload.handedOffAtMs,
                maxDurationMs: 30000
            });
        }
        return "completed";
    }
    finally {
        // Restore the runner's base title so a lingering/idle runner (or a reused
        // one) doesn't misreport a finished job as still running.
        if (manageProcessTitle)
            process.title = previousTitle;
        if (closeConnections) {
            await closeRunnerConnections(configuration);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9iLXJ1bm5lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvam9iLXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLHFCQUFxQixNQUFNLG1CQUFtQixDQUFBO0FBQ3JELE9BQU8sNEJBQTRCLE1BQU0sc0JBQXNCLENBQUE7QUFDL0QsT0FBTyw2QkFBNkIsTUFBTSx3QkFBd0IsQ0FBQTtBQUNsRSxPQUFPLEVBQUUsMkJBQTJCLEVBQUUsTUFBTSx3QkFBd0IsQ0FBQTtBQUNwRSxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQTtBQUV0RSxNQUFNLHVCQUF1QixHQUFHLElBQUksQ0FBQTtBQUVwQyxNQUFNLE9BQU8sNkJBQThCLFNBQVEsS0FBSztJQUN0RDs7O09BR0c7SUFDSCxZQUFZLEtBQUs7UUFDZixLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDN0IsSUFBSSxDQUFDLElBQUksR0FBRywrQkFBK0IsQ0FBQTtJQUM3QyxDQUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsc0JBQXNCLENBQUMsYUFBYSxFQUFFLEtBQUs7SUFDbEQsTUFBTSxXQUFXLEdBQUcsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO0lBQ2xELE1BQU0sZUFBZSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDakYsTUFBTSxPQUFPLEdBQUc7UUFDZCxPQUFPLEVBQUUsRUFBQyxRQUFRLEVBQUUsd0JBQXdCLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBQztRQUNwRSxLQUFLLEVBQUUsZUFBZTtLQUN2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YUFBYSxDQUFDLENBQUE7UUFDN0MsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBjb25maWd1cmF0aW9uUmVzb2x2ZXIgZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24tcmVzb2x2ZXIuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZWdpc3RyeSBmcm9tIFwiLi9qb2ItcmVnaXN0cnkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIgZnJvbSBcIi4vc3RhdHVzLXJlcG9ydGVyLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCBmcm9tIFwiLi9yZXNjaGVkdWxlLXNpZ25hbC5qc1wiXG5pbXBvcnQgeyBydW5XaXRoQmFja2dyb3VuZEpvYlBheWxvYWQgfSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dC5qc1wiXG5pbXBvcnQgeyBjbG9zZVJ1bm5lckNvbm5lY3Rpb25zIH0gZnJvbSBcIi4vcnVubmVyLWdyYWNlZnVsLXNodXRkb3duLmpzXCJcblxuY29uc3QgQkVBQ09OX1JFQURZX1RJTUVPVVRfTVMgPSA1MDAwXG5cbmV4cG9ydCBjbGFzcyBCYWNrZ3JvdW5kSm9iUGVyZm9ybWVkRmFpbHVyZSBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBwZXJmb3JtZWQtam9iIGZhaWx1cmUgYWZ0ZXIgaXRzIHRlcm1pbmFsIHJlcG9ydCBpcyBhY2tub3dsZWRnZWQuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGNhdXNlIC0gQSBqb2IgcGVyZm9ybSBlcnJvciB3aG9zZSBmYWlsZWQgdGVybWluYWwgcmVwb3J0IHdhcyBhY2tub3dsZWRnZWQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihjYXVzZSkge1xuICAgIHN1cGVyKGNhdXNlLm1lc3NhZ2UsIHtjYXVzZX0pXG4gICAgdGhpcy5uYW1lID0gXCJCYWNrZ3JvdW5kSm9iUGVyZm9ybWVkRmFpbHVyZVwiXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHJlcG9ydCBiZWFjb24gcmVhZHkgZXJyb3IuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEJlYWNvbiByZWFkaW5lc3MgZXJyb3IuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVwb3J0QmVhY29uUmVhZHlFcnJvcihjb25maWd1cmF0aW9uLCBlcnJvcikge1xuICBjb25zdCBlcnJvckV2ZW50cyA9IGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICBjb250ZXh0OiB7cGVlclR5cGU6IFwiYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwiLCBzdGFnZTogXCJiZWFjb24tcmVhZHlcIn0sXG4gICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICB9XG4gIGNvbnN0IGhhc0xpc3RlbmVyID0gZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImZyYW1ld29yay1lcnJvclwiKSA+IDBcbiAgICB8fCBlcnJvckV2ZW50cy5saXN0ZW5lckNvdW50KFwiYWxsLWVycm9yXCIpID4gMFxuXG4gIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcblxuICBpZiAoIWhhc0xpc3RlbmVyKSB7XG4gICAgY29uc29sZS5lcnJvcihgW3ZlbG9jaW91cyBmcmFtZXdvcmstZXJyb3Igc3RhZ2U9YmVhY29uLXJlYWR5XSAke25vcm1hbGl6ZWRFcnJvci5tZXNzYWdlfWApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGNvbm5lY3QgYmVhY29uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbm5lY3RCZWFjb24oY29uZmlndXJhdGlvbikge1xuICBjb25zdCBiZWFjb25DbGllbnQgPSBhd2FpdCBjb25maWd1cmF0aW9uLmNvbm5lY3RCZWFjb24oe3BlZXJUeXBlOiBcImJhY2tncm91bmQtam9icy1ydW5uZXJcIn0pXG5cbiAgaWYgKCFiZWFjb25DbGllbnQpIHJldHVyblxuXG4gIHRyeSB7XG4gICAgYXdhaXQgYmVhY29uQ2xpZW50LndhaXRGb3JSZWFkeSh7dGltZW91dE1zOiBCRUFDT05fUkVBRFlfVElNRU9VVF9NU30pXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmVwb3J0QmVhY29uUmVhZHlFcnJvcihjb25maWd1cmF0aW9uLCBlcnJvcilcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBwcm9jZXNzIHRpdGxlIHRvIHNob3cgd2hpbGUgYSBqb2IgcnVuczogdGhlIGpvYiBjbGFzcydzIGRlY2xhcmVkXG4gKiBgc3RhdGljIHByb2Nlc3NUaXRsZWAsIGVsc2UgYSBgdmVsb2Npb3VzIGpvYi1ydW5uZXI6IDxKb2JOYW1lPmAgZmFsbGJhY2suXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2pvYi5qc1wiKS5kZWZhdWx0fSBKb2JDbGFzcyAtIFJlc29sdmVkIGpvYiBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFByb2Nlc3MgdGl0bGUuXG4gKi9cbmZ1bmN0aW9uIHJ1bm5lclByb2Nlc3NUaXRsZShKb2JDbGFzcywgcGF5bG9hZCkge1xuICBjb25zdCBkZWNsYXJlZCA9IEpvYkNsYXNzLnByb2Nlc3NUaXRsZVxuXG4gIGlmICh0eXBlb2YgZGVjbGFyZWQgPT09IFwic3RyaW5nXCIgJiYgZGVjbGFyZWQubGVuZ3RoID4gMCkgcmV0dXJuIGRlY2xhcmVkXG5cbiAgcmV0dXJuIGB2ZWxvY2lvdXMgam9iLXJ1bm5lcjogJHtwYXlsb2FkLmpvYk5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgcnVuIGpvYiBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBSdW5uZXIgb3B0aW9ucy5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMuY2xvc2VDb25uZWN0aW9uc10gLSBXaGV0aGVyIHRvIGdyYWNlZnVsbHkgY2xvc2UgZnJhbWV3b3JrIGNvbm5lY3Rpb25zIGFmdGVyIHRoZSBqb2IuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLm1hbmFnZVByb2Nlc3NUaXRsZV0gLSBXaGV0aGVyIHRvIHNldCB0aGUgcGVyLWpvYiBwcm9jZXNzIHRpdGxlIGFuZCByZXN0b3JlIGl0IGFmdGVyd2FyZHMuIE9mZiBmb3IgY29uY3VycmVudCBwb29sZWQgcnVubmVycywgd2hlcmUgaW50ZXJsZWF2ZWQgc25hcHNob3QvcmVzdG9yZSBvZiB0aGUgc2luZ2xlIHByb2Nlc3Mtd2lkZSBgcHJvY2Vzcy50aXRsZWAgd291bGQgY29ycnVwdCBpdDsgdGhlIHBvb2xlZCBjaGlsZCBvd25zIGFuIGFnZ3JlZ2F0ZSB0aXRsZSBpbnN0ZWFkLlxuICogQHBhcmFtIHtzdHJpbmd9IFtvcHRpb25zLnByb2Nlc3NUeXBlXSAtIEdlbmVyaWMgYXBwbGljYXRpb24gcHJvY2VzcyB0eXBlLlxuICogQHJldHVybnMge1Byb21pc2U8XCJjb21wbGV0ZWRcIiB8IFwicmVzY2hlZHVsZWRcIj59IC0gQWNrbm93bGVkZ2VkIG91dGNvbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIHJ1bkpvYlBheWxvYWQocGF5bG9hZCwge2Nsb3NlQ29ubmVjdGlvbnMgPSB0cnVlLCBtYW5hZ2VQcm9jZXNzVGl0bGUgPSB0cnVlLCBwcm9jZXNzVHlwZSA9IFwiYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwifSA9IHt9KSB7XG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBhd2FpdCBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuICBjb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuICBhd2FpdCBjb25maWd1cmF0aW9uLmluaXRpYWxpemUoe3R5cGU6IHByb2Nlc3NUeXBlfSlcbiAgYXdhaXQgY29ubmVjdEJlYWNvbihjb25maWd1cmF0aW9uKVxuICBjb25zdCByZXBvcnRlciA9IG5ldyBCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyKHtjb25maWd1cmF0aW9ufSlcblxuICBjb25zdCByZWdpc3RyeSA9IG5ldyBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkoe2NvbmZpZ3VyYXRpb259KVxuICBhd2FpdCByZWdpc3RyeS5sb2FkKClcbiAgY29uc3QgSm9iQ2xhc3MgPSByZWdpc3RyeS5nZXRKb2JCeU5hbWUocGF5bG9hZC5qb2JOYW1lKVxuICBjb25zdCBqb2JJbnN0YW5jZSA9IG5ldyBKb2JDbGFzcygpXG4gIGNvbnN0IGpvYkFyZ3MgPSBwYXlsb2FkLmFyZ3MgfHwgW11cbiAgam9iSW5zdGFuY2UuX3NldEJhY2tncm91bmRKb2JDb250ZXh0KHtcbiAgICBhcmdzOiBqb2JBcmdzLFxuICAgIGpvYkNsYXNzOiBKb2JDbGFzcyxcbiAgICBqb2JOYW1lOiBwYXlsb2FkLmpvYk5hbWUsXG4gICAgb3B0aW9uczogcGF5bG9hZC5vcHRpb25zIHx8IHt9LFxuICAgIHBheWxvYWRcbiAgfSlcbiAgLyoqXG4gICAqIFBlcmZvcm0uXG4gICAqIEB0eXBlIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPHZvaWQ+fSAqL1xuICBjb25zdCBwZXJmb3JtID0gam9iSW5zdGFuY2UucGVyZm9ybVxuXG4gIC8vIE5hbWUgdGhlIHByb2Nlc3MgYWZ0ZXIgdGhlIGpvYiBpdCBpcyBydW5uaW5nIHNvIGBwc2AvYHRvcGAgc2hvdyB3aGF0IGVhY2hcbiAgLy8gcnVubmVyIGlzIGRvaW5nOyByZXN0b3JlZCBpbiB0aGUgYGZpbmFsbHlgIGJlbG93IHdoZW4gdGhlIGpvYiBmaW5pc2hlcy5cbiAgLy8gU2tpcHBlZCBmb3IgY29uY3VycmVudCBwb29sZWQgcnVubmVycywgd2hvc2UgY2hpbGQgb3ducyBhbiBhZ2dyZWdhdGUgdGl0bGUuXG4gIGNvbnN0IHByZXZpb3VzVGl0bGUgPSBwcm9jZXNzLnRpdGxlXG4gIGlmIChtYW5hZ2VQcm9jZXNzVGl0bGUpIHByb2Nlc3MudGl0bGUgPSBydW5uZXJQcm9jZXNzVGl0bGUoSm9iQ2xhc3MsIHBheWxvYWQpXG5cbiAgdHJ5IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgcnVuV2l0aEJhY2tncm91bmRKb2JQYXlsb2FkKHBheWxvYWQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgY29uZmlndXJhdGlvbi53aXRoQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IEpvYkNsYXNzLmRhdGFiYXNlSWRlbnRpZmllcnMsIG5hbWU6IGBCYWNrZ3JvdW5kIGpvYiBydW5uZXI6ICR7cGF5bG9hZC5qb2JOYW1lfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgcGVyZm9ybS5hcHBseShqb2JJbnN0YW5jZSwgam9iQXJncylcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsKSB7XG4gICAgICAgIGlmIChwYXlsb2FkLmlkKSB7XG4gICAgICAgICAgYXdhaXQgcmVwb3J0ZXIucmVwb3J0V2l0aFJldHJ5KHtcbiAgICAgICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICAgICAgc3RhdHVzOiBcInJlc2NoZWR1bGVkXCIsXG4gICAgICAgICAgICBkZWxheU1zOiBlcnJvci5kZWxheU1zLFxuICAgICAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkLFxuICAgICAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgbWF4RHVyYXRpb25NczogMzAwMDAsXG4gICAgICAgICAgICByZXRyeVBlcnNpc3RFcnJvcnM6IHRydWVcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFwicmVzY2hlZHVsZWRcIlxuICAgICAgfVxuXG4gICAgICBjb25zdCBwZXJmb3JtZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgaWYgKHBheWxvYWQuaWQpIHtcbiAgICAgICAgYXdhaXQgcmVwb3J0ZXIucmVwb3J0V2l0aFJldHJ5KHtcbiAgICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgZXJyb3I6IHBlcmZvcm1lZEVycm9yLFxuICAgICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQsXG4gICAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIG1heER1cmF0aW9uTXM6IDMwMDAwXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBCYWNrZ3JvdW5kSm9iUGVyZm9ybWVkRmFpbHVyZShwZXJmb3JtZWRFcnJvcilcbiAgICB9XG5cbiAgICBpZiAocGF5bG9hZC5pZCkge1xuICAgICAgYXdhaXQgcmVwb3J0ZXIucmVwb3J0V2l0aFJldHJ5KHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgbWF4RHVyYXRpb25NczogMzAwMDBcbiAgICAgIH0pXG4gICAgfVxuICAgIHJldHVybiBcImNvbXBsZXRlZFwiXG4gIH0gZmluYWxseSB7XG4gICAgLy8gUmVzdG9yZSB0aGUgcnVubmVyJ3MgYmFzZSB0aXRsZSBzbyBhIGxpbmdlcmluZy9pZGxlIHJ1bm5lciAob3IgYSByZXVzZWRcbiAgICAvLyBvbmUpIGRvZXNuJ3QgbWlzcmVwb3J0IGEgZmluaXNoZWQgam9iIGFzIHN0aWxsIHJ1bm5pbmcuXG4gICAgaWYgKG1hbmFnZVByb2Nlc3NUaXRsZSkgcHJvY2Vzcy50aXRsZSA9IHByZXZpb3VzVGl0bGVcbiAgICBpZiAoY2xvc2VDb25uZWN0aW9ucykge1xuICAgICAgYXdhaXQgY2xvc2VSdW5uZXJDb25uZWN0aW9ucyhjb25maWd1cmF0aW9uKVxuICAgIH1cbiAgfVxufVxuIl19