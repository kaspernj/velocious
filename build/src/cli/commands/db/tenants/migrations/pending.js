// @ts-check
import { digg } from "diggerize";
import BaseCommand from "../../../../base-command.js";
import TenantDatabaseCommandHelper from "../../../../tenant-database-command-helper.js";
import TenantMigrationPendingInspector from "../../../../../database/tenants/migration-pending-inspector.js";
import { migrationRunsInExecutionPhase } from "../../../../../database/migration-execution-phase.js";
import migrationExecutionPhaseArgument from "../../../../migration-execution-phase-argument.js";
export default class DbTenantsMigrationsPending extends BaseCommand {
    /**
     * Reports aggregate tenant migration state as one machine-readable JSON object.
     * @returns {Promise<{hasPendingMigrations: boolean, identifier: string, migrationCount: number, pendingTenantCount: number, tenantCount: number}>} - Deploy preflight result.
     */
    async execute() {
        const executionPhase = migrationExecutionPhaseArgument(this.processArgs || []);
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
            if (migrationRunsInExecutionPhase(MigrationClass, executionPhase) && (MigrationClass.getDatabaseIdentifiers() || ["default"]).includes(helper.identifier)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGVuZGluZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3NyYy9jbGkvY29tbWFuZHMvZGIvdGVuYW50cy9taWdyYXRpb25zL3BlbmRpbmcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxXQUFXLE1BQU0sNkJBQTZCLENBQUE7QUFDckQsT0FBTywyQkFBMkIsTUFBTSwrQ0FBK0MsQ0FBQTtBQUN2RixPQUFPLCtCQUErQixNQUFNLGdFQUFnRSxDQUFBO0FBQzVHLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNEQUFzRCxDQUFBO0FBQ3BHLE9BQU8sK0JBQStCLE1BQU0sbURBQW1ELENBQUE7QUFFL0YsTUFBTSxDQUFDLE9BQU8sT0FBTywwQkFBMkIsU0FBUSxXQUFXO0lBQ2pFOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxjQUFjLEdBQUcsK0JBQStCLENBQUMsSUFBSSxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUM5RSxNQUFNLE1BQU0sR0FBRyxJQUFJLDJCQUEyQixDQUFDO1lBQzdDLE9BQU8sRUFBRSxJQUFJO1lBQ2IsVUFBVSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUM7U0FDbEMsQ0FBQyxDQUFBO1FBQ0YsTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUN0RSxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsRUFBRSxrQkFBa0IsQ0FBQyxDQUFBO1FBQy9FLE1BQU0sMkJBQTJCLEdBQUcsRUFBRSxDQUFBO1FBRXRDLEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1lBRW5HLE1BQU0sY0FBYyxHQUFHLE1BQU0sZ0JBQWdCLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBRWpFLElBQUksNkJBQTZCLENBQUMsY0FBYyxFQUFFLGNBQWMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLHNCQUFzQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDMUosMkJBQTJCLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUNsRCxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sT0FBTyxHQUFHLE1BQU0sTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQzFDLE1BQU0sU0FBUyxHQUFHLElBQUksK0JBQStCLENBQUM7WUFDcEQsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRTtZQUN0QyxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7WUFDN0IsaUJBQWlCLEVBQUUsMkJBQTJCO1lBQzlDLE9BQU87U0FDUixDQUFDLENBQUE7UUFDRixNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUV4QyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPO1lBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7UUFFM0QsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBCYXNlQ29tbWFuZCBmcm9tIFwiLi4vLi4vLi4vLi4vYmFzZS1jb21tYW5kLmpzXCJcbmltcG9ydCBUZW5hbnREYXRhYmFzZUNvbW1hbmRIZWxwZXIgZnJvbSBcIi4uLy4uLy4uLy4uL3RlbmFudC1kYXRhYmFzZS1jb21tYW5kLWhlbHBlci5qc1wiXG5pbXBvcnQgVGVuYW50TWlncmF0aW9uUGVuZGluZ0luc3BlY3RvciBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvdGVuYW50cy9taWdyYXRpb24tcGVuZGluZy1pbnNwZWN0b3IuanNcIlxuaW1wb3J0IHsgbWlncmF0aW9uUnVuc0luRXhlY3V0aW9uUGhhc2UgfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvbWlncmF0aW9uLWV4ZWN1dGlvbi1waGFzZS5qc1wiXG5pbXBvcnQgbWlncmF0aW9uRXhlY3V0aW9uUGhhc2VBcmd1bWVudCBmcm9tIFwiLi4vLi4vLi4vLi4vbWlncmF0aW9uLWV4ZWN1dGlvbi1waGFzZS1hcmd1bWVudC5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIERiVGVuYW50c01pZ3JhdGlvbnNQZW5kaW5nIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogUmVwb3J0cyBhZ2dyZWdhdGUgdGVuYW50IG1pZ3JhdGlvbiBzdGF0ZSBhcyBvbmUgbWFjaGluZS1yZWFkYWJsZSBKU09OIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2hhc1BlbmRpbmdNaWdyYXRpb25zOiBib29sZWFuLCBpZGVudGlmaWVyOiBzdHJpbmcsIG1pZ3JhdGlvbkNvdW50OiBudW1iZXIsIHBlbmRpbmdUZW5hbnRDb3VudDogbnVtYmVyLCB0ZW5hbnRDb3VudDogbnVtYmVyfT59IC0gRGVwbG95IHByZWZsaWdodCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvblBoYXNlID0gbWlncmF0aW9uRXhlY3V0aW9uUGhhc2VBcmd1bWVudCh0aGlzLnByb2Nlc3NBcmdzIHx8IFtdKVxuICAgIGNvbnN0IGhlbHBlciA9IG5ldyBUZW5hbnREYXRhYmFzZUNvbW1hbmRIZWxwZXIoe1xuICAgICAgY29tbWFuZDogdGhpcyxcbiAgICAgIGlkZW50aWZpZXI6IHRoaXMucHJvY2Vzc0FyZ3M/LlsxXVxuICAgIH0pXG4gICAgY29uc3QgbWlncmF0aW9ucyA9IGF3YWl0IHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZmluZE1pZ3JhdGlvbnMoKVxuICAgIGNvbnN0IHJlcXVpcmVNaWdyYXRpb24gPSBkaWdnKHRoaXMuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCksIFwicmVxdWlyZU1pZ3JhdGlvblwiKVxuICAgIGNvbnN0IGFwcGxpY2FibGVNaWdyYXRpb25WZXJzaW9ucyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBtaWdyYXRpb25zKSB7XG4gICAgICBpZiAoIW1pZ3JhdGlvbi5mdWxsUGF0aCkgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gZGlkbid0IGhhdmUgYSBmdWxsUGF0aCBrZXk6ICR7bWlncmF0aW9uLmZpbGV9YClcblxuICAgICAgY29uc3QgTWlncmF0aW9uQ2xhc3MgPSBhd2FpdCByZXF1aXJlTWlncmF0aW9uKG1pZ3JhdGlvbi5mdWxsUGF0aClcblxuICAgICAgaWYgKG1pZ3JhdGlvblJ1bnNJbkV4ZWN1dGlvblBoYXNlKE1pZ3JhdGlvbkNsYXNzLCBleGVjdXRpb25QaGFzZSkgJiYgKE1pZ3JhdGlvbkNsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB8fCBbXCJkZWZhdWx0XCJdKS5pbmNsdWRlcyhoZWxwZXIuaWRlbnRpZmllcikpIHtcbiAgICAgICAgYXBwbGljYWJsZU1pZ3JhdGlvblZlcnNpb25zLnB1c2gobWlncmF0aW9uLmRhdGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IGhlbHBlci5saXN0VGVuYW50cygpXG4gICAgY29uc3QgaW5zcGVjdG9yID0gbmV3IFRlbmFudE1pZ3JhdGlvblBlbmRpbmdJbnNwZWN0b3Ioe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBpZGVudGlmaWVyOiBoZWxwZXIuaWRlbnRpZmllcixcbiAgICAgIG1pZ3JhdGlvblZlcnNpb25zOiBhcHBsaWNhYmxlTWlncmF0aW9uVmVyc2lvbnMsXG4gICAgICB0ZW5hbnRzXG4gICAgfSlcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBpbnNwZWN0b3IuaW5zcGVjdCgpXG5cbiAgICBpZiAoIXRoaXMuYXJncy50ZXN0aW5nKSBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHQpKVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG59XG4iXX0=