/**
 * Serializes a JSON-compatible value with recursively sorted object keys.
 * @param {ReturnType<typeof JSON.parse>} value - JSON-compatible value.
 * @returns {string} - Stable JSON string.
 */
export default function stableJsonStringify(value: ReturnType<typeof JSON.parse>): string;
//# sourceMappingURL=stable-json.d.ts.map