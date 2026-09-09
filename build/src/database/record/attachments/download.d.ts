/** Downloaded attachment payload wrapper. */
export default class RecordAttachmentDownload {
    values: {
        byteSize: number;
        content: Buffer<ArrayBufferLike>;
        contentType: string | null;
        filename: string;
        id: string;
        url: string | null;
    };
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {string} args.id - Attachment id.
     * @param {string} args.filename - Filename.
     * @param {string | null} args.contentType - Content type.
     * @param {number} args.byteSize - File size in bytes.
     * @param {Buffer} args.content - File content.
     * @param {string | null} [args.url] - Resolvable URL.
     */
    constructor({ byteSize, content, contentType, filename, id, url }: {
        id: string;
        filename: string;
        contentType: string | null;
        byteSize: number;
        content: Buffer;
        url?: string | null;
    });
    /**
     * Runs byte size.
     * @returns {number} - File size in bytes.
     */
    byteSize(): number;
    /**
     * Runs content.
     * @returns {Buffer} - File content.
     */
    content(): Buffer;
    /**
     * Runs content type.
     * @returns {string | null} - Content type.
     */
    contentType(): string | null;
    /**
     * Runs filename.
     * @returns {string} - Filename.
     */
    filename(): string;
    /**
     * Runs id.
     * @returns {string} - Attachment id.
     */
    id(): string;
    /**
     * Runs url.
     * @returns {string | null} - Resolvable attachment URL.
     */
    url(): string | null;
}
//# sourceMappingURL=download.d.ts.map