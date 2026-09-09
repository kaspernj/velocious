/**
 * Checks whether a string has a datetime timezone suffix.
 * @param {string} value - Value to check.
 * @returns {boolean} - Whether the string ends with `Z` or an offset.
 */
export declare function hasDateTimeTimezone(value: string): boolean;
/**
 * Formats a Date for database storage as a UTC instant.
 * @param {Date} value - Date value.
 * @param {object} args - Options.
 * @param {string} args.databaseType - Database driver type.
 * @returns {string} - Database datetime string.
 */
export declare function formatDateForDatabase(value: Date, { databaseType }: {
    databaseType: string;
}): string;
/**
 * Normalizes a record write string into a Date when it is a recognized datetime string.
 * Timezone-less strings are interpreted in the given timezone when present, otherwise UTC.
 * @param {string} value - Value to normalize.
 * @param {object} [options] - Parse options.
 * @param {string | undefined} [options.timeZone] - Timezone for timezone-less strings.
 * @returns {Date | string} - Normalized value.
 */
export declare function normalizeDateStringForWrite(value: string, { timeZone }?: {
    timeZone?: string | undefined;
}): Date | string;
/**
 * Normalizes a record write value into a Date when it is a recognized datetime string.
 * Timezone-less strings are interpreted in the given timezone when present, otherwise UTC.
 * @param {Date | string | null | undefined} value - Value to normalize.
 * @param {object} [options] - Parse options.
 * @param {string | undefined} [options.timeZone] - Timezone for timezone-less strings.
 * @returns {Date | string | null | undefined} - Normalized value.
 */
export declare function normalizeDateValueForWrite(value: Date | string | null | undefined, { timeZone }?: {
    timeZone?: string | undefined;
}): Date | string | null | undefined;
/**
 * Normalizes a database value into a Date for record reads.
 * SQLite timezone-less rows are legacy local wall-clock rows produced before
 * UTC storage. New SQLite writes include `Z`, so they take the exact branch.
 * @param {Date | string | null | undefined} value - Stored database value.
 * @param {object} args - Options.
 * @param {string} args.databaseType - Database driver type.
 * @returns {Date | string | null | undefined} - Normalized value.
 */
export declare function normalizeDateValueForRead(value: Date | string | null | undefined, { databaseType }: {
    databaseType: string;
}): Date | string | null | undefined;
/**
 * Converts a legacy timezone-less datetime value into the new UTC database storage format.
 * The optional offset follows JavaScript's `Date#getTimezoneOffset()` sign convention.
 * @param {Date | string | null | undefined} value - Legacy value.
 * @param {object} args - Options.
 * @param {string} args.databaseType - Database driver type.
 * @param {number | undefined} [args.legacyLocalOffsetMinutes] - UTC-minus-local offset in minutes.
 * @returns {Date | string | null | undefined} - Converted database value or the original value.
 */
export declare function convertLegacyDateValueToUtcStorage(value: Date | string | null | undefined, { databaseType, legacyLocalOffsetMinutes }: {
    databaseType: string;
    legacyLocalOffsetMinutes?: number | undefined;
}): Date | string | null | undefined;
//# sourceMappingURL=datetime-storage.d.ts.map