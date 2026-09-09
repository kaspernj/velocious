// @ts-check

/**
 * Attempts every shutdown step and preserves failures in execution order.
 * Caught values are intentionally opaque because JavaScript permits throwing
 * values that are not `Error` instances.
 * @param {object} args - Shutdown steps.
 * @param {string} args.message - Aggregate error message.
 * @param {Array<() => void | Promise<void>>} args.steps - Ordered steps to attempt.
 * @returns {Promise<void>} - Resolves when every step succeeds.
 */
export async function runShutdownSteps({message, steps}) {
  /** @type {unknown[]} */
  const errors = []

  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      if (error instanceof AggregateError && error.errors.length > 0) {
        errors.push(...error.errors)
      } else {
        errors.push(error)
      }
    }
  }

  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, message, {cause: errors[0]})
}

/**
 * Runs service shutdown and its completion hook while preserving both failures.
 * @param {object} args - Lifecycle callbacks.
 * @param {() => Promise<void>} args.shutdown - Primary service shutdown.
 * @param {() => void | Promise<void>} [args.onStopped] - Completion hook.
 * @returns {Promise<void>} - Resolves after shutdown and the hook finish.
 */
export default async function shutdownLifecycle({shutdown, onStopped}) {
  await runShutdownSteps({
    message: "Service shutdown and onStopped hook failed",
    steps: [shutdown, async () => await onStopped?.()]
  })
}
