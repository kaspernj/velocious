// @ts-check
import { randomUUID } from "node:crypto";
import timeout from "awaitery/build/timeout.js";
import runJobPayload, { BackgroundJobPerformedFailure } from "./job-runner.js";
import { boundedPooledRunnerInflightJobIds, isPooledChildShutdownReason, isPooledChildShutdownSignal } from "./pooled-runner-shutdown.js";
import { closeRunnerConnections, closeRunnerFrameworkConnections, currentConfigurationOrNull } from "./runner-graceful-shutdown.js";
import setRunnerProcessTitle from "./runner-process-title.js";
import PooledRunnerBrokerIdentity from "./pooled-runner-broker-identity.js";
import { runWithSharedTransactionBrokerConfig } from "../testing/shared-transaction-proxy-driver.js";
const BASE_PROCESS_TITLE = "velocious background-jobs-runner";
/** A shutdown observation may delay resource teardown only for this bounded IPC send. */
const SHUTDOWN_OBSERVATION_SEND_TIMEOUT_MS = 100;
/** Stable identity of this pooled child process for the life of the process. */
const childInstanceId = randomUUID();
setRunnerProcessTitle();
/** @type {Promise<void> | undefined} */
let shutdownPromise;
/**
 * Closes the runner's connections — releasing any advisory lock a killed-mid-pass
 * job still holds — before exiting, instead of leaving a half-open session that
 * keeps the lock until the DB server's `wait_timeout`.
 * @param {object} args - Shutdown observation.
 * @param {number} args.exitCode - Process exit code.
 * @param {import("./types.js").PooledChildShutdownReason} args.reason - Exact shutdown reason observed by the child.
 * @param {number | null} [args.shutdownRequestedAtMs] - Parent request timestamp when supplied over IPC.
 * @param {import("node:child_process").ChildProcess["signalCode"]} [args.signal] - Requested or observed signal.
 * @returns {Promise<void>}
 */
function shutdownRunner({ exitCode, reason, shutdownRequestedAtMs = null, signal = null }) {
    if (shutdownPromise)
        return shutdownPromise;
    shutdownPromise = (async () => {
        await sendShutdownObservation({ reason, shutdownRequestedAtMs, signal });
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
 * Sends one bounded lifecycle observation before application/framework teardown.
 * A closed IPC channel is expected for `ipc_disconnect`; other send failures are
 * surfaced on stderr but never hold connection cleanup past the fixed bound.
 * @param {object} args - Shutdown observation.
 * @param {import("./types.js").PooledChildShutdownReason} args.reason - Shutdown reason.
 * @param {number | null} args.shutdownRequestedAtMs - Parent request timestamp.
 * @param {import("node:child_process").ChildProcess["signalCode"]} args.signal - Requested or observed signal.
 * @returns {Promise<void>} - Resolves after IPC accepts the observation or the bound expires.
 */
async function sendShutdownObservation({ reason, shutdownRequestedAtMs, signal }) {
    if (!process.send || !process.connected)
        return;
    const boundedInflight = boundedPooledRunnerInflightJobIds(runningJobIds);
    /** @type {import("./types.js").PooledChildShutdownObservation & {type: "shutdown-observation"}} */
    const message = {
        childInstanceId,
        ...boundedInflight,
        reason,
        shutdownObservedAtMs: Date.now(),
        shutdownRequestedAtMs,
        signal,
        type: "shutdown-observation"
    };
    try {
        await timeout({ timeout: SHUTDOWN_OBSERVATION_SEND_TIMEOUT_MS }, async () => {
            await new Promise((resolve, reject) => {
                try {
                    process.send?.(message, (error) => {
                        if (error) {
                            reject(error);
                        }
                        else {
                            resolve(undefined);
                        }
                    });
                }
                catch (error) {
                    reject(error);
                }
            });
        });
    }
    catch (error) {
        console.error("Pooled background job runner could not send its shutdown observation:", error);
    }
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
 * Checks whether an IPC value requests a typed pooled-child shutdown.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is {type: "shutdown-request", reason: import("./types.js").PooledChildShutdownReason, shutdownRequestedAtMs: number, signal: import("node:child_process").ChildProcess["signalCode"]}} - Whether this is a valid parent shutdown request.
 */
function isShutdownRequestMessage(message) {
    if (!message || typeof message !== "object")
        return false;
    const record = /** @type {{type?: ReturnType<typeof JSON.parse>, reason?: ReturnType<typeof JSON.parse>, shutdownRequestedAtMs?: ReturnType<typeof JSON.parse>, signal?: ReturnType<typeof JSON.parse>}} */ (message);
    return record.type === "shutdown-request"
        && isPooledChildShutdownReason(record.reason)
        && typeof record.shutdownRequestedAtMs === "number"
        && Number.isFinite(record.shutdownRequestedAtMs)
        && isPooledChildShutdownSignal(record.signal);
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
    if (isShutdownRequestMessage(message)) {
        void shutdownRunner({
            exitCode: message.reason === "parent_retire_drained" ? 0 : 1,
            reason: message.reason,
            shutdownRequestedAtMs: message.shutdownRequestedAtMs,
            signal: message.signal
        });
        return;
    }
    if (!isJobMessage(message) || runningJobIds.has(message.payload.id))
        return;
    runningJobIds.add(message.payload.id);
    updateProcessTitle();
    sendChildAcceptance("job-received", message.payload, Date.now());
    void runJob(message.payload, message.sharedTransactionBroker || { expected: false });
}
process.on("message", (message) => handleMessage(message));
process.once("disconnect", () => void shutdownRunner({ exitCode: 0, reason: "ipc_disconnect" }));
process.once("SIGTERM", () => void shutdownRunner({ exitCode: 1, reason: "signal_sigterm", signal: "SIGTERM" }));
process.once("SIGINT", () => void shutdownRunner({ exitCode: 1, reason: "signal_sigint", signal: "SIGINT" }));
if (process.send)
    process.send({ childInstanceId, childPid: process.pid, type: "ready" });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9vbGVkLXJ1bm5lci1jaGlsZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvcG9vbGVkLXJ1bm5lci1jaGlsZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUN4QyxPQUFPLE9BQU8sTUFBTSwyQkFBMkIsQ0FBQTtBQUMvQyxPQUFPLGFBQWEsRUFBRSxFQUFFLDZCQUE2QixFQUFFLE1BQU0saUJBQWlCLENBQUE7QUFDOUUsT0FBTyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFDekksT0FBTyxFQUFFLHNCQUFzQixFQUFFLCtCQUErQixFQUFFLDBCQUEwQixFQUFFLE1BQU0sK0JBQStCLENBQUE7QUFDbkksT0FBTyxxQkFBcUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLG9DQUFvQyxDQUFBO0FBQzNFLE9BQU8sRUFBRSxvQ0FBb0MsRUFBRSxNQUFNLCtDQUErQyxDQUFBO0FBRXBHLE1BQU0sa0JBQWtCLEdBQUcsa0NBQWtDLENBQUE7QUFDN0QseUZBQXlGO0FBQ3pGLE1BQU0sb0NBQW9DLEdBQUcsR0FBRyxDQUFBO0FBQ2hELGdGQUFnRjtBQUNoRixNQUFNLGVBQWUsR0FBRyxVQUFVLEVBQUUsQ0FBQTtBQUVwQyxxQkFBcUIsRUFBRSxDQUFBO0FBRXZCLHdDQUF3QztBQUN4QyxJQUFJLGVBQWUsQ0FBQTtBQUVuQjs7Ozs7Ozs7OztHQVVHO0FBQ0gsU0FBUyxjQUFjLENBQUMsRUFBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLHFCQUFxQixHQUFHLElBQUksRUFBRSxNQUFNLEdBQUcsSUFBSSxFQUFDO0lBQ3JGLElBQUksZUFBZTtRQUFFLE9BQU8sZUFBZSxDQUFBO0lBRTNDLGVBQWUsR0FBRyxDQUFDLEtBQUssSUFB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RyxFQUFFLENBQUMsS0FBSyxjQUFjLENBQUMsRUFBQyxRQUFRLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQyxDQUFBO0FBQzlHLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLEdBQUcsRUFBRSxDQUFDLEtBQUssY0FBYyxDQUFDLEVBQUMsUUFBUSxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsZUFBZSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFDLENBQUE7QUFDM0csSUFBSSxPQUFPLENBQUMsSUFBSTtJQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBQyxlQUFlLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgdGltZW91dCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQgcnVuSm9iUGF5bG9hZCwgeyBCYWNrZ3JvdW5kSm9iUGVyZm9ybWVkRmFpbHVyZSB9IGZyb20gXCIuL2pvYi1ydW5uZXIuanNcIlxuaW1wb3J0IHsgYm91bmRlZFBvb2xlZFJ1bm5lckluZmxpZ2h0Sm9iSWRzLCBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24sIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blNpZ25hbCB9IGZyb20gXCIuL3Bvb2xlZC1ydW5uZXItc2h1dGRvd24uanNcIlxuaW1wb3J0IHsgY2xvc2VSdW5uZXJDb25uZWN0aW9ucywgY2xvc2VSdW5uZXJGcmFtZXdvcmtDb25uZWN0aW9ucywgY3VycmVudENvbmZpZ3VyYXRpb25Pck51bGwgfSBmcm9tIFwiLi9ydW5uZXItZ3JhY2VmdWwtc2h1dGRvd24uanNcIlxuaW1wb3J0IHNldFJ1bm5lclByb2Nlc3NUaXRsZSBmcm9tIFwiLi9ydW5uZXItcHJvY2Vzcy10aXRsZS5qc1wiXG5pbXBvcnQgUG9vbGVkUnVubmVyQnJva2VySWRlbnRpdHkgZnJvbSBcIi4vcG9vbGVkLXJ1bm5lci1icm9rZXItaWRlbnRpdHkuanNcIlxuaW1wb3J0IHsgcnVuV2l0aFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnIH0gZnJvbSBcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5cbmNvbnN0IEJBU0VfUFJPQ0VTU19USVRMRSA9IFwidmVsb2Npb3VzIGJhY2tncm91bmQtam9icy1ydW5uZXJcIlxuLyoqIEEgc2h1dGRvd24gb2JzZXJ2YXRpb24gbWF5IGRlbGF5IHJlc291cmNlIHRlYXJkb3duIG9ubHkgZm9yIHRoaXMgYm91bmRlZCBJUEMgc2VuZC4gKi9cbmNvbnN0IFNIVVRET1dOX09CU0VSVkFUSU9OX1NFTkRfVElNRU9VVF9NUyA9IDEwMFxuLyoqIFN0YWJsZSBpZGVudGl0eSBvZiB0aGlzIHBvb2xlZCBjaGlsZCBwcm9jZXNzIGZvciB0aGUgbGlmZSBvZiB0aGUgcHJvY2Vzcy4gKi9cbmNvbnN0IGNoaWxkSW5zdGFuY2VJZCA9IHJhbmRvbVVVSUQoKVxuXG5zZXRSdW5uZXJQcm9jZXNzVGl0bGUoKVxuXG4vKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG5sZXQgc2h1dGRvd25Qcm9taXNlXG5cbi8qKlxuICogQ2xvc2VzIHRoZSBydW5uZXIncyBjb25uZWN0aW9ucyDigJQgcmVsZWFzaW5nIGFueSBhZHZpc29yeSBsb2NrIGEga2lsbGVkLW1pZC1wYXNzXG4gKiBqb2Igc3RpbGwgaG9sZHMg4oCUIGJlZm9yZSBleGl0aW5nLCBpbnN0ZWFkIG9mIGxlYXZpbmcgYSBoYWxmLW9wZW4gc2Vzc2lvbiB0aGF0XG4gKiBrZWVwcyB0aGUgbG9jayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNodXRkb3duIG9ic2VydmF0aW9uLlxuICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZXhpdENvZGUgLSBQcm9jZXNzIGV4aXQgY29kZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duUmVhc29ufSBhcmdzLnJlYXNvbiAtIEV4YWN0IHNodXRkb3duIHJlYXNvbiBvYnNlcnZlZCBieSB0aGUgY2hpbGQuXG4gKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLnNodXRkb3duUmVxdWVzdGVkQXRNc10gLSBQYXJlbnQgcmVxdWVzdCB0aW1lc3RhbXAgd2hlbiBzdXBwbGllZCBvdmVyIElQQy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IFthcmdzLnNpZ25hbF0gLSBSZXF1ZXN0ZWQgb3Igb2JzZXJ2ZWQgc2lnbmFsLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmZ1bmN0aW9uIHNodXRkb3duUnVubmVyKHtleGl0Q29kZSwgcmVhc29uLCBzaHV0ZG93blJlcXVlc3RlZEF0TXMgPSBudWxsLCBzaWduYWwgPSBudWxsfSkge1xuICBpZiAoc2h1dGRvd25Qcm9taXNlKSByZXR1cm4gc2h1dGRvd25Qcm9taXNlXG5cbiAgc2h1dGRvd25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBzZW5kU2h1dGRvd25PYnNlcnZhdGlvbih7cmVhc29uLCBzaHV0ZG93blJlcXVlc3RlZEF0TXMsIHNpZ25hbH0pXG4gICAgYXdhaXQgY2xvc2VSdW5uZXJDb25uZWN0aW9ucyhjdXJyZW50Q29uZmlndXJhdGlvbk9yTnVsbCgpKVxuICAgIHByb2Nlc3MuZXhpdChleGl0Q29kZSlcbiAgfSkoKVxuXG4gIHJldHVybiBzaHV0ZG93blByb21pc2Vcbn1cblxuLyoqXG4gKiBJZHMgb2Ygam9icyBjdXJyZW50bHkgcnVubmluZyBpbiB0aGlzIGNoaWxkLiBBIHBvb2xlZCBjaGlsZCBydW5zIHVwIHRvXG4gKiBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3lgIGpvYnMgYXQgb25jZSAodGhlIHdvcmtlciBvbmx5IGRpc3BhdGNoZXMgd2l0aGluIHRoYXRcbiAqIGJvdW5kKTsgdGhlIHNldCBkZWR1cGVzIGEgcmVkZWxpdmVyZWQgam9iIGlkIGFuZCBsZXRzIGVhY2ggam9iIHNldHRsZVxuICogaW5kZXBlbmRlbnRseS5cbiAqIEB0eXBlIHtTZXQ8c3RyaW5nPn1cbiAqL1xuY29uc3QgcnVubmluZ0pvYklkcyA9IG5ldyBTZXQoKVxuY29uc3QgYnJva2VySWRlbnRpdHkgPSBuZXcgUG9vbGVkUnVubmVyQnJva2VySWRlbnRpdHkoe1xuICBjbG9zZUNvbm5lY3Rpb25zOiBhc3luYyAoKSA9PiBhd2FpdCBjbG9zZVJ1bm5lckZyYW1ld29ya0Nvbm5lY3Rpb25zKGN1cnJlbnRDb25maWd1cmF0aW9uT3JOdWxsKCkpXG59KVxuXG4vKipcbiAqIFNldHMgYW4gYWdncmVnYXRlIHByb2Nlc3MgdGl0bGUgZnJvbSB0aGUgY3VycmVudCBpbi1mbGlnaHQgY291bnQuIEEgY2hpbGQgcnVuc1xuICogam9icyBjb25jdXJyZW50bHksIHNvIGEgcGVyLWpvYiB0aXRsZSAod2hpY2ggYHJ1bkpvYlBheWxvYWRgIHdvdWxkIHNuYXBzaG90IGFuZFxuICogcmVzdG9yZSBhcm91bmQgYSBzaW5nbGUgam9iKSBjYW5ub3QgcmVwcmVzZW50IHRoZSBwcm9jZXNzIOKAlCBpbnRlcmxlYXZlZFxuICogY29tcGxldGlvbnMgd291bGQgbGVhdmUgYSBzdGFsZSBsYWJlbC4gUmVjb21wdXRpbmcgZnJvbSBgcnVubmluZ0pvYklkcy5zaXplYCBpc1xuICogY29uY3VycmVuY3ktc2FmZSBhbmQgaG9uZXN0OiBgcHNgL2B0b3BgIHNob3cgaG93IG1hbnkgam9icyB0aGUgY2hpbGQgaXMgcnVubmluZy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiB1cGRhdGVQcm9jZXNzVGl0bGUoKSB7XG4gIGNvbnN0IGNvdW50ID0gcnVubmluZ0pvYklkcy5zaXplXG5cbiAgcHJvY2Vzcy50aXRsZSA9IGNvdW50ID4gMCA/IGAke0JBU0VfUFJPQ0VTU19USVRMRX06ICR7Y291bnR9ICR7Y291bnQgPT09IDEgPyBcImpvYlwiIDogXCJqb2JzXCJ9YCA6IEJBU0VfUFJPQ0VTU19USVRMRVxufVxuXG4vKipcbiAqIFNlbmRzIG9uZSBib3VuZGVkIGxpZmVjeWNsZSBvYnNlcnZhdGlvbiBiZWZvcmUgYXBwbGljYXRpb24vZnJhbWV3b3JrIHRlYXJkb3duLlxuICogQSBjbG9zZWQgSVBDIGNoYW5uZWwgaXMgZXhwZWN0ZWQgZm9yIGBpcGNfZGlzY29ubmVjdGA7IG90aGVyIHNlbmQgZmFpbHVyZXMgYXJlXG4gKiBzdXJmYWNlZCBvbiBzdGRlcnIgYnV0IG5ldmVyIGhvbGQgY29ubmVjdGlvbiBjbGVhbnVwIHBhc3QgdGhlIGZpeGVkIGJvdW5kLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTaHV0ZG93biBvYnNlcnZhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duUmVhc29ufSBhcmdzLnJlYXNvbiAtIFNodXRkb3duIHJlYXNvbi5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zaHV0ZG93blJlcXVlc3RlZEF0TXMgLSBQYXJlbnQgcmVxdWVzdCB0aW1lc3RhbXAuXG4gKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBhcmdzLnNpZ25hbCAtIFJlcXVlc3RlZCBvciBvYnNlcnZlZCBzaWduYWwuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBJUEMgYWNjZXB0cyB0aGUgb2JzZXJ2YXRpb24gb3IgdGhlIGJvdW5kIGV4cGlyZXMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNlbmRTaHV0ZG93bk9ic2VydmF0aW9uKHtyZWFzb24sIHNodXRkb3duUmVxdWVzdGVkQXRNcywgc2lnbmFsfSkge1xuICBpZiAoIXByb2Nlc3Muc2VuZCB8fCAhcHJvY2Vzcy5jb25uZWN0ZWQpIHJldHVyblxuXG4gIGNvbnN0IGJvdW5kZWRJbmZsaWdodCA9IGJvdW5kZWRQb29sZWRSdW5uZXJJbmZsaWdodEpvYklkcyhydW5uaW5nSm9iSWRzKVxuICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uICYge3R5cGU6IFwic2h1dGRvd24tb2JzZXJ2YXRpb25cIn19ICovXG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgY2hpbGRJbnN0YW5jZUlkLFxuICAgIC4uLmJvdW5kZWRJbmZsaWdodCxcbiAgICByZWFzb24sXG4gICAgc2h1dGRvd25PYnNlcnZlZEF0TXM6IERhdGUubm93KCksXG4gICAgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zLFxuICAgIHNpZ25hbCxcbiAgICB0eXBlOiBcInNodXRkb3duLW9ic2VydmF0aW9uXCJcbiAgfVxuXG4gIHRyeSB7XG4gICAgYXdhaXQgdGltZW91dCh7dGltZW91dDogU0hVVERPV05fT0JTRVJWQVRJT05fU0VORF9USU1FT1VUX01TfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHByb2Nlc3Muc2VuZD8uKG1lc3NhZ2UsIChlcnJvcikgPT4ge1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihcIlBvb2xlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgY291bGQgbm90IHNlbmQgaXRzIHNodXRkb3duIG9ic2VydmF0aW9uOlwiLCBlcnJvcilcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydHMgb25lIGFjY2VwdGFuY2Ugb2JzZXJ2YXRpb24gKGpvYiByZWNlaXZlZCAvIHBlcmZvcm0gc3RhcnRlZCkgdG8gdGhlXG4gKiB3b3JrZXIgb3ZlciBJUEMuIFRoZSBtZXNzYWdlIGNhcnJpZXMgdGhlIGpvYidzIGV4YWN0IGhhbmRvZmYgbGVhc2Ugc28gdGhlXG4gKiB3b3JrZXIgY2FuIHBlcnNpc3QgaXQgZmVuY2VkIHdpdGhvdXQgYW55IG90aGVyIGxvb2t1cC4gU2VuZCBmYWlsdXJlcyBhcmVcbiAqIHN3YWxsb3dlZDogYSBkZWFkIElQQyBjaGFubmVsIGlzIHRlcm1pbmFsIGZvciB0aGlzIGNoaWxkICh0aGUgZGlzY29ubmVjdFxuICogaGFuZGxlciBvd25zIHNodXRkb3duKSwgYW5kIGxvc2luZyBhY2NlcHRhbmNlIGV2aWRlbmNlIG11c3QgbmV2ZXIgZmFpbCB0aGVcbiAqIGpvYiBpdHNlbGYuXG4gKiBAcGFyYW0ge1wiam9iLXJlY2VpdmVkXCIgfCBcImpvYi1zdGFydGVkXCJ9IHR5cGUgLSBPYnNlcnZhdGlvbiBraW5kLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gSm9iIHBheWxvYWQgY2FycnlpbmcgdGhlIGhhbmRvZmYgbGVhc2UuXG4gKiBAcGFyYW0ge251bWJlcn0gb2JzZXJ2ZWRBdE1zIC0gRXBvY2ggbXMgb2YgdGhlIG9ic2VydmF0aW9uLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHNlbmRDaGlsZEFjY2VwdGFuY2UodHlwZSwgcGF5bG9hZCwgb2JzZXJ2ZWRBdE1zKSB7XG4gIGlmICghcHJvY2Vzcy5zZW5kKSByZXR1cm5cblxuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGNoaWxkSW5zdGFuY2VJZCxcbiAgICBjaGlsZFBpZDogcHJvY2Vzcy5waWQsXG4gICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgdHlwZSxcbiAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCxcbiAgICAuLi4odHlwZSA9PT0gXCJqb2ItcmVjZWl2ZWRcIiA/IHtyZWNlaXZlZEF0TXM6IG9ic2VydmVkQXRNc30gOiB7c3RhcnRlZEF0TXM6IG9ic2VydmVkQXRNc30pXG4gIH1cblxuICB0cnkge1xuICAgIHByb2Nlc3Muc2VuZChtZXNzYWdlKVxuICB9IGNhdGNoIHtcbiAgICAvLyBUaGUgSVBDIGNoYW5uZWwgaXMgYWxyZWFkeSBnb25lOyB0aGUgZGlzY29ubmVjdCBoYW5kbGVyIG93bnMgc2h1dGRvd24uXG4gIH1cbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgYSBydW5uYWJsZSBwb29sZWQgam9iIG1lc3NhZ2UuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyB7dHlwZTogXCJqb2JcIiwgcGF5bG9hZDogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfSwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXI/OiBpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIGpvYiBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBpc0pvYk1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3t0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHBheWxvYWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXI/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChtZXNzYWdlKVxuXG4gIHJldHVybiByZWNvcmQudHlwZSA9PT0gXCJqb2JcIiAmJiAhIXJlY29yZC5wYXlsb2FkICYmIHR5cGVvZiByZWNvcmQucGF5bG9hZCA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgcmVjb3JkLnBheWxvYWQuaWQgPT09IFwic3RyaW5nXCJcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgcmVxdWVzdHMgYSB0eXBlZCBwb29sZWQtY2hpbGQgc2h1dGRvd24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyB7dHlwZTogXCJzaHV0ZG93bi1yZXF1ZXN0XCIsIHJlYXNvbjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duUmVhc29uLCBzaHV0ZG93blJlcXVlc3RlZEF0TXM6IG51bWJlciwgc2lnbmFsOiBpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX19IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgcGFyZW50IHNodXRkb3duIHJlcXVlc3QuXG4gKi9cbmZ1bmN0aW9uIGlzU2h1dGRvd25SZXF1ZXN0TWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7e3R5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVhc29uPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNodXRkb3duUmVxdWVzdGVkQXRNcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaWduYWw/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChtZXNzYWdlKVxuXG4gIHJldHVybiByZWNvcmQudHlwZSA9PT0gXCJzaHV0ZG93bi1yZXF1ZXN0XCJcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24ocmVjb3JkLnJlYXNvbilcbiAgICAmJiB0eXBlb2YgcmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zKVxuICAgICYmIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blNpZ25hbChyZWNvcmQuc2lnbmFsKVxufVxuXG4vKipcbiAqIFNlbmRzIHRoZSB0ZXJtaW5hbCBvdXRjb21lIGFmdGVyIHRoZSBtYWluL0RCIHJlcG9ydCBoYXMgYmVlbiBhY2tub3dsZWRnZWQgb3IgcmVqZWN0ZWQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE91dGNvbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5hY2tub3dsZWRnZWQgLSBXaGV0aGVyIHRoZSB0ZXJtaW5hbCByZXBvcnQgd2FzIGFja25vd2xlZGdlZC5cbiAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IFthcmdzLnN0YXR1c10gLSBBY2tub3dsZWRnZWQgb3V0Y29tZS5cbiAqIEBwYXJhbSB7RXJyb3J9IFthcmdzLmVycm9yXSAtIFJlcG9ydGluZyBlcnJvciB3aGVuIGFja25vd2xlZGdlbWVudCB3YXMgbm90IG9idGFpbmVkLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgSVBDIGFjY2VwdHMgdGhlIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIHNlbmRPdXRjb21lKHtqb2JJZCwgYWNrbm93bGVkZ2VkLCBzdGF0dXMsIGVycm9yfSkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBpZiAoIXByb2Nlc3Muc2VuZCkge1xuICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBwcm9jZXNzLnNlbmQoe1xuICAgICAgdHlwZTogXCJqb2Itb3V0Y29tZVwiLFxuICAgICAgam9iSWQsXG4gICAgICBhY2tub3dsZWRnZWQsXG4gICAgICBzdGF0dXMsXG4gICAgICByc3NCeXRlczogcHJvY2Vzcy5tZW1vcnlVc2FnZSgpLnJzcyxcbiAgICAgIGVycm9yOiBlcnJvcj8ubWVzc2FnZVxuICAgIH0sICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIG9uZSBqb2IgY29uY3VycmVudGx5IHdpdGggYW55IHNpYmxpbmdzIGFuZCByZXBvcnRzIGl0cyBvd24gdGVybWluYWxcbiAqIG91dGNvbWUuIEEgc2luZ2xlIGpvYidzIHVuZXhwZWN0ZWQgZmFpbHVyZSByZXBvcnRzIHRoYXQgam9iIGZvciByZWNsYW1hdGlvblxuICogKGBhY2tub3dsZWRnZWQ6IGZhbHNlYCkgYnV0IGRvZXMgTk9UIHRha2UgZG93biB0aGUgY2hpbGQg4oCUIGl0cyBjb25jdXJyZW50XG4gKiBzaWJsaW5ncyBrZWVwIHJ1bm5pbmcuIE9ubHkgYSBwcm9jZXNzLWxldmVsIGZhdWx0ICh3aGljaCBlc2NhcGVzIGV2ZXJ5XG4gKiBwZXItam9iIHRyeS9jYXRjaCkgZW5kcyB0aGUgY2hpbGQsIHdoaWNoIHRoZSB3b3JrZXIgc2VlcyBhcyBhbiBleGl0IGFuZFxuICogcmVjbGFpbXMgZm9yIHRoZSB3aG9sZSBpbi1mbGlnaHQgc2V0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiKS5TaGFyZWRUcmFuc2FjdGlvbkJyb2tlckpvYkNvbmZpZ30gc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIgLSBQZXItam9iIGJyb2tlciBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVwb3J0aW5nLlxuICovXG5hc3luYyBmdW5jdGlvbiBydW5Kb2IocGF5bG9hZCwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGF0dXMgPSBhd2FpdCBydW5XaXRoU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBicm9rZXJJZGVudGl0eS5ydW4oc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHJ1bkpvYlBheWxvYWQocGF5bG9hZCwge1xuICAgICAgICAgIGNsb3NlQ29ubmVjdGlvbnM6IGZhbHNlLFxuICAgICAgICAgIG1hbmFnZVByb2Nlc3NUaXRsZTogZmFsc2UsXG4gICAgICAgICAgb25QZXJmb3JtU3RhcnQ6ICgpID0+IHNlbmRDaGlsZEFjY2VwdGFuY2UoXCJqb2Itc3RhcnRlZFwiLCBwYXlsb2FkLCBEYXRlLm5vdygpKSxcbiAgICAgICAgICBwcm9jZXNzVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtcG9vbGVkLXJ1bm5lclwiXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH0pXG4gICAgYXdhaXQgc2VuZE91dGNvbWUoe2pvYklkOiBwYXlsb2FkLmlkLCBhY2tub3dsZWRnZWQ6IHRydWUsIHN0YXR1c30pXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYlBlcmZvcm1lZEZhaWx1cmUpIHtcbiAgICAgIGF3YWl0IHNlbmRPdXRjb21lKHtqb2JJZDogcGF5bG9hZC5pZCwgYWNrbm93bGVkZ2VkOiB0cnVlLCBzdGF0dXM6IFwiZmFpbGVkXCJ9KVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByZXBvcnRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc29sZS5lcnJvcihcIlBvb2xlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZmFpbGVkIGJlZm9yZSB0ZXJtaW5hbCBhY2tub3dsZWRnZW1lbnQ6XCIsIHJlcG9ydEVycm9yKVxuICAgICAgYXdhaXQgc2VuZE91dGNvbWUoe2pvYklkOiBwYXlsb2FkLmlkLCBhY2tub3dsZWRnZWQ6IGZhbHNlLCBlcnJvcjogcmVwb3J0RXJyb3J9KVxuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBydW5uaW5nSm9iSWRzLmRlbGV0ZShwYXlsb2FkLmlkKVxuICAgIHVwZGF0ZVByb2Nlc3NUaXRsZSgpXG4gIH1cbn1cblxuLyoqXG4gKiBIYW5kbGVzIGEgam9iIG1lc3NhZ2UsIHN0YXJ0aW5nIGl0IGFsb25nc2lkZSBhbnkgY29uY3VycmVudCBzaWJsaW5ncy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBoYW5kbGVNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKGlzU2h1dGRvd25SZXF1ZXN0TWVzc2FnZShtZXNzYWdlKSkge1xuICAgIHZvaWQgc2h1dGRvd25SdW5uZXIoe1xuICAgICAgZXhpdENvZGU6IG1lc3NhZ2UucmVhc29uID09PSBcInBhcmVudF9yZXRpcmVfZHJhaW5lZFwiID8gMCA6IDEsXG4gICAgICByZWFzb246IG1lc3NhZ2UucmVhc29uLFxuICAgICAgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zOiBtZXNzYWdlLnNodXRkb3duUmVxdWVzdGVkQXRNcyxcbiAgICAgIHNpZ25hbDogbWVzc2FnZS5zaWduYWxcbiAgICB9KVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKCFpc0pvYk1lc3NhZ2UobWVzc2FnZSkgfHwgcnVubmluZ0pvYklkcy5oYXMobWVzc2FnZS5wYXlsb2FkLmlkKSkgcmV0dXJuXG5cbiAgcnVubmluZ0pvYklkcy5hZGQobWVzc2FnZS5wYXlsb2FkLmlkKVxuICB1cGRhdGVQcm9jZXNzVGl0bGUoKVxuICBzZW5kQ2hpbGRBY2NlcHRhbmNlKFwiam9iLXJlY2VpdmVkXCIsIG1lc3NhZ2UucGF5bG9hZCwgRGF0ZS5ub3coKSlcbiAgdm9pZCBydW5Kb2IobWVzc2FnZS5wYXlsb2FkLCBtZXNzYWdlLnNoYXJlZFRyYW5zYWN0aW9uQnJva2VyIHx8IHtleHBlY3RlZDogZmFsc2V9KVxufVxuXG5wcm9jZXNzLm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4gaGFuZGxlTWVzc2FnZShtZXNzYWdlKSlcbnByb2Nlc3Mub25jZShcImRpc2Nvbm5lY3RcIiwgKCkgPT4gdm9pZCBzaHV0ZG93blJ1bm5lcih7ZXhpdENvZGU6IDAsIHJlYXNvbjogXCJpcGNfZGlzY29ubmVjdFwifSkpXG5wcm9jZXNzLm9uY2UoXCJTSUdURVJNXCIsICgpID0+IHZvaWQgc2h1dGRvd25SdW5uZXIoe2V4aXRDb2RlOiAxLCByZWFzb246IFwic2lnbmFsX3NpZ3Rlcm1cIiwgc2lnbmFsOiBcIlNJR1RFUk1cIn0pKVxucHJvY2Vzcy5vbmNlKFwiU0lHSU5UXCIsICgpID0+IHZvaWQgc2h1dGRvd25SdW5uZXIoe2V4aXRDb2RlOiAxLCByZWFzb246IFwic2lnbmFsX3NpZ2ludFwiLCBzaWduYWw6IFwiU0lHSU5UXCJ9KSlcbmlmIChwcm9jZXNzLnNlbmQpIHByb2Nlc3Muc2VuZCh7Y2hpbGRJbnN0YW5jZUlkLCBjaGlsZFBpZDogcHJvY2Vzcy5waWQsIHR5cGU6IFwicmVhZHlcIn0pXG4iXX0=