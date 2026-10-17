export type BackgroundJobOwnerLivenessStatus = "alive" | "dead" | "unknown";
export type BackgroundJobOwnerLivenessResult = {
    /**
     * - Recorded pooled-child identity, when available.
     */
    childInstanceId: string | null;
    /**
     * - Recorded OS pid, when available.
     */
    childPid: number | null;
    /**
     * - Machine-readable reason for the verdict.
     */
    reason: string;
    /**
     * - Recorded runner hostname, when available.
     */
    runnerHostname: string | null;
    /**
     * - Liveness verdict.
     */
    status: BackgroundJobOwnerLivenessStatus;
};
/**
 * Liveness verdict for the process recorded on a background job.
 * @typedef {"alive" | "dead" | "unknown"} BackgroundJobOwnerLivenessStatus
 */
/**
 * Verdict describing whether the process that accepted a background job can
 * still be running.
 * @typedef {object} BackgroundJobOwnerLivenessResult
 * @property {string | null} childInstanceId - Recorded pooled-child identity, when available.
 * @property {number | null} childPid - Recorded OS pid, when available.
 * @property {string} reason - Machine-readable reason for the verdict.
 * @property {string | null} runnerHostname - Recorded runner hostname, when available.
 * @property {BackgroundJobOwnerLivenessStatus} status - Liveness verdict.
 */
/**
 * Probes a local pid without signalling the target process. `EPERM` means the
 * process exists but belongs to another user, so it counts as alive; `ESRCH`
 * means it is gone. Any other error is unexpected and is rethrown rather than
 * silently reported as "dead".
 * @param {number} pid - Process id to probe.
 * @returns {boolean} - Whether a process with that pid exists.
 */
export declare function isProcessAlive(pid: number): boolean;
/**
 * Evaluates whether the process recorded on a background job is still alive.
 *
 * Only the local host can be answered from a PID: when the job was accepted on
 * another machine the result is `unknown`, because liveness there needs a
 * heartbeat or instance registry rather than a local probe. A pid alone can be
 * recycled by the OS after a process exits, so treat `alive` as "a process with
 * that pid exists now", not proof that it is the same process; pair it with
 * `childStartedAtMs` when that distinction matters.
 * @param {object} [args] - Options.
 * @param {string | null} [args.childInstanceId] - Recorded pooled-child identity.
 * @param {number | null} [args.childPid] - Recorded OS pid.
 * @param {string} [args.currentHostname] - Hostname of this process, defaults to `os.hostname()`.
 * @param {(pid: number) => boolean} [args.probe] - Process probe, injectable for tests.
 * @param {string | null} [args.runnerHostname] - Hostname recorded with the job.
 * @returns {BackgroundJobOwnerLivenessResult} - Liveness verdict with its reason.
 */
export declare function evaluateBackgroundJobOwnerLiveness({ childInstanceId, childPid, currentHostname, probe, runnerHostname }?: {
    childInstanceId?: string | null;
    childPid?: number | null;
    currentHostname?: string;
    probe?: (pid: number) => boolean;
    runnerHostname?: string | null;
}): BackgroundJobOwnerLivenessResult;
//# sourceMappingURL=owner-liveness.d.ts.map