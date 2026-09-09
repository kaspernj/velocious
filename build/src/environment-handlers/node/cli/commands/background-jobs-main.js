import BaseCommand from "../../../../cli/base-command.js";
import BackgroundJobsMain from "../../../../background-jobs/main.js";
import commandArguments from "../../../../cli/command-arguments.js";
/**
 * BackgroundJobsMainSignalProcess type.
 * @typedef {object} BackgroundJobsMainSignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsMainSignalProcess} once - Registers one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsMainSignalProcess} removeListener - Removes one signal listener.
 */
/**
 * BackgroundJobsMainShutdownOwner type.
 * @typedef {object} BackgroundJobsMainShutdownOwner
 * @property {() => Promise<void>} stop - Stops the main gracefully.
 * @property {() => Promise<void>} waitUntilStopped - Waits until the main has stopped.
 */
/**
 * Owns process shutdown signals before publishing the main's readiness boundary.
 * @param {object} args - Shutdown ownership options.
 * @param {BackgroundJobsMainShutdownOwner} args.main - Running background-jobs main.
 * @param {() => void} args.onReady - Publishes readiness after signal ownership exists.
 * @param {BackgroundJobsMainSignalProcess} [args.processObject] - Process-like signal emitter.
 * @returns {Promise<void>} - Resolves when the main stops.
 */
export async function waitForBackgroundJobsMainShutdown({ main, onReady, processObject = process }) {
    /**
     * Resolves the first process shutdown signal.
     * @type {() => void}
     */
    let resolveSignal = () => { };
    const signal = new Promise((resolve) => { resolveSignal = () => resolve(undefined); });
    /**
     * Resolves the shared shutdown signal once.
     * @returns {void} - Nothing.
     */
    const onSignal = () => resolveSignal();
    processObject.once("SIGINT", onSignal);
    processObject.once("SIGTERM", onSignal);
    const stopped = main.waitUntilStopped();
    try {
        onReady();
        const shutdownCause = await Promise.race([
            signal.then(() => "signal"),
            stopped.then(() => "stopped")
        ]);
        if (shutdownCause === "signal")
            await main.stop();
    }
    finally {
        processObject.removeListener("SIGINT", onSignal);
        processObject.removeListener("SIGTERM", onSignal);
    }
}
export default class BackgroundJobsMainCommand extends BaseCommand {
    async execute() {
        // Identify this process in `ps`/`top` instead of a generic "node" entry.
        process.title = "velocious background-jobs-main";
        const args = commandArguments({
            definition: { valueOptions: ["--generation", "--initial-generation-state", "--lifecycle-socket"] },
            processArgs: this.processArgs || []
        });
        const initialGenerationState = typeof args["initial-generation-state"] === "string"
            ? /** @type {import("../../../../background-jobs/types.js").BackgroundJobsGenerationInitialState} */ (args["initial-generation-state"])
            : undefined;
        const main = new BackgroundJobsMain({
            configuration: this.getConfiguration(),
            generationId: typeof args.generation === "string" ? args.generation : undefined,
            initialGenerationState,
            lifecycleSocketPath: typeof args["lifecycle-socket"] === "string" ? args["lifecycle-socket"] : undefined
        });
        await main.start();
        await waitForBackgroundJobsMainShutdown({
            main,
            onReady: () => console.log(`Background jobs main listening on ${main.host}:${main.getPort()}`)
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC1qb2JzLW1haW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZW52aXJvbm1lbnQtaGFuZGxlcnMvbm9kZS9jbGkvY29tbWFuZHMvYmFja2dyb3VuZC1qb2JzLW1haW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxXQUFXLE1BQU0saUNBQWlDLENBQUE7QUFDekQsT0FBTyxrQkFBa0IsTUFBTSxxQ0FBcUMsQ0FBQTtBQUNwRSxPQUFPLGdCQUFnQixNQUFNLHNDQUFzQyxDQUFBO0FBRW5FOzs7OztHQUtHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxpQ0FBaUMsQ0FBQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsYUFBYSxHQUFHLE9BQU8sRUFBQztJQUM5Rjs7O09BR0c7SUFDSCxJQUFJLGFBQWEsR0FBRyxHQUFHLEVBQUUsR0FBRSxDQUFDLENBQUE7SUFDNUIsTUFBTSxNQUFNLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxHQUFHLGFBQWEsR0FBRyxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUEsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUVyRjs7O09BR0c7SUFDSCxNQUFNLFFBQVEsR0FBRyxHQUFHLEVBQUUsQ0FBQyxhQUFhLEVBQUUsQ0FBQTtJQUV0QyxhQUFhLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUN0QyxhQUFhLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUN2QyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtJQUV2QyxJQUFJLENBQUM7UUFDSCxPQUFPLEVBQUUsQ0FBQTtRQUNULE1BQU0sYUFBYSxHQUFHLE1BQU0sT0FBTyxDQUFDLElBQUksQ0FBQztZQUN2QyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLFFBQVEsQ0FBQztZQUMzQixPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQztTQUM5QixDQUFDLENBQUE7UUFFRixJQUFJLGFBQWEsS0FBSyxRQUFRO1lBQUUsTUFBTSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDbkQsQ0FBQztZQUFTLENBQUM7UUFDVCxhQUFhLENBQUMsY0FBYyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUNoRCxhQUFhLENBQUMsY0FBYyxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUNuRCxDQUFDO0FBQ0gsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8seUJBQTBCLFNBQVEsV0FBVztJQUNoRSxLQUFLLENBQUMsT0FBTztRQUNYLHlFQUF5RTtRQUN6RSxPQUFPLENBQUMsS0FBSyxHQUFHLGdDQUFnQyxDQUFBO1FBRWhELE1BQU0sSUFBSSxHQUFHLGdCQUFnQixDQUFDO1lBQzVCLFVBQVUsRUFBRSxFQUFDLFlBQVksRUFBRSxDQUFDLGNBQWMsRUFBRSw0QkFBNEIsRUFBRSxvQkFBb0IsQ0FBQyxFQUFDO1lBQ2hHLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxJQUFJLEVBQUU7U0FDcEMsQ0FBQyxDQUFBO1FBQ0YsTUFBTSxzQkFBc0IsR0FBRyxPQUFPLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxLQUFLLFFBQVE7WUFDakYsQ0FBQyxDQUFDLGtHQUFrRyxDQUFDLENBQUMsSUFBSSxDQUFDLDBCQUEwQixDQUFDLENBQUM7WUFDdkksQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUNiLE1BQU0sSUFBSSxHQUFHLElBQUksa0JBQWtCLENBQUM7WUFDbEMsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRTtZQUN0QyxZQUFZLEVBQUUsT0FBTyxJQUFJLENBQUMsVUFBVSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUMvRSxzQkFBc0I7WUFDdEIsbUJBQW1CLEVBQUUsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1NBQ3pHLENBQUMsQ0FBQTtRQUNGLE1BQU0sSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRWxCLE1BQU0saUNBQWlDLENBQUM7WUFDdEMsSUFBSTtZQUNKLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxJQUFJLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDO1NBQy9GLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNNYWluIGZyb20gXCIuLi8uLi8uLi8uLi9iYWNrZ3JvdW5kLWpvYnMvbWFpbi5qc1wiXG5pbXBvcnQgY29tbWFuZEFyZ3VtZW50cyBmcm9tIFwiLi4vLi4vLi4vLi4vY2xpL2NvbW1hbmQtYXJndW1lbnRzLmpzXCJcblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9ic01haW5TaWduYWxQcm9jZXNzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic01haW5TaWduYWxQcm9jZXNzXG4gKiBAcHJvcGVydHkgeyhldmVudDogXCJTSUdJTlRcIiB8IFwiU0lHVEVSTVwiLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCkgPT4gQmFja2dyb3VuZEpvYnNNYWluU2lnbmFsUHJvY2Vzc30gb25jZSAtIFJlZ2lzdGVycyBvbmUgc2lnbmFsIGxpc3RlbmVyLlxuICogQHByb3BlcnR5IHsoZXZlbnQ6IFwiU0lHSU5UXCIgfCBcIlNJR1RFUk1cIiwgbGlzdGVuZXI6ICgpID0+IHZvaWQpID0+IEJhY2tncm91bmRKb2JzTWFpblNpZ25hbFByb2Nlc3N9IHJlbW92ZUxpc3RlbmVyIC0gUmVtb3ZlcyBvbmUgc2lnbmFsIGxpc3RlbmVyLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYnNNYWluU2h1dGRvd25Pd25lciB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNNYWluU2h1dGRvd25Pd25lclxuICogQHByb3BlcnR5IHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBzdG9wIC0gU3RvcHMgdGhlIG1haW4gZ3JhY2VmdWxseS5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gd2FpdFVudGlsU3RvcHBlZCAtIFdhaXRzIHVudGlsIHRoZSBtYWluIGhhcyBzdG9wcGVkLlxuICovXG5cbi8qKlxuICogT3ducyBwcm9jZXNzIHNodXRkb3duIHNpZ25hbHMgYmVmb3JlIHB1Ymxpc2hpbmcgdGhlIG1haW4ncyByZWFkaW5lc3MgYm91bmRhcnkuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNodXRkb3duIG93bmVyc2hpcCBvcHRpb25zLlxuICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9ic01haW5TaHV0ZG93bk93bmVyfSBhcmdzLm1haW4gLSBSdW5uaW5nIGJhY2tncm91bmQtam9icyBtYWluLlxuICogQHBhcmFtIHsoKSA9PiB2b2lkfSBhcmdzLm9uUmVhZHkgLSBQdWJsaXNoZXMgcmVhZGluZXNzIGFmdGVyIHNpZ25hbCBvd25lcnNoaXAgZXhpc3RzLlxuICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9ic01haW5TaWduYWxQcm9jZXNzfSBbYXJncy5wcm9jZXNzT2JqZWN0XSAtIFByb2Nlc3MtbGlrZSBzaWduYWwgZW1pdHRlci5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIG1haW4gc3RvcHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yQmFja2dyb3VuZEpvYnNNYWluU2h1dGRvd24oe21haW4sIG9uUmVhZHksIHByb2Nlc3NPYmplY3QgPSBwcm9jZXNzfSkge1xuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGZpcnN0IHByb2Nlc3Mgc2h1dGRvd24gc2lnbmFsLlxuICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICovXG4gIGxldCByZXNvbHZlU2lnbmFsID0gKCkgPT4ge31cbiAgY29uc3Qgc2lnbmFsID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgcmVzb2x2ZVNpZ25hbCA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSB9KVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc2hhcmVkIHNodXRkb3duIHNpZ25hbCBvbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBOb3RoaW5nLlxuICAgKi9cbiAgY29uc3Qgb25TaWduYWwgPSAoKSA9PiByZXNvbHZlU2lnbmFsKClcblxuICBwcm9jZXNzT2JqZWN0Lm9uY2UoXCJTSUdJTlRcIiwgb25TaWduYWwpXG4gIHByb2Nlc3NPYmplY3Qub25jZShcIlNJR1RFUk1cIiwgb25TaWduYWwpXG4gIGNvbnN0IHN0b3BwZWQgPSBtYWluLndhaXRVbnRpbFN0b3BwZWQoKVxuXG4gIHRyeSB7XG4gICAgb25SZWFkeSgpXG4gICAgY29uc3Qgc2h1dGRvd25DYXVzZSA9IGF3YWl0IFByb21pc2UucmFjZShbXG4gICAgICBzaWduYWwudGhlbigoKSA9PiBcInNpZ25hbFwiKSxcbiAgICAgIHN0b3BwZWQudGhlbigoKSA9PiBcInN0b3BwZWRcIilcbiAgICBdKVxuXG4gICAgaWYgKHNodXRkb3duQ2F1c2UgPT09IFwic2lnbmFsXCIpIGF3YWl0IG1haW4uc3RvcCgpXG4gIH0gZmluYWxseSB7XG4gICAgcHJvY2Vzc09iamVjdC5yZW1vdmVMaXN0ZW5lcihcIlNJR0lOVFwiLCBvblNpZ25hbClcbiAgICBwcm9jZXNzT2JqZWN0LnJlbW92ZUxpc3RlbmVyKFwiU0lHVEVSTVwiLCBvblNpZ25hbClcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic01haW5Db21tYW5kIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIC8vIElkZW50aWZ5IHRoaXMgcHJvY2VzcyBpbiBgcHNgL2B0b3BgIGluc3RlYWQgb2YgYSBnZW5lcmljIFwibm9kZVwiIGVudHJ5LlxuICAgIHByb2Nlc3MudGl0bGUgPSBcInZlbG9jaW91cyBiYWNrZ3JvdW5kLWpvYnMtbWFpblwiXG5cbiAgICBjb25zdCBhcmdzID0gY29tbWFuZEFyZ3VtZW50cyh7XG4gICAgICBkZWZpbml0aW9uOiB7dmFsdWVPcHRpb25zOiBbXCItLWdlbmVyYXRpb25cIiwgXCItLWluaXRpYWwtZ2VuZXJhdGlvbi1zdGF0ZVwiLCBcIi0tbGlmZWN5Y2xlLXNvY2tldFwiXX0sXG4gICAgICBwcm9jZXNzQXJnczogdGhpcy5wcm9jZXNzQXJncyB8fCBbXVxuICAgIH0pXG4gICAgY29uc3QgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSA9IHR5cGVvZiBhcmdzW1wiaW5pdGlhbC1nZW5lcmF0aW9uLXN0YXRlXCJdID09PSBcInN0cmluZ1wiXG4gICAgICA/IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZX0gKi8gKGFyZ3NbXCJpbml0aWFsLWdlbmVyYXRpb24tc3RhdGVcIl0pXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IG1haW4gPSBuZXcgQmFja2dyb3VuZEpvYnNNYWluKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0eXBlb2YgYXJncy5nZW5lcmF0aW9uID09PSBcInN0cmluZ1wiID8gYXJncy5nZW5lcmF0aW9uIDogdW5kZWZpbmVkLFxuICAgICAgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSxcbiAgICAgIGxpZmVjeWNsZVNvY2tldFBhdGg6IHR5cGVvZiBhcmdzW1wibGlmZWN5Y2xlLXNvY2tldFwiXSA9PT0gXCJzdHJpbmdcIiA/IGFyZ3NbXCJsaWZlY3ljbGUtc29ja2V0XCJdIDogdW5kZWZpbmVkXG4gICAgfSlcbiAgICBhd2FpdCBtYWluLnN0YXJ0KClcblxuICAgIGF3YWl0IHdhaXRGb3JCYWNrZ3JvdW5kSm9ic01haW5TaHV0ZG93bih7XG4gICAgICBtYWluLFxuICAgICAgb25SZWFkeTogKCkgPT4gY29uc29sZS5sb2coYEJhY2tncm91bmQgam9icyBtYWluIGxpc3RlbmluZyBvbiAke21haW4uaG9zdH06JHttYWluLmdldFBvcnQoKX1gKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==