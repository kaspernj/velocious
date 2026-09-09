export declare const REQUEST_TIME_ZONE_HEADER = "X-Velocious-Time-Zone";
/**
 * Validates a configured or client-provided IANA timezone.
 * @param {string} timeZone - Timezone identifier.
 * @param {string} label - Error label.
 * @returns {string} - Normalized timezone identifier.
 */
export declare function validateTimeZone(timeZone: string, label?: string): string;
/**
 * Formats a Date as an ISO timestamp in the given timezone.
 * @param {Date} value - Date instant.
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {string} - ISO timestamp carrying the timezone's offset for the instant.
 */
export declare function formatDateInTimeZone(value: Date, timeZone: string): string;
//# sourceMappingURL=time-zone.d.ts.map