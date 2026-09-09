/**
 * Filesystem attachment storage driver.
 */
export default class FilesystemAttachmentStorageDriver {
    configuration: import("../../../../configuration.js").default;
    options: Record<string, any>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../../../../configuration.js").default} args.configuration - Configuration instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.options] - Driver options.
     */
    constructor({ configuration, options }: {
        configuration: import("../../../../configuration.js").default;
        options?: Record<string, ReturnType<typeof JSON.parse>>;
    });
    /**
     * Runs directory.
     * @returns {string} - Root directory for attachment files.
     */
    directory(): string;
    /**
     * Runs write.
     * @param {object} args - Options.
     * @param {string} args.attachmentId - Attachment id.
     * @param {import("../normalize-input.js").NormalizedAttachmentInput} args.input - Normalized attachment input.
     * @returns {Promise<{storageKey: string}>} - Storage key result.
     */
    write({ attachmentId, input }: {
        attachmentId: string;
        input: import("../normalize-input.js").NormalizedAttachmentInput;
    }): Promise<{
        storageKey: string;
    }>;
    /**
     * Runs read.
     * @param {object} args - Options.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<Buffer>} - Attachment bytes.
     */
    read({ storageKey }: {
        storageKey: string;
    }): Promise<Buffer>;
    /**
     * Runs delete.
     * @param {object} args - Options.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<void>} - Resolves when file has been deleted.
     */
    delete({ storageKey }: {
        storageKey: string;
    }): Promise<void>;
    /**
     * Runs url.
     * @param {object} args - Options.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<string>} - Resolvable URL.
     */
    url({ storageKey }: {
        storageKey: string;
    }): Promise<string>;
}
//# sourceMappingURL=filesystem.d.ts.map