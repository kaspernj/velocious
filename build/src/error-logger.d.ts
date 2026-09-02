/**
 * Runs error logger.
 * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>} callback - Callback function.
 * @returns {(...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>} - The error logger.
 */
export default function errorLogger(callback: (...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>): (...args: Array<ReturnType<typeof JSON.parse>>) => Promise<void>;
//# sourceMappingURL=error-logger.d.ts.map