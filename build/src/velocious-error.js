// @ts-check
/** Framework error with optional client-safe message exposure flag. */
export default class VelociousError extends Error {
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {object} [args] - Options.
     * @param {ReturnType<typeof JSON.parse>} [args.cause] - Error cause.
     * @param {string} [args.code] - Optional error code.
     * @param {import("./configuration-types.js").ClientErrorPayloadReporterPayload} [args.details] - Structured client-safe error details.
     * @param {"application_error" | "authorization_error" | "record_not_found" | "validation_error"} [args.errorType] - Stable client-facing error category.
     * @param {boolean} [args.safeToExpose] - Whether the message is safe to return to clients.
     */
    constructor(message, args = {}) {
        const { cause, code, details, errorType, safeToExpose = false } = args;
        super(message, { cause });
        this.name = "VelociousError";
        this.code = code;
        this.details = details;
        this.errorType = errorType;
        this.safeToExpose = safeToExpose;
    }
    /**
     * Runs safe.
     * @param {string} message - Error message.
     * @param {object} [args] - Options.
     * @param {ReturnType<typeof JSON.parse>} [args.cause] - Error cause.
     * @param {string} [args.code] - Optional error code.
     * @param {import("./configuration-types.js").ClientErrorPayloadReporterPayload} [args.details] - Structured client-safe error details.
     * @param {"application_error" | "authorization_error" | "record_not_found" | "validation_error"} [args.errorType] - Stable client-facing error category.
     * @returns {VelociousError} - Client-safe error instance.
     */
    static safe(message, args = {}) {
        return new VelociousError(message, { ...args, safeToExpose: true });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLWVycm9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3ZlbG9jaW91cy1lcnJvci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosdUVBQXVFO0FBQ3ZFLE1BQU0sQ0FBQyxPQUFPLE9BQU8sY0FBZSxTQUFRLEtBQUs7SUFDL0M7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxPQUFPLEVBQUUsSUFBSSxHQUFHLEVBQUU7UUFDNUIsTUFBTSxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxZQUFZLEdBQUcsS0FBSyxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBRXBFLEtBQUssQ0FBQyxPQUFPLEVBQUUsRUFBQyxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxJQUFJLEdBQUcsZ0JBQWdCLENBQUE7UUFDNUIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7UUFDdEIsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7UUFDMUIsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksR0FBRyxFQUFFO1FBQzVCLE9BQU8sSUFBSSxjQUFjLENBQUMsT0FBTyxFQUFFLEVBQUMsR0FBRyxJQUFJLEVBQUUsWUFBWSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7SUFDbkUsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKiBGcmFtZXdvcmsgZXJyb3Igd2l0aCBvcHRpb25hbCBjbGllbnQtc2FmZSBtZXNzYWdlIGV4cG9zdXJlIGZsYWcuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmNhdXNlXSAtIEVycm9yIGNhdXNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY29kZV0gLSBPcHRpb25hbCBlcnJvciBjb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9IFthcmdzLmRldGFpbHNdIC0gU3RydWN0dXJlZCBjbGllbnQtc2FmZSBlcnJvciBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge1wiYXBwbGljYXRpb25fZXJyb3JcIiB8IFwiYXV0aG9yaXphdGlvbl9lcnJvclwiIHwgXCJyZWNvcmRfbm90X2ZvdW5kXCIgfCBcInZhbGlkYXRpb25fZXJyb3JcIn0gW2FyZ3MuZXJyb3JUeXBlXSAtIFN0YWJsZSBjbGllbnQtZmFjaW5nIGVycm9yIGNhdGVnb3J5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnNhZmVUb0V4cG9zZV0gLSBXaGV0aGVyIHRoZSBtZXNzYWdlIGlzIHNhZmUgdG8gcmV0dXJuIHRvIGNsaWVudHMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCB7Y2F1c2UsIGNvZGUsIGRldGFpbHMsIGVycm9yVHlwZSwgc2FmZVRvRXhwb3NlID0gZmFsc2V9ID0gYXJnc1xuXG4gICAgc3VwZXIobWVzc2FnZSwge2NhdXNlfSlcblxuICAgIHRoaXMubmFtZSA9IFwiVmVsb2Npb3VzRXJyb3JcIlxuICAgIHRoaXMuY29kZSA9IGNvZGVcbiAgICB0aGlzLmRldGFpbHMgPSBkZXRhaWxzXG4gICAgdGhpcy5lcnJvclR5cGUgPSBlcnJvclR5cGVcbiAgICB0aGlzLnNhZmVUb0V4cG9zZSA9IHNhZmVUb0V4cG9zZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2FmZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuY2F1c2VdIC0gRXJyb3IgY2F1c2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jb2RlXSAtIE9wdGlvbmFsIGVycm9yIGNvZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gW2FyZ3MuZGV0YWlsc10gLSBTdHJ1Y3R1cmVkIGNsaWVudC1zYWZlIGVycm9yIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7XCJhcHBsaWNhdGlvbl9lcnJvclwiIHwgXCJhdXRob3JpemF0aW9uX2Vycm9yXCIgfCBcInJlY29yZF9ub3RfZm91bmRcIiB8IFwidmFsaWRhdGlvbl9lcnJvclwifSBbYXJncy5lcnJvclR5cGVdIC0gU3RhYmxlIGNsaWVudC1mYWNpbmcgZXJyb3IgY2F0ZWdvcnkuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNFcnJvcn0gLSBDbGllbnQtc2FmZSBlcnJvciBpbnN0YW5jZS5cbiAgICovXG4gIHN0YXRpYyBzYWZlKG1lc3NhZ2UsIGFyZ3MgPSB7fSkge1xuICAgIHJldHVybiBuZXcgVmVsb2Npb3VzRXJyb3IobWVzc2FnZSwgey4uLmFyZ3MsIHNhZmVUb0V4cG9zZTogdHJ1ZX0pXG4gIH1cbn1cbiJdfQ==