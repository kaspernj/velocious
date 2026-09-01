// @ts-check

import VelociousError from "./velocious-error.js"
import isPlainObject from "./utils/plain-object.js"

/** @typedef {Readonly<Record<string, string | number | boolean>>} RemoteRequestContext */

const UNSAFE_CONTEXT_KEYS = new Set(["__proto__", "constructor", "prototype"])

/**
 * Captures and validates immutable scalar context for one remote operation.
 * @param {ReturnType<typeof JSON.parse> | undefined} value - Configured context value.
 * @param {object} [args] - Validation options.
 * @param {string} [args.label] - Context label used in errors.
 * @param {Iterable<string>} [args.reservedKeys] - Framework-owned keys unavailable to context.
 * @returns {RemoteRequestContext} Frozen context snapshot.
 */
export function captureRemoteRequestContext(value, {label = "Remote request context", reservedKeys = []} = {}) {
  if (value === undefined || value === null) return Object.freeze({})

  if (!isPlainObject(value)) {
    throw remoteRequestContextError(`${label} must be a plain object of scalar values`)
  }

  const reservedKeySet = new Set(reservedKeys)
  /** @type {Record<string, string | number | boolean>} */
  const context = {}

  for (const key of Object.keys(value).sort()) {
    if (!key.trim()) throw remoteRequestContextError(`${label} keys must be non-blank strings`)
    if (UNSAFE_CONTEXT_KEYS.has(key) || reservedKeySet.has(key)) {
      throw remoteRequestContextError(`${label} key ${JSON.stringify(key)} is reserved by the framework`)
    }

    const contextValue = value[key]

    if (!remoteRequestContextScalar(contextValue)) {
      throw remoteRequestContextError(`${label} key ${JSON.stringify(key)} must contain a string, finite number, or boolean scalar`)
    }

    context[key] = contextValue
  }

  return Object.freeze(context)
}

/**
 * Merges captured context into framework request params without ambiguity.
 * @template {Record<string, ReturnType<typeof JSON.parse>>} TParams
 * @param {object} args - Merge arguments.
 * @param {RemoteRequestContext} args.context - Captured context.
 * @param {string} [args.label] - Context label used in errors.
 * @param {TParams} args.params - Framework-owned request params.
 * @returns {TParams & RemoteRequestContext} Merged params, or the original params when unscoped.
 */
export function mergeRemoteRequestContext({context, label = "Remote request context", params}) {
  const contextKeys = Object.keys(context)

  if (contextKeys.length === 0) return params

  for (const key of contextKeys) {
    if (Object.hasOwn(params, key)) {
      throw remoteRequestContextError(`${label} key ${JSON.stringify(key)} is reserved by the request payload`)
    }
  }

  return {...params, ...context}
}

/**
 * Returns a stable identity for an immutable captured context.
 * @param {RemoteRequestContext} context - Captured context.
 * @returns {string} Stable serialized key.
 */
export function remoteRequestContextKey(context) {
  return JSON.stringify(context)
}

/**
 * Checks whether a value is a supported request-context scalar.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate scalar.
 * @returns {value is string | number | boolean} Whether the value is supported.
 */
function remoteRequestContextScalar(value) {
  if (["string", "boolean"].includes(typeof value)) return true

  return typeof value === "number" && Number.isFinite(value)
}

/**
 * Builds a client-safe request-context validation error.
 * @param {string} message - Safe validation message.
 * @returns {VelociousError} Validation error.
 */
function remoteRequestContextError(message) {
  return VelociousError.safe(message, {code: "remote-request-context-invalid", errorType: "validation_error"})
}
