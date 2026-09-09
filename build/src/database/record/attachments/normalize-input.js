// @ts-check
import UploadedFile from "../../../http-server/client/uploaded-file/uploaded-file.js";
/**
 * AttachmentPathSource type.
 * @typedef {object} AttachmentPathSource
 * @property {number} byteSize - Opened file snapshot size.
 * @property {string} filePath - Validated source path for metadata only.
 * @property {() => Promise<import("node:stream").Readable>} createReadStream - Creates a bounded snapshot stream.
 * @property {() => Promise<Buffer>} readBuffer - Reads snapshot bytes for compatibility callers.
 * @property {() => Promise<void>} close - Closes the owned source.
 */
/**
 * NormalizedAttachmentInput type.
 * @typedef {object} NormalizedAttachmentInput
 * @property {number} byteSize - File size in bytes.
 * @property {Buffer | null} contentBuffer - Raw in-memory content bytes.
 * @property {string | null} contentBase64 - Base64 encoded in-memory content.
 * @property {string | null} contentType - Content type.
 * @property {string} filename - Filename.
 * @property {AttachmentPathSource | null} pathSource - Environment-owned opened path source.
 */
/**
 * Runs base name.
 * @param {string} value - Path-like value.
 * @returns {string} - Basename-like filename.
 */
function baseName(value) {
    const withoutTrailingSeparators = value.replace(/[\\/]+$/, "");
    if (!withoutTrailingSeparators)
        return "";
    const normalized = withoutTrailingSeparators.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || "";
}
/**
 * Runs is plain object.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is Record<string, ReturnType<typeof JSON.parse>>} - Whether value is a plain object.
 */
function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
/**
 * Runs is uint8 array.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is Uint8Array} - Whether value is a byte array.
 */
function isUint8Array(value) {
    return value instanceof Uint8Array;
}
/**
 * Runs is array buffer.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is ArrayBuffer} - Whether value is array buffer.
 */
function isArrayBuffer(value) {
    return value instanceof ArrayBuffer;
}
/**
 * Runs is array buffer like.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is {arrayBuffer: () => Promise<ArrayBuffer>}} - Whether value supports arrayBuffer().
 */
function isArrayBufferLike(value) {
    return Boolean(value && typeof value === "object" && typeof /** @type {ReturnType<typeof JSON.parse>} */ (value).arrayBuffer === "function");
}
/**
 * Runs to buffer.
 * @param {Uint8Array | Buffer | ArrayBuffer | string} value - Value.
 * @returns {Buffer} - Buffer value.
 */
function toBuffer(value) {
    if (Buffer.isBuffer(value))
        return value;
    if (typeof value === "string")
        return Buffer.from(value);
    if (isArrayBuffer(value))
        return Buffer.from(value);
    if (isUint8Array(value))
        return Buffer.from(value);
    throw new Error("Unsupported attachment content type");
}
/**
 * Runs uploaded file buffer.
 * @param {UploadedFile} uploadedFile - Uploaded file.
 * @param {import("../../../environment-handlers/base.js").default | undefined} environmentHandler - Environment handler.
 * @returns {Promise<Buffer>} - File content buffer.
 */
async function uploadedFileBuffer(uploadedFile, environmentHandler) {
    const memoryBuffer = /** @type {{getBuffer?: () => Buffer}} */ (uploadedFile).getBuffer?.();
    if (Buffer.isBuffer(memoryBuffer))
        return memoryBuffer;
    const tempPath = /** @type {{getPath?: () => string}} */ (uploadedFile).getPath?.();
    if (typeof tempPath === "string" && tempPath.length > 0) {
        if (!environmentHandler || typeof environmentHandler.readAttachmentInputFile !== "function") {
            throw new Error("Attachment temp-path input is unsupported in this environment");
        }
        return await environmentHandler.readAttachmentInputFile(tempPath);
    }
    throw new Error("Unsupported uploaded file type");
}
/**
 * Runs normalize record attachment input.
 * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
 * @param {object} [args] - Options.
 * @param {boolean} [args.allowPathInput] - Whether `{path: ...}` input is allowed.
 * @param {string[]} [args.allowedPathPrefixes] - Optional allowlist for path input.
 * @param {string} [args.defaultFilename] - Optional default filename.
 * @param {import("../../../environment-handlers/base.js").default} [args.environmentHandler] - Optional environment handler for Node-only file operations.
 * @returns {Promise<NormalizedAttachmentInput>} - Normalized attachment input.
 */
export default async function normalizeRecordAttachmentInput(input, args = {}) {
    const defaultFilename = args.defaultFilename || "attachment.bin";
    const environmentHandler = args.environmentHandler;
    /**
     * Defines buffer.
     * @type {Buffer | null} */
    let buffer = null;
    /**
     * Defines byte size.
     * @type {number | null} */
    let byteSize = null;
    /**
     * Defines path source.
     * @type {AttachmentPathSource | null} */
    let pathSource = null;
    /**
     * Content type.
     * @type {string | null} */
    let contentType = null;
    /**
     * Defines filename.
     * @type {string | undefined} */
    let filename;
    if (input instanceof UploadedFile) {
        buffer = await uploadedFileBuffer(input, environmentHandler);
        filename = input.filename();
        contentType = input.contentType() || null;
    }
    else if (isPlainObject(input) && typeof input.path === "string" && input.path.length > 0) {
        if (args.allowPathInput !== true) {
            throw new Error("Attachment path input is disabled");
        }
        if (!environmentHandler || typeof environmentHandler.resolveAttachmentInputPath !== "function") {
            throw new Error("Attachment path input is unsupported in this environment");
        }
        const allowedPathPrefixes = Array.isArray(args.allowedPathPrefixes)
            ? args.allowedPathPrefixes.filter((entry) => typeof entry === "string" && entry.length > 0)
            : [];
        pathSource = await environmentHandler.resolveAttachmentInputPath({
            allowedPathPrefixes,
            inputPath: input.path
        });
        byteSize = pathSource.byteSize;
        filename = typeof input.filename === "string" && input.filename.length > 0
            ? input.filename
            : baseName(pathSource.filePath);
        contentType = typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : null;
    }
    else if (isPlainObject(input) && typeof input.contentBase64 === "string") {
        buffer = Buffer.from(input.contentBase64, "base64");
        filename = typeof input.filename === "string" && input.filename.length > 0 ? input.filename : defaultFilename;
        contentType = typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : null;
    }
    else if (isPlainObject(input) && "content" in input) {
        buffer = toBuffer(input.content);
        filename = typeof input.filename === "string" && input.filename.length > 0 ? input.filename : defaultFilename;
        contentType = typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : null;
    }
    else if (isArrayBufferLike(input)) {
        const arrayBuffer = await input.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        filename = typeof /** @type {ReturnType<typeof JSON.parse>} */ (input).name === "string" && /** @type {ReturnType<typeof JSON.parse>} */ (input).name.length > 0
            ? /** @type {ReturnType<typeof JSON.parse>} */ (input).name
            : defaultFilename;
        contentType = typeof /** @type {ReturnType<typeof JSON.parse>} */ (input).type === "string" && /** @type {ReturnType<typeof JSON.parse>} */ (input).type.length > 0
            ? /** @type {ReturnType<typeof JSON.parse>} */ (input).type
            : null;
    }
    else if (typeof input === "string" || Buffer.isBuffer(input) || isArrayBuffer(input) || isUint8Array(input)) {
        buffer = toBuffer(input);
        filename = defaultFilename;
    }
    else {
        throw new Error("Unsupported attachment input");
    }
    const normalizedFilename = typeof filename === "string" && filename.length > 0
        ? baseName(filename)
        : "";
    if (!buffer && !pathSource) {
        throw new Error("Attachment input normalization produced no content");
    }
    if (buffer)
        byteSize = buffer.length;
    if (byteSize === null)
        throw new Error("Attachment input normalization produced no byte size");
    return {
        byteSize,
        contentBuffer: buffer,
        contentBase64: buffer ? buffer.toString("base64") : null,
        contentType,
        filename: normalizedFilename || defaultFilename,
        pathSource
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm9ybWFsaXplLWlucHV0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3JlY29yZC9hdHRhY2htZW50cy9ub3JtYWxpemUtaW5wdXQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sWUFBWSxNQUFNLDREQUE0RCxDQUFBO0FBRXJGOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7R0FJRztBQUNILFNBQVMsUUFBUSxDQUFDLEtBQUs7SUFDckIsTUFBTSx5QkFBeUIsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUU5RCxJQUFJLENBQUMseUJBQXlCO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFekMsTUFBTSxVQUFVLEdBQUcseUJBQXlCLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQTtJQUNsRSxNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBRW5DLE9BQU8sS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFBO0FBQ3RDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxhQUFhLENBQUMsS0FBSztJQUMxQixJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRTdFLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLENBQUE7SUFFOUMsT0FBTyxTQUFTLEtBQUssTUFBTSxDQUFDLFNBQVMsSUFBSSxTQUFTLEtBQUssSUFBSSxDQUFBO0FBQzdELENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxZQUFZLENBQUMsS0FBSztJQUN6QixP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LElBQUksS0FBSyxDQUFDLDhCQUE4QixDQUFDLENBQUE7SUFDakQsQ0FBQztJQUVELE1BQU0sa0JBQWtCLEdBQUcsT0FBTyxRQUFRLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQztRQUM1RSxDQUFDLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQztRQUNwQixDQUFDLENBQUMsRUFBRSxDQUFBO0lBRU4sSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQzNCLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQTtJQUN2RSxDQUFDO0lBRUQsSUFBSSxNQUFNO1FBQUUsUUFBUSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUE7SUFDcEMsSUFBSSxRQUFRLEtBQUssSUFBSTtRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsc0RBQXNELENBQUMsQ0FBQTtJQUU5RixPQUFPO1FBQ0wsUUFBUTtRQUNSLGFBQWEsRUFBRSxNQUFNO1FBQ3JCLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUk7UUFDeEQsV0FBVztRQUNYLFFBQVEsRUFBRSxrQkFBa0IsSUFBSSxlQUFlO1FBQy9DLFVBQVU7S0FDWCxDQUFBO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVXBsb2FkZWRGaWxlIGZyb20gXCIuLi8uLi8uLi9odHRwLXNlcnZlci9jbGllbnQvdXBsb2FkZWQtZmlsZS91cGxvYWRlZC1maWxlLmpzXCJcblxuLyoqXG4gKiBBdHRhY2htZW50UGF0aFNvdXJjZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQXR0YWNobWVudFBhdGhTb3VyY2VcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBieXRlU2l6ZSAtIE9wZW5lZCBmaWxlIHNuYXBzaG90IHNpemUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZmlsZVBhdGggLSBWYWxpZGF0ZWQgc291cmNlIHBhdGggZm9yIG1ldGFkYXRhIG9ubHkuXG4gKiBAcHJvcGVydHkgeygpID0+IFByb21pc2U8aW1wb3J0KFwibm9kZTpzdHJlYW1cIikuUmVhZGFibGU+fSBjcmVhdGVSZWFkU3RyZWFtIC0gQ3JlYXRlcyBhIGJvdW5kZWQgc25hcHNob3Qgc3RyZWFtLlxuICogQHByb3BlcnR5IHsoKSA9PiBQcm9taXNlPEJ1ZmZlcj59IHJlYWRCdWZmZXIgLSBSZWFkcyBzbmFwc2hvdCBieXRlcyBmb3IgY29tcGF0aWJpbGl0eSBjYWxsZXJzLlxuICogQHByb3BlcnR5IHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjbG9zZSAtIENsb3NlcyB0aGUgb3duZWQgc291cmNlLlxuICovXG4vKipcbiAqIE5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IE5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXRcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBieXRlU2l6ZSAtIEZpbGUgc2l6ZSBpbiBieXRlcy5cbiAqIEBwcm9wZXJ0eSB7QnVmZmVyIHwgbnVsbH0gY29udGVudEJ1ZmZlciAtIFJhdyBpbi1tZW1vcnkgY29udGVudCBieXRlcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gY29udGVudEJhc2U2NCAtIEJhc2U2NCBlbmNvZGVkIGluLW1lbW9yeSBjb250ZW50LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb250ZW50VHlwZSAtIENvbnRlbnQgdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmaWxlbmFtZSAtIEZpbGVuYW1lLlxuICogQHByb3BlcnR5IHtBdHRhY2htZW50UGF0aFNvdXJjZSB8IG51bGx9IHBhdGhTb3VyY2UgLSBFbnZpcm9ubWVudC1vd25lZCBvcGVuZWQgcGF0aCBzb3VyY2UuXG4gKi9cbi8qKlxuICogUnVucyBiYXNlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBQYXRoLWxpa2UgdmFsdWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJhc2VuYW1lLWxpa2UgZmlsZW5hbWUuXG4gKi9cbmZ1bmN0aW9uIGJhc2VOYW1lKHZhbHVlKSB7XG4gIGNvbnN0IHdpdGhvdXRUcmFpbGluZ1NlcGFyYXRvcnMgPSB2YWx1ZS5yZXBsYWNlKC9bXFxcXC9dKyQvLCBcIlwiKVxuXG4gIGlmICghd2l0aG91dFRyYWlsaW5nU2VwYXJhdG9ycykgcmV0dXJuIFwiXCJcblxuICBjb25zdCBub3JtYWxpemVkID0gd2l0aG91dFRyYWlsaW5nU2VwYXJhdG9ycy5yZXBsYWNlQWxsKFwiXFxcXFwiLCBcIi9cIilcbiAgY29uc3QgcGFydHMgPSBub3JtYWxpemVkLnNwbGl0KFwiL1wiKVxuXG4gIHJldHVybiBwYXJ0c1twYXJ0cy5sZW5ndGggLSAxXSB8fCBcIlwiXG59XG5cbi8qKlxuICogUnVucyBpcyBwbGFpbiBvYmplY3QuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2hldGhlciB2YWx1ZSBpcyBhIHBsYWluIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gaXNQbGFpbk9iamVjdCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKVxuXG4gIHJldHVybiBwcm90b3R5cGUgPT09IE9iamVjdC5wcm90b3R5cGUgfHwgcHJvdG90eXBlID09PSBudWxsXG59XG5cbi8qKlxuICogUnVucyBpcyB1aW50OCBhcnJheS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIFVpbnQ4QXJyYXl9IC0gV2hldGhlciB2YWx1ZSBpcyBhIGJ5dGUgYXJyYXkuXG4gKi9cbmZ1bmN0aW9uIGlzVWludDhBcnJheSh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgaW5zdGFuY2VvZiBVaW50OEFycmF5XG59XG5cbi8qKlxuICogUnVucyBpcyBhcnJheSBidWZmZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBBcnJheUJ1ZmZlcn0gLSBXaGV0aGVyIHZhbHVlIGlzIGFycmF5IGJ1ZmZlci5cbiAqL1xuZnVuY3Rpb24gaXNBcnJheUJ1ZmZlcih2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlclxufVxuXG4vKipcbiAqIFJ1bnMgaXMgYXJyYXkgYnVmZmVyIGxpa2UuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyB7YXJyYXlCdWZmZXI6ICgpID0+IFByb21pc2U8QXJyYXlCdWZmZXI+fX0gLSBXaGV0aGVyIHZhbHVlIHN1cHBvcnRzIGFycmF5QnVmZmVyKCkuXG4gKi9cbmZ1bmN0aW9uIGlzQXJyYXlCdWZmZXJMaWtlKHZhbHVlKSB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHZhbHVlKS5hcnJheUJ1ZmZlciA9PT0gXCJmdW5jdGlvblwiKVxufVxuXG4vKipcbiAqIFJ1bnMgdG8gYnVmZmVyLlxuICogQHBhcmFtIHtVaW50OEFycmF5IHwgQnVmZmVyIHwgQXJyYXlCdWZmZXIgfCBzdHJpbmd9IHZhbHVlIC0gVmFsdWUuXG4gKiBAcmV0dXJucyB7QnVmZmVyfSAtIEJ1ZmZlciB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gdG9CdWZmZXIodmFsdWUpIHtcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpIHJldHVybiB2YWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSByZXR1cm4gQnVmZmVyLmZyb20odmFsdWUpXG4gIGlmIChpc0FycmF5QnVmZmVyKHZhbHVlKSkgcmV0dXJuIEJ1ZmZlci5mcm9tKHZhbHVlKVxuICBpZiAoaXNVaW50OEFycmF5KHZhbHVlKSkgcmV0dXJuIEJ1ZmZlci5mcm9tKHZhbHVlKVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGF0dGFjaG1lbnQgY29udGVudCB0eXBlXCIpXG59XG5cbi8qKlxuICogUnVucyB1cGxvYWRlZCBmaWxlIGJ1ZmZlci5cbiAqIEBwYXJhbSB7VXBsb2FkZWRGaWxlfSB1cGxvYWRlZEZpbGUgLSBVcGxvYWRlZCBmaWxlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGVudmlyb25tZW50SGFuZGxlciAtIEVudmlyb25tZW50IGhhbmRsZXIuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxCdWZmZXI+fSAtIEZpbGUgY29udGVudCBidWZmZXIuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHVwbG9hZGVkRmlsZUJ1ZmZlcih1cGxvYWRlZEZpbGUsIGVudmlyb25tZW50SGFuZGxlcikge1xuICBjb25zdCBtZW1vcnlCdWZmZXIgPSAvKiogQHR5cGUge3tnZXRCdWZmZXI/OiAoKSA9PiBCdWZmZXJ9fSAqLyAodXBsb2FkZWRGaWxlKS5nZXRCdWZmZXI/LigpXG5cbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihtZW1vcnlCdWZmZXIpKSByZXR1cm4gbWVtb3J5QnVmZmVyXG5cbiAgY29uc3QgdGVtcFBhdGggPSAvKiogQHR5cGUge3tnZXRQYXRoPzogKCkgPT4gc3RyaW5nfX0gKi8gKHVwbG9hZGVkRmlsZSkuZ2V0UGF0aD8uKClcblxuICBpZiAodHlwZW9mIHRlbXBQYXRoID09PSBcInN0cmluZ1wiICYmIHRlbXBQYXRoLmxlbmd0aCA+IDApIHtcbiAgICBpZiAoIWVudmlyb25tZW50SGFuZGxlciB8fCB0eXBlb2YgZW52aXJvbm1lbnRIYW5kbGVyLnJlYWRBdHRhY2htZW50SW5wdXRGaWxlICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGFjaG1lbnQgdGVtcC1wYXRoIGlucHV0IGlzIHVuc3VwcG9ydGVkIGluIHRoaXMgZW52aXJvbm1lbnRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLnJlYWRBdHRhY2htZW50SW5wdXRGaWxlKHRlbXBQYXRoKVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgdXBsb2FkZWQgZmlsZSB0eXBlXCIpXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcmVjb3JkIGF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuYWxsb3dQYXRoSW5wdXRdIC0gV2hldGhlciBge3BhdGg6IC4uLn1gIGlucHV0IGlzIGFsbG93ZWQuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5hbGxvd2VkUGF0aFByZWZpeGVzXSAtIE9wdGlvbmFsIGFsbG93bGlzdCBmb3IgcGF0aCBpbnB1dC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kZWZhdWx0RmlsZW5hbWVdIC0gT3B0aW9uYWwgZGVmYXVsdCBmaWxlbmFtZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZW52aXJvbm1lbnQtaGFuZGxlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbYXJncy5lbnZpcm9ubWVudEhhbmRsZXJdIC0gT3B0aW9uYWwgZW52aXJvbm1lbnQgaGFuZGxlciBmb3IgTm9kZS1vbmx5IGZpbGUgb3BlcmF0aW9ucy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPE5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXQ+fSAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudCBpbnB1dC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgYXN5bmMgZnVuY3Rpb24gbm9ybWFsaXplUmVjb3JkQXR0YWNobWVudElucHV0KGlucHV0LCBhcmdzID0ge30pIHtcbiAgY29uc3QgZGVmYXVsdEZpbGVuYW1lID0gYXJncy5kZWZhdWx0RmlsZW5hbWUgfHwgXCJhdHRhY2htZW50LmJpblwiXG4gIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IGFyZ3MuZW52aXJvbm1lbnRIYW5kbGVyXG4gIC8qKlxuICAgKiBEZWZpbmVzIGJ1ZmZlci5cbiAgICogQHR5cGUge0J1ZmZlciB8IG51bGx9ICovXG4gIGxldCBidWZmZXIgPSBudWxsXG4gIC8qKlxuICAgKiBEZWZpbmVzIGJ5dGUgc2l6ZS5cbiAgICogQHR5cGUge251bWJlciB8IG51bGx9ICovXG4gIGxldCBieXRlU2l6ZSA9IG51bGxcbiAgLyoqXG4gICAqIERlZmluZXMgcGF0aCBzb3VyY2UuXG4gICAqIEB0eXBlIHtBdHRhY2htZW50UGF0aFNvdXJjZSB8IG51bGx9ICovXG4gIGxldCBwYXRoU291cmNlID0gbnVsbFxuICAvKipcbiAgICogQ29udGVudCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgbGV0IGNvbnRlbnRUeXBlID0gbnVsbFxuICAvKipcbiAgICogRGVmaW5lcyBmaWxlbmFtZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgbGV0IGZpbGVuYW1lXG5cbiAgaWYgKGlucHV0IGluc3RhbmNlb2YgVXBsb2FkZWRGaWxlKSB7XG4gICAgYnVmZmVyID0gYXdhaXQgdXBsb2FkZWRGaWxlQnVmZmVyKGlucHV0LCBlbnZpcm9ubWVudEhhbmRsZXIpXG4gICAgZmlsZW5hbWUgPSBpbnB1dC5maWxlbmFtZSgpXG4gICAgY29udGVudFR5cGUgPSBpbnB1dC5jb250ZW50VHlwZSgpIHx8IG51bGxcbiAgfSBlbHNlIGlmIChpc1BsYWluT2JqZWN0KGlucHV0KSAmJiB0eXBlb2YgaW5wdXQucGF0aCA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5wYXRoLmxlbmd0aCA+IDApIHtcbiAgICBpZiAoYXJncy5hbGxvd1BhdGhJbnB1dCAhPT0gdHJ1ZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBwYXRoIGlucHV0IGlzIGRpc2FibGVkXCIpXG4gICAgfVxuXG4gICAgaWYgKCFlbnZpcm9ubWVudEhhbmRsZXIgfHwgdHlwZW9mIGVudmlyb25tZW50SGFuZGxlci5yZXNvbHZlQXR0YWNobWVudElucHV0UGF0aCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggaW5wdXQgaXMgdW5zdXBwb3J0ZWQgaW4gdGhpcyBlbnZpcm9ubWVudFwiKVxuICAgIH1cblxuICAgIGNvbnN0IGFsbG93ZWRQYXRoUHJlZml4ZXMgPSBBcnJheS5pc0FycmF5KGFyZ3MuYWxsb3dlZFBhdGhQcmVmaXhlcylcbiAgICAgID8gYXJncy5hbGxvd2VkUGF0aFByZWZpeGVzLmZpbHRlcigoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIiAmJiBlbnRyeS5sZW5ndGggPiAwKVxuICAgICAgOiBbXVxuICAgIHBhdGhTb3VyY2UgPSBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIucmVzb2x2ZUF0dGFjaG1lbnRJbnB1dFBhdGgoe1xuICAgICAgYWxsb3dlZFBhdGhQcmVmaXhlcyxcbiAgICAgIGlucHV0UGF0aDogaW5wdXQucGF0aFxuICAgIH0pXG5cbiAgICBieXRlU2l6ZSA9IHBhdGhTb3VyY2UuYnl0ZVNpemVcbiAgICBmaWxlbmFtZSA9IHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwXG4gICAgICA/IGlucHV0LmZpbGVuYW1lXG4gICAgICA6IGJhc2VOYW1lKHBhdGhTb3VyY2UuZmlsZVBhdGgpXG4gICAgY29udGVudFR5cGUgPSB0eXBlb2YgaW5wdXQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGlucHV0LmNvbnRlbnRUeXBlIDogbnVsbFxuICB9IGVsc2UgaWYgKGlzUGxhaW5PYmplY3QoaW5wdXQpICYmIHR5cGVvZiBpbnB1dC5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgYnVmZmVyID0gQnVmZmVyLmZyb20oaW5wdXQuY29udGVudEJhc2U2NCwgXCJiYXNlNjRcIilcbiAgICBmaWxlbmFtZSA9IHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwID8gaW5wdXQuZmlsZW5hbWUgOiBkZWZhdWx0RmlsZW5hbWVcbiAgICBjb250ZW50VHlwZSA9IHR5cGVvZiBpbnB1dC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5jb250ZW50VHlwZS5sZW5ndGggPiAwID8gaW5wdXQuY29udGVudFR5cGUgOiBudWxsXG4gIH0gZWxzZSBpZiAoaXNQbGFpbk9iamVjdChpbnB1dCkgJiYgXCJjb250ZW50XCIgaW4gaW5wdXQpIHtcbiAgICBidWZmZXIgPSB0b0J1ZmZlcihpbnB1dC5jb250ZW50KVxuICAgIGZpbGVuYW1lID0gdHlwZW9mIGlucHV0LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGlucHV0LmZpbGVuYW1lLmxlbmd0aCA+IDAgPyBpbnB1dC5maWxlbmFtZSA6IGRlZmF1bHRGaWxlbmFtZVxuICAgIGNvbnRlbnRUeXBlID0gdHlwZW9mIGlucHV0LmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGlucHV0LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBpbnB1dC5jb250ZW50VHlwZSA6IG51bGxcbiAgfSBlbHNlIGlmIChpc0FycmF5QnVmZmVyTGlrZShpbnB1dCkpIHtcbiAgICBjb25zdCBhcnJheUJ1ZmZlciA9IGF3YWl0IGlucHV0LmFycmF5QnVmZmVyKClcblxuICAgIGJ1ZmZlciA9IEJ1ZmZlci5mcm9tKGFycmF5QnVmZmVyKVxuICAgIGZpbGVuYW1lID0gdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZSA9PT0gXCJzdHJpbmdcIiAmJiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLm5hbWUubGVuZ3RoID4gMFxuICAgICAgPyAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLm5hbWVcbiAgICAgIDogZGVmYXVsdEZpbGVuYW1lXG4gICAgY29udGVudFR5cGUgPSB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZS5sZW5ndGggPiAwXG4gICAgICA/IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZVxuICAgICAgOiBudWxsXG4gIH0gZWxzZSBpZiAodHlwZW9mIGlucHV0ID09PSBcInN0cmluZ1wiIHx8IEJ1ZmZlci5pc0J1ZmZlcihpbnB1dCkgfHwgaXNBcnJheUJ1ZmZlcihpbnB1dCkgfHwgaXNVaW50OEFycmF5KGlucHV0KSkge1xuICAgIGJ1ZmZlciA9IHRvQnVmZmVyKGlucHV0KVxuICAgIGZpbGVuYW1lID0gZGVmYXVsdEZpbGVuYW1lXG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgYXR0YWNobWVudCBpbnB1dFwiKVxuICB9XG5cbiAgY29uc3Qgbm9ybWFsaXplZEZpbGVuYW1lID0gdHlwZW9mIGZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGZpbGVuYW1lLmxlbmd0aCA+IDBcbiAgICA/IGJhc2VOYW1lKGZpbGVuYW1lKVxuICAgIDogXCJcIlxuXG4gIGlmICghYnVmZmVyICYmICFwYXRoU291cmNlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBpbnB1dCBub3JtYWxpemF0aW9uIHByb2R1Y2VkIG5vIGNvbnRlbnRcIilcbiAgfVxuXG4gIGlmIChidWZmZXIpIGJ5dGVTaXplID0gYnVmZmVyLmxlbmd0aFxuICBpZiAoYnl0ZVNpemUgPT09IG51bGwpIHRocm93IG5ldyBFcnJvcihcIkF0dGFjaG1lbnQgaW5wdXQgbm9ybWFsaXphdGlvbiBwcm9kdWNlZCBubyBieXRlIHNpemVcIilcblxuICByZXR1cm4ge1xuICAgIGJ5dGVTaXplLFxuICAgIGNvbnRlbnRCdWZmZXI6IGJ1ZmZlcixcbiAgICBjb250ZW50QmFzZTY0OiBidWZmZXIgPyBidWZmZXIudG9TdHJpbmcoXCJiYXNlNjRcIikgOiBudWxsLFxuICAgIGNvbnRlbnRUeXBlLFxuICAgIGZpbGVuYW1lOiBub3JtYWxpemVkRmlsZW5hbWUgfHwgZGVmYXVsdEZpbGVuYW1lLFxuICAgIHBhdGhTb3VyY2VcbiAgfVxufVxuIl19