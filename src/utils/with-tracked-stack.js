// @ts-check

/** @type {{withTrackedStack?: {withTrackedStack?: (stack: string | undefined, fn: () => Promise<?>) => Promise<?>, addTrackedStackToError?: (error: Error) => void}}} */
const trackedStackGlobal = /** @type {?} */ (globalThis)

/** @param {Error} error - Error to annotate with a tracked stack. */
function addTrackedStackToError(error) {
  trackedStackGlobal.withTrackedStack?.addTrackedStackToError?.(error)
}

/**
 * @param {string | (() => Promise<?>)} stackOrCallback - Stack string or callback.
 * @param {(() => Promise<?>)} [callback] - Callback to execute.
 * @returns {Promise<?>} - Resolves with value.
 */
async function withTrackedStack(stackOrCallback, callback) {
  const tracked = trackedStackGlobal.withTrackedStack?.withTrackedStack
  const resolvedCallback = callback ?? /** @type {() => Promise<?>} */ (stackOrCallback)
  const stack = typeof stackOrCallback == "string" ? stackOrCallback : undefined

  if (tracked) {
    return await tracked(stack, resolvedCallback)
  }

  return await resolvedCallback()
}

export {addTrackedStackToError, withTrackedStack}
