// @ts-check
import ejs from "ejs";
import { incorporate } from "incorporator";
import * as inflection from "inflection";
import Logger from "./logger.js";
import Cookie from "./http-server/cookie.js";
import ParamsToObject from "./http-server/client/params-to-object.js";
import path from "node:path";
import restArgsError from "./utils/rest-args-error.js";
import querystring from "querystring";
import { serializeFrontendModelTransportValue } from "./frontend-models/transport-serialization.js";
export default class VelociousController {
    /** @type {Array<string> | undefined} */
    static _beforeActions = undefined;
    /**
     * Runs before action.
     * @param {string} methodName - Method name.
     * @returns {void} - No return value.
     */
    static beforeAction(methodName) {
        if (!this._beforeActions) {
            /**
             * Stores the before actions value.
             * @type {Array<string>}  */
            this._beforeActions = [];
        }
        this._beforeActions.push(methodName);
    }
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.action - Action.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.controller - Controller.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Parameters object.
     * @param {import("./http-server/client/request.js").default} args.request - Request object.
     * @param {import("./http-server/client/response.js").default} args.response - Response object.
     * @param {string} args.viewPath - View path.
     */
    constructor({ action, configuration, controller, params, request, response, viewPath }) {
        if (!action)
            throw new Error("No action given");
        if (!configuration)
            throw new Error("No configuration given");
        if (!controller)
            throw new Error("No controller given");
        if (!params)
            throw new Error("No params given");
        if (!request)
            throw new Error("No request given");
        if (!response)
            throw new Error("No response given");
        if (!viewPath)
            throw new Error("No viewPath given");
        this._action = action;
        this._controller = controller;
        this._configuration = configuration;
        this.logger = new Logger(this);
        this._params = params;
        this._request = request;
        this._response = response;
        this.viewParams = {};
        this._viewPath = viewPath;
    }
    /**
     * Runs get action.
     * @returns {string} - The action.
     */
    getAction() { return this._action; }
    /**
     * Runs get configuration.
     * @returns {import("./configuration.js").default} - The configuration.
     */
    getConfiguration() { return this._configuration; }
    /**
     * Runs get params.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The params.
     */
    getParams() { return this._params; }
    /**
     * Runs get request.
     * @returns {import("./http-server/client/request.js").default} - The request.
     */
    getRequest() { return this._request; }
    /**
     * Runs transport serialization options.
     * @returns {import("./frontend-models/transport-serialization.js").FrontendModelTransportSerializationOptions} - Serialization options.
     */
    transportSerializationOptions() {
        const configuration = this.getConfiguration();
        return {
            timeZone: configuration.getEnvironmentHandler().getTimeZone(configuration)
        };
    }
    /**
     * Runs set cookie.
     * @param {string} name - Cookie name.
     * @param {ReturnType<typeof JSON.parse>} value - Cookie value.
     * @param {object} [args] - Options object.
     * @param {string} [args.domain] - Domain.
     * @param {Date} [args.expires] - Expires date.
     * @param {boolean} [args.httpOnly] - HttpOnly flag.
     * @param {number} [args.maxAge] - Max-Age in seconds.
     * @param {string} [args.path] - Path.
     * @param {boolean} [args.secure] - Secure flag.
     * @param {"Lax" | "Strict" | "None"} [args.sameSite] - SameSite value.
     * @param {boolean} [args.encrypted] - Whether to encrypt the cookie value.
     * @returns {Cookie} - Cookie instance.
     */
    setCookie(name, value, args = {}) {
        const { encrypted = false, ...options } = args;
        /**
         * Types the following value.
         * @type {string} */
        let cookieValue;
        if (encrypted) {
            const secret = this.getConfiguration().getCookieSecret();
            if (!secret)
                throw new Error("Missing cookie secret for encrypted cookie");
            cookieValue = Cookie.encryptValue(value, secret);
        }
        else {
            cookieValue = String(value ?? "");
        }
        const cookie = new Cookie({ name, value: cookieValue, options, encrypted });
        this._response.addHeader("Set-Cookie", cookie.toHeader());
        return cookie;
    }
    /**
     * Runs get cookies.
     * @returns {Cookie[]} - Cookies from the request.
     */
    getCookies() {
        if (!this._cookies) {
            const secret = this.getConfiguration().getCookieSecret();
            const headerValue = this._request.header("cookie");
            this._cookies = Cookie.parseHeader(headerValue, secret);
        }
        return this._cookies;
    }
    /**
     * Runs get controller class.
     * @private
     * @returns {typeof VelociousController} - The controller class.
     */
    _getControllerClass() {
        const controllerClass = /** @type {typeof VelociousController} */ (this.constructor);
        return controllerClass;
    }
    async _runBeforeCallbacks() {
        await this.logger.debug("_runBeforeCallbacks");
        let currentControllerClass = this._getControllerClass();
        while (currentControllerClass) {
            await this.logger.debug(`Running callbacks for ${currentControllerClass.name}`);
            const beforeActions = currentControllerClass._beforeActions;
            if (beforeActions) {
                const controllerPrototype = /** @type {Record<string, ((...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | undefined>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(currentControllerClass.prototype));
                for (const beforeActionName of beforeActions) {
                    const beforeAction = controllerPrototype[beforeActionName];
                    if (!beforeAction)
                        throw new Error(`No such before action: ${beforeActionName}`);
                    const boundBeforeAction = beforeAction.bind(this);
                    await boundBeforeAction();
                }
            }
            currentControllerClass = Object.getPrototypeOf(currentControllerClass);
            if (!currentControllerClass?.name?.endsWith("Controller"))
                break;
        }
        await this.logger.debug("After runBeforeCallbacks");
    }
    /**
     * Runs params.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The params.
     */
    params() {
        // Merge query parameters so controllers can read them via params()
        const mergedParams = { ...this.queryParameters(), ...this._params };
        if (!mergedParams.controller)
            mergedParams.controller = this._controller;
        return mergedParams;
    }
    /**
     * Runs query parameters.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The query parameters.
     */
    queryParameters() {
        const query = this._request.path().split("?")[1];
        if (!query)
            return {};
        try {
            /**
             * Unparsed params.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const unparsedParams = querystring.parse(query);
            const paramsToObject = new ParamsToObject(unparsedParams);
            return paramsToObject.toObject();
        }
        catch (error) {
            const ensuredError = /** @type {Error & {velociousContext?: Record<string, ReturnType<typeof JSON.parse>>}} */ (error);
            ensuredError.velociousContext = {
                ...(ensuredError.velociousContext || {}),
                requestParsing: {
                    httpMethod: this._request.httpMethod(),
                    parameterKeys: Object.keys(querystring.parse(query)),
                    path: this._request.path(),
                    queryPreview: query.length > 300 ? `${query.slice(0, 300)}...` : query,
                    stage: "query-parameters"
                }
            };
            throw ensuredError;
        }
    }
    /**
     * Runs render.
     * @param {object} [args] - Options object.
     * @param {object} [args.json] - Json.
     * @param {number | string} [args.status] - Status.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async render({ json, status, ...restArgs } = {}) {
        restArgsError(restArgs);
        // Apply the status BEFORE delegating to renderJsonArg/renderView so
        // `render({json: {...}, status: 422})` produces a 422 response with
        // a JSON body. The previous order short-circuited via `return
        // this.renderJsonArg(json)` and silently dropped the status arg.
        if (status) {
            this._response.setStatus(status);
        }
        if (json) {
            return this.renderJsonArg(json);
        }
        return await this.renderView();
    }
    /**
     * Runs render json arg.
     * @param {object} json - JSON payload.
     * @returns {void} - Sets the response JSON payload.
     */
    renderJsonArg(json) {
        return this._measureViewRender(() => {
            const body = JSON.stringify(serializeFrontendModelTransportValue(json, this.transportSerializationOptions()));
            this._response.setHeader("Content-Type", "application/json; charset=UTF-8");
            this._response.setBody(body);
        });
    }
    /**
     * Runs render view.
     * @returns {Promise<void>} - Resolves when complete.
     */
    renderView() {
        const requestTiming = this.getConfiguration().getCurrentRequestTiming();
        return requestTiming
            ? requestTiming.measure("views", async () => await this._renderViewActual())
            : this._renderViewActual();
    }
    /**
     * Runs render view actual.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _renderViewActual() {
        return new Promise((resolve, reject) => {
            const viewPath = `${this._viewPath}/${inflection.dasherize(inflection.underscore(this._action))}.ejs`;
            const actualViewParams = incorporate({ controller: this }, this.viewParams);
            ejs.renderFile(viewPath, actualViewParams, {}, (err, str) => {
                if (err) {
                    const renderError = /** @type {Error & {code?: string}} */ (err);
                    if (renderError.code === "ENOENT") {
                        this.logger.warn(`Missing view file: ${viewPath}`);
                        if (this._response.getStatusCode() === 200) {
                            this._response.setStatus("internal-server-error");
                        }
                        this._response.setHeader("Content-Type", "text/plain; charset=UTF-8");
                        this._response.setBody(`Missing view file: ${viewPath}`);
                        resolve(undefined);
                    }
                    else {
                        reject(renderError);
                    }
                }
                else {
                    this._response.setHeader("Content-Type", "text/html; charset=UTF-8");
                    this._response.setBody(str);
                    resolve(undefined);
                }
            });
        });
    }
    /**
     * Runs render text.
     * @returns {void} - No return value.
     */
    renderText() {
        throw new Error("renderText stub");
    }
    /**
     * Streams a file response from disk without loading the full file into controller memory.
     * @param {string} filePath - File path.
     * @param {object} [args] - Options object.
     * @param {string} [args.contentType] - Content type.
     * @param {number | string} [args.status] - Status.
     * @param {(result: "completed" | "aborted") => void | Promise<void>} [args.onFinished] - Called once after file delivery completes or aborts.
     * @returns {void} - No return value.
     */
    sendFile(filePath, args = {}) {
        this._measureViewRender(() => {
            const { contentType, onFinished, status, ...restArgs } = args;
            restArgsError(restArgs);
            if (typeof filePath !== "string" || filePath.length < 1) {
                throw new Error(`Expected file path to be a non-empty string, got: ${String(filePath)}`);
            }
            if (onFinished !== undefined && typeof onFinished !== "function") {
                throw new Error(`Expected onFinished to be a function, got: ${typeof onFinished}`);
            }
            const detectedContentType = contentType || this.sendFileContentType(filePath);
            if (detectedContentType) {
                this._response.setHeader("Content-Type", detectedContentType);
            }
            if (status) {
                this._response.setStatus(status);
            }
            this._response.setFilePath(filePath, onFinished || null);
        });
    }
    /**
     * Runs measure view render.
     * @template T
     * @param {() => T} callback - Callback to measure.
     * @returns {T} - Callback result.
     */
    _measureViewRender(callback) {
        const requestTiming = this.getConfiguration().getCurrentRequestTiming();
        return requestTiming
            ? requestTiming.measureSync("views", callback)
            : callback();
    }
    /**
     * Runs send file content type.
     * @param {string} filePath - File path.
     * @returns {string} - Content type value.
     */
    sendFileContentType(filePath) {
        const extension = path.extname(filePath).toLowerCase();
        if (extension === ".wasm")
            return "application/wasm";
        if (extension === ".js")
            return "text/javascript; charset=UTF-8";
        if (extension === ".json")
            return "application/json; charset=UTF-8";
        if (extension === ".css")
            return "text/css; charset=UTF-8";
        if (extension === ".html")
            return "text/html; charset=UTF-8";
        if (extension === ".txt")
            return "text/plain; charset=UTF-8";
        if (extension === ".svg")
            return "image/svg+xml";
        if (extension === ".png")
            return "image/png";
        if (extension === ".jpg" || extension === ".jpeg")
            return "image/jpeg";
        if (extension === ".gif")
            return "image/gif";
        return "application/octet-stream";
    }
    /**
     * Runs current ability.
     * @returns {import("./authorization/ability.js").default | undefined} - Current ability for request scope.
     */
    currentAbility() {
        return this.getConfiguration().getCurrentAbility();
    }
    /**
     * Runs request.
     * @returns {import("./http-server/client/request.js").default} - The request.
     */
    request() { return this._request; }
    /**
     * Runs response.
     * @returns {import("./http-server/client/response.js").default} - The response.
     */
    response() { return this._response; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEdBQUcsTUFBTSxLQUFLLENBQUE7QUFDckIsT0FBTyxFQUFDLFdBQVcsRUFBQyxNQUFNLGNBQWMsQ0FBQTtBQUN4QyxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFDaEMsT0FBTyxNQUFNLE1BQU0seUJBQXlCLENBQUE7QUFDNUMsT0FBTyxjQUFjLE1BQU0sMENBQTBDLENBQUE7QUFDckUsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8sYUFBYSxNQUFNLDRCQUE0QixDQUFBO0FBQ3RELE9BQU8sV0FBVyxNQUFNLGFBQWEsQ0FBQTtBQUNyQyxPQUFPLEVBQUMsb0NBQW9DLEVBQUMsTUFBTSw4Q0FBOEMsQ0FBQTtBQUVqRyxNQUFNLENBQUMsT0FBTyxPQUFPLG1CQUFtQjtJQUN0Qyx3Q0FBd0M7SUFDeEMsTUFBTSxDQUFDLGNBQWMsR0FBRyxTQUFTLENBQUE7SUFFakM7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxZQUFZLENBQUMsVUFBVTtRQUM1QixJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3pCOzt3Q0FFNEI7WUFDNUIsSUFBSSxDQUFDLGNBQWMsR0FBRyxFQUFFLENBQUE7UUFDMUIsQ0FBQztRQUVELElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ3RDLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBQztRQUNsRixJQUFJLENBQUMsTUFBTTtZQUFFLE1BQU0sSUFBSSxLQUFL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QUFNO1lBQUUsT0FBTyxXQUFXLENBQUE7UUFFNUMsT0FBTywwQkFBMEIsQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsY0FBYztRQUNaLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUNwRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTyxLQUFLLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQSxDQUFDLENBQUM7SUFFbEM7OztPQUdHO0lBQ0gsUUFBUSxLQUFLLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQSxDQUFDLENBQUM7Q0FDckMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGVqcyBmcm9tIFwiZWpzXCJcbmltcG9ydCB7aW5jb3Jwb3JhdGV9IGZyb20gXCJpbmNvcnBvcmF0b3JcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuL2xvZ2dlci5qc1wiXG5pbXBvcnQgQ29va2llIGZyb20gXCIuL2h0dHAtc2VydmVyL2Nvb2tpZS5qc1wiXG5pbXBvcnQgUGFyYW1zVG9PYmplY3QgZnJvbSBcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3BhcmFtcy10by1vYmplY3QuanNcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHF1ZXJ5c3RyaW5nIGZyb20gXCJxdWVyeXN0cmluZ1wiXG5pbXBvcnQge3NlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ29udHJvbGxlciB7XG4gIC8qKiBAdHlwZSB7QXJyYXk8c3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9iZWZvcmVBY3Rpb25zID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGJlZm9yZUFjdGlvbihtZXRob2ROYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9iZWZvcmVBY3Rpb25zKSB7XG4gICAgICAvKipcbiAgICAgICAqIFN0b3JlcyB0aGUgYmVmb3JlIGFjdGlvbnMgdmFsdWUuXG4gICAgICAgKiBAdHlwZSB7QXJyYXk8c3RyaW5nPn0gICovXG4gICAgICB0aGlzLl9iZWZvcmVBY3Rpb25zID0gW11cbiAgICB9XG5cbiAgICB0aGlzLl9iZWZvcmVBY3Rpb25zLnB1c2gobWV0aG9kTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY3Rpb24gLSBBY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBQYXJhbWV0ZXJzIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnZpZXdQYXRoIC0gVmlldyBwYXRoLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FjdGlvbiwgY29uZmlndXJhdGlvbiwgY29udHJvbGxlciwgcGFyYW1zLCByZXF1ZXN0LCByZXNwb25zZSwgdmlld1BhdGh9KSB7XG4gICAgaWYgKCFhY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGFjdGlvbiBnaXZlblwiKVxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBnaXZlblwiKVxuICAgIGlmICghY29udHJvbGxlcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29udHJvbGxlciBnaXZlblwiKVxuICAgIGlmICghcGFyYW1zKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBwYXJhbXMgZ2l2ZW5cIilcbiAgICBpZiAoIXJlcXVlc3QpIHRocm93IG5ldyBFcnJvcihcIk5vIHJlcXVlc3QgZ2l2ZW5cIilcbiAgICBpZiAoIXJlc3BvbnNlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyByZXNwb25zZSBnaXZlblwiKVxuICAgIGlmICghdmlld1BhdGgpIHRocm93IG5ldyBFcnJvcihcIk5vIHZpZXdQYXRoIGdpdmVuXCIpXG5cbiAgICB0aGlzLl9hY3Rpb24gPSBhY3Rpb25cbiAgICB0aGlzLl9jb250cm9sbGVyID0gY29udHJvbGxlclxuICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5fcGFyYW1zID0gcGFyYW1zXG4gICAgdGhpcy5fcmVxdWVzdCA9IHJlcXVlc3RcbiAgICB0aGlzLl9yZXNwb25zZSA9IHJlc3BvbnNlXG4gICAgdGhpcy52aWV3UGFyYW1zID0ge31cbiAgICB0aGlzLl92aWV3UGF0aCA9IHZpZXdQYXRoXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBhY3Rpb24uXG4gICAqL1xuICBnZXRBY3Rpb24oKSB7IHJldHVybiB0aGlzLl9hY3Rpb24gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fY29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBUaGUgcGFyYW1zLlxuICAgKi9cbiAgZ2V0UGFyYW1zKCkgeyByZXR1cm4gdGhpcy5fcGFyYW1zIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVxdWVzdC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gLSBUaGUgcmVxdWVzdC5cbiAgICovXG4gIGdldFJlcXVlc3QoKSB7IHJldHVybiB0aGlzLl9yZXF1ZXN0IH1cblxuICAvKipcbiAgICogUnVucyB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbHMvdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICovXG4gIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRpbWVab25lOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvb2tpZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb29raWUgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb29raWUgdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRvbWFpbl0gLSBEb21haW4uXG4gICAqIEBwYXJhbSB7RGF0ZX0gW2FyZ3MuZXhwaXJlc10gLSBFeHBpcmVzIGRhdGUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaHR0cE9ubHldIC0gSHR0cE9ubHkgZmxhZy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heEFnZV0gLSBNYXgtQWdlIGluIHNlY29uZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wYXRoXSAtIFBhdGguXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3Muc2VjdXJlXSAtIFNlY3VyZSBmbGFnLlxuICAgKiBAcGFyYW0ge1wiTGF4XCIgfCBcIlN0cmljdFwiIHwgXCJOb25lXCJ9IFthcmdzLnNhbWVTaXRlXSAtIFNhbWVTaXRlIHZhbHVlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmVuY3J5cHRlZF0gLSBXaGV0aGVyIHRvIGVuY3J5cHQgdGhlIGNvb2tpZSB2YWx1ZS5cbiAgICogQHJldHVybnMge0Nvb2tpZX0gLSBDb29raWUgaW5zdGFuY2UuXG4gICAqL1xuICBzZXRDb29raWUobmFtZSwgdmFsdWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtlbmNyeXB0ZWQgPSBmYWxzZSwgLi4ub3B0aW9uc30gPSBhcmdzXG4gICAgLyoqXG4gICAgICogVHlwZXMgdGhlIGZvbGxvd2luZyB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nfSAqL1xuICAgIGxldCBjb29raWVWYWx1ZVxuXG4gICAgaWYgKGVuY3J5cHRlZCkge1xuICAgICAgY29uc3Qgc2VjcmV0ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0Q29va2llU2VjcmV0KClcbiAgICAgIGlmICghc2VjcmV0KSB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIGNvb2tpZSBzZWNyZXQgZm9yIGVuY3J5cHRlZCBjb29raWVcIilcbiAgICAgIGNvb2tpZVZhbHVlID0gQ29va2llLmVuY3J5cHRWYWx1ZSh2YWx1ZSwgc2VjcmV0KVxuICAgIH0gZWxzZSB7XG4gICAgICBjb29raWVWYWx1ZSA9IFN0cmluZyh2YWx1ZSA/PyBcIlwiKVxuICAgIH1cblxuICAgIGNvbnN0IGNvb2tpZSA9IG5ldyBDb29raWUoe25hbWUsIHZhbHVlOiBjb29raWVWYWx1ZSwgb3B0aW9ucywgZW5jcnlwdGVkfSlcblxuICAgIHRoaXMuX3Jlc3BvbnNlLmFkZEhlYWRlcihcIlNldC1Db29raWVcIiwgY29va2llLnRvSGVhZGVyKCkpXG5cbiAgICByZXR1cm4gY29va2llXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29va2llcy5cbiAgICogQHJldHVybnMge0Nvb2tpZVtdfSAtIENvb2tpZXMgZnJvbSB0aGUgcmVxdWVzdC5cbiAgICovXG4gIGdldENvb2tpZXMoKSB7XG4gICAgaWYgKCF0aGlzLl9jb29raWVzKSB7XG4gICAgICBjb25zdCBzZWNyZXQgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRDb29raWVTZWNyZXQoKVxuICAgICAgY29uc3QgaGVhZGVyVmFsdWUgPSB0aGlzLl9yZXF1ZXN0LmhlYWRlcihcImNvb2tpZVwiKVxuXG4gICAgICB0aGlzLl9jb29raWVzID0gQ29va2llLnBhcnNlSGVhZGVyKGhlYWRlclZhbHVlLCBzZWNyZXQpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2Nvb2tpZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0NvbnRyb2xsZXJ9IC0gVGhlIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqL1xuICBfZ2V0Q29udHJvbGxlckNsYXNzKCkge1xuICAgIGNvbnN0IGNvbnRyb2xsZXJDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0NvbnRyb2xsZXJ9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuXG4gICAgcmV0dXJuIGNvbnRyb2xsZXJDbGFzc1xuICB9XG5cbiAgYXN5bmMgX3J1bkJlZm9yZUNhbGxiYWNrcygpIHtcbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZyhcIl9ydW5CZWZvcmVDYWxsYmFja3NcIilcblxuICAgIGxldCBjdXJyZW50Q29udHJvbGxlckNsYXNzID0gdGhpcy5fZ2V0Q29udHJvbGxlckNsYXNzKClcblxuICAgIHdoaWxlIChjdXJyZW50Q29udHJvbGxlckNsYXNzKSB7XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZyhgUnVubmluZyBjYWxsYmFja3MgZm9yICR7Y3VycmVudENvbnRyb2xsZXJDbGFzcy5uYW1lfWApXG5cbiAgICAgIGNvbnN0IGJlZm9yZUFjdGlvbnMgPSBjdXJyZW50Q29udHJvbGxlckNsYXNzLl9iZWZvcmVBY3Rpb25zXG5cbiAgICAgIGlmIChiZWZvcmVBY3Rpb25zKSB7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJQcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICgoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgfCB1bmRlZmluZWQ+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGN1cnJlbnRDb250cm9sbGVyQ2xhc3MucHJvdG90eXBlKSlcblxuICAgICAgICBmb3IgKGNvbnN0IGJlZm9yZUFjdGlvbk5hbWUgb2YgYmVmb3JlQWN0aW9ucykge1xuICAgICAgICAgIGNvbnN0IGJlZm9yZUFjdGlvbiA9IGNvbnRyb2xsZXJQcm90b3R5cGVbYmVmb3JlQWN0aW9uTmFtZV1cblxuICAgICAgICAgIGlmICghYmVmb3JlQWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggYmVmb3JlIGFjdGlvbjogJHtiZWZvcmVBY3Rpb25OYW1lfWApXG5cbiAgICAgICAgICBjb25zdCBib3VuZEJlZm9yZUFjdGlvbiA9IGJlZm9yZUFjdGlvbi5iaW5kKHRoaXMpXG5cbiAgICAgICAgICBhd2FpdCBib3VuZEJlZm9yZUFjdGlvbigpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY3VycmVudENvbnRyb2xsZXJDbGFzcyA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50Q29udHJvbGxlckNsYXNzKVxuXG4gICAgICBpZiAoIWN1cnJlbnRDb250cm9sbGVyQ2xhc3M/Lm5hbWU/LmVuZHNXaXRoKFwiQ29udHJvbGxlclwiKSkgYnJlYWtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFmdGVyIHJ1bkJlZm9yZUNhbGxiYWNrc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBwYXJhbXMuXG4gICAqL1xuICBwYXJhbXMoKSB7XG4gICAgLy8gTWVyZ2UgcXVlcnkgcGFyYW1ldGVycyBzbyBjb250cm9sbGVycyBjYW4gcmVhZCB0aGVtIHZpYSBwYXJhbXMoKVxuICAgIGNvbnN0IG1lcmdlZFBhcmFtcyA9IHsuLi50aGlzLnF1ZXJ5UGFyYW1ldGVycygpLCAuLi50aGlzLl9wYXJhbXN9XG5cbiAgICBpZiAoIW1lcmdlZFBhcmFtcy5jb250cm9sbGVyKSBtZXJnZWRQYXJhbXMuY29udHJvbGxlciA9IHRoaXMuX2NvbnRyb2xsZXJcblxuICAgIHJldHVybiBtZXJnZWRQYXJhbXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHBhcmFtZXRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIHF1ZXJ5IHBhcmFtZXRlcnMuXG4gICAqL1xuICBxdWVyeVBhcmFtZXRlcnMoKSB7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLl9yZXF1ZXN0LnBhdGgoKS5zcGxpdChcIj9cIilbMV1cblxuICAgIGlmICghcXVlcnkpIHJldHVybiB7fVxuXG4gICAgdHJ5IHtcbiAgICAgIC8qKlxuICAgICAgICogVW5wYXJzZWQgcGFyYW1zLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHVucGFyc2VkUGFyYW1zID0gcXVlcnlzdHJpbmcucGFyc2UocXVlcnkpXG4gICAgICBjb25zdCBwYXJhbXNUb09iamVjdCA9IG5ldyBQYXJhbXNUb09iamVjdCh1bnBhcnNlZFBhcmFtcylcblxuICAgICAgcmV0dXJuIHBhcmFtc1RvT2JqZWN0LnRvT2JqZWN0KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZW5zdXJlZEVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHt2ZWxvY2lvdXNDb250ZXh0PzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKGVycm9yKVxuXG4gICAgICBlbnN1cmVkRXJyb3IudmVsb2Npb3VzQ29udGV4dCA9IHtcbiAgICAgICAgLi4uKGVuc3VyZWRFcnJvci52ZWxvY2lvdXNDb250ZXh0IHx8IHt9KSxcbiAgICAgICAgcmVxdWVzdFBhcnNpbmc6IHtcbiAgICAgICAgICBodHRwTWV0aG9kOiB0aGlzLl9yZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgICAgICBwYXJhbWV0ZXJLZXlzOiBPYmplY3Qua2V5cyhxdWVyeXN0cmluZy5wYXJzZShxdWVyeSkpLFxuICAgICAgICAgIHBhdGg6IHRoaXMuX3JlcXVlc3QucGF0aCgpLFxuICAgICAgICAgIHF1ZXJ5UHJldmlldzogcXVlcnkubGVuZ3RoID4gMzAwID8gYCR7cXVlcnkuc2xpY2UoMCwgMzAwKX0uLi5gIDogcXVlcnksXG4gICAgICAgICAgc3RhZ2U6IFwicXVlcnktcGFyYW1ldGVyc1wiXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhyb3cgZW5zdXJlZEVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVuZGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJncy5qc29uXSAtIEpzb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gU3RhdHVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVuZGVyKHtqc29uLCBzdGF0dXMsIC4uLnJlc3RBcmdzfSA9IHt9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIC8vIEFwcGx5IHRoZSBzdGF0dXMgQkVGT1JFIGRlbGVnYXRpbmcgdG8gcmVuZGVySnNvbkFyZy9yZW5kZXJWaWV3IHNvXG4gICAgLy8gYHJlbmRlcih7anNvbjogey4uLn0sIHN0YXR1czogNDIyfSlgIHByb2R1Y2VzIGEgNDIyIHJlc3BvbnNlIHdpdGhcbiAgICAvLyBhIEpTT04gYm9keS4gVGhlIHByZXZpb3VzIG9yZGVyIHNob3J0LWNpcmN1aXRlZCB2aWEgYHJldHVyblxuICAgIC8vIHRoaXMucmVuZGVySnNvbkFyZyhqc29uKWAgYW5kIHNpbGVudGx5IGRyb3BwZWQgdGhlIHN0YXR1cyBhcmcuXG4gICAgaWYgKHN0YXR1cykge1xuICAgICAgdGhpcy5fcmVzcG9uc2Uuc2V0U3RhdHVzKHN0YXR1cylcbiAgICB9XG5cbiAgICBpZiAoanNvbikge1xuICAgICAgcmV0dXJuIHRoaXMucmVuZGVySnNvbkFyZyhqc29uKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnJlbmRlclZpZXcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVuZGVyIGpzb24gYXJnLlxuICAgKiBAcGFyYW0ge29iamVjdH0ganNvbiAtIEpTT04gcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gU2V0cyB0aGUgcmVzcG9uc2UgSlNPTiBwYXlsb2FkLlxuICAgKi9cbiAgcmVuZGVySnNvbkFyZyhqc29uKSB7XG4gICAgcmV0dXJuIHRoaXMuX21lYXN1cmVWaWV3UmVuZGVyKCgpID0+IHtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoanNvbiwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcblxuICAgICAgdGhpcy5fcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD1VVEYtOFwiKVxuICAgICAgdGhpcy5fcmVzcG9uc2Uuc2V0Qm9keShib2R5KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW5kZXIgdmlldy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIHJlbmRlclZpZXcoKSB7XG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcblxuICAgIHJldHVybiByZXF1ZXN0VGltaW5nXG4gICAgICA/IHJlcXVlc3RUaW1pbmcubWVhc3VyZShcInZpZXdzXCIsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3JlbmRlclZpZXdBY3R1YWwoKSlcbiAgICAgIDogdGhpcy5fcmVuZGVyVmlld0FjdHVhbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW5kZXIgdmlldyBhY3R1YWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBfcmVuZGVyVmlld0FjdHVhbCgpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3Qgdmlld1BhdGggPSBgJHt0aGlzLl92aWV3UGF0aH0vJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUodGhpcy5fYWN0aW9uKSl9LmVqc2BcbiAgICAgIGNvbnN0IGFjdHVhbFZpZXdQYXJhbXMgPSBpbmNvcnBvcmF0ZSh7Y29udHJvbGxlcjogdGhpc30sIHRoaXMudmlld1BhcmFtcylcblxuICAgICAgZWpzLnJlbmRlckZpbGUodmlld1BhdGgsIGFjdHVhbFZpZXdQYXJhbXMsIHt9LCAoZXJyLCBzdHIpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIGNvbnN0IHJlbmRlckVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHtjb2RlPzogc3RyaW5nfX0gKi8gKGVycilcblxuICAgICAgICAgIGlmIChyZW5kZXJFcnJvci5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBNaXNzaW5nIHZpZXcgZmlsZTogJHt2aWV3UGF0aH1gKVxuXG4gICAgICAgICAgICBpZiAodGhpcy5fcmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpID09PSAyMDApIHtcbiAgICAgICAgICAgICAgdGhpcy5fcmVzcG9uc2Uuc2V0U3RhdHVzKFwiaW50ZXJuYWwtc2VydmVyLWVycm9yXCIpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuX3Jlc3BvbnNlLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcInRleHQvcGxhaW47IGNoYXJzZXQ9VVRGLThcIilcbiAgICAgICAgICAgIHRoaXMuX3Jlc3BvbnNlLnNldEJvZHkoYE1pc3NpbmcgdmlldyBmaWxlOiAke3ZpZXdQYXRofWApXG5cbiAgICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZWplY3QocmVuZGVyRXJyb3IpXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuX3Jlc3BvbnNlLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcInRleHQvaHRtbDsgY2hhcnNldD1VVEYtOFwiKVxuICAgICAgICAgIHRoaXMuX3Jlc3BvbnNlLnNldEJvZHkoc3RyKVxuXG4gICAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbmRlciB0ZXh0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZW5kZXJUZXh0KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInJlbmRlclRleHQgc3R1YlwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0cmVhbXMgYSBmaWxlIHJlc3BvbnNlIGZyb20gZGlzayB3aXRob3V0IGxvYWRpbmcgdGhlIGZ1bGwgZmlsZSBpbnRvIGNvbnRyb2xsZXIgbWVtb3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNvbnRlbnRUeXBlXSAtIENvbnRlbnQgdHlwZS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmd9IFthcmdzLnN0YXR1c10gLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7KHJlc3VsdDogXCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwiKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3Mub25GaW5pc2hlZF0gLSBDYWxsZWQgb25jZSBhZnRlciBmaWxlIGRlbGl2ZXJ5IGNvbXBsZXRlcyBvciBhYm9ydHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNlbmRGaWxlKGZpbGVQYXRoLCBhcmdzID0ge30pIHtcbiAgICB0aGlzLl9tZWFzdXJlVmlld1JlbmRlcigoKSA9PiB7XG4gICAgICBjb25zdCB7Y29udGVudFR5cGUsIG9uRmluaXNoZWQsIHN0YXR1cywgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgICBpZiAodHlwZW9mIGZpbGVQYXRoICE9PSBcInN0cmluZ1wiIHx8IGZpbGVQYXRoLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBmaWxlIHBhdGggdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKGZpbGVQYXRoKX1gKVxuICAgICAgfVxuXG4gICAgICBpZiAob25GaW5pc2hlZCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvbkZpbmlzaGVkICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvbkZpbmlzaGVkIHRvIGJlIGEgZnVuY3Rpb24sIGdvdDogJHt0eXBlb2Ygb25GaW5pc2hlZH1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkZXRlY3RlZENvbnRlbnRUeXBlID0gY29udGVudFR5cGUgfHwgdGhpcy5zZW5kRmlsZUNvbnRlbnRUeXBlKGZpbGVQYXRoKVxuXG4gICAgICBpZiAoZGV0ZWN0ZWRDb250ZW50VHlwZSkge1xuICAgICAgICB0aGlzLl9yZXNwb25zZS5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgZGV0ZWN0ZWRDb250ZW50VHlwZSlcbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXR1cykge1xuICAgICAgICB0aGlzLl9yZXNwb25zZS5zZXRTdGF0dXMoc3RhdHVzKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9yZXNwb25zZS5zZXRGaWxlUGF0aChmaWxlUGF0aCwgb25GaW5pc2hlZCB8fCBudWxsKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtZWFzdXJlIHZpZXcgcmVuZGVyLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gbWVhc3VyZS5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgX21lYXN1cmVWaWV3UmVuZGVyKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcblxuICAgIHJldHVybiByZXF1ZXN0VGltaW5nXG4gICAgICA/IHJlcXVlc3RUaW1pbmcubWVhc3VyZVN5bmMoXCJ2aWV3c1wiLCBjYWxsYmFjaylcbiAgICAgIDogY2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBmaWxlIGNvbnRlbnQgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbnRlbnQgdHlwZSB2YWx1ZS5cbiAgICovXG4gIHNlbmRGaWxlQ29udGVudFR5cGUoZmlsZVBhdGgpIHtcbiAgICBjb25zdCBleHRlbnNpb24gPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmIChleHRlbnNpb24gPT09IFwiLndhc21cIikgcmV0dXJuIFwiYXBwbGljYXRpb24vd2FzbVwiXG4gICAgaWYgKGV4dGVuc2lvbiA9PT0gXCIuanNcIikgcmV0dXJuIFwidGV4dC9qYXZhc2NyaXB0OyBjaGFyc2V0PVVURi04XCJcbiAgICBpZiAoZXh0ZW5zaW9uID09PSBcIi5qc29uXCIpIHJldHVybiBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9VVRGLThcIlxuICAgIGlmIChleHRlbnNpb24gPT09IFwiLmNzc1wiKSByZXR1cm4gXCJ0ZXh0L2NzczsgY2hhcnNldD1VVEYtOFwiXG4gICAgaWYgKGV4dGVuc2lvbiA9PT0gXCIuaHRtbFwiKSByZXR1cm4gXCJ0ZXh0L2h0bWw7IGNoYXJzZXQ9VVRGLThcIlxuICAgIGlmIChleHRlbnNpb24gPT09IFwiLnR4dFwiKSByZXR1cm4gXCJ0ZXh0L3BsYWluOyBjaGFyc2V0PVVURi04XCJcbiAgICBpZiAoZXh0ZW5zaW9uID09PSBcIi5zdmdcIikgcmV0dXJuIFwiaW1hZ2Uvc3ZnK3htbFwiXG4gICAgaWYgKGV4dGVuc2lvbiA9PT0gXCIucG5nXCIpIHJldHVybiBcImltYWdlL3BuZ1wiXG4gICAgaWYgKGV4dGVuc2lvbiA9PT0gXCIuanBnXCIgfHwgZXh0ZW5zaW9uID09PSBcIi5qcGVnXCIpIHJldHVybiBcImltYWdlL2pwZWdcIlxuICAgIGlmIChleHRlbnNpb24gPT09IFwiLmdpZlwiKSByZXR1cm4gXCJpbWFnZS9naWZcIlxuXG4gICAgcmV0dXJuIFwiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBhYmlsaXR5IGZvciByZXF1ZXN0IHNjb3BlLlxuICAgKi9cbiAgY3VycmVudEFiaWxpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEN1cnJlbnRBYmlsaXR5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IC0gVGhlIHJlcXVlc3QuXG4gICAqL1xuICByZXF1ZXN0KCkgeyByZXR1cm4gdGhpcy5fcmVxdWVzdCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzcG9uc2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSByZXNwb25zZS5cbiAgICovXG4gIHJlc3BvbnNlKCkgeyByZXR1cm4gdGhpcy5fcmVzcG9uc2UgfVxufVxuIl19