import DatabaseRecord from "../index.js";
/** Frontend-readable metadata row for `velocious_attachments`. */
export default class VelociousAttachment extends DatabaseRecord {
    /**
     * Returns the backing attachment table name.
     * @returns {string} - Backing attachment table name.
     */
    static tableName(): string;
    /**
     * Ensures the framework-owned attachment table exists before loading metadata.
     * @param {object} args - Options object.
     * @param {import("../../../configuration.js").default} args.configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    static initializeRecord({ configuration }: {
        configuration: import("../../../configuration.js").default;
    }): Promise<void>;
    /**
     * Returns the attachment id.
     * @returns {string} - Attachment id.
     */
    id(): string;
    /**
     * Returns the owner model name.
     * @returns {string} - Owner model name.
     */
    recordType(): string;
    /**
     * Returns the owner record id.
     * @returns {string} - Owner record id.
     */
    recordId(): string;
    /**
     * Returns the attachment name on the owner model.
     * @returns {string} - Attachment name on the owner model.
     */
    name(): string;
    /**
     * Returns the attachment position.
     * @returns {number} - Attachment position.
     */
    position(): number;
    /**
     * Returns the attachment filename.
     * @returns {string} - Attachment filename.
     */
    filename(): string;
    /**
     * Returns the attachment content type.
     * @returns {string | null} - Attachment content type.
     */
    contentType(): string | null;
    /**
     * Returns the attachment byte size.
     * @returns {number} - Attachment byte size.
     */
    byteSize(): number;
    /**
     * Returns the created-at timestamp in milliseconds.
     * @returns {number} - Created-at timestamp in milliseconds.
     */
    createdAtMs(): number;
    /**
     * Returns the updated-at timestamp in milliseconds.
     * @returns {number} - Updated-at timestamp in milliseconds.
     */
    updatedAtMs(): number;
    /**
     * Returns a checked integer attribute value.
     * @param {object} args - Options object.
     * @param {"byteSize" | "createdAtMs" | "updatedAtMs"} args.attributeName - Integer attribute name.
     * @param {string} args.expectedDescription - Description for error messages.
     * @returns {number} - Safe integer value.
     */
    safeIntegerAttribute({ attributeName, expectedDescription }: {
        attributeName: "byteSize" | "createdAtMs" | "updatedAtMs";
        expectedDescription: string;
    }): number;
}
//# sourceMappingURL=attachment-record.d.ts.map