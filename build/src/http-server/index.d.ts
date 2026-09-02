import DevelopmentReloader from "./development-reloader.js";
import InProcessHandler from "./worker-handler/in-process.js";
import Logger from "../logger.js";
import ServerClient from "./server-client.js";
import WorkerHandler from "./worker-handler/index.js";
export type DevelopmentReloaderLike = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
};
export type WorkerHandlerFactory = (args: {
    configuration: import("../configuration.js").default;
    onWebsocketSessionOwned: (args: {
        sessionId: string;
        workerHandler: WorkerHandler;
    }) => void;
    onWebsocketSessionReleased: (args: {
        sessionId: string;
        workerHandler: WorkerHandler;
    }) => void;
    onWorkerStopped: (args: {
        workerHandler: WorkerHandler;
    }) => void;
    workerCount: number;
}) => (WorkerHandler | InProcessHandler);
export default class VelociousHttpServer {
    configuration: import("../configuration.js").default;
    developmentReloaderFactory: ((args: {
        configuration: import("../configuration.js").default;
        onReload: (args: {
            changedPath: string;
        }) => Promise<void>;
    }) => {
        start: () => Promise<void>;
        stop: () => Promise<void>;
    }) | undefined;
    inProcess: boolean;
    logger: Logger;
    host: string;
    port: number;
    workers: number;
    effectiveWorkers: number;
    _stopping: boolean | undefined;
    _reloadWorkersForDevelopmentQueued: boolean | undefined;
    _reloadingWorkersForDevelopment: boolean | undefined;
    clientCount: number;
    _starting: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {DevelopmentReloader | DevelopmentReloaderLike | undefined} */
    developmentReloader: DevelopmentReloader | DevelopmentReloaderLike | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("net").Server | undefined} */
    netServer: import("net").Server | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {WorkerHandlerFactory | undefined} */
    workerHandlerFactory: WorkerHandlerFactory | undefined;
    /**
     * Clients.
     * @type {Record<string, ServerClient>}  */
    clients: Record<string, ServerClient>;
    /**
     * Active sockets.
     * @type {Set<import("net").Socket>} */
    _activeSockets: Set<import("net").Socket>;
    events: import("eventemitter3").EventEmitter<string | symbol, any>;
    workerCount: number;
    /**
     * Worker handlers.
     * @type {Array<WorkerHandler | InProcessHandler>} */
    workerHandlers: Array<WorkerHandler | InProcessHandler>;
    nextWorkerHandlerIndex: number;
    /** Worker ownership for live or grace-paused resumable WebSocket sessions. */
    websocketSessionOwners: Map<any, any>;
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
    constructor({ availableParallelism, configuration, developmentReloaderFactory, host, inProcess, maxWorkers, port, workerHandlerFactory, workers }: {
        configuration: import("../configuration.js").default;
        host?: string;
        inProcess?: boolean;
        port?: number;
        maxWorkers?: number;
        workers?: number;
        availableParallelism?: () => number;
        developmentReloaderFactory?: (args: {
            configuration: import("../configuration.js").default;
            onReload: (args: {
                changedPath: string;
            }) => Promise<void>;
        }) => {
            start: () => Promise<void>;
            stop: () => Promise<void>;
        };
        workerHandlerFactory?: WorkerHandlerFactory;
    });
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when complete.
     */
    start(): Promise<void>;
    /**
     * Runs capture startup state.
     * @returns {{developmentReloader: DevelopmentReloader | DevelopmentReloaderLike | undefined, netServer: import("net").Server | undefined, workerHandlers: Array<WorkerHandler | InProcessHandler>}} - Startup state.
     */
    _captureStartupState(): {
        developmentReloader: DevelopmentReloader | DevelopmentReloaderLike | undefined;
        netServer: import("net").Server | undefined;
        workerHandlers: Array<WorkerHandler | InProcessHandler>;
    };
    /**
     * Runs stop startup resources.
     * @param {ReturnType<VelociousHttpServer["_captureStartupState"]>} startupState - State captured before startup.
     * @returns {Promise<void>} - Resolves when cleanup is complete.
     */
    _stopStartupResources(startupState: ReturnType<VelociousHttpServer["_captureStartupState"]>): Promise<void>;
    /**
     * Runs net server listen.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _netServerListen(): Promise<void>;
    /**
     * Runs ensure workers.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _ensureWorkers(): Promise<void>;
    /**
     * Runs is active.
     * @returns {boolean} - Whether active.
     */
    isActive(): boolean;
    /**
     * Runs get debug snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - HTTP server worker diagnostics.
     */
    getDebugSnapshot(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs worker debug snapshot.
     * @param {WorkerHandler | InProcessHandler} workerHandler - Worker handler to inspect.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Worker debug snapshot.
     */
    workerDebugSnapshot(workerHandler: WorkerHandler | InProcessHandler): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs in process worker debug snapshot.
     * @param {InProcessHandler} workerHandler - In-process worker handler to inspect.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Worker debug snapshot.
     */
    inProcessWorkerDebugSnapshot(workerHandler: InProcessHandler): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs stop clients.
     * @returns {Promise<void>} - Resolves when complete.
     */
    stopClients(): Promise<void>;
    /**
     * Runs stop server.
     * @param {import("net").Server | undefined} [netServer] - Server to stop.
     * @returns {Promise<void>} - Resolves when complete.
     */
    stopServer(netServer?: import("net").Server | undefined): Promise<void>;
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when complete.
     */
    stop(): Promise<void>;
    /**
     * On close.
     * @returns {void} - No return value.
     */
    onClose: () => void;
    /**
     * On server error.
     * @param {Error} error - Server socket error.
     * @returns {void} - No return value.
     */
    onServerError: (error: Error) => void;
    /**
     * On connection.
     * @param {import("net").Socket} socket - Socket instance.
     * @returns {void} - No return value.
     */
    onConnection: (socket: import("net").Socket) => void;
    /**
     * Buffers only the bounded initial request data needed to recognize a
     * WebSocket resume routing hint, then replays it to the selected worker.
     * @param {ServerClient} client - Unassigned socket client.
     * @returns {void}
     */
    routeClientAfterInitialRoutingData(client: ServerClient): void;
    /**
     * Checks whether the buffered initial HTTP headers are complete.
     * @param {Buffer} initialRequest - Buffered initial request bytes.
     * @returns {boolean} - Whether a header terminator is present.
     */
    initialRequestHeadersComplete(initialRequest: Buffer): boolean;
    /**
     * Checks whether a possible resumable WebSocket request still needs headers.
     * Ordinary and malformed requests can reach the existing request parser as
     * soon as their first line is complete.
     * @param {Buffer} initialRequest - Buffered initial request bytes.
     * @returns {boolean} - Whether more routing data is required.
     */
    initialRequestNeedsMoreRoutingData(initialRequest: Buffer): boolean;
    /**
     * Assigns a buffered client and replays the exact bytes into its worker.
     * @param {ServerClient} client - Client awaiting assignment.
     * @param {Buffer} initialRequest - Initial request bytes.
     * @returns {void}
     */
    assignClientToWorker(client: ServerClient, initialRequest: Buffer): void;
    /**
     * Selects the owner of a resumable WebSocket session or the next ordinary worker.
     * @param {Buffer} initialRequest - Initial HTTP request headers.
     * @returns {WorkerHandler | InProcessHandler} - Selected worker.
     */
    workerHandlerForInitialRequest(initialRequest: Buffer): WorkerHandler | InProcessHandler;
    /**
     * Reads the resumable WebSocket session routing hint from an upgrade request.
     * @param {Buffer} initialRequest - Initial HTTP request headers.
     * @returns {string | undefined} - Session identity, if present on a WebSocket upgrade.
     */
    websocketResumeSessionId(initialRequest: Buffer): string | undefined;
    /**
     * Records the live worker owner for a resumable session.
     * @param {{sessionId: string, workerHandler: WorkerHandler | InProcessHandler}} args - Ownership claim.
     * @returns {void}
     */
    claimWebsocketSession({ sessionId, workerHandler }: {
        sessionId: string;
        workerHandler: WorkerHandler | InProcessHandler;
    }): void;
    /**
     * Releases a session only when the releasing worker still owns it.
     * @param {{sessionId: string, workerHandler: WorkerHandler | InProcessHandler}} args - Ownership release.
     * @returns {void}
     */
    releaseWebsocketSession({ sessionId, workerHandler }: {
        sessionId: string;
        workerHandler: WorkerHandler | InProcessHandler;
    }): void;
    /**
     * Releases every session owned by a worker leaving service.
     * @param {WorkerHandler | InProcessHandler} workerHandler - Worker leaving service.
     * @returns {void}
     */
    releaseWebsocketSessionsForWorker(workerHandler: WorkerHandler | InProcessHandler): void;
    /**
     * On client close.
     * @param {ServerClient} client - Client instance.
     * @returns {void} - No return value.
     */
    onClientClose: (client: ServerClient) => void;
    /**
     * Runs spawn worker.
     * @returns {Promise<void>} - Resolves when complete.
     */
    spawnWorker(): Promise<void>;
    /**
     * Runs build worker handlers.
     * @returns {Promise<Array<WorkerHandler | InProcessHandler>>} - Started worker handlers.
     */
    _buildWorkerHandlers(): Promise<Array<WorkerHandler | InProcessHandler>>;
    /**
     * Runs build worker handler.
     * @returns {Promise<WorkerHandler | InProcessHandler>} - Started worker handler.
     */
    _buildWorkerHandler(): Promise<WorkerHandler | InProcessHandler>;
    /**
     * Runs worker handler to use.
     * @returns {WorkerHandler | InProcessHandler} - The worker handler to use.
     */
    workerHandlerToUse(): WorkerHandler | InProcessHandler;
    /**
     * Runs next round robin worker handler.
     * @returns {WorkerHandler | InProcessHandler} - The next round-robin worker handler.
     */
    _nextRoundRobinWorkerHandler(): WorkerHandler | InProcessHandler;
    /**
     * Runs should use development hot reload.
     * @returns {boolean} - Whether development worker hot reload should run.
     */
    shouldUseDevelopmentHotReload(): boolean;
    /**
     * Runs start development reloader.
     * @returns {Promise<void>} - Resolves when watcher setup finishes.
     */
    _startDevelopmentReloader(): Promise<void>;
    /**
     * Runs reload workers for development.
     * @returns {Promise<void>} - Resolves when workers have been refreshed.
     */
    reloadWorkersForDevelopment(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map