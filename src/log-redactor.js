// @ts-check

import { forcedString } from "typanic"

export const LOG_REDACTION_MARKER = "[REDACTED]"

const MIN_UNSTRUCTURED_REDACTION_VALUE_LENGTH = 8

const DEFAULT_SENSITIVE_NAME_PARTS = [
  "apikey",
  "authentication",
  "authorization",
  "contentbase64",
  "credential",
  "password",
  "secret",
  "token"
]

/**
 * Normalizes case and common header/parameter separators for policy matching.
 * @param {string} name - Header or parameter name.
 * @returns {string} - Normalized policy name.
 */
function normalizedSensitiveName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/gu, "")
}

/**
 * Decodes a URL query component while leaving malformed client input inspectable.
 * @param {string} value - Encoded query component.
 * @returns {string} - Decoded component, or the original malformed value.
 */
function decodedQueryComponent(value) {
  try {
    return decodeURIComponent(value.replaceAll("+", " "))
  } catch (error) {
    if (error instanceof URIError) return value

    throw error
  }
}

/** Owns structured logging redaction and request-local sensitive values. */
export default class LogRedactor {
  /**
   * Builds a structured logging redactor.
   * @param {object} [args] - Redaction policy options.
   * @param {string[]} [args.sensitiveNames] - Application-defined sensitive names.
   */
  constructor({sensitiveNames = []} = {}) {
    if (!Array.isArray(sensitiveNames)) {
      throw new TypeError("logging.sensitiveNames must be an array")
    }

    this._extendedSensitiveNames = sensitiveNames.map((name, index) => {
      const validatedName = forcedString(name, `logging.sensitiveNames[${index}]`)
      const normalizedName = normalizedSensitiveName(validatedName)

      if (!normalizedName) throw new TypeError(`logging.sensitiveNames[${index}] must not be blank`)

      return normalizedName
    })
  }

  /**
   * Checks a structured name against the default and application policy.
   * @param {string} name - Header or parameter name.
   * @returns {boolean} - Whether values under the name are sensitive.
   */
  isSensitiveName(name) {
    const normalizedName = normalizedSensitiveName(name)

    for (const sensitivePart of DEFAULT_SENSITIVE_NAME_PARTS) {
      if (normalizedName.includes(sensitivePart)) return true
    }

    if (normalizedName === "cookie" || normalizedName.endsWith("cookie")) return true
    if (normalizedName === "cookies" || normalizedName.endsWith("cookies")) return true
    if (normalizedName === "session" || normalizedName.endsWith("session")) return true
    if (normalizedName === "sessionid" || normalizedName.endsWith("sessionid")) return true

    for (const extendedName of this._extendedSensitiveNames) {
      if (normalizedName === extendedName || normalizedName.endsWith(extendedName)) return true
    }

    return false
  }

  /**
   * Collects values found below sensitive structured names.
   * @param {ReturnType<typeof JSON.parse>} value - Structured value.
   * @param {Set<string>} [initialValues] - Values already registered for this request.
   * @returns {Set<string>} - A new set containing all registered representations.
   */
  sensitiveValues(value, initialValues = new Set()) {
    const values = new Set(initialValues)

    this._collectSensitiveValues(value, "", values, new WeakSet())

    return values
  }

  /**
   * Collects sensitive values from every structured request surface.
   * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default} request - Incoming request.
   * @param {Set<string>} [initialValues] - Values already registered for this request.
   * @returns {Set<string>} - Request-local sensitive values.
   */
  requestSensitiveValues(request, initialValues = new Set()) {
    let values = this.sensitiveValues(request.headers(), initialValues)

    values = this.sensitiveValues(request.params(), values)
    values = this.sensitiveValues(request.queryParams(), values)
    values = this.sensitiveValues(request.metadata(), values)
    this.redactPath(request.path(), values)

    return values
  }

  /**
   * Redacts a structured value without mutating it.
   * @param {ReturnType<typeof JSON.parse>} value - Value to redact.
   * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
   * @returns {ReturnType<typeof JSON.parse>} - Redacted structural copy.
   */
  redactStructured(value, sensitiveValues = new Set()) {
    const collectedValues = this.sensitiveValues(value, sensitiveValues)

    return this._redactStructured(value, "", collectedValues, new WeakSet())
  }

  /**
   * Replaces exact known sensitive values in diagnostic text.
   * @param {string} value - Diagnostic text.
   * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
   * @returns {string} - Redacted text.
   */
  redactString(value, sensitiveValues = new Set()) {
    let redacted = value
    const orderedValues = [...sensitiveValues].sort((left, right) => right.length - left.length)

    for (const sensitiveValue of orderedValues) {
      if (
        sensitiveValue.length < MIN_UNSTRUCTURED_REDACTION_VALUE_LENGTH ||
        sensitiveValue === LOG_REDACTION_MARKER
      ) continue

      redacted = redacted.replaceAll(sensitiveValue, LOG_REDACTION_MARKER)
    }

    return redacted
  }

  /**
   * Builds an Error-compatible diagnostic with redacted message and backtrace.
   * @param {Error} error - Original error.
   * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
   * @returns {Error} - Redacted error diagnostic.
   */
  redactError(error, sensitiveValues = new Set()) {
    const redactedError = new Error(this.redactString(error.message, sensitiveValues))

    redactedError.name = error.name

    if (error.stack) redactedError.stack = this.redactString(error.stack, sensitiveValues)

    const errorCode = /** @type {{code?: string}} */ (error).code

    if (errorCode) /** @type {{code?: string}} */ (redactedError).code = this.redactString(errorCode, sensitiveValues)

    return redactedError
  }

  /**
   * Redacts named query values and registered path values without parsing SQL-like text.
   * @param {string} path - Request path, optionally including a query string.
   * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
   * @returns {string} - Redacted request path.
   */
  redactPath(path, sensitiveValues = new Set()) {
    const queryIndex = path.indexOf("?")

    if (queryIndex === -1) return this.redactString(path, sensitiveValues)

    const pathPrefix = path.slice(0, queryIndex)
    const queryAndFragment = path.slice(queryIndex + 1)
    const fragmentIndex = queryAndFragment.indexOf("#")
    const query = fragmentIndex === -1 ? queryAndFragment : queryAndFragment.slice(0, fragmentIndex)
    const fragment = fragmentIndex === -1 ? "" : queryAndFragment.slice(fragmentIndex)
    const entries = query.split("&")

    for (const entry of entries) {
      const separatorIndex = entry.indexOf("=")
      const encodedName = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex)
      const encodedValue = separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1)
      const name = decodedQueryComponent(encodedName)

      if (this.isSensitiveName(name)) {
        this._addSensitiveString(encodedValue, name, sensitiveValues)
        this._addSensitiveString(decodedQueryComponent(encodedValue), name, sensitiveValues)
      }
    }

    const redactedEntries = entries.map((entry) => {
      const separatorIndex = entry.indexOf("=")
      const encodedName = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex)
      const name = decodedQueryComponent(encodedName)

      if (this.isSensitiveName(name)) {
        return `${encodedName}=${LOG_REDACTION_MARKER}`
      }

      return this.redactString(entry, sensitiveValues)
    })

    return `${this.redactString(pathPrefix, sensitiveValues)}?${redactedEntries.join("&")}${this.redactString(fragment, sensitiveValues)}`
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
      this._collectLeafValues(value, key, values, seen)
      return
    }

    if (!value || typeof value !== "object") return
    if (seen.has(value)) return

    seen.add(value)

    if (Array.isArray(value)) {
      for (const entry of value) this._collectSensitiveValues(entry, key, values, seen)
    } else {
      for (const [entryKey, entryValue] of Object.entries(value)) {
        this._collectSensitiveValues(entryValue, entryKey, values, seen)
      }
    }

    seen.delete(value)
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
      this._addSensitiveString(String(value), key, values)
      return
    }

    if (!value || typeof value !== "object" || seen.has(value)) return

    seen.add(value)

    for (const entryValue of Array.isArray(value) ? value : Object.values(value)) {
      this._collectLeafValues(entryValue, key, values, seen)
    }

    seen.delete(value)
  }

  /**
   * Registers common encoded and credential-bearing representations.
   * @param {string} value - Sensitive string.
   * @param {string} key - Sensitive structured name.
   * @param {Set<string>} values - Collected sensitive values.
   * @returns {void} - No return value.
   */
  _addSensitiveString(value, key, values) {
    if (!value) return

    values.add(value)
    values.add(encodeURIComponent(value))
    values.add(value.replaceAll("'", "''"))
    values.add(value.replaceAll("\\", "\\\\").replaceAll("'", "\\'"))

    const normalizedKey = normalizedSensitiveName(key)

    if (normalizedKey.includes("authorization") || normalizedKey.includes("authentication")) {
      const separatorIndex = value.indexOf(" ")

      if (separatorIndex !== -1) this._addSensitiveString(value.slice(separatorIndex + 1).trim(), "token", values)
    }

    if (normalizedKey.endsWith("cookie") || normalizedKey.endsWith("cookies")) {
      for (const cookiePart of value.split(";")) {
        const separatorIndex = cookiePart.indexOf("=")

        if (separatorIndex !== -1) this._addSensitiveString(cookiePart.slice(separatorIndex + 1).trim(), "token", values)
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
    if (this.isSensitiveName(key)) return LOG_REDACTION_MARKER
    if (typeof value === "string") return this.redactString(value, sensitiveValues)
    if (!value || typeof value !== "object") return value
    if (seen.has(value)) return "[Circular]"

    seen.add(value)

    if (Array.isArray(value)) {
      const redactedArray = value.map((entry) => this._redactStructured(entry, key, sensitiveValues, seen))

      seen.delete(value)
      return redactedArray
    }

    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const redactedObject = {}

    for (const [entryKey, entryValue] of Object.entries(value)) {
      redactedObject[entryKey] = this._redactStructured(entryValue, entryKey, sensitiveValues, seen)
    }

    seen.delete(value)

    return redactedObject
  }
}
