// @ts-check

import wait from "awaitery/build/wait.js"

/**
 * @param {() => boolean} predicate - Condition to poll until it returns true.
 * @param {number} [timeoutMs] - Maximum time to wait.
 * @returns {Promise<void>} Resolves when the condition matches.
 */
export default async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (predicate()) return
    await wait(20)
  }

  throw new Error(`waitFor timeout after ${timeoutMs}ms`)
}
