// @ts-check
/**
 * Runs throw missing method.
 * @param {object} args - Args.
 * @param {string} args.driverName - Driver name.
 * @param {string} args.methodName - Method name.
 * @returns {never} - Always throws.
 */
function throwMissingMethod({ driverName, methodName }) {
    throw new Error(`Attachment storage driver "${driverName}" requires a "${methodName}" callback`);
}
/**
 * Runs to buffer.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {Buffer} - Buffer value.
 */
function toBuffer(value) {
    if (Buffer.isBuffer(value))
        return value;
    if (value instanceof Uint8Array)
        return Buffer.from(value);
    if (value instanceof ArrayBuffer)
        return Buffer.from(value);
    if (typeof value === "string")
        return Buffer.from(value, "base64");
    throw new Error(`Unsupported native attachment read result: ${String(value)}`);
}
/**
 * Native attachment storage driver.
 * This driver delegates all I/O to user-provided callbacks.
 */
export default class NativeAttachmentStorageDriver {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../../../../configuration.js").default} [args.configuration] - Configuration instance.
     * @param {string} args.name - Driver name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.options] - Driver options.
     */
    constructor({ configuration, name, options = {} }) {
        this.configuration = configuration;
        this.name = name;
        this.options = options;
    }
    /**
     * Runs write.
     * @param {object} args - Write args.
     * @param {string} args.attachmentId - Attachment id.
     * @param {import("../normalize-input.js").NormalizedAttachmentInput} args.input - Normalized attachment input.
     * @param {import("../../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @returns {Promise<{storageKey: string}>} - Storage key result.
     */
    async write({ attachmentId, input, model, name }) {
        if (typeof this.options.write !== "function") {
            throwMissingMethod({ driverName: this.name, methodName: "write" });
        }
        let contentBase64 = input.contentBase64;
        if (input.pathSource) {
            // Native write callbacks have always received Base64. Path input is
            // intentionally buffered here, after driver selection, to preserve that
            // public callback contract without forcing filesystem/S3 to buffer.
            const contentBuffer = await input.pathSource.readBuffer();
            contentBase64 = contentBuffer.toString("base64");
        }
        if (contentBase64 === null) {
            throw new Error(`Attachment storage driver "${this.name}" input has no content`);
        }
        const result = await this.options.write({
            attachmentId,
            attachmentName: name,
            contentBase64,
            contentType: input.contentType,
            filename: input.filename,
            model
        });
        if (!result || typeof result.storageKey !== "string" || result.storageKey.length < 1) {
            throw new Error(`Attachment storage driver "${this.name}" write callback must return {storageKey}`);
        }
        return { storageKey: result.storageKey };
    }
    /**
     * Runs read.
     * @param {object} args - Read args.
     * @param {string} args.storageKey - Storage key.
     * @param {import("../../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<Buffer>} - Attachment bytes.
     */
    async read({ model, name, row, storageKey }) {
        if (typeof this.options.read !== "function") {
            throwMissingMethod({ driverName: this.name, methodName: "read" });
        }
        const result = await this.options.read({
            attachmentId: row.id || "",
            attachmentName: name,
            model,
            row,
            storageKey
        });
        return toBuffer(result);
    }
    /**
     * Runs delete.
     * @param {object} args - Delete args.
     * @param {string} args.storageKey - Storage key.
     * @param {import("../../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<void>} - Resolves when deleted.
     */
    async delete({ model, name, row, storageKey }) {
        if (typeof this.options.delete !== "function")
            return;
        await this.options.delete({
            attachmentId: row.id || "",
            attachmentName: name,
            model,
            row,
            storageKey
        });
    }
    /**
     * Runs url.
     * @param {object} args - URL args.
     * @param {string} args.storageKey - Storage key.
     * @param {import("../../index.js").default} args.model - Model instance.
     * @param {string} args.name - Attachment name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
     * @returns {Promise<string | null>} - Attachment URL.
     */
    async url({ model, name, row, storageKey }) {
        if (typeof this.options.url !== "function")
            return null;
        const value = await this.options.url({
            attachmentId: row.id || "",
            attachmentName: name,
            model,
            row,
            storageKey
        });
        if (typeof value === "string" && value.length > 0)
            return value;
        return null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmF0aXZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3JlY29yZC9hdHRhY2htZW50cy9zdG9yYWdlLWRyaXZlcnMvbmF0aXZlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7O0dBTUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQztJQUNsRCxNQUFNLElBQUksS0FBSyxDQUFDLDhCQUE4QixVQUFVLGlCQUFpQixVQUFVLFlBQVksQ0FBQyxDQUFBO0FBQ2xHLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxRQUFRLENBQUMsS0FBSztJQUNyQixJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxLQUFLLENBQUE7SUFDeEMsSUFBSSxLQUFLLFlBQVksVUFBVTtRQUFFLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMxRCxJQUFJLEtBQUssWUFBWSxXQUFXO1FBQUUsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzNELElBQUksT0FBTyxLQUFLLEtBQUssUUFBUTtRQUFFLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFFbEUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUNoRixDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyw2QkFBNkI7SUFDaEQ7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsT0FBTyxHQUFHLEVBQUUsRUFBQztRQUM3QyxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FB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QUNYLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxVQUFVLEVBQUM7UUFDdEMsSUFBSSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxLQUFLLFVBQVU7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV2RCxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDO1lBQ25DLFlBQVksRUFBRSxHQUFHLENBQUMsRUFBRSxJQUFJLEVBQUU7WUFDMUIsY0FBYyxFQUFFLElBQUk7WUFDcEIsS0FBSztZQUNMLEdBQUc7WUFDSCxVQUFVO1NBQ1gsQ0FBQyxDQUFBO1FBRUYsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFL0QsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBSdW5zIHRocm93IG1pc3NpbmcgbWV0aG9kLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZHJpdmVyTmFtZSAtIERyaXZlciBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICogQHJldHVybnMge25ldmVyfSAtIEFsd2F5cyB0aHJvd3MuXG4gKi9cbmZ1bmN0aW9uIHRocm93TWlzc2luZ01ldGhvZCh7ZHJpdmVyTmFtZSwgbWV0aG9kTmFtZX0pIHtcbiAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50IHN0b3JhZ2UgZHJpdmVyIFwiJHtkcml2ZXJOYW1lfVwiIHJlcXVpcmVzIGEgXCIke21ldGhvZE5hbWV9XCIgY2FsbGJhY2tgKVxufVxuXG4vKipcbiAqIFJ1bnMgdG8gYnVmZmVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7QnVmZmVyfSAtIEJ1ZmZlciB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gdG9CdWZmZXIodmFsdWUpIHtcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpIHJldHVybiB2YWx1ZVxuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBVaW50OEFycmF5KSByZXR1cm4gQnVmZmVyLmZyb20odmFsdWUpXG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSByZXR1cm4gQnVmZmVyLmZyb20odmFsdWUpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHJldHVybiBCdWZmZXIuZnJvbSh2YWx1ZSwgXCJiYXNlNjRcIilcblxuICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIG5hdGl2ZSBhdHRhY2htZW50IHJlYWQgcmVzdWx0OiAke1N0cmluZyh2YWx1ZSl9YClcbn1cblxuLyoqXG4gKiBOYXRpdmUgYXR0YWNobWVudCBzdG9yYWdlIGRyaXZlci5cbiAqIFRoaXMgZHJpdmVyIGRlbGVnYXRlcyBhbGwgSS9PIHRvIHVzZXItcHJvdmlkZWQgY2FsbGJhY2tzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBOYXRpdmVBdHRhY2htZW50U3RvcmFnZURyaXZlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBEcml2ZXIgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLm9wdGlvbnNdIC0gRHJpdmVyIG9wdGlvbnMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgbmFtZSwgb3B0aW9ucyA9IHt9fSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLm5hbWUgPSBuYW1lXG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd3JpdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV3JpdGUgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0YWNobWVudElkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9ub3JtYWxpemUtaW5wdXQuanNcIikuTm9ybWFsaXplZEF0dGFjaG1lbnRJbnB1dH0gYXJncy5pbnB1dCAtIE5vcm1hbGl6ZWQgYXR0YWNobWVudCBpbnB1dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdG9yYWdlS2V5OiBzdHJpbmd9Pn0gLSBTdG9yYWdlIGtleSByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3cml0ZSh7YXR0YWNobWVudElkLCBpbnB1dCwgbW9kZWwsIG5hbWV9KSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLm9wdGlvbnMud3JpdGUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3dNaXNzaW5nTWV0aG9kKHtkcml2ZXJOYW1lOiB0aGlzLm5hbWUsIG1ldGhvZE5hbWU6IFwid3JpdGVcIn0pXG4gICAgfVxuXG4gICAgbGV0IGNvbnRlbnRCYXNlNjQgPSBpbnB1dC5jb250ZW50QmFzZTY0XG5cbiAgICBpZiAoaW5wdXQucGF0aFNvdXJjZSkge1xuICAgICAgLy8gTmF0aXZlIHdyaXRlIGNhbGxiYWNrcyBoYXZlIGFsd2F5cyByZWNlaXZlZCBCYXNlNjQuIFBhdGggaW5wdXQgaXNcbiAgICAgIC8vIGludGVudGlvbmFsbHkgYnVmZmVyZWQgaGVyZSwgYWZ0ZXIgZHJpdmVyIHNlbGVjdGlvbiwgdG8gcHJlc2VydmUgdGhhdFxuICAgICAgLy8gcHVibGljIGNhbGxiYWNrIGNvbnRyYWN0IHdpdGhvdXQgZm9yY2luZyBmaWxlc3lzdGVtL1MzIHRvIGJ1ZmZlci5cbiAgICAgIGNvbnN0IGNvbnRlbnRCdWZmZXIgPSBhd2FpdCBpbnB1dC5wYXRoU291cmNlLnJlYWRCdWZmZXIoKVxuXG4gICAgICBjb250ZW50QmFzZTY0ID0gY29udGVudEJ1ZmZlci50b1N0cmluZyhcImJhc2U2NFwiKVxuICAgIH1cblxuICAgIGlmIChjb250ZW50QmFzZTY0ID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgXCIke3RoaXMubmFtZX1cIiBpbnB1dCBoYXMgbm8gY29udGVudGApXG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5vcHRpb25zLndyaXRlKHtcbiAgICAgIGF0dGFjaG1lbnRJZCxcbiAgICAgIGF0dGFjaG1lbnROYW1lOiBuYW1lLFxuICAgICAgY29udGVudEJhc2U2NCxcbiAgICAgIGNvbnRlbnRUeXBlOiBpbnB1dC5jb250ZW50VHlwZSxcbiAgICAgIGZpbGVuYW1lOiBpbnB1dC5maWxlbmFtZSxcbiAgICAgIG1vZGVsXG4gICAgfSlcblxuICAgIGlmICghcmVzdWx0IHx8IHR5cGVvZiByZXN1bHQuc3RvcmFnZUtleSAhPT0gXCJzdHJpbmdcIiB8fCByZXN1bHQuc3RvcmFnZUtleS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgc3RvcmFnZSBkcml2ZXIgXCIke3RoaXMubmFtZX1cIiB3cml0ZSBjYWxsYmFjayBtdXN0IHJldHVybiB7c3RvcmFnZUtleX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7c3RvcmFnZUtleTogcmVzdWx0LnN0b3JhZ2VLZXl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlYWQgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RvcmFnZUtleSAtIFN0b3JhZ2Uga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJ1ZmZlcj59IC0gQXR0YWNobWVudCBieXRlcy5cbiAgICovXG4gIGFzeW5jIHJlYWQoe21vZGVsLCBuYW1lLCByb3csIHN0b3JhZ2VLZXl9KSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLm9wdGlvbnMucmVhZCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvd01pc3NpbmdNZXRob2Qoe2RyaXZlck5hbWU6IHRoaXMubmFtZSwgbWV0aG9kTmFtZTogXCJyZWFkXCJ9KVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMub3B0aW9ucy5yZWFkKHtcbiAgICAgIGF0dGFjaG1lbnRJZDogcm93LmlkIHx8IFwiXCIsXG4gICAgICBhdHRhY2htZW50TmFtZTogbmFtZSxcbiAgICAgIG1vZGVsLFxuICAgICAgcm93LFxuICAgICAgc3RvcmFnZUtleVxuICAgIH0pXG5cbiAgICByZXR1cm4gdG9CdWZmZXIocmVzdWx0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERlbGV0ZSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdG9yYWdlS2V5IC0gU3RvcmFnZSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yb3cgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlKHttb2RlbCwgbmFtZSwgcm93LCBzdG9yYWdlS2V5fSkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5vcHRpb25zLmRlbGV0ZSAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5kZWxldGUoe1xuICAgICAgYXR0YWNobWVudElkOiByb3cuaWQgfHwgXCJcIixcbiAgICAgIGF0dGFjaG1lbnROYW1lOiBuYW1lLFxuICAgICAgbW9kZWwsXG4gICAgICByb3csXG4gICAgICBzdG9yYWdlS2V5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBVUkwgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RvcmFnZUtleSAtIFN0b3JhZ2Uga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIEF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgYXN5bmMgdXJsKHttb2RlbCwgbmFtZSwgcm93LCBzdG9yYWdlS2V5fSkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5vcHRpb25zLnVybCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdmFsdWUgPSBhd2FpdCB0aGlzLm9wdGlvbnMudXJsKHtcbiAgICAgIGF0dGFjaG1lbnRJZDogcm93LmlkIHx8IFwiXCIsXG4gICAgICBhdHRhY2htZW50TmFtZTogbmFtZSxcbiAgICAgIG1vZGVsLFxuICAgICAgcm93LFxuICAgICAgc3RvcmFnZUtleVxuICAgIH0pXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLmxlbmd0aCA+IDApIHJldHVybiB2YWx1ZVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuIl19