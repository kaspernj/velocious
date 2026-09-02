export type RemoteRequestContext = Readonly<Record<string, string | number | boolean>>;
/**
 * Captures and validates immutable scalar context for one remote operation.
 * @param {ReturnType<typeof JSON.parse> | undefined} value - Configured context value.
 * @param {object} [args] - Validation options.
 * @param {string} [args.label] - Context label used in errors.
 * @param {Iterable<string>} [args.reservedKeys] - Framework-owned keys unavailable to context.
 * @returns {RemoteRequestContext} Frozen context snapshot.
 */
export declare function captureRemoteRequestContext(value: ReturnType<typeof JSON.parse> | undefined, { label, reservedKeys }?: {
    label?: string;
    reservedKeys?: Iterable<string>;
}): RemoteRequestContext;
/**
 * Merges captured context into framework request params without ambiguity.
 * @template {Record<string, ReturnType<typeof JSON.parse>>} TParams
 * @param {object} args - Merge arguments.
 * @param {RemoteRequestContext} args.context - Captured context.
 * @param {string} [args.label] - Context label used in errors.
 * @param {TParams} args.params - Framework-owned request params.
 * @returns {TParams & RemoteRequestContext} Merged params, or the original params when unscoped.
 */
export declare function mergeRemoteRequestContext<TParams extends Record<string, ReturnType<typeof JSON.parse>>>({ context, label, params }: {
    context: RemoteRequestContext;
    label?: string;
    params: TParams;
}): TParams & RemoteRequestContext;
/**
 * Returns a stable identity for an immutable captured context.
 * @param {RemoteRequestContext} context - Captured context.
 * @returns {string} Stable serialized key.
 */
export declare function remoteRequestContextKey(context: RemoteRequestContext): string;
//# sourceMappingURL=remote-request-context.d.ts.map