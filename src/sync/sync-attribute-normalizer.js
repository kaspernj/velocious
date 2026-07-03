// @ts-check

import {optionalBoolean, optionalFloat, optionalInteger, snakeCaseKey} from "typanic"

import validationMessage from "../database/record/validation-messages.js"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Database column types mapped to their schema entry type.
 * @type {Record<string, "boolean" | "date" | "float" | "integer" | "json" | "string" | "uuid">}
 */
const SCHEMA_TYPES_BY_COLUMN_TYPE = {
  bigint: "integer",
  bigserial: "integer",
  bit: "boolean",
  bool: "boolean",
  boolean: "boolean",
  char: "string",
  character: "string",
  "character varying": "string",
  citext: "string",
  clob: "string",
  date: "date",
  datetime: "date",
  datetime2: "date",
  datetimeoffset: "date",
  decimal: "float",
  double: "float",
  "double precision": "float",
  float: "float",
  int: "integer",
  integer: "integer",
  json: "json",
  jsonb: "json",
  longtext: "string",
  mediumint: "integer",
  mediumtext: "string",
  ntext: "string",
  numeric: "float",
  nvarchar: "string",
  real: "float",
  serial: "integer",
  smalldatetime: "date",
  smallint: "integer",
  string: "string",
  text: "string",
  timestamp: "date",
  "timestamp with time zone": "date",
  "timestamp without time zone": "date",
  timestamptz: "date",
  tinyint: "integer",
  tinytext: "string",
  uniqueidentifier: "uuid",
  uuid: "uuid",
  varchar: "string"
}

/**
 * Maps a database column type to the matching schema entry type, so
 * writable-attribute schemas can be inferred from column metadata.
 * @param {string} columnType - Database column type (any casing, optional length suffix).
 * @returns {"boolean" | "date" | "float" | "integer" | "json" | "string" | "uuid" | null} Matching schema entry type or null when unmappable.
 */
export function schemaTypeFromColumnType(columnType) {
  const normalizedType = columnType.toLowerCase().replace(/\(.*\)$/, "").trim()

  return SCHEMA_TYPES_BY_COLUMN_TYPE[normalizedType] ?? null
}

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
 * default to `<label> <predicate>.` phrasings with `sync-<label>-...` codes,
 * where the label defaults to the camelCase attribute name and the predicate
 * comes from the framework validation-message layer (translatable through the
 * configuration translator); apps pin exact messages per attribute through
 * the legacy `*Message` overrides.
 * @typedef {object} SyncAttributeSchemaEntry
 * @property {"boolean" | "date" | "float" | "ignored" | "integer" | "json" | "raw" | "rawOrNull" | "string" | "uuid"} type - Attribute value type.
 * @property {boolean} [required] - Whether present blank/absent values are rejected (strings reject blank-after-trim, dates reject null).
 * @property {number} [maxLength] - Maximum string length, checked after trimming (or untrimmed when `trim` is false).
 * @property {number} [min] - Minimum integer value (inclusive).
 * @property {number} [max] - Maximum integer value (inclusive).
 * @property {boolean} [trim] - Whether string values are trimmed before validation. Defaults to true.
 * @property {"error" | "null"} [invalid] - Invalid-date handling: "error" rejects, "null" maps invalid values to null. Defaults to "error".
 * @property {string} [label] - Label used in derived messages and codes.
 * @property {string} [column] - Output column key. Defaults to the snake_cased attribute name.
 * @property {string} [requiredMessage] - Pinned message for required rejections (legacy escape hatch over translated defaults).
 * @property {string} [tooLongMessage] - Pinned message for too-long rejections (legacy escape hatch over translated defaults).
 * @property {string} [tooSmallMessage] - Pinned message for below-min integer rejections (legacy escape hatch over translated defaults).
 * @property {string} [tooLargeMessage] - Pinned message for above-max integer rejections (legacy escape hatch over translated defaults).
 * @property {string} [invalidMessage] - Pinned message for invalid dates, booleans, integers, floats, uuids and non-object/non-string json values (legacy escape hatch over translated defaults).
 * @property {string} [invalidJsonMessage] - Pinned message for unparseable json strings (legacy escape hatch over translated defaults).
 */

/**
 * Shared per-entry validation context threaded through the value normalizers.
 * @typedef {object} SyncAttributeEntryContext
 * @property {SyncAttributeSchemaEntry} entry - Schema entry.
 * @property {SyncAttributeErrorFactory} errorFactory - Error factory.
 * @property {string} label - Message/code label.
 * @property {import("../database/record/validation-messages.js").ValidationMessageTranslator | null} translator - Message translator.
 * @property {?} value - Raw value.
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
 * @param {"attribute" | "column"} [args.keyCase] - Output key casing: "column" emits snake_case column keys, "attribute" emits camelCase attribute keys. Defaults to "column".
 * @param {Record<string, SyncAttributeSchemaEntry>} args.schema - Attribute schema keyed by camelCase attribute name.
 * @param {import("../database/record/validation-messages.js").ValidationMessageTranslator | null} [args.translator] - Translator used for derived default messages (usually `configuration.getTranslator()`).
 * @param {"error" | "ignore"} [args.unknownAttributes] - Unknown input-key handling. Defaults to "error".
 * @returns {Record<string, ?>} Normalized values keyed per the requested key casing.
 */
export default function normalizeAttributesWithSchema({attributes, errorFactory, keyCase = "column", schema, translator = null, unknownAttributes = "error"}) {
  if (!attributes || typeof attributes != "object") throw new Error(`normalizeAttributesWithSchema requires an attributes object, got: ${String(attributes)}`)
  if (typeof errorFactory != "function") throw new Error("normalizeAttributesWithSchema requires an errorFactory function")
  if (!schema || typeof schema != "object") throw new Error(`normalizeAttributesWithSchema requires a schema object, got: ${String(schema)}`)
  if (unknownAttributes != "error" && unknownAttributes != "ignore") {
    throw new Error(`normalizeAttributesWithSchema unknownAttributes must be "error" or "ignore", got: ${String(unknownAttributes)}`)
  }

  if (keyCase != "attribute" && keyCase != "column") {
    throw new Error(`normalizeAttributesWithSchema keyCase must be "attribute" or "column", got: ${String(keyCase)}`)
  }

  /** @type {Record<string, ?>} */
  const normalized = {}
  /** @type {Set<string>} */
  const knownInputKeys = new Set()

  for (const [attributeName, entry] of Object.entries(schema)) {
    const column = entry.column ?? snakeCaseKey(attributeName)
    const outputKey = keyCase == "attribute" ? attributeName : column
    const inputKeys = column == attributeName ? [attributeName] : [column, attributeName]

    for (const inputKey of inputKeys) {
      knownInputKeys.add(inputKey)

      if (entry.type == "ignored") continue
      if (!Object.prototype.hasOwnProperty.call(attributes, inputKey)) continue

      normalized[outputKey] = normalizeAttributeValue({attributeName, entry, errorFactory, translator, value: attributes[inputKey]})
    }
  }

  if (unknownAttributes == "error") {
    for (const inputKey of Object.keys(attributes)) {
      if (!knownInputKeys.has(inputKey)) {
        throw errorFactory(validationMessage({translator, type: "unknown_attribute", variables: {attribute: inputKey}}), {code: "sync-unknown-attribute"})
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
 * @param {import("../database/record/validation-messages.js").ValidationMessageTranslator | null} args.translator - Message translator.
 * @param {?} args.value - Raw value.
 * @returns {?} Normalized value.
 */
function normalizeAttributeValue({attributeName, entry, errorFactory, translator, value}) {
  const label = entry.label ?? attributeName
  const context = {entry, errorFactory, label, translator, value}

  if (entry.type == "string") return normalizeString(context)
  if (entry.type == "date") return normalizeDate(context)
  if (entry.type == "json") return normalizeJson(context)
  if (entry.type == "boolean") return normalizeBoolean(context)
  if (entry.type == "integer") return normalizeInteger(context)
  if (entry.type == "float") return normalizeFloat(context)
  if (entry.type == "uuid") return normalizeUuid(context)
  if (entry.type == "raw") return value
  if (entry.type == "rawOrNull") return value === undefined ? null : value

  throw new Error(`Unknown sync attribute schema type for ${attributeName}: ${String(entry.type)}`)
}

/**
 * Builds a derived `<label> <predicate>.` message through the validation-message layer.
 * @param {object} args - Options.
 * @param {string} args.label - Message label.
 * @param {import("../database/record/validation-messages.js").ValidationMessageTranslator | null} args.translator - Message translator.
 * @param {string} args.type - Validation message type.
 * @param {Record<string, string | number>} [args.variables] - Interpolation variables.
 * @returns {string} Derived message.
 */
function derivedMessage({label, translator, type, variables}) {
  return `${label} ${validationMessage({translator, type, variables})}.`
}

/**
 * Builds the required-rejection error for an empty required attribute value.
 * @param {SyncAttributeEntryContext} context - Entry context.
 * @returns {Error} Required-rejection error.
 */
function requiredError({entry, errorFactory, label, translator}) {
  return errorFactory(entry.requiredMessage ?? derivedMessage({label, translator, type: "blank"}), {code: `sync-${label}-required`})
}

/**
 * Normalizes a boolean attribute: booleans pass through, 1/0 coerce, empty values become null and anything else is rejected.
 * @param {SyncAttributeEntryContext} context - Entry context.
 * @returns {boolean | null} Normalized boolean.
 */
function normalizeBoolean(context) {
  const {entry, errorFactory, label, translator, value} = context

  if (value === null || value === undefined || value === "") {
    if (entry.required) throw requiredError(context)

    return null
  }

  if (value === 1) return true
  if (value === 0) return false

  try {
    return optionalBoolean(value, label)
  } catch (error) {
    throw errorFactory(entry.invalidMessage ?? derivedMessage({label, translator, type: "invalid_boolean"}), {
      cause: /** @type {Error} */ (error),
      code: `sync-${label}-invalid-boolean`
    })
  }
}

/**
 * Normalizes an integer attribute: integers pass through, empty values become null, non-integers are rejected and min/max bounds are enforced.
 * @param {SyncAttributeEntryContext} context - Entry context.
 * @returns {number | null} Normalized integer.
 */
function normalizeInteger(context) {
  const {entry, errorFactory, label, translator, value} = context

  if (value === null || value === undefined || value === "") {
    if (entry.required) throw requiredError(context)

    return null
  }

  /** @type {number | null} */
  let integerValue

  try {
    integerValue = optionalInteger(value, label)
  } catch (error) {
    throw errorFactory(entry.invalidMessage ?? derivedMessage({label, translator, type: "not_an_integer"}), {
      cause: /** @type {Error} */ (error),
      code: `sync-${label}-invalid-integer`
    })
  }

  if (integerValue !== null && entry.min !== undefined && integerValue < entry.min) {
    throw errorFactory(
      entry.tooSmallMessage ?? derivedMessage({label, translator, type: "greater_than_or_equal_to", variables: {count: entry.min}}),
      {code: `sync-${label}-too-small`}
    )
  }

  if (integerValue !== null && entry.max !== undefined && integerValue > entry.max) {
    throw errorFactory(
      entry.tooLargeMessage ?? derivedMessage({label, translator, type: "less_than_or_equal_to", variables: {count: entry.max}}),
      {code: `sync-${label}-too-large`}
    )
  }

  return integerValue
}

/**
 * Normalizes a float attribute: finite numbers pass through, empty values become null and non-numbers are rejected.
 * @param {SyncAttributeEntryContext} context - Entry context.
 * @returns {number | null} Normalized float.
 */
function normalizeFloat(context) {
  const {entry, errorFactory, label, translator, value} = context

  if (value === null || value === undefined || value === "") {
    if (entry.required) throw requiredError(context)

    return null
  }

  try {
    return optionalFloat(value, label)
  } catch (error) {
    throw errorFactory(entry.invalidMessage ?? derivedMessage({label, translator, type: "not_a_number"}), {
      cause: /** @type {Error} */ (error),
      code: `sync-${label}-invalid-float`
    })
  }
}

/**
 * Normalizes a uuid attribute: matching strings pass through unchanged, empty values become null and anything else is rejected.
 * @param {SyncAttributeEntryContext} context - Entry context.
 * @returns {string | null} Normalized uuid.
 */
function normalizeUuid(context) {
  const {entry, errorFactory, label, translator, value} = context

  if (value === null || value === undefined || value === "") {
    if (entry.required) throw requiredError(context)

    return null
  }

  if (typeof value == "string" && UUID_REGEX.test(value)) return value

  throw errorFactory(entry.invalidMessage ?? derivedMessage({label, translator, type: "invalid_uuid"}), {code: `sync-${label}-invalid-uuid`})
}

/**
 * Normalizes a string attribute: trims (unless `trim` is false), rejects blank required values, maps empty optional values to null and bounds the length.
 * @param {SyncAttributeEntryContext} context - Entry context.
 * @returns {string | null} Normalized string.
 */
function normalizeString(context) {
  const {entry, errorFactory, label, translator, value} = context

  if (value === null || value === undefined || value === "") {
    if (entry.required) throw requiredError(context)

    return null
  }

  const stringValue = entry.trim === false ? String(value) : String(value).trim()

  if (stringValue === "") {
    if (entry.required) throw requiredError(context)

    return null
  }

  if (entry.maxLength !== undefined && stringValue.length > entry.maxLength) {
    throw errorFactory(
      entry.tooLongMessage ?? derivedMessage({label, translator, type: "too_long", variables: {count: entry.maxLength}}),
      {code: `sync-${label}-too-long`}
    )
  }

  return stringValue
}

/**
 * Normalizes a date attribute: Date instances pass through, strings/numbers are parsed and invalid or missing-required values are rejected (or mapped to null with `invalid: "null"`).
 * @param {SyncAttributeEntryContext} context - Entry context.
 * @returns {Date | null} Normalized date.
 */
function normalizeDate(context) {
  const {entry, errorFactory, label, translator, value} = context

  if (!entry.required && (value === null || value === undefined || value === "")) return null

  const dateValue = value instanceof Date ? value : typeof value == "string" || typeof value == "number" ? new Date(value) : null

  if (!dateValue || Number.isNaN(dateValue.getTime())) {
    if (entry.invalid == "null") {
      if (entry.required) throw requiredError(context)

      return null
    }

    throw errorFactory(entry.invalidMessage ?? derivedMessage({label, translator, type: "invalid_datetime"}), {code: `sync-${label}-invalid-datetime`})
  }

  return dateValue
}

/**
 * Normalizes a json attribute: empty values become null, objects pass through, strings must parse as JSON and other types are rejected.
 * @param {SyncAttributeEntryContext} context - Entry context.
 * @returns {?} Normalized json value.
 */
function normalizeJson(context) {
  const {entry, errorFactory, label, translator, value} = context

  if (value === null || value === undefined || value === "") return null
  if (typeof value == "object") return value

  if (typeof value == "string") {
    try {
      return JSON.parse(value)
    } catch (error) {
      throw errorFactory(entry.invalidJsonMessage ?? derivedMessage({label, translator, type: "invalid_json"}), {
        cause: /** @type {Error} */ (error),
        code: `sync-${label}-invalid-json`
      })
    }
  }

  throw errorFactory(entry.invalidMessage ?? derivedMessage({label, translator, type: "invalid_json_value"}), {code: `sync-${label}-invalid`})
}
