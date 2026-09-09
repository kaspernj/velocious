import BaseCommand from "../../../../../cli/base-command.js";
import buildCliCommandContext from "../cli-command-context.js";
import path from "node:path";
import toImportSpecifier from "../../../../../utils/to-import-specifier.js";
/**
 * RunnerContext type.
 * @typedef {import("../cli-command-context.js").CliCommandContext} RunnerContext
 */
/**
 * Runs import runner function.
 * @param {string} filePath - Absolute path to script file.
 * @returns {Promise<(context: RunnerContext) => Promise<ReturnType<typeof JSON.parse>>>} - The default-exported async function.
 */
async function importRunnerFunction(filePath) {
    const runnerImport = await import(toImportSpecifier(filePath));
    const runnerFunction = runnerImport.default;
    if (typeof runnerFunction !== "function") {
        throw new Error(`Expected default export to be a function in: ${filePath}`);
    }
    return runnerFunction;
}
/** Node command for running project database seeds from src/db/seed.js. */
export default class DbSeed extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the seed function result.
     */
    async execute() {
        const configuration = this.getConfiguration();
        await this.initializeRuntime();
        try {
            await configuration.ensureGlobalConnections();
            const seedPath = this.seedFilePath();
            const runnerFunction = await importRunnerFunction(seedPath);
            return await runnerFunction(this.buildRunnerContext());
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
        await configuration.initialize({ type: "db-seed" });
        if (!configuration.isDatabasePoolInitialized()) {
            configuration.initializeDatabasePool();
        }
    }
    /**
     * Runs seed file path.
     * @returns {string} - Absolute path to src/db/seed.js.
     */
    seedFilePath() {
        return path.join(this.directory(), "src", "db", "seed.js");
    }
    /**
     * Runs build runner context.
     * @returns {RunnerContext} - Runtime context passed to the script function.
     */
    buildRunnerContext() {
        return buildCliCommandContext(this, 1);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9kYi9zZWVkLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sV0FBVyxNQUFNLG9DQUFvQyxDQUFBO0FBQzVELE9BQU8sc0JBQXNCLE1BQU0sMkJBQTJCLENBQUE7QUFDOUQsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8saUJBQWlCLE1BQU0sNkNBQTZDLENBQUE7QUFFM0U7OztHQUdHO0FBRUg7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxvQkFBb0IsQ0FBQyxRQUFRO0lBQzFDLE1BQU0sWUFBWSxHQUFHLE1BQU0sTUFBTSxDQUFDLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7SUFDOUQsTUFBTSxjQUFjLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQTtJQUUzQyxJQUFJLE9BQU8sY0FBYyxLQUFLLFVBQVUsRUFBRSxDQUFDO1FBQ3pDLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELFFBQVEsRUFBRSxDQUFDLENBQUE7SUFDN0UsQ0FBQztJQUVELE9BQU8sY0FBYyxDQUFBO0FBQ3ZCLENBQUM7QUFFRCwyRUFBMkU7QUFDM0UsTUFBTSxDQUFDLE9BQU8sT0FBTyxNQUFPLFNBQVEsV0FBVztJQUM3Qzs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRTdDLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFOUIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtZQUU3QyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7WUFDcEMsTUFBTSxjQUFjLEdBQUcsTUFBTSxvQkFBb0IsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUUzRCxPQUFPLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLENBQUE7UUFDeEQsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxhQUFhLENBQUMsd0JBQXdCLEVBQUUsQ0FBQTtRQUNoRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxpQkFBaUI7UUFDckIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFFN0MsTUFBTSxhQUFhLENBQUMsVUFBVSxDQUFDLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUE7UUFFakQsSUFBSSxDQUFDLGFBQWEsQ0FBQyx5QkFBeUIsRUFBRSxFQUFFLENBQUM7WUFDL0MsYUFBYSxDQUFDLHNCQUFzQixFQUFFLENBQUE7UUFDeEMsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxZQUFZO1FBQ1YsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFBO0lBQzVELENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQkFBa0I7UUFDaEIsT0FBTyxzQkFBc0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUE7SUFDeEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi8uLi8uLi9jbGkvYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBidWlsZENsaUNvbW1hbmRDb250ZXh0IGZyb20gXCIuLi9jbGktY29tbWFuZC1jb250ZXh0LmpzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuaW1wb3J0IHRvSW1wb3J0U3BlY2lmaWVyIGZyb20gXCIuLi8uLi8uLi8uLi8uLi91dGlscy90by1pbXBvcnQtc3BlY2lmaWVyLmpzXCJcblxuLyoqXG4gKiBSdW5uZXJDb250ZXh0IHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vY2xpLWNvbW1hbmQtY29udGV4dC5qc1wiKS5DbGlDb21tYW5kQ29udGV4dH0gUnVubmVyQ29udGV4dFxuICovXG5cbi8qKlxuICogUnVucyBpbXBvcnQgcnVubmVyIGZ1bmN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gQWJzb2x1dGUgcGF0aCB0byBzY3JpcHQgZmlsZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPChjb250ZXh0OiBSdW5uZXJDb250ZXh0KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGhlIGRlZmF1bHQtZXhwb3J0ZWQgYXN5bmMgZnVuY3Rpb24uXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGltcG9ydFJ1bm5lckZ1bmN0aW9uKGZpbGVQYXRoKSB7XG4gIGNvbnN0IHJ1bm5lckltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihmaWxlUGF0aCkpXG4gIGNvbnN0IHJ1bm5lckZ1bmN0aW9uID0gcnVubmVySW1wb3J0LmRlZmF1bHRcblxuICBpZiAodHlwZW9mIHJ1bm5lckZ1bmN0aW9uICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlZmF1bHQgZXhwb3J0IHRvIGJlIGEgZnVuY3Rpb24gaW46ICR7ZmlsZVBhdGh9YClcbiAgfVxuXG4gIHJldHVybiBydW5uZXJGdW5jdGlvblxufVxuXG4vKiogTm9kZSBjb21tYW5kIGZvciBydW5uaW5nIHByb2plY3QgZGF0YWJhc2Ugc2VlZHMgZnJvbSBzcmMvZGIvc2VlZC5qcy4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIERiU2VlZCBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHNlZWQgZnVuY3Rpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZVJ1bnRpbWUoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlR2xvYmFsQ29ubmVjdGlvbnMoKVxuXG4gICAgICBjb25zdCBzZWVkUGF0aCA9IHRoaXMuc2VlZEZpbGVQYXRoKClcbiAgICAgIGNvbnN0IHJ1bm5lckZ1bmN0aW9uID0gYXdhaXQgaW1wb3J0UnVubmVyRnVuY3Rpb24oc2VlZFBhdGgpXG5cbiAgICAgIHJldHVybiBhd2FpdCBydW5uZXJGdW5jdGlvbih0aGlzLmJ1aWxkUnVubmVyQ29udGV4dCgpKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBydW50aW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJ1bnRpbWUgaW5pdGlhbGl6YXRpb24gaXMgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplUnVudGltZSgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJkYi1zZWVkXCJ9KVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uLmlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoKSkge1xuICAgICAgY29uZmlndXJhdGlvbi5pbml0aWFsaXplRGF0YWJhc2VQb29sKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWVkIGZpbGUgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBYnNvbHV0ZSBwYXRoIHRvIHNyYy9kYi9zZWVkLmpzLlxuICAgKi9cbiAgc2VlZEZpbGVQYXRoKCkge1xuICAgIHJldHVybiBwYXRoLmpvaW4odGhpcy5kaXJlY3RvcnkoKSwgXCJzcmNcIiwgXCJkYlwiLCBcInNlZWQuanNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIHJ1bm5lciBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UnVubmVyQ29udGV4dH0gLSBSdW50aW1lIGNvbnRleHQgcGFzc2VkIHRvIHRoZSBzY3JpcHQgZnVuY3Rpb24uXG4gICAqL1xuICBidWlsZFJ1bm5lckNvbnRleHQoKSB7XG4gICAgcmV0dXJuIGJ1aWxkQ2xpQ29tbWFuZENvbnRleHQodGhpcywgMSlcbiAgfVxufVxuIl19