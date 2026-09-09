// @ts-check
import BaseCommand from "../../../base-command.js";
import { dropTenantDatabase } from "../../../../tenants/default-tenant-database-provisioning.js";
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js";
export default class DbTenantsDrop extends BaseCommand {
    /**
     * Drops the tenant database/schema for every listed tenant through the provider's
     * `dropDatabase` hook, or the framework default when the provider defines none.
     * @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode.
     */
    async execute() {
        const helper = new TenantDatabaseCommandHelper({
            command: this,
            identifier: this.processArgs?.[1]
        });
        const provider = helper.provider;
        const dropDatabase = typeof provider.dropDatabase === "function"
            ? provider.dropDatabase.bind(provider)
            : dropTenantDatabase;
        const tenantCount = await helper.eachTenant(async ({ databaseConfiguration, tenant }) => {
            await dropDatabase({
                configuration: this.getConfiguration(),
                databaseConfiguration,
                identifier: helper.identifier,
                tenant
            });
        });
        if (this.args.testing)
            return { identifier: helper.identifier, tenantCount };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHJvcC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9jbGkvY29tbWFuZHMvZGIvdGVuYW50cy9kcm9wLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSwwQkFBMEIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMsa0JBQWtCLEVBQUMsTUFBTSw2REFBNkQsQ0FBQTtBQUM5RixPQUFPLDJCQUEyQixNQUFNLDRDQUE0QyxDQUFBO0FBRXBGLE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYyxTQUFRLFdBQVc7SUFDcEQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxNQUFNLEdBQUcsSUFBSSwyQkFBMkIsQ0FBQztZQUM3QyxPQUFPLEVBQUUsSUFBSTtZQUNiLFVBQVUsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDO1NBQ2xDLENBQUMsQ0FBQTtRQUNGLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUE7UUFDaEMsTUFBTSxZQUFZLEdBQUcsT0FBTyxRQUFRLENBQUMsWUFBWSxLQUFLLFVBQVU7WUFDOUQsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztZQUN0QyxDQUFDLENBQUMsa0JBQWtCLENBQUE7UUFFdEIsTUFBTSxXQUFXLEdBQUcsTUFBTSxNQUFNLENBQUMsVUFBVSxDQUFDLEtBQUssRUFBRSxFQUFDLHFCQUFxQixFQUFFLE1BQU0sRUFBQyxFQUFFLEVBQUU7WUFDcEYsTUFBTSxZQUFZLENBQUM7Z0JBQ2pCLGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3RDLHFCQUFxQjtnQkFDckIsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO2dCQUM3QixNQUFNO2FBQ1AsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTztZQUFFLE9BQU8sRUFBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUMsQ0FBQTtJQUM1RSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IHtkcm9wVGVuYW50RGF0YWJhc2V9IGZyb20gXCIuLi8uLi8uLi8uLi90ZW5hbnRzL2RlZmF1bHQtdGVuYW50LWRhdGFiYXNlLXByb3Zpc2lvbmluZy5qc1wiXG5pbXBvcnQgVGVuYW50RGF0YWJhc2VDb21tYW5kSGVscGVyIGZyb20gXCIuLi8uLi8uLi90ZW5hbnQtZGF0YWJhc2UtY29tbWFuZC1oZWxwZXIuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBEYlRlbmFudHNEcm9wIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogRHJvcHMgdGhlIHRlbmFudCBkYXRhYmFzZS9zY2hlbWEgZm9yIGV2ZXJ5IGxpc3RlZCB0ZW5hbnQgdGhyb3VnaCB0aGUgcHJvdmlkZXInc1xuICAgKiBgZHJvcERhdGFiYXNlYCBob29rLCBvciB0aGUgZnJhbWV3b3JrIGRlZmF1bHQgd2hlbiB0aGUgcHJvdmlkZXIgZGVmaW5lcyBub25lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7aWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnRDb3VudDogbnVtYmVyfSB8IHZvaWQ+fSAtIFJlc3VsdCBpbiB0ZXN0IG1vZGUuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IGhlbHBlciA9IG5ldyBUZW5hbnREYXRhYmFzZUNvbW1hbmRIZWxwZXIoe1xuICAgICAgY29tbWFuZDogdGhpcyxcbiAgICAgIGlkZW50aWZpZXI6IHRoaXMucHJvY2Vzc0FyZ3M/LlsxXVxuICAgIH0pXG4gICAgY29uc3QgcHJvdmlkZXIgPSBoZWxwZXIucHJvdmlkZXJcbiAgICBjb25zdCBkcm9wRGF0YWJhc2UgPSB0eXBlb2YgcHJvdmlkZXIuZHJvcERhdGFiYXNlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gcHJvdmlkZXIuZHJvcERhdGFiYXNlLmJpbmQocHJvdmlkZXIpXG4gICAgICA6IGRyb3BUZW5hbnREYXRhYmFzZVxuXG4gICAgY29uc3QgdGVuYW50Q291bnQgPSBhd2FpdCBoZWxwZXIuZWFjaFRlbmFudChhc3luYyAoe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgdGVuYW50fSkgPT4ge1xuICAgICAgYXdhaXQgZHJvcERhdGFiYXNlKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgaWRlbnRpZmllcjogaGVscGVyLmlkZW50aWZpZXIsXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuYXJncy50ZXN0aW5nKSByZXR1cm4ge2lkZW50aWZpZXI6IGhlbHBlci5pZGVudGlmaWVyLCB0ZW5hbnRDb3VudH1cbiAgfVxufVxuIl19