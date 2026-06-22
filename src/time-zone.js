// @ts-check

import {Temporal} from "@js-temporal/polyfill"

export const REQUEST_TIME_ZONE_HEADER = "X-Velocious-Time-Zone"

const timezoneOffsetPattern = /^[+-]\d{2}:\d{2}$/

/**
 * Validates a configured or client-provided IANA timezone.
 * @param {string} timeZone - Timezone identifier.
 * @param {string} label - Error label.
 * @returns {string} - Normalized timezone identifier.
 */
export function validateTimeZone(timeZone, label = "timeZone") {
  if (typeof timeZone !== "string") {
    throw new Error(`Expected ${label} to be a timezone string`)
  }

  const normalizedTimeZone = timeZone.trim()

  if (!normalizedTimeZone) {
    throw new Error(`Expected ${label} to be a timezone string`)
  }

  if (timezoneOffsetPattern.test(normalizedTimeZone)) {
    throw new Error(`Expected ${label} to be an IANA timezone string, not offset "${normalizedTimeZone}"`)
  }

  try {
    Temporal.ZonedDateTime.from({
      day: 1,
      hour: 0,
      microsecond: 0,
      millisecond: 0,
      minute: 0,
      month: 1,
      nanosecond: 0,
      second: 0,
      timeZone: normalizedTimeZone,
      year: 2000
    })
  } catch (error) {
    throw new Error(`Invalid timezone "${normalizedTimeZone}" for ${label}`, {cause: error})
  }

  return normalizedTimeZone
}

/**
 * Formats a Date as an ISO timestamp in the given timezone.
 * @param {Date} value - Date instant.
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {string} - ISO timestamp carrying the timezone's offset for the instant.
 */
export function formatDateInTimeZone(value, timeZone) {
  const normalizedTimeZone = validateTimeZone(timeZone, "timeZone")
  const instant = Temporal.Instant.fromEpochMilliseconds(value.getTime())
  const zonedDateTime = instant.toZonedDateTimeISO(normalizedTimeZone)

  return zonedDateTime.toString({
    fractionalSecondDigits: 3,
    timeZoneName: "never"
  })
}
