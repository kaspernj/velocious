// @ts-check
import runJobPayload from "./job-runner.js";
import { closeRunnerConnections, currentConfigurationOrNull } from "./runner-graceful-shutdown.js";
import setRunnerProcessTitle from "./runner-process-title.js";
// Name the process so `ps`/`top`/`htop` can identify forked job runners at a
// glance instead of a wall of generic "node" entries. Updated to the specific
// job name once one arrives (see runJobMessage), so operators can see exactly
// which jobs are running, how many of each, and which are eating resources.
setRunnerProcessTitle();
/** @type {Promise<void> | undefined} */
let shutdownPromise;
/**
 * Closes the runner's connections — releasing any advisory lock a killed-mid-job
 * job still holds — before exiting on shutdown, instead of leaving a half-open
 * session that keeps the lock until the DB server's `wait_timeout`. Normal
 * completion (`finish`) already released its locks via the job's own lock scope.
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
 * Runs is job message.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is {type: "job", payload: import("./types.js").BackgroundJobPayload}} - Whether this is a job message.
 */
function isJobMessage(message) {
    if (!message || typeof message !== "object")
        return false;
    const messageRecord = /** @type {{type?: ReturnType<typeof JSON.parse>, payload?: ReturnType<typeof JSON.parse>}} */ (message);
    return messageRecord.type === "job" && Object.hasOwn(messageRecord, "payload");
}
/**
 * Runs finish.
 * @param {number} exitCode - Process exit code.
 * @returns {Promise<void>}
 */
async function finish(exitCode) {
    if (process.send) {
        await new Promise((resolve) => process.send?.({ type: "job-reported" }, () => resolve(undefined)));
    }
    await shutdownRunner(exitCode);
}
/**
 * Runs run job message.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {Promise<void>} - Resolves after the payload has run.
 */
async function runJobMessage(message) {
    if (!isJobMessage(message)) {
        throw new Error("Forked background job runner received invalid payload");
    }
    // The per-job process title (and its restore) is set inside runJobPayload,
    // which reads the job class's `static processTitle`. This process boots with
    // the base "velocious background-jobs-runner" title set at module load above.
    await runJobPayload(message.payload, {
        closeConnections: false,
        processType: "background-jobs-forked-runner"
    });
}
/**
 * Runs handle job message.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {Promise<void>} - Resolves after completion is reported.
 */
async function handleJobMessage(message) {
    let exitCode;
    try {
        await runJobMessage(message);
        exitCode = 0;
    }
    catch (error) {
        console.error("Forked background job runner failed:", error);
        exitCode = 1;
    }
    await finish(exitCode);
}
for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => void shutdownRunner(1));
}
process.once("disconnect", () => {
    void shutdownRunner(0);
});
process.once("message", (message) => {
    void handleJobMessage(message);
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZm9ya2VkLXJ1bm5lci1jaGlsZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvZm9ya2VkLXJ1bm5lci1jaGlsZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0saUJBQWlCLENBQUE7QUFDM0MsT0FBTyxFQUFFLHNCQUFzQixFQUFFLDBCQUEwQixFQUFFLE1BQU0sK0JBQStCLENBQUE7QUFDbEcsT0FBTyxxQkFBcUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUU3RCw2RUFBNkU7QUFDN0UsOEVBQThFO0FBQzlFLDhFQUE4RTtBQUM5RSw0RUFBNEU7QUFDNUUscUJBQXFCLEVBQUUsQ0FBQTtBQUV2Qix3Q0FBd0M7QUFDeEMsSUFBSSxlQUFlLENBQUE7QUFFbkI7Ozs7Ozs7R0FPRztBQUNILFNBQVMsY0FBYyxDQUFDLFFBQVE7SUFDOUIsSUFBSSxlQUFlO1FBQUUsT0FBTyxlQUFlLENBQUE7SUFFM0MsZUFBZSxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDNUIsTUFBTSxzQkFBc0IsQ0FBQywwQkFBMEIsRUFBRSxDQUFDLENBQUE7UUFDMUQsT0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUN4QixDQUFDLENBQUMsRUFBRSxDQUFBO0lBRUosT0FBTyxlQUFlLENBQUE7QUFDeEIsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLFlBQVksQ0FBQyxPQUFPO0lBQzNCLElBQUksQ0FBQyxPQUFPLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUTtRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRXpELE1BQU0sYUFBYSxHQUFHLDhGQUE4RixDQUFDLENBQUMsT0FBTyxDQUFDLENBQUE7SUFFOUgsT0FBTyxhQUFhLENBQUMsSUFBSSxLQUFLLEtBQUssSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsQ0FBQTtBQUNoRixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxNQUFNLENBQUMsUUFBUTtJQUM1QixJQUFJLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNqQixNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUMsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFDLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNsRyxDQUFDO0lBQ0QsTUFBTSxjQUFjLENBQUMsUUFBUSxDQUFDLENBQUE7QUFDaEMsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxLQUFLLFVBQVUsYUFBYSxDQUFDLE9BQU87SUFDbEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQzNCLE1BQU0sSUFBSSxLQUFLLENBQUMsdURBQXVELENBQUMsQ0FBQTtJQUMxRSxDQUFDO0lBRUQsMkVBQTJFO0lBQzNFLDZFQUE2RTtJQUM3RSw4RUFBOEU7SUFDOUUsTUFBTSxhQUFhLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRTtRQUNuQyxnQkFBZ0IsRUFBRSxLQUFLO1FBQ3ZCLFdBQVcsRUFBRSwrQkFBK0I7S0FDN0MsQ0FBQyxDQUFBO0FBQ0osQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxLQUFLLFVBQVUsZ0JBQWdCLENBQUMsT0FBTztJQUNyQyxJQUFJLFFBQVEsQ0FBQTtJQUVaLElBQUksQ0FBQztRQUNILE1BQU0sYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQzVCLFFBQVEsR0FBRyxDQUFDLENBQUE7SUFDZCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsc0NBQXNDLEVBQUUsS0FBSyxDQUFDLENBQUE7UUFDNUQsUUFBUSxHQUFHLENBQUMsQ0FBQTtJQUNkLENBQUM7SUFFRCxNQUFNLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtBQUN4QixDQUFDO0FBRUQsS0FBSyxNQUFNLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsRUFBRSxDQUFDO0lBQzNDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDLEtBQUssY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7QUFDcEQsQ0FBQztBQUVELE9BQU8sQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLEdBQUcsRUFBRTtJQUM5QixLQUFLLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUN4QixDQUFDLENBQUMsQ0FBQTtBQUVGLE9BQU8sQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUU7SUFDbEMsS0FBSyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQTtBQUNoQyxDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcnVuSm9iUGF5bG9hZCBmcm9tIFwiLi9qb2ItcnVubmVyLmpzXCJcbmltcG9ydCB7IGNsb3NlUnVubmVyQ29ubmVjdGlvbnMsIGN1cnJlbnRDb25maWd1cmF0aW9uT3JOdWxsIH0gZnJvbSBcIi4vcnVubmVyLWdyYWNlZnVsLXNodXRkb3duLmpzXCJcbmltcG9ydCBzZXRSdW5uZXJQcm9jZXNzVGl0bGUgZnJvbSBcIi4vcnVubmVyLXByb2Nlc3MtdGl0bGUuanNcIlxuXG4vLyBOYW1lIHRoZSBwcm9jZXNzIHNvIGBwc2AvYHRvcGAvYGh0b3BgIGNhbiBpZGVudGlmeSBmb3JrZWQgam9iIHJ1bm5lcnMgYXQgYVxuLy8gZ2xhbmNlIGluc3RlYWQgb2YgYSB3YWxsIG9mIGdlbmVyaWMgXCJub2RlXCIgZW50cmllcy4gVXBkYXRlZCB0byB0aGUgc3BlY2lmaWNcbi8vIGpvYiBuYW1lIG9uY2Ugb25lIGFycml2ZXMgKHNlZSBydW5Kb2JNZXNzYWdlKSwgc28gb3BlcmF0b3JzIGNhbiBzZWUgZXhhY3RseVxuLy8gd2hpY2ggam9icyBhcmUgcnVubmluZywgaG93IG1hbnkgb2YgZWFjaCwgYW5kIHdoaWNoIGFyZSBlYXRpbmcgcmVzb3VyY2VzLlxuc2V0UnVubmVyUHJvY2Vzc1RpdGxlKClcblxuLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xubGV0IHNodXRkb3duUHJvbWlzZVxuXG4vKipcbiAqIENsb3NlcyB0aGUgcnVubmVyJ3MgY29ubmVjdGlvbnMg4oCUIHJlbGVhc2luZyBhbnkgYWR2aXNvcnkgbG9jayBhIGtpbGxlZC1taWQtam9iXG4gKiBqb2Igc3RpbGwgaG9sZHMg4oCUIGJlZm9yZSBleGl0aW5nIG9uIHNodXRkb3duLCBpbnN0ZWFkIG9mIGxlYXZpbmcgYSBoYWxmLW9wZW5cbiAqIHNlc3Npb24gdGhhdCBrZWVwcyB0aGUgbG9jayB1bnRpbCB0aGUgREIgc2VydmVyJ3MgYHdhaXRfdGltZW91dGAuIE5vcm1hbFxuICogY29tcGxldGlvbiAoYGZpbmlzaGApIGFscmVhZHkgcmVsZWFzZWQgaXRzIGxvY2tzIHZpYSB0aGUgam9iJ3Mgb3duIGxvY2sgc2NvcGUuXG4gKiBAcGFyYW0ge251bWJlcn0gZXhpdENvZGUgLSBQcm9jZXNzIGV4aXQgY29kZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5mdW5jdGlvbiBzaHV0ZG93blJ1bm5lcihleGl0Q29kZSkge1xuICBpZiAoc2h1dGRvd25Qcm9taXNlKSByZXR1cm4gc2h1dGRvd25Qcm9taXNlXG5cbiAgc2h1dGRvd25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBjbG9zZVJ1bm5lckNvbm5lY3Rpb25zKGN1cnJlbnRDb25maWd1cmF0aW9uT3JOdWxsKCkpXG4gICAgcHJvY2Vzcy5leGl0KGV4aXRDb2RlKVxuICB9KSgpXG5cbiAgcmV0dXJuIHNodXRkb3duUHJvbWlzZVxufVxuXG4vKipcbiAqIFJ1bnMgaXMgam9iIG1lc3NhZ2UuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyB7dHlwZTogXCJqb2JcIiwgcGF5bG9hZDogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH19IC0gV2hldGhlciB0aGlzIGlzIGEgam9iIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIGlzSm9iTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3QgbWVzc2FnZVJlY29yZCA9IC8qKiBAdHlwZSB7e3R5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcGF5bG9hZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKG1lc3NhZ2UpXG5cbiAgcmV0dXJuIG1lc3NhZ2VSZWNvcmQudHlwZSA9PT0gXCJqb2JcIiAmJiBPYmplY3QuaGFzT3duKG1lc3NhZ2VSZWNvcmQsIFwicGF5bG9hZFwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZmluaXNoLlxuICogQHBhcmFtIHtudW1iZXJ9IGV4aXRDb2RlIC0gUHJvY2VzcyBleGl0IGNvZGUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmluaXNoKGV4aXRDb2RlKSB7XG4gIGlmIChwcm9jZXNzLnNlbmQpIHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gcHJvY2Vzcy5zZW5kPy4oe3R5cGU6IFwiam9iLXJlcG9ydGVkXCJ9LCAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuICB9XG4gIGF3YWl0IHNodXRkb3duUnVubmVyKGV4aXRDb2RlKVxufVxuXG4vKipcbiAqIFJ1bnMgcnVuIGpvYiBtZXNzYWdlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHBheWxvYWQgaGFzIHJ1bi5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcnVuSm9iTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghaXNKb2JNZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciByZWNlaXZlZCBpbnZhbGlkIHBheWxvYWRcIilcbiAgfVxuXG4gIC8vIFRoZSBwZXItam9iIHByb2Nlc3MgdGl0bGUgKGFuZCBpdHMgcmVzdG9yZSkgaXMgc2V0IGluc2lkZSBydW5Kb2JQYXlsb2FkLFxuICAvLyB3aGljaCByZWFkcyB0aGUgam9iIGNsYXNzJ3MgYHN0YXRpYyBwcm9jZXNzVGl0bGVgLiBUaGlzIHByb2Nlc3MgYm9vdHMgd2l0aFxuICAvLyB0aGUgYmFzZSBcInZlbG9jaW91cyBiYWNrZ3JvdW5kLWpvYnMtcnVubmVyXCIgdGl0bGUgc2V0IGF0IG1vZHVsZSBsb2FkIGFib3ZlLlxuICBhd2FpdCBydW5Kb2JQYXlsb2FkKG1lc3NhZ2UucGF5bG9hZCwge1xuICAgIGNsb3NlQ29ubmVjdGlvbnM6IGZhbHNlLFxuICAgIHByb2Nlc3NUeXBlOiBcImJhY2tncm91bmQtam9icy1mb3JrZWQtcnVubmVyXCJcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGhhbmRsZSBqb2IgbWVzc2FnZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNvbXBsZXRpb24gaXMgcmVwb3J0ZWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUpvYk1lc3NhZ2UobWVzc2FnZSkge1xuICBsZXQgZXhpdENvZGVcblxuICB0cnkge1xuICAgIGF3YWl0IHJ1bkpvYk1lc3NhZ2UobWVzc2FnZSlcbiAgICBleGl0Q29kZSA9IDBcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciBmYWlsZWQ6XCIsIGVycm9yKVxuICAgIGV4aXRDb2RlID0gMVxuICB9XG5cbiAgYXdhaXQgZmluaXNoKGV4aXRDb2RlKVxufVxuXG5mb3IgKGNvbnN0IHNpZ25hbCBvZiBbXCJTSUdURVJNXCIsIFwiU0lHSU5UXCJdKSB7XG4gIHByb2Nlc3Mub25jZShzaWduYWwsICgpID0+IHZvaWQgc2h1dGRvd25SdW5uZXIoMSkpXG59XG5cbnByb2Nlc3Mub25jZShcImRpc2Nvbm5lY3RcIiwgKCkgPT4ge1xuICB2b2lkIHNodXRkb3duUnVubmVyKDApXG59KVxuXG5wcm9jZXNzLm9uY2UoXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiB7XG4gIHZvaWQgaGFuZGxlSm9iTWVzc2FnZShtZXNzYWdlKVxufSlcbiJdfQ==