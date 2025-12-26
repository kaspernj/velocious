// @ts-check

/**
 * @param {object} restArgs - Rest args.
 * @returns {void} - No return value.
 */
export default function restArgsError(restArgs) {
  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) {
    throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)
  }
}
