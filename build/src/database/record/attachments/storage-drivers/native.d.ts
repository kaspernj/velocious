/**
 * Native attachment storage driver.
 * This driver delegates all I/O to user-provided callbacks.
 */
export default class NativeAttachmentStorageDriver {
    configuration: import("../../../../configuration.js").default | undefined;
    name: string;
    options: Record<string, any>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../../../../configuration.js").default} [args.configuration] - Configuration instance.
     * @param {string} args.name - Driver name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.options] - Driver options.
     */
    constructor({ configuration, name, options }: {
        configuration?: import("../../../../configuration.js").default;
        name: string;
        options?: Record<string, ReturnType<typeof JSON.parse>>;
    });
    /**
     * Runs write.
     * @param {object} args - Write args.
     * @param {string} args.attachmentId - Attachment id.
     * @param {import("../normalize-input.js").NormalizedAttachmentInput} args.input - Normalized attachment input.
     * @param {import("../../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @returns {Promise<{storageKey: string}>} - Storage key result.
     */
    write({ attachmentId, input, model, name }: {
        attachmentId: string;
        input: import("../normalize-input.js").NormalizedAttachmentInput;
        model: import("../../index.js").default;
        name: string;
    }): Promise<{
        storageKey: string;
    }>;
    /**
     * Runs read.
     * @param {object} args - Read args.
     * @param {string} args.storageKey - Storage key.
     * @param {import("../../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<Buffer>} - Attachment bytes.
     */
    read({ model, name, row, storageKey }: {
        storageKey: string;
        model: import("../../index.js").default;
        name: string;
        row: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<Buffer>;
    /**
     * Runs delete.
     * @param {object} args - Delete args.
     * @param {string} args.storageKey - Storage key.
     * @param {import("../../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<void>} - Resolves when deleted.
     */
    delete({ model, name, row, storageKey }: {
        storageKey: string;
        model: import("../../index.js").default;
        name: string;
        row: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<void>;
    /**
     * Runs url.
     * @param {object} args - URL args.
     * @param {string} args.storageKey - Storage key.
     * @param {import("../../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<string | null>} - Attachment URL.
     */
    url({ model, name, row, storageKey }: {
        storageKey: string;
        model: import("../../index.js").default;
        name: string;
        row: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<string | null>;
}
//# sourceMappingURL=native.d.ts.map