// @ts-check
import { digg } from "diggerize";
import BaseCommand from "../../../../base-command.js";
import TenantDatabaseCommandHelper from "../../../../tenant-database-command-helper.js";
import TenantMigrationPendingInspector from "../../../../../database/tenants/migration-pending-inspector.js";
export default class DbTenantsMigrationsPending extends BaseCommand {
    /**
     * Reports aggregate tenant migration state as one machine-readable JSON object.
     * @returns {Promise<{hasPendingMigrations: boolean, identifier: string, migrationCount: number, pendingTenantCount: number, tenantCount: number}>} - Deploy preflight result.
     */
    async execute() {
        const helper = new TenantDatabaseCommandHelper({
            command: this,
            identifier: this.processArgs?.[1]
        });
        const migrations = await this.getEnvironmentHandler().findMigrations();
        const requireMigration = digg(this.getEnvironmentHandler(), "requireMigration");
        const applicableMigrationVersions = [];
        for (const migration of migrations) {
            if (!migration.fullPath)
                throw new Error(`Migration didn't have a fullPath key: ${migration.file}`);
            const MigrationClass = await requireMigration(migration.fullPath);
            if ((MigrationClass.getDatabaseIdentifiers() || ["default"]).includes(helper.identifier)) {
                applicableMigrationVersions.push(migration.date);
            }
        }
        const tenants = await helper.listTenants();
        const inspector = new TenantMigrationPendingInspector({
            configuration: this.getConfiguration(),
            identifier: helper.identifier,
            migrationVersions: applicableMigrationVersions,
            tenants
        });
        const result = await inspector.inspect();
        if (!this.args.testing)
            console.log(JSON.stringify(result));
        return result;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGVuZGluZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3NyYy9jbGkvY29tbWFuZHMvZGIvdGVuYW50cy9taWdyYXRpb25zL3BlbmRpbmcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxXQUFXLE1BQU0sNkJBQTZCLENBQUE7QUFDckQsT0FBTywyQkFBMkIsTUFBTSwrQ0FBK0MsQ0FBQTtBQUN2RixPQUFPLCtCQUErQixNQUFNLGdFQUFnRSxDQUFBO0FBRTVHLE1BQU0sQ0FBQyxPQUFPLE9BQU8sMEJBQTJCLFNBQVEsV0FBVztJQUNqRTs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sTUFBTSxHQUFHLElBQUksMkJBQTJCLENBQUM7WUFDN0MsT0FBTyxFQUFFLElBQUk7WUFDYixVQUFVLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQztTQUNsQyxDQUFDLENBQUE7UUFDRixNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBQ3RFLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxFQUFFLGtCQUFrQixDQUFDLENBQUE7UUFDL0UsTUFBTSwyQkFBMkIsR0FBRyxFQUFFLENBQUE7UUFFdEMsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNuQyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVE7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5Q0FBeUMsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUE7WUFFbkcsTUFBTSxjQUFjLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUE7WUFFakUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxzQkFBc0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7Z0JBQ3pGLDJCQUEyQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDbEQsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBRyxNQUFNLE1BQU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUMxQyxNQUFNLFNBQVMsR0FBRyxJQUFJLCtCQUErQixDQUFDO1lBQ3BELGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7WUFDdEMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO1lBQzdCLGlCQUFpQixFQUFFLDJCQUEyQjtZQUM5QyxPQUFPO1NBQ1IsQ0FBQyxDQUFBO1FBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsT0FBTyxFQUFFLENBQUE7UUFFeEMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTztZQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFBO1FBRTNELE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQgVGVuYW50RGF0YWJhc2VDb21tYW5kSGVscGVyIGZyb20gXCIuLi8uLi8uLi8uLi90ZW5hbnQtZGF0YWJhc2UtY29tbWFuZC1oZWxwZXIuanNcIlxuaW1wb3J0IFRlbmFudE1pZ3JhdGlvblBlbmRpbmdJbnNwZWN0b3IgZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2RhdGFiYXNlL3RlbmFudHMvbWlncmF0aW9uLXBlbmRpbmctaW5zcGVjdG9yLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJUZW5hbnRzTWlncmF0aW9uc1BlbmRpbmcgZXh0ZW5kcyBCYXNlQ29tbWFuZCB7XG4gIC8qKlxuICAgKiBSZXBvcnRzIGFnZ3JlZ2F0ZSB0ZW5hbnQgbWlncmF0aW9uIHN0YXRlIGFzIG9uZSBtYWNoaW5lLXJlYWRhYmxlIEpTT04gb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7aGFzUGVuZGluZ01pZ3JhdGlvbnM6IGJvb2xlYW4sIGlkZW50aWZpZXI6IHN0cmluZywgbWlncmF0aW9uQ291bnQ6IG51bWJlciwgcGVuZGluZ1RlbmFudENvdW50OiBudW1iZXIsIHRlbmFudENvdW50OiBudW1iZXJ9Pn0gLSBEZXBsb3kgcHJlZmxpZ2h0IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgaGVscGVyID0gbmV3IFRlbmFudERhdGFiYXNlQ29tbWFuZEhlbHBlcih7XG4gICAgICBjb21tYW5kOiB0aGlzLFxuICAgICAgaWRlbnRpZmllcjogdGhpcy5wcm9jZXNzQXJncz8uWzFdXG4gICAgfSlcbiAgICBjb25zdCBtaWdyYXRpb25zID0gYXdhaXQgdGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5maW5kTWlncmF0aW9ucygpXG4gICAgY29uc3QgcmVxdWlyZU1pZ3JhdGlvbiA9IGRpZ2codGhpcy5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKSwgXCJyZXF1aXJlTWlncmF0aW9uXCIpXG4gICAgY29uc3QgYXBwbGljYWJsZU1pZ3JhdGlvblZlcnNpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uIG9mIG1pZ3JhdGlvbnMpIHtcbiAgICAgIGlmICghbWlncmF0aW9uLmZ1bGxQYXRoKSB0aHJvdyBuZXcgRXJyb3IoYE1pZ3JhdGlvbiBkaWRuJ3QgaGF2ZSBhIGZ1bGxQYXRoIGtleTogJHttaWdyYXRpb24uZmlsZX1gKVxuXG4gICAgICBjb25zdCBNaWdyYXRpb25DbGFzcyA9IGF3YWl0IHJlcXVpcmVNaWdyYXRpb24obWlncmF0aW9uLmZ1bGxQYXRoKVxuXG4gICAgICBpZiAoKE1pZ3JhdGlvbkNsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB8fCBbXCJkZWZhdWx0XCJdKS5pbmNsdWRlcyhoZWxwZXIuaWRlbnRpZmllcikpIHtcbiAgICAgICAgYXBwbGljYWJsZU1pZ3JhdGlvblZlcnNpb25zLnB1c2gobWlncmF0aW9uLmRhdGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IGhlbHBlci5saXN0VGVuYW50cygpXG4gICAgY29uc3QgaW5zcGVjdG9yID0gbmV3IFRlbmFudE1pZ3JhdGlvblBlbmRpbmdJbnNwZWN0b3Ioe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBpZGVudGlmaWVyOiBoZWxwZXIuaWRlbnRpZmllcixcbiAgICAgIG1pZ3JhdGlvblZlcnNpb25zOiBhcHBsaWNhYmxlTWlncmF0aW9uVmVyc2lvbnMsXG4gICAgICB0ZW5hbnRzXG4gICAgfSlcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBpbnNwZWN0b3IuaW5zcGVjdCgpXG5cbiAgICBpZiAoIXRoaXMuYXJncy50ZXN0aW5nKSBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHQpKVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG59XG4iXX0=