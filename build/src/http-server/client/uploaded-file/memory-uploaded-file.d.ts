import UploadedFile from "./uploaded-file.js";
export default class MemoryUploadedFile extends UploadedFile {
    buffer: Buffer<ArrayBufferLike>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Buffer} args.buffer - Buffer.
     * @param {string} args.fieldName - Field name.
     * @param {string} args.filename - Filename.
     * @param {string | undefined} args.contentType - Content type.
     * @param {number} args.size - Size.
     */
    constructor({ buffer, contentType, fieldName, filename, size }: {
        buffer: Buffer;
        fieldName: string;
        filename: string;
        contentType: string | undefined;
        size: number;
    });
    getBuffer(): Buffer<ArrayBufferLike>;
    /**
     * Runs save to.
     * @param {string} destinationPath - Destination path.
     * @returns {Promise<void>} - Resolves when complete.
     */
    saveTo(destinationPath: string): Promise<void>;
}
//# sourceMappingURL=memory-uploaded-file.d.ts.map