// @ts-check

/**
 * Tracked stack global.
 * @type {{withTrackedStack?: {withTrackedStack?: (stack: string | undefined, fn: () => Promise<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>, addTrackedStackToError?: (error: Error) => void}}} */
const trackedStackGlobal = /** @type {ReturnType<typeof JSON.parse>} */ (globalThis)

/**
 * Runs add tracked stack to error.
 * @param {Error} error - Error to annotate with a tracked stack.
 */
function addTrackedStackToError(error) {
  trackedStackGlobal.withTrackedStack?.addTrackedStackToError?.(error)
}

/**
 * Runs with tracked stack.
 * @param {string | (() => Promise<ReturnType<typeof JSON.parse>>)} stackOrCallback - Stack string or callback.
 * @param {(() => Promise<ReturnType<typeof JSON.parse>>)} [callback] - Callback to execute.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with value.
 */
async function withTrackedStack(stackOrCallback, callback) {
  const tracked = trackedStackGlobal.withTrackedStack?.withTrackedStack
  const resolvedCallback = callback ?? /** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ (stackOrCallback)
  const stack = typeof stackOrCallback == "string" ? stackOrCallback : undefined

  if (tracked) {
    return await tracked(stack, resolvedCallback)
  }

  return await resolvedCallback()
}

export {addTrackedStackToError, withTrackedStack}
