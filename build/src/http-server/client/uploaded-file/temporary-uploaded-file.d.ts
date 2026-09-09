import UploadedFile from "./uploaded-file.js";
export default class TemporaryUploadedFile extends UploadedFile {
    pathValue: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.path - Path.
     * @param {string} args.fieldName - Field name.
     * @param {string} args.filename - Filename.
     * @param {string | undefined} args.contentType - Content type.
     * @param {number} args.size - Size.
     */
    constructor({ contentType, fieldName, filename, path, size }: {
        path: string;
        fieldName: string;
        filename: string;
        contentType: string | undefined;
        size: number;
    });
    getPath(): string;
    /**
     * Runs save to.
     * @param {string} destinationPath - Destination path.
     * @returns {Promise<void>} - Resolves when complete.
     */
    saveTo(destinationPath: string): Promise<void>;
}
//# sourceMappingURL=temporary-uploaded-file.d.ts.map