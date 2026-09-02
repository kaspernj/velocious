// @ts-check
import { digg } from "diggerize";
import DevelopmentReloader from "./development-reloader.js";
import EventEmitter from "../utils/event-emitter.js";
import InProcessHandler from "./worker-handler/in-process.js";
import Logger from "../logger.js";
import Net from "net";
import os from "node:os";
import ServerClient from "./server-client.js";
import WorkerHandler from "./worker-handler/index.js";
/**
 * Defines this typedef.
 * @typedef {{start: () => Promise<void>, stop: () => Promise<void>}} DevelopmentReloaderLike */
/**
 * Defines this typedef.
 * @typedef {(args: {configuration: import("../configuration.js").default, onWebsocketSessionOwned: (args: {sessionId: string, workerHandler: WorkerHandler}) => void, onWebsocketSessionReleased: (args: {sessionId: string, workerHandler: WorkerHandler}) => void, onWorkerStopped: (args: {workerHandler: WorkerHandler}) => void, workerCount: number}) => (WorkerHandler | InProcessHandler)} WorkerHandlerFactory */
/**
 * Runs normalize worker count.
 * @param {object} args - Options object.
 * @param {number} [args.maxWorkers] - Backward-compatible worker count alias.
 * @param {number} [args.workers] - Configured worker count.
 * @param {number} args.defaultWorkerCount - Process-available CPU count.
 * @returns {number} - Normalized worker count.
 */
function normalizeWorkerCount({ defaultWorkerCount, maxWorkers, workers }) {
    const workerCount = workers ?? maxWorkers ?? defaultWorkerCount;
    if (!Number.isInteger(workerCount) || workerCount < 1) {
        throw new Error("HTTP server workers must be a positive integer");
    }
    return workerCount;
}
const MAX_INITIAL_REQUEST_HEADER_BYTES = 64 * 1024;
const WEBSOCKET_SESSION_ROUTING_PARAMETER = "velociousSessionId";
export default class VelociousHttpServer {
    clientCount = 0;
    _starting = false;
    /**
     * Narrows the runtime value to the documented type.
     * @type {DevelopmentReloader | DevelopmentReloaderLike | undefined} */
    developmentReloader;
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("net").Server | undefined} */
    netServer;
    /**
     * Narrows the runtime value to the documented type.
     * @type {WorkerHandlerFactory | undefined} */
    workerHandlerFactory;
    /**
     * Clients.
     * @type {Record<string, ServerClient>}  */
    clients = {};
    /**
     * Active sockets.
     * @type {Set<import("net").Socket>} */
    _activeSockets = new Set();
    events = new EventEmitter();
    workerCount = 0;
    /**
     * Worker handlers.
     * @type {Array<WorkerHandler | InProcessHandler>} */
    workerHandlers = [];
    nextWorkerHandlerIndex = 0;
    /** Worker ownership for live or grace-paused resumable WebSocket sessions. */
    websocketSessionOwners = new Map();
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} [args.host] - Host.
     * @param {boolean} [args.inProcess] - Run HTTP handlers in the main thread instead of worker threads.
     * @param {number} [args.port] - Port.
     * @param {number} [args.maxWorkers] - Max workers.
     * @param {number} [args.workers] - Worker handlers to start.
     * @param {() => number} [args.availableParallelism] - CPU availability owner seam.
     * @param {(args: {configuration: import("../configuration.js").default, onReload: (args: {changedPath: string}) => Promise<void>}) => {start: () => Promise<void>, stop: () => Promise<void>}} [args.developmentReloaderFactory] - Development reloader factory.
     * @param {WorkerHandlerFactory} [args.workerHandlerFactory] - Worker handler factory.
     */
    constructor({ availableParallelism = os.availableParallelism, configuration, developmentReloaderFactory, host, inProcess, maxWorkers, port, workerHandlerFactory, workers }) {
        this.configuration = configuration;
        this.developmentReloaderFactory = developmentReloaderFactory;
        this.workerHandlerFactory = workerHandlerFactory;
        this.inProcess = inProcess || false;
        this.logger = new Logger(this);
        this.host = host ?? "0.0.0.0";
        this.port = port ?? 3006;
        this.workers = normalizeWorkerCount({ defaultWorkerCount: availableParallelism(), maxWorkers, workers });
        this.effectiveWorkers = this.inProcess && workers === undefined && maxWorkers === undefined ? 1 : this.workers;
    }
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async start() {
        if (this._starting)
            throw new Error("Velocious HTTP server is already starting");
        if (this.isActive())
            throw new Error("Velocious HTTP server is already running");
        this._starting = true;
        const startupState = this._captureStartupState();
        try {
            await this._ensureWorkers();
            await this._startDevelopmentReloader();
            /**
             * Net server.
             * @type {import("net").Server} */
            const netServer = new Net.Server();
            this.netServer = netServer;
            netServer.on("close", this.onClose);
            netServer.on("connection", this.onConnection);
            netServer.on("error", this.onServerError);
            await this._netServerListen();
        }
        catch (error) {
            await this._stopStartupResources(startupState);
            throw error;
        }
        finally {
            this._starting = false;
        }
    }
    /**
     * Runs capture startup state.
     * @returns {{developmentReloader: DevelopmentReloader | DevelopmentReloaderLike | undefined, netServer: import("net").Server | undefined, workerHandlers: Array<WorkerHandler | InProcessHandler>}} - Startup state.
     */
    _captureStartupState() {
        return {
            developmentReloader: this.developmentReloader,
            netServer: this.netServer,
            workerHandlers: [...this.workerHandlers]
        };
    }
    /**
     * Runs stop startup resources.
     * @param {ReturnType<VelociousHttpServer["_captureStartupState"]>} startupState - State captured before startup.
     * @returns {Promise<void>} - Resolves when cleanup is complete.
     */
    async _stopStartupResources(startupState) {
        /**
         * Startup net server.
         * @type {import("net").Server | undefined} */
        const startupNetServer = this.netServer;
        if (this.developmentReloader && this.developmentReloader !== startupState.developmentReloader) {
            await this.developmentReloader.stop();
        }
        if (startupNetServer && startupNetServer !== startupState.netServer) {
            await this.stopServer(startupNetServer);
        }
        const startupWorkerHandlers = this.workerHandlers.filter((workerHandler) => !startupState.workerHandlers.includes(workerHandler));
        await Promise.all(startupWorkerHandlers.map((handler) => handler.stop()));
        this.developmentReloader = startupState.developmentReloader;
        this.netServer = startupState.netServer;
        this.workerHandlers = startupState.workerHandlers;
        this.websocketSessionOwners.clear();
    }
    /**
     * Runs net server listen.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _netServerListen() {
        return new Promise((resolve, reject) => {
            if (!this.netServer)
                throw new Error("No netServer");
            /**
             * On listen error.
             * @param {Error} error - Listen error.
             */
            const onListenError = (error) => {
                this.netServer?.off("error", onListenError);
                reject(error);
            };
            try {
                this.netServer.once("error", onListenError);
                this.netServer.listen(this.port, this.host, () => {
                    this.netServer?.off("error", onListenError);
                    this.logger.debug(`Velocious listening on ${this.host}:${this.port}`);
                    resolve(undefined);
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    /**
     * Runs ensure workers.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _ensureWorkers() {
        while (this.workerHandlers.length < this.effectiveWorkers) {
            await this.spawnWorker();
        }
    }
    /**
     * Runs is active.
     * @returns {boolean} - Whether active.
     */
    isActive() {
        if (this.netServer) {
            return this.netServer.listening;
        }
        return false;
    }
    /**
     * Runs get debug snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - HTTP server worker diagnostics.
     */
    async getDebugSnapshot() {
        return {
            active: this.isActive(),
            activeSocketCount: this._activeSockets.size,
            clientCount: Object.keys(this.clients).length,
            configuredWorkerCount: this.workers,
            effectiveWorkerCount: this.effectiveWorkers,
            inProcess: this.inProcess,
            workerCount: this.workerHandlers.length,
            workers: await Promise.all(this.workerHandlers.map((handler) => this.workerDebugSnapshot(handler)))
        };
    }
    /**
     * Runs worker debug snapshot.
     * @param {WorkerHandler | InProcessHandler} workerHandler - Worker handler to inspect.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Worker debug snapshot.
     */
    async workerDebugSnapshot(workerHandler) {
        if (workerHandler instanceof WorkerHandler)
            return await workerHandler.getDebugSnapshot();
        if (workerHandler instanceof InProcessHandler)
            return this.inProcessWorkerDebugSnapshot(workerHandler);
        return { active: false, error: "Unknown worker handler type" };
    }
    /**
     * Runs in process worker debug snapshot.
     * @param {InProcessHandler} workerHandler - In-process worker handler to inspect.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Worker debug snapshot.
     */
    inProcessWorkerDebugSnapshot(workerHandler) {
        return {
            active: true,
            clientCount: Object.keys(workerHandler.clients).length,
            snapshot: workerHandler.configuration.getLocalDebugSnapshot(),
            workerCount: workerHandler.workerCount
        };
    }
    /**
     * Runs stop clients.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async stopClients() {
        const promises = [];
        for (const clientCount in this.clients) {
            const client = this.clients[clientCount];
            promises.push(client.end());
        }
        await Promise.all(promises);
    }
    /**
     * Runs stop server.
     * @param {import("net").Server | undefined} [netServer] - Server to stop.
     * @returns {Promise<void>} - Resolves when complete.
     */
    stopServer(netServer = this.netServer) {
        return new Promise((resolve, reject) => {
            if (!netServer || !netServer.listening) {
                resolve(undefined);
                return;
            }
            if (netServer === this.netServer) {
                // Force-close lingering sockets (e.g. WebSocket upgrade
                // connections mid-close-handshake) so the port is released
                // immediately instead of waiting for graceful drain.
                for (const socket of this._activeSockets) {
                    socket.destroy();
                }
                this._activeSockets.clear();
            }
            netServer.close((error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve(undefined);
                }
            });
        });
    }
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async stop() {
        this._stopping = true;
        await this.developmentReloader?.stop();
        this.developmentReloader = undefined;
        await this.stopClients();
        await this.stopServer();
        const stopTasks = this.workerHandlers.map((handler) => handler.stop());
        await Promise.all(stopTasks);
        this.workerHandlers = [];
        this.websocketSessionOwners.clear();
    }
    /**
     * On close.
     * @returns {void} - No return value.
     */
    onClose = () => {
        this.events.emit("close");
    };
    /**
     * On server error.
     * @param {Error} error - Server socket error.
     * @returns {void} - No return value.
     */
    onServerError = (error) => {
        this.logger.error(`Velocious HTTP server socket error on ${this.host}:${this.port}`, error);
    };
    /**
     * On connection.
     * @param {import("net").Socket} socket - Socket instance.
     * @returns {void} - No return value.
     */
    onConnection = (socket) => {
        const clientCount = this.clientCount;
        this._activeSockets.add(socket);
        socket.once("close", () => this._activeSockets.delete(socket));
        this.logger.debug(() => ["New client", {
                clientCount,
                remoteAddress: socket.remoteAddress,
                remoteFamily: socket.remoteFamily,
                remotePort: socket.remotePort
            }]);
        this.clientCount++;
        try {
            const client = new ServerClient({
                clientCount,
                configuration: this.configuration,
                socket
            });
            client.events.on("close", this.onClientClose);
            this.clients[clientCount] = client;
            this.routeClientAfterInitialRoutingData(client);
        }
        catch (error) {
            this.logger.error(`Failed to initialize client ${clientCount} on new connection`, error);
            socket.destroy();
        }
    };
    /**
     * Buffers only the bounded initial request data needed to recognize a
     * WebSocket resume routing hint, then replays it to the selected worker.
     * @param {ServerClient} client - Unassigned socket client.
     * @returns {void}
     */
    routeClientAfterInitialRoutingData(client) {
        const { socket } = client;
        /** @type {Buffer[]} */
        const chunks = [];
        let byteLength = 0;
        const cleanup = () => {
            socket.off("data", onData);
            socket.off("close", cleanup);
        };
        const onData = (/** @type {Buffer} */ chunk) => {
            chunks.push(chunk);
            byteLength += chunk.length;
            const initialRequest = Buffer.concat(chunks, byteLength);
            if (this.initialRequestNeedsMoreRoutingData(initialRequest) && byteLength < MAX_INITIAL_REQUEST_HEADER_BYTES)
                return;
            cleanup();
            this.assignClientToWorker(client, initialRequest);
        };
        socket.on("data", onData);
        socket.once("close", cleanup);
    }
    /**
     * Checks whether the buffered initial HTTP headers are complete.
     * @param {Buffer} initialRequest - Buffered initial request bytes.
     * @returns {boolean} - Whether a header terminator is present.
     */
    initialRequestHeadersComplete(initialRequest) {
        return initialRequest.includes("\r\n\r\n") || initialRequest.includes("\n\n");
    }
    /**
     * Checks whether a possible resumable WebSocket request still needs headers.
     * Ordinary and malformed requests can reach the existing request parser as
     * soon as their first line is complete.
     * @param {Buffer} initialRequest - Buffered initial request bytes.
     * @returns {boolean} - Whether more routing data is required.
     */
    initialRequestNeedsMoreRoutingData(initialRequest) {
        if (this.initialRequestHeadersComplete(initialRequest))
            return false;
        const lineEnd = initialRequest.indexOf("\n");
        if (lineEnd === -1)
            return true;
        const requestLine = initialRequest.subarray(0, lineEnd).toString("latin1").replace(/\r$/, "");
        const requestLineMatch = requestLine.match(/^GET ([^ ]+) HTTP\/[^ ]+$/);
        if (!requestLineMatch)
            return false;
        try {
            const requestUrl = new URL(requestLineMatch[1], "http://velocious.invalid");
            return requestUrl.searchParams.has(WEBSOCKET_SESSION_ROUTING_PARAMETER);
        }
        catch {
            return false;
        }
    }
    /**
     * Assigns a buffered client and replays the exact bytes into its worker.
     * @param {ServerClient} client - Client awaiting assignment.
     * @param {Buffer} initialRequest - Initial request bytes.
     * @returns {void}
     */
    assignClientToWorker(client, initialRequest) {
        if (client.socket.destroyed)
            return;
        try {
            const workerHandler = this.workerHandlerForInitialRequest(initialRequest);
            this.logger.debug(`Gave client ${client.clientCount} to worker ${workerHandler.workerCount}`);
            workerHandler.addSocketConnection(client);
            client.onSocketData(initialRequest);
        }
        catch (error) {
            this.logger.error(`Failed to assign client ${client.clientCount} to a worker`, error);
            client.destroy(error instanceof Error ? error : new Error("Failed to assign HTTP client to worker", { cause: error }));
        }
    }
    /**
     * Selects the owner of a resumable WebSocket session or the next ordinary worker.
     * @param {Buffer} initialRequest - Initial HTTP request headers.
     * @returns {WorkerHandler | InProcessHandler} - Selected worker.
     */
    workerHandlerForInitialRequest(initialRequest) {
        const sessionId = this.websocketResumeSessionId(initialRequest);
        if (sessionId) {
            const owner = this.websocketSessionOwners.get(sessionId);
            if (owner && this.workerHandlers.includes(owner))
                return owner;
            if (owner)
                this.websocketSessionOwners.delete(sessionId);
        }
        return this.workerHandlerToUse();
    }
    /**
     * Reads the resumable WebSocket session routing hint from an upgrade request.
     * @param {Buffer} initialRequest - Initial HTTP request headers.
     * @returns {string | undefined} - Session identity, if present on a WebSocket upgrade.
     */
    websocketResumeSessionId(initialRequest) {
        const headerEnd = initialRequest.indexOf("\r\n\r\n");
        const fallbackHeaderEnd = headerEnd === -1 ? initialRequest.indexOf("\n\n") : headerEnd;
        if (fallbackHeaderEnd === -1)
            return;
        const lines = initialRequest.subarray(0, fallbackHeaderEnd).toString("latin1").split(/\r?\n/);
        const [method, requestTarget] = lines[0]?.split(" ") || [];
        if (method !== "GET" || !requestTarget)
            return;
        /** @type {Map<string, string>} */
        const headers = new Map();
        for (const line of lines.slice(1)) {
            const separatorIndex = line.indexOf(":");
            if (separatorIndex === -1)
                continue;
            headers.set(line.slice(0, separatorIndex).trim().toLowerCase(), line.slice(separatorIndex + 1).trim().toLowerCase());
        }
        if (headers.get("upgrade") !== "websocket" || !headers.get("connection")?.split(",").map((value) => value.trim()).includes("upgrade"))
            return;
        const sessionId = new URL(requestTarget, "http://velocious.invalid").searchParams.get(WEBSOCKET_SESSION_ROUTING_PARAMETER);
        return sessionId || undefined;
    }
    /**
     * Records the live worker owner for a resumable session.
     * @param {{sessionId: string, workerHandler: WorkerHandler | InProcessHandler}} args - Ownership claim.
     * @returns {void}
     */
    claimWebsocketSession({ sessionId, workerHandler }) {
        if (!this.workerHandlers.includes(workerHandler))
            return;
        this.websocketSessionOwners.set(sessionId, workerHandler);
    }
    /**
     * Releases a session only when the releasing worker still owns it.
     * @param {{sessionId: string, workerHandler: WorkerHandler | InProcessHandler}} args - Ownership release.
     * @returns {void}
     */
    releaseWebsocketSession({ sessionId, workerHandler }) {
        if (this.websocketSessionOwners.get(sessionId) === workerHandler)
            this.websocketSessionOwners.delete(sessionId);
    }
    /**
     * Releases every session owned by a worker leaving service.
     * @param {WorkerHandler | InProcessHandler} workerHandler - Worker leaving service.
     * @returns {void}
     */
    releaseWebsocketSessionsForWorker(workerHandler) {
        for (const [sessionId, owner] of this.websocketSessionOwners) {
            if (owner === workerHandler)
                this.websocketSessionOwners.delete(sessionId);
        }
    }
    /**
     * On client close.
     * @param {ServerClient} client - Client instance.
     * @returns {void} - No return value.
     */
    onClientClose = (client) => {
        const clientCount = digg(client, "clientCount");
        const oldClientsLength = Object.keys(this.clients).length;
        delete this.clients[clientCount];
        const newClientsLength = Object.keys(this.clients).length;
        if (newClientsLength != (oldClientsLength - 1)) {
            this.logger.error(`Expected client to have been removed but length didn't change from ${oldClientsLength} to ${oldClientsLength - 1}`);
        }
    };
    /**
     * Runs spawn worker.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async spawnWorker() {
        const workerHandler = await this._buildWorkerHandler();
        this.workerHandlers.push(workerHandler);
    }
    /**
     * Runs build worker handlers.
     * @returns {Promise<Array<WorkerHandler | InProcessHandler>>} - Started worker handlers.
     */
    async _buildWorkerHandlers() {
        /**
         * Worker handlers.
         * @type {Array<WorkerHandler | InProcessHandler>} */
        const workerHandlers = [];
        for (let index = 0; index < this.effectiveWorkers; index += 1) {
            workerHandlers.push(await this._buildWorkerHandler());
        }
        return workerHandlers;
    }
    /**
     * Runs build worker handler.
     * @returns {Promise<WorkerHandler | InProcessHandler>} - Started worker handler.
     */
    async _buildWorkerHandler() {
        const workerCount = this.workerCount;
        this.workerCount++;
        const Handler = this.inProcess ? InProcessHandler : WorkerHandler;
        const workerHandler = this.workerHandlerFactory
            ? this.workerHandlerFactory({
                configuration: this.configuration,
                onWebsocketSessionOwned: ({ sessionId, workerHandler }) => this.claimWebsocketSession({ sessionId, workerHandler }),
                onWebsocketSessionReleased: ({ sessionId, workerHandler }) => this.releaseWebsocketSession({ sessionId, workerHandler }),
                onWorkerStopped: ({ workerHandler }) => this.releaseWebsocketSessionsForWorker(workerHandler),
                workerCount
            })
            : new Handler({
                configuration: this.configuration,
                onWebsocketSessionOwned: ({ sessionId, workerHandler }) => this.claimWebsocketSession({ sessionId, workerHandler }),
                onWebsocketSessionReleased: ({ sessionId, workerHandler }) => this.releaseWebsocketSession({ sessionId, workerHandler }),
                onWorkerStopped: ({ workerHandler }) => this.releaseWebsocketSessionsForWorker(workerHandler),
                workerCount
            });
        await workerHandler.start();
        return workerHandler;
    }
    /**
     * Runs worker handler to use.
     * @returns {WorkerHandler | InProcessHandler} - The worker handler to use.
     */
    workerHandlerToUse() {
        return this._nextRoundRobinWorkerHandler();
    }
    /**
     * Runs next round robin worker handler.
     * @returns {WorkerHandler | InProcessHandler} - The next round-robin worker handler.
     */
    _nextRoundRobinWorkerHandler() {
        this.logger.debug(`Worker handlers length: ${this.workerHandlers.length}`);
        const workerHandlerIndex = this.nextWorkerHandlerIndex % this.workerHandlers.length;
        const workerHandler = this.workerHandlers[workerHandlerIndex];
        if (!workerHandler) {
            throw new Error(`No workerHandler by that number: ${workerHandlerIndex}`);
        }
        this.nextWorkerHandlerIndex += 1;
        return workerHandler;
    }
    /**
     * Runs should use development hot reload.
     * @returns {boolean} - Whether development worker hot reload should run.
     */
    shouldUseDevelopmentHotReload() {
        return !this.inProcess && this.configuration.getEnvironment() === "development";
    }
    /**
     * Runs start development reloader.
     * @returns {Promise<void>} - Resolves when watcher setup finishes.
     */
    async _startDevelopmentReloader() {
        if (!this.shouldUseDevelopmentHotReload())
            return;
        if (this.developmentReloader)
            return;
        const createDevelopmentReloader = this.developmentReloaderFactory
            || ((args) => new DevelopmentReloader(args));
        this.developmentReloader = createDevelopmentReloader({
            configuration: this.configuration,
            onReload: async ({ changedPath }) => {
                await this.logger.info(`Development hot reload detected change in ${changedPath}`);
                await this.reloadWorkersForDevelopment();
            }
        });
        await this.developmentReloader.start();
    }
    /**
     * Runs reload workers for development.
     * @returns {Promise<void>} - Resolves when workers have been refreshed.
     */
    async reloadWorkersForDevelopment() {
        if (this._stopping)
            return;
        if (this._reloadingWorkersForDevelopment) {
            this._reloadWorkersForDevelopmentQueued = true;
            return;
        }
        this._reloadingWorkersForDevelopment = true;
        try {
            do {
                this._reloadWorkersForDevelopmentQueued = false;
                const oldWorkerHandlers = [...this.workerHandlers];
                const newWorkerHandlers = await this._buildWorkerHandlers();
                this.workerHandlers = newWorkerHandlers;
                this.nextWorkerHandlerIndex = 0;
                for (const workerHandler of oldWorkerHandlers)
                    this.releaseWebsocketSessionsForWorker(workerHandler);
                await Promise.all(oldWorkerHandlers.map((workerHandler) => workerHandler.stop()));
            } while (this._reloadWorkersForDevelopmentQueued && !this._stopping);
        }
        finally {
            this._reloadingWorkersForDevelopment = false;
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxtQkFBbUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUMzRCxPQUFPLFlBQVksTUFBTSwyQkFBMkIsQ0FBQTtBQUNwRCxPQUFPLGdCQUFnQixNQUFNLGdDQUFnQyxDQUFBO0FBQzdELE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLEdBQUcsTUFBTSxLQUFLLENBQUE7QUFDckIsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3hCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sYUFBYSxNQUFNLDJCQUEyQixDQUFBO0FBRXJEOztnR0FFZ0c7QUFDaEc7OzJaQUUyWjtBQUUzWjs7Ozs7OztHQU9HO0FBQ0gsU0FBUyxvQkFBb0IsQ0FBQyxFQUFDLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUM7SUFDckUsTUFBTSxXQUFXLEdBQUcsT0FBTyxJQUFJLFVBQVUsSUFBSSxrQkFBa0IsQ0FBQTtJQUUvRCxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsSUFBSSxXQUFXLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDdEQsTUFBTSxJQUFJLEtBQUssQ0FBQyxnREFBZ0QsQ0FBQyxDQUFBO0lBQ25FLENBQUM7SUFFRCxPQUFPLFdBQVcsQ0FBQTtBQUNwQixDQUFDO0FBRUQsTUFBTSxnQ0FBZ0MsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQ2xELE1BQU0sbUNBQW1DLEdBQUcsb0JBQW9CLENBQUE7QUFFaEUsTUFBTSxDQUFDLE9BQU8sT0FBTyxtQkFBbUI7SUFDdEMsV0FBVyxHQUFHLENBQUMsQ0FBQTtJQUNmLFNBQVMsR0FBRyxL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LENBQUMsa0NBQWtDLEdBQUcsSUFBSSxDQUFBO1lBQzlDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLCtCQUErQixHQUFHLElBQUksQ0FBQTtRQUUzQyxJQUFJLENBQUM7WUFDSCxHQUFHLENBQUM7Z0JBQ0YsSUFBSSxDQUFDLGtDQUFrQyxHQUFHLEtBQUssQ0FBQTtnQkFFL0MsTUFBTSxpQkFBaUIsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBO2dCQUNsRCxNQUFNLGlCQUFpQixHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7Z0JBRTNELElBQUksQ0FBQyxjQUFjLEdBQUcsaUJBQWlCLENBQUE7Z0JBQ3ZDLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxDQUFDLENBQUE7Z0JBQy9CLEtBQUssTUFBTSxhQUFhLElBQUksaUJBQWlCO29CQUFFLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxhQUFhLENBQUMsQ0FBQTtnQkFFcEcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQTtZQUNuRixDQUFDLFFBQVEsSUFBSSxDQUFDLGtDQUFrQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBQztRQUN0RSxDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsK0JBQStCLEdBQUcsS0FBSyxDQUFBO1FBQzlDLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBEZXZlbG9wbWVudFJlbG9hZGVyIGZyb20gXCIuL2RldmVsb3BtZW50LXJlbG9hZGVyLmpzXCJcbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IEluUHJvY2Vzc0hhbmRsZXIgZnJvbSBcIi4vd29ya2VyLWhhbmRsZXIvaW4tcHJvY2Vzcy5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IE5ldCBmcm9tIFwibmV0XCJcbmltcG9ydCBvcyBmcm9tIFwibm9kZTpvc1wiXG5pbXBvcnQgU2VydmVyQ2xpZW50IGZyb20gXCIuL3NlcnZlci1jbGllbnQuanNcIlxuaW1wb3J0IFdvcmtlckhhbmRsZXIgZnJvbSBcIi4vd29ya2VyLWhhbmRsZXIvaW5kZXguanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tzdGFydDogKCkgPT4gUHJvbWlzZTx2b2lkPiwgc3RvcDogKCkgPT4gUHJvbWlzZTx2b2lkPn19IERldmVsb3BtZW50UmVsb2FkZXJMaWtlICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBvbldlYnNvY2tldFNlc3Npb25Pd25lZDogKGFyZ3M6IHtzZXNzaW9uSWQ6IHN0cmluZywgd29ya2VySGFuZGxlcjogV29ya2VySGFuZGxlcn0pID0+IHZvaWQsIG9uV2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkOiAoYXJnczoge3Nlc3Npb25JZDogc3RyaW5nLCB3b3JrZXJIYW5kbGVyOiBXb3JrZXJIYW5kbGVyfSkgPT4gdm9pZCwgb25Xb3JrZXJTdG9wcGVkOiAoYXJnczoge3dvcmtlckhhbmRsZXI6IFdvcmtlckhhbmRsZXJ9KSA9PiB2b2lkLCB3b3JrZXJDb3VudDogbnVtYmVyfSkgPT4gKFdvcmtlckhhbmRsZXIgfCBJblByb2Nlc3NIYW5kbGVyKX0gV29ya2VySGFuZGxlckZhY3RvcnkgKi9cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSB3b3JrZXIgY291bnQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heFdvcmtlcnNdIC0gQmFja3dhcmQtY29tcGF0aWJsZSB3b3JrZXIgY291bnQgYWxpYXMuXG4gKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2Vyc10gLSBDb25maWd1cmVkIHdvcmtlciBjb3VudC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmRlZmF1bHRXb3JrZXJDb3VudCAtIFByb2Nlc3MtYXZhaWxhYmxlIENQVSBjb3VudC5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTm9ybWFsaXplZCB3b3JrZXIgY291bnQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlckNvdW50KHtkZWZhdWx0V29ya2VyQ291bnQsIG1heFdvcmtlcnMsIHdvcmtlcnN9KSB7XG4gIGNvbnN0IHdvcmtlckNvdW50ID0gd29ya2VycyA/PyBtYXhXb3JrZXJzID8/IGRlZmF1bHRXb3JrZXJDb3VudFxuXG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcih3b3JrZXJDb3VudCkgfHwgd29ya2VyQ291bnQgPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiSFRUUCBzZXJ2ZXIgd29ya2VycyBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlclwiKVxuICB9XG5cbiAgcmV0dXJuIHdvcmtlckNvdW50XG59XG5cbmNvbnN0IE1BWF9JTklUSUFMX1JFUVVFU1RfSEVBREVSX0JZVEVTID0gNjQgKiAxMDI0XG5jb25zdCBXRUJTT0NLRVRfU0VTU0lPTl9ST1VUSU5HX1BBUkFNRVRFUiA9IFwidmVsb2Npb3VzU2Vzc2lvbklkXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlciB7XG4gIGNsaWVudENvdW50ID0gMFxuICBfc3RhcnRpbmcgPSBmYWxzZVxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtEZXZlbG9wbWVudFJlbG9hZGVyIHwgRGV2ZWxvcG1lbnRSZWxvYWRlckxpa2UgfCB1bmRlZmluZWR9ICovXG4gIGRldmVsb3BtZW50UmVsb2FkZXJcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwibmV0XCIpLlNlcnZlciB8IHVuZGVmaW5lZH0gKi9cbiAgbmV0U2VydmVyXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1dvcmtlckhhbmRsZXJGYWN0b3J5IHwgdW5kZWZpbmVkfSAqL1xuICB3b3JrZXJIYW5kbGVyRmFjdG9yeVxuXG4gIC8qKlxuICAgKiBDbGllbnRzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgU2VydmVyQ2xpZW50Pn0gICovXG4gIGNsaWVudHMgPSB7fVxuXG4gIC8qKlxuICAgKiBBY3RpdmUgc29ja2V0cy5cbiAgICogQHR5cGUge1NldDxpbXBvcnQoXCJuZXRcIikuU29ja2V0Pn0gKi9cbiAgX2FjdGl2ZVNvY2tldHMgPSBuZXcgU2V0KClcblxuICBldmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcbiAgd29ya2VyQ291bnQgPSAwXG5cbiAgLyoqXG4gICAqIFdvcmtlciBoYW5kbGVycy5cbiAgICogQHR5cGUge0FycmF5PFdvcmtlckhhbmRsZXIgfCBJblByb2Nlc3NIYW5kbGVyPn0gKi9cbiAgd29ya2VySGFuZGxlcnMgPSBbXVxuICBuZXh0V29ya2VySGFuZGxlckluZGV4ID0gMFxuICAvKiogV29ya2VyIG93bmVyc2hpcCBmb3IgbGl2ZSBvciBncmFjZS1wYXVzZWQgcmVzdW1hYmxlIFdlYlNvY2tldCBzZXNzaW9ucy4gKi9cbiAgd2Vic29ja2V0U2Vzc2lvbk93bmVycyA9IG5ldyBNYXAoKVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pblByb2Nlc3NdIC0gUnVuIEhUVFAgaGFuZGxlcnMgaW4gdGhlIG1haW4gdGhyZWFkIGluc3RlYWQgb2Ygd29ya2VyIHRocmVhZHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb3J0XSAtIFBvcnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5tYXhXb3JrZXJzXSAtIE1heCB3b3JrZXJzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2Vyc10gLSBXb3JrZXIgaGFuZGxlcnMgdG8gc3RhcnQuXG4gICAqIEBwYXJhbSB7KCkgPT4gbnVtYmVyfSBbYXJncy5hdmFpbGFibGVQYXJhbGxlbGlzbV0gLSBDUFUgYXZhaWxhYmlsaXR5IG93bmVyIHNlYW0uXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIG9uUmVsb2FkOiAoYXJnczoge2NoYW5nZWRQYXRoOiBzdHJpbmd9KSA9PiBQcm9taXNlPHZvaWQ+fSkgPT4ge3N0YXJ0OiAoKSA9PiBQcm9taXNlPHZvaWQ+LCBzdG9wOiAoKSA9PiBQcm9taXNlPHZvaWQ+fX0gW2FyZ3MuZGV2ZWxvcG1lbnRSZWxvYWRlckZhY3RvcnldIC0gRGV2ZWxvcG1lbnQgcmVsb2FkZXIgZmFjdG9yeS5cbiAgICogQHBhcmFtIHtXb3JrZXJIYW5kbGVyRmFjdG9yeX0gW2FyZ3Mud29ya2VySGFuZGxlckZhY3RvcnldIC0gV29ya2VyIGhhbmRsZXIgZmFjdG9yeS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthdmFpbGFibGVQYXJhbGxlbGlzbSA9IG9zLmF2YWlsYWJsZVBhcmFsbGVsaXNtLCBjb25maWd1cmF0aW9uLCBkZXZlbG9wbWVudFJlbG9hZGVyRmFjdG9yeSwgaG9zdCwgaW5Qcm9jZXNzLCBtYXhXb3JrZXJzLCBwb3J0LCB3b3JrZXJIYW5kbGVyRmFjdG9yeSwgd29ya2Vyc30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kZXZlbG9wbWVudFJlbG9hZGVyRmFjdG9yeSA9IGRldmVsb3BtZW50UmVsb2FkZXJGYWN0b3J5XG4gICAgdGhpcy53b3JrZXJIYW5kbGVyRmFjdG9yeSA9IHdvcmtlckhhbmRsZXJGYWN0b3J5XG4gICAgdGhpcy5pblByb2Nlc3MgPSBpblByb2Nlc3MgfHwgZmFsc2VcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLmhvc3QgPSBob3N0ID8/IFwiMC4wLjAuMFwiXG4gICAgdGhpcy5wb3J0ID0gcG9ydCA/PyAzMDA2XG4gICAgdGhpcy53b3JrZXJzID0gbm9ybWFsaXplV29ya2VyQ291bnQoe2RlZmF1bHRXb3JrZXJDb3VudDogYXZhaWxhYmxlUGFyYWxsZWxpc20oKSwgbWF4V29ya2Vycywgd29ya2Vyc30pXG4gICAgdGhpcy5lZmZlY3RpdmVXb3JrZXJzID0gdGhpcy5pblByb2Nlc3MgJiYgd29ya2VycyA9PT0gdW5kZWZpbmVkICYmIG1heFdvcmtlcnMgPT09IHVuZGVmaW5lZCA/IDEgOiB0aGlzLndvcmtlcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgaWYgKHRoaXMuX3N0YXJ0aW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJWZWxvY2lvdXMgSFRUUCBzZXJ2ZXIgaXMgYWxyZWFkeSBzdGFydGluZ1wiKVxuICAgIGlmICh0aGlzLmlzQWN0aXZlKCkpIHRocm93IG5ldyBFcnJvcihcIlZlbG9jaW91cyBIVFRQIHNlcnZlciBpcyBhbHJlYWR5IHJ1bm5pbmdcIilcblxuICAgIHRoaXMuX3N0YXJ0aW5nID0gdHJ1ZVxuICAgIGNvbnN0IHN0YXJ0dXBTdGF0ZSA9IHRoaXMuX2NhcHR1cmVTdGFydHVwU3RhdGUoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVdvcmtlcnMoKVxuICAgICAgYXdhaXQgdGhpcy5fc3RhcnREZXZlbG9wbWVudFJlbG9hZGVyKClcbiAgICAgIC8qKlxuICAgICAgICogTmV0IHNlcnZlci5cbiAgICAgICAqIEB0eXBlIHtpbXBvcnQoXCJuZXRcIikuU2VydmVyfSAqL1xuICAgICAgY29uc3QgbmV0U2VydmVyID0gbmV3IE5ldC5TZXJ2ZXIoKVxuICAgICAgdGhpcy5uZXRTZXJ2ZXIgPSBuZXRTZXJ2ZXJcbiAgICAgIG5ldFNlcnZlci5vbihcImNsb3NlXCIsIHRoaXMub25DbG9zZSlcbiAgICAgIG5ldFNlcnZlci5vbihcImNvbm5lY3Rpb25cIiwgdGhpcy5vbkNvbm5lY3Rpb24pXG4gICAgICBuZXRTZXJ2ZXIub24oXCJlcnJvclwiLCB0aGlzLm9uU2VydmVyRXJyb3IpXG4gICAgICBhd2FpdCB0aGlzLl9uZXRTZXJ2ZXJMaXN0ZW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCB0aGlzLl9zdG9wU3RhcnR1cFJlc291cmNlcyhzdGFydHVwU3RhdGUpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9zdGFydGluZyA9IGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FwdHVyZSBzdGFydHVwIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7e2RldmVsb3BtZW50UmVsb2FkZXI6IERldmVsb3BtZW50UmVsb2FkZXIgfCBEZXZlbG9wbWVudFJlbG9hZGVyTGlrZSB8IHVuZGVmaW5lZCwgbmV0U2VydmVyOiBpbXBvcnQoXCJuZXRcIikuU2VydmVyIHwgdW5kZWZpbmVkLCB3b3JrZXJIYW5kbGVyczogQXJyYXk8V29ya2VySGFuZGxlciB8IEluUHJvY2Vzc0hhbmRsZXI+fX0gLSBTdGFydHVwIHN0YXRlLlxuICAgKi9cbiAgX2NhcHR1cmVTdGFydHVwU3RhdGUoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRldmVsb3BtZW50UmVsb2FkZXI6IHRoaXMuZGV2ZWxvcG1lbnRSZWxvYWRlcixcbiAgICAgIG5ldFNlcnZlcjogdGhpcy5uZXRTZXJ2ZXIsXG4gICAgICB3b3JrZXJIYW5kbGVyczogWy4uLnRoaXMud29ya2VySGFuZGxlcnNdXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RvcCBzdGFydHVwIHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPFZlbG9jaW91c0h0dHBTZXJ2ZXJbXCJfY2FwdHVyZVN0YXJ0dXBTdGF0ZVwiXT59IHN0YXJ0dXBTdGF0ZSAtIFN0YXRlIGNhcHR1cmVkIGJlZm9yZSBzdGFydHVwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgaXMgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfc3RvcFN0YXJ0dXBSZXNvdXJjZXMoc3RhcnR1cFN0YXRlKSB7XG4gICAgLyoqXG4gICAgICogU3RhcnR1cCBuZXQgc2VydmVyLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCJuZXRcIikuU2VydmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIGNvbnN0IHN0YXJ0dXBOZXRTZXJ2ZXIgPSB0aGlzLm5ldFNlcnZlclxuXG4gICAgaWYgKHRoaXMuZGV2ZWxvcG1lbnRSZWxvYWRlciAmJiB0aGlzLmRldmVsb3BtZW50UmVsb2FkZXIgIT09IHN0YXJ0dXBTdGF0ZS5kZXZlbG9wbWVudFJlbG9hZGVyKSB7XG4gICAgICBhd2FpdCB0aGlzLmRldmVsb3BtZW50UmVsb2FkZXIuc3RvcCgpXG4gICAgfVxuXG4gICAgaWYgKHN0YXJ0dXBOZXRTZXJ2ZXIgJiYgc3RhcnR1cE5ldFNlcnZlciAhPT0gc3RhcnR1cFN0YXRlLm5ldFNlcnZlcikge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wU2VydmVyKHN0YXJ0dXBOZXRTZXJ2ZXIpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnR1cFdvcmtlckhhbmRsZXJzID0gdGhpcy53b3JrZXJIYW5kbGVycy5maWx0ZXIoKHdvcmtlckhhbmRsZXIpID0+ICFzdGFydHVwU3RhdGUud29ya2VySGFuZGxlcnMuaW5jbHVkZXMod29ya2VySGFuZGxlcikpXG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChzdGFydHVwV29ya2VySGFuZGxlcnMubWFwKChoYW5kbGVyKSA9PiBoYW5kbGVyLnN0b3AoKSkpXG5cbiAgICB0aGlzLmRldmVsb3BtZW50UmVsb2FkZXIgPSBzdGFydHVwU3RhdGUuZGV2ZWxvcG1lbnRSZWxvYWRlclxuICAgIHRoaXMubmV0U2VydmVyID0gc3RhcnR1cFN0YXRlLm5ldFNlcnZlclxuICAgIHRoaXMud29ya2VySGFuZGxlcnMgPSBzdGFydHVwU3RhdGUud29ya2VySGFuZGxlcnNcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb25Pd25lcnMuY2xlYXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV0IHNlcnZlciBsaXN0ZW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBfbmV0U2VydmVyTGlzdGVuKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBpZiAoIXRoaXMubmV0U2VydmVyKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBuZXRTZXJ2ZXJcIilcblxuICAgICAgLyoqXG4gICAgICAgKiBPbiBsaXN0ZW4gZXJyb3IuXG4gICAgICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIExpc3RlbiBlcnJvci5cbiAgICAgICAqL1xuICAgICAgY29uc3Qgb25MaXN0ZW5FcnJvciA9IChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLm5ldFNlcnZlcj8ub2ZmKFwiZXJyb3JcIiwgb25MaXN0ZW5FcnJvcilcbiAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLm5ldFNlcnZlci5vbmNlKFwiZXJyb3JcIiwgb25MaXN0ZW5FcnJvcilcbiAgICAgICAgdGhpcy5uZXRTZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgdGhpcy5ob3N0LCAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5uZXRTZXJ2ZXI/Lm9mZihcImVycm9yXCIsIG9uTGlzdGVuRXJyb3IpXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFZlbG9jaW91cyBsaXN0ZW5pbmcgb24gJHt0aGlzLmhvc3R9OiR7dGhpcy5wb3J0fWApXG4gICAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSB3b3JrZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVdvcmtlcnMoKSB7XG4gICAgd2hpbGUgKHRoaXMud29ya2VySGFuZGxlcnMubGVuZ3RoIDwgdGhpcy5lZmZlY3RpdmVXb3JrZXJzKSB7XG4gICAgICBhd2FpdCB0aGlzLnNwYXduV29ya2VyKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBhY3RpdmUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYWN0aXZlLlxuICAgKi9cbiAgaXNBY3RpdmUoKSB7XG4gICAgaWYgKHRoaXMubmV0U2VydmVyKSB7XG4gICAgICByZXR1cm4gdGhpcy5uZXRTZXJ2ZXIubGlzdGVuaW5nXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gSFRUUCBzZXJ2ZXIgd29ya2VyIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgYXN5bmMgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYWN0aXZlOiB0aGlzLmlzQWN0aXZlKCksXG4gICAgICBhY3RpdmVTb2NrZXRDb3VudDogdGhpcy5fYWN0aXZlU29ja2V0cy5zaXplLFxuICAgICAgY2xpZW50Q291bnQ6IE9iamVjdC5rZXlzKHRoaXMuY2xpZW50cykubGVuZ3RoLFxuICAgICAgY29uZmlndXJlZFdvcmtlckNvdW50OiB0aGlzLndvcmtlcnMsXG4gICAgICBlZmZlY3RpdmVXb3JrZXJDb3VudDogdGhpcy5lZmZlY3RpdmVXb3JrZXJzLFxuICAgICAgaW5Qcm9jZXNzOiB0aGlzLmluUHJvY2VzcyxcbiAgICAgIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckhhbmRsZXJzLmxlbmd0aCxcbiAgICAgIHdvcmtlcnM6IGF3YWl0IFByb21pc2UuYWxsKHRoaXMud29ya2VySGFuZGxlcnMubWFwKChoYW5kbGVyKSA9PiB0aGlzLndvcmtlckRlYnVnU25hcHNob3QoaGFuZGxlcikpKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmtlciBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHBhcmFtIHtXb3JrZXJIYW5kbGVyIHwgSW5Qcm9jZXNzSGFuZGxlcn0gd29ya2VySGFuZGxlciAtIFdvcmtlciBoYW5kbGVyIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFdvcmtlciBkZWJ1ZyBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIHdvcmtlckRlYnVnU25hcHNob3Qod29ya2VySGFuZGxlcikge1xuICAgIGlmICh3b3JrZXJIYW5kbGVyIGluc3RhbmNlb2YgV29ya2VySGFuZGxlcikgcmV0dXJuIGF3YWl0IHdvcmtlckhhbmRsZXIuZ2V0RGVidWdTbmFwc2hvdCgpXG4gICAgaWYgKHdvcmtlckhhbmRsZXIgaW5zdGFuY2VvZiBJblByb2Nlc3NIYW5kbGVyKSByZXR1cm4gdGhpcy5pblByb2Nlc3NXb3JrZXJEZWJ1Z1NuYXBzaG90KHdvcmtlckhhbmRsZXIpXG5cbiAgICByZXR1cm4ge2FjdGl2ZTogZmFsc2UsIGVycm9yOiBcIlVua25vd24gd29ya2VyIGhhbmRsZXIgdHlwZVwifVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW4gcHJvY2VzcyB3b3JrZXIgZGVidWcgc25hcHNob3QuXG4gICAqIEBwYXJhbSB7SW5Qcm9jZXNzSGFuZGxlcn0gd29ya2VySGFuZGxlciAtIEluLXByb2Nlc3Mgd29ya2VyIGhhbmRsZXIgdG8gaW5zcGVjdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gV29ya2VyIGRlYnVnIHNuYXBzaG90LlxuICAgKi9cbiAgaW5Qcm9jZXNzV29ya2VyRGVidWdTbmFwc2hvdCh3b3JrZXJIYW5kbGVyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcbiAgICAgIGNsaWVudENvdW50OiBPYmplY3Qua2V5cyh3b3JrZXJIYW5kbGVyLmNsaWVudHMpLmxlbmd0aCxcbiAgICAgIHNuYXBzaG90OiB3b3JrZXJIYW5kbGVyLmNvbmZpZ3VyYXRpb24uZ2V0TG9jYWxEZWJ1Z1NuYXBzaG90KCksXG4gICAgICB3b3JrZXJDb3VudDogd29ya2VySGFuZGxlci53b3JrZXJDb3VudFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AgY2xpZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHN0b3BDbGllbnRzKCkge1xuICAgIGNvbnN0IHByb21pc2VzID0gW11cblxuICAgIGZvciAoY29uc3QgY2xpZW50Q291bnQgaW4gdGhpcy5jbGllbnRzKSB7XG4gICAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHNbY2xpZW50Q291bnRdXG5cbiAgICAgIHByb21pc2VzLnB1c2goY2xpZW50LmVuZCgpKVxuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RvcCBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibmV0XCIpLlNlcnZlciB8IHVuZGVmaW5lZH0gW25ldFNlcnZlcl0gLSBTZXJ2ZXIgdG8gc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIHN0b3BTZXJ2ZXIobmV0U2VydmVyID0gdGhpcy5uZXRTZXJ2ZXIpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgaWYgKCFuZXRTZXJ2ZXIgfHwgIW5ldFNlcnZlci5saXN0ZW5pbmcpIHtcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobmV0U2VydmVyID09PSB0aGlzLm5ldFNlcnZlcikge1xuICAgICAgICAvLyBGb3JjZS1jbG9zZSBsaW5nZXJpbmcgc29ja2V0cyAoZS5nLiBXZWJTb2NrZXQgdXBncmFkZVxuICAgICAgICAvLyBjb25uZWN0aW9ucyBtaWQtY2xvc2UtaGFuZHNoYWtlKSBzbyB0aGUgcG9ydCBpcyByZWxlYXNlZFxuICAgICAgICAvLyBpbW1lZGlhdGVseSBpbnN0ZWFkIG9mIHdhaXRpbmcgZm9yIGdyYWNlZnVsIGRyYWluLlxuICAgICAgICBmb3IgKGNvbnN0IHNvY2tldCBvZiB0aGlzLl9hY3RpdmVTb2NrZXRzKSB7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fYWN0aXZlU29ja2V0cy5jbGVhcigpXG4gICAgICB9XG5cbiAgICAgIG5ldFNlcnZlci5jbG9zZSgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc3RvcCgpIHtcbiAgICB0aGlzLl9zdG9wcGluZyA9IHRydWVcbiAgICBhd2FpdCB0aGlzLmRldmVsb3BtZW50UmVsb2FkZXI/LnN0b3AoKVxuICAgIHRoaXMuZGV2ZWxvcG1lbnRSZWxvYWRlciA9IHVuZGVmaW5lZFxuICAgIGF3YWl0IHRoaXMuc3RvcENsaWVudHMoKVxuICAgIGF3YWl0IHRoaXMuc3RvcFNlcnZlcigpXG5cbiAgICBjb25zdCBzdG9wVGFza3MgPSB0aGlzLndvcmtlckhhbmRsZXJzLm1hcCgoaGFuZGxlcikgPT4gaGFuZGxlci5zdG9wKCkpXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoc3RvcFRhc2tzKVxuICAgIHRoaXMud29ya2VySGFuZGxlcnMgPSBbXVxuICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbk93bmVycy5jbGVhcigpXG4gIH1cblxuICAvKipcbiAgICogT24gY2xvc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uQ2xvc2UgPSAoKSA9PiB7XG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gIH1cblxuICAvKipcbiAgICogT24gc2VydmVyIGVycm9yLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIFNlcnZlciBzb2NrZXQgZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uU2VydmVyRXJyb3IgPSAoZXJyb3IpID0+IHtcbiAgICB0aGlzLmxvZ2dlci5lcnJvcihgVmVsb2Npb3VzIEhUVFAgc2VydmVyIHNvY2tldCBlcnJvciBvbiAke3RoaXMuaG9zdH06JHt0aGlzLnBvcnR9YCwgZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogT24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJuZXRcIikuU29ja2V0fSBzb2NrZXQgLSBTb2NrZXQgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uQ29ubmVjdGlvbiA9IChzb2NrZXQpID0+IHtcbiAgICBjb25zdCBjbGllbnRDb3VudCA9IHRoaXMuY2xpZW50Q291bnRcblxuICAgIHRoaXMuX2FjdGl2ZVNvY2tldHMuYWRkKHNvY2tldClcbiAgICBzb2NrZXQub25jZShcImNsb3NlXCIsICgpID0+IHRoaXMuX2FjdGl2ZVNvY2tldHMuZGVsZXRlKHNvY2tldCkpXG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJOZXcgY2xpZW50XCIsIHtcbiAgICAgIGNsaWVudENvdW50LFxuICAgICAgcmVtb3RlQWRkcmVzczogc29ja2V0LnJlbW90ZUFkZHJlc3MsXG4gICAgICByZW1vdGVGYW1pbHk6IHNvY2tldC5yZW1vdGVGYW1pbHksXG4gICAgICByZW1vdGVQb3J0OiBzb2NrZXQucmVtb3RlUG9ydFxuICAgIH1dKVxuICAgIHRoaXMuY2xpZW50Q291bnQrK1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNsaWVudCA9IG5ldyBTZXJ2ZXJDbGllbnQoe1xuICAgICAgICBjbGllbnRDb3VudCxcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBzb2NrZXRcbiAgICAgIH0pXG5cbiAgICAgIGNsaWVudC5ldmVudHMub24oXCJjbG9zZVwiLCB0aGlzLm9uQ2xpZW50Q2xvc2UpXG4gICAgICB0aGlzLmNsaWVudHNbY2xpZW50Q291bnRdID0gY2xpZW50XG4gICAgICB0aGlzLnJvdXRlQ2xpZW50QWZ0ZXJJbml0aWFsUm91dGluZ0RhdGEoY2xpZW50KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGluaXRpYWxpemUgY2xpZW50ICR7Y2xpZW50Q291bnR9IG9uIG5ldyBjb25uZWN0aW9uYCwgZXJyb3IpXG4gICAgICBzb2NrZXQuZGVzdHJveSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1ZmZlcnMgb25seSB0aGUgYm91bmRlZCBpbml0aWFsIHJlcXVlc3QgZGF0YSBuZWVkZWQgdG8gcmVjb2duaXplIGFcbiAgICogV2ViU29ja2V0IHJlc3VtZSByb3V0aW5nIGhpbnQsIHRoZW4gcmVwbGF5cyBpdCB0byB0aGUgc2VsZWN0ZWQgd29ya2VyLlxuICAgKiBAcGFyYW0ge1NlcnZlckNsaWVudH0gY2xpZW50IC0gVW5hc3NpZ25lZCBzb2NrZXQgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJvdXRlQ2xpZW50QWZ0ZXJJbml0aWFsUm91dGluZ0RhdGEoY2xpZW50KSB7XG4gICAgY29uc3Qge3NvY2tldH0gPSBjbGllbnRcbiAgICAvKiogQHR5cGUge0J1ZmZlcltdfSAqL1xuICAgIGNvbnN0IGNodW5rcyA9IFtdXG4gICAgbGV0IGJ5dGVMZW5ndGggPSAwXG4gICAgY29uc3QgY2xlYW51cCA9ICgpID0+IHtcbiAgICAgIHNvY2tldC5vZmYoXCJkYXRhXCIsIG9uRGF0YSlcbiAgICAgIHNvY2tldC5vZmYoXCJjbG9zZVwiLCBjbGVhbnVwKVxuICAgIH1cbiAgICBjb25zdCBvbkRhdGEgPSAoLyoqIEB0eXBlIHtCdWZmZXJ9ICovIGNodW5rKSA9PiB7XG4gICAgICBjaHVua3MucHVzaChjaHVuaylcbiAgICAgIGJ5dGVMZW5ndGggKz0gY2h1bmsubGVuZ3RoXG4gICAgICBjb25zdCBpbml0aWFsUmVxdWVzdCA9IEJ1ZmZlci5jb25jYXQoY2h1bmtzLCBieXRlTGVuZ3RoKVxuXG4gICAgICBpZiAodGhpcy5pbml0aWFsUmVxdWVzdE5lZWRzTW9yZVJvdXRpbmdEYXRhKGluaXRpYWxSZXF1ZXN0KSAmJiBieXRlTGVuZ3RoIDwgTUFYX0lOSVRJQUxfUkVRVUVTVF9IRUFERVJfQllURVMpIHJldHVyblxuXG4gICAgICBjbGVhbnVwKClcbiAgICAgIHRoaXMuYXNzaWduQ2xpZW50VG9Xb3JrZXIoY2xpZW50LCBpbml0aWFsUmVxdWVzdClcbiAgICB9XG5cbiAgICBzb2NrZXQub24oXCJkYXRhXCIsIG9uRGF0YSlcbiAgICBzb2NrZXQub25jZShcImNsb3NlXCIsIGNsZWFudXApXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgdGhlIGJ1ZmZlcmVkIGluaXRpYWwgSFRUUCBoZWFkZXJzIGFyZSBjb21wbGV0ZS5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGluaXRpYWxSZXF1ZXN0IC0gQnVmZmVyZWQgaW5pdGlhbCByZXF1ZXN0IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGEgaGVhZGVyIHRlcm1pbmF0b3IgaXMgcHJlc2VudC5cbiAgICovXG4gIGluaXRpYWxSZXF1ZXN0SGVhZGVyc0NvbXBsZXRlKGluaXRpYWxSZXF1ZXN0KSB7XG4gICAgcmV0dXJuIGluaXRpYWxSZXF1ZXN0LmluY2x1ZGVzKFwiXFxyXFxuXFxyXFxuXCIpIHx8IGluaXRpYWxSZXF1ZXN0LmluY2x1ZGVzKFwiXFxuXFxuXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBwb3NzaWJsZSByZXN1bWFibGUgV2ViU29ja2V0IHJlcXVlc3Qgc3RpbGwgbmVlZHMgaGVhZGVycy5cbiAgICogT3JkaW5hcnkgYW5kIG1hbGZvcm1lZCByZXF1ZXN0cyBjYW4gcmVhY2ggdGhlIGV4aXN0aW5nIHJlcXVlc3QgcGFyc2VyIGFzXG4gICAqIHNvb24gYXMgdGhlaXIgZmlyc3QgbGluZSBpcyBjb21wbGV0ZS5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGluaXRpYWxSZXF1ZXN0IC0gQnVmZmVyZWQgaW5pdGlhbCByZXF1ZXN0IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIG1vcmUgcm91dGluZyBkYXRhIGlzIHJlcXVpcmVkLlxuICAgKi9cbiAgaW5pdGlhbFJlcXVlc3ROZWVkc01vcmVSb3V0aW5nRGF0YShpbml0aWFsUmVxdWVzdCkge1xuICAgIGlmICh0aGlzLmluaXRpYWxSZXF1ZXN0SGVhZGVyc0NvbXBsZXRlKGluaXRpYWxSZXF1ZXN0KSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBsaW5lRW5kID0gaW5pdGlhbFJlcXVlc3QuaW5kZXhPZihcIlxcblwiKVxuXG4gICAgaWYgKGxpbmVFbmQgPT09IC0xKSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgcmVxdWVzdExpbmUgPSBpbml0aWFsUmVxdWVzdC5zdWJhcnJheSgwLCBsaW5lRW5kKS50b1N0cmluZyhcImxhdGluMVwiKS5yZXBsYWNlKC9cXHIkLywgXCJcIilcbiAgICBjb25zdCByZXF1ZXN0TGluZU1hdGNoID0gcmVxdWVzdExpbmUubWF0Y2goL15HRVQgKFteIF0rKSBIVFRQXFwvW14gXSskLylcblxuICAgIGlmICghcmVxdWVzdExpbmVNYXRjaCkgcmV0dXJuIGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVxdWVzdFVybCA9IG5ldyBVUkwocmVxdWVzdExpbmVNYXRjaFsxXSwgXCJodHRwOi8vdmVsb2Npb3VzLmludmFsaWRcIilcblxuICAgICAgcmV0dXJuIHJlcXVlc3RVcmwuc2VhcmNoUGFyYW1zLmhhcyhXRUJTT0NLRVRfU0VTU0lPTl9ST1VUSU5HX1BBUkFNRVRFUilcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIGEgYnVmZmVyZWQgY2xpZW50IGFuZCByZXBsYXlzIHRoZSBleGFjdCBieXRlcyBpbnRvIGl0cyB3b3JrZXIuXG4gICAqIEBwYXJhbSB7U2VydmVyQ2xpZW50fSBjbGllbnQgLSBDbGllbnQgYXdhaXRpbmcgYXNzaWdubWVudC5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGluaXRpYWxSZXF1ZXN0IC0gSW5pdGlhbCByZXF1ZXN0IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2lnbkNsaWVudFRvV29ya2VyKGNsaWVudCwgaW5pdGlhbFJlcXVlc3QpIHtcbiAgICBpZiAoY2xpZW50LnNvY2tldC5kZXN0cm95ZWQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHdvcmtlckhhbmRsZXIgPSB0aGlzLndvcmtlckhhbmRsZXJGb3JJbml0aWFsUmVxdWVzdChpbml0aWFsUmVxdWVzdClcblxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEdhdmUgY2xpZW50ICR7Y2xpZW50LmNsaWVudENvdW50fSB0byB3b3JrZXIgJHt3b3JrZXJIYW5kbGVyLndvcmtlckNvdW50fWApXG4gICAgICB3b3JrZXJIYW5kbGVyLmFkZFNvY2tldENvbm5lY3Rpb24oY2xpZW50KVxuICAgICAgY2xpZW50Lm9uU29ja2V0RGF0YShpbml0aWFsUmVxdWVzdClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBhc3NpZ24gY2xpZW50ICR7Y2xpZW50LmNsaWVudENvdW50fSB0byBhIHdvcmtlcmAsIGVycm9yKVxuICAgICAgY2xpZW50LmRlc3Ryb3koZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFzc2lnbiBIVFRQIGNsaWVudCB0byB3b3JrZXJcIiwge2NhdXNlOiBlcnJvcn0pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RzIHRoZSBvd25lciBvZiBhIHJlc3VtYWJsZSBXZWJTb2NrZXQgc2Vzc2lvbiBvciB0aGUgbmV4dCBvcmRpbmFyeSB3b3JrZXIuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBpbml0aWFsUmVxdWVzdCAtIEluaXRpYWwgSFRUUCByZXF1ZXN0IGhlYWRlcnMuXG4gICAqIEByZXR1cm5zIHtXb3JrZXJIYW5kbGVyIHwgSW5Qcm9jZXNzSGFuZGxlcn0gLSBTZWxlY3RlZCB3b3JrZXIuXG4gICAqL1xuICB3b3JrZXJIYW5kbGVyRm9ySW5pdGlhbFJlcXVlc3QoaW5pdGlhbFJlcXVlc3QpIHtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSB0aGlzLndlYnNvY2tldFJlc3VtZVNlc3Npb25JZChpbml0aWFsUmVxdWVzdClcblxuICAgIGlmIChzZXNzaW9uSWQpIHtcbiAgICAgIGNvbnN0IG93bmVyID0gdGhpcy53ZWJzb2NrZXRTZXNzaW9uT3duZXJzLmdldChzZXNzaW9uSWQpXG5cbiAgICAgIGlmIChvd25lciAmJiB0aGlzLndvcmtlckhhbmRsZXJzLmluY2x1ZGVzKG93bmVyKSkgcmV0dXJuIG93bmVyXG4gICAgICBpZiAob3duZXIpIHRoaXMud2Vic29ja2V0U2Vzc2lvbk93bmVycy5kZWxldGUoc2Vzc2lvbklkKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLndvcmtlckhhbmRsZXJUb1VzZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIHJlc3VtYWJsZSBXZWJTb2NrZXQgc2Vzc2lvbiByb3V0aW5nIGhpbnQgZnJvbSBhbiB1cGdyYWRlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBpbml0aWFsUmVxdWVzdCAtIEluaXRpYWwgSFRUUCByZXF1ZXN0IGhlYWRlcnMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gU2Vzc2lvbiBpZGVudGl0eSwgaWYgcHJlc2VudCBvbiBhIFdlYlNvY2tldCB1cGdyYWRlLlxuICAgKi9cbiAgd2Vic29ja2V0UmVzdW1lU2Vzc2lvbklkKGluaXRpYWxSZXF1ZXN0KSB7XG4gICAgY29uc3QgaGVhZGVyRW5kID0gaW5pdGlhbFJlcXVlc3QuaW5kZXhPZihcIlxcclxcblxcclxcblwiKVxuICAgIGNvbnN0IGZhbGxiYWNrSGVhZGVyRW5kID0gaGVhZGVyRW5kID09PSAtMSA/IGluaXRpYWxSZXF1ZXN0LmluZGV4T2YoXCJcXG5cXG5cIikgOiBoZWFkZXJFbmRcblxuICAgIGlmIChmYWxsYmFja0hlYWRlckVuZCA9PT0gLTEpIHJldHVyblxuXG4gICAgY29uc3QgbGluZXMgPSBpbml0aWFsUmVxdWVzdC5zdWJhcnJheSgwLCBmYWxsYmFja0hlYWRlckVuZCkudG9TdHJpbmcoXCJsYXRpbjFcIikuc3BsaXQoL1xccj9cXG4vKVxuICAgIGNvbnN0IFttZXRob2QsIHJlcXVlc3RUYXJnZXRdID0gbGluZXNbMF0/LnNwbGl0KFwiIFwiKSB8fCBbXVxuXG4gICAgaWYgKG1ldGhvZCAhPT0gXCJHRVRcIiB8fCAhcmVxdWVzdFRhcmdldCkgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgY29uc3QgaGVhZGVycyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzLnNsaWNlKDEpKSB7XG4gICAgICBjb25zdCBzZXBhcmF0b3JJbmRleCA9IGxpbmUuaW5kZXhPZihcIjpcIilcblxuICAgICAgaWYgKHNlcGFyYXRvckluZGV4ID09PSAtMSkgY29udGludWVcblxuICAgICAgaGVhZGVycy5zZXQobGluZS5zbGljZSgwLCBzZXBhcmF0b3JJbmRleCkudHJpbSgpLnRvTG93ZXJDYXNlKCksIGxpbmUuc2xpY2Uoc2VwYXJhdG9ySW5kZXggKyAxKS50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICB9XG5cbiAgICBpZiAoaGVhZGVycy5nZXQoXCJ1cGdyYWRlXCIpICE9PSBcIndlYnNvY2tldFwiIHx8ICFoZWFkZXJzLmdldChcImNvbm5lY3Rpb25cIik/LnNwbGl0KFwiLFwiKS5tYXAoKHZhbHVlKSA9PiB2YWx1ZS50cmltKCkpLmluY2x1ZGVzKFwidXBncmFkZVwiKSkgcmV0dXJuXG5cbiAgICBjb25zdCBzZXNzaW9uSWQgPSBuZXcgVVJMKHJlcXVlc3RUYXJnZXQsIFwiaHR0cDovL3ZlbG9jaW91cy5pbnZhbGlkXCIpLnNlYXJjaFBhcmFtcy5nZXQoV0VCU09DS0VUX1NFU1NJT05fUk9VVElOR19QQVJBTUVURVIpXG5cbiAgICByZXR1cm4gc2Vzc2lvbklkIHx8IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgdGhlIGxpdmUgd29ya2VyIG93bmVyIGZvciBhIHJlc3VtYWJsZSBzZXNzaW9uLlxuICAgKiBAcGFyYW0ge3tzZXNzaW9uSWQ6IHN0cmluZywgd29ya2VySGFuZGxlcjogV29ya2VySGFuZGxlciB8IEluUHJvY2Vzc0hhbmRsZXJ9fSBhcmdzIC0gT3duZXJzaGlwIGNsYWltLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsYWltV2Vic29ja2V0U2Vzc2lvbih7c2Vzc2lvbklkLCB3b3JrZXJIYW5kbGVyfSkge1xuICAgIGlmICghdGhpcy53b3JrZXJIYW5kbGVycy5pbmNsdWRlcyh3b3JrZXJIYW5kbGVyKSkgcmV0dXJuXG4gICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uT3duZXJzLnNldChzZXNzaW9uSWQsIHdvcmtlckhhbmRsZXIpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBzZXNzaW9uIG9ubHkgd2hlbiB0aGUgcmVsZWFzaW5nIHdvcmtlciBzdGlsbCBvd25zIGl0LlxuICAgKiBAcGFyYW0ge3tzZXNzaW9uSWQ6IHN0cmluZywgd29ya2VySGFuZGxlcjogV29ya2VySGFuZGxlciB8IEluUHJvY2Vzc0hhbmRsZXJ9fSBhcmdzIC0gT3duZXJzaGlwIHJlbGVhc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVsZWFzZVdlYnNvY2tldFNlc3Npb24oe3Nlc3Npb25JZCwgd29ya2VySGFuZGxlcn0pIHtcbiAgICBpZiAodGhpcy53ZWJzb2NrZXRTZXNzaW9uT3duZXJzLmdldChzZXNzaW9uSWQpID09PSB3b3JrZXJIYW5kbGVyKSB0aGlzLndlYnNvY2tldFNlc3Npb25Pd25lcnMuZGVsZXRlKHNlc3Npb25JZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBldmVyeSBzZXNzaW9uIG93bmVkIGJ5IGEgd29ya2VyIGxlYXZpbmcgc2VydmljZS5cbiAgICogQHBhcmFtIHtXb3JrZXJIYW5kbGVyIHwgSW5Qcm9jZXNzSGFuZGxlcn0gd29ya2VySGFuZGxlciAtIFdvcmtlciBsZWF2aW5nIHNlcnZpY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVsZWFzZVdlYnNvY2tldFNlc3Npb25zRm9yV29ya2VyKHdvcmtlckhhbmRsZXIpIHtcbiAgICBmb3IgKGNvbnN0IFtzZXNzaW9uSWQsIG93bmVyXSBvZiB0aGlzLndlYnNvY2tldFNlc3Npb25Pd25lcnMpIHtcbiAgICAgIGlmIChvd25lciA9PT0gd29ya2VySGFuZGxlcikgdGhpcy53ZWJzb2NrZXRTZXNzaW9uT3duZXJzLmRlbGV0ZShzZXNzaW9uSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIGNsaWVudCBjbG9zZS5cbiAgICogQHBhcmFtIHtTZXJ2ZXJDbGllbnR9IGNsaWVudCAtIENsaWVudCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgb25DbGllbnRDbG9zZSA9IChjbGllbnQpID0+IHtcbiAgICBjb25zdCBjbGllbnRDb3VudCA9IGRpZ2coY2xpZW50LCBcImNsaWVudENvdW50XCIpXG4gICAgY29uc3Qgb2xkQ2xpZW50c0xlbmd0aCA9IE9iamVjdC5rZXlzKHRoaXMuY2xpZW50cykubGVuZ3RoXG5cbiAgICBkZWxldGUgdGhpcy5jbGllbnRzW2NsaWVudENvdW50XVxuXG4gICAgY29uc3QgbmV3Q2xpZW50c0xlbmd0aCA9IE9iamVjdC5rZXlzKHRoaXMuY2xpZW50cykubGVuZ3RoXG5cbiAgICBpZiAobmV3Q2xpZW50c0xlbmd0aCAhPSAob2xkQ2xpZW50c0xlbmd0aCAtIDEpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXhwZWN0ZWQgY2xpZW50IHRvIGhhdmUgYmVlbiByZW1vdmVkIGJ1dCBsZW5ndGggZGlkbid0IGNoYW5nZSBmcm9tICR7b2xkQ2xpZW50c0xlbmd0aH0gdG8gJHtvbGRDbGllbnRzTGVuZ3RoIC0gMX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNwYXduIHdvcmtlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNwYXduV29ya2VyKCkge1xuICAgIGNvbnN0IHdvcmtlckhhbmRsZXIgPSBhd2FpdCB0aGlzLl9idWlsZFdvcmtlckhhbmRsZXIoKVxuXG4gICAgdGhpcy53b3JrZXJIYW5kbGVycy5wdXNoKHdvcmtlckhhbmRsZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCB3b3JrZXIgaGFuZGxlcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFdvcmtlckhhbmRsZXIgfCBJblByb2Nlc3NIYW5kbGVyPj59IC0gU3RhcnRlZCB3b3JrZXIgaGFuZGxlcnMuXG4gICAqL1xuICBhc3luYyBfYnVpbGRXb3JrZXJIYW5kbGVycygpIHtcbiAgICAvKipcbiAgICAgKiBXb3JrZXIgaGFuZGxlcnMuXG4gICAgICogQHR5cGUge0FycmF5PFdvcmtlckhhbmRsZXIgfCBJblByb2Nlc3NIYW5kbGVyPn0gKi9cbiAgICBjb25zdCB3b3JrZXJIYW5kbGVycyA9IFtdXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgdGhpcy5lZmZlY3RpdmVXb3JrZXJzOyBpbmRleCArPSAxKSB7XG4gICAgICB3b3JrZXJIYW5kbGVycy5wdXNoKGF3YWl0IHRoaXMuX2J1aWxkV29ya2VySGFuZGxlcigpKVxuICAgIH1cblxuICAgIHJldHVybiB3b3JrZXJIYW5kbGVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgd29ya2VyIGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFdvcmtlckhhbmRsZXIgfCBJblByb2Nlc3NIYW5kbGVyPn0gLSBTdGFydGVkIHdvcmtlciBoYW5kbGVyLlxuICAgKi9cbiAgYXN5bmMgX2J1aWxkV29ya2VySGFuZGxlcigpIHtcbiAgICBjb25zdCB3b3JrZXJDb3VudCA9IHRoaXMud29ya2VyQ291bnRcblxuICAgIHRoaXMud29ya2VyQ291bnQrK1xuXG4gICAgY29uc3QgSGFuZGxlciA9IHRoaXMuaW5Qcm9jZXNzID8gSW5Qcm9jZXNzSGFuZGxlciA6IFdvcmtlckhhbmRsZXJcbiAgICBjb25zdCB3b3JrZXJIYW5kbGVyID0gdGhpcy53b3JrZXJIYW5kbGVyRmFjdG9yeVxuICAgICAgPyB0aGlzLndvcmtlckhhbmRsZXJGYWN0b3J5KHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBvbldlYnNvY2tldFNlc3Npb25Pd25lZDogKHtzZXNzaW9uSWQsIHdvcmtlckhhbmRsZXJ9KSA9PiB0aGlzLmNsYWltV2Vic29ja2V0U2Vzc2lvbih7c2Vzc2lvbklkLCB3b3JrZXJIYW5kbGVyfSksXG4gICAgICAgIG9uV2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkOiAoe3Nlc3Npb25JZCwgd29ya2VySGFuZGxlcn0pID0+IHRoaXMucmVsZWFzZVdlYnNvY2tldFNlc3Npb24oe3Nlc3Npb25JZCwgd29ya2VySGFuZGxlcn0pLFxuICAgICAgICBvbldvcmtlclN0b3BwZWQ6ICh7d29ya2VySGFuZGxlcn0pID0+IHRoaXMucmVsZWFzZVdlYnNvY2tldFNlc3Npb25zRm9yV29ya2VyKHdvcmtlckhhbmRsZXIpLFxuICAgICAgICB3b3JrZXJDb3VudFxuICAgICAgfSlcbiAgICAgIDogbmV3IEhhbmRsZXIoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIG9uV2Vic29ja2V0U2Vzc2lvbk93bmVkOiAoe3Nlc3Npb25JZCwgd29ya2VySGFuZGxlcn0pID0+IHRoaXMuY2xhaW1XZWJzb2NrZXRTZXNzaW9uKHtzZXNzaW9uSWQsIHdvcmtlckhhbmRsZXJ9KSxcbiAgICAgICAgb25XZWJzb2NrZXRTZXNzaW9uUmVsZWFzZWQ6ICh7c2Vzc2lvbklkLCB3b3JrZXJIYW5kbGVyfSkgPT4gdGhpcy5yZWxlYXNlV2Vic29ja2V0U2Vzc2lvbih7c2Vzc2lvbklkLCB3b3JrZXJIYW5kbGVyfSksXG4gICAgICAgIG9uV29ya2VyU3RvcHBlZDogKHt3b3JrZXJIYW5kbGVyfSkgPT4gdGhpcy5yZWxlYXNlV2Vic29ja2V0U2Vzc2lvbnNGb3JXb3JrZXIod29ya2VySGFuZGxlciksXG4gICAgICAgIHdvcmtlckNvdW50XG4gICAgICB9KVxuXG4gICAgYXdhaXQgd29ya2VySGFuZGxlci5zdGFydCgpXG5cbiAgICByZXR1cm4gd29ya2VySGFuZGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29ya2VyIGhhbmRsZXIgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7V29ya2VySGFuZGxlciB8IEluUHJvY2Vzc0hhbmRsZXJ9IC0gVGhlIHdvcmtlciBoYW5kbGVyIHRvIHVzZS5cbiAgICovXG4gIHdvcmtlckhhbmRsZXJUb1VzZSgpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV4dFJvdW5kUm9iaW5Xb3JrZXJIYW5kbGVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgcm91bmQgcm9iaW4gd29ya2VyIGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHtXb3JrZXJIYW5kbGVyIHwgSW5Qcm9jZXNzSGFuZGxlcn0gLSBUaGUgbmV4dCByb3VuZC1yb2JpbiB3b3JrZXIgaGFuZGxlci5cbiAgICovXG4gIF9uZXh0Um91bmRSb2JpbldvcmtlckhhbmRsZXIoKSB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoYFdvcmtlciBoYW5kbGVycyBsZW5ndGg6ICR7dGhpcy53b3JrZXJIYW5kbGVycy5sZW5ndGh9YClcblxuICAgIGNvbnN0IHdvcmtlckhhbmRsZXJJbmRleCA9IHRoaXMubmV4dFdvcmtlckhhbmRsZXJJbmRleCAlIHRoaXMud29ya2VySGFuZGxlcnMubGVuZ3RoXG4gICAgY29uc3Qgd29ya2VySGFuZGxlciA9IHRoaXMud29ya2VySGFuZGxlcnNbd29ya2VySGFuZGxlckluZGV4XVxuXG4gICAgaWYgKCF3b3JrZXJIYW5kbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHdvcmtlckhhbmRsZXIgYnkgdGhhdCBudW1iZXI6ICR7d29ya2VySGFuZGxlckluZGV4fWApXG4gICAgfVxuXG4gICAgdGhpcy5uZXh0V29ya2VySGFuZGxlckluZGV4ICs9IDFcblxuICAgIHJldHVybiB3b3JrZXJIYW5kbGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgdXNlIGRldmVsb3BtZW50IGhvdCByZWxvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGV2ZWxvcG1lbnQgd29ya2VyIGhvdCByZWxvYWQgc2hvdWxkIHJ1bi5cbiAgICovXG4gIHNob3VsZFVzZURldmVsb3BtZW50SG90UmVsb2FkKCkge1xuICAgIHJldHVybiAhdGhpcy5pblByb2Nlc3MgJiYgdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KCkgPT09IFwiZGV2ZWxvcG1lbnRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgZGV2ZWxvcG1lbnQgcmVsb2FkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gd2F0Y2hlciBzZXR1cCBmaW5pc2hlcy5cbiAgICovXG4gIGFzeW5jIF9zdGFydERldmVsb3BtZW50UmVsb2FkZXIoKSB7XG4gICAgaWYgKCF0aGlzLnNob3VsZFVzZURldmVsb3BtZW50SG90UmVsb2FkKCkpIHJldHVyblxuICAgIGlmICh0aGlzLmRldmVsb3BtZW50UmVsb2FkZXIpIHJldHVyblxuXG4gICAgY29uc3QgY3JlYXRlRGV2ZWxvcG1lbnRSZWxvYWRlciA9IHRoaXMuZGV2ZWxvcG1lbnRSZWxvYWRlckZhY3RvcnlcbiAgICAgIHx8ICgoYXJncykgPT4gbmV3IERldmVsb3BtZW50UmVsb2FkZXIoYXJncykpXG5cbiAgICB0aGlzLmRldmVsb3BtZW50UmVsb2FkZXIgPSBjcmVhdGVEZXZlbG9wbWVudFJlbG9hZGVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIG9uUmVsb2FkOiBhc3luYyAoe2NoYW5nZWRQYXRofSkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5pbmZvKGBEZXZlbG9wbWVudCBob3QgcmVsb2FkIGRldGVjdGVkIGNoYW5nZSBpbiAke2NoYW5nZWRQYXRofWApXG4gICAgICAgIGF3YWl0IHRoaXMucmVsb2FkV29ya2Vyc0ZvckRldmVsb3BtZW50KClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5kZXZlbG9wbWVudFJlbG9hZGVyLnN0YXJ0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbG9hZCB3b3JrZXJzIGZvciBkZXZlbG9wbWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB3b3JrZXJzIGhhdmUgYmVlbiByZWZyZXNoZWQuXG4gICAqL1xuICBhc3luYyByZWxvYWRXb3JrZXJzRm9yRGV2ZWxvcG1lbnQoKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwaW5nKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9yZWxvYWRpbmdXb3JrZXJzRm9yRGV2ZWxvcG1lbnQpIHtcbiAgICAgIHRoaXMuX3JlbG9hZFdvcmtlcnNGb3JEZXZlbG9wbWVudFF1ZXVlZCA9IHRydWVcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3JlbG9hZGluZ1dvcmtlcnNGb3JEZXZlbG9wbWVudCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBkbyB7XG4gICAgICAgIHRoaXMuX3JlbG9hZFdvcmtlcnNGb3JEZXZlbG9wbWVudFF1ZXVlZCA9IGZhbHNlXG5cbiAgICAgICAgY29uc3Qgb2xkV29ya2VySGFuZGxlcnMgPSBbLi4udGhpcy53b3JrZXJIYW5kbGVyc11cbiAgICAgICAgY29uc3QgbmV3V29ya2VySGFuZGxlcnMgPSBhd2FpdCB0aGlzLl9idWlsZFdvcmtlckhhbmRsZXJzKClcblxuICAgICAgICB0aGlzLndvcmtlckhhbmRsZXJzID0gbmV3V29ya2VySGFuZGxlcnNcbiAgICAgICAgdGhpcy5uZXh0V29ya2VySGFuZGxlckluZGV4ID0gMFxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlckhhbmRsZXIgb2Ygb2xkV29ya2VySGFuZGxlcnMpIHRoaXMucmVsZWFzZVdlYnNvY2tldFNlc3Npb25zRm9yV29ya2VyKHdvcmtlckhhbmRsZXIpXG5cbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwob2xkV29ya2VySGFuZGxlcnMubWFwKCh3b3JrZXJIYW5kbGVyKSA9PiB3b3JrZXJIYW5kbGVyLnN0b3AoKSkpXG4gICAgICB9IHdoaWxlICh0aGlzLl9yZWxvYWRXb3JrZXJzRm9yRGV2ZWxvcG1lbnRRdWV1ZWQgJiYgIXRoaXMuX3N0b3BwaW5nKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWxvYWRpbmdXb3JrZXJzRm9yRGV2ZWxvcG1lbnQgPSBmYWxzZVxuICAgIH1cbiAgfVxufVxuIl19