// @ts-check
import { randomUUID } from "node:crypto";
import v8 from "node:v8";
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
/** Sampling cadence for the memory observation sampler. */
const MEMORY_OBSERVATION_INTERVAL_MS = 10000;
/** Bound on in-flight job ids carried in a memory observation. */
const MEMORY_OBSERVATION_JOB_ID_LIMIT = 32;
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
 * Collects a bounded diagnostic snapshot of this child's memory state. The
 * pooled child's stdio is ignored by the worker fork, so IPC is the only channel
 * to the worker's log surface — this snapshot (sent periodically and on demand)
 * is how a memory problem names itself in production. The V8 heap-stat
 * breakdown (not a full heap snapshot, which would be far too expensive while a
 * child runs 25 concurrent jobs) distinguishes a V8 heap-growth leak from
 * external/array-buffer (native resource) growth, and the in-flight job ids
 * tie the observation to the work that was running.
 * @returns {{activeJobIds: string[], activeJobIdsTruncatedCount: number, childInstanceId: string, childPid: number, childUptimeMs: number, heapStatistics: ReturnType<typeof v8.getHeapStatistics>, jobCount: number, memoryUsage: ReturnType<typeof process.memoryUsage>, observedAtMs: number, rssBytes: number, type: "pooled-child-memory", uptimeMs: number}} - Bounded memory observation for this child.
 */
function collectMemoryObservation() {
    const jobIds = [...runningJobIds];
    const activeJobIds = jobIds.slice(0, MEMORY_OBSERVATION_JOB_ID_LIMIT);
    const memoryUsage = process.memoryUsage();
    return {
        activeJobIds,
        activeJobIdsTruncatedCount: Math.max(0, jobIds.length - activeJobIds.length),
        childInstanceId,
        childPid: process.pid,
        childUptimeMs: Math.floor(process.uptime() * 1000),
        heapStatistics: v8.getHeapStatistics(),
        jobCount: jobIds.length,
        memoryUsage,
        observedAtMs: Date.now(),
        rssBytes: memoryUsage.rss,
        type: "pooled-child-memory",
        uptimeMs: Math.floor(process.uptime() * 1000)
    };
}
/**
 * Sends a memory observation to the worker. Sampling is cheap (process + V8
 * heap stats) and only runs while jobs are in flight; a closed IPC channel is
 * terminal for this child (the disconnect handler owns shutdown), so a failed
 * send is swallowed.
 * @returns {void}
 */
function sendMemoryObservation() {
    if (!process.send || runningJobIds.size === 0)
        return;
    try {
        process.send(collectMemoryObservation());
    }
    catch {
        // The IPC channel is already gone; the disconnect handler owns shutdown.
    }
}
/** @type {ReturnType<typeof setInterval> | undefined} */
let memoryObservationTimer;
/**
 * Checks whether an IPC value requests this child to send a memory observation.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is {type: "memory-observation-request"}} - Whether the message requests one.
 */
function isMemoryObservationRequestMessage(message) {
    return message !== null
        && typeof message === "object"
        && message.type === "memory-observation-request";
}
/**
 * Starts the periodic memory observation sampler if it is not already running.
 * @returns {void}
 */
function startMemoryObservationSampling() {
    if (memoryObservationTimer || !process.send)
        return;
    memoryObservationTimer = setInterval(() => {
        sendMemoryObservation();
    }, MEMORY_OBSERVATION_INTERVAL_MS);
    memoryObservationTimer.unref();
}
/**
 * Stops the periodic memory observation sampler.
 * @returns {void}
 */
function stopMemoryObservationSampling() {
    if (!memoryObservationTimer)
        return;
    clearInterval(memoryObservationTimer);
    memoryObservationTimer = undefined;
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
        if (runningJobIds.size === 0) {
            stopMemoryObservationSampling();
        }
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
    if (isMemoryObservationRequestMessage(message)) {
        sendMemoryObservation();
        return;
    }
    if (!isJobMessage(message) || runningJobIds.has(message.payload.id))
        return;
    runningJobIds.add(message.payload.id);
    updateProcessTitle();
    sendChildAcceptance("job-received", message.payload, Date.now());
    startMemoryObservationSampling();
    void runJob(message.payload, message.sharedTransactionBroker || { expected: false });
}
process.on("message", (message) => handleMessage(message));
process.once("disconnect", () => void shutdownRunner({ exitCode: 0, reason: "ipc_disconnect" }));
process.once("SIGTERM", () => void shutdownRunner({ exitCode: 1, reason: "signal_sigterm", signal: "SIGTERM" }));
process.once("SIGINT", () => void shutdownRunner({ exitCode: 1, reason: "signal_sigint", signal: "SIGINT" }));
if (process.send)
    process.send({ childInstanceId, childPid: process.pid, type: "ready" });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9vbGVkLXJ1bm5lci1jaGlsZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvcG9vbGVkLXJ1bm5lci1jaGlsZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUN4QyxPQUFPLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFDeEIsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxhQUFhLEVBQUUsRUFBRSw2QkFBNkIsRUFBRSxNQUFNLGlCQUFpQixDQUFBO0FBQzlFLE9BQU8sRUFBRSxpQ0FBaUMsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBRSxNQUFNLDZCQUE2QixDQUFBO0FBQ3pJLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSwrQkFBK0IsRUFBRSwwQkFBMEIsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ25JLE9BQU8scUJBQXFCLE1BQU0sMkJBQTJCLENBQUE7QUFDN0QsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLEVBQUUsb0NBQW9DLEVBQUUsTUFBTSwrQ0FBK0MsQ0FBQTtBQUVwRyxNQUFNLGtCQUFrQixHQUFHLGtDQUFrQyxDQUFBO0FBQzdELHlGQUF5RjtBQUN6RixNQUFNLG9DQUFvQyxHQUFHLEdBQUcsQ0FBQTtBQUNoRCxnRkFBZ0Y7QUFDaEYsTUFBTSxlQUFlLEdBQUcsVUFBVSxFQUFFLENBQUE7QUFDcEMsMkRBQTJEO0FBQzNELE1BQU0sOEJBQThCLEdBQUcsS0FBSyxDQUFBO0FBQzVDLGtFQUFrRTtBQUNsRSxNQUFNLCtCQUErQixHQUFHLEVBQUUsQ0FBQTtBQUUxQyxxQkFBcUIsRUFBRSxDQUFBO0FBRXZCLHdDQUF3QztBQUN4QyxJQUFJLGVBQWUsQ0FBQTtBQUVuQjs7Ozs7Ozs7OztHQVVHO0FBQ0gsU0FBUyxjQUFjLENBQUMsRUFBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLHFCQUFxQixHQUFHLElBQUksRUFBRSxNQUFNLEdBQUcsSUFBSSxFQUFDO0lBQ3JGLElBQUksZUFBZTtRQUFFLE9BQU8sZUFBZSxDQUFBO0lBRTNDLGVBQWUsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFO1FBQzVCLE1BQU0sdUJBQXVCLENBQUMsRUFBQyxNQUFNLEVBQUUscUJBQXFCLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUN0RSxNQUFNLHNCQUFzQixDQUFDLDBCQUEwQixFQUFFLENBQUMsQ0FBQTtRQUMxRCxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQ3hCLENBQUMsQ0FBQyxFQUFFLENBQUE7SUFFSixPQUFPLGVBQWUsQ0FBQTtBQUN4QixDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtBQUMvQixNQUFNLGNBQWMsR0FBRyxJQUFJLDBCQUEwQixDQUFDO0lBQ3BELGdCQUFnQixFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSwrQkFBK0IsQ0FBQywwQkFBMEIsRUFBRSxDQUFDO0NBQ2xHLENBQUMsQ0FBQTtBQUVGOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLGtCQUFrQjtJQUN6QixNQUFNLEtBQUssR0FBRyxhQUFhLENBQUMsSUFBSSxDQUFBO0lBRWhDLE9BQU8sQ0FBQyxLQUFLLEdBQUcsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxrQkFBa0IsS0FBSyxLQUFLLElBQUksS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUE7QUFDcEgsQ0FBQztBQUVEOzs7Ozs7Ozs7R0FTRztBQUNILEtBQUssVUFBVSx1QkFBdUIsQ0FBQyxFQUFDLE1BQU0sRUFBRSxxQkFBcUIsRUFBRSxNQUFNLEVBQUM7SUFDNUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUztRQUFFLE9BQU07SUFFL0MsTUFBTSxlQUFlLEdBQUcsaUNBQWlDLENBQUMsYUFBYSxDQUFDLENBQUE7SUFDeEUsbUdBQW1HO0lBQ25HLE1BQU0sT0FBTyxHQUFHO1FBQ2QsZUFBZTtRQUNmLEdBQUcsZUFBZTtRQUNsQixNQUFNO1FBQ04sb0JBQW9CLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtRQUNoQyxxQkFBcUI7UUFDckIsTUFBTTtRQUNOLElBQUksRUFBRSxzQkFBc0I7S0FDN0IsQ0FBQTtJQUVELElBQUksQ0FBQztRQUNILE1BQU0sT0FBTyxDQUFDLEVBQUMsT0FBTyxFQUFFLG9DQUFvQyxFQUFDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDeEUsTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtnQkFDcEMsSUFBSSxDQUFDO29CQUNILE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRTt3QkFDaEMsSUFBSSxLQUFLLEVBQUUsQ0FBQzs0QkFDVixNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7d0JBQ2YsQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQTt3QkFDcEIsQ0FBQztvQkFDSCxDQUFDLENBQUMsQ0FBQTtnQkFDSixDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO2dCQUNmLENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHVFQUF1RSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQy9GLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7Ozs7Ozs7O0dBV0c7QUFDSCxTQUFTLG1CQUFtQixDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsWUFBWTtJQUN0RCxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUk7UUFBRSxPQUFNO0lBRXpCLE1BQU0sT0FBTyxHQUFHO1FBQ2QsZUFBZTtRQUNmLFFBQVEsRUFBRSxPQUFPLENBQUMsR0FBRztRQUNyQixhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7UUFDcEMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO1FBQzVCLEtBQUssRUFBRSxPQUFPLENBQUMsRUFBRTtRQUNqQixJQUFJO1FBQ0osUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO1FBQzFCLEdBQUcsQ0FBQyxJQUFJLEtBQUssY0FBYyxDQUFDLENBQUMsQ0FBQyxFQUFDLFlBQVksRUFBRSxZQUFZLEVBQUMsQ0FBQyxDQUFDLENBQUMsRUFBQyxXQUFXLEVBQUUsWUFBWSxFQUFDLENBQUM7S0FDMUYsQ0FBQTtJQUVELElBQUksQ0FBQztRQUNILE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDdkIsQ0FBQztJQUFDLE1BQU0sQ0FBQztRQUNQLHlFQUF5RTtJQUMzRSxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7Ozs7O0dBVUc7QUFDSCxTQUFTLHdCQUF3QjtJQUMvQixNQUFNLE1BQU0sR0FBRyxDQUFDLEdBQUcsYUFBYSxDQUFDLENBQUE7SUFDakMsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsK0JBQStCLENBQUMsQ0FBQTtJQUNyRSxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUE7SUFFekMsT0FBTztRQUNMLFlBQVk7UUFDWiwwQkFBMEIsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUM7UUFDNUUsZUFBZTtRQUNmLFFBQVEsRUFBRSxPQUFPLENBQUMsR0FBRztRQUNyQixhQUFhLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDO1FBQ2xELGNBQWMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLEVBQUU7UUFDdEMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxNQUFNO1FBQ3ZCLFdBQVc7UUFDWCxZQUFZLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtRQUN4QixRQUFRLEVBQUUsV0FBVyxDQUFDLEdBQUc7UUFDekIsSUFBSSxFQUFFLHFCQUFxQjtRQUMzQixRQUFRLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDO0tBQzlDLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyxxQkFBcUI7SUFDNUIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLElBQUksYUFBYSxDQUFDLElBQUksS0FBSyxDQUFDO1FBQUUsT0FBTTtJQUVyRCxJQUFJLENBQUM7UUFDSCxPQUFPLENBQUMsSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUMsQ0FBQTtJQUMxQyxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AseUVBQXlFO0lBQzNFLENBQUM7QUFDSCxDQUFDO0FBRUQseURBQXlEO0FBQ3pELElBQUksc0JBQXNCLENBQUE7QUFFMUI7Ozs7R0FJRztBQUNILFNBQVMsaUNBQWlDLENBQUMsT0FBTztJQUNoRCxPQUFPLE9BQU8sS0FBSyxJQUFJO1dBQ2xCLE9BQU8sT0FBTyxLQUFLLFFBQVE7V0FDM0IsT0FBTyxDQUFDLElBQUksS0FBSyw0QkFBNEIsQ0FBQTtBQUNwRCxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBUyw4QkFBOEI7SUFDckMsSUFBSSxzQkFBc0IsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJO1FBQUUsT0FBTTtJQUVuRCxzQkFBc0IsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFO1FBQ3hDLHFCQUFxQixFQUFFLENBQUE7SUFDekIsQ0FBQyxFQUFFLDhCQUE4QixDQUFDLENBQUE7SUFDbEMsc0JBQXNCLENBQUMsS0FBSyxFQUFFLENBQUE7QUFDaEMsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsNkJBQTZCO0lBQ3BDLElBQUksQ0FBQyxzQkFBc0I7UUFBRSxPQUFNO0lBRW5DLGFBQWEsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO0lBQ3JDLHNCQUFzQixHQUFHLFNBQVMsQ0FBQTtBQUNwQyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsWUFBWSxDQUFDLE9BQU87SUFDM0IsSUFBSSxDQUFDLE9BQU8sSUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRO1FBQUUsT0FBTyxLQUFLLENBQUE7SUFDekQsTUFBTSxNQUFNLEdBQUcsdUpBQXVKLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUVoTCxPQUFPLE1BQU0sQ0FBQyxJQUFJLEtBQUssS0FBSyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxJQUFJLE9BQU8sTUFBTSxDQUFDLE9BQU8sS0FBSyxRQUFRLElBQUksT0FBTyxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsS0FBSyxRQUFRLENBQUE7QUFDakksQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHdCQUF3QixDQUFDLE9BQU87SUFDdkMsSUFBSSxDQUFDLE9BQU8sSUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRO1FBQUUsT0FBTyxLQUFLLENBQUE7SUFDekQsTUFBTSxNQUFNLEdBQUcsNExBQTRMLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUVyTixPQUFPLE1BQU0sQ0FBQyxJQUFJLEtBQUssa0JBQWtCO1dBQ3BDLDJCQUEyQixDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUM7V0FDMUMsT0FBTyxNQUFNLENBQUMscUJBQXFCLEtBQUssUUFBUTtXQUNoRCxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxxQkFBcUIsQ0FBQztXQUM3QywyQkFBMkIsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7QUFDakQsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsU0FBUyxXQUFXLENBQUMsRUFBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUM7SUFDdkQsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO1FBQzdCLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDbEIsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBQ2xCLE9BQU07UUFDUixDQUFDO1FBRUQsT0FBTyxDQUFDLElBQUksQ0FBQztZQUNYLElBQUksRUFBRSxhQUFhO1lBQ25CLEtBQUs7WUFDTCxZQUFZO1lBQ1osTUFBTTtZQUNOLFFBQVEsRUFBRSxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsR0FBRztZQUNuQyxLQUFLLEVBQUUsS0FBSyxFQUFFLE9BQU87U0FDdEIsRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtJQUM5QixDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUM7QUFFRDs7Ozs7Ozs7OztHQVVHO0FBQ0gsS0FBSyxVQUFVLE1BQU0sQ0FBQyxPQUFPLEVBQUUsdUJBQXVCO0lBQ3BELElBQUksQ0FBQztRQUNILE1BQU0sTUFBTSxHQUFHLE1BQU0sb0NBQW9DLENBQUMsdUJBQXVCLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDNUYsT0FBTyxNQUFNLGNBQWMsQ0FBQyxHQUFHLENBQUMsdUJBQXVCLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ2xFLE9BQU8sTUFBTSxhQUFhLENBQUMsT0FBTyxFQUFFO29CQUNsQyxnQkFBZ0IsRUFBRSxLQUFLO29CQUN2QixrQkFBa0IsRUFBRSxLQUFLO29CQUN6QixjQUFjLEVBQUUsR0FBRyxFQUFFLENBQUMsbUJBQW1CLENBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7b0JBQzdFLFdBQVcsRUFBRSwrQkFBK0I7aUJBQzdDLENBQUMsQ0FBQTtZQUNKLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7UUFDRixNQUFNLFdBQVcsQ0FBQyxFQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsRUFBRSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtJQUNwRSxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLElBQUksS0FBSyxZQUFZLDZCQUE2QixFQUFFLENBQUM7WUFDbkQsTUFBTSxXQUFXLENBQUMsRUFBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLEVBQUUsRUFBRSxZQUFZLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO1FBQzlFLENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxXQUFXLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUM3RSxPQUFPLENBQUMsS0FBSyxDQUFDLHNFQUFzRSxFQUFFLFdBQVcsQ0FBQyxDQUFBO1lBQ2xHLE1BQU0sV0FBVyxDQUFDLEVBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxFQUFFLEVBQUUsWUFBWSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtRQUNqRixDQUFDO0lBQ0gsQ0FBQztZQUFTLENBQUM7UUFDVCxhQUFhLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNoQyxrQkFBa0IsRUFBRSxDQUFBO1FBRXBCLElBQUksYUFBYSxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUM3Qiw2QkFBNkIsRUFBRSxDQUFBO1FBQ2pDLENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGFBQWEsQ0FBQyxPQUFPO0lBQzVCLElBQUksd0JBQXdCLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUN0QyxLQUFLLGNBQWMsQ0FBQztZQUNsQixRQUFRLEVBQUUsT0FBTyxDQUFDLE1BQU0sS0FBSyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzVELE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtZQUN0QixxQkFBcUIsRUFBRSxPQUFPLENBQUMscUJBQXFCO1lBQ3BELE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtTQUN2QixDQUFDLENBQUE7UUFDRixPQUFNO0lBQ1IsQ0FBQztJQUVELElBQUksaUNBQWlDLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUMvQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3ZCLE9BQU07SUFDUixDQUFDO0lBRUQsSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsSUFBSSxhQUFhLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQUUsT0FBTTtJQUUzRSxhQUFhLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUE7SUFDckMsa0JBQWtCLEVBQUUsQ0FBQTtJQUNwQixtQkFBbUIsQ0FBQyxjQUFjLEVBQUUsT0FBTyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQTtJQUNoRSw4QkFBOEIsRUFBRSxDQUFBO0lBQ2hDLEtBQUssTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLHVCQUF1QixJQUFJLEVBQUMsUUFBUSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7QUFDcEYsQ0FBQztBQUVELE9BQU8sQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQTtBQUMxRCxPQUFPLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxHQUFHLEVBQUUsQ0FBQyxLQUFLLGNBQWMsQ0FBQyxFQUFDLFFBQVEsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLGdCQUFnQixFQUFDLENBQUMsQ0FBQyxDQUFBO0FBQzlGLE9BQU8sQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEdBQUcsRUFBRSxDQUFDLEtBQUssY0FBYyxDQUFDLEVBQUMsUUFBUSxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUMsQ0FBQTtBQUM5RyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxLQUFLLGNBQWMsQ0FBQyxFQUFDLFFBQVEsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLGVBQWUsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQyxDQUFBO0FBQzNHLElBQUksT0FBTyxDQUFDLElBQUk7SUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUMsZUFBZSxFQUFFLFFBQVEsRUFBRSxPQUFPLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0IHY4IGZyb20gXCJub2RlOnY4XCJcbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCBydW5Kb2JQYXlsb2FkLCB7IEJhY2tncm91bmRKb2JQZXJmb3JtZWRGYWlsdXJlIH0gZnJvbSBcIi4vam9iLXJ1bm5lci5qc1wiXG5pbXBvcnQgeyBib3VuZGVkUG9vbGVkUnVubmVySW5mbGlnaHRKb2JJZHMsIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiwgaXNQb29sZWRDaGlsZFNodXRkb3duU2lnbmFsIH0gZnJvbSBcIi4vcG9vbGVkLXJ1bm5lci1zaHV0ZG93bi5qc1wiXG5pbXBvcnQgeyBjbG9zZVJ1bm5lckNvbm5lY3Rpb25zLCBjbG9zZVJ1bm5lckZyYW1ld29ya0Nvbm5lY3Rpb25zLCBjdXJyZW50Q29uZmlndXJhdGlvbk9yTnVsbCB9IGZyb20gXCIuL3J1bm5lci1ncmFjZWZ1bC1zaHV0ZG93bi5qc1wiXG5pbXBvcnQgc2V0UnVubmVyUHJvY2Vzc1RpdGxlIGZyb20gXCIuL3J1bm5lci1wcm9jZXNzLXRpdGxlLmpzXCJcbmltcG9ydCBQb29sZWRSdW5uZXJCcm9rZXJJZGVudGl0eSBmcm9tIFwiLi9wb29sZWQtcnVubmVyLWJyb2tlci1pZGVudGl0eS5qc1wiXG5pbXBvcnQgeyBydW5XaXRoU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcgfSBmcm9tIFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCJcblxuY29uc3QgQkFTRV9QUk9DRVNTX1RJVExFID0gXCJ2ZWxvY2lvdXMgYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwiXG4vKiogQSBzaHV0ZG93biBvYnNlcnZhdGlvbiBtYXkgZGVsYXkgcmVzb3VyY2UgdGVhcmRvd24gb25seSBmb3IgdGhpcyBib3VuZGVkIElQQyBzZW5kLiAqL1xuY29uc3QgU0hVVERPV05fT0JTRVJWQVRJT05fU0VORF9USU1FT1VUX01TID0gMTAwXG4vKiogU3RhYmxlIGlkZW50aXR5IG9mIHRoaXMgcG9vbGVkIGNoaWxkIHByb2Nlc3MgZm9yIHRoZSBsaWZlIG9mIHRoZSBwcm9jZXNzLiAqL1xuY29uc3QgY2hpbGRJbnN0YW5jZUlkID0gcmFuZG9tVVVJRCgpXG4vKiogU2FtcGxpbmcgY2FkZW5jZSBmb3IgdGhlIG1lbW9yeSBvYnNlcnZhdGlvbiBzYW1wbGVyLiAqL1xuY29uc3QgTUVNT1JZX09CU0VSVkFUSU9OX0lOVEVSVkFMX01TID0gMTAwMDBcbi8qKiBCb3VuZCBvbiBpbi1mbGlnaHQgam9iIGlkcyBjYXJyaWVkIGluIGEgbWVtb3J5IG9ic2VydmF0aW9uLiAqL1xuY29uc3QgTUVNT1JZX09CU0VSVkFUSU9OX0pPQl9JRF9MSU1JVCA9IDMyXG5cbnNldFJ1bm5lclByb2Nlc3NUaXRsZSgpXG5cbi8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbmxldCBzaHV0ZG93blByb21pc2VcblxuLyoqXG4gKiBDbG9zZXMgdGhlIHJ1bm5lcidzIGNvbm5lY3Rpb25zIOKAlCByZWxlYXNpbmcgYW55IGFkdmlzb3J5IGxvY2sgYSBraWxsZWQtbWlkLXBhc3NcbiAqIGpvYiBzdGlsbCBob2xkcyDigJQgYmVmb3JlIGV4aXRpbmcsIGluc3RlYWQgb2YgbGVhdmluZyBhIGhhbGYtb3BlbiBzZXNzaW9uIHRoYXRcbiAqIGtlZXBzIHRoZSBsb2NrIHVudGlsIHRoZSBEQiBzZXJ2ZXIncyBgd2FpdF90aW1lb3V0YC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2h1dGRvd24gb2JzZXJ2YXRpb24uXG4gKiBAcGFyYW0ge251bWJlcn0gYXJncy5leGl0Q29kZSAtIFByb2Nlc3MgZXhpdCBjb2RlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IGFyZ3MucmVhc29uIC0gRXhhY3Qgc2h1dGRvd24gcmVhc29uIG9ic2VydmVkIGJ5IHRoZSBjaGlsZC5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3Muc2h1dGRvd25SZXF1ZXN0ZWRBdE1zXSAtIFBhcmVudCByZXF1ZXN0IHRpbWVzdGFtcCB3aGVuIHN1cHBsaWVkIG92ZXIgSVBDLlxuICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gW2FyZ3Muc2lnbmFsXSAtIFJlcXVlc3RlZCBvciBvYnNlcnZlZCBzaWduYWwuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuZnVuY3Rpb24gc2h1dGRvd25SdW5uZXIoe2V4aXRDb2RlLCByZWFzb24sIHNodXRkb3duUmVxdWVzdGVkQXRNcyA9IG51bGwsIHNpZ25hbCA9IG51bGx9KSB7XG4gIGlmIChzaHV0ZG93blByb21pc2UpIHJldHVybiBzaHV0ZG93blByb21pc2VcblxuICBzaHV0ZG93blByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHNlbmRTaHV0ZG93bk9ic2VydmF0aW9uKHtyZWFzb24sIHNodXRkb3duUmVxdWVzdGVkQXRNcywgc2lnbmFsfSlcbiAgICBhd2FpdCBjbG9zZVJ1bm5lckNvbm5lY3Rpb25zKGN1cnJlbnRDb25maWd1cmF0aW9uT3JOdWxsKCkpXG4gICAgcHJvY2Vzcy5leGl0KGV4aXRDb2RlKVxuICB9KSgpXG5cbiAgcmV0dXJuIHNodXRkb3duUHJvbWlzZVxufVxuXG4vKipcbiAqIElkcyBvZiBqb2JzIGN1cnJlbnRseSBydW5uaW5nIGluIHRoaXMgY2hpbGQuIEEgcG9vbGVkIGNoaWxkIHJ1bnMgdXAgdG9cbiAqIGBwb29sZWRSdW5uZXJDb25jdXJyZW5jeWAgam9icyBhdCBvbmNlICh0aGUgd29ya2VyIG9ubHkgZGlzcGF0Y2hlcyB3aXRoaW4gdGhhdFxuICogYm91bmQpOyB0aGUgc2V0IGRlZHVwZXMgYSByZWRlbGl2ZXJlZCBqb2IgaWQgYW5kIGxldHMgZWFjaCBqb2Igc2V0dGxlXG4gKiBpbmRlcGVuZGVudGx5LlxuICogQHR5cGUge1NldDxzdHJpbmc+fVxuICovXG5jb25zdCBydW5uaW5nSm9iSWRzID0gbmV3IFNldCgpXG5jb25zdCBicm9rZXJJZGVudGl0eSA9IG5ldyBQb29sZWRSdW5uZXJCcm9rZXJJZGVudGl0eSh7XG4gIGNsb3NlQ29ubmVjdGlvbnM6IGFzeW5jICgpID0+IGF3YWl0IGNsb3NlUnVubmVyRnJhbWV3b3JrQ29ubmVjdGlvbnMoY3VycmVudENvbmZpZ3VyYXRpb25Pck51bGwoKSlcbn0pXG5cbi8qKlxuICogU2V0cyBhbiBhZ2dyZWdhdGUgcHJvY2VzcyB0aXRsZSBmcm9tIHRoZSBjdXJyZW50IGluLWZsaWdodCBjb3VudC4gQSBjaGlsZCBydW5zXG4gKiBqb2JzIGNvbmN1cnJlbnRseSwgc28gYSBwZXItam9iIHRpdGxlICh3aGljaCBgcnVuSm9iUGF5bG9hZGAgd291bGQgc25hcHNob3QgYW5kXG4gKiByZXN0b3JlIGFyb3VuZCBhIHNpbmdsZSBqb2IpIGNhbm5vdCByZXByZXNlbnQgdGhlIHByb2Nlc3Mg4oCUIGludGVybGVhdmVkXG4gKiBjb21wbGV0aW9ucyB3b3VsZCBsZWF2ZSBhIHN0YWxlIGxhYmVsLiBSZWNvbXB1dGluZyBmcm9tIGBydW5uaW5nSm9iSWRzLnNpemVgIGlzXG4gKiBjb25jdXJyZW5jeS1zYWZlIGFuZCBob25lc3Q6IGBwc2AvYHRvcGAgc2hvdyBob3cgbWFueSBqb2JzIHRoZSBjaGlsZCBpcyBydW5uaW5nLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHVwZGF0ZVByb2Nlc3NUaXRsZSgpIHtcbiAgY29uc3QgY291bnQgPSBydW5uaW5nSm9iSWRzLnNpemVcblxuICBwcm9jZXNzLnRpdGxlID0gY291bnQgPiAwID8gYCR7QkFTRV9QUk9DRVNTX1RJVExFfTogJHtjb3VudH0gJHtjb3VudCA9PT0gMSA/IFwiam9iXCIgOiBcImpvYnNcIn1gIDogQkFTRV9QUk9DRVNTX1RJVExFXG59XG5cbi8qKlxuICogU2VuZHMgb25lIGJvdW5kZWQgbGlmZWN5Y2xlIG9ic2VydmF0aW9uIGJlZm9yZSBhcHBsaWNhdGlvbi9mcmFtZXdvcmsgdGVhcmRvd24uXG4gKiBBIGNsb3NlZCBJUEMgY2hhbm5lbCBpcyBleHBlY3RlZCBmb3IgYGlwY19kaXNjb25uZWN0YDsgb3RoZXIgc2VuZCBmYWlsdXJlcyBhcmVcbiAqIHN1cmZhY2VkIG9uIHN0ZGVyciBidXQgbmV2ZXIgaG9sZCBjb25uZWN0aW9uIGNsZWFudXAgcGFzdCB0aGUgZml4ZWQgYm91bmQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNodXRkb3duIG9ic2VydmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IGFyZ3MucmVhc29uIC0gU2h1dGRvd24gcmVhc29uLlxuICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLnNodXRkb3duUmVxdWVzdGVkQXRNcyAtIFBhcmVudCByZXF1ZXN0IHRpbWVzdGFtcC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IGFyZ3Muc2lnbmFsIC0gUmVxdWVzdGVkIG9yIG9ic2VydmVkIHNpZ25hbC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIElQQyBhY2NlcHRzIHRoZSBvYnNlcnZhdGlvbiBvciB0aGUgYm91bmQgZXhwaXJlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gc2VuZFNodXRkb3duT2JzZXJ2YXRpb24oe3JlYXNvbiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zLCBzaWduYWx9KSB7XG4gIGlmICghcHJvY2Vzcy5zZW5kIHx8ICFwcm9jZXNzLmNvbm5lY3RlZCkgcmV0dXJuXG5cbiAgY29uc3QgYm91bmRlZEluZmxpZ2h0ID0gYm91bmRlZFBvb2xlZFJ1bm5lckluZmxpZ2h0Sm9iSWRzKHJ1bm5pbmdKb2JJZHMpXG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duT2JzZXJ2YXRpb24gJiB7dHlwZTogXCJzaHV0ZG93bi1vYnNlcnZhdGlvblwifX0gKi9cbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBjaGlsZEluc3RhbmNlSWQsXG4gICAgLi4uYm91bmRlZEluZmxpZ2h0LFxuICAgIHJlYXNvbixcbiAgICBzaHV0ZG93bk9ic2VydmVkQXRNczogRGF0ZS5ub3coKSxcbiAgICBzaHV0ZG93blJlcXVlc3RlZEF0TXMsXG4gICAgc2lnbmFsLFxuICAgIHR5cGU6IFwic2h1dGRvd24tb2JzZXJ2YXRpb25cIlxuICB9XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCB0aW1lb3V0KHt0aW1lb3V0OiBTSFVURE9XTl9PQlNFUlZBVElPTl9TRU5EX1RJTUVPVVRfTVN9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcHJvY2Vzcy5zZW5kPy4obWVzc2FnZSwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiUG9vbGVkIGJhY2tncm91bmQgam9iIHJ1bm5lciBjb3VsZCBub3Qgc2VuZCBpdHMgc2h1dGRvd24gb2JzZXJ2YXRpb246XCIsIGVycm9yKVxuICB9XG59XG5cbi8qKlxuICogUmVwb3J0cyBvbmUgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiAoam9iIHJlY2VpdmVkIC8gcGVyZm9ybSBzdGFydGVkKSB0byB0aGVcbiAqIHdvcmtlciBvdmVyIElQQy4gVGhlIG1lc3NhZ2UgY2FycmllcyB0aGUgam9iJ3MgZXhhY3QgaGFuZG9mZiBsZWFzZSBzbyB0aGVcbiAqIHdvcmtlciBjYW4gcGVyc2lzdCBpdCBmZW5jZWQgd2l0aG91dCBhbnkgb3RoZXIgbG9va3VwLiBTZW5kIGZhaWx1cmVzIGFyZVxuICogc3dhbGxvd2VkOiBhIGRlYWQgSVBDIGNoYW5uZWwgaXMgdGVybWluYWwgZm9yIHRoaXMgY2hpbGQgKHRoZSBkaXNjb25uZWN0XG4gKiBoYW5kbGVyIG93bnMgc2h1dGRvd24pLCBhbmQgbG9zaW5nIGFjY2VwdGFuY2UgZXZpZGVuY2UgbXVzdCBuZXZlciBmYWlsIHRoZVxuICogam9iIGl0c2VsZi5cbiAqIEBwYXJhbSB7XCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIn0gdHlwZSAtIE9ic2VydmF0aW9uIGtpbmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBKb2IgcGF5bG9hZCBjYXJyeWluZyB0aGUgaGFuZG9mZiBsZWFzZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBvYnNlcnZlZEF0TXMgLSBFcG9jaCBtcyBvZiB0aGUgb2JzZXJ2YXRpb24uXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gc2VuZENoaWxkQWNjZXB0YW5jZSh0eXBlLCBwYXlsb2FkLCBvYnNlcnZlZEF0TXMpIHtcbiAgaWYgKCFwcm9jZXNzLnNlbmQpIHJldHVyblxuXG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgY2hpbGRJbnN0YW5jZUlkLFxuICAgIGNoaWxkUGlkOiBwcm9jZXNzLnBpZCxcbiAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICB0eXBlLFxuICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkLFxuICAgIC4uLih0eXBlID09PSBcImpvYi1yZWNlaXZlZFwiID8ge3JlY2VpdmVkQXRNczogb2JzZXJ2ZWRBdE1zfSA6IHtzdGFydGVkQXRNczogb2JzZXJ2ZWRBdE1zfSlcbiAgfVxuXG4gIHRyeSB7XG4gICAgcHJvY2Vzcy5zZW5kKG1lc3NhZ2UpXG4gIH0gY2F0Y2gge1xuICAgIC8vIFRoZSBJUEMgY2hhbm5lbCBpcyBhbHJlYWR5IGdvbmU7IHRoZSBkaXNjb25uZWN0IGhhbmRsZXIgb3ducyBzaHV0ZG93bi5cbiAgfVxufVxuXG4vKipcbiAqIENvbGxlY3RzIGEgYm91bmRlZCBkaWFnbm9zdGljIHNuYXBzaG90IG9mIHRoaXMgY2hpbGQncyBtZW1vcnkgc3RhdGUuIFRoZVxuICogcG9vbGVkIGNoaWxkJ3Mgc3RkaW8gaXMgaWdub3JlZCBieSB0aGUgd29ya2VyIGZvcmssIHNvIElQQyBpcyB0aGUgb25seSBjaGFubmVsXG4gKiB0byB0aGUgd29ya2VyJ3MgbG9nIHN1cmZhY2Ug4oCUIHRoaXMgc25hcHNob3QgKHNlbnQgcGVyaW9kaWNhbGx5IGFuZCBvbiBkZW1hbmQpXG4gKiBpcyBob3cgYSBtZW1vcnkgcHJvYmxlbSBuYW1lcyBpdHNlbGYgaW4gcHJvZHVjdGlvbi4gVGhlIFY4IGhlYXAtc3RhdFxuICogYnJlYWtkb3duIChub3QgYSBmdWxsIGhlYXAgc25hcHNob3QsIHdoaWNoIHdvdWxkIGJlIGZhciB0b28gZXhwZW5zaXZlIHdoaWxlIGFcbiAqIGNoaWxkIHJ1bnMgMjUgY29uY3VycmVudCBqb2JzKSBkaXN0aW5ndWlzaGVzIGEgVjggaGVhcC1ncm93dGggbGVhayBmcm9tXG4gKiBleHRlcm5hbC9hcnJheS1idWZmZXIgKG5hdGl2ZSByZXNvdXJjZSkgZ3Jvd3RoLCBhbmQgdGhlIGluLWZsaWdodCBqb2IgaWRzXG4gKiB0aWUgdGhlIG9ic2VydmF0aW9uIHRvIHRoZSB3b3JrIHRoYXQgd2FzIHJ1bm5pbmcuXG4gKiBAcmV0dXJucyB7e2FjdGl2ZUpvYklkczogc3RyaW5nW10sIGFjdGl2ZUpvYklkc1RydW5jYXRlZENvdW50OiBudW1iZXIsIGNoaWxkSW5zdGFuY2VJZDogc3RyaW5nLCBjaGlsZFBpZDogbnVtYmVyLCBjaGlsZFVwdGltZU1zOiBudW1iZXIsIGhlYXBTdGF0aXN0aWNzOiBSZXR1cm5UeXBlPHR5cGVvZiB2OC5nZXRIZWFwU3RhdGlzdGljcz4sIGpvYkNvdW50OiBudW1iZXIsIG1lbW9yeVVzYWdlOiBSZXR1cm5UeXBlPHR5cGVvZiBwcm9jZXNzLm1lbW9yeVVzYWdlPiwgb2JzZXJ2ZWRBdE1zOiBudW1iZXIsIHJzc0J5dGVzOiBudW1iZXIsIHR5cGU6IFwicG9vbGVkLWNoaWxkLW1lbW9yeVwiLCB1cHRpbWVNczogbnVtYmVyfX0gLSBCb3VuZGVkIG1lbW9yeSBvYnNlcnZhdGlvbiBmb3IgdGhpcyBjaGlsZC5cbiAqL1xuZnVuY3Rpb24gY29sbGVjdE1lbW9yeU9ic2VydmF0aW9uKCkge1xuICBjb25zdCBqb2JJZHMgPSBbLi4ucnVubmluZ0pvYklkc11cbiAgY29uc3QgYWN0aXZlSm9iSWRzID0gam9iSWRzLnNsaWNlKDAsIE1FTU9SWV9PQlNFUlZBVElPTl9KT0JfSURfTElNSVQpXG4gIGNvbnN0IG1lbW9yeVVzYWdlID0gcHJvY2Vzcy5tZW1vcnlVc2FnZSgpXG5cbiAgcmV0dXJuIHtcbiAgICBhY3RpdmVKb2JJZHMsXG4gICAgYWN0aXZlSm9iSWRzVHJ1bmNhdGVkQ291bnQ6IE1hdGgubWF4KDAsIGpvYklkcy5sZW5ndGggLSBhY3RpdmVKb2JJZHMubGVuZ3RoKSxcbiAgICBjaGlsZEluc3RhbmNlSWQsXG4gICAgY2hpbGRQaWQ6IHByb2Nlc3MucGlkLFxuICAgIGNoaWxkVXB0aW1lTXM6IE1hdGguZmxvb3IocHJvY2Vzcy51cHRpbWUoKSAqIDEwMDApLFxuICAgIGhlYXBTdGF0aXN0aWNzOiB2OC5nZXRIZWFwU3RhdGlzdGljcygpLFxuICAgIGpvYkNvdW50OiBqb2JJZHMubGVuZ3RoLFxuICAgIG1lbW9yeVVzYWdlLFxuICAgIG9ic2VydmVkQXRNczogRGF0ZS5ub3coKSxcbiAgICByc3NCeXRlczogbWVtb3J5VXNhZ2UucnNzLFxuICAgIHR5cGU6IFwicG9vbGVkLWNoaWxkLW1lbW9yeVwiLFxuICAgIHVwdGltZU1zOiBNYXRoLmZsb29yKHByb2Nlc3MudXB0aW1lKCkgKiAxMDAwKVxuICB9XG59XG5cbi8qKlxuICogU2VuZHMgYSBtZW1vcnkgb2JzZXJ2YXRpb24gdG8gdGhlIHdvcmtlci4gU2FtcGxpbmcgaXMgY2hlYXAgKHByb2Nlc3MgKyBWOFxuICogaGVhcCBzdGF0cykgYW5kIG9ubHkgcnVucyB3aGlsZSBqb2JzIGFyZSBpbiBmbGlnaHQ7IGEgY2xvc2VkIElQQyBjaGFubmVsIGlzXG4gKiB0ZXJtaW5hbCBmb3IgdGhpcyBjaGlsZCAodGhlIGRpc2Nvbm5lY3QgaGFuZGxlciBvd25zIHNodXRkb3duKSwgc28gYSBmYWlsZWRcbiAqIHNlbmQgaXMgc3dhbGxvd2VkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHNlbmRNZW1vcnlPYnNlcnZhdGlvbigpIHtcbiAgaWYgKCFwcm9jZXNzLnNlbmQgfHwgcnVubmluZ0pvYklkcy5zaXplID09PSAwKSByZXR1cm5cblxuICB0cnkge1xuICAgIHByb2Nlc3Muc2VuZChjb2xsZWN0TWVtb3J5T2JzZXJ2YXRpb24oKSlcbiAgfSBjYXRjaCB7XG4gICAgLy8gVGhlIElQQyBjaGFubmVsIGlzIGFscmVhZHkgZ29uZTsgdGhlIGRpc2Nvbm5lY3QgaGFuZGxlciBvd25zIHNodXRkb3duLlxuICB9XG59XG5cbi8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xubGV0IG1lbW9yeU9ic2VydmF0aW9uVGltZXJcblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgcmVxdWVzdHMgdGhpcyBjaGlsZCB0byBzZW5kIGEgbWVtb3J5IG9ic2VydmF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwibWVtb3J5LW9ic2VydmF0aW9uLXJlcXVlc3RcIn19IC0gV2hldGhlciB0aGUgbWVzc2FnZSByZXF1ZXN0cyBvbmUuXG4gKi9cbmZ1bmN0aW9uIGlzTWVtb3J5T2JzZXJ2YXRpb25SZXF1ZXN0TWVzc2FnZShtZXNzYWdlKSB7XG4gIHJldHVybiBtZXNzYWdlICE9PSBudWxsXG4gICAgJiYgdHlwZW9mIG1lc3NhZ2UgPT09IFwib2JqZWN0XCJcbiAgICAmJiBtZXNzYWdlLnR5cGUgPT09IFwibWVtb3J5LW9ic2VydmF0aW9uLXJlcXVlc3RcIlxufVxuXG4vKipcbiAqIFN0YXJ0cyB0aGUgcGVyaW9kaWMgbWVtb3J5IG9ic2VydmF0aW9uIHNhbXBsZXIgaWYgaXQgaXMgbm90IGFscmVhZHkgcnVubmluZy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBzdGFydE1lbW9yeU9ic2VydmF0aW9uU2FtcGxpbmcoKSB7XG4gIGlmIChtZW1vcnlPYnNlcnZhdGlvblRpbWVyIHx8ICFwcm9jZXNzLnNlbmQpIHJldHVyblxuXG4gIG1lbW9yeU9ic2VydmF0aW9uVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgc2VuZE1lbW9yeU9ic2VydmF0aW9uKClcbiAgfSwgTUVNT1JZX09CU0VSVkFUSU9OX0lOVEVSVkFMX01TKVxuICBtZW1vcnlPYnNlcnZhdGlvblRpbWVyLnVucmVmKClcbn1cblxuLyoqXG4gKiBTdG9wcyB0aGUgcGVyaW9kaWMgbWVtb3J5IG9ic2VydmF0aW9uIHNhbXBsZXIuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gc3RvcE1lbW9yeU9ic2VydmF0aW9uU2FtcGxpbmcoKSB7XG4gIGlmICghbWVtb3J5T2JzZXJ2YXRpb25UaW1lcikgcmV0dXJuXG5cbiAgY2xlYXJJbnRlcnZhbChtZW1vcnlPYnNlcnZhdGlvblRpbWVyKVxuICBtZW1vcnlPYnNlcnZhdGlvblRpbWVyID0gdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcnVubmFibGUgcG9vbGVkIGpvYiBtZXNzYWdlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwiam9iXCIsIHBheWxvYWQ6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30sIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyPzogaW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfX0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBqb2IgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gaXNKb2JNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHt7dHlwZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwYXlsb2FkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwiam9iXCIgJiYgISFyZWNvcmQucGF5bG9hZCAmJiB0eXBlb2YgcmVjb3JkLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHJlY29yZC5wYXlsb2FkLmlkID09PSBcInN0cmluZ1wiXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIHJlcXVlc3RzIGEgdHlwZWQgcG9vbGVkLWNoaWxkIHNodXRkb3duLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwic2h1dGRvd24tcmVxdWVzdFwiLCByZWFzb246IGltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zOiBudW1iZXIsIHNpZ25hbDogaW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIHBhcmVudCBzaHV0ZG93biByZXF1ZXN0LlxuICovXG5mdW5jdGlvbiBpc1NodXRkb3duUmVxdWVzdE1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3t0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlYXNvbj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaHV0ZG93blJlcXVlc3RlZEF0TXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2lnbmFsPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwic2h1dGRvd24tcmVxdWVzdFwiXG4gICAgJiYgaXNQb29sZWRDaGlsZFNodXRkb3duUmVhc29uKHJlY29yZC5yZWFzb24pXG4gICAgJiYgdHlwZW9mIHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcylcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25TaWduYWwocmVjb3JkLnNpZ25hbClcbn1cblxuLyoqXG4gKiBTZW5kcyB0aGUgdGVybWluYWwgb3V0Y29tZSBhZnRlciB0aGUgbWFpbi9EQiByZXBvcnQgaGFzIGJlZW4gYWNrbm93bGVkZ2VkIG9yIHJlamVjdGVkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPdXRjb21lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWNrbm93bGVkZ2VkIC0gV2hldGhlciB0aGUgdGVybWluYWwgcmVwb3J0IHdhcyBhY2tub3dsZWRnZWQuXG4gKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBbYXJncy5zdGF0dXNdIC0gQWNrbm93bGVkZ2VkIG91dGNvbWUuXG4gKiBAcGFyYW0ge0Vycm9yfSBbYXJncy5lcnJvcl0gLSBSZXBvcnRpbmcgZXJyb3Igd2hlbiBhY2tub3dsZWRnZW1lbnQgd2FzIG5vdCBvYnRhaW5lZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIElQQyBhY2NlcHRzIHRoZSBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBzZW5kT3V0Y29tZSh7am9iSWQsIGFja25vd2xlZGdlZCwgc3RhdHVzLCBlcnJvcn0pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgaWYgKCFwcm9jZXNzLnNlbmQpIHtcbiAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgcHJvY2Vzcy5zZW5kKHtcbiAgICAgIHR5cGU6IFwiam9iLW91dGNvbWVcIixcbiAgICAgIGpvYklkLFxuICAgICAgYWNrbm93bGVkZ2VkLFxuICAgICAgc3RhdHVzLFxuICAgICAgcnNzQnl0ZXM6IHByb2Nlc3MubWVtb3J5VXNhZ2UoKS5yc3MsXG4gICAgICBlcnJvcjogZXJyb3I/Lm1lc3NhZ2VcbiAgICB9LCAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpXG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBvbmUgam9iIGNvbmN1cnJlbnRseSB3aXRoIGFueSBzaWJsaW5ncyBhbmQgcmVwb3J0cyBpdHMgb3duIHRlcm1pbmFsXG4gKiBvdXRjb21lLiBBIHNpbmdsZSBqb2IncyB1bmV4cGVjdGVkIGZhaWx1cmUgcmVwb3J0cyB0aGF0IGpvYiBmb3IgcmVjbGFtYXRpb25cbiAqIChgYWNrbm93bGVkZ2VkOiBmYWxzZWApIGJ1dCBkb2VzIE5PVCB0YWtlIGRvd24gdGhlIGNoaWxkIOKAlCBpdHMgY29uY3VycmVudFxuICogc2libGluZ3Mga2VlcCBydW5uaW5nLiBPbmx5IGEgcHJvY2Vzcy1sZXZlbCBmYXVsdCAod2hpY2ggZXNjYXBlcyBldmVyeVxuICogcGVyLWpvYiB0cnkvY2F0Y2gpIGVuZHMgdGhlIGNoaWxkLCB3aGljaCB0aGUgd29ya2VyIHNlZXMgYXMgYW4gZXhpdCBhbmRcbiAqIHJlY2xhaW1zIGZvciB0aGUgd2hvbGUgaW4tZmxpZ2h0IHNldC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIEpvYiBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyIC0gUGVyLWpvYiBicm9rZXIgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlcG9ydGluZy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcnVuSm9iKHBheWxvYWQsIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKSB7XG4gIHRyeSB7XG4gICAgY29uc3Qgc3RhdHVzID0gYXdhaXQgcnVuV2l0aFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgYnJva2VySWRlbnRpdHkucnVuKHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCBydW5Kb2JQYXlsb2FkKHBheWxvYWQsIHtcbiAgICAgICAgICBjbG9zZUNvbm5lY3Rpb25zOiBmYWxzZSxcbiAgICAgICAgICBtYW5hZ2VQcm9jZXNzVGl0bGU6IGZhbHNlLFxuICAgICAgICAgIG9uUGVyZm9ybVN0YXJ0OiAoKSA9PiBzZW5kQ2hpbGRBY2NlcHRhbmNlKFwiam9iLXN0YXJ0ZWRcIiwgcGF5bG9hZCwgRGF0ZS5ub3coKSksXG4gICAgICAgICAgcHJvY2Vzc1R5cGU6IFwiYmFja2dyb3VuZC1qb2JzLXBvb2xlZC1ydW5uZXJcIlxuICAgICAgICB9KVxuICAgICAgfSlcbiAgICB9KVxuICAgIGF3YWl0IHNlbmRPdXRjb21lKHtqb2JJZDogcGF5bG9hZC5pZCwgYWNrbm93bGVkZ2VkOiB0cnVlLCBzdGF0dXN9KVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JQZXJmb3JtZWRGYWlsdXJlKSB7XG4gICAgICBhd2FpdCBzZW5kT3V0Y29tZSh7am9iSWQ6IHBheWxvYWQuaWQsIGFja25vd2xlZGdlZDogdHJ1ZSwgc3RhdHVzOiBcImZhaWxlZFwifSlcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcmVwb3J0RXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJQb29sZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIGZhaWxlZCBiZWZvcmUgdGVybWluYWwgYWNrbm93bGVkZ2VtZW50OlwiLCByZXBvcnRFcnJvcilcbiAgICAgIGF3YWl0IHNlbmRPdXRjb21lKHtqb2JJZDogcGF5bG9hZC5pZCwgYWNrbm93bGVkZ2VkOiBmYWxzZSwgZXJyb3I6IHJlcG9ydEVycm9yfSlcbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgcnVubmluZ0pvYklkcy5kZWxldGUocGF5bG9hZC5pZClcbiAgICB1cGRhdGVQcm9jZXNzVGl0bGUoKVxuXG4gICAgaWYgKHJ1bm5pbmdKb2JJZHMuc2l6ZSA9PT0gMCkge1xuICAgICAgc3RvcE1lbW9yeU9ic2VydmF0aW9uU2FtcGxpbmcoKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEhhbmRsZXMgYSBqb2IgbWVzc2FnZSwgc3RhcnRpbmcgaXQgYWxvbmdzaWRlIGFueSBjb25jdXJyZW50IHNpYmxpbmdzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGhhbmRsZU1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoaXNTaHV0ZG93blJlcXVlc3RNZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgdm9pZCBzaHV0ZG93blJ1bm5lcih7XG4gICAgICBleGl0Q29kZTogbWVzc2FnZS5yZWFzb24gPT09IFwicGFyZW50X3JldGlyZV9kcmFpbmVkXCIgPyAwIDogMSxcbiAgICAgIHJlYXNvbjogbWVzc2FnZS5yZWFzb24sXG4gICAgICBzaHV0ZG93blJlcXVlc3RlZEF0TXM6IG1lc3NhZ2Uuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zLFxuICAgICAgc2lnbmFsOiBtZXNzYWdlLnNpZ25hbFxuICAgIH0pXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoaXNNZW1vcnlPYnNlcnZhdGlvblJlcXVlc3RNZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgc2VuZE1lbW9yeU9ic2VydmF0aW9uKClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICghaXNKb2JNZXNzYWdlKG1lc3NhZ2UpIHx8IHJ1bm5pbmdKb2JJZHMuaGFzKG1lc3NhZ2UucGF5bG9hZC5pZCkpIHJldHVyblxuXG4gIHJ1bm5pbmdKb2JJZHMuYWRkKG1lc3NhZ2UucGF5bG9hZC5pZClcbiAgdXBkYXRlUHJvY2Vzc1RpdGxlKClcbiAgc2VuZENoaWxkQWNjZXB0YW5jZShcImpvYi1yZWNlaXZlZFwiLCBtZXNzYWdlLnBheWxvYWQsIERhdGUubm93KCkpXG4gIHN0YXJ0TWVtb3J5T2JzZXJ2YXRpb25TYW1wbGluZygpXG4gIHZvaWQgcnVuSm9iKG1lc3NhZ2UucGF5bG9hZCwgbWVzc2FnZS5zaGFyZWRUcmFuc2FjdGlvbkJyb2tlciB8fCB7ZXhwZWN0ZWQ6IGZhbHNlfSlcbn1cblxucHJvY2Vzcy5vbihcIm1lc3NhZ2VcIiwgKG1lc3NhZ2UpID0+IGhhbmRsZU1lc3NhZ2UobWVzc2FnZSkpXG5wcm9jZXNzLm9uY2UoXCJkaXNjb25uZWN0XCIsICgpID0+IHZvaWQgc2h1dGRvd25SdW5uZXIoe2V4aXRDb2RlOiAwLCByZWFzb246IFwiaXBjX2Rpc2Nvbm5lY3RcIn0pKVxucHJvY2Vzcy5vbmNlKFwiU0lHVEVSTVwiLCAoKSA9PiB2b2lkIHNodXRkb3duUnVubmVyKHtleGl0Q29kZTogMSwgcmVhc29uOiBcInNpZ25hbF9zaWd0ZXJtXCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KSlcbnByb2Nlc3Mub25jZShcIlNJR0lOVFwiLCAoKSA9PiB2b2lkIHNodXRkb3duUnVubmVyKHtleGl0Q29kZTogMSwgcmVhc29uOiBcInNpZ25hbF9zaWdpbnRcIiwgc2lnbmFsOiBcIlNJR0lOVFwifSkpXG5pZiAocHJvY2Vzcy5zZW5kKSBwcm9jZXNzLnNlbmQoe2NoaWxkSW5zdGFuY2VJZCwgY2hpbGRQaWQ6IHByb2Nlc3MucGlkLCB0eXBlOiBcInJlYWR5XCJ9KVxuIl19