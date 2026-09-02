// @ts-check
import { anythingDifferent } from "set-state-compare/build/diff-utils.js";
/**
 * Runs object containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {{__velociousMatcher: string, value: ReturnType<typeof JSON.parse>}} - Matcher wrapper.
 */
function objectContaining(value) {
    if (value === null || typeof value !== "object") {
        throw new Error(`Expected object but got ${typeof value}`);
    }
    return {
        __velociousMatcher: "objectContaining",
        value
    };
}
/**
 * Runs array containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {{__velociousMatcher: string, value: ReturnType<typeof JSON.parse>}} - Matcher wrapper.
 */
function arrayContaining(value) {
    if (!Array.isArray(value)) {
        throw new Error(`Expected array but got ${typeof value}`);
    }
    return {
        __velociousMatcher: "arrayContaining",
        value
    };
}
/**
 * Runs is object like.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether object-like.
 */
function isObjectLike(value) {
    return value !== null && typeof value === "object";
}
/**
 * Runs is array containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether arrayContaining matcher.
 */
function isArrayContaining(value) {
    return !!value && typeof value === "object" && /** @type {ReturnType<typeof JSON.parse>} */ (value).__velociousMatcher === "arrayContaining";
}
/**
 * Runs is object containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether objectContaining matcher.
 */
function isObjectContaining(value) {
    return !!value && typeof value === "object" && /** @type {ReturnType<typeof JSON.parse>} */ (value).__velociousMatcher === "objectContaining";
}
/**
 * Runs is plain object.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether plain object.
 */
function isPlainObject(value) {
    if (!value || typeof value !== "object")
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
/**
 * Runs values equal.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {ReturnType<typeof JSON.parse>} expected - Expected value.
 * @returns {boolean} - Whether values are equal.
 */
function valuesEqual(actual, expected) {
    if (actual instanceof Date && expected instanceof Date) {
        return actual.getTime() === expected.getTime();
    }
    if (actual instanceof RegExp && expected instanceof RegExp) {
        return actual.source === expected.source && actual.flags === expected.flags;
    }
    return Object.is(actual, expected);
}
/**
 * Runs collect match differences.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {ReturnType<typeof JSON.parse>} expected - Expected value.
 * @param {string} path - Path.
 * @param {Record<string, Array<ReturnType<typeof JSON.parse>>>} differences - Differences.
 * @returns {void} - No return value.
 */
function collectMatchDifferences(actual, expected, path, differences) {
    if (isObjectContaining(expected)) {
        collectMatchDifferences(actual, /** @type {ReturnType<typeof JSON.parse>} */ (expected).value, path, differences);
        return;
    }
    if (isArrayContaining(expected)) {
        const { matches } = matchArrayContaining(actual, /** @type {Array<ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(expected).value));
        if (!matches) {
            differences[path || "$"] = [expected, actual];
        }
        return;
    }
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) {
            differences[path || "$"] = [expected, actual];
            return;
        }
        for (let i = 0; i < expected.length; i++) {
            const nextPath = `${path}[${i}]`;
            collectMatchDifferences(actual[i], expected[i], nextPath, differences);
        }
        return;
    }
    if (isPlainObject(expected)) {
        if (!isObjectLike(actual)) {
            differences[path || "$"] = [expected, actual];
            return;
        }
        const expectedObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (expected);
        const actualObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (actual);
        for (const key of Object.keys(expectedObject)) {
            const nextPath = path ? `${path}.${key}` : key;
            if (!Object.prototype.hasOwnProperty.call(actualObject, key)) {
                differences[nextPath] = [expectedObject[key], undefined];
                continue;
            }
            collectMatchDifferences(actualObject[key], expectedObject[key], nextPath, differences);
        }
        return;
    }
    if (!valuesEqual(actual, expected)) {
        differences[path || "$"] = [expected, actual];
    }
}
/**
 * Runs match object.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} expected - Expected value.
 * @returns {{matches: boolean, differences: Record<string, Array<ReturnType<typeof JSON.parse>>>}} - Match result.
 */
function matchObject(actual, expected) {
    /**
     * Differences.
     * @type {Record<string, Array<ReturnType<typeof JSON.parse>>>} */
    const differences = {};
    collectMatchDifferences(actual, expected, "", differences);
    return {
        matches: Object.keys(differences).length === 0,
        differences
    };
}
/**
 * Runs match array containing.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {Array<ReturnType<typeof JSON.parse>>} expected - Expected values.
 * @returns {{matches: boolean, differences: Record<string, Array<ReturnType<typeof JSON.parse>>>}} - Match result.
 */
function matchArrayContaining(actual, expected) {
    /**
     * Differences.
     * @type {Record<string, Array<ReturnType<typeof JSON.parse>>>} */
    const differences = {};
    if (!Array.isArray(actual)) {
        differences["$"] = [expected, actual];
        return { matches: false, differences };
    }
    const usedIndexes = new Set();
    for (const expectedItem of expected) {
        let matchedIndex = -1;
        for (let i = 0; i < actual.length; i++) {
            if (usedIndexes.has(i))
                continue;
            if (isObjectContaining(expectedItem)) {
                const { matches } = matchObject(actual[i], /** @type {ReturnType<typeof JSON.parse>} */ (expectedItem).value);
                if (matches) {
                    matchedIndex = i;
                    break;
                }
                continue;
            }
            if (isArrayContaining(expectedItem)) {
                const { matches } = matchArrayContaining(actual[i], /** @type {ReturnType<typeof JSON.parse>} */ (expectedItem).value);
                if (matches) {
                    matchedIndex = i;
                    break;
                }
                continue;
            }
            if (!anythingDifferent(actual[i], expectedItem)) {
                matchedIndex = i;
                break;
            }
        }
        if (matchedIndex >= 0) {
            usedIndexes.add(matchedIndex);
        }
        else {
            differences["$"] = [expected, actual];
            break;
        }
    }
    return {
        matches: Object.keys(differences).length === 0,
        differences
    };
}
export { arrayContaining, isArrayContaining, isObjectContaining, matchArrayContaining, matchObject, objectContaining };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhwZWN0LXV0aWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3RpbmcvZXhwZWN0LXV0aWxzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsaUJBQWlCLEVBQUMsTUFBTSx1Q0FBdUMsQ0FBQTtBQUV2RTs7OztHQUlHO0FBQ0gsU0FBUyxnQkFBZ0IsQ0FBQyxLQUFLO0lBQzdCLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUNoRCxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixPQUFPLEtBQUssRUFBRSxDQUFDLENBQUE7SUFDNUQsQ0FBQztJQUVELE9BQU87UUFDTCxrQkFBa0IsRUFBRSxrQkFBa0I7UUFDdEMsS0FBSztLQUNOLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLEtBQUs7SUFDNUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixPQUFPLEtBQUssRUFBRSxDQUFDLENBQUE7SUFDM0QsQ0FBQztJQUVELE9BQU87UUFDTCxrQkFBa0IsRUFBRSxpQkFBaUI7UUFDckMsS0FBSztLQUNOLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsWUFBWSxDQUFDLEtBQUs7SUFDekIsT0FBTyxLQUFLLEtBQUssSUFBSSxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsQ0FBQTtBQUNwRCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsaUJBQWlCLENBQUMsS0FBSztJQUM5QixPQUFPLENBQUMsQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFLLDRDQUE0QyxDQUFDLENBQUMsS0FBSyxDQUFFLENBQUMsa0JBQWtCLEtBQUssaUJBQWlCLENB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Q0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2FueXRoaW5nRGlmZmVyZW50fSBmcm9tIFwic2V0LXN0YXRlLWNvbXBhcmUvYnVpbGQvZGlmZi11dGlscy5qc1wiXG5cbi8qKlxuICogUnVucyBvYmplY3QgY29udGFpbmluZy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUuXG4gKiBAcmV0dXJucyB7e19fdmVsb2Npb3VzTWF0Y2hlcjogc3RyaW5nLCB2YWx1ZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAtIE1hdGNoZXIgd3JhcHBlci5cbiAqL1xuZnVuY3Rpb24gb2JqZWN0Q29udGFpbmluZyh2YWx1ZSkge1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgYnV0IGdvdCAke3R5cGVvZiB2YWx1ZX1gKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBfX3ZlbG9jaW91c01hdGNoZXI6IFwib2JqZWN0Q29udGFpbmluZ1wiLFxuICAgIHZhbHVlXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFycmF5IGNvbnRhaW5pbmcuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlLlxuICogQHJldHVybnMge3tfX3ZlbG9jaW91c01hdGNoZXI6IHN0cmluZywgdmFsdWU6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gLSBNYXRjaGVyIHdyYXBwZXIuXG4gKi9cbmZ1bmN0aW9uIGFycmF5Q29udGFpbmluZyh2YWx1ZSkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcnJheSBidXQgZ290ICR7dHlwZW9mIHZhbHVlfWApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIF9fdmVsb2Npb3VzTWF0Y2hlcjogXCJhcnJheUNvbnRhaW5pbmdcIixcbiAgICB2YWx1ZVxuICB9XG59XG5cbi8qKlxuICogUnVucyBpcyBvYmplY3QgbGlrZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIG9iamVjdC1saWtlLlxuICovXG5mdW5jdGlvbiBpc09iamVjdExpa2UodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlICE9PSBudWxsICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIlxufVxuXG4vKipcbiAqIFJ1bnMgaXMgYXJyYXkgY29udGFpbmluZy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFycmF5Q29udGFpbmluZyBtYXRjaGVyLlxuICovXG5mdW5jdGlvbiBpc0FycmF5Q29udGFpbmluZyh2YWx1ZSkge1xuICByZXR1cm4gISF2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkpLl9fdmVsb2Npb3VzTWF0Y2hlciA9PT0gXCJhcnJheUNvbnRhaW5pbmdcIlxufVxuXG4vKipcbiAqIFJ1bnMgaXMgb2JqZWN0IGNvbnRhaW5pbmcuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBvYmplY3RDb250YWluaW5nIG1hdGNoZXIuXG4gKi9cbmZ1bmN0aW9uIGlzT2JqZWN0Q29udGFpbmluZyh2YWx1ZSkge1xuICByZXR1cm4gISF2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkpLl9fdmVsb2Npb3VzTWF0Y2hlciA9PT0gXCJvYmplY3RDb250YWluaW5nXCJcbn1cblxuLyoqXG4gKiBSdW5zIGlzIHBsYWluIG9iamVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHBsYWluIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gaXNQbGFpbk9iamVjdCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKVxuXG4gIHJldHVybiBwcm90b3R5cGUgPT09IE9iamVjdC5wcm90b3R5cGUgfHwgcHJvdG90eXBlID09PSBudWxsXG59XG5cbi8qKlxuICogUnVucyB2YWx1ZXMgZXF1YWwuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWwgLSBBY3R1YWwgdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZCAtIEV4cGVjdGVkIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZXMgYXJlIGVxdWFsLlxuICovXG5mdW5jdGlvbiB2YWx1ZXNFcXVhbChhY3R1YWwsIGV4cGVjdGVkKSB7XG4gIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKClcbiAgfVxuXG4gIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBSZWdFeHAgJiYgZXhwZWN0ZWQgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICByZXR1cm4gYWN0dWFsLnNvdXJjZSA9PT0gZXhwZWN0ZWQuc291cmNlICYmIGFjdHVhbC5mbGFncyA9PT0gZXhwZWN0ZWQuZmxhZ3NcbiAgfVxuXG4gIHJldHVybiBPYmplY3QuaXMoYWN0dWFsLCBleHBlY3RlZClcbn1cblxuLyoqXG4gKiBSdW5zIGNvbGxlY3QgbWF0Y2ggZGlmZmVyZW5jZXMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWwgLSBBY3R1YWwgdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZCAtIEV4cGVjdGVkIHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBQYXRoLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBkaWZmZXJlbmNlcyAtIERpZmZlcmVuY2VzLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5mdW5jdGlvbiBjb2xsZWN0TWF0Y2hEaWZmZXJlbmNlcyhhY3R1YWwsIGV4cGVjdGVkLCBwYXRoLCBkaWZmZXJlbmNlcykge1xuICBpZiAoaXNPYmplY3RDb250YWluaW5nKGV4cGVjdGVkKSkge1xuICAgIGNvbGxlY3RNYXRjaERpZmZlcmVuY2VzKGFjdHVhbCwgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGV4cGVjdGVkKS52YWx1ZSwgcGF0aCwgZGlmZmVyZW5jZXMpXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoaXNBcnJheUNvbnRhaW5pbmcoZXhwZWN0ZWQpKSB7XG4gICAgY29uc3Qge21hdGNoZXN9ID0gbWF0Y2hBcnJheUNvbnRhaW5pbmcoYWN0dWFsLCAvKiogQHR5cGUge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChleHBlY3RlZCkudmFsdWUpKVxuXG4gICAgaWYgKCFtYXRjaGVzKSB7XG4gICAgICBkaWZmZXJlbmNlc1twYXRoIHx8IFwiJFwiXSA9IFtleHBlY3RlZCwgYWN0dWFsXVxuICAgIH1cblxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoZXhwZWN0ZWQpKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGFjdHVhbCkpIHtcbiAgICAgIGRpZmZlcmVuY2VzW3BhdGggfHwgXCIkXCJdID0gW2V4cGVjdGVkLCBhY3R1YWxdXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGV4cGVjdGVkLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBuZXh0UGF0aCA9IGAke3BhdGh9WyR7aX1dYFxuICAgICAgY29sbGVjdE1hdGNoRGlmZmVyZW5jZXMoYWN0dWFsW2ldLCBleHBlY3RlZFtpXSwgbmV4dFBhdGgsIGRpZmZlcmVuY2VzKVxuICAgIH1cblxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKGlzUGxhaW5PYmplY3QoZXhwZWN0ZWQpKSB7XG4gICAgaWYgKCFpc09iamVjdExpa2UoYWN0dWFsKSkge1xuICAgICAgZGlmZmVyZW5jZXNbcGF0aCB8fCBcIiRcIl0gPSBbZXhwZWN0ZWQsIGFjdHVhbF1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGV4cGVjdGVkT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChleHBlY3RlZClcbiAgICBjb25zdCBhY3R1YWxPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGFjdHVhbClcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGV4cGVjdGVkT2JqZWN0KSkge1xuICAgICAgY29uc3QgbmV4dFBhdGggPSBwYXRoID8gYCR7cGF0aH0uJHtrZXl9YCA6IGtleVxuXG4gICAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChhY3R1YWxPYmplY3QsIGtleSkpIHtcbiAgICAgICAgZGlmZmVyZW5jZXNbbmV4dFBhdGhdID0gW2V4cGVjdGVkT2JqZWN0W2tleV0sIHVuZGVmaW5lZF1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29sbGVjdE1hdGNoRGlmZmVyZW5jZXMoYWN0dWFsT2JqZWN0W2tleV0sIGV4cGVjdGVkT2JqZWN0W2tleV0sIG5leHRQYXRoLCBkaWZmZXJlbmNlcylcbiAgICB9XG5cbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICghdmFsdWVzRXF1YWwoYWN0dWFsLCBleHBlY3RlZCkpIHtcbiAgICBkaWZmZXJlbmNlc1twYXRoIHx8IFwiJFwiXSA9IFtleHBlY3RlZCwgYWN0dWFsXVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtYXRjaCBvYmplY3QuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWwgLSBBY3R1YWwgdmFsdWUuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZXhwZWN0ZWQgLSBFeHBlY3RlZCB2YWx1ZS5cbiAqIEByZXR1cm5zIHt7bWF0Y2hlczogYm9vbGVhbiwgZGlmZmVyZW5jZXM6IFJlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59fSAtIE1hdGNoIHJlc3VsdC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hPYmplY3QoYWN0dWFsLCBleHBlY3RlZCkge1xuICAvKipcbiAgICogRGlmZmVyZW5jZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICBjb25zdCBkaWZmZXJlbmNlcyA9IHt9XG5cbiAgY29sbGVjdE1hdGNoRGlmZmVyZW5jZXMoYWN0dWFsLCBleHBlY3RlZCwgXCJcIiwgZGlmZmVyZW5jZXMpXG5cbiAgcmV0dXJuIHtcbiAgICBtYXRjaGVzOiBPYmplY3Qua2V5cyhkaWZmZXJlbmNlcykubGVuZ3RoID09PSAwLFxuICAgIGRpZmZlcmVuY2VzXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1hdGNoIGFycmF5IGNvbnRhaW5pbmcuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWwgLSBBY3R1YWwgdmFsdWUuXG4gKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZXhwZWN0ZWQgLSBFeHBlY3RlZCB2YWx1ZXMuXG4gKiBAcmV0dXJucyB7e21hdGNoZXM6IGJvb2xlYW4sIGRpZmZlcmVuY2VzOiBSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fX0gLSBNYXRjaCByZXN1bHQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQXJyYXlDb250YWluaW5nKGFjdHVhbCwgZXhwZWN0ZWQpIHtcbiAgLyoqXG4gICAqIERpZmZlcmVuY2VzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgY29uc3QgZGlmZmVyZW5jZXMgPSB7fVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShhY3R1YWwpKSB7XG4gICAgZGlmZmVyZW5jZXNbXCIkXCJdID0gW2V4cGVjdGVkLCBhY3R1YWxdXG4gICAgcmV0dXJuIHttYXRjaGVzOiBmYWxzZSwgZGlmZmVyZW5jZXN9XG4gIH1cblxuICBjb25zdCB1c2VkSW5kZXhlcyA9IG5ldyBTZXQoKVxuXG4gIGZvciAoY29uc3QgZXhwZWN0ZWRJdGVtIG9mIGV4cGVjdGVkKSB7XG4gICAgbGV0IG1hdGNoZWRJbmRleCA9IC0xXG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFjdHVhbC5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHVzZWRJbmRleGVzLmhhcyhpKSkgY29udGludWVcblxuICAgICAgaWYgKGlzT2JqZWN0Q29udGFpbmluZyhleHBlY3RlZEl0ZW0pKSB7XG4gICAgICAgIGNvbnN0IHttYXRjaGVzfSA9IG1hdGNoT2JqZWN0KGFjdHVhbFtpXSwgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGV4cGVjdGVkSXRlbSkudmFsdWUpXG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgbWF0Y2hlZEluZGV4ID0gaVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzQXJyYXlDb250YWluaW5nKGV4cGVjdGVkSXRlbSkpIHtcbiAgICAgICAgY29uc3Qge21hdGNoZXN9ID0gbWF0Y2hBcnJheUNvbnRhaW5pbmcoYWN0dWFsW2ldLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZXhwZWN0ZWRJdGVtKS52YWx1ZSlcbiAgICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgICBtYXRjaGVkSW5kZXggPSBpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIWFueXRoaW5nRGlmZmVyZW50KGFjdHVhbFtpXSwgZXhwZWN0ZWRJdGVtKSkge1xuICAgICAgICBtYXRjaGVkSW5kZXggPSBpXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG1hdGNoZWRJbmRleCA+PSAwKSB7XG4gICAgICB1c2VkSW5kZXhlcy5hZGQobWF0Y2hlZEluZGV4KVxuICAgIH0gZWxzZSB7XG4gICAgICBkaWZmZXJlbmNlc1tcIiRcIl0gPSBbZXhwZWN0ZWQsIGFjdHVhbF1cbiAgICAgIGJyZWFrXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBtYXRjaGVzOiBPYmplY3Qua2V5cyhkaWZmZXJlbmNlcykubGVuZ3RoID09PSAwLFxuICAgIGRpZmZlcmVuY2VzXG4gIH1cbn1cblxuZXhwb3J0IHtcbiAgYXJyYXlDb250YWluaW5nLFxuICBpc0FycmF5Q29udGFpbmluZyxcbiAgaXNPYmplY3RDb250YWluaW5nLFxuICBtYXRjaEFycmF5Q29udGFpbmluZyxcbiAgbWF0Y2hPYmplY3QsXG4gIG9iamVjdENvbnRhaW5pbmdcbn1cbiJdfQ==