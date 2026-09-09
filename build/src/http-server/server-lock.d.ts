/**
 * Directory-based lock that allows only one HTTP server process per app directory.
 */
export default class VelociousHttpServerLock {
    configuration: import("../configuration.js").default;
    host: string;
    port: number;
    lockPath: string;
    acquired: boolean;
    /**
     * Build a lock for the configured application directory and server endpoint.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration that owns the application directory.
     * @param {string} args.host - Configured HTTP host.
     * @param {number} args.port - Configured HTTP port.
     */
    constructor({ configuration, host, port }: {
        configuration: import("../configuration.js").default;
        host: string;
        port: number;
    });
    /**
     * Acquires the app-directory HTTP server lock before startup side effects run.
     * @returns {Promise<void>} - Resolves after the lock has been acquired.
     */
    acquire(): Promise<void>;
    /**
     * Tries to create the lock directory and write owner metadata.
     * @returns {Promise<boolean>} - Whether the lock was acquired.
     */
    tryAcquire(): Promise<boolean>;
    /**
     * Releases the held HTTP server lock directory.
     * @returns {Promise<void>} - Resolves after best-effort lock release.
     */
    release(): Promise<void>;
    /**
     * Writes metadata used to explain or reclaim an existing server lock.
     * @returns {Promise<void>} - Resolves after owner metadata has been written.
     */
    writeOwnerMetadata(): Promise<void>;
    /**
     * Checks whether the current lock owner is a dead process on this host.
     * @returns {Promise<boolean>} - Whether the existing lock belongs to a dead process.
     */
    isStale(): Promise<boolean>;
    /**
     * Runs is local process owner.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} owner - Existing lock owner metadata.
     * @returns {boolean} - Whether owner metadata names a local process.
     */
    isLocalProcessOwner(owner: Record<string, ReturnType<typeof JSON.parse>> | null): boolean;
    /**
     * Runs owner hostname matches.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} owner - Existing lock owner metadata.
     * @returns {boolean} - Whether the owner hostname is local or absent.
     */
    ownerHostnameMatches(owner: Record<string, ReturnType<typeof JSON.parse>>): boolean;
    /**
     * Runs process is dead.
     * @param {number} pid - Process id.
     * @returns {boolean} - Whether the process no longer exists.
     */
    processIsDead(pid: number): boolean;
    /**
     * Reads owner metadata from an existing server lock directory.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Parsed owner metadata, when readable.
     */
    readOwnerMetadata(): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Builds a duplicate-server error message with owner details when available.
     * @returns {Promise<string>} - Error message explaining which server owns the lock.
     */
    lockHeldMessage(): Promise<string>;
}
//# sourceMappingURL=server-lock.d.ts.map