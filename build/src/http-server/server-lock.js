// @ts-check
import AdvisoryLockFileBackend from "../database/advisory-lock-file-backend.js";
import path from "node:path";
/**
 * Directory-based lock that allows only one HTTP server process per app
 * directory. Thin wrapper over the shared file-lock backend
 * (`src/database/advisory-lock-file-backend.js` — the STC-210 `file` tier
 * primitive generalized from this lock's original hand-rolled directory
 * protocol), so the server lock and the advisory-lock file tier share one
 * acquisition, owner-metadata, lease-renewal, and staleness implementation.
 */
export default class VelociousHttpServerLock {
    /**
     * Build a lock for the configured application directory and server endpoint.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration that owns the application directory.
     * @param {string} args.host - Configured HTTP host.
     * @param {number} args.port - Configured HTTP port.
     */
    constructor({ configuration, host, port }) {
        this.configuration = configuration;
        this.host = host;
        this.port = port;
        this.lockPath = path.join(configuration.getDirectory(), "tmp", "server.lock");
        this.backend = new AdvisoryLockFileBackend({
            directory: path.join(configuration.getDirectory(), "tmp"),
            extraOwnerFields: { host: this.host, port: this.port },
            pathStyle: "plain"
        });
        this.acquired = false;
    }
    /**
     * Acquires the app-directory HTTP server lock before startup side effects
     * run. A stale lock (dead local owner or expired lease) is reclaimed by the
     * backend; a live foreign owner fails loudly with the owner details.
     * @returns {Promise<void>} - Resolves after the lock has been acquired.
     */
    async acquire() {
        const acquired = await this.backend.acquire("server", { timeoutMs: 0 });
        if (!acquired)
            throw new Error(await this.lockHeldMessage());
        this.acquired = true;
    }
    /**
     * Releases the held HTTP server lock directory.
     * @returns {Promise<void>} - Resolves after best-effort lock release.
     */
    async release() {
        if (!this.acquired)
            return;
        this.acquired = false;
        await this.backend.release("server");
    }
    /**
     * Reads owner metadata from an existing server lock directory.
     * @returns {Promise<import("../database/advisory-lock-file-backend.js").AdvisoryLockFileOwner | null>} - Parsed owner metadata, when readable.
     */
    async readOwnerMetadata() {
        return await this.backend.holderInfo("server");
    }
    /**
     * Builds a duplicate-server error message with owner details when available.
     * @returns {Promise<string>} - Error message explaining which server owns the lock.
     */
    async lockHeldMessage() {
        const owner = await this.readOwnerMetadata();
        const details = owner
            ? `PID ${String(owner.pid)} on ${String(owner.hostname)} (${String(owner.host)}:${String(owner.port)})`
            : `lock directory ${this.lockPath}`;
        return `A Velocious HTTP server is already running for this application (${details}). Remove ${this.lockPath} if the server is no longer running.`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLWxvY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvc2VydmVyLWxvY2suanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sdUJBQXVCLE1BQU0sMkNBQTJDLENBQUE7QUFDL0UsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBRTVCOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHVCQUF1QjtJQUMxQzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUM7UUFDckMsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsRUFBRSxLQUFLLEVBQUUsYUFBYSxDQUFDLENBQUE7UUFDN0UsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLHVCQUF1QixDQUFDO1lBQ3pDLFNBQVMsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsRUFBRSxLQUFLLENBQUM7WUFDekQsZ0JBQWdCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBQztZQUNwRCxTQUFTLEVBQUUsT0FBTztTQUNuQixDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtJQUN2QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEVBQUMsU0FBUyxFQUFFLENBQUMsRUFBQyxDQUFDLENBQUE7UUFFckUsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLENBQUE7UUFFNUQsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRO1lBQUUsT0FBTTtRQUUxQixJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUNyQixNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQ3RDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsaUJBQWlCO1FBQ3JCLE9BQU8sTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUNoRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGVBQWU7UUFDbkIsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUM1QyxNQUFNLE9BQU8sR0FBRyxLQUFLO1lBQ25CLENBQUMsQ0FBQyxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBSyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUc7WUFDdkcsQ0FBQyxDQUFDLGtCQUFrQixJQUFJLENBQUMsUUFBUSxFQUFFLENBQUE7UUFFckMsT0FBTyxvRUFBb0UsT0FBTyxhQUFhLElBQUksQ0FBQyxRQUFRLHNDQUFzQyxDQUFBO0lBQ3BKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQgZnJvbSBcIi4uL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stZmlsZS1iYWNrZW5kLmpzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuXG4vKipcbiAqIERpcmVjdG9yeS1iYXNlZCBsb2NrIHRoYXQgYWxsb3dzIG9ubHkgb25lIEhUVFAgc2VydmVyIHByb2Nlc3MgcGVyIGFwcFxuICogZGlyZWN0b3J5LiBUaGluIHdyYXBwZXIgb3ZlciB0aGUgc2hhcmVkIGZpbGUtbG9jayBiYWNrZW5kXG4gKiAoYHNyYy9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc2Ag4oCUIHRoZSBTVEMtMjEwIGBmaWxlYCB0aWVyXG4gKiBwcmltaXRpdmUgZ2VuZXJhbGl6ZWQgZnJvbSB0aGlzIGxvY2sncyBvcmlnaW5hbCBoYW5kLXJvbGxlZCBkaXJlY3RvcnlcbiAqIHByb3RvY29sKSwgc28gdGhlIHNlcnZlciBsb2NrIGFuZCB0aGUgYWR2aXNvcnktbG9jayBmaWxlIHRpZXIgc2hhcmUgb25lXG4gKiBhY3F1aXNpdGlvbiwgb3duZXItbWV0YWRhdGEsIGxlYXNlLXJlbmV3YWwsIGFuZCBzdGFsZW5lc3MgaW1wbGVtZW50YXRpb24uXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0h0dHBTZXJ2ZXJMb2NrIHtcbiAgLyoqXG4gICAqIEJ1aWxkIGEgbG9jayBmb3IgdGhlIGNvbmZpZ3VyZWQgYXBwbGljYXRpb24gZGlyZWN0b3J5IGFuZCBzZXJ2ZXIgZW5kcG9pbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIHRoYXQgb3ducyB0aGUgYXBwbGljYXRpb24gZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5ob3N0IC0gQ29uZmlndXJlZCBIVFRQIGhvc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnBvcnQgLSBDb25maWd1cmVkIEhUVFAgcG9ydC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBob3N0LCBwb3J0fSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMubG9ja1BhdGggPSBwYXRoLmpvaW4oY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgXCJ0bXBcIiwgXCJzZXJ2ZXIubG9ja1wiKVxuICAgIHRoaXMuYmFja2VuZCA9IG5ldyBBZHZpc29yeUxvY2tGaWxlQmFja2VuZCh7XG4gICAgICBkaXJlY3Rvcnk6IHBhdGguam9pbihjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpLCBcInRtcFwiKSxcbiAgICAgIGV4dHJhT3duZXJGaWVsZHM6IHtob3N0OiB0aGlzLmhvc3QsIHBvcnQ6IHRoaXMucG9ydH0sXG4gICAgICBwYXRoU3R5bGU6IFwicGxhaW5cIlxuICAgIH0pXG4gICAgdGhpcy5hY3F1aXJlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQWNxdWlyZXMgdGhlIGFwcC1kaXJlY3RvcnkgSFRUUCBzZXJ2ZXIgbG9jayBiZWZvcmUgc3RhcnR1cCBzaWRlIGVmZmVjdHNcbiAgICogcnVuLiBBIHN0YWxlIGxvY2sgKGRlYWQgbG9jYWwgb3duZXIgb3IgZXhwaXJlZCBsZWFzZSkgaXMgcmVjbGFpbWVkIGJ5IHRoZVxuICAgKiBiYWNrZW5kOyBhIGxpdmUgZm9yZWlnbiBvd25lciBmYWlscyBsb3VkbHkgd2l0aCB0aGUgb3duZXIgZGV0YWlscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGxvY2sgaGFzIGJlZW4gYWNxdWlyZWQuXG4gICAqL1xuICBhc3luYyBhY3F1aXJlKCkge1xuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgdGhpcy5iYWNrZW5kLmFjcXVpcmUoXCJzZXJ2ZXJcIiwge3RpbWVvdXRNczogMH0pXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoYXdhaXQgdGhpcy5sb2NrSGVsZE1lc3NhZ2UoKSlcblxuICAgIHRoaXMuYWNxdWlyZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdGhlIGhlbGQgSFRUUCBzZXJ2ZXIgbG9jayBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGJlc3QtZWZmb3J0IGxvY2sgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIHJlbGVhc2UoKSB7XG4gICAgaWYgKCF0aGlzLmFjcXVpcmVkKSByZXR1cm5cblxuICAgIHRoaXMuYWNxdWlyZWQgPSBmYWxzZVxuICAgIGF3YWl0IHRoaXMuYmFja2VuZC5yZWxlYXNlKFwic2VydmVyXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgb3duZXIgbWV0YWRhdGEgZnJvbSBhbiBleGlzdGluZyBzZXJ2ZXIgbG9jayBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stZmlsZS1iYWNrZW5kLmpzXCIpLkFkdmlzb3J5TG9ja0ZpbGVPd25lciB8IG51bGw+fSAtIFBhcnNlZCBvd25lciBtZXRhZGF0YSwgd2hlbiByZWFkYWJsZS5cbiAgICovXG4gIGFzeW5jIHJlYWRPd25lck1ldGFkYXRhKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmJhY2tlbmQuaG9sZGVySW5mbyhcInNlcnZlclwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGR1cGxpY2F0ZS1zZXJ2ZXIgZXJyb3IgbWVzc2FnZSB3aXRoIG93bmVyIGRldGFpbHMgd2hlbiBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gRXJyb3IgbWVzc2FnZSBleHBsYWluaW5nIHdoaWNoIHNlcnZlciBvd25zIHRoZSBsb2NrLlxuICAgKi9cbiAgYXN5bmMgbG9ja0hlbGRNZXNzYWdlKCkge1xuICAgIGNvbnN0IG93bmVyID0gYXdhaXQgdGhpcy5yZWFkT3duZXJNZXRhZGF0YSgpXG4gICAgY29uc3QgZGV0YWlscyA9IG93bmVyXG4gICAgICA/IGBQSUQgJHtTdHJpbmcob3duZXIucGlkKX0gb24gJHtTdHJpbmcob3duZXIuaG9zdG5hbWUpfSAoJHtTdHJpbmcob3duZXIuaG9zdCl9OiR7U3RyaW5nKG93bmVyLnBvcnQpfSlgXG4gICAgICA6IGBsb2NrIGRpcmVjdG9yeSAke3RoaXMubG9ja1BhdGh9YFxuXG4gICAgcmV0dXJuIGBBIFZlbG9jaW91cyBIVFRQIHNlcnZlciBpcyBhbHJlYWR5IHJ1bm5pbmcgZm9yIHRoaXMgYXBwbGljYXRpb24gKCR7ZGV0YWlsc30pLiBSZW1vdmUgJHt0aGlzLmxvY2tQYXRofSBpZiB0aGUgc2VydmVyIGlzIG5vIGxvbmdlciBydW5uaW5nLmBcbiAgfVxufVxuIl19