// @ts-check
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
/**
 * Reads this process's peak resident set size (the kernel high-water mark,
 * `VmHWM` in `/proc/self/status`). Unlike a point-in-time RSS sample, this is
 * monotonic for the life of the process: once a burst ratchets the working set
 * up, `VmHWM` remembers it even after garbage collection returns the pages.
 * That makes it the honest signal for recycling a pooled child — a child that
 * spiked to several gigabytes during a build burst keeps its ratcheted floor
 * and must be replaced, even though its settled RSS at job-outcome time looks
 * modest. A read failure (no `/proc`) degrades to the current RSS sample so the
 * observation is never blocked on it.
 * @returns {number} Peak RSS in bytes, or the current RSS sample when unreadable.
 */
function readPeakRssBytes() {
    const fallbackBytes = process.memoryUsage().rss;
    try {
        const status = readFileSync("/proc/self/status", "utf8");
        const match = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status);
        if (!match)
            return fallbackBytes;
        const kibibytes = Number(match[1]);
        return Number.isFinite(kibibytes) && kibibytes > 0 ? kibibytes * 1024 : fallbackBytes;
    }
    catch {
        return fallbackBytes;
    }
}
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
 * @returns {{activeJobIds: string[], activeJobIdsTruncatedCount: number, childInstanceId: string, childPid: number, childUptimeMs: number, heapStatistics: ReturnType<typeof v8.getHeapStatistics>, jobCount: number, memoryUsage: ReturnType<typeof process.memoryUsage>, observedAtMs: number, peakRssBytes: number, rssBytes: number, type: "pooled-child-memory", uptimeMs: number}} - Bounded memory observation for this child.
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
        peakRssBytes: readPeakRssBytes(),
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
            peakRssBytes: readPeakRssBytes(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9vbGVkLXJ1bm5lci1jaGlsZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvcG9vbGVkLXJ1bm5lci1jaGlsZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUN4QyxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3RDLE9BQU8sRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUN4QixPQUFPLE9BQU8sTUFBTSwyQkFBMkIsQ0FBQTtBQUMvQyxPQUFPLGFBQWEsRUFBRSxFQUFFLDZCQUE2QixFQUFFLE1BQU0saUJBQWlCLENBQUE7QUFDOUUsT0FBTyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFDekksT0FBTyxFQUFFLHNCQUFzQixFQUFFLCtCQUErQixFQUFFLDBCQUEwQixFQUFFLE1BQU0sK0JBQStCLENBQUE7QUFDbkksT0FBTyxxQkFBcUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLG9DQUFvQyxDQUFBO0FBQzNFLE9BQU8sRUFBRSxvQ0FBb0MsRUFBRSxNQUFNLCtDQUErQyxDQUFBO0FBRXBHLE1BQU0sa0JBQWtCLEdBQUcsa0NBQWtDLENBQUE7QUFDN0QseUZBQXlGO0FBQ3pGLE1BQU0sb0NBQW9DLEdBQUcsR0FBRyxDQUFBO0FBQ2hELGdGQUFnRjtBQUNoRixNQUFNLGVBQWUsR0FBRyxVQUFVLEVBQUUsQ0FBQTtBQUNwQywyREFBMkQ7QUFDM0QsTUFBTSw4QkFBOEIsR0FBRyxLQUFLLENBQUE7QUFDNUMsa0VBQWtFO0FBQ2xFLE1BQU0sK0JBQStCLEdBQUcsRUFBRSxDQUFBO0FBRTFDOzs7Ozs7Ozs7OztHQVdHO0FBQ0gsU0FBUyxnQkFBZ0I7SUFDdkIsTUFBTSxhQUFhLEdBQUcsT0FBTyxD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LElBQUksRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIlxuaW1wb3J0IHY4IGZyb20gXCJub2RlOnY4XCJcbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCBydW5Kb2JQYXlsb2FkLCB7IEJhY2tncm91bmRKb2JQZXJmb3JtZWRGYWlsdXJlIH0gZnJvbSBcIi4vam9iLXJ1bm5lci5qc1wiXG5pbXBvcnQgeyBib3VuZGVkUG9vbGVkUnVubmVySW5mbGlnaHRKb2JJZHMsIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiwgaXNQb29sZWRDaGlsZFNodXRkb3duU2lnbmFsIH0gZnJvbSBcIi4vcG9vbGVkLXJ1bm5lci1zaHV0ZG93bi5qc1wiXG5pbXBvcnQgeyBjbG9zZVJ1bm5lckNvbm5lY3Rpb25zLCBjbG9zZVJ1bm5lckZyYW1ld29ya0Nvbm5lY3Rpb25zLCBjdXJyZW50Q29uZmlndXJhdGlvbk9yTnVsbCB9IGZyb20gXCIuL3J1bm5lci1ncmFjZWZ1bC1zaHV0ZG93bi5qc1wiXG5pbXBvcnQgc2V0UnVubmVyUHJvY2Vzc1RpdGxlIGZyb20gXCIuL3J1bm5lci1wcm9jZXNzLXRpdGxlLmpzXCJcbmltcG9ydCBQb29sZWRSdW5uZXJCcm9rZXJJZGVudGl0eSBmcm9tIFwiLi9wb29sZWQtcnVubmVyLWJyb2tlci1pZGVudGl0eS5qc1wiXG5pbXBvcnQgeyBydW5XaXRoU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcgfSBmcm9tIFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCJcblxuY29uc3QgQkFTRV9QUk9DRVNTX1RJVExFID0gXCJ2ZWxvY2lvdXMgYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwiXG4vKiogQSBzaHV0ZG93biBvYnNlcnZhdGlvbiBtYXkgZGVsYXkgcmVzb3VyY2UgdGVhcmRvd24gb25seSBmb3IgdGhpcyBib3VuZGVkIElQQyBzZW5kLiAqL1xuY29uc3QgU0hVVERPV05fT0JTRVJWQVRJT05fU0VORF9USU1FT1VUX01TID0gMTAwXG4vKiogU3RhYmxlIGlkZW50aXR5IG9mIHRoaXMgcG9vbGVkIGNoaWxkIHByb2Nlc3MgZm9yIHRoZSBsaWZlIG9mIHRoZSBwcm9jZXNzLiAqL1xuY29uc3QgY2hpbGRJbnN0YW5jZUlkID0gcmFuZG9tVVVJRCgpXG4vKiogU2FtcGxpbmcgY2FkZW5jZSBmb3IgdGhlIG1lbW9yeSBvYnNlcnZhdGlvbiBzYW1wbGVyLiAqL1xuY29uc3QgTUVNT1JZX09CU0VSVkFUSU9OX0lOVEVSVkFMX01TID0gMTAwMDBcbi8qKiBCb3VuZCBvbiBpbi1mbGlnaHQgam9iIGlkcyBjYXJyaWVkIGluIGEgbWVtb3J5IG9ic2VydmF0aW9uLiAqL1xuY29uc3QgTUVNT1JZX09CU0VSVkFUSU9OX0pPQl9JRF9MSU1JVCA9IDMyXG5cbi8qKlxuICogUmVhZHMgdGhpcyBwcm9jZXNzJ3MgcGVhayByZXNpZGVudCBzZXQgc2l6ZSAodGhlIGtlcm5lbCBoaWdoLXdhdGVyIG1hcmssXG4gKiBgVm1IV01gIGluIGAvcHJvYy9zZWxmL3N0YXR1c2ApLiBVbmxpa2UgYSBwb2ludC1pbi10aW1lIFJTUyBzYW1wbGUsIHRoaXMgaXNcbiAqIG1vbm90b25pYyBmb3IgdGhlIGxpZmUgb2YgdGhlIHByb2Nlc3M6IG9uY2UgYSBidXJzdCByYXRjaGV0cyB0aGUgd29ya2luZyBzZXRcbiAqIHVwLCBgVm1IV01gIHJlbWVtYmVycyBpdCBldmVuIGFmdGVyIGdhcmJhZ2UgY29sbGVjdGlvbiByZXR1cm5zIHRoZSBwYWdlcy5cbiAqIFRoYXQgbWFrZXMgaXQgdGhlIGhvbmVzdCBzaWduYWwgZm9yIHJlY3ljbGluZyBhIHBvb2xlZCBjaGlsZCDigJQgYSBjaGlsZCB0aGF0XG4gKiBzcGlrZWQgdG8gc2V2ZXJhbCBnaWdhYnl0ZXMgZHVyaW5nIGEgYnVpbGQgYnVyc3Qga2VlcHMgaXRzIHJhdGNoZXRlZCBmbG9vclxuICogYW5kIG11c3QgYmUgcmVwbGFjZWQsIGV2ZW4gdGhvdWdoIGl0cyBzZXR0bGVkIFJTUyBhdCBqb2Itb3V0Y29tZSB0aW1lIGxvb2tzXG4gKiBtb2Rlc3QuIEEgcmVhZCBmYWlsdXJlIChubyBgL3Byb2NgKSBkZWdyYWRlcyB0byB0aGUgY3VycmVudCBSU1Mgc2FtcGxlIHNvIHRoZVxuICogb2JzZXJ2YXRpb24gaXMgbmV2ZXIgYmxvY2tlZCBvbiBpdC5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IFBlYWsgUlNTIGluIGJ5dGVzLCBvciB0aGUgY3VycmVudCBSU1Mgc2FtcGxlIHdoZW4gdW5yZWFkYWJsZS5cbiAqL1xuZnVuY3Rpb24gcmVhZFBlYWtSc3NCeXRlcygpIHtcbiAgY29uc3QgZmFsbGJhY2tCeXRlcyA9IHByb2Nlc3MubWVtb3J5VXNhZ2UoKS5yc3NcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGF0dXMgPSByZWFkRmlsZVN5bmMoXCIvcHJvYy9zZWxmL3N0YXR1c1wiLCBcInV0ZjhcIilcbiAgICBjb25zdCBtYXRjaCA9IC9eVm1IV006XFxzKyhcXGQrKVxccytrQiQvbS5leGVjKHN0YXR1cylcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gZmFsbGJhY2tCeXRlc1xuICAgIGNvbnN0IGtpYmlieXRlcyA9IE51bWJlcihtYXRjaFsxXSlcbiAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKGtpYmlieXRlcykgJiYga2liaWJ5dGVzID4gMCA/IGtpYmlieXRlcyAqIDEwMjQgOiBmYWxsYmFja0J5dGVzXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxsYmFja0J5dGVzXG4gIH1cbn1cblxuc2V0UnVubmVyUHJvY2Vzc1RpdGxlKClcblxuLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xubGV0IHNodXRkb3duUHJvbWlzZVxuXG4vKipcbiAqIENsb3NlcyB0aGUgcnVubmVyJ3MgY29ubmVjdGlvbnMg4oCUIHJlbGVhc2luZyBhbnkgYWR2aXNvcnkgbG9jayBhIGtpbGxlZC1taWQtcGFzc1xuICogam9iIHN0aWxsIGhvbGRzIOKAlCBiZWZvcmUgZXhpdGluZywgaW5zdGVhZCBvZiBsZWF2aW5nIGEgaGFsZi1vcGVuIHNlc3Npb24gdGhhdFxuICoga2VlcHMgdGhlIGxvY2sgdW50aWwgdGhlIERCIHNlcnZlcidzIGB3YWl0X3RpbWVvdXRgLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTaHV0ZG93biBvYnNlcnZhdGlvbi5cbiAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmV4aXRDb2RlIC0gUHJvY2VzcyBleGl0IGNvZGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gYXJncy5yZWFzb24gLSBFeGFjdCBzaHV0ZG93biByZWFzb24gb2JzZXJ2ZWQgYnkgdGhlIGNoaWxkLlxuICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5zaHV0ZG93blJlcXVlc3RlZEF0TXNdIC0gUGFyZW50IHJlcXVlc3QgdGltZXN0YW1wIHdoZW4gc3VwcGxpZWQgb3ZlciBJUEMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBbYXJncy5zaWduYWxdIC0gUmVxdWVzdGVkIG9yIG9ic2VydmVkIHNpZ25hbC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5mdW5jdGlvbiBzaHV0ZG93blJ1bm5lcih7ZXhpdENvZGUsIHJlYXNvbiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID0gbnVsbCwgc2lnbmFsID0gbnVsbH0pIHtcbiAgaWYgKHNodXRkb3duUHJvbWlzZSkgcmV0dXJuIHNodXRkb3duUHJvbWlzZVxuXG4gIHNodXRkb3duUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgc2VuZFNodXRkb3duT2JzZXJ2YXRpb24oe3JlYXNvbiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zLCBzaWduYWx9KVxuICAgIGF3YWl0IGNsb3NlUnVubmVyQ29ubmVjdGlvbnMoY3VycmVudENvbmZpZ3VyYXRpb25Pck51bGwoKSlcbiAgICBwcm9jZXNzLmV4aXQoZXhpdENvZGUpXG4gIH0pKClcblxuICByZXR1cm4gc2h1dGRvd25Qcm9taXNlXG59XG5cbi8qKlxuICogSWRzIG9mIGpvYnMgY3VycmVudGx5IHJ1bm5pbmcgaW4gdGhpcyBjaGlsZC4gQSBwb29sZWQgY2hpbGQgcnVucyB1cCB0b1xuICogYHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5YCBqb2JzIGF0IG9uY2UgKHRoZSB3b3JrZXIgb25seSBkaXNwYXRjaGVzIHdpdGhpbiB0aGF0XG4gKiBib3VuZCk7IHRoZSBzZXQgZGVkdXBlcyBhIHJlZGVsaXZlcmVkIGpvYiBpZCBhbmQgbGV0cyBlYWNoIGpvYiBzZXR0bGVcbiAqIGluZGVwZW5kZW50bHkuXG4gKiBAdHlwZSB7U2V0PHN0cmluZz59XG4gKi9cbmNvbnN0IHJ1bm5pbmdKb2JJZHMgPSBuZXcgU2V0KClcbmNvbnN0IGJyb2tlcklkZW50aXR5ID0gbmV3IFBvb2xlZFJ1bm5lckJyb2tlcklkZW50aXR5KHtcbiAgY2xvc2VDb25uZWN0aW9uczogYXN5bmMgKCkgPT4gYXdhaXQgY2xvc2VSdW5uZXJGcmFtZXdvcmtDb25uZWN0aW9ucyhjdXJyZW50Q29uZmlndXJhdGlvbk9yTnVsbCgpKVxufSlcblxuLyoqXG4gKiBTZXRzIGFuIGFnZ3JlZ2F0ZSBwcm9jZXNzIHRpdGxlIGZyb20gdGhlIGN1cnJlbnQgaW4tZmxpZ2h0IGNvdW50LiBBIGNoaWxkIHJ1bnNcbiAqIGpvYnMgY29uY3VycmVudGx5LCBzbyBhIHBlci1qb2IgdGl0bGUgKHdoaWNoIGBydW5Kb2JQYXlsb2FkYCB3b3VsZCBzbmFwc2hvdCBhbmRcbiAqIHJlc3RvcmUgYXJvdW5kIGEgc2luZ2xlIGpvYikgY2Fubm90IHJlcHJlc2VudCB0aGUgcHJvY2VzcyDigJQgaW50ZXJsZWF2ZWRcbiAqIGNvbXBsZXRpb25zIHdvdWxkIGxlYXZlIGEgc3RhbGUgbGFiZWwuIFJlY29tcHV0aW5nIGZyb20gYHJ1bm5pbmdKb2JJZHMuc2l6ZWAgaXNcbiAqIGNvbmN1cnJlbmN5LXNhZmUgYW5kIGhvbmVzdDogYHBzYC9gdG9wYCBzaG93IGhvdyBtYW55IGpvYnMgdGhlIGNoaWxkIGlzIHJ1bm5pbmcuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gdXBkYXRlUHJvY2Vzc1RpdGxlKCkge1xuICBjb25zdCBjb3VudCA9IHJ1bm5pbmdKb2JJZHMuc2l6ZVxuXG4gIHByb2Nlc3MudGl0bGUgPSBjb3VudCA+IDAgPyBgJHtCQVNFX1BST0NFU1NfVElUTEV9OiAke2NvdW50fSAke2NvdW50ID09PSAxID8gXCJqb2JcIiA6IFwiam9ic1wifWAgOiBCQVNFX1BST0NFU1NfVElUTEVcbn1cblxuLyoqXG4gKiBTZW5kcyBvbmUgYm91bmRlZCBsaWZlY3ljbGUgb2JzZXJ2YXRpb24gYmVmb3JlIGFwcGxpY2F0aW9uL2ZyYW1ld29yayB0ZWFyZG93bi5cbiAqIEEgY2xvc2VkIElQQyBjaGFubmVsIGlzIGV4cGVjdGVkIGZvciBgaXBjX2Rpc2Nvbm5lY3RgOyBvdGhlciBzZW5kIGZhaWx1cmVzIGFyZVxuICogc3VyZmFjZWQgb24gc3RkZXJyIGJ1dCBuZXZlciBob2xkIGNvbm5lY3Rpb24gY2xlYW51cCBwYXN0IHRoZSBmaXhlZCBib3VuZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2h1dGRvd24gb2JzZXJ2YXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gYXJncy5yZWFzb24gLSBTaHV0ZG93biByZWFzb24uXG4gKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3Muc2h1dGRvd25SZXF1ZXN0ZWRBdE1zIC0gUGFyZW50IHJlcXVlc3QgdGltZXN0YW1wLlxuICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gYXJncy5zaWduYWwgLSBSZXF1ZXN0ZWQgb3Igb2JzZXJ2ZWQgc2lnbmFsLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgSVBDIGFjY2VwdHMgdGhlIG9ic2VydmF0aW9uIG9yIHRoZSBib3VuZCBleHBpcmVzLlxuICovXG5hc3luYyBmdW5jdGlvbiBzZW5kU2h1dGRvd25PYnNlcnZhdGlvbih7cmVhc29uLCBzaHV0ZG93blJlcXVlc3RlZEF0TXMsIHNpZ25hbH0pIHtcbiAgaWYgKCFwcm9jZXNzLnNlbmQgfHwgIXByb2Nlc3MuY29ubmVjdGVkKSByZXR1cm5cblxuICBjb25zdCBib3VuZGVkSW5mbGlnaHQgPSBib3VuZGVkUG9vbGVkUnVubmVySW5mbGlnaHRKb2JJZHMocnVubmluZ0pvYklkcylcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvbiAmIHt0eXBlOiBcInNodXRkb3duLW9ic2VydmF0aW9uXCJ9fSAqL1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGNoaWxkSW5zdGFuY2VJZCxcbiAgICAuLi5ib3VuZGVkSW5mbGlnaHQsXG4gICAgcmVhc29uLFxuICAgIHNodXRkb3duT2JzZXJ2ZWRBdE1zOiBEYXRlLm5vdygpLFxuICAgIHNodXRkb3duUmVxdWVzdGVkQXRNcyxcbiAgICBzaWduYWwsXG4gICAgdHlwZTogXCJzaHV0ZG93bi1vYnNlcnZhdGlvblwiXG4gIH1cblxuICB0cnkge1xuICAgIGF3YWl0IHRpbWVvdXQoe3RpbWVvdXQ6IFNIVVRET1dOX09CU0VSVkFUSU9OX1NFTkRfVElNRU9VVF9NU30sIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBwcm9jZXNzLnNlbmQ/LihtZXNzYWdlLCAoZXJyb3IpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJQb29sZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIGNvdWxkIG5vdCBzZW5kIGl0cyBzaHV0ZG93biBvYnNlcnZhdGlvbjpcIiwgZXJyb3IpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnRzIG9uZSBhY2NlcHRhbmNlIG9ic2VydmF0aW9uIChqb2IgcmVjZWl2ZWQgLyBwZXJmb3JtIHN0YXJ0ZWQpIHRvIHRoZVxuICogd29ya2VyIG92ZXIgSVBDLiBUaGUgbWVzc2FnZSBjYXJyaWVzIHRoZSBqb2IncyBleGFjdCBoYW5kb2ZmIGxlYXNlIHNvIHRoZVxuICogd29ya2VyIGNhbiBwZXJzaXN0IGl0IGZlbmNlZCB3aXRob3V0IGFueSBvdGhlciBsb29rdXAuIFNlbmQgZmFpbHVyZXMgYXJlXG4gKiBzd2FsbG93ZWQ6IGEgZGVhZCBJUEMgY2hhbm5lbCBpcyB0ZXJtaW5hbCBmb3IgdGhpcyBjaGlsZCAodGhlIGRpc2Nvbm5lY3RcbiAqIGhhbmRsZXIgb3ducyBzaHV0ZG93biksIGFuZCBsb3NpbmcgYWNjZXB0YW5jZSBldmlkZW5jZSBtdXN0IG5ldmVyIGZhaWwgdGhlXG4gKiBqb2IgaXRzZWxmLlxuICogQHBhcmFtIHtcImpvYi1yZWNlaXZlZFwiIHwgXCJqb2Itc3RhcnRlZFwifSB0eXBlIC0gT2JzZXJ2YXRpb24ga2luZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIEpvYiBwYXlsb2FkIGNhcnJ5aW5nIHRoZSBoYW5kb2ZmIGxlYXNlLlxuICogQHBhcmFtIHtudW1iZXJ9IG9ic2VydmVkQXRNcyAtIEVwb2NoIG1zIG9mIHRoZSBvYnNlcnZhdGlvbi5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBzZW5kQ2hpbGRBY2NlcHRhbmNlKHR5cGUsIHBheWxvYWQsIG9ic2VydmVkQXRNcykge1xuICBpZiAoIXByb2Nlc3Muc2VuZCkgcmV0dXJuXG5cbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBjaGlsZEluc3RhbmNlSWQsXG4gICAgY2hpbGRQaWQ6IHByb2Nlc3MucGlkLFxuICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgIHR5cGUsXG4gICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQsXG4gICAgLi4uKHR5cGUgPT09IFwiam9iLXJlY2VpdmVkXCIgPyB7cmVjZWl2ZWRBdE1zOiBvYnNlcnZlZEF0TXN9IDoge3N0YXJ0ZWRBdE1zOiBvYnNlcnZlZEF0TXN9KVxuICB9XG5cbiAgdHJ5IHtcbiAgICBwcm9jZXNzLnNlbmQobWVzc2FnZSlcbiAgfSBjYXRjaCB7XG4gICAgLy8gVGhlIElQQyBjaGFubmVsIGlzIGFscmVhZHkgZ29uZTsgdGhlIGRpc2Nvbm5lY3QgaGFuZGxlciBvd25zIHNodXRkb3duLlxuICB9XG59XG5cbi8qKlxuICogQ29sbGVjdHMgYSBib3VuZGVkIGRpYWdub3N0aWMgc25hcHNob3Qgb2YgdGhpcyBjaGlsZCdzIG1lbW9yeSBzdGF0ZS4gVGhlXG4gKiBwb29sZWQgY2hpbGQncyBzdGRpbyBpcyBpZ25vcmVkIGJ5IHRoZSB3b3JrZXIgZm9yaywgc28gSVBDIGlzIHRoZSBvbmx5IGNoYW5uZWxcbiAqIHRvIHRoZSB3b3JrZXIncyBsb2cgc3VyZmFjZSDigJQgdGhpcyBzbmFwc2hvdCAoc2VudCBwZXJpb2RpY2FsbHkgYW5kIG9uIGRlbWFuZClcbiAqIGlzIGhvdyBhIG1lbW9yeSBwcm9ibGVtIG5hbWVzIGl0c2VsZiBpbiBwcm9kdWN0aW9uLiBUaGUgVjggaGVhcC1zdGF0XG4gKiBicmVha2Rvd24gKG5vdCBhIGZ1bGwgaGVhcCBzbmFwc2hvdCwgd2hpY2ggd291bGQgYmUgZmFyIHRvbyBleHBlbnNpdmUgd2hpbGUgYVxuICogY2hpbGQgcnVucyAyNSBjb25jdXJyZW50IGpvYnMpIGRpc3Rpbmd1aXNoZXMgYSBWOCBoZWFwLWdyb3d0aCBsZWFrIGZyb21cbiAqIGV4dGVybmFsL2FycmF5LWJ1ZmZlciAobmF0aXZlIHJlc291cmNlKSBncm93dGgsIGFuZCB0aGUgaW4tZmxpZ2h0IGpvYiBpZHNcbiAqIHRpZSB0aGUgb2JzZXJ2YXRpb24gdG8gdGhlIHdvcmsgdGhhdCB3YXMgcnVubmluZy5cbiAqIEByZXR1cm5zIHt7YWN0aXZlSm9iSWRzOiBzdHJpbmdbXSwgYWN0aXZlSm9iSWRzVHJ1bmNhdGVkQ291bnQ6IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkOiBzdHJpbmcsIGNoaWxkUGlkOiBudW1iZXIsIGNoaWxkVXB0aW1lTXM6IG51bWJlciwgaGVhcFN0YXRpc3RpY3M6IFJldHVyblR5cGU8dHlwZW9mIHY4LmdldEhlYXBTdGF0aXN0aWNzPiwgam9iQ291bnQ6IG51bWJlciwgbWVtb3J5VXNhZ2U6IFJldHVyblR5cGU8dHlwZW9mIHByb2Nlc3MubWVtb3J5VXNhZ2U+LCBvYnNlcnZlZEF0TXM6IG51bWJlciwgcGVha1Jzc0J5dGVzOiBudW1iZXIsIHJzc0J5dGVzOiBudW1iZXIsIHR5cGU6IFwicG9vbGVkLWNoaWxkLW1lbW9yeVwiLCB1cHRpbWVNczogbnVtYmVyfX0gLSBCb3VuZGVkIG1lbW9yeSBvYnNlcnZhdGlvbiBmb3IgdGhpcyBjaGlsZC5cbiAqL1xuZnVuY3Rpb24gY29sbGVjdE1lbW9yeU9ic2VydmF0aW9uKCkge1xuICBjb25zdCBqb2JJZHMgPSBbLi4ucnVubmluZ0pvYklkc11cbiAgY29uc3QgYWN0aXZlSm9iSWRzID0gam9iSWRzLnNsaWNlKDAsIE1FTU9SWV9PQlNFUlZBVElPTl9KT0JfSURfTElNSVQpXG4gIGNvbnN0IG1lbW9yeVVzYWdlID0gcHJvY2Vzcy5tZW1vcnlVc2FnZSgpXG5cbiAgcmV0dXJuIHtcbiAgICBhY3RpdmVKb2JJZHMsXG4gICAgYWN0aXZlSm9iSWRzVHJ1bmNhdGVkQ291bnQ6IE1hdGgubWF4KDAsIGpvYklkcy5sZW5ndGggLSBhY3RpdmVKb2JJZHMubGVuZ3RoKSxcbiAgICBjaGlsZEluc3RhbmNlSWQsXG4gICAgY2hpbGRQaWQ6IHByb2Nlc3MucGlkLFxuICAgIGNoaWxkVXB0aW1lTXM6IE1hdGguZmxvb3IocHJvY2Vzcy51cHRpbWUoKSAqIDEwMDApLFxuICAgIGhlYXBTdGF0aXN0aWNzOiB2OC5nZXRIZWFwU3RhdGlzdGljcygpLFxuICAgIGpvYkNvdW50OiBqb2JJZHMubGVuZ3RoLFxuICAgIG1lbW9yeVVzYWdlLFxuICAgIG9ic2VydmVkQXRNczogRGF0ZS5ub3coKSxcbiAgICBwZWFrUnNzQnl0ZXM6IHJlYWRQZWFrUnNzQnl0ZXMoKSxcbiAgICByc3NCeXRlczogbWVtb3J5VXNhZ2UucnNzLFxuICAgIHR5cGU6IFwicG9vbGVkLWNoaWxkLW1lbW9yeVwiLFxuICAgIHVwdGltZU1zOiBNYXRoLmZsb29yKHByb2Nlc3MudXB0aW1lKCkgKiAxMDAwKVxuICB9XG59XG5cbi8qKlxuICogU2VuZHMgYSBtZW1vcnkgb2JzZXJ2YXRpb24gdG8gdGhlIHdvcmtlci4gU2FtcGxpbmcgaXMgY2hlYXAgKHByb2Nlc3MgKyBWOFxuICogaGVhcCBzdGF0cykgYW5kIG9ubHkgcnVucyB3aGlsZSBqb2JzIGFyZSBpbiBmbGlnaHQ7IGEgY2xvc2VkIElQQyBjaGFubmVsIGlzXG4gKiB0ZXJtaW5hbCBmb3IgdGhpcyBjaGlsZCAodGhlIGRpc2Nvbm5lY3QgaGFuZGxlciBvd25zIHNodXRkb3duKSwgc28gYSBmYWlsZWRcbiAqIHNlbmQgaXMgc3dhbGxvd2VkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHNlbmRNZW1vcnlPYnNlcnZhdGlvbigpIHtcbiAgaWYgKCFwcm9jZXNzLnNlbmQgfHwgcnVubmluZ0pvYklkcy5zaXplID09PSAwKSByZXR1cm5cblxuICB0cnkge1xuICAgIHByb2Nlc3Muc2VuZChjb2xsZWN0TWVtb3J5T2JzZXJ2YXRpb24oKSlcbiAgfSBjYXRjaCB7XG4gICAgLy8gVGhlIElQQyBjaGFubmVsIGlzIGFscmVhZHkgZ29uZTsgdGhlIGRpc2Nvbm5lY3QgaGFuZGxlciBvd25zIHNodXRkb3duLlxuICB9XG59XG5cbi8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xubGV0IG1lbW9yeU9ic2VydmF0aW9uVGltZXJcblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgcmVxdWVzdHMgdGhpcyBjaGlsZCB0byBzZW5kIGEgbWVtb3J5IG9ic2VydmF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwibWVtb3J5LW9ic2VydmF0aW9uLXJlcXVlc3RcIn19IC0gV2hldGhlciB0aGUgbWVzc2FnZSByZXF1ZXN0cyBvbmUuXG4gKi9cbmZ1bmN0aW9uIGlzTWVtb3J5T2JzZXJ2YXRpb25SZXF1ZXN0TWVzc2FnZShtZXNzYWdlKSB7XG4gIHJldHVybiBtZXNzYWdlICE9PSBudWxsXG4gICAgJiYgdHlwZW9mIG1lc3NhZ2UgPT09IFwib2JqZWN0XCJcbiAgICAmJiBtZXNzYWdlLnR5cGUgPT09IFwibWVtb3J5LW9ic2VydmF0aW9uLXJlcXVlc3RcIlxufVxuXG4vKipcbiAqIFN0YXJ0cyB0aGUgcGVyaW9kaWMgbWVtb3J5IG9ic2VydmF0aW9uIHNhbXBsZXIgaWYgaXQgaXMgbm90IGFscmVhZHkgcnVubmluZy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBzdGFydE1lbW9yeU9ic2VydmF0aW9uU2FtcGxpbmcoKSB7XG4gIGlmIChtZW1vcnlPYnNlcnZhdGlvblRpbWVyIHx8ICFwcm9jZXNzLnNlbmQpIHJldHVyblxuXG4gIG1lbW9yeU9ic2VydmF0aW9uVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgc2VuZE1lbW9yeU9ic2VydmF0aW9uKClcbiAgfSwgTUVNT1JZX09CU0VSVkFUSU9OX0lOVEVSVkFMX01TKVxuICBtZW1vcnlPYnNlcnZhdGlvblRpbWVyLnVucmVmKClcbn1cblxuLyoqXG4gKiBTdG9wcyB0aGUgcGVyaW9kaWMgbWVtb3J5IG9ic2VydmF0aW9uIHNhbXBsZXIuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gc3RvcE1lbW9yeU9ic2VydmF0aW9uU2FtcGxpbmcoKSB7XG4gIGlmICghbWVtb3J5T2JzZXJ2YXRpb25UaW1lcikgcmV0dXJuXG5cbiAgY2xlYXJJbnRlcnZhbChtZW1vcnlPYnNlcnZhdGlvblRpbWVyKVxuICBtZW1vcnlPYnNlcnZhdGlvblRpbWVyID0gdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcnVubmFibGUgcG9vbGVkIGpvYiBtZXNzYWdlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwiam9iXCIsIHBheWxvYWQ6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30sIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyPzogaW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfX0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBqb2IgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gaXNKb2JNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHt7dHlwZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwYXlsb2FkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwiam9iXCIgJiYgISFyZWNvcmQucGF5bG9hZCAmJiB0eXBlb2YgcmVjb3JkLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHJlY29yZC5wYXlsb2FkLmlkID09PSBcInN0cmluZ1wiXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIHJlcXVlc3RzIGEgdHlwZWQgcG9vbGVkLWNoaWxkIHNodXRkb3duLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwic2h1dGRvd24tcmVxdWVzdFwiLCByZWFzb246IGltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zOiBudW1iZXIsIHNpZ25hbDogaW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIHBhcmVudCBzaHV0ZG93biByZXF1ZXN0LlxuICovXG5mdW5jdGlvbiBpc1NodXRkb3duUmVxdWVzdE1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3t0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlYXNvbj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaHV0ZG93blJlcXVlc3RlZEF0TXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2lnbmFsPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwic2h1dGRvd24tcmVxdWVzdFwiXG4gICAgJiYgaXNQb29sZWRDaGlsZFNodXRkb3duUmVhc29uKHJlY29yZC5yZWFzb24pXG4gICAgJiYgdHlwZW9mIHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcylcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25TaWduYWwocmVjb3JkLnNpZ25hbClcbn1cblxuLyoqXG4gKiBTZW5kcyB0aGUgdGVybWluYWwgb3V0Y29tZSBhZnRlciB0aGUgbWFpbi9EQiByZXBvcnQgaGFzIGJlZW4gYWNrbm93bGVkZ2VkIG9yIHJlamVjdGVkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPdXRjb21lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWNrbm93bGVkZ2VkIC0gV2hldGhlciB0aGUgdGVybWluYWwgcmVwb3J0IHdhcyBhY2tub3dsZWRnZWQuXG4gKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBbYXJncy5zdGF0dXNdIC0gQWNrbm93bGVkZ2VkIG91dGNvbWUuXG4gKiBAcGFyYW0ge0Vycm9yfSBbYXJncy5lcnJvcl0gLSBSZXBvcnRpbmcgZXJyb3Igd2hlbiBhY2tub3dsZWRnZW1lbnQgd2FzIG5vdCBvYnRhaW5lZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIElQQyBhY2NlcHRzIHRoZSBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBzZW5kT3V0Y29tZSh7am9iSWQsIGFja25vd2xlZGdlZCwgc3RhdHVzLCBlcnJvcn0pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgaWYgKCFwcm9jZXNzLnNlbmQpIHtcbiAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgcHJvY2Vzcy5zZW5kKHtcbiAgICAgIHR5cGU6IFwiam9iLW91dGNvbWVcIixcbiAgICAgIGpvYklkLFxuICAgICAgYWNrbm93bGVkZ2VkLFxuICAgICAgc3RhdHVzLFxuICAgICAgcGVha1Jzc0J5dGVzOiByZWFkUGVha1Jzc0J5dGVzKCksXG4gICAgICByc3NCeXRlczogcHJvY2Vzcy5tZW1vcnlVc2FnZSgpLnJzcyxcbiAgICAgIGVycm9yOiBlcnJvcj8ubWVzc2FnZVxuICAgIH0sICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIG9uZSBqb2IgY29uY3VycmVudGx5IHdpdGggYW55IHNpYmxpbmdzIGFuZCByZXBvcnRzIGl0cyBvd24gdGVybWluYWxcbiAqIG91dGNvbWUuIEEgc2luZ2xlIGpvYidzIHVuZXhwZWN0ZWQgZmFpbHVyZSByZXBvcnRzIHRoYXQgam9iIGZvciByZWNsYW1hdGlvblxuICogKGBhY2tub3dsZWRnZWQ6IGZhbHNlYCkgYnV0IGRvZXMgTk9UIHRha2UgZG93biB0aGUgY2hpbGQg4oCUIGl0cyBjb25jdXJyZW50XG4gKiBzaWJsaW5ncyBrZWVwIHJ1bm5pbmcuIE9ubHkgYSBwcm9jZXNzLWxldmVsIGZhdWx0ICh3aGljaCBlc2NhcGVzIGV2ZXJ5XG4gKiBwZXItam9iIHRyeS9jYXRjaCkgZW5kcyB0aGUgY2hpbGQsIHdoaWNoIHRoZSB3b3JrZXIgc2VlcyBhcyBhbiBleGl0IGFuZFxuICogcmVjbGFpbXMgZm9yIHRoZSB3aG9sZSBpbi1mbGlnaHQgc2V0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiKS5TaGFyZWRUcmFuc2FjdGlvbkJyb2tlckpvYkNvbmZpZ30gc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIgLSBQZXItam9iIGJyb2tlciBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVwb3J0aW5nLlxuICovXG5hc3luYyBmdW5jdGlvbiBydW5Kb2IocGF5bG9hZCwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGF0dXMgPSBhd2FpdCBydW5XaXRoU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBicm9rZXJJZGVudGl0eS5ydW4oc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHJ1bkpvYlBheWxvYWQocGF5bG9hZCwge1xuICAgICAgICAgIGNsb3NlQ29ubmVjdGlvbnM6IGZhbHNlLFxuICAgICAgICAgIG1hbmFnZVByb2Nlc3NUaXRsZTogZmFsc2UsXG4gICAgICAgICAgb25QZXJmb3JtU3RhcnQ6ICgpID0+IHNlbmRDaGlsZEFjY2VwdGFuY2UoXCJqb2Itc3RhcnRlZFwiLCBwYXlsb2FkLCBEYXRlLm5vdygpKSxcbiAgICAgICAgICBwcm9jZXNzVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtcG9vbGVkLXJ1bm5lclwiXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH0pXG4gICAgYXdhaXQgc2VuZE91dGNvbWUoe2pvYklkOiBwYXlsb2FkLmlkLCBhY2tub3dsZWRnZWQ6IHRydWUsIHN0YXR1c30pXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYlBlcmZvcm1lZEZhaWx1cmUpIHtcbiAgICAgIGF3YWl0IHNlbmRPdXRjb21lKHtqb2JJZDogcGF5bG9hZC5pZCwgYWNrbm93bGVkZ2VkOiB0cnVlLCBzdGF0dXM6IFwiZmFpbGVkXCJ9KVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByZXBvcnRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc29sZS5lcnJvcihcIlBvb2xlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZmFpbGVkIGJlZm9yZSB0ZXJtaW5hbCBhY2tub3dsZWRnZW1lbnQ6XCIsIHJlcG9ydEVycm9yKVxuICAgICAgYXdhaXQgc2VuZE91dGNvbWUoe2pvYklkOiBwYXlsb2FkLmlkLCBhY2tub3dsZWRnZWQ6IGZhbHNlLCBlcnJvcjogcmVwb3J0RXJyb3J9KVxuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBydW5uaW5nSm9iSWRzLmRlbGV0ZShwYXlsb2FkLmlkKVxuICAgIHVwZGF0ZVByb2Nlc3NUaXRsZSgpXG5cbiAgICBpZiAocnVubmluZ0pvYklkcy5zaXplID09PSAwKSB7XG4gICAgICBzdG9wTWVtb3J5T2JzZXJ2YXRpb25TYW1wbGluZygpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogSGFuZGxlcyBhIGpvYiBtZXNzYWdlLCBzdGFydGluZyBpdCBhbG9uZ3NpZGUgYW55IGNvbmN1cnJlbnQgc2libGluZ3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gaGFuZGxlTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmIChpc1NodXRkb3duUmVxdWVzdE1lc3NhZ2UobWVzc2FnZSkpIHtcbiAgICB2b2lkIHNodXRkb3duUnVubmVyKHtcbiAgICAgIGV4aXRDb2RlOiBtZXNzYWdlLnJlYXNvbiA9PT0gXCJwYXJlbnRfcmV0aXJlX2RyYWluZWRcIiA/IDAgOiAxLFxuICAgICAgcmVhc29uOiBtZXNzYWdlLnJlYXNvbixcbiAgICAgIHNodXRkb3duUmVxdWVzdGVkQXRNczogbWVzc2FnZS5zaHV0ZG93blJlcXVlc3RlZEF0TXMsXG4gICAgICBzaWduYWw6IG1lc3NhZ2Uuc2lnbmFsXG4gICAgfSlcbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmIChpc01lbW9yeU9ic2VydmF0aW9uUmVxdWVzdE1lc3NhZ2UobWVzc2FnZSkpIHtcbiAgICBzZW5kTWVtb3J5T2JzZXJ2YXRpb24oKVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKCFpc0pvYk1lc3NhZ2UobWVzc2FnZSkgfHwgcnVubmluZ0pvYklkcy5oYXMobWVzc2FnZS5wYXlsb2FkLmlkKSkgcmV0dXJuXG5cbiAgcnVubmluZ0pvYklkcy5hZGQobWVzc2FnZS5wYXlsb2FkLmlkKVxuICB1cGRhdGVQcm9jZXNzVGl0bGUoKVxuICBzZW5kQ2hpbGRBY2NlcHRhbmNlKFwiam9iLXJlY2VpdmVkXCIsIG1lc3NhZ2UucGF5bG9hZCwgRGF0ZS5ub3coKSlcbiAgc3RhcnRNZW1vcnlPYnNlcnZhdGlvblNhbXBsaW5nKClcbiAgdm9pZCBydW5Kb2IobWVzc2FnZS5wYXlsb2FkLCBtZXNzYWdlLnNoYXJlZFRyYW5zYWN0aW9uQnJva2VyIHx8IHtleHBlY3RlZDogZmFsc2V9KVxufVxuXG5wcm9jZXNzLm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4gaGFuZGxlTWVzc2FnZShtZXNzYWdlKSlcbnByb2Nlc3Mub25jZShcImRpc2Nvbm5lY3RcIiwgKCkgPT4gdm9pZCBzaHV0ZG93blJ1bm5lcih7ZXhpdENvZGU6IDAsIHJlYXNvbjogXCJpcGNfZGlzY29ubmVjdFwifSkpXG5wcm9jZXNzLm9uY2UoXCJTSUdURVJNXCIsICgpID0+IHZvaWQgc2h1dGRvd25SdW5uZXIoe2V4aXRDb2RlOiAxLCByZWFzb246IFwic2lnbmFsX3NpZ3Rlcm1cIiwgc2lnbmFsOiBcIlNJR1RFUk1cIn0pKVxucHJvY2Vzcy5vbmNlKFwiU0lHSU5UXCIsICgpID0+IHZvaWQgc2h1dGRvd25SdW5uZXIoe2V4aXRDb2RlOiAxLCByZWFzb246IFwic2lnbmFsX3NpZ2ludFwiLCBzaWduYWw6IFwiU0lHSU5UXCJ9KSlcbmlmIChwcm9jZXNzLnNlbmQpIHByb2Nlc3Muc2VuZCh7Y2hpbGRJbnN0YW5jZUlkLCBjaGlsZFBpZDogcHJvY2Vzcy5waWQsIHR5cGU6IFwicmVhZHlcIn0pXG4iXX0=