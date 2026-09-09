import DbBaseCommand from "./base-command.js";
import { digg } from "diggerize";
import { incorporate } from "incorporator";
export default class DbDrop extends DbBaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | Array<object>>} - Resolves with SQL statements when running in dry mode.
     */
    async execute() {
        const environment = this.getConfiguration().getEnvironment();
        if (environment != "development" && environment != "test") {
            throw new Error(`This command should only be executed on development and test environments and not: ${environment}`);
        }
        for (const databaseIdentifier of this.getConfiguration().getDatabaseIdentifiers()) {
            const databaseType = this.getConfiguration().getDatabaseType(databaseIdentifier);
            if (this.args.testing)
                this.result = [];
            if (databaseType != "sqlite") {
                const databasePool = this.getConfiguration().getDatabasePool(databaseIdentifier);
                const newConfiguration = incorporate({}, databasePool.getConfiguration());
                const targetDatabaseName = digg(this.getConfiguration().getDatabaseConfiguration(), databaseIdentifier, "database");
                // Connect to a known-existing system database: the target is about to
                // be dropped (so we can't be connected to it), Postgres rejects
                // DROP DATABASE while connected to it, and configured `useDatabase`
                // may happen to equal the target — in that case fall through to the
                // driver's system default.
                const configuredFallback = newConfiguration.useDatabase;
                const useConfiguredFallback = typeof configuredFallback == "string" && configuredFallback.length > 0 && configuredFallback != targetDatabaseName;
                if (useConfiguredFallback) {
                    newConfiguration.database = configuredFallback;
                }
                else if (databaseType == "mysql") {
                    delete newConfiguration.database;
                }
                else {
                    newConfiguration.database = this.systemFallbackDatabaseName(databaseType);
                }
                if (databaseType == "mssql" && newConfiguration.sqlConfig?.database) {
                    delete newConfiguration.sqlConfig.database;
                }
                await this.withDirectDatabaseConnection(newConfiguration, async () => {
                    await this.dropDatabase(databaseIdentifier);
                });
            }
            if (this.args.testing)
                return this.result;
        }
    }
    /**
     * Runs system fallback database name.
     * @param {string} databaseType - Database type.
     * @returns {string} - System/maintenance database name for that driver.
     */
    systemFallbackDatabaseName(databaseType) {
        if (databaseType == "pgsql")
            return "postgres";
        if (databaseType == "mssql")
            return "master";
        return "mysql";
    }
    /**
     * Runs drop database.
     * @param {string} databaseIdentifier - Database identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async dropDatabase(databaseIdentifier) {
        const databaseName = digg(this.getConfiguration().getDatabaseConfiguration(), databaseIdentifier, "database");
        const sqls = this.getDatabaseConnection().dropDatabaseSql(databaseName, { ifExists: true });
        await this.queryOrCollectSqls(sqls, (sql) => ({ databaseName, sql }));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHJvcC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9jbGkvY29tbWFuZHMvZGIvZHJvcC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLGFBQWEsTUFBTSxtQkFBbUIsQ0FBQTtBQUM3QyxPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFFeEMsTUFBTSxDQUFDLE9BQU8sT0FBTyxNQUFPLFNBQVEsYUFBYTtJQUMvQzs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRTVELElBQUksV0FBVyxJQUFJLGFBQWEsSUFBSSxXQUFXLElBQUksTUFBTSxFQUFFLENBQUM7WUFDMUQsTUFBTSxJQUFJLEtBQUssQ0FBQyxzRkFBc0YsV0FBVyxFQUFFLENBQUMsQ0FBQTtRQUN0SCxDQUFDO1FBRUQsS0FBSyxNQUFNLGtCQUFrQixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLHNCQUFzQixFQUFFLEVBQUUsQ0FBQztZQUNsRixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxlQUFlLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtZQUVoRixJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTztnQkFBRSxJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQTtZQUV2QyxJQUFJLFlBQVksSUFBSSxRQUFRLEVBQUUsQ0FBQztnQkFDN0IsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsZUFBZSxDQUFDLGtCQUFrQixDQUFDLENBQUE7Z0JBQ2hGLE1BQU0sZ0JBQWdCLEdBQUcsV0FBVyxDQUFDLEVBQUUsRUFBRSxZQUFZLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFBO2dCQUN6RSxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyx3QkFBd0IsRUFBRSxFQUFFLGtCQUFrQixFQUFFLFVBQVUsQ0FBQyxDQUFBO2dCQUVuSCxzRUFBc0U7Z0JBQ3RFLGdFQUFnRTtnQkFDaEUsb0VBQW9FO2dCQUNwRSxvRUFBb0U7Z0JBQ3BFLDJCQUEyQjtnQkFDM0IsTUFBTSxrQkFBa0IsR0FBRyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUE7Z0JBQ3ZELE1BQU0scUJBQXFCLEdBQUcsT0FBTyxrQkFBa0IsSUFBSSxRQUFRLElBQUksa0JBQWtCLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxrQkFBa0IsSUFBSSxrQkFBa0IsQ0FBQTtnQkFFaEosSUFBSSxxQkFBcUIsRUFBRSxDQUFDO29CQUMxQixnQkFBZ0IsQ0FBQyxRQUFRLEdBQUcsa0JBQWtCLENBQUE7Z0JBQ2hELENBQUM7cUJBQU0sSUFBSSxZQUFZLElBQUksT0FBTyxFQUFFLENBQUM7b0JBQ25DLE9BQU8sZ0JBQWdCLENBQUMsUUFBUSxDQUFBO2dCQUNsQyxDQUFDO3FCQUFNLENBQUM7b0JBQ04sZ0JBQWdCLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxZQUFZLENBQUMsQ0FBQTtnQkFDM0UsQ0FBQztnQkFFRCxJQUFJLFlBQVksSUFBSSxPQUFPLElBQUksZ0JBQWdCLENBQUMsU0FBUyxFQUFFLFFBQVEsRUFBRSxDQUFDO29CQUNwRSxPQUFPLGdCQUFnQixDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUE7Z0JBQzVDLENBQUM7Z0JBRUQsTUFBTSxJQUFJLENBQUMsNEJBQTRCLENBQUMsZ0JBQWdCLEVBQUUsS0FBSyxJQUFJLEVBQUU7b0JBQ25FLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO2dCQUM3QyxDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFFRCxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTztnQkFBRSxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUE7UUFDM0MsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMEJBQTBCLENBQUMsWUFBWTtRQUNyQyxJQUFJLFlBQVksSUFBSSxPQUFPO1lBQUUsT0FBTyxVQUFVLENBQUE7UUFDOUMsSUFBSSxZQUFZLElBQUksT0FBTztZQUFFLE9BQU8sUUFBUSxDQUFBO1FBRTVDLE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxrQkFBa0I7UUFDbkMsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLHdCQUF3QixFQUFFLEVBQUUsa0JBQWtCLEVBQUUsVUFBVSxDQUFDLENBQUE7UUFDN0csTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsZUFBZSxDQUFDLFlBQVksRUFBRSxFQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRXpGLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFDLFlBQVksRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFDLENBQUE7SUFDckUsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IERiQmFzZUNvbW1hbmQgZnJvbSBcIi4vYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJEcm9wIGV4dGVuZHMgRGJCYXNlQ29tbWFuZCB7XG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQgfCBBcnJheTxvYmplY3Q+Pn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzIHdoZW4gcnVubmluZyBpbiBkcnkgbW9kZS5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudCgpXG5cbiAgICBpZiAoZW52aXJvbm1lbnQgIT0gXCJkZXZlbG9wbWVudFwiICYmIGVudmlyb25tZW50ICE9IFwidGVzdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRoaXMgY29tbWFuZCBzaG91bGQgb25seSBiZSBleGVjdXRlZCBvbiBkZXZlbG9wbWVudCBhbmQgdGVzdCBlbnZpcm9ubWVudHMgYW5kIG5vdDogJHtlbnZpcm9ubWVudH1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyIG9mIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uc3QgZGF0YWJhc2VUeXBlID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VUeXBlKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgICAgaWYgKHRoaXMuYXJncy50ZXN0aW5nKSB0aGlzLnJlc3VsdCA9IFtdXG5cbiAgICAgIGlmIChkYXRhYmFzZVR5cGUgIT0gXCJzcWxpdGVcIikge1xuICAgICAgICBjb25zdCBkYXRhYmFzZVBvb2wgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgICBjb25zdCBuZXdDb25maWd1cmF0aW9uID0gaW5jb3Jwb3JhdGUoe30sIGRhdGFiYXNlUG9vbC5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgICAgIGNvbnN0IHRhcmdldERhdGFiYXNlTmFtZSA9IGRpZ2codGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKCksIGRhdGFiYXNlSWRlbnRpZmllciwgXCJkYXRhYmFzZVwiKVxuXG4gICAgICAgIC8vIENvbm5lY3QgdG8gYSBrbm93bi1leGlzdGluZyBzeXN0ZW0gZGF0YWJhc2U6IHRoZSB0YXJnZXQgaXMgYWJvdXQgdG9cbiAgICAgICAgLy8gYmUgZHJvcHBlZCAoc28gd2UgY2FuJ3QgYmUgY29ubmVjdGVkIHRvIGl0KSwgUG9zdGdyZXMgcmVqZWN0c1xuICAgICAgICAvLyBEUk9QIERBVEFCQVNFIHdoaWxlIGNvbm5lY3RlZCB0byBpdCwgYW5kIGNvbmZpZ3VyZWQgYHVzZURhdGFiYXNlYFxuICAgICAgICAvLyBtYXkgaGFwcGVuIHRvIGVxdWFsIHRoZSB0YXJnZXQg4oCUIGluIHRoYXQgY2FzZSBmYWxsIHRocm91Z2ggdG8gdGhlXG4gICAgICAgIC8vIGRyaXZlcidzIHN5c3RlbSBkZWZhdWx0LlxuICAgICAgICBjb25zdCBjb25maWd1cmVkRmFsbGJhY2sgPSBuZXdDb25maWd1cmF0aW9uLnVzZURhdGFiYXNlXG4gICAgICAgIGNvbnN0IHVzZUNvbmZpZ3VyZWRGYWxsYmFjayA9IHR5cGVvZiBjb25maWd1cmVkRmFsbGJhY2sgPT0gXCJzdHJpbmdcIiAmJiBjb25maWd1cmVkRmFsbGJhY2subGVuZ3RoID4gMCAmJiBjb25maWd1cmVkRmFsbGJhY2sgIT0gdGFyZ2V0RGF0YWJhc2VOYW1lXG5cbiAgICAgICAgaWYgKHVzZUNvbmZpZ3VyZWRGYWxsYmFjaykge1xuICAgICAgICAgIG5ld0NvbmZpZ3VyYXRpb24uZGF0YWJhc2UgPSBjb25maWd1cmVkRmFsbGJhY2tcbiAgICAgICAgfSBlbHNlIGlmIChkYXRhYmFzZVR5cGUgPT0gXCJteXNxbFwiKSB7XG4gICAgICAgICAgZGVsZXRlIG5ld0NvbmZpZ3VyYXRpb24uZGF0YWJhc2VcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXdDb25maWd1cmF0aW9uLmRhdGFiYXNlID0gdGhpcy5zeXN0ZW1GYWxsYmFja0RhdGFiYXNlTmFtZShkYXRhYmFzZVR5cGUpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwibXNzcWxcIiAmJiBuZXdDb25maWd1cmF0aW9uLnNxbENvbmZpZz8uZGF0YWJhc2UpIHtcbiAgICAgICAgICBkZWxldGUgbmV3Q29uZmlndXJhdGlvbi5zcWxDb25maWcuZGF0YWJhc2VcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMud2l0aERpcmVjdERhdGFiYXNlQ29ubmVjdGlvbihuZXdDb25maWd1cmF0aW9uLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5kcm9wRGF0YWJhc2UoZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5hcmdzLnRlc3RpbmcpIHJldHVybiB0aGlzLnJlc3VsdFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN5c3RlbSBmYWxsYmFjayBkYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VUeXBlIC0gRGF0YWJhc2UgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTeXN0ZW0vbWFpbnRlbmFuY2UgZGF0YWJhc2UgbmFtZSBmb3IgdGhhdCBkcml2ZXIuXG4gICAqL1xuICBzeXN0ZW1GYWxsYmFja0RhdGFiYXNlTmFtZShkYXRhYmFzZVR5cGUpIHtcbiAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwicGdzcWxcIikgcmV0dXJuIFwicG9zdGdyZXNcIlxuICAgIGlmIChkYXRhYmFzZVR5cGUgPT0gXCJtc3NxbFwiKSByZXR1cm4gXCJtYXN0ZXJcIlxuXG4gICAgcmV0dXJuIFwibXlzcWxcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkcm9wRGF0YWJhc2UoZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgY29uc3QgZGF0YWJhc2VOYW1lID0gZGlnZyh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKSwgZGF0YWJhc2VJZGVudGlmaWVyLCBcImRhdGFiYXNlXCIpXG4gICAgY29uc3Qgc3FscyA9IHRoaXMuZ2V0RGF0YWJhc2VDb25uZWN0aW9uKCkuZHJvcERhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwge2lmRXhpc3RzOiB0cnVlfSlcblxuICAgIGF3YWl0IHRoaXMucXVlcnlPckNvbGxlY3RTcWxzKHNxbHMsIChzcWwpID0+ICh7ZGF0YWJhc2VOYW1lLCBzcWx9KSlcbiAgfVxufVxuIl19