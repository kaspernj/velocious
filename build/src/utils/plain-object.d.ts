/**
 * Detect plain object literals without accepting arrays or class instances.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is Record<string, ReturnType<typeof JSON.parse>>} - Whether value is a plain object.
 */
export default function isPlainObject(value: ReturnType<typeof JSON.parse>): value is Record<string, ReturnType<typeof JSON.parse>>;
//# sourceMappingURL=plain-object.d.ts.map