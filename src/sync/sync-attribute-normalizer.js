// @ts-check

import {snakeCaseKey} from "typanic"

/**
 * Builds the error thrown for a failed sync attribute validation.
 * @callback SyncAttributeErrorFactory
 * @param {string} message - Human-readable validation message.
 * @param {{cause?: Error, code: string}} details - Stable machine-readable code and optional cause.
 * @returns {Error} Error to throw.
 */

/**
 * Declarative validation schema for one writable sync attribute.
 *
 * Keys are camelCase attribute names; each attribute also accepts its
 * snake_case column key on input (the camelCase key wins when both are given)
 * and is written under the snake_case column key on output. Error messages
 * default to `<label> ...` phrasings with `sync-<label>-...` codes, where the
 * label defaults to the camelCase attribute name; apps pin exact messages per
 * attribute through the `*Message` overrides.
 * @typedef {object} SyncAttributeSchemaEntry
 * @property {"date" | "json" | "raw" | "string"} type - Attribute value type.
 * @property {boolean} [required] - Whether present blank/absent values are rejected (strings reject blank-after-trim, dates reject null).
 * @property {number} [maxLength] - Maximum string length, checked after trimming.
 * @property {string} [label] - Label used in derived messages and codes.
 * @property {string} [column] - Output column key. Defaults to the snake_cased attribute name.
 * @property {string} [requiredMessage] - Pinned message for required rejections.
 * @property {string} [tooLongMessage] - Pinned message for too-long rejections.
 * @property {string} [invalidMessage] - Pinned message for invalid dates and non-object/non-string json values.
 * @property {string} [invalidJsonMessage] - Pinned message for unparseable json strings.
 */

/**
 * Normalizes writable sync attributes against a declarative schema.
 *
 * Only present keys are validated, so required attributes may be absent —
 * create defaults own that concern. Input keys not declared in the schema are
 * rejected by default so misspelled or read-only attributes fail loudly
 * instead of being silently discarded (`unknownAttributes: "ignore"` opts
 * out). Validation failures throw through the given error factory so apps
 * control the raised error class.
 * @param {object} args - Options.
 * @param {Record<string, ?>} args.attributes - Raw incoming attributes (camelCase and/or snake_case keys).
 * @param {SyncAttributeErrorFactory} args.errorFactory - Maps validation failures to thrown errors.
 * @param {Record<string, SyncAttributeSchemaEntry>} args.schema - Attribute schema keyed by camelCase attribute name.
 * @param {"error" | "ignore"} [args.unknownAttributes] - Unknown input-key handling. Defaults to "error".
 * @returns {Record<string, ?>} Normalized values keyed by snake_case column names.
 */
export default function normalizeAttributesWithSchema({attributes, errorFactory, schema, unknownAttributes = "error"}) {
  if (!attributes || typeof attributes != "object") throw new Error(`normalizeAttributesWithSchema requires an attributes object, got: ${String(attributes)}`)
  if (typeof errorFactory != "function") throw new Error("normalizeAttributesWithSchema requires an errorFactory function")
  if (!schema || typeof schema != "object") throw new Error(`normalizeAttributesWithSchema requires a schema object, got: ${String(schema)}`)
  if (unknownAttributes != "error" && unknownAttributes != "ignore") {
    throw new Error(`normalizeAttributesWithSchema unknownAttributes must be "error" or "ignore", got: ${String(unknownAttributes)}`)
  }

  /** @type {Record<string, ?>} */
  const normalized = {}
  /** @type {Set<string>} */
  const knownInputKeys = new Set()

  for (const [attributeName, entry] of Object.entries(schema)) {
    const column = entry.column ?? snakeCaseKey(attributeName)
    const inputKeys = column == attributeName ? [attributeName] : [column, attributeName]

    for (const inputKey of inputKeys) {
      knownInputKeys.add(inputKey)

      if (!Object.prototype.hasOwnProperty.call(attributes, inputKey)) continue

      normalized[column] = normalizeAttributeValue({attributeName, entry, errorFactory, value: attributes[inputKey]})
    }
  }

  if (unknownAttributes == "error") {
    for (const inputKey of Object.keys(attributes)) {
      if (!knownInputKeys.has(inputKey)) {
        throw errorFactory(`Unknown attribute: ${inputKey}.`, {code: "sync-unknown-attribute"})
      }
    }
  }

  return normalized
}

/**
 * Normalizes one present attribute value per its schema entry.
 * @param {object} args - Options.
 * @param {string} args.attributeName - camelCase attribute name.
 * @param {SyncAttributeSchemaEntry} args.entry - Schema entry.
 * @param {SyncAttributeErrorFactory} args.errorFactory - Error factory.
 * @param {?} args.value - Raw value.
 * @returns {?} Normalized value.
 */
function normalizeAttributeValue({attributeName, entry, errorFactory, value}) {
  const label = entry.label ?? attributeName

  if (entry.type == "string") return normalizeString({entry, errorFactory, label, value})
  if (entry.type == "date") return normalizeDate({entry, errorFactory, label, value})
  if (entry.type == "json") return normalizeJson({entry, errorFactory, label, value})
  if (entry.type == "raw") return value

  throw new Error(`Unknown sync attribute schema type for ${attributeName}: ${String(entry.type)}`)
}

/**
 * Normalizes a string attribute: trims, rejects blank required values after trimming, maps empty optional values to null and bounds the trimmed length.
 * @param {object} args - Options.
 * @param {SyncAttributeSchemaEntry} args.entry - Schema entry.
 * @param {SyncAttributeErrorFactory} args.errorFactory - Error factory.
 * @param {string} args.label - Message/code label.
 * @param {?} args.value - Raw value.
 * @returns {string | null} Normalized string.
 */
function normalizeString({entry, errorFactory, label, value}) {
  const requiredError = () => errorFactory(entry.requiredMessage ?? `${label} is required.`, {code: `sync-${label}-required`})

  if (value === null || value === undefined || value === "") {
    if (entry.required) throw requiredError()

    return null
  }

  const stringValue = String(value).trim()

  if (stringValue === "") {
    if (entry.required) throw requiredError()

    return null
  }

  if (entry.maxLength !== undefined && stringValue.length > entry.maxLength) {
    throw errorFactory(entry.tooLongMessage ?? `${label} is too long (maximum is ${entry.maxLength} characters).`, {code: `sync-${label}-too-long`})
  }

  return stringValue
}

/**
 * Normalizes a date attribute: Date instances pass through, strings/numbers are parsed and invalid or missing-required values are rejected.
 * @param {object} args - Options.
 * @param {SyncAttributeSchemaEntry} args.entry - Schema entry.
 * @param {SyncAttributeErrorFactory} args.errorFactory - Error factory.
 * @param {string} args.label - Message/code label.
 * @param {?} args.value - Raw value.
 * @returns {Date | null} Normalized date.
 */
function normalizeDate({entry, errorFactory, label, value}) {
  if (!entry.required && (value === null || value === undefined || value === "")) return null

  const dateValue = value instanceof Date ? value : typeof value == "string" || typeof value == "number" ? new Date(value) : null

  if (!dateValue || Number.isNaN(dateValue.getTime())) {
    throw errorFactory(entry.invalidMessage ?? `${label} must be a valid datetime.`, {code: `sync-${label}-invalid-datetime`})
  }

  return dateValue
}

/**
 * Normalizes a json attribute: empty values become null, objects pass through, strings must parse as JSON and other types are rejected.
 * @param {object} args - Options.
 * @param {SyncAttributeSchemaEntry} args.entry - Schema entry.
 * @param {SyncAttributeErrorFactory} args.errorFactory - Error factory.
 * @param {string} args.label - Message/code label.
 * @param {?} args.value - Raw value.
 * @returns {?} Normalized json value.
 */
function normalizeJson({entry, errorFactory, label, value}) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value == "object") return value

  if (typeof value == "string") {
    try {
      return JSON.parse(value)
    } catch (error) {
      throw errorFactory(entry.invalidJsonMessage ?? `${label} must be valid JSON.`, {
        cause: /** @type {Error} */ (error),
        code: `sync-${label}-invalid-json`
      })
    }
  }

  throw errorFactory(entry.invalidMessage ?? `${label} must be an object or JSON string.`, {code: `sync-${label}-invalid`})
}
