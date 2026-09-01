// @ts-check
import { digg } from "diggerize";
import BaseCommand from "../../../base-command.js";
import Migrator from "../../../../database/migrator.js";
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js";
export default class DbTenantsMigrate extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<{identifier: string, migrationCount: number, tenantCount: number} | void>} - Result in test mode.
     */
    async execute() {
        const helper = new TenantDatabaseCommandHelper({
            command: this,
            identifier: this.processArgs?.[1]
        });
        const migrations = await this.getEnvironmentHandler().findMigrations();
        const tenantCount = await helper.eachTenant(async ({ databaseConfiguration, tenant }) => {
            const migrator = new Migrator({
                configuration: this.getConfiguration(),
                databaseIdentifiers: [helper.identifier]
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9jbGkvY29tbWFuZHMvZGIvdGVuYW50cy9taWdyYXRlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sV0FBVyxNQUFNLDBCQUEwQixDQUFBO0FBQ2xELE9BQU8sUUFBUSxNQUFNLGtDQUFrQyxDQUFBO0FBQ3ZELE9BQU8sMkJBQTJCLE1BQU0sNENBQTRDLENBQUE7QUFFcEYsTUFBTSxDQUFDLE9BQU8sT0FBTyxnQkFBaUIsU0FBUSxXQUFXO0lBQ3ZEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxNQUFNLEdBQUcsSUFBSSwyQkFBMkIsQ0FBQztZQUM3QyxPQUFPLEVBQUUsSUFBSTtZQUNiLFVBQVUsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDO1NBQ2xDLENBQUMsQ0FBQTtRQUNGLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsY0FBYyxFQUFFLENBQUE7UUFDdEUsTUFBTSxXQUFXLEdBQUcsTUFBTSxNQUFNLENBQUMsVUFBVSxDQUFDLEtBQUssRUFBRSxFQUFDLHFCQUFxQixFQUFFLE1BQU0sRUFBQyxFQUFFLEVBQUU7WUFDcEYsTUFBTSxRQUFRLEdBQUcsSUFBSSxRQUFRLENBQUM7Z0JBQzVCLGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3RDLG1CQUFtQixFQUFFLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQzthQUN6QyxDQUFDLENBQUE7WUFFRixJQUFJLGlCQUFpQixHQUFHLENBQUMsQ0FBQTtZQUV6QixNQUFNLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsbUJBQW1CLEVBQUUsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLEVBQUUsSUFBSSxFQUFFLHVCQUF1QixNQUFNLENBQUMsVUFBVSxFQUFFLEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDdkosTUFBTSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUE7Z0JBQ3hCLGlCQUFpQixHQUFHLE1BQU0sUUFBUSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxFQUFFLGtCQUFrQixDQUFDLENBQUMsQ0FBQTtZQUNySCxDQUFDLENBQUMsQ0FBQTtZQUVGLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQTtZQUU3RCxJQUFJLE9BQU8sa0JBQWtCLEtBQUssVUFBVSxFQUFFLENBQUM7Z0JBQzdDLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsNkJBQTZCLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxFQUFFLEtBQUssSUFBSSxFQUFFO29CQUNuSCxNQUFNLGtCQUFrQixDQUFDO3dCQUN2QixhQUFhLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixFQUFFO3dCQUN0QyxxQkFBcUI7d0JBQ3JCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTt3QkFDN0IsaUJBQWlCO3dCQUNqQixNQUFNO3FCQUNQLENBQUMsQ0FBQTtnQkFDSixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0QixPQUFPO2dCQUNMLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtnQkFDN0IsY0FBYyxFQUFFLFVBQVUsQ0FBQyxNQUFNO2dCQUNqQyxXQUFXO2FBQ1osQ0FBQTtRQUNILENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBNaWdyYXRvciBmcm9tIFwiLi4vLi4vLi4vLi4vZGF0YWJhc2UvbWlncmF0b3IuanNcIlxuaW1wb3J0IFRlbmFudERhdGFiYXNlQ29tbWFuZEhlbHBlciBmcm9tIFwiLi4vLi4vLi4vdGVuYW50LWRhdGFiYXNlLWNvbW1hbmQtaGVscGVyLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJUZW5hbnRzTWlncmF0ZSBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2lkZW50aWZpZXI6IHN0cmluZywgbWlncmF0aW9uQ291bnQ6IG51bWJlciwgdGVuYW50Q291bnQ6IG51bWJlcn0gfCB2b2lkPn0gLSBSZXN1bHQgaW4gdGVzdCBtb2RlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBoZWxwZXIgPSBuZXcgVGVuYW50RGF0YWJhc2VDb21tYW5kSGVscGVyKHtcbiAgICAgIGNvbW1hbmQ6IHRoaXMsXG4gICAgICBpZGVudGlmaWVyOiB0aGlzLnByb2Nlc3NBcmdzPy5bMV1cbiAgICB9KVxuICAgIGNvbnN0IG1pZ3JhdGlvbnMgPSBhd2FpdCB0aGlzLmdldEVudmlyb25tZW50SGFuZGxlcigpLmZpbmRNaWdyYXRpb25zKClcbiAgICBjb25zdCB0ZW5hbnRDb3VudCA9IGF3YWl0IGhlbHBlci5lYWNoVGVuYW50KGFzeW5jICh7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCB0ZW5hbnR9KSA9PiB7XG4gICAgICBjb25zdCBtaWdyYXRvciA9IG5ldyBNaWdyYXRvcih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXJzOiBbaGVscGVyLmlkZW50aWZpZXJdXG4gICAgICB9KVxuXG4gICAgICBsZXQgbWlncmF0aW9uc0FwcGxpZWQgPSAwXG5cbiAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbaGVscGVyLmlkZW50aWZpZXJdLCBuYW1lOiBgREIgdGVuYW50cyBtaWdyYXRlOiAke2hlbHBlci5pZGVudGlmaWVyfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IG1pZ3JhdG9yLnByZXBhcmUoKVxuICAgICAgICBtaWdyYXRpb25zQXBwbGllZCA9IGF3YWl0IG1pZ3JhdG9yLm1pZ3JhdGVGaWxlcyhtaWdyYXRpb25zLCBkaWdnKHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCksIFwicmVxdWlyZU1pZ3JhdGlvblwiKSlcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGFmdGVyTWlncmF0ZVRlbmFudCA9IGhlbHBlci5wcm92aWRlci5hZnRlck1pZ3JhdGVUZW5hbnRcblxuICAgICAgaWYgKHR5cGVvZiBhZnRlck1pZ3JhdGVUZW5hbnQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogYERCIHRlbmFudHMgYWZ0ZXIgbWlncmF0ZTogJHtoZWxwZXIuaWRlbnRpZmllcn1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGFmdGVyTWlncmF0ZVRlbmFudCh7XG4gICAgICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIGlkZW50aWZpZXI6IGhlbHBlci5pZGVudGlmaWVyLFxuICAgICAgICAgICAgbWlncmF0aW9uc0FwcGxpZWQsXG4gICAgICAgICAgICB0ZW5hbnRcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBpZiAodGhpcy5hcmdzLnRlc3RpbmcpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGlkZW50aWZpZXI6IGhlbHBlci5pZGVudGlmaWVyLFxuICAgICAgICBtaWdyYXRpb25Db3VudDogbWlncmF0aW9ucy5sZW5ndGgsXG4gICAgICAgIHRlbmFudENvdW50XG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iXX0=