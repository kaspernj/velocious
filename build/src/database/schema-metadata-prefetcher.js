// @ts-check
import Logger from "../logger.js";
/**
 * Loads table and column metadata for a whole set of model classes up front.
 *
 * Model initialization otherwise reads each table's columns on its own, which
 * turns a boot into one catalog query per model (and per HTTP worker process).
 * Drivers that can answer for many tables in one statement are asked to do so;
 * the resulting columns are seeded into the driver's per-table schema cache, so
 * the initialization pass that follows resolves without querying at all.
 */
export default class SchemaMetadataPrefetcher {
    /**
     * Builds a prefetcher for one configuration.
     * @param {object} args - Prefetcher args.
     * @param {import("../configuration.js").default} args.configuration - Configuration owning the database connections.
     * @param {number} [args.concurrency] - Concurrency for drivers that can only read one table per query.
     * @param {import("../logger.js").default} [args.logger] - Logger for debug output.
     */
    constructor({ configuration, concurrency = 8, logger }) {
        this.configuration = configuration;
        this.concurrency = concurrency;
        this.logger = logger || new Logger(this);
    }
    /**
     * Prefetches column metadata for every model class that has a reachable table.
     *
     * Models whose table or connection is unavailable are skipped: their
     * initialization stays deferred and will initialize lazily on first use, which
     * is the same contract the per-model initialization applies.
     * @param {{modelClasses: Array<typeof import("./record/index.js").default>}} args - Model classes to prefetch for.
     * @returns {Promise<void>}
     */
    async prefetch({ modelClasses }) {
        /** @type {Map<import("./drivers/base.js").default, Map<string, import("./drivers/base-table.js").default>>} */
        const tablesByDriver = new Map();
        for (const modelClass of modelClasses) {
            const table = await this.tableFor(modelClass);
            if (!table)
                continue;
            const driver = table.getDriver();
            let tables = tablesByDriver.get(driver);
            if (!tables) {
                tables = new Map();
                tablesByDriver.set(driver, tables);
            }
            tables.set(table.getName(), table);
            // Translated models initialize their translation class as part of the same
            // startup pass, so its table has to be part of the batch as well - otherwise
            // every translated model still costs its own catalog read.
            const translationTable = await this.tableByName(driver, modelClass.getTranslationsTableName());
            if (translationTable)
                tables.set(translationTable.getName(), translationTable);
        }
        const startedAt = Date.now();
        let tableCount = 0;
        for (const [driver, tables] of tablesByDriver) {
            await driver.prefetchTableColumns([...tables.values()], { concurrency: this.concurrency });
            tableCount += tables.size;
        }
        void this.logger.debug(() => ["schema metadata prefetched", {
                databases: tablesByDriver.size,
                durationMs: Date.now() - startedAt,
                tables: tableCount
            }]);
    }
    /**
     * Resolves a model's table without initializing its record metadata.
     * @param {typeof import("./record/index.js").default} modelClass - Model class to resolve a table for.
     * @returns {Promise<import("./drivers/base-table.js").default | null>} Table, or null when it is not reachable.
     */
    async tableFor(modelClass) {
        try {
            const driver = modelClass.connection({ enforceTenantDatabaseScope: false });
            return await this.tableByName(driver, modelClass.tableName());
        }
        catch (error) {
            // A model whose database is unreachable - or whose table is optional and
            // absent - stays deferred rather than failing startup; it initializes
            // lazily on first use.
            void this.logger.debug(() => [`Leaving ${modelClass.name} out of schema prefetch`, error]);
            return null;
        }
    }
    /**
     * Looks a table up in the driver's table list without throwing when absent.
     * @param {import("./drivers/base.js").default} driver - Driver owning the table.
     * @param {string} tableName - Table name to resolve.
     * @returns {Promise<import("./drivers/base-table.js").default | null>} Table, or null when it does not exist.
     */
    async tableByName(driver, tableName) {
        return await driver.getTableByName(tableName, { throwError: false }) || null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hLW1ldGFkYXRhLXByZWZldGNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2Uvc2NoZW1hLW1ldGFkYXRhLXByZWZldGNoZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUVqQzs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0JBQXdCO0lBQzNDOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsV0FBVyxHQUFHLENBQUMsRUFBRSxNQUFNLEVBQUM7UUFDbEQsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUE7UUFDOUIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFDLFlBQVksRUFBQztRQUMzQiwrR0FBK0c7UUFDL0csTUFBTSxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUVoQyxLQUFLLE1BQU0sVUFBVSxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3RDLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUU3QyxJQUFJLENBQUMsS0FBSztnQkFBRSxTQUFRO1lBRXBCLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxTQUFTLEVBQUUsQ0FBQTtZQUNoQyxJQUFJLE1BQU0sR0FBRyxjQUFjLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBRXZDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDWixNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtnQkFDbEIsY0FBYyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUE7WUFDcEMsQ0FBQztZQUVELE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBRWxDLDJFQUEyRTtZQUMzRSw2RUFBNkU7WUFDN0UsMkRBQTJEO1lBQzNELE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxVQUFVLENBQUMsd0JBQXdCLEVBQUUsQ0FBQyxDQUFBO1lBRTlGLElBQUksZ0JBQWdCO2dCQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQTtRQUNoRixDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQzVCLElBQUksVUFBVSxHQUFHLENBQUMsQ0FBQTtRQUVsQixLQUFLLE1BQU0sQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLElBQUksY0FBYyxFQUFFLENBQUM7WUFDOUMsTUFBTSxNQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUMsQ0FBQyxDQUFBO1lBQ3hGLFVBQVUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFBO1FBQzNCLENBQUM7UUFFRCxLQUFLLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsNEJBQTRCLEVBQUU7Z0JBQzFELFNBQVMsRUFBRSxjQUFjLENBQUMsSUFBSTtnQkFDOUIsVUFBVSxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxTQUFTO2dCQUNsQyxNQUFNLEVBQUUsVUFBVTthQUNuQixDQUFDLENBQUMsQ0FBQTtJQUNMLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxVQUFVO1FBQ3ZCLElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsRUFBQywwQkFBMEIsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBRXpFLE9BQU8sTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxVQUFVLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQTtRQUMvRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLHlFQUF5RTtZQUN6RSxzRUFBc0U7WUFDdEUsdUJBQXVCO1lBQ3ZCLEtBQUssSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxXQUFXLFVBQVUsQ0FBQyxJQUFJLHlCQUF5QixFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFFMUYsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUUsU0FBUztRQUNqQyxPQUFPLE1BQU0sTUFBTSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEVBQUUsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFDLENBQUMsSUFBSSxJQUFJLENBQUE7SUFDNUUsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5cbi8qKlxuICogTG9hZHMgdGFibGUgYW5kIGNvbHVtbiBtZXRhZGF0YSBmb3IgYSB3aG9sZSBzZXQgb2YgbW9kZWwgY2xhc3NlcyB1cCBmcm9udC5cbiAqXG4gKiBNb2RlbCBpbml0aWFsaXphdGlvbiBvdGhlcndpc2UgcmVhZHMgZWFjaCB0YWJsZSdzIGNvbHVtbnMgb24gaXRzIG93biwgd2hpY2hcbiAqIHR1cm5zIGEgYm9vdCBpbnRvIG9uZSBjYXRhbG9nIHF1ZXJ5IHBlciBtb2RlbCAoYW5kIHBlciBIVFRQIHdvcmtlciBwcm9jZXNzKS5cbiAqIERyaXZlcnMgdGhhdCBjYW4gYW5zd2VyIGZvciBtYW55IHRhYmxlcyBpbiBvbmUgc3RhdGVtZW50IGFyZSBhc2tlZCB0byBkbyBzbztcbiAqIHRoZSByZXN1bHRpbmcgY29sdW1ucyBhcmUgc2VlZGVkIGludG8gdGhlIGRyaXZlcidzIHBlci10YWJsZSBzY2hlbWEgY2FjaGUsIHNvXG4gKiB0aGUgaW5pdGlhbGl6YXRpb24gcGFzcyB0aGF0IGZvbGxvd3MgcmVzb2x2ZXMgd2l0aG91dCBxdWVyeWluZyBhdCBhbGwuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNjaGVtYU1ldGFkYXRhUHJlZmV0Y2hlciB7XG4gIC8qKlxuICAgKiBCdWlsZHMgYSBwcmVmZXRjaGVyIGZvciBvbmUgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQcmVmZXRjaGVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgZGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5jb25jdXJyZW5jeV0gLSBDb25jdXJyZW5jeSBmb3IgZHJpdmVycyB0aGF0IGNhbiBvbmx5IHJlYWQgb25lIHRhYmxlIHBlciBxdWVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9sb2dnZXIuanNcIikuZGVmYXVsdH0gW2FyZ3MubG9nZ2VyXSAtIExvZ2dlciBmb3IgZGVidWcgb3V0cHV0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGNvbmN1cnJlbmN5ID0gOCwgbG9nZ2VyfSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmNvbmN1cnJlbmN5ID0gY29uY3VycmVuY3lcbiAgICB0aGlzLmxvZ2dlciA9IGxvZ2dlciB8fCBuZXcgTG9nZ2VyKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUHJlZmV0Y2hlcyBjb2x1bW4gbWV0YWRhdGEgZm9yIGV2ZXJ5IG1vZGVsIGNsYXNzIHRoYXQgaGFzIGEgcmVhY2hhYmxlIHRhYmxlLlxuICAgKlxuICAgKiBNb2RlbHMgd2hvc2UgdGFibGUgb3IgY29ubmVjdGlvbiBpcyB1bmF2YWlsYWJsZSBhcmUgc2tpcHBlZDogdGhlaXJcbiAgICogaW5pdGlhbGl6YXRpb24gc3RheXMgZGVmZXJyZWQgYW5kIHdpbGwgaW5pdGlhbGl6ZSBsYXppbHkgb24gZmlyc3QgdXNlLCB3aGljaFxuICAgKiBpcyB0aGUgc2FtZSBjb250cmFjdCB0aGUgcGVyLW1vZGVsIGluaXRpYWxpemF0aW9uIGFwcGxpZXMuXG4gICAqIEBwYXJhbSB7e21vZGVsQ2xhc3NlczogQXJyYXk8dHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fX0gYXJncyAtIE1vZGVsIGNsYXNzZXMgdG8gcHJlZmV0Y2ggZm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHByZWZldGNoKHttb2RlbENsYXNzZXN9KSB7XG4gICAgLyoqIEB0eXBlIHtNYXA8aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD4+fSAqL1xuICAgIGNvbnN0IHRhYmxlc0J5RHJpdmVyID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgbW9kZWxDbGFzc2VzKSB7XG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IHRoaXMudGFibGVGb3IobW9kZWxDbGFzcylcblxuICAgICAgaWYgKCF0YWJsZSkgY29udGludWVcblxuICAgICAgY29uc3QgZHJpdmVyID0gdGFibGUuZ2V0RHJpdmVyKClcbiAgICAgIGxldCB0YWJsZXMgPSB0YWJsZXNCeURyaXZlci5nZXQoZHJpdmVyKVxuXG4gICAgICBpZiAoIXRhYmxlcykge1xuICAgICAgICB0YWJsZXMgPSBuZXcgTWFwKClcbiAgICAgICAgdGFibGVzQnlEcml2ZXIuc2V0KGRyaXZlciwgdGFibGVzKVxuICAgICAgfVxuXG4gICAgICB0YWJsZXMuc2V0KHRhYmxlLmdldE5hbWUoKSwgdGFibGUpXG5cbiAgICAgIC8vIFRyYW5zbGF0ZWQgbW9kZWxzIGluaXRpYWxpemUgdGhlaXIgdHJhbnNsYXRpb24gY2xhc3MgYXMgcGFydCBvZiB0aGUgc2FtZVxuICAgICAgLy8gc3RhcnR1cCBwYXNzLCBzbyBpdHMgdGFibGUgaGFzIHRvIGJlIHBhcnQgb2YgdGhlIGJhdGNoIGFzIHdlbGwgLSBvdGhlcndpc2VcbiAgICAgIC8vIGV2ZXJ5IHRyYW5zbGF0ZWQgbW9kZWwgc3RpbGwgY29zdHMgaXRzIG93biBjYXRhbG9nIHJlYWQuXG4gICAgICBjb25zdCB0cmFuc2xhdGlvblRhYmxlID0gYXdhaXQgdGhpcy50YWJsZUJ5TmFtZShkcml2ZXIsIG1vZGVsQ2xhc3MuZ2V0VHJhbnNsYXRpb25zVGFibGVOYW1lKCkpXG5cbiAgICAgIGlmICh0cmFuc2xhdGlvblRhYmxlKSB0YWJsZXMuc2V0KHRyYW5zbGF0aW9uVGFibGUuZ2V0TmFtZSgpLCB0cmFuc2xhdGlvblRhYmxlKVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KClcbiAgICBsZXQgdGFibGVDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgW2RyaXZlciwgdGFibGVzXSBvZiB0YWJsZXNCeURyaXZlcikge1xuICAgICAgYXdhaXQgZHJpdmVyLnByZWZldGNoVGFibGVDb2x1bW5zKFsuLi50YWJsZXMudmFsdWVzKCldLCB7Y29uY3VycmVuY3k6IHRoaXMuY29uY3VycmVuY3l9KVxuICAgICAgdGFibGVDb3VudCArPSB0YWJsZXMuc2l6ZVxuICAgIH1cblxuICAgIHZvaWQgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2NoZW1hIG1ldGFkYXRhIHByZWZldGNoZWRcIiwge1xuICAgICAgZGF0YWJhc2VzOiB0YWJsZXNCeURyaXZlci5zaXplLFxuICAgICAgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCxcbiAgICAgIHRhYmxlczogdGFibGVDb3VudFxuICAgIH1dKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgbW9kZWwncyB0YWJsZSB3aXRob3V0IGluaXRpYWxpemluZyBpdHMgcmVjb3JkIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gcmVzb2x2ZSBhIHRhYmxlIGZvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCB8IG51bGw+fSBUYWJsZSwgb3IgbnVsbCB3aGVuIGl0IGlzIG5vdCByZWFjaGFibGUuXG4gICAqL1xuICBhc3luYyB0YWJsZUZvcihtb2RlbENsYXNzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRyaXZlciA9IG1vZGVsQ2xhc3MuY29ubmVjdGlvbih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGU6IGZhbHNlfSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMudGFibGVCeU5hbWUoZHJpdmVyLCBtb2RlbENsYXNzLnRhYmxlTmFtZSgpKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBBIG1vZGVsIHdob3NlIGRhdGFiYXNlIGlzIHVucmVhY2hhYmxlIC0gb3Igd2hvc2UgdGFibGUgaXMgb3B0aW9uYWwgYW5kXG4gICAgICAvLyBhYnNlbnQgLSBzdGF5cyBkZWZlcnJlZCByYXRoZXIgdGhhbiBmYWlsaW5nIHN0YXJ0dXA7IGl0IGluaXRpYWxpemVzXG4gICAgICAvLyBsYXppbHkgb24gZmlyc3QgdXNlLlxuICAgICAgdm9pZCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbYExlYXZpbmcgJHttb2RlbENsYXNzLm5hbWV9IG91dCBvZiBzY2hlbWEgcHJlZmV0Y2hgLCBlcnJvcl0pXG5cbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvb2tzIGEgdGFibGUgdXAgaW4gdGhlIGRyaXZlcidzIHRhYmxlIGxpc3Qgd2l0aG91dCB0aHJvd2luZyB3aGVuIGFic2VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkcml2ZXIgLSBEcml2ZXIgb3duaW5nIHRoZSB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCB8IG51bGw+fSBUYWJsZSwgb3IgbnVsbCB3aGVuIGl0IGRvZXMgbm90IGV4aXN0LlxuICAgKi9cbiAgYXN5bmMgdGFibGVCeU5hbWUoZHJpdmVyLCB0YWJsZU5hbWUpIHtcbiAgICByZXR1cm4gYXdhaXQgZHJpdmVyLmdldFRhYmxlQnlOYW1lKHRhYmxlTmFtZSwge3Rocm93RXJyb3I6IGZhbHNlfSkgfHwgbnVsbFxuICB9XG59XG4iXX0=