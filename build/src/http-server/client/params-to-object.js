// @ts-check
/**
 * Runs malformed nested params key error.
 * @param {object} args - Args.
 * @param {string} args.key - Parameter key.
 * @param {string} args.rest - Remaining unmatched segment.
 * @returns {Error} - Error with parser context attached.
 */
function malformedNestedParamsKeyError(args) {
    const { key, rest } = args;
    const error = new Error(`Could not parse nested params key "${key}" at rest "${rest}"`);
    /**
     * Typed error.
     * @type {Error & {velociousContext?: Record<string, ReturnType<typeof JSON.parse>>}} */
    const typedError = error;
    typedError.velociousContext = {
        nestedParamsKey: {
            key,
            rest,
            stage: "params-to-object"
        }
    };
    return error;
}
export default class ParamsToObject {
    /**
     * Runs constructor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} object - Object.
     */
    constructor(object) {
        this.object = object;
    }
    /**
     * Runs to object.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The object.
     */
    toObject() {
        /**
         * Result.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const result = {};
        for (const key in this.object) {
            const value = this.object[key];
            this.treatInitial(key, value, result);
        }
        return result;
    }
    /**
     * Runs treat initial.
     * @param {string} key - Key.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} result - Result.
     * @returns {void} - No return value.
     */
    treatInitial(key, value, result) {
        const firstMatch = key.match(/^(.+?)(\[([\s\S]+$))/);
        if (firstMatch) {
            const inputName = firstMatch[1];
            const rest = firstMatch[2];
            /**
             * Defines newResult.
             * @type {Array<ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>} */
            let newResult;
            const objectResult = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (result);
            if (inputName in objectResult) {
                newResult = /** @type {Array<ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>} */ (objectResult[inputName]);
            }
            else if (rest == "[]") {
                newResult = [];
                objectResult[inputName] = newResult;
            }
            else {
                newResult = {};
                objectResult[inputName] = newResult;
            }
            this.treatSecond(value, rest, newResult, key);
        }
        else {
            const objectResult = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (result);
            objectResult[key] = value;
        }
    }
    /**
     * Runs treat second.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @param {string} rest - Rest.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} result - Result.
     * @param {string} [fullKey] - Original full key.
     * @returns {void} - No return value.
     */
    treatSecond(value, rest, result, fullKey = rest) {
        const secondMatch = rest.match(/^\[(.*?)\]([\s\S]*)$/);
        if (!secondMatch)
            throw malformedNestedParamsKeyError({ key: fullKey, rest });
        const key = secondMatch[1];
        const newRest = secondMatch[2];
        /**
         * Defines newResult.
         * @type {Array<ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>} */
        let newResult;
        if (rest == "[]") {
            if (!Array.isArray(result)) {
                throw new Error(`Expected array result for rest ${rest}`);
            }
            result.push(value);
        }
        else if (newRest == "") {
            /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (result)[key] = value;
        }
        else {
            const objectResult = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (result);
            if (!Array.isArray(result) && key in objectResult) {
                newResult = /** @type {Array<ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>} */ (objectResult[key]);
            }
            else if (newRest == "[]") {
                newResult = [];
                objectResult[key] = newResult;
            }
            else {
                newResult = {};
                objectResult[key] = newResult;
            }
            this.treatSecond(value, newRest, newResult, fullKey);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGFyYW1zLXRvLW9iamVjdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci9jbGllbnQvcGFyYW1zLXRvLW9iamVjdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7OztHQU1HO0FBQ0gsU0FBUyw2QkFBNkIsQ0FBQyxJQUFJO0lBQ3pDLE1BQU0sRUFBQyxHQUFHLEVBQUUsSUFBSSxFQUFDLEdBQUcsSUFBSSxDQUFBO0lBQ3hCLE1BQU0sS0FBSyxHQUFHLElBQUksS0FBSyxDQUFDLHNDQUFzQyxHQUFHLGNBQWMsSUFBSSxHQUFHLENBQUMsQ0FBQTtJQUN2Rjs7NEZBRXdGO0lBQ3hGLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQTtJQUV4QixVQUFVLENBQUMsZ0JBQWdCLEdBQUc7UUFDNUIsZUFBZSxFQUFFO1lBQ2YsR0FBRztZQUNILElBQUk7WUFDSixLQUFLLEVBQUUsa0JBQWtCO1NBQzFCO0tBQ0YsQ0FBQTtJQUVELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sY0FBYztJQUNqQzs7O09BR0c7SUFDSCxZQUFZLE1BQU07UUFDaEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVE7UUFDTjs7bUVBRTJEO1FBQzNELE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUVqQixLQUFJLE1BQU0sR0FBRyxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUM3QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFBO1lBRTlCLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUN2QyxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lB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QTtZQUMvQixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sU0FBUyxHQUFHLEVBQUUsQ0FBQTtnQkFDZCxZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsU0FBUyxDQUFBO1lBQy9CLENBQUM7WUFFRCxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ3RELENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBSdW5zIG1hbGZvcm1lZCBuZXN0ZWQgcGFyYW1zIGtleSBlcnJvci5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmtleSAtIFBhcmFtZXRlciBrZXkuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXN0IC0gUmVtYWluaW5nIHVubWF0Y2hlZCBzZWdtZW50LlxuICogQHJldHVybnMge0Vycm9yfSAtIEVycm9yIHdpdGggcGFyc2VyIGNvbnRleHQgYXR0YWNoZWQuXG4gKi9cbmZ1bmN0aW9uIG1hbGZvcm1lZE5lc3RlZFBhcmFtc0tleUVycm9yKGFyZ3MpIHtcbiAgY29uc3Qge2tleSwgcmVzdH0gPSBhcmdzXG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKGBDb3VsZCBub3QgcGFyc2UgbmVzdGVkIHBhcmFtcyBrZXkgXCIke2tleX1cIiBhdCByZXN0IFwiJHtyZXN0fVwiYClcbiAgLyoqXG4gICAqIFR5cGVkIGVycm9yLlxuICAgKiBAdHlwZSB7RXJyb3IgJiB7dmVsb2Npb3VzQ29udGV4dD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19ICovXG4gIGNvbnN0IHR5cGVkRXJyb3IgPSBlcnJvclxuXG4gIHR5cGVkRXJyb3IudmVsb2Npb3VzQ29udGV4dCA9IHtcbiAgICBuZXN0ZWRQYXJhbXNLZXk6IHtcbiAgICAgIGtleSxcbiAgICAgIHJlc3QsXG4gICAgICBzdGFnZTogXCJwYXJhbXMtdG8tb2JqZWN0XCJcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZXJyb3Jcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUGFyYW1zVG9PYmplY3Qge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG9iamVjdCAtIE9iamVjdC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG9iamVjdCkge1xuICAgIHRoaXMub2JqZWN0ID0gb2JqZWN0XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIG9iamVjdC5cbiAgICovXG4gIHRvT2JqZWN0KCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBmb3IoY29uc3Qga2V5IGluIHRoaXMub2JqZWN0KSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHRoaXMub2JqZWN0W2tleV1cblxuICAgICAgdGhpcy50cmVhdEluaXRpYWwoa2V5LCB2YWx1ZSwgcmVzdWx0KVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyZWF0IGluaXRpYWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBLZXkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVzdWx0IC0gUmVzdWx0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0cmVhdEluaXRpYWwoa2V5LCB2YWx1ZSwgcmVzdWx0KSB7XG4gICAgY29uc3QgZmlyc3RNYXRjaCA9IGtleS5tYXRjaCgvXiguKz8pKFxcWyhbXFxzXFxTXSskKSkvKVxuXG4gICAgaWYgKGZpcnN0TWF0Y2gpIHtcbiAgICAgIGNvbnN0IGlucHV0TmFtZSA9IGZpcnN0TWF0Y2hbMV1cbiAgICAgIGNvbnN0IHJlc3QgPSBmaXJzdE1hdGNoWzJdXG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBuZXdSZXN1bHQuXG4gICAgICAgKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgbGV0IG5ld1Jlc3VsdFxuICAgICAgY29uc3Qgb2JqZWN0UmVzdWx0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyZXN1bHQpXG5cbiAgICAgIGlmIChpbnB1dE5hbWUgaW4gb2JqZWN0UmVzdWx0KSB7XG4gICAgICAgIG5ld1Jlc3VsdCA9IC8qKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob2JqZWN0UmVzdWx0W2lucHV0TmFtZV0pXG4gICAgICB9IGVsc2UgaWYgKHJlc3QgPT0gXCJbXVwiKSB7XG4gICAgICAgIG5ld1Jlc3VsdCA9IFtdXG4gICAgICAgIG9iamVjdFJlc3VsdFtpbnB1dE5hbWVdID0gbmV3UmVzdWx0XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXdSZXN1bHQgPSB7fVxuICAgICAgICBvYmplY3RSZXN1bHRbaW5wdXROYW1lXSA9IG5ld1Jlc3VsdFxuICAgICAgfVxuXG4gICAgICB0aGlzLnRyZWF0U2Vjb25kKHZhbHVlLCByZXN0LCBuZXdSZXN1bHQsIGtleSlcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgb2JqZWN0UmVzdWx0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyZXN1bHQpXG5cbiAgICAgIG9iamVjdFJlc3VsdFtrZXldID0gdmFsdWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmVhdCBzZWNvbmQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVzdCAtIFJlc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXN1bHQgLSBSZXN1bHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZnVsbEtleV0gLSBPcmlnaW5hbCBmdWxsIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdHJlYXRTZWNvbmQodmFsdWUsIHJlc3QsIHJlc3VsdCwgZnVsbEtleSA9IHJlc3QpIHtcbiAgICBjb25zdCBzZWNvbmRNYXRjaCA9IHJlc3QubWF0Y2goL15cXFsoLio/KVxcXShbXFxzXFxTXSopJC8pXG5cbiAgICBpZiAoIXNlY29uZE1hdGNoKSB0aHJvdyBtYWxmb3JtZWROZXN0ZWRQYXJhbXNLZXlFcnJvcih7a2V5OiBmdWxsS2V5LCByZXN0fSlcblxuICAgIGNvbnN0IGtleSA9IHNlY29uZE1hdGNoWzFdXG4gICAgY29uc3QgbmV3UmVzdCA9IHNlY29uZE1hdGNoWzJdXG5cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIG5ld1Jlc3VsdC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGxldCBuZXdSZXN1bHRcblxuICAgIGlmIChyZXN0ID09IFwiW11cIikge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc3VsdCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcnJheSByZXN1bHQgZm9yIHJlc3QgJHtyZXN0fWApXG4gICAgICB9XG5cbiAgICAgIHJlc3VsdC5wdXNoKHZhbHVlKVxuICAgIH0gZWxzZSBpZiAobmV3UmVzdCA9PSBcIlwiKSB7XG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc3VsdClba2V5XSA9IHZhbHVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG9iamVjdFJlc3VsdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzdWx0KVxuXG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzdWx0KSAmJiBrZXkgaW4gb2JqZWN0UmVzdWx0KSB7XG4gICAgICAgIG5ld1Jlc3VsdCA9IC8qKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob2JqZWN0UmVzdWx0W2tleV0pXG4gICAgICB9IGVsc2UgaWYgKG5ld1Jlc3QgPT0gXCJbXVwiKSB7XG4gICAgICAgIG5ld1Jlc3VsdCA9IFtdXG4gICAgICAgIG9iamVjdFJlc3VsdFtrZXldID0gbmV3UmVzdWx0XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXdSZXN1bHQgPSB7fVxuICAgICAgICBvYmplY3RSZXN1bHRba2V5XSA9IG5ld1Jlc3VsdFxuICAgICAgfVxuXG4gICAgICB0aGlzLnRyZWF0U2Vjb25kKHZhbHVlLCBuZXdSZXN0LCBuZXdSZXN1bHQsIGZ1bGxLZXkpXG4gICAgfVxuICB9XG59XG4iXX0=