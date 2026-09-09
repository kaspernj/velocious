import BaseCommand from "../../../../cli/base-command.js";
import buildCliCommandContext from "./cli-command-context.js";
/**
 * RunnerContext type.
 * @typedef {import("./cli-command-context.js").CliCommandContext} RunnerContext
 */
/** Node command for evaluating inline JavaScript in initialized app/DB context. */
export default class RunnerCommand extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the evaluated code result.
     */
    async execute() {
        const configuration = this.getConfiguration();
        const code = this.runnerCode();
        await this.initializeRuntime();
        try {
            await configuration.ensureGlobalConnections();
            return await this.evaluateCode(code);
        }
        finally {
            await configuration.closeDatabaseConnections();
        }
    }
    /**
     * Runs initialize runtime.
     * @returns {Promise<void>} - Resolves when runtime initialization is complete.
     */
    async initializeRuntime() {
        const configuration = this.getConfiguration();
        await configuration.initialize({ type: "runner" });
        if (!configuration.isDatabasePoolInitialized()) {
            configuration.initializeDatabasePool();
        }
    }
    /**
     * Runs runner code.
     * @returns {string} - Inline JavaScript code to evaluate.
     */
    runnerCode() {
        const code = (this.processArgs || []).slice(1).join(" ").trim();
        if (!code) {
            throw new Error("Missing code argument. Usage: npx velocious runner \"<javascript-code>\"");
        }
        return code;
    }
    /**
     * Runs build runner context.
     * @returns {RunnerContext} - Runtime context passed to evaluated code.
     */
    buildRunnerContext() {
        return buildCliCommandContext(this, 2);
    }
    /**
     * Runs evaluate code.
     * @param {string} code - JavaScript code to evaluate.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Evaluated code result.
     */
    async evaluateCode(code) {
        const context = this.buildRunnerContext();
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
        const runFunction = new AsyncFunction("configuration", "db", "dbs", "args", code);
        return await runFunction(context.configuration, context.db, context.dbs, context.args);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVubmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL3J1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN6RCxPQUFPLHNCQUFzQixNQUFNLDBCQUEwQixDQUFBO0FBRTdEOzs7R0FHRztBQUVILG1GQUFtRjtBQUNuRixNQUFNLENBQUMsT0FBTyxPQUFPLGFBQWMsU0FBUSxXQUFXO0lBQ3BEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDN0MsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBRTlCLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFOUIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtZQUU3QyxPQUFPLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUN0QyxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBQ2hELENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQjtRQUNyQixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUU3QyxNQUFNLGFBQWEsQ0FBQyxVQUFVLENBQUMsRUFBQyxJQUFJLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtRQUVoRCxJQUFJLENBQUMsYUFBYSxDQUFDLHlCQUF5QixFQUFFLEVBQUUsQ0FBQztZQUMvQyxhQUFhLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixNQUFNLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUUvRCxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDVixNQUFNLElBQUksS0FBSyxDQUFDLDBFQUEwRSxDQUFDLENBQUE7UUFDN0YsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7T0FHRztJQUNILGtCQUFrQjtRQUNoQixPQUFPLHNCQUFzQixDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQTtJQUN4QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSTtRQUNyQixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtRQUN6QyxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDLEtBQUssZUFBYyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUE7UUFDN0UsTUFBTSxXQUFXLEdBQUcsSUFBSSxhQUFhLENBQ25DLGVBQWUsRUFDZixJQUFJLEVBQ0osS0FBSyxFQUNMLE1BQU0sRUFDTixJQUFJLENBQ0wsQ0FBQTtRQUVELE9BQU8sTUFBTSxXQUFXLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxHQUFHLEVBQUUsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3hGLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgYnVpbGRDbGlDb21tYW5kQ29udGV4dCBmcm9tIFwiLi9jbGktY29tbWFuZC1jb250ZXh0LmpzXCJcblxuLyoqXG4gKiBSdW5uZXJDb250ZXh0IHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9jbGktY29tbWFuZC1jb250ZXh0LmpzXCIpLkNsaUNvbW1hbmRDb250ZXh0fSBSdW5uZXJDb250ZXh0XG4gKi9cblxuLyoqIE5vZGUgY29tbWFuZCBmb3IgZXZhbHVhdGluZyBpbmxpbmUgSmF2YVNjcmlwdCBpbiBpbml0aWFsaXplZCBhcHAvREIgY29udGV4dC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJ1bm5lckNvbW1hbmQgZXh0ZW5kcyBCYXNlQ29tbWFuZCB7XG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBldmFsdWF0ZWQgY29kZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGNvZGUgPSB0aGlzLnJ1bm5lckNvZGUoKVxuXG4gICAgYXdhaXQgdGhpcy5pbml0aWFsaXplUnVudGltZSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVHbG9iYWxDb25uZWN0aW9ucygpXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmV2YWx1YXRlQ29kZShjb2RlKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBydW50aW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJ1bnRpbWUgaW5pdGlhbGl6YXRpb24gaXMgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplUnVudGltZSgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJydW5uZXJcIn0pXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZCgpKSB7XG4gICAgICBjb25maWd1cmF0aW9uLmluaXRpYWxpemVEYXRhYmFzZVBvb2woKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1bm5lciBjb2RlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIElubGluZSBKYXZhU2NyaXB0IGNvZGUgdG8gZXZhbHVhdGUuXG4gICAqL1xuICBydW5uZXJDb2RlKCkge1xuICAgIGNvbnN0IGNvZGUgPSAodGhpcy5wcm9jZXNzQXJncyB8fCBbXSkuc2xpY2UoMSkuam9pbihcIiBcIikudHJpbSgpXG5cbiAgICBpZiAoIWNvZGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk1pc3NpbmcgY29kZSBhcmd1bWVudC4gVXNhZ2U6IG5weCB2ZWxvY2lvdXMgcnVubmVyIFxcXCI8amF2YXNjcmlwdC1jb2RlPlxcXCJcIilcbiAgICB9XG5cbiAgICByZXR1cm4gY29kZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgcnVubmVyIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtSdW5uZXJDb250ZXh0fSAtIFJ1bnRpbWUgY29udGV4dCBwYXNzZWQgdG8gZXZhbHVhdGVkIGNvZGUuXG4gICAqL1xuICBidWlsZFJ1bm5lckNvbnRleHQoKSB7XG4gICAgcmV0dXJuIGJ1aWxkQ2xpQ29tbWFuZENvbnRleHQodGhpcywgMilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2YWx1YXRlIGNvZGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2RlIC0gSmF2YVNjcmlwdCBjb2RlIHRvIGV2YWx1YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gRXZhbHVhdGVkIGNvZGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZXZhbHVhdGVDb2RlKGNvZGUpIHtcbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5idWlsZFJ1bm5lckNvbnRleHQoKVxuICAgIGNvbnN0IEFzeW5jRnVuY3Rpb24gPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoYXN5bmMgZnVuY3Rpb24gKCkge30pLmNvbnN0cnVjdG9yXG4gICAgY29uc3QgcnVuRnVuY3Rpb24gPSBuZXcgQXN5bmNGdW5jdGlvbihcbiAgICAgIFwiY29uZmlndXJhdGlvblwiLFxuICAgICAgXCJkYlwiLFxuICAgICAgXCJkYnNcIixcbiAgICAgIFwiYXJnc1wiLFxuICAgICAgY29kZVxuICAgIClcblxuICAgIHJldHVybiBhd2FpdCBydW5GdW5jdGlvbihjb250ZXh0LmNvbmZpZ3VyYXRpb24sIGNvbnRleHQuZGIsIGNvbnRleHQuZGJzLCBjb250ZXh0LmFyZ3MpXG4gIH1cbn1cbiJdfQ==