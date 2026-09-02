import Logger from "../logger.js";
export default class VelociousRoutesResolver {
    configuration: import("../configuration.js").default;
    params: {
        [x: string]: any;
    };
    request: import("../http-server/client/websocket-request.js").default | import("../http-server/client/request.js").default;
    response: import("../http-server/client/response.js").default;
    logSensitiveValues: Set<string>;
    routeHookControllerClass: typeof import("../controller.js").default | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Logger | undefined} */
    logger: Logger | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
     * @param {import("../http-server/client/response.js").default} args.response - Response object.
     */
    constructor({ configuration, request, response }: {
        configuration: import("../configuration.js").default;
        request: import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default;
        response: import("../http-server/client/response.js").default;
    });
    /**
     * Runs query parameters.
     * @returns {Record<string, string>} - Flat query params for tenant/ability resolution.
     */
    queryParameters(): Record<string, string>;
    resolve(): Promise<void>;
    /**
     * Runs resolve controller class.
     * @param {object} args - Args.
     * @param {string} args.controllerPath - Controller import path.
     * @returns {Promise<typeof import("../controller.js").default>} - The resolved controller class.
     */
    resolveControllerClass({ controllerPath }: {
        controllerPath: string;
    }): Promise<typeof import("../controller.js").default>;
    /**
     * Runs match path with routes.
     * @param {import("./base-route.js").default} route - Route.
     * @param {string} path - Path.
     * @returns {{restPath: string} | undefined} - REST path metadata for this route.
     */
    matchPathWithRoutes(route: import("./base-route.js").default, path: string): {
        restPath: string;
    } | undefined;
    /**
     * Runs resolve route resolver hooks.
     * @param {string} currentPath - Request path without query string.
     * @param {object} options - Resolver hook options.
     * @param {boolean} [options.hasMatchingCustomRoute] - True when the path matched an explicit custom route.
     * @returns {Promise<import("../configuration-types.js").RouteResolverHookResult | null>} - Matched action/controller from hooks.
     */
    resolveRouteResolverHooks(currentPath: string, options?: {
        hasMatchingCustomRoute?: boolean;
    }): Promise<import("../configuration-types.js").RouteResolverHookResult | null>;
    /**
     * Runs log action start.
     * @param {object} args - Options object.
     * @param {string} args.action - Action.
     * @param {typeof import("../controller.js").default} args.controllerClass - Controller class.
     * @param {"debug" | "info"} args.logMethod - Logger method.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _logActionStart({ action, controllerClass, logMethod }: {
        action: string;
        controllerClass: typeof import("../controller.js").default;
        logMethod: "debug" | "info";
    }): Promise<void>;
    /**
     * Runs log method.
     * @returns {"debug" | "info"} - Request log method.
     */
    _logMethod(): "debug" | "info";
    /**
     * Runs measure controller.
     * @template T
     * @param {() => Promise<T>} callback - Callback to measure.
     * @returns {Promise<T>} - Callback result.
     */
    _measureController<T>(callback: () => Promise<T>): Promise<T>;
    /**
     * Runs set completed log metadata.
     * @param {object} args - Options object.
     * @param {typeof import("../controller.js").default} args.controllerClass - Controller class.
     * @param {"debug" | "info"} args.logMethod - Logger method.
     * @returns {void} - No return value.
     */
    _setCompletedLogMetadata({ controllerClass, logMethod }: {
        controllerClass: typeof import("../controller.js").default;
        logMethod: "debug" | "info";
    }): void;
    /**
     * Runs format timestamp.
     * @param {Date} date - Date value.
     * @returns {string} - The timestamp.
     */
    _formatTimestamp(date: Date): string;
    /**
     * Runs sanitize params for logging.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The sanitize params for logging.
     */
    _sanitizeParamsForLogging(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Preserves useful upload metadata before generic structured redaction.
     * @param {ReturnType<typeof JSON.parse>} value - Value to prepare.
     * @returns {ReturnType<typeof JSON.parse>} - Logging-safe structural copy.
     */
    _prepareParamsForLogging(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
}
//# sourceMappingURL=resolver.d.ts.map