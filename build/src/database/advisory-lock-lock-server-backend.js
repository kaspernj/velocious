// @ts-check
import WebSocket from "ws";
import VelociousWebsocketClient from "../http-client/websocket-client.js";
import { AdvisoryLockServiceUnavailableError } from "./advisory-lock-errors.js";
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
export const LOCK_SERVER_PROTOCOL_VERSION = 2;
/** Connection role registered on the lock server. */
const LOCK_SERVER_CONNECTION_TYPE = "lock";
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
    constructor({ authToken = "", clientFactory = defaultClientFactory, connectTimeoutMs = 3000, leaseMs = 30_000, onError, reprobeCooldownMs = 5000, url }) {
        this.url = url;
        this.authToken = authToken;
        this.clientFactory = clientFactory;
        this.connectTimeoutMs = connectTimeoutMs;
        this.leaseMs = leaseMs;
        this.onError = onError;
        this.reprobeCooldownMs = reprobeCooldownMs;
        /** @type {LockServerClientLike | null} */
        this.client = null;
        /** @type {LockServerConnectionLike | null} */
        this.connection = null;
        /** @type {Promise<void> | null} */
        this.connectPromise = null;
        /** @type {{reject: (error: Error) => void, resolve: () => void, timer: ReturnType<typeof setTimeout> | null} | null} */
        this.helloWaiter = null;
        /** @type {Map<string, {epoch: number, name: string, timer: ReturnType<typeof setInterval>, leaseExpiresAt: number}>} */
        this.holds = new Map();
        /** @type {Map<string, {currentEpoch: number | null, epoch: number | null}>} */
        this.fencedHolds = new Map();
        /** @type {Map<string, {reject: (error: Error) => void, resolve: (message: Record<string, unknown>) => void, timer: ReturnType<typeof setTimeout> | null}>} */
        this.pending = new Map();
        /** @type {{lastError: string | null, lastProbeAt: string | null, unavailableUntil: number}} */
        this.status = { lastError: null, lastProbeAt: null, unavailableUntil: 0 };
        this.requestCounter = 0;
        this.closed = false;
    }
    /**
     * Opens the connection if needed, honoring the re-probe cooldown.
     * @param {string} lockName - Lock name, for error messages.
     * @returns {Promise<void>} - Resolves when connected.
     */
    async ensureConnected(lockName) {
        if (this.closed)
            throw new AdvisoryLockServiceUnavailableError("Lock server backend is closed", { lockName, reason: "closed" });
        if (this.connection)
            return;
        if (this.connectPromise)
            return await this.connectPromise;
        if (Date.now() < this.status.unavailableUntil) {
            throw new AdvisoryLockServiceUnavailableError(`Lock server ${this.url} is marked unavailable: ${String(this.status.lastError)}`, { lockName, reason: "cooldown" });
        }
        this.connectPromise = this.openConnection(lockName);
        try {
            await this.connectPromise;
        }
        finally {
            this.connectPromise = null;
        }
    }
    /**
     * Opens the transport and completes the hello handshake.
     * @param {string} lockName - Lock name, for error messages.
     * @returns {Promise<void>} - Resolves when the handshake completed.
     */
    async openConnection(lockName) {
        this.status.lastProbeAt = new Date().toISOString();
        try {
            const client = this.clientFactory({ authToken: this.authToken, url: this.url });
            this.client = client;
            await client.connect();
            /** @type {Promise<void>} */
            const helloPromise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new AdvisoryLockServiceUnavailableError(`Lock server ${this.url} did not answer the handshake within ${this.connectTimeoutMs}ms`, { lockName, reason: "handshake-timeout" }));
                }, this.connectTimeoutMs);
                timer.unref?.();
                this.helloWaiter = { reject, resolve, timer };
            });
            const connection = client.openConnection(LOCK_SERVER_CONNECTION_TYPE, {
                onMessage: (body) => this.handleMessage(body),
                params: { authToken: this.authToken, protocolVersion: LOCK_SERVER_PROTOCOL_VERSION },
                timeoutMs: this.connectTimeoutMs
            });
            this.connection = connection;
            await connection.ready;
            await helloPromise;
            this.status.lastError = null;
            this.status.unavailableUntil = 0;
        }
        catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            this.markUnavailable(normalized);
            this.teardown();
            throw new AdvisoryLockServiceUnavailableError(`Lock server ${this.url} is unavailable: ${normalized.message}`, { lockName, reason: "connect-failed" });
        }
    }
    /**
     * Waits for a lock through the server's FIFO queue.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Bounded wait; the server defaults to 30s.
     * @returns {Promise<boolean>} - True when the lease was granted, false on timeout.
     */
    async acquire(name, { timeoutMs } = {}) {
        await this.ensureConnected(name);
        /** @type {LockServerAcquireResult} */
        const result = /** @type {LockServerAcquireResult} */ (await this.request("acquire", {
            name,
            timeoutMs: typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : undefined
        }, typeof timeoutMs === "number" ? timeoutMs + this.connectTimeoutMs : null));
        if (result.status === "acquired") {
            this.startRenewal(name, result.epoch);
            return true;
        }
        if (result.status === "busy")
            return false;
        return false;
    }
    /**
     * Takes a lock only if the server grants it immediately.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True when granted.
     */
    async tryAcquire(name) {
        await this.ensureConnected(name);
        /** @type {LockServerAcquireResult} */
        const result = /** @type {LockServerAcquireResult} */ (await this.request("try-acquire", { name }));
        if (result.status !== "acquired")
            return false;
        this.startRenewal(name, result.epoch);
        return true;
    }
    /**
     * Releases a held lease and stops its renewal.
     * @param {string} name - Lock name.
     * @returns {Promise<void>} - Resolves when released (or when the transport is gone).
     */
    async release(name) {
        const hold = this.holds.get(name);
        if (!hold)
            return;
        this.holds.delete(name);
        clearInterval(hold.timer);
        if (!this.connection)
            return;
        try {
            await this.request("release", { epoch: hold.epoch, name });
        }
        catch (error) {
            if (!(error instanceof AdvisoryLockServiceUnavailableError))
                throw error;
            // The server releases every lease of a closed connection, and the lease
            // expires otherwise; both paths reclaim the name.
            this.reportError(error);
        }
    }
    /**
     * Releases every lease this process holds (shutdown path).
     * @returns {Promise<void>} - Resolves when every lease was released.
     */
    async releaseAllHeld() {
        for (const name of [...this.holds.keys()])
            await this.release(name);
    }
    /**
     * Runs the server's live holder list (diagnostics).
     * @returns {Promise<Record<string, unknown>[]>} - Live holders.
     */
    async list() {
        const response = await this.request("list", {});
        const holders = response.holders;
        return /** @type {Record<string, unknown>[]} */ (Array.isArray(holders) ? holders : []);
    }
    /**
     * Runs who-holds for one name (diagnostics).
     * @param {string} name - Lock name.
     * @returns {Promise<Record<string, unknown> | null>} - Holder, or null.
     */
    async whoHolds(name) {
        const response = await this.request("who-holds", { name });
        const holder = response.holder;
        return /** @type {Record<string, unknown> | null} */ (holder && typeof holder === "object" ? holder : null);
    }
    /**
     * Runs the fencing epoch granted for one held lease.
     * @param {string} name - Lock name.
     * @returns {number | null} - Granted epoch, or null when the lease is not (or no longer) held.
     */
    getHoldEpoch(name) {
        return this.holds.get(name)?.epoch ?? null;
    }
    /**
     * Whether this hold was fenced or lost during its critical section.
     * @param {string} name - Lock name.
     * @param {number | null} epoch - Epoch the hold was granted.
     * @returns {{currentEpoch: number | null, epoch: number | null} | null} - Fencing details when lost.
     */
    takeLoss(name, epoch) {
        const loss = this.fencedHolds.get(name);
        if (loss) {
            this.fencedHolds.delete(name);
            return loss;
        }
        const hold = this.holds.get(name);
        if (hold && hold.epoch !== epoch)
            return { currentEpoch: hold.epoch, epoch };
        return null;
    }
    /**
     * Reports connection state and the names currently leased through this
     * process, for `getAdvisoryLockBackendStatus()`.
     * @returns {{connected: boolean, lastError: string | null, lastProbeAt: string | null, leasedNames: string[]}} - Backend status for diagnostics.
     */
    getStatus() {
        return {
            connected: Boolean(this.connection),
            lastError: this.status.lastError,
            lastProbeAt: this.status.lastProbeAt,
            leasedNames: [...this.holds.keys()]
        };
    }
    /**
     * Closes the backend: explicit release first, then the transport.
     * @returns {Promise<void>} - Resolves when closed.
     */
    async close() {
        this.closed = true;
        await this.releaseAllHeld();
        this.teardown();
    }
    /**
     * Dispatches one server message.
     * @param {Record<string, unknown>} body - Server message.
     * @returns {void}
     */
    handleMessage(body) {
        if (!body || typeof body !== "object")
            return;
        if (body.type === "hello-ack") {
            const advertisedLeaseMs = Number(body.leaseMs);
            if (Number.isFinite(advertisedLeaseMs) && advertisedLeaseMs > 0)
                this.leaseMs = advertisedLeaseMs;
            const helloWaiter = this.helloWaiter;
            this.helloWaiter = null;
            if (helloWaiter) {
                if (helloWaiter.timer)
                    clearTimeout(helloWaiter.timer);
                helloWaiter.resolve();
            }
            return;
        }
        if (body.type === "lost") {
            const name = String(body.name ?? "");
            const hold = this.holds.get(name);
            if (!hold)
                return;
            this.holds.delete(name);
            clearInterval(hold.timer);
            this.fencedHolds.set(name, { currentEpoch: Number(body.epoch ?? 0), epoch: hold.epoch });
            return;
        }
        if (body.type !== "response" || typeof body.correlationId !== "string")
            return;
        const pending = this.pending.get(body.correlationId);
        if (!pending)
            return;
        this.pending.delete(body.correlationId);
        if (pending.timer)
            clearTimeout(pending.timer);
        if (body.status === "error") {
            pending.reject(new Error(String(body.error || "Lock server error")));
            return;
        }
        pending.resolve(body);
    }
    /**
     * Sends one request and awaits its correlated response.
     * @param {string} type - Request type.
     * @param {Record<string, unknown>} payload - Request fields.
     * @param {number | null} [timeoutMs] - Response timeout; null waits for the server.
     * @returns {Promise<Record<string, unknown>>} - Response body.
     */
    async request(type, payload, timeoutMs = null) {
        const connection = this.connection;
        if (!connection) {
            throw new AdvisoryLockServiceUnavailableError("Lock server connection is not open", { lockName: String(payload.name ?? ""), reason: "not-connected" });
        }
        const correlationId = `req-${++this.requestCounter}`;
        return await new Promise((resolve, reject) => {
            const timer = typeof timeoutMs === "number" && timeoutMs > 0
                ? setTimeout(() => {
                    this.pending.delete(correlationId);
                    reject(new AdvisoryLockServiceUnavailableError(`Lock server request timed out: ${type} ${String(payload.name ?? "")}`, { lockName: String(payload.name ?? ""), reason: "request-timeout" }));
                }, timeoutMs)
                : null;
            timer?.unref?.();
            this.pending.set(correlationId, { reject, resolve, timer });
            try {
                connection.sendMessage({ ...payload, correlationId, type });
            }
            catch (error) {
                this.pending.delete(correlationId);
                if (timer)
                    clearTimeout(timer);
                this.markUnavailable(error instanceof Error ? error : new Error(String(error)));
                reject(new AdvisoryLockServiceUnavailableError(`Lock server send failed: ${error instanceof Error ? error.message : String(error)}`, { lockName: String(payload.name ?? ""), reason: "send-failed" }));
            }
        });
    }
    /**
     * Starts lease renewal for a granted lock.
     * @param {string} name - Lock name.
     * @param {number} epoch - Granted epoch.
     * @returns {void}
     */
    startRenewal(name, epoch) {
        const existing = this.holds.get(name);
        if (existing)
            clearInterval(existing.timer);
        const intervalMs = Math.max(250, Math.floor(this.leaseMs / 3));
        const timer = setInterval(() => {
            void this.renew(name, epoch);
        }, intervalMs);
        timer.unref?.();
        this.holds.set(name, { epoch, leaseExpiresAt: Date.now() + this.leaseMs, name, timer });
    }
    /**
     * Renews one lease; a fenced lease is recorded for the runner to surface.
     * @param {string} name - Lock name.
     * @param {number} epoch - Epoch the hold believes it owns.
     * @returns {Promise<void>} - Resolves after the renewal round-trip.
     */
    async renew(name, epoch) {
        const hold = this.holds.get(name);
        if (!hold || !this.connection)
            return;
        try {
            const response = await this.request("renew", { epoch, name }, this.connectTimeoutMs * 2);
            const status = String(response.status);
            if (status === "renewed") {
                hold.leaseExpiresAt = Number(response.leaseExpiresAt);
                return;
            }
            if (status === "lost" || status === "not-found") {
                this.holds.delete(name);
                clearInterval(hold.timer);
                this.fencedHolds.set(name, { currentEpoch: Number(response.currentEpoch ?? 0), epoch });
            }
        }
        catch (error) {
            if (!(error instanceof AdvisoryLockServiceUnavailableError))
                throw error;
            // A lease that cannot be renewed can no longer be proven to be ours: the
            // server may have fenced it while the transport was failing. Recording it
            // as lost is the only honest answer, and stops the renewal loop.
            this.markUnavailable(error);
            this.holds.delete(name);
            clearInterval(hold.timer);
            this.fencedHolds.set(name, { currentEpoch: null, epoch });
            this.reportError(error);
        }
    }
    /**
     * Records that the lock server is unreachable and starts the re-probe cooldown.
     * @param {Error} error - Failure.
     * @returns {void}
     */
    markUnavailable(error) {
        this.status.lastError = error.message;
        this.status.lastProbeAt = new Date().toISOString();
        this.status.unavailableUntil = Date.now() + this.reprobeCooldownMs;
    }
    /**
     * Drops transport state and marks every outstanding hold lost.
     * @returns {void}
     */
    teardown() {
        for (const [name, hold] of this.holds) {
            clearInterval(hold.timer);
            this.fencedHolds.set(name, { currentEpoch: null, epoch: hold.epoch });
        }
        this.holds.clear();
        for (const pending of this.pending.values()) {
            if (pending.timer)
                clearTimeout(pending.timer);
            pending.reject(new AdvisoryLockServiceUnavailableError("Lock server connection dropped", { lockName: "", reason: "connection-dropped" }));
        }
        this.pending.clear();
        const connection = this.connection;
        const client = this.client;
        this.connection = null;
        this.client = null;
        try {
            connection?.close?.();
        }
        catch (error) {
            this.reportError(error instanceof Error ? error : new Error(String(error)));
        }
        try {
            void client?.close?.();
        }
        catch (error) {
            this.reportError(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Reports a transport-side failure without breaking lock handling.
     * @param {unknown} error - Failure to report.
     * @returns {void}
     */
    reportError(error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.status.lastError = normalized.message;
        if (this.onError)
            this.onError(normalized);
    }
}
/**
 * Default transport factory: the framework websocket client with the Node
 * `ws` implementation bound explicitly (no global mutation).
 * @param {{authToken: string, url: string}} args - Connection args.
 * @returns {LockServerClientLike} - Websocket client.
 */
function defaultClientFactory({ url }) {
    // Node's global WebSocket is not guaranteed to exist, so the implementation is
    // bound explicitly instead of mutating `globalThis`.
    const webSocketImplementation = /** @type {typeof globalThis.WebSocket} */ ( /** @type {unknown} */(WebSocket));
    return /** @type {LockServerClientLike} */ ( /** @type {unknown} */(new VelociousWebsocketClient({
        heartbeatIntervalMs: 10_000,
        url,
        webSocketImplementation
    })));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1sb2NrLXNlcnZlci1iYWNrZW5kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stbG9jay1zZXJ2ZXItYmFja2VuZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0sSUFBSSxDQUFBO0FBRTFCLE9BQU8sd0JBQXdCLE1BQU0sb0NBQW9DLENBQUE7QUFDekUsT0FBTyxFQUFDLG1DQUFtQyxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFFN0U7Ozs7Ozs7Ozs7O0dBV0c7QUFFSCxnRkFBZ0Y7QUFDaEYsTUFBTSxDQUFDLE1BQU0sNEJBQTRCLEdBQUcsQ0FBQyxDQUFBO0FBRTdDLHFEQUFxRDtBQUNyRCxNQUFNLDJCQUEyQixHQUFHLE1BQU0sQ0FBQTtBQUUxQzs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sNkJBQTZCO0lBQ2hEOzs7Ozs7Ozs7OztPQVdHO0lBQ0gsWUFBWSxFQUFDLFNBQVMsR0FBRyxFQUFFLEVBQUUsYUFBYSxHQUFHLG9CQUFvQixFQUFFLGdCQUFnQixHQUFHLElBQUksRUFBRSxPQUFPLEdBQUcsTUFBTSxFQUFFLE9BQU8sRUFBRSxpQkFBaUIsR0FBRyxJQUFJLEVBQUUsR0FBRyxFQUFDO1FBQ25KLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFBO1FBQ2QsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7UUFDMUIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxpQkFBaUIsQ0FBQTtRQUMxQyww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QUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsb0JBQW9CLENBQUMsRUFBQyxHQUFHLEVBQUM7SUFDakMsK0VBQStFO0lBQy9FLHFEQUFxRDtJQUNyRCxNQUFNLHVCQUF1QixHQUFHLDBDQUEwQyxDQUFDLEVBQUMsc0JBQXVCLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtJQUUvRyxPQUFPLG1DQUFtQyxDQUFDLEVBQUMsc0JBQXVCLENBQUMsSUFBSSx3QkFBd0IsQ0FBQztRQUMvRixtQkFBbUIsRUFBRSxNQUFNO1FBQzNCLEdBQUc7UUFDSCx1QkFBdUI7S0FDeEIsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUNOLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFdlYlNvY2tldCBmcm9tIFwid3NcIlxuXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IGZyb20gXCIuLi9odHRwLWNsaWVudC93ZWJzb2NrZXQtY2xpZW50LmpzXCJcbmltcG9ydCB7QWR2aXNvcnlMb2NrU2VydmljZVVuYXZhaWxhYmxlRXJyb3J9IGZyb20gXCIuL2Fkdmlzb3J5LWxvY2stZXJyb3JzLmpzXCJcblxuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMb2NrU2VydmVyQ29ubmVjdGlvbkxpa2VcbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gcmVhZHkgLSBSZXNvbHZlcyB3aGVuIHRoZSBzZXJ2ZXIgYWNjZXB0ZWQgdGhlIDE6MSBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHsoYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWR9IHNlbmRNZXNzYWdlIC0gU2VuZHMgb25lIGNvbm5lY3Rpb24gbWVzc2FnZS5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gdm9pZH0gW2Nsb3NlXSAtIENsb3NlcyB0aGUgY29ubmVjdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2tTZXJ2ZXJDbGllbnRMaWtlXG4gKiBAcHJvcGVydHkgeygpID0+IFByb21pc2U8dm9pZD59IGNvbm5lY3QgLSBPcGVucyB0aGUgdHJhbnNwb3J0LlxuICogQHByb3BlcnR5IHsodHlwZTogc3RyaW5nLCBhcmdzOiB7b25NZXNzYWdlOiAoYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQsIHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHRpbWVvdXRNczogbnVtYmVyfSkgPT4gTG9ja1NlcnZlckNvbm5lY3Rpb25MaWtlfSBvcGVuQ29ubmVjdGlvbiAtIE9wZW5zIHRoZSAxOjEgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IFtjbG9zZV0gLSBDbG9zZXMgdGhlIHRyYW5zcG9ydC5cbiAqIEB0eXBlZGVmIHt7ZXBvY2g6IG51bWJlciwgbmFtZTogc3RyaW5nLCB0aW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+LCBsZWFzZUV4cGlyZXNBdDogbnVtYmVyfX0gTG9ja1NlcnZlckhvbGRcbiAqIEB0eXBlZGVmIHt7c3RhdHVzOiBcImFjcXVpcmVkXCIsIGVwb2NoOiBudW1iZXIsIGxlYXNlRXhwaXJlc0F0OiBudW1iZXJ9IHwge3N0YXR1czogXCJidXN5XCJ9IHwge3N0YXR1czogXCJ0aW1lb3V0XCJ9fSBMb2NrU2VydmVyQWNxdWlyZVJlc3VsdFxuICovXG5cbi8qKiBQcm90b2NvbCB2ZXJzaW9uIHNwb2tlbiBieSB0aGUgY2VudHJhbGl6ZWQgbG9jayBzZXJ2ZXIgKGNvbnNlbnMtbG9jayB2MikuICovXG5leHBvcnQgY29uc3QgTE9DS19TRVJWRVJfUFJPVE9DT0xfVkVSU0lPTiA9IDJcblxuLyoqIENvbm5lY3Rpb24gcm9sZSByZWdpc3RlcmVkIG9uIHRoZSBsb2NrIHNlcnZlci4gKi9cbmNvbnN0IExPQ0tfU0VSVkVSX0NPTk5FQ1RJT05fVFlQRSA9IFwibG9ja1wiXG5cbi8qKlxuICogVGllciAoYikgYmFja2VuZDogdGhlIGNlbnRyYWxpemVkIGxvY2sgc2VydmVyIChgY29uc2Vucy1sb2NrYCwgcHJvdG9jb2wgdjIpLlxuICpcbiAqIFRoZSBzZXJ2ZXIgaG9sZHMgZXZlcnkgbG9jayBpbiBpdHMgb3duIHByb2Nlc3MgbWVtb3J5LCBzbyBhIGhlbGQgbG9jayBuZXZlclxuICogcGlucyBhIGRhdGFiYXNlIGNvbm5lY3Rpb24g4oCUIHRoYXQgaXMgdGhlIHdob2xlIHBvaW50IG9mIHRoaXMgdGllci4gT3duZXJzaGlwXG4gKiBpcyBib3VuZCB0byB0aGlzIHByb2Nlc3MncyBjb25uZWN0aW9uOiB0aGUgc2VydmVyIG1pbnRzIHRoZSBgaG9sZGVySWRgLCBzbyBhXG4gKiBjbGllbnQgY2FuIG9ubHkgcmVuZXcgb3IgcmVsZWFzZSBpdHMgb3duIGxlYXNlcywgYW5kIGEgZHJvcHBlZCBjb25uZWN0aW9uXG4gKiByZWxlYXNlcyBhbGwgb2YgdGhlbSBpbW1lZGlhdGVseS5cbiAqXG4gKiBIb2xkcyBhcmUgbGVhc2VzIHJlbmV3ZWQgZXZlcnkgdGhpcmQgb2YgdGhlIGxlYXNlIHdpbmRvdy4gQSBmZW5jZWQgbGVhc2VcbiAqICh0aGUgc2VydmVyIGdyYW50ZWQgdGhlIG5hbWUgdG8gYW5vdGhlciBob2xkZXIgYWZ0ZXIgYW4gZXhwaXJ5IG9yIHBhcnRpdGlvbilcbiAqIGlzIHJlY29yZGVkIHBlciBsb2NrIG5hbWUgYW5kIHN1cmZhY2VkIGJ5IHRoZSBydW5uZXIgYXNcbiAqIGBBZHZpc29yeUxvY2tMb3N0RXJyb3JgIGFmdGVyIHRoZSBjcml0aWNhbCBzZWN0aW9uIHNldHRsZXMuXG4gKlxuICogVW5hdmFpbGFiaWxpdHkgaXMgY2FjaGVkIGZvciBgcmVwcm9iZUNvb2xkb3duTXNgIHNvIGEgZmxhcHBpbmcgc2VydmVyIGNhbm5vdFxuICogdHVybiBldmVyeSB3YWl0aW5nIGNhbGxlciBpbnRvIGEgY29ubmVjdGlvbiBhdHRlbXB0IChkZXNpZ24gwqcyKS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQWR2aXNvcnlMb2NrTG9ja1NlcnZlckJhY2tlbmQge1xuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgbG9jay1zZXJ2ZXIgYmFja2VuZC4gVGhlIHRyYW5zcG9ydCBpcyBjcmVhdGVkIG9uIGZpcnN0IHVzZSwgc29cbiAgICogY29uc3RydWN0aW5nIHRoaXMgb2JqZWN0IG5ldmVyIHBlcmZvcm1zIEkvTy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBCYWNrZW5kIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5hdXRoVG9rZW5dIC0gU2hhcmVkIHNlY3JldDsgdGhlIHNlcnZlciBmYWlscyBjbG9zZWQgd2l0aG91dCBhIG1hdGNoaW5nIHRva2VuLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7YXV0aFRva2VuOiBzdHJpbmcsIHVybDogc3RyaW5nfSkgPT4gTG9ja1NlcnZlckNsaWVudExpa2V9IFthcmdzLmNsaWVudEZhY3RvcnldIC0gVHJhbnNwb3J0IGZhY3RvcnkgKHRlc3RzIGluamVjdCBhIGZha2UpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuY29ubmVjdFRpbWVvdXRNc10gLSBIYW5kc2hha2UgdGltZW91dC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmxlYXNlTXNdIC0gTGVhc2UgZHVyYXRpb24gdXNlZCB1bnRpbCB0aGUgc2VydmVyIGFkdmVydGlzZXMgaXRzIG93bi5cbiAgICogQHBhcmFtIHsoZXJyb3I6IEVycm9yKSA9PiB2b2lkfSBbYXJncy5vbkVycm9yXSAtIEFzeW5jIGVycm9yIHJlcG9ydGVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVwcm9iZUNvb2xkb3duTXNdIC0gSG93IGxvbmcgYW4gdW5hdmFpbGFibGUgc2VydmVyIGlzIG5vdCByZS1wcm9iZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnVybCAtIExvY2stc2VydmVyIHdlYnNvY2tldCBVUkwuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YXV0aFRva2VuID0gXCJcIiwgY2xpZW50RmFjdG9yeSA9IGRlZmF1bHRDbGllbnRGYWN0b3J5LCBjb25uZWN0VGltZW91dE1zID0gMzAwMCwgbGVhc2VNcyA9IDMwXzAwMCwgb25FcnJvciwgcmVwcm9iZUNvb2xkb3duTXMgPSA1MDAwLCB1cmx9KSB7XG4gICAgdGhpcy51cmwgPSB1cmxcbiAgICB0aGlzLmF1dGhUb2tlbiA9IGF1dGhUb2tlblxuICAgIHRoaXMuY2xpZW50RmFjdG9yeSA9IGNsaWVudEZhY3RvcnlcbiAgICB0aGlzLmNvbm5lY3RUaW1lb3V0TXMgPSBjb25uZWN0VGltZW91dE1zXG4gICAgdGhpcy5sZWFzZU1zID0gbGVhc2VNc1xuICAgIHRoaXMub25FcnJvciA9IG9uRXJyb3JcbiAgICB0aGlzLnJlcHJvYmVDb29sZG93bk1zID0gcmVwcm9iZUNvb2xkb3duTXNcbiAgICAvKiogQHR5cGUge0xvY2tTZXJ2ZXJDbGllbnRMaWtlIHwgbnVsbH0gKi9cbiAgICB0aGlzLmNsaWVudCA9IG51bGxcbiAgICAvKiogQHR5cGUge0xvY2tTZXJ2ZXJDb25uZWN0aW9uTGlrZSB8IG51bGx9ICovXG4gICAgdGhpcy5jb25uZWN0aW9uID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5jb25uZWN0UHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge3tyZWplY3Q6IChlcnJvcjogRXJyb3IpID0+IHZvaWQsIHJlc29sdmU6ICgpID0+IHZvaWQsIHRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IHwgbnVsbH0gKi9cbiAgICB0aGlzLmhlbGxvV2FpdGVyID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywge2Vwb2NoOiBudW1iZXIsIG5hbWU6IHN0cmluZywgdGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiwgbGVhc2VFeHBpcmVzQXQ6IG51bWJlcn0+fSAqL1xuICAgIHRoaXMuaG9sZHMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHtjdXJyZW50RXBvY2g6IG51bWJlciB8IG51bGwsIGVwb2NoOiBudW1iZXIgfCBudWxsfT59ICovXG4gICAgdGhpcy5mZW5jZWRIb2xkcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywge3JlamVjdDogKGVycm9yOiBFcnJvcikgPT4gdm9pZCwgcmVzb2x2ZTogKG1lc3NhZ2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkLCB0aW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfT59ICovXG4gICAgdGhpcy5wZW5kaW5nID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHt7bGFzdEVycm9yOiBzdHJpbmcgfCBudWxsLCBsYXN0UHJvYmVBdDogc3RyaW5nIHwgbnVsbCwgdW5hdmFpbGFibGVVbnRpbDogbnVtYmVyfX0gKi9cbiAgICB0aGlzLnN0YXR1cyA9IHtsYXN0RXJyb3I6IG51bGwsIGxhc3RQcm9iZUF0OiBudWxsLCB1bmF2YWlsYWJsZVVudGlsOiAwfVxuICAgIHRoaXMucmVxdWVzdENvdW50ZXIgPSAwXG4gICAgdGhpcy5jbG9zZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIE9wZW5zIHRoZSBjb25uZWN0aW9uIGlmIG5lZWRlZCwgaG9ub3JpbmcgdGhlIHJlLXByb2JlIGNvb2xkb3duLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9ja05hbWUgLSBMb2NrIG5hbWUsIGZvciBlcnJvciBtZXNzYWdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb25uZWN0ZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDb25uZWN0ZWQobG9ja05hbWUpIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHRocm93IG5ldyBBZHZpc29yeUxvY2tTZXJ2aWNlVW5hdmFpbGFibGVFcnJvcihcIkxvY2sgc2VydmVyIGJhY2tlbmQgaXMgY2xvc2VkXCIsIHtsb2NrTmFtZSwgcmVhc29uOiBcImNsb3NlZFwifSlcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uKSByZXR1cm5cbiAgICBpZiAodGhpcy5jb25uZWN0UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuY29ubmVjdFByb21pc2VcblxuICAgIGlmIChEYXRlLm5vdygpIDwgdGhpcy5zdGF0dXMudW5hdmFpbGFibGVVbnRpbCkge1xuICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja1NlcnZpY2VVbmF2YWlsYWJsZUVycm9yKFxuICAgICAgICBgTG9jayBzZXJ2ZXIgJHt0aGlzLnVybH0gaXMgbWFya2VkIHVuYXZhaWxhYmxlOiAke1N0cmluZyh0aGlzLnN0YXR1cy5sYXN0RXJyb3IpfWAsXG4gICAgICAgIHtsb2NrTmFtZSwgcmVhc29uOiBcImNvb2xkb3duXCJ9XG4gICAgICApXG4gICAgfVxuXG4gICAgdGhpcy5jb25uZWN0UHJvbWlzZSA9IHRoaXMub3BlbkNvbm5lY3Rpb24obG9ja05hbWUpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmNvbm5lY3RQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPcGVucyB0aGUgdHJhbnNwb3J0IGFuZCBjb21wbGV0ZXMgdGhlIGhlbGxvIGhhbmRzaGFrZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tOYW1lIC0gTG9jayBuYW1lLCBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhhbmRzaGFrZSBjb21wbGV0ZWQuXG4gICAqL1xuICBhc3luYyBvcGVuQ29ubmVjdGlvbihsb2NrTmFtZSkge1xuICAgIHRoaXMuc3RhdHVzLmxhc3RQcm9iZUF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnRGYWN0b3J5KHthdXRoVG9rZW46IHRoaXMuYXV0aFRva2VuLCB1cmw6IHRoaXMudXJsfSlcblxuICAgICAgdGhpcy5jbGllbnQgPSBjbGllbnRcbiAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KClcblxuICAgICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgICAgY29uc3QgaGVsbG9Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgIHJlamVjdChuZXcgQWR2aXNvcnlMb2NrU2VydmljZVVuYXZhaWxhYmxlRXJyb3IoXG4gICAgICAgICAgICBgTG9jayBzZXJ2ZXIgJHt0aGlzLnVybH0gZGlkIG5vdCBhbnN3ZXIgdGhlIGhhbmRzaGFrZSB3aXRoaW4gJHt0aGlzLmNvbm5lY3RUaW1lb3V0TXN9bXNgLFxuICAgICAgICAgICAge2xvY2tOYW1lLCByZWFzb246IFwiaGFuZHNoYWtlLXRpbWVvdXRcIn1cbiAgICAgICAgICApKVxuICAgICAgICB9LCB0aGlzLmNvbm5lY3RUaW1lb3V0TXMpXG5cbiAgICAgICAgdGltZXIudW5yZWY/LigpXG4gICAgICAgIHRoaXMuaGVsbG9XYWl0ZXIgPSB7cmVqZWN0LCByZXNvbHZlLCB0aW1lcn1cbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBjbGllbnQub3BlbkNvbm5lY3Rpb24oTE9DS19TRVJWRVJfQ09OTkVDVElPTl9UWVBFLCB7XG4gICAgICAgIG9uTWVzc2FnZTogKGJvZHkpID0+IHRoaXMuaGFuZGxlTWVzc2FnZShib2R5KSxcbiAgICAgICAgcGFyYW1zOiB7YXV0aFRva2VuOiB0aGlzLmF1dGhUb2tlbiwgcHJvdG9jb2xWZXJzaW9uOiBMT0NLX1NFUlZFUl9QUk9UT0NPTF9WRVJTSU9OfSxcbiAgICAgICAgdGltZW91dE1zOiB0aGlzLmNvbm5lY3RUaW1lb3V0TXNcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuY29ubmVjdGlvbiA9IGNvbm5lY3Rpb25cbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVhZHlcbiAgICAgIGF3YWl0IGhlbGxvUHJvbWlzZVxuXG4gICAgICB0aGlzLnN0YXR1cy5sYXN0RXJyb3IgPSBudWxsXG4gICAgICB0aGlzLnN0YXR1cy51bmF2YWlsYWJsZVVudGlsID0gMFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIHRoaXMubWFya1VuYXZhaWxhYmxlKG5vcm1hbGl6ZWQpXG4gICAgICB0aGlzLnRlYXJkb3duKClcblxuICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja1NlcnZpY2VVbmF2YWlsYWJsZUVycm9yKFxuICAgICAgICBgTG9jayBzZXJ2ZXIgJHt0aGlzLnVybH0gaXMgdW5hdmFpbGFibGU6ICR7bm9ybWFsaXplZC5tZXNzYWdlfWAsXG4gICAgICAgIHtsb2NrTmFtZSwgcmVhc29uOiBcImNvbm5lY3QtZmFpbGVkXCJ9XG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhIGxvY2sgdGhyb3VnaCB0aGUgc2VydmVyJ3MgRklGTyBxdWV1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBCb3VuZGVkIHdhaXQ7IHRoZSBzZXJ2ZXIgZGVmYXVsdHMgdG8gMzBzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIHdoZW4gdGhlIGxlYXNlIHdhcyBncmFudGVkLCBmYWxzZSBvbiB0aW1lb3V0LlxuICAgKi9cbiAgYXN5bmMgYWNxdWlyZShuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVDb25uZWN0ZWQobmFtZSlcblxuICAgIC8qKiBAdHlwZSB7TG9ja1NlcnZlckFjcXVpcmVSZXN1bHR9ICovXG4gICAgY29uc3QgcmVzdWx0ID0gLyoqIEB0eXBlIHtMb2NrU2VydmVyQWNxdWlyZVJlc3VsdH0gKi8gKGF3YWl0IHRoaXMucmVxdWVzdChcImFjcXVpcmVcIiwge1xuICAgICAgbmFtZSxcbiAgICAgIHRpbWVvdXRNczogdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPiAwID8gdGltZW91dE1zIDogdW5kZWZpbmVkXG4gICAgfSwgdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiA/IHRpbWVvdXRNcyArIHRoaXMuY29ubmVjdFRpbWVvdXRNcyA6IG51bGwpKVxuXG4gICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09IFwiYWNxdWlyZWRcIikge1xuICAgICAgdGhpcy5zdGFydFJlbmV3YWwobmFtZSwgcmVzdWx0LmVwb2NoKVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSBcImJ1c3lcIikgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBUYWtlcyBhIGxvY2sgb25seSBpZiB0aGUgc2VydmVyIGdyYW50cyBpdCBpbW1lZGlhdGVseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgd2hlbiBncmFudGVkLlxuICAgKi9cbiAgYXN5bmMgdHJ5QWNxdWlyZShuYW1lKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVDb25uZWN0ZWQobmFtZSlcblxuICAgIC8qKiBAdHlwZSB7TG9ja1NlcnZlckFjcXVpcmVSZXN1bHR9ICovXG4gICAgY29uc3QgcmVzdWx0ID0gLyoqIEB0eXBlIHtMb2NrU2VydmVyQWNxdWlyZVJlc3VsdH0gKi8gKGF3YWl0IHRoaXMucmVxdWVzdChcInRyeS1hY3F1aXJlXCIsIHtuYW1lfSkpXG5cbiAgICBpZiAocmVzdWx0LnN0YXR1cyAhPT0gXCJhY3F1aXJlZFwiKSByZXR1cm4gZmFsc2VcblxuICAgIHRoaXMuc3RhcnRSZW5ld2FsKG5hbWUsIHJlc3VsdC5lcG9jaClcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBoZWxkIGxlYXNlIGFuZCBzdG9wcyBpdHMgcmVuZXdhbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVsZWFzZWQgKG9yIHdoZW4gdGhlIHRyYW5zcG9ydCBpcyBnb25lKS5cbiAgICovXG4gIGFzeW5jIHJlbGVhc2UobmFtZSkge1xuICAgIGNvbnN0IGhvbGQgPSB0aGlzLmhvbGRzLmdldChuYW1lKVxuXG4gICAgaWYgKCFob2xkKSByZXR1cm5cblxuICAgIHRoaXMuaG9sZHMuZGVsZXRlKG5hbWUpXG4gICAgY2xlYXJJbnRlcnZhbChob2xkLnRpbWVyKVxuXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucmVxdWVzdChcInJlbGVhc2VcIiwge2Vwb2NoOiBob2xkLmVwb2NoLCBuYW1lfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBBZHZpc29yeUxvY2tTZXJ2aWNlVW5hdmFpbGFibGVFcnJvcikpIHRocm93IGVycm9yXG4gICAgICAvLyBUaGUgc2VydmVyIHJlbGVhc2VzIGV2ZXJ5IGxlYXNlIG9mIGEgY2xvc2VkIGNvbm5lY3Rpb24sIGFuZCB0aGUgbGVhc2VcbiAgICAgIC8vIGV4cGlyZXMgb3RoZXJ3aXNlOyBib3RoIHBhdGhzIHJlY2xhaW0gdGhlIG5hbWUuXG4gICAgICB0aGlzLnJlcG9ydEVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBldmVyeSBsZWFzZSB0aGlzIHByb2Nlc3MgaG9sZHMgKHNodXRkb3duIHBhdGgpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IGxlYXNlIHdhcyByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIHJlbGVhc2VBbGxIZWxkKCkge1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBbLi4udGhpcy5ob2xkcy5rZXlzKCldKSBhd2FpdCB0aGlzLnJlbGVhc2UobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBzZXJ2ZXIncyBsaXZlIGhvbGRlciBsaXN0IChkaWFnbm9zdGljcykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHVua25vd24+W10+fSAtIExpdmUgaG9sZGVycy5cbiAgICovXG4gIGFzeW5jIGxpc3QoKSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnJlcXVlc3QoXCJsaXN0XCIsIHt9KVxuICAgIGNvbnN0IGhvbGRlcnMgPSByZXNwb25zZS5ob2xkZXJzXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdfSAqLyAoQXJyYXkuaXNBcnJheShob2xkZXJzKSA/IGhvbGRlcnMgOiBbXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoby1ob2xkcyBmb3Igb25lIG5hbWUgKGRpYWdub3N0aWNzKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbD59IC0gSG9sZGVyLCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgd2hvSG9sZHMobmFtZSkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5yZXF1ZXN0KFwid2hvLWhvbGRzXCIsIHtuYW1lfSlcbiAgICBjb25zdCBob2xkZXIgPSByZXNwb25zZS5ob2xkZXJcblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbH0gKi8gKGhvbGRlciAmJiB0eXBlb2YgaG9sZGVyID09PSBcIm9iamVjdFwiID8gaG9sZGVyIDogbnVsbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBmZW5jaW5nIGVwb2NoIGdyYW50ZWQgZm9yIG9uZSBoZWxkIGxlYXNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gR3JhbnRlZCBlcG9jaCwgb3IgbnVsbCB3aGVuIHRoZSBsZWFzZSBpcyBub3QgKG9yIG5vIGxvbmdlcikgaGVsZC5cbiAgICovXG4gIGdldEhvbGRFcG9jaChuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuaG9sZHMuZ2V0KG5hbWUpPy5lcG9jaCA/PyBudWxsXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIGhvbGQgd2FzIGZlbmNlZCBvciBsb3N0IGR1cmluZyBpdHMgY3JpdGljYWwgc2VjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gZXBvY2ggLSBFcG9jaCB0aGUgaG9sZCB3YXMgZ3JhbnRlZC5cbiAgICogQHJldHVybnMge3tjdXJyZW50RXBvY2g6IG51bWJlciB8IG51bGwsIGVwb2NoOiBudW1iZXIgfCBudWxsfSB8IG51bGx9IC0gRmVuY2luZyBkZXRhaWxzIHdoZW4gbG9zdC5cbiAgICovXG4gIHRha2VMb3NzKG5hbWUsIGVwb2NoKSB7XG4gICAgY29uc3QgbG9zcyA9IHRoaXMuZmVuY2VkSG9sZHMuZ2V0KG5hbWUpXG5cbiAgICBpZiAobG9zcykge1xuICAgICAgdGhpcy5mZW5jZWRIb2xkcy5kZWxldGUobmFtZSlcblxuICAgICAgcmV0dXJuIGxvc3NcbiAgICB9XG5cbiAgICBjb25zdCBob2xkID0gdGhpcy5ob2xkcy5nZXQobmFtZSlcblxuICAgIGlmIChob2xkICYmIGhvbGQuZXBvY2ggIT09IGVwb2NoKSByZXR1cm4ge2N1cnJlbnRFcG9jaDogaG9sZC5lcG9jaCwgZXBvY2h9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgY29ubmVjdGlvbiBzdGF0ZSBhbmQgdGhlIG5hbWVzIGN1cnJlbnRseSBsZWFzZWQgdGhyb3VnaCB0aGlzXG4gICAqIHByb2Nlc3MsIGZvciBgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cygpYC5cbiAgICogQHJldHVybnMge3tjb25uZWN0ZWQ6IGJvb2xlYW4sIGxhc3RFcnJvcjogc3RyaW5nIHwgbnVsbCwgbGFzdFByb2JlQXQ6IHN0cmluZyB8IG51bGwsIGxlYXNlZE5hbWVzOiBzdHJpbmdbXX19IC0gQmFja2VuZCBzdGF0dXMgZm9yIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgZ2V0U3RhdHVzKCkge1xuICAgIHJldHVybiB7XG4gICAgICBjb25uZWN0ZWQ6IEJvb2xlYW4odGhpcy5jb25uZWN0aW9uKSxcbiAgICAgIGxhc3RFcnJvcjogdGhpcy5zdGF0dXMubGFzdEVycm9yLFxuICAgICAgbGFzdFByb2JlQXQ6IHRoaXMuc3RhdHVzLmxhc3RQcm9iZUF0LFxuICAgICAgbGVhc2VkTmFtZXM6IFsuLi50aGlzLmhvbGRzLmtleXMoKV1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoZSBiYWNrZW5kOiBleHBsaWNpdCByZWxlYXNlIGZpcnN0LCB0aGVuIHRoZSB0cmFuc3BvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgY2xvc2UoKSB7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlXG4gICAgYXdhaXQgdGhpcy5yZWxlYXNlQWxsSGVsZCgpXG5cbiAgICB0aGlzLnRlYXJkb3duKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwYXRjaGVzIG9uZSBzZXJ2ZXIgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gYm9keSAtIFNlcnZlciBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGhhbmRsZU1lc3NhZ2UoYm9keSkge1xuICAgIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBpZiAoYm9keS50eXBlID09PSBcImhlbGxvLWFja1wiKSB7XG4gICAgICBjb25zdCBhZHZlcnRpc2VkTGVhc2VNcyA9IE51bWJlcihib2R5LmxlYXNlTXMpXG5cbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUoYWR2ZXJ0aXNlZExlYXNlTXMpICYmIGFkdmVydGlzZWRMZWFzZU1zID4gMCkgdGhpcy5sZWFzZU1zID0gYWR2ZXJ0aXNlZExlYXNlTXNcblxuICAgICAgY29uc3QgaGVsbG9XYWl0ZXIgPSB0aGlzLmhlbGxvV2FpdGVyXG5cbiAgICAgIHRoaXMuaGVsbG9XYWl0ZXIgPSBudWxsXG4gICAgICBpZiAoaGVsbG9XYWl0ZXIpIHtcbiAgICAgICAgaWYgKGhlbGxvV2FpdGVyLnRpbWVyKSBjbGVhclRpbWVvdXQoaGVsbG9XYWl0ZXIudGltZXIpXG4gICAgICAgIGhlbGxvV2FpdGVyLnJlc29sdmUoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYm9keS50eXBlID09PSBcImxvc3RcIikge1xuICAgICAgY29uc3QgbmFtZSA9IFN0cmluZyhib2R5Lm5hbWUgPz8gXCJcIilcbiAgICAgIGNvbnN0IGhvbGQgPSB0aGlzLmhvbGRzLmdldChuYW1lKVxuXG4gICAgICBpZiAoIWhvbGQpIHJldHVyblxuXG4gICAgICB0aGlzLmhvbGRzLmRlbGV0ZShuYW1lKVxuICAgICAgY2xlYXJJbnRlcnZhbChob2xkLnRpbWVyKVxuICAgICAgdGhpcy5mZW5jZWRIb2xkcy5zZXQobmFtZSwge2N1cnJlbnRFcG9jaDogTnVtYmVyKGJvZHkuZXBvY2ggPz8gMCksIGVwb2NoOiBob2xkLmVwb2NofSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGJvZHkudHlwZSAhPT0gXCJyZXNwb25zZVwiIHx8IHR5cGVvZiBib2R5LmNvcnJlbGF0aW9uSWQgIT09IFwic3RyaW5nXCIpIHJldHVyblxuXG4gICAgY29uc3QgcGVuZGluZyA9IHRoaXMucGVuZGluZy5nZXQoYm9keS5jb3JyZWxhdGlvbklkKVxuXG4gICAgaWYgKCFwZW5kaW5nKSByZXR1cm5cblxuICAgIHRoaXMucGVuZGluZy5kZWxldGUoYm9keS5jb3JyZWxhdGlvbklkKVxuICAgIGlmIChwZW5kaW5nLnRpbWVyKSBjbGVhclRpbWVvdXQocGVuZGluZy50aW1lcilcblxuICAgIGlmIChib2R5LnN0YXR1cyA9PT0gXCJlcnJvclwiKSB7XG4gICAgICBwZW5kaW5nLnJlamVjdChuZXcgRXJyb3IoU3RyaW5nKGJvZHkuZXJyb3IgfHwgXCJMb2NrIHNlcnZlciBlcnJvclwiKSkpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHBlbmRpbmcucmVzb2x2ZShib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIG9uZSByZXF1ZXN0IGFuZCBhd2FpdHMgaXRzIGNvcnJlbGF0ZWQgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gUmVxdWVzdCB0eXBlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBwYXlsb2FkIC0gUmVxdWVzdCBmaWVsZHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW3RpbWVvdXRNc10gLSBSZXNwb25zZSB0aW1lb3V0OyBudWxsIHdhaXRzIGZvciB0aGUgc2VydmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj59IC0gUmVzcG9uc2UgYm9keS5cbiAgICovXG4gIGFzeW5jIHJlcXVlc3QodHlwZSwgcGF5bG9hZCwgdGltZW91dE1zID0gbnVsbCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25cblxuICAgIGlmICghY29ubmVjdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja1NlcnZpY2VVbmF2YWlsYWJsZUVycm9yKFwiTG9jayBzZXJ2ZXIgY29ubmVjdGlvbiBpcyBub3Qgb3BlblwiLCB7bG9ja05hbWU6IFN0cmluZyhwYXlsb2FkLm5hbWUgPz8gXCJcIiksIHJlYXNvbjogXCJub3QtY29ubmVjdGVkXCJ9KVxuICAgIH1cblxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBgcmVxLSR7Kyt0aGlzLnJlcXVlc3RDb3VudGVyfWBcblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCB0aW1lciA9IHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMFxuICAgICAgICA/IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgIHRoaXMucGVuZGluZy5kZWxldGUoY29ycmVsYXRpb25JZClcbiAgICAgICAgICByZWplY3QobmV3IEFkdmlzb3J5TG9ja1NlcnZpY2VVbmF2YWlsYWJsZUVycm9yKFxuICAgICAgICAgICAgYExvY2sgc2VydmVyIHJlcXVlc3QgdGltZWQgb3V0OiAke3R5cGV9ICR7U3RyaW5nKHBheWxvYWQubmFtZSA/PyBcIlwiKX1gLFxuICAgICAgICAgICAge2xvY2tOYW1lOiBTdHJpbmcocGF5bG9hZC5uYW1lID8/IFwiXCIpLCByZWFzb246IFwicmVxdWVzdC10aW1lb3V0XCJ9XG4gICAgICAgICAgKSlcbiAgICAgICAgfSwgdGltZW91dE1zKVxuICAgICAgICA6IG51bGxcblxuICAgICAgdGltZXI/LnVucmVmPy4oKVxuICAgICAgdGhpcy5wZW5kaW5nLnNldChjb3JyZWxhdGlvbklkLCB7cmVqZWN0LCByZXNvbHZlLCB0aW1lcn0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZE1lc3NhZ2Uoey4uLnBheWxvYWQsIGNvcnJlbGF0aW9uSWQsIHR5cGV9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nLmRlbGV0ZShjb3JyZWxhdGlvbklkKVxuICAgICAgICBpZiAodGltZXIpIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICAgICAgdGhpcy5tYXJrVW5hdmFpbGFibGUoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgICByZWplY3QobmV3IEFkdmlzb3J5TG9ja1NlcnZpY2VVbmF2YWlsYWJsZUVycm9yKFxuICAgICAgICAgIGBMb2NrIHNlcnZlciBzZW5kIGZhaWxlZDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICB7bG9ja05hbWU6IFN0cmluZyhwYXlsb2FkLm5hbWUgPz8gXCJcIiksIHJlYXNvbjogXCJzZW5kLWZhaWxlZFwifVxuICAgICAgICApKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIGxlYXNlIHJlbmV3YWwgZm9yIGEgZ3JhbnRlZCBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGVwb2NoIC0gR3JhbnRlZCBlcG9jaC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGFydFJlbmV3YWwobmFtZSwgZXBvY2gpIHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaG9sZHMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoZXhpc3RpbmcpIGNsZWFySW50ZXJ2YWwoZXhpc3RpbmcudGltZXIpXG5cbiAgICBjb25zdCBpbnRlcnZhbE1zID0gTWF0aC5tYXgoMjUwLCBNYXRoLmZsb29yKHRoaXMubGVhc2VNcyAvIDMpKVxuICAgIGNvbnN0IHRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgdm9pZCB0aGlzLnJlbmV3KG5hbWUsIGVwb2NoKVxuICAgIH0sIGludGVydmFsTXMpXG5cbiAgICB0aW1lci51bnJlZj8uKClcbiAgICB0aGlzLmhvbGRzLnNldChuYW1lLCB7ZXBvY2gsIGxlYXNlRXhwaXJlc0F0OiBEYXRlLm5vdygpICsgdGhpcy5sZWFzZU1zLCBuYW1lLCB0aW1lcn0pXG4gIH1cblxuICAvKipcbiAgICogUmVuZXdzIG9uZSBsZWFzZTsgYSBmZW5jZWQgbGVhc2UgaXMgcmVjb3JkZWQgZm9yIHRoZSBydW5uZXIgdG8gc3VyZmFjZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBlcG9jaCAtIEVwb2NoIHRoZSBob2xkIGJlbGlldmVzIGl0IG93bnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZW5ld2FsIHJvdW5kLXRyaXAuXG4gICAqL1xuICBhc3luYyByZW5ldyhuYW1lLCBlcG9jaCkge1xuICAgIGNvbnN0IGhvbGQgPSB0aGlzLmhvbGRzLmdldChuYW1lKVxuXG4gICAgaWYgKCFob2xkIHx8ICF0aGlzLmNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5yZXF1ZXN0KFwicmVuZXdcIiwge2Vwb2NoLCBuYW1lfSwgdGhpcy5jb25uZWN0VGltZW91dE1zICogMilcbiAgICAgIGNvbnN0IHN0YXR1cyA9IFN0cmluZyhyZXNwb25zZS5zdGF0dXMpXG5cbiAgICAgIGlmIChzdGF0dXMgPT09IFwicmVuZXdlZFwiKSB7XG4gICAgICAgIGhvbGQubGVhc2VFeHBpcmVzQXQgPSBOdW1iZXIocmVzcG9uc2UubGVhc2VFeHBpcmVzQXQpXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChzdGF0dXMgPT09IFwibG9zdFwiIHx8IHN0YXR1cyA9PT0gXCJub3QtZm91bmRcIikge1xuICAgICAgICB0aGlzLmhvbGRzLmRlbGV0ZShuYW1lKVxuICAgICAgICBjbGVhckludGVydmFsKGhvbGQudGltZXIpXG4gICAgICAgIHRoaXMuZmVuY2VkSG9sZHMuc2V0KG5hbWUsIHtjdXJyZW50RXBvY2g6IE51bWJlcihyZXNwb25zZS5jdXJyZW50RXBvY2ggPz8gMCksIGVwb2NofSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBBZHZpc29yeUxvY2tTZXJ2aWNlVW5hdmFpbGFibGVFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgIC8vIEEgbGVhc2UgdGhhdCBjYW5ub3QgYmUgcmVuZXdlZCBjYW4gbm8gbG9uZ2VyIGJlIHByb3ZlbiB0byBiZSBvdXJzOiB0aGVcbiAgICAgIC8vIHNlcnZlciBtYXkgaGF2ZSBmZW5jZWQgaXQgd2hpbGUgdGhlIHRyYW5zcG9ydCB3YXMgZmFpbGluZy4gUmVjb3JkaW5nIGl0XG4gICAgICAvLyBhcyBsb3N0IGlzIHRoZSBvbmx5IGhvbmVzdCBhbnN3ZXIsIGFuZCBzdG9wcyB0aGUgcmVuZXdhbCBsb29wLlxuICAgICAgdGhpcy5tYXJrVW5hdmFpbGFibGUoZXJyb3IpXG4gICAgICB0aGlzLmhvbGRzLmRlbGV0ZShuYW1lKVxuICAgICAgY2xlYXJJbnRlcnZhbChob2xkLnRpbWVyKVxuICAgICAgdGhpcy5mZW5jZWRIb2xkcy5zZXQobmFtZSwge2N1cnJlbnRFcG9jaDogbnVsbCwgZXBvY2h9KVxuICAgICAgdGhpcy5yZXBvcnRFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyB0aGF0IHRoZSBsb2NrIHNlcnZlciBpcyB1bnJlYWNoYWJsZSBhbmQgc3RhcnRzIHRoZSByZS1wcm9iZSBjb29sZG93bi5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBGYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG1hcmtVbmF2YWlsYWJsZShlcnJvcikge1xuICAgIHRoaXMuc3RhdHVzLmxhc3RFcnJvciA9IGVycm9yLm1lc3NhZ2VcbiAgICB0aGlzLnN0YXR1cy5sYXN0UHJvYmVBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIHRoaXMuc3RhdHVzLnVuYXZhaWxhYmxlVW50aWwgPSBEYXRlLm5vdygpICsgdGhpcy5yZXByb2JlQ29vbGRvd25Nc1xuICB9XG5cbiAgLyoqXG4gICAqIERyb3BzIHRyYW5zcG9ydCBzdGF0ZSBhbmQgbWFya3MgZXZlcnkgb3V0c3RhbmRpbmcgaG9sZCBsb3N0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHRlYXJkb3duKCkge1xuICAgIGZvciAoY29uc3QgW25hbWUsIGhvbGRdIG9mIHRoaXMuaG9sZHMpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwoaG9sZC50aW1lcilcbiAgICAgIHRoaXMuZmVuY2VkSG9sZHMuc2V0KG5hbWUsIHtjdXJyZW50RXBvY2g6IG51bGwsIGVwb2NoOiBob2xkLmVwb2NofSlcbiAgICB9XG5cbiAgICB0aGlzLmhvbGRzLmNsZWFyKClcblxuICAgIGZvciAoY29uc3QgcGVuZGluZyBvZiB0aGlzLnBlbmRpbmcudmFsdWVzKCkpIHtcbiAgICAgIGlmIChwZW5kaW5nLnRpbWVyKSBjbGVhclRpbWVvdXQocGVuZGluZy50aW1lcilcbiAgICAgIHBlbmRpbmcucmVqZWN0KG5ldyBBZHZpc29yeUxvY2tTZXJ2aWNlVW5hdmFpbGFibGVFcnJvcihcIkxvY2sgc2VydmVyIGNvbm5lY3Rpb24gZHJvcHBlZFwiLCB7bG9ja05hbWU6IFwiXCIsIHJlYXNvbjogXCJjb25uZWN0aW9uLWRyb3BwZWRcIn0pKVxuICAgIH1cblxuICAgIHRoaXMucGVuZGluZy5jbGVhcigpXG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9uXG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnRcblxuICAgIHRoaXMuY29ubmVjdGlvbiA9IG51bGxcbiAgICB0aGlzLmNsaWVudCA9IG51bGxcblxuICAgIHRyeSB7XG4gICAgICBjb25uZWN0aW9uPy5jbG9zZT8uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5yZXBvcnRFcnJvcihlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHZvaWQgY2xpZW50Py5jbG9zZT8uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5yZXBvcnRFcnJvcihlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSB0cmFuc3BvcnQtc2lkZSBmYWlsdXJlIHdpdGhvdXQgYnJlYWtpbmcgbG9jayBoYW5kbGluZy5cbiAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIEZhaWx1cmUgdG8gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlcG9ydEVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuXG4gICAgdGhpcy5zdGF0dXMubGFzdEVycm9yID0gbm9ybWFsaXplZC5tZXNzYWdlXG5cbiAgICBpZiAodGhpcy5vbkVycm9yKSB0aGlzLm9uRXJyb3Iobm9ybWFsaXplZClcbiAgfVxufVxuXG4vKipcbiAqIERlZmF1bHQgdHJhbnNwb3J0IGZhY3Rvcnk6IHRoZSBmcmFtZXdvcmsgd2Vic29ja2V0IGNsaWVudCB3aXRoIHRoZSBOb2RlXG4gKiBgd3NgIGltcGxlbWVudGF0aW9uIGJvdW5kIGV4cGxpY2l0bHkgKG5vIGdsb2JhbCBtdXRhdGlvbikuXG4gKiBAcGFyYW0ge3thdXRoVG9rZW46IHN0cmluZywgdXJsOiBzdHJpbmd9fSBhcmdzIC0gQ29ubmVjdGlvbiBhcmdzLlxuICogQHJldHVybnMge0xvY2tTZXJ2ZXJDbGllbnRMaWtlfSAtIFdlYnNvY2tldCBjbGllbnQuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRDbGllbnRGYWN0b3J5KHt1cmx9KSB7XG4gIC8vIE5vZGUncyBnbG9iYWwgV2ViU29ja2V0IGlzIG5vdCBndWFyYW50ZWVkIHRvIGV4aXN0LCBzbyB0aGUgaW1wbGVtZW50YXRpb24gaXNcbiAgLy8gYm91bmQgZXhwbGljaXRseSBpbnN0ZWFkIG9mIG11dGF0aW5nIGBnbG9iYWxUaGlzYC5cbiAgY29uc3Qgd2ViU29ja2V0SW1wbGVtZW50YXRpb24gPSAvKiogQHR5cGUge3R5cGVvZiBnbG9iYWxUaGlzLldlYlNvY2tldH0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKFdlYlNvY2tldCkpXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7TG9ja1NlcnZlckNsaWVudExpa2V9ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KHtcbiAgICBoZWFydGJlYXRJbnRlcnZhbE1zOiAxMF8wMDAsXG4gICAgdXJsLFxuICAgIHdlYlNvY2tldEltcGxlbWVudGF0aW9uXG4gIH0pKSlcbn1cbiJdfQ==