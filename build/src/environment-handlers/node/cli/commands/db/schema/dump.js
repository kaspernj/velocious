import BaseCommand from "../../../../../../cli/base-command.js";
import commandArguments from "../../../../../../cli/command-arguments.js";
import DatabaseGenerationContext from "../../../../../../database/generation-context.js";
import fileExists from "../../../../../../utils/file-exists.js";
import path from "path";
/** Node CLI command for dumping DB structure SQL files. */
export default class DbSchemaDump extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void>} */
    async execute() {
        const parsedArguments = commandArguments({
            definition: { valueOptions: ["--tenant"] },
            processArgs: this.processArgs || []
        });
        const tenantDatabaseIdentifier = parsedArguments.tenant;
        if (typeof tenantDatabaseIdentifier === "string") {
            const context = await DatabaseGenerationContext.resolve({
                configuration: this.getConfiguration(),
                databaseIdentifier: tenantDatabaseIdentifier
            });
            await context.run({ name: "DB selected tenant schema dump", callback: async (db) => {
                    const dbs = { [context.databaseIdentifier()]: db };
                    const shouldGenerate = await this.shouldGenerateStructureSql({ dbs });
                    if (!shouldGenerate)
                        return;
                    await this.getEnvironmentHandler().afterMigrations({ dbs, reason: "schemaDump" });
                } });
            return;
        }
        await this.getConfiguration().ensureConnections({ name: "DB schema dump" }, async (dbs) => {
            const shouldGenerate = await this.shouldGenerateStructureSql({ dbs });
            if (!shouldGenerate)
                return;
            await this.getEnvironmentHandler().afterMigrations({ dbs, reason: "schemaDump" });
        });
    }
    /**
     * Runs should generate structure sql.
     * @param {object} args - Options object.
     * @param {Record<string, import("../../../../../../database/drivers/base.js").default>} args.dbs - Active DB connections by identifier.
     * @returns {Promise<boolean>} - Whether structure SQL should be generated.
     */
    async shouldGenerateStructureSql({ dbs }) {
        if (!this.getConfiguration().shouldWriteStructureSql({ reason: "schemaDump" }))
            return false;
        const dbDir = path.join(this.directory(), "db");
        for (const identifier of Object.keys(dbs)) {
            const db = dbs[identifier];
            if (typeof db.structureSql !== "function")
                continue;
            const structureFilePath = path.join(dbDir, `structure-${identifier}.sql`);
            if (!await fileExists(structureFilePath))
                return true;
        }
        return false;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHVtcC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9kYi9zY2hlbWEvZHVtcC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSx1Q0FBdUMsQ0FBQTtBQUMvRCxPQUFPLGdCQUFnQixNQUFNLDRDQUE0QyxDQUFBO0FBQ3pFLE9BQU8seUJBQXlCLE1BQU0sa0RBQWtELENBQUE7QUFDeEYsT0FBTyxVQUFVLE1BQU0sd0NBQXdDLENBQUE7QUFDL0QsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBRXZCLDJEQUEyRDtBQUMzRCxNQUFNLENBQUMsT0FBTyxPQUFPLFlBQWEsU0FBUSxXQUFXO0lBQ25EOztrQ0FFOEI7SUFDOUIsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGVBQWUsR0FBRyxnQkFBZ0IsQ0FBQztZQUN2QyxVQUFVLEVBQUUsRUFBQyxZQUFZLEVBQUUsQ0FBQyxVQUFVLENBQUMsRUFBQztZQUN4QyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsSUFBSSxFQUFFO1NBQ3BDLENBQUMsQ0FBQTtRQUNGLE1BQU0sd0JBQXdCLEdBQUcsZUFBZSxDQUFDLE1BQU0sQ0FBQTtRQUV2RCxJQUFJLE9BQU8sd0JBQXdCLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDakQsTUFBTSxPQUFPLEdBQUcsTUFBTSx5QkFBeUIsQ0FBQyxPQUFPLENBQUM7Z0JBQ3RELGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3RDLGtCQUFrQixFQUFFLHdCQUF3QjthQUM3QyxDQUFDLENBQUE7WUFFRixNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtvQkFDaEYsTUFBTSxHQUFHLEdBQUcsRUFBQyxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFDLENBQUE7b0JBQ2hELE1BQU0sY0FBYyxHQUFHLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUMsR0FBRyxFQUFDLENBQUMsQ0FBQTtvQkFFbkUsSUFBSSxDQUFDLGNBQWM7d0JBQUUsT0FBTTtvQkFFM0IsTUFBTSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxlQUFlLENBQUMsRUFBQyxHQUFHLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7Z0JBQ2pGLENBQUMsRUFBQyxDQUFDLENBQUE7WUFDSCxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUMsRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLEVBQUU7WUFDdEYsTUFBTSxjQUFjLEdBQUcsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBQyxHQUFHLEVBQUMsQ0FBQyxDQUFBO1lBRW5FLElBQUksQ0FBQyxjQUFjO2dCQUFFLE9BQU07WUFFM0IsTUFBTSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxlQUFlLENBQUMsRUFBQyxHQUFHLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7UUFDakYsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsRUFBQyxHQUFHLEVBQUM7UUFDcEMsSUFBSSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLHVCQUF1QixDQUFDLEVBQUMsTUFBTSxFQUFFLFlBQVksRUFBQyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFMUYsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFFL0MsS0FBSyxNQUFNLFVBQVUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDMUMsTUFBTSxFQUFFLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBRTFCLElBQUksT0FBTyxFQUFFLENBQUMsWUFBWSxLQUFLLFVBQVU7Z0JBQUUsU0FBUTtZQUVuRCxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLGFBQWEsVUFBVSxNQUFNLENBQUMsQ0FBQTtZQUV6RSxJQUFJLENBQUMsTUFBTSxVQUFVLENBQUMsaUJBQWlCLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUE7UUFDdkQsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi8uLi8uLi8uLi9jbGkvYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBjb21tYW5kQXJndW1lbnRzIGZyb20gXCIuLi8uLi8uLi8uLi8uLi8uLi9jbGkvY29tbWFuZC1hcmd1bWVudHMuanNcIlxuaW1wb3J0IERhdGFiYXNlR2VuZXJhdGlvbkNvbnRleHQgZnJvbSBcIi4uLy4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL2dlbmVyYXRpb24tY29udGV4dC5qc1wiXG5pbXBvcnQgZmlsZUV4aXN0cyBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vLi4vdXRpbHMvZmlsZS1leGlzdHMuanNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuXG4vKiogTm9kZSBDTEkgY29tbWFuZCBmb3IgZHVtcGluZyBEQiBzdHJ1Y3R1cmUgU1FMIGZpbGVzLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJTY2hlbWFEdW1wIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBwYXJzZWRBcmd1bWVudHMgPSBjb21tYW5kQXJndW1lbnRzKHtcbiAgICAgIGRlZmluaXRpb246IHt2YWx1ZU9wdGlvbnM6IFtcIi0tdGVuYW50XCJdfSxcbiAgICAgIHByb2Nlc3NBcmdzOiB0aGlzLnByb2Nlc3NBcmdzIHx8IFtdXG4gICAgfSlcbiAgICBjb25zdCB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIgPSBwYXJzZWRBcmd1bWVudHMudGVuYW50XG5cbiAgICBpZiAodHlwZW9mIHRlbmFudERhdGFiYXNlSWRlbnRpZmllciA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3QgY29udGV4dCA9IGF3YWl0IERhdGFiYXNlR2VuZXJhdGlvbkNvbnRleHQucmVzb2x2ZSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRlbmFudERhdGFiYXNlSWRlbnRpZmllclxuICAgICAgfSlcblxuICAgICAgYXdhaXQgY29udGV4dC5ydW4oe25hbWU6IFwiREIgc2VsZWN0ZWQgdGVuYW50IHNjaGVtYSBkdW1wXCIsIGNhbGxiYWNrOiBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgY29uc3QgZGJzID0ge1tjb250ZXh0LmRhdGFiYXNlSWRlbnRpZmllcigpXTogZGJ9XG4gICAgICAgIGNvbnN0IHNob3VsZEdlbmVyYXRlID0gYXdhaXQgdGhpcy5zaG91bGRHZW5lcmF0ZVN0cnVjdHVyZVNxbCh7ZGJzfSlcblxuICAgICAgICBpZiAoIXNob3VsZEdlbmVyYXRlKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmFmdGVyTWlncmF0aW9ucyh7ZGJzLCByZWFzb246IFwic2NoZW1hRHVtcFwifSlcbiAgICAgIH19KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiREIgc2NoZW1hIGR1bXBcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IHNob3VsZEdlbmVyYXRlID0gYXdhaXQgdGhpcy5zaG91bGRHZW5lcmF0ZVN0cnVjdHVyZVNxbCh7ZGJzfSlcblxuICAgICAgaWYgKCFzaG91bGRHZW5lcmF0ZSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuYWZ0ZXJNaWdyYXRpb25zKHtkYnMsIHJlYXNvbjogXCJzY2hlbWFEdW1wXCJ9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgZ2VuZXJhdGUgc3RydWN0dXJlIHNxbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGFyZ3MuZGJzIC0gQWN0aXZlIERCIGNvbm5lY3Rpb25zIGJ5IGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgc3RydWN0dXJlIFNRTCBzaG91bGQgYmUgZ2VuZXJhdGVkLlxuICAgKi9cbiAgYXN5bmMgc2hvdWxkR2VuZXJhdGVTdHJ1Y3R1cmVTcWwoe2Ric30pIHtcbiAgICBpZiAoIXRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLnNob3VsZFdyaXRlU3RydWN0dXJlU3FsKHtyZWFzb246IFwic2NoZW1hRHVtcFwifSkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgZGJEaXIgPSBwYXRoLmpvaW4odGhpcy5kaXJlY3RvcnkoKSwgXCJkYlwiKVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKGRicykpIHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW2lkZW50aWZpZXJdXG5cbiAgICAgIGlmICh0eXBlb2YgZGIuc3RydWN0dXJlU3FsICE9PSBcImZ1bmN0aW9uXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHN0cnVjdHVyZUZpbGVQYXRoID0gcGF0aC5qb2luKGRiRGlyLCBgc3RydWN0dXJlLSR7aWRlbnRpZmllcn0uc3FsYClcblxuICAgICAgaWYgKCFhd2FpdCBmaWxlRXhpc3RzKHN0cnVjdHVyZUZpbGVQYXRoKSkgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuIl19