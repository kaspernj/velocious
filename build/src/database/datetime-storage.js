// @ts-check
import isDate from "../utils/is-date.js";
import { Temporal } from "@js-temporal/polyfill";
import { validateTimeZone } from "../time-zone.js";
const dateTimeWithTimezonePattern = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:[zZ]|[+-]\d{2}:\d{2})$/;
const dateTimeWithoutTimezonePattern = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;
const dateTimeWithoutTimezonePartsPattern = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/;
const timezoneSuffixPattern = /(?:[zZ]|[+-]\d{2}:\d{2})$/;
/**
 * Pads a numeric date/time part.
 * @param {number} value - Numeric part.
 * @param {number} length - Target length.
 * @returns {string} - Padded part.
 */
function pad(value, length = 2) {
    return String(value).padStart(length, "0");
}
/**
 * Replaces SQL-style datetime separators with ISO separators for parsing.
 * @param {string} value - Datetime string.
 * @returns {string} - Datetime string with a `T` separator.
 */
function normalizeDateTimeSeparator(value) {
    return value.includes("T") ? value : value.replace(" ", "T");
}
/**
 * Parses a datetime string with an explicit timezone.
 * @param {string} value - Datetime string.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneQualifiedDateTimeString(value) {
    if (!dateTimeWithTimezonePattern.test(value))
        return value;
    const timestamp = Date.parse(normalizeDateTimeSeparator(value));
    if (Number.isNaN(timestamp))
        return value;
    return new Date(timestamp);
}
/**
 * Parses a timezone-less datetime string as UTC.
 * @param {string} value - Datetime string.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneLessDateTimeStringAsUtc(value) {
    if (!dateTimeWithoutTimezonePattern.test(value))
        return value;
    const timestamp = Date.parse(`${normalizeDateTimeSeparator(value)}Z`);
    if (Number.isNaN(timestamp))
        return value;
    return new Date(timestamp);
}
/**
 * Parses a timezone-less datetime string as the current runtime's local wall-clock time.
 * @param {string} value - Datetime string.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneLessDateTimeStringAsLocal(value) {
    if (!dateTimeWithoutTimezonePattern.test(value))
        return value;
    const timestamp = Date.parse(normalizeDateTimeSeparator(value));
    if (Number.isNaN(timestamp))
        return value;
    return new Date(timestamp);
}
/**
 * Parses a timezone-less legacy datetime string with an explicit local offset.
 * The offset follows JavaScript's `Date#getTimezoneOffset()` sign convention.
 * @param {string} value - Datetime string.
 * @param {number} legacyLocalOffsetMinutes - UTC-minus-local offset in minutes.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneLessDateTimeStringWithOffset(value, legacyLocalOffsetMinutes) {
    const utcDate = parseTimezoneLessDateTimeStringAsUtc(value);
    if (!isDate(utcDate))
        return value;
    return new Date(utcDate.getTime() + (legacyLocalOffsetMinutes * 60 * 1000));
}
/**
 * Parses a timezone-less datetime string in a named timezone.
 * @param {string} value - Datetime string.
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {Date | string} - Parsed date or the original string when it is not a recognized datetime.
 */
function parseTimezoneLessDateTimeStringWithTimeZone(value, timeZone) {
    const match = value.match(dateTimeWithoutTimezonePartsPattern);
    if (!match)
        return value;
    const normalizedTimeZone = validateTimeZone(timeZone, "timeZone");
    const fraction = (match[7] || "").padEnd(9, "0");
    try {
        const zonedDateTime = Temporal.ZonedDateTime.from({
            day: Number(match[3]),
            hour: Number(match[4]),
            microsecond: Number(fraction.slice(3, 6)),
            millisecond: Number(fraction.slice(0, 3)),
            minute: Number(match[5]),
            month: Number(match[2]),
            nanosecond: Number(fraction.slice(6, 9)),
            second: Number(match[6]),
            timeZone: normalizedTimeZone,
            year: Number(match[1])
        });
        return new Date(Number(zonedDateTime.epochMilliseconds));
    }
    catch (error) {
        if (error instanceof RangeError)
            return value;
        throw error;
    }
}
/**
 * Checks whether a string has a datetime timezone suffix.
 * @param {string} value - Value to check.
 * @returns {boolean} - Whether the string ends with `Z` or an offset.
 */
export function hasDateTimeTimezone(value) {
    return timezoneSuffixPattern.test(value);
}
/**
 * Formats a Date for database storage as a UTC instant.
 * @param {Date} value - Date value.
 * @param {object} args - Options.
 * @param {string} args.databaseType - Database driver type.
 * @returns {string} - Database datetime string.
 */
export function formatDateForDatabase(value, { databaseType }) {
    if (databaseType == "sqlite")
        return value.toISOString();
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
    ].join("");
}
/**
 * Normalizes a record write string into a Date when it is a recognized datetime string.
 * Timezone-less strings are interpreted in the given timezone when present, otherwise UTC.
 * @param {string} value - Value to normalize.
 * @param {object} [options] - Parse options.
 * @param {string | undefined} [options.timeZone] - Timezone for timezone-less strings.
 * @returns {Date | string} - Normalized value.
 */
export function normalizeDateStringForWrite(value, { timeZone } = {}) {
    if (hasDateTimeTimezone(value))
        return parseTimezoneQualifiedDateTimeString(value);
    if (timeZone !== undefined)
        return parseTimezoneLessDateTimeStringWithTimeZone(value, timeZone);
    return parseTimezoneLessDateTimeStringAsUtc(value);
}
/**
 * Normalizes a record write value into a Date when it is a recognized datetime string.
 * Timezone-less strings are interpreted in the given timezone when present, otherwise UTC.
 * @param {Date | string | null | undefined} value - Value to normalize.
 * @param {object} [options] - Parse options.
 * @param {string | undefined} [options.timeZone] - Timezone for timezone-less strings.
 * @returns {Date | string | null | undefined} - Normalized value.
 */
export function normalizeDateValueForWrite(value, { timeZone } = {}) {
    if (typeof value != "string")
        return value;
    return normalizeDateStringForWrite(value, { timeZone });
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
export function normalizeDateValueForRead(value, { databaseType }) {
    if (value === null || value === undefined)
        return value;
    if (isDate(value))
        return new Date(value.getTime());
    if (typeof value != "string")
        return value;
    if (hasDateTimeTimezone(value))
        return parseTimezoneQualifiedDateTimeString(value);
    if (databaseType == "sqlite")
        return parseTimezoneLessDateTimeStringAsLocal(value);
    return parseTimezoneLessDateTimeStringAsUtc(value);
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
export function convertLegacyDateValueToUtcStorage(value, { databaseType, legacyLocalOffsetMinutes }) {
    if (typeof value != "string")
        return value;
    if (hasDateTimeTimezone(value))
        return value;
    const parsedDate = legacyLocalOffsetMinutes === undefined
        ? parseTimezoneLessDateTimeStringAsLocal(value)
        : parseTimezoneLessDateTimeStringWithOffset(value, legacyLocalOffsetMinutes);
    if (!isDate(parsedDate))
        return value;
    return formatDateForDatabase(parsedDate, { databaseType });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0ZXRpbWUtc3RvcmFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kYXRldGltZS1zdG9yYWdlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxxQkFBcUIsQ0FBQTtBQUN4QyxPQUFPLEVBQUMsUUFBUSxFQUFDLE1BQU0sdUJBQXVCLENBQUE7QUFDOUMsT0FBTyxFQUFDLGdCQUFnQixFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFFaEQsTUFBTSwyQkFBMkIsR0FBRyxnRkFBZ0YsQ0FBQTtBQUNwSCxNQUFNLDhCQUE4QixHQUFHLHdEQUF3RCxDQUFBO0FBQy9GLE1BQU0sbUNBQW1DLEdBQUcsc0VBQXNFLENBQUE7QUFDbEgsTUFBTSxxQkFBcUIsR0FBRywyQkFBMkIsQ0FBQTtBQUV6RDs7Ozs7R0FLRztBQUNILFNBQVMsR0FBRyxDQUFDLEtBQUssRUFBRSxNQUFNLEdBQUcsQ0FBQztJQUM1QixPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQzVDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUywwQkFBMEIsQ0FBQyxLQUFLO0lBQ3ZDLE9BQU8sS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQTtBQUM5RCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsb0NBQW9DLENBQUMsS0FBSztJQUNqRCxJQUFJLENBQUMsMkJBQTJCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRTFELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsMEJBQTBCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FB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QUFDLEtBQUssQ0FBQyxDQUFBO0lBRWxGLE9BQU8sb0NBQW9DLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDcEQsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsTUFBTSxVQUFVLGtDQUFrQyxDQUFDLEtBQUssRUFBRSxFQUFDLFlBQVksRUFBRSx3QkFBd0IsRUFBQztJQUNoRyxJQUFJLE9BQU8sS0FBSyxJQUFJLFFBQVE7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUMxQyxJQUFJLG1CQUFtQixDQUFDLEtBQUssQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRTVDLE1BQU0sVUFBVSxHQUFHLHdCQUF3QixLQUFLLFNBQVM7UUFDdkQsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDLEtBQUssQ0FBQztRQUMvQyxDQUFDLENBQUMseUNBQXlDLENBQUMsS0FBSyxFQUFFLHdCQUF3QixDQUFDLENBQUE7SUFFOUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUM7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUVyQyxPQUFPLHFCQUFxQixDQUFDLFVBQVUsRUFBRSxFQUFDLFlBQVksRUFBQyxDQUFDLENBQUE7QUFDMUQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgaXNEYXRlIGZyb20gXCIuLi91dGlscy9pcy1kYXRlLmpzXCJcbmltcG9ydCB7VGVtcG9yYWx9IGZyb20gXCJAanMtdGVtcG9yYWwvcG9seWZpbGxcIlxuaW1wb3J0IHt2YWxpZGF0ZVRpbWVab25lfSBmcm9tIFwiLi4vdGltZS16b25lLmpzXCJcblxuY29uc3QgZGF0ZVRpbWVXaXRoVGltZXpvbmVQYXR0ZXJuID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfVsgVF1cXGR7Mn06XFxkezJ9OlxcZHsyfSg/OlxcLlxcZHsxLDl9KT8oPzpbelpdfFsrLV1cXGR7Mn06XFxkezJ9KSQvXG5jb25zdCBkYXRlVGltZVdpdGhvdXRUaW1lem9uZVBhdHRlcm4gPSAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9WyBUXVxcZHsyfTpcXGR7Mn06XFxkezJ9KD86XFwuXFxkezEsOX0pPyQvXG5jb25zdCBkYXRlVGltZVdpdGhvdXRUaW1lem9uZVBhcnRzUGF0dGVybiA9IC9eKFxcZHs0fSktKFxcZHsyfSktKFxcZHsyfSlbIFRdKFxcZHsyfSk6KFxcZHsyfSk6KFxcZHsyfSkoPzpcXC4oXFxkezEsOX0pKT8kL1xuY29uc3QgdGltZXpvbmVTdWZmaXhQYXR0ZXJuID0gLyg/Olt6Wl18WystXVxcZHsyfTpcXGR7Mn0pJC9cblxuLyoqXG4gKiBQYWRzIGEgbnVtZXJpYyBkYXRlL3RpbWUgcGFydC5cbiAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE51bWVyaWMgcGFydC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBsZW5ndGggLSBUYXJnZXQgbGVuZ3RoLlxuICogQHJldHVybnMge3N0cmluZ30gLSBQYWRkZWQgcGFydC5cbiAqL1xuZnVuY3Rpb24gcGFkKHZhbHVlLCBsZW5ndGggPSAyKSB7XG4gIHJldHVybiBTdHJpbmcodmFsdWUpLnBhZFN0YXJ0KGxlbmd0aCwgXCIwXCIpXG59XG5cbi8qKlxuICogUmVwbGFjZXMgU1FMLXN0eWxlIGRhdGV0aW1lIHNlcGFyYXRvcnMgd2l0aCBJU08gc2VwYXJhdG9ycyBmb3IgcGFyc2luZy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIERhdGV0aW1lIHN0cmluZy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGF0ZXRpbWUgc3RyaW5nIHdpdGggYSBgVGAgc2VwYXJhdG9yLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVEYXRlVGltZVNlcGFyYXRvcih2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUuaW5jbHVkZXMoXCJUXCIpID8gdmFsdWUgOiB2YWx1ZS5yZXBsYWNlKFwiIFwiLCBcIlRcIilcbn1cblxuLyoqXG4gKiBQYXJzZXMgYSBkYXRldGltZSBzdHJpbmcgd2l0aCBhbiBleHBsaWNpdCB0aW1lem9uZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIERhdGV0aW1lIHN0cmluZy5cbiAqIEByZXR1cm5zIHtEYXRlIHwgc3RyaW5nfSAtIFBhcnNlZCBkYXRlIG9yIHRoZSBvcmlnaW5hbCBzdHJpbmcgd2hlbiBpdCBpcyBub3QgYSByZWNvZ25pemVkIGRhdGV0aW1lLlxuICovXG5mdW5jdGlvbiBwYXJzZVRpbWV6b25lUXVhbGlmaWVkRGF0ZVRpbWVTdHJpbmcodmFsdWUpIHtcbiAgaWYgKCFkYXRlVGltZVdpdGhUaW1lem9uZVBhdHRlcm4udGVzdCh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gIGNvbnN0IHRpbWVzdGFtcCA9IERhdGUucGFyc2Uobm9ybWFsaXplRGF0ZVRpbWVTZXBhcmF0b3IodmFsdWUpKVxuXG4gIGlmIChOdW1iZXIuaXNOYU4odGltZXN0YW1wKSkgcmV0dXJuIHZhbHVlXG5cbiAgcmV0dXJuIG5ldyBEYXRlKHRpbWVzdGFtcClcbn1cblxuLyoqXG4gKiBQYXJzZXMgYSB0aW1lem9uZS1sZXNzIGRhdGV0aW1lIHN0cmluZyBhcyBVVEMuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBEYXRldGltZSBzdHJpbmcuXG4gKiBAcmV0dXJucyB7RGF0ZSB8IHN0cmluZ30gLSBQYXJzZWQgZGF0ZSBvciB0aGUgb3JpZ2luYWwgc3RyaW5nIHdoZW4gaXQgaXMgbm90IGEgcmVjb2duaXplZCBkYXRldGltZS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VUaW1lem9uZUxlc3NEYXRlVGltZVN0cmluZ0FzVXRjKHZhbHVlKSB7XG4gIGlmICghZGF0ZVRpbWVXaXRob3V0VGltZXpvbmVQYXR0ZXJuLnRlc3QodmFsdWUpKSByZXR1cm4gdmFsdWVcblxuICBjb25zdCB0aW1lc3RhbXAgPSBEYXRlLnBhcnNlKGAke25vcm1hbGl6ZURhdGVUaW1lU2VwYXJhdG9yKHZhbHVlKX1aYClcblxuICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzdGFtcCkpIHJldHVybiB2YWx1ZVxuXG4gIHJldHVybiBuZXcgRGF0ZSh0aW1lc3RhbXApXG59XG5cbi8qKlxuICogUGFyc2VzIGEgdGltZXpvbmUtbGVzcyBkYXRldGltZSBzdHJpbmcgYXMgdGhlIGN1cnJlbnQgcnVudGltZSdzIGxvY2FsIHdhbGwtY2xvY2sgdGltZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIERhdGV0aW1lIHN0cmluZy5cbiAqIEByZXR1cm5zIHtEYXRlIHwgc3RyaW5nfSAtIFBhcnNlZCBkYXRlIG9yIHRoZSBvcmlnaW5hbCBzdHJpbmcgd2hlbiBpdCBpcyBub3QgYSByZWNvZ25pemVkIGRhdGV0aW1lLlxuICovXG5mdW5jdGlvbiBwYXJzZVRpbWV6b25lTGVzc0RhdGVUaW1lU3RyaW5nQXNMb2NhbCh2YWx1ZSkge1xuICBpZiAoIWRhdGVUaW1lV2l0aG91dFRpbWV6b25lUGF0dGVybi50ZXN0KHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgY29uc3QgdGltZXN0YW1wID0gRGF0ZS5wYXJzZShub3JtYWxpemVEYXRlVGltZVNlcGFyYXRvcih2YWx1ZSkpXG5cbiAgaWYgKE51bWJlci5pc05hTih0aW1lc3RhbXApKSByZXR1cm4gdmFsdWVcblxuICByZXR1cm4gbmV3IERhdGUodGltZXN0YW1wKVxufVxuXG4vKipcbiAqIFBhcnNlcyBhIHRpbWV6b25lLWxlc3MgbGVnYWN5IGRhdGV0aW1lIHN0cmluZyB3aXRoIGFuIGV4cGxpY2l0IGxvY2FsIG9mZnNldC5cbiAqIFRoZSBvZmZzZXQgZm9sbG93cyBKYXZhU2NyaXB0J3MgYERhdGUjZ2V0VGltZXpvbmVPZmZzZXQoKWAgc2lnbiBjb252ZW50aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gRGF0ZXRpbWUgc3RyaW5nLlxuICogQHBhcmFtIHtudW1iZXJ9IGxlZ2FjeUxvY2FsT2Zmc2V0TWludXRlcyAtIFVUQy1taW51cy1sb2NhbCBvZmZzZXQgaW4gbWludXRlcy5cbiAqIEByZXR1cm5zIHtEYXRlIHwgc3RyaW5nfSAtIFBhcnNlZCBkYXRlIG9yIHRoZSBvcmlnaW5hbCBzdHJpbmcgd2hlbiBpdCBpcyBub3QgYSByZWNvZ25pemVkIGRhdGV0aW1lLlxuICovXG5mdW5jdGlvbiBwYXJzZVRpbWV6b25lTGVzc0RhdGVUaW1lU3RyaW5nV2l0aE9mZnNldCh2YWx1ZSwgbGVnYWN5TG9jYWxPZmZzZXRNaW51dGVzKSB7XG4gIGNvbnN0IHV0Y0RhdGUgPSBwYXJzZVRpbWV6b25lTGVzc0RhdGVUaW1lU3RyaW5nQXNVdGModmFsdWUpXG5cbiAgaWYgKCFpc0RhdGUodXRjRGF0ZSkpIHJldHVybiB2YWx1ZVxuXG4gIHJldHVybiBuZXcgRGF0ZSh1dGNEYXRlLmdldFRpbWUoKSArIChsZWdhY3lMb2NhbE9mZnNldE1pbnV0ZXMgKiA2MCAqIDEwMDApKVxufVxuXG4vKipcbiAqIFBhcnNlcyBhIHRpbWV6b25lLWxlc3MgZGF0ZXRpbWUgc3RyaW5nIGluIGEgbmFtZWQgdGltZXpvbmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBEYXRldGltZSBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gdGltZVpvbmUgLSBJQU5BIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gKiBAcmV0dXJucyB7RGF0ZSB8IHN0cmluZ30gLSBQYXJzZWQgZGF0ZSBvciB0aGUgb3JpZ2luYWwgc3RyaW5nIHdoZW4gaXQgaXMgbm90IGEgcmVjb2duaXplZCBkYXRldGltZS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VUaW1lem9uZUxlc3NEYXRlVGltZVN0cmluZ1dpdGhUaW1lWm9uZSh2YWx1ZSwgdGltZVpvbmUpIHtcbiAgY29uc3QgbWF0Y2ggPSB2YWx1ZS5tYXRjaChkYXRlVGltZVdpdGhvdXRUaW1lem9uZVBhcnRzUGF0dGVybilcblxuICBpZiAoIW1hdGNoKSByZXR1cm4gdmFsdWVcblxuICBjb25zdCBub3JtYWxpemVkVGltZVpvbmUgPSB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcInRpbWVab25lXCIpXG4gIGNvbnN0IGZyYWN0aW9uID0gKG1hdGNoWzddIHx8IFwiXCIpLnBhZEVuZCg5LCBcIjBcIilcblxuICB0cnkge1xuICAgIGNvbnN0IHpvbmVkRGF0ZVRpbWUgPSBUZW1wb3JhbC5ab25lZERhdGVUaW1lLmZyb20oe1xuICAgICAgZGF5OiBOdW1iZXIobWF0Y2hbM10pLFxuICAgICAgaG91cjogTnVtYmVyKG1hdGNoWzRdKSxcbiAgICAgIG1pY3Jvc2Vjb25kOiBOdW1iZXIoZnJhY3Rpb24uc2xpY2UoMywgNikpLFxuICAgICAgbWlsbGlzZWNvbmQ6IE51bWJlcihmcmFjdGlvbi5zbGljZSgwLCAzKSksXG4gICAgICBtaW51dGU6IE51bWJlcihtYXRjaFs1XSksXG4gICAgICBtb250aDogTnVtYmVyKG1hdGNoWzJdKSxcbiAgICAgIG5hbm9zZWNvbmQ6IE51bWJlcihmcmFjdGlvbi5zbGljZSg2LCA5KSksXG4gICAgICBzZWNvbmQ6IE51bWJlcihtYXRjaFs2XSksXG4gICAgICB0aW1lWm9uZTogbm9ybWFsaXplZFRpbWVab25lLFxuICAgICAgeWVhcjogTnVtYmVyKG1hdGNoWzFdKVxuICAgIH0pXG5cbiAgICByZXR1cm4gbmV3IERhdGUoTnVtYmVyKHpvbmVkRGF0ZVRpbWUuZXBvY2hNaWxsaXNlY29uZHMpKVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFJhbmdlRXJyb3IpIHJldHVybiB2YWx1ZVxuXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGEgc3RyaW5nIGhhcyBhIGRhdGV0aW1lIHRpbWV6b25lIHN1ZmZpeC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgc3RyaW5nIGVuZHMgd2l0aCBgWmAgb3IgYW4gb2Zmc2V0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaGFzRGF0ZVRpbWVUaW1lem9uZSh2YWx1ZSkge1xuICByZXR1cm4gdGltZXpvbmVTdWZmaXhQYXR0ZXJuLnRlc3QodmFsdWUpXG59XG5cbi8qKlxuICogRm9ybWF0cyBhIERhdGUgZm9yIGRhdGFiYXNlIHN0b3JhZ2UgYXMgYSBVVEMgaW5zdGFudC5cbiAqIEBwYXJhbSB7RGF0ZX0gdmFsdWUgLSBEYXRlIHZhbHVlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VUeXBlIC0gRGF0YWJhc2UgZHJpdmVyIHR5cGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIERhdGFiYXNlIGRhdGV0aW1lIHN0cmluZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdERhdGVGb3JEYXRhYmFzZSh2YWx1ZSwge2RhdGFiYXNlVHlwZX0pIHtcbiAgaWYgKGRhdGFiYXNlVHlwZSA9PSBcInNxbGl0ZVwiKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiBbXG4gICAgdmFsdWUuZ2V0VVRDRnVsbFllYXIoKSxcbiAgICBcIi1cIixcbiAgICBwYWQodmFsdWUuZ2V0VVRDTW9udGgoKSArIDEpLFxuICAgIFwiLVwiLFxuICAgIHBhZCh2YWx1ZS5nZXRVVENEYXRlKCkpLFxuICAgIFwiIFwiLFxuICAgIHBhZCh2YWx1ZS5nZXRVVENIb3VycygpKSxcbiAgICBcIjpcIixcbiAgICBwYWQodmFsdWUuZ2V0VVRDTWludXRlcygpKSxcbiAgICBcIjpcIixcbiAgICBwYWQodmFsdWUuZ2V0VVRDU2Vjb25kcygpKSxcbiAgICBcIi5cIixcbiAgICBwYWQodmFsdWUuZ2V0VVRDTWlsbGlzZWNvbmRzKCksIDMpXG4gIF0uam9pbihcIlwiKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSByZWNvcmQgd3JpdGUgc3RyaW5nIGludG8gYSBEYXRlIHdoZW4gaXQgaXMgYSByZWNvZ25pemVkIGRhdGV0aW1lIHN0cmluZy5cbiAqIFRpbWV6b25lLWxlc3Mgc3RyaW5ncyBhcmUgaW50ZXJwcmV0ZWQgaW4gdGhlIGdpdmVuIHRpbWV6b25lIHdoZW4gcHJlc2VudCwgb3RoZXJ3aXNlIFVUQy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBQYXJzZSBvcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFtvcHRpb25zLnRpbWVab25lXSAtIFRpbWV6b25lIGZvciB0aW1lem9uZS1sZXNzIHN0cmluZ3MuXG4gKiBAcmV0dXJucyB7RGF0ZSB8IHN0cmluZ30gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmV9ID0ge30pIHtcbiAgaWYgKGhhc0RhdGVUaW1lVGltZXpvbmUodmFsdWUpKSByZXR1cm4gcGFyc2VUaW1lem9uZVF1YWxpZmllZERhdGVUaW1lU3RyaW5nKHZhbHVlKVxuICBpZiAodGltZVpvbmUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHBhcnNlVGltZXpvbmVMZXNzRGF0ZVRpbWVTdHJpbmdXaXRoVGltZVpvbmUodmFsdWUsIHRpbWVab25lKVxuXG4gIHJldHVybiBwYXJzZVRpbWV6b25lTGVzc0RhdGVUaW1lU3RyaW5nQXNVdGModmFsdWUpXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHJlY29yZCB3cml0ZSB2YWx1ZSBpbnRvIGEgRGF0ZSB3aGVuIGl0IGlzIGEgcmVjb2duaXplZCBkYXRldGltZSBzdHJpbmcuXG4gKiBUaW1lem9uZS1sZXNzIHN0cmluZ3MgYXJlIGludGVycHJldGVkIGluIHRoZSBnaXZlbiB0aW1lem9uZSB3aGVuIHByZXNlbnQsIG90aGVyd2lzZSBVVEMuXG4gKiBAcGFyYW0ge0RhdGUgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBQYXJzZSBvcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFtvcHRpb25zLnRpbWVab25lXSAtIFRpbWV6b25lIGZvciB0aW1lem9uZS1sZXNzIHN0cmluZ3MuXG4gKiBAcmV0dXJucyB7RGF0ZSB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmV9ID0ge30pIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPSBcInN0cmluZ1wiKSByZXR1cm4gdmFsdWVcblxuICByZXR1cm4gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmV9KVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBkYXRhYmFzZSB2YWx1ZSBpbnRvIGEgRGF0ZSBmb3IgcmVjb3JkIHJlYWRzLlxuICogU1FMaXRlIHRpbWV6b25lLWxlc3Mgcm93cyBhcmUgbGVnYWN5IGxvY2FsIHdhbGwtY2xvY2sgcm93cyBwcm9kdWNlZCBiZWZvcmVcbiAqIFVUQyBzdG9yYWdlLiBOZXcgU1FMaXRlIHdyaXRlcyBpbmNsdWRlIGBaYCwgc28gdGhleSB0YWtlIHRoZSBleGFjdCBicmFuY2guXG4gKiBAcGFyYW0ge0RhdGUgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIFN0b3JlZCBkYXRhYmFzZSB2YWx1ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlVHlwZSAtIERhdGFiYXNlIGRyaXZlciB0eXBlLlxuICogQHJldHVybnMge0RhdGUgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHZhbHVlLCB7ZGF0YWJhc2VUeXBlfSkge1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHZhbHVlXG5cbiAgaWYgKGlzRGF0ZSh2YWx1ZSkpIHJldHVybiBuZXcgRGF0ZSh2YWx1ZS5nZXRUaW1lKCkpXG4gIGlmICh0eXBlb2YgdmFsdWUgIT0gXCJzdHJpbmdcIikgcmV0dXJuIHZhbHVlXG4gIGlmIChoYXNEYXRlVGltZVRpbWV6b25lKHZhbHVlKSkgcmV0dXJuIHBhcnNlVGltZXpvbmVRdWFsaWZpZWREYXRlVGltZVN0cmluZyh2YWx1ZSlcbiAgaWYgKGRhdGFiYXNlVHlwZSA9PSBcInNxbGl0ZVwiKSByZXR1cm4gcGFyc2VUaW1lem9uZUxlc3NEYXRlVGltZVN0cmluZ0FzTG9jYWwodmFsdWUpXG5cbiAgcmV0dXJuIHBhcnNlVGltZXpvbmVMZXNzRGF0ZVRpbWVTdHJpbmdBc1V0Yyh2YWx1ZSlcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIGxlZ2FjeSB0aW1lem9uZS1sZXNzIGRhdGV0aW1lIHZhbHVlIGludG8gdGhlIG5ldyBVVEMgZGF0YWJhc2Ugc3RvcmFnZSBmb3JtYXQuXG4gKiBUaGUgb3B0aW9uYWwgb2Zmc2V0IGZvbGxvd3MgSmF2YVNjcmlwdCdzIGBEYXRlI2dldFRpbWV6b25lT2Zmc2V0KClgIHNpZ24gY29udmVudGlvbi5cbiAqIEBwYXJhbSB7RGF0ZSB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IHZhbHVlIC0gTGVnYWN5IHZhbHVlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VUeXBlIC0gRGF0YWJhc2UgZHJpdmVyIHR5cGUuXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gW2FyZ3MubGVnYWN5TG9jYWxPZmZzZXRNaW51dGVzXSAtIFVUQy1taW51cy1sb2NhbCBvZmZzZXQgaW4gbWludXRlcy5cbiAqIEByZXR1cm5zIHtEYXRlIHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gLSBDb252ZXJ0ZWQgZGF0YWJhc2UgdmFsdWUgb3IgdGhlIG9yaWdpbmFsIHZhbHVlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29udmVydExlZ2FjeURhdGVWYWx1ZVRvVXRjU3RvcmFnZSh2YWx1ZSwge2RhdGFiYXNlVHlwZSwgbGVnYWN5TG9jYWxPZmZzZXRNaW51dGVzfSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9IFwic3RyaW5nXCIpIHJldHVybiB2YWx1ZVxuICBpZiAoaGFzRGF0ZVRpbWVUaW1lem9uZSh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gIGNvbnN0IHBhcnNlZERhdGUgPSBsZWdhY3lMb2NhbE9mZnNldE1pbnV0ZXMgPT09IHVuZGVmaW5lZFxuICAgID8gcGFyc2VUaW1lem9uZUxlc3NEYXRlVGltZVN0cmluZ0FzTG9jYWwodmFsdWUpXG4gICAgOiBwYXJzZVRpbWV6b25lTGVzc0RhdGVUaW1lU3RyaW5nV2l0aE9mZnNldCh2YWx1ZSwgbGVnYWN5TG9jYWxPZmZzZXRNaW51dGVzKVxuXG4gIGlmICghaXNEYXRlKHBhcnNlZERhdGUpKSByZXR1cm4gdmFsdWVcblxuICByZXR1cm4gZm9ybWF0RGF0ZUZvckRhdGFiYXNlKHBhcnNlZERhdGUsIHtkYXRhYmFzZVR5cGV9KVxufVxuIl19