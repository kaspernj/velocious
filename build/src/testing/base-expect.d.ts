export default class BaseExpect {
    /**
     * Runs run before.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    runBefore(): Promise<void>;
    /**
     * Runs run after.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    runAfter(): Promise<void>;
}
//# sourceMappingURL=base-expect.d.ts.map