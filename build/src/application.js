// @ts-check
import AppRoutes from "./routes/app-routes.js";
import Logger from "./logger.js";
import HttpServer from "./http-server/index.js";
import HttpServerLock from "./http-server/server-lock.js";
import SyncApiController from "./sync/sync-api-controller.js";
import SyncPublisher from "./sync/sync-publisher.js";
import SyncWebsocketChannel from "./sync/sync-websocket-channel.js";
import websocketEventsHost from "./http-server/websocket-events-host.js";
import restArgsError from "./utils/rest-args-error.js";
import { runShutdownSteps } from "./utils/shutdown-lifecycle.js";
/**
 * HttpServerConfiguration type.
 * @typedef {import("./configuration-types.js").HttpServerConfiguration} HttpServerConfiguration */
export default class VelociousApplication {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {HttpServerConfiguration} [args.httpServer] - Http server.
     * @param {string} args.type - Type identifier.
     */
    constructor({ configuration, httpServer, type, ...restArgs }) {
        restArgsError(restArgs);
        if (!configuration)
            throw new Error("configuration is required");
        this.configuration = configuration;
        /**
         * Stores the http server configuration value.
         * @type {HttpServerConfiguration} */
        this.httpServerConfiguration = httpServer ?? {};
        this.logger = new Logger(this);
        this._type = type;
        /**
         * Stores the http server lock value.
         * @type {HttpServerLock | undefined} */
        this.httpServerLock = undefined;
        /** @type {Promise<void> | undefined} */
        this._stopPromise = undefined;
    }
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType() { return this._type; }
    /**
     * Runs initialize.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initialize() {
        const routes = await AppRoutes.getRoutes(this.configuration);
        await this.configuration.initialize({ type: this.getType() });
        SyncApiController.mountFromConfiguration(this.configuration);
        SyncWebsocketChannel.registerFromConfiguration(this.configuration);
        await SyncPublisher.startFromConfiguration(this.configuration);
        this.configuration.setRoutes(routes);
        if (!this.configuration.isDatabasePoolInitialized()) {
            await this.configuration.initializeDatabasePool();
        }
    }
    /**
     * Runs is active.
     * @returns {boolean} - Whether active.
     */
    isActive() {
        if (this.httpServer) {
            return this.httpServer?.isActive();
        }
        return false;
    }
    /**
     * Runs run.
     * @param {() => void} callback - Callback function.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async run(callback) {
        await this.startHttpServer();
        try {
            await callback();
        }
        finally {
            await this.stop();
        }
    }
    /**
     * Runs start http server.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async startHttpServer() {
        const { configuration } = this;
        const httpServerConfiguration = {
            ...configuration.httpServer,
            ...this.httpServerConfiguration
        };
        const port = httpServerConfiguration.port ?? 3006;
        const host = httpServerConfiguration.host;
        await this.logger.debug(`Starting server on port ${port}`);
        await this.acquireHttpServerLock({ configuration, host: host ?? "0.0.0.0", port });
        await this.startLockedHttpServer({ configuration, host, httpServerConfiguration, port });
    }
    /**
     * Runs start locked http server.
     * @param {object} args - HTTP server startup arguments.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {string} [args.host] - HTTP server host.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.httpServerConfiguration - Merged HTTP server configuration.
     * @param {number} args.port - HTTP server port.
     * @returns {Promise<void>} - Resolves after the HTTP server has started.
     */
    async startLockedHttpServer({ configuration, host, httpServerConfiguration, port }) {
        try {
            if (!configuration.getWebsocketEvents()) {
                configuration.setWebsocketEvents(/** @type {ReturnType<typeof JSON.parse>} */ (websocketEventsHost));
            }
            await configuration.connectBeacon({ peerType: "server" });
            this.httpServer = this.createHttpServer({
                configuration,
                host,
                inProcess: httpServerConfiguration.inProcess,
                maxWorkers: httpServerConfiguration.maxWorkers,
                port,
                workers: httpServerConfiguration.workers
            });
            this.httpServer.events.on("close", this.onHttpServerClose);
            configuration._httpServerInstance = this.httpServer;
            await this.httpServer.start();
        }
        catch (error) {
            await this.releaseHttpServerLock();
            configuration._httpServerInstance = undefined;
            throw error;
        }
    }
    /**
     * Runs acquire http server lock.
     * @param {object} args - Lock acquisition arguments.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.host - HTTP server host.
     * @param {number} args.port - HTTP server port.
     * @returns {Promise<void>} - Resolves after acquiring the server lock when needed.
     */
    async acquireHttpServerLock({ configuration, host, port }) {
        if (this.getType() === "test-runner")
            return;
        const httpServerLock = new HttpServerLock({ configuration, host, port });
        await httpServerLock.acquire();
        this.httpServerLock = httpServerLock;
    }
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
    createHttpServer({ configuration, host, inProcess, maxWorkers, port, workers }) {
        return new HttpServer({ configuration, host, inProcess, maxWorkers, port, workers });
    }
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when complete.
     */
    stop() {
        if (!this._stopPromise)
            this._stopPromise = this._stop();
        return this._stopPromise;
    }
    /**
     * Stops application and framework resources.
     * @returns {Promise<void>} - Resolves after every application and framework close succeeds.
     */
    async _stop() {
        await runShutdownSteps({
            message: "Application and framework shutdown failed",
            steps: [
                async () => await this.logger.debug("Stopping server"),
                async () => {
                    try {
                        await this.httpServer?.stop();
                    }
                    finally {
                        this.configuration._httpServerInstance = undefined;
                    }
                },
                async () => await this.configuration.shutdown(),
                async () => await this.configuration.disconnectBeacon(),
                async () => await this.configuration.closeDatabaseConnections(),
                async () => await this.releaseHttpServerLock()
            ]
        });
    }
    /**
     * Runs release http server lock.
     * @returns {Promise<void>} - Resolves after the HTTP server lock has been released.
     */
    async releaseHttpServerLock() {
        const { httpServerLock } = this;
        this.httpServerLock = undefined;
        if (httpServerLock)
            await httpServerLock.release();
    }
    /**
     * On http server close.
     * @returns {void} - No return value.
     */
    onHttpServerClose = () => {
        this.logger.debug("HTTP server closed");
        if (this.waitResolve) {
            this.waitResolve();
        }
    };
    /**
     * Runs wait.
     * @returns {Promise<void>} - Resolves when complete.
     */
    wait() {
        return new Promise((resolve) => {
            this.waitResolve = resolve;
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sTUFBTSxNQUFNLGFBQWEsQ0FBQTtBQUNoQyxPQUFPLFVBQVUsTUFBTSx3QkFBd0IsQ0FBQTtBQUMvQyxPQUFPLGNBQWMsTUFBTSw4QkFBOEIsQ0FBQTtBQUN6RCxPQUFPLGlCQUFpQixNQUFNLCtCQUErQixDQUFBO0FBQzdELE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sb0JBQW9CLE1BQU0sa0NBQWtDLENBQUE7QUFDbkUsT0FBTyxtQkFBbUIsTUFBTSx3Q0FBd0MsQ0FBQTtBQUN4RSxPQUFPLGFBQWEsTUFBTSw0QkFBNEIsQ0FBQTtBQUN0RCxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQTtBQUVoRTs7bUdBRW1HO0FBRW5HLE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0JBQW9CO0lBQ3ZDOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBRSxHQUFHLFFBQVEsRUFBQztRQUN4RCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUE7UUFFaEUsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFFbEM7OzZDQUVxQztRQUNyQyxJQUFJLENBQUMsdUJBQXVCLEdBQUcsVUFBVSxJQUFJLEVBQUUsQ0FBQTtRQUUvQyxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzlCLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFBO1FBQ2pCOztnREFFd0M7UUFDeEMsSUFB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QUFDLHFCQUFxQixFQUFFO2FBQy9DO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxxQkFBcUI7UUFDekIsTUFBTSxFQUFDLGNBQWMsRUFBQyxHQUFHLElBQUksQ0FBQTtRQUU3QixJQUFJLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQTtRQUMvQixJQUFJLGNBQWM7WUFBRSxNQUFNLGNBQWMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUNwRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsaUJBQWlCLEdBQUcsR0FBRyxFQUFFO1FBQ3ZCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFFdkMsSUFBSSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDckIsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQ3BCLENBQUM7SUFDSCxDQUFDLENBQUE7SUFFRDs7O09BR0c7SUFDSCxJQUFJO1FBQ0YsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQzdCLElBQUksQ0FBQyxXQUFXLEdBQUcsT0FBTyxDQUFBO1FBQzVCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBcHBSb3V0ZXMgZnJvbSBcIi4vcm91dGVzL2FwcC1yb3V0ZXMuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi9sb2dnZXIuanNcIlxuaW1wb3J0IEh0dHBTZXJ2ZXIgZnJvbSBcIi4vaHR0cC1zZXJ2ZXIvaW5kZXguanNcIlxuaW1wb3J0IEh0dHBTZXJ2ZXJMb2NrIGZyb20gXCIuL2h0dHAtc2VydmVyL3NlcnZlci1sb2NrLmpzXCJcbmltcG9ydCBTeW5jQXBpQ29udHJvbGxlciBmcm9tIFwiLi9zeW5jL3N5bmMtYXBpLWNvbnRyb2xsZXIuanNcIlxuaW1wb3J0IFN5bmNQdWJsaXNoZXIgZnJvbSBcIi4vc3luYy9zeW5jLXB1Ymxpc2hlci5qc1wiXG5pbXBvcnQgU3luY1dlYnNvY2tldENoYW5uZWwgZnJvbSBcIi4vc3luYy9zeW5jLXdlYnNvY2tldC1jaGFubmVsLmpzXCJcbmltcG9ydCB3ZWJzb2NrZXRFdmVudHNIb3N0IGZyb20gXCIuL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMtaG9zdC5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5cbi8qKlxuICogSHR0cFNlcnZlckNvbmZpZ3VyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuSHR0cFNlcnZlckNvbmZpZ3VyYXRpb259IEh0dHBTZXJ2ZXJDb25maWd1cmF0aW9uICovXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0FwcGxpY2F0aW9uIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7SHR0cFNlcnZlckNvbmZpZ3VyYXRpb259IFthcmdzLmh0dHBTZXJ2ZXJdIC0gSHR0cCBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaHR0cFNlcnZlciwgdHlwZSwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuXG4gICAgLyoqXG4gICAgICogU3RvcmVzIHRoZSBodHRwIHNlcnZlciBjb25maWd1cmF0aW9uIHZhbHVlLlxuICAgICAqIEB0eXBlIHtIdHRwU2VydmVyQ29uZmlndXJhdGlvbn0gKi9cbiAgICB0aGlzLmh0dHBTZXJ2ZXJDb25maWd1cmF0aW9uID0gaHR0cFNlcnZlciA/PyB7fVxuXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5fdHlwZSA9IHR5cGVcbiAgICAvKipcbiAgICAgKiBTdG9yZXMgdGhlIGh0dHAgc2VydmVyIGxvY2sgdmFsdWUuXG4gICAgICogQHR5cGUge0h0dHBTZXJ2ZXJMb2NrIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuaHR0cFNlcnZlckxvY2sgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIHRoaXMuX3R5cGUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgIGNvbnN0IHJvdXRlcyA9IGF3YWl0IEFwcFJvdXRlcy5nZXRSb3V0ZXModGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmluaXRpYWxpemUoe3R5cGU6IHRoaXMuZ2V0VHlwZSgpfSlcblxuICAgIFN5bmNBcGlDb250cm9sbGVyLm1vdW50RnJvbUNvbmZpZ3VyYXRpb24odGhpcy5jb25maWd1cmF0aW9uKVxuICAgIFN5bmNXZWJzb2NrZXRDaGFubmVsLnJlZ2lzdGVyRnJvbUNvbmZpZ3VyYXRpb24odGhpcy5jb25maWd1cmF0aW9uKVxuICAgIGF3YWl0IFN5bmNQdWJsaXNoZXIuc3RhcnRGcm9tQ29uZmlndXJhdGlvbih0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Um91dGVzKHJvdXRlcylcblxuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uLmlzRGF0YWJhc2VQb29sSW5pdGlhbGl6ZWQoKSkge1xuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmluaXRpYWxpemVEYXRhYmFzZVBvb2woKVxuICAgIH1cblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgYWN0aXZlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFjdGl2ZS5cbiAgICovXG4gIGlzQWN0aXZlKCkge1xuICAgIGlmICh0aGlzLmh0dHBTZXJ2ZXIpIHtcbiAgICAgIHJldHVybiB0aGlzLmh0dHBTZXJ2ZXI/LmlzQWN0aXZlKClcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1bi5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuKGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5zdGFydEh0dHBTZXJ2ZXIoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBodHRwIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHN0YXJ0SHR0cFNlcnZlcigpIHtcbiAgICBjb25zdCB7Y29uZmlndXJhdGlvbn0gPSB0aGlzXG4gICAgY29uc3QgaHR0cFNlcnZlckNvbmZpZ3VyYXRpb24gPSB7XG4gICAgICAuLi5jb25maWd1cmF0aW9uLmh0dHBTZXJ2ZXIsXG4gICAgICAuLi50aGlzLmh0dHBTZXJ2ZXJDb25maWd1cmF0aW9uXG4gICAgfVxuICAgIGNvbnN0IHBvcnQgPSBodHRwU2VydmVyQ29uZmlndXJhdGlvbi5wb3J0ID8/IDMwMDZcbiAgICBjb25zdCBob3N0ID0gaHR0cFNlcnZlckNvbmZpZ3VyYXRpb24uaG9zdFxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuZGVidWcoYFN0YXJ0aW5nIHNlcnZlciBvbiBwb3J0ICR7cG9ydH1gKVxuICAgIGF3YWl0IHRoaXMuYWNxdWlyZUh0dHBTZXJ2ZXJMb2NrKHtjb25maWd1cmF0aW9uLCBob3N0OiBob3N0ID8/IFwiMC4wLjAuMFwiLCBwb3J0fSlcbiAgICBhd2FpdCB0aGlzLnN0YXJ0TG9ja2VkSHR0cFNlcnZlcih7Y29uZmlndXJhdGlvbiwgaG9zdCwgaHR0cFNlcnZlckNvbmZpZ3VyYXRpb24sIHBvcnR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgbG9ja2VkIGh0dHAgc2VydmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEhUVFAgc2VydmVyIHN0YXJ0dXAgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaG9zdF0gLSBIVFRQIHNlcnZlciBob3N0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5odHRwU2VydmVyQ29uZmlndXJhdGlvbiAtIE1lcmdlZCBIVFRQIHNlcnZlciBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5wb3J0IC0gSFRUUCBzZXJ2ZXIgcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIEhUVFAgc2VydmVyIGhhcyBzdGFydGVkLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRMb2NrZWRIdHRwU2VydmVyKHtjb25maWd1cmF0aW9uLCBob3N0LCBodHRwU2VydmVyQ29uZmlndXJhdGlvbiwgcG9ydH0pIHtcbiAgICB0cnkge1xuICAgICAgaWYgKCFjb25maWd1cmF0aW9uLmdldFdlYnNvY2tldEV2ZW50cygpKSB7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24uc2V0V2Vic29ja2V0RXZlbnRzKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh3ZWJzb2NrZXRFdmVudHNIb3N0KSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJzZXJ2ZXJcIn0pXG5cbiAgICAgIHRoaXMuaHR0cFNlcnZlciA9IHRoaXMuY3JlYXRlSHR0cFNlcnZlcih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGhvc3QsXG4gICAgICAgIGluUHJvY2VzczogaHR0cFNlcnZlckNvbmZpZ3VyYXRpb24uaW5Qcm9jZXNzLFxuICAgICAgICBtYXhXb3JrZXJzOiBodHRwU2VydmVyQ29uZmlndXJhdGlvbi5tYXhXb3JrZXJzLFxuICAgICAgICBwb3J0LFxuICAgICAgICB3b3JrZXJzOiBodHRwU2VydmVyQ29uZmlndXJhdGlvbi53b3JrZXJzXG4gICAgICB9KVxuICAgICAgdGhpcy5odHRwU2VydmVyLmV2ZW50cy5vbihcImNsb3NlXCIsIHRoaXMub25IdHRwU2VydmVyQ2xvc2UpXG4gICAgICBjb25maWd1cmF0aW9uLl9odHRwU2VydmVySW5zdGFuY2UgPSB0aGlzLmh0dHBTZXJ2ZXJcblxuICAgICAgYXdhaXQgdGhpcy5odHRwU2VydmVyLnN0YXJ0KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgdGhpcy5yZWxlYXNlSHR0cFNlcnZlckxvY2soKVxuICAgICAgY29uZmlndXJhdGlvbi5faHR0cFNlcnZlckluc3RhbmNlID0gdW5kZWZpbmVkXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNxdWlyZSBodHRwIHNlcnZlciBsb2NrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExvY2sgYWNxdWlzaXRpb24gYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5ob3N0IC0gSFRUUCBzZXJ2ZXIgaG9zdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucG9ydCAtIEhUVFAgc2VydmVyIHBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFjcXVpcmluZyB0aGUgc2VydmVyIGxvY2sgd2hlbiBuZWVkZWQuXG4gICAqL1xuICBhc3luYyBhY3F1aXJlSHR0cFNlcnZlckxvY2soe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnR9KSB7XG4gICAgaWYgKHRoaXMuZ2V0VHlwZSgpID09PSBcInRlc3QtcnVubmVyXCIpIHJldHVyblxuXG4gICAgY29uc3QgaHR0cFNlcnZlckxvY2sgPSBuZXcgSHR0cFNlcnZlckxvY2soe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnR9KVxuICAgIGF3YWl0IGh0dHBTZXJ2ZXJMb2NrLmFjcXVpcmUoKVxuICAgIHRoaXMuaHR0cFNlcnZlckxvY2sgPSBodHRwU2VydmVyTG9ja1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGh0dHAgc2VydmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEhUVFAgc2VydmVyIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pblByb2Nlc3NdIC0gUnVuIEhUVFAgaGFuZGxlcnMgaW4gdGhlIG1haW4gdGhyZWFkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4V29ya2Vyc10gLSBNYXggd29ya2Vycy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucG9ydCAtIFBvcnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy53b3JrZXJzXSAtIFdvcmtlciBjb3VudC5cbiAgICogQHJldHVybnMge0h0dHBTZXJ2ZXJ9IC0gSFRUUCBzZXJ2ZXIgaW5zdGFuY2UuXG4gICAqL1xuICBjcmVhdGVIdHRwU2VydmVyKHtjb25maWd1cmF0aW9uLCBob3N0LCBpblByb2Nlc3MsIG1heFdvcmtlcnMsIHBvcnQsIHdvcmtlcnN9KSB7XG4gICAgcmV0dXJuIG5ldyBIdHRwU2VydmVyKHtjb25maWd1cmF0aW9uLCBob3N0LCBpblByb2Nlc3MsIG1heFdvcmtlcnMsIHBvcnQsIHdvcmtlcnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIHN0b3AoKSB7XG4gICAgaWYgKCF0aGlzLl9zdG9wUHJvbWlzZSkgdGhpcy5fc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wKClcblxuICAgIHJldHVybiB0aGlzLl9zdG9wUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIGFwcGxpY2F0aW9uIGFuZCBmcmFtZXdvcmsgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIGNsb3NlIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3N0b3AoKSB7XG4gICAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgICBtZXNzYWdlOiBcIkFwcGxpY2F0aW9uIGFuZCBmcmFtZXdvcmsgc2h1dGRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogW1xuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlN0b3BwaW5nIHNlcnZlclwiKSxcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh0dHBTZXJ2ZXI/LnN0b3AoKVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX2h0dHBTZXJ2ZXJJbnN0YW5jZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnNodXRkb3duKCksXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5kaXNjb25uZWN0QmVhY29uKCksXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5yZWxlYXNlSHR0cFNlcnZlckxvY2soKVxuICAgICAgXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxlYXNlIGh0dHAgc2VydmVyIGxvY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBIVFRQIHNlcnZlciBsb2NrIGhhcyBiZWVuIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZUh0dHBTZXJ2ZXJMb2NrKCkge1xuICAgIGNvbnN0IHtodHRwU2VydmVyTG9ja30gPSB0aGlzXG5cbiAgICB0aGlzLmh0dHBTZXJ2ZXJMb2NrID0gdW5kZWZpbmVkXG4gICAgaWYgKGh0dHBTZXJ2ZXJMb2NrKSBhd2FpdCBodHRwU2VydmVyTG9jay5yZWxlYXNlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBPbiBodHRwIHNlcnZlciBjbG9zZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgb25IdHRwU2VydmVyQ2xvc2UgPSAoKSA9PiB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoXCJIVFRQIHNlcnZlciBjbG9zZWRcIilcblxuICAgIGlmICh0aGlzLndhaXRSZXNvbHZlKSB7XG4gICAgICB0aGlzLndhaXRSZXNvbHZlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgd2FpdCgpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMud2FpdFJlc29sdmUgPSByZXNvbHZlXG4gICAgfSlcbiAgfVxufVxuIl19