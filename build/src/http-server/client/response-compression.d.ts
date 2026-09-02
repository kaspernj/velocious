/**
 * Runs parse accept encoding.
 * @param {string} headerValue - Accept-Encoding header value.
 * @returns {Map<string, number>} - Lowercased coding to q-value (0-1).
 */
export declare function parseAcceptEncoding(headerValue: string): Map<string, number>;
/**
 * Negotiates the content coding for a response from the Accept-Encoding header.
 * Identity participates in the same quality comparison as the supported codings:
 * a higher-q identity selects identity, and equal-q ties break in server order
 * br, gzip, identity. Identity defaults to acceptable unless explicitly refused
 * with `identity;q=0` or a `*;q=0` wildcard without a more specific identity
 * entry, and an explicit coding entry beats the wildcard.
 * @param {string | null | undefined} acceptEncoding - Accept-Encoding header value.
 * @returns {{encoding: "br" | "gzip" | "identity", identityAcceptable: boolean} | {notAcceptable: true}} - Negotiated coding, or that no acceptable representation exists.
 */
export declare function negotiateContentEncoding(acceptEncoding: string | null | undefined): {
    encoding: "br" | "gzip" | "identity";
    identityAcceptable: boolean;
} | {
    notAcceptable: true;
};
/**
 * Runs is compressible content type.
 * @param {string} contentType - Content-Type header value.
 * @returns {boolean} - Whether the media type is on the compressible allowlist.
 */
export declare function isCompressibleContentType(contentType: string): boolean;
/**
 * Merges Accept-Encoding into the response Vary header case-insensitively and
 * without duplicates. An existing `Vary: *` already covers every request header
 * and is preserved as-is.
 * @param {import("./response.js").default} response - Response instance.
 * @returns {void} - No return value.
 */
export declare function addAcceptEncodingToVary(response: import("./response.js").default): void;
/**
 * Negotiates and applies compression to a buffered response body immediately before
 * framing. Only string/Uint8Array responses reach this point; sendFile responses and
 * bodyless statuses are excluded by the caller. Transformation is skipped for
 * Cache-Control no-transform, non-allowlisted or pre-compressed media types,
 * server-sent events, partial (206) responses, requests with a Range header,
 * credentialed requests (Authorization/Cookie headers), responses carrying
 * credentials or validators (Set-Cookie/ETag/Digest/Content-Digest/Content-Range
 * headers), and per-response opt-outs; a skipped
 * transformation is still sent as identity when the client accepts identity, and
 * answered "not-acceptable" when it does not. Responses that already carry an
 * application-supplied Content-Encoding are passed through unchanged and never
 * negotiate. When the client forbids every representation (identity and all
 * supported codings), the outcome is "not-acceptable".
 * @param {object} args - Options object.
 * @param {Buffer} args.bodyBuffer - Buffered response body bytes (UTF-8 encoded for string bodies).
 * @param {import("../../configuration-types.js").NormalizedHttpCompressionConfiguration} args.compression - Normalized compression configuration.
 * @param {import("./request.js").default | import("./websocket-request.js").default} args.request - Request object.
 * @param {import("./response.js").default} args.response - Response instance.
 * @returns {Promise<{outcome: "identity"} | {outcome: "compressed", body: Buffer} | {outcome: "not-acceptable"}>} - Compression outcome.
 */
export declare function applyResponseCompression({ bodyBuffer, compression, request, response }: {
    bodyBuffer: Buffer;
    compression: import("../../configuration-types.js").NormalizedHttpCompressionConfiguration;
    request: import("./request.js").default | import("./websocket-request.js").default;
    response: import("./response.js").default;
}): Promise<{
    outcome: "identity";
} | {
    outcome: "compressed";
    body: Buffer;
} | {
    outcome: "not-acceptable";
}>;
//# sourceMappingURL=response-compression.d.ts.map