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
 * @param {() => void} [options.onPerformStart] - Observation hook fired once, immediately before perform runs (with its connection acquired). Pooled runners use it to report that the job actually started. Must not throw into the job.
 * @param {string} [options.processType] - Generic application process type.
 * @returns {Promise<"completed" | "rescheduled">} - Acknowledged outcome.
 */
export default async function runJobPayload(payload, { closeConnections = true, manageProcessTitle = true, onPerformStart, processType = "background-jobs-runner" } = {}) {
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
                    if (onPerformStart)
                        onPerformStart();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9iLXJ1bm5lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvam9iLXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLHFCQUFxQixNQUFNLG1CQUFtQixDQUFBO0FBQ3JELE9BQU8sNEJBQTRCLE1BQU0sc0JBQXNCLENBQUE7QUFDL0QsT0FBTyw2QkFBNkIsTUFBTSx3QkFBd0IsQ0FBQTtBQUNsRSxPQUFPLEVBQUUsMkJBQTJCLEVBQUUsTUFBTSx3QkFBd0IsQ0FBQTtBQUNwRSxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQTtBQUV0RSxNQUFNLHVCQUF1QixHQUFHLElBQUksQ0FBQTtBQUVwQyxNQUFNLE9BQU8sNkJBQThCLFNBQVEsS0FBSztJQUN0RDs7O09BR0c7SUFDSCxZQUFZLEtBQUs7UUFDZixLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDN0IsSUFBSSxDQUFDLElBQUksR0FBRywrQkFBK0IsQ0FBQTtJQUM3QyxDQUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsc0JBQXNCLENBQUMsYUFBYSxFQUFFLEtBQUs7SUFDbEQsTUFBTSxXQUFXLEdBQUcsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO0lBQ2xELE1BQU0sZUFBZSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDakYsTUFBTSxPQUFPLEdBQUc7UUFDZCxPQUFPLEVBQUUsRUFBQyxRQUFRLEVBQUUsd0JBQXdCLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBQztRQUNwRSxLQUFLLEVBQUUsZUFBZTtLQUN2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Q3JELElBQUksZ0JBQWdCLEVBQUUsQ0FBQztZQUNyQixNQUFNLHNCQUFzQixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQzdDLENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkgZnJvbSBcIi4vam9iLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIGZyb20gXCIuL3N0YXR1cy1yZXBvcnRlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVTaWduYWwgZnJvbSBcIi4vcmVzY2hlZHVsZS1zaWduYWwuanNcIlxuaW1wb3J0IHsgcnVuV2l0aEJhY2tncm91bmRKb2JQYXlsb2FkIH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHQuanNcIlxuaW1wb3J0IHsgY2xvc2VSdW5uZXJDb25uZWN0aW9ucyB9IGZyb20gXCIuL3J1bm5lci1ncmFjZWZ1bC1zaHV0ZG93bi5qc1wiXG5cbmNvbnN0IEJFQUNPTl9SRUFEWV9USU1FT1VUX01TID0gNTAwMFxuXG5leHBvcnQgY2xhc3MgQmFja2dyb3VuZEpvYlBlcmZvcm1lZEZhaWx1cmUgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcGVyZm9ybWVkLWpvYiBmYWlsdXJlIGFmdGVyIGl0cyB0ZXJtaW5hbCByZXBvcnQgaXMgYWNrbm93bGVkZ2VkLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBjYXVzZSAtIEEgam9iIHBlcmZvcm0gZXJyb3Igd2hvc2UgZmFpbGVkIHRlcm1pbmFsIHJlcG9ydCB3YXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgY29uc3RydWN0b3IoY2F1c2UpIHtcbiAgICBzdXBlcihjYXVzZS5tZXNzYWdlLCB7Y2F1c2V9KVxuICAgIHRoaXMubmFtZSA9IFwiQmFja2dyb3VuZEpvYlBlcmZvcm1lZEZhaWx1cmVcIlxuICB9XG59XG5cbi8qKlxuICogUnVucyByZXBvcnQgYmVhY29uIHJlYWR5IGVycm9yLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBCZWFjb24gcmVhZGluZXNzIGVycm9yLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlcG9ydEJlYWNvblJlYWR5RXJyb3IoY29uZmlndXJhdGlvbiwgZXJyb3IpIHtcbiAgY29uc3QgZXJyb3JFdmVudHMgPSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcbiAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgY29udGV4dDoge3BlZXJUeXBlOiBcImJhY2tncm91bmQtam9icy1ydW5uZXJcIiwgc3RhZ2U6IFwiYmVhY29uLXJlYWR5XCJ9LFxuICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3JcbiAgfVxuICBjb25zdCBoYXNMaXN0ZW5lciA9IGVycm9yRXZlbnRzLmxpc3RlbmVyQ291bnQoXCJmcmFtZXdvcmstZXJyb3JcIikgPiAwXG4gICAgfHwgZXJyb3JFdmVudHMubGlzdGVuZXJDb3VudChcImFsbC1lcnJvclwiKSA+IDBcblxuICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG5cbiAgaWYgKCFoYXNMaXN0ZW5lcikge1xuICAgIGNvbnNvbGUuZXJyb3IoYFt2ZWxvY2lvdXMgZnJhbWV3b3JrLWVycm9yIHN0YWdlPWJlYWNvbi1yZWFkeV0gJHtub3JtYWxpemVkRXJyb3IubWVzc2FnZX1gKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBjb25uZWN0IGJlYWNvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBjb25uZWN0QmVhY29uKGNvbmZpZ3VyYXRpb24pIHtcbiAgY29uc3QgYmVhY29uQ2xpZW50ID0gYXdhaXQgY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtcnVubmVyXCJ9KVxuXG4gIGlmICghYmVhY29uQ2xpZW50KSByZXR1cm5cblxuICB0cnkge1xuICAgIGF3YWl0IGJlYWNvbkNsaWVudC53YWl0Rm9yUmVhZHkoe3RpbWVvdXRNczogQkVBQ09OX1JFQURZX1RJTUVPVVRfTVN9KVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJlcG9ydEJlYWNvblJlYWR5RXJyb3IoY29uZmlndXJhdGlvbiwgZXJyb3IpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgcHJvY2VzcyB0aXRsZSB0byBzaG93IHdoaWxlIGEgam9iIHJ1bnM6IHRoZSBqb2IgY2xhc3MncyBkZWNsYXJlZFxuICogYHN0YXRpYyBwcm9jZXNzVGl0bGVgLCBlbHNlIGEgYHZlbG9jaW91cyBqb2ItcnVubmVyOiA8Sm9iTmFtZT5gIGZhbGxiYWNrLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9qb2IuanNcIikuZGVmYXVsdH0gSm9iQ2xhc3MgLSBSZXNvbHZlZCBqb2IgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICogQHJldHVybnMge3N0cmluZ30gLSBQcm9jZXNzIHRpdGxlLlxuICovXG5mdW5jdGlvbiBydW5uZXJQcm9jZXNzVGl0bGUoSm9iQ2xhc3MsIHBheWxvYWQpIHtcbiAgY29uc3QgZGVjbGFyZWQgPSBKb2JDbGFzcy5wcm9jZXNzVGl0bGVcblxuICBpZiAodHlwZW9mIGRlY2xhcmVkID09PSBcInN0cmluZ1wiICYmIGRlY2xhcmVkLmxlbmd0aCA+IDApIHJldHVybiBkZWNsYXJlZFxuXG4gIHJldHVybiBgdmVsb2Npb3VzIGpvYi1ydW5uZXI6ICR7cGF5bG9hZC5qb2JOYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIHJ1biBqb2IgcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gUnVubmVyIG9wdGlvbnMuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLmNsb3NlQ29ubmVjdGlvbnNdIC0gV2hldGhlciB0byBncmFjZWZ1bGx5IGNsb3NlIGZyYW1ld29yayBjb25uZWN0aW9ucyBhZnRlciB0aGUgam9iLlxuICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5tYW5hZ2VQcm9jZXNzVGl0bGVdIC0gV2hldGhlciB0byBzZXQgdGhlIHBlci1qb2IgcHJvY2VzcyB0aXRsZSBhbmQgcmVzdG9yZSBpdCBhZnRlcndhcmRzLiBPZmYgZm9yIGNvbmN1cnJlbnQgcG9vbGVkIHJ1bm5lcnMsIHdoZXJlIGludGVybGVhdmVkIHNuYXBzaG90L3Jlc3RvcmUgb2YgdGhlIHNpbmdsZSBwcm9jZXNzLXdpZGUgYHByb2Nlc3MudGl0bGVgIHdvdWxkIGNvcnJ1cHQgaXQ7IHRoZSBwb29sZWQgY2hpbGQgb3ducyBhbiBhZ2dyZWdhdGUgdGl0bGUgaW5zdGVhZC5cbiAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW29wdGlvbnMub25QZXJmb3JtU3RhcnRdIC0gT2JzZXJ2YXRpb24gaG9vayBmaXJlZCBvbmNlLCBpbW1lZGlhdGVseSBiZWZvcmUgcGVyZm9ybSBydW5zICh3aXRoIGl0cyBjb25uZWN0aW9uIGFjcXVpcmVkKS4gUG9vbGVkIHJ1bm5lcnMgdXNlIGl0IHRvIHJlcG9ydCB0aGF0IHRoZSBqb2IgYWN0dWFsbHkgc3RhcnRlZC4gTXVzdCBub3QgdGhyb3cgaW50byB0aGUgam9iLlxuICogQHBhcmFtIHtzdHJpbmd9IFtvcHRpb25zLnByb2Nlc3NUeXBlXSAtIEdlbmVyaWMgYXBwbGljYXRpb24gcHJvY2VzcyB0eXBlLlxuICogQHJldHVybnMge1Byb21pc2U8XCJjb21wbGV0ZWRcIiB8IFwicmVzY2hlZHVsZWRcIj59IC0gQWNrbm93bGVkZ2VkIG91dGNvbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIHJ1bkpvYlBheWxvYWQocGF5bG9hZCwge2Nsb3NlQ29ubmVjdGlvbnMgPSB0cnVlLCBtYW5hZ2VQcm9jZXNzVGl0bGUgPSB0cnVlLCBvblBlcmZvcm1TdGFydCwgcHJvY2Vzc1R5cGUgPSBcImJhY2tncm91bmQtam9icy1ydW5uZXJcIn0gPSB7fSkge1xuICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgYXdhaXQgY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBwcm9jZXNzVHlwZX0pXG4gIGF3YWl0IGNvbm5lY3RCZWFjb24oY29uZmlndXJhdGlvbilcbiAgY29uc3QgcmVwb3J0ZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlcih7Y29uZmlndXJhdGlvbn0pXG5cbiAgY29uc3QgcmVnaXN0cnkgPSBuZXcgQmFja2dyb3VuZEpvYlJlZ2lzdHJ5KHtjb25maWd1cmF0aW9ufSlcbiAgYXdhaXQgcmVnaXN0cnkubG9hZCgpXG4gIGNvbnN0IEpvYkNsYXNzID0gcmVnaXN0cnkuZ2V0Sm9iQnlOYW1lKHBheWxvYWQuam9iTmFtZSlcbiAgY29uc3Qgam9iSW5zdGFuY2UgPSBuZXcgSm9iQ2xhc3MoKVxuICBjb25zdCBqb2JBcmdzID0gcGF5bG9hZC5hcmdzIHx8IFtdXG4gIGpvYkluc3RhbmNlLl9zZXRCYWNrZ3JvdW5kSm9iQ29udGV4dCh7XG4gICAgYXJnczogam9iQXJncyxcbiAgICBqb2JDbGFzczogSm9iQ2xhc3MsXG4gICAgam9iTmFtZTogcGF5bG9hZC5qb2JOYW1lLFxuICAgIG9wdGlvbnM6IHBheWxvYWQub3B0aW9ucyB8fCB7fSxcbiAgICBwYXlsb2FkXG4gIH0pXG4gIC8qKlxuICAgKiBQZXJmb3JtLlxuICAgKiBAdHlwZSB7KC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTx2b2lkPn0gKi9cbiAgY29uc3QgcGVyZm9ybSA9IGpvYkluc3RhbmNlLnBlcmZvcm1cblxuICAvLyBOYW1lIHRoZSBwcm9jZXNzIGFmdGVyIHRoZSBqb2IgaXQgaXMgcnVubmluZyBzbyBgcHNgL2B0b3BgIHNob3cgd2hhdCBlYWNoXG4gIC8vIHJ1bm5lciBpcyBkb2luZzsgcmVzdG9yZWQgaW4gdGhlIGBmaW5hbGx5YCBiZWxvdyB3aGVuIHRoZSBqb2IgZmluaXNoZXMuXG4gIC8vIFNraXBwZWQgZm9yIGNvbmN1cnJlbnQgcG9vbGVkIHJ1bm5lcnMsIHdob3NlIGNoaWxkIG93bnMgYW4gYWdncmVnYXRlIHRpdGxlLlxuICBjb25zdCBwcmV2aW91c1RpdGxlID0gcHJvY2Vzcy50aXRsZVxuICBpZiAobWFuYWdlUHJvY2Vzc1RpdGxlKSBwcm9jZXNzLnRpdGxlID0gcnVubmVyUHJvY2Vzc1RpdGxlKEpvYkNsYXNzLCBwYXlsb2FkKVxuXG4gIHRyeSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHJ1bldpdGhCYWNrZ3JvdW5kSm9iUGF5bG9hZChwYXlsb2FkLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24ud2l0aENvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBKb2JDbGFzcy5kYXRhYmFzZUlkZW50aWZpZXJzLCBuYW1lOiBgQmFja2dyb3VuZCBqb2IgcnVubmVyOiAke3BheWxvYWQuam9iTmFtZX1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChvblBlcmZvcm1TdGFydCkgb25QZXJmb3JtU3RhcnQoKVxuICAgICAgICAgIGF3YWl0IHBlcmZvcm0uYXBwbHkoam9iSW5zdGFuY2UsIGpvYkFyZ3MpXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCkge1xuICAgICAgICBpZiAocGF5bG9hZC5pZCkge1xuICAgICAgICAgIGF3YWl0IHJlcG9ydGVyLnJlcG9ydFdpdGhSZXRyeSh7XG4gICAgICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgICAgIHN0YXR1czogXCJyZXNjaGVkdWxlZFwiLFxuICAgICAgICAgICAgZGVsYXlNczogZXJyb3IuZGVsYXlNcyxcbiAgICAgICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCxcbiAgICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIG1heER1cmF0aW9uTXM6IDMwMDAwLFxuICAgICAgICAgICAgcmV0cnlQZXJzaXN0RXJyb3JzOiB0cnVlXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBcInJlc2NoZWR1bGVkXCJcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGVyZm9ybWVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGlmIChwYXlsb2FkLmlkKSB7XG4gICAgICAgIGF3YWl0IHJlcG9ydGVyLnJlcG9ydFdpdGhSZXRyeSh7XG4gICAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICAgIGVycm9yOiBwZXJmb3JtZWRFcnJvcixcbiAgICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkLFxuICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICBtYXhEdXJhdGlvbk1zOiAzMDAwMFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgQmFja2dyb3VuZEpvYlBlcmZvcm1lZEZhaWx1cmUocGVyZm9ybWVkRXJyb3IpXG4gICAgfVxuXG4gICAgaWYgKHBheWxvYWQuaWQpIHtcbiAgICAgIGF3YWl0IHJlcG9ydGVyLnJlcG9ydFdpdGhSZXRyeSh7XG4gICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIG1heER1cmF0aW9uTXM6IDMwMDAwXG4gICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gXCJjb21wbGV0ZWRcIlxuICB9IGZpbmFsbHkge1xuICAgIC8vIFJlc3RvcmUgdGhlIHJ1bm5lcidzIGJhc2UgdGl0bGUgc28gYSBsaW5nZXJpbmcvaWRsZSBydW5uZXIgKG9yIGEgcmV1c2VkXG4gICAgLy8gb25lKSBkb2Vzbid0IG1pc3JlcG9ydCBhIGZpbmlzaGVkIGpvYiBhcyBzdGlsbCBydW5uaW5nLlxuICAgIGlmIChtYW5hZ2VQcm9jZXNzVGl0bGUpIHByb2Nlc3MudGl0bGUgPSBwcmV2aW91c1RpdGxlXG4gICAgaWYgKGNsb3NlQ29ubmVjdGlvbnMpIHtcbiAgICAgIGF3YWl0IGNsb3NlUnVubmVyQ29ubmVjdGlvbnMoY29uZmlndXJhdGlvbilcbiAgICB9XG4gIH1cbn1cbiJdfQ==