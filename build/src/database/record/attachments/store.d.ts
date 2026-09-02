export type AttachmentDriverConstructor = import("../../../configuration-types.js").AttachmentDriverConstructor;
/**
 * Runs the recordAttachmentsStoreForModel helper.
 * @param {import("../index.js").default} model - Model instance.
 * @returns {RecordAttachmentsStore} - Store instance.
 */
export declare function recordAttachmentsStoreForModel(model: import("../index.js").default): RecordAttachmentsStore;
/**
 * Attachment persistence store.
 */
export default class RecordAttachmentsStore {
    configuration: import("../../../configuration.js").default;
    databaseIdentifier: string;
    _readyPromise: Promise<void> | null;
    _driverColumnsAvailable: boolean;
    _contentBase64Nullable: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} */
    _attachmentDriversByName: Map<string, Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, Record<string, ReturnType<typeof JSON.parse>>>} */
    _attachmentDriversByReference: Map<AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.databaseIdentifier - Database identifier.
     */
    constructor({ configuration, databaseIdentifier }: {
        configuration: import("../../../configuration.js").default;
        databaseIdentifier: string;
    });
    /**
     * Runs ensure ready.
     * @param {import("../index.js").default} [model] - Operation-owning model.
     * @returns {Promise<void>} - Resolves when schema is ready.
     */
    ensureReady(model?: import("../index.js").default): Promise<void>;
    /**
     * Ensures attachment schema through an already-owned connection.
     * @param {import("../../drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when schema is ready.
     */
    ensureSchema(db: import("../../drivers/base.js").default): Promise<void>;
    /**
     * Runs attach.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {ReturnType<typeof JSON.parse>} args.input - Attachment input.
     * @param {boolean} args.replace - Whether to replace existing attachments.
     * @returns {Promise<void>} - Resolves when complete.
     */
    attach({ input, model, name, replace }: {
        model: import("../index.js").default;
        name: string;
        input: ReturnType<typeof JSON.parse>;
        replace: boolean;
    }): Promise<void>;
    /**
     * Materializes path content once when a legacy schema requires Base64.
     * @param {import("./normalize-input.js").NormalizedAttachmentInput} normalizedInput - Normalized attachment input.
     * @returns {Promise<import("./normalize-input.js").NormalizedAttachmentInput>} - Input used by the driver and database.
     */
    persistenceInputFor(normalizedInput: import("./normalize-input.js").NormalizedAttachmentInput): Promise<import("./normalize-input.js").NormalizedAttachmentInput>;
    /**
     * Persists one normalized attachment while its path source remains open.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {import("./normalize-input.js").NormalizedAttachmentInput} args.normalizedInput - Normalized attachment.
     * @param {boolean} args.replace - Whether to replace existing attachments.
     * @returns {Promise<void>} - Resolves after persistence.
     */
    persistNormalizedAttachment({ model, name, normalizedInput, replace }: {
        model: import("../index.js").default;
        name: string;
        normalizedInput: import("./normalize-input.js").NormalizedAttachmentInput;
        replace: boolean;
    }): Promise<void>;
    /**
     * Resolves the database content_base64 value for current and legacy schemas.
     * @param {import("./normalize-input.js").NormalizedAttachmentInput} normalizedInput - Normalized attachment input.
     * @returns {Promise<string | null>} - Nullable or legacy Base64 database value.
     */
    databaseContentBase64For(normalizedInput: import("./normalize-input.js").NormalizedAttachmentInput): Promise<string | null>;
    /**
     * Runs ensure attachment store schema.
     * @param {object} args - Options.
     * @param {import("../../../database/drivers/base.js").default} args.db - DB connection.
     * @returns {Promise<void>} - Resolves when schema columns are ensured.
     */
    ensureAttachmentStoreSchema({ db }: {
        db: import("../../../database/drivers/base.js").default;
    }): Promise<void>;
    /**
     * Runs read attachment row.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<Buffer>} - Attachment bytes.
     */
    readAttachmentRow({ model, name, row }: {
        model: import("../index.js").default;
        name: string;
        row: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<Buffer>;
    /**
     * Runs attachment row url.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<string | null>} - Attachment URL.
     */
    attachmentRowUrl({ model, name, row }: {
        model: import("../index.js").default;
        name: string;
        row: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<string | null>;
    /**
     * Runs find one.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {string} [args.id] - Optional attachment id.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Attachment row.
     */
    findOne({ id, model, name }: {
        model: import("../index.js").default;
        name: string;
        id?: string;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Runs find many.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Attachment rows.
     */
    findMany({ model, name }: {
        model: import("../index.js").default;
        name: string;
    }): Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
    /**
     * Runs delete attachment row storage.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<void>} - Resolves when row storage has been deleted.
     */
    deleteAttachmentRowStorage({ model, name, row }: {
        model: import("../index.js").default;
        name: string;
        row: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<void>;
    /**
     * Purges every attachment stored under (model, name): deletes each row's
     * backing storage and then removes the attachment rows. Used to clean up an
     * owner record's attachments before/when the owner is destroyed.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @returns {Promise<number>} - Number of attachments purged.
     */
    purgeAll({ model, name }: {
        model: import("../index.js").default;
        name: string;
    }): Promise<number>;
    /**
     * Runs attachment driver by name.
     * @param {string} driverName - Driver name.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Attachment storage driver instance.
     */
    attachmentDriverByName(driverName: string): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs attachment driver by reference.
     * @param {object} args - Options.
     * @param {AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>} args.driverReference - Driver class or instance.
     * @param {string} args.attachmentName - Attachment name.
     * @param {typeof import("../index.js").default} args.modelClass - Model class.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Attachment driver instance.
     */
    attachmentDriverByReference({ attachmentName, driverReference, modelClass }: {
        driverReference: AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>;
        attachmentName: string;
        modelClass: typeof import("../index.js").default;
    }): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs attachment driver name for.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @returns {string} - Attachment driver name.
     */
    _attachmentDriverNameFor({ model, name }: {
        model: import("../index.js").default;
        name: string;
    }): string;
    /**
     * Runs resolve attachment driver.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.row] - Attachment row.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Attachment storage driver instance.
     */
    resolveAttachmentDriver({ model, name, row }: {
        model: import("../index.js").default;
        name: string;
        row?: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs next position.
     * @param {object} args - Options.
     * @param {import("../../../database/drivers/base.js").default} args.db - DB connection.
     * @param {string} args.name - Attachment name.
     * @param {string} args.recordId - Record id.
     * @param {string} args.recordType - Record type.
     * @returns {Promise<number>} - Next position.
     */
    _nextPosition({ db, name, recordId, recordType }: {
        db: import("../../../database/drivers/base.js").default;
        name: string;
        recordId: string;
        recordType: string;
    }): Promise<number>;
    /**
     * Runs with db.
     * @template T
     * @param {(db: import("../../../database/drivers/base.js").default) => Promise<T>} callback - Callback.
     * @param {import("../index.js").default} [model] - Operation-owning model.
     * @returns {Promise<T>} - Callback result.
     */
    _withDb<T>(callback: (db: import("../../../database/drivers/base.js").default) => Promise<T>, model?: import("../index.js").default): Promise<T>;
}
//# sourceMappingURL=store.d.ts.map