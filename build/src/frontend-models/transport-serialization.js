// @ts-check
import { resolveFrontendModelClass } from "./model-registry.js";
import isPlainObject from "../utils/plain-object.js";
import { formatDateInTimeZone, validateTimeZone } from "../time-zone.js";
/**
 * Frontend model transport serialization options.
 * @typedef {object} FrontendModelTransportSerializationOptions
 * @property {string | undefined} [timeZone] - IANA timezone used when serializing Date instants.
 */
/**
 * Normalized frontend model transport serialization options.
 * @typedef {object} NormalizedFrontendModelTransportSerializationOptions
 * @property {string | undefined} timeZone - Validated IANA timezone used when serializing Date instants.
 */
const TYPE_KEY = "__velocious_type";
const TYPE_DATE = "date";
const TYPE_UNDEFINED = "undefined";
const TYPE_BIGINT = "bigint";
const TYPE_NUMBER = "number";
const TYPE_FRONTEND_MODEL = "frontend_model";
const NUMBER_NAN = "NaN";
const NUMBER_POSITIVE_INFINITY = "Infinity";
const NUMBER_NEGATIVE_INFINITY = "-Infinity";
const PRELOADED_RELATIONSHIPS_KEY = "__preloadedRelationships";
/**
 * Assign a key to a plain object without triggering the `__proto__` setter.
 * Uses `Object.defineProperty` so that keys like `__proto__` are stored as
 * own data properties instead of mutating the object's prototype chain. This
 * lets callers receive a regular `{}` object (with `Object.prototype` and a
 * normal `constructor.name`) while still preventing prototype pollution.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} target - Target object.
 * @param {string} key - Property key.
 * @param {ReturnType<typeof JSON.parse>} value - Property value.
 * @returns {void}
 */
export function assignSafeProperty(target, key, value) {
    Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true
    });
}
/**
 * Runs is undefined marker.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {boolean} - Whether value is encoded undefined marker.
 */
function isUndefinedMarker(value) {
    if (!isPlainObject(value))
        return false;
    const keys = Object.keys(value);
    return keys.length === 1 && Object.prototype.hasOwnProperty.call(value, TYPE_KEY) && value[TYPE_KEY] === TYPE_UNDEFINED;
}
/**
 * Check whether a value is a typed marker object with a string `value` field.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate marker.
 * @param {string} markerType - Expected marker type value.
 * @param {(stringValue: string) => boolean} valueMatches - Additional string value predicate.
 * @returns {boolean} - Whether value matches the marker shape.
 */
function isStringValueMarker(value, markerType, valueMatches) {
    if (!isPlainObject(value))
        return false;
    const keys = Object.keys(value);
    return (keys.length === 2
        && Object.prototype.hasOwnProperty.call(value, TYPE_KEY)
        && Object.prototype.hasOwnProperty.call(value, "value")
        && value[TYPE_KEY] === markerType
        && typeof value.value === "string"
        && valueMatches(value.value));
}
/**
 * Runs is date marker.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {boolean} - Whether value is encoded date marker.
 */
function isDateMarker(value) {
    return isStringValueMarker(value, TYPE_DATE, () => true);
}
/**
 * Runs is big int marker.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {boolean} - Whether value is encoded bigint marker.
 */
function isBigIntMarker(value) {
    return isStringValueMarker(value, TYPE_BIGINT, (stringValue) => /^-?\d+$/.test(stringValue));
}
/**
 * Runs is non finite number marker.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {boolean} - Whether value is encoded non-finite number marker.
 */
function isNonFiniteNumberMarker(value) {
    if (!isPlainObject(value))
        return false;
    const keys = Object.keys(value);
    const markerValue = value.value;
    return (keys.length === 2
        && Object.prototype.hasOwnProperty.call(value, TYPE_KEY)
        && Object.prototype.hasOwnProperty.call(value, "value")
        && value[TYPE_KEY] === TYPE_NUMBER
        && (markerValue === NUMBER_NAN || markerValue === NUMBER_POSITIVE_INFINITY || markerValue === NUMBER_NEGATIVE_INFINITY));
}
/**
 * Runs is frontend model marker.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is {__velocious_type: "frontend_model", attributes: Record<string, ReturnType<typeof JSON.parse>>, modelName: string, preloadedRelationships?: Record<string, ReturnType<typeof JSON.parse>>}} - Whether value is encoded frontend-model marker.
 */
function isFrontendModelMarker(value) {
    if (!isPlainObject(value))
        return false;
    const modelName = value.modelName;
    const attributes = value.attributes;
    const preloadedRelationships = value.preloadedRelationships;
    return (Object.prototype.hasOwnProperty.call(value, TYPE_KEY)
        && value[TYPE_KEY] === TYPE_FRONTEND_MODEL
        && typeof modelName === "string"
        && modelName.length > 0
        && isPlainObject(attributes)
        && (preloadedRelationships === undefined || isPlainObject(preloadedRelationships)));
}
/**
 * Runs the isBackendModelInstance helper.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is {attributes: () => Record<string, ReturnType<typeof JSON.parse>>, constructor: {getModelName?: () => string, name?: string}, getModelClass: () => typeof import("../database/record/index.js").default, getRelationshipByName: (relationshipName: string) => {getPreloaded: () => boolean, loaded: () => ReturnType<typeof JSON.parse>}}} - Whether value looks like a backend model instance.
 */
export function isBackendModelInstance(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value);
    return (typeof candidate.attributes === "function"
        && typeof candidate.getModelClass === "function"
        && typeof candidate.getRelationshipByName === "function");
}
/**
 * Runs serialize frontend model transport value internal.
 * @param {ReturnType<typeof JSON.parse>} value - Value to serialize.
 * @param {WeakSet<object>} seenModels - Models already visited in the current recursion path.
 * @param {NormalizedFrontendModelTransportSerializationOptions} options - Serialization options.
 * @returns {ReturnType<typeof JSON.parse>} - Serialized value with transport markers.
 */
function serializeFrontendModelTransportValueInternal(value, seenModels, options) {
    if (value === undefined) {
        return { [TYPE_KEY]: TYPE_UNDEFINED };
    }
    if (value instanceof Date) {
        return {
            [TYPE_KEY]: TYPE_DATE,
            value: options.timeZone ? formatDateInTimeZone(value, options.timeZone) : value.toISOString()
        };
    }
    if (typeof value === "bigint") {
        return {
            [TYPE_KEY]: TYPE_BIGINT,
            value: value.toString()
        };
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        const markerValue = Number.isNaN(value)
            ? NUMBER_NAN
            : (value > 0 ? NUMBER_POSITIVE_INFINITY : NUMBER_NEGATIVE_INFINITY);
        return {
            [TYPE_KEY]: TYPE_NUMBER,
            value: markerValue
        };
    }
    if (Array.isArray(value)) {
        return value.map((entry) => serializeFrontendModelTransportValueInternal(entry, seenModels, options));
    }
    if (isBackendModelInstance(value)) {
        const modelAttributes = value.attributes();
        const modelName = value.getModelClass().getModelName();
        /**
         * Serialized model.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const serializedModel = {
            [TYPE_KEY]: TYPE_FRONTEND_MODEL,
            attributes: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValueInternal(modelAttributes, seenModels, options)),
            modelName
        };
        if (seenModels.has(value)) {
            return serializedModel;
        }
        seenModels.add(value);
        /**
         * Preloaded relationships.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const preloadedRelationships = {};
        const relationshipsMap = value.getModelClass().getRelationshipsMap();
        for (const relationshipName of Object.keys(relationshipsMap)) {
            const relationship = value.getRelationshipByName(relationshipName);
            if (!relationship.getPreloaded())
                continue;
            const loadedRelationship = relationship.loaded();
            assignSafeProperty(preloadedRelationships, relationshipName, serializeFrontendModelTransportValueInternal(loadedRelationship == undefined ? null : loadedRelationship, seenModels, options));
        }
        seenModels.delete(value);
        if (Object.keys(preloadedRelationships).length > 0) {
            serializedModel.preloadedRelationships = preloadedRelationships;
        }
        return serializedModel;
    }
    if (isPlainObject(value)) {
        /**
         * Serialized.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const serialized = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            assignSafeProperty(serialized, key, serializeFrontendModelTransportValueInternal(nestedValue, seenModels, options));
        }
        return serialized;
    }
    return value;
}
/**
 * Normalizes serializer options once per top-level serialization.
 * @param {FrontendModelTransportSerializationOptions} options - Serialization options.
 * @returns {NormalizedFrontendModelTransportSerializationOptions} - Normalized options.
 */
function normalizeFrontendModelTransportSerializationOptions(options) {
    return {
        timeZone: options.timeZone === undefined
            ? undefined
            : validateTimeZone(options.timeZone, "transport serialization timeZone")
    };
}
/**
 * Runs deserialize frontend model marker.
 * @param {{attributes: Record<string, ReturnType<typeof JSON.parse>>, modelName: string, preloadedRelationships?: Record<string, ReturnType<typeof JSON.parse>>}} marker - Encoded frontend-model marker.
 * @returns {ReturnType<typeof JSON.parse>} - Hydrated frontend model or plain object fallback.
 */
function deserializeFrontendModelMarker(marker) {
    const attributes = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(marker.attributes));
    const preloadedRelationships = isPlainObject(marker.preloadedRelationships)
        ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(marker.preloadedRelationships))
        : {};
    const modelClass = resolveFrontendModelClass(marker.modelName);
    if (!modelClass || typeof modelClass.instantiateFromResponse !== "function") {
        if (Object.keys(preloadedRelationships).length < 1) {
            return attributes;
        }
        return {
            ...attributes,
            [PRELOADED_RELATIONSHIPS_KEY]: preloadedRelationships
        };
    }
    // Route hydration through `instantiateFromResponse` so
    // `__abilities` / `__queryData` / `__associationCounts` /
    // `__preloadedRelationships` baked into the marker's attributes blob (e.g.
    // by `resource.serialize` in custom-command auto-serialization) get
    // extracted and applied. Legacy markers that used a separate top-level
    // `preloadedRelationships` field merge them under the standard key first
    // so `modelDataFromResponse` picks them up.
    const responseAttributes = Object.keys(preloadedRelationships).length > 0
        ? {
            ...attributes,
            [PRELOADED_RELATIONSHIPS_KEY]: preloadedRelationships
        }
        : attributes;
    return modelClass.instantiateFromResponse(responseAttributes);
}
/**
 * Runs the serializeFrontendModelTransportValue helper.
 * @param {ReturnType<typeof JSON.parse>} value - Value to serialize.
 * @param {FrontendModelTransportSerializationOptions} [options] - Serialization options.
 * @returns {ReturnType<typeof JSON.parse>} - Serialized value with transport markers.
 */
export function serializeFrontendModelTransportValue(value, options = {}) {
    return serializeFrontendModelTransportValueInternal(value, new WeakSet(), normalizeFrontendModelTransportSerializationOptions(options));
}
/**
 * Runs the deserializeFrontendModelTransportValue helper.
 * @param {ReturnType<typeof JSON.parse>} value - Value to deserialize.
 * @returns {ReturnType<typeof JSON.parse>} - Deserialized value with transport markers restored.
 */
export function deserializeFrontendModelTransportValue(value) {
    if (isUndefinedMarker(value)) {
        return undefined;
    }
    if (isDateMarker(value)) {
        const dateValue = /** @type {{value: string}} */ (value).value;
        return new Date(dateValue);
    }
    if (isBigIntMarker(value)) {
        const bigintValue = /** @type {{value: string}} */ (value).value;
        return BigInt(bigintValue);
    }
    if (isNonFiniteNumberMarker(value)) {
        const numberValue = /** @type {{value: string}} */ (value).value;
        if (numberValue === NUMBER_NAN)
            return Number.NaN;
        if (numberValue === NUMBER_POSITIVE_INFINITY)
            return Number.POSITIVE_INFINITY;
        return Number.NEGATIVE_INFINITY;
    }
    if (isFrontendModelMarker(value)) {
        return deserializeFrontendModelMarker(value);
    }
    if (Array.isArray(value)) {
        return value.map((entry) => deserializeFrontendModelTransportValue(entry));
    }
    if (isPlainObject(value)) {
        /**
         * Deserialized.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const deserialized = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            assignSafeProperty(deserialized, key, deserializeFrontendModelTransportValue(nestedValue));
        }
        return deserialized;
    }
    return value;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMseUJBQXlCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUNwRCxPQUFPLEVBQUMsb0JBQW9CLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUV0RTs7OztHQUlHO0FBQ0g7Ozs7R0FJRztBQUNILE1BQU0sUUFBUSxHQUFHLGtCQUFrQixDQUFBO0FBQ25DLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQTtBQUN4QixNQUFNLGNBQWMsR0FBRyxXQUFXLENBQUE7QUFDbEMsTUFBTSxXQUFXLEdBQUcsUUFBUSxDQUFBO0FBQzVCLE1BQU0sV0FBVyxHQUFHLFFBQVEsQ0FBQTtBQUM1QixNQUFNLG1CQUFtQixHQUFHLGdCQUFnQixDQUFBO0FBQzVDLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQTtBQUN4QixNQUFNLHdCQUF3QixHQUFHLFVBQVUsQ0FBQTtBQUMzQyxNQUFNLHdCQUF3QixHQUFHLFdBQVcsQ0FBQTtBQUM1QyxNQUFNLDJCQUEyQixHQUFHLDBCQUEwQixDQUFBO0FBRTlEOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFNLFVBQVUsa0JBQWtCLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRSxLQUFLO0lBQ25ELE1BQU0sQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRTtRQUNqQyxLQUFLO1FBQ0wsUUFBUSxFQUFFLElBQUk7UUFDZCxVQUFVLEVBQUUsSUFBSTtRQUNoQixZQUFZLEVBQUUsSUFBSTtLQUNuQixDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsaUJBQWlCLENB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QUUsc0NBQXNDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQTtRQUM1RixDQUFDO1FBRUQsT0FBTyxZQUFZLENBQUE7SUFDckIsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3Jlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3N9IGZyb20gXCIuL21vZGVsLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IHtmb3JtYXREYXRlSW5UaW1lWm9uZSwgdmFsaWRhdGVUaW1lWm9uZX0gZnJvbSBcIi4uL3RpbWUtem9uZS5qc1wiXG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc1xuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IFt0aW1lWm9uZV0gLSBJQU5BIHRpbWV6b25lIHVzZWQgd2hlbiBzZXJpYWxpemluZyBEYXRlIGluc3RhbnRzLlxuICovXG4vKipcbiAqIE5vcm1hbGl6ZWQgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IE5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsVHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB0aW1lWm9uZSAtIFZhbGlkYXRlZCBJQU5BIHRpbWV6b25lIHVzZWQgd2hlbiBzZXJpYWxpemluZyBEYXRlIGluc3RhbnRzLlxuICovXG5jb25zdCBUWVBFX0tFWSA9IFwiX192ZWxvY2lvdXNfdHlwZVwiXG5jb25zdCBUWVBFX0RBVEUgPSBcImRhdGVcIlxuY29uc3QgVFlQRV9VTkRFRklORUQgPSBcInVuZGVmaW5lZFwiXG5jb25zdCBUWVBFX0JJR0lOVCA9IFwiYmlnaW50XCJcbmNvbnN0IFRZUEVfTlVNQkVSID0gXCJudW1iZXJcIlxuY29uc3QgVFlQRV9GUk9OVEVORF9NT0RFTCA9IFwiZnJvbnRlbmRfbW9kZWxcIlxuY29uc3QgTlVNQkVSX05BTiA9IFwiTmFOXCJcbmNvbnN0IE5VTUJFUl9QT1NJVElWRV9JTkZJTklUWSA9IFwiSW5maW5pdHlcIlxuY29uc3QgTlVNQkVSX05FR0FUSVZFX0lORklOSVRZID0gXCItSW5maW5pdHlcIlxuY29uc3QgUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZID0gXCJfX3ByZWxvYWRlZFJlbGF0aW9uc2hpcHNcIlxuXG4vKipcbiAqIEFzc2lnbiBhIGtleSB0byBhIHBsYWluIG9iamVjdCB3aXRob3V0IHRyaWdnZXJpbmcgdGhlIGBfX3Byb3RvX19gIHNldHRlci5cbiAqIFVzZXMgYE9iamVjdC5kZWZpbmVQcm9wZXJ0eWAgc28gdGhhdCBrZXlzIGxpa2UgYF9fcHJvdG9fX2AgYXJlIHN0b3JlZCBhc1xuICogb3duIGRhdGEgcHJvcGVydGllcyBpbnN0ZWFkIG9mIG11dGF0aW5nIHRoZSBvYmplY3QncyBwcm90b3R5cGUgY2hhaW4uIFRoaXNcbiAqIGxldHMgY2FsbGVycyByZWNlaXZlIGEgcmVndWxhciBge31gIG9iamVjdCAod2l0aCBgT2JqZWN0LnByb3RvdHlwZWAgYW5kIGFcbiAqIG5vcm1hbCBgY29uc3RydWN0b3IubmFtZWApIHdoaWxlIHN0aWxsIHByZXZlbnRpbmcgcHJvdG90eXBlIHBvbGx1dGlvbi5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB0YXJnZXQgLSBUYXJnZXQgb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIFByb3BlcnR5IGtleS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUHJvcGVydHkgdmFsdWUuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2lnblNhZmVQcm9wZXJ0eSh0YXJnZXQsIGtleSwgdmFsdWUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwga2V5LCB7XG4gICAgdmFsdWUsXG4gICAgd3JpdGFibGU6IHRydWUsXG4gICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICBjb25maWd1cmFibGU6IHRydWVcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGlzIHVuZGVmaW5lZCBtYXJrZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWUgaXMgZW5jb2RlZCB1bmRlZmluZWQgbWFya2VyLlxuICovXG5mdW5jdGlvbiBpc1VuZGVmaW5lZE1hcmtlcih2YWx1ZSkge1xuICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXModmFsdWUpXG5cbiAgcmV0dXJuIGtleXMubGVuZ3RoID09PSAxICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwgVFlQRV9LRVkpICYmIHZhbHVlW1RZUEVfS0VZXSA9PT0gVFlQRV9VTkRFRklORURcbn1cblxuLyoqXG4gKiBDaGVjayB3aGV0aGVyIGEgdmFsdWUgaXMgYSB0eXBlZCBtYXJrZXIgb2JqZWN0IHdpdGggYSBzdHJpbmcgYHZhbHVlYCBmaWVsZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIG1hcmtlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtYXJrZXJUeXBlIC0gRXhwZWN0ZWQgbWFya2VyIHR5cGUgdmFsdWUuXG4gKiBAcGFyYW0geyhzdHJpbmdWYWx1ZTogc3RyaW5nKSA9PiBib29sZWFufSB2YWx1ZU1hdGNoZXMgLSBBZGRpdGlvbmFsIHN0cmluZyB2YWx1ZSBwcmVkaWNhdGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlIG1hdGNoZXMgdGhlIG1hcmtlciBzaGFwZS5cbiAqL1xuZnVuY3Rpb24gaXNTdHJpbmdWYWx1ZU1hcmtlcih2YWx1ZSwgbWFya2VyVHlwZSwgdmFsdWVNYXRjaGVzKSB7XG4gIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh2YWx1ZSlcblxuICByZXR1cm4gKFxuICAgIGtleXMubGVuZ3RoID09PSAyXG4gICAgJiYgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHZhbHVlLCBUWVBFX0tFWSlcbiAgICAmJiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodmFsdWUsIFwidmFsdWVcIilcbiAgICAmJiB2YWx1ZVtUWVBFX0tFWV0gPT09IG1hcmtlclR5cGVcbiAgICAmJiB0eXBlb2YgdmFsdWUudmFsdWUgPT09IFwic3RyaW5nXCJcbiAgICAmJiB2YWx1ZU1hdGNoZXModmFsdWUudmFsdWUpXG4gIClcbn1cblxuLyoqXG4gKiBSdW5zIGlzIGRhdGUgbWFya2VyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlIGlzIGVuY29kZWQgZGF0ZSBtYXJrZXIuXG4gKi9cbmZ1bmN0aW9uIGlzRGF0ZU1hcmtlcih2YWx1ZSkge1xuICByZXR1cm4gaXNTdHJpbmdWYWx1ZU1hcmtlcih2YWx1ZSwgVFlQRV9EQVRFLCAoKSA9PiB0cnVlKVxufVxuXG4vKipcbiAqIFJ1bnMgaXMgYmlnIGludCBtYXJrZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWUgaXMgZW5jb2RlZCBiaWdpbnQgbWFya2VyLlxuICovXG5mdW5jdGlvbiBpc0JpZ0ludE1hcmtlcih2YWx1ZSkge1xuICByZXR1cm4gaXNTdHJpbmdWYWx1ZU1hcmtlcih2YWx1ZSwgVFlQRV9CSUdJTlQsIChzdHJpbmdWYWx1ZSkgPT4gL14tP1xcZCskLy50ZXN0KHN0cmluZ1ZhbHVlKSlcbn1cblxuLyoqXG4gKiBSdW5zIGlzIG5vbiBmaW5pdGUgbnVtYmVyIG1hcmtlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBpcyBlbmNvZGVkIG5vbi1maW5pdGUgbnVtYmVyIG1hcmtlci5cbiAqL1xuZnVuY3Rpb24gaXNOb25GaW5pdGVOdW1iZXJNYXJrZXIodmFsdWUpIHtcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHZhbHVlKVxuICBjb25zdCBtYXJrZXJWYWx1ZSA9IHZhbHVlLnZhbHVlXG5cbiAgcmV0dXJuIChcbiAgICBrZXlzLmxlbmd0aCA9PT0gMlxuICAgICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwgVFlQRV9LRVkpXG4gICAgJiYgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHZhbHVlLCBcInZhbHVlXCIpXG4gICAgJiYgdmFsdWVbVFlQRV9LRVldID09PSBUWVBFX05VTUJFUlxuICAgICYmIChtYXJrZXJWYWx1ZSA9PT0gTlVNQkVSX05BTiB8fCBtYXJrZXJWYWx1ZSA9PT0gTlVNQkVSX1BPU0lUSVZFX0lORklOSVRZIHx8IG1hcmtlclZhbHVlID09PSBOVU1CRVJfTkVHQVRJVkVfSU5GSU5JVFkpXG4gIClcbn1cblxuLyoqXG4gKiBSdW5zIGlzIGZyb250ZW5kIG1vZGVsIG1hcmtlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHtfX3ZlbG9jaW91c190eXBlOiBcImZyb250ZW5kX21vZGVsXCIsIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgbW9kZWxOYW1lOiBzdHJpbmcsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAtIFdoZXRoZXIgdmFsdWUgaXMgZW5jb2RlZCBmcm9udGVuZC1tb2RlbCBtYXJrZXIuXG4gKi9cbmZ1bmN0aW9uIGlzRnJvbnRlbmRNb2RlbE1hcmtlcih2YWx1ZSkge1xuICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBtb2RlbE5hbWUgPSB2YWx1ZS5tb2RlbE5hbWVcbiAgY29uc3QgYXR0cmlidXRlcyA9IHZhbHVlLmF0dHJpYnV0ZXNcbiAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IHZhbHVlLnByZWxvYWRlZFJlbGF0aW9uc2hpcHNcblxuICByZXR1cm4gKFxuICAgIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwgVFlQRV9LRVkpXG4gICAgJiYgdmFsdWVbVFlQRV9LRVldID09PSBUWVBFX0ZST05URU5EX01PREVMXG4gICAgJiYgdHlwZW9mIG1vZGVsTmFtZSA9PT0gXCJzdHJpbmdcIlxuICAgICYmIG1vZGVsTmFtZS5sZW5ndGggPiAwXG4gICAgJiYgaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzKVxuICAgICYmIChwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID09PSB1bmRlZmluZWQgfHwgaXNQbGFpbk9iamVjdChwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSlcbiAgKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGlzQmFja2VuZE1vZGVsSW5zdGFuY2UgaGVscGVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMge2F0dHJpYnV0ZXM6ICgpID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgY29uc3RydWN0b3I6IHtnZXRNb2RlbE5hbWU/OiAoKSA9PiBzdHJpbmcsIG5hbWU/OiBzdHJpbmd9LCBnZXRNb2RlbENsYXNzOiAoKSA9PiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIGdldFJlbGF0aW9uc2hpcEJ5TmFtZTogKHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZykgPT4ge2dldFByZWxvYWRlZDogKCkgPT4gYm9vbGVhbiwgbG9hZGVkOiAoKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19fSAtIFdoZXRoZXIgdmFsdWUgbG9va3MgbGlrZSBhIGJhY2tlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0JhY2tlbmRNb2RlbEluc3RhbmNlKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBjYW5kaWRhdGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVxuXG4gIHJldHVybiAoXG4gICAgdHlwZW9mIGNhbmRpZGF0ZS5hdHRyaWJ1dGVzID09PSBcImZ1bmN0aW9uXCJcbiAgICAmJiB0eXBlb2YgY2FuZGlkYXRlLmdldE1vZGVsQ2xhc3MgPT09IFwiZnVuY3Rpb25cIlxuICAgICYmIHR5cGVvZiBjYW5kaWRhdGUuZ2V0UmVsYXRpb25zaGlwQnlOYW1lID09PSBcImZ1bmN0aW9uXCJcbiAgKVxufVxuXG4vKipcbiAqIFJ1bnMgc2VyaWFsaXplIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB2YWx1ZSBpbnRlcm5hbC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gc2VyaWFsaXplLlxuICogQHBhcmFtIHtXZWFrU2V0PG9iamVjdD59IHNlZW5Nb2RlbHMgLSBNb2RlbHMgYWxyZWFkeSB2aXNpdGVkIGluIHRoZSBjdXJyZW50IHJlY3Vyc2lvbiBwYXRoLlxuICogQHBhcmFtIHtOb3JtYWxpemVkRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSBvcHRpb25zIC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFNlcmlhbGl6ZWQgdmFsdWUgd2l0aCB0cmFuc3BvcnQgbWFya2Vycy5cbiAqL1xuZnVuY3Rpb24gc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlSW50ZXJuYWwodmFsdWUsIHNlZW5Nb2RlbHMsIG9wdGlvbnMpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4ge1tUWVBFX0tFWV06IFRZUEVfVU5ERUZJTkVEfVxuICB9XG5cbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiB7XG4gICAgICBbVFlQRV9LRVldOiBUWVBFX0RBVEUsXG4gICAgICB2YWx1ZTogb3B0aW9ucy50aW1lWm9uZSA/IGZvcm1hdERhdGVJblRpbWVab25lKHZhbHVlLCBvcHRpb25zLnRpbWVab25lKSA6IHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImJpZ2ludFwiKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFtUWVBFX0tFWV06IFRZUEVfQklHSU5ULFxuICAgICAgdmFsdWU6IHZhbHVlLnRvU3RyaW5nKClcbiAgICB9XG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmICFOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSB7XG4gICAgY29uc3QgbWFya2VyVmFsdWUgPSBOdW1iZXIuaXNOYU4odmFsdWUpXG4gICAgICA/IE5VTUJFUl9OQU5cbiAgICAgIDogKHZhbHVlID4gMCA/IE5VTUJFUl9QT1NJVElWRV9JTkZJTklUWSA6IE5VTUJFUl9ORUdBVElWRV9JTkZJTklUWSlcblxuICAgIHJldHVybiB7XG4gICAgICBbVFlQRV9LRVldOiBUWVBFX05VTUJFUixcbiAgICAgIHZhbHVlOiBtYXJrZXJWYWx1ZVxuICAgIH1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS5tYXAoKGVudHJ5KSA9PiBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVJbnRlcm5hbChlbnRyeSwgc2Vlbk1vZGVscywgb3B0aW9ucykpXG4gIH1cblxuICBpZiAoaXNCYWNrZW5kTW9kZWxJbnN0YW5jZSh2YWx1ZSkpIHtcbiAgICBjb25zdCBtb2RlbEF0dHJpYnV0ZXMgPSB2YWx1ZS5hdHRyaWJ1dGVzKClcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB2YWx1ZS5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcblxuICAgIC8qKlxuICAgICAqIFNlcmlhbGl6ZWQgbW9kZWwuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBzZXJpYWxpemVkTW9kZWwgPSB7XG4gICAgICBbVFlQRV9LRVldOiBUWVBFX0ZST05URU5EX01PREVMLFxuICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVJbnRlcm5hbChtb2RlbEF0dHJpYnV0ZXMsIHNlZW5Nb2RlbHMsIG9wdGlvbnMpKSxcbiAgICAgIG1vZGVsTmFtZVxuICAgIH1cblxuICAgIGlmIChzZWVuTW9kZWxzLmhhcyh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBzZXJpYWxpemVkTW9kZWxcbiAgICB9XG5cbiAgICBzZWVuTW9kZWxzLmFkZCh2YWx1ZSlcblxuICAgIC8qKlxuICAgICAqIFByZWxvYWRlZCByZWxhdGlvbnNoaXBzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IHt9XG4gICAgY29uc3QgcmVsYXRpb25zaGlwc01hcCA9IHZhbHVlLmdldE1vZGVsQ2xhc3MoKS5nZXRSZWxhdGlvbnNoaXBzTWFwKClcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhyZWxhdGlvbnNoaXBzTWFwKSkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdmFsdWUuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmICghcmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBsb2FkZWRSZWxhdGlvbnNoaXAgPSByZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgYXNzaWduU2FmZVByb3BlcnR5KHByZWxvYWRlZFJlbGF0aW9uc2hpcHMsIHJlbGF0aW9uc2hpcE5hbWUsIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZUludGVybmFsKFxuICAgICAgICBsb2FkZWRSZWxhdGlvbnNoaXAgPT0gdW5kZWZpbmVkID8gbnVsbCA6IGxvYWRlZFJlbGF0aW9uc2hpcCxcbiAgICAgICAgc2Vlbk1vZGVscyxcbiAgICAgICAgb3B0aW9uc1xuICAgICAgKSlcbiAgICB9XG5cbiAgICBzZWVuTW9kZWxzLmRlbGV0ZSh2YWx1ZSlcblxuICAgIGlmIChPYmplY3Qua2V5cyhwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKS5sZW5ndGggPiAwKSB7XG4gICAgICBzZXJpYWxpemVkTW9kZWwucHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICB9XG5cbiAgICByZXR1cm4gc2VyaWFsaXplZE1vZGVsXG4gIH1cblxuICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAvKipcbiAgICAgKiBTZXJpYWxpemVkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtrZXksIG5lc3RlZFZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh2YWx1ZSkpIHtcbiAgICAgIGFzc2lnblNhZmVQcm9wZXJ0eShzZXJpYWxpemVkLCBrZXksIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZUludGVybmFsKG5lc3RlZFZhbHVlLCBzZWVuTW9kZWxzLCBvcHRpb25zKSlcbiAgICB9XG5cbiAgICByZXR1cm4gc2VyaWFsaXplZFxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBzZXJpYWxpemVyIG9wdGlvbnMgb25jZSBwZXIgdG9wLWxldmVsIHNlcmlhbGl6YXRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc30gb3B0aW9ucyAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHtOb3JtYWxpemVkRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIE5vcm1hbGl6ZWQgb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKG9wdGlvbnMpIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogb3B0aW9ucy50aW1lWm9uZSA9PT0gdW5kZWZpbmVkXG4gICAgICA/IHVuZGVmaW5lZFxuICAgICAgOiB2YWxpZGF0ZVRpbWVab25lKG9wdGlvbnMudGltZVpvbmUsIFwidHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gdGltZVpvbmVcIilcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZGVzZXJpYWxpemUgZnJvbnRlbmQgbW9kZWwgbWFya2VyLlxuICogQHBhcmFtIHt7YXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtb2RlbE5hbWU6IHN0cmluZywgcHJlbG9hZGVkUmVsYXRpb25zaGlwcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IG1hcmtlciAtIEVuY29kZWQgZnJvbnRlbmQtbW9kZWwgbWFya2VyLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEh5ZHJhdGVkIGZyb250ZW5kIG1vZGVsIG9yIHBsYWluIG9iamVjdCBmYWxsYmFjay5cbiAqL1xuZnVuY3Rpb24gZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsTWFya2VyKG1hcmtlcikge1xuICBjb25zdCBhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShtYXJrZXIuYXR0cmlidXRlcykpXG4gIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBpc1BsYWluT2JqZWN0KG1hcmtlci5wcmVsb2FkZWRSZWxhdGlvbnNoaXBzKVxuICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShtYXJrZXIucHJlbG9hZGVkUmVsYXRpb25zaGlwcykpXG4gICAgOiB7fVxuICBjb25zdCBtb2RlbENsYXNzID0gcmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzcyhtYXJrZXIubW9kZWxOYW1lKVxuXG4gIGlmICghbW9kZWxDbGFzcyB8fCB0eXBlb2YgbW9kZWxDbGFzcy5pbnN0YW50aWF0ZUZyb21SZXNwb25zZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgaWYgKE9iamVjdC5rZXlzKHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpLmxlbmd0aCA8IDEpIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmF0dHJpYnV0ZXMsXG4gICAgICBbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXTogcHJlbG9hZGVkUmVsYXRpb25zaGlwc1xuICAgIH1cbiAgfVxuXG4gIC8vIFJvdXRlIGh5ZHJhdGlvbiB0aHJvdWdoIGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgc29cbiAgLy8gYF9fYWJpbGl0aWVzYCAvIGBfX3F1ZXJ5RGF0YWAgLyBgX19hc3NvY2lhdGlvbkNvdW50c2AgL1xuICAvLyBgX19wcmVsb2FkZWRSZWxhdGlvbnNoaXBzYCBiYWtlZCBpbnRvIHRoZSBtYXJrZXIncyBhdHRyaWJ1dGVzIGJsb2IgKGUuZy5cbiAgLy8gYnkgYHJlc291cmNlLnNlcmlhbGl6ZWAgaW4gY3VzdG9tLWNvbW1hbmQgYXV0by1zZXJpYWxpemF0aW9uKSBnZXRcbiAgLy8gZXh0cmFjdGVkIGFuZCBhcHBsaWVkLiBMZWdhY3kgbWFya2VycyB0aGF0IHVzZWQgYSBzZXBhcmF0ZSB0b3AtbGV2ZWxcbiAgLy8gYHByZWxvYWRlZFJlbGF0aW9uc2hpcHNgIGZpZWxkIG1lcmdlIHRoZW0gdW5kZXIgdGhlIHN0YW5kYXJkIGtleSBmaXJzdFxuICAvLyBzbyBgbW9kZWxEYXRhRnJvbVJlc3BvbnNlYCBwaWNrcyB0aGVtIHVwLlxuICBjb25zdCByZXNwb25zZUF0dHJpYnV0ZXMgPSBPYmplY3Qua2V5cyhwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKS5sZW5ndGggPiAwXG4gICAgPyB7XG4gICAgICAuLi5hdHRyaWJ1dGVzLFxuICAgICAgW1BSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWV06IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICB9XG4gICAgOiBhdHRyaWJ1dGVzXG5cbiAgcmV0dXJuIG1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVzcG9uc2VBdHRyaWJ1dGVzKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSBoZWxwZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHNlcmlhbGl6ZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gU2VyaWFsaXplZCB2YWx1ZSB3aXRoIHRyYW5zcG9ydCBtYXJrZXJzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHZhbHVlLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZUludGVybmFsKFxuICAgIHZhbHVlLFxuICAgIG5ldyBXZWFrU2V0KCksXG4gICAgbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKG9wdGlvbnMpXG4gIClcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSBoZWxwZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIGRlc2VyaWFsaXplLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIERlc2VyaWFsaXplZCB2YWx1ZSB3aXRoIHRyYW5zcG9ydCBtYXJrZXJzIHJlc3RvcmVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodmFsdWUpIHtcbiAgaWYgKGlzVW5kZWZpbmVkTWFya2VyKHZhbHVlKSkge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIGlmIChpc0RhdGVNYXJrZXIodmFsdWUpKSB7XG4gICAgY29uc3QgZGF0ZVZhbHVlID0gLyoqIEB0eXBlIHt7dmFsdWU6IHN0cmluZ319ICovICh2YWx1ZSkudmFsdWVcblxuICAgIHJldHVybiBuZXcgRGF0ZShkYXRlVmFsdWUpXG4gIH1cblxuICBpZiAoaXNCaWdJbnRNYXJrZXIodmFsdWUpKSB7XG4gICAgY29uc3QgYmlnaW50VmFsdWUgPSAvKiogQHR5cGUge3t2YWx1ZTogc3RyaW5nfX0gKi8gKHZhbHVlKS52YWx1ZVxuXG4gICAgcmV0dXJuIEJpZ0ludChiaWdpbnRWYWx1ZSlcbiAgfVxuXG4gIGlmIChpc05vbkZpbml0ZU51bWJlck1hcmtlcih2YWx1ZSkpIHtcbiAgICBjb25zdCBudW1iZXJWYWx1ZSA9IC8qKiBAdHlwZSB7e3ZhbHVlOiBzdHJpbmd9fSAqLyAodmFsdWUpLnZhbHVlXG5cbiAgICBpZiAobnVtYmVyVmFsdWUgPT09IE5VTUJFUl9OQU4pIHJldHVybiBOdW1iZXIuTmFOXG4gICAgaWYgKG51bWJlclZhbHVlID09PSBOVU1CRVJfUE9TSVRJVkVfSU5GSU5JVFkpIHJldHVybiBOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFlcblxuICAgIHJldHVybiBOdW1iZXIuTkVHQVRJVkVfSU5GSU5JVFlcbiAgfVxuXG4gIGlmIChpc0Zyb250ZW5kTW9kZWxNYXJrZXIodmFsdWUpKSB7XG4gICAgcmV0dXJuIGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbE1hcmtlcih2YWx1ZSlcbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS5tYXAoKGVudHJ5KSA9PiBkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShlbnRyeSkpXG4gIH1cblxuICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAvKipcbiAgICAgKiBEZXNlcmlhbGl6ZWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBkZXNlcmlhbGl6ZWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBba2V5LCBuZXN0ZWRWYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUpKSB7XG4gICAgICBhc3NpZ25TYWZlUHJvcGVydHkoZGVzZXJpYWxpemVkLCBrZXksIGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKG5lc3RlZFZhbHVlKSlcbiAgICB9XG5cbiAgICByZXR1cm4gZGVzZXJpYWxpemVkXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cbiJdfQ==