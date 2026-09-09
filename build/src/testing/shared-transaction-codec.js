// @ts-check
/** @typedef {{[TAG]: string, value?: string | number | boolean | EncodedBrokerValue[] | Record<string, EncodedBrokerValue>}} EncodedBrokerValue */
const TAG = "$velociousSharedTransaction";
/**
 * Encodes values crossing the test-only shared-transaction transport without
 * relying on JSON's lossy Date, bigint, non-finite-number, or undefined rules.
 * @param {ReturnType<typeof JSON.parse> | bigint | Buffer | Date | Error | undefined} value - Runtime value.
 * @returns {EncodedBrokerValue} - Tagged transport value.
 */
export function encodeBrokerValue(value) {
    if (value === undefined)
        return { [TAG]: "undefined" };
    if (value === null)
        return { [TAG]: "null" };
    if (typeof value === "bigint")
        return { [TAG]: "bigint", value: `${value}` };
    if (typeof value === "number") {
        if (Number.isNaN(value))
            return { [TAG]: "nan" };
        if (value === Infinity)
            return { [TAG]: "infinity" };
        if (value === -Infinity)
            return { [TAG]: "negative-infinity" };
        return { [TAG]: "number", value };
    }
    if (typeof value === "string" || typeof value === "boolean")
        return { [TAG]: typeof value, value };
    if (value instanceof Date)
        return { [TAG]: "date", value: value.toISOString() };
    if (Buffer.isBuffer(value))
        return { [TAG]: "buffer", value: value.toString("base64") };
    if (value instanceof Error) {
        /** @type {Record<string, ReturnType<typeof encodeBrokerValue>>} */
        const properties = {
            name: encodeBrokerValue(value.name),
            message: encodeBrokerValue(value.message),
            stack: encodeBrokerValue(value.stack)
        };
        for (const key of Object.keys(value)) {
            properties[key] = encodeBrokerValue(/** @type {ReturnType<typeof JSON.parse>} */ (value)[key]);
        }
        if ("code" in value)
            properties.code = encodeBrokerValue(value.code);
        if (value.cause !== undefined)
            properties.cause = encodeBrokerValue(value.cause);
        return { [TAG]: "error", value: properties };
    }
    if (Array.isArray(value))
        return { [TAG]: "array", value: value.map((entry) => encodeBrokerValue(entry)) };
    if (typeof value === "object") {
        /** @type {Record<string, ReturnType<typeof encodeBrokerValue>>} */
        const entries = {};
        for (const [key, entry] of Object.entries(value))
            entries[key] = encodeBrokerValue(entry);
        return { [TAG]: "object", value: entries };
    }
    throw new TypeError(`Shared transaction broker cannot encode ${typeof value}`);
}
/**
 * Decodes a tagged broker transport value.
 * @param {EncodedBrokerValue} encoded - Tagged transport value.
 * @returns {ReturnType<typeof JSON.parse> | bigint | Buffer | Date | Error | undefined} - Runtime value.
 */
export function decodeBrokerValue(encoded) {
    if (!encoded || typeof encoded !== "object" || typeof encoded[TAG] !== "string") {
        throw new TypeError("Invalid shared transaction broker value");
    }
    switch (encoded[TAG]) {
        case "undefined": return undefined;
        case "null": return null;
        case "bigint": return BigInt(/** @type {string} */ (encoded.value));
        case "nan": return NaN;
        case "infinity": return Infinity;
        case "negative-infinity": return -Infinity;
        case "number":
        case "string":
        case "boolean": return encoded.value;
        case "date": return new Date(/** @type {string} */ (encoded.value));
        case "buffer": return Buffer.from(/** @type {string} */ (encoded.value), "base64");
        case "array": return /** @type {EncodedBrokerValue[]} */ (encoded.value).map((entry) => decodeBrokerValue(entry));
        case "object": return decodeProperties(/** @type {Record<string, EncodedBrokerValue>} */ (encoded.value));
        case "error": return decodeError(/** @type {Record<string, EncodedBrokerValue>} */ (encoded.value));
        default: throw new TypeError(`Unknown shared transaction broker value tag: ${encoded[TAG]}`);
    }
}
/**
 * Decodes object properties.
 * @param {Record<string, EncodedBrokerValue>} properties - Encoded properties.
 * @returns {Record<string, ReturnType<typeof decodeBrokerValue>>} - Decoded properties.
 */
function decodeProperties(properties) {
    /** @type {Record<string, ReturnType<typeof decodeBrokerValue>>} */
    const decoded = {};
    for (const [key, value] of Object.entries(properties))
        decoded[key] = decodeBrokerValue(value);
    return decoded;
}
/**
 * Reconstructs an error from its tagged properties.
 * @param {Record<string, EncodedBrokerValue>} properties - Encoded error properties.
 * @returns {Error} - Decoded error.
 */
function decodeError(properties) {
    const decoded = decodeProperties(properties);
    const ErrorClass = decoded.name === "TypeError" ? TypeError : Error;
    const error = new ErrorClass(/** @type {string} */ (decoded.message), decoded.cause === undefined ? undefined : { cause: decoded.cause });
    for (const [key, value] of Object.entries(decoded)) {
        if (key === "message" || key === "cause")
            continue;
        /** @type {Record<string, ReturnType<typeof decodeBrokerValue>>} */ (error)[key] = value;
    }
    return error;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkLXRyYW5zYWN0aW9uLWNvZGVjLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLWNvZGVjLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixtSkFBbUo7QUFFbkosTUFBTSxHQUFHLEdBQUcsNkJBQTZCLENBQUE7QUFFekM7Ozs7O0dBS0c7QUFDSCxNQUFNLFVBQVUsaUJBQWlCLENBQUMsS0FBSztJQUNyQyxJQUFJLEtBQUssS0FBSyxTQUFTO1FBQUUsT0FBTyxFQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsV0FBVyxFQUFDLENBQUE7SUFDcEQsSUFBSSxLQUFLLEtBQUssSUFBSTtRQUFFLE9BQU8sRUFBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLE1BQU0sRUFBQyxDQUFBO0lBQzFDLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUTtRQUFFLE9BQU8sRUFBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsR0FBRyxLQUFLLEVBQUUsRUFBQyxDQUFBO0lBQzFFLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDOUIsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQztZQUFFLE9BQU8sRUFBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLEtBQUssRUFBQyxDQUFBO1FBQzlDLElBQUksS0FBSyxLQUFLLFFBQVE7WUFBRSxPQUFPLEVBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxVQUFVLEVBQUMsQ0FBQTtRQUNsRCxJQUFJLEtBQUssS0FBSyxDQUFDLFFBQVE7WUFBRSxPQUFPLEVBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxtQkFBbUIsRUFBQyxDQUFBO1FBQzVELE9BQU8sRUFBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUMsQ0FBQTtJQUNqQyxDQUFDO0lBQ0QsSUFBSSxPQUFPLEtBQUss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bnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKiBAdHlwZWRlZiB7e1tUQUddOiBzdHJpbmcsIHZhbHVlPzogc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IEVuY29kZWRCcm9rZXJWYWx1ZVtdIHwgUmVjb3JkPHN0cmluZywgRW5jb2RlZEJyb2tlclZhbHVlPn19IEVuY29kZWRCcm9rZXJWYWx1ZSAqL1xuXG5jb25zdCBUQUcgPSBcIiR2ZWxvY2lvdXNTaGFyZWRUcmFuc2FjdGlvblwiXG5cbi8qKlxuICogRW5jb2RlcyB2YWx1ZXMgY3Jvc3NpbmcgdGhlIHRlc3Qtb25seSBzaGFyZWQtdHJhbnNhY3Rpb24gdHJhbnNwb3J0IHdpdGhvdXRcbiAqIHJlbHlpbmcgb24gSlNPTidzIGxvc3N5IERhdGUsIGJpZ2ludCwgbm9uLWZpbml0ZS1udW1iZXIsIG9yIHVuZGVmaW5lZCBydWxlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBiaWdpbnQgfCBCdWZmZXIgfCBEYXRlIHwgRXJyb3IgfCB1bmRlZmluZWR9IHZhbHVlIC0gUnVudGltZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtFbmNvZGVkQnJva2VyVmFsdWV9IC0gVGFnZ2VkIHRyYW5zcG9ydCB2YWx1ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuY29kZUJyb2tlclZhbHVlKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge1tUQUddOiBcInVuZGVmaW5lZFwifVxuICBpZiAodmFsdWUgPT09IG51bGwpIHJldHVybiB7W1RBR106IFwibnVsbFwifVxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImJpZ2ludFwiKSByZXR1cm4ge1tUQUddOiBcImJpZ2ludFwiLCB2YWx1ZTogYCR7dmFsdWV9YH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChOdW1iZXIuaXNOYU4odmFsdWUpKSByZXR1cm4ge1tUQUddOiBcIm5hblwifVxuICAgIGlmICh2YWx1ZSA9PT0gSW5maW5pdHkpIHJldHVybiB7W1RBR106IFwiaW5maW5pdHlcIn1cbiAgICBpZiAodmFsdWUgPT09IC1JbmZpbml0eSkgcmV0dXJuIHtbVEFHXTogXCJuZWdhdGl2ZS1pbmZpbml0eVwifVxuICAgIHJldHVybiB7W1RBR106IFwibnVtYmVyXCIsIHZhbHVlfVxuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHtbVEFHXTogdHlwZW9mIHZhbHVlLCB2YWx1ZX1cbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHtbVEFHXTogXCJkYXRlXCIsIHZhbHVlOiB2YWx1ZS50b0lTT1N0cmluZygpfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbHVlKSkgcmV0dXJuIHtbVEFHXTogXCJidWZmZXJcIiwgdmFsdWU6IHZhbHVlLnRvU3RyaW5nKFwiYmFzZTY0XCIpfVxuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgZW5jb2RlQnJva2VyVmFsdWU+Pn0gKi9cbiAgICBjb25zdCBwcm9wZXJ0aWVzID0ge1xuICAgICAgbmFtZTogZW5jb2RlQnJva2VyVmFsdWUodmFsdWUubmFtZSksXG4gICAgICBtZXNzYWdlOiBlbmNvZGVCcm9rZXJWYWx1ZSh2YWx1ZS5tZXNzYWdlKSxcbiAgICAgIHN0YWNrOiBlbmNvZGVCcm9rZXJWYWx1ZSh2YWx1ZS5zdGFjaylcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZSkpIHtcbiAgICAgIHByb3BlcnRpZXNba2V5XSA9IGVuY29kZUJyb2tlclZhbHVlKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSlba2V5XSlcbiAgICB9XG4gICAgaWYgKFwiY29kZVwiIGluIHZhbHVlKSBwcm9wZXJ0aWVzLmNvZGUgPSBlbmNvZGVCcm9rZXJWYWx1ZSh2YWx1ZS5jb2RlKVxuICAgIGlmICh2YWx1ZS5jYXVzZSAhPT0gdW5kZWZpbmVkKSBwcm9wZXJ0aWVzLmNhdXNlID0gZW5jb2RlQnJva2VyVmFsdWUodmFsdWUuY2F1c2UpXG5cbiAgICByZXR1cm4ge1tUQUddOiBcImVycm9yXCIsIHZhbHVlOiBwcm9wZXJ0aWVzfVxuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHtbVEFHXTogXCJhcnJheVwiLCB2YWx1ZTogdmFsdWUubWFwKChlbnRyeSkgPT4gZW5jb2RlQnJva2VyVmFsdWUoZW50cnkpKX1cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgZW5jb2RlQnJva2VyVmFsdWU+Pn0gKi9cbiAgICBjb25zdCBlbnRyaWVzID0ge31cbiAgICBmb3IgKGNvbnN0IFtrZXksIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyh2YWx1ZSkpIGVudHJpZXNba2V5XSA9IGVuY29kZUJyb2tlclZhbHVlKGVudHJ5KVxuICAgIHJldHVybiB7W1RBR106IFwib2JqZWN0XCIsIHZhbHVlOiBlbnRyaWVzfVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcihgU2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciBjYW5ub3QgZW5jb2RlICR7dHlwZW9mIHZhbHVlfWApXG59XG5cbi8qKlxuICogRGVjb2RlcyBhIHRhZ2dlZCBicm9rZXIgdHJhbnNwb3J0IHZhbHVlLlxuICogQHBhcmFtIHtFbmNvZGVkQnJva2VyVmFsdWV9IGVuY29kZWQgLSBUYWdnZWQgdHJhbnNwb3J0IHZhbHVlLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgYmlnaW50IHwgQnVmZmVyIHwgRGF0ZSB8IEVycm9yIHwgdW5kZWZpbmVkfSAtIFJ1bnRpbWUgdmFsdWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWNvZGVCcm9rZXJWYWx1ZShlbmNvZGVkKSB7XG4gIGlmICghZW5jb2RlZCB8fCB0eXBlb2YgZW5jb2RlZCAhPT0gXCJvYmplY3RcIiB8fCB0eXBlb2YgZW5jb2RlZFtUQUddICE9PSBcInN0cmluZ1wiKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkludmFsaWQgc2hhcmVkIHRyYW5zYWN0aW9uIGJyb2tlciB2YWx1ZVwiKVxuICB9XG5cbiAgc3dpdGNoIChlbmNvZGVkW1RBR10pIHtcbiAgICBjYXNlIFwidW5kZWZpbmVkXCI6IHJldHVybiB1bmRlZmluZWRcbiAgICBjYXNlIFwibnVsbFwiOiByZXR1cm4gbnVsbFxuICAgIGNhc2UgXCJiaWdpbnRcIjogcmV0dXJuIEJpZ0ludCgvKiogQHR5cGUge3N0cmluZ30gKi8gKGVuY29kZWQudmFsdWUpKVxuICAgIGNhc2UgXCJuYW5cIjogcmV0dXJuIE5hTlxuICAgIGNhc2UgXCJpbmZpbml0eVwiOiByZXR1cm4gSW5maW5pdHlcbiAgICBjYXNlIFwibmVnYXRpdmUtaW5maW5pdHlcIjogcmV0dXJuIC1JbmZpbml0eVxuICAgIGNhc2UgXCJudW1iZXJcIjpcbiAgICBjYXNlIFwic3RyaW5nXCI6XG4gICAgY2FzZSBcImJvb2xlYW5cIjogcmV0dXJuIGVuY29kZWQudmFsdWVcbiAgICBjYXNlIFwiZGF0ZVwiOiByZXR1cm4gbmV3IERhdGUoLyoqIEB0eXBlIHtzdHJpbmd9ICovIChlbmNvZGVkLnZhbHVlKSlcbiAgICBjYXNlIFwiYnVmZmVyXCI6IHJldHVybiBCdWZmZXIuZnJvbSgvKiogQHR5cGUge3N0cmluZ30gKi8gKGVuY29kZWQudmFsdWUpLCBcImJhc2U2NFwiKVxuICAgIGNhc2UgXCJhcnJheVwiOiByZXR1cm4gLyoqIEB0eXBlIHtFbmNvZGVkQnJva2VyVmFsdWVbXX0gKi8gKGVuY29kZWQudmFsdWUpLm1hcCgoZW50cnkpID0+IGRlY29kZUJyb2tlclZhbHVlKGVudHJ5KSlcbiAgICBjYXNlIFwib2JqZWN0XCI6IHJldHVybiBkZWNvZGVQcm9wZXJ0aWVzKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRW5jb2RlZEJyb2tlclZhbHVlPn0gKi8gKGVuY29kZWQudmFsdWUpKVxuICAgIGNhc2UgXCJlcnJvclwiOiByZXR1cm4gZGVjb2RlRXJyb3IoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBFbmNvZGVkQnJva2VyVmFsdWU+fSAqLyAoZW5jb2RlZC52YWx1ZSkpXG4gICAgZGVmYXVsdDogdGhyb3cgbmV3IFR5cGVFcnJvcihgVW5rbm93biBzaGFyZWQgdHJhbnNhY3Rpb24gYnJva2VyIHZhbHVlIHRhZzogJHtlbmNvZGVkW1RBR119YClcbiAgfVxufVxuXG4vKipcbiAqIERlY29kZXMgb2JqZWN0IHByb3BlcnRpZXMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIEVuY29kZWRCcm9rZXJWYWx1ZT59IHByb3BlcnRpZXMgLSBFbmNvZGVkIHByb3BlcnRpZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgZGVjb2RlQnJva2VyVmFsdWU+Pn0gLSBEZWNvZGVkIHByb3BlcnRpZXMuXG4gKi9cbmZ1bmN0aW9uIGRlY29kZVByb3BlcnRpZXMocHJvcGVydGllcykge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIGRlY29kZUJyb2tlclZhbHVlPj59ICovXG4gIGNvbnN0IGRlY29kZWQgPSB7fVxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcm9wZXJ0aWVzKSkgZGVjb2RlZFtrZXldID0gZGVjb2RlQnJva2VyVmFsdWUodmFsdWUpXG4gIHJldHVybiBkZWNvZGVkXG59XG5cbi8qKlxuICogUmVjb25zdHJ1Y3RzIGFuIGVycm9yIGZyb20gaXRzIHRhZ2dlZCBwcm9wZXJ0aWVzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBFbmNvZGVkQnJva2VyVmFsdWU+fSBwcm9wZXJ0aWVzIC0gRW5jb2RlZCBlcnJvciBwcm9wZXJ0aWVzLlxuICogQHJldHVybnMge0Vycm9yfSAtIERlY29kZWQgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGRlY29kZUVycm9yKHByb3BlcnRpZXMpIHtcbiAgY29uc3QgZGVjb2RlZCA9IGRlY29kZVByb3BlcnRpZXMocHJvcGVydGllcylcbiAgY29uc3QgRXJyb3JDbGFzcyA9IGRlY29kZWQubmFtZSA9PT0gXCJUeXBlRXJyb3JcIiA/IFR5cGVFcnJvciA6IEVycm9yXG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yQ2xhc3MoLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkZWNvZGVkLm1lc3NhZ2UpLCBkZWNvZGVkLmNhdXNlID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiB7Y2F1c2U6IGRlY29kZWQuY2F1c2V9KVxuXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGRlY29kZWQpKSB7XG4gICAgaWYgKGtleSA9PT0gXCJtZXNzYWdlXCIgfHwga2V5ID09PSBcImNhdXNlXCIpIGNvbnRpbnVlXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBkZWNvZGVCcm9rZXJWYWx1ZT4+fSAqLyAoZXJyb3IpW2tleV0gPSB2YWx1ZVxuICB9XG5cbiAgcmV0dXJuIGVycm9yXG59XG4iXX0=