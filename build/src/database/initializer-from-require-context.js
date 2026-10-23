// @ts-check
/**
 * Defines this typedef.
 * @typedef {(id: string) => {default: typeof import("./record/index.js").default}} ModelClassRequireContextIDFunctionType
 * @typedef {ModelClassRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} ModelClassRequireContextType
 */
import Logger from "../logger.js";
import BoundedTaskRunner from "../utils/bounded-task-runner.js";
import restArgsError from "../utils/rest-args-error.js";
import SchemaMetadataPrefetcher from "./schema-metadata-prefetcher.js";
/**
 * How many model classes initialize at once. Metadata comes from the prefetched
 * schema cache, so this is CPU-bound attribute mapping rather than database work.
 */
const MODEL_INITIALIZATION_CONCURRENCY = 8;
export default class VelociousDatabaseInitializerFromRequireContext {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {ModelClassRequireContextType} args.requireContext - Require context.
     */
    constructor({ requireContext, ...restArgs }) {
        restArgsError(restArgs);
        this.requireContext = requireContext;
        this.logger = new Logger(this);
    }
    /**
     * Runs initialize.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initialize({ configuration, ...restArgs }) {
        restArgsError(restArgs);
        /** @type {Array<typeof import("./record/index.js").default>} */
        const modelClasses = [];
        for (const fileName of this.requireContext.keys()) {
            const modelClassImport = this.requireContext(fileName);
            if (!modelClassImport)
                throw new Error(`Couldn't import model class from ${fileName}`);
            const modelClass = modelClassImport.default;
            if (!modelClass)
                throw new Error(`Model wasn't exported from: ${fileName}`);
            const configuredDatabase = configuration.getDatabaseConfiguration()[modelClass.getConfiguredDatabaseIdentifier()];
            if (configuredDatabase?.tenantOnly && !configuration.isDatabaseIdentifierActive(modelClass.getConfiguredDatabaseIdentifier())) {
                modelClass.registerRecordClass({ configuration });
                continue;
            }
            modelClass.registerRecordClass({ configuration });
            modelClasses.push(modelClass);
        }
        // One catalog read per database instead of one per model, shared by every
        // model initialized below through the driver's schema cache.
        await new SchemaMetadataPrefetcher({ configuration, logger: this.logger }).prefetch({ modelClasses });
        await BoundedTaskRunner.run({
            concurrency: MODEL_INITIALIZATION_CONCURRENCY,
            items: modelClasses,
            worker: async (modelClass) => {
                if (!modelClass.getEagerLoadRecordMetadata()) {
                    await this._bestEffortInitializeDeferredModel({ configuration, modelClass });
                    return;
                }
                await this._initializeModelRecord({ configuration, modelClass });
            }
        });
    }
    /**
     * Initializes a model's record metadata and its translation table (if any).
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {typeof import("./record/index.js").default} args.modelClass - Model class to initialize.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _initializeModelRecord({ configuration, modelClass }) {
        await modelClass.initializeRecord({ configuration });
        if (await modelClass.hasTranslationsTable()) {
            await modelClass.getTranslationClass().initializeRecord({ configuration });
        }
    }
    /**
     * Models opting out of eager metadata loading (`setEagerLoadRecordMetadata(false)`)
     * are still initialized at startup when their (optional) table is present, so that
     * synchronous query building such as `.where(...)` works without callers having to
     * call `ensureInitialized()` first. When the table — or its connection — is not
     * available the model is left deferred so startup still succeeds; it can then
     * initialize lazily the first time a terminal query method (find/create/etc.) runs.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {typeof import("./record/index.js").default} args.modelClass - Model class to initialize.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _bestEffortInitializeDeferredModel({ configuration, modelClass }) {
        try {
            const connection = modelClass.connection({ enforceTenantDatabaseScope: false });
            const table = await connection.getTableByName(modelClass.tableName(), { throwError: false });
            if (!table)
                return;
            await this._initializeModelRecord({ configuration, modelClass });
        }
        catch (error) {
            // The optional table - or, for a translated model, its <table>_translations
            // table (initializeRecord -> _defineTranslationMethods initializes the
            // translation class) - is missing, or its connection is unavailable. Re-register
            // to drop any partial metadata and leave the model deferred so startup still
            // succeeds; it initializes lazily on first terminal use.
            this.logger.debug(`Leaving ${modelClass.name} deferred - table metadata unavailable at startup`, error);
            modelClass.registerRecordClass({ configuration });
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5pdGlhbGl6ZXItZnJvbS1yZXF1aXJlLWNvbnRleHQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvaW5pdGlhbGl6ZXItZnJvbS1yZXF1aXJlLWNvbnRleHQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7O0dBT0c7QUFFSCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxpQkFBaUIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUMvRCxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLHdCQUF3QixNQUFNLGlDQUFpQyxDQUFBO0FBRXRFOzs7R0FHRztBQUNILE1BQU0sZ0NBQWdDLEdBQUcsQ0FBQyxDQUFBO0FBRTFDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sOENBQThDO0lBQ2pFOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsY0FBYyxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ3ZDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQTtRQUNwQyxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ2hDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBQyxhQUFhLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDM0MsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLGdFQUFnRTtRQUNoRSxNQUFNLFlBQVksR0FBRyxFQUFFLENBQUE7UUFFdkIsS0FBSyxNQUFNLFFBQVEsSUFBSSxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUM7WUFDbEQsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBRXRELElBQUksQ0FBQyxnQkFBZ0I7Z0JBQUUsTUFBTSxJQUFJ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LFVBQVUsQ0FBQyxJQUFJLG1EQUFtRCxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBQ3ZHLFVBQVUsQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDakQsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhpZDogc3RyaW5nKSA9PiB7ZGVmYXVsdDogdHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBNb2RlbENsYXNzUmVxdWlyZUNvbnRleHRJREZ1bmN0aW9uVHlwZVxuICogQHR5cGVkZWYge01vZGVsQ2xhc3NSZXF1aXJlQ29udGV4dElERnVuY3Rpb25UeXBlICYge1xuICogICBrZXlzOiAoKSA9PiBzdHJpbmdbXSxcbiAqICAgaWQ6IHN0cmluZ1xuICogfX0gTW9kZWxDbGFzc1JlcXVpcmVDb250ZXh0VHlwZVxuICovXG5cbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgQm91bmRlZFRhc2tSdW5uZXIgZnJvbSBcIi4uL3V0aWxzL2JvdW5kZWQtdGFzay1ydW5uZXIuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgU2NoZW1hTWV0YWRhdGFQcmVmZXRjaGVyIGZyb20gXCIuL3NjaGVtYS1tZXRhZGF0YS1wcmVmZXRjaGVyLmpzXCJcblxuLyoqXG4gKiBIb3cgbWFueSBtb2RlbCBjbGFzc2VzIGluaXRpYWxpemUgYXQgb25jZS4gTWV0YWRhdGEgY29tZXMgZnJvbSB0aGUgcHJlZmV0Y2hlZFxuICogc2NoZW1hIGNhY2hlLCBzbyB0aGlzIGlzIENQVS1ib3VuZCBhdHRyaWJ1dGUgbWFwcGluZyByYXRoZXIgdGhhbiBkYXRhYmFzZSB3b3JrLlxuICovXG5jb25zdCBNT0RFTF9JTklUSUFMSVpBVElPTl9DT05DVVJSRU5DWSA9IDhcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VJbml0aWFsaXplckZyb21SZXF1aXJlQ29udGV4dCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge01vZGVsQ2xhc3NSZXF1aXJlQ29udGV4dFR5cGV9IGFyZ3MucmVxdWlyZUNvbnRleHQgLSBSZXF1aXJlIGNvbnRleHQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cmVxdWlyZUNvbnRleHQsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLnJlcXVpcmVDb250ZXh0ID0gcmVxdWlyZUNvbnRleHRcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZSh7Y29uZmlndXJhdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8dHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGZpbGVOYW1lIG9mIHRoaXMucmVxdWlyZUNvbnRleHQua2V5cygpKSB7XG4gICAgICBjb25zdCBtb2RlbENsYXNzSW1wb3J0ID0gdGhpcy5yZXF1aXJlQ29udGV4dChmaWxlTmFtZSlcblxuICAgICAgaWYgKCFtb2RlbENsYXNzSW1wb3J0KSB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGltcG9ydCBtb2RlbCBjbGFzcyBmcm9tICR7ZmlsZU5hbWV9YClcblxuICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3NJbXBvcnQuZGVmYXVsdFxuXG4gICAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgTW9kZWwgd2Fzbid0IGV4cG9ydGVkIGZyb206ICR7ZmlsZU5hbWV9YClcblxuICAgICAgY29uc3QgY29uZmlndXJlZERhdGFiYXNlID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVttb2RlbENsYXNzLmdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKV1cblxuICAgICAgaWYgKGNvbmZpZ3VyZWREYXRhYmFzZT8udGVuYW50T25seSAmJiAhY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShtb2RlbENsYXNzLmdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKSkpIHtcbiAgICAgICAgbW9kZWxDbGFzcy5yZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9ufSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbW9kZWxDbGFzcy5yZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9ufSlcbiAgICAgIG1vZGVsQ2xhc3Nlcy5wdXNoKG1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgLy8gT25lIGNhdGFsb2cgcmVhZCBwZXIgZGF0YWJhc2UgaW5zdGVhZCBvZiBvbmUgcGVyIG1vZGVsLCBzaGFyZWQgYnkgZXZlcnlcbiAgICAvLyBtb2RlbCBpbml0aWFsaXplZCBiZWxvdyB0aHJvdWdoIHRoZSBkcml2ZXIncyBzY2hlbWEgY2FjaGUuXG4gICAgYXdhaXQgbmV3IFNjaGVtYU1ldGFkYXRhUHJlZmV0Y2hlcih7Y29uZmlndXJhdGlvbiwgbG9nZ2VyOiB0aGlzLmxvZ2dlcn0pLnByZWZldGNoKHttb2RlbENsYXNzZXN9KVxuXG4gICAgYXdhaXQgQm91bmRlZFRhc2tSdW5uZXIucnVuKHtcbiAgICAgIGNvbmN1cnJlbmN5OiBNT0RFTF9JTklUSUFMSVpBVElPTl9DT05DVVJSRU5DWSxcbiAgICAgIGl0ZW1zOiBtb2RlbENsYXNzZXMsXG4gICAgICB3b3JrZXI6IGFzeW5jIChtb2RlbENsYXNzKSA9PiB7XG4gICAgICAgIGlmICghbW9kZWxDbGFzcy5nZXRFYWdlckxvYWRSZWNvcmRNZXRhZGF0YSgpKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fYmVzdEVmZm9ydEluaXRpYWxpemVEZWZlcnJlZE1vZGVsKHtjb25maWd1cmF0aW9uLCBtb2RlbENsYXNzfSlcblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVsUmVjb3JkKHtjb25maWd1cmF0aW9uLCBtb2RlbENsYXNzfSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIGEgbW9kZWwncyByZWNvcmQgbWV0YWRhdGEgYW5kIGl0cyB0cmFuc2xhdGlvbiB0YWJsZSAoaWYgYW55KS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGluaXRpYWxpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfaW5pdGlhbGl6ZU1vZGVsUmVjb3JkKHtjb25maWd1cmF0aW9uLCBtb2RlbENsYXNzfSkge1xuICAgIGF3YWl0IG1vZGVsQ2xhc3MuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbn0pXG5cbiAgICBpZiAoYXdhaXQgbW9kZWxDbGFzcy5oYXNUcmFuc2xhdGlvbnNUYWJsZSgpKSB7XG4gICAgICBhd2FpdCBtb2RlbENsYXNzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKS5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9ufSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTW9kZWxzIG9wdGluZyBvdXQgb2YgZWFnZXIgbWV0YWRhdGEgbG9hZGluZyAoYHNldEVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhKGZhbHNlKWApXG4gICAqIGFyZSBzdGlsbCBpbml0aWFsaXplZCBhdCBzdGFydHVwIHdoZW4gdGhlaXIgKG9wdGlvbmFsKSB0YWJsZSBpcyBwcmVzZW50LCBzbyB0aGF0XG4gICAqIHN5bmNocm9ub3VzIHF1ZXJ5IGJ1aWxkaW5nIHN1Y2ggYXMgYC53aGVyZSguLi4pYCB3b3JrcyB3aXRob3V0IGNhbGxlcnMgaGF2aW5nIHRvXG4gICAqIGNhbGwgYGVuc3VyZUluaXRpYWxpemVkKClgIGZpcnN0LiBXaGVuIHRoZSB0YWJsZSDigJQgb3IgaXRzIGNvbm5lY3Rpb24g4oCUIGlzIG5vdFxuICAgKiBhdmFpbGFibGUgdGhlIG1vZGVsIGlzIGxlZnQgZGVmZXJyZWQgc28gc3RhcnR1cCBzdGlsbCBzdWNjZWVkczsgaXQgY2FuIHRoZW5cbiAgICogaW5pdGlhbGl6ZSBsYXppbHkgdGhlIGZpcnN0IHRpbWUgYSB0ZXJtaW5hbCBxdWVyeSBtZXRob2QgKGZpbmQvY3JlYXRlL2V0Yy4pIHJ1bnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBpbml0aWFsaXplLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Jlc3RFZmZvcnRJbml0aWFsaXplRGVmZXJyZWRNb2RlbCh7Y29uZmlndXJhdGlvbiwgbW9kZWxDbGFzc30pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG1vZGVsQ2xhc3MuY29ubmVjdGlvbih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGU6IGZhbHNlfSlcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgY29ubmVjdGlvbi5nZXRUYWJsZUJ5TmFtZShtb2RlbENsYXNzLnRhYmxlTmFtZSgpLCB7dGhyb3dFcnJvcjogZmFsc2V9KVxuXG4gICAgICBpZiAoIXRhYmxlKSByZXR1cm5cblxuICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVsUmVjb3JkKHtjb25maWd1cmF0aW9uLCBtb2RlbENsYXNzfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gVGhlIG9wdGlvbmFsIHRhYmxlIC0gb3IsIGZvciBhIHRyYW5zbGF0ZWQgbW9kZWwsIGl0cyA8dGFibGU+X3RyYW5zbGF0aW9uc1xuICAgICAgLy8gdGFibGUgKGluaXRpYWxpemVSZWNvcmQgLT4gX2RlZmluZVRyYW5zbGF0aW9uTWV0aG9kcyBpbml0aWFsaXplcyB0aGVcbiAgICAgIC8vIHRyYW5zbGF0aW9uIGNsYXNzKSAtIGlzIG1pc3NpbmcsIG9yIGl0cyBjb25uZWN0aW9uIGlzIHVuYXZhaWxhYmxlLiBSZS1yZWdpc3RlclxuICAgICAgLy8gdG8gZHJvcCBhbnkgcGFydGlhbCBtZXRhZGF0YSBhbmQgbGVhdmUgdGhlIG1vZGVsIGRlZmVycmVkIHNvIHN0YXJ0dXAgc3RpbGxcbiAgICAgIC8vIHN1Y2NlZWRzOyBpdCBpbml0aWFsaXplcyBsYXppbHkgb24gZmlyc3QgdGVybWluYWwgdXNlLlxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYExlYXZpbmcgJHttb2RlbENsYXNzLm5hbWV9IGRlZmVycmVkIC0gdGFibGUgbWV0YWRhdGEgdW5hdmFpbGFibGUgYXQgc3RhcnR1cGAsIGVycm9yKVxuICAgICAgbW9kZWxDbGFzcy5yZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9ufSlcbiAgICB9XG4gIH1cbn1cbiJdfQ==