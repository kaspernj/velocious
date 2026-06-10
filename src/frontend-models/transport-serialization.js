// @ts-check

import {resolveFrontendModelClass} from "./model-registry.js"
import isPlainObject from "../utils/plain-object.js"

const TYPE_KEY = "__velocious_type"
const TYPE_DATE = "date"
const TYPE_UNDEFINED = "undefined"
const TYPE_BIGINT = "bigint"
const TYPE_NUMBER = "number"
const TYPE_FRONTEND_MODEL = "frontend_model"
const NUMBER_NAN = "NaN"
const NUMBER_POSITIVE_INFINITY = "Infinity"
const NUMBER_NEGATIVE_INFINITY = "-Infinity"
const PRELOADED_RELATIONSHIPS_KEY = "__preloadedRelationships"

/**
 * Assign a key to a plain object without triggering the `__proto__` setter.
 * Uses `Object.defineProperty` so that keys like `__proto__` are stored as
 * own data properties instead of mutating the object's prototype chain. This
 * lets callers receive a regular `{}` object (with `Object.prototype` and a
 * normal `constructor.name`) while still preventing prototype pollution.
 * @param {Record<string, ?>} target - Target object.
 * @param {string} key - Property key.
 * @param {?} value - Property value.
 * @returns {void}
 */
export function assignSafeProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  })
}

/**
 * Runs is undefined marker.
 * @param {?} value - Candidate value.
 * @returns {boolean} - Whether value is encoded undefined marker.
 */
function isUndefinedMarker(value) {
  if (!isPlainObject(value)) return false

  const keys = Object.keys(value)

  return keys.length === 1 && Object.prototype.hasOwnProperty.call(value, TYPE_KEY) && value[TYPE_KEY] === TYPE_UNDEFINED
}

/**
 * Check whether a value is a typed marker object with a string `value` field.
 * @param {?} value - Candidate marker.
 * @param {string} markerType - Expected marker type value.
 * @param {(stringValue: string) => boolean} valueMatches - Additional string value predicate.
 * @returns {boolean} - Whether value matches the marker shape.
 */
function isStringValueMarker(value, markerType, valueMatches) {
  if (!isPlainObject(value)) return false

  const keys = Object.keys(value)

  return (
    keys.length === 2
    && Object.prototype.hasOwnProperty.call(value, TYPE_KEY)
    && Object.prototype.hasOwnProperty.call(value, "value")
    && value[TYPE_KEY] === markerType
    && typeof value.value === "string"
    && valueMatches(value.value)
  )
}

/**
 * Runs is date marker.
 * @param {?} value - Candidate value.
 * @returns {boolean} - Whether value is encoded date marker.
 */
function isDateMarker(value) {
  return isStringValueMarker(value, TYPE_DATE, () => true)
}

/**
 * Runs is big int marker.
 * @param {?} value - Candidate value.
 * @returns {boolean} - Whether value is encoded bigint marker.
 */
function isBigIntMarker(value) {
  return isStringValueMarker(value, TYPE_BIGINT, (stringValue) => /^-?\d+$/.test(stringValue))
}

/**
 * Runs is non finite number marker.
 * @param {?} value - Candidate value.
 * @returns {boolean} - Whether value is encoded non-finite number marker.
 */
function isNonFiniteNumberMarker(value) {
  if (!isPlainObject(value)) return false

  const keys = Object.keys(value)
  const markerValue = value.value

  return (
    keys.length === 2
    && Object.prototype.hasOwnProperty.call(value, TYPE_KEY)
    && Object.prototype.hasOwnProperty.call(value, "value")
    && value[TYPE_KEY] === TYPE_NUMBER
    && (markerValue === NUMBER_NAN || markerValue === NUMBER_POSITIVE_INFINITY || markerValue === NUMBER_NEGATIVE_INFINITY)
  )
}

/**
 * Runs is frontend model marker.
 * @param {?} value - Candidate value.
 * @returns {value is {__velocious_type: "frontend_model", attributes: Record<string, ?>, modelName: string, preloadedRelationships?: Record<string, ?>}} - Whether value is encoded frontend-model marker.
 */
function isFrontendModelMarker(value) {
  if (!isPlainObject(value)) return false

  const modelName = value.modelName
  const attributes = value.attributes
  const preloadedRelationships = value.preloadedRelationships

  return (
    Object.prototype.hasOwnProperty.call(value, TYPE_KEY)
    && value[TYPE_KEY] === TYPE_FRONTEND_MODEL
    && typeof modelName === "string"
    && modelName.length > 0
    && isPlainObject(attributes)
    && (preloadedRelationships === undefined || isPlainObject(preloadedRelationships))
  )
}

/**
 * Documents this API.
 * @param {?} value - Candidate value.
 * @returns {value is {attributes: () => Record<string, ?>, constructor: {getModelName?: () => string, name?: string}, getModelClass: () => {getRelationshipsMap: () => Record<string, ?>}, getRelationshipByName: (relationshipName: string) => {getPreloaded: () => boolean, loaded: () => ?}}} - Whether value looks like a backend model instance.
 */
export function isBackendModelInstance(value) {
  if (!value || typeof value !== "object") return false

  const candidate = /**
 * Documents this API.
 * @type {Record<string, ?>} */ (value)

  return (
    typeof candidate.attributes === "function"
    && typeof candidate.getModelClass === "function"
    && typeof candidate.getRelationshipByName === "function"
  )
}

/**
 * Runs serialize frontend model transport value internal.
 * @param {?} value - Value to serialize.
 * @param {WeakSet<object>} seenModels - Models already visited in the current recursion path.
 * @returns {?} - Serialized value with transport markers.
 */
function serializeFrontendModelTransportValueInternal(value, seenModels) {
  if (value === undefined) {
    return {[TYPE_KEY]: TYPE_UNDEFINED}
  }

  if (value instanceof Date) {
    return {
      [TYPE_KEY]: TYPE_DATE,
      value: value.toISOString()
    }
  }

  if (typeof value === "bigint") {
    return {
      [TYPE_KEY]: TYPE_BIGINT,
      value: value.toString()
    }
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    const markerValue = Number.isNaN(value)
      ? NUMBER_NAN
      : (value > 0 ? NUMBER_POSITIVE_INFINITY : NUMBER_NEGATIVE_INFINITY)

    return {
      [TYPE_KEY]: TYPE_NUMBER,
      value: markerValue
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeFrontendModelTransportValueInternal(entry, seenModels))
  }

  if (isBackendModelInstance(value)) {
    const modelAttributes = value.attributes()
    const modelClass = value.constructor
    const modelName = typeof modelClass.getModelName === "function" ? modelClass.getModelName() : modelClass.name

    /**
 * Serialized model.
 * @type {Record<string, ?>} */
    const serializedModel = {
      [TYPE_KEY]: TYPE_FRONTEND_MODEL,
      attributes: /**
 * Documents this API.
 * @type {Record<string, ?>} */ (serializeFrontendModelTransportValueInternal(modelAttributes, seenModels)),
      modelName
    }

    if (seenModels.has(value)) {
      return serializedModel
    }

    seenModels.add(value)

    /**
 * Preloaded relationships.
 * @type {Record<string, ?>} */
    const preloadedRelationships = {}
    const relationshipsMap = value.getModelClass().getRelationshipsMap()

    for (const relationshipName of Object.keys(relationshipsMap)) {
      const relationship = value.getRelationshipByName(relationshipName)

      if (!relationship.getPreloaded()) continue

      const loadedRelationship = relationship.loaded()

      assignSafeProperty(preloadedRelationships, relationshipName, serializeFrontendModelTransportValueInternal(
        loadedRelationship == undefined ? null : loadedRelationship,
        seenModels
      ))
    }

    seenModels.delete(value)

    if (Object.keys(preloadedRelationships).length > 0) {
      serializedModel.preloadedRelationships = preloadedRelationships
    }

    return serializedModel
  }

  if (isPlainObject(value)) {
    /**
 * Serialized.
 * @type {Record<string, ?>} */
    const serialized = {}

    for (const [key, nestedValue] of Object.entries(value)) {
      assignSafeProperty(serialized, key, serializeFrontendModelTransportValueInternal(nestedValue, seenModels))
    }

    return serialized
  }

  return value
}

/**
 * Runs deserialize frontend model marker.
 * @param {{attributes: Record<string, ?>, modelName: string, preloadedRelationships?: Record<string, ?>}} marker - Encoded frontend-model marker.
 * @returns {?} - Hydrated frontend model or plain object fallback.
 */
function deserializeFrontendModelMarker(marker) {
  const attributes = /**
 * Documents this API.
 * @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(marker.attributes))
  const preloadedRelationships = isPlainObject(marker.preloadedRelationships)
    ? /**
 * Documents this API.
 * @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(marker.preloadedRelationships))
    : {}
  const modelClass = resolveFrontendModelClass(marker.modelName)

  if (!modelClass || typeof modelClass.instantiateFromResponse !== "function") {
    if (Object.keys(preloadedRelationships).length < 1) {
      return attributes
    }

    return {
      ...attributes,
      [PRELOADED_RELATIONSHIPS_KEY]: preloadedRelationships
    }
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
    : attributes

  return modelClass.instantiateFromResponse(responseAttributes)
}

/**
 * Documents this API.
 * @param {?} value - Value to serialize.
 * @returns {?} - Serialized value with transport markers.
 */
export function serializeFrontendModelTransportValue(value) {
  return serializeFrontendModelTransportValueInternal(value, new WeakSet())
}

/**
 * Documents this API.
 * @param {?} value - Value to deserialize.
 * @returns {?} - Deserialized value with transport markers restored.
 */
export function deserializeFrontendModelTransportValue(value) {
  if (isUndefinedMarker(value)) {
    return undefined
  }

  if (isDateMarker(value)) {
    const dateValue = /**
 * Documents this API.
 * @type {{value: string}} */ (value).value

    return new Date(dateValue)
  }

  if (isBigIntMarker(value)) {
    const bigintValue = /**
 * Documents this API.
 * @type {{value: string}} */ (value).value

    return BigInt(bigintValue)
  }

  if (isNonFiniteNumberMarker(value)) {
    const numberValue = /**
 * Documents this API.
 * @type {{value: string}} */ (value).value

    if (numberValue === NUMBER_NAN) return Number.NaN
    if (numberValue === NUMBER_POSITIVE_INFINITY) return Number.POSITIVE_INFINITY

    return Number.NEGATIVE_INFINITY
  }

  if (isFrontendModelMarker(value)) {
    return deserializeFrontendModelMarker(value)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => deserializeFrontendModelTransportValue(entry))
  }

  if (isPlainObject(value)) {
    /**
 * Deserialized.
 * @type {Record<string, ?>} */
    const deserialized = {}

    for (const [key, nestedValue] of Object.entries(value)) {
      assignSafeProperty(deserialized, key, deserializeFrontendModelTransportValue(nestedValue))
    }

    return deserialized
  }

  return value
}
