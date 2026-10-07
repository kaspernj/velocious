// @ts-check
import Application from "../../application.js";
import Client from "../client/index.js";
import dispatchChannelSubscribers from "./channel-subscriber-dispatch.js";
import { digg } from "diggerize";
import errorLogger from "../../error-logger.js";
import Logger from "../../logger.js";
import toImportSpecifier from "../../utils/to-import-specifier.js";
import WebsocketEvents from "../websocket-events.js";
import { runShutdownSteps } from "../../utils/shutdown-lifecycle.js";
/**
 * Runs summarize client write chunk.
 * @param {Buffer | Uint8Array | string} chunk - Client input payload.
 * @returns {{length: number, preview: string}} - Chunk summary for logging.
 */
function summarizeClientWriteChunk(chunk) {
    const normalizedChunk = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    const preview = normalizedChunk.toString("latin1", 0, Math.min(normalizedChunk.length, 160)).replaceAll("\r", "\\r").replaceAll("\n", "\\n");
    return { length: normalizedChunk.length, preview };
}
export default class VelociousHttpServerWorkerHandlerWorkerThread {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("node:worker_threads").MessagePort | null} args.parentPort - Parent port.
     * @param {{debug: boolean, directory: string, environment: string, workerCount: number}} args.workerData - Worker configuration details.
     */
    constructor({ parentPort, workerData }) {
        if (!parentPort)
            throw new Error("parentPort is required");
        const { workerCount } = workerData;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<number, Client>} */
        this.clients = {};
        this.logger = new Logger(this);
        this.parentPort = parentPort;
        this.workerData = workerData;
        this.workerCount = workerCount;
        this.fileTransferCount = 0;
        /** @type {Map<number, {clientCount: number, settle: (result: "completed" | "aborted") => Promise<void>}>} */
        this.fileTransfers = new Map();
        parentPort.on("message", errorLogger(this.onCommand));
        this.initialize().then(() => {
            if (!this.application)
                throw new Error("Application not initialized");
            this.application.initialize().then(() => {
                this.logger.debugLowLevel(() => `Worker ${workerCount} started`);
                parentPort.postMessage({ command: "started" });
            });
        });
    }
    /**
     * Runs initialize.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initialize() {
        const { debug, directory, environment } = this.workerData;
        const configurationPath = `${directory}/src/config/configuration.js`;
        const configurationImport = await import(toImportSpecifier(configurationPath));
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("../../configuration.js").default} */
        this.configuration = configurationImport.default;
        if (!this.configuration)
            throw new Error(`Configuration couldn't be loaded from: ${configurationPath}`);
        const configuration = this.configuration;
        configuration.debug = debug === true;
        configuration.setEnvironment(environment);
        configuration.setCurrent();
        await this.logger.debug(() => ["Worker thread configuration loaded", { debug: configuration.debug, workerCount: this.workerCount }]);
        this.websocketEvents = new WebsocketEvents({ parentPort: this.parentPort, workerCount: this.workerCount });
        configuration.setWebsocketEvents(this.websocketEvents);
        this.application = new Application({ configuration, type: "worker-handler" });
        if (!configuration.isInitialized()) {
            await configuration.initialize({ type: "worker-handler" });
        }
    }
    /**
     * On command.
     * @param {object} data - Data payload.
     * @param {string} data.command - Command.
     * @param {Buffer | Uint8Array | string} [data.chunk] - Chunk.
     * @param {string} [data.remoteAddress] - Remote address.
     * @param {number} [data.clientCount] - Client count.
     * @param {string} [data.channel] - Channel name.
     * @param {string} [data.createdAt] - Event creation time.
     * @param {string} [data.eventId] - Event identifier.
     * @param {number} [data.requestId] - Debug request id.
     * @param {number} [data.transferId] - File transfer id.
     * @param {"completed" | "aborted"} [data.result] - File transfer result.
     * @param {ReturnType<typeof JSON.parse>} [data.payload] - Payload data.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [data.broadcastParams] - V2 broadcast filter params.
     * @param {ReturnType<typeof JSON.parse>} [data.body] - V2 broadcast body.
     */
    onCommand = async (data) => {
        await this.logger.debugLowLevel(() => [`Worker ${this.workerCount} received command`, data]);
        const command = data.command;
        if (command == "newClient") {
            this.handleNewClient(data);
        }
        else if (command == "clientWrite") {
            await this.handleClientWrite(data);
        }
        else if (command == "clientFileResult") {
            await this.handleClientFileResult(data);
        }
        else if (command == "clientAbort") {
            await this.handleClientAbort(data);
        }
        else if (command == "websocketEvent") {
            await this.handleWebsocketEvent(data);
        }
        else if (command == "websocketV2Broadcast") {
            this.handleWebsocketV2Broadcast(data);
        }
        else if (command == "debugSnapshot") {
            this.handleDebugSnapshot(data);
        }
        else if (command == "shutdown") {
            await this.handleShutdown();
        }
        else {
            throw new Error(`Unknown command: ${command}`);
        }
    };
    /**
     * Runs handle new client.
     * @param {object} data - Data payload.
     * @param {number} [data.clientCount] - Client count.
     * @param {string} [data.remoteAddress] - Remote address.
     * @returns {void}
     */
    handleNewClient(data) {
        if (!this.configuration)
            throw new Error("Configuration not initialized");
        const { clientCount, remoteAddress } = data;
        if (typeof clientCount !== "number")
            throw new Error("clientCount must be a number");
        const client = new Client({
            clientCount,
            configuration: this.configuration,
            remoteAddress
        });
        client.events.on("output", (output, { websocketFrame = false } = {}) => {
            this.parentPort.postMessage({ command: "clientOutput", clientCount, output, websocketFrame });
        });
        client.events.on("file", ({ filePath, sendBody, settle }) => {
            const transferId = ++this.fileTransferCount;
            this.fileTransfers.set(transferId, { clientCount, settle });
            this.parentPort.postMessage({ command: "clientFile", clientCount, filePath, sendBody, transferId });
        });
        client.events.on("close", (output) => {
            this.logger.debugLowLevel(() => "Close received from client in worker - forwarding to worker parent");
            this.parentPort.postMessage({ command: "clientClose", clientCount, output });
        });
        client.events.on("websocketSessionOwned", ({ sessionId }) => {
            this.parentPort.postMessage({ command: "websocketSessionOwned", sessionId });
        });
        client.events.on("websocketSessionReleased", ({ sessionId }) => {
            this.parentPort.postMessage({ command: "websocketSessionReleased", sessionId });
        });
        this.clients[clientCount] = client;
    }
    /**
     * Settles a file response after the parent finishes socket delivery.
     * @param {object} data - File result message.
     * @param {number} [data.transferId] - File transfer id.
     * @param {"completed" | "aborted"} [data.result] - File transfer result.
     * @returns {Promise<void>} - Resolves after the worker-side completion callback settles.
     */
    async handleClientFileResult(data) {
        const { result, transferId } = data;
        if (typeof transferId !== "number")
            throw new Error("transferId must be a number");
        if (result !== "completed" && result !== "aborted")
            throw new Error(`Unknown file transfer result: ${result}`);
        const transfer = this.fileTransfers.get(transferId);
        if (!transfer)
            return;
        this.fileTransfers.delete(transferId);
        await transfer.settle(result);
    }
    /**
     * Aborts file responses belonging to a closed parent-side socket.
     * @param {object} data - Client abort message.
     * @param {number} [data.clientCount] - Client count.
     * @returns {Promise<void>} - Resolves after pending completion callbacks settle.
     */
    async handleClientAbort(data) {
        const { clientCount } = data;
        if (typeof clientCount !== "number")
            throw new Error("clientCount must be a number");
        const settlements = [];
        const client = this.clients[clientCount];
        if (client) {
            settlements.push(client.abortPendingFileResponses());
            settlements.push(client.abortStreamResponses());
            // Buffered responses have no stream to abort, so their in-flight
            // handlers never hear about the socket teardown through the streaming
            // path: notify the running requests directly so they can settle
            // resources (e.g. admission queue positions) in-process.
            client.notifyClientDisconnect();
        }
        for (const [transferId, transfer] of this.fileTransfers) {
            if (transfer.clientCount !== clientCount)
                continue;
            this.fileTransfers.delete(transferId);
            settlements.push(transfer.settle("aborted"));
        }
        delete this.clients[clientCount];
        await Promise.all(settlements);
    }
    /**
     * Runs handle client write.
     * @param {object} data - Data payload.
     * @param {Buffer | Uint8Array | string} [data.chunk] - Chunk.
     * @param {number} [data.clientCount] - Client count.
     * @returns {Promise<void>} Resolves when the client write is dispatched.
     */
    async handleClientWrite(data) {
        await this.logger.debugLowLevel("Looking up client");
        const { chunk, clientCount } = data;
        if (!chunk)
            throw new Error("No chunk given");
        const client = /** @type {Client | undefined} */ (digg(this.clients, clientCount));
        if (!client)
            throw new Error(`Client not found for clientWrite: ${clientCount}`);
        const clientChunk = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
        await this.logger.debug(() => ["Sending clientWrite to parser", { clientCount, ...summarizeClientWriteChunk(clientChunk) }]);
        client.onWrite(clientChunk);
    }
    /**
     * Runs handle websocket event.
     * @param {object} data - Data payload.
     * @param {string} [data.channel] - Channel name.
     * @param {string} [data.createdAt] - Event creation time.
     * @param {string} [data.eventId] - Event identifier.
     * @param {ReturnType<typeof JSON.parse>} [data.payload] - Payload data.
     * @returns {Promise<void>} Resolves when the websocket event is dispatched.
     */
    async handleWebsocketEvent(data) {
        const { channel, createdAt, eventId, payload } = data;
        if (typeof channel !== "string")
            throw new Error("No channel given");
        await this.broadcastWebsocketEvent({ channel, createdAt, eventId, payload });
    }
    /**
     * Runs handle websocket v2 broadcast.
     * @param {object} data - Data payload.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [data.broadcastParams] - V2 broadcast filter params.
     * @param {ReturnType<typeof JSON.parse>} [data.body] - V2 broadcast body.
     * @param {string} [data.channel] - Channel name.
     * @param {string} [data.eventId] - Event identifier.
     * @returns {void}
     */
    handleWebsocketV2Broadcast(data) {
        const { body, broadcastParams, channel, eventId } = data;
        if (typeof channel !== "string")
            throw new Error("No channel given");
        if (!this.configuration)
            throw new Error("Configuration not initialized");
        this.configuration._broadcastToChannelLocal(channel, broadcastParams || {}, body, { eventId });
    }
    /**
     * Runs handle debug snapshot.
     * @param {object} data - Data payload.
     * @param {number} [data.requestId] - Debug request id.
     * @returns {void}
     */
    handleDebugSnapshot(data) {
        const { requestId } = data;
        if (typeof requestId !== "number")
            throw new Error("debugSnapshot requestId must be a number");
        if (!this.configuration)
            throw new Error("Configuration not initialized");
        this.parentPort.postMessage({
            command: "debugSnapshot",
            requestId,
            snapshot: this.configuration.getLocalDebugSnapshot()
        });
    }
    /**
     * Runs handle shutdown.
     * @returns {Promise<void>} Resolves after worker shutdown has been requested.
     */
    async handleShutdown() {
        const clients = Object.values(this.clients);
        await runShutdownSteps({
            message: "HTTP worker-handler shutdown failed",
            steps: [
                ...clients.map((client) => async () => await client.abortPendingFileResponses()),
                async () => {
                    this.fileTransfers.clear();
                    await this.application?.stop();
                }
            ]
        });
        this.parentPort.postMessage({ command: "shutdownComplete" });
        process.exit(0);
    }
    /**
     * Runs broadcast websocket event.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {string | undefined} args.createdAt - Event creation time.
     * @param {string | undefined} args.eventId - Event identifier.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async broadcastWebsocketEvent({ channel, createdAt, eventId, payload }) {
        const sendTasks = [];
        for (const clientKey of Object.keys(this.clients)) {
            const client = this.clients[Number(clientKey)];
            if (!client)
                continue;
            const session = client.websocketSession;
            if (!session)
                continue;
            sendTasks.push(session.sendEvent(channel, payload, {
                createdAt,
                eventId
            }));
        }
        if (this.configuration) {
            // Isolate channel subscriber failures so a buggy in-process callback
            // cannot reject this command and crash the worker thread, but still
            // surface the error to the framework error events so bug reporters
            // can pick it up.
            sendTasks.push(dispatchChannelSubscribers({ channel, configuration: this.configuration, createdAt, eventId, logger: this.logger, payload }));
        }
        await Promise.all(sendTasks);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLXRocmVhZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci93b3JrZXItaGFuZGxlci93b3JrZXItdGhyZWFkLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxzQkFBc0IsQ0FBQTtBQUM5QyxPQUFPLE1BQU0sTUFBTSxvQkFBb0IsQ0FBQTtBQUN2QyxPQUFPLDBCQUEwQixNQUFNLGtDQUFrQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxpQkFBaUIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUNsRSxPQUFPLGVBQWUsTUFBTSx3QkFBd0IsQ0FBQTtBQUNwRCxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxtQ0FBbUMsQ0FBQTtBQUVwRTs7OztHQUlHO0FBQ0gsU0FBUyx5QkFBeUIsQ0FBQyxLQUFLO0lBQ3RDLE1BQU0sZUFBZSxHQUFHLE9BQU8sS0FBSyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMzRixNQUFNLE9BQU8sR0FBRyxlQUFlLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBRTVJLE9BQU8sRUFBQyxNQUFNLEVBQUUsZUFBZSxDQUFDLE1BQU0sRUFBRSxPQUFP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QyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUE7SUFDOUIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBcHBsaWNhdGlvbiBmcm9tIFwiLi4vLi4vYXBwbGljYXRpb24uanNcIlxuaW1wb3J0IENsaWVudCBmcm9tIFwiLi4vY2xpZW50L2luZGV4LmpzXCJcbmltcG9ydCBkaXNwYXRjaENoYW5uZWxTdWJzY3JpYmVycyBmcm9tIFwiLi9jaGFubmVsLXN1YnNjcmliZXItZGlzcGF0Y2guanNcIlxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBlcnJvckxvZ2dlciBmcm9tIFwiLi4vLi4vZXJyb3ItbG9nZ2VyLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgdG9JbXBvcnRTcGVjaWZpZXIgZnJvbSBcIi4uLy4uL3V0aWxzL3RvLWltcG9ydC1zcGVjaWZpZXIuanNcIlxuaW1wb3J0IFdlYnNvY2tldEV2ZW50cyBmcm9tIFwiLi4vd2Vic29ja2V0LWV2ZW50cy5qc1wiXG5pbXBvcnQgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4uLy4uL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5cbi8qKlxuICogUnVucyBzdW1tYXJpemUgY2xpZW50IHdyaXRlIGNodW5rLlxuICogQHBhcmFtIHtCdWZmZXIgfCBVaW50OEFycmF5IHwgc3RyaW5nfSBjaHVuayAtIENsaWVudCBpbnB1dCBwYXlsb2FkLlxuICogQHJldHVybnMge3tsZW5ndGg6IG51bWJlciwgcHJldmlldzogc3RyaW5nfX0gLSBDaHVuayBzdW1tYXJ5IGZvciBsb2dnaW5nLlxuICovXG5mdW5jdGlvbiBzdW1tYXJpemVDbGllbnRXcml0ZUNodW5rKGNodW5rKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRDaHVuayA9IHR5cGVvZiBjaHVuayA9PT0gXCJzdHJpbmdcIiA/IEJ1ZmZlci5mcm9tKGNodW5rKSA6IEJ1ZmZlci5mcm9tKGNodW5rKVxuICBjb25zdCBwcmV2aWV3ID0gbm9ybWFsaXplZENodW5rLnRvU3RyaW5nKFwibGF0aW4xXCIsIDAsIE1hdGgubWluKG5vcm1hbGl6ZWRDaHVuay5sZW5ndGgsIDE2MCkpLnJlcGxhY2VBbGwoXCJcXHJcIiwgXCJcXFxcclwiKS5yZXBsYWNlQWxsKFwiXFxuXCIsIFwiXFxcXG5cIilcblxuICByZXR1cm4ge2xlbmd0aDogbm9ybWFsaXplZENodW5rLmxlbmd0aCwgcHJldmlld31cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlcldvcmtlckhhbmRsZXJXb3JrZXJUaHJlYWQge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOndvcmtlcl90aHJlYWRzXCIpLk1lc3NhZ2VQb3J0IHwgbnVsbH0gYXJncy5wYXJlbnRQb3J0IC0gUGFyZW50IHBvcnQuXG4gICAqIEBwYXJhbSB7e2RlYnVnOiBib29sZWFuLCBkaXJlY3Rvcnk6IHN0cmluZywgZW52aXJvbm1lbnQ6IHN0cmluZywgd29ya2VyQ291bnQ6IG51bWJlcn19IGFyZ3Mud29ya2VyRGF0YSAtIFdvcmtlciBjb25maWd1cmF0aW9uIGRldGFpbHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cGFyZW50UG9ydCwgd29ya2VyRGF0YX0pIHtcbiAgICBpZiAoIXBhcmVudFBvcnQpIHRocm93IG5ldyBFcnJvcihcInBhcmVudFBvcnQgaXMgcmVxdWlyZWRcIilcblxuICAgIGNvbnN0IHt3b3JrZXJDb3VudH0gPSB3b3JrZXJEYXRhXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxudW1iZXIsIENsaWVudD59ICovXG4gICAgdGhpcy5jbGllbnRzID0ge31cblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMucGFyZW50UG9ydCA9IHBhcmVudFBvcnRcbiAgICB0aGlzLndvcmtlckRhdGEgPSB3b3JrZXJEYXRhXG4gICAgdGhpcy53b3JrZXJDb3VudCA9IHdvcmtlckNvdW50XG4gICAgdGhpcy5maWxlVHJhbnNmZXJDb3VudCA9IDBcblxuICAgIC8qKiBAdHlwZSB7TWFwPG51bWJlciwge2NsaWVudENvdW50OiBudW1iZXIsIHNldHRsZTogKHJlc3VsdDogXCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwiKSA9PiBQcm9taXNlPHZvaWQ+fT59ICovXG4gICAgdGhpcy5maWxlVHJhbnNmZXJzID0gbmV3IE1hcCgpXG5cbiAgICBwYXJlbnRQb3J0Lm9uKFwibWVzc2FnZVwiLCBlcnJvckxvZ2dlcih0aGlzLm9uQ29tbWFuZCkpXG5cbiAgICB0aGlzLmluaXRpYWxpemUoKS50aGVuKCgpID0+IHtcbiAgICAgIGlmICghdGhpcy5hcHBsaWNhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQXBwbGljYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICAgIHRoaXMuYXBwbGljYXRpb24uaW5pdGlhbGl6ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBXb3JrZXIgJHt3b3JrZXJDb3VudH0gc3RhcnRlZGApXG4gICAgICAgIHBhcmVudFBvcnQucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwic3RhcnRlZFwifSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgIGNvbnN0IHtkZWJ1ZywgZGlyZWN0b3J5LCBlbnZpcm9ubWVudH0gPSB0aGlzLndvcmtlckRhdGFcbiAgICBjb25zdCBjb25maWd1cmF0aW9uUGF0aCA9IGAke2RpcmVjdG9yeX0vc3JjL2NvbmZpZy9jb25maWd1cmF0aW9uLmpzYFxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25JbXBvcnQgPSBhd2FpdCBpbXBvcnQodG9JbXBvcnRTcGVjaWZpZXIoY29uZmlndXJhdGlvblBhdGgpKVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9ICovXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbkltcG9ydC5kZWZhdWx0XG5cbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBDb25maWd1cmF0aW9uIGNvdWxkbid0IGJlIGxvYWRlZCBmcm9tOiAke2NvbmZpZ3VyYXRpb25QYXRofWApXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG5cbiAgICBjb25maWd1cmF0aW9uLmRlYnVnID0gZGVidWcgPT09IHRydWVcbiAgICBjb25maWd1cmF0aW9uLnNldEVudmlyb25tZW50KGVudmlyb25tZW50KVxuICAgIGNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wiV29ya2VyIHRocmVhZCBjb25maWd1cmF0aW9uIGxvYWRlZFwiLCB7ZGVidWc6IGNvbmZpZ3VyYXRpb24uZGVidWcsIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckNvdW50fV0pXG4gICAgdGhpcy53ZWJzb2NrZXRFdmVudHMgPSBuZXcgV2Vic29ja2V0RXZlbnRzKHtwYXJlbnRQb3J0OiB0aGlzLnBhcmVudFBvcnQsIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckNvdW50fSlcbiAgICBjb25maWd1cmF0aW9uLnNldFdlYnNvY2tldEV2ZW50cyh0aGlzLndlYnNvY2tldEV2ZW50cylcblxuICAgIHRoaXMuYXBwbGljYXRpb24gPSBuZXcgQXBwbGljYXRpb24oe2NvbmZpZ3VyYXRpb24sIHR5cGU6IFwid29ya2VyLWhhbmRsZXJcIn0pXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24uaXNJbml0aWFsaXplZCgpKSB7XG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLmluaXRpYWxpemUoe3R5cGU6IFwid29ya2VyLWhhbmRsZXJcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YS5jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHBhcmFtIHtCdWZmZXIgfCBVaW50OEFycmF5IHwgc3RyaW5nfSBbZGF0YS5jaHVua10gLSBDaHVuay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkYXRhLnJlbW90ZUFkZHJlc3NdIC0gUmVtb3RlIGFkZHJlc3MuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS5jbGllbnRDb3VudF0gLSBDbGllbnQgY291bnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YS5jaGFubmVsXSAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkYXRhLmNyZWF0ZWRBdF0gLSBFdmVudCBjcmVhdGlvbiB0aW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEuZXZlbnRJZF0gLSBFdmVudCBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2RhdGEucmVxdWVzdElkXSAtIERlYnVnIHJlcXVlc3QgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS50cmFuc2ZlcklkXSAtIEZpbGUgdHJhbnNmZXIgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwifSBbZGF0YS5yZXN1bHRdIC0gRmlsZSB0cmFuc2ZlciByZXN1bHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFtkYXRhLnBheWxvYWRdIC0gUGF5bG9hZCBkYXRhLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2RhdGEuYnJvYWRjYXN0UGFyYW1zXSAtIFYyIGJyb2FkY2FzdCBmaWx0ZXIgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbZGF0YS5ib2R5XSAtIFYyIGJyb2FkY2FzdCBib2R5LlxuICAgKi9cbiAgb25Db21tYW5kID0gYXN5bmMgKGRhdGEpID0+IHtcbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IFtgV29ya2VyICR7dGhpcy53b3JrZXJDb3VudH0gcmVjZWl2ZWQgY29tbWFuZGAsIGRhdGFdKVxuXG4gICAgY29uc3QgY29tbWFuZCA9IGRhdGEuY29tbWFuZFxuXG4gICAgaWYgKGNvbW1hbmQgPT0gXCJuZXdDbGllbnRcIikge1xuICAgICAgdGhpcy5oYW5kbGVOZXdDbGllbnQoZGF0YSlcbiAgICB9IGVsc2UgaWYgKGNvbW1hbmQgPT0gXCJjbGllbnRXcml0ZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZUNsaWVudFdyaXRlKGRhdGEpXG4gICAgfSBlbHNlIGlmIChjb21tYW5kID09IFwiY2xpZW50RmlsZVJlc3VsdFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZUNsaWVudEZpbGVSZXN1bHQoZGF0YSlcbiAgICB9IGVsc2UgaWYgKGNvbW1hbmQgPT0gXCJjbGllbnRBYm9ydFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZUNsaWVudEFib3J0KGRhdGEpXG4gICAgfSBlbHNlIGlmIChjb21tYW5kID09IFwid2Vic29ja2V0RXZlbnRcIikge1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVXZWJzb2NrZXRFdmVudChkYXRhKVxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcIndlYnNvY2tldFYyQnJvYWRjYXN0XCIpIHtcbiAgICAgIHRoaXMuaGFuZGxlV2Vic29ja2V0VjJCcm9hZGNhc3QoZGF0YSlcbiAgICB9IGVsc2UgaWYgKGNvbW1hbmQgPT0gXCJkZWJ1Z1NuYXBzaG90XCIpIHtcbiAgICAgIHRoaXMuaGFuZGxlRGVidWdTbmFwc2hvdChkYXRhKVxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcInNodXRkb3duXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlU2h1dGRvd24oKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gY29tbWFuZDogJHtjb21tYW5kfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIG5ldyBjbGllbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2RhdGEuY2xpZW50Q291bnRdIC0gQ2xpZW50IGNvdW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEucmVtb3RlQWRkcmVzc10gLSBSZW1vdGUgYWRkcmVzcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBoYW5kbGVOZXdDbGllbnQoZGF0YSkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3Qge2NsaWVudENvdW50LCByZW1vdGVBZGRyZXNzfSA9IGRhdGFcblxuICAgIGlmICh0eXBlb2YgY2xpZW50Q291bnQgIT09IFwibnVtYmVyXCIpIHRocm93IG5ldyBFcnJvcihcImNsaWVudENvdW50IG11c3QgYmUgYSBudW1iZXJcIilcblxuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBDbGllbnQoe1xuICAgICAgY2xpZW50Q291bnQsXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICByZW1vdGVBZGRyZXNzXG4gICAgfSlcblxuICAgIGNsaWVudC5ldmVudHMub24oXCJvdXRwdXRcIiwgKG91dHB1dCwge3dlYnNvY2tldEZyYW1lID0gZmFsc2V9ID0ge30pID0+IHtcbiAgICAgIHRoaXMucGFyZW50UG9ydC5wb3N0TWVzc2FnZSh7Y29tbWFuZDogXCJjbGllbnRPdXRwdXRcIiwgY2xpZW50Q291bnQsIG91dHB1dCwgd2Vic29ja2V0RnJhbWV9KVxuICAgIH0pXG5cbiAgICBjbGllbnQuZXZlbnRzLm9uKFwiZmlsZVwiLCAoe2ZpbGVQYXRoLCBzZW5kQm9keSwgc2V0dGxlfSkgPT4ge1xuICAgICAgY29uc3QgdHJhbnNmZXJJZCA9ICsrdGhpcy5maWxlVHJhbnNmZXJDb3VudFxuXG4gICAgICB0aGlzLmZpbGVUcmFuc2ZlcnMuc2V0KHRyYW5zZmVySWQsIHtjbGllbnRDb3VudCwgc2V0dGxlfSlcbiAgICAgIHRoaXMucGFyZW50UG9ydC5wb3N0TWVzc2FnZSh7Y29tbWFuZDogXCJjbGllbnRGaWxlXCIsIGNsaWVudENvdW50LCBmaWxlUGF0aCwgc2VuZEJvZHksIHRyYW5zZmVySWR9KVxuICAgIH0pXG5cbiAgICBjbGllbnQuZXZlbnRzLm9uKFwiY2xvc2VcIiwgKG91dHB1dCkgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBcIkNsb3NlIHJlY2VpdmVkIGZyb20gY2xpZW50IGluIHdvcmtlciAtIGZvcndhcmRpbmcgdG8gd29ya2VyIHBhcmVudFwiKVxuICAgICAgdGhpcy5wYXJlbnRQb3J0LnBvc3RNZXNzYWdlKHtjb21tYW5kOiBcImNsaWVudENsb3NlXCIsIGNsaWVudENvdW50LCBvdXRwdXR9KVxuICAgIH0pXG5cbiAgICBjbGllbnQuZXZlbnRzLm9uKFwid2Vic29ja2V0U2Vzc2lvbk93bmVkXCIsICh7c2Vzc2lvbklkfSkgPT4ge1xuICAgICAgdGhpcy5wYXJlbnRQb3J0LnBvc3RNZXNzYWdlKHtjb21tYW5kOiBcIndlYnNvY2tldFNlc3Npb25Pd25lZFwiLCBzZXNzaW9uSWR9KVxuICAgIH0pXG5cbiAgICBjbGllbnQuZXZlbnRzLm9uKFwid2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkXCIsICh7c2Vzc2lvbklkfSkgPT4ge1xuICAgICAgdGhpcy5wYXJlbnRQb3J0LnBvc3RNZXNzYWdlKHtjb21tYW5kOiBcIndlYnNvY2tldFNlc3Npb25SZWxlYXNlZFwiLCBzZXNzaW9uSWR9KVxuICAgIH0pXG5cbiAgICB0aGlzLmNsaWVudHNbY2xpZW50Q291bnRdID0gY2xpZW50XG4gIH1cblxuICAvKipcbiAgICogU2V0dGxlcyBhIGZpbGUgcmVzcG9uc2UgYWZ0ZXIgdGhlIHBhcmVudCBmaW5pc2hlcyBzb2NrZXQgZGVsaXZlcnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBkYXRhIC0gRmlsZSByZXN1bHQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtkYXRhLnRyYW5zZmVySWRdIC0gRmlsZSB0cmFuc2ZlciBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCJ9IFtkYXRhLnJlc3VsdF0gLSBGaWxlIHRyYW5zZmVyIHJlc3VsdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHdvcmtlci1zaWRlIGNvbXBsZXRpb24gY2FsbGJhY2sgc2V0dGxlcy5cbiAgICovXG4gIGFzeW5jIGhhbmRsZUNsaWVudEZpbGVSZXN1bHQoZGF0YSkge1xuICAgIGNvbnN0IHtyZXN1bHQsIHRyYW5zZmVySWR9ID0gZGF0YVxuXG4gICAgaWYgKHR5cGVvZiB0cmFuc2ZlcklkICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJ0cmFuc2ZlcklkIG11c3QgYmUgYSBudW1iZXJcIilcbiAgICBpZiAocmVzdWx0ICE9PSBcImNvbXBsZXRlZFwiICYmIHJlc3VsdCAhPT0gXCJhYm9ydGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBmaWxlIHRyYW5zZmVyIHJlc3VsdDogJHtyZXN1bHR9YClcblxuICAgIGNvbnN0IHRyYW5zZmVyID0gdGhpcy5maWxlVHJhbnNmZXJzLmdldCh0cmFuc2ZlcklkKVxuXG4gICAgaWYgKCF0cmFuc2ZlcikgcmV0dXJuXG5cbiAgICB0aGlzLmZpbGVUcmFuc2ZlcnMuZGVsZXRlKHRyYW5zZmVySWQpXG4gICAgYXdhaXQgdHJhbnNmZXIuc2V0dGxlKHJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBBYm9ydHMgZmlsZSByZXNwb25zZXMgYmVsb25naW5nIHRvIGEgY2xvc2VkIHBhcmVudC1zaWRlIHNvY2tldC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBDbGllbnQgYWJvcnQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtkYXRhLmNsaWVudENvdW50XSAtIENsaWVudCBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVuZGluZyBjb21wbGV0aW9uIGNhbGxiYWNrcyBzZXR0bGUuXG4gICAqL1xuICBhc3luYyBoYW5kbGVDbGllbnRBYm9ydChkYXRhKSB7XG4gICAgY29uc3Qge2NsaWVudENvdW50fSA9IGRhdGFcblxuICAgIGlmICh0eXBlb2YgY2xpZW50Q291bnQgIT09IFwibnVtYmVyXCIpIHRocm93IG5ldyBFcnJvcihcImNsaWVudENvdW50IG11c3QgYmUgYSBudW1iZXJcIilcblxuICAgIGNvbnN0IHNldHRsZW1lbnRzID0gW11cbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHNbY2xpZW50Q291bnRdXG5cbiAgICBpZiAoY2xpZW50KSB7XG4gICAgICBzZXR0bGVtZW50cy5wdXNoKGNsaWVudC5hYm9ydFBlbmRpbmdGaWxlUmVzcG9uc2VzKCkpXG4gICAgICBzZXR0bGVtZW50cy5wdXNoKGNsaWVudC5hYm9ydFN0cmVhbVJlc3BvbnNlcygpKVxuICAgICAgLy8gQnVmZmVyZWQgcmVzcG9uc2VzIGhhdmUgbm8gc3RyZWFtIHRvIGFib3J0LCBzbyB0aGVpciBpbi1mbGlnaHRcbiAgICAgIC8vIGhhbmRsZXJzIG5ldmVyIGhlYXIgYWJvdXQgdGhlIHNvY2tldCB0ZWFyZG93biB0aHJvdWdoIHRoZSBzdHJlYW1pbmdcbiAgICAgIC8vIHBhdGg6IG5vdGlmeSB0aGUgcnVubmluZyByZXF1ZXN0cyBkaXJlY3RseSBzbyB0aGV5IGNhbiBzZXR0bGVcbiAgICAgIC8vIHJlc291cmNlcyAoZS5nLiBhZG1pc3Npb24gcXVldWUgcG9zaXRpb25zKSBpbi1wcm9jZXNzLlxuICAgICAgY2xpZW50Lm5vdGlmeUNsaWVudERpc2Nvbm5lY3QoKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW3RyYW5zZmVySWQsIHRyYW5zZmVyXSBvZiB0aGlzLmZpbGVUcmFuc2ZlcnMpIHtcbiAgICAgIGlmICh0cmFuc2Zlci5jbGllbnRDb3VudCAhPT0gY2xpZW50Q291bnQpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuZmlsZVRyYW5zZmVycy5kZWxldGUodHJhbnNmZXJJZClcbiAgICAgIHNldHRsZW1lbnRzLnB1c2godHJhbnNmZXIuc2V0dGxlKFwiYWJvcnRlZFwiKSlcbiAgICB9XG5cbiAgICBkZWxldGUgdGhpcy5jbGllbnRzW2NsaWVudENvdW50XVxuICAgIGF3YWl0IFByb21pc2UuYWxsKHNldHRsZW1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNsaWVudCB3cml0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyIHwgVWludDhBcnJheSB8IHN0cmluZ30gW2RhdGEuY2h1bmtdIC0gQ2h1bmsuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS5jbGllbnRDb3VudF0gLSBDbGllbnQgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRoZSBjbGllbnQgd3JpdGUgaXMgZGlzcGF0Y2hlZC5cbiAgICovXG4gIGFzeW5jIGhhbmRsZUNsaWVudFdyaXRlKGRhdGEpIHtcbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKFwiTG9va2luZyB1cCBjbGllbnRcIilcblxuICAgIGNvbnN0IHtjaHVuaywgY2xpZW50Q291bnR9ID0gZGF0YVxuICAgIGlmICghY2h1bmspIHRocm93IG5ldyBFcnJvcihcIk5vIGNodW5rIGdpdmVuXCIpXG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtDbGllbnQgfCB1bmRlZmluZWR9ICovIChkaWdnKHRoaXMuY2xpZW50cywgY2xpZW50Q291bnQpKVxuXG4gICAgaWYgKCFjbGllbnQpIHRocm93IG5ldyBFcnJvcihgQ2xpZW50IG5vdCBmb3VuZCBmb3IgY2xpZW50V3JpdGU6ICR7Y2xpZW50Q291bnR9YClcblxuICAgIGNvbnN0IGNsaWVudENodW5rID0gdHlwZW9mIGNodW5rID09PSBcInN0cmluZ1wiID8gQnVmZmVyLmZyb20oY2h1bmspIDogQnVmZmVyLmZyb20oY2h1bmspXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJTZW5kaW5nIGNsaWVudFdyaXRlIHRvIHBhcnNlclwiLCB7Y2xpZW50Q291bnQsIC4uLnN1bW1hcml6ZUNsaWVudFdyaXRlQ2h1bmsoY2xpZW50Q2h1bmspfV0pXG5cbiAgICBjbGllbnQub25Xcml0ZShjbGllbnRDaHVuaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB3ZWJzb2NrZXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEuY2hhbm5lbF0gLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YS5jcmVhdGVkQXRdIC0gRXZlbnQgY3JlYXRpb24gdGltZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkYXRhLmV2ZW50SWRdIC0gRXZlbnQgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RhdGEucGF5bG9hZF0gLSBQYXlsb2FkIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRoZSB3ZWJzb2NrZXQgZXZlbnQgaXMgZGlzcGF0Y2hlZC5cbiAgICovXG4gIGFzeW5jIGhhbmRsZVdlYnNvY2tldEV2ZW50KGRhdGEpIHtcbiAgICBjb25zdCB7Y2hhbm5lbCwgY3JlYXRlZEF0LCBldmVudElkLCBwYXlsb2FkfSA9IGRhdGFcblxuICAgIGlmICh0eXBlb2YgY2hhbm5lbCAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY2hhbm5lbCBnaXZlblwiKVxuXG4gICAgYXdhaXQgdGhpcy5icm9hZGNhc3RXZWJzb2NrZXRFdmVudCh7Y2hhbm5lbCwgY3JlYXRlZEF0LCBldmVudElkLCBwYXlsb2FkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB3ZWJzb2NrZXQgdjIgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtkYXRhLmJyb2FkY2FzdFBhcmFtc10gLSBWMiBicm9hZGNhc3QgZmlsdGVyIHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RhdGEuYm9keV0gLSBWMiBicm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkYXRhLmNoYW5uZWxdIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEuZXZlbnRJZF0gLSBFdmVudCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGhhbmRsZVdlYnNvY2tldFYyQnJvYWRjYXN0KGRhdGEpIHtcbiAgICBjb25zdCB7Ym9keSwgYnJvYWRjYXN0UGFyYW1zLCBjaGFubmVsLCBldmVudElkfSA9IGRhdGFcblxuICAgIGlmICh0eXBlb2YgY2hhbm5lbCAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY2hhbm5lbCBnaXZlblwiKVxuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChjaGFubmVsLCBicm9hZGNhc3RQYXJhbXMgfHwge30sIGJvZHksIHtldmVudElkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS5yZXF1ZXN0SWRdIC0gRGVidWcgcmVxdWVzdCBpZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBoYW5kbGVEZWJ1Z1NuYXBzaG90KGRhdGEpIHtcbiAgICBjb25zdCB7cmVxdWVzdElkfSA9IGRhdGFcblxuICAgIGlmICh0eXBlb2YgcmVxdWVzdElkICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJkZWJ1Z1NuYXBzaG90IHJlcXVlc3RJZCBtdXN0IGJlIGEgbnVtYmVyXCIpXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICB0aGlzLnBhcmVudFBvcnQucG9zdE1lc3NhZ2Uoe1xuICAgICAgY29tbWFuZDogXCJkZWJ1Z1NuYXBzaG90XCIsXG4gICAgICByZXF1ZXN0SWQsXG4gICAgICBzbmFwc2hvdDogdGhpcy5jb25maWd1cmF0aW9uLmdldExvY2FsRGVidWdTbmFwc2hvdCgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBzaHV0ZG93bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHdvcmtlciBzaHV0ZG93biBoYXMgYmVlbiByZXF1ZXN0ZWQuXG4gICAqL1xuICBhc3luYyBoYW5kbGVTaHV0ZG93bigpIHtcbiAgICBjb25zdCBjbGllbnRzID0gT2JqZWN0LnZhbHVlcyh0aGlzLmNsaWVudHMpXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiSFRUUCB3b3JrZXItaGFuZGxlciBzaHV0ZG93biBmYWlsZWRcIixcbiAgICAgIHN0ZXBzOiBbXG4gICAgICAgIC4uLmNsaWVudHMubWFwKChjbGllbnQpID0+IGFzeW5jICgpID0+IGF3YWl0IGNsaWVudC5hYm9ydFBlbmRpbmdGaWxlUmVzcG9uc2VzKCkpLFxuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5maWxlVHJhbnNmZXJzLmNsZWFyKClcbiAgICAgICAgICBhd2FpdCB0aGlzLmFwcGxpY2F0aW9uPy5zdG9wKClcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH0pXG5cbiAgICB0aGlzLnBhcmVudFBvcnQucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwic2h1dGRvd25Db21wbGV0ZVwifSlcbiAgICBwcm9jZXNzLmV4aXQoMClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJyb2FkY2FzdCB3ZWJzb2NrZXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNyZWF0ZWRBdCAtIEV2ZW50IGNyZWF0aW9uIHRpbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmV2ZW50SWQgLSBFdmVudCBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBicm9hZGNhc3RXZWJzb2NrZXRFdmVudCh7Y2hhbm5lbCwgY3JlYXRlZEF0LCBldmVudElkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHNlbmRUYXNrcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGNsaWVudEtleSBvZiBPYmplY3Qua2V5cyh0aGlzLmNsaWVudHMpKSB7XG4gICAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHNbTnVtYmVyKGNsaWVudEtleSldXG4gICAgICBpZiAoIWNsaWVudCkgY29udGludWVcbiAgICAgIGNvbnN0IHNlc3Npb24gPSBjbGllbnQud2Vic29ja2V0U2Vzc2lvblxuXG4gICAgICBpZiAoIXNlc3Npb24pIGNvbnRpbnVlXG5cbiAgICAgIHNlbmRUYXNrcy5wdXNoKHNlc3Npb24uc2VuZEV2ZW50KGNoYW5uZWwsIHBheWxvYWQsIHtcbiAgICAgICAgY3JlYXRlZEF0LFxuICAgICAgICBldmVudElkXG4gICAgICB9KSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb25maWd1cmF0aW9uKSB7XG4gICAgICAvLyBJc29sYXRlIGNoYW5uZWwgc3Vic2NyaWJlciBmYWlsdXJlcyBzbyBhIGJ1Z2d5IGluLXByb2Nlc3MgY2FsbGJhY2tcbiAgICAgIC8vIGNhbm5vdCByZWplY3QgdGhpcyBjb21tYW5kIGFuZCBjcmFzaCB0aGUgd29ya2VyIHRocmVhZCwgYnV0IHN0aWxsXG4gICAgICAvLyBzdXJmYWNlIHRoZSBlcnJvciB0byB0aGUgZnJhbWV3b3JrIGVycm9yIGV2ZW50cyBzbyBidWcgcmVwb3J0ZXJzXG4gICAgICAvLyBjYW4gcGljayBpdCB1cC5cbiAgICAgIHNlbmRUYXNrcy5wdXNoKGRpc3BhdGNoQ2hhbm5lbFN1YnNjcmliZXJzKHtjaGFubmVsLCBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sIGNyZWF0ZWRBdCwgZXZlbnRJZCwgbG9nZ2VyOiB0aGlzLmxvZ2dlciwgcGF5bG9hZH0pKVxuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsKHNlbmRUYXNrcylcbiAgfVxufVxuIl19