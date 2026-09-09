import net from "net";
import Request from "./request.js";
import Response from "./response.js";
import Logger from "../logger.js";
export default class HttpClient {
    headers: import("./header.js").default[];
    logger: Logger;
    version: string;
    connectionReject: ((reason?: any) => void) | null | undefined;
    connection: net.Socket | null | undefined;
    currentRequestResolve: ((value: PromiseLike<{
        request: import("./request.js").default;
        response: import("./response.js").default;
    }> | {
        request: import("./request.js").default;
        response: import("./response.js").default;
    }) => void) | null | undefined;
    currentRequestReject: ((reason?: any) => void) | null | undefined;
    currentResponse: Response | null | undefined;
    currentRequest: Request | null | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} [args.debug] - Whether debug.
     * @param {Array<import("./header.js").default>} [args.headers] - Header list.
     * @param {string} [args.version] - Version.
     */
    constructor({ debug, headers, version }: {
        debug?: boolean;
        headers?: Array<import("./header.js").default>;
        version?: string;
    });
    connect(): Promise<any>;
    /**
     * Runs get.
     * @param {string} path - Path.
     * @param {object} [options] - Options object.
     * @param {Array<import("./header.js").default>} [options.headers] - Header list.
     * @returns {Promise<{request: import("./request.js").default, response: import("./response.js").default}>} - Resolves with the request/response pair.
     */
    get(path: string, { headers }?: {
        headers?: Array<import("./header.js").default>;
    }): Promise<{
        request: import("./request.js").default;
        response: import("./response.js").default;
    }>;
    /**
     * On connection data.
     * @param {Buffer} data - Data payload.
     */
    onConnectionData: (data: Buffer) => void;
    onConnectionEnd: () => void;
    /**
     * On connection error.
     * @param {Error} error - Error instance.
     */
    onConnectionError: (error: Error) => void;
    isConnected(): boolean;
    onResponseComplete: () => void;
}
//# sourceMappingURL=index.d.ts.map