/**
 * Runs nest callbacks.
 * @param {Array<(next: () => Promise<void>) => void | Promise<void>>} callbacksToNestInside - Callbacks to nest inside.
 * @param {() => void | Promise<void>} callback - Callback function.
 * @returns {Promise<void>} - Resolves when complete.
 */
export default function nestCallbacks(callbacksToNestInside: Array<(next: () => Promise<void>) => void | Promise<void>>, callback: () => void | Promise<void>): Promise<void>;
//# sourceMappingURL=nest-callbacks.d.ts.map