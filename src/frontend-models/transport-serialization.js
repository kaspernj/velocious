// @ts-check

const TYPE_KEY = "__velocious_type"
const TYPE_DATE = "date"
const TYPE_UNDEFINED = "undefined"
const TYPE_BIGINT = "bigint"
const TYPE_NUMBER = "number"
const NUMBER_NAN = "NaN"
const NUMBER_POSITIVE_INFINITY = "Infinity"
const NUMBER_NEGATIVE_INFINITY = "-Infinity"

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
