// @ts-check

/**
 * Tracked stack global.
  @type {{withTrackedStack?: {withTrackedStack?: (stack: string | undefined, fn: () => Promise<?>) => Promise<?>, addTrackedStackToError?: (error: Error) => void}}} */
const trackedStackGlobal = /**
                            * Narrows the runtime value to the documented type.
                             @type {?} */ (globalThis)

/**
 * Runs add tracked stack to error.
 * @param {Error} error - Error to annotate with a tracked stack.
 */
function addTrackedStackToError(error) {
  trackedStackGlobal.withTrackedStack?.addTrackedStackToError?.(error)
}

/**
 * Runs with tracked stack.
 * @param {string | (() => Promise<?>)} stackOrCallback - Stack string or callback.
 * @param {(() => Promise<?>)} [callback] - Callback to execute.
 * @returns {Promise<?>} - Resolves with value.
 */
async function withTrackedStack(stackOrCallback, callback) {
  const tracked = trackedStackGlobal.withTrackedStack?.withTrackedStack
  const resolvedCallback = callback ?? /**
                                        * Narrows the runtime value to the documented type.
                                         @type {() => Promise<?>} */ (stackOrCallback)
  const stack = typeof stackOrCallback == "string" ? stackOrCallback : undefined

  if (tracked) {
    return await tracked(stack, resolvedCallback)
  }

  return await resolvedCallback()
}

export {addTrackedStackToError, withTrackedStack}
