import Application from "../../../../application.js";
import BaseCommand from "../../../../cli/base-command.js";
import path from "node:path";
import repl from "node:repl";
/**
 * Defines this typedef.
 * @typedef {{application: import("../../../../application.js").default, configuration: import("../../../../configuration.js").default}} ConsoleContextArgs */
/**
 * Runs build console context.
 * @param {ConsoleContextArgs} args - Options object.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The console context.
 */
function buildConsoleContext({ application, configuration }) {
    /**
     * Dbs.
     * @type {Record<string, import("../../../../database/drivers/base.js").default>} */
    const dbs = configuration.getCurrentConnections();
    for (const identifier of configuration.getDatabaseIdentifiers()) {
        if (dbs[identifier])
            continue;
        const pool = configuration.getDatabasePool(identifier);
        const poolWithGlobal = /** @type {{getGlobalConnection?: () => import("../../../../database/drivers/base.js").default | undefined}} */ (pool);
        const globalConnection = poolWithGlobal.getGlobalConnection?.();
        if (globalConnection) {
            dbs[identifier] = globalConnection;
            continue;
        }
        try {
            dbs[identifier] = pool.getCurrentConnection();
        }
        catch (error) {
            if (configuration.isMissingCurrentConnectionError(error)) {
                // Ignore missing connections here; they can be established lazily.
            }
            else {
                throw error;
            }
        }
    }
    const dbIdentifiers = Object.keys(dbs);
    return {
        app: application,
        application,
        configuration,
        db: dbs.default || (dbIdentifiers.length > 0 ? dbs[dbIdentifiers[0]] : undefined),
        dbs,
        models: { ...configuration.modelClasses }
    };
}
/**
 * Runs assign console context.
 * @param {object} args - Options object.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - The base context.
 * @param {import("node:repl").REPLServer} args.replServer - The REPL server.
 * @returns {void} - No return value.
 */
function assignConsoleContext({ context, replServer }) {
    Object.assign(replServer.context, context);
    const modelClasses = /** @type {Record<string, typeof import("../../../../database/record/index.js").default>} */ (context.models || {});
    for (const [name, modelClass] of Object.entries(modelClasses)) {
        replServer.context[name] = modelClass;
    }
}
/**
 * Runs start console repl.
 * @param {object} args - Options object.
 * @param {import("../../../../configuration.js").default} args.configuration - Configuration instance.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - REPL context.
 * @returns {Promise<void>} - Resolves when the console exits.
 */
async function startConsoleRepl({ configuration, context }) {
    const environment = configuration.getEnvironment();
    console.log(`Loading ${environment} environment (Velocious console)`);
    const replServer = repl.start({
        prompt: "velocious> "
    });
    assignConsoleContext({ context, replServer });
    replServer.on("reset", () => {
        assignConsoleContext({ context, replServer });
    });
    const historyPath = path.join(configuration.getDirectory(), ".velocious-console-history");
    await new Promise((resolve, reject) => {
        replServer.setupHistory(historyPath, (error) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(undefined);
            }
        });
    });
    await new Promise((resolve) => {
        replServer.on("exit", () => {
            resolve(undefined);
        });
    });
}
/** Velocious console command. */
export default class VelociousCliCommandsConsole extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async execute() {
        const configuration = this.getConfiguration();
        const application = new Application({
            configuration,
            type: "console"
        });
        await application.initialize();
        try {
            await configuration.ensureGlobalConnections();
            const context = buildConsoleContext({ application, configuration });
            if (this.cli.getTesting()) {
                return { modelNames: Object.keys(context.models || {}) };
            }
            return await startConsoleRepl({ configuration, context });
        }
        finally {
            await configuration.closeDatabaseConnections();
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc29sZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9jb25zb2xlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sV0FBVyxNQUFNLDRCQUE0QixDQUFBO0FBQ3BELE9BQU8sV0FBVyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3pELE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFFNUI7OzhKQUU4SjtBQUU5Sjs7OztHQUlHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FBQyxFQUFDLFdBQVcsRUFBRSxhQUFhLEVBQUM7SUFDdkQ7O3dGQUVvRjtJQUNwRixNQUFNLEdBQUcsR0FBRyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtJQUVqRCxLQUFLLE1BQU0sVUFBVSxJQUFJLGFBQWEsQ0FBQyxzQkFBc0IsRUFBRSxFQUFFLENBQUM7UUFDaEUsSUFBSSxHQUFHLENBQUMsVUFBVSxDQUFDO1lBQUUsU0FBUTtRQUU3QixNQUFNLElBQUksR0FBRyxhQUFhLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ3RELE1BQU0sY0FBYyxHQUFHLCtHQUErRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDN0ksTUFBTSxnQkFBZ0IsR0FBRyxjQUFjLENBQUMsbUJBQW1CLEVBQUUsRUFBRSxDQUFBO1FBRS9ELElBQUksZ0JBQWdCLEVBQUUsQ0FBQztZQUNyQixHQUFHLENBQUMsVUFBVSxDQUFDLEdBQUcsZ0JBQWdCLENBQUE7WUFDbEMsU0FBUTtRQUNWLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxHQUFHLENBQUMsVUFBVSxDQUFDLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFDL0MsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLGFBQWEs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O0lBQ2xFOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDN0MsTUFBTSxXQUFXLEdBQUcsSUFBSSxXQUFXLENBQUM7WUFDbEMsYUFBYTtZQUNiLElBQUksRUFBRSxTQUFTO1NBQ2hCLENBQUMsQ0FBQTtRQUVGLE1BQU0sV0FBVyxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBRTlCLElBQUksQ0FBQztZQUNILE1BQU0sYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUE7WUFFN0MsTUFBTSxPQUFPLEdBQUcsbUJBQW1CLENBQUMsRUFBQyxXQUFXLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtZQUVqRSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQztnQkFDMUIsT0FBTyxFQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLEVBQUMsQ0FBQTtZQUN4RCxDQUFDO1lBRUQsT0FBTyxNQUFNLGdCQUFnQixDQUFDLEVBQUMsYUFBYSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDekQsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxhQUFhLENBQUMsd0JBQXdCLEVBQUUsQ0FBQTtRQUNoRCxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEFwcGxpY2F0aW9uIGZyb20gXCIuLi8uLi8uLi8uLi9hcHBsaWNhdGlvbi5qc1wiXG5pbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgcmVwbCBmcm9tIFwibm9kZTpyZXBsXCJcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YXBwbGljYXRpb246IGltcG9ydChcIi4uLy4uLy4uLy4uL2FwcGxpY2F0aW9uLmpzXCIpLmRlZmF1bHQsIGNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH19IENvbnNvbGVDb250ZXh0QXJncyAqL1xuXG4vKipcbiAqIFJ1bnMgYnVpbGQgY29uc29sZSBjb250ZXh0LlxuICogQHBhcmFtIHtDb25zb2xlQ29udGV4dEFyZ3N9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGNvbnNvbGUgY29udGV4dC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRDb25zb2xlQ29udGV4dCh7YXBwbGljYXRpb24sIGNvbmZpZ3VyYXRpb259KSB7XG4gIC8qKlxuICAgKiBEYnMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi8uLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gIGNvbnN0IGRicyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcblxuICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICBpZiAoZGJzW2lkZW50aWZpZXJdKSBjb250aW51ZVxuXG4gICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG4gICAgY29uc3QgcG9vbFdpdGhHbG9iYWwgPSAvKiogQHR5cGUge3tnZXRHbG9iYWxDb25uZWN0aW9uPzogKCkgPT4gaW1wb3J0KFwiLi4vLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSAqLyAocG9vbClcbiAgICBjb25zdCBnbG9iYWxDb25uZWN0aW9uID0gcG9vbFdpdGhHbG9iYWwuZ2V0R2xvYmFsQ29ubmVjdGlvbj8uKClcblxuICAgIGlmIChnbG9iYWxDb25uZWN0aW9uKSB7XG4gICAgICBkYnNbaWRlbnRpZmllcl0gPSBnbG9iYWxDb25uZWN0aW9uXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBkYnNbaWRlbnRpZmllcl0gPSBwb29sLmdldEN1cnJlbnRDb25uZWN0aW9uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGNvbmZpZ3VyYXRpb24uaXNNaXNzaW5nQ3VycmVudENvbm5lY3Rpb25FcnJvcihlcnJvcikpIHtcbiAgICAgICAgLy8gSWdub3JlIG1pc3NpbmcgY29ubmVjdGlvbnMgaGVyZTsgdGhleSBjYW4gYmUgZXN0YWJsaXNoZWQgbGF6aWx5LlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBkYklkZW50aWZpZXJzID0gT2JqZWN0LmtleXMoZGJzKVxuXG4gIHJldHVybiB7XG4gICAgYXBwOiBhcHBsaWNhdGlvbixcbiAgICBhcHBsaWNhdGlvbixcbiAgICBjb25maWd1cmF0aW9uLFxuICAgIGRiOiBkYnMuZGVmYXVsdCB8fCAoZGJJZGVudGlmaWVycy5sZW5ndGggPiAwID8gZGJzW2RiSWRlbnRpZmllcnNbMF1dIDogdW5kZWZpbmVkKSxcbiAgICBkYnMsXG4gICAgbW9kZWxzOiB7Li4uY29uZmlndXJhdGlvbi5tb2RlbENsYXNzZXN9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFzc2lnbiBjb25zb2xlIGNvbnRleHQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFRoZSBiYXNlIGNvbnRleHQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6cmVwbFwiKS5SRVBMU2VydmVyfSBhcmdzLnJlcGxTZXJ2ZXIgLSBUaGUgUkVQTCBzZXJ2ZXIuXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGFzc2lnbkNvbnNvbGVDb250ZXh0KHtjb250ZXh0LCByZXBsU2VydmVyfSkge1xuICBPYmplY3QuYXNzaWduKHJlcGxTZXJ2ZXIuY29udGV4dCwgY29udGV4dClcblxuICBjb25zdCBtb2RlbENsYXNzZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59ICovIChcbiAgICBjb250ZXh0Lm1vZGVscyB8fCB7fVxuICApXG5cbiAgZm9yIChjb25zdCBbbmFtZSwgbW9kZWxDbGFzc10gb2YgT2JqZWN0LmVudHJpZXMobW9kZWxDbGFzc2VzKSkge1xuICAgIHJlcGxTZXJ2ZXIuY29udGV4dFtuYW1lXSA9IG1vZGVsQ2xhc3NcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgc3RhcnQgY29uc29sZSByZXBsLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJFUEwgY29udGV4dC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvbnNvbGUgZXhpdHMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHN0YXJ0Q29uc29sZVJlcGwoe2NvbmZpZ3VyYXRpb24sIGNvbnRleHR9KSB7XG4gIGNvbnN0IGVudmlyb25tZW50ID0gY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudCgpXG5cbiAgY29uc29sZS5sb2coYExvYWRpbmcgJHtlbnZpcm9ubWVudH0gZW52aXJvbm1lbnQgKFZlbG9jaW91cyBjb25zb2xlKWApXG5cbiAgY29uc3QgcmVwbFNlcnZlciA9IHJlcGwuc3RhcnQoe1xuICAgIHByb21wdDogXCJ2ZWxvY2lvdXM+IFwiXG4gIH0pXG5cbiAgYXNzaWduQ29uc29sZUNvbnRleHQoe2NvbnRleHQsIHJlcGxTZXJ2ZXJ9KVxuICByZXBsU2VydmVyLm9uKFwicmVzZXRcIiwgKCkgPT4ge1xuICAgIGFzc2lnbkNvbnNvbGVDb250ZXh0KHtjb250ZXh0LCByZXBsU2VydmVyfSlcbiAgfSlcblxuICBjb25zdCBoaXN0b3J5UGF0aCA9IHBhdGguam9pbihjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpLCBcIi52ZWxvY2lvdXMtY29uc29sZS1oaXN0b3J5XCIpXG5cbiAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIHJlcGxTZXJ2ZXIuc2V0dXBIaXN0b3J5KGhpc3RvcnlQYXRoLCAoZXJyb3IpID0+IHtcbiAgICAgIGlmIChlcnJvcikge1xuICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH1cbiAgICB9KVxuICB9KVxuXG4gIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgcmVwbFNlcnZlci5vbihcImV4aXRcIiwgKCkgPT4ge1xuICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcbiAgfSlcblxufVxuXG4vKiogVmVsb2Npb3VzIGNvbnNvbGUgY29tbWFuZC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NsaUNvbW1hbmRzQ29uc29sZSBleHRlbmRzIEJhc2VDb21tYW5ke1xuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGFwcGxpY2F0aW9uID0gbmV3IEFwcGxpY2F0aW9uKHtcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICB0eXBlOiBcImNvbnNvbGVcIlxuICAgIH0pXG5cbiAgICBhd2FpdCBhcHBsaWNhdGlvbi5pbml0aWFsaXplKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUdsb2JhbENvbm5lY3Rpb25zKClcblxuICAgICAgY29uc3QgY29udGV4dCA9IGJ1aWxkQ29uc29sZUNvbnRleHQoe2FwcGxpY2F0aW9uLCBjb25maWd1cmF0aW9ufSlcblxuICAgICAgaWYgKHRoaXMuY2xpLmdldFRlc3RpbmcoKSkge1xuICAgICAgICByZXR1cm4ge21vZGVsTmFtZXM6IE9iamVjdC5rZXlzKGNvbnRleHQubW9kZWxzIHx8IHt9KX1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHN0YXJ0Q29uc29sZVJlcGwoe2NvbmZpZ3VyYXRpb24sIGNvbnRleHR9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgfVxuICB9XG59XG4iXX0=