import RecordAttachmentDownload from "./download.js";
/**
 * Attachment helper bound to one model + attachment name.
 */
export default class RecordAttachmentHandle {
    model: import("../index.js").default<Record<string, any>>;
    name: string;
    type: "hasMany" | "hasOne";
    /**
     * Pending inputs.
     * @type {Array<ReturnType<typeof JSON.parse>>} */
    pendingInputs: Array<ReturnType<typeof JSON.parse>>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {"hasOne" | "hasMany"} args.type - Attachment type.
     */
    constructor({ model, name, type }: {
        model: import("../index.js").default;
        name: string;
        type: "hasOne" | "hasMany";
    });
    /**
     * Runs has pending attachments.
     * @returns {boolean} - Whether there are pending attachment writes.
     */
    hasPendingAttachments(): boolean;
    /**
     * Runs queue attach.
     * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
     * @returns {void} - Queues attachment write for next save.
     */
    queueAttach(input: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs attach.
     * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
     * @returns {Promise<void>} - Resolves when attached.
     */
    attach(input: ReturnType<typeof JSON.parse>): Promise<void>;
    /**
     * Runs flush pending attachments.
     * @returns {Promise<void>} - Resolves when pending attachments are flushed.
     */
    flushPendingAttachments(): Promise<void>;
    /**
     * Runs download.
     * @param {string} [id] - Optional attachment id for has-many attachments.
     * @returns {Promise<RecordAttachmentDownload | null>} - Downloaded attachment.
     */
    download(id?: string): Promise<RecordAttachmentDownload | null>;
    /**
     * Runs download all.
     * @returns {Promise<Array<RecordAttachmentDownload>>} - Downloaded attachments.
     */
    downloadAll(): Promise<Array<RecordAttachmentDownload>>;
    /**
     * Runs list metadata. Returns metadata (no content bytes) for every attachment
     * under this (record, name), so callers can enumerate has-many attachments
     * without downloading their content.
     * @returns {Promise<Array<{byteSize: number, contentType: string | null, filename: string, id: string, url: string | null}>>} - Attachment metadata entries.
     */
    listMetadata(): Promise<Array<{
        byteSize: number;
        contentType: string | null;
        filename: string;
        id: string;
        url: string | null;
    }>>;
    /**
     * Runs url.
     * @param {string} [id] - Optional attachment id for has-many attachments.
     * @returns {Promise<string | null>} - Resolvable attachment URL.
     */
    url(id?: string): Promise<string | null>;
    /**
     * Purges every attachment under this (record, name): deletes the backing
     * storage for each and removes the attachment rows. A no-op for unpersisted
     * records. Only the attachments present when the purge starts are removed, so a
     * concurrent attach for the same (record, name) is left intact. Throws (without
     * deleting any rows) if a storage driver cannot delete its object, so a driver
     * configured without a `delete` operation can never leak storage. Callers use
     * this to clean up attachments before destroying the owner record.
     * @returns {Promise<number>} - Number of attachments purged.
     */
    purgeAll(): Promise<number>;
}
//# sourceMappingURL=handle.d.ts.map