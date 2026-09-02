import BaseCommand from "../../../../cli/base-command.js";
import buildCliCommandContext from "./cli-command-context.js";
import path from "node:path";
import toImportSpecifier from "../../../../utils/to-import-specifier.js";
/**
 * RunScriptContext type.
 * @typedef {import("./cli-command-context.js").CliCommandContext} RunScriptContext
 */
/**
 * Runs import run script function.
 * @param {string} filePath - Absolute path to script file.
 * @returns {Promise<(context: RunScriptContext) => Promise<ReturnType<typeof JSON.parse>>>} - The default-exported async function.
 */
async function importRunScriptFunction(filePath) {
    const scriptImport = await import(toImportSpecifier(filePath));
    const runScriptFunction = scriptImport.default;
    if (typeof runScriptFunction !== "function") {
        throw new Error(`Expected default export to be a function in: ${filePath}`);
    }
    return runScriptFunction;
}
/** Node command for running a custom script file in initialized app/DB context. */
export default class RunScriptCommand extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the script function result.
     */
    async execute() {
        const configuration = this.getConfiguration();
        const scriptPath = this.scriptFilePath();
        await this.initializeRuntime();
        try {
            await configuration.ensureGlobalConnections();
            const runScriptFunction = await importRunScriptFunction(scriptPath);
            return await runScriptFunction(this.buildRunScriptContext());
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
        await configuration.initialize({ type: "run-script" });
        if (!configuration.isDatabasePoolInitialized()) {
            configuration.initializeDatabasePool();
        }
    }
    /**
     * Runs script file path.
     * @returns {string} - Absolute path to the user-provided script file.
     */
    scriptFilePath() {
        const filePath = this.processArgs?.[1];
        if (!filePath) {
            throw new Error("Missing file path argument. Usage: npx velocious run-script [file-path]");
        }
        return path.resolve(this.directory(), filePath);
    }
    /**
     * Runs build run script context.
     * @returns {RunScriptContext} - Runtime context passed to the script function.
     */
    buildRunScriptContext() {
        return buildCliCommandContext(this, 2);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVuLXNjcmlwdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9ydW4tc2NyaXB0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sV0FBVyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3pELE9BQU8sc0JBQXNCLE1BQU0sMEJBQTBCLENBQUE7QUFDN0QsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8saUJBQWlCLE1BQU0sMENBQTBDLENBQUE7QUFFeEU7OztHQUdHO0FBRUg7Ozs7R0FJRztBQUNILEtBQUssVUFBVSx1QkFBdUIsQ0FBQyxRQUFRO0lBQzdDLE1BQU0sWUFBWSxHQUFHLE1BQU0sTUFBTSxDQUFDLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7SUFDOUQsTUFBTSxpQkFBaUIsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFBO0lBRTlDLElBQUksT0FBTyxpQkFBaUIsS0FBSyxVQUFVLEVBQUUsQ0FBQztRQUM1QyxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxRQUFRLEVBQUUsQ0FBQyxDQUFBO0lBQzdFLENBQUM7SUFFRCxPQUFPLGlCQUFpQixDQUFBO0FBQzFCLENBQUM7QUFFRCxtRkFBbUY7QUFDbkYsTUFBTSxDQUFDLE9BQU8sT0FBTyxnQkFBaUIsU0FBUSxXQUFXO0lBQ3ZEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDN0MsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXhDLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFOUIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtZQUU3QyxNQUFNLGlCQUFpQixHQUFHLE1BQU0sdUJBQXVCLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFbkUsT0FBTyxNQUFNLGlCQUFpQixDQUFDLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLENBQUE7UUFDOUQsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxhQUFhLENBQUMsd0JBQXdCLEVBQUUsQ0FBQTtRQUNoRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxpQkFBaUI7UUFDckIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFFN0MsTUFBTSxhQUFhLENBQUMsVUFBVSxDQUFDLEVBQUMsSUFBSSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7UUFFcEQsSUFBSSxDQUFDLGFBQWEsQ0FBQyx5QkFBeUIsRUFBRSxFQUFFLENBQUM7WUFDL0MsYUFBYSxDQUFDLHNCQUFzQixFQUFFLENBQUE7UUFDeEMsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxjQUFjO1FBQ1osTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXRDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNkLE1BQU0sSUFBSSxLQUFLLENBQUMseUVBQXlFLENBQUMsQ0FBQTtRQUM1RixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUNqRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gscUJBQXFCO1FBQ25CLE9BQU8sc0JBQXNCLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFBO0lBQ3hDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgYnVpbGRDbGlDb21tYW5kQ29udGV4dCBmcm9tIFwiLi9jbGktY29tbWFuZC1jb250ZXh0LmpzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuaW1wb3J0IHRvSW1wb3J0U3BlY2lmaWVyIGZyb20gXCIuLi8uLi8uLi8uLi91dGlscy90by1pbXBvcnQtc3BlY2lmaWVyLmpzXCJcblxuLyoqXG4gKiBSdW5TY3JpcHRDb250ZXh0IHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9jbGktY29tbWFuZC1jb250ZXh0LmpzXCIpLkNsaUNvbW1hbmRDb250ZXh0fSBSdW5TY3JpcHRDb250ZXh0XG4gKi9cblxuLyoqXG4gKiBSdW5zIGltcG9ydCBydW4gc2NyaXB0IGZ1bmN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gQWJzb2x1dGUgcGF0aCB0byBzY3JpcHQgZmlsZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPChjb250ZXh0OiBSdW5TY3JpcHRDb250ZXh0KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGhlIGRlZmF1bHQtZXhwb3J0ZWQgYXN5bmMgZnVuY3Rpb24uXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGltcG9ydFJ1blNjcmlwdEZ1bmN0aW9uKGZpbGVQYXRoKSB7XG4gIGNvbnN0IHNjcmlwdEltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihmaWxlUGF0aCkpXG4gIGNvbnN0IHJ1blNjcmlwdEZ1bmN0aW9uID0gc2NyaXB0SW1wb3J0LmRlZmF1bHRcblxuICBpZiAodHlwZW9mIHJ1blNjcmlwdEZ1bmN0aW9uICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGRlZmF1bHQgZXhwb3J0IHRvIGJlIGEgZnVuY3Rpb24gaW46ICR7ZmlsZVBhdGh9YClcbiAgfVxuXG4gIHJldHVybiBydW5TY3JpcHRGdW5jdGlvblxufVxuXG4vKiogTm9kZSBjb21tYW5kIGZvciBydW5uaW5nIGEgY3VzdG9tIHNjcmlwdCBmaWxlIGluIGluaXRpYWxpemVkIGFwcC9EQiBjb250ZXh0LiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUnVuU2NyaXB0Q29tbWFuZCBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHNjcmlwdCBmdW5jdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHNjcmlwdFBhdGggPSB0aGlzLnNjcmlwdEZpbGVQYXRoKClcblxuICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZVJ1bnRpbWUoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlR2xvYmFsQ29ubmVjdGlvbnMoKVxuXG4gICAgICBjb25zdCBydW5TY3JpcHRGdW5jdGlvbiA9IGF3YWl0IGltcG9ydFJ1blNjcmlwdEZ1bmN0aW9uKHNjcmlwdFBhdGgpXG5cbiAgICAgIHJldHVybiBhd2FpdCBydW5TY3JpcHRGdW5jdGlvbih0aGlzLmJ1aWxkUnVuU2NyaXB0Q29udGV4dCgpKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBydW50aW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJ1bnRpbWUgaW5pdGlhbGl6YXRpb24gaXMgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplUnVudGltZSgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJydW4tc2NyaXB0XCJ9KVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uLmlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoKSkge1xuICAgICAgY29uZmlndXJhdGlvbi5pbml0aWFsaXplRGF0YWJhc2VQb29sKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY3JpcHQgZmlsZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFic29sdXRlIHBhdGggdG8gdGhlIHVzZXItcHJvdmlkZWQgc2NyaXB0IGZpbGUuXG4gICAqL1xuICBzY3JpcHRGaWxlUGF0aCgpIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMucHJvY2Vzc0FyZ3M/LlsxXVxuXG4gICAgaWYgKCFmaWxlUGF0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBmaWxlIHBhdGggYXJndW1lbnQuIFVzYWdlOiBucHggdmVsb2Npb3VzIHJ1bi1zY3JpcHQgW2ZpbGUtcGF0aF1cIilcbiAgICB9XG5cbiAgICByZXR1cm4gcGF0aC5yZXNvbHZlKHRoaXMuZGlyZWN0b3J5KCksIGZpbGVQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgcnVuIHNjcmlwdCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UnVuU2NyaXB0Q29udGV4dH0gLSBSdW50aW1lIGNvbnRleHQgcGFzc2VkIHRvIHRoZSBzY3JpcHQgZnVuY3Rpb24uXG4gICAqL1xuICBidWlsZFJ1blNjcmlwdENvbnRleHQoKSB7XG4gICAgcmV0dXJuIGJ1aWxkQ2xpQ29tbWFuZENvbnRleHQodGhpcywgMilcbiAgfVxufVxuIl19