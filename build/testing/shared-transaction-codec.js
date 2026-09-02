// @ts-check

/** @typedef {{[TAG]: string, value?: string | number | boolean | EncodedBrokerValue[] | Record<string, EncodedBrokerValue>}} EncodedBrokerValue */

const TAG = "$velociousSharedTransaction"

/**
 * Encodes values crossing the test-only shared-transaction transport without
 * relying on JSON's lossy Date, bigint, non-finite-number, or undefined rules.
 * @param {ReturnType<typeof JSON.parse> | bigint | Buffer | Date | Error | undefined} value - Runtime value.
 * @returns {EncodedBrokerValue} - Tagged transport value.
 */
export function encodeBrokerValue(value) {
  if (value === undefined) return {[TAG]: "undefined"}
  if (value === null) return {[TAG]: "null"}
  if (typeof value === "bigint") return {[TAG]: "bigint", value: `${value}`}
  if (typeof value === "number") {
    if (Number.isNaN(value)) return {[TAG]: "nan"}
    if (value === Infinity) return {[TAG]: "infinity"}
    if (value === -Infinity) return {[TAG]: "negative-infinity"}
    return {[TAG]: "number", value}
  }
  if (typeof value === "string" || typeof value === "boolean") return {[TAG]: typeof value, value}
  if (value instanceof Date) return {[TAG]: "date", value: value.toISOString()}
  if (Buffer.isBuffer(value)) return {[TAG]: "buffer", value: value.toString("base64")}
  if (value instanceof Error) {
    /** @type {Record<string, ReturnType<typeof encodeBrokerValue>>} */
    const properties = {
      name: encodeBrokerValue(value.name),
      message: encodeBrokerValue(value.message),
      stack: encodeBrokerValue(value.stack)
    }

    for (const key of Object.keys(value)) {
      properties[key] = encodeBrokerValue(/** @type {ReturnType<typeof JSON.parse>} */ (value)[key])
    }
    if ("code" in value) properties.code = encodeBrokerValue(value.code)
    if (value.cause !== undefined) properties.cause = encodeBrokerValue(value.cause)

    return {[TAG]: "error", value: properties}
  }
  if (Array.isArray(value)) return {[TAG]: "array", value: value.map((entry) => encodeBrokerValue(entry))}
  if (typeof value === "object") {
    /** @type {Record<string, ReturnType<typeof encodeBrokerValue>>} */
    const entries = {}
    for (const [key, entry] of Object.entries(value)) entries[key] = encodeBrokerValue(entry)
    return {[TAG]: "object", value: entries}
  }

  throw new TypeError(`Shared transaction broker cannot encode ${typeof value}`)
}

/**
 * Decodes a tagged broker transport value.
 * @param {EncodedBrokerValue} encoded - Tagged transport value.
 * @returns {ReturnType<typeof JSON.parse> | bigint | Buffer | Date | Error | undefined} - Runtime value.
 */
export function decodeBrokerValue(encoded) {
  if (!encoded || typeof encoded !== "object" || typeof encoded[TAG] !== "string") {
    throw new TypeError("Invalid shared transaction broker value")
  }

  switch (encoded[TAG]) {
    case "undefined": return undefined
    case "null": return null
    case "bigint": return BigInt(/** @type {string} */ (encoded.value))
    case "nan": return NaN
    case "infinity": return Infinity
    case "negative-infinity": return -Infinity
    case "number":
    case "string":
    case "boolean": return encoded.value
    case "date": return new Date(/** @type {string} */ (encoded.value))
    case "buffer": return Buffer.from(/** @type {string} */ (encoded.value), "base64")
    case "array": return /** @type {EncodedBrokerValue[]} */ (encoded.value).map((entry) => decodeBrokerValue(entry))
    case "object": return decodeProperties(/** @type {Record<string, EncodedBrokerValue>} */ (encoded.value))
    case "error": return decodeError(/** @type {Record<string, EncodedBrokerValue>} */ (encoded.value))
    default: throw new TypeError(`Unknown shared transaction broker value tag: ${encoded[TAG]}`)
  }
}

/**
 * Decodes object properties.
 * @param {Record<string, EncodedBrokerValue>} properties - Encoded properties.
 * @returns {Record<string, ReturnType<typeof decodeBrokerValue>>} - Decoded properties.
 */
function decodeProperties(properties) {
  /** @type {Record<string, ReturnType<typeof decodeBrokerValue>>} */
  const decoded = {}
  for (const [key, value] of Object.entries(properties)) decoded[key] = decodeBrokerValue(value)
  return decoded
}

/**
 * Reconstructs an error from its tagged properties.
 * @param {Record<string, EncodedBrokerValue>} properties - Encoded error properties.
 * @returns {Error} - Decoded error.
 */
function decodeError(properties) {
  const decoded = decodeProperties(properties)
  const ErrorClass = decoded.name === "TypeError" ? TypeError : Error
  const error = new ErrorClass(/** @type {string} */ (decoded.message), decoded.cause === undefined ? undefined : {cause: decoded.cause})

  for (const [key, value] of Object.entries(decoded)) {
    if (key === "message" || key === "cause") continue
    /** @type {Record<string, ReturnType<typeof decodeBrokerValue>>} */ (error)[key] = value
  }

  return error
}
