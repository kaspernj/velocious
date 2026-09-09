// @ts-check
import TenantIterator from "../tenants/tenant-iterator.js";
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export default class TenantDatabaseCommandHelper {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./base-command.js").default} args.command - CLI command instance.
     * @param {number} [args.heartbeatIntervalMs] - Interval between progress heartbeats.
     * @param {string | undefined} args.identifier - Tenant database identifier.
     * @param {(message: string) => void} [args.output] - Progress output handler.
     */
    constructor({ command, heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, identifier, output = console.log }) {
        if (!identifier)
            throw new Error("Missing tenant database identifier argument");
        this.command = command;
        this.configuration = command.getConfiguration();
        this.heartbeatIntervalMs = heartbeatIntervalMs;
        this.identifier = identifier;
        this.output = output;
        this.provider = this.configuration.getTenantDatabaseProvider(identifier);
    }
    /**
     * Runs validate tenant database identifier.
     * @returns {void} */
    validateTenantDatabaseIdentifier() {
        const databaseConfiguration = this.configuration.getDatabaseConfiguration()[this.identifier];
        if (!databaseConfiguration) {
            throw new Error(`No such database identifier configured: ${this.identifier}`);
        }
        if (!databaseConfiguration.tenantOnly) {
            throw new Error(`Database identifier ${this.identifier} is not configured with tenantOnly: true`);
        }
        if (this.configuration.getDisabledDatabaseIdentifiers().has(this.identifier)) {
            throw new Error(`Tenant database identifier ${this.identifier} is disabled by VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS`);
        }
        if (typeof this.provider.listTenants !== "function") {
            throw new Error(`Tenant database provider for ${this.identifier} must define listTenants`);
        }
    }
    /**
     * Runs initialize runtime.
     * @returns {Promise<void>} - Resolves when app runtime is initialized.
     */
    async initializeRuntime() {
        await this.configuration.initialize({ type: "db-tenants" });
    }
    /**
     * Runs list tenants.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Tenants.
     */
    async listTenants() {
        this.validateTenantDatabaseIdentifier();
        await this.initializeRuntime();
        const tenants = await this.configuration.ensureConnections({ name: `Tenant database list: ${this.identifier}` }, async () => {
            return await this.provider.listTenants({
                configuration: this.configuration,
                identifier: this.identifier
            });
        });
        if (!Array.isArray(tenants)) {
            throw new Error(`Tenant database provider for ${this.identifier} must return an array from listTenants`);
        }
        return tenants;
    }
    /**
     * Runs each tenant.
     * @param {(args: {databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ReturnType<typeof JSON.parse>}) => Promise<void>} callback - Callback.
     * @returns {Promise<number>} - Number of tenants processed.
     */
    async eachTenant(callback) {
        const tenants = await this.listTenants();
        const commandName = this.command.processArgs?.[0] || "db:tenants";
        const parallelCount = this.parallelCount();
        const progressPrefix = `${commandName} ${this.identifier}`;
        let activeTenantCount = 0;
        let completedTenantCount = 0;
        const iterator = new TenantIterator({
            configuration: this.configuration,
            identifier: this.identifier,
            parallelCount
        });
        const progressHeartbeat = setInterval(() => {
            this.output(`${progressPrefix}: heartbeat: ${completedTenantCount}/${tenants.length} completed, ${activeTenantCount} active`);
        }, this.heartbeatIntervalMs);
        progressHeartbeat.unref();
        this.output(`${progressPrefix}: processing ${tenants.length} tenant(s) with parallelism ${parallelCount}`);
        try {
            const processedTenantCount = await iterator.run(tenants, async (args) => {
                activeTenantCount++;
                try {
                    await callback(args);
                    completedTenantCount++;
                    this.output(`${progressPrefix}: completed ${TenantIterator.tenantLabel(args.tenant)} (${completedTenantCount}/${tenants.length})`);
                }
                finally {
                    activeTenantCount--;
                }
            });
            this.output(`${progressPrefix}: finished ${processedTenantCount}/${tenants.length} tenant(s)`);
            return processedTenantCount;
        }
        finally {
            clearInterval(progressHeartbeat);
        }
    }
    /**
     * Runs parallel count.
     * @returns {number} - Number of tenants to process concurrently.
     */
    parallelCount() {
        const parsedProcessArgs = this.command.args?.parsedProcessArgs || {};
        let parallelArg = parsedProcessArgs.parallel;
        if (parallelArg === undefined) {
            const parallelArgIndex = this.command.processArgs?.indexOf("--parallel") ?? -1;
            if (parallelArgIndex >= 0) {
                const nextArg = this.command.processArgs?.[parallelArgIndex + 1];
                parallelArg = nextArg && !nextArg.startsWith("-") ? nextArg : true;
            }
        }
        if (parallelArg === undefined || parallelArg === false)
            return 1;
        if (parallelArg === true)
            return 20;
        const parallelCount = Number(parallelArg);
        if (!Number.isInteger(parallelCount) || parallelCount < 1) {
            throw new Error(`--parallel must be a positive integer when a value is provided: ${parallelArg}`);
        }
        return parallelCount;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuYW50LWRhdGFiYXNlLWNvbW1hbmQtaGVscGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NsaS90ZW5hbnQtZGF0YWJhc2UtY29tbWFuZC1oZWxwZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLCtCQUErQixDQUFBO0FBRTFELE1BQU0sNkJBQTZCLEdBQUcsTUFBTSxDQUFBO0FBRTVDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sMkJBQTJCO0lBQzlDOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEVBQUMsT0FBTyxFQUFFLG1CQUFtQixHQUFHLDZCQUE2QixFQUFFLFVBQVUsRUFBRSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsRUFBQztRQUMxRyxJQUFJLENBQUMsVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNkNBQTZDLENBQUMsQ0FBQTtRQUUvRSxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtRQUN0QixJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQy9DLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxtQkFBbUIsQ0FBQTtRQUM5QyxJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtRQUM1QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMseUJBQXlCLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDMUUsQ0FBQztJQUVEOzt5QkFFcUI7SUFDckIsZ0NBQWdDO1FBQzlCLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUU1RixJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLDJDQUEyQyxJ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QUFXLEVBQUUsT0FBTyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO1lBRTlFLElBQUksZ0JBQWdCLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQzFCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLENBQUE7Z0JBRWhFLFdBQVcsR0FBRyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUNwRSxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksV0FBVyxLQUFLLFNBQVMsSUFBSSxXQUFXLEtBQUssS0FBSztZQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ2hFLElBQUksV0FBVyxLQUFLLElBQUk7WUFBRSxPQUFPLEVBQUUsQ0FBQTtRQUVuQyxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUE7UUFFekMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLElBQUksYUFBYSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzFELE1BQU0sSUFBSSxLQUFLLENBQUMsbUVBQW1FLFdBQVcsRUFBRSxDQUFDLENBQUE7UUFDbkcsQ0FBQztRQUVELE9BQU8sYUFBYSxDQUFBO0lBQ3RCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVGVuYW50SXRlcmF0b3IgZnJvbSBcIi4uL3RlbmFudHMvdGVuYW50LWl0ZXJhdG9yLmpzXCJcblxuY29uc3QgREVGQVVMVF9IRUFSVEJFQVRfSU5URVJWQUxfTVMgPSAzMF8wMDBcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVuYW50RGF0YWJhc2VDb21tYW5kSGVscGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gYXJncy5jb21tYW5kIC0gQ0xJIGNvbW1hbmQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oZWFydGJlYXRJbnRlcnZhbE1zXSAtIEludGVydmFsIGJldHdlZW4gcHJvZ3Jlc3MgaGVhcnRiZWF0cy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuaWRlbnRpZmllciAtIFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geyhtZXNzYWdlOiBzdHJpbmcpID0+IHZvaWR9IFthcmdzLm91dHB1dF0gLSBQcm9ncmVzcyBvdXRwdXQgaGFuZGxlci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb21tYW5kLCBoZWFydGJlYXRJbnRlcnZhbE1zID0gREVGQVVMVF9IRUFSVEJFQVRfSU5URVJWQUxfTVMsIGlkZW50aWZpZXIsIG91dHB1dCA9IGNvbnNvbGUubG9nfSkge1xuICAgIGlmICghaWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciBhcmd1bWVudFwiKVxuXG4gICAgdGhpcy5jb21tYW5kID0gY29tbWFuZFxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbW1hbmQuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgdGhpcy5oZWFydGJlYXRJbnRlcnZhbE1zID0gaGVhcnRiZWF0SW50ZXJ2YWxNc1xuICAgIHRoaXMuaWRlbnRpZmllciA9IGlkZW50aWZpZXJcbiAgICB0aGlzLm91dHB1dCA9IG91dHB1dFxuICAgIHRoaXMucHJvdmlkZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcihpZGVudGlmaWVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdmFsaWRhdGUgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICB2YWxpZGF0ZVRlbmFudERhdGFiYXNlSWRlbnRpZmllcigpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKClbdGhpcy5pZGVudGlmaWVyXVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBkYXRhYmFzZSBpZGVudGlmaWVyIGNvbmZpZ3VyZWQ6ICR7dGhpcy5pZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEYXRhYmFzZSBpZGVudGlmaWVyICR7dGhpcy5pZGVudGlmaWVyfSBpcyBub3QgY29uZmlndXJlZCB3aXRoIHRlbmFudE9ubHk6IHRydWVgKVxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGlzYWJsZWREYXRhYmFzZUlkZW50aWZpZXJzKCkuaGFzKHRoaXMuaWRlbnRpZmllcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHt0aGlzLmlkZW50aWZpZXJ9IGlzIGRpc2FibGVkIGJ5IFZFTE9DSU9VU19ESVNBQkxFRF9EQVRBQkFTRV9JREVOVElGSUVSU2ApXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLnByb3ZpZGVyLmxpc3RUZW5hbnRzICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGZvciAke3RoaXMuaWRlbnRpZmllcn0gbXVzdCBkZWZpbmUgbGlzdFRlbmFudHNgKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgcnVudGltZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhcHAgcnVudGltZSBpcyBpbml0aWFsaXplZC5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemVSdW50aW1lKCkge1xuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBcImRiLXRlbmFudHNcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaXN0IHRlbmFudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGVuYW50cy5cbiAgICovXG4gIGFzeW5jIGxpc3RUZW5hbnRzKCkge1xuICAgIHRoaXMudmFsaWRhdGVUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZVJ1bnRpbWUoKVxuXG4gICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogYFRlbmFudCBkYXRhYmFzZSBsaXN0OiAke3RoaXMuaWRlbnRpZmllcn1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucHJvdmlkZXIubGlzdFRlbmFudHMoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGlkZW50aWZpZXI6IHRoaXMuaWRlbnRpZmllclxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRlbmFudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBmb3IgJHt0aGlzLmlkZW50aWZpZXJ9IG11c3QgcmV0dXJuIGFuIGFycmF5IGZyb20gbGlzdFRlbmFudHNgKVxuICAgIH1cblxuICAgIHJldHVybiB0ZW5hbnRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlYWNoIHRlbmFudC5cbiAgICogQHBhcmFtIHsoYXJnczoge2RhdGFiYXNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCB0ZW5hbnQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOdW1iZXIgb2YgdGVuYW50cyBwcm9jZXNzZWQuXG4gICAqL1xuICBhc3luYyBlYWNoVGVuYW50KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IHRoaXMubGlzdFRlbmFudHMoKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gdGhpcy5jb21tYW5kLnByb2Nlc3NBcmdzPy5bMF0gfHwgXCJkYjp0ZW5hbnRzXCJcbiAgICBjb25zdCBwYXJhbGxlbENvdW50ID0gdGhpcy5wYXJhbGxlbENvdW50KClcbiAgICBjb25zdCBwcm9ncmVzc1ByZWZpeCA9IGAke2NvbW1hbmROYW1lfSAke3RoaXMuaWRlbnRpZmllcn1gXG4gICAgbGV0IGFjdGl2ZVRlbmFudENvdW50ID0gMFxuICAgIGxldCBjb21wbGV0ZWRUZW5hbnRDb3VudCA9IDBcbiAgICBjb25zdCBpdGVyYXRvciA9IG5ldyBUZW5hbnRJdGVyYXRvcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICBpZGVudGlmaWVyOiB0aGlzLmlkZW50aWZpZXIsXG4gICAgICBwYXJhbGxlbENvdW50XG4gICAgfSlcbiAgICBjb25zdCBwcm9ncmVzc0hlYXJ0YmVhdCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgIHRoaXMub3V0cHV0KGAke3Byb2dyZXNzUHJlZml4fTogaGVhcnRiZWF0OiAke2NvbXBsZXRlZFRlbmFudENvdW50fS8ke3RlbmFudHMubGVuZ3RofSBjb21wbGV0ZWQsICR7YWN0aXZlVGVuYW50Q291bnR9IGFjdGl2ZWApXG4gICAgfSwgdGhpcy5oZWFydGJlYXRJbnRlcnZhbE1zKVxuXG4gICAgcHJvZ3Jlc3NIZWFydGJlYXQudW5yZWYoKVxuICAgIHRoaXMub3V0cHV0KGAke3Byb2dyZXNzUHJlZml4fTogcHJvY2Vzc2luZyAke3RlbmFudHMubGVuZ3RofSB0ZW5hbnQocykgd2l0aCBwYXJhbGxlbGlzbSAke3BhcmFsbGVsQ291bnR9YClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm9jZXNzZWRUZW5hbnRDb3VudCA9IGF3YWl0IGl0ZXJhdG9yLnJ1bih0ZW5hbnRzLCBhc3luYyAoYXJncykgPT4ge1xuICAgICAgICBhY3RpdmVUZW5hbnRDb3VudCsrXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBjYWxsYmFjayhhcmdzKVxuICAgICAgICAgIGNvbXBsZXRlZFRlbmFudENvdW50KytcbiAgICAgICAgICB0aGlzLm91dHB1dChgJHtwcm9ncmVzc1ByZWZpeH06IGNvbXBsZXRlZCAke1RlbmFudEl0ZXJhdG9yLnRlbmFudExhYmVsKGFyZ3MudGVuYW50KX0gKCR7Y29tcGxldGVkVGVuYW50Q291bnR9LyR7dGVuYW50cy5sZW5ndGh9KWApXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgYWN0aXZlVGVuYW50Q291bnQtLVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICB0aGlzLm91dHB1dChgJHtwcm9ncmVzc1ByZWZpeH06IGZpbmlzaGVkICR7cHJvY2Vzc2VkVGVuYW50Q291bnR9LyR7dGVuYW50cy5sZW5ndGh9IHRlbmFudChzKWApXG5cbiAgICAgIHJldHVybiBwcm9jZXNzZWRUZW5hbnRDb3VudFxuICAgIH0gZmluYWxseSB7XG4gICAgICBjbGVhckludGVydmFsKHByb2dyZXNzSGVhcnRiZWF0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcmFsbGVsIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiB0ZW5hbnRzIHRvIHByb2Nlc3MgY29uY3VycmVudGx5LlxuICAgKi9cbiAgcGFyYWxsZWxDb3VudCgpIHtcbiAgICBjb25zdCBwYXJzZWRQcm9jZXNzQXJncyA9IHRoaXMuY29tbWFuZC5hcmdzPy5wYXJzZWRQcm9jZXNzQXJncyB8fCB7fVxuICAgIGxldCBwYXJhbGxlbEFyZyA9IHBhcnNlZFByb2Nlc3NBcmdzLnBhcmFsbGVsXG5cbiAgICBpZiAocGFyYWxsZWxBcmcgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgcGFyYWxsZWxBcmdJbmRleCA9IHRoaXMuY29tbWFuZC5wcm9jZXNzQXJncz8uaW5kZXhPZihcIi0tcGFyYWxsZWxcIikgPz8gLTFcblxuICAgICAgaWYgKHBhcmFsbGVsQXJnSW5kZXggPj0gMCkge1xuICAgICAgICBjb25zdCBuZXh0QXJnID0gdGhpcy5jb21tYW5kLnByb2Nlc3NBcmdzPy5bcGFyYWxsZWxBcmdJbmRleCArIDFdXG5cbiAgICAgICAgcGFyYWxsZWxBcmcgPSBuZXh0QXJnICYmICFuZXh0QXJnLnN0YXJ0c1dpdGgoXCItXCIpID8gbmV4dEFyZyA6IHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocGFyYWxsZWxBcmcgPT09IHVuZGVmaW5lZCB8fCBwYXJhbGxlbEFyZyA9PT0gZmFsc2UpIHJldHVybiAxXG4gICAgaWYgKHBhcmFsbGVsQXJnID09PSB0cnVlKSByZXR1cm4gMjBcblxuICAgIGNvbnN0IHBhcmFsbGVsQ291bnQgPSBOdW1iZXIocGFyYWxsZWxBcmcpXG5cbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIocGFyYWxsZWxDb3VudCkgfHwgcGFyYWxsZWxDb3VudCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgLS1wYXJhbGxlbCBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlciB3aGVuIGEgdmFsdWUgaXMgcHJvdmlkZWQ6ICR7cGFyYWxsZWxBcmd9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyYWxsZWxDb3VudFxuICB9XG59XG4iXX0=