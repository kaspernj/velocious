import net from "node:net";
/** Package-owned acknowledged lifecycle control server. */
export default class BackgroundJobsLifecycleControlServer {
    configuration: import("../configuration.js").default;
    generationId: string;
    main: import("./main.js").default;
    socketPath: string;
    /** @type {net.Server | undefined} */
    server: net.Server | undefined;
    /** @type {{dev: number, ino: number} | undefined} */
    ownedSocketIdentity: {
        dev: number;
        ino: number;
    } | undefined;
    /** @type {Set<net.Socket>} */
    connections: Set<net.Socket>;
    /**
     * Creates a lifecycle control server.
     * @param {object} args - Server options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} args.generationId - Exact generation identity.
     * @param {import("./main.js").default} args.main - Owned jobs main.
     * @param {string} args.socketPath - Release-local Unix socket path.
     */
    constructor({ configuration, generationId, main, socketPath }: {
        configuration: import("../configuration.js").default;
        generationId: string;
        main: import("./main.js").default;
        socketPath: string;
    });
    /**
     * Starts the secure local listener.
     * @returns {Promise<void>} - Resolves after secure listen.
     */
    start(): Promise<void>;
    /**
     * Closes the owned listener.
     * @returns {Promise<void>} - Closes connections, listener, and only its owned path.
     */
    close(): Promise<void>;
    /**
     * Moves a replacement inode aside because Node unlinks its original Unix
     * socket pathname during `server.close()` without checking the inode.
     * @returns {Promise<string | undefined>} - Protected sibling path.
     */
    _protectReplacementDuringServerClose(): Promise<string | undefined>;
    /**
     * Restores an inode protected across Node's automatic Unix-socket unlink.
     * @param {string | undefined} protectedPath - Protected sibling path.
     * @returns {Promise<void>} - Resolves after restoration.
     */
    _restoreProtectedReplacement(protectedPath: string | undefined): Promise<void>;
    /** Validates that the parent is a process-owned real directory inside the release. */
    _validateParentDirectory(): Promise<void>;
    /** Removes only a same-owner, unchanged, stale socket inode. */
    _removeStaleOwnedSocket(): Promise<void>;
    /**
     * Probes a socket collision.
     * @returns {Promise<boolean>} - Whether the existing socket accepts a connection.
     */
    _socketAcceptsConnections(): Promise<boolean>;
    /** Unlinks the path only while it is still the inode created by this server. */
    _unlinkOwnedSocket(): Promise<void>;
    /**
     * Handles a local connection.
     * @param {net.Socket} socket - Accepted local connection.
     */
    _handleConnection(socket: net.Socket): void;
    /**
     * Handles exactly one request and holds retirement open through response flush.
     * @param {object} args - Request context.
     * @param {ReturnType<typeof JSON.parse>} args.message - Parsed message.
     * @param {net.Socket} args.socket - Control socket.
     * @returns {Promise<void>} - Resolves after the response is queued.
     */
    _handleRequest({ message, socket }: {
        message: ReturnType<typeof JSON.parse>;
        socket: net.Socket;
    }): Promise<void>;
    /**
     * Validates one lifecycle request.
     * @param {ReturnType<typeof JSON.parse>} message - Request.
     */
    _validateRequest(message: ReturnType<typeof JSON.parse>): void;
    /**
     * Writes one lifecycle response.
     * @param {net.Socket} socket - Response socket.
     * @param {ReturnType<typeof JSON.parse>} response - Response.
     */
    _writeResponse(socket: net.Socket, response: ReturnType<typeof JSON.parse>): void;
    /**
     * Emits a lifecycle failure where ignored hook stdio cannot hide it.
     * @param {object} args - Failure context.
     * @param {string} args.action - Requested action.
     * @param {Error} args.error - Original error.
     * @param {string} args.requestId - Request id.
     */
    _emitLifecycleFailure({ action, error, requestId }: {
        action: string;
        error: Error;
        requestId: string;
    }): void;
}
//# sourceMappingURL=lifecycle-control-server.d.ts.map