// @ts-check

import process from "node:process"

/**
 * Runs a callback with the Node process timezone temporarily changed.
 * @param {string} timezone - IANA timezone name.
 * @param {() => Promise<void>} callback - Callback to run.
 * @returns {Promise<void>} - Resolves when the callback has completed.
 */
export default async function runWithProcessTimezone(timezone, callback) {
  const previousTimezone = process.env.TZ

  process.env.TZ = timezone

  try {
    await callback()
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = previousTimezone
    }
  }
}
