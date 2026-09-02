export type AttachmentPathSource = {
    /**
     * - Opened file snapshot size.
     */
    byteSize: number;
    /**
     * - Validated source path for metadata only.
     */
    filePath: string;
    /**
     * - Creates a bounded snapshot stream.
     */
    createReadStream: () => Promise<import("node:stream").Readable>;
    /**
     * - Reads snapshot bytes for compatibility callers.
     */
    readBuffer: () => Promise<Buffer>;
    /**
     * - Closes the owned source.
     */
    close: () => Promise<void>;
};
export type NormalizedAttachmentInput = {
    /**
     * - File size in bytes.
     */
    byteSize: number;
    /**
     * - Raw in-memory content bytes.
     */
    contentBuffer: Buffer | null;
    /**
     * - Base64 encoded in-memory content.
     */
    contentBase64: string | null;
    /**
     * - Content type.
     */
    contentType: string | null;
    /**
     * - Filename.
     */
    filename: string;
    /**
     * - Environment-owned opened path source.
     */
    pathSource: AttachmentPathSource | null;
};
/**
 * Runs normalize record attachment input.
 * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
 * @param {object} [args] - Options.
 * @param {boolean} [args.allowPathInput] - Whether `{path: ...}` input is allowed.
 * @param {string[]} [args.allowedPathPrefixes] - Optional allowlist for path input.
 * @param {string} [args.defaultFilename] - Optional default filename.
 * @param {import("../../../environment-handlers/base.js").default} [args.environmentHandler] - Optional environment handler for Node-only file operations.
 * @returns {Promise<NormalizedAttachmentInput>} - Normalized attachment input.
 */
export default function normalizeRecordAttachmentInput(input: ReturnType<typeof JSON.parse>, args?: {
    allowPathInput?: boolean;
    allowedPathPrefixes?: string[];
    defaultFilename?: string;
    environmentHandler?: import("../../../environment-handlers/base.js").default;
}): Promise<NormalizedAttachmentInput>;
//# sourceMappingURL=normalize-input.d.ts.map