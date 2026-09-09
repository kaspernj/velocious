import BaseCommand from "../../../../../../cli/base-command.js";
import commandArguments from "../../../../../../cli/command-arguments.js";
import DatabaseGenerationContext from "../../../../../../database/generation-context.js";
import fs from "fs/promises";
import path from "path";
import StructureSqlLoader from "../../../../../../database/structure-sql-loader.js";
/** Node CLI command for loading DB structure SQL files. */
export default class DbSchemaLoad extends BaseCommand {
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
            await context.run({ name: "DB selected tenant schema load", callback: async (db) => {
                    await this.loadStructureSql({ db, identifier: context.databaseIdentifier() });
                } });
            return;
        }
        await this.getConfiguration().ensureConnections({ name: "DB schema load" }, async (dbs) => {
            for (const identifier of Object.keys(dbs)) {
                await this.loadStructureSql({ db: dbs[identifier], identifier });
            }
        });
    }
    /**
     * Loads one identifier's explicit structure file into one selected connection.
     * @param {object} args - Load arguments.
     * @param {import("../../../../../../database/drivers/base.js").default} args.db - Target connection.
     * @param {string} args.identifier - Logical database identifier used in the file name.
     * @returns {Promise<void>} - Resolves after loading.
     */
    async loadStructureSql({ db, identifier }) {
        const dbDir = path.join(this.directory(), "db");
        const loader = new StructureSqlLoader();
        const structureFilePath = path.join(dbDir, `structure-${identifier}.sql`);
        const structureSql = await fs.readFile(structureFilePath, "utf8");
        await loader.load({ db, structureSql });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9hZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9kYi9zY2hlbWEvbG9hZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFdBQVcsTUFBTSx1Q0FBdUMsQ0FBQTtBQUMvRCxPQUFPLGdCQUFnQixNQUFNLDRDQUE0QyxDQUFBO0FBQ3pFLE9BQU8seUJBQXlCLE1BQU0sa0RBQWtELENBQUE7QUFDeEYsT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sSUFBSSxNQUFNLE1BQU0sQ0FBQTtBQUN2QixPQUFPLGtCQUFrQixNQUFNLG9EQUFvRCxDQUFBO0FBRW5GLDJEQUEyRDtBQUMzRCxNQUFNLENBQUMsT0FBTyxPQUFPLFlBQWEsU0FBUSxXQUFXO0lBQ25EOztrQ0FFOEI7SUFDOUIsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGVBQWUsR0FBRyxnQkFBZ0IsQ0FBQztZQUN2QyxVQUFVLEVBQUUsRUFBQyxZQUFZLEVBQUUsQ0FBQyxVQUFVLENBQUMsRUFBQztZQUN4QyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsSUFBSSxFQUFFO1NBQ3BDLENBQUMsQ0FBQTtRQUNGLE1BQU0sd0JBQXdCLEdBQUcsZUFBZSxDQUFDLE1BQU0sQ0FBQTtRQUV2RCxJQUFJLE9BQU8sd0JBQXdCLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDakQsTUFBTSxPQUFPLEdBQUcsTUFBTSx5QkFBeUIsQ0FBQyxPQUFPLENBQUM7Z0JBQ3RELGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3RDLGtCQUFrQixFQUFFLHdCQUF3QjthQUM3QyxDQUFDLENBQUE7WUFFRixNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtvQkFDaEYsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxFQUFFLEVBQUUsVUFBVSxFQUFFLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxFQUFDLENBQUMsQ0FBQTtnQkFDN0UsQ0FBQyxFQUFDLENBQUMsQ0FBQTtZQUNILE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBQyxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsRUFBRTtZQUN0RixLQUFLLE1BQU0sVUFBVSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDMUMsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7WUFDaEUsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLEVBQUUsRUFBRSxVQUFVLEVBQUM7UUFDckMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDL0MsTUFBTSxNQUFNLEdBQUcsSUFBSSxrQkFBa0IsRUFBRSxDQUFBO1FBQ3ZDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsYUFBYSxVQUFVLE1BQU0sQ0FBQyxDQUFBO1FBQ3pFLE1BQU0sWUFBWSxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUVqRSxNQUFNLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBQyxFQUFFLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtJQUN2QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IGNvbW1hbmRBcmd1bWVudHMgZnJvbSBcIi4uLy4uLy4uLy4uLy4uLy4uL2NsaS9jb21tYW5kLWFyZ3VtZW50cy5qc1wiXG5pbXBvcnQgRGF0YWJhc2VHZW5lcmF0aW9uQ29udGV4dCBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvZ2VuZXJhdGlvbi1jb250ZXh0LmpzXCJcbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IFN0cnVjdHVyZVNxbExvYWRlciBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2Uvc3RydWN0dXJlLXNxbC1sb2FkZXIuanNcIlxuXG4vKiogTm9kZSBDTEkgY29tbWFuZCBmb3IgbG9hZGluZyBEQiBzdHJ1Y3R1cmUgU1FMIGZpbGVzLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJTY2hlbWFMb2FkIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBwYXJzZWRBcmd1bWVudHMgPSBjb21tYW5kQXJndW1lbnRzKHtcbiAgICAgIGRlZmluaXRpb246IHt2YWx1ZU9wdGlvbnM6IFtcIi0tdGVuYW50XCJdfSxcbiAgICAgIHByb2Nlc3NBcmdzOiB0aGlzLnByb2Nlc3NBcmdzIHx8IFtdXG4gICAgfSlcbiAgICBjb25zdCB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIgPSBwYXJzZWRBcmd1bWVudHMudGVuYW50XG5cbiAgICBpZiAodHlwZW9mIHRlbmFudERhdGFiYXNlSWRlbnRpZmllciA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3QgY29udGV4dCA9IGF3YWl0IERhdGFiYXNlR2VuZXJhdGlvbkNvbnRleHQucmVzb2x2ZSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRlbmFudERhdGFiYXNlSWRlbnRpZmllclxuICAgICAgfSlcblxuICAgICAgYXdhaXQgY29udGV4dC5ydW4oe25hbWU6IFwiREIgc2VsZWN0ZWQgdGVuYW50IHNjaGVtYSBsb2FkXCIsIGNhbGxiYWNrOiBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5sb2FkU3RydWN0dXJlU3FsKHtkYiwgaWRlbnRpZmllcjogY29udGV4dC5kYXRhYmFzZUlkZW50aWZpZXIoKX0pXG4gICAgICB9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkRCIHNjaGVtYSBsb2FkXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoZGJzKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmxvYWRTdHJ1Y3R1cmVTcWwoe2RiOiBkYnNbaWRlbnRpZmllcl0sIGlkZW50aWZpZXJ9KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgb25lIGlkZW50aWZpZXIncyBleHBsaWNpdCBzdHJ1Y3R1cmUgZmlsZSBpbnRvIG9uZSBzZWxlY3RlZCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExvYWQgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVGFyZ2V0IGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkZW50aWZpZXIgLSBMb2dpY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIgdXNlZCBpbiB0aGUgZmlsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsb2FkaW5nLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0cnVjdHVyZVNxbCh7ZGIsIGlkZW50aWZpZXJ9KSB7XG4gICAgY29uc3QgZGJEaXIgPSBwYXRoLmpvaW4odGhpcy5kaXJlY3RvcnkoKSwgXCJkYlwiKVxuICAgIGNvbnN0IGxvYWRlciA9IG5ldyBTdHJ1Y3R1cmVTcWxMb2FkZXIoKVxuICAgIGNvbnN0IHN0cnVjdHVyZUZpbGVQYXRoID0gcGF0aC5qb2luKGRiRGlyLCBgc3RydWN0dXJlLSR7aWRlbnRpZmllcn0uc3FsYClcbiAgICBjb25zdCBzdHJ1Y3R1cmVTcWwgPSBhd2FpdCBmcy5yZWFkRmlsZShzdHJ1Y3R1cmVGaWxlUGF0aCwgXCJ1dGY4XCIpXG5cbiAgICBhd2FpdCBsb2FkZXIubG9hZCh7ZGIsIHN0cnVjdHVyZVNxbH0pXG4gIH1cbn1cbiJdfQ==