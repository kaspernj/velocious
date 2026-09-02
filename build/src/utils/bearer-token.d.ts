/**
 * Constant-time comparison so token checks don't leak length/contents through
 * timing. Returns false for differing lengths before the timing-safe compare.
 * @param {string} a - First value.
 * @param {string} b - Second value.
 * @returns {boolean} - Whether the values are equal.
 */
export declare function constantTimeEqual(a: string, b: string): boolean;
/**
 * Extracts the bearer token from the Authorization header of a request.
 * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} request - Request object.
 * @returns {string | null} - Bearer token from the Authorization header, if any.
 */
export declare function bearerToken(request: import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default): string | null;
//# sourceMappingURL=bearer-token.d.ts.map