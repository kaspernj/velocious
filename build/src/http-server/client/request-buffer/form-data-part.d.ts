import Logger from "../../../logger.js";
import MemoryUploadedFile from "../uploaded-file/memory-uploaded-file.js";
import TemporaryUploadedFile from "../uploaded-file/temporary-uploaded-file.js";
export default class FormDataPart {
    name: string | undefined;
    filename: string | undefined;
    contentLength: number | undefined;
    contentType: string | undefined;
    size: number | undefined;
    value: string | MemoryUploadedFile | TemporaryUploadedFile | undefined;
    logger: Logger;
    /**
     * Headers.
     * @type {Record<string, import("./header.js").default>} */
    headers: Record<string, import("./header.js").default>;
    /**
     * Body.
     * @type {number[]} */
    body: number[];
    /**
     * Runs add header.
     * @param {import("./header.js").default} header - Header value.
     */
    addHeader(header: import("./header.js").default): void;
    finish(): void;
    /**
     * Runs build uploaded file.
     * @param {Buffer} buffer - File buffer.
     * @returns {import("../uploaded-file/memory-uploaded-file.js").default | import("../uploaded-file/temporary-uploaded-file.js").default} - Uploaded file wrapper.
     */
    buildUploadedFile(buffer: Buffer): import("../uploaded-file/memory-uploaded-file.js").default | import("../uploaded-file/temporary-uploaded-file.js").default;
    /**
     * Runs create temp file.
     * @param {Buffer} buffer - Buffer.
     * @param {string} filename - Filename.
     * @returns {string} - The temp file.
     */
    createTempFile(buffer: Buffer, filename: string): string;
    /**
     * Prevent path traversal/absolute paths from filenames coming from headers.
     * @param {string | undefined} filename - Filename.
     * @returns {string} - The sanitize filename.
     */
    _sanitizeFilename(filename: string | undefined): string;
    getName(): string;
    getValue(): string | MemoryUploadedFile | TemporaryUploadedFile;
    isFile(): boolean;
    /**
     * Runs remove from body.
     * @param {string} text - Text.
     */
    removeFromBody(text: string): void;
}
//# sourceMappingURL=form-data-part.d.ts.map