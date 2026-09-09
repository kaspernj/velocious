import net from "net";
import JsonSocket from "../background-jobs/json-socket.js";
import Logger from "../logger.js";
/**
 * Beacon broker daemon.
 *
 * Accepts JsonSocket connections from any number of peer processes and
 * fans every `broadcast` message out to every connected peer.
 * Intentionally stateless — there is no persistence, no replay, no
 * channel-name filtering on the daemon. Per-process subscription
 * matching (already implemented by `_broadcastToChannelLocal`) does the
 * filtering.
 */
export default class BeaconServer {
    configuration: import("../configuration.js").default;
    host: string;
    port: number;
    logger: Logger;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<JsonSocket>} */
    peers: Set<JsonSocket>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {net.Server | undefined} */
    server: net.Server | undefined;
    /**
     * Accepted sockets, including connections that have not completed the hello handshake yet.
     * @type {Set<net.Socket>}
     */
    sockets: Set<net.Socket>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.host] - Hostname to bind. Defaults to the configured beacon host.
     * @param {number} [args.port] - Port to bind. Defaults to the configured beacon port.
     */
    constructor({ configuration, host, port }: {
        configuration: import("../configuration.js").default;
        host?: string;
        port?: number;
    });
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when listening.
     */
    start(): Promise<void>;
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when closed.
     */
    stop(): Promise<void>;
    /**
     * Runs get port.
     * @returns {number} - Bound port.
     */
    getPort(): number;
    /**
     * Runs get peer count.
     * @returns {number} - Number of connected peers.
     */
    getPeerCount(): number;
    /**
     * Runs handle connection.
     * @param {import("net").Socket} socket - Socket.
     * @returns {void}
     */
    _handleConnection(socket: import("net").Socket): void;
    /**
     * Runs fan out.
     * @param {import("./types.js").BeaconBroadcastMessage} message - Broadcast message.
     * @returns {void}
     */
    _fanOut(message: import("./types.js").BeaconBroadcastMessage): void;
}
//# sourceMappingURL=server.d.ts.map