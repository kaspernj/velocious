/**
 * Runs object containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {{__velociousMatcher: string, value: ReturnType<typeof JSON.parse>}} - Matcher wrapper.
 */
declare function objectContaining(value: ReturnType<typeof JSON.parse>): {
    __velociousMatcher: string;
    value: ReturnType<typeof JSON.parse>;
};
/**
 * Runs array containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {{__velociousMatcher: string, value: ReturnType<typeof JSON.parse>}} - Matcher wrapper.
 */
declare function arrayContaining(value: ReturnType<typeof JSON.parse>): {
    __velociousMatcher: string;
    value: ReturnType<typeof JSON.parse>;
};
/**
 * Runs is array containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether arrayContaining matcher.
 */
declare function isArrayContaining(value: ReturnType<typeof JSON.parse>): boolean;
/**
 * Runs is object containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether objectContaining matcher.
 */
declare function isObjectContaining(value: ReturnType<typeof JSON.parse>): boolean;
/**
 * Runs match object.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} expected - Expected value.
 * @returns {{matches: boolean, differences: Record<string, Array<ReturnType<typeof JSON.parse>>>}} - Match result.
 */
declare function matchObject(actual: ReturnType<typeof JSON.parse>, expected: Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>): {
    matches: boolean;
    differences: Record<string, Array<ReturnType<typeof JSON.parse>>>;
};
/**
 * Runs match array containing.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {Array<ReturnType<typeof JSON.parse>>} expected - Expected values.
 * @returns {{matches: boolean, differences: Record<string, Array<ReturnType<typeof JSON.parse>>>}} - Match result.
 */
declare function matchArrayContaining(actual: ReturnType<typeof JSON.parse>, expected: Array<ReturnType<typeof JSON.parse>>): {
    matches: boolean;
    differences: Record<string, Array<ReturnType<typeof JSON.parse>>>;
};
export { arrayContaining, isArrayContaining, isObjectContaining, matchArrayContaining, matchObject, objectContaining };
//# sourceMappingURL=expect-utils.d.ts.map