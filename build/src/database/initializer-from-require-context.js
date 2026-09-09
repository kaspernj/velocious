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
import restArgsError from "../utils/rest-args-error.js";
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
            if (!modelClass.getEagerLoadRecordMetadata()) {
                modelClass.registerRecordClass({ configuration });
                await this._bestEffortInitializeDeferredModel({ configuration, modelClass });
                continue;
            }
            await this._initializeModelRecord({ configuration, modelClass });
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5pdGlhbGl6ZXItZnJvbS1yZXF1aXJlLWNvbnRleHQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvaW5pdGlhbGl6ZXItZnJvbS1yZXF1aXJlLWNvbnRleHQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7O0dBT0c7QUFFSCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFFdkQsTUFBTSxDQUFDLE9BQU8sT0FBTyw4Q0FBOEM7SUFDakU7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxjQUFjLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDdkMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxjQUFjLEdBQUcsY0FBYyxDQUFBO1FBQ3BDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLFVBQVUsQ0FBQyxFQUFDLGFBQWEsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUMzQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsS0FBSyxNQUFNLFFBQVEsSUFBSSxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUM7WUFDbEQsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBRXRELElBQUksQ0FBQyxnQkFBZ0I7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQ0FBb0MsUUFBUSxFQUFFLENBQUMsQ0FBQTtZQUV0RixNQUFNLFVBQVUsR0FBRyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUE7WUFFM0MsSUFBSSxDQUFDLFVBQVU7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywrQkFBK0IsUUFBUSxFQUFFLENBQUMsQ0FBQTtZQUUzRSxNQUFNLGtCQUFrQixHQUFHLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxDQUFDLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFDLENBQUE7WUFFakgsSUFBSSxrQkFBa0IsRUFBRSxVQUFVLElBQUksQ0FBQyxhQUFhLENBQUMsMEJBQTBCLENBQUMsVUFBVSxDQUFDLCtCQUErQixFQUFFLENBQUMsRUFBRSxDQUFDO2dCQUM5SCxVQUFVLENBQUMsbUJBQW1CLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO2dCQUMvQyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksQ0FBQyxVQUFVLENBQUMsMEJBQTBCLEVBQUUsRUFBRSxDQUFDO2dCQUM3QyxVQUFVLENBQUMsbUJBQW1CLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO2dCQUMvQyxNQUFNLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFDLGFBQWEsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO2dCQUMxRSxTQUFRO1lBQ1YsQ0FBQztZQUVELE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDaEUsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsRUFBQyxhQUFhLEVBQUUsVUFBVSxFQUFDO1FBQ3RELE1BQU0sVUFBVSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUVsRCxJQUFJLE1BQU0sVUFBVSxDQUFDLG9CQUFvQixFQUFFLEVBQUUsQ0FBQztZQUM1QyxNQUFNLFVBQVUsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUMxRSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7OztPQVdHO0lBQ0gsS0FBSyxDQUFDLGtDQUFrQyxDQUFDLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBQztRQUNsRSxJQUFJLENBQUM7WUFDSCxNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsVUFBVSxDQUFDLEVBQUMsMEJBQTBCLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUM3RSxNQUFNLEtBQUssR0FBRyxNQUFNLFVBQVUsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLFNBQVMsRUFBRSxFQUFFLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFFMUYsSUFBSSxDQUFDLEtBQUs7Z0JBQUUsT0FBTTtZQUVsQixNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLGFBQWEsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO1FBQ2hFLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsNEVBQTRFO1lBQzVFLHVFQUF1RTtZQUN2RSxpRkFBaUY7WUFDakYsNkVBQTZFO1lBQzdFLHlEQUF5RDtZQUN6RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxXQUFXLFVBQVUsQ0FBQyxJQUFJLG1EQUFtRCxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBQ3ZHLFVBQVUsQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDakQsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhpZDogc3RyaW5nKSA9PiB7ZGVmYXVsdDogdHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBNb2RlbENsYXNzUmVxdWlyZUNvbnRleHRJREZ1bmN0aW9uVHlwZVxuICogQHR5cGVkZWYge01vZGVsQ2xhc3NSZXF1aXJlQ29udGV4dElERnVuY3Rpb25UeXBlICYge1xuICogICBrZXlzOiAoKSA9PiBzdHJpbmdbXSxcbiAqICAgaWQ6IHN0cmluZ1xuICogfX0gTW9kZWxDbGFzc1JlcXVpcmVDb250ZXh0VHlwZVxuICovXG5cbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VJbml0aWFsaXplckZyb21SZXF1aXJlQ29udGV4dCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge01vZGVsQ2xhc3NSZXF1aXJlQ29udGV4dFR5cGV9IGFyZ3MucmVxdWlyZUNvbnRleHQgLSBSZXF1aXJlIGNvbnRleHQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cmVxdWlyZUNvbnRleHQsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLnJlcXVpcmVDb250ZXh0ID0gcmVxdWlyZUNvbnRleHRcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZSh7Y29uZmlndXJhdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGZvciAoY29uc3QgZmlsZU5hbWUgb2YgdGhpcy5yZXF1aXJlQ29udGV4dC5rZXlzKCkpIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3NJbXBvcnQgPSB0aGlzLnJlcXVpcmVDb250ZXh0KGZpbGVOYW1lKVxuXG4gICAgICBpZiAoIW1vZGVsQ2xhc3NJbXBvcnQpIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgaW1wb3J0IG1vZGVsIGNsYXNzIGZyb20gJHtmaWxlTmFtZX1gKVxuXG4gICAgICBjb25zdCBtb2RlbENsYXNzID0gbW9kZWxDbGFzc0ltcG9ydC5kZWZhdWx0XG5cbiAgICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCB3YXNuJ3QgZXhwb3J0ZWQgZnJvbTogJHtmaWxlTmFtZX1gKVxuXG4gICAgICBjb25zdCBjb25maWd1cmVkRGF0YWJhc2UgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW21vZGVsQ2xhc3MuZ2V0Q29uZmlndXJlZERhdGFiYXNlSWRlbnRpZmllcigpXVxuXG4gICAgICBpZiAoY29uZmlndXJlZERhdGFiYXNlPy50ZW5hbnRPbmx5ICYmICFjb25maWd1cmF0aW9uLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKG1vZGVsQ2xhc3MuZ2V0Q29uZmlndXJlZERhdGFiYXNlSWRlbnRpZmllcigpKSkge1xuICAgICAgICBtb2RlbENsYXNzLnJlZ2lzdGVyUmVjb3JkQ2xhc3Moe2NvbmZpZ3VyYXRpb259KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1vZGVsQ2xhc3MuZ2V0RWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEoKSkge1xuICAgICAgICBtb2RlbENsYXNzLnJlZ2lzdGVyUmVjb3JkQ2xhc3Moe2NvbmZpZ3VyYXRpb259KVxuICAgICAgICBhd2FpdCB0aGlzLl9iZXN0RWZmb3J0SW5pdGlhbGl6ZURlZmVycmVkTW9kZWwoe2NvbmZpZ3VyYXRpb24sIG1vZGVsQ2xhc3N9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplTW9kZWxSZWNvcmQoe2NvbmZpZ3VyYXRpb24sIG1vZGVsQ2xhc3N9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyBhIG1vZGVsJ3MgcmVjb3JkIG1ldGFkYXRhIGFuZCBpdHMgdHJhbnNsYXRpb24gdGFibGUgKGlmIGFueSkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBpbml0aWFsaXplLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2luaXRpYWxpemVNb2RlbFJlY29yZCh7Y29uZmlndXJhdGlvbiwgbW9kZWxDbGFzc30pIHtcbiAgICBhd2FpdCBtb2RlbENsYXNzLmluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb259KVxuXG4gICAgaWYgKGF3YWl0IG1vZGVsQ2xhc3MuaGFzVHJhbnNsYXRpb25zVGFibGUoKSkge1xuICAgICAgYXdhaXQgbW9kZWxDbGFzcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCkuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1vZGVscyBvcHRpbmcgb3V0IG9mIGVhZ2VyIG1ldGFkYXRhIGxvYWRpbmcgKGBzZXRFYWdlckxvYWRSZWNvcmRNZXRhZGF0YShmYWxzZSlgKVxuICAgKiBhcmUgc3RpbGwgaW5pdGlhbGl6ZWQgYXQgc3RhcnR1cCB3aGVuIHRoZWlyIChvcHRpb25hbCkgdGFibGUgaXMgcHJlc2VudCwgc28gdGhhdFxuICAgKiBzeW5jaHJvbm91cyBxdWVyeSBidWlsZGluZyBzdWNoIGFzIGAud2hlcmUoLi4uKWAgd29ya3Mgd2l0aG91dCBjYWxsZXJzIGhhdmluZyB0b1xuICAgKiBjYWxsIGBlbnN1cmVJbml0aWFsaXplZCgpYCBmaXJzdC4gV2hlbiB0aGUgdGFibGUg4oCUIG9yIGl0cyBjb25uZWN0aW9uIOKAlCBpcyBub3RcbiAgICogYXZhaWxhYmxlIHRoZSBtb2RlbCBpcyBsZWZ0IGRlZmVycmVkIHNvIHN0YXJ0dXAgc3RpbGwgc3VjY2VlZHM7IGl0IGNhbiB0aGVuXG4gICAqIGluaXRpYWxpemUgbGF6aWx5IHRoZSBmaXJzdCB0aW1lIGEgdGVybWluYWwgcXVlcnkgbWV0aG9kIChmaW5kL2NyZWF0ZS9ldGMuKSBydW5zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gaW5pdGlhbGl6ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9iZXN0RWZmb3J0SW5pdGlhbGl6ZURlZmVycmVkTW9kZWwoe2NvbmZpZ3VyYXRpb24sIG1vZGVsQ2xhc3N9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBtb2RlbENsYXNzLmNvbm5lY3Rpb24oe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlOiBmYWxzZX0pXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGNvbm5lY3Rpb24uZ2V0VGFibGVCeU5hbWUobW9kZWxDbGFzcy50YWJsZU5hbWUoKSwge3Rocm93RXJyb3I6IGZhbHNlfSlcblxuICAgICAgaWYgKCF0YWJsZSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMuX2luaXRpYWxpemVNb2RlbFJlY29yZCh7Y29uZmlndXJhdGlvbiwgbW9kZWxDbGFzc30pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFRoZSBvcHRpb25hbCB0YWJsZSAtIG9yLCBmb3IgYSB0cmFuc2xhdGVkIG1vZGVsLCBpdHMgPHRhYmxlPl90cmFuc2xhdGlvbnNcbiAgICAgIC8vIHRhYmxlIChpbml0aWFsaXplUmVjb3JkIC0+IF9kZWZpbmVUcmFuc2xhdGlvbk1ldGhvZHMgaW5pdGlhbGl6ZXMgdGhlXG4gICAgICAvLyB0cmFuc2xhdGlvbiBjbGFzcykgLSBpcyBtaXNzaW5nLCBvciBpdHMgY29ubmVjdGlvbiBpcyB1bmF2YWlsYWJsZS4gUmUtcmVnaXN0ZXJcbiAgICAgIC8vIHRvIGRyb3AgYW55IHBhcnRpYWwgbWV0YWRhdGEgYW5kIGxlYXZlIHRoZSBtb2RlbCBkZWZlcnJlZCBzbyBzdGFydHVwIHN0aWxsXG4gICAgICAvLyBzdWNjZWVkczsgaXQgaW5pdGlhbGl6ZXMgbGF6aWx5IG9uIGZpcnN0IHRlcm1pbmFsIHVzZS5cbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBMZWF2aW5nICR7bW9kZWxDbGFzcy5uYW1lfSBkZWZlcnJlZCAtIHRhYmxlIG1ldGFkYXRhIHVuYXZhaWxhYmxlIGF0IHN0YXJ0dXBgLCBlcnJvcilcbiAgICAgIG1vZGVsQ2xhc3MucmVnaXN0ZXJSZWNvcmRDbGFzcyh7Y29uZmlndXJhdGlvbn0pXG4gICAgfVxuICB9XG59XG4iXX0=