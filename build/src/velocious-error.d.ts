/** Framework error with optional client-safe message exposure flag. */
export default class VelociousError extends Error {
    code: string | undefined;
    details: import("./configuration-types.js").ClientErrorPayloadReporterPayload | undefined;
    errorType: "application_error" | "authorization_error" | "record_not_found" | "validation_error" | undefined;
    safeToExpose: boolean;
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
    constructor(message: string, args?: {
        cause?: ReturnType<typeof JSON.parse>;
        code?: string;
        details?: import("./configuration-types.js").ClientErrorPayloadReporterPayload;
        errorType?: "application_error" | "authorization_error" | "record_not_found" | "validation_error";
        safeToExpose?: boolean;
    });
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
    static safe(message: string, args?: {
        cause?: ReturnType<typeof JSON.parse>;
        code?: string;
        details?: import("./configuration-types.js").ClientErrorPayloadReporterPayload;
        errorType?: "application_error" | "authorization_error" | "record_not_found" | "validation_error";
    }): VelociousError;
}
//# sourceMappingURL=velocious-error.d.ts.map