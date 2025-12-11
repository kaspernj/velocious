// @ts-check

/**
 * @param {object} restArgs
 * @returns {void}
 */
export default function restArgsError(restArgs) {
  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) {
    throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)
  }
}
