import LogRedactor from "../log-redactor.js";
/**
 * Extracts request metadata without retaining the request object.
 * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default | undefined} request - Request object, when present.
 * @param {object} [args] - Redaction context.
 * @param {LogRedactor} [args.redactor] - Application logging redactor.
 * @param {Set<string>} [args.sensitiveValues] - Request-local sensitive values.
 * @returns {import("../configuration-types.js").ErrorRequestDetails | null} - Request metadata.
 */
export declare function requestDetails(request: import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default | undefined, { redactor, sensitiveValues }?: {
    redactor?: LogRedactor;
    sensitiveValues?: Set<string>;
}): import("../configuration-types.js").ErrorRequestDetails | null;
//# sourceMappingURL=request-details.d.ts.map