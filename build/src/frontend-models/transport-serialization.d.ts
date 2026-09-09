export type FrontendModelTransportSerializationOptions = {
    /**
     * - IANA timezone used when serializing Date instants.
     */
    timeZone?: string | undefined;
};
export type NormalizedFrontendModelTransportSerializationOptions = {
    /**
     * - Validated IANA timezone used when serializing Date instants.
     */
    timeZone: string | undefined;
};
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
export declare function assignSafeProperty(target: Record<string, ReturnType<typeof JSON.parse>>, key: string, value: ReturnType<typeof JSON.parse>): void;
/**
 * Runs the isBackendModelInstance helper.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is {attributes: () => Record<string, ReturnType<typeof JSON.parse>>, constructor: {getModelName?: () => string, name?: string}, getModelClass: () => typeof import("../database/record/index.js").default, getRelationshipByName: (relationshipName: string) => {getPreloaded: () => boolean, loaded: () => ReturnType<typeof JSON.parse>}}} - Whether value looks like a backend model instance.
 */
export declare function isBackendModelInstance(value: ReturnType<typeof JSON.parse>): value is {
    attributes: () => Record<string, ReturnType<typeof JSON.parse>>;
    constructor: {
        getModelName?: () => string;
        name?: string;
    };
    getModelClass: () => typeof import("../database/record/index.js").default;
    getRelationshipByName: (relationshipName: string) => {
        getPreloaded: () => boolean;
        loaded: () => ReturnType<typeof JSON.parse>;
    };
};
/**
 * Runs the serializeFrontendModelTransportValue helper.
 * @param {ReturnType<typeof JSON.parse>} value - Value to serialize.
 * @param {FrontendModelTransportSerializationOptions} [options] - Serialization options.
 * @returns {ReturnType<typeof JSON.parse>} - Serialized value with transport markers.
 */
export declare function serializeFrontendModelTransportValue(value: ReturnType<typeof JSON.parse>, options?: FrontendModelTransportSerializationOptions): ReturnType<typeof JSON.parse>;
/**
 * Runs the deserializeFrontendModelTransportValue helper.
 * @param {ReturnType<typeof JSON.parse>} value - Value to deserialize.
 * @returns {ReturnType<typeof JSON.parse>} - Deserialized value with transport markers restored.
 */
export declare function deserializeFrontendModelTransportValue(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
//# sourceMappingURL=transport-serialization.d.ts.map