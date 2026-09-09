// @ts-check
/**
 * Runs a callback once within each tenant's context for a tenant database identifier,
 * optionally several tenants at a time. Each tenant is entered with `runWithTenant`, and a
 * tenant whose database identifier is inactive throws rather than running the callback
 * against the wrong connection. When iterating in parallel the per-tenant failures are
 * collected and rethrown together as an `AggregateError` so one bad tenant does not hide the
 * others. This is the iteration engine shared by the `db:tenants:*` CLI commands and the
 * runtime tenant façade; the caller is responsible for producing the tenant list.
 */
export default class TenantIterator {
    /**
     * Creates an iterator bound to a configuration and tenant database identifier.
     * @param {{configuration: import("../configuration.js").default, identifier: string, parallelCount?: number}} args - Tenant configuration, database identifier, and concurrency limit.
     */
    constructor({ configuration, identifier, parallelCount = 1 }) {
        this.configuration = configuration;
        this.identifier = identifier;
        this.parallelCount = parallelCount;
    }
    /**
     * Runs `callback` within each tenant's context and returns how many tenants were processed.
     * @param {Array<ReturnType<typeof JSON.parse>>} tenants - Tenant descriptors to enter and process.
     * @param {(args: {databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ReturnType<typeof JSON.parse>}) => Promise<void>} callback - Per-tenant operation receiving the active database configuration.
     * @returns {Promise<number>} - Number of processed tenants.
     */
    async run(tenants, callback) {
        if (this.parallelCount <= 1) {
            for (const tenant of tenants) {
                await this.runTenantCallback({ callback, tenant });
            }
            return tenants.length;
        }
        /** @type {Array<{error: Error, tenant: ReturnType<typeof JSON.parse>}>} */
        const failures = [];
        const workers = [];
        let tenantIndex = 0;
        const workerCount = Math.min(this.parallelCount, tenants.length);
        for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
            workers.push((async () => {
                while (tenantIndex < tenants.length) {
                    const tenant = tenants[tenantIndex];
                    tenantIndex++;
                    try {
                        await this.runTenantCallback({ callback, tenant });
                    }
                    catch (error) {
                        failures.push({
                            error: error instanceof Error ? error : new Error(String(error)),
                            tenant
                        });
                    }
                }
            })());
        }
        await Promise.all(workers);
        if (failures.length > 0) {
            const failedTenantLabels = failures.map((failure) => TenantIterator.tenantLabel(failure.tenant)).join(", ");
            throw new AggregateError(failures.map((failure) => failure.error), `Failed tenant database command for tenant(s): ${failedTenantLabels}`);
        }
        return tenants.length;
    }
    /**
     * Enters one tenant's context and runs the callback, asserting the database is active first.
     * @param {{callback: (args: {databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ReturnType<typeof JSON.parse>}) => Promise<void>, tenant: ReturnType<typeof JSON.parse>}} args - Tenant descriptor and operation to run in its context.
     * @returns {Promise<void>}
     */
    async runTenantCallback({ callback, tenant }) {
        await this.configuration.runWithTenant(tenant, async () => {
            if (!this.configuration.isDatabaseIdentifierActive(this.identifier)) {
                throw new Error(`Tenant database identifier ${this.identifier} is inactive for tenant: ${TenantIterator.tenantLabel(tenant)}`);
            }
            await callback({
                databaseConfiguration: this.configuration.resolveDatabaseConfiguration(this.identifier),
                tenant
            });
        });
    }
    /**
     * Builds a human-readable label for a tenant for use in error messages.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant descriptor to identify in an error.
     * @returns {string} - Human-readable tenant label.
     */
    static tenantLabel(tenant) {
        if (tenant && typeof tenant === "object") {
            const tenantObject = /** @type {{id?: ReturnType<typeof JSON.parse>, name?: ReturnType<typeof JSON.parse>, slug?: ReturnType<typeof JSON.parse>}} */ (tenant);
            for (const attributeName of /** @type {Array<"slug" | "name" | "id">} */ (["slug", "name", "id"])) {
                const attributeOrAccessor = tenantObject[attributeName];
                const attributeValue = typeof attributeOrAccessor === "function"
                    ? attributeOrAccessor.call(tenant)
                    : attributeOrAccessor;
                if (attributeValue)
                    return String(attributeValue);
            }
        }
        return JSON.stringify(tenant);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuYW50LWl0ZXJhdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3RlbmFudHMvdGVuYW50LWl0ZXJhdG9yLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sY0FBYztJQUNqQzs7O09BR0c7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRSxhQUFhLEdBQUcsQ0FBQyxFQUFDO1FBQ3hELElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLFFBQVE7UUFDekIsSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQzVCLEtBQUssTUFBTSxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQzdCLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsUUFBUSxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7WUFDbEQsQ0FBQztZQUVELE9BQU8sT0FBTyxDQUFDLE1BQU0sQ0FBQTtRQUN2QixDQUFDO1FBRUQsMkVBQTJFO1FBQzNFLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQTtRQUNuQixNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUE7UUFDbEIsSUFBSSxXQUFXLEdBQUcsQ0FBQyxDQUFBO1FBQ25CLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFaEUsS0FBSyxJQUFJLFdBQVcsR0FBRyxDQUFDLEVBQUUsV0FBVyxHQUFHLFdBQVcsRUFBRSxXQUFXLEVBQUUsRUFB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Q0FBQTtnQkFFdkIsSUFBSSxjQUFjO29CQUFFLE9BQU8sTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQ25ELENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQy9CLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFJ1bnMgYSBjYWxsYmFjayBvbmNlIHdpdGhpbiBlYWNoIHRlbmFudCdzIGNvbnRleHQgZm9yIGEgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIsXG4gKiBvcHRpb25hbGx5IHNldmVyYWwgdGVuYW50cyBhdCBhIHRpbWUuIEVhY2ggdGVuYW50IGlzIGVudGVyZWQgd2l0aCBgcnVuV2l0aFRlbmFudGAsIGFuZCBhXG4gKiB0ZW5hbnQgd2hvc2UgZGF0YWJhc2UgaWRlbnRpZmllciBpcyBpbmFjdGl2ZSB0aHJvd3MgcmF0aGVyIHRoYW4gcnVubmluZyB0aGUgY2FsbGJhY2tcbiAqIGFnYWluc3QgdGhlIHdyb25nIGNvbm5lY3Rpb24uIFdoZW4gaXRlcmF0aW5nIGluIHBhcmFsbGVsIHRoZSBwZXItdGVuYW50IGZhaWx1cmVzIGFyZVxuICogY29sbGVjdGVkIGFuZCByZXRocm93biB0b2dldGhlciBhcyBhbiBgQWdncmVnYXRlRXJyb3JgIHNvIG9uZSBiYWQgdGVuYW50IGRvZXMgbm90IGhpZGUgdGhlXG4gKiBvdGhlcnMuIFRoaXMgaXMgdGhlIGl0ZXJhdGlvbiBlbmdpbmUgc2hhcmVkIGJ5IHRoZSBgZGI6dGVuYW50czoqYCBDTEkgY29tbWFuZHMgYW5kIHRoZVxuICogcnVudGltZSB0ZW5hbnQgZmHDp2FkZTsgdGhlIGNhbGxlciBpcyByZXNwb25zaWJsZSBmb3IgcHJvZHVjaW5nIHRoZSB0ZW5hbnQgbGlzdC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVuYW50SXRlcmF0b3Ige1xuICAvKipcbiAgICogQ3JlYXRlcyBhbiBpdGVyYXRvciBib3VuZCB0byBhIGNvbmZpZ3VyYXRpb24gYW5kIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIGlkZW50aWZpZXI6IHN0cmluZywgcGFyYWxsZWxDb3VudD86IG51bWJlcn19IGFyZ3MgLSBUZW5hbnQgY29uZmlndXJhdGlvbiwgZGF0YWJhc2UgaWRlbnRpZmllciwgYW5kIGNvbmN1cnJlbmN5IGxpbWl0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGlkZW50aWZpZXIsIHBhcmFsbGVsQ291bnQgPSAxfSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmlkZW50aWZpZXIgPSBpZGVudGlmaWVyXG4gICAgdGhpcy5wYXJhbGxlbENvdW50ID0gcGFyYWxsZWxDb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYGNhbGxiYWNrYCB3aXRoaW4gZWFjaCB0ZW5hbnQncyBjb250ZXh0IGFuZCByZXR1cm5zIGhvdyBtYW55IHRlbmFudHMgd2VyZSBwcm9jZXNzZWQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB0ZW5hbnRzIC0gVGVuYW50IGRlc2NyaXB0b3JzIHRvIGVudGVyIGFuZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7ZGF0YWJhc2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGUsIHRlbmFudDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59KSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIFBlci10ZW5hbnQgb3BlcmF0aW9uIHJlY2VpdmluZyB0aGUgYWN0aXZlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIHByb2Nlc3NlZCB0ZW5hbnRzLlxuICAgKi9cbiAgYXN5bmMgcnVuKHRlbmFudHMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHRoaXMucGFyYWxsZWxDb3VudCA8PSAxKSB7XG4gICAgICBmb3IgKGNvbnN0IHRlbmFudCBvZiB0ZW5hbnRzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuVGVuYW50Q2FsbGJhY2soe2NhbGxiYWNrLCB0ZW5hbnR9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGVuYW50cy5sZW5ndGhcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge0FycmF5PHtlcnJvcjogRXJyb3IsIHRlbmFudDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdXG4gICAgY29uc3Qgd29ya2VycyA9IFtdXG4gICAgbGV0IHRlbmFudEluZGV4ID0gMFxuICAgIGNvbnN0IHdvcmtlckNvdW50ID0gTWF0aC5taW4odGhpcy5wYXJhbGxlbENvdW50LCB0ZW5hbnRzLmxlbmd0aClcblxuICAgIGZvciAobGV0IHdvcmtlckluZGV4ID0gMDsgd29ya2VySW5kZXggPCB3b3JrZXJDb3VudDsgd29ya2VySW5kZXgrKykge1xuICAgICAgd29ya2Vycy5wdXNoKChhc3luYyAoKSA9PiB7XG4gICAgICAgIHdoaWxlICh0ZW5hbnRJbmRleCA8IHRlbmFudHMubGVuZ3RoKSB7XG4gICAgICAgICAgY29uc3QgdGVuYW50ID0gdGVuYW50c1t0ZW5hbnRJbmRleF1cblxuICAgICAgICAgIHRlbmFudEluZGV4KytcblxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJ1blRlbmFudENhbGxiYWNrKHtjYWxsYmFjaywgdGVuYW50fSlcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgZmFpbHVyZXMucHVzaCh7XG4gICAgICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSksXG4gICAgICAgICAgICAgIHRlbmFudFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pKCkpXG4gICAgfVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwod29ya2VycylcblxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBmYWlsZWRUZW5hbnRMYWJlbHMgPSBmYWlsdXJlcy5tYXAoKGZhaWx1cmUpID0+IFRlbmFudEl0ZXJhdG9yLnRlbmFudExhYmVsKGZhaWx1cmUudGVuYW50KSkuam9pbihcIiwgXCIpXG5cbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgZmFpbHVyZXMubWFwKChmYWlsdXJlKSA9PiBmYWlsdXJlLmVycm9yKSxcbiAgICAgICAgYEZhaWxlZCB0ZW5hbnQgZGF0YWJhc2UgY29tbWFuZCBmb3IgdGVuYW50KHMpOiAke2ZhaWxlZFRlbmFudExhYmVsc31gXG4gICAgICApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRlbmFudHMubGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogRW50ZXJzIG9uZSB0ZW5hbnQncyBjb250ZXh0IGFuZCBydW5zIHRoZSBjYWxsYmFjaywgYXNzZXJ0aW5nIHRoZSBkYXRhYmFzZSBpcyBhY3RpdmUgZmlyc3QuXG4gICAqIEBwYXJhbSB7e2NhbGxiYWNrOiAoYXJnczoge2RhdGFiYXNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCB0ZW5hbnQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgPT4gUHJvbWlzZTx2b2lkPiwgdGVuYW50OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBUZW5hbnQgZGVzY3JpcHRvciBhbmQgb3BlcmF0aW9uIHRvIHJ1biBpbiBpdHMgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBydW5UZW5hbnRDYWxsYmFjayh7Y2FsbGJhY2ssIHRlbmFudH0pIHtcbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKHRoaXMuaWRlbnRpZmllcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke3RoaXMuaWRlbnRpZmllcn0gaXMgaW5hY3RpdmUgZm9yIHRlbmFudDogJHtUZW5hbnRJdGVyYXRvci50ZW5hbnRMYWJlbCh0ZW5hbnQpfWApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGNhbGxiYWNrKHtcbiAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbih0aGlzLmlkZW50aWZpZXIpLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBodW1hbi1yZWFkYWJsZSBsYWJlbCBmb3IgYSB0ZW5hbnQgZm9yIHVzZSBpbiBlcnJvciBtZXNzYWdlcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50IGRlc2NyaXB0b3IgdG8gaWRlbnRpZnkgaW4gYW4gZXJyb3IuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSHVtYW4tcmVhZGFibGUgdGVuYW50IGxhYmVsLlxuICAgKi9cbiAgc3RhdGljIHRlbmFudExhYmVsKHRlbmFudCkge1xuICAgIGlmICh0ZW5hbnQgJiYgdHlwZW9mIHRlbmFudCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgY29uc3QgdGVuYW50T2JqZWN0ID0gLyoqIEB0eXBlIHt7aWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbmFtZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzbHVnPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAodGVuYW50KVxuXG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgLyoqIEB0eXBlIHtBcnJheTxcInNsdWdcIiB8IFwibmFtZVwiIHwgXCJpZFwiPn0gKi8gKFtcInNsdWdcIiwgXCJuYW1lXCIsIFwiaWRcIl0pKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU9yQWNjZXNzb3IgPSB0ZW5hbnRPYmplY3RbYXR0cmlidXRlTmFtZV1cbiAgICAgICAgY29uc3QgYXR0cmlidXRlVmFsdWUgPSB0eXBlb2YgYXR0cmlidXRlT3JBY2Nlc3NvciA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBhdHRyaWJ1dGVPckFjY2Vzc29yLmNhbGwodGVuYW50KVxuICAgICAgICAgIDogYXR0cmlidXRlT3JBY2Nlc3NvclxuXG4gICAgICAgIGlmIChhdHRyaWJ1dGVWYWx1ZSkgcmV0dXJuIFN0cmluZyhhdHRyaWJ1dGVWYWx1ZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodGVuYW50KVxuICB9XG59XG4iXX0=