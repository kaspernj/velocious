// @ts-check
export default class PooledRunnerBrokerIdentity {
    /**
     * Creates a pooled runner identity coordinator.
     * @param {{closeConnections: () => Promise<void>}} args - Connection cleanup hook.
     */
    constructor({ closeConnections }) {
        this.closeConnections = closeConnections;
        /** @type {string | undefined} */
        this.activeIdentity = undefined;
        /** @type {{identity: string, promise: Promise<void>} | undefined} */
        this.pending = undefined;
        this.activeUsers = 0;
    }
    /**
     * Gets the current prepared identity.
     * @returns {string | undefined} - Current prepared identity.
     */
    current() { return this.activeIdentity; }
    /**
     * Prepares one identity, sharing an in-flight same-identity rotation.
     * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
     * @param {boolean} [admissionReserved] - Whether the caller already reserved its active-user slot.
     * @returns {Promise<void>} - Resolves after stale connections close.
     */
    async prepare(config, admissionReserved = false) {
        const identity = JSON.stringify(config);
        if (this.pending) {
            if (this.pending.identity !== identity)
                throw new Error("Pooled runner cannot mix shared transaction broker capabilities concurrently");
            return await this.pending.promise;
        }
        if (this.activeIdentity === identity)
            return;
        const otherActiveUsers = this.activeUsers - (admissionReserved ? 1 : 0);
        if (otherActiveUsers > 0)
            throw new Error("Pooled runner cannot mix shared transaction broker capabilities concurrently");
        if (this.activeIdentity === undefined) {
            this.activeIdentity = identity;
            return;
        }
        const promise = this.rotate(identity);
        this.pending = { identity, promise };
        try {
            await promise;
        }
        finally {
            this.pending = undefined;
        }
    }
    /**
     * Runs work while preventing a different identity from replacing its connections.
     * @template T
     * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
     * @param {() => Promise<T>} callback - Job callback.
     * @returns {Promise<T>} - Job result.
     */
    async run(config, callback) {
        await this.admit(config);
        try {
            return await callback();
        }
        finally {
            this.activeUsers--;
        }
    }
    /**
     * Atomically prepares an attempt identity and reserves its active user. Without
     * this admission turn, another capability can rotate connections after `prepare`
     * resolves but before `run` increments `activeUsers`.
     * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
     * @returns {Promise<void>} - Resolves after admission is reserved.
     */
    async admit(config) {
        this.activeUsers++;
        try {
            await this.prepare(config, true);
        }
        catch (error) {
            this.activeUsers--;
            throw error;
        }
    }
    /**
     * Rotates retained connection state to an identity.
     * @param {string} identity - Target identity.
     * @returns {Promise<void>} - Resolves after rotation.
     */
    async rotate(identity) {
        await this.closeConnections();
        this.activeIdentity = identity;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9vbGVkLXJ1bm5lci1icm9rZXItaWRlbnRpdHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3Bvb2xlZC1ydW5uZXItYnJva2VyLWlkZW50aXR5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEwQjtJQUM3Qzs7O09BR0c7SUFDSCxZQUFZLEVBQUMsZ0JBQWdCLEVBQUM7UUFDNUIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLGlDQUFpQztRQUNqQyxJQUFJLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQTtRQUMvQixxRUFBcUU7UUFDckUsSUFBSSxDQUFDLE9BQU8sR0FBRyxTQUFTLENBQUE7UUFDeEIsSUFBSSxDQUFDLFdBQVcsR0FBRyxDQUFDLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILE9BQU8sS0FBSyxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUEsQ0FBQyxDQUFDO0lBRXhDOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsaUJBQWlCLEdBQUcsS0FBSztRQUM3QyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3ZDLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2pCLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEtBQUssUUFBUTtnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDhFQUE4RSxDQUFDLENBQUE7WUFDdkksT0FBTyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFBO1FBQ25DLENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUTtZQUFFLE9BQU07UUFDNUMsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsV0FBVyxHQUFHLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdkUsSUFBSSxnQkFBZ0IsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4RUFBOEUsQ0FBQyxDQUFBO1FBQ3pILElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUN0QyxJQUFJLENBQUMsY0FBYyxHQUFHLFFBQVEsQ0FBQTtZQUM5QixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDckMsSUFBSSxDQUFDLE9BQU8sR0FBRyxFQUFDLFFBQVEsRUFBRSxPQUFPLEVBQUMsQ0FBQTtRQUNsQyxJQUFJLENBQUM7WUFDSCxNQUFNLE9BQU8sQ0FBQTtRQUNmLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxPQUFPLEdBQUcsU0FBUyxDQUFBO1FBQzFCLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsUUFBUTtRQUN4QixNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDeEIsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLFFBQVEsRUFBRSxDQUFBO1FBQ3pCLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUNwQixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTTtRQUNoQixJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFDbEIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQTtRQUNsQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtZQUNsQixNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsUUFBUTtRQUNuQixNQUFNLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQzdCLElBQUksQ0FBQyxjQUFjLEdBQUcsUUFBUSxDQUFBO0lBQ2hDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBQb29sZWRSdW5uZXJCcm9rZXJJZGVudGl0eSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcG9vbGVkIHJ1bm5lciBpZGVudGl0eSBjb29yZGluYXRvci5cbiAgICogQHBhcmFtIHt7Y2xvc2VDb25uZWN0aW9uczogKCkgPT4gUHJvbWlzZTx2b2lkPn19IGFyZ3MgLSBDb25uZWN0aW9uIGNsZWFudXAgaG9vay5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjbG9zZUNvbm5lY3Rpb25zfSkge1xuICAgIHRoaXMuY2xvc2VDb25uZWN0aW9ucyA9IGNsb3NlQ29ubmVjdGlvbnNcbiAgICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmFjdGl2ZUlkZW50aXR5ID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHt7aWRlbnRpdHk6IHN0cmluZywgcHJvbWlzZTogUHJvbWlzZTx2b2lkPn0gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5wZW5kaW5nID0gdW5kZWZpbmVkXG4gICAgdGhpcy5hY3RpdmVVc2VycyA9IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IHByZXBhcmVkIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgcHJlcGFyZWQgaWRlbnRpdHkuXG4gICAqL1xuICBjdXJyZW50KCkgeyByZXR1cm4gdGhpcy5hY3RpdmVJZGVudGl0eSB9XG5cbiAgLyoqXG4gICAqIFByZXBhcmVzIG9uZSBpZGVudGl0eSwgc2hhcmluZyBhbiBpbi1mbGlnaHQgc2FtZS1pZGVudGl0eSByb3RhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IGNvbmZpZyAtIERpc3BhdGNoIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FkbWlzc2lvblJlc2VydmVkXSAtIFdoZXRoZXIgdGhlIGNhbGxlciBhbHJlYWR5IHJlc2VydmVkIGl0cyBhY3RpdmUtdXNlciBzbG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzdGFsZSBjb25uZWN0aW9ucyBjbG9zZS5cbiAgICovXG4gIGFzeW5jIHByZXBhcmUoY29uZmlnLCBhZG1pc3Npb25SZXNlcnZlZCA9IGZhbHNlKSB7XG4gICAgY29uc3QgaWRlbnRpdHkgPSBKU09OLnN0cmluZ2lmeShjb25maWcpXG4gICAgaWYgKHRoaXMucGVuZGluZykge1xuICAgICAgaWYgKHRoaXMucGVuZGluZy5pZGVudGl0eSAhPT0gaWRlbnRpdHkpIHRocm93IG5ldyBFcnJvcihcIlBvb2xlZCBydW5uZXIgY2Fubm90IG1peCBzaGFyZWQgdHJhbnNhY3Rpb24gYnJva2VyIGNhcGFiaWxpdGllcyBjb25jdXJyZW50bHlcIilcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnBlbmRpbmcucHJvbWlzZVxuICAgIH1cbiAgICBpZiAodGhpcy5hY3RpdmVJZGVudGl0eSA9PT0gaWRlbnRpdHkpIHJldHVyblxuICAgIGNvbnN0IG90aGVyQWN0aXZlVXNlcnMgPSB0aGlzLmFjdGl2ZVVzZXJzIC0gKGFkbWlzc2lvblJlc2VydmVkID8gMSA6IDApXG4gICAgaWYgKG90aGVyQWN0aXZlVXNlcnMgPiAwKSB0aHJvdyBuZXcgRXJyb3IoXCJQb29sZWQgcnVubmVyIGNhbm5vdCBtaXggc2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjYXBhYmlsaXRpZXMgY29uY3VycmVudGx5XCIpXG4gICAgaWYgKHRoaXMuYWN0aXZlSWRlbnRpdHkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5hY3RpdmVJZGVudGl0eSA9IGlkZW50aXR5XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5yb3RhdGUoaWRlbnRpdHkpXG4gICAgdGhpcy5wZW5kaW5nID0ge2lkZW50aXR5LCBwcm9taXNlfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMucGVuZGluZyA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgd2hpbGUgcHJldmVudGluZyBhIGRpZmZlcmVudCBpZGVudGl0eSBmcm9tIHJlcGxhY2luZyBpdHMgY29ubmVjdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfSBjb25maWcgLSBEaXNwYXRjaCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gSm9iIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBKb2IgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuKGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmFkbWl0KGNvbmZpZylcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5hY3RpdmVVc2Vycy0tXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcHJlcGFyZXMgYW4gYXR0ZW1wdCBpZGVudGl0eSBhbmQgcmVzZXJ2ZXMgaXRzIGFjdGl2ZSB1c2VyLiBXaXRob3V0XG4gICAqIHRoaXMgYWRtaXNzaW9uIHR1cm4sIGFub3RoZXIgY2FwYWJpbGl0eSBjYW4gcm90YXRlIGNvbm5lY3Rpb25zIGFmdGVyIGBwcmVwYXJlYFxuICAgKiByZXNvbHZlcyBidXQgYmVmb3JlIGBydW5gIGluY3JlbWVudHMgYGFjdGl2ZVVzZXJzYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IGNvbmZpZyAtIERpc3BhdGNoIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFkbWlzc2lvbiBpcyByZXNlcnZlZC5cbiAgICovXG4gIGFzeW5jIGFkbWl0KGNvbmZpZykge1xuICAgIHRoaXMuYWN0aXZlVXNlcnMrK1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnByZXBhcmUoY29uZmlnLCB0cnVlKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmFjdGl2ZVVzZXJzLS1cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJvdGF0ZXMgcmV0YWluZWQgY29ubmVjdGlvbiBzdGF0ZSB0byBhbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aXR5IC0gVGFyZ2V0IGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByb3RhdGlvbi5cbiAgICovXG4gIGFzeW5jIHJvdGF0ZShpZGVudGl0eSkge1xuICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9ucygpXG4gICAgdGhpcy5hY3RpdmVJZGVudGl0eSA9IGlkZW50aXR5XG4gIH1cbn1cbiJdfQ==