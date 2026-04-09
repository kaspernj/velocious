// @ts-check

import {resolveFrontendModelClass} from "./model-registry.js"

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
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, any>} - Whether value is a plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {boolean} - Whether value is encoded undefined marker.
 */
function isUndefinedMarker(value) {
  if (!isPlainObject(value)) return false

  const keys = Object.keys(value)

  return keys.length === 1 && Object.prototype.hasOwnProperty.call(value, TYPE_KEY) && value[TYPE_KEY] === TYPE_UNDEFINED
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {boolean} - Whether value is encoded date marker.
 */
function isDateMarker(value) {
  if (!isPlainObject(value)) return false

  const keys = Object.keys(value)

  return (
    keys.length === 2
    && Object.prototype.hasOwnProperty.call(value, TYPE_KEY)
    && Object.prototype.hasOwnProperty.call(value, "value")
    && value[TYPE_KEY] === TYPE_DATE
    && typeof value.value === "string"
  )
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {boolean} - Whether value is encoded bigint marker.
 */
function isBigIntMarker(value) {
  if (!isPlainObject(value)) return false

  const keys = Object.keys(value)

  return (
    keys.length === 2
    && Object.prototype.hasOwnProperty.call(value, TYPE_KEY)
    && Object.prototype.hasOwnProperty.call(value, "value")
    && value[TYPE_KEY] === TYPE_BIGINT
    && typeof value.value === "string"
    && /^-?\d+$/.test(value.value)
  )
}

/**
 * @param {unknown} value - Candidate value.
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
 * @param {unknown} value - Candidate value.
 * @returns {value is {__velocious_type: "frontend_model", attributes: Record<string, any>, modelName: string, preloadedRelationships?: Record<string, any>}} - Whether value is encoded frontend-model marker.
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
 * @param {unknown} value - Candidate value.
 * @returns {value is {attributes: () => Record<string, any>, constructor: {getModelName?: () => string, name?: string}, getModelClass: () => {getRelationshipsMap: () => Record<string, any>}, getRelationshipByName: (relationshipName: string) => {getPreloaded: () => boolean, loaded: () => any}}} - Whether value looks like a backend model instance.
 */
function isBackendModelInstance(value) {
  if (!value || typeof value !== "object") return false

  const candidate = /** @type {Record<string, any>} */ (value)

  return (
    typeof candidate.attributes === "function"
    && typeof candidate.getModelClass === "function"
    && typeof candidate.getRelationshipByName === "function"
  )
}

/**
 * @param {Record<string, any>} value - Attributes hash.
 * @returns {Record<string, any>} - Cloned attributes hash.
 */
function cloneFrontendModelAttributes(value) {
  return /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(serializeFrontendModelTransportValue(value)))
}

/**
 * @param {unknown} value - Value to serialize.
 * @param {WeakSet<object>} seenModels - Models already visited in the current recursion path.
 * @returns {unknown} - Serialized value with transport markers.
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

    /** @type {Record<string, unknown>} */
    const serializedModel = {
      [TYPE_KEY]: TYPE_FRONTEND_MODEL,
      attributes: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValueInternal(modelAttributes, seenModels)),
      modelName
    }

    if (seenModels.has(value)) {
      return serializedModel
    }

    seenModels.add(value)

    /** @type {Record<string, unknown>} */
    const preloadedRelationships = /** @type {Record<string, unknown>} */ (Object.create(null))
    const relationshipsMap = value.getModelClass().getRelationshipsMap()

    for (const relationshipName of Object.keys(relationshipsMap)) {
      const relationship = value.getRelationshipByName(relationshipName)

      if (!relationship.getPreloaded()) continue

      const loadedRelationship = relationship.loaded()

      preloadedRelationships[relationshipName] = serializeFrontendModelTransportValueInternal(
        loadedRelationship == undefined ? null : loadedRelationship,
        seenModels
      )
    }

    seenModels.delete(value)

    if (Object.keys(preloadedRelationships).length > 0) {
      serializedModel.preloadedRelationships = preloadedRelationships
    }

    return serializedModel
  }

  if (isPlainObject(value)) {
    /** @type {Record<string, unknown>} */
    const serialized = /** @type {Record<string, unknown>} */ (Object.create(null))

    for (const [key, nestedValue] of Object.entries(value)) {
      serialized[key] = serializeFrontendModelTransportValueInternal(nestedValue, seenModels)
    }

    return serialized
  }

  return value
}

/**
 * @param {{attributes: Record<string, any>, modelName: string, preloadedRelationships?: Record<string, any>}} marker - Encoded frontend-model marker.
 * @returns {unknown} - Hydrated frontend model or plain object fallback.
 */
function deserializeFrontendModelMarker(marker) {
  const attributes = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(marker.attributes))
  const preloadedRelationships = isPlainObject(marker.preloadedRelationships)
    ? /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(marker.preloadedRelationships))
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

  const model = new modelClass(attributes)

  model._selectedAttributes = new Set(Object.keys(attributes))

  for (const [relationshipName, relationshipValue] of Object.entries(preloadedRelationships)) {
    model.getRelationshipByName(relationshipName).setLoaded(relationshipValue)
  }

  model.setIsNewRecord(false)
  model._persistedAttributes = cloneFrontendModelAttributes(model.attributes())

  return model
}

/**
 * @param {unknown} value - Value to serialize.
 * @returns {unknown} - Serialized value with transport markers.
 */
export function serializeFrontendModelTransportValue(value) {
  return serializeFrontendModelTransportValueInternal(value, new WeakSet())
}

/**
 * @param {unknown} value - Value to deserialize.
 * @returns {unknown} - Deserialized value with transport markers restored.
 */
export function deserializeFrontendModelTransportValue(value) {
  if (isUndefinedMarker(value)) {
    return undefined
  }

  if (isDateMarker(value)) {
    const dateValue = /** @type {{value: string}} */ (value).value

    return new Date(dateValue)
  }

  if (isBigIntMarker(value)) {
    const bigintValue = /** @type {{value: string}} */ (value).value

    return BigInt(bigintValue)
  }

  if (isNonFiniteNumberMarker(value)) {
    const numberValue = /** @type {{value: string}} */ (value).value

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
    /** @type {Record<string, unknown>} */
    const deserialized = /** @type {Record<string, unknown>} */ (Object.create(null))

    for (const [key, nestedValue] of Object.entries(value)) {
      deserialized[key] = deserializeFrontendModelTransportValue(nestedValue)
    }

    return deserialized
  }

  return value
}
