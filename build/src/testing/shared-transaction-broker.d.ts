import { EventEmitter } from "node:events";
export type ConnectionState = {
    queue: Promise<void>;
    rootSessions: Set<import("ws").WebSocket>;
    lease?: {
        operations: Promise<void>;
        release: () => void;
        savePointName: string;
        socket: import("ws").WebSocket;
    };
};
export default class SharedTransactionBroker extends EventEmitter {
    connections: Record<string, object>;
    secret: string;
    accepting: boolean;
    /** @type {Map<object, ConnectionState>} */
    connectionStates: Map<object, ConnectionState>;
    /** @type {Set<import("ws").WebSocket>} */
    sessions: Set<import("ws").WebSocket>;
    /** @type {Map<import("ws").WebSocket, Promise<void>>} */
    sessionCleanup: Map<import("ws").WebSocket, Promise<void>>;
    /** @type {Array<Error>} */
    cleanupErrors: Array<Error>;
    /** @type {Promise<void> | undefined} */
    closePromise: Promise<void> | undefined;
    /** @type {Map<object, (callback: () => Promise<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>>} */
    connectionCoordinators: Map<object, (callback: () => Promise<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>>;
    /** @type {Map<object, symbol>} */
    connectionCoordinatorOwners: Map<object, symbol>;
    physicalConnections: Map<any, any>;
    httpServer: import("node:http").Server<typeof import("node:http").IncomingMessage, typeof import("node:http").ServerResponse>;
    websocketServer: import("ws").Server<typeof import("ws").WebSocket, typeof import("node:http").IncomingMessage>;
    /**
     * Creates a broker around parent-owned physical connections.
     * @param {{connections: Record<string, object>}} args - Parent-owned physical connections.
     */
    constructor({ connections }: {
        connections: Record<string, object>;
    });
    /**
     * Installs serialization ownership for a newly enrolled physical connection.
     * @param {object} connection - Parent-owned physical connection.
     * @returns {void}
     */
    installConnectionCoordinator(connection: object): void;
    /**
     * Enrolls one exact physical database identity in this capability's rollback set.
     * @param {{connection: object, databaseIdentifier: string, reuseKey: string}} args - Physical connection identity.
     * @returns {void}
     */
    enrollConnection({ connection, databaseIdentifier, reuseKey }: {
        connection: object;
        databaseIdentifier: string;
        reuseKey: string;
    }): void;
    /**
     * Starts a broker on an ephemeral loopback port.
     * @param {{connections: Record<string, object>}} args - Parent-owned physical connections.
     * @returns {Promise<SharedTransactionBroker>} - Listening broker.
     */
    static start(args: {
        connections: Record<string, object>;
    }): Promise<SharedTransactionBroker>;
    /**
     * Gets the loopback websocket address.
     * @returns {string} - Loopback websocket address.
     */
    address(): string;
    /**
     * Gets the per-attempt unguessable capability.
     * @returns {string} - Per-attempt unguessable capability.
     */
    capability(): string;
    /**
     * Validates and handles one request.
     * @param {import("ws").WebSocket} socket - Calling session.
     * @param {string} serialized - Request JSON.
     * @returns {Promise<void>} - Resolves after responding.
     */
    handleRequest(socket: import("ws").WebSocket, serialized: string): Promise<void>;
    /**
     * Adds the broker owner to public driver methods that re-enter coordinated query work.
     * @param {{args: Array<ReturnType<typeof JSON.parse>>, connection: object, method: string}} args - Physical invocation.
     * @returns {Array<ReturnType<typeof JSON.parse> | {operationOwner: symbol}>} - Owned method arguments.
     */
    ownedMethodArgs({ args, connection, method }: {
        args: Array<ReturnType<typeof JSON.parse>>;
        connection: object;
        method: string;
    }): Array<ReturnType<typeof JSON.parse> | {
        operationOwner: symbol;
    }>;
    /**
     * Gets mutable serialization state for one physical connection.
     * @param {object} connection - Physical connection.
     * @returns {ConnectionState} - Connection state.
     */
    connectionState(connection: object): ConnectionState;
    /**
     * Runs a validated request with root transaction lease semantics.
     * @template T
     * @param {{connection: object, method: string, savePointName: string | undefined, socket: import("ws").WebSocket}} args - Request identity.
     * @param {() => Promise<T>} callback - Physical operation.
     * @returns {Promise<T>} - Operation result.
     */
    runConnectionRequest<T>({ connection, method, savePointName, socket }: {
        connection: object;
        method: string;
        savePointName: string | undefined;
        socket: import("ws").WebSocket;
    }, callback: () => Promise<T>): Promise<T>;
    /**
     * Acquires the FIFO physical connection lease and holds the queue until end.
     * @template T
     * @param {{callback: () => Promise<T>, savePointName: string, state: ConnectionState, socket: import("ws").WebSocket}} args - Lease request.
     * @returns {Promise<T>} - Root savepoint start result.
     */
    startRootLease<T>({ callback, savePointName, state, socket }: {
        callback: () => Promise<T>;
        savePointName: string;
        state: ConnectionState;
        socket: import("ws").WebSocket;
    }): Promise<T>;
    /**
     * Finishes the calling session's root lease.
     * @template T
     * @param {{callback: () => Promise<T>, savePointName: string | undefined, state: ConnectionState, socket: import("ws").WebSocket}} args - Lease end request.
     * @returns {Promise<T>} - Savepoint end result.
     */
    finishRootLease<T>({ callback, savePointName, state, socket }: {
        callback: () => Promise<T>;
        savePointName: string | undefined;
        state: ConnectionState;
        socket: import("ws").WebSocket;
    }): Promise<T>;
    /**
     * Serializes operations belonging to the active lease holder.
     * @template T
     * @param {{operations: Promise<void>}} lease - Active lease.
     * @param {() => Promise<T>} callback - Operation.
     * @returns {Promise<T>} - Result.
     */
    serializeLease<T>(lease: {
        operations: Promise<void>;
    }, callback: () => Promise<T>): Promise<T>;
    /**
     * Rolls back leases abandoned by a disconnected session.
     * @param {import("ws").WebSocket} socket - Disconnected session.
     * @returns {Promise<void>} - Resolves after all owned leases release.
     */
    releaseDisconnectedLeases(socket: import("ws").WebSocket): Promise<void>;
    /**
     * Tracks detached socket cleanup and records its failure for close().
     * @param {import("ws").WebSocket} socket - Closed session.
     * @returns {Promise<void>} - Settled tracked cleanup.
     */
    scheduleSessionCleanup(socket: import("ws").WebSocket): Promise<void>;
    /**
     * Rolls back and removes a root savepoint so it cannot remain beneath the next lease.
     * @param {object} connection - Parent physical connection.
     * @param {string} savePointName - Root savepoint name.
     * @returns {Promise<void>} - Resolves after rollback and release.
     */
    rollbackRootSavePoint(connection: object, savePointName: string): Promise<void>;
    /**
     * Serializes ordinary non-holder work through the connection FIFO.
     * @template T
     * @param {ConnectionState} state - Connection state.
     * @param {() => Promise<T>} callback - Work.
     * @returns {Promise<T>} - Work result.
     */
    serialize<T>(state: ConnectionState, callback: () => Promise<T>): Promise<T>;
    /**
     * Stops admission, revokes capability, rejects clients, and drains active work.
     * @returns {Promise<void>} - Resolves after transport shutdown.
     */
    close(): Promise<void>;
    /** Revokes admission without interrupting already accepted work. */
    revoke(): void;
    /** Drains all work accepted before capability revocation. */
    drain(): Promise<void>;
    /**
     * Performs deterministic transport shutdown and reports cleanup failures last.
     * @returns {Promise<void>} - Resolves after shutdown or rejects with cleanup errors.
     */
    closeTransport(): Promise<void>;
}
//# sourceMappingURL=shared-transaction-broker.d.ts.map