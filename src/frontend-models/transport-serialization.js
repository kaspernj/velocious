// @ts-check

const TYPE_KEY = "__velocious_type"
const TYPE_DATE = "date"
const TYPE_UNDEFINED = "undefined"

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

  return keys.length === 1 && value[TYPE_KEY] === TYPE_UNDEFINED
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {boolean} - Whether value is encoded date marker.
 */
function isDateMarker(value) {
  if (!isPlainObject(value)) return false

  const keys = Object.keys(value)

  return keys.length === 2 && value[TYPE_KEY] === TYPE_DATE && typeof value.value === "string"
}

/**
 * @param {unknown} value - Value to serialize.
 * @returns {unknown} - Serialized value with transport markers.
 */
export function serializeFrontendModelTransportValue(value) {
  if (value === undefined) {
    return {[TYPE_KEY]: TYPE_UNDEFINED}
  }

  if (value instanceof Date) {
    return {
      [TYPE_KEY]: TYPE_DATE,
      value: value.toISOString()
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeFrontendModelTransportValue(entry))
  }

  if (isPlainObject(value)) {
    /** @type {Record<string, unknown>} */
    const serialized = {}

    for (const [key, nestedValue] of Object.entries(value)) {
      serialized[key] = serializeFrontendModelTransportValue(nestedValue)
    }

    return serialized
  }

  return value
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

  if (Array.isArray(value)) {
    return value.map((entry) => deserializeFrontendModelTransportValue(entry))
  }

  if (isPlainObject(value)) {
    /** @type {Record<string, unknown>} */
    const deserialized = {}

    for (const [key, nestedValue] of Object.entries(value)) {
      deserialized[key] = deserializeFrontendModelTransportValue(nestedValue)
    }

    return deserialized
  }

  return value
}
