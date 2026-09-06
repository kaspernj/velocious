import DbBaseCommand from "./base-command.js";
import { digg } from "diggerize";
import { incorporate } from "incorporator";
import TableData from "../../../database/table-data/index.js";
export default class DbCreate extends DbBaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | Array<object>>} - Resolves with SQL statements when running in dry mode.
     */
    async execute() {
        for (const databaseIdentifier of this.getConfiguration().getDatabaseIdentifiers()) {
            const databaseType = this.getConfiguration().getDatabaseType(databaseIdentifier);
            const databasePool = this.getConfiguration().getDatabasePool(databaseIdentifier);
            const newConfiguration = incorporate({}, databasePool.getConfiguration());
            if (this.args.testing)
                this.result = [];
            // Use a database known to exist. Since we are creating the database, it shouldn't actually exist which would make connecting fail.
            newConfiguration.database = newConfiguration.useDatabase || "mysql";
            // Login can fail because given db name doesn't exist, which it might not because we are trying to create it right now.
            if (databaseType == "mssql" && newConfiguration.sqlConfig?.database) {
                delete newConfiguration.sqlConfig.database;
            }
            await this.withDirectDatabaseConnection(newConfiguration, async () => {
                if (databaseType != "sqlite") {
                    await this.createDatabase(databaseIdentifier);
                }
                await this.createSchemaMigrationsTable();
            });
            if (this.args.testing)
                return this.result;
        }
    }
    /**
     * Runs create database.
     * @param {string} databaseIdentifier - Database identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async createDatabase(databaseIdentifier) {
        const databaseConfiguration = digg(this.getConfiguration().getDatabaseConfiguration(), databaseIdentifier);
        const databaseName = digg(databaseConfiguration, "database");
        const { databaseCharset, databaseCollation } = databaseConfiguration;
        const sqls = this.getDatabaseConnection().createDatabaseSql(databaseName, { ifNotExists: true, databaseCharset, databaseCollation });
        await this.queryOrCollectSqls(sqls, (sql) => ({ databaseName, sql }), { requestTimeoutMs: 0 });
    }
    /**
     * Runs create schema migrations table.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async createSchemaMigrationsTable() {
        const schemaMigrationsTable = new TableData("schema_migrations", { ifNotExists: true });
        schemaMigrationsTable.string("version", { null: false, primaryKey: true });
        const createSchemaMigrationsTableSqls = await this.getDatabaseConnection().createTableSql(schemaMigrationsTable);
        await this.queryOrCollectSqls(createSchemaMigrationsTableSqls, (createSchemaMigrationsTableSql) => ({ createSchemaMigrationsTableSql }));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2NsaS9jb21tYW5kcy9kYi9jcmVhdGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxhQUFhLE1BQU0sbUJBQW1CLENBQUE7QUFDN0MsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sY0FBYyxDQUFBO0FBQ3hDLE9BQU8sU0FBUyxNQUFNLHVDQUF1QyxDQUFBO0FBRTdELE1BQU0sQ0FBQyxPQUFPLE9BQU8sUUFBUyxTQUFRLGFBQWE7SUFDakQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxLQUFLLE1BQU0sa0JBQWtCLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsc0JBQXNCLEVBQUUsRUFBRSxDQUFDO1lBQ2xGLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBQ2hGLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBQ2hGLE1BQU0sZ0JBQWdCLEdBQUcsV0FBVyxDQUFDLEVBQUUsRUFBRSxZQUFZLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFBO1lBRXpFLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPO2dCQUFFLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFBO1lBRXZDLG1JQUFtSTtZQUNuSSxnQkFBZ0IsQ0FBQyxRQUFRLEdBQUcsZ0JBQWdCLENBQUMsV0FBVyxJQUFJLE9BQU8sQ0FBQTtZQUVuRSx1SEFBdUg7WUFDdkgsSUFBSSxZQUFZLElBQUksT0FBTyxJQUFJLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxRQUFRLEVBQUUsQ0FBQztnQkFDcEUsT0FBTyxnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFBO1lBQzVDLENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxnQkFBZ0IsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbkUsSUFBSSxZQUFZLElBQUksUUFBUSxFQUFFLENBQUM7b0JBQzdCLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO2dCQUMvQyxDQUFDO2dCQUVELE1BQU0sSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7WUFDMUMsQ0FBQyxDQUFDLENBQUE7WUFFRixJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTztnQkFBRSxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUE7UUFDM0MsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxrQkFBa0I7UUFDckMsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsd0JBQXdCLEVBQUUsRUFBRSxrQkFBa0IsQ0FBQyxDQUFBO1FBQzFHLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUM1RCxNQUFNLEVBQUMsZUFBZSxFQUFFLGlCQUFpQixFQUFDLEdBQUcscUJBQXFCLENBQUE7UUFDbEUsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsaUJBQWlCLENBQUMsWUFBWSxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxlQUFlLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO1FBQ2xJLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFDLFlBQVksRUFBRSxHQUFHLEVBQUMsQ0FBQyxFQUFFLEVBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxFQUFDLENBQUMsQ0FBQTtJQUM1RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLDJCQUEyQjtRQUMvQixNQUFNLHFCQUFxQixHQUFHLElBQUksU0FBUyxDQUFDLG1CQUFtQixFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFFckYscUJBQXFCLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFFeEUsTUFBTSwrQkFBK0IsR0FBRyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLGNBQWMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1FBQ2hILE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLCtCQUErQixFQUFFLENBQUMsOEJBQThCLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBQyw4QkFBOEIsRUFBQyxDQUFDLENBQUMsQ0FBQTtJQUN4SSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgRGJCYXNlQ29tbWFuZCBmcm9tIFwiLi9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCB7aW5jb3Jwb3JhdGV9IGZyb20gXCJpbmNvcnBvcmF0b3JcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vLi4vLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIERiQ3JlYXRlIGV4dGVuZHMgRGJCYXNlQ29tbWFuZHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZCB8IEFycmF5PG9iamVjdD4+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMgd2hlbiBydW5uaW5nIGluIGRyeSBtb2RlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBmb3IgKGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciBvZiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICAgIGNvbnN0IGRhdGFiYXNlVHlwZSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlVHlwZShkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgICBjb25zdCBkYXRhYmFzZVBvb2wgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgY29uc3QgbmV3Q29uZmlndXJhdGlvbiA9IGluY29ycG9yYXRlKHt9LCBkYXRhYmFzZVBvb2wuZ2V0Q29uZmlndXJhdGlvbigpKVxuXG4gICAgICBpZiAodGhpcy5hcmdzLnRlc3RpbmcpIHRoaXMucmVzdWx0ID0gW11cblxuICAgICAgLy8gVXNlIGEgZGF0YWJhc2Uga25vd24gdG8gZXhpc3QuIFNpbmNlIHdlIGFyZSBjcmVhdGluZyB0aGUgZGF0YWJhc2UsIGl0IHNob3VsZG4ndCBhY3R1YWxseSBleGlzdCB3aGljaCB3b3VsZCBtYWtlIGNvbm5lY3RpbmcgZmFpbC5cbiAgICAgIG5ld0NvbmZpZ3VyYXRpb24uZGF0YWJhc2UgPSBuZXdDb25maWd1cmF0aW9uLnVzZURhdGFiYXNlIHx8IFwibXlzcWxcIlxuXG4gICAgICAvLyBMb2dpbiBjYW4gZmFpbCBiZWNhdXNlIGdpdmVuIGRiIG5hbWUgZG9lc24ndCBleGlzdCwgd2hpY2ggaXQgbWlnaHQgbm90IGJlY2F1c2Ugd2UgYXJlIHRyeWluZyB0byBjcmVhdGUgaXQgcmlnaHQgbm93LlxuICAgICAgaWYgKGRhdGFiYXNlVHlwZSA9PSBcIm1zc3FsXCIgJiYgbmV3Q29uZmlndXJhdGlvbi5zcWxDb25maWc/LmRhdGFiYXNlKSB7XG4gICAgICAgIGRlbGV0ZSBuZXdDb25maWd1cmF0aW9uLnNxbENvbmZpZy5kYXRhYmFzZVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLndpdGhEaXJlY3REYXRhYmFzZUNvbm5lY3Rpb24obmV3Q29uZmlndXJhdGlvbiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoZGF0YWJhc2VUeXBlICE9IFwic3FsaXRlXCIpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZURhdGFiYXNlKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlU2NoZW1hTWlncmF0aW9uc1RhYmxlKClcbiAgICAgIH0pXG5cbiAgICAgIGlmICh0aGlzLmFyZ3MudGVzdGluZykgcmV0dXJuIHRoaXMucmVzdWx0XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZURhdGFiYXNlKGRhdGFiYXNlSWRlbnRpZmllcikge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IGRpZ2codGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKCksIGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBkYXRhYmFzZU5hbWUgPSBkaWdnKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgXCJkYXRhYmFzZVwiKVxuICAgIGNvbnN0IHtkYXRhYmFzZUNoYXJzZXQsIGRhdGFiYXNlQ29sbGF0aW9ufSA9IGRhdGFiYXNlQ29uZmlndXJhdGlvblxuICAgIGNvbnN0IHNxbHMgPSB0aGlzLmdldERhdGFiYXNlQ29ubmVjdGlvbigpLmNyZWF0ZURhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwge2lmTm90RXhpc3RzOiB0cnVlLCBkYXRhYmFzZUNoYXJzZXQsIGRhdGFiYXNlQ29sbGF0aW9ufSlcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5T3JDb2xsZWN0U3FscyhzcWxzLCAoc3FsKSA9PiAoe2RhdGFiYXNlTmFtZSwgc3FsfSksIHtyZXF1ZXN0VGltZW91dE1zOiAwfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBzY2hlbWEgbWlncmF0aW9ucyB0YWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVNjaGVtYU1pZ3JhdGlvbnNUYWJsZSgpIHtcbiAgICBjb25zdCBzY2hlbWFNaWdyYXRpb25zVGFibGUgPSBuZXcgVGFibGVEYXRhKFwic2NoZW1hX21pZ3JhdGlvbnNcIiwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHNjaGVtYU1pZ3JhdGlvbnNUYWJsZS5zdHJpbmcoXCJ2ZXJzaW9uXCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG5cbiAgICBjb25zdCBjcmVhdGVTY2hlbWFNaWdyYXRpb25zVGFibGVTcWxzID0gYXdhaXQgdGhpcy5nZXREYXRhYmFzZUNvbm5lY3Rpb24oKS5jcmVhdGVUYWJsZVNxbChzY2hlbWFNaWdyYXRpb25zVGFibGUpXG4gICAgYXdhaXQgdGhpcy5xdWVyeU9yQ29sbGVjdFNxbHMoY3JlYXRlU2NoZW1hTWlncmF0aW9uc1RhYmxlU3FscywgKGNyZWF0ZVNjaGVtYU1pZ3JhdGlvbnNUYWJsZVNxbCkgPT4gKHtjcmVhdGVTY2hlbWFNaWdyYXRpb25zVGFibGVTcWx9KSlcbiAgfVxufVxuIl19