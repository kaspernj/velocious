const restArgsError = (restArgs) => {
  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) {
    throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)
  }
}

export default restArgsError
