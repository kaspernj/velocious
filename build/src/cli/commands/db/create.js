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
        await this.queryOrCollectSqls(sqls, (sql) => ({ databaseName, sql }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2NsaS9jb21tYW5kcy9kYi9jcmVhdGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxhQUFhLE1BQU0sbUJBQW1CLENBQUE7QUFDN0MsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sY0FBYyxDQUFBO0FBQ3hDLE9BQU8sU0FBUyxNQUFNLHVDQUF1QyxDQUFBO0FBRTdELE1BQU0sQ0FBQyxPQUFPLE9BQU8sUUFBUyxTQUFRLGFBQWE7SUFDakQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxLQUFLLE1BQU0sa0JBQWtCLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsc0JBQXNCLEVBQUUsRUFBRSxDQUFDO1lBQ2xGLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBQ2hGLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBQ2hGLE1BQU0sZ0JBQWdCLEdBQUcsV0FBVyxDQUFDLEVBQUUsRUFBRSxZQUFZLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFBO1lBRXpFLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPO2dCQUFFLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFBO1lBRXZDLG1JQUFtSTtZQUNuSSxnQkFBZ0IsQ0FBQyxRQUFRLEdBQUcsZ0JBQWdCLENBQUMsV0FBVyxJQUFJLE9BQU8sQ0FBQTtZQUVuRSx1SEFBdUg7WUFDdkgsSUFBSSxZQUFZLElBQUksT0FBTyxJQUFJLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxRQUFRLEVBQUUsQ0FBQztnQkFDcEUsT0FBTyxnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFBO1lBQzVDLENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxnQkFBZ0IsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbkUsSUFBSSxZQUFZLElBQUksUUFBUSxFQUFFLENBQUM7b0JBQzdCLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO2dCQUMvQyxDQUFDO2dCQUVELE1BQU0sSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7WUFDMUMsQ0FBQyxDQUFDLENBQUE7WUFFRixJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTztnQkFBRSxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUE7UUFDM0MsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxrQkFBa0I7UUFDckMsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsd0JBQXdCLEVBQUUsRUFBRSxrQkFBa0IsQ0FBQyxDQUFBO1FBQzFHLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUM1RCxNQUFNLEVBQUMsZUFBZSxFQUFFLGlCQUFpQixFQUFDLEdBQUcscUJBQXFCLENBQUE7UUFDbEUsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsaUJBQWlCLENBQUMsWUFBWSxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxlQUFlLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO1FBQ2xJLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFDLFlBQVksRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFDLENBQUE7SUFDckUsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQywyQkFBMkI7UUFDL0IsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRXJGLHFCQUFxQixDQUFDLE1BQU0sQ0FBQyxTQUFTLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRXhFLE1BQU0sK0JBQStCLEdBQUcsTUFBTSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxjQUFjLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUNoSCxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQywrQkFBK0IsRUFBRSxDQUFDLDhCQUE4QixFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUMsOEJBQThCLEVBQUMsQ0FBQyxDQUFDLENBQUE7SUFDeEksQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IERiQmFzZUNvbW1hbmQgZnJvbSBcIi4vYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uLy4uLy4uL2RhdGFiYXNlL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBEYkNyZWF0ZSBleHRlbmRzIERiQmFzZUNvbW1hbmR7XG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQgfCBBcnJheTxvYmplY3Q+Pn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzIHdoZW4gcnVubmluZyBpbiBkcnkgbW9kZS5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgZm9yIChjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgb2YgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgICBjb25zdCBkYXRhYmFzZVR5cGUgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVR5cGUoZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgY29uc3QgZGF0YWJhc2VQb29sID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICAgIGNvbnN0IG5ld0NvbmZpZ3VyYXRpb24gPSBpbmNvcnBvcmF0ZSh7fSwgZGF0YWJhc2VQb29sLmdldENvbmZpZ3VyYXRpb24oKSlcblxuICAgICAgaWYgKHRoaXMuYXJncy50ZXN0aW5nKSB0aGlzLnJlc3VsdCA9IFtdXG5cbiAgICAgIC8vIFVzZSBhIGRhdGFiYXNlIGtub3duIHRvIGV4aXN0LiBTaW5jZSB3ZSBhcmUgY3JlYXRpbmcgdGhlIGRhdGFiYXNlLCBpdCBzaG91bGRuJ3QgYWN0dWFsbHkgZXhpc3Qgd2hpY2ggd291bGQgbWFrZSBjb25uZWN0aW5nIGZhaWwuXG4gICAgICBuZXdDb25maWd1cmF0aW9uLmRhdGFiYXNlID0gbmV3Q29uZmlndXJhdGlvbi51c2VEYXRhYmFzZSB8fCBcIm15c3FsXCJcblxuICAgICAgLy8gTG9naW4gY2FuIGZhaWwgYmVjYXVzZSBnaXZlbiBkYiBuYW1lIGRvZXNuJ3QgZXhpc3QsIHdoaWNoIGl0IG1pZ2h0IG5vdCBiZWNhdXNlIHdlIGFyZSB0cnlpbmcgdG8gY3JlYXRlIGl0IHJpZ2h0IG5vdy5cbiAgICAgIGlmIChkYXRhYmFzZVR5cGUgPT0gXCJtc3NxbFwiICYmIG5ld0NvbmZpZ3VyYXRpb24uc3FsQ29uZmlnPy5kYXRhYmFzZSkge1xuICAgICAgICBkZWxldGUgbmV3Q29uZmlndXJhdGlvbi5zcWxDb25maWcuZGF0YWJhc2VcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy53aXRoRGlyZWN0RGF0YWJhc2VDb25uZWN0aW9uKG5ld0NvbmZpZ3VyYXRpb24sIGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKGRhdGFiYXNlVHlwZSAhPSBcInNxbGl0ZVwiKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVEYXRhYmFzZShkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZVNjaGVtYU1pZ3JhdGlvbnNUYWJsZSgpXG4gICAgICB9KVxuXG4gICAgICBpZiAodGhpcy5hcmdzLnRlc3RpbmcpIHJldHVybiB0aGlzLnJlc3VsdFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjcmVhdGVEYXRhYmFzZShkYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSBkaWdnKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpLCBkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgZGF0YWJhc2VOYW1lID0gZGlnZyhkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIFwiZGF0YWJhc2VcIilcbiAgICBjb25zdCB7ZGF0YWJhc2VDaGFyc2V0LCBkYXRhYmFzZUNvbGxhdGlvbn0gPSBkYXRhYmFzZUNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBzcWxzID0gdGhpcy5nZXREYXRhYmFzZUNvbm5lY3Rpb24oKS5jcmVhdGVEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIHtpZk5vdEV4aXN0czogdHJ1ZSwgZGF0YWJhc2VDaGFyc2V0LCBkYXRhYmFzZUNvbGxhdGlvbn0pXG4gICAgYXdhaXQgdGhpcy5xdWVyeU9yQ29sbGVjdFNxbHMoc3FscywgKHNxbCkgPT4gKHtkYXRhYmFzZU5hbWUsIHNxbH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIHNjaGVtYSBtaWdyYXRpb25zIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlU2NoZW1hTWlncmF0aW9uc1RhYmxlKCkge1xuICAgIGNvbnN0IHNjaGVtYU1pZ3JhdGlvbnNUYWJsZSA9IG5ldyBUYWJsZURhdGEoXCJzY2hlbWFfbWlncmF0aW9uc1wiLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgc2NoZW1hTWlncmF0aW9uc1RhYmxlLnN0cmluZyhcInZlcnNpb25cIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcblxuICAgIGNvbnN0IGNyZWF0ZVNjaGVtYU1pZ3JhdGlvbnNUYWJsZVNxbHMgPSBhd2FpdCB0aGlzLmdldERhdGFiYXNlQ29ubmVjdGlvbigpLmNyZWF0ZVRhYmxlU3FsKHNjaGVtYU1pZ3JhdGlvbnNUYWJsZSlcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5T3JDb2xsZWN0U3FscyhjcmVhdGVTY2hlbWFNaWdyYXRpb25zVGFibGVTcWxzLCAoY3JlYXRlU2NoZW1hTWlncmF0aW9uc1RhYmxlU3FsKSA9PiAoe2NyZWF0ZVNjaGVtYU1pZ3JhdGlvbnNUYWJsZVNxbH0pKVxuICB9XG59XG4iXX0=