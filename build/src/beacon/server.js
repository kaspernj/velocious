// @ts-check
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
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.host] - Hostname to bind. Defaults to the configured beacon host.
     * @param {number} [args.port] - Port to bind. Defaults to the configured beacon port.
     */
    constructor({ configuration, host, port }) {
        this.configuration = configuration;
        const config = configuration.getBeaconConfig();
        this.host = host || config.host;
        this.port = typeof port === "number" ? port : config.port;
        this.logger = new Logger(this);
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<JsonSocket>} */
        this.peers = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {net.Server | undefined} */
        this.server = undefined;
        /**
         * Accepted sockets, including connections that have not completed the hello handshake yet.
         * @type {Set<net.Socket>}
         */
        this.sockets = new Set();
    }
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when listening.
     */
    async start() {
        const server = net.createServer((socket) => this._handleConnection(socket));
        this.server = server;
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(this.port, this.host, () => resolve(undefined));
        });
        const address = server.address();
        if (address && typeof address === "object") {
            this.port = address.port;
        }
    }
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when closed.
     */
    async stop() {
        for (const peer of this.peers) {
            peer.close();
        }
        for (const socket of this.sockets) {
            socket.destroy();
        }
        if (!this.server)
            return;
        const { server } = this;
        await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
    /**
     * Runs get port.
     * @returns {number} - Bound port.
     */
    getPort() {
        return this.port;
    }
    /**
     * Runs get peer count.
     * @returns {number} - Number of connected peers.
     */
    getPeerCount() {
        return this.peers.size;
    }
    /**
     * Runs handle connection.
     * @param {import("net").Socket} socket - Socket.
     * @returns {void}
     */
    _handleConnection(socket) {
        this.sockets.add(socket);
        const jsonSocket = new JsonSocket(socket);
        /**
         * Defines peerId.
         * @type {string | undefined} */
        let peerId;
        const cleanup = () => {
            this.sockets.delete(socket);
            this.peers.delete(jsonSocket);
        };
        jsonSocket.on("close", cleanup);
        jsonSocket.on("error", (error) => {
            this.logger.warn(() => ["Beacon connection error:", error]);
            cleanup();
        });
        /**
         * Handles a beacon socket message.
         * @param {import("./types.js").BeaconSocketMessage} message - Socket message.
         */
        jsonSocket.on("message", (message) => {
            if (!peerId && message?.type === "hello") {
                peerId = message.peerId;
                this.peers.add(jsonSocket);
                jsonSocket.send({ type: "hello-ack", peerId });
                return;
            }
            if (message?.type === "broadcast") {
                this._fanOut(message);
            }
        });
    }
    /**
     * Runs fan out.
     * @param {import("./types.js").BeaconBroadcastMessage} message - Broadcast message.
     * @returns {void}
     */
    _fanOut(message) {
        for (const peer of this.peers) {
            try {
                peer.send(message);
            }
            catch (error) {
                this.logger.warn(() => ["Beacon fan-out send failed:", error]);
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JlYWNvbi9zZXJ2ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUVyQixPQUFPLFVBQVUsTUFBTSxtQ0FBbUMsQ0FBQTtBQUMxRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFFakM7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxZQUFZO0lBQy9COzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBQztRQUNyQyxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDOUMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQTtRQUMvQixJQUFJLENBQUMsSUFBSSxHQUFHLE9BQU8sSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFBO1FBQ3pELElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDOUI7O3FDQUU2QjtRQUM3QixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDdEI7OzRDQUVvQztRQUNwQyxJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQTtRQUN2Qjs7O1dBR0c7UUFDSCxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMs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LFVBQVUsQ0FBQyxDQUFBO2dCQUMxQixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO2dCQUM1QyxPQUFNO1lBQ1IsQ0FBQztZQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxXQUFXLEVBQUUsQ0FBQztnQkFDbEMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUN2QixDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE9BQU8sQ0FBQyxPQUFPO1FBQ2IsS0FBSyxNQUFNLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDOUIsSUFBSSxDQUFDO2dCQUNILElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDcEIsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyw2QkFBNkIsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQ2hFLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiXG5cbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuLi9iYWNrZ3JvdW5kLWpvYnMvanNvbi1zb2NrZXQuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcblxuLyoqXG4gKiBCZWFjb24gYnJva2VyIGRhZW1vbi5cbiAqXG4gKiBBY2NlcHRzIEpzb25Tb2NrZXQgY29ubmVjdGlvbnMgZnJvbSBhbnkgbnVtYmVyIG9mIHBlZXIgcHJvY2Vzc2VzIGFuZFxuICogZmFucyBldmVyeSBgYnJvYWRjYXN0YCBtZXNzYWdlIG91dCB0byBldmVyeSBjb25uZWN0ZWQgcGVlci5cbiAqIEludGVudGlvbmFsbHkgc3RhdGVsZXNzIOKAlCB0aGVyZSBpcyBubyBwZXJzaXN0ZW5jZSwgbm8gcmVwbGF5LCBub1xuICogY2hhbm5lbC1uYW1lIGZpbHRlcmluZyBvbiB0aGUgZGFlbW9uLiBQZXItcHJvY2VzcyBzdWJzY3JpcHRpb25cbiAqIG1hdGNoaW5nIChhbHJlYWR5IGltcGxlbWVudGVkIGJ5IGBfYnJvYWRjYXN0VG9DaGFubmVsTG9jYWxgKSBkb2VzIHRoZVxuICogZmlsdGVyaW5nLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCZWFjb25TZXJ2ZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdG5hbWUgdG8gYmluZC4gRGVmYXVsdHMgdG8gdGhlIGNvbmZpZ3VyZWQgYmVhY29uIGhvc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb3J0XSAtIFBvcnQgdG8gYmluZC4gRGVmYXVsdHMgdG8gdGhlIGNvbmZpZ3VyZWQgYmVhY29uIHBvcnQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaG9zdCwgcG9ydH0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgY29uZmlnID0gY29uZmlndXJhdGlvbi5nZXRCZWFjb25Db25maWcoKVxuICAgIHRoaXMuaG9zdCA9IGhvc3QgfHwgY29uZmlnLmhvc3RcbiAgICB0aGlzLnBvcnQgPSB0eXBlb2YgcG9ydCA9PT0gXCJudW1iZXJcIiA/IHBvcnQgOiBjb25maWcucG9ydFxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMucGVlcnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge25ldC5TZXJ2ZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zZXJ2ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBBY2NlcHRlZCBzb2NrZXRzLCBpbmNsdWRpbmcgY29ubmVjdGlvbnMgdGhhdCBoYXZlIG5vdCBjb21wbGV0ZWQgdGhlIGhlbGxvIGhhbmRzaGFrZSB5ZXQuXG4gICAgICogQHR5cGUge1NldDxuZXQuU29ja2V0Pn1cbiAgICAgKi9cbiAgICB0aGlzLnNvY2tldHMgPSBuZXcgU2V0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGxpc3RlbmluZy5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIGNvbnN0IHNlcnZlciA9IG5ldC5jcmVhdGVTZXJ2ZXIoKHNvY2tldCkgPT4gdGhpcy5faGFuZGxlQ29ubmVjdGlvbihzb2NrZXQpKVxuICAgIHRoaXMuc2VydmVyID0gc2VydmVyXG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBzZXJ2ZXIub25jZShcImVycm9yXCIsIHJlamVjdClcbiAgICAgIHNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCB0aGlzLmhvc3QsICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgICB9KVxuXG4gICAgY29uc3QgYWRkcmVzcyA9IHNlcnZlci5hZGRyZXNzKClcblxuICAgIGlmIChhZGRyZXNzICYmIHR5cGVvZiBhZGRyZXNzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aGlzLnBvcnQgPSBhZGRyZXNzLnBvcnRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIGFzeW5jIHN0b3AoKSB7XG4gICAgZm9yIChjb25zdCBwZWVyIG9mIHRoaXMucGVlcnMpIHtcbiAgICAgIHBlZXIuY2xvc2UoKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc29ja2V0IG9mIHRoaXMuc29ja2V0cykge1xuICAgICAgc29ja2V0LmRlc3Ryb3koKVxuICAgIH1cblxuICAgIGlmICghdGhpcy5zZXJ2ZXIpIHJldHVyblxuXG4gICAgY29uc3Qge3NlcnZlcn0gPSB0aGlzXG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2VydmVyLmNsb3NlKCgpID0+IHJlc29sdmUodW5kZWZpbmVkKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcG9ydC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBCb3VuZCBwb3J0LlxuICAgKi9cbiAgZ2V0UG9ydCgpIHtcbiAgICByZXR1cm4gdGhpcy5wb3J0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcGVlciBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2YgY29ubmVjdGVkIHBlZXJzLlxuICAgKi9cbiAgZ2V0UGVlckNvdW50KCkge1xuICAgIHJldHVybiB0aGlzLnBlZXJzLnNpemVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5ldFwiKS5Tb2NrZXR9IHNvY2tldCAtIFNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQ29ubmVjdGlvbihzb2NrZXQpIHtcbiAgICB0aGlzLnNvY2tldHMuYWRkKHNvY2tldClcbiAgICBjb25zdCBqc29uU29ja2V0ID0gbmV3IEpzb25Tb2NrZXQoc29ja2V0KVxuICAgIC8qKlxuICAgICAqIERlZmluZXMgcGVlcklkLlxuICAgICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHBlZXJJZFxuXG4gICAgY29uc3QgY2xlYW51cCA9ICgpID0+IHtcbiAgICAgIHRoaXMuc29ja2V0cy5kZWxldGUoc29ja2V0KVxuICAgICAgdGhpcy5wZWVycy5kZWxldGUoanNvblNvY2tldClcbiAgICB9XG5cbiAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgY2xlYW51cClcbiAgICBqc29uU29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkJlYWNvbiBjb25uZWN0aW9uIGVycm9yOlwiLCBlcnJvcl0pXG4gICAgICBjbGVhbnVwKClcbiAgICB9KVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIGJlYWNvbiBzb2NrZXQgbWVzc2FnZS5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmVhY29uU29ja2V0TWVzc2FnZX0gbWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgICAqL1xuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAoIXBlZXJJZCAmJiBtZXNzYWdlPy50eXBlID09PSBcImhlbGxvXCIpIHtcbiAgICAgICAgcGVlcklkID0gbWVzc2FnZS5wZWVySWRcbiAgICAgICAgdGhpcy5wZWVycy5hZGQoanNvblNvY2tldClcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlbGxvLWFja1wiLCBwZWVySWR9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiYnJvYWRjYXN0XCIpIHtcbiAgICAgICAgdGhpcy5fZmFuT3V0KG1lc3NhZ2UpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZhbiBvdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CZWFjb25Ccm9hZGNhc3RNZXNzYWdlfSBtZXNzYWdlIC0gQnJvYWRjYXN0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Zhbk91dChtZXNzYWdlKSB7XG4gICAgZm9yIChjb25zdCBwZWVyIG9mIHRoaXMucGVlcnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHBlZXIuc2VuZChtZXNzYWdlKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJCZWFjb24gZmFuLW91dCBzZW5kIGZhaWxlZDpcIiwgZXJyb3JdKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIl19