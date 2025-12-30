// @ts-check

/** @param {Error} error - Error to annotate with a tracked stack. */
function addTrackedStackToError(error) {
  globalThis.withTrackedStack?.addTrackedStackToError(error)
}

/**
 * @param {string | (() => Promise<unknown>)} stackOrCallback - Stack string or callback.
 * @param {(() => Promise<unknown>)} [callback] - Callback to execute.
 * @returns {Promise<any>} - Resolves with value.
 */
async function withTrackedStack(stackOrCallback, callback) {
  const tracked = /** @type {((stack: string | undefined, fn: () => Promise<unknown>) => Promise<unknown>) | undefined} */ (globalThis.withTrackedStack?.withTrackedStack)
  const resolvedCallback = callback ?? /** @type {() => Promise<unknown>} */ (stackOrCallback)
  const stack = typeof stackOrCallback == "string" ? stackOrCallback : undefined

  if (tracked) {
    return await tracked(stack, resolvedCallback)
  }

  return await resolvedCallback()
}

export {addTrackedStackToError, withTrackedStack}

