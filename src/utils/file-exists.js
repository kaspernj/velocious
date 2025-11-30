import fs from "fs/promises"

/**
 * @param {string} path
 * @returns {boolean}
 */
export default async function fileExists(path) {
  try {
    await fs.access(path)

    return true
  } catch (error) { // eslint-disable-line no-unused-vars
    return false
  }
}
