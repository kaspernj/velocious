/**
 * Returns the UTF-8 byte length of a string without Node's `Buffer`, so shared
 * driver code can bound query chunks in browser and React Native bundles too.
 * @param {string} value - String to measure.
 * @returns {number} - UTF-8 byte length.
 */
export declare function utf8ByteLength(value: string): number;
//# sourceMappingURL=utf8-byte-length.d.ts.map