/**
 * Captures one frontend-model operation's immutable remote request context.
 * @param {ReturnType<typeof JSON.parse> | undefined} value - Configured or untrusted context value.
 * @returns {import("../remote-request-context.js").RemoteRequestContext} Frozen context snapshot.
 */
export declare function captureFrontendModelRemoteRequestContext(value: ReturnType<typeof JSON.parse> | undefined): import("../remote-request-context.js").RemoteRequestContext;
/**
 * Builds the canonical identity for one frontend-model remote request context.
 * @param {ReturnType<typeof JSON.parse> | undefined} value - Context value.
 * @returns {string} Stable serialized context key.
 */
export declare function frontendModelRemoteRequestContextKey(value: ReturnType<typeof JSON.parse> | undefined): string;
/**
 * Merges captured context into frontend-model command or subscription params.
 * @template {Record<string, ReturnType<typeof JSON.parse>>} TParams
 * @param {import("../remote-request-context.js").RemoteRequestContext} context - Captured context.
 * @param {TParams} params - Framework-owned params.
 * @returns {TParams & import("../remote-request-context.js").RemoteRequestContext} Merged params.
 */
export declare function mergeFrontendModelRemoteRequestContext<TParams extends Record<string, ReturnType<typeof JSON.parse>>>(context: import("../remote-request-context.js").RemoteRequestContext, params: TParams): TParams & import("../remote-request-context.js").RemoteRequestContext;
//# sourceMappingURL=remote-request-context.d.ts.map