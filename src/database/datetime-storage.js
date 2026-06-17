// @ts-check

import isDate from "../utils/is-date.js"

const dateTimeWithTimezonePattern = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:[zZ]|[+-]\d{2}:\d{2})$/
const dateTimeWithoutTimezonePattern = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/
const timezoneSuffixPattern = /(?:[zZ]|[+-]\d{2}:\d{2})$/

/**
 * Pads a numeric date/time part.
 * @param {number} value - Numeric part.
 * @param {number} length - Target length.
 * @returns {string} - Padded part.
 */
function pad(value, length = 2) {
  return String(value).padStart(length, "0")
}

/**
 * Replaces SQL-style datetime separators with ISO separators for parsing.
 * @param {string} value - Datetime string.
 * @returns {string} - Datetime string with a `T` separator.
 */
function normalizeDateTimeSeparator(value) {
  return value.includes("T") ? value : value.replace(" ", "T")
}

/**
 * Parses a datetime string with an explicit timezone.
 * @param {string} value - Datetime string.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneQualifiedDateTimeString(value) {
  if (!dateTimeWithTimezonePattern.test(value)) return value

  const timestamp = Date.parse(normalizeDateTimeSeparator(value))

  if (Number.isNaN(timestamp)) return value

  return new Date(timestamp)
}

/**
 * Parses a timezone-less datetime string as UTC.
 * @param {string} value - Datetime string.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneLessDateTimeStringAsUtc(value) {
  if (!dateTimeWithoutTimezonePattern.test(value)) return value

  const timestamp = Date.parse(`${normalizeDateTimeSeparator(value)}Z`)

  if (Number.isNaN(timestamp)) return value

  return new Date(timestamp)
}

/**
 * Parses a timezone-less datetime string as the current runtime's local wall-clock time.
 * @param {string} value - Datetime string.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneLessDateTimeStringAsLocal(value) {
  if (!dateTimeWithoutTimezonePattern.test(value)) return value

  const timestamp = Date.parse(normalizeDateTimeSeparator(value))

  if (Number.isNaN(timestamp)) return value

  return new Date(timestamp)
}

/**
 * Parses a timezone-less legacy datetime string with an explicit local offset.
 * The offset follows JavaScript's `Date#getTimezoneOffset()` sign convention.
 * @param {string} value - Datetime string.
 * @param {number} legacyLocalOffsetMinutes - UTC-minus-local offset in minutes.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneLessDateTimeStringWithOffset(value, legacyLocalOffsetMinutes) {
  const utcDate = parseTimezoneLessDateTimeStringAsUtc(value)

  if (!isDate(utcDate)) return value

  return new Date(utcDate.getTime() + (legacyLocalOffsetMinutes * 60 * 1000))
}

/**
 * Checks whether a string has a datetime timezone suffix.
 * @param {string} value - Value to check.
 * @returns {boolean} - Whether the string ends with `Z` or an offset.
 */
export function hasDateTimeTimezone(value) {
  return timezoneSuffixPattern.test(value)
}

/**
 * Formats a Date for database storage as a UTC instant.
 * @param {Date} value - Date value.
 * @param {object} args - Options.
 * @param {string} args.databaseType - Database driver type.
 * @returns {string} - Database datetime string.
 */
export function formatDateForDatabase(value, {databaseType}) {
  if (databaseType == "sqlite") return value.toISOString()

  return [
    value.getUTCFullYear(),
    "-",
    pad(value.getUTCMonth() + 1),
    "-",
    pad(value.getUTCDate()),
    " ",
    pad(value.getUTCHours()),
    ":",
    pad(value.getUTCMinutes()),
    ":",
    pad(value.getUTCSeconds()),
    ".",
    pad(value.getUTCMilliseconds(), 3)
  ].join("")
}

/**
 * Normalizes a record write string into a Date when it is a recognized datetime string.
 * Timezone-less strings are external input and are treated as UTC.
 * @param {string} value - Value to normalize.
 * @returns {Date | string} - Normalized value.
 */
export function normalizeDateStringForWrite(value) {
  if (hasDateTimeTimezone(value)) return parseTimezoneQualifiedDateTimeString(value)

  return parseTimezoneLessDateTimeStringAsUtc(value)
}

/**
 * Normalizes a record write value into a Date when it is a recognized datetime string.
 * Timezone-less strings are external input and are treated as UTC.
 * @param {Date | string | null | undefined} value - Value to normalize.
 * @returns {Date | string | null | undefined} - Normalized value.
 */
export function normalizeDateValueForWrite(value) {
  if (typeof value != "string") return value

  return normalizeDateStringForWrite(value)
}

/**
 * Normalizes a database value into a Date for record reads.
 * SQLite timezone-less rows are legacy local wall-clock rows produced before
 * UTC storage. New SQLite writes include `Z`, so they take the exact branch.
 * @param {Date | string | null | undefined} value - Stored database value.
 * @param {object} args - Options.
 * @param {string} args.databaseType - Database driver type.
 * @returns {Date | string | null | undefined} - Normalized value.
 */
export function normalizeDateValueForRead(value, {databaseType}) {
  if (value === null || value === undefined) return value

  if (isDate(value)) return new Date(value.getTime())
  if (typeof value != "string") return value
  if (hasDateTimeTimezone(value)) return parseTimezoneQualifiedDateTimeString(value)
  if (databaseType == "sqlite") return parseTimezoneLessDateTimeStringAsLocal(value)

  return parseTimezoneLessDateTimeStringAsUtc(value)
}

/**
 * Converts a legacy timezone-less datetime value into the new UTC database storage format.
 * The optional offset follows JavaScript's `Date#getTimezoneOffset()` sign convention.
 * @param {Date | string | null | undefined} value - Legacy value.
 * @param {object} args - Options.
 * @param {string} args.databaseType - Database driver type.
 * @param {number | undefined} [args.legacyLocalOffsetMinutes] - UTC-minus-local offset in minutes.
 * @returns {Date | string | null | undefined} - Converted database value or the original value.
 */
export function convertLegacyDateValueToUtcStorage(value, {databaseType, legacyLocalOffsetMinutes}) {
  if (typeof value != "string") return value
  if (hasDateTimeTimezone(value)) return value

  const parsedDate = legacyLocalOffsetMinutes === undefined
    ? parseTimezoneLessDateTimeStringAsLocal(value)
    : parseTimezoneLessDateTimeStringWithOffset(value, legacyLocalOffsetMinutes)

  if (!isDate(parsedDate)) return value

  return formatDateForDatabase(parsedDate, {databaseType})
}
