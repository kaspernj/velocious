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
        if (client)
            settlements.push(client.abortPendingFileResponses());
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLXRocmVhZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci93b3JrZXItaGFuZGxlci93b3JrZXItdGhyZWFkLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxzQkFBc0IsQ0FBQTtBQUM5QyxPQUFPLE1BQU0sTUFBTSxvQkFBb0IsQ0FBQTtBQUN2QyxPQUFPLDBCQUEwQixNQUFNLGtDQUFrQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxpQkFBaUIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUNsRSxPQUFPLGVBQWUsTUFBTSx3QkFBd0IsQ0FBQTtBQUNwRCxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxtQ0FBbUMsQ0FBQTtBQUVwRTs7OztHQUlHO0FBQ0gsU0FBUyx5QkFBeUIsQ0FBQyxLQUFLO0lBQ3RDLE1BQU0sZUFBZSxHQUFHLE9BQU8sS0FBSyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMzRixNQUFNLE9BQU8sR0FBRyxlQUFlLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBRTVJLE9BQU8sRUFBQyxNQUFNLEVBQUUsZUFBZSxDQUFDLE1BQU0sRUFBRSxPQUFP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Qyx1QkFBdUIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBQztRQUNsRSxNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUE7UUFFcEIsS0FBSyxNQUFNLFNBQVMsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2xELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7WUFDOUMsSUFBSSxDQUFDLE1BQU07Z0JBQUUsU0FBUTtZQUNyQixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsZ0JBQWdCLENBQUE7WUFFdkMsSUFBSSxDQUFDLE9BQU87Z0JBQUUsU0FBUTtZQUV0QixTQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRTtnQkFDakQsU0FBUztnQkFDVCxPQUFPO2FBQ1IsQ0FBQyxDQUFDLENBQUE7UUFDTCxDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDdkIscUVBQXFFO1lBQ3JFLG9FQUFvRTtZQUNwRSxtRUFBbUU7WUFDbkUsa0JBQWtCO1lBQ2xCLFNBQVMsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBQyxPQUFPLEVBQUUsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFDNUksQ0FBQztRQUVELE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUM5QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEFwcGxpY2F0aW9uIGZyb20gXCIuLi8uLi9hcHBsaWNhdGlvbi5qc1wiXG5pbXBvcnQgQ2xpZW50IGZyb20gXCIuLi9jbGllbnQvaW5kZXguanNcIlxuaW1wb3J0IGRpc3BhdGNoQ2hhbm5lbFN1YnNjcmliZXJzIGZyb20gXCIuL2NoYW5uZWwtc3Vic2NyaWJlci1kaXNwYXRjaC5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IGVycm9yTG9nZ2VyIGZyb20gXCIuLi8uLi9lcnJvci1sb2dnZXIuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCB0b0ltcG9ydFNwZWNpZmllciBmcm9tIFwiLi4vLi4vdXRpbHMvdG8taW1wb3J0LXNwZWNpZmllci5qc1wiXG5pbXBvcnQgV2Vic29ja2V0RXZlbnRzIGZyb20gXCIuLi93ZWJzb2NrZXQtZXZlbnRzLmpzXCJcbmltcG9ydCB7IHJ1blNodXRkb3duU3RlcHMgfSBmcm9tIFwiLi4vLi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcblxuLyoqXG4gKiBSdW5zIHN1bW1hcml6ZSBjbGllbnQgd3JpdGUgY2h1bmsuXG4gKiBAcGFyYW0ge0J1ZmZlciB8IFVpbnQ4QXJyYXkgfCBzdHJpbmd9IGNodW5rIC0gQ2xpZW50IGlucHV0IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7e2xlbmd0aDogbnVtYmVyLCBwcmV2aWV3OiBzdHJpbmd9fSAtIENodW5rIHN1bW1hcnkgZm9yIGxvZ2dpbmcuXG4gKi9cbmZ1bmN0aW9uIHN1bW1hcml6ZUNsaWVudFdyaXRlQ2h1bmsoY2h1bmspIHtcbiAgY29uc3Qgbm9ybWFsaXplZENodW5rID0gdHlwZW9mIGNodW5rID09PSBcInN0cmluZ1wiID8gQnVmZmVyLmZyb20oY2h1bmspIDogQnVmZmVyLmZyb20oY2h1bmspXG4gIGNvbnN0IHByZXZpZXcgPSBub3JtYWxpemVkQ2h1bmsudG9TdHJpbmcoXCJsYXRpbjFcIiwgMCwgTWF0aC5taW4obm9ybWFsaXplZENodW5rLmxlbmd0aCwgMTYwKSkucmVwbGFjZUFsbChcIlxcclwiLCBcIlxcXFxyXCIpLnJlcGxhY2VBbGwoXCJcXG5cIiwgXCJcXFxcblwiKVxuXG4gIHJldHVybiB7bGVuZ3RoOiBub3JtYWxpemVkQ2h1bmsubGVuZ3RoLCBwcmV2aWV3fVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyV29ya2VySGFuZGxlcldvcmtlclRocmVhZCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6d29ya2VyX3RocmVhZHNcIikuTWVzc2FnZVBvcnQgfCBudWxsfSBhcmdzLnBhcmVudFBvcnQgLSBQYXJlbnQgcG9ydC5cbiAgICogQHBhcmFtIHt7ZGVidWc6IGJvb2xlYW4sIGRpcmVjdG9yeTogc3RyaW5nLCBlbnZpcm9ubWVudDogc3RyaW5nLCB3b3JrZXJDb3VudDogbnVtYmVyfX0gYXJncy53b3JrZXJEYXRhIC0gV29ya2VyIGNvbmZpZ3VyYXRpb24gZGV0YWlscy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtwYXJlbnRQb3J0LCB3b3JrZXJEYXRhfSkge1xuICAgIGlmICghcGFyZW50UG9ydCkgdGhyb3cgbmV3IEVycm9yKFwicGFyZW50UG9ydCBpcyByZXF1aXJlZFwiKVxuXG4gICAgY29uc3Qge3dvcmtlckNvdW50fSA9IHdvcmtlckRhdGFcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPG51bWJlciwgQ2xpZW50Pn0gKi9cbiAgICB0aGlzLmNsaWVudHMgPSB7fVxuXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5wYXJlbnRQb3J0ID0gcGFyZW50UG9ydFxuICAgIHRoaXMud29ya2VyRGF0YSA9IHdvcmtlckRhdGFcbiAgICB0aGlzLndvcmtlckNvdW50ID0gd29ya2VyQ291bnRcbiAgICB0aGlzLmZpbGVUcmFuc2ZlckNvdW50ID0gMFxuXG4gICAgLyoqIEB0eXBlIHtNYXA8bnVtYmVyLCB7Y2xpZW50Q291bnQ6IG51bWJlciwgc2V0dGxlOiAocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IFByb21pc2U8dm9pZD59Pn0gKi9cbiAgICB0aGlzLmZpbGVUcmFuc2ZlcnMgPSBuZXcgTWFwKClcblxuICAgIHBhcmVudFBvcnQub24oXCJtZXNzYWdlXCIsIGVycm9yTG9nZ2VyKHRoaXMub25Db21tYW5kKSlcblxuICAgIHRoaXMuaW5pdGlhbGl6ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLmFwcGxpY2F0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJBcHBsaWNhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgICAgdGhpcy5hcHBsaWNhdGlvbi5pbml0aWFsaXplKCkudGhlbigoKSA9PiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gYFdvcmtlciAke3dvcmtlckNvdW50fSBzdGFydGVkYClcbiAgICAgICAgcGFyZW50UG9ydC5wb3N0TWVzc2FnZSh7Y29tbWFuZDogXCJzdGFydGVkXCJ9KVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemUoKSB7XG4gICAgY29uc3Qge2RlYnVnLCBkaXJlY3RvcnksIGVudmlyb25tZW50fSA9IHRoaXMud29ya2VyRGF0YVxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25QYXRoID0gYCR7ZGlyZWN0b3J5fS9zcmMvY29uZmlnL2NvbmZpZ3VyYXRpb24uanNgXG4gICAgY29uc3QgY29uZmlndXJhdGlvbkltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihjb25maWd1cmF0aW9uUGF0aCkpXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uSW1wb3J0LmRlZmF1bHRcblxuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYENvbmZpZ3VyYXRpb24gY291bGRuJ3QgYmUgbG9hZGVkIGZyb206ICR7Y29uZmlndXJhdGlvblBhdGh9YClcblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cblxuICAgIGNvbmZpZ3VyYXRpb24uZGVidWcgPSBkZWJ1ZyA9PT0gdHJ1ZVxuICAgIGNvbmZpZ3VyYXRpb24uc2V0RW52aXJvbm1lbnQoZW52aXJvbm1lbnQpXG4gICAgY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJXb3JrZXIgdGhyZWFkIGNvbmZpZ3VyYXRpb24gbG9hZGVkXCIsIHtkZWJ1ZzogY29uZmlndXJhdGlvbi5kZWJ1Zywgd29ya2VyQ291bnQ6IHRoaXMud29ya2VyQ291bnR9XSlcbiAgICB0aGlzLndlYnNvY2tldEV2ZW50cyA9IG5ldyBXZWJzb2NrZXRFdmVudHMoe3BhcmVudFBvcnQ6IHRoaXMucGFyZW50UG9ydCwgd29ya2VyQ291bnQ6IHRoaXMud29ya2VyQ291bnR9KVxuICAgIGNvbmZpZ3VyYXRpb24uc2V0V2Vic29ja2V0RXZlbnRzKHRoaXMud2Vic29ja2V0RXZlbnRzKVxuXG4gICAgdGhpcy5hcHBsaWNhdGlvbiA9IG5ldyBBcHBsaWNhdGlvbih7Y29uZmlndXJhdGlvbiwgdHlwZTogXCJ3b3JrZXItaGFuZGxlclwifSlcblxuICAgIGlmICghY29uZmlndXJhdGlvbi5pc0luaXRpYWxpemVkKCkpIHtcbiAgICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJ3b3JrZXItaGFuZGxlclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT24gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhLmNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcGFyYW0ge0J1ZmZlciB8IFVpbnQ4QXJyYXkgfCBzdHJpbmd9IFtkYXRhLmNodW5rXSAtIENodW5rLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEucmVtb3RlQWRkcmVzc10gLSBSZW1vdGUgYWRkcmVzcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtkYXRhLmNsaWVudENvdW50XSAtIENsaWVudCBjb3VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkYXRhLmNoYW5uZWxdIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEuY3JlYXRlZEF0XSAtIEV2ZW50IGNyZWF0aW9uIHRpbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YS5ldmVudElkXSAtIEV2ZW50IGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS5yZXF1ZXN0SWRdIC0gRGVidWcgcmVxdWVzdCBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtkYXRhLnRyYW5zZmVySWRdIC0gRmlsZSB0cmFuc2ZlciBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCJ9IFtkYXRhLnJlc3VsdF0gLSBGaWxlIHRyYW5zZmVyIHJlc3VsdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RhdGEucGF5bG9hZF0gLSBQYXlsb2FkIGRhdGEuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbZGF0YS5icm9hZGNhc3RQYXJhbXNdIC0gVjIgYnJvYWRjYXN0IGZpbHRlciBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFtkYXRhLmJvZHldIC0gVjIgYnJvYWRjYXN0IGJvZHkuXG4gICAqL1xuICBvbkNvbW1hbmQgPSBhc3luYyAoZGF0YSkgPT4ge1xuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gW2BXb3JrZXIgJHt0aGlzLndvcmtlckNvdW50fSByZWNlaXZlZCBjb21tYW5kYCwgZGF0YV0pXG5cbiAgICBjb25zdCBjb21tYW5kID0gZGF0YS5jb21tYW5kXG5cbiAgICBpZiAoY29tbWFuZCA9PSBcIm5ld0NsaWVudFwiKSB7XG4gICAgICB0aGlzLmhhbmRsZU5ld0NsaWVudChkYXRhKVxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcImNsaWVudFdyaXRlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ2xpZW50V3JpdGUoZGF0YSlcbiAgICB9IGVsc2UgaWYgKGNvbW1hbmQgPT0gXCJjbGllbnRGaWxlUmVzdWx0XCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ2xpZW50RmlsZVJlc3VsdChkYXRhKVxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcImNsaWVudEFib3J0XCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ2xpZW50QWJvcnQoZGF0YSlcbiAgICB9IGVsc2UgaWYgKGNvbW1hbmQgPT0gXCJ3ZWJzb2NrZXRFdmVudFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZVdlYnNvY2tldEV2ZW50KGRhdGEpXG4gICAgfSBlbHNlIGlmIChjb21tYW5kID09IFwid2Vic29ja2V0VjJCcm9hZGNhc3RcIikge1xuICAgICAgdGhpcy5oYW5kbGVXZWJzb2NrZXRWMkJyb2FkY2FzdChkYXRhKVxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcImRlYnVnU25hcHNob3RcIikge1xuICAgICAgdGhpcy5oYW5kbGVEZWJ1Z1NuYXBzaG90KGRhdGEpXG4gICAgfSBlbHNlIGlmIChjb21tYW5kID09IFwic2h1dGRvd25cIikge1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVTaHV0ZG93bigpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBjb21tYW5kOiAke2NvbW1hbmR9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgbmV3IGNsaWVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS5jbGllbnRDb3VudF0gLSBDbGllbnQgY291bnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YS5yZW1vdGVBZGRyZXNzXSAtIFJlbW90ZSBhZGRyZXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGhhbmRsZU5ld0NsaWVudChkYXRhKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCB7Y2xpZW50Q291bnQsIHJlbW90ZUFkZHJlc3N9ID0gZGF0YVxuXG4gICAgaWYgKHR5cGVvZiBjbGllbnRDb3VudCAhPT0gXCJudW1iZXJcIikgdGhyb3cgbmV3IEVycm9yKFwiY2xpZW50Q291bnQgbXVzdCBiZSBhIG51bWJlclwiKVxuXG4gICAgY29uc3QgY2xpZW50ID0gbmV3IENsaWVudCh7XG4gICAgICBjbGllbnRDb3VudCxcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIHJlbW90ZUFkZHJlc3NcbiAgICB9KVxuXG4gICAgY2xpZW50LmV2ZW50cy5vbihcIm91dHB1dFwiLCAob3V0cHV0LCB7d2Vic29ja2V0RnJhbWUgPSBmYWxzZX0gPSB7fSkgPT4ge1xuICAgICAgdGhpcy5wYXJlbnRQb3J0LnBvc3RNZXNzYWdlKHtjb21tYW5kOiBcImNsaWVudE91dHB1dFwiLCBjbGllbnRDb3VudCwgb3V0cHV0LCB3ZWJzb2NrZXRGcmFtZX0pXG4gICAgfSlcblxuICAgIGNsaWVudC5ldmVudHMub24oXCJmaWxlXCIsICh7ZmlsZVBhdGgsIHNlbmRCb2R5LCBzZXR0bGV9KSA9PiB7XG4gICAgICBjb25zdCB0cmFuc2ZlcklkID0gKyt0aGlzLmZpbGVUcmFuc2ZlckNvdW50XG5cbiAgICAgIHRoaXMuZmlsZVRyYW5zZmVycy5zZXQodHJhbnNmZXJJZCwge2NsaWVudENvdW50LCBzZXR0bGV9KVxuICAgICAgdGhpcy5wYXJlbnRQb3J0LnBvc3RNZXNzYWdlKHtjb21tYW5kOiBcImNsaWVudEZpbGVcIiwgY2xpZW50Q291bnQsIGZpbGVQYXRoLCBzZW5kQm9keSwgdHJhbnNmZXJJZH0pXG4gICAgfSlcblxuICAgIGNsaWVudC5ldmVudHMub24oXCJjbG9zZVwiLCAob3V0cHV0KSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IFwiQ2xvc2UgcmVjZWl2ZWQgZnJvbSBjbGllbnQgaW4gd29ya2VyIC0gZm9yd2FyZGluZyB0byB3b3JrZXIgcGFyZW50XCIpXG4gICAgICB0aGlzLnBhcmVudFBvcnQucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwiY2xpZW50Q2xvc2VcIiwgY2xpZW50Q291bnQsIG91dHB1dH0pXG4gICAgfSlcblxuICAgIGNsaWVudC5ldmVudHMub24oXCJ3ZWJzb2NrZXRTZXNzaW9uT3duZWRcIiwgKHtzZXNzaW9uSWR9KSA9PiB7XG4gICAgICB0aGlzLnBhcmVudFBvcnQucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwid2Vic29ja2V0U2Vzc2lvbk93bmVkXCIsIHNlc3Npb25JZH0pXG4gICAgfSlcblxuICAgIGNsaWVudC5ldmVudHMub24oXCJ3ZWJzb2NrZXRTZXNzaW9uUmVsZWFzZWRcIiwgKHtzZXNzaW9uSWR9KSA9PiB7XG4gICAgICB0aGlzLnBhcmVudFBvcnQucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwid2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkXCIsIHNlc3Npb25JZH0pXG4gICAgfSlcblxuICAgIHRoaXMuY2xpZW50c1tjbGllbnRDb3VudF0gPSBjbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXR0bGVzIGEgZmlsZSByZXNwb25zZSBhZnRlciB0aGUgcGFyZW50IGZpbmlzaGVzIHNvY2tldCBkZWxpdmVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBGaWxlIHJlc3VsdCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2RhdGEudHJhbnNmZXJJZF0gLSBGaWxlIHRyYW5zZmVyIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIn0gW2RhdGEucmVzdWx0XSAtIEZpbGUgdHJhbnNmZXIgcmVzdWx0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgd29ya2VyLXNpZGUgY29tcGxldGlvbiBjYWxsYmFjayBzZXR0bGVzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGxlQ2xpZW50RmlsZVJlc3VsdChkYXRhKSB7XG4gICAgY29uc3Qge3Jlc3VsdCwgdHJhbnNmZXJJZH0gPSBkYXRhXG5cbiAgICBpZiAodHlwZW9mIHRyYW5zZmVySWQgIT09IFwibnVtYmVyXCIpIHRocm93IG5ldyBFcnJvcihcInRyYW5zZmVySWQgbXVzdCBiZSBhIG51bWJlclwiKVxuICAgIGlmIChyZXN1bHQgIT09IFwiY29tcGxldGVkXCIgJiYgcmVzdWx0ICE9PSBcImFib3J0ZWRcIikgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGZpbGUgdHJhbnNmZXIgcmVzdWx0OiAke3Jlc3VsdH1gKVxuXG4gICAgY29uc3QgdHJhbnNmZXIgPSB0aGlzLmZpbGVUcmFuc2ZlcnMuZ2V0KHRyYW5zZmVySWQpXG5cbiAgICBpZiAoIXRyYW5zZmVyKSByZXR1cm5cblxuICAgIHRoaXMuZmlsZVRyYW5zZmVycy5kZWxldGUodHJhbnNmZXJJZClcbiAgICBhd2FpdCB0cmFuc2Zlci5zZXR0bGUocmVzdWx0KVxuICB9XG5cbiAgLyoqXG4gICAqIEFib3J0cyBmaWxlIHJlc3BvbnNlcyBiZWxvbmdpbmcgdG8gYSBjbG9zZWQgcGFyZW50LXNpZGUgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gZGF0YSAtIENsaWVudCBhYm9ydCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2RhdGEuY2xpZW50Q291bnRdIC0gQ2xpZW50IGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZW5kaW5nIGNvbXBsZXRpb24gY2FsbGJhY2tzIHNldHRsZS5cbiAgICovXG4gIGFzeW5jIGhhbmRsZUNsaWVudEFib3J0KGRhdGEpIHtcbiAgICBjb25zdCB7Y2xpZW50Q291bnR9ID0gZGF0YVxuXG4gICAgaWYgKHR5cGVvZiBjbGllbnRDb3VudCAhPT0gXCJudW1iZXJcIikgdGhyb3cgbmV3IEVycm9yKFwiY2xpZW50Q291bnQgbXVzdCBiZSBhIG51bWJlclwiKVxuXG4gICAgY29uc3Qgc2V0dGxlbWVudHMgPSBbXVxuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50c1tjbGllbnRDb3VudF1cblxuICAgIGlmIChjbGllbnQpIHNldHRsZW1lbnRzLnB1c2goY2xpZW50LmFib3J0UGVuZGluZ0ZpbGVSZXNwb25zZXMoKSlcblxuICAgIGZvciAoY29uc3QgW3RyYW5zZmVySWQsIHRyYW5zZmVyXSBvZiB0aGlzLmZpbGVUcmFuc2ZlcnMpIHtcbiAgICAgIGlmICh0cmFuc2Zlci5jbGllbnRDb3VudCAhPT0gY2xpZW50Q291bnQpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuZmlsZVRyYW5zZmVycy5kZWxldGUodHJhbnNmZXJJZClcbiAgICAgIHNldHRsZW1lbnRzLnB1c2godHJhbnNmZXIuc2V0dGxlKFwiYWJvcnRlZFwiKSlcbiAgICB9XG5cbiAgICBkZWxldGUgdGhpcy5jbGllbnRzW2NsaWVudENvdW50XVxuICAgIGF3YWl0IFByb21pc2UuYWxsKHNldHRsZW1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNsaWVudCB3cml0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyIHwgVWludDhBcnJheSB8IHN0cmluZ30gW2RhdGEuY2h1bmtdIC0gQ2h1bmsuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS5jbGllbnRDb3VudF0gLSBDbGllbnQgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRoZSBjbGllbnQgd3JpdGUgaXMgZGlzcGF0Y2hlZC5cbiAgICovXG4gIGFzeW5jIGhhbmRsZUNsaWVudFdyaXRlKGRhdGEpIHtcbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKFwiTG9va2luZyB1cCBjbGllbnRcIilcblxuICAgIGNvbnN0IHtjaHVuaywgY2xpZW50Q291bnR9ID0gZGF0YVxuICAgIGlmICghY2h1bmspIHRocm93IG5ldyBFcnJvcihcIk5vIGNodW5rIGdpdmVuXCIpXG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtDbGllbnQgfCB1bmRlZmluZWR9ICovIChkaWdnKHRoaXMuY2xpZW50cywgY2xpZW50Q291bnQpKVxuXG4gICAgaWYgKCFjbGllbnQpIHRocm93IG5ldyBFcnJvcihgQ2xpZW50IG5vdCBmb3VuZCBmb3IgY2xpZW50V3JpdGU6ICR7Y2xpZW50Q291bnR9YClcblxuICAgIGNvbnN0IGNsaWVudENodW5rID0gdHlwZW9mIGNodW5rID09PSBcInN0cmluZ1wiID8gQnVmZmVyLmZyb20oY2h1bmspIDogQnVmZmVyLmZyb20oY2h1bmspXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJTZW5kaW5nIGNsaWVudFdyaXRlIHRvIHBhcnNlclwiLCB7Y2xpZW50Q291bnQsIC4uLnN1bW1hcml6ZUNsaWVudFdyaXRlQ2h1bmsoY2xpZW50Q2h1bmspfV0pXG5cbiAgICBjbGllbnQub25Xcml0ZShjbGllbnRDaHVuaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB3ZWJzb2NrZXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEuY2hhbm5lbF0gLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YS5jcmVhdGVkQXRdIC0gRXZlbnQgY3JlYXRpb24gdGltZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkYXRhLmV2ZW50SWRdIC0gRXZlbnQgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RhdGEucGF5bG9hZF0gLSBQYXlsb2FkIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRoZSB3ZWJzb2NrZXQgZXZlbnQgaXMgZGlzcGF0Y2hlZC5cbiAgICovXG4gIGFzeW5jIGhhbmRsZVdlYnNvY2tldEV2ZW50KGRhdGEpIHtcbiAgICBjb25zdCB7Y2hhbm5lbCwgY3JlYXRlZEF0LCBldmVudElkLCBwYXlsb2FkfSA9IGRhdGFcblxuICAgIGlmICh0eXBlb2YgY2hhbm5lbCAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY2hhbm5lbCBnaXZlblwiKVxuXG4gICAgYXdhaXQgdGhpcy5icm9hZGNhc3RXZWJzb2NrZXRFdmVudCh7Y2hhbm5lbCwgY3JlYXRlZEF0LCBldmVudElkLCBwYXlsb2FkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB3ZWJzb2NrZXQgdjIgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtkYXRhLmJyb2FkY2FzdFBhcmFtc10gLSBWMiBicm9hZGNhc3QgZmlsdGVyIHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RhdGEuYm9keV0gLSBWMiBicm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkYXRhLmNoYW5uZWxdIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEuZXZlbnRJZF0gLSBFdmVudCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGhhbmRsZVdlYnNvY2tldFYyQnJvYWRjYXN0KGRhdGEpIHtcbiAgICBjb25zdCB7Ym9keSwgYnJvYWRjYXN0UGFyYW1zLCBjaGFubmVsLCBldmVudElkfSA9IGRhdGFcblxuICAgIGlmICh0eXBlb2YgY2hhbm5lbCAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY2hhbm5lbCBnaXZlblwiKVxuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl9icm9hZGNhc3RUb0NoYW5uZWxMb2NhbChjaGFubmVsLCBicm9hZGNhc3RQYXJhbXMgfHwge30sIGJvZHksIHtldmVudElkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS5yZXF1ZXN0SWRdIC0gRGVidWcgcmVxdWVzdCBpZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBoYW5kbGVEZWJ1Z1NuYXBzaG90KGRhdGEpIHtcbiAgICBjb25zdCB7cmVxdWVzdElkfSA9IGRhdGFcblxuICAgIGlmICh0eXBlb2YgcmVxdWVzdElkICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJkZWJ1Z1NuYXBzaG90IHJlcXVlc3RJZCBtdXN0IGJlIGEgbnVtYmVyXCIpXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICB0aGlzLnBhcmVudFBvcnQucG9zdE1lc3NhZ2Uoe1xuICAgICAgY29tbWFuZDogXCJkZWJ1Z1NuYXBzaG90XCIsXG4gICAgICByZXF1ZXN0SWQsXG4gICAgICBzbmFwc2hvdDogdGhpcy5jb25maWd1cmF0aW9uLmdldExvY2FsRGVidWdTbmFwc2hvdCgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBzaHV0ZG93bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHdvcmtlciBzaHV0ZG93biBoYXMgYmVlbiByZXF1ZXN0ZWQuXG4gICAqL1xuICBhc3luYyBoYW5kbGVTaHV0ZG93bigpIHtcbiAgICBjb25zdCBjbGllbnRzID0gT2JqZWN0LnZhbHVlcyh0aGlzLmNsaWVudHMpXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiSFRUUCB3b3JrZXItaGFuZGxlciBzaHV0ZG93biBmYWlsZWRcIixcbiAgICAgIHN0ZXBzOiBbXG4gICAgICAgIC4uLmNsaWVudHMubWFwKChjbGllbnQpID0+IGFzeW5jICgpID0+IGF3YWl0IGNsaWVudC5hYm9ydFBlbmRpbmdGaWxlUmVzcG9uc2VzKCkpLFxuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5maWxlVHJhbnNmZXJzLmNsZWFyKClcbiAgICAgICAgICBhd2FpdCB0aGlzLmFwcGxpY2F0aW9uPy5zdG9wKClcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH0pXG5cbiAgICB0aGlzLnBhcmVudFBvcnQucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwic2h1dGRvd25Db21wbGV0ZVwifSlcbiAgICBwcm9jZXNzLmV4aXQoMClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJyb2FkY2FzdCB3ZWJzb2NrZXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNyZWF0ZWRBdCAtIEV2ZW50IGNyZWF0aW9uIHRpbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmV2ZW50SWQgLSBFdmVudCBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBicm9hZGNhc3RXZWJzb2NrZXRFdmVudCh7Y2hhbm5lbCwgY3JlYXRlZEF0LCBldmVudElkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHNlbmRUYXNrcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGNsaWVudEtleSBvZiBPYmplY3Qua2V5cyh0aGlzLmNsaWVudHMpKSB7XG4gICAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHNbTnVtYmVyKGNsaWVudEtleSldXG4gICAgICBpZiAoIWNsaWVudCkgY29udGludWVcbiAgICAgIGNvbnN0IHNlc3Npb24gPSBjbGllbnQud2Vic29ja2V0U2Vzc2lvblxuXG4gICAgICBpZiAoIXNlc3Npb24pIGNvbnRpbnVlXG5cbiAgICAgIHNlbmRUYXNrcy5wdXNoKHNlc3Npb24uc2VuZEV2ZW50KGNoYW5uZWwsIHBheWxvYWQsIHtcbiAgICAgICAgY3JlYXRlZEF0LFxuICAgICAgICBldmVudElkXG4gICAgICB9KSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb25maWd1cmF0aW9uKSB7XG4gICAgICAvLyBJc29sYXRlIGNoYW5uZWwgc3Vic2NyaWJlciBmYWlsdXJlcyBzbyBhIGJ1Z2d5IGluLXByb2Nlc3MgY2FsbGJhY2tcbiAgICAgIC8vIGNhbm5vdCByZWplY3QgdGhpcyBjb21tYW5kIGFuZCBjcmFzaCB0aGUgd29ya2VyIHRocmVhZCwgYnV0IHN0aWxsXG4gICAgICAvLyBzdXJmYWNlIHRoZSBlcnJvciB0byB0aGUgZnJhbWV3b3JrIGVycm9yIGV2ZW50cyBzbyBidWcgcmVwb3J0ZXJzXG4gICAgICAvLyBjYW4gcGljayBpdCB1cC5cbiAgICAgIHNlbmRUYXNrcy5wdXNoKGRpc3BhdGNoQ2hhbm5lbFN1YnNjcmliZXJzKHtjaGFubmVsLCBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sIGNyZWF0ZWRBdCwgZXZlbnRJZCwgbG9nZ2VyOiB0aGlzLmxvZ2dlciwgcGF5bG9hZH0pKVxuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsKHNlbmRUYXNrcylcbiAgfVxufVxuIl19