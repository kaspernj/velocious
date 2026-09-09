import Header from "./header.js";
export default class Request {
    body: string | undefined;
    headers: Header[];
    method: string;
    path: string;
    version: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} [args.body] - Request body.
     * @param {string} args.method - HTTP method.
     * @param {Header[]} args.headers - Header list.
     * @param {string} args.path - Path.
     * @param {string} args.version - Version.
     */
    constructor({ body, method, headers, path, version }: {
        body?: string;
        method: string;
        headers: Header[];
        path: string;
        version: string;
    });
    asString(): string;
    /**
     * Runs get header.
     * @param {string} name - Name.
     * @returns {Header} - The header.
     */
    getHeader(name: string): Header;
    /**
     * Runs add header.
     * @param {string} name - Name.
     * @param {string | number} value - Value to use.
     * @returns {void} - No return value.
     */
    addHeader(name: string, value: string | number): void;
    /**
     * Runs prepare.
     * @returns {void} - No return value.
     */
    prepare(): void;
    /**
     * Runs stream.
     * @param {(arg: string) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    stream(callback: (arg: string) => void): void;
}
//# sourceMappingURL=request.d.ts.map