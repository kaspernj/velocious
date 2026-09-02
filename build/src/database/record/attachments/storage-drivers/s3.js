// @ts-check
/**
 * Runs throw s3 configuration error.
 * @param {string} message - Error message.
 * @returns {never} - Always throws.
 */
function throwS3ConfigurationError(message) {
    throw new Error(`Invalid S3 attachment storage configuration: ${message}`);
}
/**
 * Runs is readable stream.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {boolean} - Whether value is a readable stream.
 */
function isReadableStream(value) {
    return Boolean(value && typeof value === "object" && typeof /** @type {ReturnType<typeof JSON.parse>} */ (value).pipe === "function");
}
/**
 * Runs dynamic import.
 * @param {string} specifier - Module specifier.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Imported module.
 */
async function dynamicImport(specifier) {
    const importer = /** @type {(moduleSpecifier: string) => Promise<ReturnType<typeof JSON.parse>>} */ (new Function("moduleSpecifier", "return import(moduleSpecifier)"));
    return await importer(specifier);
}
/**
 * Runs stream to buffer.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {Promise<Buffer>} - Buffer value.
 */
async function streamToBuffer(value) {
    if (Buffer.isBuffer(value))
        return value;
    if (value instanceof Uint8Array)
        return Buffer.from(value);
    if (value instanceof ArrayBuffer)
        return Buffer.from(value);
    if (!isReadableStream(value)) {
        throw new Error(`Unsupported S3 body type: ${String(value)}`);
    }
    /**
     * Chunks.
     * @type {Buffer[]} */
    const chunks = [];
    const readableStream = /** @type {ReturnType<typeof JSON.parse>} */ (value);
    await new Promise((resolve, reject) => {
        readableStream.on("data", (/** @type {Buffer | Uint8Array | ArrayBuffer | string} */ chunk) => {
            if (Buffer.isBuffer(chunk)) {
                chunks.push(chunk);
            }
            else if (chunk instanceof ArrayBuffer) {
                chunks.push(Buffer.from(chunk));
            }
            else {
                chunks.push(Buffer.from(chunk));
            }
        });
        readableStream.on("error", reject);
        readableStream.on("end", resolve);
    });
    return Buffer.concat(chunks);
}
/**
 * S3 attachment storage driver.
 */
export default class S3AttachmentStorageDriver {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.options] - Driver options.
     */
    constructor({ options = {} }) {
        this.options = options;
        this._clientPromise = null;
    }
    /**
     * Runs bucket.
     * @returns {string} - S3 bucket name.
     */
    bucket() {
        const value = this.options.bucket || process.env.VELOCIOUS_ATTACHMENTS_S3_BUCKET;
        if (typeof value !== "string" || value.length < 1) {
            throwS3ConfigurationError("missing bucket");
        }
        return value;
    }
    /**
     * Runs signed url expires in.
     * @returns {number} - Signed URL expiration in seconds.
     */
    signedUrlExpiresIn() {
        const value = Number(this.options.signedUrlExpiresIn ?? process.env.VELOCIOUS_ATTACHMENTS_S3_SIGNED_URL_EXPIRES_IN ?? 3600);
        if (!Number.isFinite(value) || value < 1)
            return 3600;
        return Math.floor(value);
    }
    /**
     * Runs s3 runtime.
     * @returns {Promise<{S3Client: ReturnType<typeof JSON.parse>, PutObjectCommand: ReturnType<typeof JSON.parse>, GetObjectCommand: ReturnType<typeof JSON.parse>, DeleteObjectCommand: ReturnType<typeof JSON.parse>, getSignedUrl: ReturnType<typeof JSON.parse>}>} - S3 runtime.
     */
    async s3Runtime() {
        if (!this._clientPromise) {
            this._clientPromise = (async () => {
                const [{ S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand }, { getSignedUrl }] = await Promise.all([
                    dynamicImport("@aws-sdk/client-s3"),
                    dynamicImport("@aws-sdk/s3-request-presigner")
                ]);
                return { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, getSignedUrl };
            })();
        }
        return await this._clientPromise;
    }
    /**
     * Runs client.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - S3 client.
     */
    async client() {
        if (!this._client) {
            const { S3Client } = await this.s3Runtime();
            /**
             * Client config.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const clientConfig = {
                region: this.options.region || process.env.VELOCIOUS_ATTACHMENTS_S3_REGION || "us-east-1"
            };
            if (typeof this.options.endpoint === "string" && this.options.endpoint.length > 0) {
                clientConfig.endpoint = this.options.endpoint;
            }
            if (typeof this.options.forcePathStyle === "boolean") {
                clientConfig.forcePathStyle = this.options.forcePathStyle;
            }
            const accessKeyId = this.options.accessKeyId || process.env.VELOCIOUS_ATTACHMENTS_S3_ACCESS_KEY_ID;
            const secretAccessKey = this.options.secretAccessKey || process.env.VELOCIOUS_ATTACHMENTS_S3_SECRET_ACCESS_KEY;
            if (typeof accessKeyId === "string" && accessKeyId.length > 0 && typeof secretAccessKey === "string" && secretAccessKey.length > 0) {
                clientConfig.credentials = { accessKeyId, secretAccessKey };
            }
            this._client = new S3Client(clientConfig);
        }
        return this._client;
    }
    /**
     * Runs write.
     * @param {object} args - Write args.
     * @param {string} args.attachmentId - Attachment id.
     * @param {import("../normalize-input.js").NormalizedAttachmentInput} args.input - Normalized attachment input.
     * @returns {Promise<{storageKey: string}>} - Storage key.
     */
    async write({ attachmentId, input }) {
        const { PutObjectCommand } = await this.s3Runtime();
        const client = await this.client();
        const storageKey = `${attachmentId}-${input.filename}`;
        /**
         * S3 request body.
         * @type {Buffer | import("node:stream").Readable | null} */
        let body = input.contentBuffer;
        /**
         * Path input stream.
         * @type {import("node:stream").Readable | null} */
        let pathInputStream = null;
        if (input.pathSource) {
            pathInputStream = await input.pathSource.createReadStream();
            body = pathInputStream;
        }
        if (!body)
            throw new Error("S3 attachment input has no content");
        try {
            await client.send(new PutObjectCommand({
                Body: body,
                Bucket: this.bucket(),
                ContentLength: input.byteSize,
                ContentType: input.contentType || undefined,
                Key: storageKey
            }));
        }
        finally {
            if (pathInputStream)
                pathInputStream.destroy();
        }
        return { storageKey };
    }
    /**
     * Runs read.
     * @param {object} args - Read args.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<Buffer>} - Attachment bytes.
     */
    async read({ storageKey }) {
        const { GetObjectCommand } = await this.s3Runtime();
        const client = await this.client();
        const response = await client.send(new GetObjectCommand({
            Bucket: this.bucket(),
            Key: storageKey
        }));
        return await streamToBuffer(response.Body);
    }
    /**
     * Runs delete.
     * @param {object} args - Delete args.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<void>} - Resolves when deleted.
     */
    async delete({ storageKey }) {
        const { DeleteObjectCommand } = await this.s3Runtime();
        const client = await this.client();
        await client.send(new DeleteObjectCommand({
            Bucket: this.bucket(),
            Key: storageKey
        }));
    }
    /**
     * Runs url.
     * @param {object} args - URL args.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<string>} - Signed URL.
     */
    async url({ storageKey }) {
        const runtime = await this.s3Runtime();
        const client = await this.client();
        const command = new runtime.GetObjectCommand({
            Bucket: this.bucket(),
            Key: storageKey
        });
        return await runtime.getSignedUrl(client, command, { expiresIn: this.signedUrlExpiresIn() });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiczMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL3N0b3JhZ2UtZHJpdmVycy9zMy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUNILFNBQVMseUJBQXlCLENBQUMsT0FBTztJQUN4QyxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxPQUFPLEVBQUUsQ0FBQyxDQUFBO0FBQzVFLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxnQkFBZ0IsQ0FBQyxLQUFLO0lBQzdCLE9BQU8sT0FBTyxDQUFDLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyw0Q0FBNEMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksS0FBSyxVQUFVLENBQUMsQ0FBQTtBQUN2SSxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxhQUFhLENBQUMsU0FBUztJQUNwQyxNQUFNLFFBQVEsR0FBRyxrRkFBa0YsQ0FBQyxDQUNsRyxJQUFJLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxnQ0FBZ0MsQ0FBQyxDQUNsRSxDQUFBO0lBRUQsT0FBTyxNQUFNLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQTtBQUNsQyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxjQUFjLENBQUMsS0FBSztJQUNqQyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxLQUFLLENBQUE7SUFDeEMsSUFBSSxLQUFLLFlBQVksVUFBVTtRQUFFLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMxRCxJQUFJLEtBQUssWUFBWSxXQUFXO1FBQUUsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBRTNELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENB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LENBQUM7WUFDeEMsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDckIsR0FBRyxFQUFFLFVBQVU7U0FDaEIsQ0FBQyxDQUFDLENBQUE7SUFDTCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUMsVUFBVSxFQUFDO1FBQ3BCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQ3RDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ2xDLE1BQU0sT0FBTyxHQUFHLElBQUksT0FBTyxDQUFDLGdCQUFnQixDQUFDO1lBQzNDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ3JCLEdBQUcsRUFBRSxVQUFVO1NBQ2hCLENBQUMsQ0FBQTtRQUVGLE9BQU8sTUFBTSxPQUFPLENBQUMsWUFBWSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsRUFBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixFQUFFLEVBQUMsQ0FBQyxDQUFBO0lBQzVGLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFJ1bnMgdGhyb3cgczMgY29uZmlndXJhdGlvbiBlcnJvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHtuZXZlcn0gLSBBbHdheXMgdGhyb3dzLlxuICovXG5mdW5jdGlvbiB0aHJvd1MzQ29uZmlndXJhdGlvbkVycm9yKG1lc3NhZ2UpIHtcbiAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIFMzIGF0dGFjaG1lbnQgc3RvcmFnZSBjb25maWd1cmF0aW9uOiAke21lc3NhZ2V9YClcbn1cblxuLyoqXG4gKiBSdW5zIGlzIHJlYWRhYmxlIHN0cmVhbS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBpcyBhIHJlYWRhYmxlIHN0cmVhbS5cbiAqL1xuZnVuY3Rpb24gaXNSZWFkYWJsZVN0cmVhbSh2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkucGlwZSA9PT0gXCJmdW5jdGlvblwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZHluYW1pYyBpbXBvcnQuXG4gKiBAcGFyYW0ge3N0cmluZ30gc3BlY2lmaWVyIC0gTW9kdWxlIHNwZWNpZmllci5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBJbXBvcnRlZCBtb2R1bGUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGR5bmFtaWNJbXBvcnQoc3BlY2lmaWVyKSB7XG4gIGNvbnN0IGltcG9ydGVyID0gLyoqIEB0eXBlIHsobW9kdWxlU3BlY2lmaWVyOiBzdHJpbmcpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoXG4gICAgbmV3IEZ1bmN0aW9uKFwibW9kdWxlU3BlY2lmaWVyXCIsIFwicmV0dXJuIGltcG9ydChtb2R1bGVTcGVjaWZpZXIpXCIpXG4gIClcblxuICByZXR1cm4gYXdhaXQgaW1wb3J0ZXIoc3BlY2lmaWVyKVxufVxuXG4vKipcbiAqIFJ1bnMgc3RyZWFtIHRvIGJ1ZmZlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge1Byb21pc2U8QnVmZmVyPn0gLSBCdWZmZXIgdmFsdWUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHN0cmVhbVRvQnVmZmVyKHZhbHVlKSB7XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIodmFsdWUpKSByZXR1cm4gdmFsdWVcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSkgcmV0dXJuIEJ1ZmZlci5mcm9tKHZhbHVlKVxuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikgcmV0dXJuIEJ1ZmZlci5mcm9tKHZhbHVlKVxuXG4gIGlmICghaXNSZWFkYWJsZVN0cmVhbSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIFMzIGJvZHkgdHlwZTogJHtTdHJpbmcodmFsdWUpfWApXG4gIH1cblxuICAvKipcbiAgICogQ2h1bmtzLlxuICAgKiBAdHlwZSB7QnVmZmVyW119ICovXG4gIGNvbnN0IGNodW5rcyA9IFtdXG5cbiAgY29uc3QgcmVhZGFibGVTdHJlYW0gPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpXG5cbiAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIHJlYWRhYmxlU3RyZWFtLm9uKFwiZGF0YVwiLCAoLyoqIEB0eXBlIHtCdWZmZXIgfCBVaW50OEFycmF5IHwgQXJyYXlCdWZmZXIgfCBzdHJpbmd9ICovIGNodW5rKSA9PiB7XG4gICAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKGNodW5rKSkge1xuICAgICAgICBjaHVua3MucHVzaChjaHVuaylcbiAgICAgIH0gZWxzZSBpZiAoY2h1bmsgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgICBjaHVua3MucHVzaChCdWZmZXIuZnJvbShjaHVuaykpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjaHVua3MucHVzaChCdWZmZXIuZnJvbShjaHVuaykpXG4gICAgICB9XG4gICAgfSlcbiAgICByZWFkYWJsZVN0cmVhbS5vbihcImVycm9yXCIsIHJlamVjdClcbiAgICByZWFkYWJsZVN0cmVhbS5vbihcImVuZFwiLCByZXNvbHZlKVxuICB9KVxuXG4gIHJldHVybiBCdWZmZXIuY29uY2F0KGNodW5rcylcbn1cblxuLyoqXG4gKiBTMyBhdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTM0F0dGFjaG1lbnRTdG9yYWdlRHJpdmVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLm9wdGlvbnNdIC0gRHJpdmVyIG9wdGlvbnMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7b3B0aW9ucyA9IHt9fSkge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnNcbiAgICB0aGlzLl9jbGllbnRQcm9taXNlID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVja2V0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFMzIGJ1Y2tldCBuYW1lLlxuICAgKi9cbiAgYnVja2V0KCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGhpcy5vcHRpb25zLmJ1Y2tldCB8fCBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQVRUQUNITUVOVFNfUzNfQlVDS0VUXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93UzNDb25maWd1cmF0aW9uRXJyb3IoXCJtaXNzaW5nIGJ1Y2tldFwiKVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2lnbmVkIHVybCBleHBpcmVzIGluLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFNpZ25lZCBVUkwgZXhwaXJhdGlvbiBpbiBzZWNvbmRzLlxuICAgKi9cbiAgc2lnbmVkVXJsRXhwaXJlc0luKCkge1xuICAgIGNvbnN0IHZhbHVlID0gTnVtYmVyKHRoaXMub3B0aW9ucy5zaWduZWRVcmxFeHBpcmVzSW4gPz8gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0FUVEFDSE1FTlRTX1MzX1NJR05FRF9VUkxfRVhQSVJFU19JTiA/PyAzNjAwKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDwgMSkgcmV0dXJuIDM2MDBcblxuICAgIHJldHVybiBNYXRoLmZsb29yKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgczMgcnVudGltZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e1MzQ2xpZW50OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgUHV0T2JqZWN0Q29tbWFuZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIEdldE9iamVjdENvbW1hbmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBEZWxldGVPYmplY3RDb21tYW5kOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZ2V0U2lnbmVkVXJsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAtIFMzIHJ1bnRpbWUuXG4gICAqL1xuICBhc3luYyBzM1J1bnRpbWUoKSB7XG4gICAgaWYgKCF0aGlzLl9jbGllbnRQcm9taXNlKSB7XG4gICAgICB0aGlzLl9jbGllbnRQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgW3tTM0NsaWVudCwgUHV0T2JqZWN0Q29tbWFuZCwgR2V0T2JqZWN0Q29tbWFuZCwgRGVsZXRlT2JqZWN0Q29tbWFuZH0sIHtnZXRTaWduZWRVcmx9XSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICBkeW5hbWljSW1wb3J0KFwiQGF3cy1zZGsvY2xpZW50LXMzXCIpLFxuICAgICAgICAgIGR5bmFtaWNJbXBvcnQoXCJAYXdzLXNkay9zMy1yZXF1ZXN0LXByZXNpZ25lclwiKVxuICAgICAgICBdKVxuXG4gICAgICAgIHJldHVybiB7RGVsZXRlT2JqZWN0Q29tbWFuZCwgR2V0T2JqZWN0Q29tbWFuZCwgUHV0T2JqZWN0Q29tbWFuZCwgUzNDbGllbnQsIGdldFNpZ25lZFVybH1cbiAgICAgIH0pKClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2xpZW50UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUzMgY2xpZW50LlxuICAgKi9cbiAgYXN5bmMgY2xpZW50KCkge1xuICAgIGlmICghdGhpcy5fY2xpZW50KSB7XG4gICAgICBjb25zdCB7UzNDbGllbnR9ID0gYXdhaXQgdGhpcy5zM1J1bnRpbWUoKVxuICAgICAgLyoqXG4gICAgICAgKiBDbGllbnQgY29uZmlnLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGNsaWVudENvbmZpZyA9IHtcbiAgICAgICAgcmVnaW9uOiB0aGlzLm9wdGlvbnMucmVnaW9uIHx8IHByb2Nlc3MuZW52LlZFTE9DSU9VU19BVFRBQ0hNRU5UU19TM19SRUdJT04gfHwgXCJ1cy1lYXN0LTFcIlxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHRoaXMub3B0aW9ucy5lbmRwb2ludCA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLm9wdGlvbnMuZW5kcG9pbnQubGVuZ3RoID4gMCkge1xuICAgICAgICBjbGllbnRDb25maWcuZW5kcG9pbnQgPSB0aGlzLm9wdGlvbnMuZW5kcG9pbnRcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiB0aGlzLm9wdGlvbnMuZm9yY2VQYXRoU3R5bGUgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICAgIGNsaWVudENvbmZpZy5mb3JjZVBhdGhTdHlsZSA9IHRoaXMub3B0aW9ucy5mb3JjZVBhdGhTdHlsZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhY2Nlc3NLZXlJZCA9IHRoaXMub3B0aW9ucy5hY2Nlc3NLZXlJZCB8fCBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQVRUQUNITUVOVFNfUzNfQUNDRVNTX0tFWV9JRFxuICAgICAgY29uc3Qgc2VjcmV0QWNjZXNzS2V5ID0gdGhpcy5vcHRpb25zLnNlY3JldEFjY2Vzc0tleSB8fCBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQVRUQUNITUVOVFNfUzNfU0VDUkVUX0FDQ0VTU19LRVlcblxuICAgICAgaWYgKHR5cGVvZiBhY2Nlc3NLZXlJZCA9PT0gXCJzdHJpbmdcIiAmJiBhY2Nlc3NLZXlJZC5sZW5ndGggPiAwICYmIHR5cGVvZiBzZWNyZXRBY2Nlc3NLZXkgPT09IFwic3RyaW5nXCIgJiYgc2VjcmV0QWNjZXNzS2V5Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2xpZW50Q29uZmlnLmNyZWRlbnRpYWxzID0ge2FjY2Vzc0tleUlkLCBzZWNyZXRBY2Nlc3NLZXl9XG4gICAgICB9XG5cbiAgICAgIHRoaXMuX2NsaWVudCA9IG5ldyBTM0NsaWVudChjbGllbnRDb25maWcpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd3JpdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV3JpdGUgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0YWNobWVudElkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gYXJncy5pbnB1dCAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3N0b3JhZ2VLZXk6IHN0cmluZ30+fSAtIFN0b3JhZ2Uga2V5LlxuICAgKi9cbiAgYXN5bmMgd3JpdGUoe2F0dGFjaG1lbnRJZCwgaW5wdXR9KSB7XG4gICAgY29uc3Qge1B1dE9iamVjdENvbW1hbmR9ID0gYXdhaXQgdGhpcy5zM1J1bnRpbWUoKVxuICAgIGNvbnN0IGNsaWVudCA9IGF3YWl0IHRoaXMuY2xpZW50KClcbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gYCR7YXR0YWNobWVudElkfS0ke2lucHV0LmZpbGVuYW1lfWBcbiAgICAvKipcbiAgICAgKiBTMyByZXF1ZXN0IGJvZHkuXG4gICAgICogQHR5cGUge0J1ZmZlciB8IGltcG9ydChcIm5vZGU6c3RyZWFtXCIpLlJlYWRhYmxlIHwgbnVsbH0gKi9cbiAgICBsZXQgYm9keSA9IGlucHV0LmNvbnRlbnRCdWZmZXJcbiAgICAvKipcbiAgICAgKiBQYXRoIGlucHV0IHN0cmVhbS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwibm9kZTpzdHJlYW1cIikuUmVhZGFibGUgfCBudWxsfSAqL1xuICAgIGxldCBwYXRoSW5wdXRTdHJlYW0gPSBudWxsXG5cbiAgICBpZiAoaW5wdXQucGF0aFNvdXJjZSkge1xuICAgICAgcGF0aElucHV0U3RyZWFtID0gYXdhaXQgaW5wdXQucGF0aFNvdXJjZS5jcmVhdGVSZWFkU3RyZWFtKClcbiAgICAgIGJvZHkgPSBwYXRoSW5wdXRTdHJlYW1cbiAgICB9XG5cbiAgICBpZiAoIWJvZHkpIHRocm93IG5ldyBFcnJvcihcIlMzIGF0dGFjaG1lbnQgaW5wdXQgaGFzIG5vIGNvbnRlbnRcIilcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQuc2VuZChuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgIEJvZHk6IGJvZHksXG4gICAgICAgIEJ1Y2tldDogdGhpcy5idWNrZXQoKSxcbiAgICAgICAgQ29udGVudExlbmd0aDogaW5wdXQuYnl0ZVNpemUsXG4gICAgICAgIENvbnRlbnRUeXBlOiBpbnB1dC5jb250ZW50VHlwZSB8fCB1bmRlZmluZWQsXG4gICAgICAgIEtleTogc3RvcmFnZUtleVxuICAgICAgfSkpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChwYXRoSW5wdXRTdHJlYW0pIHBhdGhJbnB1dFN0cmVhbS5kZXN0cm95KClcbiAgICB9XG5cbiAgICByZXR1cm4ge3N0b3JhZ2VLZXl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlYWQgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RvcmFnZUtleSAtIFN0b3JhZ2Uga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxCdWZmZXI+fSAtIEF0dGFjaG1lbnQgYnl0ZXMuXG4gICAqL1xuICBhc3luYyByZWFkKHtzdG9yYWdlS2V5fSkge1xuICAgIGNvbnN0IHtHZXRPYmplY3RDb21tYW5kfSA9IGF3YWl0IHRoaXMuczNSdW50aW1lKClcbiAgICBjb25zdCBjbGllbnQgPSBhd2FpdCB0aGlzLmNsaWVudCgpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICBCdWNrZXQ6IHRoaXMuYnVja2V0KCksXG4gICAgICBLZXk6IHN0b3JhZ2VLZXlcbiAgICB9KSlcblxuICAgIHJldHVybiBhd2FpdCBzdHJlYW1Ub0J1ZmZlcihyZXNwb25zZS5Cb2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERlbGV0ZSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdG9yYWdlS2V5IC0gU3RvcmFnZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZC5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZSh7c3RvcmFnZUtleX0pIHtcbiAgICBjb25zdCB7RGVsZXRlT2JqZWN0Q29tbWFuZH0gPSBhd2FpdCB0aGlzLnMzUnVudGltZSgpXG4gICAgY29uc3QgY2xpZW50ID0gYXdhaXQgdGhpcy5jbGllbnQoKVxuXG4gICAgYXdhaXQgY2xpZW50LnNlbmQobmV3IERlbGV0ZU9iamVjdENvbW1hbmQoe1xuICAgICAgQnVja2V0OiB0aGlzLmJ1Y2tldCgpLFxuICAgICAgS2V5OiBzdG9yYWdlS2V5XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cmwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVVJMIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN0b3JhZ2VLZXkgLSBTdG9yYWdlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTaWduZWQgVVJMLlxuICAgKi9cbiAgYXN5bmMgdXJsKHtzdG9yYWdlS2V5fSkge1xuICAgIGNvbnN0IHJ1bnRpbWUgPSBhd2FpdCB0aGlzLnMzUnVudGltZSgpXG4gICAgY29uc3QgY2xpZW50ID0gYXdhaXQgdGhpcy5jbGllbnQoKVxuICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgcnVudGltZS5HZXRPYmplY3RDb21tYW5kKHtcbiAgICAgIEJ1Y2tldDogdGhpcy5idWNrZXQoKSxcbiAgICAgIEtleTogc3RvcmFnZUtleVxuICAgIH0pXG5cbiAgICByZXR1cm4gYXdhaXQgcnVudGltZS5nZXRTaWduZWRVcmwoY2xpZW50LCBjb21tYW5kLCB7ZXhwaXJlc0luOiB0aGlzLnNpZ25lZFVybEV4cGlyZXNJbigpfSlcbiAgfVxufVxuIl19