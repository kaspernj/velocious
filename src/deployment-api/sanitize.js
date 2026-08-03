// @ts-check

const MAX_STRING_LENGTH = 4000
const MAX_DEPTH = 20
const REDACTED = "[redacted]"

/**
 * Replaces every occurrence of each configured secret in a string so tokens
 * never leak into persisted run state, audit payloads, or API responses.
 * @param {string} value - Raw string.
 * @param {string[]} secrets - Secret values to redact.
 * @returns {string} - Redacted string.
 */
function redactString(value, secrets) {
  let result = value

  for (const secret of secrets) {
    if (secret.length > 0) result = result.split(secret).join(REDACTED)
  }

  if (result.length > MAX_STRING_LENGTH) {
    result = `${result.slice(0, MAX_STRING_LENGTH)}…`
  }

  return result
}

/**
 * Converts an integration-owned value (adapter report, live status, audit
 * payload fragment) into a bounded JSON-safe structure: plain objects, arrays,
 * strings, finite numbers, booleans, and null survive; everything else
 * (functions, class instances, undefined) is dropped. String values and object
 * keys are redacted and capped in length; deterministic suffixes preserve every
 * value when redacted keys collide.
 * @param {?} value - Raw value from the integration.
 * @param {string[]} secrets - Secret values to redact.
 * @param {number} [depth] - Current recursion depth.
 * @returns {?} - JSON-safe redacted value, or undefined when the value cannot be represented.
 */
export function sanitizeAdapterValue(value, secrets, depth = 0) {
  if (value === null) return null
  if (depth > MAX_DEPTH) return undefined

  const valueType = typeof value

  if (valueType === "string") return redactString(value, secrets)
  if (valueType === "number") return Number.isFinite(value) ? value : null
  if (valueType === "boolean") return value

  if (Array.isArray(value)) {
    /** @type {Array<?>} */
    const result = []

    for (const entry of value) {
      const sanitized = sanitizeAdapterValue(entry, secrets, depth + 1)

      if (sanitized !== undefined) result.push(sanitized)
    }

    return result
  }

  if (valueType === "object") {
    const prototype = Object.getPrototypeOf(value)

    if (prototype !== Object.prototype && prototype !== null) return undefined

    /** @type {Record<string, ?>} */
    const result = {}

    for (const [key, entry] of Object.entries(value)) {
      const sanitized = sanitizeAdapterValue(entry, secrets, depth + 1)

      if (sanitized === undefined) continue

      const redactedKey = redactString(key, secrets)
      let availableKey = redactedKey
      let collisionNumber = 2

      while (Object.hasOwn(result, availableKey)) {
        availableKey = `${redactedKey}#${collisionNumber}`
        collisionNumber++
      }

      Object.defineProperty(result, availableKey, {
        configurable: true,
        enumerable: true,
        value: sanitized,
        writable: true
      })
    }

    return result
  }

  return undefined
}

/**
 * Builds the sanitized failure payload persisted for a failed run. The message
 * is redacted; an integration-provided plain-object `error.recovery` (e.g.
 * Rampway reporting restoration of the previous release) is included after
 * sanitization.
 * @param {?} error - Thrown error from the adapter.
 * @param {string[]} secrets - Secret values to redact.
 * @returns {{message: string, recovery: (? | undefined)}} - Sanitized failure payload.
 */
export function sanitizeErrorPayload(error, secrets) {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const rawRecovery = error instanceof Error ? /** @type {Record<string, ?>} */ (error).recovery : undefined
  const recovery = sanitizeAdapterValue(rawRecovery, secrets)

  return {message: redactString(rawMessage, secrets), recovery}
}
