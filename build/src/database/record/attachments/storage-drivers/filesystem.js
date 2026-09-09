// @ts-check
import { createWriteStream } from "node:fs";
import fs from "fs/promises";
import path from "path";
import { pipeline } from "node:stream/promises";
/**
 * Runs normalize base url.
 * @param {string} value - URL value.
 * @returns {string} - URL without trailing slash.
 */
function normalizeBaseUrl(value) {
    return value.replace(/\/+$/, "");
}
/**
 * Runs encode storage key.
 * @param {string} storageKey - Storage key.
 * @returns {string} - URL-safe storage key.
 */
function encodeStorageKey(storageKey) {
    return storageKey.split("/").map((entry) => encodeURIComponent(entry)).join("/");
}
/**
 * Filesystem attachment storage driver.
 */
export default class FilesystemAttachmentStorageDriver {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../../../../configuration.js").default} args.configuration - Configuration instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.options] - Driver options.
     */
    constructor({ configuration, options = {} }) {
        this.configuration = configuration;
        this.options = options;
    }
    /**
     * Runs directory.
     * @returns {string} - Root directory for attachment files.
     */
    directory() {
        if (typeof this.options.directory === "string" && this.options.directory.length > 0) {
            return path.resolve(this.options.directory);
        }
        return path.resolve(this.configuration.getDirectory(), "tmp/attachments/filesystem");
    }
    /**
     * Runs write.
     * @param {object} args - Options.
     * @param {string} args.attachmentId - Attachment id.
     * @param {import("../normalize-input.js").NormalizedAttachmentInput} args.input - Normalized attachment input.
     * @returns {Promise<{storageKey: string}>} - Storage key result.
     */
    async write({ attachmentId, input }) {
        const normalizedFilename = path.basename(input.filename || "attachment.bin");
        const storageKey = `${attachmentId}-${normalizedFilename}`;
        const filePath = path.resolve(this.directory(), storageKey);
        const temporaryFilePath = `${filePath}.tmp`;
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        try {
            if (input.pathSource) {
                await pipeline(await input.pathSource.createReadStream(), createWriteStream(temporaryFilePath));
            }
            else if (input.contentBuffer) {
                await fs.writeFile(temporaryFilePath, input.contentBuffer);
            }
            else {
                throw new Error("Filesystem attachment input has no content");
            }
            await fs.rename(temporaryFilePath, filePath);
        }
        catch (error) {
            try {
                await fs.unlink(temporaryFilePath);
            }
            catch (cleanupError) {
                if (!(cleanupError instanceof Error) || !("code" in cleanupError) || cleanupError.code !== "ENOENT") {
                    throw new AggregateError([error, cleanupError], `Filesystem attachment write and partial-file cleanup both failed for ${storageKey}`, { cause: cleanupError });
                }
            }
            throw error;
        }
        return { storageKey };
    }
    /**
     * Runs read.
     * @param {object} args - Options.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<Buffer>} - Attachment bytes.
     */
    async read({ storageKey }) {
        const filePath = path.resolve(this.directory(), storageKey);
        return await fs.readFile(filePath);
    }
    /**
     * Runs delete.
     * @param {object} args - Options.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<void>} - Resolves when file has been deleted.
     */
    async delete({ storageKey }) {
        const filePath = path.resolve(this.directory(), storageKey);
        try {
            await fs.unlink(filePath);
        }
        catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
                throw error;
            }
        }
    }
    /**
     * Runs url.
     * @param {object} args - Options.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<string>} - Resolvable URL.
     */
    async url({ storageKey }) {
        if (typeof this.options.baseUrl === "string" && this.options.baseUrl.length > 0) {
            return `${normalizeBaseUrl(this.options.baseUrl)}/${encodeStorageKey(storageKey)}`;
        }
        const filePath = path.resolve(this.directory(), storageKey);
        return `file://${filePath}`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmlsZXN5c3RlbS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvYXR0YWNobWVudHMvc3RvcmFnZS1kcml2ZXJzL2ZpbGVzeXN0ZW0uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUMzQyxPQUFPLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDNUIsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxzQkFBc0IsQ0FBQTtBQUUvQzs7OztHQUlHO0FBQ0gsU0FBUyxnQkFBZ0IsQ0FBQyxLQUFLO0lBQzdCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUE7QUFDbEMsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGdCQUFnQixDQUFDLFVBQVU7SUFDbEMsT0FBTyxVQUFVLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7QUFDbEYsQ0FBQztBQUVEOztHQUVHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQ0FBaUM7SUFDcEQ7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLE9BQU8sR0FBRyxFQUFFLEVBQUM7UUFDdkMsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVM7UUFDUCxJQUFJLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxPQUFP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UyxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUE7UUFFM0QsSUFBSSxDQUFDO1lBQ0gsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQzNCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLENBQUMsS0FBSyxZQUFZLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDL0UsTUFBTSxLQUFLLENBQUE7WUFDYixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBQyxVQUFVLEVBQUM7UUFDcEIsSUFBSSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxLQUFLLFFBQVEsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDaEYsT0FBTyxHQUFHLGdCQUFnQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksZ0JBQWdCLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQTtRQUNwRixDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUE7UUFFM0QsT0FBTyxVQUFVLFFBQVEsRUFBRSxDQUFBO0lBQzdCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBjcmVhdGVXcml0ZVN0cmVhbSB9IGZyb20gXCJub2RlOmZzXCJcbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHsgcGlwZWxpbmUgfSBmcm9tIFwibm9kZTpzdHJlYW0vcHJvbWlzZXNcIlxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGJhc2UgdXJsLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVVJMIHZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBVUkwgd2l0aG91dCB0cmFpbGluZyBzbGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQmFzZVVybCh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvXFwvKyQvLCBcIlwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZW5jb2RlIHN0b3JhZ2Uga2V5LlxuICogQHBhcmFtIHtzdHJpbmd9IHN0b3JhZ2VLZXkgLSBTdG9yYWdlIGtleS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVVJMLXNhZmUgc3RvcmFnZSBrZXkuXG4gKi9cbmZ1bmN0aW9uIGVuY29kZVN0b3JhZ2VLZXkoc3RvcmFnZUtleSkge1xuICByZXR1cm4gc3RvcmFnZUtleS5zcGxpdChcIi9cIikubWFwKChlbnRyeSkgPT4gZW5jb2RlVVJJQ29tcG9uZW50KGVudHJ5KSkuam9pbihcIi9cIilcbn1cblxuLyoqXG4gKiBGaWxlc3lzdGVtIGF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZpbGVzeXN0ZW1BdHRhY2htZW50U3RvcmFnZURyaXZlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3Mub3B0aW9uc10gLSBEcml2ZXIgb3B0aW9ucy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBvcHRpb25zID0ge319KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSb290IGRpcmVjdG9yeSBmb3IgYXR0YWNobWVudCBmaWxlcy5cbiAgICovXG4gIGRpcmVjdG9yeSgpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMub3B0aW9ucy5kaXJlY3RvcnkgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5vcHRpb25zLmRpcmVjdG9yeS5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKHRoaXMub3B0aW9ucy5kaXJlY3RvcnkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhdGgucmVzb2x2ZSh0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCksIFwidG1wL2F0dGFjaG1lbnRzL2ZpbGVzeXN0ZW1cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdyaXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dGFjaG1lbnRJZCAtIEF0dGFjaG1lbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vbm9ybWFsaXplLWlucHV0LmpzXCIpLk5vcm1hbGl6ZWRBdHRhY2htZW50SW5wdXR9IGFyZ3MuaW5wdXQgLSBOb3JtYWxpemVkIGF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdG9yYWdlS2V5OiBzdHJpbmd9Pn0gLSBTdG9yYWdlIGtleSByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3cml0ZSh7YXR0YWNobWVudElkLCBpbnB1dH0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRmlsZW5hbWUgPSBwYXRoLmJhc2VuYW1lKGlucHV0LmZpbGVuYW1lIHx8IFwiYXR0YWNobWVudC5iaW5cIilcbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gYCR7YXR0YWNobWVudElkfS0ke25vcm1hbGl6ZWRGaWxlbmFtZX1gXG4gICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLnJlc29sdmUodGhpcy5kaXJlY3RvcnkoKSwgc3RvcmFnZUtleSlcbiAgICBjb25zdCB0ZW1wb3JhcnlGaWxlUGF0aCA9IGAke2ZpbGVQYXRofS50bXBgXG5cbiAgICBhd2FpdCBmcy5ta2RpcihwYXRoLmRpcm5hbWUoZmlsZVBhdGgpLCB7cmVjdXJzaXZlOiB0cnVlfSlcblxuICAgIHRyeSB7XG4gICAgICBpZiAoaW5wdXQucGF0aFNvdXJjZSkge1xuICAgICAgICBhd2FpdCBwaXBlbGluZShcbiAgICAgICAgICBhd2FpdCBpbnB1dC5wYXRoU291cmNlLmNyZWF0ZVJlYWRTdHJlYW0oKSxcbiAgICAgICAgICBjcmVhdGVXcml0ZVN0cmVhbSh0ZW1wb3JhcnlGaWxlUGF0aClcbiAgICAgICAgKVxuICAgICAgfSBlbHNlIGlmIChpbnB1dC5jb250ZW50QnVmZmVyKSB7XG4gICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZSh0ZW1wb3JhcnlGaWxlUGF0aCwgaW5wdXQuY29udGVudEJ1ZmZlcilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZpbGVzeXN0ZW0gYXR0YWNobWVudCBpbnB1dCBoYXMgbm8gY29udGVudFwiKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBmcy5yZW5hbWUodGVtcG9yYXJ5RmlsZVBhdGgsIGZpbGVQYXRoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmcy51bmxpbmsodGVtcG9yYXJ5RmlsZVBhdGgpXG4gICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgaWYgKCEoY2xlYW51cEVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHx8ICEoXCJjb2RlXCIgaW4gY2xlYW51cEVycm9yKSB8fCBjbGVhbnVwRXJyb3IuY29kZSAhPT0gXCJFTk9FTlRcIikge1xuICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICAgIGBGaWxlc3lzdGVtIGF0dGFjaG1lbnQgd3JpdGUgYW5kIHBhcnRpYWwtZmlsZSBjbGVhbnVwIGJvdGggZmFpbGVkIGZvciAke3N0b3JhZ2VLZXl9YCxcbiAgICAgICAgICAgIHtjYXVzZTogY2xlYW51cEVycm9yfVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiB7c3RvcmFnZUtleX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RvcmFnZUtleSAtIFN0b3JhZ2Uga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxCdWZmZXI+fSAtIEF0dGFjaG1lbnQgYnl0ZXMuXG4gICAqL1xuICBhc3luYyByZWFkKHtzdG9yYWdlS2V5fSkge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKHRoaXMuZGlyZWN0b3J5KCksIHN0b3JhZ2VLZXkpXG5cbiAgICByZXR1cm4gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RvcmFnZUtleSAtIFN0b3JhZ2Uga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGZpbGUgaGFzIGJlZW4gZGVsZXRlZC5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZSh7c3RvcmFnZUtleX0pIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGgucmVzb2x2ZSh0aGlzLmRpcmVjdG9yeSgpLCBzdG9yYWdlS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZzLnVubGluayhmaWxlUGF0aClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgfHwgIShcImNvZGVcIiBpbiBlcnJvcikgfHwgZXJyb3IuY29kZSAhPT0gXCJFTk9FTlRcIikge1xuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdG9yYWdlS2V5IC0gU3RvcmFnZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gUmVzb2x2YWJsZSBVUkwuXG4gICAqL1xuICBhc3luYyB1cmwoe3N0b3JhZ2VLZXl9KSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLm9wdGlvbnMuYmFzZVVybCA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLm9wdGlvbnMuYmFzZVVybC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gYCR7bm9ybWFsaXplQmFzZVVybCh0aGlzLm9wdGlvbnMuYmFzZVVybCl9LyR7ZW5jb2RlU3RvcmFnZUtleShzdG9yYWdlS2V5KX1gXG4gICAgfVxuXG4gICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLnJlc29sdmUodGhpcy5kaXJlY3RvcnkoKSwgc3RvcmFnZUtleSlcblxuICAgIHJldHVybiBgZmlsZTovLyR7ZmlsZVBhdGh9YFxuICB9XG59XG4iXX0=