// @ts-check

/**
 * Runs service shutdown and its completion hook while preserving both failures.
 * @param {object} args - Lifecycle callbacks.
 * @param {() => Promise<void>} args.shutdown - Primary service shutdown.
 * @param {() => void | Promise<void>} [args.onStopped] - Completion hook.
 * @returns {Promise<void>} - Resolves after shutdown and the hook finish.
 */
export default async function shutdownLifecycle({shutdown, onStopped}) {
  let shutdownFailed = false
  let shutdownError

  try {
    await shutdown()
  } catch (error) {
    shutdownFailed = true
    shutdownError = error
  }

  let hookFailed = false
  let hookError

  try {
    await onStopped?.()
  } catch (error) {
    hookFailed = true
    hookError = error
  }

  if (shutdownFailed && hookFailed) {
    throw new AggregateError(
      [shutdownError, hookError],
      "Service shutdown and onStopped hook failed",
      {cause: shutdownError}
    )
  }

  if (hookFailed) throw hookError
  if (shutdownFailed) throw shutdownError
}
