import fs from "node:fs/promises"

/**
 * @param {string} path
 * @returns {Boolean}
 */
export default async function fileExists(path) {
  try {
    await fs.access(path)

    return true
  } catch (error) {
    return false
  }
}
