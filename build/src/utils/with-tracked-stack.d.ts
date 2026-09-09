/**
 * Runs add tracked stack to error.
 * @param {Error} error - Error to annotate with a tracked stack.
 */
declare function addTrackedStackToError(error: Error): void;
/**
 * Runs with tracked stack.
 * @param {string | (() => Promise<ReturnType<typeof JSON.parse>>)} stackOrCallback - Stack string or callback.
 * @param {(() => Promise<ReturnType<typeof JSON.parse>>)} [callback] - Callback to execute.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with value.
 */
declare function withTrackedStack(stackOrCallback: string | (() => Promise<ReturnType<typeof JSON.parse>>), callback?: (() => Promise<ReturnType<typeof JSON.parse>>)): Promise<ReturnType<typeof JSON.parse>>;
export { addTrackedStackToError, withTrackedStack };
//# sourceMappingURL=with-tracked-stack.d.ts.map