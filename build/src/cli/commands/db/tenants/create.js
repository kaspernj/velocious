// @ts-check
import BaseCommand from "../../../base-command.js";
import { createTenantDatabase } from "../../../../tenants/default-tenant-database-provisioning.js";
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js";
export default class DbTenantsCreate extends BaseCommand {
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
        // Providers may customize creation, but the generic driver-agnostic provisioning
        // is the framework default so apps do not reimplement it.
        const createDatabase = typeof provider.createDatabase === "function"
            ? provider.createDatabase.bind(provider)
            : createTenantDatabase;
        const tenantCount = await helper.eachTenant(async ({ databaseConfiguration, tenant }) => {
            await createDatabase({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2NsaS9jb21tYW5kcy9kYi90ZW5hbnRzL2NyZWF0ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxXQUFXLE1BQU0sMEJBQTBCLENBQUE7QUFDbEQsT0FBTyxFQUFDLG9CQUFvQixFQUFDLE1BQU0sNkRBQTZELENBQUE7QUFDaEcsT0FBTywyQkFBMkIsTUFBTSw0Q0FBNEMsQ0FBQTtBQUVwRixNQUFNLENBQUMsT0FBTyxPQUFPLGVBQWdCLFNBQVEsV0FBVztJQUN0RDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sTUFBTSxHQUFHLElBQUksMkJBQTJCLENBQUM7WUFDN0MsT0FBTyxFQUFFLElBQUk7WUFDYixVQUFVLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQztTQUNsQyxDQUFDLENBQUE7UUFDRixNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFBO1FBQ2hDLGlGQUFpRjtRQUNqRiwwREFBMEQ7UUFDMUQsTUFBTSxjQUFjLEdBQUcsT0FBTyxRQUFRLENBQUMsY0FBYyxLQUFLLFVBQVU7WUFDbEUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztZQUN4QyxDQUFDLENBQUMsb0JBQW9CLENBQUE7UUFFeEIsTUFBTSxXQUFXLEdBQUcsTUFBTSxNQUFNLENBQUMsVUFBVSxDQUFDLEtBQUssRUFBRSxFQUFDLHFCQUFxQixFQUFFLE1BQU0sRUFBQyxFQUFFLEVBQUU7WUFDcEYsTUFBTSxjQUFjLENBQUM7Z0JBQ25CLGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3RDLHFCQUFxQjtnQkFDckIsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO2dCQUM3QixNQUFNO2FBQ1AsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTztZQUFFLE9BQU8sRUFBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUMsQ0FBQTtJQUM1RSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi8uLi9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IHtjcmVhdGVUZW5hbnREYXRhYmFzZX0gZnJvbSBcIi4uLy4uLy4uLy4uL3RlbmFudHMvZGVmYXVsdC10ZW5hbnQtZGF0YWJhc2UtcHJvdmlzaW9uaW5nLmpzXCJcbmltcG9ydCBUZW5hbnREYXRhYmFzZUNvbW1hbmRIZWxwZXIgZnJvbSBcIi4uLy4uLy4uL3RlbmFudC1kYXRhYmFzZS1jb21tYW5kLWhlbHBlci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIERiVGVuYW50c0NyZWF0ZSBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2lkZW50aWZpZXI6IHN0cmluZywgdGVuYW50Q291bnQ6IG51bWJlcn0gfCB2b2lkPn0gLSBSZXN1bHQgaW4gdGVzdCBtb2RlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBoZWxwZXIgPSBuZXcgVGVuYW50RGF0YWJhc2VDb21tYW5kSGVscGVyKHtcbiAgICAgIGNvbW1hbmQ6IHRoaXMsXG4gICAgICBpZGVudGlmaWVyOiB0aGlzLnByb2Nlc3NBcmdzPy5bMV1cbiAgICB9KVxuICAgIGNvbnN0IHByb3ZpZGVyID0gaGVscGVyLnByb3ZpZGVyXG4gICAgLy8gUHJvdmlkZXJzIG1heSBjdXN0b21pemUgY3JlYXRpb24sIGJ1dCB0aGUgZ2VuZXJpYyBkcml2ZXItYWdub3N0aWMgcHJvdmlzaW9uaW5nXG4gICAgLy8gaXMgdGhlIGZyYW1ld29yayBkZWZhdWx0IHNvIGFwcHMgZG8gbm90IHJlaW1wbGVtZW50IGl0LlxuICAgIGNvbnN0IGNyZWF0ZURhdGFiYXNlID0gdHlwZW9mIHByb3ZpZGVyLmNyZWF0ZURhdGFiYXNlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gcHJvdmlkZXIuY3JlYXRlRGF0YWJhc2UuYmluZChwcm92aWRlcilcbiAgICAgIDogY3JlYXRlVGVuYW50RGF0YWJhc2VcblxuICAgIGNvbnN0IHRlbmFudENvdW50ID0gYXdhaXQgaGVscGVyLmVhY2hUZW5hbnQoYXN5bmMgKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHRlbmFudH0pID0+IHtcbiAgICAgIGF3YWl0IGNyZWF0ZURhdGFiYXNlKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgaWRlbnRpZmllcjogaGVscGVyLmlkZW50aWZpZXIsXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuYXJncy50ZXN0aW5nKSByZXR1cm4ge2lkZW50aWZpZXI6IGhlbHBlci5pZGVudGlmaWVyLCB0ZW5hbnRDb3VudH1cbiAgfVxufVxuIl19