// @ts-check
import Tenant from "../tenants/tenant.js";
/**
 * Immutable selection of one logical tenant database and one provider-resolved
 * physical tenant. Schema tools can share this contract without ambient or
 * process-global selection state.
 */
export default class DatabaseGenerationContext {
    /**
     * Resolves one tenant-only database from its provider and captures its physical identity.
     * @param {object} args - Selection arguments.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {string} args.databaseIdentifier - Logical tenant-only database identifier.
     * @returns {Promise<DatabaseGenerationContext>} - Immutable selected database context.
     */
    static async resolve({ configuration, databaseIdentifier }) {
        const databaseConfiguration = configuration.getDatabaseConfiguration()[databaseIdentifier];
        if (!databaseConfiguration) {
            throw new Error(`No such tenant database identifier configured: ${databaseIdentifier}`);
        }
        if (!databaseConfiguration.tenantOnly) {
            throw new Error(`Database identifier ${databaseIdentifier} is not configured with tenantOnly: true`);
        }
        if (configuration.getDisabledDatabaseIdentifiers().has(databaseIdentifier)) {
            throw new Error(`Tenant database identifier ${databaseIdentifier} is disabled by VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS`);
        }
        const provider = configuration.getTenantDatabaseProvider(databaseIdentifier);
        await configuration.initialize({ type: "database-generation" });
        const tenants = await configuration.ensureConnections({ name: `Resolve database generation context: ${databaseIdentifier}` }, async () => {
            if (provider.resolveGenerationTenant) {
                const tenant = await provider.resolveGenerationTenant({ configuration, identifier: databaseIdentifier });
                return tenant === undefined ? [] : [tenant];
            }
            return await provider.listTenants({ configuration, identifier: databaseIdentifier });
        });
        if (!Array.isArray(tenants)) {
            throw new Error(`Tenant database provider for ${databaseIdentifier} must return an array from listTenants`);
        }
        if (tenants.length === 0) {
            throw new Error(`Tenant database selection ${databaseIdentifier} resolved no tenants`);
        }
        if (tenants.length !== 1) {
            throw new Error(`Tenant database selection ${databaseIdentifier} is ambiguous: provider returned ${tenants.length} tenants`);
        }
        const tenant = tenants[0];
        if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
            throw new Error(`Tenant database selection ${databaseIdentifier} returned an invalid tenant descriptor`);
        }
        const handle = Tenant.handle(tenant, configuration);
        // Resolve now so an inactive/stale descriptor fails before a selected
        // schema connection can be checked out or read.
        handle.databaseConfiguration(databaseIdentifier);
        return new DatabaseGenerationContext({ configuration, databaseIdentifier, handle });
    }
    /**
     * Runs constructor.
     * @param {object} args - Captured selection.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {string} args.databaseIdentifier - Logical database identifier.
     * @param {ReturnType<typeof Tenant.handle>} args.handle - Captured tenant handle.
     */
    constructor({ configuration, databaseIdentifier, handle }) {
        this._configuration = configuration;
        this._databaseIdentifier = databaseIdentifier;
        this._handle = handle;
        Object.freeze(this);
    }
    /**
     * Returns the captured logical database identifier.
     * @returns {string} - Captured logical database identifier.
     */
    databaseIdentifier() { return this._databaseIdentifier; }
    /**
     * Returns the captured physical database configuration.
     * @returns {import("../configuration-types.js").DatabaseConfigurationType} - Captured physical database configuration.
     */
    databaseConfiguration() { return this._handle.databaseConfiguration(this._databaseIdentifier); }
    /**
     * Returns the captured tenant descriptor.
     * @returns {ReturnType<ReturnType<typeof Tenant.handle>["tenant"]>} - Captured immutable tenant descriptor.
     */
    tenant() { return this._handle.tenant(); }
    /**
     * Runs work on one connection pinned to the captured physical database.
     * @template T
     * @param {object} args - Work arguments.
     * @param {(connection: import("./drivers/base.js").default) => Promise<T>} args.callback - Selected database work.
     * @param {string} args.name - Checkout name.
     * @returns {Promise<T>} - Callback result.
     */
    async run({ callback, name }) {
        return await this._configuration.runWithTenant(this.tenant(), async () => {
            return await this._configuration.withDatabaseOperation({
                databaseConfiguration: this.databaseConfiguration(),
                databaseIdentifier: this.databaseIdentifier(),
                name,
                tenant: this.tenant()
            }, async (operation) => await callback(operation.connection()));
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGlvbi1jb250ZXh0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2dlbmVyYXRpb24tY29udGV4dC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxNQUFNLE1BQU0sc0JBQXNCLENBQUE7QUFFekM7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8seUJBQXlCO0lBQzVDOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUMsYUFBYSxFQUFFLGtCQUFrQixFQUFDO1FBQ3RELE1BQU0scUJBQXFCLEdBQUcsYUFBYSxDQUFDLHdCQUF3QixFQUFFLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUUxRixJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxrQkFBa0IsRUFBRSxDQUFDLENBQUE7UUFDekYsQ0FBQztRQUNELElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUN0QyxNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixrQkFBa0IsMENBQTBDLENBQUMsQ0FBQTtRQUN0RyxDQUFDO1FBQ0QsSUFBSSxhQUFhLENBQUMsOEJBQThCLEVBQUUsQ0FBQyxHQUFHLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1lBQzNFLE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLGtCQUFrQix5REFBeUQsQ0FBQyxDQUFBO1FBQzVILENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMseUJBQXlCLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUU1RSxNQUFNLGFBQWEsQ0FBQyxVQUFVLENBQUMsRUFBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUMsQ0FBQyxDQUFBO1FBRTdELE1BQU0sT0FBTyxHQUFHLE1BQU0sYUFBYSxDQUFDLGlCQUFpQixDQUFDLEVBQUMs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LEVBQUU7WUFDdkUsT0FBTyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMscUJBQXFCLENBQUM7Z0JBQ3JELHFCQUFxQixFQUFFLElBQUksQ0FBQyxxQkFBcUIsRUFBRTtnQkFDbkQsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixFQUFFO2dCQUM3QyxJQUFJO2dCQUNKLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFO2FBQ3RCLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxFQUFFLENBQUMsTUFBTSxRQUFRLENBQUMsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUNqRSxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVGVuYW50IGZyb20gXCIuLi90ZW5hbnRzL3RlbmFudC5qc1wiXG5cbi8qKlxuICogSW1tdXRhYmxlIHNlbGVjdGlvbiBvZiBvbmUgbG9naWNhbCB0ZW5hbnQgZGF0YWJhc2UgYW5kIG9uZSBwcm92aWRlci1yZXNvbHZlZFxuICogcGh5c2ljYWwgdGVuYW50LiBTY2hlbWEgdG9vbHMgY2FuIHNoYXJlIHRoaXMgY29udHJhY3Qgd2l0aG91dCBhbWJpZW50IG9yXG4gKiBwcm9jZXNzLWdsb2JhbCBzZWxlY3Rpb24gc3RhdGUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIERhdGFiYXNlR2VuZXJhdGlvbkNvbnRleHQge1xuICAvKipcbiAgICogUmVzb2x2ZXMgb25lIHRlbmFudC1vbmx5IGRhdGFiYXNlIGZyb20gaXRzIHByb3ZpZGVyIGFuZCBjYXB0dXJlcyBpdHMgcGh5c2ljYWwgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VsZWN0aW9uIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBMb2dpY2FsIHRlbmFudC1vbmx5IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPERhdGFiYXNlR2VuZXJhdGlvbkNvbnRleHQ+fSAtIEltbXV0YWJsZSBzZWxlY3RlZCBkYXRhYmFzZSBjb250ZXh0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlc29sdmUoe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW2RhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgY29uZmlndXJlZDogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEYXRhYmFzZSBpZGVudGlmaWVyICR7ZGF0YWJhc2VJZGVudGlmaWVyfSBpcyBub3QgY29uZmlndXJlZCB3aXRoIHRlbmFudE9ubHk6IHRydWVgKVxuICAgIH1cbiAgICBpZiAoY29uZmlndXJhdGlvbi5nZXREaXNhYmxlZERhdGFiYXNlSWRlbnRpZmllcnMoKS5oYXMoZGF0YWJhc2VJZGVudGlmaWVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke2RhdGFiYXNlSWRlbnRpZmllcn0gaXMgZGlzYWJsZWQgYnkgVkVMT0NJT1VTX0RJU0FCTEVEX0RBVEFCQVNFX0lERU5USUZJRVJTYClcbiAgICB9XG5cbiAgICBjb25zdCBwcm92aWRlciA9IGNvbmZpZ3VyYXRpb24uZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcihkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgICBhd2FpdCBjb25maWd1cmF0aW9uLmluaXRpYWxpemUoe3R5cGU6IFwiZGF0YWJhc2UtZ2VuZXJhdGlvblwifSlcblxuICAgIGNvbnN0IHRlbmFudHMgPSBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgUmVzb2x2ZSBkYXRhYmFzZSBnZW5lcmF0aW9uIGNvbnRleHQ6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAocHJvdmlkZXIucmVzb2x2ZUdlbmVyYXRpb25UZW5hbnQpIHtcbiAgICAgICAgY29uc3QgdGVuYW50ID0gYXdhaXQgcHJvdmlkZXIucmVzb2x2ZUdlbmVyYXRpb25UZW5hbnQoe2NvbmZpZ3VyYXRpb24sIGlkZW50aWZpZXI6IGRhdGFiYXNlSWRlbnRpZmllcn0pXG5cbiAgICAgICAgcmV0dXJuIHRlbmFudCA9PT0gdW5kZWZpbmVkID8gW10gOiBbdGVuYW50XVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgcHJvdmlkZXIubGlzdFRlbmFudHMoe2NvbmZpZ3VyYXRpb24sIGlkZW50aWZpZXI6IGRhdGFiYXNlSWRlbnRpZmllcn0pXG4gICAgfSlcblxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0ZW5hbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgZm9yICR7ZGF0YWJhc2VJZGVudGlmaWVyfSBtdXN0IHJldHVybiBhbiBhcnJheSBmcm9tIGxpc3RUZW5hbnRzYClcbiAgICB9XG4gICAgaWYgKHRlbmFudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBzZWxlY3Rpb24gJHtkYXRhYmFzZUlkZW50aWZpZXJ9IHJlc29sdmVkIG5vIHRlbmFudHNgKVxuICAgIH1cbiAgICBpZiAodGVuYW50cy5sZW5ndGggIT09IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIHNlbGVjdGlvbiAke2RhdGFiYXNlSWRlbnRpZmllcn0gaXMgYW1iaWd1b3VzOiBwcm92aWRlciByZXR1cm5lZCAke3RlbmFudHMubGVuZ3RofSB0ZW5hbnRzYClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnQgPSB0ZW5hbnRzWzBdXG5cbiAgICBpZiAoIXRlbmFudCB8fCB0eXBlb2YgdGVuYW50ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodGVuYW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2Ugc2VsZWN0aW9uICR7ZGF0YWJhc2VJZGVudGlmaWVyfSByZXR1cm5lZCBhbiBpbnZhbGlkIHRlbmFudCBkZXNjcmlwdG9yYClcbiAgICB9XG5cbiAgICBjb25zdCBoYW5kbGUgPSBUZW5hbnQuaGFuZGxlKHRlbmFudCwgY29uZmlndXJhdGlvbilcblxuICAgIC8vIFJlc29sdmUgbm93IHNvIGFuIGluYWN0aXZlL3N0YWxlIGRlc2NyaXB0b3IgZmFpbHMgYmVmb3JlIGEgc2VsZWN0ZWRcbiAgICAvLyBzY2hlbWEgY29ubmVjdGlvbiBjYW4gYmUgY2hlY2tlZCBvdXQgb3IgcmVhZC5cbiAgICBoYW5kbGUuZGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIHJldHVybiBuZXcgRGF0YWJhc2VHZW5lcmF0aW9uQ29udGV4dCh7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBoYW5kbGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ2FwdHVyZWQgc2VsZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gT3duaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlSWRlbnRpZmllciAtIExvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBUZW5hbnQuaGFuZGxlPn0gYXJncy5oYW5kbGUgLSBDYXB0dXJlZCB0ZW5hbnQgaGFuZGxlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgaGFuZGxlfSkge1xuICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5faGFuZGxlID0gaGFuZGxlXG5cbiAgICBPYmplY3QuZnJlZXplKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY2FwdHVyZWQgbG9naWNhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENhcHR1cmVkIGxvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGRhdGFiYXNlSWRlbnRpZmllcigpIHsgcmV0dXJuIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNhcHR1cmVkIHBoeXNpY2FsIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gQ2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGRhdGFiYXNlQ29uZmlndXJhdGlvbigpIHsgcmV0dXJuIHRoaXMuX2hhbmRsZS5kYXRhYmFzZUNvbmZpZ3VyYXRpb24odGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNhcHR1cmVkIHRlbmFudCBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxSZXR1cm5UeXBlPHR5cGVvZiBUZW5hbnQuaGFuZGxlPltcInRlbmFudFwiXT59IC0gQ2FwdHVyZWQgaW1tdXRhYmxlIHRlbmFudCBkZXNjcmlwdG9yLlxuICAgKi9cbiAgdGVuYW50KCkgeyByZXR1cm4gdGhpcy5faGFuZGxlLnRlbmFudCgpIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIG9uIG9uZSBjb25uZWN0aW9uIHBpbm5lZCB0byB0aGUgY2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV29yayBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGFyZ3MuY2FsbGJhY2sgLSBTZWxlY3RlZCBkYXRhYmFzZSB3b3JrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQ2hlY2tvdXQgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuKHtjYWxsYmFjaywgbmFtZX0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRoaXMudGVuYW50KCksIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9jb25maWd1cmF0aW9uLndpdGhEYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbjogdGhpcy5kYXRhYmFzZUNvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcigpLFxuICAgICAgICBuYW1lLFxuICAgICAgICB0ZW5hbnQ6IHRoaXMudGVuYW50KClcbiAgICAgIH0sIGFzeW5jIChvcGVyYXRpb24pID0+IGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbi5jb25uZWN0aW9uKCkpKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==