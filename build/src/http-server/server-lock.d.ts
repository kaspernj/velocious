import AdvisoryLockFileBackend from "../database/advisory-lock-file-backend.js";
/**
 * Directory-based lock that allows only one HTTP server process per app
 * directory. Thin wrapper over the shared file-lock backend
 * (`src/database/advisory-lock-file-backend.js` — the STC-210 `file` tier
 * primitive generalized from this lock's original hand-rolled directory
 * protocol), so the server lock and the advisory-lock file tier share one
 * acquisition, owner-metadata, lease-renewal, and staleness implementation.
 */
export default class VelociousHttpServerLock {
    configuration: import("../configuration.js").default;
    host: string;
    port: number;
    lockPath: string;
    backend: AdvisoryLockFileBackend;
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
     * Acquires the app-directory HTTP server lock before startup side effects
     * run. A stale lock (dead local owner or expired lease) is reclaimed by the
     * backend; a live foreign owner fails loudly with the owner details.
     * @returns {Promise<void>} - Resolves after the lock has been acquired.
     */
    acquire(): Promise<void>;
    /**
     * Releases the held HTTP server lock directory.
     * @returns {Promise<void>} - Resolves after best-effort lock release.
     */
    release(): Promise<void>;
    /**
     * Reads owner metadata from an existing server lock directory.
     * @returns {Promise<import("../database/advisory-lock-file-backend.js").AdvisoryLockFileOwner | null>} - Parsed owner metadata, when readable.
     */
    readOwnerMetadata(): Promise<import("../database/advisory-lock-file-backend.js").AdvisoryLockFileOwner | null>;
    /**
     * Builds a duplicate-server error message with owner details when available.
     * @returns {Promise<string>} - Error message explaining which server owns the lock.
     */
    lockHeldMessage(): Promise<string>;
}
//# sourceMappingURL=server-lock.d.ts.map