import { Readable } from "node:stream";
/**
 * Opened Node attachment path source.
 *
 * The opened file handle fixes the source identity at normalization time. Reads
 * are limited to the stat snapshot and fail if the file becomes shorter.
 */
export default class AttachmentPathSource {
    byteSize: number;
    fileHandle: import("node:fs/promises").FileHandle;
    filePath: string;
    /** @type {Set<Readable>} */
    activeStreams: Set<Readable>;
    /** @type {Promise<void> | null} */
    closePromise: Promise<void> | null;
    closed: boolean;
    /**
     * Creates an opened attachment path source.
     * @param {object} args - Source args.
     * @param {number} args.byteSize - Opened-handle stat size.
     * @param {import("node:fs/promises").FileHandle} args.fileHandle - Open file handle.
     * @param {string} args.filePath - Validated path used to open the handle.
     */
    constructor({ byteSize, fileHandle, filePath }: {
        byteSize: number;
        fileHandle: import("node:fs/promises").FileHandle;
        filePath: string;
    });
    /**
     * Creates a bounded, backpressured stream over the opened file snapshot.
     * @returns {Promise<Readable>} - Snapshot read stream.
     */
    createReadStream(): Promise<Readable>;
    /**
     * Reads the opened file snapshot into memory for compatibility-only callers.
     * @returns {Promise<Buffer>} - Exact snapshot bytes.
     */
    readBuffer(): Promise<Buffer>;
    /**
     * Closes all active streams and the owned file handle.
     * @returns {Promise<void>} - Resolves after close.
     */
    close(): Promise<void>;
    /**
     * Produces bounded chunks from the opened file handle.
     * @yields {Buffer} - Snapshot chunks.
     */
    readChunks(): AsyncGenerator<Buffer<ArrayBuffer>, void, unknown>;
    /**
     * Asserts that the source remains open.
     * @returns {void} - Throws if closed.
     */
    assertOpen(): void;
    /**
     * Throws a truncation error.
     * @param {object} args - Args.
     * @param {number} args.bytesRead - Bytes read before EOF.
     * @returns {never} - Always throws.
     */
    throwTruncated({ bytesRead }: {
        bytesRead: number;
    }): never;
}
//# sourceMappingURL=attachment-path-source.d.ts.map