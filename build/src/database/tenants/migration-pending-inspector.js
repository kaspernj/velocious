// @ts-check
import MigrationsLedger from "../migrations-ledger.js";
import TenantIterator from "../../tenants/tenant-iterator.js";
import restArgsError from "../../utils/rest-args-error.js";
export default class TenantMigrationPendingInspector {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.identifier - Tenant database identifier.
     * @param {number[]} args.migrationVersions - Applicable migration versions.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.tenants - Existing tenant descriptors.
     */
    constructor({ configuration, identifier, migrationVersions, tenants, ...restArgs }) {
        restArgsError(restArgs);
        this.configuration = configuration;
        this.identifier = identifier;
        this.migrationVersions = migrationVersions.map((version) => `${version}`);
        this.tenants = tenants;
    }
    /**
     * Reads every existing tenant ledger and reports aggregate pending state.
     * @returns {Promise<{hasPendingMigrations: boolean, identifier: string, migrationCount: number, pendingTenantCount: number, tenantCount: number}>} - Deploy preflight result.
     */
    async inspect() {
        let pendingTenantCount = 0;
        for (const tenant of this.tenants) {
            if (await this.tenantHasPendingMigrations(tenant))
                pendingTenantCount++;
        }
        return {
            hasPendingMigrations: pendingTenantCount > 0,
            identifier: this.identifier,
            migrationCount: this.migrationVersions.length,
            pendingTenantCount,
            tenantCount: this.tenants.length
        };
    }
    /**
     * Reads one tenant's existing migration ledger without preparing or changing it.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant descriptor.
     * @returns {Promise<boolean>} - Whether the tenant has an applicable pending migration.
     */
    async tenantHasPendingMigrations(tenant) {
        return await this.configuration.runWithTenant(tenant, async () => {
            const tenantLabel = TenantIterator.tenantLabel(tenant);
            if (!this.configuration.isDatabaseIdentifierActive(this.identifier)) {
                throw new Error(`Tenant database identifier ${this.identifier} is inactive for tenant: ${tenantLabel}`);
            }
            try {
                return await this.configuration.ensureConnections({
                    databaseIdentifiers: [this.identifier],
                    name: `Tenant migration pending preflight: ${this.identifier}`
                }, async (dbs) => {
                    const db = dbs[this.identifier];
                    if (!db)
                        throw new Error(`Tenant database identifier ${this.identifier} did not open a connection`);
                    if (!await MigrationsLedger.tableExists(db))
                        throw new Error(`${MigrationsLedger.tableName()} ledger does not exist`);
                    const appliedVersions = new Set(await MigrationsLedger.appliedVersions(db));
                    return this.migrationVersions.some((version) => !appliedVersions.has(version));
                });
            }
            catch (error) {
                throw new Error(`Could not read ${MigrationsLedger.tableName()} for tenant ${tenantLabel}`, { cause: error });
            }
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0aW9uLXBlbmRpbmctaW5zcGVjdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3RlbmFudHMvbWlncmF0aW9uLXBlbmRpbmctaW5zcGVjdG9yLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGdCQUFnQixNQUFNLHlCQUF5QixDQUFBO0FBQ3RELE9BQU8sY0FBYyxNQUFNLGtDQUFrQyxDQUFBO0FBQzdELE9BQU8sYUFBYSxNQUFNLGdDQUFnQyxDQUFBO0FBRTFELE1BQU0sQ0FBQyxPQUFPLE9BQU8sK0JBQStCO0lBQ2xEOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRSxpQkFBaUIsRUFBRSxPQUFPLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDOUUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLEdBQUcsT0FBTyxFQUFFLENBQUMsQ0FBQTtRQUN6RSxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtJQUN4QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxJQUFJLGtCQUFrQixHQUFHLENBQUMsQ0FBQTtRQUUxQixLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNsQyxJQUFJLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLE1BQU0sQ0FBQztnQkFBRSxrQkFBa0IsRUFBRSxDQUFBO1FBQ3pFLENBQUM7UUFFRCxPQUFPO1lBQ0wsb0JBQW9CLEVBQUUsa0JBQWtCLEdBQUcsQ0FBQztZQUM1QyxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDM0IsY0FBYyxFQUFFLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNO1lBQzdDLGtCQUFrQjtZQUNsQixXQUFXLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNO1NBQ2pDLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxNQUFNO1FBQ3JDLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDL0QsTUFBTSxXQUFXLEdBQUcsY0FBYyxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUV0RCxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQywwQkFBMEIsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDcEUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4QkFBOEIsSUFBSSxDQUFDLFVBQVUsNEJBQTRCLFdBQVcsRUFBRSxDQUFDLENBQUE7WUFDekcsQ0FBQztZQUVELElBQUksQ0FBQztnQkFDSCxPQUFPLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQztvQkFDaEQsbUJBQW1CLEVBQUUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDO29CQUN0QyxJQUFJLEVBQUUsdUNBQXVDLElBQUksQ0FBQyxVQUFVLEVBQUU7aUJBQy9ELEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRSxFQUFFO29CQUNmLE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7b0JBRS9CLElBQUksQ0FBQyxFQUFFO3dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLElBQUksQ0FBQyxVQUFVLDRCQUE0QixDQUFDLENBQUE7b0JBQ25HLElBQUksQ0FBQyxNQUFNLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7d0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLGdCQUFnQixDQUFDLFNBQVMsRUFBRSx3QkFBd0IsQ0FBQyxDQUFBO29CQUVySCxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxNQUFNLGdCQUFnQixDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFBO29CQUUzRSxPQUFPLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFBO2dCQUNoRixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsa0JBQWtCLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxlQUFlLFdBQVcsRUFBRSxFQUFFLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDN0csQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBNaWdyYXRpb25zTGVkZ2VyIGZyb20gXCIuLi9taWdyYXRpb25zLWxlZGdlci5qc1wiXG5pbXBvcnQgVGVuYW50SXRlcmF0b3IgZnJvbSBcIi4uLy4uL3RlbmFudHMvdGVuYW50LWl0ZXJhdG9yLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBUZW5hbnRNaWdyYXRpb25QZW5kaW5nSW5zcGVjdG9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZGVudGlmaWVyIC0gVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyW119IGFyZ3MubWlncmF0aW9uVmVyc2lvbnMgLSBBcHBsaWNhYmxlIG1pZ3JhdGlvbiB2ZXJzaW9ucy5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudGVuYW50cyAtIEV4aXN0aW5nIHRlbmFudCBkZXNjcmlwdG9ycy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBpZGVudGlmaWVyLCBtaWdyYXRpb25WZXJzaW9ucywgdGVuYW50cywgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmlkZW50aWZpZXIgPSBpZGVudGlmaWVyXG4gICAgdGhpcy5taWdyYXRpb25WZXJzaW9ucyA9IG1pZ3JhdGlvblZlcnNpb25zLm1hcCgodmVyc2lvbikgPT4gYCR7dmVyc2lvbn1gKVxuICAgIHRoaXMudGVuYW50cyA9IHRlbmFudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBldmVyeSBleGlzdGluZyB0ZW5hbnQgbGVkZ2VyIGFuZCByZXBvcnRzIGFnZ3JlZ2F0ZSBwZW5kaW5nIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7aGFzUGVuZGluZ01pZ3JhdGlvbnM6IGJvb2xlYW4sIGlkZW50aWZpZXI6IHN0cmluZywgbWlncmF0aW9uQ291bnQ6IG51bWJlciwgcGVuZGluZ1RlbmFudENvdW50OiBudW1iZXIsIHRlbmFudENvdW50OiBudW1iZXJ9Pn0gLSBEZXBsb3kgcHJlZmxpZ2h0IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGluc3BlY3QoKSB7XG4gICAgbGV0IHBlbmRpbmdUZW5hbnRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgdGVuYW50IG9mIHRoaXMudGVuYW50cykge1xuICAgICAgaWYgKGF3YWl0IHRoaXMudGVuYW50SGFzUGVuZGluZ01pZ3JhdGlvbnModGVuYW50KSkgcGVuZGluZ1RlbmFudENvdW50KytcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaGFzUGVuZGluZ01pZ3JhdGlvbnM6IHBlbmRpbmdUZW5hbnRDb3VudCA+IDAsXG4gICAgICBpZGVudGlmaWVyOiB0aGlzLmlkZW50aWZpZXIsXG4gICAgICBtaWdyYXRpb25Db3VudDogdGhpcy5taWdyYXRpb25WZXJzaW9ucy5sZW5ndGgsXG4gICAgICBwZW5kaW5nVGVuYW50Q291bnQsXG4gICAgICB0ZW5hbnRDb3VudDogdGhpcy50ZW5hbnRzLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBvbmUgdGVuYW50J3MgZXhpc3RpbmcgbWlncmF0aW9uIGxlZGdlciB3aXRob3V0IHByZXBhcmluZyBvciBjaGFuZ2luZyBpdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50IGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIHRlbmFudCBoYXMgYW4gYXBwbGljYWJsZSBwZW5kaW5nIG1pZ3JhdGlvbi5cbiAgICovXG4gIGFzeW5jIHRlbmFudEhhc1BlbmRpbmdNaWdyYXRpb25zKHRlbmFudCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHRlbmFudExhYmVsID0gVGVuYW50SXRlcmF0b3IudGVuYW50TGFiZWwodGVuYW50KVxuXG4gICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZSh0aGlzLmlkZW50aWZpZXIpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHt0aGlzLmlkZW50aWZpZXJ9IGlzIGluYWN0aXZlIGZvciB0ZW5hbnQ6ICR7dGVuYW50TGFiZWx9YClcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyczogW3RoaXMuaWRlbnRpZmllcl0sXG4gICAgICAgICAgbmFtZTogYFRlbmFudCBtaWdyYXRpb24gcGVuZGluZyBwcmVmbGlnaHQ6ICR7dGhpcy5pZGVudGlmaWVyfWBcbiAgICAgICAgfSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgICAgIGNvbnN0IGRiID0gZGJzW3RoaXMuaWRlbnRpZmllcl1cblxuICAgICAgICAgIGlmICghZGIpIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHt0aGlzLmlkZW50aWZpZXJ9IGRpZCBub3Qgb3BlbiBhIGNvbm5lY3Rpb25gKVxuICAgICAgICAgIGlmICghYXdhaXQgTWlncmF0aW9uc0xlZGdlci50YWJsZUV4aXN0cyhkYikpIHRocm93IG5ldyBFcnJvcihgJHtNaWdyYXRpb25zTGVkZ2VyLnRhYmxlTmFtZSgpfSBsZWRnZXIgZG9lcyBub3QgZXhpc3RgKVxuXG4gICAgICAgICAgY29uc3QgYXBwbGllZFZlcnNpb25zID0gbmV3IFNldChhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLmFwcGxpZWRWZXJzaW9ucyhkYikpXG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5taWdyYXRpb25WZXJzaW9ucy5zb21lKCh2ZXJzaW9uKSA9PiAhYXBwbGllZFZlcnNpb25zLmhhcyh2ZXJzaW9uKSlcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IHJlYWQgJHtNaWdyYXRpb25zTGVkZ2VyLnRhYmxlTmFtZSgpfSBmb3IgdGVuYW50ICR7dGVuYW50TGFiZWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIl19