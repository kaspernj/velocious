/**
 * Minified stringify with circular and depth protection.
 * @param {ReturnType<typeof JSON.parse>} value - Value to use.
 * @returns {string} - The minified stringify.
 */
declare function minifiedStringify(value: ReturnType<typeof JSON.parse>): string;
/**
 * Runs format value.
 * @param {ReturnType<typeof JSON.parse>} value - Value to use.
 * @returns {string} - The value.
 */
declare function formatValue(value: ReturnType<typeof JSON.parse>): string;
export { formatValue, minifiedStringify };
//# sourceMappingURL=format-value.d.ts.map