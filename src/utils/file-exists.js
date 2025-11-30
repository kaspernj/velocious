import fs from "fs/promises"

/**
 * @param {string} path
 * @returns {Boolean}
 */
export default async function fileExists(path) {
  try {
    await fs.access(path)

    return true
  } catch (error) { // eslint-disable-line no-unused-vars
    return false
  }
}
