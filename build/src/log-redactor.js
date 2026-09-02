// @ts-check
import { forcedString } from "typanic";
export const LOG_REDACTION_MARKER = "[REDACTED]";
const MIN_UNSTRUCTURED_REDACTION_VALUE_LENGTH = 8;
const DEFAULT_SENSITIVE_NAME_PARTS = [
    "apikey",
    "authentication",
    "authorization",
    "contentbase64",
    "credential",
    "password",
    "secret",
    "token"
];
/**
 * Normalizes case and common header/parameter separators for policy matching.
 * @param {string} name - Header or parameter name.
 * @returns {string} - Normalized policy name.
 */
function normalizedSensitiveName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/gu, "");
}
/**
 * Decodes a URL query component while leaving malformed client input inspectable.
 * @param {string} value - Encoded query component.
 * @returns {string} - Decoded component, or the original malformed value.
 */
function decodedQueryComponent(value) {
    try {
        return decodeURIComponent(value.replaceAll("+", " "));
    }
    catch (error) {
        if (error instanceof URIError)
            return value;
        throw error;
    }
}
/** Owns structured logging redaction and request-local sensitive values. */
export default class LogRedactor {
    /**
     * Builds a structured logging redactor.
     * @param {object} [args] - Redaction policy options.
     * @param {string[]} [args.sensitiveNames] - Application-defined sensitive names.
     */
    constructor({ sensitiveNames = [] } = {}) {
        if (!Array.isArray(sensitiveNames)) {
            throw new TypeError("logging.sensitiveNames must be an array");
        }
        this._extendedSensitiveNames = sensitiveNames.map((name, index) => {
            const validatedName = forcedString(name, `logging.sensitiveNames[${index}]`);
            const normalizedName = normalizedSensitiveName(validatedName);
            if (!normalizedName)
                throw new TypeError(`logging.sensitiveNames[${index}] must not be blank`);
            return normalizedName;
        });
    }
    /**
     * Checks a structured name against the default and application policy.
     * @param {string} name - Header or parameter name.
     * @returns {boolean} - Whether values under the name are sensitive.
     */
    isSensitiveName(name) {
        const normalizedName = normalizedSensitiveName(name);
        for (const sensitivePart of DEFAULT_SENSITIVE_NAME_PARTS) {
            if (normalizedName.includes(sensitivePart))
                return true;
        }
        if (normalizedName === "cookie" || normalizedName.endsWith("cookie"))
            return true;
        if (normalizedName === "cookies" || normalizedName.endsWith("cookies"))
            return true;
        if (normalizedName === "session" || normalizedName.endsWith("session"))
            return true;
        if (normalizedName === "sessionid" || normalizedName.endsWith("sessionid"))
            return true;
        for (const extendedName of this._extendedSensitiveNames) {
            if (normalizedName === extendedName || normalizedName.endsWith(extendedName))
                return true;
        }
        return false;
    }
    /**
     * Collects values found below sensitive structured names.
     * @param {ReturnType<typeof JSON.parse>} value - Structured value.
     * @param {Set<string>} [initialValues] - Values already registered for this request.
     * @returns {Set<string>} - A new set containing all registered representations.
     */
    sensitiveValues(value, initialValues = new Set()) {
        const values = new Set(initialValues);
        this._collectSensitiveValues(value, "", values, new WeakSet());
        return values;
    }
    /**
     * Collects sensitive values from every structured request surface.
     * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default} request - Incoming request.
     * @param {Set<string>} [initialValues] - Values already registered for this request.
     * @returns {Set<string>} - Request-local sensitive values.
     */
    requestSensitiveValues(request, initialValues = new Set()) {
        let values = this.sensitiveValues(request.headers(), initialValues);
        values = this.sensitiveValues(request.params(), values);
        values = this.sensitiveValues(request.queryParams(), values);
        values = this.sensitiveValues(request.metadata(), values);
        this.redactPath(request.path(), values);
        return values;
    }
    /**
     * Redacts a structured value without mutating it.
     * @param {ReturnType<typeof JSON.parse>} value - Value to redact.
     * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
     * @returns {ReturnType<typeof JSON.parse>} - Redacted structural copy.
     */
    redactStructured(value, sensitiveValues = new Set()) {
        const collectedValues = this.sensitiveValues(value, sensitiveValues);
        return this._redactStructured(value, "", collectedValues, new WeakSet());
    }
    /**
     * Replaces exact known sensitive values in diagnostic text.
     * @param {string} value - Diagnostic text.
     * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
     * @returns {string} - Redacted text.
     */
    redactString(value, sensitiveValues = new Set()) {
        let redacted = value;
        const orderedValues = [...sensitiveValues].sort((left, right) => right.length - left.length);
        for (const sensitiveValue of orderedValues) {
            if (sensitiveValue.length < MIN_UNSTRUCTURED_REDACTION_VALUE_LENGTH ||
                sensitiveValue === LOG_REDACTION_MARKER)
                continue;
            redacted = redacted.replaceAll(sensitiveValue, LOG_REDACTION_MARKER);
        }
        return redacted;
    }
    /**
     * Builds an Error-compatible diagnostic with redacted message and backtrace.
     * @param {Error} error - Original error.
     * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
     * @returns {Error} - Redacted error diagnostic.
     */
    redactError(error, sensitiveValues = new Set()) {
        const redactedError = new Error(this.redactString(error.message, sensitiveValues));
        redactedError.name = error.name;
        if (error.stack)
            redactedError.stack = this.redactString(error.stack, sensitiveValues);
        const errorCode = /** @type {{code?: string}} */ (error).code;
        if (errorCode) /** @type {{code?: string}} */
            (redactedError).code = this.redactString(errorCode, sensitiveValues);
        return redactedError;
    }
    /**
     * Redacts named query values and registered path values without parsing SQL-like text.
     * @param {string} path - Request path, optionally including a query string.
     * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
     * @returns {string} - Redacted request path.
     */
    redactPath(path, sensitiveValues = new Set()) {
        const queryIndex = path.indexOf("?");
        if (queryIndex === -1)
            return this.redactString(path, sensitiveValues);
        const pathPrefix = path.slice(0, queryIndex);
        const queryAndFragment = path.slice(queryIndex + 1);
        const fragmentIndex = queryAndFragment.indexOf("#");
        const query = fragmentIndex === -1 ? queryAndFragment : queryAndFragment.slice(0, fragmentIndex);
        const fragment = fragmentIndex === -1 ? "" : queryAndFragment.slice(fragmentIndex);
        const entries = query.split("&");
        for (const entry of entries) {
            const separatorIndex = entry.indexOf("=");
            const encodedName = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
            const encodedValue = separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1);
            const name = decodedQueryComponent(encodedName);
            if (this.isSensitiveName(name)) {
                this._addSensitiveString(encodedValue, name, sensitiveValues);
                this._addSensitiveString(decodedQueryComponent(encodedValue), name, sensitiveValues);
            }
        }
        const redactedEntries = entries.map((entry) => {
            const separatorIndex = entry.indexOf("=");
            const encodedName = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
            const name = decodedQueryComponent(encodedName);
            if (this.isSensitiveName(name)) {
                return `${encodedName}=${LOG_REDACTION_MARKER}`;
            }
            return this.redactString(entry, sensitiveValues);
        });
        return `${this.redactString(pathPrefix, sensitiveValues)}?${redactedEntries.join("&")}${this.redactString(fragment, sensitiveValues)}`;
    }
    /**
     * Traverses structured values to find sensitive-name descendants.
     * @param {ReturnType<typeof JSON.parse>} value - Current structured value.
     * @param {string} key - Owning structured name.
     * @param {Set<string>} values - Collected sensitive values.
     * @param {WeakSet<object>} seen - Visited object references.
     * @returns {void} - No return value.
     */
    _collectSensitiveValues(value, key, values, seen) {
        if (this.isSensitiveName(key)) {
            this._collectLeafValues(value, key, values, seen);
            return;
        }
        if (!value || typeof value !== "object")
            return;
        if (seen.has(value))
            return;
        seen.add(value);
        if (Array.isArray(value)) {
            for (const entry of value)
                this._collectSensitiveValues(entry, key, values, seen);
        }
        else {
            for (const [entryKey, entryValue] of Object.entries(value)) {
                this._collectSensitiveValues(entryValue, entryKey, values, seen);
            }
        }
        seen.delete(value);
    }
    /**
     * Registers primitive leaves below a sensitive structured name.
     * @param {ReturnType<typeof JSON.parse>} value - Value below a sensitive name.
     * @param {string} key - Sensitive structured name.
     * @param {Set<string>} values - Collected sensitive values.
     * @param {WeakSet<object>} seen - Visited object references.
     * @returns {void} - No return value.
     */
    _collectLeafValues(value, key, values, seen) {
        if (typeof value === "string" || typeof value === "number") {
            this._addSensitiveString(String(value), key, values);
            return;
        }
        if (!value || typeof value !== "object" || seen.has(value))
            return;
        seen.add(value);
        for (const entryValue of Array.isArray(value) ? value : Object.values(value)) {
            this._collectLeafValues(entryValue, key, values, seen);
        }
        seen.delete(value);
    }
    /**
     * Registers common encoded and credential-bearing representations.
     * @param {string} value - Sensitive string.
     * @param {string} key - Sensitive structured name.
     * @param {Set<string>} values - Collected sensitive values.
     * @returns {void} - No return value.
     */
    _addSensitiveString(value, key, values) {
        if (!value)
            return;
        values.add(value);
        values.add(encodeURIComponent(value));
        values.add(value.replaceAll("'", "''"));
        values.add(value.replaceAll("\\", "\\\\").replaceAll("'", "\\'"));
        const normalizedKey = normalizedSensitiveName(key);
        if (normalizedKey.includes("authorization") || normalizedKey.includes("authentication")) {
            const separatorIndex = value.indexOf(" ");
            if (separatorIndex !== -1)
                this._addSensitiveString(value.slice(separatorIndex + 1).trim(), "token", values);
        }
        if (normalizedKey.endsWith("cookie") || normalizedKey.endsWith("cookies")) {
            for (const cookiePart of value.split(";")) {
                const separatorIndex = cookiePart.indexOf("=");
                if (separatorIndex !== -1)
                    this._addSensitiveString(cookiePart.slice(separatorIndex + 1).trim(), "token", values);
            }
        }
    }
    /**
     * Produces a recursively redacted structural copy.
     * @param {ReturnType<typeof JSON.parse>} value - Current structured value.
     * @param {string} key - Owning structured name.
     * @param {Set<string>} sensitiveValues - Request-local sensitive values.
     * @param {WeakSet<object>} seen - Visited object references.
     * @returns {ReturnType<typeof JSON.parse>} - Redacted value.
     */
    _redactStructured(value, key, sensitiveValues, seen) {
        if (this.isSensitiveName(key))
            return LOG_REDACTION_MARKER;
        if (typeof value === "string")
            return this.redactString(value, sensitiveValues);
        if (!value || typeof value !== "object")
            return value;
        if (seen.has(value))
            return "[Circular]";
        seen.add(value);
        if (Array.isArray(value)) {
            const redactedArray = value.map((entry) => this._redactStructured(entry, key, sensitiveValues, seen));
            seen.delete(value);
            return redactedArray;
        }
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const redactedObject = {};
        for (const [entryKey, entryValue] of Object.entries(value)) {
            redactedObject[entryKey] = this._redactStructured(entryValue, entryKey, sensitiveValues, seen);
        }
        seen.delete(value);
        return redactedObject;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLXJlZGFjdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2xvZy1yZWRhY3Rvci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUV0QyxNQUFNLENBQUMsTUFBTSxvQkFBb0IsR0FBRyxZQUFZLENBQUE7QUFFaEQsTUFBTSx1Q0FBdUMsR0FBRyxDQUFDLENBQUE7QUFFakQsTUFBTSw0QkFBNEIsR0FBRztJQUNuQyxRQUFRO0lBQ1IsZ0JBQWdCO0lBQ2hCLGVBQWU7SUFDZixlQUFlO0lBQ2YsWUFBWTtJQUNaLFVBQVU7SUFDVixRQUFRO0lBQ1IsT0FBTztDQUNSLENBQUE7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyx1QkFBdUIsQ0FBQyxJQUFJO0lBQ25DLE9BQU8sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEVBQUUsRUFBRSxDQUFDLENBQUE7QUFDdEQsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHFCQUFxQixDQUFDLEtBQUs7SUFDbEMsSUFBSSxDQUFDO1FBQ0gsT0FBTyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFBO0lBQ3ZELENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsSUFBSSxLQUFLLFlBQVksUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTNDLE1BQU0sS0FBSyxDQUFBO0lBQ2IsQ0FBQztBQUNILENBQUM7QUFFRCw0RUFBNEU7QUFDNUUsTUFBTSxDQUFDLE9BQU8sT0FBTyxXQUFXO0lBQzlCOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsY0FBYyxHQUFHLEVBQUUsRUFBQyxHQUFHLEVBQUU7UUFDcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztZQUNuQyxNQUFNLElBQUksU0FBUyxDQUFDLHlDQUF5QyxDQUFDLENBQUE7UUFDaEUsQ0FBQztRQUVELElBQUksQ0FBQyx1QkFBdUIsR0FBRyxjQUFjLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO1lBQ2hFLE1BQU0sYUFBYSxHQUFHLFlBQVksQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEtBQUssR0FBRyxDQUFDLENBQUE7WUFDNUUsTUFBTSxjQUFjLEdBQUcsdUJBQXVCLENBQUMsYUFBYSxDQUFDLENBQUE7WUFFN0QsSUFBSSxDQUFDLGNBQWM7Z0JBQUUsTUFBTSxJQUFJLFNBQVMsQ0FBQywwQkFBMEIsS0FBSyxxQkFBcUIsQ0FBQyxDQUFBO1lBRTlGLE9BQU8sY0FBYyxDQUFBO1FBQ3ZCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsSUFBSTtRQUNsQixNQUFNLGNBQWMsR0FBRyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUVwRCxLQUFLLE1BQU0sYUFBYSxJQUFJLDRCQUE0QixFQUFFLENBQUM7WUFDekQsSUFBSSxjQUFjLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQztnQkFBRSxPQUFPLElBQUksQ0FBQTtRQUN6RCxDQUFDO1FBRUQsSUFBSSxjQUFjLEtBQUssUUFBUSxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDakYsSUFBSSxjQUFjLEtBQUssU0FBUyxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDbkYsSUFBSSxjQUFjLEtBQUssU0FBUyxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDbkYsSUFBSSxjQUFjLEtBQUssV0FBVyxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFdkYsS0FBSyxNQUFNLFlBQVksSUFBSSxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztZQUN4RCxJQUFJLGNBQWMsS0FBSyxZQUFZLElBQUksY0FBYyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUE7UUFDM0YsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsZUFBZSxDQUFDLEtBQUssRUFBRSxhQUFhLEdBQUcsSUFBSSxHQUFHLEVBQUU7UUFDOUMsTUFBTSxNQUFNLEdBQUcsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFckMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLElBQUksT0FBTyxFQUFFLENBQUMsQ0FBQTtRQUU5RCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHNCQUFzQixDQUFDLE9BQU8sRUFBRSxhQUFhLEdBQUcsSUFBSSxHQUFHLEVBQUU7UUFDdkQsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLEVBQUUsYUFBYSxDQUFDLENBQUE7UUFFbkUsTUFBTSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQ3ZELE1BQU0sR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUM1RCxNQUFNLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDekQsSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFFdkMsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxnQkFBZ0IsQ0FBQyxLQUFLLEVBQUUsZUFBZSxHQUFHLElBQUksR0FBRyxFQUFFO1FBQ2pELE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsS0FBSyxFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBRXBFLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsZUFBZSxFQUFFLElBQUksT0FBTyxFQUFFLENBQUMsQ0FBQTtJQUMxRSxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxZQUFZLENBQUMsS0FBSyxFQUFFLGVBQWUsR0FBRyxJQUFJLEdBQUcsRUFBRTtRQUM3QyxJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUE7UUFDcEIsTUFBTSxhQUFhLEdBQUcsQ0FBQyxHQUFHLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRTVGLEtBQUssTUFBTSxjQUFjLElBQUksYUFBYSxFQUFFLENBQUM7WUFDM0MsSUFDRSxjQUFjLENBQUMsTUFBTSxHQUFHLHVDQUF1QztnQkFDL0QsY0FBYyxLQUFLLG9CQUFvQjtnQkFDdkMsU0FBUTtZQUVWLFFBQVEsR0FBRyxRQUFRLENBQUMsVUFBVSxDQUFDLGNBQWMsRUFBRSxvQkFBb0IsQ0FBQyxDQUFBO1FBQ3RFLENBQUM7UUFFRCxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxXQUFXLENBQUMsS0FBSyxFQUFFLGVBQWUsR0FBRyxJQUFJLEdBQUcsRUFBRTtRQUM1QyxNQUFNLGFBQWEsR0FBRyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUVsRixhQUFhLENBQUMsSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUE7UUFFL0IsSUFBSSxLQUFLLENBQUMsS0FBSztZQUFFLGFBQWEsQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBRXRGLE1BQU0sU0FBUyxHQUFHLDhCQUE4QixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBRTdELElBQUksU0FBUyxFQUFFLDhCQUE4QjtZQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBRWxILE9BQU8sYUFBYSxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFVBQVUsQ0FBQyxJQUFJLEVBQUUsZUFBZSxHQUFHLElBQUksR0FBRyxFQUFFO1FBQzFDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUE7UUFFcEMsSUFBSSxVQUFVLEtBQUssQ0FBQyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxlQUFlLENBQUMsQ0FBQTtRQUV0RSxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUM1QyxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFBO1FBQ25ELE1BQU0sYUFBYSxHQUFHLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNuRCxNQUFNLEtBQUssR0FBRyxhQUFhLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGFBQWEsQ0FBQyxDQUFBO1FBQ2hHLE1BQU0sUUFBUSxHQUFHLGFBQWEsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDbEYsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUVoQyxLQUFLLE1BQU0sS0FBSyxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQzVCLE1BQU0sY0FBYyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUE7WUFDekMsTUFBTSxXQUFXLEdBQUcsY0FBYyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGNBQWMsQ0FBQyxDQUFBO1lBQ2xGLE1BQU0sWUFBWSxHQUFHLGNBQWMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLGNBQWMsR0FBRyxDQUFDLENBQUMsQ0FBQTtZQUNqRixNQUFNLElBQUksR0FBRyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsQ0FBQTtZQUUvQyxJQUFJLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDL0IsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsZUFBZSxDQUFDLENBQUE7Z0JBQzdELElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQyxZQUFZLENBQUMsRUFBRSxJQUFJLEVBQUUsZUFBZSxDQUFDLENBQUE7WUFDdEYsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLGVBQWUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDNUMsTUFBTSxjQUFjLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUN6QyxNQUFNLFdBQVcsR0FBRyxjQUFjLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsY0FBYyxDQUFDLENBQUE7WUFDbEYsTUFBTSxJQUFJLEdBQUcscUJBQXFCLENBQUMsV0FBVyxDQUFDLENBQUE7WUFFL0MsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQy9CLE9BQU8sR0FBRyxXQUFXLElBQUksb0JBQW9CLEVBQUUsQ0FBQTtZQUNqRCxDQUFDO1lBRUQsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxlQUFlLENBQUMsQ0FBQTtRQUNsRCxDQUFDLENBQUMsQ0FBQTtRQUVGLE9BQU8sR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxlQUFlLENBQUMsSUFBSSxlQUFlLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsUUFBUSxFQUFFLGVBQWUsQ0FBQyxFQUFFLENBQUE7SUFDeEksQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCx1QkFBdUIsQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFLE1BQU0sRUFBRSxJQUFJO1FBQzlDLElBQUksSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzlCLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQTtZQUNqRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUTtZQUFFLE9BQU07UUFDL0MsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQztZQUFFLE9BQU07UUFFM0IsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUVmLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3pCLEtBQUssTUFBTSxLQUFLLElBQUksS0FBSztnQkFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDbkYsQ0FBQzthQUFNLENBQUM7WUFDTixLQUFLLE1BQU0sQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUMzRCxJQUFJLENBQUMsdUJBQXVCLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUE7WUFDbEUsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsa0JBQWtCLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxNQUFNLEVBQUUsSUFBSTtRQUN6QyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUMzRCxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQTtZQUNwRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUVsRSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRWYsS0FBSyxNQUFNLFVBQVUsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUM3RSxJQUFJLENBQUMsa0JBQWtCLENBQUMsVUFBVSxFQUFFLEdBQUcsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDeEQsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILG1CQUFtQixDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsTUFBTTtRQUNwQyxJQUFJLENBQUMsS0FBSztZQUFFLE9BQU07UUFFbEIsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUNqQixNQUFNLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFDckMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFBO1FBQ3ZDLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBRWpFLE1BQU0sYUFBYSxHQUFHLHVCQUF1QixDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBRWxELElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQztZQUN4RixNQUFNLGNBQWMsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1lBRXpDLElBQUksY0FBYyxLQUFLLENBQUMsQ0FBQztnQkFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxjQUFjLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQzlHLENBQUM7UUFFRCxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQzFFLEtBQUssTUFBTSxVQUFVLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUMxQyxNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUU5QyxJQUFJLGNBQWMsS0FBSyxDQUFDLENBQUM7b0JBQUUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsY0FBYyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQTtZQUNuSCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsaUJBQWlCLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxlQUFlLEVBQUUsSUFBSTtRQUNqRCxJQUFJLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDO1lBQUUsT0FBTyxvQkFBb0IsQ0FBQTtRQUMxRCxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBQy9FLElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBQ3JELElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUM7WUFBRSxPQUFPLFlBQVksQ0FBQTtRQUV4QyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRWYsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDekIsTUFBTSxhQUFhLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsZUFBZSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUE7WUFFckcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNsQixPQUFPLGFBQWEsQ0FBQTtRQUN0QixDQUFDO1FBRUQsNERBQTREO1FBQzVELE1BQU0sY0FBYyxHQUFHLEVBQUUsQ0FBQTtRQUV6QixLQUFLLE1BQU0sQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzNELGNBQWMsQ0FBQyxRQUFRLENBQUMsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDaEcsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFbEIsT0FBTyxjQUFjLENBQUE7SUFDdkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IGZvcmNlZFN0cmluZyB9IGZyb20gXCJ0eXBhbmljXCJcblxuZXhwb3J0IGNvbnN0IExPR19SRURBQ1RJT05fTUFSS0VSID0gXCJbUkVEQUNURURdXCJcblxuY29uc3QgTUlOX1VOU1RSVUNUVVJFRF9SRURBQ1RJT05fVkFMVUVfTEVOR1RIID0gOFxuXG5jb25zdCBERUZBVUxUX1NFTlNJVElWRV9OQU1FX1BBUlRTID0gW1xuICBcImFwaWtleVwiLFxuICBcImF1dGhlbnRpY2F0aW9uXCIsXG4gIFwiYXV0aG9yaXphdGlvblwiLFxuICBcImNvbnRlbnRiYXNlNjRcIixcbiAgXCJjcmVkZW50aWFsXCIsXG4gIFwicGFzc3dvcmRcIixcbiAgXCJzZWNyZXRcIixcbiAgXCJ0b2tlblwiXG5dXG5cbi8qKlxuICogTm9ybWFsaXplcyBjYXNlIGFuZCBjb21tb24gaGVhZGVyL3BhcmFtZXRlciBzZXBhcmF0b3JzIGZvciBwb2xpY3kgbWF0Y2hpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEhlYWRlciBvciBwYXJhbWV0ZXIgbmFtZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBwb2xpY3kgbmFtZS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplZFNlbnNpdGl2ZU5hbWUobmFtZSkge1xuICByZXR1cm4gbmFtZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05XS9ndSwgXCJcIilcbn1cblxuLyoqXG4gKiBEZWNvZGVzIGEgVVJMIHF1ZXJ5IGNvbXBvbmVudCB3aGlsZSBsZWF2aW5nIG1hbGZvcm1lZCBjbGllbnQgaW5wdXQgaW5zcGVjdGFibGUuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBFbmNvZGVkIHF1ZXJ5IGNvbXBvbmVudC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVjb2RlZCBjb21wb25lbnQsIG9yIHRoZSBvcmlnaW5hbCBtYWxmb3JtZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGRlY29kZWRRdWVyeUNvbXBvbmVudCh2YWx1ZSkge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQodmFsdWUucmVwbGFjZUFsbChcIitcIiwgXCIgXCIpKVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFVSSUVycm9yKSByZXR1cm4gdmFsdWVcblxuICAgIHRocm93IGVycm9yXG4gIH1cbn1cblxuLyoqIE93bnMgc3RydWN0dXJlZCBsb2dnaW5nIHJlZGFjdGlvbiBhbmQgcmVxdWVzdC1sb2NhbCBzZW5zaXRpdmUgdmFsdWVzLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTG9nUmVkYWN0b3Ige1xuICAvKipcbiAgICogQnVpbGRzIGEgc3RydWN0dXJlZCBsb2dnaW5nIHJlZGFjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gUmVkYWN0aW9uIHBvbGljeSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5zZW5zaXRpdmVOYW1lc10gLSBBcHBsaWNhdGlvbi1kZWZpbmVkIHNlbnNpdGl2ZSBuYW1lcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtzZW5zaXRpdmVOYW1lcyA9IFtdfSA9IHt9KSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNlbnNpdGl2ZU5hbWVzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImxvZ2dpbmcuc2Vuc2l0aXZlTmFtZXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIH1cblxuICAgIHRoaXMuX2V4dGVuZGVkU2Vuc2l0aXZlTmFtZXMgPSBzZW5zaXRpdmVOYW1lcy5tYXAoKG5hbWUsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0ZWROYW1lID0gZm9yY2VkU3RyaW5nKG5hbWUsIGBsb2dnaW5nLnNlbnNpdGl2ZU5hbWVzWyR7aW5kZXh9XWApXG4gICAgICBjb25zdCBub3JtYWxpemVkTmFtZSA9IG5vcm1hbGl6ZWRTZW5zaXRpdmVOYW1lKHZhbGlkYXRlZE5hbWUpXG5cbiAgICAgIGlmICghbm9ybWFsaXplZE5hbWUpIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvZ2dpbmcuc2Vuc2l0aXZlTmFtZXNbJHtpbmRleH1dIG11c3Qgbm90IGJlIGJsYW5rYClcblxuICAgICAgcmV0dXJuIG5vcm1hbGl6ZWROYW1lXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgYSBzdHJ1Y3R1cmVkIG5hbWUgYWdhaW5zdCB0aGUgZGVmYXVsdCBhbmQgYXBwbGljYXRpb24gcG9saWN5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEhlYWRlciBvciBwYXJhbWV0ZXIgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZXMgdW5kZXIgdGhlIG5hbWUgYXJlIHNlbnNpdGl2ZS5cbiAgICovXG4gIGlzU2Vuc2l0aXZlTmFtZShuYW1lKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZE5hbWUgPSBub3JtYWxpemVkU2Vuc2l0aXZlTmFtZShuYW1lKVxuXG4gICAgZm9yIChjb25zdCBzZW5zaXRpdmVQYXJ0IG9mIERFRkFVTFRfU0VOU0lUSVZFX05BTUVfUEFSVFMpIHtcbiAgICAgIGlmIChub3JtYWxpemVkTmFtZS5pbmNsdWRlcyhzZW5zaXRpdmVQYXJ0KSkgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAobm9ybWFsaXplZE5hbWUgPT09IFwiY29va2llXCIgfHwgbm9ybWFsaXplZE5hbWUuZW5kc1dpdGgoXCJjb29raWVcIikpIHJldHVybiB0cnVlXG4gICAgaWYgKG5vcm1hbGl6ZWROYW1lID09PSBcImNvb2tpZXNcIiB8fCBub3JtYWxpemVkTmFtZS5lbmRzV2l0aChcImNvb2tpZXNcIikpIHJldHVybiB0cnVlXG4gICAgaWYgKG5vcm1hbGl6ZWROYW1lID09PSBcInNlc3Npb25cIiB8fCBub3JtYWxpemVkTmFtZS5lbmRzV2l0aChcInNlc3Npb25cIikpIHJldHVybiB0cnVlXG4gICAgaWYgKG5vcm1hbGl6ZWROYW1lID09PSBcInNlc3Npb25pZFwiIHx8IG5vcm1hbGl6ZWROYW1lLmVuZHNXaXRoKFwic2Vzc2lvbmlkXCIpKSByZXR1cm4gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCBleHRlbmRlZE5hbWUgb2YgdGhpcy5fZXh0ZW5kZWRTZW5zaXRpdmVOYW1lcykge1xuICAgICAgaWYgKG5vcm1hbGl6ZWROYW1lID09PSBleHRlbmRlZE5hbWUgfHwgbm9ybWFsaXplZE5hbWUuZW5kc1dpdGgoZXh0ZW5kZWROYW1lKSkgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsZWN0cyB2YWx1ZXMgZm91bmQgYmVsb3cgc2Vuc2l0aXZlIHN0cnVjdHVyZWQgbmFtZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3RydWN0dXJlZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW2luaXRpYWxWYWx1ZXNdIC0gVmFsdWVzIGFscmVhZHkgcmVnaXN0ZXJlZCBmb3IgdGhpcyByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gQSBuZXcgc2V0IGNvbnRhaW5pbmcgYWxsIHJlZ2lzdGVyZWQgcmVwcmVzZW50YXRpb25zLlxuICAgKi9cbiAgc2Vuc2l0aXZlVmFsdWVzKHZhbHVlLCBpbml0aWFsVmFsdWVzID0gbmV3IFNldCgpKSB7XG4gICAgY29uc3QgdmFsdWVzID0gbmV3IFNldChpbml0aWFsVmFsdWVzKVxuXG4gICAgdGhpcy5fY29sbGVjdFNlbnNpdGl2ZVZhbHVlcyh2YWx1ZSwgXCJcIiwgdmFsdWVzLCBuZXcgV2Vha1NldCgpKVxuXG4gICAgcmV0dXJuIHZhbHVlc1xuICB9XG5cbiAgLyoqXG4gICAqIENvbGxlY3RzIHNlbnNpdGl2ZSB2YWx1ZXMgZnJvbSBldmVyeSBzdHJ1Y3R1cmVkIHJlcXVlc3Qgc3VyZmFjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSByZXF1ZXN0IC0gSW5jb21pbmcgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW2luaXRpYWxWYWx1ZXNdIC0gVmFsdWVzIGFscmVhZHkgcmVnaXN0ZXJlZCBmb3IgdGhpcyByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gUmVxdWVzdC1sb2NhbCBzZW5zaXRpdmUgdmFsdWVzLlxuICAgKi9cbiAgcmVxdWVzdFNlbnNpdGl2ZVZhbHVlcyhyZXF1ZXN0LCBpbml0aWFsVmFsdWVzID0gbmV3IFNldCgpKSB7XG4gICAgbGV0IHZhbHVlcyA9IHRoaXMuc2Vuc2l0aXZlVmFsdWVzKHJlcXVlc3QuaGVhZGVycygpLCBpbml0aWFsVmFsdWVzKVxuXG4gICAgdmFsdWVzID0gdGhpcy5zZW5zaXRpdmVWYWx1ZXMocmVxdWVzdC5wYXJhbXMoKSwgdmFsdWVzKVxuICAgIHZhbHVlcyA9IHRoaXMuc2Vuc2l0aXZlVmFsdWVzKHJlcXVlc3QucXVlcnlQYXJhbXMoKSwgdmFsdWVzKVxuICAgIHZhbHVlcyA9IHRoaXMuc2Vuc2l0aXZlVmFsdWVzKHJlcXVlc3QubWV0YWRhdGEoKSwgdmFsdWVzKVxuICAgIHRoaXMucmVkYWN0UGF0aChyZXF1ZXN0LnBhdGgoKSwgdmFsdWVzKVxuXG4gICAgcmV0dXJuIHZhbHVlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZGFjdHMgYSBzdHJ1Y3R1cmVkIHZhbHVlIHdpdGhvdXQgbXV0YXRpbmcgaXQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gcmVkYWN0LlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbc2Vuc2l0aXZlVmFsdWVzXSAtIFJlcXVlc3QtbG9jYWwgc2Vuc2l0aXZlIHZhbHVlcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFJlZGFjdGVkIHN0cnVjdHVyYWwgY29weS5cbiAgICovXG4gIHJlZGFjdFN0cnVjdHVyZWQodmFsdWUsIHNlbnNpdGl2ZVZhbHVlcyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IGNvbGxlY3RlZFZhbHVlcyA9IHRoaXMuc2Vuc2l0aXZlVmFsdWVzKHZhbHVlLCBzZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICByZXR1cm4gdGhpcy5fcmVkYWN0U3RydWN0dXJlZCh2YWx1ZSwgXCJcIiwgY29sbGVjdGVkVmFsdWVzLCBuZXcgV2Vha1NldCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIGV4YWN0IGtub3duIHNlbnNpdGl2ZSB2YWx1ZXMgaW4gZGlhZ25vc3RpYyB0ZXh0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBEaWFnbm9zdGljIHRleHQuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IFtzZW5zaXRpdmVWYWx1ZXNdIC0gUmVxdWVzdC1sb2NhbCBzZW5zaXRpdmUgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlZGFjdGVkIHRleHQuXG4gICAqL1xuICByZWRhY3RTdHJpbmcodmFsdWUsIHNlbnNpdGl2ZVZhbHVlcyA9IG5ldyBTZXQoKSkge1xuICAgIGxldCByZWRhY3RlZCA9IHZhbHVlXG4gICAgY29uc3Qgb3JkZXJlZFZhbHVlcyA9IFsuLi5zZW5zaXRpdmVWYWx1ZXNdLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC5sZW5ndGggLSBsZWZ0Lmxlbmd0aClcblxuICAgIGZvciAoY29uc3Qgc2Vuc2l0aXZlVmFsdWUgb2Ygb3JkZXJlZFZhbHVlcykge1xuICAgICAgaWYgKFxuICAgICAgICBzZW5zaXRpdmVWYWx1ZS5sZW5ndGggPCBNSU5fVU5TVFJVQ1RVUkVEX1JFREFDVElPTl9WQUxVRV9MRU5HVEggfHxcbiAgICAgICAgc2Vuc2l0aXZlVmFsdWUgPT09IExPR19SRURBQ1RJT05fTUFSS0VSXG4gICAgICApIGNvbnRpbnVlXG5cbiAgICAgIHJlZGFjdGVkID0gcmVkYWN0ZWQucmVwbGFjZUFsbChzZW5zaXRpdmVWYWx1ZSwgTE9HX1JFREFDVElPTl9NQVJLRVIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlZGFjdGVkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGFuIEVycm9yLWNvbXBhdGlibGUgZGlhZ25vc3RpYyB3aXRoIHJlZGFjdGVkIG1lc3NhZ2UgYW5kIGJhY2t0cmFjZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBPcmlnaW5hbCBlcnJvci5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW3NlbnNpdGl2ZVZhbHVlc10gLSBSZXF1ZXN0LWxvY2FsIHNlbnNpdGl2ZSB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gLSBSZWRhY3RlZCBlcnJvciBkaWFnbm9zdGljLlxuICAgKi9cbiAgcmVkYWN0RXJyb3IoZXJyb3IsIHNlbnNpdGl2ZVZhbHVlcyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IHJlZGFjdGVkRXJyb3IgPSBuZXcgRXJyb3IodGhpcy5yZWRhY3RTdHJpbmcoZXJyb3IubWVzc2FnZSwgc2Vuc2l0aXZlVmFsdWVzKSlcblxuICAgIHJlZGFjdGVkRXJyb3IubmFtZSA9IGVycm9yLm5hbWVcblxuICAgIGlmIChlcnJvci5zdGFjaykgcmVkYWN0ZWRFcnJvci5zdGFjayA9IHRoaXMucmVkYWN0U3RyaW5nKGVycm9yLnN0YWNrLCBzZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICBjb25zdCBlcnJvckNvZGUgPSAvKiogQHR5cGUge3tjb2RlPzogc3RyaW5nfX0gKi8gKGVycm9yKS5jb2RlXG5cbiAgICBpZiAoZXJyb3JDb2RlKSAvKiogQHR5cGUge3tjb2RlPzogc3RyaW5nfX0gKi8gKHJlZGFjdGVkRXJyb3IpLmNvZGUgPSB0aGlzLnJlZGFjdFN0cmluZyhlcnJvckNvZGUsIHNlbnNpdGl2ZVZhbHVlcylcblxuICAgIHJldHVybiByZWRhY3RlZEVycm9yXG4gIH1cblxuICAvKipcbiAgICogUmVkYWN0cyBuYW1lZCBxdWVyeSB2YWx1ZXMgYW5kIHJlZ2lzdGVyZWQgcGF0aCB2YWx1ZXMgd2l0aG91dCBwYXJzaW5nIFNRTC1saWtlIHRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gUmVxdWVzdCBwYXRoLCBvcHRpb25hbGx5IGluY2x1ZGluZyBhIHF1ZXJ5IHN0cmluZy5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW3NlbnNpdGl2ZVZhbHVlc10gLSBSZXF1ZXN0LWxvY2FsIHNlbnNpdGl2ZSB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVkYWN0ZWQgcmVxdWVzdCBwYXRoLlxuICAgKi9cbiAgcmVkYWN0UGF0aChwYXRoLCBzZW5zaXRpdmVWYWx1ZXMgPSBuZXcgU2V0KCkpIHtcbiAgICBjb25zdCBxdWVyeUluZGV4ID0gcGF0aC5pbmRleE9mKFwiP1wiKVxuXG4gICAgaWYgKHF1ZXJ5SW5kZXggPT09IC0xKSByZXR1cm4gdGhpcy5yZWRhY3RTdHJpbmcocGF0aCwgc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgY29uc3QgcGF0aFByZWZpeCA9IHBhdGguc2xpY2UoMCwgcXVlcnlJbmRleClcbiAgICBjb25zdCBxdWVyeUFuZEZyYWdtZW50ID0gcGF0aC5zbGljZShxdWVyeUluZGV4ICsgMSlcbiAgICBjb25zdCBmcmFnbWVudEluZGV4ID0gcXVlcnlBbmRGcmFnbWVudC5pbmRleE9mKFwiI1wiKVxuICAgIGNvbnN0IHF1ZXJ5ID0gZnJhZ21lbnRJbmRleCA9PT0gLTEgPyBxdWVyeUFuZEZyYWdtZW50IDogcXVlcnlBbmRGcmFnbWVudC5zbGljZSgwLCBmcmFnbWVudEluZGV4KVxuICAgIGNvbnN0IGZyYWdtZW50ID0gZnJhZ21lbnRJbmRleCA9PT0gLTEgPyBcIlwiIDogcXVlcnlBbmRGcmFnbWVudC5zbGljZShmcmFnbWVudEluZGV4KVxuICAgIGNvbnN0IGVudHJpZXMgPSBxdWVyeS5zcGxpdChcIiZcIilcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgY29uc3Qgc2VwYXJhdG9ySW5kZXggPSBlbnRyeS5pbmRleE9mKFwiPVwiKVxuICAgICAgY29uc3QgZW5jb2RlZE5hbWUgPSBzZXBhcmF0b3JJbmRleCA9PT0gLTEgPyBlbnRyeSA6IGVudHJ5LnNsaWNlKDAsIHNlcGFyYXRvckluZGV4KVxuICAgICAgY29uc3QgZW5jb2RlZFZhbHVlID0gc2VwYXJhdG9ySW5kZXggPT09IC0xID8gXCJcIiA6IGVudHJ5LnNsaWNlKHNlcGFyYXRvckluZGV4ICsgMSlcbiAgICAgIGNvbnN0IG5hbWUgPSBkZWNvZGVkUXVlcnlDb21wb25lbnQoZW5jb2RlZE5hbWUpXG5cbiAgICAgIGlmICh0aGlzLmlzU2Vuc2l0aXZlTmFtZShuYW1lKSkge1xuICAgICAgICB0aGlzLl9hZGRTZW5zaXRpdmVTdHJpbmcoZW5jb2RlZFZhbHVlLCBuYW1lLCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgICAgIHRoaXMuX2FkZFNlbnNpdGl2ZVN0cmluZyhkZWNvZGVkUXVlcnlDb21wb25lbnQoZW5jb2RlZFZhbHVlKSwgbmFtZSwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJlZGFjdGVkRW50cmllcyA9IGVudHJpZXMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgY29uc3Qgc2VwYXJhdG9ySW5kZXggPSBlbnRyeS5pbmRleE9mKFwiPVwiKVxuICAgICAgY29uc3QgZW5jb2RlZE5hbWUgPSBzZXBhcmF0b3JJbmRleCA9PT0gLTEgPyBlbnRyeSA6IGVudHJ5LnNsaWNlKDAsIHNlcGFyYXRvckluZGV4KVxuICAgICAgY29uc3QgbmFtZSA9IGRlY29kZWRRdWVyeUNvbXBvbmVudChlbmNvZGVkTmFtZSlcblxuICAgICAgaWYgKHRoaXMuaXNTZW5zaXRpdmVOYW1lKG5hbWUpKSB7XG4gICAgICAgIHJldHVybiBgJHtlbmNvZGVkTmFtZX09JHtMT0dfUkVEQUNUSU9OX01BUktFUn1gXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLnJlZGFjdFN0cmluZyhlbnRyeSwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgIH0pXG5cbiAgICByZXR1cm4gYCR7dGhpcy5yZWRhY3RTdHJpbmcocGF0aFByZWZpeCwgc2Vuc2l0aXZlVmFsdWVzKX0/JHtyZWRhY3RlZEVudHJpZXMuam9pbihcIiZcIil9JHt0aGlzLnJlZGFjdFN0cmluZyhmcmFnbWVudCwgc2Vuc2l0aXZlVmFsdWVzKX1gXG4gIH1cblxuICAvKipcbiAgICogVHJhdmVyc2VzIHN0cnVjdHVyZWQgdmFsdWVzIHRvIGZpbmQgc2Vuc2l0aXZlLW5hbWUgZGVzY2VuZGFudHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ3VycmVudCBzdHJ1Y3R1cmVkIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gT3duaW5nIHN0cnVjdHVyZWQgbmFtZS5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gdmFsdWVzIC0gQ29sbGVjdGVkIHNlbnNpdGl2ZSB2YWx1ZXMuXG4gICAqIEBwYXJhbSB7V2Vha1NldDxvYmplY3Q+fSBzZWVuIC0gVmlzaXRlZCBvYmplY3QgcmVmZXJlbmNlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2NvbGxlY3RTZW5zaXRpdmVWYWx1ZXModmFsdWUsIGtleSwgdmFsdWVzLCBzZWVuKSB7XG4gICAgaWYgKHRoaXMuaXNTZW5zaXRpdmVOYW1lKGtleSkpIHtcbiAgICAgIHRoaXMuX2NvbGxlY3RMZWFmVmFsdWVzKHZhbHVlLCBrZXksIHZhbHVlcywgc2VlbilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm5cbiAgICBpZiAoc2Vlbi5oYXModmFsdWUpKSByZXR1cm5cblxuICAgIHNlZW4uYWRkKHZhbHVlKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHZhbHVlKSB0aGlzLl9jb2xsZWN0U2Vuc2l0aXZlVmFsdWVzKGVudHJ5LCBrZXksIHZhbHVlcywgc2VlbilcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChjb25zdCBbZW50cnlLZXksIGVudHJ5VmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlKSkge1xuICAgICAgICB0aGlzLl9jb2xsZWN0U2Vuc2l0aXZlVmFsdWVzKGVudHJ5VmFsdWUsIGVudHJ5S2V5LCB2YWx1ZXMsIHNlZW4pXG4gICAgICB9XG4gICAgfVxuXG4gICAgc2Vlbi5kZWxldGUodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHByaW1pdGl2ZSBsZWF2ZXMgYmVsb3cgYSBzZW5zaXRpdmUgc3RydWN0dXJlZCBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIGJlbG93IGEgc2Vuc2l0aXZlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBTZW5zaXRpdmUgc3RydWN0dXJlZCBuYW1lLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSB2YWx1ZXMgLSBDb2xsZWN0ZWQgc2Vuc2l0aXZlIHZhbHVlcy5cbiAgICogQHBhcmFtIHtXZWFrU2V0PG9iamVjdD59IHNlZW4gLSBWaXNpdGVkIG9iamVjdCByZWZlcmVuY2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfY29sbGVjdExlYWZWYWx1ZXModmFsdWUsIGtleSwgdmFsdWVzLCBzZWVuKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHRoaXMuX2FkZFNlbnNpdGl2ZVN0cmluZyhTdHJpbmcodmFsdWUpLCBrZXksIHZhbHVlcylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IHNlZW4uaGFzKHZhbHVlKSkgcmV0dXJuXG5cbiAgICBzZWVuLmFkZCh2YWx1ZSlcblxuICAgIGZvciAoY29uc3QgZW50cnlWYWx1ZSBvZiBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogT2JqZWN0LnZhbHVlcyh2YWx1ZSkpIHtcbiAgICAgIHRoaXMuX2NvbGxlY3RMZWFmVmFsdWVzKGVudHJ5VmFsdWUsIGtleSwgdmFsdWVzLCBzZWVuKVxuICAgIH1cblxuICAgIHNlZW4uZGVsZXRlKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBjb21tb24gZW5jb2RlZCBhbmQgY3JlZGVudGlhbC1iZWFyaW5nIHJlcHJlc2VudGF0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gU2Vuc2l0aXZlIHN0cmluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIFNlbnNpdGl2ZSBzdHJ1Y3R1cmVkIG5hbWUuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IHZhbHVlcyAtIENvbGxlY3RlZCBzZW5zaXRpdmUgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYWRkU2Vuc2l0aXZlU3RyaW5nKHZhbHVlLCBrZXksIHZhbHVlcykge1xuICAgIGlmICghdmFsdWUpIHJldHVyblxuXG4gICAgdmFsdWVzLmFkZCh2YWx1ZSlcbiAgICB2YWx1ZXMuYWRkKGVuY29kZVVSSUNvbXBvbmVudCh2YWx1ZSkpXG4gICAgdmFsdWVzLmFkZCh2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIicnXCIpKVxuICAgIHZhbHVlcy5hZGQodmFsdWUucmVwbGFjZUFsbChcIlxcXFxcIiwgXCJcXFxcXFxcXFwiKS5yZXBsYWNlQWxsKFwiJ1wiLCBcIlxcXFwnXCIpKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZEtleSA9IG5vcm1hbGl6ZWRTZW5zaXRpdmVOYW1lKGtleSlcblxuICAgIGlmIChub3JtYWxpemVkS2V5LmluY2x1ZGVzKFwiYXV0aG9yaXphdGlvblwiKSB8fCBub3JtYWxpemVkS2V5LmluY2x1ZGVzKFwiYXV0aGVudGljYXRpb25cIikpIHtcbiAgICAgIGNvbnN0IHNlcGFyYXRvckluZGV4ID0gdmFsdWUuaW5kZXhPZihcIiBcIilcblxuICAgICAgaWYgKHNlcGFyYXRvckluZGV4ICE9PSAtMSkgdGhpcy5fYWRkU2Vuc2l0aXZlU3RyaW5nKHZhbHVlLnNsaWNlKHNlcGFyYXRvckluZGV4ICsgMSkudHJpbSgpLCBcInRva2VuXCIsIHZhbHVlcylcbiAgICB9XG5cbiAgICBpZiAobm9ybWFsaXplZEtleS5lbmRzV2l0aChcImNvb2tpZVwiKSB8fCBub3JtYWxpemVkS2V5LmVuZHNXaXRoKFwiY29va2llc1wiKSkge1xuICAgICAgZm9yIChjb25zdCBjb29raWVQYXJ0IG9mIHZhbHVlLnNwbGl0KFwiO1wiKSkge1xuICAgICAgICBjb25zdCBzZXBhcmF0b3JJbmRleCA9IGNvb2tpZVBhcnQuaW5kZXhPZihcIj1cIilcblxuICAgICAgICBpZiAoc2VwYXJhdG9ySW5kZXggIT09IC0xKSB0aGlzLl9hZGRTZW5zaXRpdmVTdHJpbmcoY29va2llUGFydC5zbGljZShzZXBhcmF0b3JJbmRleCArIDEpLnRyaW0oKSwgXCJ0b2tlblwiLCB2YWx1ZXMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2R1Y2VzIGEgcmVjdXJzaXZlbHkgcmVkYWN0ZWQgc3RydWN0dXJhbCBjb3B5LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEN1cnJlbnQgc3RydWN0dXJlZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE93bmluZyBzdHJ1Y3R1cmVkIG5hbWUuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IHNlbnNpdGl2ZVZhbHVlcyAtIFJlcXVlc3QtbG9jYWwgc2Vuc2l0aXZlIHZhbHVlcy5cbiAgICogQHBhcmFtIHtXZWFrU2V0PG9iamVjdD59IHNlZW4gLSBWaXNpdGVkIG9iamVjdCByZWZlcmVuY2VzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gUmVkYWN0ZWQgdmFsdWUuXG4gICAqL1xuICBfcmVkYWN0U3RydWN0dXJlZCh2YWx1ZSwga2V5LCBzZW5zaXRpdmVWYWx1ZXMsIHNlZW4pIHtcbiAgICBpZiAodGhpcy5pc1NlbnNpdGl2ZU5hbWUoa2V5KSkgcmV0dXJuIExPR19SRURBQ1RJT05fTUFSS0VSXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRoaXMucmVkYWN0U3RyaW5nKHZhbHVlLCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiB2YWx1ZVxuICAgIGlmIChzZWVuLmhhcyh2YWx1ZSkpIHJldHVybiBcIltDaXJjdWxhcl1cIlxuXG4gICAgc2Vlbi5hZGQodmFsdWUpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IHJlZGFjdGVkQXJyYXkgPSB2YWx1ZS5tYXAoKGVudHJ5KSA9PiB0aGlzLl9yZWRhY3RTdHJ1Y3R1cmVkKGVudHJ5LCBrZXksIHNlbnNpdGl2ZVZhbHVlcywgc2VlbikpXG5cbiAgICAgIHNlZW4uZGVsZXRlKHZhbHVlKVxuICAgICAgcmV0dXJuIHJlZGFjdGVkQXJyYXlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByZWRhY3RlZE9iamVjdCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtlbnRyeUtleSwgZW50cnlWYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUpKSB7XG4gICAgICByZWRhY3RlZE9iamVjdFtlbnRyeUtleV0gPSB0aGlzLl9yZWRhY3RTdHJ1Y3R1cmVkKGVudHJ5VmFsdWUsIGVudHJ5S2V5LCBzZW5zaXRpdmVWYWx1ZXMsIHNlZW4pXG4gICAgfVxuXG4gICAgc2Vlbi5kZWxldGUodmFsdWUpXG5cbiAgICByZXR1cm4gcmVkYWN0ZWRPYmplY3RcbiAgfVxufVxuIl19