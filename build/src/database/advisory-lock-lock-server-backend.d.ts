export type LockServerConnectionLike = {
    /**
     * - Resolves when the server accepted the 1:1 connection.
     */
    ready: Promise<void>;
    /**
     * - Sends one connection message.
     */
    sendMessage: (body: Record<string, unknown>) => void;
    /**
     * - Closes the connection.
     */
    close?: () => void;
};
export type LockServerClientLike = {
    /**
     * - Opens the transport.
     */
    connect: () => Promise<void>;
    /**
     * - Opens the 1:1 connection.
     */
    openConnection: (type: string, args: {
        onMessage: (body: Record<string, unknown>) => void;
        params: Record<string, unknown>;
        timeoutMs: number;
    }) => LockServerConnectionLike;
    /**
     * - Closes the transport.
     */
    close?: () => Promise<void> | void;
};
export type LockServerHold = {
    epoch: number;
    name: string;
    timer: ReturnType<typeof setInterval>;
    leaseExpiresAt: number;
};
export type LockServerAcquireResult = {
    status: "acquired";
    epoch: number;
    leaseExpiresAt: number;
} | {
    status: "busy";
} | {
    status: "timeout";
};
/**
 * @typedef {object} LockServerConnectionLike
 * @property {Promise<void>} ready - Resolves when the server accepted the 1:1 connection.
 * @property {(body: Record<string, unknown>) => void} sendMessage - Sends one connection message.
 * @property {() => void} [close] - Closes the connection.
 * @typedef {object} LockServerClientLike
 * @property {() => Promise<void>} connect - Opens the transport.
 * @property {(type: string, args: {onMessage: (body: Record<string, unknown>) => void, params: Record<string, unknown>, timeoutMs: number}) => LockServerConnectionLike} openConnection - Opens the 1:1 connection.
 * @property {() => Promise<void> | void} [close] - Closes the transport.
 * @typedef {{epoch: number, name: string, timer: ReturnType<typeof setInterval>, leaseExpiresAt: number}} LockServerHold
 * @typedef {{status: "acquired", epoch: number, leaseExpiresAt: number} | {status: "busy"} | {status: "timeout"}} LockServerAcquireResult
 */
/** Protocol version spoken by the centralized lock server (consens-lock v2). */
export declare const LOCK_SERVER_PROTOCOL_VERSION = 2;
/**
 * Tier (b) backend: the centralized lock server (`consens-lock`, protocol v2).
 *
 * The server holds every lock in its own process memory, so a held lock never
 * pins a database connection — that is the whole point of this tier. Ownership
 * is bound to this process's connection: the server mints the `holderId`, so a
 * client can only renew or release its own leases, and a dropped connection
 * releases all of them immediately.
 *
 * Holds are leases renewed every third of the lease window. A fenced lease
 * (the server granted the name to another holder after an expiry or partition)
 * is recorded per lock name and surfaced by the runner as
 * `AdvisoryLockLostError` after the critical section settles.
 *
 * Unavailability is cached for `reprobeCooldownMs` so a flapping server cannot
 * turn every waiting caller into a connection attempt (design §2).
 */
export default class AdvisoryLockLockServerBackend {
    url: string;
    authToken: string;
    clientFactory: (args: {
        authToken: string;
        url: string;
    }) => LockServerClientLike;
    connectTimeoutMs: number;
    leaseMs: number;
    onError: ((error: Error) => void) | undefined;
    reprobeCooldownMs: number;
    /** @type {LockServerClientLike | null} */
    client: LockServerClientLike | null;
    /** @type {LockServerConnectionLike | null} */
    connection: LockServerConnectionLike | null;
    /** @type {Promise<void> | null} */
    connectPromise: Promise<void> | null;
    /** @type {{reject: (error: Error) => void, resolve: () => void, timer: ReturnType<typeof setTimeout> | null} | null} */
    helloWaiter: {
        reject: (error: Error) => void;
        resolve: () => void;
        timer: ReturnType<typeof setTimeout> | null;
    } | null;
    /** @type {Map<string, {epoch: number, name: string, timer: ReturnType<typeof setInterval>, leaseExpiresAt: number}>} */
    holds: Map<string, {
        epoch: number;
        name: string;
        timer: ReturnType<typeof setInterval>;
        leaseExpiresAt: number;
    }>;
    /** @type {Map<string, {currentEpoch: number | null, epoch: number | null}>} */
    fencedHolds: Map<string, {
        currentEpoch: number | null;
        epoch: number | null;
    }>;
    /** @type {Map<string, {reject: (error: Error) => void, resolve: (message: Record<string, unknown>) => void, timer: ReturnType<typeof setTimeout> | null}>} */
    pending: Map<string, {
        reject: (error: Error) => void;
        resolve: (message: Record<string, unknown>) => void;
        timer: ReturnType<typeof setTimeout> | null;
    }>;
    /** @type {{lastError: string | null, lastProbeAt: string | null, unavailableUntil: number}} */
    status: {
        lastError: string | null;
        lastProbeAt: string | null;
        unavailableUntil: number;
    };
    requestCounter: number;
    closed: boolean;
    /**
     * Creates the lock-server backend. The transport is created on first use, so
     * constructing this object never performs I/O.
     * @param {object} args - Backend options.
     * @param {string} [args.authToken] - Shared secret; the server fails closed without a matching token.
     * @param {(args: {authToken: string, url: string}) => LockServerClientLike} [args.clientFactory] - Transport factory (tests inject a fake).
     * @param {number} [args.connectTimeoutMs] - Handshake timeout.
     * @param {number} [args.leaseMs] - Lease duration used until the server advertises its own.
     * @param {(error: Error) => void} [args.onError] - Async error reporter.
     * @param {number} [args.reprobeCooldownMs] - How long an unavailable server is not re-probed.
     * @param {string} args.url - Lock-server websocket URL.
     */
    constructor({ authToken, clientFactory, connectTimeoutMs, leaseMs, onError, reprobeCooldownMs, url }: {
        authToken?: string;
        clientFactory?: (args: {
            authToken: string;
            url: string;
        }) => LockServerClientLike;
        connectTimeoutMs?: number;
        leaseMs?: number;
        onError?: (error: Error) => void;
        reprobeCooldownMs?: number;
        url: string;
    });
    /**
     * Opens the connection if needed, honoring the re-probe cooldown.
     * @param {string} lockName - Lock name, for error messages.
     * @returns {Promise<void>} - Resolves when connected.
     */
    ensureConnected(lockName: string): Promise<void>;
    /**
     * Opens the transport and completes the hello handshake.
     * @param {string} lockName - Lock name, for error messages.
     * @returns {Promise<void>} - Resolves when the handshake completed.
     */
    openConnection(lockName: string): Promise<void>;
    /**
     * Waits for a lock through the server's FIFO queue.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Bounded wait; the server defaults to 30s.
     * @returns {Promise<boolean>} - True when the lease was granted, false on timeout.
     */
    acquire(name: string, { timeoutMs }?: {
        timeoutMs?: number | null;
    }): Promise<boolean>;
    /**
     * Takes a lock only if the server grants it immediately.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True when granted.
     */
    tryAcquire(name: string): Promise<boolean>;
    /**
     * Releases a held lease and stops its renewal.
     * @param {string} name - Lock name.
     * @returns {Promise<void>} - Resolves when released (or when the transport is gone).
     */
    release(name: string): Promise<void>;
    /**
     * Releases every lease this process holds (shutdown path).
     * @returns {Promise<void>} - Resolves when every lease was released.
     */
    releaseAllHeld(): Promise<void>;
    /**
     * Runs the server's live holder list (diagnostics).
     * @returns {Promise<Record<string, unknown>[]>} - Live holders.
     */
    list(): Promise<Record<string, unknown>[]>;
    /**
     * Runs who-holds for one name (diagnostics).
     * @param {string} name - Lock name.
     * @returns {Promise<Record<string, unknown> | null>} - Holder, or null.
     */
    whoHolds(name: string): Promise<Record<string, unknown> | null>;
    /**
     * Runs the fencing epoch granted for one held lease.
     * @param {string} name - Lock name.
     * @returns {number | null} - Granted epoch, or null when the lease is not (or no longer) held.
     */
    getHoldEpoch(name: string): number | null;
    /**
     * Whether this hold was fenced or lost during its critical section.
     * @param {string} name - Lock name.
     * @param {number | null} epoch - Epoch the hold was granted.
     * @returns {{currentEpoch: number | null, epoch: number | null} | null} - Fencing details when lost.
     */
    takeLoss(name: string, epoch: number | null): {
        currentEpoch: number | null;
        epoch: number | null;
    } | null;
    /**
     * Reports connection state and the names currently leased through this
     * process, for `getAdvisoryLockBackendStatus()`.
     * @returns {{connected: boolean, lastError: string | null, lastProbeAt: string | null, leasedNames: string[]}} - Backend status for diagnostics.
     */
    getStatus(): {
        connected: boolean;
        lastError: string | null;
        lastProbeAt: string | null;
        leasedNames: string[];
    };
    /**
     * Closes the backend: explicit release first, then the transport.
     * @returns {Promise<void>} - Resolves when closed.
     */
    close(): Promise<void>;
    /**
     * Dispatches one server message.
     * @param {Record<string, unknown>} body - Server message.
     * @returns {void}
     */
    handleMessage(body: Record<string, unknown>): void;
    /**
     * Sends one request and awaits its correlated response.
     * @param {string} type - Request type.
     * @param {Record<string, unknown>} payload - Request fields.
     * @param {number | null} [timeoutMs] - Response timeout; null waits for the server.
     * @returns {Promise<Record<string, unknown>>} - Response body.
     */
    request(type: string, payload: Record<string, unknown>, timeoutMs?: number | null): Promise<Record<string, unknown>>;
    /**
     * Starts lease renewal for a granted lock.
     * @param {string} name - Lock name.
     * @param {number} epoch - Granted epoch.
     * @returns {void}
     */
    startRenewal(name: string, epoch: number): void;
    /**
     * Renews one lease; a fenced lease is recorded for the runner to surface.
     * @param {string} name - Lock name.
     * @param {number} epoch - Epoch the hold believes it owns.
     * @returns {Promise<void>} - Resolves after the renewal round-trip.
     */
    renew(name: string, epoch: number): Promise<void>;
    /**
     * Records that the lock server is unreachable and starts the re-probe cooldown.
     * @param {Error} error - Failure.
     * @returns {void}
     */
    markUnavailable(error: Error): void;
    /**
     * Drops transport state and marks every outstanding hold lost.
     * @returns {void}
     */
    teardown(): void;
    /**
     * Reports a transport-side failure without breaking lock handling.
     * @param {unknown} error - Failure to report.
     * @returns {void}
     */
    reportError(error: unknown): void;
}
//# sourceMappingURL=advisory-lock-lock-server-backend.d.ts.map