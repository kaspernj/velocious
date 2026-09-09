/**
 * Returns the exact producer handoff for the current asynchronous job chain.
 * @returns {import("./types.js").BackgroundJobProducerProof | undefined} - Current producer proof.
 */
export declare function currentBackgroundJobProducerProof(): import("./types.js").BackgroundJobProducerProof | undefined;
/**
 * Runs one job-owned asynchronous chain with an immutable producer proof.
 * @template T
 * @param {import("./types.js").BackgroundJobProducerProof} producerProof - Exact producer handoff.
 * @param {() => T} callback - Job-owned work.
 * @returns {T} - Callback result.
 */
export declare function runWithBackgroundJobProducerProof<T>(producerProof: import("./types.js").BackgroundJobProducerProof, callback: () => T): T;
/**
 * Runs under a payload's exact lease when all fencing fields are present.
 * Legacy payloads without a complete lease retain their existing behavior.
 * @template T
 * @param {import("./types.js").BackgroundJobPayload} payload - Persisted runner payload.
 * @param {() => T} callback - Job-owned work.
 * @returns {T} - Callback result.
 */
export declare function runWithBackgroundJobPayload<T>(payload: import("./types.js").BackgroundJobPayload, callback: () => T): T;
//# sourceMappingURL=execution-context.d.ts.map