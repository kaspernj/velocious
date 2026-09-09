/**
 * S3 attachment storage driver.
 */
export default class S3AttachmentStorageDriver {
    options: Record<string, any>;
    _clientPromise: Promise<{
        DeleteObjectCommand: any;
        GetObjectCommand: any;
        PutObjectCommand: any;
        S3Client: any;
        getSignedUrl: any;
    }> | null;
    _client: any;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.options] - Driver options.
     */
    constructor({ options }: {
        options?: Record<string, ReturnType<typeof JSON.parse>>;
    });
    /**
     * Runs bucket.
     * @returns {string} - S3 bucket name.
     */
    bucket(): string;
    /**
     * Runs signed url expires in.
     * @returns {number} - Signed URL expiration in seconds.
     */
    signedUrlExpiresIn(): number;
    /**
     * Runs s3 runtime.
     * @returns {Promise<{S3Client: ReturnType<typeof JSON.parse>, PutObjectCommand: ReturnType<typeof JSON.parse>, GetObjectCommand: ReturnType<typeof JSON.parse>, DeleteObjectCommand: ReturnType<typeof JSON.parse>, getSignedUrl: ReturnType<typeof JSON.parse>}>} - S3 runtime.
     */
    s3Runtime(): Promise<{
        S3Client: ReturnType<typeof JSON.parse>;
        PutObjectCommand: ReturnType<typeof JSON.parse>;
        GetObjectCommand: ReturnType<typeof JSON.parse>;
        DeleteObjectCommand: ReturnType<typeof JSON.parse>;
        getSignedUrl: ReturnType<typeof JSON.parse>;
    }>;
    /**
     * Runs client.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - S3 client.
     */
    client(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs write.
     * @param {object} args - Write args.
     * @param {string} args.attachmentId - Attachment id.
     * @param {import("../normalize-input.js").NormalizedAttachmentInput} args.input - Normalized attachment input.
     * @returns {Promise<{storageKey: string}>} - Storage key.
     */
    write({ attachmentId, input }: {
        attachmentId: string;
        input: import("../normalize-input.js").NormalizedAttachmentInput;
    }): Promise<{
        storageKey: string;
    }>;
    /**
     * Runs read.
     * @param {object} args - Read args.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<Buffer>} - Attachment bytes.
     */
    read({ storageKey }: {
        storageKey: string;
    }): Promise<Buffer>;
    /**
     * Runs delete.
     * @param {object} args - Delete args.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<void>} - Resolves when deleted.
     */
    delete({ storageKey }: {
        storageKey: string;
    }): Promise<void>;
    /**
     * Runs url.
     * @param {object} args - URL args.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<string>} - Signed URL.
     */
    url({ storageKey }: {
        storageKey: string;
    }): Promise<string>;
}
//# sourceMappingURL=s3.d.ts.map