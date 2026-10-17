// @ts-check
import os from "node:os";
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
export function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        const code = /** @type {{code?: string}} */ (error).code;
        if (code === "EPERM")
            return true;
        if (code === "ESRCH")
            return false;
        throw error;
    }
}
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
export function evaluateBackgroundJobOwnerLiveness({ childInstanceId = null, childPid = null, currentHostname = os.hostname(), probe = isProcessAlive, runnerHostname = null } = {}) {
    const owner = {
        childInstanceId: typeof childInstanceId === "string" ? childInstanceId : null,
        childPid: typeof childPid === "number" ? childPid : null,
        runnerHostname: typeof runnerHostname === "string" ? runnerHostname : null
    };
    if (!owner.runnerHostname) {
        return { ...owner, reason: "runner_hostname_unrecorded", status: "unknown" };
    }
    if (owner.runnerHostname !== currentHostname) {
        return { ...owner, reason: "remote_runner_host", status: "unknown" };
    }
    if (!Number.isInteger(owner.childPid) || owner.childPid === null || owner.childPid <= 0) {
        return { ...owner, reason: "child_pid_unrecorded", status: "unknown" };
    }
    const probedPid = /** @type {number} */ (owner.childPid);
    return probe(probedPid)
        ? { ...owner, reason: "local_pid_alive", status: "alive" }
        : { ...owner, reason: "local_pid_missing", status: "dead" };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3duZXItbGl2ZW5lc3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL293bmVyLWxpdmVuZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFFeEI7OztHQUdHO0FBRUg7Ozs7Ozs7OztHQVNHO0FBRUg7Ozs7Ozs7R0FPRztBQUNILE1BQU0sVUFBVSxjQUFjLENBQUMsR0FBRztJQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRXBELElBQUksQ0FBQztRQUNILE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFBO1FBQ3BCLE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixNQUFNLElBQUksR0FBRyw4QkFBOEIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUV4RCxJQUFJLElBQUksS0FBSyxPQUFPO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDakMsSUFBSSxJQUFJLEtBQUssT0FBTztZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRWxDLE1BQU0sS0FBSyxDQUFBO0lBQ2IsQ0FBQztBQUNILENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILE1BQU0sVUFBVSxrQ0FBa0MsQ0FBQyxFQUNqRCxlQUFlLEdBQUcsSUFBSSxFQUN0QixRQUFRLEdBQUcsSUFBSSxFQUNmLGVBQWUsR0FBRyxFQUFFLENBQUMsUUFBUSxFQUFFLEVBQy9CLEtBQUssR0FBRyxjQUFjLEVBQ3RCLGNBQWMsR0FBRyxJQUFJLEVBQ3RCLEdBQUcsRUFBRTtJQUNKLE1BQU0sS0FBSyxHQUFHO1FBQ1osZUFBZSxFQUFFLE9BQU8sZUFBZSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxJQUFJO1FBQzdFLFFBQVEsRUFBRSxPQUFPLFFBQVEsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSTtRQUN4RCxjQUFjLEVBQUUsT0FBTyxjQUFjLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLElBQUk7S0FDM0UsQ0FBQTtJQUVELElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDMUIsT0FBTyxFQUFDLEdBQUcsS0FBSyxFQUFFLE1BQU0sRUFBRSw0QkFBNEIsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDLENBQUE7SUFDNUUsQ0FBQztJQUVELElBQUksS0FBSyxDQUFDLGNBQWMsS0FBSyxlQUFlLEVBQUUsQ0FBQztRQUM3QyxPQUFPLEVBQUMsR0FBRyxLQUFLLEVBQUUsTUFBTSxFQUFFLG9CQUFvQixFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUMsQ0FBQTtJQUNwRSxDQUFDO0lBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEtBQUssQ0FBQyxRQUFRLEtBQUssSUFBSSxJQUFJLEtBQUssQ0FBQyxRQUFRLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDeEYsT0FBTyxFQUFDLEdBQUcsS0FBSyxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDLENBQUE7SUFDdEUsQ0FBQztJQUVELE1BQU0sU0FBUyxHQUFHLHFCQUFxQixDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRXhELE9BQU8sS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUNyQixDQUFDLENBQUMsRUFBQyxHQUFHLEtBQUssRUFBRSxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBQztRQUN4RCxDQUFDLENBQUMsRUFBQyxHQUFHLEtBQUssRUFBRSxNQUFNLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBQyxDQUFBO0FBQzdELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IG9zIGZyb20gXCJub2RlOm9zXCJcblxuLyoqXG4gKiBMaXZlbmVzcyB2ZXJkaWN0IGZvciB0aGUgcHJvY2VzcyByZWNvcmRlZCBvbiBhIGJhY2tncm91bmQgam9iLlxuICogQHR5cGVkZWYge1wiYWxpdmVcIiB8IFwiZGVhZFwiIHwgXCJ1bmtub3duXCJ9IEJhY2tncm91bmRKb2JPd25lckxpdmVuZXNzU3RhdHVzXG4gKi9cblxuLyoqXG4gKiBWZXJkaWN0IGRlc2NyaWJpbmcgd2hldGhlciB0aGUgcHJvY2VzcyB0aGF0IGFjY2VwdGVkIGEgYmFja2dyb3VuZCBqb2IgY2FuXG4gKiBzdGlsbCBiZSBydW5uaW5nLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYk93bmVyTGl2ZW5lc3NSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gY2hpbGRJbnN0YW5jZUlkIC0gUmVjb3JkZWQgcG9vbGVkLWNoaWxkIGlkZW50aXR5LCB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY2hpbGRQaWQgLSBSZWNvcmRlZCBPUyBwaWQsIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlYXNvbiAtIE1hY2hpbmUtcmVhZGFibGUgcmVhc29uIGZvciB0aGUgdmVyZGljdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcnVubmVySG9zdG5hbWUgLSBSZWNvcmRlZCBydW5uZXIgaG9zdG5hbWUsIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3duZXJMaXZlbmVzc1N0YXR1c30gc3RhdHVzIC0gTGl2ZW5lc3MgdmVyZGljdC5cbiAqL1xuXG4vKipcbiAqIFByb2JlcyBhIGxvY2FsIHBpZCB3aXRob3V0IHNpZ25hbGxpbmcgdGhlIHRhcmdldCBwcm9jZXNzLiBgRVBFUk1gIG1lYW5zIHRoZVxuICogcHJvY2VzcyBleGlzdHMgYnV0IGJlbG9uZ3MgdG8gYW5vdGhlciB1c2VyLCBzbyBpdCBjb3VudHMgYXMgYWxpdmU7IGBFU1JDSGBcbiAqIG1lYW5zIGl0IGlzIGdvbmUuIEFueSBvdGhlciBlcnJvciBpcyB1bmV4cGVjdGVkIGFuZCBpcyByZXRocm93biByYXRoZXIgdGhhblxuICogc2lsZW50bHkgcmVwb3J0ZWQgYXMgXCJkZWFkXCIuXG4gKiBAcGFyYW0ge251bWJlcn0gcGlkIC0gUHJvY2VzcyBpZCB0byBwcm9iZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYSBwcm9jZXNzIHdpdGggdGhhdCBwaWQgZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNQcm9jZXNzQWxpdmUocGlkKSB7XG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcihwaWQpIHx8IHBpZCA8PSAwKSByZXR1cm4gZmFsc2VcblxuICB0cnkge1xuICAgIHByb2Nlc3Mua2lsbChwaWQsIDApXG4gICAgcmV0dXJuIHRydWVcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zdCBjb2RlID0gLyoqIEB0eXBlIHt7Y29kZT86IHN0cmluZ319ICovIChlcnJvcikuY29kZVxuXG4gICAgaWYgKGNvZGUgPT09IFwiRVBFUk1cIikgcmV0dXJuIHRydWVcbiAgICBpZiAoY29kZSA9PT0gXCJFU1JDSFwiKSByZXR1cm4gZmFsc2VcblxuICAgIHRocm93IGVycm9yXG4gIH1cbn1cblxuLyoqXG4gKiBFdmFsdWF0ZXMgd2hldGhlciB0aGUgcHJvY2VzcyByZWNvcmRlZCBvbiBhIGJhY2tncm91bmQgam9iIGlzIHN0aWxsIGFsaXZlLlxuICpcbiAqIE9ubHkgdGhlIGxvY2FsIGhvc3QgY2FuIGJlIGFuc3dlcmVkIGZyb20gYSBQSUQ6IHdoZW4gdGhlIGpvYiB3YXMgYWNjZXB0ZWQgb25cbiAqIGFub3RoZXIgbWFjaGluZSB0aGUgcmVzdWx0IGlzIGB1bmtub3duYCwgYmVjYXVzZSBsaXZlbmVzcyB0aGVyZSBuZWVkcyBhXG4gKiBoZWFydGJlYXQgb3IgaW5zdGFuY2UgcmVnaXN0cnkgcmF0aGVyIHRoYW4gYSBsb2NhbCBwcm9iZS4gQSBwaWQgYWxvbmUgY2FuIGJlXG4gKiByZWN5Y2xlZCBieSB0aGUgT1MgYWZ0ZXIgYSBwcm9jZXNzIGV4aXRzLCBzbyB0cmVhdCBgYWxpdmVgIGFzIFwiYSBwcm9jZXNzIHdpdGhcbiAqIHRoYXQgcGlkIGV4aXN0cyBub3dcIiwgbm90IHByb29mIHRoYXQgaXQgaXMgdGhlIHNhbWUgcHJvY2VzczsgcGFpciBpdCB3aXRoXG4gKiBgY2hpbGRTdGFydGVkQXRNc2Agd2hlbiB0aGF0IGRpc3RpbmN0aW9uIG1hdHRlcnMuXG4gKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3MuY2hpbGRJbnN0YW5jZUlkXSAtIFJlY29yZGVkIHBvb2xlZC1jaGlsZCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuY2hpbGRQaWRdIC0gUmVjb3JkZWQgT1MgcGlkLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmN1cnJlbnRIb3N0bmFtZV0gLSBIb3N0bmFtZSBvZiB0aGlzIHByb2Nlc3MsIGRlZmF1bHRzIHRvIGBvcy5ob3N0bmFtZSgpYC5cbiAqIEBwYXJhbSB7KHBpZDogbnVtYmVyKSA9PiBib29sZWFufSBbYXJncy5wcm9iZV0gLSBQcm9jZXNzIHByb2JlLCBpbmplY3RhYmxlIGZvciB0ZXN0cy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3MucnVubmVySG9zdG5hbWVdIC0gSG9zdG5hbWUgcmVjb3JkZWQgd2l0aCB0aGUgam9iLlxuICogQHJldHVybnMge0JhY2tncm91bmRKb2JPd25lckxpdmVuZXNzUmVzdWx0fSAtIExpdmVuZXNzIHZlcmRpY3Qgd2l0aCBpdHMgcmVhc29uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXZhbHVhdGVCYWNrZ3JvdW5kSm9iT3duZXJMaXZlbmVzcyh7XG4gIGNoaWxkSW5zdGFuY2VJZCA9IG51bGwsXG4gIGNoaWxkUGlkID0gbnVsbCxcbiAgY3VycmVudEhvc3RuYW1lID0gb3MuaG9zdG5hbWUoKSxcbiAgcHJvYmUgPSBpc1Byb2Nlc3NBbGl2ZSxcbiAgcnVubmVySG9zdG5hbWUgPSBudWxsXG59ID0ge30pIHtcbiAgY29uc3Qgb3duZXIgPSB7XG4gICAgY2hpbGRJbnN0YW5jZUlkOiB0eXBlb2YgY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiID8gY2hpbGRJbnN0YW5jZUlkIDogbnVsbCxcbiAgICBjaGlsZFBpZDogdHlwZW9mIGNoaWxkUGlkID09PSBcIm51bWJlclwiID8gY2hpbGRQaWQgOiBudWxsLFxuICAgIHJ1bm5lckhvc3RuYW1lOiB0eXBlb2YgcnVubmVySG9zdG5hbWUgPT09IFwic3RyaW5nXCIgPyBydW5uZXJIb3N0bmFtZSA6IG51bGxcbiAgfVxuXG4gIGlmICghb3duZXIucnVubmVySG9zdG5hbWUpIHtcbiAgICByZXR1cm4gey4uLm93bmVyLCByZWFzb246IFwicnVubmVyX2hvc3RuYW1lX3VucmVjb3JkZWRcIiwgc3RhdHVzOiBcInVua25vd25cIn1cbiAgfVxuXG4gIGlmIChvd25lci5ydW5uZXJIb3N0bmFtZSAhPT0gY3VycmVudEhvc3RuYW1lKSB7XG4gICAgcmV0dXJuIHsuLi5vd25lciwgcmVhc29uOiBcInJlbW90ZV9ydW5uZXJfaG9zdFwiLCBzdGF0dXM6IFwidW5rbm93blwifVxuICB9XG5cbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKG93bmVyLmNoaWxkUGlkKSB8fCBvd25lci5jaGlsZFBpZCA9PT0gbnVsbCB8fCBvd25lci5jaGlsZFBpZCA8PSAwKSB7XG4gICAgcmV0dXJuIHsuLi5vd25lciwgcmVhc29uOiBcImNoaWxkX3BpZF91bnJlY29yZGVkXCIsIHN0YXR1czogXCJ1bmtub3duXCJ9XG4gIH1cblxuICBjb25zdCBwcm9iZWRQaWQgPSAvKiogQHR5cGUge251bWJlcn0gKi8gKG93bmVyLmNoaWxkUGlkKVxuXG4gIHJldHVybiBwcm9iZShwcm9iZWRQaWQpXG4gICAgPyB7Li4ub3duZXIsIHJlYXNvbjogXCJsb2NhbF9waWRfYWxpdmVcIiwgc3RhdHVzOiBcImFsaXZlXCJ9XG4gICAgOiB7Li4ub3duZXIsIHJlYXNvbjogXCJsb2NhbF9waWRfbWlzc2luZ1wiLCBzdGF0dXM6IFwiZGVhZFwifVxufVxuIl19