import BaseCommand from "../../../../cli/base-command.js";
import BackgroundJobsWorker from "../../../../background-jobs/worker.js";
import commandArguments from "../../../../cli/command-arguments.js";
/**
 * @typedef {object} BackgroundJobsWorkerSignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsWorkerSignalProcess} once - Registers one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsWorkerSignalProcess} removeListener - Removes one signal listener.
 */
/**
 * Owns process signals before publishing worker readiness.
 * @param {object} args - Shutdown ownership.
 * @param {() => void} args.onReady - Publishes readiness after listeners exist.
 * @param {BackgroundJobsWorkerSignalProcess} [args.processObject] - Signal emitter.
 * @param {number} [args.timeoutMs] - Optional worker drain timeout.
 * @param {{start: () => Promise<void>, stop: (args?: {timeoutMs?: number}) => Promise<void>, waitUntilStopped: () => Promise<void>}} args.worker - Worker lifecycle owner.
 * @returns {Promise<void>} - Resolves once the worker stops.
 */
export async function waitForBackgroundJobsWorkerShutdown({ onReady, processObject = process, timeoutMs, worker }) {
    /**
     * Resolves the signal wait.
     * @type {() => void}
     */
    let resolveSignal = () => { };
    const signal = new Promise((resolve) => { resolveSignal = () => resolve(undefined); });
    const onSignal = () => resolveSignal();
    processObject.once("SIGINT", onSignal);
    processObject.once("SIGTERM", onSignal);
    try {
        await worker.start();
        onReady();
        const stopped = worker.waitUntilStopped();
        const shutdownCause = await Promise.race([
            signal.then(() => "signal"),
            stopped.then(() => "stopped")
        ]);
        if (shutdownCause === "signal")
            await worker.stop({ timeoutMs });
    }
    finally {
        processObject.removeListener("SIGINT", onSignal);
        processObject.removeListener("SIGTERM", onSignal);
    }
}
/**
 * Resolves the shutdown drain timeout from
 * `VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS`:
 *   - unset / "indefinite" / "0" → indefinite: wait for in-flight jobs to
 *     finish and never kill a process runner. This is the default so a graceful
 *     stop (e.g. a deploy) does not interrupt long-running jobs such as builds.
 *   - positive integer → that many milliseconds, after which any process runner
 *     still in flight is terminated (SIGTERM, then SIGKILL) instead of orphaned.
 *
 * When a finite cap is used it must be shorter than the supervisor's
 * graceful-stop window so the worker reaps its own children before being
 * force-killed.
 * @returns {number | undefined} - Timeout in ms, or undefined for indefinite.
 */
function resolveShutdownTimeoutMs() {
    const raw = (process.env.VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS || "").trim().toLowerCase();
    if (!raw || raw === "indefinite" || raw === "0")
        return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
export default class BackgroundJobsWorkerCommand extends BaseCommand {
    async execute() {
        // Identify this process in `ps`/`top` instead of a generic "node" entry.
        process.title = "velocious background-jobs-worker";
        const args = commandArguments({ definition: { valueOptions: ["--generation"] }, processArgs: this.processArgs || [] });
        const worker = new BackgroundJobsWorker({
            configuration: this.getConfiguration(),
            generationId: typeof args.generation === "string" ? args.generation : undefined
        });
        const timeoutMs = resolveShutdownTimeoutMs();
        await waitForBackgroundJobsWorkerShutdown({
            onReady: () => console.log("Background jobs worker connected"),
            timeoutMs,
            worker
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC1qb2JzLXdvcmtlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9iYWNrZ3JvdW5kLWpvYnMtd29ya2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sV0FBVyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3pELE9BQU8sb0JBQW9CLE1BQU0sdUNBQXVDLENBQUE7QUFDeEUsT0FBTyxnQkFBZ0IsTUFBTSxzQ0FBc0MsQ0FBQTtBQUVuRTs7OztHQUlHO0FBRUg7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLG1DQUFtQyxDQUFDLEVBQUMsT0FBTyxFQUFFLGFBQWEsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBQztJQUM3Rzs7O09BR0c7SUFDSCxJQUFJLGFBQWEsR0FBRyxHQUFHLEVBQUUsR0FBRSxDQUFDLENBQUE7SUFDNUIsTUFBTSxNQUFNLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxHQUFHLGFBQWEsR0FBRyxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUEsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNyRixNQUFNLFFBQVEsR0FBRyxHQUFHLEVBQUUsQ0FBQyxhQUFhLEVBQUUsQ0FBQTtJQUV0QyxhQUFhLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUN0QyxhQUFhLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUV2QyxJQUFJLENBQUM7UUFDSCxNQUFNLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNwQixPQUFPLEVBQUUsQ0FBQTtRQUNULE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ3pDLE1BQU0sYUFBYSxHQUFHLE1BQU0sT0FBTyxDQUFDLElBQUksQ0FBQztZQUN2QyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLFFBQVEsQ0FBQztZQUMzQixPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQztTQUM5QixDQUFDLENBQUE7UUFFRixJQUFJLGFBQWEsS0FBSyxRQUFRO1lBQUUsTUFBTSxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUMsU0FBUyxFQUFDLENBQUMsQ0FBQTtJQUNoRSxDQUFDO1lBQVMsQ0FBQztRQUNULGFBQWEsQ0FBQyxjQUFjLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ2hELGFBQWEsQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFBO0lBQ25ELENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILFNBQVMsd0JBQXdCO0lBQy9CLE1BQU0sR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvREFBb0QsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQTtJQUV6RyxJQUFJLENBQUMsR0FBRyxJQUFJLEdBQUcsS0FBSyxZQUFZLElBQUksR0FBRyxLQUFLLEdBQUc7UUFBRSxPQUFPLFNBQVMsQ0FBQTtJQUVqRSxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUV2QyxPQUFPLE1BQU0sQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7QUFDcEUsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sMkJBQTRCLFNBQVEsV0FBVztJQUNsRSxLQUFLLENBQUMsT0FBTztRQUNYLHlFQUF5RTtRQUN6RSxPQUFPLENBQUMsS0FBSyxHQUFHLGtDQUFrQyxDQUFBO1FBRWxELE1BQU0sSUFBSSxHQUFHLGdCQUFnQixDQUFDLEVBQUMsVUFBVSxFQUFFLEVBQUMsWUFBWSxFQUFFLENBQUMsY0FBYyxDQUFDLEVBQUMsRUFBRSxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsSUFBSSxFQUFFLEVBQUMsQ0FBQyxDQUFBO1FBQ2xILE1BQU0sTUFBTSxHQUFHLElBQUksb0JBQW9CLENBQUM7WUFDdEMsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRTtZQUN0QyxZQUFZLEVBQUUsT0FBTyxJQUFJLENBQUMsVUFBVSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUNoRixDQUFDLENBQUE7UUFFRixNQUFNLFNBQVMsR0FBRyx3QkFBd0IsRUFBRSxDQUFBO1FBRTVDLE1BQU0sbUNBQW1DLENBQUM7WUFDeEMsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0NBQWtDLENBQUM7WUFDOUQsU0FBUztZQUNULE1BQU07U0FDUCxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzV29ya2VyIGZyb20gXCIuLi8uLi8uLi8uLi9iYWNrZ3JvdW5kLWpvYnMvd29ya2VyLmpzXCJcbmltcG9ydCBjb21tYW5kQXJndW1lbnRzIGZyb20gXCIuLi8uLi8uLi8uLi9jbGkvY29tbWFuZC1hcmd1bWVudHMuanNcIlxuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzV29ya2VyU2lnbmFsUHJvY2Vzc1xuICogQHByb3BlcnR5IHsoZXZlbnQ6IFwiU0lHSU5UXCIgfCBcIlNJR1RFUk1cIiwgbGlzdGVuZXI6ICgpID0+IHZvaWQpID0+IEJhY2tncm91bmRKb2JzV29ya2VyU2lnbmFsUHJvY2Vzc30gb25jZSAtIFJlZ2lzdGVycyBvbmUgc2lnbmFsIGxpc3RlbmVyLlxuICogQHByb3BlcnR5IHsoZXZlbnQ6IFwiU0lHSU5UXCIgfCBcIlNJR1RFUk1cIiwgbGlzdGVuZXI6ICgpID0+IHZvaWQpID0+IEJhY2tncm91bmRKb2JzV29ya2VyU2lnbmFsUHJvY2Vzc30gcmVtb3ZlTGlzdGVuZXIgLSBSZW1vdmVzIG9uZSBzaWduYWwgbGlzdGVuZXIuXG4gKi9cblxuLyoqXG4gKiBPd25zIHByb2Nlc3Mgc2lnbmFscyBiZWZvcmUgcHVibGlzaGluZyB3b3JrZXIgcmVhZGluZXNzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTaHV0ZG93biBvd25lcnNoaXAuXG4gKiBAcGFyYW0geygpID0+IHZvaWR9IGFyZ3Mub25SZWFkeSAtIFB1Ymxpc2hlcyByZWFkaW5lc3MgYWZ0ZXIgbGlzdGVuZXJzIGV4aXN0LlxuICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9ic1dvcmtlclNpZ25hbFByb2Nlc3N9IFthcmdzLnByb2Nlc3NPYmplY3RdIC0gU2lnbmFsIGVtaXR0ZXIuXG4gKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGltZW91dE1zXSAtIE9wdGlvbmFsIHdvcmtlciBkcmFpbiB0aW1lb3V0LlxuICogQHBhcmFtIHt7c3RhcnQ6ICgpID0+IFByb21pc2U8dm9pZD4sIHN0b3A6IChhcmdzPzoge3RpbWVvdXRNcz86IG51bWJlcn0pID0+IFByb21pc2U8dm9pZD4sIHdhaXRVbnRpbFN0b3BwZWQ6ICgpID0+IFByb21pc2U8dm9pZD59fSBhcmdzLndvcmtlciAtIFdvcmtlciBsaWZlY3ljbGUgb3duZXIuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHRoZSB3b3JrZXIgc3RvcHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yQmFja2dyb3VuZEpvYnNXb3JrZXJTaHV0ZG93bih7b25SZWFkeSwgcHJvY2Vzc09iamVjdCA9IHByb2Nlc3MsIHRpbWVvdXRNcywgd29ya2VyfSkge1xuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHNpZ25hbCB3YWl0LlxuICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICovXG4gIGxldCByZXNvbHZlU2lnbmFsID0gKCkgPT4ge31cbiAgY29uc3Qgc2lnbmFsID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgcmVzb2x2ZVNpZ25hbCA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSB9KVxuICBjb25zdCBvblNpZ25hbCA9ICgpID0+IHJlc29sdmVTaWduYWwoKVxuXG4gIHByb2Nlc3NPYmplY3Qub25jZShcIlNJR0lOVFwiLCBvblNpZ25hbClcbiAgcHJvY2Vzc09iamVjdC5vbmNlKFwiU0lHVEVSTVwiLCBvblNpZ25hbClcblxuICB0cnkge1xuICAgIGF3YWl0IHdvcmtlci5zdGFydCgpXG4gICAgb25SZWFkeSgpXG4gICAgY29uc3Qgc3RvcHBlZCA9IHdvcmtlci53YWl0VW50aWxTdG9wcGVkKClcbiAgICBjb25zdCBzaHV0ZG93bkNhdXNlID0gYXdhaXQgUHJvbWlzZS5yYWNlKFtcbiAgICAgIHNpZ25hbC50aGVuKCgpID0+IFwic2lnbmFsXCIpLFxuICAgICAgc3RvcHBlZC50aGVuKCgpID0+IFwic3RvcHBlZFwiKVxuICAgIF0pXG5cbiAgICBpZiAoc2h1dGRvd25DYXVzZSA9PT0gXCJzaWduYWxcIikgYXdhaXQgd29ya2VyLnN0b3Aoe3RpbWVvdXRNc30pXG4gIH0gZmluYWxseSB7XG4gICAgcHJvY2Vzc09iamVjdC5yZW1vdmVMaXN0ZW5lcihcIlNJR0lOVFwiLCBvblNpZ25hbClcbiAgICBwcm9jZXNzT2JqZWN0LnJlbW92ZUxpc3RlbmVyKFwiU0lHVEVSTVwiLCBvblNpZ25hbClcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBzaHV0ZG93biBkcmFpbiB0aW1lb3V0IGZyb21cbiAqIGBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1dPUktFUl9TSFVURE9XTl9USU1FT1VUX01TYDpcbiAqICAgLSB1bnNldCAvIFwiaW5kZWZpbml0ZVwiIC8gXCIwXCIg4oaSIGluZGVmaW5pdGU6IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIHRvXG4gKiAgICAgZmluaXNoIGFuZCBuZXZlciBraWxsIGEgcHJvY2VzcyBydW5uZXIuIFRoaXMgaXMgdGhlIGRlZmF1bHQgc28gYSBncmFjZWZ1bFxuICogICAgIHN0b3AgKGUuZy4gYSBkZXBsb3kpIGRvZXMgbm90IGludGVycnVwdCBsb25nLXJ1bm5pbmcgam9icyBzdWNoIGFzIGJ1aWxkcy5cbiAqICAgLSBwb3NpdGl2ZSBpbnRlZ2VyIOKGkiB0aGF0IG1hbnkgbWlsbGlzZWNvbmRzLCBhZnRlciB3aGljaCBhbnkgcHJvY2VzcyBydW5uZXJcbiAqICAgICBzdGlsbCBpbiBmbGlnaHQgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMKSBpbnN0ZWFkIG9mIG9ycGhhbmVkLlxuICpcbiAqIFdoZW4gYSBmaW5pdGUgY2FwIGlzIHVzZWQgaXQgbXVzdCBiZSBzaG9ydGVyIHRoYW4gdGhlIHN1cGVydmlzb3Inc1xuICogZ3JhY2VmdWwtc3RvcCB3aW5kb3cgc28gdGhlIHdvcmtlciByZWFwcyBpdHMgb3duIGNoaWxkcmVuIGJlZm9yZSBiZWluZ1xuICogZm9yY2Uta2lsbGVkLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaW1lb3V0IGluIG1zLCBvciB1bmRlZmluZWQgZm9yIGluZGVmaW5pdGUuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVTaHV0ZG93blRpbWVvdXRNcygpIHtcbiAgY29uc3QgcmF3ID0gKHByb2Nlc3MuZW52LlZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfV09SS0VSX1NIVVRET1dOX1RJTUVPVVRfTVMgfHwgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICBpZiAoIXJhdyB8fCByYXcgPT09IFwiaW5kZWZpbml0ZVwiIHx8IHJhdyA9PT0gXCIwXCIpIHJldHVybiB1bmRlZmluZWRcblxuICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQocmF3LCAxMClcblxuICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwYXJzZWQpICYmIHBhcnNlZCA+IDAgPyBwYXJzZWQgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNXb3JrZXJDb21tYW5kIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIC8vIElkZW50aWZ5IHRoaXMgcHJvY2VzcyBpbiBgcHNgL2B0b3BgIGluc3RlYWQgb2YgYSBnZW5lcmljIFwibm9kZVwiIGVudHJ5LlxuICAgIHByb2Nlc3MudGl0bGUgPSBcInZlbG9jaW91cyBiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJcblxuICAgIGNvbnN0IGFyZ3MgPSBjb21tYW5kQXJndW1lbnRzKHtkZWZpbml0aW9uOiB7dmFsdWVPcHRpb25zOiBbXCItLWdlbmVyYXRpb25cIl19LCBwcm9jZXNzQXJnczogdGhpcy5wcm9jZXNzQXJncyB8fCBbXX0pXG4gICAgY29uc3Qgd29ya2VyID0gbmV3IEJhY2tncm91bmRKb2JzV29ya2VyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0eXBlb2YgYXJncy5nZW5lcmF0aW9uID09PSBcInN0cmluZ1wiID8gYXJncy5nZW5lcmF0aW9uIDogdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIGNvbnN0IHRpbWVvdXRNcyA9IHJlc29sdmVTaHV0ZG93blRpbWVvdXRNcygpXG5cbiAgICBhd2FpdCB3YWl0Rm9yQmFja2dyb3VuZEpvYnNXb3JrZXJTaHV0ZG93bih7XG4gICAgICBvblJlYWR5OiAoKSA9PiBjb25zb2xlLmxvZyhcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29ubmVjdGVkXCIpLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgd29ya2VyXG4gICAgfSlcbiAgfVxufVxuIl19