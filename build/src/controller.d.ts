import Logger from "./logger.js";
import Cookie from "./http-server/cookie.js";
export default class VelociousController {
    _action: string;
    _controller: string;
    _configuration: import("./configuration.js").default;
    logger: Logger;
    _params: Record<string, any>;
    _request: import("./http-server/client/request.js").default;
    _response: import("./http-server/client/response.js").default;
    viewParams: {};
    _viewPath: string;
    _cookies: Cookie[] | undefined;
    /** @type {Array<string> | undefined} */
    static _beforeActions: Array<string> | undefined;
    /**
     * Runs before action.
     * @param {string} methodName - Method name.
     * @returns {void} - No return value.
     */
    static beforeAction(methodName: string): void;
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
    constructor({ action, configuration, controller, params, request, response, viewPath }: {
        action: string;
        configuration: import("./configuration.js").default;
        controller: string;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        request: import("./http-server/client/request.js").default;
        response: import("./http-server/client/response.js").default;
        viewPath: string;
    });
    /**
     * Runs get action.
     * @returns {string} - The action.
     */
    getAction(): string;
    /**
     * Runs get configuration.
     * @returns {import("./configuration.js").default} - The configuration.
     */
    getConfiguration(): import("./configuration.js").default;
    /**
     * Runs get params.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The params.
     */
    getParams(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs get request.
     * @returns {import("./http-server/client/request.js").default} - The request.
     */
    getRequest(): import("./http-server/client/request.js").default;
    /**
     * Runs transport serialization options.
     * @returns {import("./frontend-models/transport-serialization.js").FrontendModelTransportSerializationOptions} - Serialization options.
     */
    transportSerializationOptions(): import("./frontend-models/transport-serialization.js").FrontendModelTransportSerializationOptions;
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
    setCookie(name: string, value: ReturnType<typeof JSON.parse>, args?: {
        domain?: string;
        expires?: Date;
        httpOnly?: boolean;
        maxAge?: number;
        path?: string;
        secure?: boolean;
        sameSite?: "Lax" | "Strict" | "None";
        encrypted?: boolean;
    }): Cookie;
    /**
     * Runs get cookies.
     * @returns {Cookie[]} - Cookies from the request.
     */
    getCookies(): Cookie[];
    /**
     * Runs get controller class.
     * @private
     * @returns {typeof VelociousController} - The controller class.
     */
    private _getControllerClass;
    _runBeforeCallbacks(): Promise<void>;
    /**
     * Runs params.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The params.
     */
    params(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs query parameters.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The query parameters.
     */
    queryParameters(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs render.
     * @param {object} [args] - Options object.
     * @param {object} [args.json] - Json.
     * @param {number | string} [args.status] - Status.
     * @returns {Promise<void>} - Resolves when complete.
     */
    render({ json, status, ...restArgs }?: {
        json?: object;
        status?: number | string;
    }): Promise<void>;
    /**
     * Runs render json arg.
     * @param {object} json - JSON payload.
     * @returns {void} - Sets the response JSON payload.
     */
    renderJsonArg(json: object): void;
    /**
     * Runs render view.
     * @returns {Promise<void>} - Resolves when complete.
     */
    renderView(): Promise<void>;
    /**
     * Runs render view actual.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _renderViewActual(): Promise<void>;
    /**
     * Runs render text.
     * @returns {void} - No return value.
     */
    renderText(): void;
    /**
     * Streams a file response from disk without loading the full file into controller memory.
     * @param {string} filePath - File path.
     * @param {object} [args] - Options object.
     * @param {string} [args.contentType] - Content type.
     * @param {number | string} [args.status] - Status.
     * @param {(result: "completed" | "aborted") => void | Promise<void>} [args.onFinished] - Called once after file delivery completes or aborts.
     * @returns {void} - No return value.
     */
    sendFile(filePath: string, args?: {
        contentType?: string;
        status?: number | string;
        onFinished?: (result: "completed" | "aborted") => void | Promise<void>;
    }): void;
    /**
     * Runs measure view render.
     * @template T
     * @param {() => T} callback - Callback to measure.
     * @returns {T} - Callback result.
     */
    _measureViewRender<T>(callback: () => T): T;
    /**
     * Runs send file content type.
     * @param {string} filePath - File path.
     * @returns {string} - Content type value.
     */
    sendFileContentType(filePath: string): string;
    /**
     * Runs current ability.
     * @returns {import("./authorization/ability.js").default | undefined} - Current ability for request scope.
     */
    currentAbility(): import("./authorization/ability.js").default | undefined;
    /**
     * Runs request.
     * @returns {import("./http-server/client/request.js").default} - The request.
     */
    request(): import("./http-server/client/request.js").default;
    /**
     * Runs response.
     * @returns {import("./http-server/client/response.js").default} - The response.
     */
    response(): import("./http-server/client/response.js").default;
}
//# sourceMappingURL=controller.d.ts.map