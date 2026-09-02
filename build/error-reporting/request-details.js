// @ts-check

import UploadedFile from "../http-server/client/uploaded-file/uploaded-file.js"
import LogRedactor, { LOG_REDACTION_MARKER } from "../log-redactor.js"

const REQUEST_DETAILS_BODY_MAX_SERIALIZED_LENGTH = 12000
const REQUEST_DETAILS_STRING_MAX_LENGTH = 1000
const REQUEST_DETAILS_ARRAY_MAX_ITEMS = 50
const defaultLogRedactor = new LogRedactor()

/**
 * Extracts request metadata without retaining the request object.
 * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default | undefined} request - Request object, when present.
 * @param {object} [args] - Redaction context.
 * @param {LogRedactor} [args.redactor] - Application logging redactor.
 * @param {Set<string>} [args.sensitiveValues] - Request-local sensitive values.
 * @returns {import("../configuration-types.js").ErrorRequestDetails | null} - Request metadata.
 */
export function requestDetails(request, {redactor = defaultLogRedactor, sensitiveValues = new Set()} = {}) {
  if (!request) return null

  let details

  try {
    details = {
      httpMethod: request.httpMethod(),
      path: redactor.redactPath(request.path(), sensitiveValues)
    }
  } catch {
    return null
  }

  const body = requestBodySnapshot(request, {redactor, sensitiveValues})

  if (body !== undefined) {
    return {...details, body}
  }

  return details
}

/**
 * Snapshots parsed request params for error reports.
 * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} request - Request object.
 * @param {{redactor: LogRedactor, sensitiveValues: Set<string>}} args - Redaction context.
 * @returns {ReturnType<typeof JSON.parse> | undefined} - Sanitized body snapshot.
 */
function requestBodySnapshot(request, {redactor, sensitiveValues}) {
  if (typeof request.params !== "function") return undefined

  try {
    return requestDetailsBodySnapshot(request.params(), {redactor, sensitiveValues})
  } catch (error) {
    return {
      __unavailable: true,
      error: redactor.redactString(error instanceof Error ? error.message : String(error), sensitiveValues)
    }
  }
}

/**
 * Builds a bounded, redacted body snapshot for error reports.
 * @param {ReturnType<typeof JSON.parse>} body - Parsed request body.
 * @param {{redactor: LogRedactor, sensitiveValues: Set<string>}} args - Redaction context.
 * @returns {ReturnType<typeof JSON.parse>} - Sanitized body snapshot.
 */
function requestDetailsBodySnapshot(body, {redactor, sensitiveValues}) {
  const originalLength = serializedLength(body)
  const collectedValues = redactor.sensitiveValues(body, sensitiveValues)
  const sanitized = sanitizeRequestDetailsValue(body, {redactor, sensitiveValues: collectedValues})
  const sanitizedLength = serializedLength(sanitized)

  if (originalLength <= REQUEST_DETAILS_BODY_MAX_SERIALIZED_LENGTH && sanitizedLength <= REQUEST_DETAILS_BODY_MAX_SERIALIZED_LENGTH) {
    return sanitized
  }

  const compactFrontendModelBody = compactFrontendModelRequestBody(sanitized, originalLength)

  if (serializedLength(compactFrontendModelBody) <= REQUEST_DETAILS_BODY_MAX_SERIALIZED_LENGTH) {
    return compactFrontendModelBody
  }

  return compactRequestDetailsBody(sanitized, originalLength)
}

/**
 * Sanitizes a value recursively for request details.
 * @param {ReturnType<typeof JSON.parse>} value - Value to sanitize.
 * @param {{key?: string, redactor: LogRedactor, seen?: WeakSet<object>, sensitiveValues: Set<string>}} args - Redaction traversal state.
 * @returns {ReturnType<typeof JSON.parse>} - Sanitized value.
 */
function sanitizeRequestDetailsValue(value, {key = "", redactor, seen = new WeakSet(), sensitiveValues}) {
  if (redactor.isSensitiveName(key)) return LOG_REDACTION_MARKER
  if (primitiveRequestDetailsValue(value)) return value
  if (bufferValue(value)) return bufferRequestDetailsSummary(value)
  if (value instanceof UploadedFile) return uploadedFileRequestDetailsSummary(value)
  if (typeof value === "string") return sanitizeRequestDetailsString(redactor.redactString(value, sensitiveValues))
  if (Array.isArray(value)) return sanitizeRequestDetailsArray(value, {redactor, seen, sensitiveValues})
  if (typeof value === "object") return sanitizeRequestDetailsObject(value, {redactor, seen, sensitiveValues})

  return String(value)
}

/**
 * Checks whether a value can be kept as-is.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether the value is primitive and safe.
 */
function primitiveRequestDetailsValue(value) {
  return value == null || typeof value === "boolean" || typeof value === "number"
}

/**
 * Sanitizes a string value.
 * @param {string} value - String value.
 * @returns {string} - Sanitized string.
 */
function sanitizeRequestDetailsString(value) {
  if (value.length <= REQUEST_DETAILS_STRING_MAX_LENGTH) return value

  return `${value.slice(0, REQUEST_DETAILS_STRING_MAX_LENGTH)}... [truncated ${value.length - REQUEST_DETAILS_STRING_MAX_LENGTH} chars]`
}

/**
 * Sanitizes an array value.
 * @param {Array<ReturnType<typeof JSON.parse>>} value - Array value.
 * @param {{redactor: LogRedactor, seen: WeakSet<object>, sensitiveValues: Set<string>}} args - Redaction traversal state.
 * @returns {Array<ReturnType<typeof JSON.parse>>} - Sanitized array.
 */
function sanitizeRequestDetailsArray(value, {redactor, seen, sensitiveValues}) {
  const entries = value
    .slice(0, REQUEST_DETAILS_ARRAY_MAX_ITEMS)
    .map((entry) => sanitizeRequestDetailsValue(entry, {redactor, seen, sensitiveValues}))

  if (value.length > REQUEST_DETAILS_ARRAY_MAX_ITEMS) {
    entries.push({__omittedItems: value.length - REQUEST_DETAILS_ARRAY_MAX_ITEMS})
  }

  return entries
}

/**
 * Sanitizes a plain object-like value.
 * @param {object} value - Object value.
 * @param {{redactor: LogRedactor, seen: WeakSet<object>, sensitiveValues: Set<string>}} args - Redaction traversal state.
 * @returns {Record<string, ReturnType<typeof JSON.parse>> | string} - Sanitized object or circular marker.
 */
function sanitizeRequestDetailsObject(value, {redactor, seen, sensitiveValues}) {
  if (seen.has(value)) return "[circular]"

  seen.add(value)

  /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
  const sanitized = {}

  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitized[entryKey] = sanitizeRequestDetailsValue(entryValue, {key: entryKey, redactor, seen, sensitiveValues})
  }

  seen.delete(value)

  return sanitized
}

/**
 * Checks whether a value is a Node.js Buffer.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {value is Buffer} - Whether value is a Buffer.
 */
function bufferValue(value) {
  return typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(value)
}

/**
 * Summarizes raw binary data without serializing bytes.
 * @param {Buffer} buffer - Uploaded or request buffer.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Request-safe buffer summary.
 */
function bufferRequestDetailsSummary(buffer) {
  return {
    __redacted: true,
    __type: "Buffer",
    byteLength: buffer.byteLength
  }
}

/**
 * Summarizes uploaded files without serializing file bytes or temp paths.
 * @param {UploadedFile} uploadedFile - Uploaded file object.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Request-safe upload summary.
 */
function uploadedFileRequestDetailsSummary(uploadedFile) {
  return {
    __redacted: true,
    __type: "UploadedFile",
    contentType: uploadedFile.contentType() ?? null,
    fieldName: uploadedFile.fieldName(),
    filename: uploadedFile.filename(),
    size: uploadedFile.size()
  }
}

/**
 * Compacts a frontend-model request envelope while preserving debugging shape.
 * @param {ReturnType<typeof JSON.parse>} value - Sanitized body value.
 * @param {number} originalSerializedLength - Byte count before redaction or compaction.
 * @returns {ReturnType<typeof JSON.parse>} - Compacted body value.
 */
function compactFrontendModelRequestBody(value, originalSerializedLength) {
  if (!value || typeof value !== "object" || !Array.isArray(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value).requests)) {
    return compactRequestDetailsBody(value, originalSerializedLength)
  }

  return {
    __truncated: true,
    originalSerializedLength,
    requests: /** @type {Array<ReturnType<typeof JSON.parse>>} */ (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value).requests).map((request) => {
      return compactFrontendModelRequest(request)
    })
  }
}

/**
 * Compacts one frontend-model request entry.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate request entry from the transport envelope.
 * @returns {ReturnType<typeof JSON.parse>} - Compacted request.
 */
function compactFrontendModelRequest(value) {
  if (!value || typeof value !== "object") return value

  const request = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value)
  /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
  const compact = {}

  for (const key of ["requestId", "model", "commandType", "customPath"]) {
    if (request[key] !== undefined) compact[key] = request[key]
  }

  if (request.payload !== undefined) {
    compact.payload = compactFrontendModelPayload(request.payload)
  }

  return compact
}

/**
 * Compacts a frontend-model payload.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate payload from a request entry.
 * @returns {ReturnType<typeof JSON.parse>} - Compacted payload.
 */
function compactFrontendModelPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value

  const payload = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value)
  /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
  const compact = {}

  for (const [key, entryValue] of Object.entries(payload)) {
    compact[key] = compactFrontendModelPayloadEntry({key, value: entryValue})
  }

  return compact
}

/**
 * Compacts one frontend-model payload entry.
 * @param {{key: string, value: ReturnType<typeof JSON.parse>}} args - Payload entry.
 * @returns {ReturnType<typeof JSON.parse>} - Compacted value.
 */
function compactFrontendModelPayloadEntry({key, value}) {
  if (key !== "attributes" || !value || typeof value !== "object" || Array.isArray(value)) {
    return value
  }

  return {__keys: Object.keys(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value))}
}

/**
 * Builds a last-resort compact body summary.
 * @param {ReturnType<typeof JSON.parse>} value - Sanitized body.
 * @param {number} originalSerializedLength - Byte count before redaction or compaction.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Compact summary.
 */
function compactRequestDetailsBody(value, originalSerializedLength) {
  return {
    __truncated: true,
    originalSerializedLength,
    topLevelKeys: value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value))
      : []
  }
}

/**
 * Measures JSON serialized length.
 * @param {ReturnType<typeof JSON.parse>} value - Value to measure.
 * @returns {number} - Serialized length, or Infinity when not serializable.
 */
function serializedLength(value) {
  try {
    return JSON.stringify(value).length
  } catch {
    return Infinity
  }
}
