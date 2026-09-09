// @ts-check
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
/**
 * Directory-based lock that allows only one HTTP server process per app directory.
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
        this.acquired = false;
    }
    /**
     * Acquires the app-directory HTTP server lock before startup side effects run.
     * @returns {Promise<void>} - Resolves after the lock has been acquired.
     */
    async acquire() {
        await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
        while (true) {
            const acquired = await this.tryAcquire();
            if (acquired) {
                return;
            }
            if (await this.isStale()) {
                await fs.rm(this.lockPath, { recursive: true, force: true });
                continue;
            }
            throw new Error(await this.lockHeldMessage());
        }
    }
    /**
     * Tries to create the lock directory and write owner metadata.
     * @returns {Promise<boolean>} - Whether the lock was acquired.
     */
    async tryAcquire() {
        try {
            await fs.mkdir(this.lockPath);
        }
        catch (error) {
            if ( /** @type {{code?: string}} */(error).code === "EEXIST")
                return false;
            throw error;
        }
        try {
            await this.writeOwnerMetadata();
            this.acquired = true;
            return true;
        }
        catch (error) {
            await fs.rm(this.lockPath, { recursive: true, force: true });
            throw error;
        }
    }
    /**
     * Releases the held HTTP server lock directory.
     * @returns {Promise<void>} - Resolves after best-effort lock release.
     */
    async release() {
        if (!this.acquired)
            return;
        this.acquired = false;
        await fs.rm(this.lockPath, { recursive: true, force: true });
    }
    /**
     * Writes metadata used to explain or reclaim an existing server lock.
     * @returns {Promise<void>} - Resolves after owner metadata has been written.
     */
    async writeOwnerMetadata() {
        await fs.writeFile(path.join(this.lockPath, "owner.json"), JSON.stringify({
            acquiredAt: new Date().toISOString(),
            host: this.host,
            hostname: os.hostname(),
            pid: process.pid,
            port: this.port
        }));
    }
    /**
     * Checks whether the current lock owner is a dead process on this host.
     * @returns {Promise<boolean>} - Whether the existing lock belongs to a dead process.
     */
    async isStale() {
        const owner = await this.readOwnerMetadata();
        if (!this.isLocalProcessOwner(owner))
            return false;
        return this.processIsDead(/** @type {{pid: number}} */ (owner).pid);
    }
    /**
     * Runs is local process owner.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} owner - Existing lock owner metadata.
     * @returns {boolean} - Whether owner metadata names a local process.
     */
    isLocalProcessOwner(owner) {
        if (!owner)
            return false;
        if (typeof owner.pid !== "number")
            return false;
        return this.ownerHostnameMatches(owner);
    }
    /**
     * Runs owner hostname matches.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} owner - Existing lock owner metadata.
     * @returns {boolean} - Whether the owner hostname is local or absent.
     */
    ownerHostnameMatches(owner) {
        if (!owner.hostname)
            return true;
        if (owner.hostname === os.hostname())
            return true;
        return false;
    }
    /**
     * Runs process is dead.
     * @param {number} pid - Process id.
     * @returns {boolean} - Whether the process no longer exists.
     */
    processIsDead(pid) {
        try {
            process.kill(pid, 0);
            return false;
        }
        catch (error) {
            return /** @type {{code?: string}} */ (error).code === "ESRCH";
        }
    }
    /**
     * Reads owner metadata from an existing server lock directory.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Parsed owner metadata, when readable.
     */
    async readOwnerMetadata() {
        try {
            const rawOwner = await fs.readFile(path.join(this.lockPath, "owner.json"), "utf8");
            return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (JSON.parse(rawOwner));
        }
        catch {
            return null;
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLWxvY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvc2VydmVyLWxvY2suanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ2pDLE9BQU8sRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUN4QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFFNUI7O0dBRUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHVCQUF1QjtJQUMxQzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUM7UUFDckMsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsRUFBRSxLQUFLLEVBQUUsYUFBYSxDQUFDLENBQUE7UUFDN0UsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLEVBQUMsU0FBUyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFFOUQsT0FBTyxJQUFJLEVBQUUsQ0FBQztZQUNaLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1lBRXhDLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQ2IsT0FBTTtZQUNSLENBQUM7WUFFRCxJQUFJLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUM7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Q0FBQyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUc7WUFDdkcsQ0FBQyxDQUFDLGtCQUFrQixJQUFJLENBQUMsUUFBUSxFQUFFLENBQUE7UUFFckMsT0FBTyxvRUFBb0UsT0FBTyxhQUFhLElBQUksQ0FBQyxRQUFRLHNDQUFzQyxDQUFBO0lBQ3BKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IG9zIGZyb20gXCJub2RlOm9zXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuXG4vKipcbiAqIERpcmVjdG9yeS1iYXNlZCBsb2NrIHRoYXQgYWxsb3dzIG9ubHkgb25lIEhUVFAgc2VydmVyIHByb2Nlc3MgcGVyIGFwcCBkaXJlY3RvcnkuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0h0dHBTZXJ2ZXJMb2NrIHtcbiAgLyoqXG4gICAqIEJ1aWxkIGEgbG9jayBmb3IgdGhlIGNvbmZpZ3VyZWQgYXBwbGljYXRpb24gZGlyZWN0b3J5IGFuZCBzZXJ2ZXIgZW5kcG9pbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIHRoYXQgb3ducyB0aGUgYXBwbGljYXRpb24gZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5ob3N0IC0gQ29uZmlndXJlZCBIVFRQIGhvc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnBvcnQgLSBDb25maWd1cmVkIEhUVFAgcG9ydC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBob3N0LCBwb3J0fSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMubG9ja1BhdGggPSBwYXRoLmpvaW4oY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgXCJ0bXBcIiwgXCJzZXJ2ZXIubG9ja1wiKVxuICAgIHRoaXMuYWNxdWlyZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmVzIHRoZSBhcHAtZGlyZWN0b3J5IEhUVFAgc2VydmVyIGxvY2sgYmVmb3JlIHN0YXJ0dXAgc2lkZSBlZmZlY3RzIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGxvY2sgaGFzIGJlZW4gYWNxdWlyZWQuXG4gICAqL1xuICBhc3luYyBhY3F1aXJlKCkge1xuICAgIGF3YWl0IGZzLm1rZGlyKHBhdGguZGlybmFtZSh0aGlzLmxvY2tQYXRoKSwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCB0aGlzLnRyeUFjcXVpcmUoKVxuXG4gICAgICBpZiAoYWNxdWlyZWQpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChhd2FpdCB0aGlzLmlzU3RhbGUoKSkge1xuICAgICAgICBhd2FpdCBmcy5ybSh0aGlzLmxvY2tQYXRoLCB7cmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZX0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihhd2FpdCB0aGlzLmxvY2tIZWxkTWVzc2FnZSgpKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcmllcyB0byBjcmVhdGUgdGhlIGxvY2sgZGlyZWN0b3J5IGFuZCB3cml0ZSBvd25lciBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbG9jayB3YXMgYWNxdWlyZWQuXG4gICAqL1xuICBhc3luYyB0cnlBY3F1aXJlKCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5ta2Rpcih0aGlzLmxvY2tQYXRoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoLyoqIEB0eXBlIHt7Y29kZT86IHN0cmluZ319ICovIChlcnJvcikuY29kZSA9PT0gXCJFRVhJU1RcIikgcmV0dXJuIGZhbHNlXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLndyaXRlT3duZXJNZXRhZGF0YSgpXG4gICAgICB0aGlzLmFjcXVpcmVkID0gdHJ1ZVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCBmcy5ybSh0aGlzLmxvY2tQYXRoLCB7cmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZX0pXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGUgaGVsZCBIVFRQIHNlcnZlciBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYmVzdC1lZmZvcnQgbG9jayByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZSgpIHtcbiAgICBpZiAoIXRoaXMuYWNxdWlyZWQpIHJldHVyblxuXG4gICAgdGhpcy5hY3F1aXJlZCA9IGZhbHNlXG4gICAgYXdhaXQgZnMucm0odGhpcy5sb2NrUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyBtZXRhZGF0YSB1c2VkIHRvIGV4cGxhaW4gb3IgcmVjbGFpbSBhbiBleGlzdGluZyBzZXJ2ZXIgbG9jay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgb3duZXIgbWV0YWRhdGEgaGFzIGJlZW4gd3JpdHRlbi5cbiAgICovXG4gIGFzeW5jIHdyaXRlT3duZXJNZXRhZGF0YSgpIHtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUocGF0aC5qb2luKHRoaXMubG9ja1BhdGgsIFwib3duZXIuanNvblwiKSwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgYWNxdWlyZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgaG9zdDogdGhpcy5ob3N0LFxuICAgICAgaG9zdG5hbWU6IG9zLmhvc3RuYW1lKCksXG4gICAgICBwaWQ6IHByb2Nlc3MucGlkLFxuICAgICAgcG9ydDogdGhpcy5wb3J0XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgdGhlIGN1cnJlbnQgbG9jayBvd25lciBpcyBhIGRlYWQgcHJvY2VzcyBvbiB0aGlzIGhvc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGV4aXN0aW5nIGxvY2sgYmVsb25ncyB0byBhIGRlYWQgcHJvY2Vzcy5cbiAgICovXG4gIGFzeW5jIGlzU3RhbGUoKSB7XG4gICAgY29uc3Qgb3duZXIgPSBhd2FpdCB0aGlzLnJlYWRPd25lck1ldGFkYXRhKClcblxuICAgIGlmICghdGhpcy5pc0xvY2FsUHJvY2Vzc093bmVyKG93bmVyKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5wcm9jZXNzSXNEZWFkKC8qKiBAdHlwZSB7e3BpZDogbnVtYmVyfX0gKi8gKG93bmVyKS5waWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBsb2NhbCBwcm9jZXNzIG93bmVyLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IG93bmVyIC0gRXhpc3RpbmcgbG9jayBvd25lciBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBvd25lciBtZXRhZGF0YSBuYW1lcyBhIGxvY2FsIHByb2Nlc3MuXG4gICAqL1xuICBpc0xvY2FsUHJvY2Vzc093bmVyKG93bmVyKSB7XG4gICAgaWYgKCFvd25lcikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKHR5cGVvZiBvd25lci5waWQgIT09IFwibnVtYmVyXCIpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMub3duZXJIb3N0bmFtZU1hdGNoZXMob3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvd25lciBob3N0bmFtZSBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gb3duZXIgLSBFeGlzdGluZyBsb2NrIG93bmVyIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBvd25lciBob3N0bmFtZSBpcyBsb2NhbCBvciBhYnNlbnQuXG4gICAqL1xuICBvd25lckhvc3RuYW1lTWF0Y2hlcyhvd25lcikge1xuICAgIGlmICghb3duZXIuaG9zdG5hbWUpIHJldHVybiB0cnVlXG4gICAgaWYgKG93bmVyLmhvc3RuYW1lID09PSBvcy5ob3N0bmFtZSgpKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcm9jZXNzIGlzIGRlYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBwaWQgLSBQcm9jZXNzIGlkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBwcm9jZXNzIG5vIGxvbmdlciBleGlzdHMuXG4gICAqL1xuICBwcm9jZXNzSXNEZWFkKHBpZCkge1xuICAgIHRyeSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCAwKVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7e2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpLmNvZGUgPT09IFwiRVNSQ0hcIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBvd25lciBtZXRhZGF0YSBmcm9tIGFuIGV4aXN0aW5nIHNlcnZlciBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUGFyc2VkIG93bmVyIG1ldGFkYXRhLCB3aGVuIHJlYWRhYmxlLlxuICAgKi9cbiAgYXN5bmMgcmVhZE93bmVyTWV0YWRhdGEoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhd093bmVyID0gYXdhaXQgZnMucmVhZEZpbGUocGF0aC5qb2luKHRoaXMubG9ja1BhdGgsIFwib3duZXIuanNvblwiKSwgXCJ1dGY4XCIpXG5cbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKEpTT04ucGFyc2UocmF3T3duZXIpKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgZHVwbGljYXRlLXNlcnZlciBlcnJvciBtZXNzYWdlIHdpdGggb3duZXIgZGV0YWlscyB3aGVuIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBFcnJvciBtZXNzYWdlIGV4cGxhaW5pbmcgd2hpY2ggc2VydmVyIG93bnMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBsb2NrSGVsZE1lc3NhZ2UoKSB7XG4gICAgY29uc3Qgb3duZXIgPSBhd2FpdCB0aGlzLnJlYWRPd25lck1ldGFkYXRhKClcbiAgICBjb25zdCBkZXRhaWxzID0gb3duZXJcbiAgICAgID8gYFBJRCAke1N0cmluZyhvd25lci5waWQpfSBvbiAke1N0cmluZyhvd25lci5ob3N0bmFtZSl9ICgke1N0cmluZyhvd25lci5ob3N0KX06JHtTdHJpbmcob3duZXIucG9ydCl9KWBcbiAgICAgIDogYGxvY2sgZGlyZWN0b3J5ICR7dGhpcy5sb2NrUGF0aH1gXG5cbiAgICByZXR1cm4gYEEgVmVsb2Npb3VzIEhUVFAgc2VydmVyIGlzIGFscmVhZHkgcnVubmluZyBmb3IgdGhpcyBhcHBsaWNhdGlvbiAoJHtkZXRhaWxzfSkuIFJlbW92ZSAke3RoaXMubG9ja1BhdGh9IGlmIHRoZSBzZXJ2ZXIgaXMgbm8gbG9uZ2VyIHJ1bm5pbmcuYFxuICB9XG59XG4iXX0=