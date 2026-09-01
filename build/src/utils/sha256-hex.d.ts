/**
 * Computes SHA-256 without importing Node-only crypto modules, keeping this
 * module safe for Expo/browser bundles. Implementation is a straightforward
 * pure-JavaScript SHA-256 derived from FIPS 180-4, using only 32-bit unsigned
 * integer arithmetic.
 * @param {string} message - UTF-8 message.
 * @returns {string} - Hex digest.
 */
export default function sha256Hex(message: string): string;
//# sourceMappingURL=sha256-hex.d.ts.map