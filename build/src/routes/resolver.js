// @ts-check
import { dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import * as inflection from "inflection";
import { ensureError } from "typanic";
import Logger from "../logger.js";
import UploadedFile from "../http-server/client/uploaded-file/uploaded-file.js";
import toImportSpecifier from "../utils/to-import-specifier.js";
/**
 * Runs normalize action name.
 * @param {string} actionName - Raw action name from route params or route hook.
 * @returns {string} - Normalized controller method name.
 */
function normalizeActionName(actionName) {
    return inflection.camelize(actionName.replaceAll("-", "_").replaceAll("/", "_"), true);
}
export default class VelociousRoutesResolver {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Logger | undefined} */
    logger;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
     * @param {import("../http-server/client/response.js").default} args.response - Response object.
     */
    constructor({ configuration, request, response }) {
        if (!configuration)
            throw new Error("No configuration given");
        if (!request)
            throw new Error("No request given");
        if (!response)
            throw new Error("No response given");
        this.configuration = configuration;
        this.logger = new Logger("RoutesResolver", { configuration });
        const requestParams = request.params() || {};
        this.params = { ...requestParams };
        delete this.params.action;
        delete this.params.controller;
        this.request = request;
        this.response = response;
        const requestTiming = configuration.getCurrentRequestTiming();
        const initialSensitiveValues = requestTiming ? requestTiming.getLogSensitiveValues() : new Set();
        this.logSensitiveValues = configuration.getLogRedactor().requestSensitiveValues(request, initialSensitiveValues);
        if (requestTiming)
            requestTiming.registerLogSensitiveValues(this.logSensitiveValues);
    }
    /**
     * Runs query parameters.
     * @returns {Record<string, string>} - Flat query params for tenant/ability resolution.
     */
    queryParameters() {
        const query = this.request.path().split("?")[1];
        if (!query)
            return {};
        /**
         * Params.
         * @type {Record<string, string>} */
        const params = {};
        const searchParams = new URLSearchParams(query);
        for (const [key, value] of searchParams.entries()) {
            if (params[key] === undefined) {
                params[key] = value;
            }
        }
        return params;
    }
    async resolve() {
        this.routeHookControllerClass = undefined;
        let controllerPath;
        const configurationRoutes = this.configuration.getRoutes();
        const currentRoute = configurationRoutes?.rootRoute;
        const rawPath = this.request.path();
        const currentPath = rawPath.split("?")[0];
        let viewPath;
        const preCheckParams = { ...this.params };
        const hasMatchingCustomRoute = currentRoute ? !!this.matchPathWithRoutes(currentRoute, currentPath) : false;
        if (hasMatchingCustomRoute) {
            this.params = preCheckParams;
        }
        const routeResolverHookMatch = await this.resolveRouteResolverHooks(currentPath, { hasMatchingCustomRoute });
        let skipControllerConnections = this.configuration.database === false || routeResolverHookMatch?.skipControllerConnections === true;
        let skipAbilityResolution = routeResolverHookMatch?.skipAbilityResolution === true;
        let skipTenantResolution = routeResolverHookMatch?.skipTenantResolution === true;
        const matchResult = routeResolverHookMatch || !currentRoute ? undefined : this.matchPathWithRoutes(currentRoute, currentPath);
        const actionParam = this.params.action;
        const controllerParam = this.params.controller;
        const actionValue = typeof actionParam == "string" ? actionParam : (Array.isArray(actionParam) ? actionParam[0] : undefined);
        let action = typeof actionValue == "string" ? normalizeActionName(actionValue) : undefined;
        let controller = typeof controllerParam == "string" ? controllerParam : (Array.isArray(controllerParam) ? controllerParam[0] : undefined);
        if (routeResolverHookMatch) {
            const routeHookControllerClass = routeResolverHookMatch.controllerClass;
            let routeHookControllerPath;
            let routeHookViewPath;
            if (typeof routeResolverHookMatch.controllerPath === "string") {
                routeHookControllerPath = routeResolverHookMatch.controllerPath;
            }
            if (typeof routeResolverHookMatch.viewPath === "string") {
                routeHookViewPath = routeResolverHookMatch.viewPath;
            }
            controller = routeResolverHookMatch.controller;
            action = normalizeActionName(routeResolverHookMatch.action);
            this.params.controller = controller;
            this.params.action = routeResolverHookMatch.action;
            controllerPath = routeHookControllerPath || `${this.configuration.getDirectory()}/src/routes/${controller}/controller.js`;
            viewPath = routeHookViewPath || `${this.configuration.getDirectory()}/src/routes/${controller}`;
            this.routeHookControllerClass = routeHookControllerClass;
        }
        else if (!matchResult) {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const requestedPath = currentPath.replace(/^\//, "") || "_root";
            const attemptedControllerPath = `${this.configuration.getDirectory()}/src/routes/${requestedPath}/controller.js`;
            const logger = this.logger;
            if (!logger)
                throw new Error("Logger not initialized");
            const loggedPath = this.configuration.getLogRedactor().redactPath(rawPath, this.logSensitiveValues);
            await logger.warn(`No route matched for ${loggedPath}. Tried controller at ${attemptedControllerPath}`);
            controller = "errors";
            controllerPath = "./built-in/errors/controller.js";
            action = "notFound";
            skipAbilityResolution = true;
            skipControllerConnections = true;
            skipTenantResolution = true;
            viewPath = await fs.realpath(`${__dirname}/built-in/errors`);
        }
        else if (action) {
            if (!controller)
                controller = "_root";
            controllerPath = `${this.configuration.getDirectory()}/src/routes/${controller}/controller.js`;
            viewPath = `${this.configuration.getDirectory()}/src/routes/${controller}`;
        }
        else {
            throw new Error(`Matched the route but didn't know what to do with it: ${rawPath} (action: ${action}, controller: ${controller}, params: ${JSON.stringify(this.params)})`);
        }
        const controllerClass = await this.resolveControllerClass({ controllerPath });
        const controllerRequest = /** @type {import("../http-server/client/request.js").default} */ (this.request);
        const controllerInstance = new controllerClass({
            action,
            configuration: this.configuration,
            controller,
            params: this.params,
            request: controllerRequest,
            response: this.response,
            viewPath
        });
        if (!(action in controllerInstance)) {
            throw new Error(`Missing action on controller: ${controller}#${action}`);
        }
        const actionHandlers = /** @type {Record<string, () => void | Promise<void>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(controllerInstance));
        const logMethod = this._logMethod();
        this._setCompletedLogMetadata({ controllerClass, logMethod });
        await this._logActionStart({ action, controllerClass, logMethod });
        try {
            const tenant = skipTenantResolution || !this.configuration.getTenantResolver()
                ? undefined
                : await this.configuration.ensureConnections({ name: `${controllerClass.name}.${action} tenant resolution` }, async () => {
                    return await this.configuration.resolveTenant({
                        params: { ...this.queryParameters(), ...this.params },
                        request: this.request,
                        response: this.response
                    });
                });
            const runAction = async () => {
                await this.configuration.runWithTenant(tenant, async () => {
                    const runControllerAction = async () => {
                        const ability = skipAbilityResolution
                            ? undefined
                            : await this.configuration.resolveAbility({
                                params: this.params,
                                request: this.request,
                                response: this.response
                            });
                        await this.configuration.runWithAbility(ability, async () => {
                            await this._measureController(async () => {
                                await controllerInstance._runBeforeCallbacks();
                                await actionHandlers[action]();
                            });
                        });
                    };
                    if (skipControllerConnections) {
                        await runControllerAction();
                    }
                    else {
                        await this.configuration.ensureConnections({ name: `${controllerClass.name}.${action}` }, runControllerAction);
                    }
                });
            };
            const aroundAction = this.configuration.getAroundAction?.();
            if (aroundAction) {
                await aroundAction({ request: this.request, response: this.response, next: runAction });
            }
            else {
                await runAction();
            }
        }
        catch (error) {
            const ensuredError = ensureError(error);
            const errorContext = {
                action,
                controller,
                httpMethod: this.request.httpMethod(),
                path: this.request.path(),
                stage: "controller-action"
            };
            const errorWithContext = /** @type {{velociousContext?: object}} */ (ensuredError);
            errorWithContext.velociousContext = {
                ...(errorWithContext.velociousContext || {}),
                controllerAction: errorContext
            };
            throw ensuredError;
        }
    }
    /**
     * Runs resolve controller class.
     * @param {object} args - Args.
     * @param {string} args.controllerPath - Controller import path.
     * @returns {Promise<typeof import("../controller.js").default>} - The resolved controller class.
     */
    async resolveControllerClass({ controllerPath }) {
        if (this.routeHookControllerClass)
            return this.routeHookControllerClass;
        const controllerImportSpecifier = toImportSpecifier(controllerPath);
        return /** @type {typeof import("../controller.js").default} */ ((await import(controllerImportSpecifier)).default);
    }
    /**
     * Runs match path with routes.
     * @param {import("./base-route.js").default} route - Route.
     * @param {string} path - Path.
     * @returns {{restPath: string} | undefined} - REST path metadata for this route.
     */
    matchPathWithRoutes(route, path) {
        const pathWithoutSlash = path.replace(/^\//, "").split("?")[0];
        for (const subRoute of route.routes) {
            const paramsSnapshot = { ...this.params };
            const matchResult = subRoute.matchWithPath({
                params: this.params,
                path: pathWithoutSlash,
                request: this.request
            });
            if (!matchResult) {
                this.params = paramsSnapshot;
                continue;
            }
            const { restPath } = matchResult;
            if (restPath) {
                const recursiveMatch = this.matchPathWithRoutes(subRoute, restPath);
                if (recursiveMatch) {
                    return recursiveMatch;
                }
                this.params = paramsSnapshot;
                continue;
            }
            return matchResult;
        }
    }
    /**
     * Runs resolve route resolver hooks.
     * @param {string} currentPath - Request path without query string.
     * @param {object} options - Resolver hook options.
     * @param {boolean} [options.hasMatchingCustomRoute] - True when the path matched an explicit custom route.
     * @returns {Promise<import("../configuration-types.js").RouteResolverHookResult | null>} - Matched action/controller from hooks.
     */
    async resolveRouteResolverHooks(currentPath, options = {}) {
        const { hasMatchingCustomRoute = false } = options;
        const hooks = this.configuration.getRouteResolverHooks?.() || [];
        for (const hook of hooks) {
            const hookResult = await hook({
                configuration: this.configuration,
                currentPath,
                hasMatchingCustomRoute,
                params: this.params,
                request: this.request,
                resolver: this,
                response: this.response
            });
            if (!hookResult)
                continue;
            if (typeof hookResult.action !== "string" || hookResult.action.length < 1) {
                throw new Error(`Expected route resolver hook action to be a string, got: ${hookResult.action}`);
            }
            if (typeof hookResult.controller !== "string" || hookResult.controller.length < 1) {
                throw new Error(`Expected route resolver hook controller to be a string, got: ${hookResult.controller}`);
            }
            if (hookResult.params && typeof hookResult.params !== "object") {
                throw new Error(`Expected route resolver hook params to be an object, got: ${hookResult.params}`);
            }
            if (hookResult.controllerClass !== undefined && typeof hookResult.controllerClass !== "function") {
                throw new Error(`Expected route resolver hook controllerClass to be a class/function when provided, got: ${hookResult.controllerClass}`);
            }
            if (hookResult.controllerPath !== undefined && typeof hookResult.controllerPath !== "string") {
                throw new Error(`Expected route resolver hook controllerPath to be a string when provided, got: ${hookResult.controllerPath}`);
            }
            if (hookResult.skipControllerConnections !== undefined && typeof hookResult.skipControllerConnections !== "boolean") {
                throw new Error(`Expected route resolver hook skipControllerConnections to be a boolean when provided, got: ${hookResult.skipControllerConnections}`);
            }
            if (hookResult.skipAbilityResolution !== undefined && typeof hookResult.skipAbilityResolution !== "boolean") {
                throw new Error(`Expected route resolver hook skipAbilityResolution to be a boolean when provided, got: ${hookResult.skipAbilityResolution}`);
            }
            if (hookResult.skipTenantResolution !== undefined && typeof hookResult.skipTenantResolution !== "boolean") {
                throw new Error(`Expected route resolver hook skipTenantResolution to be a boolean when provided, got: ${hookResult.skipTenantResolution}`);
            }
            if (hookResult.viewPath !== undefined && typeof hookResult.viewPath !== "string") {
                throw new Error(`Expected route resolver hook viewPath to be a string when provided, got: ${hookResult.viewPath}`);
            }
            if (hookResult.params) {
                Object.assign(this.params, hookResult.params);
            }
            return hookResult;
        }
        return null;
    }
    /**
     * Runs log action start.
     * @param {object} args - Options object.
     * @param {string} args.action - Action.
     * @param {typeof import("../controller.js").default} args.controllerClass - Controller class.
     * @param {"debug" | "info"} args.logMethod - Logger method.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _logActionStart({ action, controllerClass, logMethod }) {
        const request = this.request;
        const timestamp = this._formatTimestamp(new Date());
        const remoteAddress = request.remoteAddress() || "unknown";
        const redactor = this.configuration.getLogRedactor();
        this.logSensitiveValues = redactor.sensitiveValues(this.params, this.logSensitiveValues);
        const requestTiming = this.configuration.getCurrentRequestTiming();
        if (requestTiming)
            requestTiming.registerLogSensitiveValues(this.logSensitiveValues);
        const loggedParams = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this._sanitizeParamsForLogging(this.params));
        delete loggedParams.action;
        delete loggedParams.controller;
        const controllerLogger = new Logger(controllerClass.name, { configuration: this.configuration });
        const loggedPath = redactor.redactPath(request.path(), this.logSensitiveValues);
        await controllerLogger[logMethod](() => `Started ${request.httpMethod()} "${loggedPath}" for ${remoteAddress} at ${timestamp}`);
        await controllerLogger[logMethod](() => `Processing by ${controllerClass.name}#${action}`);
        await controllerLogger[logMethod](() => [`  Parameters:`, loggedParams]);
    }
    /**
     * Runs log method.
     * @returns {"debug" | "info"} - Request log method.
     */
    _logMethod() {
        return this.configuration.getEnvironment() === "test" ? "debug" : "info";
    }
    /**
     * Runs measure controller.
     * @template T
     * @param {() => Promise<T>} callback - Callback to measure.
     * @returns {Promise<T>} - Callback result.
     */
    async _measureController(callback) {
        const requestTiming = this.configuration.getCurrentRequestTiming();
        return requestTiming
            ? await requestTiming.measure("controller", callback)
            : await callback();
    }
    /**
     * Runs set completed log metadata.
     * @param {object} args - Options object.
     * @param {typeof import("../controller.js").default} args.controllerClass - Controller class.
     * @param {"debug" | "info"} args.logMethod - Logger method.
     * @returns {void} - No return value.
     */
    _setCompletedLogMetadata({ controllerClass, logMethod }) {
        const requestTiming = this.configuration.getCurrentRequestTiming();
        if (!requestTiming)
            return;
        requestTiming.completedLogSubject = controllerClass.name;
        requestTiming.completedLogMethod = logMethod;
    }
    /**
     * Runs format timestamp.
     * @param {Date} date - Date value.
     * @returns {string} - The timestamp.
     */
    _formatTimestamp(date) {
        /**
         * Pad.
         * @param {number} num - Num.
         * @returns {string} - The pad.
         */
        const pad = (num) => String(num).padStart(2, "0");
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        const offsetMinutes = date.getTimezoneOffset();
        const offsetSign = offsetMinutes > 0 ? "-" : "+";
        const offsetTotalMinutes = Math.abs(offsetMinutes);
        const offsetHours = pad(Math.floor(offsetTotalMinutes / 60));
        const offsetRemainingMinutes = pad(offsetTotalMinutes % 60);
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${offsetSign}${offsetHours}${offsetRemainingMinutes}`;
    }
    /**
     * Runs sanitize params for logging.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The sanitize params for logging.
     */
    _sanitizeParamsForLogging(value) {
        const preparedValue = this._prepareParamsForLogging(value);
        return this.configuration.getLogRedactor().redactStructured(preparedValue, this.logSensitiveValues);
    }
    /**
     * Preserves useful upload metadata before generic structured redaction.
     * @param {ReturnType<typeof JSON.parse>} value - Value to prepare.
     * @returns {ReturnType<typeof JSON.parse>} - Logging-safe structural copy.
     */
    _prepareParamsForLogging(value) {
        if (value instanceof UploadedFile) {
            return {
                className: value.constructor.name,
                filename: value.filename(),
                size: value.size()
            };
        }
        if (Array.isArray(value)) {
            return value.map((item) => this._prepareParamsForLogging(item));
        }
        if (value && typeof value === "object") {
            /**
             * Result.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const result = {};
            for (const key of Object.keys(value)) {
                result[key] = this._prepareParamsForLogging(value[key]);
            }
            return result;
        }
        return value;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb2x2ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvcm91dGVzL3Jlc29sdmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsT0FBTyxFQUFDLE1BQU0sTUFBTSxDQUFBO0FBQzVCLE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxLQUFLLENBQUE7QUFDakMsT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxTQUFTLENBQUE7QUFDbkMsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sWUFBWSxNQUFNLHNEQUFzRCxDQUFBO0FBQy9FLE9BQU8saUJBQWlCLE1BQU0saUNBQWlDLENBQUE7QUFFL0Q7Ozs7R0FJRztBQUNILFNBQVMsbUJBQW1CLENBQUMsVUFBVTtJQUNyQyxPQUFPLFVBQVUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQTtBQUN4RixDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyx1QkFBdUI7SUFDMUM7O29DQUVnQztJQUNoQyxNQUFNLENBQUE7SUFFTjs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUM7UUFDNUMsSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUE7UUFDN0QsSUFBSSxDQUFDLE9BQU87WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFDakQsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1CQUFtQixDQUFD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a0JBQWtCLENBQUMsQ0FBQTtJQUNyRyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHdCQUF3QixDQUFDLEtBQUs7UUFDNUIsSUFBSSxLQUFLLFlBQVksWUFBWSxFQUFFLENBQUM7WUFDbEMsT0FBTztnQkFDTCxTQUFTLEVBQUUsS0FBSyxDQUFDLFdBQVcsQ0FBQyxJQUFJO2dCQUNqQyxRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVEsRUFBRTtnQkFDMUIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLEVBQUU7YUFDbkIsQ0FBQTtRQUNILENBQUM7UUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN6QixPQUFPLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO1FBQ2pFLENBQUM7UUFFRCxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN2Qzs7dUVBRTJEO1lBQzNELE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtZQUVqQixLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDckMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtZQUN6RCxDQUFDO1lBRUQsT0FBTyxNQUFNLENBQUE7UUFDZixDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaXJuYW1lfSBmcm9tIFwicGF0aFwiXG5pbXBvcnQge2ZpbGVVUkxUb1BhdGh9IGZyb20gXCJ1cmxcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCB7ZW5zdXJlRXJyb3J9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgVXBsb2FkZWRGaWxlIGZyb20gXCIuLi9odHRwLXNlcnZlci9jbGllbnQvdXBsb2FkZWQtZmlsZS91cGxvYWRlZC1maWxlLmpzXCJcbmltcG9ydCB0b0ltcG9ydFNwZWNpZmllciBmcm9tIFwiLi4vdXRpbHMvdG8taW1wb3J0LXNwZWNpZmllci5qc1wiXG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgYWN0aW9uIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uTmFtZSAtIFJhdyBhY3Rpb24gbmFtZSBmcm9tIHJvdXRlIHBhcmFtcyBvciByb3V0ZSBob29rLlxuICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIGNvbnRyb2xsZXIgbWV0aG9kIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUFjdGlvbk5hbWUoYWN0aW9uTmFtZSkge1xuICByZXR1cm4gaW5mbGVjdGlvbi5jYW1lbGl6ZShhY3Rpb25OYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKS5yZXBsYWNlQWxsKFwiL1wiLCBcIl9cIiksIHRydWUpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c1JvdXRlc1Jlc29sdmVyIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0xvZ2dlciB8IHVuZGVmaW5lZH0gKi9cbiAgbG9nZ2VyXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gYXJncy5yZXF1ZXN0IC0gUmVxdWVzdCBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgcmVxdWVzdCwgcmVzcG9uc2V9KSB7XG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25maWd1cmF0aW9uIGdpdmVuXCIpXG4gICAgaWYgKCFyZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyByZXF1ZXN0IGdpdmVuXCIpXG4gICAgaWYgKCFyZXNwb25zZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gcmVzcG9uc2UgZ2l2ZW5cIilcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIoXCJSb3V0ZXNSZXNvbHZlclwiLCB7Y29uZmlndXJhdGlvbn0pXG4gICAgY29uc3QgcmVxdWVzdFBhcmFtcyA9IHJlcXVlc3QucGFyYW1zKCkgfHwge31cbiAgICB0aGlzLnBhcmFtcyA9IHsuLi5yZXF1ZXN0UGFyYW1zfVxuICAgIGRlbGV0ZSB0aGlzLnBhcmFtcy5hY3Rpb25cbiAgICBkZWxldGUgdGhpcy5wYXJhbXMuY29udHJvbGxlclxuICAgIHRoaXMucmVxdWVzdCA9IHJlcXVlc3RcbiAgICB0aGlzLnJlc3BvbnNlID0gcmVzcG9uc2VcbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgY29uc3QgaW5pdGlhbFNlbnNpdGl2ZVZhbHVlcyA9IHJlcXVlc3RUaW1pbmcgPyByZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpIDogbmV3IFNldCgpXG5cbiAgICB0aGlzLmxvZ1NlbnNpdGl2ZVZhbHVlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKS5yZXF1ZXN0U2Vuc2l0aXZlVmFsdWVzKHJlcXVlc3QsIGluaXRpYWxTZW5zaXRpdmVWYWx1ZXMpXG4gICAgaWYgKHJlcXVlc3RUaW1pbmcpIHJlcXVlc3RUaW1pbmcucmVnaXN0ZXJMb2dTZW5zaXRpdmVWYWx1ZXModGhpcy5sb2dTZW5zaXRpdmVWYWx1ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBwYXJhbWV0ZXJzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBGbGF0IHF1ZXJ5IHBhcmFtcyBmb3IgdGVuYW50L2FiaWxpdHkgcmVzb2x1dGlvbi5cbiAgICovXG4gIHF1ZXJ5UGFyYW1ldGVycygpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMucmVxdWVzdC5wYXRoKCkuc3BsaXQoXCI/XCIpWzFdXG5cbiAgICBpZiAoIXF1ZXJ5KSByZXR1cm4ge31cblxuICAgIC8qKlxuICAgICAqIFBhcmFtcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICBjb25zdCBwYXJhbXMgPSB7fVxuICAgIGNvbnN0IHNlYXJjaFBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMocXVlcnkpXG5cbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBzZWFyY2hQYXJhbXMuZW50cmllcygpKSB7XG4gICAgICBpZiAocGFyYW1zW2tleV0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwYXJhbXNba2V5XSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcmFtc1xuICB9XG5cbiAgYXN5bmMgcmVzb2x2ZSgpIHtcbiAgICB0aGlzLnJvdXRlSG9va0NvbnRyb2xsZXJDbGFzcyA9IHVuZGVmaW5lZFxuICAgIGxldCBjb250cm9sbGVyUGF0aFxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25Sb3V0ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Um91dGVzKClcbiAgICBjb25zdCBjdXJyZW50Um91dGUgPSBjb25maWd1cmF0aW9uUm91dGVzPy5yb290Um91dGVcbiAgICBjb25zdCByYXdQYXRoID0gdGhpcy5yZXF1ZXN0LnBhdGgoKVxuICAgIGNvbnN0IGN1cnJlbnRQYXRoID0gcmF3UGF0aC5zcGxpdChcIj9cIilbMF1cbiAgICBsZXQgdmlld1BhdGhcblxuICAgIGNvbnN0IHByZUNoZWNrUGFyYW1zID0gey4uLnRoaXMucGFyYW1zfVxuICAgIGNvbnN0IGhhc01hdGNoaW5nQ3VzdG9tUm91dGUgPSBjdXJyZW50Um91dGUgPyAhIXRoaXMubWF0Y2hQYXRoV2l0aFJvdXRlcyhjdXJyZW50Um91dGUsIGN1cnJlbnRQYXRoKSA6IGZhbHNlXG5cbiAgICBpZiAoaGFzTWF0Y2hpbmdDdXN0b21Sb3V0ZSkge1xuICAgICAgdGhpcy5wYXJhbXMgPSBwcmVDaGVja1BhcmFtc1xuICAgIH1cblxuICAgIGNvbnN0IHJvdXRlUmVzb2x2ZXJIb29rTWF0Y2ggPSBhd2FpdCB0aGlzLnJlc29sdmVSb3V0ZVJlc29sdmVySG9va3MoY3VycmVudFBhdGgsIHtoYXNNYXRjaGluZ0N1c3RvbVJvdXRlfSlcbiAgICBsZXQgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9ucyA9IHRoaXMuY29uZmlndXJhdGlvbi5kYXRhYmFzZSA9PT0gZmFsc2UgfHwgcm91dGVSZXNvbHZlckhvb2tNYXRjaD8uc2tpcENvbnRyb2xsZXJDb25uZWN0aW9ucyA9PT0gdHJ1ZVxuICAgIGxldCBza2lwQWJpbGl0eVJlc29sdXRpb24gPSByb3V0ZVJlc29sdmVySG9va01hdGNoPy5za2lwQWJpbGl0eVJlc29sdXRpb24gPT09IHRydWVcbiAgICBsZXQgc2tpcFRlbmFudFJlc29sdXRpb24gPSByb3V0ZVJlc29sdmVySG9va01hdGNoPy5za2lwVGVuYW50UmVzb2x1dGlvbiA9PT0gdHJ1ZVxuICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gcm91dGVSZXNvbHZlckhvb2tNYXRjaCB8fCAhY3VycmVudFJvdXRlID8gdW5kZWZpbmVkIDogdGhpcy5tYXRjaFBhdGhXaXRoUm91dGVzKGN1cnJlbnRSb3V0ZSwgY3VycmVudFBhdGgpXG4gICAgY29uc3QgYWN0aW9uUGFyYW0gPSB0aGlzLnBhcmFtcy5hY3Rpb25cbiAgICBjb25zdCBjb250cm9sbGVyUGFyYW0gPSB0aGlzLnBhcmFtcy5jb250cm9sbGVyXG4gICAgY29uc3QgYWN0aW9uVmFsdWUgPSB0eXBlb2YgYWN0aW9uUGFyYW0gPT0gXCJzdHJpbmdcIiA/IGFjdGlvblBhcmFtIDogKEFycmF5LmlzQXJyYXkoYWN0aW9uUGFyYW0pID8gYWN0aW9uUGFyYW1bMF0gOiB1bmRlZmluZWQpXG4gICAgbGV0IGFjdGlvbiA9IHR5cGVvZiBhY3Rpb25WYWx1ZSA9PSBcInN0cmluZ1wiID8gbm9ybWFsaXplQWN0aW9uTmFtZShhY3Rpb25WYWx1ZSkgOiB1bmRlZmluZWRcbiAgICBsZXQgY29udHJvbGxlciA9IHR5cGVvZiBjb250cm9sbGVyUGFyYW0gPT0gXCJzdHJpbmdcIiA/IGNvbnRyb2xsZXJQYXJhbSA6IChBcnJheS5pc0FycmF5KGNvbnRyb2xsZXJQYXJhbSkgPyBjb250cm9sbGVyUGFyYW1bMF0gOiB1bmRlZmluZWQpXG5cbiAgICBpZiAocm91dGVSZXNvbHZlckhvb2tNYXRjaCkge1xuICAgICAgY29uc3Qgcm91dGVIb29rQ29udHJvbGxlckNsYXNzID0gcm91dGVSZXNvbHZlckhvb2tNYXRjaC5jb250cm9sbGVyQ2xhc3NcbiAgICAgIGxldCByb3V0ZUhvb2tDb250cm9sbGVyUGF0aFxuICAgICAgbGV0IHJvdXRlSG9va1ZpZXdQYXRoXG5cbiAgICAgIGlmICh0eXBlb2Ygcm91dGVSZXNvbHZlckhvb2tNYXRjaC5jb250cm9sbGVyUGF0aCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICByb3V0ZUhvb2tDb250cm9sbGVyUGF0aCA9IHJvdXRlUmVzb2x2ZXJIb29rTWF0Y2guY29udHJvbGxlclBhdGhcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiByb3V0ZVJlc29sdmVySG9va01hdGNoLnZpZXdQYXRoID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHJvdXRlSG9va1ZpZXdQYXRoID0gcm91dGVSZXNvbHZlckhvb2tNYXRjaC52aWV3UGF0aFxuICAgICAgfVxuXG4gICAgICBjb250cm9sbGVyID0gcm91dGVSZXNvbHZlckhvb2tNYXRjaC5jb250cm9sbGVyXG4gICAgICBhY3Rpb24gPSBub3JtYWxpemVBY3Rpb25OYW1lKHJvdXRlUmVzb2x2ZXJIb29rTWF0Y2guYWN0aW9uKVxuICAgICAgdGhpcy5wYXJhbXMuY29udHJvbGxlciA9IGNvbnRyb2xsZXJcbiAgICAgIHRoaXMucGFyYW1zLmFjdGlvbiA9IHJvdXRlUmVzb2x2ZXJIb29rTWF0Y2guYWN0aW9uXG4gICAgICBjb250cm9sbGVyUGF0aCA9IHJvdXRlSG9va0NvbnRyb2xsZXJQYXRoIHx8IGAke3RoaXMuY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKX0vc3JjL3JvdXRlcy8ke2NvbnRyb2xsZXJ9L2NvbnRyb2xsZXIuanNgXG4gICAgICB2aWV3UGF0aCA9IHJvdXRlSG9va1ZpZXdQYXRoIHx8IGAke3RoaXMuY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKX0vc3JjL3JvdXRlcy8ke2NvbnRyb2xsZXJ9YFxuICAgICAgdGhpcy5yb3V0ZUhvb2tDb250cm9sbGVyQ2xhc3MgPSByb3V0ZUhvb2tDb250cm9sbGVyQ2xhc3NcbiAgICB9IGVsc2UgaWYgKCFtYXRjaFJlc3VsdCkge1xuICAgICAgY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKVxuICAgICAgY29uc3QgX19kaXJuYW1lID0gZGlybmFtZShfX2ZpbGVuYW1lKVxuICAgICAgY29uc3QgcmVxdWVzdGVkUGF0aCA9IGN1cnJlbnRQYXRoLnJlcGxhY2UoL15cXC8vLCBcIlwiKSB8fCBcIl9yb290XCJcbiAgICAgIGNvbnN0IGF0dGVtcHRlZENvbnRyb2xsZXJQYXRoID0gYCR7dGhpcy5jb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpfS9zcmMvcm91dGVzLyR7cmVxdWVzdGVkUGF0aH0vY29udHJvbGxlci5qc2BcblxuICAgICAgY29uc3QgbG9nZ2VyID0gdGhpcy5sb2dnZXJcblxuICAgICAgaWYgKCFsb2dnZXIpIHRocm93IG5ldyBFcnJvcihcIkxvZ2dlciBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgICAgY29uc3QgbG9nZ2VkUGF0aCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpLnJlZGFjdFBhdGgocmF3UGF0aCwgdGhpcy5sb2dTZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICAgIGF3YWl0IGxvZ2dlci53YXJuKGBObyByb3V0ZSBtYXRjaGVkIGZvciAke2xvZ2dlZFBhdGh9LiBUcmllZCBjb250cm9sbGVyIGF0ICR7YXR0ZW1wdGVkQ29udHJvbGxlclBhdGh9YClcblxuICAgICAgY29udHJvbGxlciA9IFwiZXJyb3JzXCJcbiAgICAgIGNvbnRyb2xsZXJQYXRoID0gXCIuL2J1aWx0LWluL2Vycm9ycy9jb250cm9sbGVyLmpzXCJcbiAgICAgIGFjdGlvbiA9IFwibm90Rm91bmRcIlxuICAgICAgc2tpcEFiaWxpdHlSZXNvbHV0aW9uID0gdHJ1ZVxuICAgICAgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9ucyA9IHRydWVcbiAgICAgIHNraXBUZW5hbnRSZXNvbHV0aW9uID0gdHJ1ZVxuICAgICAgdmlld1BhdGggPSBhd2FpdCBmcy5yZWFscGF0aChgJHtfX2Rpcm5hbWV9L2J1aWx0LWluL2Vycm9yc2ApXG4gICAgfSBlbHNlIGlmIChhY3Rpb24pIHtcbiAgICAgIGlmICghY29udHJvbGxlcikgY29udHJvbGxlciA9IFwiX3Jvb3RcIlxuXG4gICAgICBjb250cm9sbGVyUGF0aCA9IGAke3RoaXMuY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKX0vc3JjL3JvdXRlcy8ke2NvbnRyb2xsZXJ9L2NvbnRyb2xsZXIuanNgXG4gICAgICB2aWV3UGF0aCA9IGAke3RoaXMuY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKX0vc3JjL3JvdXRlcy8ke2NvbnRyb2xsZXJ9YFxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1hdGNoZWQgdGhlIHJvdXRlIGJ1dCBkaWRuJ3Qga25vdyB3aGF0IHRvIGRvIHdpdGggaXQ6ICR7cmF3UGF0aH0gKGFjdGlvbjogJHthY3Rpb259LCBjb250cm9sbGVyOiAke2NvbnRyb2xsZXJ9LCBwYXJhbXM6ICR7SlNPTi5zdHJpbmdpZnkodGhpcy5wYXJhbXMpfSlgKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXJDbGFzcyA9IGF3YWl0IHRoaXMucmVzb2x2ZUNvbnRyb2xsZXJDbGFzcyh7Y29udHJvbGxlclBhdGh9KVxuICAgIGNvbnN0IGNvbnRyb2xsZXJSZXF1ZXN0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5yZXF1ZXN0KVxuICAgIGNvbnN0IGNvbnRyb2xsZXJJbnN0YW5jZSA9IG5ldyBjb250cm9sbGVyQ2xhc3Moe1xuICAgICAgYWN0aW9uLFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgY29udHJvbGxlcixcbiAgICAgIHBhcmFtczogdGhpcy5wYXJhbXMsXG4gICAgICByZXF1ZXN0OiBjb250cm9sbGVyUmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlOiB0aGlzLnJlc3BvbnNlLFxuICAgICAgdmlld1BhdGhcbiAgICB9KVxuXG4gICAgaWYgKCEoYWN0aW9uIGluIGNvbnRyb2xsZXJJbnN0YW5jZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBhY3Rpb24gb24gY29udHJvbGxlcjogJHtjb250cm9sbGVyfSMke2FjdGlvbn1gKVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGlvbkhhbmRsZXJzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoY29udHJvbGxlckluc3RhbmNlKSlcblxuICAgIGNvbnN0IGxvZ01ldGhvZCA9IHRoaXMuX2xvZ01ldGhvZCgpXG5cbiAgICB0aGlzLl9zZXRDb21wbGV0ZWRMb2dNZXRhZGF0YSh7Y29udHJvbGxlckNsYXNzLCBsb2dNZXRob2R9KVxuICAgIGF3YWl0IHRoaXMuX2xvZ0FjdGlvblN0YXJ0KHthY3Rpb24sIGNvbnRyb2xsZXJDbGFzcywgbG9nTWV0aG9kfSlcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB0ZW5hbnQgPSBza2lwVGVuYW50UmVzb2x1dGlvbiB8fCAhdGhpcy5jb25maWd1cmF0aW9uLmdldFRlbmFudFJlc29sdmVyKClcbiAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgOiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGAke2NvbnRyb2xsZXJDbGFzcy5uYW1lfS4ke2FjdGlvbn0gdGVuYW50IHJlc29sdXRpb25gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50KHtcbiAgICAgICAgICAgICAgcGFyYW1zOiB7Li4udGhpcy5xdWVyeVBhcmFtZXRlcnMoKSwgLi4udGhpcy5wYXJhbXN9LFxuICAgICAgICAgICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QsXG4gICAgICAgICAgICAgIHJlc3BvbnNlOiB0aGlzLnJlc3BvbnNlXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJ1bkFjdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcnVuQ29udHJvbGxlckFjdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGFiaWxpdHkgPSBza2lwQWJpbGl0eVJlc29sdXRpb25cbiAgICAgICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICAgICAgOiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZUFiaWxpdHkoe1xuICAgICAgICAgICAgICAgICAgcGFyYW1zOiB0aGlzLnBhcmFtcyxcbiAgICAgICAgICAgICAgICAgIHJlcXVlc3Q6IHRoaXMucmVxdWVzdCxcbiAgICAgICAgICAgICAgICAgIHJlc3BvbnNlOiB0aGlzLnJlc3BvbnNlXG4gICAgICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fbWVhc3VyZUNvbnRyb2xsZXIoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGF3YWl0IGNvbnRyb2xsZXJJbnN0YW5jZS5fcnVuQmVmb3JlQ2FsbGJhY2tzKClcbiAgICAgICAgICAgICAgICBhd2FpdCBhY3Rpb25IYW5kbGVyc1thY3Rpb25dKClcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHNraXBDb250cm9sbGVyQ29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgIGF3YWl0IHJ1bkNvbnRyb2xsZXJBY3Rpb24oKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGAke2NvbnRyb2xsZXJDbGFzcy5uYW1lfS4ke2FjdGlvbn1gfSwgcnVuQ29udHJvbGxlckFjdGlvbilcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFyb3VuZEFjdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRBcm91bmRBY3Rpb24/LigpXG5cbiAgICAgIGlmIChhcm91bmRBY3Rpb24pIHtcbiAgICAgICAgYXdhaXQgYXJvdW5kQWN0aW9uKHtyZXF1ZXN0OiB0aGlzLnJlcXVlc3QsIHJlc3BvbnNlOiB0aGlzLnJlc3BvbnNlLCBuZXh0OiBydW5BY3Rpb259KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgcnVuQWN0aW9uKClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZW5zdXJlZEVycm9yID0gZW5zdXJlRXJyb3IoZXJyb3IpXG4gICAgICBjb25zdCBlcnJvckNvbnRleHQgPSB7XG4gICAgICAgIGFjdGlvbixcbiAgICAgICAgY29udHJvbGxlcixcbiAgICAgICAgaHR0cE1ldGhvZDogdGhpcy5yZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgICAgcGF0aDogdGhpcy5yZXF1ZXN0LnBhdGgoKSxcbiAgICAgICAgc3RhZ2U6IFwiY29udHJvbGxlci1hY3Rpb25cIlxuICAgICAgfVxuXG4gICAgICBjb25zdCBlcnJvcldpdGhDb250ZXh0ID0gLyoqIEB0eXBlIHt7dmVsb2Npb3VzQ29udGV4dD86IG9iamVjdH19ICovIChlbnN1cmVkRXJyb3IpXG5cbiAgICAgIGVycm9yV2l0aENvbnRleHQudmVsb2Npb3VzQ29udGV4dCA9IHtcbiAgICAgICAgLi4uKGVycm9yV2l0aENvbnRleHQudmVsb2Npb3VzQ29udGV4dCB8fCB7fSksXG4gICAgICAgIGNvbnRyb2xsZXJBY3Rpb246IGVycm9yQ29udGV4dFxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlbnN1cmVkRXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29udHJvbGxlclBhdGggLSBDb250cm9sbGVyIGltcG9ydCBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vY29udHJvbGxlci5qc1wiKS5kZWZhdWx0Pn0gLSBUaGUgcmVzb2x2ZWQgY29udHJvbGxlciBjbGFzcy5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVDb250cm9sbGVyQ2xhc3Moe2NvbnRyb2xsZXJQYXRofSkge1xuICAgIGlmICh0aGlzLnJvdXRlSG9va0NvbnRyb2xsZXJDbGFzcykgcmV0dXJuIHRoaXMucm91dGVIb29rQ29udHJvbGxlckNsYXNzXG5cbiAgICBjb25zdCBjb250cm9sbGVySW1wb3J0U3BlY2lmaWVyID0gdG9JbXBvcnRTcGVjaWZpZXIoY29udHJvbGxlclBhdGgpXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSAqLyAoKGF3YWl0IGltcG9ydChjb250cm9sbGVySW1wb3J0U3BlY2lmaWVyKSkuZGVmYXVsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoIHBhdGggd2l0aCByb3V0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLXJvdXRlLmpzXCIpLmRlZmF1bHR9IHJvdXRlIC0gUm91dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gUGF0aC5cbiAgICogQHJldHVybnMge3tyZXN0UGF0aDogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBSRVNUIHBhdGggbWV0YWRhdGEgZm9yIHRoaXMgcm91dGUuXG4gICAqL1xuICBtYXRjaFBhdGhXaXRoUm91dGVzKHJvdXRlLCBwYXRoKSB7XG4gICAgY29uc3QgcGF0aFdpdGhvdXRTbGFzaCA9IHBhdGgucmVwbGFjZSgvXlxcLy8sIFwiXCIpLnNwbGl0KFwiP1wiKVswXVxuXG4gICAgZm9yIChjb25zdCBzdWJSb3V0ZSBvZiByb3V0ZS5yb3V0ZXMpIHtcbiAgICAgIGNvbnN0IHBhcmFtc1NuYXBzaG90ID0gey4uLnRoaXMucGFyYW1zfVxuICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzdWJSb3V0ZS5tYXRjaFdpdGhQYXRoKHtcbiAgICAgICAgcGFyYW1zOiB0aGlzLnBhcmFtcyxcbiAgICAgICAgcGF0aDogcGF0aFdpdGhvdXRTbGFzaCxcbiAgICAgICAgcmVxdWVzdDogdGhpcy5yZXF1ZXN0XG4gICAgICB9KVxuXG4gICAgICBpZiAoIW1hdGNoUmVzdWx0KSB7XG4gICAgICAgIHRoaXMucGFyYW1zID0gcGFyYW1zU25hcHNob3RcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3Qge3Jlc3RQYXRofSA9IG1hdGNoUmVzdWx0XG5cbiAgICAgIGlmIChyZXN0UGF0aCkge1xuICAgICAgICBjb25zdCByZWN1cnNpdmVNYXRjaCA9IHRoaXMubWF0Y2hQYXRoV2l0aFJvdXRlcyhzdWJSb3V0ZSwgcmVzdFBhdGgpXG5cbiAgICAgICAgaWYgKHJlY3Vyc2l2ZU1hdGNoKSB7XG4gICAgICAgICAgcmV0dXJuIHJlY3Vyc2l2ZU1hdGNoXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnBhcmFtcyA9IHBhcmFtc1NuYXBzaG90XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBtYXRjaFJlc3VsdFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgcm91dGUgcmVzb2x2ZXIgaG9va3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjdXJyZW50UGF0aCAtIFJlcXVlc3QgcGF0aCB3aXRob3V0IHF1ZXJ5IHN0cmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBSZXNvbHZlciBob29rIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMuaGFzTWF0Y2hpbmdDdXN0b21Sb3V0ZV0gLSBUcnVlIHdoZW4gdGhlIHBhdGggbWF0Y2hlZCBhbiBleHBsaWNpdCBjdXN0b20gcm91dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUm91dGVSZXNvbHZlckhvb2tSZXN1bHQgfCBudWxsPn0gLSBNYXRjaGVkIGFjdGlvbi9jb250cm9sbGVyIGZyb20gaG9va3MuXG4gICAqL1xuICBhc3luYyByZXNvbHZlUm91dGVSZXNvbHZlckhvb2tzKGN1cnJlbnRQYXRoLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7aGFzTWF0Y2hpbmdDdXN0b21Sb3V0ZSA9IGZhbHNlfSA9IG9wdGlvbnNcblxuICAgIGNvbnN0IGhvb2tzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFJvdXRlUmVzb2x2ZXJIb29rcz8uKCkgfHwgW11cblxuICAgIGZvciAoY29uc3QgaG9vayBvZiBob29rcykge1xuICAgICAgY29uc3QgaG9va1Jlc3VsdCA9IGF3YWl0IGhvb2soe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGN1cnJlbnRQYXRoLFxuICAgICAgICBoYXNNYXRjaGluZ0N1c3RvbVJvdXRlLFxuICAgICAgICBwYXJhbXM6IHRoaXMucGFyYW1zLFxuICAgICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QsXG4gICAgICAgIHJlc29sdmVyOiB0aGlzLFxuICAgICAgICByZXNwb25zZTogdGhpcy5yZXNwb25zZVxuICAgICAgfSlcblxuICAgICAgaWYgKCFob29rUmVzdWx0KSBjb250aW51ZVxuXG4gICAgICBpZiAodHlwZW9mIGhvb2tSZXN1bHQuYWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGhvb2tSZXN1bHQuYWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCByb3V0ZSByZXNvbHZlciBob29rIGFjdGlvbiB0byBiZSBhIHN0cmluZywgZ290OiAke2hvb2tSZXN1bHQuYWN0aW9ufWApXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgaG9va1Jlc3VsdC5jb250cm9sbGVyICE9PSBcInN0cmluZ1wiIHx8IGhvb2tSZXN1bHQuY29udHJvbGxlci5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcm91dGUgcmVzb2x2ZXIgaG9vayBjb250cm9sbGVyIHRvIGJlIGEgc3RyaW5nLCBnb3Q6ICR7aG9va1Jlc3VsdC5jb250cm9sbGVyfWApXG4gICAgICB9XG5cbiAgICAgIGlmIChob29rUmVzdWx0LnBhcmFtcyAmJiB0eXBlb2YgaG9va1Jlc3VsdC5wYXJhbXMgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCByb3V0ZSByZXNvbHZlciBob29rIHBhcmFtcyB0byBiZSBhbiBvYmplY3QsIGdvdDogJHtob29rUmVzdWx0LnBhcmFtc31gKVxuICAgICAgfVxuXG4gICAgICBpZiAoaG9va1Jlc3VsdC5jb250cm9sbGVyQ2xhc3MgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaG9va1Jlc3VsdC5jb250cm9sbGVyQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHJvdXRlIHJlc29sdmVyIGhvb2sgY29udHJvbGxlckNsYXNzIHRvIGJlIGEgY2xhc3MvZnVuY3Rpb24gd2hlbiBwcm92aWRlZCwgZ290OiAke2hvb2tSZXN1bHQuY29udHJvbGxlckNsYXNzfWApXG4gICAgICB9XG5cbiAgICAgIGlmIChob29rUmVzdWx0LmNvbnRyb2xsZXJQYXRoICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGhvb2tSZXN1bHQuY29udHJvbGxlclBhdGggIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCByb3V0ZSByZXNvbHZlciBob29rIGNvbnRyb2xsZXJQYXRoIHRvIGJlIGEgc3RyaW5nIHdoZW4gcHJvdmlkZWQsIGdvdDogJHtob29rUmVzdWx0LmNvbnRyb2xsZXJQYXRofWApXG4gICAgICB9XG5cbiAgICAgIGlmIChob29rUmVzdWx0LnNraXBDb250cm9sbGVyQ29ubmVjdGlvbnMgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaG9va1Jlc3VsdC5za2lwQ29udHJvbGxlckNvbm5lY3Rpb25zICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHJvdXRlIHJlc29sdmVyIGhvb2sgc2tpcENvbnRyb2xsZXJDb25uZWN0aW9ucyB0byBiZSBhIGJvb2xlYW4gd2hlbiBwcm92aWRlZCwgZ290OiAke2hvb2tSZXN1bHQuc2tpcENvbnRyb2xsZXJDb25uZWN0aW9uc31gKVxuICAgICAgfVxuXG4gICAgICBpZiAoaG9va1Jlc3VsdC5za2lwQWJpbGl0eVJlc29sdXRpb24gIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaG9va1Jlc3VsdC5za2lwQWJpbGl0eVJlc29sdXRpb24gIT09IFwiYm9vbGVhblwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcm91dGUgcmVzb2x2ZXIgaG9vayBza2lwQWJpbGl0eVJlc29sdXRpb24gdG8gYmUgYSBib29sZWFuIHdoZW4gcHJvdmlkZWQsIGdvdDogJHtob29rUmVzdWx0LnNraXBBYmlsaXR5UmVzb2x1dGlvbn1gKVxuICAgICAgfVxuXG4gICAgICBpZiAoaG9va1Jlc3VsdC5za2lwVGVuYW50UmVzb2x1dGlvbiAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBob29rUmVzdWx0LnNraXBUZW5hbnRSZXNvbHV0aW9uICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHJvdXRlIHJlc29sdmVyIGhvb2sgc2tpcFRlbmFudFJlc29sdXRpb24gdG8gYmUgYSBib29sZWFuIHdoZW4gcHJvdmlkZWQsIGdvdDogJHtob29rUmVzdWx0LnNraXBUZW5hbnRSZXNvbHV0aW9ufWApXG4gICAgICB9XG5cbiAgICAgIGlmIChob29rUmVzdWx0LnZpZXdQYXRoICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGhvb2tSZXN1bHQudmlld1BhdGggIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCByb3V0ZSByZXNvbHZlciBob29rIHZpZXdQYXRoIHRvIGJlIGEgc3RyaW5nIHdoZW4gcHJvdmlkZWQsIGdvdDogJHtob29rUmVzdWx0LnZpZXdQYXRofWApXG4gICAgICB9XG5cbiAgICAgIGlmIChob29rUmVzdWx0LnBhcmFtcykge1xuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMucGFyYW1zLCBob29rUmVzdWx0LnBhcmFtcylcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGhvb2tSZXN1bHRcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9nIGFjdGlvbiBzdGFydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29udHJvbGxlckNsYXNzIC0gQ29udHJvbGxlciBjbGFzcy5cbiAgICogQHBhcmFtIHtcImRlYnVnXCIgfCBcImluZm9cIn0gYXJncy5sb2dNZXRob2QgLSBMb2dnZXIgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2xvZ0FjdGlvblN0YXJ0KHthY3Rpb24sIGNvbnRyb2xsZXJDbGFzcywgbG9nTWV0aG9kfSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLnJlcXVlc3RcbiAgICBjb25zdCB0aW1lc3RhbXAgPSB0aGlzLl9mb3JtYXRUaW1lc3RhbXAobmV3IERhdGUoKSlcbiAgICBjb25zdCByZW1vdGVBZGRyZXNzID0gcmVxdWVzdC5yZW1vdGVBZGRyZXNzKCkgfHwgXCJ1bmtub3duXCJcbiAgICBjb25zdCByZWRhY3RvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG5cbiAgICB0aGlzLmxvZ1NlbnNpdGl2ZVZhbHVlcyA9IHJlZGFjdG9yLnNlbnNpdGl2ZVZhbHVlcyh0aGlzLnBhcmFtcywgdGhpcy5sb2dTZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcblxuICAgIGlmIChyZXF1ZXN0VGltaW5nKSByZXF1ZXN0VGltaW5nLnJlZ2lzdGVyTG9nU2Vuc2l0aXZlVmFsdWVzKHRoaXMubG9nU2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgY29uc3QgbG9nZ2VkUGFyYW1zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLl9zYW5pdGl6ZVBhcmFtc0ZvckxvZ2dpbmcodGhpcy5wYXJhbXMpKVxuXG4gICAgZGVsZXRlIGxvZ2dlZFBhcmFtcy5hY3Rpb25cbiAgICBkZWxldGUgbG9nZ2VkUGFyYW1zLmNvbnRyb2xsZXJcblxuICAgIGNvbnN0IGNvbnRyb2xsZXJMb2dnZXIgPSBuZXcgTG9nZ2VyKGNvbnRyb2xsZXJDbGFzcy5uYW1lLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcblxuICAgIGNvbnN0IGxvZ2dlZFBhdGggPSByZWRhY3Rvci5yZWRhY3RQYXRoKHJlcXVlc3QucGF0aCgpLCB0aGlzLmxvZ1NlbnNpdGl2ZVZhbHVlcylcblxuICAgIGF3YWl0IGNvbnRyb2xsZXJMb2dnZXJbbG9nTWV0aG9kXSgoKSA9PiBgU3RhcnRlZCAke3JlcXVlc3QuaHR0cE1ldGhvZCgpfSBcIiR7bG9nZ2VkUGF0aH1cIiBmb3IgJHtyZW1vdGVBZGRyZXNzfSBhdCAke3RpbWVzdGFtcH1gKVxuICAgIGF3YWl0IGNvbnRyb2xsZXJMb2dnZXJbbG9nTWV0aG9kXSgoKSA9PiBgUHJvY2Vzc2luZyBieSAke2NvbnRyb2xsZXJDbGFzcy5uYW1lfSMke2FjdGlvbn1gKVxuICAgIGF3YWl0IGNvbnRyb2xsZXJMb2dnZXJbbG9nTWV0aG9kXSgoKSA9PiBbYCAgUGFyYW1ldGVyczpgLCBsb2dnZWRQYXJhbXNdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9nIG1ldGhvZC5cbiAgICogQHJldHVybnMge1wiZGVidWdcIiB8IFwiaW5mb1wifSAtIFJlcXVlc3QgbG9nIG1ldGhvZC5cbiAgICovXG4gIF9sb2dNZXRob2QoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIiA/IFwiZGVidWdcIiA6IFwiaW5mb1wiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtZWFzdXJlIGNvbnRyb2xsZXIuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBtZWFzdXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfbWVhc3VyZUNvbnRyb2xsZXIoY2FsbGJhY2spIHtcbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcblxuICAgIHJldHVybiByZXF1ZXN0VGltaW5nXG4gICAgICA/IGF3YWl0IHJlcXVlc3RUaW1pbmcubWVhc3VyZShcImNvbnRyb2xsZXJcIiwgY2FsbGJhY2spXG4gICAgICA6IGF3YWl0IGNhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb21wbGV0ZWQgbG9nIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29udHJvbGxlckNsYXNzIC0gQ29udHJvbGxlciBjbGFzcy5cbiAgICogQHBhcmFtIHtcImRlYnVnXCIgfCBcImluZm9cIn0gYXJncy5sb2dNZXRob2QgLSBMb2dnZXIgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2V0Q29tcGxldGVkTG9nTWV0YWRhdGEoe2NvbnRyb2xsZXJDbGFzcywgbG9nTWV0aG9kfSkge1xuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuXG4gICAgaWYgKCFyZXF1ZXN0VGltaW5nKSByZXR1cm5cblxuICAgIHJlcXVlc3RUaW1pbmcuY29tcGxldGVkTG9nU3ViamVjdCA9IGNvbnRyb2xsZXJDbGFzcy5uYW1lXG4gICAgcmVxdWVzdFRpbWluZy5jb21wbGV0ZWRMb2dNZXRob2QgPSBsb2dNZXRob2RcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7RGF0ZX0gZGF0ZSAtIERhdGUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRpbWVzdGFtcC5cbiAgICovXG4gIF9mb3JtYXRUaW1lc3RhbXAoZGF0ZSkge1xuICAgIC8qKlxuICAgICAqIFBhZC5cbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbnVtIC0gTnVtLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHBhZC5cbiAgICAgKi9cbiAgICBjb25zdCBwYWQgPSAobnVtKSA9PiBTdHJpbmcobnVtKS5wYWRTdGFydCgyLCBcIjBcIilcbiAgICBjb25zdCB5ZWFyID0gZGF0ZS5nZXRGdWxsWWVhcigpXG4gICAgY29uc3QgbW9udGggPSBwYWQoZGF0ZS5nZXRNb250aCgpICsgMSlcbiAgICBjb25zdCBkYXkgPSBwYWQoZGF0ZS5nZXREYXRlKCkpXG4gICAgY29uc3QgaG91cnMgPSBwYWQoZGF0ZS5nZXRIb3VycygpKVxuICAgIGNvbnN0IG1pbnV0ZXMgPSBwYWQoZGF0ZS5nZXRNaW51dGVzKCkpXG4gICAgY29uc3Qgc2Vjb25kcyA9IHBhZChkYXRlLmdldFNlY29uZHMoKSlcbiAgICBjb25zdCBvZmZzZXRNaW51dGVzID0gZGF0ZS5nZXRUaW1lem9uZU9mZnNldCgpXG4gICAgY29uc3Qgb2Zmc2V0U2lnbiA9IG9mZnNldE1pbnV0ZXMgPiAwID8gXCItXCIgOiBcIitcIlxuICAgIGNvbnN0IG9mZnNldFRvdGFsTWludXRlcyA9IE1hdGguYWJzKG9mZnNldE1pbnV0ZXMpXG4gICAgY29uc3Qgb2Zmc2V0SG91cnMgPSBwYWQoTWF0aC5mbG9vcihvZmZzZXRUb3RhbE1pbnV0ZXMgLyA2MCkpXG4gICAgY29uc3Qgb2Zmc2V0UmVtYWluaW5nTWludXRlcyA9IHBhZChvZmZzZXRUb3RhbE1pbnV0ZXMgJSA2MClcblxuICAgIHJldHVybiBgJHt5ZWFyfS0ke21vbnRofS0ke2RheX0gJHtob3Vyc306JHttaW51dGVzfToke3NlY29uZHN9ICR7b2Zmc2V0U2lnbn0ke29mZnNldEhvdXJzfSR7b2Zmc2V0UmVtYWluaW5nTWludXRlc31gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzYW5pdGl6ZSBwYXJhbXMgZm9yIGxvZ2dpbmcuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIHNhbml0aXplIHBhcmFtcyBmb3IgbG9nZ2luZy5cbiAgICovXG4gIF9zYW5pdGl6ZVBhcmFtc0ZvckxvZ2dpbmcodmFsdWUpIHtcbiAgICBjb25zdCBwcmVwYXJlZFZhbHVlID0gdGhpcy5fcHJlcGFyZVBhcmFtc0ZvckxvZ2dpbmcodmFsdWUpXG5cbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKCkucmVkYWN0U3RydWN0dXJlZChwcmVwYXJlZFZhbHVlLCB0aGlzLmxvZ1NlbnNpdGl2ZVZhbHVlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVzZXJ2ZXMgdXNlZnVsIHVwbG9hZCBtZXRhZGF0YSBiZWZvcmUgZ2VuZXJpYyBzdHJ1Y3R1cmVkIHJlZGFjdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTG9nZ2luZy1zYWZlIHN0cnVjdHVyYWwgY29weS5cbiAgICovXG4gIF9wcmVwYXJlUGFyYW1zRm9yTG9nZ2luZyh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFVwbG9hZGVkRmlsZSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2xhc3NOYW1lOiB2YWx1ZS5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgICBmaWxlbmFtZTogdmFsdWUuZmlsZW5hbWUoKSxcbiAgICAgICAgc2l6ZTogdmFsdWUuc2l6ZSgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUubWFwKChpdGVtKSA9PiB0aGlzLl9wcmVwYXJlUGFyYW1zRm9yTG9nZ2luZyhpdGVtKSlcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAvKipcbiAgICAgICAqIFJlc3VsdC5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZSkpIHtcbiAgICAgICAgcmVzdWx0W2tleV0gPSB0aGlzLl9wcmVwYXJlUGFyYW1zRm9yTG9nZ2luZyh2YWx1ZVtrZXldKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cbn1cbiJdfQ==