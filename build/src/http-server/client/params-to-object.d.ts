export default class ParamsToObject {
    object: Record<string, any>;
    /**
     * Runs constructor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} object - Object.
     */
    constructor(object: Record<string, ReturnType<typeof JSON.parse>>);
    /**
     * Runs to object.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The object.
     */
    toObject(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs treat initial.
     * @param {string} key - Key.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} result - Result.
     * @returns {void} - No return value.
     */
    treatInitial(key: string, value: ReturnType<typeof JSON.parse>, result: Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs treat second.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @param {string} rest - Rest.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} result - Result.
     * @param {string} [fullKey] - Original full key.
     * @returns {void} - No return value.
     */
    treatSecond(value: ReturnType<typeof JSON.parse>, rest: string, result: Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>, fullKey?: string): void;
}
//# sourceMappingURL=params-to-object.d.ts.map