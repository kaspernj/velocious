import Logger from "./logger.js";
import HttpServer from "./http-server/index.js";
import HttpServerLock from "./http-server/server-lock.js";
export type HttpServerConfiguration = import("./configuration-types.js").HttpServerConfiguration;
/**
 * HttpServerConfiguration type.
 * @typedef {import("./configuration-types.js").HttpServerConfiguration} HttpServerConfiguration */
export default class VelociousApplication {
    configuration: import("./configuration.js").default;
    /**
     * Stores the http server configuration value.
     * @type {HttpServerConfiguration} */
    httpServerConfiguration: HttpServerConfiguration;
    logger: Logger;
    _type: string;
    /**
     * Stores the http server lock value.
     * @type {HttpServerLock | undefined} */
    httpServerLock: HttpServerLock | undefined;
    /** @type {Promise<void> | undefined} */
    _stopPromise: Promise<void> | undefined;
    httpServer: HttpServer | undefined;
    waitResolve: ((value: void | PromiseLike<void>) => void) | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {HttpServerConfiguration} [args.httpServer] - Http server.
     * @param {string} args.type - Type identifier.
     */
    constructor({ configuration, httpServer, type, ...restArgs }: {
        configuration: import("./configuration.js").default;
        httpServer?: HttpServerConfiguration;
        type: string;
    });
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType(): string;
    /**
     * Runs initialize.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initialize(): Promise<void>;
    /**
     * Runs is active.
     * @returns {boolean} - Whether active.
     */
    isActive(): boolean;
    /**
     * Runs run.
     * @param {() => void} callback - Callback function.
     * @returns {Promise<void>} - Resolves when complete.
     */
    run(callback: () => void): Promise<void>;
    /**
     * Runs start http server.
     * @returns {Promise<void>} - Resolves when complete.
     */
    startHttpServer(): Promise<void>;
    /**
     * Runs start locked http server.
     * @param {object} args - HTTP server startup arguments.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {string} [args.host] - HTTP server host.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.httpServerConfiguration - Merged HTTP server configuration.
     * @param {number} args.port - HTTP server port.
     * @returns {Promise<void>} - Resolves after the HTTP server has started.
     */
    startLockedHttpServer({ configuration, host, httpServerConfiguration, port }: {
        configuration: import("./configuration.js").default;
        host?: string;
        httpServerConfiguration: Record<string, ReturnType<typeof JSON.parse>>;
        port: number;
    }): Promise<void>;
    /**
     * Runs acquire http server lock.
     * @param {object} args - Lock acquisition arguments.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.host - HTTP server host.
     * @param {number} args.port - HTTP server port.
     * @returns {Promise<void>} - Resolves after acquiring the server lock when needed.
     */
    acquireHttpServerLock({ configuration, host, port }: {
        configuration: import("./configuration.js").default;
        host: string;
        port: number;
    }): Promise<void>;
    /**
     * Runs create http server.
     * @param {object} args - HTTP server arguments.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {string} [args.host] - Host.
     * @param {boolean} [args.inProcess] - Run HTTP handlers in the main thread.
     * @param {number} [args.maxWorkers] - Max workers.
     * @param {number} args.port - Port.
     * @param {number} [args.workers] - Worker count.
     * @returns {HttpServer} - HTTP server instance.
     */
    createHttpServer({ configuration, host, inProcess, maxWorkers, port, workers }: {
        configuration: import("./configuration.js").default;
        host?: string;
        inProcess?: boolean;
        maxWorkers?: number;
        port: number;
        workers?: number;
    }): HttpServer;
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when complete.
     */
    stop(): Promise<void>;
    /**
     * Stops application and framework resources.
     * @returns {Promise<void>} - Resolves after every application and framework close succeeds.
     */
    _stop(): Promise<void>;
    /**
     * Runs release http server lock.
     * @returns {Promise<void>} - Resolves after the HTTP server lock has been released.
     */
    releaseHttpServerLock(): Promise<void>;
    /**
     * On http server close.
     * @returns {void} - No return value.
     */
    onHttpServerClose: () => void;
    /**
     * Runs wait.
     * @returns {Promise<void>} - Resolves when complete.
     */
    wait(): Promise<void>;
}
//# sourceMappingURL=application.d.ts.map