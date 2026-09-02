// @ts-check
import runJobPayload, { BackgroundJobPerformedFailure } from "./job-runner.js";
import { closeRunnerConnections, closeRunnerFrameworkConnections, currentConfigurationOrNull } from "./runner-graceful-shutdown.js";
import setRunnerProcessTitle from "./runner-process-title.js";
import PooledRunnerBrokerIdentity from "./pooled-runner-broker-identity.js";
import { runWithSharedTransactionBrokerConfig } from "../testing/shared-transaction-proxy-driver.js";
const BASE_PROCESS_TITLE = "velocious background-jobs-runner";
setRunnerProcessTitle();
/** @type {Promise<void> | undefined} */
let shutdownPromise;
/**
 * Closes the runner's connections — releasing any advisory lock a killed-mid-pass
 * job still holds — before exiting, instead of leaving a half-open session that
 * keeps the lock until the DB server's `wait_timeout`.
 * @param {number} exitCode - Process exit code.
 * @returns {Promise<void>}
 */
function shutdownRunner(exitCode) {
    if (shutdownPromise)
        return shutdownPromise;
    shutdownPromise = (async () => {
        await closeRunnerConnections(currentConfigurationOrNull());
        process.exit(exitCode);
    })();
    return shutdownPromise;
}
/**
 * Ids of jobs currently running in this child. A pooled child runs up to
 * `pooledRunnerConcurrency` jobs at once (the worker only dispatches within that
 * bound); the set dedupes a redelivered job id and lets each job settle
 * independently.
 * @type {Set<string>}
 */
const runningJobIds = new Set();
const brokerIdentity = new PooledRunnerBrokerIdentity({
    closeConnections: async () => await closeRunnerFrameworkConnections(currentConfigurationOrNull())
});
/**
 * Sets an aggregate process title from the current in-flight count. A child runs
 * jobs concurrently, so a per-job title (which `runJobPayload` would snapshot and
 * restore around a single job) cannot represent the process — interleaved
 * completions would leave a stale label. Recomputing from `runningJobIds.size` is
 * concurrency-safe and honest: `ps`/`top` show how many jobs the child is running.
 * @returns {void}
 */
function updateProcessTitle() {
    const count = runningJobIds.size;
    process.title = count > 0 ? `${BASE_PROCESS_TITLE}: ${count} ${count === 1 ? "job" : "jobs"}` : BASE_PROCESS_TITLE;
}
/**
 * Checks whether an IPC value is a runnable pooled job message.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is {type: "job", payload: import("./types.js").BackgroundJobPayload & {id: string}, sharedTransactionBroker?: import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig}} - Whether this is a valid job message.
 */
function isJobMessage(message) {
    if (!message || typeof message !== "object")
        return false;
    const record = /** @type {{type?: ReturnType<typeof JSON.parse>, payload?: ReturnType<typeof JSON.parse>, sharedTransactionBroker?: ReturnType<typeof JSON.parse>}} */ (message);
    return record.type === "job" && !!record.payload && typeof record.payload === "object" && typeof record.payload.id === "string";
}
/**
 * Sends the terminal outcome after the main/DB report has been acknowledged or rejected.
 * @param {object} args - Outcome.
 * @param {string} args.jobId - Job id.
 * @param {boolean} args.acknowledged - Whether the terminal report was acknowledged.
 * @param {"completed" | "failed" | "rescheduled"} [args.status] - Acknowledged outcome.
 * @param {Error} [args.error] - Reporting error when acknowledgement was not obtained.
 * @returns {Promise<void>} - Resolves after IPC accepts the message.
 */
function sendOutcome({ jobId, acknowledged, status, error }) {
    return new Promise((resolve) => {
        if (!process.send) {
            resolve(undefined);
            return;
        }
        process.send({
            type: "job-outcome",
            jobId,
            acknowledged,
            status,
            rssBytes: process.memoryUsage().rss,
            error: error?.message
        }, () => resolve(undefined));
    });
}
/**
 * Runs one job concurrently with any siblings and reports its own terminal
 * outcome. A single job's unexpected failure reports that job for reclamation
 * (`acknowledged: false`) but does NOT take down the child — its concurrent
 * siblings keep running. Only a process-level fault (which escapes every
 * per-job try/catch) ends the child, which the worker sees as an exit and
 * reclaims for the whole in-flight set.
 * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Job payload.
 * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} sharedTransactionBroker - Per-job broker configuration.
 * @returns {Promise<void>} - Resolves after reporting.
 */
async function runJob(payload, sharedTransactionBroker) {
    try {
        const status = await runWithSharedTransactionBrokerConfig(sharedTransactionBroker, async () => {
            return await brokerIdentity.run(sharedTransactionBroker, async () => {
                return await runJobPayload(payload, {
                    closeConnections: false,
                    manageProcessTitle: false,
                    processType: "background-jobs-pooled-runner"
                });
            });
        });
        await sendOutcome({ jobId: payload.id, acknowledged: true, status });
    }
    catch (error) {
        if (error instanceof BackgroundJobPerformedFailure) {
            await sendOutcome({ jobId: payload.id, acknowledged: true, status: "failed" });
        }
        else {
            const reportError = error instanceof Error ? error : new Error(String(error));
            console.error("Pooled background job runner failed before terminal acknowledgement:", reportError);
            await sendOutcome({ jobId: payload.id, acknowledged: false, error: reportError });
        }
    }
    finally {
        runningJobIds.delete(payload.id);
        updateProcessTitle();
    }
}
/**
 * Handles a job message, starting it alongside any concurrent siblings.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {void}
 */
function handleMessage(message) {
    if (!isJobMessage(message) || runningJobIds.has(message.payload.id))
        return;
    runningJobIds.add(message.payload.id);
    updateProcessTitle();
    void runJob(message.payload, message.sharedTransactionBroker || { expected: false });
}
process.on("message", (message) => handleMessage(message));
process.once("disconnect", () => void shutdownRunner(0));
for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => void shutdownRunner(1));
if (process.send)
    process.send({ type: "ready" });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9vbGVkLXJ1bm5lci1jaGlsZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvcG9vbGVkLXJ1bm5lci1jaGlsZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLEVBQUUsRUFBRSw2QkFBNkIsRUFBRSxNQUFNLGlCQUFpQixDQUFBO0FBQzlFLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSwrQkFBK0IsRUFBRSwwQkFBMEIsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25JLE9BQU8scUJBQXFCLE1BQU0sMkJBQTJCLENBQUE7QUFDN0QsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLEVBQUUsb0NBQW9DLEVBQUUsTUFBTSwrQ0FBK0MsQ0FBQTtBQUVwRyxNQUFNLGtCQUFrQixHQUFHLGtDQUFrQyxDQUFBO0FBRTdELHFCQUFxQixFQUFFLENBQUE7QUFFdkIsd0NBQXdDO0FBQ3hDLElBQUksZUFBZSxDQUFBO0FBRW5COzs7Ozs7R0FNRztBQUNILFNBQVMsY0FBYyxDQUFDLFFBQVE7SUFDOUIsSUFBSSxlQUFlO1FBQUUsT0FBTyxlQUFlLENBQUE7SUFFM0MsZUFBZSxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDNUIsTUFBTSxzQkFBc0IsQ0FBQywwQkFBMEIsRUFBRSxDQUFDLENBQUE7UUFDMUQsT0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUN4QixDQUFDLENBQUMsRUFBRSxDQUFBO0lBRUosT0FBTyxlQUFlLENBQUE7QUFDeEIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFDL0IsTUFBTSxjQUFjLEdBQUcsSUFBSSwwQkFBMEIsQ0FBQztJQUNwRCxnQkFBZ0IsRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sK0JBQStCLENBQUMsMEJBQTBC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QUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDLEtBQUssY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7QUFDOUYsSUFBSSxPQUFPLENBQUMsSUFBSTtJQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcnVuSm9iUGF5bG9hZCwgeyBCYWNrZ3JvdW5kSm9iUGVyZm9ybWVkRmFpbHVyZSB9IGZyb20gXCIuL2pvYi1ydW5uZXIuanNcIlxuaW1wb3J0IHsgY2xvc2VSdW5uZXJDb25uZWN0aW9ucywgY2xvc2VSdW5uZXJGcmFtZXdvcmtDb25uZWN0aW9ucywgY3VycmVudENvbmZpZ3VyYXRpb25Pck51bGwgfSBmcm9tIFwiLi9ydW5uZXItZ3JhY2VmdWwtc2h1dGRvd24uanNcIlxuaW1wb3J0IHNldFJ1bm5lclByb2Nlc3NUaXRsZSBmcm9tIFwiLi9ydW5uZXItcHJvY2Vzcy10aXRsZS5qc1wiXG5pbXBvcnQgUG9vbGVkUnVubmVyQnJva2VySWRlbnRpdHkgZnJvbSBcIi4vcG9vbGVkLXJ1bm5lci1icm9rZXItaWRlbnRpdHkuanNcIlxuaW1wb3J0IHsgcnVuV2l0aFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnIH0gZnJvbSBcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5cbmNvbnN0IEJBU0VfUFJPQ0VTU19USVRMRSA9IFwidmVsb2Npb3VzIGJhY2tncm91bmQtam9icy1ydW5uZXJcIlxuXG5zZXRSdW5uZXJQcm9jZXNzVGl0bGUoKVxuXG4vKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG5sZXQgc2h1dGRvd25Qcm9taXNlXG5cbi8qKlxuICogQ2xvc2VzIHRoZSBydW5uZXIncyBjb25uZWN0aW9ucyDigJQgcmVsZWFzaW5nIGFueSBhZHZpc29yeSBsb2NrIGEga2lsbGVkLW1pZC1wYXNzXG4gKiBqb2Igc3RpbGwgaG9sZHMg4oCUIGJlZm9yZSBleGl0aW5nLCBpbnN0ZWFkIG9mIGxlYXZpbmcgYSBoYWxmLW9wZW4gc2Vzc2lvbiB0aGF0XG4gKiBrZWVwcyB0aGUgbG9jayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuXG4gKiBAcGFyYW0ge251bWJlcn0gZXhpdENvZGUgLSBQcm9jZXNzIGV4aXQgY29kZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5mdW5jdGlvbiBzaHV0ZG93blJ1bm5lcihleGl0Q29kZSkge1xuICBpZiAoc2h1dGRvd25Qcm9taXNlKSByZXR1cm4gc2h1dGRvd25Qcm9taXNlXG5cbiAgc2h1dGRvd25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBjbG9zZVJ1bm5lckNvbm5lY3Rpb25zKGN1cnJlbnRDb25maWd1cmF0aW9uT3JOdWxsKCkpXG4gICAgcHJvY2Vzcy5leGl0KGV4aXRDb2RlKVxuICB9KSgpXG5cbiAgcmV0dXJuIHNodXRkb3duUHJvbWlzZVxufVxuXG4vKipcbiAqIElkcyBvZiBqb2JzIGN1cnJlbnRseSBydW5uaW5nIGluIHRoaXMgY2hpbGQuIEEgcG9vbGVkIGNoaWxkIHJ1bnMgdXAgdG9cbiAqIGBwb29sZWRSdW5uZXJDb25jdXJyZW5jeWAgam9icyBhdCBvbmNlICh0aGUgd29ya2VyIG9ubHkgZGlzcGF0Y2hlcyB3aXRoaW4gdGhhdFxuICogYm91bmQpOyB0aGUgc2V0IGRlZHVwZXMgYSByZWRlbGl2ZXJlZCBqb2IgaWQgYW5kIGxldHMgZWFjaCBqb2Igc2V0dGxlXG4gKiBpbmRlcGVuZGVudGx5LlxuICogQHR5cGUge1NldDxzdHJpbmc+fVxuICovXG5jb25zdCBydW5uaW5nSm9iSWRzID0gbmV3IFNldCgpXG5jb25zdCBicm9rZXJJZGVudGl0eSA9IG5ldyBQb29sZWRSdW5uZXJCcm9rZXJJZGVudGl0eSh7XG4gIGNsb3NlQ29ubmVjdGlvbnM6IGFzeW5jICgpID0+IGF3YWl0IGNsb3NlUnVubmVyRnJhbWV3b3JrQ29ubmVjdGlvbnMoY3VycmVudENvbmZpZ3VyYXRpb25Pck51bGwoKSlcbn0pXG5cbi8qKlxuICogU2V0cyBhbiBhZ2dyZWdhdGUgcHJvY2VzcyB0aXRsZSBmcm9tIHRoZSBjdXJyZW50IGluLWZsaWdodCBjb3VudC4gQSBjaGlsZCBydW5zXG4gKiBqb2JzIGNvbmN1cnJlbnRseSwgc28gYSBwZXItam9iIHRpdGxlICh3aGljaCBgcnVuSm9iUGF5bG9hZGAgd291bGQgc25hcHNob3QgYW5kXG4gKiByZXN0b3JlIGFyb3VuZCBhIHNpbmdsZSBqb2IpIGNhbm5vdCByZXByZXNlbnQgdGhlIHByb2Nlc3Mg4oCUIGludGVybGVhdmVkXG4gKiBjb21wbGV0aW9ucyB3b3VsZCBsZWF2ZSBhIHN0YWxlIGxhYmVsLiBSZWNvbXB1dGluZyBmcm9tIGBydW5uaW5nSm9iSWRzLnNpemVgIGlzXG4gKiBjb25jdXJyZW5jeS1zYWZlIGFuZCBob25lc3Q6IGBwc2AvYHRvcGAgc2hvdyBob3cgbWFueSBqb2JzIHRoZSBjaGlsZCBpcyBydW5uaW5nLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHVwZGF0ZVByb2Nlc3NUaXRsZSgpIHtcbiAgY29uc3QgY291bnQgPSBydW5uaW5nSm9iSWRzLnNpemVcblxuICBwcm9jZXNzLnRpdGxlID0gY291bnQgPiAwID8gYCR7QkFTRV9QUk9DRVNTX1RJVExFfTogJHtjb3VudH0gJHtjb3VudCA9PT0gMSA/IFwiam9iXCIgOiBcImpvYnNcIn1gIDogQkFTRV9QUk9DRVNTX1RJVExFXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcnVubmFibGUgcG9vbGVkIGpvYiBtZXNzYWdlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwiam9iXCIsIHBheWxvYWQ6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30sIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyPzogaW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfX0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBqb2IgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gaXNKb2JNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHt7dHlwZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwYXlsb2FkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwiam9iXCIgJiYgISFyZWNvcmQucGF5bG9hZCAmJiB0eXBlb2YgcmVjb3JkLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHJlY29yZC5wYXlsb2FkLmlkID09PSBcInN0cmluZ1wiXG59XG5cbi8qKlxuICogU2VuZHMgdGhlIHRlcm1pbmFsIG91dGNvbWUgYWZ0ZXIgdGhlIG1haW4vREIgcmVwb3J0IGhhcyBiZWVuIGFja25vd2xlZGdlZCBvciByZWplY3RlZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3V0Y29tZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICogQHBhcmFtIHtib29sZWFufSBhcmdzLmFja25vd2xlZGdlZCAtIFdoZXRoZXIgdGhlIHRlcm1pbmFsIHJlcG9ydCB3YXMgYWNrbm93bGVkZ2VkLlxuICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gW2FyZ3Muc3RhdHVzXSAtIEFja25vd2xlZGdlZCBvdXRjb21lLlxuICogQHBhcmFtIHtFcnJvcn0gW2FyZ3MuZXJyb3JdIC0gUmVwb3J0aW5nIGVycm9yIHdoZW4gYWNrbm93bGVkZ2VtZW50IHdhcyBub3Qgb2J0YWluZWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBJUEMgYWNjZXB0cyB0aGUgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gc2VuZE91dGNvbWUoe2pvYklkLCBhY2tub3dsZWRnZWQsIHN0YXR1cywgZXJyb3J9KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGlmICghcHJvY2Vzcy5zZW5kKSB7XG4gICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHByb2Nlc3Muc2VuZCh7XG4gICAgICB0eXBlOiBcImpvYi1vdXRjb21lXCIsXG4gICAgICBqb2JJZCxcbiAgICAgIGFja25vd2xlZGdlZCxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHJzc0J5dGVzOiBwcm9jZXNzLm1lbW9yeVVzYWdlKCkucnNzLFxuICAgICAgZXJyb3I6IGVycm9yPy5tZXNzYWdlXG4gICAgfSwgKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgb25lIGpvYiBjb25jdXJyZW50bHkgd2l0aCBhbnkgc2libGluZ3MgYW5kIHJlcG9ydHMgaXRzIG93biB0ZXJtaW5hbFxuICogb3V0Y29tZS4gQSBzaW5nbGUgam9iJ3MgdW5leHBlY3RlZCBmYWlsdXJlIHJlcG9ydHMgdGhhdCBqb2IgZm9yIHJlY2xhbWF0aW9uXG4gKiAoYGFja25vd2xlZGdlZDogZmFsc2VgKSBidXQgZG9lcyBOT1QgdGFrZSBkb3duIHRoZSBjaGlsZCDigJQgaXRzIGNvbmN1cnJlbnRcbiAqIHNpYmxpbmdzIGtlZXAgcnVubmluZy4gT25seSBhIHByb2Nlc3MtbGV2ZWwgZmF1bHQgKHdoaWNoIGVzY2FwZXMgZXZlcnlcbiAqIHBlci1qb2IgdHJ5L2NhdGNoKSBlbmRzIHRoZSBjaGlsZCwgd2hpY2ggdGhlIHdvcmtlciBzZWVzIGFzIGFuIGV4aXQgYW5kXG4gKiByZWNsYWltcyBmb3IgdGhlIHdob2xlIGluLWZsaWdodCBzZXQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBKb2IgcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfSBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlciAtIFBlci1qb2IgYnJva2VyIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXBvcnRpbmcuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJ1bkpvYihwYXlsb2FkLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlcikge1xuICB0cnkge1xuICAgIGNvbnN0IHN0YXR1cyA9IGF3YWl0IHJ1bldpdGhTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZyhzaGFyZWRUcmFuc2FjdGlvbkJyb2tlciwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGJyb2tlcklkZW50aXR5LnJ1bihzaGFyZWRUcmFuc2FjdGlvbkJyb2tlciwgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgcnVuSm9iUGF5bG9hZChwYXlsb2FkLCB7XG4gICAgICAgICAgY2xvc2VDb25uZWN0aW9uczogZmFsc2UsXG4gICAgICAgICAgbWFuYWdlUHJvY2Vzc1RpdGxlOiBmYWxzZSxcbiAgICAgICAgICBwcm9jZXNzVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtcG9vbGVkLXJ1bm5lclwiXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH0pXG4gICAgYXdhaXQgc2VuZE91dGNvbWUoe2pvYklkOiBwYXlsb2FkLmlkLCBhY2tub3dsZWRnZWQ6IHRydWUsIHN0YXR1c30pXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYlBlcmZvcm1lZEZhaWx1cmUpIHtcbiAgICAgIGF3YWl0IHNlbmRPdXRjb21lKHtqb2JJZDogcGF5bG9hZC5pZCwgYWNrbm93bGVkZ2VkOiB0cnVlLCBzdGF0dXM6IFwiZmFpbGVkXCJ9KVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByZXBvcnRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc29sZS5lcnJvcihcIlBvb2xlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZmFpbGVkIGJlZm9yZSB0ZXJtaW5hbCBhY2tub3dsZWRnZW1lbnQ6XCIsIHJlcG9ydEVycm9yKVxuICAgICAgYXdhaXQgc2VuZE91dGNvbWUoe2pvYklkOiBwYXlsb2FkLmlkLCBhY2tub3dsZWRnZWQ6IGZhbHNlLCBlcnJvcjogcmVwb3J0RXJyb3J9KVxuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBydW5uaW5nSm9iSWRzLmRlbGV0ZShwYXlsb2FkLmlkKVxuICAgIHVwZGF0ZVByb2Nlc3NUaXRsZSgpXG4gIH1cbn1cblxuLyoqXG4gKiBIYW5kbGVzIGEgam9iIG1lc3NhZ2UsIHN0YXJ0aW5nIGl0IGFsb25nc2lkZSBhbnkgY29uY3VycmVudCBzaWJsaW5ncy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBoYW5kbGVNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFpc0pvYk1lc3NhZ2UobWVzc2FnZSkgfHwgcnVubmluZ0pvYklkcy5oYXMobWVzc2FnZS5wYXlsb2FkLmlkKSkgcmV0dXJuXG5cbiAgcnVubmluZ0pvYklkcy5hZGQobWVzc2FnZS5wYXlsb2FkLmlkKVxuICB1cGRhdGVQcm9jZXNzVGl0bGUoKVxuICB2b2lkIHJ1bkpvYihtZXNzYWdlLnBheWxvYWQsIG1lc3NhZ2Uuc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIgfHwge2V4cGVjdGVkOiBmYWxzZX0pXG59XG5cbnByb2Nlc3Mub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiBoYW5kbGVNZXNzYWdlKG1lc3NhZ2UpKVxucHJvY2Vzcy5vbmNlKFwiZGlzY29ubmVjdFwiLCAoKSA9PiB2b2lkIHNodXRkb3duUnVubmVyKDApKVxuZm9yIChjb25zdCBzaWduYWwgb2YgW1wiU0lHVEVSTVwiLCBcIlNJR0lOVFwiXSkgcHJvY2Vzcy5vbmNlKHNpZ25hbCwgKCkgPT4gdm9pZCBzaHV0ZG93blJ1bm5lcigxKSlcbmlmIChwcm9jZXNzLnNlbmQpIHByb2Nlc3Muc2VuZCh7dHlwZTogXCJyZWFkeVwifSlcbiJdfQ==