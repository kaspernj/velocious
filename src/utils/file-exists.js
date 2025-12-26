// @ts-check

import fs from "fs/promises"

/**
 * @param {string} path - Path.
 * @returns {Promise<boolean>} - Resolves with Whether the operation succeeded.
 */
export default async function fileExists(path) {
  try {
    await fs.access(path)

    return true
  } catch (error) { // eslint-disable-line no-unused-vars
    return false
  }
}
