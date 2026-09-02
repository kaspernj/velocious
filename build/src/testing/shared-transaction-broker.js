// @ts-check
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { decodeBrokerValue, encodeBrokerValue } from "./shared-transaction-codec.js";
import { clearSharedTransactionCoordinator, setSharedTransactionCoordinator } from "./shared-transaction-connection-coordinator.js";
/** @typedef {{queue: Promise<void>, rootSessions: Set<import("ws").WebSocket>, lease?: {operations: Promise<void>, release: () => void, savePointName: string, socket: import("ws").WebSocket}}} ConnectionState */
const ALLOWED_METHODS = new Set([
    "query",
    "affectedRows",
    "_queryActual",
    "_affectedRowsActual",
    "_startTransactionAction",
    "_commitTransactionAction",
    "_rollbackTransactionAction",
    "startSavePoint",
    "releaseSavePoint",
    "rollbackSavePoint",
    "getConnectionScopedValue",
    "rootTransactionStart",
    "rootTransactionRelease",
    "rootTransactionRollback"
]);
/**
 * Compares a presented capability without leaking matching prefix timing.
 * @param {string} provided - Presented capability.
 * @param {string} expected - Active capability.
 * @returns {boolean} - Whether the capabilities match.
 */
function capabilityMatches(provided, expected) {
    const providedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}
/**
 * Adds broker ownership to decoded driver options.
 * @param {ReturnType<typeof JSON.parse>} value - Decoded options.
 * @param {symbol} operationOwner - Broker coordinator owner.
 * @returns {Record<string, ReturnType<typeof JSON.parse>> & {operationOwner: symbol}} - Owned options.
 */
function ownedOperationOptions(value, operationOwner) {
    if (value === undefined)
        return { operationOwner };
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Shared transaction broker driver options must be an object");
    }
    const options = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value);
    return { ...options, operationOwner };
}
export default class SharedTransactionBroker extends EventEmitter {
    /**
     * Creates a broker around parent-owned physical connections.
     * @param {{connections: Record<string, object>}} args - Parent-owned physical connections.
     */
    constructor({ connections }) {
        super();
        this.connections = connections;
        this.secret = randomBytes(32).toString("base64url");
        this.accepting = true;
        /** @type {Map<object, ConnectionState>} */
        this.connectionStates = new Map();
        /** @type {Set<import("ws").WebSocket>} */
        this.sessions = new Set();
        /** @type {Map<import("ws").WebSocket, Promise<void>>} */
        this.sessionCleanup = new Map();
        /** @type {Array<Error>} */
        this.cleanupErrors = [];
        /** @type {Promise<void> | undefined} */
        this.closePromise = undefined;
        /** @type {Map<object, (callback: () => Promise<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>>} */
        this.connectionCoordinators = new Map();
        /** @type {Map<object, symbol>} */
        this.connectionCoordinatorOwners = new Map();
        for (const connection of new Set(Object.values(connections))) {
            this.installConnectionCoordinator(connection);
        }
        this.physicalConnections = new Map();
        this.httpServer = createServer();
        this.websocketServer = new WebSocketServer({ server: this.httpServer, maxPayload: 16 * 1024 * 1024 });
        this.websocketServer.on("connection", (socket) => {
            this.sessions.add(socket);
            socket.once("close", () => {
                this.sessions.delete(socket);
                this.scheduleSessionCleanup(socket);
            });
            socket.on("message", (data) => void this.handleRequest(socket, `${data}`));
        });
    }
    /**
     * Installs serialization ownership for a newly enrolled physical connection.
     * @param {object} connection - Parent-owned physical connection.
     * @returns {void}
     */
    installConnectionCoordinator(connection) {
        if (this.connectionCoordinators.has(connection))
            return;
        /**
         * Serializes parent operations with child broker traffic.
         * @param {() => Promise<unknown>} callback - Parent operation.
         * @returns {Promise<unknown>} - Operation result.
         */
        const coordinator = async (callback) => await this.serialize(this.connectionState(connection), callback);
        this.connectionCoordinators.set(connection, coordinator);
        this.connectionCoordinatorOwners.set(connection, setSharedTransactionCoordinator(connection, coordinator));
    }
    /**
     * Enrolls one exact physical database identity in this capability's rollback set.
     * @param {{connection: object, databaseIdentifier: string, reuseKey: string}} args - Physical connection identity.
     * @returns {void}
     */
    enrollConnection({ connection, databaseIdentifier, reuseKey }) {
        if (!this.accepting)
            throw new Error("Shared transaction broker capability has been revoked");
        const identity = `${databaseIdentifier}\0${reuseKey}`;
        const existing = this.physicalConnections.get(identity);
        if (existing && existing !== connection)
            throw new Error(`Shared transaction physical connection identity is already enrolled: ${databaseIdentifier}`);
        this.installConnectionCoordinator(connection);
        this.physicalConnections.set(identity, connection);
    }
    /**
     * Starts a broker on an ephemeral loopback port.
     * @param {{connections: Record<string, object>}} args - Parent-owned physical connections.
     * @returns {Promise<SharedTransactionBroker>} - Listening broker.
     */
    static async start(args) {
        const broker = new SharedTransactionBroker(args);
        await new Promise((resolve, reject) => {
            broker.httpServer.once("error", reject);
            broker.httpServer.listen({ host: "127.0.0.1", port: 0 }, () => resolve(undefined));
        });
        return broker;
    }
    /**
     * Gets the loopback websocket address.
     * @returns {string} - Loopback websocket address.
     */
    address() {
        const address = this.httpServer.address();
        if (!address || typeof address === "string")
            throw new Error("Shared transaction broker is not listening");
        return `ws://127.0.0.1:${address.port}`;
    }
    /**
     * Gets the per-attempt unguessable capability.
     * @returns {string} - Per-attempt unguessable capability.
     */
    capability() { return this.secret; }
    /**
     * Validates and handles one request.
     * @param {import("ws").WebSocket} socket - Calling session.
     * @param {string} serialized - Request JSON.
     * @returns {Promise<void>} - Resolves after responding.
     */
    async handleRequest(socket, serialized) {
        let requestId = 0;
        try {
            const request = /** @type {{requestId: number, capability: string, databaseIdentifier: string, reuseKey?: string, method: string, args: import("./shared-transaction-codec.js").EncodedBrokerValue}} */ (JSON.parse(serialized));
            requestId = request.requestId;
            if (!this.accepting)
                throw new Error("Shared transaction broker capability has been revoked");
            if (!capabilityMatches(request.capability, this.secret))
                throw new Error("Unknown shared transaction broker capability");
            const connection = request.reuseKey
                ? this.physicalConnections.get(`${request.databaseIdentifier}\0${request.reuseKey}`)
                : this.connections[request.databaseIdentifier];
            if (!connection) {
                if (request.reuseKey)
                    throw new Error(`Unenrolled physical connection identity: ${request.databaseIdentifier}`);
                throw new Error(`Unknown shared transaction database identifier: ${request.databaseIdentifier}`);
            }
            if (!ALLOWED_METHODS.has(request.method))
                throw new Error(`Unsupported shared transaction broker method: ${request.method}`);
            const args = decodeBrokerValue(request.args);
            if (!Array.isArray(args))
                throw new TypeError("Shared transaction broker arguments must be an array");
            this.emit("work-queued", { connection, databaseIdentifier: request.databaseIdentifier, method: request.method });
            const result = await this.runConnectionRequest({ connection, method: request.method, savePointName: typeof args[0] === "string" ? args[0] : undefined, socket }, async () => {
                if (request.method === "rootTransactionRollback") {
                    await this.rollbackRootSavePoint(connection, /** @type {string} */ (args[0]));
                    return undefined;
                }
                const physicalMethod = request.method === "rootTransactionStart"
                    ? "startSavePoint"
                    : request.method === "rootTransactionRelease"
                        ? "releaseSavePoint"
                        : request.method === "rootTransactionRollback"
                            ? "rollbackSavePoint"
                            : request.method;
                const connectionMethods = /** @type {Record<string, (...methodArgs: Array<ReturnType<typeof JSON.parse> | {operationOwner: symbol}>) => ReturnType<typeof JSON.parse>>} */ (connection);
                const method = connectionMethods[physicalMethod];
                if (typeof method !== "function")
                    throw new Error(`Connection does not support shared transaction method: ${request.method}`);
                return await method.apply(connection, this.ownedMethodArgs({ args, connection, method: physicalMethod }));
            });
            if (socket.readyState === socket.OPEN)
                socket.send(JSON.stringify({ requestId, result: encodeBrokerValue(result) }));
        }
        catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            if (socket.readyState === socket.OPEN)
                socket.send(JSON.stringify({ requestId, error: encodeBrokerValue(normalized) }));
        }
    }
    /**
     * Adds the broker owner to public driver methods that re-enter coordinated query work.
     * @param {{args: Array<ReturnType<typeof JSON.parse>>, connection: object, method: string}} args - Physical invocation.
     * @returns {Array<ReturnType<typeof JSON.parse> | {operationOwner: symbol}>} - Owned method arguments.
     */
    ownedMethodArgs({ args, connection, method }) {
        const operationOwner = this.connectionCoordinatorOwners.get(connection);
        if (!operationOwner)
            throw new Error("Shared transaction broker connection owner is missing");
        if (["_startTransactionAction", "_commitTransactionAction", "_rollbackTransactionAction"].includes(method)) {
            return [ownedOperationOptions(args[0], operationOwner)];
        }
        if (["query", "affectedRows", "startSavePoint", "releaseSavePoint", "rollbackSavePoint"].includes(method)) {
            return [args[0], ownedOperationOptions(args[1], operationOwner)];
        }
        return args;
    }
    /**
     * Gets mutable serialization state for one physical connection.
     * @param {object} connection - Physical connection.
     * @returns {ConnectionState} - Connection state.
     */
    connectionState(connection) {
        let state = this.connectionStates.get(connection);
        if (!state) {
            state = { queue: Promise.resolve(), rootSessions: new Set() };
            this.connectionStates.set(connection, state);
        }
        return state;
    }
    /**
     * Runs a validated request with root transaction lease semantics.
     * @template T
     * @param {{connection: object, method: string, savePointName: string | undefined, socket: import("ws").WebSocket}} args - Request identity.
     * @param {() => Promise<T>} callback - Physical operation.
     * @returns {Promise<T>} - Operation result.
     */
    async runConnectionRequest({ connection, method, savePointName, socket }, callback) {
        const state = this.connectionState(connection);
        if (method === "rootTransactionStart") {
            if (!savePointName)
                throw new Error("Shared transaction broker root transaction requires a savepoint name");
            return await this.startRootLease({ callback, savePointName, state, socket });
        }
        if (method === "rootTransactionRelease" || method === "rootTransactionRollback") {
            return await this.finishRootLease({ callback, savePointName, state, socket });
        }
        if (state.lease?.socket === socket)
            return await this.serializeLease(state.lease, callback);
        return await this.serialize(state, callback);
    }
    /**
     * Acquires the FIFO physical connection lease and holds the queue until end.
     * @template T
     * @param {{callback: () => Promise<T>, savePointName: string, state: ConnectionState, socket: import("ws").WebSocket}} args - Lease request.
     * @returns {Promise<T>} - Root savepoint start result.
     */
    async startRootLease({ callback, savePointName, state, socket }) {
        if (state.rootSessions.has(socket))
            throw new Error("Shared transaction broker root transaction is already active for this session");
        state.rootSessions.add(socket);
        const previous = state.queue;
        /**
         * Resolves the start response.
         * @type {(value: T) => void}
         */
        let resolveStarted = () => { };
        /**
         * Rejects the start response.
         * @type {(error: Error) => void}
         */
        let rejectStarted = () => { };
        const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
        /**
         * Releases the held connection queue.
         * @type {(value?: void) => void}
         */
        let release = () => { };
        const held = new Promise((resolve) => { release = resolve; });
        state.queue = previous.then(async () => {
            try {
                if (socket.readyState !== socket.OPEN)
                    throw new Error("Shared transaction broker root transaction session closed before lease acquisition");
                const result = await callback();
                state.lease = { operations: Promise.resolve(), release, savePointName, socket };
                resolveStarted(result);
                if (!this.accepting)
                    await this.scheduleSessionCleanup(socket);
                await held;
            }
            catch (error) {
                state.rootSessions.delete(socket);
                rejectStarted(error instanceof Error ? error : new Error(String(error)));
            }
        });
        return await started;
    }
    /**
     * Finishes the calling session's root lease.
     * @template T
     * @param {{callback: () => Promise<T>, savePointName: string | undefined, state: ConnectionState, socket: import("ws").WebSocket}} args - Lease end request.
     * @returns {Promise<T>} - Savepoint end result.
     */
    async finishRootLease({ callback, savePointName, state, socket }) {
        const lease = state.lease;
        if (!lease || lease.socket !== socket)
            throw new Error("Shared transaction broker session does not own the root transaction lease");
        if (savePointName !== lease.savePointName)
            throw new Error("Shared transaction broker root transaction savepoint does not match its lease");
        try {
            return await this.serializeLease(lease, callback);
        }
        finally {
            state.lease = undefined;
            state.rootSessions.delete(socket);
            lease.release();
        }
    }
    /**
     * Serializes operations belonging to the active lease holder.
     * @template T
     * @param {{operations: Promise<void>}} lease - Active lease.
     * @param {() => Promise<T>} callback - Operation.
     * @returns {Promise<T>} - Result.
     */
    async serializeLease(lease, callback) {
        const previous = lease.operations;
        /**
         * Releases the holder operation queue.
         * @type {(value?: void) => void}
         */
        let release = () => { };
        const current = new Promise((resolve) => { release = resolve; });
        lease.operations = previous.then(() => current);
        await previous;
        try {
            return await callback();
        }
        finally {
            release();
        }
    }
    /**
     * Rolls back leases abandoned by a disconnected session.
     * @param {import("ws").WebSocket} socket - Disconnected session.
     * @returns {Promise<void>} - Resolves after all owned leases release.
     */
    async releaseDisconnectedLeases(socket) {
        /** @type {Array<Error>} */
        const errors = [];
        for (const [connection, state] of this.connectionStates) {
            const lease = state.lease;
            if (!lease || lease.socket !== socket)
                continue;
            try {
                await this.serializeLease(lease, async () => {
                    await this.rollbackRootSavePoint(connection, lease.savePointName);
                });
            }
            catch (error) {
                errors.push(error instanceof Error ? error : new Error(String(error)));
            }
            finally {
                state.lease = undefined;
                state.rootSessions.delete(socket);
                lease.release();
            }
        }
        if (errors.length > 0) {
            throw new AggregateError(errors, `Shared transaction broker lease cleanup failed: ${errors.map((error) => error.message).join("; ")}`);
        }
    }
    /**
     * Tracks detached socket cleanup and records its failure for close().
     * @param {import("ws").WebSocket} socket - Closed session.
     * @returns {Promise<void>} - Settled tracked cleanup.
     */
    scheduleSessionCleanup(socket) {
        const existing = this.sessionCleanup.get(socket);
        if (existing)
            return existing;
        const cleanup = this.releaseDisconnectedLeases(socket)
            .catch((error) => {
            this.cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        })
            .finally(() => this.sessionCleanup.delete(socket));
        this.sessionCleanup.set(socket, cleanup);
        return cleanup;
    }
    /**
     * Rolls back and removes a root savepoint so it cannot remain beneath the next lease.
     * @param {object} connection - Parent physical connection.
     * @param {string} savePointName - Root savepoint name.
     * @returns {Promise<void>} - Resolves after rollback and release.
     */
    async rollbackRootSavePoint(connection, savePointName) {
        const methods = /** @type {{releaseSavePoint: (name: string, options?: {operationOwner?: symbol}) => Promise<void>, rollbackSavePoint: (name: string, options?: {operationOwner?: symbol}) => Promise<void>}} */ (connection);
        const operationOwner = this.connectionCoordinatorOwners.get(connection);
        if (!operationOwner)
            throw new Error("Shared transaction broker connection owner is missing");
        /** @type {Array<Error>} */
        const errors = [];
        try {
            await methods.rollbackSavePoint(savePointName, { operationOwner });
        }
        catch (error) {
            errors.push(error instanceof Error ? error : new Error(String(error)));
        }
        try {
            await methods.releaseSavePoint(savePointName, { operationOwner });
        }
        catch (error) {
            errors.push(error instanceof Error ? error : new Error(String(error)));
        }
        if (errors.length > 0) {
            throw new AggregateError(errors, `Shared transaction broker could not clean root savepoint ${savePointName}: ${errors.map((error) => error.message).join("; ")}`);
        }
    }
    /**
     * Serializes ordinary non-holder work through the connection FIFO.
     * @template T
     * @param {ConnectionState} state - Connection state.
     * @param {() => Promise<T>} callback - Work.
     * @returns {Promise<T>} - Work result.
     */
    async serialize(state, callback) {
        const previous = state.queue;
        /**
         * Resolves the current queue entry.
         * @type {(value?: void) => void}
         */
        let release = () => { };
        const current = new Promise((resolve) => { release = resolve; });
        const queued = previous.then(() => current);
        state.queue = queued;
        await previous;
        try {
            return await callback();
        }
        finally {
            release();
        }
    }
    /**
     * Stops admission, revokes capability, rejects clients, and drains active work.
     * @returns {Promise<void>} - Resolves after transport shutdown.
     */
    async close() {
        if (this.closePromise)
            return await this.closePromise;
        this.closePromise = this.closeTransport();
        return await this.closePromise;
    }
    /** Revokes admission without interrupting already accepted work. */
    revoke() {
        if (!this.accepting)
            return;
        this.accepting = false;
        this.secret = randomBytes(32).toString("base64url");
    }
    /** Drains all work accepted before capability revocation. */
    async drain() {
        if (this.accepting)
            throw new Error("Shared transaction broker must be revoked before drain");
        await Promise.all(Array.from(this.connectionStates.values()).map((state) => state.queue));
    }
    /**
     * Performs deterministic transport shutdown and reports cleanup failures last.
     * @returns {Promise<void>} - Resolves after shutdown or rejects with cleanup errors.
     */
    async closeTransport() {
        this.revoke();
        const closingSessions = Array.from(this.sessions);
        await Promise.all(closingSessions.map(async (socket) => await this.scheduleSessionCleanup(socket)));
        await this.drain();
        for (const socket of closingSessions)
            socket.close(1001, "Shared transaction broker closed");
        await new Promise((resolve) => this.websocketServer.close(() => resolve(undefined)));
        await new Promise((resolve) => this.httpServer.close(() => resolve(undefined)));
        await Promise.all(Array.from(this.sessionCleanup.values()));
        for (const [connection, coordinator] of this.connectionCoordinators) {
            clearSharedTransactionCoordinator(connection, coordinator);
        }
        if (this.cleanupErrors.length > 0) {
            throw new AggregateError(this.cleanupErrors, `Shared transaction broker cleanup failed: ${this.cleanupErrors.map((error) => error.message).join("; ")}`);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkLXRyYW5zYWN0aW9uLWJyb2tlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1icm9rZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzFELE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxXQUFXLENBQUE7QUFDeEMsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUMxQyxPQUFPLEVBQUUsZUFBZSxFQUFFLE1BQU0sSUFBSSxDQUFBO0FBQ3BDLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxpQkFBaUIsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ3BGLE9BQU8sRUFBRSxpQ0FBaUMsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLGdEQUFnRCxDQUFBO0FBRW5JLG9OQUFvTjtBQUVwTixNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUM5QixPQUFPO0lBQ1AsY0FBYztJQUNkLGNBQWM7SUFDZCxxQkFBcUI7SUFDckIseUJBQXlCO0lBQ3pCLDBCQUEwQjtJQUMxQiw0QkFBNEI7SUFDNUIsZ0JBQWdCO0lBQ2hCLGtCQUFrQjtJQUNsQixtQkFBbUI7SUFDbkIsMEJBQTBCO0lBQzFCLHNCQUFzQjtJQUN0Qix3QkFBd0I7SUFDeEIseUJBQXlCO0NBQzFCLENBQUMsQ0FBQTtBQUVGOzs7OztHQUtHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxRQUFRLEVBQUUsUUFBUTtJQUMzQyxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQzNDLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDM0MsT0FBTyxhQUFhLENBQUMsTUFBTSxLQUFLLGFBQWEsQ0FBQyxNQUFNLElB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QUMsQ0FBQyxDQUFDLENBQUE7UUFDL0UsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDM0QsS0FBSyxNQUFNLENBQUMsVUFBVSxFQUFFLFdBQVcsQ0FBQyxJQUFJLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO1lBQ3BFLGlDQUFpQyxDQUFDLFVBQVUsRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUM1RCxDQUFDO1FBQ0QsSUFBSSxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNsQyxNQUFNLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsNkNBQTZDLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMxSixDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbUJ5dGVzLCB0aW1pbmdTYWZlRXF1YWwgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0IHsgY3JlYXRlU2VydmVyIH0gZnJvbSBcIm5vZGU6aHR0cFwiXG5pbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tIFwibm9kZTpldmVudHNcIlxuaW1wb3J0IHsgV2ViU29ja2V0U2VydmVyIH0gZnJvbSBcIndzXCJcbmltcG9ydCB7IGRlY29kZUJyb2tlclZhbHVlLCBlbmNvZGVCcm9rZXJWYWx1ZSB9IGZyb20gXCIuL3NoYXJlZC10cmFuc2FjdGlvbi1jb2RlYy5qc1wiXG5pbXBvcnQgeyBjbGVhclNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3IsIHNldFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3IgfSBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tY29ubmVjdGlvbi1jb29yZGluYXRvci5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7e3F1ZXVlOiBQcm9taXNlPHZvaWQ+LCByb290U2Vzc2lvbnM6IFNldDxpbXBvcnQoXCJ3c1wiKS5XZWJTb2NrZXQ+LCBsZWFzZT86IHtvcGVyYXRpb25zOiBQcm9taXNlPHZvaWQ+LCByZWxlYXNlOiAoKSA9PiB2b2lkLCBzYXZlUG9pbnROYW1lOiBzdHJpbmcsIHNvY2tldDogaW1wb3J0KFwid3NcIikuV2ViU29ja2V0fX19IENvbm5lY3Rpb25TdGF0ZSAqL1xuXG5jb25zdCBBTExPV0VEX01FVEhPRFMgPSBuZXcgU2V0KFtcbiAgXCJxdWVyeVwiLFxuICBcImFmZmVjdGVkUm93c1wiLFxuICBcIl9xdWVyeUFjdHVhbFwiLFxuICBcIl9hZmZlY3RlZFJvd3NBY3R1YWxcIixcbiAgXCJfc3RhcnRUcmFuc2FjdGlvbkFjdGlvblwiLFxuICBcIl9jb21taXRUcmFuc2FjdGlvbkFjdGlvblwiLFxuICBcIl9yb2xsYmFja1RyYW5zYWN0aW9uQWN0aW9uXCIsXG4gIFwic3RhcnRTYXZlUG9pbnRcIixcbiAgXCJyZWxlYXNlU2F2ZVBvaW50XCIsXG4gIFwicm9sbGJhY2tTYXZlUG9pbnRcIixcbiAgXCJnZXRDb25uZWN0aW9uU2NvcGVkVmFsdWVcIixcbiAgXCJyb290VHJhbnNhY3Rpb25TdGFydFwiLFxuICBcInJvb3RUcmFuc2FjdGlvblJlbGVhc2VcIixcbiAgXCJyb290VHJhbnNhY3Rpb25Sb2xsYmFja1wiXG5dKVxuXG4vKipcbiAqIENvbXBhcmVzIGEgcHJlc2VudGVkIGNhcGFiaWxpdHkgd2l0aG91dCBsZWFraW5nIG1hdGNoaW5nIHByZWZpeCB0aW1pbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZWQgLSBQcmVzZW50ZWQgY2FwYWJpbGl0eS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBleHBlY3RlZCAtIEFjdGl2ZSBjYXBhYmlsaXR5LlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2FwYWJpbGl0aWVzIG1hdGNoLlxuICovXG5mdW5jdGlvbiBjYXBhYmlsaXR5TWF0Y2hlcyhwcm92aWRlZCwgZXhwZWN0ZWQpIHtcbiAgY29uc3QgcHJvdmlkZWRCeXRlcyA9IEJ1ZmZlci5mcm9tKHByb3ZpZGVkKVxuICBjb25zdCBleHBlY3RlZEJ5dGVzID0gQnVmZmVyLmZyb20oZXhwZWN0ZWQpXG4gIHJldHVybiBwcm92aWRlZEJ5dGVzLmxlbmd0aCA9PT0gZXhwZWN0ZWRCeXRlcy5sZW5ndGggJiYgdGltaW5nU2FmZUVxdWFsKHByb3ZpZGVkQnl0ZXMsIGV4cGVjdGVkQnl0ZXMpXG59XG5cbi8qKlxuICogQWRkcyBicm9rZXIgb3duZXJzaGlwIHRvIGRlY29kZWQgZHJpdmVyIG9wdGlvbnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIERlY29kZWQgb3B0aW9ucy5cbiAqIEBwYXJhbSB7c3ltYm9sfSBvcGVyYXRpb25Pd25lciAtIEJyb2tlciBjb29yZGluYXRvciBvd25lci5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gJiB7b3BlcmF0aW9uT3duZXI6IHN5bWJvbH19IC0gT3duZWQgb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gb3duZWRPcGVyYXRpb25PcHRpb25zKHZhbHVlLCBvcGVyYXRpb25Pd25lcikge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHtvcGVyYXRpb25Pd25lcn1cbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBkcml2ZXIgb3B0aW9ucyBtdXN0IGJlIGFuIG9iamVjdFwiKVxuICB9XG5cbiAgY29uc3Qgb3B0aW9ucyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpXG5cbiAgcmV0dXJuIHsuLi5vcHRpb25zLCBvcGVyYXRpb25Pd25lcn1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIGJyb2tlciBhcm91bmQgcGFyZW50LW93bmVkIHBoeXNpY2FsIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uczogUmVjb3JkPHN0cmluZywgb2JqZWN0Pn19IGFyZ3MgLSBQYXJlbnQtb3duZWQgcGh5c2ljYWwgY29ubmVjdGlvbnMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29ubmVjdGlvbnN9KSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuY29ubmVjdGlvbnMgPSBjb25uZWN0aW9uc1xuICAgIHRoaXMuc2VjcmV0ID0gcmFuZG9tQnl0ZXMoMzIpLnRvU3RyaW5nKFwiYmFzZTY0dXJsXCIpXG4gICAgdGhpcy5hY2NlcHRpbmcgPSB0cnVlXG4gICAgLyoqIEB0eXBlIHtNYXA8b2JqZWN0LCBDb25uZWN0aW9uU3RhdGU+fSAqL1xuICAgIHRoaXMuY29ubmVjdGlvblN0YXRlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7U2V0PGltcG9ydChcIndzXCIpLldlYlNvY2tldD59ICovXG4gICAgdGhpcy5zZXNzaW9ucyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7TWFwPGltcG9ydChcIndzXCIpLldlYlNvY2tldCwgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5zZXNzaW9uQ2xlYW51cCA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8RXJyb3I+fSAqL1xuICAgIHRoaXMuY2xlYW51cEVycm9ycyA9IFtdXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuY2xvc2VQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtNYXA8b2JqZWN0LCAoY2FsbGJhY2s6ICgpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgdGhpcy5jb25uZWN0aW9uQ29vcmRpbmF0b3JzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8b2JqZWN0LCBzeW1ib2w+fSAqL1xuICAgIHRoaXMuY29ubmVjdGlvbkNvb3JkaW5hdG9yT3duZXJzID0gbmV3IE1hcCgpXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIG5ldyBTZXQoT2JqZWN0LnZhbHVlcyhjb25uZWN0aW9ucykpKSB7XG4gICAgICB0aGlzLmluc3RhbGxDb25uZWN0aW9uQ29vcmRpbmF0b3IoY29ubmVjdGlvbilcbiAgICB9XG4gICAgdGhpcy5waHlzaWNhbENvbm5lY3Rpb25zID0gbmV3IE1hcCgpXG4gICAgdGhpcy5odHRwU2VydmVyID0gY3JlYXRlU2VydmVyKClcbiAgICB0aGlzLndlYnNvY2tldFNlcnZlciA9IG5ldyBXZWJTb2NrZXRTZXJ2ZXIoe3NlcnZlcjogdGhpcy5odHRwU2VydmVyLCBtYXhQYXlsb2FkOiAxNiAqIDEwMjQgKiAxMDI0fSlcbiAgICB0aGlzLndlYnNvY2tldFNlcnZlci5vbihcImNvbm5lY3Rpb25cIiwgKHNvY2tldCkgPT4ge1xuICAgICAgdGhpcy5zZXNzaW9ucy5hZGQoc29ja2V0KVxuICAgICAgc29ja2V0Lm9uY2UoXCJjbG9zZVwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuc2Vzc2lvbnMuZGVsZXRlKHNvY2tldClcbiAgICAgICAgdGhpcy5zY2hlZHVsZVNlc3Npb25DbGVhbnVwKHNvY2tldClcbiAgICAgIH0pXG4gICAgICBzb2NrZXQub24oXCJtZXNzYWdlXCIsIChkYXRhKSA9PiB2b2lkIHRoaXMuaGFuZGxlUmVxdWVzdChzb2NrZXQsIGAke2RhdGF9YCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBzZXJpYWxpemF0aW9uIG93bmVyc2hpcCBmb3IgYSBuZXdseSBlbnJvbGxlZCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gY29ubmVjdGlvbiAtIFBhcmVudC1vd25lZCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGluc3RhbGxDb25uZWN0aW9uQ29vcmRpbmF0b3IoY29ubmVjdGlvbikge1xuICAgIGlmICh0aGlzLmNvbm5lY3Rpb25Db29yZGluYXRvcnMuaGFzKGNvbm5lY3Rpb24pKSByZXR1cm5cbiAgICAvKipcbiAgICAgKiBTZXJpYWxpemVzIHBhcmVudCBvcGVyYXRpb25zIHdpdGggY2hpbGQgYnJva2VyIHRyYWZmaWMuXG4gICAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHVua25vd24+fSBjYWxsYmFjayAtIFBhcmVudCBvcGVyYXRpb24uXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dW5rbm93bj59IC0gT3BlcmF0aW9uIHJlc3VsdC5cbiAgICAgKi9cbiAgICBjb25zdCBjb29yZGluYXRvciA9IGFzeW5jIChjYWxsYmFjaykgPT4gYXdhaXQgdGhpcy5zZXJpYWxpemUodGhpcy5jb25uZWN0aW9uU3RhdGUoY29ubmVjdGlvbiksIGNhbGxiYWNrKVxuICAgIHRoaXMuY29ubmVjdGlvbkNvb3JkaW5hdG9ycy5zZXQoY29ubmVjdGlvbiwgY29vcmRpbmF0b3IpXG4gICAgdGhpcy5jb25uZWN0aW9uQ29vcmRpbmF0b3JPd25lcnMuc2V0KGNvbm5lY3Rpb24sIHNldFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3IoY29ubmVjdGlvbiwgY29vcmRpbmF0b3IpKVxuICB9XG5cbiAgLyoqXG4gICAqIEVucm9sbHMgb25lIGV4YWN0IHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5IGluIHRoaXMgY2FwYWJpbGl0eSdzIHJvbGxiYWNrIHNldC5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogb2JqZWN0LCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgcmV1c2VLZXk6IHN0cmluZ319IGFyZ3MgLSBQaHlzaWNhbCBjb25uZWN0aW9uIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGVucm9sbENvbm5lY3Rpb24oe2Nvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgcmV1c2VLZXl9KSB7XG4gICAgaWYgKCF0aGlzLmFjY2VwdGluZykgdGhyb3cgbmV3IEVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjYXBhYmlsaXR5IGhhcyBiZWVuIHJldm9rZWRcIilcbiAgICBjb25zdCBpZGVudGl0eSA9IGAke2RhdGFiYXNlSWRlbnRpZmllcn1cXDAke3JldXNlS2V5fWBcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucGh5c2ljYWxDb25uZWN0aW9ucy5nZXQoaWRlbnRpdHkpXG4gICAgaWYgKGV4aXN0aW5nICYmIGV4aXN0aW5nICE9PSBjb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYFNoYXJlZCB0cmFuc2FjdGlvbiBwaHlzaWNhbCBjb25uZWN0aW9uIGlkZW50aXR5IGlzIGFscmVhZHkgZW5yb2xsZWQ6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgdGhpcy5pbnN0YWxsQ29ubmVjdGlvbkNvb3JkaW5hdG9yKGNvbm5lY3Rpb24pXG4gICAgdGhpcy5waHlzaWNhbENvbm5lY3Rpb25zLnNldChpZGVudGl0eSwgY29ubmVjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYSBicm9rZXIgb24gYW4gZXBoZW1lcmFsIGxvb3BiYWNrIHBvcnQuXG4gICAqIEBwYXJhbSB7e2Nvbm5lY3Rpb25zOiBSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+fX0gYXJncyAtIFBhcmVudC1vd25lZCBwaHlzaWNhbCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXI+fSAtIExpc3RlbmluZyBicm9rZXIuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgc3RhcnQoYXJncykge1xuICAgIGNvbnN0IGJyb2tlciA9IG5ldyBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihhcmdzKVxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGJyb2tlci5odHRwU2VydmVyLm9uY2UoXCJlcnJvclwiLCByZWplY3QpXG4gICAgICBicm9rZXIuaHR0cFNlcnZlci5saXN0ZW4oe2hvc3Q6IFwiMTI3LjAuMC4xXCIsIHBvcnQ6IDB9LCAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpXG4gICAgfSlcbiAgICByZXR1cm4gYnJva2VyXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgbG9vcGJhY2sgd2Vic29ja2V0IGFkZHJlc3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTG9vcGJhY2sgd2Vic29ja2V0IGFkZHJlc3MuXG4gICAqL1xuICBhZGRyZXNzKCkge1xuICAgIGNvbnN0IGFkZHJlc3MgPSB0aGlzLmh0dHBTZXJ2ZXIuYWRkcmVzcygpXG4gICAgaWYgKCFhZGRyZXNzIHx8IHR5cGVvZiBhZGRyZXNzID09PSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoXCJTaGFyZWQgdHJhbnNhY3Rpb24gYnJva2VyIGlzIG5vdCBsaXN0ZW5pbmdcIilcbiAgICByZXR1cm4gYHdzOi8vMTI3LjAuMC4xOiR7YWRkcmVzcy5wb3J0fWBcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBwZXItYXR0ZW1wdCB1bmd1ZXNzYWJsZSBjYXBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBlci1hdHRlbXB0IHVuZ3Vlc3NhYmxlIGNhcGFiaWxpdHkuXG4gICAqL1xuICBjYXBhYmlsaXR5KCkgeyByZXR1cm4gdGhpcy5zZWNyZXQgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYW5kIGhhbmRsZXMgb25lIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwid3NcIikuV2ViU29ja2V0fSBzb2NrZXQgLSBDYWxsaW5nIHNlc3Npb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXJpYWxpemVkIC0gUmVxdWVzdCBKU09OLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXNwb25kaW5nLlxuICAgKi9cbiAgYXN5bmMgaGFuZGxlUmVxdWVzdChzb2NrZXQsIHNlcmlhbGl6ZWQpIHtcbiAgICBsZXQgcmVxdWVzdElkID0gMFxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gLyoqIEB0eXBlIHt7cmVxdWVzdElkOiBudW1iZXIsIGNhcGFiaWxpdHk6IHN0cmluZywgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHJldXNlS2V5Pzogc3RyaW5nLCBtZXRob2Q6IHN0cmluZywgYXJnczogaW1wb3J0KFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tY29kZWMuanNcIikuRW5jb2RlZEJyb2tlclZhbHVlfX0gKi8gKEpTT04ucGFyc2Uoc2VyaWFsaXplZCkpXG4gICAgICByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZFxuICAgICAgaWYgKCF0aGlzLmFjY2VwdGluZykgdGhyb3cgbmV3IEVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjYXBhYmlsaXR5IGhhcyBiZWVuIHJldm9rZWRcIilcbiAgICAgIGlmICghY2FwYWJpbGl0eU1hdGNoZXMocmVxdWVzdC5jYXBhYmlsaXR5LCB0aGlzLnNlY3JldCkpIHRocm93IG5ldyBFcnJvcihcIlVua25vd24gc2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjYXBhYmlsaXR5XCIpXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gcmVxdWVzdC5yZXVzZUtleVxuICAgICAgICA/IHRoaXMucGh5c2ljYWxDb25uZWN0aW9ucy5nZXQoYCR7cmVxdWVzdC5kYXRhYmFzZUlkZW50aWZpZXJ9XFwwJHtyZXF1ZXN0LnJldXNlS2V5fWApXG4gICAgICAgIDogdGhpcy5jb25uZWN0aW9uc1tyZXF1ZXN0LmRhdGFiYXNlSWRlbnRpZmllcl1cbiAgICAgIGlmICghY29ubmVjdGlvbikge1xuICAgICAgICBpZiAocmVxdWVzdC5yZXVzZUtleSkgdGhyb3cgbmV3IEVycm9yKGBVbmVucm9sbGVkIHBoeXNpY2FsIGNvbm5lY3Rpb24gaWRlbnRpdHk6ICR7cmVxdWVzdC5kYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHNoYXJlZCB0cmFuc2FjdGlvbiBkYXRhYmFzZSBpZGVudGlmaWVyOiAke3JlcXVlc3QuZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgICB9XG4gICAgICBpZiAoIUFMTE9XRURfTUVUSE9EUy5oYXMocmVxdWVzdC5tZXRob2QpKSB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHNoYXJlZCB0cmFuc2FjdGlvbiBicm9rZXIgbWV0aG9kOiAke3JlcXVlc3QubWV0aG9kfWApXG4gICAgICBjb25zdCBhcmdzID0gZGVjb2RlQnJva2VyVmFsdWUocmVxdWVzdC5hcmdzKVxuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFyZ3MpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBhcmd1bWVudHMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgICAgdGhpcy5lbWl0KFwid29yay1xdWV1ZWRcIiwge2Nvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpZmllcjogcmVxdWVzdC5kYXRhYmFzZUlkZW50aWZpZXIsIG1ldGhvZDogcmVxdWVzdC5tZXRob2R9KVxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db25uZWN0aW9uUmVxdWVzdCh7Y29ubmVjdGlvbiwgbWV0aG9kOiByZXF1ZXN0Lm1ldGhvZCwgc2F2ZVBvaW50TmFtZTogdHlwZW9mIGFyZ3NbMF0gPT09IFwic3RyaW5nXCIgPyBhcmdzWzBdIDogdW5kZWZpbmVkLCBzb2NrZXR9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChyZXF1ZXN0Lm1ldGhvZCA9PT0gXCJyb290VHJhbnNhY3Rpb25Sb2xsYmFja1wiKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja1Jvb3RTYXZlUG9pbnQoY29ubmVjdGlvbiwgLyoqIEB0eXBlIHtzdHJpbmd9ICovIChhcmdzWzBdKSlcbiAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGh5c2ljYWxNZXRob2QgPSByZXF1ZXN0Lm1ldGhvZCA9PT0gXCJyb290VHJhbnNhY3Rpb25TdGFydFwiXG4gICAgICAgICAgPyBcInN0YXJ0U2F2ZVBvaW50XCJcbiAgICAgICAgICA6IHJlcXVlc3QubWV0aG9kID09PSBcInJvb3RUcmFuc2FjdGlvblJlbGVhc2VcIlxuICAgICAgICAgICAgPyBcInJlbGVhc2VTYXZlUG9pbnRcIlxuICAgICAgICAgICAgOiByZXF1ZXN0Lm1ldGhvZCA9PT0gXCJyb290VHJhbnNhY3Rpb25Sb2xsYmFja1wiXG4gICAgICAgICAgICAgID8gXCJyb2xsYmFja1NhdmVQb2ludFwiXG4gICAgICAgICAgICAgIDogcmVxdWVzdC5tZXRob2RcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbk1ldGhvZHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICguLi5tZXRob2RBcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IHtvcGVyYXRpb25Pd25lcjogc3ltYm9sfT4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGNvbm5lY3Rpb24pXG4gICAgICAgIGNvbnN0IG1ldGhvZCA9IGNvbm5lY3Rpb25NZXRob2RzW3BoeXNpY2FsTWV0aG9kXVxuICAgICAgICBpZiAodHlwZW9mIG1ldGhvZCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYENvbm5lY3Rpb24gZG9lcyBub3Qgc3VwcG9ydCBzaGFyZWQgdHJhbnNhY3Rpb24gbWV0aG9kOiAke3JlcXVlc3QubWV0aG9kfWApXG4gICAgICAgIHJldHVybiBhd2FpdCBtZXRob2QuYXBwbHkoY29ubmVjdGlvbiwgdGhpcy5vd25lZE1ldGhvZEFyZ3Moe2FyZ3MsIGNvbm5lY3Rpb24sIG1ldGhvZDogcGh5c2ljYWxNZXRob2R9KSlcbiAgICAgIH0pXG4gICAgICBpZiAoc29ja2V0LnJlYWR5U3RhdGUgPT09IHNvY2tldC5PUEVOKSBzb2NrZXQuc2VuZChKU09OLnN0cmluZ2lmeSh7cmVxdWVzdElkLCByZXN1bHQ6IGVuY29kZUJyb2tlclZhbHVlKHJlc3VsdCl9KSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgaWYgKHNvY2tldC5yZWFkeVN0YXRlID09PSBzb2NrZXQuT1BFTikgc29ja2V0LnNlbmQoSlNPTi5zdHJpbmdpZnkoe3JlcXVlc3RJZCwgZXJyb3I6IGVuY29kZUJyb2tlclZhbHVlKG5vcm1hbGl6ZWQpfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgdGhlIGJyb2tlciBvd25lciB0byBwdWJsaWMgZHJpdmVyIG1ldGhvZHMgdGhhdCByZS1lbnRlciBjb29yZGluYXRlZCBxdWVyeSB3b3JrLlxuICAgKiBAcGFyYW0ge3thcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGNvbm5lY3Rpb246IG9iamVjdCwgbWV0aG9kOiBzdHJpbmd9fSBhcmdzIC0gUGh5c2ljYWwgaW52b2NhdGlvbi5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwge29wZXJhdGlvbk93bmVyOiBzeW1ib2x9Pn0gLSBPd25lZCBtZXRob2QgYXJndW1lbnRzLlxuICAgKi9cbiAgb3duZWRNZXRob2RBcmdzKHthcmdzLCBjb25uZWN0aW9uLCBtZXRob2R9KSB7XG4gICAgY29uc3Qgb3BlcmF0aW9uT3duZXIgPSB0aGlzLmNvbm5lY3Rpb25Db29yZGluYXRvck93bmVycy5nZXQoY29ubmVjdGlvbilcblxuICAgIGlmICghb3BlcmF0aW9uT3duZXIpIHRocm93IG5ldyBFcnJvcihcIlNoYXJlZCB0cmFuc2FjdGlvbiBicm9rZXIgY29ubmVjdGlvbiBvd25lciBpcyBtaXNzaW5nXCIpXG4gICAgaWYgKFtcIl9zdGFydFRyYW5zYWN0aW9uQWN0aW9uXCIsIFwiX2NvbW1pdFRyYW5zYWN0aW9uQWN0aW9uXCIsIFwiX3JvbGxiYWNrVHJhbnNhY3Rpb25BY3Rpb25cIl0uaW5jbHVkZXMobWV0aG9kKSkge1xuICAgICAgcmV0dXJuIFtvd25lZE9wZXJhdGlvbk9wdGlvbnMoYXJnc1swXSwgb3BlcmF0aW9uT3duZXIpXVxuICAgIH1cbiAgICBpZiAoW1wicXVlcnlcIiwgXCJhZmZlY3RlZFJvd3NcIiwgXCJzdGFydFNhdmVQb2ludFwiLCBcInJlbGVhc2VTYXZlUG9pbnRcIiwgXCJyb2xsYmFja1NhdmVQb2ludFwiXS5pbmNsdWRlcyhtZXRob2QpKSB7XG4gICAgICByZXR1cm4gW2FyZ3NbMF0sIG93bmVkT3BlcmF0aW9uT3B0aW9ucyhhcmdzWzFdLCBvcGVyYXRpb25Pd25lcildXG4gICAgfVxuXG4gICAgcmV0dXJuIGFyZ3NcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIG11dGFibGUgc2VyaWFsaXphdGlvbiBzdGF0ZSBmb3Igb25lIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25uZWN0aW9uIC0gUGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge0Nvbm5lY3Rpb25TdGF0ZX0gLSBDb25uZWN0aW9uIHN0YXRlLlxuICAgKi9cbiAgY29ubmVjdGlvblN0YXRlKGNvbm5lY3Rpb24pIHtcbiAgICBsZXQgc3RhdGUgPSB0aGlzLmNvbm5lY3Rpb25TdGF0ZXMuZ2V0KGNvbm5lY3Rpb24pXG4gICAgaWYgKCFzdGF0ZSkge1xuICAgICAgc3RhdGUgPSB7cXVldWU6IFByb21pc2UucmVzb2x2ZSgpLCByb290U2Vzc2lvbnM6IG5ldyBTZXQoKX1cbiAgICAgIHRoaXMuY29ubmVjdGlvblN0YXRlcy5zZXQoY29ubmVjdGlvbiwgc3RhdGUpXG4gICAgfVxuICAgIHJldHVybiBzdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSB2YWxpZGF0ZWQgcmVxdWVzdCB3aXRoIHJvb3QgdHJhbnNhY3Rpb24gbGVhc2Ugc2VtYW50aWNzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uOiBvYmplY3QsIG1ldGhvZDogc3RyaW5nLCBzYXZlUG9pbnROYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQsIHNvY2tldDogaW1wb3J0KFwid3NcIikuV2ViU29ja2V0fX0gYXJncyAtIFJlcXVlc3QgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQaHlzaWNhbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIE9wZXJhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5Db25uZWN0aW9uUmVxdWVzdCh7Y29ubmVjdGlvbiwgbWV0aG9kLCBzYXZlUG9pbnROYW1lLCBzb2NrZXR9LCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5jb25uZWN0aW9uU3RhdGUoY29ubmVjdGlvbilcbiAgICBpZiAobWV0aG9kID09PSBcInJvb3RUcmFuc2FjdGlvblN0YXJ0XCIpIHtcbiAgICAgIGlmICghc2F2ZVBvaW50TmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciByb290IHRyYW5zYWN0aW9uIHJlcXVpcmVzIGEgc2F2ZXBvaW50IG5hbWVcIilcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnN0YXJ0Um9vdExlYXNlKHtjYWxsYmFjaywgc2F2ZVBvaW50TmFtZSwgc3RhdGUsIHNvY2tldH0pXG4gICAgfVxuICAgIGlmIChtZXRob2QgPT09IFwicm9vdFRyYW5zYWN0aW9uUmVsZWFzZVwiIHx8IG1ldGhvZCA9PT0gXCJyb290VHJhbnNhY3Rpb25Sb2xsYmFja1wiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5maW5pc2hSb290TGVhc2Uoe2NhbGxiYWNrLCBzYXZlUG9pbnROYW1lLCBzdGF0ZSwgc29ja2V0fSlcbiAgICB9XG4gICAgaWYgKHN0YXRlLmxlYXNlPy5zb2NrZXQgPT09IHNvY2tldCkgcmV0dXJuIGF3YWl0IHRoaXMuc2VyaWFsaXplTGVhc2Uoc3RhdGUubGVhc2UsIGNhbGxiYWNrKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLnNlcmlhbGl6ZShzdGF0ZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogQWNxdWlyZXMgdGhlIEZJRk8gcGh5c2ljYWwgY29ubmVjdGlvbiBsZWFzZSBhbmQgaG9sZHMgdGhlIHF1ZXVlIHVudGlsIGVuZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7Y2FsbGJhY2s6ICgpID0+IFByb21pc2U8VD4sIHNhdmVQb2ludE5hbWU6IHN0cmluZywgc3RhdGU6IENvbm5lY3Rpb25TdGF0ZSwgc29ja2V0OiBpbXBvcnQoXCJ3c1wiKS5XZWJTb2NrZXR9fSBhcmdzIC0gTGVhc2UgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUm9vdCBzYXZlcG9pbnQgc3RhcnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3RhcnRSb290TGVhc2Uoe2NhbGxiYWNrLCBzYXZlUG9pbnROYW1lLCBzdGF0ZSwgc29ja2V0fSkge1xuICAgIGlmIChzdGF0ZS5yb290U2Vzc2lvbnMuaGFzKHNvY2tldCkpIHRocm93IG5ldyBFcnJvcihcIlNoYXJlZCB0cmFuc2FjdGlvbiBicm9rZXIgcm9vdCB0cmFuc2FjdGlvbiBpcyBhbHJlYWR5IGFjdGl2ZSBmb3IgdGhpcyBzZXNzaW9uXCIpXG4gICAgc3RhdGUucm9vdFNlc3Npb25zLmFkZChzb2NrZXQpXG4gICAgY29uc3QgcHJldmlvdXMgPSBzdGF0ZS5xdWV1ZVxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHRoZSBzdGFydCByZXNwb25zZS5cbiAgICAgKiBAdHlwZSB7KHZhbHVlOiBUKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlU3RhcnRlZCA9ICgpID0+IHt9XG4gICAgLyoqXG4gICAgICogUmVqZWN0cyB0aGUgc3RhcnQgcmVzcG9uc2UuXG4gICAgICogQHR5cGUgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlamVjdFN0YXJ0ZWQgPSAoKSA9PiB7fVxuICAgIGNvbnN0IHN0YXJ0ZWQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7IHJlc29sdmVTdGFydGVkID0gcmVzb2x2ZTsgcmVqZWN0U3RhcnRlZCA9IHJlamVjdCB9KVxuICAgIC8qKlxuICAgICAqIFJlbGVhc2VzIHRoZSBoZWxkIGNvbm5lY3Rpb24gcXVldWUuXG4gICAgICogQHR5cGUgeyh2YWx1ZT86IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlbGVhc2UgPSAoKSA9PiB7fVxuICAgIGNvbnN0IGhlbGQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZWxlYXNlID0gcmVzb2x2ZSB9KVxuXG4gICAgc3RhdGUucXVldWUgPSBwcmV2aW91cy50aGVuKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChzb2NrZXQucmVhZHlTdGF0ZSAhPT0gc29ja2V0Lk9QRU4pIHRocm93IG5ldyBFcnJvcihcIlNoYXJlZCB0cmFuc2FjdGlvbiBicm9rZXIgcm9vdCB0cmFuc2FjdGlvbiBzZXNzaW9uIGNsb3NlZCBiZWZvcmUgbGVhc2UgYWNxdWlzaXRpb25cIilcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgICBzdGF0ZS5sZWFzZSA9IHtvcGVyYXRpb25zOiBQcm9taXNlLnJlc29sdmUoKSwgcmVsZWFzZSwgc2F2ZVBvaW50TmFtZSwgc29ja2V0fVxuICAgICAgICByZXNvbHZlU3RhcnRlZChyZXN1bHQpXG4gICAgICAgIGlmICghdGhpcy5hY2NlcHRpbmcpIGF3YWl0IHRoaXMuc2NoZWR1bGVTZXNzaW9uQ2xlYW51cChzb2NrZXQpXG4gICAgICAgIGF3YWl0IGhlbGRcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHN0YXRlLnJvb3RTZXNzaW9ucy5kZWxldGUoc29ja2V0KVxuICAgICAgICByZWplY3RTdGFydGVkKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cbiAgICB9KVxuICAgIHJldHVybiBhd2FpdCBzdGFydGVkXG4gIH1cblxuICAvKipcbiAgICogRmluaXNoZXMgdGhlIGNhbGxpbmcgc2Vzc2lvbidzIHJvb3QgbGVhc2UuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2NhbGxiYWNrOiAoKSA9PiBQcm9taXNlPFQ+LCBzYXZlUG9pbnROYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQsIHN0YXRlOiBDb25uZWN0aW9uU3RhdGUsIHNvY2tldDogaW1wb3J0KFwid3NcIikuV2ViU29ja2V0fX0gYXJncyAtIExlYXNlIGVuZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBTYXZlcG9pbnQgZW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGZpbmlzaFJvb3RMZWFzZSh7Y2FsbGJhY2ssIHNhdmVQb2ludE5hbWUsIHN0YXRlLCBzb2NrZXR9KSB7XG4gICAgY29uc3QgbGVhc2UgPSBzdGF0ZS5sZWFzZVxuICAgIGlmICghbGVhc2UgfHwgbGVhc2Uuc29ja2V0ICE9PSBzb2NrZXQpIHRocm93IG5ldyBFcnJvcihcIlNoYXJlZCB0cmFuc2FjdGlvbiBicm9rZXIgc2Vzc2lvbiBkb2VzIG5vdCBvd24gdGhlIHJvb3QgdHJhbnNhY3Rpb24gbGVhc2VcIilcbiAgICBpZiAoc2F2ZVBvaW50TmFtZSAhPT0gbGVhc2Uuc2F2ZVBvaW50TmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciByb290IHRyYW5zYWN0aW9uIHNhdmVwb2ludCBkb2VzIG5vdCBtYXRjaCBpdHMgbGVhc2VcIilcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuc2VyaWFsaXplTGVhc2UobGVhc2UsIGNhbGxiYWNrKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBzdGF0ZS5sZWFzZSA9IHVuZGVmaW5lZFxuICAgICAgc3RhdGUucm9vdFNlc3Npb25zLmRlbGV0ZShzb2NrZXQpXG4gICAgICBsZWFzZS5yZWxlYXNlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvcGVyYXRpb25zIGJlbG9uZ2luZyB0byB0aGUgYWN0aXZlIGxlYXNlIGhvbGRlci5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uczogUHJvbWlzZTx2b2lkPn19IGxlYXNlIC0gQWN0aXZlIGxlYXNlLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXN1bHQuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemVMZWFzZShsZWFzZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcmV2aW91cyA9IGxlYXNlLm9wZXJhdGlvbnNcbiAgICAvKipcbiAgICAgKiBSZWxlYXNlcyB0aGUgaG9sZGVyIG9wZXJhdGlvbiBxdWV1ZS5cbiAgICAgKiBAdHlwZSB7KHZhbHVlPzogdm9pZCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVsZWFzZSA9ICgpID0+IHt9XG4gICAgY29uc3QgY3VycmVudCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlbGVhc2UgPSByZXNvbHZlIH0pXG4gICAgbGVhc2Uub3BlcmF0aW9ucyA9IHByZXZpb3VzLnRoZW4oKCkgPT4gY3VycmVudClcbiAgICBhd2FpdCBwcmV2aW91c1xuICAgIHRyeSB7IHJldHVybiBhd2FpdCBjYWxsYmFjaygpIH0gZmluYWxseSB7IHJlbGVhc2UoKSB9XG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayBsZWFzZXMgYWJhbmRvbmVkIGJ5IGEgZGlzY29ubmVjdGVkIHNlc3Npb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwid3NcIikuV2ViU29ja2V0fSBzb2NrZXQgLSBEaXNjb25uZWN0ZWQgc2Vzc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIG93bmVkIGxlYXNlcyByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZURpc2Nvbm5lY3RlZExlYXNlcyhzb2NrZXQpIHtcbiAgICAvKiogQHR5cGUge0FycmF5PEVycm9yPn0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuICAgIGZvciAoY29uc3QgW2Nvbm5lY3Rpb24sIHN0YXRlXSBvZiB0aGlzLmNvbm5lY3Rpb25TdGF0ZXMpIHtcbiAgICAgIGNvbnN0IGxlYXNlID0gc3RhdGUubGVhc2VcbiAgICAgIGlmICghbGVhc2UgfHwgbGVhc2Uuc29ja2V0ICE9PSBzb2NrZXQpIGNvbnRpbnVlXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZUxlYXNlKGxlYXNlLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja1Jvb3RTYXZlUG9pbnQoY29ubmVjdGlvbiwgbGVhc2Uuc2F2ZVBvaW50TmFtZSlcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHN0YXRlLmxlYXNlID0gdW5kZWZpbmVkXG4gICAgICAgIHN0YXRlLnJvb3RTZXNzaW9ucy5kZWxldGUoc29ja2V0KVxuICAgICAgICBsZWFzZS5yZWxlYXNlKClcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBgU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBsZWFzZSBjbGVhbnVwIGZhaWxlZDogJHtlcnJvcnMubWFwKChlcnJvcikgPT4gZXJyb3IubWVzc2FnZSkuam9pbihcIjsgXCIpfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRyYWNrcyBkZXRhY2hlZCBzb2NrZXQgY2xlYW51cCBhbmQgcmVjb3JkcyBpdHMgZmFpbHVyZSBmb3IgY2xvc2UoKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJ3c1wiKS5XZWJTb2NrZXR9IHNvY2tldCAtIENsb3NlZCBzZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTZXR0bGVkIHRyYWNrZWQgY2xlYW51cC5cbiAgICovXG4gIHNjaGVkdWxlU2Vzc2lvbkNsZWFudXAoc29ja2V0KSB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnNlc3Npb25DbGVhbnVwLmdldChzb2NrZXQpXG4gICAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3RpbmdcbiAgICBjb25zdCBjbGVhbnVwID0gdGhpcy5yZWxlYXNlRGlzY29ubmVjdGVkTGVhc2VzKHNvY2tldClcbiAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5jbGVhbnVwRXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfSlcbiAgICAgIC5maW5hbGx5KCgpID0+IHRoaXMuc2Vzc2lvbkNsZWFudXAuZGVsZXRlKHNvY2tldCkpXG4gICAgdGhpcy5zZXNzaW9uQ2xlYW51cC5zZXQoc29ja2V0LCBjbGVhbnVwKVxuICAgIHJldHVybiBjbGVhbnVwXG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayBhbmQgcmVtb3ZlcyBhIHJvb3Qgc2F2ZXBvaW50IHNvIGl0IGNhbm5vdCByZW1haW4gYmVuZWF0aCB0aGUgbmV4dCBsZWFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGNvbm5lY3Rpb24gLSBQYXJlbnQgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBSb290IHNhdmVwb2ludCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByb2xsYmFjayBhbmQgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrUm9vdFNhdmVQb2ludChjb25uZWN0aW9uLCBzYXZlUG9pbnROYW1lKSB7XG4gICAgY29uc3QgbWV0aG9kcyA9IC8qKiBAdHlwZSB7e3JlbGVhc2VTYXZlUG9pbnQ6IChuYW1lOiBzdHJpbmcsIG9wdGlvbnM/OiB7b3BlcmF0aW9uT3duZXI/OiBzeW1ib2x9KSA9PiBQcm9taXNlPHZvaWQ+LCByb2xsYmFja1NhdmVQb2ludDogKG5hbWU6IHN0cmluZywgb3B0aW9ucz86IHtvcGVyYXRpb25Pd25lcj86IHN5bWJvbH0pID0+IFByb21pc2U8dm9pZD59fSAqLyAoY29ubmVjdGlvbilcbiAgICBjb25zdCBvcGVyYXRpb25Pd25lciA9IHRoaXMuY29ubmVjdGlvbkNvb3JkaW5hdG9yT3duZXJzLmdldChjb25uZWN0aW9uKVxuXG4gICAgaWYgKCFvcGVyYXRpb25Pd25lcikgdGhyb3cgbmV3IEVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjb25uZWN0aW9uIG93bmVyIGlzIG1pc3NpbmdcIilcbiAgICAvKiogQHR5cGUge0FycmF5PEVycm9yPn0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBtZXRob2RzLnJvbGxiYWNrU2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIHtvcGVyYXRpb25Pd25lcn0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG1ldGhvZHMucmVsZWFzZVNhdmVQb2ludChzYXZlUG9pbnROYW1lLCB7b3BlcmF0aW9uT3duZXJ9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgfVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgYFNoYXJlZCB0cmFuc2FjdGlvbiBicm9rZXIgY291bGQgbm90IGNsZWFuIHJvb3Qgc2F2ZXBvaW50ICR7c2F2ZVBvaW50TmFtZX06ICR7ZXJyb3JzLm1hcCgoZXJyb3IpID0+IGVycm9yLm1lc3NhZ2UpLmpvaW4oXCI7IFwiKX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIG9yZGluYXJ5IG5vbi1ob2xkZXIgd29yayB0aHJvdWdoIHRoZSBjb25uZWN0aW9uIEZJRk8uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7Q29ubmVjdGlvblN0YXRlfSBzdGF0ZSAtIENvbm5lY3Rpb24gc3RhdGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBXb3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBXb3JrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZShzdGF0ZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcmV2aW91cyA9IHN0YXRlLnF1ZXVlXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIGN1cnJlbnQgcXVldWUgZW50cnkuXG4gICAgICogQHR5cGUgeyh2YWx1ZT86IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlbGVhc2UgPSAoKSA9PiB7fVxuICAgIGNvbnN0IGN1cnJlbnQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZWxlYXNlID0gcmVzb2x2ZSB9KVxuICAgIGNvbnN0IHF1ZXVlZCA9IHByZXZpb3VzLnRoZW4oKCkgPT4gY3VycmVudClcbiAgICBzdGF0ZS5xdWV1ZSA9IHF1ZXVlZFxuICAgIGF3YWl0IHByZXZpb3VzXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlbGVhc2UoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9wcyBhZG1pc3Npb24sIHJldm9rZXMgY2FwYWJpbGl0eSwgcmVqZWN0cyBjbGllbnRzLCBhbmQgZHJhaW5zIGFjdGl2ZSB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0cmFuc3BvcnQgc2h1dGRvd24uXG4gICAqL1xuICBhc3luYyBjbG9zZSgpIHtcbiAgICBpZiAodGhpcy5jbG9zZVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLmNsb3NlUHJvbWlzZVxuICAgIHRoaXMuY2xvc2VQcm9taXNlID0gdGhpcy5jbG9zZVRyYW5zcG9ydCgpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY2xvc2VQcm9taXNlXG4gIH1cblxuICAvKiogUmV2b2tlcyBhZG1pc3Npb24gd2l0aG91dCBpbnRlcnJ1cHRpbmcgYWxyZWFkeSBhY2NlcHRlZCB3b3JrLiAqL1xuICByZXZva2UoKSB7XG4gICAgaWYgKCF0aGlzLmFjY2VwdGluZykgcmV0dXJuXG4gICAgdGhpcy5hY2NlcHRpbmcgPSBmYWxzZVxuICAgIHRoaXMuc2VjcmV0ID0gcmFuZG9tQnl0ZXMoMzIpLnRvU3RyaW5nKFwiYmFzZTY0dXJsXCIpXG4gIH1cblxuICAvKiogRHJhaW5zIGFsbCB3b3JrIGFjY2VwdGVkIGJlZm9yZSBjYXBhYmlsaXR5IHJldm9jYXRpb24uICovXG4gIGFzeW5jIGRyYWluKCkge1xuICAgIGlmICh0aGlzLmFjY2VwdGluZykgdGhyb3cgbmV3IEVycm9yKFwiU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBtdXN0IGJlIHJldm9rZWQgYmVmb3JlIGRyYWluXCIpXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbSh0aGlzLmNvbm5lY3Rpb25TdGF0ZXMudmFsdWVzKCkpLm1hcCgoc3RhdGUpID0+IHN0YXRlLnF1ZXVlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtcyBkZXRlcm1pbmlzdGljIHRyYW5zcG9ydCBzaHV0ZG93biBhbmQgcmVwb3J0cyBjbGVhbnVwIGZhaWx1cmVzIGxhc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNodXRkb3duIG9yIHJlamVjdHMgd2l0aCBjbGVhbnVwIGVycm9ycy5cbiAgICovXG4gIGFzeW5jIGNsb3NlVHJhbnNwb3J0KCkge1xuICAgIHRoaXMucmV2b2tlKClcbiAgICBjb25zdCBjbG9zaW5nU2Vzc2lvbnMgPSBBcnJheS5mcm9tKHRoaXMuc2Vzc2lvbnMpXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoY2xvc2luZ1Nlc3Npb25zLm1hcChhc3luYyAoc29ja2V0KSA9PiBhd2FpdCB0aGlzLnNjaGVkdWxlU2Vzc2lvbkNsZWFudXAoc29ja2V0KSkpXG4gICAgYXdhaXQgdGhpcy5kcmFpbigpXG4gICAgZm9yIChjb25zdCBzb2NrZXQgb2YgY2xvc2luZ1Nlc3Npb25zKSBzb2NrZXQuY2xvc2UoMTAwMSwgXCJTaGFyZWQgdHJhbnNhY3Rpb24gYnJva2VyIGNsb3NlZFwiKVxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB0aGlzLndlYnNvY2tldFNlcnZlci5jbG9zZSgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB0aGlzLmh0dHBTZXJ2ZXIuY2xvc2UoKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKSlcbiAgICBhd2FpdCBQcm9taXNlLmFsbChBcnJheS5mcm9tKHRoaXMuc2Vzc2lvbkNsZWFudXAudmFsdWVzKCkpKVxuICAgIGZvciAoY29uc3QgW2Nvbm5lY3Rpb24sIGNvb3JkaW5hdG9yXSBvZiB0aGlzLmNvbm5lY3Rpb25Db29yZGluYXRvcnMpIHtcbiAgICAgIGNsZWFyU2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvcihjb25uZWN0aW9uLCBjb29yZGluYXRvcilcbiAgICB9XG4gICAgaWYgKHRoaXMuY2xlYW51cEVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IodGhpcy5jbGVhbnVwRXJyb3JzLCBgU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjbGVhbnVwIGZhaWxlZDogJHt0aGlzLmNsZWFudXBFcnJvcnMubWFwKChlcnJvcikgPT4gZXJyb3IubWVzc2FnZSkuam9pbihcIjsgXCIpfWApXG4gICAgfVxuICB9XG59XG4iXX0=