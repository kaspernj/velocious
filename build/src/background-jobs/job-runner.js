// @ts-check
import configurationResolver from "../configuration-resolver.js";
import BackgroundJobRegistry from "./job-registry.js";
import BackgroundJobsStatusReporter from "./status-reporter.js";
import BackgroundJobRescheduleSignal from "./reschedule-signal.js";
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
            await configuration.withConnections({ databaseIdentifiers: JobClass.databaseIdentifiers, name: `Background job runner: ${payload.jobName}` }, async () => {
                await perform.apply(jobInstance, jobArgs);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9iLXJ1bm5lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvam9iLXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLHFCQUFxQixNQUFNLG1CQUFtQixDQUFBO0FBQ3JELE9BQU8sNEJBQTRCLE1BQU0sc0JBQXNCLENBQUE7QUFDL0QsT0FBTyw2QkFBNkIsTUFBTSx3QkFBd0IsQ0FBQTtBQUNsRSxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQTtBQUV0RSxNQUFNLHVCQUF1QixHQUFHLElBQUksQ0FBQTtBQUVwQyxNQUFNLE9BQU8sNkJBQThCLFNBQVEsS0FBSztJQUN0RDs7O09BR0c7SUFDSCxZQUFZLEtBQUs7UUFDZixLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDN0IsSUFBSSxDQUFDLElBQUksR0FBRywrQkFBK0IsQ0FBQTtJQUM3QyxDQUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsc0JBQXNCLENBQUMsYUFBYSxFQUFFLEtBQUs7SUFDbEQsTUFBTSxXQUFXLEdBQUcsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO0lBQ2xELE1BQU0sZUFBZSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDakYsTUFBTSxPQUFPLEdBQUc7UUFDZCxPQUFPLEVBQUUsRUFBQyxRQUFRLEVBQUUsd0JBQXdCLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBQztRQUNwRSxLQUFLLEVBQUUsZUFBZTtLQUN2QixDQUFBO0lBQ0QsTUFBTSxXQUFXLEdBQUcsV0FBVyxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUM7V0FDL0QsV0FBVyxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUE7SUFFL0MsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtJQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7SUFFekUsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ2pCLE9BQU8sQ0FBQyxLQUFLLENBQUMsa0RBQWtELGVBQWUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFBO0lBQzVGLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxhQUFhLENBQUMsYUFBYTtJQUN4QyxNQUFNLFlBQVksR0FBRyxNQUFNLGFBQWEsQ0FBQyxhQUFhLENBQUMsRUFBQyxRQUFRLEVBQUUsd0JBQXdCLEVBQUMsQ0FBQyxDQUFBO0lBRTVGLElBQUksQ0FBQyxZQUFZO1FBQUUsT0FBTTtJQUV6QixJQUFJLENBQUM7UUFDSCxNQUFNLFlBQVksQ0FBQyxZQUFZLENBQUMsRUFBQyxTQUFTLEVBQUUsdUJBQXVCLEVBQUMsQ0FBQyxDQUFBO0lBQ3ZFLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2Ysc0JBQXNCLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQzlDLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxRQUFRLEVBQUUsT0FBTztJQUMzQyxNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsWUFBWSxDQUFBO0lBRXRDLElBQUksT0FBTyxRQUFRLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQztRQUFFLE9BQU8sUUFBUSxDQUFBO0lBRXhFLE9BQU8seUJBQXlCLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtBQUNuRCxDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssVUFBVSxhQUFhLENBQUMsT0FBTyxFQUFFLEVBQUMsZ0JBQWdCLEdBQUcsSUFBSSxFQUFFLGtCQUFrQixHQUFHLElBQUksRUFBRSxXQUFXLEdBQUcsd0JBQXdCLEVBQUMsR0FBRyxFQUFFO0lBQ3BKLE1BQU0sYUFBYSxHQUFHLE1BQU0scUJBQXFCLEVBQUUsQ0FBQTtJQUNuRCxhQUFhLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDMUIsTUFBTSxhQUFhLENBQUMsVUFBVSxDQUFDLEVBQUMsSUFBSSxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7SUFDbkQsTUFBTSxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUE7SUFDbEMsTUFBTSxRQUFRLEdBQUcsSUFBSSw0QkFBNEIsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7SUFFbEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxxQkFBcUIsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7SUFDM0QsTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDckIsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDdkQsTUFBTSxXQUFXLEdBQUcsSUFBSSxRQUFRLEVBQUUsQ0FBQTtJQUNsQyxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQTtJQUNsQyxXQUFXLENBQUMsd0JBQXdCLENBQUM7UUFDbkMsSUFBSSxFQUFFLE9BQU87UUFDYixRQUFRLEVBQUUsUUFBUTtRQUNsQixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87UUFDeEIsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLElBQUksRUFBRTtRQUM5QixPQUFPO0tBQ1IsQ0FBQyxDQUFBO0lBQ0Y7O2tGQUU4RTtJQUM5RSxNQUFNLE9BQU8sR0FBRyxXQUFXLENBQUMsT0FBTyxDQUFBO0lBRW5DLDRFQUE0RTtJQUM1RSwwRUFBMEU7SUFDMUUsOEVBQThFO0lBQzlFLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUE7SUFDbkMsSUFBSSxrQkFBa0I7UUFBRSxPQUFPLENBQUMsS0FBSyxHQUFHLGtCQUFrQixDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsQ0FBQTtJQUU3RSxJQUFJLENBQUM7UUFDSCxJQUFJLENBQUM7WUFDSCxNQUFNLGFBQWEsQ0FBQyxlQUFlLENBQUMsRUFBQyxtQkFBbUIsRUFBRSxRQUFRLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxFQUFFLDBCQUEwQixPQUFPLENBQUMsT0FBTyxFQUFFLEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDckosTUFBTSxPQUFPLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQTtZQUMzQyxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxLQUFLLFlBQVksNkJBQTZCLEVBQUUsQ0FBQztnQkFDbkQsSUFBSSxPQUFPLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ2YsTUFBTSxRQUFRLENBQUMsZUFBZSxDQUFDO3dCQUM3QixLQUFLLEVBQUUsT0FBTyxDQUFDLEVBQUU7d0JBQ2pCLE1BQU0sRUFBRSxhQUFhO3dCQUNyQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87d0JBQ3RCLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUzt3QkFDNUIsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO3dCQUMxQixhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7d0JBQ3BDLGFBQWEsRUFBRSxLQUFLO3dCQUNwQixrQkFBa0IsRUFBRSxJQUFJO3FCQUN6QixDQUFDLENBQUE7Z0JBQ0osQ0FBQztnQkFFRCxPQUFPLGFBQWEsQ0FBQTtZQUN0QixDQUFDO1lBRUQsTUFBTSxjQUFjLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNoRixJQUFJLE9BQU8sQ0FBQyxFQUFFLEVBQUUsQ0FBQztnQkFDZixNQUFNLFFBQVEsQ0FBQyxlQUFlLENBQUM7b0JBQzdCLEtBQUssRUFBRSxPQUFPLENBQUMsRUFBRTtvQkFDakIsTUFBTSxFQUFFLFFBQVE7b0JBQ2hCLEtBQUssRUFBRSxjQUFjO29CQUNyQixTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVM7b0JBQzVCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtvQkFDMUIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO29CQUNwQyxhQUFhLEVBQUUsS0FBSztpQkFDckIsQ0FBQyxDQUFBO1lBQ0osQ0FBQztZQUVELE1BQU0sSUFBSSw2QkFBNkIsQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUN6RCxDQUFDO1FBRUQsSUFBSSxPQUFPLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDZixNQUFNLFFBQVEsQ0FBQyxlQUFlLENBQUM7Z0JBQzdCLEtBQUssRUFBRSxPQUFPLENBQUMsRUFBRTtnQkFDakIsTUFBTSxFQUFFLFdBQVc7Z0JBQ25CLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUztnQkFDNUIsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO2dCQUMxQixhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7Z0JBQ3BDLGFBQWEsRUFBRSxLQUFLO2FBQ3JCLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFDRCxPQUFPLFdBQVcsQ0FBQTtJQUNwQixDQUFDO1lBQVMsQ0FBQztRQUNULDBFQUEwRTtRQUMxRSwwREFBMEQ7UUFDMUQsSUFBSSxrQkFBa0I7WUFBRSxPQUFPLENBQUMsS0FBSyxHQUFHLGFBQWEsQ0FBQTtRQUNyRCxJQUFJLGdCQUFnQixFQUFFLENBQUM7WUFDckIsTUFBTSxzQkFBc0IsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUM3QyxDQUFDO0lBQ0gsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlZ2lzdHJ5IGZyb20gXCIuL2pvYi1yZWdpc3RyeS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciBmcm9tIFwiLi9zdGF0dXMtcmVwb3J0ZXIuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsIGZyb20gXCIuL3Jlc2NoZWR1bGUtc2lnbmFsLmpzXCJcbmltcG9ydCB7IGNsb3NlUnVubmVyQ29ubmVjdGlvbnMgfSBmcm9tIFwiLi9ydW5uZXItZ3JhY2VmdWwtc2h1dGRvd24uanNcIlxuXG5jb25zdCBCRUFDT05fUkVBRFlfVElNRU9VVF9NUyA9IDUwMDBcblxuZXhwb3J0IGNsYXNzIEJhY2tncm91bmRKb2JQZXJmb3JtZWRGYWlsdXJlIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHBlcmZvcm1lZC1qb2IgZmFpbHVyZSBhZnRlciBpdHMgdGVybWluYWwgcmVwb3J0IGlzIGFja25vd2xlZGdlZC5cbiAgICogQHBhcmFtIHtFcnJvcn0gY2F1c2UgLSBBIGpvYiBwZXJmb3JtIGVycm9yIHdob3NlIGZhaWxlZCB0ZXJtaW5hbCByZXBvcnQgd2FzIGFja25vd2xlZGdlZC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNhdXNlKSB7XG4gICAgc3VwZXIoY2F1c2UubWVzc2FnZSwge2NhdXNlfSlcbiAgICB0aGlzLm5hbWUgPSBcIkJhY2tncm91bmRKb2JQZXJmb3JtZWRGYWlsdXJlXCJcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgcmVwb3J0IGJlYWNvbiByZWFkeSBlcnJvci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gQmVhY29uIHJlYWRpbmVzcyBlcnJvci5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZXBvcnRCZWFjb25SZWFkeUVycm9yKGNvbmZpZ3VyYXRpb24sIGVycm9yKSB7XG4gIGNvbnN0IGVycm9yRXZlbnRzID0gY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG4gIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICBjb25zdCBwYXlsb2FkID0ge1xuICAgIGNvbnRleHQ6IHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtcnVubmVyXCIsIHN0YWdlOiBcImJlYWNvbi1yZWFkeVwifSxcbiAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gIH1cbiAgY29uc3QgaGFzTGlzdGVuZXIgPSBlcnJvckV2ZW50cy5saXN0ZW5lckNvdW50KFwiZnJhbWV3b3JrLWVycm9yXCIpID4gMFxuICAgIHx8IGVycm9yRXZlbnRzLmxpc3RlbmVyQ291bnQoXCJhbGwtZXJyb3JcIikgPiAwXG5cbiAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gIGlmICghaGFzTGlzdGVuZXIpIHtcbiAgICBjb25zb2xlLmVycm9yKGBbdmVsb2Npb3VzIGZyYW1ld29yay1lcnJvciBzdGFnZT1iZWFjb24tcmVhZHldICR7bm9ybWFsaXplZEVycm9yLm1lc3NhZ2V9YClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgY29ubmVjdCBiZWFjb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29ubmVjdEJlYWNvbihjb25maWd1cmF0aW9uKSB7XG4gIGNvbnN0IGJlYWNvbkNsaWVudCA9IGF3YWl0IGNvbmZpZ3VyYXRpb24uY29ubmVjdEJlYWNvbih7cGVlclR5cGU6IFwiYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwifSlcblxuICBpZiAoIWJlYWNvbkNsaWVudCkgcmV0dXJuXG5cbiAgdHJ5IHtcbiAgICBhd2FpdCBiZWFjb25DbGllbnQud2FpdEZvclJlYWR5KHt0aW1lb3V0TXM6IEJFQUNPTl9SRUFEWV9USU1FT1VUX01TfSlcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXBvcnRCZWFjb25SZWFkeUVycm9yKGNvbmZpZ3VyYXRpb24sIGVycm9yKVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIHByb2Nlc3MgdGl0bGUgdG8gc2hvdyB3aGlsZSBhIGpvYiBydW5zOiB0aGUgam9iIGNsYXNzJ3MgZGVjbGFyZWRcbiAqIGBzdGF0aWMgcHJvY2Vzc1RpdGxlYCwgZWxzZSBhIGB2ZWxvY2lvdXMgam9iLXJ1bm5lcjogPEpvYk5hbWU+YCBmYWxsYmFjay5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vam9iLmpzXCIpLmRlZmF1bHR9IEpvYkNsYXNzIC0gUmVzb2x2ZWQgam9iIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUHJvY2VzcyB0aXRsZS5cbiAqL1xuZnVuY3Rpb24gcnVubmVyUHJvY2Vzc1RpdGxlKEpvYkNsYXNzLCBwYXlsb2FkKSB7XG4gIGNvbnN0IGRlY2xhcmVkID0gSm9iQ2xhc3MucHJvY2Vzc1RpdGxlXG5cbiAgaWYgKHR5cGVvZiBkZWNsYXJlZCA9PT0gXCJzdHJpbmdcIiAmJiBkZWNsYXJlZC5sZW5ndGggPiAwKSByZXR1cm4gZGVjbGFyZWRcblxuICByZXR1cm4gYHZlbG9jaW91cyBqb2ItcnVubmVyOiAke3BheWxvYWQuam9iTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBydW4gam9iIHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFJ1bm5lciBvcHRpb25zLlxuICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5jbG9zZUNvbm5lY3Rpb25zXSAtIFdoZXRoZXIgdG8gZ3JhY2VmdWxseSBjbG9zZSBmcmFtZXdvcmsgY29ubmVjdGlvbnMgYWZ0ZXIgdGhlIGpvYi5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMubWFuYWdlUHJvY2Vzc1RpdGxlXSAtIFdoZXRoZXIgdG8gc2V0IHRoZSBwZXItam9iIHByb2Nlc3MgdGl0bGUgYW5kIHJlc3RvcmUgaXQgYWZ0ZXJ3YXJkcy4gT2ZmIGZvciBjb25jdXJyZW50IHBvb2xlZCBydW5uZXJzLCB3aGVyZSBpbnRlcmxlYXZlZCBzbmFwc2hvdC9yZXN0b3JlIG9mIHRoZSBzaW5nbGUgcHJvY2Vzcy13aWRlIGBwcm9jZXNzLnRpdGxlYCB3b3VsZCBjb3JydXB0IGl0OyB0aGUgcG9vbGVkIGNoaWxkIG93bnMgYW4gYWdncmVnYXRlIHRpdGxlIGluc3RlYWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMucHJvY2Vzc1R5cGVdIC0gR2VuZXJpYyBhcHBsaWNhdGlvbiBwcm9jZXNzIHR5cGUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxcImNvbXBsZXRlZFwiIHwgXCJyZXNjaGVkdWxlZFwiPn0gLSBBY2tub3dsZWRnZWQgb3V0Y29tZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgYXN5bmMgZnVuY3Rpb24gcnVuSm9iUGF5bG9hZChwYXlsb2FkLCB7Y2xvc2VDb25uZWN0aW9ucyA9IHRydWUsIG1hbmFnZVByb2Nlc3NUaXRsZSA9IHRydWUsIHByb2Nlc3NUeXBlID0gXCJiYWNrZ3JvdW5kLWpvYnMtcnVubmVyXCJ9ID0ge30pIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gIGNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gIGF3YWl0IGNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogcHJvY2Vzc1R5cGV9KVxuICBhd2FpdCBjb25uZWN0QmVhY29uKGNvbmZpZ3VyYXRpb24pXG4gIGNvbnN0IHJlcG9ydGVyID0gbmV3IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIoe2NvbmZpZ3VyYXRpb259KVxuXG4gIGNvbnN0IHJlZ2lzdHJ5ID0gbmV3IEJhY2tncm91bmRKb2JSZWdpc3RyeSh7Y29uZmlndXJhdGlvbn0pXG4gIGF3YWl0IHJlZ2lzdHJ5LmxvYWQoKVxuICBjb25zdCBKb2JDbGFzcyA9IHJlZ2lzdHJ5LmdldEpvYkJ5TmFtZShwYXlsb2FkLmpvYk5hbWUpXG4gIGNvbnN0IGpvYkluc3RhbmNlID0gbmV3IEpvYkNsYXNzKClcbiAgY29uc3Qgam9iQXJncyA9IHBheWxvYWQuYXJncyB8fCBbXVxuICBqb2JJbnN0YW5jZS5fc2V0QmFja2dyb3VuZEpvYkNvbnRleHQoe1xuICAgIGFyZ3M6IGpvYkFyZ3MsXG4gICAgam9iQ2xhc3M6IEpvYkNsYXNzLFxuICAgIGpvYk5hbWU6IHBheWxvYWQuam9iTmFtZSxcbiAgICBvcHRpb25zOiBwYXlsb2FkLm9wdGlvbnMgfHwge30sXG4gICAgcGF5bG9hZFxuICB9KVxuICAvKipcbiAgICogUGVyZm9ybS5cbiAgICogQHR5cGUgeyguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8dm9pZD59ICovXG4gIGNvbnN0IHBlcmZvcm0gPSBqb2JJbnN0YW5jZS5wZXJmb3JtXG5cbiAgLy8gTmFtZSB0aGUgcHJvY2VzcyBhZnRlciB0aGUgam9iIGl0IGlzIHJ1bm5pbmcgc28gYHBzYC9gdG9wYCBzaG93IHdoYXQgZWFjaFxuICAvLyBydW5uZXIgaXMgZG9pbmc7IHJlc3RvcmVkIGluIHRoZSBgZmluYWxseWAgYmVsb3cgd2hlbiB0aGUgam9iIGZpbmlzaGVzLlxuICAvLyBTa2lwcGVkIGZvciBjb25jdXJyZW50IHBvb2xlZCBydW5uZXJzLCB3aG9zZSBjaGlsZCBvd25zIGFuIGFnZ3JlZ2F0ZSB0aXRsZS5cbiAgY29uc3QgcHJldmlvdXNUaXRsZSA9IHByb2Nlc3MudGl0bGVcbiAgaWYgKG1hbmFnZVByb2Nlc3NUaXRsZSkgcHJvY2Vzcy50aXRsZSA9IHJ1bm5lclByb2Nlc3NUaXRsZShKb2JDbGFzcywgcGF5bG9hZClcblxuICB0cnkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLndpdGhDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogSm9iQ2xhc3MuZGF0YWJhc2VJZGVudGlmaWVycywgbmFtZTogYEJhY2tncm91bmQgam9iIHJ1bm5lcjogJHtwYXlsb2FkLmpvYk5hbWV9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgcGVyZm9ybS5hcHBseShqb2JJbnN0YW5jZSwgam9iQXJncylcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsKSB7XG4gICAgICAgIGlmIChwYXlsb2FkLmlkKSB7XG4gICAgICAgICAgYXdhaXQgcmVwb3J0ZXIucmVwb3J0V2l0aFJldHJ5KHtcbiAgICAgICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICAgICAgc3RhdHVzOiBcInJlc2NoZWR1bGVkXCIsXG4gICAgICAgICAgICBkZWxheU1zOiBlcnJvci5kZWxheU1zLFxuICAgICAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkLFxuICAgICAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgbWF4RHVyYXRpb25NczogMzAwMDAsXG4gICAgICAgICAgICByZXRyeVBlcnNpc3RFcnJvcnM6IHRydWVcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFwicmVzY2hlZHVsZWRcIlxuICAgICAgfVxuXG4gICAgICBjb25zdCBwZXJmb3JtZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgaWYgKHBheWxvYWQuaWQpIHtcbiAgICAgICAgYXdhaXQgcmVwb3J0ZXIucmVwb3J0V2l0aFJldHJ5KHtcbiAgICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgZXJyb3I6IHBlcmZvcm1lZEVycm9yLFxuICAgICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQsXG4gICAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIG1heER1cmF0aW9uTXM6IDMwMDAwXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBCYWNrZ3JvdW5kSm9iUGVyZm9ybWVkRmFpbHVyZShwZXJmb3JtZWRFcnJvcilcbiAgICB9XG5cbiAgICBpZiAocGF5bG9hZC5pZCkge1xuICAgICAgYXdhaXQgcmVwb3J0ZXIucmVwb3J0V2l0aFJldHJ5KHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgbWF4RHVyYXRpb25NczogMzAwMDBcbiAgICAgIH0pXG4gICAgfVxuICAgIHJldHVybiBcImNvbXBsZXRlZFwiXG4gIH0gZmluYWxseSB7XG4gICAgLy8gUmVzdG9yZSB0aGUgcnVubmVyJ3MgYmFzZSB0aXRsZSBzbyBhIGxpbmdlcmluZy9pZGxlIHJ1bm5lciAob3IgYSByZXVzZWRcbiAgICAvLyBvbmUpIGRvZXNuJ3QgbWlzcmVwb3J0IGEgZmluaXNoZWQgam9iIGFzIHN0aWxsIHJ1bm5pbmcuXG4gICAgaWYgKG1hbmFnZVByb2Nlc3NUaXRsZSkgcHJvY2Vzcy50aXRsZSA9IHByZXZpb3VzVGl0bGVcbiAgICBpZiAoY2xvc2VDb25uZWN0aW9ucykge1xuICAgICAgYXdhaXQgY2xvc2VSdW5uZXJDb25uZWN0aW9ucyhjb25maWd1cmF0aW9uKVxuICAgIH1cbiAgfVxufVxuIl19