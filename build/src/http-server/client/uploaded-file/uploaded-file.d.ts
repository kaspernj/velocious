export default class UploadedFile {
    contentTypeValue: string | undefined;
    fieldNameValue: string;
    filenameValue: string;
    sizeValue: number;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.fieldName - Field name.
     * @param {string} args.filename - Filename.
     * @param {string | undefined} args.contentType - Content type.
     * @param {number} args.size - Size.
     */
    constructor({ contentType, fieldName, filename, size }: {
        fieldName: string;
        filename: string;
        contentType: string | undefined;
        size: number;
    });
    contentType(): string | undefined;
    fieldName(): string;
    filename(): string;
    size(): number;
    /**
     * Runs save to.
     * @param {string} _destinationPath - Destination path.
     * @returns {Promise<void>} - Resolves when complete.
     */
    saveTo(_destinationPath: string): Promise<void>;
}
//# sourceMappingURL=uploaded-file.d.ts.map