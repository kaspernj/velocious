import Logger from "../../logger.js";
import RequestTiming from "./request-timing.js";
import Response from "./response.js";
export default class VelociousHttpServerClientRequestRunner {
    logger: Logger;
    configuration: import("../../configuration.js").default;
    request: import("./websocket-request.js").default | import("./request.js").default;
    response: Response;
    completedRequestLogged: boolean;
    requestTiming: RequestTiming;
    state: string;
    events: import("eventemitter3").EventEmitter<string | symbol, any>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("./request.js").default | import("./websocket-request.js").default} args.request - Request object.
     */
    constructor({ configuration, request }: {
        configuration: import("../../configuration.js").default;
        request: import("./request.js").default | import("./websocket-request.js").default;
    });
    getRequest(): import("./websocket-request.js").default | import("./request.js").default;
    getState(): string;
    run(): Promise<any>;
    _run(): Promise<void>;
    /**
     * Runs log completed request.
     * @returns {Promise<void>} - Logs the completed request line after the response has been served.
     */
    logCompletedRequest(): Promise<void>;
}
//# sourceMappingURL=request-runner.d.ts.map