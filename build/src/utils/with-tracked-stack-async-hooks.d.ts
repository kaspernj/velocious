/**
 * Runs add tracked stack to error.
 * @param {Error} error - Error to annotate with a tracked stack.
 */
declare function addTrackedStackToError(error: Error): void;
/**
 * Runs with tracked stack.
 * @param {(() => Promise<ReturnType<typeof JSON.parse>>) | string} arg1 - Arg1.
 * @param {(() => Promise<ReturnType<typeof JSON.parse>>) | Error} [arg2] - Arg2.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the callback result.
 */
declare function withTrackedStack(arg1: (() => Promise<ReturnType<typeof JSON.parse>>) | string, arg2?: (() => Promise<ReturnType<typeof JSON.parse>>) | Error): Promise<ReturnType<typeof JSON.parse>>;
export { addTrackedStackToError, withTrackedStack };
//# sourceMappingURL=with-tracked-stack-async-hooks.d.ts.map