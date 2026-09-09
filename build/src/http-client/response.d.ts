import Header from "./header.js";
export default class Response {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Header[]} */
    headers: Header[];
    method: string;
    onComplete: () => void;
    state: string;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Buffer} */
    response: Buffer;
    statusLine: string | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.method - HTTP method.
     * @param {() => void} args.onComplete - On complete.
     */
    constructor({ method, onComplete }: {
        method: string;
        onComplete: () => void;
    });
    /**
     * Runs feed.
     * @param {Buffer} data - Response data chunk.
     */
    feed(data: Buffer): void;
    /**
     * Runs get header.
     * @param {string} name - Name.
     * @returns {Header} - The header.
     */
    getHeader(name: string): Header;
    json(): any;
    tryToParse(): void;
    completeResponse(): void;
    /**
     * Runs content length number.
     * @returns {number} - The content length number.
     */
    _contentLengthNumber(): number;
}
//# sourceMappingURL=response.d.ts.map