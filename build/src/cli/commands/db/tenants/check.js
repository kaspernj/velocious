// @ts-check
import BaseCommand from "../../../base-command.js";
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js";
export default class DbTenantsCheck extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode.
     */
    async execute() {
        const helper = new TenantDatabaseCommandHelper({
            command: this,
            identifier: this.processArgs?.[1]
        });
        const provider = helper.provider;
        const tenantCount = await helper.eachTenant(async ({ databaseConfiguration, tenant }) => {
            if (typeof provider.checkTenant === "function") {
                await provider.checkTenant({
                    configuration: this.getConfiguration(),
                    databaseConfiguration,
                    identifier: helper.identifier,
                    tenant
                });
            }
            await this.getConfiguration().ensureConnections({ databaseIdentifiers: [helper.identifier], name: `DB tenants check: ${helper.identifier}` }, async (dbs) => {
                const db = dbs[helper.identifier];
                if (!db)
                    throw new Error(`Tenant database identifier ${helper.identifier} did not open a connection`);
                await db.query("SELECT 1");
            });
        });
        if (this.args.testing)
            return { identifier: helper.identifier, tenantCount };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hlY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvY2xpL2NvbW1hbmRzL2RiL3RlbmFudHMvY2hlY2suanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sV0FBVyxNQUFNLDBCQUEwQixDQUFBO0FBQ2xELE9BQU8sMkJBQTJCLE1BQU0sNENBQTRDLENBQUE7QUFFcEYsTUFBTSxDQUFDLE9BQU8sT0FBTyxjQUFlLFNBQVEsV0FBVztJQUNyRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sTUFBTSxHQUFHLElBQUksMkJBQTJCLENBQUM7WUFDN0MsT0FBTyxFQUFFLElBQUk7WUFDYixVQUFVLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQztTQUNsQyxDQUFDLENBQUE7UUFDRixNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFBO1FBQ2hDLE1BQU0sV0FBVyxHQUFHLE1BQU0sTUFBTSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsRUFBQyxxQkFBcUIsRUFBRSxNQUFNLEVBQUMsRUFBRSxFQUFFO1lBQ3BGLElBQUksT0FBTyxRQUFRLENBQUMsV0FBVyxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUMvQyxNQUFNLFFBQVEsQ0FBQyxXQUFXLENBQUM7b0JBQ3pCLGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7b0JBQ3RDLHFCQUFxQjtvQkFDckIsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO29CQUM3QixNQUFNO2lCQUNQLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsbUJBQW1CLEVBQUUsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLEVBQUUsSUFBSSxFQUFFLHFCQUFxQixNQUFNLENBQUMsVUFBVSxFQUFFLEVBQUMsRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLEVBQUU7Z0JBQ3hKLE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBRWpDLElBQUksQ0FBQyxFQUFFO29CQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLE1BQU0sQ0FBQyxVQUFVLDRCQUE0QixDQUFDLENBQUE7Z0JBRXJHLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUM1QixDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFPLEVBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVLEVBQUUsV0FBVyxFQUFDLENBQUE7SUFDNUUsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBUZW5hbnREYXRhYmFzZUNvbW1hbmRIZWxwZXIgZnJvbSBcIi4uLy4uLy4uL3RlbmFudC1kYXRhYmFzZS1jb21tYW5kLWhlbHBlci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIERiVGVuYW50c0NoZWNrIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7aWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnRDb3VudDogbnVtYmVyfSB8IHZvaWQ+fSAtIFJlc3VsdCBpbiB0ZXN0IG1vZGUuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IGhlbHBlciA9IG5ldyBUZW5hbnREYXRhYmFzZUNvbW1hbmRIZWxwZXIoe1xuICAgICAgY29tbWFuZDogdGhpcyxcbiAgICAgIGlkZW50aWZpZXI6IHRoaXMucHJvY2Vzc0FyZ3M/LlsxXVxuICAgIH0pXG4gICAgY29uc3QgcHJvdmlkZXIgPSBoZWxwZXIucHJvdmlkZXJcbiAgICBjb25zdCB0ZW5hbnRDb3VudCA9IGF3YWl0IGhlbHBlci5lYWNoVGVuYW50KGFzeW5jICh7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCB0ZW5hbnR9KSA9PiB7XG4gICAgICBpZiAodHlwZW9mIHByb3ZpZGVyLmNoZWNrVGVuYW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgYXdhaXQgcHJvdmlkZXIuY2hlY2tUZW5hbnQoe1xuICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICBpZGVudGlmaWVyOiBoZWxwZXIuaWRlbnRpZmllcixcbiAgICAgICAgICB0ZW5hbnRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtoZWxwZXIuaWRlbnRpZmllcl0sIG5hbWU6IGBEQiB0ZW5hbnRzIGNoZWNrOiAke2hlbHBlci5pZGVudGlmaWVyfWB9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICAgIGNvbnN0IGRiID0gZGJzW2hlbHBlci5pZGVudGlmaWVyXVxuXG4gICAgICAgIGlmICghZGIpIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHtoZWxwZXIuaWRlbnRpZmllcn0gZGlkIG5vdCBvcGVuIGEgY29ubmVjdGlvbmApXG5cbiAgICAgICAgYXdhaXQgZGIucXVlcnkoXCJTRUxFQ1QgMVwiKVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuYXJncy50ZXN0aW5nKSByZXR1cm4ge2lkZW50aWZpZXI6IGhlbHBlci5pZGVudGlmaWVyLCB0ZW5hbnRDb3VudH1cbiAgfVxufVxuIl19