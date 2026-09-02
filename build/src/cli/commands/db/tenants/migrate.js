// @ts-check
import { digg } from "diggerize";
import BaseCommand from "../../../base-command.js";
import Migrator from "../../../../database/migrator.js";
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js";
import migrationExecutionPhaseArgument from "../../../migration-execution-phase-argument.js";
export default class DbTenantsMigrate extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<{identifier: string, migrationCount: number, tenantCount: number} | void>} - Result in test mode.
     */
    async execute() {
        const executionPhase = migrationExecutionPhaseArgument(this.processArgs || []);
        const helper = new TenantDatabaseCommandHelper({
            command: this,
            identifier: this.processArgs?.[1]
        });
        const migrations = await this.getEnvironmentHandler().findMigrations();
        const tenantCount = await helper.eachTenant(async ({ databaseConfiguration, tenant }) => {
            const migrator = new Migrator({
                configuration: this.getConfiguration(),
                databaseIdentifiers: [helper.identifier],
                executionPhase
            });
            let migrationsApplied = 0;
            await this.getConfiguration().ensureConnections({ databaseIdentifiers: [helper.identifier], name: `DB tenants migrate: ${helper.identifier}` }, async () => {
                await migrator.prepare();
                migrationsApplied = await migrator.migrateFiles(migrations, digg(this.getEnvironmentHandler(), "requireMigration"));
            });
            const afterMigrateTenant = helper.provider.afterMigrateTenant;
            if (typeof afterMigrateTenant === "function") {
                await this.getConfiguration().ensureConnections({ name: `DB tenants after migrate: ${helper.identifier}` }, async () => {
                    await afterMigrateTenant({
                        configuration: this.getConfiguration(),
                        databaseConfiguration,
                        identifier: helper.identifier,
                        migrationsApplied,
                        tenant
                    });
                });
            }
        });
        if (this.args.testing) {
            return {
                identifier: helper.identifier,
                migrationCount: migrations.length,
                tenantCount
            };
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9jbGkvY29tbWFuZHMvZGIvdGVuYW50cy9taWdyYXRlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sV0FBVyxNQUFNLDBCQUEwQixDQUFBO0FBQ2xELE9BQU8sUUFBUSxNQUFNLGtDQUFrQyxDQUFBO0FBQ3ZELE9BQU8sMkJBQTJCLE1BQU0sNENBQTRDLENBQUE7QUFDcEYsT0FBTywrQkFBK0IsTUFBTSxnREFBZ0QsQ0FBQTtBQUU1RixNQUFNLENBQUMsT0FBTyxPQUFPLGdCQUFpQixTQUFRLFdBQVc7SUFDdkQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGNBQWMsR0FBRywrQkFBK0IsQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBQzlFLE1BQU0sTUFBTSxHQUFHLElBQUksMkJBQTJCLENBQUM7WUFDN0MsT0FBTyxFQUFFLElBQUk7WUFDYixVQUFVLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQztTQUNsQyxDQUFDLENBQUE7UUFDRixNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBQ3RFLE1BQU0sV0FBVyxHQUFHLE1BQU0sTUFBTSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsRUFBQyxxQkFBcUIsRUFBRSxNQUFNLEVBQUMsRUFBRSxFQUFFO1lBQ3BGLE1BQU0sUUFBUSxHQUFHLElBQUksUUFBUSxDQUFDO2dCQUM1QixhQUFhLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixFQUFFO2dCQUN0QyxtQkFBbUIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUM7Z0JBQ3hDLGNBQWM7YUFDZixDQUFDLENBQUE7WUFFRixJQUFJLGlCQUFpQixHQUFHLENBQUMsQ0FBQTtZQUV6QixNQUFNLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsbUJBQW1CLEVBQUUsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLEVBQUUsSUFBSSxFQUFFLHVCQUF1QixNQUFNLENBQUMsVUFBVSxFQUFFLEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDdkosTUFBTSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUE7Z0JBQ3hCLGlCQUFpQixHQUFHLE1BQU0sUUFBUSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxFQUFFLGtCQUFrQixDQUFDLENBQUMsQ0FBQTtZQUNySCxDQUFDLENBQUMsQ0FBQTtZQUVGLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQTtZQUU3RCxJQUFJLE9BQU8sa0JBQWtCLEtBQUssVUFBVSxFQUFFLENBQUM7Z0JBQzdDLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsNkJBQTZCLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxFQUFFLEtBQUssSUFBSSxFQUFFO29CQUNuSCxNQUFNLGtCQUFrQixDQUFDO3dCQUN2QixhQUFhLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixFQUFFO3dCQUN0QyxxQkFBcUI7d0JBQ3JCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTt3QkFDN0IsaUJBQWlCO3dCQUNqQixNQUFNO3FCQUNQLENBQUMsQ0FBQTtnQkFDSixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0QixPQUFPO2dCQUNMLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtnQkFDN0IsY0FBYyxFQUFFLFVBQVUsQ0FBQyxNQUFNO2dCQUNqQyxXQUFXO2FBQ1osQ0FBQTtRQUNILENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBNaWdyYXRvciBmcm9tIFwiLi4vLi4vLi4vLi4vZGF0YWJhc2UvbWlncmF0b3IuanNcIlxuaW1wb3J0IFRlbmFudERhdGFiYXNlQ29tbWFuZEhlbHBlciBmcm9tIFwiLi4vLi4vLi4vdGVuYW50LWRhdGFiYXNlLWNvbW1hbmQtaGVscGVyLmpzXCJcbmltcG9ydCBtaWdyYXRpb25FeGVjdXRpb25QaGFzZUFyZ3VtZW50IGZyb20gXCIuLi8uLi8uLi9taWdyYXRpb24tZXhlY3V0aW9uLXBoYXNlLWFyZ3VtZW50LmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJUZW5hbnRzTWlncmF0ZSBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2lkZW50aWZpZXI6IHN0cmluZywgbWlncmF0aW9uQ291bnQ6IG51bWJlciwgdGVuYW50Q291bnQ6IG51bWJlcn0gfCB2b2lkPn0gLSBSZXN1bHQgaW4gdGVzdCBtb2RlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBleGVjdXRpb25QaGFzZSA9IG1pZ3JhdGlvbkV4ZWN1dGlvblBoYXNlQXJndW1lbnQodGhpcy5wcm9jZXNzQXJncyB8fCBbXSlcbiAgICBjb25zdCBoZWxwZXIgPSBuZXcgVGVuYW50RGF0YWJhc2VDb21tYW5kSGVscGVyKHtcbiAgICAgIGNvbW1hbmQ6IHRoaXMsXG4gICAgICBpZGVudGlmaWVyOiB0aGlzLnByb2Nlc3NBcmdzPy5bMV1cbiAgICB9KVxuICAgIGNvbnN0IG1pZ3JhdGlvbnMgPSBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmZpbmRNaWdyYXRpb25zKClcbiAgICBjb25zdCB0ZW5hbnRDb3VudCA9IGF3YWl0IGhlbHBlci5lYWNoVGVuYW50KGFzeW5jICh7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCB0ZW5hbnR9KSA9PiB7XG4gICAgICBjb25zdCBtaWdyYXRvciA9IG5ldyBNaWdyYXRvcih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXJzOiBbaGVscGVyLmlkZW50aWZpZXJdLFxuICAgICAgICBleGVjdXRpb25QaGFzZVxuICAgICAgfSlcblxuICAgICAgbGV0IG1pZ3JhdGlvbnNBcHBsaWVkID0gMFxuXG4gICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2hlbHBlci5pZGVudGlmaWVyXSwgbmFtZTogYERCIHRlbmFudHMgbWlncmF0ZTogJHtoZWxwZXIuaWRlbnRpZmllcn1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBtaWdyYXRvci5wcmVwYXJlKClcbiAgICAgICAgbWlncmF0aW9uc0FwcGxpZWQgPSBhd2FpdCBtaWdyYXRvci5taWdyYXRlRmlsZXMobWlncmF0aW9ucywgZGlnZyh0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLCBcInJlcXVpcmVNaWdyYXRpb25cIikpXG4gICAgICB9KVxuXG4gICAgICBjb25zdCBhZnRlck1pZ3JhdGVUZW5hbnQgPSBoZWxwZXIucHJvdmlkZXIuYWZ0ZXJNaWdyYXRlVGVuYW50XG5cbiAgICAgIGlmICh0eXBlb2YgYWZ0ZXJNaWdyYXRlVGVuYW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGBEQiB0ZW5hbnRzIGFmdGVyIG1pZ3JhdGU6ICR7aGVscGVyLmlkZW50aWZpZXJ9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBhZnRlck1pZ3JhdGVUZW5hbnQoe1xuICAgICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICBpZGVudGlmaWVyOiBoZWxwZXIuaWRlbnRpZmllcixcbiAgICAgICAgICAgIG1pZ3JhdGlvbnNBcHBsaWVkLFxuICAgICAgICAgICAgdGVuYW50XG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuYXJncy50ZXN0aW5nKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpZGVudGlmaWVyOiBoZWxwZXIuaWRlbnRpZmllcixcbiAgICAgICAgbWlncmF0aW9uQ291bnQ6IG1pZ3JhdGlvbnMubGVuZ3RoLFxuICAgICAgICB0ZW5hbnRDb3VudFxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIl19