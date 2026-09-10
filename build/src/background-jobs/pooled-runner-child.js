// @ts-check
import { randomUUID } from "node:crypto";
import runJobPayload, { BackgroundJobPerformedFailure } from "./job-runner.js";
import { closeRunnerConnections, closeRunnerFrameworkConnections, currentConfigurationOrNull } from "./runner-graceful-shutdown.js";
import setRunnerProcessTitle from "./runner-process-title.js";
import PooledRunnerBrokerIdentity from "./pooled-runner-broker-identity.js";
import { runWithSharedTransactionBrokerConfig } from "../testing/shared-transaction-proxy-driver.js";
const BASE_PROCESS_TITLE = "velocious background-jobs-runner";
/** Stable identity of this pooled child process for the life of the process. */
const childInstanceId = randomUUID();
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
 * Reports one acceptance observation (job received / perform started) to the
 * worker over IPC. The message carries the job's exact handoff lease so the
 * worker can persist it fenced without any other lookup. Send failures are
 * swallowed: a dead IPC channel is terminal for this child (the disconnect
 * handler owns shutdown), and losing acceptance evidence must never fail the
 * job itself.
 * @param {"job-received" | "job-started"} type - Observation kind.
 * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Job payload carrying the handoff lease.
 * @param {number} observedAtMs - Epoch ms of the observation.
 * @returns {void}
 */
function sendChildAcceptance(type, payload, observedAtMs) {
    if (!process.send)
        return;
    const message = {
        childInstanceId,
        childPid: process.pid,
        handedOffAtMs: payload.handedOffAtMs,
        handoffId: payload.handoffId,
        jobId: payload.id,
        type,
        workerId: payload.workerId,
        ...(type === "job-received" ? { receivedAtMs: observedAtMs } : { startedAtMs: observedAtMs })
    };
    try {
        process.send(message);
    }
    catch {
        // The IPC channel is already gone; the disconnect handler owns shutdown.
    }
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
                    onPerformStart: () => sendChildAcceptance("job-started", payload, Date.now()),
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
    sendChildAcceptance("job-received", message.payload, Date.now());
    void runJob(message.payload, message.sharedTransactionBroker || { expected: false });
}
process.on("message", (message) => handleMessage(message));
process.once("disconnect", () => void shutdownRunner(0));
for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => void shutdownRunner(1));
if (process.send)
    process.send({ type: "ready" });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9vbGVkLXJ1bm5lci1jaGlsZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvcG9vbGVkLXJ1bm5lci1jaGlsZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUN4QyxPQUFPLGFBQWEsRUFBRSxFQUFFLDZCQUE2QixFQUFFLE1BQU0saUJBQWlCLENBQUE7QUFDOUUsT0FBTyxFQUFFLHNCQUFzQixFQUFFLCtCQUErQixFQUFFLDBCQUEwQixFQUFFLE1BQU0sK0JBQStCLENBQUE7QUFDbkksT0FBTyxxQkFBcUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLG9DQUFvQyxDQUFBO0FBQzNFLE9BQU8sRUFBRSxvQ0FBb0MsRUFBRSxNQUFNLCtDQUErQyxDQUFBO0FBRXBHLE1BQU0sa0JBQWtCLEdBQUcsa0NBQWtDLENBQUE7QUFDN0QsZ0ZBQWdGO0FBQ2hGLE1BQU0sZUFBZSxHQUFHLFVBQVUsRUFBRSxDQUFBO0FBRXBDLHFCQUFxQixFQUFFLENBQUE7QUFFdkIsd0NBQXdDO0FBQ3hDLElBQUksZUFBZSxDQUFBO0FBRW5COzs7Ozs7R0FNRztBQUNILFNBQVMsY0FBYyxDQUFDLFFBQVE7SUFDOUIsSUFBSSxlQUFlO1FBQUUsT0FBTyxlQUFlLENBQUE7SUFFM0MsZUFBZSxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDNUIsTUFBTSxzQkFBc0IsQ0FBQywwQkFBMEIsRUFBRSxDQUFDLENBQUE7UUFDMUQsT0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUN4QixDQUFDLENBQUMsRUFBRSxDQUFBO0lBRUosT0FBTyxlQUFlLENBQUE7QUFDeEIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFDL0IsTUFB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LE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCJcbmltcG9ydCBydW5Kb2JQYXlsb2FkLCB7IEJhY2tncm91bmRKb2JQZXJmb3JtZWRGYWlsdXJlIH0gZnJvbSBcIi4vam9iLXJ1bm5lci5qc1wiXG5pbXBvcnQgeyBjbG9zZVJ1bm5lckNvbm5lY3Rpb25zLCBjbG9zZVJ1bm5lckZyYW1ld29ya0Nvbm5lY3Rpb25zLCBjdXJyZW50Q29uZmlndXJhdGlvbk9yTnVsbCB9IGZyb20gXCIuL3J1bm5lci1ncmFjZWZ1bC1zaHV0ZG93bi5qc1wiXG5pbXBvcnQgc2V0UnVubmVyUHJvY2Vzc1RpdGxlIGZyb20gXCIuL3J1bm5lci1wcm9jZXNzLXRpdGxlLmpzXCJcbmltcG9ydCBQb29sZWRSdW5uZXJCcm9rZXJJZGVudGl0eSBmcm9tIFwiLi9wb29sZWQtcnVubmVyLWJyb2tlci1pZGVudGl0eS5qc1wiXG5pbXBvcnQgeyBydW5XaXRoU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcgfSBmcm9tIFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCJcblxuY29uc3QgQkFTRV9QUk9DRVNTX1RJVExFID0gXCJ2ZWxvY2lvdXMgYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwiXG4vKiogU3RhYmxlIGlkZW50aXR5IG9mIHRoaXMgcG9vbGVkIGNoaWxkIHByb2Nlc3MgZm9yIHRoZSBsaWZlIG9mIHRoZSBwcm9jZXNzLiAqL1xuY29uc3QgY2hpbGRJbnN0YW5jZUlkID0gcmFuZG9tVVVJRCgpXG5cbnNldFJ1bm5lclByb2Nlc3NUaXRsZSgpXG5cbi8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbmxldCBzaHV0ZG93blByb21pc2VcblxuLyoqXG4gKiBDbG9zZXMgdGhlIHJ1bm5lcidzIGNvbm5lY3Rpb25zIOKAlCByZWxlYXNpbmcgYW55IGFkdmlzb3J5IGxvY2sgYSBraWxsZWQtbWlkLXBhc3NcbiAqIGpvYiBzdGlsbCBob2xkcyDigJQgYmVmb3JlIGV4aXRpbmcsIGluc3RlYWQgb2YgbGVhdmluZyBhIGhhbGYtb3BlbiBzZXNzaW9uIHRoYXRcbiAqIGtlZXBzIHRoZSBsb2NrIHVudGlsIHRoZSBEQiBzZXJ2ZXIncyBgd2FpdF90aW1lb3V0YC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBleGl0Q29kZSAtIFByb2Nlc3MgZXhpdCBjb2RlLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmZ1bmN0aW9uIHNodXRkb3duUnVubmVyKGV4aXRDb2RlKSB7XG4gIGlmIChzaHV0ZG93blByb21pc2UpIHJldHVybiBzaHV0ZG93blByb21pc2VcblxuICBzaHV0ZG93blByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNsb3NlUnVubmVyQ29ubmVjdGlvbnMoY3VycmVudENvbmZpZ3VyYXRpb25Pck51bGwoKSlcbiAgICBwcm9jZXNzLmV4aXQoZXhpdENvZGUpXG4gIH0pKClcblxuICByZXR1cm4gc2h1dGRvd25Qcm9taXNlXG59XG5cbi8qKlxuICogSWRzIG9mIGpvYnMgY3VycmVudGx5IHJ1bm5pbmcgaW4gdGhpcyBjaGlsZC4gQSBwb29sZWQgY2hpbGQgcnVucyB1cCB0b1xuICogYHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5YCBqb2JzIGF0IG9uY2UgKHRoZSB3b3JrZXIgb25seSBkaXNwYXRjaGVzIHdpdGhpbiB0aGF0XG4gKiBib3VuZCk7IHRoZSBzZXQgZGVkdXBlcyBhIHJlZGVsaXZlcmVkIGpvYiBpZCBhbmQgbGV0cyBlYWNoIGpvYiBzZXR0bGVcbiAqIGluZGVwZW5kZW50bHkuXG4gKiBAdHlwZSB7U2V0PHN0cmluZz59XG4gKi9cbmNvbnN0IHJ1bm5pbmdKb2JJZHMgPSBuZXcgU2V0KClcbmNvbnN0IGJyb2tlcklkZW50aXR5ID0gbmV3IFBvb2xlZFJ1bm5lckJyb2tlcklkZW50aXR5KHtcbiAgY2xvc2VDb25uZWN0aW9uczogYXN5bmMgKCkgPT4gYXdhaXQgY2xvc2VSdW5uZXJGcmFtZXdvcmtDb25uZWN0aW9ucyhjdXJyZW50Q29uZmlndXJhdGlvbk9yTnVsbCgpKVxufSlcblxuLyoqXG4gKiBTZXRzIGFuIGFnZ3JlZ2F0ZSBwcm9jZXNzIHRpdGxlIGZyb20gdGhlIGN1cnJlbnQgaW4tZmxpZ2h0IGNvdW50LiBBIGNoaWxkIHJ1bnNcbiAqIGpvYnMgY29uY3VycmVudGx5LCBzbyBhIHBlci1qb2IgdGl0bGUgKHdoaWNoIGBydW5Kb2JQYXlsb2FkYCB3b3VsZCBzbmFwc2hvdCBhbmRcbiAqIHJlc3RvcmUgYXJvdW5kIGEgc2luZ2xlIGpvYikgY2Fubm90IHJlcHJlc2VudCB0aGUgcHJvY2VzcyDigJQgaW50ZXJsZWF2ZWRcbiAqIGNvbXBsZXRpb25zIHdvdWxkIGxlYXZlIGEgc3RhbGUgbGFiZWwuIFJlY29tcHV0aW5nIGZyb20gYHJ1bm5pbmdKb2JJZHMuc2l6ZWAgaXNcbiAqIGNvbmN1cnJlbmN5LXNhZmUgYW5kIGhvbmVzdDogYHBzYC9gdG9wYCBzaG93IGhvdyBtYW55IGpvYnMgdGhlIGNoaWxkIGlzIHJ1bm5pbmcuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gdXBkYXRlUHJvY2Vzc1RpdGxlKCkge1xuICBjb25zdCBjb3VudCA9IHJ1bm5pbmdKb2JJZHMuc2l6ZVxuXG4gIHByb2Nlc3MudGl0bGUgPSBjb3VudCA+IDAgPyBgJHtCQVNFX1BST0NFU1NfVElUTEV9OiAke2NvdW50fSAke2NvdW50ID09PSAxID8gXCJqb2JcIiA6IFwiam9ic1wifWAgOiBCQVNFX1BST0NFU1NfVElUTEVcbn1cblxuLyoqXG4gKiBSZXBvcnRzIG9uZSBhY2NlcHRhbmNlIG9ic2VydmF0aW9uIChqb2IgcmVjZWl2ZWQgLyBwZXJmb3JtIHN0YXJ0ZWQpIHRvIHRoZVxuICogd29ya2VyIG92ZXIgSVBDLiBUaGUgbWVzc2FnZSBjYXJyaWVzIHRoZSBqb2IncyBleGFjdCBoYW5kb2ZmIGxlYXNlIHNvIHRoZVxuICogd29ya2VyIGNhbiBwZXJzaXN0IGl0IGZlbmNlZCB3aXRob3V0IGFueSBvdGhlciBsb29rdXAuIFNlbmQgZmFpbHVyZXMgYXJlXG4gKiBzd2FsbG93ZWQ6IGEgZGVhZCBJUEMgY2hhbm5lbCBpcyB0ZXJtaW5hbCBmb3IgdGhpcyBjaGlsZCAodGhlIGRpc2Nvbm5lY3RcbiAqIGhhbmRsZXIgb3ducyBzaHV0ZG93biksIGFuZCBsb3NpbmcgYWNjZXB0YW5jZSBldmlkZW5jZSBtdXN0IG5ldmVyIGZhaWwgdGhlXG4gKiBqb2IgaXRzZWxmLlxuICogQHBhcmFtIHtcImpvYi1yZWNlaXZlZFwiIHwgXCJqb2Itc3RhcnRlZFwifSB0eXBlIC0gT2JzZXJ2YXRpb24ga2luZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIEpvYiBwYXlsb2FkIGNhcnJ5aW5nIHRoZSBoYW5kb2ZmIGxlYXNlLlxuICogQHBhcmFtIHtudW1iZXJ9IG9ic2VydmVkQXRNcyAtIEVwb2NoIG1zIG9mIHRoZSBvYnNlcnZhdGlvbi5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBzZW5kQ2hpbGRBY2NlcHRhbmNlKHR5cGUsIHBheWxvYWQsIG9ic2VydmVkQXRNcykge1xuICBpZiAoIXByb2Nlc3Muc2VuZCkgcmV0dXJuXG5cbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBjaGlsZEluc3RhbmNlSWQsXG4gICAgY2hpbGRQaWQ6IHByb2Nlc3MucGlkLFxuICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgIHR5cGUsXG4gICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQsXG4gICAgLi4uKHR5cGUgPT09IFwiam9iLXJlY2VpdmVkXCIgPyB7cmVjZWl2ZWRBdE1zOiBvYnNlcnZlZEF0TXN9IDoge3N0YXJ0ZWRBdE1zOiBvYnNlcnZlZEF0TXN9KVxuICB9XG5cbiAgdHJ5IHtcbiAgICBwcm9jZXNzLnNlbmQobWVzc2FnZSlcbiAgfSBjYXRjaCB7XG4gICAgLy8gVGhlIElQQyBjaGFubmVsIGlzIGFscmVhZHkgZ29uZTsgdGhlIGRpc2Nvbm5lY3QgaGFuZGxlciBvd25zIHNodXRkb3duLlxuICB9XG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcnVubmFibGUgcG9vbGVkIGpvYiBtZXNzYWdlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwiam9iXCIsIHBheWxvYWQ6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30sIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyPzogaW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfX0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBqb2IgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gaXNKb2JNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHt7dHlwZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwYXlsb2FkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwiam9iXCIgJiYgISFyZWNvcmQucGF5bG9hZCAmJiB0eXBlb2YgcmVjb3JkLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHJlY29yZC5wYXlsb2FkLmlkID09PSBcInN0cmluZ1wiXG59XG5cbi8qKlxuICogU2VuZHMgdGhlIHRlcm1pbmFsIG91dGNvbWUgYWZ0ZXIgdGhlIG1haW4vREIgcmVwb3J0IGhhcyBiZWVuIGFja25vd2xlZGdlZCBvciByZWplY3RlZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3V0Y29tZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICogQHBhcmFtIHtib29sZWFufSBhcmdzLmFja25vd2xlZGdlZCAtIFdoZXRoZXIgdGhlIHRlcm1pbmFsIHJlcG9ydCB3YXMgYWNrbm93bGVkZ2VkLlxuICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gW2FyZ3Muc3RhdHVzXSAtIEFja25vd2xlZGdlZCBvdXRjb21lLlxuICogQHBhcmFtIHtFcnJvcn0gW2FyZ3MuZXJyb3JdIC0gUmVwb3J0aW5nIGVycm9yIHdoZW4gYWNrbm93bGVkZ2VtZW50IHdhcyBub3Qgb2J0YWluZWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBJUEMgYWNjZXB0cyB0aGUgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gc2VuZE91dGNvbWUoe2pvYklkLCBhY2tub3dsZWRnZWQsIHN0YXR1cywgZXJyb3J9KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGlmICghcHJvY2Vzcy5zZW5kKSB7XG4gICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHByb2Nlc3Muc2VuZCh7XG4gICAgICB0eXBlOiBcImpvYi1vdXRjb21lXCIsXG4gICAgICBqb2JJZCxcbiAgICAgIGFja25vd2xlZGdlZCxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHJzc0J5dGVzOiBwcm9jZXNzLm1lbW9yeVVzYWdlKCkucnNzLFxuICAgICAgZXJyb3I6IGVycm9yPy5tZXNzYWdlXG4gICAgfSwgKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgb25lIGpvYiBjb25jdXJyZW50bHkgd2l0aCBhbnkgc2libGluZ3MgYW5kIHJlcG9ydHMgaXRzIG93biB0ZXJtaW5hbFxuICogb3V0Y29tZS4gQSBzaW5nbGUgam9iJ3MgdW5leHBlY3RlZCBmYWlsdXJlIHJlcG9ydHMgdGhhdCBqb2IgZm9yIHJlY2xhbWF0aW9uXG4gKiAoYGFja25vd2xlZGdlZDogZmFsc2VgKSBidXQgZG9lcyBOT1QgdGFrZSBkb3duIHRoZSBjaGlsZCDigJQgaXRzIGNvbmN1cnJlbnRcbiAqIHNpYmxpbmdzIGtlZXAgcnVubmluZy4gT25seSBhIHByb2Nlc3MtbGV2ZWwgZmF1bHQgKHdoaWNoIGVzY2FwZXMgZXZlcnlcbiAqIHBlci1qb2IgdHJ5L2NhdGNoKSBlbmRzIHRoZSBjaGlsZCwgd2hpY2ggdGhlIHdvcmtlciBzZWVzIGFzIGFuIGV4aXQgYW5kXG4gKiByZWNsYWltcyBmb3IgdGhlIHdob2xlIGluLWZsaWdodCBzZXQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBKb2IgcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfSBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlciAtIFBlci1qb2IgYnJva2VyIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXBvcnRpbmcuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJ1bkpvYihwYXlsb2FkLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlcikge1xuICB0cnkge1xuICAgIGNvbnN0IHN0YXR1cyA9IGF3YWl0IHJ1bldpdGhTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZyhzaGFyZWRUcmFuc2FjdGlvbkJyb2tlciwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGJyb2tlcklkZW50aXR5LnJ1bihzaGFyZWRUcmFuc2FjdGlvbkJyb2tlciwgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgcnVuSm9iUGF5bG9hZChwYXlsb2FkLCB7XG4gICAgICAgICAgY2xvc2VDb25uZWN0aW9uczogZmFsc2UsXG4gICAgICAgICAgbWFuYWdlUHJvY2Vzc1RpdGxlOiBmYWxzZSxcbiAgICAgICAgICBvblBlcmZvcm1TdGFydDogKCkgPT4gc2VuZENoaWxkQWNjZXB0YW5jZShcImpvYi1zdGFydGVkXCIsIHBheWxvYWQsIERhdGUubm93KCkpLFxuICAgICAgICAgIHByb2Nlc3NUeXBlOiBcImJhY2tncm91bmQtam9icy1wb29sZWQtcnVubmVyXCJcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgICBhd2FpdCBzZW5kT3V0Y29tZSh7am9iSWQ6IHBheWxvYWQuaWQsIGFja25vd2xlZGdlZDogdHJ1ZSwgc3RhdHVzfSlcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iUGVyZm9ybWVkRmFpbHVyZSkge1xuICAgICAgYXdhaXQgc2VuZE91dGNvbWUoe2pvYklkOiBwYXlsb2FkLmlkLCBhY2tub3dsZWRnZWQ6IHRydWUsIHN0YXR1czogXCJmYWlsZWRcIn0pXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHJlcG9ydEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgICBjb25zb2xlLmVycm9yKFwiUG9vbGVkIGJhY2tncm91bmQgam9iIHJ1bm5lciBmYWlsZWQgYmVmb3JlIHRlcm1pbmFsIGFja25vd2xlZGdlbWVudDpcIiwgcmVwb3J0RXJyb3IpXG4gICAgICBhd2FpdCBzZW5kT3V0Y29tZSh7am9iSWQ6IHBheWxvYWQuaWQsIGFja25vd2xlZGdlZDogZmFsc2UsIGVycm9yOiByZXBvcnRFcnJvcn0pXG4gICAgfVxuICB9IGZpbmFsbHkge1xuICAgIHJ1bm5pbmdKb2JJZHMuZGVsZXRlKHBheWxvYWQuaWQpXG4gICAgdXBkYXRlUHJvY2Vzc1RpdGxlKClcbiAgfVxufVxuXG4vKipcbiAqIEhhbmRsZXMgYSBqb2IgbWVzc2FnZSwgc3RhcnRpbmcgaXQgYWxvbmdzaWRlIGFueSBjb25jdXJyZW50IHNpYmxpbmdzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGhhbmRsZU1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIWlzSm9iTWVzc2FnZShtZXNzYWdlKSB8fCBydW5uaW5nSm9iSWRzLmhhcyhtZXNzYWdlLnBheWxvYWQuaWQpKSByZXR1cm5cblxuICBydW5uaW5nSm9iSWRzLmFkZChtZXNzYWdlLnBheWxvYWQuaWQpXG4gIHVwZGF0ZVByb2Nlc3NUaXRsZSgpXG4gIHNlbmRDaGlsZEFjY2VwdGFuY2UoXCJqb2ItcmVjZWl2ZWRcIiwgbWVzc2FnZS5wYXlsb2FkLCBEYXRlLm5vdygpKVxuICB2b2lkIHJ1bkpvYihtZXNzYWdlLnBheWxvYWQsIG1lc3NhZ2Uuc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIgfHwge2V4cGVjdGVkOiBmYWxzZX0pXG59XG5cbnByb2Nlc3Mub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiBoYW5kbGVNZXNzYWdlKG1lc3NhZ2UpKVxucHJvY2Vzcy5vbmNlKFwiZGlzY29ubmVjdFwiLCAoKSA9PiB2b2lkIHNodXRkb3duUnVubmVyKDApKVxuZm9yIChjb25zdCBzaWduYWwgb2YgW1wiU0lHVEVSTVwiLCBcIlNJR0lOVFwiXSkgcHJvY2Vzcy5vbmNlKHNpZ25hbCwgKCkgPT4gdm9pZCBzaHV0ZG93blJ1bm5lcigxKSlcbmlmIChwcm9jZXNzLnNlbmQpIHByb2Nlc3Muc2VuZCh7dHlwZTogXCJyZWFkeVwifSlcbiJdfQ==