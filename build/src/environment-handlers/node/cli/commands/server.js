import Application from "../../../../application.js";
import BaseCommand from "../../../../cli/base-command.js";
/**
 * SignalProcess type.
 * @typedef {object} SignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => SignalProcess} once - Register one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => SignalProcess} removeListener - Remove one signal listener.
 */
/**
 * SignalShutdownApplication type.
 * @typedef {object} SignalShutdownApplication
 * @property {() => Promise<void>} stop - Stop the application gracefully.
 * @property {() => Promise<void>} wait - Wait until the application closes.
 */
/**
 * Waits for the HTTP application to close, stopping it gracefully when the
 * process receives SIGINT or SIGTERM.
 * @param {object} args - Wait options.
 * @param {SignalShutdownApplication} args.application - Running application.
 * @param {SignalProcess} [args.processObject] - Process-like signal emitter.
 * @returns {Promise<void>} - Resolves when the application has stopped.
 */
export function waitForApplicationWithSignalShutdown({ application, processObject = process }) {
    return new Promise((resolve, reject) => {
        let finished = false;
        let stopping = false;
        /**
         * Cleanup.
         * @returns {void} - Remove installed signal handlers.
         */
        const cleanup = () => {
            processObject.removeListener("SIGINT", onSignal);
            processObject.removeListener("SIGTERM", onSignal);
        };
        /**
         * Completes the wait promise once.
         * @param {ReturnType<typeof JSON.parse>} [error] - Optional rejection reason.
         * @returns {void}
         */
        const finish = (error) => {
            if (finished)
                return;
            finished = true;
            cleanup();
            if (error) {
                reject(error);
            }
            else {
                resolve(undefined);
            }
        };
        /**
         * Stop application.
         * @returns {Promise<void>} - Stops the application once.
         */
        const stopApplication = async () => {
            if (stopping || finished)
                return;
            stopping = true;
            try {
                await application.stop();
                finish();
            }
            catch (error) {
                finish(error);
            }
        };
        /**
         * On signal.
         * @returns {void} - Handles one shutdown signal.
         */
        const onSignal = () => {
            void stopApplication();
        };
        processObject.once("SIGINT", onSignal);
        processObject.once("SIGTERM", onSignal);
        application.wait().then(() => {
            if (!stopping)
                finish();
        }).catch((error) => finish(error));
    });
}
/**
 * Runs first configured value.
 * @template T
 * @param {...(T | undefined)} values - Candidate values in priority order.
 * @returns {T | undefined} - First configured value.
 */
function firstConfiguredValue(...values) {
    return values.find((value) => value !== undefined);
}
/**
 * Runs http server workers from arg.
 * @param {string | number | boolean | undefined} workersArg - Worker count argument.
 * @returns {number | undefined} - Normalized worker count.
 */
function httpServerWorkersFromArg(workersArg) {
    if (workersArg === undefined)
        return undefined;
    if (typeof workersArg === "boolean")
        throw new Error("--workers must be a positive integer");
    const workers = Number(workersArg);
    if (!Number.isInteger(workers) || workers < 1)
        throw new Error("--workers must be a positive integer");
    return workers;
}
/**
 * Runs the httpServerConfigFromParsedArgs helper.
 * @param {Record<string, string | number | boolean | undefined>} parsedProcessArgs - Parsed CLI args.
 * @param {import("../../../../configuration-types.js").HttpServerConfiguration} [defaults] - Default HTTP server config.
 * @returns {{host: string, port: number, workers?: number}} - HTTP server config.
 */
export function httpServerConfigFromParsedArgs(parsedProcessArgs = {}, defaults = {}) {
    const host = String(firstConfiguredValue(parsedProcessArgs.h, parsedProcessArgs.host, defaults.host, "127.0.0.1"));
    const port = Number(firstConfiguredValue(parsedProcessArgs.p, parsedProcessArgs.port, defaults.port, 3006));
    const workers = httpServerWorkersFromArg(firstConfiguredValue(parsedProcessArgs.workers, defaults.workers));
    if (workers === undefined)
        return { host, port };
    return { host, port, workers };
}
export default class VelociousCliCommandsServer extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void>} - Starts the HTTP server and waits until it stops.
     */
    async execute() {
        // Identify this process in `ps`/`top` instead of a generic "node" entry.
        process.title = "velocious server";
        const parsedProcessArgs = this.args?.parsedProcessArgs || {};
        const configuration = this.getConfiguration();
        const httpServer = httpServerConfigFromParsedArgs(parsedProcessArgs, configuration.httpServer);
        const application = new Application({
            configuration,
            httpServer,
            type: "server"
        });
        const environment = configuration.getEnvironment();
        await application.initialize();
        await application.startHttpServer();
        const waitPromise = waitForApplicationWithSignalShutdown({ application });
        console.log(`Started Velocious HTTP server on ${httpServer.host}:${httpServer.port} in ${environment} environment`);
        await waitPromise;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL3NlcnZlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSw0QkFBNEIsQ0FBQTtBQUNwRCxPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV6RDs7Ozs7R0FLRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7Ozs7R0FPRztBQUNILE1BQU0sVUFBVSxvQ0FBb0MsQ0FBQyxFQUFDLFdBQVcsRUFBRSxhQUFhLEdBQUcsT0FBTyxFQUFDO0lBQ3pGLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDckMsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFBO1FBQ3BCLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUVwQjs7O1dBR0c7UUFDSCxNQUFNLE9BQU8sR0FBRyxHQUFHLEVBQUU7WUFDbkIsYUFBYSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUE7WUFDaEQsYUFBYSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFDbkQsQ0FBQyxDQUFBO1FBRUQ7Ozs7V0FJRztRQUNILE1BQU0sTUFBTSxHQUFHLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDdkIsSUFBSSxRQUFRO2dCQUFFLE9BQU07WUFFcEIsUUFBUSxHQUFHLElBQUksQ0FBQTtZQUNmLE9BQU8sRUFBRSxDQUFBO1lBRVQsSUFBSSxLQUFLLEVBQUUsQ0FBQztnQkFDVixNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDZixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBQ3BCLENBQUM7UUFDSCxDQUFDLENBQUE7UUFFRDs7O1dBR0c7UUFDSCxNQUFNLGVBQWUsR0FBRyxL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O1FBRWxDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxpQkFBaUIsSUFBSSxFQUFFLENBQUE7UUFDNUQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDN0MsTUFBTSxVQUFVLEdBQUcsOEJBQThCLENBQUMsaUJBQWlCLEVBQUUsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzlGLE1BQU0sV0FBVyxHQUFHLElBQUksV0FBVyxDQUFDO1lBQ2xDLGFBQWE7WUFDYixVQUFVO1lBQ1YsSUFBSSxFQUFFLFFBQVE7U0FDZixDQUFDLENBQUE7UUFDRixNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFbEQsTUFBTSxXQUFXLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDOUIsTUFBTSxXQUFXLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDbkMsTUFBTSxXQUFXLEdBQUcsb0NBQW9DLENBQUMsRUFBQyxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBRXZFLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0NBQW9DLFVBQVUsQ0FBQyxJQUFJLElBQUksVUFBVSxDQUFDLElBQUksT0FBTyxXQUFXLGNBQWMsQ0FBQyxDQUFBO1FBQ25ILE1BQU0sV0FBVyxDQUFBO0lBQ25CLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBBcHBsaWNhdGlvbiBmcm9tIFwiLi4vLi4vLi4vLi4vYXBwbGljYXRpb24uanNcIlxuaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi8uLi9jbGkvYmFzZS1jb21tYW5kLmpzXCJcblxuLyoqXG4gKiBTaWduYWxQcm9jZXNzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTaWduYWxQcm9jZXNzXG4gKiBAcHJvcGVydHkgeyhldmVudDogXCJTSUdJTlRcIiB8IFwiU0lHVEVSTVwiLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCkgPT4gU2lnbmFsUHJvY2Vzc30gb25jZSAtIFJlZ2lzdGVyIG9uZSBzaWduYWwgbGlzdGVuZXIuXG4gKiBAcHJvcGVydHkgeyhldmVudDogXCJTSUdJTlRcIiB8IFwiU0lHVEVSTVwiLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCkgPT4gU2lnbmFsUHJvY2Vzc30gcmVtb3ZlTGlzdGVuZXIgLSBSZW1vdmUgb25lIHNpZ25hbCBsaXN0ZW5lci5cbiAqL1xuXG4vKipcbiAqIFNpZ25hbFNodXRkb3duQXBwbGljYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNpZ25hbFNodXRkb3duQXBwbGljYXRpb25cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gc3RvcCAtIFN0b3AgdGhlIGFwcGxpY2F0aW9uIGdyYWNlZnVsbHkuXG4gKiBAcHJvcGVydHkgeygpID0+IFByb21pc2U8dm9pZD59IHdhaXQgLSBXYWl0IHVudGlsIHRoZSBhcHBsaWNhdGlvbiBjbG9zZXMuXG4gKi9cblxuLyoqXG4gKiBXYWl0cyBmb3IgdGhlIEhUVFAgYXBwbGljYXRpb24gdG8gY2xvc2UsIHN0b3BwaW5nIGl0IGdyYWNlZnVsbHkgd2hlbiB0aGVcbiAqIHByb2Nlc3MgcmVjZWl2ZXMgU0lHSU5UIG9yIFNJR1RFUk0uXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdhaXQgb3B0aW9ucy5cbiAqIEBwYXJhbSB7U2lnbmFsU2h1dGRvd25BcHBsaWNhdGlvbn0gYXJncy5hcHBsaWNhdGlvbiAtIFJ1bm5pbmcgYXBwbGljYXRpb24uXG4gKiBAcGFyYW0ge1NpZ25hbFByb2Nlc3N9IFthcmdzLnByb2Nlc3NPYmplY3RdIC0gUHJvY2Vzcy1saWtlIHNpZ25hbCBlbWl0dGVyLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgYXBwbGljYXRpb24gaGFzIHN0b3BwZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3YWl0Rm9yQXBwbGljYXRpb25XaXRoU2lnbmFsU2h1dGRvd24oe2FwcGxpY2F0aW9uLCBwcm9jZXNzT2JqZWN0ID0gcHJvY2Vzc30pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBsZXQgZmluaXNoZWQgPSBmYWxzZVxuICAgIGxldCBzdG9wcGluZyA9IGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBDbGVhbnVwLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfSAtIFJlbW92ZSBpbnN0YWxsZWQgc2lnbmFsIGhhbmRsZXJzLlxuICAgICAqL1xuICAgIGNvbnN0IGNsZWFudXAgPSAoKSA9PiB7XG4gICAgICBwcm9jZXNzT2JqZWN0LnJlbW92ZUxpc3RlbmVyKFwiU0lHSU5UXCIsIG9uU2lnbmFsKVxuICAgICAgcHJvY2Vzc09iamVjdC5yZW1vdmVMaXN0ZW5lcihcIlNJR1RFUk1cIiwgb25TaWduYWwpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29tcGxldGVzIHRoZSB3YWl0IHByb21pc2Ugb25jZS5cbiAgICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbZXJyb3JdIC0gT3B0aW9uYWwgcmVqZWN0aW9uIHJlYXNvbi5cbiAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgKi9cbiAgICBjb25zdCBmaW5pc2ggPSAoZXJyb3IpID0+IHtcbiAgICAgIGlmIChmaW5pc2hlZCkgcmV0dXJuXG5cbiAgICAgIGZpbmlzaGVkID0gdHJ1ZVxuICAgICAgY2xlYW51cCgpXG5cbiAgICAgIGlmIChlcnJvcikge1xuICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTdG9wIGFwcGxpY2F0aW9uLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFN0b3BzIHRoZSBhcHBsaWNhdGlvbiBvbmNlLlxuICAgICAqL1xuICAgIGNvbnN0IHN0b3BBcHBsaWNhdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChzdG9wcGluZyB8fCBmaW5pc2hlZCkgcmV0dXJuXG5cbiAgICAgIHN0b3BwaW5nID0gdHJ1ZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBhcHBsaWNhdGlvbi5zdG9wKClcbiAgICAgICAgZmluaXNoKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZpbmlzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBPbiBzaWduYWwuXG4gICAgICogQHJldHVybnMge3ZvaWR9IC0gSGFuZGxlcyBvbmUgc2h1dGRvd24gc2lnbmFsLlxuICAgICAqL1xuICAgIGNvbnN0IG9uU2lnbmFsID0gKCkgPT4ge1xuICAgICAgdm9pZCBzdG9wQXBwbGljYXRpb24oKVxuICAgIH1cblxuICAgIHByb2Nlc3NPYmplY3Qub25jZShcIlNJR0lOVFwiLCBvblNpZ25hbClcbiAgICBwcm9jZXNzT2JqZWN0Lm9uY2UoXCJTSUdURVJNXCIsIG9uU2lnbmFsKVxuXG4gICAgYXBwbGljYXRpb24ud2FpdCgpLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKCFzdG9wcGluZykgZmluaXNoKClcbiAgICB9KS5jYXRjaCgoZXJyb3IpID0+IGZpbmlzaChlcnJvcikpXG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBmaXJzdCBjb25maWd1cmVkIHZhbHVlLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7Li4uKFQgfCB1bmRlZmluZWQpfSB2YWx1ZXMgLSBDYW5kaWRhdGUgdmFsdWVzIGluIHByaW9yaXR5IG9yZGVyLlxuICogQHJldHVybnMge1QgfCB1bmRlZmluZWR9IC0gRmlyc3QgY29uZmlndXJlZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gZmlyc3RDb25maWd1cmVkVmFsdWUoLi4udmFsdWVzKSB7XG4gIHJldHVybiB2YWx1ZXMuZmluZCgodmFsdWUpID0+IHZhbHVlICE9PSB1bmRlZmluZWQpXG59XG5cbi8qKlxuICogUnVucyBodHRwIHNlcnZlciB3b3JrZXJzIGZyb20gYXJnLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgdW5kZWZpbmVkfSB3b3JrZXJzQXJnIC0gV29ya2VyIGNvdW50IGFyZ3VtZW50LlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHdvcmtlciBjb3VudC5cbiAqL1xuZnVuY3Rpb24gaHR0cFNlcnZlcldvcmtlcnNGcm9tQXJnKHdvcmtlcnNBcmcpIHtcbiAgaWYgKHdvcmtlcnNBcmcgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZFxuICBpZiAodHlwZW9mIHdvcmtlcnNBcmcgPT09IFwiYm9vbGVhblwiKSB0aHJvdyBuZXcgRXJyb3IoXCItLXdvcmtlcnMgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJcIilcblxuICBjb25zdCB3b3JrZXJzID0gTnVtYmVyKHdvcmtlcnNBcmcpXG5cbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHdvcmtlcnMpIHx8IHdvcmtlcnMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCItLXdvcmtlcnMgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJcIilcblxuICByZXR1cm4gd29ya2Vyc1xufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGh0dHBTZXJ2ZXJDb25maWdGcm9tUGFyc2VkQXJncyBoZWxwZXIuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCB1bmRlZmluZWQ+fSBwYXJzZWRQcm9jZXNzQXJncyAtIFBhcnNlZCBDTEkgYXJncy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5IdHRwU2VydmVyQ29uZmlndXJhdGlvbn0gW2RlZmF1bHRzXSAtIERlZmF1bHQgSFRUUCBzZXJ2ZXIgY29uZmlnLlxuICogQHJldHVybnMge3tob3N0OiBzdHJpbmcsIHBvcnQ6IG51bWJlciwgd29ya2Vycz86IG51bWJlcn19IC0gSFRUUCBzZXJ2ZXIgY29uZmlnLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHR0cFNlcnZlckNvbmZpZ0Zyb21QYXJzZWRBcmdzKHBhcnNlZFByb2Nlc3NBcmdzID0ge30sIGRlZmF1bHRzID0ge30pIHtcbiAgY29uc3QgaG9zdCA9IFN0cmluZyhmaXJzdENvbmZpZ3VyZWRWYWx1ZShwYXJzZWRQcm9jZXNzQXJncy5oLCBwYXJzZWRQcm9jZXNzQXJncy5ob3N0LCBkZWZhdWx0cy5ob3N0LCBcIjEyNy4wLjAuMVwiKSlcbiAgY29uc3QgcG9ydCA9IE51bWJlcihmaXJzdENvbmZpZ3VyZWRWYWx1ZShwYXJzZWRQcm9jZXNzQXJncy5wLCBwYXJzZWRQcm9jZXNzQXJncy5wb3J0LCBkZWZhdWx0cy5wb3J0LCAzMDA2KSlcbiAgY29uc3Qgd29ya2VycyA9IGh0dHBTZXJ2ZXJXb3JrZXJzRnJvbUFyZyhmaXJzdENvbmZpZ3VyZWRWYWx1ZShwYXJzZWRQcm9jZXNzQXJncy53b3JrZXJzLCBkZWZhdWx0cy53b3JrZXJzKSlcblxuICBpZiAod29ya2VycyA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge2hvc3QsIHBvcnR9XG4gIHJldHVybiB7aG9zdCwgcG9ydCwgd29ya2Vyc31cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ2xpQ29tbWFuZHNTZXJ2ZXIgZXh0ZW5kcyBCYXNlQ29tbWFuZHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3RhcnRzIHRoZSBIVFRQIHNlcnZlciBhbmQgd2FpdHMgdW50aWwgaXQgc3RvcHMuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIC8vIElkZW50aWZ5IHRoaXMgcHJvY2VzcyBpbiBgcHNgL2B0b3BgIGluc3RlYWQgb2YgYSBnZW5lcmljIFwibm9kZVwiIGVudHJ5LlxuICAgIHByb2Nlc3MudGl0bGUgPSBcInZlbG9jaW91cyBzZXJ2ZXJcIlxuXG4gICAgY29uc3QgcGFyc2VkUHJvY2Vzc0FyZ3MgPSB0aGlzLmFyZ3M/LnBhcnNlZFByb2Nlc3NBcmdzIHx8IHt9XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgaHR0cFNlcnZlciA9IGh0dHBTZXJ2ZXJDb25maWdGcm9tUGFyc2VkQXJncyhwYXJzZWRQcm9jZXNzQXJncywgY29uZmlndXJhdGlvbi5odHRwU2VydmVyKVxuICAgIGNvbnN0IGFwcGxpY2F0aW9uID0gbmV3IEFwcGxpY2F0aW9uKHtcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBodHRwU2VydmVyLFxuICAgICAgdHlwZTogXCJzZXJ2ZXJcIlxuICAgIH0pXG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KClcblxuICAgIGF3YWl0IGFwcGxpY2F0aW9uLmluaXRpYWxpemUoKVxuICAgIGF3YWl0IGFwcGxpY2F0aW9uLnN0YXJ0SHR0cFNlcnZlcigpXG4gICAgY29uc3Qgd2FpdFByb21pc2UgPSB3YWl0Rm9yQXBwbGljYXRpb25XaXRoU2lnbmFsU2h1dGRvd24oe2FwcGxpY2F0aW9ufSlcblxuICAgIGNvbnNvbGUubG9nKGBTdGFydGVkIFZlbG9jaW91cyBIVFRQIHNlcnZlciBvbiAke2h0dHBTZXJ2ZXIuaG9zdH06JHtodHRwU2VydmVyLnBvcnR9IGluICR7ZW52aXJvbm1lbnR9IGVudmlyb25tZW50YClcbiAgICBhd2FpdCB3YWl0UHJvbWlzZVxuICB9XG59XG4iXX0=